// src/render/renderWorld.js
//
// RenderWorld — fasada świata gry dla warstwy renderu (RW-12, docs/PLAN-render-worker.md § 2.4, § 3.6).
//
// Moduły renderu (src/3d, src/vfx, src/effects3d) NIE czytają zmiennych gry z `window` / `globalThis` ani
// `GameState` — tylko przez tę fasadę. Źródło:
//   - tryb `off` (dziś, domyślny): każdy getter czyta dokładnie to, co moduł czytał wcześniej (`window.ship`,
//     `window.SUN`, `GameState.boost`…) — obraz bit w bit;
//   - tryby `inline` / `worker` (RW-10, RW-40): `RenderWorld.setSource(obiekt)` — obiekt z migawki klatki (HEAD,
//     listy, lustra encji) o tych samych nazwach pól co gettery niżej.
//
// Pola (nazwa fasady ← dzisiejsze źródło):
//   HEAD:   camera ← window.camera (kamera gracza 1: x, y, zoom…), camera2, splitScreenMode, sun ← window.SUN,
//           options ← window.OPTIONS, vfxTune ← window.VFX_TUNE, cameraRig ← window.CameraRig
//   gracz:  ship ← window.ship (= GameState.ship), player2Ship, playerPose ← window.__interpShipPose,
//           driveState ← window.shipDriveState, warp ← window.warp (= GameState.warp), boost ← GameState.boost
//   listy:  bullets, wrecks, npcs ← window.*
//   świat:  planets ← window.planets
//   dev:    devTuning, devVFX, devConfig, dev ← window.DevTuning / DevVFX / DevConfig / Dev; config.* — nastawy
//           harnessu i haki konsoli sprzed wczytania (explosionGrid ← __EXPLOSION_GRID, explosionTune ←
//           __EXPLOSION_TUNE_OVR, tslUuidFix ← __TSL_UUID_NAPRAWA, enginePointLights ← ENGINE_POINT_LIGHTS_ENABLED,
//           stationScaleById, stationPivotById, debugRecord ← __renderDbgRecord, k7Glb ← __K7_GLB,
//           weaponGlb ← __WEAPON_GLB)
//   strona: isBrowser ← typeof window !== 'undefined', pageSearch ← location.search strony, viewWidth / viewHeight ←
//           innerWidth / innerHeight, devicePixelRatio, screenWidth / screenHeight ← screen.*, storageItem(klucz) ←
//           localStorage (w migawce: obiekt `storage`), layerCanvas ← #webgl-layer, pageHidden i słuchacze
//           visibilitychange (onVisibilityChange / offVisibilityChange)
//   gra:    game ← window — rozgrywka, która dziś mieszka w module renderu (rakiety `rocketSystem3D`: applyDamage*,
//           registerShieldImpact, isShieldBreachedAt, Game, WorldBodies, RepairSwarm; do gry w RW-23), hullBodies ←
//           window.HullBodies, scoutBay ← window.ScoutBay, destruction3D ← window.Destruction3D (moduł renderu
//           wystawiony przez most w index.html — w workerze z importu)
//
// Zasada jak w GameState: pola czytaj w chwili użycia, nie zapamiętuj przy imporcie modułu.
// Czysty moduł: bez DOM i bez three; w workerze `globalThis` to zasięg workera (tryb `off` nie ma tam sensu).
import { GameState } from '../game/gameState.js';

const G = globalThis;
// Dawne `window.X` czytamy z `window` (w przeglądarce to samo co globalThis; testy w Node podkładają osobny obiekt
// `globalThis.window = {}`), dawne `globalThis.X` — z globalThis.
const W = () => G.window || G;

class RenderWorldFacade {
  constructor() {
    /** Źródło trybu inline / worker (obiekt z migawki) albo null — tryb `off` (globale gry). */
    this._src = null;
    this._config = new RenderWorldConfig(this);
    this._visListeners = new Set();
  }

  /** Obiekt z migawki (pola jak gettery tej klasy) albo null — powrót do globali gry. */
  setSource(src) { this._src = src || null; }
  get mode() { return this._src ? 'migawka' : 'off'; }

  // strona
  /** Czy gra działa w przeglądarce (nie w Node: testy) — dawne `typeof window !== 'undefined'`. */
  get isBrowser() { const s = this._src; return s ? !!s.isBrowser : typeof G.window !== 'undefined'; }
  /** `location.search` STRONY gry (w workerze `location` to adres skryptu workera). */
  get pageSearch() { const s = this._src; return s ? s.pageSearch : G.location?.search; }
  /** Okno przeglądarki (RW-35): rozmiar w px CSS, DPR, ekran — w workerze z HEAD migawki. */
  get viewWidth() { const s = this._src; return s ? s.viewWidth : W().innerWidth; }
  get viewHeight() { const s = this._src; return s ? s.viewHeight : W().innerHeight; }
  get devicePixelRatio() { const s = this._src; return s ? s.devicePixelRatio : W().devicePixelRatio; }
  get screenWidth() { const s = this._src; return s ? s.screenWidth : W().screen?.width; }
  get screenHeight() { const s = this._src; return s ? s.screenHeight : W().screen?.height; }
  /** Kanwa warstwy 3D strony (#webgl-layer) — Core3D.init bez argumentu; w workerze OffscreenCanvas z mostu. */
  get layerCanvas() { const s = this._src; return s ? s.layerCanvas : G.document?.getElementById('webgl-layer'); }
  /** Karta strony ukryta (document.visibilityState === 'hidden'). */
  get pageHidden() { const s = this._src; return s ? !!s.pageHidden : G.document?.visibilityState === 'hidden'; }
  /** Słuchacz zmiany widoczności strony; w trybie migawki wołany przez `emitVisibilityChange()` mostu. */
  onVisibilityChange(fn) {
    if (this._src) { this._visListeners.add(fn); return; }
    G.document?.addEventListener('visibilitychange', fn);
  }
  offVisibilityChange(fn) {
    this._visListeners.delete(fn);
    G.document?.removeEventListener('visibilitychange', fn);
  }
  /** Most (tryb migawki): widoczność strony się zmieniła — powiadom słuchaczy. */
  emitVisibilityChange() { for (const fn of [...this._visListeners]) fn(); }
  /** Wartość z localStorage strony (preferencje czytane przez render przy imporcie); null — brak / niedostępne. */
  storageItem(key) {
    const s = this._src;
    if (s) return s.storage?.[key] ?? null;
    try { return W().localStorage?.getItem(key) ?? null; } catch { return null; }
  }

  // HEAD
  get camera() { const s = this._src; return s ? s.camera : W().camera; }
  get camera2() { const s = this._src; return s ? s.camera2 : W().camera2; }
  get splitScreenMode() { const s = this._src; return s ? s.splitScreenMode : W().splitScreenMode; }
  get sun() { const s = this._src; return s ? s.sun : W().SUN; }
  get options() { const s = this._src; return s ? s.options : W().OPTIONS; }
  get vfxTune() { const s = this._src; return s ? s.vfxTune : W().VFX_TUNE; }
  /** Rig kamery gry (`tune.shakeMaxPx` — zapas kadru LOD strug MAIN na wstrząs). */
  get cameraRig() { const s = this._src; return s ? s.cameraRig : W().CameraRig; }

  // gracz
  get ship() { const s = this._src; return s ? s.ship : W().ship; }
  get player2Ship() { const s = this._src; return s ? s.player2Ship : W().player2Ship; }
  get playerPose() { const s = this._src; return s ? s.playerPose : W().__interpShipPose; }
  get driveState() { const s = this._src; return s ? s.driveState : W().shipDriveState; }
  get warp() { const s = this._src; return s ? s.warp : W().warp; }
  get boost() { const s = this._src; return s ? s.boost : GameState.boost; }

  // listy
  get bullets() { const s = this._src; return s ? s.bullets : W().bullets; }
  get wrecks() { const s = this._src; return s ? s.wrecks : W().wrecks; }
  get npcs() { const s = this._src; return s ? s.npcs : W().npcs; }

  // świat
  get planets() { const s = this._src; return s ? s.planets : W().planets; }

  // dev
  get devTuning() { const s = this._src; return s ? s.devTuning : W().DevTuning; }
  get devVFX() { const s = this._src; return s ? s.devVFX : W().DevVFX; }
  get devConfig() { const s = this._src; return s ? s.devConfig : W().DevConfig; }
  get dev() { const s = this._src; return s ? s.dev : W().Dev; }
  get config() { return this._config; }

  // rozgrywka i moduły wystawione na okno
  get game() { const s = this._src; return s ? s.game : W(); }
  get hullBodies() { const s = this._src; return s ? s.hullBodies : W().HullBodies; }
  get scoutBay() { const s = this._src; return s ? s.scoutBay : W().ScoutBay; }
  get destruction3D() { const s = this._src; return s ? s.destruction3D : W().Destruction3D; }
}

class RenderWorldConfig {
  constructor(world) { this._w = world; }
  _c() { const s = this._w._src; return s ? (s.config || EMPTY) : null; }
  get explosionGrid() { const c = this._c(); return c ? c.explosionGrid : G.__EXPLOSION_GRID; }
  get explosionTune() { const c = this._c(); return c ? c.explosionTune : G.__EXPLOSION_TUNE_OVR; }
  get tslUuidFix() { const c = this._c(); return c ? c.tslUuidFix : G.__TSL_UUID_NAPRAWA; }
  get enginePointLights() { const c = this._c(); return c ? c.enginePointLights : W().ENGINE_POINT_LIGHTS_ENABLED; }
  get stationScaleById() { const c = this._c(); return c ? c.stationScaleById : W().stationScaleById; }
  get stationPivotById() { const c = this._c(); return c ? c.stationPivotById : W().stationPivotById; }
  get debugRecord() { const c = this._c(); return c ? c.debugRecord : G.__renderDbgRecord; }
  get k7Glb() { const c = this._c(); return c ? c.k7Glb : G.__K7_GLB; }
  get weaponGlb() { const c = this._c(); return c ? c.weaponGlb : G.__WEAPON_GLB; }
}
const EMPTY = Object.freeze({});

export const RenderWorld = new RenderWorldFacade();
