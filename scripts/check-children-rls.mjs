// 检查 children 表的 RLS 和 grant 状态
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({
  env: 'kid-course-tracker-d6c2816e966b5',
  secretId: process.env.SCB_SECRET_ID,
  secretKey: process.env.SCB_SECRET_KEY,
})

const r = app.rdb({ database: 'public' })

// 用 raw SQL 查询
async function run(sql) {
  // 这里 rdb 不直接暴露 raw SQL，临时用 fetch /v1/rdb/rest/tcp 直查
  const token = (await app.auth().getClientCredential()).access_token
  const env = 'kid-course-tracker-d6c2816e966b5'
  const url = `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/v1/rpc/run`
  const r2 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Db-Instance': 'default',
      'Accept-Profile': 'public',
      'Content-Profile': 'public',
    },
    body: JSON.stringify({ sql }),
  })
  return await r2.json()
}

const out = await run("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('children','courses','checkins','email_otps')")
console.log('pg_class:', JSON.stringify(out, null, 2))

const out2 = await run("SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='children'")
console.log('children grants:', JSON.stringify(out2, null, 2))

const out3 = await run("SELECT polname, polcmd, polpermissive FROM pg_policy WHERE polrelid='public.children'::regclass")
console.log('children policies:', JSON.stringify(out3, null, 2))
