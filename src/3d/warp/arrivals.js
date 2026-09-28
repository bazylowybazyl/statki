// src/3d/warp/arrivals.js
//
// Przylot i odlot okrętu NPC przez TUNEL — widok z zewnątrz (dema/warp-webgpu/arrivals.js,
// iteracja 2: „prosta nić → szczelina → okręt wypada”). Osie czasu i geometria z
// src/game/warpDrive.js (createWarpArrival / sampleWarpArrival — bez zmian, createWarpDeparture /
// sampleWarpDeparture — oś odlotu z dema), wygląd w języku „Nurtu”:
//   ZWIASTUN   — prosta nić wzbudzonego ośrodka od krawędzi kadru do punktu wyjścia, ośrodek
//                zbierany w punkt (lekki wir), mały rdzeń; pod koniec punkt wydłuża się w kreskę;
//   ROZDARCIE  — szczelina otwiera się wzdłuż kursu (rift.js): cienkie jasne brzegi, w środku
//                strugi w barwie plazmy (piraci — migocząca, czerwona), ośrodek się rozsuwa, tło
//                (mgławica) wciągane w szczelinę;
//   WYRZUT     — okręt wypada z szczeliny: kadłub odsłania się od dziobu, za nim smuga sylwetki,
//                błysk w ujściu, poprzeczna linia blasku, iskry ośrodka pchnięte przed dziób,
//                przezroczysta fala, wstrząs, biały żar brzegu;
//   ZAMKNIĘCIE — szczelina gaśnie; żar stygnie.
// Odlot = to samo wspak: punkt skoku przed dziobem, szczelina, okręt przyspiesza i znika w niej
// od dziobu, szczelina się zamyka.
//
// W GRZE okręt jest encją rozgrywki — efekt jej nie rusza (bez zmian przylotu NPC):
//  - wyrzut zaczyna się w chwili, gdy okręt pojawia się w grze (`attach`); zwiastun i rozdarcie
//    grają tylko wtedy, gdy przylot zaplanowano wcześniej (`startTime` przed wyrzutem — API
//    WarpNurt.planArrival, harness, przyszłe wezwania z opóźnieniem);
//  - okręt nie „wysuwa się” o emergeDist jak w demie (jego pozycję trzyma gra): ujście stoi przy
//    dziobie w chwili wyrzutu; kadłub stojący odsłania się w czasie (0,09–0,15 s jak w demie),
//    a PŁYNĄCY (piracki warp-in 4000 j/s) — pozycją: widać tylko część przed płaszczyzną ujścia;
//  - odlot: kadłub za płaszczyzną ujścia znika (pozycja z gry albo — `drive` — z osi dema).
// Czysty moduł (bez three) — pozycje w klatce względem kamery (frame.js).

import { createWarpArrival, sampleWarpArrival, createWarpDeparture, sampleWarpDeparture } from '../../game/warpDrive.js';
import { newWarpSlot } from './frame.js';
import { warpPalette, seamColor, heatColor } from './palette.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };
/** Zasięg nici zwiastuna wstecz od punktu wyjścia [j.] (od krawędzi kadru). */
export const HERALD_REACH = 60000;

function newHullFx() {
  return { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
}

/**
 * Przylot okrętu (hullLength, hullWidth w j.) do (x, y) z kursem `angle` (świat gry) —
 * (x, y) = środek kadłuba w chwili wyrzutu. startTime — start zwiastuna; burstTime (zamiast
 * startTime) — wyrzut w tej chwili (zwiastun i rozdarcie przed nim). moving — okręt płynie
 * dalej po wyrzucie (odsłanianie płaszczyzną ujścia).
 */
export function planWarpArrivalFx(o) {
  const probe = createWarpArrival({ hullLength: o.hullLength, heraldExtra: o.heraldExtra });
  const lead = probe.tBurst - probe.t0;
  const startTime = Number.isFinite(o.burstTime) ? o.burstTime - lead : (Number(o.startTime) || 0);
  const a = createWarpArrival({
    x: o.x, y: o.y, angle: o.angle, hullLength: o.hullLength, hullWidth: o.hullWidth,
    startTime, heraldExtra: o.heraldExtra, palette: o.palette, entity: o.entity || null, id: o.id
  });
  const L = a.hullLength;
  if (o.moving) {
    // Okręt płynący (warp-in): ujście przy dziobie w chwili pojawienia się, szczelina za nim
    // (0,6 L od ujścia do środka szwu — jak w demie), okręt wysuwa się z niej sam.
    a.mx = a.x + a.dirX * L * 0.5;
    a.my = a.y + a.dirY * L * 0.5;
  } else {
    // Stojący (wezwanie): geometria dema — ujście tam, gdzie w demie jest dziób w chwili wyrzutu
    // (okręt wysuwa się tam o emergeDist; w grze stoi, więc dziób wychodzi 0,45 L przed ujście).
    a.mx = a.x + a.dirX * (L * 0.5 - a.emergeDist);
    a.my = a.y + a.dirY * (L * 0.5 - a.emergeDist);
  }
  a.sx = a.mx - a.dirX * L * 0.6;
  a.sy = a.my - a.dirY * L * 0.6;
  a.pal = warpPalette(o.palette);
  a.pirate = !!o.pirate;
  a.moving = !!o.moving;
  a.sample = {};
  // Przegródki ośrodka — NIE `a.herald` (to czas zwiastuna z createWarpArrival).
  a.heraldSlot = newWarpSlot();
  a.pushSlot = newWarpSlot();
  a.pushSlot.releaseT = a.tBurst + 0.02;
  a.seed = ((o.x * 0.013 + o.y * 0.007) % 100 + 100) % 100;
  a.hull = newHullFx();
  a.plasmaMode = null;
  a.burstShakeDone = false;
  return a;
}

/**
 * Stan przylotu w chwili t → klatka (przegródki, szczeliny, błyski, fale), kadłub encji
 * (a.hull: odsłanianie, szew, żar), plazma (a.plasmaMode). `ship` = { x, y, angle, vx, vy,
 * visible } — poza encji w świecie (albo null przed `attach`). camX, camY — kamera (rel).
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
  if (s.phase === 'wait' || s.phase === 'done') return 0;

  // --- zwiastun: nić do punktu wyjścia i punkt zbierania ---
  if (s.herald > 0.002) {
    const h = a.heraldSlot;
    h.on = true;
    h.x = a.sx - a.dirX * HERALD_REACH - camX;
    h.y = a.sy - a.dirY * HERALD_REACH - camY;
    h.angle = a.angle;
    h.vx = 0; h.vy = 0;
    h.R = L * 0.6;
    h.A = 0;
    h.heraldLen = HERALD_REACH;
    h.heraldGain = s.herald * (a.pirate ? 1.2 : 1.0);
    h.pullR = L * 0.45;
    h.pullGain = s.herald;
    h.excite = 1;
    h.releaseT = Infinity;
    h.rearT = Infinity;
    frame.pushBubble(h);
    const pulse = 0.85 + 0.15 * Math.sin(t * 17 + a.seed);
    // Punkt gaśnie, gdy otwiera się szczelina (jej brzegi przejmują światło).
    const k = (0.4 + 1.4 * s.herald * s.herald) * pulse * (1 - 0.8 * Math.min(1, s.seamOpen));
    frame.addFlash(a.sx - camX, a.sy - camY, L * (0.08 + 0.12 * s.herald), k, pal, true);
  }

  // --- szczelina (po zamknięciu gaśnie — bez kreski wiszącej przez stygnięcie) ---
  const riftK = 1 - s.closeT * s.closeT;
  if (s.seamLen > 0.002 && riftK > 0.01) {
    const halfLen = a.seamLength * 0.5 * s.seamLen;
    const open = Math.max(s.seamOpen, s.phase === 'herald' ? 0.06 : 0);
    const halfWidth = a.seamHalfWidth * open;
    const rx = a.sx - camX;
    const ry = a.sy - camY;
    frame.addRift(rx, ry, a.angle, halfLen, halfWidth, riftK, pal, a.pirate ? 1 : 0, a.seed, Math.min(1, open * 1.4));
    if (open > 0.01) {
      frame.addSeam(rx, ry, a.angle, halfLen, Math.max(halfWidth, L * 0.02), 900 * Math.min(1, open) * size, 2600 * size);
      frame.addSeamLens(rx, ry, a.angle, halfLen * 1.05, a.seamHalfWidth * 3.5, 14 * Math.min(1, open));
    }
  }

  // --- wyrzut ---
  const after = t - a.tBurst;
  if (after < 0) return s.shake * (0.4 + 0.8 * size);
  const mx = a.mx - camX;
  const my = a.my - camY;
  if (ship && ship.visible !== false) {
    const c = Math.cos(ship.angle);
    const sn = Math.sin(ship.angle);
    // Odsłonięcie od dziobu + szew na linii frontu. Stojący: w czasie (demo); płynący: pozycją
    // (część kadłuba przed płaszczyzną ujścia).
    let line;
    let revealing;
    if (a.moving) {
      line = (a.mx - ship.x) * c + (a.my - ship.y) * sn;
      revealing = line > -L * 0.56;
    } else {
      const rv = clamp01(after / (0.09 + 0.06 * size));
      line = L * 0.56 - L * 1.12 * easeOut3(rv);
      revealing = rv < 1;
    }
    hull.on = true;
    hull.revealMode = revealing ? 1 : 0;
    hull.revealLine = line;
    hull.seamLine = line;
    hull.seam = revealing && line < L * 0.56 ? 1 : 0;
    hull.seamW = Math.max(5, L * 0.007);
    seamColor(pal, hull.seamRGB);
    hull.heat = 0.85 * Math.exp(-after / 2.4);
    heatColor(hull.heat, hull.heatRGB);
    hull.rimW = Math.max(8, L * 0.011);
    if (!revealing && hull.heat < 0.003) hull.on = false;
    // Smuga sylwetki: pełna przy wyrzucie, gaśnie z prędkością.
    if (s.smear > 0.01) {
      const speed = Math.hypot(Number(ship.vx) || 0, Number(ship.vy) || 0) || s.shipSpeed;
      const total = 1 + Math.min(2.5, (speed * 0.14) / L + 0.45 * s.smear);
      frame.addSmear(a.entity, ship.x - camX, ship.y - camY, ship.angle, L, a.hullWidth, total, s.smear, pal);
    }
    // Plazma WARP z dysz przez pierwsze ~0,5 s (demo: plasma = e^(−t/0,5)·0,9).
    if (after < 0.45) a.plasmaMode = 'active';
    // Iskry ośrodka pchnięte przed dziób (jednorazowo w chwili wyrzutu).
    const p = a.pushSlot;
    p.on = after < 0.5;
    if (p.on) {
      p.x = ship.x - camX;
      p.y = ship.y - camY;
      p.angle = a.angle;
      p.vx = 0; p.vy = 0;
      p.R = L * 0.62;
      p.asp = 1.35;
      p.A = 0;
      p.jetSpeed = 5200 * size;
      p.excite = 1;
      p.heraldGain = 0; p.heraldLen = 0; p.pullGain = 0;
      p.rearT = Infinity;
      frame.pushBubble(p);
    }
  }
  if (s.flash > 0.004) {
    frame.addFlash(mx, my, L * 0.5, s.flash * 1.6, pal, false);
    frame.addGlare(mx, my, a.angle + Math.PI * 0.5, L * 1.4, s.flash, pal);
  }
  if (s.ringT >= 0 && s.ringT < 1) {
    const fade = (1 - s.ringT) * (1 - s.ringT);
    frame.addWave(mx, my, L * (0.2 + 2.6 * easeOut3(s.ringT)), L * 0.2, 9 * fade * Math.min(1.2, size * 1.2));
  }
  return s.shake * (0.4 + 0.8 * size);
}

/**
 * Odlot przez tunel: okręt w (x, y), kurs `angle`; startTime — start ładowania.
 * drive — efekt sam prowadzi okręt w szczelinie (droga z osi dema; encja dostaje pozycję
 * i prędkość w `departFxPose`) — bez tego pozycję trzyma gra.
 */
export function planWarpDepartureFx(o) {
  const d = createWarpDeparture({
    x: o.x, y: o.y, angle: o.angle, hullLength: o.hullLength, hullWidth: o.hullWidth,
    startTime: o.startTime, palette: o.palette, entity: o.entity || null, id: o.id
  });
  d.pal = warpPalette(o.palette);
  d.pirate = !!o.pirate;
  d.drive = !!o.drive;
  d.sample = {};
  d.heraldSlot = newWarpSlot();
  d.seed = ((o.x * 0.011 + o.y * 0.017) % 100 + 100) % 100;
  d.hull = newHullFx();
  d.plasmaMode = null;
  // Ujście = dziób w chwili wejścia (świat).
  d.mouthX = d.x + d.dirX * d.mouth;
  d.mouthY = d.y + d.dirY * d.mouth;
  return d;
}

/** Pozycja okrętu w odlocie z osi dema (drive): świat, prędkość. */
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
  // Szczelina: otwiera się pod koniec ładowania, zamyka po wejściu okrętu.
  if (s.riftLen > 0.002 && s.riftOpen > 0.001) {
    const halfLen = d.seamLength * 0.5 * s.riftLen;
    const halfWidth = d.seamHalfWidth * s.riftOpen;
    const rx = d.cx - camX;
    const ry = d.cy - camY;
    frame.addRift(rx, ry, d.angle, halfLen, halfWidth, 1, pal, d.pirate ? 1 : 0, d.seed, Math.min(1, s.riftOpen * 1.4));
    frame.addSeam(rx, ry, d.angle, halfLen, Math.max(halfWidth, L * 0.02), 900 * s.riftOpen * d.sizeScale, 2600 * d.sizeScale);
    frame.addSeamLens(rx, ry, d.angle, halfLen * 1.05, d.seamHalfWidth * 3.5, 14 * s.riftOpen);
  }
  const mx = d.mouthX - camX;
  const my = d.mouthY - camY;
  if (t >= d.tDive) {
    if (s.flash > 0.001) frame.addFlash(mx, my, L * 0.45, s.flash * 1.4, pal, false);
    if (s.waveT >= 0 && s.waveT < 1) {
      frame.addWave(mx, my, L * (0.2 + 2.2 * easeOut3(s.waveT)), L * 0.18, 7 * (1 - s.waveT) ** 2);
    }
  }
  if (ship) {
    const c = Math.cos(ship.angle);
    const sn = Math.sin(ship.angle);
    // Linia ujścia w układzie kadłuba: widać tylko część za nią (x < linia).
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
    if (s.smear > 0.01) {
      const total = 1 + Math.min(2.2, s.speed * 0.1 / L);
      frame.addSmear(d.entity, ship.x - camX, ship.y - camY, ship.angle, L, d.hullWidth, total, s.smear, pal);
    }
  }
  return s.shake * (0.3 + 0.5 * d.sizeScale);
}
