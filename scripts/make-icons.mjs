// Generiše PNG ikone (košarkaška lopta) bez spoljnih biblioteka.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Pozadina tamna, narandžasta lopta sa šavovima; maskable-safe (lopta u 70% površine)
function ball(x, y, s) {
  const bg = [26, 26, 25, 255];
  const cx = s / 2, cy = s / 2, R = s * 0.35;
  const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
  if (d > R) return bg;
  const lw = s * 0.022;
  const seam =
    Math.abs(dx) < lw || Math.abs(dy) < lw ||
    Math.abs(Math.hypot(dx - R * 1.25, dy) - R * 0.95) < lw ||
    Math.abs(Math.hypot(dx + R * 1.25, dy) - R * 0.95) < lw;
  if (seam || d > R - lw) return [26, 26, 25, 255];
  const shade = 1 - 0.25 * ((dx + dy) / (2 * R) + 0.5);
  return [Math.round(240 * shade), Math.round(110 * shade), Math.round(30 * shade), 255];
}
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(path.join(ROOT, 'icons', name), png(size, ball));
}
console.log('Ikone napravljene.');
