# myblog

VitePress 博客，内容来自**私有仓库**，通过 GitHub Actions 同步后发布到 GitHub Pages。

私有仓库里放 `.blogignore` 作为**发布白名单**：写进去的才发布，没写的一律不发布。

---

## 目录结构

```
.
├── .github/workflows/deploy.yml   # 拉私有仓库 → 同步 → 构建 → 发 Pages
├── docs/
│   ├── .vitepress/config.mts      # 站点配置（导航/侧边栏读生成的数据）
│   ├── .vitepress/theme/          # 主题与自定义样式
│   ├── .vitepress/generated/      # sync 生成，已 gitignore
│   └── **/*.md                    # sync 生成，已 gitignore（内容不在 git 里）
├── scripts/
│   ├── sync.mjs                   # 白名单 → docs/ + 导航数据
│   ├── verify.mjs                 # 冒烟测试：确认草稿没被发布
│   └── lib/{blogignore,obsidian,render}.mjs
├── examples/
│   ├── fixture-vault/             # 测试用假仓库（Obsidian 结构）
│   └── private-repo-notify.yml    # 放到私有仓库的触发 workflow
└── .blogignore.example            # 白名单模板
```

## 一次性配置

### 1. 私有内容仓库

放一个 `.blogignore` 在**仓库根目录**（可以从 `.blogignore.example` 复制）：

```gitignore
# 写进来的才发布
posts/
notes/
attachments/
about.md

# 白名单里的例外
!notes/private/
```

> 这个文件缺失时构建会直接失败，这是故意的：宁可流水线红，也不要"没规则=全发布"。

### 2. 博客仓库的变量和密钥

Settings → Secrets and variables → Actions：

| 类型 | 名称 | 必填 | 值 |
| --- | --- | --- | --- |
| Variable | `CONTENT_REPO` | ✅ | `你的用户名/私有内容仓库` |
| Secret | `CONTENT_TOKEN` | ✅ | 能**只读**访问私有内容仓库的 PAT |
| Variable | `BASE_PATH` | 建议 | 站点前缀，默认 `/myblog/`；仓库名不叫 myblog 就改这里 |
| Variable | `SITE_TITLE` | 建议 | 站点名，默认「我的博客」 |
| Variable | `SITE_TAGLINE` | 可选 | 副标题 |
| Variable | `SITE_TEXT` | 可选 | 首页 hero 正文 |
| Variable | `SITE_ORIGIN` | 可选 | 站点域名，用于 sitemap，如 `https://你的用户名.github.io` |
| Variable | `CONTENT_REF` | 可选 | 内容仓库分支；不填就跟随该仓库的默认分支 |

站点名走变量，不用改代码。

`CONTENT_TOKEN` 建议用 fine-grained PAT，只授权那一个私有仓库，权限只给 `Contents: Read`。

### 3. 打开 Pages

Settings → Pages → Source 选 **GitHub Actions**。（不要选 "Deploy from a branch"。）

### 4. 私有仓库 push 后自动触发

默认情况下，往私有仓库 push **不会**触发博客仓库的 workflow。需要两个仓库各配一次：

1. 把 `examples/private-repo-notify.yml` 复制到私有仓库的 `.github/workflows/notify-blog.yml`
2. 私有仓库配：
   - 变量 `BLOG_REPO` = `你的用户名/myblog`
   - secret `BLOG_DISPATCH_TOKEN` = 能对**博客仓库**发 dispatch 的 PAT（细粒度：只选博客仓库，`Contents: Read and write`；经典 PAT：`repo`）

它通过 `repository_dispatch`（事件类型 `content-update`）触发 `deploy.yml`。注意 dispatch 只认**默认分支**上的 workflow 文件，所以 `deploy.yml` 要先合进 `main`。

## 本地开发

```bash
npm install

# 指向你的私有仓库（clone 到 content/ 的话可以省略 CONTENT_DIR）
CONTENT_DIR=/path/to/private-vault npm run sync
npm run dev            # http://localhost:5173/myblog/

npm run verify         # 白名单冒烟测试，不需要真实仓库
npm run docs:build     # 产物在 docs/.vitepress/dist
```

`npm run sync` 会：

1. 读 `$CONTENT_DIR/.blogignore`
2. 只把白名单命中的文件复制进 `docs/`（`.md` 做 Obsidian 语法转换，附件原样复制）
3. 生成 `docs/index.md`（首页）、`docs/archive.md`（归档）、每个一级目录的 `docs/<分类>/index.md`
4. 写 `.vitepress/generated/posts.json`（导航、侧边栏、文章列表）
5. 删掉上一次生成、这次不再生成的文件（从白名单删掉的笔记不会残留）

## `.blogignore` 语义

和 `.gitignore` **语法相同、方向相反**：

| 写法 | 含义 |
| --- | --- |
| `posts/` | 发布整个目录 |
| `notes/*.md` | 发布匹配的文件 |
| `!notes/private/` | 从白名单里剔除 |
| `# 注释` | 忽略 |

下面这些永远不发布，即使白名单里写了：`.git`、`.github`、`.obsidian`、`.trash`、`node_modules`、`.blogignore`、`.DS_Store`、符号链接。

## 支持的 Obsidian 语法

| 写法 | 结果 |
| --- | --- |
| `[[笔记]]`、`[[笔记\|别名]]`、`[[笔记#标题]]` | 转成站内链接，锚点与 VitePress 的 slug 对齐 |
| `![[图片.png]]`、`![[图片.png\|300]]` | 转成图片（带宽度时用 `<img>`） |
| `![[笔记]]` | 笔记嵌入降级为链接（VitePress 不支持 transclusion） |
| `%%注释%%` | 删除 |
| `==高亮==` | `<mark>` |
| `> [!note]` / `[!warning]` 等 | 转成 VitePress 的 `::: tip` / `::: warning` / `::: danger` |
| 文件名里的日期 `2024-01-02-xxx.md` | 作为文章日期 |

**指向白名单之外的双链会被降级成纯文本**——否则等于把未发布笔记的标题泄露到公开站点上。构建时会打警告，方便你判断是"忘了加白名单"还是"本来就不该链"。

## 已知取舍

- **文章日期**：`actions/checkout` 拉下来的文件 mtime 全是同一时刻，所以**不能**按文件修改时间排序。用 frontmatter 的 `date` / `created`，或文件名 `YYYY-MM-DD-` 前缀；都没有会排在最后并告警。
- **图片必须在白名单里**。图片没被发布时 VitePress 构建会因找不到文件直接失败（`ignoreDeadLinks: false`）——这是有意的，避免线上出现裂图。
- **URL 带 `.html`**：`cleanUrls: false`，GitHub Pages 上最稳。中文和空格的路径会被浏览器自动百分号编码。
- **根目录的 `index.md` 会被跳过**，因为首页是自动生成的；想发就改名成 `about.md`。
- **`draft: true`** 的笔记即使命中白名单也会跳过。
- 笔记内链用 Obsidian 双链即可；手写相对链接请用 `.md` 结尾，VitePress 会改写成正确 URL 并做死链检查。

## 排查

| 现象 | 原因 |
| --- | --- |
| `找不到 .../.blogignore` | 私有仓库根目录缺文件，或 `CONTENT_DIR` 指错了 |
| `Input required and not supplied: token` | `CONTENT_TOKEN` 没配，或 PAT 过期/没授权该仓库 |
| `白名单没有匹配到任何文件` | 规则里的路径不是相对内容仓库根目录 |
| 页面 404 | `BASE_PATH` 与仓库名不一致（默认 `/myblog/`） |
| 部署没触发 | 私有仓库的 dispatch workflow 没配，或 `deploy.yml` 不在默认分支 |
| 图片构建失败 | 图片目录没进白名单 |
