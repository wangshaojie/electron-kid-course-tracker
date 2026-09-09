#!/usr/bin/env python3
"""
收尾:把复杂 style(多属性)里的 color 部分单独替换成 var(--xxx)
不做整段替换,因为还要保留 background / border 等其他属性。
"""
import re
from pathlib import Path

# 复杂 style 里的 color 替换为 var(--xxx)
COMPLEX_COLOR_MAP = [
    # 模板里都是 template 区域内的,加个 inline <style> 也不会影响
    (r'color:\s*#fff\b',       'color: var(--text-title)'),
    (r'color:\s*#ffffff\b',    'color: var(--text-title)'),
    (r'color:\s*#5FCE89\b',    'color: var(--brand-text)'),
    (r'color:\s*#FF7A7A\b',    'color: var(--danger-text)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\)', 'color: var(--text-body)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)', 'color: var(--text-body)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.7\)',  'color: var(--text-body)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.65\)', 'color: var(--text-body)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.6\)',  'color: var(--text-body)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.55\)', 'color: var(--text-soft)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.5\)',  'color: var(--text-soft)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.45\)', 'color: var(--text-soft)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.4\)',  'color: var(--text-soft)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.35\)', 'color: var(--text-soft)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.3\)',  'color: var(--text-ghost)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.25\)', 'color: var(--text-ghost)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\)',  'color: var(--text-ghost)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.15\)', 'color: var(--text-mute)'),
    (r'color:\s*rgba\(255,\s*255,\s*255,\s*0\.05\)', 'color: var(--text-mute)'),
]

# 这些文件全部 template 内的 style 都改
# <style> 块不处理(Vue scoped style 里的 color 引用本地 var 即可,不需要改)
files = [
    'desktop/src/views/Admin.vue',
    'desktop/src/views/Checkins.vue',
    'desktop/src/views/Home.vue',
    'desktop/src/views/Stats.vue',
]

root = Path('D:/test/kid-course-tracker')

for f in files:
    p = root / f
    src = p.read_text(encoding='utf-8')
    orig = src

    # 只在 <template> 块内替换
    def repl(m):
        block = m.group(0)
        for pat, repl_str in COMPLEX_COLOR_MAP:
            block = re.sub(pat, repl_str, block)
        return block
    src = re.sub(r'<template>.*?</template>', repl, src, flags=re.DOTALL)

    if src != orig:
        p.write_text(src, encoding='utf-8')
        print(f'[fixed complex] {f}')
    else:
        print(f'[no change] {f}')
