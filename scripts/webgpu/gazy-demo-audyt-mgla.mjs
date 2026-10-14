// Audyt dema gazów, część 3 (scena mgły, WIATR = 0): kanał po przelocie mierzony w stałym punkcie świata P
// (okręt staje ~1000 j. za P — P w mapie i w kadrze), potem pas strumienia przy ciągu w miejscu.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { parseArgs, startStaticServer, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson }
  from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
// --demo transport — dema/gazy-transport-webgpu.html (pole gazu z transportem gęstości; te same miary, odczyt
// z jego buforów: simTex = gęstości gazów + wyrzut, restTex = przesunięcie faktury, velA [komórki/s]).
const TRANSPORT = args.demo === 'transport';
const out = resolve(repo, args.out || (TRANSPORT ? '.tmp/gazy-transport/mgla-nowe' : '.tmp/audyt-gazy3'));
mkdirSync(out, { recursive: true });

// Kopia dema z odsłoniętymi wnętrznościami (moduł nie eksportuje nic poza __demo).
const src = readFileSync(resolve(repo, TRANSPORT ? 'dema/gazy-transport-webgpu.html' : 'dema/gazy-webgpu.html'), 'utf8');
const inject = TRANSPORT ? `
window.__dbg = { renderer, simTex, restTex, rtA, rtB, dustPos, dustVel, simVel: () => simVel, simBuf, SIMT, uSimOrigin, SIM_N, SIM_CELL, SIM_W,
  uMapMin, uMapSize, uMapRes, sceneRocks, sceneJets, ringChimneys, player, npcs, cam, S, SLAB, uWind, uSrcCount, DUST, transport: true };
` : `
window.__dbg = { renderer, simTex, rtA, rtB, dustPos, dustVel, simVel: () => simVel, uSimOrigin, SIM_N, SIM_CELL, SIM_W, uBoxH, uBoxC,
  uMapMin, uMapSize, uMapRes, sceneRocks, sceneJets, ringChimneys, player, npcs, cam, S, SLAB, uWind, uJetCount, DUST };
`;
const html = src.replace('window.__demo = {', inject + 'window.__demo = {');
if (html === src) throw new Error('nie wstrzyknięto __dbg');
writeFileSync(join(out, 'gazy-audyt.html'), html);
const pageUrl = '/' + relative(repo, join(out, 'gazy-audyt.html')).split(sep).join('/');

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
  // pole symulacji. Stare demo (simTex: xy = przemieszczenie [j.], z = gęstość względna, w = wyrzut). Nowe (transport):
  // dx, dy = przesunięcie faktury [j.] (restTex), m = gęstość gazu w komórce (suma kanałów simTex), e = wyrzut.
  window.__simField = async () => {
    const N = D.SIM_N; const m = await window.__readTex(D.simTex, N, N);
    const r = D.transport ? await window.__readTex(D.restTex, N, N) : null;
    const o = D.uSimOrigin.value;
    m.at = (x, y) => { const cx = Math.floor((x - o.x) / D.SIM_CELL), cy = Math.floor((y - o.y) / D.SIM_CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null; const i = (cy * N + cx) * 4;
      if (r) return { dx: r.data[i] * D.SIM_CELL, dy: r.data[i + 1] * D.SIM_CELL, m: m.data[i] + m.data[i + 1] + m.data[i + 2] + m.data[i + 3], e: m.data[i + 3], solid: r.data[i + 2] };
      return { dx: m.data[i], dy: m.data[i + 1], m: m.data[i + 2], e: m.data[i + 3] }; };
    return m;
  };
  window.__simVel = async () => {
    const N = D.SIM_N; const ab = await D.renderer.getArrayBufferAsync(D.simVel().value);
    const f = new Float32Array(ab); const o = D.uSimOrigin.value;
    const K = D.transport ? D.SIM_CELL : 1;   // nowe demo: prędkość w komórkach/s
    if (K !== 1) for (let i = 0; i < f.length; i++) f[i] *= K;
    const at = (x, y) => { const cx = Math.floor((x - o.x) / D.SIM_CELL), cy = Math.floor((y - o.y) / D.SIM_CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null; const i = (cy * N + cx) * 2; return { vx: f[i], vy: f[i + 1] }; };
    // nowe demo: cel dywergencji (velB.z) i ciśnienie (prsB.x) — resztkowa dywergencja = div − (cel − soft·q), stałe pomijane
    let tgt = null, prs = null, flg = null;
    if (D.transport) {
      tgt = new Float32Array(await D.renderer.getArrayBufferAsync(D.simBuf.velB.value));
      prs = new Float32Array(await D.renderer.getArrayBufferAsync(D.simBuf.prsB.value));
      flg = new Float32Array(await D.renderer.getArrayBufferAsync(D.simBuf.flagB.value));
    }
    // dywergencja / rms prędkości na komórkach z |v| > 30. Nowe demo dodatkowo: tylko pole NIEŚCIŚLIWE (poza strefami
    // ściśliwymi — stożki dysz, front wybuchu, pas wokół kadłuba: velB.w > 0,05) — surowa i resztkowa (div − (cel − soft·q))
    let s2 = 0, d2 = 0, n = 0, s2i = 0, d2i = 0, r2i = 0, ni = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = (y * N + x) * 2; const vx = f[i], vy = f[i + 1]; const sp = Math.hypot(vx, vy); if (sp < 30) continue;
      if (flg && flg[(y * N + x) * 4] > 0.5) continue;
      const dvx = (f[(y * N + x + 1) * 2] - f[(y * N + x - 1) * 2]) * 0.5, dvy = (f[((y + 1) * N + x) * 2 + 1] - f[((y - 1) * N + x) * 2 + 1]) * 0.5;
      s2 += sp * sp; d2 += (dvx + dvy) * (dvx + dvy); n++;
      if (tgt && tgt[(y * N + x) * 4 + 3] < 0.05) {
        const want = (tgt[(y * N + x) * 4 + 2] - D.SIMT.soft * prs[(y * N + x) * 4]) * K; const res = dvx + dvy - want;
        s2i += sp * sp; d2i += (dvx + dvy) * (dvx + dvy); r2i += res * res; ni++;
      }
    }
    return { at, cells: n, velRms: Math.sqrt(s2 / Math.max(1, n)), divRms: Math.sqrt(d2 / Math.max(1, n)),
      resRms: tgt ? Math.sqrt(r2i / Math.max(1, ni)) : null,
      inc: tgt ? { cells: ni, velRms: Math.sqrt(s2i / Math.max(1, ni)), divRatio: Math.sqrt(d2i / Math.max(1, ni)) / Math.max(1e-6, Math.sqrt(s2i / Math.max(1, ni))),
        resRatio: Math.sqrt(r2i / Math.max(1, ni)) / Math.max(1e-6, Math.sqrt(s2i / Math.max(1, ni))) } : null };
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
  // ten sam przekrój w polu symulacji (stare demo: m = mnożnik gęstości, nowe: gęstość komórki) — niezależny od kadru mapy
  const sm = []; for (let s = -1400; s <= 1400; s += 50) { const q = F.at(P.x, P.y + s); sm.push(q ? q.m : NaN); }
  const smC = (sm[27] + sm[28] + sm[29]) / 3; const smS = sm.slice(0, 8).concat(sm.slice(-8)).filter(Number.isFinite); const smSide = smS.reduce((x, y) => x + y, 0) / Math.max(1, smS.length);
  // dopływ do osi kanału: zbieżność prędkości poprzecznej ±250 j. od osi (> 0 — gaz płynie do środka)
  const vu = V.at(P.x, P.y + 250), vd = V.at(P.x, P.y - 250);
  const vIn = vu && vd ? Math.round((vd.vy - vu.vy) * 0.5) : null;
  return { centre: +centre.toFixed(3), side: +side.toFixed(3), ratio: +(centre / Math.max(1e-4, side)).toFixed(2), kanalJ: a[28] < thr ? (hi - lo + 1) * 50 : 0, finite: fin.length,
    simRatio: +(smC / Math.max(1e-4, smSide)).toFixed(2), vIn,
    // kanał może dryfować w bok: minimum przekroju ±600 j. od osi (do boków) i jego położenie [j.]
    minRatio: (() => { let m = Infinity, at = 0; for (let k = 16; k <= 40; k++) if (Number.isFinite(a[k]) && a[k] < m) { m = a[k]; at = (k - 28) * 50; } return Number.isFinite(m) ? +(m / Math.max(1e-4, side)).toFixed(2) : null; })(),
    minAt: (() => { let m = Infinity, at = 0; for (let k = 16; k <= 40; k++) if (Number.isFinite(a[k]) && a[k] < m) { m = a[k]; at = (k - 28) * 50; } return at; })(),
    dispCentre: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, mCentre: f ? +f.m.toFixed(2) : null, vCentre: v ? Math.round(Math.hypot(v.vx, v.vy)) : null, shipDx: Math.round(p.x - P.x), shipV: Math.round(Math.hypot(p.vx, p.vy)),
    profil: a.map((x) => Number.isFinite(x) ? +x.toFixed(3) : null) }; })()`;

try {
  await cdp.send('Page.navigate', { url: `${base}${pageUrl}?scena=fog` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__dbg && window.__dbg.S.time > 1)', 180000, 400)) throw new Error('demo nie wstało');
  await ev(PAGE_HELPERS);
  // --tune k=v,k=v — strojenie pola nowego dema (window.__demo.simTune) przed pomiarem
  if (args.tune && TRANSPORT) {
    const t = Object.fromEntries(String(args.tune).split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
    await ev(`(() => { Object.assign(window.__demo.simTune, ${JSON.stringify(t)}); window.__demo.syncSimTune(); return true; })()`);
    report.tune = t;
  }
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
    const wal = (x, y) => { let sum = 0, at = 0, n = 0; for (const sg of [-1, 1]) { let m = -1, mi = 0; for (let d = 150; d <= 1600; d += 50) { const a = G.at(x, y + sg * d); if (Number.isFinite(a) && a > m) { m = a; mi = d; } } if (m >= 0) { sum += m; at += mi; n++; } } return n ? { wal: +(sum / n).toFixed(2), walY: Math.round(at / n) } : { wal: null, walY: null }; };
    for (const s of [100, 300, 600, 900, 1200, 1500, 1900, 2400]) { const x = sx - s; let lane = 0, n = 0; for (let dy = -120; dy <= 120; dy += 40) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { lane += a; n++; } }
      let sideS = 0, ns = 0; for (const dy of [-800, -700, -600, 600, 700, 800]) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { sideS += a; ns++; } }
      pts.push({ s, alphaPas: n ? +(lane / n).toFixed(2) : null, alphaBoki: ns ? +(sideS / ns).toFixed(2) : null, ...wal(x, p.y) }); } return pts; })()`, 60000);
  step('C0-pas-przed', { pts: lanePre });
  await down('w'); await down('s');
  await sleep(6000);
  await shot('C1-ciag-6s');
  const lane = await ev(`(async () => { const G = await window.__gasMap(); const F = await window.__simField(); const V = await window.__simVel(); const p = window.__dbg.player;
    const wal = (x, y) => { let sum = 0, at = 0, n = 0; for (const sg of [-1, 1]) { let m = -1, mi = 0; for (let d = 150; d <= 1600; d += 50) { const a = G.at(x, y + sg * d); if (Number.isFinite(a) && a > m) { m = a; mi = d; } } if (m >= 0) { sum += m; at += mi; n++; } } return n ? { wal: +(sum / n).toFixed(2), walY: Math.round(at / n) } : { wal: null, walY: null }; };
    const sx = p.x - 612; const pts = []; for (const s of [100, 300, 600, 900, 1200, 1500, 1900, 2400]) { const x = sx - s; const f = F.at(x, p.y); const v = V.at(x, p.y);
      let lane = 0, n = 0; for (let dy = -120; dy <= 120; dy += 40) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { lane += a; n++; } }
      let sideS = 0, ns = 0; for (const dy of [-800, -700, -600, 600, 700, 800]) { const a = G.at(x, p.y + dy); if (Number.isFinite(a)) { sideS += a; ns++; } }
      pts.push({ s, vAlong: v ? Math.round(-v.vx) : null, m: f ? +f.m.toFixed(2) : null, disp: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, alphaPas: n ? +(lane / n).toFixed(2) : null, alphaBoki: ns ? +(sideS / ns).toFixed(2) : null, ...wal(x, p.y) }); }
    return { pts, divRatio: +(V.divRms / Math.max(1e-6, V.velRms)).toFixed(3), inc: V.inc ? { cells: V.inc.cells, divRatio: +V.inc.divRatio.toFixed(3), resRatio: +V.inc.resRatio.toFixed(3) } : null, velRms: Math.round(V.velRms) }; })()`, 60000);
  step('C1-pas-strumienia', lane);
  await up('w'); await up('s');
  await sleep(6000);
  await shot('C2-po-6s');

  // --- D. wybuch w gęstej ławicy przy wietrze 0: dziura, wał, zamykanie (profil promieniowy, dopływ do środka)
  // miejsce wybuchu W KADRZE (mapa gazu obejmuje tylko widok): ±2000 × ±900 j. od kamery, ≥ 1000 j. od okrętu, gęsta ławica
  const Q = await ev(`(async () => { const G = await window.__gasMap(); const p = window.__dbg.player; const c = window.__dbg.cam; let best = null;
    for (let dx = -2000; dx <= 2000; dx += 100) for (let dy = -900; dy <= 900; dy += 100) { const x = c.x + dx, y = c.y + dy;
      if (Math.hypot(x - p.x, y - p.y) < 1000) continue;
      let s = 0, n = 0; for (let r = 0; r <= 600; r += 300) for (let j = 0; j < 8; j++) { const v = G.at(x + Math.cos(j * 0.785) * r, y + Math.sin(j * 0.785) * r); if (Number.isFinite(v)) { s += v; n++; } }
      const v = n ? s / n : -1; if (!best || v > best.v) best = { x, y, v }; }
    window.__demo.boom(best.x, best.y); return best; })()`, 60000);
  step('D0-wybuch', { x: Math.round(Q.x), y: Math.round(Q.y), alpha0: +Q.v.toFixed(3) });
  const tD = Date.now();
  for (const [wait, tag] of [[500, 't0.5'], [1000, 't1.5'], [1500, 't3'], [3000, 't6'], [6000, 't12'], [8000, 't20'], [10000, 't30']]) {
    await sleep(wait);
    const h = await ev(`(async () => { const G = await window.__gasMap(); const V = await window.__simVel(); const b = ${JSON.stringify(Q)};
      const ring = []; for (let r = 0; r <= 2000; r += 100) { let s = 0, n = 0; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; const v = G.at(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r); if (Number.isFinite(v)) { s += v; n++; } } ring.push(n ? +(s / n).toFixed(3) : null); }
      // prędkość promieniowa średnio na r = 300 j. (< 0 — gaz płynie do środka dziury)
      let vr = 0, nv = 0; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; const v = V.at(b.x + Math.cos(a) * 300, b.y + Math.sin(a) * 300); if (v) { vr += v.vx * Math.cos(a) + v.vy * Math.sin(a); nv++; } }
      const outer = ring.slice(-4).filter((x) => x !== null); const out = outer.reduce((x, y) => x + y, 0) / Math.max(1, outer.length);
      let wall = 0, wallR = 0; ring.forEach((x, i) => { if (x !== null && x > wall) { wall = x; wallR = i * 100; } });
      return { ring, centre: ring[0], dalej: +out.toFixed(3), wal: +wall.toFixed(3), walR: wallR, vRad300: nv ? Math.round(vr / nv) : null }; })()`, 60000);
    step(`D1-wybuch-${tag}`, { t: +((Date.now() - tD) / 1000).toFixed(1), ...h });
    if (tag === 't0.5' || tag === 't3' || tag === 't12' || tag === 't30') await shot(`D1-wybuch-${tag}`);
  }
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
