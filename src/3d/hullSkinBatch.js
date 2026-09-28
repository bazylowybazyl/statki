// src/3d/hullSkinBatch.js
//
// Partie skór kadłubów belkowych (port WebGPU, zadanie 23 — duża bitwa).
//
// three r183 liczy każdy rysunek obiektu z materiałem węzłowym od nowa: po przeniesieniu danych per kadłub
// do bufora storage (HullObjectStore, hexShips3D.tsl.js) rysunek skóry kosztował dalej ~19 µs CPU — głównie
// przegląd 23 wiązań grupy „object” (tekstury, samplery, bufory storage) i atrybutów geometrii. Bitwa
// 148 okrętów: ~145 rysunków skór = ~2,8 ms na klatkę. Tu kadłuby z TYM SAMYM zestawem tekstur (sprite,
// mapa normalnych, mapa kształtu lakieru — typ okrętu, wraki z tym samym obrazem) rysują się JEDNYM
// wywołaniem: wspólne bufory wierzchołków (pozycja, jasność + żar, uv + slot) i indeksów, dane per kadłub
// (macierz model-widok, macierz świata, wartości materiału, widoczność) z bufora slotu — numer slotu
// w atrybucie wierzchołka zamiast uniformu obiektu.
//
// Kolejność: w partii kadłuby leżą w kolejności dodania (bez wypełniania dziur — przy dużej fragmentacji
// partia przepisuje się w tej samej kolejności), więc rysują się w tej samej kolejności co dawne siatki
// (three sortuje przezroczyste o tym samym renderOrder i głębi po id — kolejność tworzenia). Między
// partiami kolejność idzie po partiach — kadłuby RÓŻNYCH typów nakładające się na ekranie mogą zamienić
// się miejscami (fizyka belek nie pozwala kadłubom się przenikać; w harnessie bez różnic — raport zadania).
//
// Zapis skóry (writeHullSkin / writeHullSkinQuads) zostaje w tablicach per kadłub (jak dotąd); partia
// kopiuje zmienione czworokąty do swoich buforów i zbiera zakresy do wysyłki (kilka zakresów na klatkę —
// zbierzZakresy, bez wysyłania dziur między kadłubami).

import * as THREE from 'three/webgpu';
import { zbierzZakresy, zbierzZakresyCaly } from './zakresyWysylki.js';

const V_INIT = 16384;          // wierzchołków na start (4 na węzeł kadłuba)
const I_INIT = 24576;          // indeksów na start (6 na węzeł)

export class HullSkinBatch {
  /**
   * @param {string} key klucz zestawu tekstur
   * @param {THREE.Material} material materiał partii (wariant kadłuba z numerem slotu w atrybucie)
   */
  constructor(key, material) {
    this.key = key;
    this.material = material;
    this.entries = [];       // żywe wpisy w kolejności dodania (= kolejność rysowania)
    this.vUsed = 0;          // wierzchołki do końca ostatniego wpisu (z dziurami)
    this.iUsed = 0;
    this.vDead = 0;          // wierzchołki w dziurach (po usuniętych kadłubach)
    this.stats = { adds: 0, removes: 0, compactions: 0, grows: 0 };
    this._alloc(V_INIT, I_INIT);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = `hullSkinBatch:${key}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  _alloc(vcap, icap, copyFrom = null) {
    const pos = new Float32Array(vcap * 3);
    const sh = new Float32Array(vcap * 3);
    const uvs = new Float32Array(vcap * 3);
    const idx = new Uint32Array(icap);
    if (copyFrom) {
      pos.set(copyFrom.pos.subarray(0, Math.min(copyFrom.pos.length, pos.length)));
      sh.set(copyFrom.sh.subarray(0, Math.min(copyFrom.sh.length, sh.length)));
      uvs.set(copyFrom.uvs.subarray(0, Math.min(copyFrom.uvs.length, uvs.length)));
      idx.set(copyFrom.idx.subarray(0, Math.min(copyFrom.idx.length, idx.length)));
    }
    this.vcap = vcap;
    this.icap = icap;
    this.pos = pos;
    this.sh = sh;
    this.uvs = uvs;
    this.idx = idx;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3);
    this.aSh = new THREE.BufferAttribute(sh, 3);
    this.aUv = new THREE.BufferAttribute(uvs, 3);
    this.aIdx = new THREE.BufferAttribute(idx, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aShadeHeat', this.aSh);
    g.setAttribute('aUvSlot', this.aUv);
    g.setIndex(this.aIdx);
    g.setDrawRange(0, this.iUsed);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const old = this.geometry;
    this.geometry = g;
    if (this.mesh) {
      this.mesh.geometry = g;
      old?.dispose();
    }
  }

  get empty() { return this.entries.length === 0; }

  /** Czy któryś kadłub partii jest widoczny (siatka nośnika) — inaczej partia poza listą rysowania. */
  anyVisible() {
    const E = this.entries;
    for (let i = 0; i < E.length; i++) if (!E[i].proxy || E[i].proxy.visible) return true;
    return false;
  }

  /**
   * Nowy kadłub na końcu partii: slot (HullObjectStore), topologia skóry (uv, indeksy) i jej tablice
   * (pozycje, jasność, żar). Zwraca wpis (zapis zmian: writeQuads / writeAll, usunięcie: remove).
   */
  add(slot, topo, positions, shade, heat, proxy = null) {
    const nQuads = topo.count;
    const vCount = nQuads * 4;
    const iCount = topo.indices.length;
    if (this.vUsed + vCount > this.vcap || this.iUsed + iCount > this.icap) this._grow(vCount, iCount);
    // proxy: siatka kadłuba (nośnik transformacji, widoczność) — partia rysuje się, gdy widać choć jeden kadłub
    const e = { batch: this, slot, vStart: this.vUsed, vCount, iStart: this.iUsed, iCount, quads: nQuads, alive: true, proxy };
    this.vUsed += vCount;
    this.iUsed += iCount;
    this.entries.push(e);
    this._writeStatic(e, topo);
    this.writeAll(e, positions, shade, heat);
    this.geometry.setDrawRange(0, this.iUsed);
    this.stats.adds++;
    return e;
  }

  // uv + slot i indeksy (przesunięte o początek wpisu) — raz przy dodaniu i po przepisaniu partii.
  _writeStatic(e, topo) {
    const uv = topo.uvs;
    const U = this.uvs;
    const s = e.slot;
    for (let v = 0; v < e.vCount; v++) {
      const o = (e.vStart + v) * 3;
      U[o] = uv[v * 2];
      U[o + 1] = uv[v * 2 + 1];
      U[o + 2] = s;
    }
    zbierzZakresy(this.aUv, e.vStart * 3, e.vCount * 3);
    const src = topo.indices;
    const I = this.idx;
    const base = e.vStart;
    for (let k = 0; k < e.iCount; k++) I[e.iStart + k] = src[k] + base;
    zbierzZakresy(this.aIdx, e.iStart, e.iCount);
    e.topo = topo;
  }

  /** Wszystkie czworokąty kadłuba (pełny zapis skóry). */
  writeAll(e, positions, shade, heat) {
    this.writeQuads(e, positions, shade, heat, 0, e.quads - 1);
  }

  /** Czworokąty [qMin, qMax] (włącznie) z tablic kadłuba do buforów partii + zakresy do wysyłki. */
  writeQuads(e, positions, shade, heat, qMin, qMax) {
    if (!e.alive || qMax < qMin) return;
    const P = this.pos;
    const S = this.sh;
    const v0 = qMin * 4;
    const v1 = qMax * 4 + 4;
    const base = e.vStart;
    for (let v = v0; v < v1; v++) {
      const o = (base + v) * 3;
      const p = v * 3;
      P[o] = positions[p];
      P[o + 1] = positions[p + 1];
      P[o + 2] = positions[p + 2];
      S[o] = shade[v];
      S[o + 1] = heat[v * 2];
      S[o + 2] = heat[v * 2 + 1];
    }
    zbierzZakresy(this.aPos, (base + v0) * 3, (v1 - v0) * 3);
    zbierzZakresy(this.aSh, (base + v0) * 3, (v1 - v0) * 3);
  }

  /** Kadłub znika z partii: indeksy zerowane (trójkąty zdegenerowane), miejsce do przepisania partii. */
  remove(e) {
    if (!e || !e.alive) return;
    e.alive = false;
    const i = this.entries.indexOf(e);
    if (i >= 0) this.entries.splice(i, 1);
    this.idx.fill(0, e.iStart, e.iStart + e.iCount);
    zbierzZakresy(this.aIdx, e.iStart, e.iCount);
    this.stats.removes++;
    // koniec partii = koniec ostatniego żywego wpisu (usunięty z końca cofa go od razu)
    const last = this.entries[this.entries.length - 1];
    this.vUsed = last ? last.vStart + last.vCount : 0;
    this.iUsed = last ? last.iStart + last.iCount : 0;
    let live = 0;
    for (const x of this.entries) live += x.vCount;
    this.vDead = this.vUsed - live;
    this.geometry.setDrawRange(0, this.iUsed);
    if (this.vDead > 4096 && this.vDead > this.vUsed * 0.5) this._compact();
  }

  _grow(vNeed, iNeed) {
    // najpierw dziury (przepisanie w tej samej kolejności), potem większe bufory
    if (this.vDead > 0) this._compact();
    if (this.vUsed + vNeed <= this.vcap && this.iUsed + iNeed <= this.icap) return;
    let vcap = this.vcap;
    let icap = this.icap;
    while (this.vUsed + vNeed > vcap) vcap *= 2;
    while (this.iUsed + iNeed > icap) icap *= 2;
    this._alloc(vcap, icap, { pos: this.pos, sh: this.sh, uvs: this.uvs, idx: this.idx });
    this.stats.grows++;
  }

  // Przepisanie żywych wpisów od początku, w tej samej kolejności (kolejność rysowania bez zmian).
  _compact() {
    const P = this.pos;
    const S = this.sh;
    const U = this.uvs;
    const I = this.idx;
    let v = 0;
    let i = 0;
    for (const e of this.entries) {
      if (e.vStart !== v) {
        P.copyWithin(v * 3, e.vStart * 3, (e.vStart + e.vCount) * 3);
        S.copyWithin(v * 3, e.vStart * 3, (e.vStart + e.vCount) * 3);
        U.copyWithin(v * 3, e.vStart * 3, (e.vStart + e.vCount) * 3);
      }
      const shift = v - e.vStart;
      if (e.iStart !== i || shift !== 0) {
        for (let k = 0; k < e.iCount; k++) I[i + k] = I[e.iStart + k] + shift;
      }
      e.vStart = v;
      e.iStart = i;
      v += e.vCount;
      i += e.iCount;
    }
    I.fill(0, i, this.iUsed);
    this.vUsed = v;
    this.iUsed = i;
    this.vDead = 0;
    zbierzZakresyCaly(this.aPos);
    zbierzZakresyCaly(this.aSh);
    zbierzZakresyCaly(this.aUv);
    zbierzZakresyCaly(this.aIdx);
    this.geometry.setDrawRange(0, this.iUsed);
    this.stats.compactions++;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
