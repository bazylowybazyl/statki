// node scripts/proxy-batch/precision.mjs [katalog] — precyzja float32 przy 7 mln j.:
// kamera i statek przesunięte o to samo → obraz kadłuba ma być identyczny.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';

const outDir = process.argv[2] || join(process.cwd(), '.tmp', 'proxy-batch', 'out');
mkdirSync(outDir, { recursive: true });
const { server, base } = await startVite();
const chrome = await startChrome({ width: 1920, height: 1080, gpu: 'd3d11', webgpu: false });
const { cdp } = chrome;
try {
  if (!await navigateAndWait(cdp, `${base}/scripts/proxy-batch/index.html`, 'window.__proxyHarness && window.__proxyHarness.ready')) throw new Error('harness');
  await evaluate(cdp, '__proxyHarness.precisionPose(0, 2)');
  await evaluate(cdp, '__proxyHarness.waitImages()');
  const offsets = [0, 0.37, 0.61, 1234.61, 55555.13];
  for (const zoom of [2, 1.8, 0.9]) {
    for (const off of offsets) {
      await evaluate(cdp, `__proxyHarness.precisionPose(${off}, ${zoom})`);
      await sleep(120);
      await evaluate(cdp, `__proxyHarness.precisionPose(${off}, ${zoom})`);
      const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `prec-z${zoom}-o${off}.png`), Buffer.from(res.data, 'base64'));
    }
  }
} finally {
  await chrome.close();
  await server.close();
}
