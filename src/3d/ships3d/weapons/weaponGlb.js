// src/3d/ships3d/weapons/weaponGlb.js
//
// MODELE BRONI Z BLENDERA (GLB) dla wież 3D (opcja „Bronie 3D”, kamery 3D, demo dema/atlas3d-webgpu.html).
// Pilot 2026-10-13 (docs/PILOT-blender-bronie.md), w grze od tego samego dnia: AKTYWNA rodzina weapons3D.js
// dostaje części (ring / housing / barrel / spin) z pliku GLB zamiast z budowniczego — UKŁAD (czop, kopie luf,
// barrelShift, muzzleX, pochylenie) zostaje w FAMILIES weapons3D.js.
//
// REJESTR OGÓLNY: rodzina → plik assets/weapons3d/<plik>.glb (LOD1: <plik>_lod1.glb), plik = nazwa rodziny
// albo wpis w WEAPON_GLB_FILE (yamato2 → yamato). Rodziny AKTYWNE w grze i ich tryb: WEAPON_GLB_GAME — od 2026-10-13
// (decyzja użytkownika) Yamato, Yamato L, Tempest 1 / 2 i Lanca, od 2026-10-20 Promień Śmierci w trybie AUTO: wczytane OBA pliki, LOD wieży wg
// jej rozmiaru na ekranie (weaponGlbLodFor — promień sylwetki Turret2D × skala × zoom, w kamerach 3D z perspektywy;
// z bliska LOD0, przy oddalaniu LOD1, histereza), dwie partie rodziny (shipModels3DGame.syncTurrets). Przełącznik
// bez zmian w kodzie (A/B, harness, demo):
//   ?bronieGlb=yamato,yamato2,tempest2@1,lance@auto   — lista rodzin z GLB (bez @ — LOD0, @1 — LOD1, @auto — LOD
//   wg rozmiaru na ekranie); ?bronieGlb= albo ?bronieGlb=0 — żadna
//   window.__WEAPON_GLB = ['yamato', 'tempest1@1'] | [] | false   — to samo przed wczytaniem strony (bierze górę)
//
// Plik (scripts/blender/<rodzina>.py, eksport glTF +Y w górę): węzły-rodzice `ring`, `housing`, `barrel`
// (opcjonalnie `spin`) w jednostkach lokalnych wieży; nazwy materiałów = wpisy palety SHIP3D_MAT (→ mat / aMat);
// COLOR_0.r = AO wypieczone w Blenderze (→ ao / aAO). Loader:
//   • glTF +Y → układ wieży (Z w górę, jak Blender): (x, y, z) = (x_gltf, −z_gltf, y_gltf), normalne tak samo;
//   • uv = rzut pudełkowy jak MeshBuilder3D._v (uvScale 1) — szwy paneli materiału broni jak w budowniczym;
//   • wynik w formacie MeshBuilder3D.build() + ao: { position, normal, uv, mat, ao, index, vertexCount,
//     triangleCount }, opakowany w część z build() / toGeometry() / vcount() jak MeshBuilder3D.
//
// Rejestr wypełnia się ASYNCHRONICZNIE (loadWeaponGlbs — przy imporcie shipModels3DGame.js, gra czeka na niego
// przed rozgrzewką ekranu ładowania: prepareShipModels3D). buildWeapon3D pyta go synchronicznie
// (weaponGlbParts): rodzina, o którą zapytano, zanim jej plik doszedł, zostaje przy budowniczym do końca sesji
// (spóźniony plik nie podmienia geometrii partii w trakcie gry). Brak pliku / błąd → budowniczy + ostrzeżenie.
//
// Budżet: LOD1 rodzin MASOWYCH (Tempest — setki wież w bitwie) ≈ model z budowniczego (+10–17%); LOD0 rysują tylko
// wieże duże na ekranie (zbliżenie, kamery 3D z bliska) — bitwa z oddali idzie cała na LOD1.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RenderWorld } from '../../../render/renderWorld.js';
import { Vector3, Matrix3 } from 'three';
import { SHIP3D_MAT } from '../meshBuilder3D.js';

/** Rodzina → nazwa pliku w assets/weapons3d/ (domyślnie nazwa rodziny). */
export const WEAPON_GLB_FILE = Object.freeze({
  // Yamato L = ta sama wieża i lufa, dwie skrajne kopie lufy z FAMILIES (środkowy otwór obudowy pusty — jak
  // w modelu z budowniczego).
  yamato2: 'yamato'
});

/** Tryb rodziny: oba pliki (LOD0 i LOD1), LOD wieży wg jej rozmiaru na ekranie (weaponGlbLodFor). */
export const WEAPON_GLB_AUTO = -1;

/**
 * Progi LOD w trybie AUTO: promień sylwetki wieży na ekranie [px] — Turret2D spec.r × skala wieży × zoom (px na
 * jednostkę świata; w kamerach 3D z rzutu perspektywy w miejscu wieży) — ta sama miara, którą gra chowa wieże
 * mniejsze niż TURRET3D_HIDE_PX. LOD0 od WEAPON_GLB_LOD0_PX, powrót do LOD1 poniżej WEAPON_GLB_LOD1_PX (histereza —
 * wieża przy progu nie miga). Z A/B 2026-10-13: Yamato (r 58, skala 1,75) — LOD0 od zoomu ~1,6 z góry; Tempest
 * (r 40, skala 0,52–1,02) — przy każdym zoomie gry LOD1 (≤ 130 px przy maks. 3,2, także w kamerach 3D; A/B: LOD0 ≈
 * LOD1), LOD0 dopiero, gdy wieża urośnie na ekranie ponad próg.
 */
export const WEAPON_GLB_LOD0_PX = 160;
export const WEAPON_GLB_LOD1_PX = 128;

/**
 * Rodziny z modelem z Blendera W GRZE (bez przełącznika) → tryb (WEAPON_GLB_AUTO albo stały LOD 0 / 1).
 * Nowa rodzina — po akceptacji A/B użytkownika (2026-10-13: Tempest 1 / 2 i Lanca — „włącz na stałe, LOD
 * z oddalaniem kamery”).
 */
export const WEAPON_GLB_GAME = Object.freeze({
  yamato: WEAPON_GLB_AUTO,
  yamato2: WEAPON_GLB_AUTO,
  tempest1: WEAPON_GLB_AUTO,
  tempest2: WEAPON_GLB_AUTO,
  lance: WEAPON_GLB_AUTO,
  // Promień Śmierci „Gungnir” (2026-10-20, scripts/blender/deathRay.py; wygląd zaakceptowany przez użytkownika): jedna wieża na supercapitalu Terra Nova
  // (Capital, r 64) — LOD0 z góry od zoomu ~1,43, LOD1 (3,4 tys. trójkątów) poniżej ~1,14.
  deathRay: WEAPON_GLB_AUTO
});

/** LOD wieży w trybie AUTO z promienia sylwetki na ekranie [px] i poprzedniego LOD (histereza; prev < 0 — pierwszy raz). */
export function weaponGlbLodFor(prev, px) {
  if (prev === 0) return px < WEAPON_GLB_LOD1_PX ? 1 : 0;
  if (prev === 1) return px >= WEAPON_GLB_LOD0_PX ? 0 : 1;
  return px >= (WEAPON_GLB_LOD0_PX + WEAPON_GLB_LOD1_PX) / 2 ? 0 : 1;
}

/** Plik rodziny (bez rozszerzenia). */
export function weaponGlbFile(family) { return WEAPON_GLB_FILE[family] || family; }

/** Adres pliku GLB rodziny (assets/weapons3d/, NIE public/ — tests/devPublicShadow.test.mjs). */
export function weaponGlbUrl(family, lod = 0) {
  const name = `${weaponGlbFile(family)}${lod > 0 ? `_lod${lod | 0}` : ''}`;
  return new URL(`../../../../assets/weapons3d/${name}.glb`, import.meta.url).href;
}

/** Lista „rodzina[@lod]” → Map rodzina → LOD (0, 1) albo WEAPON_GLB_AUTO („@auto”); puste wpisy pomijane. */
export function parseWeaponGlbList(list) {
  const out = new Map();
  for (const raw of Array.isArray(list) ? list : String(list ?? '').split(',')) {
    const t = String(raw).trim();
    if (!t || t === '0' || t === 'false') continue;
    const [fam, lod] = t.split('@');
    out.set(fam, /^a(uto)?$/i.test(lod || '') ? WEAPON_GLB_AUTO : Math.max(0, Number(lod) | 0));
  }
  return out;
}

/** Pliki (LOD) rodziny w danym trybie: AUTO — oba, stały — jeden. */
function lodsOf(mode) { return mode === WEAPON_GLB_AUTO ? [0, 1] : [mode | 0]; }

/** Budżet trójkątów rodziny (pierścień + obudowa + lufy × kopie; strażnik tests/weaponGlb.test.mjs). */
export const WEAPON_GLB_TRI_BUDGET = Object.freeze({ lod0: 40000, lod1: 6000 });

export const WEAPON_GLB_PARTS = Object.freeze(['ring', 'housing', 'barrel', 'spin']);

const _vp = new Vector3();
const _vn = new Vector3();
const _nm = new Matrix3();

function partOf(obj) {
  for (let o = obj; o; o = o.parent) {
    const n = String(o.name || '').split('.')[0];
    if (WEAPON_GLB_PARTS.includes(n)) return n;
  }
  return null;
}

function matKey(material) {
  return String(material?.name || '').split('.')[0].toUpperCase();
}

/**
 * Scena glTF (three, po parse) → części w formacie MeshBuilder3D.build() + ao.
 * Zwraca { ring, housing, barrel, spin|null, unknownMaterials: [] }.
 */
export function weaponPartsFromGltfScene(scene, label = 'GLB') {
  scene.updateMatrixWorld(true);
  const acc = {};
  const unknown = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const part = partOf(o);
    if (!part) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = g.attributes.color || null;
    const key = matKey(o.material);
    let id = SHIP3D_MAT[key];
    if (id == null) { unknown.add(o.material?.name || '(bez nazwy)'); id = SHIP3D_MAT.PANEL; }
    const a = acc[part] || (acc[part] = { pos: [], nrm: [], uv: [], mat: [], ao: [], idx: [] });
    const base = a.pos.length / 3;
    _nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      // glTF +Y w górę → układ wieży (Z w górę): (x, y, z) = (x, −z, y).
      _vp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const px = _vp.x, py = -_vp.z, pz = _vp.y;
      _vn.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      const nx = _vn.x, ny = -_vn.z, nz = _vn.y;
      a.pos.push(px, py, pz);
      a.nrm.push(nx, ny, nz);
      // rzut pudełkowy jak MeshBuilder3D._v (uvScale 1)
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (az >= ax && az >= ay) a.uv.push(px, py);
      else if (ax >= ay) a.uv.push(py, pz);
      else a.uv.push(px, pz);
      a.mat.push(id);
      a.ao.push(col ? Math.min(1, Math.max(0, col.getX(i))) : 1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) a.idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < pos.count; i++) a.idx.push(base + i);
  });
  const out = { unknownMaterials: [...unknown] };
  for (const part of WEAPON_GLB_PARTS) {
    const a = acc[part];
    if (!a) { out[part] = null; continue; }
    const vc = a.pos.length / 3;
    out[part] = Object.freeze({
      position: Float32Array.from(a.pos),
      normal: Float32Array.from(a.nrm),
      uv: Float32Array.from(a.uv),
      mat: Float32Array.from(a.mat),
      ao: Float32Array.from(a.ao),
      index: vc > 65535 ? Uint32Array.from(a.idx) : Uint16Array.from(a.idx),
      vertexCount: vc,
      triangleCount: a.idx.length / 3
    });
  }
  if (!out.ring || !out.housing || !out.barrel) throw new Error(`${label}: brak części ring / housing / barrel`);
  if (out.unknownMaterials.length) console.warn(`[bronie GLB] ${label}: nieznane materiały ${out.unknownMaterials.join(', ')} — PANEL`);
  return out;
}

/** ArrayBuffer GLB → części (weaponPartsFromGltfScene). Działa też w Node (bez tekstur w pliku). */
export function parseWeaponGlb(arrayBuffer, label = 'GLB') {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
      try { resolve(weaponPartsFromGltfScene(gltf.scene, label)); } catch (e) { reject(e); }
    }, reject);
  });
}

/**
 * Część modelu broni z GLB z interfejsem MeshBuilder3D (build / toGeometry / vcount). build() oddaje KOPIE
 * tablic (jak MeshBuilder3D — wołający może je zmieniać, np. toGeometry ze skalą).
 */
export class WeaponGlbPart {
  constructor(data, uvScale = 1) {
    this.data = data;
    this.uvScale = uvScale;
    this.source = 'glb';
  }

  vcount() { return this.data.vertexCount; }

  build() {
    const d = this.data;
    const uv = Float32Array.from(d.uv);
    if (this.uvScale !== 1) for (let i = 0; i < uv.length; i++) uv[i] *= this.uvScale;
    return {
      position: Float32Array.from(d.position),
      normal: Float32Array.from(d.normal),
      uv,
      mat: Float32Array.from(d.mat),
      ao: Float32Array.from(d.ao),
      index: d.index.slice(),
      vertexCount: d.vertexCount,
      triangleCount: d.triangleCount
    };
  }

  /** BufferGeometry (three) z atrybutami position, normal, uv, aMat, aAO. */
  toGeometry(THREE, scale = 1) {
    const d = this.build();
    if (scale !== 1) for (let i = 0; i < d.position.length; i++) d.position[i] *= scale;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setAttribute('aMat', new THREE.BufferAttribute(d.mat, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(d.ao, 1));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Rejestr (plik + LOD → części); rodziny pytają przez weaponGlbParts
// ---------------------------------------------------------------------------
const _files = new Map();      // 'yamato@0' → części
const _decided = new Map();    // 'rodzina@lod' → części | null (decyzja przy pierwszym zapytaniu — do końca sesji)
let _override = null;          // setWeaponGlbFamilies (testy) — Map rodzina → LOD
let _loading = null;

/**
 * Rodziny z GLB w tej sesji: Map rodzina → LOD albo WEAPON_GLB_AUTO. Kolejność: setWeaponGlbFamilies (testy) → window.__WEAPON_GLB
 * (lista / false) → ?bronieGlb= → WEAPON_GLB_GAME.
 */
export function weaponGlbFamilies() {
  if (_override) return _override;
  const glb = RenderWorld.config.weaponGlb;
  if (glb === false) return new Map();
  if (Array.isArray(glb) || typeof glb === 'string') return parseWeaponGlbList(glb);
  try {
    const search = RenderWorld.pageSearch;
    const q = search ? new URLSearchParams(search) : null;
    if (q && q.has('bronieGlb')) return parseWeaponGlbList(q.get('bronieGlb'));
  } catch (e) { /* bez location */ }
  return new Map(Object.entries(WEAPON_GLB_GAME));
}

/** Rodziny z GLB dla rodzin, o które jeszcze nie pytano (testy; null — z adresu / WEAPON_GLB_GAME). */
export function setWeaponGlbFamilies(list) { _override = list == null ? null : parseWeaponGlbList(list); }

/** Rejestruje części pliku (testy w Node, loader). */
export function registerWeaponGlb(file, lod, parts) {
  for (const [fam, mode] of weaponGlbFamilies()) {
    if (weaponGlbFile(fam) === file && lodsOf(mode).includes(lod | 0) && _decided.get(`${fam}@${lod | 0}`) === null) {
      console.warn(`[bronie GLB] ${file} (LOD ${lod | 0}) doszedł po pierwszym użyciu rodziny ${fam} — zostaje budowniczy`);
    }
  }
  _files.set(`${file}@${lod | 0}`, parts);
}

/**
 * Części GLB rodziny ({ ring, housing, barrel, spin }) albo null (budowniczy). lod — poziom partii (0 / 1): w trybie
 * AUTO części tego poziomu (brak pliku — drugi poziom), w trybie stałym — zawsze części trybu.
 */
export function weaponGlbParts(family, lod = 0) {
  const want = lod > 0 ? 1 : 0;
  const key = `${family}@${want}`;
  if (_decided.has(key)) return _decided.get(key);
  const mode = weaponGlbFamilies().get(family);
  let parts = null;
  if (mode != null) {
    const file = weaponGlbFile(family);
    parts = mode === WEAPON_GLB_AUTO
      ? (_files.get(`${file}@${want}`) || _files.get(`${file}@${1 - want}`) || null)
      : (_files.get(`${file}@${mode | 0}`) || null);
  }
  _decided.set(key, parts);
  return parts;
}

/** Rodzina z LOD wg rozmiaru na ekranie: tryb AUTO i oba pliki wczytane (inaczej jedna partia, jak dawniej). */
export function weaponGlbAutoLod(family) {
  if (weaponGlbFamilies().get(family) !== WEAPON_GLB_AUTO) return false;
  const file = weaponGlbFile(family);
  return _files.has(`${file}@0`) && _files.has(`${file}@1`);
}

/** Zapomina decyzje rodzin (testy, A/B w jednej stronie — przed pierwszym użyciem partii). */
export function resetWeaponGlbQueries() { _decided.clear(); }

async function fetchArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/**
 * Wczytuje pliki rodzin z GLB tej sesji (weaponGlbFamilies — raz; kolejne wywołania — ta sama obietnica) albo
 * podanych w `families` (lista „rodzina[@lod]”, demo). Nigdy nie odrzuca:
 * błąd pliku = ostrzeżenie, rodzina zostaje przy budowniczym.
 */
export function loadWeaponGlbs({ fetchFn = fetchArrayBuffer, families = null } = {}) {
  if (_loading && !families) return _loading;
  const want = new Map(); // 'plik@lod' → { file, lod, family }
  for (const [fam, mode] of families ? parseWeaponGlbList(families) : weaponGlbFamilies()) {
    const file = weaponGlbFile(fam);
    for (const lod of lodsOf(mode)) if (!want.has(`${file}@${lod}`)) want.set(`${file}@${lod}`, { file, lod, family: fam });
  }
  const p = Promise.all([...want.values()].map(async (e) => {
    try {
      const parts = await parseWeaponGlb(await fetchFn(weaponGlbUrl(e.family, e.lod)), `${e.file}${e.lod ? `_lod${e.lod}` : ''}.glb`);
      registerWeaponGlb(e.file, e.lod, parts);
      return { file: e.file, lod: e.lod, ok: true };
    } catch (err) {
      console.warn(`[bronie GLB] ${e.file} (LOD ${e.lod}): ${err?.message || err} — model z weapons3D.js`);
      return { file: e.file, lod: e.lod, ok: false };
    }
  })).then((list) => ({ files: list }));
  if (!families) _loading = p;
  return p;
}
