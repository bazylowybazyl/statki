// HARNESS dema „3D gaz” (dema/3d-gaz.html — gaz i pył hali K-7 na siatce 3D, docs/BRIEF-gaz-hali-3d.md, plan
// docs/PLAN-3d-gaz.md): Vite (własny serwer bez przeładowań) + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/3d-gaz-demo.mjs --tryb e0 [--out .tmp/3d-gaz/E0] [--komorki 48,56,64] [--jacobi 30]
//        [--cisnienie buffer,texture] [--n0 20 --n1 120] [--powtorz 2] [--port 5441]
//
// Tryb e0: pomiar SZKIELETU kroku (src/3d/hallGas3d/hallGas3dBench.js — docelowe tekstury, bufory i liczby próbek, arytmetyka
// zastępcza) przy komórce 48 / 56 / 64 j.: ms GPU na krok (nachylenie czasu kolejki dla n0 / n1 kroków), części (adwekcja,
// reakcja, Jacobi, reszta), CPU kodowania, pamięć. Pomiar powtarzany `powtorz` razy (mediana) — maszyna bez innych obciążeń.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const mode = String(args.tryb || 'e0');
const out = resolve(repo, args.out || `.tmp/3d-gaz/${mode.toUpperCase()}`);
mkdirSync(out, { recursive: true });
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);

const { server, base } = await startVite(Number(args.port || 5441));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { tryb: mode, data: new Date().toISOString() };

const median = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/3d-gaz.html?shot=1&pokaz=0` });
  if (!await waitFor(cdp, '!!(window.__gaz && window.__gaz.ready)', 240000, 400)) throw new Error('demo nie wstało');
  await sleep(2000);
  report.gpu = await ev(`(async () => {
    const a = window.Core3D.renderer.backend.adapter;
    const info = a?.info || (a?.requestAdapterInfo ? await a.requestAdapterInfo() : null);
    return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null;
  })()`);
  console.log('GPU:', JSON.stringify(report.gpu));

  if (mode === 'e0') {
    const cells = String(args.komorki || '48,56,64').split(',').map(Number);
    const pressure = String(args.cisnienie || 'buffer,texture').split(',');
    const opts = { cells, pressure, jacobi: Number(args.jacobi || 30), n0: Number(args.n0 || 20), n1: Number(args.n1 || 120) };
    const reps = Math.max(1, Number(args.powtorz || 2));
    const runs = [];
    for (let r = 0; r < reps; r++) {
      const res = await ev(`window.__gaz.bench(${JSON.stringify(opts)})`, 900000);
      runs.push(res);
      console.log(`--- powtórzenie ${r + 1}/${reps}`);
      for (const rec of res) {
        const p = rec.parts;
        console.log(`${String(rec.cell).padStart(3)} j. ${rec.pressure.padEnd(7)} ${rec.domain.nx}×${rec.domain.nd}×${rec.domain.nh} = ${rec.domain.cells} kom.  ${rec.memMB} MB  `
          + `krok ${p.all.msPerStep} ms (CPU ${p.all.cpuMsPerStep})  adw. ${p.adv.msPerStep}  reakcja ${p.react.msPerStep}  `
          + `Jacobi×${rec.jacobi} ${p.jacobi.msPerStep}  reszta ${p.rest.msPerStep}  dispatche ${p.all.dispatches}`);
      }
    }
    // mediana powtórzeń
    report.wyniki = runs[0].map((rec, i) => {
      const m = { cell: rec.cell, pressure: rec.pressure, jacobi: rec.jacobi, domain: rec.domain, memMB: rec.memMB, parts: {} };
      for (const part of Object.keys(rec.parts)) {
        m.parts[part] = {
          msPerStep: +median(runs.map((r) => r[i].parts[part].msPerStep)).toFixed(4),
          cpuMsPerStep: +median(runs.map((r) => r[i].parts[part].cpuMsPerStep)).toFixed(4),
          dispatches: rec.parts[part].dispatches
        };
      }
      return m;
    });
    report.surowe = runs;
    console.log('=== mediana');
    for (const m of report.wyniki) {
      const p = m.parts;
      console.log(`${m.cell} j. ${m.pressure}: krok ${p.all.msPerStep} ms GPU, CPU ${p.all.cpuMsPerStep} ms, pamięć ${m.memMB} MB`);
    }
  } else {
    throw new Error(`nieznany tryb ${mode}`);
  }
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools/.test(l)).slice(0, 40);
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 8));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki:', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
