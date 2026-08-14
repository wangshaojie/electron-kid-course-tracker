// 用 cloud function 调 cloudbase SDK 查 PG 状态
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({
  env: 'kid-course-tracker-d6c2816e966b5',
  secretId: process.env.SCB_SECRET_ID,
  secretKey: process.env.SCB_SECRET_KEY,
})
const rdb = () => app.rdb({ database: 'public' })

// 1) pg_class 查 RLS 状态
const c = await rdb().from('pg_class').select('relname, relrowsecurity, relforcerowsecurity').in('relname', ['children', 'courses', 'checkins', 'email_otps'])
console.log('pg_class:', JSON.stringify(c, null, 2))

// 2) children 表的 grant
const g = await rdb().from('information_schema.role_table_grants').select('grantee, privilege_type').eq('table_name', 'children')
console.log('children grants:', JSON.stringify(g, null, 2))

// 3) 看当前 session 角色
const s = await rdb().from('information_schema.sessions').select('*').limit(1)
console.log('sessions:', JSON.stringify(s, null, 2))
