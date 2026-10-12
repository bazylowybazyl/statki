// src/game/asteroidRotation.js
//
// OBRÓT I PARY skał pola (strumień D planu docs/PLAN-pas-realizm.md, etap D2, 2026-10-12).
// Moduł czysty (bez three i DOM): czyta go generator pola (asteroidBeltField.js — rekordy
// skał), render (rockLayers.js — księżyce; rockSpin.tsl.js — koziołkowanie w shaderze skał
// tła) i wydobycie (przejęcie pary skała + księżyc w fazie obrotu z zegara pasa).
//
// Prawda (decyzje użytkownika 2026-10-12: „wolniejszy obrót — tak; bączki i pary z księżycem
// — tak”):
//  • OKRES OBROTU: ciała > ~200 m nie kręcą się szybciej niż raz na ~2,2 h (bariera obrotu
//    rumowisk — szybciej rozleciałyby się), małe monolity — nawet minuty; typowo 4–12 h,
//    sporo wolnych rotatorów (doby). W grze czas jest ściśnięty (na wygląd): bariera ~150 s,
//    małe monolity od ~30 s, rozrzut log-równomierny × 8, ~12% wolnych rotatorów × 3–10
//    (dawniej 18–36 s dla wszystkich — skały wirowały jak bąki).
//  • KOZIOŁKOWANIE (ruch niezasadniczy, „tumbling” — Toutatis, Apophis): oś obrotu precesuje
//    wokół wektora momentu pędu. Tylko skały TŁA (pasma RUBBLE / MID / DEEP): skały gry leżą
//    pod płaszczyzną gry i kręcą się wokół Z (fizyka płaska, wydobycie liczy fazę z zegara).
//    Shader (rockSpin.tsl.js) bierze udział i tempo precesji z ziarna skały — lustro: rockTumble.
//  • PARY Z KSIĘŻYCEM: ~15% NEA > 200 m, w pasie głównym mniej (kilka %). Księżyc 0,15–0,35
//    promienia, orbita 2,6–4,5 promienia (Didymos–Dimorphos: 0,2 i ~3), okres z Keplera przy
//    stałej gęstości ∝ (a / r)^1,5 (Didymos 11,9 h ↔ ~140 s gry), księżyc w obrocie
//    synchronicznym (zawsze tą samą stroną do skały). W paśmie gry orbita leży poziomo na
//    głębokości środka skały — księżyc mniejszy, więc nie wystaje nad z = 0.

import { pickShape } from './asteroidRockKinds.js';

/** Okresy obrotu [s czasu gry]. */
export const SPIN_CONFIG = Object.freeze({
  // Najkrótszy okres: małe monolity (d ≤ dSmall) i rumowiska (d ≥ dLarge — „bariera obrotu”),
  // między nimi przejście w skali log; olbrzymy jeszcze wolniej × (d / dLarge)^giantExp.
  periodSmall: 30,
  periodLarge: 150,
  dSmall: 200,
  dLarge: 450,
  giantExp: 0.3,
  // Rozrzut: okres = najkrótszy × spread^u (log-równomiernie); część wolnych rotatorów × slowMul.
  spread: 8,
  slowShare: 0.12,
  slowMul: Object.freeze([3, 10])
});

/** Koziołkowanie skał tła (lustro shadera rockSpin.tsl.js — zmiana tu = zmiana tam). */
export const TUMBLE_CONFIG = Object.freeze({
  // Udział skał tła, które koziołkują: fract(ziarno · 8) < share (ziarno f32 — mnożenie przez
  // potęgę dwójki jest dokładne, więc CPU i GPU klasyfikują tak samo).
  share: 0.3,
  // Tempo precesji = |tempo obrotu| × mix(rate[0], rate[1], fract(ziarno · 64)).
  rate: Object.freeze([0.35, 1.2])
});

/** Pary skała + księżyc. */
export const MOON_CONFIG = Object.freeze({
  // Udział skał z księżycem w paśmie gry (średnica pierwotnej w playD) i w tle (≥ backDMin).
  // W gęstym polu ~połowę losowań odrzuca przerwa między skałami (orbita wchodziłaby na większą
  // skałę) — wychodzi ~5% skał 300–2000 j. (w pasie głównym kilka procent; NEA ~15%).
  playShare: 0.1,
  backShare: 0.05,
  playD: Object.freeze([300, 2000]),
  backDMin: 100,
  // Promień księżyca / promień skały, promień orbity / promień skały.
  sizeRatio: Object.freeze([0.15, 0.35]),
  distRatio: Object.freeze([2.6, 4.5]),
  // Okres orbity [s gry] = periodK · (a / r)^1,5.
  periodK: 28,
  // Tło: nachylenie płaszczyzny orbity do płaszczyzny gry [rad] (gra — 0).
  maxIncl: 0.6,
  // Id księżyca = idOffset + id skały (id skał pola < 2^42 — rozłączne przestrzenie).
  idOffset: 2 ** 52
});

const TAU = Math.PI * 2;

function smooth01(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Najkrótszy okres obrotu [s] skały o średnicy d. */
export function minSpinPeriod(d, cfg = SPIN_CONFIG) {
  const t = smooth01(Math.log(Math.max(1, d) / cfg.dSmall) / Math.log(cfg.dLarge / cfg.dSmall));
  const p = Math.exp(Math.log(cfg.periodSmall) + (Math.log(cfg.periodLarge) - Math.log(cfg.periodSmall)) * t);
  return d > cfg.dLarge ? p * Math.pow(d / cfg.dLarge, cfg.giantExp) : p;
}

/**
 * Tempo obrotu [rad/s] ze znakiem. u — losowanie skały (znak i wielkość), hSlow / hMul — hasze
 * 0 … 1 (wolny rotator i jego mnożnik).
 */
export function rockSpinRate(d, u, hSlow, hMul, cfg = SPIN_CONFIG) {
  const sign = u < 0.5 ? -1 : 1;
  const m = u < 0.5 ? u * 2 : (u - 0.5) * 2;
  let period = minSpinPeriod(d, cfg) * Math.pow(cfg.spread, m);
  if (hSlow < cfg.slowShare) period *= cfg.slowMul[0] + (cfg.slowMul[1] - cfg.slowMul[0]) * hMul;
  return (sign * TAU) / period;
}

/**
 * Koziołkowanie skały tła: tempo precesji [rad/s] (0 — skała obraca się wokół stałej osi).
 * Lustro shadera: ziarno w f32, udział i tempo z fract(ziarno · 8) i fract(ziarno · 64).
 */
export function rockTumble(seed, spin, cfg = TUMBLE_CONFIG) {
  const s = Math.fround(seed);
  const a = s * 8 - Math.floor(s * 8);
  if (!(a < cfg.share)) return 0;
  const b = s * 64 - Math.floor(s * 64);
  return Math.abs(spin) * (cfg.rate[0] + (cfg.rate[1] - cfg.rate[0]) * b);
}

/**
 * Kwaternion skały w czasie t (przestrzeń skał: X = x, Y = −y, Z = z), jak shader:
 * q = qPrecesja(oś L = q0 · ẑ, Ω t) · qObrót(oś, faza + ω t) · q0. tumble — z rockTumble
 * (0 — bez precesji). out = [x, y, z, w].
 */
export function rockOrientationAt(rock, t, tumble = 0, out = [0, 0, 0, 1]) {
  const ang = ((rock.phase ?? 0) + (rock.spin ?? 0) * t) * 0.5;
  const s = Math.sin(ang), c = Math.cos(ang);
  const ax = rock.ax ?? 0, ay = rock.ay ?? 0, az = rock.az ?? 1;
  quatMulInto(ax * s, ay * s, az * s, c, rock.qx ?? 0, rock.qy ?? 0, rock.qz ?? 0, rock.qw ?? 1, out);
  if (tumble > 0) {
    // L = q0 · ẑ (oś z układu bazowego skały w przestrzeni skał).
    const qx = rock.qx ?? 0, qy = rock.qy ?? 0, qz = rock.qz ?? 0, qw = rock.qw ?? 1;
    const lx = 2 * (qx * qz + qw * qy), ly = 2 * (qy * qz - qw * qx), lz = 1 - 2 * (qx * qx + qy * qy);
    const pa = tumble * t * 0.5;
    const ps = Math.sin(pa), pc = Math.cos(pa);
    quatMulInto(lx * ps, ly * ps, lz * ps, pc, out[0], out[1], out[2], out[3], out);
  }
  return out;
}

function quatMulInto(ax, ay, az, aw, bx, by, bz, bw, out) {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/**
 * Księżyc skały (albo null). h — sześć haszy 0 … 1 skały (decyzja, rozmiar, orbita, faza,
 * orientacja, kształt), isPlay — pasmo gry (orbita pozioma). Rekord księżyca ma pola skały
 * pola potrzebne do renderu i wydobycia (r, d, shape, type, seed, q*, s*) i orbity: dist,
 * w (tempo kątowe, rad/s — też tempo obrotu: obrót synchroniczny), phase, normal (nx, ny, nz)
 * i baza płaszczyzny (e1, e2) w przestrzeni skał (Y = −y świata).
 */
export function rockMoonFor(rock, isPlay, h, cfg = MOON_CONFIG) {
  const d = rock.d;
  if (isPlay) {
    if (d < cfg.playD[0] || d > cfg.playD[1] || !(h[0] < cfg.playShare)) return null;
  } else if (d < cfg.backDMin || !(h[0] < cfg.backShare)) return null;
  const r = rock.r * (cfg.sizeRatio[0] + (cfg.sizeRatio[1] - cfg.sizeRatio[0]) * h[1]);
  const ratio = cfg.distRatio[0] + (cfg.distRatio[1] - cfg.distRatio[0]) * h[2];
  const dist = rock.r * ratio;
  const period = cfg.periodK * Math.pow(ratio, 1.5);
  const w = ((h[3] < 0.5 ? -1 : 1) * TAU) / period;
  // Płaszczyzna orbity: gra — pozioma (normalna Z); tło — nachylona o ≤ maxIncl.
  let nx = 0, ny = 0, nz = 1;
  if (!isPlay) {
    const incl = cfg.maxIncl * h[4];
    const az = TAU * ((h[4] * 7919) % 1);
    nx = Math.sin(incl) * Math.cos(az); ny = Math.sin(incl) * Math.sin(az); nz = Math.cos(incl);
  }
  // Baza płaszczyzny: e1 ⟂ n, e2 = n × e1.
  let e1x = 1, e1y = 0, e1z = 0;
  if (Math.abs(nx) > 0.9) { e1x = 0; e1y = 1; }
  const dp = e1x * nx + e1y * ny + e1z * nz;
  e1x -= nx * dp; e1y -= ny * dp; e1z -= nz * dp;
  const el = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1;
  e1x /= el; e1y /= el; e1z /= el;
  const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
  // Orientacja bazowa: równomierny kwaternion (Shoemake) z dwóch haszy.
  const q0 = h[4], q1 = (h[4] * 104729) % 1, q2 = h[5];
  const sq1 = Math.sqrt(1 - q0), sq2 = Math.sqrt(q0);
  const dm = 2 * r;
  return {
    id: cfg.idOffset + rock.id,
    r, d: dm, dist, w, phase: TAU * h[3],
    nx, ny, nz, e1x, e1y, e1z, e2x, e2y, e2z,
    shape: pickShape(rock.type, dm, (h[5] * 7919) % 1, (h[5] * 104729) % 1),
    type: rock.type,
    seed: (h[1] * 15485863) % 1,
    qx: sq1 * Math.sin(TAU * q1), qy: sq1 * Math.cos(TAU * q1), qz: sq2 * Math.sin(TAU * q2), qw: sq2 * Math.cos(TAU * q2),
    sx: 0.85 + 0.3 * h[2], sy: 0.85 + 0.3 * ((h[2] * 7919) % 1), sz: 0.78 + 0.3 * ((h[2] * 104729) % 1)
  };
}

/** Zasięg układu (skała + orbita księżyca) — do przerw między skałami gry. */
export function rockSystemReach(rock) {
  return rock.moon ? Math.max(rock.r, rock.moon.dist + rock.moon.r) : rock.r;
}

/**
 * Stan księżyca w czasie t: pozycja w świecie gry (x, y) i przesunięcie w przestrzeni skał
 * od środka skały (ox, oy, oz; Y = −y), kąt orbity theta. out — obiekt wielokrotnego użytku.
 */
export function moonStateAt(rock, t, out = { x: 0, y: 0, ox: 0, oy: 0, oz: 0, theta: 0 }) {
  const m = rock.moon;
  const th = m.phase + m.w * t;
  const c = Math.cos(th) * m.dist, s = Math.sin(th) * m.dist;
  out.ox = m.e1x * c + m.e2x * s;
  out.oy = m.e1y * c + m.e2y * s;
  out.oz = m.e1z * c + m.e2z * s;
  out.x = rock.x + out.ox;
  out.y = rock.y - out.oy;
  out.theta = th;
  return out;
}

/**
 * Rekord skały pola dla KSIĘŻYCA w czasie t (do wydobycia: AsteroidMining.activate liczy z niego
 * orientację tak jak shader — oś obrotu = normalna orbity, tempo = tempo orbity, faza = faza
 * orbity: obrót synchroniczny). out — nowy obiekt (przejęcie skały to rzadka operacja).
 */
export function moonRockRecord(rock, t) {
  const m = rock.moon;
  const st = moonStateAt(rock, t);
  return {
    id: m.id, x: st.x, y: st.y, r: m.r, d: m.d, shape: m.shape, type: m.type, seed: m.seed,
    qx: m.qx, qy: m.qy, qz: m.qz, qw: m.qw, ax: m.nx, ay: m.ny, az: m.nz, spin: m.w, phase: m.phase,
    sx: m.sx, sy: m.sy, sz: m.sz, moonOf: rock.id, oz: st.oz
  };
}
