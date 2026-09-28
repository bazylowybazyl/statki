// dema/warp-webgpu/arrivals.js
//
// Przylot i odlot okrętu NPC przez TUNEL — widok z zewnątrz (wezwania floty,
// zasadzki, NPC). User 2026-09-27: puste bańki lecące po kadrze i nagle
// wyskakujące okręty „źle wyglądają”; ma być prosta linia (smuga) i tunel,
// z którego WYPADA statek — jak w propozycji 1. Oś czasu i geometria
// z src/game/warpDrive.js (createWarpArrival / sampleWarpArrival — te same
// czasy, skalowane długością kadłuba), wygląd w języku „Nurtu”:
//   ZWIASTUN  — prosta nić wzbudzonego ośrodka od krawędzi kadru do punktu
//               wyjścia, ośrodek zbierany w punkt (lekki wir), mały rdzeń;
//               pod koniec punkt wydłuża się w kreskę;
//   ROZDARCIE — szczelina otwiera się wzdłuż kursu (rift.js): jasne cienkie
//               brzegi, w środku przestrzeń warpa (strugi), ośrodek się
//               rozsuwa, tło wciągane w szczelinę;
//   WYRZUT    — okręt wypada z szczeliny z prędkością i wytraca ją; kadłub
//               odsłania się od dziobu, za nim smuga sylwetki, błysk
//               w ujściu, iskry ośrodka pchnięte przed dziób, przezroczysta
//               fala, wstrząs, biały żar brzegu;
//   ZAMKNIĘCIE — szczelina zasklepia się od dziobu ku rufie; żar stygnie.
// Odlot = to samo wspak: punkt skoku przed dziobem, szczelina, okręt
// przyspiesza i znika w niej od dziobu, szczelina się zamyka.

import { createWarpArrival, sampleWarpArrival, warpSizeScale } from '../../src/game/warpDrive.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut3 = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const HERALD_REACH = 60000;

function newSlot() {
  return {
    on: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, R: 500, asp: 1.35, A: 0, front: 3, strain: 0, turb: 0,
    pullR: 1, pullGain: 0, release: false, releaseT: Infinity, rearT: Infinity, jetSpeed: 0,
    heraldLen: 0, heraldGain: 0, excite: 1, lensAmp: 0
  };
}

/**
 * Przylot okrętu `ship` (stan statku sceny) do (x, y) z kursem `angle`.
 * t0 — start zwiastuna, heraldExtra — dłuższy zwiastun (kolejność floty).
 */
export function planArrival({ ship, x, y, angle, t0 = 0, heraldExtra = 0, pirate = false }) {
  const type = ship.inst.type;
  const a = createWarpArrival({ x, y, angle, hullLength: type.length, hullWidth: type.h, startTime: t0, heraldExtra });
  const L = type.length;
  // Szew i ujście jak w warpFx3D: szew za pozycją końcową, ujście przy dziobie w chwili wyrzutu.
  const back = a.emergeDist + L * 0.1;
  a.sx = x - a.dirX * back;
  a.sy = y - a.dirY * back;
  const mouth = L * 0.5 - a.emergeDist;
  a.mx = x + a.dirX * mouth;
  a.my = y + a.dirY * mouth;
  a.ship = ship;
  a.pirate = pirate;
  a.sample = {};
  // Przegródki ośrodka — NIE `a.herald` (to czas zwiastuna z createWarpArrival).
  a.heraldSlot = newSlot();
  a.pushSlot = newSlot();
  a.pushSlot.releaseT = a.tBurst + 0.02;
  a.seed = (x * 0.013 + y * 0.007) % 100;
  return a;
}

/**
 * Stan przylotu w chwili t → statek (widoczność, położenie, odsłanianie,
 * żar, smuga, plazma), przegródki ośrodka, szczeliny, blaski, fale.
 * Zwraca wstrząs (0..1). F: stan klatki sceny (bubbles, seams, rifts, flashes, waves).
 */
export function arrivalState(a, t, F) {
  const s = sampleWarpArrival(a, t, a.sample);
  const ship = a.ship;
  const type = ship.inst.type;
  const L = type.length;
  const pal = type.palette;
  ship.angle = a.angle;
  ship.vx = 0;
  ship.vy = 0;
  ship.thrust = 0.2;
  ship.plasma = 0;
  ship.seam = 0;
  ship.smear = 0;
  ship.heat = 0;
  ship.revealMode = 0;
  const off = Number(s.shipOffset) || 0;
  ship.x = a.x + a.dirX * off;
  ship.y = a.y + a.dirY * off;
  ship.visible = s.shipVisible === true || s.phase === 'cool' || s.phase === 'done';
  if (s.phase === 'wait') { ship.visible = false; return 0; }
  const size = a.sizeScale;

  // --- zwiastun: nić do punktu wyjścia i punkt zbierania ---
  if (s.herald > 0.002) {
    const h = a.heraldSlot;
    h.on = true;
    h.x = a.sx - a.dirX * HERALD_REACH;
    h.y = a.sy - a.dirY * HERALD_REACH;
    h.angle = a.angle;
    h.R = L * 0.6;
    h.heraldLen = HERALD_REACH;
    h.heraldGain = s.herald * (a.pirate ? 1.2 : 1.0);
    h.pullR = L * 0.45;
    h.pullGain = s.herald;
    h.excite = 1;
    F.bubbles.push(h);
    const pulse = 0.85 + 0.15 * Math.sin(t * 17 + a.seed);
    // Punkt gaśnie, gdy otwiera się szczelina (jej brzegi przejmują światło).
    const k = (0.4 + 1.4 * s.herald * s.herald) * pulse * (1 - 0.8 * Math.min(1, s.seamOpen));
    F.flashes.push({ x: a.sx, y: a.sy, size: L * (0.08 + 0.12 * s.herald), k, pal, raw: true });
  }

  // --- szczelina (po zamknięciu gaśnie — bez kreski wiszącej przez stygnięcie) ---
  const riftK = 1 - s.closeT * s.closeT;
  if (s.seamLen > 0.002 && riftK > 0.01) {
    const halfLen = a.seamLength * 0.5 * s.seamLen;
    const open = Math.max(s.seamOpen, s.phase === 'herald' ? 0.06 : 0);
    const halfWidth = a.seamHalfWidth * open;
    F.rifts.push({
      x: a.sx, y: a.sy, angle: a.angle, halfLen, halfWidth, k: riftK,
      core: pal.core, body: pal.body, dirty: a.pirate ? 1 : 0, seed: a.seed, fill: Math.min(1, open * 1.4)
    });
    if (open > 0.01) {
      F.seams.push({ x: a.sx, y: a.sy, angle: a.angle, halfLen, halfWidth: Math.max(halfWidth, L * 0.02), push: 900 * Math.min(1, open) * size, flow: 2600 * size });
      F.seamLens.push({ x: a.sx, y: a.sy, angle: a.angle, halfLen: halfLen * 1.05, band: a.seamHalfWidth * 3.5, amp: 14 * Math.min(1, open) });
    }
  }

  // --- wyrzut ---
  const after = t - a.tBurst;
  if (after >= 0) {
    // Odsłonięcie od dziobu (krótko) + szew na linii frontu.
    const rv = clamp01(after / (0.09 + 0.06 * size));
    ship.revealMode = 1;
    ship.revealLine = L * 0.56 - L * 1.12 * easeOut3(rv);
    ship.seamLine = ship.revealLine;
    ship.seam = rv < 1 ? 1 : 0;
    ship.smear = s.smear;
    ship.smearLen = 1 + Math.min(2.5, (s.shipSpeed * 0.14) / L + 0.45 * s.smear);
    ship.plasma = Math.exp(-after / 0.5) * 0.9;
    ship.heat = 0.85 * Math.exp(-after / 2.4);
    // Iskry ośrodka pchnięte przed dziób (jednorazowo w chwili wyrzutu).
    const p = a.pushSlot;
    p.on = after < 0.5;
    p.x = ship.x;
    p.y = ship.y;
    p.angle = a.angle;
    p.R = L * 0.62;
    p.asp = 1.35;
    p.jetSpeed = 5200 * size;
    p.excite = 1;
    if (p.on) F.bubbles.push(p);
    if (s.flash > 0.004) {
      F.flashes.push({ x: a.mx, y: a.my, size: L * 0.5, k: s.flash * 1.6, pal, raw: false });
      F.glares.push({ x: a.mx, y: a.my, angle: a.angle + Math.PI * 0.5, len: L * 1.4, k: s.flash, pal });
    }
    if (s.ringT >= 0 && s.ringT < 1) {
      const fade = (1 - s.ringT) * (1 - s.ringT);
      F.waves.push({ x: a.mx, y: a.my, rFixed: L * (0.2 + 2.6 * easeOut3(s.ringT)), width: L * 0.2, amp: 9 * fade * Math.min(1.2, size * 1.2), dur: 0 });
    }
  }
  return s.shake * (0.4 + 0.8 * size);
}

/**
 * Odlot przez tunel: ładowanie (punkt skoku przed dziobem), szczelina,
 * okręt wchodzi w nią od dziobu, szczelina się zamyka.
 */
export function planDeparture({ ship, x, y, angle, t0 = 0, pirate = false }) {
  const type = ship.inst.type;
  const L = type.length;
  const s = warpSizeScale(L);
  const charge = 1.6 + 0.8 * s;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const seamLength = L * 1.4;
  const d = {
    ship, x, y, angle, dirX: dir.x, dirY: dir.y, L, size: s, pirate, t0, charge,
    tSplit: t0 + charge - 0.45,
    tDive: t0 + charge,
    dive: 0.34 + 0.12 * s,
    close: 0.45,
    seamLength,
    seamHalfWidth: seamLength * 0.075,
    // Szczelina przed dziobem; jej tylny koniec = ujście (dziób w chwili startu).
    cx: x + dir.x * (L * 0.5 + seamLength * 0.5),
    cy: y + dir.y * (L * 0.5 + seamLength * 0.5),
    mouth: L * 0.5,
    heraldSlot: newSlot(),
    seed: (x * 0.011 + y * 0.017) % 100
  };
  d.tGone = d.tDive + d.dive;
  d.tEnd = d.tGone + d.close + 0.2;
  return d;
}

export function departureState(d, t, F) {
  const ship = d.ship;
  const pal = ship.inst.type.palette;
  const L = d.L;
  if (t < d.t0) return 0;
  const u = clamp01((t - d.t0) / d.charge);
  const build = u * u * (3 - 2 * u);
  ship.angle = d.angle;
  ship.thrust = 0.2;
  ship.plasma = Math.min(1, 0.3 + 0.7 * build);
  ship.seam = 0;
  ship.smear = 0;
  ship.revealMode = 0;
  ship.heat = 0.25 * build * build;
  // Punkt skoku przed dziobem: ośrodek zbierany, rdzeń jaśnieje.
  if (t < d.tGone) {
    const h = d.heraldSlot;
    h.on = true;
    h.x = d.cx;
    h.y = d.cy;
    h.angle = d.angle;
    h.R = L * 0.6;
    h.heraldLen = 0.5;
    h.heraldGain = 0;
    h.pullR = L * (0.35 + 0.25 * build);
    h.pullGain = build;
    h.excite = 1;
    F.bubbles.push(h);
    const pulse = 0.85 + 0.15 * Math.sin(t * (8 + 22 * u) + d.seed);
    F.flashes.push({ x: d.cx, y: d.cy, size: L * (0.08 + 0.18 * build), k: (0.35 + 1.6 * build * build) * pulse, pal, raw: true });
  }
  // Szczelina: otwiera się pod koniec ładowania, zamyka po wejściu okrętu.
  let open = 0;
  let len = 0;
  if (t >= d.tSplit) {
    const o = clamp01((t - d.tSplit) / 0.45);
    open = 0.08 + 0.92 * easeOut3(o);
    len = 0.25 + 0.75 * easeOut3(o);
  }
  if (t >= d.tGone) {
    const c = clamp01((t - d.tGone) / d.close);
    open *= 1 - c * c * c;
    len *= 1 - 0.55 * c;
  }
  if (len > 0.002 && open > 0.001) {
    const halfLen = d.seamLength * 0.5 * len;
    const halfWidth = d.seamHalfWidth * open;
    F.rifts.push({ x: d.cx, y: d.cy, angle: d.angle, halfLen, halfWidth, k: 1, core: pal.core, body: pal.body, dirty: d.pirate ? 1 : 0, seed: d.seed, fill: Math.min(1, open * 1.4) });
    F.seams.push({ x: d.cx, y: d.cy, angle: d.angle, halfLen, halfWidth: Math.max(halfWidth, L * 0.02), push: 900 * open * d.size, flow: 2600 * d.size });
    F.seamLens.push({ x: d.cx, y: d.cy, angle: d.angle, halfLen: halfLen * 1.05, band: d.seamHalfWidth * 3.5, amp: 14 * open });
  }
  // Wejście w szczelinę: przyspieszenie, kadłub znika od dziobu za ujściem.
  let dist = 0;
  if (t >= d.tDive) {
    const w = clamp01((t - d.tDive) / d.dive);
    dist = L * 2.6 * w * w;
    const speed = L * 5.2 * w / d.dive;
    ship.smear = Math.max(0, 1 - w * 0.4) * (t < d.tGone + 0.12 ? 1 : 0);
    ship.smearLen = 1 + Math.min(2.2, speed * 0.1 / L);
    ship.heat = Math.max(ship.heat, 0.6 * (1 - w));
    if (t - d.tDive < 0.2) {
      const k = 1 - (t - d.tDive) / 0.2;
      F.flashes.push({ x: d.x + d.dirX * d.mouth, y: d.y + d.dirY * d.mouth, size: L * 0.45, k: k * k * 1.4, pal, raw: false });
    }
    if (t - d.tDive < 1.1) {
      const age = t - d.tDive;
      F.waves.push({ x: d.x + d.dirX * d.mouth, y: d.y + d.dirY * d.mouth, rFixed: L * (0.2 + 2.2 * easeOut3(age / 1.1)), width: L * 0.18, amp: 7 * (1 - age / 1.1) ** 2, dur: 0 });
    }
  }
  ship.x = d.x + d.dirX * dist;
  ship.y = d.y + d.dirY * dist;
  // Linia ujścia w układzie kadłuba: widać tylko część za nią (x < linia).
  const line = d.mouth - dist;
  if (t >= d.tDive) {
    ship.revealMode = -1;
    ship.revealLine = line;
    ship.seamLine = line;
    ship.seam = line > -L * 0.55 && line < L * 0.55 ? 1 : 0;
  }
  ship.visible = t < d.tDive || line > -L * 0.55;
  return t >= d.tDive && t < d.tDive + 0.4 ? (1 - (t - d.tDive) / 0.4) * (0.3 + 0.5 * d.size) : 0;
}
