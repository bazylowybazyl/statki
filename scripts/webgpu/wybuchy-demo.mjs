// Zrzuty dema dema/wybuchy-webgpu.html (gaz 3D, wybuchy budowli — plan docs/PLAN-zniszczenia-swiata-3d.md § 12).
// Własny Vite (bez HMR — odporny na równoległe sesje) + headless Chrome z WebGPU (pomocniki dema rdzenia).
//   node scripts/webgpu/wybuchy-demo.mjs [--sceny building,blast,blaze,reactor,chain] [--klatki 0.05,0.2,0.5,1,2,4,8]
//        [--rozmiar 14] [--out katalog] [--szer 1280] [--wys 720] [--n 64]
// Na scenę: pauza pętli, wybuch w stałym punkcie stacji, kroki symulacji po 1/60 s, zrzut w chwilach
// --klatki (s od wybuchu). Arkusz: wiersz = scena, kolumny = chwile. Błędy konsoli i statystyki w raport.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const scenes = arg('sceny', 'building,blast,blaze,reactor').split(',');
const times = arg('klatki', '0.05,0.2,0.5,1,2,4,8').split(',').map(Number);
const size = Number(arg('rozmiar', 14));
const outDir = arg('out', '.tmp/wybuchy');
const Wd = Number(arg('szer', 1280));
const Hd = Number(arg('wys', 720));
const gridN = arg('n', '');
mkdirSync(outDir, { recursive: true });

const VIEWS = {
  default: { eye: [150, 70, 175], target: [10, 10, 20] }
};

const { server, base } = await startVite(5294);
const chrome = await startChrome({ width: Wd, height: Hd, webgpu: true });
const { cdp, logs } = chrome;
const ev = (expr) => evaluate(cdp, expr);
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const errors = () => logs.filter((l) => /^\[(error|exception|warning)\]/.test(l));
const report = { scenes: [], errors: [] };

try {
  const url = `${base}/dema/wybuchy-webgpu.html${gridN ? `?n=${gridN}` : ''}`;
  const ok = await navigateAndWait(cdp, url, '!!(window.__demo && window.__demo.ready)', 180000);
  if (!ok) throw new Error('demo się nie wczytało: ' + JSON.stringify(errors().slice(0, 10)));
  await sleep(1500);
  await ev('(() => { window.__demo.setLoop(false); return true; })()');
  const kv = (str) => Object.fromEntries((str || '').split(',').filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, Number(v)]; }));
  const look = kv(arg('look', ''));
  const tune = kv(arg('tune', ''));
  await ev(`(() => { const d = window.__demo; Object.assign(d.volume.look, ${JSON.stringify(look)}); Object.assign(d.grid.tune, ${JSON.stringify(tune)}); return true; })()`);
  const rows = [];
  for (const scene of scenes) {
    const v = VIEWS[scene] || VIEWS.default;
    await ev(`(() => {
      const d = window.__demo;
      d.clear();
      d.view(${JSON.stringify(v.eye)}, ${JSON.stringify(v.target)}, true);
      // Stały punkt: promień z oka w środek kadru (pierwsze trafienie w stację).
      const W = innerWidth, H = innerHeight;
      const p = d.pickStation(W * 0.5, H * 0.5) || { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
      window.__p = p;
      // Kamera bliżej miejsca wybuchu (wzdłuż tej samej osi patrzenia), kadr ~7 promieni kuli ognia.
      const e = d.camera.position;
      const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const dist = ${size} * ${Number(arg('dystans', 7))} * (${JSON.stringify(scene)} === 'reactor' ? 2.4 : ${JSON.stringify(scene)} === 'blast' ? 0.7 : 1);
      d.view([p.x + dx / l * dist, p.y + dy / l * dist + ${size} * 0.8, p.z + dz / l * dist], [p.x, p.y + ${size} * 0.6, p.z], true);
      d.boom(${JSON.stringify(scene)}, p.x, p.y, p.z, ${size}, p.nx, p.ny, p.nz);
      return p;
    })()`);
    const frames = [];
    let tNow = 0;
    for (const at of times) {
      const steps = Math.max(1, Math.round((at - tNow) * 60));
      const stats = await ev(`(() => {
        const d = window.__demo;
        const t0 = performance.now();
        let s = null;
        for (let i = 0; i < ${steps}; i++) s = d.step(1 / 60, 1);
        return { ...s, ms: +(performance.now() - t0).toFixed(1), embers: d.embers.stats.alive, emitters: d.director.stats.emitters };
      })()`);
      // Sonda gazu: maksima w domenie i profil wzdłuż osi x przez środek (co 4. komórka).
      stats.probe = await ev(`(async () => {
        const d = window.__demo;
        const s = d.grid.active[0];
        if (!s) return null;
        const r = await d.grid.probe(d.renderer, s.index);
        const f = (v) => +v.toFixed(2);
        const prof = (a, key) => a.filter((_, i) => i % 4 === 2).map((c) => f(c[key]));
        return { max: { smoke: f(r.max.smoke), T: f(r.max.T), speed: f(r.max.speed), q: f(r.max.q) }, nan: r.nan,
          smokeX: prof(r.axes.x, 'smoke'), TX: prof(r.axes.x, 'T'), vxX: prof(r.axes.x, 'vx') };
      })()`);
      await sleep(80);
      // Druga klatka renderu po kroku (obraz po pełnym przebiegu potoku).
      await ev('(() => { window.__demo.step(0, 1); return true; })()');
      await sleep(60);
      const png = await shot();
      writeFileSync(join(outDir, `${arg('tag', '')}${scene}-${String(at).replace('.', '_')}.png`), Buffer.from(png, 'base64'));
      frames.push({ t: at, stats, png });
      tNow = at;
    }
    rows.push({ scene, frames });
    report.scenes.push({ scene, frames: frames.map((f) => ({ t: f.t, stats: f.stats })) });
    console.log(scene, JSON.stringify(frames.map((f) => [f.t, f.stats.active, f.stats.sources, f.stats.ms])));
    for (const f of frames) if (f.stats.probe) console.log(`  t=${f.t}`, JSON.stringify(f.stats.probe));
  }
  // Test RUCHU dymu (--ruch): wybuch budowli, po 2 s seria klatek co 1/30 s — środek ciężkości krycia gazu na
  // ekranie (odczyt celu RTT obrazu gazu) i krycie. Drgania „idzie–cofa” = zmiany znaku prędkości środka
  // i energia drugich różnic. Druga seria: symulacja ZAMROŻONA, płynie tylko zegar obrazu — obraz nie może
  // się sam ruszać (detal przesuwany fazami mapy przepływu ruszał).
  if (process.argv.includes('--ruch')) {
    const ruch = await ev(`(async () => {
      const d = window.__demo;
      d.clear();
      d.view([150, 70, 175], [10, 10, 20], true);
      const W = innerWidth, H = innerHeight;
      const p = d.pickStation(W * 0.5, H * 0.5) || { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
      d.boom('building', p.x, p.y, p.z, 14, p.nx, p.ny, p.nz);
      for (let i = 0; i < 120; i++) d.step(1 / 60, 1);
      const rt = d.fx.volumeRTT.renderTarget;
      const half = (h) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
        return e === 0 ? s * 5.960464477539063e-8 * f : e === 31 ? 0 : s * Math.pow(2, e - 15) * (1 + f / 1024); };
      const measure = async () => {
        const w = rt.width, h = rt.height;
        const buf = await d.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        const isHalf = buf instanceof Uint16Array;
        let sa = 0, sx = 0, sy = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const v = buf[(y * w + x) * 4 + 3];
          const a = isHalf ? half(v) : v;
          sa += a; sx += a * x; sy += a * y;
        }
        return { cov: sa / (w * h), cx: sx / Math.max(sa, 1e-6), cy: sy / Math.max(sa, 1e-6) };
      };
      const stats = (s) => {
        let rev = 0, e2 = 0, path = 0;
        for (let i = 1; i < s.length; i++) path += Math.hypot(s[i].cx - s[i - 1].cx, s[i].cy - s[i - 1].cy);
        for (let i = 2; i < s.length; i++) {
          const ax = s[i].cx - s[i - 1].cx, ay = s[i].cy - s[i - 1].cy, bx = s[i - 1].cx - s[i - 2].cx, by = s[i - 1].cy - s[i - 2].cy;
          if (ax * bx + ay * by < 0) rev++;
          e2 += (ax - bx) ** 2 + (ay - by) ** 2;
        }
        const net = Math.hypot(s.at(-1).cx - s[0].cx, s.at(-1).cy - s[0].cy);
        return { zawrotki: rev, energia2: +e2.toFixed(3), droga: +path.toFixed(2), przesuniecie: +net.toFixed(2), kryciePocz: +s[0].cov.toFixed(4), krycieKon: +s.at(-1).cov.toFixed(4) };
      };
      const live = [];
      for (let i = 0; i < 90; i++) { d.step(1 / 30, 1); live.push(await measure()); }
      // Zamrożona symulacja: tylko zegar obrazu (grid.time) płynie.
      const frozen = [];
      for (let i = 0; i < 45; i++) { d.grid.time += 1 / 30; d.step(0, 1); frozen.push(await measure()); }
      return { live: stats(live), frozen: stats(frozen), seria: live.filter((_, i) => i % 6 === 0).map((m) => [+m.cx.toFixed(1), +m.cy.toFixed(1)]) };
    })()`);
    report.ruch = ruch;
    console.log('ruch', JSON.stringify(ruch));
  }
  // Pomiar w prawdziwej pętli (--perf): kilka wybuchów naraz, 4 s animacji, czasy GPU z HUD-u dema.
  if (process.argv.includes('--perf')) {
    const perf = await ev(`(async () => {
      const d = window.__demo;
      d.clear();
      d.view([150, 70, 175], [10, 10, 20], true);
      for (let i = 0; i < 4; i++) { const p = d.randomSurfacePoint(); d.boom(i === 3 ? 'reactor' : 'building', p.x, p.y, p.z, 14, p.nx, p.ny, p.nz); }
      d.setLoop(true);
      const samples = [];
      for (let k = 0; k < 8; k++) {
        await new Promise((r) => setTimeout(r, 500));
        samples.push({ gpuCompute: d.S.gpuCompute, gpuRender: d.S.gpuRender, active: d.grid.stats.active, cells: d.grid.stats.cells });
      }
      d.setLoop(false);
      // Czas uczciwy: n kroków symulacji / n renderów i oczekiwanie na kolejkę GPU (znaczniki czasu
      // w headless Chrome są kwantowane).
      const dev = d.renderer.backend.device;
      await dev.queue.onSubmittedWorkDone();
      let t0 = performance.now();
      for (let i = 0; i < 30; i++) { d.director.update(1 / 60); d.grid.simulate(d.renderer, 1 / 60); }
      await dev.queue.onSubmittedWorkDone();
      const simMs = (performance.now() - t0) / 30;
      t0 = performance.now();
      for (let i = 0; i < 30; i++) d.step(0, 1);
      await dev.queue.onSubmittedWorkDone();
      const renderMs = (performance.now() - t0) / 30;
      d.S.gas = false;
      t0 = performance.now();
      for (let i = 0; i < 30; i++) d.step(0, 1);
      await dev.queue.onSubmittedWorkDone();
      const renderNoGasMs = (performance.now() - t0) / 30;
      d.S.gas = true;
      samples.push({ simMs: +simMs.toFixed(3), renderMs: +renderMs.toFixed(3), renderNoGasMs: +renderNoGasMs.toFixed(3), active: d.grid.stats.active });
      return samples;
    })()`);
    report.perf = perf;
    console.log('perf', JSON.stringify(perf));
  }
  // Arkusz.
  const cell = (f) => `<td><img src="data:image/png;base64,${f.png}"><div>t=${f.t}s · dom ${f.stats.active} · źr ${f.stats.sources} · iskry ${f.stats.embers}</div></td>`;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#05060c;color:#cfe4ff;font:12px Consolas,monospace}
    table{border-collapse:collapse} td{padding:3px;vertical-align:top} img{width:384px;height:216px;display:block} th{color:#ffd479;padding:4px 6px}
    div{width:384px}</style><table>${rows.map((r) => `<tr><th>${r.scene}</th>${r.frames.map(cell).join('')}</tr>`).join('')}</table>`;
  const SW = 110 + times.length * 390, SH = rows.length * 240 + 8;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: SW, height: SH, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await ev(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`);
  await sleep(900);
  writeFileSync(join(outDir, 'arkusz.png'), Buffer.from(await shot(), 'base64'));
} catch (e) {
  console.log('BŁĄD', e.message);
} finally {
  report.errors = errors().slice(0, 40);
  writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('błędy konsoli', JSON.stringify(report.errors.slice(0, 12), null, 1));
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
