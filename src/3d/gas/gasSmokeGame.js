// src/3d/gas/gasSmokeGame.js
//
// DYM I OGIEŃ ZNISZCZEŃ W GRZE — gaz na siatce 3D (gasGrid, compute WebGPU jak Niagara Fluids) jako krok
// klatki efektów Core3D (plan docs/PLAN-zniszczenia-swiata-3d.md § 12). Decyzja użytkownika 2026-10-05:
// do gry na razie BEZ WYBUCHÓW (kule ognia, błyski i iskry gazu czekają na dopracowanie) — tylko dym
// i dogasający ogień po zniszczeniach:
//   • śmierć okrętu (detonacja reaktora — `shipDetonated`, czysty wrak — `shipWrecked`): obłok dymu
//     jadący z wrakiem (domena z nośnikiem = prędkość wraku) i ogniska przypięte do kadłuba wraku,
//   • zniszczenie stacji (`stationDestroyed`) i odpadające fragmenty (`stationHit`): obłok i pożary,
//   • taran i zgniot (CollisionFX `impact`): kurz i dym gniecionego metalu z nośnikiem styku.
// Wybuchy gry zostają po staremu (reactorBlastFx, Destruction3D, broń) — gaz dokłada dym po nich.
//
// Domeny płaskie (gra z góry): 48 × 48 × 24 komórek, 4 naraz, priorytet (stacja > okręt > kurz), nośnik.
// Obraz: bryły domen w passie ortho (warstwa 0) — tył przed kadłubami, przód po nich (gasVolume.js).
// Zegar: SimClock.sim (czas gry — w pauzie dym stoi). Układ: świat gry (x, y) → scena (x, −y), płaszczyzna
// gry z = 0; dane gazu w komórkach domeny — przeskok początku sceny bez przesuwania danych.

import * as THREE from 'three/webgpu';
import { GasGrid } from './gasGrid.js';
import { GasVolume } from './gasVolume.js';
import { GasExplosions } from './gasExplosions.js';
import { gasBlackbodyCpu } from './gasCommon.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { sunVisibility } from '../sunShadowMask.js';
import { SimClock } from '../../game/simClock.js';
import { CollisionFX } from '../../vfx/collisionFx.js';

/** Rozmiar siatki gry (płaskie domeny — kamera z góry). */
export const GAS_SMOKE_GRID = Object.freeze({ N: 48, NZ: 24, slots: 4, jacobi: 15, maxSources: 128, maxObstacles: 16 });

/** Strojenie dymu gry (próg kurzu, rozmiary obłoków względem kadłuba). */
export const GAS_SMOKE_TUNE = {
  enabled: true,
  dustMinSpeed: 120,      // prędkość zbliżenia [j/s], od której taran podnosi kurz
  dustEvery: 0.12,        // najczęściej co tyle [s] kurz z jednego styku
  shipSmoke: 1.0,         // mnożnik dymu po śmierci okrętu
  wreckFireTime: [5, 9],  // czas ognisk na wraku [s]
  stationFireTime: [10, 16],
  lightGain: 1.0          // światło ognisk w siatce świateł (oświetla kadłuby obok)
};

const SUN_ELEV = 30 * Math.PI / 180;
const SINK = 0.3;   // obłok pod płaszczyzną gry [× R]: kadłub na wierzchu, nad nim tylko strzępy
const FIRE_SINK = 0.35;  // płomień ogniska: składowa „za płaszczyznę” kierunku (bok = 1)
const _bb = [0, 0, 0];
const _box = new THREE.Box3();
const _box2 = new THREE.Box3();

const r = () => fxRandom.next();
const rr = (a, b) => a + (b - a) * fxRandom.next();

export class GasSmokeGame {
  /** @param {object} core Core3D (scena, krok efektów, rozgrzewka) */
  constructor(core, opts = {}) {
    this.core = core;
    const cfg = { ...GAS_SMOKE_GRID, ...opts };
    const noise3D = fxNoise.noise3D();
    this.grid = new GasGrid({ ...cfg, noise3D, rng: fxRandom });
    const T = this.grid.tune;
    // Kosmos z góry: bez wyporu (dym nie „wznosi się” ku kamerze), lekkie unoszenie od środka obłoku.
    T.buoyancy = 0;
    T.buoyDir = [0, 0, 1];
    T.radialLift = 1.2;
    T.smokeDecay = 0.16;
    this.volume = new GasVolume({ grid: this.grid, noise3D, curl3D: fxNoise.curl3D() });
    const L = this.volume.look;
    L.stepCells = 0.9;
    L.maxSteps = 72;
    // Gra z góry: dym nie może chować wraku, stacji ani planety za nimi (A/B 2026-10-05: gęstość dema zakrywała
    // wrak w całości) — rzadszy dym, a część nad płaszczyzną gry (zasłania kadłub) jeszcze rzadsza.
    L.density = 0.4;
    L.frontDensity = 0.35;
    this.meshes = this.volume.createMeshes({ layer: 0, renderOrderBack: 1, renderOrderFront: 26, sunVisibility, name: 'GasSmoke' });
    core.scene.add(this.meshes.back, this.meshes.front);
    this.director = new GasExplosions({ grid: this.grid, rng: fxRandom, hooks: {} });
    this.followers = [];
    // Pokolenie domeny: ognisko pilnuje „swojej” domeny — po zabraniu indeksu przez nowe zdarzenie
    // nie może sterować jej nośnikiem ani dosypywać do niej źródeł.
    this._slotGen = new Uint32Array(this.grid.S);
    this._lastSim = null;
    this._dustAt = new WeakMap();
    this.sunDir = new THREE.Vector3(-0.6, 0.5, 0.62).normalize();
    this.stats = { cpuMs: 0, events: 0, dust: 0, fires: 0 };
    const self = this;
    this.step = {
      name: 'dym (gaz 3D)',
      lights: (ctx) => self._lights(ctx),
      update: (ctx) => self._update(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    core.addFxStep(this.step);
    this._onImpact = (ev) => self._impact(ev);
    CollisionFX.on('impact', this._onImpact);
  }

  get enabled() {
    return GAS_SMOKE_TUNE.enabled && this.core?.perfToggles?.gasSmoke !== false;
  }

  // --- zdarzenia gry (świat gry: x, y; prędkości gry) ------------------------------------------

  /**
   * Domena na obłok w (x, y) gry: dokłada się do żywej o podobnym nośniku, inaczej nowa (priorytet). Domena
   * sięga głębiej POD płaszczyznę gry (środek z = −SINK·R): dym kłębi się głównie za kadłubem, który go zasłania.
   */
  _slot(x, y, R, vx, vy, { size, life, priority = 1, tint = null } = {}) {
    const g = this.grid;
    const sx = x, sy = -y, svx = vx, svy = -vy;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active || s.until < g.time) continue;
      // Obłok o promieniu R mieści się w (x, y) domeny (pion — domena płaska, zawsze przez płaszczyznę gry).
      const m = s.h * g.N * 0.5 - R - 2 * s.h;
      if (Math.abs(sx - s.cx) > m || Math.abs(sy - s.cy) > m) continue;
      if (Math.hypot(s.vx - svx, s.vy - svy) > 60) continue;
      s.until = Math.max(s.until, g.time + (life ?? 12));
      if (priority > (s.priority || 0)) s.priority = priority;
      return i;
    }
    // Wolna domena albo zabranie najstarszej o NIŻSZYM lub równym priorytecie.
    let pick = -1;
    for (let i = 0; i < g.S; i++) if (!g.slots[i].active) { pick = i; break; }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < g.S; i++) {
        const s = g.slots[i];
        if ((s.priority || 0) > priority) continue;
        if (s.until < best) { best = s.until; pick = i; }
      }
      if (pick < 0) return -1;
      g.release(pick);
    }
    this._dropSlot(pick);
    const slot = g.acquire(sx, sy, -SINK * R, R, { size: size ?? R * 5, life: life ?? 12, carrier: [svx, svy, 0], tint, reuse: false });
    if (slot >= 0) {
      g.slots[slot].priority = priority;
      if (slot !== pick) this._dropSlot(slot);
      this._slotGen[slot]++;
    }
    return slot;
  }

  /** Domena `i` idzie pod nowe zdarzenie: gasi ogniska i emitery reżysera, które jeszcze do niej sypią. */
  _dropSlot(i) {
    const F = this.followers;
    for (let k = F.length - 1; k >= 0; k--) {
      const f = F[k];
      if (f.slot !== i) continue;
      if (f.emitter.t1 === f.t1) f.emitter.alive = false;
      F.splice(k, 1);
    }
    for (const e of this.director.emitters) if (e.alive && e.slot === i) e.alive = false;
  }

  /** Obłok dymu (bez paliwa — bez kuli ognia): kilka kłębów z rozpychaniem, opcjonalnie żar. */
  _smokeCloud(slot, x, y, R, amount = 1, hot = 0.4) {
    const d = this.director;
    const sx = x, sy = -y;
    // Kłęby nachodzą na siebie (jeden obłok, nie osobne kule): duże promienie, mały rozrzut; środki POD
    // płaszczyzną gry (kadłub nad dymem), rozpychanie wynosi nad nią tylko brzegi.
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const dist = R * rr(0.0, 0.4);
      const px = sx + Math.cos(a) * dist, py = sy + Math.sin(a) * dist;
      d.puff(slot, px, py, -R * rr(0.25, 0.45), R * rr(0.42, 0.65), rr(0, 0.2), rr(0.15, 0.3), 0, R * rr(0.8, 1.6),
        { temp: hot * 2, smoke: 12 * amount, velBlend: 10, noise: 0.6, grow: 1.4 });
    }
  }

  /**
   * Ogniska: przypięte do encji (`kind` 'wreck' — wrak gry, 'station' — stacja; jadą z nią i z jej obrotem)
   * albo w miejscu (`kind` null — np. martwy NPC bez wraku: encja odradza się gdzie indziej). Płomień
   * i dym przez `life` s. Miejsce na bryle: `shape` 'hull' — wzdłuż osi okrętu (dziób = kurs encji, R = pół
   * długości), 'ring' — na obwodzie stacji. Płomień bije NA ZEWNĄTRZ w płaszczyźnie gry (lekko pod nią):
   * z góry widać jęzor i smugę dymu obok kadłuba, nie słup zasłaniający go od kamery.
   */
  _attachFires(slot, entity, x, y, R, count, life, kind, shape = 'hull') {
    const d = this.director;
    const ang = Number(entity?.angle) || 0;
    // (x, y) — środek rozkładu ognisk; w układzie encji względem JEJ pozycji (stacja: rana z boku bryły).
    const ex = entity ? Number(entity.x) || 0 : x, ey = entity ? Number(entity.y) || 0 : y;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const bu = (x - ex) * ca + (y - ey) * sa, bv = -(x - ex) * sa + (y - ey) * ca;
    const cellH = this.grid.slots[slot]?.h || 0;
    for (let i = 0; i < count; i++) {
      let u, v, du, dv;
      if (shape === 'ring') {
        const a = r() * Math.PI * 2;
        const dist = R * rr(0.6, 0.95);
        u = Math.cos(a) * dist; v = Math.sin(a) * dist;
        du = Math.cos(a); dv = Math.sin(a);
      } else {
        u = R * rr(-0.6, 0.6);
        v = R * rr(-0.14, 0.14);
        const side = v >= 0 ? 1 : -1;
        du = (u / R) * 0.6; dv = side;
      }
      const dl = Math.sqrt(du * du + dv * dv) || 1;
      du /= dl; dv /= dl;
      // Płomień ≥ ~1,6 komórki domeny (mniejszy rozmywa się w świecącą kulkę bez jęzorów).
      const fr = Math.max(R * rr(0.08, 0.14), cellH * rr(1.5, 2.0));
      const t = life * rr(0.7, 1.15);
      const f = {
        entity: kind ? entity : null, kind, u: u + bu, v: v + bv, du, dv, lift: fr * 2.5, emitter: null, slot, end: 0, power: fr,
        sx: 0, sy: 0, ux: 0, uy: 0, uz: 0, gen: this._slotGen[slot], t1: 0
      };
      this._placeFire(f, ex, ey, ang);
      // temperatura 2,4–3,2 — pomarańczowe jęzory (3,5 dema bieliło małe ogniska wraków)
      const e = d.fire(slot, f.sx, f.sy, 0, fr, t, {
        up: [f.ux, f.uy, f.uz], lift: f.lift, fuel: rr(2.6, 3.6), temp: rr(2.4, 3.2), smoke: rr(1.6, 2.4), radial: fr * 1.2, delay: rr(0.1, 0.5)
      });
      if (!e) continue;
      f.emitter = e;
      f.t1 = e.t1;   // tożsamość emitera (pula reżysera używa obiektów ponownie)
      f.end = this.director.time + t + 0.6;
      this.followers.push(f);
      this.stats.fires++;
    }
  }

  /** Miejsce i kierunek ogniska `f` (układ encji: u — wzdłuż kursu, v — w bok) przy pozie (x, y, kąt) gry → scena. */
  _placeFire(f, x, y, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const gx = x + f.u * c - f.v * s, gy = y + f.u * s + f.v * c;
    const dx = f.du * c - f.dv * s, dy = f.du * s + f.dv * c;
    // scena: (x, −y); płomień w bok i trochę za płaszczyznę gry (z < 0)
    const k = 1 / Math.sqrt(1 + FIRE_SINK * FIRE_SINK);
    f.sx = gx; f.sy = -gy;
    f.ux = dx * k; f.uy = -dy * k; f.uz = -FIRE_SINK * k;
  }

  /** Detonacja reaktora okrętu (ReactorGame): dym po wybuchu + ogniska na wraku. */
  shipDetonated(ev, res, host) {
    if (!this.enabled || !host) return;
    const R = Math.max(120, (Number(host.radius) || 300) * 1.6) * GAS_SMOKE_TUNE.shipSmoke;
    const vx = Number(host.vx) || 0, vy = Number(host.vy) || 0;
    const x = Number(ev?.x ?? host.x) || 0, y = Number(ev?.y ?? host.y) || 0;
    const slot = this._slot(x, y, R, vx, vy, { size: R * 4.6, life: 14, priority: 2 });
    if (slot < 0) return;
    this.stats.events++;
    this._smokeCloud(slot, x, y, R, 1.3, 0.3);
    const wreck = res?.wreck || null;
    const hullR = (Number(host.radius) || 300) * 0.9;
    // Ogniska wzdłuż osi kadłuba od jego środka (wybuch — w miejscu rdzenia, zwykle poza środkiem).
    const hx = Number(host.x) || x, hy = Number(host.y) || y;
    this._attachFires(slot, wreck || host, hx, hy, hullR, 2 + Math.floor(r() * 2), rr(...GAS_SMOKE_TUNE.wreckFireTime), wreck ? 'wreck' : null);
  }

  /** Śmierć okrętu bez detonacji (czysty wrak): mniej dymu, ogień na wraku. */
  shipWrecked(npc, wreck = null) {
    if (!this.enabled || !npc) return;
    const R = Math.max(90, (Number(npc.radius) || 250) * 1.25) * GAS_SMOKE_TUNE.shipSmoke;
    const vx = Number(npc.vx) || 0, vy = Number(npc.vy) || 0;
    const x = Number(npc.x) || 0, y = Number(npc.y) || 0;
    const slot = this._slot(x, y, R, vx, vy, { size: R * 4.6, life: 12, priority: 2 });
    if (slot < 0) return;
    this.stats.events++;
    this._smokeCloud(slot, x, y, R, 1.0, 0.15);
    const hullR = (Number(npc.radius) || 250) * 0.9;
    this._attachFires(slot, wreck || npc, x, y, hullR, 1 + Math.floor(r() * 2), rr(...GAS_SMOKE_TUNE.wreckFireTime), wreck ? 'wreck' : null);
  }

  /**
   * Promień stacji w płaszczyźnie gry: połowa dłuższego boku pudła WIDOCZNYCH siatek bryły 3D w (x, y) (bez
   * ukrytych — `Box3.setFromObject` liczy wszystko). To zasięg z ramionami (stacja Wenus: ~2200 j., rdzeń ~830 j.),
   * a rozpad zabiera ramiona od razu — ogniska idą na rdzeń (`stationDestroyed`). Bez bryły (poza kadrem) —
   * promień gry × 6,5 (bryła stacji planety ≈ 6,8 koła trafień przy dzisiejszej skali).
   */
  _stationRadius(station) {
    const root = station?._mesh3d;
    if (root) {
      try {
        _box.makeEmpty();
        root.traverseVisible((o) => {
          if (!o.isMesh || !o.geometry) return;
          if (o.isInstancedMesh) {
            if (!o.boundingBox) o.computeBoundingBox();
            _box2.copy(o.boundingBox);
          } else {
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            _box2.copy(o.geometry.boundingBox);
          }
          _box.union(_box2.applyMatrix4(o.matrixWorld));
        });
        if (!_box.isEmpty()) return Math.max(_box.max.x - _box.min.x, _box.max.y - _box.min.y) * 0.5;
      } catch { /* bryła w trakcie rozpadu */ }
    }
    return (Number(station?.r ?? station?.baseR ?? station?.radius) || 300) * 6.5;
  }

  /**
   * Zniszczenie stacji: obłok na miarę bryły i pożary na jej RDZENIU (≤ ~0,45 promienia — ramiona i panele
   * rozpad zabiera od razu, ogień w ich miejscu wisiałby w pustce; stacja Wenus: pierścień rdzenia ≈ 0,38 R).
   */
  stationDestroyed(station) {
    if (!this.enabled || !station) return;
    const Rst = this._stationRadius(station);
    const R = Math.max(200, Rst * 0.42);
    const x = Number(station.x) || 0, y = Number(station.y) || 0;
    const slot = this._slot(x, y, R, Number(station.vx) || 0, Number(station.vy) || 0, { size: R * 4.6, life: 20, priority: 3 });
    if (slot < 0) return;
    this.stats.events++;
    this._smokeCloud(slot, x, y, R, 1.4, 0.3);
    this._attachFires(slot, station, x, y, Rst * 0.45, 4, rr(...GAS_SMOKE_TUNE.stationFireTime), 'station', 'ring');
  }

  /** Oderwany fragment stacji (próg HP): dym i pożar w miejscu rany na rdzeniu bryły. */
  stationHit(station) {
    if (!this.enabled || !station) return;
    const Rst = this._stationRadius(station);
    const R = Math.max(120, Rst * 0.18);
    const a = r() * Math.PI * 2;
    const k = rr(0.25, 0.42);
    const x = (Number(station.x) || 0) + Math.cos(a) * Rst * k;
    const y = (Number(station.y) || 0) + Math.sin(a) * Rst * k;
    const slot = this._slot(x, y, R, Number(station.vx) || 0, Number(station.vy) || 0, { size: R * 5, life: 14, priority: 3 });
    if (slot < 0) return;
    this.stats.events++;
    this._smokeCloud(slot, x, y, R, 0.9, 0.2);
    this._attachFires(slot, station, x, y, R * 0.6, 2, rr(...GAS_SMOKE_TUNE.stationFireTime), 'station', 'ring');
  }

  /** Taran / zgniot (CollisionFX): kurz i dym gniecionego metalu z nośnikiem styku. */
  _impact(ev) {
    if (!this.enabled || !ev) return;
    const v = Number(ev.approachSpeed) || 0;
    if (v < GAS_SMOKE_TUNE.dustMinSpeed || ev.brittle) return;
    const key = ev.A || ev;
    const last = this._dustAt.get(key);
    const now = this.director.time;
    if (last !== undefined && now - last < GAS_SMOKE_TUNE.dustEvery) return;
    this._dustAt.set(key, now);
    const R = Math.min(600, 60 + v * 0.35);
    const slot = this._slot(ev.x, ev.y, R, Number(ev.contactVelX) || 0, Number(ev.contactVelY) || 0, { size: Math.max(R * 6, 1800), life: 9, priority: 1 });
    if (slot < 0) return;
    this.stats.dust++;
    // Kurz wyrzucany wzdłuż normalnej styku (obie strony) i na boki.
    const d = this.director;
    const sx = ev.x, sy = -ev.y;
    const nx = Number(ev.nx) || 0, ny = -(Number(ev.ny) || 0);
    for (let k = -1; k <= 1; k += 2) {
      d.puff(slot, sx + nx * R * 0.2 * k, sy + ny * R * 0.2 * k, 0, R * rr(0.3, 0.45), 0, 0.12, 0, R * rr(1.4, 2.4),
        { temp: 0.2, smoke: 10 + Math.min(16, v * 0.03), velBlend: 16, noise: 0.65, dir: [nx * k * v * 0.3, ny * k * v * 0.3, 0] });
    }
  }

  // --- krok klatki efektów ----------------------------------------------------------------------

  _simDt() {
    const t = Number(SimClock.sim) || 0;
    if (this._lastSim === null) { this._lastSim = t; return 0; }
    const dt = Math.max(0, Math.min(0.1, t - this._lastSim));
    this._lastSim = t;
    return dt;
  }

  _followers(dt) {
    const F = this.followers;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i];
      const e = f.entity;
      // Koniec ogniska, emiter oddany do puli (inny obiekt pod tą referencją) albo domena pod nowym zdarzeniem.
      if (this.director.time > f.end || !f.emitter.alive || f.emitter.t1 !== f.t1 || this._slotGen[f.slot] !== f.gen) {
        if (f.emitter.t1 === f.t1) f.emitter.alive = false;
        F.splice(i, 1);
        continue;
      }
      if (!e) continue;   // ognisko w miejscu
      // Wrak zniknął (przetworzony, rozpadł się, zabrany holem do doku) — ogień gaśnie z nim.
      if (f.kind === 'wreck' && (e.dead === true || (!e.beamHull && !e.hexGrid))) { f.emitter.alive = false; F.splice(i, 1); continue; }
      // ogień jedzie z encją (pozycja i obrót), domena z jej prędkością (scena: y odwrócone)
      this._placeFire(f, Number(e.x) || 0, Number(e.y) || 0, Number(e.angle) || 0);
      const em = f.emitter;
      em.x = f.sx; em.y = f.sy; em.z = 0;
      em.dvx = f.ux * f.lift; em.dvy = f.uy * f.lift; em.dvz = f.uz * f.lift;
      const slot = this.grid.slots[f.slot];
      if (slot?.active) {
        const vx = Number(e.vx), vy = Number(e.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) { slot.vx = vx; slot.vy = -vy; }
      }
    }
  }

  _lights(ctx) {
    if (!this.enabled || !this.followers.length) return;
    const grid = ctx.grid;
    if (!grid?.addWorld) return;
    const t = this.director.time;
    gasBlackbodyCpu(1.25, _bb);
    for (const f of this.followers) {
      const e = f.emitter;
      if (!e.alive || t < e.t0) continue;
      const age = t - e.t0;
      const k = Math.min(1, age / 0.6) * Math.min(1, (e.t1 - t) / 1.5) * (0.8 + 0.2 * Math.sin((e.seed + t) * 9.1));
      if (k <= 0.02) continue;
      const I = 2.2 * k * GAS_SMOKE_TUNE.lightGain;
      // świat gry: emiter trzyma scenę (x, −y)
      grid.addWorld(e.x, -e.y, 30, f.power * 9, _bb[0] * I, _bb[1] * I, _bb[2] * I, 0.4);
    }
  }

  _update(ctx) {
    const t0 = performance.now();
    const on = this.enabled;
    const dt = on ? this._simDt() : 0;
    if (!on) {
      this.meshes.back.visible = false;
      this.meshes.front.visible = false;
      this._lastSim = null;
      return;
    }
    const origin = ctx.origin;
    const g = this.grid;
    g.origin.x = origin.x; g.origin.y = origin.y; g.origin.z = 0;
    this._sun(ctx);
    this._followers(dt);
    this.director.update(dt);
    g.simulate(ctx.renderer, dt);
    this.volume.syncLook();
    this.volume.updateMeshes(origin.x, origin.y, 0);
    this.stats.cpuMs = performance.now() - t0;
  }

  // Słońce: kierunek z pozycji słońca względem kamery, 30° nad płaszczyzną (jak dym rakiet).
  _sun(ctx) {
    const cam = ctx.core?.activeCam1;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    if (sun && cam) {
      const dx = sun.x - (Number(cam.x) || 0);
      const dy = -(sun.y - (Number(cam.y) || 0));
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      this.sunDir.set(dx / l * Math.cos(SUN_ELEV), dy / l * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV)).normalize();
    }
    this.grid.sunDir.copy(this.sunDir);
  }

  /** Rozgrzewka: puste dispatche kerneli gazu i pipeline'y brył w passie ortho (instancje odsłonięte). */
  _warm(ctx) {
    this.grid.warm(ctx.renderer);
    const M = this.meshes;
    const saved = M.geometry.instanceCount;
    M.geometry.instanceCount = Math.max(2, saved);
    const vis = [M.back.visible, M.front.visible];
    M.back.visible = M.front.visible = true;
    try {
      ctx.core?.prewarmPass?.(M.back, 0);
      ctx.core?.prewarmPass?.(M.front, 0);
    } finally {
      M.geometry.instanceCount = saved;
      M.back.visible = vis[0];
      M.front.visible = vis[1];
    }
  }

  clear() {
    this.director.clear();
    this.grid.clear();
    this.followers.length = 0;
  }

  dispose() {
    CollisionFX.off('impact', this._onImpact);
    this.core?.fx?.removeStep?.(this.step);
    this.core?.scene?.remove(this.meshes.back, this.meshes.front);
    this.grid.dispose();
  }
}

/** Tworzy dym gry w Core3D (wymaga Core3D.init — scena i klatka efektów). */
export function createGasSmokeGame(core) {
  if (!core?.scene || !core?.fx) return null;
  const smoke = new GasSmokeGame(core);
  if (typeof window !== 'undefined') window.GasSmoke = smoke;
  return smoke;
}
