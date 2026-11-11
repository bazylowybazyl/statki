// Czujniki w PRAWDZIWEJ grze (2026-11-11, reguła kontakt-czujnikow): misja 1 po przylocie (?story=scout) — kamera nigdzie
// nie leci, gracz trzyma PPM (prawdziwe zdarzenia myszy CDP) i czujka pokazuje bazę piratów; Alt + PPM otwiera menu
// rozkazów. Zrzuty, stan widoku (window.Czujka), obraz czujników (grupy, obserwatorzy, kontakty), pipeline'y SYNCHRONICZNE
// strony i workera (ma być 0), błędy konsoli i workera.
//
//   node scripts/webgpu/czujniki-gra.mjs [--out .tmp/czujniki/gra] [--rozmiar 1600x900] [--query renderWorker=1] [--zoom 0.05]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/czujniki/gra');
const query = args.query ? `&${args.query}` : '';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5477));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {}, pipeline: null, workerSync: [], workerBledy: [], bledy: [] };

// dziennik workera renderu (pipeline'y sync w klatkach, wyjątki)
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sessionId = msg.params.sessionId;
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const stan = () => ev(`(() => {
  const C = window.Czujka, V = C.view, S = window.StoryGame, P = window.RadarZasiegiPicture || null;
  const I = C.wejscie;
  const cam = window.camera, s = window.ship;
  return {
    faza: S.phase, kino: !!S.cinematic, cel: S.ui.objective?.text || null, podpowiedz: S.ui.hint?.spec?.title || null,
    kamera: { x: Math.round(cam.x), y: Math.round(cam.y), zoom: +cam.zoom.toFixed(4), odStatku: Math.round(Math.hypot(cam.x - s.pos.x, cam.y - s.pos.y)) },
    trzymany: C.input.held, vis: +V.vis.toFixed(3), phi: +V.phi.toFixed(3), amp: +V.amp.toFixed(2), det: +V.det.toFixed(2),
    grupy: V.stats.groups, wNamiarze: V.stats.inBeam, kontakty: V.stats.contacts, ciala: V.stats.bodies,
    wejscie: { active: I[1], nStr: I[14], nBln: I[15], nGrn: I[16], nKon: I[17], strunaOn: I[18] },
    render: C.render.stats ? { ...C.render.stats } : null,
    dbg: { show: C.inp.show, on: C.inp.on, blokada: S.blocksInput, zamrozony: S.worldFrozen, obrazGotowy: C.picture.ready, wersja: C.picture.version,
      wiedza: C.picture.knowList.length, grupyObrazu: C.picture.threats.n, obserwatorzy: C.picture.watchers.n, rekordy: C.picture.n,
      poziomy: C.picture.knowList.slice(0, 6).map((k) => k.level + '/' + k.themLvl) }
  };
})()`);

async function shot(name, opis) {
  await sleep(450);
  await waitFor(cdp, '!window.RenderWorkerHost || window.RenderWorkerHost.ring.lastComposed >= window.RenderWorkerHost.lastPostedK - (window.RenderWorkerHost.pacing ? window.RenderWorkerHost.pacer.age : 0)', 5000, 50);
  await screenshotPng(cdp, join(out, `${name}.png`));
  const st = await stan();
  report.zrzuty[name] = { opis, ...st };
  console.log('zrzut', name.padEnd(22), JSON.stringify(st));
}

// punkt ekranu w kierunku świata (kąt) od statku, `r` px
const aimPoint = (ang, r = 260) => ev(`(() => {
  const s = window.ship, cam = window.camera, rect = document.getElementById('c').getBoundingClientRect();
  const sx = rect.left + rect.width / 2 + (s.pos.x - cam.x) * cam.zoom, sy = rect.top + rect.height / 2 + (s.pos.y - cam.y) * cam.zoom;
  return { x: sx + Math.cos(${ang}) * ${r}, y: sy + Math.sin(${ang}) * ${r} };
})()`);
const mouse = (type, p, button = 'none', modifiers = 0) => cdp.send('Input.dispatchMouseEvent', {
  type, x: p.x, y: p.y, button, buttons: button === 'right' && type !== 'mouseReleased' ? 2 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers
});

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); } catch (e) {}\n`
      + `window.__HARNESS_SEED__ = ${0x5eed4c21};\n${INJECT}\n`
      // czas prawdziwy (prawdziwe zdarzenia myszy, dialog i fabuła w czasie gry); harness tylko liczy pipeline'y
      + `window.__harness.clock.mode = 'real';\n`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=scout${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.Czujka)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'scout' && document.getElementById('loading')?.classList.contains('hidden')", 300000, 400)) throw new Error('faza scout nie ruszyła');
  const begLog = await ev('window.__harness?.frameLog?.n || 0');
  await sleep(3500);
  // --blisko 21: Atlas podstawiony tyle km od bazy (na prostej warp → baza) — kontakty bazy w kadrze przy oddaleniu
  if (args.blisko) {
    await ev(`(() => { const S = window.StoryGame, b = S.site.building, s = window.ship;
      const a = Math.atan2(b.y - s.pos.y, b.x - s.pos.x), d = ${Number(args.blisko)} * 1000;
      window.DevScene.teleport(b.x - Math.cos(a) * d, b.y - Math.sin(a) * d, a); window.DevScene.syncCamera?.(); return true; })()`);
    await sleep(2500);
  }
  if (args.zoom) await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom)}; return true; })()`);
  // dialog radia (XO) nie blokuje myszy; zamknięcie, gdyby był w trybie sceny
  await shot('01-po-przylocie', 'po wyjściu z warpa: kamera przy Atlasie, bez przelotu; granice i kontakty (bez PPM)');
  report.baza = await ev(`(() => { const S = window.StoryGame, b = S.site.building, s = window.ship;
    return { odl: Math.round(Math.hypot(b.x - s.pos.x, b.y - s.pos.y)), kat: +Math.atan2(b.y - s.pos.y, b.x - s.pos.x).toFixed(3) }; })()`);
  console.log('baza:', JSON.stringify(report.baza));
  // PPM w bok od bazy (pusto), potem przeciągnięcie na bazę
  const away = await aimPoint(report.baza.kat + 2.2);
  await mouse('mouseMoved', away);
  await mouse('mousePressed', away, 'right');
  await sleep(900);
  await shot('02-czujka-w-bok', 'PPM trzymany w bok od bazy: błona, struna prawie prosta');
  const toBase = await aimPoint(report.baza.kat);
  for (let k = 1; k <= 8; k++) {
    const a = report.baza.kat + 2.2 * (1 - k / 8);
    await mouse('mouseMoved', await aimPoint(a), 'right');
    await sleep(70);
  }
  await mouse('mouseMoved', toBase, 'right');
  await sleep(1200);
  await shot('03-czujka-na-baze', 'PPM na bazę: zęby grupy w namiarze, struna drga');
  await mouse('mouseReleased', toBase, 'right');
  await sleep(900);
  await shot('04-puszczony', 'PPM puszczony — czujka gaśnie');
  // Alt + PPM — menu rozkazów (czujka się nie zapala)
  const p = await aimPoint(report.baza.kat + 1.2, 180);
  await mouse('mouseMoved', p, 'none', 1);
  await mouse('mousePressed', p, 'right', 1);
  await sleep(500);
  await shot('05-alt-ppm-menu', 'Alt + PPM: menu rozkazów świata, czujka zgaszona');
  await mouse('mouseReleased', { x: p.x + 400, y: p.y + 300 }, 'right', 1);
  await sleep(300);
  // kto ma mnie (themLvl > 0) i kogo ja mam: rodzaj, stacja, znacznik fabuły, zasilanie, moc, odległość
  report.kto = await ev(`(() => { const P = window.Czujka.picture, s = window.ship;
    return P.knowList.filter((k) => k.themLvl > 0 || k.level > 0).slice(0, 80).map((k) => ({
      typ: k.e.type || k.e.shipFrame || '?', stacja: !!k.e.isStation, nazwa: k.e.name || k.e.label || k.e.id || null,
      klucze: (k.e.type || k.e.shipFrame) ? undefined : Object.keys(k.e).slice(0, 24).join(','), tag: k.e.__storyTag || null, zasilanie: k.e.shipPower ? k.e.shipPower.state : 'brak',
      oni: k.themLvl, ja: k.level, moc: Math.round(k.strength), d: Math.round(Math.hypot((k.e.pos?.x ?? k.e.x) - s.pos.x, (k.e.pos?.y ?? k.e.y) - s.pos.y)) })); })()`);
  const maja = report.kto.filter((k) => k.oni > 0);
  console.log('mają mnie:', JSON.stringify(maja.slice(0, 12)), 'razem', maja.length, '/ znanych', report.kto.length);
  report.picture = await ev(`(() => { const s = window.Czujka.view; return { grupy: [...s.groups.values()].map((g) => ({ id: g.id, d: Math.round(g.d), R: Math.round(g.R), Rv: Math.round(g.Rv), lvl: g.lvl, myLvl: g.myLvl, nBig: g.nBig, nSmall: g.nSmall, est: g.est })) }; })()`);
  console.log('grupy:', JSON.stringify(report.picture));
  report.klatki = await ev(`window.__harness?.frameStats ? window.__harness.frameStats(${begLog}) : null`);
  report.pipeline = report.klatki?.pipeline || null;
  report.pipeSyncStrona = await ev(`(() => (window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))()`);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error('BŁĄD', report.blad);
} finally {
  report.workerSync = workerLogs.filter((l) => l.includes('pipeline sync')).slice(0, 40);
  report.workerBledy = workerLogs.filter((l) => /\[error\]|\[exception\]|czujnik/i.test(l)).slice(0, 40);
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 40);
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(report, null, 1) + '\n');
  console.log('pipeline sync strony:', JSON.stringify(report.pipeSyncStrona), 'workera:', report.workerSync.length, 'błędy:', report.bledy.length, report.bledy.slice(0, 5).join(' | '));
  if (report.workerBledy.length) console.log('worker:', report.workerBledy.slice(0, 6).join(' | '));
  await chrome.close();
  await server.close();
}
