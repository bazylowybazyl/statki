// src/3d/fx/fxFrame.js
//
// KLATKA EFEKTÓW GPU w Core3D (zadanie 12-B — wpięcie modułów 12-A, docs/webgpu/FX-INFRA.md).
// Jeden egzemplarz na grę (`Core3D.fx`). Raz na klatkę rAF, na starcie Core3D.render — przed
// passami scen (podzielony ekran: drugi renderSingle tej klatki nic tu nie robi):
//   1. spawn   — kroki wysyłają paczki zapakowane od poprzedniej klatki (stara rama początku),
//   2. początek pul i zegary: FxPoolOrigin.update(kamera sceny, zegar efektów, SimClock),
//   3. przesunięcie żywych danych po przeskoku początku / epok (kernele shift zarejestrowanych pul),
//   4. siatka świateł: begin(początek) → kadr → światła efektów (FxLights) i kroków → build
//      (pusta siatka dwa razy z rzędu = bez budowy i bez wysyłki na GPU),
//   5. update  — kroki pul (ruch, światło dymu w compute), potem passy scen.
// Zniekształcenia (DistortionField) pakuje `commitDistortion` na KAŻDY render (kamera passa —
// podzielony ekran ma dwie), a kolejkę źródeł kasuje dopiero pierwsze zgłoszenie po renderze
// (`distortionSources()`) albo render następnej klatki bez nowych zgłoszeń.
//
// Krok efektu (np. pula GPU z dema broni w zadaniu 17) to zwykły obiekt:
//   { name, spawn?(ctx), lights?(ctx), update?(ctx), warm?(ctx) }
// ctx (jeden obiekt na grę, bez alokacji na klatkę): renderer, core (Core3D), time / dt (zegar
// efektów [s], biegnie z klatką rAF jak Fx3D — także w pauzie), frame (renderer.info.frame),
// origin (FxPoolOrigin), grid (LightGrid), lights (FxLights), distortion (DistortionField),
// view (kadr w świecie gry: x0, y0, x1, y1 z zapasem). `warm` idzie RAZ przy gotowym
// urządzeniu (albo od razu przy rejestracji po nim): puste dispatche kerneli
// (`renderer.compute(kernel, 1)` z licznikiem 0 w uniformie) i `core.prewarmPass(siatka,
// warstwa)` — pipeline zależy od celu passu (MSAA, format), a compileAsync pomija niewidoczne
// (DEMO-RAKIETY: bez tego pierwszy wybuch kompilował ~40 ms). Pula GPU MUSI się zarejestrować
// też w `origin.register(...)` (gpuPoolOrigin.js) — inaczej początek przestawia się pod jej danymi.

import { GridLighting, LightGrid } from './lightGrid.js';
import { FxLights } from './fxLights.js';
import { FxPoolOrigin } from './gpuPoolOrigin.js';
import { DistortionField } from './distortion.js';
import { SimClock } from '../../game/simClock.js';

/** Warstwa zniekształceń (DIST, dema/bronie-webgpu): siatki na niej rysują przesunięcie w px do Core3D.distortionTarget. */
export const FX_DISTORT_LAYER = 10;
/** Zapas kadru siatki świateł i świateł efektów (ułamek połowy kadru). */
export const FX_VIEW_MARGIN = 0.15;
/** Kadr wolnej kamery 3D (lot nad miastem ringu) — pół boku wokół kamery [j.]. */
export const FX_FREE_VIEW_HALF = 12000;
/** Najdłuższy krok zegara efektów [s] (jak Fx3D.update). */
export const FX_MAX_DT = 0.1;

export class FxFrame {
  constructor() {
    this.origin = new FxPoolOrigin({ name: 'fxOrigin' });
    this.grid = new LightGrid({ name: 'fxGrid' });
    this.lights = new FxLights();
    this.distortion = new DistortionField({ name: 'fxDistort' });
    // Ważny nagłówek przed pierwszym renderem (rozmiar 1 × 1, zero źródeł) — „uber” dzieli przez rozmiar.
    this.distortion.commit(0, 0, 1, 1, 1, 0);
    this.steps = [];
    this.renderer = null;
    this.core = null;
    this.ready = false;
    this.time = 0;
    this.dt = 0;
    this.frameId = -1;
    this._clockMs = -1;
    this._gridLit = false;
    this._distortConsumed = false;
    this._distortFrame = -1;
    /** Warstwa DIST ma w tej klatce widoczną zawartość (właściciel zgłasza co klatkę — Core3D.setDistortLayerActive). */
    this.distortLayerActive = false;
    this._warmed = new WeakSet();
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.ctx = {
      renderer: null, core: null, time: 0, dt: 0, frame: -1,
      origin: this.origin, grid: this.grid, lights: this.lights, distortion: this.distortion, view: this.view
    };
    // Pomiar klatki (PerfHUD, harness): CPU kroku, dispatche compute, światła i wpisy siatki, źródła zniekształceń.
    this.stats = { cpuMs: 0, dispatches: 0, steps: 0, lights: 0, gridItems: 0, gridBuilt: false, distortSources: 0, distortLayer: false };
    // Post tej klatki od efektów (zadanie 19 — Supernowa z dema rakiet): przygaszenie obrazu
    // (mnożnik w gałęzi efektów „uber”, 1 = bez zmian) i dodatek do siły bloomu. Kasowane na
    // starcie każdej klatki efektów; kroki biorą min / max.
    this.post = { exposure: 1, bloomBoost: 0 };
  }

  /**
   * Renderer gotowy (Core3D._configureRenderer): siatka świateł jako system oświetlenia —
   * tryb „optIn”: czytają ją tylko materiały z `gridLights === true` (enableGridLights),
   * reszta ma WGSL identyczny jak bez siatki (planety, tło, stacje, ring, kadłuby do 18).
   */
  attach(renderer, core = null) {
    this.renderer = renderer;
    this.core = core;
    this.ctx.renderer = renderer;
    this.ctx.core = core;
    if (renderer) renderer.lighting = new GridLighting(this.grid, { mode: 'optIn' });
    return this;
  }

  /** Rejestruje krok efektu (patrz nagłówek); przy gotowym urządzeniu od razu go rozgrzewa. */
  addStep(step) {
    if (!step || this.steps.includes(step)) return step;
    this.steps.push(step);
    if (this.ready) this._warmStep(step);
    return step;
  }

  removeStep(step) {
    const i = this.steps.indexOf(step);
    if (i >= 0) this.steps.splice(i, 1);
  }

  /** Urządzenie gotowe (Core3D.gpuReady) — rozgrzewa kroki zarejestrowane wcześniej i kernele przesunięcia. */
  warmAll() {
    this.ready = true;
    for (let i = 0; i < this.steps.length; i++) this._warmStep(this.steps[i]);
    // Kernele przesunięcia pul: dispatch z zerowym przesunięciem nic nie zmienia (element += 0).
    if (!this.origin.pending && this.renderer) {
      const E = this.origin._entries;
      for (let i = 0; i < E.length; i++) {
        const node = E[i].shiftNode;
        if (!node || this._warmed.has(node)) continue;
        this._warmed.add(node);
        try { this.renderer.compute(node, 1); } catch (err) { console.warn('[Core3D.fx] rozgrzewka kernela przesunięcia nie wyszła:', err?.message || err); }
      }
    }
  }

  _warmStep(step) {
    if (!step.warm || this._warmed.has(step) || !this.renderer) return;
    this._warmed.add(step);
    try {
      // Rejestr rozgrzewki (zadanie 11, Core3D.warmup.run): ta sama chwila i logika kroku, a czas i pipeline'y
      // kroku (prewarmPass) w jednym miejscu — flush() ekranu ładowania czeka na nie.
      const reg = this.core?.warmup;
      if (reg && typeof reg.run === 'function') reg.run(`Core3D.fx: ${step.name || '?'}`, () => step.warm(this.ctx));
      else step.warm(this.ctx);
    } catch (err) {
      console.warn(`[Core3D.fx] rozgrzewka kroku „${step.name || '?'}” nie wyszła:`, err?.message || err);
    }
  }

  /**
   * Kadr w świecie gry (x0, y0, x1, y1) z zapasem: kamera gracza 1 i — w podzielonym ekranie —
   * gracza 2 (jeden budżet siatki na klatkę, suma kadrów). bufW / bufH — cel sceny w px
   * (kamera ortho Core3D: pół kadru = bufW / 2 / zoom).
   */
  _viewRect(cam, cam2, bufW, bufH, freeCam) {
    const v = this.view;
    if (freeCam) {
      const px = Number(cam?.position?.x) || 0;
      const py = -(Number(cam?.position?.y) || 0);   // scena → świat gry
      v.x0 = px - FX_FREE_VIEW_HALF; v.x1 = px + FX_FREE_VIEW_HALF;
      v.y0 = py - FX_FREE_VIEW_HALF; v.y1 = py + FX_FREE_VIEW_HALF;
      return v;
    }
    let first = true;
    for (let k = 0; k < 2; k++) {
      const c = k === 0 ? cam : cam2;
      if (!c) continue;
      const zoom = Math.max(1e-4, Number(c.zoom) || 1);
      const hw = (bufW * 0.5 / zoom) * (1 + FX_VIEW_MARGIN);
      const hh = (bufH * 0.5 / zoom) * (1 + FX_VIEW_MARGIN);
      const cx = Number(c.x) || 0;
      const cy = Number(c.y) || 0;
      if (first) {
        v.x0 = cx - hw; v.x1 = cx + hw; v.y0 = cy - hh; v.y1 = cy + hh;
        first = false;
      } else {
        v.x0 = Math.min(v.x0, cx - hw); v.x1 = Math.max(v.x1, cx + hw);
        v.y0 = Math.min(v.y0, cy - hh); v.y1 = Math.max(v.y1, cy + hh);
      }
    }
    if (first) { v.x0 = -1; v.x1 = 1; v.y0 = -1; v.y1 = 1; }
    return v;
  }

  /**
   * Klatka efektów (raz na klatkę rAF — kolejne wywołania z tym samym renderer.info.frame
   * nic nie robią). cam — kamera gry gracza 1 (x, y, zoom albo wolna: position), cam2 — gracza 2
   * w podzielonym ekranie albo null, bufW / bufH — cel sceny w px, nowMs — performance.now().
   * Zwraca true, gdy klatka się wykonała.
   */
  frame(renderer, cam, cam2, bufW, bufH, freeCam, nowMs) {
    const frameId = renderer?.info?.frame ?? 0;
    if (frameId === this.frameId) return false;
    this.frameId = frameId;
    const t0 = nowMs;
    const info = renderer?.info?.compute;
    const calls0 = info ? info.frameCalls : 0;
    // Zegar efektów: klatka rAF (jak Fx3D — biegnie też w pauzie), krok ≤ FX_MAX_DT.
    const dt = this._clockMs >= 0 ? Math.min(FX_MAX_DT, Math.max(0, (nowMs - this._clockMs) * 0.001)) : 0;
    this._clockMs = nowMs;
    this.time += dt;
    this.dt = dt;
    const ctx = this.ctx;
    ctx.renderer = renderer;
    ctx.time = this.time;
    ctx.dt = dt;
    ctx.frame = frameId;
    this.post.exposure = 1;
    this.post.bloomBoost = 0;
    // Warstwa DIST: właściciele zgłaszają zawartość w tej klatce (OR — Core3D.setDistortLayerActive).
    this.distortLayerActive = false;
    const steps = this.steps;
    const n = steps.length;
    // 1. paczki z CPU (stara rama)
    for (let i = 0; i < n; i++) if (steps[i].spawn) steps[i].spawn(ctx);
    // 2. początek pul i zegary (układ SCENY: x, −y świata gry)
    const origin = this.origin;
    const camSX = freeCam ? Number(cam?.position?.x) : Number(cam?.x);
    const camSY = freeCam ? Number(cam?.position?.y) : -Number(cam?.y);
    origin.update(camSX, camSY, this.time, SimClock.sim, SimClock.render);
    // 3. przesunięcie żywych danych (raz po przeskoku)
    if (origin.pending && renderer) origin.dispatch(renderer);
    // 4. siatka świateł: kadr lokalnie (scena − początek), światła efektów, kroki
    const v = this._viewRect(cam, cam2, bufW, bufH, freeCam);
    const grid = this.grid;
    grid.begin(origin.x, origin.y);
    grid.setBounds(v.x0 - origin.x, -v.y1 - origin.y, v.x1 - origin.x, -v.y0 - origin.y);
    const lights = this.lights;
    if (lights.flashes > 0 || lights.points > 0) {
      lights.setView(v.x0, v.y0, v.x1, v.y1);
      lights.commit(grid, this.time);
    }
    // Starzenie PO zapisie: błysk zgłoszony w tej klatce (przed renderem) świeci od wieku 0 —
    // jak w demie broni (update przed strzałem).
    lights.update(dt);
    for (let i = 0; i < n; i++) if (steps[i].lights) steps[i].lights(ctx);
    const built = grid.count > 0 || this._gridLit;
    if (built) grid.build();
    this._gridLit = grid.count > 0;
    // 5. kroki pul
    for (let i = 0; i < n; i++) if (steps[i].update) steps[i].update(ctx);
    const s = this.stats;
    s.steps = n;
    s.lights = grid.count;
    s.gridItems = built ? grid.itemsUsed : 0;
    s.gridBuilt = built;
    s.dispatches = info ? Math.max(0, info.frameCalls - calls0) : 0;
    s.cpuMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : nowMs) - t0);
    return true;
  }

  /**
   * Źródła zniekształceń tej klatki (świat gry): `shock / implode / heat / add` z distortion.js.
   * Pierwsze zgłoszenie po renderze kasuje kolejkę poprzedniej klatki.
   */
  distortionSources() {
    const f = this.distortion;
    if (this._distortConsumed) {
      f.begin();
      this._distortConsumed = false;
    }
    return f;
  }

  /**
   * Na każdy render (przed postem): rzutuje źródła na kadr kamery `cam` i pakuje je do bloku
   * „uber”. off — bez źródeł (wolna kamera 3D, tło menu, perfToggles.fxDistortion = false).
   * frameId — renderer.info.frame: render następnej klatki bez nowych zgłoszeń kasuje kolejkę.
   * Zwraca liczbę spakowanych źródeł.
   */
  commitDistortion(cam, bufW, bufH, off, frameId) {
    const f = this.distortion;
    if (this._distortConsumed && frameId !== this._distortFrame) f.begin();
    this._distortConsumed = true;
    this._distortFrame = frameId;
    if (off) {
      f.begin();
      f.on = 0;
    } else {
      f.on = 1;
    }
    const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    const n = f.commit(Number(cam?.x) || 0, Number(cam?.y) || 0, zoom, Math.max(1, bufW | 0), Math.max(1, bufH | 0), this.time);
    this.stats.distortSources = n;
    return n;
  }
}
