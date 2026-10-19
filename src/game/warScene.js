// src/game/warScene.js — scena deweloperska „Wojna” (DevScene.wojna w index.html, 2026-10-19).
//
// User (2026-10-19): „przykładowa scena — wojna — dużo statków jak battle over Coruscant: wychodzą z warpa jednostki
// i naprzeciwko nich po chwili też wychodzą z warpa jednostki, obydwa się o siebie rozbijają; potrzeba prędkości
// wyjścia z warpa i lecenia à la Star Wars, a nie stania pasywnego”.
//
// Choreografia (czas gry od startu sceny):
//   0 s     — flota A (Terra Nova, ~20: superkapitał-flagowiec, lotniskowce, pancerniki, niszczyciele, fregaty) zapowiada
//             się zwiastunami; wyjście z warpa FALAMI klas (najmniejsze pierwsze, flagowiec ostatni —
//             planWarpFleetArrival z `waveGap`), w KLINIE, z pędem (warpExitMomentum: k × prędkość bojowa, ślizg);
//   gapB s  — flota B (piraci, ~25) ~25 km naprzeciw, dziobami na A, tak samo;
//   potem   — obie strony w postawie NATARCIA (fleetAwareness.setFleetStanceOverride: marsz bez stania, w walce przeloty
//             burtą w burtę i nawroty — capitalAI.js `chargeRun`), myśliwce z lotniskowców, przenikanie linii.
// Punkty przylotu to KOŃCE ślizgu; kursy przylotu: A od strony swojego tyłu, B od swojego (start tunelu daleko za flotą).
// Ten moduł jest czysty (bez DOM, three i gry): skład flot, klin, plan fal. Wezwania (callInSupport → warpTraffic),
// kamerę (reżyser kadru — sygnały obu flot), tło (tarcza planety) i Atlasa stawia klej w index.html.

import { planWarpFleetArrival } from './warpDrive.js';

export const WAR_SCENE_DEFAULTS = Object.freeze({
  countA: 20,            // okrętów floty A (Terra Nova)
  countB: 25,            // okrętów floty B (piraci)
  k: 3,                  // prędkość wyjścia z warpa × maxSpeed klasy (WARP_EXIT_MOMENTUM.k; 0 — dawne zatrzymanie)
  distance: 25000,       // [j.] odległość wierzchołków klinów (punkty przylotu — końce ślizgu)
  gapB: 6,               // [s] start zwiastunów floty B po starcie zwiastunów floty A
  heraldStyle: 'thread', // zwiastun: 'thread' (nić), 'ripple' (drganie przestrzeni), 'none'
  backdrop: 'jupiter',   // tarcza planety w tle: 'jupiter' | 'mars' (bitwa nad tarczą, wewnątrz płyty ringu)
  overPlanet: 0.35,      // środek bitwy od środka tarczy × jej promień (po stronie słońca — przylot A nad dzienną półkulą)
  atlas: 'side',         // Atlas gracza: 'side' — widz z boku, 'fleet' — w szyku floty A
  sideOffset: 8000,      // [j.] widz z boku: odległość od osi bitwy (dalej od środka planety)
  viewWidth: 24000,      // [j.] kadr gracza (reżyser kadru oddala go do sygnału: przylot A, przylot B, bitwa)
  gap: 0.12,             // [s] między wyjściami okrętów jednej fali
  waveGap: 0.55,         // [s] dodatkowa przerwa przed falą większej klasy
  flagshipPause: 0.6,    // [s] kulminacja: flagowiec wychodzi ostatni
  jitter: 0.25,          // [s] rozrzut startu zwiastunów
  seed: 1
});

// Skład domyślny (klucze wezwań: SUPPORT_SHIP_TEMPLATES / CAPITAL_SHIP_TEMPLATES, tryb wezwania).
export const WAR_SCENE_ROSTER = Object.freeze({
  A: Object.freeze({
    mode: 'friendly',
    flagship: 'supercapital',
    classes: Object.freeze([['carrier', 2], ['battleship', 3], ['destroyer', 5], ['frigate_pd', 9]])
  }),
  B: Object.freeze({
    mode: 'pirate',
    flagship: 'pirate_supercapital',
    classes: Object.freeze([['battleship', 4], ['destroyer', 7], ['frigate_pd', 13]])
  })
});

/**
 * Skład floty `side` ('A' | 'B') na `count` okrętów: flagowiec + klasy w proporcjach składu domyślnego (reszta
 * zaokrągleń — fregaty). Zwraca listę kluczy wezwań (flagowiec pierwszy).
 */
export function warSceneRoster(side, count) {
  const R = WAR_SCENE_ROSTER[side];
  if (!R) return [];
  const n = Math.max(1, Math.round(Number(count) || 1));
  const keys = [R.flagship];
  if (n === 1) return keys;
  const base = R.classes.reduce((s, c) => s + c[1], 0);
  const want = R.classes.map(([key, c]) => [key, Math.floor((c * (n - 1)) / base)]);
  let left = n - 1 - want.reduce((s, c) => s + c[1], 0);
  // reszta: od najmniejszej klasy (koniec listy) w górę
  for (let i = want.length - 1; left > 0; i = (i - 1 + want.length) % want.length) { want[i][1]++; left--; }
  for (const [key, c] of want) for (let i = 0; i < c; i++) keys.push(key);
  return keys;
}

/**
 * KLIN: miejsca w układzie floty (fwd — w stronę wroga, lat — w bok; j.) dla okrętów o długościach `ships[i].length`.
 * Wierzchołek — flagowiec (najdłuższy); ramiona do tyłu pod kątem `halfAngle` od osi: najpierw cięższe, potem
 * lżejsze, na zmianę lewe i prawe; lotniskowce (`carrier: true`) na osi za flagowcem. Odstęp kolejnych miejsc na
 * ramieniu = pół długości obu + `pad` (kadłuby z boku na siebie nie wchodzą: ramię idzie skosem). Zwraca tablicę
 * { fwd, lat } w kolejności `ships`.
 */
export function layoutWarWedge(ships, o = {}) {
  const halfAngle = Number.isFinite(o.halfAngle) ? o.halfAngle : 0.62;
  const pad = Number.isFinite(o.pad) ? o.pad : 650;
  const out = ships.map(() => ({ fwd: 0, lat: 0 }));
  if (!ships.length) return out;
  const idx = ships.map((s, i) => i);
  let flag = 0;
  for (let i = 1; i < ships.length; i++) if ((ships[i].length || 0) > (ships[flag].length || 0)) flag = i;
  const carriers = idx.filter((i) => i !== flag && ships[i].carrier);
  const rest = idx.filter((i) => i !== flag && !ships[i].carrier)
    .sort((a, b) => ((ships[b].length || 0) - (ships[a].length || 0)) || (a - b));
  const fl = ships[flag].length || 0;
  // lotniskowce na osi za flagowcem
  let back = fl * 0.5;
  for (const i of carriers) {
    const L = ships[i].length || 0;
    back += pad + L * 0.5 + (ships[i].width || L * 0.45) * 0.5;
    out[i].fwd = -back;
    out[i].lat = 0;
    back += L * 0.5;
  }
  // ramiona
  const ax = -Math.cos(halfAngle);
  const ay = Math.sin(halfAngle);
  const reach = [fl * 0.5, fl * 0.5];
  const prevLen = [fl, fl];
  for (let k = 0; k < rest.length; k++) {
    const i = rest[k];
    const arm = k % 2;
    const L = ships[i].length || 0;
    const W = ships[i].width || L * 0.45;
    // krok po ramieniu: pół długości poprzedniego i tego + pad; boczny odstęp (krok · sin) mieści też szerokość
    let step = (prevLen[arm] + L) * 0.5 + pad;
    step = Math.max(step, (W + pad) / Math.max(0.2, ay));
    reach[arm] += step;
    out[i].fwd = ax * reach[arm];
    out[i].lat = (arm === 0 ? -1 : 1) * ay * reach[arm];
    prevLen[arm] = L;
  }
  return out;
}

/** Losowanie z ziarnem (mulberry32) — powtarzalne rozrzuty sceny bez ruszania Math.random gry. */
export function warSceneRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan sceny. o — opcje (WAR_SCENE_DEFAULTS), center {x, y} — środek bitwy, axis — kąt osi A → B (świat gry),
 * hull(key, mode) → { length, width } | null — wymiary kadłuba wezwania (index.html: estimateCallInHull).
 * Zwraca { center, axis, dir: {x, y}, perp: {x, y}, fleets: { A, B } }; flota: { side, mode, apex {x, y}, heading,
 * origin {x, y} (start tunelu daleko za flotą), start [s od startu sceny], ships: [{ key, mode, x, y, length, width,
 * delay (start zwiastuna od startu floty), heraldExtra, burst (wyjście od startu floty), flagship, carrier }] }.
 */
export function planWarScene(opts = {}, center = { x: 0, y: 0 }, axis = 0, hull = null) {
  const o = { ...WAR_SCENE_DEFAULTS, ...opts };
  const dir = { x: Math.cos(axis), y: Math.sin(axis) };
  const perp = { x: -dir.y, y: dir.x };
  const rng = warSceneRng(o.seed);
  const fleets = {};
  for (const side of ['A', 'B']) {
    const R = WAR_SCENE_ROSTER[side];
    const keys = warSceneRoster(side, side === 'A' ? o.countA : o.countB);
    const ships = keys.map((key, i) => {
      const h = typeof hull === 'function' ? hull(key, R.mode) : null;
      const length = Math.max(120, Number(h?.length) || 900);
      return { key, mode: R.mode, length, width: Math.max(60, Number(h?.width) || length * 0.45), flagship: i === 0,
        carrier: key.includes('carrier') };
    });
    const sgn = side === 'A' ? -1 : 1;
    // wierzchołek klina — pół odległości od środka, dziób w stronę drugiej floty
    const apex = { x: center.x + dir.x * sgn * o.distance * 0.5, y: center.y + dir.y * sgn * o.distance * 0.5 };
    const fx = -sgn * dir.x;
    const fy = -sgn * dir.y;
    const lx = -fy;
    const ly = fx;
    const slots = layoutWarWedge(ships, side === 'A' ? { halfAngle: 0.62 } : { halfAngle: 0.95, pad: 550 });
    for (let i = 0; i < ships.length; i++) {
      ships[i].x = apex.x + fx * slots[i].fwd + lx * slots[i].lat;
      ships[i].y = apex.y + fy * slots[i].fwd + ly * slots[i].lat;
    }
    const plan = planWarpFleetArrival(ships.map((s) => ({ hullLength: s.length })), {
      startTime: 0, gap: o.gap, waveGap: o.waveGap, flagshipPause: o.flagshipPause, jitter: o.jitter, rng
    });
    for (const p of plan) {
      const s = ships[p.index];
      s.delay = p.startTime;
      s.heraldExtra = p.heraldExtra;
      s.burst = p.burstTime;
    }
    fleets[side] = {
      side, mode: R.mode, apex, heading: Math.atan2(fy, fx),
      // start tunelu daleko za flotą (nić zwiastuna pełnej długości, kurs ≈ oś bitwy)
      origin: { x: apex.x - fx * 400000, y: apex.y - fy * 400000 },
      start: side === 'A' ? 0 : o.gapB,
      ships
    };
  }
  return { opts: o, center: { x: center.x, y: center.y }, axis, dir, perp, fleets };
}
