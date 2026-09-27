// node scripts/proxy-batch/gallery.mjs [katalog-na-zrzuty] — galerie kadłubów proxy (orientacja, dysze, światło).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';

const outDir = process.argv[2] || join(process.cwd(), '.tmp', 'proxy-batch', 'out');
mkdirSync(outDir, { recursive: true });

const SMALL = ['inter_station_shuttle', 'container_ship', 'pirate_raider', 'smuggler', 'terran_frigate', 'terran_destroyer',
  'belter', 'surveyor', 'construction_tug', 'repair_drone', 'distress_beacon_ship', 'salvage_hauler'];
const LARGE = ['long_haul_freighter', 'heavy_freighter', 'megafreighter', 'heavy_harvester', 'refinery_tender', 'tanker'];

const { server, base } = await startVite();
const chrome = await startChrome({ width: 1920, height: 1080, gpu: 'd3d11', webgpu: false });
const { cdp, logs } = chrome;
async function shot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name), Buffer.from(res.data, 'base64'));
}
async function scene(expr, name) {
  await evaluate(cdp, expr);
  await evaluate(cdp, '__proxyHarness.waitImages()');
  await evaluate(cdp, '__proxyHarness.runRealtime(1200, { engines: true })');
  await shot(name);
}
try {
  if (!await navigateAndWait(cdp, `${base}/scripts/proxy-batch/index.html`, 'window.__proxyHarness && window.__proxyHarness.ready')) throw new Error('harness');
  await scene(`__proxyHarness.gallery(${JSON.stringify(SMALL)}, 1.35, 4, 330, 240, 0)`, 'gallery-small-east.png');
  await scene(`__proxyHarness.gallery(${JSON.stringify(SMALL)}, 1.35, 6, 240, 330, Math.PI / 2)`, 'gallery-small-south.png');
  await scene(`__proxyHarness.gallery(${JSON.stringify(LARGE)}, 0.3, 2, 3000, 1100, 0)`, 'gallery-large-east.png');
  console.log(JSON.stringify(await evaluate(cdp, '__proxyHarness.stats()')));
} finally {
  console.log(logs.filter((l) => /error|exception|warn/i.test(l)).slice(0, 20).join('\n'));
  await chrome.close();
  await server.close();
}
