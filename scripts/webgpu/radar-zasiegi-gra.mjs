// Zasięg radarów — prototyp w PRAWDZIWEJ grze (?radarZasiegi, docs/PLAN-zasieg-czujnikow.md): scena DevScene.radar
// (Atlas z eskortą, czata piratów w kadrze, Corvus i flota poza wzrokiem), harness w trybie hold (kroki tylko przez
// __harness.step). Każdy wygląd oceny obustronnej (wachlarz / struna / błona) w tych samych ujęciach: kadr floty, kadr statku,
// tuż przed progiem (+ klatki ruchu), wykryty, cicha praca, bliski kadr (wrogowie poza kadrem), mapa CIC. Stan obrazu czujników,
// koszt nakładki (ms rysunku, każdy wygląd), pipeline'y SYNCHRONICZNE (ma być 0) i błędy konsoli.
//
//   node scripts/webgpu/radar-zasiegi-gra.mjs [--out .tmp/radar-zasiegi/gra] [--rozmiar 1600x900] [--query renderWorker=1]
//     [--wyglad wachlarz,struna,blona]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/radar-zasiegi/gra');
const query = args.query ? `&${args.query}` : '';
const LOOKS = (args.wyglad || 'wachlarz,struna,blona').split(',');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5463));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { scena: null, zrzuty: {}, klatki: null, pipeline: null, bledy: [] };
const STEP = 1000 / 60;

async function shot(name, opis) {
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, stan: await ev('window.RadarZasiegi.stan()') };
  console.log('zrzut', name.padEnd(24), JSON.stringify(report.zrzuty[name].stan));
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`
      + `window.__HARNESS_SEED__ = ${0x5eed7a11};\n${INJECT}`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&radarZasiegi=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && (window.Core3D.noDevice ? !!window.RenderWorkerHost : window.Core3D.gpuReady !== false) && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  await ev('window.DevScene.preloadHullSprites()');
  await ev('window.__harness.reseed(0x5eed7a12)');
  const begLog = await ev('window.__harness.frameLog.n');
  report.scena = await ev('window.DevScene.radar({})');
  console.log('scena:', JSON.stringify(report.scena));
  report.koszt = {};
  for (const look of LOOKS) {
    const P = (n) => `${look}-${n}`;
    await ev(`window.RadarZasiegi.wyglad('${look}')`);
    await ev(`(() => { window.DevScene.radar({}); window.DevScene.syncCamera(); return true; })()`);
    await ev(`window.__harness.step(150, ${STEP})`);
    await shot(P('1-kadr-floty'), 'Kadr floty: Atlas, czata 30 km (sięga 78% drogi), Corvus i flota — KONTAKT');
    // kadr statku (kamera gry za statkiem)
    await ev(`(() => { window.DevScene.radar({ kadr: 'statek', viewWidth: 30000 }); window.DevScene.syncCamera(); return true; })()`);
    await ev(`window.__harness.step(120, ${STEP})`);
    await shot(P('2-daleko'), 'Kamera za statkiem, czata 78% drogi');
    // tuż przed progiem: 5 km bliżej — 94% drogi; klatki ruchu
    await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x + 5000, s.pos.y, 0); window.DevScene.syncCamera(); return true; })()`);
    await ev(`window.__harness.step(90, ${STEP})`);
    await shot(P('3-tuz-przed-progiem'), 'Atlas 5 km bliżej — czata sięga 94% drogi');
    await ev(`window.__harness.step(5, ${STEP})`);
    await shot(P('3b-ruch'), 'Te same warunki, 5 kroków później');
    // wykryty: jeszcze 4 km bliżej
    await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x + 4000, s.pos.y, 0); window.DevScene.syncCamera(); return true; })()`);
    await ev(`window.__harness.step(20, ${STEP})`);
    await shot(P('4-wykryty-chwila'), 'Chwila po wykryciu (próg przekroczony 20 kroków temu)');
    await ev(`window.__harness.step(120, ${STEP})`);
    await shot(P('4-wykryty'), 'Wykryty, po ustaleniu');
    // cicha praca (prototyp): sygnatura × 0,5
    await ev('window.RadarZasiegi.cisza(true)');
    await ev(`window.__harness.step(60, ${STEP})`);
    await shot(P('5-cisza'), 'Cicha praca: sygnatura × 0,5 — znak wroga krótszy, znów poza zasięgiem');
    await ev('window.RadarZasiegi.cisza(false)');
    // bliski kadr: wrogowie poza kadrem
    await ev(`(() => { window.DevScene.radar({ kadr: 'statek', viewWidth: 9000 }); window.DevScene.syncCamera(); return true; })()`);
    await ev(`window.__harness.step(90, ${STEP})`);
    await shot(P('6-bliski-kadr'), 'Bliski kadr: wrogowie poza kadrem — znak wroga przy krawędzi');
    // CIC — warstwa ZASIĘGI
    await ev(`(() => { window.DevScene.radar({ kadr: 'statek' }); window.CICDisplay.open(); window.CICDisplay.setView({ zoom: ${W} / 170000, panX: 38000, panY: 0 }); return true; })()`);
    await ev(`window.__harness.step(30, ${STEP})`);
    await shot(P('7-cic'), 'Mapa CIC, warstwa ZASIĘGI');
    await ev(`(() => { window.CICDisplay.setView({ zoom: 0.08, panX: 0, panY: 0 }); return true; })()`);
    await ev(`window.__harness.step(10, ${STEP})`);
    await shot(P('7b-cic-blisko'), 'Mapa CIC przy domyślnym zoomie: znak poza sylwetką kadłuba');
    report.cic = await ev('window.CICDisplay.coverageStats()');
    await ev('(() => { window.CICDisplay.close(); return true; })()');
    await ev(`window.__harness.step(5, ${STEP})`);
    // koszt nakładki (zegar wirtualny harnessu stoi — pomiar prawdziwym zegarem): 200 rysunków, 50 przebudów obrazu, średnio w ms
    report.koszt[look] = await ev(`(() => { const R = window.RadarZasiegi, now = window.__harness.realNow;
      const ctx = document.getElementById('c').getContext('2d');
      let t0 = now(); for (let i = 0; i < 200; i++) R.overlay.draw(ctx, R.picture, R.view); const draw = (now() - t0) / 200;
      t0 = now(); for (let i = 0; i < 50; i++) R.przebuduj(); const rebuild = (now() - t0) / 50;
      return { rysunekMs: +draw.toFixed(3), przebudowaMs: +rebuild.toFixed(3) }; })()`);
  }
  const fs = await ev(`window.__harness.frameStats(${begLog})`);
  report.klatki = fs;
  report.pipeline = fs?.pipeline || null;
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 30);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error('BŁĄD', report.blad);
} finally {
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(report, null, 1) + '\n');
  await chrome.close();
  await server.close();
}
console.log('koszt nakładki:', JSON.stringify(report.koszt), 'pipeline sync:', report.pipeline?.sync, 'błędy:', report.bledy.length, report.bledy.slice(0, 4).join(' | '));
process.exit(report.blad ? 1 : 0);
