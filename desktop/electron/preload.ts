/**
 * 预加载 —— 暴露安全的 IPC API 给渲染端
 * 所有 IO 都走主进程，渲染端只看到 kidfs.*
 */
import { contextBridge, ipcRenderer } from 'electron'

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
