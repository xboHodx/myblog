import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import mathjax3 from 'markdown-it-mathjax3'

const here = path.dirname(fileURLToPath(import.meta.url))

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
  // 仓库名决定这个前缀：username.github.io/<repo>/
  // 仓库名决定前缀：username.github.io/<repo>/；仓库变量 BASE_PATH 可覆盖
  base: process.env.BASE_PATH || '/myblog/',
  cleanUrls: false,
  ignoreDeadLinks: false,
  lastUpdated: false,

  markdown: {
    image: { lazyLoading: true },
    theme: { light: 'github-light', dark: 'github-dark' },
    // Obsidian 笔记里的 $$...$$ / $...$ 用 MathJax 在构建期转成静态 SVG
    config: (md) => md.use(mathjax3),
  },

  // MathJax 输出的是 <mjx-container> 这类自定义标签。
  // 不声明 isCustomElement，Vue 会把它们当未注册组件，SSR 直接渲染成 <!---->，
  // 公式会整段消失（这个坑查了很久）。
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag: string) => tag.startsWith('mjx-'),
      },
    },
  },

  sitemap: {
    hostname: process.env.SITE_ORIGIN || 'https://example.github.io',
  },

  themeConfig: {
    nav: data.nav,
    sidebar: data.sidebar as never,
    outline: { level: [2, 3], label: '本页目录' },
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
