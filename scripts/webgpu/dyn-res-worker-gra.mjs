// OPCJE GRAFIKI I ROZDZIELCZOŚĆ DYNAMICZNA W TRYBIE WORKER (2026-11-05) w PRAWDZIWEJ grze, headless, czas rzeczywisty.
// `grafika-gra.mjs` czyta Core3D strony (tryb `off`) — w trybie worker Core3D strony nie ma urządzenia, więc jego liczniki
// (`gpuFrameSamples` = 0) i cele nic nie mówią. Tu stan bierze sesja CDP workera renderu (jego Core3D i moduły efektów),
// a próbki — kanał zwrotny RET, z którego korzysta sterownik strony.
//
// Sprawdza z PASS / BŁĄD:
//   1. rekord obrazu przy starcie (`?grafika=<start>`): MSAA, bloom, gaz, efekty na module workera — w menu i w grze;
//   2. presety na żywo: po `GraphicsQuality.apply` wartości w workerze = `gfxRenderRecord` tego presetu, rozmiar celu sceny
//      i kanwy workera (z niej bitmapy) = okno × skala;
//   3. sterownik: `DynamicResTune.targetFps = 10000` (budżet 0,1 ms) — skala schodzi do dna drabiny na próbkach z RET;
//      `= 2` — wraca; wyłączenie — skala z opcji. Bufor workera idzie za skalą strony;
//   4. flaga znaczników czasu w RET = `Core3D.gpuTimerSupported` workera; 0 pipeline'ów synchronicznych workera (`st.pipeSync`).
//
// Nie mierzy czasów, ale obciąża kartę i CPU: przy działającym LoL albo cudzym harnessie kończy się kodem 3 bez startu
// (`--mimo-obcych 1` — tylko gdy maszyna jest wolna, a strażnik się myli).
//
//   node scripts/webgpu/dyn-res-worker-gra.mjs [--start niska] [--presety high,low,medium,ultra,high] [--rozmiar 1600x900]
//        [--out .tmp/dyn-res-worker] [--port 5398]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';
import { gfxRenderRecord, gfxWithPreset } from '../../src/game/graphicsQuality.js';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const START = String(args.start || 'niska');
const PRESETY = String(args.presety || 'high,low,medium,ultra,high').split(',').filter(Boolean);
const out = resolve(repo, args.out || '.tmp/dyn-res-worker');
mkdirSync(out, { recursive: true });

const sh = (cmd, a) => new Promise((ok) => execFile(cmd, a, { windowsHide: true, maxBuffer: 1 << 22 }, (e, so) => ok(e ? '' : String(so))));
const obce = async () => {
  const ps = await sh('powershell', ['-NoProfile', '-Command',
    "Get-Process -Name 'League of Legends','LeagueClient' -ErrorAction SilentlyContinue | ForEach-Object { 'gra|' + $_.Name };" +
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*scripts*webgpu*' -or $_.CommandLine -like '*scripts*profil*' } | ForEach-Object { '' + $_.ProcessId + '|' + $_.CommandLine }"]);
  return ps.split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith(`${process.pid}|`)).map((l) => l.slice(0, 160));
};
const zajete = await obce();
if (zajete.length && String(args['mimo-obcych'] || '0') !== '1') {
  console.error('maszyna zajęta — bez startu:\n' + zajete.join('\n'));
  process.exit(3);
}

const report = { args, rozmiar: [W, H], start: START, obce: zajete, kroki: [], bledy: [], kontrole: [] };
const check = (nazwa, ok, szczegoly) => {
  report.kontrole.push({ nazwa, ok: !!ok, szczegoly });
  console.log(`${ok ? 'PASS' : 'BŁĄD'}  ${nazwa}${szczegoly === undefined ? '' : ' — ' + JSON.stringify(szczegoly)}`);
};

const { server, base } = await startVite(Number(args.port || 5398));
const chrome = await startChrome({ width: W, height: H });
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);

// sesja workera renderu (Target.setAutoAttach, flatten) — wzór zegar-gpu-gra.mjs
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
  if (msg.method === 'Runtime.exceptionThrown' && report.bledy.length < 40) report.bledy.push(String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text).slice(0, 300));
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0'); } catch (_) {}" });

// Stan OBRAZU z kontekstu workera: Core3D i moduły, które stosuje applyGfx.
const STAN_WORKERA = `(async () => {
  const [{ Core3D: C }, ex, wf, sj, lq, hl, hd] = await Promise.all([import('/src/3d/core3d.js'), import('/src/3d/explosions/explosionFx.js'),
    import('/src/3d/weapons/weaponFx.js'), import('/src/3d/sideJets3D.js'), import('/src/3d/hullLacquer.js'), import('/src/3d/hullLighting.js'), import('/src/3d/gasField/hallDust.js')]);
  const t = C.composerTarget;
  return { skala: C.renderScale, px: +(+C.pixelRatio).toFixed(3), pxScale: +(+C.pxScale).toFixed(3), bufor: t ? [t.width, t.height] : null, kanwa: C.canvas ? [C.canvas.width, C.canvas.height] : null,
    msaa: t ? t.samples : null, bloom: C.perfToggles?.bloom !== false, bloomSkala: C.bloomQualityScale, heat: C.perfToggles?.heatHaze !== false, smugi: C.shadowShaftsQuality,
    gaz: { ...ex.EXPLOSION_TUNE }, swiatlaSide: sj.SIDE_JET_TUNE.maxLights, gazSide: sj.SIDE_JET_TUNE.minGasPx, wyloty: wf.WeaponFx.muzzlePerFrame, trafienia: wf.WeaponFx.impactPerFrame,
    lakier: lq.HullLacquer.isEnabled(), oswietlenie: hl.HullLighting.getTuning().model, pylHal: hd.HALL_DUST_TUNE.enabled,
    probki: C.gpuFrameSamples, probkiCompute: C.gpuComputeSamples, gpuMs: +(+C.gpuFrameMs).toFixed(3), computeMs: +(+C.gpuComputeMs).toFixed(3), znaczniki: C.gpuTimerSupported,
    pipeSync: globalThis.__ST ? globalThis.__ST.pipeSync : null, klatki: globalThis.__ST ? globalThis.__ST.frames : null };
})()`;
// Stan strony: sterownik, kanał zwrotny, kanwa obrazu; Core3D strony tylko dla porównania (bez urządzenia).
const STAN_STRONY = `(() => { const h = window.RenderWorkerHost, C = window.Core3D; h.readStats(); const s = h.stats;
  return { tryb: window.__RENDER_MODE || null, preset: GraphicsQuality.preset, ...GraphicsQuality.dynamic, ret: { gpuMs: +s[0].toFixed(3), computeMs: +s[1].toFixed(3), probki: s[2], probkiCompute: s[3], skala: s[12] },
    znacznikiRet: h.gpuTimerSupported ? h.gpuTimerSupported() : null, bledyWorkera: h.errors.slice(0, 8), zlozenia: h.composed, strona: { noDevice: !!C.noDevice, probki: C.gpuFrameSamples, skala: C.renderScale },
    notka: document.querySelector('[data-gfx-dyn-now]')?.textContent || '' }; })()`;
const stan = async () => ({ w: await wkEval(STAN_WORKERA), s: await ev(STAN_STRONY) });
const rowne = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bliskoBufora = (bufor, skala) => !!bufor && Math.abs(bufor[0] - Math.floor(W * skala)) <= 1 && Math.abs(bufor[1] - Math.floor(H * skala)) <= 1;

/** Rozjazd workera względem rekordu `gfxRenderRecord` (lista pól, puste = zgodne). */
function rozjazd(w, rec) {
  const zle = [];
  const eq = (nazwa, a, b) => { if (!rowne(a, b)) zle.push(`${nazwa}: worker ${JSON.stringify(a)} ≠ opcje ${JSON.stringify(b)}`); };
  eq('skala', w.skala, rec.renderScale);
  eq('bloom', w.bloom, rec.bloom);
  eq('bloomSkala', w.bloomSkala, rec.bloomScale);
  eq('gorące powietrze', w.heat, rec.heatHaze);
  eq('lakier', w.lakier, rec.lacquer);
  eq('oświetlenie', w.oswietlenie, rec.hullLight);
  eq('pył hal', w.pylHal, rec.hallDust);
  eq('światła SIDE', w.swiatlaSide, rec.effects.sideJetLights);
  eq('gaz SIDE', w.gazSide, rec.effects.sideJetGasPx);
  eq('wyloty', w.wyloty, rec.effects.weaponMuzzles);
  eq('trafienia', w.trafienia, rec.effects.weaponImpacts);
  for (const k of Object.keys(rec.explosions)) eq(`gaz.${k}`, w.gaz[k], rec.explosions[k]);
  return zle;
}

let code = 0;
try {
  const startedAt = Date.now();
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderWorker=1&grafika=${encodeURIComponent(START)}` });
  if (!await waitFor(cdp, '!!(window.RenderWorkerHost && window.GraphicsQuality && window.ship)', 240000, 300)) throw new Error('gra nie wstała');
  if (!wk.sid) await sleep(1000);
  if (!wk.sid) throw new Error('brak sesji workera renderu');
  const presetStart = await ev('GraphicsQuality.settings');
  // Rekord obrazu zaraz po gotowym GPU (tło menu) — moment zastosowania mówi, jak długo menu rysuje się z domyślnymi
  await waitFor(cdp, '!!window.RenderWorkerHost.gpuReady()', 240000, 100);
  const tGpu = Date.now() - startedAt;
  const m0 = await wkEval(STAN_WORKERA);
  report.menuPrzyGotowymGpu = { ms: tGpu, ...m0 };
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 300);
  const m1 = await stan();
  report.menu = { ms: Date.now() - startedAt, ...m1 };
  console.log('menu przy gotowym GPU', tGpu, 'ms: bloom', m0.bloom, 'bloomSkala', m0.bloomSkala, 'smugi', m0.smugi, 'wyloty', m0.wyloty);
  console.log('menu gotowe', report.menu.ms, 'ms: bloom', m1.w.bloom, 'bloomSkala', m1.w.bloomSkala, 'smugi', m1.w.smugi, 'wyloty', m1.w.wyloty, 'znaczniki', m1.w.znaczniki, 'RET', m1.s.znacznikiRet);
  check('tryb worker: Core3D strony bez urządzenia', m1.s.strona.noDevice === true);
  { const zle = rozjazd(m1.w, gfxRenderRecord(presetStart)); check(`tło menu ?grafika=${START}: worker = opcje`, zle.length === 0, zle); }
  check('MSAA startu presetu w celu sceny workera', m1.w.msaa === (presetStart.msaa > 0 ? 4 : 0), { msaa: m1.w.msaa, opcja: presetStart.msaa });

  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  await ev(`(() => { window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100); return true; })()`);
  await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__ST = st;' }), true)`);
  await sleep(2500);

  // 1. Rekord przy starcie (w grze) i znaczniki czasu
  const g0 = await stan();
  report.grStart = g0;
  check(`start ?grafika=${START}: worker = opcje`, rozjazd(g0.w, gfxRenderRecord(presetStart)).length === 0, rozjazd(g0.w, gfxRenderRecord(presetStart)));
  check('znaczniki czasu: flaga RET = Core3D workera', g0.s.znacznikiRet === g0.w.znaczniki, { ret: g0.s.znacznikiRet, core3d: g0.w.znaczniki });
  const p0 = await stan();
  await sleep(3000);
  const p1 = await stan();
  const nowychW = p1.w.probki - p0.w.probki;
  const nowychRet = p1.s.ret.probki - p0.s.ret.probki;
  report.probki = { nowychW, nowychRet, strona: p1.s.strona.probki, gpuMsWorker: p1.w.gpuMs, gpuMsRet: p1.s.ret.gpuMs };
  check('próbki GPU workera docierają przez RET', nowychW > 0 && nowychRet > 0, report.probki);
  check('Core3D strony bez próbek (sterownik ich nie czyta)', !(p1.s.strona.probki > 0), { strona: p1.s.strona.probki });

  // 2. Presety na żywo
  const s0 = g0.w.pipeSync;
  for (const p of PRESETY) {
    await ev(`(() => { GraphicsQuality.apply('${p}'); return true; })()`);
    await sleep(1500);
    const st = await stan();
    const ust = await ev('GraphicsQuality.settings');
    const rec = gfxRenderRecord(gfxWithPreset(ust, p));
    const zle = rozjazd(st.w, rec);
    report.kroki.push({ krok: `preset ${p}`, ...st });
    check(`preset ${p}: worker = opcje`, zle.length === 0, zle);
    check(`preset ${p}: bufor ${JSON.stringify(st.w.bufor)} i kanwa ${JSON.stringify(st.w.kanwa)} = ${W}×${H} × ${rec.renderScale}`,
      bliskoBufora(st.w.bufor, rec.renderScale) && bliskoBufora(st.w.kanwa, rec.renderScale));
    check(`preset ${p}: smugi`, st.w.smugi === rec.shadowShafts || (rec.shadowShafts === 'off' && st.w.smugi === 'off'), { worker: st.w.smugi, opcja: rec.shadowShafts });
  }

  // 3. Sterownik na próbkach z RET (preset ostatni na liście — skala bazowa z opcji)
  await ev(`(() => { GraphicsQuality.apply({ dynamicRes: '60' }); DynamicResTune.targetFps = 10000; return true; })()`);
  const ladder = await ev('GraphicsQuality.dynamic.levels');
  const seria = (a) => a.filter((v, i, x) => i === 0 || v !== x[i - 1]);
  const wDol = [];
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = await stan();
    wDol.push({ skala: st.s.scale, level: st.s.level, ema: st.s.emaMs, bufor: st.w.bufor, kanwa: st.w.kanwa, skalaW: st.w.skala, skalaRet: st.s.ret.skala, probkiRet: st.s.ret.probki });
    if (st.s.level === ladder.length - 1 && st.w.skala === st.s.scale && bliskoBufora(st.w.bufor, st.s.scale)) break;
  }
  const dno = wDol[wDol.length - 1];
  report.wDol = wDol;
  console.log('w dół:', JSON.stringify(seria(wDol.map((d) => d.skala))), 'dno', JSON.stringify(dno));
  check('sterownik schodzi do dna drabiny', rowne(seria(wDol.map((d) => d.skala)).at(-1), ladder.at(-1)), { drabina: ladder, seria: seria(wDol.map((d) => d.skala)) });
  check('bufor i kanwa workera idą za skalą (dno)', dno.skalaW === dno.skala && bliskoBufora(dno.bufor, dno.skala) && bliskoBufora(dno.kanwa, dno.skala), dno);
  await sleep(600);
  const dnoObraz = await stan();
  // obraz złożony na stronie przy dnie drabiny (bitmapa niższej rozdzielczości rozciągnięta na okno CSS)
  await screenshotPng(cdp, join(out, 'dno.png'));
  check('RET: skala w użyciu = skala sterownika', dnoObraz.s.ret.skala === dno.skala, dnoObraz.s.ret.skala);

  // Zmiana innej opcji nie zeruje stopnia (skala w rekordzie = stopień sterownika)
  await ev(`(() => { GraphicsQuality.apply({ bloom: 'half' }); return true; })()`);
  await sleep(800);
  const inna = await stan();
  check('inna opcja przy stopniu sterownika: skala zostaje, bloom doszedł', inna.w.skala === dno.skala && inna.w.bloomSkala === 0.5, { skala: inna.w.skala, bloomSkala: inna.w.bloomSkala });
  await ev(`(() => { GraphicsQuality.apply({ bloom: 'full' }); DynamicResTune.targetFps = 2; return true; })()`);
  const wGore = [];
  for (let i = 0; i < 70; i++) {
    await sleep(500);
    const st = await stan();
    wGore.push({ skala: st.s.scale, level: st.s.level, ema: st.s.emaMs, bufor: st.w.bufor, skalaW: st.w.skala });
    if (st.s.level === 0 && st.w.skala === st.s.scale) break;
  }
  report.wGore = wGore;
  console.log('w górę:', JSON.stringify(seria(wGore.map((d) => d.skala))));
  check('sterownik wraca na górę drabiny', wGore.at(-1).skala === ladder[0] && wGore.at(-1).skalaW === ladder[0], { seria: seria(wGore.map((d) => d.skala)) });

  // Wyłączenie: skala z opcji; zero pipeline'ów synchronicznych przez cały przebieg
  await ev(`(() => { DynamicResTune.targetFps = 0; GraphicsQuality.apply({ dynamicRes: 'off' }); return true; })()`);
  await sleep(1200);
  const k = await stan();
  report.koniec = k;
  const ust = await ev('GraphicsQuality.settings');
  check('wyłączona: skala workera = skala z opcji', k.w.skala === ust.renderScale && bliskoBufora(k.w.bufor, ust.renderScale), { skala: k.w.skala, bufor: k.w.bufor });
  check('0 pipeline\'ów synchronicznych workera od początku gry', s0 === 0 && k.w.pipeSync === 0, { start: s0, koniec: k.w.pipeSync });
  await screenshotPng(cdp, join(out, 'koniec.png'));
  check('brak wyjątków (strona i worker)', report.bledy.length === 0 && k.s.bledyWorkera.length === 0, [...report.bledy.slice(0, 5), ...k.s.bledyWorkera]);
  report.obceKoniec = await obce();
  const zle = report.kontrole.filter((c) => !c.ok);
  console.log(`\nkontrole: ${report.kontrole.length - zle.length} / ${report.kontrole.length} PASS`);
  if (zle.length) code = 1;
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(report.blad);
  code = 2;
} finally {
  const f = join(out, 'raport.json');
  writeFileSync(f, JSON.stringify(report, null, 2));
  console.log('raport:', f);
  await chrome.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(code);
}
