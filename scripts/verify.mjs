#!/usr/bin/env node
/**
 * 冒烟测试：拿 examples/fixture-vault 跑一遍同步，确认白名单真的挡得住。
 * 输出到 .tmp/verify-docs，不会污染 docs/。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT = path.join(ROOT, '.tmp', 'verify-docs')

fs.rmSync(OUT, { recursive: true, force: true })

execFileSync(process.execPath, ['scripts/sync.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    CONTENT_DIR: 'examples/fixture-vault',
    DOCS_DIR: '.tmp/verify-docs',
  },
  stdio: 'inherit',
})

const mustExist = [
  'index.md',
  'archive.md',
  'posts/index.md',
  'posts/hello-world.md',
  'posts/2024-03-01-second.md',
  'notes/中文笔记.md',
  'attachments/pic one.svg',
  '.vitepress/generated/posts.json',
]

const mustNotExist = [
  'posts/secret-note.md',
  'notes/private/diary.md',
  'notes/private/',
  '.obsidian/app.json',
  '.blogignore',
]

let failed = 0
for (const rel of mustExist) {
  if (!fs.existsSync(path.join(OUT, rel))) {
    console.error(`❌ 应该存在但没有：${rel}`)
    failed++
  }
}
for (const rel of mustNotExist) {
  if (fs.existsSync(path.join(OUT, rel))) {
    console.error(`❌ 不该发布却出现了：${rel}`)
    failed++
  }
}

// 泄露内容抽查：草稿里的标记词不能出现在任何产物里
const leak = 'SECRET_TOKEN_SHOULD_NOT_LEAK'
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs)
    else if (fs.readFileSync(abs, 'utf8').includes(leak)) {
      console.error(`❌ 草稿内容泄露到：${path.relative(OUT, abs)}`)
      failed++
    }
  }
}
walk(OUT)

// 双链降级：未发布目标的标题不应该变成链接
const hello = fs.readFileSync(path.join(OUT, 'posts/hello-world.md'), 'utf8')
if (hello.includes('secret-note](')) {
  console.error('❌ 指向未发布笔记的双链没有被降级')
  failed++
}

if (failed) {
  console.error(`\n❌ 冒烟测试失败：${failed} 项\n`)
  process.exit(1)
}
console.log('\n✅ 冒烟测试通过：白名单外的东西一个都没发布\n')
