// dema/rakiety-webgpu/lights.js — KOPIA dema/asteroidy-webgpu/lights.js (commit cb02194)
// bez map cieni reflektorów; demo rakiet jest samowystarczalne.
//
// Setki dynamicznych świateł: pula świateł na CPU → siatka komórek w świecie
// (płaszczyzna XY sceny wokół kamery) → bufory storage na GPU. Tę samą siatkę
// czytają:
//   • materiały powierzchni (skały, kadłuby) przez własny `Lighting` three
//     (GridLighting → GridLightsNode, wzorowany na examples/jsm/lighting/
//     TiledLighting.js): każde światło z komórki fragmentu idzie przez
//     lightingModel.direct(), jak światło punktowe three;
//   • symulację pyłu (dust.js): oświetlenie każdej drobiny w compute.
//
// Dlaczego nie TiledLighting z r183 wprost: jego kafel (32 px) mieści 8 świateł
// (_tileLightCount = 8, dalsze giną w kolejności indeksów — widać kafle), promień
// rzutu to distance / z bez ogniskowej kamery, a pył w compute nie ma
// piksela ekranu. Tu komórka w świecie ma listę bez limitu (sumy prefiksowe na
// CPU, ≤ 1024 świateł — ułamek milisekundy), a test zasięgu jest w 3D.
//
// Światło (4 × vec4): L0 = pozycja (scena) + zasięg, L1 = barwa × moc +
// rozpraszanie w pyle, L2 = oś reflektora + cos stożka zewn. (−2 = dookólne),
// L3 = cos stożka wewn., rozbłysk lampy, mapa cienia (1..n, 0 = bez), właściciel
// (kadłub nie łapie własnych lamp — jak w grze, gdzie własne lampy kadłuba
// liczy jego shader osobno). Tłumienie jak światła pola gry
// (src/3d/fieldLights3D.js): okno do zera na zasięgu × 1/(1 + 4x²).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec4, uniform, attributeArray, Loop, If,
  floor, max, abs, length, smoothstep, dot, normalize, positionWorld, cameraViewMatrix
} from 'three/tsl';
import { buildNavLightClusters, buildRoadLightWorldEmitters } from '../../src/game/shipLightRuntime.js';

export const LIGHT_CAP = 1536;
export const GRID_NX = 64;
export const GRID_NY = 40;
export const ITEM_CAP = 1 << 18;
const FLOATS = 16;

// Profil świateł pola dla kadłuba — KOPIA FIELD_SHIP_LIGHTS z
// src/3d/fieldLights3D.js (moduł importuje three z WebGL).
export const FIELD_SHIP_LIGHTS = Object.freeze({
  spot: Object.freeze({ rangeMul: 6.5, minRange: 2600, maxRange: 14000, coneDeg: 30, innerFrac: 0.45, intensity: 2.4, color: [1.0, 0.94, 0.84], z: 140, tiltDeg: 5, beam: 1.0 }),
  omni: Object.freeze({ rangeMul: 1.15, minRange: 700, maxRange: 2800, intensity: 0.5, color: [0.74, 0.84, 1.0], z: 320, scatter: 0.12 }),
  flood: Object.freeze({ rangeMul: 0.55, minRange: 450, maxRange: 2400, coneDeg: 110, innerFrac: 0.35, intensity: 1.0, color: [0.92, 0.95, 1.0], z: 60, tiltDeg: 16, beam: 0.3, flare: 0.2, scatter: 0.25 }),
  nav: Object.freeze({ intensity: 0.075, z: 40, rangeMul: 1.0, minRange: 320, scatter: 0.35 })
});

/**
 * Siatka świateł: pula (CPU) + bufory storage (GPU) + pętla TSL po światłach
 * komórki punktu.
 */
export class LightGrid {
  constructor() {
    this.lightNode = attributeArray(LIGHT_CAP * 4, 'vec4').setName('gridLights');
    this.cellNode = attributeArray(GRID_NX * GRID_NY, 'uvec2').setName('gridCells');
    this.itemNode = attributeArray(ITEM_CAP, 'uint').setName('gridItems');
    this.lights = this.lightNode.value.array;
    this.cells = this.cellNode.value.array;
    this.items = this.itemNode.value.array;
    this._counts = new Uint32Array(GRID_NX * GRID_NY);
    this._x0 = new Int16Array(LIGHT_CAP);
    this._x1 = new Int16Array(LIGHT_CAP);
    this._y0 = new Int16Array(LIGHT_CAP);
    this._y1 = new Int16Array(LIGHT_CAP);
    this.origin = uniform(new THREE.Vector2());
    this.invCell = uniform(new THREE.Vector2(1, 1));
    // Mnożnik wszystkich świateł siatki (przełącznik w panelu).
    this.gain = uniform(1);
    this.count = 0;
    this.itemsUsed = 0;
    this.dropped = 0;
    this.cellW = 1;
    this.cellH = 1;
    this.stats = { lights: 0, items: 0, maxPerCell: 0, dropped: 0 };
  }

  begin() {
    this.count = 0;
  }

  /**
   * Dodaje światło (współrzędne SCENY). Zwraca indeks albo −1 (pula pełna).
   * cosOuter ≤ −1,5 = dookólne.
   */
  add(x, y, z, range, r, g, b, scatter = 0.5, dx = 0, dy = 0, dz = -1, cosOuter = -2, cosInner = 0, flare = 0, shadow = 0, owner = 0) {
    if (this.count >= LIGHT_CAP || !(range > 1) || !(r + g + b > 1e-5)) return -1;
    const i = this.count++;
    const o = i * FLOATS;
    const L = this.lights;
    L[o] = x; L[o + 1] = y; L[o + 2] = z; L[o + 3] = range;
    L[o + 4] = r; L[o + 5] = g; L[o + 6] = b; L[o + 7] = scatter;
    L[o + 8] = dx; L[o + 9] = dy; L[o + 10] = dz; L[o + 11] = cosOuter;
    L[o + 12] = cosInner; L[o + 13] = flare; L[o + 14] = shadow; L[o + 15] = owner;
    return i;
  }

  /**
   * Buduje listy komórek dla prostokąta sceny [x0, x1] × [y0, y1] i wysyła
   * dane na GPU (tylko użyte zakresy buforów).
   */
  build(x0, y0, x1, y1) {
    const nx = GRID_NX;
    const ny = GRID_NY;
    const cw = Math.max(1, (x1 - x0) / nx);
    const ch = Math.max(1, (y1 - y0) / ny);
    this.cellW = cw;
    this.cellH = ch;
    this.origin.value.set(x0, y0);
    this.invCell.value.set(1 / cw, 1 / ch);
    const counts = this._counts;
    counts.fill(0);
    const L = this.lights;
    const n = this.count;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const o = i * FLOATS;
      const lx = L[o];
      const ly = L[o + 1];
      const range = L[o + 3];
      let bx0 = lx - range;
      let bx1 = lx + range;
      let by0 = ly - range;
      let by1 = ly + range;
      if (L[o + 11] > -1.5) {
        // Reflektor: prostokąt wycinka koła (próbki łuku + wierzchołek).
        const ax = L[o + 8];
        const ay = L[o + 9];
        const al = Math.hypot(ax, ay);
        if (al > 1e-4) {
          const half = Math.acos(Math.max(-1, Math.min(1, L[o + 11])));
          if (half < Math.PI * 0.5) {
            const base = Math.atan2(ay, ax);
            bx0 = bx1 = lx;
            by0 = by1 = ly;
            for (let k = 0; k <= 8; k++) {
              const a = base - half + (2 * half) * (k / 8);
              const px = lx + Math.cos(a) * range * 1.05;
              const py = ly + Math.sin(a) * range * 1.05;
              if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
              if (py < by0) by0 = py; if (py > by1) by1 = py;
            }
            const pad = range * 0.06;
            bx0 -= pad; bx1 += pad; by0 -= pad; by1 += pad;
          }
        }
      }
      const cx0 = Math.max(0, Math.floor((bx0 - x0) / cw));
      const cx1 = Math.min(nx - 1, Math.floor((bx1 - x0) / cw));
      const cy0 = Math.max(0, Math.floor((by0 - y0) / ch));
      const cy1 = Math.min(ny - 1, Math.floor((by1 - y0) / ch));
      this._x0[i] = cx0; this._x1[i] = cx1; this._y0[i] = cy0; this._y1[i] = cy1;
      if (cx0 > cx1 || cy0 > cy1) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) counts[cy * nx + cx]++;
      }
    }
    const C = this.cells;
    let maxPer = 0;
    for (let c = 0; c < nx * ny; c++) {
      const k = Math.min(counts[c], Math.max(0, ITEM_CAP - total));
      C[c * 2] = total;
      C[c * 2 + 1] = 0;
      if (counts[c] > maxPer) maxPer = counts[c];
      total += k;
    }
    let dropped = 0;
    const items = this.items;
    for (let i = 0; i < n; i++) {
      const cx0 = this._x0[i];
      const cx1 = this._x1[i];
      const cy0 = this._y0[i];
      const cy1 = this._y1[i];
      if (cx0 > cx1 || cy0 > cy1) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * nx + cx;
          const at = C[c * 2] + C[c * 2 + 1];
          if (at >= ITEM_CAP || C[c * 2 + 1] >= counts[c]) { dropped++; continue; }
          items[at] = i;
          C[c * 2 + 1]++;
        }
      }
    }
    this.itemsUsed = total;
    this.dropped = dropped;
    const la = this.lightNode.value;
    la.clearUpdateRanges();
    la.addUpdateRange(0, Math.max(1, n) * FLOATS);
    la.needsUpdate = true;
    this.cellNode.value.needsUpdate = true;
    const ia = this.itemNode.value;
    ia.clearUpdateRanges();
    ia.addUpdateRange(0, Math.max(1, total));
    ia.needsUpdate = true;
    this.stats.lights = n;
    this.stats.items = total;
    this.stats.maxPerCell = maxPer;
    this.stats.dropped = dropped;
  }

  /**
   * TSL: pętla po światłach komórki punktu P (scena). cb dostaje dla każdego
   * światła w zasięgu: toL (wektor do światła, jednostkowy), att (tłumienie ×
   * stożek × cień), col (barwa × moc), scatter, dist. skipOwner (węzeł) pomija
   * światła tego właściciela.
   */
  loop(P, cb, skipOwner = null) {
    const c = floor(P.xy.sub(this.origin).mul(this.invCell)).toVar();
    If(c.x.greaterThanEqual(0.0).and(c.y.greaterThanEqual(0.0)).and(c.x.lessThan(GRID_NX)).and(c.y.lessThan(GRID_NY)), () => {
      const cell = int(c.y).mul(GRID_NX).add(int(c.x));
      const range = this.cellNode.element(cell).toVar();
      Loop({ start: range.x, end: range.x.add(range.y), type: 'uint', condition: '<' }, ({ i }) => {
        const li = this.itemNode.element(i).mul(uint(4)).toVar();
        const L0 = this.lightNode.element(li).toVar();
        const d = L0.xyz.sub(P).toVar();
        const dist = length(d).toVar();
        const x = dist.div(max(L0.w, 1.0)).toVar();
        const L3 = this.lightNode.element(li.add(uint(3))).toVar();
        const use = skipOwner ? x.lessThan(1.0).and(abs(L3.w.sub(skipOwner)).greaterThan(0.5)) : x.lessThan(1.0);
        If(use, () => {
          const L1 = this.lightNode.element(li.add(uint(1)));
          const L2 = this.lightNode.element(li.add(uint(2))).toVar();
          const win = float(1.0).sub(x.mul(x));
          const att = win.mul(win).div(x.mul(x).mul(4.0).add(1.0)).toVar();
          const toL = d.div(max(dist, 1e-3)).toVar();
          If(L2.w.greaterThan(-1.5), () => {
            att.mulAssign(smoothstep(L2.w, L3.x, dot(toL.negate(), normalize(L2.xyz))));
          });
          cb({ toL, att, col: L1.xyz.mul(this.gain), scatter: L1.w, dist });
        });
      });
    });
  }
}

class GridLightsNode extends THREE.LightsNode {
  static get type() { return 'GridLightsNode'; }

  constructor(grid) {
    super();
    this.grid = grid;
  }

  get hasLights() {
    return true;
  }

  setupLights(builder, lightNodes) {
    const lightingModel = builder.context.reflectedLight;
    // Kolejność deklaracji przed pętlą (jak w TiledLightsNode).
    lightingModel.directDiffuse.toStack();
    lightingModel.directSpecular.toStack();
    super.setupLights(builder, lightNodes);
    const grid = this.grid;
    // Kadłub nie łapie świateł własnego statku (materiał ma lightOwner).
    const skip = builder.material && builder.material.lightOwner ? builder.material.lightOwner : null;
    Fn(() => {
      const P = positionWorld.toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const Lv = normalize(cameraViewMatrix.mul(vec4(toL, 0.0)).xyz);
        builder.lightsNode.setupDirectLight(builder, this, { lightDirection: Lv, lightColor: col.mul(att) });
      }, skip);
    }, 'void')();
  }
}

/** System oświetlenia renderera: słońce (DirectionalLight sceny) + siatka świateł. */
export class GridLighting extends THREE.Lighting {
  constructor(grid) {
    super();
    this.grid = grid;
  }

  createNode(lights = []) {
    return new GridLightsNode(this.grid).setLights(lights);
  }
}

// ---------------------------------------------------------------------------
// Światła statku (port FieldLights.addShip z src/3d/fieldLights3D.js)

const _emitters = [];
const _clusters = [];
const _emitterOptions = { out: _emitters, maxEmitters: 12 };
const _navOptions = { out: _clusters, time: 0 };

/**
 * Światła pola statku: reflektory dalekie (znaczniki `road` edytora),
 * reflektory otoczenia (`flood`, z obrysu), światło dookoła, grupy czerwonych
 * lamp pozycyjnych. Współrzędne świata gry → scena względem początku (ox, oy).
 * opts: { floods, nav, strength, time }
 */
const _farInfo = { n: 0, x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, coneDeg: 30, range: 0 };

export function addShipLights(grid, entity, hullLength, ox, oy, opts = {}) {
  const P = FIELD_SHIP_LIGHTS;
  const shadow = Number.isFinite(opts.shadowIndex) ? opts.shadowIndex + 1 : 0;
  const owner = opts.owner || 0;
  const far = _farInfo;
  far.n = 0; far.x = 0; far.y = 0; far.ax = 0; far.ay = 0;
  const k = opts.strength ?? 1;
  const L = Math.max(100, hullLength || 600);
  const sp = P.spot;
  const range = Math.min(sp.maxRange, Math.max(sp.minRange, L * sp.rangeMul));
  const angle = Number(entity.angle) || 0;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const ex = entity.pos.x;
  const ey = entity.pos.y;
  _emitters.length = 0;
  buildRoadLightWorldEmitters([entity], _emitterOptions);
  let farCount = 0;
  for (const em of _emitters) if (!em.flood) farCount++;
  const spot = (x, y, dirX, dirY, prof, intensity, rng, flare, shadowFlag = 0) => {
    const half = Math.max(1, Math.min(170, prof.coneDeg)) * Math.PI / 360;
    const tilt = (prof.tiltDeg ?? 0) * Math.PI / 180;
    const len = Math.hypot(dirX, dirY) || 1;
    const c = prof.color;
    const ax = (dirX / len) * Math.cos(tilt);
    const ay = -(dirY / len) * Math.cos(tilt);
    const az = -Math.sin(tilt);
    grid.add(
      x - ox, -(y - oy), prof.z, rng,
      c[0] * intensity * k, c[1] * intensity * k, c[2] * intensity * k,
      prof.scatter ?? 1, ax, ay, az,
      Math.cos(half), Math.cos(half * (prof.innerFrac ?? 0.45)), flare, shadowFlag, owner
    );
    if (shadowFlag) {
      // Średnia pozycja i oś reflektorów dalekich — kamera mapy cienia.
      far.n++;
      far.x += x - ox; far.y += -(y - oy); far.z = prof.z;
      far.ax += ax; far.ay += ay; far.az = az;
      far.coneDeg = prof.coneDeg; far.range = rng;
    }
  };
  if (farCount) {
    for (const em of _emitters) {
      if (em.flood) continue;
      spot(em.x, em.y, em.dir.x, em.dir.y, sp, sp.intensity / Math.sqrt(farCount), range, 1, shadow);
    }
  } else {
    const side = L * 0.035;
    for (let s = -1; s <= 1; s += 2) {
      spot(ex + fx * L * 0.47 - fy * side * s, ey + fy * L * 0.47 + fx * side * s, fx, fy, sp, sp.intensity / Math.SQRT2, range, 1, shadow);
    }
  }
  if (far.n) {
    far.x /= far.n; far.y /= far.n;
    const al = Math.hypot(far.ax, far.ay, far.az) || 1;
    far.ax /= far.n; far.ay /= far.n;
    const l2 = Math.hypot(far.ax, far.ay, far.az) || al;
    far.ax /= l2; far.ay /= l2; far.az /= l2;
  }
  if (opts.floods !== false) {
    const fl = P.flood;
    const floodRange = Math.min(fl.maxRange, Math.max(fl.minRange, L * fl.rangeMul));
    for (const em of _emitters) {
      if (!em.flood) continue;
      spot(em.x, em.y, em.dir.x, em.dir.y, fl, fl.intensity * (Number(em.power) || 1.5) / 1.5, floodRange, fl.flare);
    }
  }
  const om = P.omni;
  const omRange = Math.min(om.maxRange, Math.max(om.minRange, L * om.rangeMul));
  // Światło dookoła oświetla też własny kadłub (bez niego w mroku pola kadłub
  // gasł całkiem); lampy pozycyjne i reflektory własnego kadłuba już nie.
  grid.add(ex - ox, -(ey - oy), om.z, omRange, om.color[0] * om.intensity * k, om.color[1] * om.intensity * k, om.color[2] * om.intensity * k, om.scatter);
  if (opts.nav !== false) {
    const nv = P.nav;
    _navOptions.time = opts.time || 0;
    buildNavLightClusters([entity], _navOptions);
    for (const c of _clusters) {
      const intensity = nv.intensity * c.power * c.pulse * k;
      grid.add(c.x - ox, -(c.y - oy), nv.z, Math.max(nv.minRange, c.rangeWorld * nv.rangeMul),
        c.color.r * intensity, c.color.g * intensity, c.color.b * intensity, nv.scatter,
        0, 0, -1, -2, 0, 0, 0, owner);
    }
  }
  return far;
}
