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
- **ECharts 5** —— 统计图
- **exceljs 4** —— 导出 xlsx
- **@cloudbase/js-sdk** —— SDK 初始化（PG 走 rdb，OTP 走 fetch HTTP function）

## 2. 启动约定

- `pnpm dev` → Vite + Electron 同跑，dev 模式自动开 DevTools
- `pnpm exec electron dist-electron/main.mjs` → 生产模式启动，**默认不开 DevTools**
- 强制开：`pnpm exec electron dist-electron/main.mjs --open-devtools`（或 `OPEN_DEVTOOLS=1`）
- 主进程 IPC 走 `window.kidfs.*`（preload 暴露的 fs:userDataDir / fs:readFile / fs:writeFile / fs:saveDialog）

## 3. 渲染端架构

```
src/
├── main.ts                  # 入口
├── App.vue                  # 顶层（登录态切换 + loadBusinessData）
├── env.d.ts                 # VITE_* 类型
├── router/index.ts          # 5 页面 + 守卫
├── views/                   # 5 业务页 + Login
│   ├── Home.vue
│   ├── Courses.vue
│   ├── Checkins.vue
│   ├── Stats.vue
│   ├── Settings.vue
│   └── Login.vue
├── components/              # 通用 + 业务组件
│   ├── common/              # AppLayout / EmptyState / StatCard / AlertBanner
│   ├── child/               # ChildSwitcher / ChildCreateDialog
│   ├── course/              # CourseTable / CourseFormDialog
│   ├── checkin/             # CheckinFormDialog / CheckinTable
│   └── stats/               # CostPieChart / HoursBarChart / ChartBase
├── stores/                  # Pinia
│   ├── auth.ts              # JWT session + userRev
│   ├── children.ts          # 含 user_prefs 激活孩子同步
│   ├── courses.ts           # 客户端聚合 used/remain/单节均价
│   ├── checkins.ts          # 打卡 + 课时预校验
│   └── db.ts                # 占位（云端版本不再本地存）
├── lib/cloudbase.ts         # SDK 初始化 + otpSend/otpVerify + getActiveUid/Jwt
├── types/                   # 共享 TS 类型
├── utils/                   # date / money / excel / validators / confirm / email
└── styles/                  # Tailwind 入口 + EP 主题覆盖
```

## 4. store ↔ 云表 对应

| Pinia store | 云表 | 关键字段 |
|---|---|---|
| `auth` | email_otps（间接）/ 自签 JWT | user.{uid, email} + token |
| `children` | `children` + `user_prefs` | items, activeId, activeIdSafe |
| `courses` | `courses` | items（含客户端聚合 used/remain/单节均价） |
| `checkins` | `checkins` | items |
| `db` | (占位) | ready, dbPath='CloudBase PG' |

## 5. 课时逻辑（v0.2 已改为客户端聚合）

| 操作 | 剩余课时 | 实现位置 |
|---|---|---|
| 新增课程 | `+total_hours` | `courses.create` |
| 新增打卡 | `-hours`（**禁止剩余为负**） | `checkins.create`：客户端预校验 + DB CHECK 兜底 |
| 删除打卡 | `+hours`（回滚） | `checkins.remove` + `courses.refresh` |
| 删除课程 | 该课程下所有打卡先级联删 | UI 层 + 客户端 `courses.remove` 触发 `checkins.refresh` |

**单节课均价** = `total_amount / total_hours`，courses 列表实时计算（不冗余存）。
**已上课时** = 课程下所有打卡 hours 之和，客户端 SUM（`courses.refresh` 里二次查询 checkins 聚合）。

## 6. 预警规则

- 课时不足：`remain_hours ≤ 3` → 橙色 `low`
- 课时已完：`remain_hours ≤ 0` → 灰色 `done`
- 即将到期：`days_to_expire ∈ [0, 14]` → 橙色
- 已过期：`days_to_expire < 0` → 红色 `expired`
- 触发位置：Home.vue 顶部 `AlertBanner` + Courses.vue 表格行末 status

## 7. UI 规范

- 主题色：
  - `primary` 薄荷绿 `#3FB87A`
  - `warning` 暖橙 `#E08A1E`
  - `danger` 砖红 `#D94545`
  - 背景米绿 `#F7FAF8`
- 圆角：卡片 12px / 按钮 8px
- 表格：金额/课时右对齐，日期 `YYYY-MM-DD`
- 关键操作（删除/清空/认领旧数据）必须 `dangerousConfirm` —— 输入关键字二次确认
- 切换/保存成功用 `ElMessage`，错误用 `ElMessage.error`，长驻用 `duration: 0, showClose: true`（**限一个**）

## 8. 硬规则

1. 所有删除 = `dangerousConfirm` 二次确认（输入关键字）
2. 金额 / 课时必须 > 0（表单 validators + DB CHECK 双重保险）
3. 课时扣减禁止变负（应用层 + SQL CHECK）
4. 业务表 owner_id 必须等于 self uid（store 内强制 .eq 过滤）
5. 切换账号必须清空 children/courses/checkins store（见 `../AGENTS.md` §4.3）
6. **不弹广告**、**不引导付费**、**不收集遥测**
7. release 产物用时间戳 output 目录（`release/<ts>`）；旧 `release.bak.*` / 历史 .log 可清理（2026-08 已清理过）
8. **pnpm onlyBuiltDependencies** 让 pnpm 10 跑 electron/esbuild postinstall
9. **Electron 二进制** 走 npmmirror：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`
10. **卸载可选清除本地数据** 实现在 `build/installer.nsh`：卸载欢迎页复选框（默认不勾），勾选才删 `%APPDATA%\course-tracker`（详见 `../AGENTS.md` §8）；改此文件必须保持 UTF-8 BOM

## 9. 验收清单

### 功能

- [ ] 5 页面都能进（Home / Courses / Checkins / Stats / Settings）
- [ ] 登录 OTP 流程跑通
- [ ] 新增孩子 → 列表显示 → 编辑 → 删除
- [ ] 新增课程 → 列表显示 → 编辑 → 删除
- [ ] 新增打卡 → 课时自动扣减（客户端聚合）→ 删除打卡 → 课时回滚
- [ ] 首页预警：课时 ≤ 3 亮橙 / 到期 ≤ 14 天亮橙 / 已过期亮红
- [ ] 统计页：饼图 + 柱图 + 时间段筛选
- [ ] 跨设备登录：当前激活孩子一致（user_prefs）

### 稳定性

- [ ] 切换账号：children/courses/checkins store 完全清空
- [ ] 网络抖动：ElMessage 错误提示，不卡死
- [ ] 启动期白屏：main.ts 主动 router.replace 纠偏
- [ ] dev/prod DevTools 行为按预期

### 上线前

- [ ] tsc 通过
- [ ] electron-builder 打 NSIS + portable 不报错
- [ ] publishable key 已轮换 + RLS 已收紧
- [x] OTP 限流按 email + IP 双维度（`auth-otp` 已实现 `OTP_RATE_LIMIT_MS` + `OTP_EMAIL_HOUR_LIMIT`）
- [ ] 每日 PG 备份 cron 已部署（`pg-backup` Event 函数已写）
