// src/game/story/pirateBaseWorld.js
//
// BAZA PIRATÓW PO STRONIE GRY (RW-24, docs/PLAN-render-worker.md § 2.6 p. 19–21): wszystko, od czego zależy
// rozgrywka bazy misji 1, bez three, DOM i GPU — dane bazy (układ, scena brył, styl: te same czyste moduły co
// bryła renderu), STAN KAWAŁKÓW (pęknięty / schowany / ciało świata) i zbiór kawałków nieobecnych jako statyka
// (`_dockGone` budowli — bryły trafień pocisków, wiązek, Hexlance'a, taran, radar, przeszkody gazu), ciała świata
// budowli (worldBodies — kratownice z danych, prebuild na ekranie ładowania bez Core3D.scene), środek planetoidy
// pod bazą (radar, CIC).
//
// Obraz bazy (src/3d/pirateBaseGame.js — PirateBase3D, planetoida, osada z windą) dostaje ZDARZENIA (w workerze
// rekordy PBASE_* / ROCK_COLLAPSE): 'attach' (budowle, ramka), 'bodies' (miejsca ciał — obraz dopina do nich swoje
// haki skóry), 'break' / 'ram' (kawałek odpada: dryf, obrót, zniknięcie — sam obraz), 'hide' (kawałek zabrało ciało
// świata), 'rockCollapse', 'detach'. Decyzja (czy kawałek pęka) zapada tu, z tego samego stanu co dawniej w obrazie:
// kawałek pęknięty albo schowany nie pęka drugi raz. Dryf odpadłego kawałka i jego zniknięcie po `life` s to obraz
// (kawałek pęknięty jest nieobecny od chwili pęknięcia).

import { createPirateBaseLayout } from '../../3d/portBuildings/pirateBaseLayout.js';
import { buildPirateBaseScene } from '../../3d/portBuildings/pirateBaseScene.js';
import { resolvePortBuildingStyle } from '../../3d/portBuildings/portBuildingStyle.js';
import { createPirateRockLayout } from '../../3d/portBuildings/pirateRockLayout.js';
import { worldBodies } from '../worldBodies.js';
import { createPirateBaseSites, prebuildPirateBaseBodies } from './pirateBaseBodies.js';

let data = null;
let bodiesPrebuilt = false;

/** Dane bazy (raz): { layout, scene, style } — czysty układ i scena brył (te same co bryła renderu). */
export function pirateBaseData() {
  if (!data) {
    const layout = createPirateBaseLayout();
    const style = resolvePortBuildingStyle('pirate');
    data = { layout, style, scene: buildPirateBaseScene(layout, style) };
  }
  return data;
}

/** Ekran ładowania: rastry kawałków i szablony kratownic ciał świata (bez Core3D). Zwraca liczbę kawałków. */
export function prebuildPirateBaseWorld() {
  const d = pirateBaseData();
  if (bodiesPrebuilt) return 0;
  bodiesPrebuilt = true;
  try {
    return prebuildPirateBaseBodies(d.layout, d.scene, d.style?.palette || null);
  } catch (err) {
    console.warn('[Baza piratów] kratownice ciał:', err?.message || err);
    return 0;
  }
}

// ---- stan kawałków

const chunkState = [];
const chunkById = new Map();
const gone = new Set();
const live = new Set();
let structures = null;
let place = null;
let sites = null;
const listeners = [];

function ensureChunks() {
  if (chunkState.length) return;
  const { layout } = pirateBaseData();
  for (const c of layout.chunks) {
    const s = { id: c.id, group: c.group, kind: c.kind, structure: c.structure, broken: false, hidden: false };
    chunkState.push(s);
    chunkById.set(c.id, s);
  }
}

function emit(type, a, b, c) {
  for (let i = 0; i < listeners.length; i++) listeners[i](type, a, b, c);
}

/**
 * Słuchacz zdarzeń bazy dla obrazu: (type, …): 'attach' (owners, place), 'bodies' (sites), 'break' (id, opts),
 * 'ram' (id, dirHub { x, z }, speed), 'hide' (id), 'rockCollapse', 'detach'. Zwraca funkcję wypisania.
 */
export function onPirateBaseEvent(fn) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

/** Stan kawałków bazy dla ciał świata (`createPirateBaseSites` — layout, scene, style, isChunkGone). */
const baseModel = {
  get layout() { return pirateBaseData().layout; },
  get scene() { return pirateBaseData().scene; },
  get style() { return pirateBaseData().style; },
  isChunkGone: (id) => pirateBaseChunkGone(id)
};

/** Baza w miejscu z planu misji. owners — { habitat, fuel, warehouse, piers } (byty stacji). Zwraca stan bazy. */
export function attachPirateBaseWorld(owners, basePlace) {
  if (!basePlace) return null;
  ensureChunks();
  structures = owners || null;
  place = basePlace;
  for (const s of chunkState) { s.broken = false; s.hidden = false; }
  gone.clear();
  live.clear();
  for (const st of Object.values(owners || {})) if (st) st._dockGone = gone;
  emit('attach', owners, basePlace);
  return baseModel;
}

/** Kawałki bazy jako ciała świata — miejsce na budowlę. Wołać po attachPirateBaseWorld. Zwraca { habitat, … }. */
export function attachPirateBaseBodies(owners, basePlace) {
  if (!place || !basePlace) return null;
  detachPirateBaseBodies();
  sites = createPirateBaseSites(owners, baseModel, basePlace, {
    onLive: (piece, on) => { if (on) live.add(piece.id); else live.delete(piece.id); },
    onLost: (piece) => { live.delete(piece.id); hidePirateBaseChunk(piece.id); }
  });
  for (const site of Object.values(sites)) {
    // piraci znają swoją bazę: ich okręty przelatują przez ciała bazy
    site.passes = (e) => !!e?.isPirate;
    worldBodies.addSite(site);
    if (site.owner) site.owner._worldSite = site.id;
  }
  emit('bodies', sites);
  return sites;
}

export function detachPirateBaseBodies() {
  if (sites) {
    for (const site of Object.values(sites)) {
      worldBodies.removeSite(site.id);
      if (site.owner && site.owner._worldSite === site.id) site.owner._worldSite = null;
    }
    emit('bodiesDetach', sites);
  }
  sites = null;
  live.clear();
}

export function detachPirateBaseWorld() {
  if (!place) return;
  detachPirateBaseBodies();
  structures = null;
  place = null;
  gone.clear();
  emit('detach');
}

/** Miejsca ciał bazy ({ habitat, fuel, warehouse, piers }) albo null. */
export function pirateBaseSites() { return sites; }
/** Budowle bazy (byty stacji) i miejsce z planu misji — null bez bazy. */
export function pirateBaseStructures() { return structures; }
export function pirateBasePlace() { return place; }

/**
 * Zbiór kawałków nieobecnych jako statyka (`_dockGone` budowli): pęknięte, schowane i żywe ciała świata — po kroku
 * ciał świata (physicsStep), także we mgle wojny.
 */
export function syncPirateBaseGone() {
  if (!place) return;
  gone.clear();
  for (let i = 0; i < chunkState.length; i++) {
    const s = chunkState[i];
    if (s.broken || s.hidden || live.has(s.id)) gone.add(s.id);
  }
}

/** Kawałek odpada (obraz: dryf i obrót, potem znika). opts { delay, speed, spin, life, dir: { x, z } (układ bazy), lift }. */
export function breakPirateBaseChunk(id, opts) {
  const s = place ? chunkById.get(id) : null;
  if (!s || s.broken || s.hidden) return false;
  s.broken = true;
  gone.add(id);
  emit('break', id, opts);
  return true;
}

const _dh = { x: 0, z: 0 };
/** Staranowany lekki kawałek wylatuje w kierunku taranu ((dirX, dirY) — kierunek w GRZE). */
export function ramPirateBaseChunk(id, dirX, dirY, speed) {
  const s = place ? chunkById.get(id) : null;
  if (!s || s.broken || s.hidden) return false;
  place.dirToHub(dirX, dirY, _dh);
  s.broken = true;
  gone.add(id);
  emit('ram', id, _dh, speed);
  return true;
}

/** Kawałek zabrało ciało świata (straty — onLost): statyka bazy go nie rysuje i nie trafia. */
export function hidePirateBaseChunk(id) {
  const s = chunkById.get(id);
  if (!s) return false;
  s.hidden = true;
  if (place) gone.add(id);
  emit('hide', id);
  return true;
}

/** Kawałek już odpadł albo jest schowany (bez alokacji — krok fizyki). */
export function pirateBaseChunkGone(id) {
  const s = place ? chunkById.get(id) : null;
  return !!(s && (s.broken || s.hidden));
}

/** Kawałki już odpadłe albo schowane. */
export function pirateBaseBrokenChunks() {
  if (!place) return [];
  const out = [];
  for (const s of chunkState) if (s.broken || s.hidden) out.push(s.id);
  return out;
}

// ---- planetoida pod bazą (Hidalgo)

let rockLayout = null;
const _rockAt = { x: 0, y: 0 };

/**
 * Środek planetoidy pod bazą na radarze i mapie CIC (gra) albo null bez bazy — z układu skały i ramki bazy. Znak mapy to
 * RZUT skały z punktu widzenia (projekt: `layout.design` — promień PIRATE_ROCK_SPEC.radius): skała w świecie jest
 * `scale` razy większa i dalej (pirateRockLayout.js), z kamery wygląda jak projekt — radar i CIC też.
 */
export function pirateRockAt() {
  if (!place || typeof place.toGame !== 'function') return null;
  if (!rockLayout) rockLayout = createPirateRockLayout();
  const c = rockLayout.design.center;
  return place.toGame(c[0], c[2], _rockAt);
}

/** Rozpad habitatu: winda puszcza, osada na planetoidzie wybucha po kolei (scenariusz — sam obraz). */
export function collapsePirateRock() {
  if (!place) return false;
  emit('rockCollapse');
  return true;
}
