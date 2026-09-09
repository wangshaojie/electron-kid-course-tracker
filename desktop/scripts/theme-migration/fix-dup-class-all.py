#!/usr/bin/env python3
"""
合并同一行和跨行的重复 class="A" class="B"
"""
import re
from pathlib import Path

root = Path('D:/test/kid-course-tracker/desktop/src')

for f in root.rglob('*.vue'):
    src = f.read_text(encoding='utf-8')
    orig = src

    # 同行: class="A" class="B" -> class="A B"
    src = re.sub(
        r'class="([^"]+)"\s+class="([^"]+)"',
        r'class="\1 \2"',
        src,
    )

    if src != orig:
        f.write_text(src, encoding='utf-8')
        print(f'[fixed] {f}')
