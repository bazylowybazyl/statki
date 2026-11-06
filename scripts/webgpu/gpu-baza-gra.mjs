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
//   ostrzal-N  — serie 20 strzałów bronią gry (fireWeaponCore, jak baza-zniszczenie-gra.mjs) po ETAPACH finału habitatu
//                (od 2026-11-03 punkty habitatu = maks. × etapy do zrobienia, src/game/story/pirateBaseIntegrity.js —
//                habitatStages): wyłom (ćwiartka bębna od strony Atlasa, H-S), wieża (szyb H-C przez wyłom — szyja
//                zrywa się, wieża pada), wieżowce (highrise1, highrise2); po każdej serii okno 2 s; pierwsze okno =
//                pierwsze trafienia. Komplet etapów = habitat ginie SAM (syncBaseStages w grze) = finał misji — w trakcie
//                serii, więc pierwsze sekundy upadku są w ostatnim oknie ostrzal-N (kolumna `upadek`, `ft`).
//                --prog P (domyślnie 0): koniec ostrzału przy HP ≤ P % (etapy: 75 / 50 / 25 / 0); --strzalyMaks
//                i zastój (brak postępu pul i etapów przez 8 serii) też kończą ostrzał;
//   upadek-N   — HP 0 (finał misji) → okna co 2 s jedno za drugim do osiadania (≤ 60 s; bez pauz i śladu w trakcie —
//                kolumny ft, uderzenie wieży / dysku, zamrożonych brył). Habitat żywy po ostrzale (--prog > 0, limit
//                strzałów, zastój) — finał JAWNIE tym samym API, którym gra zabija habitat poza pulami (syncBaseStages
//                po komplecie etapów, ogień w rurach): S.deps.damageStation(habitat, hp + 10, true) — `direct`, bez pul
//                kawałków (bez `true` trafienie idzie do puli kawałka pod punktem trafienia i finału nie ma);
//   osiadle-N  — po osiadaniu okna 2 s do pojawienia się podsumowania misji (≤ 20 s);
//   po         — kamera fabuły po upadku; nad-gruzem — Atlas nad środkiem bazy, kamera statku (--zoomGruz).
// ZAMROŻENIE PO UPADKU (2026-11-04): misja 1 po osiadaniu (habitatFallDone) i ogniu w rurach mówi „yardVictory”, czeka
//   3 s czasu gry i pokazuje podsumowanie (`api.ui.summary` → StoryGame._freeze 'summary'): pętla gry idzie gałęzią pauzy
//   (`PAUSED || StoryGame.worldFrozen` — bez kroków fizyki, __frameId stoi), worker rysuje stojący świat. Gracz zamyka
//   podsumowanie przyciskiem — wtedy rusza misja 2 (naprawa, po ~8 s fale piratów). Narzędzie (--odmroz 1, domyślnie)
//   odmraża JAWNIE: usuwa powód 'summary' z StoryGame._freeze i chowa panel — świat żyje (gruz, wraki, gaz), a skrypt
//   misji dalej czeka na podsumowanie (bez fal misji 2). --odmroz 0 — okna po i nad-gruzem w zamrożonym świecie (jak dawniej).
// Sonda GPU (2026-11-04): czas GPU NA KLATKĘ (p50 / p95 / maks. render, compute, suma) z własnego licznika klatek sondy
//   (sondaGpuWorkera.mjs), każda klatka ze znacznikami (--sondaKazdaKlatka 0 — brama Core3D jak w grze); każde okno
//   i przerwa między oknami (seria-N — strzały, zrzut-…, po:<okno>) ma znacznik, więc pomiar GPU nie ma dziur. Tabela
//   na końcu logu, w raporcie `gpuOkna`. Przed startem: gry użytkownika (LoL, RuneScape) — bez pomiaru (--mimoGry 1
//   pomija), cudze harnessy — w raporcie `obce` (start, po ostrzale, po upadku, koniec).
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
// --okno 1: okno na cały ekran z vsync. Zasłonięte okno albo zgaszony ekran = strona 'hidden', rAF stoi, gra wisi na
//   ekranie ładowania (2026-11-04: „faza shipyard nie ruszyła” ×3) — dlatego flagi Chrome bez zasłaniania okien, ekran
//   trzymany włączony i okno stawiane na wierzch przed każdym startem fazy (scripts/webgpu/oknoPomiaru.mjs, wzór
//   gpu-pas-gra.mjs); strona wciąż niewidoczna → błąd z diagnozą zamiast 3 × 2 min czekania.
// Obraz bazy na wiązanych wokselach, jak u gracza (src/3d/woksele/wGrze.js, klej w pirateBaseGame.js; plan LOD § 5e): stara baza schowana, trafienia i rozpady idą zdarzeniami z gry. Woksele, które nie wstaną, to błąd przebiegu.
//   Raport: `woksele` (węzły, kroki, liczniki), `syncPipeline` (materiał @ obiekt każdego pipeline'u utworzonego synchronicznie po rozgrzewce; ma być pusto).
// Raport: <out>/raport.json (+ zrzuty PNG). Pomiar tylko przy wolnej maszynie (stan nvidia-smi w raporcie).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { sondaInstaluj, sondaOkno, SONDA_CZYTAJ, SONDA_GPU_OKNA, startNvidiaSmi, stanMaszyny, sladWatkow, gryUzytkownika, obceProcesy } from './sondaGpuWorkera.mjs';
import { startVramBallast } from './balastVram.mjs';
import { OKNO_FLAGI, startEkran, oknoNaEkran, portDebugowania, WIDOCZNOSC } from './oknoPomiaru.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/gpu-baza');
mkdirSync(out, { recursive: true });
const query = (args.query ? `&${args.query}` : '');
const ZOOM = Number(args.zoom || 0.14);
const ZOOM_GRUZ = Number(args.zoomGruz || 0.3);
const BRON = String(args.bron || 'special_yamato_cannon');
const STRZALY_MAKS = Number(args.strzalyMaks || 400);
const PROG = Number(args.prog || 0);
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
const KAZDA_KLATKA = String(args.sondaKazdaKlatka ?? '1') !== '0';
const ODMROZ = String(args.odmroz ?? '1') !== '0';
let balast = null;
const tStart = Date.now();
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 14 min — koniec'); finish(2); }, 14 * 60 * 1000);

const report = { args, rozmiar: [W, H], maszynaStart: await stanMaszyny(), okna: [], gpuOkna: {}, obce: [], slady: {}, ab: [], wkLogi: [], strona: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.maszynaStart));
// gra użytkownika na tej maszynie = pomiar GPU bez sensu (i przeszkadza graczowi)
report.gry = await gryUzytkownika();
if (report.gry.length && args.mimoGry !== '1') {
  console.error('GRA UŻYTKOWNIKA DZIAŁA:', report.gry.join(', '), '— pomiar pominięty (--mimoGry 1 wymusza)');
  writeJson(join(out, 'raport.json'), { ...report, pominiety: 'gra użytkownika' });
  process.exit(3);
}
const noteObce = async (kiedy) => {
  const o = await obceProcesy().catch(() => []);
  report.obce.push({ kiedy, s: +((Date.now() - tStart) / 1000).toFixed(1), n: o.length, procesy: o.slice(0, 4) });
  if (o.length) console.log(`OBCE HARNESSY (${kiedy}): ${o.length} — ${o.slice(0, 2).map((x) => x.cmd.slice(0, 100)).join(' | ')}`);
};
await noteObce('start');
const smi = startNvidiaSmi(500);
const { server, base } = await startVite(Number(args.port || 5393));
// --okno 1: widoczne okno na cały ekran, z vsync jak u gracza (headless biegnie bez limitu klatek)
const OKNO = args.okno === '1';
const ekran = OKNO ? startEkran() : null;
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker', headless: OKNO ? false : undefined,
  extraArgs: OKNO ? ['--window-position=0,0', '--start-fullscreen', ...OKNO_FLAGI] : [] });
const { cdp } = chrome;
const mojPort = portDebugowania(cdp);
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

// Woksele wstają same przy attach bazy (pirateBaseGame.js): czekanie, aż stara baza zostanie schowana.
async function startWoksele() {
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < 150000) {
    st = await wkEval('globalThis.__wokGra ? globalThis.__wokGra.stan() : null').catch(() => null);
    if (st && st.gotowe) break;
    await sleep(500);
  }
  console.log('woksele:', JSON.stringify(st), `po ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!st || !st.gotowe) throw new Error(`woksele nie wstały: ${JSON.stringify(st)}`);
  const r = await ev(`(() => { const d = window.StoryGame.site.dock, o = d.toGame(0, 0); return { px: o.x, py: o.y, os: d.headingToGame(0) }; })()`);
  // od tej chwili każdy pipeline synchroniczny z nazwą (materiał @ obiekt; compute: nazwa kernela)
  await wkEval(`(() => { const b = globalThis.__C3.renderer.backend, L = globalThis.__wokSync = [];
    const fR = b.createRenderPipeline; b.createRenderPipeline = function (ro, pr) { if (!pr && L.length < 200) L.push((ro.material?.name || ro.material?.type) + ' @ ' + (ro.object?.name || ro.object?.type)); return fR.apply(this, arguments); };
    const fC = b.createComputePipeline; b.createComputePipeline = function (pl) { if (L.length < 200) L.push('compute: ' + (pl?.computeProgram?.name || pl?.cacheKey || '?')); return fC.apply(this, arguments); };
    return true; })()`);
  report.woksele = { rama: r, start: await wkEval('globalThis.__wokGra.stan()') };
  // --wkStart <plik>: wyrażenie JS w workerze, gdy woksele wstały (np. nasłuch danych). --wkKoniec <plik>: na końcu misji, wynik w wk-koniec.json.
  if (args.wkStart) await wkEval(readFileSync(String(args.wkStart), 'utf8'));
  console.log('woksele stan:', JSON.stringify(report.woksele.start));
}

async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) { if (i >= 2) throw err; console.log(`start fazy ${phase} — ponowienie (${err.message})`); }
  }
}
async function startStoryOnce(phase) {
  if (OKNO) { report.oknoPrzegladarki = await oknoNaEkran(mojPort, W, H).catch((e) => String(e)); console.log('okno przeglądarki:', report.oknoPrzegladarki); }
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.StoryGame && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  // okno: strona ukryta (zasłonięte okno, zgaszony ekran) = rAF stoi i start gry wisi pod ekranem ładowania
  const wid = await ev(WIDOCZNOSC).catch((e) => ({ blad: e.message }));
  if (OKNO || wid.stan !== 'visible') console.log('widoczność strony:', JSON.stringify(wid));
  if (OKNO && wid.stan !== 'visible') {
    report.oknoPrzegladarki2 = await oknoNaEkran(mojPort, W, H).catch((e) => String(e));
    await sleep(2000);
    const wid2 = await ev(WIDOCZNOSC).catch((e) => ({ blad: e.message }));
    console.log('widoczność strony (po ponownym ustawieniu okna):', JSON.stringify(wid2), report.oknoPrzegladarki2);
    if (wid2.stan !== 'visible') throw new Error(`strona niewidoczna (${JSON.stringify(wid2)}) — ekran zgaszony albo okno zasłonięte, pomiar okna z vsync niemożliwy`);
  }
  await sleep(2500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 120000, 400)) {
    // diagnoza: widoczność i rAF strony, kroki startu gry (startGame: window.__startSteps), napis ekranu ładowania
    const diag = await ev(`(async () => { const w = await ${WIDOCZNOSC}; const L = document.getElementById('loading');
      return { ...w, kroki: window.__startSteps || null, ladowanie: L && !L.classList.contains('hidden') ? (L.innerText || '').trim().slice(0, 80) : null, faza: window.StoryGame?.phase || null, aktywna: !!window.StoryGame?.active }; })()`).catch((e) => ({ blad: e.message }));
    throw new Error(`faza ${phase} nie ruszyła ${JSON.stringify(diag)}`);
  }
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
  const num = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : -1);
  return { t: performance.now(), f: window.__frameId | 0, composed: H ? H.composed : -1, age: H && H.pacer ? H.pacer.age : -1,
    cpu: H ? +(H.stats[6] || 0).toFixed(2) : -1, gpu: H ? +(H.stats[0] || 0).toFixed(2) : -1, gpuC: H ? +(H.stats[1] || 0).toFixed(2) : -1,
    fxMs: H ? +(H.stats[11] || 0).toFixed(2) : -1, domeny: H ? H.domainCount | 0 : -1, raf, hot, sleep, wd,
    upadek: F ? F.phase : '-', ft: F ? +F.t.toFixed(1) : 0, hp: st ? +(100 * st.hp / st.maxHp).toFixed(1) : null,
    // upadek: czas uderzenia wieży / dysku w skałę (ft, −1 — jeszcze nie), bryły zamrożone na skale
    wu: F ? num(F.towerImpactT) : -1, du: F ? num(F.discImpactT) : -1, zbr: F ? F.frozen | 0 : 0,
    // zamrożenie świata przez fabułę (sceny, kino, podsumowanie) — pętla jak w pauzie, __frameId stoi
    zam: !!(S && S.worldFrozen), powody: S && S._freeze ? [...S._freeze] : [], podsum: !!(S && S.ui && S.ui.summary),
    pauza: typeof window.__isGamePaused === 'function' ? !!window.__isGamePaused() : null };
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
  await tagGpu(`pole-gpu-${label}`);
  await ev('(window.__setGamePaused(true), true)').catch(() => {});
  await sleep(1200);
  const r = await wkEval(WK_POLE_GPU).catch((e) => ({ blad: e.message }));
  await ev('(window.__setGamePaused(false), true)').catch(() => {});
  (report.poleGpu || (report.poleGpu = [])).push({ okno: label, ...r });
  console.log(`   pole GPU = CPU (${label}):`, JSON.stringify(r));
  return r;
}

// Znacznik okna sondy GPU (klatki workera od tej chwili liczą się do `nazwa`) — także przerwy między oknami.
const tagGpu = (nazwa) => (wk.sid ? wkEval(sondaOkno(nazwa)).catch(() => null) : Promise.resolve(null));

// Statystyki GPU na klatkę okien sondy: dopisuje do wierszy raportu okna gotowe (rozliczona ostatnia klatka), wypisuje
// nowe; `czekaj` — ms czekania, aż wszystkie okna będą gotowe (koniec przebiegu).
const gpuWypisane = new Set();
const fmtQ = (q) => (q ? `${q.p50}/${q.p95}/${q.maks}` : '-');
async function zbierzGpu(czekaj = 0) {
  if (!wk.sid) return null;
  const t0 = Date.now();
  let g = null;
  for (;;) {
    g = await wkEval(SONDA_GPU_OKNA).catch((e) => ({ blad: e.message }));
    if (!g || g.blad || !g.okna) return g;
    if (!(czekaj > 0) || Object.values(g.okna).every((o) => o.gotowe) || Date.now() - t0 > czekaj) break;
    await sleep(300);
  }
  report.gpuSonda = { fid: g.fid, rozliczone: g.rozliczone, kluczeCzekaja: g.kluczeCzekaja, bezKlucza: g.bezKlucza, infoFrame: g.infoFrame, info0: g.info0, blad: g.blad };
  for (const [name, o] of Object.entries(g.okna)) {
    report.gpuOkna[name] = o;
    const row = report.okna.find((r) => r.okno === name);
    if (row && o.gotowe) row.gpu = o;
    if (o.gotowe && !gpuWypisane.has(name)) {
      gpuWypisane.add(name);
      console.log(`   GPU/klatkę ${name}: klatek ${o.klatek} (pełne ${o.pelne}, częściowe ${o.czesciowe}, bez ${o.bezZnacznikow})`
        + `  render p50/p95/maks ${fmtQ(o.render)}  compute ${fmtQ(o.compute)}  suma ${fmtQ(o.suma)} ms`
        + `  | ${o.etykietyRender.slice(0, 4).map((w) => `${w[0]} ${w[1]}`).join(', ')} | ${o.etykietyCompute.slice(0, 3).map((w) => `${w[0]} ${w[1]}`).join(', ')}`);
    }
  }
  return g;
}

async function okno(label, sekundy, { slad = false } = {}) {
  const g0 = await tagGpu(label);
  const p0 = await ev(PAGE_STATE);
  if (wk.sid) { await wkEval(WK_FRAMES).catch(() => null); await wkEval(SONDA_CZYTAJ).catch(() => null); await wkEval(WK_POLE).catch(() => null); }
  if (RYTM) await ev(RYTM_CZYTAJ).catch(() => null);
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  // przerwa do następnego okna (odczyty, zrzuty) — osobny znacznik sondy, bez dziury w pomiarze GPU
  const g1 = await tagGpu(`po:${label}`);
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
  // Czas HullBodies.step na stronie gry od poprzedniego okna: [średnia ms, maks ms, kroków].
  const fizStrona = await ev(`(() => {
    const HB = window.HullBodies;
    if (!window.__fizStrony && HB && HB.step) {
      const R = window.__fizStrony = { n: 0, sum: 0, max: 0 };
      const step = HB.step;
      HB.step = function (...a) { const t = performance.now(); const r = step.apply(this, a); const ms = performance.now() - t; R.n++; R.sum += ms; if (ms > R.max) R.max = ms; return r; };
      return null;
    }
    const R = window.__fizStrony;
    if (!R) return null;
    const w = [+(R.sum / Math.max(1, R.n)).toFixed(2), +R.max.toFixed(1), R.n];
    R.n = 0; R.sum = 0; R.max = 0;
    return w;
  })()`).catch(() => null);
  const row = {
    fizStrona,
    okno: label, s: +((Date.now() - tStart) / 1000).toFixed(1), dt: +dt.toFixed(2), hp: p1.hp, upadek: p1.upadek, ftOd: p0.ft, ft: p1.ft,
    uderzenieWiezy: p1.wu, uderzenieDysku: p1.du, zamrozoneBryly: p1.zbr,
    zamrozony: p0.zam || p1.zam, powodyZamrozenia: [...new Set([...p0.powody, ...p1.powody])], podsumowanie: p1.podsum, pauza: p1.pauza,
    // klatki sondy (renderSingle workera), numery info.frame three i takty rAF workera w oknie
    klatkiSondy: g0 && g1 ? g1.fid - g0.fid : null, infoFrame: g0 && g1 ? [g0.infoFrame, g1.infoFrame] : null,
    taktyWorkera: g0 && g1 ? g1.takty - g0.takty : null,
    zlozeniaS: +((p1.composed - p0.composed) / dt).toFixed(1), klatkiStronyS: +((p1.f - p0.f) / dt).toFixed(1),
    workerKlatkiS: wf && !wf.err ? +(wf.n / dt).toFixed(1) : null, workerMs: wf, wiek: p1.age,
    hudWorker: { cpu: p1.cpu, gpuRender: p1.gpu, gpuCompute: p1.gpuC, fxMs: p1.fxMs }, domeny: p1.domeny,
    wraki: { gorace: p1.hot, spiace: p1.sleep, odlamy: p1.wd }, raf: p1.raf, nvidia: smi.okno(t0), sonda, rytm, pole, slad: sl ? true : undefined
  };
  report.okna.push(row);
  if (wk.sid) row.woksele = await wkEval('globalThis.__wokGra ? globalThis.__wokGra.stan() : null').catch(() => null);
  if (pole && !pole.err) {
    const ps = (k) => (pole[k] / dt).toFixed(0);
    console.log(`   pole skóry /s: przeglądy ${ps('scans')}, pominięte ${ps('skips')}, komórki ${ps('cells')} (rozrzut ${ps('scattered')}, zakresy ${ps('rangeCells')}),`
      + ` dispatche ${ps('flushes')} × ${pole.flushes ? (pole.flushCells / pole.flushes).toFixed(0) : 0} kom., przepełnienia ${pole.overflow}`);
  }
  const so = sonda && !sonda.err ? sonda : null;
  const nk = so && so.naKlatke;
  console.log(`${label.padEnd(12)} ft ${row.ftOd}→${row.ft} ${row.upadek}${row.zamrozony ? ` ZAMROŻONY[${row.powodyZamrozenia}]` : ''}`
    + `  klatki sondy ${row.klatkiSondy} info.frame ${row.infoFrame ? row.infoFrame.join('→') : '-'} takty rAF wk ${row.taktyWorkera}`
    + `  (wieża ${row.uderzenieWiezy}, dysk ${row.uderzenieDysku}) zamrożone ${row.zamrozoneBryly}`);
  console.log(`${''.padEnd(12)} obraz ${String(row.zlozeniaS).padStart(6)}/s  wk ${String(row.workerKlatkiS).padStart(6)}/s  strona ${row.klatkiStronyS}/s  cpuWk p50 ${wf?.p50 ?? '-'}`
    + `  gpuR ${so ? so.gpuRender.msNaKlatke : '-'}  gpuC ${so ? so.gpuCompute.msNaKlatke : '-'}`
    + `  (rozliczone od odczytu: ${nk ? `${nk.pelne}/${nk.klatek} pełnych, suma p50/p95/maks ${fmtQ(nk.suma)}` : '-'})  kolejka śr ${so ? so.sr.lat : '-'} p95 ${so ? so.p95.lat : '-'} maks ${so ? so.latMax : '-'}`
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
  await zbierzGpu();
  return row;
}

// Seria 20 strzałów w 2 s (lufa 1,6 km za celem, kierunki na zmianę) — jak gracz, po etapach finału habitatu
// (cel misji: „wyłom w bębnie, szyb pod wieżą (zwal ją), wieżowce na pomostach”); cel wybierany przy każdym strzale:
//   wyłom   — stojąca ćwiartka bębna (najpierw H-S, od strony Atlasa), środek pierścienia ćwiartki, lufa na jej osi;
//   wieża   — szyb H-C (środek habitatu) przez wyłom: lufa w kącie pękniętej ćwiartki (tor promienisty — przez lukę);
//   wieżowce — pierwszy stojący wieżowiec (highrise1, highrise2), środek bryły, cztery kierunki;
// habitat bez etapów (gra sprzed 2026-11-03) — stojące kawałki habitatu na zmianę, jak dawniej.
const SERIA = `new Promise((res) => {
  const S = window.StoryGame, site = S.site, d = site.dock, l = d.layout, st = site.structures.habitat, Hb = l.habitat;
  const pools = st.piecePools || null, gone = st._dockGone || new Set();
  const broken = (id) => (pools && pools[id] ? pools[id].hp <= 0 : false) || gone.has(id);
  const W = window.WorldBodies, ws = st._worldSite ? W.site(st._worldSite) : null;
  const stoi = l.structures.habitat.filter((id) => {
    const c = l.chunkById.get(id);
    if (c.ghost) return false;
    const p = ws ? ws.pieces.find((q) => q.id === id) : null;
    return !(p && p.state === 'lost') && (!gone.has(id) || (p && p.state === 'live'));
  });
  const ids = stoi.length ? stoi : l.structures.habitat;
  const quads = [...Hb.quadrants].sort((a, b) => (b.id === 'H-S') - (a.id === 'H-S'));
  const ringR = (Hb.innerR - Hb.innerW + Hb.drumR) / 2;
  let k = 0;
  const aim = () => {
    const s = site.habitatStages ? site.habitatStages() : null;
    const jit = ((k % 5) - 2) * 0.12;
    if (s && s.breach < s.breachNeed) {
      const q = quads.find((qd) => !broken(qd.id)) || quads[0], c = (q.a0 + q.a1) / 2;
      return { tx: Math.cos(c) * ringR, tz: Math.sin(c) * ringR, a: c + jit, cel: q.id };
    }
    if (s && !s.tower) {
      const q = quads.find((qd) => broken(qd.id)) || quads[0], c = (q.a0 + q.a1) / 2;
      return { tx: 0, tz: 0, a: c + jit, cel: 'H-C' };
    }
    const hr = s ? (l.highrises || []).find((h) => !site.structureDestroyed(h.structure)) : null;
    if (hr) {
      const c = l.chunkById.get(hr.chunk);
      return { tx: (c.box.x0 + c.box.x1) / 2, tz: (c.box.z0 + c.box.z1) / 2, a: (k % 4) * Math.PI / 2 + 0.3, cel: hr.structure };
    }
    const c = l.chunkById.get(ids[k % ids.length]);
    return { tx: (c.box.x0 + c.box.x1) / 2, tz: (c.box.z0 + c.box.z1) / 2, a: (k % 4) * Math.PI / 2 + 0.3, cel: c.id };
  };
  const cele = {};
  const tick = () => {
    // habitat padł (komplet etapów) — koniec serii, bez strzałów w spadający habitat
    if (st._destroyed3D || !(st.hp > 0)) { clearInterval(h); res({ n: k, cele }); return; }
    const t0 = aim();
    cele[t0.cel] = (cele[t0.cel] || 0) + 1;
    const mx = t0.tx + Math.cos(t0.a) * 1600, mz = t0.tz + Math.sin(t0.a) * 1600;
    const p = d.toGame(mx, mz), t = d.toGame(t0.tx, t0.tz);
    const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy) || 1;
    try { window.fireWeaponCore(window.ship, null, '${BRON}', { pos: { x: p.x, y: p.y }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[gpu-baza] strzał', e); }
    if (++k >= 20) { clearInterval(h); res({ n: k, cele }); }
  };
  const h = setInterval(tick, 100);
  tick();
})`;
// Etapy finału i postęp ostrzału (suma pul kawałków habitatu + punkty wieżowców) — zastój = brak zmiany
const ETAPY = `(() => {
  const site = window.StoryGame.site, st = site.structures.habitat, s = site.habitatStages ? site.habitatStages() : null;
  let pule = st.piecePools ? Object.values(st.piecePools).reduce((a, p) => a + p.hp, 0) : st.hp;
  for (const h of site.dock.layout.highrises || []) { const q = site.structures[h.structure]; if (q) pule += Math.max(0, q.hp || 0); }
  return { etapy: s ? \`wyłom \${s.breach}/\${s.breachNeed} wieża \${s.tower ? 1 : 0} wieżowce \${s.highrises}/\${s.highrisesTotal}\` : null,
    zrobione: s ? s.done : null, wszystkie: s ? s.total : null, pule: Math.round(pule), hp: Math.round(st.hp),
    proc: +(100 * st.hp / Math.max(1, st.maxHp)).toFixed(1), zniszczony: !!st._destroyed3D || !(st.hp > 0) };
})()`;

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
  try { smi.stop(); ekran?.stop(); report.nvidia = smi.samples.length; writeJson(join(out, 'raport.json'), report); } catch (e) { console.error(e); }
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
  const instKod = sondaInstaluj({ kazdaKlatka: KAZDA_KLATKA });
  for (let i = 0; i < 20 && inst !== 'ok' && inst !== 'już'; i++) { await sleep(500); inst = await wkEval(instKod).catch((e) => e.message); }
  console.log('sonda:', inst, KAZDA_KLATKA ? '(znaczniki GPU w każdej klatce)' : '(brama znaczników Core3D jak w grze)');
  report.sondaKazdaKlatka = KAZDA_KLATKA;
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
  await startWoksele();
  await sleep(4000);
  await okno('przed', 6, { slad: true });
  await screenshotPng(cdp, join(out, '01-przed.png'));
  // --seria S: kadr co S s od pierwszej serii do końca (seria-000.png…), do oglądania ruchu. Zaburza czasy, więc nie do pomiarów.
  if (Number(args.seria) > 0) {
    let nr = 0, busy = false;
    setInterval(() => {
      if (busy) return;
      busy = true;
      screenshotPng(cdp, join(out, `seria-${String(nr++).padStart(3, '0')}.png`)).catch(() => {}).finally(() => { busy = false; });
    }, Number(args.seria) * 1000);
  }
  if (BALAST_GB > 0) {
    balast = await startVramBallast({ gb: BALAST_GB });
    report.balast = { info: balast.info, gb: BALAST_GB };
    console.log('balast VRAM:', JSON.stringify(balast.info), 'nvidia:', JSON.stringify(await stanMaszyny()));
    await sleep(3000);
    await okno('przed-balast', 6, { slad: true });
  }

  // ostrzał seriami po etapach finału — do śmierci habitatu (komplet etapów), HP ≤ PROG %, limitu strzałów albo zastoju
  let strzaly = 0, n = 0, sladSrodek = false, postep = Infinity, bezPostepu = 0;
  const etapy0 = await ev(ETAPY);
  console.log('etapy start:', JSON.stringify(etapy0));
  report.etapy = [{ n: 0, strzaly: 0, ...etapy0 }];
  for (;;) {
    await tagGpu(`seria-${n + 1}`);
    const seria = await ev(SERIA, 30000);
    strzaly += seria.n;
    n++;
    const hp = (await ev(PAGE_STATE)).hp;
    const sladTu = n === 1 || (!sladSrodek && hp !== null && hp < 65);
    if (n > 1 && sladTu) sladSrodek = true;
    const row = await okno(`ostrzal-${n}`, 2, { slad: sladTu });
    const e = await ev(ETAPY);
    row.etapy = e.etapy;
    row.cele = seria.cele;
    report.etapy.push({ n, strzaly, cele: seria.cele, ...e });
    console.log(`   etapy: ${e.etapy} | pule ${e.pule} | hp ${e.hp}${e.zniszczony ? ' | HABITAT ZNISZCZONY (finał z etapów)' : ''} | cele ${JSON.stringify(seria.cele)}`);
    if (n === 1) { await tagGpu('zrzut-pierwsze-trafienia'); await screenshotPng(cdp, join(out, '02-pierwsze-trafienia.png')); }
    const miara = e.pule - (e.zrobione || 0) * 1e6;
    if (miara < postep - 0.5) { postep = miara; bezPostepu = 0; } else bezPostepu++;
    // HP po oknie (etap „wieża” — szyja pęka i wieża pada w trakcie okna)
    if (e.zniszczony || e.proc <= PROG || strzaly >= STRZALY_MAKS || bezPostepu >= 8) {
      report.koniecOstrzalu = e.zniszczony ? 'etapy (habitat padł sam)' : e.proc <= PROG ? `HP ≤ ${PROG} %` : strzaly >= STRZALY_MAKS ? 'limit strzałów' : 'zastój';
      break;
    }
  }
  await tagGpu('zrzut-ostrzal-koniec');
  await screenshotPng(cdp, join(out, '03-ostrzal-koniec.png'));
  console.log('strzały:', strzaly, '| koniec ostrzału:', report.koniecOstrzalu);
  report.strzaly = strzaly;

  // --profil 1: profil CPU workera (Profiler CDP, 250 µs) od HP 0 przez upadek (najwyżej 40 s)
  if (args.profil === '1') {
    await wkSend('Profiler.enable');
    await wkSend('Profiler.setSamplingInterval', { interval: 250 });
    await wkSend('Profiler.start');
  }
  // HP 0 habitatu — finał misji (storyGame._chainExplosion → upadek), okna co 2 s do osiadania. Habitat żywy (ostrzał
  // przerwany przed kompletem etapów) — finał jawnie: damageStation z `direct` (jak syncBaseStages i ogień w rurach).
  report.final = await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat;
    if (st._destroyed3D || !(st.hp > 0)) return 'etapy';
    S.deps.damageStation(st, st.hp + 10, true);
    return st._destroyed3D || !(st.hp > 0) ? 'jawny (damageStation direct)' : 'BEZ FINAŁU hp ' + Math.round(st.hp); })()`);
  console.log('finał:', report.final);
  await noteObce('po ostrzale');
  // okna upadku jedno za drugim do osiadania — bez pauz (pole GPU po osiadaniu) i śladu w trakcie (--slad tylko w przed,
  // ostrzale i nad gruzem); zrzut po uderzeniu dysku ma własny znacznik sondy
  // --stronaStart <plik>: wyrażenie JS na stronie gry w chwili HP 0, --stronaKoniec <plik>: po oknach upadku, wynik w strona-koniec.json. Na zacięcia strony: long-animation-frame.
  if (args.stronaStart) await ev(readFileSync(String(args.stronaStart), 'utf8'));
  const tFall = Date.now();
  let i = 0, zrzutUpadku = false;
  while (Date.now() - tFall < 60000) {
    i++;
    // --sladUpadek 1: ślad Chrome po trzech pierwszych oknach upadku, na zacięcia strony w chwili uderzeń (zaburza czasy tych okien).
    const r = await okno(`upadek-${i}`, 2, { slad: Number(args.sladUpadek) > 0 && i <= 3 });
    if (!zrzutUpadku && r.uderzenieDysku >= 0) { zrzutUpadku = true; await tagGpu('zrzut-upadek'); await screenshotPng(cdp, join(out, '04-upadek.png')); }
    if (r.upadek === 'settled' || r.zamrozony) break;
    if (args.profil === '1' && Date.now() - tFall > 40000) break;
  }
  if (args.profil === '1') {
    const { profile } = await wkSend('Profiler.stop', {}, 120000);
    writeFileSync(join(out, 'worker-upadek.cpuprofile'), JSON.stringify(profile));
    console.log('profil workera:', join(out, 'worker-upadek.cpuprofile'));
  }
  if (args.stronaKoniec) writeJson(join(out, 'strona-koniec.json'), await ev(readFileSync(String(args.stronaKoniec), 'utf8'), 60000).catch((e) => String(e)));
  // osiadłe w żywym świecie — do podsumowania misji (zamrożenie świata: StoryGame._freeze 'summary')
  for (let k = 1; k <= 10; k++) {
    const st = await ev(PAGE_STATE);
    if (st.zam || st.podsum) { report.zamrozenie = { po_s: +((Date.now() - tFall) / 1000).toFixed(1), ft: st.ft, powody: st.powody, podsumowanie: st.podsum }; break; }
    await okno(`osiadle-${k}`, 2);
  }
  if (!report.zamrozenie) {
    // podsumowanie jeszcze nie przyszło — czekamy najwyżej 15 s (ogień w rurach, 3 s czasu gry po „yardVictory”)
    await tagGpu('czekanie-podsumowania');
    const tW = Date.now();
    while (Date.now() - tW < 15000) {
      const st = await ev(PAGE_STATE);
      if (st.zam || st.podsum) { report.zamrozenie = { po_s: +((Date.now() - tFall) / 1000).toFixed(1), ft: st.ft, powody: st.powody, podsumowanie: st.podsum }; break; }
      await sleep(250);
    }
  }
  console.log('zamrożenie świata po upadku:', JSON.stringify(report.zamrozenie || 'brak w 15 s'));
  await noteObce('po upadku');
  if (ODMROZ && report.zamrozenie) {
    // jawne odmrożenie: bez powodu 'summary' pętla gry wraca do kroków fizyki; skrypt misji dalej czeka na zamknięcie
    // podsumowania (misja 2 nie rusza); panel schowany jak po zamknięciu
    report.odmrozenie = await ev(`(() => { const S = window.StoryGame, f0 = window.__frameId | 0;
      const usuniete = S._freeze.delete('summary');
      const w = document.querySelector('.st-summary-wrap'); if (w) w.style.display = 'none';
      return { usuniete, powodyPo: [...S._freeze], zamrozony: !!S.worldFrozen, frameId: f0 }; })()`);
    await sleep(500);
    report.odmrozenie.frameIdPo500ms = await ev('window.__frameId | 0');
    console.log('odmrożenie:', JSON.stringify(report.odmrozenie));
  }
  await poleGpu('po-osiadaniu');
  await tagGpu('zrzut-po-upadku');
  await screenshotPng(cdp, join(out, '05-po-upadku.png'));
  await okno('po', CZAS_PO);
  // Atlas nad środkiem bazy, kamera statku (gracz lata nad gruzem)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(0, 0); S.deps.placePlayer(p.x, p.y + 600, 0); window.ship.vel.x = 0; window.ship.vel.y = 0;
    const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM_GRUZ}; return true; })()`).catch((e) => console.log('przelot:', e.message));
  await tagGpu('przelot');
  await sleep(2500);
  await okno('nad-gruzem', 8, { slad: true });
  await tagGpu('zrzut-nad-gruzem');
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
  // GPU na klatkę wszystkich okien sondy (z przerwami) — czekamy na rozliczenie ostatnich klatek (opóźnienie kolejki)
  try {
    await tagGpu('koniec');
    await sleep(800);
    await zbierzGpu(6000);
    await noteObce('koniec');
    console.log('\nGPU ms na klatkę (klatki pełne; p50 / p95 / maks.) — okno: klatek (pełne) | render | compute | suma | top etykiety');
    for (const [name, o] of Object.entries(report.gpuOkna)) {
      const row = report.okna.find((r) => r.okno === name);
      console.log(`  ${name.padEnd(26)} ${String(o.klatek).padStart(5)} (${String(o.pelne).padStart(5)})${o.gotowe ? '' : ' NIEGOTOWE'}`
        + ` | ${fmtQ(o.render).padEnd(20)} | ${fmtQ(o.compute).padEnd(20)} | ${fmtQ(o.suma).padEnd(20)}`
        + `${row ? ` | ft ${row.ftOd}→${row.ft} ${row.upadek}${row.zamrozony ? ' ZAMR' : ''}` : ''}`
        + ` | ${o.etykietyRender.slice(0, 3).map((w) => `${w[0]} ${w[1]}`).join(', ')}; ${o.etykietyCompute.slice(0, 2).map((w) => `${w[0]} ${w[1]}`).join(', ')}`);
    }
  } catch (e) { report.bledy.push('zbierzGpu: ' + String(e?.message || e)); }
  if (balast) { report.balastKoniec = await balast.stan().catch(() => null); }
  if (report.woksele) report.woksele.koniec = await wkEval('globalThis.__wokGra.stan()').catch((e) => String(e));
  report.syncPipeline = await wkEval('globalThis.__wokSync || null').catch((e) => String(e));
  console.log('woksele koniec:', JSON.stringify(report.woksele?.koniec), '| pipeline synchroniczne po rozgrzewce:', JSON.stringify(report.syncPipeline));
  if (args.wkKoniec) writeJson(join(out, 'wk-koniec.json'), await wkEval(readFileSync(String(args.wkKoniec), 'utf8')).catch((e) => String(e)));
  // --sonda 1: „co to świeci?” na końcu misji. Każda grupa widocznych siatek sceny (po nazwie materiału) gaśnie osobno na jeden kadr: sonda-NNN.png, spis w sonda.json, wzór porównania: różnica z sonda-baza.png.
  if (Number(args.sonda) > 0) {
    try {
      const grupy = await wkEval(`(() => { const g = new Map(); globalThis.__C3.scene.traverse((o) => { if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return; for (let p = o; p; p = p.parent) if (!p.visible) return; const k = o.material?.name || o.material?.type || '?'; if (!g.has(k)) g.set(k, []); g.get(k).push(o); }); globalThis.__sonda = [...g.entries()]; return globalThis.__sonda.map(([k, l]) => ({ k, n: l.length, warstwy: l[0].layers.mask, nazwa: l[0].name || l[0].parent?.name || '', x: l[0].matrixWorld.elements[12], y: l[0].matrixWorld.elements[13], z: l[0].matrixWorld.elements[14], ile: l[0].count ?? l[0].geometry?.instanceCount ?? 0 })); })()`);
      writeJson(join(out, 'sonda.json'), grupy);
      await screenshotPng(cdp, join(out, 'sonda-baza.png'));
      for (let i = 0; i < grupy.length; i++) {
        await wkEval(`(() => { for (const o of globalThis.__sonda[${i}][1]) { o.__maska = o.layers.mask; o.layers.mask = 0; } return true; })()`);
        await sleep(400);
        await screenshotPng(cdp, join(out, `sonda-${String(i).padStart(3, '0')}.png`));
        await wkEval(`(() => { for (const o of globalThis.__sonda[${i}][1]) o.layers.mask = o.__maska; return true; })()`);
      }
      console.log('sonda:', grupy.length, 'grup');
    } catch (e) { report.bledy.push('sonda: ' + String(e?.message || e)); }
  }
  const other =report.wkLogi.filter((l) => /warn|error|exception|pipeline sync|kompilacja w grze/.test(l.type + ' ' + l.text));
  for (const l of other.slice(0, 20)) console.log('  wk', l.type, l.s, l.text.slice(0, 220));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
