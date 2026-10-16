// src/render/renderWorkerHost.js — strona trybu `worker` (docs/PLAN-render-worker.md § 3.1, § 3.8, RW-40a / RW-42).
//
// Tworzy worker renderu (src/render/render.worker.js), podaje mu zestaw stron migawki (SharedArrayBuffer pakującego)
// i kanał zwrotny RET, po każdej publikacji wysyła opisy, topologie, słownik i nowe zasoby (ImageBitmap z obrazów
// kadłubów), a klatkę 3D składa z nakładkami TEJ SAMEJ klatki — B2cr (src/render/overlayRing.js): kanwa gry `#c`
// jest niewidoczna (zostaje celem zdarzeń myszy), jej obraz klatki k idzie do kanwy pierścienia, a przy przyjściu
// bitmapy k — `transferFromImageBitmap` 3D i przełączenie widoczności kanw nakładek w jednym zadaniu.
//
// Moduł strony (DOM): tylko w trybie `?renderWorker=1`.

import { OverlayRing, OVERLAY_RING_DEFAULT } from './overlayRing.js';
import { createReturnBuffer, createReturnViews, retRecentConsumed, retReadStats, RET_I32, RET_F64, RET_FLAG, retHasFlag } from './returnLayout.js';
import { RW_WORKER_DISABLED } from './render.worker.js';
import { createEventRingBuffer, EventRingWriter } from './eventRing.js';

/** Dane ciał do workera: liczby, napisy, tablice i zwykłe obiekty do głębokości 5; bez funkcji, klas, `_pól` i cykli. */
function plainData(v, depth = 0, seen = new Set()) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (depth > 5 || seen.has(v)) return undefined;
  if (ArrayBuffer.isView(v)) return v.slice();
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return undefined;
  seen.add(v);
  let out;
  if (Array.isArray(v)) out = v.map((x) => plainData(x, depth + 1, seen));
  else {
    out = {};
    for (const k of Object.keys(v)) {
      if (k.charCodeAt(0) === 95) continue; // '_'
      const x = plainData(v[k], depth + 1, seen);
      if (x !== undefined) out[k] = x;
    }
  }
  seen.delete(v);
  return out;
}

function plainLayout(layout) {
  try { return structuredClone(layout); } catch (_) { return JSON.parse(JSON.stringify(layout)); }
}

export function createRenderWorkerHost({ packer, slots, commands = null, gameCanvas, mainCanvas = null, W, H, dpr = 1, quality = null, onError = null }) {
  const retBuffer = createReturnBuffer();
  const ret = createReturnViews(retBuffer);
  const worker = new Worker(new URL('./render.worker.js', import.meta.url), { type: 'module' });
  const parent = gameCanvas.parentNode;
  // obraz 3D (pod nakładkami) i pierścień kanw nakładek — przed kanwą gry, która zostaje na wierzchu dla zdarzeń
  const view3d = document.createElement('canvas');
  view3d.id = 'rw-3d';
  const ring = new OverlayRing(OVERLAY_RING_DEFAULT);
  const ringCanvases = [];
  const ringCtx = [];
  const place = (c, z) => {
    c.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:${z};visibility:hidden`;
    parent.insertBefore(c, gameCanvas);
  };
  place(view3d, 0);
  const bctx = view3d.getContext('bitmaprenderer');
  for (let i = 0; i < ring.count; i++) {
    const c = document.createElement('canvas');
    c.id = `rw-ov${i}`;
    c.width = W; c.height = H;
    place(c, 1);
    ringCanvases.push(c);
    ringCtx.push(c.getContext('2d'));
  }
  const recent = new Int32Array(RET_I32.CONS_RING);
  const host = {
    worker, ret, ring, ready: false, failed: null, frames: 0, composed: 0, lastPostedK: -1, lastCommittedK: -1,
    errors: [], stats: new Float64Array(RET_F64.COUNT), _shown: false, _dictSent: 0,
    _sentRes: [], _sentDefs: new Set(), _pendDesc: new Set(), _chain: Promise.resolve(), _W: W, _H: H
  };
  worker.onerror = (e) => { host.errors.push(`worker: ${e.message}`); if (onError) onError(e.message); };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') {
      host.ready = !!m.ok;
      if (!m.ok) host.failed = m.why || 'worker bez WebGPU';
      return;
    }
    if (m.type === 'error') {
      host.errors.push(`${m.where}: ${m.msg}`);
      console.error(`[render worker] ${m.where}: ${m.msg}`);
      return;
    }
    if (m.type === 'frame') compose(m.k, m.bmp);
  };

  function compose(k, bmp) {
    bctx.transferFromImageBitmap(bmp);
    const slot = ring.compose(k);
    if (slot >= 0) {
      if (ring.hidePrev >= 0) ringCanvases[ring.hidePrev].style.visibility = 'hidden';
      ringCanvases[slot].style.visibility = 'visible';
    }
    host.composed++;
    if (!host._shown) {
      host._shown = true;
      view3d.style.visibility = 'visible';
      gameCanvas.style.opacity = '0';
      // kanwa WebGPU strony (tło menu) — pod obrazem workera niewidoczna
      if (mainCanvas) mainCanvas.style.visibility = 'hidden';
    }
  }

  worker.postMessage({ type: 'init', W, H, dpr, retBuffer, quality, pageBase: location.href });
  const sendLayout = (buffer, layout) => worker.postMessage({ type: 'layout', buffer, layout: plainLayout(layout) });
  sendLayout(packer.buffer, packer.layout);
  packer.onLayout = sendLayout;
  // Strumień rozkazów (RW-21 / 22): pierścień pisarza na SharedArrayBuffer, czytelnik i dekodery w workerze (RW-40b);
  // na stronie bez dyspozytora. Napisy (rekordy STR) od nowa — wcześniejsze poszły do czytelnika strony.
  if (commands) {
    const w = commands.writer;
    const buf = createEventRingBuffer(1 << 16, { shared: true });
    w.buffer = buf;
    w.ring = new EventRingWriter(buf, { shared: true, onGrow: (b) => { w.buffer = b; worker.postMessage({ type: 'cmdRing', buffer: b }); } });
    w._strIds.clear();
    w._strNext = 0;
    w.setInlineSink(null);
    worker.postMessage({ type: 'cmdRing', buffer: buf });
  }
  console.info(`[render worker] tryb worker (RW-40a). W workerze wyłączone: ${RW_WORKER_DISABLED.join(', ')}.`);

  /** Ostatnio odebrana przez worker strona (reguła pakowania węzłów: zmiany od tej strony). */
  host.lastConsumed = () => Atomics.load(ret.i32, RET_I32.LAST_CONSUMED);
  host.gpuReady = () => retHasFlag(ret, RET_FLAG.GPU_READY);

  /** Po publikacji strony k (packer.finish): opisy, topologie, słownik i nowe zasoby tej strony. */
  host.postFrame = () => {
    const p = packer;
    const k = p.k;
    // rekordy rozkazów tej strony: klatki pisarza do ostatniej zamkniętej (RenderCommands.endFrame przed fazą 2 migawki)
    const evFrame = commands ? commands.writer.frame - 1 : -1;
    const msg = { type: 'frame', k, evFrame, skyZone: host._skyZone || null, dust: host.dustOn !== false, ringQuality: host.ringQuality || null, desc: [], topo: [], cores: [], stations: [], res: [], dictFrom: host._dictSent, dict: null };
    const pending = [];
    // opisy nowe z tej strony i odłożone (obraz kadłuba jeszcze się wczytywał — opis idzie razem z gotowym obrazem;
    // łańcuch wiadomości nie może czekać na obraz bez końca)
    for (const s of p.descQueue) host._pendDesc.add(s);
    for (const s of host._pendDesc) {
      const rec = p.descriptors[s];
      if (!rec) { host._pendDesc.delete(s); continue; }
      let ok = true;
      for (let q = 0; q < 3 && ok; q++) {
        const rs = rec.res[q];
        const img = rs >= 0 ? slots.resources.objectAt(rs) : null;
        if (img && img.tagName === 'IMG' && !(img.complete && img.naturalWidth > 0)) ok = false;
      }
      if (!ok) continue;
      host._pendDesc.delete(s);
      msg.desc.push(s, rec);
      for (let q = 0; q < 3; q++) {
        const rs = rec.res[q];
        if (rs < 0) continue;
        const img = slots.resources.objectAt(rs);
        if (!img || host._sentRes[rs] === img) continue;
        host._sentRes[rs] = img;
        pending.push(rs, img);
      }
    }
    for (const bs of p.topoQueue) msg.topo.push(bs, p.topologies[bs]);
    for (const uid of p.coreQueue) msg.cores.push(uid, p.coreDescs.get(uid));
    for (const s of p.stationQueue) msg.stations.push(s, p.stationDescs[s]);
    // definicje broni rakiet w locie (raz na id — blok ROCKETS niesie samo id)
    const pool = typeof window !== 'undefined' && window.rocketSystem3D ? window.rocketSystem3D.rockets : null;
    if (pool) {
      for (let i = 0; i < pool.length; i++) {
        const def = pool[i] && pool[i].active ? pool[i].weaponDef : null;
        if (!def || !def.id || host._sentDefs.has(def.id)) continue;
        host._sentDefs.add(def.id);
        (msg.weaponDefs || (msg.weaponDefs = [])).push(def.id, plainData(def));
      }
    }
    const dv = p.dict.values;
    msg.dict = dv.slice(host._dictSent);
    host._dictSent = dv.length;
    host.lastPostedK = k;
    // kolejność wiadomości = kolejność stron (bitmapy zasobów asynchronicznie — następne strony czekają w łańcuchu);
    // błąd jednej wiadomości (np. opis z obiektem nie do sklonowania) nie może zatrzymać łańcucha
    const send = (transfer) => {
      try { worker.postMessage(msg, transfer); return; } catch (err) { host.errors.push(`wiadomość k=${k}: ${err?.message || err}`); }
      for (let i = 1; i < msg.desc.length; i += 2) msg.desc[i] = plainData(msg.desc[i]);
      try { worker.postMessage(msg, transfer); } catch (err) { host.errors.push(`wiadomość k=${k} (oczyszczona): ${err?.message || err}`); worker.postMessage({ type: 'frame', k, evFrame: msg.evFrame, desc: [], topo: [], cores: [], stations: [], res: [], dictFrom: msg.dictFrom, dict: msg.dict }); }
    };
    if (pending.length === 0) {
      host._chain = host._chain.then(() => send(undefined), (err) => { host.errors.push(String(err)); send(undefined); });
      return;
    }
    host._chain = host._chain.then(async () => {
      const transfer = [];
      for (let i = 0; i < pending.length; i += 2) {
        const img = pending[i + 1];
        try {
          const bmp = await Promise.race([createImageBitmap(img), new Promise((_, no) => setTimeout(() => no(new Error('createImageBitmap: limit czasu')), 3000))]);
          msg.res.push(pending[i], bmp);
          transfer.push(bmp);
        } catch (err) {
          host.errors.push(`zasób ${pending[i]}: ${err?.message || err}`);
        }
      }
      send(transfer);
    }).catch((err) => { host.errors.push(`łańcuch: ${err?.message || err}`); });
  };

  /** Nakładki klatki k gotowe na kanwie gry — kopia do kanwy pierścienia (B2cr). */
  host.commitOverlay = (k) => {
    if (k !== host.lastPostedK || k === host.lastCommittedK) return;
    host.lastCommittedK = k;
    const n = retRecentConsumed(ret, recent);
    const slot = ring.acquire(k, recent, n);
    const c = ringCanvases[slot], cx = ringCtx[slot];
    if (c.width !== gameCanvas.width || c.height !== gameCanvas.height) { c.width = gameCanvas.width; c.height = gameCanvas.height; }
    cx.clearRect(0, 0, c.width, c.height);
    cx.drawImage(gameCanvas, 0, 0);
  };

  host.resize = (w, h) => {
    if (w === host._W && h === host._H) return;
    host._W = w; host._H = h;
    const css = (c) => { c.style.width = `${w}px`; c.style.height = `${h}px`; };
    css(view3d);
    for (const c of ringCanvases) css(c);
  };

  // Planety, słońce i małe ciała (RW-40b): dane ciał (zwykłe obiekty — bez funkcji, obiektów three i cykli) przy
  // zmianie położeń / promieni (nowa gra losuje kąty planet); strefa nieba — w każdej wiadomości `frame`.
  host._planetSig = '';
  host.syncPlanets = (planets, sun, small, skyZone) => {
    host._skyZone = skyZone || null;
    let sig = '';
    const add = (b) => { if (b) sig += `${b.id || b.name}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.r || b.radius || 0)};`; };
    add(sun);
    if (planets) for (const p of planets) add(p);
    if (small) for (const p of small) add(p);
    if (sig === host._planetSig) return;
    host._planetSig = sig;
    worker.postMessage({ type: 'planets', planets: plainData(planets || []), sun: plainData(sun), small: plainData(small || []), quality: host.ringQuality || 'high' });
  };

  host.readStats = () => retReadStats(ret, host.stats);
  host.stop = () => {
    worker.terminate();
    gameCanvas.style.opacity = '';
    if (mainCanvas) mainCanvas.style.visibility = '';
    view3d.remove();
    for (const c of ringCanvases) c.remove();
  };
  return host;
}
