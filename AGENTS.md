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
│  │    GET  /health  健康检查                            │
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
│  ⚠️  RLS 当前关闭（migration 20260813055506）           │
│     业务侧用 .eq('owner_id', uid) 显式过滤              │
└────────────────────────────────────────────────────────┘
                       │ PostgREST (anon key)
                       ▲
       渲染端 SDK db.from('children').eq('owner_id', uid)
```

**数据隔离**：靠前端注入 `owner_id` 过滤（因为 RLS 关了）。**生产前必须**重新开 RLS（详见第 9 节 TODO）。

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
    Store -->|getActiveUid()<br/>db.from().eq('owner_id')| Lib
    Lib -->|PostgREST| PG

    UI -.sendCode.-> Otp
    Otp -->|写 email_otps| PG
    Otp -->|发邮件| Resend
    Otp -.verify (签 JWT).-> UI

    Backup -.定时触发.-> PG
    Backup -->|INSERT backups| PG
```

**关键边界**：
- 渲染端**只走** PostgREST（`@cloudbase/js-sdk` 的 `app.rdb`），**不**直接调 cloud function
- 业务读写权限 = anon publishable key + RLS disable + 前端 .eq('owner_id', uid) 三件套
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
│   │   └── 20260814130000_backups_anon.sql
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

### 4.1 鉴权流程

1. 用户在 `Login.vue` 输邮箱 → `auth.sendCode()` → 调云函数 `/send` → 邮件发 6 位码
2. 输码 → `auth.verifyCode()` → 调云函数 `/verify` → 拿到 `{ token, uid, email }`
3. `persistSession(token, user, remember)`：
   - `remember=true` → localStorage（30 天免登录）
   - `remember=false` → sessionStorage（关 tab 即失效）
4. `auth.bootstrap()` 在 `main.ts` 启动时从 storage 恢复

### 4.2 业务数据流

- **所有业务表 owner_id 必须是 self uid**（不允许跨账号读写）
- 渲染端 store 直接走 `db.from(table).eq('owner_id', uid)`，**不做二次过滤**（RLS 是兜底，当前已关）
- 课时扣减：客户端预校验（used + hours > total 报错） + 数据库 CHECK
- 激活孩子同步：见 `stores/children.ts` → `user_prefs` 表

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

# 跑在生产模式（不自动开 DevTools；想开就 --open-devtools）
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

### 6.2 字段约定

- 所有业务表 `owner_id TEXT NOT NULL`：账号 uid（= `sha256(email).slice(0,32)`）
- 业务外键（child_id/course_id）用 TEXT 而非 FK：CloudBase PG 的 RLS 隔离下跨表 FK 经常被绕过
- 索引：`(owner_id, sort_order)`、`(child_id)`、`(paid_at DESC)`、`(expires_at)`

### 6.3 migration 怎么加

文件名格式 `YYYYMMDDHHMMSS_xxx.sql`，数字前缀保证按时间顺序跑。
```bash
# 跑全部 migration
tcb db execute -e <envId> --sql "$(cat cloudbase/migrations/xxx.sql)"
# 或分多条跑（DDL 一条一条更稳）
```

## 7. 部署

### 7.1 云函数

```bash
# 单函数部署
tcb fn deploy auth-otp -e <envId>
# 走 cloudbaserc.json
tcb fn deploy --config-file cloudbaserc.json
```

### 7.2 路由

云函数 `auth-otp` 暴露 HTTP，必须加 `WEB_SCF` 类型路由（不是默认的 `SCF`）：
```bash
tcb routes add -d '{"routes":[{"path":"/auth-otp","upstreamResourceType":"WEB_SCF","upstreamResourceName":"auth-otp","method":["GET","POST"]}]}'
```

### 7.3 数据库

migration 改完直接 `tcb db execute` 跑；不推荐自动 migration（脚本会改 schema 风险大）。

## 8. 已知坑（必看）

- **Windows Defender 锁 app.asar** —— electron-builder 第二次打包报 "file used by another process" 时，给 output 加时间戳绕开：
  ```bash
  pnpm exec electron-builder --win nsis --x64 --config.directories.output="release/$(date +%Y%m%d-%H%M%S)"
  ```
  详见 agent memory。

- **Vite + Vue Router + 异步 auth bootstrap** —— `router.isReady()` 只 await 第一次 beforeEach。如果 `auth.status === 'bootstrapping'` 时守卫放行，isReady 立刻 resolve，之后 bootstrap 改 status 没人再触发 redirect。`main.ts` 必须在 `await router.isReady()` 后主动 `router.replace` 纠偏。

- **CloudBase SCF 环境变量前缀** —— `tcb config update fn` 拒绝 `SCF_/QCLOUD_/TENCENTCLOUD_` 前缀。改用普通前缀（如 `TCB_SDK_SECRET_ID`）再在函数代码里读。

- **CloudBase @cloudbase/node-sdk rdb 必须指定 schema** —— `app.rdb({ database: 'public' })` 而不是 envId。否则报 `PGRST106 Invalid schema: <envId>`。

- **CloudBase cloudbaserc.json type 字段大写** —— `"type": "HTTP"` 不是 `"http"`。

- **CloudBase RLS 对 service role 不自动 bypass** —— secretId/secretKey 走 PostgREST 时默认 anon/authenticated 角色。RLS 启用时必须给 anon/authenticated 加 policy，或 disable RLS。

- **GitHub 匿名 API 限流（版本检查）** —— `electron/updater.ts` 别用 Electron `net.request`（走 Chromium 网络栈/系统代理，出口 IP 易被 GitHub API 403 限流）；用 Node 原生 `https` 直连。且 API 失败会自动降级到 `releases/latest` 的 302 Location 解析版本号（网页请求不受 API 限流）。改这块时保持双通道。

- **未打包时 app.getVersion() 返回 Electron 版本号** —— dev 联调版本检查（UPDATE_CHECK=1）时 currentVersion 会变成 33.x 而非应用版本。main.ts 用 `readAppVersion()` 从 package.json 读真实版本注入 `checkForUpdates`，别去掉。

## 9. 安全 TODO（**上线前必做**）

1. 🔴 **轮换 publishable key**（已泄露在对话里）
2. 🔴 **重新启用 RLS**：把 anon key 的权限收紧，业务读写改走 cloud function（service role）
3. 🟡 **OTP /verify 改用 attempts 全局计数**（当前每条码独立 5 次，可绕过）
4. 🟡 **NSIS 代码签名**（避免 SmartScreen 警告）
5. 🟢 **写每日 PG 备份 cron**（用 `tcb fn deploy` + 定时触发）

## 10. agent 协作约定

- **改 store / 写新表 / 改 migration** → 改完跑 `npx vue-tsc --noEmit`
- **改 cloud function** → 改完 `tcb fn deploy auth-otp -e <envId>` 部署
- **打 release** → 必须用时间戳 output（见第 8 节坑）
- **不要** 直接改 `release/<ts>/win-unpacked/` 里的文件（asar 锁，重打会覆盖）
- **不要** 删 `release.bak.*` 目录（Defender 锁，删不动，留着就行）
- **写 memory**：跨项目适用 → `agents/mavis/memory/MEMORY.md`；仅本项目 → `desktop/AGENTS.md`
