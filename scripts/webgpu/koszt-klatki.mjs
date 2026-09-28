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
// --bitwa s: (czas rzeczywisty) sekundy bitwy przed pomiarem, domyślnie 4.
// --fazy N: koszt fazy WebGPURenderer na obiekt (µs na rysunek) w N klatkach — RenderObjects.get, węzły
//           (needsRefresh, updateBefore/For/After), geometria, wiązania, pipeline, backend.draw — wg materiału.
// --spis N: spis obiektów rysowanych w N klatkach wariantu A (pass Core3D | materiał | nazwa obiektu → liczba
//           rysunków na klatkę) — skąd draw calle i koszt na obiekt w passach (zadanie 23, duża bitwa).
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
  // Znaczniki czasu w każdej klatce (B) zamiast co 4. (gpuTimerSampleEvery, stan gry — zadanie 23).
  znacznikiKazda: `(on) => { window.Core3D.gpuTimerSampleEvery = on ? 1 : 4; }`,
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
  flaga: `(on) => { window.__kosztB = !!on; }`,
  // Ring Ziemi — koszt części (B = część schowana; pomiar górnej granicy zysku, obraz się zmienia):
  // chmury, górna ściana (FG) i bryły dachu FG.
  chmury: `(on) => { const r = window.__haloRings?.entries?.find((e) => e.key === 'earth')?.ring; r?.group.traverse((o) => { if (o.name === 'HaloClouds') o.visible = !on; }); }`,
  dachFg: `(on) => { const r = window.__haloRings?.entries?.find((e) => e.key === 'earth')?.ring; r?.group.traverse((o) => {
    if (o.name === 'HaloStructure_topWall' || /^HaloMega_(detail|trains)/.test(o.name)) { if (o.userData.__kosztVis === undefined) o.userData.__kosztVis = o.visible; o.visible = on ? false : o.userData.__kosztVis; } }); }`
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
  // Stan sceny do raportu: zanik dachu ringu Ziemi (uFgFade.x — 0 = dach nad płaszczyzną gry całkiem wygaszony).
  wynik.diag = await ev(`(() => { const r = window.__haloRings?.entries?.find((e) => e.key === 'earth')?.ring; const f = r?.uniforms?.uFgFade?.value;
    return { fgFade: f ? [+f.x.toFixed(4), f.y, +f.z.toFixed(1)] : null, zoom: window.camera?.zoom, npc: (window.npcs || []).length }; })()`);
  console.log('scena', scena, JSON.stringify(wynik.diag));
  // Owinięcie Core3D.render (CPU, prawdziwy zegar) i dziennik klatek (odstęp, GPU, draw calle) — per okno.
  await ev(`(() => {
    const C = window.Core3D, H = window.__harness;
    const orig = C.render;
    const acc = window.__koszt = { cpu: [], okres: [], gpu: [], dc: [], fx: [], last: 0, on: false };
    C.render = function (...a) { const t0 = H.realNow(); const r = orig.apply(this, a); if (acc.on) { acc.cpu.push(H.realNow() - t0); acc.dc.push(window.__rendererInfo?.calls ?? 0); acc.fx.push(C.fxStats?.cpuMs ?? 0); } return r; };
    const tick = () => { const now = H.realNow(); if (acc.on && acc.last) acc.okres.push(now - acc.last); acc.last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return true; })()`);
  if (sc.real) {
    await ev(`(() => { window.__harness.hold(false); window.__harness.clock.mode = 'real'; return true; })()`);
    // --bitwa s: dłużej przed pomiarem (wraki, rozbite kadłuby — stan jak profil-bitwy.mjs po ~40 s)
    await sleep(Math.max(4, Number(args.bitwa || 4)) * 1000);
  }
  // GPU klatki: własne zlecenie rozwiązania zapytań po klatce okna (wynik three = suma passów OSTATNIEJ
  // klatki paczki) — Core3D.gpuFrameMs przychodzi z opóźnieniem kilkudziesięciu klatek i przy przełączaniu
  // wariantów pokazywał wynik poprzedniego okna. Wariant bez znaczników (B:znaczniki) — bez próbek GPU.
  const gpuProbe = `(async () => { const C = window.Core3D, r = C.renderer, b = r.backend, H = window.__harness;
    if (C._gpuTimestampFeature !== true) return null;
    for (let i = 0; i < 400 && b.timestampQueryPool?.render?.pendingResolve; i++) await new Promise((ok) => setTimeout(ok, 5));
    // klatka próbki zawsze ze znacznikami (Core3D mierzy co gpuTimerSampleEvery klatek — zadanie 23)
    const every = C.gpuTimerSampleEvery; C.gpuTimerSampleEvery = 1;
    ${sc.real ? 'await new Promise((ok) => requestAnimationFrame(() => ok()));' : 'await H.frames(1);'}
    C.gpuTimerSampleEvery = every;
    if (b.trackTimestamp !== true) return null;
    const ms = await r.resolveTimestampsAsync('render');
    b.timestampQueryPool?.render?.timestamps?.clear?.();
    return Number.isFinite(ms) ? ms : null; })()`;
  const zbierz = async () => {
    await ev(`(() => { const a = window.__koszt; a.cpu.length = 0; a.okres.length = 0; a.gpu.length = 0; a.dc.length = 0; a.fx.length = 0; a.last = 0; a.on = true; return true; })()`);
    if (sc.real) {
      // czas rzeczywisty: okno = tyle klatek gry (polling co 50 ms)
      await waitFor(cdp, `window.__koszt.cpu.length >= ${okno}`, 120000, 50);
    } else {
      await ev(`window.__harness.frames(${okno})`);
    }
    const res = await ev(`(() => { const a = window.__koszt; a.on = false; return { cpu: a.cpu.slice(), okres: a.okres.slice(), dc: a.dc.slice(), fx: a.fx.slice(),
      npc: (window.npcs || []).filter((n) => !n.dead).length, pociski: (window.bullets || []).length }; })()`);
    res.gpu = [];
    for (let k = 0; k < 5; k++) { const g = await ev(gpuProbe); if (g !== null && g > 0) res.gpu.push(g); }
    return res;
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
      d.cpu.push(...z.cpu); d.okres.push(...z.okres); d.gpu.push(...z.gpu); d.dc.push(...z.dc); d.fx.push(...z.fx);
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
  // --fazy N: fazy renderu obiektu (Renderer._renderObjectDirect) wg materiału, µs na rysunek.
  if (Number(args.fazy) > 0) {
    const nFrames = Number(args.fazy);
    for (const w of warianty) await ev(`(${WARIANTY[w]})(false)`);
    wynik.fazy = await ev(`(async () => {
      const C = window.Core3D, R = C.renderer;
      const H = window.__harness; const now = H ? H.realNow : performance.now.bind(performance);
      const acc = new Map(); let cur = null;
      const bump = (phase, dt) => { if (!cur) return; const e = acc.get(cur) || { n: 0 }; e[phase] = (e[phase] || 0) + dt; acc.set(cur, e); };
      const wrap = (obj, name, phase) => { const o = obj[name]; obj[name] = function (...a) { const t0 = now(); try { return o.apply(this, a); } finally { bump(phase, now() - t0); } }; return () => { obj[name] = o; }; };
      const undo = [
        wrap(R._objects, 'get', 'get'),
        wrap(R._nodes, 'needsRefresh', 'needsRefresh'),
        wrap(R._nodes, 'updateBefore', 'updateBefore'),
        wrap(R._geometries, 'updateForRender', 'geometrie'),
        wrap(R._nodes, 'updateForRender', 'wezly'),
        wrap(R._bindings, 'updateForRender', 'wiazania'),
        wrap(R._pipelines, 'updateForRender', 'pipeline'),
        wrap(R.backend, 'draw', 'draw'),
        wrap(R._nodes, 'updateAfter', 'updateAfter')
      ];
      const od = R._renderObjectDirect;
      R._renderObjectDirect = function (object, material, ...rest) {
        const prev = cur; cur = material.name || material.type;
        const t0 = now();
        try { return od.call(this, object, material, ...rest); } finally {
          const e = acc.get(cur) || { n: 0 }; e.n++; e.razem = (e.razem || 0) + now() - t0; acc.set(cur, e); cur = prev;
        }
      };
      const frames = ${nFrames};
      ${sc.real ? "for (let i = 0; i < frames; i++) await new Promise((ok) => requestAnimationFrame(() => ok()));" : "await window.__harness.frames(frames);"}
      R._renderObjectDirect = od; for (const u of undo) u();
      const out = {};
      for (const [k, e] of acc) {
        if (!e.n) continue;
        const us = {}; for (const [p, v] of Object.entries(e)) if (p !== 'n') us[p] = +(v * 1000 / e.n).toFixed(2);
        out[k] = { naKlatke: +(e.n / frames).toFixed(1), usNaRysunek: us };
      }
      return out; })()`);
    const rows = Object.entries(wynik.fazy).sort((a, b) => b[1].naKlatke * (b[1].usNaRysunek.razem || 0) - a[1].naKlatke * (a[1].usNaRysunek.razem || 0));
    console.log('fazy renderu obiektu (µs na rysunek; razem z zagnieżdżonymi renderami):');
    for (const [k, v] of rows.slice(0, 14)) console.log(`  ${String(v.naKlatke).padStart(6)} × ${k}: ${JSON.stringify(v.usNaRysunek)}`);
  }
  // --spis N: obiekty rysowane w N klatkach (Renderer._renderObjectDirect), pass z Core3D._runScenePass.
  if (Number(args.spis) > 0) {
    const nFrames = Number(args.spis);
    for (const w of warianty) await ev(`(${WARIANTY[w]})(false)`);
    wynik.spis = await ev(`(async () => {
      const C = window.Core3D, R = C.renderer;
      const tally = new Map(); let pass = 'poza passem';
      const origRun = C._runScenePass, origDirect = R._renderObjectDirect;
      C._runScenePass = function (p) { const prev = pass; pass = p.bucket || '?'; try { return origRun.call(this, p); } finally { pass = prev; } };
      R._renderObjectDirect = function (object, material, ...rest) {
        const name = String(object.name || object.type).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '#').replace(/_\\d+$/, '_N');
        const k = pass + ' | ' + (material.name || material.type) + ' | ' + name;
        const H = window.__harness; const now = H ? H.realNow : performance.now.bind(performance);
        const t0 = now();
        try { return origDirect.call(this, object, material, ...rest); } finally {
          const e = tally.get(k) || [0, 0]; e[0]++; e[1] += now() - t0; tally.set(k, e);
        }
      };
      const frames = ${nFrames};
      ${sc.real ? "for (let i = 0; i < frames; i++) await new Promise((ok) => requestAnimationFrame(() => ok()));" : "await window.__harness.frames(frames);"}
      C._runScenePass = origRun; R._renderObjectDirect = origDirect;
      const out = [...tally.entries()].map(([k, v]) => [k, +(v[0] / frames).toFixed(2), +(v[1] / frames).toFixed(3)]).sort((a, b) => b[2] - a[2]);
      return out; })()`);
    const perPass = new Map();
    for (const [k, v, ms] of wynik.spis) { const p = k.split(' | ')[0]; const e = perPass.get(p) || [0, 0]; e[0] += v; e[1] += ms; perPass.set(p, e); }
    console.log('spis — rysunki / ms CPU na klatkę wg passu (ms z zagnieżdżonymi renderami — bloom, cień):', JSON.stringify(Object.fromEntries([...perPass].map(([p, e]) => [p, [+e[0].toFixed(1), +e[1].toFixed(3)]]))));
    for (const [k, v, ms] of wynik.spis.slice(0, 50)) console.log(`  ${String(v).padStart(7)} × ${String(ms).padStart(7)} ms  ${k}`);
  }
  // --zapisy N: zapisy do kolejki GPU (queue.writeBuffer / writeTexture) w N klatkach wariantu A —
  // liczba wywołań i bajty na klatkę, grupowane po etykiecie i rozmiarze bufora (skąd koszt „writeBuffer”).
  if (Number(args.zapisy) > 0) {
    const nFrames = Number(args.zapisy);
    for (const w of warianty) await ev(`(${WARIANTY[w]})(false)`);
    await ev(`(() => { const q = window.Core3D.renderer.backend.device.queue;
      const S = window.__zapisy = { map: new Map(), on: true, t: 0 };
      if (!q.__kosztWB) {
        const wb = q.writeBuffer.bind(q), wt = q.writeTexture.bind(q);
        q.__kosztWB = true;
        q.writeBuffer = (buf, off, data, dOff = 0, size) => {
          if (S.on) {
            const el = data.BYTES_PER_ELEMENT || 1;
            const bytes = (size !== undefined ? size : ((data.byteLength / el) - dOff)) * el;
            // zapis spoza updateAttribute (wiązania, bufory storage, własne writeBuffer modułów): kto woła
            let k = 'B ' + (buf.label || '?') + ' [' + buf.size + ' B]';
            if (!buf.label && !S.inUA) { const lim = Error.stackTraceLimit; Error.stackTraceLimit = 7; const st = String(new Error().stack).split('\\n').slice(2, 7).map((l) => (l.match(/at (\\S+)/) || [])[1] || '?').join(' < '); Error.stackTraceLimit = lim; k += ' ← ' + st; }
            const e = S.map.get(k) || { n: 0, bytes: 0 }; e.n++; e.bytes += bytes; S.map.set(k, e);
          }
          return wb(buf, off, data, dOff, size);
        };
        q.writeTexture = (dst, data, layout, size) => {
          if (S.on) {
            const k = 'T ' + (dst.texture.label || '?') + ' [' + dst.texture.width + 'x' + dst.texture.height + ']';
            const e = S.map.get(k) || { n: 0, bytes: 0 }; e.n++; e.bytes += (data.byteLength || 0); S.map.set(k, e);
          }
          return wt(dst, data, layout, size);
        };
      }
      // właściciel atrybutu (siatka.atrybut) — wysyłki atrybutów przez backend.updateAttribute
      const owner = new Map();
      window.Core3D.scene.traverse((o) => {
        const g = o.geometry; if (!g) return;
        for (const [n, a] of Object.entries(g.attributes || {})) { const key = a.isInterleavedBufferAttribute ? a.data : a; if (!owner.has(key)) owner.set(key, (o.name || o.type) + '.' + n); }
        if (g.index && !owner.has(g.index)) owner.set(g.index, (o.name || o.type) + '.index');
      });
      const be = window.Core3D.renderer.backend;
      const R = window.Core3D.renderer;
      // bieżący obiekt / kernel (wysyłki atrybutów storage idą przez wiązania, nie przez geometrię)
      if (!R.__kosztCur) {
        R.__kosztCur = true;
        const wrap = (obj, fn, name) => { const f = obj[fn].bind(obj); obj[fn] = (x, ...r) => { const prev = S.cur; S.cur = name(x); try { return f(x, ...r); } finally { S.cur = prev; } }; };
        wrap(R._geometries, 'updateForRender', (ro) => 'geo:' + (ro?.object?.name || ro?.object?.type || '?') + '/' + (ro?.material?.name || ro?.material?.type || '?'));
        wrap(R._bindings, 'updateForRender', (ro) => 'bind:' + (ro?.object?.name || ro?.object?.type || '?') + '/' + (ro?.material?.name || ro?.material?.type || '?'));
        wrap(R._bindings, 'updateForCompute', (cn) => 'compute:' + (cn?.name || '?'));
      }
      if (!be.__kosztUA) {
        const ua = be.updateAttribute.bind(be);
        be.__kosztUA = true;
        be.updateAttribute = (attr) => {
          if (S.on) {
            const ba = attr.isInterleavedBufferAttribute ? attr.data : attr; // three wysyła bufor z przeplotem (zakresy na nim)
            const arr = ba.array; const el = arr?.BYTES_PER_ELEMENT || 4;
            let bytes = 0; const r = ba.updateRanges || [];
            if (r.length) for (const x of r) bytes += x.count * el; else bytes = arr ? arr.byteLength : 0;
            const k = 'A ' + (S.cur ? S.cur + ' ' : '') + (S.owner?.get(attr) || attr.name || '') + ' [' + (arr ? arr.byteLength : 0) + ' B' + (ba.usage === 35048 ? ', Dynamic' : '') + (r.length ? ', zakresy' : '') + ']';
            const e = S.map.get(k) || { n: 0, bytes: 0 }; e.n++; e.bytes += bytes; S.map.set(k, e);
          }
          S.inUA = true;
          try { return ua(attr); } finally { S.inUA = false; }
        };
      }
      S.owner = owner;
      S.map.clear(); return true; })()`);
    const f0 = await ev('window.__frameId || 0');
    if (sc.real) await waitFor(cdp, `(window.__frameId || 0) >= ${f0 + nFrames}`, 120000, 50);
    else await ev(`window.__harness.frames(${nFrames})`);
    const frames = Math.max(1, (await ev('window.__frameId || 0')) - f0);
    const lista = await ev(`(() => { const S = window.__zapisy; S.on = false; return [...S.map].map(([k, e]) => [k, e.n, e.bytes]); })()`);
    lista.sort((a, b) => b[2] - a[2]);
    const suma = lista.reduce((s, e) => [s[0] + e[1], s[1] + e[2]], [0, 0]);
    wynik.zapisy = { klatki: frames, wywolanNaKlatke: +(suma[0] / frames).toFixed(1), kBNaKlatke: +(suma[1] / frames / 1024).toFixed(1), lista: lista.slice(0, 60).map(([k, n, b]) => [k, +(n / frames).toFixed(2), +(b / frames / 1024).toFixed(2)]) };
    console.log(`\nzapisy do kolejki: ${wynik.zapisy.wywolanNaKlatke} wywołań, ${wynik.zapisy.kBNaKlatke} KB na klatkę (${frames} klatek)`);
    for (const [k, n, kb] of wynik.zapisy.lista.slice(0, 40)) console.log(`  ${String(n).padStart(7)} × / ${String(kb).padStart(9)} KB  ${k}`);
  }
  // --profil N: profil CPU (CDP Profiler, próbkowanie 100 µs) N klatek wariantu A — self-time funkcji
  // i poddrzewo Core3D.render w ms na klatkę (profil .cpuprofile obok --out).
  if (Number(args.profil) > 0) {
    const nFrames = Number(args.profil);
    for (const w of warianty) await ev(`(${WARIANTY[w]})(false)`);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    const f0 = await ev('window.__frameId || 0');
    await cdp.send('Profiler.start');
    if (sc.real) await waitFor(cdp, `(window.__frameId || 0) >= ${f0 + nFrames}`, 120000, 50);
    else await ev(`window.__harness.frames(${nFrames})`);
    const { profile } = await cdp.send('Profiler.stop');
    const frames = Math.max(1, (await ev('window.__frameId || 0')) - f0);
    wynik.profil = analyzeProfile(profile, frames);
    if (args.out) writeFileSync(resolve(repo, args.out).replace(/\.json$/, '') + '.cpuprofile', JSON.stringify(profile));
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
// Profil CPU: self-time funkcji (plik:linia) i poddrzewa wybranych funkcji w ms na klatkę.
function analyzeProfile(profile, frames) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  for (const n of nodes.values()) if (!n.parent) totalOf(n);
  const pf = (ms) => +(ms / frames).toFixed(4);
  const nameOf = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const self = new Map();
  for (const n of nodes.values()) { const k = nameOf(n); self.set(k, (self.get(k) || 0) + n.self); }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [pf(v), k]);
  const subtree = (fname, depth) => {
    const tops = [...nodes.values()].filter((n) => {
      if (n.callFrame.functionName !== fname) return false;
      for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fname) return false;
      return true;
    });
    const out = [];
    const merge = (list, d, indent) => {
      const by = new Map();
      for (const n of list) for (const cid of (n.children || [])) {
        const c = nodes.get(cid), k = nameOf(c);
        const e = by.get(k) || { total: 0, self: 0, kids: [] };
        e.total += c.total; e.self += c.self; e.kids.push(c); by.set(k, e);
      }
      for (const [k, e] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) {
        if (e.total / frames < 0.01) continue;
        out.push(`${indent}${pf(e.total)}  ${k}  [self ${pf(e.self)}]`);
        if (d > 1) merge(e.kids, d - 1, indent + '  ');
      }
    };
    merge(tops, depth, '');
    return { ms: pf(tops.reduce((s, n) => s + n.total, 0)), drzewo: out };
  };
  const res = { klatki: frames, self: top, render: subtree('render', 5) };
  console.log(`\nprofil: ${frames} klatek; Core3D render (poddrzewo 'render') ${res.render.ms} ms/klatkę`);
  for (const l of res.render.drzewo.slice(0, 80)) console.log('  ' + l);
  console.log('\nself-time (ms/klatkę):');
  for (const [v, k] of top.slice(0, 30)) console.log(`  ${v}  ${k}`);
  return res;
}

if (args.out) {
  const out = resolve(repo, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(wynik, null, 2) + '\n');
  console.log('zapisano', out);
}
process.exit(wynik.blad ? 1 : 0);
