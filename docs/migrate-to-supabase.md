# 腾讯 CloudBase → Supabase 迁移手册

> 目标：把「一寸光阴」从腾讯 CloudBase（HTTP 函数 + 云 PG）整体迁到
> **Supabase PG + 自托管 Node 函数（Vercel）**，业务数据、账号密码、登录方式全部保留。

## 1. 目标架构

```
Electron 桌面端（Vue，代码零业务改动）
   │ fetch VITE_AUTH_OTP_URL / VITE_DATA_API_URL
   ▼
Vercel Functions（vercel/ 目录，Node 20）
   ├─ auth-otp   发码 / 验码 / 密码登录 / 注册 / 改密（scrypt + 自签 JWT）
   └─ data-api   业务 CRUD（/b/*）
   │  postgres.js 直连（postgres 角色，BYPASSRLS）
   ▼
Supabase PostgreSQL
   ├─ children / courses / checkins / user_prefs / email_otps / user_passwords / backups
   ├─ RLS 已开 + FORCE + anon/authenticated 权限已 revoke → anon key 泄露也读不到
   └─ pg_cron 每日备份 → backups 表（可选，migration 03）
```

关键点：

- 自建认证（邮箱验证码 + scrypt 密码 + 自签 JWT）**原样保留**，`user_passwords`
  数据原样搬迁 → **现有用户登录无感**。
- 桌面端只改两个环境变量 URL，store / 登录页**零改动**。
- `lib/cloudbase.ts` 文件名沿用历史，实际已与腾讯 CloudBase 脱钩。

## 2. 迁移前置

| 需要 | 来源 | 说明 |
|---|---|---|
| Supabase 项目 URL + DB 密码 | Supabase Dashboard | 建项目后抄 Database connection string |
| `DATABASE_URL` | Dashboard → Project Settings → Database | 用 **pooled** 串（`:6543`），如 `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require` |
| `JWT_SECRET` | 本仓库 `cloudbaserc.json` → auth-otp envVariables | 必须沿用原值，老用户 30 天 JWT 才不断签 |
| `RESEND_API_KEY` / `MAIL_FROM` | 同上 / Resend | 验证码邮件 |
| CloudBase SDK 凭据 | 本仓库 `cloudbaserc.json` 已含 `TCB_SDK_SECRET_ID/KEY` | 数据抽取用，脚本可自动读 |

> ⚠️ `cloudbaserc.json` / `desktop/.env.*` 均被 gitignore，密钥不进仓库。

## 3. 步骤一：Supabase 建表

方式 A（推荐，最快）：Dashboard → SQL Editor，依次粘贴执行：

1. `supabase/migrations/20260908000001_init_schema.sql` —— 建 7 张表 + 索引
2. `supabase/migrations/20260908000002_harden_security.sql` —— revoke anon/authenticated + RLS/FORCE
3. `supabase/migrations/20260908000003_daily_backup_cron.sql` —— （可选）pg_cron 每日备份

方式 B：已装 supabase CLI：

```bash
supabase link --project-ref <你的 project ref>
supabase db push        # 会按时间戳自动应用 migrations/ 下所有文件
```

验证（SQL Editor）：

```sql
SELECT count(*) FROM public.children;                  -- 应为 0（还没迁数）
SET ROLE anon;  SELECT count(*) FROM public.children;  -- 应报 permission denied
RESET ROLE;
```

## 4. 步骤二：数据迁移（CloudBase → Supabase）

```bash
# 1) 装脚本依赖（一次性）
cd scripts
npm i
cd ..

# 2) 先 dry-run，只读 CloudBase 打印行数（不需要 Supabase 也能跑）
node scripts/migrate-cloudbase-to-supabase.mjs --dry-run

# 3) 正式迁移（设置环境变量后执行）
$env:SUPABASE_DATABASE_URL = "postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:6543/postgres?sslmode=require"
node scripts/migrate-cloudbase-to-supabase.mjs
```

脚本行为：

- 按 `children → courses → checkins → user_prefs → user_passwords → email_otps` 顺序搬
- 全程 `ON CONFLICT ... DO NOTHING`，**可重复执行**，不会重复插入
- `owner_id` 自动 btrim 历史双引号脏数据
- `backups` 表不搬（Supabase 端 pg_cron 会自己写）

迁移后核对（SQL Editor）：

```sql
SELECT (SELECT count(*) FROM children), (SELECT count(*) FROM courses),
       (SELECT count(*) FROM checkins), (SELECT count(*) FROM user_prefs),
       (SELECT count(*) FROM user_passwords), (SELECT count(*) FROM email_otps);
```

与 dry-run 打印的 CloudBase 行数对比应一致。

## 5. 步骤三：部署 Vercel 函数

```bash
cd vercel
npm i
npx vercel deploy --prod
```

然后到 Vercel Dashboard → 项目 → Settings → Environment Variables 配置：

| Key | 值 |
|---|---|
| `DATABASE_URL` | Supabase pooled 连接串（同上） |
| `JWT_SECRET` | **沿用 cloudbaserc.json 里的原值** |
| `RESEND_API_KEY` | Resend key |
| `MAIL_FROM` | 发件邮箱（如 noreply@240730.xyz） |
| `MAIL_SUBJECT` | 【一寸光阴】您的登录验证码 |
| `OTP_RATE_LIMIT_MS` | 60000（可选） |
| `OTP_EMAIL_HOUR_LIMIT` | 5（可选） |

部署后用浏览器验证：

```text
https://<your-project>.vercel.app/auth-otp/health     → { ok: true }
https://<your-project>.vercel.app/data-api/health     → { ok: true }
```

## 6. 步骤四：桌面端切换 URL

编辑（两者都改，均 gitignored）：

- `desktop/.env.development`
- `desktop/.env.production`

```ini
VITE_AUTH_OTP_URL=https://<your-project>.vercel.app/auth-otp
VITE_DATA_API_URL=https://<your-project>.vercel.app/data-api
# 旧 CloudBase 配置注释保留，秒切回用
```

模板见 `desktop/.env.example`。

> `VITE_CLOUDBASE_ENV_ID` 不再是必须项（两个 URL 显式配置即可）。
> 迁移完成后 `@cloudbase/js-sdk` 依赖可 `pnpm remove @cloudbase/js-sdk` 清掉。

## 7. 验证清单

1. 密码登录：老账号邮箱 + 密码直接进（验证 `user_passwords` 搬对了）
2. 验证码登录：「其他方式」→ 收邮件 → 6 位码登录
3. 注册新号 → 设密码 → 自动登录（验证写库 + 白名单表）
4. 宝贝：新增/编辑/删除；切换激活宝贝后云端 `user_prefs` 更新
5. 课程：新增/编辑/删除（课时/金额 > 0 校验）；删除课程连带清打卡
6. 打卡：新增扣课时、超扣被拒、删除回滚
7. anon key 泄露测试：Supabase REST API 直查 `public.children` 应被拒

## 8. 回滚

- 桌面端把 `.env.development` / `.env.production` 的 URL 改回 CloudBase 的
  `https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/{auth-otp,data-api}` 即可秒切回。
- Supabase 数据与 CloudBase 数据互不影响，无回写风险。

## 9. 迁移后清理（可选）

- 关闭/停用 CloudBase 环境（确认稳定后）
- `desktop`：`pnpm remove @cloudbase/js-sdk`
- 根 `cloudbaserc.json` 删除或转移保管（含密钥）
- 若不用 supabase CLI，`supabase/migrations/` 仅是 SQL 存档，可保留
