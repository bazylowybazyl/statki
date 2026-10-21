// Ringi-archetypy (Mars = ECUMENE, Jowisz = Fable) w PRAWDZIWEJ grze: zrzuty z kamery gry i z kamery 3D,
// geometria przekroju z układu ringu, pipeline'y synchroniczne w klatkach (ma być 0; licznik w backendzie
// three — tylko tryb `off`, w workerze backend jest poza stroną) i błędy konsoli. Gra w czasie rzeczywistym
// (bez zegara harnessu), statek przy porcie ringu (?haloTest=<ring>&haloAt=port).
//
//   node scripts/webgpu/ringi-archetypy-gra.mjs [--ringi mars,jupiter] [--out .tmp/ringi/<katalog>]
//        [--rozmiar 1600x900] [--czekaj 2500] [--query renderWorker=1] [--port 5341]
//
// Kadry (na ring): port-z02 (hala K-7 i zatoki z kamery gry), obrecz-z005 / obrecz-z02 (obręcz ringu po stronie
// Słońca, między zatoką a tranzytem — z góry widać promień obręczy i grubość ściany + kadłuba), 3d-habitat (kamera 3D
// nad habitatem — szerokość wstęgi), 3d-wzdluz (wzdłuż ringu, nisko), 3d-spod (od strony planety — spód kadłuba),
// 3d-port (kamera 3D nad portem).
// Wynik: <out>/<ring>-<kadr>.png, <out>/raport.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/ringi/zrzuty');
const waitMs = Number(args.czekaj || 2500);
const rings = String(args.ringi || 'mars,jupiter').split(',').filter(Boolean);
const query = args.query ? `&${args.query}` : '';
mkdirSync(out, { recursive: true });

const HOOK = `(() => {
  const be = window.Core3D?.renderer?.backend;
  if (!be || typeof be.createRenderPipeline !== 'function') return false;
  if (be.__ringiHook) return true;
  const list = window.__ringiSync = [];
  const orig = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (ro, promises) => {
    if (!promises && window.__ringiCount) list.push((ro.material && (ro.material.name || ro.material.type)) + ' @ ' + (ro.object && (ro.object.name || ro.object.type)));
    return orig(ro, promises);
  };
  be.__ringiHook = true;
  return true;
})()`;

// Statek i kamera: `ang` — kąt w układzie lokalnym ringu (port gracza = kąt stacji), `r` — promień od środka
// planety, kamera gry (RTS) w punkcie (camAng, camR), zoom; mode3d — kamera 3D (az względem kierunku na zewnątrz
// ringu w punkcie statku, el).
const VIEW = (key, v) => `(() => {
  const e = window.__haloWorld.entries.find((x) => x.key === '${key}');
  const L = e.collider.layout, R = L.radii, p = e.collider.place;
  const toGame = (a, r) => { const lx = Math.cos(a) * r, ly = Math.sin(a) * r; return { x: p.x + lx * p.cos - ly * p.sin, y: p.y - (lx * p.sin + ly * p.cos) }; };
  const port = ${-Math.PI / 4};
  const v = { ...${JSON.stringify(v)} };
  // 'slonce': punkt ringu po stronie Słońca (habitat w świetle), w połowie między zatoką kompleksu a tranzytem
  if (v.ang === 'slonce') {
    const dx = window.SUN.x - p.x, dy = -(window.SUN.y - p.y);
    const a = Math.atan2(-dx * p.sin + dy * p.cos, dx * p.cos + dy * p.sin) - port;
    let best = 0, bd = 1e9;
    for (let k = 0; k < 4; k++) for (const o of [-0.58, 0.58]) {
      const c = o + k * Math.PI / 2;
      const d = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
      if (d < bd) { bd = d; best = c; }
    }
    v.ang = best;
  }
  const rOf = (s) => s === 'rim+' ? R.rim + 900 : s === 'mid' ? 0.5 * (R.back + R.rim) : s === 'back-' ? R.back - 1400 : s === 'dock' ? R.rim + 2500 + 1500 : Number(s);
  const sh = toGame(port + v.ang, rOf(v.r));
  const s = window.ship;
  s.pos.x = sh.x; s.pos.y = sh.y; s.vel.x = 0; s.vel.y = 0;
  const c = window.camera;
  const zoom = () => { c.manualZoom = true; c.zoom = c.targetZoom = v.zoom; c.zoomBase = v.zoom; c.zoomVel = 0; };
  if (v.mode3d) {
    c.mode = 'ship'; c.transition = null; c.focusStation = null;
    zoom();
    c.x = c.targetX = sh.x; c.y = c.targetY = sh.y;
    // kierunek na zewnątrz ringu w układzie THREE (y gry odwrócone) → az riga (a = az − 90°)
    const ux = sh.x - p.x, uy = -(sh.y - p.y);
    const out = Math.atan2(uy, ux) * 180 / Math.PI;
    window.Game3D.setCamera('orbit');
    window.Game3D.rig.az = out + 90 + v.az;
    window.Game3D.rig.el = v.el;
    window.Game3D.rig.first = true;
  } else {
    window.Game3D.setCamera('classic');
    if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
    zoom();
    const cp = toGame(port + (v.camAng ?? v.ang), rOf(v.camR ?? v.r));
    c.x = c.targetX = cp.x; c.y = c.targetY = cp.y;
  }
  window.DevScene?.syncCamera?.();
  return true;
})()`;

const VIEWS = [
  ['port-z02', { ang: 0, r: 'dock', zoom: 0.2, camR: 'rim+' }],
  ['obrecz-z005', { ang: 'slonce', r: 'rim+', zoom: 0.05, camR: 'mid' }],
  ['obrecz-z02', { ang: 'slonce', r: 'rim+', zoom: 0.2, camR: 'mid' }],
  ['3d-habitat', { ang: 'slonce', r: 'rim+', zoom: 0.06, mode3d: true, az: 25, el: 32 }],
  ['3d-wzdluz', { ang: 'slonce', r: 'rim+', zoom: 0.08, mode3d: true, az: 82, el: 8 }],
  ['3d-spod', { ang: 'slonce', r: 'back-', zoom: 0.08, mode3d: true, az: 200, el: 30 }],
  ['3d-port', { ang: 0.02, r: 'rim+', zoom: 0.05, mode3d: true, az: 40, el: 40 }]
];

const { server, base } = await startVite(Number(args.port || 5341));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { query, rings: {}, bledy: [] };
try {
  for (const key of rings) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_camera3d', 'classic'); } catch {} })();` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&haloTest=${key}&haloAt=port${query}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && (window.Core3D.gpuReady || window.RenderWorkerHost) && window.ship)', 240000, 300)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, `!!window.__haloWorld?.entries?.find((x) => x.key === '${key}')?.collider`, 300000, 400)) throw new Error(`świat ringu ${key} nie powstał`);
    // obraz ringu: na wątku gry `__haloRings` (tryb off); w workerze stan ringu jest poza stroną — czas na budowę
    const worker = await ev('!(window.Core3D && window.Core3D.gpuReady)');
    if (!worker && !await waitFor(cdp, `!!window.__haloRings?.entries?.find((x) => x.key === '${key}')?.ring?.isReady`, 300000, 400)) throw new Error(`ring ${key} nie powstał`);
    const hook = await ev(HOOK);
    // pętla gry ruszyła (kamera eksportowana co klatkę) — w workerze start czeka dłużej na ekranie ładowania
    if (!await waitFor(cdp, '!!(window.camera && window.Game3D)', 240000, 400)) throw new Error('pętla gry nie ruszyła');
    await sleep(worker ? 25000 : 3000);
    await ev('window.__ringiCount = true');
    const geo = await ev(`(() => {
      const L = window.__haloWorld.entries.find((x) => x.key === '${key}').collider.layout;
      const r = (v) => Math.round(v);
      return { archetyp: L.archetype, szerokosc: L.width, sciany: L.wallHeight, kadlub: L.hullThickness, grubScian: L.wallThickness,
        podlogaZ: L.floor.spanZ, rim: r(L.radii.rim), floorMid: r(L.radii.floorMid), back: r(L.radii.back), grubosc: r(L.radii.rim - L.radii.back) };
    })()`);
    // Kolizje (świat gry, oba tryby): płyta [kadłub, podłoga + teren] poza tranzytami; pod kadłubem i nad
    // terenem wolno; statek w środku płyty wypchnięty.
    const kolizje = await ev(`(() => {
      const c = window.__haloWorld.entries.find((x) => x.key === '${key}').collider;
      const R = c.layout.radii, p = c.place;
      const toGame = (a, r) => { const lx = Math.cos(a) * r, ly = Math.sin(a) * r; return { x: p.x + lx * p.cos - ly * p.sin, y: p.y - (lx * p.sin + ly * p.cos) }; };
      const N = 3600;
      const n = { probki: 0, tranzyt: 0, wPlycie: 0, podKadlubem: 0, nadPodloga: 0 };
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const m = toGame(a, 0.5 * (R.back + R.floorMid));
        if (!c.pointInSlab(m.x, m.y)) { n.tranzyt++; continue; }
        n.probki++;
        const lo = toGame(a, R.back + 10), hi = toGame(a, R.floorMid - 10), under = toGame(a, R.back - 30), over = toGame(a, R.floorMid + 900);
        if (c.pointInSlab(lo.x, lo.y) && c.pointInSlab(hi.x, hi.y)) n.wPlycie++;
        if (c.pointInSlab(under.x, under.y)) n.podKadlubem++;
        if (c.pointInSlab(over.x, over.y)) n.nadPodloga++;
      }
      const g = toGame(0.6, 0.5 * (R.back + R.floorMid));
      const fake = { ...window.ship, pos: { x: g.x, y: g.y }, vel: { x: 0, y: 0 } };
      const r = c.constrainShip(fake, false);
      return { ...n, plyta: [Math.round(R.back), Math.round(R.floorMid)], wypchniety: r.hit, push: +r.floor.toFixed(1) };
    })()`);
    const rep = report.rings[key] = { worker, geo, kolizje, hook, kadry: [] };
    console.log(key, worker ? '(worker)' : '(off)', JSON.stringify(geo));
    console.log('  kolizje', JSON.stringify(kolizje));
    for (const [name, v] of VIEWS) {
      await ev(VIEW(key, v));
      await sleep(waitMs);
      await ev(VIEW(key, v));
      await sleep(600);
      const file = join(out, `${key}-${name}.png`);
      await screenshotPng(cdp, file);
      rep.kadry.push(name);
      console.log('  ', name);
    }
    await ev(`(() => { window.Game3D.setCamera('classic'); return true; })()`);
    rep.pipelineSync = await ev('(window.__ringiSync || []).slice(0, 20)');
    rep.pipelineSyncN = await ev('(window.__ringiSync || []).length');
    await ev('window.__ringiCount = false');
    console.log('  pipeline\'y synchroniczne:', rep.pipelineSyncN, hook ? '' : '(brak haka — worker)');
  }
  report.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference/.test(l)).slice(0, 20);
  if (report.bledy.length) console.log('błędy:', report.bledy.join('\n'));
} catch (err) {
  console.log('BŁĄD', err.message);
  console.log(logs.errors().slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
