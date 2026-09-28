// src/3d/asteroids/minedRocks.js
//
// Render skał w WYDOBYCIU (src/game/asteroidMining.js) — port dema/asteroidy-webgpu/
// minedRocks.js (zadanie 21b portu WebGPU): ciała z siatką komórek (przejęta skała pola,
// odłamy po wybuchu i cięciu) i okruchy.
//
//   • ATLAS 3D (Storage3DTexture RGBA8 256 × 256 × 128): każde ciało ma blok 64³ / 32³ /
//     16³ (przydział bliźniaczy), R = zapełnienie, G = ruda, B = zapełnienie pierwotne (z
//     chwili przejęcia). Zmiany siatki idą przez bufor storage i compute (three r183 wgrywa
//     teksturę 3D tylko w całości): blok w całości przy przydziale, potem pudełko zmian.
//   • ZEWNĘTRZE: ten sam materiał co pole (RockNodeMaterial, programy powierzchni typów) w
//     trybie `carve` — instancje z blokiem atlasu, piksele z wykopanego miejsca odpadają.
//     Skała po przejęciu wygląda jak przed.
//   • WNĘTRZE: raymarching po atlasie (pudełko siatki w układzie skały, BackSide, głębia z
//     trafienia) — tylko ściany WYCIĘTE (pierwotne zapełnienie > bieżące): skała z
//     warstwami, ruda gęstnieje ku rdzeniowi (metal lśni, kryształ i uran świecą), żar
//     świeżego cięcia, AO w otworach, światła siatki gry, słońce pola, pył ośrodka.
//   • OKRUCHY: RockSet (zwykłe skały z banku) z pozycją i obrotem z fizyki.
//   • minerały przejętych skał (MineralLayer w trybie wycięć) i cień w smugach reflektorów
//     (ShadowAtlas.enableCarve / gatherCarved).
//
// Zmiany względem dema (obraz ten sam): siatki pod grupą pola (Core3D.fx.origin) na
// warstwie passa gry, pozycje instancji LOKALNE; głębia wnętrza przez modelViewMatrix
// (double z CPU — grupa pola stoi na początku przy 6–10 mln j.); kolano bloomu pasa
// (beltBloomKnee); bufory bez DynamicDrawUsage (stały zakres wysyłki — PLAN §3, zadanie 15),
// wątki kopiowania do atlasu zaokrąglone do potęgi dwójki (r183 przelicza siatkę grup przy
// każdej zmianie liczby), wysyłka atlasu z budżetem komórek na klatkę, bez alokacji na klatkę.
// Jeden materiał na zewnętrze i jeden na wnętrze (graf budowany raz — nowy materiał skały
// kosztuje ~50 ms CPU, a wybuch daje kilkanaście odłamów).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, uvec3, vec3, vec4, uniform, uniformArray, attribute, attributeArray, varyingProperty,
  instanceIndex, textureStore, texture3D, positionGeometry, cameraProjectionMatrix, modelViewMatrix,
  Loop, If, Break, Return, Discard, select, mix, smoothstep, clamp, exp, max, min, pow, dot, normalize,
  length, sign
} from 'three/tsl';
import { RockNodeMaterial, hexToLinear } from './rockMaterial.js';
import { ROCK_LODS, pickRockLod } from './rockBank.js';
import { RockSet } from './rockLayers.js';
import { MineralLayer, MineralMaterial } from './minerals.js';
import { quatRotate, beltBloomKnee, permanentUpdateRange, markLiveRange } from './tslCommon.js';
import { ROCK_TYPES } from '../../game/asteroidRockKinds.js';

export const MINED_ATLAS = Object.freeze([256, 256, 128]);
const TOP = 64;
const STAGING_CELLS = TOP * TOP * TOP;
const EXT_FLOATS = 28;   // iPos, iRot, iSpin, iShape, iStretch, iCarve, iGrid
const INT_FLOATS = 28;   // iPos, iRot, iGrid, iDims, iAtlas, iHot, iMisc
export const MINED_MAX_BODIES = 48;
// Wysyłka do atlasu na klatkę: najwyżej tyle komórek (blok 64³ = 262 tys.) i wysyłek.
const UPLOAD_CELLS_PER_FRAME = 300000;
const UPLOADS_PER_FRAME = 4;
// Kolejka passa gry (asteroidBelt.js): skały 1, minerały −70.
const RENDER_ORDER = Object.freeze({ ext: 1, interior: 1, minerals: -70 });

// Barwa rudy WNĘTRZA (liniowo) i parametry: metal, emisja, połysk — per typ rudy
// (ROCK_TYPES). Skała neutralna bez rudy nie używa (udział 0).
const ORE_LOOK = Object.freeze({
  // Ruda w skale to nie lity metal: metaliczność < 1, żeby rdzeń miał barwę też w półmroku.
  iron: { color: '#8a8580', metal: 0.7, emit: 0.0, gloss: 70 },
  copper: { color: '#d8814a', metal: 0.6, emit: 0.0, gloss: 60 },
  silicon: { color: '#b9bfc6', metal: 0.25, emit: 0.0, gloss: 90 },
  titan: { color: '#9aa2ab', metal: 0.6, emit: 0.0, gloss: 80 },
  crystal: { color: '#5ce1ff', metal: 0.0, emit: 0.9, gloss: 120 },
  ice: { color: '#cfe6ff', metal: 0.0, emit: 0.05, gloss: 140 },
  uran: { color: '#6ef04e', metal: 0.0, emit: 0.7, gloss: 40 },
  rock: { color: '#6a645c', metal: 0.0, emit: 0.0, gloss: 20 },
  energy: { color: '#a070ff', metal: 0.0, emit: 1.2, gloss: 60 }
});

function nextPow2(n) {
  let p = 64;
  while (p < n) p *= 2;
  return p;
}

// ---------------------------------------------------------------------------
// Przydział bloków atlasu (bliźniaczy: 64³ → 8 × 32³ → 8 × 16³)

class BlockAtlas {
  constructor(size = MINED_ATLAS) {
    this.free = { 64: [], 32: [], 16: [] };
    this.freeKeys = { 64: new Set(), 32: new Set(), 16: new Set() };
    for (let z = 0; z < size[2]; z += 64) {
      for (let y = 0; y < size[1]; y += 64) {
        for (let x = 0; x < size[0]; x += 64) this._push(64, x, y, z);
      }
    }
  }

  _key(x, y, z) { return (x * 4096 + y) * 4096 + z; }

  _push(s, x, y, z) {
    this.free[s].push([x, y, z]);
    this.freeKeys[s].add(this._key(x, y, z));
  }

  _pop(s) {
    const b = this.free[s].pop();
    if (b) this.freeKeys[s].delete(this._key(b[0], b[1], b[2]));
    return b;
  }

  /** Blok na siatkę o największym wymiarze n (≤ 64) albo null. */
  alloc(n) {
    const want = n <= 16 ? 16 : n <= 32 ? 32 : n <= 64 ? 64 : 0;
    if (!want) return null;
    let s = want;
    while (s <= 64 && !this.free[s].length) s *= 2;
    if (s > 64) return null;
    let b = this._pop(s);
    while (s > want) {
      const h = s / 2;
      for (let k = 1; k < 8; k++) this._push(h, b[0] + (k & 1) * h, b[1] + ((k >> 1) & 1) * h, b[2] + ((k >> 2) & 1) * h);
      s = h;
    }
    return { x: b[0], y: b[1], z: b[2], size: want };
  }

  release(b) {
    let s = b.size, x = b.x, y = b.y, z = b.z;
    while (s < 64) {
      const p = s * 2;
      const px = Math.floor(x / p) * p, py = Math.floor(y / p) * p, pz = Math.floor(z / p) * p;
      let all = true;
      for (let k = 0; k < 8 && all; k++) {
        const cx = px + (k & 1) * s, cy = py + ((k >> 1) & 1) * s, cz = pz + ((k >> 2) & 1) * s;
        if (cx === x && cy === y && cz === z) continue;
        if (!this.freeKeys[s].has(this._key(cx, cy, cz))) all = false;
      }
      if (!all) break;
      // Scal: zdejmij 7 bliźniaków z wolnych, idź poziom wyżej.
      for (let k = 0; k < 8; k++) {
        const cx = px + (k & 1) * s, cy = py + ((k >> 1) & 1) * s, cz = pz + ((k >> 2) & 1) * s;
        if (this.freeKeys[s].delete(this._key(cx, cy, cz))) {
          const list = this.free[s];
          const i = list.findIndex((q) => q[0] === cx && q[1] === cy && q[2] === cz);
          if (i >= 0) list.splice(i, 1);
        }
      }
      s = p; x = px; y = py; z = pz;
    }
    this._push(s, x, y, z);
  }

  /** Wolne miejsce w jednostkach bloku 16³. */
  freeUnits() {
    return this.free[64].length * 64 + this.free[32].length * 8 + this.free[16].length;
  }
}

// ---------------------------------------------------------------------------

function makeInstanced(base, floats, names, capacity, name, layer, material, renderOrder, parent) {
  const data = new Float32Array(capacity * floats);
  const buffer = new THREE.InstancedInterleavedBuffer(data, floats, 1);
  const range = permanentUpdateRange(buffer);
  const ig = new THREE.InstancedBufferGeometry();
  ig.setIndex(base.index);
  ig.setAttribute('position', base.getAttribute('position'));
  if (base.getAttribute('aMip')) ig.setAttribute('aMip', base.getAttribute('aMip'));
  names.forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
  ig.instanceCount = 0;
  ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mesh = new THREE.Mesh(ig, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  mesh.name = name;
  mesh.layers.set(layer);
  parent.add(mesh);
  return { data, buffer, range, geo: ig, mesh, count: 0, capacity, floats };
}

export class MinedRocks {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Object3D} o.parent grupa pola (stoi na początku pola)
   * @param {number} [o.layer] warstwa passa Core3D (0 = gra)
   * @param {import('./rockBank.js').RockShapeBankGPU} o.bank
   * @param {object} o.shared uniformy skał (createRockShared; volume, noise)
   * @param {import('./rockMaterial.js').RockNodeMaterial} o.playMaterial materiał warstwy gry (okruchy)
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid siatka świateł gry
   * @param {import('../../game/asteroidMining.js').AsteroidMining} [o.mining]
   * @param {import('./minerals.js').MineralTemplates} [o.mineralTemplates]
   * @param {import('./spotShadows.js').ShadowAtlas} [o.shadows]
   * @param {(x:number, y:number) => number} [o.sunT] transmitancja słońca (okruchy)
   */
  constructor({ renderer, parent, layer = 0, bank, shared, playMaterial, grid, mining = null, mineralTemplates = null, shadows = null, sunT = null }) {
    this.renderer = renderer;
    this.parent = parent;
    this.layer = layer;
    this.bank = bank;
    this.S = shared;
    this.grid = grid;
    this.mining = mining;
    this.blocks = new BlockAtlas();
    // Sloty ciał: mapa ciało → slot i lista (bez iteratorów Map na klatkę).
    this.slots = new Map();
    this.slotList = [];
    this._frame = 0;
    const atlas = new THREE.Storage3DTexture(MINED_ATLAS[0], MINED_ATLAS[1], MINED_ATLAS[2]);
    atlas.name = 'AsteroidBelt:minedAtlas';
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.wrapS = atlas.wrapT = atlas.wrapR = THREE.ClampToEdgeWrapping;
    atlas.generateMipmaps = false;
    atlas.colorSpace = THREE.NoColorSpace;
    this.atlas = atlas;
    this.atlasSize = vec3(MINED_ATLAS[0], MINED_ATLAS[1], MINED_ATLAS[2]);
    this._buildCopy();
    // Zewnętrze: materiał skał w trybie wycięć (jeden na wszystkie ciała).
    this.extMaterial = new RockNodeMaterial({ shared, carve: { atlas, size: this.atlasSize } });
    this.extMaterial.name = 'AsteroidBelt:minedRocks';
    this.extMaterial.L.minPx.value = 0.05;
    const geoms = bank.ensureGeometries();
    this.ext = geoms.map((base, i) => makeInstanced(base, EXT_FLOATS, ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'iCarve', 'iGrid'],
      MINED_MAX_BODIES, `AsteroidBelt:minedExt_lod${i}`, layer, this.extMaterial, RENDER_ORDER.ext, parent));
    // Minerały przejętych skał (kryształy, lód, uran): ten sam szablon co w polu,
    // znikają tam, gdzie podstawa została wykopana albo odleciała w innym odłamie.
    this.minerals = null;
    if (mineralTemplates) {
      const mat = new MineralMaterial({ shared, layer: this.extMaterial.L, grid, minRockPx: 4, carve: { atlas, size: this.atlasSize } });
      mat.name = 'AsteroidBelt:mineralsMined';
      this.minerals = new MineralLayer({
        parent, layer, templates: mineralTemplates, material: mat, renderOrder: RENDER_ORDER.minerals,
        capacity: 4096, minRockPx: 4, carve: true, name: 'AsteroidBelt:mineralsMined'
      });
    }
    // Wnętrze: raymarching.
    this.intMaterial = this._buildInterior();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.int = makeInstanced(box, INT_FLOATS, ['iPos', 'iRot', 'iGrid', 'iDims', 'iAtlas', 'iHot', 'iMisc'],
      MINED_MAX_BODIES, 'AsteroidBelt:minedInterior', layer, this.intMaterial, RENDER_ORDER.interior, parent);
    // Cień w smugach reflektorów (spotShadows.js): wykopane miejsca bez cienia.
    this.shadows = shadows;
    this.shadowData = new Float32Array(MINED_MAX_BODIES * EXT_FLOATS);
    this.shadowCount = 0;
    if (shadows) shadows.enableCarve(bank, this.extMaterial, { atlas, size: this.atlasSize });
    // Okruchy: zwykłe skały banku.
    this.pebbleSet = new RockSet({ parent, layer, bank, material: playMaterial, zOf: (r) => r.z, name: 'AsteroidBelt:minedPebbles', maxLod: 3, sunT });
    this._pebbleRecords = [];
    this._pool = [];
    this._pebbleFrame = { cam: { x: 0, y: 0, zoom: 1 }, viewW: 1, viewH: 1, focalPx: 1 };
    this._o = [0, 0, 0];
    this.visible = false;
    this.stats = { bodies: 0, pebbles: 0, uploads: 0, uploadCells: 0, uploadMs: 0, blocksFree: 0, dropped: 0 };
  }

  // --- Kopiowanie do atlasu (compute) ---------------------------------------

  _buildCopy() {
    this.staging = attributeArray(STAGING_CELLS, 'uint').setName('minedStaging');
    this._stage = this.staging.value.array;
    this._stageRange = permanentUpdateRange(this.staging.value);
    const U = {
      count: uniform(0, 'uint'),
      sx: uniform(1, 'uint'),
      sy: uniform(1, 'uint'),
      ox: uniform(0, 'uint'),
      oy: uniform(0, 'uint'),
      oz: uniform(0, 'uint')
    };
    this.copyU = U;
    this.copyNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const x = instanceIndex.mod(U.sx);
      const y = instanceIndex.div(U.sx).mod(U.sy);
      const z = instanceIndex.div(U.sx.mul(U.sy));
      const v = this.staging.element(instanceIndex).toVar();
      const r = float(v.bitAnd(uint(255)));
      const g = float(v.shiftRight(uint(8)).bitAnd(uint(255)));
      const b = float(v.shiftRight(uint(16)).bitAnd(uint(255)));
      const a = float(v.shiftRight(uint(24)).bitAnd(uint(255)));
      textureStore(this.atlas, uvec3(U.ox.add(x), U.oy.add(y), U.oz.add(z)), vec4(r, g, b, a).div(255.0));
    })().compute(STAGING_CELLS).setName('minedAtlasCopy');
  }

  /** Pusty dispatch kopiowania (rozgrzewka pipeline'u compute). */
  warm() {
    this.copyU.count.value = 0;
    this.renderer.compute(this.copyNode, 64);
  }

  /** Wysyła pudełko komórek ciała do bloku (przy pełnym — cały blok, reszta = 0). Zwraca liczbę komórek. */
  _upload(body, block, full) {
    const st = this._stage;
    let i0 = 0, j0 = 0, k0 = 0, sx, sy, sz;
    if (full || !body.dirtyBox) {
      sx = sy = sz = block.size;
    } else {
      const b = body.dirtyBox;
      i0 = Math.max(0, b[0] - 1); j0 = Math.max(0, b[1] - 1); k0 = Math.max(0, b[2] - 1);
      sx = Math.min(body.nx, b[3] + 2) - i0; sy = Math.min(body.ny, b[4] + 2) - j0; sz = Math.min(body.nz, b[5] + 2) - k0;
      if (sx <= 0 || sy <= 0 || sz <= 0) return 0;
    }
    const { nx, ny, nz, fill, ore, orig } = body;
    let o = 0;
    for (let k = 0; k < sz; k++) {
      const kk = k + k0;
      for (let j = 0; j < sy; j++) {
        const jj = j + j0;
        for (let i = 0; i < sx; i++, o++) {
          const ii = i + i0;
          if (ii >= nx || jj >= ny || kk >= nz) { st[o] = 0; continue; }
          const idx = ii + nx * (jj + ny * kk);
          const fv = fill[idx];
          const f = fv >= 1 ? 255 : fv <= 0 ? 0 : Math.round(fv * 255);
          st[o] = (f | (ore[idx] << 8) | (orig[idx] << 16)) >>> 0;
        }
      }
    }
    const U = this.copyU;
    U.count.value = o;
    U.sx.value = sx;
    U.sy.value = sy;
    U.ox.value = block.x + i0;
    U.oy.value = block.y + j0;
    U.oz.value = block.z + k0;
    markLiveRange(this.staging.value, this._stageRange, o);
    this.renderer.compute(this.copyNode, nextPow2(o));
    this.stats.uploads++;
    this.stats.uploadCells += o;
    return o;
  }

  // --- Wnętrze (raymarching) -------------------------------------------------

  _buildInterior() {
    const S = this.S;
    const grid = this.grid;
    const atlas = this.atlas;
    const size = this.atlasSize;
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:minedInterior';
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.BackSide;
    mat.depthTest = true;
    mat.depthWrite = true;
    mat.transparent = false;
    const V = {
      local: varyingProperty('vec3', 'vMinedLocal'),
      pos: varyingProperty('vec4', 'vMinedPos'),
      rot: varyingProperty('vec4', 'vMinedRot'),
      grid: varyingProperty('vec4', 'vMinedGrid'),
      dims: varyingProperty('vec4', 'vMinedDims'),
      atlas: varyingProperty('vec4', 'vMinedAtlas'),
      hot: varyingProperty('vec4', 'vMinedHot'),
      misc: varyingProperty('vec4', 'vMinedMisc')
    };
    // Paleta rudy wnętrza per typ (jedna tablica: barwa, parametry; stała nazwa bufora).
    const lookRows = [];
    const lin = new THREE.Vector3();
    for (let i = 0; i < ROCK_TYPES.length; i++) {
      const L = ORE_LOOK[ROCK_TYPES[i]] || ORE_LOOK.rock;
      hexToLinear(L.color, lin);
      lookRows.push(new THREE.Vector4(lin.x, lin.y, lin.z, 1), new THREE.Vector4(L.metal, L.emit, L.gloss, 0));
    }
    const look = uniformArray(lookRows, 'vec4').setName('minedOreLook');
    mat.positionNode = Fn(() => {
      const iPos = attribute('iPos', 'vec4');
      const iRot = attribute('iRot', 'vec4');
      const iGrid = attribute('iGrid', 'vec4');
      const iDims = attribute('iDims', 'vec4');
      const ext = iDims.xyz.mul(iGrid.w);
      const local = positionGeometry.add(0.5).mul(ext).add(iGrid.xyz.sub(iGrid.w.mul(0.5))).toVar();
      V.local.assign(local);
      V.pos.assign(iPos);
      V.rot.assign(iRot);
      V.grid.assign(iGrid);
      V.dims.assign(iDims);
      V.atlas.assign(attribute('iAtlas', 'vec4'));
      V.hot.assign(attribute('iHot', 'vec4'));
      V.misc.assign(attribute('iMisc', 'vec4'));
      return iPos.xyz.add(quatRotate(iRot, local));
    })();
    const uvw = (p) => V.atlas.xyz.add(p.sub(V.grid.xyz).div(V.grid.w)).add(0.5).div(size);
    const cell = (p) => texture3D(atlas, uvw(p)).level(0);
    // Marsz: xyz = trafienie (układ skały), w = 1 trafione. Kamera passa gry patrzy w −Z sceny.
    const march = Fn(() => {
      const q = V.rot;
      const dL = normalize(quatRotate(vec4(q.xyz.negate(), q.w), vec3(0.0, 0.0, -1.0))).toVar();
      const cs = V.grid.w;
      const bmin = V.grid.xyz.sub(cs.mul(0.5));
      const bmax = bmin.add(V.dims.xyz.mul(cs));
      // Od punktu tylnej ściany (BackSide) wstecz do wejścia promienia w pudełko.
      const d = dL.negate();
      const safe = d.add(sign(d).mul(1e-6)).add(vec3(1e-9));
      const t1 = bmin.sub(V.local).div(safe);
      const t2 = bmax.sub(V.local).div(safe);
      const tBack = max(min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z)), 0.0).toVar();
      const start = V.local.add(d.mul(tBack)).toVar();
      const t = float(0.0).toVar();
      const prev = float(0.0).toVar();
      const hit = float(0.0).toVar();
      const stepL = cs.mul(0.9).toVar();
      Loop({ start: 0, end: 150, type: 'int', condition: '<', name: 'mi' }, () => {
        const f = cell(start.add(dL.mul(t))).r;
        If(f.greaterThanEqual(0.5), () => { hit.assign(1.0); Break(); });
        prev.assign(t);
        t.addAssign(stepL);
        If(t.greaterThan(tBack), () => { Break(); });
      });
      If(hit.greaterThan(0.5), () => {
        const lo = prev.toVar();
        const hi = t.toVar();
        for (let k = 0; k < 5; k++) {
          const m = lo.add(hi).mul(0.5).toVar();
          If(cell(start.add(dL.mul(m))).r.greaterThanEqual(0.5), () => { hi.assign(m); }).Else(() => { lo.assign(m); });
        }
        t.assign(hi);
      });
      return vec4(start.add(dL.mul(t)), hit);
    });
    const res = march().toVar('minedMarch');
    // Punkt w układzie grupy pola (lokalnie — dane instancji względem początku pola).
    const localOf = (p) => V.pos.xyz.add(quatRotate(V.rot, p));
    mat.depthNode = Fn(() => {
      // Głębia punktu trafienia: modelViewMatrix z CPU w double (grupa pola przy 6–10 mln j.).
      const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(localOf(res.xyz), 1.0));
      return clamp(clip.z.div(clip.w), 0.0, 1.0);
    })();
    mat.fragmentNode = Fn(() => {
      If(res.w.lessThan(0.5), () => { Discard(); });
      const pl = res.xyz.toVar();
      const cs = V.grid.w.toVar();
      const smp = cell(pl).toVar();
      // Tylko ściany wycięte (pierwotnie wewnątrz skały); pierwotną powierzchnię rysuje zewnętrze.
      const carved = smoothstep(0.58, 0.82, smp.b).toVar();
      If(carved.lessThan(0.5), () => { Discard(); });
      const e = cs.mul(0.6);
      const gx = cell(pl.add(vec3(e, 0, 0))).r.sub(cell(pl.sub(vec3(e, 0, 0))).r);
      const gy = cell(pl.add(vec3(0, e, 0))).r.sub(cell(pl.sub(vec3(0, e, 0))).r);
      const gz = cell(pl.add(vec3(0, 0, e))).r.sub(cell(pl.sub(vec3(0, 0, e))).r);
      const gl = length(vec3(gx, gy, gz));
      const nL = select(gl.greaterThan(1e-5), vec3(gx, gy, gz).div(gl).negate(), vec3(0, 0, 1)).toVar();
      // Mikrorzeźba przełomu z objętości szumu (gradient, 3 próbki) — bez niej ściany gładkie jak lej.
      // Dwie skale (drobna i gruba) w obróconych układach — jedna skala dawała regularne „bąble gąbki”.
      const bp = pl.div(85.0).add(vec3(V.misc.y.mul(2.3), 0.41, 0.13)).toVar();
      const bq = vec3(dot(pl, vec3(0.8, -0.6, 0.0)), dot(pl, vec3(0.36, 0.48, 0.8)), dot(pl, vec3(-0.48, -0.64, 0.6))).div(31.0).add(0.29).toVar();
      const b0 = texture3D(S.noise, bp).level(0).r;
      const q0 = texture3D(S.noise, bq).level(0).g;
      const bgx = texture3D(S.noise, bp.add(vec3(1 / 64, 0, 0))).level(0).r.sub(b0).add(texture3D(S.noise, bq.add(vec3(1 / 64, 0, 0))).level(0).g.sub(q0).mul(0.5));
      const bgy = texture3D(S.noise, bp.add(vec3(0, 1 / 64, 0))).level(0).r.sub(b0).add(texture3D(S.noise, bq.add(vec3(0, 1 / 64, 0))).level(0).g.sub(q0).mul(0.5));
      const bgz = texture3D(S.noise, bp.add(vec3(0, 0, 1 / 64))).level(0).r.sub(b0).add(texture3D(S.noise, bq.add(vec3(0, 0, 1 / 64))).level(0).g.sub(q0).mul(0.5));
      nL.assign(normalize(nL.sub(vec3(bgx, bgy, bgz).mul(2.6))));
      const N = normalize(quatRotate(V.rot, nL)).toVar();
      const P = localOf(pl).toVar();
      // Skała: barwy typu + ziarno z objętości szumu skał (drobniej niż na wierzchu).
      // Świeży przełom jaśniejszy niż wierzch (wietrzenie kosmiczne ciemni powierzchnie skał).
      const type = int(V.atlas.w.add(0.5)).toVar();
      const oreType = int(V.dims.w.add(0.5)).toVar();
      const seed = V.misc.y;
      const n1 = texture3D(S.noise, pl.div(310.0).add(vec3(seed.mul(3.7), seed.mul(1.3), 0.17))).level(0).toVar();
      const n2 = texture3D(S.noise, pl.div(95.0).add(vec3(0.31, seed.mul(5.1), 0.77))).level(0).toVar();
      const base = S.typeRow(type, 0).rgb;
      const base2 = S.typeRow(type, 1).rgb;
      const grain = n1.r.mul(0.6).add(n2.r.mul(0.4)).toVar();
      const albedo = mix(base2, base, smoothstep(0.3, 0.7, grain)).mul(n2.b.mul(0.3).add(0.85)).mul(1.45).toVar();
      // Ruda: plamy i żyłki gęstnieją z udziałem. W płaszczu minerał typu rudy (malachit,
      // azuryt, chondry — wiersze a / d materiału skał), w rdzeniu ruda właściwa
      // (ORE_LOOK: metal lśni, kryształ i uran świecą).
      const ore = smp.g.toVar();
      const lookC = look.element(oreType.mul(2)).rgb.toVar();
      const lookP = look.element(oreType.mul(2).add(1)).toVar();
      const oreMask = smoothstep(0.35, 0.65, ore.mul(1.25).add(n2.g.sub(0.5).mul(0.6)).add(n1.a.sub(0.5).mul(0.25))).toVar();
      const oreCov = max(oreMask, smoothstep(0.7, 0.92, ore)).toVar();
      const coreK = smoothstep(0.55, 0.85, ore).toVar();
      // Płaszcz: główny minerał typu (wiersz a), drugi (wiersz d) tylko rzadkimi plamkami.
      const mineral = mix(S.typeRow(oreType, 2).rgb, S.typeRow(oreType, 5).rgb, smoothstep(0.82, 0.9, n2.a).mul(0.7)).mul(1.3);
      const oreCol = mix(mineral, lookC, coreK).mul(n2.r.mul(0.35).add(0.8));
      albedo.assign(mix(albedo, oreCol, oreCov));
      const metal = lookP.x.mul(oreCov).mul(coreK).toVar();
      const gloss = mix(float(18.0), lookP.z, oreCov).toVar();
      // AO w otworze: ile skały dookoła wzdłuż normalnej (głębokie tunele ciemniejsze).
      const occ = cell(pl.add(nL.mul(cs.mul(1.5)))).r.mul(0.5)
        .add(cell(pl.add(nL.mul(cs.mul(3.0)))).r.mul(0.3))
        .add(cell(pl.add(nL.mul(cs.mul(6.0)))).r.mul(0.2));
      const ao = clamp(float(1.0).sub(occ.mul(0.7)), 0.25, 1.0).toVar();
      // Światło: słońce (przesłanianie pola), otoczenie (gaśnie w mroku), światła siatki.
      const sunT = mix(float(1.0), V.misc.x, S.sunOcc).toVar();
      const fillK = mix(float(0.22), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96))).toVar();
      const Vw = vec3(0.0, 0.0, 1.0);
      const ndl = dot(N, S.sunDir).toVar();
      const diff = S.sunColor.mul(sunT).mul(clamp(ndl.add(0.12).div(1.12), 0.0, 1.0)).toVar();
      const spec = S.sunColor.mul(sunT).mul(pow(max(dot(N, normalize(S.sunDir.add(Vw))), 0.0), gloss)).mul(step01(ndl)).mul(metal.mul(0.8).add(0.05)).toVar();
      const amb = S.ambientTop.mul(N.z.mul(0.25).add(0.75)).mul(fillK).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const c = col.mul(att).toVar();
        const nl = dot(N, toL);
        diff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
        spec.addAssign(c.mul(pow(max(dot(N, normalize(toL.add(Vw))), 0.0), gloss)).mul(step01(nl)).mul(metal.mul(1.2).add(0.06)));
      });
      const kd = float(1.0).sub(metal.mul(0.8));
      const col = albedo.mul(diff.add(amb).mul(ao)).mul(kd).add(spec.mul(mix(vec3(1.0), lookC, metal)).mul(ao)).toVar();
      // Metal odbija otoczenie (jak odblask metali w materiale skał): słabe tło i blask słońca.
      const Rv = Vw.negate().add(N.mul(N.z.mul(2.0)));
      const glare = pow(max(dot(Rv, S.sunDir), 0.0), 6.0);
      col.addAssign(lookC.mul(S.ambientTop.mul(0.5).mul(fillK).add(S.sunColor.mul(0.35).mul(glare).mul(sunT))).mul(metal).mul(ao));
      // Emisja rudy (kryształ, uran, energetyczna): świeci rdzeń, HDR tylko na najgęstszej rudzie.
      col.addAssign(lookC.mul(lookP.y).mul(oreCov.mul(oreCov)).mul(smoothstep(0.5, 0.95, ore).mul(1.6).add(0.25)).mul(0.35));
      // Żar świeżego cięcia lasera: biały środek, pomarańczowy brzeg, stygnie.
      const hd = pl.sub(V.hot.xyz);
      const hr = cs.mul(2.4);
      const heat = V.hot.w.mul(exp(dot(hd, hd).div(hr.mul(hr)).negate())).toVar();
      col.addAssign(mix(vec3(2.6, 0.7, 0.12), vec3(6.0, 4.2, 2.4), heat.mul(heat)).mul(heat));
      // Kolano bloomu dema (demo liczyło bloom bez ×3 gry), potem pył ośrodka jak nad skałą
      // (do stropu warstwy skał) — kolejność jak w materiale skał pola.
      const outc = beltBloomKnee(col.mul(S.exposure)).toVar();
      if (S.volume) {
        const v = S.volume.sample(vec3(P.xy, max(P.z, S.rockLayerTop)));
        outc.assign(outc.mul(v.a).add(v.rgb));
      }
      return vec4(max(outc, vec3(0.0)), 1.0);
    })();
    this.V = V;
    return mat;
  }

  // --- Klatka -------------------------------------------------------------------

  /**
   * @param {object} f { zoom, originX, originY (świat gry), camX, camY }
   */
  update(f) {
    const mining = this.mining;
    if (!mining) return;
    const frameNo = ++this._frame;
    const ox = f.originX, oy = f.originY;
    const st = this.stats;
    st.dropped = 0;
    // Ciała tej klatki: stempel na slotach; sloty ciał, których już nie ma — do zwolnienia.
    const bodies = mining.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const s = this.slots.get(bodies[i]);
      if (s) s.seen = frameNo;
    }
    for (let i = this.slotList.length - 1; i >= 0; i--) {
      const s = this.slotList[i];
      if (s.seen === frameNo && s.body.alive) continue;
      this.blocks.release(s.block);
      this.slots.delete(s.body);
      const last = this.slotList.length - 1;
      this.slotList[i] = this.slotList[last];
      this.slotList.length = last;
    }
    for (let i = 0; i < this.ext.length; i++) this.ext[i].count = 0;
    this.int.count = 0;
    this.shadowCount = 0;
    this.minerals?.begin();
    let uploads = 0;
    let cellsLeft = UPLOAD_CELLS_PER_FRAME;
    let t0 = 0;
    const o = this._o;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      let slot = this.slots.get(body);
      if (!slot) {
        const block = this.blocks.alloc(Math.max(body.nx, body.ny, body.nz));
        if (!block) { st.dropped++; continue; }
        slot = { body, block, version: -1, seen: frameNo };
        this.slots.set(body, slot);
        this.slotList.push(slot);
      }
      if (slot.version !== body.version && uploads < UPLOADS_PER_FRAME && cellsLeft > 0) {
        if (!uploads) t0 = performance.now();
        cellsLeft -= this._upload(body, slot.block, slot.version < 0);
        slot.version = body.version;
        body.dirtyBox = null;
        uploads++;
      }
      if (slot.version < 0) continue;
      bodyOrigin(body, o);
      const sx = o[0] - ox, sy = o[1] + oy, sz = o[2];
      // Zewnętrze: LOD z promienia na ekranie.
      const rPx = body.r * f.zoom;
      const lod = pickRockLod(rPx, ROCK_LODS.length - 1);
      const E = this.ext[lod];
      if (E.count < E.capacity) {
        const d = E.data;
        const b = E.count++ * EXT_FLOATS;
        d[b] = sx; d[b + 1] = sy; d[b + 2] = sz; d[b + 3] = body.r;
        d[b + 4] = body.q[0]; d[b + 5] = body.q[1]; d[b + 6] = body.q[2]; d[b + 7] = body.q[3];
        d[b + 8] = 0; d[b + 9] = 0; d[b + 10] = 1; d[b + 11] = 0;
        d[b + 12] = body.shape; d[b + 13] = body.type; d[b + 14] = body.seed; d[b + 15] = 0;
        d[b + 16] = body.sx; d[b + 17] = body.sy; d[b + 18] = body.sz; d[b + 19] = body.sunT;
        d[b + 20] = slot.block.x; d[b + 21] = slot.block.y; d[b + 22] = slot.block.z; d[b + 23] = body.cs;
        d[b + 24] = body.gx; d[b + 25] = body.gy; d[b + 26] = body.gz; d[b + 27] = 0;
        // Minerały tylko typów, które je mają (wywołanie z liczbą w argumencie V8 pakuje,
        // gdy nie wklei appendRock — typy bez minerałów nie wołają go wcale).
        if (this.minerals && this.minerals.templates.hasType(body.type)) this.minerals.appendRock(d, b, rPx);
        if (this.shadowCount < MINED_MAX_BODIES) {
          const sd = this.shadowData;
          const so = this.shadowCount * EXT_FLOATS;
          for (let k = 0; k < EXT_FLOATS; k++) sd[so + k] = d[b + k];
          this.shadowCount++;
        }
      }
      // Wnętrze.
      const I = this.int;
      if (I.count < I.capacity) {
        const d = I.data;
        const b = I.count++ * INT_FLOATS;
        d[b] = sx; d[b + 1] = sy; d[b + 2] = sz; d[b + 3] = 0;
        d[b + 4] = body.q[0]; d[b + 5] = body.q[1]; d[b + 6] = body.q[2]; d[b + 7] = body.q[3];
        d[b + 8] = body.gx; d[b + 9] = body.gy; d[b + 10] = body.gz; d[b + 11] = body.cs;
        const oreIdx = body.oreTypeId ? ROCK_TYPES.indexOf(body.oreTypeId) : body.type;
        d[b + 12] = body.nx; d[b + 13] = body.ny; d[b + 14] = body.nz; d[b + 15] = Math.max(0, oreIdx);
        d[b + 16] = slot.block.x; d[b + 17] = slot.block.y; d[b + 18] = slot.block.z; d[b + 19] = body.type;
        const heat = Math.max(0, 1 - (mining.time - body.hot[3]) / 1.4);
        d[b + 20] = body.hot[0]; d[b + 21] = body.hot[1]; d[b + 22] = body.hot[2]; d[b + 23] = heat;
        d[b + 24] = body.sunT; d[b + 25] = body.seed; d[b + 26] = body.generation; d[b + 27] = 0;
      }
    }
    if (uploads) st.uploadMs = performance.now() - t0;
    for (let i = 0; i < this.ext.length; i++) this._commit(this.ext[i]);
    this.minerals?.commit();
    this._commit(this.int);
    this.extMaterial.L.pxScale.value = f.zoom;
    this.extMaterial.L.camZ.value = 0;
    // Okruchy (rekordy z puli — bez obiektu na okruch na klatkę).
    const recs = this._pebbleRecords;
    recs.length = 0;
    const pebbles = mining.pebbles;
    for (let i = 0; i < pebbles.length; i++) {
      const p = pebbles[i];
      const r = this._pool[i] || (this._pool[i] = { id: 0, x: 0, y: 0, z: 0, r: 1, d: 2, shape: 0, type: 0, qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0, sx: 1, sy: 1, sz: 0.9, seed: 0, alive: true });
      r.id = p.id; r.x = p.p[0]; r.y = -p.p[1]; r.z = p.p[2]; r.r = p.r; r.d = p.r * 2;
      r.shape = p.shape; r.type = p.type; r.seed = p.seed;
      r.qx = p.q[0]; r.qy = p.q[1]; r.qz = p.q[2]; r.qw = p.q[3];
      recs.push(r);
    }
    this.pebbleSet.setOrigin(ox, oy);
    this.pebbleSet.set(recs);
    const pf = this._pebbleFrame;
    pf.cam.x = f.camX ?? ox; pf.cam.y = f.camY ?? oy; pf.cam.zoom = f.zoom;
    this.pebbleSet.update(pf);
    st.bodies = this.int.count;
    st.pebbles = recs.length;
    st.blocksFree = this.blocks.freeUnits();
    this.visible = st.bodies > 0 || st.pebbles > 0;
  }

  _commit(inst) {
    const n = inst.count;
    inst.geo.instanceCount = n;
    inst.mesh.visible = n > 0;
    if (n) markLiveRange(inst.buffer, inst.range, n * inst.floats);
  }

  /** Pole poza kadrem: nic nie rysujemy (ciała zostają w fizyce). */
  hide() {
    for (let i = 0; i < this.ext.length; i++) { this.ext[i].count = 0; this._commit(this.ext[i]); }
    this.int.count = 0;
    this._commit(this.int);
    this.minerals?.clear();
    this.shadowCount = 0;
    this._pebbleRecords.length = 0;
    this.pebbleSet.set(this._pebbleRecords);
    this.pebbleSet.buckets.clear();
    this.visible = false;
  }
}

function step01(x) {
  return select(x.greaterThan(0.0), float(1.0), float(0.0));
}

// Początek układu skały (RockBody.origin) liczony w miejscu — bez wywołań z liczbami w
// argumentach (V8 pakuje je, gdy nie wklei funkcji), co klatkę dla każdego ciała.
function bodyOrigin(b, out) {
  const q = b.q, c = b.com, p = b.p;
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const x = c[0], y = c[1], z = c[2];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = p[0] - (x + qw * tx + (qy * tz - qz * ty));
  out[1] = p[1] - (y + qw * ty + (qz * tx - qx * tz));
  out[2] = p[2] - (z + qw * tz + (qx * ty - qy * tx));
  return out;
}
