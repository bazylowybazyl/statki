// src/3d/asteroids/spotShadows.js
//
// Cień skał w światłach statków — port dema/asteroidy-webgpu/spotShadows.js
// (zadanie 21). ATLAS map odległości (jedna tekstura 2048 × 1024 HalfFloat, kafle
// 256 px) dla reflektorów dalekich (kafel 2 × 2 na statek — średnia poza pary
// reflektorów dziobu) i dla każdego reflektora otoczenia (burty, rufa — kafel 1 × 1).
// Wartość = 100 / odległość od lampy (0 = brak zasłony).
//
// Każda mapa ma WŁASNY, mały zestaw rzucających cień: skały gry w zasięgu i stożku
// lampy wybrane na CPU, w stałym, niskim LOD (kafel 256 px nie potrzebuje 96² × 8
// trójkątów na skałę) — kilkanaście map kosztuje tyle co jedna pełna warstwa skał.
//
// Mapę czytają: oświetlenie powierzchni (GridLightsNode — skała zasłonięta przez
// bliższą nie łapie reflektora) i ośrodek światła wolumetrycznego (volumetrics.js —
// w smudze widać ciemne pasma cienia za skałami). Atlas jest `grid.shadows` SIATKI
// GRY (Core3D.fx.grid): ustawiany PRZED budową materiałów i kerneli czytających
// siatkę (lightGrid.js: `loop` dokłada test mapy tylko, gdy `shadows` istnieje).
//
// Zmiany względem dema: dwie fazy — dane (cel, tablica uniformów, `visibility`)
// powstają bez banku (siatka dostaje atlas od razu przy starcie pola), rzucający
// cień (`attachCasters`) po upieczeniu banku; zbieranie i render bez alokacji na
// klatkę (bez filter / domknięć). Pozycje LOKALNE (względem początku pola — ten sam
// układ co siatka świateł); scena atlasu nie ma przesunięcia (małe liczby).

import * as THREE from 'three/webgpu';
import { float, int, vec2, uniformArray, texture, If, abs, length, smoothstep, max } from 'three/tsl';
import { RockShadowMaterial } from './rockMaterial.js';
import { ROCK_INSTANCE_FLOATS } from './rockLayers.js';

const TILE = 256;
const ATLAS_W = 2048;
const ATLAS_H = 1024;
const MAIN_SLOTS = [[0, 0], [2, 0]];           // kafle 2 × 2 (reflektory dalekie)
export const SHADOW_MAPS = 24;
const FLOATS = ROCK_INSTANCE_FLOATS;
const CASTER_CAP = 768;
// Skały w wydobyciu (zadanie 21b): instancja 28 liczb (skała + iCarve + iGrid).
const CARVE_FLOATS = 28;
const CARVE_CAP = 48;

function smallSlots() {
  const out = [];
  for (let ty = 0; ty < ATLAS_H / TILE; ty++) {
    for (let tx = 0; tx < ATLAS_W / TILE; tx++) {
      const inMain = MAIN_SLOTS.some(([mx, my]) => tx >= mx && tx < mx + 2 && ty >= my && ty < my + 2);
      if (!inMain) out.push([tx, ty]);
    }
  }
  return out;
}

export class ShadowAtlas {
  constructor() {
    this.enabled = true;
    this.rt = new THREE.RenderTarget(ATLAS_W, ATLAS_H, {
      type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false,
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.rt.texture.name = 'AsteroidBelt:shadowAtlas';
    // Jedna tablica uniformów (limit 12 buforów uniform na etap shadera): na mapę
    // 6 × vec4 = kolumny macierzy rzutu (0–3), kafel atlasu (4), pozycja lampy + aktywna (5).
    this.U = { data: uniformArray(Array.from({ length: SHADOW_MAPS * 6 }, () => new THREE.Vector4()), 'vec4').setName('beltShadowAtlas') };
    this._rows = this.U.data.array;
    this.scene = new THREE.Scene();
    this.scene.name = 'AsteroidBelt:shadowCasters';
    this.scene.matrixWorldAutoUpdate = true;
    const slotsSmall = smallSlots();
    this.maps = [];
    for (let i = 0; i < SHADOW_MAPS; i++) {
      const main = i < MAIN_SLOTS.length;
      const [tx, ty] = main ? MAIN_SLOTS[i] : slotsSmall[i - MAIN_SLOTS.length];
      const span = main ? 2 : 1;
      const cam = new THREE.PerspectiveCamera(40, 1, 20, 12000);
      cam.up.set(0, 0, 1);
      const px = { x: tx * TILE, y: ty * TILE, w: TILE * span, h: TILE * span };
      // Kafel w uv atlasu z pół tekselem marginesu (filtrowanie nie sięga sąsiada).
      this._rows[i * 6 + 4].set((px.x + 0.5) / ATLAS_W, (px.y + 0.5) / ATLAS_H, (px.w - 1) / ATLAS_W, (px.h - 1) / ATLAS_H);
      this.maps.push({
        main, px, cam, mesh: null, material: null, data: null, buffer: null, range: null, geo: null, count: 0, active: false,
        x: 0, y: 0, z: 0, ax: 1, ay: 0, az: 0, cosHalf: 0.5, range0: 1000, carved: null
      });
    }
    this._active = [];
    this._activeCount = 0;
    this._target = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this.casters = false;
    this.stats = { maps: 0, casters: 0 };
    this._nextMain = 0;
    this._nextSmall = MAIN_SLOTS.length;
  }

  /**
   * Rzucający cień: skały gry w niskim LOD z banku, wierzchołki materiału skał gry
   * (source — obrót w czasie, próg pikseli). Wołane raz, po upieczeniu banku.
   */
  attachCasters({ bank, source, mainLod = 3, smallLod = 2 }) {
    if (this.casters) return;
    const geoms = bank.ensureGeometries();
    for (let i = 0; i < this.maps.length; i++) {
      const m = this.maps[i];
      const base = geoms[m.main ? mainLod : smallLod];
      const data = new Float32Array(CASTER_CAP * FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
      const range = { start: 0, count: data.length };
      buffer.updateRanges.length = 0;
      buffer.updateRanges.push(range);
      buffer.clearUpdateRanges = keepRanges;
      const ig = new THREE.InstancedBufferGeometry();
      ig.setIndex(base.index);
      ig.setAttribute('position', base.getAttribute('position'));
      ig.setAttribute('aMip', base.getAttribute('aMip'));
      ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch'].forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const material = new RockShadowMaterial(source);
      material.name = 'AsteroidBelt:rockShadow';
      material.lightPos.value.set(m.x, m.y, m.z);
      const mesh = new THREE.Mesh(ig, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.name = `AsteroidBelt:shadowCasters_${i}`;
      this.scene.add(mesh);
      m.mesh = mesh;
      m.material = material;
      m.data = data;
      m.buffer = buffer;
      m.range = range;
      m.geo = ig;
    }
    this._gatherCb = (rock, d, b) => this._gatherRock(d, b);
    this.casters = true;
  }

  /**
   * Cień skał w wydobyciu (atlas siatek ciał) — zadanie 21b: druga siatka na mapę
   * z materiałem cienia w trybie wycięć. Wołane raz, gdy powstaje atlas.
   */
  enableCarve(bank, source, carve) {
    if (this._carve || !this.casters) return;
    this._carve = carve;
    const geoms = bank.ensureGeometries();
    for (let i = 0; i < this.maps.length; i++) {
      const m = this.maps[i];
      const base = geoms[m.main ? 3 : 2];
      const data = new Float32Array(CARVE_CAP * CARVE_FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, CARVE_FLOATS, 1);
      const ig = new THREE.InstancedBufferGeometry();
      ig.setIndex(base.index);
      ig.setAttribute('position', base.getAttribute('position'));
      ig.setAttribute('aMip', base.getAttribute('aMip'));
      ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'iCarve', 'iGrid'].forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const material = this._carveMaterial || (this._carveMaterial = new RockShadowMaterial(source, carve));
      const mesh = new THREE.Mesh(ig, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.name = `AsteroidBelt:shadowCastersMined_${i}`;
      this.scene.add(mesh);
      m.carved = { data, buffer, geo: ig, mesh, count: 0 };
    }
  }

  /** Nowa klatka: wszystkie mapy wolne. */
  begin() {
    for (let i = 0; i < this.maps.length; i++) this.maps[i].active = false;
    this._nextMain = 0;
    this._nextSmall = MAIN_SLOTS.length;
  }

  /**
   * Mapa dla lampy (lokalnie): pozycja, oś (jednostkowa), pełny kąt stożka [°],
   * zasięg. Zwraca indeks 1..n dla świateł siatki (L3.z) albo 0 (brak miejsca).
   */
  request(main, x, y, z, ax, ay, az, coneDeg, range) {
    if (!this.enabled || !this.casters) return 0;
    let i;
    if (main && this._nextMain < MAIN_SLOTS.length) i = this._nextMain++;
    else if (this._nextSmall < SHADOW_MAPS) i = this._nextSmall++;
    else return 0;
    const m = this.maps[i];
    m.active = true;
    m.x = x; m.y = y; m.z = z;
    m.ax = ax; m.ay = ay; m.az = az;
    m.range0 = Math.max(400, range);
    const fov = Math.min(150, coneDeg + 12);
    m.cosHalf = Math.cos((fov * 0.5) * Math.PI / 180);
    const cam = m.cam;
    cam.fov = fov;
    cam.near = 20;
    cam.far = m.range0;
    cam.position.set(x, y, z);
    // Oś prawie pionowa: inny wektor „do góry” kamery.
    if (Math.abs(az) > 0.95) cam.up.set(0, 1, 0); else cam.up.set(0, 0, 1);
    this._target.set(x + ax, y + ay, z + az);
    cam.lookAt(this._target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this._mat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const e = this._mat.elements;
    const R = this._rows;
    R[i * 6].set(e[0], e[1], e[2], e[3]);
    R[i * 6 + 1].set(e[4], e[5], e[6], e[7]);
    R[i * 6 + 2].set(e[8], e[9], e[10], e[11]);
    R[i * 6 + 3].set(e[12], e[13], e[14], e[15]);
    R[i * 6 + 5].set(x, y, z, 1);
    if (m.material) m.material.lightPos.value.set(x, y, z);
    return i + 1;
  }

  _gatherRock(d, b) {
    const act = this._active;
    const n = this._activeCount;
    const rx = d[b];
    const ry = d[b + 1];
    const rz = d[b + 2];
    const s = Math.max(d[b + 16], d[b + 17], d[b + 18]);
    const rr = d[b + 3] * 1.5 * s;
    for (let k = 0; k < n; k++) {
      const m = act[k];
      if (m.count >= CASTER_CAP) continue;
      const dx = rx - m.x;
      const dy = ry - m.y;
      const dz = rz - m.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist - rr > m.range0) continue;
      if (dist > rr) {
        // Stożek kamery z marginesem kąta skały.
        const c = (dx * m.ax + dy * m.ay + dz * m.az) / dist;
        const sn = Math.min(1, rr / dist);
        const cosMargin = m.cosHalf * Math.sqrt(1 - sn * sn) - Math.sqrt(1 - m.cosHalf * m.cosHalf) * sn;
        if (c < cosMargin) continue;
      }
      const o = m.count++ * FLOATS;
      const out = m.data;
      for (let q = 0; q < FLOATS; q++) out[o + q] = d[b + q];
    }
  }

  /** Rzucający cień: skały gry w zasięgu i stożku każdej aktywnej mapy. */
  gather(layer) {
    this.stats.maps = 0;
    this.stats.casters = 0;
    const maps = this.maps;
    for (let i = 0; i < maps.length; i++) maps[i].count = 0;
    if (!this.casters || !layer || !layer.enabled) {
      for (let i = 0; i < maps.length; i++) this._rows[i * 6 + 5].w = 0;
      return;
    }
    const act = this._active;
    let n = 0;
    for (let i = 0; i < maps.length; i++) {
      if (maps[i].active) act[n++] = maps[i];
    }
    this._activeCount = n;
    if (n) layer.forEachLoaded(this._gatherCb);
    let casters = 0;
    let active = 0;
    for (let i = 0; i < maps.length; i++) {
      const m = maps[i];
      this._rows[i * 6 + 5].w = m.active ? 1 : 0;
      m.geo.instanceCount = m.count;
      if (m.active) active++;
      if (m.count) {
        m.range.count = m.count * FLOATS;
        m.buffer.needsUpdate = true;
        casters += m.count;
      }
    }
    this.stats.maps = active;
    this.stats.casters = casters;
  }

  /**
   * Rzucający cień spośród skał w wydobyciu (zadanie 21b): src = instancje (po 28
   * liczb: skała + iCarve + iGrid), count sztuk. Po gather() warstwy pola, przed render().
   */
  gatherCarved(src, count) {
    if (!this._carve) return;
    for (const m of this.maps) {
      if (!m.carved) continue;
      m.carved.count = 0;
      if (!m.active) continue;
      for (let i = 0; i < count; i++) {
        const b = i * CARVE_FLOATS;
        const rr = src[b + 3] * 1.5 * Math.max(src[b + 16], src[b + 17], src[b + 18]);
        const dx = src[b] - m.x, dy = src[b + 1] - m.y, dz = src[b + 2] - m.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist - rr > m.range0) continue;
        if (dist > rr) {
          const c = (dx * m.ax + dy * m.ay + dz * m.az) / dist;
          const sn = Math.min(1, rr / dist);
          const cosMargin = m.cosHalf * Math.sqrt(1 - sn * sn) - Math.sqrt(1 - m.cosHalf * m.cosHalf) * sn;
          if (c < cosMargin) continue;
        }
        if (m.carved.count >= CARVE_CAP) break;
        const o = m.carved.count++ * CARVE_FLOATS;
        for (let k = 0; k < CARVE_FLOATS; k++) m.carved.data[o + k] = src[b + k];
      }
      const C = m.carved;
      C.geo.instanceCount = C.count;
      if (C.count) {
        C.buffer.clearUpdateRanges();
        C.buffer.addUpdateRange(0, C.count * CARVE_FLOATS);
        C.buffer.needsUpdate = true;
        this.stats.casters += C.count;
      }
    }
  }

  /** Render aktywnych map do kafli atlasu (cel i autoClear odtwarzane). */
  render(renderer) {
    if (!this.enabled || !this.casters) return 0;
    const maps = this.maps;
    let any = false;
    for (let i = 0; i < maps.length; i++) {
      if (maps[i].active && (maps[i].count || (maps[i].carved && maps[i].carved.count))) { any = true; break; }
    }
    if (!any) return 0;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const rt = this.rt;
    let drawn = 0;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      rt.viewport.set(0, 0, ATLAS_W, ATLAS_H);
      renderer.clear(true, true, false);
      for (let i = 0; i < maps.length; i++) {
        const m = maps[i];
        const carved = m.carved ? m.carved.count : 0;
        if (!m.active || (!m.count && !carved)) continue;
        for (let k = 0; k < maps.length; k++) {
          const o = maps[k];
          o.mesh.visible = o === m && m.count > 0;
          if (o.carved) o.carved.mesh.visible = o === m && carved > 0;
        }
        // Jeden materiał cienia skał w wydobyciu na wszystkie mapy: pozycja lampy tej mapy.
        if (carved) this._carveMaterial.lightPos.value.set(m.x, m.y, m.z);
        rt.viewport.set(m.px.x, m.px.y, m.px.w, m.px.h);
        renderer.render(this.scene, m.cam);
        drawn++;
      }
    } finally {
      for (let k = 0; k < maps.length; k++) {
        maps[k].mesh.visible = false;
        if (maps[k].carved) maps[k].carved.mesh.visible = false;
      }
      rt.viewport.set(0, 0, ATLAS_W, ATLAS_H);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
    }
    return drawn;
  }

  /** Wszystkie mapy nieaktywne (pole poza kadrem). */
  clear() {
    this.begin();
    for (let i = 0; i < this.maps.length; i++) {
      this.maps[i].count = 0;
      this._rows[i * 6 + 5].w = 0;
    }
    this.stats.maps = 0;
    this.stats.casters = 0;
  }

  /**
   * TSL: widoczność punktu P (lokalnie) dla światła z mapą s (1..n; 0 = bez
   * cienia). Miękki brzeg z filtrowania mapy 1/odległość, 4 próbki (PCF).
   */
  visibility(s, P) {
    const D = this.U.data;
    const vis = float(1.0).toVar();
    If(s.greaterThan(0.5), () => {
      const i = int(s.sub(0.5)).mul(6).toVar();
      const lp = D.element(i.add(5)).toVar();
      If(lp.w.greaterThan(0.5), () => {
        const clip = D.element(i).mul(P.x).add(D.element(i.add(1)).mul(P.y)).add(D.element(i.add(2)).mul(P.z)).add(D.element(i.add(3))).toVar();
        If(clip.w.greaterThan(1.0), () => {
          const ndc = clip.xy.div(clip.w).toVar();
          If(abs(ndc.x).lessThan(0.995).and(abs(ndc.y).lessThan(0.995)), () => {
            const t = D.element(i.add(4)).toVar();
            const uv = t.xy.add(vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).mul(t.zw)).toVar();
            const invP = float(100.0).div(max(length(P.sub(lp.xyz)), 1.0)).toVar();
            const ox = 0.75 / ATLAS_W;
            const oy = 0.75 / ATLAS_H;
            const tap = (du, dv) => {
              const occ = texture(this.rt.texture, uv.add(vec2(ox * du, oy * dv))).level(0).r;
              return float(1.0).sub(smoothstep(invP.mul(1.012), invP.mul(1.05), occ));
            };
            vis.assign(tap(-1, -1).add(tap(1, -1)).add(tap(-1, 1)).add(tap(1, 1)).mul(0.25));
          });
        });
      });
    });
    return vis;
  }
}

function keepRanges() {}
