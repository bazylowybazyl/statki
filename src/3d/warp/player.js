// src/3d/warp/player.js
//
// Skok GRACZA w języku „Nurtu” (dema/warp-webgpu/scenes.js: createTripScene / createFreeScene,
// iteracja 3 — 2026-10-03) na automacie warpa gry (index.html: `warp.state` idle → charging →
// active → idle + rampa wyjścia `warp.exitRamp`). Czysty moduł (bez three, bez DOM): co klatkę
// dostaje stan gry, wypełnia klatkę efektu (frame.js) — bańka w ośrodku, gwiazdy, rulon, fale,
// błyski, żar kadłuba.
//
// Fazy (widok ze środka):
//   ŁADOWANIE  bańka rośnie: płaty ośrodka (turkus z przodu, pomarańcz z tyłu), gwiazdy
//              wydłużają się płasko (0,32·ładowanie²); RULON zwija tło w walec ∩ wokół kursu
//              i zawija je do statku (lejek, jedna faza — rulon.js). Kurs stoi od ładowania
//              (rozgrywka: bramka kursu). Ładowanie gry trwa `warp.chargeTime` (0,8 s) — krzywe
//              dema (3 s) biegną po ułamku ładowania; przerwane ładowanie zwija bańkę w ~0,25 s.
//   SKOK       kop: gwiazdy strzelają w smugi z przestrzałem ×1,4 → 1, rulon szarpie (+16%),
//              fala w punkcie skoku, błysk za rufą; przepływ ośrodka rośnie z prędkością gry.
//   PODRÓŻ     opływ bańki, kopuła na obrysie kieszeni, pomarańczowe „V” warkocza w lejku;
//              przepływ = prędkość WIDOCZNA (bieg I 16 tys., wyżej 21 tys. j/s — WARP_FLOW).
//   WYJŚCIE    = PRZYLOT jak u okrętów NPC (warpDrive.js: WARP_EXIT, rampa rozgrywki):
//              ZWOLNIENIE (rulon się rozwija, smugi gwiazd i ośrodka gasną, front od dziobu),
//              WLOT (statek naprawdę leci z prędkością wlotu, wysuwa się przed kamerę — rig),
//              HAMOWANIE (błysk dziobu, blask, fala, żar, iskry ośrodka lecą dalej, bańka zapada
//              się od dziobu); po zatrzymaniu ośrodek gaśnie.
// Kamerą rządzi rig gry (cameraRig.js) — kop, oddalenie, statek na środku lejka i wysunięcie
// przy wyjściu są tam; tu zostaje wstrząs przez `onShake`.

import { warpPalette, heatColor } from './palette.js';
import { WARP_EXIT, warpArrivalSpeed, warpBrakeTime, warpBrakeBubbleFront, warpRulonBend, warpSizeScale } from '../../game/warpDrive.js';

/** Kształt bańki względem kadłuba (demo: BUBBLE_SHAPE). */
export const WARP_BUBBLE = Object.freeze({ radiusK: 0.62, asp: 1.35 });
/**
 * Widoczna prędkość przepływu ośrodka w podróży [j/s]. Warp ma JEDNĄ prędkość (QOL 2026-10-03 — biegi
 * przeniesione do PRZELOTU), więc przepływ to `travel` (bieg II dema); gear1 / gear2 — wartości dema.
 */
export const WARP_FLOW = Object.freeze({ gear1: 16000, gear2: 21000, travel: 21000, exitRest: 160 });
/** Kadłub referencyjny dema (Atlas) — fale skalują się długością kadłuba. */
const REF_LENGTH = 1800;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };
const lerp = (a, b, t) => a + (b - a) * t;
/** Impuls 0 → 1 → 0 (narasta w `rise`, gaśnie z czasem `fall`). */
export const pulse = (t, rise, fall) => (t <= 0 ? 0 : (1 - Math.exp(-t / rise)) * Math.exp(-t / fall));

/** Rozciągnięcie gwiazd: ładowanie → przestrzał przy kopnięciu → lot → gaśnięcie przy wyjściu (demo 1:1). */
export function warpStarStretch(tau, tKick, tExit, charge, speedFrac, exitDur = WARP_EXIT.slow) {
  if (tau < tKick) return 0.32 * charge * charge;
  let s;
  const k = tau - tKick;
  if (k < 0.12) s = lerp(0.32, 1.4, easeOut3(k / 0.12));
  else s = lerp(1.4, 1.0, smooth(0.12, 0.55, k));
  s *= 0.55 + 0.45 * clamp01(speedFrac);
  if (tau >= tExit) {
    const u = (tau - tExit) / exitDur;
    s *= u >= 1 ? 0 : Math.pow(1 - u, 1.6);
  }
  return s;
}

const NEVER = -1e9;

/**
 * Stan skoku gracza. advance(t, dt, game, map, medium) → ruch kamery ośrodka → fill(...):
 *   game = { state: 'idle'|'charging'|'active', charge (0..1), chargeTime, gear, speed (j/s),
 *            angle (kurs), x, y (poza renderu kadłuba, świat), length, width (kadłub, j.),
 *            palette (id), entity, vRelX/Y, exitRamp (warp.exitRamp gry albo null) }
 *   map   = { camX, camY } — kamera gry (pozycje względem niej).
 */
export class WarpPlayerFx {
  constructor() {
    this.bubble = null;   // przegródka ośrodka (tworzy sterownik: newWarpSlot)
    this.push = null;     // przegródka iskier hamowania (tworzy sterownik)
    this.hull = { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
    this.onShake = null;  // (mag px, dur s) — wstrząs kamery
    this.ramp = { slow: WARP_EXIT.slow, coast: WARP_EXIT.coast, brake: 0.2, vArr: 16000, v0: 16000, tBrake: 1.15, tHalt: 1.35 };
    this.reset();
  }

  reset() {
    this.mode = 'idle';          // idle | charging | warp | exit
    this.charge = 0;
    this.kickT = NEVER;
    this.exitT = NEVER;
    this.gearT = NEVER;
    this.gear = 1;
    this.kickMX = 0;             // punkt skoku w przestrzeni ośrodka (widocznej)
    this.kickMY = 0;
    this.flowAtExit = 0;
    this.flowGear = WARP_FLOW.travel;
    this.chargeBoost = 1;
    this.chargeK = 1;
    this.angle = 0;
    this.brakeShaken = false;
    this.rulonBend = 0;          // zwinięcie rulonu (sterownik → RULON)
    this.rulonField = 0;         // lejek
    this.hull.on = false;
  }

  /** Czy skok gracza czegoś jeszcze potrzebuje (ośrodek, gwiazdy, kadłub). */
  get active() {
    return this.mode !== 'idle' || this.charge > 0.001;
  }

  /** Wiek wyjścia [s] (klatka efektu). */
  exitAge(t) {
    return t - this.exitT;
  }

  visibleFlowAt(t) {
    return lerp(900, this.flowGear, easeOut3((t - this.kickT) / 0.45));
  }

  /**
   * Prędkość WIDOCZNA kamery w ośrodku wzdłuż kursu [j/s] albo null (ośrodek idzie za prawdziwą
   * kamerą gry). Skok: 900 → bieg w 0,45 s; wyjście: w zwolnieniu z prędkości widocznej do
   * prędkości wlotu (= prawdziwa prędkość statku na końcu zwolnienia), dalej prawdziwa kamera —
   * statek naprawdę leci i hamuje (rampa rozgrywki).
   */
  visibleFlow(t) {
    if (this.mode === 'warp') return this.visibleFlowAt(t);
    if (this.mode === 'exit') {
      const tau = t - this.exitT;
      if (tau < this.ramp.slow) return lerp(this.flowAtExit, this.ramp.vArr, smooth(0, this.ramp.slow, tau));
    }
    return null;
  }

  advance(t, dt, game, map, medium) {
    const state = game.state === 'active' ? 'active' : (game.state === 'charging' ? 'charging' : 'idle');
    if (state === 'charging') {
      if (this.mode !== 'charging') this.mode = 'charging';
      this.charge = clamp01(game.charge);
      // Ładowanie gry trwa `chargeTime` (0,8 s), w demie 3 s: naprężenie ×k (całkowane przez całe
      // ładowanie), wzbudzenie (zanik 1,1 s) ×k^0,6.
      const ct = Number(game.chargeTime) > 0 ? game.chargeTime : 3;
      this.chargeK = Math.max(1, Math.min(4, 3.0 / ct));
      this.chargeBoost = Math.pow(this.chargeK, 0.6);
    } else if (state === 'active') {
      if (this.mode !== 'warp') {
        this.mode = 'warp';
        this.kickT = t;
        this.gear = 1;
        this.gearT = NEVER;
        this.flowGear = WARP_FLOW.travel;
        this.kickMX = medium.camMX + (game.x - map.camX);
        this.kickMY = medium.camMY + (game.y - map.camY);
        if (this.onShake) this.onShake(18, 0.3);   // ~9 px (cameraRig: mag × 0,5)
      }
      this.charge = 1;
      this.flowGear = WARP_FLOW.travel;
    } else {
      if (this.mode === 'warp') {
        this.mode = 'exit';
        this._beginExit(t, dt, game);
      } else if (this.mode === 'charging') {
        this.mode = 'idle';   // przerwane ładowanie — bańka zwija się niżej
      }
      if (this.mode === 'exit' && t - this.exitT > this.ramp.tHalt + 2.4) this.mode = 'idle';
      if (this.mode !== 'exit') this.charge = Math.max(0, this.charge - dt / 0.25);
    }
    this.angle = Number(game.angle) || 0;
    // Rulon i lejek (jedna faza z ładowaniem; szarpnięcie przy skoku; rozwinięcie w zwolnieniu).
    const rs = this.mode === 'charging' || this.mode === 'idle' ? 'charging' : (this.mode === 'warp' ? 'active' : 'exit');
    this.rulonBend = warpRulonBend(rs, this.charge, t - this.kickT, t - this.exitT, this.ramp.slow);
    if (this.mode === 'idle' && this.charge <= 0.001) this.rulonBend = 0;
    this.rulonField = Math.min(1, this.rulonBend);
  }

  // Wyjście: oś z rampy rozgrywki (warp.exitRamp — ta sama prędkość wlotu i hamowanie), wiek
  // zsynchronizowany z jej zegarem (czas gry); bez rampy — zapas z kadłuba.
  _beginExit(t, dt, game) {
    const r = game.exitRamp;
    const R = this.ramp;
    const L = Math.max(40, Number(game.length) || REF_LENGTH);
    if (r && r.active) {
      R.slow = r.slow; R.coast = r.coast; R.brake = r.brake; R.vArr = r.vArr; R.v0 = r.v0;
      R.tBrake = r.tBrake; R.tHalt = r.tHalt;
      this.exitT = t - Math.max(0, Number(r.age) || 0);
    } else {
      R.slow = WARP_EXIT.slow; R.coast = WARP_EXIT.coast;
      R.vArr = warpArrivalSpeed(L); R.v0 = R.vArr;
      R.brake = warpBrakeTime(L, R.vArr);
      R.tBrake = R.slow + R.coast; R.tHalt = R.tBrake + R.brake;
      this.exitT = t;
    }
    this.flowAtExit = Math.max(WARP_FLOW.exitRest, this.visibleFlowAt(t - dt));
    this.brakeShaken = false;
    // Ładowanie zużyte (po wyjściu rulon nie wraca przez gałąź „przerwanego ładowania”).
    this.charge = 0;
    if (this.onShake) this.onShake(8, 0.4);   // demo: 4 px · impuls(0,05 / 0,4 s)
  }

  /** Przejścia i klatka naraz (testy, proste użycie). Sterownik woła advance → ruch kamery → fill. */
  update(t, dt, game, frame, map, medium) {
    this.advance(t, dt, game, map, medium);
    this.fill(t, game, frame, map, medium);
  }

  fill(t, game, frame, map, medium) {
    const hull = this.hull;
    hull.on = false;
    if (!this.active && t - this.kickT > 1.5) return;
    const L = Math.max(40, Number(game.length) || REF_LENGTH);
    const R = L * WARP_BUBBLE.radiusK;
    const a = R * WARP_BUBBLE.asp;
    const sizeK = L / REF_LENGTH;
    const pal = warpPalette(game.palette);
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    const sx = game.x - map.camX;   // statek względem kamery (świat, y w dół)
    const sy = game.y - map.camY;
    const mode = this.mode;
    const cT = mode === 'charging' ? this.charge : (mode === 'idle' ? this.charge : 1);
    const exiting = mode === 'exit';
    const tx = t - this.exitT;
    const ramp = this.ramp;
    const tb = tx - ramp.tBrake;   // czas od początku hamowania (wyjście)

    // --- bańka gracza w ośrodku ---
    const bub = this.bubble;
    if (bub) {
      const inhale = smooth(0.78, 1.0, cT) * (mode === 'charging' ? 1 : 0);
      let A = 0;
      if (mode === 'charging' || mode === 'idle') A = Math.pow(smooth(0, 0.85, cT), 1.2);
      else if (mode === 'warp') A = 1;
      else if (exiting) A = tx < ramp.tHalt + 0.2 ? 1 : 0;
      bub.on = A > 0.001 && (!exiting || tx < ramp.tHalt + 0.35);
      bub.x = sx; bub.y = sy;
      bub.angle = this.angle;
      // Prędkość bańki w przestrzeni ośrodka: prędkość widoczna kamery + ruch statku w kadrze.
      bub.vx = medium.flowX + (Number(game.vRelX) || 0);
      bub.vy = medium.flowY + (Number(game.vRelY) || 0);
      bub.R = R;
      bub.asp = WARP_BUBBLE.asp;
      bub.A = A;
      // Po wyjściu jak bańka przylotu NPC: zapada się od dziobu przy hamowaniu.
      bub.front = exiting ? warpBrakeBubbleFront(tb, ramp.brake) : 3;
      const gearPulse = mode === 'warp' ? 2.2 * Math.exp(-(((t - this.gearT - 0.1) / 0.18) ** 2)) : 0;
      bub.strain = mode === 'warp' ? 0.9 + gearPulse : exiting ? 1.1 : (1.25 + 3.2 * inhale) * this.chargeK;
      bub.excite = mode === 'warp' ? 1 : exiting ? 1.4 : (1.6 + 1.2 * inhale) * this.chargeBoost;
      bub.turb = 0.13;
      bub.pullR = 1; bub.pullGain = 0; bub.jetSpeed = 0; bub.heraldLen = 0; bub.heraldGain = 0;
      bub.releaseT = Infinity;
      bub.rearT = exiting ? this.exitT + ramp.tHalt + 0.05 : Infinity;
      bub.lensAmp = 26 * A;
      if (bub.on) {
        frame.pushBubble(bub);
        frame.addLens(sx, sy, this.angle, a, R, bub.lensAmp, bub.front);
      }
    }

    // --- gwiazdy: płaskie smugi wzdłuż kursu, front wyjścia ---
    const st = frame.stars;
    st.angle = this.angle;
    st.refX = sx;
    st.refY = sy;
    const visFlow = this.visibleFlow(t);
    const speedFrac = clamp01((visFlow !== null ? visFlow : (Number(medium.flow) || 0)) / WARP_FLOW.gear2);
    if (mode === 'charging' || mode === 'idle') {
      st.stretch = 0.32 * cT * cT;
      st.warpTint = cT * 0.4;
    } else if (mode === 'warp') {
      st.stretch = warpStarStretch(t, this.kickT, Infinity, 1, speedFrac);
      st.warpTint = 1;
    } else {
      st.stretch = warpStarStretch(t, this.kickT, this.exitT, 1, 1, ramp.slow);
      st.warpTint = 1 - smooth(0, ramp.slow, tx);
      st.frontOn = 1;
      st.frontS = lerp(18000, -18000, smooth(0, ramp.slow, tx));
    }

    frame.warpVis = Math.max(frame.warpVis, mode === 'warp' ? smooth(this.kickT, this.kickT + 0.4, t)
      : (exiting ? 1 - smooth(0, ramp.slow, tx) : 0));
    // Po zatrzymaniu (i iskrach hamowania) ośrodek gaśnie — bez chmury drobin wokół okrętu.
    if (exiting && tx >= ramp.tHalt + 0.6 && tx < ramp.tHalt + 2.2) frame.mediumFade = Math.max(frame.mediumFade, 4);

    // --- kop: fala w punkcie skoku (przestrzeń widoczna), błysk za rufą ---
    const age = t - this.kickT;
    if (age >= 0 && age < 1.4) {
      const kx = this.kickMX - medium.camMX;
      const ky = this.kickMY - medium.camMY;
      frame.addWave(kx, ky, 9000 * age * sizeK, 320 * sizeK, 8 * (1 - age / 1.4) ** 2);
      if (age < 0.35) frame.addFlash(kx - c * L * 0.62, ky - sn * L * 0.62, R * 0.5, (1 - age / 0.35) ** 2, pal, false);
    }

    // --- wyjście: hamowanie jak przylot NPC (arrivals.js: brakeEffects) ---
    if (exiting) {
      const size = warpSizeScale(L);
      const p = this.push;
      if (p) {
        p.on = tb > -0.05 && tb < 0.5;
        if (p.on) {
          p.x = sx; p.y = sy;
          p.angle = this.angle;
          p.vx = 0; p.vy = 0;
          p.R = L * 0.62;
          p.asp = 1.35;
          p.A = 0;
          p.jetSpeed = Math.max(5200 * size, ramp.vArr * 0.55);
          p.excite = 1;
          p.heraldGain = 0; p.heraldLen = 0; p.pullGain = 0;
          p.releaseT = this.exitT + ramp.tBrake + 0.02;
          p.rearT = Infinity;
          frame.pushBubble(p);
        }
      }
      if (tb >= 0 && tb < 0.35) {
        const k = Math.pow(1 - tb / 0.35, 2);
        const bx = sx + c * L * 0.52;
        const by = sy + sn * L * 0.52;
        frame.addFlash(bx, by, L * 0.55, k * 1.8, pal, false);
        frame.addGlare(bx, by, this.angle + Math.PI * 0.5, L * 1.6, k * 1.2, pal);
      }
      if (tb >= 0 && tb < 1.3) {
        const ag = tb / 1.3;
        frame.addWave(sx + c * L * 0.5, sy + sn * L * 0.5, L * (0.25 + 3.2 * easeOut3(ag)), L * 0.24, 11 * (1 - ag) ** 2 * Math.min(1.2, size * 1.2));
      }
      if (tb >= 0 && !this.brakeShaken) {
        this.brakeShaken = true;
        if (this.onShake) this.onShake(22, 0.3);   // demo: 11 px · e^(−t/0,3)
      }
      // Żar przy hamowaniu (cała energia w kadłub).
      if (tb >= 0 && tb < 8) {
        hull.on = true;
        hull.revealMode = 0;
        hull.revealLine = 0;
        hull.seamLine = -L * 4;
        hull.seam = 0;
        hull.seamW = Math.max(5, L * 0.007);
        hull.heat = 0.95 * smooth(0, 0.06, tb) * Math.exp(-Math.max(0, tb - 0.06) / 2.2);
        heatColor(hull.heat, hull.heatRGB);
        hull.rimW = Math.max(8, L * 0.011);
        if (hull.heat < 0.003 && tb > 0.1) hull.on = false;
      }
    }
  }
}
