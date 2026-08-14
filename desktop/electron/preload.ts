/**
 * 预加载 —— 暴露安全的 IPC API 给渲染端
 * 所有 IO 都走主进程，渲染端只看到 kidfs.*
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateInfo } from './updater'

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

// 版本更新：订阅主进程推送的新版本事件 + 打开 GitHub 下载页
contextBridge.exposeInMainWorld('updater', {
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: UpdateInfo) => cb(info)
    ipcRenderer.on('update:available', listener)
    return () => {
      ipcRenderer.removeListener('update:available', listener)
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
})
