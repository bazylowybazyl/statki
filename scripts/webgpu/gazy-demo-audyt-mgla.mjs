// Audyt dema gazów, część 3 (scena mgły, WIATR = 0): kanał po przelocie mierzony w stałym punkcie świata P
// (okręt staje ~1000 j. za P — P w mapie i w kadrze), potem pas strumienia przy ciągu w miejscu.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startStaticServer, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson }
  from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/audyt-gazy3');
mkdirSync(out, { recursive: true });

const src = readFileSync(resolve(repo, 'dema/gazy-webgpu.html'), 'utf8');
const inject = `
window.__dbg = { renderer, simTex, rtA, rtB, dustPos, dustVel, simVel: () => simVel, uSimOrigin, SIM_N, SIM_CELL, SIM_W, uBoxH, uBoxC,
  uMapMin, uMapSize, uMapRes, sceneRocks, sceneJets, ringChimneys, player, npcs, cam, S, SLAB, uWind, uJetCount, DUST };
`;
const html = src.replace('window.__demo = {', inject + 'window.__demo = {');
if (html === src) throw new Error('nie wstrzyknięto __dbg');
writeFileSync(join(out, 'gazy-audyt.html'), html);

const { server, base } = await startStaticServer(Number(args.port || 5333), repo);
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kroki: [] };
const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 }, s: { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });

const PAGE_HELPERS = `(() => {
  const f16 = (h) => { const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const m = h & 0x3ff;
    if (e === 0) return s * m * Math.pow(2, -24); if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * Math.pow(2, e - 15); };
  const D = window.__dbg;
  window.__readTex = async (tex, w, h) => {
    const r = D.renderer; const dev = r.backend.device;
    const gpuTex = r.backend.get(tex).texture;
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpuTex, mipLevel: 0 }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const o = new Float32Array(w * h * 4);
    const rowU16 = bpr / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) o[y * w * 4 + x] = f16(u16[y * rowU16 + x]);
    return { w, h, data: o };
  };
  window.__gasMap = async () => {
    const rt = D.rtA; const m = await window.__readTex(rt.texture, rt.width, rt.height);
    const min = D.uMapMin.value, size = D.uMapSize.value;
    m.at = (x, y) => { const u = (x - min.x) / size.x, v = 1 - (y - min.y) / size.y; if (u < 0 || u >= 1 || v < 0 || v >= 1) return NaN;
      const xi = Math.floor(u * m.w), yi = Math.floor(v * m.h); return m.data[(yi * m.w + xi) * 4 + 3]; };
    return m;
  };
  window.__simField = async () => {
    const N = D.SIM_N; const m = await window.__readTex(D.simTex, N, N);
    const o = D.uSimOrigin.value;
    m.at = (x, y) => { const cx = Math.floor((x - o.x) / D.SIM_CELL), cy = Math.floor((y - o.y) / D.SIM_CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null; const i = (cy * N + cx) * 4; return { dx: m.data[i], dy: m.data[i + 1], m: m.data[i + 2], e: m.data[i + 3] }; };
    return m;
  };
  window.__simVel = async () => {
    const N = D.SIM_N; const ab = await D.renderer.getArrayBufferAsync(D.simVel().value);
    const f = new Float32Array(ab); const o = D.uSimOrigin.value;
    const at = (x, y) => { const cx = Math.floor((x - o.x) / D.SIM_CELL), cy = Math.floor((y - o.y) / D.SIM_CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null; const i = (cy * N + cx) * 2; return { vx: f[i], vy: f[i + 1] }; };
    let s2 = 0, d2 = 0, n = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = (y * N + x) * 2; const vx = f[i], vy = f[i + 1]; const sp = Math.hypot(vx, vy); if (sp < 30) continue;
      const dvx = (f[(y * N + x + 1) * 2] - f[(y * N + x - 1) * 2]) * 0.5, dvy = (f[((y + 1) * N + x) * 2 + 1] - f[((y - 1) * N + x) * 2 + 1]) * 0.5;
      s2 += sp * sp; d2 += (dvx + dvy) * (dvx + dvy); n++;
    }
    return { at, cells: n, velRms: Math.sqrt(s2 / Math.max(1, n)), divRms: Math.sqrt(d2 / Math.max(1, n)) };
  };
  return true;
})()`;

async function shot(name) { await screenshotPng(cdp, join(out, `${name}.png`)); }
const step = (name, data) => { report.kroki.push({ name, ...data }); console.log(('[' + name + ']').padEnd(26), JSON.stringify(data)); };
const mean = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);

const PROFILE = (Pjson) => `(async () => { const G = await window.__gasMap(); const F = await window.__simField(); const V = await window.__simVel(); const P = ${Pjson};
  const a = []; for (let s = -1400; s <= 1400; s += 50) a.push(G.at(P.x, P.y + s));
  const fin = a.filter(Number.isFinite); const centre = (a[27] + a[28] + a[29]) / 3; const sideArr = a.slice(0, 8).concat(a.slice(-8)).filter(Number.isFinite); const side = sideArr.reduce((x, y) => x + y, 0) / Math.max(1, sideArr.length);
  const f = F.at(P.x, P.y); const v = V.at(P.x, P.y); const p = window.__dbg.player;
  let lo = 28, hi = 28; const thr = side * 0.35; while (lo > 0 && a[lo - 1] < thr) lo--; while (hi < a.length - 1 && a[hi + 1] < thr) hi++;
  return { centre: +centre.toFixed(3), side: +side.toFixed(3), ratio: +(centre / Math.max(1e-4, side)).toFixed(2), kanalJ: a[28] < thr ? (hi - lo + 1) * 50 : 0, finite: fin.length,
    dispCentre: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, mCentre: f ? +f.m.toFixed(2) : null, vCentre: v ? Math.round(Math.hypot(v.vx, v.vy)) : null, shipDx: Math.round(p.x - P.x), shipV: Math.round(Math.hypot(p.vx, p.vy)),
    profil: a.map((x) => Number.isFinite(x) ? +x.toFixed(3) : null) }; })()`;

try {
  await cdp.send('Page.navigate', { url: `${base}/.tmp/audyt-gazy3/gazy-audyt.html?scena=fog` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__dbg && window.__dbg.S.time > 1)', 180000, 400)) throw new Error('demo nie wstało');
  await ev(PAGE_HELPERS);
  await ev(`(() => { document.getElementById('panel').classList.add('hidden'); window.__dbg.S.snapCam = true; window.__dbg.uWind.value.set(0, 0); window.__demo.zoom(9000); return true; })()`);
  await sleep(2000);
  // najgęstszy punkt ławicy na osi x okrętu (okno ±300)
  const P = await ev(`(async () => { const G = await window.__gasMap(); const p = window.__dbg.player; let best = null;
    for (let x = p.x - 5000; x <= p.x + 5000; x += 50) { let s = 0, n = 0; for (let dy = -300; dy <= 300; dy += 60) for (let dx = -300; dx <= 300; dx += 60) { const v = G.at(x + dx, p.y + dy); if (Number.isFinite(v)) { s += v; n++; } }
      const v = n ? s / n : -1; if (!best || v > best.v) best = { x, y: p.y, v }; }
    window.__demo.place(best.x - 2000, best.y, 0); window.__demo.zoom(4800); return best; })()`, 60000);
  step('B0-lawica', { x: Math.round(P.x), y: Math.round(P.y), alpha: +P.v.toFixed(3) });
  await sleep(1500);
  await shot('B1-przed');
  const pre = await ev(PROFILE(JSON.stringify(P)), 60000);
  const { profil: pp, ...preRest } = pre;
  step('B1-przed', preRest);
  report.kroki[report.kroki.length - 1].profil = pp;
  await ev('window.__demo.move(1, 0)');
  await sleep(2000);
  await shot('B2-przelot');
  await ev('window.__demo.move(0, 0)');
  await sleep(2500);
  const tB = Date.now();
  for (const [wait, tag] of [[0, 't0'], [3000, 't3'], [3000, 't6'], [4000, 't10'], [5000, 't15'], [8000, 't23'], [10000, 't33']]) {
    await sleep(wait);
    const pr = await ev(PROFILE(JSON.stringify(P)), 60000);
    const el = +((Date.now() - tB) / 1000).toFixed(1);
    const { profil, ...rest } = pr;
    step(`B3-kanal-${tag}`, { t: el, ...rest });
    report.kroki[report.kroki.length - 1].profil = profil;
    if (tag === 't0' || tag === 't6' || tag === 't15' || tag === 't33') await shot(`B3-kanal-${tag}`);
  }

  // --- C. ciąg w miejscu (W+S): okręt 1300 j. na wschód od P, rufa ku P (wiatr 0, ławica stoi)
  await ev(`(() => { const P = ${JSON.stringify(P)}; window.__demo.place(P.x + 1300, P.y, 0); return true; })()`);
  await sleep(1500);
  await shot('C0-przed-ciagiem');
  const lanePre = await ev(`(async () => { const G = await window.__gasMap(); const p = window.__dbg.player; const sx = p.x - 612; const pts = [];
    for (const s of [100, 300, 600, 900, 1200, 1500, 1900, 2400]) { const x = sx - s; let lane = 0, n = 0; for (let dy = -120; dy <= 120; dy += 40) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { lane += a; n++; } }
      let sideS = 0, ns = 0; for (const dy of [-800, -700, -600, 600, 700, 800]) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { sideS += a; ns++; } }
      pts.push({ s, alphaPas: n ? +(lane / n).toFixed(2) : null, alphaBoki: ns ? +(sideS / ns).toFixed(2) : null }); } return pts; })()`, 60000);
  step('C0-pas-przed', { pts: lanePre });
  await down('w'); await down('s');
  await sleep(6000);
  await shot('C1-ciag-6s');
  const lane = await ev(`(async () => { const G = await window.__gasMap(); const F = await window.__simField(); const V = await window.__simVel(); const p = window.__dbg.player;
    const sx = p.x - 612; const pts = []; for (const s of [100, 300, 600, 900, 1200, 1500, 1900, 2400]) { const x = sx - s; const f = F.at(x, p.y); const v = V.at(x, p.y);
      let lane = 0, n = 0; for (let dy = -120; dy <= 120; dy += 40) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { lane += a; n++; } }
      let sideS = 0, ns = 0; for (const dy of [-800, -700, -600, 600, 700, 800]) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { sideS += a; ns++; } }
      pts.push({ s, vAlong: v ? Math.round(-v.vx) : null, m: f ? +f.m.toFixed(2) : null, disp: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, alphaPas: n ? +(lane / n).toFixed(2) : null, alphaBoki: ns ? +(sideS / ns).toFixed(2) : null }); }
    return { pts, divRatio: +(V.divRms / Math.max(1e-6, V.velRms)).toFixed(3), velRms: Math.round(V.velRms) }; })()`, 60000);
  step('C1-pas-strumienia', lane);
  await up('w'); await up('s');
  await sleep(6000);
  await shot('C2-po-6s');
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 8));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
