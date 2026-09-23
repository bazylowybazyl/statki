// src/3d/muzzleFx3D.js
//
// Błyski wylotowe z dema `dema/muzzle-fx-3-lufy (1).html`. Dwie recepty:
//
//   * ARMATA PROCHOWA — rozbłysk, gazy, iskry, dym. Idzie na `armata`
//     (barwy dema: biały rdzeń → pomarańcz → sadza) i na `yamato`
//     w wariancie błękitnym.
//   * DZIAŁO JONOWE — zimny rdzeń, długa smuga, łuki, świecący opar, zero dymu.
//     Idzie na `tempest`.
//
// Faza ŁADOWANIA jonowego z dema jest tu świadomie pominięta: Tempest Ion
// w grze strzela od razu, nie ma czego zapowiadać.
//
// Pule cząstek są wspólne z Hexlance'em (`fxParticles3D.js`) — pass Ortho jest
// związany submisją, więc drugi komplet tych samych systemów byłby czystą stratą.

import {
  Fx3D, FX_PLANE_Z, FX_WASH_Z,
  clamp01, rand, makeBasis, coneDir, sp, _bx
} from './fxParticles3D.js';
import { normalizeWeaponFxKey } from '../vfx/turret2D.js';
import * as THREE from 'three';

/* ============================================================================
   KONFIGURACJA
   ========================================================================== */
export const MUZZLE_FX_CONFIG = {
  intensity: 1.0,   // siła rozbłysku armaty
  ion: 1.0,         // siła wyładowania jonowego
  sparks: 1.0,
  smoke: 1.0,
  smokeLife: 0.8,
  soot: 0.35,       // 0 = czarna sadza, 1 = jasny dym prochowy
  ionArcs: 1.0,
  ionVapor: 1.0,
  flare: 1.0,       // gwiazda z promieniami — to ona niesie „flash” wystrzału
  // Widok jest ortho z góry: ruch w Z nie zmienia pozycji na ekranie, więc
  // rozrzut musi iść PO płaszczyźnie gry. W demie (kamera 20° od pionu)
  // spłaszczenie 0,25 było na miejscu, tutaj schodzi niżej.
  flatten: 0.18
};

/* --- PALETY ---------------------------------------------------------------
   Recepta armaty jest jedna, barwy dwie. Wszystkie kolory są HDR (>1): gra
   ma pipeline HDR-first z progiem bloomu ~0,9 i własnym ACES w uberPassie.
   -------------------------------------------------------------------------- */
const PALETTES = {
  // 1:1 z dema — proch: biały rdzeń, pomarańcz, sadza.
  armata: {
    core0: [3.4, 2.7, 2.0], core1: [2.2, 0.85, 0.30],
    halo0: [1.9, 0.95, 0.42], halo1: [0.75, 0.22, 0.05],
    cross: [2.9, 2.0, 1.2],
    plumeOuter: [2.8, 1.6, 0.75], plumeInner: [3.2, 2.4, 1.5],
    wash: [1.5, 0.72, 0.28],
    gas0: [2.5, 1.15, 0.40], gas1: [0.55, 0.16, 0.04],
    smokeHot: [1.7, 0.75, 0.30], puffHot: [1.1, 0.5, 0.22],
    sootTint: [0.96, 0.97, 1.10],
    flare0: [3.2, 2.5, 1.5], flare1: [2.0, 0.80, 0.28],
    spark: [2.8, 2.3, 1.6], sparkCool: [0.32, 0.06],
    ember0: [2.4, 1.0, 0.35], ember1: [1.0, 0.20, 0.04]
  },
  // Ta sama recepta w błękicie — Yamato ma czytać jak działo energetyczne,
  // ale z ciężarem prochowego rozbłysku, nie jak jonowa iglica.
  yamatoBlue: {
    core0: [2.6, 3.2, 4.2], core1: [0.40, 1.15, 2.7],
    halo0: [0.55, 1.35, 2.7], halo1: [0.08, 0.28, 0.90],
    cross: [1.4, 2.4, 3.6],
    plumeOuter: [0.9, 1.9, 3.4], plumeInner: [2.0, 2.9, 4.0],
    wash: [0.35, 0.95, 1.9],
    gas0: [0.60, 1.5, 2.8], gas1: [0.08, 0.20, 0.60],
    smokeHot: [0.50, 1.0, 1.9], puffHot: [0.32, 0.65, 1.25],
    sootTint: [1.02, 1.02, 1.12],
    flare0: [2.4, 3.1, 4.2], flare1: [0.45, 1.30, 2.9],
    spark: [1.7, 2.6, 3.8], sparkCool: [1.0, 1.15],   // nie rudzieje
    ember0: [1.3, 2.2, 3.4], ember1: [0.25, 0.60, 1.5]
  }
};

/* --- PRZYPISANIE DO RODZIN BRONI -----------------------------------------
   Klucze pochodzą z `normalizeWeaponFxKey` (src/vfx/turret2D.js). `scale`
   przelicza jednostki dema na lokalne jednostki wieżyczki: demowa lufa ma
   26 jednostek, armata w grze 35, tempest 20, yamato 40 — plus zapas na to,
   że Yamato ma być największym błyskiem we flocie.
   -------------------------------------------------------------------------- */
const RECIPES = {
  armata: { kind: 'cannon', palette: 'armata', scale: 1.5, power: 1.0, shake: 5.0, shakeTime: 0.22 },
  yamato: { kind: 'cannon', palette: 'yamatoBlue', scale: 2.4, power: 1.25, shake: 7.0, shakeTime: 0.30 },
  tempest: { kind: 'ion', scale: 1.0, power: 1.0, shake: 2.5, shakeTime: 0.14 }
};

/* Wstrząs kamery przez `camera.addShake`, a NIE przez `profile.shake`
   z Turret2D. Tamta ścieżka (`window.__weapon3dCameraShake`) przesuwa
   wyłącznie kamery Three w `Core3D.syncCamera` — kanwa 2D rysuje dalej
   z niewzruszonego `cam`, więc wieżyczki stoją w miejscu, a jedynie
   kadłuby i błyski drgają względem nich. Zamiast uderzenia wychodzi
   rozjechanie warstw. `camera.addShake` rusza całą klatką — tego używa
   Hexlance i stąd różnica w odczuciu.

   `addShake` NADPISUJE, nie sumuje, więc lekki strzał tuż po ciężkim
   skasowałby jego wstrząs. Stąd porównanie z tym, co jeszcze zostało. */
function addCameraShake(mag, dur) {
  const cam = globalThis.camera;
  if (!cam || typeof cam.addShake !== 'function' || !(mag > 0)) return;
  const left = cam.shakeDur > 0 ? cam.shakeMag * Math.max(0, cam.shakeTime / cam.shakeDur) : 0;
  if (mag > left) cam.addShake(mag, dur);
}

// Poniżej tylu pikseli promienia wieżyczki bogaty błysk nie ma co pokazywać —
// zostaje tani błysk instancjonowany z weapon3DSystem.
const MIN_SCREEN_PX = 9;
// Sufit na klatkę: w bitwie flot strzela kilkadziesiąt luf naraz, a jedna
// recepta armaty to ~120 cząstek. Powyżej limitu reszta dostaje tani błysk.
const MAX_PER_FRAME = 10;

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Vector3();

/* ============================================================================
   ARMATA PROCHOWA
   ========================================================================== */
function fireCannon(pos, dir, S, power, pal, density) {
  const C = MUZZLE_FX_CONFIG;
  const FL = C.flatten;
  const I = Math.max(0.0001, C.intensity) * power;
  makeBasis(dir);
  let o;

  // rdzeń rozbłysku — krótki, przepalony
  o = sp();
  o.x = pos.x; o.y = pos.y; o.z = pos.z;
  o.vx = dir.x * 7 * S; o.vy = dir.y * 7 * S; o.vz = dir.z * 7 * S;
  o.life = 0.085; o.drag = 7;
  o.s0 = 4 * S; o.s1 = (11 + 7 * I) * S;
  o.r0 = pal.core0[0]; o.g0 = pal.core0[1]; o.b0 = pal.core0[2];
  o.r1 = pal.core1[0]; o.g1 = pal.core1[1]; o.b1 = pal.core1[2]; o.mix = 16;
  o.alpha = 1; o.fadeIn = 0.004; o.fadeOut = 2.2; o.grow = 0.4;
  Fx3D.glow.spawn(o);

  // szeroka łuna
  o = sp();
  o.x = pos.x + dir.x * 3 * S; o.y = pos.y + dir.y * 3 * S; o.z = pos.z + dir.z * 3 * S;
  o.life = 0.21; o.drag = 5;
  o.s0 = 7 * S; o.s1 = (22 + 14 * I) * S;
  o.r0 = pal.halo0[0]; o.g0 = pal.halo0[1]; o.b0 = pal.halo0[2];
  o.r1 = pal.halo1[0]; o.g1 = pal.halo1[1]; o.b1 = pal.halo1[2]; o.mix = 7;
  o.alpha = 0.8; o.fadeIn = 0.01; o.fadeOut = 2.0; o.grow = 0.5;
  Fx3D.glow.spawn(o);

  // FLARA — gwiazda z promieniami prosto z wylotu. Recepta armaty z dema jej
  // NIE miała (używał jej tylko railgun), a to właśnie ta warstwa daje
  // wrażenie huku: rozbłysk rdzenia sam w sobie jest tylko plamą światła.
  if (C.flare > 0) {
    o = sp();
    o.x = pos.x; o.y = pos.y; o.z = pos.z;
    o.life = 0.13; o.drag = 6;
    o.s0 = (14 + 6 * I) * S; o.s1 = (46 + 30 * I) * C.flare * S;
    o.rot = rand(0, 6.283); o.vrot = rand(-0.8, 0.8);
    o.r0 = pal.flare0[0]; o.g0 = pal.flare0[1]; o.b0 = pal.flare0[2];
    o.r1 = pal.flare1[0]; o.g1 = pal.flare1[1]; o.b1 = pal.flare1[2]; o.mix = 12;
    o.alpha = 0.95; o.fadeIn = 0.005; o.fadeOut = 2.4; o.grow = 0.35;
    Fx3D.star.spawn(o);
  }

  // krzyż rozbłysku ustawiony wzdłuż lufy na ekranie
  Fx3D.cross.spawn(pos, dir, 0.10, 14 * S, (40 + 24 * I) * S, 8 * S, (17 + 8 * I) * S, pal.cross, 0.95);

  // jęzory ognia
  Fx3D.plume.spawn(pos, dir, 0.105, 5 * S, (26 + 16 * I) * S, 5 * S, 9.5 * S, pal.plumeOuter, 1.0);
  Fx3D.plume.spawn(pos, dir, 0.075, 4 * S, (12 + 5 * I) * S, 9 * S, 18 * S, pal.plumeInner, 0.85);

  // rozlanie światła po poszyciu — zamiast pierścienia, który z góry widać z kantu
  _q.set(pos.x, pos.y, FX_WASH_Z);
  Fx3D.wash.spawn(_q, dir, 0.17, 12 * S, (44 + 22 * I) * S, 9 * S, (20 + 9 * I) * S, pal.wash, 0.55);

  // gorące gazy prochowe
  for (let i = 0, n = Math.round(10 * density); i < n; i++) {
    coneDir(_d, dir, 0.55, FL);
    const v = rand(14, 48) * S;
    o = sp();
    o.x = pos.x + _d.x * rand(0, 4) * S;
    o.y = pos.y + _d.y * rand(0, 4) * S;
    o.z = pos.z + _d.z * rand(0, 4) * S;
    o.vx = _d.x * v; o.vy = _d.y * v; o.vz = _d.z * v;
    o.life = rand(0.22, 0.52); o.drag = 3.4;
    o.s0 = rand(2, 5) * S; o.s1 = rand(9, 19) * S * (0.8 + 0.4 * I);
    o.rot = rand(0, 6.283); o.vrot = rand(-2.2, 2.2);
    o.r0 = pal.gas0[0]; o.g0 = pal.gas0[1]; o.b0 = pal.gas0[2];
    o.r1 = pal.gas1[0]; o.g1 = pal.gas1[1]; o.b1 = pal.gas1[2]; o.mix = 4.5;
    o.alpha = rand(0.45, 0.8); o.fadeIn = 0.02; o.fadeOut = 1.9; o.grow = 0.5;
    Fx3D.glow.spawn(o);
  }

  // dym: gorący na starcie, stygnie do sadzy
  const soot = 0.045 + (0.60 - 0.045) * clamp01(C.soot);
  const cr = soot * pal.sootTint[0];
  const cg = soot * pal.sootTint[1];
  const cb = soot * pal.sootTint[2];
  for (let i = 0, n = Math.round(18 * C.smoke * density); i < n; i++) {
    coneDir(_d, dir, 0.62, FL);
    const v = rand(5, 26) * S;
    o = sp();
    o.x = pos.x + _d.x * rand(0, 6) * S;
    o.y = pos.y + _d.y * rand(0, 6) * S;
    o.z = pos.z + _d.z * rand(0, 6) * S;
    o.vx = _d.x * v + _bx.x * rand(-4, 4) * S;
    o.vy = _d.y * v + _bx.y * rand(-4, 4) * S;
    o.vz = _d.z * v + _bx.z * rand(-4, 4) * S;
    o.life = rand(1.6, 3.2) * C.smokeLife; o.drag = 1.15;
    o.s0 = rand(3, 7) * S; o.s1 = rand(15, 32) * S;
    o.rot = rand(0, 6.283); o.vrot = rand(-0.9, 0.9);
    o.r0 = pal.smokeHot[0]; o.g0 = pal.smokeHot[1]; o.b0 = pal.smokeHot[2];
    o.r1 = cr; o.g1 = cg; o.b1 = cb; o.mix = rand(2.2, 4.2);
    o.alpha = rand(0.40, 0.70); o.fadeIn = 0.05; o.fadeOut = 1.35; o.grow = 0.45;
    Fx3D.smoke.spawn(o);
  }
  // wielkie, wolne kłęby
  for (let i = 0, n = Math.round(5 * C.smoke * density); i < n; i++) {
    coneDir(_d, dir, 0.85, FL);
    const v = rand(2, 10) * S;
    o = sp();
    o.x = pos.x + _d.x * rand(0, 9) * S;
    o.y = pos.y + _d.y * rand(0, 9) * S;
    o.z = pos.z + _d.z * rand(0, 9) * S;
    o.vx = _d.x * v; o.vy = _d.y * v; o.vz = _d.z * v;
    o.life = rand(2.6, 4.4) * C.smokeLife; o.drag = 0.85;
    o.s0 = rand(8, 14) * S; o.s1 = rand(32, 52) * S;
    o.rot = rand(0, 6.283); o.vrot = rand(-0.4, 0.4);
    o.r0 = pal.puffHot[0]; o.g0 = pal.puffHot[1]; o.b0 = pal.puffHot[2];
    o.r1 = cr * 0.85; o.g1 = cg * 0.85; o.b1 = cb * 0.85; o.mix = 1.8;
    o.alpha = rand(0.16, 0.30); o.fadeIn = 0.12; o.fadeOut = 1.6; o.grow = 0.5;
    Fx3D.smoke.spawn(o);
  }

  // iskry
  for (let i = 0, n = Math.round(70 * C.sparks * density); i < n; i++) {
    const slow = Math.random() < 0.18;
    coneDir(_d, dir, slow ? 0.85 : 0.30, FL);
    const v = (slow ? rand(8, 45) : rand(40, 175)) * S * (0.75 + 0.35 * I);
    _v.copy(_d).multiplyScalar(v);
    _q.copy(pos).addScaledVector(_d, rand(0, 5) * S);
    Fx3D.spark.spawn(_q, _v, rand(0.3, 1.0), rand(0.5, 1.4), rand(3, 9) * S,
      pal.spark, pal.sparkCool[0], pal.sparkCool[1]);
  }

  // żagwie
  for (let i = 0, n = Math.round(10 * density); i < n; i++) {
    coneDir(_d, dir, 0.7, FL);
    const v = rand(10, 52) * S;
    o = sp();
    o.x = pos.x + _d.x * 3 * S; o.y = pos.y + _d.y * 3 * S; o.z = pos.z + _d.z * 3 * S;
    o.vx = _d.x * v; o.vy = _d.y * v; o.vz = _d.z * v;
    o.life = rand(0.8, 2.2); o.drag = 1.5;
    o.s0 = rand(0.6, 1.2) * S; o.s1 = rand(0.9, 2.2) * S;
    o.r0 = pal.ember0[0]; o.g0 = pal.ember0[1]; o.b0 = pal.ember0[2];
    o.r1 = pal.ember1[0]; o.g1 = pal.ember1[1]; o.b1 = pal.ember1[2]; o.mix = 1.6;
    o.alpha = 0.9; o.fadeIn = 0.02; o.fadeOut = 1.2; o.grow = 1.0;
    Fx3D.glow.spawn(o);
  }
}

/* ============================================================================
   DZIAŁO JONOWE — wyładowanie.
   Bez dymu: zimny rdzeń, długa smuga, łuki, świecący opar.
   ========================================================================== */
function fireIon(pos, dir, S, power, density) {
  const C = MUZZLE_FX_CONFIG;
  const FL = C.flatten;
  const I = Math.max(0.0001, C.ion) * power;
  makeBasis(dir);
  let o;

  // rdzeń — biały, prawie bez barwy, bardzo krótki
  o = sp();
  o.x = pos.x; o.y = pos.y; o.z = pos.z;
  o.vx = dir.x * 10 * S; o.vy = dir.y * 10 * S; o.vz = dir.z * 10 * S;
  o.life = 0.10; o.drag = 8;
  o.s0 = 5 * S; o.s1 = (12 + 8 * I) * S;
  o.r0 = 3.2; o.g0 = 3.6; o.b0 = 4.2;
  o.r1 = 0.5; o.g1 = 1.7; o.b1 = 3.0; o.mix = 18;
  o.alpha = 1; o.fadeIn = 0.003; o.fadeOut = 2.0; o.grow = 0.38;
  Fx3D.glow.spawn(o);

  // chłodna łuna
  o = sp();
  o.x = pos.x + dir.x * 4 * S; o.y = pos.y + dir.y * 4 * S; o.z = pos.z + dir.z * 4 * S;
  o.life = 0.30; o.drag = 4.2;
  o.s0 = 8 * S; o.s1 = (26 + 18 * I) * S;
  o.r0 = 0.85; o.g0 = 2.1; o.b0 = 3.4;
  o.r1 = 0.10; o.g1 = 0.40; o.b1 = 1.10; o.mix = 5.5;
  o.alpha = 0.8; o.fadeIn = 0.008; o.fadeOut = 1.8; o.grow = 0.5;
  Fx3D.glow.spawn(o);

  // krzyż — dłuższy i cieńszy niż u armaty; broń energetyczna czyta się ostrzej
  Fx3D.cross.spawn(pos, dir, 0.13, 20 * S, (64 + 34 * I) * S, 6 * S, (12 + 6 * I) * S, [2.3, 3.1, 4.3], 1.0);

  // smuga: cienki biały rdzeń + szersza błękitna otoczka + krótki rozbryzg
  Fx3D.plume.spawn(pos, dir, 0.17, 12 * S, (72 + 38 * I) * S, 2.6 * S, 4.6 * S, [3.4, 3.9, 4.6], 1.0);
  Fx3D.plume.spawn(pos, dir, 0.21, 9 * S, (48 + 26 * I) * S, 6.5 * S, 13 * S, [0.7, 1.9, 3.5], 0.8);
  Fx3D.plume.spawn(pos, dir, 0.085, 4 * S, 15 * S, 10 * S, 21 * S, [1.8, 2.8, 4.0], 0.8);

  // rozlanie po poszyciu — wąskie i długie
  _q.set(pos.x, pos.y, FX_WASH_Z);
  Fx3D.wash.spawn(_q, dir, 0.26, 16 * S, (86 + 34 * I) * S, 6 * S, (15 + 6 * I) * S, [0.45, 1.35, 2.6], 0.6);

  // strugi jonów — wąski rozrzut, duża prędkość, długie smugi
  for (let i = 0, n = Math.round(42 * C.sparks * density); i < n; i++) {
    coneDir(_d, dir, Math.random() < 0.2 ? 0.34 : 0.07, FL);
    const v = rand(160, 430) * S * (0.7 + 0.4 * I);
    _v.copy(_d).multiplyScalar(v);
    _q.copy(pos).addScaledVector(_d, rand(0, 7) * S);
    Fx3D.spark.spawn(_q, _v, rand(0.25, 0.7), rand(0.3, 0.9), rand(10, 26) * S,
      [1.5, 2.6, 3.8], 1.05, 1.25);    // nie rudzieje — błękitnieje
  }

  // łuki elektryczne rozchodzące się od wylotu
  for (let i = 0, n = Math.round(11 * C.ionArcs * density); i < n; i++) {
    coneDir(_d, dir, rand(0.5, 1.6), FL);
    _q.copy(pos).addScaledVector(_d, rand(7, 20) * S);
    Fx3D.arcs.spawn(pos, _q, rand(0.14, 0.34), rand(0.8, 2.4) * S, [1.3, 2.6, 3.9]);
  }

  // opar jonowy — świeci sam z siebie, stygnie w fiolet. Żadnej sadzy.
  for (let i = 0, n = Math.round(14 * C.ionVapor * density); i < n; i++) {
    coneDir(_d, dir, 0.7, FL);
    const v = rand(6, 26) * S;
    o = sp();
    o.x = pos.x + _d.x * rand(0, 8) * S;
    o.y = pos.y + _d.y * rand(0, 8) * S;
    o.z = pos.z + _d.z * rand(0, 8) * S;
    o.vx = _d.x * v; o.vy = _d.y * v; o.vz = _d.z * v;
    o.life = rand(1.0, 2.3); o.drag = 1.35;
    o.s0 = rand(4, 8) * S; o.s1 = rand(17, 34) * S;
    o.rot = rand(0, 6.283); o.vrot = rand(-0.7, 0.7);
    o.r0 = 0.55; o.g0 = 1.45; o.b0 = 2.5;
    o.r1 = 0.22; o.g1 = 0.10; o.b1 = 0.50; o.mix = 1.5;
    o.alpha = rand(0.18, 0.36); o.fadeIn = 0.06; o.fadeOut = 1.5; o.grow = 0.45;
    Fx3D.vapor.spawn(o);
  }

  // resztkowe iskrzenie przy wylocie
  for (let i = 0, n = Math.round(8 * density); i < n; i++) {
    coneDir(_d, dir, 1.1, FL);
    const v = rand(6, 30) * S;
    o = sp();
    o.x = pos.x + _d.x * 2 * S; o.y = pos.y + _d.y * 2 * S; o.z = pos.z + _d.z * 2 * S;
    o.vx = _d.x * v; o.vy = _d.y * v; o.vz = _d.z * v;
    o.life = rand(0.5, 1.4); o.drag = 1.6;
    o.s0 = rand(0.5, 1.1) * S; o.s1 = rand(0.8, 1.9) * S;
    o.r0 = 1.4; o.g0 = 2.4; o.b0 = 3.6;
    o.r1 = 0.25; o.g1 = 0.55; o.b1 = 1.3; o.mix = 1.4;
    o.alpha = 0.85; o.fadeIn = 0.02; o.fadeOut = 1.2; o.grow = 1.0;
    Fx3D.glow.spawn(o);
  }
}

/* ============================================================================
   FASADA DLA GRY
   Wejście jest w przestrzeni gry (x, y, kąt). Scena ortho używa (x, -y, z),
   więc negacja Y żyje wyłącznie tutaj.
   ========================================================================== */
let frameBudget = MAX_PER_FRAME;

export const MuzzleFX3D = {
  enabled: true,
  cfg: MUZZLE_FX_CONFIG,
  recipes: RECIPES,

  get available() {
    return this.enabled === true && Fx3D.available;
  },

  /**
   * Czy błysk wylotowy tej rodziny broni należy do tego modułu?
   * Pytają o to kontrolery uzbrojenia, żeby NIE dokładać kanwowego
   * błysku (CanvasVFX.spawnRailMuzzle / spawnArmataMuzzle) pod receptę
   * z dema — obie warstwy rysowałyby rozbłysk w tym samym punkcie.
   *
   * Pytanie jest o RODZINĘ, nie o pojedynczy strzał: przy dalekim zoomie
   * `fire()` odpuszcza i zostaje tani błysk instancjonowany, ale wtedy
   * cała wieżyczka ma kilka pikseli i kanwowe iskry i tak by nie doszedły.
   */
  handles(weaponId) {
    if (!this.available) return false;
    return !!RECIPES[normalizeWeaponFxKey(weaponId)];
  },

  /**
   * @param weaponKey klucz z `normalizeWeaponFxKey`
   * @param x,y       punkt wylotu w świecie gry
   * @param angle     kąt lufy (radiany, przestrzeń gry)
   * @param scale     skala wieżyczki z Turret2D.triggerShot
   * @returns true, jeśli błysk powstał
   */
  fire(weaponKey, x, y, angle, scale = 1) {
    const recipe = RECIPES[weaponKey];
    if (!recipe || !this.available || !Fx3D.ensure()) return false;

    const turretScale = Number(scale) > 0 ? Number(scale) : 1;
    // LOD: przy dalekim zoomie cała wieżyczka ma kilka pikseli — bogaty błysk
    // nie miałby czego pokazać, a kosztuje ponad setkę cząstek.
    const zoom = Number(globalThis.camera?.zoom) || 1;
    const screenPx = 45 * turretScale * zoom;      // 45 ≈ typowy promień sylwetki
    if (screenPx < MIN_SCREEN_PX) return false;
    if (frameBudget <= 0) return false;
    frameBudget--;

    // Gęstość cząstek schodzi na małych wieżyczkach: rozbłysk zostaje w całości
    // (kształt niesie czytelność), sypki materiał się przerzedza.
    const density = clamp01(0.35 + 0.65 * Math.min(1, screenPx / 40));

    const S = turretScale * recipe.scale;
    _pos.set(x, -y, FX_PLANE_Z);
    _dir.set(Math.cos(angle), -Math.sin(angle), 0);   // scena ma odwrócone Y

    if (recipe.kind === 'ion') fireIon(_pos, _dir, S, recipe.power, density);
    else fireCannon(_pos, _dir, S, recipe.power, PALETTES[recipe.palette], density);
    // Skala wieżyczki idzie do wstrząsu: ta sama broń na fregacie ma szarpać
    // słabiej niż na kadłubie klasy Capital.
    addCameraShake(recipe.shake * turretScale, recipe.shakeTime);
    return true;
  },

  // Zerowane raz na klatkę przez weapon3DSystem, razem z aktualizacją banku.
  beginFrame() { frameBudget = MAX_PER_FRAME; }
};

if (typeof window !== 'undefined') window.MuzzleFX3D = MuzzleFX3D;
