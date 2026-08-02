"""Generate the extension's PNG icons.

No image library is installed, and pulling one in for three small icons would be
silly — PNG is simple enough to write directly. Shapes are drawn at 4x and
averaged down, which is what gives the edges their smoothness.
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
SCALE = 4  # supersampling factor

AMBER = (240, 166, 60)
AMBER_DEEP = (206, 128, 34)
DARK = (26, 18, 5)


def write_png(path, width, height, rows):
    raw = b"".join(
        b"\x00" + bytes(channel for pixel in row for channel in pixel) for row in rows
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )


def inside_rounded_rect(x, y, size, radius):
    if x < radius and y < radius:
        return math.hypot(radius - x, radius - y) <= radius
    if x > size - radius and y < radius:
        return math.hypot(x - (size - radius), radius - y) <= radius
    if x < radius and y > size - radius:
        return math.hypot(radius - x, y - (size - radius)) <= radius
    if x > size - radius and y > size - radius:
        return math.hypot(x - (size - radius), y - (size - radius)) <= radius
    return 0 <= x <= size and 0 <= y <= size


def inside_note(x, y, size):
    """A quarter note: slanted oval head, stem on its right, flag off the top."""
    unit = size / 100.0

    # Head — an oval rotated a little, the way a notehead sits.
    hx, hy = 38 * unit, 70 * unit
    dx, dy = (x - hx) / (19 * unit), (y - hy) / (14 * unit)
    angle = math.radians(-20)
    rx = dx * math.cos(angle) - dy * math.sin(angle)
    ry = dx * math.sin(angle) + dy * math.cos(angle)
    if rx * rx + ry * ry <= 1:
        return True

    # Stem.
    if 52 * unit <= x <= 60 * unit and 22 * unit <= y <= 72 * unit:
        return True

    # Flag: a wedge curving down and right off the top of the stem.
    if 60 * unit <= x <= 78 * unit and 22 * unit <= y <= 48 * unit:
        top = 22 * unit
        curve = top + ((x - 60 * unit) / (18 * unit)) ** 1.5 * 18 * unit
        if curve <= y <= curve + 11 * unit:
            return True

    return False


def render(size):
    big = size * SCALE
    radius = big * 0.22
    rows = []

    for y in range(size):
        row = []
        for x in range(size):
            r_sum = g_sum = b_sum = a_sum = 0
            for sy in range(SCALE):
                for sx in range(SCALE):
                    px = x * SCALE + sx + 0.5
                    py = y * SCALE + sy + 0.5
                    if not inside_rounded_rect(px, py, big, radius):
                        continue
                    if inside_note(px, py, big):
                        colour = DARK
                    else:
                        # Diagonal gradient across the tile.
                        t = (px + py) / (2 * big)
                        colour = tuple(
                            round(AMBER[i] + (AMBER_DEEP[i] - AMBER[i]) * t)
                            for i in range(3)
                        )
                    r_sum += colour[0]
                    g_sum += colour[1]
                    b_sum += colour[2]
                    a_sum += 255

            samples = SCALE * SCALE
            if a_sum == 0:
                row.append((0, 0, 0, 0))
            else:
                covered = a_sum / 255
                row.append(
                    (
                        round(r_sum / covered),
                        round(g_sum / covered),
                        round(b_sum / covered),
                        round(a_sum / samples),
                    )
                )
        rows.append(row)
    return rows


os.makedirs(OUT_DIR, exist_ok=True)
for size in (16, 48, 128):
    path = os.path.join(OUT_DIR, f"icon{size}.png")
    write_png(path, size, size, render(size))
    print(f"  {os.path.basename(path)}  {os.path.getsize(path)} bytes")
