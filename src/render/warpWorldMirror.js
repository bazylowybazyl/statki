// src/render/warpWorldMirror.js — warp gracza i dopalacz w migawce klatki (skalary WORLD, snapshotLayout.js; układ 2,
// 2026-10-25 — etap W nowego warpa, DECYZJE W1).
//
// Tryb `off` daje modułom renderu OBIEKT gry (`GameState.warp`, `GameState.boost` — RenderWorld.warp / .boost, klatka
// „Nurtu” `o.warp`). W workerze renderu to samo daje LUSTRO z tego modułu: pakowanie (strona gry, `snapshotPack.js`
// → `packWarpWorld`) i rozpakowanie (worker, `render.worker.js` → `applyWarpWorld`) czytają jedną tabelę pól, więc
// WarpPlayerFx (`player.js`), sterownik `warpNurt.js`, plazma WARP i dopalacz (`engineVfxSystem.js`) i lakier
// (`hullLacquer.js`) widzą w workerze te same liczby co w `off`:
//   • stan i ładowanie (`state`, `charge`, `chargeTime`, `gear`), kurs `dir { x, y }`, `flybyFactor`, `cruise`, `speed`,
//     `entryProgress`;
//   • rampa wyjścia `exitRamp` (pełna — `createWarpExitRamp`: slow, coast, brake, tSlowEnd, tBrake, tHalt, v0, vArr, vEnd,
//     dist, dirX / dirY, hullLength, active, age, t0) albo null; ślizg `exitSlide` albo null; `gravityBrake.active`;
//   • ciało celu i startu (`targetBody`, `originBody`) — INDEKS na liście ciał (planety, za nimi małe ciała — ta sama
//     kolejność, w jakiej strona wysyła je workerowi: `rwHost.syncPlanets(planets, SUN, window.smallBodies)`), worker
//     podstawia SWOJE obiekty ciał (te same, które dostało `initPlanets3D` — soczewka porównuje `ent.data === target`);
//   • znaczniki zegara: `kickSim` (SimClock.sim przy skoku), zegar efektu warpa strony (suma dt klatek „Nurtu” —
//     worker liczy z niego dt efektu, więc strony pominięte przez workera nie gubią czasu osi kopu i wyjścia);
//   • kotwica kadru (DECYZJE M3) — dwa skalary na etap integracji soczewki (`anchorSX / anchorSY`).
// Pole nieobecne na obiekcie gry = NaN (jak reszta migawki). Rozpakowanie bez alokacji w klatce (obiekty lustra tworzy
// `createWarpWorldMirror` raz). Czysty moduł (bez three, DOM i `window`).

import { WORLD } from './snapshotLayout.js';

const raw = (v) => (typeof v === 'number' ? v : NaN);

/** Pola liczbowe warpa: [indeks WORLD, klucz obiektu gry]. */
export const WARP_SCALAR_FIELDS = Object.freeze([
  ['WARP_CHARGE', 'charge'], ['WARP_CHARGE_TIME', 'chargeTime'], ['WARP_GEAR', 'gear'], ['WARP_FLYBY', 'flybyFactor'],
  ['WARP_CRUISE', 'cruise'], ['WARP_SPEED', 'speed'], ['WARP_ENTRY', 'entryProgress'], ['WARP_KICK_SIM', 'kickSim']
].map(([K, k]) => Object.freeze([WORLD[K], k])));

/** Pola liczbowe rampy wyjścia (`createWarpExitRamp`) — wszystkie poza `active`. */
export const WARP_RAMP_FIELDS = Object.freeze([
  ['WARP_EXIT_AGE', 'age'], ['WARP_EXIT_T0', 't0'], ['WARP_EXIT_SLOW', 'slow'], ['WARP_EXIT_COAST', 'coast'],
  ['WARP_EXIT_BRAKE', 'brake'], ['WARP_EXIT_TSLOW', 'tSlowEnd'], ['WARP_EXIT_TBRAKE', 'tBrake'],
  ['WARP_EXIT_THALT', 'tHalt'], ['WARP_EXIT_V0', 'v0'], ['WARP_EXIT_VARR', 'vArr'], ['WARP_EXIT_VEND', 'vEnd'],
  ['WARP_EXIT_DIST', 'dist'], ['WARP_EXIT_DIR_X', 'dirX'], ['WARP_EXIT_DIR_Y', 'dirY'], ['WARP_EXIT_HULL', 'hullLength']
].map(([K, k]) => Object.freeze([WORLD[K], k])));

/** Pola liczbowe ślizgu (`startPlayerWarpSlide` w index.html) — wszystkie poza `active`. */
export const WARP_SLIDE_FIELDS = Object.freeze([
  ['WARP_SLIDE_SPEED', 'speed'], ['WARP_SLIDE_VMIN', 'vMin'], ['WARP_SLIDE_DECEL', 'decel'],
  ['WARP_SLIDE_DIR_X', 'dirX'], ['WARP_SLIDE_DIR_Y', 'dirY']
].map(([K, k]) => Object.freeze([WORLD[K], k])));

/** Indeks ciała na liście (planety, potem małe ciała) albo −1. Bez alokacji (pętla po tożsamości). */
export function warpBodyIndex(body, planets, small) {
  if (!body) return -1;
  const np = planets ? planets.length : 0;
  for (let i = 0; i < np; i++) if (planets[i] === body) return i;
  const ns = small ? small.length : 0;
  for (let j = 0; j < ns; j++) if (small[j] === body) return np + j;
  return -1;
}

/** Ciało pod indeksem `warpBodyIndex` na liście tej strony (worker: jego obiekty ciał) albo null. */
export function warpBodyAt(index, planets, small) {
  if (!(index >= 0) || !planets) return null;
  const np = planets.length;
  if (index < np) return planets[index] || null;
  return small ? (small[index - np] || null) : null;
}

/**
 * Strona gry (faza begin migawki — `SnapshotPacker._packWorld`): skalary warpa i dopalacza do `w` (WORLD).
 * `f` — klatka migawki: `warp`, `boost`, `planets`, `smallBodies`, `warpFxClock`, `warpAnchorSX / SY`; `dict` — słownik
 * napisów pakującego (`code(v)`). Pakowanie nie zmienia obiektów gry.
 */
export function packWarpWorld(w, f, dict) {
  const wp = f.warp || null;
  w[WORLD.WARP_STATE] = wp ? dict.code(wp.state) : -1;
  for (let i = 0; i < WARP_SCALAR_FIELDS.length; i++) {
    const p = WARP_SCALAR_FIELDS[i];
    w[p[0]] = wp ? raw(wp[p[1]]) : NaN;
  }
  const d = wp ? wp.dir : null;
  w[WORLD.WARP_DIR_X] = d ? raw(d.x) : NaN;
  w[WORLD.WARP_DIR_Y] = d ? raw(d.y) : NaN;
  w[WORLD.WARP_TARGET_BODY] = wp ? warpBodyIndex(wp.targetBody, f.planets, f.smallBodies) : -1;
  w[WORLD.WARP_ORIGIN_BODY] = wp ? warpBodyIndex(wp.originBody, f.planets, f.smallBodies) : -1;
  const r = wp ? wp.exitRamp : null;
  w[WORLD.WARP_EXIT_ACTIVE] = r ? (r.active ? 1 : 0) : -1;
  for (let i = 0; i < WARP_RAMP_FIELDS.length; i++) {
    const p = WARP_RAMP_FIELDS[i];
    w[p[0]] = r ? raw(r[p[1]]) : NaN;
  }
  const s = wp ? wp.exitSlide : null;
  w[WORLD.WARP_SLIDE_ACTIVE] = s ? (s.active ? 1 : 0) : -1;
  for (let i = 0; i < WARP_SLIDE_FIELDS.length; i++) {
    const p = WARP_SLIDE_FIELDS[i];
    w[p[0]] = s ? raw(s[p[1]]) : NaN;
  }
  const gb = wp ? wp.gravityBrake : null;
  w[WORLD.WARP_ABRUPT] = gb && gb.active ? 1 : 0;
  w[WORLD.WARP_FX_CLOCK] = raw(f.warpFxClock);
  w[WORLD.WARP_ANCHOR_SX] = raw(f.warpAnchorSX);
  w[WORLD.WARP_ANCHOR_SY] = raw(f.warpAnchorSY);
  const bo = f.boost || null;
  w[WORLD.BOOST_STATE] = bo ? dict.code(bo.state) : -1;
}

/** Lustro warpa i dopalacza po stronie renderu (obiekty tworzone raz — `applyWarpWorld` pisze w miejscu). */
export function createWarpWorldMirror() {
  const ramp = {
    active: false, t0: 0, age: 0, v0: 0, vArr: 0, vEnd: 0, hullLength: 0, dirX: 1, dirY: 0,
    slow: 0, coast: 0, brake: 0, tSlowEnd: 0, tBrake: 0, tHalt: 0, dist: 0
  };
  const slide = { active: false, dirX: 1, dirY: 0, speed: 0, vMin: 0, decel: 0 };
  const warp = {
    state: 'idle', charge: 0, chargeTime: 0.8, gear: 1, dir: { x: 0, y: 0 }, flybyFactor: 1, cruise: 0, speed: 0,
    entryProgress: 0, kickSim: NaN, targetBody: null, originBody: null, exitRamp: null, exitSlide: null,
    gravityBrake: { active: false },
    isBusy() { return this.state !== 'idle' || !!(this.exitRamp && this.exitRamp.active); }
  };
  return {
    warp, ramp, slide, boost: { state: 'idle' },
    hasWarp: false, hasBoost: false,
    targetIndex: -1, originIndex: -1,
    fxClock: NaN, anchorSX: NaN, anchorSY: NaN
  };
}

/**
 * Worker (renderPage, przed modułami): skalary WORLD strony → lustro `m` (createWarpWorldMirror). `dict` — słownik
 * strony (`value(code)`), `planets` / `small` — listy ciał workera (te z `initPlanets3D`; null — jeszcze nie przyszły).
 * Wynik: `m` — `m.hasWarp ? m.warp : null` to RenderWorld.warp workera, `m.hasBoost ? m.boost : null` — RenderWorld.boost.
 */
export function applyWarpWorld(w, dict, m, planets, small) {
  const wp = m.warp;
  const sc = w[WORLD.WARP_STATE];
  m.hasWarp = sc >= 0;
  wp.state = sc >= 0 ? dict.value(sc) : 'idle';
  for (let i = 0; i < WARP_SCALAR_FIELDS.length; i++) {
    const p = WARP_SCALAR_FIELDS[i];
    wp[p[1]] = w[p[0]];
  }
  wp.dir.x = w[WORLD.WARP_DIR_X];
  wp.dir.y = w[WORLD.WARP_DIR_Y];
  m.targetIndex = w[WORLD.WARP_TARGET_BODY];
  m.originIndex = w[WORLD.WARP_ORIGIN_BODY];
  wp.targetBody = warpBodyAt(m.targetIndex, planets, small);
  wp.originBody = warpBodyAt(m.originIndex, planets, small);
  const ra = w[WORLD.WARP_EXIT_ACTIVE];
  if (ra >= 0) {
    const r = m.ramp;
    r.active = ra === 1;
    for (let i = 0; i < WARP_RAMP_FIELDS.length; i++) {
      const p = WARP_RAMP_FIELDS[i];
      r[p[1]] = w[p[0]];
    }
    wp.exitRamp = r;
  } else wp.exitRamp = null;
  const sa = w[WORLD.WARP_SLIDE_ACTIVE];
  if (sa >= 0) {
    const s = m.slide;
    s.active = sa === 1;
    for (let i = 0; i < WARP_SLIDE_FIELDS.length; i++) {
      const p = WARP_SLIDE_FIELDS[i];
      s[p[1]] = w[p[0]];
    }
    wp.exitSlide = s;
  } else wp.exitSlide = null;
  wp.gravityBrake.active = w[WORLD.WARP_ABRUPT] === 1;
  m.fxClock = w[WORLD.WARP_FX_CLOCK];
  m.anchorSX = w[WORLD.WARP_ANCHOR_SX];
  m.anchorSY = w[WORLD.WARP_ANCHOR_SY];
  const bc = w[WORLD.BOOST_STATE];
  m.hasBoost = bc >= 0;
  m.boost.state = bc >= 0 ? dict.value(bc) : 'idle';
  return m;
}

/**
 * Źródło graczy workera (`createMirrorPlayersSource` — renderWorld.js): własne pola `warp` i `boost` (bez nich getter
 * prototypu czyta `globalThis.warp` / `GameState.boost` realmu workera — puste: brak plazmy WARP i dopalacza gracza).
 * Tylko worker — w `?szew=inline` źródło luster zostaje przy obiektach gry strony (getter prototypu).
 */
export function installWarpPlayerFields(src) {
  if (!Object.prototype.hasOwnProperty.call(src, 'warp')) Object.defineProperty(src, 'warp', { value: null, writable: true, enumerable: true });
  if (!Object.prototype.hasOwnProperty.call(src, 'boost')) Object.defineProperty(src, 'boost', { value: null, writable: true, enumerable: true });
  return src;
}

/** Worker: lustro → źródło graczy (RenderWorld.warp / .boost tej strony). */
export function publishWarpPlayerFields(src, m) {
  src.warp = m.hasWarp ? m.warp : null;
  src.boost = m.hasBoost ? m.boost : null;
}

/**
 * dt efektu warpa w workerze z zegara efektu strony (`WARP_FX_CLOCK` — suma dt, które strona w trybie `off` podaje
 * WarpNurt.update): przyrost od poprzedniej narysowanej strony, więc pominięte strony nie gubią czasu osi kopu
 * i wyjścia (WarpPlayerFx). Bez zegara albo przy cofnięciu (nowa sesja strony) — dt tej strony (`fallbackDt`).
 * `st` — { prev } (pamięć wołającego).
 */
export function warpFxDt(st, clock, fallbackDt) {
  const prev = st.prev;
  st.prev = clock;
  if (!(clock === clock) || !(prev === prev) || clock < prev) return Number.isFinite(fallbackDt) ? fallbackDt : 0;
  return clock - prev;
}
