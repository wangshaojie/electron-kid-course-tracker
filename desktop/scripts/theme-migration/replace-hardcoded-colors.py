#!/usr/bin/env python3
"""
把 .vue 模板里的硬编码颜色替换成 CSS 变量类(class=)
注意:只在 <template> 块内替换,<style> 块不动
"""
import re
import sys
from pathlib import Path

# 颜色 → (CSS 变量名, 是否已有 text-dark-xxx 类可用)
# 大部分已经在 index.css 里定义了 .text-dark-title/.text-dark-body/.text-dark-soft 等工具类
COLOR_MAP = [
    # 纯白 #fff / #ffffff → 改用 text-dark-title 类
    (r'style="color:\s*#fff;?"', 'class="text-dark-title"'),
    (r'style="color:\s*#ffffff;?"', 'class="text-dark-title"'),
    # rgba 白
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.85\);?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\);?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.65\);?"', 'class="text-dark-body"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.55\);?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.5\);?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.45\);?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.4\);?"', 'class="text-dark-soft"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.3\);?"', 'class="text-dark-ghost"'),
    (r'style="color:\s*rgba\(255,\s*255,\s*255,\s*0\.25\);?"', 'class="text-dark-ghost"'),
    # 品牌绿 #5FCE89 → 改成在 <style> 里加 helper,或者直接 var()
    (r'style="color:\s*#5FCE89;?"', 'class="text-brand"'),
    # 警告红 #FF7A7A
    (r'style="color:\s*#FF7A7A;?"', 'class="text-danger"'),
]

# 简单一次性替换,不在 <style> 块里
files = [
    'desktop/src/views/Admin.vue',
    'desktop/src/views/Checkins.vue',
    'desktop/src/views/Home.vue',
    'desktop/src/views/Login.vue',
    'desktop/src/views/Stats.vue',
]

root = Path('D:/test/kid-course-tracker')
for f in files:
    p = root / f
    src = p.read_text(encoding='utf-8')
    orig = src

    # 1. style="color: #fff" 这类 整段 style 替换成 class
    for pat, repl in COLOR_MAP:
        src = re.sub(pat, repl, src)

    # 2. style="color: rgba(255,255,255,0.4); 其他属性"  复杂 style 里
    #   简单情况:如果 style 里只有 color 属性,直接整段替换成 class
    #   复杂情况(多个属性):只把 color 部分换掉
    # 这里采取保守策略:不动复杂 style,留给人工检查
    # 因为我们的工具类 .text-dark-xxx 只能用于纯 color 的元素

    if src != orig:
        p.write_text(src, encoding='utf-8')
        print(f'[replaced] {f}')
    else:
        print(f'[no change] {f}')

print('done')
