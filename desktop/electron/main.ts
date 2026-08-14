import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
// dev 模式（pnpm dev / VITE_DEV_SERVER_URL 存在）自动开 DevTools
// 生产模式（electron .）默认不开；想开就加 flag：electron . --open-devtools
const OPEN_DEVTOOLS_IN_DEV = true
const OPEN_DEVTOOLS_FORCED = process.argv.includes('--open-devtools') || process.env.OPEN_DEVTOOLS === '1'
let mainWindow: BrowserWindow | null = null

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
  // 同时把渲染端 log 落到 userData/boot.log，排查"白屏/启动慢"时用
  const bootLogPath = path.join(app.getPath('userData'), 'boot.log')
  const writeBootLog = (line: string) => {
    fsSync.appendFile(bootLogPath, line + '\n', () => {})
  }
  // 启动时清空上次的 log
  try { fsSync.writeFileSync(bootLogPath, '') } catch {}
  mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
    const tag = ['VERBOSE', 'INFO', 'WARN', 'ERROR'][level] ?? 'LOG'
    const line2 = `[${new Date().toISOString()}] [renderer ${tag}] ${msg} (${src}:${line})`
    console.log(line2)
    writeBootLog(line2)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer crash]', details)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerFsHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// === 文件系统 IPC（preload 转给渲染进程） ===

function registerFsHandlers() {
  // 数据目录：直接用 userData 根。
  // - dev 模式：userData = .../Roaming/Electron（electron 启动器的默认名）
  // - 打包模式：userData = .../Roaming/<productName> 或 .../Roaming/<name>
  // dev 模式下我们想跟其他 electron dev app 隔开，所以包一层 "kid-course-tracker" 子目录；
  // 打包模式直接用根目录即可（productName 已经隔开了）。
  const userData = app.getPath('userData')
  const dataDir = VITE_DEV_SERVER_URL
    ? path.join(userData, 'kid-course-tracker')
    : userData
  fsSync.mkdirSync(dataDir, { recursive: true })

  ipcMain.handle('fs:userDataDir', () => dataDir)
  ipcMain.handle('fs:exists', (_e, p: string) => {
    try { return fsSync.existsSync(p) } catch { return false }
  })
  ipcMain.handle('fs:readFile', async (_e, p: string) => {
    const buf = await fs.readFile(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
  ipcMain.handle('fs:writeFile', async (_e, p: string, data: Uint8Array) => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, data)
  })
  ipcMain.handle('fs:ensureDir', async (_e, p: string) => {
    await fs.mkdir(p, { recursive: true })
  })
  ipcMain.handle('fs:saveDialog', async (_e, opts: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const { dialog } = await import('electron')
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: opts.defaultName,
      filters: opts.filters,
    })
    return r.canceled ? null : r.filePath
  })
  ipcMain.handle('fs:readFileByPath', async (_e, p: string) => {
    const buf = await fs.readFile(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
}
