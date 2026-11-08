// src/3d/asteroids/fog.js
//
// Mgła pasa — port dema/asteroidy-webgpu/fog.js (zadanie 21; tam port płatów dawnego
// beltDust3D.js do TSL). Zmiany względem dema: płaty pod grupami pola na warstwach
// passów Core3D (płytkie: 0 — gra, głębokie: 1 — tło), punkty dla siatki świateł
// i mapy pola LOKALNIE (środek płatu z CPU + wierzchołek — bez positionWorld float32),
// płytkie płaty w kolejce passa gry przed kwadem dna ośrodka (renderOrder ujemny —
// efekty gry mają ≥ 0).
//
// płaty objętości pod płaszczyzną gry — DWA PŁYTKIE (200 i 600 j.) w passie
// gry (kamera ortho, test głębi ze skałami gry: dolne części skał toną w mgle,
// czubki wystają) i sześć głębszych (1300–20 500 j.) w passie tła (kamera
// persp., test głębi ze skałami tła), kafelkowany szum 2D
// (tu z compute do tekstury storage), gęstość makro pola w wierzchołkach
// siatki 36 × 36 kotwiczonej w świecie, samocień w stronę słońca, pochłanianie
// (blend premultiplied „over”). Światła siatki (lights.js) rozpraszają się
// w płatach — liczone w WIERZCHOŁKACH, jak w grze (smugi reflektorów w mgle).
// Nad mgłą idzie fizyczny pył (dust.js) w passie gry.
// JEDNA MGŁA (2026-10-22): płytkie płaty (fg) gasną pod gazem w otwartej przestrzeni (src/3d/spaceGas/ — SpaceGasCover.belt);
// bez gazu (opcja wył.) zostają jak dawniej. Głębokie płaty tła — bez zmian.
//
// JEDEN RYSUNEK NA PASS (2026-11-02, klatka workera — każdy rysunek three r183 to ~10 µs CPU): płaty passa (6 głębokich,
// 2 płytkie) leżą w JEDNEJ siatce (`AsteroidBelt:fogBack` / `:fogFg`) — wierzchołki płatów w kolejności dawnych rysunków
// (najgłębszy pierwszy; mieszanie w jednym rysunku idzie w kolejności prymitywów, więc wynik jak płaty po kolei), numer
// płatu w aMacro.w, wartości płatu w tablicy uniformów (FOG_SLICE_VEC4 vec4 na płat). Płat zostaje NOŚNIKIEM
// (`slice.mesh` — Object3D w tej samej grupie co dawna siatka: pozycja, widoczność, warstwa, macierz świata z synchronizacji
// sceny), a macierz model-widok płatu liczy aktualizacja tablicy przy rysunku: kamera rysunku × macierz świata nośnika —
// tak jak `highpModelViewMatrix` three (double na CPU, float32 w buforze), więc pozycje co do bitu jak dawne siatki.
// Płat niewidoczny zwija się w wierzchołku. A/B: `BeltFog.merged = false` przed utworzeniem pasa — dawne siatki płatów.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, ivec2, uvec2, vec2, vec3, vec4, mat4, uniform, uniformArray, attribute, varying, varyingProperty,
  instanceIndex, textureStore, texture, positionGeometry, positionLocal,
  If, Discard, mix, smoothstep, clamp, floor, fract, abs, exp, sin, select
} from 'three/tsl';
import { stormIntensity } from '../../game/asteroidStorms.js';
import { SpaceGasCover } from '../spaceGas/spaceGasState.js';
import { zbierzZakres } from '../zakresyWysylki.js';

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
// Wartości płatu w tablicy uniformów scalonej siatki (vec4): 0–3 macierz model-widok (kolumny), 4 (base.xy, drift.xy),
// 5 (scale, alpha, seed, scatter), 6 (center.xyz, widoczność).
export const FOG_SLICE_VEC4 = 7;
const _fogMV = new THREE.Matrix4();

function wrapDustNoise(v) {
  return v - Math.floor(v / DUST_NOISE_WRAP) * DUST_NOISE_WRAP;
}

/**
 * Tablica płatów scalonej siatki (A — Float32Array tablicy uniformów) z nośników i wartości płatów; z kamerą rysunku
 * także macierze model-widok (kamera × macierz świata nośnika, double → float32 — jak highpModelViewMatrix three).
 */
export function writeFogSlices(A, slices, camera) {
  for (let k = 0; k < slices.length; k++) {
    const s = slices[k];
    const S = s.S;
    const o = k * FOG_SLICE_VEC4 * 4;
    if (camera) {
      _fogMV.multiplyMatrices(camera.matrixWorldInverse, s.mesh.matrixWorld);
      const e = _fogMV.elements;
      for (let j = 0; j < 16; j++) A[o + j] = e[j];
    }
    const base = S.base.value, drift = S.drift.value, c = S.center.value;
    A[o + 16] = base.x; A[o + 17] = base.y; A[o + 18] = drift.x; A[o + 19] = drift.y;
    A[o + 20] = S.scale.value; A[o + 21] = S.alpha.value; A[o + 22] = S.seed.value; A[o + 23] = S.scatter.value;
    A[o + 24] = c.x; A[o + 25] = c.y; A[o + 26] = c.z; A[o + 27] = s.mesh.visible ? 1 : 0;
  }
}

// Materiał scalonej siatki: pozycja widoku z macierzy płatu (zamiast modelViewMatrix siatki), płat niewidoczny zwinięty
// poza bryłę obcinania (jak partie kadłubów — HullNodeMaterial).
class BeltFogNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'BeltFogNodeMaterial';
  }

  setupPositionView(builder) {
    return this.fogPositionView || super.setupPositionView(builder);
  }

  setupModelViewProjection(builder) {
    const clip = super.setupModelViewProjection(builder);
    return this.fogVisible ? select(this.fogVisible.greaterThan(0.5), clip, vec4(2.0, 2.0, 2.0, 1.0)) : clip;
  }
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
   * @param {THREE.Object3D} o.bgParent grupa pola passa tła (głębokie płaty, warstwa bgLayer)
   * @param {THREE.Object3D} o.fgParent grupa pola passa gry (płytkie płaty, warstwa fgLayer)
   * @param {import('../../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid
   * @param {import('./fieldMap.js').FieldMap} o.fieldMap mapa pola (R = słońce)
   */
  constructor({ renderer, bgParent, fgParent, bgLayer = 1, fgLayer = 0, field, grid, fieldMap }) {
    this.bgLayer = bgLayer;
    this.fgLayer = fgLayer;
    this.field = field;
    this.look = { ...DUST_LOOK_DEFAULTS };
    this.enabled = true;
    this.noise = bakeFogNoise(renderer);
    this.group = new THREE.Group();
    this.group.name = 'AsteroidBelt:fog';
    this.fgGroup = new THREE.Group();
    this.fgGroup.name = 'AsteroidBelt:fogFg';
    this._macroCache = new Map();
    this._holeVersion = field.holeVersion || 0;
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
    // Płaty: nośniki (pozycja, widoczność, warstwa — jak dawne siatki płatów) i JEDNA siatka na pass (passy: gra, tło).
    this.slices = DUST_SLICES.map((def, i) => this._makeSlice(def, i));
    for (const s of this.slices) (s.def.fg ? this.fgGroup : this.group).add(s.mesh);
    this.draws = [this._makeDraw(true, grid, fieldMap), this._makeDraw(false, grid, fieldMap)];
    for (const d of this.draws) (d.fg ? this.fgGroup : this.group).add(d.mesh);
    bgParent.add(this.group);
    fgParent.add(this.fgGroup);
  }

  // Nośnik płatu: Object3D w grupie passa (bez rysunku) — pozycja i macierz świata jak dawna siatka płatu; wartości
  // płatu w obiektach { value } (narzędzia czytają `slice.S.alpha.value`, `slice.mesh.visible`).
  _makeSlice(def, i) {
    const S = {
      base: { value: new THREE.Vector2() },
      scale: { value: def.scale },
      drift: { value: new THREE.Vector2() },
      alpha: { value: def.alpha },
      seed: { value: i * 1.618 + 0.3 },
      // Reflektory (z ≈ +140) sięgają pyłem tylko płytkich płatów.
      scatter: { value: def.depth <= 3000 ? 0.9 : 0.55 },
      // Środek płatu LOKALNIE (względem początku pola), z = −głębokość.
      center: { value: new THREE.Vector3() }
    };
    const mesh = new THREE.Object3D();
    mesh.name = `AsteroidBelt:fog_${i}`;
    mesh.layers.set(def.fg ? this.fgLayer : this.bgLayer);
    mesh.visible = false;
    return { def, index: i, mesh, S, step: 0, gx: NaN, gy: NaN, maxFog: 0, draw: null, slot: 0, vStart: 0 };
  }

  // Scalona siatka płatów passa: wierzchołki płatów w kolejności dawnych rysunków (najgłębszy pierwszy — dawny
  // renderOrder rósł ku płytszym), numer płatu w aMacro.w, wartości płatów w tablicy uniformów (writeFogSlices przy
  // rysunku, z kamerą rysunku). Graf jak dawny graf płatu — wartości płatu z tablicy zamiast uniformów płatu.
  _makeDraw(fg, grid, fieldMap) {
    const U = this.U;
    const slices = this.slices.filter((s) => !!s.def.fg === fg).sort((a, b) => b.index - a.index);
    const n = slices.length;
    const plane = new THREE.PlaneGeometry(1, 1, GRID, GRID);
    const pv = plane.getAttribute('position').count;
    const pIdx = plane.index.array;
    const ni = pIdx.length;
    const index = new Uint16Array(n * ni);
    const mac = new Float32Array(n * pv * 4);
    for (let k = 0; k < n; k++) {
      const s = slices[k];
      s.slot = k;
      s.vStart = k * pv;
      for (let j = 0; j < ni; j++) index[k * ni + j] = pIdx[j] + k * pv;
      for (let v = 0; v < pv; v++) mac[(k * pv + v) * 4 + 3] = k;
    }
    plane.dispose();
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(n * pv * 3), 3);
    const macAttr = new THREE.BufferAttribute(mac, 4);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aMacro', macAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const data = uniformArray(Array.from({ length: n * FOG_SLICE_VEC4 }, () => new THREE.Vector4()), 'vec4')
      .setName(fg ? 'beltFogSlicesFg' : 'beltFogSlicesBg');
    // Przy każdym rysunku (kamera TEGO rysunku — pass, widok podzielonego ekranu, rozgrzewka): wartości i macierze płatów.
    data.onObjectUpdate(function (frame) { writeFogSlices(this.value, slices, frame ? frame.camera : null); });
    const el = (slot, k) => data.element(slot.mul(FOG_SLICE_VEC4).add(k));
    const aMacro = attribute('aMacro', 'vec4');
    const slotV = int(aMacro.w);
    const vLocal = varyingProperty('vec2', 'vFogLocal');
    const vMacro = varyingProperty('vec3', 'vFogMacro');
    const vScatter = varyingProperty('vec3', 'vFogScatter');
    const vSlot = varying(aMacro.w, 'vFogSlot').setInterpolation('flat');
    const mat = new BeltFogNodeMaterial();
    mat.name = fg ? 'AsteroidBelt:fogFg' : 'AsteroidBelt:fogBack';
    mat.premultipliedAlpha = false;
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
    // Pozycja widoku i widoczność z WŁASNYM odczytem numeru płatu (pułapka 36: węzeł wspólny z etapem wierzchołków i
    // pozycją widoku dawał w WGSL odczyt zmiennej przed przypisaniem).
    const aMacroP = attribute('aMacro', 'vec4');
    const slotP = int(aMacroP.w);
    mat.fogPositionView = mat4(el(slotP, 0), el(slotP, 1), el(slotP, 2), el(slotP, 3)).mul(positionLocal).xyz;
    mat.fogVisible = el(slotP, 6).w;
    mat.positionNode = Fn(() => {
      vLocal.assign(positionGeometry.xy);
      vMacro.assign(aMacro.xyz);
      if (fg) {
        // Płytkie płaty leżą w ośrodku światła wolumetrycznego (volumetrics.js)
        // — tam smugi reflektorów liczą się per froxel, z cieniem skał.
        vScatter.assign(vec3(0.0));
      } else {
        // Głębokie płaty: rozpraszanie świateł siatki w wierzchołku (błyski
        // w chmurach burzy, łuny wybuchów pod płaszczyzną).
        const P = el(slotV, 6).xyz.add(positionGeometry).toVar();
        const acc = vec3(0).toVar();
        grid.loop(P, ({ att, col, scatter }) => {
          acc.addAssign(col.mul(att).mul(scatter));
        });
        vScatter.assign(acc.mul(el(slotV, 5).w).mul(U.lightScatter));
      }
      return positionGeometry;
    })();
    const noise = this.noise;
    const sample = (p) => texture(noise, p);
    mat.fragmentNode = Fn(() => {
      // płat fragmentu: (base.xy, drift.xy), (scale, alpha, seed, scatter), (center.xyz, widoczność)
      const sF = int(vSlot);
      const d4 = el(sF, 4).toVar();
      const d5 = el(sF, 5).toVar();
      const d6 = el(sF, 6).toVar();
      const macro = vMacro.x.toVar();
      If(macro.lessThan(0.002), () => { Discard(); });
      const p = d4.xy.add(vLocal.div(d5.x)).add(vec2(d5.z.mul(0.371), d5.z.mul(0.613))).toVar();
      const w = sample(p.mul(0.55).add(vec2(0.13, 0.71))).ba.mul(2.0).sub(1.0).toVar();
      const q = p.add(w.mul(0.22)).add(d4.zw).toVar();
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
      const muv = d6.xy.add(vLocal).sub(fieldMap.origin).mul(fieldMap.invSize);
      const sunT = mix(float(1.0), texture(fieldMap.texture, clamp(muv, 0.0, 1.0)).r, U.sunOcc).toVar();
      const col = mix(shadeC.mul(sunT), litC.mul(sunT), clamp(lit.add(edge.mul(0.35)), 0.0, 1.0).mul(sunT)).mul(U.bright);
      const a = clamp(float(1.0).sub(exp(d.mul(U.density).mul(2.2).negate())), 0.0, 1.0).mul(d5.y).toVar();
      const scat = vScatter.mul(d.mul(0.6).add(0.4));
      const breathe = sin(U.time.mul(1.9).add(body.mul(13.0)).add(fil.mul(7.0))).mul(0.45).add(0.55);
      const storm = U.stormColor.mul(vMacro.z).mul(U.stormGlow).mul(smoothstep(0.45, 0.95, d)).mul(smoothstep(0.5, 0.8, fil)).mul(breathe);
      return vec4(col.add(scat).add(storm).mul(a), a);
    })();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Kolejka jak dawny NAJGŁĘBSZY płat passa (płytsze rysowały się tuż po nim): w passie gry przed kwadem dna ośrodka
    // (−50) i efektami gry (≥ 0), po minerałach (−70); w passie tła po zasłonie (−0,1) i skałach tła. Pozycję sortowania
    // (z) ustawia update — pierwszy widoczny płat.
    mesh.renderOrder = fg ? -58 - slices[0].index : 10 + (DUST_SLICES.length - 1 - slices[0].index);
    mesh.name = fg ? 'AsteroidBelt:fogFg:płaty' : 'AsteroidBelt:fogBack:płaty';
    mesh.layers.set(fg ? this.fgLayer : this.bgLayer);
    mesh.visible = false;
    const draw = { fg, slices, mesh, geo, posAttr, macAttr, mat, mats: slices.map(() => mat), pv, ni, data };
    for (const s of slices) s.draw = draw;
    return draw;
  }

  setVisible(v) {
    this.enabled = !!v;
    this.group.visible = this.enabled;
    this.fgGroup.visible = this.enabled;
  }

  /** Pole poza kadrem: płaty schowane (siatki przebudują się przy powrocie). */
  hideAll() {
    for (const sl of this.slices) {
      sl.mesh.visible = false;
      sl.step = 0;
    }
    for (const d of this.draws) d.mesh.visible = false;
  }

  // Po płatach klatki: siatka passa widoczna, gdy widać choć jeden płat; pozycja sortowania (z kolejki przezroczystej) =
  // pierwszy widoczny płat (dawna siatka tego płatu); przy splitDraws grupa na widoczny płat (rysunek na płat).
  _syncDraws() {
    for (const d of this.draws) {
      let first = null;
      for (const s of d.slices) if (s.mesh.visible) { first = s; break; }
      d.mesh.visible = first !== null;
      if (first) {
        d.mesh.position.copy(first.mesh.position);
        d.mesh.updateMatrixWorld(true);
      }
      if (BeltFog.splitDraws) {
        d.geo.clearGroups();
        for (const s of d.slices) if (s.mesh.visible) d.geo.addGroup(s.slot * d.ni, d.ni, s.slot);
        if (d.mesh.material !== d.mats) d.mesh.material = d.mats;
      } else if (d.mesh.material !== d.mat) {
        d.geo.clearGroups();
        d.mesh.material = d.mat;
      }
    }
  }

  _macro(wx, wy, step) {
    const key = `${step}|${Math.round(wx / step)}|${Math.round(wy / step)}`;
    let v = this._macroCache.get(key);
    if (v === undefined) {
      const m = this.field.sampleMacro(wx, wy);
      // Wyrwa po wydobyciu rozrzedza mgłę jak skały (m.hole); źródło gazu (m.gas — dziś 0) dołożyłoby swoją.
      const fog = m.weight * (0.22 + 0.78 * Math.min(1, m.cluster * 1.15)) * m.hole + m.gas;
      // [mgła, lód, burza, x, y] — położenie do unieważnienia przy wyrwie.
      v = [fog, m.ice, stormIntensity(this.field.seed, wx, wy, m.cluster), wx, wy];
      if (this._macroCache.size > 20000) this._macroCache.clear();
      this._macroCache.set(key, v);
    }
    return v;
  }

  /**
   * @param {object} f cam {x,y,zoom} (świat gry), viewW, viewH, focalPx, time,
   *   sunX, sunY, originX, originY, sunOcc, fade (zanik pola przy skoku gracza 0..1 — krycie płatów; brak — 1)
   */
  update(f) {
    if (!this.enabled) return;
    const fade = f.fade >= 0 && f.fade < 1 ? f.fade : 1;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const sdx = f.sunX - f.cam.x;
    const sdy = -(f.sunY - f.cam.y);
    const sl = Math.hypot(sdx, sdy) || 1;
    this.U.sunDir.value.set(sdx / sl, sdy / sl);
    this.U.time.value = f.time;
    this.U.sunOcc.value = f.sunOcc ? 1 : 0;
    // Nowe wyrwy (field.setHoles): próbki i płaty tylko tam, gdzie zmiana dotyka (wyrwa w innej części pasa
    // nie przebudowuje mgły w kadrze).
    if ((this.field.holeVersion || 0) !== this._holeVersion) {
      const seen = this._holeVersion;
      this._holeVersion = this.field.holeVersion || 0;
      for (const [key, v] of this._macroCache) {
        if (this.field.holesTouch(seen, v[3], v[4], v[3], v[4])) this._macroCache.delete(key);
      }
      for (const s of this.slices) {
        if (!(s.step > 0)) continue;
        const half = (GRID / 2 + 1) * s.step;
        const cx = (s.gx + 0.5) * s.step;
        const cy = (s.gy + 0.5) * s.step;
        if (this.field.holesTouch(seen, cx - half, cy - half, cx + half, cy + half)) s.step = 0;
      }
    }
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
        // wierzchołki płatu w scalonej siatce passa (od s.vStart), wysyłka zakresem płatu
        const D = s.draw;
        const pos = D.posAttr.array;
        const mac = D.macAttr.array;
        const half = GRID / 2;
        let maxFog = 0;
        for (let j = 0; j <= GRID; j++) {
          for (let i = 0; i <= GRID; i++) {
            const idx = s.vStart + j * (GRID + 1) + i;
            const lx = (i - half) * step;
            const ly = (half - j) * step;
            pos[idx * 3] = lx; pos[idx * 3 + 1] = ly; pos[idx * 3 + 2] = 0;
            const wx = (gx + 0.5) * step + lx;
            const wy = (gy + 0.5) * step - ly;
            const m = this._macro(wx, wy, step);
            mac[idx * 4] = m[0]; mac[idx * 4 + 1] = m[1]; mac[idx * 4 + 2] = m[2];
            if (m[0] > maxFog) maxFog = m[0];
          }
        }
        zbierzZakres(D.posAttr, s.vStart * 3, D.pv * 3);
        zbierzZakres(D.macAttr, s.vStart * 4, D.pv * 4);
        s.maxFog = maxFog;
        s.S.base.value.set(
          wrapDustNoise(((gx + 0.5) * step) / def.scale),
          wrapDustNoise((-(gy + 0.5) * step) / def.scale)
        );
      }
      // Środek płatu względem lokalnego początku sceny (double na CPU).
      s.mesh.position.set((s.gx + 0.5) * s.step - f.originX, -((s.gy + 0.5) * s.step - f.originY), -def.depth);
      s.mesh.updateMatrixWorld(true);
      s.S.center.value.copy(s.mesh.position);
      s.S.drift.value.set(f.time * 0.0009 * def.drift, f.time * 0.0004 * def.drift);
      // płytkie płaty pod gazem przestrzeni: alfa × (1 − pokrycie) — jedna mgła w paśmie gry
      const cover = def.fg ? SpaceGasCover.belt : 0;
      s.S.alpha.value = def.alpha * (1 - cover) * fade;
      s.mesh.visible = s.maxFog > 0.002 && cover < 0.999 && fade > 0.002;
    }
    this._syncDraws();
  }
}

// A/B w biegu (klatka workera, --wkAb): true — rysunek na widoczny płat (grupy scalonej siatki, ten sam program, dawna
// liczba rysunków); false — jeden rysunek na pass.
BeltFog.splitDraws = false;
