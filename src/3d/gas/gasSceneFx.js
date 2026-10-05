// src/3d/gas/gasSceneFx.js
//
// Zestaw efektów gazu dla DEM WebGPU (dema/wybuchy-webgpu, destruktor3d-webgpu.html): gaz na siatce 3D
// (gasGrid), obraz objętościowy (gasVolume), reżyser wybuchów (gasExplosions), iskry i błyski
// (gasEmbers), światła ognia (stały zestaw PointLight — natężenie 0 zamiast przełączania, pułapka 34),
// fala uderzeniowa jako SAMA refrakcja (decyzja użytkownika: bez świecącego pierścienia) i post:
// scena (MSAA 4) → gaz w połowie rozdzielczości (obcięty głębią sceny) → złożenie z refrakcją fal →
// bloom (kolor + bloom jak gra) → ACES gry → sRGB.
// W grze ten sam gaz pójdzie przez Core3D (krok efektów, siatka świateł, fxDistortion, post „uber”) —
// plan docs/PLAN-zniszczenia-swiata-3d.md § 12; tu tylko klej dem.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec4, uniform, uniformArray, screenUV, rtt, texture, pass, exp, max, length, Loop
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GasGrid } from './gasGrid.js';
import { GasVolume } from './gasVolume.js';
import { GasExplosions } from './gasExplosions.js';
import { GasEmbers, GasFlashes } from './gasEmbers.js';
import { gasBlackbodyCpu } from './gasCommon.js';
import { createNoise3DTexture, createCurl3DTexture } from '../fx/noise.js';
import { acesGry, linearDoSrgb } from '../tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../bloomConfig.js';

const SHOCK_CAP = 8;
const _bb = [0, 0, 0];
const _sv = new THREE.Vector3();

export class GasSceneFx {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {{ next(): number }} o.rng
   * @param {number} [o.N] komórek domeny na bok @param {number} [o.slots] domen naraz
   * @param {number} [o.lightPool] świateł ognia @param {number} [o.lightScale] skala natężenia (rozmiar sceny [j.])
   */
  constructor({ renderer, scene, camera, rng, N = 64, slots = 6, lightPool = 8, lightScale = 100 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.rng = rng;
    this.lightScale = lightScale;
    this.on = { gas: true, sparks: true, lights: true, bloom: true };
    const noise3D = createNoise3DTexture();
    this.grid = new GasGrid({ N, slots, noise3D, rng });
    this.volume = new GasVolume({ grid: this.grid, noise3D, curl3D: createCurl3DTexture() });
    this.embers = new GasEmbers({ scene, grid: this.grid, rng });
    this.flashes = new GasFlashes({ scene, grid: this.grid });
    this.bloomOn = uniform(1);
    this.lights = [];
    for (let i = 0; i < lightPool; i++) {
      const l = new THREE.PointLight(0xffa060, 0, 0, 2);
      scene.add(l);
      this.lights.push({ light: l, active: false, t0: 0, life: 1, peak: 0, seed: 0 });
    }
    this.lightTime = 0;
    this.shocks = [];
    this.shockTime = 0;
    this.shockU = {
      count: uniform(0, 'int'),
      A: uniformArray(Array.from({ length: SHOCK_CAP }, () => new THREE.Vector4()), 'vec4'),
      B: uniformArray(Array.from({ length: SHOCK_CAP }, () => new THREE.Vector4()), 'vec4'),
      size: uniform(new THREE.Vector2(1, 1))
    };
    const self = this;
    this.director = new GasExplosions({
      grid: this.grid, rng,
      hooks: {
        onFlash: (x, y, z, size, power) => self.flashes.add(x, y, z, size, Math.min(power, 1.2), 0.22),
        onLight: (x, y, z, radius, r, g, b, intensity, life) => self.addLight(x, y, z, intensity, life),
        onSparks: (x, y, z, nx, ny, nz, R, count, speed, slot) => self.sparks(x, y, z, nx, ny, nz, R, count, speed, slot),
        onShock: (x, y, z, radius, power) => self.addShock(x, y, z, radius, power),
        onDebris: (x, y, z, vx, vy, vz, size, life) => {
          if (!self.on.sparks) return;
          const sp = Math.hypot(vx, vy, vz) || 1;
          self.embers.burst(x, y, z, vx / sp, vy / sp, vz / sp, 0, 1, sp, sp, life, life, size, 2.1, -1);
        }
      }
    });
    this.simMs = 0;
  }

  /** Iskry wybuchu: szybkie białe (krótkie) + wolniejszy żar porywany przez kulę ognia. */
  sparks(x, y, z, nx, ny, nz, R, count, speed, slot) {
    if (!this.on.sparks) return;
    this.embers.burst(x, y, z, nx, ny, nz, 0.97, Math.round(count * 0.55), speed * 0.35, speed * 1.25, 0.35, 1.3, R * 0.022, 2.7, slot);
    this.embers.burst(x, y, z, nx, ny, nz, 1.0, Math.round(count * 0.45), speed * 0.08, speed * 0.45, 1.2, 3.6, R * 0.03, 1.7, slot);
  }

  addLight(x, y, z, intensity, life) {
    let pick = null;
    for (const l of this.lights) if (!l.active) { pick = l; break; }
    if (!pick) {
      let low = Infinity;
      for (const l of this.lights) { const v = this._lightLevel(l); if (v < low) { low = v; pick = l; } }
    }
    pick.active = true; pick.t0 = this.lightTime; pick.life = life; pick.peak = intensity; pick.seed = this.rng.next() * 100;
    pick.light.position.set(x, y, z);
  }

  _lightLevel(l) {
    if (!l.active) return 0;
    const age = this.lightTime - l.t0;
    return l.peak * Math.exp(-age / 0.07) + l.peak * 0.2 * Math.max(0, 1 - age / l.life);
  }

  addShock(x, y, z, radius, power) {
    if (this.shocks.length >= SHOCK_CAP) this.shocks.shift();
    this.shocks.push({ x, y, z, radius, power, t0: this.shockTime });
  }

  _updateLights(dt) {
    this.lightTime += dt;
    for (const l of this.lights) {
      if (!l.active) { l.light.intensity = 0; continue; }
      const age = this.lightTime - l.t0;
      if (age > l.life * 1.4) { l.active = false; l.light.intensity = 0; continue; }
      // Błysk (biel, szybko) + ogień kuli (pomarańcz, wolniej, migocze).
      const flash = Math.exp(-age / 0.06);
      const fire = Math.max(0, 1 - age / l.life) * (0.85 + 0.15 * Math.sin((l.seed + this.lightTime) * 23));
      gasBlackbodyCpu(1.0 + flash * 1.6, _bb);
      l.light.color.setRGB(_bb[0], _bb[1], _bb[2]);
      l.light.intensity = (l.peak * flash + l.peak * 0.22 * fire) * (this.on.lights ? 1 : 0) * this.lightScale * 0.55;
    }
  }

  _updateShocks(dt, W, H) {
    this.shockTime += dt;
    const cam = this.camera;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    const U = this.shockU;
    let n = 0;
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      const age = this.shockTime - s.t0;
      const life = 0.55;
      if (age > life) { this.shocks.splice(i, 1); continue; }
      const dist = cam.position.distanceTo(_sv.set(s.x, s.y, s.z));
      _sv.project(cam);
      if (_sv.z > 1 || dist < 1e-3 || n >= SHOCK_CAP) continue;
      // Front: szybko na zewnątrz, zwalnia; siła gaśnie z wiekiem i promieniem na ekranie.
      const R = s.radius * (1 - Math.exp(-age / 0.16));
      const rPx = R / (dist * tanH) * (H * 0.5);
      const u = age / life;
      const strength = 22 * s.power * (1 - u) * (1 - u) * Math.min(1, 900 / Math.max(rPx, 1));
      U.A.array[n].set(_sv.x * 0.5 + 0.5, 0.5 - _sv.y * 0.5, rPx, Math.max(6, rPx * 0.16));
      U.B.array[n].set(strength, 0, 0, 0);
      n++;
    }
    U.count.value = n;
    U.size.value.set(W, H);
  }

  /** Post: scena → gaz (½ rozdzielczości, głębia sceny) → złożenie z refrakcją fal → bloom → ACES → sRGB. */
  buildPipeline(W, H) {
    const pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.camera, { samples: 4 });
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    this.volumeRTT = rtt(this.volume.node(depth), Math.max(1, W >> 1), Math.max(1, H >> 1), { type: THREE.HalfFloatType });
    const volumeRTT = this.volumeRTT;
    const U = this.shockU;
    const composite = Fn(() => {
      // Refrakcja fal: przesunięcie próbki obrazu (profil pochodnej gaussa — obraz ściśnięty na froncie).
      const px = screenUV.mul(U.size).toVar();
      const off = vec2(0.0).toVar();
      Loop({ start: int(0), end: U.count, type: 'int', condition: '<', name: 'shk' }, ({ shk }) => {
        const A = U.A.element(shk);
        const B = U.B.element(shk);
        const d = px.sub(A.xy.mul(U.size)).toVar();
        const r = max(length(d), 1e-3);
        const x = r.sub(A.z).div(A.w);
        const prof = x.mul(exp(x.mul(x).negate())).mul(-1.6);
        off.addAssign(d.div(r).mul(B.x.mul(prof)));
      });
      const uv = screenUV.add(off.div(U.size));
      const c = texture(color, uv).rgb;
      // Gaz z połowy rozdzielczości: 4 próbki w ±0,6 teksela (namiot) — wygładza ziarno startu marszu.
      const tx = vec2(0.6).div(U.size.mul(0.5));
      const v = volumeRTT.sample(uv.add(tx)).add(volumeRTT.sample(uv.sub(tx)))
        .add(volumeRTT.sample(uv.add(vec2(tx.x, tx.y.negate())))).add(volumeRTT.sample(uv.add(vec2(tx.x.negate(), tx.y)))).mul(0.25);
      return c.mul(float(1.0).sub(v.a)).add(v.rgb);
    })();
    const bl = bloom(composite, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
    pipeline.outputNode = Fn(() => vec4(linearDoSrgb(acesGry(composite.add(bl.rgb.mul(this.bloomOn)))), 1.0))();
    pipeline.outputColorTransform = false;
    this.pipeline = pipeline;
    this.W = W; this.H = H;
    return pipeline;
  }

  resize(W, H) {
    this.W = W; this.H = H;
    this.volumeRTT?.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
  }

  /** Krok efektów (zegar wołającego, 0 w pauzie): reżyser → gaz → iskry → błyski → światła → fale. */
  update(dt) {
    const t0 = performance.now();
    this.director.update(dt);
    if (this.on.gas) this.grid.simulate(this.renderer, dt);
    else { this.grid._srcN = 0; this.grid._obsN = 0; }
    this.embers.update(this.renderer, dt, this.camera);
    this.flashes.update(dt, this.camera);
    this._updateLights(dt);
    this._updateShocks(dt, this.W || 1, this.H || 1);
    this.simMs = performance.now() - t0;
  }

  render() {
    this.volume.update(this.camera, this.grid.time);
    if (!this.on.gas) this.volume.U.count.value = 0;
    this.bloomOn.value = this.on.bloom ? 1 : 0;
    this.pipeline.render();
  }

  /** Rozgrzewka: puste dispatche compute (pipeline'y bez przestoju przy pierwszym wybuchu). */
  warm() {
    this.grid.warm(this.renderer);
    this.embers.warm(this.renderer);
  }

  clear() {
    this.director.clear();
    this.grid.clear();
    this.embers.clear();
    this.flashes.clear();
    this.shocks.length = 0;
    for (const l of this.lights) { l.active = false; l.light.intensity = 0; }
  }
}
