#!/usr/bin/env node
/**
 * 从内容仓库（白名单）同步 → docs/，并生成 VitePress 的导航数据。
 *
 * 用法：
 *   CONTENT_DIR=/path/to/private-vault npm run sync
 *   node scripts/sync.mjs /path/to/private-vault
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'

import { createSelection, loadBlogIgnore } from './lib/blogignore.mjs'
import { buildLinkIndex, transformBody } from './lib/obsidian.mjs'
import {
  buildNav,
  buildSidebar,
  dateFromFilename,
  normalizeDate,
  renderArchive,
  renderHomepage,
  renderSectionIndex,
  routeOf,
  sectionOf,
  sortPosts,
  titleFromFilename,
} from './lib/render.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
// DOCS_DIR 只给 verify 脚本做隔离用，正常构建不用管
const DOCS = process.env.DOCS_DIR
  ? path.resolve(ROOT, process.env.DOCS_DIR)
  : path.join(ROOT, 'docs')
const GEN = path.join(DOCS, '.vitepress', 'generated')

// 站点信息全部走环境变量，CI 里由仓库 Variables 注入，不用改代码
const SITE = {
  title: process.env.SITE_TITLE || '我的博客',
  text: process.env.SITE_TEXT || '把笔记变成站点',
  tagline: process.env.SITE_TAGLINE || '由 Obsidian 笔记自动发布',
}

const warnings = []
const warn = (msg) => warnings.push(msg)

function resolveContentDir() {
  const fromArg = process.argv[2]
  const fromEnv = process.env.CONTENT_DIR
  const candidate = fromArg || fromEnv || path.join(ROOT, 'content')
  const abs = path.resolve(ROOT, candidate)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(
      `内容仓库不存在：${abs}\n` +
        '请用 CONTENT_DIR=/path/to/vault npm run sync 指定，或把私有仓库 clone 到 ./content。',
    )
  }
  return abs
}

function ensureCleanOutDir() {
  fs.mkdirSync(GEN, { recursive: true })
  const manifestFile = path.join(GEN, 'files.json')
  if (!fs.existsSync(manifestFile)) return []
  try {
    const prev = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    return Array.isArray(prev.files) ? prev.files : []
  } catch {
    return []
  }
}

/** 删掉上一次生成、这一次不再生成的文件，避免草稿从白名单移除后还留在站点上 */
function removeStale(previous, current) {
  const keep = new Set(current)
  let removed = 0
  for (const rel of previous) {
    if (keep.has(rel) || rel.startsWith('.vitepress/generated/')) continue
    const abs = path.join(DOCS, rel)
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true })
      removed++
    }
    // 清掉空目录
    let dir = path.dirname(abs)
    while (dir.startsWith(DOCS) && dir !== DOCS) {
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
        else break
      } catch {
        break
      }
      dir = path.dirname(dir)
    }
  }
  return removed
}

function writeOut(rel, content) {
  const abs = path.join(DOCS, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return rel
}

/** 数一下 $$ 围栏（跳过代码块），用于发现未闭合的公式 */
function countMathFences(content) {
  let inFence = false
  let count = 0
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence && line.trim() === '$$') count++
  }
  return count
}

function excerpt(text) {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 110 ? `${plain.slice(0, 110)}…` : plain
}

function main() {
  fs.mkdirSync(GEN, { recursive: true })
  const previous = ensureCleanOutDir()
  const contentDir = resolveContentDir()
  const ignoreFile = loadBlogIgnore(contentDir)
  const selection = createSelection(ignoreFile)
  const { files, skipped } = selection.collect(contentDir)

  if (files.length === 0) {
    throw new Error(
      `白名单没有匹配到任何文件。检查 ${ignoreFile.file} 里的路径（相对内容仓库根目录）。`,
    )
  }

  // 不允许往 .vitepress 里塞内容
  const publishable = files.filter((rel) => {
    if (rel.startsWith('.vitepress/')) {
      warn(`${rel} 落在 VitePress 配置目录里，已跳过`)
      return false
    }
    return true
  })

  const resolveNote = buildLinkIndex(publishable)

  // 根目录 index.md 会和生成的首页抢同一个路由
  const hasRootIndex = publishable.includes('index.md')
  if (hasRootIndex) {
    warn('内容仓库根目录的 index.md 与生成的首页冲突，已跳过；请改名（如 about.md）或移入子目录。')
  }

  const mdFiles = publishable.filter((rel) => /\.md$/i.test(rel))
  const assetFiles = publishable.filter((rel) => !/\.md$/i.test(rel))

  const posts = []
  const outputs = []

  for (const rel of mdFiles) {
    if (rel === 'index.md') continue
    const raw = fs.readFileSync(path.join(contentDir, rel), 'utf8')
    let parsed
    try {
      parsed = matter(raw)
    } catch (e) {
      warn(`${rel} frontmatter 解析失败：${e.message}`)
      parsed = { data: {}, content: raw }
    }

    // $$ 围栏不成对时，公式会把后面的标题/正文一起吞进数学模式，
    // 页面上表现为一整段红字报错。这里只告警，不改内容。
    const fenceCount = countMathFences(raw)
    if (fenceCount % 2 === 1) {
      warn(`${rel}: $$ 围栏有 ${fenceCount} 个（奇数），公式会吞掉后面的内容，建议在 Obsidian 里检查`)
    }

    const data = { ...parsed.data }
    if (data.draft === true) {
      warn(`${rel} 标记了 draft: true，已跳过`)
      continue
    }

    const title =
      (typeof data.title === 'string' && data.title.trim()) ||
      (parsed.content.match(/^#\s+(.+)$/m)?.[1] ?? '').trim() ||
      titleFromFilename(rel)

    const date =
      normalizeDate(data.date) ||
      normalizeDate(data.created) ||
      normalizeDate(data.pubDate) ||
      normalizeDate(data.publishDate) ||
      normalizeDate(data.updated) ||
      dateFromFilename(rel)

    const { text, warnings: tw, missing } = transformBody(parsed.content, {
      currentRel: rel,
      resolveNote,
      warn,
    })
    for (const t of tw) warn(`${rel}: ${t}`)
    for (const m of missing) warn(`${rel}: 双链 [[${m}]] 指向未发布文件，已降级为纯文本`)

    const front = { ...data, title }
    if (date) front.date = date
    if (data.tags && !Array.isArray(data.tags)) front.tags = [data.tags]

    const body = matter.stringify(text, front)
    outputs.push(writeOut(rel, body))

    posts.push({
      rel,
      route: routeOf(rel),
      title,
      date,
      tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
      section: sectionOf(rel),
      summary: excerpt(text),
      link: routeOf(rel),
      // markdown 表格/正文里用 .md 绝对路径，交给 VitePress 改写
      mdLink: `/${rel}`,
    })
  }

  // 附件原样复制
  for (const rel of assetFiles) {
    const abs = path.join(contentDir, rel)
    const dest = path.join(DOCS, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(abs, dest)
    outputs.push(rel)
  }

  const sorted = sortPosts(posts)
  const undated = posts.filter((p) => !p.date).map((p) => p.rel)
  if (undated.length) {
    warn(
      `${undated.length} 篇没有日期，排序会靠后。建议加 frontmatter date 或文件名用 YYYY-MM-DD- 前缀：${undated
        .slice(0, 5)
        .join(', ')}${undated.length > 5 ? ' …' : ''}`,
    )
  }

  const sidebar = buildSidebar(sorted)
  const nav = buildNav(sorted)
  const homepage = renderHomepage({ posts: sorted, site: SITE })
  const archive = renderArchive(sorted)

  outputs.push(writeOut('index.md', homepage))
  outputs.push(writeOut('archive.md', archive))

  // 每个一级分类都要有 /<分类>/ 这个落地页，否则导航点进去是 404。
  // 内容仓库里如果已经有 <分类>/index.md（Obsidian 的文件夹笔记），就用作者自己的。
  for (const section of new Set(sorted.map((p) => p.section))) {
    if (section === '未分类') continue
    const rel = `${section}/index.md`
    if (sorted.some((p) => p.rel === rel)) continue
    outputs.push(
      writeOut(rel, renderSectionIndex(section, sorted.filter((p) => p.section === section))),
    )
  }

  // 生成数据：配置文件和首页都能读
  const generated = {
    'posts.json': JSON.stringify({ posts: sorted, nav, sidebar, site: SITE }, null, 2),
  }
  for (const [name, content] of Object.entries(generated)) {
    fs.writeFileSync(path.join(GEN, name), content)
  }

  const removed = removeStale(previous, outputs)
  fs.writeFileSync(
    path.join(GEN, 'files.json'),
    JSON.stringify({ files: outputs, generatedAt: new Date().toISOString() }, null, 2),
  )

  // 报告
  const bySection = new Map()
  for (const p of sorted) bySection.set(p.section, (bySection.get(p.section) ?? 0) + 1)

  console.log(`\n内容仓库：${contentDir}`)
  console.log(`白名单：  ${ignoreFile.file}`)
  console.log(`发布：    ${sorted.length} 篇笔记，${assetFiles.length} 个附件，${removed} 个旧文件已清理`)
  if (bySection.size) {
    console.log(
      '分类：    ' +
        [...bySection.entries()].map(([k, v]) => `${k}(${v})`).join('  '),
    )
  }
  if (skipped.length) console.log(`跳过：    ${skipped.length} 个符号链接`)

  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} 条警告：`)
    for (const w of warnings) console.log(`   - ${w}`)
  } else {
    console.log('\n✅ 没有警告')
  }
  console.log('')
}

try {
  main()
} catch (e) {
  console.error(`\n❌ 同步失败：${e.message}\n`)
  process.exit(1)
}
