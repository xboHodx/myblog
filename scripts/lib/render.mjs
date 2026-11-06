/**
 * 由"已发布笔记"生成 VitePress 需要的导航/侧边栏/首页/归档页。
 */

const UNCATEGORIZED = '未分类'

const pad = (n) => String(n).padStart(2, '0')

/** 把各种来源的日期统一成 YYYY-MM-DD，拿不到就返回 null。 */
export function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  const s = String(value).trim()
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return null
}

export function dateFromFilename(rel) {
  const base = rel.split('/').pop() || ''
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})-/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** 文件名 → 可读标题：去日期前缀、去扩展名、连字符换空格。 */
export function titleFromFilename(rel) {
  return (rel.split('/').pop() || '')
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

/** 笔记路由：/a/b.md → /a/b；/a/index.md → /a/ */
export function routeOf(rel) {
  const noExt = rel.replace(/\.md$/i, '')
  if (/\/index$/i.test(noExt)) return `/${noExt.replace(/\/index$/i, '')}/`
  if (noExt === 'index') return '/'
  return `/${noExt}`
}

export const sectionOf = (rel) => (rel.includes('/') ? rel.split('/')[0] : UNCATEGORIZED)

/** 按日期倒序；没有日期的排最后，再按标题。 */
export function sortPosts(posts) {
  return [...posts].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
    if (a.date) return -1
    if (b.date) return 1
    return a.title.localeCompare(b.title)
  })
}

const esc = (s) =>
  String(s).replace(/[|\\]/g, (c) => `\\${c}`).replace(/\n/g, ' ')

const mdTarget = (t) => (/[\s()]/.test(t) ? `<${t}>` : t)
const linkCell = (p) => `[${esc(p.title)}](${mdTarget(p.mdLink)})`

/** 首页：hero + 最近 N 篇 */
export function renderHomepage({ posts, site, recent = 10 }) {
  const latest = posts.slice(0, recent)
  const rows = latest.map(
    (p) => `| ${p.date ?? '—'} | ${linkCell(p)} | ${esc(p.section)} |`,
  )
  const sections = new Set(posts.map((p) => p.section))

  const features = [...sections]
    .slice(0, 4)
    .map((s) => {
      const count = posts.filter((p) => p.section === s).length
      return `  - icon: 📚\n    title: ${JSON.stringify(s).replace(/"/g, '')}\n    details: ${count} 篇`
    })
    .join('\n')

  return `---
layout: home
hero:
  name: ${site.title}
  text: ${site.text ?? site.tagline ?? ''}
  tagline: ${site.tagline ?? ''}
  actions:
    - theme: brand
      text: 开始阅读
      link: ${latest[0]?.link ?? '/archive'}
    - theme: alt
      text: 全部文章
      link: /archive
${features ? `features:\n${features}\n` : ''}---

## 最近更新

| 日期 | 标题 | 分类 |
| --- | --- | --- |
${rows.length ? rows.join('\n') : '| — | 还没有文章 | — |'}
`
}

/** 归档页：按年份分组 */
export function renderArchive(posts) {
  const byYear = new Map()
  for (const p of posts) {
    const year = p.date ? p.date.slice(0, 4) : '未标日期'
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year).push(p)
  }
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a))

  const body = years
    .map((y) => {
      const rows = byYear
        .get(y)
        .map((p) => `| ${p.date?.slice(5) ?? '—'} | ${linkCell(p)} | ${esc(p.section)} |`)
        .join('\n')
      return `## ${y}\n\n| 日期 | 标题 | 分类 |\n| --- | --- | --- |\n${rows}`
    })
    .join('\n\n')

  return `# 全部文章

共 ${posts.length} 篇。

${body || '还没有文章。'}
`
}

/** 侧边栏：按目录树分组，只对每个一级目录生效 */
export function buildSidebar(posts) {
  const sections = new Map()
  for (const p of posts) {
    if (p.route === '/') continue // 首页不放进侧边栏
    if (p.rel === `${p.section}/index.md`) continue // 分类落地页不重复进侧边栏
    const section = p.section
    if (!sections.has(section)) sections.set(section, [])
    sections.get(section).push(p)
  }

  const sidebar = {}
  for (const [section, items] of sections) {
    const prefix = section === UNCATEGORIZED ? '/' : `/${section}/`
    sidebar[prefix] = [{ text: section, items: buildTree(items, prefix) }]
  }
  return sidebar
}

function buildTree(posts, prefix) {
  const root = { children: new Map() }
  for (const p of posts) {
    const dirs = p.rel
      .split('/')
      .slice(1)
      .slice(0, -1)
    let node = root
    for (const d of dirs) {
      if (!node.children.has(d)) node.children.set(d, { children: new Map() })
      node = node.children.get(d)
    }
    node.children.set(`\u0000${p.rel}`, { post: p })
  }

  const walk = (node, depth) => {
    const groups = []
    const leaves = []
    for (const [key, child] of node.children) {
      if (key.startsWith('\u0000')) {
        leaves.push({ text: child.post.title, link: child.post.link })
      } else {
        const items = walk(child, depth + 1)
        if (items.length) groups.push({ text: key, collapsed: depth >= 1, items })
      }
    }
    // 笔记按标题排，子目录跟在后面
    leaves.sort((a, b) => a.text.localeCompare(b.text))
    return [...leaves, ...groups]
  }

  return walk(root, 0)
}

/** 顶部导航：一级目录 + 归档 */
export function buildNav(posts, { maxSections = 8 } = {}) {
  const sections = []
  for (const p of posts) {
    if (p.section === UNCATEGORIZED) continue
    if (!sections.includes(p.section)) sections.push(p.section)
  }
  const nav = sections.slice(0, maxSections).map((s) => ({
    text: s,
    link: `/${s}/`,
  }))
  nav.push({ text: '归档', link: '/archive' })
  return nav
}

/** 分类落地页：让 /posts/ 这种导航目标有真实页面，而不是 404 */
export function renderSectionIndex(section, posts) {
  const rows = posts
    .map((p) => `| ${p.date ?? '—'} | ${linkCell(p)} |`)
    .join('\n')
  return `# ${section}

共 ${posts.length} 篇。

| 日期 | 标题 |
| --- | --- |
${rows}
`
}
