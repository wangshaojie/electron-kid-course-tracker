# 一寸光阴 Release 流程（手动推 tag 指南）

> 给开发者手动发版用。整套流程已经接好 GitHub Actions，推 `v*` tag 就会自动跑 CI 打包 + 上传 GitHub Release。
>
> 第一次接 CI 时需要把环境变量塞到 GitHub Secrets（下面有说明），之后每次发版就是一条命令的事。

## 0. 前置条件（只配一次）

### GitHub Secrets 配齐 4 个

打开 https://github.com/wangshaojie/electron-kid-course-tracker/settings/secrets/actions
点 `New repository secret`，依次加：

| Name | Value 来源 |
|---|---|
| `VITE_CLOUDBASE_ENV_ID` | `kid-course-tracker-d6c2816e966b5` |
| `VITE_CLOUDBASE_ACCESS_KEY` | 复制 `desktop/.env.production` 第 6 行 `VITE_CLOUDBASE_ACCESS_KEY=` 后面的整段（以 `eyJhbGciOi...` 开头） |
| `VITE_AUTH_OTP_URL` | `https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/auth-otp` |
| `VITE_DATA_API_URL` | `https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/data-api` |

**4 个 secret 缺一不可**，漏一个 → 装的 .exe 启动白屏（Vite build 时 throw 进 bundle）。
详细诊断见 [§5 踩坑历史](#5-踩坑历史白屏与修复)。

> `GITHUB_TOKEN` 是 GitHub Actions 自动注入的，不用手动配。

---

## 1. 日常发版流程（一条命令）

```powershell
cd desktop
pnpm release patch
```

脚本（`scripts/release.mjs`）自动做：
1. 校验工作树干净（`git status --porcelain` 必须为空）
2. `pnpm version patch` bump `desktop/package.json` 的 version
3. 显示接下来要执行的命令 + 最近 5 条 commit，**等你确认**（`[y/N]`，输 y 才继续）
4. `git add -A && git commit -m "release: vX.Y.Z"`
5. `git tag vX.Y.Z && git push origin main --tags`

### 选 bump 类型

```powershell
pnpm release           # 交互式：1=patch / 2=minor / 3=major
pnpm release patch     # 0.2.2 → 0.2.3（bug 修复）
pnpm release minor     # 0.2.2 → 0.3.0（新功能）
pnpm release major     # 0.2.2 → 1.0.0（不兼容改动）
pnpm release 1.2.3     # 直接跳到指定版本号
```

---

## 2. 推完 tag 之后

`git push origin main --tags` 一打，CI 立刻跑：

https://github.com/wangshaojie/electron-kid-course-tracker/actions

完整流程（5-10 分钟）：

```
1. 拉代码（actions/checkout@v4）
2. 装 Node 24 LTS（从 nodejs.org 下 zip 解压，不用 actions/setup-node）
3. 装 pnpm@10（npm install -g pnpm@10）
4. pnpm install 装依赖
5. vue-tsc --noEmit 类型检查
6. pnpm run build 编译 renderer + main（4 个 VITE_* secret 全部透传）
7. electron-builder 打 NSIS 安装包
8. electron-builder 打 portable 免安装版
9. softprops/action-gh-release@v2 创建 GitHub Release
   - 名字：一寸光阴 vX.Y.Z
   - Assets：2 个 .exe + Source code (zip) + Source code (tar.gz)
```

跑通后自动创建：
https://github.com/wangshaojie/electron-kid-course-tracker/releases/tag/vX.Y.Z

---

## 3. CI 失败时怎么修

进 https://github.com/wangshaojie/electron-kid-course-tracker/actions
点失败的 run → 展开失败 step → 复制红字日志。

常见 3 类报错：

### 3.1 找不到 pnpm

**症状**：`Error: Unable to locate executable file: pnpm`

**根因**：本项目的 workflow 不依赖 `actions/setup-node` 的 pnpm cache（之前用 setup-node 时它的 post-action 会嗅探 pnpm-lock.yaml，但 pnpm 还没装 → 报错）。如果你看到 setup-node 还在跑，那是因为本地有 stale 的 `node_modules` 或 action cache。

**修法**：
- 确认 `.github/workflows/release.yml` 里**没有** `uses: actions/setup-node@v4`（应该是自己下 Node zip）
- 确认 `VITE_*` secret 全部配齐（漏一个会触发一堆奇怪的 build 错误）

### 3.2 type 错误 / build 错误

**症状**：`vue-tsc` 报类型错；或者 `electron-builder` 报文件路径错误

**修法**：本地先跑 `pnpm exec vue-tsc --noEmit` 和 `pnpm run build` 复现，修完再 push

### 3.3 Release 创建失败

**症状**：`Pattern 'desktop/release/.../TimeWell-*.exe' does not match any files`

**根因**：electron-builder 没把 .exe 放到预期路径。检查 `desktop/package.json` 的 `directories.output`（应该是 `release/${version}`）和 `artifactName`（应该是 `TimeWell-${version}-${arch}.${ext}` 和 `TimeWell-${version}-portable-${arch}.${ext}`）。

**手动重跑**（不需要重打 tag）：
1. 进 https://github.com/wangshaojie/electron-kid-course-tracker/actions/workflows/release.yml
2. 右上角 `Run workflow` → 选 `main` → version 输入框填 `v0.2.2`（**带 v 前缀**） → 绿色按钮

---

## 4. 重打 / 跳过版本

### 重打某个版本（比如 0.2.2 跑挂了想重做）

```powershell
# 1. 删远端旧 tag
git push origin :refs/tags/v0.2.2

# 2. 在 main HEAD 上重新打 tag
git tag v0.2.2
git push origin v0.2.2
# → 触发 on.push.tags: ['v*']，CI 重跑
```

### 跳过某个版本

```powershell
# 比如 0.2.2 跑挂了，直接做 0.2.3
cd desktop
pnpm version patch --no-git-tag-version
# 改 desktop/package.json
git add -A && git commit -m "release: v0.2.3"
git tag v0.2.3
git push origin main --tags
```

### 手动 Run workflow（不通过 tag）

进 https://github.com/wangshaojie/electron-kid-course-tracker/actions/workflows/release.yml
右上角 `Run workflow` → 选 `main` → version 填 `v0.2.2`（带 v 前缀） → 绿色按钮。

⚠️ **手动 Run workflow 时，GitHub 不会自动 bump package.json 的 version**，产物名仍按 package.json 当前的 version。所以如果想手动跑 + 重命名 release，建议先把 package.json version 改了再 Run。

---

## 5. 踩坑历史（白屏与修复）

### v0.2.0 之前：手动发版

```
本地 pnpm build:win 打 .exe
手撕 GitHub Release 页面，上传 .exe + 写 release notes
```

问题：每次都得手动操作，容易漏；产物跟 main HEAD 不一致。

### v0.2.1：CI 接通了但白屏

CI 跑通了，下载装的 .exe 启动白屏。

**诊断**：解 `app.asar` → 看 `dist/assets/index-*.js`：
```js
const QIe="https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/auth-otp";
const ZIe="https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/data-api";
throw new Error("VITE_CLOUDBASE_ENV_ID 未设置（.env.development）");
```

`VITE_AUTH_OTP_URL` / `VITE_DATA_API_URL` 都正确，但 `VITE_CLOUDBASE_ENV_ID` 是空的 → vite build 时 `if (!envId) throw` 被 rollup 保留进 bundle → 启动就 throw → Vue mount 失败 → 白屏。

**根因**：CI workflow 只透传了 `VITE_AUTH_OTP_URL` / `VITE_DATA_API_URL` 2 个 secret，漏了 `VITE_CLOUDBASE_ENV_ID` / `VITE_CLOUDBASE_ACCESS_KEY`。本地 `.env.production` 有这 2 个值所以本地 OK，CI 没透传就空了。

**修法**：
1. workflow `env:` 块补全 4 个 `VITE_*` secret
2. GitHub Secrets 加 `VITE_CLOUDBASE_ENV_ID` 和 `VITE_CLOUDBASE_ACCESS_KEY` 两个
3. bump version 到 v0.2.2 重打

### v0.2.1 之前的 CI 折腾

CI 跑 setup-node 时报"Unable to locate pnpm"——actions/setup-node@v4 的 post-action 会嗅探 `pnpm-lock.yaml` 试图 cache pnpm，但 pnpm 还没装。

**修法**：彻底弃用 `actions/setup-node`，自己用 `Invoke-WebRequest` 从 nodejs.org 下 zip 解压 + `npm install -g pnpm@10`。这是当前 workflow 的写法。

---

## 6. 速查表

| 操作 | 命令 |
|---|---|
| 发版 patch | `cd desktop && pnpm release patch` |
| 发版 minor | `cd desktop && pnpm release minor` |
| 发版 major | `cd desktop && pnpm release major` |
| 直跳指定版本 | `cd desktop && pnpm release 1.2.3` |
| 删远端 tag | `git push origin :refs/tags/v0.2.2` |
| 重打 tag | `git tag v0.2.2 && git push origin v0.2.2` |
| 手动 Run workflow | 浏览器去 Actions → Run workflow → 填 version |

| 链接 | URL |
|---|---|
| Actions 列表 | https://github.com/wangshaojie/electron-kid-course-tracker/actions |
| Release 列表 | https://github.com/wangshaojie/electron-kid-course-tracker/releases |
| Secrets 配置 | https://github.com/wangshaojie/electron-kid-course-tracker/settings/secrets/actions |
| workflow 文件 | https://github.com/wangshaojie/electron-kid-course-tracker/blob/main/.github/workflows/release.yml |
