// src/render/renderBridge.js — wybór trybu szwu renderu (docs/PLAN-render-worker.md § 3.1, RW-40).
//
// Tryby:
//   off    — wywołania modułów renderu wprost na wątku gry (`?renderWorker=0`; zapas);
//   pakuj  — samo pakowanie migawki (pomiar kosztu szwu, `?szew=pakuj`);
//   inline — migawka, lustra i rozkazy na wątku głównym (`?szew=inline`, zapas trybu worker);
//   worker — render w Web Workerze z OffscreenCanvas — DOMYŚLNY od RW-41c (D8, decyzja użytkownika 2026-10-16;
//            `?renderWorker=1` wymusza, `?renderWorker=0` = off).
// Tryb `worker` wymaga izolacji (SharedArrayBuffer — migawka, RET, pierścień rozkazów), `OffscreenCanvas`
// z `transferControlToOffscreen` i `ImageBitmapRenderingContext` (kompozycja B2cr); bez nich — `inline` z powodem.
// Czy WebGPU działa w workerze, rozstrzyga dopiero worker (adapter) — wtedy RET_FLAG.GPU_UNSUPPORTED.
//
// Czysty moduł (bez DOM): możliwości podaje wołający (`renderWorkerCaps(globalThis)` w stronie).

export const RENDER_MODES = Object.freeze(['off', 'pakuj', 'inline', 'worker']);

/** Możliwości środowiska potrzebne trybowi `worker` (z obiektu globalnego strony). */
export function renderWorkerCaps(g) {
  const canvasProto = g && g.HTMLCanvasElement && g.HTMLCanvasElement.prototype;
  return {
    isolated: !!(g && g.crossOriginIsolated === true),
    shared: !!(g && typeof g.SharedArrayBuffer === 'function'),
    atomics: !!(g && typeof g.Atomics === 'object'),
    worker: !!(g && typeof g.Worker === 'function'),
    offscreen: !!(g && typeof g.OffscreenCanvas === 'function' && canvasProto &&
      typeof canvasProto.transferControlToOffscreen === 'function'),
    bitmapRenderer: !!(g && typeof g.ImageBitmapRenderingContext === 'function')
  };
}

/** Pierwszy brak możliwości trybu `worker` albo null. */
export function renderWorkerBlocker(caps) {
  if (!caps.worker) return 'brak Worker';
  if (!caps.shared || !caps.atomics) return 'brak SharedArrayBuffer / Atomics';
  if (!caps.isolated) return 'strona bez izolacji (COOP / COEP)';
  if (!caps.offscreen) return 'brak OffscreenCanvas.transferControlToOffscreen';
  if (!caps.bitmapRenderer) return 'brak ImageBitmapRenderingContext';
  return null;
}

/**
 * Tryb z adresu: `?renderWorker=1` → worker (albo inline z powodem, gdy środowisko nie pozwala), `?szew=inline|pakuj`,
 * domyślnie `def` (`worker` — bez izolacji / OffscreenCanvas zapas `inline` z powodem). Zwraca `{ mode, requested, fallback }`.
 */
export function resolveRenderMode(search, caps, def = 'worker') {
  let params = null;
  try { params = new URLSearchParams(search || ''); } catch (_) { params = null; }
  const rw = params ? params.get('renderWorker') : null;
  const szew = params ? params.get('szew') : null;
  let requested = def;
  if (rw === '1' || rw === 'true') requested = 'worker';
  else if (rw === '0' || rw === 'false') requested = szew && RENDER_MODES.includes(szew) && szew !== 'worker' ? szew : 'off';
  else if (szew && RENDER_MODES.includes(szew)) requested = szew;
  if (requested !== 'worker') return { mode: requested, requested, fallback: null };
  const blocker = caps ? renderWorkerBlocker(caps) : 'brak opisu środowiska';
  if (blocker) return { mode: 'inline', requested, fallback: blocker };
  return { mode: 'worker', requested, fallback: null };
}
