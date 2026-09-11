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
import https from 'node:https'

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
 * 走 Node 原生 https 而不是 Electron net.request。
 *
 * 为什么不走 net.request（看起来更"现代化"）：
 *   net.request 走 Chromium 网络栈，命中 Windows 系统代理（v2rayN/clash 那种
 *   127.0.0.1 出口）。GitHub 匿名 API 在这个出口 IP 上容易被 403 限流，
 *   即使代理本身没问题，net.request 一返回 403，httpGet 就 resolve(null)，
 *   整个版本检查直接挂。现象：渲染端"检测更新"按钮一直报"网络错误，请检查
 *   网络后重试"。
 *
 * 为什么不担心丢代理：
 *   实测下来，Node 原生 https 在这台机器上直连 api.github.com 是 OK 的；
 *   真要翻墙的用户也会让 GitHub 在系统代理白名单里。极少数"必须走代理才
 *   能上 GitHub"的环境，再回退到 net.request 也不迟——优先解决"中国家庭
 *   宽带直连时被误判 403"这个常见 case。
 *
 * 历史：v0.4.4 之前是 node:https 跑的，运行良好；中途有人改成 net.request
 * 看似更"Electron 一点"，但代价是踩进 403 限流坑。这里回滚到 node:https。
 */
function httpGet(url: string): Promise<HttpResponse | null> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const opts: https.RequestOptions = {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || '443',
        path: u.pathname + u.search,
        headers: {
          // 通道 1（releases API）需要这个 Accept；通道 2（releases/latest 跳板）会忽略
          'Accept': 'application/vnd.github+json, text/html',
          'User-Agent': 'TimeWell-Updater/1.0',
        },
      }
      const req = https.request(opts, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const loc = res.headers['location']
          resolve({
            status: res.statusCode ?? 0,
            location: Array.isArray(loc) ? loc[0] : loc,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => resolve(null))
      })
      req.on('error', () => resolve(null))
      req.setTimeout(8000, () => {
        req.destroy()
        resolve(null)
      })
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
 *   NSIS（带界面安装，v0.5.20 起）：
 *     ping ≈2s & start "" /wait "装包.exe" --updated
 *     · 不带 /S   —— v0.5.17~v0.5.19 是静默升级（/S），问题是静默装一旦失败
 *                     用户完全无感：app 已经退出、没有界面、也没有任何报错，
 *                     看起来就是"点了按钮，程序关了又开，版本没变"。
 *                     改成正常弹安装向导（build.nsis 本来就是 oneClick: false
 *                     的向导式安装器），用户自己点"下一步 → 安装 → 完成"，
 *                     装没装上一眼可见，被杀软/权限拦下也当场能看到。
 *     · --updated —— 声明这是升级：安装器 .onInit 读注册表
 *                     HKCU\Software\<APP_GUID>\InstallLocation（上次的安装目录）
 *                     设置 $INSTDIR，装回原位置；_CHECK_APP_RUNNING 也不会再弹
 *                     "应用正在运行"的框（走 Sleep + 强杀残留进程分支）。
 *                     不用传 /D= —— 而且 cmd 自带 `start /D <dir>` 开关，传了有被吞掉的风险
 *     · 装完启动 —— 交给安装器自己做：assistedInstaller.nsh 的完成页有
 *                     MUI_FINISHPAGE_RUN（"运行 一寸光阴"默认勾选），点"完成"
 *                     后 StartApp 用 StdUtils.ExecShellAsUser 以当前登录用户身份
 *                     拉起 $launchLink（提升过的安装器也不会把 app 带成管理员）。
 *                     ★ 我们自己不再 start 一遍：应用没有单实例锁，两边都拉
 *                       会开出两个窗口。
 *     · /wait     —— 只为等安装器结束、把退出码写进 restart.log
 *                     （0=装完，1602/1223=用户取消/拒绝 UAC），便于售后排查
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
 *   v0.5.17: 改用临时 .bat 跑 sleep+start。上一版是把整段 script 拼成
 *     `ping ... > nul & start ...` 一次性 cmd /c 跑，但 windowsVerbatimArguments
 *     + Node 自动给 script 加首尾引号 → cmd 把 > 字面化（不当重定向），ping
 *     回显就漏到控制台（用户看到黑框）。临时 .bat 不会被外层引号吞重定向。
 *
 * ★ v0.5.20：.bat 里的路径改走环境变量 TW_SETUP / TW_SELF，argv 只留 batPath 本身。
 *   旧写法 `spawn('cmd.exe', ['/c', batPath, ...batArgs])` 把 batPath 传了两次，
 *   于是 bat 的 %1 拿到的是 .bat 自己而不是装包路径，nsis 分支变成
 *     `start "" /wait "<同一个 .bat>" /S --updated` → 递归拉起自己：
 *       · start 的目标是 .bat 时走的是 `%COMSPEC% /K "<file>"`（实测确认），
 *         /K 的窗口**跑完也不退出** → 用户看到黑框 + ping 127.0.0.1 回显 + 常在的
 *         命令提示符，每试一次留一个不退出的 cmd
 *       · 第二层 bat 的 %1 变成 `/S` → `start "" "/S" ...` → 弹
 *         "Windows 找不到文件 '/S'"（或"系统找不到指定的路径"），
 *         资源被常驻 cmd 堆光后就是"内存资源不足，无法处理此命令"，
 *         而真正的安装器从来没被拉起来 → 更新装不上
 *   即便修掉重复，用 argv 传路径仍有两个坑：cmd /c 的引号剥离规则（引号数量
 *   不等于 2 时会砍掉首尾引号，含空格的路径就被空格截断）、以及 Node 在
 *   verbatim 模式下不会自动补引号。改走环境变量后：.bat 内容保持纯 ASCII
 *   （中文路径不再经过 .bat 编码），命令行走 `cmd /c "<batPath>"`（引号恰好 2 个，
 *   cmd 保留引号且不拆词），%TEMP% / 安装目录带空格或中文都不影响解析；
 *   而 bat 里已经不存在"自己"这个路径，自引用从结构上不可能再发生。
 *
 * 返回 { ok } 表示"已经安排好了"，渲染端据此显示"正在重启…"；
 * 真正的安装/重启在进程退出后由 cmd 完成。
 */
export function restartAndInstall(
  localPath: string,
  mode: UpdateMode,
): { ok: boolean; error?: string } {
  try {
    // v0.5.12: 加一行注释占位，触发 patch 发版，方便重测 v0.5.11 的 NSIS 升级修法
    if (!localPath || !fs.existsSync(localPath)) {
      return { ok: false, error: '安装包不存在（可能已被清理），请重新下载' }
    }
    // 只接受 .exe（下载下来的 asset 一定是 TimeWell-x.y.z[-portable]-x64.exe）：
    // `start "" /wait "<target>"` 的目标不是 exe 时，cmd 会走 `%COMSPEC% /K "<file>"`
    // 起一个跑完也不退出的控制台，外层 /wait 永远等不到它结束 —— 装完不重启、
    // 还留个黑框。这里兜一道，宁可直接报错让用户手动打开装包。
    if (!localPath.toLowerCase().endsWith('.exe')) {
      return { ok: false, error: '安装包格式不支持（只认 .exe），请重新下载' }
    }

    if (process.platform !== 'win32') {
      // 非 Windows（理论上不会走到）只做"打开装包"
      //   v0.5.9 改 windowsVerbatimArguments 后只在 Windows 路径生效，macOS / Linux 走老分支
      spawn(localPath, [], { detached: true, stdio: 'ignore' }).unref()
      setTimeout(() => app.quit(), 300)
      return { ok: true }
    }

    // ping -n 3 ≈ 2s，等当前进程完全退出再动安装包
    // 之前写法是拼成 `ping ... > nul & start ...` 整段让 cmd /c 一次跑，
    // 但 windowsVerbatimArguments + Node 自动给 script 加首尾引号两个叠加，
    // cmd 看到外层引号就把 > 字面化（不当重定向），ping 回显就漏到控制台
    // —— 截图里那个黑框就是 ping 在打 "来自 127.0.0.1 的回复"。
    //
    // 修法：写一个临时 .bat 文件，cmd 直接解析 .bat 里的命令（.bat 不会被
    //       spawn 的首尾引号吞重定向）。.bat 内容保持纯 ASCII。
    const batDir = path.join(os.tmpdir(), 'TimeWell-update')
    fs.mkdirSync(batDir, { recursive: true })
    const batPath = path.join(batDir, mode === 'nsis' ? 'upgrade-nsis.bat' : 'upgrade-portable.bat')

    // NSIS 升级：sleep 等当前进程退干净 → 弹安装向导（--updated，不带 /S）
    //           → 用户点"完成"，由安装器的完成页勾选项拉起新版本
    // portable 升级：sleep → 直接 start 下载好的新版绿色版（不替换旧文件，用户自行覆盖）
    //
    // 装包路径走环境变量 TW_SETUP 而不是 argv：
    //   argv 传路径会踩 cmd /c 的引号剥离规则（%1 错位 / 含空格路径被截断），
    //   环境变量由 CreateProcessW 按 UTF-16 传递，中文 + 空格都安全。
    //   关键是：bat 里不再出现"自己"这个路径，从结构上杜绝"把 .bat 当装包 start 一遍"
    //   的自引用（旧 bug → 无限弹 cmd 窗口 / 递归 / 内存资源不足 / 找不到 /S）。
    // `%~dp0restart.log` 与主进程 writeRestartLog 写同一个文件：装包是在本进程退出后
    //   才跑的，那之后没有任何 UI 能报错，发货后排查只能靠这份日志。
    //   日志行刻意不写 %date% —— 中文 Windows 下 %date% 是"周五"这种本地化字符，
    //   cmd 用 OEM 码页写文件，混进 UTF-8 日志里就是乱码；时间戳由主进程那几行
    //   （ISO 格式）负责，bat 只追加纯 ASCII 的事件 + 装包退出码。
    const batCommon = '@echo off\r\nping 127.0.0.1 -n 3 > nul\r\n'
    const batBody = mode === 'nsis'
      ? batCommon
        + 'echo bat(nsis) start >> "%~dp0restart.log"\r\n'
        + 'if not exist "%TW_SETUP%" echo ERROR setup missing >> "%~dp0restart.log"\r\n'
        + 'start "" /wait "%TW_SETUP%" --updated\r\n'
        + 'echo installer exit=%ERRORLEVEL% >> "%~dp0restart.log"\r\n'
      : batCommon
        + 'echo bat(portable) start >> "%~dp0restart.log"\r\n'
        + 'if not exist "%TW_SETUP%" echo ERROR setup missing >> "%~dp0restart.log"\r\n'
        + 'start "" "%TW_SETUP%"\r\n'

    // 写 .bat：内容纯 ASCII，编码用 UTF-8 即可（不含中文，不依赖 .bat 编码）
    fs.writeFileSync(batPath, batBody, { encoding: 'utf8' })
    console.log(`[updater] 重启并安装（${mode}）: bat=${batPath}, setup=${localPath}, self=${process.execPath}`)
    writeRestartLog(`[${new Date().toISOString()}] restart(${mode})\n  bat=${batPath}\n  setup=${localPath}\n  self=${process.execPath}\n`)

    // spawn .bat：argv 只传 batPath 本身，**手动加引号**（含空格路径不被拆词）。
    // ★ 关键 windowsVerbatimArguments: true：
    //   Node 默认会把参数里的 " 转义成 \" 并在外层再包一层引号，cmd.exe 不认反斜杠
    //   转义（v0.5.8 那个"文件名、目录名或卷标语法不正确"就是它）；
    //   verbatim 下 Node 原样透传，我们给什么 cmd 就收什么。
    //   只传一个带引号的路径时引号恰好 2 个，走 cmd 的"引号保留"规则，解析稳定。
    spawn('cmd.exe', ['/c', `"${batPath}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
      // 只传装包路径；装完由安装器自己拉起新版本（见文件头 NSIS 说明），
      // 所以 bat 里没有、也不需要"当前 exe"这个概念
      env: { ...process.env, TW_SETUP: localPath },
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
