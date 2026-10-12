// Audyt fizyki dema gazów (dema/gazy-webgpu.html): sceny, „zasklepianie” kanału po przelocie (pole przemieszczeń
// wraca do zera), dziura po wybuchu, strumień dyszy przez skałę (brak przeszkód w symulacji), korelacja pyłu z gazem,
// FPS. Demo serwowane statycznie z kopią w .tmp (wstrzyknięte window.__dbg z wnętrznościami modułu).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startStaticServer, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson }
  from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/audyt-gazy');
mkdirSync(out, { recursive: true });

// Kopia dema z odsłoniętymi wnętrznościami (moduł nie eksportuje nic poza __demo).
const src = readFileSync(resolve(repo, 'dema/gazy-webgpu.html'), 'utf8');
const inject = `
window.__dbg = { renderer, simTex, rtA, rtB, dustPos, dustVel, simVel: () => simVel, uSimOrigin, SIM_N, SIM_CELL, SIM_W, uBoxH, uBoxC,
  uMapMin, uMapSize, uMapRes, sceneRocks, sceneJets, ringChimneys, player, npcs, cam, S, SLAB, uWind, uJetCount, DUST };
`;
const html = src.replace('window.__demo = {', inject + 'window.__demo = {');
if (html === src) throw new Error('nie wstrzyknięto __dbg');
writeFileSync(join(out, 'gazy-audyt.html'), html);

const { server, base } = await startStaticServer(Number(args.port || 5331), repo);
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
  // mapa gazu (rtA: rgb = albedo·σ, a = σ kolumny); v = 0 u GÓRY mapy
  window.__gasMap = async () => {
    const rt = D.rtA; const m = await window.__readTex(rt.texture, rt.width, rt.height);
    const min = D.uMapMin.value, size = D.uMapSize.value;
    m.at = (x, y) => { const u = (x - min.x) / size.x, v = 1 - (y - min.y) / size.y; if (u < 0 || u >= 1 || v < 0 || v >= 1) return NaN;
      const xi = Math.floor(u * m.w), yi = Math.floor(v * m.h); return m.data[(yi * m.w + xi) * 4 + 3]; };
    return m;
  };
  // pole symulacji (simTex: xy = przemieszczenie [j.], z = gęstość względna, w = wyrzut)
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
    // dywergencja / rms prędkości na komórkach z |v| > 30
    let s2 = 0, d2 = 0, n = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = (y * N + x) * 2; const vx = f[i], vy = f[i + 1]; const sp = Math.hypot(vx, vy); if (sp < 30) continue;
      const dvx = (f[(y * N + x + 1) * 2] - f[(y * N + x - 1) * 2]) * 0.5, dvy = (f[((y + 1) * N + x) * 2 + 1] - f[((y - 1) * N + x) * 2 + 1]) * 0.5;
      s2 += sp * sp; d2 += (dvx + dvy) * (dvx + dvy); n++;
    }
    return { at, cells: n, velRms: Math.sqrt(s2 / Math.max(1, n)), divRms: Math.sqrt(d2 / Math.max(1, n)) };
  };
  window.__dustCorr = async () => {
    const g = await window.__gasMap();
    const ab = await D.renderer.getArrayBufferAsync(D.dustPos.value); const f = new Float32Array(ab);
    const n = f.length / 4; let sum = 0, cnt = 0, empty = 0;
    for (let i = 0; i < n; i++) { const a = g.at(f[i * 4], f[i * 4 + 1]); if (!Number.isFinite(a)) continue; sum += a; cnt++; if (a < 0.08) empty++; }
    let asum = 0, aempty = 0; const tot = g.w * g.h;
    for (let i = 0; i < tot; i++) { const a = g.data[i * 4 + 3]; asum += a; if (a < 0.08) aempty++; }
    return { particles: cnt, meanAlphaAtParticles: +(sum / Math.max(1, cnt)).toFixed(4), meanAlphaMap: +(asum / tot).toFixed(4),
      particlesInEmpty: +(empty / Math.max(1, cnt)).toFixed(3), areaEmpty: +(aempty / tot).toFixed(3), dust: D.DUST, box: [D.uBoxH.value.x, D.uBoxH.value.y, D.uBoxH.value.z] };
  };
  return true;
})()`;

async function shot(name) { await screenshotPng(cdp, join(out, `${name}.png`)); }
const fps = () => ev('window.__dbg.S.fps');
const step = (name, data) => { report.kroki.push({ name, ...data }); console.log(('[' + name + ']').padEnd(28), JSON.stringify(data)); };

try {
  await cdp.send('Page.navigate', { url: `${base}/.tmp/audyt-gazy/gazy-audyt.html?scena=belt` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__dbg && window.__dbg.S.time > 1)', 180000, 400)) throw new Error('demo nie wstało');
  await ev(PAGE_HELPERS);
  await ev(`(() => { document.getElementById('panel').classList.add('hidden'); return true; })()`);
  await sleep(1500);

  // --- 1. sceny w spoczynku + oddalenie
  for (const sc of ['belt', 'ring', 'fog']) {
    await ev(`window.__demo.scene('${sc}')`);
    await sleep(3500);
    await shot(`10-${sc}`);
    const f1 = await fps();
    await ev('window.__demo.zoom(9000)');
    await sleep(1500);
    await shot(`11-${sc}-daleko`);
    await ev('window.__demo.zoom(4800)');
    await sleep(800);
    step(`10-${sc}`, { fps: +f1.toFixed(0) });
  }

  // --- 2. ring: kominy po 6 s (te same pozycje, inne kłęby?)
  await ev(`window.__demo.scene('ring')`);
  await sleep(2500);
  await shot('20-ring-t0');
  await sleep(6000);
  await shot('21-ring-t6');
  const jets = await ev(`(() => { const d = window.__dbg; return { count: d.uJetCount.value, wind: [d.uWind.value.x, d.uWind.value.y], chimneys: d.ringChimneys.map((c) => c.kind) }; })()`);
  step('20-ring-kominy', jets);

  // --- 3. pas: strumień dyszy w skałę (ciąg w miejscu W+S, rufa ku skale)
  await ev(`window.__demo.scene('belt')`);
  await sleep(1000);
  const pick = await ev(`(() => {
    const d = window.__dbg; const p = d.player; const rocks = d.sceneRocks.belt.map((r) => ({ x: r.x, y: r.y, r: r.r }));
    let best = null;
    for (const r of rocks) {
      if (r.r < 140) continue;
      const dist = Math.hypot(r.x - p.x, r.y - p.y); if (dist > 4500) continue;
      // bez innych skał w pasie 2× r wzdłuż 2600 j. za skałą i przed nią
      let clear = true;
      for (const o of rocks) { if (o === r) continue; const dd = Math.hypot(o.x - r.x, o.y - r.y); if (dd < r.r + o.r + 900) { clear = false; break; } }
      if (!clear) continue;
      if (!best || r.r > best.r) best = r;
    }
    if (!best) return null;
    // okręt: rufa (x lokalne −612) 700 j. przed skałą, dziób od skały; kierunek skała → okręt
    const ang = Math.atan2(p.y - best.y, p.x - best.x);
    const sx = best.x + Math.cos(ang) * (best.r + 700), sy = best.y + Math.sin(ang) * (best.r + 700);
    const px = sx + Math.cos(ang) * 612, py = sy + Math.sin(ang) * 612;
    window.__demo.place(px, py, ang);
    window.__dbg.S.snapCam = true;
    return { rock: best, ship: { x: px, y: py, ang }, stern: { x: sx, y: sy } };
  })()`);
  step('30-skala-wybor', pick || { brak: true });
  if (pick) {
    await sleep(1200);
    await down('w'); await down('s');
    await sleep(4000);
    await shot('31-skala-ciag-4s');
    const r = pick.rock, st = pick.stern;
    const ux = (r.x - st.x) / Math.hypot(r.x - st.x, r.y - st.y), uy = (r.y - st.y) / Math.hypot(r.x - st.x, r.y - st.y);
    const probe = await ev(`(async () => {
      const F = await window.__simField(); const V = await window.__simVel(); const G = await window.__gasMap();
      const ux = ${ux}, uy = ${uy}; const st = ${JSON.stringify(st)}; const r = ${JSON.stringify(r)};
      const dTot = Math.hypot(r.x - st.x, r.y - st.y);
      const pts = [];
      for (const s of [150, 400, dTot - r.r * 0.9, dTot, dTot + r.r * 0.9, dTot + r.r + 250, dTot + r.r + 700, dTot + r.r + 1300]) {
        const x = st.x + ux * s, y = st.y + uy * s; const f = F.at(x, y); const v = V.at(x, y);
        pts.push({ s: Math.round(s), gdzie: s < dTot - r.r ? 'przed' : s <= dTot + r.r ? 'SKAŁA' : 'za', vAlong: v ? Math.round(v.vx * ux + v.vy * uy) : null,
          disp: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, m: f ? +f.m.toFixed(2) : null, alpha: +G.at(x, y).toFixed(3) });
      }
      return { pts, divRms: +V.divRms.toFixed(2), velRms: +V.velRms.toFixed(1), ratio: +(V.divRms / Math.max(1e-6, V.velRms)).toFixed(3), cells: V.cells };
    })()`, 60000);
    step('31-skala-sonda', probe);
    await up('w'); await up('s');
    await ev('window.__dbg.S.snapCam = false');
    await sleep(500);
  }

  // --- 4. mgła: przelot przez ławicę, potem zasklepianie kanału bez przepływu
  await ev(`window.__demo.scene('fog')`);
  await sleep(2500);
  const corr = await ev('window.__dustCorr()', 60000);
  step('40-mgla-pyl-korelacja', corr);
  const dir = await ev(`(async () => {
    const G = await window.__gasMap(); const p = window.__dbg.player; let best = null;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; let s = 0, n = 0;
      for (let d = 600; d <= 5200; d += 100) { const v = G.at(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); if (Number.isFinite(v)) { s += v; n++; } }
      const mean = n ? s / n : 0; if (!best || mean > best.mean) best = { a, mean, n }; }
    window.__demo.move(Math.cos(best.a), Math.sin(best.a));
    return best;
  })()`, 60000);
  step('41-mgla-kurs', { kat: +dir.a.toFixed(2), sredniaAlpha: +dir.mean.toFixed(3) });
  await sleep(6500);
  await shot('42-mgla-przelot');
  await ev('window.__demo.move(0, 0)');
  await sleep(2500);   // okręt hamuje
  const line = await ev(`(() => { const p = window.__dbg.player; const a = ${dir.a}; const c = { x: p.x - Math.cos(a) * 1700, y: p.y - Math.sin(a) * 1700 };
    return { c, nx: -Math.sin(a), ny: Math.cos(a), ship: { x: p.x, y: p.y, v: Math.hypot(p.vx, p.vy) } }; })()`);
  step('43-mgla-stop', line);
  const t0 = Date.now();
  for (const [wait, tag] of [[0, 't0'], [3000, 't3'], [5000, 't8'], [7000, 't15'], [10000, 't25']]) {
    await sleep(wait);
    const prof = await ev(`(async () => {
      const G = await window.__gasMap(); const F = await window.__simField(); const L = ${JSON.stringify(line)};
      const a = []; for (let s = -1400; s <= 1400; s += 50) { a.push(+G.at(L.c.x + L.nx * s, L.c.y + L.ny * s).toFixed(3)); }
      const n = a.length, mid = (n - 1) / 2; const centre = (a[mid - 1] + a[mid] + a[mid + 1]) / 3;
      const side = a.slice(0, 8).concat(a.slice(-8)); const sideMean = side.reduce((x, y) => x + y, 0) / side.length;
      const f = F.at(L.c.x, L.c.y); const fs = F.at(L.c.x + L.nx * 1200, L.c.y + L.ny * 1200);
      return { centre: +centre.toFixed(3), side: +sideMean.toFixed(3), ratio: +(centre / Math.max(1e-4, sideMean)).toFixed(2),
        dispCentre: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, mCentre: f ? +f.m.toFixed(2) : null, dispSide: fs ? Math.round(Math.hypot(fs.dx, fs.dy)) : null, profil: a };
    })()`, 60000);
    const el = +((Date.now() - t0) / 1000).toFixed(1);
    step(`44-mgla-kanal-${tag}`, { t: el, centre: prof.centre, side: prof.side, ratio: prof.ratio, dispCentre: prof.dispCentre, mCentre: prof.mCentre, dispSide: prof.dispSide });
    report.kroki[report.kroki.length - 1].profil = prof.profil;
    if (tag === 't0' || tag === 't8' || tag === 't25') await shot(`44-mgla-kanal-${tag}`);
  }

  // --- 5. mgła: dziura po wybuchu
  const bx = await ev(`(async () => { const G = await window.__gasMap(); const p = window.__dbg.player; let best = null;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; for (let d = 900; d <= 2200; d += 100) { const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; const v = G.at(x, y); if (Number.isFinite(v) && (!best || v > best.v)) best = { x, y, v }; } }
    window.__demo.boom(best.x, best.y); return best; })()`, 60000);
  step('50-wybuch', { x: Math.round(bx.x), y: Math.round(bx.y), alpha0: +bx.v.toFixed(3) });
  const tb = Date.now();
  for (const [wait, tag] of [[500, 't0.5'], [1000, 't1.5'], [1500, 't3'], [3000, 't6'], [6000, 't12']]) {
    await sleep(wait);
    const h = await ev(`(async () => { const G = await window.__gasMap(); const F = await window.__simField(); const b = ${JSON.stringify(bx)};
      const ring = []; for (let r = 0; r <= 1600; r += 100) { let s = 0; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; const v = G.at(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r); s += Number.isFinite(v) ? v : 0; } ring.push(+(s / 12).toFixed(3)); }
      const f = F.at(b.x, b.y); return { ring, mCentre: f ? +f.m.toFixed(2) : null, dispCentre: f ? Math.round(Math.hypot(f.dx, f.dy)) : null, eCentre: f ? +f.e.toFixed(2) : null }; })()`, 60000);
    step(`51-wybuch-${tag}`, { t: +((Date.now() - tb) / 1000).toFixed(1), ...h });
    if (tag === 't0.5' || tag === 't3' || tag === 't12') await shot(`51-wybuch-${tag}`);
  }
  report.fpsKoniec = await fps();
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
