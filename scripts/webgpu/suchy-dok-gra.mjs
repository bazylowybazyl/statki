// Suchy dok piratów (misja 1) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/suchy-dok-gra.mjs [--out .tmp/suchy-dok-gra] [--rozmiar 1600x900]
//
// Skok dev ?story=ram (stocznia postawiona, gracz przed torem taranu), kamera RTS bez HUD-u:
//   01 cały dok, 02 parking z okrętami (reflektory), 03 taran — Atlas na torze rozbija bramę G-W (prawdziwy krok
//   taranu gry: stepDryDockRam), 04 Atlas w rzędzie, 05 alarm — dach hali otwarty, eskorta startuje,
//   06 eskorta za bramą, 07 trafienia (progi punktów), 08–09 łańcuch rozpadu (jak po Hexlance).
// Raport: <out>/raport.json — stan doku (punkty, kawałki odpadłe), taran, eskorta, błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/suchy-dok-gra');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5374));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], bledy: [] };

// Pipeline'y three utworzone SYNCHRONICZNIE (zwykły render materiału bez rozgrzewki = przestój) — jak
// start-gry.mjs; bryła doku ma być rozgrzana na ekranie ładowania (Core3D.warmup, pirateDryDockGame.js).
const PIPE_REC = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, frame: window.__frameId | 0, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_REC });

// kamera RTS nad punktem układu doku (x wzdłuż trzonu, z w poprzek) z zoomem, bez HUD-u
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
const dockState = () => ev(`(() => {
  const S = window.StoryGame, site = S.site, st = site.station, d = st?._dock3d;
  return {
    hp: Math.round(st?.hp || 0), maxHp: st?.maxHp, alarm: !!site.alarmed, faza: S.phase, dach: d ? +d.roofFade.toFixed(2) : null,
    odpadle: d ? d.chunkState.filter((s) => s.broken || s.hidden).map((s) => s.id) : [],
    taran: !!site.gateRammed,
    eskorta: site.defenderList.map((n) => (n.dead ? 'x' : n.__dockLaunching ? 'L' : n.combatDisabled ? 'z' : 'W')).join(''),
    zaparkowane: site.parkedList.filter((n) => !n.dead).length,
    swiatla: window.Core3D?.fx?.lights?.stats?.committed ?? null
  };
})()`);
async function shot(name) {
  await sleep(Number(args.czekaj || 700));
  const st = await dockState();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(22), JSON.stringify(st));
}

const KEY4 = { key: '4', code: 'Digit4', windowsVirtualKeyCode: 52, nativeVirtualKeyCode: 52 };
const tap4 = async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY4 });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY4 });
};

// --hexlance: faza „shipyard” — Atlas 4 km przed parkingiem (stanowisko D-08) dziobem w trzon, Hexlance (4, ładowanie, 4):
// pręt trafia bryły trzonu i hali (hitShapes), próg punktów odrywa kawałek pod trafieniem.
if (args.hexlance) {
  try {
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=shipyard` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
    await sleep(1200);
    await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
    await sleep(700);
    await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'shipyard' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza shipyard nie ruszyła');
    await sleep(2000);
    await ev(`(() => {
      const S = window.StoryGame, site = S.site, d = site.dock;
      const p = d.toGame(575, 4000);
      S.deps.placePlayer(p.x, p.y, d.headingToGame(-Math.PI / 2));
      return true;
    })()`);
    await sleep(1500);
    await camHub(575, 1500, 0.09);
    const before = await dockState();
    await tap4();
    await sleep(1700);
    await tap4();
    await sleep(2600);
    await shot('20-hexlance');
    const after = await ev(`(() => { const st = window.StoryGame.site.station; return { hp: Math.round(st.hp), lastHit: Number.isFinite(st.lastHitX) ? (() => { const h = window.StoryGame.site.dock.toHub(st.lastHitX, st.lastHitY); return { x: Math.round(h.x), z: Math.round(h.z) }; })() : null }; })()`);
    report.hexlance = { before, after };
    console.log('hexlance:', JSON.stringify(report.hexlance));
    report.bledy = logs.errors().slice(0, 80);
  } catch (err) {
    report.wyjatek = String(err?.stack || err);
    console.error(err);
  } finally {
    writeJson(join(out, 'raport.json'), report);
    await chrome.close();
    await server.close();
  }
  process.exit(0);
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
  await sleep(2500);
  // gracz poza kadrem (nie zasłania doku), maskowanie wyłączone — wykrycie ustawia sam skrypt (alarm)
  const L = await ev('(() => { const l = window.StoryGame.site.dock.layout; return { z0: l.bounds.z0, z1: l.bounds.z1, cz: (l.bounds.z0 + l.bounds.z1) / 2, hall: (l.hall.backZ + l.hall.frontZ) / 2, front: l.hall.frontZ, px0: l.parking.x0, px1: l.parking.x1, lane: l.parking.laneZ }; })()');
  await camHub(0, L.cz + 200, 0.085);
  await shot('01-caly-dok');
  await camHub(0, L.lane - 300, 0.22);
  await shot('02-parking');
  // reflektory w siatce świateł gry: ile świateł doku przyjmuje kadr (pushGridLights) i ile weszło do siatki
  report.swiatla = await ev(`(() => {
    const C = window.Core3D, lights = C.fx && C.fx.lights, st = window.StoryGame.site.station, d = st._dock3d;
    if (!lights || !d) return { brak: true, fx: !!C.fx, dok: !!d };
    const n = d.pushGridLights(lights, st.dryDock.toGame);
    const p = st.dryDock.toGame(d.lights[0].x, d.lights[0].z);
    return { przyjete: n, czekajace: lights.points, enabled: lights.enabled, kadr: lights.hasView ? [lights.vx0, lights.vy0, lights.vx1, lights.vy1].map(Math.round) : null,
      pierwsze: [Math.round(p.x), Math.round(p.y)], stats: { ...lights.stats }, siatka: C.fx.grid ? C.fx.grid.count : null };
  })()`);
  console.log('światła:', JSON.stringify(report.swiatla));
  // taran: Atlas na torze, dziób 350 j. przed bramą G-W, 900 j/s wzdłuż osi doku — krok taranu gry rozbija bramę
  report.taranPrzed = await dockState();
  await ev(`(() => {
    const S = window.StoryGame, site = S.site, d = site.dock, ship = window.ship;
    const len = (ship.beamHull && ship.beamHull.srcWidth * ship.beamHull.scale) || 1800;
    const p = d.toGame(${L.px0} - 350 - len / 2, ${L.lane});
    S.deps.placePlayer(p.x, p.y, d.axis);
    ship.vel.x = Math.cos(d.axis) * 900; ship.vel.y = Math.sin(d.axis) * 900;
    return true;
  })()`);
  await camHub(L.px0 + 200, L.lane - 100, 0.3);
  await sleep(1400);
  await shot('03-taran-brama');
  await camHub(L.px0 + 900, L.lane - 100, 0.24);
  await sleep(1800);
  await shot('04-taran-rzad');
  report.taran = await ev(`(() => { const st = window.StoryGame.site.station; return { brama: !!st._dockGone?.has('G-W'), odpadle: [...(st._dockGone || [])], gateRammed: !!window.StoryGame.site.gateRammed, maskowanie: window.ship?.cloak?.state || null }; })()`);
  console.log('taran:', JSON.stringify(report.taran));
  // gracz z dala od kadrów hali
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(0, ${L.z1} + 6000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  await ev('(() => { const S = window.StoryGame; S._alarm(S.site); return true; })()');
  await camHub(0, L.hall - 300, 0.14);
  await sleep(2500);
  await shot('05-alarm-wylot');
  await camHub(0, L.front - 600, 0.11);
  await sleep(6000);
  await shot('06-eskorta-za-brama');
  // trafienia jak Hexlance w trzon przy D-03 i w halę: próg punktów → kawałek pod trafieniem odpada
  await ev(`(() => {
    const S = window.StoryGame, site = S.site, st = site.station;
    const b = site.dock.layout.berths[2];
    const hit = (x, z, dmg) => { const p = site.dock.toGame(x, z); st.lastHitX = p.x; st.lastHitY = p.y; window.applyDamageToStation(st, dmg); };
    hit(b.x, 0, 2600); hit(0, -1800, 2600); hit(1300, -3000, 2600);
    return true;
  })()`);
  await camHub(0, L.cz + 200, 0.085);
  await sleep(2500);
  await shot('07-trafienia');
  await ev(`(() => { const S = window.StoryGame; const st = S.site.station; st.lastHitX = S.site.dock.toGame(0, -2500).x; st.lastHitY = S.site.dock.toGame(0, -2500).y; window.applyDamageToStation(st, 1e6); S._chainExplosion(S.site); return true; })()`);
  await sleep(2000);
  await shot('08-rozpad-1');
  await sleep(4500);
  await shot('09-rozpad-2');
  // pipeline'y synchroniczne w grze (po pierwszej klatce gry) — osobno materiały doku (PortBuilding*, PortHullBuild)
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    const dock = sync.filter((x) => /PortBuilding|PortHullBuild|Suchy dok/.test(x.nazwa));
    return { wszystkie: (window.__pipeRec?.pipes || []).length, hak: !!window.__pipeRec, wGrze: p.length, sync: sync.length, syncDok: dock.length, listaDok: dock.slice(0, 20).map((x) => x.nazwa), lista: sync.slice(0, 30).map((x) => x.nazwa) };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
