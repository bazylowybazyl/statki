// Rytm klatek w DUŻEJ bitwie tak, jak widzi go gracz (2026-10-17, audyt renderu w workerze —
// docs/AUDYT-render-worker-2026-10-17.md). Prawdziwe okno Chrome z vsync (bez headless, jak gra u gracza), gra
// swobodna, bitwa flot jak scripts/profil-bitwy-flot.mjs (--sklad f,d,b,s na stronę), dziennik KLATKA PO KLATCE:
//   strona — znacznik rAF (vsync), czas wywołania pętli gry, kroki i czas fizyki w tej klatce, pakowanie migawki,
//            strona k wysłana do workera, k ostatnio złożone (to pokaże ta klatka), złożenia bitmap workera;
//   worker — odbiór wiadomości strony k, Core3D.renderSingle, wysyłka bitmapy k (czas epoki — wspólna oś ze stroną).
// Wynik: okres rAF w vsyncach (chybienia), czas wywołania wg liczby kroków fizyki, droga strony k
// (wysyłka → worker → złożenie), „wiek” obrazu 3D na ekranie i jego skoki (judder), najdłuższe klatki z kontekstem,
// długie klatki animacji (LoAF) ze skryptami; --slad N — ślad Chrome (PipelineReporter: klatki pokazane / zgubione).
//   node scripts/webgpu/rytm-bitwy.mjs [--sklad 50,20,10,3] [--zoom 0.45] [--czas 40] [--query renderWorker=1]
//        [--okno 1] [--seed 7] [--slad 6] [--watki 5] [--out katalog] [--szer 1920 --wys 1080] [--wkStart 'plik:ścieżka']
//        [--okna 15] (bitwa w oknach po N s — `okna` w wyniku; długa bitwa: --czas 150)
// Tryb off do porównania: --query renderWorker=0. Okno wychodzi na ekran — przebieg nie może być zasłonięty
// (Chrome z flagami bez dławienia zasłoniętych okien, ale rAF z vsync wymaga widocznego okna).
// --analiza katalog — sama analiza zapisanego dziennika (katalog/rytm.json) bez uruchamiania gry.
// --watkiAb 'nazwa@kodStrony@kodWorkera|…' (2026-10-17, proces GPU przy 5120 × 1440): po dzienniku bitwy — warianty
// przełączane w TEJ SAMEJ bitwie (kod strony i workera renderu; pusty = nic, `plik:ścieżka` — kod z pliku), po kolei
// --watkiPowt razy (ABAB…); w każdym oknie 1,5 s rozbiegu i ślad --watkiS s (kategorie toplevel, gpu, gpu.dawn):
// zajętość CrGpuMain / workera / strony, na obraz: `Queue::Submit` (liczba i ms), dekodowanie poleceń
// (`CommandBufferService:PutChanged` — czas całkowity z zagnieżdżonym Submit), raster kanw 2D strony
// (`RasterDecoderImpl…` Deserializing + Flush). Wynik `watkiAb` w raporcie (wariant → mediana okien).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, parseArgs } from './wspolne.mjs';

const args = parseArgs();
if (args.analiza) {
  const res = analyze(JSON.parse(readFileSync(join(args.analiza, 'rytm.json'), 'utf8')));
  writeFileSync(join(args.analiza, 'wynik.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  process.exit(0);
}
const SKLAD = String(args.sklad || '50,20,10,3').split(',').map((v) => Math.max(0, Number(v) || 0));
const [NF, ND, NB, NS] = [SKLAD[0] || 0, SKLAD[1] || 0, SKLAD[2] || 0, SKLAD[3] || 0];
const ZOOM = Number(args.zoom || 0.45);
const CZAS = Number(args.czas || 40);
const QUERY = args.query || 'renderWorker=1';
const OKNO = (args.okno ?? '1') !== '0';
const SEED = args.seed ?? '7';
const SLAD = Number(args.slad ?? 6);
// --watki N (2026-10-17): osobny ślad Chrome N s (kategoria toplevel — zadania każdego wątku) → zajętość wątków
// [% czasu]: renderer strony, worker renderu, proces GPU (CrGpuMain — tam idą polecenia WebGPU workera i składanie
// strony), kompozytor viz, przeglądarka. Pokazuje, który wątek trzyma rytm, gdy wątek gry ma zapas.
const WATKI = Number(args.watki ?? 0);
const kodZ = (v) => (!v ? '' : (String(v).startsWith('plik:') ? readFileSync(String(v).slice(5), 'utf8') : String(v)));
const WATKI_AB = String(args.watkiAb || '').split('|').filter(Boolean).map((v) => { const [nazwa, strona, worker] = v.split('@'); return { nazwa, strona: kodZ(strona), worker: kodZ(worker) }; });
const WATKI_AB_POWT = Number(args.watkiPowt ?? 3), WATKI_AB_S = Number(args.watkiS ?? 3);
// --wkAb 'kodA|kodB' (2026-10-17): A/B W TEJ SAMEJ bitwie przez cały dziennik — co --wkAbOkres s (domyślnie 4) kod
// kolejnego wariantu w workerze renderu (`plik:ścieżka` — kod z pliku); pierwsze --wkAbRozbieg s (0,5) okna pomijane.
// Przebiegi bitwy różnią się intensywnością (ta sama skala floty potrafi mieć po 80 s 10 albo 90 wraków), więc
// porównanie wariantów w osobnych przebiegach myli wariant z przebiegiem; tu oba warianty widzą tę samą fazę.
// Wynik `wkAb`: wariant → rytm z jego okien (cała bitwa, bitwa < 30 s, bitwa ≥ 30 s — rzeź zaczyna się po ~40 s).
const WK_AB = String(args.wkAb || '').split('|').filter(Boolean).map(kodZ);
const WK_AB_OKRES = Number(args.wkAbOkres ?? 4), WK_AB_ROZBIEG = Number(args.wkAbRozbieg ?? 0.5);
const SZER = Number(args.szer || 1920), WYS = Number(args.wys || 1080);
// --wkStart (2026-10-17): kod w workerze renderu po starcie gry, przed spokojem (A/B przełączników Core3D w tym samym
// buildzie — np. stare ścieżki GPU); `plik:ścieżka` — kod z pliku. Wynik w raporcie `wkStart`.
const WK_START = args.wkStart ? (String(args.wkStart).startsWith('plik:') ? readFileSync(String(args.wkStart).slice(5), 'utf8') : String(args.wkStart)) : '';
const OUT = args.out || join(tmpdir(), `rytm-bitwy-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5412));
const chrome = await startChrome({ width: SZER, height: WYS, headless: !OKNO ? undefined : false, webgpu: false, renderMode: 'worker',
  extraArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'] });
const { cdp, logs } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = (label, value) => console.log(String(label).padEnd(12), typeof value === 'string' ? value : JSON.stringify(value));

// sesja workera renderu (Target.setAutoAttach, flatten) — odczyt dziennika workera
const wk = { sid: null, id: 9000000 };
const wkSend = (method, params = {}) => {
  const id = ++wk.id;
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId: wk.sid }));
  return new Promise((ok, reject) => cdp.pending.set(id, { ok, reject }));
};
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget' && msg.params?.targetInfo?.type === 'worker' && !wk.sid
    && /render\.worker/.test(msg.params.targetInfo.url || '')) {
    wk.sid = msg.params.sessionId;
    wkSend('Runtime.enable').catch(() => {});
    wkSend('Runtime.runIfWaitingForDebugger').catch(() => {});
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}
  ${SEED !== '' ? `let s = ${Number(SEED) >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };` : ''}
})();` });

// Dziennik strony: pętla gry (PerfHUD.recordFrameTime na końcu loop), kroki fizyki (addTiming 'physicsTime' raz na
// krok), takt rAF (znacznik vsync i k ostatnio złożone), wysyłka strony (RenderWorkerHost.postFrame), złożenia
// (ring.compose), długie klatki animacji (LoAF).
const PAGE_INSTALL = `(async () => {
  const m = await import('/src/ui/perfHud.js'); const PH = m.PerfHUD; window.__PH = PH;
  const N = 1 << 17, M = N - 1, H = window.RenderWorkerHost || null;
  const R = window.__rytm = { origin: performance.timeOrigin, worker: !!H,
    n: 0, fid: new Int32Array(N), cb0: new Float64Array(N), cb1: new Float64Array(N), phys: new Float32Array(N), steps: new Uint8Array(N),
    pack: new Float32Array(N), postK: new Int32Array(N),
    tn: 0, tFid: new Int32Array(N), tT: new Float64Array(N), tRun: new Float64Array(N), tShown: new Int32Array(N),
    cn: 0, cT: new Float64Array(N), cK: new Int32Array(N),
    pn: 0, pT: new Float64Array(N), pK: new Int32Array(N), pFid: new Int32Array(N),
    curPhys: 0, curSteps: 0, curPost: -1, on: true, loaf: [],
    // drgania ekranowe kadłubów NPC: 16 okrętów najbliżej kamery (wybór przy pierwszej klatce z flotą), poza taka jak
    // w obrazie 3D (RenderPoses — interpolacja; bez niej poza z kroku), druga różnica położenia na ekranie [px]
    npcSel: null, sx: new Float64Array(32), sy: new Float64Array(32), px2: new Float64Array(32), py2: new Float64Array(32),
    sn: new Int32Array(32), jit: new Float32Array(N) };
  const jitterSample = () => {
    const cam = window.camera, npcs = window.npcs || [];
    if (!cam) return NaN;
    if (!R.npcSel) {
      const live = npcs.filter((n) => n && !n.dead && !n.fighter);
      if (live.length < 20) return NaN;
      const d = (n) => { const x = n.pos ? n.pos.x : n.x, y = n.pos ? n.pos.y : n.y; return (x - cam.x) ** 2 + (y - cam.y) ** 2; };
      R.npcSel = live.sort((a, b) => d(a) - d(b)).slice(0, 16);
    }
    const z = cam.zoom || 1, RP = window.RenderPoses;
    let sum = 0, cnt = 0;
    for (let i = 0; i < R.npcSel.length; i++) {
      const n = R.npcSel[i];
      if (!n || n.dead) { R.sn[i] = 0; continue; }
      const rp = RP ? RP.poseOf(n) : null;
      const x = rp ? rp.x : (n.pos ? n.pos.x : n.x), y = rp ? rp.y : (n.pos ? n.pos.y : n.y);
      const sx = (x - cam.x) * z, sy = (y - cam.y) * z;
      if (R.sn[i] >= 2) { const ax = sx - 2 * R.sx[i] + R.px2[i], ay = sy - 2 * R.sy[i] + R.py2[i]; sum += Math.sqrt(ax * ax + ay * ay); cnt++; }
      R.px2[i] = R.sx[i]; R.py2[i] = R.sy[i]; R.sx[i] = sx; R.sy[i] = sy; R.sn[i]++;
    }
    return cnt ? sum / cnt : NaN;
  };
  const at0 = PH.addTiming;
  PH.addTiming = function (key, ms) { if (key === 'physicsTime') { R.curPhys += ms; R.curSteps++; } return at0.call(this, key, ms); };
  const rf0 = PH.recordFrameTime;
  PH.recordFrameTime = function (ms) {
    const end = performance.now(), i = R.n & M;
    R.fid[i] = window.__frameId | 0; R.cb0[i] = end - ms; R.cb1[i] = end; R.phys[i] = R.curPhys; R.steps[i] = Math.min(255, R.curSteps);
    const P = window.RenderSnapshot && window.RenderSnapshot.packer; R.pack[i] = P ? (P.stats.beginMs + P.stats.finishMs) : 0;
    R.postK[i] = R.curPost; R.jit[i] = jitterSample(); R.n++; R.curPhys = 0; R.curSteps = 0; R.curPost = -1;
    return rf0.call(this, ms);
  };
  if (H) {
    const pf0 = H.postFrame;
    H.postFrame = function () { const P = window.RenderSnapshot && window.RenderSnapshot.packer; const k = P ? P.k : -1;
      const i = R.pn & M; R.pT[i] = performance.now(); R.pK[i] = k; R.pFid[i] = window.__frameId | 0; R.pn++; R.curPost = k; return pf0.apply(this, arguments); };
    const rc0 = H.ring.compose;
    H.ring.compose = function (k) { const i = R.cn & M; R.cT[i] = performance.now(); R.cK[i] = k; R.cn++; return rc0.call(this, k); };
  }
  (function tick(t) { const i = R.tn & M; R.tFid[i] = window.__frameId | 0; R.tT[i] = t; R.tRun[i] = performance.now();
    R.tShown[i] = H ? H.ring.lastComposed : -1; R.tn++; if (R.on) requestAnimationFrame(tick); })(performance.now());
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) { if (R.loaf.length > 400) break;
      R.loaf.push({ t: e.startTime, d: e.duration, block: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
        scripts: (e.scripts || []).slice(0, 4).map((s) => ({ d: Math.round(s.duration), inv: s.invoker, fn: s.sourceFunctionName, src: (s.sourceURL || '').split('/').pop() + ':' + (s.sourceCharPosition ?? '') })) }); } })
      .observe({ type: 'long-animation-frame', buffered: false });
  } catch (_) { /* brak LoAF */ }
  return { ok: true, worker: !!H };
})()`;

// Dziennik workera (operacja narzędzi RenderWorkerHost.dev — kod w workerze z dostępem do Core3D i stanu `st`).
const WORKER_INSTALL = `
  const N = 1 << 17, M = N - 1;
  const W = globalThis.__rytmW = { n: 0, recvT: new Float64Array(N), recvK: new Int32Array(N),
    sn: 0, sendT: new Float64Array(N), sendK: new Int32Array(N), rn: 0, rs0: new Float64Array(N), rs1: new Float64Array(N) };
  const ep = () => performance.timeOrigin + performance.now();
  const on0 = self.onmessage;
  self.onmessage = function (e) { const m = e.data; if (m && m.type === 'frame') { const i = W.n & M; W.recvT[i] = ep(); W.recvK[i] = m.k; W.n++; } return on0.call(this, e); };
  const pm0 = globalThis.postMessage;
  globalThis.postMessage = function (m, t) { if (m && m.type === 'frame') { const i = W.sn & M; W.sendT[i] = ep(); W.sendK[i] = m.k; W.sn++; }
    return t ? pm0.call(globalThis, m, t) : pm0.call(globalThis, m); };
  const rs = Core3D.renderSingle;
  Core3D.renderSingle = function (...a) { const i = W.rn & M; W.rs0[i] = ep(); const r = rs.apply(this, a); W.rs1[i] = ep(); W.rn++; return r; };
`;

const out = { args: { sklad: SKLAD, zoom: ZOOM, czas: CZAS, query: QUERY, okno: OKNO, seed: SEED, szer: SZER, wys: WYS, okna: Number(args.okna || 0) } };
try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&${QUERY}` });
  for (let t0 = Date.now(); Date.now() - t0 < 180000;) {
    await sleep(250);
    try { if (await ev('!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies) && (!window.__menuBackdrop || !!window.__menuBackdrop.ready)')) break; } catch { /* ładuje się */ }
  }
  await sleep(2500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); setTimeout(() => document.getElementById('btn-mode-single')?.click(), 600); return true; })()`);
  let started = false;
  for (let t0 = Date.now(); !started && Date.now() - t0 < 240000;) {
    await sleep(250);
    try { started = await ev('(window.__frameId | 0) > 60 && !!window.camera'); } catch { /* */ }
  }
  report('gra', { started, tryb: await ev('window.__renderModeBoot && window.__renderModeBoot.mode') });
  if (!started) throw new Error('gra nie wystartowała');

  // pusta przestrzeń jak profil-bitwy-flot: orbita między Wenus a Ziemią, kąt najdalej od planet i stacji
  report('miejsce', await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { x: Math.round(best.x), y: Math.round(best.y), najblizejKm: Math.round(best.dmin / 1000) };
  })()`));
  await sleep(3000);
  report('dziennik', await ev(PAGE_INSTALL));
  if (await ev('!!window.RenderWorkerHost')) {
    await ev(`(() => { window.RenderWorkerHost.dev({ eval: ${JSON.stringify(WORKER_INSTALL)} }); return true; })()`);
  }
  if (WK_START && wk.sid) {
    const r = await wkSend('Runtime.evaluate', { expression: WK_START, awaitPromise: true, returnByValue: true }).catch((e) => ({ error: String(e) }));
    out.wkStart = r?.result?.value ?? r?.exceptionDetails?.text ?? r?.error ?? null;
    report('wkStart', out.wkStart);
  }
  await sleep(1000);
  // spokój: znacznik czasu strony (dziennik dzieli się na fazy po czasie)
  const tCalm0 = await ev('performance.now()');
  await sleep(6000);
  const tCalm1 = await ev('performance.now()');
  report('spawn', await ev(`(() => {
    const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = { piraci: 0, tn: 0 };
    const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
      const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
    const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
      for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
        put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
    block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
    block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
    block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
    block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
    block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
    block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
    block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
    block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    return out;
  })()`));
  const tBattle0 = await ev('performance.now()');
  const stan = [];
  const STAN_EXPR = `(() => { const npcs = window.npcs || [], live = npcs.filter((n) => !n.dead && !n.fighter);
    const h = window.RenderWorkerHost; let w = null; if (h) { h.readStats(); const s = h.stats; w = { cpu: +(s[6] || 0).toFixed(2), upd: +(s[4] || 0).toFixed(2),
      rend: +(s[5] || 0).toFixed(2), gpu: +(s[0] || 0).toFixed(2), comp: h.composed, misses: h.ring.misses, full: h.ring.full, err: h.errors.length }; }
    const P = window.RenderSnapshot?.packer;
    return { t: Math.round(performance.now()), npc: live.length, wraki: (window.wrecks || []).length, zimne: (window.coldWrecks || []).length,
      pociski: (window.bullets || []).length, zoom: +(window.camera?.zoom || 0).toFixed(3), w,
      snap: P ? { ents: P.stats.ents, bodies: P.stats.bodies, bodiesPacked: P.stats.bodiesPacked, nodes: P.stats.nodesPacked, grows: P.stats.layoutGrows } : null }; })()`;
  const tEnd = Date.now() + CZAS * 1000;
  const wkAbOkna = [];
  if (WK_AB.length && wk.sid) {
    let i = 0, lastStan = Date.now();
    while (Date.now() < tEnd) {
      const v = i % WK_AB.length;
      await wkSend('Runtime.evaluate', { expression: WK_AB[v], awaitPromise: true, returnByValue: true }).catch(() => null);
      const t0 = await ev('performance.now()');
      await sleep(WK_AB_OKRES * 1000);
      const t1 = await ev('performance.now()');
      wkAbOkna.push({ v, t0: t0 + WK_AB_ROZBIEG * 1000, t1 });
      i++;
      if (Date.now() - lastStan >= 5000) { lastStan = Date.now(); const s = await ev(STAN_EXPR); stan.push(s); report('stan', s); }
    }
  } else {
    while (Date.now() < tEnd) { await sleep(5000); const s = await ev(STAN_EXPR); stan.push(s); report('stan', s); }
  }
  const tBattle1 = await ev('performance.now()');

  // --watkiAb: warianty w tej samej bitwie, krótkie ślady wątków (patrz nagłówek)
  let watkiAb = null;
  if (WATKI_AB.length) {
    const okna = [];
    const sink = { ev: null, done: null };
    cdp.on((msg) => {
      if (msg.method === 'Tracing.dataCollected' && sink.ev) { for (const e of msg.params.value) if (e.ph === 'X' || e.ph === 'M') sink.ev.push(e); }
      else if (msg.method === 'Tracing.tracingComplete' && sink.done) { const f = sink.done; sink.done = null; f(); }
    });
    const licz = () => ev('(() => { const h = window.RenderWorkerHost; return { f: window.__frameId | 0, c: h ? h.composed : 0, t: performance.now() }; })()');
    for (let r = 0; r < WATKI_AB_POWT; r++) {
      for (const w of WATKI_AB) {
        let wynik = null;
        if (w.strona) wynik = await ev(w.strona).catch((e) => String(e));
        if (w.worker && wk.sid) { const rr = await wkSend('Runtime.evaluate', { expression: w.worker, awaitPromise: true, returnByValue: true }).catch((e) => ({ error: String(e) })); wynik = rr?.result?.value ?? rr?.exceptionDetails?.text ?? rr?.error ?? wynik; }
        await sleep(1500);
        const events = [];
        sink.ev = events;
        const done = new Promise((ok) => { sink.done = ok; });
        const a0 = await licz();
        await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible',
          includedCategories: ['toplevel', '__metadata', 'gpu', 'gpu.dawn'], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
        await sleep(WATKI_AB_S * 1000);
        await cdp.send('Tracing.end');
        const a1 = await licz();
        await Promise.race([done, sleep(20000)]);
        sink.ev = null;
        okna.push({ nazwa: w.nazwa, r, wynik, ...abWindow(events, a0, a1) });
        report('wątki A/B', okna[okna.length - 1]);
      }
    }
    // mediana okien na wariant
    const pola = Object.keys(okna[0]).filter((k) => typeof okna[0][k] === 'number' && k !== 'r');
    watkiAb = { okna, warianty: {} };
    for (const w of WATKI_AB) {
      const o = okna.filter((x) => x.nazwa === w.nazwa);
      const med = {};
      for (const k of pola) { const v = o.map((x) => x[k]).filter(Number.isFinite).sort((a, b) => a - b); med[k] = v.length ? v[Math.floor(v.length / 2)] : null; }
      watkiAb.warianty[w.nazwa] = med;
    }
    report('wątki A/B — mediany', watkiAb.warianty);
  }

  // ślad Chrome (osobne okno czasu PO dzienniku): klatki pokazane / częściowe / zgubione (PipelineReporter)
  let slad = null;
  if (SLAD > 0) {
    const events = [];
    const onData = (msg) => { if (msg.method === 'Tracing.dataCollected') for (const e of msg.params.value) events.push(e); };
    cdp.on(onData);
    const done = new Promise((ok) => cdp.on((msg) => { if (msg.method === 'Tracing.tracingComplete') ok(); }));
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['disabled-by-default-devtools.timeline.frame', 'benchmark'], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
    await sleep(SLAD * 1000);
    await cdp.send('Tracing.end');
    await Promise.race([done, sleep(15000)]);
    const states = {}, names = {};
    let sample = null;
    for (const e of events) {
      names[e.name] = (names[e.name] || 0) + 1;
      if (e.name === 'PipelineReporter' && (e.ph === 'b' || e.ph === 'B' || e.ph === 'X')) {
        if (!sample) sample = e.args;
        const st = e.args?.chrome_frame_reporter?.state ?? e.args?.data?.state ?? '?';
        states[st] = (states[st] || 0) + 1;
      }
    }
    slad = { s: SLAD, zdarzen: events.length, nazwy: Object.fromEntries(Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 15)), stany: states,
      przyklad: sample ? JSON.stringify(sample).slice(0, 600) : null };
    report('ślad', slad);
  }

  // zajętość wątków (--watki): zadania najwyższego poziomu (toplevel) każdego wątku, sumy rozłącznych przedziałów
  let watki = null;
  if (WATKI > 0) {
    const events = [];
    const onData = (msg) => { if (msg.method === 'Tracing.dataCollected') for (const e of msg.params.value) events.push(e); };
    cdp.on(onData);
    const done = new Promise((ok) => cdp.on((msg) => { if (msg.method === 'Tracing.tracingComplete') ok(); }));
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['toplevel', '__metadata', ...String(args.watkiKat || '').split(',').filter(Boolean)], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
    const tw0 = Date.now();
    await sleep(WATKI * 1000);
    await cdp.send('Tracing.end');
    const tw = (Date.now() - tw0) * 1000;   // µs
    await Promise.race([done, sleep(20000)]);
    const tname = new Map(), pname = new Map(), iv = new Map();
    for (const e of events) {
      if (e.ph === 'M' && e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args?.name);
      else if (e.ph === 'M' && e.name === 'process_name') pname.set(e.pid, e.args?.name);
      else if (e.ph === 'X' && e.dur > 0) { const k = `${e.pid}:${e.tid}`; let a = iv.get(k); if (!a) iv.set(k, a = []); a.push([e.ts, e.ts + e.dur]); }
    }
    const rows = [];
    let tMin = Infinity, tMax = -Infinity;
    for (const a of iv.values()) for (const [b, c] of a) { if (b < tMin) tMin = b; if (c > tMax) tMax = c; }
    const span = Math.max(1, Math.min(tw, tMax - tMin));
    for (const [k, a] of iv) {
      a.sort((x, y) => x[0] - y[0]);
      let busy = 0, cs = -1, ce = -1;
      for (const [b, c] of a) { if (b > ce) { if (ce > cs) busy += ce - cs; cs = b; ce = c; } else if (c > ce) ce = c; }
      if (ce > cs) busy += ce - cs;
      const pid = Number(k.split(':')[0]);
      rows.push({ watek: `${pname.get(pid) || pid} / ${tname.get(k) || k}`, zajety: +(100 * busy / span).toFixed(1), zadan: a.length });
    }
    rows.sort((x, y) => y.zajety - x.zajety);
    watki = { s: WATKI, okno_ms: +(span / 1000).toFixed(0), watki: rows.slice(0, 14) };
    // --watkiKat 'gpu,viz,…': dodatkowe kategorie — surowy ślad do OUT/watki-slad.json (analiza poza grą)
    if (args.watkiKat) writeFileSync(join(OUT, 'watki-slad.json'), JSON.stringify({ traceEvents: events }));
    report('wątki', watki);
  }

  const page = await ev(`(() => { const R = window.__rytm; R.on = false;
    const A = (a, n) => Array.from(a.subarray(0, Math.min(n, a.length)));
    return { origin: R.origin, worker: R.worker, n: R.n, fid: A(R.fid, R.n), cb0: A(R.cb0, R.n), cb1: A(R.cb1, R.n), phys: A(R.phys, R.n), steps: A(R.steps, R.n),
      pack: A(R.pack, R.n), postK: A(R.postK, R.n), jit: A(R.jit, R.n).map((v) => (v === v ? +v.toFixed(3) : null)), tn: R.tn,
      pacer: window.RenderWorkerHost && window.RenderWorkerHost.pacer ? { on: window.RenderWorkerHost.pacing, age: window.RenderWorkerHost.pacer.age,
        stats: { ...window.RenderWorkerHost.pacer.stats, ageHist: Array.from(window.RenderWorkerHost.pacer.stats.ageHist) } } : null,
      lerp: !!(window.RenderPoses && window.RenderPoses.stats), tFid: A(R.tFid, R.tn), tT: A(R.tT, R.tn), tRun: A(R.tRun, R.tn), tShown: A(R.tShown, R.tn),
      cn: R.cn, cT: A(R.cT, R.cn), cK: A(R.cK, R.cn), pn: R.pn, pT: A(R.pT, R.pn), pK: A(R.pK, R.pn), pFid: A(R.pFid, R.pn), loaf: R.loaf }; })()`, 300000);
  let worker = null;
  if (wk.sid) {
    const r = await wkSend('Runtime.evaluate', { expression: `(() => { const W = globalThis.__rytmW; if (!W) return null;
      const A = (a, n) => Array.from(a.subarray(0, Math.min(n, a.length)));
      return { n: W.n, recvT: A(W.recvT, W.n), recvK: A(W.recvK, W.n), sn: W.sn, sendT: A(W.sendT, W.sn), sendK: A(W.sendK, W.sn),
        rn: W.rn, rs0: A(W.rs0, W.rn), rs1: A(W.rs1, W.rn) }; })()`, returnByValue: true });
    worker = r?.result?.value || null;
  }
  Object.assign(out, { tCalm0, tCalm1, tBattle0, tBattle1, stan, slad, watki, watkiAb, wkAbOkna, page, worker, bledy: logs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 20) });
  writeFileSync(join(OUT, 'rytm.json'), JSON.stringify(out));
  const res = analyze(out);
  writeFileSync(join(OUT, 'wynik.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  report('pliki', OUT);
} catch (err) {
  console.error('BŁĄD', err.stack || err.message, logs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 10));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

// ── analiza ─────────────────────────────────────────────────────────────────────────────────────────────────
function q(arr, p) { if (!arr.length) return NaN; const a = Float64Array.from(arr).sort(); return +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2); }
function mean(arr) { return arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3) : NaN; }
function stats(arr) { return { n: arr.length, sr: mean(arr), p50: q(arr, 0.5), p90: q(arr, 0.9), p95: q(arr, 0.95), p99: q(arr, 0.99), maks: q(arr, 1) }; }

// Okno śladu wątków (--watkiAb): zajętość wątków (suma rozłącznych przedziałów zadań) i na obraz (złożenia bitmap
// workera; bez workera — klatki strony) koszt zgłoszeń kolejki, dekodowania poleceń i rastra kanw 2D na CrGpuMain.
function abWindow(events, a0, a1) {
  const tname = new Map(), iv = new Map(), sum = new Map(), cnt = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args?.name);
  let gpuKey = null;
  for (const [k, n] of tname) if (n === 'CrGpuMain') gpuKey = k;
  let t0 = Infinity, t1 = -Infinity;
  for (const e of events) {
    if (e.ph !== 'X' || !(e.dur > 0)) continue;
    const k = `${e.pid}:${e.tid}`;
    if (e.ts < t0) t0 = e.ts;
    if (e.ts + e.dur > t1) t1 = e.ts + e.dur;
    if (e.cat && e.cat.includes('toplevel')) { let a = iv.get(k); if (!a) iv.set(k, a = []); a.push([e.ts, e.ts + e.dur]); }
    if (k === gpuKey) { sum.set(e.name, (sum.get(e.name) || 0) + e.dur); cnt.set(e.name, (cnt.get(e.name) || 0) + 1); }
  }
  const span = Math.max(1, t1 - t0);
  const busy = (k) => { const a = iv.get(k); if (!a) return 0; a.sort((x, y) => x[0] - y[0]); let b = 0, cs = -1, ce = -1;
    for (const [x, y] of a) { if (x > ce) { if (ce > cs) b += ce - cs; cs = x; ce = y; } else if (y > ce) ce = y; } if (ce > cs) b += ce - cs; return +(100 * b / span).toFixed(1); };
  let wkKey = null, pageKey = null;
  for (const [k, n] of tname) {
    if (/DedicatedWorker/.test(n || '') && busy(k) > (wkKey ? busy(wkKey) : -1)) wkKey = k;
    if (n === 'CrRendererMain' && busy(k) > (pageKey ? busy(pageKey) : -1)) pageKey = k;
  }
  const dt = Math.max(1e-3, (a1.t - a0.t) / 1000);
  const obrazy = a1.c > a0.c ? a1.c - a0.c : a1.f - a0.f;
  const per = Math.max(1, obrazy);
  const ms = (n) => +(((sum.get(n) || 0) / 1000) / per).toFixed(3);
  const n = (n0) => +((cnt.get(n0) || 0) / per).toFixed(2);
  return {
    klatkiStrony: +((a1.f - a0.f) / dt).toFixed(1), obrazyS: +(obrazy / dt).toFixed(1),
    gpuZajety: gpuKey ? busy(gpuKey) : null, workerZajety: wkKey ? busy(wkKey) : null, stronaZajeta: pageKey ? busy(pageKey) : null,
    submitN: n('Queue::Submit'), submitMs: ms('Queue::Submit'), dekodN: n('CommandBufferService:PutChanged'), dekodMs: ms('CommandBufferService:PutChanged'),
    rasterMs: +(ms('RasterDecoderImpl::DoRasterCHROMIUM::Deserializing') + ms('RasterDecoderImpl::DoEndRasterCHROMIUM::Flush')).toFixed(3),
    rasterN: n('RasterDecoderImpl::DoEndRasterCHROMIUM::Flush'), presentN: n('DXGISwapChainImageBacking::Present')
  };
}

function analyze(o) {
  const P = o.page, Wk = o.worker;
  const res = { args: o.args, bledy: o.bledy, slad: o.slad, watki: o.watki || null, watkiAb: o.watkiAb ? o.watkiAb.warianty : null, stanOstatni: o.stan[o.stan.length - 1] || null, pacer: P.pacer || null };
  // okres vsync: mediana odstępów rAF w spokoju
  const tickIdx = (t0, t1) => { const out = []; for (let j = 0; j < P.tn; j++) if (P.tRun[j] >= t0 && P.tRun[j] < t1) out.push(j); return out; };
  const calmTicks = tickIdx(o.tCalm0, o.tCalm1);
  const dts = []; for (let i = 1; i < calmTicks.length; i++) dts.push(P.tT[calmTicks[i]] - P.tT[calmTicks[i - 1]]);
  const V = q(dts, 0.5);
  res.vsyncMs = V; res.hz = +(1000 / V).toFixed(1);
  // takt rAF przed czy po pętli gry w tej samej klatce: dopasowanie po numerze klatki
  const loopByFid = new Map(); for (let i = 0; i < P.n; i++) loopByFid.set(P.fid[i], i);
  let before = 0, after = 0;
  for (let j = 0; j < P.tn; j++) {
    const a = loopByFid.get(P.tFid[j]); if (a !== undefined && P.tRun[j] >= P.cb1[a] && P.tRun[j] - P.cb1[a] < 3) after++;
    const b = loopByFid.get(P.tFid[j] + 1); if (b !== undefined && P.tRun[j] <= P.cb0[b] && P.cb0[b] - P.tRun[j] < 3) before++;
  }
  const tickBefore = before > after;
  res.taktPrzedPetla = tickBefore;
  const frameOfTick = (j) => (tickBefore ? P.tFid[j] + 1 : P.tFid[j]);
  const tOfFid = new Map(); for (let j = 0; j < P.tn; j++) tOfFid.set(frameOfTick(j), P.tT[j]);
  // czas treści strony k = znacznik rAF klatki, w której ją wysłano
  const contentOfK = new Map(); for (let i = 0; i < P.pn; i++) { const t = tOfFid.get(P.pFid[i]); if (t !== undefined) contentOfK.set(P.pK[i], t); }
  const phase = (name, t0, t1) => {
    const r = { faza: name };
    // pętla gry
    const loops = []; for (let i = 0; i < P.n; i++) if (P.cb0[i] >= t0 && P.cb1[i] < t1) loops.push(i);
    const cb = loops.map((i) => P.cb1[i] - P.cb0[i]);
    r.wywolanie = stats(cb);
    for (const s of [0, 1, 2]) {
      const sel = loops.filter((i) => (s < 2 ? P.steps[i] === s : P.steps[i] >= 2));
      r[`wywolanieKroki${s}${s === 2 ? '+' : ''}`] = { ...stats(sel.map((i) => P.cb1[i] - P.cb0[i])), udzial: +(sel.length / Math.max(1, loops.length)).toFixed(3),
        fizyka: stats(sel.map((i) => P.phys[i])) };
    }
    r.pakowanie = stats(loops.map((i) => P.pack[i]));
    // drgania ekranowe kadłubów NPC (druga różnica położenia na ekranie, px na klatkę — 0 = ruch jednostajny)
    if (P.jit) { const j = loops.map((i) => P.jit[i]).filter((x) => x !== null && x === x); if (j.length) r.drganiaNpcPx = stats(j); }
    // reszta wywołania poza fizyką i pakowaniem (render strony, nakładki, UI)
    r.resztaWywolania = stats(loops.map((i) => P.cb1[i] - P.cb0[i] - P.phys[i] - P.pack[i]));
    // takty rAF
    const ticks = tickIdx(t0, t1);
    const per = []; for (let a = 1; a < ticks.length; a++) per.push((P.tT[ticks[a]] - P.tT[ticks[a - 1]]) / V);
    const hist = {}; for (const v of per) { const b = Math.round(v); hist[b] = (hist[b] || 0) + 1; }
    r.okresVsync = { klatek: ticks.length, kl_s: +(ticks.length / Math.max(1e-3, (t1 - t0) / 1000)).toFixed(1), histogram: hist,
      chybione: per.reduce((s, v) => s + Math.max(0, Math.round(v) - 1), 0), udzialOkresow2plus: +(per.filter((v) => v >= 1.5).length / Math.max(1, per.length)).toFixed(3) };
    if (P.worker) {
      // obraz 3D na ekranie: wiek treści (vsync następnej klatki − czas treści k pokazanego w tej klatce) i jego skoki
      const age = [], step = [], jud = []; let repeats = 0, jumps = 0, prevC = NaN, prevD = NaN;
      for (let a = 0; a + 1 < ticks.length; a++) {
        const j = ticks[a], c = contentOfK.get(P.tShown[j]); const D = P.tT[ticks[a + 1]];
        if (c === undefined) { prevC = NaN; continue; }
        age.push((D - c) / V);
        if (prevC === prevC) {
          const dc = (c - prevC) / V, dd = (D - prevD) / V;
          step.push(dc); jud.push(Math.abs(dc - dd));
          if (dc === 0) repeats++;
          if (dc - dd >= 0.5) jumps++;
        }
        prevC = c; prevD = D;
      }
      const ageH = {}; for (const v of age) { const b = Math.round(v); ageH[b] = (ageH[b] || 0) + 1; }
      r.obraz3D = { wiekVsync: { ...stats(age), histogram: ageH }, krokTresciVsync: stats(step),
        skokiPonad05: +(jud.filter((v) => v >= 0.5).length / Math.max(1, jud.length)).toFixed(3),
        powtorzenia: repeats, przeskoki: jumps, probek: jud.length };
      // droga strony k: wysyłka (strona) → odbiór (worker) → wysyłka bitmapy (worker) → złożenie (strona)
      if (Wk) {
        const toPage = (ep) => ep - P.origin;
        const recv = new Map(), send = new Map(), comp = new Map(), post = new Map();
        for (let i = 0; i < Wk.n; i++) recv.set(Wk.recvK[i], toPage(Wk.recvT[i]));
        for (let i = 0; i < Wk.sn; i++) send.set(Wk.sendK[i], toPage(Wk.sendT[i]));
        for (let i = 0; i < P.cn; i++) comp.set(P.cK[i], P.cT[i]);
        for (let i = 0; i < P.pn; i++) post.set(P.pK[i], P.pT[i]);
        const lagMsg = [], wr = [], back = [], total = [], skipped = [];
        let posted = 0, composed = 0;
        for (const [k, tp] of post) {
          if (tp < t0 || tp >= t1) continue;
          posted++;
          const tr = recv.get(k), ts = send.get(k), tc = comp.get(k);
          if (tr !== undefined) lagMsg.push(tr - tp);
          if (tr !== undefined && ts !== undefined) wr.push(ts - tr);
          if (ts !== undefined && tc !== undefined) back.push(tc - ts);
          if (tc !== undefined) { total.push(tc - tp); composed++; } else skipped.push(k);
        }
        // render workera (Core3D.renderSingle) i odstępy wysyłek bitmap
        const rsd = []; for (let i = 0; i < Wk.rn; i++) { const t = toPage(Wk.rs0[i]); if (t >= t0 && t < t1) rsd.push(Wk.rs1[i] - Wk.rs0[i]); }
        const sendGap = []; let lastS = NaN; for (let i = 0; i < Wk.sn; i++) { const t = toPage(Wk.sendT[i]); if (t < t0 || t >= t1) continue; if (lastS === lastS) sendGap.push(t - lastS); lastS = t; }
        const compGap = []; let lastC = NaN; for (let i = 0; i < P.cn; i++) { const t = P.cT[i]; if (t < t0 || t >= t1) continue; if (lastC === lastC) compGap.push(t - lastC); lastC = t; }
        // chwile w klatce (od znacznika vsync klatki strony k, w vsyncach): wysyłka strony, bitmapa gotowa w workerze,
        // złożenie — bitmapa przed następnym vsynciem = obraz 2 vsynci po treści, po nim — 3 i więcej
        const postOff = [], readyOff = [], compOff = [];
        for (const [k, tp] of post) {
          if (tp < t0 || tp >= t1) continue;
          const c = contentOfK.get(k); if (c === undefined) continue;
          postOff.push((tp - c) / V);
          const ts = send.get(k); if (ts !== undefined) readyOff.push((ts - c) / V);
          const tc = comp.get(k); if (tc !== undefined) compOff.push((tc - c) / V);
        }
        const share = (a, x) => +(a.filter((v) => v < x).length / Math.max(1, a.length)).toFixed(3);
        r.droga = { stron: posted, zlozonych: composed, pominietych: skipped.length,
          wiadomoscDoWorkera: stats(lagMsg), klatkaWorkera: stats(wr), renderSingle: stats(rsd), powrotDoZlozenia: stats(back), wysylkaDoZlozenia: stats(total),
          odstepWysylekBitmap: stats(sendGap), odstepZlozen: stats(compGap),
          wysylkaOdVsyncV: stats(postOff), bitmapaOdVsyncV: { ...stats(readyOff), przed1V: share(readyOff, 1), przed2V: share(readyOff, 2) },
          zlozenieOdVsyncV: { ...stats(compOff), przed1V: share(compOff, 1), przed2V: share(compOff, 2) } };
      }
    }
    // najdłuższe wywołania pętli z kontekstem
    r.najdluzsze = loops.map((i) => ({ t: Math.round(P.cb0[i] - t0), ms: +(P.cb1[i] - P.cb0[i]).toFixed(1), kroki: P.steps[i], fiz: +P.phys[i].toFixed(1), pak: +P.pack[i].toFixed(2) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 12);
    r.loaf = (P.loaf || []).filter((e) => e.t >= t0 && e.t < t1).sort((a, b) => b.d - a.d).slice(0, 8);
    return r;
  };
  res.spokoj = phase('spokój', o.tCalm0, o.tCalm1);
  const tb = o.tBattle0, te = o.tBattle1;
  res.bitwaWczesna = phase('bitwa 0–15 s', tb, Math.min(te, tb + 15000));
  res.bitwaPozna = phase('bitwa > 15 s', Math.min(te, tb + 15000), te);
  // --okna N (2026-10-17, zgłoszenie użytkownika: „test kończy się, zanim statki zaczną się naprawdę nawalać”) — bitwa
  // w oknach po N s: rytm każdego okna osobno (spadki w środku rzezi nie giną w średniej całej bitwy) + stan bitwy
  // (okręty, wraki, pociski) z próbki `stan` najbliższej końca okna
  const okno = Number(o.args.okna || 0);
  if (okno > 0) {
    res.okna = [];
    for (let t = tb; t < te - 1000; t += okno * 1000) {
      const f = phase(`${Math.round((t - tb) / 1000)}–${Math.round((Math.min(te, t + okno * 1000) - tb) / 1000)} s`, t, Math.min(te, t + okno * 1000));
      const st = (o.stan || []).filter((x) => x.t <= Math.min(te, t + okno * 1000)).pop() || null;
      const d = f.droga || {};
      res.okna.push({ faza: f.faza, kl_s: f.okresVsync?.kl_s, wiek: f.obraz3D?.wiekVsync?.sr, skoki: f.obraz3D?.skokiPonad05,
        zlozS: f.okresVsync ? +((d.zlozonych || 0) / (f.okresVsync.klatek / f.okresVsync.kl_s)).toFixed(1) : null,
        wywP50: f.wywolanie?.p50, wywP95: f.wywolanie?.p95, fizP50: f.wywolanieKroki1?.fizyka?.p50, wkP50: d.klatkaWorkera?.p50, wkP95: d.klatkaWorkera?.p95,
        rsP50: d.renderSingle?.p50, npc: st?.npc, wraki: st?.wraki, pociski: st?.pociski, wkCpu: st?.w?.cpu, wkGpu: st?.w?.gpu });
    }
  }
  // --wkAb: okna wariantów → zbiorczo na wariant (ważone liczbą klatek / próbek; p50 i p95 — mediana okien)
  if (o.wkAbOkna && o.wkAbOkna.length) {
    const seg = { calosc: [tb, te], 'ponizej30s': [tb, tb + 30000], 'od30s': [tb + 30000, te] };
    res.wkAb = {};
    const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? +v[Math.floor(v.length / 2)].toFixed(2) : null; };
    for (const [sn, [s0, s1]] of Object.entries(seg)) {
      const byV = new Map();
      for (const w of o.wkAbOkna) {
        if (w.t0 < s0 || w.t0 >= s1 || w.t1 <= w.t0) continue;
        const f = phase('okno', w.t0, w.t1);
        let a = byV.get(w.v); if (!a) byV.set(w.v, a = { okien: 0, czas: 0, klatek: 0, zlozonych: 0, wiekSum: 0, wiekN: 0, skokiSum: 0, skokiN: 0, wkP50: [], wkP95: [], wywP50: [], wywP95: [] });
        const dt = (w.t1 - w.t0) / 1000;
        a.okien++; a.czas += dt; a.klatek += f.okresVsync?.klatek || 0; a.zlozonych += f.droga?.zlozonych || 0;
        const wn = f.obraz3D?.wiekVsync?.n || 0; a.wiekSum += (f.obraz3D?.wiekVsync?.sr || 0) * wn; a.wiekN += wn;
        const sn2 = f.obraz3D?.probek || 0; a.skokiSum += (f.obraz3D?.skokiPonad05 || 0) * sn2; a.skokiN += sn2;
        a.wkP50.push(f.droga?.klatkaWorkera?.p50); a.wkP95.push(f.droga?.klatkaWorkera?.p95); a.wywP50.push(f.wywolanie?.p50); a.wywP95.push(f.wywolanie?.p95);
      }
      const outSeg = {};
      for (const [v, a] of [...byV].sort((x, y) => x[0] - y[0])) {
        outSeg[`w${v}`] = { okien: a.okien, kl_s: +(a.klatek / Math.max(1e-3, a.czas)).toFixed(1), zlozS: +(a.zlozonych / Math.max(1e-3, a.czas)).toFixed(1),
          wiek: a.wiekN ? +(a.wiekSum / a.wiekN).toFixed(3) : null, skoki: a.skokiN ? +(a.skokiSum / a.skokiN).toFixed(3) : null,
          wkP50: med(a.wkP50), wkP95: med(a.wkP95), wywP50: med(a.wywP50), wywP95: med(a.wywP95) };
      }
      res.wkAb[sn] = outSeg;
    }
  }
  return res;
}
