// GPU W SCENIE BAZY PIRATÓW przy rozdzielczości monitora użytkownika — tryb gracza (render w workerze). Zgłoszenie
// 2026-10-28: „od pierwszych obrażeń habitatu klatkuje; gdy wszystko wybucha i odłamy spadają na planetoidę —
// katastrofa; PerfHUD: strona 12 kl/s, Obraz 3D (worker) 10 kl/s · CPU 5,5 · GPU 9,0 ms; karta się poci”.
// Vite + headless Chrome z WebGPU, skok dev ?story=shipyard, Atlas nieśmiertelny.
//
//   node scripts/webgpu/gpu-baza-gra.mjs [--okno 1] [--rozmiar 5120x1440] [--out .tmp/gpu-baza] [--zoom 0.14] [--bron special_yamato_cannon]
//        [--strzalyMaks 400] [--prog 30] [--slad 3] [--czasPo 8] [--abWorker 'nazwa@kod|…'] [--abPowt 2] [--query …]
//
// Okna (każde: złożenia obrazu / s, klatki workera / s, CPU workera p50 / p95, sonda GPU workera — wysyłki, zasoby,
// dispatche, opóźnienie kolejki GPU, GPU render / compute wg etykiet; nvidia-smi: zajętość, pamięć, moc):
//   przed      — habitat cały, kamera nad habitatem (--zoom);
//   ostrzal-N  — serie 20 strzałów bronią gry (fireWeaponCore, jak baza-zniszczenie-gra.mjs) w stojące kawałki
//                habitatu, po każdej okno 2 s; do HP ≤ --prog % (albo --strzalyMaks); pierwsze okno = pierwsze trafienia;
//   upadek-N   — HP 0 (finał misji) → okna co 2 s do osiadania (≤ 60 s);
//   po         — kamera fabuły po upadku; nad-gruzem — Atlas nad środkiem bazy, kamera statku (--zoomGruz).
// --slad s: ślad Chrome (zajętość CrGpuMain / workera / strony, najdroższe zdarzenia procesu GPU) w oknach: pierwsze
//   trafienia, środek ostrzału, upadek (4 s po HP 0) i nad gruzem.
// --abWorker 'nazwa@kod|…': w PAUZIE nad gruzem warianty — kod w workerze (globalThis.__C3 = Core3D, __ST = stan
//   workera) przed oknem wariantu, baza (bez kodu, 'baza') między nimi; każdy wariant ma też kod przywrócenia po '##'
//   ('nazwa@kod##przywróć'). Okna 3 s, --abPowt powtórzeń.
// --walka S: po gruzie walka z grupą piratów (Atlas strzela sam), okna walka-N po 3 s — obraz workera wobec klatek strony.
// --balastGb N: po oknie „przed” osobny Chrome zajmuje N GB pamięci karty i stale jej używa (balastVram.mjs — jak inne
//   programy u gracza); okna ostrzału, upadku i gruzu pod presją VRAM.
// --rytm 1 (2026-10-28, „240 kl/s, a efekty klatkują — jakby rozsynchronizowane”): w każdym oknie — o ile przesuwa się
//   treść obrazu między kolejnymi złożeniami (vsync) wobec odstępu złożeń, osobno dla zegarów: kadłuby (SimClock.render),
//   efekty — stary zegar (performance.now() strony po fizyce) i nowy (znacznik rAF strony), pociski NPC na zegarze kroku
//   (SimClock.sim); powtórzone i przeskoczone strony. Liczy się po stronie gry, niezależnie od wersji kodu.
// Pole skóry 3D (2026-10-29): w każdym oknie liczniki pola z workera (przeglądy, pominięcia, komórki, rozrzut /
//   zakresy), a w pauzie po upadek-3 i po nad-gruzem — bufor pola z GPU porównany z kopią CPU (`poleGpu` w raporcie).
//   A/B wysyłki: --query "…&poleRozrzut=0&polePomin=0" (zakres slotu i przegląd w każdej klatce — jak przed).
// Raport: <out>/raport.json (+ zrzuty PNG). Pomiar tylko przy wolnej maszynie (stan nvidia-smi w raporcie).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { SONDA_INSTALUJ, SONDA_CZYTAJ, startNvidiaSmi, stanMaszyny, sladWatkow } from './sondaGpuWorkera.mjs';
import { startVramBallast } from './balastVram.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/gpu-baza');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';
const ZOOM = Number(args.zoom || 0.14);
const ZOOM_GRUZ = Number(args.zoomGruz || 0.3);
const BRON = String(args.bron || 'special_yamato_cannon');
const STRZALY_MAKS = Number(args.strzalyMaks || 400);
const PROG = Number(args.prog || 30);
const SLAD = Number(args.slad ?? 3);
const CZAS_PO = Number(args.czasPo || 8);
const AB = String(args.abWorker || '').split('|').filter(Boolean).map((v) => {
  const i = v.indexOf('@');
  const nazwa = v.slice(0, i), rest = v.slice(i + 1);
  const [kod, przywroc] = rest.split('##');
  return { nazwa, kod, przywroc: przywroc || '' };
});
const AB_POWT = Number(args.abPowt || 2);
const BALAST_GB = Number(args.balastGb || 0);
// --walka S: po upadku walka nad gruzem — grupa piratów obok Atlasa, Atlas strzela sam (postawa „free”), okna 3 s
const WALKA = Number(args.walka || 0);
const RYTM = String(args.rytm || '0') === '1';
let balast = null;
const tStart = Date.now();
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 14 min — koniec'); finish(2); }, 14 * 60 * 1000);

const report = { args, rozmiar: [W, H], maszynaStart: await stanMaszyny(), okna: [], slady: {}, ab: [], wkLogi: [], strona: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.maszynaStart));
const smi = startNvidiaSmi(500);
const { server, base } = await startVite(Number(args.port || 5393));
// --okno 1: widoczne okno na cały ekran, z vsync jak u gracza (headless biegnie bez limitu klatek)
const OKNO = args.okno === '1';
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker', headless: OKNO ? false : undefined,
  extraArgs: OKNO ? ['--window-position=0,0', '--start-fullscreen'] : [] });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);

// --- sesja workera renderu (Target.setAutoAttach, flatten — wzór baza-po-upadku-gra.mjs) ---
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
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) { wk.sid = msg.params.sessionId; wkSend('Runtime.enable').catch(() => {}); }
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400);
    const row = { s: +((Date.now() - tStart) / 1000).toFixed(1), type: msg.params.type, text };
    if (msg.sessionId && msg.sessionId === wk.sid) { if (report.wkLogi.length < 400) report.wkLogi.push(row); }
    else if (!msg.sessionId && /warn|error/.test(msg.params.type) && report.strona.length < 200) report.strona.push(row);
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = window.__rafRec = { n: 0, max: 0, slow: 0, last: 0 };
  const raf = (t) => { if (R.last) { const d = t - R.last; R.n++; if (d > R.max) R.max = d; if (d > 50) R.slow++; } R.last = t; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
})();` });

async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) { if (i >= 2) throw err; console.log(`start fazy ${phase} — ponowienie (${err.message})`); }
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
    if (window.fireControl) window.fireControl.posture = window.__guardPosture || 'hold';
  }, 100);
  return true;
})()`;

// Stan strony: złożenia, wiek, rAF, wraki, domeny gazu workera (prostokąty z wiadomości klatki), upadek
const PAGE_STATE = `(() => {
  const H = window.RenderWorkerHost;
  if (H && typeof H.readStats === 'function') H.readStats();
  const R = window.__rafRec;
  const raf = R ? { n: R.n, max: +R.max.toFixed(1), slow: R.slow } : null;
  if (R) { R.n = 0; R.max = 0; R.slow = 0; }
  let hot = 0, sleep = 0, wd = 0;
  for (const w of window.wrecks || []) { if (!w || w.dead) continue; if (w._wreckSleeping) sleep++; else hot++; if (w.worldDebris) wd++; }
  const F = window.PirateBaseFall && window.PirateBaseFall.state();
  const S = window.StoryGame, st = S && S.site && S.site.structures && S.site.structures.habitat;
  return { t: performance.now(), f: window.__frameId | 0, composed: H ? H.composed : -1, age: H && H.pacer ? H.pacer.age : -1,
    cpu: H ? +(H.stats[6] || 0).toFixed(2) : -1, gpu: H ? +(H.stats[0] || 0).toFixed(2) : -1, gpuC: H ? +(H.stats[1] || 0).toFixed(2) : -1,
    fxMs: H ? +(H.stats[11] || 0).toFixed(2) : -1, domeny: H ? H.domainCount | 0 : -1, raf, hot, sleep, wd,
    upadek: F ? F.phase : '-', ft: F ? +F.t.toFixed(1) : 0, hp: st ? +(100 * st.hp / st.maxHp).toFixed(1) : null };
})()`;

const WK_FRAMES = `(() => {
  const f = globalThis.__rwFrameTimes;
  const n = f ? f.n : 0, from = Math.max(globalThis.__wkSeenN || 0, n - 8192);
  globalThis.__wkSeenN = n;
  const a = [];
  for (let i = from; i < n; i++) a.push(f.ms[i & 8191]);
  a.sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : 0);
  return { n: a.length, p50: q(0.5), p95: q(0.95), max: a.length ? +a[a.length - 1].toFixed(1) : 0 };
})()`;

// Pole skóry 3D w workerze (hullSkin3D, 2026-10-29): przyrost liczników od poprzedniego odczytu — przeglądy ciał
// i pominięte (lustro bez nowej strony węzłów), zapisane komórki, rozrzut / zakresy, dispatche i komórki rozrzutu.
const WK_POLE = `(() => {
  const S = globalThis.__hullSkinFieldDiag && globalThis.__hullSkinFieldDiag.stats;
  if (!S) return null;
  const prev = globalThis.__wkPolePrev || {}, d = {};
  for (const k of Object.keys(S)) if (k !== 'dispatch') d[k] = S[k] - (prev[k] || 0);
  globalThis.__wkPolePrev = { ...S };
  return d;
})()`;
// Bufor pola na GPU = kopia CPU (wysyłka zakresami i rozrzutem niesie te same liczby — obraz jak przed 2026-10-29);
// w pauzie, po klatkach z dispatchem listy.
const WK_POLE_GPU = `(async () => {
  const D = globalThis.__hullSkinFieldDiag, C = globalThis.__C3;
  const attr = D && D.attribute();
  if (!attr || !C || !C.renderer) return { blad: 'brak pola albo renderera' };
  const buf = await C.renderer.getArrayBufferAsync(attr);
  const g = new Uint32Array(buf), c = new Uint32Array(attr.array.buffer, attr.array.byteOffset, attr.array.length);
  const n = Math.min(g.length, c.length);
  let rozne = 0, pierwsza = -1, niezerowe = 0;
  for (let i = 0; i < n; i++) { if (c[i] !== 0) niezerowe++; if (g[i] !== c[i]) { if (pierwsza < 0) pierwsza = i; rozne++; } }
  const sc = D.scatter();
  return { liczby: n, niezerowe, rozne, pierwsza, listaCzeka: sc ? sc.n : null, rozrzut: D.options.scatter, pomin: D.options.skip };
})()`;

// --rytm 1: dziennik zegarów strony (rAF opakowany — znacznik klatki; SimClock.beginRender — zegary tuż po fizyce;
// postFrame — numer strony; ring.compose — która strona w tej klatce ekranu)
const RYTM_INSTALL = `(() => {
  if (window.__rytmZ) return 'już';
  const H = window.RenderWorkerHost, P = window.RenderSnapshot && window.RenderSnapshot.packer, SC = window.SimClock;
  if (!H || !P || !SC || !H.ring) return 'brak';
  const N = 16384, M = N - 1;
  const R = window.__rytmZ = { n: 0, rn: 0, k: new Int32Array(N), ts: new Float64Array(N), pk: new Float64Array(N),
    sim: new Float64Array(N), rend: new Float64Array(N), cn: 0, rcn: 0, cK: new Int32Array(N), cTs: new Float64Array(N), cur: -1 };
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((ts) => { window.__rytmTs = ts; cb(ts); });
  const br0 = SC.beginRender;
  SC.beginRender = function (a, d, p) { br0.call(SC, a, d, p); const i = R.n & M; R.k[i] = -1; R.ts[i] = window.__rytmTs;
    R.pk[i] = performance.now(); R.sim[i] = SC.sim; R.rend[i] = SC.render; R.cur = i; R.n++; };
  const pf0 = H.postFrame;
  H.postFrame = function () { if (R.cur >= 0) R.k[R.cur] = P.k; return pf0.apply(this, arguments); };
  const rc0 = H.ring.compose;
  H.ring.compose = function (k) { const i = R.cn & M; R.cK[i] = k; R.cTs[i] = window.__rytmTs; R.cn++; return rc0.call(this, k); };
  return 'ok';
})()`;
const RYTM_CZYTAJ = `(() => {
  const R = window.__rytmZ; if (!R) return null;
  const M = R.k.length - 1, o = { k: [], ts: [], pk: [], sim: [], rend: [], cK: [], cTs: [] };
  for (let i = Math.max(R.rn, R.n - M); i < R.n; i++) { const j = i & M; o.k.push(R.k[j]); o.ts.push(R.ts[j]); o.pk.push(R.pk[j]); o.sim.push(R.sim[j]); o.rend.push(R.rend[j]); }
  for (let i = Math.max(R.rcn, R.cn - M); i < R.cn; i++) { const j = i & M; o.cK.push(R.cK[j]); o.cTs.push(R.cTs[j]); }
  R.rn = R.n; R.rcn = R.cn;
  return o;
})()`;
// błąd przesunięcia treści na złożenie (vsync): przyrost zegara treści między złożonymi stronami − odstęp złożeń [ms]
function rytmStat(d) {
  if (!d || !d.cK || d.cK.length < 3) return null;
  const byK = new Map();
  for (let i = 0; i < d.k.length; i++) if (d.k[i] >= 0) byK.set(d.k[i], i);
  const e = { kadluby: [], efektyStary: [], efektyNowy: [], pociskiNpcKrok: [], efektyStaryWzgKadlubow: [], pociskiNpcWzgKadlubow: [] };
  let zlozen = 0, powt = 0, przesk = 0;
  for (let j = 1; j < d.cK.length; j++) {
    const dv = d.cTs[j] - d.cTs[j - 1];
    if (!(dv > 0) || dv > 50) continue;
    zlozen++;
    const k0 = d.cK[j - 1], k1 = d.cK[j];
    if (k1 === k0) powt++;
    else if (k1 - k0 >= 2) przesk++;
    const a = byK.get(k0), b = byK.get(k1);
    if (a === undefined || b === undefined) continue;
    const kad = (d.rend[b] - d.rend[a]) * 1000;
    e.kadluby.push(kad - dv);
    e.efektyStary.push(d.pk[b] - d.pk[a] - dv);
    e.efektyNowy.push(d.ts[b] - d.ts[a] - dv);
    e.pociskiNpcKrok.push((d.sim[b] - d.sim[a]) * 1000 - dv);
    e.efektyStaryWzgKadlubow.push(d.pk[b] - d.pk[a] - kad);
    e.pociskiNpcWzgKadlubow.push((d.sim[b] - d.sim[a]) * 1000 - kad);
  }
  const st = (arr) => {
    const a = arr.map(Math.abs).sort((x, y) => x - y);
    if (!a.length) return null;
    const sr = a.reduce((s, v) => s + v, 0) / a.length;
    return { sr: +sr.toFixed(2), p95: +a[Math.min(a.length - 1, Math.floor(0.95 * a.length))].toFixed(2),
      ponad1ms: +(100 * a.filter((v) => v > 1).length / a.length).toFixed(1) };
  };
  const out = { zlozen, powtorzone: powt, przeskoczone: przesk };
  for (const [k, v] of Object.entries(e)) out[k] = st(v);
  return out;
}

// Pauza, ~1,2 s klatek (lista rozrzutu wysłana), odczyt bufora pola z GPU i porównanie z kopią CPU, wznowienie.
async function poleGpu(label) {
  if (!wk.sid) return null;
  await ev('(window.__setGamePaused(true), true)').catch(() => {});
  await sleep(1200);
  const r = await wkEval(WK_POLE_GPU).catch((e) => ({ blad: e.message }));
  await ev('(window.__setGamePaused(false), true)').catch(() => {});
  (report.poleGpu || (report.poleGpu = [])).push({ okno: label, ...r });
  console.log(`   pole GPU = CPU (${label}):`, JSON.stringify(r));
  return r;
}

async function okno(label, sekundy, { slad = false } = {}) {
  const p0 = await ev(PAGE_STATE);
  if (wk.sid) { await wkEval(WK_FRAMES).catch(() => null); await wkEval(SONDA_CZYTAJ).catch(() => null); await wkEval(WK_POLE).catch(() => null); }
  if (RYTM) await ev(RYTM_CZYTAJ).catch(() => null);
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  const rytm = RYTM ? rytmStat(await ev(RYTM_CZYTAJ, 60000).catch(() => null)) : null;
  const p1 = await ev(PAGE_STATE);
  const wf = wk.sid ? await wkEval(WK_FRAMES).catch((e) => ({ err: e.message })) : null;
  const sonda = wk.sid ? await wkEval(SONDA_CZYTAJ).catch((e) => ({ err: e.message })) : null;
  const pole = wk.sid ? await wkEval(WK_POLE).catch((e) => ({ err: e.message })) : null;
  // ślad Chrome PO oknie (narzut śladu nie psuje liczb okna)
  let sl = null;
  if (slad && SLAD > 0) {
    const licz = () => ev('(() => { const h = window.RenderWorkerHost; return { f: window.__frameId | 0, c: h ? h.composed : 0, t: performance.now() }; })()');
    sl = await sladWatkow(cdp, SLAD, licz).catch((e) => ({ blad: String(e) }));
    report.slady[label] = sl;
  }
  const dt = Math.max(1e-3, (p1.t - p0.t) / 1000);
  const row = {
    okno: label, s: +((Date.now() - tStart) / 1000).toFixed(1), dt: +dt.toFixed(2), hp: p1.hp, upadek: p1.upadek, ft: p1.ft,
    zlozeniaS: +((p1.composed - p0.composed) / dt).toFixed(1), klatkiStronyS: +((p1.f - p0.f) / dt).toFixed(1),
    workerKlatkiS: wf && !wf.err ? +(wf.n / dt).toFixed(1) : null, workerMs: wf, wiek: p1.age,
    hudWorker: { cpu: p1.cpu, gpuRender: p1.gpu, gpuCompute: p1.gpuC, fxMs: p1.fxMs }, domeny: p1.domeny,
    wraki: { gorace: p1.hot, spiace: p1.sleep, odlamy: p1.wd }, raf: p1.raf, nvidia: smi.okno(t0), sonda, rytm, pole, slad: sl ? true : undefined
  };
  report.okna.push(row);
  if (pole && !pole.err) {
    const ps = (k) => (pole[k] / dt).toFixed(0);
    console.log(`   pole skóry /s: przeglądy ${ps('scans')}, pominięte ${ps('skips')}, komórki ${ps('cells')} (rozrzut ${ps('scattered')}, zakresy ${ps('rangeCells')}),`
      + ` dispatche ${ps('flushes')} × ${pole.flushes ? (pole.flushCells / pole.flushes).toFixed(0) : 0} kom., przepełnienia ${pole.overflow}`);
  }
  const so = sonda && !sonda.err ? sonda : null;
  console.log(`${label.padEnd(12)} obraz ${String(row.zlozeniaS).padStart(6)}/s  wk ${String(row.workerKlatkiS).padStart(6)}/s  cpuWk p50 ${wf?.p50 ?? '-'}`
    + `  gpuR ${so ? so.gpuRender.msNaKlatke : '-'}  gpuC ${so ? so.gpuCompute.msNaKlatke : '-'}  kolejka śr ${so ? so.sr.lat : '-'} p95 ${so ? so.p95.lat : '-'} maks ${so ? so.latMax : '-'}`
    + `  wysyłki ${so ? ((so.sr.wbB + so.sr.wtB + so.sr.ceB) / 1024).toFixed(0) + ' KB' : '-'}  nowe ${so ? ((so.sr.nbB + so.sr.ntB) / 1024).toFixed(0) + ' KB' : '-'}`
    + `  pamięć ${so ? so.pamiecMB.bufory + '+' + so.pamiecMB.tekstury + ' MB' : '-'}  disp ${so ? so.sr.disp : '-'}  rys ${so ? so.sr.draws : '-'}`
    + `  pipe s/a ${so ? so.suma.psync + '/' + so.suma.pasync : '-'}  domeny ${row.domeny}  hp ${row.hp}  GPU% ${row.nvidia ? row.nvidia.zajetosc : '-'} ${row.nvidia ? row.nvidia.pamiecMB + ' MB' : ''}`);
  if (so) {
    if (so.wysylkiBuforow && so.wysylkiBuforow.length) console.log('   wysyłki:', so.wysylkiBuforow.slice(0, 6).map((w) => `${w[0]} ${(w[1] / 1024).toFixed(0)}KB×${w[2]}`).join(' | '));
    console.log('   render:', so.gpuRender.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
    console.log('   compute:', so.gpuCompute.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
  }
  if (rytm) {
    const f = (o) => (o ? `${o.sr}/${o.p95}/${o.ponad1ms}%` : '-');
    console.log(`   rytm: złożeń ${rytm.zlozen}, powt. ${rytm.powtorzone}, przesk. ${rytm.przeskoczone} | błąd treści na vsync śr/p95/>1ms [ms]:`
      + ` kadłuby ${f(rytm.kadluby)}, efekty stary ${f(rytm.efektyStary)}, efekty nowy ${f(rytm.efektyNowy)}, pociski NPC (krok) ${f(rytm.pociskiNpcKrok)}`
      + ` | wzgl. kadłubów: efekty stary ${f(rytm.efektyStaryWzgKadlubow)}, pociski NPC (krok) ${f(rytm.pociskiNpcWzgKadlubow)}`);
  }
  if (sl && !sl.blad) console.log('   ślad: zajętość', JSON.stringify(sl.zajetosc), 'top GPU:', sl.topGpuMain.slice(0, 5).map((r) => `${r[0]} ${r[1]}ms/${r[2]}`).join(' | '));
  return row;
}

// Seria 20 strzałów w 2 s w stojące kawałki habitatu (lufa 1,6 km od celu, kierunki na zmianę) — jak gracz
const SERIA = `new Promise((res) => {
  const S = window.StoryGame, d = S.site.dock, l = d.layout, st = S.site.structures.habitat;
  const gone = st._dockGone || new Set();
  const W = window.WorldBodies, ws = st._worldSite ? W.site(st._worldSite) : null;
  const stoi = l.structures.habitat.filter((id) => {
    const c = l.chunkById.get(id);
    if (c.ghost) return false;
    const p = ws ? ws.pieces.find((q) => q.id === id) : null;
    return !(p && p.state === 'lost') && (!gone.has(id) || (p && p.state === 'live'));
  });
  const ids = stoi.length ? stoi : l.structures.habitat;
  let k = 0;
  const tick = () => {
    const c = l.chunkById.get(ids[k % ids.length]);
    const tx = (c.box.x0 + c.box.x1) / 2, tz = (c.box.z0 + c.box.z1) / 2;
    const a = (k % 4) * Math.PI / 2 + 0.3;
    const mx = tx + Math.cos(a) * 1600, mz = tz + Math.sin(a) * 1600;
    const p = d.toGame(mx, mz), t = d.toGame(tx, tz);
    const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy) || 1;
    try { window.fireWeaponCore(window.ship, null, '${BRON}', { pos: { x: p.x, y: p.y }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[gpu-baza] strzał', e); }
    if (++k >= 20) { clearInterval(h); res(k); }
  };
  const h = setInterval(tick, 100);
  tick();
})`;

const camHub = (zoom) => ev(`(() => {
  const S = window.StoryGame, d = S.site.dock, l = d.layout, c = window.camera;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const id of l.structures.habitat) { const q = l.chunkById.get(id); if (q.ghost) continue; x0 = Math.min(x0, q.box.x0); x1 = Math.max(x1, q.box.x1); z0 = Math.min(z0, q.box.z0); z1 = Math.max(z1, q.box.z1); }
  const p = d.toGame((x0 + x1) / 2, (z0 + z1) / 2);
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return { x: Math.round(p.x), y: Math.round(p.y) };
})()`);

function finish(code = 0) {
  try { smi.stop(); report.nvidia = smi.samples.length; writeJson(join(out, 'raport.json'), report); } catch (e) { console.error(e); }
  if (balast) { const b = balast; balast = null; b.stop().catch(() => {}); }
  Promise.resolve(chrome.close?.()).finally(() => Promise.resolve(server.close?.()).finally(() => process.exit(code)));
}

try {
  await startStory('shipyard');
  const trybWorker = await waitFor(cdp, '!!window.RenderWorkerHost', 15000, 300);
  for (let i = 0; i < 40 && !wk.sid; i++) await sleep(250);
  console.log('tryb worker:', trybWorker, 'sesja workera:', !!wk.sid);
  if (!trybWorker || !wk.sid) throw new Error('bez workera renderu — narzędzie mierzy tryb gracza');
  await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__C3 = Core3D; globalThis.__ST = st;' }), true)`);
  // operacja dev idzie z najbliższą stroną (import three w workerze) — sonda, gdy Core3D workera jest już w globalu
  let inst = '';
  for (let i = 0; i < 20 && inst !== 'ok' && inst !== 'już'; i++) { await sleep(500); inst = await wkEval(SONDA_INSTALUJ).catch((e) => e.message); }
  console.log('sonda:', inst);
  await ev(GUARD);
  if (RYTM) console.log('rytm:', await ev(RYTM_INSTALL));
  // Atlas 3,5 km na południe od habitatu (jak ostrzał w baza-zniszczenie-gra.mjs), mgła wojny wyłączona
  await ev(`(() => {
    const S = window.StoryGame, d = S.site.dock, l = d.layout;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const id of l.structures.habitat) { const q = l.chunkById.get(id); if (q.ghost) continue; x0 = Math.min(x0, q.box.x0); x1 = Math.max(x1, q.box.x1); z0 = Math.min(z0, q.box.z0); z1 = Math.max(z1, q.box.z1); }
    const p = d.toGame((x0 + x1) / 2, (z0 + z1) / 2 + 3500);
    S.deps.placePlayer(p.x, p.y, d.headingToGame(-Math.PI / 2));
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    window.setFogOfWar?.(false);
    return true;
  })()`);
  await waitFor(cdp, `(() => { const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat'); return !!hs && hs.pieces.filter((p) => p.state === 'live').length >= 6; })()`, 60000, 300);
  console.log('kamera:', JSON.stringify(await camHub(ZOOM)));
  await sleep(4000);
  await okno('przed', 6, { slad: true });
  await screenshotPng(cdp, join(out, '01-przed.png'));
  if (BALAST_GB > 0) {
    balast = await startVramBallast({ gb: BALAST_GB });
    report.balast = { info: balast.info, gb: BALAST_GB };
    console.log('balast VRAM:', JSON.stringify(balast.info), 'nvidia:', JSON.stringify(await stanMaszyny()));
    await sleep(3000);
    await okno('przed-balast', 6, { slad: true });
  }

  // ostrzał seriami do HP ≤ PROG %
  let strzaly = 0, n = 0, sladSrodek = false;
  for (;;) {
    strzaly += await ev(SERIA, 30000);
    n++;
    const hp = (await ev(PAGE_STATE)).hp;
    const sladTu = n === 1 || (!sladSrodek && hp !== null && hp < 65);
    if (n > 1 && sladTu) sladSrodek = true;
    await okno(`ostrzal-${n}`, 2, { slad: sladTu });
    if (n === 1) await screenshotPng(cdp, join(out, '02-pierwsze-trafienia.png'));
    if (hp === null || hp <= PROG || strzaly >= STRZALY_MAKS) break;
  }
  await screenshotPng(cdp, join(out, '03-ostrzal-koniec.png'));
  console.log('strzały:', strzaly);
  report.strzaly = strzaly;

  // --profil 1: profil CPU workera (Profiler CDP, 250 µs) od HP 0 przez upadek (najwyżej 40 s)
  if (args.profil === '1') {
    await wkSend('Profiler.enable');
    await wkSend('Profiler.setSamplingInterval', { interval: 250 });
    await wkSend('Profiler.start');
  }
  // HP 0 habitatu — finał misji (storyGame._chainExplosion → upadek), okna co 2 s do osiadania
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; S.deps.damageStation(st, st.hp + 10); return st.hp; })()`);
  const tFall = Date.now();
  let i = 0;
  while (Date.now() - tFall < 60000) {
    i++;
    const r = await okno(`upadek-${i}`, 2, { slad: i === 2 });
    if (i === 3) { await screenshotPng(cdp, join(out, '04-upadek.png')); await poleGpu('upadek-3'); }
    if (r.upadek === 'settled') break;
    if (args.profil === '1' && Date.now() - tFall > 40000) break;
  }
  if (args.profil === '1') {
    const { profile } = await wkSend('Profiler.stop', {}, 120000);
    writeFileSync(join(out, 'worker-upadek.cpuprofile'), JSON.stringify(profile));
    console.log('profil workera:', join(out, 'worker-upadek.cpuprofile'));
  }
  await screenshotPng(cdp, join(out, '05-po-upadku.png'));
  await okno('po', CZAS_PO);
  // Atlas nad środkiem bazy, kamera statku (gracz lata nad gruzem)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(0, 0); S.deps.placePlayer(p.x, p.y + 600, 0); window.ship.vel.x = 0; window.ship.vel.y = 0;
    const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM_GRUZ}; return true; })()`).catch((e) => console.log('przelot:', e.message));
  await sleep(2500);
  await okno('nad-gruzem', 8, { slad: true });
  await screenshotPng(cdp, join(out, '06-nad-gruzem.png'));
  await poleGpu('nad-gruzem');

  if (WALKA > 0) {
    // jednostki jak w misji po upadku: piraci przy polu gruzu, Atlas (nieśmiertelny) walczy sam
    const sp = await ev(`(() => {
      window.__guardPosture = 'free';
      const s = window.ship, a = Number(s.angle) || 0, c = Math.cos(a), n = Math.sin(a);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
      const out = { piraci: 0, przed: (window.npcs || []).filter((q) => q && !q.dead && q.hp > 0).length };
      const put = (key, pos) => { const r = window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + Math.PI });
        out.piraci += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      for (let i = 0; i < 8; i++) put('frigate_pd', at(6500 + (i >> 2) * 700, ((i & 3) - 1.5) * 800));
      for (let i = 0; i < 4; i++) put('destroyer', at(8200, (i - 1.5) * 1100));
      for (let i = 0; i < 2; i++) put('pirate_battleship', at(9800, (i - 0.5) * 2000));
      return out;
    })()`).catch((e) => ({ blad: e.message }));
    console.log('walka: jednostki', JSON.stringify(sp));
    report.walka = { jednostki: sp };
    const nW = Math.max(1, Math.round(WALKA / 3));
    for (let i = 1; i <= nW; i++) {
      const r = await okno(`walka-${i}`, 3, { slad: i === 2 });
      const st = await ev(`(() => ({ npc: (window.npcs || []).filter((q) => q && !q.dead && q.hp > 0).length, pociski: (window.bullets || []).length }))()`).catch(() => null);
      r.walka = st;
      console.log(`   walka-${i}: strona ${r.klatkiStronyS}/s, obraz ${r.zlozeniaS}/s, worker ${r.workerKlatkiS}/s`, JSON.stringify(st));
      if (i === 2) await screenshotPng(cdp, join(out, '07-walka.png'));
    }
    await ev(`(window.__guardPosture = 'hold', true)`).catch(() => {});
  }

  if (AB.length) {
    await ev('(window.__setGamePaused(true), true)');
    await sleep(1000);
    for (let r = 0; r < AB_POWT; r++) {
      for (const v of [{ nazwa: 'baza', kod: '', przywroc: '' }, ...AB]) {
        if (v.kod) await wkEval(`(() => { const Core3D = globalThis.__C3, st = globalThis.__ST; ${v.kod}; return true; })()`).catch((e) => console.log('ab', v.nazwa, e.message));
        await sleep(1200);
        const row = await okno(`ab-${v.nazwa}-${r}`, 3);
        report.ab.push({ wariant: v.nazwa, r, gpuR: row.sonda?.gpuRender?.msNaKlatke, gpuC: row.sonda?.gpuCompute?.msNaKlatke, lat: row.sonda?.sr?.lat, wk: row.workerKlatkiS, obraz: row.zlozeniaS, nv: row.nvidia?.zajetosc });
        if (v.przywroc) await wkEval(`(() => { const Core3D = globalThis.__C3, st = globalThis.__ST; ${v.przywroc}; return true; })()`).catch((e) => console.log('ab przywróć', v.nazwa, e.message));
      }
    }
    await ev('(window.__setGamePaused(false), true)');
  }
} catch (err) {
  console.error(err);
  report.bledy.push(String(err?.stack || err));
} finally {
  clearTimeout(watchdog);
  if (balast) { report.balastKoniec = await balast.stan().catch(() => null); }
  const other = report.wkLogi.filter((l) => /warn|error|exception|pipeline sync|kompilacja w grze/.test(l.type + ' ' + l.text));
  for (const l of other.slice(0, 20)) console.log('  wk', l.type, l.s, l.text.slice(0, 220));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
