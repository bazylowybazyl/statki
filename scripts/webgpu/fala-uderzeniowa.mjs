// Fala uderzeniowa z refrakcją A/B na prawdziwej grze (port WebGPU, zadanie 03): ta sama scena na WebGL
// (worktree tagu webgl-baseline, --root) i WebGPU (to repo). Falę odpala w grze tylko Supernowa (scena
// `wybuch` harnessu jej nie ma), więc tu: obiekty sceny `kalibracja` (wbudowane materiały three — bez
// zamienników) i szachownica w próżni, fala `window.trigger3DShockwave` obok statku, zrzuty w kilku
// chwilach jej życia. Warstwy 0 i 2 (świat ortho, FG z falą) — tło (1) i tarcze (7) to na WebGPU jeszcze
// zamienniki. Czas gry stoi (klatki bez kroków: statek bez dysz i tarczy), fala idzie krokiem 1/240 s
// na klatkę (Core3D._updateShockwaves przy stojącym zegarze) — tak samo na obu rendererach.
//
//   node scripts/webgpu/fala-uderzeniowa.mjs [--root <repo gry, domyślnie to repo>] [--out <katalog>] [--port 5348]
//        [--warstwy 0,2]
// Porównanie: node scripts/webgpu/porownaj.mjs --a <wynik WebGL> --b <wynik WebGPU> --out <katalog>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5348);
// --warstwy 0,2,7: z tarczami (na WebGPU do scalenia zadania 14 — zamienniki; liczniki budów i tak
// pokazują, czy snapshot refrakcji dokłada budowy materiałów tarcz).
const layers = String(args.warstwy || '0,2').split(',').map(Number);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
// Te same obiekty co scena `kalibracja` w zrzuty.mjs (+ pas kontrastowy pod falą).
const SCENA = `const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js/.test(n));
      const T = await import(url);
      const root = new T.Group(); root.name = 'harness-fala';
      const x0 = ship.pos.x, y0 = -ship.pos.y;
      const add = (mesh, dx, dy) => { mesh.position.set(x0 + dx, y0 + dy, 20); mesh.layers.set(0); root.add(mesh); };
      add(new T.Mesh(new T.SphereGeometry(160, 48, 24), new T.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.45, metalness: 0.3 })), -600, 150);
      add(new T.Mesh(new T.SphereGeometry(110, 48, 24), new T.MeshStandardMaterial({ color: 0x202020, emissive: new T.Color(1, 0.45, 0.1), emissiveIntensity: 4 })), -200, 150);
      const hdr = new T.MeshBasicMaterial(); hdr.color.setRGB(3.0, 1.5, 0.6);
      add(new T.Mesh(new T.PlaneGeometry(220, 60), hdr), 200, 180);
      const W = 256, px = new Uint8Array(W * 4 * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y < 2 ? x : 255 - x; px[i + 2] = 128; px[i + 3] = 255; }
      const tex = new T.DataTexture(px, W, 4, T.RGBAFormat); tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
      add(new T.Mesh(new T.PlaneGeometry(900, 90), new T.MeshBasicMaterial({ map: tex })), -100, -200);
      // szachownica pod falą — przesunięcie refrakcji widać na krawędziach pól
      const cw = 64, cpx = new Uint8Array(cw * cw * 4);
      for (let y = 0; y < cw; y++) for (let x = 0; x < cw; x++) { const i = (y * cw + x) * 4; const on = ((x >> 3) + (y >> 3)) & 1; cpx[i] = on ? 200 : 40; cpx[i + 1] = on ? 160 : 60; cpx[i + 2] = on ? 90 : 110; cpx[i + 3] = 255; }
      const ctex = new T.DataTexture(cpx, cw, cw, T.RGBAFormat); ctex.colorSpace = T.SRGBColorSpace; ctex.needsUpdate = true;
      add(new T.Mesh(new T.PlaneGeometry(700, 700), new T.MeshBasicMaterial({ map: ctex })), 450, 0);
      Core3D.scene.add(root); root.updateMatrixWorld(true);`;

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { root, zrzuty: [] };
let out = null;
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  result.renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
  out = resolve(repo, args.out || join('.tmp/webgpu/fala-uderzeniowa', result.renderer));
  mkdirSync(out, { recursive: true });
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');
  console.log('renderer:', result.renderer, '→', out);
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0xfa1a); S.hideHud(true);
      DevScene.teleport(${DEEP.x}, ${DEEP.y + 60000}, 0);
      ${SCENA}
      S.cam(ship.pos.x, ship.pos.y, 1.0);
      S.isolate(${JSON.stringify(layers)});
      return true; })()`);
  await ev('window.__harness.frames(20)');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await ev('window.__harness.frames(6)');
  await screenshotPng(cdp, join(out, 'fala-000-przed.png'));
  // WebGPU: budowy materiałów (NodeBuilder) i pipeline'y przed pierwszą falą i po niej — snapshot
  // refrakcji ma kontekst renderu sceny (ten sam format / MSAA / głębia), więc dokłada tylko falę.
  const caches = `(() => { const r = window.Core3D.renderer; return r?.isWebGPURenderer ? { budowy: r._nodes.nodeBuilderCache.size, pipeline: r._pipelines.caches.size } : null; })()`;
  result.cachePrzed = await ev(caches);
  // Fala 450 j. w prawo od statku (na szachownicy), promień docelowy 650 j., życie 1,2 s (jak Supernowa):
  // 288 klatek po 1/240 s.
  await ev(`(() => { const s = window.ship; window.trigger3DShockwave(s.pos.x + 450, -s.pos.y, 0, 650, 1.2, 0x55ffff); return true; })()`);
  let done = 0;
  for (const target of [15, 50, 100, 170]) {
    await ev(`window.__harness.frames(${target - done})`);
    done = target;
    const name = `fala-${String(target).padStart(3, '0')}.png`;
    await screenshotPng(cdp, join(out, name));
    const info = await ev(`(() => { const m = window.Core3D.shockwave3DManager; const w = m?.waves?.find((x) => x.active); return w ? { progress: +w.mesh.material.uniforms.progress.value.toFixed(4), skala: +w.mesh.scale.x.toFixed(2) } : null; })()`);
    result.zrzuty.push({ plik: name, klatki: target, fala: info });
    console.log(`  ${name}: ${JSON.stringify(info)}`);
  }
  result.cachePo = await ev(caches);
  if (result.cachePrzed) console.log(`  budowy materiałów / pipeline'y: przed falą ${JSON.stringify(result.cachePrzed)}, po ${JSON.stringify(result.cachePo)}`);
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
