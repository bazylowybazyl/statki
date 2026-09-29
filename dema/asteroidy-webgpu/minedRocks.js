// dema/asteroidy-webgpu/minedRocks.js
//
// Render skał w WYDOBYCIU (src/game/asteroidMining.js): ciała z siatką komórek
// (przejęta skała pola, odłamy po wybuchu i cięciu) i okruchy.
//
//   • ATLAS 3D (Storage3DTexture RGBA8 256 × 256 × 128): każde ciało ma blok
//     64³ / 32³ / 16³ (przydział bliźniaczy), R = zapełnienie, G = ruda,
//     B = zapełnienie pierwotne (z chwili przejęcia), A = udział RDZENIA
//     (lita bryła materiału rdzenia — coreLook.js). Zmiany siatki idą przez
//     bufor storage i compute (three r183 wgrywa teksturę 3D tylko w całości):
//     blok w całości przy przydziale, potem tylko pudełko zmian.
//   • ZEWNĘTRZE: ten sam materiał co pole (RockNodeMaterial, programy
//     powierzchni typów) w trybie `carve` — instancje z blokiem atlasu, piksele
//     z wykopanego miejsca odpadają. Skała po przejęciu wygląda jak przed.
//   • WNĘTRZE: raymarching po atlasie (pudełko siatki w układzie skały,
//     BackSide, głębia z trafienia) — tylko ściany WYCIĘTE (pierwotne
//     zapełnienie > bieżące: otwory lasera, szczeliny piły, powierzchnie
//     pęknięć): skała z warstwami, ruda gęstnieje ku rdzeniowi, a sam rdzeń to
//     lita bryła (metal lśni, kryształy świecą, lód, smółka uranu), żar świeżego
//     cięcia, fioletowy żar pustej geody po ucieczce pioruna kulistego, AO
//     w otworach, światła siatki, słońce, pył ośrodka jak nad skałą.
//   • OKRUCHY: odłamki (fragments.js) — kanciaste kawałki skorupy i kawałki
//     rdzenia jego materiałem, NIE skały z banku (z wybuchu leciały „małe asteroidy”).
//
// Jeden materiał na zewnętrze i jeden na wnętrze (graf budowany raz — nowy
// materiał skały kosztuje ~50 ms CPU, a wybuch daje kilkanaście odłamów).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, uvec3, vec3, vec4, uniform, uniformArray, attribute, attributeArray, varyingProperty,
  instanceIndex, textureStore, texture3D, positionGeometry, cameraProjectionMatrix, cameraViewMatrix,
  Loop, If, Break, Return, Discard, select, mix, smoothstep, clamp, exp, max, min, pow, dot, normalize,
  length, sign, abs
} from 'three/tsl';
import { RockNodeMaterial, hexToLinear } from './rockMaterial.js';
import { ROCK_LODS, pickRockLod } from './rockBank.js';
import { MineralLayer, MineralMaterial } from './minerals.js';
import { quatRotate } from './tslCommon.js';
import { FragmentSet } from './fragments.js';
import { createCoreLookArray, coreSurface } from './coreLook.js';
import { ROCK_TYPES } from '../../src/game/asteroidRockKinds.js';

export const MINED_ATLAS = Object.freeze([256, 256, 128]);
const TOP = 64;
const STAGING_CELLS = TOP * TOP * TOP;
const EXT_FLOATS = 28;   // iPos, iRot, iSpin, iShape, iStretch, iCarve, iGrid
const INT_FLOATS = 32;   // iPos, iRot, iGrid, iDims, iAtlas, iHot, iMisc, iPlasma
const MAX_BODIES = 48;
// Żar pustej geody po ucieczce pioruna kulistego [s].
const PLASMA_GLOW_LIFE = 6;

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

  _key(x, y, z) { return `${x},${y},${z}`; }

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
        const key = this._key(cx, cy, cz);
        if (this.freeKeys[s].delete(key)) {
          const list = this.free[s];
          const i = list.findIndex((q) => q[0] === cx && q[1] === cy && q[2] === cz);
          if (i >= 0) list.splice(i, 1);
        }
      }
      s = p; x = px; y = py; z = pz;
    }
    this._push(s, x, y, z);
  }
}

// ---------------------------------------------------------------------------

function makeInstanced(base, floats, names, capacity) {
  const data = new Float32Array(capacity * floats);
  const buffer = new THREE.InstancedInterleavedBuffer(data, floats, 1);
  buffer.setUsage(THREE.DynamicDrawUsage);
  const ig = new THREE.InstancedBufferGeometry();
  ig.setIndex(base.index);
  ig.setAttribute('position', base.getAttribute('position'));
  if (base.getAttribute('aMip')) ig.setAttribute('aMip', base.getAttribute('aMip'));
  names.forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
  ig.instanceCount = 0;
  ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { data, buffer, geo: ig, count: 0, capacity };
}

export class MinedRocks {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene pass gry
   * @param {import('./rockBank.js').RockShapeBankGPU} o.bank
   * @param {object} o.shared uniformy skał (createRockShared; volume, noise)
   * @param {import('./lights.js').LightGrid} o.grid
   * @param {import('../../src/game/asteroidMining.js').AsteroidMining} o.mining
   */
  constructor({ renderer, scene, bank, shared, grid, mining, mineralTemplates = null, shadows = null }) {
    this.renderer = renderer;
    this.scene = scene;
    this.bank = bank;
    this.S = shared;
    this.grid = grid;
    this.mining = mining;
    this.blocks = new BlockAtlas();
    this.slots = new Map();   // ciało → { block, version }
    const atlas = new THREE.Storage3DTexture(MINED_ATLAS[0], MINED_ATLAS[1], MINED_ATLAS[2]);
    atlas.name = 'minedAtlas';
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
    this.extMaterial.L.minPx.value = 0.05;
    const geoms = bank.ensureGeometries();
    this.ext = geoms.map((base, i) => {
      const inst = makeInstanced(base, EXT_FLOATS, ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'iCarve', 'iGrid'], MAX_BODIES);
      const mesh = new THREE.Mesh(inst.geo, this.extMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.visible = false;
      mesh.name = `minedExt_lod${i}`;
      scene.add(mesh);
      return { ...inst, mesh, lod: i };
    });
    // Minerały przejętych skał (kryształy, lód, uran): ten sam szablon co w polu,
    // znikają tam, gdzie podstawa została wykopana albo odleciała w innym odłamie.
    this.minerals = null;
    if (mineralTemplates) {
      const mat = new MineralMaterial({ shared, layer: this.extMaterial.L, grid, minRockPx: 4, carve: { atlas, size: this.atlasSize } });
      this.minerals = new MineralLayer({ scene, templates: mineralTemplates, material: mat, renderOrder: 2, capacity: 4096, minRockPx: 4, carve: true, name: 'minerals_mined' });
    }
    // Wnętrze: raymarching (skała, ruda, lita bryła rdzenia).
    this.coreLook = createCoreLookArray();
    this.intMaterial = this._buildInterior();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.int = makeInstanced(box, INT_FLOATS, ['iPos', 'iRot', 'iGrid', 'iDims', 'iAtlas', 'iHot', 'iMisc', 'iPlasma'], MAX_BODIES);
    this.intMesh = new THREE.Mesh(this.int.geo, this.intMaterial);
    this.intMesh.frustumCulled = false;
    this.intMesh.renderOrder = 1;
    this.intMesh.visible = false;
    this.intMesh.name = 'minedInterior';
    scene.add(this.intMesh);
    // Cień w smugach reflektorów (spotShadows.js): wykopane miejsca bez cienia.
    this.shadows = shadows;
    this.shadowData = new Float32Array(MAX_BODIES * EXT_FLOATS);
    this.shadowCount = 0;
    if (shadows) shadows.enableCarve(bank, this.extMaterial, { atlas, size: this.atlasSize });
    // Okruchy: odłamki skorupy i kawałki rdzenia (nie skały banku).
    this.fragments = new FragmentSet({ scene, shared, grid });
    this.stats = { bodies: 0, pebbles: 0, corePebbles: 0, uploads: 0, uploadCells: 0, blocksFree: 0 };
  }

  // --- Kopiowanie do atlasu (compute) ---------------------------------------

  _buildCopy() {
    this.staging = attributeArray(STAGING_CELLS, 'uint').setName('minedStaging');
    this._stage = this.staging.value.array;
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

  /** Wysyła pudełko komórek ciała [i0..i1] × … do bloku (reszta bloku przy pełnym = 0). */
  _upload(body, block, full) {
    const st = this._stage;
    let i0 = 0, j0 = 0, k0 = 0, sx, sy, sz;
    if (full || !body.dirtyBox) {
      sx = sy = sz = block.size;
    } else {
      const b = body.dirtyBox;
      i0 = Math.max(0, b[0] - 1); j0 = Math.max(0, b[1] - 1); k0 = Math.max(0, b[2] - 1);
      sx = Math.min(body.nx, b[3] + 2) - i0; sy = Math.min(body.ny, b[4] + 2) - j0; sz = Math.min(body.nz, b[5] + 2) - k0;
      if (sx <= 0 || sy <= 0 || sz <= 0) return;
    }
    const { nx, ny, nz, fill, ore, orig, coreFill } = body;
    let o = 0;
    for (let k = 0; k < sz; k++) {
      const kk = k + k0;
      for (let j = 0; j < sy; j++) {
        const jj = j + j0;
        for (let i = 0; i < sx; i++, o++) {
          const ii = i + i0;
          if (ii >= nx || jj >= ny || kk >= nz) { st[o] = 0; continue; }
          const idx = ii + nx * (jj + ny * kk);
          const f = Math.round(Math.min(1, Math.max(0, fill[idx])) * 255);
          st[o] = (f | (ore[idx] << 8) | (orig[idx] << 16) | (coreFill[idx] << 24)) >>> 0;
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
    const attr = this.staging.value;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, o);
    attr.needsUpdate = true;
    this.renderer.compute(this.copyNode, o);
    this.stats.uploads++;
    this.stats.uploadCells += o;
  }

  // --- Wnętrze (raymarching) -------------------------------------------------

  _buildInterior() {
    const S = this.S;
    const grid = this.grid;
    const atlas = this.atlas;
    const size = this.atlasSize;
    const mat = new THREE.NodeMaterial();
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
      misc: varyingProperty('vec4', 'vMinedMisc'),
      plasma: varyingProperty('vec4', 'vMinedPlasma')
    };
    const coreLook = this.coreLook;
    // Paleta rudy wnętrza per typ (jedna tablica: barwa, parametry).
    const lookRows = [];
    const lin = new THREE.Vector3();
    for (let i = 0; i < ROCK_TYPES.length; i++) {
      const L = ORE_LOOK[ROCK_TYPES[i]] || ORE_LOOK.rock;
      hexToLinear(L.color, lin);
      lookRows.push(new THREE.Vector4(lin.x, lin.y, lin.z, 1), new THREE.Vector4(L.metal, L.emit, L.gloss, 0));
    }
    const look = uniformArray(lookRows, 'vec4');
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
      V.plasma.assign(attribute('iPlasma', 'vec4'));
      return iPos.xyz.add(quatRotate(iRot, local));
    })();
    const uvw = (p) => V.atlas.xyz.add(p.sub(V.grid.xyz).div(V.grid.w)).add(0.5).div(size);
    const cell = (p) => texture3D(atlas, uvw(p)).level(0);
    // Marsz: xyz = trafienie (układ skały), w = 1 trafione.
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
    const worldOf = (p) => V.pos.xyz.add(quatRotate(V.rot, p));
    mat.depthNode = Fn(() => {
      const w = worldOf(res.xyz);
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(w, 1.0));
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
      const P = worldOf(pl).toVar();
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
      // RDZEŃ (kanał A atlasu = udział rdzenia): lita bryła materiału rdzenia (coreLook.js) —
      // metal z połyskiem i patyną w zagłębieniach, kryształy świecące od środka, lód, smółka.
      const coreW = smoothstep(0.4, 0.6, smp.a).toVar();
      const n3 = texture3D(S.noise, pl.div(38.0).add(vec3(0.53, seed.mul(2.9), 0.11))).level(0).toVar();
      const core = coreSurface(coreLook, oreType, n2, n3, N, float(1.0).sub(ao).mul(1.6));
      albedo.assign(mix(albedo, core.albedo, coreW));
      metal.assign(mix(metal, core.metal, coreW));
      gloss.assign(mix(gloss, core.gloss, coreW));
      N.assign(normalize(mix(N, core.N, coreW)));
      const tint = mix(lookC, core.albedo, coreW).toVar();
      const specK = core.specK.mul(coreW).toVar();
      // Światło: słońce (przesłanianie pola), otoczenie (gaśnie w mroku), światła siatki.
      const sunT = mix(float(1.0), V.misc.x, S.sunOcc).toVar();
      const fillK = mix(float(0.22), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96))).toVar();
      const Vw = vec3(0.0, 0.0, 1.0);
      const ndl = dot(N, S.sunDir).toVar();
      const diff = S.sunColor.mul(sunT).mul(clamp(ndl.add(0.12).div(1.12), 0.0, 1.0)).toVar();
      const spec = S.sunColor.mul(sunT).mul(pow(max(dot(N, normalize(S.sunDir.add(Vw))), 0.0), gloss)).mul(step01(ndl)).mul(metal.mul(0.8).add(0.05).add(specK)).toVar();
      const amb = S.ambientTop.mul(N.z.mul(0.25).add(0.75)).mul(fillK).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const c = col.mul(att).toVar();
        const nl = dot(N, toL);
        diff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
        spec.addAssign(c.mul(pow(max(dot(N, normalize(toL.add(Vw))), 0.0), gloss)).mul(step01(nl)).mul(metal.mul(1.2).add(0.06).add(specK)));
      });
      const kd = float(1.0).sub(metal.mul(0.8));
      const col = albedo.mul(diff.add(amb).mul(ao)).mul(kd).add(spec.mul(mix(vec3(1.0), tint, metal)).mul(ao)).toVar();
      // Metal odbija otoczenie (jak odblask metali w materiale skał): słabe tło i blask słońca.
      const Rv = Vw.negate().add(N.mul(N.z.mul(2.0)));
      const glare = pow(max(dot(Rv, S.sunDir), 0.0), 6.0);
      col.addAssign(tint.mul(S.ambientTop.mul(0.5).mul(fillK).add(S.sunColor.mul(0.35).mul(glare).mul(sunT))).mul(metal).mul(ao));
      // Emisja rudy (kryształ, uran, energetyczna) w płaszczu, HDR tylko na najgęstszej rudzie;
      // w rdzeniu świeci materiał rdzenia (kryształy od środka, żyłki smółki).
      col.addAssign(lookC.mul(lookP.y).mul(oreCov.mul(oreCov)).mul(smoothstep(0.5, 0.95, ore).mul(1.6).add(0.25)).mul(0.35).mul(float(1.0).sub(coreW)));
      col.addAssign(core.emit.mul(coreW));
      // Żar świeżego cięcia lasera: biały środek, pomarańczowy brzeg, stygnie.
      const hd = pl.sub(V.hot.xyz);
      const hr = cs.mul(2.4);
      const heat = V.hot.w.mul(exp(dot(hd, hd).div(hr.mul(hr)).negate())).toVar();
      col.addAssign(mix(vec3(2.6, 0.7, 0.12), vec3(6.0, 4.2, 2.4), heat.mul(heat)).mul(heat));
      // Kawałek rdzenia prosto z wybuchu: żar gaśnie (V.pos.w), mocniej na krawędziach.
      const ch = V.pos.w.mul(coreW).toVar();
      const chRim = pow(float(1.0).sub(abs(N.z)), 1.5).mul(0.8).add(float(1.0).sub(ao).mul(0.5));
      col.addAssign(mix(vec3(1.4, 0.28, 0.04), vec3(3.0, 1.4, 0.45), ch.mul(ch)).mul(ch).mul(chRim));
      // Pusta geoda po ucieczce pioruna kulistego: fioletowy żar ścian, gaśnie i migocze.
      const gd = length(pl.sub(V.plasma.xyz));
      const gr = max(V.misc.w, cs);
      const glow = V.plasma.w.mul(exp(max(gd.sub(gr), 0.0).div(gr.mul(0.45)).negate())).toVar();
      col.addAssign(vec3(1.1, 0.45, 2.6).mul(glow));
      // Pył ośrodka jak nad skałą (do stropu warstwy skał).
      if (S.volume) {
        const v = S.volume.sample(vec3(P.xy, max(P.z, S.rockLayerTop)));
        col.assign(col.mul(v.a).add(v.rgb));
      }
      return vec4(max(col.mul(S.exposure), vec3(0.0)), 1.0);
    })();
    this.V = V;
    return mat;
  }

  // --- Klatka -------------------------------------------------------------------

  /**
   * @param {object} f { zoom, originX, originY, time, sunT(x, y) — transmitancja słońca (świat gry) dla odłamków }
   */
  update(f) {
    const mining = this.mining;
    const ox = f.originX, oy = f.originY;
    // Bloki: zwolnij po ciałach, których już nie ma.
    for (const [body, slot] of this.slots) {
      if (!body.alive || !mining.bodies.includes(body)) {
        this.blocks.release(slot.block);
        this.slots.delete(body);
      }
    }
    for (const e of this.ext) e.count = 0;
    this.int.count = 0;
    this.shadowCount = 0;
    this.minerals?.begin();
    let uploads = 0;
    const o = [0, 0, 0];
    for (const body of mining.bodies) {
      let slot = this.slots.get(body);
      if (!slot) {
        const block = this.blocks.alloc(Math.max(body.nx, body.ny, body.nz));
        if (!block) continue;
        slot = { block, version: -1 };
        this.slots.set(body, slot);
      }
      if (slot.version !== body.version && uploads < 4) {
        this._upload(body, slot.block, slot.version < 0);
        slot.version = body.version;
        body.dirtyBox = null;
        uploads++;
      }
      if (slot.version < 0) continue;
      body.origin(o);
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
        this.minerals?.appendRock(d, b, rPx);
        if (this.shadowCount < MAX_BODIES) {
          this.shadowData.set(d.subarray(b, b + EXT_FLOATS), this.shadowCount * EXT_FLOATS);
          this.shadowCount++;
        }
      }
      // Wnętrze.
      const I = this.int;
      if (I.count < I.capacity) {
        const d = I.data;
        const b = I.count++ * INT_FLOATS;
        // Kawałek rdzenia metalu / smółki wyrwany wybuchem (nowe ciało) żarzy się przez ~3 s
        // (lód paruje, kryształ świeci sam — bez żaru).
        const ck = body.coreMaterial ? body.coreMaterial.kind : '';
        const coreHeat = (ck === 'metal' || ck === 'mineral') && body.generation > 0 && body.coreMass > 0.5 * body.mass
          ? 0.8 * Math.max(0, 1 - body.age / 3) : 0;
        d[b] = sx; d[b + 1] = sy; d[b + 2] = sz; d[b + 3] = coreHeat;
        d[b + 4] = body.q[0]; d[b + 5] = body.q[1]; d[b + 6] = body.q[2]; d[b + 7] = body.q[3];
        d[b + 8] = body.gx; d[b + 9] = body.gy; d[b + 10] = body.gz; d[b + 11] = body.cs;
        const oreIdx = body.oreTypeId ? ROCK_TYPES.indexOf(body.oreTypeId) : body.type;
        d[b + 12] = body.nx; d[b + 13] = body.ny; d[b + 14] = body.nz; d[b + 15] = Math.max(0, oreIdx);
        d[b + 16] = slot.block.x; d[b + 17] = slot.block.y; d[b + 18] = slot.block.z; d[b + 19] = body.type;
        const heat = Math.max(0, 1 - (mining.time - body.hot[3]) / 1.4);
        d[b + 20] = body.hot[0]; d[b + 21] = body.hot[1]; d[b + 22] = body.hot[2]; d[b + 23] = heat;
        // Żar pustej geody (piorun kulisty uciekł): środek, promień, siła gasnąca z migotaniem.
        const ph = body.plasmaHot;
        const age = ph ? mining.time - ph[3] : Infinity;
        const pk = age < PLASMA_GLOW_LIFE ? (1 - age / PLASMA_GLOW_LIFE) ** 2 * (0.75 + 0.25 * Math.sin(age * 31 + body.id)) : 0;
        d[b + 24] = body.sunT; d[b + 25] = body.seed; d[b + 26] = body.generation; d[b + 27] = ph ? ph[4] : 0;
        d[b + 28] = ph ? ph[0] : 0; d[b + 29] = ph ? ph[1] : 0; d[b + 30] = ph ? ph[2] : 0; d[b + 31] = pk;
      }
    }
    for (const E of this.ext) this._commit(E, E.mesh);
    this.minerals?.commit();
    this._commit(this.int, this.intMesh);
    this.extMaterial.L.pxScale.value = f.zoom;
    this.extMaterial.L.camZ.value = 0;
    // Okruchy: odłamki skorupy i kawałki rdzenia.
    this.fragments.update(mining.pebbles, f);
    this.stats.bodies = this.int.count;
    this.stats.pebbles = this.fragments.stats.drawn;
    this.stats.corePebbles = this.fragments.stats.core;
    let free = 0;
    for (const s of [64, 32, 16]) free += this.blocks.free[s].length * (s / 16) ** 3;
    this.stats.blocksFree = free;
  }

  _commit(inst, mesh) {
    inst.geo.instanceCount = inst.count;
    mesh.visible = inst.count > 0;
    if (inst.count) {
      inst.buffer.clearUpdateRanges();
      inst.buffer.addUpdateRange(0, inst.count * (inst.data.length / inst.capacity));
      inst.buffer.needsUpdate = true;
    }
  }
}

function step01(x) {
  return select(x.greaterThan(0.0), float(1.0), float(0.0));
}

