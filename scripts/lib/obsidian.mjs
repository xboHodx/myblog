/**
 * Obsidian 方言 → VitePress 能正确渲染的 Markdown。
 *
 * 处理范围（只做"不处理就会渲染成乱码/死链"的那几类）：
 *   [[笔记]]、[[笔记#标题|别名]]、![[图片.png]]、![[笔记]]  → 正常链接 / 图片
 *   > [!note] 标题  → ::: tip 容器
 *   %% 注释 %%      → 删除
 *   ==高亮==        → <mark>
 *
 * 关键点：链接指向的白名单之外的文件一律降级成纯文本，
 * 不能把未发布笔记的标题（甚至路径）暴露到公开站点上。
 */
import path from 'node:path'

const posix = path.posix
const lower = (s) => s.toLowerCase()

const stripExt = (p) => p.replace(/\.md$/i, '')
const looksLikeMd = (p) => /\.md$/i.test(p)

/** 需要 URL 转义（空格、括号）时才用 <> 包起来，其余保持原样，中文路径没问题。 */
const mdLinkTarget = (target) =>
  /[\s()]/.test(target) ? `<${target}>` : target

const relFrom = (fromRel, toRel) => {
  const r = posix.relative(posix.dirname(fromRel), toRel)
  return r.startsWith('.') ? r : `./${r}`
}

/** 建立"笔记名 → 文件路径"的索引，供 [[双链]] 解析。 */
export function buildLinkIndex(files) {
  const notesByFull = new Map()
  const notesByBase = new Map()
  const assetsByFull = new Map()
  const assetsByBase = new Map()

  for (const rel of files) {
    if (looksLikeMd(rel)) {
      const full = lower(stripExt(rel))
      notesByFull.set(full, rel)
      const base = lower(posix.basename(stripExt(rel)))
      if (!notesByBase.has(base)) notesByBase.set(base, [])
      notesByBase.get(base).push(rel)
    } else {
      assetsByFull.set(lower(rel), rel)
      const base = lower(posix.basename(rel))
      if (!assetsByBase.has(base)) assetsByBase.set(base, [])
      assetsByBase.get(base).push(rel)
    }
  }

  const pick = (candidates) =>
    [...candidates].sort((a, b) => a.length - b.length)[0]

  /**
   * @returns {{kind:'note'|'asset', rel:string, ambiguous?:boolean} | null}
   */
  return function resolve(target) {
    const raw = target.trim()
    if (!raw) return null

    if (looksLikeMd(raw) || !posix.extname(raw)) {
      const noExt = lower(stripExt(raw))
      if (notesByFull.has(noExt)) {
        return { kind: 'note', rel: notesByFull.get(noExt) }
      }
      if (notesByFull.has(lower(`${noExt}.md`))) {
        return { kind: 'note', rel: notesByFull.get(lower(`${noExt}.md`)) }
      }
    }

    if (assetsByFull.has(lower(raw))) {
      return { kind: 'asset', rel: assetsByFull.get(lower(raw)) }
    }

    // 只写了文件名：Obsidian 全库唯一匹配
    const noteBase = lower(stripExt(posix.basename(raw)))
    const noteHits = notesByBase.get(noteBase)
    if (noteHits?.length) {
      return { kind: 'note', rel: pick(noteHits), ambiguous: noteHits.length > 1 }
    }

    const assetBase = lower(posix.basename(raw))
    const assetHits = assetsByBase.get(assetBase)
    if (assetHits?.length) {
      return { kind: 'asset', rel: pick(assetHits), ambiguous: assetHits.length > 1 }
    }

    return null
  }
}

const CALLOUT_MAP = {
  note: 'info',
  info: 'info',
  abstract: 'info',
  summary: 'info',
  todo: 'info',
  hint: 'tip',
  tip: 'tip',
  important: 'info',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  example: 'tip',
  question: 'info',
  help: 'info',
  faq: 'info',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  cite: 'info',
}

const CALLOUT_RE = /^\s*>\s*\[!([a-zA-Z]+)\][+-]?\s*(.*)$/

/** 把一段连续的 > 引用行转成 VitePress 容器。不是 callout 就原样返回。 */
function convertCallouts(text) {
  const lines = text.split('\n')
  const out = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CALLOUT_RE)
    const kind = m && CALLOUT_MAP[m[1].toLowerCase()]
    if (!m || !kind) {
      out.push(lines[i])
      continue
    }

    // 收集整段引用；遇到下一个 callout 起始行必须停下，否则两个 callout 会粘在一起
    const block = []
    let j = i + 1
    while (j < lines.length && (/^\s*>/.test(lines[j]) || lines[j].trim() === '')) {
      if (block.length > 0 && CALLOUT_RE.test(lines[j])) break
      // 空行后面如果不再是引用，就结束
      if (lines[j].trim() === '') {
        let k = j
        while (k < lines.length && lines[k].trim() === '') k++
        if (k >= lines.length || !/^\s*>/.test(lines[k])) break
      }
      block.push(lines[j])
      j++
    }

    const body = block
      .map((l) => l.replace(/^\s*>\s?/, ''))
      .join('\n')
      .trim()
    const title = m[2].trim()

    out.push(`::: ${kind}${title ? ` ${title}` : ''}`)
    if (body) out.push(body)
    out.push(':::')
    i = j - 1
  }

  return out.join('\n')
}

/** 处理 ![[...]] / [[...]]，返回 { text, warnings, links } */
export function transformBody(body, { currentRel, resolveNote }) {
  const warnings = []
  const missing = []
  let text = body

  // 1. 删除 Obsidian 注释
  text = text.replace(/%%[\s\S]*?%%/g, '')

  // 2. 嵌入 ![[...]]：图片 → 图片；笔记 → 普通链接
  text = text.replace(/!\[\[([^\]\n]+?)\]\]/g, (whole, inner) => {
    const [targetRaw, ...rest] = inner.split('|')
    const target = targetRaw.trim()
    const size = rest.join('|').trim()
    const hit = resolveNote(target.split('#')[0].trim())

    if (!hit) {
      missing.push(inner)
      return ''
    }
    if (hit.kind === 'note') {
      warnings.push(`![[${inner}]] 是笔记嵌入，已降级为链接`)
      if (hit.rel === currentRel) return ''
      const url = mdLinkTarget(relFrom(currentRel, hit.rel))
      return `[${posix.basename(stripExt(hit.rel))}](${url})`
    }

    const src = relFrom(currentRel, hit.rel)
    const alt = posix.basename(hit.rel)
    const encoded = /[\s()]/.test(src) ? `<${src}>` : src
    const width = /^\d+$/.test(size) ? size : ''
    if (width) {
      return `<img src="${src}" alt="${alt}" width="${width}" />`
    }
    return `![${alt}](${encoded})`
  })

  // 3. 普通双链
  text = text.replace(/(?<!!)\[\[([^\]\n]+?)\]\]/g, (whole, inner) => {
    const [targetRaw, ...rest] = inner.split('|')
    const target = targetRaw.trim()
    const alias = rest.join('|').trim()
    const [notePart, heading] = target.split('#')
    const hit = notePart.trim() ? resolveNote(notePart.trim()) : null

    if (notePart.trim() && !hit) {
      missing.push(inner)
      // 未发布：只保留可见文字，绝不暴露路径
      return alias || posix.basename(stripExt(target))
    }
    if (hit && hit.kind === 'asset') {
      // [[图片.png]] 不带感叹号，按普通链接处理
      const url = mdLinkTarget(relFrom(currentRel, hit.rel))
      return `[${alias || posix.basename(hit.rel)}](${url})`
    }

    const label = alias || posix.basename(stripExt(notePart.trim() || target))
    if (!notePart.trim()) {
      return heading ? `[${label}](#${anchor(heading)})` : label
    }
    if (hit.rel === currentRel) {
      return heading ? `[${label}](#${anchor(heading)})` : label
    }
    const anchorPart = heading ? `#${anchor(heading)}` : ''
    const url = mdLinkTarget(relFrom(currentRel, hit.rel)) + encodeAnchorSuffix(anchorPart)
    return `[${label}](${url})`
  })

  // 4. 高亮
  text = text.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>')

  // 5. callout
  text = convertCallouts(text)

  return { text, warnings, missing }
}

/**
 * 与 VitePress 内置 slugify 对齐，否则 [[笔记#标题]] 生成的锚点会点不过去。
 * 参考 @mdit-vue/shared 的 slugify 实现。
 */
const rControl = /[\u0000-\u001f]/g
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[\u0300-\u036f]/g

export function slugify(str) {
  return str
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}

const anchor = (heading) => slugify(heading.trim())

/** 锚点里可能含中文，保持原样即可；只有空格/括号需要处理 */
const encodeAnchorSuffix = (s) => s.replace(/ /g, '%20')
