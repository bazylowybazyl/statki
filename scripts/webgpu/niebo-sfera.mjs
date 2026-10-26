// Wypiek NIEBA-SFERY (DECYZJE-2 N2): equirect całego nieba dla niebo-sfery gry (src/3d/sky3D.js) — galaktyka na wielkim
// kole + łaty mgławic „gra” i „kolorowa” (dema/niebo-webgpu.js: __demo.sfera), Vite + headless Chrome na GPU.
//
//   node scripts/webgpu/niebo-sfera.mjs [--res 1] [--seed 1] [--out .tmp/niebo/sfera] [--nazwa sfera]
//        [--zapisz 1]          → public/assets/sky-equirect.webp (WebP bezstratny 6144 × 3072)
//        [--kadry 1]           → podgląd: całość (equirect 2048 × 1024) i kadry gry 1920 × 1080 / 5120 × 1440 (32:9)
//        [--set klucz=w,…]     → wartości stylu galaktyki (np. ekspozycja=0.02)
//
// Podgląd bez bloomu gry (obraz wyświetlany → sRGB); w grze: scripts/webgpu/niebo-gra.mjs --query niebo=sfera.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/niebo/sfera');
mkdirSync(out, { recursive: true });
const name = args.nazwa || 'sfera';
const res = Number(args.res || 1);
const seed = Number(args.seed || 1);
const values = {};
for (const kv of String(args.set || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  values[k] = Number(v);
}

const { server, base } = await startVite(Number(args.port || 5421));
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 900000) => evaluate(cdp, e, t);
const saveDataUrl = (url, file) => { writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); return file; };
const report = { res, seed, values, bledy: [] };
let failed = false;

try {
  // demo wypieka na starcie płaską galaktykę — tu w ¼ (szybko), sfera osobno
  await cdp.send('Page.navigate', { url: `${base}/dema/niebo-webgpu.html?test=1&res=0.25` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 240000, 300)) throw new Error('demo nie wstało');
  const err0 = await ev('window.__demo.error || ""');
  if (err0) throw new Error(`demo: ${err0}`);
  const r = await ev(`window.__demo.sfera.bake(${JSON.stringify({ res, seed, values })})`);
  report.wypiek = r;
  console.log(`sfera ${r.width} × ${r.height}: ${r.ms.toFixed(0)} ms (passy: ${Object.entries(r.passMs).map(([k, t]) => `${k} ${Math.round(t)}`).join(', ')})`);
  // --plaska 1: ten sam kadr gry z płaskiej tekstury (nastawa gra, ziarno 1, bez gwiazd — jak public/assets/nebula.webp),
  // podgląd wypiekacza płaskiego bez bloomu — porównanie jasności i barwy z kadrem startowym sfery
  if (args.plaska === '1') {
    await ev(`window.__demo.setRes(1)`);
    await ev(`window.__demo.configure(${JSON.stringify({ styl: 'galaktyka', preset: 'gra', seed: 1, values: { gwiazdy: 0 } })})`);
    await ev('window.__demo.bake()');
    const f = saveDataUrl(await ev(`window.__demo.snapshot('gra', 1920, 1080, { zoom: 0.45, viewH: 1080, bloom: false })`), join(out, `${name}-plaska-gra.png`));
    console.log('kadr', f);
  }
  if (args.kadry !== '0') {
    const views = [
      ['calosc', 2048, 1024, {}],
      ['gra', 1920, 1080, {}],
      ['gra', 5120, 1440, {}],
      ['gra', 1920, 1080, { lonDeg: 22, latDeg: 30 }],
      ['gra', 1920, 1080, { lonDeg: -150, latDeg: -30 }],
      ['gra', 1920, 1080, { lonDeg: 150, latDeg: 0 }],
      ['gra', 1920, 1080, { lonDeg: 60, latDeg: -70 }]
    ];
    report.kadry = [];
    for (const [v, w, h, o] of views) {
      const tag = v === 'calosc' ? 'calosc' : `gra-${w}x${h}${o.lonDeg !== undefined ? `-l${o.lonDeg}b${o.latDeg}` : ''}`;
      const f = saveDataUrl(await ev(`window.__demo.sfera.snapshot(${JSON.stringify(v)}, ${w}, ${h}, ${JSON.stringify(o)})`), join(out, `${name}-${tag}.png`));
      report.kadry.push(f);
      console.log('kadr', f);
    }
  }
  if (args.zapisz === '1' || args.eksport) {
    const info = await ev(`window.__demo.sfera.exportPrepare(${seed}, 'image/webp', 1)`);
    const parts = [];
    for (let i = 0; i < info.chunks; i++) parts.push(await ev(`window.__demo.exportChunk(${i})`));
    const file = args.zapisz === '1' ? resolve(repo, 'public/assets/sky-equirect.webp') : join(out, `${name}.webp`);
    writeFileSync(file, Buffer.from(parts.join(''), 'base64'));
    report.eksport = { file, ...info };
    console.log(`eksport ${info.width} × ${info.height}: ${file} (${(info.bytes / 1048576).toFixed(1)} MB)`);
  }
} catch (err) {
  console.log(String(err?.stack || err));
  failed = true;
} finally {
  report.bledy = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  if (report.bledy.length) {
    console.log(`błędy konsoli / WebGPU: ${report.bledy.length}`);
    for (const e of report.bledy.slice(0, 20)) console.log('  ', e.slice(0, 1500));
  }
  writeJson(join(out, `${name}.json`), report);
  await chrome.close();
  await server.close();
}
process.exit(failed || report.bledy.length ? 1 : 0);
