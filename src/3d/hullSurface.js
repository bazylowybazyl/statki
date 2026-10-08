// src/3d/hullSurface.js
//
// Mapy powierzchni kadłubów w grze (oświetlenie v2, src/3d/hullLighting.js): jedna mapa na obraz
// sprite'a (normalne, AO, relief — src/3d/hullSurfaceBake.js), wspólna dla wszystkich kadłubów,
// wraków i partii z tym obrazem. Jak mapa kształtu lakieru: obiekt `{ value }` per obraz z
// licznikiem referencji — wypiek podmienia teksturę wszystkim materiałom naraz; do tego czasu
// mapa płaska (normalna w górę, AO 1, relief 0 — kadłub oświetlony jak płyta).
//
// Wypiek poza wątkiem gry: createImageBitmap ze skalowaniem do rozmiaru mapy, rachunki w workerze
// (hullSurfaceWorker.js); jeden obraz naraz (kolejka). Bez workera (stare przeglądarki, testy) —
// na wątku gry przez kanwę. Ekran ładowania może wypiec znane kadłuby z góry (`prebake`).
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { bakeHullSurfaceField, hullSurfaceSize } from './hullSurfaceBake.js';

// Dłuższy bok mapy: Atlas (3747 px) → 1536 tekseli = 2,4 px sprite'a na teksel (przy zoomie 1
// ~2 px ekranu — normalne paneli ostre do zbliżeń; dalej i tak próbkują mipmapy).
export const HULL_SURFACE_MAX_SIDE = 1536;

function makeFlatTexture() {
  // Normalna (0, 0, 1) = (128, 128), AO 1, relief 0 (A = 0,5). Filtr liniowy: TSL wybiera ścieżkę
  // próbkowania z tekstury obecnej przy budowie materiału (NEAREST = textureLoad bez poziomów mip).
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'hullSurface:plaska';
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export const HULL_SURFACE_FLAT = makeFlatTexture();

function imageSize(image) {
  const w = Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0;
  const h = Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0;
  return { w, h };
}

function isImageReady(image) {
  if (!image) return false;
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && !image.complete) return false;
  const { w, h } = imageSize(image);
  return w > 0 && h > 0;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function createSurfaceTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'hullSurface';
  t.flipY = false; // wiersz 0 = góra obrazu (jak sprite: v = 0 u góry)
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export const HullSurface = {
  flatUniform: { value: HULL_SURFACE_FLAT },
  maxSide: HULL_SURFACE_MAX_SIDE,
  // Nadpisania HULL_SURFACE_DEFAULTS (strojenie: HullSurface.options = {...}; HullSurface.rebakeAll()).
  options: {},
  _entries: new WeakMap(),
  _live: [],
  _pending: [],
  _job: null,
  _seq: 0,
  _worker: null,
  _workerBroken: false,
  _waiters: [],
  stats: { baked: 0, failed: 0, lastMs: 0, maxMs: 0, worker: 0, mainThread: 0 },

  /** Obiekt `{ value: tekstura }` wspólny dla kadłubów z tym obrazem (licznik referencji). */
  acquireUniform(image) {
    if (!image) return this.flatUniform;
    let entry = this._entries.get(image);
    if (!entry) {
      entry = { image, refs: 0, texture: null, state: 'pending', uniform: { value: HULL_SURFACE_FLAT } };
      this._entries.set(image, entry);
      this._live.push(entry);
      this._pending.push(entry);
    }
    entry.refs++;
    return entry.uniform;
  },

  releaseUniform(image) {
    if (!image) return;
    const entry = this._entries.get(image);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    entry.texture?.dispose?.();
    entry.texture = null;
    entry.uniform.value = HULL_SURFACE_FLAT;
    entry.state = 'released';
    this._entries.delete(image);
    const idx = this._pending.indexOf(entry);
    if (idx >= 0) this._pending.splice(idx, 1);
    const li = this._live.indexOf(entry);
    if (li >= 0) this._live.splice(li, 1);
  },

  /** Strojenie wypieku na żywo: wszystkie żywe mapy wracają do kolejki (stara tekstura do czasu nowej). */
  rebakeAll(options = null) {
    if (options) this.options = { ...options };
    this._job = null;
    const live = [];
    // Żywe wpisy z listy _live (WeakMap obrazów nie ma iteracji).
    for (const entry of this._live) if (entry.refs > 0) { entry.state = 'pending'; live.push(entry); }
    this._live = live;
    this._pending = live.slice();
    return live.length;
  },

  /** Czy mapa obrazu jest gotowa (testy, harness). */
  isReady(image) {
    return this._entries.get(image)?.state === 'ready';
  },

  /** Raz na klatkę: następny obraz do workera, gdy poprzedni skończony. */
  pump() {
    if (this._job) return;
    for (let n = this._pending.length; n > 0; n--) {
      const entry = this._pending.shift();
      if (entry.refs <= 0 || entry.state !== 'pending') continue;
      if (!isImageReady(entry.image)) {
        this._pending.push(entry);
        continue;
      }
      this._start(entry);
      return;
    }
    if (!this._busy()) this._wake();
  },

  /** Czy coś jeszcze czeka na wypiek albo wysyłkę (obrazy jeszcze niewczytane też). */
  _busy() {
    if (this._job) return true;
    for (const e of this._live) {
      if (e.refs > 0 && (e.state === 'pending' || e.state === 'baking' || e.state === 'uploading')) return true;
    }
    return false;
  },

  /**
   * Ekran ładowania: wypiek map podanych obrazów z góry (bez tego pierwszy kadłub danego typu
   * przez ~0,3 s świeci płasko). Referencja trzymana do końca gry (obrazy kadłubów i tak żyją).
   */
  prebake(images, timeoutMs = 8000) {
    for (const img of images || []) if (img) this.acquireUniform(img);
    return this.whenIdle(timeoutMs);
  },

  /** Promise: kolejka pusta (albo limit czasu). */
  whenIdle(timeoutMs = 8000) {
    if (!this._busy()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => { this._waiters = this._waiters.filter((x) => x !== w); resolve(false); }, timeoutMs);
      this._waiters.push(w);
      this._kick();
    });
  },

  _kick() {
    // Poza pętlą gry (ekran ładowania): pompujemy sami, póki ktoś czeka.
    if (this._kicking) return;
    this._kicking = true;
    const tick = () => {
      this.pump();
      if (this._waiters.length) setTimeout(tick, 16);
      else this._kicking = false;
    };
    setTimeout(tick, 0);
  },

  _wake() {
    if (!this._waiters.length) return;
    const list = this._waiters;
    this._waiters = [];
    for (const w of list) { clearTimeout(w.timer); w.resolve(true); }
  },

  _ensureWorker() {
    if (this._worker || this._workerBroken) return this._worker;
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
      this._workerBroken = true;
      return null;
    }
    try {
      const w = new Worker(new URL('./hullSurfaceWorker.js', import.meta.url), { type: 'module', name: 'hull-surface' });
      w.onmessage = (ev) => this._onMessage(ev.data);
      w.onerror = (err) => {
        console.warn('[HullSurface] worker padł — wypiek na wątku gry:', err?.message || err);
        this._workerBroken = true;
        this._worker = null;
        const job = this._job;
        if (job) { this._job = null; this._bakeMainThread(job.entry); }
      };
      this._worker = w;
    } catch (err) {
      console.warn('[HullSurface] bez workera:', err);
      this._workerBroken = true;
    }
    return this._worker;
  },

  _start(entry) {
    const { w: iw, h: ih } = imageSize(entry.image);
    const size = hullSurfaceSize(iw, ih, this.maxSide);
    const job = { id: ++this._seq, entry, t0: performance.now(), w: size.w, h: size.h, pxPerTexel: iw / size.w };
    entry.state = 'baking';
    this._job = job;
    const worker = this._ensureWorker();
    if (!worker) {
      this._job = null;
      this._bakeMainThread(entry);
      return;
    }
    createImageBitmap(entry.image, { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'high' })
      .then((bitmap) => {
        if (this._job !== job) { bitmap.close?.(); return; }
        worker.postMessage({ id: job.id, bitmap, w: size.w, h: size.h, pxPerTexel: job.pxPerTexel, options: this.options }, [bitmap]);
      })
      .catch((err) => {
        console.warn('[HullSurface] createImageBitmap:', err);
        if (this._job === job) { this._job = null; this._bakeMainThread(entry); }
      });
  },

  _onMessage(msg) {
    const job = this._job;
    if (!job || !msg || msg.id !== job.id) return;
    this._job = null;
    if (!msg.ok) {
      console.warn('[HullSurface] wypiek nieudany:', msg.error);
      this.stats.failed++;
      job.entry.state = 'failed';
      return;
    }
    this.stats.worker++;
    this._finish(job.entry, new Uint8Array(msg.data), msg.w, msg.h, performance.now() - job.t0);
  },

  _bakeMainThread(entry) {
    const t0 = performance.now();
    try {
      const { w: iw, h: ih } = imageSize(entry.image);
      const size = hullSurfaceSize(iw, ih, this.maxSide);
      const canvas = makeCanvas(size.w, size.h);
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('brak kanwy 2D');
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.drawImage(entry.image, 0, 0, size.w, size.h);
      const px = ctx.getImageData(0, 0, size.w, size.h).data;
      const data = bakeHullSurfaceField(px, size.w, size.h, iw / size.w, this.options);
      this.stats.mainThread++;
      this._finish(entry, data, size.w, size.h, performance.now() - t0);
    } catch (err) {
      console.warn('[HullSurface] wypiek na wątku gry nieudany:', err);
      this.stats.failed++;
      entry.state = 'failed';
    }
  },

  _finish(entry, data, w, h, ms) {
    this.stats.baked++;
    this.stats.lastMs = Math.round(ms);
    this.stats.maxMs = Math.max(this.stats.maxMs, this.stats.lastMs);
    if (entry.refs <= 0) { entry.state = 'released'; return; }
    const tex = createSurfaceTexture(data, w, h);
    entry.state = 'uploading';
    // Wysyłka i mipmapy w wolnej chwili (nie w klatce pierwszego rysunku kadłuba); do tego czasu
    // materiały czytają poprzednią mapę (płaską albo starą przy rebakeAll).
    const apply = () => {
      if (entry.refs <= 0 || entry.state !== 'uploading') { tex.dispose(); return; }
      try {
        if (Core3D.gpuReady && Core3D.renderer && typeof Core3D.renderer.initTexture === 'function') Core3D.renderer.initTexture(tex);
      } catch (err) {
        console.warn('[HullSurface] wysyłka mapy:', err?.message || err);
      }
      const old = entry.texture;
      entry.texture = tex;
      entry.uniform.value = tex;
      entry.state = 'ready';
      if (old && old !== tex) old.dispose();
      if (!this._busy()) this._wake();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(apply, { timeout: 250 });
    else apply();
  }
};

if (typeof window !== 'undefined') window.HullSurface = HullSurface;
