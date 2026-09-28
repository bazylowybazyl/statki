// src/3d/warp/player.js
//
// Skok GRACZA w języku „Nurtu” (dema/warp-webgpu/scenes.js: createTripScene / createFreeScene)
// na automacie warpa gry (index.html: `warp.state` idle → charging → active → idle, bez zmian
// rozgrywki). Czysty moduł (bez three, bez DOM): co klatkę dostaje stan gry, wypełnia klatkę
// efektu (frame.js) — bańka w ośrodku, gwiazdy, fale, błyski, szew i żar kadłuba.
//
// Fazy (widok ze środka):
//   ŁADOWANIE  bańka rośnie: płaty ośrodka (turkus z przodu, pomarańcz z tyłu), gwiazdy
//              wydłużają się płasko (0,32·ładowanie²); na końcu „wdech” (naprężenie ×).
//              Ładowanie gry trwa `warp.chargeTime` (0,8 s) — krzywe dema (3 s) biegną po
//              ułamku ładowania, więc przyspieszone, ale w tych samych proporcjach;
//              przerwane ładowanie zwija bańkę w ~0,25 s.
//   SKOK       kop: gwiazdy strzelają w smugi z przestrzałem ×1,4 → 1 (0,12 / 0,55 s), fala
//              w punkcie skoku, błysk za rufą; przepływ ośrodka rośnie z prędkością gry.
//   PODRÓŻ     opływ bańki, strugi w talii, pomarańczowy warkocz; zmiana biegu = impuls
//              naprężenia. Przepływ ośrodka = prędkość WIDOCZNA (bieg I 16 tys., wyżej 21 tys.
//              j/s — WARP_FLOW), nie prawdziwa prędkość warpa (ta leci w setkach tys. j/s).
//   WYJŚCIE    gwałtowne jak w Star Wars (~0,3 s): smugi gwiazd wracają do punktów (0,16 s,
//              front od dziobu 18 000 → −18 000 j. w 0,22 s), bańka zapada się od czoła
//              (0,2 s), wydech tyłu, błysk przy dziobie, fala, szew i żar brzegu kadłuba,
//              ośrodek gaśnie (setFade 6 przez 1,5 s).
// Kamera gry ma własny rig (cameraRig.js) — kopa i zoomu z dema nie ma (agents.md: bez
// offsetów kamery poza rigiem); zostaje wstrząs przez `onShake` (kop — tu, wyjście — exitWarp).

import { warpPalette, seamColor, heatColor } from './palette.js';

/** Kształt bańki względem kadłuba (demo: BUBBLE_SHAPE). */
export const WARP_BUBBLE = Object.freeze({ radiusK: 0.62, asp: 1.35 });
/** Widoczna prędkość przepływu ośrodka w podróży (bieg I / wyższe) [j/s]. */
export const WARP_FLOW = Object.freeze({ gear1: 16000, gear2: 21000, exitRest: 160 });
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

/** Rozciągnięcie gwiazd: ładowanie → przestrzał przy kopnięciu → lot → trzask przy wyjściu (demo 1:1). */
export function warpStarStretch(tau, tKick, tExit, charge, speedFrac) {
  if (tau < tKick) return 0.32 * charge * charge;
  let s;
  const k = tau - tKick;
  if (k < 0.12) s = lerp(0.32, 1.4, easeOut3(k / 0.12));
  else s = lerp(1.4, 1.0, smooth(0.12, 0.55, k));
  s *= 0.55 + 0.45 * clamp01(speedFrac);
  if (tau >= tExit) {
    const u = (tau - tExit) / 0.16;
    s *= u >= 1 ? 0 : Math.pow(1 - u, 1.6);
  }
  return s;
}

const NEVER = -1e9;

/**
 * Stan skoku gracza. `update(t, dt, game, frame, map)`:
 *   game = { state: 'idle'|'charging'|'active', charge (0..1), gear, speed (prawdziwa, j/s),
 *            flow (prędkość widoczna kamery w ośrodku, j/s), angle (kurs), x, y (poza renderu
 *            kadłuba, świat), length, width (kadłub, j.), palette (id), entity }
 *   map   = { relX, relY } — przesunięcie świat → rel (pozycja − kamera; kamera ośrodka dla
 *            efektów zawieszonych w przestrzeni widocznej: punkt skoku).
 */
export class WarpPlayerFx {
  constructor() {
    this.bubble = null;   // przegródka ośrodka (tworzy sterownik: newWarpSlot)
    this.hull = { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
    this.onShake = null;  // (mag px, dur s) — wstrząs kamery przy kopnięciu
    this.reset();
  }

  reset() {
    this.mode = 'idle';          // idle | charging | warp | exit
    this.prevState = 'idle';
    this.charge = 0;
    this.kickT = NEVER;
    this.exitT = NEVER;
    this.gearT = NEVER;
    this.gear = 1;
    this.kickMX = 0;             // punkt skoku w przestrzeni ośrodka (widocznej)
    this.kickMY = 0;
    this.flowAtExit = 0;
    this.flowGear = WARP_FLOW.gear1;   // docelowa prędkość widoczna biegu (wygładzona)
    this.chargeBoost = 1;
    this.chargeK = 1;
    this.angle = 0;
    this.hull.on = false;
  }

  /** Czy skok gracza czegoś jeszcze potrzebuje (ośrodek, gwiazdy, kadłub). */
  get active() {
    return this.mode !== 'idle' || this.charge > 0.001;
  }

  /**
   * Prędkość WIDOCZNA kamery w ośrodku wzdłuż kursu [j/s] albo null (poza skokiem — ośrodek idzie
   * za prawdziwą kamerą gry). Skok (demo, createTripScene): 900 → bieg (I 16 tys., wyżej 21 tys.)
   * w 0,45 s (easeOut³), zmiana biegu wygładzona; wyjście: w 0,25 s do ~0 — statek „staje”
   * w przestrzeni widocznej, choć w grze może jeszcze dryfować (prędkość gry się nie zmienia).
   */
  visibleFlowAt(t) {
    return lerp(900, this.flowGear, easeOut3((t - this.kickT) / 0.45));
  }

  visibleFlow(t) {
    if (this.mode === 'warp') return this.visibleFlowAt(t);
    if (this.mode === 'exit') {
      const u = easeOut3((t - this.exitT) / 0.25);
      return lerp(this.flowAtExit, WARP_FLOW.exitRest, u);
    }
    return null;
  }

  advance(t, dt, game, map, medium) {
    const state = game.state === 'active' ? 'active' : (game.state === 'charging' ? 'charging' : 'idle');
    // Przejścia automatu gry → fazy efektu.
    if (state === 'charging') {
      if (this.mode !== 'charging') this.mode = 'charging';
      this.charge = clamp01(game.charge);
      // Ładowanie gry trwa `chargeTime` (0,8 s), w demie 3 s — czas ładowania ściśnięty ×(3 / ct):
      // naprężenie (dryf ośrodka: gęsty płat z przodu, rozrzedzony z tyłu) całkowane przez całe
      // ładowanie → ×k, żeby przesunięcie drobin na końcu było jak w demie; wzbudzenie ma zanik
      // 1,1 s (stan równowagi po ~2 s), więc tylko ×k^0,6 (przy 0,8 s: ×2,2).
      const ct = Number(game.chargeTime) > 0 ? game.chargeTime : 3;
      this.chargeK = Math.max(1, Math.min(4, 3.0 / ct));
      this.chargeBoost = Math.pow(this.chargeK, 0.6);
    } else if (state === 'active') {
      if (this.mode !== 'warp') {
        this.mode = 'warp';
        this.kickT = t;
        this.gear = game.gear || 1;
        this.gearT = NEVER;
        this.flowGear = this.gear <= 1 ? WARP_FLOW.gear1 : WARP_FLOW.gear2;
        // Punkt skoku w przestrzeni ośrodka (widocznej): kop zostaje tam, statek odlatuje.
        this.kickMX = medium.camMX + (game.x - map.camX);
        this.kickMY = medium.camMY + (game.y - map.camY);
        if (this.onShake) this.onShake(18, 0.3);   // ~9 px (cameraRig: mag × 0,5)
      }
      this.charge = 1;
      if ((game.gear || 1) !== this.gear) {
        this.gear = game.gear || 1;
        this.gearT = t;
      }
      // Zmiana biegu: prędkość widoczna dochodzi do biegu wykładniczo (demo, lot swobodny: 3,2 /s).
      const target = this.gear <= 1 ? WARP_FLOW.gear1 : WARP_FLOW.gear2;
      this.flowGear += (target - this.flowGear) * (1 - Math.exp(-3.2 * dt));
    } else {
      if (this.mode === 'warp') {
        this.mode = 'exit';
        this.exitT = t;
        this.flowAtExit = Math.max(WARP_FLOW.exitRest, this.visibleFlowAt(t - dt));
      } else if (this.mode === 'charging') {
        this.mode = 'idle';   // przerwane ładowanie — bańka zwija się niżej
      }
      if (this.mode === 'exit' && t - this.exitT > 1.7) this.mode = 'idle';
      if (this.mode !== 'exit') this.charge = Math.max(0, this.charge - dt / 0.25);
    }
    this.prevState = state;
    this.angle = Number(game.angle) || 0;
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
    // Front wyjścia przez kadłub (lokalne x od środka, + = dziób): 0,2 s od dziobu ku rufie.
    const fx = exiting && tx < 0.45 ? lerp(a * 1.3, -a * 1.3, clamp01(tx / 0.2)) : Infinity;

    // --- bańka gracza w ośrodku ---
    const bub = this.bubble;
    if (bub) {
      const inhale = smooth(0.78, 1.0, cT) * (mode === 'charging' ? 1 : 0);
      let A = 0;
      if (mode === 'charging' || mode === 'idle') A = Math.pow(smooth(0, 0.85, cT), 1.2);
      else if (mode === 'warp') A = 1;
      else if (exiting) A = tx < 0.3 ? 1 : 0;
      bub.on = A > 0.001 && (mode !== 'exit' || tx < 0.45);
      bub.x = sx; bub.y = sy;
      bub.angle = this.angle;
      // Prędkość bańki w przestrzeni ośrodka: prędkość widoczna kamery (+ ruch statku w kadrze).
      bub.vx = medium.flowX + (Number(game.vRelX) || 0);
      bub.vy = medium.flowY + (Number(game.vRelY) || 0);
      bub.R = R;
      bub.asp = WARP_BUBBLE.asp;
      bub.A = A;
      bub.front = Number.isFinite(fx) ? fx / a : 3;
      const gearPulse = mode === 'warp' ? 2.2 * Math.exp(-(((t - this.gearT - 0.1) / 0.18) ** 2)) : 0;
      bub.strain = mode === 'warp' || exiting ? 0.9 + gearPulse : (1.25 + 3.2 * inhale) * this.chargeK;
      bub.excite = mode === 'warp' || exiting ? 1 : (1.6 + 1.2 * inhale) * this.chargeBoost;
      bub.turb = 0.13;
      bub.pullR = 1; bub.pullGain = 0; bub.jetSpeed = 0; bub.heraldLen = 0; bub.heraldGain = 0;
      bub.releaseT = Infinity;
      bub.rearT = exiting ? this.exitT + 0.19 : Infinity;
      bub.lensAmp = 26 * A;
      if (bub.on) {
        frame.pushBubble(bub);
        // Soczewka bańki na mgławicy (tylko tło): ściśnięcie przed, rozciągnięcie za.
        frame.addLens(sx, sy, this.angle, a, R, bub.lensAmp, bub.front);
      }
    }

    // --- gwiazdy: płaskie smugi wzdłuż kursu, front wyjścia ---
    const st = frame.stars;
    st.angle = this.angle;
    st.refX = sx;
    st.refY = sy;
    const speedFrac = clamp01((Number(medium.flow) || 0) / WARP_FLOW.gear2);
    if (mode === 'charging' || mode === 'idle') {
      st.stretch = 0.32 * cT * cT;
      st.warpTint = cT * 0.4;
    } else if (mode === 'warp') {
      st.stretch = warpStarStretch(t, this.kickT, Infinity, 1, speedFrac);
      st.warpTint = 1;
    } else {
      st.stretch = warpStarStretch(t, this.kickT, this.exitT, 1, 1);
      st.warpTint = 0;
      st.frontOn = 1;
      st.frontS = lerp(18000, -18000, clamp01(tx / 0.22));
    }

    frame.warpVis = Math.max(frame.warpVis, mode === 'warp' ? smooth(this.kickT, this.kickT + 0.4, t)
      : (exiting ? Math.max(0, 1 - tx / 0.2) : 0));
    if (exiting && tx >= 0.1 && tx < 1.6) frame.mediumFade = Math.max(frame.mediumFade, 6);

    // --- kop: fala w punkcie skoku (przestrzeń widoczna), błysk za rufą ---
    const age = t - this.kickT;
    if (age >= 0 && age < 1.4) {
      const kx = this.kickMX - medium.camMX;
      const ky = this.kickMY - medium.camMY;
      frame.addWave(kx, ky, 9000 * age * sizeK, 320 * sizeK, 8 * (1 - age / 1.4) ** 2);
      if (age < 0.35) frame.addFlash(kx - c * L * 0.62, ky - sn * L * 0.62, R * 0.5, (1 - age / 0.35) ** 2, pal, false);
    }
    // --- wyjście: fala i błysk przy dziobie ---
    if (exiting && tx < 1.6) {
      frame.addWave(sx, sy, 7500 * tx * sizeK, 420 * sizeK, 12 * (1 - tx / 1.6) ** 2);
      if (tx < 0.3) frame.addFlash(sx + c * L * 0.5, sy + sn * L * 0.5, R * 0.6, 1.3 * (1 - tx / 0.3) ** 2, null, false);
    }

    // --- kadłub: szew na linii frontu i biały żar brzegu (wyjście) ---
    if (exiting && tx < 6) {
      hull.on = true;
      hull.revealMode = 0;
      hull.revealLine = 0;
      hull.seamLine = Number.isFinite(fx) ? fx : -L * 4;
      hull.seam = Number.isFinite(fx) && fx < L * 0.55 && fx > -L * 0.55 ? 1 : 0;
      hull.seamW = Math.max(5, L * 0.007);
      seamColor(pal, hull.seamRGB);
      hull.heat = tx < 0.12 ? smooth(0, 0.12, tx) : Math.exp(-(tx - 0.12) / 2.2);
      heatColor(hull.heat, hull.heatRGB);
      hull.rimW = Math.max(8, L * 0.011);
      if (hull.heat < 0.003 && !hull.seam) hull.on = false;
    }
  }
}
