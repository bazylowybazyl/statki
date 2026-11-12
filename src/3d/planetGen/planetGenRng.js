// src/3d/planetGen/planetGenRng.js
//
// Losowanie generatora planet z ZIARNA (uint32) — deterministyczne, niezależne od Math.random gry (zasada żelazna 9)
// i od fxRandom obrazu: ta sama planeta wychodzi z tego samego ziarna w każdej sesji, w workerze i w Node. Osobne
// strumienie na cel (`rngFor(seed, 'teren')`) — nowy parametr w jednym strumieniu nie przesuwa pozostałych.
// Moduł czysty.

/** Hasz napisu (FNV-1a 32 bity). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mieszanie dwóch liczb 32-bitowych (splitmix-podobne). */
export function mix32(a, b) {
  let h = (a ^ Math.imul(b >>> 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Generator mulberry32 z pomocnikami. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    /** Wybór z wagami: [[wartość, waga], …]. */
    weighted: (pairs) => {
      let sum = 0;
      for (const [, w] of pairs) sum += w;
      let x = next() * sum;
      for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    gauss: () => {
      const u = Math.max(1e-12, next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    /** Kierunek jednostkowy równomiernie na kuli. */
    dir: () => {
      const z = next() * 2 - 1;
      const t = next() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      return [s * Math.cos(t), z, s * Math.sin(t)];
    },
    /** Kierunek na kuli z szerokością w [latLo, latHi] stopni (oś Y = biegun N). */
    dirInLat: (latLo, latHi) => {
      const lat = (latLo + (latHi - latLo) * next()) * Math.PI / 180;
      const lon = next() * Math.PI * 2;
      return [-Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)];
    }
  };
  return rng;
}

/** Strumień losowań dla celu (napis) z ziarna planety. */
export function rngFor(seed, purpose) {
  return makeRng(mix32(seed >>> 0, hashString(purpose)));
}

/** Nowe ziarno z czasu i licznika (demo „losuj” — poza grą). */
let _ctr = 0;
export function freshSeed(salt = 0) {
  const t = (typeof performance !== 'undefined' ? performance.now() : 0) * 1000;
  return mix32((Date.now() ^ (t >>> 0)) >>> 0, (++_ctr * 2654435761 + salt) >>> 0);
}
