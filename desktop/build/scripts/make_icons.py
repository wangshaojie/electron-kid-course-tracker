"""
生成 kid-course-tracker 的全套图标素材。

输出：
  build/icon.png        512x512 主图标（任务栏/桌面）
  build/icon.ico        多尺寸 .ico（16/24/32/48/64/128/256）
  build/installer.ico   同上（NSIS 安装器图标）
  build/uninstaller.ico 同上（卸载图标）
  build/tray.png        256x256 托盘备用（暂未用）
  build/installerHeader.bmp    55x55 NSIS 头部 logo（白色）
  build/installerSidebar.bmp  164x314 NSIS 侧栏品牌图

设计：薄荷绿圆角矩形底 + 一本打开的书 + 书本上方一个「K」（kourse）+ 上方闪烁的小星
"""

from PIL import Image, ImageDraw, ImageFont
import os
from pathlib import Path

BUILD = Path(__file__).parent.parent
OUT = BUILD

# 品牌色
BRAND_MINT = (63, 184, 122)        # #3FB87A 主色
BRAND_MINT_DARK = (47, 138, 92)    # #2F8A5C 阴影
BRAND_CREAM = (255, 251, 240)      # #FFFBF0 米色书页
BRAND_INK = (47, 60, 50)           # #2F3C32 深色（K/星）
BRAND_GOLD = (255, 196, 87)        # #FFC457 金色高光


def make_base(size: int) -> Image.Image:
    """512x512 主图：薄荷绿圆角矩形 + 米色账本 + 大 ¥ 字符。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    s = size
    # 圆角矩形背景
    r = int(s * 0.22)  # 圆角半径
    pad = int(s * 0.04)
    d.rounded_rectangle(
        (pad, pad, s - pad, s - pad),
        radius=r,
        fill=BRAND_MINT,
    )

    # 阴影
    shadow_offset = int(s * 0.02)
    d.rounded_rectangle(
        (pad + shadow_offset, pad + int(s * 0.55),
         s - pad + shadow_offset, s - pad + int(s * 0.04)),
        radius=int(r * 0.6),
        fill=(0, 0, 0, 25),
    )

    # 账本（米色圆角矩形 + 顶部封皮横条）
    book_w = int(s * 0.62)
    book_h = int(s * 0.52)
    book_x = (s - book_w) // 2
    book_y = int(s * 0.36)
    d.rounded_rectangle(
        (book_x, book_y, book_x + book_w, book_y + book_h),
        radius=int(s * 0.05),
        fill=BRAND_CREAM,
    )
    # 封皮横线
    d.line(
        (book_x + int(s * 0.025), book_y + int(s * 0.08),
         book_x + book_w - int(s * 0.025), book_y + int(s * 0.08)),
        fill=BRAND_MINT_DARK,
        width=max(2, int(s * 0.012)),
    )
    # 装订线（左侧金线）
    d.line(
        (book_x + int(s * 0.045), book_y + int(s * 0.04),
         book_x + int(s * 0.045), book_y + book_h - int(s * 0.04)),
        fill=BRAND_GOLD,
        width=max(2, int(s * 0.008)),
    )

    # ¥ 字符（核心）
    try:
        yen_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", int(s * 0.32))
    except Exception:
        try:
            yen_font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", int(s * 0.32))
        except Exception:
            yen_font = ImageFont.load_default()
    yen_text = "¥"
    bbox = d.textbbox((0, 0), yen_text, font=yen_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(
        (s // 2 - tw // 2 - bbox[0], book_y + book_h // 2 - th // 2 - bbox[1] - int(s * 0.02)),
        yen_text,
        font=yen_font,
        fill=BRAND_MINT_DARK,
    )

    # 顶部小星（金色）= 课程亮点（点缀）
    star_size = int(s * 0.10)
    star_cx = s // 2
    star_cy = int(s * 0.30)
    star_pts = []
    import math
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        r_pt = star_size if i % 2 == 0 else star_size * 0.45
        star_pts.append((star_cx + r_pt * math.cos(angle), star_cy + r_pt * math.sin(angle)))
    d.polygon(star_pts, fill=BRAND_GOLD, outline=BRAND_MINT_DARK)

    return img


def make_tray_icon(size: int = 256) -> Image.Image:
    """托盘图标：圆形 + 简化的 ¥ 字符。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size

    d.ellipse((0, 0, s, s), fill=BRAND_MINT)

    # 简化账本
    book_w = int(s * 0.62)
    book_h = int(s * 0.50)
    book_x = (s - book_w) // 2
    book_y = int(s * 0.30)
    d.rounded_rectangle(
        (book_x, book_y, book_x + book_w, book_y + book_h),
        radius=int(s * 0.05),
        fill=BRAND_CREAM,
    )
    d.line(
        (book_x + int(s * 0.04), book_y + int(s * 0.10),
         book_x + book_w - int(s * 0.04), book_y + int(s * 0.10)),
        fill=BRAND_MINT_DARK,
        width=max(2, int(s * 0.012)),
    )
    try:
        yen_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", int(s * 0.30))
    except Exception:
        yen_font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), "¥", font=yen_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(
        (s // 2 - tw // 2 - bbox[0], book_y + book_h // 2 - th // 2 - bbox[1] - int(s * 0.02)),
        "¥",
        font=yen_font,
        fill=BRAND_MINT_DARK,
    )
    return img


def make_installer_header_bmp() -> None:
    """NSIS 头部 logo 55x55：薄荷绿圆角 + ¥ 字符。"""
    size = 55
    img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    s = size

    d.rounded_rectangle(
        (2, 2, s - 2, s - 2),
        radius=8,
        fill=BRAND_MINT,
    )
    try:
        yen_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 30)
    except Exception:
        yen_font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), "¥", font=yen_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(
        (s // 2 - tw // 2 - bbox[0], s // 2 - th // 2 - bbox[1]),
        "¥",
        font=yen_font,
        fill=BRAND_CREAM,
    )
    img.convert("RGB").save(OUT / "installerHeader.bmp", "BMP")


def make_installer_sidebar_bmp() -> None:
    """NSIS 侧栏 164x314，薄荷绿底 + 账本图标 + 产品名。"""
    w, h = 164, 314
    img = Image.new("RGB", (w, h), BRAND_MINT)
    d = ImageDraw.Draw(img)

    # 账本（取代"书"）—— 上方是账本主体（圆角矩形），中间一条 ¥ 符号
    book_w = int(w * 0.62)
    book_h = int(h * 0.30)
    book_x = (w - book_w) // 2
    book_y = int(h * 0.18)
    d.rounded_rectangle(
        (book_x, book_y, book_x + book_w, book_y + book_h),
        radius=6,
        fill=BRAND_CREAM,
    )
    # 账本顶部封皮横线
    d.line(
        (book_x + 6, book_y + 18, book_x + book_w - 6, book_y + 18),
        fill=BRAND_MINT_DARK,
        width=2,
    )
    # ¥ 符号居中（账本核心）
    d.text(
        (w // 2 - 16, book_y + book_h // 2 - 18),
        "¥",
        font=ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 36) if os.path.exists("C:/Windows/Fonts/arialbd.ttf") else ImageFont.load_default(),
        fill=BRAND_MINT_DARK,
    )

    # 文字：产品名
    title = "一寸光阴"
    subtitle = "本地 · 离线 · 隐私"
    try:
        for fn in ["msyh.ttc", "msyh.ttf", "simhei.ttf", "simsun.ttc"]:
            for fp_dir in [r"C:\Windows\Fonts", r"C:\Windows\Fonts\zh-CN"]:
                fp = os.path.join(fp_dir, fn)
                if os.path.exists(fp):
                    big = ImageFont.truetype(fp, 22)
                    small = ImageFont.truetype(fp, 12)
                    break
            else:
                continue
            break
        else:
            big = ImageFont.load_default()
            small = ImageFont.load_default()
    except Exception:
        big = ImageFont.load_default()
        small = ImageFont.load_default()

    # 标题居中
    bbox = d.textbbox((0, 0), title, font=big)
    tw = bbox[2] - bbox[0]
    d.text(((w - tw) // 2, int(h * 0.66)), title, font=big, fill=BRAND_CREAM)

    bbox = d.textbbox((0, 0), subtitle, font=small)
    tw = bbox[2] - bbox[0]
    d.text(((w - tw) // 2, int(h * 0.76)), subtitle, font=small, fill=BRAND_CREAM)

    img.save(OUT / "installerSidebar.bmp", "BMP")


def write_ico(path: Path, images: list[Image.Image]):
    """手动写多尺寸 .ico 文件。Pillow 的多尺寸保存不稳。"""
    import struct
    # 所有图转 32-bit RGBA
    pngs = []
    for img in images:
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        # 用 PNG 编码（windows 7+ 支持 PNG-in-ICO）
        from io import BytesIO
        buf = BytesIO()
        img.save(buf, format="PNG")
        pngs.append(buf.getvalue())

    n = len(pngs)
    # ICONDIR header: 6 bytes
    # ICONDIRENTRY: 16 bytes each
    header_size = 6 + 16 * n
    offset = header_size
    entries = []
    for img, png in zip(images, pngs):
        w, h = img.size
        bw = 0 if w >= 256 else w
        bh = 0 if h >= 256 else h
        entry = struct.pack(
            "<BBBBHHII",
            bw, bh, 0, 0, 1, 32,
            len(png), offset,
        )
        entries.append(entry)
        offset += len(png)

    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, n))  # ICONDIR
        for e in entries:
            f.write(e)
        for png in pngs:
            f.write(png)


def main():
    print("[1/4] 生成主图标 512x512 ...")
    base = make_base(512)
    base.save(OUT / "icon.png")

    print("[2/4] 生成托盘图标 256x256 ...")
    tray = make_tray_icon(256)
    tray.save(OUT / "tray.png")

    print("[3/4] 生成 .ico 多尺寸（16/24/32/48/64/128/256）...")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_imgs = [make_base(s) for s in sizes]
    write_ico(OUT / "icon.ico", ico_imgs)
    write_ico(OUT / "installer.ico", ico_imgs)
    write_ico(OUT / "uninstaller.ico", ico_imgs)

    print("[4/4] 生成 NSIS BMP 资源 ...")
    make_installer_header_bmp()
    make_installer_sidebar_bmp()

    print("done")
    for f in sorted(OUT.iterdir()):
        if f.is_file():
            sz = f.stat().st_size
            print(f"  {f.name}  {sz // 1024} KB" if sz >= 1024 else f"  {f.name}  {sz} B")


if __name__ == "__main__":
    main()
