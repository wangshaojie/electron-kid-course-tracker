#!/usr/bin/env node
/**
 * release.mjs —— 一键发版
 *
 * 流程：
 *   1. 校验工作树干净（没有未提交改动，避免 version bump 漏掉文件）
 *   2. pnpm version <level>  → bump desktop/package.json
 *   3. 询问 / 默认 y，git commit + git tag + git push
 *
 * 用法：
 *   pnpm release                # 交互式（major/minor/patch 选择）
 *   pnpm release patch          # 直跳 patch bump
 *   pnpm release minor
 *   pnpm release major
 *   pnpm release 1.2.3          # 直跳指定版本
 *
 * 推到远端后，.github/workflows/release.yml 会自动跑 CI：
 *   - 装依赖 / 类型检查
 *   - vite build + electron main build（带 VITE_* env）
 *   - electron-builder 打 NSIS + portable 两份 .exe
 *   - softprops/action-gh-release 创建 GitHub Release 并上传 .exe 资产
 *
 * ⚠️ 重要：package.json 的 version 字段是 electron-builder 命名产物的依据
 *   tag 推上去了再改 version 会发布到错的 release（见 AGENTS.md "打 release"）
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const pkgPath = resolve(repoRoot, 'desktop/package.json')

// ---- 工具函数 ----
/**
 * 跑子命令。
 * 默认走 shell=true（Windows 兼容 pnpm/npm 这种 .ps1 / .cmd 包装器），
 * 但 `git commit -m "msg with: colon"` 这种带特殊字符的不能进 shell 解析
 * —— cmd.exe 把 `:` 当 label 起始，会把消息截断报 "pathspec did not match"。
 * 所以对 git / node 这种原生 .exe 命令，调用方传 `{ shell: false }` 走 CreateProcess。
 */
function run(cmd, args, opts = {}) {
  const useShell = opts.shell ?? true
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? repoRoot,
    shell: useShell,
    ...opts,
  })
  if (r.status !== 0) {
    console.error(`\n❌ 命令失败: ${cmd} ${args.join(' ')} (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
  return r
}

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, 'utf8'))
}

function gitStatus() {
  const r = spawnSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    cwd: repoRoot,
    shell: process.platform === 'win32',
  })
  return r.stdout?.trim() ?? ''
}

function gitCurrentBranch() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    cwd: repoRoot,
    shell: process.platform === 'win32',
  })
  return r.stdout?.trim() ?? ''
}

function gitLogOneline(n = 10) {
  const r = spawnSync('git', ['log', '--oneline', `-n`, String(n)], {
    encoding: 'utf8',
    cwd: repoRoot,
    shell: process.platform === 'win32',
  })
  return r.stdout?.trim() ?? ''
}

async function confirm(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const ans = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(ans.trim())
  } finally {
    rl.close()
  }
}

// ---- 主流程 ----
async function main() {
  const arg = process.argv[2] ?? ''

  // 0) 校验工作树干净
  const dirty = gitStatus()
  if (dirty) {
    console.error('\n❌ 工作树不干净，请先 commit 所有改动：\n')
    console.error(dirty)
    console.error('\n提示：导出改动等本次 release 内容要么一起 commit 进 release commit，')
    console.error('      要么先 stash / reset 掉，避免漏提交。')
    process.exit(1)
  }

  // 1) 解析 bump level
  const validLevels = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease']
  let level
  if (!arg) {
    // 交互式
    const rl = readline.createInterface({ input: stdin, output: stdout })
    console.log('\n选择 bump 类型：')
    console.log('  1) patch      (1.2.3 → 1.2.4)  // bug fix')
    console.log('  2) minor      (1.2.3 → 1.3.0)  // 新功能')
    console.log('  3) major      (1.2.3 → 2.0.0)  // 不兼容改动')
    const ans = await rl.question('\n输入 1/2/3 或 patch/minor/major: ')
    rl.close()
    const map = { '1': 'patch', '2': 'minor', '3': 'major' }
    level = map[ans.trim()] ?? ans.trim()
  } else {
    level = arg
  }

  // 支持直跳指定版本（pnpm version 1.2.3 这种语义本身支持）
  const isExplicitVersion = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(level)
  if (!isExplicitVersion && !validLevels.includes(level)) {
    console.error(`\n❌ 未知 bump 类型: ${level}`)
    console.error(`合法: ${validLevels.join(', ')} 或具体版本号 (1.2.3)`)
    process.exit(1)
  }

  const before = readPkg()
  console.log(`\n当前 version: ${before.version}`)

  // 2) bump version（pnpm version 会自动改 package.json + 跑 lifecycle scripts）
  // 切到 desktop 目录跑 pnpm version —— 之前写 --filter course-tracker 是想走 pnpm
  // workspace 过滤，但本仓库根本没有 pnpm-workspace.yaml（结构是单包，desktop/ 嵌套只是
  // 目录结构），pnpm 会把 --filter 透传给 npm 触发 "Unknown cli config" → EUSAGE。
  // 用 cwd 切目录是最直接的修法，不走 shell 拼接。
  run('pnpm', ['version', level, '--no-git-tag-version'], { cwd: resolve(repoRoot, 'desktop') })

  const after = readPkg()
  const newVersion = after.version
  console.log(`新   version: ${newVersion}`)

  if (before.version === newVersion) {
    console.error('\n❌ version 没变，bump 失败')
    process.exit(1)
  }

  // 3) 显示接下来要做的动作 + 确认
  const branch = gitCurrentBranch()
  const tag = `v${newVersion}`
  const recent = gitLogOneline(5)
  console.log('\n──────────── 接下来要执行 ────────────')
  console.log(`  git add  -A`)
  console.log(`  git commit -m "release: v${newVersion}"`)
  console.log(`  git tag   ${tag}`)
  console.log(`  git push  origin ${branch} --tags`)
  console.log(`\n最近 5 条 commit:`)
  console.log(recent.split('\n').map((l) => `  ${l}`).join('\n'))
  console.log('─────────────────────────────────────\n')

  const ok = await confirm(`确认发版 ${tag}?`)
  if (!ok) {
    console.log('\n已取消。要回滚 version 改动：')
    console.log(`  git checkout -- desktop/package.json`)
    process.exit(0)
  }

  // 4) commit + tag + push
  // git 系列走 shell=false：commit -m 的 message 含 ":" 在 cmd shell 解析下会被当作 label 截断
  // tag / push / add 也都用 array 直传，干净安全
  run('git', ['add', '-A'], { shell: false })
  run('git', ['commit', '-m', `release: v${newVersion}`], { shell: false })
  run('git', ['tag', tag], { shell: false })
  run('git', ['push', 'origin', branch], { shell: false })
  run('git', ['push', 'origin', tag], { shell: false })

  console.log(`\n✅ 已推 tag ${tag} 到 origin`)
  console.log(`\n下一步：去 GitHub Actions 页面观察 release 工作流：`)
  console.log(`  https://github.com/<owner>/<repo>/actions`)
  console.log(`\nCI 跑完会自动创建 GitHub Release 并附上 .exe 资产：`)
  console.log(`  https://github.com/<owner>/<repo>/releases/tag/${tag}\n`)
}

main().catch((e) => {
  console.error('\n❌', e)
  process.exit(1)
})
