// 共享类型 —— 业务侧（仓库的 SQL 类型在 data/ 内就近定义）

export interface CourseSummary {
  id: string
  name: string
  institution: string
  total_amount: number
  total_hours: number
  used_hours: number
  remain_hours: number
  price_per_hour: number
  paid_at: string
  expires_at: string | null
  tags: string[]
  note: string
  status: 'ok' | 'low' | 'expired' | 'done'
  days_to_expire: number | null
}

export type AlertLevel = 'info' | 'warning' | 'danger'

export interface Alert {
  level: AlertLevel
  title: string
  detail: string
  courseId?: string
}
