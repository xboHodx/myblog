import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { katex } from '@mdit/plugin-katex'

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
  // 仓库名决定这个前缀：username.github.io/<repo>/；仓库变量 BASE_PATH 可覆盖
  base: process.env.BASE_PATH || '/myblog/',
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
    hostname: process.env.SITE_ORIGIN || 'https://example.github.io',
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
