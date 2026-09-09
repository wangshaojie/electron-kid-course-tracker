#!/usr/bin/env python3
"""
把 components/ 下所有模板里 style="color: #fff" 替换成 class="text-dark-title"
.style { color: #fff; } 在 <style scoped> 内也替换成 var(--text-title)
"""
import re
from pathlib import Path

root = Path('D:/test/kid-course-tracker/desktop/src/components')

total_files = 0
total_replacements = 0

for f in root.rglob('*.vue'):
    src = f.read_text(encoding='utf-8')
    orig = src
    counter = [0]  # 用 list 包装以便闭包修改

    # 1) template 区域
    def repl_template(m):
        block = m.group(0)
        new, n = re.subn(
            r'style="color:\s*#fff(?:fff)?\s*;?"',
            'class="text-dark-title"',
            block,
        )
        counter[0] += n
        return new

    src = re.sub(r'<template>.*?</template>', repl_template, src, flags=re.DOTALL)

    # 2) style 块: color: #fff 改 var(--text-title)
    def repl_style(m):
        block = m.group(0)
        new, n = re.subn(
            r'(color:\s*)#fff(?:fff)?(?=\s*;)',
            r'\1var(--text-title)',
            block,
        )
        counter[0] += n
        return new

    src = re.sub(r'<style[^>]*>.*?</style>', repl_style, src, flags=re.DOTALL)

    if src != orig:
        f.write_text(src, encoding='utf-8')
        total_files += 1
        total_replacements += counter[0]
        print(f'[fixed {counter[0]}] {f}')

print(f'\nTotal: {total_files} files, {total_replacements} replacements')
