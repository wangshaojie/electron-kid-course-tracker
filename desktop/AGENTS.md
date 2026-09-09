# desktop/AGENTS.md —— 桌面端约定

> 父级约定见 `../AGENTS.md`（架构、目录、部署、坑）。本文只讲桌面端独有的。

## 1. 技术栈

- **Electron 33** —— Windows 桌面壳，主进程 TypeScript，渲染端走 Vite
- **Vue 3.5** + `<script setup lang="ts">` + TypeScript 严格模式
- **Vite 5** —— 渲染端构建，路径别名 `@` → `src/`
- **Element Plus 2.8** —— 组件库（卡片风，**不是默认蓝色后台风**）
- **Tailwind CSS 3** —— 布局/间距/配色补充
- **Pinia** —— 状态管理
- **Vue Router 4** —— hash 模式
- **ECharts 5** —— 统计图（配色跟随主题）
- **exceljs 4** —— 导出 xlsx

> 历史：`@cloudbase/js-sdk` 在 v0.4.x 已脱钩，`lib/cloudbase.ts` 文件名沿用但内容已切换到 Vercel HTTP API。详见 §6。

## 2. 启动约定

- `pnpm dev` → Vite + Electron 同跑，dev 模式自动开 DevTools
- `pnpm exec electron dist-electron/main.mjs` → 生产模式启动，**默认不开 DevTools**
- 强制开：`pnpm exec electron dist-electron/main.mjs --open-devtools`（或 `OPEN_DEVTOOLS=1`）
- 主进程 IPC 走 `window.kidfs.*`（preload 暴露的 fs:userDataDir / fs:readFile / fs:writeFile / fs:saveDialog）
- 主题应用：`main.ts` 早期在 `auth.bootstrap()` 之前直接调 `useThemeStore().applyTheme()`，避免首屏闪白

## 3. 渲染端架构

```
src/
├── main.ts                  # 入口：theme 早期应用 + auth bootstrap → router.isReady → mount
├── App.vue                  # 顶层：登录态切换 + loadBusinessData + theme sync
├── env.d.ts                 # VITE_* 类型
├── router/index.ts          # 6 页面 + 守卫（Home/Courses/Checkins/Stats/Settings/Login/Admin）
├── views/
│   ├── Home.vue             # 总览 + 预警
│   ├── Courses.vue
│   ├── Checkins.vue
│   ├── Stats.vue
│   ├── Settings.vue         # 主题 / 改密 / 导出 / 认领旧数据
│   ├── Login.vue            # OTP / 密码 / 注册
│   └── Admin.vue            # 管理员后台（ADMIN_EMAILS 白名单）
├── components/
│   ├── common/              # AppLayout / EmptyState / StatCard / AlertBanner
│   ├── child/               # ChildSwitcher / ChildCreateDialog
│   ├── course/              # CourseTable / CourseFormDialog
│   ├── checkin/             # CheckinFormDialog / CheckinTable / CheckinCalendar
│   ├── stats/               # CostPieChart / HoursBarChart / ChartBase（跟随主题）
│   ├── account/             # ChangePasswordDialog / ForgotPasswordDialog / RegisterDialog / PasswordStatusCard
│   └── brand/               # BrandLogo
├── stores/                  # Pinia
│   ├── auth.ts              # JWT session + userRev（role: 'user' | 'admin'）
│   ├── children.ts          # 含 user_prefs 激活孩子同步（children + user_prefs 并行拉取）
│   ├── courses.ts           # 客户端聚合 used/remain/单节均价
│   ├── checkins.ts          # 打卡 + 课时预校验
│   ├── theme.ts             # 3 档主题（dark/light/system）+ localStorage 兜底 + user_prefs 云端同步 best-effort
│   └── db.ts                # 占位（云端版本不再本地存）
├── styles/
│   ├── index.css            # Tailwind 入口
│   └── theme.css            # 3 档主题 CSS 变量（:root / [data-theme=light] / [data-theme=dark] / @media prefers-color-scheme）
├── lib/cloudbase.ts         # 已脱钩 CloudBase；提供 otpSend/otpVerify + businessApi() + JWT session
├── utils/
│   ├── chartTheme.ts        # ECharts 主题：动态读 CSS 变量，computed 跟随 theme.mode
│   ├── courseColor.ts
│   ├── date.ts / money.ts / excel.ts / validators.ts / confirm.ts / email.ts
├── types/                   # 共享 TS 类型
└── scripts/theme-migration/ # 一次性迁移脚本（保留供回溯，不要重跑）
```

## 4. store ↔ 云表 对应

| Pinia store | 云表 | 关键字段 | 备注 |
|---|---|---|---|
| `auth` | email_otps（间接）/ 自签 JWT | user.{uid, email, role} + token | role 从 JWT payload 读，不信前端传 |
| `children` | `children` + `user_prefs` | items, activeId, activeIdSafe | `load()` 用 `Promise.all` 并行 |
| `courses` | `courses` | items（含客户端聚合 used/remain/单节均价） | |
| `checkins` | `checkins` | items | |
| `theme` | `user_prefs.theme` | mode: dark/light/system | 远端不可用自动降级为本地 LS |
| `db` | (占位) | ready, dbPath='Supabase PG' | 兼容旧代码引用 |

**owner_id 强制注入**：`vercel/api/data-api.js` 服务端从 JWT 解析 uid，前端传的 `owner_id` 一律忽略。

## 5. 课时逻辑（v0.2 已改为客户端聚合）

| 操作 | 剩余课时 | 实现位置 |
|---|---|---|
| 新增课程 | `+total_hours` | `courses.create` |
| 新增打卡 | `-hours`（**禁止剩余为负**） | `checkins.create`：客户端预校验 + DB CHECK 兜底 |
| 删除打卡 | `+hours`（回滚） | `checkins.remove` + `courses.refresh` |
| 删除课程 | 该课程下所有打卡先级联删 | UI 层 + 客户端 `courses.remove` 触发 `checkins.refresh` |

**单节课均价** = `total_amount / total_hours`，courses 列表实时计算（不冗余存）。
**已上课时** = 课程下所有打卡 hours 之和，客户端 SUM（`courses.refresh` 里二次查询 checkins 聚合）。

## 6. 后端 API 约定

业务读写 **全部走** `vercel/api/data-api.js`（Vercel HTTP Function）：

- `GET    /api/data-api/health` → 健康检查
- `GET    /api/data-api/b/children?order=sort_order&asc=true` → 列表
- `GET    /api/data-api/b/children/:id` → 单条
- `POST   /api/data-api/b/children` → 新增（`owner_id` 服务端注入）
- `PATCH  /api/data-api/b/children/:id` → 更新
- `PATCH  /api/data-api/b/user_prefs` → 按 `owner_id` upsert（无 id 走 upsert）
- `DELETE /api/data-api/b/children/:id` → 删除
- `GET    /api/data-api/admin/stats` → 管理员统计（4 数字 + 覆盖率）
- `GET    /api/data-api/admin/users` → 注册用户表（LIMIT 10000 防 Function 超时）

**鉴权**：`Authorization: Bearer <jwt>`，uid = `sha256(email).slice(0,32)`。
**管理员**：`requireAdminAsync()` 每次现查 `ADMIN_EMAILS` env（不依赖 JWT 里的 role）。

**`/auth-otp`**：

- `POST /api/auth-otp/send` → 发 6 位码（限流：IP 60s + 邮箱每小时 5 封）
- `POST /api/auth-otp/verify` → 校验 + 签 JWT（uid, email, role）
- `POST /api/auth-otp/login` → 邮箱+密码（scrypt 比对）
- `POST /api/auth-otp/register` → 注册（OTP 确认 + 写 user_passwords）
- `POST /api/auth-otp/set-password` / `POST /api/auth-otp/reset-password` → 改密 / 找回（OTP 确认）
- `POST /api/auth-otp/change-password` → 已登录用户改密（需 Bearer）
- `GET  /api/auth-otp/health` / `GET /api/auth-otp/password-status` → 检查

**前端封装**：`lib/cloudbase.ts` 的 `businessApi()` / `otpSend()` / `otpVerify()` 等。**不要直接 fetch URL**。

## 7. 主题系统（v0.4.6 新增）

3 档：**dark** / **light** / **system**

**设计**：

- `applyTheme()` 纯本地操作，不依赖网络，立即生效
- `persistRemote()` best-effort 写云端，失败打 warn 不影响 UI
- 启动早期 `main.ts` 直接调 `applyTheme()` 走 localStorage，避免闪屏
- 登录后 / uid 变化时从 `user_prefs.theme` 同步过来（多设备一致）

**`stores/theme.ts` capability 检测**：

- 远端可用 → 正常读/写
- 远端不可用（列不存在 / 400 / PG 42703） → 静默降级为只本地，后续不再尝试
- console.warn **只打一次**（`_remoteAvailable` 永久置 false 防止刷屏）

**颜色**：

- `styles/theme.css` 定义 `--page-bg-1` / `--card-bg` / `--text-title` 等 CSS 变量
- 三档分组：`:root, [data-theme='light']` / `[data-theme='dark']` / `@media (prefers-color-scheme: dark)`
- 组件样式**不**写硬编码颜色（用 `var(--xxx)`）

**ECharts**：

- `utils/chartTheme.ts` 的 `getEchartsTheme()` 读 `getComputedStyle(:root)` 拿真实值
- `Stats.vue` 用 `computed(() => useThemeStore().resolved)` 自动跟随

**新增颜色**：不要重跑 `scripts/theme-migration/`，直接改 `theme.css` 变量值。

## 8. UI 规范

- **主题色**（薄荷绿 / 暖橙 / 砖红，**通过 CSS 变量引用**）：
  - `primary` `--brand-primary` #3FB87A
  - `warning` `--brand-warning` #E08A1E
  - `danger`  `--brand-danger`  #D94545
  - 背景米绿 `--page-bg-base` #F7FAF8（浅）/ 暗色 `#0a0e1a`（深）
- **圆角**：卡片 12px / 按钮 8px
- **表格**：金额/课时右对齐，日期 `YYYY-MM-DD`
- **关键操作**（删除/清空/认领）必须 `dangerousConfirm` —— 输入关键字二次确认
- **Toast**：用 `ElMessage`，错误用 `ElMessage.error`，长驻用 `duration: 0, showClose: true`（**限一个**）
- **主题切换按钮**：侧栏底部 🌙 / ☀️ 文字 + emoji，3 档循环

## 9. 硬规则

1. 所有删除 = `dangerousConfirm` 二次确认（输入关键字）
2. 金额 / 课时必须 > 0（表单 validators + DB CHECK 双重保险）
3. 课时扣减禁止变负（应用层 + SQL CHECK）
4. 业务表 owner_id 必须等于 self uid（store 内强制 .eq 过滤 + 服务端二次注入）
5. 切换账号必须清空 children/courses/checkins store（见 `../AGENTS.md` §4.3）
6. **不弹广告**、**不引导付费**、**不收集遥测**
7. **release 走 CI**（推 `v*` tag 自动 build + 上传），**不要本地手动 build** 重复造轮子
8. **pnpm onlyBuiltDependencies** 让 pnpm 10 跑 electron/esbuild postinstall
9. **Electron 二进制** 走 npmmirror：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`
10. **卸载可选清除本地数据** 实现在 `build/installer.nsh`：卸载欢迎页复选框（默认不勾），勾选才删 `%APPDATA%\course-tracker`（详见 `../AGENTS.md` §8）；改此文件必须保持 UTF-8 BOM
11. **package.json 必显式补 `repository` 字段**（v0.4.5 CI 修复，electron-builder NSIS 写 `latest.yml` 必需）

## 10. 验收清单

### 功能

- [ ] 6 页面都能进（Home / Courses / Checkins / Stats / Settings / **Admin**）
- [ ] 登录 OTP 流程跑通
- [ ] 密码登录 / 改密 / 忘记密码 流程跑通
- [ ] 主题切换 3 档可用：深 / 浅 / 跟随系统
- [ ] 主题刷新页面不闪屏（localStorage 兜底）
- [ ] 主题多设备同步（需先跑 `supabase/migrations/20260909140000_user_prefs_theme.sql`）
- [ ] 新增孩子 → 列表显示 → 编辑 → 删除
- [ ] 新增课程 → 列表显示 → 编辑 → 删除
- [ ] 新增打卡 → 课时自动扣减（客户端聚合）→ 删除打卡 → 课时回滚
- [ ] 首页预警：课时 ≤ 3 亮橙 / 到期 ≤ 14 天亮橙 / 已过期亮红
- [ ] 统计页：饼图 + 柱图 + 时间段筛选（图表跟随主题变色）
- [ ] 跨设备登录：当前激活孩子一致（user_prefs）
- [ ] 管理员后台：白名单邮箱能看到统计 + 用户列表

### 稳定性

- [ ] 切换账号：children/courses/checkins store 完全清空
- [ ] 网络抖动：ElMessage 错误提示，不卡死
- [ ] 启动期白屏：main.ts 主动 router.replace 纠偏
- [ ] 主题系统降级：远端不可用时不刷屏 warn（_remoteAvailable 永久 false）
- [ ] dev/prod DevTools 行为按预期

### 上线前

- [ ] tsc 0 错误（`pnpm exec vue-tsc --noEmit`）
- [ ] electron-builder 打 NSIS + portable 不报错
- [x] **轮换 publishable key**（迁移 Vercel 后不再需要，Supabase anon key 仅本地调试）
- [x] **RLS 已收紧** + anon 权限已 revoke
- [x] **OTP 限流按 email + IP 双维度**（`auth-otp` 已实现 `OTP_RATE_LIMIT_MS` + `OTP_EMAIL_HOUR_LIMIT`）
- [x] **每日 PG 备份 cron**（Supabase 端 `pg_cron`）
- [x] **package.json 显式补 `repository` 字段**（v0.4.5 CI 修复）
- [ ] **NSIS 代码签名**（避免 SmartScreen 警告）
- [ ] CI 产物（NSIS + portable + blockmap + latest.yml）齐
