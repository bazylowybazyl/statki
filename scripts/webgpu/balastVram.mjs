// BALAST PAMIĘCI KARTY dla pomiarów (2026-10-28, zgłoszenie „upadek bazy: 10 kl/s, karta się poci”): osobny headless
// Chrome (osobny proces GPU — jak inny program, np. klient gry) zajmuje `gb` GB w buforach storage po 256 MB, wypełnia je
// compute i co ~16 ms dotyka każdy (jeden dispatch na bufor) — wszystkie zostają w zestawie roboczym karty, więc gra pod
// pomiarem ma mniej VRAM, jak u gracza z otwartymi programami. Użycie w narzędziu:
//   const b = await startVramBallast({ gb: 6 }); … await b.stop();
// albo samodzielnie: node scripts/webgpu/balastVram.mjs --gb 6 --s 300
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startChrome, startStaticServer, waitFor, evaluate, sleep, parseArgs } from './wspolne.mjs';

const PAGE = `<!doctype html><meta charset="utf-8"><title>balast VRAM</title><body>balast</body>`;

const SETUP = (gb) => `(async () => {
  if (!navigator.gpu) return { blad: 'brak navigator.gpu' };
  const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!ad) return { blad: 'brak adaptera' };
  const CH = 256 * 1024 * 1024;
  const dev = await ad.requestDevice({ requiredLimits: { maxBufferSize: Math.max(CH, Math.min(ad.limits.maxBufferSize, CH)),
    maxStorageBufferBindingSize: Math.max(CH, Math.min(ad.limits.maxStorageBufferBindingSize, CH)) } });
  let lost = null;
  dev.lost.then((i) => { lost = i.message || 'lost'; });
  const code = \`@group(0) @binding(0) var<storage, read_write> b: array<u32>;
@compute @workgroup_size(256) fn fill(@builtin(global_invocation_id) g: vec3u) { let i = g.x + g.y * 262144u; if (i < arrayLength(&b)) { b[i] = i ^ 0x9e3779b9u; } }
@compute @workgroup_size(64) fn touch(@builtin(global_invocation_id) g: vec3u) { let n = arrayLength(&b); let i = (g.x * 1048573u) % n; b[i] = b[i] + 1u; }\`;
  const mod = dev.createShaderModule({ code });
  const fill = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'fill' } });
  const touch = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'touch' } });
  const n = Math.max(1, Math.round(${gb} * 4));
  const B = window.__balast = { n: 0, gb: 0, ticks: 0, lost: null, groups: [], bufs: [] };
  for (let k = 0; k < n; k++) {
    const buf = dev.createBuffer({ size: CH, usage: GPUBufferUsage.STORAGE });
    const gf = dev.createBindGroup({ layout: fill.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const gt = dev.createBindGroup({ layout: touch.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(fill); p.setBindGroup(0, gf); p.dispatchWorkgroups(1024, 256); p.end();
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    B.bufs.push(buf); B.groups.push(gt); B.n = k + 1; B.gb = B.n / 4;
    if (lost) break;
  }
  B.timer = setInterval(() => {
    const enc = dev.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(touch);
    for (const g of B.groups) { p.setBindGroup(0, g); p.dispatchWorkgroups(4); }
    p.end();
    dev.queue.submit([enc.finish()]);
    B.ticks++;
    B.lost = lost;
  }, 16);
  return { n: B.n, gb: B.gb, lost };
})()`;

/** Balast `gb` GB w osobnym Chrome; zwraca { info, stan(), stop() }. */
export async function startVramBallast({ gb = 6, port = 5397 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'balast-vram-'));
  writeFileSync(join(dir, 'index.html'), PAGE);
  const srv = await startStaticServer(port, dir);
  const chrome = await startChrome({ width: 320, height: 200 });
  const { cdp } = chrome;
  await cdp.send('Page.navigate', { url: `${srv.base}/index.html` });
  await waitFor(cdp, 'document.readyState === "complete"', 30000, 200);
  const info = await evaluate(cdp, SETUP(gb), 600000);
  return {
    info,
    stan: () => evaluate(cdp, '(() => { const B = window.__balast; return B ? { n: B.n, gb: B.gb, ticks: B.ticks, lost: B.lost } : null; })()', 30000).catch((e) => ({ blad: e.message })),
    async stop() { try { await evaluate(cdp, '(() => { const B = window.__balast; if (B) { clearInterval(B.timer); for (const b of B.bufs) b.destroy(); } return true; })()', 30000); } catch (_) {}
      await chrome.close(); await srv.close(); }
  };
}

// samodzielnie: node scripts/webgpu/balastVram.mjs --gb 6 --s 300
if (process.argv[1] && /balastVram\.mjs$/.test(process.argv[1])) {
  const a = parseArgs();
  const b = await startVramBallast({ gb: Number(a.gb || 6) });
  console.log('balast:', JSON.stringify(b.info));
  await sleep(Number(a.s || 300) * 1000);
  console.log('stan:', JSON.stringify(await b.stan()));
  await b.stop();
  process.exit(0);
}
