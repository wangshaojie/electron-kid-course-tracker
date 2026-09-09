#!/usr/bin/env python3
"""
项目级硬编码颜色清理(改进版):
  - 只处理顶层 <template>...</template> 块(从第一个 <template> 到文件最后的 </template>)
  - 跳过嵌套的 <template>(用作 el-table-column #default slot)
  - 跳过 Login.vue(独立暗色登录页)
"""
import re
from pathlib import Path

ROOT = Path('D:/test/kid-course-tracker/desktop/src')

ALPHA_BODY  = ['0.85', '0.8', '0.75', '0.7', '0.65', '0.6']
ALPHA_SOFT  = ['0.55', '0.5', '0.45', '0.4', '0.35']
ALPHA_GHOST = ['0.3', '0.25', '0.2']
ALPHA_MUTE  = ['0.15', '0.1', '0.05', '0.01']

def alpha_to_var(a: str) -> str:
    if a in ALPHA_BODY:  return 'var(--text-body)'
    if a in ALPHA_SOFT:  return 'var(--text-soft)'
    if a in ALPHA_GHOST: return 'var(--text-ghost)'
    if a in ALPHA_MUTE:  return 'var(--text-mute)'
    return 'var(--text-body)'

HEX_TO_VAR = {
    r'#fff\b':         'var(--text-title)',
    r'#ffffff\b':      'var(--text-title)',
    r'#FFF\b':         'var(--text-title)',
    r'#FFFFFF\b':      'var(--text-title)',
    r'#5FCE89\b':      'var(--brand-text)',
    r'#94DFB0\b':      'var(--brand-2)',
    r'#FF7A7A\b':      'var(--danger-text)',
    r'#FFB347\b':      'var(--sun-2)',
    r'#E08A1E\b':      'var(--sun-1)',
    r'#3FB87A\b':      'var(--brand-1)',
    r'#D94545\b':      'var(--danger-1)',
    r'#0a0e1a\b':      'var(--text-on-primary)',
    r'#1a1f2e\b':      'var(--page-bg-1)',
    r'#0d1320\b':      'var(--page-bg-2)',
    r'#FFB5B5\b':      'var(--danger-2)',
    r'#C5EFD5\b':      'var(--brand-3)',
}

def fix_text(content: str) -> tuple[str, int]:
    count = 0
    def repl_rgba(m):
        nonlocal count
        count += 1
        return alpha_to_var(m.group(1))
    content = re.sub(
        r'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)',
        repl_rgba, content
    )
    for pat, repl in HEX_TO_VAR.items():
        content, n = re.subn(pat, repl, content)
        count += n
    return content, count


def process_file(f: Path) -> int:
    src = f.read_text(encoding='utf-8')
    orig = src
    counter = [0]

    # 找到顶层 <template>...</template>:用第一个 <template> 开始,最后一个 </template> 结束
    first_tpl = src.find('<template>')
    last_tpl_end = src.rfind('</template>')
    if first_tpl < 0 or last_tpl_end < 0 or last_tpl_end < first_tpl:
        return 0

    template_start = first_tpl + len('<template>')
    template_block = src[template_start:last_tpl_end]
    new_block, n = fix_text(template_block)
    counter[0] = n

    if new_block != template_block:
        src = src[:template_start] + new_block + src[last_tpl_end:]

    # style 块(全部 style)
    def repl_style(m):
        block, n = fix_text(m.group(0))
        counter[0] += n
        return block
    src = re.sub(r'<style[^>]*>.*?</style>', repl_style, src, flags=re.DOTALL)

    if src != orig:
        f.write_text(src, encoding='utf-8')
    return counter[0]


files_changed = 0
total_replacements = 0
for f in ROOT.rglob('*.vue'):
    if f.name == 'Login.vue' and 'views' in str(f):
        continue
    n = process_file(f)
    if n > 0:
        files_changed += 1
        total_replacements += n
        print(f'[fixed {n}] {f}')

print(f'\nTotal: {files_changed} files, {total_replacements} replacements')
