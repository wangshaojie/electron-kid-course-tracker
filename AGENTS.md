# AGENTS.md

> 给 AI agent / 未来自己的项目入口文档。先读这一篇再动手。

## 1. 项目是什么

**一寸光阴** —— 家长自用的桌面应用（Windows）+ 远端 PG 同步，记录孩子的课外培训班课程 / 缴费 / 打卡 / 课时统计。

- **不是**：多人协作 / 商业化 / 通知推送 / 课程评价
- **是**：单账号、多孩子、多课程；多设备登录看到一样的数据

## 2. 架构总览（2026-08 重写）

### 2.1 部署视图

```
┌────────────────────────────────────────────────────────┐
│  Electron 33 桌面端（Windows）                          │
│  ├─ Vue 3.5 + TS + Pinia + Element Plus + Tailwind     │
│  ├─ 渲染端路由：5 页面（home/courses/checkins/stats/   │
│  │              settings/login）                        │
│  ├─ 主进程（electron/main.ts）：窗口、preload、IPC     │
│  └─ 启动时自动开 DevTools：dev 模式；生产默认不开       │
└────────────────────────────────────────────────────────┘
                       │ VITE_AUTH_OTP_URL
                       ▼
┌────────────────────────────────────────────────────────┐
│  CloudBase 云函数                                       │
│  ├─ auth-otp (HTTP Function, 本地调试 :9000)           │
│  │    POST /send    发 6 位验证码邮件（Resend）         │
│  │    POST /verify  校验码 + 签自签 JWT（30 天有效）    │
│  │    POST /login   邮箱+密码登录（可选，scrypt 比对） │
│  │    POST /set-password  验证码确认后 设置/修改密码    │
│  │    POST /reset-password 忘记密码重置（同 set）       │
│  │                  JWT payload 含 role（admin/user）  │
│  │    GET  /health  健康检查                            │
│  ├─ data-api (HTTP Function, 本地调试 :9000)            │
│  │    GET  /admin/stats   管理员统计（4 数字）         │
│  │    GET  /admin/users   注册用户表（最多 500）        │
│  │    GET  /health       健康检查                        │
│  │    GET/POST/PATCH/DELETE /b/:table  业务 CRUD        │
│  │      （children/courses/checkins/user_prefs）        │
│  │    ★ 业务安全：owner_id 服务端从 JWT 强制注入，      │
│  │      表名/写入列/过滤列/排序列全白名单               │
│  │    ★ ADMIN_EMAILS 白名单（不信任 JWT 里的 role，     │
│  │      每次请求现查 env，admin 增删立即生效）          │
│  ├─ uid = sha256(email).slice(0, 32)  ← 跨设备稳定     │
│  └─ pg-backup (Event 定时触发)  每日 PG 备份            │
└────────────────────────────────────────────────────────┘
                       │ service role (init via TCB_SDK_SECRET_ID/SECRET_KEY)
                       ▼
┌────────────────────────────────────────────────────────┐
│  CloudBase PostgreSQL (public schema)                   │
│  ├─ children   id, owner_id, name, emoji, color, ...   │
│  ├─ courses    id, owner_id, child_id, total_hours, ...│
│  ├─ checkins   id, owner_id, child_id, course_id, ...  │
│  ├─ email_otps  OTP 临时存储（hash + salt + attempts）  │
│  └─ user_prefs  owner_id PK + active_child_id          │
│                                                       │
│  ✅ RLS 已开启 + anon policy/权限已删（20260817000000）│
│     anon 直连 PostgREST：无 policy + 无权限 → 全拒     │
└────────────────────────────────────────────────────────┘
                       │ service role (BYPASSRLS)
                       ▲
       渲染端 fetch data-api /b/* 带 Authorization: Bearer <自签JWT>
       渲染端 fetch data-api /admin/* 带 Authorization: Bearer <自签JWT>
```

**数据隔离**：业务读写**全部走 data-api 云函数**，`owner_id` 由服务端从 JWT 注入（前端传的一律忽略）；数据库层 RLS 已开 + anon policy/权限已删，即使拆包拿到 publishable key 直连 PostgREST 也被拒。

### 2.2 端到端流程（mermaid）

下面是从"打开 app"到"看到首页数据"的完整时序图，**包含登录 / 拉数据 / 切换账号**三条主要链路。

```mermaid
%%{init: {'theme': 'default'}}%%
sequenceDiagram
    autonumber
    actor User as 家长
    participant V as Vue 渲染端<br/>(App.vue / Stores)
    participant LS as localStorage<br/>/ sessionStorage
    participant OTP as CloudBase HTTP Function<br/>auth-otp
    participant RS as Resend
    participant PG as CloudBase PG<br/>(children / courses /<br/>checkins / user_prefs /<br/>email_otps)
    participant MP as Electron 主进程<br/>(main.ts)

    Note over User, MP: ── 启动 + 登录 ──
    User->>MP: 启动应用
    MP->>V: 加载 dist/index.html
    V->>V: main.ts → auth.bootstrap()
    V->>LS: 读 auth.jwt / auth.user / auth.uid
    alt 有 JWT 且未过期
        V-->>User: 直接进入首页（无需登录）
    else 无 JWT / 已过期
        V-->>User: 显示登录页
        User->>V: 输入邮箱 + 点击"获取验证码"
        V->>OTP: POST /send { email }
        OTP->>OTP: 限流校验（IP + 邮箱）
        OTP->>PG: INSERT email_otps(code_hash, salt, expires_at, ip)
        OTP->>RS: emails.send({ to, html, code })
        RS-->>User: 邮件（6 位验证码，10 分钟有效）
        User->>V: 输入验证码 + 点击"登录"
        V->>OTP: POST /verify { email, code }
        OTP->>PG: SELECT email_otps WHERE email=? AND consumed_at IS NULL
        OTP->>OTP: 比对 code_hash（sha256(salt+code)）
        alt 校验失败
            OTP->>PG: UPDATE attempts = attempts + 1
            OTP-->>V: 401 + 中文错误
        else 校验通过
            OTP->>PG: UPDATE consumed_at = now()
            OTP->>OTP: 签自签 JWT (uid = sha256(email).slice(0,32), exp 30d)
            OTP-->>V: 200 { token, uid, email }
            V->>LS: 写 auth.jwt / auth.user / auth.uid
        end
    end

    Note over V, PG: ── 拉业务数据（uid 变化时）──
    V->>V: watch(auth.user?.uid) 触发
    V->>V: App.vue.resetBusinessState()<br/>清空 children/courses/checkins store
    V->>PG: SELECT * FROM children WHERE owner_id = uid
    PG-->>V: list（孩子档案）
    V->>PG: SELECT * FROM user_prefs WHERE owner_id = uid
    PG-->>V: { active_child_id }
    V->>V: 决策 active child:<br/>云端 prefs > 本地 LS > list[0]
    alt 云端有 prefs 但失效
        V-->>User: 顶部 Toast 提示<br/>"之前激活的孩子已不存在，已自动切换到 XX"
    end
    V->>PG: SELECT * FROM courses WHERE owner_id = uid AND child_id = active
    V->>PG: SELECT * FROM checkins WHERE owner_id = uid AND child_id = active
    V->>V: 客户端聚合 used/remain/单节均价
    V-->>User: 显示首页 / 课程列表

    Note over User, PG: ── 切换孩子 ──
    User->>V: 侧栏点孩子切换器
    V->>V: children.setActive(id)
    V->>LS: 写 kid_active_child_id
    V->>PG: UPSERT user_prefs (active_child_id = id, updated_at)
    V->>PG: refresh courses / checkins
    V-->>User: 课程/打卡列表更新
```

**关键时序点**：
- **步骤 1-8**：启动 + 登录（OTP 限流按 IP + 邮箱双维度，详见 `cloudbase/functions/auth-otp/index.js`）
- **步骤 9-13**：拉数据（`resetBusinessState` 必跑，避免上一个账号的 store 残留）
- **步骤 14-17**：切换孩子（云端 user_prefs + 本地 localStorage 双写）

### 2.3 数据流概览（mermaid）

```mermaid
%%{init: {'theme': 'default'}}%%
flowchart LR
    subgraph Desktop["Electron 桌面端"]
        UI[Vue 组件]
        Store[Pinia Stores<br/>auth / children /<br/>courses / checkins]
        Lib[lib/cloudbase.ts<br/>SDK + JWT session]
    end

    subgraph CloudBase["CloudBase 云端"]
        Otp[auth-otp<br/>HTTP Function]
        Backup[pg-backup<br/>Event 定时触发]
        PG[(CloudBase PG<br/>public schema)]
    end

    subgraph Third["第三方"]
        Resend[Resend<br/>邮件服务]
    end

    UI -->|点击 + 读 store| Store
    Store -->|businessApi()<br/>GET/POST/PATCH/DELETE /b/*| Lib
    Lib -->|fetch data-api<br/>service role 直连| PG

    UI -.sendCode.-> Otp
    Otp -->|写 email_otps| PG
    Otp -->|发邮件| Resend
    Otp -.verify (签 JWT).-> UI

    Backup -.定时触发.-> PG
    Backup -->|INSERT backups| PG
```

**关键边界**：
- 渲染端**只走** data-api 云函数（`businessApi` → `/b/*`），**不**直连 PostgREST、**不**用数据库 key
- 业务读写权限 = 服务端 JWT（owner_id 强制注入）+ RLS 开启 + anon 无 policy/权限 三件套
- `auth-otp` 是 **HTTP Function**，`pg-backup` 是 **Event Function（定时触发）**，都通过 service role 凭据直连 PG

## 3. 目录速览

```
kid-course-tracker/
├── AGENTS.md                ← 你正在读
├── cloudbaserc.json         ← CloudBase 部署配置（已填真实 envId，含密钥已 gitignore）
├── cloudbase/               ← CloudBase 后端资产
│   ├── migrations/          ← SQL migration（按文件名升序执行，共 10 个）
│   │   ├── 20260813055503_init_business.sql
│   │   ├── 20260813055504_email_otps.sql
│   │   ├── 20260813055505_email_otps_disable_rls.sql
│   │   ├── 20260813055506_business_disable_rls.sql
│   │   ├── 20260813055507_anon_policies.sql
│   │   ├── 20260813055508_regrant.sql
│   │   ├── 20260813222000_user_prefs.sql
│   │   ├── 20260814100000_backups.sql
│   │   ├── 20260814120000_user_prefs_anon.sql
│   │   ├── 20260814130000_backups_anon.sql
│   │   ├── 20260817000000_business_anon_harden.sql ← 删 anon policy + revoke
│   │   └── 20260817000001_user_passwords.sql ← 可选密码登录（scrypt 哈希）
│   └── functions/           ← 云函数
│       ├── auth-otp/        ← HTTP 云函数（发码/验码/签 JWT）
│       └── pg-backup/       ← Event 云函数（每日 PG 备份）
│
├── desktop/                 ← 桌面端
│   ├── AGENTS.md            ← 桌面端专属约定
│   ├── README.md            ← 安装/构建/运行文档
│   ├── package.json
│   ├── vite.config.ts       ← Vite + @ 别名
│   ├── tsconfig*.json
│   ├── build/installer.nsh  ← NSIS 卸载"清除本地数据"复选框脚本
│   ├── electron/            ← 主进程 + preload
│   │   ├── main.ts
│   │   ├── updater.ts       ← 版本检查（GitHub 双通道）
│   │   └── preload.ts
│   ├── src/                 ← 渲染端源码
│   │   ├── main.ts          ← 入口：auth bootstrap → mount
│   │   ├── App.vue          ← 顶层：登录态切换 + 业务数据 load
│   │   ├── router/          ← 5 页面 + 守卫
│   │   ├── views/           ← 页面（Home/Courses/Checkins/Stats/Settings/Login）
│   │   ├── components/      ← 通用 + 业务组件
│   │   ├── stores/          ← Pinia：auth/children/courses/checkins/db
│   │   │   └── children.ts  ← 包含 user_prefs 激活孩子同步
│   │   ├── lib/cloudbase.ts ← CloudBase SDK 初始化 + JWT session
│   │   ├── types/           ← 共享 TS 类型
│   │   ├── utils/           ← 日期/金额/校验/Excel
│   │   └── styles/
│   └── release/             ← electron-builder 产物
│
└── .agents/                 ← Mavis agent 配置
```

## 4. 核心约定

### 4.1 鉴权流程（v0.3+：密码为主，邮箱为辅）

**核心思路**：密码是主凭证，邮箱**仅用于**注册/找回/改密时的身份验证。注册即设密，登录走密码，不存在"只有邮箱没密码"的合法状态。

#### 三种主流程

**1. 注册（`/register`）**：
- `Login.vue` 密码 Tab 底部 "点此注册" → `RegisterDialog`
- Step 1: 邮箱 + 密码 + 确认密码（前端校验 ≥ 8 位含字母数字 + 两次一致）
- Step 2: 邮箱验证码（6 位）→ Step 3: 自动登录 + 跳首页
- 后端一次性走完：校验 OTP（消耗） → 校验密码强度 → 查 `user_passwords` 不存在 → 写 hash → 签 JWT 返回
- **邮箱已注册 → 409 `email_already_registered`**，引导去登录/忘记密码
- 成功返回 `{ token, uid, email, role }` 与 `/login` / `/verify` **结构完全一致**

**2. 登录（`/login`，默认主路径）**：
- `Login.vue` 密码 Tab（默认）→ 邮箱 + 密码 → `/login`
- 成功签与 `/register` / `/verify` **完全相同的 JWT**，data-api / 管理员白名单 / owner_id 逻辑零改动
- **安全设计**：
  - 密码 ≥ 8 位含字母数字（前端 + 服务端双重校验）
  - 登录失败统一返回 `invalid_credentials`（防邮箱枚举）
  - 按 email 连续失败 5 次锁 15 分钟（内存 Map `loginFails`，冷启动重置可接受）
  - 未设密码的邮箱 `/login` 也返回同一句错误（理论上 v0.3 后不存在这种状态，但保留兜底）
- 失败计数复用 `loginFails`（不重新发明）

**3. 验证码登录（`/verify`，折叠为"其他方式"，仅老用户应急）**：
- `Login.vue` → "其他方式" Tab → 邮箱 + 6 位码 → `/verify`
- **v0.3 之后**：仅供老用户 / 设备迁移应急使用，新用户必须走注册设密
- `Login.vue` 验证码 Tab 顶部加黄色提示框："仅老用户应急 / 设备迁移使用"

#### Session 持久化（与 v0.2 一致）

`persistSession(token, user, remember)`：
- `remember=true` → localStorage（30 天免登录）
- `remember=false` → sessionStorage（关 tab 即失效）
- `auth.bootstrap()` 在 `main.ts` 启动时从 storage 恢复

#### 已登录用户改密码（v0.3+）

- **入口**：`Settings.vue` → "账号安全"卡片 → "修改密码" 按钮 → `ChangePasswordDialog`
- **流程**：输旧密码 + 新密码 + 确认新密码 → `auth.changePassword()` → 调云函数 `POST /change-password`（需 `Authorization: Bearer <JWT>`）→ 校验旧密码 + 写新 hash + **重新签 JWT**（30 天计时重置）
- **安全设计**：
  - 改密码**必传旧密码**（防止邮箱临时被劫持时无门槛改密）
  - 旧密码错误复用 `loginFails` 锁频（连续 5 次错 → 锁 15 分钟，错误码 `wrong_old_password_locked`）
  - 未设过密码的用户走 `/change-password` 返回 `password_not_set` 错误码
  - 新密码不能与旧密码相同（错误码 `same_as_old`）
  - 改密成功**只刷新当前 session 的 JWT**，不踢其他设备（自签 JWT 没法主动失效其他 token，只能等 30 天过期）

#### 忘记密码（`/reset-password`）

- **入口**：`Login.vue` 密码 Tab 底部 "忘记密码" 链接 → `ForgotPasswordDialog`
- **流程**：邮箱（可改）→ 6 位 OTP → 新密码 + 确认 → 成功后踢回登录页
- 后端与 `/set-password` 同逻辑，**走 OTP 确认邮箱所有权，不需要旧密码**
- 未设过密码的用户也能用（直接就设置了）

#### 密码状态查询

- `GET /password-status`（需 Bearer JWT）→ `{ has_password: boolean, updated_at: string|null }`
- `Settings.vue` 进入时调一次 `auth.refreshPasswordStatus()` 决定展示"已设置（上次修改 XX）" / "未设置"文案
- **不能**用本地 `user_passwords` 表反推（前端拿不到，安全设计）
- 未设密码时 `PasswordStatusCard` 显示**老用户迁移提示**："v0.3 之前注册的账号未设密码，请尽快'设置密码'完成迁移"

#### 老用户迁移（v0.3 之前注册的账号）

- v0.2 及更早：注册 = 验证码登录即注册，**没强制设密**
- v0.3 升级后：未设密码的账号在 `PasswordStatusCard` 显示黄色迁移提示
- 迁移方式：点 "设置密码" 按钮 → 走 ForgotPasswordDialog（OTP + 新密码）
- **不强制**——但给强引导文案
- `/verify` 仍保留，老用户可继续用验证码登录（应急入口）

### 4.2 业务数据流

- **所有业务表 owner_id 必须是 self uid**（不允许跨账号读写）
- 渲染端 store **全部走 data-api**：`businessApi('GET/POST/PATCH/DELETE', '/b/:table')`，`owner_id` 由云函数从 JWT 强制注入，前端传的 `owner_id` 被忽略
- 数据库层 RLS 已开启 + anon policy/权限已删（migration 20260817000000），anon 直连 PostgREST 一律被拒；data-api 用 service role（BYPASSRLS）不受影响
- 课时扣减：客户端预校验（used + hours > total 报错） + 数据库 CHECK
- 激活孩子同步：见 `stores/children.ts` → `data-api /b/user_prefs`（PATCH 无 id = upsert）

### 4.3 切换账号不残留（重要！）

App.vue 有三件套：
1. `resetBusinessState()`：load 前清空 children/courses/checkins store + `kid_active_child_id` LS
2. `watch(auth.user?.uid)`：uid 变就强制重载（覆盖"不退出直接换邮箱"）
3. `loadingPromise` 单飞锁：onMounted + watch 同时触发只跑一次

`apply when`: Pinia + 鉴权 store + 多业务 store 互相依赖，账号切换时套这套。

### 4.4 数据校验策略

- **金额、课时必填 > 0**（表单 validators + DB CHECK 双重保险）
- **课时扣减禁止变负**（客户端预校验 + DB CHECK）
- **删除课程 = 二次确认** + 客户端级联删打卡
- **删除孩子 = 二次确认**（设置页做）

### 4.5 UI 规范

- **不是 Element Plus 默认蓝色后台风**
- 配色：薄荷绿 `#3FB87A` + 暖橙点缀 `#E08A1E` + 背景米绿 `#F7FAF8`
- 卡片圆角 12px / 按钮 8px
- 关键操作（删除/清空/认领）必须 `dangerousConfirm`（输入关键字二次确认）
- Toast 限一个长驻（用 `duration: 0, showClose: true`）

### 4.6 管理员模块（v0.3+）

**入口**：侧栏底部"🛡 管理员后台"按钮（仅 `auth.user?.role === 'admin'` 时渲染），路由 `/admin`（`meta.requiresAdmin`）。

**三层鉴权**（缺一不可）：

1. **路由守卫**（`router/index.ts`）—— 已登录但非 admin 访问 `/admin` 直接跳 `/`
2. **auth-otp 签 JWT** —— `verify` 成功时若 `email ∈ ADMIN_EMAILS` 则 `payload.role = 'admin'`，否则 `'user'`
3. **data-api 双校验**（cloud function 端）——
   - 验 `Authorization: Bearer <jwt>` 签名有效性
   - **不信任 JWT 里的 role**，每次现读 `ADMIN_EMAILS` env 重新比对（白名单增删立即生效，**不需等 30 天 JWT 过期**）

**关键设计取舍**：

- **不新建 admins 表** —— 走 env 白名单，零 schema 改动
- **不依赖 JWT 里的 role** —— 30 天过期内 admin 被撤，data-api 仍能立即拒绝
- **不动业务表 RLS / schema** —— 基础 3 项统计用 SQL 聚合 owner_id 跨 4 表 union 去重就够
- **email 反查** —— `owner_id` = `sha256(email).slice(0,32)`，从 `email_otps` 表里反查真正登录过的邮箱；查不到时显示 uid 截断
- **历史脏数据兜底** —— 存量 owner_id 曾被 JSON 序列化包裹双引号；已于 2026-08-17 全表清洗（`btrim(owner_id, '"')`），data-api 对 owner_id 仍保留 trim 兼容

**新增/修改文件**：

| 路径 | 改动 |
|---|---|
| `cloudbase/functions/auth-otp/index.js` | 读 `ADMIN_EMAILS`，verify 时给 JWT `role` 字段 |
| `cloudbase/functions/data-api/{index.js,package.json,scf_bootstrap}` | 新建：HTTP Function，3 个路由（health/stats/users） |
| `cloudbaserc.json` | `auth-otp` env 加 `ADMIN_EMAILS`，`data-api` 函数定义 |
| `desktop/src/views/Admin.vue` | 新建：4 卡片 + 注册用户表 |
| `desktop/src/router/index.ts` | 加 `/admin` 路由 + `requiresAdmin` 守卫 |
| `desktop/src/stores/auth.ts` | verify 时存 `user.role` |
| `desktop/src/lib/cloudbase.ts` | `SessionUser` 加 `role`，新增 `dataApiGet()` 工具 |
| `desktop/src/components/common/AppLayout.vue` | 侧栏底部"🛡 管理员后台"按钮（v-if） |
| `desktop/.env.{development,production,example}` | 加 `VITE_DATA_API_URL` |

## 5. 开发命令

```bash
# 装依赖（必须 pnpm onlyBuiltDependencies 让 esbuild/electron 跑 postinstall）
pnpm install

# dev 模式（Vite + Electron 同跑，自动开 DevTools）
pnpm dev

# 只跑 Vite 不开 Electron
pnpm dev:web

# 渲染端 + 主进程编译
pnpm build

# 打 NSIS 安装包（build:win）
pnpm build:win
# 打 portable 绿色版（build:win:portable）
pnpm build:win:portable
# 只打 unpacked 解包目录（build:win:dir）
pnpm build:win:dir

# 一键发版（推荐）：校验工作树 + bump version + commit + tag + push，
# 推 tag 后 .github/workflows/release.yml 自动跑 CI 打包 + 上传 Release
pnpm release patch   # 交互式去掉 patch 也行：pnpm release# 跑在生产模式（不自动开 DevTools；想开就 --open-devtools）
pnpm exec electron dist-electron/main.mjs --open-devtools
```

## 6. 数据库

### 6.1 关键表

| 表 | 说明 |
|---|---|
| `children` | 孩子档案（emoji/color/sort_order） |
| `courses` | 课程（total_hours/paid_at/expires_at） |
| `checkins` | 打卡（hours/feedback） |
| `email_otps` | OTP 临时记录（hash + salt + attempts + ip） |
| `user_prefs` | 账号偏好（owner_id PK + active_child_id） |
| `user_passwords` | 可选密码登录（email PK + scrypt 哈希） |

### 6.2 字段约定

- 所有业务表 `owner_id TEXT NOT NULL`：账号 uid（= `sha256(email).slice(0,32)`）
- 业务外键（child_id/course_id）用 TEXT 而非 FK：CloudBase PG 的 RLS 隔离下跨表 FK 经常被绕过
- 索引：`(owner_id, sort_order)`、`(child_id)`、`(paid_at DESC)`、`(expires_at)`

### 6.3 migration 怎么加

文件名格式 `YYYYMMDDHHMMSS_xxx.sql`，数字前缀保证按时间顺序跑。
```bash
# 跑全部 migration（bash 下 OK）
tcb db execute -e <envId> --sql "$(cat cloudbase/migrations/xxx.sql)"
# 或分多条跑（DDL 一条一条更稳）
```

⚠️ **Windows PowerShell 下 `--sql "$(cat file)"` 不可靠**（已踩坑，2026-08-17）：
- 多行 SQL 可能被拆坏、含 `$` 的 SQL（如 `scrypt$16384$...` 哈希）会被 PowerShell 当变量插值截断
- 现象：命令"成功"返回 0 行受影响，但表实际没建出来 / 数据被写坏（存成 `scrypt`）
- 正确姿势：
  ```powershell
  tcb db execute -e <envId> --sql "$(Get-Content -Raw -Encoding UTF8 cloudbase/migrations/xxx.sql)"
  # 或把 --sql 内联成单条语句执行
  ```

## 7. 部署

### 7.1 云函数

```bash
# 单函数部署
tcb fn deploy auth-otp -e <envId>
# 走 cloudbaserc.json
tcb fn deploy --config-file cloudbaserc.json
```

⚠️ 部署 HTTP Function 改完代码后建议**强制重传**（cos 可能缓存）：
```bash
tcb fn deploy auth-otp -e <envId> --force --deployMode zip
tcb fn deploy data-api -e <envId> --force --deployMode zip
```

### 7.2 路由

云函数 `auth-otp` / `data-api` 暴露 HTTP，必须加 `WEB_SCF` 类型路由（不是默认的 `SCF`）：
```bash
tcb routes add -d '{"routes":[{"path":"/auth-otp","upstreamResourceType":"WEB_SCF","upstreamResourceName":"auth-otp","method":["GET","POST"]}]}'
tcb routes add -d '{"routes":[{"path":"/data-api","upstreamResourceType":"WEB_SCF","upstreamResourceName":"data-api","method":["GET","POST"]}]}'
```

### 7.3 数据库

migration 改完直接 `tcb db execute` 跑；不推荐自动 migration（脚本会改 schema 风险大）。⚠️ 在 PowerShell 下务必用 `Get-Content -Raw -Encoding UTF8` 传参（见 §6.3），跑完用 `SELECT` 验证表真实存在（`tcb db execute` 返回 0 行不代表建表失败）。

### 7.4 管理员白名单（必做）

第一次部署 data-api 时，**必须**给 `auth-otp` env 注入 `ADMIN_EMAILS`（逗号分隔小写邮箱），否则所有用户都拿不到 admin role：
```bash
tcb fn config update fn auth-otp -e <envId> \
  -e ADMIN_EMAILS=admin@240730.xyz
```

cloudbaserc.json 也可写 `"ADMIN_EMAILS": "admin@240730.xyz"`，但因 cloudbaserc.json 整体被 `.gitignore` 包含（防密钥泄露），不推荐把白名单写在仓库里，**走 `tcb fn config update` 控制台注入更稳**。

**撤销管理员**只需重新跑一次 `tcb fn config update` 把邮箱从白名单去掉；下次请求起效（JWT role 字段会被忽略，data-api 现查 env 拒绝）。

### 7.5 桌面端 release（GitHub Actions 自动打包 + 发布）

走 `.github/workflows/release.yml`：推 `v*` tag 触发，CI 跑 Node 24 + pnpm 10 → 类型检查 → `pnpm build` → electron-builder 打 NSIS + portable 两份 → 用 `softprops/action-gh-release@v2` 创建 GitHub Release 并附上 `.exe` 资产。

**本地发版流程**（一条命令搞定，校验工作树 + bump + commit + tag + push）：
```bash
cd desktop && pnpm release           # 交互式选 major/minor/patch
# 或
pnpm release patch                   # 直跳 patch
pnpm release 1.2.3                   # 直跳指定版本
```

底层等价于：
1. `git status --porcelain` 必须为空（工作树干净）
2. `pnpm --dir desktop version <level> --no-git-tag-version` bump `desktop/package.json`
3. `git add -A && git commit -m "release: vX.Y.Z"`
4. `git tag vX.Y.Z && git push origin <branch> --tags`
5. CI 跑完 → `https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z` 自动出现 .exe 资产

**首次配 GitHub Secrets**（仓库 Settings → Secrets and variables → Actions）：
- `VITE_AUTH_OTP_URL`（如 `https://<envId>.ap-shanghai.app.tcloudbase.com/auth-otp`）
- `VITE_DATA_API_URL`（如 `https://<envId>.ap-shanghai.app.tcloudbase.com/data-api`）
- `GITHUB_TOKEN` 自动提供，无需手动配

⚠️ **package.json version 才是 electron-builder 命名产物的依据**，不是 git tag。
修改代码 → bump version → commit → tag → push 顺序**不可颠倒**（见 §8 踩坑历史）。
- 反例：commit + tag v1.1.1 + push → CI 跑通后用 package.json 旧 version 1.1.0 发布到 v1.1.0 release（覆盖！）

## 8. 已知坑（必看）

- **Windows Defender 锁 app.asar** —— electron-builder 第二次打包报 "file used by another process" 时，给 output 加时间戳绕开：
  ```bash
  pnpm exec electron-builder --win nsis --x64 --config.directories.output="release/$(date +%Y%m%d-%H%M%S)"
  ```
  详见 agent memory。

- **NSIS 卸载"清除本地数据"复选框（`desktop/build/installer.nsh`）** —— electron-builder 自动加载 buildResources 目录下默认的 `installer.nsh`（**无需**在 package.json 配 `nsis.include`），用官方两个钩子实现"卸载时可选清除本地数据"：
  - `customUnWelcomePage`：替换默认卸载欢迎页，加复选框"同时删除本地数据（登录信息、缓存等）"，**默认不勾选**；点取消 = 放弃卸载
  - `customUnInstall`：卸载流程末尾，勾选时 `RMDir /r` 删 `%APPDATA%\course-tracker` 和 `%APPDATA%\一寸光阴`（双目录保险，实测是前者）
  - **静默卸载 `/S` 自动跳过该页面，不会删数据**
  - 业务数据（孩子/课程/打卡）全在云端 PG，删本地只丢登录态，重装需重新验证码登录，**不丢任何业务数据**
  - ⚠️ 改此文件**必须保持 UTF-8 BOM**（NSIS 解析中文必需），补 BOM：`node -e "const fs=require('fs');const p='build/installer.nsh';let b=fs.readFileSync(p);if(!(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)){b=Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]),b]);fs.writeFileSync(p,b)}"`；改完用 `pnpm exec electron-builder --win nsis --x64 --config.directories.output=release/test-nsis` 验证编译
  - 两个钩子会被模板 `!ifmacrodef` 检测并展开；怀疑失效时可在宏体内临时加 `!warning "MARKER"` 二分验证（`!warning` 会触发 warning-as-error，**验证完必须移除**）

- **Vite + Vue Router + 异步 auth bootstrap** —— `router.isReady()` 只 await 第一次 beforeEach。如果 `auth.status === 'bootstrapping'` 时守卫放行，isReady 立刻 resolve，之后 bootstrap 改 status 没人再触发 redirect。`main.ts` 必须在 `await router.isReady()` 后主动 `router.replace` 纠偏。

- **CloudBase SCF 环境变量前缀** —— `tcb config update fn` 拒绝 `SCF_/QCLOUD_/TENCENTCLOUD_` 前缀。改用普通前缀（如 `TCB_SDK_SECRET_ID`）再在函数代码里读。

- **CloudBase @cloudbase/node-sdk rdb 必须指定 schema** —— `app.rdb({ database: 'public' })` 而不是 envId。否则报 `PGRST106 Invalid schema: <envId>`。

- **CloudBase cloudbaserc.json type 字段大写** —— `"type": "HTTP"` 不是 `"http"`。

- **CloudBase RLS / service role 实测** —— 本项目 PG 角色 `service_role`（含 `cloudbase_postgres_pgdb_*` / `cloudbase_read_only_user_pgdb_*`）`rolbypassrls=true`（BYPASSRLS），云函数用 service key 直连**不受 RLS 限制**。所以收紧策略 = 删 anon policy + revoke anon 权限即可，无需给 service role 配 policy。

- **CloudBase SCF WEB_SCF + scf_bootstrap 模式下必须保留 `require.main === module` 段** —— SCF 启动 `node index.js` 后模块顶层会执行（`require.main === module` 在 SCF 也成立），SCF 把容器内 9000 端口当 fastcgi 端口接 HTTP 请求，**必须**有 `http.createServer.listen(9000)`。**不要按老 SCF Event 模式删这段 + 改用 `exports.main`**——`exports.main` 在 v3.7.3 这套环境不被调，删了之后远端返 443/404。修法：在 http.createServer 内按 `new URL(req.url).pathname` 分发到 handleXxx 函数，exports.main 保留但返个 `event_mode_not_supported` 备用。

- **GitHub 匿名 API 限流（版本检查）** —— `electron/updater.ts` 别用 Electron `net.request`（走 Chromium 网络栈/系统代理，出口 IP 易被 GitHub API 403 限流）；用 Node 原生 `https` 直连。且 API 失败会自动降级到 `releases/latest` 的 302 Location 解析版本号（网页请求不受 API 限流）。改这块时保持双通道。

- **未打包时 app.getVersion() 返回 Electron 版本号** —— dev 联调版本检查（UPDATE_CHECK=1）时 currentVersion 会变成 33.x 而非应用版本。main.ts 用 `readAppVersion()` 从 package.json 读真实版本注入 `checkForUpdates`，别去掉。

## 9. 安全 TODO（**上线前必做**）

1. 🔴 **轮换 publishable key**（已泄露在对话里）
2. 🔴 **重新启用 RLS**：把 anon key 的权限收紧，业务读写改走 cloud function（service role）
3. 🟡 **OTP /verify 改用 attempts 全局计数**（当前每条码独立 5 次，可绕过）
4. 🟡 **NSIS 代码签名**（避免 SmartScreen 警告）
5. 🟢 **写每日 PG 备份 cron**（用 `tcb fn deploy` + 定时触发）
6. 🟡 **管理员白名单审计** —— `ADMIN_EMAILS` 走 env 注入（已通过 `tcb fn config update` 而不是 cloudbaserc.json 提交），但每季度人工审计一次；admin 离职/换岗时**立即**从白名单去掉
7. 🟡 **data-api 限流** —— 当前 `/admin/*` 无 rate limit，单个 admin 误操作可把全表 owner_id 拉一遍（用户量 < 1000 时无害，但用户上量后建议加 per-IP 限流 + 加 `?limit=100&offset=N` 分页）

## 10. agent 协作约定

- **改 store / 写新表 / 改 migration** → 改完跑 `npx vue-tsc --noEmit`
- **改 cloud function** → 改完 `tcb fn deploy auth-otp -e <envId>` 部署
- **新建 cloud function** → 写完三件套（index.js / package.json / scf_bootstrap），**本地 `tcb fn run` 起 :9000 验 4 个鉴权分支**（health / 401 / 403 / 200）再 `tcb fn deploy --force --deployMode zip`
- **改 ADMIN_EMAILS** → 必须用 `tcb fn config update fn auth-otp -e <envId> -e ADMIN_EMAILS=xxx@yyy.com`，**不要**把白名单写在 cloudbaserc.json 里（被 .gitignore 包含且和密钥混一起）
- **打 release** → 必须用时间戳 output（见第 8 节坑）
- **不要** 直接改 `release/<ts>/win-unpacked/` 里的文件（asar 锁，重打会覆盖）
- **不要** 删 `release.bak.*` 目录（Defender 锁，删不动，留着就行）
- **写 memory**：跨项目适用 → `agents/mavis/memory/MEMORY.md`；仅本项目 → `desktop/AGENTS.md`
