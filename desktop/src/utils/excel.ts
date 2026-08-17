/**
 * Excel 导出 —— 用 exceljs 生成 .xlsx
 *
 * 结构：每门课程一个 sheet（标题条 + 课程信息卡 + 课时明细表），末尾汇总 sheet。
 * 排版统一：深绿标题条、浅绿信息卡、明细表带边框 + 隔行底色 + 冻结表头。
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

/** 导出元信息（写入汇总 sheet，方便溯源） */
export interface ExportMeta {
  childLabel?: string
  rangeLabel?: string
}

// ---- 统一配色（薄荷绿主题）----
const BRAND = 'FF3FB87A' // 主绿
const INFO_BG = 'FFF0F9F4' // 信息卡浅绿
const HEADER_BG = 'FFDCEFE0' // 表头浅绿
const BAND_BG = 'FFF7FAF8' // 隔行米绿
const LINE = 'FFC9D6CF' // 边框灰绿

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: LINE } },
  bottom: { style: 'thin' as const, color: { argb: LINE } },
  left: { style: 'thin' as const, color: { argb: LINE } },
  right: { style: 'thin' as const, color: { argb: LINE } },
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/** 清洗 sheet 名：去非法字符、截断 31 字符、重名追加序号 */
function sanitizeSheetName(raw: string, used: Set<string>): string {
  let s = (raw || '未命名课程')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
  if (!s) s = '未命名课程'
  let base = s
  let i = 2
  while (used.has(s)) {
    const suffix = ` ${i}`
    s = `${base.slice(0, 31 - suffix.length)}${suffix}`
    i++
  }
  used.add(s)
  return s
}

export async function exportToExcel(
  courses: CourseRow[],
  checkins: Checkin[],
  meta?: ExportMeta,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'kid-course-tracker'
  wb.created = new Date()

  // 按课程分组打卡
  const byCourseId = new Map<string, Checkin[]>()
  for (const c of checkins) {
    const arr = byCourseId.get(c.course_id)
    if (arr) arr.push(c)
    else byCourseId.set(c.course_id, [c])
  }

  const usedSheetNames = new Set<string>()

  /** 写一个课程的 sheet：标题条 + 信息卡 + 课时明细表 */
  function writeCourseSheet(title: string, course: CourseRow | null, list: Checkin[]) {
    const ws = wb.addWorksheet(sanitizeSheetName(title, usedSheetNames))
    ws.columns = [
      { header: '上课日期', key: 'date', width: 16 },
      { header: '所用课时', key: 'hours', width: 10 },
      { header: '累计已用', key: 'used', width: 12 },
      { header: '剩余课时', key: 'remain', width: 12 },
      { header: '课堂反馈', key: 'feedback', width: 48 },
    ]

    let r = 1

    // 标题条（合并整行，深绿底白字）
    ws.mergeCells(`A${r}:E${r}`)
    const titleCell = ws.getCell(`A${r}`)
    titleCell.value = course ? `${course.name} · 课时明细` : `${title} · 打卡记录`
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
    titleCell.fill = solidFill(BRAND)
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    titleCell.border = thinBorder
    ws.getRow(r).height = 28
    r++

    // 课程信息卡（合并整行，浅绿底）
    if (course) {
      const used = sumHoursByCourse(list, course.id)
      const remain = course.total_hours - used
      const pph =
        course.total_hours > 0
          ? Math.round((course.total_amount / course.total_hours) * 100) / 100
          : 0
      const infoRows: string[] = [
        `机构：${course.institution || '—'}`,
        `缴费金额：${formatMoney(course.total_amount)}      购买课时：${course.total_hours} 节      已上课时：${used} 节      剩余课时：${remain} 节`,
        `单节均价：${formatMoney(pph)}      缴费日期：${course.paid_at}      到期日期：${course.expires_at ?? '—'}`,
        `标签：${course.tags || '—'}      备注：${course.note || '—'}`,
      ]
      for (const line of infoRows) {
        ws.mergeCells(`A${r}:E${r}`)
        const cell = ws.getCell(`A${r}`)
        cell.value = line
        cell.fill = solidFill(INFO_BG)
        cell.border = thinBorder
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
        ws.getRow(r).height = 20
        r++
      }
      r++ // 信息卡与明细表之间空一行
    }

    // 明细表头
    const head = ws.addRow({
      date: '上课日期',
      hours: '所用课时',
      used: '累计已用',
      remain: '剩余课时',
      feedback: '课堂反馈',
    })
    const headRowNum = head.number
    head.height = 22
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FF2E9E63' } }
      cell.fill = solidFill(HEADER_BG)
      cell.border = thinBorder
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })

    // 明细行（日期升序，累计已用/剩余）
    const rows = [...list].sort((a, b) => a.date.localeCompare(b.date))
    let acc = 0
    const total = course?.total_hours ?? 0
    rows.forEach((c, i) => {
      acc += Number(c.hours)
      const row = ws.addRow({
        date: c.date,
        hours: c.hours,
        used: acc,
        remain: total - acc,
        feedback: c.feedback,
      })
      row.height = 18
      row.eachCell((cell, col) => {
        cell.border = thinBorder
        if (i % 2 === 1) cell.fill = solidFill(BAND_BG)
        cell.alignment = col === 5 ? { vertical: 'middle', wrapText: true } : { vertical: 'middle', horizontal: 'center' }
      })
    })

    // 冻结表头 + 自动筛选（从表头行开始）
    if (rows.length > 0) {
      ws.views = [{ state: 'frozen', ySplit: headRowNum }]
      ws.autoFilter = { from: `A${headRowNum}`, to: `E${ws.rowCount}` }
    }
  }

  // 每门课程一个 sheet
  for (const course of courses) {
    writeCourseSheet(course.name, course, byCourseId.get(course.id) ?? [])
  }

  // 孤儿打卡兜底（课程已删除）：单独一个 sheet 不丢数据
  const orphan = checkins.filter((c) => !courses.some((x) => x.id === c.course_id))
  if (orphan.length > 0) {
    writeCourseSheet('（已删除课程）', null, orphan)
  }

  // 汇总 sheet
  const ws3 = wb.addWorksheet('汇总')
  ws3.columns = [
    { header: '指标', key: 'k', width: 20 },
    { header: '数值', key: 'v', width: 30 },
  ]

  const totalAmount = courses.reduce((s, c) => s + c.total_amount, 0)
  const totalHours = courses.reduce((s, c) => s + c.total_hours, 0)
  const usedHours = checkins.reduce((s, c) => s + Number(c.hours), 0)

  // 标题条
  ws3.mergeCells('A1:B1')
  const sTitle = ws3.getCell('A1')
  sTitle.value = '导出汇总'
  sTitle.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  sTitle.fill = solidFill(BRAND)
  sTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sTitle.border = thinBorder
  ws3.getRow(1).height = 28

  // 数据行
  const rows3: Array<[string, string]> = []
  if (meta?.childLabel) rows3.push(['导出宝贝', meta.childLabel])
  if (meta?.rangeLabel) rows3.push(['上课时间', meta.rangeLabel])
  rows3.push(['导出科目数', `${courses.length} 门`])
  rows3.push(['总投入金额', formatMoney(totalAmount)])
  rows3.push(['总购买课时', `${totalHours} 节`])
  rows3.push(['总已上课时', `${usedHours} 节`])
  rows3.push(['总剩余课时', `${totalHours - usedHours} 节`])
  rows3.forEach(([k, v], i) => {
    const row = ws3.addRow({ k, v })
    row.height = 20
    const kCell = row.getCell(1)
    const vCell = row.getCell(2)
    kCell.font = { bold: true, color: { argb: 'FF2E9E63' } }
    kCell.fill = solidFill(INFO_BG)
    vCell.fill = i % 2 === 1 ? solidFill(BAND_BG) : solidFill('FFFFFFFF')
    kCell.border = thinBorder
    vCell.border = thinBorder
    kCell.alignment = { vertical: 'middle', indent: 1 }
    vCell.alignment = { vertical: 'middle', indent: 1 }
  })

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
