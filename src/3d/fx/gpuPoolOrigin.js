// src/3d/fx/gpuPoolOrigin.js
//
// POCZĄTEK PUL GPU PRZY KAMERZE + ZEGARY EFEKTÓW WZGLĘDEM EPOKI (precyzja float32).
//
// Świat gry leży przy 5–10 mln j. (float32: krok 0,5–1 j.), a czas gry rośnie godzinami
// (float32 przy 36 000 s: krok 4 ms). Pule cząstek na GPU (stan w buforach storage,
// ruch w compute i w shaderze) trzymają więc:
//   • pozycje WZGLĘDEM początku O (układ sceny: x, −y świata), a siatka puli stoi na
//     `mesh.position = O` — duży kawałek niesie modelViewMatrix liczona na CPU w double
//     (`renderer.highPrecision`, PLAN §4; ta sama reguła co `sceneOrigin.js`);
//   • czasy WZGLĘDEM epok: zegar efektów (czas animacji puli) i zegar gry (SimClock —
//     czasy nośnika t0), oba jako małe liczby float32.
//
// Początek jest „lepki” (jak dziś `sparkSystem3D.js` / `slugTrail3D.js` na CPU i pył w
// demie asteroid na GPU): gdy żadna pula nie żyje, idzie za kamerą za darmo (co
// klatkę); żywe trzymają go, aż kamera odjedzie o `rebaseDist` (20 tys. j., jak demo
// asteroid) — wtedy JEDEN przeskok przesuwa żywe dane kernelem compute (`shift`), bez
// kopiowania na CPU. Epoki przestawiają się tak samo po `epochSpan` (600 s, jak smugi
// i iskry gry). Przeskok = całkowita liczba jednostek / sekund, więc przesunięcie jest
// dokładne także we float32.
//
// Moduł jest czysty (bez Core3D i bez `window`): kamerę podaje wołający —
// `sceneOriginNearCamera(out)` z src/3d/sceneOrigin.js (układ sceny). Kolejność w
// klatce (12-B, krok compute Core3D): spawn paczek z CPU (w starej ramie) →
// `origin.update(...)` → `origin.dispatch(renderer)` (przesunięcie żywych, łącznie ze
// świeżo zrodzonymi) → `grid.begin(origin.x, origin.y)` + światła → kroki pul → render
// (siatki pul: `mesh.position.set(origin.x, origin.y, 0)`). Paczki zapakowane na CPU,
// a jeszcze nie wysłane, przesuwa `onRebase` puli (albo pula wysyła je przed update).

import * as THREE from 'three/webgpu';
import { Fn, If, Return, uint, float, vec4, uniform, instanceIndex, renderGroup } from 'three/tsl';

export const FX_REBASE_DIST = 20000;    // j. sceny — przeskok początku przy żywych pulach
export const FX_EPOCH_SPAN = 600;       // s — przeskok epok zegarów przy żywych pulach

const COMP = { x: 0, y: 1, z: 2, w: 3 };

export class FxPoolOrigin {
  /**
   * @param {object} [o]
   * @param {number} [o.rebaseDist] odległość kamery od początku [j.], po której żywe pule przeskakują
   * @param {number} [o.epochSpan]  wiek epoki [s], po którym żywe pule przeskakują w czasie
   * @param {string} [o.name]
   */
  constructor({ rebaseDist = FX_REBASE_DIST, epochSpan = FX_EPOCH_SPAN, name = 'fxOrigin' } = {}) {
    this.rebaseDist = rebaseDist;
    this.epochSpan = epochSpan;
    // Stan (double, CPU).
    this.x = 0;               // początek w układzie SCENY
    this.y = 0;
    this.fxEpoch = 0;         // epoka zegara efektów
    this.simEpoch = 0;        // epoka zegara gry (SimClock: sim i render)
    this.initialized = false;
    // Ostatnie przesunięcie (stare − nowe): pozycje lokalne i czasy dostają + delta.
    this.dx = 0;
    this.dy = 0;
    this.dFx = 0;
    this.dSim = 0;
    this.pending = false;     // przesunięcie czeka na dispatch()
    this.rebases = 0;         // przeskoki z żywymi danymi (dispatch kerneli)
    this.moves = 0;           // przestawienia bez żywych danych (za darmo)
    this._entries = [];
    this._pendingEntries = [];
    // Uniformy (grupa `render`: jeden wspólny bufor, świeży w każdym render() / compute()).
    this.timeFx = uniform(0).setName(`${name}TimeFx`).setGroup(renderGroup);           // zegar efektów − epoka
    this.timeSim = uniform(0).setName(`${name}TimeSim`).setGroup(renderGroup);         // SimClock.sim − epoka
    this.timeRender = uniform(0).setName(`${name}TimeRender`).setGroup(renderGroup);   // SimClock.render − epoka
    this.shift = uniform(new THREE.Vector4()).setName(`${name}Shift`).setGroup(renderGroup);  // dx, dy, dFx, dSim
  }

  /**
   * Rejestruje pulę. entry: { shiftNode? (kernel z createShiftKernel), dispatchCount?,
   * isLive?() → bool (brak = zawsze żywa), onRebase?(dx, dy, dFx, dSim) — przesunięcie
   * danych po stronie CPU (np. zapakowanych paczek) }. Zwraca entry.
   */
  register(entry) {
    if (entry && !this._entries.includes(entry)) this._entries.push(entry);
    return entry;
  }

  unregister(entry) {
    const i = this._entries.indexOf(entry);
    if (i >= 0) this._entries.splice(i, 1);
  }

  /** Świat gry → lokalne (double). */
  toLocalX(worldX) { return worldX - this.x; }
  toLocalY(worldY) { return -worldY - this.y; }

  /** Czas zegara efektów / gry → względem epoki (mała liczba dla float32). */
  fxTimeLocal(t) { return t - this.fxEpoch; }
  simTimeLocal(t) { return t - this.simEpoch; }

  _anyLive() {
    const E = this._entries;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e.isLive || e.isLive()) return true;
    }
    return false;
  }

  /**
   * Raz na klatkę, PRZED zapisem nowych danych w nowej ramie. camX, camY — kamera w
   * układzie SCENY (`sceneOriginNearCamera`); fxTime — zegar efektów [s]; simTime,
   * renderTime — SimClock.sim / SimClock.render. Ustawia uniformy czasów; przy
   * przeskoku zapamiętuje przesunięcie (`dx, dy, dFx, dSim`, uniform `shift`), woła
   * `onRebase` zarejestrowanych pul i oznacza żywe do `dispatch`. Zwraca true, gdy
   * początek albo epoki się zmieniły.
   */
  update(camX, camY, fxTime = 0, simTime = fxTime, renderTime = simTime) {
    const cx = Number.isFinite(camX) ? camX : this.x;
    const cy = Number.isFinite(camY) ? camY : this.y;
    const tf = Number.isFinite(fxTime) ? fxTime : 0;
    const ts = Number.isFinite(simTime) ? simTime : 0;
    const tr = Number.isFinite(renderTime) ? renderTime : ts;
    let changed = false;
    if (!this.initialized) {
      this.x = Math.round(cx);
      this.y = Math.round(cy);
      this.fxEpoch = Math.floor(tf);
      this.simEpoch = Math.floor(Math.min(ts, tr));
      this.initialized = true;
    } else {
      const live = this._anyLive();
      let nx = this.x;
      let ny = this.y;
      let nFx = this.fxEpoch;
      let nSim = this.simEpoch;
      const tMin = Math.min(ts, tr);
      if (!live) {
        // Nic nie żyje: początek i epoki idą za kamerą i zegarem za darmo.
        nx = Math.round(cx);
        ny = Math.round(cy);
        nFx = Math.floor(tf);
        nSim = Math.floor(tMin);
      } else {
        if (Math.abs(cx - this.x) > this.rebaseDist || Math.abs(cy - this.y) > this.rebaseDist) {
          nx = Math.round(cx);
          ny = Math.round(cy);
        }
        if (tf - this.fxEpoch > this.epochSpan || tf < this.fxEpoch) nFx = Math.floor(tf);
        if (tMin - this.simEpoch > this.epochSpan || tMin < this.simEpoch) nSim = Math.floor(tMin);
      }
      if (nx !== this.x || ny !== this.y || nFx !== this.fxEpoch || nSim !== this.simEpoch) {
        changed = true;
        this.dx = this.x - nx;
        this.dy = this.y - ny;
        this.dFx = this.fxEpoch - nFx;
        this.dSim = this.simEpoch - nSim;
        this.x = nx;
        this.y = ny;
        this.fxEpoch = nFx;
        this.simEpoch = nSim;
        // Kolejny przeskok przed dispatch() (np. klatka bez kroku compute) — przesunięcia
        // się sumują, żeby dane GPU nie zgubiły pierwszego.
        const S = this.shift.value;
        const P = this._pendingEntries;
        if (!this.pending) { S.set(0, 0, 0, 0); P.length = 0; }
        S.x += this.dx; S.y += this.dy; S.z += this.dFx; S.w += this.dSim;
        const E = this._entries;
        for (let i = 0; i < E.length; i++) {
          const e = E[i];
          if (e.onRebase) e.onRebase(this.dx, this.dy, this.dFx, this.dSim);
          if (e.shiftNode && (!e.isLive || e.isLive()) && !P.includes(e)) P.push(e);
        }
        this.pending = P.length > 0;
        if (live) this.rebases++;
        else this.moves++;
      }
    }
    this.timeFx.value = tf - this.fxEpoch;
    this.timeSim.value = ts - this.simEpoch;
    this.timeRender.value = tr - this.simEpoch;
    return changed;
  }

  /**
   * Wysyła kernele przesunięcia żywych pul po przeskoku (raz — potem nic). W kroku
   * compute Core3D zaraz po update(). Zwraca liczbę dispatchy.
   */
  dispatch(renderer) {
    if (!this.pending) return 0;
    const P = this._pendingEntries;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const e = P[i];
      renderer.compute(e.shiftNode, e.dispatchCount ?? e.shiftNode.count);
      n++;
    }
    P.length = 0;
    this.pending = false;
    return n;
  }
}

/**
 * Kernel compute przesunięcia żywych danych puli po przeskoku początku / epok
 * (uogólniony `shift` z dema asteroid: dust.js, sparks.js).
 *
 * @param {FxPoolOrigin} origin
 * @param {object} o
 * @param {object} o.buffer     węzeł storage vec4 (instancedArray / attributeArray)
 * @param {number} o.capacity   liczba elementów puli
 * @param {number} [o.stride]   vec4 na element (domyślnie 1)
 * @param {Array<[number, 'xy'|'zw']>} [o.pos]      pozycje lokalne: [indeks vec4, para]
 * @param {Array<[number, 'x'|'y'|'z'|'w']>} [o.fxTime]  czasy zegara efektów (np. narodziny)
 * @param {Array<[number, 'x'|'y'|'z'|'w']>} [o.simTime] czasy zegara gry (t0 nośnika)
 * @param {string} [o.name]
 * @returns {object} węzeł compute (`.count` = capacity)
 */
export function createShiftKernel(origin, { buffer, capacity, stride = 1, pos = [[0, 'xy']], fxTime = [], simTime = [], name = 'fxShift' }) {
  const S = origin.shift;
  // Delta na każdy dotknięty vec4 elementu: składowe z uniformu shift albo 0.
  const deltas = new Map();
  const put = (at, comp, node) => {
    if (!(at >= 0 && at < stride)) throw new Error(`createShiftKernel: indeks vec4 ${at} poza krokiem ${stride}`);
    let d = deltas.get(at);
    if (!d) { d = [null, null, null, null]; deltas.set(at, d); }
    if (d[comp] !== null) throw new Error(`createShiftKernel: składowa ${at}.${'xyzw'[comp]} przesuwana dwa razy`);
    d[comp] = node;
  };
  for (const [at, pair] of pos) {
    if (pair === 'xy') { put(at, 0, S.x); put(at, 1, S.y); }
    else if (pair === 'zw') { put(at, 2, S.x); put(at, 3, S.y); }
    else throw new Error(`createShiftKernel: para pozycji '${pair}' (tylko 'xy' / 'zw')`);
  }
  for (const [at, c] of fxTime) put(at, COMP[c], S.z);
  for (const [at, c] of simTime) put(at, COMP[c], S.w);
  const node = Fn(() => {
    // Compute nie sprawdza zakresu instanceIndex (grupy robocze po 64) — strażnik.
    If(instanceIndex.greaterThanEqual(uint(capacity)), () => { Return(); });
    const base = instanceIndex.mul(uint(stride)).toVar();
    for (const [at, d] of deltas) {
      const e = buffer.element(base.add(uint(at)));
      e.assign(e.add(vec4(d[0] ?? float(0), d[1] ?? float(0), d[2] ?? float(0), d[3] ?? float(0))));
    }
  })().compute(capacity).setName(name);
  return node;
}

/**
 * Lustro CPU kernela przesunięcia (testy, pule CPU): ten sam układ pól co
 * `createShiftKernel` na tablicy Float32Array/Float64Array (4 liczby na vec4).
 */
export function applyShiftCpu(array, { capacity, stride = 1, pos = [[0, 'xy']], fxTime = [], simTime = [] }, dx, dy, dFx, dSim) {
  for (let i = 0; i < capacity; i++) {
    const base = i * stride * 4;
    for (const [at, pair] of pos) {
      const o = base + at * 4 + (pair === 'zw' ? 2 : 0);
      array[o] += dx;
      array[o + 1] += dy;
    }
    for (const [at, c] of fxTime) array[base + at * 4 + COMP[c]] += dFx;
    for (const [at, c] of simTime) array[base + at * 4 + COMP[c]] += dSim;
  }
  return array;
}
