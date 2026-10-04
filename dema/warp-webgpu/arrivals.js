// dema/warp-webgpu/arrivals.js
//
// Przylot i odlot okrętu NPC — widok z zewnątrz (wezwania floty, zasadzki, NPC).
// User 2026-10-03: „jak w Star Wars” — okręt wpada z dużą prędkością i nagle
// gwałtownie hamuje; BEZ portalu (dawna szczelina / tunel usunięte — po wyjściu
// z niej okręt jeszcze kawałek leciał) i BEZ smugi („normalnie widoczny statek”).
//   ZWIASTUN — prosta nić wzbudzonego ośrodka wzdłuż kursu do miejsca
//              zatrzymania, ośrodek zbierany w punkt (lekki wir), mały rdzeń;
//   WLOT     — okręt pojawia się daleko za celem (zwykle za brzegiem kadru),
//              leci prosto z pełną prędkością (bańka rozpycha ośrodek: turkus
//              przed dziobem, warkocz za rufą);
//   HAMOWANIE — w chwili dawnego wyrzutu (oś zwiastuna z gry) stałe opóźnienie
//              na RUSH.brakeDist długości: błysk na dziobie, fala, wstrząs, żar,
//              bańka zapada się od dziobu, ośrodek przed dziobem leci dalej
//              siłą bezwładności (iskry); okręt staje na punkcie zwiastuna.
//   ODLOT    — po ładowaniu (punkt skoku przed dziobem) KOP od rufy (błysk, fala,
//              wstrząs), okręt przyspiesza (droga ∝ t³) przez RUSH.departDist
//              długości i znika od dziobu w punkcie skoku (błysk, fala).
// Oś zwiastuna i chwila wyrzutu (= początek hamowania) — z gry (warpDrive.js);
// droga okrętu — tutaj.

import { createWarpArrival, sampleWarpArrival, warpSizeScale } from '../../src/game/warpDrive.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut3 = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const HERALD_REACH = 60000;

/** Rozpęd przylotu i odlotu (długości kadłuba, sekundy; + perSize × skala rozmiaru). */
export const RUSH = Object.freeze({
  // PRZYLOT bez szczeliny (user 2026-10-03: „jak w Star Wars” — wpada z dużą
  // prędkością i gwałtownie hamuje; portal niepotrzebny; „nie smuga, tylko
  // normalnie widoczny statek”): okręt wlatuje z daleka (za brzegiem kadru),
  // widoczny cały czas, i hamuje na ostatnich `brakeDist` długościach.
  arriveDist: 4,       // (scena) minimalna droga od pojawienia się do zatrzymania [L]
  arriveMin: 9000,     // ... i nie mniej niż tyle j.
  arriveCoast: 0.7,    // ... i nie krócej niż tyle s lotu z pełną prędkością (z daleka)
  arriveSpeed: 9,      // prędkość wlotu [L/s] — szybko, ale kadłub czytelny
  arriveSpeedMin: 12000,
  arriveSpeedMax: 30000,
  brakeDist: 0.9,      // droga hamowania [L] — krótka: „gwałtownie hamuje”
  departDist: 4,       // rozpęd od miejsca startu do punktu zniknięcia
  accel: 0.5,          // czas rozpędu
  accelPerSize: 0.18
});
const smoothK = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };

/** Prędkość wlotu przed hamowaniem [j/s] dla kadłuba długości L (przylot NPC i wyjście Atlasa z warpa). */
export function arrivalSpeed(L) {
  return Math.min(RUSH.arriveSpeedMax, Math.max(RUSH.arriveSpeedMin, RUSH.arriveSpeed * L));
}

/** Czas hamowania [s] z prędkości v0 na drodze RUSH.brakeDist × L (stałe opóźnienie). */
export function brakeTime(L, v0) {
  return 2 * RUSH.brakeDist * L / v0;
}

/**
 * HAMOWANIE — wspólne dla przylotu NPC i wyjścia Atlasa z warpa (spójność:
 * ten sam błysk, blask, fala, iskry i wstrząs). tb — czas od początku
 * hamowania (< 0: jeszcze leci), brake — czas hamowania, v0 — prędkość przed
 * nim, push — przegródka ośrodka na iskry (releaseT = początek hamowania + 0,02 s),
 * (stopX, stopY) — środek kadłuba po zatrzymaniu. Ustawia plazmę, ciąg i żar
 * statku; zwraca wstrząs (0..1, bez skali rozmiaru).
 */
export function brakeEffects(F, { ship, L, pal, size, dirX, dirY, angle, tb, v0, push, stopX, stopY }) {
  ship.plasma = tb < 0 ? 1 : 0.9 * Math.exp(-tb / 0.18);
  ship.thrust = tb < 0 ? 0.6 : 0.05;
  // Żar przy hamowaniu (cała energia w kadłub).
  ship.heat = Math.max(ship.heat || 0, tb < 0 ? 0 : 0.95 * smoothK(tb / 0.06) * Math.exp(-Math.max(0, tb - 0.06) / 2.2));
  // Iskry ośrodka pchnięte przed dziób przy hamowaniu (bezwładność).
  push.on = tb > -0.05 && tb < 0.5;
  push.x = ship.x;
  push.y = ship.y;
  push.angle = angle;
  push.R = L * 0.62;
  push.asp = 1.35;
  push.jetSpeed = Math.max(5200 * size, v0 * 0.55);
  push.excite = 1;
  if (push.on) F.bubbles.push(push);
  // Błysk na dziobie, poprzeczny blask, fala, wstrząs.
  if (tb >= 0 && tb < 0.35) {
    const k = Math.pow(1 - tb / 0.35, 2);
    const bx = ship.x + dirX * L * 0.52;
    const by = ship.y + dirY * L * 0.52;
    F.flashes.push({ x: bx, y: by, size: L * 0.55, k: k * 1.8, pal, raw: false });
    F.glares.push({ x: bx, y: by, angle: angle + Math.PI * 0.5, len: L * 1.6, k: k * 1.2, pal });
  }
  if (tb >= 0 && tb < 1.3) {
    const age = tb / 1.3;
    F.waves.push({ x: stopX + dirX * L * 0.5, y: stopY + dirY * L * 0.5, rFixed: L * (0.25 + 3.2 * easeOut3(age)), width: L * 0.24, amp: 11 * (1 - age) ** 2 * Math.min(1.2, size * 1.2), dur: 0 });
  }
  return tb >= 0 ? Math.exp(-tb / 0.3) : 0;
}

/** Bańka okrętu w locie przed i w czasie hamowania: zapada się od dziobu (fc 0 → 1). */
export function brakeBubbleFront(tb, brake) {
  return tb < 0 ? 3 : (1.3 - 2.6 * clamp01(tb / Math.max(0.05, brake)));
}

function newSlot() {
  return {
    on: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, R: 500, asp: 1.35, A: 0, front: 3, strain: 0, turb: 0,
    pullR: 1, pullGain: 0, release: false, releaseT: Infinity, rearT: Infinity, jetSpeed: 0,
    heraldLen: 0, heraldGain: 0, excite: 1, lensAmp: 0
  };
}

/**
 * Przylot okrętu `ship` (stan statku sceny) do (x, y) z kursem `angle`.
 * t0 — start zwiastuna, heraldExtra — dłuższy zwiastun (kolejność floty),
 * rush — droga rozpędu po wyrzucie [× długość kadłuba] (scena dobiera do kadru).
 */
export function planArrival({ ship, x, y, angle, t0 = 0, heraldExtra = 0, pirate = false, rush = RUSH.arriveDist }) {
  const type = ship.inst.type;
  const a = createWarpArrival({ x, y, angle, hullLength: type.length, hullWidth: type.h, startTime: t0, heraldExtra });
  const L = type.length;
  const size = a.sizeScale;
  // Wlot: okręt pojawia się D za miejscem docelowym (p0 = cel − D·kurs) — daleko,
  // zwykle za brzegiem kadru — leci z v0 przez `coast`, potem hamuje ze stałym
  // opóźnieniem na drodze `brakeDist` (czas brake = 2·droga / v0). Bez szczeliny:
  // pojawienie się = odsłonięcie od dziobu w ułamku sekundy (v0 ≈ 9 L/s).
  a.v0 = arrivalSpeed(L);
  const brakeDist = L * RUSH.brakeDist;
  a.rushDist = Math.max(L * Math.max(0.6, rush), RUSH.arriveMin, brakeDist + a.v0 * RUSH.arriveCoast);
  a.brake = brakeTime(L, a.v0);
  a.coast = (a.rushDist - brakeDist) / a.v0;
  // Zwiastun i lot przed pojawieniem: start lotu tak, żeby hamowanie zaczęło się
  // tam, gdzie dawniej był wyrzut (oś zwiastuna z gry bez zmian).
  a.tBrake = a.tBurst;
  a.tAppear = a.tBrake - a.coast;
  a.tStop = a.tBrake + a.brake;
  // Punkt zwiastuna = miejsce zatrzymania.
  a.sx = x;
  a.sy = y;
  a.ship = ship;
  a.pirate = pirate;
  a.sample = {};
  // Przegródki ośrodka — NIE `a.herald` (to czas zwiastuna z createWarpArrival).
  a.heraldSlot = newSlot();
  a.bubbleSlot = newSlot();
  a.pushSlot = newSlot();
  // Iskry ośrodka lecą dalej, gdy okręt staje (bezwładność) — wyrzut przy hamowaniu.
  a.pushSlot.releaseT = a.tBrake + 0.02;
  a.seed = (x * 0.013 + y * 0.007) % 100;
  return a;
}

/**
 * Stan przylotu w chwili t → statek (widoczność, położenie, odsłanianie,
 * żar, plazma), przegródki ośrodka, blaski, fale.
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
  // Wlot: droga od p0 (cel − D) i prędkość wzdłuż kursu.
  const tau = t - a.tAppear;
  let along = 0;
  let speed = 0;
  if (tau >= 0) {
    const tb = tau - a.coast;
    if (tb < 0) { along = a.v0 * tau; speed = a.v0; }
    else if (tb < a.brake) { along = a.v0 * a.coast + a.v0 * tb - a.v0 * tb * tb / (2 * a.brake); speed = a.v0 * (1 - tb / a.brake); }
    else along = a.rushDist;
  }
  const off = along - a.rushDist;
  ship.x = a.x + a.dirX * off;
  ship.y = a.y + a.dirY * off;
  ship.vx = a.dirX * speed;
  ship.vy = a.dirY * speed;
  ship.visible = tau >= 0 && s.phase !== 'wait';
  if (s.phase === 'wait') return 0;
  const size = a.sizeScale;

  // --- zwiastun: nić wzdłuż kursu i punkt zbierania w miejscu zatrzymania ---
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
    const k = (0.4 + 1.4 * s.herald * s.herald) * pulse;
    F.flashes.push({ x: a.sx, y: a.sy, size: L * (0.08 + 0.12 * s.herald), k, pal, raw: true });
  }

  // --- wlot (kadłub widoczny normalnie, bez smugi) i gwałtowne hamowanie ---
  let brakeShake = 0;
  if (tau >= 0) {
    // Pojawienie się: odsłonięcie od dziobu na pierwszej długości kadłuba
    // (zwykle za brzegiem kadru; przy v0 ≈ 9 L/s trwa ~0,1 s).
    const line = L * 0.56 - along;
    if (line > -L * 0.56) {
      ship.revealMode = 1;
      ship.revealLine = line;
    }
    const vk = speed / a.v0;
    const tb = t - a.tBrake;
    // Bańka okrętu w locie: rozpycha ośrodek; przy hamowaniu zapada się od dziobu.
    const b = a.bubbleSlot;
    if (t < a.tStop + 0.35) {
      b.on = true;
      b.x = ship.x;
      b.y = ship.y;
      b.angle = a.angle;
      b.vx = ship.vx;
      b.vy = ship.vy;
      b.R = L * 0.62;
      b.asp = 1.35;
      b.A = (tb < 0 ? smoothK(tau / 0.08) : 1) * (t < a.tStop + 0.2 ? 1 : 0);
      b.front = brakeBubbleFront(tb, a.brake);
      b.strain = 1.1;
      b.turb = 0.13;
      b.excite = 1.4;
      b.rearT = a.tStop + 0.05;
      b.lensAmp = 18 * b.A * vk;
      F.bubbles.push(b);
    }
    brakeShake = brakeEffects(F, {
      ship, L, pal, size, dirX: a.dirX, dirY: a.dirY, angle: a.angle, tb, v0: a.v0, push: a.pushSlot, stopX: a.x, stopY: a.y
    });
  }
  return brakeShake * (0.4 + 0.8 * size);
}

/**
 * Odlot: ładowanie (punkt skoku przed dziobem), kop, rozpęd, zniknięcie
 * od dziobu w punkcie skoku.
 */
export function planDeparture({ ship, x, y, angle, t0 = 0, pirate = false, rush = RUSH.departDist }) {
  const type = ship.inst.type;
  const L = type.length;
  const s = warpSizeScale(L);
  const charge = 1.6 + 0.8 * s;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  // Rozpęd: droga ∝ t³ przez `accel` do punktu skoku (D przed dziobem), dalej pełną prędkością — znika w nim.
  const D = L * Math.max(0.4, rush);
  // Krótszy rozpęd = krótszy czas (∝ √drogi przy stałym „szarpnięciu” startu).
  const accel = (RUSH.accel + RUSH.accelPerSize * s) * Math.sqrt(Math.min(1.5, Math.max(0.1, rush / RUSH.departDist)));
  const vEnd = 3 * D / accel;
  const d = {
    ship, x, y, angle, dirX: dir.x, dirY: dir.y, L, size: s, pirate, t0, charge,
    tDive: t0 + charge,
    accel, rushDist: D, vEnd,
    close: 0.45,          // zapas po zniknięciu (błysk, fala)
    // Punkt skoku D przed dziobem (bez szczeliny): tu okręt znika.
    cx: x + dir.x * (L * 0.5 + D),
    cy: y + dir.y * (L * 0.5 + D),
    mouth: L * 0.5 + D,
    heraldSlot: newSlot(),
    bubbleSlot: newSlot(),
    seed: (x * 0.011 + y * 0.017) % 100
  };
  // Zniknięcie: rufa za punktem skoku (droga D + 1,1 L, ostatni odcinek z vEnd).
  d.tIn = d.tDive + accel;
  d.tGone = d.tIn + (L * 1.1) / vEnd;
  d.dive = d.tGone - d.tDive;
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
  // Rozpęd i skok: kop od rufy, droga ∝ t³, kadłub znika od dziobu w punkcie skoku.
  let dist = 0;
  let speed = 0;
  let kickShake = 0;
  if (t >= d.tDive) {
    const tau = t - d.tDive;
    if (tau < d.accel) {
      const w = tau / d.accel;
      dist = d.rushDist * w * w * w;
      speed = d.vEnd * w * w;
    } else {
      dist = d.rushDist + d.vEnd * (tau - d.accel);
      speed = d.vEnd;
    }
    ship.plasma = 1;
    ship.thrust = 1;
    ship.heat = Math.max(ship.heat, 0.5 * Math.exp(-tau / 0.6));
    // Kop: błysk i fala za rufą (punkt, od którego okręt się odbił), wstrząs.
    const sx = d.x - d.dirX * L * 0.6;
    const sy = d.y - d.dirY * L * 0.6;
    if (tau < 0.3) {
      const k = Math.pow(1 - tau / 0.3, 2);
      F.flashes.push({ x: sx, y: sy, size: L * 0.55, k: k * 1.6, pal, raw: false });
    }
    if (tau < 1.2) {
      const age = tau / 1.2;
      F.waves.push({ x: sx, y: sy, rFixed: L * (0.2 + 3.0 * easeOut3(age)), width: L * 0.22, amp: 9 * (1 - age) ** 2, dur: 0 });
    }
    kickShake = Math.exp(-tau / 0.3) * (0.4 + 0.6 * d.size);
    // Skok z pełną prędkością: błysk i fala w punkcie skoku.
    const ti = t - d.tIn;
    if (ti >= 0 && ti < 0.25) {
      const k = Math.pow(1 - ti / 0.25, 2);
      F.flashes.push({ x: d.x + d.dirX * d.mouth, y: d.y + d.dirY * d.mouth, size: L * 0.5, k: k * 1.5, pal, raw: false });
    }
    if (ti >= 0 && ti < 1.1) {
      const age = ti / 1.1;
      F.waves.push({ x: d.x + d.dirX * d.mouth, y: d.y + d.dirY * d.mouth, rFixed: L * (0.2 + 2.2 * easeOut3(age)), width: L * 0.18, amp: 7 * (1 - age) ** 2, dur: 0 });
    }
    if (ti >= 0) kickShake = Math.max(kickShake, Math.exp(-ti / 0.3) * 0.5);
  }
  ship.x = d.x + d.dirX * dist;
  ship.y = d.y + d.dirY * dist;
  ship.vx = d.dirX * speed;
  ship.vy = d.dirY * speed;
  // Bańka okrętu w rozpędzie: rozpycha ośrodek (rośnie z prędkością).
  if (t >= d.tDive && t < d.tGone) {
    const b = d.bubbleSlot;
    const vk = speed / d.vEnd;
    b.on = true;
    b.x = ship.x;
    b.y = ship.y;
    b.angle = d.angle;
    b.vx = ship.vx;
    b.vy = ship.vy;
    b.R = L * 0.62;
    b.asp = 1.35;
    b.A = smoothK(vk * 2.5);
    b.front = 3;
    b.strain = 1.1;
    b.turb = 0.13;
    b.excite = 1.4;
    b.rearT = Infinity;
    b.lensAmp = 18 * b.A;
    F.bubbles.push(b);
  }
  // Linia ujścia w układzie kadłuba: widać tylko część za nią (x < linia).
  const line = d.mouth - dist;
  if (t >= d.tDive) {
    ship.revealMode = -1;
    ship.revealLine = line;
    ship.seamLine = line;
    ship.seam = line > -L * 0.55 && line < L * 0.55 ? 1 : 0;
  }
  ship.visible = t < d.tDive || line > -L * 0.55;
  return kickShake;
}
