// src/3d/railgunFx3D.js
//
// Efekt wystrzału, smugi i cięcia Hexlance'a — port z dema
// `dema/railgun-fx-demo.html`. Pule cząstek są wspólne z błyskami wylotowymi
// (`fxParticles3D.js`); tutaj zostają wyłącznie recepty i smuga świata, bo
// tylko ona jest specyficzna dla pocisku kinetycznego.
//
// Wycięte z portu:
//   * ChunkPool (płatki sabotu jako siatki) — 28 osobnych draw calli w passie
//     Ortho, który jest związany submisją. Płatki lecą teraz jako iskry.
//   * FlashLights (PointLight) — gra trzyma `enginePointLights: false`
//     i BEAM_ENABLE_IMPACT_LIGHT = false, dynamiczne światła są tu wyłączone
//     z rozmysłem.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
  Fx3D, FX_PLANE_Z, FX_WASH_Z,
  clamp01, lerp, rand, makeBasis, coneDir, sp
} from './fxParticles3D.js';
import { SlugTrail } from './slugTrail3D.js';

/* ============================================================================
   KONFIGURACJA
   ========================================================================== */

// Skala świata. Odniesienie z dema: kadłub demowego okrętu ma ~660 jednostek
// od dysz do wylotu. Atlas renderuje się na 1800 jednostek długości
// (HULL_RENDER_PROFILES.atlas.length 3000 × HULL_RENDER_WORLD_SCALE 0.6),
// więc 1800/660 ≈ 2,7 — zaokrąglone w górę, bo Hexlance ma czytać jak działo
// oblężnicze, nie jak wieżyczka.
const DEFAULT_SCALE = 3.0;

export const RAILGUN_FX_CONFIG = {
  intensity: 1.0,     // siła wystrzału
  lance: 1.0,         // długość lancy plazmy z wylotu
  spread: 0.10,       // półkąt stożka wylotowego w radianach — railgun sypie DO PRZODU
  trailOpacity: 1.0,
  trailLife: 3.5,     // sekundy — tyle wisi ślad po przelocie
  trailWidth: 1.0,
  turbulence: 0.45,   // meandry i poszarpanie smugi z wiekiem
  // Widok jest ortho z góry: ruch w osi Z nie zmienia pozycji na ekranie.
  // W demie (kamera 20° od pionu) spłaszczenie 0,25 było na miejscu, tutaj
  // stożek musi rozchodzić się PO płaszczyźnie gry, żeby było go widać.
  flatten: 0.18
};

/* ============================================================================
   RECEPTY — co i w jakim kolorze wysypać z pul banku.
   Cała rzecz idzie DO PRZODU: stożki mają półkąt ~0,1 rad, nie ma kuli ognia
   ani obłoku na boki. To, co widać najdłużej, to lanca plazmy i smuga pocisku.
   ========================================================================== */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _railL0 = new THREE.Vector3();
const _railL1 = new THREE.Vector3();
const _railR0 = new THREE.Vector3();
const _railR1 = new THREE.Vector3();

class RailgunFX {
  constructor(scene, cfg, scale = 1) {
    this.cfg = cfg;
    this.S = scale;
    this.trail = new SlugTrail(scene, cfg, 4096, 6, scale, 'HEXLANCE_SLUG_TRAILS');
    this._chargeT = 0;
  }

  // Zegar banku: podczas updateSuperweapon stoi jeszcze na początku klatki,
  // bo bank przesuwa się dopiero w passie renderu.
  get now() { return Fx3D.time; }

  /* ----------------------------------------------------------------------
     ŁADOWANIE — energia biegnie szynami do wylotu, między szynami przeskakują
     łuki. Im bliżej strzału, tym gęściej.
     -------------------------------------------------------------------- */
  charge(muzzle, dir, l0, l1, r0, r1, dt, u) {
    const S = this.S;
    makeBasis(dir);
    let o;

    // impulsy energii pędzące szynami ku wylotowi
    const rate = (8 + 90 * u * u) * dt;
    for (let k = 0, n = Math.round(rate) + (Math.random() < rate % 1 ? 1 : 0); k < n; k++) {
      const left = Math.random() < 0.5;
      const t = rand(0, 0.9);
      _v1.lerpVectors(left ? l0 : r0, left ? l1 : r1, t);
      _v2.copy(dir).multiplyScalar(rand(500, 1400) * S);
      Fx3D.spark.spawn(_v1, _v2, rand(0.12, 0.3), 0.2, rand(40, 110) * S,
        [1.4, 2.6, 3.9], 1.05, 1.25);
    }

    // przeskoki między szynami
    this._chargeT -= dt;
    if (this._chargeT <= 0) {
      this._chargeT = lerp(0.16, 0.02, u);
      const t = Math.random();
      _v1.lerpVectors(l0, l1, t);
      _v2.lerpVectors(r0, r1, t);
      Fx3D.arcs.spawn(_v1, _v2, rand(0.05, 0.16), rand(2, 10) * (0.3 + u) * S, [1.2 * u + 0.4, 2.3, 3.8]);
    }

    // narastająca poświata w wylocie
    if (Math.random() < 22 * dt) {
      o = sp();
      o.x = muzzle.x; o.y = muzzle.y; o.z = muzzle.z;
      o.life = 0.11; o.drag = 0;
      o.s0 = (16 + 90 * u * u) * S; o.s1 = (12 + 70 * u * u) * S;
      o.rot = rand(0, 6.283); o.vrot = rand(-2, 2);
      o.r0 = 1.0 + 2.2 * u; o.g0 = 1.8 + 1.8 * u; o.b0 = 2.8 + 1.6 * u;
      o.r1 = 0.3; o.g1 = 0.9; o.b1 = 1.8; o.mix = 9;
      o.alpha = 0.3 + 0.6 * u; o.fadeIn = 0.02; o.fadeOut = 1.5; o.grow = 0.7;
      Fx3D.star.spawn(o);
    }
  }

  /* ----------------------------------------------------------------------
     WYSTRZAŁ
     -------------------------------------------------------------------- */
  fire(muzzle, dir, power = 1) {
    const S = this.S;
    const C = this.cfg;
    const FL = C.flatten;
    const I = C.intensity * power;
    const L = C.lance;
    const SPR = C.spread;
    makeBasis(dir);
    let o;

    // rdzeń
    o = sp();
    o.x = muzzle.x; o.y = muzzle.y; o.z = muzzle.z;
    o.vx = dir.x * 220 * S; o.vy = dir.y * 220 * S; o.vz = dir.z * 220 * S;
    o.life = 0.14; o.drag = 5;
    o.s0 = 34 * S; o.s1 = (130 + 90 * I) * S;
    o.r0 = 3.8; o.g0 = 4.1; o.b0 = 4.5;
    o.r1 = 0.8; o.g1 = 1.9; o.b1 = 3.3; o.mix = 13;
    o.alpha = 1; o.fadeIn = 0.004; o.fadeOut = 2.1; o.grow = 0.38;
    Fx3D.glow.spawn(o);

    // łuna
    o = sp();
    o.x = muzzle.x + dir.x * 60 * S; o.y = muzzle.y + dir.y * 60 * S; o.z = muzzle.z + dir.z * 60 * S;
    o.vx = dir.x * 130 * S; o.vy = dir.y * 130 * S; o.vz = dir.z * 130 * S;
    o.life = 0.40; o.drag = 3.4;
    o.s0 = 70 * S; o.s1 = (280 + 190 * I) * S;
    o.r0 = 1.0; o.g0 = 2.1; o.b0 = 3.5;
    o.r1 = 0.10; o.g1 = 0.30; o.b1 = 0.85; o.mix = 4.5;
    o.alpha = 0.7; o.fadeIn = 0.008; o.fadeOut = 1.9; o.grow = 0.48;
    Fx3D.glow.spawn(o);

    // flara
    o = sp();
    o.x = muzzle.x; o.y = muzzle.y; o.z = muzzle.z;
    o.life = 0.18; o.drag = 6;
    o.s0 = 130 * S; o.s1 = (380 + 220 * I) * S;
    o.rot = rand(0, 6.283); o.vrot = rand(-0.8, 0.8);
    o.r0 = 3.2; o.g0 = 3.6; o.b0 = 4.4;
    o.r1 = 1.0; o.g1 = 2.0; o.b1 = 3.4; o.mix = 11;
    o.alpha = 0.95; o.fadeIn = 0.005; o.fadeOut = 2.5; o.grow = 0.35;
    Fx3D.star.spawn(o);

    // krzyż wzdłuż osi — bardzo długi, wąski, anamorficzny
    Fx3D.cross.spawn(muzzle, dir, 0.20, 240 * S, (880 + 520 * I) * L * S,
      55 * S, (95 + 55 * I) * S, [2.5, 3.2, 4.4], 1.0);

    // LANCA PLAZMY — cztery warstwy, wszystkie do przodu
    Fx3D.plume.spawn(muzzle, dir, 0.30, 140 * S, (600 + 340 * I) * L * S, 24 * S, 44 * S, [3.3, 3.9, 4.7], 1.0);
    Fx3D.plume.spawn(muzzle, dir, 0.44, 100 * S, (410 + 250 * I) * L * S, 48 * S, 100 * S, [0.85, 2.1, 3.7], 0.85);
    Fx3D.plume.spawn(muzzle, dir, 0.62, 70 * S, (250 + 160 * I) * L * S, 95 * S, 205 * S, [0.32, 0.85, 2.1], 0.45);
    Fx3D.plume.spawn(muzzle, dir, 0.17, 45 * S, 160 * L * S, 115 * S, 250 * S, [2.4, 3.0, 4.2], 0.7);

    // rozlanie światła po poszyciu
    _v1.set(muzzle.x, muzzle.y, FX_WASH_Z);
    Fx3D.wash.spawn(_v1, dir, 0.42, 160 * S, (680 + 320 * I) * L * S, 70 * S, (130 + 60 * I) * S, [0.5, 1.4, 2.8], 0.55);

    // plazma wyrzucona przed wylot
    for (let i = 0; i < 44; i++) {
      coneDir(_v2, dir, SPR, FL);
      const v = rand(260, 900) * S * (0.7 + 0.4 * I);
      o = sp();
      o.x = muzzle.x + _v2.x * rand(0, 60) * S;
      o.y = muzzle.y + _v2.y * rand(0, 60) * S;
      o.z = muzzle.z + _v2.z * rand(0, 60) * S;
      o.vx = _v2.x * v; o.vy = _v2.y * v; o.vz = _v2.z * v;
      o.life = rand(0.3, 0.85); o.drag = 1.6;
      o.s0 = rand(10, 26) * S; o.s1 = rand(50, 130) * S;
      o.rot = rand(0, 6.283); o.vrot = rand(-1.6, 1.6);
      o.r0 = 2.2; o.g0 = 3.0; o.b0 = 4.2;
      o.r1 = 0.22; o.g1 = 0.30; o.b1 = 0.85; o.mix = 3.4;
      o.alpha = rand(0.4, 0.8); o.fadeIn = 0.02; o.fadeOut = 1.8; o.grow = 0.5;
      Fx3D.glow.spawn(o);
    }

    // strugi jonów — długie smugi, wąski snop
    for (let i = 0, n = Math.round(150 * I); i < n; i++) {
      coneDir(_v2, dir, SPR * (Math.random() < 0.15 ? 2.4 : 0.8), FL);
      const v = rand(500, 1900) * S * (0.7 + 0.4 * I);
      _v3.copy(_v2).multiplyScalar(v);
      _v1.copy(muzzle).addScaledVector(_v2, rand(0, 80) * S);
      Fx3D.spark.spawn(_v1, _v3, rand(0.3, 0.9), rand(0.25, 0.7), rand(45, 150) * S,
        [1.7, 2.7, 3.9], 1.05, 1.2);
    }

    // płatki sabotu — odpadają wąskim stożkiem. W demie były siatkami; tutaj
    // idą jako długożyjące, wolne iskry: pass Ortho jest związany submisją
    // i nie stać go na kilkadziesiąt osobnych brył na strzał.
    for (let i = 0; i < 6; i++) {
      coneDir(_v2, dir, SPR * 2.6, FL);
      const v = rand(160, 420) * S;
      _v3.copy(_v2).multiplyScalar(v);
      _v1.copy(muzzle).addScaledVector(_v2, rand(10, 40) * S);
      Fx3D.spark.spawn(_v1, _v3, rand(1.6, 3.0), 0.25, rand(60, 130) * S, [3.2, 2.0, 0.9], 0.45, 0.12);
    }

    // łuki dogasające między szynami
    for (let i = 0; i < 10; i++) {
      coneDir(_v2, dir, 0.55, FL);
      _v1.copy(muzzle).addScaledVector(_v2, rand(20, 90) * S);
      Fx3D.arcs.spawn(muzzle, _v1, rand(0.12, 0.38), rand(6, 26) * S, [1.4, 2.5, 3.9]);
    }

    // mgła plazmowa — jedyne, co zostaje na dłużej; też dryfuje do przodu
    for (let i = 0; i < 18; i++) {
      coneDir(_v2, dir, SPR * 3.0, FL);
      const v = rand(30, 150) * S;
      o = sp();
      o.x = muzzle.x + _v2.x * rand(0, 120) * S;
      o.y = muzzle.y + _v2.y * rand(0, 120) * S;
      o.z = muzzle.z + _v2.z * rand(0, 120) * S;
      o.vx = _v2.x * v; o.vy = _v2.y * v; o.vz = _v2.z * v;
      o.life = rand(1.1, 2.6); o.drag = 0.9;
      o.s0 = rand(30, 70) * S; o.s1 = rand(130, 290) * S;
      o.rot = rand(0, 6.283); o.vrot = rand(-0.4, 0.4);
      o.r0 = 0.55; o.g0 = 1.25; o.b0 = 2.1;
      o.r1 = 0.14; o.g1 = 0.09; o.b1 = 0.34; o.mix = 1.3;
      o.alpha = rand(0.10, 0.24); o.fadeIn = 0.06; o.fadeOut = 1.5; o.grow = 0.45;
      Fx3D.vapor.spawn(o);
    }
  }

  /* ----------------------------------------------------------------------
     POCISK — iskry ablacyjne i rozgrzany czubek na przebytym odcinku
     -------------------------------------------------------------------- */
  slugStep(state, from, to, dir, vel, t0, t1) {
    const S = this.S;
    const C = this.cfg;
    if (state.emitter >= 0) this.trail.advance(state.emitter, from, to, t0, t1, dir);

    // iskry ablacyjne zdzierane z pocisku — rozmieszczane po drodze, nie co klatkę
    const seg = from.distanceTo(to);
    const step = 180 * S;
    state.sparkAcc += seg;
    while (state.sparkAcc >= step) {
      state.sparkAcc -= step;
      const f = seg > 1e-6 ? 1 - state.sparkAcc / seg : 1;
      _v1.lerpVectors(from, to, clamp01(f));
      makeBasis(dir);
      coneDir(_v2, dir, 1.9, C.flatten);
      _v3.copy(_v2).multiplyScalar(rand(60, 260) * S).addScaledVector(dir, -rand(40, 200) * S);
      Fx3D.spark.spawn(_v1, _v3, rand(0.25, 0.7), rand(0.5, 1.4), rand(15, 50) * S,
        [2.2, 2.8, 3.8], 1.0, 1.1);
    }

    // rozgrzany czubek — halo leci z prędkością pocisku, więc przy 12000 j/s
    // nie rozsypuje się w szereg kropek
    const o = sp();
    o.x = to.x; o.y = to.y; o.z = to.z;
    o.vx = vel.x; o.vy = vel.y; o.vz = vel.z;
    o.life = 0.05; o.drag = 0;
    o.s0 = 40 * C.trailWidth * S; o.s1 = 32 * C.trailWidth * S;
    o.r0 = 3.4; o.g0 = 3.8; o.b0 = 4.6;
    o.r1 = 1.6; o.g1 = 2.5; o.b1 = 3.8; o.mix = 12;
    o.alpha = 1; o.fadeIn = 0.01; o.fadeOut = 0.8; o.grow = 1;
    Fx3D.glow.spawn(o);
  }

  /* ----------------------------------------------------------------------
     TRAFIENIE — wejście w poszycie
     -------------------------------------------------------------------- */
  impact(pos, dir, power = 1) {
    const S = this.S;
    const C = this.cfg;
    const FL = C.flatten;
    const I = C.intensity * power;
    makeBasis(dir);
    let o;

    o = sp();
    o.x = pos.x; o.y = pos.y; o.z = pos.z;
    o.life = 0.16; o.drag = 5;
    o.s0 = 30 * S; o.s1 = (180 + 120 * I) * S;
    o.r0 = 4.0; o.g0 = 3.6; o.b0 = 3.0;
    o.r1 = 2.4; o.g1 = 0.9; o.b1 = 0.3; o.mix = 11;
    o.alpha = 1; o.fadeIn = 0.004; o.fadeOut = 2.0; o.grow = 0.4;
    Fx3D.glow.spawn(o);

    Fx3D.cross.spawn(pos, dir, 0.2, 150 * S, (500 + 300 * I) * S, 80 * S, (150 + 70 * I) * S, [3.0, 2.2, 1.4], 0.9);
    Fx3D.plume.spawn(pos, dir, 0.35, 90 * S, (330 + 200 * I) * S, 50 * S, 150 * S, [2.8, 1.6, 0.7], 0.9);

    // przebicie: materiał wyrzucany dalej w tę samą stronę + krótszy odprysk wstecz
    for (let i = 0, n = Math.round(40 * I); i < n; i++) {
      coneDir(_v2, dir, 0.45, FL);
      const v = rand(150, 700) * S;
      o = sp();
      o.x = pos.x; o.y = pos.y; o.z = pos.z;
      o.vx = _v2.x * v; o.vy = _v2.y * v; o.vz = _v2.z * v;
      o.life = rand(0.3, 0.9); o.drag = 1.8;
      o.s0 = rand(8, 20) * S; o.s1 = rand(40, 110) * S;
      o.rot = rand(0, 6.283); o.vrot = rand(-2, 2);
      o.r0 = 2.8; o.g0 = 1.5; o.b0 = 0.55;
      o.r1 = 0.45; o.g1 = 0.12; o.b1 = 0.03; o.mix = 3.2;
      o.alpha = rand(0.45, 0.85); o.fadeIn = 0.02; o.fadeOut = 1.8; o.grow = 0.5;
      Fx3D.glow.spawn(o);
    }
    for (let i = 0, n = Math.round(120 * I); i < n; i++) {
      const back = Math.random() < 0.3;
      coneDir(_v2, back ? _v5.copy(dir).negate() : dir, back ? 1.0 : 0.5, FL);
      const v = (back ? rand(80, 400) : rand(200, 1000)) * S;
      _v3.copy(_v2).multiplyScalar(v);
      Fx3D.spark.spawn(pos, _v3, rand(0.3, 1.0), rand(0.5, 1.4), rand(20, 70) * S, [2.9, 2.2, 1.4]);
    }
    // rozżarzone odpryski poszycia — wolne, długo widoczne, stygną do czerwieni
    for (let i = 0, n = Math.round(6 * I); i < n; i++) {
      coneDir(_v2, dir, 0.8, FL);
      _v3.copy(_v2).multiplyScalar(rand(60, 260) * S);
      Fx3D.spark.spawn(pos, _v3, rand(1.8, 3.4), 0.3, rand(50, 120) * S, [3.0, 1.7, 0.7], 0.4, 0.1);
    }
  }

  /* ----------------------------------------------------------------------
     RZAZ — pocisk siedzi już W poszyciu i tnie dalej. To samo tworzywo co
     `impact()`, ale bez krzyża i lancy: te dwie warstwy to rozbłysk WEJŚCIA,
     a puszczane kilkanaście razy na sekundę zmieniłyby cięcie w stroboskop.
     -------------------------------------------------------------------- */
  kerf(pos, dir, power = 1) {
    const S = this.S;
    const C = this.cfg;
    const FL = C.flatten;
    const I = C.intensity * power;
    makeBasis(dir);

    const o = sp();
    o.x = pos.x; o.y = pos.y; o.z = pos.z;
    o.life = 0.13; o.drag = 6;
    o.s0 = 22 * S; o.s1 = (90 + 60 * I) * S;
    o.r0 = 3.6; o.g0 = 3.0; o.b0 = 2.2;
    o.r1 = 2.0; o.g1 = 0.7; o.b1 = 0.2; o.mix = 12;
    o.alpha = 0.9; o.fadeIn = 0.004; o.fadeOut = 2.2; o.grow = 0.4;
    Fx3D.glow.spawn(o);

    // wiór leci głównie WSTECZ wzdłuż rzazu — tak sypie każde cięcie
    for (let i = 0, n = Math.round(45 * I); i < n; i++) {
      const back = Math.random() < 0.55;
      coneDir(_v2, back ? _v5.copy(dir).negate() : dir, back ? 1.2 : 0.6, FL);
      const v = (back ? rand(120, 620) : rand(200, 900)) * S;
      _v3.copy(_v2).multiplyScalar(v);
      Fx3D.spark.spawn(pos, _v3, rand(0.25, 0.8), rand(0.6, 1.5), rand(18, 60) * S, [2.9, 2.1, 1.2]);
    }
  }

  dispose() { this.trail.dispose(); }
}

/* ============================================================================
   FASADA DLA GRY
   Współrzędne WEJŚCIOWE są w przestrzeni gry (x, y). Scena ortho używa
   (x, -y, z), więc negacja Y żyje wyłącznie tutaj.
   ========================================================================== */

// Szyny działa syntetyzujemy z hardpointu: biegną w głąb kadłuba od wylotu.
// W demie szły od -541 do -36 względem wylotu, rozstaw ±12.
const RAIL_BACK = 541;
const RAIL_FRONT = 36;
const RAIL_HALF = 12;

// Zacięcie klatki nie może rozjechać czasów narodzin węzłów smugi.
const MAX_DT = 0.1;

export const RailgunFX3D = {
  enabled: true,
  scale: DEFAULT_SCALE,
  cfg: RAILGUN_FX_CONFIG,
  _fx: null,

  get available() {
    return this.enabled === true && Fx3D.available;
  },

  _ensure() {
    if (this._fx) return this._fx;
    if (!this.available || !Fx3D.ensure()) return null;
    this._fx = new RailgunFX(Core3D.scene, this.cfg, this.scale);
    // Bufor smugi musi trafić na GPU PO przesunięciu zegara banku, inaczej
    // uTime shadera zostaje o klatkę w tyle za czasem narodzin węzłów.
    Fx3D.addUpdater(trailUpdater);
    return this._fx;
  },

  /* --- ŁADOWANIE: u = 0..1 postępu ładowania ---------------------------- */
  charge(x, y, dirX, dirY, dt, u) {
    const fx = this._ensure();
    if (!fx || !(dt > 0)) return;
    const S = this.scale;
    const len = Math.hypot(dirX, dirY) || 1;
    const dx = dirX / len;
    const dy = -dirY / len;              // scena ma odwrócone Y
    _muzzle.set(x, -y, FX_PLANE_Z);
    _dir.set(dx, dy, 0);
    // szyny: dwie równoległe linie w głąb kadłuba, rozsunięte w poprzek osi
    const px = -dy * RAIL_HALF * S;
    const py = dx * RAIL_HALF * S;
    const b = RAIL_BACK * S;
    const f = RAIL_FRONT * S;
    _railL0.set(_muzzle.x - dx * b + px, _muzzle.y - dy * b + py, FX_PLANE_Z);
    _railL1.set(_muzzle.x - dx * f + px, _muzzle.y - dy * f + py, FX_PLANE_Z);
    _railR0.set(_muzzle.x - dx * b - px, _muzzle.y - dy * b - py, FX_PLANE_Z);
    _railR1.set(_muzzle.x - dx * f - px, _muzzle.y - dy * f - py, FX_PLANE_Z);
    fx.charge(_muzzle, _dir, _railL0, _railL1, _railR0, _railR1, dt, clamp01(u));
  },

  /* --- WYSTRZAŁ --------------------------------------------------------- */
  fire(x, y, dirX, dirY, power = 1) {
    const fx = this._ensure();
    if (!fx) return;
    const len = Math.hypot(dirX, dirY) || 1;
    _muzzle.set(x, -y, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    fx.fire(_muzzle, _dir, power);
  },

  /* --- SMUGA POCISKU ----------------------------------------------------
     Gra prowadzi pocisk sama (superweapon.js), więc smuga dostaje osobne
     API: start, krok po odcinku, domknięcie.
     -------------------------------------------------------------------- */
  beginSlug(x, y, dirX, dirY, speed) {
    const fx = this._ensure();
    if (!fx) return null;
    const e = fx.trail.acquire();
    const len = Math.hypot(dirX, dirY) || 1;
    _muzzle.set(x, -y, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    if (e >= 0) fx.trail.begin(e, _muzzle, fx.now, _dir, Math.abs(speed) || 1);
    return { emitter: e, sparkAcc: 0 };
  },

  // Czasy narodzin węzłów rozkładamy po odcinku między zegarem banku
  // a jego spodziewanym stanem na końcu klatki. Świadomie NIE bierzemy tu
  // dt z pętli gry: bank liczy czas z własnego pomiaru i dwa zegary
  // rozjechałyby się, a wtedy węzły rodziłyby się "w przyszłości"
  // i smuga przestałaby się starzeć.
  stepSlug(state, fromX, fromY, toX, toY, dirX, dirY, velX, velY) {
    const fx = this._fx;
    if (!fx || !state) return;
    const len = Math.hypot(dirX, dirY) || 1;
    _a.set(fromX, -fromY, FX_PLANE_Z);
    _b.set(toX, -toY, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    _vel.set(velX, -velY, 0);
    const step = Math.min(Math.max(0, Fx3D.lastDt), MAX_DT);
    fx.slugStep(state, _a, _b, _dir, _vel, fx.now, fx.now + step);
  },

  endSlug(state, x, y, dirX, dirY) {
    const fx = this._fx;
    if (!fx || !state || state.emitter < 0) return;
    const len = Math.hypot(dirX, dirY) || 1;
    _b.set(x, -y, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    fx.trail.end(state.emitter, _b, fx.now, _dir);
    state.emitter = -1;
  },

  /* --- TRAFIENIE / RZAZ -------------------------------------------------- */
  impact(x, y, dirX, dirY, power = 1) {
    const fx = this._ensure();
    if (!fx) return;
    const len = Math.hypot(dirX, dirY) || 1;
    _b.set(x, -y, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    fx.impact(_b, _dir, power);
  },

  kerf(x, y, dirX, dirY, power = 1) {
    const fx = this._ensure();
    if (!fx) return;
    const len = Math.hypot(dirX, dirY) || 1;
    _b.set(x, -y, FX_PLANE_Z);
    _dir.set(dirX / len, -dirY / len, 0);
    fx.kerf(_b, _dir, power);
  },

  // Powołuje smugę i oddaje jej siatkę — ekran ładowania kompiluje
  // jej shader razem z pulami banku, żeby pierwszy strzał nie gubił klatki.
  prewarm() {
    const fx = this._ensure();
    return fx ? fx.trail.mesh : null;
  },

  // Skala jest wmurowana w smugę przy tworzeniu, więc zmiana wymaga przebudowy.
  // `cfg` da się kręcić bez tego.
  setScale(value) {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0 || next === this.scale) return;
    this.scale = next;
    this.dispose();
  },

  reset() { this._fx?.trail.clear(); },

  dispose() {
    this._fx?.dispose();
    this._fx = null;
  }
};

// Nazwana funkcja, nie domknięcie w miejscu: `Fx3D.addUpdater` odsiewa
// duplikaty po tożsamości, więc przebudowa efektu nie może wpiąć jej drugi raz.
function trailUpdater(dt, time) {
  const fx = RailgunFX3D._fx;
  if (!fx) return;
  fx.trail.expire(time);
  fx.trail.prepare(time);
}

if (typeof window !== 'undefined') window.RailgunFX3D = RailgunFX3D;
