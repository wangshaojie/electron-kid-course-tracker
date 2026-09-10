#!/usr/bin/env python3
"""
合并同一个 <tag> 上连续的 class="..." class="..." 属性
解决刚才脚本的副作用。
"""
import re
from pathlib import Path

files = [
    'desktop/src/views/Checkins.vue',
    'desktop/src/views/Home.vue',
    'desktop/src/views/Stats.vue',
]

root = Path('D:/test/kid-course-tracker')

# 匹配:同一个 tag 里有两个相邻的 class="..."
# 例: <h3 class="font-bold" class="text-dark-title">🕒 最近打卡</h3>
# 把两个 class 合并:class="font-bold text-dark-title"

# 思路:扫描每一行(模板部分),找形如 `class="A" class="B"` 的相邻字符串
# 由于 Vue SFC 在 <template> 内的属性通常按行写,这种格式最常见

def merge_double_class(line: str) -> str:
    """合并同一行内的 class="A" class="B" 为 class="A B" """
    pattern = re.compile(r'class="([^"]+)"\s+class="([^"]+)"')
    # 用 lambda 处理(支持多次替换)
    return pattern.sub(lambda m: f'class="{m.group(1)} {m.group(2)}"', line)


for f in files:
    p = root / f
    src = p.read_text(encoding='utf-8')
    orig = src

    # 逐行处理
    new_lines = [merge_double_class(line) for line in src.splitlines(keepends=True)]
    src = ''.join(new_lines)

    if src != orig:
        p.write_text(src, encoding='utf-8')
        # 统计合并次数
        count = orig.count('class="') - (orig.count('class="') - sum(1 for _ in re.finditer(r'class="[^"]+"\s+class="[^"]+"', orig)))
        # 简单数法
        before = len(re.findall(r'class="', orig))
        after = len(re.findall(r'class="', src))
        print(f'[fixed] {f}: {before} class attrs -> {after} ({before-after} merged)')
    else:
        print(f'[no change] {f}')
