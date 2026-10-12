// HARNESS dema „3D gaz” (dema/3d-gaz.html — gaz i pył hali K-7 na siatce 3D, docs/BRIEF-gaz-hali-3d.md, plan
// docs/PLAN-3d-gaz.md): Vite (własny serwer bez przeładowań) + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/3d-gaz-demo.mjs --tryb e0 [--out .tmp/3d-gaz/E0] [--komorki 48,56,64] [--jacobi 30]
//        [--cisnienie buffer,texture] [--n0 20 --n1 120] [--powtorz 2] [--port 5441]
//   node scripts/webgpu/3d-gaz-demo.mjs --tryb e1 [--out .tmp/3d-gaz/E1] [--tune k=v,…] [--etapy ciag,lot,start,para,bilans,det,koszt]
//        [--rozmiar 1600x900] [--port 5441]
//
// Tryb e0: pomiar SZKIELETU kroku (src/3d/hallGas3d/hallGas3dBench.js) przy komórce 48 / 56 / 64 j.
// Tryb e1: SOLVER (src/3d/hallGas3d/hallGas3d.js) — protokół audytu pyłu 2D (hala-pyl-audyt.mjs) w demie, zegar wirtualny
// (scripts/webgpu/harness-strona.js — klatki po 1/60 s na żądanie, deterministycznie), po każdym kroku odczyt pól 3D z GPU
// (gęstości, prędkości, zajętość, pokład) → miary § 10 briefu (zawinięcie przy ścianie, grzyb, tunel, bilans pokładu,
// kurz spod kadłuba, para, residuum dywergencji, rdzenie wirów, zachowanie masy, determinizm), koszt kroku (nachylenie
// czasu kolejki, prawdziwy zegar), pipeline'y synchroniczne, zrzuty i przekroje pól (PNG) w katalogu wyników.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson, screenshotPng } from './wspolne.mjs';

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
const kv = (s) => Object.fromEntries(String(s || '').split(',').filter(Boolean).map((p) => p.split('=')).map(([k, v]) => [k, Number(v)]));

// --- pomocniki strony (E1): odczyt pól 3D z GPU, miary, przekroje PNG ----------------------------------------------------
const PAGE_HELPERS = `(() => {
  const f16 = (h) => { const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const m = h & 0x3ff;
    if (e === 0) return s * m * 5.960464477539063e-8; if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * Math.pow(2, e - 15); };
  const LUT = new Float32Array(65536); for (let i = 0; i < 65536; i++) LUT[i] = f16(i);
  const readTex = async (tex, depth) => {
    const r = window.Core3D.renderer; const dev = r.backend.device;
    const gpuTex = r.backend.get(tex).texture;
    const w = tex.image.width, h = tex.image.height, d = depth || 1;
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: gpuTex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const o = new Float32Array(w * h * d * 4);
    const raw = new Uint16Array(w * h * d * 4);
    const row = bpr / 2;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) {
      const src = (z * h + y) * row, dst = (z * h + y) * w * 4;
      for (let x = 0; x < w * 4; x++) { const v = u16[src + x]; raw[dst + x] = v; o[dst + x] = LUT[v]; }
    }
    return { w, h, d, data: o, raw };
  };
  const hashU16 = (a) => { let h1 = 0x811c9dc5 >>> 0; for (let i = 0; i < a.length; i++) { h1 ^= a[i]; h1 = Math.imul(h1, 16777619) >>> 0; } return h1.toString(16); };
  const G = () => window.HallGas3D;
  window.__g3 = {};
  window.__g3.snap = async () => {
    const g = G().grid; const dom = g.domain;
    await window.Core3D.renderer.backend.device.queue.onSubmittedWorkDone();
    return { den: await readTex(g.denA, dom.nh), vel: await readTex(g.velA, dom.nh), occ: await readTex(g.occT, dom.nh),
      velB: await readTex(g.velB, dom.nh), deck: await readTex(g.deckA, 1), face: g.faceT ? await readTex(g.faceT, dom.nh) : null };
  };
  // środek gromady dysz MAIN klatki (EngineFrame — scena → gra → hala, przekształcenie modułu gazu)
  window.__g3.nozzles = async () => { const EF = (await import('/src/3d/engineFrame.js')).EngineFrame; const a = G()._aff;
    const det = a.ax * a.by - a.ay * a.bx; let n = 0, sx = 0, sz = 0;
    for (let k = 0; k < EF.count; k++) for (let j = EF.nzFrom[k]; j < EF.nzFrom[k] + EF.nzCount[k]; j++) {
      const dx = EF.nzX[j] - a.p0x, dy = -EF.nzY[j] - a.p0y; sx += (a.by * dx - a.bx * dy) / det; sz += (a.ax * dy - a.ay * dx) / det; n++; }
    return n ? { x: sx / n, z: sz / n, n } : null; };
  window.__g3.hash = async () => { const s = await window.__g3.snap(); return { den: hashU16(s.den.raw), vel: hashU16(s.vel.raw), deck: hashU16(s.deck.raw) }; };
  const pip = (poly, x, z) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; };
  // obraz pola (PNG): kanały RGB z funkcji komórki
  const png = (w, h, sc, fn) => { const cv = document.createElement('canvas'); cv.width = w * sc; cv.height = h * sc;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(w * sc, h * sc);
    for (let y = 0; y < h * sc; y++) for (let x = 0; x < w * sc; x++) { const c = fn(Math.floor(x / sc), Math.floor(y / sc)); const o = (y * w * sc + x) * 4;
      img.data[o] = Math.max(0, Math.min(255, c[0] * 255)); img.data[o + 1] = Math.max(0, Math.min(255, c[1] * 255)); img.data[o + 2] = Math.max(0, Math.min(255, c[2] * 255)); img.data[o + 3] = 255; }
    ctx.putImageData(img, 0, 0); return cv.toDataURL('image/png'); };
  window.__g3.metrics = async (opts = {}) => {
    const S = G(); const g = S.grid; const dom = g.domain; const { nx, nd, nh, h, x0, z0 } = dom;
    const s = await window.__g3.snap();
    const den = s.den.data, vel = s.vel.data, occ = s.occ.data, velB = s.velB.data, deck = s.deck.data;
    const stat = g.statTex.image.data;
    const look = S.volume.look; const T = S.tune; const L = window.__gaz.layout;
    const ix = (i, j, k) => (k * nd + j) * nx + i;
    const res = { t: +window.__gaz.state.T.toFixed(3) };
    let air = 0, airIn = 0, vap = 0, exh = 0, vapLow = 0, exhHi500 = 0;
    for (let k = 0; k < nh; k++) for (let j = 0; j < nd; j++) for (let i = 0; i < nx; i++) {
      const c = ix(i, j, k); const a = den[c * 4], v = den[c * 4 + 1], e = den[c * 4 + 2];
      air += a; vap += v; exh += e; if (stat[c * 4 + 1] > 127) airIn += a;
      if ((k + 0.5) * h < 116) vapLow += v;
      if ((k + 0.5) * h > 500) exhHi500 += e;
    }
    let deckSum = 0; for (let q = 0; q < s.deck.w * s.deck.h; q++) deckSum += deck[q * 4];
    // pokład względem stanu odniesienia (opts.deckRef: 'set' — zapamiętaj): ZDJĘTE = Σ max(0, D_ref − D) (lokalny ubytek —
    // osiadanie gdzie indziej go nie maskuje), PRZYBYŁO = Σ max(0, D − D_ref)
    if (opts.deckRef === 'set') window.__g3.deckRef = Float32Array.from({ length: s.deck.w * s.deck.h }, (_, q) => deck[q * 4]);
    if (opts.deckRef === 'use' && window.__g3.deckRef) { const R = window.__g3.deckRef; let lost = 0, gained = 0;
      for (let q = 0; q < R.length; q++) { const d = deck[q * 4] - R[q]; if (d < 0) lost -= d; else gained += d; }
      res.deckLost = +(lost * T.deckMass).toFixed(2); res.deckGained = +(gained * T.deckMass).toFixed(2); }
    res.air = +air.toFixed(2); res.airIn = +airIn.toFixed(2); res.deck = +(deckSum * T.deckMass).toFixed(2);
    res.dustTotal = +(air + deckSum * T.deckMass).toFixed(2); res.vapor = +vap.toFixed(3); res.vaporLowFrac = vap > 1e-6 ? +(vapLow / vap).toFixed(4) : null;
    res.exhaust = +exh.toFixed(2); res.exhaustHi500 = +exhHi500.toFixed(2);
    // pas 1,5 km od ściany tylnej (lico wewnętrzne): spaliny nad y = 300, szczyt prędkości pionowej przy ścianie
    const zw = L.backZ + L.wallThickness * 0.5;
    const jetX = opts.jetX ?? window.__gaz.flight.x;
    let bandE = 0, bandHi = 0, vzMax = 0, vzAt = null;
    for (let k = 0; k < nh; k++) for (let j = 0; j < nd; j++) { const zc = z0 + (j + 0.5) * h; if (zc < zw || zc > zw + 1500) continue;
      for (let i = 0; i < nx; i++) { const c = ix(i, j, k); if (stat[c * 4 + 1] < 128) continue; const e = den[c * 4 + 2]; bandE += e; if ((k + 0.5) * h > 300) bandHi += e;
        const xc = x0 + (i + 0.5) * h;
        if (zc < zw + 2 * h && Math.abs(xc - jetX) < 1200 && occ[c * 4] < 0.5) { const vz = vel[c * 4 + 2] * h; if (vz > vzMax) { vzMax = vz; vzAt = [Math.round(xc), Math.round(zc), Math.round((k + 0.5) * h)]; } } } }
    res.wall = { exhaustBand: +bandE.toFixed(2), exhaustAbove300: +bandHi.toFixed(2), fracAbove300: bandE > 1e-6 ? +(bandHi / bandE).toFixed(4) : null, vzMax: Math.round(vzMax), vzAt };
    // przepuszczalność nad kadłubem (kolumny w obrysie Atlasa od szczytu kadłuba w górę) — ta sama gęstość optyczna co obraz
    if (opts.hull !== false && window.__gaz.atlas) {
      const pts = window.__gaz.flight.polygon().map((q) => [q.x, q.z]);
      const Ts = [];
      for (let j = 0; j < nd; j++) for (let i = 0; i < nx; i++) { const xc = x0 + (i + 0.5) * h, zc = z0 + (j + 0.5) * h; if (!pip(pts, xc, zc)) continue;
        let tau = 0; for (let k = 0; k < nh; k++) { const lo = Math.max(k * h, 116), hi = (k + 1) * h; if (hi <= lo) continue; const c = ix(i, j, k);
          tau += (look.densDust * Math.max(0, den[c * 4]) + look.densVapor * Math.max(0, den[c * 4 + 1]) + look.densExhaust * Math.max(0, den[c * 4 + 2])) * (hi - lo) / h; }
        Ts.push(Math.exp(-tau)); }
      Ts.sort((a, b) => a - b);
      res.hullT = Ts.length ? { n: Ts.length, min: +Ts[0].toFixed(4), p10: +Ts[Math.floor(Ts.length * 0.1)].toFixed(4), mean: +(Ts.reduce((a, b) => a + b, 0) / Ts.length).toFixed(4) } : null;
    }
    // residuum dywergencji po rzucie / v_rms (komórki płynu w hali, bez brzegu domeny)
    { let r2 = 0, v2 = 0, n = 0;
      const V = (i, j, k, comp, ci, cj, ck) => { // sąsiad: stały — prędkość przeszkody, pokład — 0, poza domeną — komórka
        if (k < 0) return 0; const ii = Math.min(nx - 1, Math.max(0, i)), jj = Math.min(nd - 1, Math.max(0, j)), kk = Math.min(nh - 1, k);
        const c = ix(ii, jj, kk); return occ[c * 4] >= 0.5 ? occ[c * 4 + 1 + comp] : vel[c * 4 + comp]; };
      for (let k = 0; k < nh; k++) for (let j = 1; j < nd - 1; j++) for (let i = 1; i < nx - 1; i++) { const c = ix(i, j, k);
        if (occ[c * 4] >= 0.5 || stat[c * 4 + 1] < 128) continue;
        const d = 0.5 * (V(i + 1, j, k, 0) - V(i - 1, j, k, 0) + V(i, j + 1, k, 1) - V(i, j - 1, k, 1) + V(i, j, k + 1, 2) - V(i, j, k - 1, 2)) - velB[c * 4 + 3];
        r2 += d * d; const a = vel[c * 4], b = vel[c * 4 + 1], e = vel[c * 4 + 2]; v2 += a * a + b * b + e * e; n++; }
      res.div = { rms: +Math.sqrt(r2 / Math.max(1, n)).toFixed(5), vRms: +Math.sqrt(v2 / Math.max(1, n)).toFixed(4), ratio: v2 > 0 ? +(Math.sqrt(r2 / n) / Math.sqrt(v2 / n)).toFixed(4) : null, vRmsJ: +(Math.sqrt(v2 / Math.max(1, n)) * h).toFixed(1) };
      // residuum dywergencji ŚCIANOWEJ pola transportu (faceT: Σ(F₊ − F₋) − S; pokład F₋ = 0) / v_rms — miara § 10
      if (s.face) { const F = s.face.data; let f2 = 0, nf = 0, src2 = 0, nsrc = 0;
        for (let k = 0; k < nh; k++) for (let j = 1; j < nd - 1; j++) for (let i = 1; i < nx - 1; i++) { const c = ix(i, j, k);
          if (occ[c * 4] >= 0.5 || stat[c * 4 + 1] < 128) continue;
          const d = F[c * 4] - F[ix(i - 1, j, k) * 4] + F[c * 4 + 1] - F[ix(i, j - 1, k) * 4 + 1] + F[c * 4 + 2] - (k > 0 ? F[ix(i, j, k - 1) * 4 + 2] : 0) - velB[c * 4 + 3];
          f2 += d * d; nf++; if (velB[c * 4 + 3] > 0.01) { src2 += d * d; nsrc++; } }
        res.div.face = +Math.sqrt(f2 / Math.max(1, nf)).toFixed(5);
        res.div.faceRatio = v2 > 0 ? +(Math.sqrt(f2 / Math.max(1, nf)) / Math.sqrt(v2 / n)).toFixed(4) : null;
        res.div.faceSrcShare = f2 > 0 ? +(src2 / f2).toFixed(3) : null; }
      // rozbicie resztki (diagnostyka): komórki przy przeszkodzie / pokładzie, w źródłach objętości, wnętrze
      if (opts.divParts) {
        const acc = { wall: [0, 0], src: [0, 0], inner: [0, 0] };
        for (let k = 0; k < nh; k++) for (let j = 1; j < nd - 1; j++) for (let i = 1; i < nx - 1; i++) { const c = ix(i, j, k);
          if (occ[c * 4] >= 0.5 || stat[c * 4 + 1] < 128) continue;
          const d = 0.5 * (V(i + 1, j, k, 0) - V(i - 1, j, k, 0) + V(i, j + 1, k, 1) - V(i, j - 1, k, 1) + V(i, j, k + 1, 2) - V(i, j, k - 1, 2)) - velB[c * 4 + 3];
          const nbS = k === 0 || [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([a, b, e]) => { const kk = k + e; if (kk < 0 || kk >= nh) return false; return occ[ix(i + a, j + b, kk) * 4] >= 0.5; });
          const key = nbS ? 'wall' : (velB[c * 4 + 3] > 0.01 ? 'src' : 'inner');
          acc[key][0] += d * d; acc[key][1]++; }
        res.divParts = Object.fromEntries(Object.entries(acc).map(([key, [r, m]]) => [key, { n: m, share: +(r / Math.max(1e-12, r2)).toFixed(3), rms: +Math.sqrt(r / Math.max(1, m)).toFixed(4) }]));
      }
    }
    // rdzenie wirów w pasie przy ścianie: |ω| z velA, 2 najsilniejsze (odstęp ≥ 8 komórek), max pyłu (r ≤ 2) / średnia (r ≤ 5)
    if (opts.vortex) {
      const om = (i, j, k) => { const Vv = (a, b, c2, comp) => vel[ix(Math.min(nx - 1, Math.max(0, a)), Math.min(nd - 1, Math.max(0, b)), Math.min(nh - 1, Math.max(0, c2))) * 4 + comp];
        const wx = 0.5 * (Vv(i, j + 1, k, 2) - Vv(i, j - 1, k, 2) - Vv(i, j, k + 1, 1) + Vv(i, j, k - 1, 1));
        const wy = 0.5 * (Vv(i, j, k + 1, 0) - Vv(i, j, k - 1, 0) - Vv(i + 1, j, k, 2) + Vv(i - 1, j, k, 2));
        const wz = 0.5 * (Vv(i + 1, j, k, 1) - Vv(i - 1, j, k, 1) - Vv(i, j + 1, k, 0) + Vv(i, j - 1, k, 0)); return Math.sqrt(wx * wx + wy * wy + wz * wz); };
      const cand = [];
      for (let k = 0; k < nh; k++) for (let j = 1; j < nd - 1; j++) { const zc = z0 + (j + 0.5) * h; if (zc < zw || zc > zw + 1500) continue;
        for (let i = 1; i < nx - 1; i++) { const xc = x0 + (i + 0.5) * h; if (Math.abs(xc - jetX) > 1600) continue; const c = ix(i, j, k);
          if (occ[c * 4] >= 0.5 || stat[c * 4 + 1] < 128) continue; cand.push([om(i, j, k), i, j, k]); } }
      cand.sort((a, b) => b[0] - a[0]);
      const sphere = (ci, cj, ck, r) => { let sum = 0, n = 0, mx = 0; for (let k = ck; k <= ck; k++) for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= nd || k >= nh) continue; if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
        const c = ix(i, j, k); if (occ[c * 4] >= 0.5 || stat[c * 4 + 1] < 128) continue; const a = den[c * 4]; sum += a; n++; if (a > mx) mx = a; }
        return { mean: n ? sum / n : 0, max: mx }; };
      const cores = [];
      for (const cc of cand) { if (cores.length >= 2) break; if (cores.every((q) => Math.hypot(q.i - cc[1], q.j - cc[2], q.k - cc[3]) >= 8)) {
        const s5 = sphere(cc[1], cc[2], cc[3], 5), s2 = sphere(cc[1], cc[2], cc[3], 2);
        cores.push({ i: cc[1], j: cc[2], k: cc[3], omega: +(cc[0]).toFixed(3), max2: +s2.max.toFixed(4), mean5: +s5.mean.toFixed(4), ratio: +(s2.max / Math.max(1e-6, s5.mean)).toFixed(3) }); } }
      res.vortex = { cores, ratioMax: cores.length ? Math.max(...cores.map((q) => q.ratio)) : null };
    }
    // profil w poprzek toru (tunel za lecącym okrętem): kolumna pyłu w powietrzu (Σ warstw)
    const colDust = (x, z, kMax = nh, kMin = 0) => { const i = Math.floor((x - x0) / h), j = Math.floor((z - z0) / h); if (i < 0 || j < 0 || i >= nx || j >= nd) return NaN;
      let sum = 0; for (let k = kMin; k < kMax; k++) sum += Math.max(0, den[ix(i, j, k) * 4]); return sum; };
    // kolumna z bryłą stojącą na pokładzie (słupek paliwowy, ściana, rurociąg — warstwa 0 albo 1 zajęta ≥ 0,5): poza
    // profilem tunelu (pył 0 w bryle zaniżałby tło i udawał tunel)
    const colSolid = (x, z) => { const i = Math.floor((x - x0) / h), j = Math.floor((z - z0) / h); if (i < 0 || j < 0 || i >= nx || j >= nd) return true;
      return occ[ix(i, j, 0) * 4] >= 0.5 || occ[ix(i, j, 1) * 4] >= 0.5; };
    // DEFINICJA AUDYTU 2D § 6 (docs/AUDYT-pyl-hali-2026-10-12.md): profil w poprzek osi gromady dysz co 28 j. (komórka pola
    // 2D) w odległości d za wylotami; tło = mediana |s| 24…40 komórek (672…1120 j.); tunel = komórki ciągiem od osi z pyłem
    // < 35 % tła; flanka = maks. pyłu w 10 komórkach (280 j.) za brzegiem tunelu / tło. Pył = kolumna (widok z góry) albo
    // pasmo warstw opts.tunnel.k.
    if (opts.tunnel) {
      const { ax, az, dx, dz } = opts.tunnel; const px = -dz, pz = dx;
      res.tunnel = [];
      for (const d of opts.tunnel.d || [392, 672]) {
        const kr = opts.tunnel.k || [0, nh];
        const prof = []; for (let q = -48; q <= 48; q++) { const x = ax - dx * d + px * q * 28, z = az - dz * d + pz * q * 28;
          prof.push([q * 28, colSolid(x, z) && q !== 0 ? NaN : colDust(x, z, kr[1], kr[0])]); }
        const bgv = prof.filter(([sOff]) => Math.abs(sOff) >= 672 && Math.abs(sOff) <= 1120).map(([, v]) => v).filter(Number.isFinite).sort((a, b) => a - b);
        const bg = bgv.length ? bgv[bgv.length >> 1] : NaN;
        const mid = 48;
        let lo = mid, hi = mid, width = 0;
        // próbki w bryle (NaN) nie przerywają tunelu i nie liczą się do flanki
        const inT = (v) => !(v >= 0.35 * bg);
        if (prof[mid][1] < 0.35 * bg) {
          while (lo > 0 && inT(prof[lo - 1][1])) lo--;
          while (hi < prof.length - 1 && inT(prof[hi + 1][1])) hi++;
          while (lo < mid && !Number.isFinite(prof[lo][1])) lo++;
          while (hi > mid && !Number.isFinite(prof[hi][1])) hi--;
          width = (hi - lo + 1) * 28;
        }
        let flank = 0;
        for (let q = 1; q <= 10; q++) {
          if (lo - q >= 0 && Number.isFinite(prof[lo - q][1])) flank = Math.max(flank, prof[lo - q][1]);
          if (hi + q < prof.length && Number.isFinite(prof[hi + q][1])) flank = Math.max(flank, prof[hi + q][1]);
        }
        res.tunnel.push({ d, k: kr, bg: +bg.toFixed(4), axis: +prof[mid][1].toFixed(4), width, flankRatio: bg > 0 ? +(flank / bg).toFixed(3) : null,
          prof: prof.filter((_, q) => q % 2 === 0).map(([sOff, v]) => [sOff, Number.isFinite(v) ? +v.toFixed(3) : null]) });
      }
    }
    // kurz spod kadłuba: od burty na zewnątrz (stacje wzdłuż kadłuba; burta = brzeg płyty kadłuba w zajętości gazu —
    // warstwa 1 zajęta ≥ 0,5, tak jak kadłub widzi solver), pył w dolnych 2 warstwach; pas = odległość od burty, na której
    // pył > 2 × tło (tło: mediana 1500–2000 j. od burty)
    if (opts.side) {
      const { cx, cz, fx, fz } = opts.side; const px = -fz, pz = fx;
      const plateAt = (x, z) => { const i = Math.floor((x - x0) / h), j = Math.floor((z - z0) / h); return i >= 0 && j >= 0 && i < nx && j < nd && occ[ix(i, j, 1) * 4] >= 0.5; };
      res.side = [];
      for (const st of opts.side.stations || [0, -450]) {
        for (const sg of [-1, 1]) {
          let halfW = 0; while (halfW < 1500 && plateAt(cx + fx * st + px * sg * (halfW + 7), cz + fz * st + pz * sg * (halfW + 7))) halfW += 7;
          const bx = cx + fx * st + px * sg * halfW, bz = cz + fz * st + pz * sg * halfW;
          const prof = []; for (let e = 0; e <= 2000; e += 28) prof.push([e, colDust(bx + px * sg * e, bz + pz * sg * e, 2)]);
          const bgv = prof.filter(([e]) => e >= 1500).map(([, v]) => v).filter(Number.isFinite).sort((a, b) => a - b);
          const bg = bgv.length ? bgv[bgv.length >> 1] : NaN;
          const thr = Math.max(2 * bg, bg + (opts.side.thr ?? 0.02));
          let band = 0; for (const [e, v] of prof) { if (v > thr) band = e + 28; else if (e > 56) break; }
          // pas ubytku pokładu (poderwany kurz): D_ref − D ≥ 0,02 od burty na zewnątrz (pierwsza przerwa > 2 komórek kończy pas)
          let bandDeck = 0;
          if (window.__g3.deckRef) { const R = window.__g3.deckRef; let gap = 0;
            for (let e = 0; e <= 2000; e += 28) { const x = bx + px * sg * e, z = bz + pz * sg * e; const a = Math.floor((x - x0) / (h * 0.5)), b = Math.floor((z - z0) / (h * 0.5));
              if (a < 0 || b < 0 || a >= s.deck.w || b >= s.deck.h) break; const q = b * s.deck.w + a;
              if (R[q] - deck[q * 4] >= 0.02) { bandDeck = e + 28; gap = 0; } else if (++gap > 2) break; } }
          res.side.push({ station: st, side: sg, halfW, bg: +bg.toFixed(4), band, bandDeck, peak: +Math.max(...prof.map(([, v]) => v)).toFixed(3), prof: prof.filter((_, q) => q % 3 === 0).map(([e, v]) => [e, +v.toFixed(3)]) });
        }
      }
      res.sideBandMin = Math.min(...res.side.map((q) => q.band));
      res.sideDeckBandMin = Math.min(...res.side.map((q) => q.bandDeck));
    }
    // przekrój w poprzek kadłuba (diagnostyka szczeliny): e — odległość od osi kadłuba w bok [j.]; warstwa 0: prędkość
    // poprzeczna / wzdłużna [j/s] (velB — jak pokład), zajętość i znacznik celu szczeliny, cel poprzeczny, pokład teraz /
    // odniesienie, pył warstw 0 i 1
    if (opts.cross) {
      const { cx, cz, fx, fz } = opts.cross; const px = -fz, pz = fx; const R = window.__g3.deckRef; const rows = [];
      for (const st of opts.cross.stations || [0]) for (let e = -1400; e <= 1400; e += 56) {
        const x = cx + fx * st + px * e, z = cz + fz * st + pz * e;
        const i = Math.floor((x - x0) / h), j = Math.floor((z - z0) / h); if (i < 0 || j < 0 || i >= nx || j >= nd) continue;
        const c0 = ix(i, j, 0), c1 = ix(i, j, 1);
        const a = Math.floor((x - x0) / (h * 0.5)), b = Math.floor((z - z0) / (h * 0.5)); const qd = b * s.deck.w + a;
        rows.push([st, e, Math.round((velB[c0 * 4] * px + velB[c0 * 4 + 1] * pz) * h), Math.round((velB[c0 * 4] * fx + velB[c0 * 4 + 1] * fz) * h),
          +occ[c0 * 4].toFixed(2), occ[c0 * 4 + 3] > 0.5 ? Math.round((occ[c0 * 4 + 1] * px + occ[c0 * 4 + 2] * pz) * h) : '-',
          +deck[qd * 4].toFixed(3), R ? +R[qd].toFixed(3) : null, +den[c0 * 4].toFixed(3), +den[c1 * 4].toFixed(3)]);
      }
      res.cross = rows;
    }
    // przekrój pionowy w poprzek toru (diagnostyka tunelu): warstwy k = 0…kMax, s — odległość od osi toru [j.]; pył,
    // spaliny, prędkość poprzeczna i pionowa [j/s]
    if (opts.slab) {
      const { ax, az, dx, dz, d } = opts.slab; const px = -dz, pz = dx; const rows = [];
      for (let k = 0; k <= (opts.slab.kMax ?? 5); k++) {
        const r = { k, dust: [], exh: [], vs: [], vy: [] };
        for (let sOff = -980; sOff <= 980; sOff += 56) {
          const x = ax - dx * d + px * sOff, z = az - dz * d + pz * sOff;
          const i = Math.floor((x - x0) / h), j = Math.floor((z - z0) / h); const c = ix(i, j, k);
          r.dust.push(+den[c * 4].toFixed(3)); r.exh.push(+den[c * 4 + 2].toFixed(2));
          r.vs.push(Math.round((vel[c * 4] * px + vel[c * 4 + 1] * pz) * h)); r.vy.push(Math.round(vel[c * 4 + 2] * h));
        }
        rows.push(r);
      }
      res.slab = rows;
    }
    // przekroje (PNG): pion przez oś strumienia (głąb × wysokość — spaliny R, pył G, para B; bryły szare), pokład, kolumna pyłu
    if (opts.png) {
      const iJet = Math.max(0, Math.min(nx - 1, Math.floor((jetX - x0) / h)));
      res.pngSlice = png(nd, nh, 6, (j, y) => { const k = nh - 1 - y; const c = ix(iJet, j, k); if (occ[c * 4] >= 0.5) return [0.35, 0.35, 0.38];
        return [den[c * 4 + 2] * 1.2, den[c * 4] * 1.6, den[c * 4 + 1] * 2]; });
      res.pngSliceV = png(nd, nh, 6, (j, y) => { const k = nh - 1 - y; const c = ix(iJet, j, k); if (occ[c * 4] >= 0.5) return [0.35, 0.35, 0.38];
        const vy = vel[c * 4 + 1] * h, vz = vel[c * 4 + 2] * h; return [Math.max(0, vz) / 900, Math.abs(vy) / 1800, Math.max(0, -vz) / 900]; });
      res.pngDeck = png(s.deck.w, s.deck.h, 1, (a, b) => { const v = deck[(b * s.deck.w + a) * 4]; return [v, v * 0.9, v * 0.75]; });
      // ubytek / przyrost pokładu względem odniesienia (czerwony — zdjęte, zielony — przybyło; × 10) i prędkość warstwy 0
      // (|velB| / 600 j/s: niebieski; biały pas — ponad próg podrywania liftLo)
      if (window.__g3.deckRef) { const R = window.__g3.deckRef;
        res.pngDeckDiff = png(s.deck.w, s.deck.h, 1, (a, b) => { const q = b * s.deck.w + a; const d = deck[q * 4] - R[q]; return [Math.max(0, -d) * 10, Math.max(0, d) * 10, 0]; }); }
      res.pngSpeed0 = png(nx, nd, 2, (i, j) => { const c = ix(i, j, 0); const sp = Math.hypot(velB[c * 4], velB[c * 4 + 1], velB[c * 4 + 2]) * h;
        if (occ[c * 4] >= 0.5) return [0.3, 0.3, 0.3]; const over = sp > T.liftLo ? 0.5 : 0; return [over, over, sp / 600]; });
      res.pngCol = png(nx, nd, 2, (i, j) => { let a = 0, e = 0, v = 0; for (let k = 0; k < nh; k++) { const c = ix(i, j, k); a += den[c * 4]; e += den[c * 4 + 2]; v += den[c * 4 + 1]; }
        if (occ[ix(i, j, 1) * 4] >= 0.5) return [0.25 + a * 0.3, 0.25 + a * 0.3, 0.35]; return [e * 0.15 + a * 0.35, a * 0.35, v * 0.5 + a * 0.3]; });
    }
    // profil wzdłuż osi strugi (x = jetX + przesunięcia): prędkość pozioma w warstwach 0–2 [j/s] (velB — jak pokład), pył,
    // depozyt pokładu pod komórką
    if (opts.axis) {
      const vB = velB; const rows = [];
      for (const dx of opts.axis.dx || [0]) for (let z = opts.axis.z0 ?? 300; z <= (opts.axis.z1 ?? 1100); z += 56) {
        const i = Math.floor((jetX + dx - x0) / h), j = Math.floor((z - z0) / h); if (i < 0 || j < 0 || i >= nx || j >= nd) continue;
        const sp = [0, 1, 2].map((k) => { const c = ix(i, j, k); return Math.round(Math.hypot(vB[c * 4], vB[c * 4 + 1], vB[c * 4 + 2]) * h); });
        const a = Math.floor((jetX + dx - x0) / (h * 0.5)), b = Math.floor((z - z0) / (h * 0.5));
        rows.push([dx, z, ...sp, +den[ix(i, j, 0) * 4].toFixed(3), +deck[(b * s.deck.w + a) * 4].toFixed(3), +occ[ix(i, j, 0) * 4].toFixed(2), +occ[ix(i, j, 1) * 4].toFixed(2)]);
      }
      res.axis = rows;
    }
    res.stats = { ...S.stats };
    return res;
  };
  return true;
})()`;

const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))})`);
const secs = (s) => step(s * 60);
const savePng = (dataUrl, file) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

async function measure(name, opts = {}) {
  const m = await ev(`window.__g3.metrics(${JSON.stringify(opts)})`, 120000);
  for (const k of ['pngSlice', 'pngSliceV', 'pngDeck', 'pngCol', 'pngDeckDiff', 'pngSpeed0']) if (m[k]) { savePng(m[k], join(out, `${name}-${k.slice(3).toLowerCase()}.png`)); delete m[k]; }
  if (opts.shot) await screenshotPng(cdp, join(out, `${name}.png`));
  const short = { t: m.t, air: m.air, deck: m.deck, total: m.dustTotal, exh: m.exhaust, exh500: m.exhaustHi500, vapor: m.vapor, wall: m.wall, hullT: m.hullT, div: m.div };
  console.log(`[${name}]`.padEnd(22), JSON.stringify(short));
  if (m.vortex) console.log('   wiry:', JSON.stringify(m.vortex));
  if (m.tunnel) for (const t of m.tunnel) console.log(`   tunel d=${t.d}: tło ${t.bg} oś ${t.axis} szer. ${t.width} j. flanka ×${t.flankRatio}`);
  if (m.side) console.log('   burty [stacja, burta, ½ szer., pas pyłu, tło, szczyt, pas ubytku pokładu]:', JSON.stringify(m.side.map((q) => [q.station, q.side, q.halfW, q.band, q.bg, q.peak, q.bandDeck])), 'min', m.sideBandMin, 'pokład min', m.sideDeckBandMin);
  if (m.axis) for (const r of m.axis) console.log('   oś', JSON.stringify(r));
  (report.kroki ||= []).push({ name, ...m });
  return m;
}

try {
  if (mode === 'e0') {
    await cdp.send('Page.navigate', { url: `${base}/dema/3d-gaz.html?shot=1&pokaz=0` });
    if (!await waitFor(cdp, '!!(window.__gaz && window.__gaz.ready)', 240000, 400)) throw new Error('demo nie wstało');
    await sleep(2000);
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
  } else if (mode === 'e1') {
    const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/dema/3d-gaz.html?shot=1&pokaz=0&zegar=gra` });
    if (!await waitFor(cdp, '!!(window.__gaz && window.__gaz.ready && window.__harness)', 300000, 400)) throw new Error('demo nie wstało');
    await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
    await sleep(3000);
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await ev(PAGE_HELPERS);
    report.gpu = await ev(`(async () => { const a = window.Core3D.renderer.backend.adapter; const info = a?.info || null;
      return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null; })()`);
    console.log('GPU:', JSON.stringify(report.gpu));
    if (args.tune) {
      const o = kv(args.tune); report.tune = o;
      await ev(`(() => { const o = ${JSON.stringify(o)}; const S = window.HallGas3D; for (const [k, v] of Object.entries(o)) {
        if (k.startsWith('look.')) S.look[k.slice(5)] = v; else if (k.startsWith('frame.')) S.frame[k.slice(6)] = v; else S.tune[k] = v; }
        S.syncTune(); S.syncLook(); return true; })()`);
      console.log('strojenie:', JSON.stringify(o));
    }
    const etapy = new Set(String(args.etapy || 'ciag,lot,start,para,bilans,det,koszt').split(','));
    report.domena = await ev(`(() => { const S = window.HallGas3D; const d = S.domain; return { h: d.h, nx: d.nx, nd: d.nd, nh: d.nh, cells: d.cells, memMB: S.stats.memMB,
      tune: { ...S.tune }, look: { ...S.look }, raster: S.raster, halfRounding: S.grid.halfRounding }; })()`);
    console.log('domena:', JSON.stringify({ ...report.domena, tune: undefined, look: undefined }));
    const pipes0 = await ev('window.__harness.pipes.n');
    const view = (name) => ev(`(() => { window.__gaz.view('${name}'); return true; })()`);
    const S0 = { stations: [0, -450] };

    if (etapy.has('diag')) {
      // diagnostyka stabilności: 1 s spokoju, 5 s ciągu, 24 s spoczynku — co 2 s energia, masy, residuum
      await ev(`(() => { window.__gaz.reset('stowed'); return true; })()`);
      await secs(1); await ev('window.__gaz.main(1)');
      const rows = [];
      for (let t = 2; t <= 30; t += 2) {
        await secs(2);
        if (t === 6) await ev('window.__gaz.main(null)');
        const m = await ev('window.__g3.metrics({ hull: true, divParts: true })');
        rows.push({ t, vRms: m.div.vRmsJ, div: m.div.ratio, divF: m.div.faceRatio, divFsrc: m.div.faceSrcShare, air: m.air, deck: m.deck, total: m.dustTotal, exh: m.exhaust, vap: m.vapor, vz: m.wall.vzMax, hullT: m.hullT?.min });
        console.log('diag', JSON.stringify(rows.at(-1)));
      }
      report.diag = rows;
    }

    if (etapy.has('ciag')) {
      // Atlas na C-01 rufą do ściany tylnej: 3 s spokoju, trzy odpalenia MAIN po 5 s (przerwy: 30 s po pierwszym, 6 s)
      await ev(`(() => { window.__gaz.reset('stowed'); window.__gaz.view('stanowisko'); return true; })()`);
      await secs(3);
      await measure('00-spokoj', { png: true, shot: true });
      for (let blast = 1; blast <= 3; blast++) {
        await ev(`window.__g3.metrics({ deckRef: 'set', hull: false })`);
        await ev('window.__gaz.main(1)');
        await secs(1); await measure(`${blast}0-ciag-1s`, { axis: args.os ? { dx: [0, -190], z0: 300, z1: 1300 } : null });
        await secs(1); await measure(`${blast}1-ciag-2s`, { png: blast === 1, shot: blast === 1 });
        await secs(2); await measure(`${blast}2-ciag-4s`, { png: blast === 1 });
        await secs(1); await measure(`${blast}3-ciag-5s`, { png: true, shot: true, deckRef: 'use' });
        if (blast === 1) await ev(`window.__g3.metrics({ deckRef: 'set', hull: false })`);
        await ev('window.__gaz.main(null)');
        await secs(2); await measure(`${blast}4-po-2s`, {});
        await secs(4); await measure(`${blast}5-po-6s`, { png: blast === 1, vortex: true });
        if (blast === 1) { await secs(24); await measure('16-po-30s', { png: true, shot: true, vortex: true, deckRef: 'use' }); }
        if (args.krotko) break;   // --krotko 1: pierwsze odpalenie i 30 s spoczynku (szybkie próby strojenia)
      }
      const K = Object.fromEntries(report.kroki.map((k) => [k.name, k]));
      if (!K['23-ciag-5s']) K['23-ciag-5s'] = K['16-po-30s'];
      // zdjęte z pokładu = lokalny ubytek w odpaleniu; wróciło = przyrost pokładu w 30 s po odpaleniu / zdjęte
      const removed1 = K['13-ciag-5s'].deckLost;
      const removed2 = K['23-ciag-5s'].deckLost ?? 0;
      const returned = (K['16-po-30s'].deckGained - K['16-po-30s'].deckLost) / Math.max(1e-9, removed1);
      report.ciag = {
        wrapFrac2s: K['11-ciag-2s'].wall.fracAbove300, vzWall2s: K['11-ciag-2s'].wall.vzMax,
        vzWallMax: Math.max(...['10-ciag-1s', '11-ciag-2s', '12-ciag-4s', '13-ciag-5s'].map((n) => K[n].wall.vzMax)),
        exh500_2s: K['11-ciag-2s'].exhaustHi500, exh500_4s: K['12-ciag-4s'].exhaustHi500,
        hullT4s: K['12-ciag-4s'].hullT, hullTmin: Math.min(...report.kroki.filter((k) => k.hullT).map((k) => k.hullT.min)),
        removed1: +removed1.toFixed(2), removed2: +removed2.toFixed(2), ratio21: +(removed2 / Math.max(1e-9, removed1)).toFixed(3),
        returned30s: +returned.toFixed(3),
        airSettled30s: +(1 - K['16-po-30s'].air / Math.max(1e-9, K['13-ciag-5s'].air)).toFixed(3),
        divRatioMax: Math.max(...report.kroki.map((k) => k.div.ratio || 0)),
        divFaceRatioMax: Math.max(...report.kroki.map((k) => k.div.faceRatio || 0)),
        vortex6s: K['15-po-6s'].vortex?.ratioMax
      };
      console.log('CIĄG:', JSON.stringify(report.ciag));
    }

    if (etapy.has('lot')) {
      // lot ku bramie z pełnym ciągiem (do 500 j/s), pomiar po 3 s i 5,5 s jak w audycie 2D (hala-pyl-audyt.mjs). TŁO
      // tunelu: w 2D lot szedł przez pył z odpaleń rozlany po całej hali; w 3D pył z odpaleń wspina się po ścianie tylnej
      // i osiada (≥ 80 % w 30 s — miara § 10), przed stanowiskiem powietrze jest czyste. Zapylona hala = cienka, warstwowa
      // mgiełka przy pokładzie (hazeAir · e^(−y/hazeH): --mgielka c, --mgielkaH y), start 1 s po resecie; --odpalenia n —
      // najpierw n odpaleń na stanowisku po 5 s (+ krótkie 2,5 s), jak w protokole 2D (mgiełka do tego czasu osiada)
      await ev(`(() => { const S = window.HallGas3D; S.__haze = [S.tune.hazeAir, S.tune.hazeH]; S.tune.hazeAir = ${Number(args.mgielka ?? 0.06)}; S.tune.hazeH = ${Number(args.mgielkaH || 120)}; S.syncTune();
        window.__gaz.reset('stowed'); return true; })()`);
      const nBlast = Number(args.odpalenia ?? 0);
      await secs(nBlast > 0 ? 2 : 1);
      for (let blast = 0; blast < nBlast; blast++) { await ev('window.__gaz.main(1)'); await secs(5); await ev('window.__gaz.main(null)'); await secs(6); }
      if (nBlast > 0) { await ev('window.__gaz.main(1)'); await secs(2.5); await ev('window.__gaz.main(null)'); await secs(0.5); }
      await view('statek');
      await ev(`(() => { window.__gaz.state.cam.zoom = 0.25; window.__gaz.kin({ acc: 150, vmax: 500 }); window.__gaz.main(1); return true; })()`);
      await secs(3);
      const f3 = await ev(`(() => { const fl = window.__gaz.flight; return { x: fl.x, z: fl.z, fx: Math.cos(fl.angle), fz: Math.sin(fl.angle), v: Math.hypot(fl.vx, fl.vz) }; })()`);
      // oś tunelu: od środka gromady dysz MAIN (EngineFrame) wstecz wzdłuż kursu; d = 14 i 24 komórki pola 2D (392, 672 j.)
      const nz3 = await ev('window.__g3.nozzles()');
      const stern = (q, nz) => ({ ax: nz ? nz.x : q.x - q.fx * 860, az: nz ? nz.z : q.z - q.fz * 860, dx: q.fx, dz: q.fz, d: [392, 672] });
      const m3 = await measure('41-lot-3s', { tunnel: stern(f3, nz3), png: true, shot: true });
      const m3j = await ev(`window.__g3.metrics(${JSON.stringify({ hull: false, tunnel: { ...stern(f3, nz3), k: [1, 2] } })})`);
      for (const t of m3j.tunnel) console.log(`   tunel (warstwa osi strugi k = 1) d=${t.d}: tło ${t.bg} oś ${t.axis} szer. ${t.width} j. flanka ×${t.flankRatio}`);
      await secs(2.5);
      const f5 = await ev(`(() => { const fl = window.__gaz.flight; return { x: fl.x, z: fl.z, fx: Math.cos(fl.angle), fz: Math.sin(fl.angle), v: Math.hypot(fl.vx, fl.vz) }; })()`);
      const nz5 = await ev('window.__g3.nozzles()');
      const m5 = await measure('42-lot-5.5s', { tunnel: stern(f5, nz5), png: true, shot: true });
      const m5j = await ev(`window.__g3.metrics(${JSON.stringify({ hull: false, tunnel: { ...stern(f5, nz5), k: [1, 2] } })})`);
      for (const t of m5j.tunnel) console.log(`   tunel (warstwa osi strugi k = 1) d=${t.d}: tło ${t.bg} oś ${t.axis} szer. ${t.width} j. flanka ×${t.flankRatio}`);
      if (args.diag) {
        const sl = await ev(`window.__g3.metrics(${JSON.stringify({ hull: false, slab: { ...stern(f5, nz5), d: 392, kMax: 5 } })})`);
        console.log('   przekrój pionowy d = 392 (s = −980…980 co 56 j.):');
        for (const r of sl.slab) for (const key of ['dust', 'exh', 'vs', 'vy']) console.log(`    k${r.k} ${key.padEnd(4)}`, JSON.stringify(r[key]));
      }
      await ev('(() => { window.__gaz.main(null); window.__gaz.kin(null); const S = window.HallGas3D; [S.tune.hazeAir, S.tune.hazeH] = S.__haze; S.syncTune(); return true; })()');
      report.lot = { nozzles: nz5,
        tunnel3s: m3.tunnel.map((t) => ({ d: t.d, width: t.width, flank: t.flankRatio, bg: t.bg })),
        tunnel55s: m5.tunnel.map((t) => ({ d: t.d, width: t.width, flank: t.flankRatio, bg: t.bg })), v55: +f5.v.toFixed(0),
        tunnelJet3s: m3j.tunnel.map((t) => ({ d: t.d, width: t.width, flank: t.flankRatio, bg: t.bg })),
        tunnelJet55s: m5j.tunnel.map((t) => ({ d: t.d, width: t.width, flank: t.flankRatio, bg: t.bg })) };
      console.log('LOT:', JSON.stringify(report.lot));
    }

    let mS = null;
    if (etapy.has('start')) {
      // start z postoju z CZYSTEJ hali (pył w powietrzu = poderwany): 0 → 300 j/s w 2 s, pełny ciąg; źródła gazu hali
      // (szpule, zawory, nawiewy sąsiednich stanowisk) wyłączone — pas mierzy kurz spod kadłuba, nie pył ze źródeł (jak para)
      await ev(`(() => { const S = window.HallGas3D; S.__srcBk = S.frame.sources; S.frame.sources = false; window.__gaz.reset('stowed'); return true; })()`);
      await secs(3);
      await ev(`window.__g3.metrics({ deckRef: 'set', hull: false })`);
      await view('statek');
      await ev(`(() => { window.__gaz.state.cam.zoom = 0.25; window.__gaz.kin({ acc: 150, vmax: 300 }); window.__gaz.main(1); return true; })()`);
      if (args.diag) {
        // przekrój w poprzek kadłuba po 1 s (≈ 150 j/s) — prędkości i pokład przy burtach
        await secs(1);
        const g = await ev(`(() => { const fl = window.__gaz.flight; return { x: fl.x, z: fl.z, fx: Math.cos(fl.angle), fz: Math.sin(fl.angle), v: Math.hypot(fl.vx, fl.vz) }; })()`);
        const mc = await ev(`window.__g3.metrics(${JSON.stringify({ hull: false, cross: { cx: g.x, cz: g.z, fx: g.fx, fz: g.fz, stations: [0] } })})`);
        console.log(`   przekrój 1 s (v ${g.v.toFixed(0)} j/s) [stacja, e, v_bok, v_wzdł, zajętość, cel_bok, pokład, pokład_ref, pył k0, pył k1]:`);
        for (const r of mc.cross) console.log('   ', JSON.stringify(r));
        await secs(1);
      } else await secs(2);
      const f = await ev(`(() => { const fl = window.__gaz.flight; return { x: fl.x, z: fl.z, fx: Math.cos(fl.angle), fz: Math.sin(fl.angle), v: Math.hypot(fl.vx, fl.vz) }; })()`);
      mS = await measure('40-start-300', { side: { cx: f.x, cz: f.z, fx: f.fx, fz: f.fz, stations: [450, 0, -450], thr: 0.01 }, png: true, shot: true });
      await ev('(() => { window.__gaz.main(null); window.__gaz.kin(null); const S = window.HallGas3D; S.frame.sources = S.__srcBk; return true; })()');
      report.start = { v: +f.v.toFixed(0), sideBandMin: mS.sideBandMin, sideDeckBandMin: mS.sideDeckBandMin,
        side: mS.side.map((q) => ({ station: q.station, side: q.side, band: q.band, bandDeck: q.bandDeck, peak: q.peak })) };
      console.log('START:', JSON.stringify(report.start));
    }

    if (etapy.has('para')) {
      // para ze złączek: stanowisko podpięte, tylko złączki (szpule, zawory magazynów i nawiewy wyłączone), 10 s sączenia
      await ev(`(() => { const S = window.HallGas3D; S.__gasBackup = { ...S.frame.gas };
        Object.assign(S.frame.gas, { reelSeep: 0, relief: 0, wallSeep: 0, wall: 0, fanRate: 0, fanSpeed: 0 });
        window.__gaz.reset('connected'); window.__gaz.view('stanowisko'); return true; })()`);
      await secs(5); const p5 = await measure('50-para-5s', { png: true });
      await secs(5); const p10 = await measure('51-para-10s', { png: true, shot: true });
      await ev(`(() => { const S = window.HallGas3D; Object.assign(S.frame.gas, S.__gasBackup); return true; })()`);
      report.para = { lowFrac5s: p5.vaporLowFrac, lowFrac10s: p10.vaporLowFrac, vapor10s: p10.vapor, hullT10s: p10.hullT };
      console.log('PARA:', JSON.stringify(report.para));
    }

    if (etapy.has('bilans')) {
      // zachowanie masy pyłu: pył poderwany (3 s ciągu), potem 60 s BEZ źródeł (dysze, źródła hali, nawiewy), zanik w próżni 0
      await ev(`(() => { const S = window.HallGas3D; S.__bk = { vac: S.tune.vacuumDecay, src: S.frame.sources, sl: S.frame.sleepAfter };
        window.__gaz.reset('stowed'); return true; })()`);
      await secs(1); await ev('window.__gaz.main(1)'); await secs(3); await ev('window.__gaz.main(null)');
      await ev(`(() => { const S = window.HallGas3D; S.tune.vacuumDecay = 0; S.frame.sources = false; S.frame.sleepAfter = 1e9; S.syncTune(); return true; })()`);
      const series = [];
      for (let t = 0; t <= 60; t += 10) {
        if (t > 0) await secs(10);
        const m = await measure(`6${String(t / 10)}-bilans-${t}s`, { hull: false });
        series.push({ t, total: m.dustTotal, air: m.air, deck: m.deck });
      }
      await ev(`(() => { const S = window.HallGas3D; S.tune.vacuumDecay = S.__bk.vac; S.frame.sources = S.__bk.src; S.frame.sleepAfter = S.__bk.sl; S.syncTune(); return true; })()`);
      const m0 = series[0].total;
      report.bilans = { series, maxDev: +Math.max(...series.map((s) => Math.abs(s.total - m0) / m0)).toFixed(5) };
      console.log('BILANS:', JSON.stringify(report.bilans));
    }

    if (etapy.has('det')) {
      // determinizm: dwa przebiegi tego samego wejścia od resetu (1 s spokoju, 2 s ciągu) — skróty pól i miary
      const run = async () => {
        // silniki wygaszone przed resetem (stan strugi MAIN poza modułem gazu gaśnie kilka klatek)
        await ev('window.__gaz.main(null)'); await secs(4);
        await ev(`(() => { window.__gaz.reset('stowed'); return true; })()`);
        await secs(1); await ev('window.__gaz.main(1)'); await secs(2); await ev('window.__gaz.main(null)');
        const hsh = await ev('window.__g3.hash()');
        const m = await ev('window.__g3.metrics({ hull: true })');
        return { hash: hsh, air: m.air, deck: m.deck, exh: m.exhaust, vz: m.wall.vzMax, div: m.div.ratio };
      };
      const a = await run();
      const b = await run();
      report.det = { a, b, identical: JSON.stringify(a) === JSON.stringify(b) };
      console.log('DETERMINIZM:', JSON.stringify(report.det));
    }

    report.pipelineSync = await ev(`(() => { const p = window.__harness.pipes; const l = p.list.slice(${pipes0}); return { nowe: l.length, sync: l.filter((e) => e.sync).length, syncLista: l.filter((e) => e.sync).slice(0, 10).map((e) => e.nazwa) }; })()`);
    console.log('pipeline’y po starcie:', JSON.stringify(report.pipelineSync));

    if (etapy.has('koszt')) {
      // koszt kroku solvera: nachylenie czasu kolejki (n0 / n1 kroków, prawdziwy zegar), lista kerneli kroku jak w klatce
      report.koszt = await ev(`(async () => {
        const S = window.HallGas3D, g = S.grid, r = window.Core3D.renderer, dev = r.backend.device, now = () => window.__harness.realNow();
        const list = g.stepList([]);
        const parts = { all: list, react: [g.kReact], adv: [g.kAdvect], pressure: g._pushPressure([]), rest: [g.kOcc, g.kCurl, g.kDeck, g.kDiv, g.kProject, g.kDeckCopy] };
        g.U.active.value = 1;
        const run = async (L, n) => { let best = Infinity, cpu = 0; for (let q = 0; q < 3; q++) { await dev.queue.onSubmittedWorkDone(); const t0 = now();
          for (let i = 0; i < n; i++) r.compute(L); const t1 = now(); await dev.queue.onSubmittedWorkDone(); const t = now() - t0; if (t < best) { best = t; cpu = t1 - t0; }
          // pula znaczników czasu compute rośnie z każdym dispatchem — rozliczana, gdy Core3D śledzi czas (bez ostrzeżenia, gdy nie)
          if (r.backend.trackTimestamp) { try { await r.resolveTimestampsAsync('compute'); } catch { /* bez znaczników */ } } } return { t: best, cpu }; };
        const out = { dispatches: list.length, memMB: S.stats.memMB };
        for (const [k, L] of Object.entries(parts)) { r.compute(L); await dev.queue.onSubmittedWorkDone(); const a = await run(L, 20); const b = await run(L, 120);
          out[k] = { msPerStep: +((b.t - a.t) / 100).toFixed(4), cpuMs: +(b.cpu / 120).toFixed(4) }; }
        return out;
      })()`, 600000);
      console.log('KOSZT kroku:', JSON.stringify(report.koszt));
      // CPU kroku efektów (pakowanie + rekordy + zlecenie) — z klatek gry w trybie step (zegar wirtualny)
      await ev(`(() => { window.__gaz.reset('stowed'); window.__gaz.main(1); const S = window.HallGas3D; const now = () => window.__harness.realNow();
        if (!S.__upd0) { S.__upd0 = S._update; S._update = function (ctx) { const t0 = now(); S.__upd0.call(S, ctx); S.__cpuReal = now() - t0; }; } return true; })()`);
      const cpu = [];
      for (let i = 0; i < 30; i++) { await step(1); cpu.push(await ev('window.HallGas3D.__cpuReal')); }
      await ev('window.__gaz.main(null)');
      report.koszt.cpuKrokuMs = +median(cpu).toFixed(4);
      // GPU klatki: gaz wł. / wył. naprzemiennie (Core3D.gpuFrameMs — znaczniki czasu), prawdziwy zegar
      await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
      const ab = { on: [], off: [] };
      for (let rep = 0; rep < 4; rep++) {
        for (const on of [true, false]) {
          await ev(`(() => { window.HallGas3D.tune.enabled = ${on}; return true; })()`);
          await sleep(700);
          const v = await ev(`(async () => { const a = []; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 25)); a.push(window.Core3D.gpuFrameMs); } return a; })()`);
          ab[on ? 'on' : 'off'].push(median(v));
        }
      }
      await ev('(() => { window.HallGas3D.tune.enabled = true; const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
      report.koszt.gpuKlatki = { on: +median(ab.on).toFixed(3), off: +median(ab.off).toFixed(3), roznica: +(median(ab.on) - median(ab.off)).toFixed(3), surowe: ab };
      console.log('KOSZT klatki:', JSON.stringify(report.koszt.gpuKlatki), 'CPU kroku', report.koszt.cpuKrokuMs);
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
