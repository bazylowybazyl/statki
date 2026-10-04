// src/3d/cargoContainers3D.js
//
// KONTENERY 3D — widok ładunku statków ruchu v2 (Z5, plan § 3.4). Kontener to
// WIDOK liczby: moduł rysuje to, co podaje logika (cargoPortOps.js — pokład
// i przeładunek; src/data/cargoContainers.js — sloty, rodziny, wygląd), nic
// nie liczy od nowa i nic nie zmienia w grze.
//
// RYSOWANIE (jeden renderer: Core3D; obiekty w podanej scenie, warstwa 0 —
// pass ortho, jak kadłuby i mostki). Budżet: 3 wywołania na całą flotę:
//   • kontenery — jedna siatka instancji (sfazowany prostopadłościan) dla
//     wszystkich: na pokładach, niesione przez drony, na placach portu i płyty
//     maski ładowni; rodzina (standard / zbiornik / zsyp / płyta) to wzór
//     wierzchu w shaderze, nie osobna geometria; renderOrder 12 (jak mostek);
//   • cień na kadłubie — prostokąty POD kadłubem z testem głębi GREATER
//     (renderOrder 11): rysują się tylko tam, gdzie kadłub zapisał głębię,
//     więc są przycięte do sylwetki (wzór: mostek, bridge3D.js);
//   • cień na pokładzie portu — prostokąty na płycie pola (z ≈ −115) ze
//     zwykłym testem głębi: kadłuby nad nim go zasłaniają; do tego włazy wind
//     placu (renderOrder 11,5).
// Drony (cargoDrones3D.js) dokładają tu swoje cienie.
//
// PARALAKSA: statki są w passie ortho, a port (ring) w perspektywie (Core3D:
// kamera persp na wysokości H nad z = 0, ta sama skala w płaszczyźnie lotu).
// Wszystko poniżej płaszczyzny lotu (plac, drony nad pokładem portu) dostaje
// w shaderze skalę widoku H / (H − z) wokół środka kadru — PER WIERZCHOŁEK, więc
// kontener na placu ma perspektywę jak pokład pod nim (widać boki przy brzegu
// ekranu). Nad płaszczyzną (pokład statku) — bez skali: kadłub jest ortho.
// Wolna kamera (free3d, kamera kinowa dema): prawdziwe z, bez paralaksy.
//
// GŁĘBIA: nad płaszczyzną lotu z jest ściskane do ułamka jednostki (uDepth) —
// pass tarcz rysuje się na głębi ortho kadłubów, a kontener sterczący ponad
// kopułę tarczy wycinałby w niej dziurę. Porządek (kontener nad kadłubem, dron
// nad kontenerem) zostaje, bo ścisk jest monotoniczny.
//
// ŚWIATŁO: dwa słońca. Na pokładzie statku jak kadłub (hexShips3D: kierunek
// normalize(słońce − statek, z = 600), otoczenie 0,24, rozproszone 1,18, połysk
// 0,30, maska cieni Core3D — sunVisibility/sunFill; wierzch jasny jak kadłub
// pod kontenerem — hullLightAt jak w bridge3D.js). Na placu portu jak ring
// (słońce 49° nad płaszczyzną, dzień/noc z cienia planety, bez maski Core3D —
// ring ma własny model słońca). Niesiony kontener przechodzi płynnie
// (lightMix z wysokości).
//
// POCZĄTEK PRZY KAMERZE: dane instancji względem origin (mesh.position, three
// składa modelViewMatrix w double) — świat leży przy 5–10 mln j., float32
// w shaderze drgałby ~1 px (sceneOrigin.js, bridge3D._setOrigin).

import * as THREE from 'three/webgpu';
import {
  CONTAINER_FAMILY_CODE,
  COVER_PAINT,
  HAZMAT_PAINT,
  HOPPER_BODIES,
  HOPPER_MATERIAL,
  STANDARD_PAINTS,
  TANK_FRAMES,
  TANK_SHELLS,
  cargoHash01,
  cargoHoldLayout,
  cargoHoldSlots,
  cargoLayoutScale,
  cargoResourceKey,
  cargoUnitSize,
  containerFamilyOf,
  isHazmatCargo
} from '../data/cargoContainers.js';
import { RESOURCE_KEYS, RESOURCES } from '../data/resources.js';
import { sunShadowUniforms } from './sunShadowMask.js';
// Materiały w TSL (port WebGPU): cargoContainers3D.tsl.js — wspólne klocki widoku i światła z dronami.
import { createCargoUniforms, createContainerMaterial, createShadowMaterial } from './cargoContainers3D.tsl.js';
import { makeUniforms } from './tsl/uniformy.js';
import { zbierzZakres } from './zakresyWysylki.js';

// ---------------------------------------------------------------------------
// Strojenie (window.__cargo3DTune)
// ---------------------------------------------------------------------------

export const CARGO3D_TUNE = {
  enabled: true,
  // Zanik z odległością: krótszy bok kontenera na ekranie [px].
  minPx: 3,
  fullPx: 6,
  // Cienie dopiero od tylu px (i pełne od shadowFullPx).
  shadowMinPx: 10,
  shadowFullPx: 14,
  // Cień na kadłubie: „słońce cieni” jak mostek (azymut słońca, niska wysokość).
  shadowElevDeg: 30,
  shadowStrength: 0.5,
  shadowSoft: 0.08,
  contactAo: 0.35,
  // Cień na pokładzie portu (słońce ringu).
  deckShadowStrength: 0.55,
  // Światło na pokładzie statku (= SHIP_LIGHT_DEFAULTS kadłuba).
  ambient: 0.24,
  diffuse: 1.18,
  specular: 0.30,
  // Światło portu (ring: słońce 49°, otoczenie nieba).
  portAmbient: 0.2,
  portDiffuse: 0.95,
  portSpecular: 0.22,
  // Ścisk głębi nad płaszczyzną lotu (pass tarcz — patrz nagłówek).
  depthSquash: 0.02,
  drawContainers: true,
  drawShadows: true
};

if (typeof window !== 'undefined') window.__cargo3DTune = CARGO3D_TUNE;

// ---------------------------------------------------------------------------
// Stałe
// ---------------------------------------------------------------------------

export const CARGO3D_LIMITS = Object.freeze({
  deck: 2048,        // kontenery na pokładach (plan: talia pokładu ≤ 2048)
  loose: 256,        // niesione przez drony (≤ 256)
  yard: 1024,        // na placach portu
  hullShadows: 2048 + 256,
  deckShadows: 1024 + 512 + 256
});
const CAPACITY = CARGO3D_LIMITS.deck + CARGO3D_LIMITS.loose + CARGO3D_LIMITS.yard;
const MODEL_RENDER_ORDER = 12;
const HULL_SHADOW_ORDER = 11;
const DECK_SHADOW_ORDER = 11.5;
const SHIP_Z = 0.06;               // pokład statku (jak MODEL_LIFT mostka)
const HULL_SHADOW_Z = -0.6;        // pod kadłubem (jak odbiornik cienia mostka)
const COVER_H = 0.35;              // płyta maski ładowni
const NO_CLIP = -1e9;
const DEG = Math.PI / 180;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  const raw = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return [1, 1, 1];
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(raw.slice(i, i + 2), 16) / 255));
}
const smooth01 = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1e-6)));
  return t * t * (3 - 2 * t);
};

// Palety do shadera (liniowe). Kolejność = indeksy w danych.
const vecs = (list) => list.map((h) => new THREE.Vector3(...hexToLinear(h)));
const RES_COUNT = RESOURCE_KEYS.length;
// Wygląd surowców: kod rodziny, hazmat, materiał zsypu (dla CPU — dane instancji).
const RES_FAMILY = new Float32Array(RES_COUNT);
const RES_MAT = new Float32Array(RES_COUNT);
RESOURCE_KEYS.forEach((id, i) => {
  RES_FAMILY[i] = CONTAINER_FAMILY_CODE[containerFamilyOf(id)];
  const hop = RES_FAMILY[i] === CONTAINER_FAMILY_CODE.hopper;
  const mat = hop ? ({ ice: HOPPER_MATERIAL.ICE, scrap: HOPPER_MATERIAL.SCRAP, steel: HOPPER_MATERIAL.BARS, copper_wire: HOPPER_MATERIAL.COILS, polymer: HOPPER_MATERIAL.GRANULATE, raw_crystal: HOPPER_MATERIAL.CRYSTAL }[id] ?? HOPPER_MATERIAL.ORE) : 0;
  RES_MAT[i] = mat + (isHazmatCargo(id) ? 16 : 0);
});

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

// Sfazowany prostopadłościan: x, y ∈ [−½, ½], z ∈ [0, 1]; aBevel = przesunięcie
// wierzchołka o fazę (xy do środka, z w dół) — faza w jednostkach świata liczy
// shader (niezależnie od skali instancji). Bez dna (nigdy go nie widać z góry).
export function buildContainerGeometry() {
  const pos = [];
  const nrm = [];
  const bev = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0], v[1], v[2]);
      bev.push(v[3], v[4], v[5]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const S = Math.SQRT1_2;
  // wierzchołki: [x, y, z, bevX, bevY, bevZ]
  const B = (x, y) => [x, y, 0, 0, 0, 0];
  const O = (x, y) => [x, y, 1, 0, 0, -1];                         // górny pierścień zewnętrzny (opuszczony o fazę)
  const I = (x, y) => [x, y, 1, -Math.sign(x), -Math.sign(y), 0];  // wierzch (cofnięty o fazę)
  const h = 0.5;
  // boki
  quad(B(h, -h), B(h, h), O(h, h), O(h, -h), [1, 0, 0]);
  quad(B(-h, h), B(-h, -h), O(-h, -h), O(-h, h), [-1, 0, 0]);
  quad(B(h, h), B(-h, h), O(-h, h), O(h, h), [0, 1, 0]);
  quad(B(-h, -h), B(h, -h), O(h, -h), O(-h, -h), [0, -1, 0]);
  // fazy
  quad(O(h, -h), O(h, h), I(h, h), I(h, -h), [S, 0, S]);
  quad(O(-h, h), O(-h, -h), I(-h, -h), I(-h, h), [-S, 0, S]);
  quad(O(h, h), O(-h, h), I(-h, h), I(h, h), [0, S, S]);
  quad(O(-h, -h), O(h, -h), I(h, -h), I(-h, -h), [0, -S, S]);
  // wierzch
  quad(I(-h, -h), I(h, -h), I(h, h), I(-h, h), [0, 0, 1]);
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    bevel: new Float32Array(bev),
    index: new Uint16Array(idx)
  };
}

// Bez DynamicDrawUsage (WebGPU wysyłałby cały atrybut przy każdym renderze) — wysyłka
// zbieranego zakresu po needsUpdate (zakresyWysylki.js).
function makeInstanceAttr(geometry, name, itemSize, capacity) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
  geometry.setAttribute(name, attr);
  return attr;
}

// Upload tylko użytej części (zakres zbierany — bez alokacji).
function commitAttr(attr, count) {
  if (count <= 0) return;
  zbierzZakres(attr, 0, count * attr.itemSize);
}

// ---------------------------------------------------------------------------
// Pomocnicze: poza, światło kadłuba
// ---------------------------------------------------------------------------

/**
 * Jasność kadłuba pod punktem sprite'a — lustro HEX_FRAGMENT_SHADER bez normal
 * mapy (jak hullLightAt w bridge3D.js): poduszkowa normalna z UV sprite'a
 * (px, py ∈ [−1, 1]), kurs sceny θ, kierunek do słońca (scena, z = 600).
 */
export function cargoHullLight(px, py, theta, lx, ly, lz, ambient, diffuse) {
  let nx = px * 0.45;
  let ny = -py * 0.45;
  const nl = Math.hypot(nx, ny, 1);
  nx /= nl; ny /= nl;
  const nz = 1 / nl;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const wx = nx * c - ny * s;
  const wy = nx * s + ny * c;
  return ambient + diffuse * Math.max(0, wx * lx + wy * ly + nz * lz);
}

const _v = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Moduł
// ---------------------------------------------------------------------------

export const CargoContainers3D = {
  scene: null,
  ready: false,
  mesh: null,
  attrs: null,
  hullShadow: null,
  deckShadow: null,
  uniforms: null,
  frame: null,
  count: 0,
  counts: { deck: 0, loose: 0, yard: 0 },
  stats: { instances: 0, deck: 0, loose: 0, yard: 0, hullShadows: 0, deckShadows: 0, drawCalls: 0, cpuMs: 0, culled: 0, faded: 0 },

  /** Podpina moduł do sceny (w grze: Core3D.scene). Bez własnego renderera. */
  attach(scene) {
    if (this.scene === scene && this.ready) return true;
    this.dispose();
    if (!scene) return false;
    this.scene = scene;
    // Wspólne węzły uniformów (kontenery, cienie, drony) — `.value` jak dawniej.
    const U = { ...createCargoUniforms(), ...sunShadowUniforms };
    U.uCgDepth.value.set(CARGO3D_TUNE.depthSquash, 1);
    this.uniforms = U;

    // Kontenery.
    {
      const g = buildContainerGeometry();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('aBevel', new THREE.BufferAttribute(g.bevel, 3));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      const attrs = {
        pos: makeInstanceAttr(geo, 'iPos', 4, CAPACITY),
        size: makeInstanceAttr(geo, 'iSize', 4, CAPACITY),
        look: makeInstanceAttr(geo, 'iLook', 4, CAPACITY),
        extra: makeInstanceAttr(geo, 'iExtra', 4, CAPACITY)
      };
      geo.instanceCount = 0;
      const palettes = makeUniforms({
        uStd: vecs(STANDARD_PAINTS),
        uShell: vecs(TANK_SHELLS),
        uFrame: vecs(TANK_FRAMES),
        uBody: vecs(HOPPER_BODIES),
        uRes: RESOURCE_KEYS.map((k) => new THREE.Vector3(...hexToLinear(RESOURCES[k].color))),
        uHazmat: new THREE.Vector3(...hexToLinear(HAZMAT_PAINT)),
        uCover: new THREE.Vector3(...hexToLinear(COVER_PAINT)),
        uAmber: new THREE.Vector3(...hexToLinear('#c8861e'))
      });
      const mat = createContainerMaterial(U, palettes, {
        std: STANDARD_PAINTS.length, shell: TANK_SHELLS.length, frame: TANK_FRAMES.length, body: HOPPER_BODIES.length
      });
      mat.uniforms = { ...U, ...palettes };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'CARGO3D_CONTAINERS';
      mesh.frustumCulled = false;
      mesh.renderOrder = MODEL_RENDER_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      this.mesh = mesh;
      this.attrs = attrs;
    }

    // Cienie: kadłub (GREATER) i pokład portu.
    const shadowPart = (name, capacity, deck) => {
      const geo = new THREE.InstancedBufferGeometry();
      const plane = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      const attrs = {
        pos: makeInstanceAttr(geo, 'iPos', 4, capacity),
        box: makeInstanceAttr(geo, 'iBox', 4, capacity),
        par: makeInstanceAttr(geo, 'iPar', 4, capacity)
      };
      geo.instanceCount = 0;
      const own = makeUniforms({ uShadow: new THREE.Vector4(), uShadowMix: new THREE.Vector4(1, 0, 0, 0) });
      const mat = createShadowMaterial(U, own, deck, HULL_SHADOW_Z);
      mat.uniforms = { ...U, ...own };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = deck ? DECK_SHADOW_ORDER : HULL_SHADOW_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, geometry: geo, material: mat, attrs, count: 0, capacity };
    };
    this.hullShadow = shadowPart('CARGO3D_HULL_SHADOW', CARGO3D_LIMITS.hullShadows, false);
    this.deckShadow = shadowPart('CARGO3D_DECK_SHADOW', CARGO3D_LIMITS.deckShadows, true);
    this.frame = {
      originX: 0, originY: 0, camX: 0, camY: 0, H: 1e6, parallax: false, pxPerUnit: 1,
      viewHalfW: Infinity, viewHalfH: Infinity, sunX: -1e6, sunY: 5e5, time: 0,
      lx: 0, ly: 0, lz: 1, tanShadow: Math.tan(30 * DEG)
    };
    this.ready = true;
    return true;
  },

  setLayer(layer = 0) {
    for (const m of [this.mesh, this.hullShadow?.mesh, this.deckShadow?.mesh]) if (m) m.layers.set(layer);
  },

  /**
   * Początek klatki. opts:
   *   camera       — kamera gry { x, y, zoom } (świat gry, y w dół): początek
   *                  danych i środek paralaksy,
   *   cameraHeight — wysokość kamery persp nad z = 0 (Core3D.syncCamera:
   *                  (wys. bufora / 2) / tan(fov / 2) / zoom),
   *   pxPerUnit    — piksele ekranu na jednostkę w płaszczyźnie lotu (zoom),
   *   viewHalfW/H  — połowa kadru w jednostkach świata (kadrowanie; brak = bez),
   *   perspective  — wolna kamera (true z, bez paralaksy i ścisku głębi),
   *   origin       — { x, y } scena (domyślnie środek kadru),
   *   sun          — Słońce gry { x, y } (światło kadłubów),
   *   portSun      — { dir: [x, y, z] scena, daylight } — słońce ringu,
   *   time         — czas animacji [s].
   */
  begin(opts = {}) {
    if (!this.ready) return;
    const T = CARGO3D_TUNE;
    const F = this.frame;
    const cam = opts.camera || { x: 0, y: 0, zoom: 1 };
    F.camX = Number(cam.x) || 0;
    F.camY = -(Number(cam.y) || 0);
    F.originX = Number.isFinite(opts.origin?.x) ? opts.origin.x : F.camX;
    F.originY = Number.isFinite(opts.origin?.y) ? opts.origin.y : F.camY;
    F.perspective = !!opts.perspective;
    F.H = Math.max(1, Number(opts.cameraHeight) || 1e6);
    F.parallax = !F.perspective && Number.isFinite(Number(opts.cameraHeight));
    F.pxPerUnit = Math.max(1e-6, Number(opts.pxPerUnit) || Number(cam.zoom) || 1);
    F.viewHalfW = Number(opts.viewHalfW) > 0 ? Number(opts.viewHalfW) : Infinity;
    F.viewHalfH = Number(opts.viewHalfH) > 0 ? Number(opts.viewHalfH) : Infinity;
    const sun = opts.sun || (typeof window !== 'undefined' ? window.SUN : null);
    F.sunX = Number.isFinite(sun?.x) ? sun.x : F.camX - 60000;
    F.sunY = Number.isFinite(sun?.y) ? -sun.y : F.camY + 40000;
    F.time = Number(opts.time) || 0;
    F.tanShadow = Math.tan(Math.max(5, Math.min(85, T.shadowElevDeg)) * DEG);
    const U = this.uniforms;
    U.uCgParallax.value.set(F.camX - F.originX, F.camY - F.originY, F.H, F.parallax ? 1 : 0);
    U.uCgDepth.value.set(T.depthSquash, F.perspective ? 0 : 1);
    U.uCgShip.value.set(T.ambient, T.diffuse, T.specular, 0);
    const day = Number.isFinite(opts.portSun?.daylight) ? Math.max(0, Math.min(1, opts.portSun.daylight)) : 1;
    U.uCgPort.value.set(T.portAmbient * (0.35 + 0.65 * day), T.portDiffuse, T.portSpecular, day);
    U.uCgSunRel.value.set(F.sunX - F.originX, F.sunY - F.originY, 600);
    const d = opts.portSun?.dir;
    if (d && d.length >= 3) U.uCgPortSun.value.set(d[0], d[1], d[2]).normalize();
    else if (d && Number.isFinite(d.x)) U.uCgPortSun.value.set(d.x, d.y, d.z).normalize();
    this.hullShadow.material.uniforms.uShadow.value.set(F.tanShadow, T.shadowSoft, 0.08, 0);
    this.deckShadow.material.uniforms.uShadow.value.set(1, T.shadowSoft, 0.06, 1);
    this.deckShadow.material.uniforms.uShadowMix.value.set(day, 0, 0, 0);
    for (const m of [this.mesh, this.hullShadow.mesh, this.deckShadow.mesh]) m.position.set(F.originX, F.originY, 0);
    this.count = 0;
    this.counts.deck = 0;
    this.counts.loose = 0;
    this.counts.yard = 0;
    this.hullShadow.count = 0;
    this.deckShadow.count = 0;
    this.stats.culled = 0;
    this.stats.faded = 0;
    this._t0 = performance.now();
  },

  // Skala paralaksy w punkcie (x, y scena, z) — do LOD i kadrowania.
  _k(z) {
    const F = this.frame;
    return F.parallax && z < 0 ? F.H / Math.max(F.H - z, 1) : 1;
  },

  _inView(sx, sy, r) {
    const F = this.frame;
    return Math.abs(sx - F.camX) <= F.viewHalfW + r && Math.abs(sy - F.camY) <= F.viewHalfH + r;
  },

  /**
   * Kontener (dowolny: pokład, hak drona, plac). Scena: sx, sy, z (podstawa),
   * yaw (kurs sceny), L × W × H, res (indeks surowca), seed (wygląd), light
   * (0 statek … 1 port), clipZ (wyłaz), hullL (jasność kadłuba pod nim),
   * grid (podsiatka: nx + 8 ny + 64 tiers), kind: 'deck' | 'loose' | 'yard',
   * family (−1 = z surowca; 3 = płyta maski). Zwraca true, gdy dodany.
   */
  pushContainer(sx, sy, z, yaw, L, W, H, res, seed, light, clipZ, hullL, grid, kind = 'deck', family = -1) {
    if (!this.ready || !CARGO3D_TUNE.enabled) return false;
    const lim = CARGO3D_LIMITS[kind] ?? 0;
    if (this.counts[kind] >= lim || this.count >= CAPACITY) return false;
    const k = this._k(z);
    const px = Math.min(L, W) * this.frame.pxPerUnit * k;
    const fade = smooth01(CARGO3D_TUNE.minPx, CARGO3D_TUNE.fullPx, px);
    if (fade <= 0.01) { this.stats.faded++; return false; }
    if (!this._inView(sx, sy, Math.max(L, W) + H)) { this.stats.culled++; return false; }
    const n = this.count++;
    this.counts[kind]++;
    const F = this.frame;
    const A = this.attrs;
    const o = n * 4;
    const P = A.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = z; P[o + 3] = yaw;
    const S = A.size.array;
    S[o] = L; S[o + 1] = W; S[o + 2] = H; S[o + 3] = fade;
    const ri = res >= 0 && res < RES_COUNT ? res : 0;
    const Lk = A.look.array;
    Lk[o] = family >= 0 ? family : RES_FAMILY[ri]; Lk[o + 1] = ri; Lk[o + 2] = seed; Lk[o + 3] = light;
    const E = A.extra.array;
    E[o] = Number.isFinite(clipZ) ? clipZ : NO_CLIP; E[o + 1] = grid; E[o + 2] = RES_MAT[ri]; E[o + 3] = hullL;
    // Cienie: pokład statku — na kadłub; niesiony — na kadłub pod nim (GREATER
    // rysuje tylko na kadłubie) i na pokład portu; plac — na pokład portu.
    if (CARGO3D_TUNE.drawShadows && px >= CARGO3D_TUNE.shadowMinPx) {
      const sf = smooth01(CARGO3D_TUNE.shadowMinPx, CARGO3D_TUNE.shadowFullPx, px) * fade;
      if (kind !== 'yard' && z + H > 0) this.pushHullShadow(sx, sy, yaw, L, W, Math.max(0, z), z + H, CARGO3D_TUNE.shadowStrength * sf, kind === 'deck' ? CARGO3D_TUNE.contactAo * sf : 0);
      if (kind !== 'deck') this.pushDeckShadow(sx, sy, yaw, L, W, z, z + H, CARGO3D_TUNE.deckShadowStrength * sf, kind === 'yard' ? CARGO3D_TUNE.contactAo * sf : 0, this._deckZ);
    }
    return true;
  },

  /** Cień na kadłubie (GREATER): obrys L × W, kurs yaw, wysokość z0…z1 nad z = 0. */
  pushHullShadow(sx, sy, yaw, L, W, z0, z1, strength, contact = 0) {
    const R = this.hullShadow;
    if (!R || R.count >= R.capacity || strength <= 0.003) return false;
    const n = R.count++;
    const F = this.frame;
    const o = n * 4;
    const P = R.attrs.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = 0; P[o + 3] = yaw;
    const B = R.attrs.box.array;
    B[o] = L; B[o + 1] = W; B[o + 2] = z0; B[o + 3] = z1;
    const Q = R.attrs.par.array;
    Q[o] = strength; Q[o + 1] = contact; Q[o + 2] = 0; Q[o + 3] = 0;
    return true;
  },

  /**
   * Cień na pokładzie portu (słońce ringu) albo właz windy (hatch = true:
   * ciemny prostokąt L × W, strength = otwarcie). deckZ — wysokość płyty.
   */
  pushDeckShadow(sx, sy, yaw, L, W, z0, z1, strength, contact = 0, deckZ = this._deckZ, hatch = false) {
    const R = this.deckShadow;
    if (!R || R.count >= R.capacity || strength <= 0.003) return false;
    const n = R.count++;
    const F = this.frame;
    const o = n * 4;
    const P = R.attrs.pos.array;
    P[o] = sx - F.originX; P[o + 1] = sy - F.originY; P[o + 2] = 0; P[o + 3] = yaw;
    const B = R.attrs.box.array;
    B[o] = L; B[o + 1] = W; B[o + 2] = z0; B[o + 3] = z1;
    const Q = R.attrs.par.array;
    Q[o] = strength; Q[o + 1] = contact; Q[o + 2] = hatch ? 1 : 0; Q[o + 3] = deckZ;
    return true;
  },

  _deckZ: -114.5,
  /** Wysokość pokładu portu dla cieni (domyślnie płyta pola stanowiska). */
  setDeckZ(z) { if (Number.isFinite(z)) this._deckZ = z; },

  /**
   * Pokład statku: kontenery w slotach układu ładowni. pose — { x, y, angle }
   * świat gry (poza RENDERU statku), layoutId, slotRes — Int16Array surowców
   * w slotach (−1 pusty), seed — ziarno kursu. opts: spriteRotation, scale
   * (j./px), mask (Uint8Array: 0 = komórka kadłuba zniszczona — slot pusty,
   * kontener do łupu później), deckMode: 'empty' (sprite z pustym pokładem)
   * | 'painted' (stary sprite: płyty maski na pustych slotach).
   */
  pushShipDeck(pose, layoutId, slotRes, seed = 0, opts = {}) {
    if (!this.ready || !CARGO3D_TUNE.drawContainers) return 0;
    const lay = cargoHoldLayout(layoutId);
    if (!lay || !pose) return 0;
    const F = this.frame;
    const T = CARGO3D_TUNE;
    const slots = cargoHoldSlots(lay);
    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : cargoLayoutScale(lay);
    const unit = cargoUnitSize(lay, scale, this._unit || (this._unit = {}));
    const ang = (Number(pose.angle) || 0) + (Number(opts.spriteRotation) || 0);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const X = Number(pose.x) || 0;
    const Y = Number(pose.y) || 0;
    const yaw = -ang;
    // Kadrowanie całego statku (promień z płótna).
    const R = 0.5 * Math.hypot(lay.png.w, lay.png.h) * scale;
    if (!this._inView(X, -Y, R)) { this.stats.culled += slots.length; return 0; }
    const px = Math.min(unit.L, unit.W) * F.pxPerUnit;
    if (px < T.minPx) { this.stats.faded += slots.length; return 0; }
    const grid = lay.unit.nx + 8 * lay.unit.ny + 64 * lay.unit.tiers;
    // Światło kadłuba: kierunek do słońca w scenie (z = 600), jak hexShips3D.
    let lx = F.sunX - X;
    let ly = F.sunY + Y;
    let lz = 600;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const halfW = lay.png.w / 2;
    const halfH = lay.png.h / 2;
    const painted = opts.deckMode === 'painted';
    const mask = opts.mask || null;
    let pushed = 0;
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i];
      const r = slotRes ? slotRes[i] : -1;
      const alive = !mask || mask[i] !== 0;
      if ((r < 0 || !alive) && !painted) continue;
      const lxp = sl.x * scale;
      const lyp = sl.y * scale;
      const gx = X + lxp * c - lyp * s;
      const gy = Y + lxp * s + lyp * c;
      const hullL = cargoHullLight(sl.x / halfW, sl.y / halfH, yaw, lx, ly, lz, T.ambient, T.diffuse);
      if (r >= 0 && alive) {
        if (this.pushContainer(gx, -gy, SHIP_Z, yaw, unit.L, unit.W, unit.H, r, cargoHash01(seed, i, 5), 0, NO_CLIP, hullL, grid, 'deck')) pushed++;
      } else if (painted && alive) {
        this.pushContainer(gx, -gy, SHIP_Z, yaw, sl.w * scale, sl.h * scale, COVER_H, 0, 0, 0, NO_CLIP, hullL, 1 + 8 + 64, 'deck', CONTAINER_FAMILY_CODE.cover);
      }
    }
    return pushed;
  },

  /**
   * Kontener w układzie stanowiska (niesiony albo na placu): berthPose —
   * { x, y, angle } świata gry (poza stanowiska = statku zadokowanego), u, v,
   * z, yaw (lokalny), unit — wymiary (cargoUnitSize), grid, res, seed, clipZ,
   * light, kind 'loose' | 'yard'.
   */
  pushBerthContainer(berthPose, u, v, z, yaw, unit, grid, res, seed, clipZ, light, kind = 'loose') {
    const ang = Number(berthPose.angle) || 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const gx = berthPose.x + u * c - v * s;
    const gy = berthPose.y + u * s + v * c;
    return this.pushContainer(gx, -gy, z, -(ang + yaw), unit.L, unit.W, unit.H, res, seed, light, clipZ, this.uniforms.uCgShip.value.x, grid, kind);
  },

  /** Właz windy placu w układzie stanowiska (ciemny prostokąt na płycie). */
  pushBerthHatch(berthPose, u, v, yaw, L, W, open, deckZ = this._deckZ) {
    const ang = Number(berthPose.angle) || 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const gx = berthPose.x + u * c - v * s;
    const gy = berthPose.y + u * s + v * c;
    return this.pushDeckShadow(gx, -gy, -(ang + yaw), L, W, deckZ, deckZ, 0.92 * open, 0, deckZ, true);
  },

  /** Koniec klatki: wysyłka instancji (tylko użyte zakresy). */
  end() {
    if (!this.ready) return;
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    let draws = 0;
    if (n) {
      draws++;
      for (const a of Object.values(this.attrs)) commitAttr(a, n);
    }
    for (const R of [this.hullShadow, this.deckShadow]) {
      R.geometry.instanceCount = R.count;
      R.mesh.visible = R.count > 0;
      if (R.count) {
        draws++;
        for (const a of Object.values(R.attrs)) commitAttr(a, R.count);
      }
    }
    const S = this.stats;
    S.instances = n;
    S.deck = this.counts.deck;
    S.loose = this.counts.loose;
    S.yard = this.counts.yard;
    S.hullShadows = this.hullShadow.count;
    S.deckShadows = this.deckShadow.count;
    S.drawCalls = draws;
    const ms = performance.now() - (this._t0 || performance.now());
    S.cpuMs = S.cpuMs > 0 ? S.cpuMs * 0.9 + ms * 0.1 : ms;
  },

  dispose() {
    const scene = this.scene;
    for (const part of [this.mesh ? { mesh: this.mesh } : null, this.hullShadow, this.deckShadow]) {
      if (!part?.mesh) continue;
      if (scene) scene.remove(part.mesh);
      part.mesh.geometry?.dispose?.();
      part.mesh.material?.dispose?.();
    }
    this.mesh = null;
    this.attrs = null;
    this.hullShadow = null;
    this.deckShadow = null;
    this.uniforms = null;
    this.scene = null;
    this.ready = false;
  }
};

/** Klucz surowca dla indeksu (pomocnicze dla HUD dema). */
export function cargoResourceLabel(index) {
  const id = cargoResourceKey(index);
  return id ? RESOURCES[id].label : '—';
}

if (typeof window !== 'undefined') window.CargoContainers3D = CargoContainers3D;
