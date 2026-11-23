"""Draws the default app icon (512x423, the Samsung TV app panel size) into app/icon.png.
A stack of two photos on a deep-blue tile; the front one is a sunset over the ocean; a small play badge.
Drawn at 4x and scaled down for clean edges. Needs Pillow:  python tools/make_icon.py
(To use your own Immich server's logo instead, set ICON_FROM_SERVER=1 in .env.)"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

S = 4
W, H = 512 * S, 423 * S
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'icon.png')


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgradient(w, h, stops):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                d.line([(0, y), (w, y)], fill=lerp(c0, c1, (t - p0) / (p1 - p0)))
                break
    return img


def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return m


def sunset(w, h):
    img = vgradient(w, h, [(0, (88, 64, 196)), (0.35, (233, 92, 140)), (0.62, (255, 160, 90)), (1, (255, 196, 120))])
    d = ImageDraw.Draw(img)
    horizon, r, cx = int(h * 0.60), int(w * 0.17), int(w * 0.62)
    d.ellipse([cx - r, horizon - r * 1.15, cx + r, horizon + r * 0.85], fill=(255, 226, 140))
    for color, off in [((30, 86, 170), 0.0), ((22, 66, 140), 0.12), ((14, 46, 104), 0.25)]:
        y0 = horizon + int(h * off)
        pts = [(0, h)] + [(x, y0 + math.sin(x / w * math.pi * 3 + off * 9) * h * 0.025) for x in range(0, w + 1, 8)] + [(w, h)]
        d.polygon(pts, fill=color)
    for i, yy in enumerate(range(horizon + int(h * 0.04), horizon + int(h * 0.30), int(h * 0.05))):
        half = int(r * (0.9 - i * 0.15))
        if half > 0:
            d.rounded_rectangle([cx - half, yy, cx + half, yy + max(2, int(h * 0.012))], 4, fill=(255, 214, 150))
    return img


def card(w, h, scene=None):
    border = int(w * 0.055)
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    c.paste((250, 250, 252, 255), (0, 0), rounded_mask(w, h, int(w * 0.06)))
    iw, ih = w - 2 * border, h - 2 * border
    inner = scene(iw, ih) if scene else Image.new('RGB', (iw, ih), (205, 214, 230))
    c.paste(inner, (border, border), rounded_mask(iw, ih, int(w * 0.03)))
    return c


def shadow(layer, blur, alpha):
    sh = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.split()[3].point(lambda a: a * alpha // 255))
    return sh.filter(ImageFilter.GaussianBlur(blur))


def main():
    bg = vgradient(W, H, [(0, (16, 30, 72)), (0.6, (34, 58, 140)), (1, (60, 46, 150))]).convert('RGBA')
    cw, ch = int(W * 0.50), int(H * 0.52)
    for img, cx, cy in [(card(cw, ch).rotate(11, resample=Image.BICUBIC, expand=True), W * 0.44, H * 0.47),
                        (card(cw, ch, sunset).rotate(-6, resample=Image.BICUBIC, expand=True), W * 0.54, H * 0.53)]:
        x, y = int(cx - img.width / 2), int(cy - img.height / 2)
        bg.alpha_composite(shadow(img, 14 * S, 110), (x + 6 * S, y + 10 * S))
        bg.alpha_composite(img, (x, y))
    r, bx, by = int(H * 0.115), int(W * 0.80), int(H * 0.79)
    badge = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    d.ellipse([bx - r, by - r, bx + r, by + r], fill=(138, 180, 248, 255), outline=(255, 255, 255, 255), width=int(r * 0.12))
    t = r * 0.42
    d.polygon([(bx - t * 0.7, by - t), (bx - t * 0.7, by + t), (bx + t, by)], fill=(255, 255, 255, 255))
    bg.alpha_composite(shadow(badge, 8 * S, 90), (0, 4 * S))
    bg.alpha_composite(badge)
    bg.convert('RGB').resize((512, 423), Image.LANCZOS).save(OUT, optimize=True)
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
