"""Generate a clean 512x512 PNG logo for SkillGuard (dark slate background with emerald shield & lock icon)."""

import math
from pathlib import Path
import struct
import zlib


def make_png(width: int, height: int, rgba_bytes: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        raw_rows.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), level=9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def generate_logo(out_path: Path):
    w = h = 512
    buf = bytearray(w * h * 4)

    cx, cy = 256.0, 256.0
    for y in range(h):
        for x in range(w):
            idx = (y * w + x) * 4
            # Rounded dark navy background
            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)

            # Base gradient (#080c17 -> #0f172a)
            r = int(8 + (y / h) * 12)
            g = int(12 + (y / h) * 18)
            b = int(23 + (y / h) * 26)

            # Subtle radial emerald/cyan glow in center
            if dist < 210:
                glow = (1.0 - dist / 210.0) ** 2
                r = int(r + glow * 10)
                g = int(g + glow * 58)
                b = int(b + glow * 62)

            # Shield geometry: top y=96..250, tapering to bottom tip at (256, 420)
            in_shield = False
            in_inner = False
            if 96 <= y <= 416:
                ny = (y - 96) / 320.0
                if ny < 0.48:
                    half_w = 138.0 - (0.48 - ny) * 18.0
                else:
                    t = (ny - 0.48) / 0.52
                    half_w = 138.0 * (1.0 - (t ** 1.45))
                if abs(dx) <= half_w:
                    in_shield = True
                if 114 <= y <= 396 and abs(dx) <= max(0.0, half_w - 16.0):
                    in_inner = True

            if in_shield and not in_inner:
                # Shield border: vibrant emerald->cyan gradient
                t_grad = (y - 96) / 320.0
                r = int(16 * (1 - t_grad) + 6 * t_grad)
                g = int(185 * (1 - t_grad) + 182 * t_grad)
                b = int(129 * (1 - t_grad) + 212 * t_grad)
            elif in_inner:
                # Inner shield dark surface
                r, g, b = 13, 25, 43
                # Checkmark inside shield: two line segments
                # P1=(196, 258) -> P2=(240, 302) -> P3=(322, 206)
                def dist_seg(px, py, x1, y1, x2, y2):
                    vx, vy = x2 - x1, y2 - y1
                    wx, wy = px - x1, py - y1
                    c1 = vx * wx + vy * wy
                    if c1 <= 0:
                        return math.hypot(px - x1, py - y1)
                    c2 = vx * vx + vy * vy
                    if c2 <= c1:
                        return math.hypot(px - x2, py - y2)
                    b_ratio = c1 / c2
                    bx, by = x1 + b_ratio * vx, y1 + b_ratio * vy
                    return math.hypot(px - bx, py - by)

                d_check = min(
                    dist_seg(x, y, 196, 258, 240, 302),
                    dist_seg(x, y, 240, 302, 322, 206),
                )
                if d_check <= 15.0:
                    r, g, b = 52, 211, 153

            buf[idx] = max(0, min(255, r))
            buf[idx + 1] = max(0, min(255, g))
            buf[idx + 2] = max(0, min(255, b))
            buf[idx + 3] = 255

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(make_png(w, h, bytes(buf)))
    print(f"Generated {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    generate_logo(root / "public" / "skillguard-logo.png")
