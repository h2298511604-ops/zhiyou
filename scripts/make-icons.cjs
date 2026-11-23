/*
 * 从 icons/zhiyou-qingdai.svg 生成 manifest 实际加载的三张 PNG。
 *
 * 为什么不用截图：扩展图标必须可复现、可离线重建。这里用 16 倍超采样
 * 自己栅格化 SVG 里的三个轮廓，不依赖浏览器或外部图像库。
 *
 *   node scripts/make-icons.cjs            重新生成 16 / 32 / 48 / 128
 *   node scripts/make-icons.cjs --check    只校验现有 PNG 与 SVG 是否一致
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const SVG_FILE = path.join(ROOT, 'icons', 'zhiyou-qingdai.svg');
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;              // 每个像素 4×4 采样
const VIEWBOX = 32;

/* ---------------- 极简 SVG 读取 ---------------- */

function shapesFromSvg(source) {
  const shapes = [];
  const re = /<(rect|path)\b([^>]*)\/?>/g;
  for (const match of source.matchAll(re)) {
    const attrs = Object.create(null);
    for (const attr of match[2].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[attr[1]] = attr[2];
    if (match[1] === 'rect') {
      shapes.push({
        kind: 'rect',
        x: Number(attrs.x || 0), y: Number(attrs.y || 0),
        w: Number(attrs.width), h: Number(attrs.height), rx: Number(attrs.rx || 0),
        color: hex(attrs.fill)
      });
    } else {
      shapes.push({ kind: 'path', d: attrs.d, color: hex(attrs.fill) });
    }
  }
  if (shapes.length !== 4) throw new Error('期望 1 个 rect + 3 条 path，实际读到 ' + shapes.length + ' 个图形');
  return shapes;
}

function hex(value) {
  const m = /^#([\da-f]{6})$/i.exec(String(value || '').trim());
  if (!m) throw new Error('只支持 #RRGGBB 填充色，读到：' + value);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------------- 路径展开：直线 + 圆弧 ---------------- */

function tokens(d) {
  const out = [];
  const re = /([MmLlHhVvAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)/g;
  for (const m of d.matchAll(re)) out.push(m[1] || Number(m[2]));
  return out;
}

function arcPoints(x0, y0, rx, ry, rot, large, sweep, x1, y1) {
  if (!rx || !ry) return [[x1, y1]];
  const phi = (rot * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const base = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return ux * vy - uy * vx < 0 ? -base : base;
  };
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const steps = Math.max(6, Math.ceil(Math.abs(delta) / (Math.PI / 32)));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = start + (delta * i) / steps;
    const px = cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin;
    const py = cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos;
    points.push([px, py]);
  }
  return points;
}

function flatten(d) {
  const list = tokens(d);
  const rings = [];
  let ring = [];
  let x = 0, y = 0, startX = 0, startY = 0;
  let command = '';
  let i = 0;
  const num = () => list[i++];
  while (i < list.length) {
    if (typeof list[i] === 'string') command = list[i++];
    const rel = command === command.toLowerCase();
    const C = command.toUpperCase();
    if (C === 'Z') {
      if (ring.length) { ring.push([startX, startY]); rings.push(ring); ring = []; }
      x = startX; y = startY;
      command = '';
      continue;
    }
    if (C === 'M') {
      if (ring.length) { ring.push([startX, startY]); rings.push(ring); }
      x = num(); y = num();
      if (rel) { x += startX; y += startY; }
      startX = x; startY = y;
      ring = [[x, y]];
      command = rel ? 'l' : 'L';
      continue;
    }
    if (C === 'L') { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; ring.push([x, y]); continue; }
    if (C === 'H') { const nx = num(); x = rel ? x + nx : nx; ring.push([x, y]); continue; }
    if (C === 'V') { const ny = num(); y = rel ? y + ny : ny; ring.push([x, y]); continue; }
    if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      const nx = num(), ny = num();
      const ex = rel ? x + nx : nx, ey = rel ? y + ny : ny;
      for (const p of arcPoints(x, y, rx, ry, rot, !!large, !!sweep, ex, ey)) ring.push(p);
      x = ex; y = ey;
      continue;
    }
    throw new Error('未支持的路径指令：' + command);
  }
  if (ring.length) { ring.push([startX, startY]); rings.push(ring); }
  return rings;
}

/* ---------------- 栅格化 ---------------- */

function inPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedRect(px, py, shape) {
  if (px < shape.x || py < shape.y || px > shape.x + shape.w || py > shape.y + shape.h) return false;
  const rx = Math.min(shape.rx, shape.w / 2), ry = Math.min(shape.rx, shape.h / 2);
  if (!rx || !ry) return true;
  const cx = Math.min(Math.max(px, shape.x + rx), shape.x + shape.w - rx);
  const cy = Math.min(Math.max(py, shape.y + ry), shape.y + shape.h - ry);
  const dx = (px - cx) / rx, dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function render(shapes, size) {
  const rings = shapes.filter(s => s.kind === 'path').map(s => ({ rings: flatten(s.d), color: s.color }));
  const rect = shapes.find(s => s.kind === 'rect');
  const pixels = Buffer.alloc(size * size * 4);
  const scale = VIEWBOX / size;
  const step = 1 / SAMPLES;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) * step) * scale;
          const py = (y + (sy + 0.5) * step) * scale;
          let color = null;
          if (rect && inRoundedRect(px, py, rect)) color = rect.color;
          for (const shape of rings) {
            for (const ring of shape.rings) if (inPolygon(px, py, ring)) { color = shape.color; break; }
          }
          if (color) { r += color[0]; g += color[1]; b += color[2]; hits++; }
        }
      }
      const at = (y * size + x) * 4;
      if (!hits) continue;
      pixels[at] = Math.round(r / hits);
      pixels[at + 1] = Math.round(g / hits);
      pixels[at + 2] = Math.round(b / hits);
      pixels[at + 3] = Math.round((hits * 255) / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;   // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 入口 ---------------- */

function main() {
  const svg = fs.readFileSync(SVG_FILE, 'utf8');
  const shapes = shapesFromSvg(svg);
  const check = process.argv.includes('--check');
  let changed = 0;
  for (const size of SIZES) {
    const file = path.join(ROOT, 'icons', 'icon' + size + '.png');
    const next = encodePng(render(shapes, size), size);
    const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (current && current.equals(next)) continue;
    changed++;
    if (check) { console.log('需要更新：icons/icon' + size + '.png'); continue; }
    fs.writeFileSync(file, next);
    console.log('已生成 icons/icon' + size + '.png（' + next.length + ' B）');
  }
  if (!changed) console.log('四张图标与 icons/zhiyou-qingdai.svg 一致，无需更新。');
  else if (check) { console.error('图标与规范 SVG 不一致，跑一次 node scripts/make-icons.cjs。'); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { render, encodePng, shapesFromSvg, flatten, SIZES };
