// Audyt zasięgów czujników jednostek w PRAWDZIWEJ grze (2026-11-11, docs/AUDYT-zasiegi-jednostek-2026-11-11.md, reguła
// zasieg-czujnikow): ?radarZasiegi, scena RadarZasiegi.scenaJednostek() — każdy rodzaj jednostki wezwań (okręty, myśliwce,
// holownik, kadłuby ruchu v2) jako uśpieni piraci na pierścieniach 4 / 9 / 16 / 30 / 60 km wokół Atlasa; do tego dron
// zwiadu (źródło bez bytu). Dla każdego bytu: moc, sygnatura, wzrok i ich źródła (gałąź awaryjna?), promienie kontaktu i
// wzroku w obie strony, poziomy z odległości kontra poziomy obrazu czujników; pipeline'y SYNCHRONICZNE (ma być 0), błędy.
//
//   node scripts/webgpu/zasiegi-jednostek-gra.mjs [--out .tmp/zasiegi-jednostek] [--query renderWorker=1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zasiegi-jednostek');
const query = args.query ? `&${args.query}` : '';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5467));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { scena: null, tabela: null, problemy: [], pipeline: null, bledy: [] };
const STEP = 1000 / 60;

function check(tab) {
  const P = report.problemy;
  for (const r of tab.wiersze) {
    if (r.zle?.length) P.push(`${r.nazwa}: złe wartości ${r.zle.join(', ')}`);
    if (r.awaryjne?.length) P.push(`${r.nazwa}: gałąź awaryjna ${r.awaryjne.join(', ')} (${JSON.stringify(r.zrodla)})`);
    const p = r.para;
    if (!p) continue;
    for (const k of ['ichR', 'ichId', 'mojR', 'mojId']) if (!(Number.isFinite(p[k]) && p[k] > 0)) P.push(`${r.nazwa}: ${k} = ${p[k]}`);
    // poziomy z odległości
    const lvl = (d, R, id) => (d <= id ? 2 : d <= R ? 1 : 0);
    if (lvl(p.d, p.ichR, p.ichId) !== p.ichPoziom) P.push(`${r.nazwa}: ichPoziom ${p.ichPoziom} ≠ z odległości`);
    if (lvl(p.d, p.mojR, p.mojId) !== p.mojPoziom) P.push(`${r.nazwa}: mojPoziom ${p.mojPoziom} ≠ z odległości`);
    if (r.obraz) {
      if (r.obraz.ichPoziom !== p.ichPoziom) P.push(`${r.nazwa}: obraz ichPoziom ${r.obraz.ichPoziom} ≠ ${p.ichPoziom}`);
      // strona gracza wie co najmniej tyle, ile sam gracz (wzrok mgły ma margines kadłuba — identyfikacja może przyjść wcześniej)
      if (r.obraz.mojPoziom < p.mojPoziom) P.push(`${r.nazwa}: obraz mojPoziom ${r.obraz.mojPoziom} < ${p.mojPoziom}`);
      if (r.obraz.bezTwarzy !== (r.obraz.mojPoziom === 0 && r.obraz.ichPoziom > 0)) P.push(`${r.nazwa}: obserwator bez twarzy niezgodny`);
    }
  }
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
  report.scena = await ev('window.RadarZasiegi.scenaJednostek({})');
  console.log('scena:', JSON.stringify(report.scena));
  // MAŁY STATEK (mechanika obustronna): czujniki gracza na chwilę jak myśliwca (8 km) — wrogowie z dalszym czujnikiem mają
  // mnie, a ja ich nie: sama granica (obserwatorzy bez twarzy); bliscy — X-y albo cały okręt. Przed dronem zwiadu (25 km
  // wzroku — wykrywałby wrogów za gracza); wzrok gracza w mgle też jak małego statku (5 km).
  await ev(`(() => { const s = window.ship; window.__rzSensors = s.sensors; s.sensors = { passiveRange: 8000, activeRange: 10000, lockRange: 8000, role: 'combat', visionRange: 5000 }; return true; })()`);
  await ev(`window.__harness.step(30, ${STEP})`);
  report.tabela3 = await ev('window.RadarZasiegi.jednostki()');
  check(report.tabela3);
  report.malyStatek = {
    obserwatorzy: report.tabela3.obserwatorzy.length,
    bezTwarzy: report.tabela3.wiersze.filter((r) => r.obraz?.bezTwarzy).map((r) => `${r.nazwa} ${r.para.d}`),
    widzeOniNie: report.tabela3.wiersze.filter((r) => r.obraz && r.obraz.mojPoziom > 0 && r.obraz.ichPoziom === 0).length
  };
  if (!report.malyStatek.obserwatorzy) report.problemy.push('mały statek: brak obserwatorów bez twarzy');
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, '3-maly-statek.png'));
  await ev(`(() => { window.ship.sensors = window.__rzSensors; return true; })()`);
  // dron zwiadu 25 km przed Atlasem (źródło bez bytu)
  report.dron = await ev(`(() => { const s = window.ship; return window.launchSpotterDrone(s.pos.x + 12000, s.pos.y); })()`);
  await ev('window.DevScene.syncCamera()');
  await ev(`window.__harness.step(180, ${STEP})`);
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, '1-scena.png'));
  report.tabela = await ev('window.RadarZasiegi.jednostki()');
  report.liczby = {
    wierszy: report.tabela.wiersze.length,
    bezZasiegow: report.tabela.wiersze.filter((r) => r.zle?.length).length,
    awaryjne: report.tabela.wiersze.filter((r) => r.awaryjne?.length).length,
    doDecyzji: report.tabela.wiersze.filter((r) => r.decyzja?.length).length
  };
  check(report.tabela);
  // te same jednostki z bliska i z daleka: Atlas przesunięty o 20 km — inne poziomy
  await ev(`(() => { const s = window.ship; window.DevScene.teleport(s.pos.x + 20000, s.pos.y, 0); window.DevScene.syncCamera(); return true; })()`);
  await ev(`window.__harness.step(60, ${STEP})`);
  report.tabela2 = await ev('window.RadarZasiegi.jednostki()');
  check(report.tabela2);
  await ev('window.__harness.frames(2)');
  await screenshotPng(cdp, join(out, '2-przesuniety.png'));
  const fs = await ev(`window.__harness.frameStats(${begLog})`);
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
const T = report.tabela;
if (T) {
  console.log(`gracz: ${JSON.stringify(T.gracz)}; wierszy ${T.wiersze.length}, grup ${T.grupy.length}, obserwatorów bez twarzy ${T.obserwatorzy.length}`);
  for (const r of T.wiersze) {
    const p = r.para;
    console.log(`${String(r.nazwa).padEnd(26)} ${String(r.strona).padEnd(8)} moc ${String(r.moc).padStart(6)} syg ${String(r.sygnatura).padEnd(5)} wzrok ${String(r.wzrok).padStart(6)}`
      + (p ? ` | d ${String(p.d).padStart(6)} ONI ${p.ichR}/${p.ichId}→${p.ichPoziom} JA ${p.mojR}/${p.mojId}→${p.mojPoziom}` : '')
      + (r.obraz ? ` | obraz ja ${r.obraz.mojPoziom} oni ${r.obraz.ichPoziom}${r.obraz.bezTwarzy ? ' BEZ TWARZY' : ''}` : '')
      + (r.awaryjne?.length ? `  AWARYJNE: ${r.awaryjne.join(',')}` : '') + (r.decyzja?.length ? `  DECYZJA: ${r.decyzja.join(',')}` : ''));
  }
}
console.log('liczby:', JSON.stringify(report.liczby));
console.log('mały statek:', JSON.stringify(report.malyStatek));
console.log('problemy:', report.problemy.length, report.problemy.slice(0, 40).join('\n  '));
console.log('pipeline sync:', report.pipeline?.sync, 'błędy:', report.bledy.length, report.bledy.slice(0, 4).join(' | '));
process.exit(report.blad ? 1 : 0);
