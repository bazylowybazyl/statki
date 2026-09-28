// dema/bronie-webgpu/lightGrid.js
//
// Siatka świateł dema broni — kopia LightGrid / GridLightsNode / GridLighting
// z dema asteroid (dema/asteroidy-webgpu/lights.js, commit 9859d07) bez świateł
// statku i map cienia reflektorów. Własna kopia, bo tamten moduł jest rozwijany
// pod demo asteroid (cienie, profile reflektorów) i jego API się zmienia.
//
// Pula świateł na CPU → siatka komórek w świecie (płaszczyzna XY sceny wokół
// kamery) → bufory storage. Tę samą siatkę czytają materiały powierzchni
// (kadłuby, wieżyczki — przez `Lighting` three → lightingModel.direct()) oraz
// compute dymu i odłamków (gpuFx.js). Lista komórki bez limitu (sumy
// prefiksowe na CPU), test zasięgu w 3D. Tłumienie jak światła pola gry
// (src/3d/fieldLights3D.js): okno do zera na zasięgu × 1/(1 + 4x²).
//
// Światło (4 × vec4): L0 = pozycja (scena) + zasięg, L1 = barwa × moc +
// rozpraszanie, L2 = oś reflektora + cos stożka zewn. (−2 = dookólne),
// L3 = cos stożka wewn., rozbłysk, -, właściciel.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec4, uniform, attributeArray, Loop, If,
  floor, max, abs, length, smoothstep, dot, normalize, positionWorld, cameraViewMatrix
} from 'three/tsl';

export const LIGHT_CAP = 1536;
export const GRID_NX = 64;
export const GRID_NY = 40;
export const ITEM_CAP = 1 << 18;
const FLOATS = 16;

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
    this.gain = uniform(1);
    this.count = 0;
    this.stats = { lights: 0, items: 0, maxPerCell: 0, dropped: 0 };
  }

  begin() { this.count = 0; }

  /** Światło (współrzędne SCENY). cosOuter ≤ −1,5 = dookólne. Zwraca indeks albo −1. */
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

  /** Listy komórek dla prostokąta sceny [x0, x1] × [y0, y1] i wysyłka na GPU. */
  build(x0, y0, x1, y1) {
    const nx = GRID_NX;
    const ny = GRID_NY;
    const cw = Math.max(1, (x1 - x0) / nx);
    const ch = Math.max(1, (y1 - y0) / ny);
    this.origin.value.set(x0, y0);
    this.invCell.value.set(1 / cw, 1 / ch);
    const counts = this._counts;
    counts.fill(0);
    const L = this.lights;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const o = i * FLOATS;
      const lx = L[o];
      const ly = L[o + 1];
      const range = L[o + 3];
      const cx0 = Math.max(0, Math.floor((lx - range - x0) / cw));
      const cx1 = Math.min(nx - 1, Math.floor((lx + range - x0) / cw));
      const cy0 = Math.max(0, Math.floor((ly - range - y0) / ch));
      const cy1 = Math.min(ny - 1, Math.floor((ly + range - y0) / ch));
      this._x0[i] = cx0; this._x1[i] = cx1; this._y0[i] = cy0; this._y1[i] = cy1;
      if (cx0 > cx1 || cy0 > cy1) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) counts[cy * nx + cx]++;
      }
    }
    const C = this.cells;
    let total = 0;
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
      const cx0 = this._x0[i]; const cx1 = this._x1[i];
      const cy0 = this._y0[i]; const cy1 = this._y1[i];
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
   * TSL: pętla po światłach komórki punktu P (scena). cb dostaje: toL (wektor
   * jednostkowy do światła), att (tłumienie × stożek), col (barwa × moc), scatter, dist.
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
  static get type() { return 'BronieGridLightsNode'; }

  constructor(grid) {
    super();
    this.grid = grid;
  }

  get hasLights() { return true; }

  setupLights(builder, lightNodes) {
    const lightingModel = builder.context.reflectedLight;
    lightingModel.directDiffuse.toStack();
    lightingModel.directSpecular.toStack();
    super.setupLights(builder, lightNodes);
    const grid = this.grid;
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
