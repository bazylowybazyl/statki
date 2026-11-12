// src/3d/planetGen/planetGenPlace.js
//
// MIEJSCE NA PLANECIE → ustawienia MAPY TERENU (planetGenTerrainMap.js). Złącze między planetą a trzecim poziomem
// szczegółowości: dla wskazanego punktu planety czyta dane, które wypiek planety zostawił na CPU (`baked.drainage`:
// drzewo rzek, odległość od morza, wysokość, temperatura i wilgotność z tego samego klimatu co barwy planety),
// i wybiera: styl i szerokość rzeki, kierunek spływu (rzeka na mapie płynie tak jak na planecie, przy delcie morze
// leży po właściwej stronie), roślinność, bok mapy i ziarno miejsca (to samo miejsce = ta sama mapa).
//
// Czysty JS (bez three, GPU i DOM). Mapa terenu nie odtwarza planety teksel w teksel — bierze z niej, CO jest
// w miejscu (rzeka tej wielkości płynąca w tę stronę, morze w tym kierunku, taki klimat), i buduje krajobraz w swojej
// skali.
import { DRAIN_SEA_K, drainFlowDecode, drainReceiver } from './planetGenDrainage.js';
import { mix32 } from './planetGenRng.js';
import { terrainForestColor, PLANET_VEGETATION } from './planetGenTerrainMap.js';

// kodowanie klimatu w 8 bitach (pola `temp` i `moist` w `baked.drainage`)
export const PLACE_T = Object.freeze({ lo: -1, hi: 2 });
export const PLACE_M = Object.freeze({ lo: -0.5, hi: 2 });
export const encodeClimate = (v, R) => Math.max(0, Math.min(255, Math.round((v - R.lo) / (R.hi - R.lo) * 255)));
export const decodeClimate = (b, R) => R.lo + b / 255 * (R.hi - R.lo);
/** Jak mocno barwy roślinności mapy idą ku barwie lasu planety (0 — paleta mapy, 1 — barwa planety). */
export const PLACE_TINT = 0.5;

/** Kierunek planety → (u, v) mapy (układ wypieku: φ = 2πu, θ = π(1 − v), kierunek (−cos φ sin θ, cos θ, sin φ sin θ)). */
export function dirToUv(dir) {
  const l = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
  const v = 1 - Math.acos(Math.max(-1, Math.min(1, dir[1] / l))) / Math.PI;
  let u = Math.atan2(dir[2], -dir[0]) / (2 * Math.PI);
  if (u < 0) u += 1;
  return { u, v };
}
export function uvToDir(u, v) {
  const phi = 2 * Math.PI * u;
  const theta = Math.PI * (1 - v);
  const st = Math.sin(theta);
  return [-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st];
}

/**
 * Opis miejsca. `baked` — wynik wypieku planety z rzekami (`bakeSystem`), `dir` — kierunek punktu w układzie planety.
 * Wynik: { ok: false, reason } (morze, planeta bez danych) albo { ok: true, u, v, dir (środek mapy na planecie),
 * cell, latDeg, heightM, temp, moist, flow, reliefM, seaKm (droga rzeką do morza albo null), biome (nazwa),
 * supported (czy biom ma już przepis mapy), river (czy w okolicy płynie rzeka), map: { seed, extentKm, river, veg,
 * vegTint, riverWidthM, flowAngle } — gotowe opcje `generateTerrainMap` }.
 */
export function describePlace(baked, dir, { searchKm = 14 } = {}) {
  const d = baked && baked.drainage;
  if (!d || !d.heightM) return { ok: false, reason: 'planeta bez danych miejsca (brak rzek ze spływu)' };
  const W = d.width;
  const H = d.height;
  const data = d.data;
  const rKm = baked.spec.rKm;
  const cellKm = Math.PI * rKm / H;
  const { u, v } = dirToUv(dir);
  let x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
  let y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
  const wrap = (xx) => ((xx % W) + W) % W;
  const idx = (xx, yy) => yy * W + wrap(xx);
  const isLand = (xx, yy) => { const o = idx(xx, yy) * 4; return data[o] !== 0 || data[o + 1] !== 0; };
  const cosAt = (yy) => Math.max(0.05, Math.cos(((yy + 0.5) / H - 0.5) * Math.PI));
  const R = Math.max(2, Math.round(searchKm / cellKm));
  // okolica: komórki w kole o promieniu R (długość geograficzna poszerzona o 1 / cos φ)
  const around = (fn) => {
    const rx = Math.min(W >> 1, Math.ceil(R / cosAt(y)));
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      const c = cosAt(yy);
      for (let dx = -rx; dx <= rx; dx++) {
        const dd = Math.sqrt(dx * c * dx * c + dy * dy);
        if (dd <= R) fn(wrap(x + dx), yy, dd);
      }
    }
  };
  let snapped = false;
  if (!isLand(x, y)) {
    // punkt w morzu: najbliższy ląd w okolicy
    let bd = 1e9;
    let bx = -1;
    let by = -1;
    around((xx, yy, dd) => { if (dd < bd && isLand(xx, yy)) { bd = dd; bx = xx; by = yy; } });
    if (bx < 0) return { ok: false, reason: 'morze', u, v };
    x = bx; y = by; snapped = true;
  }
  // najsilniejsza rzeka okolicy — mapa staje nad nią
  let bg = data[idx(x, y) * 4 + 1];
  let rxB = x;
  let ryB = y;
  let hMin = 1e9;
  let hMax = -1e9;
  around((xx, yy) => {
    if (!isLand(xx, yy)) return;
    const i = idx(xx, yy);
    const g = data[i * 4 + 1];
    if (g > bg) { bg = g; rxB = xx; ryB = yy; }
    const h = d.heightM[i];
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  });
  const flow = drainFlowDecode(bg);
  const hasRiver = flow >= 14;
  if (hasRiver && (rxB !== x || ryB !== y)) { x = rxB; y = ryB; snapped = true; }
  const i0 = idx(x, y);
  // bieg w dół rzeki: kierunek spływu (z kilku pierwszych kroków) i droga do morza
  let east = 0;
  let north = 0;
  let seaKm = null;
  {
    let cx = x;
    let cy = y;
    let km = 0;
    const maxSteps = Math.ceil(60 / cellKm);
    for (let s = 0; s < maxSteps; s++) {
      const r = drainReceiver(d, cx, cy);
      if (!r) break;
      let dx = r.x - cx;
      if (dx > 1) dx -= W; else if (dx < -1) dx += W;
      const dy = r.y - cy;
      const c = cosAt(cy);
      if (s < 5) { east += dx * c; north += dy; }
      km += Math.sqrt(dx * c * dx * c + dy * dy) * cellKm;
      if (!isLand(r.x, r.y)) { seaKm = km; break; }
      cx = r.x; cy = r.y;
    }
  }
  // (bez spływu w danych: kierunek ku najbliższemu morzu z odległości od morza — rzadki przypadek pojedynczej komórki)
  if (east === 0 && north === 0) east = 1;
  const flowAngle = Math.atan2(-north, east);
  const heightM = d.heightM[i0];
  const temp = decodeClimate(d.temp[i0], PLACE_T);
  const moist = decodeClimate(d.moist[i0], PLACE_M);
  const reliefM = hMax > hMin ? hMax - hMin : 0;
  const seaCells = data[i0 * 4 + 2] / DRAIN_SEA_K;
  // biom z klimatu planety (te same progi co barwy lądu planety — earthColor)
  let biome = 'las';
  if (temp < 0.08) biome = 'lód i śnieg';
  else if (heightM > 1800 && reliefM > 900) biome = 'góry';
  else if (temp < 0.2) biome = 'tundra';
  else if (moist < 0.2) biome = 'pustynia';
  else if (moist < 0.38) biome = 'step';
  const supported = biome === 'las';
  // roślinność: układ barw z klimatu (ciepło — las równikowy, chłodno — tajga; planeta o rdzawej roślinności — paleta
  // czerwona), odcień w połowie przesunięty ku barwie lasu PLANETY w tym klimacie — mapa i planeta z orbity są z jednej
  // rodziny barw, a układ jasności (ciemny las, jasne torfowiska) zostaje z palety mapy
  const look = baked.spec.look || {};
  const vegPair = PLANET_VEGETATION[look.vegetation] || PLANET_VEGETATION.zielona;
  const veg = temp > 0.62 ? vegPair[1] : vegPair[0];
  let vegTint = null;
  if (look.palette && look.palette.forest) {
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const toS = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    const P = look.palette;
    const k1 = sm(0.36, 0.55, temp);
    const k2 = sm(0.72, 0.9, temp);
    const ref = terrainForestColor(veg);
    vegTint = [0, 1, 2].map((i) => {
      const lin = (P.taiga[i] * (1 - k1) + P.forest[i] * k1) * (1 - k2) + P.rain[i] * k2;
      const ratio = (toS(lin) + 10) / (ref[i] + 10);
      return Math.round((1 + (Math.min(2.2, Math.max(0.45, ratio)) - 1) * PLACE_TINT) * 1000) / 1000;
    });
  }
  // styl rzeki: ujście do morza w zasięgu mapy → delta; góry → roztoki; wielki przepływ → wielka rzeka; inaczej zakola
  const wFlow = 38 * Math.pow(Math.max(1, flow), 0.33);
  let river = 'meandry';
  let extentKm = 30;
  let riverWidthM = Math.max(70, Math.min(400, wFlow));
  if (!hasRiver) { extentKm = 20; riverWidthM = 60; } else if (seaKm != null && seaKm < 20) {
    river = 'delta'; extentKm = 40; riverWidthM = Math.max(220, Math.min(700, wFlow * 1.2));
  } else if (biome === 'góry' || reliefM > 1500) {
    river = 'roztoki'; extentKm = 16; riverWidthM = Math.max(70, Math.min(220, 70 * Math.pow(Math.max(1, flow) / 100, 0.3)));
  } else if (flow >= 1500) {
    river = 'wielka'; extentKm = 40; riverWidthM = Math.max(600, Math.min(1400, wFlow));
  } else if (riverWidthM > 220) extentKm = 40;
  return {
    ok: true, u: (x + 0.5) / W, v: (y + 0.5) / H, dir: uvToDir((x + 0.5) / W, (y + 0.5) / H), cell: { x, y }, snapped,
    latDeg: ((y + 0.5) / H - 0.5) * 180, heightM, temp, moist, flow, reliefM, seaKm, seaCells, biome, supported, river: hasRiver,
    map: { seed: mix32(baked.spec.seedInt >>> 0, i0) >>> 0, extentKm, river, veg, vegTint, riverWidthM: Math.round(riverWidthM), flowAngle }
  };
}
