// Gorące powietrze i bloom A/B na prawdziwej grze (port WebGPU, zadanie 02): ta sama scena na WebGL (worktree
// tagu webgl-baseline, --root) i WebGPU (to repo) — porównanie „uber” renderer↔renderer tam, gdzie harness nie
// może (sceny gry z dyszami są dziś pełne zamienników, a w bitwa-blisko przy stojącym czasie nie ma źródeł).
//
//  A) kalibracja: wbudowane materiały three jak scena `kalibracja` harnessu (zrzuty.mjs), tylko warstwy 0/7,
//     + 4 stałe źródła gorącego powietrza (dwie dysze, dwa izotropowe) wstrzykiwane przed każdym Core3D.render.
//     Zrzuty: kalibracja-haze-on, kalibracja-haze-off (perfToggles.heatHaze), kalibracja-bez-bloomu.
//  B) bitwa jak w harnessie (180 kroków), zrzut z gorącym powietrzem i bez + liczba źródeł w klatce.
//
//   node scripts/webgpu/gorace-powietrze.mjs [--root <repo gry, domyślnie to repo>] [--out <katalog>]
//        [--port 5351] [--czesc A|B|AB]
// Porównanie: node scripts/webgpu/porownaj.mjs --a <wynik WebGL> --b <wynik WebGPU> --out <katalog>
// Worktree tagu: docs/webgpu/README.md § Nowa scena bazy (kopia node_modules, nie dowiązanie).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5351);
const czesc = String(args.czesc || 'AB');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
// Te same obiekty co scena `kalibracja` w zrzuty.mjs.
const KALIBRACJA = `const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js/.test(n));
      const T = await import(url);
      const root = new T.Group(); root.name = 'harness-kalibracja';
      const x0 = ship.pos.x, y0 = -ship.pos.y;
      const add = (mesh, dx, dy) => { mesh.position.set(x0 + dx, y0 + dy, 20); mesh.layers.set(0); root.add(mesh); };
      add(new T.Mesh(new T.SphereGeometry(160, 48, 24), new T.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.45, metalness: 0.3 })), -600, 150);
      add(new T.Mesh(new T.SphereGeometry(110, 48, 24), new T.MeshStandardMaterial({ color: 0x202020, emissive: new T.Color(1, 0.45, 0.1), emissiveIntensity: 4 })), -200, 150);
      const hdr = new T.MeshBasicMaterial(); hdr.color.setRGB(3.0, 1.5, 0.6);
      add(new T.Mesh(new T.PlaneGeometry(220, 60), hdr), 200, 180);
      const add2 = new T.MeshBasicMaterial({ transparent: true, blending: T.AdditiveBlending, depthWrite: false }); add2.color.setRGB(0.2, 0.6, 1.2);
      add(new T.Mesh(new T.CircleGeometry(120, 48), add2), 260, 120);
      const W = 256, px = new Uint8Array(W * 4 * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y < 2 ? x : 255 - x; px[i + 2] = 128; px[i + 3] = 255; }
      const tex = new T.DataTexture(px, W, 4, T.RGBAFormat); tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
      add(new T.Mesh(new T.PlaneGeometry(900, 90), new T.MeshBasicMaterial({ map: tex })), -100, -200);
      const alfa = new T.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.5 });
      add(new T.Mesh(new T.PlaneGeometry(300, 160), alfa), 450, -120);
      Core3D.scene.add(root); root.updateMatrixWorld(true);`;

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { root, czesci: {} };
let out = null;
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  result.renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
  out = resolve(repo, args.out || join('.tmp/webgpu/gorace-powietrze', result.renderer));
  mkdirSync(out, { recursive: true });
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  console.log('renderer:', result.renderer, '→', out);

  // Liczba źródeł w ostatniej klatce: WebGPU — uniformy postu, WebGL (tag) — uniformy uberPass.
  const sourceCount = `(() => { const C = window.Core3D; const u = C._postUniforms || C.uberPass?.material?.uniforms; return u ? u.uSourceCount.value : null; })()`;
  const snap = async (name) => {
    await ev('window.__harness.frames(20)');
    await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
    await ev('window.__harness.frames(6)');
    await screenshotPng(cdp, join(out, `${name}.png`));
    return ev(sourceCount);
  };
  const toggles = (o) => ev(`(() => { window.Core3D.setPerfToggles(${JSON.stringify(o)}); return true; })()`);

  if (czesc.includes('A')) {
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x1234); S.hideHud(true);
      DevScene.teleport(${DEEP.x}, ${DEEP.y + 60000}, 0);
      ${KALIBRACJA}
      S.cam(ship.pos.x, ship.pos.y, 1.0);
      // Źródła w układzie sceny (x, y = −y gry): izotropowe na pasku gradientu i na płaszczyźnie alfa,
      // dysze (kierunek wydechu) na prawym końcu paska i nad lewą kulą.
      const srcs = [[x0 - 300, y0 - 200, 200, 3.0, 0, 0], [x0 + 330, y0 - 185, 22, 1.8, -1, 0], [x0 - 600, y0 + 330, 30, 1.8, 0, -1], [x0 + 450, y0 - 120, 120, 2.0, 0, 0]];
      const C = window.Core3D; const orig = C.render;
      C.render = function (...a) { for (const s of srcs) C.pushHeatHazeWorld(s[0], s[1], -4, s[2], s[3], s[4], s[5]); return orig.apply(this, a); };
      window.__goraceRestore = () => { C.render = orig; root.parent?.remove(root); };
      S.isolate([0, 7]);
      return true; })()`);
    const on = await snap('kalibracja-haze-on');
    await toggles({ heatHaze: false });
    const off = await snap('kalibracja-haze-off');
    await toggles({ heatHaze: true, bloom: false });
    await snap('kalibracja-bez-bloomu');
    await toggles({ bloom: true });
    result.czesci.A = { zrodlaZ: on, zrodlaBez: off };
    await ev('(() => { window.__goraceRestore?.(); window.__harness.scene.isolate(null); return true; })()');
    console.log('A:', JSON.stringify(result.czesci.A));
  }

  if (czesc.includes('B')) {
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xb17b); S.hideHud(true);
      DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
      spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
      spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
      spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
      spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
      spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
      S.cam(s.pos.x + 1800, s.pos.y, 0.3);
      for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
      H.reseed(0xb17a);
      await H.step(180);
      S.cam(s.pos.x + 1800, s.pos.y, 0.3);
      return true; })()`, 300000);
    const on = await snap('bitwa-haze-on');
    await toggles({ heatHaze: false });
    const off = await snap('bitwa-haze-off');
    await toggles({ heatHaze: true });
    result.czesci.B = { zrodlaZ: on, zrodlaBez: off };
    console.log('B:', JSON.stringify(result.czesci.B));
  }
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await chrome.close();
  await server.close();
}
if (out) writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
