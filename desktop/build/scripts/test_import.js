// 临时脚本：用 sql.js + 真实 db.ts 逻辑跑 import，看 console 输出
import fs from 'node:fs/promises'
import path from 'node:path'
import initSqlJs from 'sql.js'

const backupPath = 'C:/Users/Admin/.minimax/v2/assets/2026/08/12/14-05-28-676-asset_20260812-140528-676_9798f535b293_bd32827e-kid-course-tracker_backup_2026-08-12.json'

const SQL = await initSqlJs({
  locateFile: (f) => path.join('D:/test/kid-course-tracker/node_modules/sql.js/dist', f),
})
const db = new SQL.Database()
// 跑 schema（简化版）
db.exec(`
  CREATE TABLE children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) > 0),
    emoji TEXT NOT NULL DEFAULT '🧒',
    color TEXT NOT NULL DEFAULT '#3FB87A',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL CHECK (length(name) > 0),
    institution TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL CHECK (total_amount > 0),
    total_hours REAL NOT NULL CHECK (total_hours > 0),
    paid_at TEXT NOT NULL,
    expires_at TEXT,
    tags TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
  );
  CREATE TABLE checkins (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL DEFAULT 'default',
    course_id TEXT NOT NULL,
    date TEXT NOT NULL,
    hours REAL NOT NULL CHECK (hours > 0),
    feedback TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE
  );
  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

const json = JSON.parse(await fs.readFile(backupPath, 'utf-8'))
console.log('JSON keys:', Object.keys(json))
console.log('courses[0].child_id:', json.courses?.[0]?.child_id)
console.log('courses[0] keys:', Object.keys(json.courses?.[0] || {}))

// 复刻 import 逻辑
db.exec('DELETE FROM checkins; DELETE FROM courses; DELETE FROM app_meta; DELETE FROM children;')

if (!Array.isArray(json.children) || json.children.length === 0) {
  const referencedIds = new Set()
  for (const t of ['courses', 'checkins']) {
    for (const row of (json[t] || [])) {
      const cid = row.child_id
      if (cid) referencedIds.add(cid)
    }
  }
  json.children = Array.from(referencedIds).map((id, idx) => ({
    id,
    name: '小探险家',
    emoji: '🧒',
    color: '#3FB87A',
    sort_order: idx,
    created_at: Date.now(),
  }))
  console.log('为', json.children.length, '个 child_id 建占位:', Array.from(referencedIds))
}

for (const t of ['children', 'courses', 'checkins', 'app_meta']) {
  const rows = json[t]
  if (!rows?.length) {
    console.log(`跳过空表 ${t}`)
    continue
  }
  const cols = Object.keys(rows[0])
  const placeholders = cols.map((c) => ':' + c).join(',')
  const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`)
  for (const row of rows) {
    try {
      // sql.js bind 需要带冒号前缀的 key
      const bindObj = {}
      for (const c of cols) bindObj[':' + c] = row[c]
      stmt.bind(bindObj)
      stmt.step()
    } catch (e) {
      console.error(`❌ ${t} 插入失败:`, e.message, 'row=', row)
    }
    stmt.reset()
  }
  stmt.free()
  console.log(`✓ ${t} 导入 ${rows.length} 行`)
}

// 验证
const r = db.exec('SELECT id, name FROM children')
console.log('children 表:', r[0]?.values)
const c = db.exec('SELECT id, name, child_id FROM courses')
console.log('courses 表:', c[0]?.values)
