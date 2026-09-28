// Zrzuty dema rakiet WebGPU (dema/rakiety-webgpu.html) do porównania z galerią rakiet gry
// (scripts/webgpu/zrzuty.mjs, sesja „rakiety” — zadanie 19). Demo krokowane synchronicznie
// (`window.__demo.step(n, dt)` w pauzie) — kadry powtarzalne co do klatki symulacji.
//
//   node scripts/webgpu/rakiety-demo.mjs [--out .tmp/webgpu/zadania/19/demo] [--port 5354]
//        [--ujecia salwa:2.3,zblizenie@2:0.12,supernowa@0:0.33,supernowa@0:1.9,deszcz:3.5]
//
// Ujęcie:
//   scenariusz:czas            — czas SYMULACJI od startu scenariusza [s] (tempo scenariusza jak
//                                w demie — „zblizenie” ×0,3, „novaZoom” ×0,4);
//   scenariusz@n:czas          — krokuje, aż rakiet w locie będzie najwyżej n (po wybuchach),
//                                potem jeszcze `czas` s symulacji (kadry jak galeria gry:
//                                trafienie tuż po wybuchu, Supernowa w błysku i w pozostałości).
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/19/demo');
const shots = String(args.ujecia || 'salwa:2.3,zblizenie@2:0.12,supernowa@0:0.33,supernowa@0:1.9,novaZoom:2.0,deszcz:3.5,poscig:1.2')
  .split(',').map((s) => {
    const [head, t] = s.split(':');
    const [sc, after] = head.split('@');
    return { sc, after: after === undefined ? null : Number(after), t: Number(t) || 0, tag: s.replace(/[:@.]/g, '_') };
  });

const { server, base } = await startVite(Number(args.port || 5354));
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
try {
  for (const shot of shots) {
    const { sc, after, t } = shot;
    await cdp.send('Page.navigate', { url: `${base}/dema/rakiety-webgpu.html?scenario=${sc}&shot=1&loop=0` });
    if (!await waitFor(cdp, 'window.__demo && window.__demo.S.ready', 120000)) throw new Error(`demo nie wstało (${sc})`);
    await evaluate(cdp, `window.__demo.pause(true); window.__demo.clear(); window.__demo.scenario(${JSON.stringify(sc)}); true`);
    const steps = await evaluate(cdp, `(() => {
      const D = window.__demo; const S = D.S; const dt = 1 / 60; let n = 0;
      const after = ${after === null ? 'null' : after};
      if (after !== null) {
        // Najpierw coś musi wystartować (kolejka scenariusza), potem wybuchy.
        let seen = 0;
        for (let k = 0; k < 2400; k++) { D.step(1, dt); n++; seen = Math.max(seen, D.flight.count); if (seen > after && D.flight.count <= after) break; }
      }
      const m = Math.round(${t} / (S.timeScale * dt));
      if (m > 0) { D.step(m, dt); n += m; }
      return n;
    })()`, 240000);
    await sleep(300);
    const f = join(out, `demo-${shot.tag}.png`);
    await screenshotPng(cdp, f);
    const st = await evaluate(cdp, 'JSON.stringify(window.__demo.stats())');
    console.log(`${shot.tag} (${steps} kroków) → ${f}\n   ${st}`);
  }
} catch (err) {
  console.log(String(err.stack || err));
  failed = true;
} finally {
  const errs = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  console.log(`błędy konsoli / WebGPU: ${errs.length}`);
  for (const e of errs.slice(0, 20)) console.log('  ', e.slice(0, 800));
  await chrome.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
