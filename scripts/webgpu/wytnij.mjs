// Wycinek PNG (podgląd szczegółów zrzutów harnessu): node scripts/webgpu/wytnij.mjs wejście.png wyjście.png x y w h [skala]
import { readPng, writePng } from './png.mjs';

const [src, dst, x0, y0, w0, h0, s0] = process.argv.slice(2);
const img = readPng(src);
const x = Number(x0) | 0, y = Number(y0) | 0, w = Number(w0) | 0, h = Number(h0) | 0;
const s = Math.max(1, Number(s0) | 0 || 1);
const out = { width: w * s, height: h * s, data: new Uint8Array(w * s * h * s * 4) };
for (let j = 0; j < h * s; j++) {
  for (let i = 0; i < w * s; i++) {
    const sx = Math.min(img.width - 1, x + ((i / s) | 0)), sy = Math.min(img.height - 1, y + ((j / s) | 0));
    const si = (sy * img.width + sx) * 4, di = (j * w * s + i) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = img.data[si + k];
  }
}
writePng(dst, out);
