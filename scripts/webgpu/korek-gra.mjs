// Elektrownia „KOREK” w wielkim gryzie Ziemi w PRAWDZIWEJ grze (src/3d/earthBitePlant*.js w DirectPlanet,
// planet3d.assets.js; Ziemia obraca się wokół osi ringu — src/3d/earthSpin.js): zatrzymana klatka, doba ustawiona tak,
// żeby gryz był pod kątem `angle` na tarczy, słońce w płaszczyźnie gry z fazą `phase` względem południka gryzu
// (0 — południe, 90 — terminator, 180 — północ), kamera na planecie / wcięciu / odbiorniku. Zrzuty `<kadr>__<tag>.png`,
// koszt GPU elektrowni (Core3D.gpuFrameMs: włączona / wyłączona w tej samej klatce), pipeline'y synchroniczne
// i błędy konsoli → wynik-<tag>.json.
//
//   node scripts/webgpu/korek-gra.mjs [--tag v1] [--out .tmp/korek/gra] [--tylko gryz,odbiornik] [--port 5355]
//        [--query renderWorker=1]  (tryb gracza: render w workerze — bez ustawiania kadrów, sam przegląd i liczniki)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5355);
const out = resolve(repo, args.out || '.tmp/korek/gra');
const tag = String(args.tag || 'gra');
const query = args.query ? `&${args.query}` : '';
const worker = /renderWorker=1/.test(query);
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// center: 'planet' | 'bite' (wcięcie) | 'hub' (odbiornik); half — pół wysokości kadru [R Ziemi] albo zoom gry wprost
const VIEWS = [
  { name: 'ziemia', angle: 20, phase: 35, center: 'planet', half: 1.25 },
  { name: 'ziemia-noc', angle: 20, phase: 165, center: 'planet', half: 1.25 },
  { name: 'gryz', angle: 20, phase: 25, center: 'bite', half: 0.45, cost: true },
  { name: 'gryz-terminator', angle: 20, phase: 88, center: 'bite', half: 0.45 },
  { name: 'gryz-noc', angle: 20, phase: 160, center: 'bite', half: 0.45 },
  { name: 'odbiornik', angle: 20, phase: 30, center: 'hub', half: 0.16 },
  { name: 'odbiornik-noc', angle: 20, phase: 165, center: 'hub', half: 0.16 },
  { name: 'odbiornik-zoom03', angle: 20, phase: 30, center: 'hub', zoom: 0.3 },
  { name: 'gryz-gora', angle: 90, phase: 40, center: 'bite', half: 0.45 },
  { name: 'gryz-dol-zoom01', angle: 250, phase: 20, center: 'bite', zoom: 0.1 }
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
  await ev('window.__harness.scene.hideHud(true)');
  await ev('(() => { window.camera.minZoom = 0.003; window.camera.maxZoom = 8; return true; })()');
  const begLog = await ev('window.__harness.frameLog.n');
  result.rozgrzewka = await ev(`(() => {
    const w = window.Core3D?.warmup?.stats;
    const g = (w?.grupy || []).find?.((x) => /KOREK/.test(x.name || x.nazwa || ''));
    return { flushMs: w?.flush ?? null, korek: g || null };
  })()`);

  if (worker) {
    // tryb gracza: render w workerze — kadr z planetą (kamera gry), liczniki
    const p = await ev(`(() => { const p = planets.find((q) => q.id === 'earth'); return p ? { x: p.x, y: p.y } : null; })()`);
    await ev(`window.__harness.scene.cam(${p.x}, ${p.y}, ${540 / (1.25 * 37800)})`);
    await ev('window.__harness.frames(30)');
    await shot('ziemia-worker');
    result.zrzuty['ziemia-worker'] = {};
  } else {
    for (let i = 0; i < 300; i++) {
      if (await ev(`(() => { const e = (window._entities || []).find((q) => q.name === 'earth'); return !!(e && e.plant); })()`)) break;
      await ev('window.__harness.frames(2)');
    }
    for (const v of VIEWS) {
      if (only && !only.has(v.name)) continue;
      const info = await ev(`(() => {
        const v = ${JSON.stringify(v)};
        const D = Math.PI / 180;
        const p = planets.find((q) => q.id === 'earth');
        const e = (window._entities || []).find((q) => q.data === p);
        if (!e || !e.plant) return { blad: 'brak Ziemi z elektrownią' };
        const R = e.group.scale.x;
        // kąt gryzu na tarczy: obrót doby wokół osi ringu = obrót wokół Z sceny o kąt doby
        const C = e.uniforms.uBite.value;
        e._spinY = 0; e._orient(null);
        const q = e.mesh.quaternion;
        const c0 = { x: C.x, y: C.y, z: C.z };
        const rot = (o) => {
          const x = o.x, y = o.y, z = o.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
          const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
          return { x: ix * qw + iw * -qx + iy * -qz - iz * -qy, y: iy * qw + iw * -qy + iz * -qx - ix * -qz, z: iz * qw + iw * -qz + ix * -qy - iy * -qx };
        };
        const a0 = Math.atan2(rot(c0).y, rot(c0).x);
        e._spinY = v.angle * D - a0; e._orient(null);
        const cw = rot(c0);
        const hubR = e.plant.look.hubRadius;
        const gx = e.group.position.x, gy = -e.group.position.y;
        // słońce w płaszczyźnie gry: kierunek gryzu na ekranie obrócony o fazę (scena y = −y gry)
        window.__sunSaved ??= { x: SUN.x, y: SUN.y };
        const s0 = window.__sunSaved;
        const dS = Math.hypot(s0.x - p.x, s0.y - p.y);
        const sa = (v.angle + v.phase) * D;
        SUN.x = p.x + Math.cos(sa) * dS; SUN.y = p.y - Math.sin(sa) * dS;
        let x = p.x, y = p.y;
        if (v.center === 'hub') { x = gx + cw.x * hubR * R; y = gy - cw.y * hubR * R; }
        if (v.center === 'bite') { const k = Math.hypot(cw.x, cw.y) || 1; x = gx + cw.x / k * 0.97 * R; y = gy - cw.y / k * 0.97 * R; }
        const zoom = v.zoom ?? 540 / (v.half * R);
        window.__harness.scene.cam(x, y, zoom);
        return { R: Math.round(R), spin: +e._spinY.toFixed(4), zoom: +zoom.toFixed(5), gryz: [+cw.x.toFixed(3), +cw.y.toFixed(3), +cw.z.toFixed(3)] };
      })()`);
      if (info.blad) throw new Error(info.blad);
      await ev('window.__harness.frames(12)');
      await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
      await ev('window.__harness.frames(6)');
      await shot(v.name);
      if (v.cost) {
        // koszt GPU elektrowni: ta sama klatka z elektrownią i bez (średnia z próbek zegara GPU)
        info.gpu = await ev(`(async () => {
          const e = (window._entities || []).find((q) => q.name === 'earth');
          const sample = async () => {
            const xs = [];
            for (let i = 0; i < 24; i++) { await window.__harness.frames(4); const g = window.Core3D.gpuFrameMs; if (Number.isFinite(g) && g > 0) xs.push(g); }
            xs.sort((a, b) => a - b);
            return xs.length ? +xs[Math.floor(xs.length / 2)].toFixed(3) : null;
          };
          const on = await sample();
          e.plant.group.visible = false;
          const off = await sample();
          e.plant.group.visible = true;
          const on2 = await sample();
          return { z: on, bez: off, z2: on2 };
        })()`);
      }
      result.zrzuty[v.name] = info;
      console.log(' ', v.name.padEnd(20), JSON.stringify(info));
    }
    await ev('(() => { const s = window.__sunSaved; if (s) { SUN.x = s.x; SUN.y = s.y; } return true; })()');
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
console.log('wynik →', out, JSON.stringify({ pipeline: result.pipeline, bledy: (result.bledy || []).length, rozgrzewka: result.rozgrzewka }));
for (const l of (result.bledy || []).slice(0, 6)) console.log('  błąd:', l.slice(0, 300));
process.exit(result.blad ? 1 : 0);
