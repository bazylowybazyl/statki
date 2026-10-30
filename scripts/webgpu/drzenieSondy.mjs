// scripts/webgpu/drzenieSondy.mjs
//
// SONDY DRŻENIA ŚWIATEŁ STATKÓW I GAZU dla `gpu-pas-gra.mjs --drzenie <katalog>` (2026-10-29 wieczór; zgłoszenie
// użytkownika przy 5120 × 1440 @ 240 Hz, render w workerze, preset Ultra: (1) „drżące światła statków — snopy front
// i pomocnicze drżą”, (2) „drżenie gazów przy zoom in / out”, (3) „przybliżona kamera OK, oddalona — gazy drżą”).
//
// W WORKERZE renderu (`drzInstaluj` wstrzyknięta przez toString — bez domknięć Node; reszta przez `globalThis.__drz.lib`):
// opakowanie `Core3D.renderSingle` — po KAŻDYM renderze strony:
//   (a) wiersz dziennika (pierścień Float64, układ DRZ_LOG): poza renderu gracza (INTERP strony — kadłub, model, lampy
//       kadłuba) i poza fizyczna (lustro encji — tę bierze dziś pas), światła gracza z siatki `Core3D.fx.grid` w układzie
//       kadłuba POZY RENDERU (reflektory dalekie z = 140, otoczenia z = 70, grupy lamp pozycyjnych z = 40 — właściciel
//       z `belt._owners`; dookólne z = 320 bez właściciela — najbliższe pozy fizycznej), oś reflektora − kąt pozy [°],
//       drabina map gazu (stopień, teksel, teksel ciągły), kolumna ośrodka pasa (bok, stopień, siatka), początek
//       `Core3D.fx` (przeskoki), obwiednia (krok, wersja), okno pola (róg, przesunięcia, resety), siatka świateł (światła,
//       wpisy, najwięcej w komórce, zgubione);
//   (b) zrzut wycinków KANWY (obraz po poście: bloom, ACES, sRGB — to, co strona składa) do buforów GPU — kolejne strony
//       bez czekania (kopia w kolejce GPU, bez odczytu w klatce), odczyt i analiza po serii.
// ANALIZA (`drzRoznice` — czysta funkcja: w workerze i w teście Node): luminancja (Rec. 709 z wartości sRGB, poziomy
// 0–255) kolejnych klatek po kompensacji ruchu kamery i zmiany zoomu (punkt świata → piksel; dwuliniowo), pierwsza
// różnica (pary) i druga różnica w czasie (trójki: płynny ruch ≈ 0, przeskoki próbkowania i migotanie zostają), opcjonalnie
// największa różnica kanału RGB; regiony z okna pola klatki: wnętrze, pas brzegu okna (SPACE_GAS_WINDOW_EDGE ± komórka),
// pole dalekie; prostokąt okrętu w układzie kadłuba (kadłub, dysze, lampy — jadą z kamerą, nie ze światem) pominięty.
// W NODE: statystyki dziennika (światła wobec pozy renderu, drabiny przy rampach zoomu, okno pola w locie).

/** Układ wiersza dziennika workera (Float64). */
export const DRZ_LOG = (() => {
  const names = [
    'K', 'NOW', 'ALPHA', 'SIM', 'SIMR', 'FDT', 'PAUSED', 'CAMX', 'CAMY', 'ZOOM', 'CAMNSX', 'CAMNSY',
    'PX', 'PY', 'PA', 'QX', 'QY', 'QA',
    'MLX', 'MLY', 'TX', 'TY', 'LOD', 'MMX', 'MMY',
    'VC', 'VL', 'VX0', 'VY0',
    'FOX', 'FOY', 'FREB', 'FMOV',
    'ENVC', 'ENVV', 'ENVX', 'ENVY',
    'SOX', 'SOY', 'SSH', 'SRS', 'WINX', 'WINY', 'ANX', 'ANY', 'GACT', 'GFADE', 'SN', 'SC',
    'GL', 'GI', 'GMX', 'GDR', 'OWN', 'NF', 'NFL', 'NN',
    'F0A', 'F0C', 'F0D', 'F1A', 'F1C', 'F1D',
    'FL0A', 'FL0C', 'FL0D', 'FL1A', 'FL1C', 'FL1D', 'FL2A', 'FL2C', 'FL2D', 'FL3A', 'FL3C', 'FL3D', 'FL4A', 'FL4C', 'FL4D', 'FL5A', 'FL5C', 'FL5D',
    'OA', 'OC',
    'N0A', 'N0C', 'N1A', 'N1C', 'N2A', 'N2C', 'N3A', 'N3C',
    'DQA', 'DQC', 'DQD',
    'F0X', 'F0Y', 'F0AX'
  ];
  const o = {};
  names.forEach((n, i) => { o[n] = i; });
  o.F = names.length;
  return Object.freeze(o);
})();

/** z świateł pola statku w siatce (src/3d/fx/lightGrid.js FIELD_SHIP_LIGHTS / CAVE_SHIP_LIGHTS — te same z). */
export const DRZ_Z = Object.freeze({ far: 140, flood: 70, nav: 40, omni: 320 });

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Analiza różnic klatek (czysta — wstrzykiwana do workera, testowana w Node)
// fr: [{ L: Float32Array w·h (luminancja), rgb: Uint8Array w·h·4 | null, m: { k, cam: [x, y, zoom], pose: [x, y, kąt] |
//      null, win: [x0, y0, x1, y1] | null, band, cell } }]
// g: { w, h, rx, ry, Wb, Hb, ps } — wycinek (róg w px bufora), rozmiar kanwy, px bufora na px CSS
// o: { pary, trojki, maxKanal, brzeg (px), statek: { przod, tyl, pol } [j.] | null, okno (bool), od, do }
export function drzRoznice(fr, g, o) {
  const w = g.w, h = g.h, n = w * h;
  const B = o.brzeg ?? 8;
  const NAZWY = ['wszystko', 'wnetrze', 'pas', 'dalekie'];
  const regCache = new Map();
  const regOf = (t) => {
    let R = regCache.get(t);
    if (R) return R;
    const m = fr[t].m;
    R = new Uint8Array(n);
    const z = m.cam[2] * g.ps, cx = m.cam[0], cy = m.cam[1];
    const pose = m.pose;
    const ca = pose ? Math.cos(pose[2]) : 1, sa = pose ? Math.sin(pose[2]) : 0;
    const win = o.okno !== false ? m.win : null;
    const band = m.band || 0, cell = m.cell || 0;
    const S = o.statek || null;
    for (let y = 0; y < h; y++) {
      const wy = cy + (y + 0.5 + g.ry - g.Hb / 2) / z;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < B || y < B || x >= w - B || y >= h - B) continue;
        const wx = cx + (x + 0.5 + g.rx - g.Wb / 2) / z;
        if (S && pose) {
          const dx = wx - pose[0], dy = wy - pose[1];
          const al = dx * ca + dy * sa, ac = -dx * sa + dy * ca;
          if (al < S.przod && al > -S.tyl && Math.abs(ac) < S.pol) continue;
        }
        if (!win) { R[i] = 1; continue; }
        const e = Math.min(wx - win[0], win[2] - wx, wy - win[1], win[3] - wy);
        R[i] = e > band + cell ? 1 : e > -cell ? 2 : 3;
      }
    }
    regCache.set(t, R);
    return R;
  };
  // piksel wycinka A (środki pikseli w x + 0,5) → wycinek B: u_B = a + u_A · s
  const coef = (mA, mB) => {
    const s = mB.cam[2] / mA.cam[2];
    const tx = (mA.cam[0] - mB.cam[0]) * mB.cam[2] * g.ps, ty = (mA.cam[1] - mB.cam[1]) * mB.cam[2] * g.ps;
    const cx = g.Wb / 2 - g.rx, cy = g.Hb / 2 - g.ry;
    return { s, ax: cx * (1 - s) + tx, ay: cy * (1 - s) + ty };
  };
  const samp = (L, x, y) => {
    const fx0 = x - 0.5, fy0 = y - 0.5;
    const x0 = Math.floor(fx0), y0 = Math.floor(fy0);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return NaN;
    const fx = fx0 - x0, fy = fy0 - y0, i = y0 * w + x0;
    return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + w] * (1 - fx) + L[i + w + 1] * fx) * fy;
  };
  const samp4 = (P, c, x, y) => {
    const fx0 = x - 0.5, fy0 = y - 0.5;
    const x0 = Math.floor(fx0), y0 = Math.floor(fy0);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return NaN;
    const fx = fx0 - x0, fy = fy0 - y0, i = (y0 * w + x0) * 4 + c, r = w * 4;
    return (P[i] * (1 - fx) + P[i + 4] * fx) * (1 - fy) + (P[i + r] * (1 - fx) + P[i + r + 4] * fx) * fy;
  };
  const mk = () => ({ n: 0, s: 0, s2: 0, c2: 0, c4: 0, c8: 0, c16: 0, mx: 0, sp: 0, hist: new Uint32Array(258) });
  const add = (A, d) => {
    const a = d < 0 ? -d : d;
    A.n++; A.s += a; A.s2 += d * d;
    if (a > 2) { A.c2++; if (a > 4) { A.c4++; if (a > 8) { A.c8++; if (a > 16) A.c16++; } } }
    if (a > A.mx) A.mx = a;
    A.hist[Math.min(257, (a * 4) | 0)]++;
  };
  const fin = (A) => {
    if (!A.n) return null;
    let k = 0, cum = 0;
    const tgt = 0.99 * A.n;
    for (; k < 258; k++) { cum += A.hist[k]; if (cum >= tgt) break; }
    const p = (c) => +(100 * c / A.n).toFixed(3);
    return { n: A.n, sr: +(A.s / A.n).toFixed(3), rms: +Math.sqrt(A.s2 / A.n).toFixed(3), p99: k / 4, proc2: p(A.c2), proc4: p(A.c4),
      proc8: p(A.c8), proc16: p(A.c16), maks: +A.mx.toFixed(1), iglice: A.sp, igliceNaMpx: +(1e6 * A.sp / A.n).toFixed(1) };
  };
  const finAll = (acc) => { const r = {}; for (let i = 0; i < 4; i++) { const f = fin(acc[i]); if (f) r[NAZWY[i]] = f; } return r; };
  // igły: |d| ≥ 8 przy sąsiadach (4) policzonych i < 3 — pojedyncze piksele (drobiny pyłu, iskry)
  const spikes = (D, R, acc) => {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, d = D[i];
      if (!(d >= 8 || d <= -8)) continue;
      const a = D[i - 1], b = D[i + 1], c = D[i - w], e = D[i + w];
      if (!(Math.abs(a) < 3 && Math.abs(b) < 3 && Math.abs(c) < 3 && Math.abs(e) < 3)) continue;
      acc[0].sp++; acc[R[i]].sp++;
    }
  };
  const od = Math.max(0, o.od ?? 0), dok = Math.min(fr.length - 1, o.do ?? fr.length - 1);
  // krok > 1: pary t → t + krok (np. 2 — z pominięciem klatki tuż po stopniu drabiny)
  const kr = Math.max(1, o.krok | 0 || 1);
  const out = { pary: [], trojki: [] };
  const D = new Float32Array(n);
  if (o.pary !== false) {
    for (let t = od; t + kr <= dok; t++) {
      const A = fr[t], Bf = fr[t + kr];
      const R = regOf(t), M = coef(A.m, Bf.m);
      const acc = [mk(), mk(), mk(), mk()];
      const kan = o.maxKanal && A.rgb && Bf.rgb ? [mk(), mk(), mk(), mk()] : null;
      D.fill(NaN);
      for (let y = 0; y < h; y++) {
        const vB = M.ay + (y + 0.5) * M.s;
        for (let x = 0; x < w; x++) {
          const i = y * w + x, r = R[i];
          if (!r) continue;
          const uB = M.ax + (x + 0.5) * M.s;
          const b = samp(Bf.L, uB, vB);
          if (b !== b) continue;
          const d = b - A.L[i];
          D[i] = d;
          add(acc[0], d); add(acc[r], d);
          if (kan) {
            let mx = 0;
            for (let c = 0; c < 3; c++) { const v = Math.abs(samp4(Bf.rgb, c, uB, vB) - A.rgb[i * 4 + c]); if (v > mx) mx = v; }
            add(kan[0], mx); add(kan[r], mx);
          }
        }
      }
      spikes(D, R, acc);
      out.pary.push({ t, k: [A.m.k, Bf.m.k], skala: +M.s.toFixed(6), luma: finAll(acc), kanal: kan ? finAll(kan) : undefined });
    }
  }
  if (o.trojki) {
    for (let t = od + 1; t + 1 <= dok; t++) {
      const P0 = fr[t - 1], A = fr[t], P1 = fr[t + 1];
      const R = regOf(t), M0 = coef(A.m, P0.m), M1 = coef(A.m, P1.m);
      const acc = [mk(), mk(), mk(), mk()];
      D.fill(NaN);
      for (let y = 0; y < h; y++) {
        const v0 = M0.ay + (y + 0.5) * M0.s, v1 = M1.ay + (y + 0.5) * M1.s;
        for (let x = 0; x < w; x++) {
          const i = y * w + x, r = R[i];
          if (!r) continue;
          const a = samp(P0.L, M0.ax + (x + 0.5) * M0.s, v0), b = samp(P1.L, M1.ax + (x + 0.5) * M1.s, v1);
          if (a !== a || b !== b) continue;
          const d = a + b - 2 * A.L[i];
          D[i] = d;
          add(acc[0], d); add(acc[r], d);
        }
      }
      spikes(D, R, acc);
      out.trojki.push({ t, k: [P0.m.k, A.m.k, P1.m.k], luma: finAll(acc) });
    }
  }
  // udział regionów w wycinku (pierwsza klatka)
  if (fr.length) {
    const R = regOf(od), c = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) c[R[i]]++;
    out.regiony = { pominiete: +(c[0] / n).toFixed(3), wnetrze: +(c[1] / n).toFixed(3), pas: +(c[2] / n).toFixed(3), dalekie: +(c[3] / n).toFixed(3) };
  }
  return out;
}

/** Mapa różnicy pary (|Δ luminancji| × 16, czerwone > 8 poziomów) jako RGBA wycinka A (do PNG). */
export function drzMapaRoznicy(fr, g, t, wzmoc = 16) {
  const w = g.w, h = g.h, A = fr[t], Bf = fr[t + 1];
  const s = Bf.m.cam[2] / A.m.cam[2];
  const tx = (A.m.cam[0] - Bf.m.cam[0]) * Bf.m.cam[2] * g.ps, ty = (A.m.cam[1] - Bf.m.cam[1]) * Bf.m.cam[2] * g.ps;
  const cx = g.Wb / 2 - g.rx, cy = g.Hb / 2 - g.ry, ax = cx * (1 - s) + tx, ay = cy * (1 - s) + ty;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const fx0 = ax + (x + 0.5) * s - 0.5, fy0 = ay + (y + 0.5) * s - 0.5;
      const x0 = Math.floor(fx0), y0 = Math.floor(fy0);
      let d = 0;
      if (x0 >= 0 && y0 >= 0 && x0 < w - 1 && y0 < h - 1) {
        const fx = fx0 - x0, fy = fy0 - y0, j = y0 * w + x0, L = Bf.L;
        d = Math.abs((L[j] * (1 - fx) + L[j + 1] * fx) * (1 - fy) + (L[j + w] * (1 - fx) + L[j + w + 1] * fx) * fy - A.L[i]);
      }
      const v = Math.min(255, d * wzmoc);
      out[o] = d > 8 ? 255 : v; out[o + 1] = d > 8 ? 40 : v; out[o + 2] = d > 8 ? 40 : v; out[o + 3] = 255;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Worker renderu: instalacja (toString → `(${drzInstaluj})(${JSON.stringify(cfg)}, ${drzRoznice}, ${drzMapaRoznicy})`)
export function drzInstaluj(cfg, roznice, mapaRoznicy) {
  const S = globalThis.__ST, C = globalThis.__C3;
  if (!S || !C || !S.mods || !S.mods.layoutMod) return 'brak __ST / __C3';
  if (globalThis.__drz) return 'już';
  const H = S.mods.layoutMod.HEAD, LG = cfg.LG, F = LG.F, N = cfg.N, IN = cfg.IN, Z = cfg.Z;
  const D = globalThis.__drz = {
    log: { n: 0, rn: 0, F, N, a: new Float64Array(N * F), err: null },
    cap: { armed: false, n: 0, max: 0, rects: [], pool: [], meta: [], waitZoom: NaN, resolve: null, err: null, fmt: null, swap: false },
    frames: [], geo: null, lib: {}
  };
  const deg = (r) => { let d = r * 180 / Math.PI; d = (((d + 180) % 360) + 360) % 360 - 180; return d; };
  const winOf = (SG) => {
    const s = SG && SG.sim, I = SG && SG.input;
    if (!s || !I || !(s.N > 0)) return null;
    const c = s.cell, x0 = I[IN.anchorX] + s.ox * c, y0 = I[IN.anchorY] + s.oy * c, w = s.N * c;
    return [x0, y0, x0 + w, y0 + w];
  };
  function row() {
    const page = S.reader && S.reader.page;
    if (!page) return;
    const h = page.head, L = D.log, a = L.a, o = (L.n % L.N) * F;
    a.fill(NaN, o, o + F);
    a[o + LG.K] = h[H.K]; a[o + LG.NOW] = performance.now(); a[o + LG.ALPHA] = h[H.ALPHA]; a[o + LG.SIM] = h[H.SIM];
    a[o + LG.SIMR] = h[H.SIM_RENDER]; a[o + LG.FDT] = h[H.FRAME_DT]; a[o + LG.PAUSED] = (h[H.FLAGS] & 1) ? 1 : 0;
    a[o + LG.CAMX] = h[H.CAM_X]; a[o + LG.CAMY] = h[H.CAM_Y]; a[o + LG.ZOOM] = h[H.CAM_ZOOM];
    a[o + LG.CAMNSX] = h[H.CAMNS_X]; a[o + LG.CAMNSY] = h[H.CAMNS_Y];
    const pp = S.players && S.players.playerPose, e = S.players && S.players.ship;
    if (pp) { a[o + LG.PX] = pp.x; a[o + LG.PY] = pp.y; a[o + LG.PA] = pp.angle; }
    if (e) { a[o + LG.QX] = e.pos ? e.pos.x : e.x; a[o + LG.QY] = e.pos ? e.pos.y : e.y; a[o + LG.QA] = e.angle; }
    const SG = S.spaceGas;
    if (SG && SG.maps) {
      const M = SG.maps;
      if (M._lvl) { a[o + LG.MLX] = M._lvl[0]; a[o + LG.MLY] = M._lvl[1]; }
      a[o + LG.TX] = M.U.texel.value.x; a[o + LG.TY] = M.U.texel.value.y; a[o + LG.LOD] = M.U.lodTexel.value;
      a[o + LG.MMX] = M.U.min.value.x; a[o + LG.MMY] = M.U.min.value.y;
    }
    if (SG && SG.sim && SG.input) {
      const s = SG.sim, I = SG.input;
      a[o + LG.SOX] = s.ox; a[o + LG.SOY] = s.oy; a[o + LG.SSH] = s.stats.shifts; a[o + LG.SRS] = s.stats.resets;
      a[o + LG.WINX] = I[IN.winX]; a[o + LG.WINY] = I[IN.winY]; a[o + LG.ANX] = I[IN.anchorX]; a[o + LG.ANY] = I[IN.anchorY];
      a[o + LG.ENVC] = I[IN.envCell]; a[o + LG.ENVV] = I[IN.envVer]; a[o + LG.ENVX] = I[IN.envX0]; a[o + LG.ENVY] = I[IN.envY0];
      a[o + LG.GACT] = SG.stats.active ? 1 : 0; a[o + LG.GFADE] = SG.layer ? SG.layer.L.fade.value : NaN; a[o + LG.SN] = s.N; a[o + LG.SC] = s.cell;
    }
    const Bt = S.belt;
    if (Bt && Bt.volume && Bt.volume.U) {
      const V = Bt.volume;
      a[o + LG.VC] = V.U.cell.value.x; a[o + LG.VL] = V._cellLevel;
      if (V.medium && V.medium.U && V.medium.U.origin) { a[o + LG.VX0] = V.medium.U.origin.value.x; a[o + LG.VY0] = V.medium.U.origin.value.y; }
    }
    const O = C.fx && C.fx.origin;
    if (O) { a[o + LG.FOX] = O.x; a[o + LG.FOY] = O.y; a[o + LG.FREB] = O.rebases; a[o + LG.FMOV] = O.moves; }
    const G = C.fx && C.fx.grid;
    if (G) { a[o + LG.GL] = G.stats.lights; a[o + LG.GI] = G.stats.items; a[o + LG.GMX] = G.stats.maxPerCell; a[o + LG.GDR] = G.stats.dropped; }
    if (pp && e) {
      const ca = Math.cos(pp.angle), sa = Math.sin(pp.angle);
      const qx = a[o + LG.QX] - pp.x, qy = a[o + LG.QY] - pp.y;
      a[o + LG.DQA] = qx * ca + qy * sa; a[o + LG.DQC] = -qx * sa + qy * ca; a[o + LG.DQD] = deg(e.angle - pp.angle);
      if (G && Bt && Bt._owners) {
        const own = Bt._owners.get(e) || 0;
        a[o + LG.OWN] = own;
        const Lt = G.lights, cnt = G.count;
        let nf = 0, nfl = 0, nn = 0, bestOmni = Infinity;
        for (let i = 0; i < cnt; i++) {
          const q = i * 16, z = Lt[q + 2], ow = Lt[q + 15];
          const gx = Lt[q] + G.originX, gy = -(Lt[q + 1] + G.originY);
          const dx = gx - pp.x, dy = gy - pp.y;
          const al = dx * ca + dy * sa, ac = -dx * sa + dy * ca;
          if (own > 0 && Math.abs(ow - own) < 0.5) {
            const cone = Lt[q + 11] > -1.5;
            const ax = cone ? deg(Math.atan2(-Lt[q + 9], Lt[q + 8]) - pp.angle) : NaN;
            if (Math.abs(z - Z.far) < 0.5 && nf < 2) {
              const b = nf === 0 ? LG.F0A : LG.F1A;
              a[o + b] = al; a[o + b + 1] = ac; a[o + b + 2] = ax;
              if (nf === 0) { a[o + LG.F0X] = gx; a[o + LG.F0Y] = gy; a[o + LG.F0AX] = Math.atan2(-Lt[q + 9], Lt[q + 8]); }
              nf++;
            } else if (Math.abs(z - Z.flood) < 0.5 && nfl < 6) {
              const b = LG.FL0A + nfl * 3;
              a[o + b] = al; a[o + b + 1] = ac; a[o + b + 2] = ax;
              nfl++;
            } else if (Math.abs(z - Z.nav) < 0.5 && nn < 4) {
              const b = LG.N0A + nn * 2;
              a[o + b] = al; a[o + b + 1] = ac;
              nn++;
            }
          } else if (ow < 0.5 && Math.abs(z - Z.omni) < 0.5) {
            const ex = gx - a[o + LG.QX], ey = gy - a[o + LG.QY], d2 = ex * ex + ey * ey;
            if (d2 < bestOmni) { bestOmni = d2; a[o + LG.OA] = al; a[o + LG.OC] = ac; }
          }
        }
        a[o + LG.NF] = nf; a[o + LG.NFL] = nfl; a[o + LG.NN] = nn;
        if (!(bestOmni < 1e4)) { a[o + LG.OA] = NaN; a[o + LG.OC] = NaN; }
      }
    }
    L.n++;
  }
  function metaOf(h, tex) {
    const SG = S.spaceGas, pp = S.players && S.players.playerPose, e = S.players && S.players.ship;
    const s = SG && SG.sim;
    return {
      k: h[H.K], now: performance.now(), alpha: h[H.ALPHA], sim: h[H.SIM], cam: [h[H.CAM_X], h[H.CAM_Y], h[H.CAM_ZOOM]],
      pose: pp ? [pp.x, pp.y, pp.angle] : null, phys: e ? [e.pos ? e.pos.x : e.x, e.pos ? e.pos.y : e.y, e.angle] : null,
      win: winOf(SG), cell: s ? s.cell : 0, band: s ? cfg.edge * s.N * s.cell : 0,
      texel: SG && SG.maps ? [SG.maps.U.texel.value.x, SG.maps.U.texel.value.y] : null, lvl: SG && SG.maps && SG.maps._lvl ? [SG.maps._lvl[0], SG.maps._lvl[1]] : null,
      vcell: S.belt && S.belt.volume ? S.belt.volume.U.cell.value.x : NaN, env: SG && SG.input ? SG.input[IN.envCell] : NaN,
      envVer: SG && SG.input ? SG.input[IN.envVer] : NaN, envO: SG && SG.input ? [SG.input[IN.envX0], SG.input[IN.envY0]] : null,
      mapMin: SG && SG.maps ? [SG.maps.U.min.value.x, SG.maps.U.min.value.y] : null, lod: SG && SG.maps ? SG.maps.U.lodTexel.value : NaN,
      fine: S.belt && S.belt.volume && S.belt.volume.U.fine ? S.belt.volume.U.fine.value : NaN,
      vorg: S.belt && S.belt.volume && S.belt.volume.medium ? [S.belt.volume.medium.U.origin.value.x, S.belt.volume.medium.U.origin.value.y] : null,
      shifts: s ? s.stats.shifts : NaN, Wb: tex.width, Hb: tex.height, ps: C.pxScale || 1
    };
  }
  function cap() {
    const c = D.cap;
    if (!c.armed) return;
    const page = S.reader && S.reader.page;
    if (!page) return;
    const h = page.head;
    if (c.waitZoom === c.waitZoom && Math.abs(h[H.CAM_ZOOM] / c.waitZoom - 1) > 1e-6) return;
    const be = C.renderer.backend, dev = be.device, tex = be.context.getCurrentTexture();
    if (!c.fmt) { c.fmt = tex.format; c.swap = /^bgra/.test(tex.format); }
    if (!/^(bgra|rgba)8unorm/.test(tex.format)) { c.err = `format kanwy ${tex.format} (4 B na piksel?)`; c.armed = false; const f = c.resolve; c.resolve = null; if (f) f(); return; }
    const i = c.n;
    const bufs = c.pool[i] || (c.pool[i] = []);
    const enc = dev.createCommandEncoder({ label: 'drz-zrzut' });
    for (let r = 0; r < c.rects.length; r++) {
      const R = c.rects[r], size = R.w * 4 * R.h;
      let b = bufs[r];
      if (!b || b.size !== size) { if (b) b.destroy(); b = bufs[r] = dev.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'drz-zrzut' }); }
      enc.copyTextureToBuffer({ texture: tex, origin: { x: R.x, y: R.y, z: 0 } }, { buffer: b, offset: 0, bytesPerRow: R.w * 4, rowsPerImage: R.h },
        { width: R.w, height: R.h, depthOrArrayLayers: 1 });
    }
    dev.queue.submit([enc.finish()]);
    c.meta[i] = metaOf(h, tex);
    c.n++;
    if (c.n >= c.max) { c.armed = false; const f = c.resolve; c.resolve = null; if (f) f(); }
  }
  const rs0 = C.renderSingle;
  C.renderSingle = function () {
    const r = rs0.apply(this, arguments);
    try { row(); } catch (err) { D.log.err = String((err && err.stack) || err).slice(0, 400); }
    try { cap(); } catch (err) { D.cap.err = String((err && err.stack) || err).slice(0, 400); D.cap.armed = false; if (D.cap.resolve) { const f = D.cap.resolve; D.cap.resolve = null; f(); } }
    return r;
  };
  // stan bieżący (geometria kadru do wycinków)
  D.lib.state = () => {
    const page = S.reader && S.reader.page, h = page && page.head;
    const SG = S.spaceGas, pp = S.players && S.players.playerPose, s = SG && SG.sim;
    const tex = C.renderer.backend.context.getCurrentTexture();
    return { k: h ? h[H.K] : null, cam: h ? [h[H.CAM_X], h[H.CAM_Y], h[H.CAM_ZOOM]] : null, pose: pp ? [pp.x, pp.y, pp.angle] : null,
      win: winOf(SG), N: s ? s.N : null, cell: s ? s.cell : null, Wb: tex.width, Hb: tex.height, ps: C.pxScale || 1, fmt: tex.format,
      gaz: SG ? { aktywny: !!SG.stats.active, fade: SG.layer ? SG.layer.L.fade.value : null, pyl: SG.dust ? SG.dust.count : 0 } : null };
  };
  // uzbrojenie zrzutu: o = { rects: [{ x, y, w, h }], max, waitZoom, reset, timeoutMs } — w ≡ 0 (mod 64)
  D.lib.arm = (o) => new Promise((ok) => {
    const c = D.cap;
    if (o.reset) { c.n = 0; c.meta = []; D.frames = []; }
    c.rects = o.rects; c.max = c.n + (o.max || 1); c.waitZoom = Number.isFinite(o.waitZoom) ? o.waitZoom : NaN; c.err = null;
    const t = setTimeout(() => { c.armed = false; c.resolve = null; ok({ n: c.n, limit: true, blad: c.err }); }, o.timeoutMs || 5000);
    c.resolve = () => { clearTimeout(t); ok({ n: c.n, blad: c.err }); };
    c.armed = true;
  });
  // odczyt zrzutów [od, n): luminancja (Float32) każdego wycinka; RGBA zostaje dla `rgb: true` albo indeksów `rgbKlatki`
  D.lib.read = async (o = {}) => {
    const c = D.cap, from = D.frames.length, keepAll = !!o.rgb, keep = new Set(o.rgbKlatki || []);
    for (let i = from; i < c.n; i++) {
      const bufs = c.pool[i], fr = { m: c.meta[i], L: [], rgb: [] };
      for (let r = 0; r < c.rects.length; r++) {
        const b = bufs[r], R = c.rects[r];
        await b.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(b.getMappedRange());
        const n = R.w * R.h, L = new Float32Array(n);
        const ir = c.swap ? 2 : 0, ib = c.swap ? 0 : 2;
        for (let p = 0, q = 0; p < n; p++, q += 4) L[p] = 0.2126 * src[q + ir] + 0.7152 * src[q + 1] + 0.0722 * src[q + ib];
        let rgb = null;
        if (keepAll || keep.has(i)) {
          rgb = new Uint8Array(n * 4);
          for (let p = 0, q = 0; p < n; p++, q += 4) { rgb[q] = src[q + ir]; rgb[q + 1] = src[q + 1]; rgb[q + 2] = src[q + ib]; rgb[q + 3] = 255; }
        }
        b.unmap();
        fr.L.push(L); fr.rgb.push(rgb);
      }
      D.frames.push(fr);
    }
    return { klatek: D.frames.length, format: c.fmt, meta: D.frames.map((f) => f.m) };
  };
  // analiza wycinka ri (drzRoznice) — o: jak drzRoznice + { ri }
  D.lib.diff = (o) => {
    const c = D.cap, R = c.rects[o.ri || 0], m0 = D.frames[0] && D.frames[0].m;
    if (!m0) return { blad: 'brak klatek' };
    const g = { w: R.w, h: R.h, rx: R.x, ry: R.y, Wb: m0.Wb, Hb: m0.Hb, ps: m0.ps };
    const fr = D.frames.map((f) => ({ L: f.L[o.ri || 0], rgb: f.rgb[o.ri || 0], m: f.m }));
    return roznice(fr, g, o);
  };
  // PNG (base64): o = { i, ri, rodzaj: 'obraz' | 'roznica' }
  D.lib.png = async (o) => {
    const c = D.cap, ri = o.ri || 0, R = c.rects[ri], f = D.frames[o.i];
    if (!f) return null;
    let px;
    if (o.rodzaj === 'roznica') {
      const m0 = D.frames[0].m;
      const g = { w: R.w, h: R.h, rx: R.x, ry: R.y, Wb: m0.Wb, Hb: m0.Hb, ps: m0.ps };
      const fr = D.frames.map((q) => ({ L: q.L[ri], rgb: null, m: q.m }));
      if (!fr[o.i + 1]) return null;
      px = mapaRoznicy(fr, g, o.i, o.wzmoc || 16);
    } else {
      const rgb = f.rgb[ri];
      if (!rgb) return null;
      px = new Uint8ClampedArray(rgb.buffer, rgb.byteOffset, rgb.length);
    }
    const cv = new OffscreenCanvas(R.w, R.h), ctx = cv.getContext('2d');
    ctx.putImageData(new ImageData(px, R.w, R.h), 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  // pył gazu w kadrze: żywe drobiny w kadrze wg rozmiaru w px bufora (drobiny: ziarno ≥ 0,1, bok ziarno·8+5 j.; kłęby:
  // ziarno < 0,1, bok ziarno·260+40 j. — spaceGasDust.js)
  D.lib.dust = async () => {
    const SG = S.spaceGas, d = SG && SG.dust, s = SG && SG.sim;
    if (!d || !s) return null;
    const page = S.reader && S.reader.page, h = page && page.head;
    if (!h) return null;
    const R = C.renderer;
    const P = new Float32Array(await R.getArrayBufferAsync(d.pos.value));
    const V = new Float32Array(await R.getArrayBufferAsync(d.vel.value));
    const I = SG.input, c0 = s.cell, wx0 = I[IN.anchorX] + s.ox * c0, wy0 = I[IN.anchorY] + s.oy * c0;
    const z = h[H.CAM_ZOOM], ps = C.pxScale || 1, k = z * ps;
    const tex = R.backend.context.getCurrentTexture();
    const hw = tex.width / 2 / k, hh = tex.height / 2 / k, cx = h[H.CAM_X], cy = h[H.CAM_Y];
    const kl = [0.5, 1, 2, 4];
    const out = { zywych: 0, wKadrze: 0, drobiny: [0, 0, 0, 0, 0], kleby: [0, 0, 0, 0, 0], progiPx: kl, zoom: z, pxNaJ: k, drobina: d.count };
    // rozmiar RYSOWANY (spaceGasDustScreenCpu — najmniejszy bok minPx z zachowaniem energii, zanik drobin < ~1 px z MSAA):
    // klasy boku po powiększeniu i udział drobin w zaniku (pełne / częściowo / zgaszone) — z uniformów pyłu tej klatki
    const U = d.U, mp = U && U.minPx ? U.minPx.value : 0, fl = U && U.fadeLo ? U.fadeLo.value : -2, fh = U && U.fadeHi ? U.fadeHi.value : -1;
    out.minPx = mp; out.zanikPx = [fl, fh]; out.drobinyRys = [0, 0, 0, 0, 0]; out.zanikDrobin = { pelne: 0, czesciowe: 0, zgaszone: 0 };
    let energiaRys = 0, energiaGeo = 0;
    for (let i = 0; i < d.count; i++) {
      const age = V[i * 4 + 3];
      if (!(age >= 0)) continue;
      out.zywych++;
      const x = wx0 + P[i * 4], y = wy0 + P[i * 4 + 1];
      if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) continue;
      out.wKadrze++;
      const seed = P[i * 4 + 3], puff = seed < 0.1;
      const px = (puff ? seed * 260 + 40 : seed * 8 + 5) * k;
      let j = 0;
      while (j < kl.length && px >= kl[j]) j++;
      (puff ? out.kleby : out.drobiny)[j]++;
      if (!puff) {
        const grow = mp > 0 ? Math.max(mp / Math.max(px, 1e-6), 1) : 1, rys = px * grow;
        let t = fh > fl ? (px - fl) / (fh - fl) : 1;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const sm = t * t * (3 - 2 * t);
        let jr = 0;
        while (jr < kl.length && rys >= kl[jr]) jr++;
        out.drobinyRys[jr]++;
        if (sm >= 0.999) out.zanikDrobin.pelne++; else if (sm <= 0.001) out.zanikDrobin.zgaszone++; else out.zanikDrobin.czesciowe++;
        // energia w modelu „pole kwadu × jasność” (piksel w środku: bez strat) — nowy wzór: rys² · sm / grow² = px² · sm
        energiaRys += px * px * sm; energiaGeo += px * px;
      }
    }
    out.energiaWzglGeometrii = energiaGeo > 0 ? +(energiaRys / energiaGeo).toFixed(4) : null;
    return out;
  };
  // zwolnienie danych obrazu starszych klatek (zostaje `keep` ostatnich; meta zostaje) — analiza strumieniowa par
  D.lib.trim = (keep = 2) => {
    for (let i = 0; i < D.frames.length - keep; i++) { const f = D.frames[i]; if (f && f.L.length) { f.L = []; f.rgb = []; } }
    return D.frames.length;
  };
  D.lib.free = () => {
    const c = D.cap;
    D.frames = []; c.n = 0; c.meta = []; c.armed = false;
    for (const bufs of c.pool) if (bufs) for (const b of bufs) { try { b.destroy(); } catch (e) { /* już */ } }
    c.pool = [];
    return true;
  };
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Node: statystyki dziennika

const fin = (x) => Number.isFinite(x);
const r3 = (x) => (fin(x) ? +x.toFixed(3) : null);
const wrapRad = (a) => { let d = a % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** Szereg: średnia, odchylenie, rozpiętość, zmiana klatka po klatce (|Δ| — średnia, p95, maks) [jednostki szeregu]. */
export function szereg(arr) {
  const a = arr.filter(fin);
  if (a.length < 2) return null;
  const n = a.length, mean = a.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n);
  let mn = Infinity, mx = -Infinity;
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const d = [];
  for (let i = 1; i < arr.length; i++) if (fin(arr[i]) && fin(arr[i - 1])) d.push(Math.abs(arr[i] - arr[i - 1]));
  d.sort((x, y) => x - y);
  const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
  return { n, sr: r3(mean), odch: r3(sd), min: r3(mn), maks: r3(mx), rozp: r3(mx - mn),
    dSr: d.length ? r3(d.reduce((s, v) => s + v, 0) / d.length) : null, dP95: r3(q(0.95)), dMaks: r3(d.length ? d[d.length - 1] : null) };
}
const wPx = (s, k) => (s ? { sr: r3(s.sr * k), odch: r3(s.odch * k), rozp: r3(s.rozp * k), dSr: r3(s.dSr * k), dP95: r3(s.dP95 * k), dMaks: r3(s.dMaks * k) } : null);

/**
 * Światła gracza wobec pozy renderu (dziennik workera). Wiersze z jednego scenariusza (stała prędkość, obrót).
 * Zwraca: prędkość i obrót (z pozy fizycznej), dla każdego światła — położenie w układzie kadłuba [j.] i [px CSS = j. ·
 * zoom], oś wobec kąta pozy [°] (reflektory), związek z alfą renderu i krokiem fizyki.
 */
export function swiatlaStat(rows, LG, opis = {}) {
  const ok = rows.filter((r) => fin(r[LG.PX]) && fin(r[LG.QX]));
  if (ok.length < 8) return { stron: ok.length, blad: 'za mało stron z pozą' };
  const zoom = ok.reduce((s, r) => s + r[LG.ZOOM], 0) / ok.length;
  const a = ok[0], b = ok[ok.length - 1];
  const dtSim = b[LG.SIM] - a[LG.SIM];
  let dAng = 0;
  for (let i = 1; i < ok.length; i++) dAng += wrapRad(ok[i][LG.QA] - ok[i - 1][LG.QA]);
  const v = dtSim > 0 ? Math.hypot(b[LG.QX] - a[LG.QX], b[LG.QY] - a[LG.QY]) / dtSim : null;
  const omega = dtSim > 0 ? dAng / dtSim : null;
  // kroki fizyki między kolejnymi stronami, ΔK
  let kroki = 0, dk = [0, 0, 0, 0];
  for (let i = 1; i < ok.length; i++) {
    if (ok[i][LG.SIM] !== ok[i - 1][LG.SIM]) kroki++;
    dk[Math.max(0, Math.min(3, ok[i][LG.K] - ok[i - 1][LG.K]))]++;
  }
  const sw = {};
  const slot = (nazwa, iA, iC, iD) => {
    const al = ok.map((r) => r[iA]), ac = ok.map((r) => r[iC]);
    if (al.filter(fin).length < 4) return;
    const sA = szereg(al), sC = szereg(ac);
    const o = { stron: sA.n, wzdluz: sA, wpoprzek: sC, wzdluzPx: wPx(sA, zoom), wpoprzekPx: wPx(sC, zoom) };
    if (iD !== undefined) {
      // oś względem kadłuba [°] rozwinięta (reflektor rufowy leży przy ±180° — bez skoków o 360° w statystyce)
      const ax = ok.map((r) => r[iD]);
      for (let i = 1; i < ax.length; i++) {
        if (!fin(ax[i]) || !fin(ax[i - 1])) continue;
        while (ax[i] - ax[i - 1] > 180) ax[i] -= 360;
        while (ax[i] - ax[i - 1] < -180) ax[i] += 360;
      }
      const sD = szereg(ax);
      if (sD) {
        // kroki osi: strony bez zmiany (|Δ| < 1e-4°) i skoki > 0,2° — przy płynnym obrocie oś stoi, potem skacze
        let stoi = 0, skok = 0, n = 0, kad = 0;
        const dAbs = [];
        for (let i = 1; i < ok.length; i++) {
          const d0 = ok[i - 1][iD], d1 = ok[i][iD];
          if (!fin(d0) || !fin(d1)) continue;
          n++;
          // zmiana osi bezwzględnej = zmiana osi względem kadłuba + zmiana kąta pozy renderu (zawinięte)
          const dPose = wrapRad(ok[i][LG.PA] - ok[i - 1][LG.PA]) * 180 / Math.PI;
          let dRel = d1 - d0;
          if (dRel > 180) dRel -= 360; if (dRel < -180) dRel += 360;
          const absD = Math.abs(dRel + dPose);
          dAbs.push(absD);
          kad += Math.abs(dPose);
          if (absD < 1e-4) stoi++;
          if (absD > 0.2) skok++;
        }
        o.osWzglKadluba = sD;
        // przy płynnym obrocie kadłuba oś reflektora powinna iść ω·Δt na stronę; „stoi” (|Δ| < 1e-4°) i skoki > 0,2°
        o.osKroki = { stron: n, osStoi: stoi, osSkok02: skok, zmianaOsiNaStrone: szereg(dAbs), obrotKadlubaNaStroneDeg: n ? r3(kad / n) : null };
      }
    }
    sw[nazwa] = o;
  };
  slot('daleki0', LG.F0A, LG.F0C, LG.F0D);
  slot('daleki1', LG.F1A, LG.F1C, LG.F1D);
  for (let i = 0; i < 6; i++) slot(`otoczenia${i}`, LG.FL0A + i * 3, LG.FL0C + i * 3, LG.FL0D + i * 3);
  slot('dookolne', LG.OA, LG.OC);
  for (let i = 0; i < 4; i++) slot(`pozycyjne${i}`, LG.N0A + i * 2, LG.N0C + i * 2);
  // poza fizyczna − poza renderu w układzie kadłuba (bezpośrednio przyczyna 1)
  const dq = { wzdluz: szereg(ok.map((r) => r[LG.DQA])), wpoprzek: szereg(ok.map((r) => r[LG.DQC])), katDeg: szereg(ok.map((r) => r[LG.DQD])) };
  dq.wzdluzPx = wPx(dq.wzdluz, zoom); dq.wpoprzekPx = wPx(dq.wpoprzek, zoom);
  // alfa renderu (ćwiartki): średnie przesunięcie reflektora dalekiego 0 i pozy fizycznej wobec pozy renderu
  const kosze = {};
  for (const r of ok) {
    const q = Math.round((r[LG.ALPHA] % 1) * 4) / 4;
    const k = String(q);
    const e = kosze[k] || (kosze[k] = { n: 0, dq: 0, f0: 0, nf0: 0 });
    e.n++; e.dq += r[LG.DQA];
    if (fin(r[LG.F0A])) { e.f0 += r[LG.F0A]; e.nf0++; }
  }
  for (const k of Object.keys(kosze)) {
    const e = kosze[k];
    kosze[k] = { stron: e.n, fizMinusRenderWzdluzJ: r3(e.dq / e.n), daleki0WzdluzJ: e.nf0 ? r3(e.f0 / e.nf0) : null };
  }
  // korelacja przesunięcia reflektora dalekiego 0 (wzdłuż) z pozą fizyczną − renderu (wzdłuż)
  let kor = null;
  {
    const xs = [], ys = [];
    for (const r of ok) if (fin(r[LG.F0A]) && fin(r[LG.DQA])) { xs.push(r[LG.DQA]); ys.push(r[LG.F0A]); }
    if (xs.length > 8) {
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      kor = sxx > 0 && syy > 0 ? r3(sxy / Math.sqrt(sxx * syy)) : null;
    }
  }
  // skoki klatka po klatce reflektora dalekiego 0 (wzdłuż) na stronach z krokiem fizyki i bez
  const skoki = { zKrokiem: [], bezKroku: [] };
  for (let i = 1; i < ok.length; i++) {
    const d = Math.abs(ok[i][LG.F0A] - ok[i - 1][LG.F0A]);
    if (!fin(d)) continue;
    (ok[i][LG.SIM] !== ok[i - 1][LG.SIM] ? skoki.zKrokiem : skoki.bezKroku).push(d * zoom);
  }
  const sk = (arr) => (arr.length ? { n: arr.length, srPx: r3(arr.reduce((s, v) => s + v, 0) / arr.length), maksPx: r3(Math.max(...arr)) } : null);
  const siatka = { swiatla: szereg(ok.map((r) => r[LG.GL])), wpisy: szereg(ok.map((r) => r[LG.GI])), najwiecejWKomorce: szereg(ok.map((r) => r[LG.GMX])),
    zgubioneMaks: Math.max(...ok.map((r) => r[LG.GDR]).filter(fin)) };
  return {
    ...opis, stron: ok.length, s: r3((b[LG.NOW] - a[LG.NOW]) / 1000), zoom: r3(zoom), predkoscJs: v !== null ? Math.round(v) : null,
    obrotRadS: r3(omega), krokowFizyki: kroki, deltaK: { 1: dk[1], 2: dk[2], '3+': dk[3], 0: dk[0] },
    liczbySwiatel: { dalekie: Math.max(...ok.map((r) => r[LG.NF]).filter(fin)), otoczenia: Math.max(...ok.map((r) => r[LG.NFL]).filter(fin)), pozycyjne: Math.max(...ok.map((r) => r[LG.NN]).filter(fin)) },
    fizykaMinusRender: dq, alfa: kosze, korelacjaDaleki0ZFizMinusRender: kor,
    skokiDaleki0: { zKrokiemFizyki: sk(skoki.zKrokiem), bezKroku: sk(skoki.bezKroku) }, swiatla: sw, siatka
  };
}

/** Kolumny ośrodka pasa i początek Core3D.fx w dzienniku: faza siatki kolumn w świecie przy przeskokach początku. */
export function kolumnyStat(rows, LG) {
  const ok = rows.filter((r) => fin(r[LG.VC]) && fin(r[LG.FOX]));
  if (ok.length < 2) return null;
  // faza siatki kolumn w ŚWIECIE: róg siatki w układzie sceny = początek Core3D.fx (FOX, FOY) + róg lokalny (VX0, VY0) —
  // przy siatce względem początku (VOLUME_LIGHT_TUNE.worldAnchor = false) róg lokalny jest wielokrotnością kolumny, więc to
  // samo co faza początku; przy siatce w układzie sceny (domyślnie od 2026-10-29) faza stoi mimo przeskoku początku
  const faza = (r) => {
    const c = r[LG.VC];
    const w = (o, l) => { const x = r[o] + (fin(r[l]) ? r[l] : 0); return ((x % c) + c) % c / c; };
    return [w(LG.FOX, LG.VX0), w(LG.FOY, LG.VY0)];
  };
  const skok = (a, b) => { let d = Math.abs(a - b); if (d > 0.5) d = 1 - d; return d; };
  const przesk = [];
  for (let i = 1; i < ok.length; i++) {
    const p = ok[i - 1], r = ok[i];
    if (r[LG.FOX] !== p[LG.FOX] || r[LG.FOY] !== p[LG.FOY]) {
      const sameCell = r[LG.VC] === p[LG.VC];
      const fr = faza(r), fp = faza(p);
      const dph = sameCell ? Math.max(skok(fr[0], fp[0]), skok(fr[1], fp[1])) : null;
      przesk.push({ i, k: r[LG.K], dx: r3(r[LG.FOX] - p[LG.FOX]), dy: r3(r[LG.FOY] - p[LG.FOY]), kolumnaJ: r3(r[LG.VC]), skokFazyKolumny: r3(dph),
        skokPx: dph !== null ? r3(dph * r[LG.VC] * r[LG.ZOOM]) : null });
    }
  }
  return { stron: ok.length, przeskokiPoczatku: przesk.length, przeskokiPoczatkuRebases: r3(ok[ok.length - 1][LG.FREB] - ok[0][LG.FREB]), lista: przesk.slice(0, 12) };
}

/**
 * Drabiny przy ruchu zoomu (dziennik workera): stopnie map gazu (x / y), kolumny ośrodka, krok obwiedni — liczba, zoom,
 * przesunięcie siatki tekseli na środku kadru [teksel], klatki ze zmianą zoomu.
 */
export function drabinaStat(rows, LG) {
  const ok = rows.filter((r) => fin(r[LG.ZOOM]));
  if (ok.length < 3) return { stron: ok.length };
  const ev = { mapa: [], kolumna: [], obwiednia: [] };
  let ruch = 0;
  for (let i = 1; i < ok.length; i++) {
    const p = ok[i - 1], r = ok[i];
    if (Math.abs(r[LG.ZOOM] / p[LG.ZOOM] - 1) > 1e-7) ruch++;
    if (r[LG.MLX] !== p[LG.MLX] || r[LG.MLY] !== p[LG.MLY]) {
      // faza siatki tekseli na środku kadru (kamera względem kotwicy = CAM − ANX) przed i po
      const ph = (cam, mn, tx) => { const u = (cam - mn) / tx - 0.5; return u - Math.floor(u); };
      const cx = r[LG.CAMX] - r[LG.ANX], cy = r[LG.CAMY] - r[LG.ANY];
      let dpx = Math.abs(ph(cx, r[LG.MMX], r[LG.TX]) - ph(cx, p[LG.MMX], p[LG.TX]));
      let dpy = Math.abs(ph(cy, r[LG.MMY], r[LG.TY]) - ph(cy, p[LG.MMY], p[LG.TY]));
      if (dpx > 0.5) dpx = 1 - dpx;
      if (dpy > 0.5) dpy = 1 - dpy;
      ev.mapa.push({ i, k: r[LG.K], zoom: r3(r[LG.ZOOM]), stopien: [r[LG.MLX] - p[LG.MLX], r[LG.MLY] - p[LG.MLY]], teksel: [r3(r[LG.TX]), r3(r[LG.TY])],
        tekselPx: [r3(r[LG.TX] * r[LG.ZOOM]), r3(r[LG.TY] * r[LG.ZOOM])], fazaSrodka: [r3(dpx), r3(dpy)] });
    }
    if (r[LG.VC] !== p[LG.VC] && fin(r[LG.VC]) && fin(p[LG.VC])) ev.kolumna.push({ i, k: r[LG.K], zoom: r3(r[LG.ZOOM]), kolumnaJ: r3(r[LG.VC]), kolumnaPx: r3(r[LG.VC] * r[LG.ZOOM]) });
    if (r[LG.ENVC] !== p[LG.ENVC] && fin(r[LG.ENVC]) && fin(p[LG.ENVC])) ev.obwiednia.push({ i, k: r[LG.K], zoom: r3(r[LG.ZOOM]), krokJ: r3(r[LG.ENVC]), krokPoprzedniJ: r3(p[LG.ENVC]) });
  }
  const zmin = Math.min(...ok.map((r) => r[LG.ZOOM])), zmax = Math.max(...ok.map((r) => r[LG.ZOOM]));
  const s = (ok[ok.length - 1][LG.NOW] - ok[0][LG.NOW]) / 1000;
  const fazy = ev.mapa.map((e) => Math.max(e.fazaSrodka[0] ?? 0, e.fazaSrodka[1] ?? 0)).filter(fin);
  return {
    stron: ok.length, s: r3(s), zoomMin: r3(zmin), zoomMaks: r3(zmax), oktawZoomu: r3(Math.log2(zmax / zmin)), stronZRuchemZoomu: ruch,
    zmianyMap: ev.mapa.length, zmianyKolumn: ev.kolumna.length, zmianyObwiedni: ev.obwiednia.length,
    zmianyMapNaOktawe: r3(ev.mapa.length / Math.max(1e-6, 2 * Math.log2(zmax / zmin))),
    udzialStronZPrzeprobkowaniemMap: r3(ev.mapa.length / Math.max(1, ruch)),
    fazaSrodkaPrzyStopniuMap: fazy.length ? { sr: r3(fazy.reduce((x, y) => x + y, 0) / fazy.length), maks: r3(Math.max(...fazy)) } : null,
    mapy: ev.mapa.slice(0, 60), kolumny: ev.kolumna.slice(0, 60), obwiednia: ev.obwiednia
  };
}

/** Okno pola w locie: przesunięcia / s, resety, zmiany kroku obwiedni, stopnie map / kolumn (przy stałym zoomie — 0). */
export function oknoStat(rows, LG) {
  const ok = rows.filter((r) => fin(r[LG.SSH]));
  if (ok.length < 3) return null;
  const s = (ok[ok.length - 1][LG.NOW] - ok[0][LG.NOW]) / 1000;
  const sh = ok[ok.length - 1][LG.SSH] - ok[0][LG.SSH], rs = ok[ok.length - 1][LG.SRS] - ok[0][LG.SRS];
  let env = 0, map = 0, kol = 0, envVer = 0;
  for (let i = 1; i < ok.length; i++) {
    if (ok[i][LG.ENVC] !== ok[i - 1][LG.ENVC]) env++;
    if (ok[i][LG.ENVV] !== ok[i - 1][LG.ENVV]) envVer++;
    if (ok[i][LG.MLX] !== ok[i - 1][LG.MLX] || ok[i][LG.MLY] !== ok[i - 1][LG.MLY]) map++;
    if (ok[i][LG.VC] !== ok[i - 1][LG.VC]) kol++;
  }
  const r = ok[ok.length - 1];
  return { stron: ok.length, s: r3(s), przesunieciaOkna: sh, przesunieciaNaS: r3(sh / Math.max(1e-6, s)), resety: rs, zmianyKrokuObwiedni: env,
    wersjeObwiedni: envVer, stopnieMap: map, stopnieKolumn: kol, zoom: r3(r[LG.ZOOM]), teksel: [r3(r[LG.TX]), r3(r[LG.TY])],
    tekselPxCss: [r3(r[LG.TX] * r[LG.ZOOM]), r3(r[LG.TY] * r[LG.ZOOM])], tekselCiagly: r3(r[LG.LOD]), krokObwiedniJ: r3(r[LG.ENVC]),
    kolumnaJ: r3(r[LG.VC]), oknoJ: r3(r[LG.SN] * r[LG.SC]), fadeWarstwy: r3(r[LG.GFADE]), gazAktywny: r[LG.GACT] };
}

/** Podsumowanie listy par / trójek (drzRoznice) dla regionu: mediana i maksimum wskaźników. */
export function podsumujRoznice(lista, region = 'wszystko', pole = 'luma') {
  const v = lista.map((p) => p[pole] && p[pole][region]).filter(Boolean);
  if (!v.length) return null;
  const med = (k) => { const a = v.map((x) => x[k]).filter(fin).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const mx = (k) => { const a = v.map((x) => x[k]).filter(fin); return a.length ? Math.max(...a) : null; };
  const sr = (k) => { const a = v.map((x) => x[k]).filter(fin); return a.length ? r3(a.reduce((s, x) => s + x, 0) / a.length) : null; };
  return { n: v.length, pikseli: med('n'), rms: { med: med('rms'), sr: sr('rms'), maks: mx('rms') }, proc4: { med: med('proc4'), sr: sr('proc4'), maks: mx('proc4') },
    proc8: { med: med('proc8'), sr: sr('proc8'), maks: mx('proc8') }, p99: { med: med('p99'), maks: mx('p99') }, maks: mx('maks'),
    igliceNaMpx: { med: med('igliceNaMpx'), sr: sr('igliceNaMpx'), maks: mx('igliceNaMpx') } };
}
