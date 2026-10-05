// Kadry pęknięcia tarczy w demie WebGPU (dema/tarcza-webgpu.html) na prawdziwym GPU.
// Demo z ?test=1 krokowane __demo.step (dt 1/60) — kadry powtarzalne co do klatki:
// kadr spoczynku, potem setHP(0.01) + trafienie (ostatnie HP → pęknięcie) i zrzuty w podanych
// chwilach po trafieniu. Strojenie pęknięcia: SHATTER w dema/tarcza-webgpu/heksy.js.
//
//   node scripts/webgpu/tarcza-pekniecie.mjs [--przed] [--out .tmp/tarcza-pekniecie/po]
//        [--czasy 0.1,0.15,0.2,0.3,0.4,0.55,0.75] [--zoom 3800] [--look 0,0]
//        [--traf 900,-250] [--klasa special|main|pd] [--w 1600 --h 900]
//
// --przed: pliki dema z HEAD (git show) zamiast drzewa roboczego — A/B tej samej sceny.
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const przed = args.przed === '1';
const out = resolve(repo, args.out || `.tmp/tarcza-pekniecie/${przed ? 'przed' : 'po'}`);
mkdirSync(out, { recursive: true });
const W = Number(args.w || 1600), H = Number(args.h || 900);
const zoom = Number(args.zoom || 3800);
const times = String(args.czasy || '0.1,0.15,0.2,0.3,0.4,0.55,0.75').split(',').map(Number);
const [hx, hy] = String(args.traf || '900,-250').split(',').map(Number);
const [lx, ly] = String(args.look || '0,0').split(',').map(Number);
const cls = args.klasa || 'special';

const { createServer } = await import('vite');
const headVersion = {
  name: 'tarcza-przed', enforce: 'pre',
  load(id) {
    if (!przed) return null;
    const m = id.split('?')[0].replace(/\\/g, '/').match(/\/dema\/(tarcza-webgpu(?:\.js|\/[A-Za-z0-9_-]+\.js))$/);
    return m ? execSync(`git show HEAD:dema/${m[1]}`, { cwd: repo, maxBuffer: 1 << 26 }).toString() : null;
  }
};
const server = await createServer({
  root: repo, configFile: resolve(repo, 'vite.config.js'), logLevel: 'error', plugins: [headVersion],
  server: { port: Number(args.port || 5440), strictPort: false, hmr: false, watch: { ignored: ['**/*'] } }
});
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
const report = { przed, zoom, traf: [hx, hy], klasa: cls, kadry: [] };
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/tarcza-webgpu.html?test=1` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || !!window.__demo.error)', 180000)) throw new Error('demo nie wstało');
  const err = await evaluate(cdp, 'window.__demo.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await evaluate(cdp, `document.getElementById('panel').classList.add('hidden'); window.__demo.lookAt(${lx}, ${ly}, ${zoom}); window.__demo.step(4)`);
  await sleep(150);
  await screenshotPng(cdp, join(out, 'a-spoczynek.png'));
  await evaluate(cdp, `(() => { const d = window.__demo; d.setHP(0.01); return d.hit(${hx}, ${hy}, 400, '${cls}'); })()`);
  let t = 0;
  for (const T of times) {
    const n = Math.max(1, Math.round((T - t) * 60));
    await evaluate(cdp, `window.__demo.step(${n})`, 240000);
    t += n / 60;
    await sleep(120);
    const f = join(out, `t${t.toFixed(3)}.png`);
    await screenshotPng(cdp, f);
    const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
    report.kadry.push({ t: Number(t.toFixed(3)), plik: f, stan: st.state, odlamki: st.debrisFlying, iskry: st.sparks, swiatla: st.lights });
    console.log(`t=${t.toFixed(3)} s → ${f}  (${st.state}, iskry ${st.sparks}, światła ${st.lights})`);
  }
} catch (e) {
  console.log(String(e.stack || e));
  failed = true;
} finally {
  const errs = logs.errors().filter((l) => !/TimestampQueryPool|timestamp/i.test(l));
  report.bledy = errs;
  console.log(`błędy konsoli / WebGPU: ${errs.length}`);
  for (const e of errs.slice(0, 20)) console.log('  ', e.slice(0, 800));
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
process.exit(failed || report.bledy.length ? 1 : 0);
