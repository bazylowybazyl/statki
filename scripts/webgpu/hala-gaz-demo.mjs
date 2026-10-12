// GAZ-GPT: E0 — ABAB w jednym przebiegu, mediany Core3D. E1 uzupełnia ten sam protokół.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, evaluate, waitFor, sleep, screenshotPng, parseArgs, repo, writeJson } from './wspolne.mjs';
const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/hala-gaz/E0');
mkdirSync(out, { recursive: true });
const [width, height] = String(args.rozmiar || '1600x900').split('x').map(Number);
const { server, base } = await startVite(Number(args.port || 5408));
const chrome = await startChrome({ width, height });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (s) => evaluate(cdp, s, 120000);
const report = { name: 'GAZ-GPT', stage: 'E0', width, height, rows: [] };
try {
  for (const cell of [48, 56, 64]) {
    await cdp.send('Page.navigate', { url: `${base}/dema/hala-gaz-webgpu.html?shot=1&pokaz=0&komorka=${cell}&etap=E0` });
    if (!await waitFor(cdp, 'window.__dok?.ready && window.__gaz?.benchmark', 180000)) throw new Error('demo nie wystartowało');
    await ev('window.HallDustTune.enabled = false; window.__dok.setSpeed(0); window.Core3D.gpuTimerSampleEvery = 1;');
    await sleep(1000);
    const data = await ev(`(async () => {
      const c = window.Core3D, g = window.__gaz, b = g.benchmark;
      const med = a => { a.sort((x,y)=>x-y); return a.length ? a[a.length>>1] : null; };
      const batches = [];
      for (const on of [false,true,false,true]) {
        g.on = on; const render = [], compute = [];
        const start = performance.now();
        while (performance.now() - start < 2500) {
          await new Promise(r => setTimeout(r, 25));
          if (c.gpuFrameMs > 0) render.push(c.gpuFrameMs);
          if (c.gpuComputeMs >= 0) compute.push(c.gpuComputeMs);
        }
        batches.push({ on, render: med(render), compute: med(compute), samples: render.length });
      }
      return { cell: b.domain.h, domain: b.domain, memoryBytes: b.memoryBytes, dispatches: b.list.length,
        adapter: c.renderer.backend.device.adapterInfo, batches };
    })()`);
    report.rows.push(data);
    await screenshotPng(cdp, join(out, `szkielet-${cell}.png`));
    writeJson(join(out, 'raport.json'), report);
    console.log(JSON.stringify(data));
  }
} catch (e) { report.fatal = String(e.stack || e); console.error(report.fatal); process.exitCode = 1; }
finally { report.errors = logs.errors(); writeJson(join(out, 'raport.json'), report); await chrome.close(); await server.close(); }
