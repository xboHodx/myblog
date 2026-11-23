import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { katex } from '@mdit/plugin-katex'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 站点挂在哪个路径下？
 *
 *   有自定义域名（docs/public/CNAME 非空）→ 站点在根路径，base = '/'
 *   没有（username.github.io/<repo>/）    → base = '/<repo>/'
 *
 * 仓库名从 GITHUB_REPOSITORY 拿（Actions 自动注入），本地跑就用目录名兜底。
 * 想强制指定就设环境变量 BASE_PATH，优先级最高。
 */
function detectBase(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  if (readCname()) return '/'
  // here = <repo>/docs/.vitepress，往上两级才是仓库根目录
  const repo =
    process.env.GITHUB_REPOSITORY?.split('/')[1] ??
    path.basename(path.dirname(path.dirname(here)))
  return `/${repo}/`
}

/** GitHub Pages 的自定义域名，来自随产物发布的 CNAME 文件 */
function readCname(): string {
  try {
    return fs.readFileSync(path.join(here, '..', 'public', 'CNAME'), 'utf8').trim()
  } catch {
    return ''
  }
}

type Generated = {
  posts: Array<{
    rel: string
    route: string
    title: string
    date: string | null
    section: string
  }>
  nav: Array<{ text: string; link: string }>
  sidebar: Record<string, unknown>
  site: { title: string; text?: string; tagline?: string }
}

const readGenerated = (): Generated => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(here, 'generated', 'posts.json'), 'utf8'),
    ) as Generated
  } catch {
    // 还没跑过 sync（比如刚 clone 下来直接 npm run dev）
    return {
      posts: [],
      nav: [],
      sidebar: {},
      site: { title: '我的博客', tagline: '先运行 npm run sync' },
    }
  }
}

const data = readGenerated()

export default defineConfig({
  lang: 'zh-CN',
  title: data.site.title,
  description: data.site.tagline ?? '',
  base: detectBase(),
  cleanUrls: false,
  ignoreDeadLinks: false,
  lastUpdated: false,

  markdown: {
    image: { lazyLoading: true },
    theme: { light: 'github-light', dark: 'github-dark' },
    // Obsidian 笔记里的 $$...$$ / $...$ 用 KaTeX 在构建期转成静态 HTML。
    // 选 KaTeX 而不是 MathJax：快 5-10 倍，输出是普通 span，不会有自定义标签
    // 被 Vue 当组件吃掉的坑；不支持的写法会红字报错而不是静默消失。
    // throwOnError: false —— 别让一条写坏的公式搞挂整站构建。
    config: (md) => {
      md.use(katex, {
        throwOnError: false,
        strict: 'ignore',
      })

      // KaTeX 的 HTML 输出里会带字面量 {{（例如 \{ 的渲染结果），
      // 到 Vue 编译阶段会被当成插值表达式直接报错。整页渲染完统一转义成实体，
      // 浏览器里显示效果不变。
      const render = md.renderer.render.bind(md.renderer)
      md.renderer.render = (tokens, options, env) =>
        render(tokens, options, env).replace(/\{\{/g, '&#123;&#123;')
    },
  },

  sitemap: {
    // 有自定义域名就用它，否则按 username.github.io 拼
    hostname:
      process.env.SITE_ORIGIN ||
      (readCname()
        ? `https://${readCname()}`
        : `https://${process.env.GITHUB_REPOSITORY_OWNER ?? 'example'}.github.io`),
  },

  themeConfig: {
    nav: data.nav,
    sidebar: data.sidebar as never,
    outline: { level: [2, 4], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    search: { provider: 'local' },
    footer: {
      message: '由 VitePress 驱动 · 内容来自私有仓库白名单',
      copyright: `© ${new Date().getFullYear()}`,
    },
  },
})
