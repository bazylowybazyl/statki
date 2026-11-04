// ZEGAR GPU KLATKI W GRZE (2026-11-04) — czy Core3D.gpuFrameMs / gpuComputeMs dają ms GPU na JEDNĄ klatkę.
// Błąd: three r183 grupuje znaczniki czasu po renderer.info.frame (takt rAF pętli three); w workerze renderu przy
// zapchanym GPU takt obejmował dziesiątki renderów, a gpuFrameMs był sumą (PerfHUD 14,82 ms przy 4,04 ms na klatkę).
// Poprawka: src/3d/zegarGpuKlatki.js (numer klatki Core3D przy przydziale zapytania).
//
// Przebieg: Vite + headless Chrome (bez okna), gra swobodna ze sceną „Wojna” (`?wojna` — floty z warpa, bitwa
// w głębi; obciąża GPU), czas rzeczywisty. Sonda w Core3D, który rysuje (worker: sesja workera; off: strona):
//   - odniesienie NIEZALEŻNE od rozliczenia Core3D: suma ms WSZYSTKICH znaczników puli three (render / compute)
//     z wyników w oknie ÷ liczba render() ze znacznikami w oknie (stan backend.trackTimestamp po bramie);
//   - próbki Core3D.gpuFrameMs / gpuComputeMs (nowe wyniki — liczniki gpuFrameSamples / gpuComputeSamples);
//   - rendery i takty rAF three (info.frame) w oknie — ile renderów obejmował jeden numer klatki three.
// Strona: próbki czasu GPU, które widzi rozdzielczość dynamiczna (window.Core3D.gpuFrameSamples / gpuFrameMs).
// Okno z cudzym harnessem albo grą usera — w raporcie `obce` (wynik do odrzucenia).
//
//   node scripts/webgpu/zegar-gpu-gra.mjs [--rozmiar 5120x1440] [--tryb worker|off] [--okna 4] [--czas 6]
//        [--rozbieg 12] [--grafika ultra] [--query …] [--out .tmp/zegar-gpu] [--tag nazwa] [--port 5397]
// A/B wersji kodu: ten plik skopiowany do worktree innej wersji i uruchomiony stamtąd (Vite podaje drzewo pliku).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, waitFor, evaluate, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const TRYB = args.tryb === 'off' ? 'off' : 'worker';
const OKNA = Number(args.okna || 4);
const CZAS = Number(args.czas || 6);
const ROZBIEG = Number(args.rozbieg || 12);
const GRAFIKA = String(args.grafika || 'ultra');
const TAG = String(args.tag || TRYB);
const out = resolve(repo, args.out || '.tmp/zegar-gpu');
mkdirSync(out, { recursive: true });
const query = `&renderWorker=${TRYB === 'worker' ? 1 : 0}&grafika=${GRAFIKA}&wojna${args.query ? '&' + args.query : ''}`;

const sh = (cmd, a) => new Promise((ok) => execFile(cmd, a, { windowsHide: true, maxBuffer: 1 << 22 }, (e, so) => ok(e ? '' : String(so))));
const nvidia = async () => (await sh('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,power.draw', '--format=csv,noheader,nounits'])).trim();
// cudze harnessy (node scripts/…mjs poza tym procesem) i gra usera
const obce = async () => {
  const ps = await sh('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[/\\\\]') -or $_.Name -match '^(League of Legends|RuneScape|rs2client)' } | ForEach-Object { \"$($_.ProcessId)|$($_.Name)|$($_.CommandLine)\" }"]);
  return ps.split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith(`${process.pid}|`)).map((l) => l.split('|').slice(1).join(' ').slice(0, 160));
};

// Sonda w kontekście Core3D, który rysuje. `C` — obiekt Core3D tego kontekstu.
const SONDA = (getC) => `(async () => {
  const C = ${getC};
  if (!C || !C.renderer) return 'brak Core3D z urządzeniem';
  if (globalThis.__zg) return 'już';
  const r = C.renderer, be = r.backend;
  const P = globalThis.__zg = { renders: 0, tracked: 0, refR: 0, refC: 0, nR: 0, nC: 0, sR: [], sC: [], f0: r.info.frame,
    seenR: C.gpuFrameSamples, seenC: C.gpuComputeSamples, wyniki: 0 };
  const gate = C._gpuTimerGate;
  C._gpuTimerGate = function () {
    const o = gate.apply(this, arguments);
    P.renders++;
    if (be.trackTimestamp === true) P.tracked++;
    return o;
  };
  const h = C._handleGpuTimestamp;
  C._handleGpuTimestamp = function (type) {
    const pool = be.timestampQueryPool && be.timestampQueryPool[type];
    if (pool && pool.timestamps) pool.timestamps.forEach((ms) => { if (type === 'render') { P.refR += ms; P.nR++; } else { P.refC += ms; P.nC++; } });
    P.wyniki++;
    const out = h.apply(this, arguments);
    if (C.gpuFrameSamples !== P.seenR) { P.seenR = C.gpuFrameSamples; P.sR.push(C.gpuFrameMs); }
    if (C.gpuComputeSamples !== P.seenC) { P.seenC = C.gpuComputeSamples; P.sC.push(C.gpuComputeMs); }
    return out;
  };
  return 'ok';
})()`;
const CZYTAJ = `(() => {
  const P = globalThis.__zg; if (!P) return null;
  const C = globalThis.__zgC || globalThis.Core3D;
  const st = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
    return { n: s.length, p50: q(0.5), p95: q(0.95), maks: +s[s.length - 1].toFixed(2), sr: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) }; };
  const f1 = C && C.renderer ? C.renderer.info.frame : P.f0;
  const o = { renders: P.renders, zeZnacznikami: P.tracked, taktyRafThree: f1 - P.f0, wyniki: P.wyniki,
    renderowNaTakt: f1 > P.f0 ? +(P.renders / (f1 - P.f0)).toFixed(1) : null,
    odniesienieRender: P.tracked ? +(P.refR / P.tracked).toFixed(2) : null, odniesienieCompute: P.tracked ? +(P.refC / P.tracked).toFixed(2) : null,
    gpuFrameMs: st(P.sR), gpuComputeMs: st(P.sC), skala: C ? C.renderScale : null, bufor: C && C.composerTarget ? [C.composerTarget.width, C.composerTarget.height] : null };
  P.renders = 0; P.tracked = 0; P.refR = 0; P.refC = 0; P.nR = 0; P.nC = 0; P.sR = []; P.sC = []; P.f0 = f1; P.wyniki = 0;
  return o;
})()`;
const STRONA = `(() => { const C = window.Core3D, h = window.RenderWorkerHost;
  if (h && h.readStats) h.readStats();
  return { gpuFrameSamples: C ? C.gpuFrameSamples : null, gpuFrameMs: C ? +(+C.gpuFrameMs).toFixed(2) : null, noDevice: !!(C && C.noDevice),
    zlozenia: h ? h.composed : null, gpuWorkera: h ? +(+h.stats[0]).toFixed(2) : null, frameId: window.__frameId | 0,
    wojna: !!(window.WarScene && window.WarScene.active) }; })()`;

const report = { args, rozmiar: [W, H], tryb: TRYB, start: { nvidia: await nvidia(), obce: await obce() }, okna: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.start));
const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);

// sesja workera renderu (Target.setAutoAttach, flatten)
const wk = { sid: null, id: 7000000 };
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
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) { wk.sid = msg.params.sessionId; wkSend('Runtime.enable').catch(() => {}); }
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown' && report.bledy.length < 40) report.bledy.push(String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text).slice(0, 300));
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0'); } catch (_) {}" });

let code = 0;
try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && (window.Core3D.noDevice ? !!window.RenderWorkerHost : window.Core3D.gpuReady !== false) && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, '!!(window.WarScene && window.WarScene.active)', 30000, 200)) throw new Error('scena Wojna nie ruszyła');
  await ev(`(() => { window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100); return true; })()`);
  const inWorker = TRYB === 'worker';
  const run = inWorker ? wkEval : ev;
  if (inWorker && !wk.sid) throw new Error('brak sesji workera renderu');
  const getC = inWorker ? `(globalThis.__zgC = (await import('/src/3d/core3d.js')).Core3D)` : 'window.Core3D';
  report.sonda = await run(SONDA(getC));
  console.log('sonda:', report.sonda, '— rozbieg', ROZBIEG, 's');
  await sleep(ROZBIEG * 1000);
  await run(CZYTAJ);
  await ev(STRONA);
  for (let i = 0; i < OKNA; i++) {
    const s0 = await ev(STRONA);
    const o0 = await obce();
    await sleep(CZAS * 1000);
    const z = await run(CZYTAJ);
    const s1 = await ev(STRONA);
    const o1 = await obce();
    const okno = { i, ...z, strona: { probkiGpu: s1.gpuFrameSamples - s0.gpuFrameSamples, gpuFrameMs: s1.gpuFrameMs, noDevice: s1.noDevice,
      zlozeniaNaS: s1.zlozenia != null ? +((s1.zlozenia - s0.zlozenia) / CZAS).toFixed(1) : null, klatkiGryNaS: +((s1.frameId - s0.frameId) / CZAS).toFixed(1),
      gpuWorkeraRet: s1.gpuWorkera, wojna: s1.wojna }, nvidia: await nvidia(), obce: [...new Set([...o0, ...o1])] };
    report.okna.push(okno);
    const g = z.gpuFrameMs, c = z.gpuComputeMs;
    console.log(`okno ${i}: rendery ${z.renders} (ze znacznikami ${z.zeZnacznikami}), takty rAF three ${z.taktyRafThree} → ${z.renderowNaTakt} renderów/takt | ` +
      `gpuFrameMs p50 ${g ? g.p50 : '—'} (n ${g ? g.n : 0}, maks ${g ? g.maks : '—'}) vs odniesienie ${z.odniesienieRender} ms | ` +
      `compute p50 ${c ? c.p50 : '—'} vs ${z.odniesienieCompute} | strona: próbek ${okno.strona.probkiGpu}, złożeń/s ${okno.strona.zlozeniaNaS} | nvidia ${okno.nvidia}` +
      (okno.obce.length ? ` | OBCE: ${okno.obce.length}` : ''));
  }
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(report.blad);
  code = 1;
} finally {
  writeFileSync(join(out, `raport-${TAG}.json`), JSON.stringify(report, null, 2));
  console.log('raport:', join(out, `raport-${TAG}.json`));
  await chrome.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(code);
}
