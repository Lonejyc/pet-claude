#!/usr/bin/env python3
"""Icône de la barre de menus : silhouette 2D du pet de face, noir sur transparent (image "template" macOS :
le système la teinte en blanc en mode sombre). Les yeux sont des trous. Sans dépendance : PNG écrit à la main."""
import struct, sys, zlib

SIZE, SS = 64, 8  # 64 px final, dessiné en 8x puis réduit pour un bord net sans crénelage
# formes en unités du pet (même repère que pet3d.ts / l'icône SVG d'origine)
SOLID = [(22, 12, 76, 54), (8, 34, 14, 14), (98, 34, 14, 14)] + [(x, 66, 8, 16) for x in (30, 44, 68, 82)]
HOLES = [(40, 30, 8, 16), (72, 30, 8, 16)]
x0, y0, x1, y1 = 8, 12, 112, 82  # boîte englobante
scale = (SIZE - 4) / (x1 - x0)  # 2 px de marge de chaque côté
ox = (SIZE - (x1 - x0) * scale) / 2
oy = (SIZE - (y1 - y0) * scale) / 2

def covered(px, py):
    ux, uy = (px / SS - ox) / scale + x0, (py / SS - oy) / scale + y0
    inside = lambda r: r[0] <= ux < r[0] + r[2] and r[1] <= uy < r[1] + r[3]
    return any(map(inside, SOLID)) and not any(map(inside, HOLES))

rows = []
for j in range(SIZE):
    row = bytearray(b"\x00")
    for i in range(SIZE):
        n = sum(covered(i * SS + a, j * SS + b) for a in range(SS) for b in range(SS))
        row += bytes((0, 0, 0, round(255 * n / (SS * SS))))
    rows.append(bytes(row))

def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)) \
    + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
print(f"{sys.argv[1]} : {len(png)} octets")
