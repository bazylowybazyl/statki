// LIMIT KLATEK w prawdziwej grze (Opcje → Grafika, src/render/frameLimiter.js, 2026-10-29): okna po kolei — limity
// z listy (GraphicsQuality.apply — bez zapisu) w menu (tło Ziemi z ringiem) i w grze swobodnej. Każde okno: klatki
// narysowane / s, wywołania rAF pętli / s, złożenia obrazu workera / s, tryb limitera (co N-ta klatka, akumulator,
// zegar), odstępy narysowanych klatek i złożeń w okresach rAF (równy takt = jeden kubełek), wiek obrazu, nvidia-smi
// (zajętość, moc, zegar karty).
//
//   node scripts/webgpu/limit-klatek-gra.mjs [--takt 1] [--bezVsync 0] [--okno 0] [--rozmiar 5120x1440]
//        [--limity off,240,120,60,off] [--menuLimity off,120,off] [--okres 6] [--tryb worker|off] [--out .tmp/limit-klatek]
//
// --takt 1 (domyślnie): headless BEZ flag --disable-frame-rate-limit / --disable-gpu-vsync — rAF w takcie monitora
// (na maszynie użytkownika 240 Hz), jak gra z VSync, bez okna na pulpicie: co N-ta klatka, złożenia co N vsynców, praca
// karty przy limicie wobec „bez limitu” (= częstotliwość monitora). --takt 0: headless bez taktu (rAF „back-to-back”,
// jak VSync wył.) — z --bezVsync 1 strona dostaje atrapę mostu Electrona z VSync wył. (window.hullfallApp), czyli limit
// czasem (tryb 'time', sen setTimeout) i złożenie bez stałego wieku. UWAGA: bez taktu i bez --bezVsync limiter kręci
// puste wywołania rAF (tysiące/s), a Chrome po ~15 s takiego kręcenia zwalnia rAF do ~30 ms — wyniki bez znaczenia.
// --okno 1: widoczne okno z vsync na cały ekran (zasłania pulpit — nie przy pracującym użytkowniku). Pomiar przy wolnej
// maszynie (stan nvidia-smi w raporcie); przebieg ~2 min.
// --bitwa F,D,B,S (np. 50,20,10,3): okna gry w bitwie flot (jak scripts/profil-bitwy-flot.mjs: pusta przestrzeń między
// Wenus a Ziemią, piraci przed dziobem, Terra Nova za graczem, gracz nieśmiertelny, --zoom 0.45) — intensywność bitwy
// zmienia się w czasie, więc limity na przemian (np. --limity off,120,off,120).
// Strażnik ciszy (--cisza 30, --ciszaMaks 900): start dopiero, gdy przez 30 s nie działa żaden inny harness
// (`node scripts/….mjs`, Chrome / Electron z --remote-debugging-port); cudzy harness w trakcie — okno oznaczone `obce`.
// --budziki worker,sen,kolejka,worker:0 (z --takt 0 --bezVsync 1): każde okno gry dla każdej strategii budzika bez VSync
// (src/render/frameWake.js — FrameLimiter.wake.setStrategy; „:ms” — końcówka czekania pętlą wątku / kolejką, „+bariera”
// — strażnik dwustopniowy z pierwszym stopniem w chwili należnej, tune.workerFence; strojenie FrameLimiter.wake.tune)
// — A/B w jednym przebiegu: kl/s, odstępy klatek [ms] (p1 / p50 / p90 / p99 / maks., udział i liczba > interwał + 2 ms),
// CPU wątku strony i procesu renderera (CDP Performance.getMetrics: ThreadTime, ProcessTime, TaskDuration — % rdzenia),
// zadania kolejki i dopięcia na klatkę, pętla wątku budzika [ms / klatkę], spóźnienia budzeń (z 64 ostatnich; w całym
// oknie: maks. i liczba > 2 ms) i najdłuższa klatka strony — długi odstęp od spóźnionego budzenia albo od długiej klatki.
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';
import { startNvidiaSmi, stanMaszyny } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const OKNO = args.okno === '1';
const TAKT = args.takt !== '0';
const BEZ_VSYNC = args.bezVsync === '1';
const LIMITY = String(args.limity || 'off,240,120,60,off').split(',').filter(Boolean);
const MENU_LIMITY = String(args.menuLimity ?? 'off,120,off').split(',').filter((v) => v && v !== 'brak');   // brak — bez okien menu
const OKRES = Number(args.okres || 6);
const TRYB = args.tryb === 'off' ? 'off' : 'worker';
const BITWA = args.bitwa ? String(args.bitwa).split(',').map((v) => Math.max(0, Number(v) || 0)) : null;
const BUDZIKI = args.budziki ? String(args.budziki).split(',').filter(Boolean) : [null];
const ZOOM = Number(args.zoom || 0.45);
const out = resolve(repo, args.out || '.tmp/limit-klatek');
mkdirSync(out, { recursive: true });

const CISZA = Number(args.cisza ?? 30);
const CISZA_MAKS = Number(args.ciszaMaks ?? 900);
// cudze harnessy: node ze skryptem scripts/….mjs i przeglądarki z portem debugowania — poza tym procesem i jego
// potomkami (nasz Chrome i jego renderery)
function obceProcesy() {
  const cmd = `Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='chrome.exe' OR Name='electron.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }`;
  return new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { maxBuffer: 64 << 20, windowsHide: true, timeout: 30000 }, (err, stdout) => {
    const all = [];
    const parent = new Map();
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const p = line.split('|');
      if (p.length < 4) continue;
      const pid = Number(p[0]), ppid = Number(p[1]);
      parent.set(pid, ppid);
      all.push({ pid, name: p[2].toLowerCase(), c: p.slice(3).join('|') });
    }
    const mine = (pid) => { for (let i = 0; i < 4 && pid; i++) { if (pid === process.pid) return true; pid = parent.get(pid); } return false; };
    const rows = [];
    for (const { pid, name, c } of all) {
      if (!c || mine(pid)) continue;
      if (name === 'node.exe' ? /scripts[\\/][^"'\s]*\.mjs/i.test(c) : /--remote-debugging-port=\d+/.test(c)) rows.push({ pid, cmd: c.slice(0, 160) });
    }
    ok(rows);
  }));
}
async function czekajNaCisze() {
  if (!(CISZA > 0)) return { pominieta: true };
  const t0 = Date.now();
  let quietFrom = Date.now();
  for (;;) {
    const obce = await obceProcesy();
    if (obce.length) {
      console.log(`cisza: zajęte (${obce.length}) — ${obce.slice(0, 2).map((o) => o.cmd.slice(0, 100)).join(' | ')}`);
      if (Date.now() - t0 > CISZA_MAKS * 1000) return { czekano_s: Math.round((Date.now() - t0) / 1000), zajete: true, obce: obce.slice(0, 4) };
      await sleep(20000);
      quietFrom = Date.now();
      continue;
    }
    if (Date.now() - quietFrom >= CISZA * 1000) return { czekano_s: Math.round((Date.now() - t0) / 1000), zajete: false };
    await sleep(5000);
  }
}
const report = { args, rozmiar: [W, H], okno: OKNO, takt: OKNO || TAKT, bezVsync: BEZ_VSYNC, tryb: TRYB, menu: [], gra: [], bledy: [] };
report.cisza = await czekajNaCisze();
console.log('cisza:', JSON.stringify(report.cisza));
if (report.cisza.zajete) { console.error('maszyna zajęta przez inne pomiary — koniec bez pomiaru'); process.exit(3); }
report.maszynaStart = await stanMaszyny();
console.log('maszyna:', JSON.stringify(report.maszynaStart));
const smi = startNvidiaSmi(250);
// Strażnik wolnej karty (2026-10-29: przebieg wystartował przy 99% zajętości i 9,7 GB VRAM od innego programu — wynik
// bez znaczenia): mediana 3 s przed startem > 25% — koniec bez pomiaru (--mimoZajetosci 1 — mimo to).
await sleep(3000);
const przed = smi.okno(Date.now() - 3000);
report.gpuPrzed = przed;
if (przed && przed.zajetosc > 25 && args.mimoZajetosci !== '1') {
  console.error(`GPU zajęte przed pomiarem (${przed.zajetosc}%, ${przed.pamiecMB} MB) — koniec bez pomiaru`);
  smi.stop();
  process.exit(3);
}
const { server, base } = await startVite(Number(args.port || 5395));
// headless z taktem: startChrome bez flag headless (headless: false) i '--headless=new' dołożone — rAF w takcie monitora
const chrome = await startChrome({ width: W, height: H, renderMode: TRYB, headless: OKNO || TAKT ? false : undefined,
  extraArgs: OKNO ? ['--window-position=0,0', '--start-fullscreen'] : TAKT ? ['--headless=new'] : [] });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
let done = false;
async function finish(code = 0) {
  if (done) return;
  done = true;
  clearTimeout(watchdog);
  report.bledy = chrome.logs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 40);
  report.maszynaKoniec = await stanMaszyny();
  writeJson(join(out, 'raport.json'), report);
  smi.stop();
  try { await chrome.close(); } catch (_) { /* już zamknięty */ }
  try { await server.close(); } catch (_) { /* */ }
  console.log(`raport: ${join(out, 'raport.json')}`);
  process.exit(code);
}
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 8 min — koniec'); finish(2); }, 8 * 60 * 1000);

// rAF opakowany: znacznik bieżącej klatki (złożenia obrazu workera dostają znacznik rAF swojej klatki)
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((ts) => { window.__lkTs = ts; cb(ts); });
})();` });
// CPU wątku strony i procesu renderera (ThreadTime / ProcessTime — czas CPU, TaskDuration — czas zadań wątku strony; s)
await cdp.send('Performance.enable');
const cpuMetrics = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = {};
  for (const { name, value } of metrics) if (/^(ThreadTime|ProcessTime|TaskDuration|ScriptDuration|Timestamp)$/.test(name)) m[name] = value;
  return m;
};
// --bezVsync 1: atrapa mostu Electrona (electron/preload.js) z VSync wył. tego uruchomienia
if (BEZ_VSYNC) {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.hullfallApp = { vsync: false, vsyncSaved: false,
    portable: false, setVsync: async () => false, relaunch: async () => false };` });
}

const COMPOSE_INSTALL = `(() => {
  const H = window.RenderWorkerHost;
  if (window.__lkC) return true;
  if (!H || !H.ring) return false;
  const C = window.__lkC = { ts: new Float64Array(65536), n: 0 };
  const c0 = H.ring.compose;
  H.ring.compose = function (k) { C.ts[C.n & 65535] = window.__lkTs; C.n++; return c0.call(this, k); };
  return true;
})()`;
// Klatki narysowane (znacznik decyzji limitera) — odstępy w ms (tryb 'time': bez siatki vsync)
const DRAWN_INSTALL = `(() => {
  const L = window.FrameLimiter;
  if (!L || window.__lkD) return !!L;
  const D = window.__lkD = { ts: new Float64Array(65536), n: 0 };
  const tick0 = L.tick;
  L.tick = function (now) { const d = tick0.call(this, now); if (d) { D.ts[D.n & 65535] = now; D.n++; } return d; };
  return true;
})()`;
const STATE = `(() => {
  const L = window.FrameLimiter, H = window.RenderWorkerHost, C = window.__lkC, B = window.__menuBackdrop, D = window.__lkD;
  if (H && typeof H.readStats === 'function') H.readStats();
  const w = L && L.wake;
  return { t: performance.now(), f: window.__frameId | 0, ticks: L ? L.stats.ticks : 0, drawn: L ? L.stats.drawn : 0,
    hist: L ? [...L.stats.hist] : [], mode: L ? L.mode : '', every: L ? L.every : 0, hz: L ? +L.hz.toFixed(2) : 0,
    opis: L ? L.describe() : '', composed: H ? H.composed : -1, age: H && H.pacer ? H.pacer.age : -1, cn: C ? C.n : 0,
    dn: D ? D.n : 0, menuFrames: B && B.stats ? B.stats.frames : -1,
    wake: w ? { strategy: w.strategy, marginMs: +w.marginMs.toFixed(2), sleeps: w.sleeps, hops: w.hops, spins: w.spins,
      wakes: w.wakes, workerMsgs: w.workerMsgs, workerBusyMs: w.workerBusyMs, watchdogs: w.watchdogs, workerError: w.workerError,
      lateMax: w.lateMax, lateOver: w.lateOver, frameMax: w.frameMax, ready: w.workerReady, fence: !!(w.tune && w.tune.workerFence),
      late: Array.from(w.late.subarray(0, Math.min(w.late.length, w.lateN))).sort((x, y) => x - y) } : null,
    gpu: H ? +(H.stats[0] || 0).toFixed(2) : null, gpuC: H ? +(H.stats[1] || 0).toFixed(2) : null };
})()`;
const drawnTs = (from, to) => ev(`(() => { const D = window.__lkD; if (!D) return []; const o = [];
  for (let i = Math.max(${from}, D.n - 65535); i < ${to}; i++) o.push(D.ts[i & 65535]); return o; })()`);
function gapStats(ts, fps) {
  const g = [];
  for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; if (d > 0 && d < 200) g.push(d); }
  if (!g.length) return null;
  g.sort((x, y) => x - y);
  const q = (p) => +g[Math.min(g.length - 1, Math.floor(p * (g.length - 1)))].toFixed(2);
  const I = fps > 0 ? 1000 / fps : 0;
  return { p1: q(0.01), p50: q(0.5), p90: q(0.9), p99: q(0.99), maks: +g[g.length - 1].toFixed(2),
    ...(I ? { ponadI2: +(g.filter((d) => d > I + 2).length / g.length).toFixed(4), ponadI2N: g.filter((d) => d > I + 2).length } : {}) };
}
const composeTs = (from, to) => ev(`(() => { const C = window.__lkC; if (!C) return []; const o = [];
  for (let i = Math.max(${from}, C.n - 65535); i < ${to}; i++) o.push(C.ts[i & 65535]); return o; })()`);

// odstępy w okresach rAF (zaokrąglone) → { okresów: liczba }
function histVsync(ts, hz) {
  const P = hz > 0 ? 1000 / hz : 0, h = {};
  if (!P) return h;
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (!(d > 0) || d > 200) continue;
    const k = Math.round(d / P);
    h[k] = (h[k] || 0) + 1;
  }
  return h;
}
const diffHist = (a, b) => { const o = {}; for (let i = 0; i < b.length; i++) { const d = b[i] - (a[i] || 0); if (d > 0) o[i] = d; } return o; };

// Bitwa flot jak scripts/profil-bitwy-flot.mjs: pusta przestrzeń (orbita między Wenus a Ziemią, kąt najdalej od ciał
// i stacji), gracz nieśmiertelny, piraci przed dziobem, Terra Nova za graczem.
function battleExpr([NF = 0, ND = 0, NB = 0, NS = 0]) {
  return `(() => {
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
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
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
  })()`;
}

async function measure(limit, kind, budzik = null) {
  // budzik: 'nazwa', 'nazwa:ms' — końcówka czekania pętlą wątku ('worker') / kolejką ('sen'), '+bariera' — strażnik
  // dwustopniowy (tune.workerFence); strojenie domyślne przywracane przed każdym oknem
  const [bzSpec, ...bzFlags] = String(budzik || '').split('+');
  const [bzName, bzSpin] = bzSpec.split(':');
  await ev(`(() => { GraphicsQuality.apply({ frameLimit: '${limit}' });
    const w = FrameLimiter.wake; if (w && w.tune) { window.__lkTune0 = window.__lkTune0 || { ...w.tune }; Object.assign(w.tune, window.__lkTune0); }
    ${bzName ? `w.setStrategy('${bzName}');` : ''}
    ${bzSpin !== undefined && bzSpin !== '' ? `w.tune[w.strategy === 'worker' ? 'workerSpinMs' : 'senSpinMs'] = ${Number(bzSpin)};` : ''}
    ${bzFlags.includes('bariera') ? 'w.tune.workerFence = true;' : ''}
    return true; })()`);
  await sleep(2000);
  await ev(`(() => { const w = FrameLimiter.wake; if (w) { w.lateMax = 0; w.frameMax = 0; } return true; })()`);
  const a = await ev(STATE);
  const ca = await cpuMetrics();
  const t0 = Date.now();
  await sleep(OKRES * 1000);
  const b = await ev(STATE);
  const cb = await cpuMetrics();
  const t1 = Date.now();
  const s = (b.t - a.t) / 1000;
  const g = smi.okno(t0, t1);
  const obce = await obceProcesy();
  const row = {
    limit, kind, ...(budzik ? { budzik } : {}), s: +s.toFixed(2), ...(obce.length ? { obce: obce.length } : {}),
    gpuZajetosc: g ? g.zajetosc : null, gpuMocW: g ? g.mocW : null, gpuZegarMHz: g ? g.zegarMHz : null,
    tryb: b.mode, coN: b.every, hz: b.hz, opis: b.opis
  };
  // CPU [% rdzenia]: wątek strony (czas CPU, czas zadań), cały proces renderera (wątek strony, worker renderu, budzik)
  const cs = cb.Timestamp > ca.Timestamp ? cb.Timestamp - ca.Timestamp : s;
  const pc = (k) => (Number.isFinite(cb[k]) && Number.isFinite(ca[k]) ? +((cb[k] - ca[k]) / cs * 100).toFixed(1) : null);
  row.cpu = { watekStronyPct: pc('ThreadTime'), zadaniaStronyPct: pc('TaskDuration'), skryptStronyPct: pc('ScriptDuration'), procesPct: pc('ProcessTime') };
  if (kind === 'gra') {
    const cts = await composeTs(a.cn, b.cn);
    Object.assign(row, {
      klatekS: +((b.f - a.f) / s).toFixed(1), rafS: +((b.ticks - a.ticks) / s).toFixed(1),
      zlozenS: b.composed >= 0 ? +((b.composed - a.composed) / s).toFixed(1) : null,
      odstepyKlatek: diffHist(a.hist, b.hist), odstepyZlozen: histVsync(cts, b.hz), wiek: b.age,
      odstepyMs: gapStats(await drawnTs(a.dn, b.dn), Number(limit) || 0),
      gpuMsWorkera: b.gpu, gpuComputeMsWorkera: b.gpuC
    });
    // budzik bez VSync (tryb 'time'): strategia, spóźnienia budzeń względem chwili należnej (p50 / p90 / maks. z 64
    // ostatnich), sny setTimeout strony / s, zadania kolejki MessageChannel / s i dopięcia na klatkę, pętla wątku budzika
    if (b.mode === 'time' && b.wake && a.wake) {
      const l = b.wake.late, q = (p) => (l.length ? +l[Math.min(l.length - 1, Math.floor(p * (l.length - 1)))].toFixed(2) : null);
      const dw = (k) => b.wake[k] - a.wake[k];
      const frames = b.drawn - a.drawn;
      row.budzikStat = { strategia: b.wake.strategy, marginesMs: b.wake.marginMs, spoznienieMs: [q(0.5), q(0.9), q(1)],
        snyS: +(dw('sleeps') / s).toFixed(1), kolejkaS: Math.round((dw('hops') + dw('spins')) / s),
        dopieciaNaKlatke: frames > 0 ? +(dw('spins') / frames).toFixed(1) : null, budzeniaS: +(dw('wakes') / s).toFixed(1),
        watekMsNaKlatke: dw('wakes') > 0 ? +(dw('workerBusyMs') / dw('wakes')).toFixed(2) : 0,
        spoznioneOkno: dw('lateOver'), spoznienieMaksMs: +b.wake.lateMax.toFixed(2), klatkaMaksMs: +b.wake.frameMax.toFixed(2),
        ...(b.wake.fence ? { bariera: true } : {}), ...(b.wake.strategy === 'worker' && !b.wake.ready ? { niegotowy: true } : {}),
        ...(dw('watchdogs') ? { straznik: dw('watchdogs') } : {}), ...(b.wake.workerError ? { blad: b.wake.workerError } : {}) };
    }
  } else {
    row.klatekTlaS = b.menuFrames >= 0 ? +((b.menuFrames - a.menuFrames) / s).toFixed(1) : null;
  }
  console.log(JSON.stringify(row));
  return row;
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderWorker=${TRYB === 'worker' ? 1 : 0}` });
  if (!await waitFor(cdp, '!!(window.GraphicsQuality && window.FrameLimiter && window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 400)) throw new Error('menu nie wstało');
  await sleep(3000);
  for (const l of MENU_LIMITY) report.menu.push(await measure(l, 'menu'));
  await ev(`(() => { GraphicsQuality.apply({ frameLimit: 'off' }); document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 60", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(4000);
  if (BITWA) report.bitwa = await ev(battleExpr(BITWA));
  if (BITWA) { console.log('bitwa:', JSON.stringify(report.bitwa)); await sleep(6000); }
  if (TRYB === 'worker' && !await ev(COMPOSE_INSTALL)) throw new Error('brak RenderWorkerHost.ring');
  if (!await ev(DRAWN_INSTALL)) throw new Error('brak FrameLimiter');
  for (const l of LIMITY) for (const bz of (l === 'off' ? [null] : BUDZIKI)) report.gra.push(await measure(l, 'gra', bz));
  await ev(`(() => { GraphicsQuality.apply({ frameLimit: 'off' }); return true; })()`);
  report.koniec = await ev(STATE);
} catch (err) {
  report.blad = String(err && err.stack || err);
  console.error(err);
  await finish(1);
}
await finish(0);
