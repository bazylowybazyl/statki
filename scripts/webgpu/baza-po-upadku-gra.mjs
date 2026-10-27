// OBRAZ PO UPADKU BAZY PIRATÓW w trybie gracza (render w workerze) — audyt docs/AUDYT-baza-po-upadku-2026-10-27.md
// (zgłoszenie 2026-10-27: po zniszczeniu bazy i upadku elementów na planetoidę obraz 3D „klatkuje”, PerfHUD 240 kl/s).
// Vite + headless Chrome z WebGPU, skok dev ?story=shipyard, Atlas nieśmiertelny.
//
//   node scripts/webgpu/baza-po-upadku-gra.mjs [--out .tmp/baza-po-upadku] [--query renderWorker=0] [--daleko 1]
//        [--progi 0] [--czasPo 12] [--profil 1] [--ab 1]
//
// Okna: „przed” (habitat cały), „progi” (cztery progi punktów habitatu — płaskie odłamy), HP 0 → upadek do osiadania,
// „po” (kamera fabuły), „nad-gruzem” (Atlas nad środkiem bazy). Co 0,5 s: złożenia obrazu workera, wiek, klatki workera
// (pierścień __rwFrameTimes), HullSurface (strona i worker), wraki (gorące / śpiące / odłamy budowli, bryły), połówki brył
// bez rysunku. Na starcie okna: rysunki workera na klatkę wg obiektu (opakowanie renderer._renderObjectDirect), passy
// Core3D (lastFrameRenderInfo), partie skór sprite'a (partia „0|…” = skóra bez obrazu), skóry ciał świata. Dziennik
// konsoli workera (Target.setAutoAttach, sesje płaskie). --daleko 1 — progi i upadek przy Atlasie 16 km dalej (odłamy
// rodzą się poza pudłem rozgrzania kadłubów). --profil 1 — profil CPU workera (Profiler CDP) w oknach. --ab 1 — w pauzie
// nad gruzem A/B przycinania połówek brył (__worldSkinOptions.planeHalfCull) naprzemiennie ABABAB: klatki workera,
// rysunki, zrzuty i porównanie (scripts/webgpu/porownaj.mjs). Tryb off: --query renderWorker=0 (bez części workera).
// Raport: <out>/raport.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/baza-po-upadku');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';
const PROFIL = args.profil === '1';
const CZAS_PO = Number(args.czasPo || 12);
const PROGI = args.progi !== '0';
const tStart = Date.now();
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 9 min — koniec'); finish(2); }, 9 * 60 * 1000);

const { server, base } = await startVite(Number(args.port || 5391));
const chrome = await startChrome({ width: 1600, height: 900, renderMode: 'worker' });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { ticks: [], okna: {}, wkLogi: [], strona: [], bledy: [] };

// --- sesja workera renderu (Target.setAutoAttach, flatten) ---
const wk = { sid: null, id: 8000000 };
const wkSend = (method, params = {}, timeoutMs = 60000) => new Promise((ok, reject) => {
  if (!wk.sid) { reject(new Error('brak sesji workera')); return; }
  const id = ++wk.id;
  const timer = setTimeout(() => { cdp.pending.delete(id); reject(new Error(`limit ${method}`)); }, timeoutMs);
  cdp.pending.set(id, { ok: (r) => { clearTimeout(timer); ok(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId: wk.sid }));
});
const wkEval = async (expression) => {
  const r = await wkSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const ti = msg.params?.targetInfo;
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) {
      wk.sid = msg.params.sessionId;
      wkSend('Runtime.enable').catch(() => {});
    }
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400);
    const row = { s: +((Date.now() - tStart) / 1000).toFixed(1), type: msg.params.type, text };
    if (msg.sessionId && msg.sessionId === wk.sid) report.wkLogi.push(row);
    else if (!msg.sessionId && /warn|error/.test(msg.params.type)) report.strona.push(row);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    const row = { s: +((Date.now() - tStart) / 1000).toFixed(1), type: 'exception', text: String(d?.exception?.description || d?.text).slice(0, 400) };
    if (msg.sessionId && msg.sessionId === wk.sid) report.wkLogi.push(row); else if (!msg.sessionId) report.strona.push(row);
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

// odstępy rAF strony (przestoje wątku gry)
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = window.__rafRec = { n: 0, max: 0, slow: 0, last: 0 };
  const raf = (t) => { if (R.last) { const d = t - R.last; R.n++; if (d > R.max) R.max = d; if (d > 50) R.slow++; } R.last = t; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
})();` });

async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) {
      if (i >= 2) throw err;
      console.log(`start fazy ${phase} — ponowienie (${err.message})`);
    }
  }
}
async function startStoryOnce(phase) {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.StoryGame && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await sleep(2500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 120000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
}

const GUARD = `(() => {
  if (window.__guard) return true;
  window.__guard = setInterval(() => {
    const s = window.ship;
    if (!s) return;
    if (s.hull) s.hull.val = s.hull.max;
    if (s.shield) s.shield.val = s.shield.max;
    if (window.fireControl) window.fireControl.posture = 'hold';
  }, 100);
  return true;
})()`;

const PAGE_STATE = `(() => {
  const H = window.RenderWorkerHost;
  if (H && typeof H.readStats === 'function') H.readStats();
  const R = window.__rafRec;
  const raf = R ? { n: R.n, max: +R.max.toFixed(1), slow: R.slow } : null;
  if (R) { R.n = 0; R.max = 0; R.slow = 0; }
  let hot = 0, sleep = 0, wd = 0, wdPlanar = 0, solid = 0;
  for (const w of window.wrecks || []) {
    if (!w || w.dead) continue;
    if (w._wreckSleeping) sleep++; else hot++;
    if (w.worldDebris) { wd++; if (!w.solid3D) wdPlanar++; }
    if (w.solid3D) solid++;
  }
  const F = window.PirateBaseFall && window.PirateBaseFall.state();
  return { composed: H ? H.composed : -1, age: H && H.pacer ? H.pacer.age : -1, cpu: H ? +(H.stats[6] || 0).toFixed(1) : -1,
    gpu: H ? +(H.stats[0] || 0).toFixed(1) : -1, raf, hot, sleep, wd, wdPlanar, solid,
    upadek: F ? F.phase : '-', ft: F ? +F.t.toFixed(1) : 0,
    hsStrona: window.HullSurface ? { live: window.HullSurface._live.length, failed: window.HullSurface.stats.failed } : null,
    polowki: window.__worldSkinStats ? window.__worldSkinStats.halfCulled : null };
})()`;

const WK_STATE = `(() => {
  const f = globalThis.__rwFrameTimes, HS = globalThis.HullSurface;
  const n = f ? f.n : 0, from = Math.max(globalThis.__wkSeenN || 0, n - 8192);
  globalThis.__wkSeenN = n;
  const a = [];
  for (let i = from; i < n; i++) a.push(f.ms[i & 8191]);
  a.sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1) : 0);
  let over33 = 0, sum = 0;
  for (const x of a) { if (x > 33) over33++; sum += x; }
  let failed = 0, ready = 0, pending = 0, raster = 0;
  if (HS) for (const e of HS._live) {
    if (e.state === 'failed') failed++; else if (e.state === 'ready') ready++; else pending++;
    if (e.image && !(e.image instanceof ImageBitmap) && !(typeof OffscreenCanvas !== 'undefined' && e.image instanceof OffscreenCanvas)) raster++;
  }
  return { klatki: a.length, sumMs: +sum.toFixed(0), p50: q(0.5), p95: q(0.95), max: a.length ? +a[a.length - 1].toFixed(1) : 0, over33,
    hs: HS ? { baked: HS.stats.baked, failed: HS.stats.failed, live: HS._live.length, wFailed: failed, wReady: ready, wPending: pending, nieObraz: raster } : null };
})()`;

async function tick(label, s) {
  const p = await ev(PAGE_STATE).catch((e) => ({ err: e.message }));
  const w = wk.sid ? await wkEval(WK_STATE).catch((e) => ({ err: e.message })) : null;
  const row = { okno: label, s: +s.toFixed(1), ...p, wk: w };
  report.ticks.push(row);
  return row;
}

// Rysunki workera wg obiektu (nazwa | materiał | warstwy kamery) i passy Core3D (lastFrameRenderInfo) — średnio na klatkę.
const DRAW_INSTALL = `(() => {
  const C = globalThis.__C3;
  if (!C || !C.renderer || globalThis.__drawProbe) return !!globalThis.__drawProbe;
  const D = globalThis.__drawProbe = { on: false, frames: 0, by: new Map(), pass: new Map() };
  const r = C.renderer, orig = r._renderObjectDirect;
  r._renderObjectDirect = function (object, material, scene, camera) {
    if (D.on) {
      const k = (object.name || object.type) + ' | ' + (material && (material.name || material.type)) + ' | m' + (camera && camera.layers ? camera.layers.mask : '?') + (object.visible ? '' : ' (ukr)');
      D.by.set(k, (D.by.get(k) || 0) + 1);
    }
    return orig.apply(this, arguments);
  };
  const rs = C.renderSingle;
  C.renderSingle = function () {
    const out = rs.apply(this, arguments);
    if (D.on) {
      D.frames++;
      const info = C.lastFrameRenderInfo;
      if (info) for (const k of Object.keys(info)) { const b = info[k]; const p = D.pass.get(k) || { calls: 0, ms: 0 }; p.calls += b.calls; p.ms += b.ms; D.pass.set(k, p); }
    }
    return out;
  };
  return true;
})()`;
const DRAW_READ = `(() => {
  const D = globalThis.__drawProbe;
  if (!D) return null;
  const f = Math.max(1, D.frames);
  const by = [...D.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => [k, +(n / f).toFixed(1)]);
  const total = [...D.by.values()].reduce((a, b) => a + b, 0) / f;
  const pass = Object.fromEntries([...D.pass.entries()].map(([k, p]) => [k, { calls: +(p.calls / f).toFixed(1), ms: +(p.ms / f).toFixed(2) }]));
  const C = globalThis.__C3, S = globalThis.__worldSkinStats || null;
  let batches = 0, batchQuads = 0, nullBatches = 0, nullQuads = 0, ws = 0, wsVis = 0;
  if (C && C.scene) C.scene.traverse((o) => {
    if (o.isMesh && /^hullSkinBatch:/.test(o.name) && !/maskowanie/.test(o.name)) {
      batches++; const q = (o.geometry.drawRange.count || 0) / 6; batchQuads += q;
      if (/^hullSkinBatch:0\\|/.test(o.name)) { nullBatches++; nullQuads += q; }
    }
    if (o.name === 'ciało świata') { ws++; if (o.visible) wsVis++; }
  });
  D.on = false; D.frames = 0; D.by.clear(); D.pass.clear();
  return { klatki: f, rysunkiNaKlatke: +total.toFixed(1), by, pass, partie: { batches, batchQuads: Math.round(batchQuads), nullBatches, nullQuads: Math.round(nullQuads) },
    cialaSwiata: { egz: ws, widoczne: wsVis }, worldSkin: S ? { shown: S.shown, instances: S.instances, triangles: S.triangles, halfCulled: S.halfCulled } : null };
})()`;

async function drawProbe(label, ms = 1500) {
  if (!wk.sid) return null;
  try {
    if (!await wkEval(DRAW_INSTALL)) return null;
    await wkEval(WK_STATE);   // początek okna klatek workera
    await wkEval('(globalThis.__drawProbe.on = true, true)');
    await sleep(ms);
    const r = await wkEval(DRAW_READ);
    const k = await wkEval(WK_STATE);
    r.klatkiWorkera = { n: k.klatki, srMs: k.klatki ? +(k.sumMs / k.klatki).toFixed(2) : 0, p95: k.p95, max: k.max };
    console.log(label.padEnd(10), 'klatki workera', JSON.stringify(r.klatkiWorkera));
    report.rysunki = report.rysunki || {};
    report.rysunki[label] = r;
    console.log(label.padEnd(10), 'rysunki/klatkę', r.rysunkiNaKlatke, 'passy', JSON.stringify(r.pass), 'partie', JSON.stringify(r.partie), 'ciała świata', JSON.stringify(r.cialaSwiata), 'skóry', JSON.stringify(r.worldSkin));
    for (const [k, n] of r.by.slice(0, 7)) console.log('   ', String(n).padStart(6), k);
    return r;
  } catch (e) { console.log('drawProbe', label, e.message); return null; }
}

async function okno(label, sekundy, { profil = false } = {}) {
  await drawProbe(label);
  const rows = [];
  if (profil && wk.sid) {
    await wkSend('Profiler.enable');
    await wkSend('Profiler.setSamplingInterval', { interval: 250 });
    await wkSend('Profiler.start');
  }
  const c0 = await ev(`window.RenderWorkerHost ? window.RenderWorkerHost.composed : 0`);
  const t0 = Date.now();
  await tick(label + ':start', 0);
  while (Date.now() - t0 < sekundy * 1000) {
    await sleep(500);
    rows.push(await tick(label, (Date.now() - t0) / 1000));
  }
  const c1 = await ev(`window.RenderWorkerHost ? window.RenderWorkerHost.composed : 0`);
  const dur = (Date.now() - t0) / 1000;
  if (profil && wk.sid) {
    const { profile } = await wkSend('Profiler.stop', {}, 120000);
    writeFileSync(join(out, `worker-${label}.cpuprofile`), JSON.stringify(profile));
  }
  const wkRows = rows.map((r) => r.wk).filter((w) => w && !w.err);
  const frames = wkRows.reduce((a, w) => a + w.klatki, 0);
  const sumMs = wkRows.reduce((a, w) => a + w.sumMs, 0);
  const over33 = wkRows.reduce((a, w) => a + w.over33, 0);
  const maxMs = wkRows.reduce((a, w) => Math.max(a, w.max), 0);
  const summary = { sekundy: +dur.toFixed(1), zlozenia_s: +((c1 - c0) / dur).toFixed(0), klatkiWorkera_s: +(frames / dur).toFixed(0),
    srMsKlatkiWorkera: frames ? +(sumMs / frames).toFixed(2) : 0, maxMs: maxMs, ponad33: over33,
    rafMax: Math.max(...rows.map((r) => r.raf?.max || 0)), rafSlow: rows.reduce((a, r) => a + (r.raf?.slow || 0), 0) };
  report.okna[label] = summary;
  console.log(label.padEnd(10), JSON.stringify(summary));
  return summary;
}

function finish(code = 0) {
  try {
    report.wkHullSurface = report.wkLogi.filter((l) => /HullSurface/.test(l.text)).length;
    writeJson(join(out, 'raport.json'), report);
  } catch (e) { console.error(e); }
  Promise.resolve(chrome.close?.()).finally(() => Promise.resolve(server.close?.()).finally(() => process.exit(code)));
}

try {
  await startStory('shipyard');
  const trybWorker = await waitFor(cdp, '!!window.RenderWorkerHost', 15000, 300);
  console.log('tryb worker:', trybWorker);
  for (let i = 0; i < 40 && !wk.sid; i++) await sleep(250);
  console.log('sesja workera:', !!wk.sid);
  // Core3D i stan workera na globalu workera (operacja dev strony — kod w workerze z dostępem do Core3D, st)
  if (trybWorker) await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__C3 = Core3D; globalThis.__ST = st;' }), true)`);
  await sleep(1500);
  await ev(GUARD);
  // Atlas po drugiej stronie habitatu niż skała (bańka ciał świata 7 km obejmuje habitat), mgła wojny wyłączona
  await ev(`(() => {
    const S = window.StoryGame, d = S.site.dock;
    const p = d.toGame(-4200, -2600);
    S.deps.placePlayer(p.x, p.y, 0);
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    window.setFogOfWar?.(false);
    for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
    return true;
  })()`);
  await waitFor(cdp, `(() => { const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat'); return !!hs && hs.pieces.filter((p) => p.state === 'live').length >= 6; })()`, 60000, 300);
  // kamera statku jak u gracza (ujęcie upadku robi fabuła)
  await ev(`(() => { const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera?.('classic');
    c.manualZoom = false; c.targetZoom = 0.42; return c.mode; })()`);
  await sleep(3000);
  await okno('przed', 8, { profil: PROFIL });
  await screenshotPng(cdp, join(out, '01-przed.png'));

  // --daleko 1: progi i upadek, gdy Atlas jest 16 km od habitatu (odłamy rodzą się poza pudłem rozgrzania kadłubów),
  // powrót nad gruz dopiero po osiadaniu — jak gracz, który ostrzeliwuje bazę z dystansu
  if (args.daleko === '1') {
    await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-16000, -9000); S.deps.placePlayer(p.x, p.y, 0); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
    await sleep(1500);
  }
  if (PROGI) {
    for (const deg of [20, 110, 200, 290]) {
      const r = await ev(`(() => {
        const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock, H = d.layout.habitat;
        const a = ${deg} * Math.PI / 180, p = d.toGame(Math.cos(a) * H.drumR * 0.8, Math.sin(a) * H.drumR * 0.8);
        st.lastHitX = p.x; st.lastHitY = p.y;
        const step = (st.maxHp || 1) / Math.max(1, st.damageSteps || 5);
        if (st.hp - step * 1.02 <= 0) return { hp: st.hp, pominiete: true };
        S.deps.damageStation(st, step * 1.02);
        return { hp: Math.round(100 * st.hp / st.maxHp) };
      })()`);
      console.log('próg', deg, JSON.stringify(r));
      await sleep(1500);
    }
    await okno('progi', 4);
  }

  // HP 0 habitatu — finał misji (storyGame._chainExplosion → upadek)
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; S.deps.damageStation(st, st.hp + 10); return st.hp; })()`);
  const tFall = Date.now();
  let settled = false;
  while (Date.now() - tFall < 60000) {
    await sleep(500);
    const r = await tick('upadek', (Date.now() - tFall) / 1000);
    if (report.ticks.length % 4 === 0) console.log('upadek', JSON.stringify({ s: r.s, upadek: r.upadek, ft: r.ft, age: r.age, hot: r.hot, sleep: r.sleep, wd: r.wd, wk: r.wk && { kl: r.wk.klatki, p95: r.wk.p95, max: r.wk.max, o33: r.wk.over33, hs: r.wk.hs } }));
    if (r.upadek === 'settled') { settled = true; break; }
  }
  console.log('osiadło:', settled, ((Date.now() - tFall) / 1000).toFixed(1), 's');
  await screenshotPng(cdp, join(out, '02-po-upadku.png'));
  await okno('po', CZAS_PO, { profil: PROFIL });
  await screenshotPng(cdp, join(out, '03-po.png'));
  // kamera nad polem odłamów (gracz lata nad gruzem po upadku)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(0, 0); S.deps.placePlayer(p.x, p.y + 600, 0); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`).catch((e) => console.log('przelot:', e.message));
  await sleep(2000);
  await okno('nad-gruzem', 8, { profil: PROFIL });
  await screenshotPng(cdp, join(out, '04-nad-gruzem.png'));
  // --ab 1: ten sam kadr w pauzie — połówki brył przycinane (A1), rysowane zawsze (B), znów przycinane (A2): obraz
  // A1↔B ma się różnić nie bardziej niż szum A1↔A2 (efekty biegną w pauzie), rysunków ubywa
  if (args.ab === '1') {
    const { compareDirs } = await import('./porownaj.mjs');
    await ev('(window.__setGamePaused(true), true)');
    await sleep(800);
    const setCull = (on) => wkEval(`(() => { const o = globalThis.__worldSkinOptions; if (!o) return null; o.planeHalfCull = ${on}; return o.planeHalfCull; })()`);
    for (const [dir, on] of [['a1', true], ['b', false], ['a2', true], ['b2', false], ['a3', true], ['b3', false]]) {
      const r = await setCull(on);
      if (r === null) { console.log('A/B: brak __worldSkinOptions w workerze (stary kod?)'); break; }
      await sleep(500);
      await screenshotPng(cdp, join(out, 'ab', dir, 'nad-gruzem.png'));
      await drawProbe(`ab-${dir}`, 3000);
    }
    for (const [x, y] of [['a1', 'b'], ['a1', 'a2']]) {
      const c = compareDirs(join(out, 'ab', x), join(out, 'ab', y), join(out, 'ab', `${x}-${y}`));
      for (const row of c.rows) console.log(`A/B ${x}↔${y}`, JSON.stringify(row));
    }
    await ev('(window.__setGamePaused(false), true)');
  }
} catch (err) {
  console.error(err);
  report.bledy.push(String(err?.stack || err));
} finally {
  clearTimeout(watchdog);
  const hsLogs = report.wkLogi.filter((l) => /HullSurface/.test(l.text));
  console.log('konsola workera:', report.wkLogi.length, 'wpisów, HullSurface:', hsLogs.length, hsLogs.length ? `(pierwszy ${hsLogs[0].s} s, ostatni ${hsLogs[hsLogs.length - 1].s} s)` : '');
  const other = report.wkLogi.filter((l) => /warn|error|exception/.test(l.type) && !/HullSurface/.test(l.text));
  for (const l of other.slice(0, 15)) console.log('  wk', l.type, l.s, l.text.slice(0, 200));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
