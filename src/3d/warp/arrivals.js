// src/3d/warp/arrivals.js
//
// Przylot i odlot okrętu NPC — widok z zewnątrz (dema/warp-webgpu/arrivals.js, iteracja 3 —
// 2026-10-03). User: „jak w Star Wars” — okręt wpada z dużą prędkością i nagle gwałtownie hamuje;
// BEZ portalu (dawna szczelina / tunel usunięte — po wyjściu z niej okręt jeszcze kawałek leciał)
// i BEZ smugi („normalnie widoczny statek”):
//   ZWIASTUN  — prosta nić wzbudzonego ośrodka wzdłuż kursu do miejsca zatrzymania, ośrodek
//               zbierany w punkt (lekki wir), mały rdzeń;
//   WLOT      — okręt pojawia się daleko za celem (zwykle za brzegiem kadru), leci prosto z pełną
//               prędkością (bańka rozpycha ośrodek: turkus przed dziobem, warkocz za rufą);
//   HAMOWANIE — w chwili dawnego wyrzutu (oś zwiastuna z gry) stałe opóźnienie na krótkiej drodze:
//               błysk na dziobie, blask, fala, wstrząs, żar, bańka zapada się od dziobu, ośrodek
//               przed dziobem leci dalej siłą bezwładności (iskry);
//   ODLOT     — po ładowaniu (punkt skoku przed dziobem) KOP od rufy (błysk, fala, wstrząs), okręt
//               przyspiesza (droga ∝ t³) i znika od dziobu w punkcie skoku (błysk, fala).
// Osie i drogi: src/game/warpDrive.js (createWarpArrival + planWarpRush / sampleWarpRush,
// createWarpDeparture / sampleWarpDeparture) — tu tylko wygląd w języku „Nurtu”.
//
// W GRZE okręt jest encją rozgrywki:
//  - `drive` (wezwania i przyloty „teraz”): efekt PROWADZI okręt przez wlot i hamowanie (pozycja
//    i prędkość z warpPose — sterownik pisze je encji; okręt jest wtedy duchem), od zatrzymania
//    oddaje go grze;
//  - `moving` (warp-in piratów — spawnPirateHeavyFleet): pozycję prowadzi gra (4000 j/s); efekt
//    odsłania kadłub od miejsca pojawienia się, a hamowanie zaczyna się, gdy okręt wyjdzie
//    z 'warping_in' (sterownik ustawia wtedy tBrake);
//  - odlot: `drive` — droga z osi; bez niego pozycję trzyma gra.
// Czysty moduł (bez three) — pozycje w klatce względem kamery (frame.js).

import {
  createWarpArrival, sampleWarpArrival, planWarpRush, sampleWarpRush, warpBrakeTime, warpBrakeBubbleFront,
  createWarpDeparture, sampleWarpDeparture
} from '../../game/warpDrive.js';
import { newWarpSlot } from './frame.js';
import { warpPalette, seamColor, heatColor } from './palette.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };
const smoothK = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
/** Zasięg nici zwiastuna wstecz od miejsca zatrzymania [j.] (od krawędzi kadru). */
export const HERALD_REACH = 60000;

function newHullFx() {
  return { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
}

/**
 * Przylot okrętu (hullLength, hullWidth w j.) do (x, y) z kursem `angle` (świat gry) — (x, y) =
 * miejsce zatrzymania. startTime — start zwiastuna; burstTime (zamiast startTime) — początek
 * hamowania; appearTime (zamiast obu) — okręt pojawia się w tej chwili (przylot „teraz”).
 * moving — pozycję prowadzi gra (hamowanie z chwili wyjścia z warp-in: setMovingBrake);
 * rush — minimalna droga wlotu [× długość kadłuba]; heraldReach — nić krótsza, gdy znane
 * miejsce startu jest bliżej (wezwanie z Ziemi).
 */
export function planWarpArrivalFx(o) {
  const probe = planWarpRush(createWarpArrival({ hullLength: o.hullLength, heraldExtra: o.heraldExtra }), o.rush);
  const lead = probe.tBurst - probe.t0;
  let startTime = Number(o.startTime) || 0;
  if (Number.isFinite(o.burstTime)) startTime = o.burstTime - lead;
  else if (Number.isFinite(o.appearTime)) startTime = o.appearTime - (probe.tAppear - probe.t0);
  const a = createWarpArrival({
    x: o.x, y: o.y, angle: o.angle, hullLength: o.hullLength, hullWidth: o.hullWidth,
    startTime, heraldExtra: o.heraldExtra, palette: o.palette, entity: o.entity || null, id: o.id
  });
  planWarpRush(a, o.rush);
  a.sx = a.x;
  a.sy = a.y;
  // Chwila, w której okręt musi już być w grze (wezwanie: spawn — src/game/supportWarp.js).
  a.tSpawn = a.tAppear;
  a.pal = warpPalette(o.palette);
  a.pirate = !!o.pirate;
  a.moving = !!o.moving;
  a.drive = !o.moving;
  const reach = Number(o.heraldReach);
  a.heraldReach = reach > 0 ? Math.max(a.hullLength * 2, Math.min(HERALD_REACH, reach)) : HERALD_REACH;
  a.sample = {};
  a.rushSample = {};
  // Przegródki ośrodka — NIE `a.herald` (to czas zwiastuna z createWarpArrival).
  a.heraldSlot = newWarpSlot();
  a.bubbleSlot = newWarpSlot();
  a.pushSlot = newWarpSlot();
  a.pushSlot.releaseT = a.tBrake + 0.02;
  a.seed = ((o.x * 0.013 + o.y * 0.007) % 100 + 100) % 100;
  a.hull = newHullFx();
  a.plasmaMode = null;
  if (a.moving) {
    // Gra prowadzi okręt: pojawia się teraz (w miejscu encji), hamowanie — gdy wyjdzie z warp-in.
    a.tAppear = Number.isFinite(o.appearTime) ? o.appearTime : a.tAppear;
    a.tBrake = Infinity;
    a.tStop = Infinity;
    a.tEnd = Infinity;
    a.v0 = Math.max(1, Number(o.speed) || a.v0);
    a.brake = warpBrakeTime(a.hullLength, a.v0);
  }
  return a;
}

/** Warp-in prowadzony przez grę: okręt wyszedł z 'warping_in' w chwili t — hamowanie od teraz. */
export function setMovingBrake(a, t, speed) {
  if (Number(speed) > 1) a.v0 = speed;
  a.brake = warpBrakeTime(a.hullLength, a.v0);
  a.tBrake = t;
  a.tStop = t + a.brake;
  a.tEnd = a.tStop + 4.5;
  a.pushSlot.releaseT = t + 0.02;
}

/** Pozycja okrętu prowadzonego przez wlot i hamowanie (drive): świat, prędkość. */
export function arrivalFxPose(a, t, out) {
  const r = sampleWarpRush(a, t, a.rushSample);
  out.x = a.x + a.dirX * r.off;
  out.y = a.y + a.dirY * r.off;
  out.vx = a.dirX * r.speed;
  out.vy = a.dirY * r.speed;
  out.appeared = r.appeared;
  return out;
}

/**
 * Stan przylotu w chwili t → klatka (przegródki, błyski, fale), kadłub encji (a.hull:
 * odsłanianie, żar), plazma (a.plasmaMode). `ship` = { x, y, angle, vx, vy, visible } — poza
 * encji w świecie (albo null przed `attach`; drive — z arrivalFxPose). camX, camY — kamera.
 * Zwraca wstrząs 0..1 (× skala wołającego).
 */
export function warpArrivalFxState(a, t, frame, camX, camY, ship) {
  const s = sampleWarpArrival(a, t, a.sample);
  const L = a.hullLength;
  const pal = a.pal;
  const size = a.sizeScale;
  const hull = a.hull;
  hull.on = false;
  a.plasmaMode = null;
  if (t < a.t0 || t > a.tEnd) return 0;

  // --- zwiastun: nić wzdłuż kursu i punkt zbierania w miejscu zatrzymania ---
  if (!a.moving && s.herald > 0.002 && t < a.tBrake + 0.6) {
    const h = a.heraldSlot;
    const reach = a.heraldReach || HERALD_REACH;
    h.on = true;
    h.x = a.sx - a.dirX * reach - camX;
    h.y = a.sy - a.dirY * reach - camY;
    h.angle = a.angle;
    h.vx = 0; h.vy = 0;
    h.R = L * 0.6;
    h.A = 0;
    h.heraldLen = reach;
    h.heraldGain = s.herald * (a.pirate ? 1.2 : 1.0);
    h.pullR = L * 0.45;
    h.pullGain = s.herald;
    h.excite = 1;
    h.releaseT = Infinity;
    h.rearT = Infinity;
    frame.pushBubble(h);
    const pulse = 0.85 + 0.15 * Math.sin(t * 17 + a.seed);
    const k = (0.4 + 1.4 * s.herald * s.herald) * pulse;
    frame.addFlash(a.sx - camX, a.sy - camY, L * (0.08 + 0.12 * s.herald), k, pal, true);
  }

  // --- wlot (kadłub widoczny normalnie, bez smugi) i gwałtowne hamowanie ---
  const tau = t - a.tAppear;
  if (tau < 0 || !ship || ship.visible === false) return 0;
  const c = Math.cos(a.angle);
  const sn = Math.sin(a.angle);
  // Droga od miejsca pojawienia się (drive: z osi; moving: z pozycji encji).
  const along = a.moving
    ? (ship.x - a.x0) * c + (ship.y - a.y0) * sn
    : sampleWarpRush(a, t, a.rushSample).along;
  const svx = Number(ship.vx) || 0;
  const svy = Number(ship.vy) || 0;
  const speed = Math.sqrt(svx * svx + svy * svy);
  const tb = t - a.tBrake;
  // Pojawienie się: odsłonięcie od dziobu na pierwszej długości kadłuba (~0,1 s przy 9 L/s).
  const line = L * 0.56 - along;
  hull.on = true;
  hull.revealMode = line > -L * 0.56 ? 1 : 0;
  hull.revealLine = line;
  hull.seamLine = -L * 4;
  hull.seam = 0;
  hull.seamW = Math.max(5, L * 0.007);
  seamColor(pal, hull.seamRGB);
  hull.heat = tb < 0 ? 0 : 0.95 * smoothK(tb / 0.06) * Math.exp(-Math.max(0, tb - 0.06) / 2.2);
  heatColor(hull.heat, hull.heatRGB);
  hull.rimW = Math.max(8, L * 0.011);
  if (!hull.revealMode && hull.heat < 0.003 && tb > 0.2) hull.on = false;
  a.plasmaMode = tb < 0.3 ? 'active' : null;

  const sx = ship.x - camX;
  const sy = ship.y - camY;
  // Bańka okrętu w locie: rozpycha ośrodek; przy hamowaniu zapada się od dziobu.
  if (t < a.tStop + 0.35) {
    const b = a.bubbleSlot;
    const vk = Math.min(1, speed / Math.max(1, a.v0));
    b.on = true;
    b.x = sx; b.y = sy;
    b.angle = a.angle;
    b.vx = svx; b.vy = svy;
    b.R = L * 0.62;
    b.asp = 1.35;
    b.A = (tb < 0 ? smoothK(tau / 0.08) : 1) * (t < a.tStop + 0.2 ? 1 : 0);
    b.front = warpBrakeBubbleFront(tb, a.brake);
    b.strain = 1.1;
    b.turb = 0.13;
    b.excite = 1.4;
    b.pullR = 1; b.pullGain = 0; b.jetSpeed = 0; b.heraldLen = 0; b.heraldGain = 0;
    b.releaseT = Infinity;
    b.rearT = a.tStop + 0.05;
    b.lensAmp = 18 * b.A * vk;
    frame.pushBubble(b);
  }
  // Iskry ośrodka pchnięte przed dziób przy hamowaniu (bezwładność).
  const p = a.pushSlot;
  p.on = tb > -0.05 && tb < 0.5;
  if (p.on) {
    p.x = sx; p.y = sy;
    p.angle = a.angle;
    p.vx = 0; p.vy = 0;
    p.R = L * 0.62;
    p.asp = 1.35;
    p.A = 0;
    p.jetSpeed = Math.max(5200 * size, a.v0 * 0.55);
    p.excite = 1;
    p.heraldGain = 0; p.heraldLen = 0; p.pullGain = 0;
    p.rearT = Infinity;
    frame.pushBubble(p);
  }
  // Błysk na dziobie, poprzeczny blask, fala.
  if (tb >= 0 && tb < 0.35) {
    const k = Math.pow(1 - tb / 0.35, 2);
    const bx = sx + c * L * 0.52;
    const by = sy + sn * L * 0.52;
    frame.addFlash(bx, by, L * 0.55, k * 1.8, pal, false);
    frame.addGlare(bx, by, a.angle + Math.PI * 0.5, L * 1.6, k * 1.2, pal);
  }
  if (tb >= 0 && tb < 1.3) {
    const age = tb / 1.3;
    const wx = (a.moving ? ship.x : a.x) + c * L * 0.5 - camX;
    const wy = (a.moving ? ship.y : a.y) + sn * L * 0.5 - camY;
    frame.addWave(wx, wy, L * (0.25 + 3.2 * easeOut3(age)), L * 0.24, 11 * (1 - age) ** 2 * Math.min(1.2, size * 1.2));
  }
  return (tb >= 0 ? Math.exp(-tb / 0.3) : 0) * (0.4 + 0.8 * size);
}

/**
 * Odlot: okręt w (x, y), kurs `angle`; startTime — start ładowania; rush — rozpęd [× L].
 * drive — efekt sam prowadzi okręt w rozpędzie (droga z osi; encja dostaje pozycję i prędkość
 * w `departFxPose`) — bez tego pozycję trzyma gra.
 */
export function planWarpDepartureFx(o) {
  const d = createWarpDeparture({
    x: o.x, y: o.y, angle: o.angle, hullLength: o.hullLength, hullWidth: o.hullWidth,
    startTime: o.startTime, rush: o.rush, palette: o.palette, entity: o.entity || null, id: o.id
  });
  d.pal = warpPalette(o.palette);
  d.pirate = !!o.pirate;
  d.drive = !!o.drive;
  d.sample = {};
  d.heraldSlot = newWarpSlot();
  d.bubbleSlot = newWarpSlot();
  d.seed = ((o.x * 0.011 + o.y * 0.017) % 100 + 100) % 100;
  d.hull = newHullFx();
  d.plasmaMode = null;
  // Punkt skoku (świat) — tu kadłub znika od dziobu.
  d.mouthX = d.cx;
  d.mouthY = d.cy;
  return d;
}

/** Pozycja okrętu w odlocie z osi (drive): świat, prędkość. */
export function departFxPose(d, t, out) {
  const s = sampleWarpDeparture(d, t, d.sample);
  out.x = d.x + d.dirX * s.dist;
  out.y = d.y + d.dirY * s.dist;
  out.vx = d.dirX * s.speed;
  out.vy = d.dirY * s.speed;
  return out;
}

/** Stan odlotu w chwili t → klatka, kadłub (d.hull), plazma. Zwraca wstrząs. */
export function warpDepartureFxState(d, t, frame, camX, camY, ship) {
  const s = sampleWarpDeparture(d, t, d.sample);
  const pal = d.pal;
  const L = d.hullLength;
  const hull = d.hull;
  hull.on = false;
  d.plasmaMode = null;
  if (s.phase === 'wait' || s.phase === 'done') return 0;
  const build = s.build;
  d.plasmaMode = t < d.tGone ? (build > 0.55 || t >= d.tDive ? 'active' : 'charging') : null;
  // Punkt skoku przed dziobem: ośrodek zbierany, rdzeń jaśnieje.
  if (t < d.tGone) {
    const h = d.heraldSlot;
    h.on = true;
    h.x = d.cx - camX;
    h.y = d.cy - camY;
    h.angle = d.angle;
    h.vx = 0; h.vy = 0;
    h.R = L * 0.6;
    h.A = 0;
    h.heraldLen = 0.5;
    h.heraldGain = 0;
    h.pullR = L * (0.35 + 0.25 * build);
    h.pullGain = build;
    h.excite = 1;
    h.releaseT = Infinity;
    h.rearT = Infinity;
    frame.pushBubble(h);
    const pulse = 0.85 + 0.15 * Math.sin(t * (8 + 22 * s.u) + d.seed);
    frame.addFlash(d.cx - camX, d.cy - camY, L * (0.08 + 0.18 * build), (0.35 + 1.6 * build * build) * pulse, pal, true);
  }
  // Kop: błysk i fala za rufą (punkt, od którego okręt się odbił).
  const kt = s.kickT;
  if (kt >= 0) {
    const kx = d.x - d.dirX * L * 0.6 - camX;
    const ky = d.y - d.dirY * L * 0.6 - camY;
    if (kt < 0.3) frame.addFlash(kx, ky, L * 0.55, Math.pow(1 - kt / 0.3, 2) * 1.6, pal, false);
    if (kt < 1.2) {
      const age = kt / 1.2;
      frame.addWave(kx, ky, L * (0.2 + 3.0 * easeOut3(age)), L * 0.22, 9 * (1 - age) ** 2);
    }
  }
  // Skok z pełną prędkością: błysk i fala w punkcie skoku.
  const ti = s.inT;
  if (ti >= 0) {
    const mx = d.mouthX - camX;
    const my = d.mouthY - camY;
    if (ti < 0.25) frame.addFlash(mx, my, L * 0.5, Math.pow(1 - ti / 0.25, 2) * 1.5, pal, false);
    if (ti < 1.1) {
      const age = ti / 1.1;
      frame.addWave(mx, my, L * (0.2 + 2.2 * easeOut3(age)), L * 0.18, 7 * (1 - age) ** 2);
    }
  }
  if (ship) {
    const c = Math.cos(ship.angle);
    const sn = Math.sin(ship.angle);
    // Linia punktu skoku w układzie kadłuba: widać tylko część za nią (x < linia).
    const line = (d.mouthX - ship.x) * c + (d.mouthY - ship.y) * sn;
    const diving = t >= d.tDive;
    hull.on = true;
    hull.revealMode = diving ? -1 : 0;
    hull.revealLine = line;
    hull.seamLine = line;
    hull.seam = diving && line > -L * 0.55 && line < L * 0.55 ? 1 : 0;
    hull.seamW = Math.max(5, L * 0.007);
    seamColor(pal, hull.seamRGB);
    hull.heat = s.heat;
    heatColor(hull.heat, hull.heatRGB);
    hull.rimW = Math.max(8, L * 0.011);
    // Bańka okrętu w rozpędzie: rozpycha ośrodek (rośnie z prędkością).
    if (diving && t < d.tGone) {
      const b = d.bubbleSlot;
      const vk = s.speed / Math.max(1, d.vEnd);
      b.on = true;
      b.x = ship.x - camX;
      b.y = ship.y - camY;
      b.angle = d.angle;
      b.vx = d.dirX * s.speed;
      b.vy = d.dirY * s.speed;
      b.R = L * 0.62;
      b.asp = 1.35;
      b.A = smoothK(vk * 2.5);
      b.front = 3;
      b.strain = 1.1;
      b.turb = 0.13;
      b.excite = 1.4;
      b.pullR = 1; b.pullGain = 0; b.jetSpeed = 0; b.heraldLen = 0; b.heraldGain = 0;
      b.releaseT = Infinity;
      b.rearT = Infinity;
      b.lensAmp = 18 * b.A;
      frame.pushBubble(b);
    }
  }
  return s.shake;
}
