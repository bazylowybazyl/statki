// Różnice na krawędziach vs we wnętrzach (zadanie 16): czy różnica WebGL ↔ WebGPU siedzi tylko na sylwetkach.
// Tolerancja portu (baseline.json → tolerancjaPortu) zakłada mało krawędzi w kadrze; scena gęsta w krawędzie
// (szczegółowy model, chmura trójkątów rozpadu) przekracza próg mimo zgodności — wtedy rozstrzyga ten podział.
// Piksel „krawędzi” = w bazie lub w nowym obrazie różnica jasności z którymkolwiek sąsiadem (3×3) > --prog-krawedzi
// (domyślnie 24/255), rozszerzone o --promien px. Wynik na scenę: % pikseli >8 ogółem, udział tych różnic na
// krawędziach, % pikseli >8 we wnętrzach (poza krawędziami), maks. różnica we wnętrzu.
//
//   node scripts/webgpu/krawedzie.mjs --a <katalog bazy> --b <katalog nowy> [--sceny a,b] [--prog-krawedzi 24] [--promien 1]
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readPng } from './png.mjs';
import { parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const A = resolve(repo, args.a);
const B = resolve(repo, args.b);
const edgeThr = Number(args['prog-krawedzi'] || 24);
const radius = Math.max(0, Number(args.promien ?? 1));
const only = args.sceny ? new Set(args.sceny.split(',')) : null;

function luma(img) {
  const n = img.width * img.height;
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
  return l;
}

function edgeMask(img, w, h) {
  const l = luma(img);
  const m = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = l[y * w + x];
      let e = 0;
      for (let dy = -1; dy <= 1 && !e; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(l[(y + dy) * w + x + dx] - c) > edgeThr) { e = 1; break; }
      m[y * w + x] = e;
    }
  }
  return m;
}

function dilate(m, w, h, r) {
  if (r <= 0) return m;
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

const files = readdirSync(A).filter((f) => f.endsWith('.png') && existsSync(join(B, f)) && (!only || only.has(f.replace(/\.png$/, ''))));
console.log('| scena | >8 ogółem | krawędzie w kadrze | różnice >8 na krawędziach | >8 we wnętrzach | maks. we wnętrzu |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const f of files.sort()) {
  const a = readPng(join(A, f));
  const b = readPng(join(B, f));
  if (a.width !== b.width || a.height !== b.height) continue;
  const w = a.width, h = a.height, n = w * h;
  const ea = edgeMask(a, w, h);
  const eb = edgeMask(b, w, h);
  const edge = new Uint8Array(n);
  for (let i = 0; i < n; i++) edge[i] = ea[i] | eb[i];
  const em = dilate(edge, w, h, radius);
  let d8 = 0, d8edge = 0, d8int = 0, maxInt = 0, edges = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    if (em[i]) edges++;
    if (d > 8) {
      d8++;
      if (em[i]) d8edge++; else d8int++;
    }
    if (!em[i] && d > maxInt) maxInt = d;
  }
  const pct = (v) => `${(100 * v / n).toFixed(4)}%`;
  console.log(`| ${f.replace(/\.png$/, '')} | ${pct(d8)} | ${pct(edges)} | ${d8 ? (100 * d8edge / d8).toFixed(1) : '—'}% | ${pct(d8int)} | ${maxInt} |`);
}
