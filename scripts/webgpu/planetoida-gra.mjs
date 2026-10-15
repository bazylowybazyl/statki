// Planetoida pod bazą piratów (misja 1, prośba użytkownika 2026-10-15) w PRAWDZIWEJ grze: Vite + headless Chrome
// z WebGPU (CDP). Skała, osada na tarasie i winda kosmiczna z habitatu (src/3d/portBuildings/pirateRock*.js,
// src/3d/pirateRock3D.js, src/3d/pirateRockFx3D.js).
//
//   node scripts/webgpu/planetoida-gra.mjs [--out .tmp/planetoida-gra] [--rozmiar 1600x900] [--mgla 0|1]
//        [--tryb kadry,zawalenie,habitat,3d] [--czekaj 900]
//
// Skok dev ?story=ram (baza postawiona), kamera RTS bez HUD-u:
//   kadry      01 nad habitatem (zoom 0,2 — kadr domyślny), 02 nad osadą (0,2), 03 oddalenie (0,08), 04 cała baza ze
//              skałą (0,035), 05 z przedpola gracza (−8 km, 0,12 — lina spod dysku z boku)
//   zawalenie  window.PirateRock.collapse() (sam scenariusz, bez rozpadu habitatu): kadry 0,5 / 2 / 3,5 / 5,5 / 8 / 14 s
//              nad osadą — lina i głowica spadają, kabiny, wybuchy budowli; stan liny (uderzenia, sen)
//   habitat    rozpad habitatu (applyDamageToStation) → storyGame._chainExplosion zrywa windę (zależność rockCollapse)
//   3d         kamera taktyczna (K) przy habitacie — skała pod bazą w perspektywie
// Raport <out>/raport.json: stan osady i liny, pipeline'y synchroniczne w klatkach gry (ma być 0 dla skały, osady
// i wybuchów: MoonSurface:hidalgo, PortBuilding*, PirateRockFire / Smoke), błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/planetoida-gra');
const tryby = new Set(String(args.tryb || 'kadry,zawalenie,habitat,3d').split(','));
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], bledy: [] };

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

// kamera RTS nad punktem układu bazy (x wzdłuż osi, z w poprzek) z zoomem, bez HUD-u
const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  window.Game3D?.setCamera?.('classic');
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
const rockState = () => ev(`(() => {
  const r = window.PirateRock?.state?.();
  if (!r) return null;
  const s = r.site, sim = s.sim;
  return {
    zawalenie: s.collapseT >= 0 ? +s.collapseT.toFixed(2) : null,
    lina: { zerwana: sim.snapped, dol: sim.bottomFree, spi: sim.sleeping, glowica: sim.headHit, czas: +sim.time.toFixed(1) },
    kabiny: Array.from(s.climberGone), wybuchy: s.stats.blasts, uderzenia: s.stats.impacts,
    budowle: s.buildings.filter((b) => b.start >= 0).map((b) => b.id),
    widoczna: { skala: r.rock.root.visible && !!r.rock.root.parent, osada: s.root.visible && !!s.root.parent },
    ksztalt: r.rock.shapeReady
  };
})()`);
async function shot(name, wait = Number(args.czekaj || 900)) {
  await sleep(wait);
  const st = await rockState();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(26), JSON.stringify(st));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  const fog = String(args.mgla ?? '0') === '1' ? '1' : '0';
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '${fog}'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
  await sleep(2500);
  const G = await ev(`(() => {
    const r = window.PirateRock.state(), L = r.site.rock, l = window.StoryGame.site.dock.layout;
    return { foot: { x: L.foot[0], z: L.foot[2] }, center: { x: L.center[0], z: L.center[2] }, cx: l.center.x, cz: l.center.z };
  })()`);
  // gracz z dala od kadrów (bez alarmu)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-16000, -6000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  if (tryby.has('kadry')) {
    await camHub(0, 0, 0.2);
    await shot('01-habitat');
    await camHub(G.foot.x, G.foot.z, 0.2);
    await shot('02-osada');
    await camHub(G.foot.x * 0.5, G.foot.z * 0.5, 0.08);
    await shot('03-oddalenie');
    await camHub((G.cx + G.center.x) / 2, (G.cz + G.center.z) / 2, 0.035);
    await shot('04-baza-i-skala');
    await camHub(-8000, 0, 0.12);
    await shot('05-z-przedpola');
  }
  if (tryby.has('3d')) {
    await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-2600, 3800); S.deps.placePlayer(p.x, p.y, d.axis + 0.9); window.ship.vel.x = 0; window.ship.vel.y = 0; const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera('tactical'); return window.Game3D?.mode; })()`);
    await shot('06-kamera-3d', 2500);
    await ev(`(() => { window.Game3D?.setCamera('classic'); const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-16000, -6000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  }
  if (tryby.has('zawalenie')) {
    await camHub(G.foot.x * 0.6, G.foot.z * 0.6, 0.11);
    await sleep(600);
    report.zawalenieStart = await ev('window.PirateRock.collapse()');
    const t0 = Date.now();
    for (const t of [0.5, 2, 3.5, 5.5, 8, 14]) {
      const wait = Math.max(0, t * 1000 - (Date.now() - t0));
      await shot(`07-zawalenie-${String(t).replace('.', '_')}s`, wait);
    }
    report.zawalenie = await rockState();
  }
  if (tryby.has('zawalenie3d')) {
    // kamera taktyczna (K) przy habitacie: lina pęka pod głowicą, odskakuje ku osadzie i spada na skałę
    await ev('(() => { window.PirateRock.state().site.reset(); return true; })()');
    await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-2600, 3800); S.deps.placePlayer(p.x, p.y, d.axis + 0.9); window.ship.vel.x = 0; window.ship.vel.y = 0; const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera('tactical'); return window.Game3D?.mode; })()`);
    await sleep(2000);
    await ev('window.PirateRock.collapse()');
    const t0 = Date.now();
    for (const t of [1, 2.5, 4.5, 7, 12]) {
      const wait = Math.max(0, t * 1000 - (Date.now() - t0));
      await shot(`10-zawalenie-3d-${String(t).replace('.', '_')}s`, wait);
    }
    await ev(`(() => { window.Game3D?.setCamera('classic'); const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-16000, -6000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  }
  if (tryby.has('habitat')) {
    // nowa gra przywróciłaby osadę; tu: rozpad habitatu i sprawdzenie, że winda zrywa się z nim (zależność rockCollapse)
    if (tryby.has('zawalenie')) await ev('(() => { window.PirateRock.state().site.reset(); return true; })()');
    await camHub(G.foot.x * 0.5, G.foot.z * 0.5, 0.09);
    await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; st.lastHitX = st.x; st.lastHitY = st.y; window.applyDamageToStation(st, 1e7); return true; })()`);
    await shot('08-habitat-rozpad-3s', 3000);
    await shot('09-habitat-rozpad-9s', 6000);
    report.habitat = await rockState();
  }
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    const rock = sync.filter((x) => /hidalgo|PirateRock|Osada|PortBuilding/.test(x.nazwa));
    return { wGrze: p.length, sync: sync.length, syncSkala: rock.length, listaSkala: rock.slice(0, 20).map((x) => x.nazwa), lista: sync.slice(0, 30).map((x) => x.nazwa) };
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
