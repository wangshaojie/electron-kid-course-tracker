# 一寸光阴 Release 流程（v0.4.6 推 tag 指南）

> 整套流程已经接好 GitHub Actions，推 `v*` tag 就会自动跑 CI 打包 + 上传 GitHub Release。
>
> 第一次接 CI 时需要把环境变量塞到 GitHub Secrets（下面有说明），之后每次发版就是手跑 4 条命令的事。

## 0. 前置条件（只配一次）

### GitHub Secrets 配齐 2 个

打开 https://github.com/wangshaojie/electron-kid-course-tracker/settings/secrets/actions
点 `New repository secret`，依次加：

| Name | Value 来源 |
|---|---|
| `VITE_AUTH_OTP_URL` | Vercel 函数 URL + `/auth-otp`，如 `https://<your-project>.vercel.app/auth-otp` |
| `VITE_DATA_API_URL` | Vercel 函数 URL + `/data-api`，如 `https://<your-project>.vercel.app/data-api` |

**只这 2 个**。v0.4.x 之后项目从 CloudBase 迁到 Vercel Functions + Supabase PG（已下线 cloudbase/ 整个目录），不再需要 `VITE_CLOUDBASE_ENV_ID` / `VITE_CLOUDBASE_ACCESS_KEY` 这 2 个 secret。

**2 个 secret 缺一不可**，漏一个 → 装的 .exe 启动白屏（Vite build 时 throw 进 bundle）。详细诊断见 [§5 踩坑历史](#5-踩坑历史白屏与修复)。

> `GITHUB_TOKEN` 是 GitHub Actions 自动注入的，不用手动配。

---

## 1. 日常发版流程（手跑 4 条命令）

> ⚠️ 仓库内 `pnpm release` 脚本（`scripts/release.mjs`）有 bug（`--filter course-tracker` 在非 workspace 项目下不识别），**不要用**。手跑以下 4 条命令绕过。

```powershell
# 假设当前在仓库根目录

# 1) bump version（同步改 package.json + 自动 stage + 自动 commit）
#    patch = 0.4.5 → 0.4.6（bug 修复）
#    minor = 0.4.5 → 0.5.0（新功能）
#    major = 0.4.5 → 1.0.0（不兼容改动）
pnpm --dir desktop version patch --no-git-tag-version

# 2) commit bump
git add desktop/package.json
git commit -m "chore: bump version to 0.4.6"

# 3) 推 main（让远端拿到 bump commit）
git push origin main

# 4) 打 tag + 推 tag（这一步触发 CI）
git tag v0.4.6
git push origin v0.4.6
```

> ⚠️ **顺序不能反**：
> 1. version 必须先 bump（package.json 改了，CI 出来的 release 资产名才跟 tag 对得上）
> 2. tag 必须在 push main 之后打（CI 监听 `on.push.tags: ['v*']`，单独 push tag 不会跑 workflow）
> 3. 倒过来：CI 跑通后用旧 version 发布到新 tag 名 → 错位

**推荐走 default branch 上的 tag 触发**（不要走 workflow_dispatch，手动跑跟 tag 跑有差异：tag 跑会自动建 release，workflow_dispatch 只跑 build 步骤）。

---

## 2. 推完 tag 之后

`git push origin v0.4.6` 一打，CI 立刻跑：
https://github.com/wangshaojie/electron-kid-course-tracker/actions

完整流程（5-10 分钟）：

```
1. 拉代码（actions/checkout@v4，fetch-depth 自动）
2. 装 Node 24 LTS（从 nodejs.org 下 zip 解压，不用 actions/setup-node）
3. 装 pnpm@10（npm install -g pnpm@10）
4. pnpm install 装依赖
5. vue-tsc --noEmit 类型检查
6. pnpm run build 编译 renderer + main（2 个 VITE_* secret 全部透传）
7. electron-builder 打 NSIS 安装包 + portable 免安装版
8. softprops/action-gh-release@v2 创建 GitHub Release
   - 名字：一寸光阴 vX.Y.Z
   - Assets：2 个 .exe + .blockmap + latest.yml（autoUpdater 必读）
```

跑通后自动创建：
https://github.com/wangshaojie/electron-kid-course-tracker/releases/tag/v0.4.6

---

## 3. CI 失败时怎么修

进 https://github.com/wangshaojie/electron-kid-course-tracker/actions
点失败的 run → 展开失败 step → 复制红字日志。

常见 3 类报错：

### 3.1 NSIS 打包失败：`Cannot read properties of null (reading 'channel')`

**症状**：

```
• Cannot detect repository by .git/config. Please specify "repository" in the package.json
⨯ Cannot read properties of null (reading 'channel')
  failedTask=build stackTrace=TypeError: Cannot read properties of null (reading 'channel')
    at computeChannelNames (.../app-builder-lib/src/publish/updateInfoBuilder.ts:47:74)
```

**根因**：`electron-builder` 在 NSIS 步骤写 `latest.yml` 时调 `computeChannelNames`，要读 `package.json` 的 `repository` 字段。仓库 `desktop/package.json` 缺 `repository` 字段时，CI 容器里 pnpm 自动注入偶发失败 → 报 null channel。

**修法**：`desktop/package.json` 显式补：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/wangshaojie/electron-kid-course-tracker.git"
}
```

（v0.4.5 修复后已加，**不要删**。）

### 3.2 type 错误 / build 错误

**症状**：`vue-tsc` 报类型错；或者 `electron-builder` 报文件路径错误

**修法**：本地先跑 `pnpm exec vue-tsc --noEmit` 和 `pnpm run build` 复现，修完再 push

### 3.3 Release 创建失败：`Pattern 'desktop/release/.../TimeWell-*.exe' does not match any files`

**症状**：`softprops/action-gh-release@v2` 报没匹配到 .exe

**根因**：`electron-builder` 没把 .exe 放到预期路径。检查：

- `desktop/package.json` 的 `directories.output`（应该是 `release/${version}`）
- `artifactName`（应该是 `TimeWell-${version}-${arch}.${ext}` 和 `TimeWell-${version}-portable-${arch}.${ext}`）

**手动重跑**（不需要重打 tag）：

1. 进 https://github.com/wangshaojie/electron-kid-course-tracker/actions/workflows/release.yml
2. 右上角 `Run workflow` → 选 `main` → version 输入框填 `v0.4.6`（**带 v 前缀**） → 绿色按钮

---

## 4. 重打 / 跳过版本

### 重打某个版本（比如 v0.4.6 跑挂了想重做）

```powershell
# 1. 删远端旧 tag
git push origin :refs/tags/v0.4.6

# 2. 在 main HEAD 上重新打 tag
git tag v0.4.6
git push origin v0.4.6
# → 触发 on.push.tags: ['v*']，CI 重跑
```

### 跳过某个版本

```powershell
# 比如 v0.4.5 跑挂了，直接做 v0.4.6
pnpm --dir desktop version patch --no-git-tag-version
git add desktop/package.json
git commit -m "chore: bump version to 0.4.6"
git push origin main
git tag v0.4.6
git push origin v0.4.6
```

### 手动 Run workflow（不通过 tag）

进 https://github.com/wangshaojie/electron-kid-course-tracker/actions/workflows/release.yml
右上角 `Run workflow` → 选 `main` → version 填 `v0.4.6`（带 v 前缀） → 绿色按钮。

⚠️ **手动 Run workflow 时，GitHub 不会自动 bump `package.json` 的 version**，产物名仍按 package.json 当前的 version。所以如果想手动跑 + 重命名 release，建议先把 package.json version 改了再 Run。

---

## 5. 踩坑历史（白屏与修复）

### v0.4.5：NSIS 缺 `repository` 字段 → CI 失败

CI 跑到 NSIS 步骤最后写 `latest.yml` 时，`computeChannelNames` 要 `package.json.repository`，没字段就报 null channel。

**根因**：v0.4.x 项目从 CloudBase 迁到 Vercel 后，`desktop/package.json` 没有 `repository` 字段。v0.4.4 跑通是因为 pnpm install 阶段从 `.git/config` 推 `repository` 注入到 package.json 暂存区（依赖时序），v0.4.5 这次没注入上。

**修法**：`desktop/package.json` 显式补 `repository` 字段（v0.4.5 已加）。

### v0.2.1：CI 接通了但白屏

CI 跑通了，下载装的 .exe 启动白屏。

**诊断**：解 `app.asar` → 看 `dist/assets/index-*.js`：

```js
const QIe="https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/auth-otp";
const ZIe="https://kid-course-tracker-d6c2816e966b5.service.tcloudbase.com/data-api";
throw new Error("VITE_CLOUDBASE_ENV_ID 未设置（.env.development）");
```

`VITE_AUTH_OTP_URL` / `VITE_DATA_API_URL` 都正确，但 `VITE_CLOUDBASE_ENV_ID` 是空的 → vite build 时 `if (!envId) throw` 被 rollup 保留进 bundle → 启动就 throw → Vue mount 失败 → 白屏。

**根因**：v0.2.1 还在用 CloudBase 架构，CI workflow 只透传了 `VITE_AUTH_OTP_URL` / `VITE_DATA_API_URL` 2 个 secret，漏了 `VITE_CLOUDBASE_ENV_ID` / `VITE_CLOUDBASE_ACCESS_KEY`。

**修法**：

1. workflow `env:` 块补全 4 个 `VITE_*` secret
2. GitHub Secrets 加 `VITE_CLOUDBASE_ENV_ID` 和 `VITE_CLOUDBASE_ACCESS_KEY` 两个
3. bump version 到 v0.2.2 重打

> 现在的项目（v0.4.x+）已经迁到 Vercel Functions + Supabase，只剩 2 个 `VITE_*` secret（`VITE_AUTH_OTP_URL` / `VITE_DATA_API_URL`），但"漏 secret 启动白屏"这条原则仍然适用。

### v0.2.1 之前的 CI 折腾

CI 跑 setup-node 时报"Unable to locate pnpm"——actions/setup-node@v4 的 post-action 会嗅探 `pnpm-lock.yaml` 试图 cache pnpm，但 pnpm 还没装。

**修法**：彻底弃用 `actions/setup-node`，自己用 `Invoke-WebRequest` 从 nodejs.org 下 zip 解压 + `npm install -g pnpm@10`。这是当前 workflow 的写法。

---

## 6. 速查表

| 操作 | 命令 |
|---|---|
| 发版 patch | `pnpm --dir desktop version patch --no-git-tag-version && git add desktop/package.json && git commit -m "chore: bump version to X.Y.Z" && git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z` |
| 发版 minor | 同上，把 `patch` 换 `minor` |
| 发版 major | 同上，把 `patch` 换 `major` |
| 删远端 tag | `git push origin :refs/tags/vX.Y.Z` |
| 重打 tag | `git tag vX.Y.Z && git push origin vX.Y.Z` |
| 手动 Run workflow | 浏览器去 Actions → Run workflow → 填 version |
| 本地类型检查 | `pnpm --dir desktop exec vue-tsc --noEmit` |
| 本地构建（调试） | `pnpm --dir desktop run build` |

| 链接 | URL |
|---|---|
| Actions 列表 | https://github.com/wangshaojie/electron-kid-course-tracker/actions |
| Release 列表 | https://github.com/wangshaojie/electron-kid-course-tracker/releases |
| Secrets 配置 | https://github.com/wangshaojie/electron-kid-course-tracker/settings/secrets/actions |
| workflow 文件 | https://github.com/wangshaojie/electron-kid-course-tracker/blob/main/.github/workflows/release.yml |
