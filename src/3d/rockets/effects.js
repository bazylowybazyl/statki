// src/3d/rockets/effects.js
//
// REŻYSER EFEKTÓW RAKIET (port `Effects` z dema dema/rakiety-webgpu/effects.js do gry,
// zadanie 19). Zdarzenia lotu z src/effects3d/rocketSystem3D.js (lot, naprowadzanie,
// trafienia i obrażenia zostają tam — gameplay) → receptury na pulach: dym (smoke.js),
// iskry (SparkSystem3D), płomienie (plumes.js), kule ognia, mgławica, łuki, duszki blasku,
// światła siatki Core3D, zniekształcenia Core3D (fala, implozja, gorące powietrze — zamiast
// dawnego pushHeatHazeWorld rakiet i fali shockwave3D), siły w dymie.
//
// Receptury (1:1 z dema):
//   • WYRZUT (VLS, zimny start): obłok białej pary, krótki chłodny błysk;
//   • ZAPŁON: błysk dyszy, kłąb gorących spalin, impuls światła;
//   • LOT: płomień z dyskami Macha, światło dyszy (oświetla własną smugę i kadłuby), smuga
//     = porcje gazu wzdłuż odcinka dyszy w klatce (wiek z ułamka klatki, ruch doliczony
//     analitycznie, trzy długości życia); supernowa: plazma, dym chemiczny, jony, łuki
//     wyładowań, pulsująca głowica w fazie końcowej;
//   • WYBUCH: błysk (rdzeń + halo) i silne krótkie światło, kula ognia, iskry
//     w półprzestrzeni od poszycia, płonące odłamki z własnymi smugami, kłęby sadzy, fala
//     (sama refrakcja + pchnięcie dymu), gorące powietrze, przypalenie poszycia;
//   • SUPERNOWA: implozja (wsysanie dymu, soczewka do środka, przygaszenie) → błysk z linią
//     anamorficzną, światło na pół kadru, podbicie bloomu → fala (refrakcja + wymiatanie
//     dymu) → pozostałość (nebula.js) → stygnące jądro z pulsowaniem;
//   • TARCZA (nowe — propozycja zadania 19, demo jej nie miało): głowica pęka na polu —
//     błysk w barwie tarczy, iskry rozlane stycznie po polu, krótka fala, garść sadzy na
//     zewnątrz; bez kuli ognia i przypalenia (pole ma własne płytki i iskry — shield3D.js).
//
// Różnice względem dema (gra):
//   • pozycje w ŚWIECIE gry (double), do GPU względem początku pul Core3D.fx.origin;
//   • ZEGAR reżysera = suma dt z rocketSystem3D.update (lot rakiet) — smuga i wybuchy
//     jadą z rakietą co do kroku, w pauzie stoją (jak dawne cząstki rakiet);
//   • losowość z fxRandom (warstwa efektów), nie z Math.random gry;
//   • zero alokacji na klatkę i na rakietę: pule SoA zamiast obiektów i filter();
//   • LOD smugi przy dalekim zoomie (gra schodzi do 0,05; demo do 0,1): gęstość porcji
//     maleje, krycie rośnie tak, żeby smuga zostawała tak samo gęsta; dym spoza kadru
//     z zapasem nie powstaje (duże bitwy);
//   • wstrząs kamery tylko od supernowej w kadrze (salwy w bitwie trzęsłyby bez przerwy);
//   • wybuch na poszyciu: punkt i normalna z HullBodies (traceThrough / surfaceNormal —
//     tylko odczyt) wzdłuż ostatniego odcinka lotu; bez styku — w punkcie zapalnika.

import {
  MISSILE_VFX, VFX_KEYS, VFX_NOVA, VFX_MICRO, SMOKE_KIND, SMOKE_DRAG, SPARK_COLORS, IGNITE_CORE, IGNITE_HALO,
  BAND_FRIENDLY, BAND_HOSTILE, rocketVfxIndex, PULSAR_BEAM
} from './palette.js';
import { GLOW_ROUND } from './glow.js';
import { fillRandom } from './rand.js';
import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../../game/simClock.js';
import { getEntityShieldRadiusTowards } from '../../../shieldSystem.js';
import { rocketHullContact } from '../../game/hullCraters.js';
import { Turret2D, normalizeWeaponFxKey } from '../../vfx/turret2D.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Długość kadłubka rakiety [j.] przy bodyScale 1 (rocketSystem3D: 160 × WS). */
export const ROCKET_BODY_LENGTH = 16;
/** Pojemność tablic per rakieta — jak pula rocketSystem3D (ROCKET.maxRockets). */
export const ROCKET_SLOTS = 2000;

const NOVA_CORE = Object.freeze([30, 26, 34]);
const NOVA_HALO = Object.freeze([1.1, 0.8, 1.35]);
const NOVA_LIGHT = Object.freeze([0.95, 0.62, 1.0]);
const LAUNCH_CORE = Object.freeze([1.4, 1.6, 1.9]);
const LAUNCH_HALO = Object.freeze([0.12, 0.14, 0.18]);
const BLAST_LIGHT = Object.freeze([1.0, 0.72, 0.45]);
const ANAM_CORE_A = Object.freeze([6, 8.5, 10]);
const ANAM_GLOW_A = Object.freeze([0.28, 0.6, 0.9]);
const ANAM_CORE_B = Object.freeze([12, 10, 14]);
const ANAM_GLOW_B = Object.freeze([0.45, 0.4, 0.9]);
const NOVA_SPARK_PALE = Object.freeze([1, 0.85, 0.95]);
// Pęknięcie nosiciela Hydry: biało-pomarańczowy błysk ładunku wyrzucającego.
const SPLIT_CORE = Object.freeze([9, 7.5, 5.5]);
const SPLIT_HALO = Object.freeze([0.5, 0.32, 0.16]);
const SPLIT_LIGHT = Object.freeze([1.0, 0.66, 0.36]);
// Barwa tarczy (shield3D.js: pełna = #5992f7, pusta = czerwień) — liniowo.
const SHIELD_FULL = Object.freeze([0.0999, 0.2874, 0.9301]);
const SHIELD_EMPTY = Object.freeze([1.0, 0.08, 0.04]);

// Zasięg LOD smugi: poniżej tego zoomu porcje rzedną (do ×4 przy zoomie 0,0625).
export const TRAIL_LOD_ZOOM = 0.25;
export const TRAIL_LOD_MAX = 4;
// Tłok salw: powyżej CROWD_START rakiet w locie (i w kolejkach salw) smugi rzedną jak w LOD
// (krycie rośnie — gęstość zostaje), najwyżej ×CROWD_MAX.
export const CROWD_START = 150;
export const CROWD_MAX = 3;
// Zapas kadru, w którym rakiety i odłamki sypią dym [j.] (plus 60% połowy kadru).
const EMIT_MARGIN = 1500;
// Skrót perspektywy z wysokości (kamera z góry, ortho): kadłubek, płomień i łuna rosną do
// ×(1 + LIFT_K) na wysokości LIFT_H — rakieta wyskakująca z komory „podchodzi” ku kamerze.
export const LIFT_K = 0.45;
export const LIFT_H = 160;
// Tryb wyrzutu głowicy potomnej Hydry (rocketSystem3D LAUNCH_SPLIT) — bez obłoku komory.
const MODE_SPLIT = 2;

// Supernowa: życie pozostałości (powłoka) i dżetów pulsara [s], prędkość dżetu [j./s];
// sekwencja reżysera (jądro, snopy, światło) trwa NOVA_SEQ_END od wybuchu głowicy.
// 2026-10-05 (user): wybuch ~2× większy, wir po wybuchu krótki (5,4 s → 2,2 s).
export const NOVA_REMNANT_LIFE = 2.2;
export const NOVA_JET_SPEED = 2000;
export const NOVA_JET_SPAN = 1.5;
export const NOVA_JET_LIFE = 0.8;
export const NOVA_SEQ_END = 2.8;
// Skala wybuchu (promienie błysku, fali, pozostałości, snopów, światła) względem dema.
const NOVA_SCALE = 2;
// Fala uderzeniowa i gorące powietrze supernowej (2026-10-05, user: mocniejsze; promienie × NOVA_SCALE).
// Dawniej: fala 1,3 s, zasięg 2700, τ 0,42, grubość 170, siła 22 px; haze 1,6 s, promień 700, siła 5 px.
// strength [px ekranu], capPerWidth — sufit siły na px grubości frontu, echo — siła fali odbitej.
export const NOVA_SHOCK = { life: 1.8, rMax: 3000, tau: 0.5, width: 230, strength: 55, echo: 0.4, capPerWidth: 0.6 };
// Haze: core — siła wewnętrznego, krótszego kłębu; scale — skala wzoru szumu (distortion.js: najkrótszy okres
// ~185 j. świata przy 1 — przy dalekim zoomie silne przesunięcie zawijało go w kratkę, „wafel” z A/B 2026-10-05;
// 0,3 → okres ~620 j., fale na miarę kilkukilometrowego wybuchu); capPerZoom — sufit siły [px] na jednostkę
// zoomu (~0,2 okresu na ekranie przy nakładaniu się wybuchów salwy: zoom 0,12 → 9 px, 0,2 → pełna siła).
export const NOVA_HAZE = { life: 2.6, radius: 1000, strength: 13, core: 1.3, scale: 0.3, capPerZoom: 75 };
// Pozostałość: cząstek na jedną supernową — salwa 4 mieści się w pierścieniu mgławicy (NEBULA_CAP 262 144),
// więc czwarta głowica nie zjada pozostałości pierwszej (dawniej 110 000 na jedną).
const NOVA_REMNANT_PARTICLES = 64000;

const FLASH_CAP = 256;
const BLAST_CAP = 32;
const SHOCK_CAP = 32;
const HAZE_CAP = 32;
const FRAG_CAP = 256;
const SCORCH_CAP = 64;
const NOVA_CAP = 8;
const LIGHT_STAGE = 1024;

function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Puls głowicy w fazie końcowej: częstotliwość rośnie 6 → 16 Hz, więc fazę CAŁKUJEMY
 * (∫f dt), a nie liczymy czas × częstotliwość.
 */
export function novaPulse(t) {
  const tc = 10 / 14;
  const phase = t < tc ? 6 * t + 7 * t * t : 6 * tc + 7 * tc * tc + 16 * (t - tc);
  const s = Math.max(0, Math.sin(phase * TAU));
  const s2 = s * s;
  return s2 * s2;
}

/** Pozycja encji gry (NPC całkują x/y, gracz pos). */
function entX(e) { return Number(e?.pos?.x ?? e?.x) || 0; }
function entY(e) { return Number(e?.pos?.y ?? e?.y) || 0; }
function entVx(e) { return Number(e?.vx ?? e?.vel?.x) || 0; }
function entVy(e) { return Number(e?.vy ?? e?.vel?.y) || 0; }
function isPlayerEntity(e) {
  const w = typeof window !== 'undefined' ? window : null;
  return !!e && !!w && (e === w.ship || e === w.player2Ship || e._isPlayerShip === true);
}

export class RocketEffects {
  /**
   * @param {object} o
   * @param {import('./smoke.js').SmokeSystem} o.smoke
   * @param {import('./plumes.js').PlumeSystem} o.plumes
   * @param {import('./missileBodies.js').MissileBodies} o.bodies
   * @param {import('./fireballs.js').FireballSystem} o.fireballs
   * @param {import('./arcs.js').ArcSystem} o.arcs
   * @param {import('./nebula.js').NebulaSystem} o.nebula
   * @param {import('./glow.js').GlowSprites} o.glow
   * @param {{ emitRaw: Function }} o.sparks pula iskier (SparkSystem3D)
   * @param {{ next(): number, uint32(): number }} o.rng generator efektów (fxRandom)
   */
  constructor({ smoke, plumes, bodies, fireballs, arcs, nebula, glow, sparks, rng }) {
    this.smoke = smoke;
    this.plumes = plumes;
    this.bodies = bodies;
    this.fireballs = fireballs;
    this.arcs = arcs;
    this.nebula = nebula;
    this.glow = glow;
    this.sparks = sparks;
    this.rng = rng;
    this.renderer = null;           // dla spawn mgławicy (compute) — ustawia krok efektów
    // Zegar reżysera [s] (suma dt lotu rakiet) i epoka czasów na GPU (łuki, mgławica).
    this.time = 0;
    this.epoch = 0;
    this.pendingDt = 0;             // dt do kroku dymu w najbliższej klatce efektów
    this.bloomBoost = 0;
    this.exposure = 1;
    this.zoom = 0.3;
    // Kadr (świat gry) z ostatniej klatki efektów — odrzucanie emisji poza nim.
    this.hasView = false;
    this.vx0 = 0; this.vy0 = 0; this.vx1 = 0; this.vy1 = 0;
    this.opts = { trails: true, fragments: true, wakes: true, arcs: true, scorch: true, shieldRecipe: true, trailDensity: 1, blastGain: 1, novaShake: true, launcherKick: true };
    this.stats = { flashes: 0, fragments: 0, novas: 0, lights: 0, puffs: 0, culledPuffs: 0, splits: 0 };
    // Tłok salw (beginUpdate): mnożnik odstępu porcji smugi przy setkach rakiet w locie.
    this.crowd = 1;

    // ── Per rakieta (indeks slotu puli rocketSystem3D) ──
    const N = ROCKET_SLOTS;
    this.kind = new Uint8Array(N);
    this.hostile = new Uint8Array(N);
    this.nx0 = new Float64Array(N);
    this.ny0 = new Float64Array(N);
    this.nh0 = new Float64Array(N);   // wysokość dyszy (smuga liczona po drodze dyszy w 3D)
    this.acc = new Float64Array(N);
    this.vAcc = new Float64Array(N);  // para zimnego wyrzutu (droga dyszy przed zapłonem)
    this.ionAcc = new Float64Array(N);
    this.arcT = new Float32Array(N);
    this.roll = new Float32Array(N);
    this.flick = new Float32Array(N);
    this.seed = new Float32Array(N);
    this.termT = new Float32Array(N);
    this.tick = new Uint32Array(N);
    // Kinematyka rakiety w tej klatce (kurs, prędkość własna, ciąg) — liczona raz (onFly,
    // onLaunch, onIgnite), czytana przez światła, kadłubki, duszki i ślady w dymie. Bez
    // metod zwracających liczby w pętlach klatki: V8 opakowuje w obiekt każdą liczbę
    // zmiennoprzecinkową zwracaną (i przekazywaną) przez niewinlinowane wywołanie.
    this.ha = new Float64Array(N);   // kurs [rad] (świat gry)
    this.hc = new Float64Array(N);   // cos kursu
    this.hs = new Float64Array(N);   // sin kursu
    this.spd = new Float64Array(N);  // prędkość własna [j./s]
    this.thr = new Float64Array(N);  // ciąg 0..1 (0 bez napędu)

    // ── Błyski (SoA) ──
    this.fN = 0;
    this.fx_ = new Float64Array(FLASH_CAP); this.fy_ = new Float64Array(FLASH_CAP); this.ft0 = new Float64Array(FLASH_CAP);
    this.fd = new Float32Array(FLASH_CAP * 24);
    // fd: 0 life, 1 cx, 2 cy, 3..5 core, 6 coreSize, 7 tauCore, 8..10 halo, 11 haloSize, 12 tauHalo,
    //     13 light(0/1), 14..16 light rgb, 17 I1, 18 tau1, 19 I2, 20 tau2, 21 range, 22 z
    // ── Fale sił w dymie (blasts), fale refrakcji (shocks), gorące powietrze (hazes) ──
    this.bN = 0; this.bx = new Float64Array(BLAST_CAP); this.by = new Float64Array(BLAST_CAP); this.bt0 = new Float64Array(BLAST_CAP);
    this.bd = new Float32Array(BLAST_CAP * 8);   // life, speed, rMax, tauR, width, strength, cx, cy
    this.sN = 0; this.sx = new Float64Array(SHOCK_CAP); this.sy = new Float64Array(SHOCK_CAP); this.st0 = new Float64Array(SHOCK_CAP);
    this.sd = new Float32Array(SHOCK_CAP * 9);   // life, speed, rMax, tauR, width, strength, cx, cy, nova
    this.hN = 0; this.hx = new Float64Array(HAZE_CAP); this.hy = new Float64Array(HAZE_CAP); this.ht0 = new Float64Array(HAZE_CAP);
    this.hd = new Float32Array(HAZE_CAP * 5);    // life, radius, strength, cx, cy
    this.hNova = new Uint8Array(HAZE_CAP);       // 1 — supernowa (sufit siły z zoomu)
    // ── Płonące odłamki ──
    this.gN = 0; this.gx = new Float64Array(FRAG_CAP); this.gy = new Float64Array(FRAG_CAP); this.gt0 = new Float64Array(FRAG_CAP);
    this.gd = new Float32Array(FRAG_CAP * 9);    // vx, vy, cx, cy, life, drag, acc, heat, size
    // ── Przypalenia poszycia (kadłub, pozycja w jego układzie) ──
    this.cN = 0; this.cHull = new Array(SCORCH_CAP).fill(null); this.ct0 = new Float64Array(SCORCH_CAP);
    this.cd = new Float32Array(SCORCH_CAP * 5);  // lx, ly, life, size, smokeAcc
    // ── Supernowe ──
    this.nN = 0; this.nvx = new Float64Array(NOVA_CAP); this.nvy = new Float64Array(NOVA_CAP); this.nt0 = new Float64Array(NOVA_CAP);
    this.nstage = new Uint8Array(NOVA_CAP);
    // Wir pozostałości: obrót [rad/s] i oś dżetów pulsara (kąt startowy, obrót) — w układzie SCENY
    // (y w górę), te same liczby dostaje kernel mgławicy (snopy z jądra = oś dżetów).
    this.nSpin = new Float32Array(NOVA_CAP); this.nJetA = new Float32Array(NOVA_CAP); this.nJetW = new Float32Array(NOVA_CAP);
    // ── Ślady rakiet w dymie: wybór najbliższych kamerze (bez sortowania tablic obiektów) ──
    this._wakeIdx = new Int32Array(64);
    this._wakeD2 = new Float64Array(64);
    // Światła klatki: bufor roboczy (x, y, z, zasięg, r, g, b, rozproszenie) wysyłany do siatki
    // jedną ciasną pętlą (tam addWorld się wkleja — bez opakowywania liczb w obiekty).
    this._lb = new Float64Array(LIGHT_STAGE * 8);
    this._lN = 0;
    // Liczby losowe pętli klatki (fillRandom — ten sam ciąg co next(), bez zwracania liczb).
    this._rnd = new Float64Array(16);
    // Styk głowicy z poszyciem (przed obrażeniami) i wynik punktów roboczych.
    this._contact = { valid: false, rocket: -1, x: 0, y: 0, nx: 0, ny: 0 };
    this._p = { x: 0, y: 0 };
  }

  // --- pomocnicze -------------------------------------------------------------

  _outside(x, y, pad) {
    return this.hasView && (x < this.vx0 - pad || x > this.vx1 + pad || y < this.vy0 - pad || y > this.vy1 + pad);
  }

  /** Kurs rakiety w płaszczyźnie gry (świat: x w prawo, y w dół) z kierunku kadłubka. */
  heading(r) {
    const d = r.visualDir;
    const hx = Number(d?.x) || 0;
    const hz = Number(d?.z) || 0;
    if (hx * hx + hz * hz > 1e-8) return Math.atan2(hz, hx);
    return 0;
  }

  /** Kinematyka rakiety do tablic tej klatki: kurs z kierunku kadłubka, prędkość, ciąg. */
  _kin(r) {
    const i = r.index;
    const d = r.visualDir;
    const hx = d.x;
    const hz = d.z;
    const l2 = hx * hx + hz * hz;
    if (l2 > 1e-8) {
      const inv = 1 / Math.sqrt(l2);
      this.hc[i] = hx * inv;
      this.hs[i] = hz * inv;
      this.ha[i] = Math.atan2(hz, hx);
    } else {
      this.hc[i] = 1; this.hs[i] = 0; this.ha[i] = 0;
    }
    const vx = r.velocity.x;
    const vz = r.velocity.z;
    this.spd[i] = Math.sqrt(vx * vx + vz * vz);
    const m = r.maxThrust;
    const t = r.state === 'POWERED' && m > 0 ? r.currentThrust / m : 0;
    this.thr[i] = t > 1 ? 1 : (t > 0 ? t : 0);
  }

  /**
   * Porcja dymu w ŚWIECIE: ruch własny (vx, vy) i nośnik (cx, cy), wiek początkowy age0 —
   * ruch doliczony analitycznie (opór palety).
   */
  _puff(x, y, vx, vy, cx, cy, size0, growth, life, temp, kind, opacity, age0 = 0, z = 12, angle = null) {
    const S = this.smoke.s;
    S.x = x; S.y = y; S.vx = vx; S.vy = vy; S.cx = cx; S.cy = cy; S.size0 = size0; S.growth = growth;
    S.life = life; S.temp = temp; S.pal = kind; S.opacity = opacity; S.age = age0; S.z = z;
    S.angle = angle === null ? NaN : angle;
    this._puffStaged();
  }

  /**
   * Porcja z wpisu roboczego puli dymu (ŚWIAT; pętle klatki piszą pola wprost — bez liczb
   * w argumentach): ruch o wiek początkowy doliczony analitycznie (opór palety).
   */
  _puffStaged() {
    const S = this.smoke.s;
    const age0 = S.age;
    if (age0 > 0) {
      const k = SMOKE_DRAG[S.pal];
      const e = Math.exp(-k * age0);
      const f = (1 - e) / k;
      S.x += S.vx * f + S.cx * age0;
      S.y += S.vy * f + S.cy * age0;
      S.vx *= e;
      S.vy *= e;
    }
    this.stats.puffs++;
    this.smoke.push();
  }

  /** Iskra rakiety: nośnik (cx, cy) w zegarze gry `clock` (t0 = teraz). */
  _spark(x, y, vx, vy, life, size, drag, col, gain, cx, cy, clock) {
    const t0 = clock === CLOCK_RENDER ? SimClock.render : SimClock.sim;
    this.sparks.emitRaw(x, y, vx, vy, life, size, drag, col[0], col[1], col[2], gain, cx, cy, t0, clock);
  }

  _flash(x, y, life, cx, cy, core, coreK, coreSize, tauCore, halo, haloK, haloSize, tauHalo,
    light = null, I1 = 0, tau1 = 1, I2 = 0, tau2 = 1, range = 0, z = 40) {
    let i = this.fN;
    if (i >= FLASH_CAP) {
      // Pełna pula: nadpisz najstarszy.
      let oldest = 0;
      for (let k = 1; k < this.fN; k++) if (this.ft0[k] < this.ft0[oldest]) oldest = k;
      i = oldest;
    } else {
      this.fN++;
    }
    this.fx_[i] = x; this.fy_[i] = y; this.ft0[i] = this.time;
    const o = i * 24;
    const F = this.fd;
    F[o] = life; F[o + 1] = cx; F[o + 2] = cy;
    F[o + 3] = core[0] * coreK; F[o + 4] = core[1] * coreK; F[o + 5] = core[2] * coreK; F[o + 6] = coreSize; F[o + 7] = tauCore;
    F[o + 8] = halo[0] * haloK; F[o + 9] = halo[1] * haloK; F[o + 10] = halo[2] * haloK; F[o + 11] = haloSize; F[o + 12] = tauHalo;
    F[o + 13] = light ? 1 : 0;
    if (light) { F[o + 14] = light[0]; F[o + 15] = light[1]; F[o + 16] = light[2]; }
    F[o + 17] = I1; F[o + 18] = tau1; F[o + 19] = I2; F[o + 20] = tau2; F[o + 21] = range; F[o + 22] = z;
  }

  _blast(x, y, life, speed, rMax, tauR, width, strength, cx, cy) {
    if (this.bN >= BLAST_CAP) return;
    const i = this.bN++;
    this.bx[i] = x; this.by[i] = y; this.bt0[i] = this.time;
    const o = i * 8;
    const B = this.bd;
    B[o] = life; B[o + 1] = speed; B[o + 2] = rMax; B[o + 3] = tauR; B[o + 4] = width; B[o + 5] = strength; B[o + 6] = cx; B[o + 7] = cy;
  }

  _shock(x, y, life, speed, rMax, tauR, width, strength, cx, cy, nova) {
    if (this.sN >= SHOCK_CAP) return;
    const i = this.sN++;
    this.sx[i] = x; this.sy[i] = y; this.st0[i] = this.time;
    const o = i * 9;
    const S = this.sd;
    S[o] = life; S[o + 1] = speed; S[o + 2] = rMax; S[o + 3] = tauR; S[o + 4] = width; S[o + 5] = strength; S[o + 6] = cx; S[o + 7] = cy; S[o + 8] = nova ? 1 : 0;
  }

  _haze(x, y, life, radius, strength, cx, cy, nova = false) {
    if (this.hN >= HAZE_CAP) return;
    const i = this.hN++;
    this.hx[i] = x; this.hy[i] = y; this.ht0[i] = this.time; this.hNova[i] = nova ? 1 : 0;
    const o = i * 5;
    const H = this.hd;
    H[o] = life; H[o + 1] = radius; H[o + 2] = strength; H[o + 3] = cx; H[o + 4] = cy;
  }

  // --- zdarzenia lotu (rocketSystem3D) ------------------------------------------

  /** Początek kroku lotu: liczba rakiet w locie i w kolejkach salw (tłok — rzadsze smugi). */
  beginUpdate(active) {
    this.crowd = active > CROWD_START ? Math.min(CROWD_MAX, Math.sqrt(active / CROWD_START)) : 1;
  }

  /**
   * Start rakiety (fire). colorTheme 'red' = wróg (czerwony pas kadłubka). Zimny wyrzut z komory:
   * chłodny błysk, pierścień pary rozlany po pokładzie, szarpnięcie kasety wyrzutni (Turret2D).
   * Głowica potomna Hydry (tryb podziału) — bez obłoku (od razu na silniku, zapłon w onIgnite).
   */
  onLaunch(r, colorTheme = 'blue') {
    const rng = this.rng;
    const i = r.index;
    const kind = rocketVfxIndex(r.weaponDef);
    this.kind[i] = kind;
    this.hostile[i] = colorTheme === 'red' ? 1 : 0;
    const bs = Number(r.bodyScale) || 1;
    this._kin(r);
    const c = this.hc[i];
    const s = this.hs[i];
    const px = r.position.x;
    const py = r.position.z;
    const L = ROCKET_BODY_LENGTH * bs;
    const cp = Math.cos(Number(r.nosePitch) || 0);
    const sp = Math.sin(Number(r.nosePitch) || 0);
    this.nx0[i] = px - c * cp * L * 0.5;
    this.ny0[i] = py - s * cp * L * 0.5;
    this.nh0[i] = Math.max(0, r.position.y - sp * L * 0.5);
    this.acc[i] = 0; this.vAcc[i] = 0; this.tick[i] = 0; this.ionAcc[i] = 0; this.termT[i] = 0;
    this.arcT[i] = 0.2 + rng.next() * 0.3;
    this.roll[i] = rng.next() * TAU;
    this.flick[i] = rng.next() * 10;
    this.seed[i] = rng.next();
    if (r.mode === MODE_SPLIT) return;
    // Szarpnięcie kasety wyrzutni przy każdej rakiecie salwy (odrzut z danych broni — Turret2D).
    if (r.shooter && this.opts.launcherKick) {
      try { Turret2D.triggerShot(normalizeWeaponFxKey(r.weaponDef?.id), px, py, r.shooter); } catch { /* bez wieżyczki */ }
    }
    if (this._outside(px, py, EMIT_MARGIN)) return;
    const fx = r.frameVel.x;
    const fy = r.frameVel.z;
    // Zimny gaz wyrzutu: pierścień pary rozlewa się po pokładzie od komory; mikrorakiety salwy —
    // mniej porcji na rakietę (24 komory Gradu i tak dają gęsty obłok).
    const sq = Math.sqrt(bs);
    const micro = kind === VFX_MICRO;
    const puffs = Math.round((micro ? 6 : 14) * sq + 2);
    const S = this.smoke.s;
    const R = this._rnd;
    for (let k = 0; k < puffs; k++) {
      fillRandom(rng, R, 7);
      const a = R[0] * TAU;
      const spd = (70 + R[1] * 280) * (0.6 + 0.4 * sq);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      S.x = px + ca * 3 * sq; S.y = py + sa * 3 * sq;
      S.vx = ca * spd; S.vy = sa * spd; S.cx = fx; S.cy = fy;
      S.size0 = (5 + R[2] * 4) * sq; S.growth = (26 + R[3] * 16) * sq;
      S.life = 0.6 + R[4] * 0.7; S.temp = 0; S.pal = SMOKE_KIND.VAPOR;
      S.opacity = 0.26 + R[5] * 0.16; S.age = 0; S.z = 13 + R[6] * 2; S.angle = NaN;
      this._puffStaged();
    }
    this._flash(px, py, 0.12, fx, fy, LAUNCH_CORE, 1, 26 * bs, 0.04, LAUNCH_HALO, 1, 120 * bs, 0.06);
  }

  /**
   * Zapłon silnika (EJECTED → POWERED). Dysza w 3D (nos może patrzeć w górę): błysk, impuls światła,
   * kłąb spalin — z pionu strumień bije w pokład i rozlewa się pierścieniem, z poziomu idzie stożkiem
   * do tyłu (mieszanka według wzniesienia nosa).
   */
  onIgnite(r) {
    const rng = this.rng;
    const i = r.index;
    const kind = this.kind[i];
    const vfx = MISSILE_VFX[VFX_KEYS[kind]];
    const bs = Number(r.bodyScale) || 1;
    this._kin(r);
    const c = this.hc[i];
    const s = this.hs[i];
    const L = ROCKET_BODY_LENGTH * bs;
    const cp = Math.cos(Number(r.nosePitch) || 0);
    const sp = Math.sin(Number(r.nosePitch) || 0);
    const nx = r.position.x - c * cp * L * 0.5;
    const ny = r.position.z - s * cp * L * 0.5;
    const hN = Math.max(0, r.position.y - sp * L * 0.5);
    this.nx0[i] = nx; this.ny0[i] = ny; this.nh0[i] = hN; this.acc[i] = 0;
    if (this._outside(nx, ny, EMIT_MARGIN)) return;
    const fx = r.frameVel.x;
    const fy = r.frameVel.z;
    const Lt = vfx.light;
    const split = r.mode === MODE_SPLIT;
    this._flash(nx, ny, 0.3, fx, fy, IGNITE_CORE[kind], 1, 30 * bs, 0.05, IGNITE_HALO[kind], 1, 160 * bs, 0.1,
      Lt.color, (split ? 1.6 : 3.0) * Lt.intensity, 0.08, 0, 1, Lt.range * 1.1, 40 + hN);
    // Kłąb gorących spalin przy zapłonie (chemiczny dym supernowej słabiej — świeci sam).
    const trailKind = vfx.trail.kind;
    const nova = kind === VFX_NOVA;
    const sq = Math.sqrt(bs);
    const steep = sp > 0 ? sp : 0;
    const n = split ? 3 : (nova ? 9 : (kind === VFX_MICRO ? 5 : 12));
    const S = this.smoke.s;
    const R = this._rnd;
    for (let k = 0; k < n; k++) {
      fillRandom(rng, R, 8);
      let vx;
      let vy;
      if (R[7] < steep) {
        // Strumień z pionu: uderza w pokład pod rakietą i rozlewa się pierścieniem.
        const a = R[0] * TAU;
        const v = (180 + R[1] * 460) * (0.55 + 0.45 * steep);
        vx = Math.cos(a) * v;
        vy = Math.sin(a) * v;
      } else {
        const v = 250 + R[1] * 550;
        const spread = (R[0] - 0.5) * 1.6;
        vx = -(c * Math.cos(spread) - s * Math.sin(spread)) * v;
        vy = -(s * Math.cos(spread) + c * Math.sin(spread)) * v;
      }
      S.x = nx; S.y = ny; S.vx = vx; S.vy = vy; S.cx = fx; S.cy = fy;
      S.size0 = (4 + R[2] * 3) * sq; S.growth = (30 + R[3] * 20) * sq;
      S.life = 0.8 + R[4] * 1.4; S.temp = nova ? 0.45 : 1.0; S.pal = trailKind;
      S.opacity = 0.42 + R[5] * 0.15; S.age = R[6] * 0.02; S.z = 12 + hN * 0.25; S.angle = NaN;
      this._puffStaged();
    }
  }

  /**
   * Lot (po kroku pozycji rakiety w tej klatce): smuga porcji gazu wzdłuż odcinka dyszy w 3D.
   * Rakieta w pionie (zaraz po zapłonie) sypie dym w słup — z góry rozlewa się na boki; w poziomie
   * gaz leci do tyłu jak dawniej. Przed zapłonem — rzadka para zimnego wyrzutu.
   */
  onFly(r, dt) {
    const i = r.index;
    const bs = Number(r.bodyScale) || 1;
    this._kin(r);
    const h = this.ha[i];
    const c = this.hc[i];
    const s = this.hs[i];
    const L = ROCKET_BODY_LENGTH * bs;
    const pitch = Number(r.nosePitch) || 0;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const nX = r.position.x - c * cp * L * 0.5;
    const nY = r.position.z - s * cp * L * 0.5;
    const nH = Math.max(0, r.position.y - sp * L * 0.5);
    const kind = this.kind[i];
    if (kind === VFX_NOVA && r.guidancePhase === 'terminal') this.termT[i] += dt;
    const x0 = this.nx0[i];
    const y0 = this.ny0[i];
    const h0 = this.nh0[i];
    this.nx0[i] = nX; this.ny0[i] = nY; this.nh0[i] = nH;
    if (!this.opts.trails) return;
    if (this._outside(nX, nY, EMIT_MARGIN + L)) { this.acc[i] = 0; this.ionAcc[i] = 0; this.vAcc[i] = 0; return; }
    // Przed zapłonem — para zimnego wyrzutu (osobna metoda: tylko pierwsze ułamki sekundy lotu).
    if (r.state !== 'POWERED') { this._popVapor(r, dt); return; }
    const dx = nX - x0;
    const dy = nY - y0;
    const dh = nH - h0;
    const d = Math.sqrt(dx * dx + dy * dy + dh * dh);
    const rng = this.rng;
    const R = this._rnd;
    const P = this.smoke.s;
    const fx = r.frameVel.x;
    const fy = r.frameVel.z;
    const vfx = MISSILE_VFX[VFX_KEYS[kind]];
    const tr = vfx.trail;
    const zl = this.zoom > 1e-4 ? this.zoom : 1e-4;
    const lod = Math.min(TRAIL_LOD_MAX, Math.max(1, TRAIL_LOD_ZOOM / zl));
    const thin = lod * this.crowd;
    const spacing = tr.spacing * thin / Math.max(0.25, this.opts.trailDensity);
    this.acc[i] += d;
    const speed = this.spd[i];
    const vx3 = r.velocity.x;
    const vy3 = r.velocity.y;
    const vz3 = r.velocity.z;
    const speed3 = Math.sqrt(vx3 * vx3 + vy3 * vy3 + vz3 * vz3);
    const exhaust = Math.max(650, speed3 * tr.exhaust);
    // Wylot w płaszczyźnie: składowa strumienia wzdłuż −kursu (× cos wzniesienia); składowa w dół
    // (nos w górze) uderza w pokład / rozpręża się — rozrzut na boki we wszystkich kierunkach.
    const exPlanar = exhaust * cp;
    const radial = exhaust * (sp > 0 ? sp : 0) * 0.28;
    const spreadV = 55 + speed * 0.045;
    const thr = 0.45 + 0.55 * this.thr[i];
    const mvx = vx3;
    const mvy = vz3;
    const bsGrow = Math.pow(bs, 0.6);
    const bsSize = Math.pow(bs, 0.7);
    const steepAngle = sp > 0.7;
    let guard = 0;
    while (this.acc[i] >= spacing && guard++ < 256) {
      this.acc[i] -= spacing;
      const u = d > 1e-6 ? Math.min(1, Math.max(0, 1 - this.acc[i] / d)) : 1;
      // 60 % krótkich (gorący ogon), 20 % średnich, 20 % długich (dym na sekundy).
      const tier = this.tick[i]++ % 10;
      const lifeIdx = tier < 6 ? 0 : (tier < 8 ? 1 : 2);
      fillRandom(rng, R, 11);
      let opac = tr.opacity * (lifeIdx === 0 ? 1.0 : (lifeIdx === 1 ? 0.75 : 0.7)) * (0.8 + R[1] * 0.4);
      // LOD / tłok salw: rzadsze porcje, krycie tak, żeby nakładanie dawało tę samą gęstość smugi.
      if (thin > 1) opac = 1 - Math.pow(1 - Math.min(0.95, opac), thin);
      const lat = (R[3] - 0.5) * 2 * spreadV;
      const lon = (R[4] - 0.5) * 0.08 * exhaust;
      const ra = R[9] * TAU;
      const rr = radial * (0.4 + 0.6 * R[10]);
      P.x = x0 + dx * u; P.y = y0 + dy * u;
      P.vx = mvx - c * (exPlanar + lon) - s * lat + Math.cos(ra) * rr;
      P.vy = mvy - s * (exPlanar + lon) + c * lat + Math.sin(ra) * rr;
      P.cx = fx; P.cy = fy;
      P.size0 = tr.size0 * bsSize * (0.8 + R[5] * 0.4);
      P.growth = tr.growth * (lifeIdx === 0 ? 0.55 : (lifeIdx === 1 ? 0.9 : 1.0)) * (0.75 + R[2] * 0.5) * bsGrow;
      P.life = tr.lives[lifeIdx] * (0.85 + R[0] * 0.3);
      P.temp = tr.temp * thr * (0.85 + R[6] * 0.3);
      P.pal = tr.kind; P.opacity = opac; P.age = (1 - u) * dt;
      P.z = 10 + R[7] * 6 + h0 + dh * u;
      // Słup z pionu — kłęby bez kierunku (kąt losowy z bufora; nie NaN: stała NaN złączona
      // z liczbą w jednym wyrażeniu kazała V8 pakować kąt w obiekt przy każdej porcji).
      P.angle = steepAngle ? R[8] * TAU : h + (R[8] - 0.5) * 0.12;
      this._puffStaged();
    }

    if (kind === VFX_NOVA) {
      // Iskrzące jony w śladzie (migoczą w drugiej połowie życia) — wpis roboczy puli iskier.
      const dp = Math.sqrt(dx * dx + dy * dy);
      this.ionAcc[i] += dp;
      const ionStep = 16 * lod;
      const S = this.ionAcc[i] > ionStep ? this.sparks.stage() : null;
      while (this.ionAcc[i] > ionStep) {
        this.ionAcc[i] -= ionStep;
        if (!S) continue;
        const u = dp > 1e-6 ? Math.min(1, Math.max(0, 1 - this.ionAcc[i] / dp)) : 1;
        fillRandom(rng, R, 7);
        const a = R[0] * TAU;
        const sp2 = 20 + R[1] * 60;
        const col = R[2] < 0.55 ? SPARK_COLORS.nova : SPARK_COLORS.ion;
        S.x = x0 + dx * u + (R[3] - 0.5) * 14; S.y = y0 + dy * u + (R[4] - 0.5) * 14;
        S.vx = Math.cos(a) * sp2; S.vy = Math.sin(a) * sp2;
        S.life = 0.9 + R[5] * 1.3; S.size = 0.14 + R[6] * 0.1; S.drag = 1.2;
        S.r = col[0]; S.g = col[1]; S.b = col[2]; S.gain = 0.55;
        S.cvx = fx; S.cvy = fy; S.t0 = SimClock.render; S.clock = CLOCK_RENDER;
        this.sparks.pushStaged();
      }
      // Łuki wyładowań między głowicą a świeżym śladem.
      this.arcT[i] -= dt;
      if (this.arcT[i] <= 0 && this.opts.arcs) {
        fillRandom(rng, R, 5);
        this.arcT[i] = 0.16 + R[0] * 0.38;
        const back = 60 + R[1] * 150;
        const side = (R[2] - 0.5) * 70;
        const bx = nX - c * back - s * side;
        const by = nY - s * back + c * side;
        this.arcs.bolt(this.time - this.epoch, nX, nY, bx, by, rng, 0.07 + R[3] * 0.06, R[4] < 0.5 ? 1 : 0);
      }
    }
  }

  /**
   * KILWATER TORPEDY (pocisk gry z `bullets`, nie rakieta — tryb torped, 2026-09-30): porcje bladej
   * pary wzdłuż odcinka lotu w tej klatce — długi ślad, po którym widać wachlarz jak w World of
   * Warships; świeża porcja przy silniku lekko się żarzy. Nośnik = pęd wyrzutni (ivx, ivy) —
   * ślad stoi w układzie wyrzutni jak dym rakiet. Akumulator drogi na pocisku (`__wakeAcc`).
   */
  torpedoWake(b, dt) {
    if (!(dt > 0) || !this.opts.trails) return;
    const x1 = b.x;
    const y1 = b.y;
    if (this._outside(x1, y1, EMIT_MARGIN)) { b.__wakeAcc = 0; return; }
    const cx = Number(b.ivx) || 0;
    const cy = Number(b.ivy) || 0;
    // Ruch własny w klatce (względem układu wyrzutni) — z niego odcinek i kierunek śladu.
    const ux = (Number(b.vx) || 0) - cx;
    const uy = (Number(b.vy) || 0) - cy;
    const sp = Math.sqrt(ux * ux + uy * uy);
    if (sp < 1) return;
    const d = sp * dt;
    const dx = ux / sp;
    const dy = uy / sp;
    const zl = this.zoom > 1e-4 ? this.zoom : 1e-4;
    const lod = Math.min(TRAIL_LOD_MAX, Math.max(1, TRAIL_LOD_ZOOM / zl));
    const spacing = 9 * lod * this.crowd;
    let acc = (Number(b.__wakeAcc) || 0) + d;
    const rng = this.rng;
    const R = this._rnd;
    const P = this.smoke.s;
    let guard = 0;
    while (acc >= spacing && guard++ < 64) {
      acc -= spacing;
      const u = Math.min(1, Math.max(0, 1 - acc / d));
      fillRandom(rng, R, 6);
      let opac = 0.2 + R[1] * 0.08;
      if (lod > 1) opac = 1 - Math.pow(1 - opac, lod);
      P.x = x1 - dx * d * (1 - u) - dx * 14; P.y = y1 - dy * d * (1 - u) - dy * 14;
      P.vx = -dx * 60 + (R[2] - 0.5) * 50; P.vy = -dy * 60 + (R[3] - 0.5) * 50;
      P.cx = cx; P.cy = cy;
      P.size0 = 4 + R[4] * 2; P.growth = 22 + R[5] * 10;
      P.life = 2.2 + R[0] * 1.2; P.temp = 0.35; P.pal = SMOKE_KIND.MICRO;
      P.opacity = opac; P.age = (1 - u) * dt; P.z = 11;
      P.angle = Math.atan2(dy, dx);
      this._puffStaged();
    }
    b.__wakeAcc = acc;
  }

  /**
   * Zimny wyrzut (przed zapłonem): rzadkie smużki pary z generatora gazu za rakietą — z góry biały
   * obłoczek nad komorą, z którego wyłania się rakieta. Odcinek dyszy: poprzednia i bieżąca poza
   * (nx0 / ny0 / nh0 ustawił już onFly; tu tylko z tablic — bez liczb w argumentach).
   */
  _popVapor(r, dt) {
    const i = r.index;
    const bs = Number(r.bodyScale) || 1;
    const c = this.hc[i];
    const s = this.hs[i];
    const L = ROCKET_BODY_LENGTH * bs;
    const pitch = Number(r.nosePitch) || 0;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // Poprzednia poza dyszy: bieżąca cofnięta o ruch tej klatki (prędkość własna + układ).
    const x1 = this.nx0[i];
    const y1 = this.ny0[i];
    const h1 = this.nh0[i];
    const x0 = x1 - (r.velocity.x + r.frameVel.x) * dt;
    const y0 = y1 - (r.velocity.z + r.frameVel.z) * dt;
    const h0 = Math.max(0, h1 - r.velocity.y * dt);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dh = h1 - h0;
    const d = Math.sqrt(dx * dx + dy * dy + dh * dh);
    this.vAcc[i] += d;
    const rng = this.rng;
    const R = this._rnd;
    const P = this.smoke.s;
    const fx = r.frameVel.x;
    const fy = r.frameVel.z;
    const sq = Math.sqrt(bs);
    let guard = 0;
    while (this.vAcc[i] >= 7 && guard++ < 16) {
      this.vAcc[i] -= 7;
      const u = d > 1e-6 ? Math.min(1, Math.max(0, 1 - this.vAcc[i] / d)) : 1;
      fillRandom(rng, R, 6);
      const a = R[0] * TAU;
      const v = 20 + R[1] * 50;
      P.x = x0 + dx * u - c * cp * L * 0.1; P.y = y0 + dy * u - s * cp * L * 0.1;
      P.vx = Math.cos(a) * v; P.vy = Math.sin(a) * v;
      P.cx = fx; P.cy = fy;
      P.size0 = (2.4 + R[2] * 1.6) * sq; P.growth = (12 + R[3] * 8) * sq;
      P.life = 0.35 + R[4] * 0.3; P.temp = 0; P.pal = SMOKE_KIND.VAPOR;
      P.opacity = (0.14 + R[5] * 0.08) * (0.5 + 0.5 * sp); P.age = (1 - u) * dt; P.z = 12 + h0 + dh * u; P.angle = NaN;
      this._puffStaged();
    }
  }

  /**
   * Nosiciel głowicy kasetowej (Hydra) pęka przed celem: błysk ładunku wyrzucającego, światło,
   * pierścień iskier i obłok gazu, krótka fala (sama refrakcja) — głowice potomne startują
   * z tego punktu (ich zapłon — onIgnite).
   */
  onSplit(r) {
    const rng = this.rng;
    const px = r.position.x;
    const py = r.position.z;
    const hgt = Math.max(0, r.position.y);
    this.stats.splits++;
    if (this._outside(px, py, EMIT_MARGIN)) return;
    const fx = r.frameVel.x;
    const fy = r.frameVel.z;
    this._flash(px, py, 0.4, fx, fy, SPLIT_CORE, 1, 34, 0.05, SPLIT_HALO, 1, 170, 0.1,
      SPLIT_LIGHT, 2.4, 0.06, 0.35, 0.3, 760, 60 + hgt);
    const vx0 = r.velocity.x;
    const vy0 = r.velocity.z;
    for (let k = 0; k < 40; k++) {
      const a = rng.next() * TAU;
      const v = 500 + rng.next() * 1300;
      const col = rng.next() < 0.6 ? SPARK_COLORS.gold : SPARK_COLORS.warm;
      this._spark(px, py, vx0 * 0.35 + Math.cos(a) * v, vy0 * 0.35 + Math.sin(a) * v, 0.25 + rng.next() * 0.4,
        0.25 + rng.next() * 0.3, 2.6, col, 0.9, fx, fy, CLOCK_SIM);
    }
    for (let k = 0; k < 10; k++) {
      const a = rng.next() * TAU;
      const v = 160 + rng.next() * 360;
      this._puff(px, py, vx0 * 0.4 + Math.cos(a) * v, vy0 * 0.4 + Math.sin(a) * v, fx, fy,
        5 + rng.next() * 5, 30 + rng.next() * 18, 1.2 + rng.next() * 1.4, 0.6, SMOKE_KIND.SOOT, 0.24 + rng.next() * 0.1,
        rng.next() * 0.02, 16 + hgt);
    }
    this._shock(px, py, 0.35, 1900, 0, 0, 40, 4, fx, fy, false);
  }

  /**
   * Styk głowicy z poszyciem (przed obrażeniami — krater zabija węzły): pierwszy materiał
   * kadłuba celu na ostatnim odcinku lotu, lekko przedłużonym. Tylko odczyt (HullBodies).
   * (x0, y0) → (x1, y1) — odcinek klatki (świat gry), (x1, y1) = punkt zapalnika. Ten sam
   * punkt bierze krater gry (src/game/hullCraters.js rocketHullContact, zadanie 25c).
   */
  prepareContact(r, x0, y0, x1, y1) {
    const ct = this._contact;
    ct.valid = false;
    ct.rocket = r.index;
    const target = r.target;
    const HB = typeof window !== 'undefined' ? window.HullBodies : null;
    if (!target || target._isPositionTarget) return;
    const c = rocketHullContact(HB, target, x0, y0, x1, y1, this.hc[r.index], this.hs[r.index]);
    if (!c.valid) return;
    ct.x = c.x; ct.y = c.y;
    ct.nx = c.nx;
    ct.ny = c.ny;
    ct.valid = true;
  }

  /**
   * Detonacja (rocketSystem3D._explode — po obrażeniach obszarowych). (x, y) — punkt
   * zapalnika (świat), hit — trafiona encja albo null, hitShield — głowica na tarczy.
   */
  onDetonate(r, x, y, hit, hitShield) {
    const i = r.index;
    const kind = this.kind[i];
    const ct = this._contact;
    const contact = ct.valid && ct.rocket === i;
    ct.valid = false;
    if (kind === VFX_NOVA) {
      this._supernova(x, y, r.frameVel.x, r.frameVel.z);
      return;
    }
    if (hitShield && hit) {
      if (this.opts.shieldRecipe) this._shieldBurst(r, x, y, hit);
      return;
    }
    let nx = -this.hc[i];
    let ny = -this.hs[i];
    let ex = x;
    let ey = y;
    let onHull = null;
    if (hit && contact) {
      ex = ct.x; ey = ct.y; nx = ct.nx; ny = ct.ny;
      onHull = hit;
    }
    this._standard(r, kind, ex, ey, hit, onHull, nx, ny);
  }

  // --- wybuch głowicy ---------------------------------------------------------

  _carrierOf(r, hit) {
    const p = this._p;
    if (hit) { p.x = entVx(hit); p.y = entVy(hit); } else { p.x = r.frameVel.x; p.y = r.frameVel.z; }
    return p;
  }

  _standard(r, kind, x, y, hit, onHull, nx, ny) {
    const rng = this.rng;
    const vfx = MISSILE_VFX[VFX_KEYS[kind]];
    const B = vfx.blast;
    const R = B.radius;
    const k = R / 150;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nl; ny /= nl;
    // Nośnik: trafiony kadłub (wybuch jedzie z nim) albo układ rakiety.
    const cp = this._carrierOf(r, hit);
    const cx = cp.x;
    const cy = cp.y;
    const sparkClock = hit ? (isPlayerEntity(hit) ? CLOCK_RENDER : CLOCK_SIM) : CLOCK_RENDER;
    const ex = x + (onHull ? nx * R * 0.12 : 0);
    const ey = y + (onHull ? ny * R * 0.12 : 0);
    const sk = Math.sqrt(k);
    // Rana na poszyciu (mapa ran): od zadania 25c rakieta robi mały krater (index.html
    // applyRocketHullImpact) — ranę stempluje hak krateru w tym samym punkcie styku; tu sam obraz.
    if (this._outside(ex, ey, EMIT_MARGIN + R * 3)) {
      // Poza kadrem: tylko światło (sięga w kadr) — bez dymu, iskier, odłamków i fali.
      this._flash(ex, ey, 1.2, cx, cy, BLAST_CORE, B.flash, 24 * k, 0.035, BLAST_HALO, B.flash, 210 * k, 0.08,
        BLAST_LIGHT, 6 * B.flash, 0.06, 1.2 * B.flash, 0.4, 2200 * sk, 140);
      return;
    }
    // 1. Błysk i światło.
    this._flash(ex, ey, 1.2, cx, cy, BLAST_CORE, B.flash, 24 * k, 0.035, BLAST_HALO, B.flash, 210 * k, 0.08,
      BLAST_LIGHT, 6 * B.flash, 0.06, 1.2 * B.flash, 0.4, 2200 * sk, 140);
    // 2. Kula ognia.
    this.fireballs.add(this.time, ex, ey, 36, R * 0.62, 0.95, 1.0, 1.0, cx, cy);
    // 3. Iskry: półprzestrzeń od poszycia albo pełne koło (wybuch w próżni).
    const nSp = Math.round(B.sparks * this.opts.blastGain);
    const nAng = Math.atan2(ny, nx);
    for (let s = 0; s < nSp; s++) {
      const a = onHull ? nAng + (rng.next() - 0.5) * 2 * 1.35 : rng.next() * TAU;
      const sp = (1200 + rng.next() * 3000) * sk;
      const col = rng.next() < 0.6 ? SPARK_COLORS.warm : SPARK_COLORS.gold;
      this._spark(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + rng.next() * 0.7, 0.3 + rng.next() * 0.6, 2.0 + rng.next() * 1.6, col, 1, cx, cy, sparkClock);
    }
    // 4. Płonące odłamki z własnymi smugami.
    if (this.opts.fragments) {
      for (let f = 0; f < B.fragments; f++) {
        if (this.gN >= FRAG_CAP) break;
        const a = onHull ? nAng + (rng.next() - 0.5) * 2 * 1.2 : rng.next() * TAU;
        const sp = (520 + rng.next() * 950) * sk;
        const g = this.gN++;
        this.gx[g] = ex; this.gy[g] = ey; this.gt0[g] = this.time;
        const o = g * 9;
        const G = this.gd;
        G[o] = Math.cos(a) * sp; G[o + 1] = Math.sin(a) * sp; G[o + 2] = cx; G[o + 3] = cy;
        G[o + 4] = 0.7 + rng.next() * 0.9; G[o + 5] = 1.1 + rng.next() * 0.6; G[o + 6] = 0;
        G[o + 7] = 0.8 + rng.next() * 0.4; G[o + 8] = (0.7 + rng.next() * 0.6) * sk;
      }
    }
    // 5. Kłęby sadzy (świeże świecą od środka, potem stygną i dymią).
    const nSm = Math.round(B.smoke);
    for (let s = 0; s < nSm; s++) {
      const a = onHull ? nAng + (rng.next() - 0.5) * 2 * 1.5 : rng.next() * TAU;
      const sp = (120 + rng.next() * 520) * sk;
      const r0 = rng.next() * R * 0.25;
      this._puff(ex + Math.cos(a) * r0, ey + Math.sin(a) * r0, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy,
        (10 + rng.next() * 16) * k, (36 + rng.next() * 26) * k, 3.2 + rng.next() * 3.6, 0.35 + rng.next() * 0.2, SMOKE_KIND.SOOT, 0.26 + rng.next() * 0.14, rng.next() * 0.05, 20 + rng.next() * 10);
    }
    // 6. Fala uderzeniowa (refrakcja, bez obrysu) + pchnięcie dymu; gorące powietrze.
    this._shock(ex, ey, 0.55, 2900 * sk, 0, 0, 70 * k, 11 * B.shock, cx, cy, false);
    this._blast(ex, ey, 0.6, 2900 * sk, 0, 0, 110 * k, 5200 * B.shock, cx, cy);
    this._haze(ex, ey, 0.9, R * 1.3, 3.2, cx, cy);
    // 7. Przypalenie poszycia (żar stygnie, chwilę dymi) — w układzie kadłuba.
    if (onHull && this.opts.scorch && this.cN < SCORCH_CAP) {
      const hx = entX(onHull);
      const hy = entY(onHull);
      const ha = Number(onHull.angle) || 0;
      const dxh = x - hx;
      const dyh = y - hy;
      const ca = Math.cos(-ha);
      const sa = Math.sin(-ha);
      const c = this.cN++;
      this.cHull[c] = onHull;
      this.ct0[c] = this.time;
      const o = c * 5;
      const C = this.cd;
      C[o] = dxh * ca - dyh * sa; C[o + 1] = dxh * sa + dyh * ca; C[o + 2] = 3.2; C[o + 3] = 26 * k; C[o + 4] = 0;
    }
  }

  /**
   * TARCZA (propozycja): głowica pęka na polu. Punkt na obrysie pola w kierunku od środka
   * encji do zapalnika, normalna = ten kierunek. Barwa z życia tarczy (jak wstęgi pola).
   */
  _shieldBurst(r, x, y, hit) {
    const rng = this.rng;
    const kind = this.kind[r.index];
    const B = MISSILE_VFX[VFX_KEYS[kind]].blast;
    const k = B.radius / 150;
    const sk = Math.sqrt(k);
    const hx = entX(hit);
    const hy = entY(hit);
    let nx = x - hx;
    let ny = y - hy;
    const nl = Math.sqrt(nx * nx + ny * ny);
    if (nl > 1e-6) { nx /= nl; ny /= nl; } else { nx = -this.hc[r.index]; ny = -this.hs[r.index]; }
    let R = 0;
    try { R = Number(getEntityShieldRadiusTowards(hit, x, y)) || 0; } catch { R = 0; }
    const ex = R > 0 ? hx + nx * R : x;
    const ey = R > 0 ? hy + ny * R : y;
    if (this._outside(ex, ey, EMIT_MARGIN)) return;
    const cx = entVx(hit);
    const cy = entVy(hit);
    const clock = isPlayerEntity(hit) ? CLOCK_RENDER : CLOCK_SIM;
    const sh = hit.shield;
    const life = sh && Number(sh.max) > 0 ? clamp((Number(sh.val) || 0) / Number(sh.max), 0, 1) : 1;
    const col = this._shieldCol || (this._shieldCol = [0, 0, 0]);
    for (let c = 0; c < 3; c++) col[c] = SHIELD_EMPTY[c] + (SHIELD_FULL[c] - SHIELD_EMPTY[c]) * life;
    const halo = this._shieldHalo || (this._shieldHalo = [0, 0, 0]);
    for (let c = 0; c < 3; c++) halo[c] = col[c] * 0.55 + 0.08;
    // Błysk: mały biało-niebieski rdzeń, halo w barwie pola, światło pola na kadłubie.
    this._flash(ex, ey, 0.8, cx, cy, SHIELD_CORE, B.flash, 20 * k, 0.03, halo, B.flash, 170 * k, 0.07,
      col, 4.5 * B.flash, 0.05, 0.8 * B.flash, 0.25, 1600 * sk, 120);
    // Iskry plazmy rozlane stycznie po polu (±90° od normalnej) z lekkim odbiciem na zewnątrz.
    const nAng = Math.atan2(ny, nx);
    const nSp = Math.round(B.sparks * 0.6 * this.opts.blastGain);
    for (let s = 0; s < nSp; s++) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const a = nAng + side * (Math.PI * 0.5 - rng.next() * 0.75);
      const sp = (900 + rng.next() * 2200) * sk;
      const pale = rng.next() < 0.35;
      this._spark(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + rng.next() * 0.45, 0.25 + rng.next() * 0.45, 2.4 + rng.next() * 1.4,
        pale ? SPARK_COLORS.gold : col, pale ? 0.8 : 1.1, cx, cy, clock);
    }
    // Garść sadzy głowicy — zostaje na zewnątrz pola.
    for (let s = 0; s < 8; s++) {
      const a = nAng + (rng.next() - 0.5) * 2.2;
      const sp = (160 + rng.next() * 320) * sk;
      this._puff(ex + nx * 12, ey + ny * 12, Math.cos(a) * sp, Math.sin(a) * sp, cx, cy,
        (8 + rng.next() * 10) * k, (26 + rng.next() * 18) * k, 1.6 + rng.next() * 1.8, 0.3, SMOKE_KIND.SOOT, 0.2 + rng.next() * 0.1, 0, 22);
    }
    // Krótka fala (sama refrakcja) i gorące powietrze.
    this._shock(ex, ey, 0.4, 2400 * sk, 0, 0, 50 * k, 7 * B.shock, cx, cy, false);
    this._blast(ex, ey, 0.45, 2400 * sk, 0, 0, 90 * k, 3200 * B.shock, cx, cy);
    this._haze(ex, ey, 0.6, B.radius, 2.4, cx, cy);
  }

  _supernova(x, y) {
    let i = this.nN;
    if (i >= NOVA_CAP) {
      let oldest = 0;
      for (let k = 1; k < this.nN; k++) if (this.nt0[k] < this.nt0[oldest]) oldest = k;
      i = oldest;
    } else {
      this.nN++;
    }
    this.nvx[i] = x; this.nvy[i] = y; this.nt0[i] = this.time; this.nstage[i] = 0;
  }

  _novaDetonate(i) {
    const rng = this.rng;
    const B = MISSILE_VFX.supernova.blast;
    const x = this.nvx[i];
    const y = this.nvy[i];
    const S = NOVA_SCALE;
    this._flash(x, y, 1.6, 0, 0, NOVA_CORE, 1, 150 * S, 0.09, NOVA_HALO, 1, 1900 * S, 0.32, NOVA_LIGHT, 26, 0.12, 4.0, 0.7, 8000 * S, 400);
    // Linia anamorficzna (w poziomie ekranu), cienka i krótka.
    const tl = this.time - this.epoch;
    this.arcs.line(tl, x - 1500 * S, y, x + 1500 * S, y, 0.4, 1.1, 5 * S, ANAM_CORE_A, ANAM_GLOW_A, 95);
    this.arcs.line(tl, x - 520 * S, y, x + 520 * S, y, 0.22, 1.8, 9 * S, ANAM_CORE_B, ANAM_GLOW_B, 96);
    // Fala: refrakcja i wymiatanie dymu (front hamuje jak fala Sedova). 2026-10-05 (user: „haze i fala
    // mocniejsze”): front grubszy, dłuższy i ~2,5× silniejszy (sufit z grubości na ekranie —
    // fillDistortion), za nim druga, słabsza fala odbita; gorące powietrze szersze, silniejsze i dłuższe.
    this._shock(x, y, NOVA_SHOCK.life, 0, NOVA_SHOCK.rMax * S, NOVA_SHOCK.tau, NOVA_SHOCK.width * S, NOVA_SHOCK.strength, 0, 0, true);
    this._shock(x, y, NOVA_SHOCK.life * 1.25, 0, NOVA_SHOCK.rMax * 0.62 * S, NOVA_SHOCK.tau * 1.6, NOVA_SHOCK.width * 0.7 * S,
      NOVA_SHOCK.strength * NOVA_SHOCK.echo, 0, 0, true);
    this._blast(x, y, 1.3, 0, 2700 * S, 0.42, 220 * S, 16000 * S, 0, 0);
    this._haze(x, y, NOVA_HAZE.life, NOVA_HAZE.radius * S, NOVA_HAZE.strength, 0, 0, true);
    this._haze(x, y, NOVA_HAZE.life * 0.45, NOVA_HAZE.radius * 0.45 * S, NOVA_HAZE.strength * NOVA_HAZE.core, 0, 0, true);
    // Pozostałość: wir (obrót różnicowy — kierunek losowy), dżety pulsara na obracającej się osi.
    const dir = rng.next() < 0.5 ? -1 : 1;
    const spin = dir * (0.95 + 0.35 * rng.next());
    const jetA0 = rng.next() * TAU;
    const jetW = dir * (2.0 + 0.7 * rng.next());
    this.nSpin[i] = spin; this.nJetA[i] = jetA0; this.nJetW[i] = jetW;
    const arms = rng.next() < 0.5 ? 2 : 3;
    const armPhase = rng.next() * TAU;
    if (this.renderer) this.nebula.spawn(this.renderer, tl, x, y, NOVA_REMNANT_PARTICLES, 1250 * S, 10.5, NOVA_REMNANT_LIFE, 0.27,
      spin, jetA0, jetW, NOVA_JET_SPEED, NOVA_JET_SPAN, NOVA_JET_LIFE, arms, armPhase);
    // Iskry gwiezdne (w próżni: bez nośnika — pozostałość stoi w świecie, jak w demie).
    const inView = !this._outside(x, y, EMIT_MARGIN + 3000);
    const n = inView ? Math.round(B.sparks * this.opts.blastGain) : 0;
    for (let s = 0; s < n; s++) {
      const a = rng.next() * TAU;
      const sp = (900 + rng.next() * 3900) * S;
      const col = rng.next() < 0.7 ? SPARK_COLORS.nova : (rng.next() < 0.5 ? SPARK_COLORS.ion : NOVA_SPARK_PALE);
      this._spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + rng.next() * 1.3, 0.3 + rng.next() * 0.5, 0.8 + rng.next() * 0.9, col, 0.8, 0, 0, CLOCK_SIM);
    }
    // Wstrząs kamery — tylko supernowa w kadrze (standardowe salwy trzęsłyby bitwą bez przerwy).
    if (inView && this.opts.novaShake && typeof window !== 'undefined') {
      const cam = window.camera;
      if (cam && typeof cam.addShake === 'function') {
        const left = (Number(cam.shakeMag) || 0) * ((Number(cam.shakeDur) || 0) > 0 ? 1 : 0);
        if (16 > left) cam.addShake(16, 0.45);
      }
    }
  }

  // --- klatka (zegar reżysera) -------------------------------------------------

  /** Koniec rocketSystem3D.update: zegar, sekwencje supernowych, odłamki, przypalenia, wygaszanie. */
  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    this.pendingDt += dt;
    const time = this.time;
    const rng = this.rng;
    // Supernowe: etapy sekwencji.
    let boost = 0;
    let expo = 1;
    for (let i = this.nN - 1; i >= 0; i--) {
      const a = time - this.nt0[i];
      if (this.nstage[i] === 0 && a >= 0.24) { this.nstage[i] = 1; this._novaDetonate(i); }
      if (a < 0.24) expo = Math.min(expo, 1 - 0.2 * smooth(a / 0.24));
      else {
        const b = a - 0.24;
        boost = Math.max(boost, 1.3 * Math.exp(-b / 0.25));
        expo = Math.min(expo, 1 - 0.2 * Math.exp(-b / 0.05));
      }
      if (a >= NOVA_SEQ_END) {
        const last = --this.nN;
        this.nvx[i] = this.nvx[last]; this.nvy[i] = this.nvy[last]; this.nt0[i] = this.nt0[last]; this.nstage[i] = this.nstage[last];
        this.nSpin[i] = this.nSpin[last]; this.nJetA[i] = this.nJetA[last]; this.nJetW[i] = this.nJetW[last];
      }
    }
    this.bloomBoost = boost;
    this.exposure = expo;

    // Płonące odłamki: lot z oporem, smuga dymu, iskry z żaru.
    const zl = this.zoom > 1e-4 ? this.zoom : 1e-4;
    const lod = Math.min(TRAIL_LOD_MAX, Math.max(1, TRAIL_LOD_ZOOM / zl));
    const R = this._rnd;
    const P = this.smoke.s;
    const G = this.gd;
    for (let g = this.gN - 1; g >= 0; g--) {
      const o = g * 9;
      const a = time - this.gt0[g];
      const life = G[o + 4];
      const size = G[o + 8];
      if (a > life) {
        this._puff(this.gx[g], this.gy[g], G[o] * 0.2, G[o + 1] * 0.2, G[o + 2], G[o + 3], 6 * size, 30 * size, 1.6, 0.4, SMOKE_KIND.DEBRIS, 0.3, 0, 18);
        this._removeFrag(g);
        continue;
      }
      const drag = G[o + 5];
      const e = Math.exp(-drag * dt);
      const x0 = this.gx[g];
      const y0 = this.gy[g];
      const vx = G[o];
      const vy = G[o + 1];
      const cx = G[o + 2];
      const cy = G[o + 3];
      this.gx[g] = x0 + (vx * (1 - e) / drag) + cx * dt;
      this.gy[g] = y0 + (vy * (1 - e) / drag) + cy * dt;
      G[o] = vx * e; G[o + 1] = vy * e;
      const ddx = this.gx[g] - x0;
      const ddy = this.gy[g] - y0;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      G[o + 6] += d;
      const heat = G[o + 7] * (1 - a / life);
      if (this._outside(this.gx[g], this.gy[g], EMIT_MARGIN)) { G[o + 6] = 0; continue; }
      const sp = 7 * lod;
      let guard = 0;
      while (G[o + 6] > sp && guard++ < 64) {
        G[o + 6] -= sp;
        const u = d > 1e-6 ? Math.min(1, Math.max(0, 1 - G[o + 6] / d)) : 1;
        let opac = 0.32;
        if (lod > 1) opac = 1 - Math.pow(1 - opac, lod);
        fillRandom(rng, R, 2);
        P.x = x0 + (this.gx[g] - x0) * u; P.y = y0 + (this.gy[g] - y0) * u;
        P.vx = G[o] * 0.08; P.vy = G[o + 1] * 0.08; P.cx = cx; P.cy = cy;
        P.size0 = 2.2 * size; P.growth = 14 * size * (0.8 + R[0] * 0.4); P.life = 1.3 + R[1] * 1.5;
        P.temp = heat * 0.35; P.pal = SMOKE_KIND.DEBRIS; P.opacity = opac; P.age = (1 - u) * dt;
        P.z = 16; P.angle = Math.atan2(G[o + 1], G[o]);
        this._puffStaged();
      }
      fillRandom(rng, R, 4);
      if (R[0] < dt * 22 * heat) {
        // Iskra z żaru odłamka (wpis roboczy puli iskier — bez liczb w argumentach).
        const S = this.sparks.stage();
        if (S) {
          const aa = R[1] * TAU;
          const col = SPARK_COLORS.warm;
          S.x = this.gx[g]; S.y = this.gy[g];
          S.vx = G[o] * 0.3 + Math.cos(aa) * 150; S.vy = G[o + 1] * 0.3 + Math.sin(aa) * 150;
          S.life = 0.25 + R[2] * 0.3; S.size = 0.2 + R[3] * 0.2; S.drag = 3;
          S.r = col[0]; S.g = col[1]; S.b = col[2]; S.gain = 0.8;
          S.cvx = cx; S.cvy = cy; S.t0 = SimClock.render; S.clock = CLOCK_RENDER;
          this.sparks.pushStaged();
        }
      }
    }

    // Przypalenia: dymią przez pierwsze 1,6 s (znikają z kadłubem).
    const C = this.cd;
    for (let c = this.cN - 1; c >= 0; c--) {
      const o = c * 5;
      const hull = this.cHull[c];
      const a = time - this.ct0[c];
      if (a >= C[o + 2] || !hull || hull.dead) { this._removeScorch(c); continue; }
      if (a > 1.6) continue;
      C[o + 4] += dt;
      if (C[o + 4] <= 0.045) continue;
      const p = this._scorchWorld(c);
      if (this._outside(p.x, p.y, EMIT_MARGIN)) { C[o + 4] = 0; continue; }
      while (C[o + 4] > 0.045) {
        C[o + 4] -= 0.045;
        fillRandom(rng, R, 4);
        const ang = R[0] * TAU;
        P.x = p.x; P.y = p.y; P.vx = Math.cos(ang) * 40; P.vy = Math.sin(ang) * 40;
        P.cx = entVx(hull); P.cy = entVy(hull);
        P.size0 = 5 + R[1] * 5; P.growth = 24 + R[2] * 14; P.life = 1.6 + R[3] * 1.6;
        P.temp = 0.55 * (1 - a / 1.6); P.pal = SMOKE_KIND.SOOT; P.opacity = 0.22; P.age = 0; P.z = 16; P.angle = NaN;
        this._puffStaged();
      }
    }
    // Wygaszanie list (zamiana z ostatnim — bez alokacji).
    for (let i = this.fN - 1; i >= 0; i--) if (time - this.ft0[i] >= this.fd[i * 24]) this._removeFlash(i);
    for (let i = this.sN - 1; i >= 0; i--) if (time - this.st0[i] >= this.sd[i * 9]) this._removeShock(i);
    for (let i = this.bN - 1; i >= 0; i--) if (time - this.bt0[i] >= this.bd[i * 8]) this._removeBlast(i);
    for (let i = this.hN - 1; i >= 0; i--) if (time - this.ht0[i] >= this.hd[i * 5]) this._removeHaze(i);
    this.stats.flashes = this.fN;
    this.stats.fragments = this.gN;
    this.stats.novas = this.nN;
  }

  _removeFlash(i) {
    const last = --this.fN;
    if (i === last) return;
    this.fx_[i] = this.fx_[last]; this.fy_[i] = this.fy_[last]; this.ft0[i] = this.ft0[last];
    this.fd.copyWithin(i * 24, last * 24, last * 24 + 24);
  }

  _removeShock(i) {
    const last = --this.sN;
    if (i === last) return;
    this.sx[i] = this.sx[last]; this.sy[i] = this.sy[last]; this.st0[i] = this.st0[last];
    this.sd.copyWithin(i * 9, last * 9, last * 9 + 9);
  }

  _removeBlast(i) {
    const last = --this.bN;
    if (i === last) return;
    this.bx[i] = this.bx[last]; this.by[i] = this.by[last]; this.bt0[i] = this.bt0[last];
    this.bd.copyWithin(i * 8, last * 8, last * 8 + 8);
  }

  _removeHaze(i) {
    const last = --this.hN;
    if (i === last) return;
    this.hx[i] = this.hx[last]; this.hy[i] = this.hy[last]; this.ht0[i] = this.ht0[last];
    this.hd.copyWithin(i * 5, last * 5, last * 5 + 5);
    this.hNova[i] = this.hNova[last];
  }

  _removeFrag(g) {
    const last = --this.gN;
    if (g === last) return;
    this.gx[g] = this.gx[last]; this.gy[g] = this.gy[last]; this.gt0[g] = this.gt0[last];
    this.gd.copyWithin(g * 9, last * 9, last * 9 + 9);
  }

  _removeScorch(c) {
    const last = --this.cN;
    if (c !== last) {
      this.cHull[c] = this.cHull[last];
      this.ct0[c] = this.ct0[last];
      this.cd.copyWithin(c * 5, last * 5, last * 5 + 5);
    }
    this.cHull[last] = null;
  }

  /** Punkt przypalenia w świecie (poza kadłuba: gracz interpolowany, NPC fizyczna). */
  _scorchWorld(c) {
    const h = this.cHull[c];
    let hx = entX(h);
    let hy = entY(h);
    let ha = Number(h?.angle) || 0;
    if (typeof window !== 'undefined' && h === window.ship && window.__interpShipPose) {
      const p = window.__interpShipPose;
      hx = p.x; hy = p.y; ha = p.angle;
    }
    const o = c * 5;
    const lx = this.cd[o];
    const ly = this.cd[o + 1];
    const cs = Math.cos(ha);
    const sn = Math.sin(ha);
    const p = this._p;
    p.x = hx + lx * cs - ly * sn;
    p.y = hy + lx * sn + ly * cs;
    return p;
  }

  _shockRadius(rMax, tauR, speed, a) {
    if (rMax > 0) return rMax * (1 - Math.exp(-a / tauR));
    return speed * a;
  }

  // --- klatka efektów (krok Core3D) ---------------------------------------------

  /**
   * Siły w dymie tej klatki (przed krokiem dymu — stara rama początku `ox, oy` sceny):
   * fale wybuchów i implozje supernowych, ślady rakiet (64 najbliższe kamerze).
   */
  fillForces(rockets, camX, camY, ox, oy) {
    const U = this.smoke.U;
    const time = this.time;
    let nb = 0;
    const A = U.blastA.array;
    const Bv = U.blastB.array;
    const BD = this.bd;
    for (let i = 0; i < this.bN && nb < A.length; i++) {
      const o = i * 8;
      const a = time - this.bt0[i];
      const R = this._shockRadius(BD[o + 2], BD[o + 3], BD[o + 1], a);
      const fade = 1 - a / BD[o];
      const x = this.bx[i] + BD[o + 6] * a;
      const y = this.by[i] + BD[o + 7] * a;
      A[nb].set(x - ox, -y - oy, R, BD[o + 4] * (1 + a * 1.5));
      Bv[nb].set(BD[o + 5] * fade * fade / (1 + R / 900), 0, 0, 0);
      nb++;
    }
    for (let i = 0; i < this.nN && nb < A.length; i++) {
      const a = time - this.nt0[i];
      if (a < 0.26) {
        const t = smooth(a / 0.24);
        A[nb].set(this.nvx[i] - ox, -this.nvy[i] - oy, 0, 60 * NOVA_SCALE);
        Bv[nb].set(5200 * NOVA_SCALE * t, 1, 1500 * NOVA_SCALE, 0);
        nb++;
      }
    }
    U.blastCount.value = nb;
    let nw = 0;
    if (this.opts.wakes && rockets) {
      const idx = this._wakeIdx;
      const d2a = this._wakeD2;
      const cap = idx.length;
      // 64 najbliższe kamerze (wstawianie do posortowanej listy — bez alokacji).
      for (let k = 0; k < rockets.length; k++) {
        const r = rockets[k];
        if (!r.active || r.state !== 'POWERED') continue;
        const ddx = r.position.x - camX;
        const ddy = r.position.z - camY;
        const d2 = ddx * ddx + ddy * ddy;
        if (nw === cap && d2 >= d2a[cap - 1]) continue;
        let j = nw < cap ? nw++ : cap - 1;
        while (j > 0 && d2a[j - 1] > d2) { d2a[j] = d2a[j - 1]; idx[j] = idx[j - 1]; j--; }
        d2a[j] = d2; idx[j] = k;
      }
      const WA = U.wakeA.array;
      const WB = U.wakeB.array;
      for (let w = 0; w < nw; w++) {
        const r = rockets[idx[w]];
        const ri = r.index;
        const bs = Number(r.bodyScale) || 1;
        const L = ROCKET_BODY_LENGTH * bs;
        const c = this.hc[ri];
        const s = this.hs[ri];
        const back = Math.min(260, this.spd[ri] * 0.05);
        const px = r.position.x;
        const py = r.position.z;
        WA[w].set(px - c * back - ox, -(py - s * back) - oy, px + c * L - ox, -(py + s * L) - oy);
        WB[w].set(30 * Math.sqrt(bs) + 10, 26, (r.velocity.x + r.frameVel.x) * 0.25, -(r.velocity.z + r.frameVel.z) * 0.25);
      }
    }
    U.wakeCount.value = nw;
  }

  /** Światła klatki (dysze, błyski, odłamki, przypalenia, supernowe) i wysyłka do siatki. */
  addLights(grid, rockets) {
    this.stageLights(rockets);
    return this.flushLights(grid);
  }

  /**
   * Światła klatki do bufora roboczego (świat gry: x, y, z, zasięg, r, g, b, rozproszenie) —
   * bez wywołań z liczbami w argumentach; siatkę dostają w flushLights (krok „rakiety” woła
   * oba osobno: mała funkcja wysyłki ma własny budżet wklejania, więc addWorld się w niej
   * wkleja i liczby nie są opakowywane w obiekty).
   */
  stageLights(rockets) {
    const time = this.time;
    const LB = this._lb;
    let ln = 0;
    if (rockets) {
      for (let k = 0; k < rockets.length && ln < LIGHT_STAGE; k++) {
        const r = rockets[k];
        if (!r.active || r.state !== 'POWERED') continue;
        const i = r.index;
        const kind = this.kind[i];
        const Lt = MISSILE_VFX[VFX_KEYS[kind]].light;
        const bl = ROCKET_BODY_LENGTH * (Number(r.bodyScale) || 1);
        const flick = 0.9 + 0.1 * Math.sin(time * 33 + this.seed[i] * 20);
        let I = Lt.intensity * (0.45 + 0.55 * this.thr[i]) * flick;
        if (kind === VFX_NOVA && r.guidancePhase === 'terminal') I *= 1 + 1.5 * novaPulse(this.termT[i]);
        // Światło dyszy na wysokości rakiety: tuż po zapłonie nad pokładem plama światła na kadłubie
        // jest ostra, a gdy rakieta się wznosi — szersza i słabsza.
        const cpl = Math.cos(Number(r.nosePitch) || 0);
        const q = ln++ * 8;
        LB[q] = r.position.x - this.hc[i] * bl * 1.4 * cpl; LB[q + 1] = r.position.z - this.hs[i] * bl * 1.4 * cpl;
        LB[q + 2] = 40 + r.position.y; LB[q + 3] = Lt.range;
        LB[q + 4] = Lt.color[0] * I; LB[q + 5] = Lt.color[1] * I; LB[q + 6] = Lt.color[2] * I; LB[q + 7] = 0.9;
      }
    }
    const F = this.fd;
    for (let i = 0; i < this.fN && ln < LIGHT_STAGE; i++) {
      const o = i * 24;
      if (!F[o + 13]) continue;
      const a = time - this.ft0[i];
      const I = F[o + 17] * Math.exp(-a / F[o + 18]) + F[o + 19] * Math.exp(-a / F[o + 20]);
      if (I < 0.01) continue;
      const q = ln++ * 8;
      LB[q] = this.fx_[i] + F[o + 1] * a; LB[q + 1] = this.fy_[i] + F[o + 2] * a;
      LB[q + 2] = F[o + 22]; LB[q + 3] = F[o + 21] * (0.6 + 0.4 * Math.min(1, a / 0.15));
      LB[q + 4] = F[o + 14] * I; LB[q + 5] = F[o + 15] * I; LB[q + 6] = F[o + 16] * I; LB[q + 7] = 1.0;
    }
    const G = this.gd;
    for (let g = 0; g < this.gN && ln < LIGHT_STAGE; g++) {
      const o = g * 9;
      const a = time - this.gt0[g];
      const h = G[o + 7] * (1 - a / G[o + 4]);
      if (h < 0.05) continue;
      const q = ln++ * 8;
      LB[q] = this.gx[g]; LB[q + 1] = this.gy[g]; LB[q + 2] = 30; LB[q + 3] = 260 * G[o + 8];
      LB[q + 4] = 1.0 * h; LB[q + 5] = 0.45 * h; LB[q + 6] = 0.15 * h; LB[q + 7] = 0.8;
    }
    for (let c = 0; c < this.cN && ln < LIGHT_STAGE; c++) {
      const a = time - this.ct0[c];
      const h = Math.exp(-a / 0.7);
      if (h < 0.03) continue;
      const p = this._scorchWorld(c);
      const q = ln++ * 8;
      LB[q] = p.x; LB[q + 1] = p.y; LB[q + 2] = 24; LB[q + 3] = 320;
      LB[q + 4] = 1.1 * h; LB[q + 5] = 0.45 * h; LB[q + 6] = 0.12 * h; LB[q + 7] = 0.7;
    }
    for (let i = 0; i < this.nN && ln < LIGHT_STAGE; i++) {
      const a = time - this.nt0[i];
      // Implozja: narasta do detonacji; potem błysk gaśnie (e^(−t/1,6)), zasięg na pół kadru;
      // pulsar dokłada migotanie w rytm snopów, dopóki kręci się wir.
      const implode = a < 0.24;
      const pb = a - 0.24;
      const ps = Math.max(0, Math.sin(pb * TAU * 6.5));
      const I = implode ? 3 * smooth(a / 0.24) : 1.4 * Math.exp(-pb / 0.8) + 0.3 * Math.exp(-pb / 1.0) * (0.5 + 0.5 * ps * ps);
      if (!implode && !(I > 0.02)) continue;
      const q = ln++ * 8;
      LB[q] = this.nvx[i]; LB[q + 1] = this.nvy[i]; LB[q + 2] = (implode ? 60 : 80) * NOVA_SCALE; LB[q + 3] = (implode ? 1400 : 2600) * NOVA_SCALE;
      LB[q + 4] = (implode ? 0.8 : 0.6) * I; LB[q + 5] = (implode ? 0.6 : 0.75) * I; LB[q + 6] = I; LB[q + 7] = 1.0;
    }
    this._lN = ln;
    return ln;
  }

  /** Bufor świateł → siatka (grid.addWorld): ciasna pętla; zwraca liczbę przyjętych świateł. */
  flushLights(grid) {
    const LB = this._lb;
    const ln = this._lN;
    let n = 0;
    for (let k = 0; k < ln; k++) {
      const o = k * 8;
      if (grid.addWorld(LB[o], LB[o + 1], LB[o + 2], LB[o + 3], LB[o + 4], LB[o + 5], LB[o + 6], LB[o + 7]) >= 0) n++;
    }
    this.stats.lights = n;
    return n;
  }

  /** Kadłubki i płomienie rakiet w locie (lokalnie względem początku pul ox, oy). */
  addMissiles(rockets, ox, oy) {
    const tl = this.time - this.epoch;
    const bodies = this.bodies;
    const plumes = this.plumes;
    const B = bodies.s;
    const Q = plumes.s;
    for (let k = 0; k < rockets.length; k++) {
      const r = rockets[k];
      if (!r.active) continue;
      const i = r.index;
      const kind = this.kind[i];
      const vfx = MISSILE_VFX[VFX_KEYS[kind]];
      const bs = Number(r.bodyScale) || 1;
      const L = ROCKET_BODY_LENGTH * bs;
      const px = r.position.x;
      const py = r.position.z;
      if (this._outside(px, py, 600)) continue;
      const c = this.hc[i];
      const s = this.hs[i];
      const on = r.state === 'POWERED';
      const band = kind === VFX_NOVA ? vfx.body.band : (this.hostile[i] ? BAND_HOSTILE : BAND_FRIENDLY);
      // Wysokość: kadłubek na z sceny nad płaszczyzną (kamery 3D) i skrót perspektywy z góry.
      const hgt = r.position.y > 0 ? r.position.y : 0;
      const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
      const Ll = L * lift;
      const pitch = Number(r.nosePitch) || 0;
      const cp = Math.cos(pitch);
      // Kąt sceny = −kurs: cos(−h) = c, sin(−h) = −s; wzniesienie nosa — ku kamerze (+z sceny).
      B.x = px - ox; B.y = -py - oy; B.z = 44 + hgt; B.cos = c; B.sin = -s; B.length = Ll;
      B.pitchCos = cp; B.pitchSin = Math.sin(pitch);
      B.glow = on ? 1 : 0; B.roll = tl * 3.5 + this.seed[i] * TAU;
      bodies.push(vfx.body.hull, band);
      // Nos w górę: płomień schowany pod kadłubkiem (z góry widać łunę — addGlows), skrót strugi cos(el).
      if (!on || cp < 0.12) continue;
      const P = vfx.plume;
      const fl = this.flick[i];
      const flick = 0.9 + 0.1 * Math.sin(tl * 41 + fl) * Math.sin(tl * 27 + fl * 3);
      const thr = this.thr[i];
      const t = Number(r.timeSinceLaunch) || 0;
      // Kierunek strugi w scenie: od dyszy do tyłu (świat (−c, −s) → scena (−c, s)).
      Q.x = px - c * Ll * 0.5 * cp - ox; Q.y = -(py - s * Ll * 0.5 * cp) - oy; Q.z = 46 + hgt; Q.dx = -c; Q.dy = s;
      Q.len = Ll * P.len * cp * (0.5 + 0.5 * thr) * flick * (kind === VFX_NOVA ? 1 : (0.8 + 0.2 * Math.min(1, t * 2)));
      Q.width = Ll * P.width; Q.throttle = Math.max(0.2, thr); Q.kind = P.kind; Q.seed = this.seed[i]; Q.intensity = 1;
      plumes.push(P.core, P.hot, P.mid);
    }
  }

  /** Duszki blasku: błyski, głowice supernowych, odłamki, przypalenia, jądro supernowej. */
  addGlows(rockets, ox, oy) {
    const glow = this.glow;
    const S = glow.s;
    const time = this.time;
    const F = this.fd;
    for (let i = 0; i < this.fN; i++) {
      const o = i * 24;
      const a = time - this.ft0[i];
      const x = this.fx_[i] + F[o + 1] * a - ox;
      const y = -(this.fy_[i] + F[o + 2] * a) - oy;
      const kc = Math.exp(-a / F[o + 7]);
      const kh = Math.exp(-a / F[o + 12]);
      if (kh > 0.004) {
        S.x = x; S.y = y; S.z = 90; S.size = F[o + 11] * (0.7 + 0.6 * Math.min(1, a / 0.2));
        S.r = F[o + 8] * kh; S.g = F[o + 9] * kh; S.b = F[o + 10] * kh;
        glow.push();
      }
      if (kc > 0.004) {
        S.x = x; S.y = y; S.z = 92; S.size = F[o + 6] * (0.8 + a * 3);
        S.r = F[o + 3] * kc; S.g = F[o + 4] * kc; S.b = F[o + 5] * kc;
        glow.push();
      }
    }
    if (rockets) {
      for (let k = 0; k < rockets.length; k++) {
        const r = rockets[k];
        if (!r.active) continue;
        const i = r.index;
        const kind = this.kind[i];
        const bs = Number(r.bodyScale) || 1;
        const bl = ROCKET_BODY_LENGTH * bs;
        const hgt = r.position.y > 0 ? r.position.y : 0;
        const pitch = Number(r.nosePitch) || 0;
        const sp = Math.sin(pitch);
        if (r.state === 'POWERED' && sp > 0.3 && !this._outside(r.position.x, r.position.z, 400)) {
          // Nos w górę po zapłonie: dysza patrzy w pokład — z góry nie widać płomienia, tylko łunę
          // w obłoku spalin pod rakietą (gaśnie, gdy rakieta kładzie się w kurs i płomień wychodzi spod kadłubka).
          const lift = 1 + LIFT_K * (hgt < LIFT_H ? hgt / LIFT_H : 1);
          const hot = MISSILE_VFX[VFX_KEYS[kind]].plume.hot;
          const kk = (sp - 0.3) / 0.7 * (0.55 + 0.45 * this.thr[i]) * (0.85 + 0.15 * Math.sin(time * 37 + this.seed[i] * 20));
          const cp = Math.cos(pitch);
          S.x = r.position.x - this.hc[i] * bl * 0.5 * cp - ox; S.y = -(r.position.z - this.hs[i] * bl * 0.5 * cp) - oy; S.z = 45 + hgt;
          S.size = 20 * bs * lift; S.r = hot[0] * 1.4 * kk; S.g = hot[1] * 1.4 * kk; S.b = hot[2] * 1.4 * kk;
          glow.push();
        }
        if (kind !== VFX_NOVA) continue;
        let kk = 1.0 + 0.2 * Math.sin(time * 9 + this.seed[i] * 10);
        if (r.guidancePhase === 'terminal') kk += 2.2 * novaPulse(this.termT[i]);
        const cpn = Math.cos(pitch);
        S.x = r.position.x + this.hc[i] * bl * 0.42 * cpn - ox; S.y = -(r.position.z + this.hs[i] * bl * 0.42 * cpn) - oy; S.z = 52 + hgt;
        S.size = 11 * bs; S.r = 2.0 * kk; S.g = 0.6 * kk; S.b = 2.2 * kk;
        glow.push();
      }
    }
    const G = this.gd;
    for (let g = 0; g < this.gN; g++) {
      const o = g * 9;
      const a = time - this.gt0[g];
      const h = G[o + 7] * (1 - a / G[o + 4]);
      if (h < 0.03) continue;
      // Żarzący się odłamek: mały punkt (smugę robi jego dym).
      S.x = this.gx[g] - ox; S.y = -this.gy[g] - oy; S.z = 40; S.size = 6 * G[o + 8];
      S.r = 3.4 * h; S.g = 1.5 * h; S.b = 0.45 * h;
      glow.push();
    }
    const C = this.cd;
    for (let c = 0; c < this.cN; c++) {
      const o = c * 5;
      const a = time - this.ct0[c];
      const t = a / C[o + 2];
      const hot = Math.exp(-a / 0.35);
      const warm = Math.exp(-a / 1.2) * (1 - t);
      const p = this._scorchWorld(c);
      S.x = p.x - ox; S.y = -p.y - oy; S.z = 8; S.size = C[o + 3] * (1 + 0.4 * Math.min(1, a));
      S.r = 3.2 * hot + 1.0 * warm; S.g = 1.6 * hot + 0.3 * warm; S.b = 0.6 * hot + 0.05 * warm;
      glow.push();
    }
    for (let i = 0; i < this.nN; i++) {
      const a = time - this.nt0[i];
      const x = this.nvx[i] - ox;
      const y = -this.nvy[i] - oy;
      if (a < 0.24) {
        const t = smooth(a / 0.24);
        S.x = x; S.y = y; S.z = 94; S.size = (10 + 40 * t) * NOVA_SCALE; S.r = 8 + 22 * t; S.g = 7 + 18 * t; S.b = 10 + 24 * t;
        glow.push();
      } else {
        const b = a - 0.24;
        // Stygnące jądro z pulsowaniem (pulsar) — świeci przez całe życie wiru, gaśnie z nim.
        const core = Math.exp(-b / 0.6) * 0.7 + 0.3 * Math.exp(-b / 1.0);
        const sp = Math.max(0, Math.sin(b * TAU * 6.5));
        const sp2 = sp * sp;
        const pul = core * (0.6 + 0.4 * sp2 * sp2 * sp2);
        S.x = x; S.y = y; S.z = 93; S.size = 26 * NOVA_SCALE; S.r = 6 * pul; S.g = 7 * pul; S.b = 10 * pul;
        glow.push();
        const hot = Math.exp(-b / 0.7);
        S.x = x; S.y = y; S.z = 91; S.size = (420 + 900 * (1 - Math.exp(-b / 0.5))) * NOVA_SCALE; S.r = 0.18 * hot; S.g = 0.26 * hot; S.b = 0.42 * hot;
        glow.push();
        // Snopy pulsara: dwie przeciwne smugi z jądra wzdłuż osi dżetów (ta sama oś, która kreśli
        // spiralę cząstek w mgławicy) — obracają się jak latarnia, błyskają w rytm pulsu.
        const beamK = Math.min(1, b / 0.25) * Math.exp(-b / 0.8) * (0.55 + 0.45 * sp2);
        if (beamK > 0.01) {
          const th = this.nJetA[i] + this.nJetW[i] * b;
          const len = (300 + 520 * Math.min(1, b / 0.8)) * NOVA_SCALE;
          const ux = Math.cos(th);
          const uy = Math.sin(th);
          const Pb = PULSAR_BEAM;
          for (let side = -1; side <= 1; side += 2) {
            // Jasny koniec smugi (+kierunek) w jądrze: kierunek = −oś, środek = jądro + oś · len / 2.
            // Wąski rdzeń snopu i szeroka, słaba poświata pod nim (snop w pyle pozostałości).
            for (let layer = 0; layer < 2; layer++) {
              const width = (layer === 0 ? 46 : 190) * NOVA_SCALE;
              const k = layer === 0 ? beamK : beamK * 0.16;
              const l = layer === 0 ? len : len * 0.8;
              S.x = x + ux * side * l * 0.5; S.y = y + uy * side * l * 0.5; S.z = 94;
              S.size = width; S.dx = -ux * side; S.dy = -uy * side; S.stretch = l / width;
              S.r = Pb[0] * k; S.g = Pb[1] * k; S.b = Pb[2] * k;
              glow.pushStreak();
            }
          }
        }
      }
    }
  }

  /** Źródła zniekształceń Core3D tej klatki (świat gry): fale, implozje, gorące powietrze. */
  fillDistortion(field) {
    if (!field) return;
    const time = this.time;
    const S = this.sd;
    for (let i = 0; i < this.sN; i++) {
      const o = i * 9;
      const a = time - this.st0[i];
      const R = this._shockRadius(S[o + 2], S[o + 3], S[o + 1], a);
      const k = 1 - a / S[o];
      const width = S[o + 4] * (1 + a * 0.8);
      let strength = S[o + 5] * k * k;
      // Fala supernowej: siła w px ekranu z sufitem z grubości frontu na ekranie — przy dalekim
      // zoomie cienki pierścień z dużym przesunięciem zawijałby obraz.
      if (S[o + 8]) strength = Math.min(strength, width * this.zoom * NOVA_SHOCK.capPerWidth);
      field.shock(this.sx[i] + S[o + 6] * a, this.sy[i] + S[o + 7] * a, R, width, strength, S[o + 8] ? 0.45 : 0.35);
    }
    for (let i = 0; i < this.nN; i++) {
      const a = time - this.nt0[i];
      if (a < 0.3) {
        const t = smooth(Math.min(1, a / 0.24));
        const out = a > 0.24 ? 1 - (a - 0.24) / 0.06 : 1;
        field.implode(this.nvx[i], this.nvy[i], 720 * NOVA_SCALE, 30 * t * Math.max(0, out), 0.35);
      }
    }
    const H = this.hd;
    for (let i = 0; i < this.hN; i++) {
      const o = i * 5;
      const a = time - this.ht0[i];
      const k = 1 - a / H[o];
      let strength = H[o + 2] * k;
      const nova = this.hNova[i] === 1;
      if (nova) strength = Math.min(strength, this.zoom * NOVA_HAZE.capPerZoom);
      field.heat(this.hx[i] + H[o + 3] * a, this.hy[i] + H[o + 4] * a, H[o + 1] * (1 + a * 0.6), strength,
        0, 0, 1, 0, 0, nova ? NOVA_HAZE.scale : 1);
    }
  }

  /** Czy reżyser ma żywe efekty (poza pulami GPU): błyski, fale, odłamki, przypalenia, supernowe. */
  get busy() {
    return this.fN > 0 || this.sN > 0 || this.bN > 0 || this.hN > 0 || this.gN > 0 || this.cN > 0 || this.nN > 0;
  }

  clear() {
    this.fN = 0; this.bN = 0; this.sN = 0; this.hN = 0; this.gN = 0; this.nN = 0;
    for (let c = 0; c < this.cN; c++) this.cHull[c] = null;
    this.cN = 0;
    this.bloomBoost = 0;
    this.exposure = 1;
  }
}

const BLAST_CORE = Object.freeze([14, 11, 8]);
const BLAST_HALO = Object.freeze([0.6, 0.38, 0.2]);
const SHIELD_CORE = Object.freeze([6.5, 8.0, 10.5]);
