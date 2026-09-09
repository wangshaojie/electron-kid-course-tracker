# theme-migration/ —— v0.4.6 主题重构一次性脚本

> **只读、保留供回溯。** 一次性工具，已在 v0.4.6 主题重构时跑过，不应再跑。
> 重复跑会基于已重构后的代码再处理一遍，可能产生空操作或误改。

## 背景

v0.4.6 之前，所有 Vue 组件 `<template>` 里直接写硬编码颜色（`style="color: #fff"`），
主题重构（深/浅/跟随系统）需要把这些硬编码颜色**替换成 CSS 变量类**（如 `class="text-dark-title"`），
让 `styles/theme.css` 里的 3 档主题通过 var(--*) 统一接管。

## 脚本清单

| 脚本 | 作用 | 是否进 v0.4.6 commit |
|---|---|---|
| `theme-recolor.py` | 单色 `style="color: XXX"` → class | 是 |
| `replace-hardcoded-colors.py` | 复杂多属性 style / hex 颜色批量替换 | 是 |
| `fix-white-text.py` | 白色硬编码 → 主题类 | 是 |
| `fix-complex-style.py` | 处理 v-bind:style 里的硬编码颜色 | 是 |
| `find-dup-class.py` | 找重复 class（重构后复查用） | 是 |
| `fix-dup-class.py` | 合并重复 class | 是 |
| `fix-dup-class-all.py` | 跨文件重复 class 合并 | 是 |
| `fix-dup-class-crossline.py` | 跨行重复 class 合并 | 是 |
| `fix-all-hardcoded.py` | 兜底：所有未处理硬编码 | 是 |

## 跑过的历史

v0.4.6 重构时按以下顺序在本地跑过（已处理完毕）：

```bash
cd desktop
python3 scripts/theme-migration/theme-recolor.py
python3 scripts/theme-migration/replace-hardcoded-colors.py
python3 scripts/theme-migration/fix-white-text.py
python3 scripts/theme-migration/fix-complex-style.py
python3 scripts/theme-migration/find-dup-class.py
python3 scripts/theme-migration/fix-dup-class.py
python3 scripts/theme-migration/fix-dup-class-all.py
python3 scripts/theme-migration/fix-dup-class-crossline.py
python3 scripts/theme-migration/fix-all-hardcoded.py
```

## 验证

重构后所有颜色都通过 `theme.css` 的 CSS 变量引用（`grep -r "style=\"color:" desktop/src` 应为空），
ECharts 主题通过 `utils/chartTheme.ts` 的 `getEchartsTheme()` 动态读 CSS 变量。

## 新增 / 修改颜色

未来如果想调色板，**不要重跑这些脚本**。正确姿势：

1. 改 `desktop/src/styles/theme.css` 里的 `:root` / `[data-theme='light']` / `[data-theme='dark']` 变量值
2. （如需）改 `desktop/src/utils/chartTheme.ts` 里的 `getEchartsTheme()` fallback
3. 完事，**不**碰 `theme-migration/`

## 路径变更历史

- v0.4.6 之前：散在 `desktop/scripts/` 根目录
- v0.4.6 起：统一移入 `desktop/scripts/theme-migration/` + 加本 README
