# 一寸光阴 · 孩子课外班课时记账

> 家长自用的 Windows 桌面应用（Electron），记录孩子的课外培训班**课程 / 缴费 / 打卡 / 课时统计**，数据云端同步，多设备登录看到一致。

**单账号、多孩子、多课程；一键 Excel 导出；薄荷绿清爽界面。**

![tech](https://img.shields.io/badge/Electron-33-47848F) ![tech](https://img.shields.io/badge/Vue-3.5-42B883) ![tech](https://img.shields.io/badge/TypeScript-5-3178C6) ![tech](https://img.shields.io/badge/CloudBase-PG-3FB87A)

---

## 功能一览

| 模块 | 功能 |
|------|------|
| 🔐 **登录** | 邮箱 + 6 位验证码（OTP），30 天免登录；也支持**密码登录**（首次需验证码确认，可随时重置） |
| 👶 **多孩子档案** | 一个账号下多个孩子，切换时数据自动过滤；激活孩子云端同步 |
| 🏠 **首页总览** | 课程数 / 总投入 / 已上课时 / 剩余课时 / 即将到期预警 |
| 📚 **课程管理** | 增删改查、自动算单节均价 + 已上/剩余课时、到期日 |
| ✅ **打卡日历** | 月历视图，格子内直接显示每门课的**课时胶囊**（科目 + 节数），点日期看当天明细 |
| 📈 **统计分析** | ECharts 饼图 + 柱图 + 时间段筛选 |
| 📊 **Excel 导出** | 可选孩子 / 多选科目 / 上课时间范围；**每门课程一个 sheet**（课程信息 + 课时明细 + 汇总），排版工整 |
| 🛡 **管理员后台** | 注册用户统计 + 用户列表（env 白名单鉴权，即时生效） |
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

打安装包：

```powershell
cd desktop
pnpm build:win          # NSIS 安装包
pnpm build:win:portable # portable 绿色版
```

**下载已发布版本**：<https://github.com/wangshaojie/electron-kid-course-tracker/releases>

## 仓库结构

```
kid-course-tracker/
├── desktop/                # Electron 桌面端
│   ├── electron/           #   主进程 + preload（窗口/更新/IPC）
│   ├── src/                #   Vue 渲染端（views / stores / components / utils）
│   └── README.md           #   桌面端开发文档（含 .env 配置、FAQ）
├── cloudbase/              # CloudBase 云端资产
│   ├── functions/
│   │   ├── auth-otp/       #   HTTP 云函数：发码/验码/签 JWT/密码登录
│   │   ├── data-api/       #   HTTP 云函数：业务 CRUD（owner_id 服务端强制注入）
│   │   └── pg-backup/      #   定时任务：每日 PG 备份
│   └── migrations/         #   SQL migration（按文件名升序执行）
├── cloudbaserc.json        # CloudBase 部署配置
└── AGENTS.md               # 架构文档（部署视图 / 时序图 / 数据流）
```

## 架构亮点

```
Electron 桌面端 (Vue 3 + Pinia)
        │  Bearer JWT
        ▼
CloudBase HTTP 云函数 (auth-otp / data-api)
        │  service role
        ▼
CloudBase PostgreSQL (children / courses / checkins / user_prefs / email_otps / user_passwords)
```

- **数据隔离**：业务读写全部走 `data-api` 云函数，`owner_id` 由服务端从 JWT 强制注入（前端传的一律忽略）；PG 已开 RLS 并删除 anon 权限，直连 PostgREST 也会被拒
- **uid 稳定**：`uid = sha256(email).slice(0,32)`，跨设备一致
- **管理员**：`ADMIN_EMAILS` env 白名单，每次请求现查，增删立即生效，不信任 JWT 里的 role
- 详细时序图 / 数据流 / 迁移约定见 [`AGENTS.md`](AGENTS.md)

## 技术栈

- **桌面端**：Electron 33 · Vue 3.5 · TypeScript · Pinia · Element Plus · Tailwind CSS · ECharts · ExcelJS
- **云端**：CloudBase 云函数（Node.js）· PostgreSQL · Resend（邮件）
- **打包**：Vite · electron-builder（NSIS）

## 隐私说明

- 数据同步到 CloudBase PG（自己账号的数据只有自己能读写）
- 邮箱不存原文主键，只存 `sha256` 摘要
- 不弹广告、不收集遥测、不上传任何第三方统计
- 设置页可随时导出 Excel 备份

## License

Apache-2.0
