"""Generate a short, information-rich demo video for Jiehua.

The video deliberately contains four different scenes, Chinese signage,
numbers, people and objects so the vision model has something to read.
"""

from __future__ import annotations

import math
import os
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "samples"
TMP_DIR = ROOT / "data" / "tmp_frames"
W, H = 1280, 720
FPS = 24
DURATION = 12
TOTAL = FPS * DURATION

FONT_REG_CANDIDATES = [
    os.environ.get("SAMPLE_FONT_REG"),
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
]
FONT_BOLD_CANDIDATES = [
    os.environ.get("SAMPLE_FONT_BOLD"),
    "C:/Windows/Fonts/msyhbd.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
]


def first_existing(candidates: list[str | None], label: str) -> str:
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit(
        f"没有找到可用的{label}中文字体。请安装思源黑体/微软雅黑，"
        f"或设置 SAMPLE_FONT_REG / SAMPLE_FONT_BOLD 指向 .ttf/.ttc/.otf 文件。"
    )


FONT_REG = first_existing(FONT_REG_CANDIDATES, "常规")
FONT_BOLD = first_existing(FONT_BOLD_CANDIDATES, "粗体")

random.seed(7)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size, index=0)


def vertical_gradient(top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (W, H), top)
    draw = ImageDraw.Draw(image)
    for y in range(H):
        ratio = y / max(1, H - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line((0, y, W, y), fill=color)
    return image


def vignette(image: Image.Image, strength: int = 110) -> Image.Image:
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((-W * 0.25, -H * 0.35, W * 1.25, H * 1.35), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(160))
    dark = Image.new("RGB", (W, H), (2, 4, 8))
    dark.putalpha(mask.point(lambda p: strength - int(p * strength / 255)))
    return Image.alpha_composite(image.convert("RGBA"), dark).convert("RGB")


def label(draw: ImageDraw.ImageDraw, xy, text, size, fill, bold=False, anchor="la", spacing=8):
    draw.multiline_text(xy, text, font=font(size, bold), fill=fill, anchor=anchor, spacing=spacing)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def person(draw, x, y, scale, color, stride=0.0, coat=None):
    coat = coat or color
    bob = math.sin(stride) * 2.0
    # legs
    draw.line((x - 7 * scale, y, x - 13 * scale - math.sin(stride) * 6 * scale, y + 40 * scale), fill=color, width=max(2, int(4 * scale)))
    draw.line((x + 7 * scale, y, x + 13 * scale + math.sin(stride) * 6 * scale, y + 40 * scale), fill=color, width=max(2, int(4 * scale)))
    # body
    rounded(
        draw,
        (x - 12 * scale, y - 42 * scale + bob, x + 12 * scale, y + 4 * scale + bob),
        7 * scale,
        fill=coat,
    )
    # head
    r = 8 * scale
    draw.ellipse((x - r, y - 58 * scale + bob, x + r, y - 42 * scale + bob), fill=(38, 33, 30))


def scene_metro(t: float, p: float) -> Image.Image:
    image = vertical_gradient((21, 32, 48), (10, 16, 24))
    draw = ImageDraw.Draw(image, "RGBA")

    # ceiling structure
    for i in range(7):
        x = -100 + i * 240
        draw.line((x, 0, x + 160, 250), fill=(60, 78, 96, 75), width=3)
    draw.rectangle((0, 0, W, 88), fill=(8, 13, 19, 210))
    for i in range(9):
        draw.rectangle((70 + i * 150, 16, 170 + i * 150, 28), fill=(142, 196, 212, 70))
        draw.ellipse((80 + i * 150, 34, 150 + i * 150, 44), fill=(170, 225, 240, 45))

    # train, sliding through the frame
    train_x = -80 + int(p * 60)
    draw.rectangle((train_x, 240, train_x + 430, 610), fill=(198, 208, 214))
    draw.rectangle((train_x, 240, train_x + 430, 300), fill=(45, 93, 130))
    for row in range(2):
        for col in range(4):
            wx = train_x + 36 + col * 96
            wy = 330 + row * 120
            rounded(draw, (wx, wy, wx + 70, wy + 76), 8, fill=(255, 219, 158, 235))
            draw.line((wx + 35, wy, wx + 35, wy + 76), fill=(170, 130, 80, 120), width=2)
    draw.rectangle((train_x, 570, train_x + 430, 596), fill=(225, 116, 84))
    label(draw, (train_x + 24, 544), "往 人民广场", 22, (235, 242, 246))

    # platform
    draw.rectangle((0, 590, W, H), fill=(41, 47, 53))
    draw.rectangle((0, 590, W, 602), fill=(224, 181, 72))
    for i in range(12):
        draw.rectangle((i * 120, 606, i * 120 + 58, 610), fill=(86, 92, 97))

    # sign
    rounded(draw, (760, 112, 1190, 212), 10, fill=(12, 25, 37, 235), outline=(120, 200, 220, 120), width=2)
    draw.ellipse((782, 136, 810, 164), fill=(74, 194, 219))
    label(draw, (794, 150), "A", 17, (5, 22, 30), bold=True, anchor="mm")
    label(draw, (826, 130), "地铁 A 口", 34, (238, 248, 252), bold=True)
    label(draw, (826, 172), "Metro Exit A  ·  07:12", 18, (132, 186, 201))

    # clock
    rounded(draw, (1015, 112, 1190, 212), 10, fill=(7, 14, 22, 230), outline=(255, 255, 255, 35), width=2)
    label(draw, (1102, 132), "07:12", 38, (255, 205, 120), bold=True, anchor="ma")
    label(draw, (1102, 180), "早高峰", 14, (166, 190, 200), anchor="ma")

    # people
    for i, (x, s) in enumerate([(620, 1.05), (700, 0.92), (560, 0.82), (930, 0.76), (990, 0.68)]):
        person(draw, x, 640, s, (25, 29, 35), stride=t * 4 + i * 1.7, coat=(30 + i * 8, 38 + i * 5, 48 + i * 4))

    # floor reflection
    overlay = image.filter(ImageFilter.GaussianBlur(18))
    image = Image.blend(image, overlay, 0.06)
    draw = ImageDraw.Draw(image, "RGBA")
    label(draw, (44, 646), "07:12  /  MONDAY  /  18°C", 15, (182, 202, 212, 180))
    return vignette(image, 90)


def scene_cafe(t: float, p: float) -> Image.Image:
    image = vertical_gradient((80, 61, 45), (34, 25, 20))
    draw = ImageDraw.Draw(image, "RGBA")

    # window light
    draw.rectangle((690, 0, 1160, 430), fill=(255, 218, 162, 42))
    draw.rectangle((710, 0, 1140, 430), fill=(255, 226, 177, 30))
    draw.line((920, 0, 920, 430), fill=(60, 44, 34, 150), width=10)
    draw.line((690, 210, 1160, 210), fill=(60, 44, 34, 120), width=8)
    for i in range(9):
        draw.line((760 + i * 40, 0, 700 + i * 40, 430), fill=(255, 229, 188, 12), width=18)

    # wall + table
    draw.rectangle((0, 470, W, H), fill=(91, 59, 39))
    for y in range(470, H, 26):
        draw.line((0, y, W, y), fill=(112, 74, 48, 110), width=2)
    draw.rectangle((0, 470, W, 486), fill=(50, 31, 21))

    # menu board
    rounded(draw, (86, 96, 388, 330), 8, fill=(26, 20, 17, 235), outline=(185, 139, 96, 120), width=3)
    label(draw, (116, 126), "TODAY'S MENU", 17, (203, 159, 108), bold=True)
    label(draw, (116, 174), "LATTE", 36, (255, 239, 213), bold=True)
    label(draw, (304, 190), "¥28", 32, (255, 189, 103), bold=True)
    label(draw, (116, 234), "AMERICANO        ¥22", 19, (206, 186, 161))
    label(draw, (116, 268), "CROISSANT        ¥18", 19, (206, 186, 161))
    label(draw, (116, 306), "OPEN 08:00 – 20:00", 13, (147, 126, 106))

    # saucer + cup
    cx, cy = 690, 545
    draw.ellipse((cx - 160, cy + 40, cx + 160, cy + 120), fill=(45, 31, 23, 110))
    draw.ellipse((cx - 132, cy + 10, cx + 132, cy + 92), fill=(238, 231, 217))
    draw.ellipse((cx - 108, cy + 20, cx + 108, cy + 78), fill=(205, 196, 180))
    draw.ellipse((cx - 88, cy - 92, cx + 88, cy + 48), fill=(246, 241, 230))
    draw.ellipse((cx - 76, cy - 84, cx + 76, cy + 34), fill=(88, 53, 30))
    draw.ellipse((cx - 66, cy - 76, cx + 66, cy + 20), fill=(190, 139, 88))
    # latte art heart
    draw.ellipse((cx - 36, cy - 60, cx + 2, cy - 22), fill=(247, 235, 214))
    draw.ellipse((cx - 2, cy - 60, cx + 36, cy - 22), fill=(247, 235, 214))
    draw.polygon([(cx - 40, cy - 40), (cx + 40, cy - 40), (cx, cy + 6)], fill=(247, 235, 214))
    draw.ellipse((cx - 14, cy - 48, cx + 8, cy - 26), fill=(190, 139, 88))

    # handle
    draw.arc((cx + 80, cy - 60, cx + 154, cy + 14), -90, 90, fill=(238, 231, 217), width=15)

    # steam
    for i in range(3):
        points = []
        for k in range(36):
            yy = cy - 100 - k * 5
            xx = cx - 30 + i * 30 + math.sin(k * 0.32 + t * 2.6 + i) * (8 + k * 0.3)
            points.append((xx, yy))
        draw.line(points, fill=(255, 247, 232, 32), width=5)

    # croissant
    draw.ellipse((300, 540, 430, 610), fill=(196, 134, 64))
    draw.ellipse((322, 554, 408, 596), fill=(224, 168, 95))
    for i in range(4):
        draw.arc((318 + i * 22, 546, 390 + i * 10, 604), 190, 350, fill=(160, 104, 44), width=3)

    # notebook + hand
    draw.rectangle((980, 500, 1210, 670), fill=(232, 219, 194))
    for i in range(6):
        draw.line((1002, 530 + i * 22, 1186, 530 + i * 22), fill=(166, 148, 120, 140), width=2)
    draw.ellipse((1080, 610, 1220, 710), fill=(190, 139, 104))
    draw.rounded_rectangle((1100, 620, 1235, 690), 25, fill=(190, 139, 104))

    label(draw, (44, 646), "08:24  /  CORNER CAFE  /  WINDOW SEAT 02", 15, (225, 201, 174))
    return vignette(image, 100)


def scene_office(t: float, p: float) -> Image.Image:
    image = vertical_gradient((30, 41, 54), (13, 18, 25))
    draw = ImageDraw.Draw(image, "RGBA")

    # window blinds
    for i in range(20):
        draw.rectangle((0, 20 + i * 24, 380, 36 + i * 24), fill=(112, 148, 170, 18))
    draw.rectangle((0, 0, 380, H), fill=(86, 122, 146, 12))

    # screen
    rounded(draw, (430, 96, 1100, 486), 12, fill=(9, 14, 20), outline=(90, 110, 130, 100), width=3)
    rounded(draw, (452, 118, 1078, 464), 6, fill=(18, 31, 44))
    label(draw, (486, 146), "Q4 目标", 24, (127, 206, 224), bold=True)
    label(draw, (486, 178), "120%", 70, (122, 240, 255), bold=True)
    label(draw, (760, 204), "营收增长", 22, (166, 188, 201))

    # chart
    base_y = 416
    heights = [82, 128, 164, 206, 182]
    for i, h in enumerate(heights):
        x = 486 + i * 108
        grow = min(1.0, max(0.05, p * 1.6 - i * 0.08))
        hh = int(h * grow)
        rounded(draw, (x, base_y - hh, x + 50, base_y), 4, fill=(72 + i * 14, 164 + i * 8, 205, 235))
        label(draw, (x + 25, base_y - hh - 24), f"{78 + i * 11}%", 13, (167, 203, 216), anchor="ma")

    # table
    draw.rectangle((0, 500, W, H), fill=(52, 60, 70))
    draw.rectangle((0, 500, W, 514), fill=(88, 100, 112))
    draw.ellipse((300, 510, 880, 590), fill=(40, 46, 54, 80))

    # two seated people
    for i, (x, coat) in enumerate([(270, (45, 54, 67)), (1010, (74, 61, 72))]):
        draw.ellipse((x - 34, 340, x + 34, 408), fill=(48, 40, 36))
        rounded(draw, (x - 58, 402, x + 58, 560), 24, fill=coat)
        draw.line((x - 50, 442, x - 116, 520), fill=coat, width=22)
        draw.line((x + 50, 442, x + 116, 520), fill=coat, width=22)

    # laptop + mug
    rounded(draw, (640, 520, 820, 570), 5, fill=(28, 34, 42))
    rounded(draw, (618, 566, 842, 584), 4, fill=(70, 80, 92))
    draw.ellipse((880, 528, 930, 570), fill=(226, 225, 218))
    draw.arc((916, 538, 952, 562), -90, 90, fill=(226, 225, 218), width=5)

    # whiteboard note
    rounded(draw, (1118, 100, 1238, 262), 4, fill=(242, 240, 232), outline=(160, 170, 180, 80), width=2)
    label(draw, (1134, 122), "10/28", 17, (70, 78, 90), bold=True)
    label(draw, (1134, 158), "复盘", 22, (70, 78, 90), bold=True)
    label(draw, (1134, 196), "A/B test", 15, (92, 100, 112))

    label(draw, (44, 646), "14:06  /  MEETING ROOM 3F  /  Q4 REVIEW", 15, (179, 194, 206))
    return vignette(image, 95)


def scene_park(t: float, p: float) -> Image.Image:
    image = vertical_gradient((240, 159, 96), (88, 78, 82))
    draw = ImageDraw.Draw(image, "RGBA")

    # sun
    draw.ellipse((840, 280, 1010, 450), fill=(255, 218, 144, 120))
    draw.ellipse((882, 322, 968, 408), fill=(255, 239, 191, 230))

    # distant skyline
    for i, h in enumerate([70, 110, 64, 150, 92, 130]):
        x = i * 120 - 30
        draw.rectangle((x, 420 - h, x + 96, 470), fill=(72, 64, 68, 105))

    # ground
    draw.rectangle((0, 470, W, H), fill=(67, 68, 45))
    draw.polygon([(0, 560), (W, 500), (W, H), (0, H)], fill=(112, 93, 56))
    draw.polygon([(0, 590), (W, 536), (W, 650), (0, 700)], fill=(151, 128, 80))
    draw.polygon([(0, 630), (W, 570), (W, H), (0, H)], fill=(92, 83, 50))

    # trees
    for x, scale in [(100, 1.28), (310, 0.92), (1110, 1.2), (1230, 0.8)]:
        draw.rectangle((x - 12 * scale, 280, x + 12 * scale, 560), fill=(54, 42, 32))
        for dx, dy, r in [(0, 0, 92), (-58, 28, 70), (58, 22, 74), (0, -58, 66)]:
            draw.ellipse(
                (
                    x + dx * scale - r * scale,
                    300 + dy * scale - r * scale,
                    x + dx * scale + r * scale,
                    300 + dy * scale + r * scale,
                ),
                fill=(82 + int(30 * scale), 83, 47, 210),
            )

    # sign
    draw.rectangle((770, 330, 790, 610), fill=(73, 54, 38))
    draw.rectangle((960, 330, 980, 610), fill=(73, 54, 38))
    rounded(draw, (742, 350, 1008, 500), 6, fill=(230, 219, 191), outline=(112, 83, 52), width=4)
    label(draw, (875, 382), "请勿践踏草坪", 36, (69, 65, 45), bold=True, anchor="ma")
    label(draw, (875, 434), "爱护环境  人人有责", 20, (102, 92, 62), anchor="ma")
    label(draw, (875, 470), "PARK  ·  18:40", 12, (135, 122, 88), anchor="ma")

    # walking people
    person(draw, 470, 612, 0.9, (45, 38, 34), stride=t * 3.0, coat=(112, 58, 45))
    person(draw, 520, 618, 0.72, (45, 38, 34), stride=t * 3.0 + 1.2, coat=(58, 68, 82))

    # leaves
    for i in range(18):
        x = (i * 173 + int(t * 22 * (1 + i % 3))) % W
        y = 180 + ((i * 97 + int(t * 28 * (1 + i % 2))) % 480)
        draw.ellipse((x, y, x + 9, y + 4), fill=(210, 153, 62, 170))

    label(draw, (44, 646), "18:40  /  RIVERSIDE PARK  /  GOLDEN HOUR", 15, (255, 231, 194))
    return vignette(image, 120)


def build_frame(index: int) -> Image.Image:
    t = index / FPS
    scene = min(3, int(t // 3))
    p = (t % 3) / 3
    if scene == 0:
        return scene_metro(t, p)
    if scene == 1:
        return scene_cafe(t, p)
    if scene == 2:
        return scene_office(t, p)
    return scene_park(t, p)


def main() -> None:
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR)
    TMP_DIR.mkdir(parents=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for index in range(TOTAL):
        frame = build_frame(index)
        frame.save(TMP_DIR / f"frame_{index:04d}.png", optimize=False)

    output = OUT_DIR / "demo.mp4"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(TMP_DIR / "frame_%04d.png"),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-g",
        str(FPS),
        "-keyint_min",
        str(FPS),
        "-sc_threshold",
        "0",
        "-movflags",
        "+faststart",
        str(output),
    ]
    subprocess.run(command, check=True)
    shutil.rmtree(TMP_DIR)
    print(f"wrote {output} ({output.stat().st_size / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
