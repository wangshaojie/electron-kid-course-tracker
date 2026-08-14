/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
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
    // 版本更新提醒（preload 暴露）
    updater: {
      /** 订阅"发现新版本"，返回取消订阅函数 */
      onUpdateAvailable(cb: (info: {
        version: string
        currentVersion: string
        tag: string
        url: string
      }) => void): () => void
      /** 用系统浏览器打开外链（GitHub 下载页） */
      openExternal(url: string): Promise<void>
    }
  }
}
export {}
