# 一寸光阴 · 孩子课外班课时记账

> 家长自用的 Windows 桌面应用（Electron），记录孩子的课外培训班**课程 / 缴费 / 打卡 / 课时统计**，数据云端同步，多设备登录看到一致。

**单账号、多孩子、多课程；一键 Excel 导出；薄荷绿清爽界面 + 深/浅/跟随系统 3 档主题。**

![tech](https://img.shields.io/badge/Electron-33-47848F) ![tech](https://img.shields.io/badge/Vue-3.5-42B883) ![tech](https://img.shields.io/badge/TypeScript-5-3178C6) ![tech](https://img.shields.io/badge/Vercel-000) ![tech](https://img.shields.io/badge/Supabase-PG-3FB87A)

---

## 功能一览

| 模块 | 功能 |
|------|------|
| 🔐 **登录** | 邮箱 + 6 位验证码（OTP）或**邮箱+密码**（首次需验证码确认，30 天免登录，可随时改密） |
| 👶 **多孩子档案** | 一个账号下多个孩子，切换时数据自动过滤；激活孩子云端同步 |
| 🏠 **首页总览** | 课程数 / 总投入 / 已上课时 / 剩余课时 / 即将到期预警 |
| 📚 **课程管理** | 增删改查、自动算单节均价 + 已上/剩余课时、到期日 |
| ✅ **打卡日历** | 月历视图，格子内直接显示每门课的**课时胶囊**（科目 + 节数），点日期看当天明细 |
| 📈 **统计分析** | ECharts 饼图 + 柱图 + 时间段筛选（图表自动跟随主题） |
| 📊 **Excel 导出** | 可选孩子 / 多选科目 / 上课时间范围；**每门课程一个 sheet**（课程信息 + 课时明细 + 汇总），排版工整 |
| 🎨 **主题切换** | 深色 / 浅色 / 跟随系统；localStorage 兜底，云端同步 best-effort |
| 🔄 **自动更新** | 启动时检查 GitHub Release，有新版本弹窗提示 |

## 快速上手

```powershell
# 环境要求：Node.js ≥ 20、pnpm ≥ 10、Windows 10/11

# 国内加速装依赖（electron 二进制走镜像）
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm install

# 开发模式（Vite + Electron 同跑，自动开 DevTools）
pnpm dev
# 或只跑 Vite 不开 Electron
pnpm dev:web
```

打安装包（推荐走 CI，见 `docs/release-guide.md`）：

```powershell
cd desktop
pnpm build:win          # NSIS 安装包
pnpm build:win:portable # portable 绿色版
```

**下载已发布版本**：<https://github.com/wangshaojie/electron-kid-course-tracker/releases>

## 仓库结构

```
kid-course-tracker/
├── desktop/                  # Electron 桌面端
│   ├── electron/             #   主进程 + preload（窗口/更新/IPC）
│   ├── src/                  #   Vue 渲染端（views / stores / components / utils / styles）
│   │   ├── stores/           #     Pinia（auth / children / courses / checkins / **theme**）
│   │   ├── styles/           #     Tailwind + theme.css（3 档主题 CSS 变量）
│   │   └── utils/            #     chartTheme（ECharts 主题适配） + excel / validators
│   ├── scripts/              #   一次性迁移脚本（theme-migration/）+ 构建脚本
│   ├── build/                #   NSIS installer.nsh（卸载可选清数据）
│   └── README.md             #   桌面端开发文档（含 .env 配置、FAQ）
├── vercel/                   # Vercel Functions（自托管 HTTP API）
│   ├── api/
│   │   ├── auth-otp.js       #   发码/验码/密码登录/注册/改密（scrypt + 自签 JWT）
│   │   └── data-api.js       #   业务 CRUD（/b/*）
│   ├── lib/                  #   db.js（postgres 池） + auth.js（JWT 校验）
│   └── vercel.json           #   rewrites：/api/data-api/* → /api/data-api?path=*
├── supabase/
│   └── migrations/           #   SQL migration（按文件名升序手动应用）
│       ├── 20260908000001_init_schema.sql
│       ├── 20260908000002_harden_security.sql
│       ├── 20260908000003_daily_backup_cron.sql
│       └── 20260909140000_user_prefs_theme.sql     # v0.4.6 加 theme 列
├── docs/
│   ├── release-guide.md      # CI 发版流程（已替换 v0.4.6 实际命令）
│   └── migrate-to-supabase.md  # 历史：CloudBase → Supabase 迁移手册
└── AGENTS.md                 # 架构文档（部署视图 / 时序图 / 数据流）
```

## 架构亮点

```
Electron 桌面端 (Vue 3.5 + Pinia + Element Plus)
        │  Bearer JWT（自签，30 天有效）
        ▼
Vercel Functions（Node 20，自托管）
├─ /api/auth-otp   发码/验码/注册/改密/密码登录（scrypt + 自签 JWT）
└─ /api/data-api   业务 CRUD（/b/*）
        │  postgres 直连（postgres 角色，BYPASSRLS）
        ▼
Supabase PostgreSQL
├─ children / courses / checkins / user_prefs / email_otps / user_passwords
├─ RLS 已开 + FORCE + anon/authenticated 权限已 revoke → anon key 泄露也读不到
└─ pg_cron 每日备份 → backups 表
```

- **数据隔离**：业务读写全部走 `vercel/api/data-api.js`，`owner_id` 由服务端从 JWT 强制注入（前端传的一律忽略）；表名/写入列/过滤列/排序列全白名单
- **uid 稳定**：`uid = sha256(email).slice(0,32)`，跨设备一致
- **时序图 / 数据流 / 迁移约定** 见 [`AGENTS.md`](AGENTS.md)

## 技术栈

- **桌面端**：Electron 33 · Vue 3.5 · TypeScript · Pinia · Element Plus · Tailwind CSS · ECharts · ExcelJS
- **后端**：Vercel Functions（Node 20，HTTP API）· postgres.js · Supabase PG · Resend（邮件）
- **打包**：Vite · electron-builder（NSIS + portable）
- **CI**：GitHub Actions（监听 `v*` tag → 自动 build + 上传 release 资产）

## 隐私说明

- 数据同步到 Supabase PG（自己账号的数据只有自己能读写）
- 邮箱不存原文主键，只存 `sha256` 摘要；user_prefs 跨设备同步主题
- 不弹广告、不收集遥测、不上传任何第三方统计
- 设置页可随时导出 Excel 备份

## License

Apache-2.0

