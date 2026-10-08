// Suchy dok piratów w grze (misja 1, budynek stoczni) — klej renderu: bryła PirateDryDock3D
// (src/3d/portBuildings/) w Core3D.scene, warstwy BG 1 / FG 2 jak hale K-7.
//
//  - Bryła powstaje na EKRANIE ŁADOWANIA (rejestr Core3D.warmup, faza 'loading'): materiały budowli Z7
//    (instancje BG / FG / dach, płyty, napisy, kadłuby w budowie) i drugi stan dachu (zanik — przezroczysty,
//    bez zapisu głębi) kompilują się przed grą; misja tylko ustawia ramkę i podpina korzeń do sceny.
//  - Ramka = miejsce doku z planu misji (shipyardLayout.placeDryDock): portModuleFrame(O.x, −O.y, kąt) w scenie
//    (duży offset w macierzy korzenia — three składa modelViewMatrix w double; dane instancji małe).
//  - Mgła wojny: dok nierozpoznany przez gracza schowany (predykat gry, jak stacja piracka world3d.js).
//  - Reflektory parkingu i światła pochylni (layout.lights) świecą też w SIATCE ŚWIATEŁ gry
//    (Core3D.fx.lights.point co klatkę) — kadłuby okrętów na parkingu i w hali są nimi oświetlone; maszt
//    odpadłego kawałka gaśnie.
//  - Zniszczenie (F2 docs/PLAN-zniszczenia-swiata-3d.md, 2026-10-05): kawałek w BAŃCE gracza jest CIAŁEM silnika
//    belek (attachPirateDryDockBodies → src/game/worldBodies.js, raster i kotwice: pirateDryDockBodies.js) — taran
//    to zderzenie kadłubów, broń niszczy przez solver, rysuje go skóra (src/3d/worldBodies3D.js; statyczna grupa
//    schowana, gdy kawałek ruszony). Poza bańką — statyka jak dawniej: kawałki odpadają (macierz grupy) —
//    breakPirateDryDockChunk, staranowana brama / ogrodzenie wylatuje — ramPirateDryDockChunk. Zbiór kawałków,
//    których nie ma jako statyki (odpadłe, schowane, żywe ciała — entity._dockGone), pomijają bryły trafień
//    pocisków, wiązek, Hexlance'a i taran statyczny.
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { PirateDryDock3D } from './portBuildings/pirateDryDock3D.js';
import { createPirateDryDockLayout } from './portBuildings/pirateDryDockLayout.js';
import { portModuleFrame } from './portBuildings/portModuleTraffic.js';
import { buildingSkinWarmGeometry } from './portBuildings/portBuildingSkin3D.js';
import { worldBodies } from '../game/worldBodies.js';
import { createPirateDryDockSite, prebuildPirateDryDockBodies } from '../game/story/pirateDryDockBodies.js';
import { resetWorldBodies3D } from './worldBodies3D.js';

const LAYER_BG = 1;
const LAYER_FG = 2;

let prebuilt = null;
let dock = null;
let station = null;
let place = null;
let hiddenTest = null;
let fogHidden = false;
// kawałki, których nie ma na miejscu (odpadły, staranowane, schowane) — wspólny zbiór (bez alokacji na klatkę)
const gone = new Set();

function build() {
  const d = new PirateDryDock3D({ layout: createPirateDryDockLayout(), frame: portModuleFrame(0, 0, 0), name: 'Suchy dok piratów' });
  d.setLayers(LAYER_BG, LAYER_FG);
  d.root.userData.fgCategory = 'stations';
  return d;
}

// Gotowa (niepodpięta) bryła na ekranie ładowania — raz. Razem z nią rastry kawałków i szablony kratownic ciał
// świata (~0,3 s CPU): kawałek wchodzący w bańkę gracza staje się ciałem w 1–3 ms zamiast 15–45 (przestoje kroku).
let bodiesPrebuilt = false;
function ensurePrebuilt() {
  if (dock) return null;
  if (!prebuilt && Core3D.scene) prebuilt = build();
  if (prebuilt && !bodiesPrebuilt) {
    bodiesPrebuilt = true;
    try { prebuildPirateDryDockBodies(prebuilt.layout, prebuilt.scene, prebuilt.style?.palette || null); }
    catch (err) { console.warn('[Suchy dok] kratownice ciał:', err?.message || err); }
  }
  return prebuilt;
}

Core3D.warmup?.add({ name: 'suchy dok piratów: bryła', objects: () => ensurePrebuilt()?.root || null, phase: 'loading' });
// Skóra ciał świata (kawałek doku w bańce gracza jako ciało silnika belek — worldBodies3D.js): ten sam graf
// budowli w wariancie „skin”, zestawy BG / FG na swoich warstwach (kamera perspektywy jak bryła).
let _skinHolders = null;
function skinWarmHolders() {
  const d = prebuilt || dock;
  if (!d) return null;
  if (_skinHolders && _skinHolders.dock === d) return _skinHolders.root;
  const root = new THREE.Group();
  // bez indeksu — kawałek; z indeksem — odłam (podzbiór trójkątów kawałka, worldBodies3D.js)
  for (const [set, layer] of [['bg', LAYER_BG], ['fg', LAYER_FG]]) {
    for (const indexed of [false, true]) {
      const m = new THREE.Mesh(buildingSkinWarmGeometry(indexed), d.skinMaterial(set));
      m.frustumCulled = false;
      m.layers.set(layer);
      root.add(m);
    }
  }
  _skinHolders = { dock: d, root };
  return root;
}
Core3D.warmup?.add({ name: 'suchy dok piratów: skóra ciał', objects: () => (ensurePrebuilt(), skinWarmHolders()), layer: 'all', phase: 'loading' });
Core3D.warmup?.add({
  name: 'suchy dok piratów: dach (zanik)',
  objects: () => ensurePrebuilt()?.roofWarmVariant().meshes || null,
  variant: { apply: (mesh) => (prebuilt || dock)?.roofWarmVariant().apply(mesh) || null },
  phase: 'loading'
});

/** Predykat mgły wojny (gra): (byt stacji) → true = dok schowany. */
export function setPirateDryDockHiddenTest(fn) {
  hiddenTest = typeof fn === 'function' ? fn : null;
}

/**
 * Podpina dok w miejscu z planu misji. entity — byt stacji (HP, bryły trafień), dockPlace — placeDryDock(…).
 */
export function attachPirateDryDock3D(entity, dockPlace) {
  if (!Core3D.scene || !dockPlace) return null;
  if (!dock) {
    dock = prebuilt || build();
    prebuilt = null;
  }
  station = entity || null;
  place = dockPlace;
  dock.setFrame(portModuleFrame(dockPlace.origin.x, -dockPlace.origin.y, dockPlace.frameAngle));
  dock.resetChunks();
  gone.clear();
  dock.update(0, { alarm: false, roofFade: 0, launch: [0, 0, 0], gates: [0, 0, 0] });
  if (dock.root.parent !== Core3D.scene) Core3D.scene.add(dock.root);
  dock.root.visible = true;
  fogHidden = false;
  if (entity) {
    entity._dock3d = dock;
    entity._dockGone = gone;
  }
  return dock;
}

export function detachPirateDryDock3D() {
  if (!dock) return;
  detachPirateDryDockBodies();
  dock.root.removeFromParent();
  if (station?._dock3d === dock) station._dock3d = null;
  station = null;
  place = null;
  gone.clear();
}

// Kawałki, które są teraz CIAŁAMI silnika belek (bańka gracza): ich statyczne bryły trafień nie działają — pociski,
// wiązki, Hexlance i taran trafiają ciało (worldBodies.js).
const live = new Set();
let site = null;

/**
 * Kawałki doku jako ciała świata (docs/PLAN-zniszczenia-swiata-3d.md F2): miejsce worldBodies z rastrami kawałków,
 * kotwicami i materiałami (src/game/story/pirateDryDockBodies.js) i dostawca skóry (src/3d/worldBodies3D.js).
 * Wołać po attachPirateDryDock3D. Zwraca miejsce.
 */
export function attachPirateDryDockBodies(entity, dockPlace) {
  if (!dock || !dockPlace) return null;
  detachPirateDryDockBodies();
  site = createPirateDryDockSite(entity, dock, dockPlace, {
    onLive: (piece, on) => { if (on) live.add(piece.id); else live.delete(piece.id); },
    // nic z kawałka nie zostało w miejscu (odpadł, odparował) — statyka schowana na stałe, maszt gaśnie
    onLost: (piece) => { live.delete(piece.id); dock.hideChunk(piece.id); }
  });
  // piraci znają swój dok: ich okręty (eskorta z hali, parking) przelatują przez ciała doku jak dawniej przez bryłę
  site.passes = (e) => !!e?.isPirate;
  site.render = {
    building: dock,
    root: dock.root,
    layers: { bg: LAYER_BG, fg: LAYER_FG },
    hidden: () => fogHidden,
    setSkinned: (piece, on) => dock.setChunkSkinned(piece.id, on),
    groupOf: (piece) => piece.group,
    rasterCenter: (piece) => piece.rasterCenter()
  };
  worldBodies.addSite(site);
  if (entity) entity._worldSite = site.id;
  return site;
}

export function detachPirateDryDockBodies() {
  if (site) {
    worldBodies.removeSite(site.id);
    if (site.owner && site.owner._worldSite === site.id) site.owner._worldSite = null;
  }
  site = null;
  live.clear();
  resetWorldBodies3D();
}

/** Miejsce ciał doku (worldBodies) albo null. */
export function pirateDryDockSite() { return site; }

function syncGone() {
  gone.clear();
  for (const s of dock.chunkState) {
    if (s.broken || s.hidden || live.has(s.id)) gone.add(s.id);
  }
}


/** Bryła doku (albo null) — dev, zrzuty. */
export function pirateDryDock3D() { return dock; }

/**
 * Klatka (render(), po stacjach): stan z misji i gry.
 * state: { alarm, alarmAge, berths: [0/1], sun: { x, y }, daylight } (playerInHall — bez znaczenia: dach nie zanika)
 */
export function updatePirateDryDock3D(dt, state = {}) {
  if (!dock || !dock.root.parent) return;
  const hidden = !!(hiddenTest && station && hiddenTest(station));
  if (hidden !== fogHidden) {
    fogHidden = hidden;
    dock.root.visible = !hidden;
  }
  if (hidden) return;
  if (state.sun && place) {
    _sunOpts.sun = state.sun;
    _sunOpts.at = place.toGame(0, (place.layout.bounds.z0 + place.layout.bounds.z1) / 2, _at);
    dock.setSun(_sunOpts);
  }
  const alarm = !!state.alarm;
  const age = Number(state.alarmAge) || 0;
  // wylot eskorty po alarmie (~10 s): pasy świateł bram
  const launching = alarm && age < 12;
  _state.alarm = alarm;
  // Dach zostaje (decyzja użytkownika 2026-10-07: „w pirackim nie powinien znikać — widzieć go normalnie”); dawniej
  // zanikał jak dach K-7 — gracz w hali albo wylot eskorty po alarmie.
  _state.roofFade = 0;
  _state.launch = launching ? _on : _off;
  _state.gates = alarm ? _on : _off;
  _state.berths = state.berths || null;
  _state.slipsHidden = state.slipsHidden || null;
  _state.daylight = state.daylight ?? 0.3;
  // zniszczony dok: bez zasilania — lampy budowli prawie zgasłe, reflektory i światła hali w siatce zgaszone
  const dead = !!(station && (station._destroyed3D || !(station.hp > 0)));
  _state.lampPower = dead ? 0.1 : undefined;
  dock.update(dt, _state);
  syncGone();
  // reflektory i światła hali w siatce świateł gry (kadłuby okrętów na parkingu i w hali)
  if (place && !dead) dock.pushGridLights(Core3D.fx?.lights, place.toGame);
}
const _state = { alarm: false, roofFade: 0, launch: null, gates: null, berths: null, slipsHidden: null, daylight: 0.3, lampPower: undefined };
const _sunOpts = { sun: null, at: null };
const _at = { x: 0, y: 0 };
const _on = Object.freeze([1, 1, 1]);
const _off = Object.freeze([0, 0, 0]);

/** Kawałek odpada (macierz grupy: dryf i obrót, potem znika). */
export function breakPirateDryDockChunk(id, opts) {
  if (!dock || !dock.breakChunk(id, opts)) return false;
  gone.add(id);
  return true;
}

/**
 * Staranowany kawałek (brama, ogrodzenie, pylon) wylatuje w kierunku taranu: (dirX, dirY) — kierunek ruchu
 * taranującego w GRZE, speed — jego prędkość [j/s].
 */
const _dh = { x: 0, z: 0 };
export function ramPirateDryDockChunk(id, dirX, dirY, speed) {
  if (!dock || !place) return false;
  place.dirToHub(dirX, dirY, _dh);
  if (!dock.ramChunk(id, _dh, speed)) return false;
  gone.add(id);
  return true;
}

/** Kawałki już odpadłe albo schowane. */
export function pirateDryDockBrokenChunks() {
  return dock ? dock.chunkState.filter((s) => s.broken || s.hidden).map((s) => s.id) : [];
}
