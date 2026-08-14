/**
 * 版本更新检查 —— 启动后延迟几秒检查 GitHub 是否有新 release，
 * 有比当前版本新的 release 时通过 IPC 推给渲染端弹提示。
 *
 * 双通道获取版本号：
 *   1. GitHub REST API（releases/latest）—— 能拿到 tag + 页面地址，但匿名限额 60 次/小时
 *   2. 降级：releases/latest 网页 302 → /releases/tag/vX.Y.Z，从 Location 头解析版本号，
 *      纯网页请求不受 API 限流影响
 *
 * - public 仓库，无需 token
 * - dev 模式默认不检查；设环境变量 UPDATE_CHECK=1 可强制（用于联调）
 * - 网络失败 / 无更新 / 解析失败一律静默，不打扰用户
 */
import { app, BrowserWindow } from 'electron'
import https from 'node:https'

const REPO = 'wangshaojie/electron-kid-course-tracker'
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`

export interface UpdateInfo {
  /** 新版本号（不带 v 前缀），如 0.3.0 */
  version: string
  /** 当前运行版本 */
  currentVersion: string
  /** 原始 tag，如 v0.3.0 */
  tag: string
  /** GitHub Release 页面地址 */
  url: string
}

function parseTag(tag: string): string {
  return tag.replace(/^v/i, '').trim()
}

/** 简单 semver 数字段比较：0.2.0 < 0.2.1 < 0.10.0 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

interface HttpResponse {
  status: number
  location?: string
  body: string
}

/**
 * 主进程 GET 请求（Node 原生 https 直连，不走 Chromium 网络栈/系统代理，
 * 避免代理出口 IP 被 GitHub API 限流）。Node http 天然不跟随重定向，
 * 3xx 的 Location 头可直接读到。
 */
function httpGet(url: string): Promise<HttpResponse | null> {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          Accept: 'application/vnd.github+json, text/html',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const loc = res.headers.location
          resolve({
            status: res.statusCode ?? 0,
            location: Array.isArray(loc) ? loc[0] : loc,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => resolve(null))
      },
    )
    req.on('error', (e) => {
      console.log(`[updater] 请求失败 ${url}: ${e.message}`)
      resolve(null)
    })
  })
}

async function fetchLatestRelease(currentOverride?: string): Promise<UpdateInfo | null> {
  const current = parseTag(currentOverride ?? app.getVersion())

  // 通道 1：GitHub REST API
  const api = await httpGet(RELEASE_API)
  if (api && api.status === 200) {
    try {
      const data = JSON.parse(api.body)
      const tag: string | undefined = data?.tag_name
      if (tag) {
        return {
          version: parseTag(tag),
          currentVersion: current,
          tag,
          url: data.html_url ?? LATEST_PAGE,
        }
      }
    } catch { /* 解析失败走通道 2 */ }
  }

  // 通道 2（API 限流/失败时）：releases/latest 302 → /releases/tag/vX.Y.Z
  const page = await httpGet(LATEST_PAGE)
  if (page && page.status >= 300 && page.status < 400) {
    const tag = page.location?.split('/').pop()
    if (tag) {
      console.log(`[updater] API 不可用（HTTP ${api?.status ?? '无响应'}），改用页面重定向获取版本`)
      return {
        version: parseTag(tag),
        currentVersion: current,
        tag,
        url: LATEST_PAGE,
      }
    }
  }

  console.log(
    `[updater] 检查失败: API ${api ? `HTTP ${api.status}` : '无响应'}，页面 ${page ? `HTTP ${page.status}` : '无响应'}`,
  )
  return null
}

let checked = false

/**
 * @param currentOverride 当前应用版本（未打包时 app.getVersion() 会返回 Electron
 * 版本号而非应用版本，main.ts 应从 package.json 注入）
 */
export async function checkForUpdates(currentOverride?: string): Promise<void> {
  if (checked) return
  checked = true
  // 仅打包模式自动检查；dev 想联调可设 UPDATE_CHECK=1
  if (!app.isPackaged && process.env.UPDATE_CHECK !== '1') return

  const info = await fetchLatestRelease(currentOverride)
  if (!info) return
  if (compareVersions(info.version, info.currentVersion) <= 0) {
    console.log(`[updater] 已是最新版本 ${info.currentVersion}（远端 ${info.version}）`)
    return
  }
  console.log(`[updater] 发现新版本 ${info.version} → ${info.url}`)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:available', info)
  }
}
