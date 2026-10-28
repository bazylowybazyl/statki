// GPU W SCENIE BAZY PIRATÓW przy rozdzielczości monitora użytkownika — tryb gracza (render w workerze). Zgłoszenie
// 2026-10-28: „od pierwszych obrażeń habitatu klatkuje; gdy wszystko wybucha i odłamy spadają na planetoidę —
// katastrofa; PerfHUD: strona 12 kl/s, Obraz 3D (worker) 10 kl/s · CPU 5,5 · GPU 9,0 ms; karta się poci”.
// Vite + headless Chrome z WebGPU, skok dev ?story=shipyard, Atlas nieśmiertelny.
//
//   node scripts/webgpu/gpu-baza-gra.mjs [--rozmiar 5120x1440] [--out .tmp/gpu-baza] [--zoom 0.14] [--bron special_yamato_cannon]
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
// Raport: <out>/raport.json (+ zrzuty PNG). Pomiar tylko przy wolnej maszynie (stan nvidia-smi w raporcie).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { SONDA_INSTALUJ, SONDA_CZYTAJ, startNvidiaSmi, stanMaszyny, sladWatkow } from './sondaGpuWorkera.mjs';

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
const tStart = Date.now();
const watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 14 min — koniec'); finish(2); }, 14 * 60 * 1000);

const report = { args, rozmiar: [W, H], maszynaStart: await stanMaszyny(), okna: [], slady: {}, ab: [], wkLogi: [], strona: [], bledy: [] };
console.log('maszyna:', JSON.stringify(report.maszynaStart));
const smi = startNvidiaSmi(500);
const { server, base } = await startVite(Number(args.port || 5393));
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker' });
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
    if (window.fireControl) window.fireControl.posture = 'hold';
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

async function okno(label, sekundy, { slad = false } = {}) {
  const p0 = await ev(PAGE_STATE);
  if (wk.sid) { await wkEval(WK_FRAMES).catch(() => null); await wkEval(SONDA_CZYTAJ).catch(() => null); }
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  const p1 = await ev(PAGE_STATE);
  const wf = wk.sid ? await wkEval(WK_FRAMES).catch((e) => ({ err: e.message })) : null;
  const sonda = wk.sid ? await wkEval(SONDA_CZYTAJ).catch((e) => ({ err: e.message })) : null;
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
    wraki: { gorace: p1.hot, spiace: p1.sleep, odlamy: p1.wd }, raf: p1.raf, nvidia: smi.okno(t0), sonda, slad: sl ? true : undefined
  };
  report.okna.push(row);
  const so = sonda && !sonda.err ? sonda : null;
  console.log(`${label.padEnd(12)} obraz ${String(row.zlozeniaS).padStart(6)}/s  wk ${String(row.workerKlatkiS).padStart(6)}/s  cpuWk p50 ${wf?.p50 ?? '-'}`
    + `  gpuR ${so ? so.gpuRender.msNaKlatke : '-'}  gpuC ${so ? so.gpuCompute.msNaKlatke : '-'}  kolejka śr ${so ? so.sr.lat : '-'} p95 ${so ? so.p95.lat : '-'} maks ${so ? so.latMax : '-'}`
    + `  wysyłki ${so ? ((so.sr.wbB + so.sr.wtB + so.sr.ceB) / 1024).toFixed(0) + ' KB' : '-'}  nowe ${so ? ((so.sr.nbB + so.sr.ntB) / 1024).toFixed(0) + ' KB' : '-'}`
    + `  pamięć ${so ? so.pamiecMB.bufory + '+' + so.pamiecMB.tekstury + ' MB' : '-'}  disp ${so ? so.sr.disp : '-'}  rys ${so ? so.sr.draws : '-'}`
    + `  pipe s/a ${so ? so.suma.psync + '/' + so.suma.pasync : '-'}  domeny ${row.domeny}  hp ${row.hp}  GPU% ${row.nvidia ? row.nvidia.zajetosc : '-'} ${row.nvidia ? row.nvidia.pamiecMB + ' MB' : ''}`);
  if (so) {
    console.log('   render:', so.gpuRender.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
    console.log('   compute:', so.gpuCompute.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
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

  // HP 0 habitatu — finał misji (storyGame._chainExplosion → upadek), okna co 2 s do osiadania
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; S.deps.damageStation(st, st.hp + 10); return st.hp; })()`);
  const tFall = Date.now();
  let i = 0;
  while (Date.now() - tFall < 60000) {
    i++;
    const r = await okno(`upadek-${i}`, 2, { slad: i === 2 });
    if (i === 3) await screenshotPng(cdp, join(out, '04-upadek.png'));
    if (r.upadek === 'settled') break;
  }
  await screenshotPng(cdp, join(out, '05-po-upadku.png'));
  await okno('po', CZAS_PO);
  // Atlas nad środkiem bazy, kamera statku (gracz lata nad gruzem)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(0, 0); S.deps.placePlayer(p.x, p.y + 600, 0); window.ship.vel.x = 0; window.ship.vel.y = 0;
    const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM_GRUZ}; return true; })()`).catch((e) => console.log('przelot:', e.message));
  await sleep(2500);
  await okno('nad-gruzem', 8, { slad: true });
  await screenshotPng(cdp, join(out, '06-nad-gruzem.png'));

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
  const other = report.wkLogi.filter((l) => /warn|error|exception|pipeline sync|kompilacja w grze/.test(l.type + ' ' + l.text));
  for (const l of other.slice(0, 20)) console.log('  wk', l.type, l.s, l.text.slice(0, 220));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
