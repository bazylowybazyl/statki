// AUDYT PYŁU HALI K-7 w prawdziwej grze (docs/AUDYT-pyl-hali-2026-10-12.md): Atlas na C-01 hali 0 Ziemi rufą do ściany,
// trzy odpalenia MAIN po 5 s z przerwami 6 s, potem lot ku bramie. Po każdym kroku odczyt tekstur pola gazu 2D z GPU
// (src/3d/gasField/gasField2D.js: denA — pył w powietrzu / na pokładzie / para / prędkość, velA, flagT) → bilans pyłu,
// profil prędkości i gęstości w poprzek osi dysz (szerokość pasa ½ maks. i tunelu bez pyłu), residuum dywergencji po
// rzucie; A/B liczby iteracji Jacobiego na tym samym stanie; obrazy pól (PNG: czerwone — przeszkody, niebieskie — obrys
// kadłuba) i zrzuty gry. Wynik: .tmp/audyt-pyl/raport.json. A/B poprawek fizyki — ten sam skrypt przed i po.
//
//   node scripts/webgpu/hala-pyl-audyt.mjs [--out .tmp/audyt-pyl] [--rozmiar 1600x900] [--zoom 0.32] [--port 5397]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson }
  from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/audyt-pyl');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.32);

const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kroki: [] };

const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

const PAGE_HELPERS = `(() => {
  const f16 = (h) => { const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const m = h & 0x3ff;
    if (e === 0) return s * m * Math.pow(2, -24); if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * Math.pow(2, e - 15); };
  window.__readTex = async (tex) => {
    const r = window.Core3D.renderer; const dev = r.backend.device;
    const gpuTex = r.backend.get(tex).texture;
    const w = tex.image.width, h = tex.image.height;
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpuTex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const o = new Float32Array(w * h * 4);
    const rowU16 = bpr / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) o[y * w * 4 + x] = f16(u16[y * rowU16 + x]);
    return { w, h, data: o };
  };
  // pole → PNG (dataURL): kanał c tekstury, skala, maska komórek stałych (cellTex R) na czerwono
  window.__fieldPng = (field, c, scale, cells, bodies) => {
    const { w, h, data } = field;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.max(0, Math.min(1, data[i * 4 + c] * scale));
      const g = Math.round(v * 255);
      img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
      if (cells && cells[i * 4] > 127) { img.data[i * 4] = 160; img.data[i * 4 + 1] = 30; img.data[i * 4 + 2] = 30; }
      if (bodies && bodies.data[i * 4] > 0.5 && !(cells && cells[i * 4] > 127)) { img.data[i * 4] = 40; img.data[i * 4 + 1] = 90; img.data[i * 4 + 2] = 200; }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  };
  window.__metrics = async (opts = {}) => {
    const HD = window.HallDust; const sim = HD.sim; const dom = HD.domain; const IN = HD.input;
    const den = await window.__readTex(sim.denA);
    const vel = await window.__readTex(sim.velA);
    const flag = await window.__readTex(sim.flagT);
    const cells = sim.cellTex.image.data;
    const { w, h } = den;
    let air = 0, floor = 0, vapor = 0, airIn = 0, maxV = 0, sumV2 = 0, nIn = 0, divSum2 = 0, nDiv = 0, airAll = 0;
    let airOut = 0;
    const solid = (i) => cells[i * 4] > 127 || flag.data[i * 4] > 0.5;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const inside = cells[i * 4 + 2] > 127;
      const a = den.data[i * 4], f = den.data[i * 4 + 1], v = den.data[i * 4 + 2];
      airAll += a;
      if (!inside) airOut += a;
      if (!inside) continue;
      air += a; floor += f; vapor += v; nIn++;
      if (solid(i)) continue;
      const vx = vel.data[i * 4], vy = vel.data[i * 4 + 1];
      const sp = Math.sqrt(vx * vx + vy * vy); if (sp > maxV) maxV = sp; sumV2 += sp * sp;
      // dywergencja centralna (sąsiad stały — prędkość ciała z flag)
      const V = (dx, dy, k) => { const j = (y + dy) * w + (x + dx); return flag.data[j * 4] > 0.5 || cells[j * 4] > 127 ? flag.data[j * 4 + 1 + k] : vel.data[j * 4 + k]; };
      const d = 0.5 * (V(1, 0, 0) - V(-1, 0, 0) + V(0, 1, 1) - V(0, -1, 1));
      divSum2 += d * d; nDiv++;
    }
    const res = { air: +air.toFixed(1), airOutside: +airOut.toFixed(1), floor: +floor.toFixed(1), vapor: +vapor.toFixed(1),
      maxSpeed: +(maxV * dom.h).toFixed(0), rmsSpeed: +(Math.sqrt(sumV2 / Math.max(1, nDiv)) * dom.h).toFixed(1),
      divRms: +Math.sqrt(divSum2 / Math.max(1, nDiv)).toFixed(4), velRms: +Math.sqrt(sumV2 / Math.max(1, nDiv)).toFixed(4),
      stats: { ...HD.stats }, jacobi: sim.jacobi, substeps: sim.stats.substeps,
      halfRounding: sim.halfRounding ?? null, roundBias: sim.U.roundBias ? sim.U.roundBias.value : null };
    // strumień Atlasa: EngineFrame → hala → komórki; profil w poprzek osi w odległościach d za wylotem
    const EF = window.EngineFrame; const k = EF.indexOf(window.ship);
    if (k >= 0) {
      const I = HD.constructor === undefined ? null : null;
      const p0x = IN[4], p0y = IN[5], ax = IN[6], ay = IN[7], bx = IN[8], by = IN[9];
      const det = ax * by - bx * ay;
      const dx = EF.x[k] - p0x, dy = -EF.y[k] - p0y;
      const hx = (by * dx - bx * dy) / det, hz = (ax * dy - ay * dx) / det;
      const vx = EF.dirX[k], vy = -EF.dirY[k];
      let ux = (by * vx - bx * vy) / det, uz = (ax * vy - ay * vx) / det; const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
      const cx = (hx - dom.x0) / dom.h, cy = (hz - dom.z0) / dom.h;
      res.jetCell = { cx: +cx.toFixed(2), cy: +cy.toFixed(2), ux: +ux.toFixed(4), uy: +uz.toFixed(4) };
      const nx = -uz, ny = ux; // w poprzek
      const sample = (fld, px, py, c) => { const xi = Math.round(px - 0.5), yi = Math.round(py - 0.5); if (xi < 0 || yi < 0 || xi >= w || yi >= h) return NaN; return fld.data[(yi * w + xi) * 4 + c]; };
      const profiles = [];
      for (const d of (opts.dists || [4, 10, 18, 26])) {
        const along = [], airP = [], sol = [];
        for (let s = -40; s <= 40; s++) {
          const px = cx + ux * d + nx * s, py = cy + uz * d + ny * s;
          const vvx = sample(vel, px, py, 0), vvy = sample(vel, px, py, 1);
          along.push(+((vvx * ux + vvy * uz) * dom.h).toFixed(0));
          airP.push(+sample(den, px, py, 0).toFixed(3));
          sol.push(sample(flag, px, py, 0) > 0.5 || sample({ data: Float32Array.from(cells) }, px, py, 0) > 127 ? 1 : 0);
        }
        const peak = Math.max(...along.filter(Number.isFinite));
        const half = along.map((v) => v >= peak * 0.5 ? 1 : 0).reduce((a, b) => a + b, 0);
        const tenth = along.map((v) => v >= peak * 0.1 ? 1 : 0).reduce((a, b) => a + b, 0);
        profiles.push({ d, peak, halfWidthCells: half, tenthWidthCells: tenth, halfWidthJ: half * dom.h, along, air: airP, solid: sol });
      }
      const J = sim.jets;
      res.jet = { nozzles: EF.nozzles[k], spread: +EF.spread[k].toFixed(1), radius: +EF.radius[k].toFixed(1), power: +EF.power[k].toFixed(2),
        simWidthCells: +J[5].toFixed(2), simWidthJ: +(J[5] * dom.h).toFixed(0), simLenJ: +(J[4] * dom.h).toFixed(0), simSpeedJ: +(J[7] * dom.h).toFixed(0), rate: J[8],
        shipW: window.ship.w, shipH: window.ship.h, hullCells: +(Math.min(window.ship.w, window.ship.h) / dom.h).toFixed(1), profiles };
      // dysze MAIN z listy płaskiej: położenie w poprzek osi gromady
      const nz = [];
      for (let i = 0; i < EF.nzCount[k]; i++) { const j = EF.nzFrom[k] + i; const ddx = EF.nzX[j] - EF.x[k], ddy = EF.nzY[j] - EF.y[k];
        nz.push({ across: +(Math.abs(ddx * EF.dirY[k] - ddy * EF.dirX[k])).toFixed(0), r: +EF.nzR[j].toFixed(0) }); }
      res.jet.nozzleList = nz;
    }
    // OSTROŚĆ WIRÓW przy ścianie tylnej (miara 3 planu): w pasie od ściany do wylotów dysz (± 90 komórek od osi),
    // dla komórek z pyłem ≥ 20 % maks. pasa: gęstość / średnia w kole r ≤ 10 komórek; rdzenie 2 najsilniejszych wirów
    // (|ω| z velA, odstęp ≥ 15 komórek): maks. gęstości w r ≤ 3 / średnia w r ≤ 10.
    if (opts.vortex && res.jetCell) {
      const { cx, cy } = res.jetCell;
      const x0 = Math.max(12, Math.round(cx - 90)), x1 = Math.min(w - 12, Math.round(cx + 90));
      const y0 = 12, y1 = Math.min(h - 12, Math.round(cy + 6));
      let maxA = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = den.data[(y * w + x) * 4]; if (a > maxA) maxA = a; }
      const disk = (x, y, r) => { let s = 0, n = 0, m = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r) continue; const q = ((y + j) * w + x + i); if (cells[q * 4 + 2] < 128 || solid(q)) continue;
        const a = den.data[q * 4]; s += a; n++; if (a > m) m = a; } return { mean: n ? s / n : 0, max: m }; };
      const ratios = [];
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const q = y * w + x; const a = den.data[q * 4];
        if (a < 0.2 * maxA || cells[q * 4 + 2] < 128 || solid(q)) continue;
        const d = disk(x, y, 10); if (d.mean > 0) ratios.push(a / d.mean);
      }
      ratios.sort((a, b) => a - b);
      const om = (x, y) => { const V = (i, j, k) => vel.data[((y + j) * w + x + i) * 4 + k]; return 0.5 * (V(1, 0, 1) - V(-1, 0, 1) - V(0, 1, 0) + V(0, -1, 0)); };
      const cand = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = y * w + x; if (cells[q * 4 + 2] < 128 || solid(q)) continue; cand.push([Math.abs(om(x, y)), x, y]); }
      cand.sort((a, b) => b[0] - a[0]);
      const cores = [];
      for (const c of cand) { if (cores.length >= 2) break; if (cores.every((k) => Math.hypot(k.x - c[1], k.y - c[2]) >= 15)) {
        const dd = disk(c[1], c[2], 10), d3 = disk(c[1], c[2], 3);
        cores.push({ x: c[1], y: c[2], omega: +c[0].toFixed(2), max3: +d3.max.toFixed(3), mean10: +dd.mean.toFixed(3), ratio: +(d3.max / Math.max(1e-4, dd.mean)).toFixed(2) }); } }
      res.vortex = { maxAir: +maxA.toFixed(3), ratioMax: ratios.length ? +ratios[ratios.length - 1].toFixed(2) : 0,
        ratioP95: ratios.length ? +ratios[Math.floor(ratios.length * 0.95)].toFixed(2) : 0, cells: ratios.length, cores };
    }
    if (opts.png) {
      const bodies = flag;
      res.pngAir = window.__fieldPng(den, 0, opts.airScale || 0.6, cells, bodies);
      res.pngFloor = window.__fieldPng(den, 1, 1.0, cells, bodies);
      res.pngSpeed = window.__fieldPng(den, 3, 1 / 1500, cells, bodies);
    }
    return res;
  };
  return true;
})()`;

function savePng(dataUrl, file) {
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function measure(name, opts = {}) {
  await pause(true);
  await sleep(250);
  const m = await ev(`window.__metrics(${JSON.stringify(opts)})`, 60000);
  if (m.pngAir) { savePng(m.pngAir, join(out, `${name}-pole-pyl.png`)); delete m.pngAir; }
  if (m.pngFloor) { savePng(m.pngFloor, join(out, `${name}-pole-pokl.png`)); delete m.pngFloor; }
  if (m.pngSpeed) { savePng(m.pngSpeed, join(out, `${name}-pole-v.png`)); delete m.pngSpeed; }
  if (opts.shot) await screenshotPng(cdp, join(out, `${name}.png`));
  const short = { ...m }; delete short.jet; delete short.stats;
  console.log(('[' + name + ']').padEnd(26), JSON.stringify(short));
  if (m.jet) {
    const j = { ...m.jet }; const prof = j.profiles; delete j.profiles; delete j.nozzleList;
    console.log('   strumień:', JSON.stringify(j), 'dysze:', JSON.stringify(m.jet.nozzleList));
    for (const p of prof) console.log(`   d=${p.d} kom. peak=${p.peak} j/s  ½-szer=${p.halfWidthCells} kom. (${p.halfWidthJ} j.)  1/10-szer=${p.tenthWidthCells} kom.`);
  }
  report.kroki.push({ name, ...m });
  await pause(false);
  return m;
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  await ev(PAGE_HELPERS);
  // --tune k=v,sim.k=v — strojenie na żywo (HallDustTune / HallDust.sim.tune + syncTune) bez zmiany plików
  if (args.tune) {
    const ovr = Object.fromEntries(String(args.tune).split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
    report.tune = ovr;
    await ev(`(() => { const o = ${JSON.stringify(ovr)}; const HD = window.HallDust; for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('sim.')) HD.sim.tune[k.slice(4)] = v; else HD.tune[k] = v; } HD.sim.syncTune(); return true; })()`);
    console.log('strojenie:', JSON.stringify(ovr));
  }

  const place = await ev(`(async () => {
    const m = await import('/src/game/hallDustInput.js');
    const e = window.__haloRings.entries.find((q) => q.key === 'earth');
    const owner = e.collider.registry.halls[0];
    const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
    const x = a.p0x - 810 * a.ax + 1900 * a.bx;
    const y = a.p0y - 810 * a.ay + 1900 * a.by;
    const heading = Math.atan2(a.by, a.bx);
    window.DevScene.teleport(x, y, heading);
    window.DevScene.syncCamera();
    window.__hold = { x, y, heading, on: true };
    return { x, y, heading, w: window.ship.w, h: window.ship.h };
  })()`);
  report.place = place;
  console.log('miejsce:', JSON.stringify(place));
  await ev(`(() => {
    const H = window.__hold;
    const tick = () => {
      if (H.on) { const s = window.ship; s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  await setZoom(ZOOM);
  await sleep(3000);
  const m0 = await measure('00-postoj', { png: true, shot: true });
  report.domena = await ev(`(() => { const d = window.HallDust.domain; return { ...d, tune: { ...window.HallDust.sim.tune }, hallTune: Object.fromEntries(Object.entries(window.HallDustTune).filter(([k, v]) => typeof v !== 'object')) }; })()`);
  console.log('domena:', JSON.stringify(report.domena));

  // trzy odpalenia po 5 s z przerwami po 6 s
  for (let blast = 1; blast <= 3; blast++) {
    await down('w');
    await sleep(1000); await measure(`${blast}0-ciag-1s`, { shot: blast === 1 });
    await sleep(1500); await measure(`${blast}1-ciag-2.5s`, { png: true, shot: true });
    await sleep(2500); await measure(`${blast}2-ciag-5s`, { png: true, shot: true });
    await up('w');
    await sleep(2000); await measure(`${blast}3-po-2s`, {});
    await sleep(4000); await measure(`${blast}4-po-6s`, { png: true, shot: blast === 1 || blast === 3, vortex: true });
    // po pierwszym odpaleniu 30 s spoczynku (miara 2 planu: pył wraca na pokład, drugie odpalenie ma co podnieść)
    if (blast === 1) { await sleep(24000); await measure('15-po-30s', { png: true, shot: true, vortex: true }); }
    if (args.krotko) break;   // --krotko 1: tylko pierwsze odpalenie i 30 s spoczynku (szybkie próby strojenia)
  }

  if (args.krotko) throw new Error('--krotko: koniec po pierwszym odpaleniu');
  // Jacobi A/B: residuum dywergencji po rzucie przy 31 vs 121 iteracjach (ten sam stan, jeden podkrok)
  await down('w');
  await sleep(2500);
  await pause(true); await sleep(250);
  report.jacobiAB = await ev(`(async () => {
    const r = window.Core3D.renderer, sim = window.HallDust.sim;
    const dom = window.HallDust.domain;
    const run = async (iters, n) => {
      const prev = sim.jacobi; sim.jacobi = iters;
      for (let i = 0; i < n; i++) sim.step(r, 1 / 60);
      await r.backend.device.queue.onSubmittedWorkDone();
      sim.jacobi = prev;
      const m = await window.__metrics({ dists: [10] });
      return { divRms: m.divRms, velRms: m.velRms, ratio: +(m.divRms / Math.max(1e-6, m.velRms)).toFixed(3), maxSpeed: m.maxSpeed, rmsSpeed: m.rmsSpeed, peak10: m.jet && m.jet.profiles[0].peak, half10: m.jet && m.jet.profiles[0].halfWidthCells };
    };
    const out = {};
    out.j31 = await run(31, 1);
    out.j121 = await run(121, 1);
    out.j31b = await run(31, 1);
    out.j301 = await run(301, 1);
    return out;
  })()`, 120000);
  console.log('Jacobi A/B:', JSON.stringify(report.jacobiAB));
  await pause(false);
  await up('w');
  await sleep(500);

  // tunel za lecącym Atlasem: hold off, pełny ciąg ku bramie
  await ev(`(() => { window.__hold.on = false; return true; })()`);
  await ev(`(() => { const H = window.__hold; window.DevScene.teleport(H.x, H.y, H.heading); window.DevScene.syncCamera(); return true; })()`);
  await sleep(500);
  await down('w');
  await sleep(3000);
  await measure('40-lot-3s', { png: true, shot: true, dists: [6, 14, 24, 40] });
  await sleep(2500);
  await measure('41-lot-5.5s', { png: true, shot: true, dists: [6, 14, 24, 40, 60] });
  await up('w');
  await setZoom(0.12);
  await sleep(600);
  await pause(true); await sleep(250);
  await screenshotPng(cdp, join(out, '42-lot-cala-hala.png'));
  await pause(false);
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
