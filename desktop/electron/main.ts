import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  checkForUpdates,
  checkForUpdatesManual,
  startManualDownload,
  restartAndInstall,
  isAuthorizedInstallerPath,
  cleanupOldUpdateFiles,
} from './updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
// dev 模式（pnpm dev / VITE_DEV_SERVER_URL 存在）自动开 DevTools
// 生产模式（electron .）默认不开；想开就加 flag：electron . --open-devtools
const OPEN_DEVTOOLS_IN_DEV = true
const OPEN_DEVTOOLS_FORCED = process.argv.includes('--open-devtools') || process.env.OPEN_DEVTOOLS === '1'
let mainWindow: BrowserWindow | null = null

/**
 * 应用数据目录（userData 根；dev 模式再套一层 kid-course-tracker 子目录）
 * --------------------------------------------------------------
 * ⚠️ boot.log 和 fs:* 读写必须用**同一个**目录，否则用户排查时
 *    "数据在这、日志在那"，两个地方翻（之前 dev 模式就是这样分叉的）。
 */
function resolveDataDir(): string {
  const userData = app.getPath('userData')
  return VITE_DEV_SERVER_URL ? path.join(userData, 'kid-course-tracker') : userData
}

/** 路径归一化（Windows 大小写不敏感，比较前统一） */
function normalizePath(p: string): string {
  try {
    const full = path.resolve(p)
    return process.platform === 'win32' ? full.toLowerCase() : full
  } catch {
    return ''
  }
}

/**
 * 写文件白名单：只认"用户刚在保存对话框里选过的那个路径"
 * --------------------------------------------------------------
 * ⚠️ 之前 fs:writeFile 接受任意路径 —— 渲染端只要被注入脚本，
 *    就能往用户磁盘任何位置写文件（覆盖 .bat / 改配置 / 投毒）。
 *    现在必须先经过 saveDialog（用户亲手选的路径）才允许写。
 */
let allowedWritePath = ''

function isAuthorizedWritePath(p: string): boolean {
  if (!allowedWritePath) return false
  return normalizePath(p) === normalizePath(allowedWritePath)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: '#F7FAF8',
    title: '一寸光阴',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // dev 模式自动开；生产模式加 --open-devtools 强制开
    const shouldOpen = (VITE_DEV_SERVER_URL && OPEN_DEVTOOLS_IN_DEV) || OPEN_DEVTOOLS_FORCED
    if (shouldOpen) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // 转发渲染端 console 到主进程 stdout（dev 时方便看错）
  // 同时把渲染端 log 落到数据目录下的 boot.log，排查"白屏/启动慢"时用
  const dataDir = resolveDataDir()
  fsSync.mkdirSync(dataDir, { recursive: true })
  const bootLogPath = path.join(dataDir, 'boot.log')
  const prevLogPath = path.join(dataDir, 'boot.prev.log')
  const writeBootLog = (line: string) => {
    fsSync.appendFile(bootLogPath, line + '\n', () => {})
  }
  // 启动时把上次的 log 轮换成 boot.prev.log。
  // ⚠️ 原来这里是 writeFileSync(bootLogPath, '') 直接清空 —— 但白屏/崩溃现场
  //    恰恰发生在"用户重启前"，清空正好把最该看的证据抹掉了。改成保留上一轮。
  try {
    if (fsSync.existsSync(bootLogPath)) {
      fsSync.copyFileSync(bootLogPath, prevLogPath)
      fsSync.writeFileSync(bootLogPath, '')
    }
  } catch { /* ignore */ }
  mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
    const tag = ['VERBOSE', 'INFO', 'WARN', 'ERROR'][level] ?? 'LOG'
    const line2 = `[${new Date().toISOString()}] [renderer ${tag}] ${msg} (${src}:${line})`
    console.log(line2)
    writeBootLog(line2)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    // 崩溃信息也要落盘：打包后没有 stdout，console.error 用户根本看不到
    const line = `[${new Date().toISOString()}] [renderer crash] ${JSON.stringify(details)}`
    console.error(line)
    writeBootLog(line)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // ⚠️ 只放行 http(s)：原来任意 url 都直接 shell.openExternal，
    //    file:// / 自定义协议会被外部程序接管（与 ipcMain 侧的校验保持一致）
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

/**
 * 单实例锁
 * --------------------------------------------------------------
 * 没有锁的话：多开实例 → 互相踩 boot.log、重复查更新、重复下载安装包。
 * 拿到锁的第二个实例会立刻退出，并把已有窗口顶到前面。
 */
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // ⚠️ 窗口可能已经被销毁（用户关掉窗口但应用还在跑），
    //    对已销毁的 BrowserWindow 调 isMinimized/focus 会抛异常。
    const win = mainWindow
    if (!win || win.isDestroyed()) {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  registerFsHandlers()
  // 清理 %TEMP%\TimeWell-update 里超过 7 天的旧装包（几十上百 MB，别一直堆着）
  cleanupOldUpdateFiles()
  // 打开外链（更新提示的"前往下载"按钮）
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    // ⚠️ 大小写不敏感（与 setWindowOpenHandler 保持一致）：
    //    HTTP://… / Https://… 也是合法 http(s) 链接，之前会被这里拦掉
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })
  // 用户点"立即更新"→ 主进程下载到 %TEMP%（NSIS 和 portable 走同一条路）
  ipcMain.handle(
    'update:startManualDownload',
    (_e, info: { version: string; currentVersion: string; tag: string; url: string }, mode: 'portable' | 'fallback') => {
      void startManualDownload(info, mode)
    },
  )
  // manual 模式：用户点"打开安装包"→ shell.openPath
  // ⚠️ 必须校验路径：否则渲染端能让主进程执行磁盘上任意 .exe
  ipcMain.handle('update:openLocalFile', async (_e, p: string) => {
    if (!isAuthorizedInstallerPath(p)) return
    await shell.openPath(p)
  })
  // 用户点"重启并安装"→ 退出应用 + 拉起装包（装完自动开新版本）
  ipcMain.handle('update:restartAndInstall', (_e, p: string, mode: 'nsis' | 'portable') => {
    if (!isAuthorizedInstallerPath(p)) {
      return { ok: false, error: '安装包路径不合法，请重新下载' }
    }
    return restartAndInstall(p, mode === 'nsis' ? 'nsis' : 'portable')
  })
  // 渲染端展示当前版本号（侧栏底部），统一读 package.json 不读 app.getVersion
  // 因为 dev 模式 app.getVersion() 会返 Electron 版本（参见 readAppVersion 注释）
  ipcMain.handle('app:getVersion', () => readAppVersion())
  // 渲染端"检测更新"按钮主动触发，绕开启动时的 started 锁
  ipcMain.handle('update:check', () => checkForUpdatesManual(readAppVersion()))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // 启动 5 秒后再查更新（不拖慢首屏；无新版本/网络失败静默）
  setTimeout(() => { void checkForUpdates(readAppVersion()) }, 5000)
})

/**
 * 当前应用版本：优先读 package.json（dev 联调时 app.getVersion() 会返回 Electron
 * 版本号而非应用版本）；读不到再回退 app.getVersion()
 */
function readAppVersion(): string {
  try {
    const p = path.join(__dirname, '../package.json')
    const data = JSON.parse(fsSync.readFileSync(p, 'utf8'))
    if (typeof data.version === 'string' && data.version) return data.version
  } catch { /* ignore */ }
  return app.getVersion()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// === 文件系统 IPC（preload 转给渲染进程） ===

function registerFsHandlers() {
  // 数据目录：dev 模式用 userData/kid-course-tracker 隔开，打包模式直接用 userData 根
  // （与 boot.log 同一个目录，见 resolveDataDir）
  const dataDir = resolveDataDir()
  fsSync.mkdirSync(dataDir, { recursive: true })

  ipcMain.handle('fs:userDataDir', () => dataDir)
  // ⚠️ 读文件 / 判存在 / 建目录这几个 handler **渲染端没有任何调用方**
  //    （唯一用到 kidfs 的是 Excel 导出：saveDialog + writeFile）。
  //    它们却等于"渲染端可读/写磁盘任意路径"—— 直接删掉，不留隐患。
  //    以后真要用，请按"限定在 dataDir 内"的方式重新加，并写清用途。
  ipcMain.handle('fs:saveDialog', async (_e, opts: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const { dialog } = await import('electron')
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: opts.defaultName,
      filters: opts.filters,
    })
    if (r.canceled || !r.filePath) return null
    // 记下用户选中的路径 —— fs:writeFile 只认这个路径
    allowedWritePath = r.filePath
    return r.filePath
  })
  ipcMain.handle('fs:writeFile', async (_e, p: string, data: Uint8Array) => {
    if (!isAuthorizedWritePath(p)) {
      throw new Error('写入路径未授权：请先通过"另存为"选择目标文件')
    }
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, data)
  })
}
