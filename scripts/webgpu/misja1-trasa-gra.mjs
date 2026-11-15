// TRASA MISJI 1: WYDAJNOŚĆ OD HALI K-7 DO BAZY PIRATÓW (2026-11-15). Zgłoszenie użytkownika (PerfHUD przy 5120 × 1440,
// tryb worker): „start gry w hali K-7 — 120 kl/s i duża kolejka; po wyleceniu z hali gra laguje, jakby coś wczytywała,
// po chwili drugi freeze; po wylocie boost; po przylocie do bazy piratów 50–120 kl/s, było 200 — doszły zasięgi radaru
// i silnik fizyki 3D”. Narzędzie gra kampanię jak gracz (samouczek włączony) i mierzy każdy z tych odcinków.
//
//   node scripts/webgpu/misja1-trasa-gra.mjs [--etap hala|baza|oba] [--rozmiar 5120x1440] [--out .tmp/misja1-trasa]
//        [--query grafika=ultra] [--profil 1] [--ab 1] [--faza shipyard] [--zoomy 0.04,0.14] [--poWylocie 16] [--takt 1]
//
// Etap „hala”: start kampanii od intro w doku K-7 (odprawa pominięta), okna sondy GPU workera (sondaGpuWorkera.mjs):
//   w doku (`dok`), po ODDOKOWANIU (`sterowanie` — kadr samouczka STEROWANIE ze zgłoszenia), potem W trzymane (wylot
//   przez bramę G-01) — okna po 1 s do --poWylocie s po wylocie (faza `course`: misja tworzy bazę piratów —
//   StoryGame._spawnSite). W każdym oknie: klatki strony (rAF: okres, CPU wywołań, przestoje > 50 ms), klatki workera
//   (przerwy między renderami z pipeline'ami sync, nowymi zasobami i wysyłkami tej klatki), GPU wg etykiet, kolejka GPU;
//   czasy _spawnSite / spawnPirateBase / spawnShip; long tasks strony; stan wokseli w workerze.
//   --profil 1: profile CPU strony i workera przez cały wylot — najdłuższe ciągi pracy (> 40 ms) i ich funkcje.
//   --ab 1: w doku, w PAUZIE (worker rysuje dalej) — każdy korzeń sceny workera z widocznymi siatkami po kolei zdjęty
//   ze sceny (Δ GPU render) i każdy krok Core3D.fx wyjęty z listy (Δ compute); okna bazowe przeplatane co 5 wariantów.
// Etap „baza”: skok dev ?story=<faza> (domyślnie shipyard), Atlas 3,5 km od habitatu, mgła wojny wyłączona, kamera
//   statku przy zoomach --zoomy (zgłoszenie: ZOOM X0.04); okna sondy; --ab 1 — jak w hali + czujniki wył. (strona:
//   Czujka.input.off) i siatki wokseli (Wok*) zdjęte.
// Tryb gracza: render w workerze, headless w takcie monitora (--takt 1, jak gracz z VSync; --takt 0 — bez limitu klatek,
// kl/s to przepustowość). Raport: <out>/raport.json (zapisywany po każdym oknie), profile <out>/*.cpuprofile, zrzuty PNG.
// Pomiar tylko przy wolnej maszynie: gra użytkownika na starcie albo w trakcie (sprawdzana co 15 s) — koniec przebiegu;
// cudze harnessy — w raporcie `obce`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { sondaInstaluj, sondaOkno, SONDA_CZYTAJ, SONDA_GPU_OKNA, startNvidiaSmi, stanMaszyny, gryUzytkownika, obceProcesy } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/misja1-trasa');
mkdirSync(out, { recursive: true });
const ETAP = String(args.etap || 'oba');
const QUERY = args.query === undefined ? 'grafika=ultra' : String(args.query);
const PROFIL = String(args.profil ?? '1') === '1';
const AB = String(args.ab ?? '1') === '1';
const FAZA = String(args.faza || 'shipyard');
const ZOOMY = String(args.zoomy || '0.04,0.14').split(',').map(Number).filter((z) => z > 0);
const PO_WYLOCIE = Number(args.poWylocie || 16);
const tStart = Date.now();
const sek = () => +((Date.now() - tStart) / 1000).toFixed(1);

const powershell = (cmd) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
  { maxBuffer: 16 << 20, windowsHide: true, timeout: 30000 }, (err, stdout) => ok(String(stdout || ''))));
// zajętość silnika 3D karty wg procesów (inne programy u gracza zabierają kartę grze)
const gpuProcesy = async () => {
  const s = await powershell(`(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -MaxSamples 1).CounterSamples | Where-Object { $_.CookedValue -gt 1 } | ForEach-Object { $p = if ($_.InstanceName -match 'pid_(\\d+)') { [int]$Matches[1] } else { 0 }; "$((Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName)|$p|$([math]::Round($_.CookedValue,1))" }`);
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [n, pid, u] = l.split('|'); return { proces: n, pid: Number(pid), proc3D: Number(u) }; });
};

const report = { args, rozmiar: [W, H], query: QUERY, maszynaStart: await stanMaszyny(), gpuProcesyStart: await gpuProcesy(),
  etapy: {}, wkLogi: [], strLogi: [], obce: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.maszynaStart), 'karta 3D wg procesów:', JSON.stringify(report.gpuProcesyStart));
// sam launcher (JagexLauncher, klient Riot) nie gra — liczy się proces gry (rs2client, League of Legends…)
const graTeraz = async () => (await gryUzytkownika()).filter((n) => !/^JagexLauncher$|^Riot/i.test(n));
report.gry = await graTeraz();
if (report.gry.length && args.mimoGry !== '1') {
  console.error('GRA UŻYTKOWNIKA DZIAŁA:', report.gry.join(', '), '— pomiar pominięty (--mimoGry 1 wymusza)');
  writeJson(join(out, 'raport.json'), { ...report, pominiety: 'gra użytkownika' });
  process.exit(3);
}
const noteObce = async (kiedy) => {
  const o = await obceProcesy().catch(() => []);
  report.obce.push({ kiedy, s: sek(), n: o.length, procesy: o.slice(0, 4) });
  if (o.length) console.log(`OBCE HARNESSY (${kiedy}): ${o.length} — ${o.slice(0, 2).map((x) => x.cmd.slice(0, 100)).join(' | ')}`);
};
await noteObce('start');

const smi = startNvidiaSmi(500);
const { server, base } = await startVite(Number(args.port || 5461));
// --takt 1 (domyślnie): headless w takcie monitora (jak gracz z VSync) — bez limitu klatek strona szła ~930 kl/s, a kolejka
// GPU workera rosła do ~0,8 s (sztuczna zaległość, której u gracza nie ma); --takt 0 — przepustowość bez sufitu
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker', takt: String(args.takt ?? '1') !== '0' });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 30 min — koniec'); finish(2); }, 30 * 60 * 1000);
// Strażnik w trakcie (2026-11-15: użytkownik uruchomił RuneScape w środku przebiegu): gra użytkownika = koniec pomiaru
// z raportem częściowym — headless Chrome zajmuje kartę w ~70–100% i gra by przycinała.
const strazGry = setInterval(async () => {
  if (args.mimoGry === '1') return;
  const g = await graTeraz().catch(() => []);
  if (!g.length) return;
  console.error(`[${sek()}] GRA UŻYTKOWNIKA URUCHOMIONA W TRAKCIE: ${g.join(', ')} — koniec pomiaru (raport częściowy)`);
  report.przerwany = { s: sek(), gry: g };
  clearInterval(strazGry);
  finish(4);
}, 15000);

// --- sesja workera renderu (Target.setAutoAttach, flatten; nowa strona = nowy worker) ---
const wk = { sid: null, id: 8000000 };
const wkSend = (method, params = {}, timeoutMs = 60000) => new Promise((ok, reject) => {
  if (!wk.sid) { reject(new Error('brak sesji workera')); return; }
  const id = ++wk.id;
  const timer = setTimeout(() => { cdp.pending.delete(id); reject(new Error(`limit ${method}`)); }, timeoutMs);
  cdp.pending.set(id, { ok: (r) => { clearTimeout(timer); ok(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId: wk.sid }));
});
const wkEval = async (expression, timeoutMs = 60000) => {
  const r = await wkSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const ti = msg.params?.targetInfo;
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) { wk.sid = msg.params.sessionId; wkSend('Runtime.enable').catch(() => {}); }
    return;
  }
  if (msg.method === 'Target.detachedFromTarget' && msg.params?.sessionId === wk.sid) { wk.sid = null; return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500);
    const row = { s: sek(), type: msg.params.type, text };
    if (msg.sessionId && msg.sessionId === wk.sid) { if (report.wkLogi.length < 4000) report.wkLogi.push(row); }
    else if (!msg.sessionId && report.strLogi.length < 4000) report.strLogi.push(row);
  }
  if (msg.method === 'Runtime.exceptionThrown' && report.bledy.length < 200) {
    report.bledy.push({ s: sek(), w: msg.sessionId === wk.sid ? 'worker' : 'strona', text: String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || '').slice(0, 600) });
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Runtime.enable');

// --- strona: dziennik klatek rAF (znacznik klatki, start i CPU każdego wywołania) i long tasks — bez zmiany gry ---
const PF_INJECT = `(() => {
  const N = 1 << 16;
  const L = window.__pf = { ts: new Float64Array(N), t0: new Float64Array(N), cpu: new Float32Array(N), n: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { const a = performance.now(); try { cb(ts); } finally { const i = L.n++ & (N - 1); L.ts[i] = ts; L.t0[i] = a; L.cpu[i] = performance.now() - a; } });
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__lt.length < 5000) window.__lt.push({ t: +e.startTime.toFixed(1), ms: +e.duration.toFixed(1) }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
})();`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); } catch (e) {}\n${PF_INJECT}` });

const PF_CZYTAJ = (od) => `(() => {
  const L = window.__pf; if (!L) return null;
  const N = L.ts.length, end = L.n, beg = Math.max(${od}, end - N + 1);
  const fr = [];
  for (let k = beg; k < end; k++) {
    const i = k & (N - 1), last = fr[fr.length - 1];
    if (last && last.ts === L.ts[i]) { last.cpu += L.cpu[i]; last.w++; } else fr.push({ ts: L.ts[i], t0: L.t0[i], cpu: L.cpu[i], w: 1 });
  }
  const per = [];
  for (let j = 0; j + 1 < fr.length; j++) per.push(fr[j + 1].ts - fr[j].ts);
  const s = [...per].sort((a, b) => a - b), c = fr.map((f) => f.cpu).sort((a, b) => a - b);
  const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : 0;
  const st = [];
  for (let j = 0; j < per.length; j++) if (per[j] > 50) st.push({ t: +fr[j].t0.toFixed(0), okres: +per[j].toFixed(0), cpu: +fr[j].cpu.toFixed(0) });
  st.sort((a, b) => b.okres - a.okres);
  return { n: end, klatki: fr.length, okres: { p50: q(s, 0.5), p95: q(s, 0.95), maks: s.length ? +s[s.length - 1].toFixed(1) : 0 },
    cpu: { p50: q(c, 0.5), p95: q(c, 0.95), maks: c.length ? +c[c.length - 1].toFixed(1) : 0 }, przestojeN: st.length, przestoje: st.slice(0, 6) };
})()`;

const STAN = `(() => {
  const S = window.StoryGame, s = window.ship, H = window.RenderWorkerHost;
  if (H && typeof H.readStats === 'function') H.readStats();
  return { faza: S?.phase || null, x: Math.round(s?.pos?.x || 0), y: Math.round(s?.pos?.y || 0), v: Math.round(Math.hypot(s?.vel?.x || 0, s?.vel?.y || 0)),
    zlozenia: H ? H.composed | 0 : -1, klatka: window.__frameId | 0, teraz: +performance.now().toFixed(1),
    hud: H ? { gpuR: +(H.stats[0] || 0).toFixed(2), gpuC: +(H.stats[1] || 0).toFixed(2), cpu: +(H.stats[6] || 0).toFixed(2), kolejka: +(H.stats[20] || 0).toFixed(1), wiek: H.pacer ? H.pacer.age : null } : null,
    npc: (window.npcs || []).length, baza: !!S?.site?.station, lock: !!S?.lock };
})()`;
const ZDARZENIA_STRONY = `(() => ({ spawn: (window.__spawnLog || []).splice(0), lt: (window.__lt || []).splice(0) }))()`;
// czasy tworzenia bazy na stronie (synchroniczne — cały czas to przestój klatki)
const SPAWN_TIMERS = `(() => {
  const S = window.StoryGame, d = S && S.deps;
  if (!S || !d) return 'brak StoryGame';
  const L = window.__spawnLog = window.__spawnLog || [];
  const wrap = (obj, k, label) => { const f = obj[k]; if (typeof f !== 'function' || f.__t) return; const g = function () { const t0 = performance.now(); try { return f.apply(this, arguments); } finally { if (L.length < 500) L.push({ co: label, t: +t0.toFixed(1), ms: +(performance.now() - t0).toFixed(1) }); } }; g.__t = true; obj[k] = g; };
  wrap(S, '_spawnSite', '_spawnSite');
  wrap(d, 'spawnPirateBase', 'spawnPirateBase');
  wrap(d, 'spawnShip', 'spawnShip');
  return 'ok';
})()`;

// --- worker: pierścień klatek renderu (początek renderSingle, czas, liczniki sondy tej klatki) — po sondzie ---
const WK_RING_INSTALUJ = `(() => {
  const C = globalThis.__C3, P = globalThis.__gpuProbe;
  if (!C || !P) return 'brak';
  if (globalThis.__wkRing) return 'już';
  const N = 32768;
  const R = globalThis.__wkRing = { t: new Float64Array(N), d: new Float32Array(N), ps: new Uint16Array(N), psMs: new Float32Array(N), pa: new Uint16Array(N),
    cs: new Uint16Array(N), csMs: new Float32Array(N), nb: new Float64Array(N), wb: new Float64Array(N), sm: new Uint16Array(N), n: 0 };
  const rs = C.renderSingle;
  C.renderSingle = function () {
    const t0 = performance.now();
    const o = rs.apply(this, arguments);
    const f = P.frames[P.frames.length - 1];
    const i = R.n++ & (N - 1);
    R.t[i] = t0; R.d[i] = performance.now() - t0;
    if (f) { R.ps[i] = f.psync; R.psMs[i] = f.psyncMs; R.pa[i] = f.pasync; R.cs[i] = f.csync; R.csMs[i] = f.csyncMs; R.nb[i] = f.nbB + f.ntB; R.wb[i] = f.wbB + f.wtB + f.ceB; R.sm[i] = f.sm; }
    return o;
  };
  return 'ok';
})()`;
const WK_RING_CZYTAJ = (od) => `(() => {
  const R = globalThis.__wkRing; if (!R) return null;
  const N = R.t.length, end = R.n, beg = Math.max(${od}, end - N + 1);
  const gaps = [];
  let maxGap = 0, ps = 0, psMs = 0, pa = 0, cs = 0, csMs = 0, nb = 0, wb = 0, sm = 0, maxD = 0;
  for (let k = beg; k < end; k++) {
    const i = k & (N - 1);
    ps += R.ps[i]; psMs += R.psMs[i]; pa += R.pa[i]; cs += R.cs[i]; csMs += R.csMs[i]; nb += R.nb[i]; wb += R.wb[i]; sm += R.sm[i];
    if (R.d[i] > maxD) maxD = R.d[i];
    if (k > 0) {
      const g = R.t[i] - R.t[(k - 1) & (N - 1)];
      if (g > maxGap) maxGap = g;
      if (g > 50) gaps.push({ t: +R.t[i].toFixed(0), przerwa: +g.toFixed(0), render: +R.d[i].toFixed(1), ps: R.ps[i], psMs: +R.psMs[i].toFixed(0), pa: R.pa[i], cs: R.cs[i], csMs: +R.csMs[i].toFixed(0), noweMB: +(R.nb[i] / 1048576).toFixed(1), wysMB: +(R.wb[i] / 1048576).toFixed(1), sm: R.sm[i] });
    }
  }
  gaps.sort((a, b) => b.przerwa - a.przerwa);
  return { n: end, klatki: end - beg, maksPrzerwa: +maxGap.toFixed(0), maksRender: +maxD.toFixed(1), psync: ps, psyncMs: +psMs.toFixed(0), pasync: pa, csync: cs, csyncMs: +csMs.toFixed(0),
    noweMB: +(nb / 1048576).toFixed(1), wysylkiMB: +(wb / 1048576).toFixed(1), moduly: sm, przerwyN: gaps.length, przerwy: gaps.slice(0, 6) };
})()`;
// czas klatki workera od strony do bitmapy (render.worker.js — pierścień __rwFrameTimes)
const WK_FT_CZYTAJ = (od) => `(() => {
  const f = globalThis.__rwFrameTimes; if (!f) return null;
  const n = f.n, from = Math.max(${od}, n - 8191), a = [];
  for (let i = from; i < n; i++) a.push(f.ms[i & 8191]);
  a.sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : 0);
  return { n, klatki: a.length, p50: q(0.5), p95: q(0.95), maks: a.length ? +a[a.length - 1].toFixed(1) : 0, ponad50: a.filter((x) => x > 50).length };
})()`;
const WOK_STAN = `(globalThis.__wokGra ? globalThis.__wokGra.stan() : null)`;

const idx = { pf: 0, wr: 0, ft: 0 };
async function zeruj() {
  const [pf, wr, ft] = await Promise.all([ev('window.__pf ? window.__pf.n : 0'), wkEval('globalThis.__wkRing ? globalThis.__wkRing.n : 0').catch(() => 0),
    wkEval('globalThis.__rwFrameTimes ? globalThis.__rwFrameTimes.n : 0').catch(() => 0)]);
  idx.pf = pf; idx.wr = wr; idx.ft = ft;
  await wkEval(SONDA_CZYTAJ).catch(() => null);
  await ev(ZDARZENIA_STRONY).catch(() => null);
}

// Okno pomiaru: indeksy pierścieni ciągłe między oknami (przestój na granicy okien nie ginie).
async function okno(etap, label, sekundy, { cicho = false } = {}) {
  await wkEval(sondaOkno(label)).catch(() => {});
  const p0 = await ev(STAN);
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  const [p1, pf, zd, wr, ft, so, wok] = await Promise.all([ev(STAN), ev(PF_CZYTAJ(idx.pf)), ev(ZDARZENIA_STRONY),
    wkEval(WK_RING_CZYTAJ(idx.wr)).catch((e) => ({ err: e.message })), wkEval(WK_FT_CZYTAJ(idx.ft)).catch((e) => ({ err: e.message })),
    wkEval(SONDA_CZYTAJ).catch((e) => ({ err: e.message })), wkEval(WOK_STAN).catch(() => null)]);
  if (pf) idx.pf = pf.n;
  if (wr && !wr.err) idx.wr = wr.n;
  if (ft && !ft.err) idx.ft = ft.n;
  const dt = Math.max(1e-3, (p1.teraz - p0.teraz) / 1000);
  const s = so && !so.err ? so : null;
  const row = { okno: label, s: sek(), dt: +dt.toFixed(2), faza: p1.faza, v: p1.v, npc: p1.npc, baza: p1.baza,
    obrazS: +((p1.zlozenia - p0.zlozenia) / dt).toFixed(1), stronaS: +((p1.klatka - p0.klatka) / dt).toFixed(1),
    workerS: wr && !wr.err ? +(wr.klatki / dt).toFixed(1) : null, hud: p1.hud, strona: pf, zdarzenia: zd, worker: wr, workerFt: ft,
    gpu: s ? { render: s.gpuRender.msNaKlatke, compute: s.gpuCompute.msNaKlatke, naKlatke: s.naKlatke, kolejkaSr: s.sr.lat, kolejkaMaks: s.latMax,
      pamiecMB: s.pamiecMB, renderWg: s.gpuRender.wiersze.slice(0, 14), computeWg: s.gpuCompute.wiersze.slice(0, 10),
      wysylkiBuforow: s.wysylkiBuforow.slice(0, 6), wysylkiTekstur: s.wysylkiTekstur.slice(0, 4), draws: s.sr.draws, passy: s.sr.rp } : so,
    woksele: wok ? { gotowe: wok.gotowe, aktywny: wok.aktywny, kadr: wok.kadr, krok: wok.krok, n: wok.n } : null, nvidia: smi.okno(t0) };
  (report.etapy[etap] ||= { okna: [] }).okna.push(row);
  try { writeJson(join(out, 'raport.json'), report); } catch (_) { /* raport częściowy — przy przerwaniu przebiegu */ }
  if (!cicho) {
    const st = pf ? `strona ${row.stronaS}/s okres p95 ${pf.okres.p95} maks ${pf.okres.maks} cpu p95 ${pf.cpu.p95} maks ${pf.cpu.maks}${pf.przestojeN ? ` PRZESTOJE ${pf.przestojeN} (${pf.przestoje.slice(0, 3).map((x) => x.okres + '/' + x.cpu).join(', ')} ms okres/cpu)` : ''}` : '';
    const wkk = wr && !wr.err ? `wk ${row.workerS}/s przerwa maks ${wr.maksPrzerwa} render maks ${wr.maksRender} sync ${wr.psync}+${wr.csync}c (${wr.psyncMs + wr.csyncMs} ms) async ${wr.pasync} nowe ${wr.noweMB} MB wys ${wr.wysylkiMB} MB moduły ${wr.moduly}` : `wk ${JSON.stringify(wr)}`;
    console.log(`[${sek()}] ${label.padEnd(14)} ${String(p1.faza).padEnd(9)} v ${String(p1.v).padStart(5)} obraz ${String(row.obrazS).padStart(6)}/s | ${st} | ${wkk}`);
    if (s) console.log(`     GPU R ${s.gpuRender.msNaKlatke} C ${s.gpuCompute.msNaKlatke} (p50 ${s.naKlatke?.render?.p50 ?? '-'}+${s.naKlatke?.compute?.p50 ?? '-'}) kolejka śr ${s.sr.lat} maks ${s.latMax} | rysunki ${s.sr.draws} | GPU% ${row.nvidia ? row.nvidia.zajetosc : '-'} | R: ${s.gpuRender.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | ')} | C: ${s.gpuCompute.wiersze.slice(0, 4).map((w) => `${w[0]} ${w[1]}`).join(' | ')}`);
    if (wr && wr.przerwy && wr.przerwy.length) console.log('     przerwy workera:', JSON.stringify(wr.przerwy.slice(0, 4)));
    if (zd && (zd.spawn.length || zd.lt.length)) console.log('     strona:', JSON.stringify({ spawn: zd.spawn.filter((x) => x.co !== 'spawnShip' || x.ms > 20).slice(0, 8), spawnShipN: zd.spawn.filter((x) => x.co === 'spawnShip').length, spawnShipMs: +zd.spawn.filter((x) => x.co === 'spawnShip').reduce((a, x) => a + x.ms, 0).toFixed(0), longTasks: zd.lt.filter((x) => x.ms > 50).slice(0, 6) }));
  }
  return row;
}

// --- profile CPU (strona i worker) — najdłuższe ciągi pracy bez (idle) i ich funkcje ---
function analizaProfilu(profile, progMs = 40) {
  const nodes = new Map(), parent = new Map();
  for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children || []) parent.set(c, n.id); }
  const label = (n) => { const f = n.callFrame; const u = String(f.url || '').split('/').pop().split('?')[0]; return `${f.functionName || '(anon)'}${u ? ` ${u}:${f.lineNumber + 1}` : ''}`; };
  const S = profile.samples || [], D = profile.timeDeltas || [];
  const T = new Float64Array(S.length);
  let t = profile.startTime;
  for (let i = 0; i < S.length; i++) { t += D[i]; T[i] = t; }
  const idle = (id) => nodes.get(id)?.callFrame.functionName === '(idle)';
  const runs = [];
  let a = -1;
  for (let i = 0; i <= S.length; i++) {
    const isIdle = i === S.length || idle(S[i]);
    if (!isIdle && a < 0) a = i;
    else if (isIdle && a >= 0) {
      const ms = ((i < S.length ? T[i] : T[i - 1]) - T[a]) / 1000;
      if (ms >= progMs) runs.push({ a, b: i, ms });
      a = -1;
    }
  }
  const stack = (id) => { const st = []; for (let x = id; x !== undefined; x = parent.get(x)) st.push(x); return st; };
  const agg = (a0, b0) => {
    const self = new Map(), incl = new Map();
    for (let i = a0; i < b0; i++) {
      const w = (i + 1 < S.length ? T[i + 1] - T[i] : 0) / 1000;
      const lk = label(nodes.get(S[i]));
      self.set(lk, (self.get(lk) || 0) + w);
      const seen = new Set();
      for (const id of stack(S[i])) { const k = label(nodes.get(id)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + w); }
    }
    const top = (m, n) => [...m.entries()].filter(([k]) => !/^\((root|program|idle)\)$/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(1)]);
    return { wlasny: top(self, 14), wlaczny: top(incl, 30) };
  };
  const ciagi = [...runs].sort((x, y) => y.ms - x.ms).slice(0, 8).map((r) => ({ odS: +((T[r.a] - profile.startTime) / 1e6).toFixed(2), ms: +r.ms.toFixed(0), ...agg(r.a, r.b) }));
  let busy = 0;
  for (let i = 0; i + 1 < S.length; i++) if (!idle(S[i])) busy += (T[i + 1] - T[i]) / 1000;
  return { probek: S.length, dlugoscS: S.length ? +((T[S.length - 1] - profile.startTime) / 1e6).toFixed(1) : 0, zajetyMs: +busy.toFixed(0),
    ciagowPonadProg: runs.length, ciagiMs: runs.map((r) => +r.ms.toFixed(0)).sort((x, y) => y - x).slice(0, 20), ciagi, calosc: agg(0, S.length) };
}

// --- A/B w pauzie: korzenie sceny workera i kroki Core3D.fx ---
const SCENA_SPIS = `(() => {
  const C = globalThis.__C3, sc = C.scene;
  const rows = [];
  sc.children.forEach((ch, i) => {
    let meshes = 0, vis = 0, tris = 0, lights = 0;
    ch.traverse((o) => {
      if (o.isLight) lights++;
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      meshes++;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      vis++;
      const g = o.geometry;
      const n = g ? (g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0)) : 0;
      const ic = o.isInstancedMesh ? o.count : (g && Number.isFinite(g.instanceCount) ? g.instanceCount : 1);
      tris += (n / 3) * ic;
    });
    let nazwa = ch.name || '';
    if (!nazwa) { const sub = []; ch.traverse((o) => { if (o !== ch && o.name && sub.length < 3 && !sub.includes(o.name)) sub.push(o.name); }); nazwa = sub.length ? '[' + sub.join(', ') + ']' : ''; }
    rows.push({ i, uuid: ch.uuid, nazwa, typ: ch.type, widoczny: ch.visible, warstwy: ch.layers.mask, siatki: meshes, widoczne: vis, swiatla: lights, ktris: Math.round(tris / 1000) });
  });
  return { n: sc.children.length, rows, fx: (C.fx && C.fx.steps || []).map((s, i) => ({ i, nazwa: s.name || '?' })) };
})()`;
const AB_KOD = {
  korzen: (uuid) => [`(() => { const sc = globalThis.__C3.scene; const i = sc.children.findIndex((o) => o.uuid === ${JSON.stringify(uuid)}); if (i < 0) return false; globalThis.__abZ = { o: sc.children[i], i }; sc.remove(sc.children[i]); return true; })()`,
    `(() => { const z = globalThis.__abZ; if (!z) return false; const sc = globalThis.__C3.scene; sc.add(z.o); sc.children.splice(sc.children.indexOf(z.o), 1); sc.children.splice(Math.min(z.i, sc.children.length), 0, z.o); globalThis.__abZ = null; return true; })()`],
  krok: (nazwa) => [`(() => { const L = globalThis.__C3.fx.steps; const i = L.findIndex((s) => (s.name || '?') === ${JSON.stringify(nazwa)}); if (i < 0) return false; globalThis.__abK = { s: L[i], i }; L.splice(i, 1); return true; })()`,
    `(() => { const z = globalThis.__abK; if (!z) return false; const L = globalThis.__C3.fx.steps; L.splice(Math.min(z.i, L.length), 0, z.s); globalThis.__abK = null; return true; })()`],
  // siatki o nazwie z wzorca (np. ^Wok — woksele bazy) zdjęte z rodziców
  siatki: (wzor) => [`(() => { const re = new RegExp(${JSON.stringify(wzor)}); const L = globalThis.__abS = []; globalThis.__C3.scene.traverse((o) => { if (o.parent && re.test(o.name || '')) L.push({ o, p: o.parent }); }); for (const z of L) z.p.remove(z.o); return L.length; })()`,
    `(() => { for (const z of globalThis.__abS || []) z.p.add(z.o); globalThis.__abS = null; return true; })()`]
};

async function abPauza(etap, extra = []) {
  await ev('(window.__setGamePaused(true), true)');
  await sleep(1200);
  const spis = await wkEval(SCENA_SPIS);
  report.etapy[etap].scena = spis;
  console.log(`[${sek()}] scena workera: ${spis.n} korzeni, kroki fx: ${spis.fx.map((f) => f.nazwa).join(', ')}`);
  for (const r of spis.rows.filter((q) => q.widoczne > 0)) console.log(`     #${r.i} ${r.nazwa.slice(0, 60)} (${r.typ}) siatki ${r.widoczne}/${r.siatki} ktris ${r.ktris} warstwy ${r.warstwy}${r.swiatla ? ` ŚWIATŁA ${r.swiatla} — bez A/B` : ''}`);
  // korzeń ze światłami poza A/B: zestaw świateł jest w kluczu każdego materiału — zdjęcie przebudowałoby wszystkie pipeline'y
  const warianty = [
    ...extra,
    ...spis.rows.filter((q) => q.widoczne > 0 && !q.swiatla).map((q) => ({ nazwa: `scena#${q.i} ${q.nazwa.slice(0, 40)}`, kod: AB_KOD.korzen(q.uuid) })),
    ...spis.fx.map((f) => ({ nazwa: `fx:${f.nazwa}`, kod: AB_KOD.krok(f.nazwa) }))
  ];
  const wyniki = [];
  let nBaz = 0;
  const pomiar = async (nazwa) => {
    await sleep(700);
    await wkEval(sondaOkno(`ab|${etap}|${nazwa}`));
    await sleep(1500);
    await wkEval(sondaOkno(`ab-przerwa|${etap}`));
  };
  await pomiar(`baza-${nBaz++}`);
  for (let i = 0; i < warianty.length; i++) {
    const v = warianty[i];
    let ok = null;
    if (v.strona) ok = await ev(v.strona[0]).catch((e) => e.message); else ok = await wkEval(v.kod[0]).catch((e) => e.message);
    await pomiar(v.nazwa);
    if (v.strona) await ev(v.strona[1]).catch(() => {}); else await wkEval(v.kod[1]).catch(() => {});
    wyniki.push({ nazwa: v.nazwa, zastosowano: ok });
    if ((i + 1) % 5 === 0) await pomiar(`baza-${nBaz++}`);
  }
  await pomiar(`baza-${nBaz++}`);
  await ev('(window.__setGamePaused(false), true)');
  // statystyki okien (znaczniki wracają z opóźnieniem kolejki)
  let g = null;
  for (let i = 0; i < 20; i++) {
    g = await wkEval(SONDA_GPU_OKNA).catch(() => null);
    const last = g && g.okna[`ab|${etap}|baza-${nBaz - 1}`];
    if (last && last.gotowe) break;
    await sleep(500);
  }
  const okna = g ? g.okna : {};
  const val = (n) => { const o = okna[`ab|${etap}|${n}`]; return o && o.render ? { r: o.render.p50, c: o.compute ? o.compute.p50 : 0, n: o.pelne ?? o.klatki ?? null } : null; };
  const bazy = [];
  for (let k = 0; k < nBaz; k++) bazy.push(val(`baza-${k}`));
  console.log(`[${sek()}] A/B ${etap} — okna bazowe GPU render/compute p50:`, bazy.map((b) => b ? `${b.r}/${b.c}` : '-').join(' '));
  const tabela = [];
  for (let i = 0; i < warianty.length; i++) {
    const v = val(warianty[i].nazwa);
    const k = Math.floor(i / 5);
    const b = [bazy[k], bazy[k + 1]].filter(Boolean);
    const br = b.length ? b.reduce((a, x) => a + x.r, 0) / b.length : NaN, bc = b.length ? b.reduce((a, x) => a + x.c, 0) / b.length : NaN;
    tabela.push({ nazwa: warianty[i].nazwa, zastosowano: wyniki[i].zastosowano, r: v ? v.r : null, c: v ? v.c : null, dR: v ? +(v.r - br).toFixed(3) : null, dC: v ? +(v.c - bc).toFixed(3) : null });
  }
  tabela.sort((x, y) => ((x.dR ?? 0) + (x.dC ?? 0)) - ((y.dR ?? 0) + (y.dC ?? 0)));
  for (const t of tabela.slice(0, 25)) console.log(`     Δ R ${String(t.dR).padStart(7)} Δ C ${String(t.dC).padStart(7)}  ${t.nazwa}  (${t.zastosowano})`);
  report.etapy[etap].ab = { bazy, tabela, okna };
  return tabela;
}

async function startWorker() {
  for (let i = 0; i < 80 && !wk.sid; i++) await sleep(250);
  if (!wk.sid) throw new Error('bez workera renderu — narzędzie mierzy tryb gracza');
  await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__C3 = Core3D; globalThis.__ST = st;' }), true)`);
  let inst = '';
  const kod = sondaInstaluj({ kazdaKlatka: true });
  for (let i = 0; i < 30 && inst !== 'ok' && inst !== 'już'; i++) { await sleep(500); inst = await wkEval(kod).catch((e) => e.message); }
  const ring = await wkEval(WK_RING_INSTALUJ).catch((e) => e.message);
  console.log(`[${sek()}] sonda: ${inst}, pierścień klatek workera: ${ring}`);
  if (inst !== 'ok' && inst !== 'już') throw new Error(`sonda nie weszła: ${inst}`);
}

async function nowaGra(url, warunek, opis) {
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.ship && window.StoryGame && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await sleep(1500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(800);
  const t0 = Date.now();
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, warunek, 300000, 300)) {
    const diag = await ev(`(() => ({ faza: window.StoryGame?.phase || null, aktywna: !!window.StoryGame?.active, ladowanie: (document.getElementById('loading')?.innerText || '').slice(0, 80) }))()`).catch((e) => e.message);
    throw new Error(`${opis} nie ruszyła: ${JSON.stringify(diag)}`);
  }
  return (Date.now() - t0) / 1000;
}

function finish(code = 0) {
  try { clearInterval(strazGry); smi.stop(); clearTimeout(watchdog); writeJson(join(out, 'raport.json'), report); } catch (e) { console.error(e); }
  Promise.resolve(chrome.close?.()).finally(() => Promise.resolve(server.close?.()).finally(() => process.exit(code)));
}

const KEY_W = { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 };

try {
  // ============================================================ ETAP HALA
  if (ETAP === 'hala' || ETAP === 'oba') {
    const E = 'hala';
    report.etapy[E] = { okna: [] };
    const tl = await nowaGra(`${base}/index.html?dev=1${QUERY ? '&' + QUERY : ''}`,
      `window.StoryGame.active && document.getElementById('loading')?.classList.contains('hidden') && !!window.StoryGame.phase`, 'kampania');
    console.log(`[${sek()}] kampania ruszyła po ${tl.toFixed(1)} s (faza ${await ev('window.StoryGame.phase')})`);
    await startWorker();
    console.log(`[${sek()}] liczniki czasu tworzenia bazy:`, await ev(SPAWN_TIMERS));
    // intro i odprawa (pominięta) — do przycisku ODDOKOWANIE
    const ti = Date.now();
    let s = null;
    while (Date.now() - ti < 180000) {
      s = await ev(`(() => { const S = window.StoryGame, d = S.dialogue; if (d && d.active && d.mode === 'scene') d.skip(); return { faza: S.phase, akcja: S.ui.action ? S.ui.action.id : null, lock: !!S.lock }; })()`);
      if (s.akcja === 'undock') break;
      await sleep(300);
    }
    if (!s || s.akcja !== 'undock') throw new Error(`brak przycisku ODDOKOWANIE: ${JSON.stringify(s)}`);
    report.etapy[E].doOddokowaniaS = +((Date.now() - ti) / 1000).toFixed(1);
    await sleep(3000);
    await zeruj();
    await okno(E, 'dok', 5);
    await screenshotPng(cdp, join(out, '10-dok.png'));
    if (AB) await abPauza(E);
    await zeruj();
    // ODDOKOWANIE (F) — sekwencja obsługi, potem stery wracają (kadr samouczka STEROWANIE)
    await ev(`window.StoryGame.triggerAction('undock')`);
    const tu = Date.now();
    while (Date.now() - tu < 60000 && await ev('!!window.StoryGame.lock')) await sleep(250);
    report.etapy[E].oddokowanieS = +((Date.now() - tu) / 1000).toFixed(1);
    await sleep(1500);
    await okno(E, 'sterowanie', 5);
    await screenshotPng(cdp, join(out, '20-sterowanie.png'));
    await noteObce('przed wylotem');
    // profile CPU przez wylot i tworzenie bazy
    if (PROFIL) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.start');
      await wkSend('Profiler.enable').catch((e) => console.log('profil workera:', e.message));
      await wkSend('Profiler.setSamplingInterval', { interval: 1000 }).catch(() => {});
      await wkSend('Profiler.start').catch((e) => console.log('profil workera:', e.message));
    }
    const tProf = Date.now();
    await zeruj();
    // W trzymane (zapłon, ciąg) — okna po 1 s do wylotu i dalej
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W });
    const tw = Date.now();
    let wylot = null, n = 0, puszczone = false;
    while (true) {
      n++;
      const r = await okno(E, wylot === null ? `wylot-${n}` : `po-${n - wylot}`, 1);
      if (wylot === null && r.faza !== 'undock') { wylot = n; report.etapy[E].wylotPoS = +((Date.now() - tw) / 1000).toFixed(1); console.log(`[${sek()}] WYLOT z hali po ${report.etapy[E].wylotPoS} s (faza ${r.faza})`); }
      if (wylot !== null && !puszczone && n - wylot >= 3) { puszczone = true; await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W }); }
      if (wylot !== null && n - wylot >= PO_WYLOCIE) break;
      if (wylot === null && n > 70) throw new Error('Atlas nie wyleciał z hali w 70 s');
    }
    if (!puszczone) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
    if (PROFIL) {
      const pr = await cdp.send('Profiler.stop').catch((e) => ({ err: e.message }));
      const pw = await wkSend('Profiler.stop', {}, 180000).catch((e) => ({ err: e.message }));
      report.etapy[E].profilOdS = +((tProf - tStart) / 1000).toFixed(1);
      if (pr && pr.profile) { writeFileSync(join(out, 'wylot-strona.cpuprofile'), JSON.stringify(pr.profile)); report.etapy[E].profilStrony = analizaProfilu(pr.profile); }
      else report.etapy[E].profilStrony = pr;
      if (pw && pw.profile) { writeFileSync(join(out, 'wylot-worker.cpuprofile'), JSON.stringify(pw.profile)); report.etapy[E].profilWorkera = analizaProfilu(pw.profile); }
      else report.etapy[E].profilWorkera = pw;
      for (const [k, p] of [['strona', report.etapy[E].profilStrony], ['worker', report.etapy[E].profilWorkera]]) {
        if (!p || !p.ciagi) { console.log(`profil ${k}:`, JSON.stringify(p).slice(0, 300)); continue; }
        console.log(`[${sek()}] PROFIL ${k}: ${p.dlugoscS} s, zajęty ${p.zajetyMs} ms, ciągi > 40 ms: ${p.ciagowPonadProg} (${p.ciagiMs.join(', ')})`);
        for (const c of p.ciagi.slice(0, 4)) {
          console.log(`   ciąg od ${c.odS} s: ${c.ms} ms — własny: ${c.wlasny.slice(0, 6).map((x) => `${x[0]} ${x[1]}`).join(' | ')}`);
          console.log(`        włączny: ${c.wlaczny.slice(0, 14).map((x) => `${x[0]} ${x[1]}`).join(' | ')}`);
        }
      }
    }
    await screenshotPng(cdp, join(out, '30-po-wylocie.png'));
    await okno(E, 'po-wylocie-5s', 5);
    await noteObce('po wylocie');
  }

  // ============================================================ ETAP BAZA
  if (ETAP === 'baza' || ETAP === 'oba') {
    const E = 'baza';
    report.etapy[E] = { okna: [] };
    const tl = await nowaGra(`${base}/index.html?dev=1&story=${FAZA}${QUERY ? '&' + QUERY : ''}`,
      `window.StoryGame.active && window.StoryGame.phase === '${FAZA}' && !!window.StoryGame.site?.station && document.getElementById('loading')?.classList.contains('hidden')`, `faza ${FAZA}`);
    console.log(`[${sek()}] faza ${FAZA} po ${tl.toFixed(1)} s`);
    await startWorker();
    const tv = Date.now();
    let st = null;
    while (Date.now() - tv < 150000) { st = await wkEval(WOK_STAN).catch(() => null); if (st && st.gotowe) break; await sleep(500); }
    report.etapy[E].wokseleGotowePoS = +((Date.now() - tv) / 1000).toFixed(1);
    console.log(`[${sek()}] woksele: ${JSON.stringify(st)} po ${report.etapy[E].wokseleGotowePoS} s`);
    await ev(`(() => {
      const S = window.StoryGame, d = S.site.dock, l = d.layout;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const id of l.structures.habitat) { const q = l.chunkById.get(id); if (q.ghost) continue; x0 = Math.min(x0, q.box.x0); x1 = Math.max(x1, q.box.x1); z0 = Math.min(z0, q.box.z0); z1 = Math.max(z1, q.box.z1); }
      const p = d.toGame((x0 + x1) / 2, (z0 + z1) / 2 + 3500);
      S.deps.placePlayer(p.x, p.y, d.headingToGame(-Math.PI / 2));
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      window.setFogOfWar?.(false);
      if (!window.__guard) window.__guard = setInterval(() => { const s = window.ship; if (!s) return; if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; if (s.maxHp) s.hp = s.maxHp; if (window.fireControl) window.fireControl.posture = 'hold'; }, 100);
      return true;
    })()`);
    await sleep(4000);
    await zeruj();
    for (const z of ZOOMY) {
      await ev(`(() => { const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); c.minZoom = Math.min(c.minZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
      await sleep(2500);
      await okno(E, `baza-z${z}`, 5);
      await screenshotPng(cdp, join(out, `40-baza-z${z}.png`));
      await zeruj();
    }
    if (AB) {
      const z = ZOOMY[0];
      await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
      await sleep(2000);
      await abPauza(E, [
        { nazwa: 'czujniki wył. (strona)', strona: ['(() => { window.Czujka.input.off = true; return true; })()', '(() => { window.Czujka.input.off = false; return true; })()'] },
        { nazwa: 'woksele: siatki Wok* zdjęte', kod: AB_KOD.siatki('^Wok') }
      ]);
    }
    await noteObce('koniec');
  }
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.gpuProcesyKoniec = await gpuProcesy().catch(() => null);
  console.log('karta 3D wg procesów (koniec):', JSON.stringify(report.gpuProcesyKoniec));
  const wazne = report.wkLogi.filter((l) => /warn|error|pipeline sync|kompilacja|przygotowanie|flush|woksel|wypiek/i.test(l.type + ' ' + l.text));
  console.log(`logi workera: ${report.wkLogi.length} (ważne ${wazne.length})`);
  for (const l of wazne.slice(0, 40)) console.log('  wk', l.s, l.type, l.text.slice(0, 220));
  const wazneS = report.strLogi.filter((l) => /warn|error|kompilacja|pipeline/i.test(l.type + ' ' + l.text));
  for (const l of wazneS.slice(0, 20)) console.log('  str', l.s, l.type, l.text.slice(0, 220));
  for (const b of report.bledy.slice(0, 10)) console.log('  BŁĄD', b.s, b.w, b.text.slice(0, 300));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
