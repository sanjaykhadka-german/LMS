"""One-shot generator for PWA icons. Run once; outputs to static/icons/.

Burgundy (#7C1D1D) background with a cream "GB" monogram in Georgia Bold
(closest serif we have on Windows to Playfair Display). The maskable variant
adds ~20% safe-area padding so Android's circular mask doesn't crop the mark.
"""
import os
from PIL import Image, ImageDraw, ImageFont

BURGUNDY = (124, 29, 29)
CREAM = (250, 246, 240)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiab.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
    r"C:\Windows\Fonts\georgia.ttf",
]


def pick_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_monogram(size, padding_ratio=0.0):
    img = Image.new("RGB", (size, size), BURGUNDY)
    draw = ImageDraw.Draw(img)

    # Effective drawable area after safe padding (for maskable).
    inner = int(size * (1.0 - 2 * padding_ratio))
    # Leave breathing room — Pillow's textbbox underestimates the glyph
    # advance for serifs, so target a smaller fraction of the inner height.
    target_height = int(inner * 0.46)

    # Find a font size whose rendered "GB" height matches target_height.
    text = "GB"
    lo, hi = 10, size
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        font = pick_font(mid)
        bbox = draw.textbbox((0, 0), text, font=font)
        h = bbox[3] - bbox[1]
        if h <= target_height:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1

    font = pick_font(best)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), text, fill=CREAM, font=font)
    return img


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    draw_monogram(192).save(os.path.join(out_dir, "icon-192.png"), "PNG")
    draw_monogram(512).save(os.path.join(out_dir, "icon-512.png"), "PNG")
    # Maskable: ~20% padding on each side so the mark sits in the safe zone.
    draw_monogram(512, padding_ratio=0.20).save(
        os.path.join(out_dir, "icon-512-maskable.png"), "PNG"
    )
    print("Wrote icons to", out_dir)


if __name__ == "__main__":
    main()
