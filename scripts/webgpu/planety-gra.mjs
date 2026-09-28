// Planety i słońce w PRAWDZIWEJ grze A/B renderer↔renderer (port WebGPU, zadanie 05): harness zrzutów nie ma
// kadru z planetą przy ringu (Ziemia, Mars, Jowisz — noc z miastami, mapa normalnych, chmury, poświata limbu,
// analityczny pas cienia ringu) ani z Saturnem i księżycami. Ta sama gra (zegar wirtualny, ziarna, UUID
// z osobnego strumienia) na WebGL (worktree tagu webgl-baseline, --root) i na WebGPU (to repo); kamera RTS
// nad ciałem, sama warstwa planet (3 planety tła, 5 halo, 6 ring-planety) — ring i reszta sceny ukryte.
//
//   node scripts/webgpu/planety-gra.mjs [--root <repo gry, domyślnie to repo>] [--out <katalog>] [--port 5349]
// Porównanie: node scripts/webgpu/porownaj.mjs --a <wynik WebGL> --b <wynik WebGPU> --out <katalog>
// Worktree tagu: docs/webgpu/README.md § Nowa scena bazy (kopia node_modules, nie dowiązanie).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5349);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const PLANET_LAYERS = [3, 5, 6];

// Kadry: ciało (id planety albo księżyc), przesunięcie kamery w promieniach ciała (kąt względem kierunku
// do słońca: 0 = strona dzienna, π/2 = terminator), zoom tak, żeby promień ciała zajął `fill` wysokości kadru.
const VIEWS = [
  { name: 'ziemia', body: 'earth', fill: 0.42 },
  { name: 'ziemia-terminator', body: 'earth', at: Math.PI / 2, dist: 0.97, fill: 3.2 },
  { name: 'ziemia-dzien', body: 'earth', at: 0.25, dist: 0.97, fill: 3.2 },
  { name: 'ziemia-noc', body: 'earth', at: Math.PI * 0.85, dist: 0.55, fill: 2.5 },
  { name: 'mars', body: 'mars', fill: 0.42 },
  { name: 'jowisz', body: 'jupiter', fill: 0.42 },
  { name: 'saturn', body: 'saturn', fill: 0.3 },
  { name: 'wenus', body: 'venus', fill: 0.35 },
  { name: 'neptun', body: 'neptune', fill: 0.35 },
  { name: 'ksiezyc', body: 'moon:earth', fill: 0.35 },
  { name: 'ksiezyc-io', body: 'moon:io', fill: 0.35 },
  // Stacje (GLB, materiały wbudowane — konwertuje je WebGPU): warstwa FG z łapaczem cieni (ShadowMaterial).
  // Obrót stacji rośnie o stałą na każdą aktualizację (stations3D.js), a liczba klatek różni się między
  // przebiegami — kąt modelu przybity na czas zrzutu.
  { name: 'stacja-wenus', body: 'station:venus', fill: 0.3, layers: [2] },
  // Stacja piracka powstaje dopiero z misją najemnika — tu wprost przez world3d.js (ten sam moduł co gra),
  // w próżni obok statku; bez encji w `stations` (rozgrywki nie dotyka).
  { name: 'stacja-piracka', body: 'pirate', fill: 0.35, layers: [2] },
  // Gwiazdy rozciągnięte w skoku (smugi wzdłuż lotu, głowa w miejscu gwiazdy): warpFactor ustawiony wprost
  // w uniformach StarSystemu — przy stojącym czasie (dt = 0) lerp w update() go nie rusza. Bez gry w stanie
  // skoku: stara soczewka tagu (warpLensPass) zginałaby tło tylko na WebGL.
  { name: 'gwiazdy-skok', body: 'deep', zoom: 0.3, layers: [1], starWarp: 0.8 },
  { name: 'gwiazdy', body: 'deep', zoom: 0.3, layers: [1], starWarp: 0 }
];

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { root, zrzuty: {} };
let out = null;
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  result.renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
  out = resolve(repo, args.out || join('.tmp/webgpu/zadania/05/planety-gra', result.renderer));
  mkdirSync(out, { recursive: true });
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  // Cała planeta z ringiem w kadrze wymaga zoomu poniżej minimum gry (0,035) — tylko na czas zrzutów.
  await ev('(() => { window.camera.minZoom = 0.003; return true; })()');
  console.log('renderer:', result.renderer, '→', out);

  // Tekstury ciał wczytane (8K dzień / noc / połysk / normalne, chmury, mapy księżyców) i wgrane.
  const texturesReady = `(() => {
    const pending = [];
    const want = (t, name) => { if (t && t.isTexture && t.version === 0 && !t.image) pending.push(name); };
    for (const e of (window._entities || [])) {
      const u = e.uniforms;
      if (u?.dayTexture) { want(u.dayTexture.value, e.name + ':day'); if (e.name === 'earth') { want(u.nightTexture.value, 'earth:night'); want(u.normalTexture.value, 'earth:normal'); want(u.specularTexture.value, 'earth:spec'); } }
      if (e.cloudUniforms) want(e.cloudUniforms.cloudTexture.value, 'earth:clouds');
      if (e.mesh?.material?.map) want(e.mesh.material.map, 'moon:' + (e.tune?.id || 'moon'));
    }
    return pending.length === 0;
  })()`;
  for (let i = 0; i < 600; i++) {
    if (await ev(texturesReady)) break;
    await ev('window.__harness.frames(2)');
  }
  result.teksturyGotowe = await ev(texturesReady);

  const snap = async (view) => {
    let place = null;
    for (let i = 0; i < 200; i++) {
      place = await placeCamera(view);
      if (!place.czekaj) break;
      await ev('window.__harness.frames(5)');
    }
    if (place.czekaj) throw new Error(`${view.name}: bryła się nie pojawiła`);
    if (place.blad) throw new Error(place.blad);
    if (place.pominieta) { console.log(' ', view.name.padEnd(18), 'pominięta (brak w świecie)'); return; }
    await ev(`window.__harness.scene.isolate(${JSON.stringify(view.layers || PLANET_LAYERS)})`);
    await ev('window.__harness.frames(12)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(6)');
    await screenshotPng(cdp, join(out, `${view.name}.png`));
    result.zrzuty[view.name] = place;
    console.log(' ', view.name.padEnd(18), JSON.stringify(place));
  };
  const placeCamera = (view) => ev(`(async () => {
      const S = window.__harness.scene;
      const view = ${JSON.stringify(view)};
      let x, y, r;
      if (view.body === 'deep') {
        // Próżnia (jak DEEP w zrzuty.mjs); gwiazdy gry: obiekt z uniformami StarSystemu (Points na WebGL, Mesh na WebGPU).
        const stars = window.Core3D.scene.children.find((o) => o.material?.uniforms?.stretchStrength && o.material.uniforms.cameraOffset);
        if (!stars) return { blad: 'brak gwiazd' };
        stars.material.uniforms.warpFactor.value = view.starWarp;
        S.cam(6210000, 5330000, view.zoom);
        return { x: 6210000, y: 5330000, zoom: view.zoom, warpFactor: view.starWarp };
      }
      if (view.body === 'pirate') {
        if (!window.__harnessPirat) {
          const world = await import('/src/3d/world3d.js');
          // Próżnia między Ziemią a Wenus (jak DEEP w zrzuty.mjs) — z dala od ringów i stacji.
          const st = { x: 6230000, y: 5318000, r: 220 };
          world.attachPirateStation3D(null, st);
          window.__harnessPirat = st;
        }
        const st = window.__harnessPirat;
        if (!st._mesh3d) return { blad: 'stacja piracka bez bryły' };
        x = st.x; y = st.y; r = 360 * st._mesh3d.scale.x;
      } else if (view.body.startsWith('station:')) {
        const key = view.body.slice(8);
        const list = window.stations || [];
        let st = list.find((s) => s.id === key);
        if (!st) {
          const p = planets.find((q) => q.id === key);
          if (p) st = list.filter((s) => !s.isPirate && !s.ringPort).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        }
        if (!st) return view.opcjonalna ? { pominieta: true } : { blad: 'brak stacji ' + key };
        // Bryła GLB powstaje w updateStations3D, gdy stacja wejdzie w kadr (szablon wczytany) — najpierw kamera.
        if (!st._mesh3d) { S.cam(st.x, st.y, 0.3); return { czekaj: true }; }
        const model = st._mesh3d.children?.[0];
        if (model && !model.__harnessFixedRot && !st.isPirate) {
          const rot = model.rotation;
          const proto = Object.getPrototypeOf(rot);
          rot.set = function (a, b, c, order) { return proto.set.call(this, a, 0.7, c, order); };
          model.__harnessFixedRot = true;
        }
        x = st.x; y = st.y; r = Math.max(50, (Number(st.r) || Number(st.baseR) || 100) * 2.8);
      } else if (view.body.startsWith('moon:')) {
        const id = view.body.slice(5);
        const m = (window._entities || []).find((e) => e.tune && (id === 'earth' ? !e.tune.id && e.parentData?.id === 'earth' : e.tune.id === id));
        if (!m || !m.mesh) return { blad: 'brak księżyca ' + id };
        x = m.group.position.x; y = -m.group.position.y; r = m.mesh.scale.x;
      } else {
        const p = planets.find((q) => q.id === view.body);
        if (!p) return { blad: 'brak planety ' + view.body };
        const e = (window._entities || []).find((q) => q.data === p);
        x = p.x; y = p.y; r = e && e.group ? e.group.scale.x : p.r;
      }
      if (view.at !== undefined) {
        const a = Math.atan2(SUN.y - y, SUN.x - x) + view.at;
        x += Math.cos(a) * r * view.dist;
        y += Math.sin(a) * r * view.dist;
      }
      const zoom = view.fill * 1080 / (2 * r);
      S.cam(x, y, zoom);
      return { x: Math.round(x), y: Math.round(y), r: Math.round(r), zoom: +zoom.toFixed(5), zoomKamery: +window.camera.zoom.toFixed(5) };
    })()`);
  for (const view of VIEWS) await snap(view);
  await ev('window.__harness.scene.isolate(null)');
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
if (out) writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('tekstury gotowe:', result.teksturyGotowe);
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
