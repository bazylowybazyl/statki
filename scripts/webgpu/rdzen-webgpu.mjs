// Harness dema rdzenia reaktora na WebGPU (dema/rdzen-webgpu.html): headless Chrome na prawdziwym
// GPU (D3D12 przez Dawn), klatki z zegarem ręcznym (?test=1 + __rdzen2.runFrames).
//
//   node scripts/webgpu/rdzen-webgpu.mjs --tryb test                 → wszystkie sceny, błędy WebGPU/WGSL/JS
//   node scripts/webgpu/rdzen-webgpu.mjs --tryb zrzuty [--scena gallery] [--wariant jet] [--czasy 1.2,3.7,4.0]
//                                        [--kadlub atlas] [--sledz orb|jet|core --zoom 1.2] [--czyste]
//   node scripts/webgpu/rdzen-webgpu.mjs --tryb wydajnosc [--scena gallery --wariant shatter --od 3.4 --klatek 150]
//                                        → CPU i GPU klatek wokół detonacji
// Wyniki: .tmp/rdzen-webgpu/<tryb>/*.png + wyniki.json. Rozmiar: --size 1600x900.
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, parseArgs, repo, sleep } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'zrzuty';
const [W, H] = String(args.size || '1600x900').split('x').map(Number);
const outDir = resolve(repo, args.out || `.tmp/rdzen-webgpu/${mode}`);
mkdirSync(outDir, { recursive: true });
const port = Number(args.port || 5371);

const vite = await startVite(port);
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (expr, t = 600000) => evaluate(cdp, expr, t);
const results = { mode, size: [W, H], scenes: {} };

async function open(scene, extra = '') {
  const url = `${vite.base}/dema/rdzen-webgpu.html?test=1&scene=${scene}${extra}`;
  await cdp.send('Page.navigate', { url });
  const ok = await waitFor(cdp, '!!(window.__rdzen2 && (window.__rdzen2.ready || window.__rdzen2.error))', 180000);
  if (!ok) throw new Error(`demo nie wstało: ${scene}`);
  const err = await ev('window.__rdzen2.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await ev('window.__rdzen2.runFrames(2, 60).then(() => true)');
}

// Czas sceny do `t` (s, czas symulacji) klatkami 60 Hz; realtime co 8 klatek (GPU nadąża, kompilacje w tle).
async function advanceTo(t, fps = 60) {
  const now = await ev('window.__rdzen2.sceneTime()');
  const n = Math.max(0, Math.round((t - now) * fps));
  if (n > 0) await ev(`window.__rdzen2.runFrames(${n}, ${fps}).then(() => true)`);
}

async function shot(name) {
  await ev('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))))');
  return screenshotPng(cdp, resolve(outDir, `${name}.png`));
}

try {
  if (mode === 'test') {
    for (const scene of ['gallery', 'meltdown', 'chain', 'jet', 'orb', 'range']) {
      logs.clear();
      const t0 = Date.now();
      await open(scene);
      await advanceTo(scene === 'range' ? 2 : 9);
      const st = await ev('window.__rdzen2.stats()');
      results.scenes[scene] = { ms: Date.now() - t0, stats: st, errors: logs.errors().slice(0, 30) };
      console.log(`${scene.padEnd(9)} detonacji ${st.detonations} wraków ${st.wrecks} dym ${st.smoke} błędów ${results.scenes[scene].errors.length}`);
      for (const e of results.scenes[scene].errors.slice(0, 6)) console.log('   ', e.slice(0, 300));
    }
  } else if (mode === 'zrzuty') {
    const scene = args.scena || 'gallery';
    const variant = args.wariant ? `&variant=${args.wariant}` : '';
    const hull = args.kadlub ? `&hull=${args.kadlub}` : '';
    const times = String(args.czasy || '0.8,2.4,3.5,3.66,3.8,4.1,4.6,5.5,7.0,9.0').split(',').map(Number);
    await open(scene, variant + hull + (args.czyste ? '&clean=1' : ''));
    const shots = [];
    for (const t of times) {
      await advanceTo(t);
      // --sledz orb|jet|core [--zoom 1.2]: kamera na pierwszą kulę / wylot strumienia / rdzeń celu
      // (jedna klatka 1/60 s, żeby obraz był z nowej kamery).
      if (args.sledz) {
        const zoom = Number(args.zoom || 1.2);
        const hit = await ev(`(() => { const R = window.__rdzen2, w = R.world; let p = null;
          if (${JSON.stringify(args.sledz)} === 'orb' && w.orbs[0]) p = w.orbs[0];
          else if (${JSON.stringify(args.sledz)} === 'jet' && w.jets[0]) p = { x: w.jets[0].originX, y: w.jets[0].originY };
          else if (${JSON.stringify(args.sledz)} === 'core') { R.focus(${zoom}); return true; }
          if (p) R.setCamera(p.x, p.y, ${zoom}); return !!p; })()`);
        if (hit) await ev('window.__rdzen2.runFrames(1, 60).then(() => true)');
      }
      const name = `${scene}${args.wariant ? '-' + args.wariant : ''}${args.sledz ? '-' + args.sledz : ''}-t${t.toFixed(2).replace('.', '_')}`;
      shots.push(await shot(name));
      console.log('  ', name);
    }
    results.scenes[scene] = { shots, stats: await ev('window.__rdzen2.stats()'), errors: logs.errors().slice(0, 30) };
    for (const e of results.scenes[scene].errors.slice(0, 10)) console.log('   ', e.slice(0, 300));
  } else if (mode === 'pasma') {
    // A/B pasm HDR (bufor sceny przed bloomem): wszystkie warstwy, potem każda grupa siatek ukryta.
    const scene = args.scena || 'meltdown';
    const variant = args.wariant ? `&variant=${args.wariant}` : '';
    await open(scene, variant);
    const times = String(args.czasy || '7.3,7.4,7.6').split(',').map(Number);
    const names = await ev('window.__rdzen2.meshNames()');
    console.log('siatki:', Object.keys(names).join(', '));
    const groups = String(args.grupy || '').split(';').filter(Boolean).map((g) => g.split(','));
    const fmt = (h) => `>0,9 ${(h.over09 * 100).toFixed(1)}%  biel≥6 ${(h.white * 100).toFixed(2)}%  max ${h.max.toFixed(1)}  śr ${h.mean.toFixed(3)}`;
    results.bands = [];
    for (const t of times) {
      await advanceTo(t);
      await ev('window.__rdzen2.pause(true)');
      const base = await ev('window.__rdzen2.hdr()');
      console.log(`t=${t}: wszystko: ${fmt(base)}`);
      const row = { t, base, off: {} };
      for (const g of groups) {
        const h = await ev(`window.__rdzen2.hdr(0, 0, undefined, undefined, ${JSON.stringify(g)})`);
        row.off[g.join('+')] = h;
        console.log(`   bez ${g.join('+').padEnd(40)} ${fmt(h)}`);
      }
      results.bands.push(row);
      await ev('window.__rdzen2.pause(false)');
    }
  } else if (mode === 'wydajnosc') {
    // Klatki wokół detonacji (--scena, --wariant, --od s, --klatek n): czas CPU samej klatki
    // (fizyka + render, bez czekania na rAF) i zegar GPU (Core3D.gpuFrameMs, próbkowany).
    const scene = args.scena || 'gallery';
    await open(scene, `&variant=${args.wariant || 'shatter'}`);
    await advanceTo(Number(args.od || 3.4));
    const frames = [];
    const n = Number(args.klatek || 150);
    for (let k = 0; k < n; k++) {
      const f = await ev(`(async () => {
        const t0 = performance.now();
        await window.__rdzen2.runFrames(1, 60);
        const cpu = performance.now() - t0;
        await new Promise((ok) => requestAnimationFrame(() => ok()));
        const st = window.__rdzen2.stats();
        return { t: st.t, cpu, gpu: st.render.gpu || 0, calls: st.render.calls || 0, fx: st.fx.cpuMs || 0, smoke: st.smoke };
      })()`);
      frames.push(f);
    }
    results.frames = frames;
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
    const cpu = frames.map((f) => f.cpu), gpu = frames.map((f) => f.gpu);
    console.log(`CPU klatki: mediana ${q(cpu, 0.5).toFixed(2)} ms, p95 ${q(cpu, 0.95).toFixed(2)}, max ${Math.max(...cpu).toFixed(2)}`);
    console.log(`GPU klatki: mediana ${q(gpu, 0.5).toFixed(2)} ms, p95 ${q(gpu, 0.95).toFixed(2)}, max ${Math.max(...gpu).toFixed(2)}`);
    const worst = [...frames].sort((a, b) => b.cpu - a.cpu).slice(0, 6);
    console.log('najgorsze (CPU):', worst.map((f) => `${f.t.toFixed(2)}s ${f.cpu.toFixed(1)}ms gpu ${f.gpu.toFixed(2)} fx ${f.fx.toFixed(2)}`).join(' | '));
  }
} finally {
  results.allErrors = logs.errors().slice(0, 60);
  writeJson(resolve(outDir, 'wyniki.json'), results);
  await chrome.close();
  await vite.server.close();
}
