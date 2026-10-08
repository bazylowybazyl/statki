// src/game/serviceTug.js
//
// HOLOWNIK SERWISOWY — logika (2026-10-08, decyzje użytkownika: okręt wsparcia wygląda jak frachtowiec w barwach
// serwisowych, przylatuje do gracza, naprawia go SWOIM rojem dronów z materiału we własnej ładowni, a statek, którego
// nie da się naprawić w polu — bo np. ma zniszczone silniki (src/game/engineDamage.js) — zabiera „na pakę” i wiezie
// do K-7). Bez three i DOM; gry dotyka tylko przez `env` (klej: src/game/serviceTugGame.js).
//
// FAZY (tug.phase):
//   arrive   — w tunelu „Nurtu” (wezwanie z Ziemi — WarpNurt prowadzi kadłub jako ducha) albo przed pierwszym krokiem;
//   approach — lot do PUNKTU TRZYMANIA: burta w burtę z celem, kurs celu, odstęp holdGap; prędkość celu dopasowana
//              (intencja z refV — pilot modelu lotu przesuwa punkt z celem);
//   service  — trzymanie pozycji; rój dronów naprawia cel (env.rig — rig sesji „Rój naprawczy”); koniec roju, brak
//              materiału albo brak roju → cel bez napędu głównego: load, inaczej depart;
//   load     — holownik wsuwa się POD cel (środek pokładu pod środkiem celu, kurs celu), zderzenia pary wyłączone;
//   clamp    — zaczepy: cel osiada na pokładzie (płynnie z bieżącej pozy na pozę pokładu), sterowanie celu zablokowane;
//   carry    — lot do K-7 z celem na pokładzie: odcinki planisty (travelNav.js — warp omija studnie, cel w studni
//              Ziemi — warp do brzegu, resztę napędem), skok warpem robi automat skoku gracza (env.warp — obraz skoku:
//              rulon, soczewka, ośrodek), holownik jedzie wtedy pod nim; napędem i przy K-7 prowadzi holownik;
//   turn     — przed halą: zawrót dziobem od hali (statek wjedzie do stanowiska rufą, dziobem ku bramie G-01 —
//              jak start kampanii) i cofanie na punkt wyładunku (środek pokładu na osi pasa stanowiska);
//   unload   — statek zjeżdża z pokładu pasem do stanowiska capital (ruch prowadzony), remont w doku
//              (restoreHull + zatrzaski silników), zaczepy puszczają;
//   depart   — odlot (POWRÓT tunelem; przy K-7 — od hali na zewnątrz);
//   done     — koniec (holownik usunięty z gry albo zniszczony).
//
// UKŁADY: gra (x w prawo, y w dół), kąt a: dziób (cos a, sin a), prawa burta (−sin a, cos a). Punkt lokalny okrętu
// (wzdłuż dzioba, w prawo) → świat: rot(a, lx, ly).

import { planTravelLeg, TRAVEL_TUNE } from './travelNav.js';

export const SERVICE_TUG = {
  // --- podejście i trzymanie pozycji ---
  holdGap: 420,            // [j.] odstęp burt holownika i celu przy naprawie
  approachArrival: 160,    // [j.] promień przylotu punktu trzymania (pilot hamuje do niego)
  holdTolerance: 650,      // [j.] w tylu od punktu trzymania — „na miejscu”
  holdSpeedTol: 70,        // [j/s] prędkość względem celu „na miejscu”
  holdCatchUp: 9000,       // [j.] dalej — lot w trybie podróżnym
  serviceMaxTime: 420,     // [s] najdłużej faza naprawy (bezpiecznik roju)
  serviceMinTime: 2.5,     // [s] trzymanie przed oceną (bez roju — chwila na komunikat)
  // --- załadunek („paka”) ---
  loadSpeed: 150,          // [j/s] wsuwanie pod cel
  loadPosTol: 70,          // [j.] środek pokładu pod środkiem celu
  loadAngleTol: 2.5 * Math.PI / 180,
  loadRelSpeedTol: 30,     // [j/s]
  loadTimeout: 90,         // [s] potem zaczepy i tak (cel ucieka RCS-ami — przyciągają go zaczepy)
  clampTime: 3.2,          // [s] zaczepy: cel osiada na pokładzie
  // --- lot z ładunkiem ---
  carrySpeed: 900,         // [j/s] napędem (odcinki 'drive')
  alignTolerance: 3 * Math.PI / 180,   // resztę kursu dociąga automat skoku (alignRate w locie)
  alignSpin: 0.08,         // [rad/s]
  alignTimeout: 30,        // [s] potem skok i tak (kurs skoku = namiar odcinka)
  minWarp: 40000,          // [j.] krótszy odcinek — napędem
  // --- wyładunek w K-7 ---
  standOut: 2400,          // [j.] środek pokładu za końcem pasa stanowiska (z huba ponad z1 pasa)
  preStand: 7000,          // [j.] punkt zawrotu: tyle dalej na osi pasa (od hali)
  standTol: 140,           // [j.]
  standAngleTol: 2.5 * Math.PI / 180,
  backSpeed: 320,          // [j/s] cofanie na punkt wyładunku
  slideSpeed: 650,         // [j/s] zjazd statku do stanowiska (ruch prowadzony, wygładzony)
  slideMinTime: 6,         // [s]
  // --- pokład (ułamki płótna sprite'a holownika: wzdłuż — długości, w bok — połowy długości płótna 2:1, czyli jego
  //     wysokości; zastępczy sprite: ładownia frachtowca 648 × 344 px, środek −128, +11 px płótna 1774 × 887) ---
  deckAlong: -0.072,
  deckSide: 0.0124,
  // --- podejście dwuetapowe: obrót do kursu celu z dala (zapas na zamiatanie końcami kadłuba), potem wsunięcie
  //     bokiem na punkt trzymania z zablokowanym kursem ---
  turnClear: 700,          // [j.] zapas między promieniem obrotu holownika a obrysem celu
  turnTol: 3 * Math.PI / 180,
  sideSpeed: 260           // [j/s] wsuwanie bokiem na punkt trzymania (względem celu)
};

const TAU = Math.PI * 2;

export function wrapTugAngle(a) {
  let x = Number(a) || 0;
  x -= Math.round(x / TAU) * TAU;
  return x;
}

function smooth01(t) {
  const x = t < 0 ? 0 : (t > 1 ? 1 : t);
  return x * x * (3 - 2 * x);
}

/** Poza encji (gracz: pos/vel, NPC: x/y/vx/vy) do `out` { x, y, vx, vy, a, w }. */
export function tugPose(e, out) {
  out.x = e?.pos && typeof e.pos.x === 'number' ? e.pos.x : (Number(e?.x) || 0);
  out.y = e?.pos && typeof e.pos.y === 'number' ? e.pos.y : (Number(e?.y) || 0);
  out.vx = e?.vel && typeof e.vel.x === 'number' ? e.vel.x : (Number(e?.vx) || 0);
  out.vy = e?.vel && typeof e.vel.y === 'number' ? e.vel.y : (Number(e?.vy) || 0);
  out.a = Number(e?.angle) || 0;
  out.w = Number(e?.angVel) || 0;
  return out;
}

// Obrys kadłuba belkowego (siatka węzłów konstrukcji, iz = 0) w komórkach — raz na kadłub (rekord beamHull).
const _extent = new WeakMap();
function hullExtentCells(h) {
  let ex = _extent.get(h);
  if (ex) return ex;
  const s = h.body?.nodeStore;
  if (!s || !(s.count > 0)) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < s.count; i++) {
    if (s.iz && s.iz[i] !== 0) continue;
    const x = s.ix[i], y = s.iy[i];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!(x1 >= x0)) return null;
  ex = { nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
  _extent.set(h, ex);
  return ex;
}

/**
 * Wymiary kadłuba [j.]: { length, beam } — OBRYS (węzły konstrukcji kadłuba belkowego; bez kadłuba — w/h)
 * i `canvas` — długość płótna sprite'a (pokład: ułamki SERVICE_TUG.deck* liczone od płótna).
 */
export function tugHullSize(e, out = { length: 0, beam: 0, canvas: 0 }) {
  const h = e?.beamHull;
  if (h && h.entity === e && h.srcWidth > 0 && h.scale > 0) {
    out.canvas = h.srcWidth * h.scale;
    const ex = hullExtentCells(h);
    const cs = Number(h.body?.cellSize) || 0;
    if (ex && cs > 0) {
      out.length = ex.nx * cs;
      out.beam = ex.ny * cs;
    } else {
      out.length = out.canvas;
      out.beam = h.srcHeight * h.scale;
    }
  } else {
    const sc = Number(e?.visual?.spriteScale) || 1;
    out.length = Math.max(1, (Number(e?.w) || Number(e?.radius) * 2 || 400) * sc);
    out.beam = Math.max(1, (Number(e?.h) || Number(e?.radius) || 200) * sc);
    out.canvas = out.length;
  }
  return out;
}

/** Punkt lokalny okrętu (lx wzdłuż dzioba, ly w prawo) → przesunięcie w świecie gry. */
export function rotLocal(a, lx, ly, out) {
  const c = Math.cos(a), s = Math.sin(a);
  out.x = c * lx - s * ly;
  out.y = s * lx + c * ly;
  return out;
}

/** Środek pokładu holownika w jego układzie lokalnym [j.] (ułamki płótna sprite'a). */
export function tugDeckLocal(size, tune = SERVICE_TUG, out = { x: 0, y: 0 }) {
  const L = size.canvas > 0 ? size.canvas : size.length;
  out.x = L * tune.deckAlong;
  out.y = L * 0.5 * tune.deckSide;
  return out;
}

const _r = { x: 0, y: 0 };

/**
 * Punkt trzymania przy celu: burta w burtę po stronie `side` (±1 — prawa / lewa burta celu), kurs celu.
 * out: { x, y, a }.
 */
export function tugHoldPoint(targetPose, targetSize, tugSize, side, tune = SERVICE_TUG, out = { x: 0, y: 0, a: 0 }) {
  const off = (targetSize.beam + tugSize.beam) * 0.5 + tune.holdGap;
  rotLocal(targetPose.a, 0, side * off, _r);
  out.x = targetPose.x + _r.x;
  out.y = targetPose.y + _r.y;
  out.a = targetPose.a;
  return out;
}

/** Środek holownika, przy którym środek pokładu leży pod środkiem celu (kurs celu). out: { x, y, a }. */
export function tugLoadPoint(targetPose, deck, out = { x: 0, y: 0, a: 0 }) {
  rotLocal(targetPose.a, deck.x, deck.y, _r);
  out.x = targetPose.x - _r.x;
  out.y = targetPose.y - _r.y;
  out.a = targetPose.a;
  return out;
}

/** Poza ładunku na pokładzie (środek celu nad środkiem pokładu, kurs holownika + rel). out: { x, y, a }. */
export function tugCargoPose(tugP, deck, rel = 0, out = { x: 0, y: 0, a: 0 }) {
  rotLocal(tugP.a, deck.x, deck.y, _r);
  out.x = tugP.x + _r.x;
  out.y = tugP.y + _r.y;
  out.a = wrapTugAngle(tugP.a + rel);
  return out;
}

/**
 * Plan wyładunku przy hali K-7 (hub: x wzdłuż ringu, z na zewnątrz; env podaje przeliczenie hub → gra):
 *   stand — środek POKŁADU na osi pasa stanowiska, standOut za końcem pasa; holownik dziobem od hali;
 *   pre   — punkt zawrotu: preStand dalej na tej osi;
 *   slide — punkty zjazdu ładunku: koniec pasa (z1) → stanowisko (rufą naprzód, dziobem ku bramie).
 * hall = { toGame(hx, hz, out), outAngle (kurs gry „od hali”), berth: { x, z, angle (gra) }, laneEnd (z1 pasa) }.
 */
export function planK7Unload(hall, tugSize, deck, tune = SERVICE_TUG) {
  const bx = hall.berth.x, bz = hall.berth.z;
  const standZ = hall.laneEnd + tune.standOut;
  const deckStand = hall.toGame(bx, standZ, { x: 0, y: 0 });
  const outA = hall.outAngle;
  // Środek holownika = środek pokładu − rot(deck) przy kursie od hali.
  rotLocal(outA, deck.x, deck.y, _r);
  const stand = { x: deckStand.x - _r.x, y: deckStand.y - _r.y, a: outA };
  const preDeck = hall.toGame(bx, standZ + tune.preStand, { x: 0, y: 0 });
  const pre = { x: preDeck.x - _r.x, y: preDeck.y - _r.y, a: outA };
  const laneEnd = hall.toGame(bx, hall.laneEnd, { x: 0, y: 0 });
  const berth = hall.toGame(bx, bz, { x: 0, y: 0 });
  // Statek dziobem ku bramie (kurs stanowiska + π — jak `_dockPlace` fabuły): rufą naprzód w głąb hali.
  const shipA = wrapTugAngle(hall.berth.angle + Math.PI);
  return {
    stand, pre, deckStand,
    slide: [
      { x: deckStand.x, y: deckStand.y, a: shipA },
      { x: laneEnd.x, y: laneEnd.y, a: shipA },
      { x: berth.x, y: berth.y, a: shipA }
    ]
  };
}

/** Długość łamanej punktów { x, y }. */
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/** Punkt łamanej w ułamku drogi u ∈ [0, 1] (kąt — z punktów; tu stały). out: { x, y, a }. */
export function samplePolyline(pts, u, out = { x: 0, y: 0, a: 0 }) {
  const L = polylineLength(pts);
  let d = Math.max(0, Math.min(1, u)) * L;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= seg || i === pts.length - 1) {
      const t = seg > 1e-9 ? Math.min(1, d / seg) : 1;
      out.x = a.x + (b.x - a.x) * t;
      out.y = a.y + (b.y - a.y) * t;
      out.a = a.a + wrapTugAngle(b.a - a.a) * t;
      return out;
    }
    d -= seg;
  }
  const last = pts[pts.length - 1];
  out.x = last.x; out.y = last.y; out.a = last.a;
  return out;
}

// ============================================================================ stan

export const TUG_PHASE = Object.freeze({
  ARRIVE: 'arrive', APPROACH: 'approach', SERVICE: 'service', LOAD: 'load', CLAMP: 'clamp', CARRY: 'carry',
  TURN: 'turn', UNLOAD: 'unload', DEPART: 'depart', DONE: 'done'
});

/**
 * Nowa misja holownika. opts: { carry (true — wolno zabrać cel do K-7), repair (true — rój), side (±1 albo 0 — sam
 * wybierze) }.
 */
export function createServiceTug(npc, target, opts = {}) {
  return {
    npc,
    target,
    phase: TUG_PHASE.ARRIVE,
    t: 0,                    // czas fazy [s]
    time: 0,
    side: opts.side === 1 || opts.side === -1 ? opts.side : 0,
    allowCarry: opts.carry !== false,
    allowRepair: opts.repair !== false,
    rig: null,               // uchwyt roju (env.rig)
    rigDone: '',             // powód końca roju
    carried: false,          // cel na pokładzie (zaczepy)
    clampFrom: { x: 0, y: 0, a: 0 },
    rel: 0,                  // kurs ładunku względem holownika
    overlap: false,          // zderzenia holownik ↔ cel wyłączone (załadunek i dalej)
    backing: false,          // zawrót przy K-7 skończony — cofanie na punkt wyładunku
    sliding: false,          // podejście: etap 2 (wsuwanie bokiem z zablokowanym kursem)
    leg: null,               // odcinek lotu z ładunkiem { x, y, kind, final }
    legPhase: '',            // 'align' | 'warp' | 'drive'
    legT: 0,
    unload: null,            // plan wyładunku (planK7Unload)
    slideU: 0,
    slideLen: 0,
    slideTime: 0,
    reason: '',              // dlaczego koniec
    msgs: 0
  };
}

const _tp = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0 };
const _cp = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0 };
const _ts = { length: 0, beam: 0 };
const _cs = { length: 0, beam: 0 };
const _deck = { x: 0, y: 0 };
const _pt = { x: 0, y: 0, a: 0 };
const _cargo = { x: 0, y: 0, a: 0 };

function setPhase(tug, phase, env, msg = '') {
  tug.phase = phase;
  tug.t = 0;
  if (msg) env.say?.(msg, tug);
}

/**
 * Krok misji (czas gry). env:
 *   alive(e), ghost(npc) — w tunelu „Nurtu” (duch), destroyed(e)
 *   arrive(npc, x, y, opts) — intencja modelu lotu (setFlightArrive), stop(npc, face) — hamuj (setFlightStop)
 *   needsTow(target) — cel bez napędu głównego (engineDamage.js)
 *   rig: { start(npc, target) → uchwyt | null, status(uchwyt) → '' (pracuje) | powód końca, stop(uchwyt) }
 *   lockCargo(tug, on) — zaczepy: blokada sterowania celu i zderzeń pary (on) / zwolnienie (off)
 *   placeCargo(target, x, y, a, vx, vy) — poza ładunku (krok fizyki po NPC)
 *   route(tug) → { target: { x, y }, waypoints, wells } — trasa do punktu zawrotu przy K-7 (null — brak K-7)
 *   hall(tug) → opis hali do planK7Unload (null — brak K-7)
 *   warpStart(tug, leg, bearing) → bool, warpBusy() → bool (skok gracza z ładunkiem trwa), warpStep(tug, leg)
 *   remont(target), depart(npc, angle | NaN), say(text, tug), returning(npc) — POWRÓT skrzydła prowadzi holownik
 */
export function stepServiceTug(tug, env, dt, tune = SERVICE_TUG) {
  const h = Math.max(0, Number(dt) || 0);
  if (!(h > 0) || tug.phase === TUG_PHASE.DONE) return tug.phase;
  tug.t += h;
  tug.time += h;
  const npc = tug.npc;
  const target = tug.target;
  if (!env.alive(npc)) {
    releaseCargo(tug, env);
    if (tug.rig) { env.rig?.stop(tug.rig); tug.rig = null; }
    tug.reason = tug.reason || 'lost';
    tug.phase = TUG_PHASE.DONE;
    return tug.phase;
  }
  if (tug.phase === TUG_PHASE.DEPART) return tug.phase;
  // POWRÓT skrzydła (rozkaz gracza) prowadzi holownik sam — misja kończy się bez własnego odlotu.
  if (env.returning?.(npc)) {
    releaseCargo(tug, env);
    if (tug.rig) { env.rig?.stop(tug.rig); tug.rig = null; }
    tug.reason = tug.reason || 'recalled';
    tug.phase = TUG_PHASE.DEPART;
    tug.t = 0;
    return tug.phase;
  }
  const targetOk = env.alive(target);
  if (!targetOk && tug.phase !== TUG_PHASE.ARRIVE) {
    releaseCargo(tug, env);
    beginDepart(tug, env, NaN, 'target');
    return tug.phase;
  }
  tugPose(npc, _tp);
  tugHullSize(npc, _ts);
  tugDeckLocal(_ts, tune, _deck);
  if (targetOk) { tugPose(target, _cp); tugHullSize(target, _cs); }

  switch (tug.phase) {
    case TUG_PHASE.ARRIVE: {
      if (env.ghost(npc)) break;
      if (!targetOk) { beginDepart(tug, env, NaN, 'target'); break; }
      setPhase(tug, TUG_PHASE.APPROACH, env, 'HOLOWNIK SERWISOWY: NA MIEJSCU — PODCHODZĘ');
      break;
    }
    case TUG_PHASE.APPROACH:
    case TUG_PHASE.SERVICE: {
      if (!tug.side) {
        // Strona, po której holownik już jest (mniej manewrów).
        const rx = -Math.sin(_cp.a), ry = Math.cos(_cp.a);
        tug.side = ((_tp.x - _cp.x) * rx + (_tp.y - _cp.y) * ry) >= 0 ? 1 : -1;
      }
      tugHoldPoint(_cp, _cs, _ts, tug.side, tune, _pt);
      const relV = Math.hypot(_tp.vx - _cp.vx, _tp.vy - _cp.vy);
      if (tug.phase === TUG_PHASE.APPROACH && !tug.sliding) {
        // Etap 1: punkt obrotu dalej na tej samej burcie — 5-km kadłub obraca się do kursu celu tam, gdzie końcami
        // nie sięgnie statku (dawniej obrót przy burcie zmiatał go i rozpędzał).
        const turnR = Math.hypot(_ts.length, _ts.beam) * 0.5 + Math.hypot(_cs.length, _cs.beam) * 0.5 + tune.turnClear;
        const holdOff = (_cs.beam + _ts.beam) * 0.5 + tune.holdGap;
        const extra = Math.max(0, turnR - holdOff);
        rotLocal(_cp.a, 0, tug.side * extra, _r);
        const px = _pt.x + _r.x, py = _pt.y + _r.y;
        const dPre = Math.hypot(px - _tp.x, py - _tp.y);
        env.arrive(npc, px, py, {
          arrival: tune.approachArrival, refVx: _cp.vx, refVy: _cp.vy, face: _pt.a,
          faceNear: _ts.length, faceFar: tune.holdCatchUp + _ts.length,
          speedMode: dPre > tune.holdCatchUp ? 'travel' : 'cruise'
        });
        const angErr = Math.abs(wrapTugAngle(_pt.a - _tp.a));
        if (dPre <= tune.holdTolerance && angErr <= tune.turnTol && relV <= tune.holdSpeedTol) tug.sliding = true;
        break;
      }
      // Etap 2 i trzymanie pozycji: kurs zablokowany (bez obrotu przy burcie), podejście bokiem.
      const dist = Math.hypot(_pt.x - _tp.x, _pt.y - _tp.y);
      env.arrive(npc, _pt.x, _pt.y, {
        arrival: tune.approachArrival, refVx: _cp.vx, refVy: _cp.vy, face: _pt.a, faceLock: true,
        approachCap: tune.sideSpeed
      });
      const onStation = dist <= tune.holdTolerance && relV <= tune.holdSpeedTol;
      if (tug.phase === TUG_PHASE.APPROACH) {
        if (onStation) {
          setPhase(tug, TUG_PHASE.SERVICE, env);
          if (tug.allowRepair && env.rig) {
            tug.rig = env.rig.start(npc, target);
            env.say?.(tug.rig ? 'HOLOWNIK: DRONY NAPRAWCZE W DRODZE' : 'HOLOWNIK: RÓJ NAPRAWCZY NIEDOSTĘPNY', tug);
          }
        }
        break;
      }
      // service: rój pracuje; trzymanie pozycji jak wyżej.
      let done = '';
      if (tug.rig) {
        done = env.rig.status(tug.rig) || '';
        if (!done && tug.t >= tune.serviceMaxTime) done = 'timeout';
      } else if (tug.t >= tune.serviceMinTime) {
        done = 'norig';
      }
      if (done) {
        tug.rigDone = done;
        if (tug.rig) { env.rig.stop(tug.rig); tug.rig = null; }
        if (env.needsTow(target)) {
          const hall = tug.allowCarry ? env.hall(tug) : null;
          if (hall) {
            tug.unload = planK7Unload(hall, _ts, _deck, tune);
            setPhase(tug, TUG_PHASE.LOAD, env, 'HOLOWNIK: NAPĘD NIE DO NAPRAWY W POLU — BIERZEMY CIĘ NA POKŁAD');
            tug.overlap = true;
            env.lockCargo(tug, 'overlap');
          } else {
            beginDepart(tug, env, NaN, 'notow');
            env.say?.('HOLOWNIK: TRANSPORT DO K-7 NIEDOSTĘPNY — ODLATUJĘ', tug);
          }
        } else {
          beginDepart(tug, env, NaN, 'repaired');
          env.say?.('HOLOWNIK: SERWIS ZAKOŃCZONY — ODLATUJĘ', tug);
        }
      }
      break;
    }
    case TUG_PHASE.LOAD: {
      tugLoadPoint(_cp, _deck, _pt);
      const dist = Math.hypot(_pt.x - _tp.x, _pt.y - _tp.y);
      // Prędkość celu przechodzi (refV), limit tylko podejścia względem niego (dryfujący statek bez napędu).
      env.arrive(npc, _pt.x, _pt.y, {
        arrival: 0, refVx: _cp.vx, refVy: _cp.vy, face: _pt.a, faceLock: true, approachCap: tune.loadSpeed
      });
      const angErr = Math.abs(wrapTugAngle(_pt.a - _tp.a));
      const relV = Math.hypot(_tp.vx - _cp.vx, _tp.vy - _cp.vy);
      if ((dist <= tune.loadPosTol && angErr <= tune.loadAngleTol && relV <= tune.loadRelSpeedTol)
        || tug.t >= tune.loadTimeout) {
        // Poza celu w układzie holownika przy zaczepach — osiada z niej płynnie na pokład (i jedzie z holownikiem).
        const c = Math.cos(_tp.a), sn = Math.sin(_tp.a);
        const dx = _cp.x - _tp.x, dy = _cp.y - _tp.y;
        tug.clampFrom.x = c * dx + sn * dy;
        tug.clampFrom.y = -sn * dx + c * dy;
        tug.clampFrom.a = wrapTugAngle(_cp.a - _tp.a);
        tug.carried = true;
        env.lockCargo(tug, 'clamp');
        setPhase(tug, TUG_PHASE.CLAMP, env, 'HOLOWNIK: ZACZEPY');
      }
      break;
    }
    case TUG_PHASE.CLAMP: {
      // Holownik trzyma kurs i prędkość (hamuje do zera — statek stoi na pokładzie).
      env.stop(npc, _tp.a);
      if (tug.t >= tune.clampTime) {
        setPhase(tug, TUG_PHASE.CARRY, env, 'HOLOWNIK: STATEK NA POKŁADZIE — KURS NA K-7');
        tug.leg = null;
      }
      break;
    }
    case TUG_PHASE.CARRY:
      stepCarry(tug, env, h, tune);
      break;
    case TUG_PHASE.TURN:
      stepTurn(tug, env, h, tune);
      break;
    case TUG_PHASE.UNLOAD:
      stepUnload(tug, env, h, tune);
      break;
    default:
      break;
  }
  return tug.phase;
}

/**
 * Poza ładunku w tym kroku (po integracji holownika — klej woła po npcStep): zaczepy (osiadanie), pokład,
 * zjazd do stanowiska. Zwraca pozę { x, y, a } albo null (bez ładunku).
 */
export function serviceTugCargoPose(tug, tune = SERVICE_TUG, out = _cargo) {
  if (!tug.carried) return null;
  if (tug.phase === TUG_PHASE.UNLOAD && tug.unload) return samplePolyline(tug.unload.slide, smooth01(tug.slideU), out);
  tugPose(tug.npc, _tp);
  tugHullSize(tug.npc, _ts);
  tugDeckLocal(_ts, tune, _deck);
  if (tug.phase === TUG_PHASE.CLAMP) {
    // Osiadanie w układzie holownika: od pozy przy zaczepach do środka pokładu.
    const w = smooth01(tug.t / Math.max(1e-3, tune.clampTime));
    const f = tug.clampFrom;
    const lx = f.x + (_deck.x - f.x) * w;
    const ly = f.y + (_deck.y - f.y) * w;
    rotLocal(_tp.a, lx, ly, _r);
    out.x = _tp.x + _r.x;
    out.y = _tp.y + _r.y;
    out.a = wrapTugAngle(_tp.a + f.a + wrapTugAngle(tug.rel - f.a) * w);
    return out;
  }
  return tugCargoPose(_tp, _deck, tug.rel, out);
}

/** Poza holownika pod ładunkiem (skok gracza z ładunkiem: prowadzi gracz). out: { x, y, a }. */
export function tugUnderCargo(cargoP, deck, rel = 0, out = { x: 0, y: 0, a: 0 }) {
  const a = wrapTugAngle(cargoP.a - rel);
  rotLocal(a, deck.x, deck.y, _r);
  out.x = cargoP.x - _r.x;
  out.y = cargoP.y - _r.y;
  out.a = a;
  return out;
}

function releaseCargo(tug, env) {
  const was = tug.carried || tug.overlap;
  tug.carried = false;
  tug.overlap = false;
  if (was) env.lockCargo(tug, 'off');
}

function beginDepart(tug, env, angle, reason) {
  if (tug.rig) { env.rig?.stop(tug.rig); tug.rig = null; }
  tug.reason = tug.reason || reason;
  tug.phase = TUG_PHASE.DEPART;
  tug.t = 0;
  env.depart(tug.npc, angle);
}

function stepCarry(tug, env, h, tune) {
  const npc = tug.npc;
  if (tug.legPhase === 'warp') {
    // Skok gracza z ładunkiem — holownik jedzie pod nim (klej: placeTugUnderCargo); koniec — następny odcinek.
    env.warpStep?.(tug, tug.leg);
    if (!env.warpBusy()) { tug.leg = null; tug.legPhase = ''; }
    return;
  }
  const route = tug.unload ? env.route(tug, tug.unload.pre) : null;
  if (!route) {
    // K-7 niedostępna (planeta bez ringu?) — ładunek zostaje, holownik stoi.
    env.stop(npc, _tp.a);
    return;
  }
  if (!tug.leg) {
    const leg = planTravelLeg(_tp, route.target, route.waypoints, route.wells, { minWarp: tune.minWarp, warpOk: true });
    if (!leg) {
      // Na miejscu (punkt zawrotu) — zawrót i cofanie na punkt wyładunku.
      tug.backing = false;
      setPhase(tug, TUG_PHASE.TURN, env, 'HOLOWNIK: K-7 — USTAWIAM SIĘ DO WYŁADUNKU');
      return;
    }
    tug.leg = leg;
    tug.legPhase = leg.kind === 'warp' ? 'align' : 'drive';
    tug.legT = 0;
  }
  const leg = tug.leg;
  tug.legT += h;
  if (tug.legPhase === 'drive') {
    env.arrive(npc, leg.x, leg.y, {
      arrival: leg.final ? 600 : TRAVEL_TUNE.arriveRadius * 0.3, speedLimit: tune.carrySpeed, speedMode: 'travel'
    });
    if (Math.hypot(leg.x - _tp.x, leg.y - _tp.y) <= (leg.final ? 900 : TRAVEL_TUNE.arriveRadius)) tug.leg = null;
    return;
  }
  // align → skok
  const bearing = Math.atan2(leg.y - _tp.y, leg.x - _tp.x);
  env.stop(npc, bearing);
  const err = Math.abs(wrapTugAngle(bearing - _tp.a));
  if ((err <= tune.alignTolerance && Math.abs(_tp.w) <= tune.alignSpin) || tug.legT >= tune.alignTimeout) {
    if (env.warpStart(tug, leg, bearing)) {
      tug.legPhase = 'warp';
      env.say?.('HOLOWNIK: SKOK', tug);
    }
  }
}

function stepTurn(tug, env, h, tune) {
  const npc = tug.npc;
  const u = tug.unload;
  if (!u) { tug.phase = TUG_PHASE.CARRY; tug.leg = null; return; }
  // Najpierw punkt zawrotu z kursem od hali, potem cofanie (kurs stoi) na punkt wyładunku.
  const toPre = Math.hypot(u.pre.x - _tp.x, u.pre.y - _tp.y);
  const angErr = Math.abs(wrapTugAngle(u.stand.a - _tp.a));
  if (!tug.backing) {
    env.arrive(npc, u.pre.x, u.pre.y, { arrival: 200, face: u.pre.a, faceNear: 1e9, faceFar: 2e9, speedLimit: tune.carrySpeed });
    if (toPre <= 900 && angErr <= tune.standAngleTol * 2) tug.backing = true;
    return;
  }
  env.arrive(npc, u.stand.x, u.stand.y, {
    arrival: 0, face: u.stand.a, faceLock: true, backFace: true, speedLimit: tune.backSpeed
  });
  const d = Math.hypot(u.stand.x - _tp.x, u.stand.y - _tp.y);
  const v = Math.hypot(_tp.vx, _tp.vy);
  if (d <= tune.standTol && angErr <= tune.standAngleTol && v <= 25) {
    tug.slideLen = polylineLength(u.slide);
    tug.slideTime = Math.max(tune.slideMinTime, tug.slideLen / Math.max(1, tune.slideSpeed));
    tug.slideU = 0;
    // Pierwszy punkt zjazdu = bieżąca poza ładunku (zaczepy puszczają tu, gdzie statek stoi).
    const cargo = serviceTugCargoPose(tug, tune, _pt);
    if (cargo) { u.slide[0].x = cargo.x; u.slide[0].y = cargo.y; u.slide[0].a = cargo.a; }
    setPhase(tug, TUG_PHASE.UNLOAD, env, 'HOLOWNIK: WYŁADUNEK — STANOWISKO ' + (env.berthId?.(tug) || 'C-01'));
  }
}

function stepUnload(tug, env, h, tune) {
  const u = tug.unload;
  env.stop(tug.npc, u.stand.a);
  // Pozę zjazdu stawia klej po npcStep (serviceTugCargoPose); tu postęp i koniec.
  tug.slideU = Math.min(1, tug.slideU + h / Math.max(1e-3, tug.slideTime));
  if (tug.slideU >= 1) {
    const end = u.slide[u.slide.length - 1];
    env.placeCargo(tug.target, end.x, end.y, end.a, true);
    env.remont(tug.target);
    releaseCargo(tug, env);
    env.say?.('KONTROLA K-7: STATEK W STANOWISKU — REMONT ZAKOŃCZONY', tug);
    // Odlot od hali na zewnątrz (dziób holownika już tam patrzy).
    beginDepart(tug, env, u.stand.a, 'delivered');
  }
}
