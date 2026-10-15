// Środowisko spike'u Rust → WASM: jedna pamięć liniowa dla obu wariantów jądra (A — skalar, B — simd128),
// alokator magazynów SoA w tej pamięci (widoki Float64Array / Int32Array / Uint8Array — bez kopiowania co krok),
// przełącznik trybu i blok parametrów wywołań.
//
// Tryby (RT.mode): 'js' — oryginalne funkcje z src/ (dane i tak w pamięci WASM), 'A' — skalar, 'B' — simd128.
// Pamięć NIE rośnie w trakcie (grow odłącza wszystkie widoki): rozmiar z BEAMS_WASM_MB (domyślnie 1536 MB).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MB = Number(process.env.BEAMS_WASM_MB || 1536);
const pages = Math.ceil(MB * 1024 * 1024 / 65536);
const memory = new WebAssembly.Memory({ initial: pages, maximum: 65536 });
const instantiate = (name) => new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(here, '..', 'pkg', `beams_${name}.wasm`))), { env: { memory } });
const A = instantiate('scalar');
const B = instantiate('simd');

// Alokator: przesuwny wskaźnik + wolne bloki po rozmiarze (zwrot przez FinalizationRegistry właściciela bloku).
const BASE = 4 << 20;                 // pierwsze 4 MB: stos jądra (1 MB) i blok parametrów
let top = BASE;
const free = new Map();               // rozmiar → [ptr]
let live = 0, peak = 0, reused = 0;
const registry = new FinalizationRegistry(({ ptr, size }) => {
  let l = free.get(size); if (!l) free.set(size, l = []);
  l.push(ptr); live -= size;
});
function alloc(size, owner) {
  size = (size + 15) & ~15;
  let ptr;
  const l = free.get(size);
  if (l && l.length) { ptr = l.pop(); new Uint8Array(memory.buffer, ptr, size).fill(0); reused++; }
  else {
    ptr = top; top += size;
    if (top > memory.buffer.byteLength) throw new Error(`rust-beams: pamięć WASM ${MB} MB za mała (BEAMS_WASM_MB)`);
  }
  live += size; if (live > peak) peak = live;
  if (owner) registry.register(owner, { ptr, size });
  return ptr;
}

/**
 * Blok tablic jednego właściciela: spec = [[pole, Konstruktor, długość], …] → { pole: widok }.
 * Pola f64 pierwsze (wyrównanie 8), potem i32 / u32 / u16, na końcu u8.
 */
function allocArrays(owner, spec) {
  let size = 0;
  const offs = [];
  const order = spec.slice().sort((a, b) => b[1].BYTES_PER_ELEMENT - a[1].BYTES_PER_ELEMENT);
  for (const [, T, n] of order) { offs.push(size); size += ((n * T.BYTES_PER_ELEMENT) + 7) & ~7; }
  const ptr = alloc(Math.max(16, size), owner);
  const out = {};
  order.forEach(([f, T, n], k) => { out[f] = new T(memory.buffer, ptr + offs[k], n); });
  return out;
}

const PARAM = 1 << 20;                // blok parametrów nad stosem jądra (stos rośnie w dół od 1 MB)
const P = new Uint32Array(memory.buffer, PARAM, 64);
const F = new Float64Array(memory.buffer, PARAM + 256, 16);
const PF = PARAM + 256;

export const RT = {
  memory, A, B, alloc, allocArrays, P, F, PARAM, PF,
  mode: process.env.BEAMS_MODE || 'js',
  check: process.env.BEAMS_CHECK === '1',
  get exports() { return this.mode === 'B' ? B.exports : A.exports; },
  inWasm(t) { return t && t.buffer === memory.buffer; },
  stats() { return { liveMB: +(live / 1048576).toFixed(1), peakMB: +(peak / 1048576).toFixed(1), topMB: +(top / 1048576).toFixed(1), reused }; },
  // Liczniki wywołań i czasu jąder (tylko gdy RT.timing — ten sam narzut w każdym trybie).
  timing: false,
  t: { prepare: 0, project: 0, scan: 0, nPrepare: 0, nProject: 0, nScan: 0 },
  resetTimes() { for (const k of Object.keys(this.t)) this.t[k] = 0; }
};
globalThis.__rustBeams = RT;
