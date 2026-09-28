// Pas asteroid w PRAWDZIWEJ grze (zadanie 21): sceny pola w miejscach scen dema
// dema/asteroidy-webgpu (te same wzory miejsc: world.js dema liczy je z tego samego pola),
// zrzuty, statystyki pasa, błędy konsoli / walidacji WebGPU, kolizja z olbrzymem.
//
//   node scripts/webgpu/asteroidy-gra.mjs [--out katalog] [--port 5355] [--sceny pole,noc,burza,olbrzym]
//        [--rozmiar 1920x1080] [--klatki 30] [--kolizja] [--wydajnosc]
//
// Strona dostaje harness (scripts/webgpu/harness-strona.js: zegar wirtualny, Math.random
// z ziarnem, klatki na żądanie). Miejsca: `SPOTS` / `FIELD_GIANTS` z dema/asteroidy-webgpu/
// world.js (import w stronie — pole dema = pole gry: ten sam pas, ziarno, skala, słońce).
// --kolizja: statek gracza leci w ścianę olbrzyma — pozycja przed / po, głębokość wbicia.
// --wydajnosc: czas rzeczywisty w gęstym polu (bez i z bitwą 12 × 12), mediana próbek.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5355);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/21/gra');
const warmFrames = Number(args.klatki || 30);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SEED = 0x5eed1234;
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

// Sceny: js — ciało funkcji async w stronie (W = world.js dema, S = pomocniki harnessu,
// H = harness, B = pas gry). Wzory miejsc i zoom jak `setScene` dema.
export const BELT_SCENES = {
  pole: {
    opis: 'Gęste pole (scena 5 dema): Atlas w rdzeniu pola, kąt −0,4, zoom 1',
    js: `const s = W.SPOTS.field; DevScene.teleport(s.x, s.y, -0.4); S.cam(s.x, s.y, 1.0);`
  },
  noc: {
    opis: 'Głąb pola — noc (scena 7 dema): najciemniejszy punkt linii przelotu, dziób od słońca, zoom 0,6',
    js: `await W.precomputeOcclusion(); const s = W.findDeepSpot(); DevScene.teleport(s.x, s.y, W.FLIGHT.angle); S.cam(s.x, s.y, 0.6);`
  },
  burza: {
    opis: 'Burza (scena 0 dema): skały energetyczne w mroku, piorun wymuszony przed dziobem, zoom 0,4',
    js: `await W.precomputeOcclusion(); const s = W.findStormSpot() || W.SPOTS.field; DevScene.teleport(s.x, s.y, s.angle || 0); S.cam(s.x, s.y, 0.4);`,
    burza: true
  },
  olbrzym: {
    opis: 'Olbrzym w polu (scena 4 dema): Labirynt na obrzeżu gęstego pola, statek u wlotu trasy, zoom 0,3',
    js: `const g = W.FIELD_GIANTS[0]; const plan = (await import('/src/game/asteroidGiants.js')).buildGiantPlan(g.id, g.seed);
         const r = plan.routes[0].pts; const x = g.x + r[0][0], y = g.y + r[0][1];
         DevScene.teleport(x, y, Math.atan2(r[1][1] - r[0][1], r[1][0] - r[0][0])); S.cam(x, y, 0.3);`,
    olbrzym: true
  }
};

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { server, base } = await startVite(port);
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 240000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), sceny: [] };
  try {
    const uuid = await osobneLosowanieUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${SEED};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    if (!await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready)', 120000, 400)) throw new Error('pas nie wstał');
    report.uuid = uuid;
    report.start = await ev(`(() => { const B = window.__asteroidBelt; return { initMs: B.initMs, gpuMs: B.gpuMs, olbrzymy: B.giants.entries.map((e) => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y) })) }; })()`);
    await ev('window.__harness.hold(true)');
    await ev(`(async () => { window.__W = await import('/dema/asteroidy-webgpu/world.js'); return true; })()`);
    const only = args.sceny ? new Set(args.sceny.split(',')) : null;
    for (const [id, sc] of Object.entries(BELT_SCENES)) {
      if (only && !only.has(id)) continue;
      logs.clear();
      const t0 = Date.now();
      let error = null;
      try {
        await ev(`(async () => { const W = window.__W, S = window.__harness.scene, H = window.__harness, B = window.__asteroidBelt; S.hideHud(true); H.reseed(0x21a5); ${sc.js} await H.step(2); S.cam(window.ship.pos.x, window.ship.pos.y, window.camera.zoom); return true; })()`);
        if (sc.olbrzym) {
          // Siatka olbrzyma liczy się w workerach (prawdziwy czas) — czekamy na gotowy widok.
          await ev('window.__harness.frames(4)');
          if (!await waitFor(cdp, `(() => { const B = window.__asteroidBelt; return B.giants.entries.some((e) => e.id === 'warren' && e.view); })()`, 180000, 500)) {
            // klatki, żeby pas utworzył widok
            for (let i = 0; i < 40; i++) { await ev('window.__harness.frames(2)'); if (await ev(`window.__asteroidBelt.giants.entries.some((e) => e.id === 'warren' && e.view)`)) break; await sleep(500); }
          }
        }
        await ev(`window.__harness.frames(${warmFrames})`);
        if (sc.burza) {
          // Jak demo: 40 klatek burzy (naturalne pioruny), piorun wymuszony przed dziobem, 20 klatek.
          await ev('window.__harness.step(40)');
          const ok = await ev(`(() => { const s = window.ship; return window.__asteroidBelt.forceStrike(s.pos.x + Math.cos(s.angle) * 1400, s.pos.y + Math.sin(s.angle) * 1400); })()`);
          await ev('window.__harness.step(20)');
          if (args.diag) {
            const st = await ev(`(() => { const B = window.__asteroidBelt; const out = { forced: ${ok}, strikes: B.storm.sim.strikes.length, seg: B.storm.batch.count, vis: B.storm.batch.mesh.visible, layers: B.storm.batch.mesh.layers.mask, parent: B.storm.batch.mesh.parent?.name, root: [B.root.position.x, B.root.position.y], pts: [] };
              for (const [id, s] of B.storm._state) { const P = s.chains[0].points; out.pts.push([Math.round(P[0]), Math.round(P[1]), Math.round(P[2]), Math.round(P[P.length - 3]), Math.round(P[P.length - 2]), Math.round(P[P.length - 1])]); }
              const A = B.storm.batch.a.array; out.a0 = [A[0], A[1], A[2], A[3]];
              out.sheets = B.storm.sim.sheets.length; out.flashes = B.storm.flashes.length; out.veil = [B.veil.mesh.visible, +B.veil.u.veil.value.toFixed(3), +B.veil.u.sunLevel.value.toFixed(3)];
              out.fog = B.fog.slices.map((s) => [s.mesh.visible, +s.maxFog.toFixed(2), s.mesh.layers.mask]);
              return out; })()`);
            console.log('     burza diag', JSON.stringify(st));
          }
        }
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
        await ev('window.__harness.frames(10)');
      } catch (err) {
        error = String(err?.message || err).slice(0, 500);
      }
      const png = join(outDir, `${id}.png`);
      await screenshotPng(cdp, png);
      const stats = await ev(`(() => { const B = window.__asteroidBelt; const s = B.stats; return { ...s, rocks: [...s.rocks], czas: +B.time.toFixed(3), kamera: [Math.round(window.camera.x), Math.round(window.camera.y), window.camera.zoom], olbrzymyGotowe: B.giants.readyCount, fx: window.Core3D.fxStats ? { ...window.Core3D.fxStats } : null }; })()`);
      const perf = await ev('window.__harness.scene.perf(20)');
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      if (args.diag) {
        const diag = await ev(`(() => { const s = window.ship; const C = window.Core3D; const out = { hull: !!s.beamHull, pos: [Math.round(s.pos.x), Math.round(s.pos.y)], meshes: [] };
          C.scene.traverse((o) => { if (o.isMesh && /hull/i.test(o.material?.name || '') && o.visible) out.meshes.push({ name: o.name, mat: o.material.name, pos: [Math.round(o.position.x), Math.round(o.position.y), Math.round(o.position.z)], layers: o.layers.mask, ro: o.renderOrder }); });
          return out; })()`);
        console.log('     diag', JSON.stringify(diag).slice(0, 1500));
        console.log('     logi:\n     ' + logs.all().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 40).join('\n     '));
      }
      report.sceny.push({ scena: id, opis: sc.opis, blad: error, sekundy: (Date.now() - t0) / 1000, stats, perf, bledy: errors.slice(0, 30) });
      console.log(`  ${id.padEnd(8)} ${error ? 'BŁĄD ' + error : 'ok'} | skały ${stats.rocks.join('/')} min. ${stats.minerals} | światła ${stats.lights} (statki ${stats.shipLights}, skały ${stats.rockLights}) | mapy cienia ${stats.shadowMaps} | kolumny ${stats.volumeColumns} | CPU pasa ${stats.cpuMs?.toFixed?.(2)} ms | ${perf.drawCalls} dc, GPU ${perf.gpuMs} ms | błędy ${errors.length}`);
      if (errors.length) console.log('     ' + errors.slice(0, 6).join('\n     '));
    }
    if (args.kolizja) report.kolizja = await kolizja(ev, cdp);
  } finally {
    writeFileSync(join(outDir, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
    await server.close();
  }
  console.log('gotowe:', outDir);
}

// Statek gracza leci z prędkością 900 j/s wprost na ścianę Labiryntu (środek bryły):
// bez kolizji wszedłby w skałę; z kolizją zostaje przy ścianie, składowa w głąb odbita.
async function kolizja(ev, cdp) {
  await ev(`(async () => { const W = window.__W; const g = W.FIELD_GIANTS[0]; const S = window.__harness.scene;
    const B = window.__asteroidBelt; const e = B.giants.entries.find((q) => q.id === 'warren');
    // start 1,4 półszerokości na lewo od środka, lot w prawo (w stronę środka bryły)
    const x = g.x - e.halfX * 1.25, y = g.y; DevScene.teleport(x, y, 0); S.cam(x, y, 0.08); return true; })()`);
  await ev('window.__harness.frames(4)');
  const before = await ev(`(() => { const s = window.ship; const B = window.__asteroidBelt; const e = B.giants.entries.find((q) => q.id === 'warren'); return { x: s.pos.x, y: s.pos.y, sdf: e.giant.sampleWorld(s.pos.x, s.pos.y, 0) }; })()`);
  const trace = [];
  for (let k = 0; k < 24; k++) {
    await ev(`(() => { const s = window.ship; s.vel.x = 900; s.vel.y = 0; s.angle = 0; return true; })()`);
    await ev('window.__harness.step(15)');
    trace.push(await ev(`(() => { const s = window.ship; const e = window.__asteroidBelt.giants.entries.find((q) => q.id === 'warren'); return { x: +s.pos.x.toFixed(1), y: +s.pos.y.toFixed(1), vx: +s.vel.x.toFixed(1), sdf: +e.giant.sampleWorld(s.pos.x, s.pos.y, 0).toFixed(1), kolizje: window.__asteroidBelt.giants.stats.collisions }; })()`));
  }
  await screenshotPng(cdp, join(outDir, 'kolizja.png'));
  const minSdf = Math.min(...trace.map((t) => t.sdf));
  console.log(`  kolizja: start sdf ${before.sdf.toFixed(0)} j., min sdf środka ${minSdf.toFixed(0)} j., kolizje ${trace[trace.length - 1].kolizje}`);
  return { before, trace, minSdf };
}

main().catch((err) => { console.error(err); process.exit(1); });
