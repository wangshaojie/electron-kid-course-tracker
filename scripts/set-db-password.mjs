#!/usr/bin/env node
/**
 * 更新本地数据库密码，并把新的完整连接串复制到剪贴板
 * --------------------------------------------------------------
 * 用途：Supabase 后台轮换数据库密码后，同步本地 vercel/.env.local，
 *       并生成可直接粘贴到 Vercel Environment Variables 的新连接串。
 *
 * 用法：
 *   node scripts/set-db-password.mjs
 *   （输入新密码，输入过程不回显；完成后新连接串已在剪贴板里）
 *
 * 非交互（CI/脚本）：
 *   "新密码" | node scripts/set-db-password.mjs
 *
 * 安全：
 *   - 密码只写本地 vercel/.env.local，不打印、不联网、不进任何日志
 *   - 连接串打印时密码一律打码
 *   - 只替换连接串里的密码段，用户名/主机/端口/库名/参数原样保留
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, 'vercel', '.env.local')

// ---- 读取当前连接串 ----
const raw = readFileSync(ENV_FILE, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

const lineIdx = lines.findIndex((l) => l.trim().startsWith('DATABASE_URL='))
if (lineIdx < 0) {
  console.error(`✗ ${path.relative(ROOT, ENV_FILE)} 里没有 DATABASE_URL`)
  process.exit(1)
}
const prefix = 'DATABASE_URL='
const curUrl = lines[lineIdx].trim().slice(prefix.length)

if (!/^[a-z0-9+.-]+:\/\//i.test(curUrl)) {
  console.error('✗ 当前 DATABASE_URL 不是合法连接串')
  process.exit(1)
}

// 拆出 协议 / 用户名 / 密码 / 其余
const schemeEnd = curUrl.indexOf('://') + 3
const at = curUrl.lastIndexOf('@')
const colon = curUrl.indexOf(':', schemeEnd)
if (at < 0 || colon < 0 || colon > at) {
  console.error('✗ 当前 DATABASE_URL 结构异常（找不到 用户名:密码@主机）')
  process.exit(1)
}
const userPart = curUrl.slice(schemeEnd, colon)
const hostPart = curUrl.slice(at) // @host:port/db?params

function redact(u) {
  const c = u.indexOf(':', u.indexOf('://') + 3)
  const a = u.lastIndexOf('@')
  return `${u.slice(0, c + 1)}***${u.slice(a)}`
}

console.log('=== 更新本地数据库密码 ===')
console.log(`文件     : ${path.relative(ROOT, ENV_FILE)}`)
console.log(`当前连接 : ${redact(curUrl)}`)
console.log(`用户名   : ${userPart}（保持不变）`)
console.log('')

// ---- 读取新密码（隐藏输入）----
async function readPassword() {
  if (!process.stdin.isTTY) {
    // 管道输入：整段 stdin 当密码
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }

  // TTY：逐字符读，屏蔽回显
  const rl = await import('node:readline')
  const stdin = process.stdin
  const output = process.stdout
  let value = ''
  output.write('请输入新的数据库密码（输入不回显）: ')

  await new Promise((resolve) => {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          output.write('\n')
          resolve()
          return
        }
        if (ch === '\u0003' || ch === '\u0004') {
          // Ctrl+C / Ctrl+D
          stdin.setRawMode(false)
          output.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1)
            output.write('\b \b')
          }
          continue
        }
        value += ch
        output.write('*')
      }
    }
    stdin.on('data', onData)
  })
  void rl
  return value
}

const newPass = (await readPassword()).trim()
if (!newPass) {
  console.error('✗ 密码为空，未做任何修改')
  process.exit(1)
}

// ---- 拼新的连接串（只换密码段，特殊字符做百分号编码）----
const newUrl = `${curUrl.slice(0, colon + 1)}${encodeURIComponent(newPass)}${hostPart}`

// ---- 写回文件（只改这一行，其余字节原样）----
const nextLines = [...lines]
nextLines[lineIdx] = `${prefix}${newUrl}`
let next = nextLines.join(eol)
if (raw.endsWith('\n') && !next.endsWith('\n')) next += eol
writeFileSync(ENV_FILE, next, 'utf8')

// ---- 复制到剪贴板 ----
const skipClip = process.env.KCT_SKIP_CLIP === '1'
const copied = skipClip ? { status: 1 } : spawnSync('clip', [], { input: newUrl, encoding: 'utf8', shell: true })
const ok = copied.status === 0

console.log('✓ vercel/.env.local 已更新（密码未回显、未打印）')
console.log(`  新连接 : ${redact(newUrl)}`)
if (ok) {
  console.log('\n📋 新的完整连接串已复制到剪贴板 → 到 Vercel 的 DATABASE_URL「Value」框里直接粘贴（Ctrl+V）')
} else {
  console.log('\n⚠️ 复制到剪贴板失败，请手动从 vercel/.env.local 第 1 行复制 "DATABASE_URL=" 后面的内容')
}
console.log('\n接下来：')
console.log('  1. Vercel → electron-kid-course-tracker → Settings → Environment Variables → DATABASE_URL → Edit')
console.log('     · Value 框粘贴上面的连接串（不要留空直接 Save）')
console.log('     · Type 保持 Secret，Environments 保持 Production')
console.log('  2. Save → 到 Deployments 页对 Production 部署点 Redeploy')
console.log('  3. 回来跑 node scripts/check-db.mjs 验证')
