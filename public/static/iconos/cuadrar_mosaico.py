# -*- coding: utf-8 -*-
"""Arma autos.png: grilla 15x8 de celdas cuadradas, un auto por celda."""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(__file__).resolve().parent / "autos-original.png"
OUT = Path(__file__).resolve().parent / "autos.png"

COLS = 15
ROWS = 8
CELL = 128
PAD = 12
FONDO = 14


def a_rgba(im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def es_fondo(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and r <= FONDO and g <= FONDO and b <= FONDO

    vistos = bytearray(w * h)
    cola = deque()

    def meter(x, y):
        if 0 <= x < w and 0 <= y < h and not vistos[y * w + x]:
            vistos[y * w + x] = 1
            cola.append((x, y))

    for x in range(w):
        meter(x, 0)
        meter(x, h - 1)
    for y in range(h):
        meter(0, y)
        meter(w - 1, y)

    while cola:
        x, y = cola.popleft()
        if not es_fondo(x, y):
            continue
        px[x, y] = (0, 0, 0, 0)
        meter(x + 1, y)
        meter(x - 1, y)
        meter(x, y + 1)
        meter(x, y - 1)
    return im


def perfil(mask, eje):
    return mask.sum(axis=eje).astype(np.float64)


def suavizar(s, k=7):
    k = k if k % 2 else k + 1
    ker = np.ones(k) / k
    return np.convolve(s, ker, mode="same")


def cortes(profile, n_celdas, borde=18):
    """n_celdas+1 bordes: 0, valles interiores, largo."""
    n = len(profile)
    s = suavizar(profile, 7)
    need = n_celdas - 1
    min_dist = max(10, int(n / n_celdas * 0.38))
    cands = []
    for i in range(borde, n - borde):
        if s[i] <= s[i - 1] and s[i] <= s[i + 1]:
            izq = s[max(0, i - 50):i].max()
            der = s[i:min(n, i + 50)].max()
            depth = min(izq, der) - s[i]
            cands.append((-depth, float(s[i]), i))
    cands.sort()
    chosen = []
    for _d, _v, i in cands:
        if all(abs(i - j) >= min_dist for j in chosen):
            chosen.append(i)
        if len(chosen) >= need:
            break
    if len(chosen) < need:
        step = n / n_celdas
        chosen = [int(round(step * i)) for i in range(1, n_celdas)]
    chosen.sort()
    return [0] + chosen + [n]


def recorte_contenido(tile):
    alpha = np.array(tile.split()[-1])
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return None
    caja = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return tile.crop(caja)


def caber(tile, lado, pad):
    interior = max(8, lado - 2 * pad)
    tw, th = tile.size
    escala = min(interior / tw, interior / th)
    nw = max(1, int(round(tw * escala)))
    nh = max(1, int(round(th * escala)))
    return tile.resize((nw, nh), Image.Resampling.LANCZOS)


def main():
    orig = Image.open(SRC)
    limp = a_rgba(orig)
    arr = np.array(limp)
    mask = arr[:, :, 3] > 8
    xs = cortes(perfil(mask, 0), COLS)
    ys = cortes(perfil(mask, 1), ROWS)

    hoja = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    vacias = 0
    for row in range(ROWS):
        for col in range(COLS):
            caja = (xs[col], ys[row], xs[col + 1], ys[row + 1])
            tile = recorte_contenido(limp.crop(caja))
            if tile is None:
                vacias += 1
                continue
            tile = caber(tile, CELL, PAD)
            ox = col * CELL + (CELL - tile.size[0]) // 2
            oy = row * CELL + (CELL - tile.size[1]) // 2
            hoja.paste(tile, (ox, oy), tile)

    if hoja.size[0] % COLS or hoja.size[1] % ROWS:
        raise SystemExit("dimensiones no divisibles")
    hoja.save(OUT, "PNG", optimize=True)
    print(
        "ok",
        OUT.name,
        hoja.size,
        "celda",
        CELL,
        "grilla",
        COLS,
        "x",
        ROWS,
        "vacias",
        vacias,
    )
    print("cortes x", xs)
    print("cortes y", ys)


if __name__ == "__main__":
    main()
