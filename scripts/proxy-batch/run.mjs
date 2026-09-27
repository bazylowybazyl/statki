// node scripts/proxy-batch/run.mjs [katalog-na-zrzuty]
// Harness Z4 (ShipProxyBatch3D): Vite + headless Chrome (dema/rdzen-cdp.js),
// 200 i 400 ruchomych proxy — draw calle passa ortho i ms CPU na klatkę, zrzuty.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';

const outDir = process.argv[2] || join(process.cwd(), '.tmp', 'proxy-batch', 'out');
mkdirSync(outDir, { recursive: true });

async function shot(cdp, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = join(outDir, name);
  writeFileSync(path, Buffer.from(res.data, 'base64'));
  return path;
}

const { server, base } = await startVite();
const chrome = await startChrome({ width: 1920, height: 1080, gpu: process.env.GPU || 'd3d11', webgpu: false });
const { cdp, logs } = chrome;
const report = {};
try {
  const ok = await navigateAndWait(cdp, `${base}/scripts/proxy-batch/index.html`, 'window.__proxyHarness && window.__proxyHarness.ready', 120000);
  if (!ok) throw new Error('harness się nie załadował');
  report.gpu = await evaluate(cdp, `(() => { const gl = document.getElementById('c').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })()`);

  await evaluate(cdp, '__proxyHarness.setup(200, 7)');
  report.imagesAfterFrames = await evaluate(cdp, '__proxyHarness.waitImages()');

  // Rozgrzewka (kompilacja programów, tekstury), potem pomiary.
  await evaluate(cdp, '__proxyHarness.run(60, { engines: true })');
  report.baselineNoProxies = await evaluate(cdp, '__proxyHarness.run(240, { proxies: false })');
  report.p200_noEngines = await evaluate(cdp, '__proxyHarness.run(300, { engines: false })');
  report.p200_engines = await evaluate(cdp, '__proxyHarness.run(300, { engines: true })');
  report.pick = await evaluate(cdp, '__proxyHarness.pickTest()');
  await evaluate(cdp, '__proxyHarness.frame({ engines: true })');
  await sleep(100);
  report.shot200 = await shot(cdp, 'proxy-200.png');

  await evaluate(cdp, '__proxyHarness.setup(400, 11)');
  await evaluate(cdp, '__proxyHarness.run(60, { engines: true })');
  report.p400_noEngines = await evaluate(cdp, '__proxyHarness.run(300, { engines: false })');
  report.p400_engines = await evaluate(cdp, '__proxyHarness.run(300, { engines: true })');

  // Zbliżenie: te same klasy, gęściej, zoom 1 — światło i dysze.
  await evaluate(cdp, '__proxyHarness.setCamera(7_080_000, 6_290_000, 1.0)');
  await evaluate(cdp, '__proxyHarness.setup(40, 3, 1)');
  await evaluate(cdp, '__proxyHarness.run(90, { engines: true })');
  report.closeUp = await evaluate(cdp, '__proxyHarness.run(30, { engines: true })');
  await sleep(100);
  report.shotClose = await shot(cdp, 'proxy-close.png');

  // Precyzja float32: kamera i statek przesunięte o to samo (+0,37 j.) — obraz ma stać.
  await evaluate(cdp, '__proxyHarness.precisionPose(0, 2)');
  await sleep(100);
  report.precisionA = await shot(cdp, 'precision-a.png');
  await evaluate(cdp, '__proxyHarness.precisionPose(0.37, 2)');
  await sleep(100);
  report.precisionB = await shot(cdp, 'precision-b.png');
  await evaluate(cdp, '__proxyHarness.precisionPose(1234.61, 2)');
  await sleep(100);
  report.precisionC = await shot(cdp, 'precision-c.png');
} catch (err) {
  report.error = String(err?.stack || err);
} finally {
  report.logs = logs.filter((l) => /error|exception|warn/i.test(l)).slice(0, 40);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
