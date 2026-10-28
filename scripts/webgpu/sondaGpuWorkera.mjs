// SONDA GPU WORKERA RENDERU (2026-10-28, zgłoszenie „od pierwszych obrażeń habitatu klatkuje, przy upadku bazy obraz
// workera 10 kl/s przy CPU 5,5 i GPU 9 ms, karta się poci”). Wiersz PerfHUD „Obraz 3D (worker)” pokazuje GPU tylko
// passów RENDER (Core3D.gpuFrameMs) — compute (bloom, gaz, efekty), wysyłki, kompilacje i kolejka GPU są niewidoczne.
// Ta sonda pokazuje je w harnessie gry (tryb worker):
//   - na klatkę workera (od końca jednego renderSingle do końca następnego): writeBuffer / writeTexture /
//     copyExternalImageToTexture (wywołania i bajty), nowe bufory i tekstury (bajty), dispatche compute (i grupy),
//     rysunki, passy, zgłoszenia, pipeline'y tworzone synchronicznie i asynchronicznie, moduły shaderów;
//   - opóźnienie kolejki GPU: od końca zgłoszeń klatki do onSubmittedWorkDone (zapchana kolejka = dziesiątki ms);
//   - pamięć GPU gry: bajty buforów i tekstur utworzonych minus zniszczonych (od instalacji sondy);
//   - czas GPU ze znaczników three w rozbiciu na etykiety: passy Core3D (pass:<nazwa>, maska słońca, halo, DIST,
//     post), kroki Core3D.fx (fx:<nazwa>) i rendery / compute modułów poza Core3D.render (plik:funkcja ze stosu).
// Instalacja: wkEval(SONDA_INSTALUJ) w sesji CDP workera (globalThis.__C3 = Core3D — operacja dev strony, jak w
// baza-po-upadku-gra.mjs). Odczyt z wyzerowaniem: wkEval(SONDA_CZYTAJ). Do tego: ślad Chrome (zajętość CrGpuMain,
// workera, strony; najdroższe zdarzenia procesu GPU) i próbki nvidia-smi.
import { spawn } from 'node:child_process';

export const SONDA_INSTALUJ = `(() => {
  const C = globalThis.__C3;
  if (!C || !C.renderer || !C.renderer.backend || !C.renderer.backend.device) return 'brak Core3D w workerze';
  if (globalThis.__gpuProbe) return 'już';
  const r = C.renderer, be = r.backend, dev = be.device, q = dev.queue;
  const fresh = () => ({ wbN: 0, wbB: 0, wtN: 0, wtB: 0, ceN: 0, ceB: 0, sub: 0, disp: 0, wg: 0, draws: 0, rp: 0, cp: 0,
    nbN: 0, nbB: 0, ntN: 0, ntB: 0, dbB: 0, dtB: 0, psync: 0, psyncMs: 0, pasync: 0, csync: 0, csyncMs: 0, casync: 0, sm: 0,
    cpuRender: 0, lat: -1, t: 0 });
  const P = globalThis.__gpuProbe = { cur: fresh(), frames: [], live: { buf: 0, tex: 0, bufN: 0, texN: 0 }, wbBy: new Map(), wtBy: new Map(),
    gpu: { render: new Map(), compute: new Map() }, tsFrames: { render: new Set(), compute: new Set() },
    labels: new Map(), curLabel: '', err: null, latPending: 0, latMax: 0 };
  const sizes = new WeakMap();
  const bpe = (d) => (d && d.BYTES_PER_ELEMENT) || 1;
  const wrapI = (obj, name, mk) => { const f = obj[name]; if (typeof f === 'function') obj[name] = mk(f); };
  // --- kolejka (instancja — prototyp owija już zbieracz zgłoszeń) ---
  wrapI(q, 'writeBuffer', (f) => function (buf, off, data, dOff, size) {
    const c = P.cur, e = bpe(data); c.wbN++;
    const nb = size !== undefined ? size * e : Math.max(0, (data && data.byteLength || 0) - (dOff || 0) * e);
    c.wbB += nb;
    const L = (buf && buf.label) || '?';
    const w = P.wbBy.get(L); if (w) { w[0] += nb; w[1]++; } else P.wbBy.set(L, [nb, 1]);
    return f.apply(this, arguments);
  });
  wrapI(q, 'writeTexture', (f) => function (dst, data, layout, size) {
    const c = P.cur; c.wtN++;
    const nb = Math.max(0, (data && data.byteLength || 0) - ((layout && layout.offset) || 0));
    c.wtB += nb;
    const L = (dst && dst.texture && dst.texture.label) || '?';
    const w = P.wtBy.get(L); if (w) { w[0] += nb; w[1]++; } else P.wtBy.set(L, [nb, 1]);
    return f.apply(this, arguments);
  });
  wrapI(q, 'copyExternalImageToTexture', (f) => function (src, dst, size) {
    const c = P.cur; c.ceN++;
    const w = Array.isArray(size) ? size[0] : (size && size.width) || 0;
    const h = Array.isArray(size) ? (size[1] || 1) : (size && size.height) || 1;
    c.ceB += w * h * 4;
    return f.apply(this, arguments);
  });
  wrapI(q, 'submit', (f) => function () { P.cur.sub++; return f.apply(this, arguments); });
  // --- zasoby ---
  const BPP = { rgba16float: 8, rgba32float: 16, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, r32float: 4, rg32float: 8,
    rg16float: 4, r16float: 2, r8unorm: 1, rg8unorm: 2, depth24plus: 4, depth32float: 4, 'depth24plus-stencil8': 4, r32uint: 4, rgba32uint: 16 };
  wrapI(dev, 'createBuffer', (f) => function (d) {
    const b = f.apply(this, arguments);
    const n = (d && d.size) || 0;
    const c = P.cur; c.nbN++; c.nbB += n;
    P.live.buf += n; P.live.bufN++;
    try { sizes.set(b, n); } catch (_) {}
    return b;
  });
  wrapI(dev, 'createTexture', (f) => function (d) {
    const t = f.apply(this, arguments);
    const s = d && d.size;
    let w = 1, h = 1, z = 1;
    if (Array.isArray(s)) { w = s[0] || 1; h = s[1] || 1; z = s[2] || 1; } else if (s) { w = s.width || 1; h = s.height || 1; z = s.depthOrArrayLayers || 1; }
    const mips = Math.max(1, (d && d.mipLevelCount) || 1);
    const n = Math.round(w * h * z * (BPP[String(d && d.format)] || 4) * Math.max(1, (d && d.sampleCount) || 1) * (mips > 1 ? 4 / 3 : 1));
    const c = P.cur; c.ntN++; c.ntB += n;
    P.live.tex += n; P.live.texN++;
    try { sizes.set(t, n); } catch (_) {}
    return t;
  });
  const GB = globalThis.GPUBuffer && GPUBuffer.prototype, GT = globalThis.GPUTexture && GPUTexture.prototype;
  if (GB) wrapI(GB, 'destroy', (f) => function () { const n = sizes.get(this); if (n !== undefined) { sizes.delete(this); P.live.buf -= n; P.live.bufN--; P.cur.dbB += n; } return f.apply(this, arguments); });
  if (GT) wrapI(GT, 'destroy', (f) => function () { const n = sizes.get(this); if (n !== undefined) { sizes.delete(this); P.live.tex -= n; P.live.texN--; P.cur.dtB += n; } return f.apply(this, arguments); });
  wrapI(dev, 'createRenderPipeline', (f) => function () { const t0 = performance.now(); try { return f.apply(this, arguments); } finally { P.cur.psync++; P.cur.psyncMs += performance.now() - t0; } });
  wrapI(dev, 'createRenderPipelineAsync', (f) => function () { P.cur.pasync++; return f.apply(this, arguments); });
  wrapI(dev, 'createComputePipeline', (f) => function () { const t0 = performance.now(); try { return f.apply(this, arguments); } finally { P.cur.csync++; P.cur.csyncMs += performance.now() - t0; } });
  wrapI(dev, 'createComputePipelineAsync', (f) => function () { P.cur.casync++; return f.apply(this, arguments); });
  wrapI(dev, 'createShaderModule', (f) => function () { P.cur.sm++; return f.apply(this, arguments); });
  // --- enkodery (prototypy realmu workera) ---
  const CPE = globalThis.GPUComputePassEncoder && GPUComputePassEncoder.prototype;
  if (CPE) {
    wrapI(CPE, 'dispatchWorkgroups', (f) => function (x, y, z) { const c = P.cur; c.disp++; c.wg += (x || 1) * (y || 1) * (z || 1); return f.apply(this, arguments); });
    wrapI(CPE, 'dispatchWorkgroupsIndirect', (f) => function () { P.cur.disp++; return f.apply(this, arguments); });
  }
  const RPE = globalThis.GPURenderPassEncoder && GPURenderPassEncoder.prototype;
  if (RPE) for (const m of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) wrapI(RPE, m, (f) => function () { P.cur.draws++; return f.apply(this, arguments); });
  const CE = globalThis.GPUCommandEncoder && GPUCommandEncoder.prototype;
  if (CE) {
    wrapI(CE, 'beginRenderPass', (f) => function () { P.cur.rp++; return f.apply(this, arguments); });
    wrapI(CE, 'beginComputePass', (f) => function () { P.cur.cp++; return f.apply(this, arguments); });
  }
  // --- etykiety wywołań render / compute (czas GPU ze znaczników three: uid 'r:<wywołanie>:<kontekst>:f<klatka>') ---
  const label = (lab, fn) => function () { const prev = P.curLabel; P.curLabel = lab; try { return fn.apply(this, arguments); } finally { P.curLabel = prev; } };
  for (const [m, lab] of [['_renderSunShadowMask', 'maskaSlonca'], ['_renderPlanetHaloPrepass', 'haloPre'], ['_renderFxDistortion', 'dist'], ['_renderPost', 'post']]) {
    if (typeof C[m] === 'function') C[m] = label(lab, C[m]);
  }
  if (typeof C._runScenePass === 'function') { const f = C._runScenePass; C._runScenePass = function (pass) { const prev = P.curLabel; P.curLabel = 'pass:' + ((pass && (pass.name || pass.bucket)) || '?'); try { return f.apply(this, arguments); } finally { P.curLabel = prev; } }; }
  if (typeof C._passSunShadow === 'function') C._passSunShadow = label('cienSlonca', C._passSunShadow);
  const wrapSteps = () => {
    const fx = C.fx, steps = fx && fx.steps;
    if (!steps) return;
    for (const s of steps) {
      if (!s || s.__sondaLab) continue;
      s.__sondaLab = true;
      for (const k of ['spawn', 'update', 'lights']) if (typeof s[k] === 'function') s[k] = label('fx:' + (s.name || '?'), s[k]);
    }
  };
  wrapSteps();
  const stackLabel = () => {
    const st = String(new Error().stack || '').split('\\n');
    for (let i = 2; i < st.length; i++) {
      const l = st[i];
      if (/node_modules|three|\\.vite\\/deps|core3d\\.js|<anonymous>|eval at/.test(l)) continue;
      const m = /at (?:(\\S+) )?\\(?(?:.*\\/)?([^\\/?:)]+)(?:\\?[^:)]*)?:(\\d+):\\d+\\)?/.exec(l);
      if (m) return 'mod:' + m[2] + ':' + (m[1] || '?');
    }
    return 'mod:?';
  };
  const note = (kind, idx) => {
    const fr = r.info.frame;
    let L = P.labels.get(fr);
    if (!L) { L = { r: [], c: [] }; P.labels.set(fr, L); if (P.labels.size > 400) P.labels.delete(P.labels.keys().next().value); }
    let lab = P.curLabel;
    if (!lab) lab = stackLabel();
    else if (lab === 'dist' || lab === 'post' || lab.startsWith('pass:') || lab.startsWith('fx:')) {
      // w passie / kroku: tylko nazwa — ale render celu modułu z haka passa dostaje stos
      const rt = kind === 'r' && r.getRenderTarget && r.getRenderTarget();
      if (kind === 'r' && rt && rt !== C.composerTarget && lab.startsWith('pass:')) lab = lab + '>' + stackLabel();
    }
    (kind === 'r' ? L.r : L.c)[idx] = lab;
  };
  wrapI(r, 'render', (f) => function () { note('r', (r.info.render.frameCalls | 0) + 1); return f.apply(this, arguments); });
  wrapI(r, 'compute', (f) => function () { note('c', (r.info.compute.frameCalls | 0) + 1); return f.apply(this, arguments); });
  if (typeof C._handleGpuTimestamp === 'function') {
    const h = C._handleGpuTimestamp;
    C._handleGpuTimestamp = function (type) {
      try {
        const pool = be.timestampQueryPool && be.timestampQueryPool[type];
        const ts = pool && pool.timestamps;
        const g = type === 'render' ? P.gpu.render : P.gpu.compute, fs = type === 'render' ? P.tsFrames.render : P.tsFrames.compute;
        if (ts) for (const [uid, dur] of ts) {
          // uid three: 'r:<render w klatce>:<kontekst>:f<klatka>'; listy compute (łata Core3D
          // _uniqueComputeListTimestamps): 'c:<compute w klatce>:L<lista>:f<klatka>'
          const m = /^(r|c):(\\d+):([^:]*):f(\\d+)$/.exec(uid);
          if (!m) continue;
          const fr = +m[4], idx = +m[2];
          const L = P.labels.get(fr);
          const lab = (L && (m[1] === 'r' ? L.r[idx] : L.c[idx])) || ('?' + m[1] + idx);
          const e = g.get(lab) || { n: 0, ms: 0, max: 0 };
          e.n++; e.ms += dur; if (dur > e.max) e.max = dur;
          g.set(lab, e);
          fs.add(fr);
        }
      } catch (e) { P.err = String(e); }
      return h.apply(this, arguments);
    };
  }
  // --- granica klatki: koniec renderSingle (drugi widok podzielonego ekranu — ta sama klatka sondy) ---
  const rs = C.renderSingle;
  C.renderSingle = function () {
    wrapSteps();
    const t0 = performance.now();
    const out = rs.apply(this, arguments);
    const c = P.cur;
    c.cpuRender = performance.now() - t0;
    c.t = t0;
    const tq = performance.now();
    P.latPending++;
    q.onSubmittedWorkDone().then(() => { P.latPending--; c.lat = performance.now() - tq; if (c.lat > P.latMax) P.latMax = c.lat; });
    P.frames.push(c);
    if (P.frames.length > 6000) P.frames.splice(0, 1000);
    P.cur = fresh();
    return out;
  };
  return 'ok';
})()`;

// Odczyt z wyzerowaniem: średnie i p95 rekordów klatek od ostatniego odczytu (bez ostatnich, których opóźnienie kolejki
// jeszcze nie wróciło), pamięć gry, czas GPU wg etykiet (ms na klatkę ze znacznikami), pipeline'y sync workera (st.pipeSync).
export const SONDA_CZYTAJ = `(() => {
  const P = globalThis.__gpuProbe;
  if (!P) return null;
  let done = P.frames.length;
  while (done > 0 && P.frames[done - 1].lat < 0 && P.frames.length - done < 30) done--;
  const fr = P.frames.splice(0, done);
  const keys = ['wbN', 'wbB', 'wtN', 'wtB', 'ceN', 'ceB', 'sub', 'disp', 'wg', 'draws', 'rp', 'cp', 'nbN', 'nbB', 'ntN', 'ntB', 'dbB', 'dtB',
    'psync', 'psyncMs', 'pasync', 'csync', 'csyncMs', 'casync', 'sm', 'cpuRender', 'lat'];
  const sr = {}, p95 = {}, sum = {};
  for (const k of keys) {
    const a = fr.map((f) => f[k]).filter((v) => v >= 0).sort((x, y) => x - y);
    const s = a.reduce((x, y) => x + y, 0);
    sum[k] = +s.toFixed(1);
    sr[k] = a.length ? +(s / a.length).toFixed(2) : 0;
    p95[k] = a.length ? +a[Math.min(a.length - 1, Math.floor(0.95 * a.length))].toFixed(2) : 0;
  }
  const span = fr.length > 1 ? (fr[fr.length - 1].t - fr[0].t) / 1000 : 0;
  const gpuOf = (g, fs) => {
    const n = Math.max(1, fs.size);
    const rows = [...g.entries()].map(([k, e]) => [k, +(e.ms / n).toFixed(3), +e.max.toFixed(2), +(e.n / n).toFixed(2)]).sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((a, r) => a + r[1], 0);
    g.clear(); fs.clear();
    return { klatek: n, msNaKlatke: +tot.toFixed(2), wiersze: rows.slice(0, 25) };
  };
  const nF = Math.max(1, fr.length);
  const topBy = (m) => { const rows = [...m.entries()].map(([k, v]) => [k, Math.round(v[0] / nF), +(v[1] / nF).toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 12); m.clear(); return rows; };
  const out = { klatki: fr.length, s: +span.toFixed(2), naS: span > 0 ? +(fr.length / span).toFixed(1) : 0, sr, p95, suma: sum,
    wysylkiBuforow: topBy(P.wbBy), wysylkiTekstur: topBy(P.wtBy),
    latMax: +P.latMax.toFixed(1), latOczekuje: P.latPending,
    pamiecMB: { bufory: +(P.live.buf / 1048576).toFixed(1), tekstury: +(P.live.tex / 1048576).toFixed(1), buforyN: P.live.bufN, teksturyN: P.live.texN },
    gpuRender: gpuOf(P.gpu.render, P.tsFrames.render), gpuCompute: gpuOf(P.gpu.compute, P.tsFrames.compute),
    pipeSyncRazem: globalThis.__ST ? globalThis.__ST.pipeSync | 0 : null, blad: P.err };
  P.latMax = 0;
  return out;
})()`;

/** Próbki nvidia-smi co `ms` (zajętość GPU, pamięć, moc, zegar) z czasem Node — `okno(t0, t1)` = średnie i maksima. */
export function startNvidiaSmi(ms = 500) {
  const samples = [];
  let proc = null;
  try {
    proc = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,power.draw,clocks.gr,temperature.gpu', '--format=csv,noheader,nounits', `-lms`, String(ms)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const [u, mem, pw, clk, temp] = line.split(',').map((x) => Number(x.trim()));
        if (Number.isFinite(u)) samples.push({ t: Date.now(), u, mem, pw, clk, temp });
      }
    });
  } catch (_) { proc = null; }
  return {
    samples,
    okno(t0, t1 = Date.now()) {
      const a = samples.filter((s) => s.t >= t0 && s.t <= t1);
      if (!a.length) return null;
      const avg = (k) => +(a.reduce((x, s) => x + s[k], 0) / a.length).toFixed(1);
      const max = (k) => Math.max(...a.map((s) => s[k]));
      return { n: a.length, zajetosc: avg('u'), zajetoscMaks: max('u'), pamiecMB: avg('mem'), pamiecMaksMB: max('mem'), mocW: avg('pw'), zegarMHz: avg('clk') };
    },
    stop() { try { proc && proc.kill(); } catch (_) {} }
  };
}

/** Teraz: zajętość GPU i pamięć z nvidia-smi (jedna próbka) + procesy z największym CPU (Windows) — do dziennika przebiegu. */
export async function stanMaszyny() {
  const run = (cmd, a) => new Promise((ok) => {
    let s = '';
    try { const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'ignore'] }); p.stdout.on('data', (d) => { s += d; }); p.on('close', () => ok(s.trim())); p.on('error', () => ok('')); } catch (_) { ok(''); }
  });
  const gpu = await run('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']);
  return { gpu };
}

/**
 * Ślad Chrome przez `s` sekund (kategorie toplevel + gpu + gpu.dawn): zajętość wątków [% okna] — CrGpuMain (proces GPU:
 * polecenia WebGPU workera, składanie), worker renderu, strona — i najdroższe zdarzenia na CrGpuMain i w workerze
 * (suma ms, liczba). `licz` — funkcja zwracająca { c: złożenia, f: klatki strony, t } przed i po (obrazy / s).
 */
export async function sladWatkow(cdp, s, licz, extraCategories = []) {
  const events = [];
  let done = null;
  const handler = (msg) => {
    if (msg.method === 'Tracing.dataCollected') { for (const e of msg.params.value) if (e.ph === 'X' || e.ph === 'M') events.push(e); }
    else if (msg.method === 'Tracing.tracingComplete' && done) { const f = done; done = null; f(); }
  };
  cdp.on(handler);
  try {
    const fin = new Promise((ok) => { done = ok; });
    const a0 = licz ? await licz() : null;
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['toplevel', '__metadata', 'gpu', 'gpu.dawn', ...extraCategories], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
    await new Promise((ok) => setTimeout(ok, s * 1000));
    await cdp.send('Tracing.end');
    const a1 = licz ? await licz() : null;
    await Promise.race([fin, new Promise((ok) => setTimeout(ok, 30000))]);
    return analizaSladu(events, a0, a1);
  } finally {
    const i = cdp.handlers ? cdp.handlers.indexOf(handler) : -1;
    if (i >= 0) cdp.handlers.splice(i, 1);
  }
}

export function analizaSladu(events, a0, a1) {
  const tname = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args?.name);
  const iv = new Map(), per = new Map();
  let t0 = Infinity, t1 = -Infinity;
  for (const e of events) {
    if (e.ph !== 'X' || !(e.dur > 0)) continue;
    const k = `${e.pid}:${e.tid}`;
    if (e.ts < t0) t0 = e.ts;
    if (e.ts + e.dur > t1) t1 = e.ts + e.dur;
    if (e.cat && e.cat.includes('toplevel')) { let a = iv.get(k); if (!a) iv.set(k, a = []); a.push([e.ts, e.ts + e.dur]); }
    let m = per.get(k); if (!m) per.set(k, m = new Map());
    const r = m.get(e.name) || { ms: 0, n: 0, max: 0 }; r.ms += e.dur / 1000; r.n++; if (e.dur / 1000 > r.max) r.max = e.dur / 1000; m.set(e.name, r);
  }
  const span = Math.max(1, t1 - t0);
  const busy = (k) => { const a = iv.get(k); if (!a) return 0; a.sort((x, y) => x[0] - y[0]); let b = 0, cs = -1, ce = -1;
    for (const [x, y] of a) { if (x > ce) { if (ce > cs) b += ce - cs; cs = x; ce = y; } else if (y > ce) ce = y; } if (ce > cs) b += ce - cs; return +(100 * b / span).toFixed(1); };
  let gpuKey = null, wkKey = null, pageKey = null;
  for (const [k, n] of tname) {
    if (n === 'CrGpuMain') gpuKey = k;
    if (/DedicatedWorker/.test(n || '') && busy(k) > (wkKey ? busy(wkKey) : -1)) wkKey = k;
    if (n === 'CrRendererMain' && busy(k) > (pageKey ? busy(pageKey) : -1)) pageKey = k;
  }
  const top = (k, n = 14) => k && per.get(k) ? [...per.get(k).entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, n)
    .map(([name, r]) => [name, +r.ms.toFixed(1), r.n, +r.max.toFixed(2)]) : [];
  const dt = a0 && a1 ? Math.max(1e-3, (a1.t - a0.t) / 1000) : span / 1e6;
  const obrazy = a0 && a1 ? a1.c - a0.c : null;
  return { okno_s: +(span / 1e6).toFixed(2), obrazyS: obrazy !== null ? +(obrazy / dt).toFixed(1) : null,
    klatkiStronyS: a0 && a1 ? +((a1.f - a0.f) / dt).toFixed(1) : null,
    zajetosc: { gpuMain: gpuKey ? busy(gpuKey) : null, worker: wkKey ? busy(wkKey) : null, strona: pageKey ? busy(pageKey) : null },
    topGpuMain: top(gpuKey), topWorker: top(wkKey, 10), watki: [...tname.entries()].map(([k, n]) => [n, busy(k)]).filter((x) => x[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 12) };
}
