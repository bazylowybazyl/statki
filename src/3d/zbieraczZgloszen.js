// src/3d/zbieraczZgloszen.js — zbieranie zgłoszeń kolejki WebGPU w jedno `queue.submit` na klatkę (2026-10-17,
// docs/AUDYT-render-worker-2026-10-17.md § 7.3).
//
// Po co: three r183 robi `queue.submit` przy KAŻDYM `renderer.render`, `renderer.compute` i `renderer.clear` (passy
// sceny, czyszczenia głębi między nimi, kroki efektów, maska słońca, bloom, post — ~20 na klatkę). W Chrome każde
// zgłoszenie to też natychmiastowe opróżnienie strumienia poleceń (`FlushNow`) — w procesie GPU osobne zadanie
// dekodowania (`CommandBufferService:PutChanged`) i `Queue::Submit` z wykonaniem list poleceń D3D12, sygnałem płotu
// i pilnowaniem rezydencji: ~40–50 µs samego zgłoszenia + ~20–50 µs zadania, niezależnie od jego treści. Przy
// 5120 × 1440 / 240 Hz wątek `CrGpuMain` był zajęty w 96%, z tego `Queue::Submit` 30%.
//
// Jak: `queue.submit` odkłada bufory poleceń; wysyła je RAZEM (jedno zgłoszenie) na końcu klatki Core3D albo wcześniej
// — gdy cokolwiek mogłoby zobaczyć różnicę. Kolejność na osi kolejki: `writeBuffer` / `writeTexture` /
// `copyExternalImageToTexture` dzieje się w chwili wywołania, a odłożone bufory poleceń wykonają się dopiero po nim.
// Zapis do zasobu, którego NIE używa żaden odłożony bufor poleceń, jest więc dla nich niewidoczny — wynik ten sam co
// przy zgłoszeniach od razu. Zapis do zasobu UŻYWANEGO (czytanego albo pisanego) przez odłożone polecenia najpierw
// wysyła odłożone (KONFLIKT) — tak jak było. Śledzenie użyć: każdy enkoder dostaje numer; zasób pamięta najwyższy
// numer enkodera, który go użył (grupy wiązań — zbiór buforów i tekstur z `createBindGroup`, bufory wierzchołków
// i indeksów, bufory pośrednie, załączniki passów, kopie, rozwiązania zapytań, paczki rysunków). Zasób z numerem
// ≥ najmniejszego numeru odłożonego bufora poleceń = konflikt (zachowawczo: także gdy używa go dopiero nagrywany
// enkoder — wysłanie wcześniej jest zawsze poprawne). Wysłanie przed: zniszczeniem używanego zasobu, `mapAsync`,
// `onSubmittedWorkDone`, zakresami błędów, zmianą konfiguracji kanwy, odczytem kanwy (`transferToImageBitmap`,
// `drawImage`, `convertToBlob` …) i — siatka bezpieczeństwa — w mikrozadaniu na końcu bieżącego
// zadania (nic nie czeka do następnego zadania; kanwa WebGPU w DOM prezentuje się po mikrozadaniach).
// Obiekty sprzed instalacji (bez numeru) liczą się jako konflikt z każdym zapisem — zachowawczo.
//
// Instalacja raz na realm (strona albo worker renderu), na prototypach WebGPU — przed utworzeniem urządzenia
// (Core3D._initGpu). A/B: `Core3D.submitBatching = false` (zgłoszenia od razu, jak three). Strażnik semantyki:
// tests/zbieraczZgloszen.test.mjs (losowe ciągi zapisów, poleceń, zgłoszeń i niszczeń na atrapie kolejki — odczyty
// poleceń identyczne jak przy zgłoszeniach od razu).

/** Powody wysłania odłożonych zgłoszeń (indeksy `stats.reasons`). */
export const ZGLOSZENIE_POWOD = Object.freeze({
  KADR: 0,          // koniec klatki Core3D (render / renderBackdrop)
  MIKRO: 1,         // mikrozadanie na końcu zadania (siatka bezpieczeństwa)
  ZAPIS_BUFORA: 2,  // queue.writeBuffer do zasobu odłożonych poleceń
  ZAPIS_TEKSTURY: 3,
  KOPIA_OBRAZU: 4,  // copyExternalImageToTexture
  NISZCZENIE: 5,    // destroy() używanego zasobu
  MAPOWANIE: 6,     // mapAsync
  CZEKANIE: 7,      // onSubmittedWorkDone
  KANWA: 8,         // odczyt kanwy (transferToImageBitmap, drawImage, convertToBlob)
  KONFIGURACJA: 9,  // configure / unconfigure kanwy, zakresy błędów, destroy urządzenia
  LIMIT: 10,        // limit odłożonych buforów (maxPending)
  WYLACZONE: 11,    // zbieranie wyłączone
  OBCY: 12          // bufor poleceń bez numeru albo inna kolejka
});
export const ZGLOSZENIE_POWODY = Object.freeze(['kadr', 'mikro', 'zapisBufora', 'zapisTekstury', 'kopiaObrazu',
  'niszczenie', 'mapowanie', 'czekanie', 'kanwa', 'konfiguracja', 'limit', 'wylaczone', 'obcy']);

/**
 * Stan zbierania (jeden na realm). `enabled` — A/B (false: każde zgłoszenie od razu); `maxPending` — najwięcej
 * odłożonych buforów poleceń przed wysłaniem (0 = bez limitu: jedno zgłoszenie na klatkę, o ile nie ma konfliktów).
 * `stats` — liczniki od instalacji: `requested` (wywołania queue.submit), `sent` (prawdziwe zgłoszenia), `buffers`
 * (bufory poleceń), `reasons[powód]`; `frameRequested` / `frameSent` — ostatnia klatka (flush z KADR).
 */
export const ZBIERACZ = {
  installed: false,
  enabled: true,
  maxPending: 0,
  queue: null,
  pending: [],
  n: 0,
  pendingMin: Infinity,
  encSeq: 0,
  unsafe: -1,          // najwyższy numer enkodera, który użył zasobu nieznanego (obiekt sprzed instalacji)
  microQueued: false,
  /** Diagnostyka: (zasób, powód) przy wysłaniu z konfliktu zapisu / zniszczenia — narzędzia (kto wymusza zgłoszenie). */
  onConflict: null,
  stats: {
    requested: 0, sent: 0, buffers: 0, reasons: new Float64Array(ZGLOSZENIE_POWODY.length), sendMs: 0,
    frameRequested: 0, frameSent: 0, _fr0: 0, _fs0: 0
  }
};

const Z = ZBIERACZ;
// prototyp GPUQueue realmu → oryginalne submit (wysyłka odłożonych idzie oryginałem kolejki, która je zgłosiła)
const origSubmitOf = new WeakMap();

/** Wysyła odłożone bufory poleceń (jedno queue.submit). Zwraca liczbę wysłanych buforów. */
export function wyslijZgloszenia(powod = ZGLOSZENIE_POWOD.KADR) {
  const n = Z.n;
  if (n > 0) {
    const arr = Z.pending;
    const q = Z.queue;
    Z.n = 0;
    Z.pendingMin = Infinity;
    Z.queue = null;
    const s = Z.stats;
    const t0 = performance.now();
    try {
      origSubmitOf.get(Object.getPrototypeOf(q)).call(q, arr);
    } finally {
      arr.length = 0;
      s.sendMs += performance.now() - t0;
    }
    s.sent++;
    s.reasons[powod]++;
  }
  if (powod === ZGLOSZENIE_POWOD.KADR) {
    const s = Z.stats;
    s.frameRequested = s.requested - s._fr0;
    s.frameSent = s.sent - s._fs0;
    s._fr0 = s.requested;
    s._fs0 = s.sent;
  }
  return n;
}

function microFlush() {
  Z.microQueued = false;
  if (Z.n > 0) wyslijZgloszenia(ZGLOSZENIE_POWOD.MIKRO);
}

// Zasób `r` użyty przez enkoder `id` — numer najwyższy (enkodery bywają nagrywane naprzemiennie: render zagnieżdżony
// w passie — mapa cienia w updateBefore — zgłasza się przed zewnętrznym).
function mark(r, id) {
  if (r !== null && r !== undefined && !(r.__zq >= id)) r.__zq = id;
}

function markView(v, id) {
  if (v === null || v === undefined) return;
  const t = v.__zt;
  if (t !== undefined) mark(t, id);
  else if (!(Z.unsafe >= id)) Z.unsafe = id;
}

// Konflikt zapisu / zniszczenia zasobu `r` z odłożonymi buforami poleceń.
function conflict(r) {
  if (Z.n === 0) return false;
  const pm = Z.pendingMin;
  return r.__zq >= pm || Z.unsafe >= pm;
}

function markGroup(g, id) {
  if (g === null || g === undefined || g.__zm === id) return;
  g.__zm = id;
  const res = g.__zr;
  if (res === undefined) { if (!(Z.unsafe >= id)) Z.unsafe = id; return; }
  for (let i = 0; i < res.length; i++) mark(res[i], id);
}

function markPassDesc(desc, id) {
  if (!desc) return;
  const ca = desc.colorAttachments;
  if (ca) {
    for (let i = 0; i < ca.length; i++) {
      const a = ca[i];
      if (!a) continue;
      markView(a.view, id);
      if (a.resolveTarget) markView(a.resolveTarget, id);
    }
  }
  const ds = desc.depthStencilAttachment;
  if (ds) markView(ds.view, id);
  if (desc.occlusionQuerySet) mark(desc.occlusionQuerySet, id);
  if (desc.timestampWrites && desc.timestampWrites.querySet) mark(desc.timestampWrites.querySet, id);
}

function wrap(proto, name, make) {
  if (!proto) return;
  const orig = proto[name];
  if (typeof orig !== 'function' || orig.__zbieracz) return;
  const fn = make(orig);
  fn.__zbieracz = true;
  fn.__orig = orig;
  proto[name] = fn;
}

function flushIfPending(powod) {
  if (Z.n > 0) wyslijZgloszenia(powod);
}

const realms = new WeakSet();

// Klasy WebGPU i kanw bieżącego realmu (wolne identyfikatory — moduł nie bierze okna jako wartości: szew renderu).
function realmClasses() {
  const t = (f) => { try { return f(); } catch (_) { return undefined; } };
  return {
    GPUQueue: t(() => GPUQueue), GPUDevice: t(() => GPUDevice), GPUCommandEncoder: t(() => GPUCommandEncoder),
    GPURenderPassEncoder: t(() => GPURenderPassEncoder), GPUComputePassEncoder: t(() => GPUComputePassEncoder),
    GPURenderBundleEncoder: t(() => GPURenderBundleEncoder), GPUTexture: t(() => GPUTexture), GPUBuffer: t(() => GPUBuffer),
    GPUQuerySet: t(() => GPUQuerySet), GPUTextureView: t(() => GPUTextureView), GPUCanvasContext: t(() => GPUCanvasContext),
    OffscreenCanvas: t(() => OffscreenCanvas), CanvasRenderingContext2D: t(() => CanvasRenderingContext2D),
    OffscreenCanvasRenderingContext2D: t(() => OffscreenCanvasRenderingContext2D)
  };
}

/**
 * Instaluje zbieranie w realmie (strona albo worker renderu; `g` — klasy realmu, domyślnie bieżącego — testy podają
 * atrapę). Bezpieczne do wielokrotnego wołania. Zwraca ZBIERACZ (albo null bez WebGPU).
 */
export function zainstalujZbieranieZgloszen(g = null) {
  if (!g) g = realmClasses();
  const GQ = g.GPUQueue;
  const GD = g.GPUDevice;
  const GCE = g.GPUCommandEncoder;
  if (!GQ || !GD || !GCE) return null;
  if (realms.has(GQ)) return Z;
  realms.add(GQ);
  Z.installed = true;
  const GRP = g.GPURenderPassEncoder && g.GPURenderPassEncoder.prototype;
  const GCP = g.GPUComputePassEncoder && g.GPUComputePassEncoder.prototype;
  const GRB = g.GPURenderBundleEncoder && g.GPURenderBundleEncoder.prototype;
  const GT = g.GPUTexture && g.GPUTexture.prototype;
  const GB = g.GPUBuffer && g.GPUBuffer.prototype;
  const GQS = g.GPUQuerySet && g.GPUQuerySet.prototype;
  const GBufferCtor = g.GPUBuffer || null;
  const GTextureCtor = g.GPUTexture || null;
  const GViewCtor = g.GPUTextureView || null;

  // --- kolejka ---
  origSubmitOf.set(GQ.prototype, GQ.prototype.submit);
  wrap(GQ.prototype, 'submit', (orig) => function submit(cbs) {
    const s = Z.stats;
    s.requested++;
    const len = cbs ? cbs.length : 0;
    s.buffers += len;
    if (!Z.enabled) {
      if (Z.n > 0) wyslijZgloszenia(ZGLOSZENIE_POWOD.WYLACZONE);
      s.sent++;
      return orig.call(this, cbs);
    }
    if (Z.n > 0 && Z.queue !== this) wyslijZgloszenia(ZGLOSZENIE_POWOD.OBCY);
    for (let i = 0; i < len; i++) {
      const cb = cbs[i];
      const id = cb ? cb.__zq : undefined;
      if (id === undefined) {
        // bufor poleceń bez numeru (enkoder sprzed instalacji) — odłożone najpierw, ten od razu
        if (Z.n > 0) wyslijZgloszenia(ZGLOSZENIE_POWOD.OBCY);
        s.sent++;
        s.reasons[ZGLOSZENIE_POWOD.OBCY]++;
        orig.call(this, [cb]);
        continue;
      }
      Z.queue = this;
      Z.pending.push(cb);
      Z.n++;
      if (id < Z.pendingMin) Z.pendingMin = id;
    }
    if (Z.n > 0) {
      if (Z.maxPending > 0 && Z.n >= Z.maxPending) wyslijZgloszenia(ZGLOSZENIE_POWOD.LIMIT);
      else if (!Z.microQueued) { Z.microQueued = true; queueMicrotask(microFlush); }
    }
    return undefined;
  });
  wrap(GQ.prototype, 'writeBuffer', (orig) => function writeBuffer(buffer, offset, data, dataOffset, size) {
    if (Z.n > 0 && buffer && conflict(buffer)) {
      if (Z.onConflict) Z.onConflict(buffer, ZGLOSZENIE_POWOD.ZAPIS_BUFORA);
      wyslijZgloszenia(ZGLOSZENIE_POWOD.ZAPIS_BUFORA);
    }
    return orig.apply(this, arguments);
  });
  wrap(GQ.prototype, 'writeTexture', (orig) => function writeTexture(dst, data, layout, size) {
    if (Z.n > 0 && dst && dst.texture && conflict(dst.texture)) {
      if (Z.onConflict) Z.onConflict(dst.texture, ZGLOSZENIE_POWOD.ZAPIS_TEKSTURY);
      wyslijZgloszenia(ZGLOSZENIE_POWOD.ZAPIS_TEKSTURY);
    }
    return orig.call(this, dst, data, layout, size);
  });
  wrap(GQ.prototype, 'copyExternalImageToTexture', (orig) => function copyExternalImageToTexture(src, dst, size) {
    // źródłem bywa kanwa (także WebGPU) — odłożone polecenia najpierw
    if (Z.n > 0) wyslijZgloszenia(ZGLOSZENIE_POWOD.KOPIA_OBRAZU);
    return orig.call(this, src, dst, size);
  });
  wrap(GQ.prototype, 'onSubmittedWorkDone', (orig) => function onSubmittedWorkDone() {
    flushIfPending(ZGLOSZENIE_POWOD.CZEKANIE);
    return orig.call(this);
  });

  // --- urządzenie ---
  wrap(GD.prototype, 'createCommandEncoder', (orig) => function createCommandEncoder(desc) {
    const enc = orig.apply(this, arguments);
    enc.__zq = ++Z.encSeq;
    return enc;
  });
  wrap(GD.prototype, 'createBindGroup', (orig) => function createBindGroup(desc) {
    const bg = orig.call(this, desc);
    const entries = desc && desc.entries;
    const res = [];
    let ok = true;
    if (entries) {
      for (let i = 0; i < entries.length; i++) {
        const r = entries[i] && entries[i].resource;
        if (!r) continue;
        if (GBufferCtor && r instanceof GBufferCtor) res.push(r);
        else if (GViewCtor && r instanceof GViewCtor) { if (r.__zt !== undefined) res.push(r.__zt); else ok = false; }
        else if (GTextureCtor && r instanceof GTextureCtor) res.push(r);
        else if (r.buffer !== undefined) { if (r.buffer) res.push(r.buffer); }
        // sampler / tekstura zewnętrzna — nie da się ich zapisać operacją kolejki
      }
    }
    bg.__zr = ok ? res : undefined;
    return bg;
  });
  wrap(GD.prototype, 'createRenderBundleEncoder', (orig) => function createRenderBundleEncoder(desc) {
    const be = orig.apply(this, arguments);
    be.__zb = { groups: [], res: [] };
    return be;
  });
  for (const name of ['pushErrorScope', 'popErrorScope', 'destroy']) {
    wrap(GD.prototype, name, (orig) => function () {
      flushIfPending(ZGLOSZENIE_POWOD.KONFIGURACJA);
      return orig.apply(this, arguments);
    });
  }

  // --- tekstury, bufory, zapytania ---
  wrap(GT, 'createView', (orig) => function createView(desc) {
    const v = orig.apply(this, arguments);
    v.__zt = this;
    return v;
  });
  for (const proto of [GT, GB, GQS]) {
    wrap(proto, 'destroy', (orig) => function destroy() {
      if (Z.n > 0 && conflict(this)) {
        if (Z.onConflict) Z.onConflict(this, ZGLOSZENIE_POWOD.NISZCZENIE);
        wyslijZgloszenia(ZGLOSZENIE_POWOD.NISZCZENIE);
      }
      return orig.call(this);
    });
  }
  wrap(GB, 'mapAsync', (orig) => function mapAsync(mode, offset, size) {
    flushIfPending(ZGLOSZENIE_POWOD.MAPOWANIE);
    return orig.apply(this, arguments);
  });

  // --- enkoder poleceń ---
  const CE = GCE.prototype;
  wrap(CE, 'beginRenderPass', (orig) => function beginRenderPass(desc) {
    const id = this.__zq;
    markPassDesc(desc, id);
    const p = orig.apply(this, arguments);
    p.__zq = id;
    return p;
  });
  wrap(CE, 'beginComputePass', (orig) => function beginComputePass(desc) {
    const id = this.__zq;
    markPassDesc(desc, id);
    const p = orig.apply(this, arguments);
    p.__zq = id;
    return p;
  });
  wrap(CE, 'finish', (orig) => function finish(desc) {
    const cb = orig.apply(this, arguments);
    cb.__zq = this.__zq;
    return cb;
  });
  wrap(CE, 'copyBufferToBuffer', (orig) => function copyBufferToBuffer(a, b, c, d, e) {
    const id = this.__zq;
    mark(a, id);
    // (src, srcOffset, dst, dstOffset, size) albo (src, dst, size?)
    if (GBufferCtor && b instanceof GBufferCtor) mark(b, id); else mark(c, id);
    return orig.apply(this, arguments);
  });
  wrap(CE, 'copyBufferToTexture', (orig) => function copyBufferToTexture(src, dst, size) {
    const id = this.__zq;
    if (src) mark(src.buffer, id);
    if (dst) mark(dst.texture, id);
    return orig.call(this, src, dst, size);
  });
  wrap(CE, 'copyTextureToBuffer', (orig) => function copyTextureToBuffer(src, dst, size) {
    const id = this.__zq;
    if (src) mark(src.texture, id);
    if (dst) mark(dst.buffer, id);
    return orig.call(this, src, dst, size);
  });
  wrap(CE, 'copyTextureToTexture', (orig) => function copyTextureToTexture(src, dst, size) {
    const id = this.__zq;
    if (src) mark(src.texture, id);
    if (dst) mark(dst.texture, id);
    return orig.call(this, src, dst, size);
  });
  wrap(CE, 'clearBuffer', (orig) => function clearBuffer(buffer, offset, size) {
    mark(buffer, this.__zq);
    return orig.apply(this, arguments);
  });
  wrap(CE, 'resolveQuerySet', (orig) => function resolveQuerySet(qs, first, count, dst, dstOffset) {
    const id = this.__zq;
    mark(qs, id);
    mark(dst, id);
    return orig.call(this, qs, first, count, dst, dstOffset);
  });

  // --- passy (rysunki i obliczenia) ---
  const setBindGroup = (orig) => function setBindGroup(index, group, a, b, c) {
    markGroup(group, this.__zq);
    return orig.apply(this, arguments);
  };
  wrap(GRP, 'setBindGroup', setBindGroup);
  wrap(GCP, 'setBindGroup', setBindGroup);
  wrap(GRP, 'setVertexBuffer', (orig) => function setVertexBuffer(slot, buffer, offset, size) {
    mark(buffer, this.__zq);
    return orig.apply(this, arguments);
  });
  wrap(GRP, 'setIndexBuffer', (orig) => function setIndexBuffer(buffer, format, offset, size) {
    mark(buffer, this.__zq);
    return orig.apply(this, arguments);
  });
  for (const name of ['drawIndirect', 'drawIndexedIndirect']) {
    wrap(GRP, name, (orig) => function (buffer, offset) {
      mark(buffer, this.__zq);
      return orig.call(this, buffer, offset);
    });
  }
  wrap(GCP, 'dispatchWorkgroupsIndirect', (orig) => function dispatchWorkgroupsIndirect(buffer, offset) {
    mark(buffer, this.__zq);
    return orig.call(this, buffer, offset);
  });
  wrap(GRP, 'executeBundles', (orig) => function executeBundles(bundles) {
    const id = this.__zq;
    if (bundles) {
      for (let i = 0; i < bundles.length; i++) {
        const u = bundles[i] && bundles[i].__zb;
        if (u === undefined) { if (!(Z.unsafe >= id)) Z.unsafe = id; continue; }
        for (let j = 0; j < u.groups.length; j++) markGroup(u.groups[j], id);
        for (let j = 0; j < u.res.length; j++) mark(u.res[j], id);
      }
    }
    return orig.call(this, bundles);
  });
  // paczki rysunków: użycia zbierane w enkoderze paczki, oznaczane przy executeBundles
  if (GRB) {
    wrap(GRB, 'setBindGroup', (orig) => function setBindGroup(index, group, a, b, c) {
      if (this.__zb && group) this.__zb.groups.push(group);
      return orig.apply(this, arguments);
    });
    wrap(GRB, 'setVertexBuffer', (orig) => function setVertexBuffer(slot, buffer, offset, size) {
      if (this.__zb && buffer) this.__zb.res.push(buffer);
      return orig.apply(this, arguments);
    });
    wrap(GRB, 'setIndexBuffer', (orig) => function setIndexBuffer(buffer, format, offset, size) {
      if (this.__zb && buffer) this.__zb.res.push(buffer);
      return orig.apply(this, arguments);
    });
    for (const name of ['drawIndirect', 'drawIndexedIndirect']) {
      wrap(GRB, name, (orig) => function (buffer, offset) {
        if (this.__zb && buffer) this.__zb.res.push(buffer);
        return orig.call(this, buffer, offset);
      });
    }
    wrap(GRB, 'finish', (orig) => function finish(desc) {
      const b = orig.apply(this, arguments);
      b.__zb = this.__zb;
      return b;
    });
  }

  // --- kanwy: odczyt obrazu kanwy WebGPU i zmiana jej konfiguracji ---
  const GCC = g.GPUCanvasContext && g.GPUCanvasContext.prototype;
  for (const name of ['configure', 'unconfigure']) {
    wrap(GCC, name, (orig) => function () {
      flushIfPending(ZGLOSZENIE_POWOD.KONFIGURACJA);
      return orig.apply(this, arguments);
    });
  }
  // odczyt kanwy WebGPU przez kanwę 2D albo bitmapę (worker: transferToImageBitmap; podzielony ekran i tryb off:
  // drawImage kanwy WebGPU). Koniec klatki Core3D i tak wysyła odłożone — tu na wypadek odczytu w środku klatki.
  const readers = [
    [g.OffscreenCanvas && g.OffscreenCanvas.prototype, ['transferToImageBitmap', 'convertToBlob']],
    [g.OffscreenCanvasRenderingContext2D && g.OffscreenCanvasRenderingContext2D.prototype, ['drawImage', 'createPattern']],
    [g.CanvasRenderingContext2D && g.CanvasRenderingContext2D.prototype, ['drawImage', 'createPattern']]
  ];
  for (const [proto, names] of readers) {
    for (const name of names) {
      wrap(proto, name, (orig) => function () {
        if (Z.n > 0) wyslijZgloszenia(ZGLOSZENIE_POWOD.KANWA);
        return orig.apply(this, arguments);
      });
    }
  }
  return Z;
}
