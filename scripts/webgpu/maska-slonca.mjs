// Maska słońca A/B na prawdziwej grze (port WebGPU, zadanie 03): ta sama scena na WebGL (worktree tagu
// webgl-baseline, --root) i WebGPU (to repo) — odczyt celu maski Core3D.sunShadowTarget (R = cień
// powierzchni: tarcze + kadłuby + pole, G = smuga tła: R + ringi, B = mrok pola) jako PNG z wierszem 0
// u GÓRY w obu (readPixels WebGL ma wiersz 0 na dole — odwracamy). To sprawdza pass maski bez
// materiałów (tło i planety są na WebGPU jeszcze zamiennikami) — orientację, tarcze, SDF kadłubów,
// ringi, pole przesłaniające i szum ±0,5/255.
//
//   node scripts/webgpu/maska-slonca.mjs [--root <repo gry, domyślnie to repo>] [--out <katalog>]
//        [--port 5347] [--sceny ring-z02,planeta-cien,bitwa,pole]
// Porównanie: node scripts/webgpu/porownaj.mjs --a <wynik WebGL> --b <wynik WebGPU> --out <katalog>
// (różnica > 2/255 = coś innego niż szum maski; > 8/255 = błąd). Worktree tagu: docs/webgpu/README.md.
//
// Sceny (kolejność w sesji ma znaczenie — obie wersje idą tą samą drogą):
//  - ring-z02: port Ziemi, zoom 0,2 — tarcza Ziemi i okrąg ringu (G, pominięty w tarczy),
//  - planeta-cien: Wenus z jej smugą (kamera 7000 j. za planetą od słońca), zoom 0,05,
//  - bitwa: 3 piratów vs 2 Terra Nova jak w zrzuty.mjs (180 kroków) — pola odległości kadłubów,
//  - pole: pole przesłaniające słońce (syntetyczna tekstura transmitancji 64×64 wokół kamery) — kanał B
//    i mnożenie R/G; dawne pole asteroid jest wyłączone, więc bez tej sceny ścieżka nie byłaby widziana.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5347);
const only = args.sceny ? new Set(String(args.sceny).split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const want = (id) => !only || only.has(id);

// Odczyt celu maski w stronie → PNG (base64) + liczby. WebGPU: wiersz 0 = góra, wiersze wyrównane
// do 256 B; WebGL: wiersz 0 = dół.
const READ_MASK = `(async () => {
  const C = window.Core3D; const r = C.renderer; const rt = C.sunShadowTarget;
  const w = rt.width, h = rt.height;
  let row;
  if (r.isWebGPURenderer) {
    const data = await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    const stride = Math.ceil(w * 4 / 256) * 256;
    row = (y) => data.subarray(y * stride, y * stride + w * 4);
  } else {
    const data = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, data);
    row = (y) => data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4);
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
  const st = { r: 0, g: 0, b: 0, maxR: 0, maxG: 0, maxB: 0, sumR: 0, sumG: 0, sumB: 0 };
  for (let y = 0; y < h; y++) {
    const src = row(y);
    for (let x = 0; x < w; x++) {
      const i = x * 4, o = (y * w + x) * 4;
      const R = src[i], G = src[i + 1], B = src[i + 2];
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
      if (R) { st.r++; st.sumR += R; if (R > st.maxR) st.maxR = R; }
      if (G) { st.g++; st.sumG += G; if (G > st.maxG) st.maxG = G; }
      if (B) { st.b++; st.sumB += B; if (B > st.maxB) st.maxB = B; }
    }
  }
  ctx.putImageData(img, 0, 0);
  const m = await import('/src/3d/sunShadowMask.js');
  const sdf = (await import('/src/3d/hullShadowSdf.js')).HullShadowSdf;
  const u = C.shadowShaftsPass?.material?.uniforms;
  return { png: cv.toDataURL('image/png').split(',')[1], w, h, st,
    maskOn: m.sunShadowUniforms.uSunShadowOn.value,
    dyski: u?.uDiscCount?.value ?? null, kadluby: u?.uHullCount?.value ?? null, ringi: u?.uRingCount?.value ?? null,
    pole: u?.uFieldOccOn?.value ?? null,
    // WebGPU: pełne wgrania tablicy SDF (wersja tekstury) i warstwy wgrane pojedynczo (uploadTextureLayer)
    sdf: { pelneWgrania: sdf.texture?.version ?? null, warstwyPojedynczo: window.__maskaWarstwy ?? null } };
})()`;
// WebGPU: licznik warstw SDF wgranych pojedynczo (hak Core3D → HullShadowSdf.layerUploader).
const COUNT_LAYERS = `(async () => {
  const sdf = (await import('/src/3d/hullShadowSdf.js')).HullShadowSdf;
  const up = sdf.layerUploader;
  if (typeof up !== 'function' || up.__licznik) return false;
  window.__maskaWarstwy = 0;
  sdf.layerUploader = (tex, layer) => { const ok = up(tex, layer); if (ok) window.__maskaWarstwy++; return ok; };
  sdf.layerUploader.__licznik = true;
  return true;
})()`;

const SESSIONS = [
  { id: 'ziemia', query: 'dev=1&haloTest=earth&haloAt=port', ring: 'earth', scenes: [
    { id: 'ring-z02', warm: 45, js: `S.cam(ship.pos.x, ship.pos.y, 0.2);` },
    { id: 'planeta-cien', warm: 60, js: `const v = planets.find((p) => p.id === 'venus'); const dx = v.x - SUN.x, dy = v.y - SUN.y, d = Math.hypot(dx, dy);
      S.cam(v.x + dx / d * 7000, v.y + dy / d * 7000, 0.05);` }
  ] },
  { id: 'kosmos', query: 'dev=1', sprites: true, scenes: [
    { id: 'bitwa', warm: 45, js: `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
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
      S.cam(s.pos.x + 1800, s.pos.y, 0.3);` },
    { id: 'pole', warm: 20, js: `const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js/.test(n));
      const T = await import(url);
      const N = 64, px = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.3;
        // transmitancja: ciemny rdzeń w dolnej połowie + pasy (orientacja wierszy widoczna)
        const core = Math.min(1, Math.hypot(dx, dy) * 3.2);
        const band = (Math.floor(x / 8) % 2) ? 1 : 0.8;
        px[y * N + x] = Math.round(255 * Math.max(0.05, core * band));
      }
      const tex = new T.DataTexture(px, N, N, T.RedFormat, T.UnsignedByteType);
      tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
      const cx = camera.x, cy = -camera.y, z = camera.zoom || 1;
      const w = innerWidth / z * 0.7, h = innerHeight / z * 0.7;
      Core3D.setSunOcclusionField(tex, cx - w * 0.5, cy - h * 0.35, w, h);
      window.__maskaPole = tex;` }
  ] }
];

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const result = { root, sceny: {} };
let out = null;
try {
  for (const session of SESSIONS) {
    if (!session.scenes.some((s) => want(s.id))) continue;
    const chrome = await startChrome({ width: 1920, height: 1080 });
    const logs = await attachLogs(chrome);
    const { cdp } = chrome;
    const ev = (e, t = 300000) => evaluate(cdp, e, t);
    try {
      await osobneLosowanieUuid(cdp);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
      await cdp.send('Page.navigate', { url: `${base}/index.html?${session.query}` });
      if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
      const renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
      result.renderer = renderer;
      await ev(COUNT_LAYERS);
      out = resolve(repo, args.out || join('.tmp/webgpu/maska-slonca', renderer));
      mkdirSync(out, { recursive: true });
      await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
      if (session.ring) {
        await ev('(() => { window.__harness.scene.cam(window.ship.pos.x, window.ship.pos.y, 0.2); return true; })()');
        if (!await waitFor(cdp, `window.__harness.scene.ringReady('${session.ring}')`, 240000, 400)) throw new Error('ring bez map');
      }
      if (session.sprites && !await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
      await ev('window.__harness.hold(true)');
      console.log(`sesja ${session.id}: ${renderer} → ${out}`);
      for (const sc of session.scenes) {
        const seed = [...sc.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
        await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(${seed}); S.hideHud(true);\n${sc.js}\n return true; })()`);
        await ev(`window.__harness.frames(${sc.warm})`);
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
        await ev('window.__harness.frames(6)');
        if (!want(sc.id)) continue;
        const r = await ev(READ_MASK);
        writeFileSync(join(out, `maska-${sc.id}.png`), Buffer.from(r.png, 'base64'));
        delete r.png;
        result.sceny[sc.id] = r;
        const n = r.w * r.h;
        console.log(`  ${sc.id.padEnd(13)} maska ${r.maskOn ? 'wł.' : 'wył.'} | dyski ${r.dyski} kadłuby ${r.kadluby} ringi ${r.ringi} pole ${r.pole} | ` +
          `R ${(100 * r.st.r / n).toFixed(2)}% (maks ${r.st.maxR}) G ${(100 * r.st.g / n).toFixed(2)}% (maks ${r.st.maxG}) B ${(100 * r.st.b / n).toFixed(2)}% (maks ${r.st.maxB})` +
          ` | SDF: pełne wgrania ${r.sdf.pelneWgrania}, warstwy pojedynczo ${r.sdf.warstwyPojedynczo}`);
      }
      result.bledy = [...(result.bledy || []), ...logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20)];
    } finally {
      await chrome.close();
    }
  }
} catch (err) {
  result.blad = String(err?.stack || err);
  console.log('BŁĄD', result.blad);
} finally {
  await server.close();
}
if (out) writeFileSync(join(out, 'wynik.json'), JSON.stringify(result, null, 2) + '\n');
console.log('błędy strony:', (result.bledy || []).length, (result.bledy || []).slice(0, 5).join(' | '));
process.exit(result.blad ? 1 : 0);
