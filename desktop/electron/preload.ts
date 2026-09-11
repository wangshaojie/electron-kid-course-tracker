/**
 * 预加载 —— 暴露安全的 IPC API 给渲染端
 * 所有 IO 都走主进程，渲染端只看到 kidfs.*
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  UpdateInfo,
  UpdateProgress,
  UpdateDownloaded,
  UpdateError,
} from './updater'

contextBridge.exposeInMainWorld('kidfs', {
  userDataDir: () => ipcRenderer.invoke('fs:userDataDir'),
  exists: (p: string) => ipcRenderer.invoke('fs:exists', p),
  readFile: (p: string) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p: string, data: Uint8Array) => ipcRenderer.invoke('fs:writeFile', p, data),
  ensureDir: (p: string) => ipcRenderer.invoke('fs:ensureDir', p),
  saveDialog: (opts: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('fs:saveDialog', opts),
  readFileByPath: (p: string) => ipcRenderer.invoke('fs:readFileByPath', p),
})

// 版本更新：订阅主进程推送 + 触发下载/安装
contextBridge.exposeInMainWorld('updater', {
  /** 主进程发现新版本时推送（带 mode：nsis / portable） */
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  /** 下载进度（0-100） */
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: UpdateProgress) => cb(p)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  /** 下载完成（统一等用户点"打开安装包"） */
  onUpdateDownloaded: (cb: (d: UpdateDownloaded) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, d: UpdateDownloaded) => cb(d)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
  /** 错误（带 fallback 信息：fallback=openExternal 时让用户去 GitHub） */
  onUpdateError: (cb: (e: UpdateError) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, e: UpdateError) => cb(e)
    ipcRenderer.on('update:error', listener)
    return () => ipcRenderer.removeListener('update:error', listener)
  },
  /** 用户点"立即更新" → 触发下载到 %TEMP%（NSIS 和 portable 同一条路） */
  startManualDownload: (info: UpdateInfo, mode: 'portable' | 'fallback') =>
    ipcRenderer.invoke('update:startManualDownload', info, mode),
  /** manual 模式：下载完成 → 用户点"打开安装包" */
  openLocalFile: (p: string) => ipcRenderer.invoke('update:openLocalFile', p),
  /** 下载完成 → 用户点"重启并安装"：主进程退出 + 拉起装包，装完自动开新版本 */
  restartAndInstall: (p: string, mode: 'nsis' | 'portable') =>
    ipcRenderer.invoke('update:restartAndInstall', p, mode),
  /** 兜底：浏览器打开 GitHub Release 页面 */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  /** 当前应用版本（package.json 读，dev 也准） */
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  /** 手动触发检查更新（绕开启动时的 started 锁） */
  manualCheck: (): Promise<'has-update' | 'up-to-date' | 'failed'> =>
    ipcRenderer.invoke('update:check'),
})
