// src/game/sector/sectorRandom.js
//
// LOSOWOŚĆ SEKTORA Z ZIARNA (mapa gwiezdna). Dane sektora (układy, planety, mgławice, floty) liczy się
// wyłącznie stąd — nigdy z `Math.random` (sekwencja rozgrywki) ani z `fxRandom` (obraz). Każdy cel ma
// własny strumień (`hashU32(ziarno, 'pozycje')`, `hashU32(ziarno, idUkładu, 'ciała')`…), więc zmiana
// jednej części generatora nie przesuwa pozostałych: dodanie pola do opisu planety nie zmienia
// położenia gwiazd, a nowa flota nie zmienia planet.
//
// Moduł czysty: bez three, DOM i importów — testowalny w Node.

/** Hasz u32 części (liczby i napisy) — FNV-1a po bajtach + wymieszanie lowbias32. */
export function hashU32(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? String(part >>> 0 === part ? part : Math.round(part * 1e6)) : String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // Separator części: ('ab', 'c') ≠ ('a', 'bc').
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h >>> 0);
}

/** lowbias32 (Wellons) — wymieszanie u32. */
export function mix32(x) {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Krok mulberry32 na stanie w obiekcie (`holder.rng` — u32). Bez alokacji: floty trzymają stan losowania
 * we własnym rekordzie (migawka floty = liczby), a decyzje w kroku nie tworzą domknięć.
 */
export function rngStep(holder) {
  const s = (holder.rng + 0x6d2b79f5) | 0;
  holder.rng = s >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Generator z ziarna (generacja sektora — poza gorącymi pętlami). */
export class SectorRng {
  constructor(seed) {
    this.rng = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) */
  next() { return rngStep(this); }

  /** [a, b) */
  range(a, b) { return a + (b - a) * rngStep(this); }

  /** Całkowita z [a, b] (obustronnie). */
  int(a, b) { return a + Math.floor(rngStep(this) * (b - a + 1)); }

  chance(p) { return rngStep(this) < p; }

  pick(arr) { return arr[Math.floor(rngStep(this) * arr.length) % arr.length]; }

  /** Rozkład normalny (Box–Muller), średnia 0, odchylenie 1. */
  gauss() {
    const u = Math.max(1e-12, rngStep(this));
    const v = rngStep(this);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Wybór z wag: [[wartość, waga], …]. */
  weighted(entries) {
    let sum = 0;
    for (const e of entries) sum += e[1];
    let r = rngStep(this) * sum;
    for (const e of entries) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }
}

/** Szum wartości 2D (gładki, [0, 1]) z ziarna — kształt mgławic po stronie rozgrywki (CPU, deterministyczny). */
export function valueNoise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = cellHash(ix, iy, seed);
  const b = cellHash(ix + 1, iy, seed);
  const c = cellHash(ix, iy + 1, seed);
  const d = cellHash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Hasz komórki siatki → [0, 1). */
function cellHash(cx, cy, seed) {
  return mix32((Math.imul(cx | 0, 0x8da6b343) ^ Math.imul(cy | 0, 0xd8163841) ^ seed) >>> 0) / 4294967296;
}

/** Szum fraktalny 2D (oktawy szumu wartości), [0, 1]. */
export function fbm2(x, y, seed, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(x * f, y * f, (seed + Math.imul(o, 0x9e3779b9)) >>> 0) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
