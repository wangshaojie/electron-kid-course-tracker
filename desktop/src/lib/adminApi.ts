/**
 * lib/adminApi.ts —— 管理员后台 4 个接口的 TS 封装
 *
 *  1) /admin/users        注册用户表（带搜索/筛选/排序/详情数据）
 *  2) /admin/active       活跃度趋势 + 留存 + 登录事件流
 *  3) /admin/leaderboard  课程/机构 热度榜
 *  4) /admin/logins       登录设备 / IP 审计
 *
 * 全部走 `dataApiGet<T>`，与现有 Admin.vue 的 dataApiGet 风格一致：
 *  - 401/403 透传 status + error
 *  - 失败返 { ok: false, status, error, detail }
 *  - 成功返 { ok: true, data: T }
 */

import { dataApiGet, type DataApiResult } from './cloudbase'

// ============== /admin/users ==============
export type AdminUserOrder =
  | 'first_seen_at'
  | 'last_login_at'
  | 'child_count'
  | 'course_count'
  | 'checkin_count'

export type AuthMethod = 'otp-verify' | 'password-login' | 'register'

export interface AdminUserRow {
  uid: string
  email: string | null
  firstSeenAt: string | null
  childCount: number
  courseCount: number
  checkinCount: number
  lastIp: string | null
  lastOs: string | null
  lastArch: string | null
  lastClient: string | null
  lastAppVersion: string | null
  lastElectronVersion: string | null
  lastUserAgent: string | null
  lastAuthMethod: AuthMethod | null
  lastLoginAt: string | null
  /** 该用户在窗口内使用过的去重 IP 数（基于 login_events 窗口聚合） */
  distinctIpCount: number
  /** 去重 设备（OS/Arch 组合）数 */
  distinctDeviceCount: number
  /** 去重 客户端版本数 */
  distinctAppCount: number
}

export interface AdminMeta {
  degraded: boolean
  degradedKeys: string[]
  loginEventsAvailable: boolean
  loginEventCount?: number
  fetchedAt: string
}

export interface AdminUsersResponse {
  ok: true
  total: number
  users: AdminUserRow[]
  meta: AdminMeta
}

export interface AdminUsersQuery {
  q?: string
  method?: AuthMethod
  sinceDays?: number
  order?: AdminUserOrder
  asc?: boolean
  limit?: number
}

export function getAdminUsers(q: AdminUsersQuery = {}): Promise<DataApiResult<AdminUsersResponse>> {
  const sp = new URLSearchParams()
  if (q.q) sp.set('q', q.q)
  if (q.method) sp.set('method', q.method)
  if (q.sinceDays && q.sinceDays > 0) sp.set('since_days', String(q.sinceDays))
  if (q.order) sp.set('order', q.order)
  if (typeof q.asc === 'boolean') sp.set('asc', q.asc ? 'true' : 'false')
  if (q.limit) sp.set('limit', String(q.limit))
  const qs = sp.toString()
  return dataApiGet<AdminUsersResponse>(`/admin/users${qs ? `?${qs}` : ''}`)
}

// ============== /admin/active ==============
export type ActiveBucket = 'day' | 'week' | 'month'

export interface ActiveTrendPoint {
  bucket: string
  activeUsers: number
  newUsers: number
  logins: number
}

export interface ActiveRecent {
  id: number
  ownerId: string
  email: string
  ip: string | null
  os: string | null
  arch: string | null
  client: string | null
  appVersion: string | null
  electronVersion: string | null
  userAgent: string | null
  authMethod: AuthMethod
  createdAt: string
}

export interface AdminActiveResponse {
  ok: true
  summary: {
    windowDays: number
    bucket: ActiveBucket
    totalActiveInWindow: number
    totalLoginsInWindow: number
    newUsersInWindow: number
  }
  trend: ActiveTrendPoint[]
  recent: ActiveRecent[]
  /** 粗略版留存：窗口内登录过、且最近一次登录距今 ≤ N 天的用户占比 */
  retention: { d1: number; d7: number; d30: number }
  meta: AdminMeta
}

export interface AdminActiveQuery {
  days?: number
  bucket?: ActiveBucket
  eventLimit?: number
}

export function getAdminActive(q: AdminActiveQuery = {}): Promise<DataApiResult<AdminActiveResponse>> {
  const sp = new URLSearchParams()
  if (q.days) sp.set('days', String(q.days))
  if (q.bucket) sp.set('bucket', q.bucket)
  if (q.eventLimit) sp.set('event_limit', String(q.eventLimit))
  const qs = sp.toString()
  return dataApiGet<AdminActiveResponse>(`/admin/active${qs ? `?${qs}` : ''}`)
}

// ============== /admin/leaderboard ==============
export type LeaderboardBy = 'course' | 'institution'

export interface LeaderboardItem {
  name: string
  ownerCount: number
  count: number
  totalAmount: number
  totalHours: number
}

export interface AdminLeaderboardResponse {
  ok: true
  by: LeaderboardBy
  total: number
  items: LeaderboardItem[]
  meta: AdminMeta
}

export interface AdminLeaderboardQuery {
  by?: LeaderboardBy
  limit?: number
}

export function getAdminLeaderboard(
  q: AdminLeaderboardQuery = {},
): Promise<DataApiResult<AdminLeaderboardResponse>> {
  const sp = new URLSearchParams()
  if (q.by) sp.set('by', q.by)
  if (q.limit) sp.set('limit', String(q.limit))
  const qs = sp.toString()
  return dataApiGet<AdminLeaderboardResponse>(`/admin/leaderboard${qs ? `?${qs}` : ''}`)
}

// ============== /admin/logins ==============
export interface LoginCountItem {
  name: string
  count: number
}

export interface AdminLoginsResponse {
  ok: true
  summary: {
    totalLogins: number
    distinctUsers: number
    distinctIps: number
    distinctOs: number
    distinctVersions: number
    sinceDays: number
  }
  topIps: LoginCountItem[]
  topOs: LoginCountItem[]
  topVersions: LoginCountItem[]
  recent: ActiveRecent[]
  meta: AdminMeta
}

export interface AdminLoginsQuery {
  sinceDays?: number
  limit?: number
}

export function getAdminLogins(q: AdminLoginsQuery = {}): Promise<DataApiResult<AdminLoginsResponse>> {
  const sp = new URLSearchParams()
  if (q.sinceDays) sp.set('since_days', String(q.sinceDays))
  if (q.limit) sp.set('limit', String(q.limit))
  const qs = sp.toString()
  return dataApiGet<AdminLoginsResponse>(`/admin/logins${qs ? `?${qs}` : ''}`)
}
