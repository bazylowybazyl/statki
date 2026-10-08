// Oświetlenie kadłubów v2 w PRAWDZIWEJ grze (2026-10-06, src/3d/hullLighting.js, hullSurface.js): A/B modelu
// „pbr” (v2) i „classic” (dawny) na TEJ SAMEJ zatrzymanej klatce — Vite + headless Chrome z WebGPU (CDP),
// harness-strona.js (zegar wirtualny, ziarno, UUID z osobnego strumienia).
//
// Sceny: statyka (Atlas z bliska, Terra Nova), błyski efektów przy kadłubie (lufa, wybuch — kadłub nie
// bieleje), bitwa (prawdziwy ostrzał), noc w cieniu Ziemi (lampy, ciemne wieżyczki), ciąg MAIN (poświata dysz
// na rufie). Do tego pipeline'y utworzone SYNCHRONICZNIE (ma nie być żadnego materiału kadłuba) i błędy konsoli.
//
//   node scripts/webgpu/oswietlenie-gra.mjs [--sceny statyka,blyski,bitwa,noc,silnik] [--modele pbr,classic]
//        [--tune '{"keyIntensity":0.9}'] [--bake '{"mesoGain":10}'] [--out .tmp/oswietlenie-gra] [--port 5383]
//
// Wynik: <out>/<scena>-<model>.png, <out>/raport.json (histogram HDR klatek, statystyki wypieku, pipeline'y).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/oswietlenie-gra');
mkdirSync(out, { recursive: true });
const sceny = new Set((args.sceny || 'statyka,blyski,bitwa,noc,silnik').split(',').filter(Boolean));
const models = (args.modele || 'pbr,classic').split(',').filter(Boolean);
const tune = args.tune ? JSON.parse(args.tune) : null;
const bake = args.bake ? JSON.parse(args.bake) : null;
const DEEP = { x: 6210000, y: 5330000 };
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// Pipeline'y SYNCHRONICZNE (materiał bez rozgrzewki = przestój w klatce) — jak pyl-gra.mjs.
const PIPE_HOOK = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port: Number(args.port || 5383), strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { zrzuty: [] };
const KEYS = {
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 },
  shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }
};
const key = (k, down) => cdp.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', ...KEYS[k] });

async function shotAB(name) {
  for (const m of models) {
    await ev(`(() => { window.HullLighting.setModel('${m}'); return true; })()`);
    await ev('window.__harness.frames(3)');
    await screenshotPng(cdp, join(out, `${name}-${m}.png`));
    const hdr = await ev('window.__harness.scene.hdr(3)');
    report.zrzuty.push({ name: `${name}-${m}`, hdr });
    console.log(`${name}-${m}`.padEnd(28), JSON.stringify(hdr));
  }
  await ev(`(() => { window.HullLighting.setModel('pbr'); return true; })()`);
}

// Kadłuby gotowe (sprite'y wczytane, ciała zbudowane) i mapy powierzchni wypieczone (worker, prawdziwy czas).
const READY = `(async () => { const S = window.__harness.scene, H = window.__harness;
  for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
  for (let it = 0; it < 800; it++) {
    const all = [ship, ...(window.npcs || [])].filter((e) => e && e.beamHull && !e.dead);
    if (all.every((e) => window.HullSurface.isReady(e.beamHull.visualImage || e.beamHull.image))) break;
    await H.frames(1); await new Promise((r) => setTimeout(r, 30));
  }
  return true; })()`;
const cam = (x, y, z) => ev(`(() => { window.__harness.scene.cam(${x}, ${y}, ${z}); return true; })()`);
// Kukły poprzedniej sceny z gry (bitwa zaczyna się na pustym polu).
const KILL_NPCS = 'for (const n of (window.npcs || [])) { n.hp = 0; n.dead = true; }';
const TN = `(window.npcs || []).find((n) => !n.dead && n.type === 'battleship' && !n.isPirate)`;

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_HOOK });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\ntry { localStorage.setItem('sc_ships3d', '0'); localStorage.setItem('sc_weapons3d', '0'); localStorage.removeItem('sc_hull_light'); } catch {}\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  if (tune) await ev(`(() => { Object.assign(window.HullLighting.getTuning(), ${JSON.stringify(tune)}); return true; })()`);
  if (bake) await ev(`(() => { window.HullSurface.rebakeAll(${JSON.stringify(bake)}); return true; })()`);
  await ev(`(() => { const S = window.__harness.scene; window.__harness.reseed(0xb17b); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, -0.6); if (window.fireControl) window.fireControl.posture = 'hold';
    const s = ship; spawnCallInShip('battleship', { mode: 'dummy', spawnPos: { x: s.pos.x - 200, y: s.pos.y + 1400 }, spawnAngle: 0 });
    return true; })()`);
  await ev(READY, 400000);
  await ev(`(async () => { await window.__harness.step(4); window.__setGamePaused && window.__setGamePaused(true); return true; })()`);
  report.wypiek = await ev('JSON.parse(JSON.stringify(window.HullSurface.stats))');

  if (sceny.has('statyka')) {
    await ev(`(() => { window.__harness.scene.cam(ship.pos.x, ship.pos.y, 1.0); return true; })()`);
    await shotAB('statyka-atlas');
    await ev(`(() => { const e = ${TN}; window.__harness.scene.cam(e.x, e.y, 0.6); return true; })()`);
    await shotAB('statyka-terra-nova');
  }
  if (sceny.has('silnik')) {
    // Ciąg MAIN (W) przez ~0,8 s na wolnym polu, kamera na rufie: poświata dysz na blachę (v2) i bez niej.
    await ev(`(() => { DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0); window.__setGamePaused && window.__setGamePaused(false); return true; })()`);
    await ev('window.__harness.frames(2)');
    await key('w', true);
    await ev('window.__harness.step(50)');
    report.silnik = await ev(`(() => ({ v: Math.round(Math.hypot(ship.vel.x, ship.vel.y)), pauza: !!window.PAUSED, dysze: window.EngineFrame ? window.EngineFrame.count : null }))()`);
    console.log('silnik', JSON.stringify(report.silnik));
    await ev(`(() => { const a = ship.angle; window.__harness.scene.cam(ship.pos.x - Math.cos(a) * 1200, ship.pos.y - Math.sin(a) * 1200, 0.9); return true; })()`);
    await shotAB('silnik-rufa');
    await key('w', false);
    await ev(`(() => { window.__setGamePaused && window.__setGamePaused(true); return true; })()`);
  }
  if (sceny.has('blyski')) {
    // Błysk lufy (moc 14, zasięg 560) i wybuch (16, 800) przy kadłubie Terra Nova — długie życie, bez zaniku.
    for (const [name, dx, dy, p, range, z] of [['blysk-lufa', 120, -60, 14, 560, 50], ['blysk-wybuch', -250, 80, 16, 800, 60]]) {
      await ev(`(() => { const e = ${TN}; window.__harness.scene.cam(e.x, e.y, 0.6);
        Core3D.fx.lights.flash(e.x + ${dx}, e.y + ${dy}, 1.0, 0.75, 0.45, ${p}, ${range}, 5, 0.001, 0, ${z}); return true; })()`);
      await shotAB(name);
      await ev('(() => { Core3D.fx.lights.flashes = 0; return true; })()');
    }
  }
  if (sceny.has('bitwa')) {
    await ev(`(() => { window.__setGamePaused && window.__setGamePaused(false); if (window.fireControl) window.fireControl.posture = 'free';
      ${KILL_NPCS}
      const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
      spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(2600, -300), spawnAngle: Math.PI });
      spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(2200, 900), spawnAngle: Math.PI });
      spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1300), spawnAngle: 0 });
      return true; })()`);
    await ev(READY, 400000);
    for (let k = 0; k < 3; k++) {
      await ev('window.__harness.step(40)');
      await ev(`(() => { window.__harness.scene.cam(ship.pos.x + 1200, ship.pos.y + 300, 0.3); return true; })()`);
      await shotAB(`bitwa${k}`);
    }
    await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'hold'; ${KILL_NPCS} window.__setGamePaused && window.__setGamePaused(true); return true; })()`);
  }
  if (sceny.has('noc')) {
    report.noc = await ev(`(async () => { const earth = planets.find((p) => p.id === 'earth' || p.name === 'earth'); const sun = window.SUN;
      const dx = earth.x - sun.x, dy = earth.y - sun.y, L = Math.hypot(dx, dy);
      const px = earth.x + dx / L * 45500, py = earth.y + dy / L * 45500;
      DevScene.teleport(px, py, 0.4);
      return { x: Math.round(px), y: Math.round(py) }; })()`);
    await ev(`(async () => { window.__setGamePaused && window.__setGamePaused(false); await window.__harness.step(3); window.__setGamePaused && window.__setGamePaused(true); return true; })()`);
    report.noc.slonce = await ev('Core3D.sunVisibilityAtWorld(ship.pos.x, ship.pos.y)');
    await ev(`(() => { window.__harness.scene.cam(ship.pos.x, ship.pos.y, 1.0); return true; })()`);
    await shotAB('noc-atlas');
  }
  report.pipeline = await ev(`(() => { const p = window.__pipeRec.pipes; const s = p.filter((x) => x.sync);
    return { wszystkie: p.length, sync: s.length, syncKadlub: s.filter((x) => /^hull:/.test(x.nazwa)).length, lista: s.map((x) => x.nazwa).slice(0, 40) }; })()`);
  console.log('pipeline', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().filter((l) => !/favicon\.ico/.test(l)).slice(0, 40);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
