/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface UpdateInfoPayload {
  version: string
  currentVersion: string
  tag: string
  url: string
  mode?: 'nsis' | 'portable' | 'nsis-fallback'
  localPath?: string
  size?: number
}
interface UpdateProgressPayload {
  percent: number
  bytesPerSecond?: number
  transferred: number
  total: number
}
interface UpdateDownloadedPayload {
  version: string
  localPath?: string
  size?: number
}
interface UpdateErrorPayload {
  message: string
  fallback?: 'openExternal'
  url?: string
}

// 主进程通过 preload 暴露的本地 fs API
declare global {
  interface Window {
    kidfs: {
      userDataDir(): Promise<string>
      exists(path: string): boolean
      readFile(path: string): Promise<ArrayBuffer>
      writeFile(path: string, data: Uint8Array): Promise<void>
      ensureDir(path: string): Promise<void>
      saveDialog(opts: {
        defaultName?: string
        filters?: { name: string; extensions: string[] }[]
      }): Promise<string | null>
      readFileByPath(p: string): Promise<ArrayBuffer>
    }
    // 版本更新（preload 暴露）
    updater: {
      onUpdateAvailable(cb: (info: UpdateInfoPayload) => void): () => void
      onUpdateProgress(cb: (p: UpdateProgressPayload) => void): () => void
      onUpdateDownloaded(cb: (d: UpdateDownloadedPayload) => void): () => void
      onUpdateError(cb: (e: UpdateErrorPayload) => void): () => void
      startNsisDownload(): Promise<void>
      installNsisUpdate(): Promise<void>
      startManualDownload(info: UpdateInfoPayload, mode: 'portable' | 'fallback'): Promise<void>
      openLocalFile(p: string): Promise<void>
      openExternal(url: string): Promise<void>
    }
  }
}
export {}
