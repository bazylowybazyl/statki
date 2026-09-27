// node scripts/proxy-batch/lighting.mjs [katalog] — światło proxy vs kadłub belkowy NPC (ten sam sprite).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate } from '../../dema/rdzen-cdp.js';

const outDir = process.argv[2] || join(process.cwd(), '.tmp', 'proxy-batch', 'out');
mkdirSync(outDir, { recursive: true });
const { server, base } = await startVite();
const chrome = await startChrome({ width: 1920, height: 1080, gpu: 'd3d11', webgpu: false });
const { cdp, logs } = chrome;
const cases = [
  { hull: 'container_ship', angle: 0.3, zoom: 1.6, gap: 420, sun: null, name: 'light-container' },
  { hull: 'container_ship', angle: 2.4, zoom: 1.6, gap: 420, sun: { x: 7_300_000, y: 6_100_000 }, name: 'light-container-sun2' },
  { hull: 'terran_destroyer', angle: -0.8, zoom: 2.2, gap: 330, sun: null, name: 'light-destroyer' }
];
const out = [];
try {
  if (!await navigateAndWait(cdp, `${base}/scripts/proxy-batch/index.html`, 'window.__proxyHarness && window.__proxyHarness.ready')) throw new Error('harness');
  for (const c of cases) {
    const r = await evaluate(cdp, `__proxyHarness.lightingCompare(${JSON.stringify(c.hull)}, ${c.angle}, ${c.zoom}, ${c.gap}, ${JSON.stringify(c.sun)})`);
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${c.name}.png`), Buffer.from(res.data, 'base64'));
    out.push({ ...c, ...r });
  }
} finally {
  writeFileSync(join(outDir, 'lighting.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  console.log(logs.filter((l) => /error|exception|warn/i.test(l)).slice(0, 20).join('\n'));
  await chrome.close();
  await server.close();
}
