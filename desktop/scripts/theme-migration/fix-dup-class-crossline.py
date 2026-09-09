#!/usr/bin/env python3
"""
跨行 class="A"\n  class="B" 合并成 class="A B" 在同一行。
"""
import re
from pathlib import Path

root = Path('D:/test/kid-course-tracker/desktop/src')

for f in root.rglob('*.vue'):
    src = f.read_text(encoding='utf-8')
    orig = src

    root = Path('D:/test/kid-course-tracker/desktop/src')
    # 跨行场景常见于 Vue 多行属性写法:
    #   <button
    #     v-if="..."
    #     class="text-xs"
    #     class="text-brand"     <-- 第二个 class
    #     @click="..."
    #   >
    pattern = re.compile(
        r'class="([^"]+)"\n(\s+)class="([^"]+)"',
        re.MULTILINE
    )
    src = pattern.sub(r'class="\1 \3"', src)

    if src != orig:
        f.write_text(src, encoding='utf-8')
        print(f'[fixed] {f}')
