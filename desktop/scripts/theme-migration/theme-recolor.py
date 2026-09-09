#!/usr/bin/env python3
"""
把 .vue 模板里的硬编码颜色替换成 CSS 变量类(class=)

策略:只处理 template 区域(<template>...</template>),不动 <style> 块。
每个文件单独处理,保留 Vue 文件的 UTF-8 BOM(如果原本有)。
"""
import re
import sys
from pathlib import Path

# 单色 style="color: XXX" 整段替换为 class
# 注意:这个 pattern 只匹配"整个 style 只有 color 一个属性"的情况
SINGLE_COLOR_STYLE_MAP = [
    (r'style="color:\s*#fff\s*;?"', 'class="text-dark-title"'),
    (r'style="color:\s*#ffffff\s*;?"', 'class="text-dark-title"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\)\s*;?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)\s*;?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.65\)\s*;?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.6\)\s*;?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.55\)\s*;?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.5\)\s*;?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.45\)\s*;?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.4\)\s*;?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.35\)\s*;?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.3\)\s*;?"', 'class="text-dark-ghost"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.25\)\s*;?"', 'class="text-dark-ghost"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)\s*;?"', 'class="text-dark-ghost"'),
    (r'style="color:\s*#5FCE89\s*;?"', 'class="text-brand"'),
    (r'style="color:\s*#FF7A7A\s*;?"', 'class="text-danger"'),
]

# 复杂 style(有多个属性,只把 color 部分换掉,保留其他)
# 这里不处理,留给人工

files = [
    'desktop/src/views/Admin.vue',
    'desktop/src/views/Checkins.vue',
    'desktop/src/views/Home.vue',
    'desktop/src/views/Stats.vue',
]

root = Path('D:/test/kid-course-tracker')

total_changes = 0
for f in files:
    p = root / f
    src = p.read_text(encoding='utf-8')
    orig = src

    # 在 <template>...</template> 区间内替换
    def repl_in_template(m):
        block = m.group(0)
        for pat, repl in SINGLE_COLOR_STYLE_MAP:
            block = re.sub(pat, repl, block)
        return block

    src = re.sub(r'<template>.*?</template>', repl_in_template, src, flags=re.DOTALL)

    if src != orig:
        p.write_text(src, encoding='utf-8')
        # 统计实际替换次数(粗略)
        delta = sum(1 for pat, _ in SINGLE_COLOR_STYLE_MAP if pat not in orig or orig != src)
        print(f'[replaced] {f}')
        total_changes += 1
    else:
        print(f'[no change] {f}')

print(f'\nTotal files modified: {total_changes}')

# 还需要扩展 styles/index.css 加 .text-brand / .text-danger 工具类
# 这个由我们手动加
