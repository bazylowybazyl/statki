// Koszt klatki A/B w JEDNEJ stronie (zadanie 23): ten sam świat, warianty przełączane na przemian w krótkich
// oknach, mediany na wariant — szum między przebiegami (inny start, inny stan GPU) nie wchodzi w porównanie.
// Mierzy: CPU Core3D.render (owinięty zegarem strony, prawdziwy czas), odstęp klatek (start → start),
// GPU klatki (Core3D.gpuFrameMs — znaczniki czasu, próbki po każdej klatce), draw calle.
//
//   node scripts/webgpu/koszt-klatki.mjs [--scena bitwa|bitwa-duza|hud|kosmos|pole] [--ab nazwa[,nazwa]]
//        [--rundy 8] [--okno 90] [--port 5347] [--out plik.json] [--root <drzewo gry>] ["--chrome=--flaga …"]
//
// --scena:  bitwa — 24 × 24 okręty w próżni, zoom 0,12, czas rzeczywisty (jak zrzuty.mjs --wydajnosc);
//           bitwa-duza — jak scripts/profil-bitwy.mjs (--bok, domyślnie 60 na stronę), zoom 0,1;
//           hud — statek przy Ziemi (ring, K-7 w kadrze), zoom 1, czas stoi; kosmos — próżnia, zoom 1, czas
//           stoi; pole — gęste pole asteroid (pas, scena „pole” dema), czas stoi.
// --ab:     warianty (A = stan wyjściowy, B = przełączony) z tablicy WARIANTY niżej; bez --ab — sam pomiar.
// --okno:   klatek na okno wariantu (czas stoi: klatki na żądanie; czas rzeczywisty: tyle klatek gry).
// --root:   gra z innego drzewa (np. worktree tagu — tylko warianty bez kodu Core3D z portu).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';
import { BELT_SCENES } from './asteroidy-gra.mjs';

const args = parseArgs();
const scena = args.scena || 'bitwa';
const rundy = Math.max(1, Number(args.rundy || 8));
const okno = Math.max(10, Number(args.okno || 90));
const port = Number(args.port || 5347);
const bok = Math.max(2, Number(args.bok || (scena === 'bitwa-duza' ? 60 : 24)));
const extraArgs = args.chrome ? args.chrome.split(/\s+/).filter(Boolean) : [];
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

// Warianty: on(true) = B, on(false) = A (stan wyjściowy). Kod w stronie (Core3D, three z gry).
const WARIANTY = {
  // Znaczniki czasu GPU (trackTimestamp): koszt CPU passów z timestampWrites. B = bez znaczników (gpuFrameMs stoi).
  znaczniki: `(on) => { const C = window.Core3D, b = C.renderer.backend;
    if (on) { C.__tsFeat = C._gpuTimestampFeature; C._gpuTimestampFeature = false; b.trackTimestamp = false; }
    else { C._gpuTimestampFeature = C.__tsFeat ?? true; b.trackTimestamp = true; } }`,
  // Bloom (12 renderów BloomNode) — B = post bez bloomu (osobny RenderPipeline).
  bloom: `(on) => { window.Core3D.setPerfToggles({ bloom: !on }); }`,
  // Mapa cienia three (łapacze + stacje) — B = bez map cienia.
  cienie: `(on) => { window.Core3D.setPerfToggles({ shadows: !on }); }`,
  // Maska słońca (pass shafts) — B = wyłączona.
  maska: `(on) => { window.Core3D.setPerfToggles({ godRays: !on }); }`,
  // Gorące powietrze w „uber” — B = wyłączone.
  haze: `(on) => { window.Core3D.setPerfToggles({ heatHaze: !on }); }`,
  // Zniekształcenia efektów (fxDistortion + warstwa DIST) — B = wyłączone.
  dist: `(on) => { window.Core3D.setPerfToggles({ fxDistortion: !on }); }`,
  // Przełącznik ogólny Core3D (window.__kosztB = true/false) — do poprawek, które same czytają flagę.
  flaga: `(on) => { window.__kosztB = !!on; }`
};

const SCENY = {
  bitwa: { real: true, js: `
      DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      const s = ship; let n = 0; const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      const side = ${bok}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
      for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
      for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
      for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
      for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
      S.cam(s.pos.x + 3500, s.pos.y, 0.12);
      for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
      return n;` },
  'bitwa-duza': { real: true, js: `
      const s = window.ship, a = s.angle || 0, c = Math.cos(a), n0 = Math.sin(a);
      DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n0 * side, y: s.pos.y + n0 * fwd + c * side });
      let count = 0;
      const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, spawnAngle: ang }); count += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      const side = ${bok};
      const nb = Math.max(1, Math.round(side * 0.17)), nd = Math.round(side * 0.42), nf = side - nb - nd;
      const row = (key, mode, k, fwd, spacing, ang) => { for (let i = 0; i < k; i++) put(key, mode, at(fwd, (i - (k - 1) / 2) * spacing), ang); };
      row('pirate_battleship', 'pirate', nb, 9000, 1500, a + Math.PI);
      row('destroyer', 'pirate', nd, 7600, 650, a + Math.PI);
      row('frigate_pd', 'pirate', nf, 6600, 650, a + Math.PI);
      row('battleship', 'friendly', nb, -3000, 1500, a);
      row('destroyer', 'friendly', nd, -1800, 650, a);
      row('frigate_laser', 'friendly', nf, -900, 650, a);
      S.cam(s.pos.x + 2500, s.pos.y, 0.1);
      for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
      return count;` },
  hud: { real: false, js: `S.cam(ship.pos.x, ship.pos.y, 1.0); return 0;` },
  kosmos: { real: false, js: `DevScene.teleport(${DEEP.x}, ${DEEP.y + 60000}, 0); S.cam(ship.pos.x, ship.pos.y, 1.0); return 0;` },
  // Gęste pole asteroid: miejsce sceny „pole” dema (asteroidy-gra.mjs, BELT_SCENES).
  pole: { real: false, belt: true, js: `const W = await import('/dema/asteroidy-webgpu/world.js'); const B = window.__asteroidBelt; void B;
      ${BELT_SCENES.pole.js}
      await H.step(2); S.cam(ship.pos.x, ship.pos.y, window.camera.zoom); return 0;` }
};

const sc = SCENY[scena];
if (!sc) throw new Error(`nieznana scena ${scena} (${Object.keys(SCENY).join(', ')})`);
const warianty = (args.ab ? args.ab.split(',') : []).map((n) => { if (!WARIANTY[n]) throw new Error(`nieznany wariant ${n}`); return n; });

const serveRoot = args.root ? resolve(args.root) : repo;
async function startServer() {
  if (serveRoot === repo) return startVite(port);
  const { createServer } = await import('vite');
  const srv = await createServer({ root: serveRoot, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await srv.listen();
  return { server: srv, base: `http://localhost:${srv.httpServer.address().port}` };
}

const { server, base } = await startServer();
const chrome = await startChrome({ width: 1920, height: 1080, extraArgs });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const wynik = { scena, rundy, okno, warianty, root: serveRoot, when: new Date().toISOString(), pomiary: {} };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  if (sc.belt && !await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready)', 180000, 400)) throw new Error('pas asteroid');
  await ev('window.__harness.hold(true)');
  wynik.okrety = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x23a); S.hideHud(true); ${sc.js} })()`);
  await ev('window.__harness.frames(60)');
  // Owinięcie Core3D.render (CPU, prawdziwy zegar) i dziennik klatek (odstęp, GPU, draw calle) — per okno.
  await ev(`(() => {
    const C = window.Core3D, H = window.__harness;
    const orig = C.render;
    const acc = window.__koszt = { cpu: [], okres: [], gpu: [], dc: [], fx: [], last: 0, on: false };
    C.render = function (...a) { const t0 = H.realNow(); const r = orig.apply(this, a); if (acc.on) { acc.cpu.push(H.realNow() - t0); acc.dc.push(window.__rendererInfo?.calls ?? 0); acc.fx.push(C.fxStats?.cpuMs ?? 0); } return r; };
    const tick = () => { const now = H.realNow(); if (acc.on) { if (acc.last) acc.okres.push(now - acc.last); acc.gpu.push(C.gpuFrameMs); } acc.last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return true; })()`);
  if (sc.real) {
    await ev(`(() => { window.__harness.hold(false); window.__harness.clock.mode = 'real'; return true; })()`);
    await sleep(4000);
  }
  const zbierz = async () => {
    await ev(`(() => { const a = window.__koszt; a.cpu.length = 0; a.okres.length = 0; a.gpu.length = 0; a.dc.length = 0; a.fx.length = 0; a.last = 0; a.on = true; return true; })()`);
    if (sc.real) {
      // czas rzeczywisty: okno = tyle klatek gry (polling co 50 ms)
      await waitFor(cdp, `window.__koszt.cpu.length >= ${okno}`, 120000, 50);
    } else {
      await ev(`window.__harness.frames(${okno})`);
    }
    return ev(`(() => { const a = window.__koszt; a.on = false; return { cpu: a.cpu.slice(), okres: a.okres.slice(), gpu: a.gpu.slice(), dc: a.dc.slice(), fx: a.fx.slice(),
      npc: (window.npcs || []).filter((n) => !n.dead).length, pociski: (window.bullets || []).length }; })()`);
  };
  const med = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const p90 = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : null; };
  const nazwy = warianty.length ? ['A', ...warianty.map((w) => `B:${w}`)] : ['A'];
  const zebrane = Object.fromEntries(nazwy.map((n) => [n, { cpu: [], okres: [], gpu: [], dc: [], fx: [], okna: [] }]));
  for (let r = 0; r < rundy; r++) {
    // Kolejność wariantów w rundzie na przemian (A B … / … B A) — dryf sceny w czasie rozkłada się równo.
    const kolej = r % 2 === 0 ? nazwy : [...nazwy].reverse();
    for (const n of kolej) {
      for (const w of warianty) await ev(`(${WARIANTY[w]})(${JSON.stringify(n === `B:${w}`)})`);
      await ev(sc.real ? 'new Promise((r) => setTimeout(r, 400))' : 'window.__harness.frames(8)');
      const z = await zbierz();
      const d = zebrane[n];
      d.cpu.push(...z.cpu); d.okres.push(...z.okres); d.gpu.push(...z.gpu.slice(Math.floor(z.gpu.length / 2))); d.dc.push(...z.dc); d.fx.push(...z.fx);
      d.okna.push({ cpu: +med(z.cpu).toFixed(3), okres: +(med(z.okres) ?? 0).toFixed(3), gpu: +(med(z.gpu) ?? 0).toFixed(3), npc: z.npc, pociski: z.pociski });
    }
    for (const w of warianty) await ev(`(${WARIANTY[w]})(false)`);
  }
  for (const n of nazwy) {
    const d = zebrane[n];
    // mediany okien (odporne na dryf) i mediana wszystkich klatek
    const okCpu = d.okna.map((o) => o.cpu);
    wynik.pomiary[n] = {
      cpuMs: +med(d.cpu).toFixed(3), cpuP90: +p90(d.cpu).toFixed(3), cpuMedOkien: +med(okCpu).toFixed(3),
      cpuRozrzutOkien: [+Math.min(...okCpu).toFixed(3), +Math.max(...okCpu).toFixed(3)],
      okresMs: +(med(d.okres) ?? 0).toFixed(3), gpuMs: +(med(d.gpu) ?? 0).toFixed(3), drawCalls: med(d.dc), fxCpuMs: +(med(d.fx) ?? 0).toFixed(4),
      klatki: d.cpu.length, okna: d.okna
    };
    console.log(`${n.padEnd(14)} CPU ${wynik.pomiary[n].cpuMs} ms (okna ${wynik.pomiary[n].cpuMedOkien}, ${wynik.pomiary[n].cpuRozrzutOkien.join('…')}) p90 ${wynik.pomiary[n].cpuP90} | odstęp ${wynik.pomiary[n].okresMs} | GPU ${wynik.pomiary[n].gpuMs} | dc ${wynik.pomiary[n].drawCalls} | fx ${wynik.pomiary[n].fxCpuMs}`);
  }
  wynik.bledy = logs.errors().slice(0, 20);
} catch (err) {
  wynik.blad = String(err?.stack || err);
  console.log('BŁĄD', wynik.blad);
  wynik.bledy = logs.errors().slice(0, 20);
} finally {
  await chrome.close();
  await server.close();
}
if (args.out) {
  const out = resolve(repo, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(wynik, null, 2) + '\n');
  console.log('zapisano', out);
}
process.exit(wynik.blad ? 1 : 0);
