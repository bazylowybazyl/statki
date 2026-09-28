// src/effects3d/reactorblow.js
//
// WYBUCH REAKTORA (śmierć okrętu, rozpad stacji) w scenie Core3D — port WebGPU, zadanie 20.
// Dawniej: dwa ShaderMaterial w overlayu z własnym WebGLRenderer (drugi renderer, bloom
// 1,6 / 0,15, składanie `screen`). Teraz: dwie pule cząstek w passie ortho Core3D (warstwa 0),
// materiał raz na pulę (reactorblow.tsl.js), ruch analityczny w wierzchołkach, wybuchy jako
// KROK klatki efektów Core3D (`core.addFxStep`, src/3d/fx/fxFrame.js):
//   spawn  — fazy wybuchów (ładowanie → rozbłysk → iskry) i narodziny cząstek (losowania z fxRandom —
//            warstwa efektów, zadanie 23; ta sama kolejność losowań co w ticku overlaya),
//   lights — światło rdzenia i rozbłysku → siatka świateł efektów (`ctx.grid`, zadanie 12),
//   update — wysyłka zapisanych wycinków pul, zegar cząstek, widoczność i początek pul,
//   warm   — compileAsync obu siatek w passie ortho (pierwszy wybuch bez kompilacji).
// Profile i czasy bez zmian (PROFILE_CONFIGS niżej + reactorProfiles/); zegar = performance.now()
// jak dawniej (hasz oporu iskier i fazy szumu pierścienia liczone z tych samych liczb).
//
// Początek pul przy wybuchu: pozycje cząstek lokalnie względem `mesh.position` (double na CPU,
// highPrecision składa modelViewMatrix w double) — świat leży przy 5–10 mln j., a float32
// pozycji bezwzględnych drżał ~1 px (agents.md). Początek przestawia się, gdy pula jest
// bezczynna (pierwsza cząstka po wygaśnięciu wszystkich) — żywe dane nie wymagają przesuwania.
//
// API: `createReactorBlowFactory(Core3D)` → `spawn({ x, y, size, profile })` (świat gry; zwraca
// true, gdy wybuch ruszył). Wołają: triggerReactorBlow3D (index.html), Destruction3D (rozpad
// stacji), rdzen-demo.

import * as THREE from 'three/webgpu';
import { STATION_CHAIN_REACTOR_PROFILE } from './reactorProfiles/stationChainProfile.js';
import { STATION_CUT_REACTOR_PROFILE } from './reactorProfiles/stationCutProfile.js';
import { STATION_FINAL_REACTOR_PROFILE } from './reactorProfiles/stationFinalProfile.js';
import { ParticlePool } from './particlePool.js';
import { fxRandom } from '../3d/fx/fxRandom.js';
import { REACTOR_TYPE, createReactorUniforms, createReactorFireMaterial, createReactorSmokeMaterial } from './reactorblow.tsl.js';

export const REACTOR_FIRE_CAPACITY = 100000;
export const REACTOR_SMOKE_CAPACITY = 15000;
/** Wysokość wybuchu nad płaszczyzną gry (dawne expY overlaya; oś Z sceny ku kamerze). */
const EXP_Z = 5;

// Profile wybuchów (dawna fabryka — wartości bez zmian). Fala z refrakcją (shockwave3D) i jej
// zapas heatHaze zdjęte ze wszystkich wybuchów 2026-09-24; stara fala (window.trigger3DShockwave)
// zniknęła w zadaniu 19 — pole `shockwave3D` nie ma już odbiorcy. `heatHaze` (gdyby profil go
// włączył) idzie jako gorące powietrze zniekształceń Core3D (fxDistortion().heat).
export const REACTOR_BLOW_PROFILES = Object.freeze({
  fighter: Object.freeze({
    chargeTime: 0.05,
    explosionDuration: 0.2,
    chargeSizeMul: 1.5,
    flashSizeMul: 4.0,
    flashLife: 0.15,
    ringSizeMul: 0.0,
    ringLife: 0.0,
    smokeSizeMul: 0.0,
    smokeLife: 0.0,
    spikeCount: 0,
    spikeSpeedMinMul: 0.0,
    spikeSpeedMaxMul: 0.0,
    spikeSizeMinMul: 0.0,
    spikeSizeMaxMul: 0.0,
    spikeLifeMin: 0.0,
    spikeLifeMax: 0.0,
    sparkDelay: 0.02,
    sparkCount: 20,
    sparkSpeedMinMul: 2.0,
    sparkSpeedMaxMul: 6.0,
    sparkSizeMinMul: 0.08,
    sparkSizeMaxMul: 0.12,
    sparkLifeMin: 0.10,
    sparkLifeMax: 0.20,
    shockwave3D: null,
    heatHaze: null,
  }),
  // Tiery kadluba. Wczesniej KAZDY nie-mysliwiec dostawal profil `capital`,
  // wiec fregata ginela z ta sama chmura 4000 iskier co superkapital — a to
  // wlasnie fregaty i niszczyciele gina w bitwie masowo.
  //   escort  — fregata / korweta / wahadlowiec (promien < 150)
  //   cruiser — niszczyciel / frachtowiec kontenerowy (150-210)
  //   capital — pancernik i wyzej (>= 210), bez zmian wzgledem oryginalu
  escort: Object.freeze({
    chargeTime: 0.30,
    explosionDuration: 1.3,
    chargeSizeMul: 2.2,
    flashSizeMul: 7.0,
    flashLife: 0.6,
    ringSizeMul: 9.0,
    ringLife: 0.8,
    smokeSizeMul: 10.0,
    smokeLife: 0.9,
    spikeCount: 22,
    spikeSpeedMinMul: 10.0,
    spikeSpeedMaxMul: 20.0,
    spikeSizeMinMul: 0.30,
    spikeSizeMaxMul: 0.60,
    spikeLifeMin: 0.22,
    spikeLifeMax: 0.38,
    sparkDelay: 0.06,
    sparkCount: 450,
    sparkSpeedMinMul: 4.0,
    sparkSpeedMaxMul: 13.0,
    sparkSizeMinMul: 0.06,
    sparkSizeMaxMul: 0.14,
    sparkLifeMin: 0.8,
    sparkLifeMax: 1.9,
    shockwave3D: null,
    heatHaze: null,
  }),
  cruiser: Object.freeze({
    chargeTime: 0.55,
    explosionDuration: 2.1,
    chargeSizeMul: 2.9,
    flashSizeMul: 9.5,
    flashLife: 0.9,
    ringSizeMul: 13.0,
    ringLife: 1.15,
    smokeSizeMul: 14.5,
    smokeLife: 1.25,
    spikeCount: 38,
    spikeSpeedMinMul: 11.0,
    spikeSpeedMaxMul: 22.0,
    spikeSizeMinMul: 0.35,
    spikeSizeMaxMul: 0.70,
    spikeLifeMin: 0.26,
    spikeLifeMax: 0.44,
    sparkDelay: 0.08,
    sparkCount: 1400,
    sparkSpeedMinMul: 4.0,
    sparkSpeedMaxMul: 14.0,
    sparkSizeMinMul: 0.06,
    sparkSizeMaxMul: 0.15,
    sparkLifeMin: 1.1,
    sparkLifeMax: 2.8,
    shockwave3D: null,
    heatHaze: null,
  }),
  chain: STATION_CHAIN_REACTOR_PROFILE,
  cut: STATION_CUT_REACTOR_PROFILE,
  capital: Object.freeze({
    chargeTime: 0.8,
    explosionDuration: 3.0,
    chargeSizeMul: 3.5,
    flashSizeMul: 12.0,
    flashLife: 1.2,
    ringSizeMul: 17.0,
    ringLife: 1.5,
    smokeSizeMul: 19.0,
    smokeLife: 1.6,
    spikeCount: 60,
    spikeSpeedMinMul: 12.0,
    spikeSpeedMaxMul: 24.0,
    spikeSizeMinMul: 0.4,
    spikeSizeMaxMul: 0.8,
    spikeLifeMin: 0.3,
    spikeLifeMax: 0.5,
    sparkDelay: 0.1,
    sparkCount: 4000,
    sparkSpeedMinMul: 4.0,
    sparkSpeedMaxMul: 14.0,
    sparkSizeMinMul: 0.06,
    sparkSizeMaxMul: 0.16,
    sparkLifeMin: 1.5,
    sparkLifeMax: 4.0,
    shockwave3D: null,
    heatHaze: null,
  }),
  final: STATION_FINAL_REACTOR_PROFILE,
});

/**
 * Wygląd pod post gry (model w nagłówku reactorblow.tsl.js): odwzorowanie obrazu overlaya
 * (look), mnożniki wkładu per rodzaj (spark / core / ring / smoke), mnożniki wyjścia (out — rdzeń
 * i płaskie, outSpark, outSpike), sufity (cap — rdzeń pod progiem bloomu gry, capSpark), poświata
 * rdzenia z bloomu overlaya (haloAmp, haloQuad — najwyższe powiększenie kwadu, haloSpread),
 * poświata pojedynczej iskry z mipów 0–1 bloomu overlaya (sparkGlow — względem jego wzmocnienia,
 * sparkGlowMax — margines kwadu w px, sparkGlowAge0 → Age1 — narastanie z wiekiem iskry w s).
 * Dobrane do zrzutów bazy z tagu webgl-baseline (scripts/webgpu/zrzuty.mjs: sesja „reaktor”,
 * `wybuch`, `stacja-rozpad`, wariant `__reaktor`) — liczby: docs/webgpu/POSTEP.md (zadanie 20).
 * Strojenie na żywo: window.__reactorBlow3D.setLook({ … }).
 */
export const REACTOR_LOOK = Object.freeze({
  look: 1,
  spark: 1.0,
  core: 1.0,
  ring: 1.0,
  smoke: 1.0,
  out: 1.0,
  outSpark: 0.7,
  outSpike: 2.0,
  cap: 0.88,
  capSpark: 1e4,
  haloAmp: 4,
  haloQuad: 40,
  haloSpread: 1,
  sparkGlow: 1,
  sparkGlowMax: 40,
  sparkGlowAge0: 0.6,
  sparkGlowAge1: 1.2
});

/** Światła wybuchu w siatce świateł efektów (rdzeń ładowania i rozbłysk): moc, zasięg / rozmiar kwadu, wysokość, rozpraszanie. */
export const REACTOR_LIGHT = Object.freeze({
  color: Object.freeze([0.25, 0.8, 1.0]),
  charge: 2.0,
  flash: 3.0,
  rangeMul: 0.5,
  minRange: 120,
  maxRange: 8000,
  z: 80,
  scatter: 1.0
});

const PHASE_CHARGE = 0;
const PHASE_EXPLODE = 1;
const PHASE_SPARKS = 2;

// Pula cząstek: siatka z InstancedBufferGeometry (kwad 1 × 1) i trzema atrybutami instancji
// (pozycja startowa, prędkość startowa — lokalnie względem początku puli, scena; dane: narodziny,
// życie, rozmiar, typ). Bufory wierzchołków: pozycja, uv + 3 = 5 (limit 8).
class ReactorParticles {
  constructor(scene, capacity, material, renderOrder, timeUniform) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.startPos = new Float32Array(capacity * 3);
    this.startVel = new Float32Array(capacity * 3);
    this.dataInfo = new Float32Array(capacity * 4);
    const aPos = new THREE.InstancedBufferAttribute(this.startPos, 3);
    const aVel = new THREE.InstancedBufferAttribute(this.startVel, 3);
    const aData = new THREE.InstancedBufferAttribute(this.dataInfo, 4);
    geo.setAttribute('aStartPos', aPos);
    geo.setAttribute('aStartVel', aVel);
    geo.setAttribute('aData', aData);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = material.name;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(0);
    this.mesh = mesh;
    this.originX = 0;
    this.originY = 0;
    this.pool = new ParticlePool({ mesh, attributes: [aPos, aVel, aData], capacity, timeUniform, name: material.name });
    scene.add(mesh);
  }

  /**
   * Cząstka w układzie SCENY (X = x gry, Y = −y gry, Z ku kamerze), prędkość w tym samym układzie.
   * Pierwsza cząstka bezczynnej puli przestawia jej początek (całkowity — dokładny we float32).
   */
  spawn(X, Y, Z, vx, vy, vz, size, life, type, t) {
    const pool = this.pool;
    if (pool.idle) this._setOrigin(Math.round(X), Math.round(Y));
    const i = pool.next();
    const i3 = i * 3;
    const i4 = i * 4;
    this.startPos[i3] = X - this.originX;
    this.startPos[i3 + 1] = Y - this.originY;
    this.startPos[i3 + 2] = Z;
    this.startVel[i3] = vx;
    this.startVel[i3 + 1] = vy;
    this.startVel[i3 + 2] = vz;
    this.dataInfo[i4] = t;
    this.dataInfo[i4 + 1] = life;
    this.dataInfo[i4 + 2] = size;
    this.dataInfo[i4 + 3] = type;
    pool.keepAlive(t + life);
  }

  _setOrigin(ox, oy) {
    if (ox === this.originX && oy === this.originY) return;
    this.originX = ox;
    this.originY = oy;
    const m = this.mesh;
    m.position.set(ox, oy, 0);
    // Scena Core3D ma matrixWorldAutoUpdate = false, a obchód macierzy był przed klatką efektów.
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
  }
}

export class ReactorBlow3D {
  /**
   * @param {object} core Core3D (scena, addFxStep, prewarmPass, fxDistortion)
   */
  constructor(core, { fireCapacity = REACTOR_FIRE_CAPACITY, smokeCapacity = REACTOR_SMOKE_CAPACITY } = {}) {
    this.core = core;
    this.U = createReactorUniforms();
    this.setLook(REACTOR_LOOK);
    this.fireMaterial = createReactorFireMaterial(this.U);
    this.smokeMaterial = createReactorSmokeMaterial(this.U);
    // Kolejność rysowania jak w overlayu: fala (999) przed ogniem (1000), po reszcie warstwy 0.
    this.fire = new ReactorParticles(core.scene, fireCapacity, this.fireMaterial, 1000, this.U.uTime);
    this.smoke = new ReactorParticles(core.scene, smokeCapacity, this.smokeMaterial, 999, this.U.uTime);
    this.meshes = [this.smoke.mesh, this.fire.mesh];
    // Wybuchy: rekordy wielokrotnego użytku (lista aktywnych + wolne).
    this.blasts = [];
    this.free = [];
    this.stats = { blasts: 0, spawned: 0, cpuMs: 0, lights: 0 };
    const self = this;
    this.step = {
      name: 'reaktor',
      spawn: (ctx) => self._advance(ctx),
      lights: (ctx) => self._lights(ctx),
      update: (ctx) => self._flush(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    if (typeof core.addFxStep === 'function') core.addFxStep(this.step);
  }

  /** Strojenie wyglądu (REACTOR_LOOK — pola opcjonalne). */
  setLook(look = {}) {
    const U = this.U;
    if (Number.isFinite(look.look)) U.uLook.value = look.look;
    if (Number.isFinite(look.spark)) U.uGainSpark.value = look.spark;
    if (Number.isFinite(look.core)) U.uGainCore.value = look.core;
    if (Number.isFinite(look.ring)) U.uGainRing.value = look.ring;
    if (Number.isFinite(look.smoke)) U.uGainSmoke.value = look.smoke;
    if (Number.isFinite(look.out)) U.uOut.value = look.out;
    if (Number.isFinite(look.cap)) U.uCap.value = look.cap;
    if (Number.isFinite(look.outSpark)) U.uOutSpark.value = look.outSpark;
    if (Number.isFinite(look.outSpike)) U.uOutSpike.value = look.outSpike;
    if (Number.isFinite(look.capSpark)) U.uCapSpark.value = look.capSpark;
    if (Number.isFinite(look.haloAmp)) U.uHaloAmp.value = look.haloAmp;
    if (Number.isFinite(look.haloQuad)) U.uHaloQuad.value = Math.max(1, look.haloQuad);
    if (Number.isFinite(look.haloSpread)) U.uHaloSpread.value = look.haloSpread;
    if (Number.isFinite(look.sparkGlow)) U.uSparkGlow.value = Math.max(0, look.sparkGlow);
    if (Number.isFinite(look.sparkGlowMax)) U.uSparkGlowMax.value = Math.max(0, look.sparkGlowMax);
    if (Number.isFinite(look.sparkGlowAge0)) U.uSparkGlowAge0.value = look.sparkGlowAge0;
    if (Number.isFinite(look.sparkGlowAge1)) U.uSparkGlowAge1.value = look.sparkGlowAge1;
    return this;
  }

  /**
   * Płaskie kwady (pierścień fraktalny, ciemna fala) — w overlayu zwrócone tyłem do kamery i
   * odrzucane (FrontSide), więc niewidoczne; true = podgląd obu stron (nowy potok, tylko do oceny).
   */
  setFlatVisible(on) {
    const side = on ? THREE.DoubleSide : THREE.FrontSide;
    if (this.fireMaterial.side === side) return this;
    for (const m of [this.fireMaterial, this.smokeMaterial]) {
      m.side = side;
      m.forceSinglePass = !!on;
      m.needsUpdate = true;
    }
    return this;
  }

  /** Nowy wybuch (świat gry). Zwraca true, gdy ruszył. */
  spawn(x = 0, y = 0, size = 100, profile = 'capital') {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) return false;
    const cfg = REACTOR_BLOW_PROFILES[profile] || REACTOR_BLOW_PROFILES.capital;
    const b = this.free.pop() || { x: 0, y: 0, size: 0, cfg: null, initTime: 0, phase: 0 };
    b.x = x;
    b.y = y;
    b.size = size;
    b.cfg = cfg;
    b.initTime = performance.now() / 1000;
    b.phase = PHASE_CHARGE;
    this.blasts.push(b);
    // Rdzeń ładowania od razu (jak dawna fabryka).
    this.fire.spawn(x, -y, EXP_Z, 0, 0, 0, size * cfg.chargeSizeMul, cfg.chargeTime + 0.1, REACTOR_TYPE.CORE, b.initTime);
    this.stats.spawned++;
    return true;
  }

  // Fazy wybuchów (dawne update(dt) efektu overlaya). Losowania z fxRandom (warstwa efektów — zadanie
  // 23: Math.random gry przesuwał się o 5 losowań na iskrę, więc strojenie wyglądu wybuchu zmieniało
  // przebieg bitwy) w kolejności ticku overlaya: wybuchy od najnowszego do najstarszego, w wybuchu kolce
  // (prędkość, kąt, pion, rozmiar, życie), potem iskry (prędkość, kąt, φ, rozmiar, życie).
  _advance(ctx) {
    const t0 = performance.now();
    const list = this.blasts;
    if (!list.length) { this.stats.blasts = 0; this.stats.cpuMs = 0; return; }
    const gt = t0 / 1000;
    const fire = this.fire;
    for (let k = list.length - 1; k >= 0; k--) {
      const b = list[k];
      const cfg = b.cfg;
      const time = gt - b.initTime;
      const X = b.x;
      const Y = -b.y;
      const size = b.size;
      if (b.phase !== PHASE_CHARGE && cfg.heatHaze) this._heatHaze(ctx, b, time - cfg.chargeTime);
      if (b.phase === PHASE_CHARGE && time >= cfg.chargeTime) {
        b.phase = PHASE_EXPLODE;
        fire.spawn(X, Y, EXP_Z, 0, 0, 0, size * cfg.flashSizeMul, cfg.flashLife, REACTOR_TYPE.CORE, gt);
        if (cfg.ringSizeMul > 0 && cfg.ringLife > 0) {
          fire.spawn(X, Y, EXP_Z, 0, 0, 0, size * cfg.ringSizeMul, cfg.ringLife, REACTOR_TYPE.RING, gt);
        }
        if (cfg.smokeSizeMul > 0 && cfg.smokeLife > 0) {
          this.smoke.spawn(X, Y, EXP_Z, 0, 0, 0, size * cfg.smokeSizeMul, cfg.smokeLife, 1, gt);
        }
        const spdMin = cfg.spikeSpeedMinMul;
        const spdRange = Math.max(0.001, cfg.spikeSpeedMaxMul - spdMin);
        const szRange = Math.max(0.001, cfg.spikeSizeMaxMul - cfg.spikeSizeMinMul);
        const lifeRange = Math.max(0.001, cfg.spikeLifeMax - cfg.spikeLifeMin);
        for (let i = 0; i < cfg.spikeCount; i++) {
          const speed = size * (spdMin + fxRandom.next() * spdRange);
          const angle = fxRandom.next() * Math.PI * 2;
          const vx = Math.cos(angle) * speed;
          const vUp = (fxRandom.next() - 0.5) * speed * 0.15;   // dawne vy overlaya (oś ku kamerze)
          const vz = Math.sin(angle) * speed;                  // dawne vz overlaya (y gry)
          const s = size * (cfg.spikeSizeMinMul + fxRandom.next() * szRange);
          const life = cfg.spikeLifeMin + fxRandom.next() * lifeRange;
          fire.spawn(X, Y, EXP_Z, vx, -vz, vUp, s, life, REACTOR_TYPE.SPIKE, gt);
        }
      }
      if (b.phase === PHASE_EXPLODE && time >= cfg.chargeTime + cfg.sparkDelay) {
        b.phase = PHASE_SPARKS;
        const spdMin = cfg.sparkSpeedMinMul;
        const spdRange = Math.max(0.001, cfg.sparkSpeedMaxMul - spdMin);
        const szRange = Math.max(0.001, cfg.sparkSizeMaxMul - cfg.sparkSizeMinMul);
        const lifeRange = Math.max(0.001, cfg.sparkLifeMax - cfg.sparkLifeMin);
        for (let i = 0; i < cfg.sparkCount; i++) {
          const speed = size * (spdMin + fxRandom.next() * spdRange);
          const angle = fxRandom.next() * Math.PI * 2;
          const phi = Math.acos(2 * fxRandom.next() - 1);
          const vx = Math.sin(phi) * Math.cos(angle) * speed;
          const vUp = Math.cos(phi) * speed;
          const vz = Math.sin(phi) * Math.sin(angle) * speed;
          const s = size * (cfg.sparkSizeMinMul + fxRandom.next() * szRange);
          const life = cfg.sparkLifeMin + fxRandom.next() * lifeRange;
          fire.spawn(X, Y, EXP_Z, vx, -vz, vUp, s, life, REACTOR_TYPE.SPARK, gt);
        }
      }
      if (time > cfg.chargeTime + cfg.explosionDuration) {
        // Koniec wybuchu (cząstki dogasają same — pula żyje do ostatniej). Usunięcie z zachowaniem
        // kolejności (kolejność losowań kolejnych klatek), bez alokacji.
        for (let j = k; j < list.length - 1; j++) list[j] = list[j + 1];
        list.length--;
        b.cfg = null;
        this.free.push(b);
      }
    }
    this.stats.blasts = list.length;
    this.stats.cpuMs = performance.now() - t0;
  }

  // Gorące powietrze wybuchu (profil z `heatHaze`; dziś żaden go nie włącza) — źródło
  // zniekształceń Core3D w świecie gry (dawniej pushHeatHazeWorld w osi sceny).
  _heatHaze(ctx, b, expTime) {
    const h = b.cfg.heatHaze;
    if (!(expTime < h.duration)) return;
    const field = ctx?.core?.fxDistortion?.();
    if (!field) return;
    const radius = b.size * h.startScaleMul + expTime * b.size * h.growthMul;
    const strength = Math.max(0, 1.0 - expTime / h.duration) * h.strength;
    // Dawna siła gorącego powietrza „uber” (× 0,0035 UV, szum ±0,7) ≈ 2,6 px przy 1080 px.
    field.heat(b.x, b.y, radius, strength * 2.6);
  }

  // Światło rdzenia ładowania i rozbłysku (krzywe jak alfa rdzenia: (1 − wiek/życie)³) → siatka.
  _lights(ctx) {
    const list = this.blasts;
    const grid = ctx?.grid;
    let n = 0;
    if (!list.length || !grid) { this.stats.lights = 0; return; }
    const L = REACTOR_LIGHT;
    const gt = performance.now() / 1000;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const cfg = b.cfg;
      const time = gt - b.initTime;
      let power = 0;
      let quad = 0;
      const chargeLife = cfg.chargeTime + 0.1;
      if (time < chargeLife) {
        const u = Math.max(0, time) / chargeLife;
        const r = 1 - u;
        power = L.charge * r * r * r;
        quad = b.size * cfg.chargeSizeMul * (0.5 + 0.5 * u);
      }
      if (b.phase !== PHASE_CHARGE) {
        const a = time - cfg.chargeTime;
        if (a >= 0 && a < cfg.flashLife) {
          const u = a / cfg.flashLife;
          const r = 1 - u;
          const p = L.flash * r * r * r;
          if (p > power) {
            power = p;
            quad = b.size * cfg.flashSizeMul * (0.5 + 0.5 * u);
          }
        }
      }
      if (!(power > 1e-3)) continue;
      const range = Math.min(L.maxRange, Math.max(L.minRange, quad * L.rangeMul));
      const c = L.color;
      if (grid.addWorld(b.x, b.y, L.z, range, c[0] * power, c[1] * power, c[2] * power, L.scatter) >= 0) n++;
    }
    this.stats.lights = n;
  }

  // Raz na klatkę: wycinki do wysyłki, zegar cząstek, widoczność i instanceCount pul.
  _flush() {
    const now = performance.now() / 1000;
    this.fire.pool.flush(now);
    this.smoke.pool.flush(now);
  }

  // Rozgrzewka (raz przy gotowym urządzeniu): obie siatki w passie ortho (cel composerTarget).
  // compileAsync pomija niewidoczne i obiekty bez instancji — odsłonięte na czas projekcji.
  _warm(ctx) {
    const core = ctx?.core || this.core;
    if (!core?.prewarmPass) return;
    for (const m of this.meshes) {
      const vis = m.visible;
      const ic = m.geometry.instanceCount;
      m.visible = true;
      m.geometry.instanceCount = 2;
      try { core.prewarmPass(m, 0); } finally { m.visible = vis; m.geometry.instanceCount = ic; }
    }
  }

  /** Czyści wybuchy i pule (np. restart sceny). */
  clear() {
    for (const b of this.blasts) { b.cfg = null; this.free.push(b); }
    this.blasts.length = 0;
    for (const p of [this.fire, this.smoke]) {
      p.pool.liveUntil = -Infinity;
      p.pool.flush(0);
    }
  }
}

/**
 * Wybuch reaktora w Core3D. Zwraca `spawn({ x, y, size, profile })` (świat gry; true, gdy wybuch
 * ruszył) — ten sam kształt wywołania co dawna fabryka overlaya, bez `overlay3D.spawn(efekt)`:
 * wybuch żyje w kroku klatki efektów Core3D. `spawn.system` — system (statystyki, strojenie).
 */
export function createReactorBlowFactory(core) {
  if (!core?.scene) throw new Error('createReactorBlowFactory: potrzebny Core3D (scena i klatka efektów)');
  const system = new ReactorBlow3D(core);
  const spawn = ({ x = 0, y = 0, size = 100, profile = 'capital' } = {}) => system.spawn(x, y, size, profile);
  spawn.system = system;
  if (typeof window !== 'undefined') window.__reactorBlow3D = system;
  return spawn;
}
