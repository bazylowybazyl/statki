// Czasy startu gry w PRAWDZIWYM czasie (port WebGPU, zadanie 11 — rozgrzewka pipeline'ów): gotowość tła menu,
// ring Ziemi, pierwsza klatka gry po „Start” i przestoje (klatki > 50 ms) w menu i w pierwszych klatkach gry.
// Bez zegara wirtualnego harnessu (gra biegnie jak u gracza): do strony trafia tylko rejestrator klatek
// (rAF: start klatki, CPU wywołań, __frameId gry) i chwile startu (sprawdzane co ~5 ms). Świeży profil Chrome
// na przebieg = zimna pamięć shaderów (pierwsze uruchomienie gry). Pierwszy przebieg na serwerze („rozbieg”:
// Vite przerabia moduły) nie wchodzi do median.
//
//   node scripts/webgpu/start-gry.mjs [--root <repo gry, np. worktree tagu webgl-baseline>] [--powtorz 3]
//        [--port 5358] [--out katalog] [--klatki 300] [--menu-ms 2000] [--etykieta nazwa] [--bez-rozbiegu]
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
  const R = { start: new Float64Array(N), cpu: new Float32Array(N), game: new Int32Array(N), n: 0, marks: {} };
  let curTs = -1; let idx = 0;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const t0 = now();
    if (ts !== curTs) { curTs = ts; idx = R.n < N ? R.n++ : N - 1; R.start[idx] = t0; R.cpu[idx] = 0; }
    try { cb(ts); } finally { R.cpu[idx] += now() - t0; R.game[idx] = window.__frameId | 0; }
  });
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
    const rec = await ev(`(() => { const R = window.__startRec; return { n: R.n, marks: R.marks, start: Array.from(R.start.subarray(0, R.n)), cpu: Array.from(R.cpu.subarray(0, R.n)), game: Array.from(R.game.subarray(0, R.n)) }; })()`);
    res.chwile = rec.marks;
    if (Number.isFinite(rec.marks.graPierwszaKlatka) && Number.isFinite(rec.marks.klik)) {
      res.chwile.graOdKliku = +(rec.marks.graPierwszaKlatka - rec.marks.klik).toFixed(1);
    }
    // okna klatek: menu (pierwsza klatka tła → klik), gra (pierwsze `gameFrames` klatek gry)
    const firstMenu = rec.start.findIndex((t) => t >= (rec.marks.menuPierwszaKlatka ?? Infinity) - 20);
    const menuFrom = firstMenu >= 0 ? Math.max(0, firstMenu - 1) : 0;
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
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const runs = [];
try {
  if (!args['bez-rozbiegu']) {
    const warm = await runOnce(base, 0);
    console.log(`rozbieg (${label}): ${warm.blad || 'ok'} — nie wchodzi do median`);
  }
  for (let i = 1; i <= repeats; i++) {
    const r = await runOnce(base, i);
    runs.push(r);
    const c = r.chwile || {};
    console.log(`przebieg ${i} (${label}, ${r.renderer || '?'}): ${r.blad ? 'BŁĄD ' + r.blad : ''}`
      + ` gpu ${c.gpuReady ?? '-'} | menu 1. klatka ${c.menuPierwszaKlatka ?? '-'} gotowe ${c.menuGotowe ?? '-'} | ring ${c.ringZiemi ?? '-'}`
      + ` | gra od kliku ${c.graOdKliku ?? '-'} ms, 1. klatka ${r.gra?.pierwszaKlatkaMs ?? '-'} ms (CPU ${r.gra?.pierwszaKlatkaCpu ?? '-'})`
      + ` | przestoje menu ${r.menu?.przestoje ?? '-'}/${r.menu?.klatki ?? '-'} (maks ${r.menu?.maksMs ?? '-'}), ładowanie ${r.ladowanie?.przestoje ?? '-'}/${r.ladowanie?.klatki ?? '-'} (maks ${r.ladowanie?.maksMs ?? '-'}), gra ${r.gra?.przestoje ?? '-'}/${r.gra?.klatki ?? '-'} (maks ${r.gra?.maksMs ?? '-'})`
      + (r.bledy?.length ? ` | błędy: ${r.bledy.slice(0, 3).join(' ; ')}` : ''));
  }
} finally {
  await server.close();
}

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
  graSumaNadwyzekMs: pick((r) => r.gra?.sumaNadwyzekMs)
};
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `start-${label}.json`);
writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), root, label, gameFrames, menuMs, mediany: summary, przebiegi: runs }, null, 2) + '\n');
console.log('mediany (min–maks):');
for (const [k, v] of Object.entries(summary)) if (v) console.log(`  ${k.padEnd(22)} ${v.mediana} (${v.min}–${v.maks}, n=${v.n})`);
console.log('zapis:', file);
process.exit(0);
