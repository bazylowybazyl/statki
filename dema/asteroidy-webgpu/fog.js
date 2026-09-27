// dema/asteroidy-webgpu/fog.js
//
// Mgła pasa jako osobna warstwa — port płatów src/3d/beltDust3D.js do TSL:
// płaty objętości pod płaszczyzną gry — DWA PŁYTKIE (200 i 600 j.) w passie
// gry (kamera ortho, test głębi ze skałami gry: dolne części skał toną w mgle,
// czubki wystają) i sześć głębszych (1300–20 500 j.) w passie tła (kamera
// persp., test głębi ze skałami tła), kafelkowany szum 2D
// (tu z compute do tekstury storage), gęstość makro pola w wierzchołkach
// siatki 36 × 36 kotwiczonej w świecie, samocień w stronę słońca, pochłanianie
// (blend premultiplied „over”). Światła siatki (lights.js) rozpraszają się
// w płatach — liczone w WIERZCHOŁKACH, jak w grze (smugi reflektorów w mgle).
// Nad mgłą idzie fizyczny pył (dust.js) w passie gry.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, ivec2, uvec2, vec2, vec3, vec4, uniform, attribute, varyingProperty,
  instanceIndex, textureStore, texture, positionGeometry, positionWorld, modelWorldMatrix,
  If, Discard, mix, smoothstep, clamp, floor, fract, abs, exp, sin
} from 'three/tsl';
import { stormIntensity } from '../../src/game/asteroidStorms.js';

// Z beltDust3D.js (DUST_SLICES od 1300 j., DUST_LOOK_DEFAULTS, GRID,
// DUST_NOISE_WRAP). Płytkie płaty (fg) w passie gry — mgła na wysokości skał.
export const DUST_SLICES = Object.freeze([
  Object.freeze({ depth: 200, scale: 7000, alpha: 0.09, drift: 0.9, fg: true }),
  Object.freeze({ depth: 600, scale: 10000, alpha: 0.11, drift: 0.7, fg: true }),
  Object.freeze({ depth: 1300, scale: 14000, alpha: 0.11, drift: 0.6 }),
  Object.freeze({ depth: 2800, scale: 21000, alpha: 0.13, drift: 0.45 }),
  Object.freeze({ depth: 5200, scale: 31000, alpha: 0.15, drift: 0.35 }),
  Object.freeze({ depth: 8600, scale: 44000, alpha: 0.17, drift: 0.25 }),
  Object.freeze({ depth: 13500, scale: 62000, alpha: 0.19, drift: 0.18 }),
  Object.freeze({ depth: 20500, scale: 90000, alpha: 0.22, drift: 0.12 })
]);
export const DUST_LOOK_DEFAULTS = Object.freeze({
  rockLit: [0.19, 0.186, 0.178],
  rockShade: [0.012, 0.015, 0.022],
  iceLit: [0.16, 0.2, 0.26],
  iceShade: [0.011, 0.016, 0.028],
  density: 1.0,
  brightness: 1.0,
  shadow: 3.2
});
const GRID = 36;
const DUST_NOISE_WRAP = 20;
const NOISE_SIZE = 512;

function wrapDustNoise(v) {
  return v - Math.floor(v / DUST_NOISE_WRAP) * DUST_NOISE_WRAP;
}

// --- szum 2D (kafelkowany) — port NOISE2D_FRAGMENT --------------------------

const hashU2 = Fn(([p]) => {
  const q = p.mul(uvec2(1597334673, 3812015801)).toVar();
  const h = q.x.bitXor(q.y).mul(uint(1597334673)).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(2246822519)));
  h.assign(h.bitXor(h.shiftRight(uint(13))));
  return h;
}).setLayout({ name: 'fogHashU', type: 'uint', inputs: [{ name: 'p', type: 'uvec2' }] });

const h01 = Fn(([c, period, salt]) => {
  const w = c.mod(period).add(period).mod(period);
  const h = hashU2(uvec2(w).add(uvec2(salt, salt.mul(uint(7)))));
  return float(h.bitAnd(uint(0xFFFFFF))).div(16777215.0);
}).setLayout({ name: 'fogHash01', type: 'float', inputs: [{ name: 'c', type: 'ivec2' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

const tnoise2 = Fn(([p, period, salt]) => {
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const c = ivec2(floor(p)).toVar();
  const a = h01(c, period, salt);
  const b = h01(c.add(ivec2(1, 0)), period, salt);
  const d = h01(c.add(ivec2(0, 1)), period, salt);
  const e = h01(c.add(ivec2(1, 1)), period, salt);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}).setLayout({ name: 'fogTile', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

function makeTfbm2(basePeriod, salt, octaves, ridged, name) {
  return Fn(([uvIn]) => {
    const s = float(0).toVar();
    let amp = 0.5;
    let n = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      let v = tnoise2(uvIn.mul(period), int(period), uint(salt + o * 131));
      if (ridged) {
        const r = float(1.0).sub(abs(v.mul(2.0).sub(1.0)));
        v = r.mul(r);
      }
      s.addAssign(v.mul(amp));
      n += amp;
      amp *= 0.52;
      period *= 2;
    }
    return s.div(n);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'uv', type: 'vec2' }] });
}

function bakeFogNoise(renderer) {
  const tex = new THREE.StorageTexture(NOISE_SIZE, NOISE_SIZE);
  tex.name = 'fogNoise2D';
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  const fR = makeTfbm2(4, 7, 7, false, 'fogFbmR');
  const fG = makeTfbm2(6, 19, 6, true, 'fogFbmG');
  const fB = makeTfbm2(3, 37, 4, false, 'fogFbmB');
  const fA = makeTfbm2(3, 59, 4, false, 'fogFbmA');
  const node = Fn(() => {
    const x = instanceIndex.mod(NOISE_SIZE);
    const y = instanceIndex.div(NOISE_SIZE);
    const uvp = vec2(float(x), float(y)).div(NOISE_SIZE).toVar();
    textureStore(tex, uvec2(x, y), vec4(fR(uvp), fG(uvp), fB(uvp), fA(uvp)));
  })().compute(NOISE_SIZE * NOISE_SIZE).setName('fogNoiseBake');
  renderer.compute(node);
  return tex;
}

// --- płaty -------------------------------------------------------------------

export class BeltFog {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene pass tła (głębokie płaty)
   * @param {THREE.Scene} o.fgScene pass gry (płytkie płaty)
   * @param {import('../../src/game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {import('./lights.js').LightGrid} o.grid
   * @param {import('./sunMap.js').SunFieldMap} o.fieldMap mapa transmitancji słońca (wspólna z pyłem)
   */
  constructor({ renderer, scene, fgScene, field, grid, fieldMap }) {
    this.field = field;
    this.look = { ...DUST_LOOK_DEFAULTS };
    this.enabled = true;
    this.noise = bakeFogNoise(renderer);
    this.group = new THREE.Group();
    this.group.name = 'beltFog';
    this.fgGroup = new THREE.Group();
    this.fgGroup.name = 'beltFogFg';
    this._macroCache = new Map();
    this.U = {
      rockLit: uniform(new THREE.Vector3(...this.look.rockLit)),
      rockShade: uniform(new THREE.Vector3(...this.look.rockShade)),
      iceLit: uniform(new THREE.Vector3(...this.look.iceLit)),
      iceShade: uniform(new THREE.Vector3(...this.look.iceShade)),
      density: uniform(this.look.density),
      bright: uniform(this.look.brightness),
      shadowK: uniform(this.look.shadow),
      sunDir: uniform(new THREE.Vector2(1, 0)),
      sunOcc: uniform(1),
      stormColor: uniform(new THREE.Vector3(0.3, 0.2, 1.0)),
      stormGlow: uniform(0.12),
      time: uniform(0),
      lightScatter: uniform(1)
    };
    this.slices = DUST_SLICES.map((def, i) => this._makeSlice(def, i, grid, fieldMap));
    for (const s of this.slices) (s.def.fg ? this.fgGroup : this.group).add(s.mesh);
    scene.add(this.group);
    fgScene.add(this.fgGroup);
  }

  _makeSlice(def, i, grid, fieldMap) {
    const U = this.U;
    const geo = new THREE.PlaneGeometry(1, 1, GRID, GRID);
    const macroAttr = new THREE.BufferAttribute(new Float32Array((GRID + 1) * (GRID + 1) * 3), 3);
    macroAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aMacro', macroAttr);
    geo.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
    const S = {
      base: uniform(new THREE.Vector2()),
      scale: uniform(def.scale),
      drift: uniform(new THREE.Vector2()),
      alpha: uniform(def.alpha),
      seed: uniform(i * 1.618 + 0.3),
      // Reflektory (z ≈ +140) sięgają pyłem tylko płytkich płatów.
      scatter: uniform(def.depth <= 3000 ? 0.9 : 0.55)
    };
    const vLocal = varyingProperty('vec2', 'vFogLocal');
    const vMacro = varyingProperty('vec3', 'vFogMacro');
    const vScatter = varyingProperty('vec3', 'vFogScatter');
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.positionNode = Fn(() => {
      vLocal.assign(positionGeometry.xy);
      vMacro.assign(attribute('aMacro', 'vec3'));
      // Rozpraszanie świateł siatki w wierzchołku (płat to ośrodek bez normalnej).
      const P = modelWorldMatrix.mul(vec4(positionGeometry, 1.0)).xyz.toVar();
      const acc = vec3(0).toVar();
      grid.loop(P, ({ att, col, scatter }) => {
        acc.addAssign(col.mul(att).mul(scatter));
      });
      vScatter.assign(acc.mul(S.scatter).mul(U.lightScatter));
      return positionGeometry;
    })();
    const noise = this.noise;
    const sample = (p) => texture(noise, p);
    mat.fragmentNode = Fn(() => {
      const macro = vMacro.x.toVar();
      If(macro.lessThan(0.002), () => { Discard(); });
      const p = S.base.add(vLocal.div(S.scale)).add(vec2(S.seed.mul(0.371), S.seed.mul(0.613))).toVar();
      const w = sample(p.mul(0.55).add(vec2(0.13, 0.71))).ba.mul(2.0).sub(1.0).toVar();
      const q = p.add(w.mul(0.22)).add(S.drift).toVar();
      const body = sample(q).r.toVar();
      const fil = sample(q.mul(1.9).add(w.yx.mul(0.1)).add(0.37)).g.toVar();
      const fine = sample(q.mul(4.3).add(0.61)).r;
      const c = body.mul(0.78).add(fil.mul(0.32)).add(fine.mul(0.12)).div(1.22);
      const thr = mix(0.62, 0.5, macro).toVar();
      const d = smoothstep(thr, thr.add(0.16), c).mul(macro.mul(0.65).add(0.35)).toVar();
      If(d.lessThan(0.003), () => { Discard(); });
      const qs = q.add(U.sunDir.mul(0.07));
      const toward = sample(qs).r.mul(0.78).add(sample(qs.mul(1.9).add(w.yx.mul(0.1)).add(0.37)).g.mul(0.32)).div(1.1);
      const occl = smoothstep(thr.sub(0.04), thr.add(0.2), toward).mul(macro.mul(0.6).add(0.4)).toVar();
      const lit = exp(occl.mul(U.shadowK).negate());
      const edge = clamp(d.sub(occl).mul(1.6), 0.0, 1.0);
      const litC = mix(U.rockLit, U.iceLit, vMacro.y);
      const shadeC = mix(U.rockShade, U.iceShade, vMacro.y);
      // Słońce przesłonięte przez pole: mapa transmitancji pyłu (świat → scena).
      const muv = positionWorld.xy.sub(fieldMap.origin).mul(fieldMap.invSize);
      const sunT = mix(float(1.0), texture(fieldMap.texture, clamp(muv, 0.0, 1.0)).r, U.sunOcc).toVar();
      const col = mix(shadeC.mul(sunT), litC.mul(sunT), clamp(lit.add(edge.mul(0.35)), 0.0, 1.0).mul(sunT)).mul(U.bright);
      const a = clamp(float(1.0).sub(exp(d.mul(U.density).mul(2.2).negate())), 0.0, 1.0).mul(S.alpha).toVar();
      const scat = vScatter.mul(d.mul(0.6).add(0.4));
      const breathe = sin(U.time.mul(1.9).add(body.mul(13.0)).add(fil.mul(7.0))).mul(0.45).add(0.55);
      const storm = U.stormColor.mul(vMacro.z).mul(U.stormGlow).mul(smoothstep(0.45, 0.95, d)).mul(smoothstep(0.5, 0.8, fil)).mul(breathe);
      return vec4(col.add(scat).add(storm).mul(a), a);
    })();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Najgłębszy płat najpierw (kolejka przezroczysta sortuje po renderOrder);
    // w passie gry przed duszkami blasku (20) i pyłem (30).
    mesh.renderOrder = def.fg ? 8 + (2 - i) : 10 + (DUST_SLICES.length - 1 - i);
    mesh.name = `beltFog_${i}`;
    return { def, mesh, geo, S, step: 0, gx: NaN, gy: NaN, maxFog: 0 };
  }

  setVisible(v) {
    this.enabled = !!v;
    this.group.visible = this.enabled;
    this.fgGroup.visible = this.enabled;
  }

  _macro(wx, wy, step) {
    const key = `${step}|${Math.round(wx / step)}|${Math.round(wy / step)}`;
    let v = this._macroCache.get(key);
    if (v === undefined) {
      const m = this.field.sampleMacro(wx, wy);
      const fog = m.weight * (0.22 + 0.78 * Math.min(1, m.cluster * 1.15));
      v = [fog, m.ice, stormIntensity(this.field.seed, wx, wy, m.cluster)];
      if (this._macroCache.size > 20000) this._macroCache.clear();
      this._macroCache.set(key, v);
    }
    return v;
  }

  /**
   * @param {object} f cam {x,y,zoom} (świat gry), viewW, viewH, focalPx, time,
   *   sunX, sunY, originX, originY, sunOcc
   */
  update(f) {
    if (!this.enabled) return;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const sdx = f.sunX - f.cam.x;
    const sdy = -(f.sunY - f.cam.y);
    const sl = Math.hypot(sdx, sdy) || 1;
    this.U.sunDir.value.set(sdx / sl, sdy / sl);
    this.U.time.value = f.time;
    this.U.sunOcc.value = f.sunOcc ? 1 : 0;
    for (const s of this.slices) {
      const def = s.def;
      // Płytkie płaty w passie gry: kamera ortho, kadr bez rozszerzenia perspektywy.
      const spread = def.fg ? 1 : (camZ + def.depth) / camZ;
      const halfW = (f.viewW * 0.5 / zoom) * spread * 1.08;
      const halfH = (f.viewH * 0.5 / zoom) * spread * 1.08;
      const span = Math.max(halfW, halfH) * 2;
      const step = Math.pow(2, Math.ceil(Math.log2(span / (GRID - 2))));
      const gx = Math.floor(f.cam.x / step);
      const gy = Math.floor(f.cam.y / step);
      if (step !== s.step || gx !== s.gx || gy !== s.gy) {
        s.step = step; s.gx = gx; s.gy = gy;
        const pos = s.geo.getAttribute('position');
        const mac = s.geo.getAttribute('aMacro');
        const half = GRID / 2;
        let maxFog = 0;
        for (let j = 0; j <= GRID; j++) {
          for (let i = 0; i <= GRID; i++) {
            const idx = j * (GRID + 1) + i;
            const lx = (i - half) * step;
            const ly = (half - j) * step;
            pos.setXYZ(idx, lx, ly, 0);
            const wx = (gx + 0.5) * step + lx;
            const wy = (gy + 0.5) * step - ly;
            const m = this._macro(wx, wy, step);
            mac.setXYZ(idx, m[0], m[1], m[2]);
            if (m[0] > maxFog) maxFog = m[0];
          }
        }
        pos.needsUpdate = true;
        mac.needsUpdate = true;
        s.maxFog = maxFog;
        s.S.base.value.set(
          wrapDustNoise(((gx + 0.5) * step) / def.scale),
          wrapDustNoise((-(gy + 0.5) * step) / def.scale)
        );
      }
      // Środek płatu względem lokalnego początku sceny (double na CPU).
      s.mesh.position.set((s.gx + 0.5) * s.step - f.originX, -((s.gy + 0.5) * s.step - f.originY), -def.depth);
      s.mesh.updateMatrixWorld(true);
      s.S.drift.value.set(f.time * 0.0009 * def.drift, f.time * 0.0004 * def.drift);
      s.mesh.visible = s.maxFog > 0.002;
    }
  }
}
