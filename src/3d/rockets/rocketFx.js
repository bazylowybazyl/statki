// src/3d/rockets/rocketFx.js
//
// EFEKTY RAKIET W CORE3D (zadanie 19): pule z dema rakiet (dym compute z mapą gęstości,
// płomienie, kadłubki, kule ognia, łuki, mgławica, duszki blasku; iskry przez SparkSystem3D)
// + reżyser receptur (effects.js) jako KROK klatki efektów Core3D (src/3d/fx/fxFrame.js):
//   spawn  — siły w dymie, krok dymu (zegar lotu rakiet) i wysyłka zleceń (stara rama początku),
//   lights — dysze, błyski, odłamki, przypalenia, supernowe → Core3D.fx.grid,
//   update — mapa gęstości i światło dymu (compute, siatka tej klatki), instancje tej klatki
//            (kadłubki, płomienie, duszki, kule ognia), łuki i mgławica, zniekształcenia,
//            ekspozycja i podbicie bloomu supernowej,
//   warm   — rozgrzewka: kernele z pustym licznikiem, mapa gęstości, compileAsync siatek passa
//            ortho (cel composerTarget — pierwsza rakieta i pierwsza Supernowa bez kompilacji).
//
// Lot, naprowadzanie, trafienia i obrażenia zostają w src/effects3d/rocketSystem3D.js —
// zgłasza zdarzenia (onLaunch / onIgnite / onFly / prepareContact / onDetonate / update)
// reżyserowi przez `createRocketFx(Core3D).director`.

import * as THREE from 'three/webgpu';
import { SmokeSystem, SMOKE_SHADOW_LEN } from './smoke.js';
import { PlumeSystem } from './plumes.js';
import { MissileBodies } from './missileBodies.js';
import { FireballSystem } from './fireballs.js';
import { ArcSystem } from './arcs.js';
import { NebulaSystem } from './nebula.js';
import { GlowSprites } from './glow.js';
import { RocketEffects } from './effects.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { SparkSystem3D } from '../sparkSystem3D.js';
import { oddajKopieCpu } from '../tsl/kopiaCpu.js';

// Słońce efektów rakiet (demo: kierunek z pozycji słońca, 30° nad płaszczyzną gry).
const SUN_ELEV = 30 * Math.PI / 180;
const SUN_COLOR = [1.0, 0.95, 0.88];
/** Epoka zegara reżysera przeskakuje, gdy nic z pul czasowych nie żyje (lub co 600 s). */
const EPOCH_SPAN = 600;

export class RocketFx {
  constructor(core) {
    this.core = core;
    this.rockets = null;         // lista rakiet rocketSystem3D (pula slotów)
    this.enabled = true;
    const fx = core.fx;
    const scene = core.scene;
    const origin = fx.origin;
    const grid = fx.grid;
    this.sunDir = new THREE.Vector3(-0.6, 0.5, 0.62).normalize();
    this.smoke = new SmokeSystem({ scene, grid, origin, curlTex: fxNoise.curl3D(), noise2D: fxNoise.cloud2D(), rng: fxRandom });
    this.plumes = new PlumeSystem({ scene });
    // Kadłubki: słońce jak w dymie (wspólne uniformy kierunku i barwy).
    this.bodies = new MissileBodies({ scene, grid, sun: { sunDir: this.smoke.U.sunDir, sunCol: this.smoke.U.sunCol } });
    this.fireballs = new FireballSystem({ scene, noise3D: fxNoise.noise3D(), rng: fxRandom });
    this.arcs = new ArcSystem({ scene, origin });
    this.nebula = new NebulaSystem({ scene, origin, noise3D: fxNoise.noise3D(), rng: fxRandom });
    this.glow = new GlowSprites({ scene });
    if (!SparkSystem3D.isInitialized) SparkSystem3D.init(scene);
    this.director = new RocketEffects({
      smoke: this.smoke, plumes: this.plumes, bodies: this.bodies, fireballs: this.fireballs,
      arcs: this.arcs, nebula: this.nebula, glow: this.glow, sparks: SparkSystem3D, rng: fxRandom
    });
    this.meshes = [this.smoke.mesh, this.plumes.mesh, this.bodies.mesh, this.fireballs.mesh, this.arcs.mesh, this.nebula.mesh, this.glow.mesh];
    this.stats = { cpuMs: 0 };
    // Bufory liczone tylko na GPU (dym ~48 MB, mgławica ~20 MB): kopie CPU oddawane, gdy bufory GPU
    // już są (src/3d/tsl/kopiaCpu.js, zadanie 23). Kolejka zleceń dymu (q) zostaje — pisze ją CPU.
    const s = this.smoke;
    const n = this.nebula;
    this._gpuOnly = [s.sP, s.sV, s.sC, s.sD, s.sL, s.sM, n.nA, n.nB, n.nC, n.nD, n.nE];
    this._kopieCpu = this._gpuOnly.length;
    const self = this;
    this.step = {
      name: 'rakiety',
      spawn: (ctx) => self._spawn(ctx),
      lights: (ctx) => self._lights(ctx),
      update: (ctx) => self._update(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    core.addFxStep(this.step);
  }

  /** Lista rakiet (pula slotów rocketSystem3D) — czytana w klatce efektów. */
  attachRockets(list) {
    this.rockets = list;
  }

  _camera(ctx) {
    return ctx.core?.activeCam1 || null;
  }

  _spawn(ctx) {
    const d = this.director;
    d.renderer = ctx.renderer;
    // Kadr z poprzedniej klatki efektów (świat) i zoom — odrzucanie emisji i LOD smugi.
    const v = ctx.view;
    d.hasView = v.x1 > v.x0;
    d.vx0 = v.x0; d.vy0 = v.y0; d.vx1 = v.x1; d.vy1 = v.y1;
    const cam = this._camera(ctx);
    d.zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    const origin = ctx.origin;
    // Pierwsza klatka: początek jeszcze nie ustawiony — zlecenia czekają (przeliczenie
    // świata na układ lokalny wymaga początku).
    if (!origin.initialized) return;
    const dt = d.pendingDt;
    d.pendingDt = 0;
    const smoke = this.smoke;
    if (dt > 0 && smoke.highWater > 0) d.fillForces(this.rockets, Number(cam?.x) || 0, Number(cam?.y) || 0, origin.x, origin.y);
    // Podkroki dymu i emisja jednym passem compute (zadanie 23).
    smoke.stepAndEmit(ctx.renderer, dt, d.time);
  }

  _lights(ctx) {
    const d = this.director;
    d.stageLights(this.rockets);
    d.flushLights(ctx.grid);
  }

  _update(ctx) {
    const t0 = performance.now();
    if (this._kopieCpu > 0) this._kopieCpu = oddajKopieCpu(ctx.renderer, this._gpuOnly);
    const d = this.director;
    const origin = ctx.origin;
    const ox = origin.x;
    const oy = origin.y;
    const cam = this._camera(ctx);
    const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    const camX = Number(cam?.x) || 0;
    const camY = Number(cam?.y) || 0;
    // Epoka zegara reżysera (czasy łuków i mgławicy na GPU jako małe liczby): przeskok, gdy
    // mgławica nie żyje (jej czasy są na GPU), a łuki (CPU) przesuwa arcs.shiftTime.
    const age = d.time - d.epoch;
    if (!this.nebula.live && (age > EPOCH_SPAN || (!this.arcs.live && age > 1))) {
      const e = Math.floor(d.time);
      const dT = d.epoch - e;
      this.arcs.shiftTime(dT);
      this.nebula.shiftTime(dT);
      d.epoch = e;
    }
    const tl = d.time - d.epoch;
    // Słońce: kierunek z pozycji SUN względem kamery, podniesiony o 30° (jak demo).
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    if (sun) {
      const dx = sun.x - camX;
      const dy = -(sun.y - camY);
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      this.sunDir.set(dx / l * Math.cos(SUN_ELEV), dy / l * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV)).normalize();
    }
    const smoke = this.smoke;
    smoke.U.sunDir.value.copy(this.sunDir);
    this.fireballs.U.sunDir.value.copy(this.sunDir);
    // Dym: mapa gęstości nad kadrem (+ długość cienia) i światło cząstek w kadrze.
    smoke.syncOrigin();
    if (smoke.highWater > 1) {
      const v = ctx.view;
      const hw = (v.x1 - v.x0) * 0.5;
      const hh = (v.y1 - v.y0) * 0.5;
      const cxL = (v.x0 + v.x1) * 0.5 - ox;
      const cyL = -(v.y0 + v.y1) * 0.5 - oy;
      const dxm = hw * 1.15 + SMOKE_SHADOW_LEN;
      const dym = hh * 1.15 + SMOKE_SHADOW_LEN;
      smoke.renderDensity(ctx.renderer, cxL - dxm, cyL - dym, cxL + dxm, cyL + dym, this.sunDir, SMOKE_SHADOW_LEN);
      smoke.light(ctx.renderer, cxL - hw - 400, cyL - hh - 400, cxL + hw + 400, cyL + hh + 400);
    } else {
      smoke.light(ctx.renderer, 0, 0, 0, 0);
    }
    // Instancje tej klatki.
    this.bodies.begin();
    this.plumes.begin();
    if (this.rockets) d.addMissiles(this.rockets, ox, oy);
    this.bodies.commit(ox, oy);
    this.plumes.commit(tl, zoom, ox, oy);
    this.glow.begin();
    d.addGlows(this.rockets, ox, oy);
    this.glow.commit(ox, oy);
    this.fireballs.update(d.time, ox, oy);
    this.arcs.update(tl, zoom, ox, oy);
    this.nebula.update(tl, zoom, ox, oy);
    // Zniekształcenia (świat gry; kolejka Core3D kasuje się sama po renderze).
    if (d.sN > 0 || d.nN > 0 || d.hN > 0) d.fillDistortion(ctx.core?.fxDistortion?.());
    // Supernowa: przygaszenie i podbicie bloomu (Core3D.fx.post — reset co klatkę).
    const post = ctx.core?.fx?.post;
    if (post) {
      if (d.exposure < post.exposure) post.exposure = d.exposure;
      if (d.bloomBoost > post.bloomBoost) post.bloomBoost = d.bloomBoost;
    }
    this.stats.cpuMs = performance.now() - t0;
  }

  /**
   * Rozgrzewka (raz przy gotowym urządzeniu): puste dispatche kerneli (licznik 0), mapa
   * gęstości (własny kontekst renderu — HalfFloat bez MSAA) i compileAsync siatek w passie
   * ortho (cel composerTarget; niewidoczne i count 0/1 compileAsync pomija — odsłonięte na
   * czas projekcji, jak shieldImpactFx.prewarm).
   */
  _warm(ctx) {
    const renderer = ctx.renderer;
    const smoke = this.smoke;
    smoke.U.spawnCount.value = 0;
    smoke.U.count.value = 0;
    renderer.compute(smoke.emitNode, 1);
    renderer.compute(smoke.stepNode, 1);
    renderer.compute(smoke.lightNode, 1);
    this.nebula.U.count.value = 0;
    renderer.compute(this.nebula.initNode, 1);
    const saved = [];
    // Licznik instancji tak, jak w prawdziwym rysowaniu: pule na InstancedBufferGeometry
    // (kadłubki, płomienie, duszki, kule ognia, łuki) — `geometry.instanceCount`, `mesh.count`
    // zostaje 1; pule ze storage (dym, mapa gęstości, mgławica) — `mesh.count` ≥ 2. `count > 1`
    // wchodzi do klucza obiektu renderu: podbity w rozgrzewce u puli, która rysuje z count = 1,
    // dawał inny klucz i budowę NodeBuildera przy pierwszej salwie (kula ognia ~115 ms).
    const reveal = (m) => {
      const inst = m.geometry.isInstancedBufferGeometry === true;
      saved.push(m, m.visible, m.count, inst ? m.geometry.instanceCount : -1);
      m.visible = true;
      if (inst) m.geometry.instanceCount = Math.max(2, m.geometry.instanceCount || 0);
      else m.count = Math.max(2, m.count || 0);
    };
    reveal(smoke.densityMesh);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(smoke.densityRT);
    renderer.render(smoke.densityScene, smoke.densityCam);
    renderer.setRenderTarget(prev);
    for (const m of this.meshes) reveal(m);
    try {
      for (const m of this.meshes) ctx.core.prewarmPass(m, 0);
    } finally {
      for (let k = 0; k < saved.length; k += 4) {
        const m = saved[k];
        m.visible = saved[k + 1];
        if (m.count !== undefined) m.count = saved[k + 2];
        if (saved[k + 3] >= 0) m.geometry.instanceCount = saved[k + 3];
      }
    }
    this._kopieCpu = oddajKopieCpu(renderer, this._gpuOnly);
  }

  clear() {
    this.director.clear();
    this.smoke.clear();
    this.fireballs.clear();
    this.arcs.clear();
    this.nebula.clear();
    // Pule przepisywane co klatkę (kadłubki, płomienie, duszki): puste do następnej klatki.
    for (const pool of [this.bodies, this.plumes, this.glow]) {
      pool.begin();
      pool.mesh.visible = false;
    }
  }
}

/** Tworzy efekty rakiet w Core3D (wymaga Core3D.init — scena i klatka efektów). */
export function createRocketFx(core) {
  if (!core?.scene || !core?.fx) return null;
  const fx = new RocketFx(core);
  // Konsola / harness: pule i reżyser (statystyki, przełączniki `director.opts`).
  if (typeof window !== 'undefined') window.__rocketFx = fx;
  return fx;
}
