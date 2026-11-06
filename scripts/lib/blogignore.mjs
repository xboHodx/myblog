/**
 * .blogignore —— 发布白名单（allowlist），不是忽略列表。
 *
 * 语法沿用 gitignore，但含义相反：
 *   写进文件的路径 = 会被发布到博客；没写的 = 永远不发布。
 *   `!pattern` 表示从白名单里再剔除（黑名单优先级最高）。
 *
 * 为什么反过来？内容仓库里放着草稿、日记、客户资料，白名单是 fail-closed 的：
 * 只有你明确写下来的东西才会进公开站点，新增文件默认不会泄露。
 */
import fs from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'

/** 无论白名单怎么写，这些永远不发布（安全底线）。 */
export const HARD_EXCLUDES = [
  '.git',
  '.github',
  '.obsidian',
  '.trash',
  '.blogignore',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.venv',
  '__pycache__',
]

const toPosix = (p) => p.split(path.sep).join('/')

export class BlogIgnoreError extends Error {}

/**
 * 读取并解析 <contentDir>/.blogignore。
 * 文件缺失直接抛错：宁可构建失败，也不要"什么规则都没有"时把所有内容推上线。
 */
export function loadBlogIgnore(contentDir) {
  const file = path.join(contentDir, '.blogignore')
  if (!fs.existsSync(file)) {
    throw new BlogIgnoreError(
      `找不到 ${file}\n` +
        '这是发布白名单，必须放在内容仓库根目录。没有它构建会失败（这是故意的）。\n' +
        '可以先复制 .blogignore.example 作为起点。',
    )
  }

  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const includes = []
  const excludes = []

  for (const [i, line] of raw.entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // 忽略 gitignore 常见的 "目录/" 之外的行尾空格噪音
    if (trimmed.startsWith('!')) {
      const pattern = trimmed.slice(1).trim()
      if (!pattern) throw new BlogIgnoreError(`${file}:${i + 1} 空的取反规则`)
      excludes.push(pattern)
    } else {
      includes.push(trimmed)
    }
  }

  if (includes.length === 0) {
    throw new BlogIgnoreError(
      `${file} 里没有任何发布规则。白名单为空 = 博客什么都不会有，构建中止。`,
    )
  }

  return { file, includes, excludes }
}

const safeAdd = (ig, patterns) => {
  for (const p of patterns) {
    try {
      ig.add(p)
    } catch (e) {
      throw new BlogIgnoreError(`无法解析规则 "${p}": ${e.message}`)
    }
  }
  return ig
}

/**
 * 生成判定器：给定仓库内的相对路径，回答"是否发布"。
 */
export function createSelection({ includes, excludes }) {
  const inc = safeAdd(ignore(), includes)
  const exc = safeAdd(ignore(), excludes)
  const hard = safeAdd(ignore(), HARD_EXCLUDES)

  const isHardExcluded = (rel, isDir) =>
    hard.ignores(isDir ? `${toPosix(rel)}/` : toPosix(rel))
  const isExcluded = (rel, isDir) =>
    exc.ignores(isDir ? `${toPosix(rel)}/` : toPosix(rel))
  const isListed = (rel, isDir) => {
    const p = toPosix(rel)
    return isDir ? inc.ignores(`${p}/`) || inc.ignores(p) : inc.ignores(p)
  }

  /**
   * 遍历内容仓库，返回 { files, dirs }，都是 posix 相对路径。
   * 目录一旦命中白名单，整棵子树都进入（除非被 ! 排除）。
   */
  function collect(root) {
    const files = []
    const dirs = []
    const skipped = []

    const visit = (relDir, inherited) => {
      const abs = path.join(root, relDir || '.')
      let entries
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name
        // 符号链接一律跳过：避免把仓库之外的文件带进来
        if (entry.isSymbolicLink()) {
          skipped.push(rel)
          continue
        }
        const isDir = entry.isDirectory()
        if (!isDir && !entry.isFile()) continue
        if (isHardExcluded(rel, isDir)) continue
        if (isExcluded(rel, isDir)) continue

        const selected = inherited || isListed(rel, isDir)
        if (selected) {
          if (isDir) dirs.push(rel)
          else files.push(rel)
        }
        if (isDir) visit(rel, selected)
      }
    }

    visit('', false)
    files.sort()
    dirs.sort()
    return { files, dirs, skipped }
  }

  return { collect, isHardExcluded, isExcluded, isListed }
}
