// SŁOŃCE w PRAWDZIWEJ grze (DirectSun, planet3d.assets.js; promień i studnia — SYSTEM_MAP_CONSTANTS w
// src/data/systemMap.js): zatrzymana klatka, kamera na środku tarczy, nad tarczą, przy brzegu w kilku zoomach, na brzegu
// studni (tu kończy się skok) i Atlas przy brzegu z HUD-em. Kadry liczone od promienia SUN.r, więc ten sam skrypt robi
// „przed” i „po” zmianie rozmiaru. Koszt GPU kadru ze słońcem i bez (Core3D.gpuFrameMs — tylko tryb off), pipeline'y
// synchroniczne w klatkach (ma być 0) i błędy strony → wynik-<tag>.json.
//
//   node scripts/webgpu/slonce-gra.mjs [--tag po] [--out .tmp/slonce] [--tylko srodek,brzeg-z0035] [--port 5356]
//        [--query renderWorker=1]  (tryb gracza: render w workerze — kadry te same, bez pomiaru GPU)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5356);
const out = resolve(repo, args.out || '.tmp/slonce');
const tag = String(args.tag || 'gra');
const query = args.query ? `&${args.query}` : '';
const worker = /renderWorker=1/.test(query);
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// at — punkt kamery w promieniach słońca od środka (x w prawo), off — dodatkowe j. świata w tę stronę; zoom gry wprost
// albo fit — pół wysokości kadru w promieniach słońca; ship — pancernik Terra Nova w punkcie kamery (skala; Atlasa w doku K-7
// teleport nie rusza), kurs na środek słońca; cost — koszt GPU.
const VIEWS = [
  { name: 'srodek', at: 0, zoom: 0.035, cost: true },
  { name: 'cale', at: 0, fit: 1.15 },
  { name: 'nad-tarcza', at: 0.75, zoom: 0.035 },
  { name: 'brzeg-z0035', at: 1, off: 9000, zoom: 0.035, cost: true },
  { name: 'brzeg-z015', at: 1, off: 2600, zoom: 0.15 },
  { name: 'brzeg-z05', at: 1, off: 700, zoom: 0.5 },
  { name: 'brzeg-z15', at: 1, off: 250, zoom: 1.5 },
  { name: 'studnia', at: 'well', zoom: 0.035 },
  { name: 'statek', at: 1, off: 7000, zoom: 0.11, ship: true, hud: true },
  // mapa CIC: widok układu (najdalsza orbita) i zbliżenie — tarcza ~240 px promienia
  { name: 'cic-uklad', cic: 'uklad' },
  { name: 'cic-slonce', cic: 240 }
];

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { tag, tryb: worker ? 'worker' : 'off', zrzuty: {} };
mkdirSync(out, { recursive: true });
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}__${tag}.png`), Buffer.from(data, 'base64'));
};
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  await ev('(() => { window.setFogOfWar?.(false); return true; })()');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  // cała tarcza wymaga zoomu poniżej limitu gry (syncCameraZoomLimits przepisuje minZoom co klatkę — tu stała)
  await ev(`(() => { Object.defineProperty(window.camera, 'minZoom', { get: () => 0.0005, set: () => {}, configurable: true });
    window.camera.maxZoom = 8; return true; })()`);
  const begLog = await ev('window.__harness.frameLog.n');
  // studnia słońca jak w grze (sunWellRadius z systemMap.js; przed nią — dawne 2 · r)
  result.slonce = await ev(`(async () => {
    const s = window.SUN;
    const m = await import('/src/data/systemMap.js');
    const well = typeof m.sunWellRadius === 'function' ? m.sunWellRadius(s) : Math.max(10, s.r * 2);
    return { x: s.x, y: s.y, r: s.r, studnia: { r: well, rIn: s.r } };
  })()`);
  console.log('słońce', JSON.stringify(result.slonce));

  for (const v of VIEWS) {
    if (only && !only.has(v.name)) continue;
    if (v.cic) {
      const info = await ev(`(() => {
        const s = window.ship, S = window.SUN, C = window.CICDisplay;
        let m = 1e5;
        for (const p of window.planets || []) if (p && p.orbitRadius > m) m = p.orbitRadius;
        const z = ${JSON.stringify(v.cic)} === 'uklad' ? Math.min(innerWidth, innerHeight) * 0.42 / (m * 1.2) : ${Number(v.cic) || 0} / S.r;
        C.open();
        C.setView({ zoom: z, panX: S.x - s.pos.x, panY: S.y - s.pos.y });
        return { zoom: +z.toExponential(3) };
      })()`);
      await ev('window.__harness.frames(40)');
      await shot(v.name);
      await ev('(() => { window.CICDisplay.close(); return true; })()');
      await ev('window.__harness.frames(4)');
      result.zrzuty[v.name] = info;
      console.log(' ', v.name.padEnd(14), JSON.stringify(info));
      continue;
    }
    const info = await ev(`(() => {
      const v = ${JSON.stringify(v)};
      const s = window.SUN;
      const R = Math.max(1, Number(s.r) || 1);
      const well = ${JSON.stringify(result.slonce.studnia)};
      const d = v.at === 'well' ? (well ? well.r : R * 2) : v.at * R + (v.off || 0);
      const x = s.x + d, y = s.y;
      const zoom = v.zoom ?? 540 / (v.fit * R);
      window.__harness.scene.hideHud(!v.hud);
      if (v.ship) window.spawnCallInShip?.('battleship', { mode: 'friendly', spawnPos: { x, y }, spawnAngle: Math.PI });
      window.__harness.scene.cam(x, y, zoom);
      return { R, d: Math.round(d), zoom: +zoom.toFixed(5) };
    })()`);
    if (v.ship) {
      for (let i = 0; i < 200 && !(await ev('window.__harness.scene.hullsReady()')); i++) await ev('window.__harness.frames(2)');
    }
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(8)');
    await shot(v.name);
    if (v.cost && !worker) {
      info.gpu = await ev(`(async () => {
        const e = (window._entities || []).find((q) => q.mesh && q.mesh.name === 'SunMesh');
        if (!e) return { blad: 'brak DirectSun' };
        // mediana zegara GPU (Core3D.gpuFrameMs — próbka co gpuTimerSampleEvery klatek); zastygły zegar (jedna wartość) — null
        const sample = async () => {
          const xs = [];
          for (let i = 0; i < 30; i++) { await window.__harness.frames(6); const g = window.Core3D.gpuFrameMs; if (Number.isFinite(g) && g > 0) xs.push(g); }
          if (new Set(xs).size < 3) return null;
          xs.sort((a, b) => a - b);
          return +xs[Math.floor(xs.length / 2)].toFixed(3);
        };
        const on = await sample();
        e.group.visible = false;
        const off = await sample();
        e.group.visible = true;
        const on2 = await sample();
        return { ze: on, bez: off, ze2: on2 };
      })()`);
    }
    result.zrzuty[v.name] = info;
    console.log(' ', v.name.padEnd(14), JSON.stringify(info));
  }
  result.pipeline = (await ev(`window.__harness.frameStats(${begLog})`)).pipeline;
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, `wynik-${tag}.json`), JSON.stringify(result, null, 2) + '\n');
console.log('wynik →', out);
console.log('pipeline:', JSON.stringify(result.pipeline));
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
