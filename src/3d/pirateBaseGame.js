// Baza piratów w grze (misja 1; szkic użytkownika z 2026-10-11, zastępuje suchy dok) — klej renderu: bryła PirateBase3D
// (src/3d/portBuildings/) w Core3D.scene, warstwy BG 1 / FG 2 jak hale K-7.
//
//  - Bryła powstaje na EKRANIE ŁADOWANIA (rejestr Core3D.warmup, faza 'loading'); misja tylko ustawia ramkę.
//  - Ramka = miejsce bazy z planu misji (pirateBaseSite.placePirateBase): portModuleFrame(O.x, −O.y, kąt).
//  - Mgła wojny: baza schowana, dopóki strona gracza nie zobaczy żadnej z jej budowli.
//  - Maszty (layout.lights) świecą też w SIATCE ŚWIATEŁ gry (Core3D.fx.lights.point co klatkę).
//  - ROZGRYWKA bazy jest po stronie gry (RW-24): src/game/story/pirateBaseWorld.js — stan kawałków (pęknięty /
//    schowany / ciało świata), zbiór `_dockGone` budowli, ciała świata (src/game/story/pirateBaseBodies.js →
//    worldBodies), decyzje break / ram, środek planetoidy. Ten moduł to sam obraz: dostaje ZDARZENIA gry
//    (pirateBase3DEvent — 'attach', 'bodies', 'break', 'ram', 'hide', 'rockCollapse', 'detach'; w workerze rekordy
//    PBASE_* / ROCK_COLLAPSE) i stan klatki (updatePirateBase3D: mgła, zasilanie, alarm, stanowiska). Kawałek w bańce
//    gracza rysuje skóra ciała świata (src/3d/worldBodies3D.js — haki `site.render` dopina zdarzenie 'bodies');
//    dryf odpadłego kawałka i jego zniknięcie to obraz.
//  - PLANETOIDA pod bazą (prośba użytkownika 2026-10-15; src/3d/portBuildings/pirateRockLayout.js): skała (pirateRock3D.js)
//    i osada z windą kosmiczną (pirateRockSite3D.js) w passie tła (warstwa 1, perspektywa — głębia), ta sama ramka
//    co baza. Skała to teren (widać ją zawsze), osada i lina chowają się we mgle wojny razem z bazą. Rozpad habitatu
//    zrywa windę i kładzie osadę (collapsePirateRockSite — storyGame._chainExplosion).
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { PirateBase3D } from './portBuildings/pirateBase3D.js';
import { createPirateBaseLayout } from './portBuildings/pirateBaseLayout.js';
import { portModuleFrame } from './portBuildings/portModuleTraffic.js';
import { buildingSkinWarmGeometry } from './portBuildings/portBuildingSkin3D.js';
import { resetWorldBodies3D } from './worldBodies3D.js';
import { PirateRock3D } from './pirateRock3D.js';
import { PirateRockSite3D } from './portBuildings/pirateRockSite3D.js';
import { createPirateRockLayout } from './portBuildings/pirateRockLayout.js';
import { RockImpactFx, setRockImpactHost } from './pirateRockImpactFx.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';
import { WARP_WORLD_LENS, warpLensExtraBody, setWarpLensExtra, lensImageToWorld, lensPivotElements } from './warp/worldLens.js';

const LAYER_BG = 1;
const LAYER_FG = 2;

// SOCZEWKA ŚWIATA — HIDALGO I BAZA (DECYZJE E1, etap 3A 2026-10-26): planetoida ma rekord dodatkowy soczewki skoku
// gracza (worldLens.js: `hidalgo` — środek skały W GŁĘBOKOŚCI sceny, promień skały, zasięg bazy jako rzecz przypięta)
// jak małe ciało z głębokością; w skoku skała, osada z windą i bryła bazy jadą za obrazem skały: root.matrix = macierz
// soczewki (punkt sceny p → obraz środka skały + k · (p − środek skały)) · ramka, w passie tła (FG bazy → tło —
// wzór HALO_GAME.lensLayers; pass tła rysuje się przed statkiem). Kawałki bazy w bańce gracza (skóra ciał świata
// — worldBodies3D) i światła masztów w siatce świateł gasną na czas soczewki (nie da się ich przeskalować).
let _lensRec = null;
let _lensOn = false;
const _lensWorld = { x: 0, y: 0, k: 1 };
const _lensEl = new Array(16).fill(0);
const _lensM = new THREE.Matrix4();
/** Ramki korzeni sprzed soczewki (root → Matrix4) — przywracane po skoku. */
const _lensFrames = new Map();

const _lensRootList = [];
/** Korzenie w soczewce (lista trzymana — bez alokacji w klatce). */
function lensRoots() {
  const out = _lensRootList;
  out.length = 0;
  if (rock?.root?.parent) out.push(rock.root);
  // (rockSite.fx.root — dym i ogień rozpadu — stoi `position` z matrixAutoUpdate: zostaje na prawdziwym miejscu)
  if (rockSite?.root?.parent) out.push(rockSite.root);
  if (base?.root?.parent) out.push(base.root);
  return out;
}

/** Hidalgo w soczewce skoku (rekord co klatkę; w soczewce — korzenie przeskalowane wokół środka skały). */
function applyPirateBaseLens() {
  if (!rock || !rock.root.parent) return;
  const R = Number(rock.layout.R) || 32000;
  const cz = Number(rock.layout.center[1]) || 0;
  if (!_lensRec) _lensRec = warpLensExtraBody('hidalgo', 'small');
  setWarpLensExtra(_lensRec, rockAt.x, rockAt.y, R, cz);
  if (place && place.origin) {
    const dx = place.origin.x - rockAt.x;
    const dy = place.origin.y - rockAt.y;
    _lensRec.attachR = Math.sqrt(dx * dx + dy * dy) + (Number(place.radius) || 0);
  }
  const a = _lensRec.anchor;
  const on = !!(a && a.on && a.real < 0.999);
  if (!on && !_lensOn) return;
  const roots = lensRoots();
  if (on) {
    if (!_lensOn) {
      _lensFrames.clear();
      for (let i = 0; i < roots.length; i++) _lensFrames.set(roots[i], roots[i].matrix.clone());
      if (base) base.setLayers(LAYER_BG, LAYER_BG);
      _lensOn = true;
    }
    // obraz środka skały w jej głębokości (perspektywa passa tła); skala k = obraz / prawdziwy rozmiar
    const o = _lensRec.out;
    lensImageToWorld(WARP_WORLD_LENS, o.x, o.y, cz, false, _lensWorld);
    lensPivotElements(_lensWorld.x, -_lensWorld.y, cz, Math.max(1e-6, a.k), rockAt.x, -rockAt.y, cz, _lensEl);
    _lensM.fromArray(_lensEl);
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      let f = _lensFrames.get(r);
      if (!f) { f = r.matrix.clone(); _lensFrames.set(r, f); }
      r.matrix.multiplyMatrices(_lensM, f);
      r.matrixWorldNeedsUpdate = true;
    }
  } else if (_lensOn) {
    for (const [r, f] of _lensFrames) { r.matrix.copy(f); r.matrixWorldNeedsUpdate = true; }
    _lensFrames.clear();
    if (base) base.setLayers(LAYER_BG, LAYER_FG);
    _lensOn = false;
  }
}

let prebuilt = null;
let base = null;
let place = null;
let fogHidden = false;

function build() {
  const d = new PirateBase3D({ layout: createPirateBaseLayout(), frame: portModuleFrame(0, 0, 0), name: 'Baza piratów' });
  d.setLayers(LAYER_BG, LAYER_FG);
  d.root.userData.fgCategory = 'stations';
  return d;
}

// Kratownice ciał świata bazy liczy strona gry (prebuildPirateBaseWorld — ekran ładowania, bez Core3D.scene).
function ensurePrebuilt() {
  if (base) return base;
  if (!prebuilt && Core3D.scene) prebuilt = build();
  return prebuilt;
}

Core3D.warmup?.add({ name: 'baza piratów: bryła', objects: () => ensurePrebuilt()?.root || null, phase: 'loading' });

// ---- planetoida pod bazą: skała, osada, winda (pass tła, warstwa BG)
let rock = null;
let rockSite = null;
let rockAt = { x: 0, y: 0 };
// Uderzenia w skałę (upadek bazy — rekordy ROCK_IMPACT gry, src/3d/pirateRockImpactFx.js): cząstki w passie tła
// i głębokie domeny gazu reżysera wybuchów; cel dekodera rejestrowany przy skale.
let rockImpact = null;
function ensureRock() {
  if (rock || !Core3D.scene) return rock;
  const layout = createPirateRockLayout();
  rock = new PirateRock3D(layout, LAYER_BG);
  rockSite = new PirateRockSite3D({ layout, frame: portModuleFrame(0, 0, 0), layer: LAYER_BG, name: 'Osada piratów na planetoidzie' });
  rockSite.root.userData.fgCategory = 'stations';
  rockImpact = new RockImpactFx({ layer: LAYER_BG, core: Core3D });
  rockImpact.onScar = (x, y, z, r, k) => rock.addScar(x, y, z, r, k);
  setRockImpactHost(rockImpact);
  return rock;
}
Core3D.warmup?.add({
  name: 'baza piratów: planetoida, osada, winda',
  objects: () => (ensureRock() ? [rock.root, ...rockSite.warmupObjects()] : null),
  phase: 'loading'
});
Core3D.warmup?.add({
  name: 'planetoida: uderzenia (pył, odłamki, błyski)',
  objects: () => (ensureRock() ? rockImpact.warmupMeshes() : null),
  phase: 'loading',
  variant: WARIANT_INSTANCJI
});
let _skinHolders = null;
function skinWarmHolders() {
  const d = prebuilt || base;
  if (!d) return null;
  if (_skinHolders && _skinHolders.base === d) return _skinHolders.root;
  const root = new THREE.Group();
  for (const [set, layer] of [['bg', LAYER_BG], ['fg', LAYER_FG]]) {
    for (const indexed of [false, true]) {
      const m = new THREE.Mesh(buildingSkinWarmGeometry(indexed), d.skinMaterial(set));
      m.frustumCulled = false;
      m.layers.set(layer);
      root.add(m);
    }
  }
  // Bryły 3D (wieża habitatu, dysk — wariant „skin3”): każdy zestaw w OBU passach (część pod płaszczyzną gry w tle,
  // nad nią w FG — worldBodies3D), z indeksem (odłamy) i bez.
  for (const set of ['bg', 'fg']) {
    for (const layer of [LAYER_BG, LAYER_FG]) {
      for (const indexed of [false, true]) {
        const m = new THREE.Mesh(buildingSkinWarmGeometry(indexed), d.skinMaterial(set, true));
        m.frustumCulled = false;
        m.layers.set(layer);
        m.userData.clipZ = new THREE.Vector2(layer === LAYER_BG ? -1 : 1, 0);
        root.add(m);
      }
    }
  }
  _skinHolders = { base: d, root };
  return root;
}
Core3D.warmup?.add({ name: 'baza piratów: skóra ciał', objects: () => (ensurePrebuilt(), skinWarmHolders()), layer: 'all', phase: 'loading' });

/**
 * Zdarzenia bazy z gry (src/game/story/pirateBaseWorld.js — onPirateBaseEvent): bryła, ciała świata (haki skóry),
 * kawałki odpadające i schowane, zawalenie osady na planetoidzie.
 */
export function pirateBase3DEvent(type, a, b, c) {
  if (type === 'attach') attachPirateBase3D(a, b);
  else if (type === 'bodies') attachPirateBaseBodies3D(a);
  else if (type === 'bodiesDetach') resetWorldBodies3D();
  else if (type === 'break') { if (base) base.breakChunk(a, b); }
  else if (type === 'ram') { if (base) base.ramChunk(a, b, c); }
  else if (type === 'hide') { if (base) base.hideChunk(a); }
  else if (type === 'rockCollapse') collapsePirateRockSite();
  else if (type === 'detach') detachPirateBase3D();
}

/** Podpina bryłę bazy w miejscu z planu misji (ramka). */
function attachPirateBase3D(owners, basePlace) {
  if (!Core3D.scene || !basePlace) return null;
  if (!base) {
    base = prebuilt || build();
    prebuilt = null;
  }
  place = basePlace;
  base.setFrame(portModuleFrame(basePlace.origin.x, -basePlace.origin.y, basePlace.frameAngle));
  base.resetChunks();
  base.update(0, { alarm: false, habitat: 1, disc: 1, fuel: 1, warehouse: 1, bays: 0 });
  if (base.root.parent !== Core3D.scene) Core3D.scene.add(base.root);
  base.root.visible = true;
  fogHidden = false;
  attachPirateRock(basePlace);
  return base;
}

function attachPirateRock(basePlace) {
  if (!ensureRock()) return;
  const frame = portModuleFrame(basePlace.origin.x, -basePlace.origin.y, basePlace.frameAngle);
  const c = rock.layout.center;
  rockAt = basePlace.toGame(c[0], c[2], {});
  rock.setFrame(frame, rockAt);
  rockSite.setFrame(frame);
  rockSite.reset();
  rockSite.update(0, {});
  // uderzenia: środek skały w scenie (x gry, −y gry, h) — początek siatek cząstek
  rockImpact.reset();
  rock.clearScars();
  rockImpact.setRock(rockAt.x, -rockAt.y, c[1], rock.layout.R);
  for (const r of [rock.root, rockSite.root, rockSite.fx.root, rockImpact.root]) {
    if (r.parent !== Core3D.scene) Core3D.scene.add(r);
    r.visible = true;
  }
}

/** Rozpad habitatu: winda puszcza, osada na planetoidzie wybucha po kolei (scenariusz). Zwraca false bez osady. */
function collapsePirateRockSite() {
  if (!rockSite || !rockSite.root.parent) return false;
  return rockSite.collapse();
}
/** Skała i osada (albo null) — dev, zrzuty, narzędzia. */
export function pirateRockSite() { return rockSite ? { rock, site: rockSite, at: rockAt, impact: rockImpact } : null; }

function detachPirateBase3D() {
  if (_lensOn) {
    for (const [r, f] of _lensFrames) { r.matrix.copy(f); r.matrixWorldNeedsUpdate = true; }
    _lensFrames.clear();
    if (base) base.setLayers(LAYER_BG, LAYER_FG);
    _lensOn = false;
  }
  for (const r of [rock?.root, rockSite?.root, rockSite?.fx.root, rockImpact?.root]) r?.removeFromParent();
  rockImpact?.reset();
  if (!base) return;
  resetWorldBodies3D();
  base.root.removeFromParent();
  place = null;
}

// Haki obrazu miejsc ciał świata bazy (skóra kawałków — worldBodies3D): bryła, warstwy, mgła, statyka kawałka.
function attachPirateBaseBodies3D(sites) {
  if (!base || !sites) return;
  for (const site of Object.values(sites)) {
    site.render = {
      building: base,
      root: base.root,
      layers: { bg: LAYER_BG, fg: LAYER_FG },
      hidden: () => fogHidden || _lensOn,
      setSkinned: (piece, on) => base.setChunkSkinned(piece.id, on),
      // statyka kawałka straconego trzymana, dopóki skóra odłamów się piecze (wypiek w workerze — worldBodies3D)
      setHold: (piece, on) => base.setChunkHold(piece.id, on),
      groupOf: (piece) => piece.group,
      rasterCenter: (piece) => piece.rasterCenter()
    };
  }
}

/** Bryła bazy (albo null) — dev, zrzuty. */
export function pirateBase3D() { return base; }

const _state = { alarm: false, berths: null, bays: 0, habitat: 1, disc: 1, fuel: 1, warehouse: 1, tech: 1, drumQ: [1, 1, 1, 1], daylight: 0.3, lampPower: undefined };
const _rockState = { sun: null, at: null, daylight: 0.3 };
const _sunOpts = { sun: null, at: null };

/**
 * Klatka (render(), po stacjach). state: { hidden (mgła wojny: żadna budowla niewidoczna — gra), habitatDead, alarm,
 * berths: [0/1], bays, habitat, disc, fuel, warehouse (0..1 — zasilanie), sun: { x, y }, daylight }.
 */
export function updatePirateBase3D(dt, state = {}) {
  if (!base || !base.root.parent) return;
  applyPirateBaseLens();
  const hidden = !!state.hidden;
  if (hidden !== fogHidden) {
    fogHidden = hidden;
    base.root.visible = !hidden;
    if (rockSite) { rockSite.root.visible = !hidden; rockSite.fx.root.visible = !hidden; }
  }
  // planetoida: teren (zawsze), osada i lina — czas gry także we mgle (kabiny jeżdżą)
  if (rock && rock.root.parent) {
    rock.update(state.sun);
    _rockState.sun = state.sun || null;
    _rockState.at = rockAt;
    _rockState.daylight = state.daylight ?? 0.3;
    rockSite.update(dt, _rockState);
    // uderzenia (teren — także we mgle wojny): czas gry, słońce skały (scena: Słońce − środek, z = 0)
    if (rockImpact) {
      const sun = state.sun;
      rockImpact.update(dt, sun ? Number(sun.x) - rockAt.x : null, sun ? -(Number(sun.y) - rockAt.y) : null);
    }
  }
  if (hidden) return;
  if (state.sun && place) {
    _sunOpts.sun = state.sun;
    _sunOpts.at = place.habitat;
    base.setSun(_sunOpts);
  }
  _state.alarm = !!state.alarm;
  _state.berths = state.berths || null;
  _state.bays = state.bays ? 1 : 0;
  for (const k of ['habitat', 'disc', 'fuel', 'warehouse']) _state[k] = state[k] ?? 1;
  // światła wnętrza (dekompresja): głowa wieży i ćwiartki bębna — bez pól jak habitat
  _state.tech = state.tech ?? _state.habitat;
  for (let q = 0; q < 4; q++) _state.drumQ[q] = state.drumQ ? (state.drumQ[q] ?? _state.habitat) : _state.habitat;
  _state.daylight = state.daylight ?? 0.3;
  const dead = !!state.habitatDead;
  _state.lampPower = dead ? 0.15 : undefined;
  base.update(dt, _state);
  if (place && !dead && !_lensOn) base.pushGridLights(Core3D.fx?.lights, place.toGame);
}
