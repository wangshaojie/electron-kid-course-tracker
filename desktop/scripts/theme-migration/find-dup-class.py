#!/usr/bin/env python3
"""
扫描所有 .vue 文件,找出 class="A" 紧接着 class="B" 的位置(允许中间有空白/换行)
报告每个文件 + 行号,用于人工确认。
"""
import re
from pathlib import Path

root = Path('D:/test/kid-course-tracker/desktop/src')
pattern = re.compile(r'class="([^"]+)"\s+class="([^"]+)"', re.MULTILINE)

for f in root.rglob('*.vue'):
    src = f.read_text(encoding='utf-8')
    # 多行匹配
    matches = pattern.findall(src)
    if matches:
        # 找行号
        for a, b in matches:
            # 用单行 find 找位置
            for line_no, line in enumerate(src.splitlines(), 1):
                if a in line and b in line:
                    continue
            # 找跨行的:第一行包含 a,后续行包含 b
            lines = src.splitlines()
            for i, line in enumerate(lines):
                m1 = re.search(r'class="([^"]+)"\s*$', line)
                if m1 and m1.group(1) == a:
                    for j in range(i+1, min(i+5, len(lines))):
                        m2 = re.search(r'^\s+class="([^"]+)"', lines[j])
                        if m2 and m2.group(1) == b:
                            print(f'{f}:{i+1}-{j+1}  A="{a}"  B="{b}"')
                            break
