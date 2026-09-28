// Tło menu po częściach (port WebGPU, zadanie 11): ten sam kadr co scena `menu` harnessu (zegar wirtualny,
// ziarno, UUID z osobnego strumienia, 150 klatek intro po gotowości tła), a do tego warianty z jedną częścią
// sceny tła: samo niebo, sama Ziemia z poświatą limbu, sam ring — bez DOM menu. Na WebGL (worktree tagu
// webgl-baseline, --root) i na WebGPU (to repo); porównanie wariantów jak w harnessie (porownaj.mjs).
// Rozdziela resztkowe różnice pełnego kadru na materiały tła (zadanie 11) i ring (zadania 06–10).
//
//   node scripts/webgpu/menu-czesci.mjs [--root <repo gry>] [--out katalog] [--port 5358]
//   node scripts/webgpu/porownaj.mjs --a <wynik tagu> --b <wynik WebGPU> --out <katalog>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const root = resolve(args.root || repo);
const port = Number(args.port || 5358);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
// Części tła (nazwy obiektów w grupie ringu): niebo, Ziemia z poświatą, bryły ringu (wszystko poza tłem menu).
const PARTS = {
  niebo: ['MenuSky'],
  ziemia: ['MenuEarth'],
  ring: ['HaloTerrain', 'HaloStructure', 'HaloStructure_topWall', 'HaloClouds', 'HaloAirShell', 'HaloMega_detail_box',
    'HaloMega_landmark_box', 'HaloMega_trains', 'HaloMega_domeGlass', 'HaloMega_lights', 'HaloMega_dockLights',
    'HaloCity_garden', 'HaloCity_industry', 'HaloTrees', 'K7_bg_box', 'K7_bg_cyl', 'K7_bg_torus', 'K7_fg_box', 'K7_fg_cyl',
    'K7_fg_torus', 'K7_roof_box', 'K7_roof_cyl', 'K7_roof_torus', 'K7_plates', 'K7_roof_slab', 'K7_labels', 'K7_hoses']
};

const { createServer } = await import('vite');
const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { root, zrzuty: [] };
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 400)) throw new Error('tło menu nie gotowe');
  result.renderer = await ev('(() => (window.Core3D.renderer?.isWebGPURenderer ? "webgpu" : "webgl"))()');
  const out = resolve(repo, args.out || join('.tmp/webgpu/zadania/11/menu-czesci', result.renderer));
  mkdirSync(out, { recursive: true });
  await ev('window.__harness.hold(true)');
  // jak scena `menu` w zrzuty.mjs: ziarno z nazwy sceny, 150 klatek intro, rozgrzewka 60 klatek
  const seed = [...'menu'].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  await ev(`(async () => { const H = window.__harness; H.reseed(${seed}); H.scene.hideHud(false); await H.step(150); return true; })()`);
  await ev('window.__harness.frames(60)');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await ev('window.__harness.frames(10)');
  await screenshotPng(cdp, join(out, 'menu.png'));
  // bez DOM menu (tylko kanwy gry), potem części; --bez-bloomu: przełącznik Core3D (post bez bloomu na obu rendererach);
  // --js "kod": własny kod strony przed zrzutami części (np. uniformy nieba: window.__menuBackdrop._objects.skyUniforms)
  if (args['bez-bloomu']) await ev('(() => { window.Core3D.setPerfToggles({ bloom: false }); return true; })()');
  if (args.js) await ev(`(() => { ${args.js}; return true; })()`);
  await ev('window.__harness.scene.hideHud(true)');
  await ev('window.__harness.frames(3)');
  await screenshotPng(cdp, join(out, 'menu__tlo3d.png'));
  for (const [name, names] of Object.entries(PARTS)) {
    const n = await ev(`window.__harness.scene.onlyNamed(${JSON.stringify(names)})`);
    await ev('window.__harness.frames(3)');
    await screenshotPng(cdp, join(out, `menu__${name}.png`));
    await ev('window.__harness.scene.onlyNamed(null)');
    await ev('window.__harness.frames(3)');
    result.zrzuty.push({ czesc: name, obiekty: n });
  }
  result.bledy = logs.errors().filter((l) => !/favicon|AudioSys|Unable to decode audio/.test(l)).slice(0, 20);
  writeFileSync(join(out, 'menu-czesci.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${result.renderer}: ${out}`, JSON.stringify(result.zrzuty), result.bledy.length ? `błędy: ${result.bledy.join(' ; ')}` : '');
} finally {
  await chrome.close();
  await server.close();
}
process.exit(0);
