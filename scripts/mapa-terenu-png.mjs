// Mapa terenu (src/3d/planetGen/planetGenTerrainMap.js) do pliku PNG — bez przeglądarki i GPU.
//   node scripts/mapa-terenu-png.mjs [--ziarno 1] [--roz 1024] [--km 20] [--rzeka 120] [--out .tmp/teren/mapa.png]
//        [--wytnij "x,y,szer,wys"]  (wycinek w tekselach — do porównań ze zdjęciem wzorca)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { generateTerrainMap } from '../src/3d/planetGen/planetGenTerrainMap.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** PNG RGB 8-bit z bufora RGBA. */
export function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const r = y * (w * 3 + 1);
    raw[r] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      raw[r + 1 + x * 3] = rgba[s];
      raw[r + 2 + x * 3] = rgba[s + 1];
      raw[r + 3 + x * 3] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const size = Number(args.roz || 1024);
const map = generateTerrainMap({ seed: Number(args.ziarno || 1), size, extentKm: Number(args.km || 20), riverWidthM: Number(args.rzeka || 120) });
let { albedo } = map;
let w = size;
let h = size;
if (args.wytnij) {
  const [cx, cy, cw, chh] = String(args.wytnij).split(',').map(Number);
  const out = new Uint8ClampedArray(cw * chh * 4);
  for (let y = 0; y < chh; y++) out.set(albedo.subarray(((cy + y) * size + cx) * 4, ((cy + y) * size + cx + cw) * 4), y * cw * 4);
  albedo = out; w = cw; h = chh;
}
const file = resolve(args.out || '.tmp/teren/mapa.png');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, encodePng(albedo, w, h));
console.log(file, `${w}×${h}`, JSON.stringify(Object.fromEntries(Object.entries(map.stats).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]))));
