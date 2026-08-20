# -*- coding: utf-8 -*-
"""Genera public/static/iconos/autos.png — grilla 10x10 de cochecitos 3D."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

COLS = 10
ROWS = 10
CELL = 200
SCALE = 2
WORK = CELL * SCALE
OUT = Path(__file__).resolve().parent / "autos.png"

PAPEL = (244, 240, 230)
NIEVE = (255, 252, 247)
LINEA = (217, 210, 196)


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def mix(c, o, a):
    return tuple(int(c[i] * (1 - a) + o[i] * a) for i in range(3))


def dark(c, a=0.28):
    return mix(c, (0, 0, 0), a)


def lite(c, a=0.28):
    return mix(c, (255, 255, 255), a)


def iso(x, y, z):
    return (x - z) * 0.8660254, (x + z) * 0.5 - y


class Cam:
    def __init__(self, ox, oy, s):
        self.ox = ox
        self.oy = oy
        self.s = s

    def p(self, x, y, z):
        sx, sy = iso(x, y, z)
        return (self.ox + sx * self.s, self.oy + sy * self.s)


def poly(draw, pts, fill, outline=None, width=2):
    pts = [(round(x), round(y)) for x, y in pts]
    draw.polygon(pts, fill=fill)
    if outline:
        pts2 = pts + [pts[0]]
        draw.line(pts2, fill=outline, width=width, joint="curve")


def box(draw, cam, x0, x1, y0, y1, z0, z1, color, glass=False):
    c = rgb(color) if isinstance(color, str) else color
    top = lite(c, 0.34 if not glass else 0.55)
    right = c if not glass else mix(c, (160, 210, 230), 0.35)
    left = dark(c, 0.22 if not glass else 0.1)
    ink = dark(c, 0.5)
    P = cam.p
    poly(draw, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], top, ink)
    poly(draw, [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right, ink)
    poly(draw, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], left, ink)
    if glass:
        hl = lite(top, 0.45)
        poly(
            draw,
            [
                P(x0 + (x1 - x0) * 0.12, y1, z0 + (z1 - z0) * 0.12),
                P(x1 - (x1 - x0) * 0.35, y1, z0 + (z1 - z0) * 0.12),
                P(x1 - (x1 - x0) * 0.45, y1, z1 - (z1 - z0) * 0.18),
                P(x0 + (x1 - x0) * 0.12, y1, z1 - (z1 - z0) * 0.18),
            ],
            hl,
            None,
        )


def wheel(draw, cam, x, z, y=0, rx=7.2, rz=4.2):
    pts = []
    for i in range(16):
        a = i / 16 * math.tau
        pts.append(cam.p(x + math.cos(a) * rx, y, z + math.sin(a) * rz))
    poly(draw, pts, (45, 46, 54), (22, 22, 28), 2)
    hub = []
    for i in range(12):
        a = i / 12 * math.tau
        hub.append(cam.p(x + math.cos(a) * rx * 0.38, y + 1.2, z + math.sin(a) * rz * 0.38))
    poly(draw, hub, (196, 198, 206), (120, 122, 130), 1)


def shadow(draw, cam, w, l, y=0):
    pts = []
    for i in range(24):
        a = i / 24 * math.tau
        pts.append(cam.p(math.cos(a) * (w * 0.62), y, math.sin(a) * (l * 0.58)))
    poly(draw, pts, (198, 188, 172), None)


def wheels4(draw, cam, w, l, r=7.0):
    wx = w * 0.42
    wz = l * 0.32
    pares = [(-wx, wz), (wx, wz), (-wx, -wz), (wx, -wz)]
    pares.sort(key=lambda t: iso(t[0], 0, t[1])[1])
    for x, z in pares:
        wheel(draw, cam, x, z, 0, r, r * 0.58)


def windshield(draw, cam, x0, x1, y0, y1, z, color="#9fd4e8"):
    box(draw, cam, x0, x1, y0, y1, z - 1.2, z + 1.2, color, glass=True)


def lights_front(draw, cam, w, y, z, color=(255, 236, 170)):
    for s in (-1, 1):
        box(draw, cam, s * w * 0.38 - 2.2, s * w * 0.38 + 2.2, y, y + 3.2, z - 1.6, z + 0.6, color)


def lights_rear(draw, cam, w, y, z):
    for s in (-1, 1):
        box(draw, cam, s * w * 0.38 - 2.0, s * w * 0.38 + 2.0, y, y + 3.0, z - 0.6, z + 1.6, "#e74c3c")


def stripe_side(draw, cam, w, h, l, color):
    box(draw, cam, -w * 0.5, w * 0.5, h * 0.35, h * 0.55, -l * 0.45, l * 0.45, color)


def car(draw, cam, color, w=34, h=15, l=50, cabin=0.56, ch=13, open_top=False, roundish=False):
    shadow(draw, cam, w, l)
    wheels4(draw, cam, w, l, 7.1 if h < 18 else 7.6)
    body = color
    x0, x1 = -w / 2, w / 2
    z0, z1 = -l / 2, l / 2
    box(draw, cam, x0, x1, 0, h, z0, z1, body)
    lights_rear(draw, cam, w, h * 0.35, z0)
    lights_front(draw, cam, w, h * 0.38, z1)
    cz0 = z0 + l * 0.08
    cz1 = z0 + l * cabin
    if roundish:
        cz0 = z0 + l * 0.12
        cz1 = z1 - l * 0.16
        ch = h * 0.95
    if not open_top:
        box(draw, cam, x0 * 0.82, x1 * 0.82, h, h + ch, cz0, cz1, lite(rgb(body), 0.06))
        windshield(draw, cam, x0 * 0.7, x1 * 0.7, h + 2, h + ch - 1, cz1, "#8ecae6")
        box(draw, cam, x0 * 0.82, x0 * 0.82 + 2.4, h + 3, h + ch - 2, cz0 + 4, cz1 - 4, "#7eb8d4", True)
        box(draw, cam, x1 * 0.82 - 2.4, x1 * 0.82, h + 3, h + ch - 2, cz0 + 4, cz1 - 4, "#a8d8ea", True)
    else:
        windshield(draw, cam, x0 * 0.7, x1 * 0.7, h + 1, h + ch * 0.55, cz1 - 2, "#8ecae6")


def pickup(draw, cam, color, w=36, h=16, l=56):
    shadow(draw, cam, w, l)
    wheels4(draw, cam, w, l, 7.4)
    x0, x1 = -w / 2, w / 2
    box(draw, cam, x0, x1, 0, h, -l / 2, l / 2, color)
    box(draw, cam, x0 * 0.86, x1 * 0.86, h, h + 14, -l * 0.08, l * 0.48, color)
    windshield(draw, cam, x0 * 0.7, x1 * 0.7, h + 2, h + 13, l * 0.48, "#8ecae6")
    box(draw, cam, x0 * 0.9, x1 * 0.9, h * 0.55, h + 4, -l * 0.48, -l * 0.1, dark(rgb(color), 0.18))
    lights_front(draw, cam, w, h * 0.4, l / 2)
    lights_rear(draw, cam, w, h * 0.35, -l / 2)


def van(draw, cam, color, w=36, h=22, l=54, extra=None):
    shadow(draw, cam, w, l)
    wheels4(draw, cam, w, l, 7.5)
    x0, x1 = -w / 2, w / 2
    box(draw, cam, x0, x1, 0, h, -l / 2, l / 2, color)
    box(draw, cam, x0 * 0.92, x1 * 0.92, h, h + 16, -l * 0.46, l * 0.28, color)
    windshield(draw, cam, x0 * 0.78, x1 * 0.78, h + 2, h + 15, l * 0.28, "#8ecae6")
    box(draw, cam, x0 * 0.92, x0 * 0.92 + 2.2, h + 3, h + 14, -l * 0.3, l * 0.18, "#7eb8d4", True)
    lights_front(draw, cam, w, h * 0.35, l / 2)
    lights_rear(draw, cam, w, h * 0.3, -l / 2)
    if extra == "cross":
        box(draw, cam, -3, 3, h + 6, h + 16, -6, 6, "#c0392b")
        box(draw, cam, -8, 8, h + 9, h + 13, -3, 3, "#c0392b")
    if extra == "stripe":
        stripe_side(draw, cam, w, h, l, "#c0392b")


def bus(draw, cam, color, w=38, h=24, l=72, school=False):
    shadow(draw, cam, w, l * 0.9)
    wheels4(draw, cam, w, l * 0.85, 8.0)
    x0, x1 = -w / 2, w / 2
    box(draw, cam, x0, x1, 0, h, -l / 2, l / 2, color)
    box(draw, cam, x0 * 0.95, x1 * 0.95, h, h + 18, -l * 0.48, l * 0.42, color)
    windshield(draw, cam, x0 * 0.8, x1 * 0.8, h + 2, h + 17, l * 0.42, "#8ecae6")
    for i in range(4):
        z = -l * 0.38 + i * (l * 0.18)
        box(draw, cam, x1 * 0.95 - 2.2, x1 * 0.95, h + 5, h + 15, z, z + 8, "#7eb8d4", True)
    lights_front(draw, cam, w, h * 0.3, l / 2)
    if school:
        box(draw, cam, x0 * 0.7, x1 * 0.7, h + 18, h + 22, -8, 8, "#2c3e50")


def truck_box(draw, cam, cab, boxc, w=38, h=18, l=70):
    shadow(draw, cam, w, l)
    wheels4(draw, cam, w, l, 8.0)
    x0, x1 = -w / 2, w / 2
    box(draw, cam, x0, x1, 0, h, l * 0.08, l / 2, cab)
    box(draw, cam, x0 * 0.86, x1 * 0.86, h, h + 14, l * 0.12, l * 0.48, cab)
    windshield(draw, cam, x0 * 0.7, x1 * 0.7, h + 2, h + 13, l * 0.48, "#8ecae6")
    box(draw, cam, x0 * 0.95, x1 * 0.95, 4, h + 22, -l / 2, l * 0.06, boxc)
    lights_front(draw, cam, w, h * 0.4, l / 2)


def firetruck(draw, cam):
    truck_box(draw, cam, "#c0392b", "#a93226", 40, 18, 74)
    box(draw, cam, -4, 4, 40, 46, -28, 18, "#7f8c8d")
    box(draw, cam, -18, 18, 34, 38, 22, 28, "#f1c40f")


def dump(draw, cam, color="#c0392b"):
    shadow(draw, cam, 38, 60)
    wheels4(draw, cam, 38, 60, 8.2)
    box(draw, cam, -18, 18, 0, 16, 8, 30, color)
    box(draw, cam, -15, 15, 16, 30, 12, 28, color)
    windshield(draw, cam, -12, 12, 18, 29, 28, "#8ecae6")
    box(draw, cam, -20, 20, 10, 32, -32, 6, lite(rgb(color), 0.1))
    lights_front(draw, cam, 36, 8, 30)


def semi(draw, cam, color="#2c3e50"):
    shadow(draw, cam, 40, 78)
    wheels4(draw, cam, 38, 70, 8.4)
    box(draw, cam, -18, 18, 0, 18, 18, 40, color)
    box(draw, cam, -16, 16, 18, 36, 20, 38, color)
    windshield(draw, cam, -13, 13, 20, 35, 38, "#8ecae6")
    box(draw, cam, -20, 20, 8, 34, -40, 16, "#bdc3c7")
    lights_front(draw, cam, 36, 8, 40)


def tractor(draw, cam, color="#27ae60"):
    shadow(draw, cam, 32, 40)
    wheel(draw, cam, -12, -10, 0, 11, 7)
    wheel(draw, cam, 12, -10, 0, 11, 7)
    wheel(draw, cam, -10, 16, 0, 6.2, 4)
    wheel(draw, cam, 10, 16, 0, 6.2, 4)
    box(draw, cam, -12, 12, 6, 16, -8, 18, color)
    box(draw, cam, -10, 10, 16, 30, -6, 8, color)
    windshield(draw, cam, -8, 8, 18, 29, 8, "#8ecae6")
    box(draw, cam, -8, 8, 10, 14, 16, 22, "#f1c40f")


def formula(draw, cam, color="#e74c3c"):
    shadow(draw, cam, 30, 56)
    wheel(draw, cam, -16, 16, 0, 8, 4.5)
    wheel(draw, cam, 16, 16, 0, 8, 4.5)
    wheel(draw, cam, -16, -18, 0, 8, 4.5)
    wheel(draw, cam, 16, -18, 0, 8, 4.5)
    box(draw, cam, -8, 8, 2, 10, -24, 22, color)
    box(draw, cam, -18, 18, 8, 12, 18, 24, dark(rgb(color), 0.2))
    box(draw, cam, -18, 18, 8, 12, -24, -18, dark(rgb(color), 0.2))
    box(draw, cam, -7, 7, 10, 16, -4, 8, "#2c3e50")
    windshield(draw, cam, -6, 6, 12, 16, 8, "#8ecae6")


def buggy(draw, cam, color="#e67e22"):
    shadow(draw, cam, 34, 42)
    wheels4(draw, cam, 36, 44, 8.5)
    box(draw, cam, -14, 14, 4, 12, -16, 16, color)
    box(draw, cam, -12, 12, 12, 20, -8, 8, dark(rgb(color), 0.15))
    box(draw, cam, -16, 16, 18, 20, -14, 14, "#7f8c8d")


def tuktuk(draw, cam, color="#f39c12"):
    shadow(draw, cam, 28, 40)
    wheel(draw, cam, 0, 18, 0, 6, 4)
    wheel(draw, cam, -12, -12, 0, 7, 4.5)
    wheel(draw, cam, 12, -12, 0, 7, 4.5)
    box(draw, cam, -14, 14, 4, 14, -16, 6, color)
    box(draw, cam, -13, 13, 14, 28, -15, 4, color)
    box(draw, cam, -6, 6, 6, 12, 6, 20, dark(rgb(color), 0.1))
    windshield(draw, cam, -11, 11, 16, 27, 4, "#8ecae6")


def golf(draw, cam, color="#27ae60"):
    shadow(draw, cam, 28, 40)
    wheels4(draw, cam, 30, 40, 6.2)
    box(draw, cam, -14, 14, 2, 10, -16, 16, color)
    box(draw, cam, -12, 12, 10, 14, -6, 10, "#ecf0f1")
    box(draw, cam, -1.5, 1.5, 10, 26, 4, 8, "#7f8c8d")
    box(draw, cam, -16, 16, 26, 28, -14, 12, "#bdc3c7")


def kei(draw, cam, color="#3498db"):
    pickup(draw, cam, color, w=28, h=14, l=42)


def limo(draw, cam, color="#1a1a1a"):
    car(draw, cam, color, w=34, h=14, l=78, cabin=0.42, ch=12)
    box(draw, cam, -15, 15, 14, 16, -20, 8, "#2c2c2c")


def moto(draw, cam, color, fairing=True, police=False):
    shadow(draw, cam, 16, 42)
    wheel(draw, cam, 0, 16, 0, 7.5, 5)
    wheel(draw, cam, 0, -16, 0, 7.5, 5)
    box(draw, cam, -4, 4, 6, 12, -14, 12, color)
    if fairing:
        box(draw, cam, -7, 7, 10, 18, 6, 16, color)
        windshield(draw, cam, -6, 6, 14, 22, 16, "#8ecae6")
    box(draw, cam, -10, 10, 11, 13, -6, 6, "#2c3e50")
    person_sit(draw, cam, 0, 12, -2, "#2c3e50", "#f5d0c5")
    if police:
        box(draw, cam, -5, 5, 20, 23, 4, 10, "#e74c3c")
        box(draw, cam, -5, 5, 20, 23, -2, 4, "#3498db")


def scooter(draw, cam, color="#7f8c8d"):
    shadow(draw, cam, 14, 34)
    wheel(draw, cam, 0, 12, 0, 5.5, 3.8)
    wheel(draw, cam, 0, -12, 0, 5.5, 3.8)
    box(draw, cam, -5, 5, 4, 8, -10, 8, color)
    box(draw, cam, -2, 2, 8, 22, 6, 10, color)
    box(draw, cam, -8, 8, 20, 22, 4, 12, "#2c3e50")
    person_sit(draw, cam, 0, 8, -2, "#34495e", "#f5d0c5", standing=True)


def bike(draw, cam, frame, rider="#2980b9", basket=False, cargo=False):
    shadow(draw, cam, 14, 36)
    wheel(draw, cam, 0, 14, 0, 8, 5.2)
    wheel(draw, cam, 0, -14, 0, 8, 5.2)
    box(draw, cam, -1.4, 1.4, 4, 16, -12, 12, frame)
    box(draw, cam, -1.4, 1.4, 10, 18, 8, 14, frame)
    box(draw, cam, -8, 8, 16, 18, 10, 14, frame)
    if basket:
        box(draw, cam, -6, 6, 12, 18, 14, 20, "#d4a574")
    if cargo:
        box(draw, cam, -8, 8, 8, 16, -22, -12, "#e67e22")
    person_sit(draw, cam, 0, 14, 0, rider, "#f5d0c5")


def person_sit(draw, cam, x, y, z, clothes, skin, standing=False):
    h0 = y + (8 if standing else 4)
    box(draw, cam, x - 5, x + 5, y, h0 + 6, z - 4, z + 4, clothes)
    box(draw, cam, x - 4.2, x + 4.2, h0 + 6, h0 + 14, z - 3.5, z + 3.5, skin)
    box(draw, cam, x - 4.6, x + 4.6, h0 + 13.2, h0 + 16, z - 3.8, z + 3.2, "#3d2b1f")


def person(draw, cam, shirt, pants="#2c3e50", skin="#f5d0c5", hair="#3d2b1f", pose="walk", extra=None):
    shadow(draw, cam, 16, 14)
    zf = 5 if pose == "walk" else 8
    zb = -4 if pose == "walk" else -6
    if pose == "run":
        zf, zb = 9, -7
    box(draw, cam, -3.2, 1.2, 0, 12, zb, zb + 5, pants)
    box(draw, cam, -1.2, 3.2, 0, 12, zf, zf + 5, pants)
    box(draw, cam, -5.5, 5.5, 11, 24, -4, 4, shirt)
    box(draw, cam, -4.8, 4.8, 24, 33, -4.2, 4.2, skin)
    box(draw, cam, -5.2, 5.2, 31.5, 35, -4.5, 3.6, hair)
    if pose != "run":
        box(draw, cam, -8, -5, 14, 23, -2, 3, skin)
        box(draw, cam, 5, 8, 14, 23, -1, 4, skin)
    else:
        box(draw, cam, -9, -5, 16, 22, 2, 8, skin)
        box(draw, cam, 5, 9, 16, 22, -8, -2, skin)
    if extra == "bag":
        box(draw, cam, 5, 10, 12, 22, -3, 3, "#8b5a2b")
    if extra == "backpack":
        box(draw, cam, -7, 7, 14, 24, -8, -4, "#c0392b")
    if extra == "umbrella":
        box(draw, cam, 6, 8, 18, 38, 0, 2, "#7f8c8d")
        box(draw, cam, -6, 16, 36, 39, -8, 10, "#e74c3c")
    if extra == "dog":
        box(draw, cam, 10, 18, 0, 8, -4, 8, "#c4a484")
        box(draw, cam, 16, 20, 6, 12, 4, 8, "#c4a484")
        box(draw, cam, 8, 10, 0, 4, -4, -2, "#c4a484")
    if extra == "helm":
        box(draw, cam, -5.6, 5.6, 32, 37, -5, 4.5, "#f1c40f")
    if extra == "hat":
        box(draw, cam, -7, 7, 33, 36, -6, 5, "#8b5a2b")
    if extra == "cane":
        box(draw, cam, 7, 9, 0, 24, 4, 6, "#8b5a2b")
    if extra == "phone":
        box(draw, cam, 6, 9, 18, 24, 3, 5, "#2c3e50")
    if extra == "shop":
        box(draw, cam, 6, 12, 4, 16, -2, 4, "#27ae60")
        box(draw, cam, -12, -6, 4, 16, -2, 4, "#e67e22")
    if extra == "hivis":
        box(draw, cam, -6, 6, 16, 20, -5, 5, "#f1c40f")
    if extra == "skirt":
        box(draw, cam, -6.5, 6.5, 8, 14, -5, 5, shirt)
    if extra == "skates":
        box(draw, cam, -4, 2, -2, 2, zb - 2, zb + 6, "#e74c3c")
        box(draw, cam, -2, 4, -2, 2, zf - 2, zf + 6, "#e74c3c")
    if extra == "board":
        box(draw, cam, -6, 6, -1, 2, -14, 14, "#3498db")
    if extra == "chair":
        box(draw, cam, -10, 10, 0, 4, -12, 12, "#7f8c8d")
        wheel(draw, cam, -8, -8, 0, 5, 3.5)
        wheel(draw, cam, 8, -8, 0, 5, 3.5)
        wheel(draw, cam, -8, 8, 0, 5, 3.5)
        wheel(draw, cam, 8, 8, 0, 5, 3.5)
    if extra == "stroller":
        box(draw, cam, 8, 22, 4, 16, -8, 8, "#3498db")
        wheel(draw, cam, 10, -8, 0, 4.5, 3)
        wheel(draw, cam, 20, 6, 0, 4.5, 3)


def police_bar(draw, cam, y, z=0):
    box(draw, cam, -8, 0, y, y + 3.5, z - 4, z + 4, "#e74c3c")
    box(draw, cam, 0, 8, y, y + 3.5, z - 4, z + 4, "#3498db")


def checkers(draw, cam, w, y, l):
    for i in range(6):
        z0 = -l * 0.4 + i * (l * 0.13)
        col = "#1a1a1a" if i % 2 == 0 else "#f4d03f"
        box(draw, cam, -w * 0.5, w * 0.5, y, y + 3, z0, z0 + l * 0.12, col)


def draw_item(draw, cam, spec):
    k = spec["k"]
    c = spec.get("c", "#d97706")
    if k == "mini":
        car(draw, cam, c, 28, 14, 40, 0.62, 12)
    elif k == "hatch":
        car(draw, cam, c, 32, 16, 46, 0.64, 13)
    elif k == "sedan":
        car(draw, cam, c, 34, 15, 54, 0.5, 12)
    elif k == "wagon":
        car(draw, cam, c, 34, 16, 58, 0.72, 13)
    elif k == "coupe":
        car(draw, cam, c, 34, 13, 50, 0.48, 11)
    elif k == "sport":
        car(draw, cam, c, 36, 11, 52, 0.42, 9)
        box(draw, cam, -16, 16, 11, 14, -26, -20, dark(rgb(c), 0.2))
    elif k == "conv":
        car(draw, cam, c, 34, 12, 50, 0.5, 12, open_top=True)
    elif k == "beetle":
        car(draw, cam, c, 32, 16, 42, 0.7, 14, roundish=True)
    elif k == "suv":
        car(draw, cam, c, 38, 20, 54, 0.6, 16)
    elif k == "jeep":
        car(draw, cam, c, 36, 18, 44, 0.55, 14)
        box(draw, cam, -18, 18, 0, 5, -22, 22, "#4d463d")
    elif k == "pickup":
        pickup(draw, cam, c)
    elif k == "van":
        van(draw, cam, c)
    elif k == "minivan":
        van(draw, cam, c, 36, 20, 52)
    elif k == "taxi":
        car(draw, cam, "#f4d03f", 34, 15, 52, 0.5, 12)
        checkers(draw, cam, 34, 10, 40)
        box(draw, cam, -6, 6, 27, 31, -4, 4, "#f4d03f")
    elif k == "police":
        car(draw, cam, "#f5f6f8", 34, 15, 54, 0.5, 12)
        stripe_side(draw, cam, 34, 15, 50, "#1e4b7b")
        police_bar(draw, cam, 28, -2)
    elif k == "ambulance":
        van(draw, cam, "#f8f8f8", extra="cross")
        stripe_side(draw, cam, 36, 22, 50, "#c0392b")
    elif k == "fire":
        firetruck(draw, cam)
    elif k == "school":
        bus(draw, cam, "#f1c40f", school=True)
    elif k == "bus":
        bus(draw, cam, c)
    elif k == "delivery":
        van(draw, cam, c)
        box(draw, cam, -8, 8, 30, 36, -8, 8, "#2c3e50")
    elif k == "box":
        truck_box(draw, cam, c, spec.get("box", "#ecf0f1"))
    elif k == "tow":
        pickup(draw, cam, c, 36, 16, 58)
        box(draw, cam, -4, 4, 16, 28, -28, -8, "#7f8c8d")
    elif k == "dump":
        dump(draw, cam, c)
    elif k == "semi":
        semi(draw, cam, c)
    elif k == "tractor":
        tractor(draw, cam, c)
    elif k == "buggy":
        buggy(draw, cam, c)
    elif k == "formula":
        formula(draw, cam, c)
    elif k == "limo":
        limo(draw, cam, c)
    elif k == "food":
        van(draw, cam, c)
        box(draw, cam, -16, 16, 38, 46, -16, 12, "#e74c3c")
    elif k == "ice":
        van(draw, cam, "#ecf0f1")
        box(draw, cam, -14, 14, 38, 50, -10, 10, "#3498db")
        box(draw, cam, -16, 16, 48, 52, -12, 12, "#e74c3c")
    elif k == "mail":
        van(draw, cam, "#7f8c8d")
        box(draw, cam, -8, 8, 28, 34, -4, 6, "#1e4b7b")
    elif k == "garbage":
        truck_box(draw, cam, "#2c3e50", "#27ae60", 38, 18, 68)
    elif k == "rv":
        van(draw, cam, c, 40, 24, 64)
        box(draw, cam, -18, 18, 40, 46, -20, 8, "#bdc3c7")
    elif k == "kei":
        kei(draw, cam, c)
    elif k == "tuktuk":
        tuktuk(draw, cam, c)
    elif k == "golf":
        golf(draw, cam, c)
    elif k == "muscle":
        car(draw, cam, c, 38, 13, 52, 0.44, 10)
        stripe_side(draw, cam, 30, 10, 36, "#f8f8f8")
    elif k == "luxury":
        car(draw, cam, c, 36, 15, 58, 0.48, 13)
    elif k == "offroad":
        car(draw, cam, c, 38, 20, 50, 0.55, 14, roundish=False)
    elif k == "camper":
        van(draw, cam, c, 38, 22, 58)
    elif k == "moto":
        moto(draw, cam, c, True, False)
    elif k == "cruiser":
        moto(draw, cam, c, False, False)
    elif k == "motopol":
        moto(draw, cam, "#f5f6f8", True, True)
    elif k == "scooter":
        scooter(draw, cam, c)
    elif k == "moped":
        scooter(draw, cam, c)
    elif k == "bike":
        bike(draw, cam, c, spec.get("rider", "#2980b9"), spec.get("basket", False), spec.get("cargo", False))
    elif k == "person":
        person(
            draw,
            cam,
            spec.get("shirt", "#3498db"),
            spec.get("pants", "#2c3e50"),
            spec.get("skin", "#f5d0c5"),
            spec.get("hair", "#3d2b1f"),
            spec.get("pose", "walk"),
            spec.get("extra"),
        )
    else:
        car(draw, cam, c)


def catalog():
    items = [
        {"k": "mini", "c": "#e85d04"},
        {"k": "mini", "c": "#2a9d8f"},
        {"k": "hatch", "c": "#e76f51"},
        {"k": "hatch", "c": "#457b9d"},
        {"k": "sedan", "c": "#1d3557"},
        {"k": "sedan", "c": "#b56576"},
        {"k": "wagon", "c": "#588157"},
        {"k": "wagon", "c": "#bc6c25"},
        {"k": "coupe", "c": "#9b2226"},
        {"k": "coupe", "c": "#3d405b"},
        {"k": "sport", "c": "#d00000"},
        {"k": "sport", "c": "#ffba08"},
        {"k": "sport", "c": "#3a0ca3"},
        {"k": "conv", "c": "#ef476f"},
        {"k": "conv", "c": "#06d6a0"},
        {"k": "beetle", "c": "#118ab2"},
        {"k": "beetle", "c": "#ffd166"},
        {"k": "beetle", "c": "#ef476f"},
        {"k": "suv", "c": "#283618"},
        {"k": "suv", "c": "#606c38"},
        {"k": "suv", "c": "#1e4b7b"},
        {"k": "jeep", "c": "#606c38"},
        {"k": "jeep", "c": "#bc6c25"},
        {"k": "jeep", "c": "#ae2012"},
        {"k": "pickup", "c": "#495057"},
        {"k": "pickup", "c": "#1d3557"},
        {"k": "pickup", "c": "#9c6644"},
        {"k": "van", "c": "#6c757d"},
        {"k": "minivan", "c": "#8d99ae"},
        {"k": "taxi"},
        {"k": "police"},
        {"k": "ambulance"},
        {"k": "fire"},
        {"k": "school"},
        {"k": "bus", "c": "#1e4b7b"},
        {"k": "bus", "c": "#2a9d8f"},
        {"k": "delivery", "c": "#f4a261"},
        {"k": "delivery", "c": "#7b2cbf"},
        {"k": "box", "c": "#c1121f", "box": "#f8f9fa"},
        {"k": "box", "c": "#1e4b7b", "box": "#ffd166"},
        {"k": "tow", "c": "#f77f00"},
        {"k": "dump", "c": "#d62828"},
        {"k": "dump", "c": "#fcbf49"},
        {"k": "semi", "c": "#212529"},
        {"k": "semi", "c": "#1e4b7b"},
        {"k": "tractor", "c": "#2d6a4f"},
        {"k": "tractor", "c": "#e9c46a"},
        {"k": "buggy", "c": "#e85d04"},
        {"k": "buggy", "c": "#00b4d8"},
        {"k": "formula", "c": "#d00000"},
        {"k": "formula", "c": "#4361ee"},
        {"k": "limo", "c": "#111111"},
        {"k": "food", "c": "#ffb703"},
        {"k": "ice"},
        {"k": "mail"},
        {"k": "garbage"},
        {"k": "rv", "c": "#a8dadc"},
        {"k": "rv", "c": "#f1faee"},
        {"k": "kei", "c": "#48cae4"},
        {"k": "kei", "c": "#ff8500"},
        {"k": "tuktuk", "c": "#f4a261"},
        {"k": "tuktuk", "c": "#e63946"},
        {"k": "golf", "c": "#52b788"},
        {"k": "muscle", "c": "#9b2226"},
        {"k": "muscle", "c": "#240046"},
        {"k": "luxury", "c": "#2b2d42"},
        {"k": "luxury", "c": "#8d99ae"},
        {"k": "offroad", "c": "#6b705c"},
        {"k": "camper", "c": "#b08968"},
        {"k": "moto", "c": "#ef233c"},
        {"k": "moto", "c": "#2b2d42"},
        {"k": "cruiser", "c": "#6c584c"},
        {"k": "motopol"},
        {"k": "scooter", "c": "#00bbf9"},
        {"k": "scooter", "c": "#9b5de5"},
        {"k": "moped", "c": "#fee440"},
        {"k": "bike", "c": "#2c3e50", "rider": "#1e4b7b"},
        {"k": "bike", "c": "#e74c3c", "rider": "#27ae60", "basket": True},
        {"k": "bike", "c": "#27ae60", "rider": "#8e44ad"},
        {"k": "bike", "c": "#f39c12", "rider": "#e67e22", "cargo": True},
        {"k": "person", "shirt": "#3aa0c8", "pose": "walk"},
        {"k": "person", "shirt": "#e76f51", "hair": "#6b3f2a", "pose": "walk"},
        {"k": "person", "shirt": "#2a9d8f", "pose": "run"},
        {"k": "person", "shirt": "#457b9d", "extra": "backpack"},
        {"k": "person", "shirt": "#e63946", "extra": "bag"},
        {"k": "person", "shirt": "#1d3557", "extra": "umbrella"},
        {"k": "person", "shirt": "#f4a261", "extra": "dog"},
        {"k": "person", "shirt": "#264653", "extra": "helm", "pants": "#4d463d"},
        {"k": "person", "shirt": "#fff1e6", "extra": "hat", "pants": "#6c584c"},
        {"k": "person", "shirt": "#adb5bd", "extra": "cane", "hair": "#ced4da"},
        {"k": "person", "shirt": "#4895ef", "extra": "phone"},
        {"k": "person", "shirt": "#b5179e", "extra": "shop"},
        {"k": "person", "shirt": "#2b2d42", "extra": "hivis"},
        {"k": "person", "shirt": "#ef476f", "extra": "skirt", "pants": "#ef476f"},
        {"k": "person", "shirt": "#06d6a0", "pose": "run", "extra": "skates"},
        {"k": "person", "shirt": "#118ab2", "extra": "board", "pose": "walk"},
        {"k": "person", "shirt": "#4361ee", "extra": "chair"},
        {"k": "person", "shirt": "#ff8fab", "extra": "stroller"},
        {"k": "person", "shirt": "#ffd166", "hair": "#f4a261", "skin": "#d4a574"},
        {"k": "person", "shirt": "#90be6d", "hair": "#1b1b1b", "skin": "#8d5524"},
    ]
    return items


def render_cell(spec):
    img = Image.new("RGBA", (WORK, WORK), (0, 0, 0, 0))
    bg = Image.new("RGB", (WORK, WORK), NIEVE)
    d0 = ImageDraw.Draw(bg)
    d0.rectangle([0, 0, WORK - 1, WORK - 1], outline=LINEA, width=2)
    draw = ImageDraw.Draw(img, "RGBA")
    k = spec["k"]
    if k == "person":
        cam = Cam(WORK * 0.50, WORK * 0.78, 4.15)
    elif k in ("bike", "moto", "cruiser", "motopol", "scooter", "moped"):
        cam = Cam(WORK * 0.50, WORK * 0.62, 4.55)
    elif k in ("bus", "school", "semi", "fire", "limo", "rv", "garbage"):
        cam = Cam(WORK * 0.50, WORK * 0.58, 3.15)
    else:
        cam = Cam(WORK * 0.50, WORK * 0.60, 3.85)
    draw_item(draw, cam, spec)
    bg.paste(img, (0, 0), img)
    return bg.resize((CELL, CELL), Image.Resampling.LANCZOS)


def main():
    items = catalog()
    if len(items) != COLS * ROWS:
        raise SystemExit("se esperaban %s iconos, hay %s" % (COLS * ROWS, len(items)))
    sheet = Image.new("RGB", (COLS * CELL, ROWS * CELL), PAPEL)
    i = 0
    for y in range(ROWS):
        for x in range(COLS):
            cell = render_cell(items[i])
            sheet.paste(cell, (x * CELL, y * CELL))
            i += 1
    sheet.save(OUT, "PNG", optimize=True)
    print("ok", OUT, sheet.size, "iconos", len(items))


if __name__ == "__main__":
    main()
