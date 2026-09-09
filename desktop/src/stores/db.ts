/**
 * db store —— Supabase 版本占位
 *
 * 数据已上云，本地不再维护 sql.js。
 * 保留 ready / dbPath 字段以兼容旧 view（AppLayout 用 dbPath 展示）
 */

import { defineStore } from 'pinia'

export const useDBStore = defineStore('db', {
  state: () => ({
    ready: false,
    dbPath: 'Supabase PG',
  }),
  actions: {
    async init() {
      this.ready = true
    },
  },
})
