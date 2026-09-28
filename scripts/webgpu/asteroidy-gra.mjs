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
import { pathToFileURL } from 'node:url';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5355);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/21/gra');
const warmFrames = Number(args.klatki || 30);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SEED = 0x5eed1234;
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

// Burza powtarzalna dla porównania z demem (gra i demo — ten sam kod, ten sam symulator
// src/game/asteroidStorms.js): los symulatora od ziarna, bez piorunów i błysków losowych,
// piorun wymuszony 1400 j. przed dziobem, błysk w chmurach za 18 klatek (w chwili zrzutu
// ~4 klatki po starcie), 2600 j. za lewą burtą, 5200 j. pod płaszczyzną. Wolne zmienne:
// sim, sx, sy, sa (statek), force(x, y) → bool.
export const STORM_STAGE = `
  const { mulberry32 } = await import('/src/game/asteroidStorms.js');
  sim.rng = mulberry32(0x5707);
  sim.strikes.length = 0; sim.sheets.length = 0; sim.cooldown.clear();
  sim.config.strikeRate = 0; sim.config.sheetRate = 0;
  const ok = force(sx + Math.cos(sa) * 1400, sy + Math.sin(sa) * 1400);
  const bx = -Math.sin(sa), by = Math.cos(sa);
  sim.sheets.push({ id: 900001, t0: sim.time + 18 / 60, pulses: [{ at: 0, amp: 1 }, { at: 0.09, amp: 0.7 }], duration: 0.6,
    x: sx - Math.cos(sa) * 1200 - bx * 2600, y: sy - Math.sin(sa) * 1200 - by * 2600, z: -5200, range: 8200 });
  return ok;`;

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
          // Jak demo: 40 klatek burzy (naturalne pioruny), potem burza powtarzalna
          // (STORM_STAGE — ten sam kod w asteroidy-demo.mjs), 20 klatek.
          await ev('window.__harness.step(40)');
          const ok = await ev(`(async () => { const s = window.ship; const B = window.__asteroidBelt;
            const sim = B.storm.sim; const sx = s.pos.x, sy = s.pos.y, sa = s.angle;
            const force = (x, y) => B.forceStrike(x, y);
            ${STORM_STAGE} })()`);
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

// Statek gracza leci z prędkością 900 j/s wprost na skałę Labiryntu. Cel = pierwsza lita
// skała (SDF < −200 j. na z = 0) na jednym z wierszy skanu od lewej krawędzi bryły; start
// z dziobem 1500 j. przed nią. Bez kolizji statek przeleciałby 5400 j. (w głąb skały);
// z kolizją koła kadłuba (jak collideShip: 5 kół wzdłuż osi) zostają przy ścianie —
// wbicie = max(R − SDF) po kołach po każdej porcji kroków (oczekiwane ≲ krok ruchu).
async function kolizja(ev, cdp) {
  const setup = await ev(`(async () => { const S = window.__harness.scene;
    const B = window.__asteroidBelt; const e = B.giants.entries.find((q) => q.id === 'warren'); const G = e.giant;
    const s = window.ship; const L = Math.max(s.w || 0, 1); const R = Math.max(10, (s.h || 0) * B.giants.cfg.hullCircleRadius);
    let hit = null;
    for (const dy of [0, 1500, -1500, 3000, -3000, 4500, -4500, 6000, -6000]) {
      const y = G.y + dy;
      for (let x = G.x - e.halfX - 1000; x < G.x + e.halfX; x += 40) {
        if (G.sampleWorld(x, y, 0) < -200) { hit = { x, y }; break; }
      }
      if (hit) break;
    }
    if (!hit) return { blad: 'brak litej skały na skanie' };
    const x = hit.x - L * 0.5 - 1500; const y = hit.y;
    DevScene.teleport(x, y, 0); S.cam(hit.x - 400, y, 0.14);
    return { cel: { x: Math.round(hit.x), y: Math.round(hit.y) }, start: { x: Math.round(x), y: Math.round(y) }, L: Math.round(L), R: Math.round(R) }; })()`);
  if (setup.blad) { console.log('  kolizja: ' + setup.blad); return setup; }
  await ev('window.__harness.step(2)');
  const probe = `(() => { const s = window.ship; const B = window.__asteroidBelt; const G = B.giants.entries.find((q) => q.id === 'warren').giant;
    const L = ${setup.L}, R = ${setup.R}; const fx = Math.cos(s.angle), fy = Math.sin(s.angle); let pen = -Infinity;
    for (let k = -2; k <= 2; k++) { const off = k * Math.max(0, L * 0.5 - R) / 2; pen = Math.max(pen, R - G.sampleWorld(s.pos.x + fx * off, s.pos.y + fy * off, 0)); }
    return { x: +s.pos.x.toFixed(1), y: +s.pos.y.toFixed(1), vx: +s.vel.x.toFixed(1), vy: +s.vel.y.toFixed(1), wbicie: +pen.toFixed(1), kolizje: B.giants.stats.collisions }; })()`;
  const before = await ev(probe);
  const trace = [];
  for (let k = 0; k < 24; k++) {
    await ev(`(() => { const s = window.ship; s.vel.x = 900; s.vel.y = 0; s.angle = 0; s.angVel = 0; return true; })()`);
    await ev('window.__harness.step(15)');
    trace.push(await ev(probe));
  }
  const last = trace[trace.length - 1];
  await ev(`(() => { window.__harness.scene.cam(window.ship.pos.x + ${setup.L} * 0.5, window.ship.pos.y, 0.14); return true; })()`);
  await ev('window.__harness.frames(6)');
  await screenshotPng(cdp, join(outDir, 'kolizja.png'));
  const maxPen = Math.max(...trace.map((t) => t.wbicie));
  const droga = last.x - before.x;
  console.log(`  kolizja: cel ${setup.cel.x}, ${setup.cel.y} | L ${setup.L} R ${setup.R} | droga ${droga.toFixed(0)} j. (bez kolizji 5400) | max wbicie ${maxPen.toFixed(1)} j. | kolizje ${last.kolizje}`);
  return { ...setup, before, trace, maxPen, droga };
}

// Uruchomienie tylko wprost (asteroidy-demo.mjs importuje stąd STORM_STAGE).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
