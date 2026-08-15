/**
 * Excel 导出 —— 用 exceljs 生成 .xlsx
 * 不依赖 xlsx 那种老 lib，更现代
 *
 * 已从 sql.js 切到 CloudBase：usedHoursOf 改为对入参 checkins 数组的纯计算
 */
import ExcelJS from 'exceljs'
import type { Course } from '@/stores/courses'
import type { Checkin } from '@/stores/checkins'
import { formatMoney } from './money'

/** 纯函数：算某课程的已上课时（从入参 checkins 数组） */
function sumHoursByCourse(checkins: Checkin[], courseId: string): number {
  return checkins
    .filter((c) => c.course_id === courseId)
    .reduce((s, c) => s + Number(c.hours), 0)
}

/** 导出需要的课程字段（不含客户端聚合的 used_hours 等，方便直接传云端原始行） */
export type CourseRow = Omit<Course, 'used_hours' | 'remain_hours' | 'price_per_hour'>

export async function exportToExcel(
  courses: CourseRow[],
  checkins: Checkin[],
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'kid-course-tracker'
  wb.created = new Date()

  // Sheet 1: 课程总览
  const ws1 = wb.addWorksheet('课程总览')
  ws1.columns = [
    { header: '课程名称', key: 'name', width: 22 },
    { header: '培训机构', key: 'institution', width: 20 },
    { header: '缴费金额', key: 'amount', width: 14, style: { numFmt: '"¥"#,##0.00' } },
    { header: '购买课时', key: 'total', width: 10 },
    { header: '已上课时', key: 'used', width: 10 },
    { header: '剩余课时', key: 'remain', width: 10 },
    { header: '单节均价', key: 'pph', width: 12 },
    { header: '缴费日期', key: 'paid', width: 14 },
    { header: '到期日期', key: 'exp', width: 14 },
    { header: '标签', key: 'tags', width: 20 },
    { header: '备注', key: 'note', width: 28 },
  ]
  for (const c of courses) {
    const used = sumHoursByCourse(checkins, c.id)
    ws1.addRow({
      name: c.name,
      institution: c.institution,
      amount: c.total_amount,
      total: c.total_hours,
      used,
      remain: c.total_hours - used,
      pph: c.total_hours > 0 ? Math.round((c.total_amount / c.total_hours) * 100) / 100 : 0,
      paid: c.paid_at,
      exp: c.expires_at ?? '',
      tags: c.tags,
      note: c.note,
    })
  }
  // 表头加粗
  ws1.getRow(1).font = { bold: true }
  ws1.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDCEFE0' },
  }

  // Sheet 2: 打卡记录
  const ws2 = wb.addWorksheet('打卡记录')
  ws2.columns = [
    { header: '日期', key: 'date', width: 14 },
    { header: '课程', key: 'name', width: 22 },
    { header: '节数', key: 'hours', width: 8 },
    { header: '课堂反馈', key: 'feedback', width: 40 },
  ]
  const courseName = new Map(courses.map((c) => [c.id, c.name]))
  for (const c of checkins) {
    ws2.addRow({
      date: c.date,
      name: courseName.get(c.course_id) ?? '(已删除)',
      hours: c.hours,
      feedback: c.feedback,
    })
  }
  ws2.getRow(1).font = { bold: true }
  ws2.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDCEFE0' },
  }

  // Sheet 3: 汇总
  const ws3 = wb.addWorksheet('汇总')
  const totalAmount = courses.reduce((s, c) => s + c.total_amount, 0)
  const totalHours = courses.reduce((s, c) => s + c.total_hours, 0)
  const usedHours = checkins.reduce((s, c) => s + c.hours, 0)
  ws3.columns = [
    { header: '指标', key: 'k', width: 18 },
    { header: '数值', key: 'v', width: 22 },
  ]
  ws3.addRow({ k: '课程总数', v: courses.length })
  ws3.addRow({ k: '总投入金额', v: formatMoney(totalAmount) })
  ws3.addRow({ k: '总购买课时', v: `${totalHours} 节` })
  ws3.addRow({ k: '总已上课时', v: `${usedHours} 节` })
  ws3.addRow({ k: '总剩余课时', v: `${totalHours - usedHours} 节` })
  ws3.getRow(1).font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
