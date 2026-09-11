/**
 * 版本更新 —— 统一策略：
 *   不管是 NSIS 安装版还是 portable 绿色版，主进程都用 Electron net.request
 *   + fs 直接把 .exe 装包下载到 %TEMP%\TimeWell-update\，下载过程中把进度
 *   推给渲染端（渲染端弹"下载进度弹框"），下载完成后推 localPath 给渲染端。
 *   渲染端点"重启并安装" → 主进程退出 + 拉起安装包（见 restartAndInstall）。
 *   失败时回退到"前往 GitHub Release 页面"。
 *
 * 为什么用 net.request 而不是 node:https：
 *   挂系统代理（v2rayN/clash 之类 127.0.0.1:xxxx）时，浏览器能访问 GitHub
 *   但 node:https 直连不读系统代理，主进程会卡在 TLS 握手 → 渲染端一直停在
 *   "正在连接下载源…"。net.request 走 Chromium 网络栈，自动用系统代理。
 *
 * 历史：v0.4.4 之前 NSIS 走 electron-updater 自动静默安装，但 asar 打包后
 * electron-updater → graceful-fs → fs-extra 动态 require('fs') 在 asar 里
 * 不支持，会在主进程启动时抛 "Dynamic require of 'fs' is not supported"。
 * 统一走手动下载，依赖更干净，跨两种安装形态的体验一致。
 */
import { app, BrowserWindow, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'

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

/**
 * 走 Electron net.request 而不是 node:https。
 * 原因：node:https 不会读系统代理设置，挂代理时主进程拿不到 GitHub。
 * net.request 走 Chromium 网络栈，自动用 Windows 系统代理（v2rayN/clash 那种本机代理也能命中）。
 */
function httpGet(url: string): Promise<HttpResponse | null> {
  return new Promise((resolve) => {
    try {
      const req = net.request({ method: 'GET', url })
      req.setHeader('Accept', 'application/vnd.github+json, text/html')
      req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
      const chunks: Buffer[] = []
      req.on('response', (res) => {
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
      })
      req.on('error', () => resolve(null))
      req.end()
    } catch {
      resolve(null)
    }
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
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const file = fs.createWriteStream(dest)
      const req = net.request({ method: 'GET', url })
      req.setHeader('User-Agent', 'Mozilla/5.0')
      req.on('response', (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 跟随重定向
          file.close()
          try { fs.unlinkSync(dest) } catch { /* */ }
          downloadFile(res.headers.location, dest, onProgress).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          try { fs.unlinkSync(dest) } catch { /* */ }
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let downloaded = 0
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          onProgress?.(downloaded, total)
        })
        res.on('end', () => {
          file.end()
        })
        res.on('error', (e) => {
          try { file.close() } catch { /* */ }
          try { fs.unlinkSync(dest) } catch { /* */ }
          reject(e)
        })
        // 把 net.IncomingMessage 接到 fs.WriteStream
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(downloaded)))
      })
      req.on('error', (e) => {
        try { file.close() } catch { /* */ }
        try { fs.unlinkSync(dest) } catch { /* */ }
        reject(e)
      })
      req.end()
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
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

/* ========== 重启并安装 ========== */

/**
 * 一键"重启并安装"（渲染端下载完成后的主按钮）。
 *
 * 为什么不能直接 `shell.openPath(装包)` 然后继续运行：
 *   Windows 上正在运行的 .exe 被系统锁定，NSIS 覆盖安装必然失败，而且
 *   NSIS 会检测到"应用还在运行"再弹一次让用户关掉的提示。
 * 所以顺序必须是：当前进程先退出 → 再跑装包。
 *
 * 实现：把整条链路交给一个 detached 的 cmd.exe（用 ping 当 sleep，等当前
 * 进程退干净），主进程随后 app.quit()。两种形态：
 *
 *   NSIS（静默升级，v0.5.9+）：
 *     ping ≈2s & start "" /wait "装包.exe" /S --updated & start "" "本 exe"
 *     · /S        —— NSIS 静默安装，全程不弹任何界面
 *     · 装回原路径 —— 安装器 initMultiUser 在 .onInit 里读注册表
 *                     HKCU\Software\<APP_GUID>\InstallLocation（上次装的目录）并据此
 *                     设置 $INSTDIR；静默模式没有"选择安装目录"页，所以自动装回原位置。
 *                     不用传 /D= —— 而且 cmd 自带 `start /D <dir>` 开关，传了有被吞掉的风险
 *     · --updated —— 声明这是升级：安装器的 _CHECK_APP_RUNNING 会走
 *                     "Sleep + 强杀残留进程"分支而不是弹 MessageBox，
 *                     否则静默升级会被"应用正在运行"弹窗卡住
 *     · /wait     —— cmd 等装包真正装完，再由我们 start 新版本（同一路径，文件已替换完）。
 *                     不用 --force-run：它走安装器内部的 StartApp（依赖 $launchLink），
 *                     失败时不会有任何反馈，不如自己拉起可控
 *
 *   portable：直接 start 下载好的新版 portable exe（绿色版不覆盖旧文件，
 *             用户自行替换即可）
 *
 * ★ 必须带 windowsVerbatimArguments: true（v0.5.9 修的坑）：
 *   Node 在 Windows 上拼子进程命令行时会把参数里的 " 转义成 \" 并在外层再包一层
 *   引号，而 cmd.exe 不认反斜杠转义 —— 于是 `start "" "C:\...\x.exe"` 被解析成
 *   非法路径，cmd 立刻以 "文件名、目录名或卷标语法不正确" 退出。
 *   外表现象：黑框一闪而过、安装器界面永远不出现（v0.5.8 及以前一直是这个 bug）。
 *   windowsVerbatimArguments 让 Node 原样透传参数，cmd 才能拿到上面这条命令。
 *   （不用"写临时 .cmd 再执行"的替代方案：cmd 读 .cmd 文件按 ANSI/GBK 解析，
 *    路径含中文用户名时会乱码；spawn 的参数是 UTF-16，中文路径反而安全。）
 *   v0.5.14: 微调注释，加一句"为什么 ping 而不是 timeout"
 *
 * 返回 { ok } 表示"已经安排好了"，渲染端据此显示"正在重启…"；
 * 真正的安装/重启在进程退出后由 cmd 完成。
 */
export function restartAndInstall(
  localPath: string,
  mode: UpdateMode,
): { ok: boolean; error?: string } {
  try {
    // v0.5.12: 加一行注释占位，触发 patch 发版，方便重测 v0.5.11 的 NSIS 静默升级修法
    if (!localPath || !fs.existsSync(localPath)) {
      return { ok: false, error: '安装包不存在（可能已被清理），请重新下载' }
    }

    if (process.platform !== 'win32') {
      // 非 Windows（理论上不会走到）只做"打开装包"
      //   v0.5.9 改 windowsVerbatimArguments 后只在 Windows 路径生效，macOS / Linux 走老分支
      spawn(localPath, [], { detached: true, stdio: 'ignore' }).unref()
      setTimeout(() => app.quit(), 300)
      return { ok: true }
    }

    // ping -n 3 ≈ 2s，等当前进程完全退出再动安装包
    // （不用 timeout 命令：它要求 stdin 是控制台，stdio: ignore 下会直接报错）
    const sleep = 'ping 127.0.0.1 -n 3 > nul'
    // NSIS：/S 静默安装 + --updated（升级模式，不弹"应用正在运行"）+ /wait 装完再拉起新版本
    //       "/D=" 不需要传，安装器自己从注册表读上次的安装目录
    // portable：直接 start 新版绿色版 exe
    const script = mode === 'nsis'
      ? `${sleep} & start "" /wait "${localPath}" /S --updated & start "" "${process.execPath}"`
      : `${sleep} & start "" "${localPath}"`
    console.log(`[updater] 重启并安装（${mode}）: ${script}`)
    writeRestartLog(`[${new Date().toISOString()}] restart(${mode})\n  ${script}\n`)

    spawn('cmd.exe', ['/c', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // ★ 关键：原样透传参数。少了它，命令里的引号会被 Node 转义成 \"，
      //   cmd 解析失败后立刻退出 —— 正是"黑框一闪、安装界面不出"的原因
      windowsVerbatimArguments: true,
    }).unref()

    // 给渲染端留一点时间收到 { ok } 并显示"正在重启…"，然后退出
    setTimeout(() => app.quit(), 320)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 把"重启并安装"的现场追加到 %TEMP%\TimeWell-update\restart.log。
 * 这条链路是"主进程退出后才执行"的，失败时没有 UI 能报错，只能靠日志排查。
 */
function writeRestartLog(line: string): void {
  try {
    const dir = path.join(os.tmpdir(), 'TimeWell-update')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'restart.log'), line)
  } catch { /* 日志失败不影响主流程 */ }
}

/* ========== 入口 ========== */

let started = false

/**
 * 启动时自动 check（被 started 锁保护，只跑一次）
 * @param currentOverride 当前应用版本（dev 时 app.getVersion() 不准）
 */
export async function checkForUpdates(currentOverride?: string): Promise<void> {
  if (started) return
  started = true
  if (!app.isPackaged && process.env.UPDATE_CHECK !== '1') return
  await runCheck(currentOverride)
}

/**
 * 渲染端"检测更新"按钮主动触发，绕开 started 锁。
 * 返回：
 *   - 'has-update'       发现新版本（同时已经 emit update:available 给渲染端）
 *   - 'up-to-date'       已是最新
 *   - 'failed'           网络/API 失败
 */
export async function checkForUpdatesManual(currentOverride?: string): Promise<'has-update' | 'up-to-date' | 'failed'> {
  const info = await fetchLatestRelease(currentOverride)
  if (!info) return 'failed'
  if (compareVersions(info.version, info.currentVersion) <= 0) {
    return 'up-to-date'
  }
  const mode = detectUpdateMode()
  console.log(`[updater] 手动 check 发现新版本 ${info.version}（${mode} 模式，手动下载）`)
  emit('update:available', { ...info, mode } as UpdateInfo & { mode: UpdateMode })
  return 'has-update'
}

async function runCheck(currentOverride?: string): Promise<void> {
  const info = await fetchLatestRelease(currentOverride)
  if (!info) return
  if (compareVersions(info.version, info.currentVersion) <= 0) {
    console.log(`[updater] 已是最新 ${info.currentVersion}（远端 ${info.version}）`)
    return
  }
  const mode = detectUpdateMode()
  console.log(`[updater] 启动 check 发现新版本 ${info.version}（${mode} 模式，手动下载）`)
  emit('update:available', { ...info, mode } as UpdateInfo & { mode: UpdateMode })
}
