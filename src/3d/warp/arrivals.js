// src/3d/warp/arrivals.js
//
// Przylot i odlot okrętu NPC — widok z zewnątrz (dema/warp-webgpu/arrivals.js, iteracja 3 —
// 2026-10-03). User: „jak w Star Wars” — okręt wpada z dużą prędkością i nagle gwałtownie hamuje;
// BEZ portalu (dawna szczelina / tunel usunięte — po wyjściu z niej okręt jeszcze kawałek leciał)
// i — w dawnym wyglądzie (`?warpSW=0`) — BEZ smugi („normalnie widoczny statek”):
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
// WYGLĄD DOMYŚLNY od 2026-10-30 (warpSW.js; user po prototypie: „ustaw domyślne”): przylot i wylot „jak w Gwiezdnych
// Wojnach” — kadłub ze światła i smuga za rufą w wlocie (zatrzask przy hamowaniu), w odlocie ślad za rufą i smuga wystrzelona
// w punkcie skoku; parametr `sw` funkcji stanu (null — dawny wygląd, `?warpSW=0`). Komentarze „`?warpSW=1`” niżej = wygląd SW.
//
// W GRZE okręt jest encją rozgrywki, a OŚ przylotu / odlotu (czasy, droga, wymiary), prowadzenie okrętu w tunelu,
// duch i `onGone` należą do gry (RW-28: src/game/warpTraffic.js — rejestr ruchu warpa w czasie gry):
//  - `drive` (wezwania i przyloty „teraz”): gra prowadzi okręt przez wlot i hamowanie (`arrivalAxisPose`), od
//    zatrzymania okręt wraca do zwykłej gry;
//  - `moving` (warp-in piratów — spawnPirateHeavyFleet): pozycję prowadzi gra (4000 j/s); efekt odsłania kadłub od
//    miejsca pojawienia się, a hamowanie zaczyna się, gdy okręt wyjdzie z 'warping_in' (gra ustawia wtedy tBrake);
//  - odlot: `drive` — droga z osi; bez niego pozycję trzyma gra.
// Tu tylko WYGLĄD: barwy, przegródki ośrodka, błyski, fale, kadłub (odsłanianie, żar) — „ubiór” rekordu
// (`dressWarpArrival` / `dressWarpDeparture`) obok osi z gry. Czysty moduł (bez three) — pozycje w klatce względem
// kamery (frame.js).

import { sampleWarpArrival, sampleWarpRush, warpBrakeBubbleFront, sampleWarpDeparture } from '../../game/warpDrive.js';
import {
  HERALD_REACH, planWarpArrivalAxis, planWarpDepartureAxis, arrivalAxisPose, departAxisPose, setArrivalMovingBrake
} from '../../game/warpTraffic.js';
import { newWarpSlot } from './frame.js';
import { warpPalette, seamColor, heatColor } from './palette.js';
import {
  WARP_SW, newWarpSWState, warpSWArrival, warpSWDeparture, warpSWHullLight, warpSWWidth, addWarpSWStreak
} from './warpSW.js';
import {
  sparksArrivalHerald, sparksArrivalTrail, sparksArrivalBrake, sparksDepartGather, sparksDepartWake, sparksDepartGone
} from './sparkRecipes.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// [s] okres fal zwiastuna „drganie przestrzeni” (styl 'ripple' — scena „Wojna”, warpTraffic.planArrival heraldStyle)
const RIPPLE_PERIOD = 0.55;
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };
const smoothK = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export { HERALD_REACH };

function newHullFx() {
  return { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
}

/**
 * Ubiór przylotu (render): barwy, przegródki ośrodka, kadłub, ziarno — obok osi `a` z gry (planWarpArrivalAxis).
 * `v` — obiekt ubioru (domyślnie sama oś: dawny jeden obiekt efektu — testy, warsztat).
 */
export function dressWarpArrival(a, v = {}) {
  v.pal = warpPalette(a.palette);
  v.sample = {};
  v.rushSample = {};
  // Przegródki ośrodka — NIE `a.herald` (to czas zwiastuna z createWarpArrival).
  v.heraldSlot = newWarpSlot();
  v.bubbleSlot = newWarpSlot();
  v.pushSlot = newWarpSlot();
  v.pushSlot.releaseT = a.pushReleaseT;
  v.seed = ((a.x * 0.013 + a.y * 0.007) % 100 + 100) % 100;
  v.hull = newHullFx();
  v.plasmaMode = null;
  // `?warpSW=1`: wynik obwiedni i widoczność encji (mgła wojny, maskowanie — pisze sterownik co klatkę)
  v.sw = newWarpSWState();
  v.swVis = 1;
  // Drobiny (sparkRecipes.js): ziarno rekordów, start i prędkość śladu wlotu warp-in prowadzonego przez grę (z pierwszej
  // klatki po pojawieniu się — prędkość stała do hamowania), dziób w chwili hamowania (warp-in: z pozy encji).
  v.sparkSeed = Math.floor(v.seed * 1000) + 1;
  v.trailV = 0;
  v.brakeX = NaN;
  v.brakeY = NaN;
  return v;
}

/** Przylot z osią i ubiorem w jednym obiekcie (testy, warsztat) — oś: planWarpArrivalAxis (src/game/warpTraffic.js). */
export function planWarpArrivalFx(o) {
  const a = planWarpArrivalAxis(o);
  dressWarpArrival(a, a);
  return a;
}

/** Warp-in prowadzony przez grę: okręt wyszedł z 'warping_in' w chwili t — hamowanie od teraz (oś: gra). */
export const setMovingBrake = setArrivalMovingBrake;

/** Pozycja okrętu prowadzonego przez wlot i hamowanie (drive): świat, prędkość (oś: gra). */
export const arrivalFxPose = arrivalAxisPose;

/**
 * Stan przylotu w chwili t → klatka (przegródki, błyski, fale), kadłub encji (v.hull:
 * odsłanianie, żar), plazma (v.plasmaMode; v — ubiór, domyślnie sama oś). `ship` = { x, y, angle, vx, vy, visible } — poza
 * encji w świecie (albo null przed `attach`; drive — z arrivalFxPose). camX, camY — kamera. `sw` — strojenie WARP_SW
 * (`?warpSW=1`: kadłub ze światła, smuga za rufą) albo null (wygląd domyślny). WIDOCZNOŚĆ ENCJI v.swVis (mgła wojny, soczewka
 * skoku, maskowanie — pisze sterownik dla żywej encji; przed `attach` zostaje 1): przy 0 bez przegródek ośrodka, błysków,
 * blasku i fal (zasada mgły wojny — nic nie zdradza ukrytego wroga), przy 0 < vis < 1 błyski i fale × vis; kadłub i plazmę
 * chowa obraz kadłuba.
 * DROBINY (`sparks` = true — domyślnie, sparkRecipes.js; `?warpDrobiny=0` — false): zamiast przegródek ośrodka (nić,
 * bańka, pchnięcie — ośrodek, który popychały wszystkie bańki i kamera) własne drobiny okrętu ze wzoru: nić zwiastuna,
 * ślad wlotu, snop hamowania. Ośrodek „Nurtu” przylot NPC wtedy nie budzi.
 * Zwraca wstrząs 0..1 (× skala wołającego).
 * AGENT: wynik nieczytany — `warpNurt.js: _updateArrivals` go pomija, wstrząsy przylotów i odlotów zgłasza gra
 * (`src/game/warpShakes.js`). Usunąć razem z porządkami C2 (docs/webgpu/WARP-SOCZEWKA.md, „Otwarte sprawy”).
 */
export function warpArrivalFxState(a, t, frame, camX, camY, ship, v = a, sw = null, sparks = false) {
  const s = sampleWarpArrival(a, t, v.sample);
  const L = a.hullLength;
  const pal = v.pal;
  const size = a.sizeScale;
  const hull = v.hull;
  hull.on = false;
  v.plasmaMode = null;
  // Puszczenie iskier przed dziobem — chwila z osi gry (hamowanie warp-in ustawia ją gra).
  v.pushSlot.releaseT = a.pushReleaseT;
  if (t < a.t0 || t > a.tEnd) return 0;
  // widoczność encji (mgła wojny, soczewka, maskowanie): ukryta — bez przegródek, błysków i fal; częściowa — × vis
  const vis = Number.isFinite(v.swVis) ? clamp01(v.swVis) : 1;
  const shown = vis > 0.002;

  // --- zwiastun: nić wzdłuż kursu i punkt zbierania w miejscu zatrzymania (styl 'thread', domyślny), drganie
  // przestrzeni ('ripple': fale refrakcji zapadające się do punktu wyjścia, co RIPPLE_PERIOD s) albo nic ('none') ---
  const heraldStyle = a.heraldStyle || 'thread';
  if (shown && !a.moving && heraldStyle === 'ripple' && s.herald > 0.002 && t < a.tBrake + 0.1) {
    const age = (t - a.t0) / RIPPLE_PERIOD;
    const u = age - Math.floor(age);
    const k = s.herald * Math.sin(Math.PI * u);
    frame.addWave(a.sx - camX, a.sy - camY, L * (0.15 + 2.1 * (1 - u)), L * 0.2, 7 * k * Math.min(1.2, size * 1.2) * vis);
    frame.addFlash(a.sx - camX, a.sy - camY, L * (0.05 + 0.08 * s.herald), (0.25 + 0.9 * s.herald * s.herald) * vis, pal, true);
  }
  if (shown && !a.moving && heraldStyle === 'thread' && s.herald > 0.002 && t < a.tBrake + 0.6) {
    if (sparks) {
      sparksArrivalHerald(frame, a, t, s.herald * (a.pirate ? 1.2 : 1.0) * vis, camX, camY, v.sparkSeed || 1);
    } else {
      const h = v.heraldSlot;
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
    }
    const pulse = 0.85 + 0.15 * Math.sin(t * 17 + v.seed);
    const k = (0.4 + 1.4 * s.herald * s.herald) * pulse;
    frame.addFlash(a.sx - camX, a.sy - camY, L * (0.08 + 0.12 * s.herald), k * vis, pal, true);
  }

  // --- wlot (kadłub widoczny normalnie, bez smugi) i gwałtowne hamowanie ---
  const tau = t - a.tAppear;
  if (tau < 0 || !ship || ship.visible === false) return 0;
  const c = Math.cos(a.angle);
  const sn = Math.sin(a.angle);
  // Droga od miejsca pojawienia się (drive: z osi; moving: z pozycji encji).
  const along = a.moving
    ? (ship.x - a.x0) * c + (ship.y - a.y0) * sn
    : sampleWarpRush(a, t, v.rushSample).along;
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
  v.plasmaMode = tb < 0.3 ? 'active' : null;

  const sx = ship.x - camX;
  const sy = ship.y - camY;
  // `?warpSW=1`: kadłub ze światła (wlot, gaśnie po hamowaniu) i smuga za rufą wzdłuż kursu (zatrzask przy hamowaniu);
  // encja ukryta (mgła wojny, maskowanie — vis) bez smugi i światła.
  if (sw) {
    const e = warpSWArrival(a, t, along, v.sw || (v.sw = newWarpSWState()));
    if (e.light * vis > 0.002) warpSWHullLight(hull, L, e.light * vis);
    if (e.len > 0 && shown) {
      addWarpSWStreak(frame, sx - c * L * 0.5, sy - sn * L * 0.5, c, sn, e.len, warpSWWidth(L, a.hullWidth), e.k * vis);
    }
  }
  if (!shown) return 0;
  if (sparks) {
    // Drobiny: ślad wlotu (start i prędkość stałe przez wlot — warp-in prowadzony przez grę: z pierwszej klatki) i snop
    // hamowania z dziobu. Bez przegródek ośrodka.
    const seed = v.sparkSeed || 1;
    let V = a.v0;
    let dist = a.v0 * a.coast;
    let cap = dist;
    if (a.moving) {
      if (!(v.trailV > 1) && speed > 1) v.trailV = speed;
      V = v.trailV > 1 ? v.trailV : Math.max(1, Number(a.v0) || 0);
      dist = V * 1.5;
      cap = Number.isFinite(a.tBrake) ? V * Math.max(0, a.tBrake - a.tAppear) : Infinity;
    }
    sparksArrivalTrail(frame, a, t, a.x0, a.y0, V, dist, cap, vis, camX, camY, seed + 7919);
    if (tb >= 0) {
      if (!Number.isFinite(v.brakeX)) {
        // drive: dziób na końcu hamowania (oś); warp-in: dziób encji w pierwszej klatce hamowania
        v.brakeX = (a.moving ? ship.x : a.x) + c * L * 0.5;
        v.brakeY = (a.moving ? ship.y : a.y) + sn * L * 0.5;
      }
      sparksArrivalBrake(frame, a, t, v.brakeX, v.brakeY, vis, camX, camY, seed + 2 * 7919);
    }
  }
  // Bańka okrętu w locie: rozpycha ośrodek; przy hamowaniu zapada się od dziobu.
  if (!sparks && t < a.tStop + 0.35) {
    const b = v.bubbleSlot;
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
  // Iskry ośrodka pchnięte przed dziób przy hamowaniu (bezwładność) — dawny wygląd (`?warpDrobiny=0`).
  const p = v.pushSlot;
  p.on = !sparks && tb > -0.05 && tb < 0.5;
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
  // Błysk na dziobie, poprzeczny blask, fala (× widoczność encji).
  if (tb >= 0 && tb < 0.35) {
    const k = Math.pow(1 - tb / 0.35, 2) * vis;
    const bx = sx + c * L * 0.52;
    const by = sy + sn * L * 0.52;
    frame.addFlash(bx, by, L * 0.55, k * 1.8, pal, false);
    frame.addGlare(bx, by, a.angle + Math.PI * 0.5, L * 1.6, k * 1.2, pal);
  }
  if (tb >= 0 && tb < 1.3) {
    const age = tb / 1.3;
    const wx = (a.moving ? ship.x : a.x) + c * L * 0.5 - camX;
    const wy = (a.moving ? ship.y : a.y) + sn * L * 0.5 - camY;
    frame.addWave(wx, wy, L * (0.25 + 3.2 * easeOut3(age)), L * 0.24, 11 * (1 - age) ** 2 * Math.min(1.2, size * 1.2) * vis);
  }
  return (tb >= 0 ? Math.exp(-tb / 0.3) : 0) * (0.4 + 0.8 * size);
}

/**
 * Ubiór odlotu (render): barwy, przegródki, kadłub, punkt skoku — obok osi `d` z gry (planWarpDepartureAxis).
 */
export function dressWarpDeparture(d, v = {}) {
  v.pal = warpPalette(d.palette);
  v.sample = {};
  v.heraldSlot = newWarpSlot();
  v.bubbleSlot = newWarpSlot();
  v.seed = ((d.x * 0.011 + d.y * 0.017) % 100 + 100) % 100;
  v.hull = newHullFx();
  v.plasmaMode = null;
  // Punkt skoku (świat) — tu kadłub znika od dziobu.
  v.mouthX = d.cx;
  v.mouthY = d.cy;
  // `?warpSW=1`: wynik obwiedni i widoczność encji (pisze sterownik co klatkę, po zniknięciu encji zostaje ostatnia)
  v.sw = newWarpSWState();
  v.swVis = 1;
  v.sparkSeed = Math.floor(v.seed * 1000) + 3;
  return v;
}

/** Odlot z osią i ubiorem w jednym obiekcie (testy, warsztat) — oś: planWarpDepartureAxis (src/game/warpTraffic.js). */
export function planWarpDepartureFx(o) {
  const d = planWarpDepartureAxis(o);
  dressWarpDeparture(d, d);
  return d;
}

/** Pozycja okrętu w odlocie z osi (drive): świat, prędkość (oś: gra). */
export const departFxPose = departAxisPose;

/**
 * Stan odlotu w chwili t → klatka, kadłub (v.hull), plazma (v — ubiór). `sw` — strojenie WARP_SW (`?warpSW=1`: kadłub ze
 * światła od nurkowania, ślad za rufą, smuga wystrzelona w punkcie skoku; kadłub znika od dziobu w punkcie skoku jak
 * domyślnie) albo null (wygląd domyślny). WIDOCZNOŚĆ ENCJI v.swVis (jak w przylocie; po zniknięciu encji — ostatnia): przy 0
 * bez przegródek ośrodka, błysków i fal, przy 0 < vis < 1 błyski i fale × vis.
 * DROBINY (`sparks`, jak w przylocie): punkt skoku zbiera własne drobiny po spirali, rozpęd zostawia ślad, w punkcie skoku
 * drobiny wystrzeliwują do przodu — bez przegródek ośrodka.
 * Zwraca wstrząs (AGENT: nieczytany — jak wyżej).
 */
export function warpDepartureFxState(d, t, frame, camX, camY, ship, v = d, sw = null, sparks = false) {
  const s = sampleWarpDeparture(d, t, v.sample);
  const pal = v.pal;
  const L = d.hullLength;
  const hull = v.hull;
  hull.on = false;
  v.plasmaMode = null;
  if (s.phase === 'wait' || s.phase === 'done') return 0;
  const swE = sw ? warpSWDeparture(d, t, s, v.sw || (v.sw = newWarpSWState())) : null;
  // widoczność encji (mgła wojny, soczewka, maskowanie): ukryta — bez przegródek, błysków i fal; częściowa — × vis
  const vis = Number.isFinite(v.swVis) ? clamp01(v.swVis) : 1;
  const shown = vis > 0.002;
  const build = s.build;
  v.plasmaMode = t < d.tGone ? (build > 0.55 || t >= d.tDive ? 'active' : 'charging') : null;
  // Drobiny: ślad rozpędu i wystrzał w punkcie skoku (z osi — także po zniknięciu encji, póki drobiny żyją).
  if (sparks && shown) {
    const seed = v.sparkSeed || 3;
    sparksDepartWake(frame, d, t, vis, camX, camY, seed + 7919);
    sparksDepartGone(frame, d, t, vis, camX, camY, seed + 2 * 7919);
  }
  // Punkt skoku przed dziobem: ośrodek zbierany (drobiny — własne, po spirali), rdzeń jaśnieje.
  if (shown && t < d.tGone) {
    if (sparks) {
      sparksDepartGather(frame, d, t, build * vis, build, camX, camY, v.sparkSeed || 3);
    } else {
      const h = v.heraldSlot;
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
    }
    const pulse = 0.85 + 0.15 * Math.sin(t * (8 + 22 * s.u) + v.seed);
    frame.addFlash(d.cx - camX, d.cy - camY, L * (0.08 + 0.18 * build), (0.35 + 1.6 * build * build) * pulse * vis, pal, true);
  }
  // Kop: błysk i fala za rufą (punkt, od którego okręt się odbił).
  const kt = s.kickT;
  if (shown && kt >= 0) {
    const kx = d.x - d.dirX * L * 0.6 - camX;
    const ky = d.y - d.dirY * L * 0.6 - camY;
    if (kt < 0.3) frame.addFlash(kx, ky, L * 0.55, Math.pow(1 - kt / 0.3, 2) * 1.6 * vis, pal, false);
    if (kt < 1.2) {
      const age = kt / 1.2;
      frame.addWave(kx, ky, L * (0.2 + 3.0 * easeOut3(age)), L * 0.22, 9 * (1 - age) ** 2 * vis);
    }
  }
  // Skok z pełną prędkością: błysk i fala w punkcie skoku.
  const ti = s.inT;
  if (shown && ti >= 0) {
    const mx = v.mouthX - camX;
    const my = v.mouthY - camY;
    if (ti < 0.25) frame.addFlash(mx, my, L * (swE ? WARP_SW.departFlashL : 0.5), Math.pow(1 - ti / 0.25, 2) * 1.5 * vis, pal, false);
    if (ti < 1.1) {
      const age = ti / 1.1;
      frame.addWave(mx, my, L * (0.2 + 2.2 * easeOut3(age)), L * 0.18, 7 * (1 - age) ** 2 * vis);
    }
    // `?warpSW=1`: smuga wystrzelona do przodu z punktu skoku (kadłub wchodzi w nią, znikając od dziobu)
    if (swE && swE.gone && swE.len > 0) {
      addWarpSWStreak(frame, mx + d.dirX * swE.head, my + d.dirY * swE.head, d.dirX, d.dirY, swE.len,
        warpSWWidth(L, d.hullWidth), swE.k * vis);
    }
  }
  if (ship) {
    const c = Math.cos(ship.angle);
    const sn = Math.sin(ship.angle);
    // Linia punktu skoku w układzie kadłuba: widać tylko część za nią (x < linia).
    const line = (v.mouthX - ship.x) * c + (v.mouthY - ship.y) * sn;
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
    // `?warpSW=1`: od nurkowania kadłub ze światła i ślad za rufą (rośnie z prędkością); od punktu skoku domyślne
    // odsłanianie (linia punktu skoku, szew, żar) — nie chowaj całego kadłuba: wieże, lampy i plazma dysz zostają do
    // zniknięcia encji w tGone; encja ukryta (mgła wojny, maskowanie) bez smugi i światła.
    if (swE) {
      if (!swE.gone && swE.light * vis > 0.002) warpSWHullLight(hull, L, swE.light * vis);
      if (!swE.gone && swE.len > 0 && shown) {
        addWarpSWStreak(frame, ship.x - camX - d.dirX * L * 0.5, ship.y - camY - d.dirY * L * 0.5, d.dirX, d.dirY,
          swE.len, warpSWWidth(L, d.hullWidth), swE.k * vis);
      }
    }
    // Bańka okrętu w rozpędzie: rozpycha ośrodek (rośnie z prędkością) — dawny wygląd (`?warpDrobiny=0`).
    if (!sparks && shown && diving && t < d.tGone) {
      const b = v.bubbleSlot;
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
