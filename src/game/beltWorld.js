// src/game/beltWorld.js
//
// ŚWIAT PASA ASTEROID PO STRONIE GRY (RW-25, docs/PLAN-render-worker.md § 2.6 p. 3–5, § 4): wszystko,
// od czego zależy rozgrywka pasa, bez three, DOM i GPU — pole skał (AsteroidBeltField), cień pól
// (FieldSunOcclusion), olbrzymy (BeltGiants + budowa SDF w workerach, siatki w SharedArrayBuffer),
// kolizje statków i pocisków z olbrzymami, strop nad statkiem, fizyka skał w wydobyciu
// (AsteroidMining) i platforma gracza (MiningRig), zegar obrotu skał i zbiór skał przejętych.
//
// Obraz pasa (src/3d/asteroids/asteroidBelt.js) ma WŁASNĄ instancję pola (id i układ skał są
// deterministyczne — ta sama konfiguracja daje te same skały) i dostaje od gry tylko dane:
//   • konfigurację pola — operacje `setExclusions`, `setSmallBodyAnchors`, `familyPeaks`, `addWakeSpot`, `setHoles`
//     (wyrwy po wydobyciu z ruchu v2) idą do pola gry i do subskrybentów w kolejności (`subscribeField` — powtarza
//     historię);
//   • gotowe sektory cienia pól (`exportSectors`, zdarzenie 'occlusion');
//   • wejście klatki: zegar skał `time` (czas bezwzględny — pominięta klatka niczego nie gubi), dt klatki;
//   • siatki SDF olbrzymów (`giants.entries[].giant.grid` — SharedArrayBuffer), zbiór `rig.taken`,
//     ciała wydobycia (`mining.bodies`) — w trybie `inline` czytane wprost, w workerze z migawki (RW-11c).
// Render → gra: jedno zdarzenie `attachShapeRadius` (mapy promienia banku kształtów po pieczeniu na GPU —
// dopiero z nimi powstaje fizyka skał) i potwierdzenie wysłania zmian siatki ciała (`ackMinedUpload` —
// gra zeruje `body.dirtyBox`, render go nie pisze).
//
// Olbrzymy budują się przy punktach uwagi z kamery I statków (`frame` — co klatkę, niezależnie od
// tego, czy kadr dotyka pasa: kolizje z olbrzymem istnieją, zanim kamera do niego podejdzie).

import { AsteroidBeltField, BELT_HOLE_CONFIG } from './asteroidBeltField.js';
import { FieldSunOcclusion, nightKnee } from './asteroidFieldLight.js';
import { BeltGiants } from './asteroidBeltGiants.js';
import { GiantBuilder } from './asteroidGiantBuilder.js';
import { AsteroidMining } from './asteroidMining.js';
import { MiningRig } from './asteroidMiningRig.js';
import { ShapeRadius } from './asteroidShapeRadius.js';
import { beltPlayZ } from './beltPlayZ.js';

export const BELT_WORLD_CONFIG = Object.freeze({
  // Przycięcie cache komórek pola gry na klatkę (platforma wydobywcza, radar, zapytania gry).
  maxCachedCells: 7000,
  // Najdłuższy krok zegara skał na klatkę [s] (jak dawny krok pasa w renderze).
  maxFrameDt: 0.1,
  // Ziarno fizyki skał (asteroidMining.js — determinizm ciał).
  miningSeed: 0x51A7
});

/** Kopia planet do konstrukcji pola (kotwice Lagrange'a i Hildas — zamrożone w chwili startu). */
function snapshotPlanets(planets) {
  const out = [];
  for (const p of planets || []) {
    if (!p) continue;
    out.push({ id: p.id, name: p.name, x: p.x, y: p.y, orbitRadius: p.orbitRadius, orbitAU: p.orbitAU, angle: p.angle });
  }
  return out;
}

export class BeltWorld {
  /**
   * @param {object} o
   * @param {Array} o.planets planety gry (kotwice — zamrożone teraz)
   * @param {{x:number,y:number}} o.sun
   * @param {number} o.auToWorld
   * @param {() => object} [o.createBuilder] fabryka budowy SDF olbrzymów (domyślnie GiantBuilder — workery)
   * @param {object} [o.config] nadpisania BELT_WORLD_CONFIG
   */
  constructor({ planets = [], sun, auToWorld, createBuilder = null, config = null } = {}) {
    this.cfg = { ...BELT_WORLD_CONFIG, ...(config || {}) };
    this.sun = { x: Number(sun?.x) || 0, y: Number(sun?.y) || 0 };
    this.au = auToWorld;
    // Argumenty pola (dane, bez referencji do obiektów gry) — render buduje z nich własną instancję.
    this.fieldArgs = Object.freeze({ planets: snapshotPlanets(planets), sunX: this.sun.x, sunY: this.sun.y, auToWorld });
    this.field = new AsteroidBeltField(this.fieldArgs);
    this.occlusion = new FieldSunOcclusion(this.field);
    this.giants = new BeltGiants({
      field: this.field, sunX: this.sun.x, sunY: this.sun.y, au: auToWorld,
      createBuilder: createBuilder || (() => new GiantBuilder())
    });
    this._fieldOps = [];
    this._fieldSubs = [];
    this._holes = new Map();
    // Koszt przeliczeń cienia pól po wyrwach (setHoles): liczba, ms, kolumny, próbki pola.
    this.lightStats = { updates: 0, ms: 0, lastMs: 0, columns: 0, samples: 0 };
    this._occSubs = [];
    this._miningSubs = [];
    this.setExclusions(this.giants.exclusions());
    this.field.clearCache();
    // Zegar obrotu skał (shader skał i faza skały przejmowanej przez platformę): suma dt klatek gry.
    this.time = 0;
    this.frameDt = 0;
    this.precomputed = false;
    this.playZ = beltPlayZ;
    this.sunT = (x, y) => nightKnee(this.occlusion.transmittance(x, y));
    // Wydobycie — po zdarzeniu `attachShapeRadius` (mapy promienia banku kształtów z renderu).
    this.shapes = null;
    this.mining = null;
    this.rig = null;
  }

  // ── Konfiguracja pola (gra i obraz) ─────────────────────────────────────────

  _fieldOp(op, arg) {
    this._fieldOps.push([op, arg]);
    this._applyFieldOp(this.field, op, arg);
    for (let i = 0; i < this._fieldSubs.length; i++) this._fieldSubs[i](op, arg);
  }

  _applyFieldOp(field, op, arg) {
    if (op === 'exclusions') field.setExclusions(arg);
    else if (op === 'anchors') field.setSmallBodyAnchors(arg);
    else if (op === 'peaks') field.familyPeaks();
    else if (op === 'wake') { if (!field.wakeSpots.includes(arg)) field.wakeSpots.push(arg); }
    else if (op === 'holes') field.setHoles(arg);
  }

  /**
   * Pole skał zgodne z polem gry (render — własna instancja): te same argumenty i operacje konfiguracji,
   * kolejne operacje dochodzą same. Zwraca nowe pole.
   */
  createFieldReplica() {
    const field = new AsteroidBeltField(this.fieldArgs);
    this.subscribeField((op, arg) => this._applyFieldOp(field, op, arg));
    return field;
  }

  /** Słuchacz operacji konfiguracji pola: (op, arg); dostaje od razu całą dotychczasową historię. */
  subscribeField(fn) {
    for (let i = 0; i < this._fieldOps.length; i++) fn(this._fieldOps[i][0], this._fieldOps[i][1]);
    this._fieldSubs.push(fn);
  }

  /** Obszary bez skał gry (elipsy { x, y, rx, ry }) — olbrzymy, małe ciała, stacje. Czyści cache komórek. */
  setExclusions(list) {
    this._fieldOp('exclusions', (list || []).map((e) => ({ x: e.x, y: e.y, rx: e.rx, ry: e.ry })));
  }

  /** Kotwice rodzin kolizyjnych (Westa, Hygiea): [{ id, x, y }] — AsteroidBeltField.setSmallBodyAnchors. */
  setSmallBodyAnchors(list) {
    const copy = Array.isArray(list)
      ? list.filter(Boolean).map((b) => ({ id: b.id, x: b.x, y: b.y }))
      : list;
    this._fieldOp('anchors', copy);
  }

  /** Lista szczytów pól rodzin (~20 ms) — teraz, nie w klatce pierwszego wlotu w pas. */
  familyPeaks() {
    this._fieldOp('peaks', null);
  }

  /**
   * Koło budzenia pasa `{ x, y, r, active }` (przelot NEA) — obiekt gry, który gra przesuwa; pole gry
   * (radar) i obrazu widzą go w `rectTouchesBelt`.
   */
  addWakeSpot(spot) {
    if (spot) this._fieldOp('wake', spot);
  }

  /**
   * Wyrwy po wydobyciu (E3): zmiany `[{ id, x, y, r, depth }]` z rejestru uszczuplenia świata ruchu (most ruchu v2,
   * zdarzenie `belt-holes`); depth 0 usuwa. Idą do pola gry i do obrazu (`AsteroidBeltField.setHoles` — skały pasm
   * gry i tła przerzedzone, komórki przeładowane). Historia operacji trzyma jeden wpis z pełnym stanem wyrw.
   */
  setHoles(list) {
    if (!Array.isArray(list) || list.length === 0) return;
    const copy = [];
    for (const h of list) {
      if (!h || h.id == null) continue;
      const hole = { id: String(h.id), x: Number(h.x), y: Number(h.y), r: Number(h.r), depth: Number(h.depth) || 0 };
      copy.push(hole);
      if (hole.depth > 0) this._holes.set(hole.id, hole);
      else this._holes.delete(hole.id);
    }
    if (!copy.length) return;
    const version = this.field.holeVersion;
    this._applyFieldOp(this.field, 'holes', copy);
    // Cień pól w wyrwie (mniej pyłu = więcej słońca w wyrwie i za nią): kolumny siatki przez prostokąt zmian,
    // W MIEJSCU — sektory dzieli obraz (SharedArrayBuffer w workerze, te same tablice w trybie off), więc
    // przeliczenie idzie PRZED operacją dla repliki obrazu: render przeładowuje mgłę i mapę już z nowym cieniem.
    if (this.field.holeVersion !== version) {
      const d = this.field.holeDirty[this.field.holeDirty.length - 1];
      const m = BELT_HOLE_CONFIG.reach;
      const res = this.occlusion.recomputeRect(d.x0 + m, d.y0 + m, d.x1 - m, d.y1 - m);
      const L = this.lightStats;
      L.updates++;
      L.ms += res.ms;
      L.lastMs = res.ms;
      L.columns += res.columns;
      L.samples += res.samples;
    }
    for (let i = 0; i < this._fieldSubs.length; i++) this._fieldSubs[i]('holes', copy);
    const full = [...this._holes.values()];
    const at = this._fieldOps.findIndex((e) => e[0] === 'holes');
    if (at >= 0) this._fieldOps[at] = ['holes', full];
    else this._fieldOps.push(['holes', full]);
  }

  // ── Cień pól ────────────────────────────────────────────────────────────────

  /** Cień pól całego układu (ekran ładowania, ~1 s, oddaje wątek); potem zdarzenie 'occlusion'. */
  async precompute(onProgress = null) {
    if (!this.precomputed) {
      await this.occlusion.precomputeAll({ onProgress });
      this.precomputed = true;
      const sectors = this.occlusion.exportSectors();
      for (let i = 0; i < this._occSubs.length; i++) this._occSubs[i](sectors);
    }
    return this;
  }

  /** Słuchacz gotowej siatki cienia pól: (sektory) — od razu, gdy już policzona. */
  onOcclusion(fn) {
    if (this.precomputed) fn(this.occlusion.exportSectors());
    this._occSubs.push(fn);
  }

  sunTransmittance(x, y) {
    return this.occlusion.transmittance(x, y);
  }

  // ── Wydobycie (po pieczeniu banku kształtów) ────────────────────────────────

  /**
   * Mapy promienia banku kształtów skał (render po pieczeniu na GPU — zdarzenie `bankRadius`):
   * `{ maps: Float32Array[], size }`. Raz: tworzy fizykę skał i platformę gracza.
   */
  attachShapeRadius(data) {
    if (this.mining || !data || !data.maps) return this.rig;
    this.shapes = new ShapeRadius(data);
    this.mining = new AsteroidMining({ radiusAt: this.shapes.radiusAt, seed: this.cfg.miningSeed });
    this.rig = new MiningRig({ mining: this.mining, field: this.field, playZ: this.playZ, sunT: this.sunT, timeSource: () => this.time });
    for (let i = 0; i < this._miningSubs.length; i++) this._miningSubs[i](this.rig);
    return this.rig;
  }

  /** Słuchacz gotowej platformy wydobywczej: (rig). */
  onMining(fn) {
    if (this.rig) fn(this.rig);
    this._miningSubs.push(fn);
  }

  /** Render wysłał zmiany siatki ciała skały (stan z `body.version`) — następne zbiera od zera. */
  ackMinedUpload(body) {
    if (body) body.dirtyBox = null;
  }

  // ── Klatka ──────────────────────────────────────────────────────────────────

  /**
   * Klatka gry (render(), przed wejściem klatki obrazu): zegar skał (dt klatki, 0 w pauzie, ≤ 0,1 s),
   * budowa olbrzymów przy punktach uwagi (kamery, statki), przycięcie cache pola gry.
   * @param {number} dt dt klatki
   * @param {boolean} paused
   * @param {Array<{x:number,y:number}|null>} [focus] punkty uwagi (środki kamer, pozycje statków)
   */
  frame(dt, paused, focus = null) {
    const step = paused ? 0 : Math.max(0, Math.min(this.cfg.maxFrameDt, Number(dt) || 0));
    this.time += step;
    this.frameDt = step;
    if (focus) {
      for (let i = 0; i < focus.length; i++) {
        const p = focus[i];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) this.giants.requestNear(p.x, p.y);
      }
    }
    this.field.endFrame(this.cfg.maxCachedCells);
  }

  // ── Rozgrywka ───────────────────────────────────────────────────────────────

  /** Kolizja statku z olbrzymami (body: pos, vel, angle, w, h, radius). Zwraca głębokość wbicia. */
  collideShip(body) {
    return this.giants.collideShip(body);
  }

  /** Czy punkt płaszczyzny gry leży w skale olbrzyma (pociski). */
  pointBlocked(x, y) {
    return this.giants.pointBlocked(x, y);
  }

  /** Czy nad punktem płaszczyzny gry jest strop olbrzyma (profil świateł jaskini). */
  roofAbove(x, y) {
    return this.giants.roofAbove(x, y);
  }
}

let _world = null;

/** Świat pasa gry (singleton, tworzony przy starcie świata — index.html). */
export function createBeltWorld(opts) {
  if (!_world) _world = new BeltWorld(opts);
  return _world;
}

export function getBeltWorld() {
  return _world;
}
