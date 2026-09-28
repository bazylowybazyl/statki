// Czasy startu gry w PRAWDZIWYM czasie (port WebGPU, zadanie 11 — rozgrzewka pipeline'ów): gotowość tła menu,
// ring Ziemi, pierwsza klatka gry po „Start” i przestoje (klatki > 50 ms) w menu i w pierwszych klatkach gry.
// Bez zegara wirtualnego harnessu (gra biegnie jak u gracza): do strony trafia tylko rejestrator klatek
// (rAF: start klatki, CPU wywołań, __frameId gry) i chwile startu (sprawdzane co ~5 ms). Świeży profil Chrome
// na przebieg = zimna pamięć shaderów (pierwsze uruchomienie gry). Pierwszy przebieg na serwerze („rozbieg”:
// Vite przerabia moduły) nie wchodzi do median.
//
//   node scripts/webgpu/start-gry.mjs [--root <repo gry, np. worktree tagu webgl-baseline>] [--powtorz 3]
//        [--port 5358] [--out katalog] [--klatki 300] [--menu-ms 2000] [--etykieta nazwa] [--bez-rozbiegu]
//        [--root-b <drugie repo> [--etykieta-b nazwa]]
//
// --root-b (zadanie 25a): porównanie A/B NA PRZEMIAN (A, B, A, B…; dwa serwery, rozbieg każdego) — obciążenie
// maszyny zmienia bezwzględne czasy między seriami o sekundy, więc „przed / po” tylko w jednej serii naprzemiennej.
//
// Wynik: <out>/start-<etykieta>.json (przebiegi + mediany z rozrzutem) i podsumowanie na konsoli. Czasy
// chwil liczone od nawigacji (performance.now strony): gpuReady (WebGPU), menuPierwszaKlatka, menuGotowe
// (kurtyna menu znika), ringZiemi (mapy ringu), klik („Start”), graPierwszaKlatka; graOdKliku = pierwsza
// klatka gry − klik (w tym stałe czekanie startGame: wyjazd menu 0,62 s, najazd kamery ≥ 2,2 s, czerń 0,38 s).
// Klatki: menu = od pierwszej klatki tła do kliku, gra = pierwsze `--klatki` klatek gry (okres klatki =
// start następnej − start tej; przestój = okres > 50 ms).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5358);
const repeats = Math.max(1, Number(args.powtorz || 3));
const gameFrames = Math.max(30, Number(args.klatki || 300));
const menuMs = Math.max(0, Number(args['menu-ms'] ?? 2000));
const label = args.etykieta || (root === repo ? 'repo' : root.split(/[\\/]/).filter(Boolean).pop());
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/11/start');
const STALL_MS = 50;

// Rejestrator w stronie (przed jej skryptami). Klatka = wszystkie wywołania rAF z tym samym znacznikiem.
const RECORDER = `(() => {
  if (window.__startRec) return;
  const now = performance.now.bind(performance);
  const raf = window.requestAnimationFrame.bind(window);
  const N = 60000;
  const R = { start: new Float64Array(N), cpu: new Float32Array(N), game: new Int32Array(N), n: 0, marks: {}, pipes: [] };
  let curTs = -1; let idx = 0; let inFrame = false;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const t0 = now();
    if (ts !== curTs) { curTs = ts; idx = R.n < N ? R.n++ : N - 1; R.start[idx] = t0; R.cpu[idx] = 0; }
    inFrame = true;
    try { cb(ts); } finally { inFrame = false; R.cpu[idx] += now() - t0; R.game[idx] = window.__frameId | 0; }
  });
  // Pipeline'y three: numer klatki (poza rAF — następnej, z poza: true — leży w okresie poprzedniej),
  // sync = zwykły render (przestój), compute zawsze sync.
  const pipeName = (m, o) => ((m && m.type) || '?') + (m && m.name ? ':' + m.name : '') + ' @ ' + ((o && o.type) || '?')
    + (o && o.name ? ':' + o.name : (o && o.parent && o.parent.name ? ' w ' + o.parent.name : ''));
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    if (r && r.isWebGLRenderer) clearInterval(hook); // tag WebGL: bez dziennika
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    const compute = pu.createComputePipeline;
    const push = (e) => { if (R.pipes.length < 16384) R.pipes.push(e); };
    pu.createRenderPipeline = function (ro, promises) {
      push({ k: inFrame ? idx : R.n, poza: !inFrame, sync: !promises, nazwa: pipeName(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
    pu.createComputePipeline = function (p, b) {
      push({ k: inFrame ? idx : R.n, poza: !inFrame, sync: true, compute: true, nazwa: 'compute' + (p && p.computeProgram && p.computeProgram.name ? ':' + p.computeProgram.name : '') });
      return compute.call(this, p, b);
    };
    // Budowy NodeBuilder (CPU): w klatce = render na zimno, poza nią = rozgrzewka w tle.
    const be = r.backend;
    const createNB = be.createNodeBuilder;
    be.createNodeBuilder = function (obj, rr) {
      const b = createNB.call(this, obj, rr);
      const build = b.build;
      b.build = function () {
        const t0 = now();
        try { return build.apply(this, arguments); } finally {
          push({ k: inFrame ? idx : R.n, poza: !inFrame, budowa: true, ms: +(now() - t0).toFixed(2), nazwa: pipeName(b.material, obj) });
        }
      };
      return b;
    };
  }, 10);
  const mark = (k, ok) => { if (R.marks[k] === undefined && ok) R.marks[k] = +now().toFixed(1); };
  const poll = setInterval(() => {
    try {
      mark('gpuReady', window.Core3D && window.Core3D.gpuReady === true);
      mark('menuPierwszaKlatka', ((window.__menuBackdrop && window.__menuBackdrop.stats && window.__menuBackdrop.stats.frames) || 0) > 0);
      mark('menuGotowe', !!(window.__menuBackdrop && window.__menuBackdrop.ready));
      const e = window.__haloRings && window.__haloRings.entries && window.__haloRings.entries.find((x) => x.key === 'earth');
      mark('ringZiemi', !!(e && e.ring && e.ring.mapsReady));
      mark('graPierwszaKlatka', (window.__frameId | 0) >= 1);
      if (R.marks.graPierwszaKlatka !== undefined) clearInterval(poll);
    } catch (err) { /* strona się ładuje */ }
  }, 5);
  window.__startRec = R;
})();`;

// Statystyki okna klatek [a, b): przestoje (okres > 50 ms), najdłuższy okres i CPU, p95 okresu.
function frameWindow(rec, a, b) {
  const out = { klatki: 0, przestoje: 0, maksMs: 0, maksCpu: 0, p95Ms: 0, sumaNadwyzekMs: 0, najdluzsze: [] };
  const periods = [];
  for (let i = a; i < b; i++) {
    const ms = i + 1 < rec.n ? rec.start[i + 1] - rec.start[i] : rec.cpu[i];
    const cpu = rec.cpu[i];
    periods.push(ms);
    out.maksMs = Math.max(out.maksMs, ms);
    out.maksCpu = Math.max(out.maksCpu, cpu);
    if (ms > STALL_MS) {
      out.przestoje++;
      out.sumaNadwyzekMs += ms - 1000 / 60;
      out.najdluzsze.push({ k: i - a, ms: +ms.toFixed(1), cpu: +cpu.toFixed(1), gra: rec.game[i] });
    }
  }
  out.klatki = periods.length;
  periods.sort((x, y) => x - y);
  out.p95Ms = periods.length ? +periods[Math.min(periods.length - 1, Math.floor(periods.length * 0.95))].toFixed(1) : 0;
  out.maksMs = +out.maksMs.toFixed(1);
  out.maksCpu = +out.maksCpu.toFixed(1);
  out.sumaNadwyzekMs = Math.round(out.sumaNadwyzekMs);
  out.najdluzsze.sort((x, y) => y.ms - x.ms);
  out.najdluzsze = out.najdluzsze.slice(0, 8);
  // pipeline'y utworzone w oknie; synchroniczne z okresu klatki przestoju (zwykle jego przyczyna): w jej
  // wywołaniach rAF albo po nich, przed następną klatką (poza rAF)
  const all = (rec.pipes || []).filter((p) => p.k >= a && (p.k < b || (p.k === b && p.poza)));
  const pipes = all.filter((p) => !p.budowa);
  const builds = all.filter((p) => p.budowa && !p.poza);
  const top = (list) => {
    const m = new Map();
    for (const p of list) m.set(p.nazwa, (m.get(p.nazwa) || 0) + 1);
    return [...m].sort((x, y) => y[1] - x[1]).slice(0, 16).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  };
  out.pipeline = {
    sync: pipes.filter((p) => p.sync && !p.compute).length,
    async: pipes.filter((p) => !p.sync).length,
    compute: pipes.filter((p) => p.compute).length,
    syncLista: top(pipes.filter((p) => p.sync)),
    // budowy NodeBuilder w klatkach (render na zimno) i poza nimi (rozgrzewka w tle)
    budowy: builds.length,
    budowyMs: +builds.reduce((s, p) => s + p.ms, 0).toFixed(1),
    budowyPoza: all.filter((p) => p.budowa && p.poza).length,
    budowyLista: top(builds)
  };
  for (const e of out.najdluzsze) {
    const i = a + e.k;
    const inPeriod = all.filter((p) => (p.poza ? p.k === i + 1 : p.k === i));
    const names = inPeriod.filter((p) => p.sync).map((p) => p.nazwa);
    if (names.length) e.pipeline = names.length > 6 ? [...names.slice(0, 6), `… +${names.length - 6}`] : names;
    // w tle (compileAsync: budowa NodeBuilder synchronicznie na CPU, pipeline w tle GPU)
    const nAsync = inPeriod.filter((p) => !p.sync && !p.budowa).length;
    if (nAsync) e.pipelineWTle = nAsync;
    const nb = inPeriod.filter((p) => p.budowa);
    if (nb.length) e.budowy = `${nb.length} (${nb.reduce((s, p) => s + p.ms, 0).toFixed(0)} ms)`;
  }
  return out;
}

async function runOnce(base, n) {
  const chrome = await startChrome({ width: 1920, height: 1080 });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 120000) => evaluate(cdp, e, t);
  const res = { przebieg: n, bledy: [] };
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
    await cdp.send('Page.navigate', { url: `${base}/index.html` });
    if (!await waitFor(cdp, '!!(window.__startRec && window.Core3D && window.Core3D.isInitialized)', 120000, 100)) throw new Error('gra nie wstała');
    res.renderer = await ev('(() => new Promise((ok) => { const f = () => { const r = window.Core3D.renderer; if (r) ok(r.isWebGPURenderer ? "webgpu" : "webgl"); else setTimeout(f, 50); }; f(); }))()');
    if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 180000, 50)) throw new Error('tło menu nie gotowe');
    if (!await waitFor(cdp, '!!window.__startRec.marks.ringZiemi', 180000, 50)) throw new Error('ring Ziemi bez map');
    // Menu na ekranie (intro, bezczynność) — potem „Start”.
    await sleep(menuMs);
    const click = await ev('(() => { const t = performance.now(); document.getElementById("btn-mode-single").click(); window.__startRec.marks.klik = +t.toFixed(1); return window.__startRec.n; })()');
    if (!await waitFor(cdp, `(window.__frameId | 0) >= ${gameFrames}`, 180000, 100)) throw new Error('gra nie ruszyła');
    const rec = await ev(`(() => { const R = window.__startRec; return { n: R.n, marks: R.marks, start: Array.from(R.start.subarray(0, R.n)), cpu: Array.from(R.cpu.subarray(0, R.n)), game: Array.from(R.game.subarray(0, R.n)), pipes: R.pipes }; })()`);
    res.chwile = rec.marks;
    if (Number.isFinite(rec.marks.graPierwszaKlatka) && Number.isFinite(rec.marks.klik)) {
      res.chwile.graOdKliku = +(rec.marks.graPierwszaKlatka - rec.marks.klik).toFixed(1);
    }
    // okna klatek: menu (pierwsza klatka tła → klik), gra (pierwsze `gameFrames` klatek gry)
    const firstMenu = rec.start.findIndex((t) => t >= (rec.marks.menuPierwszaKlatka ?? Infinity) - 20);
    const menuFrom = firstMenu >= 0 ? Math.max(0, firstMenu - 1) : 0;
    res.przedMenu = frameWindow(rec, 0, menuFrom);
    res.menu = frameWindow(rec, menuFrom, click);
    const g0 = rec.game.findIndex((g, i) => i >= click && g >= 1);
    if (g0 >= 0) {
      let g1 = g0;
      while (g1 < rec.n && rec.game[g1] < gameFrames) g1++;
      res.gra = frameWindow(rec, g0, g1);
      res.gra.pierwszaKlatkaMs = +(g0 + 1 < rec.n ? rec.start[g0 + 1] - rec.start[g0] : rec.cpu[g0]).toFixed(1);
      res.gra.pierwszaKlatkaCpu = +rec.cpu[g0].toFixed(1);
    }
    // od kliku do pierwszej klatki gry: tło menu jeszcze leci (najazd kamery pod ekranem ładowania)
    if (g0 > click) res.ladowanie = frameWindow(rec, click, g0);
    res.warmup = await ev('(() => { const w = window.Core3D && window.Core3D.warmup; return w && w.stats ? JSON.parse(JSON.stringify(w.stats)) : null; })()').catch(() => null);
    res.bledy = logs.errors().slice(0, 20);
  } catch (err) {
    res.blad = String(err?.message || err);
    res.bledy = logs.errors().slice(0, 20);
  } finally {
    await chrome.close();
  }
  return res;
}

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { mediana: +m.toFixed(1), min: +v[0].toFixed(1), maks: +v[v.length - 1].toFixed(1), n: v.length };
};

const { createServer } = await import('vite');
// Serwery gry: A (--root) i — z --root-b — B; przebiegi NA PRZEMIAN.
const rootB = args['root-b'] ? resolve(args['root-b']) : null;
const labelB = rootB ? (args['etykieta-b'] || rootB.split(/[\\/]/).filter(Boolean).pop()) : null;
async function serve(r, p) {
  const server = await createServer({ root: r, logLevel: 'error', server: { port: p, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  return { server, base: `http://localhost:${server.httpServer.address().port}` };
}
const sides = [{ label, root, runs: [] }];
if (rootB) sides.push({ label: labelB, root: rootB, runs: [] });
for (const [i, side] of sides.entries()) Object.assign(side, await serve(side.root, port + i));
function logRun(i, side, r) {
  const c = r.chwile || {};
  console.log(`przebieg ${i} (${side.label}, ${r.renderer || '?'}): ${r.blad ? 'BŁĄD ' + r.blad : ''}`
    + ` gpu ${c.gpuReady ?? '-'} | menu 1. klatka ${c.menuPierwszaKlatka ?? '-'} gotowe ${c.menuGotowe ?? '-'} | ring ${c.ringZiemi ?? '-'}`
    + ` | gra od kliku ${c.graOdKliku ?? '-'} ms, 1. klatka ${r.gra?.pierwszaKlatkaMs ?? '-'} ms (CPU ${r.gra?.pierwszaKlatkaCpu ?? '-'})`
    + ` | przestoje menu ${r.menu?.przestoje ?? '-'}/${r.menu?.klatki ?? '-'} (maks ${r.menu?.maksMs ?? '-'}), ładowanie ${r.ladowanie?.przestoje ?? '-'}/${r.ladowanie?.klatki ?? '-'} (maks ${r.ladowanie?.maksMs ?? '-'}), gra ${r.gra?.przestoje ?? '-'}/${r.gra?.klatki ?? '-'} (maks ${r.gra?.maksMs ?? '-'})`
    + ` | pipeline'y sync: przed menu ${r.przedMenu?.pipeline?.sync ?? '-'}, menu ${r.menu?.pipeline?.sync ?? '-'}, ładowanie ${r.ladowanie?.pipeline?.sync ?? '-'}, gra ${r.gra?.pipeline?.sync ?? '-'}`
    + ` | budowy w klatkach: menu ${r.menu?.pipeline?.budowy ?? '-'}, gra ${r.gra?.pipeline?.budowy ?? '-'} (${r.gra?.pipeline?.budowyMs ?? '-'} ms)`
    + (r.warmup?.flush ? ` | flush ${r.warmup.flush.ms} ms (kolejka ${r.warmup.flush.kolejkaMs}, CPU ${r.warmup.flush.cpuMs})` : '')
    + (r.bledy?.length ? ` | błędy: ${r.bledy.slice(0, 3).join(' ; ')}` : ''));
}
try {
  if (!args['bez-rozbiegu']) {
    for (const side of sides) {
      const warm = await runOnce(side.base, 0);
      console.log(`rozbieg (${side.label}): ${warm.blad || 'ok'} — nie wchodzi do median`);
    }
  }
  for (let i = 1; i <= repeats; i++) {
    for (const side of sides) {
      const r = await runOnce(side.base, i);
      side.runs.push(r);
      logRun(i, side, r);
    }
  }
} finally {
  for (const side of sides) await side.server.close();
}

mkdirSync(outDir, { recursive: true });
for (const side of sides) {
  const summary = summarize(side.runs);
  const file = join(outDir, `start-${side.label}.json`);
  writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), root: side.root, label: side.label, naprzemiennie: sides.length > 1, gameFrames, menuMs, mediany: summary, przebiegi: side.runs }, null, 2) + '\n');
  console.log(`mediany ${side.label} (min–maks):`);
  for (const [k, v] of Object.entries(summary)) if (v) console.log(`  ${k.padEnd(22)} ${v.mediana} (${v.min}–${v.maks}, n=${v.n})`);
  console.log('zapis:', file);
}
process.exit(0);

function summarize(runs) {
  const ok = runs.filter((r) => !r.blad);
  const pick = (f) => median(ok.map(f));
  const summary = {
    gpuReady: pick((r) => r.chwile?.gpuReady),
    menuPierwszaKlatka: pick((r) => r.chwile?.menuPierwszaKlatka),
    menuGotowe: pick((r) => r.chwile?.menuGotowe),
    ringZiemi: pick((r) => r.chwile?.ringZiemi),
    graOdKliku: pick((r) => r.chwile?.graOdKliku),
    graPierwszaKlatkaMs: pick((r) => r.gra?.pierwszaKlatkaMs),
    graPierwszaKlatkaCpu: pick((r) => r.gra?.pierwszaKlatkaCpu),
    menuPrzestoje: pick((r) => r.menu?.przestoje),
    menuMaksMs: pick((r) => r.menu?.maksMs),
    ladowaniePrzestoje: pick((r) => r.ladowanie?.przestoje),
    ladowanieMaksMs: pick((r) => r.ladowanie?.maksMs),
    graPrzestoje: pick((r) => r.gra?.przestoje),
    graMaksMs: pick((r) => r.gra?.maksMs),
    graSumaNadwyzekMs: pick((r) => r.gra?.sumaNadwyzekMs),
    // pipeline'y utworzone synchronicznie (zwykły render — przestój kompilacji); na tagu WebGL brak dziennika
    przedMenuPipelineSync: pick((r) => r.przedMenu?.pipeline?.sync),
    menuPipelineSync: pick((r) => r.menu?.pipeline?.sync),
    ladowaniePipelineSync: pick((r) => r.ladowanie?.pipeline?.sync),
    graPipelineSync: pick((r) => r.gra?.pipeline?.sync),
    // budowy NodeBuilder w klatkach (render na zimno)
    menuBudowy: pick((r) => r.menu?.pipeline?.budowy),
    graBudowy: pick((r) => r.gra?.pipeline?.budowy),
    graBudowyMs: pick((r) => r.gra?.pipeline?.budowyMs),
    // ekran ładowania (zadanie 25a): flush() rejestru rozgrzewki — od kliku do jego startu, czas, kolejka (CPU budów)
    flushOdKliku: pick((r) => (r.warmup?.flush && Number.isFinite(r.chwile?.klik) ? r.warmup.flush.t - r.chwile.klik : NaN)),
    flushMs: pick((r) => r.warmup?.flush?.ms),
    flushKolejkaMs: pick((r) => r.warmup?.flush?.kolejkaMs),
    flushCpuMs: pick((r) => r.warmup?.flush?.cpuMs),
    flushSiatki: pick((r) => r.warmup?.flush?.siatki)
  };
  return summary;
}
