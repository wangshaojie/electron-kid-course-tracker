/**
 * db store —— CloudBase 版本占位
 *
 * 数据已上云，本地不再维护 sql.js。
 * 保留 ready / dbPath 字段以兼容旧 view（AppLayout 用 dbPath 展示）
 */

import { defineStore } from 'pinia'

export const useDBStore = defineStore('db', {
  state: () => ({
    ready: false,
    dbPath: 'CloudBase PG',
  }),
  actions: {
    async init() {
      this.ready = true
    },
    /** @deprecated 云同步版本不适用 */
    exportJSON(): never { throw new Error('云同步版本请在 CloudBase 控制台导出') },
    /** @deprecated 云同步版本不适用 */
    importJSON(_json: string): never { throw new Error('云同步版本不支持本地导入') },
    /** @deprecated 云同步版本不适用 */
    wipe(): never { throw new Error('请在 CloudBase 控制台清理数据') },
  },
})
