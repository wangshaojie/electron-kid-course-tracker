/**
 * 版本更新 —— 统一策略：
 *   不管是 NSIS 安装版还是 portable 绿色版，主进程都用 https + fs 直接把
 *   .exe 装包下载到 %TEMP%\TimeWell-update\，下载完成后推 localPath 给
 *   渲染端，渲染端弹"立即打开安装包"按钮。
 *   失败时回退到"前往 GitHub Release 页面"。
 *
 * 历史：v0.4.4 之前 NSIS 走 electron-updater 自动静默安装，但 asar 打包后
 * electron-updater → graceful-fs → fs-extra 动态 require('fs') 在 asar 里
 * 不支持，会在主进程启动时抛 "Dynamic require of 'fs' is not supported"。
 * 统一走手动下载，依赖更干净，NSIS 用户体验退化为"下载 → 双击安装"，
 * 但跨两种安装形态的体验一致、也避免了 electron-updater 的多个 asar 坑
 * (winCodeSign / latest.yml 缺失等)。
 */
import { app, BrowserWindow } from 'electron'
import https from 'node:https'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const REPO = 'wangshaojie/electron-kid-course-tracker'
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`

/** 给渲染端看的更新信息（轻量版，主进程手写下载不引第三方类型） */
export interface UpdateInfo {
  /** 新版本号（不带 v 前缀） */
  version: string
  /** 当前运行版本 */
  currentVersion: string
  /** 原始 tag，如 v0.3.0 */
  tag: string
  /** GitHub Release 页面地址 */
  url: string
  /** 更新通道：'nsis' = NSIS installer 模式（下载后双击装包）；'portable' = portable 模式（下载后双击替换运行） */
  mode?: 'nsis' | 'portable'
  /** 下载下来的 .exe 本地路径（仅 manual fallback 时有值） */
  localPath?: string
  /** 文件大小（字节） */
  size?: number
}

/** 进度推送 */
export interface UpdateProgress {
  percent: number
  bytesPerSecond?: number
  transferred: number
  total: number
}

/** 下载完成推送 */
export interface UpdateDownloaded {
  version: string
  localPath?: string
  size?: number
}

/** 错误推送（携带 fallback 信息） */
export interface UpdateError {
  message: string
  /** 当 fallback=openExternal 时，渲染端应回退到"前往下载"按钮 */
  fallback?: 'openExternal'
  url?: string
}

/** 检查模式：nsis 走自动安装；portable 走"下载到 %TEMP% 提示打开" */
export type UpdateMode = 'nsis' | 'portable'

function parseTag(tag: string): string {
  return tag.replace(/^v/i, '').trim()
}

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
        res.on('data', (c) => chunks.push(Buffer.from(c)))
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
    req.on('error', () => resolve(null))
  })
}

interface GhReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GhRelease {
  tag_name: string
  html_url: string
  assets: GhReleaseAsset[]
}

async function fetchLatestRelease(currentOverride?: string): Promise<UpdateInfo | null> {
  const current = parseTag(currentOverride ?? app.getVersion())

  const api = await httpGet(RELEASE_API)
  if (api && api.status === 200) {
    try {
      const data: GhRelease = JSON.parse(api.body)
      if (data.tag_name) {
        return {
          version: parseTag(data.tag_name),
          currentVersion: current,
          tag: data.tag_name,
          url: data.html_url ?? LATEST_PAGE,
        }
      }
    } catch { /* 走通道 2 */ }
  }

  const page = await httpGet(LATEST_PAGE)
  if (page && page.status >= 300 && page.status < 400) {
    const tag = page.location?.split('/').pop()
    if (tag) {
      return {
        version: parseTag(tag),
        currentVersion: current,
        tag,
        url: LATEST_PAGE,
      }
    }
  }
  return null
}

/** 解析当前是 nsis 装包还是 portable。dev 走 portable 路径。 */
export function detectUpdateMode(): UpdateMode {
  // electron-builder 给 nsis 装包设置 portable 标记。
  // dev 模式 isPackaged=false 也走 portable 分支（去 GitHub 下载）
  if (!app.isPackaged) return 'portable'
  // 装包名是 EXE（installer）+ 同目录有 Uninstaller，就当 NSIS
  // portable 模式 process.env.PORTABLE_EXECUTABLE_DIR 会被 electron-builder 设置
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable'
  return 'nsis'
}

/** 推给渲染端的统一通道 */
function emit(event: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload)
  }
}

/* ========== 统一通道：手写 https 下载 .exe 到 %TEMP% ========== */

function pickPortableAsset(release: GhRelease, version: string): GhReleaseAsset | null {
  // 命名规则：TimeWell-${version}-portable-x64.exe
  const targetName = `TimeWell-${version}-portable-x64.exe`
  return release.assets.find((a) => a.name === targetName)
    ?? release.assets.find((a) => a.name.includes('portable') && a.name.endsWith('.exe'))
    ?? null
}

function pickNsisInstallerAsset(release: GhRelease, version: string): GhReleaseAsset | null {
  const targetName = `TimeWell-${version}-x64.exe`
  return release.assets.find((a) => a.name === targetName)
    ?? release.assets.find((a) => a.name.endsWith('.exe') && !a.name.includes('portable') && !a.name.includes('blockmap'))
    ?? null
}

function downloadFile(url: string, dest: string, onProgress?: (downloaded: number, total: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const u = new URL(url)
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 跟随重定向
          file.close()
          fs.unlinkSync(dest)
          downloadFile(res.headers.location, dest, onProgress).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlinkSync(dest)
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let downloaded = 0
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          onProgress?.(downloaded, total)
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(downloaded)))
      },
    )
    req.on('error', (e) => {
      try { file.close() } catch { /* */ }
      try { fs.unlinkSync(dest) } catch { /* */ }
      reject(e)
    })
  })
}

/** portable 模式：直接下 .exe 到 %TEMP%，进度推给渲染端，下载完推 path 让它弹"立即打开" */
export async function startManualDownload(info: UpdateInfo, mode: 'portable' | 'fallback'): Promise<void> {
  try {
    // 重新查 release 拿 assets 列表（之前 UpdateInfo 只有 url）
    const api = await httpGet(RELEASE_API)
    if (!api || api.status !== 200) throw new Error(`release API HTTP ${api?.status ?? '无响应'}`)
    const release: GhRelease = JSON.parse(api.body)
    const asset = mode === 'portable'
      ? pickPortableAsset(release, info.version)
      : pickNsisInstallerAsset(release, info.version)
    if (!asset) throw new Error('release 里没找到对应的 .exe asset')

    const destDir = path.join(os.tmpdir(), 'TimeWell-update')
    fs.mkdirSync(destDir, { recursive: true })
    const dest = path.join(destDir, asset.name)

    console.log(`[updater:manual] 下载 ${asset.browser_download_url} → ${dest}`)
    const total = await downloadFile(asset.browser_download_url, dest, (downloaded, t) => {
      emit('update:progress', {
        percent: t > 0 ? (downloaded / t) * 100 : 0,
        transferred: downloaded,
        total: t,
      })
    })

    emit('update:downloaded', {
      version: info.version,
      localPath: dest,
      size: total,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[updater:manual] 下载失败: ${msg}`)
    emit('update:error', { message: msg, fallback: 'openExternal', url: info.url })
  }
}

/* ========== 入口 ========== */

let started = false

/**
 * @param currentOverride 当前应用版本（dev 时 app.getVersion() 不准）
 */
export async function checkForUpdates(currentOverride?: string): Promise<void> {
  if (started) return
  started = true
  if (!app.isPackaged && process.env.UPDATE_CHECK !== '1') return

  const mode = detectUpdateMode()
  const info = await fetchLatestRelease(currentOverride)
  if (!info) return
  if (compareVersions(info.version, info.currentVersion) <= 0) {
    console.log(`[updater] 已是最新 ${info.currentVersion}（远端 ${info.version}）`)
    return
  }

  // 不管 NSIS 还是 portable，统一走 manual 下载：
  // NSIS 模式选 installer .exe，portable 模式选 portable .exe
  console.log(`[updater] 发现新版本 ${info.version}（${mode} 模式，手动下载）`)
  emit('update:available', { ...info, mode } as UpdateInfo & { mode: UpdateMode })
}
