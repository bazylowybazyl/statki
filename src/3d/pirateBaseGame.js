// Baza piratów w grze (misja 1; szkic użytkownika z 2026-10-11, zastępuje suchy dok) — klej renderu: bryła PirateBase3D
// (src/3d/portBuildings/) w Core3D.scene, warstwy BG 1 / FG 2 jak hale K-7.
//
//  - Bryła powstaje na EKRANIE ŁADOWANIA (rejestr Core3D.warmup, faza 'loading'); misja tylko ustawia ramkę.
//  - Ramka = miejsce bazy z planu misji (pirateBaseSite.placePirateBase): portModuleFrame(O.x, −O.y, kąt).
//  - Mgła wojny: baza schowana, dopóki strona gracza nie zobaczy żadnej z jej budowli.
//  - Maszty (layout.lights) świecą też w SIATCE ŚWIATEŁ gry (Core3D.fx.lights.point co klatkę).
//  - Budowle (byty stacji: habitat, paliwo, magazyn, pomosty) mają osobne miejsca CIAŁ ŚWIATA
//    (src/game/story/pirateBaseBodies.js → worldBodies): kawałek w bańce gracza jest ciałem silnika belek (taran,
//    broń przez solver), rysuje go skóra (src/3d/worldBodies3D.js). Poza bańką — statyka; kawałki, których nie ma
//    jako statyki (odpadłe, schowane, żywe ciała — `_dockGone`, wspólny zbiór), pomijają bryły trafień.
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { PirateBase3D } from './portBuildings/pirateBase3D.js';
import { createPirateBaseLayout } from './portBuildings/pirateBaseLayout.js';
import { portModuleFrame } from './portBuildings/portModuleTraffic.js';
import { buildingSkinWarmGeometry } from './portBuildings/portBuildingSkin3D.js';
import { worldBodies } from '../game/worldBodies.js';
import { createPirateBaseSites, prebuildPirateBaseBodies } from '../game/story/pirateBaseBodies.js';
import { resetWorldBodies3D } from './worldBodies3D.js';

const LAYER_BG = 1;
const LAYER_FG = 2;

let prebuilt = null;
let base = null;
let structures = null;
let place = null;
let hiddenTest = null;
let fogHidden = false;
const gone = new Set();

function build() {
  const d = new PirateBase3D({ layout: createPirateBaseLayout(), frame: portModuleFrame(0, 0, 0), name: 'Baza piratów' });
  d.setLayers(LAYER_BG, LAYER_FG);
  d.root.userData.fgCategory = 'stations';
  return d;
}

let bodiesPrebuilt = false;
function ensurePrebuilt() {
  if (base) return base;
  if (!prebuilt && Core3D.scene) prebuilt = build();
  if (prebuilt && !bodiesPrebuilt) {
    bodiesPrebuilt = true;
    try { prebuildPirateBaseBodies(prebuilt.layout, prebuilt.scene, prebuilt.style?.palette || null); }
    catch (err) { console.warn('[Baza piratów] kratownice ciał:', err?.message || err); }
  }
  return prebuilt;
}

Core3D.warmup?.add({ name: 'baza piratów: bryła', objects: () => ensurePrebuilt()?.root || null, phase: 'loading' });
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
  _skinHolders = { base: d, root };
  return root;
}
Core3D.warmup?.add({ name: 'baza piratów: skóra ciał', objects: () => (ensurePrebuilt(), skinWarmHolders()), layer: 'all', phase: 'loading' });

/** Predykat mgły wojny (gra): (byt stacji) → true = budowla schowana. Baza widoczna, gdy widać którąkolwiek. */
export function setPirateBaseHiddenTest(fn) {
  hiddenTest = typeof fn === 'function' ? fn : null;
}

/** Podpina bazę w miejscu z planu misji. owners — { habitat, fuel, warehouse, piers } (byty stacji). */
export function attachPirateBase3D(owners, basePlace) {
  if (!Core3D.scene || !basePlace) return null;
  if (!base) {
    base = prebuilt || build();
    prebuilt = null;
  }
  structures = owners || null;
  place = basePlace;
  base.setFrame(portModuleFrame(basePlace.origin.x, -basePlace.origin.y, basePlace.frameAngle));
  base.resetChunks();
  gone.clear();
  base.update(0, { alarm: false, habitat: 1, disc: 1, fuel: 1, warehouse: 1, bays: 0 });
  if (base.root.parent !== Core3D.scene) Core3D.scene.add(base.root);
  base.root.visible = true;
  fogHidden = false;
  for (const st of Object.values(owners || {})) {
    if (!st) continue;
    st._base3d = base;
    st._dockGone = gone;
  }
  return base;
}

export function detachPirateBase3D() {
  if (!base) return;
  detachPirateBaseBodies();
  base.root.removeFromParent();
  for (const st of Object.values(structures || {})) if (st && st._base3d === base) st._base3d = null;
  structures = null;
  place = null;
  gone.clear();
}

const live = new Set();
let sites = null;

/** Kawałki bazy jako ciała świata — miejsce na budowlę. Wołać po attachPirateBase3D. Zwraca { habitat, … }. */
export function attachPirateBaseBodies(owners, basePlace) {
  if (!base || !basePlace) return null;
  detachPirateBaseBodies();
  sites = createPirateBaseSites(owners, base, basePlace, {
    onLive: (piece, on) => { if (on) live.add(piece.id); else live.delete(piece.id); },
    onLost: (piece) => { live.delete(piece.id); base.hideChunk(piece.id); }
  });
  for (const site of Object.values(sites)) {
    // piraci znają swoją bazę: ich okręty przelatują przez ciała bazy
    site.passes = (e) => !!e?.isPirate;
    site.render = {
      building: base,
      root: base.root,
      layers: { bg: LAYER_BG, fg: LAYER_FG },
      hidden: () => fogHidden,
      setSkinned: (piece, on) => base.setChunkSkinned(piece.id, on),
      groupOf: (piece) => piece.group,
      rasterCenter: (piece) => piece.rasterCenter()
    };
    worldBodies.addSite(site);
    if (site.owner) site.owner._worldSite = site.id;
  }
  return sites;
}

export function detachPirateBaseBodies() {
  if (sites) {
    for (const site of Object.values(sites)) {
      worldBodies.removeSite(site.id);
      if (site.owner && site.owner._worldSite === site.id) site.owner._worldSite = null;
    }
  }
  sites = null;
  live.clear();
  resetWorldBodies3D();
}

/** Miejsca ciał bazy ({ habitat, fuel, warehouse, piers }) albo null. */
export function pirateBaseSites() { return sites; }
/** Bryła bazy (albo null) — dev, zrzuty. */
export function pirateBase3D() { return base; }

function syncGone() {
  gone.clear();
  for (const s of base.chunkState) if (s.broken || s.hidden || live.has(s.id)) gone.add(s.id);
}

const _state = { alarm: false, berths: null, bays: 0, habitat: 1, disc: 1, fuel: 1, warehouse: 1, daylight: 0.3, lampPower: undefined };
const _sunOpts = { sun: null, at: null };

/**
 * Klatka (render(), po stacjach). state: { alarm, berths: [0/1], bays, habitat, disc, fuel, warehouse (0..1 — zasilanie),
 * sun: { x, y }, daylight }.
 */
export function updatePirateBase3D(dt, state = {}) {
  if (!base || !base.root.parent) return;
  let hidden = false;
  if (hiddenTest && structures) {
    hidden = true;
    for (const st of Object.values(structures)) if (st && !hiddenTest(st)) { hidden = false; break; }
  }
  if (hidden !== fogHidden) {
    fogHidden = hidden;
    base.root.visible = !hidden;
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
  _state.daylight = state.daylight ?? 0.3;
  const dead = !!(structures?.habitat && !(structures.habitat.hp > 0));
  _state.lampPower = dead ? 0.15 : undefined;
  base.update(dt, _state);
  syncGone();
  if (place && !dead) base.pushGridLights(Core3D.fx?.lights, place.toGame);
}

/** Kawałek odpada (macierz grupy: dryf i obrót, potem znika). */
export function breakPirateBaseChunk(id, opts) {
  if (!base || !base.breakChunk(id, opts)) return false;
  gone.add(id);
  return true;
}

const _dh = { x: 0, z: 0 };
/** Staranowany lekki kawałek wylatuje w kierunku taranu ((dirX, dirY) — kierunek w GRZE). */
export function ramPirateBaseChunk(id, dirX, dirY, speed) {
  if (!base || !place) return false;
  place.dirToHub(dirX, dirY, _dh);
  if (!base.ramChunk(id, _dh, speed)) return false;
  gone.add(id);
  return true;
}

/** Kawałki już odpadłe albo schowane. */
export function pirateBaseBrokenChunks() {
  return base ? base.chunkState.filter((s) => s.broken || s.hidden).map((s) => s.id) : [];
}
