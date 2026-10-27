// scripts/pas-koszt-pola.mjs — koszt CPU PRAWDZIWEGO pola pasa (obraz: RockLayer × 4 + FieldMap) przy przelocie kamery
// z prędkością v przez szczyt najgęstszego pola rodziny (stycznie do Słońca), 1080p, 6 s. Bez GPU i bez gry: logika
// RockLayer.update odtworzona na polu gry (okno komórek, oktawy z progu px, kolejka brakujących wg odległości, budżet
// klatki) — AGENT: zmiana wczytywania w src/3d/asteroids/rockLayers.js / asteroidBelt.js = zmiana tutaj.
// Liczy: gen — czas generowania komórek na klatkę BEZ budżetu (ile trzeba, żeby pole nadążało) i Z budżetem;
// DZIURY W KADRZE — klatki z komórką czekającą w kolejce, której skały leżą w widocznym kadrze warstwy (pop-in);
// compact — przebudowa koszyków; mapa — przebudowa mapy pola (48 × 48 próbek).
// Pomiar 2026-10-27 (hipercruise Mk III przez prawdziwe pole): docs/webgpu/WARP-SKALY.md § „Usunięcie”.
//
// node scripts/pas-koszt-pola.mjs [prędkości j/s] [zoomy] [budżet] [koszt] [powtórzenia] [--root <drzewo>]
//   budżet: gra (domyślnie — jak asteroidBelt.js: wspólny budżet klatki dzielony wagą zaległości warstw, rośnie
//           z prędkością kamery — beltLoadBudgetMs), weighted (podział wagą, stałe 3 ms), shared (reszta / warstwy
//           do końca), equal (dawny równy podział: 3 ms / 4 warstwy);
//   koszt:  model (domyślnie — DETERMINISTYCZNY: koszt komórki CELL_US + ROCK_US · skał [µs], zmienne środowiska,
//           domyślnie 7 + 2,2 — regresja zegara w Node; przeglądarka ~2× — CELL_US=14 ROCK_US=4.4), wall (zegar ścienny
//           — wynik zależy od obciążenia CPU, powtarzaj: „powtórzenia” > 1).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ARGS = process.argv.slice(2);
const rootAt = ARGS.indexOf('--root');
const repo = rootAt >= 0 ? ARGS.splice(rootAt, 2)[1] : fileURLToPath(new URL('..', import.meta.url));
const imp = (p) => import(pathToFileURL(join(repo, p)).href);
const { buildSystemMap } = await imp('src/data/systemMap.js');
const { BELT_DEFINITIONS, getOutermostBeltEdgeAu } = await imp('src/data/asteroidTypes.js');
const { AsteroidBeltField, BELT_BAND } = await imp('src/game/asteroidBeltField.js');
const { FieldSunOcclusion, nightKnee } = await imp('src/game/asteroidFieldLight.js');
const { stormIntensity } = await imp('src/game/asteroidStorms.js');

const SUN = { x: 6000000, y: 6000000, r: 823 };
const map = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
  planetScale: 3, sunRadius: SUN.r,
  angleFor: (def) => ({ jupiter: 250, saturn: 60, mars: 120, earth: 330 }[def.id] ?? 0) * Math.PI / 180
});
const AU = map.auInWorldUnits;
for (const p of map.planets) { p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius; p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius; }

function makeField() {
  return new AsteroidBeltField({ planets: map.planets, sunX: SUN.x, sunY: SUN.y, auToWorld: AU });
}
const probe = makeField();
const peaks = probe.familyPeaks();
const occ = new FieldSunOcclusion(probe);
await occ.precomputeAll({});
const sunT = (x, y) => nightKnee(occ.transmittance(x, y));

const W = 1920, H = 1080;
const FOCAL = (H * 0.5) / Math.tan(17.5 * Math.PI / 180);
const BACK_FADE = { [BELT_BAND.RUBBLE]: [0.22, 0.09], [BELT_BAND.MID]: [0.07, 0.03], [BELT_BAND.DEEP]: null };
const LAYERS = [
  { band: BELT_BAND.PLAY, persp: false, minPx: 0.7, fade: null },
  { band: BELT_BAND.RUBBLE, persp: true, minPx: 0.8, fade: BACK_FADE[BELT_BAND.RUBBLE] },
  { band: BELT_BAND.MID, persp: true, minPx: 0.8, fade: BACK_FADE[BELT_BAND.MID] },
  { band: BELT_BAND.DEEP, persp: true, minPx: 0.8, fade: null }
];
const MARGIN = 0.3, CULL_MARGIN = 0.12, REBUILD_MOVE = 0.05, FLOATS = 20;
const key = (cx, cy) => `${cx},${cy}`;

const BUDGET_MODE = (ARGS[2] || 'gra') === 'gra' ? 'weighted-boost' : ARGS[2];
const COST = ARGS[3] || 'model';
const REPEAT = Number(ARGS[4] || 1);
const CELL_US = Number(process.env.CELL_US || 7), ROCK_US = Number(process.env.ROCK_US || 2.2);
const { beltLoadBudgetMs } = BUDGET_MODE.endsWith('-boost') ? await imp('src/3d/asteroids/asteroidBelt.js') : { beltLoadBudgetMs: null };
let calib = { cells: 0, rocks: 0, ms: 0, sxx: 0, sxy: 0 };
function run({ field, x0, y0, dirX, dirY, v, zoom, seconds, budgetMs = 3, warm = 1.0, budgeted = false }) {
  const dt = 1 / 60;
  const layers = LAYERS.map((L) => ({
    ...L, bandDef: field.bands[L.band],
    octs: field.bands[L.band].octaves.map((o) => ({ o, cells: new Map(), range: null, pending: 0 })),
    built: { x: NaN, y: NaN }
  }));
  const m = { x0: 0, y0: 0, w: 0, valid: false };
  const res = { visL: [0, 0, 0, 0], vis: 0, visFrames: 0, frames: 0, gen: [], genBudget: [], pend: 0, pendFrames: 0, cellsNew: 0, comp: [], map: [], mapBuilds: 0, rocks: 0 };
  const total = Math.round((seconds + warm) / dt);
  const scratch = new Float32Array(FLOATS);
  for (let fr = 0; fr < total; fr++) {
    const t = fr * dt - warm;
    const s = Math.max(0, t) * v;
    const cx = x0 + dirX * s, cy = y0 + dirY * s;
    const measure = t >= 0;
    let genAll = 0, genBud = 0, compMs = 0, pendAll = 0, visMiss = 0;
    const camZ = FOCAL / zoom;
    const totalBudget = beltLoadBudgetMs ? beltLoadBudgetMs(budgetMs, fr * dt < warm ? 0 : v) : budgetMs;
    let spentFrame = 0;
    let wsum = 0;
    for (const L of layers) wsum += 1 + (L.pendPrev || 0);
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      let minPx = L.minPx;
      if (L.fade) {
        const [full, gone] = L.fade;
        const tt = Math.min(1, Math.max(0, (full - zoom) / (full - gone)));
        minPx += tt * tt * (3 - 2 * tt) * 60;
      }
      const band = L.bandDef;
      const spreadFar = L.persp ? (camZ + band.zFar) / camZ : 1;
      const halfW = (W * 0.5 / zoom) * spreadFar, halfH = (H * 0.5 / zoom) * spreadFar;
      const mw = halfW * MARGIN, mh = halfH * MARGIN;
      const pxNear = L.persp ? FOCAL / (camZ + band.zNear) : zoom;
      const touches = field.rectTouchesBelt(cx - halfW - mw, cy - halfH - mh, cx + halfW + mw, cy + halfH + mh);
      const wL = 1 + (L.pendPrev || 0);
      const budgetEnd = BUDGET_MODE === 'equal' ? budgetMs / LAYERS.length
        : BUDGET_MODE.startsWith('weighted') ? Math.max(0, totalBudget - spentFrame) * wL / wsum
        : Math.max(0, totalBudget - spentFrame) / (LAYERS.length - li);
      wsum -= wL;
      let pendLayer = 0;
      let spent = 0, loaded = 0;
      for (const O of L.octs) {
        const rPxMax = O.o.d1 * 0.5 * pxNear;
        if (!(touches && rPxMax >= minPx)) { O.cells.clear(); O.range = null; continue; }
        const cs = O.o.cell, pad = O.o.d1 * 0.5;
        const c0 = Math.floor((cx - halfW - mw - pad) / cs), c1 = Math.floor((cx + halfW + mw + pad) / cs);
        const r0 = Math.floor((cy - halfH - mh - pad) / cs), r1 = Math.floor((cy + halfH + mh + pad) / cs);
        const r = O.range;
        if (r && r[0] === c0 && r[1] === c1 && r[2] === r0 && r[3] === r1 && O.pending === 0) continue;
        O.range = [c0, c1, r0, r1];
        for (const [k, c] of O.cells) if (c.cx < c0 - 1 || c.cx > c1 + 1 || c.cy < r0 - 1 || c.cy > r1 + 1) O.cells.delete(k);
        const miss = [];
        for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) {
          if (!O.cells.has(key(x, y))) { const dx = (x + 0.5) * cs - cx, dy = (y + 0.5) * cs - cy; miss.push([x, y, dx * dx + dy * dy]); }
        }
        miss.sort((a, b) => a[2] - b[2]);
        O.pending = 0;
        // widoczny kadr warstwy (bez zapasu): ortho — kadr, tło — kadr na bliskim brzegu pasma
        const kNear = L.persp ? (camZ + band.zNear) / camZ : 1;
        const vx0 = cx - (W * 0.5 / zoom) * kNear, vx1 = cx + (W * 0.5 / zoom) * kNear;
        const vy0 = cy - (H * 0.5 / zoom) * kNear, vy1 = cy + (H * 0.5 / zoom) * kNear;
        for (const [x, y] of miss) {
          const overBudget = budgeted && loaded > 0 && spent >= budgetEnd;
          if (overBudget) {
            O.pending++;
            if (measure && (x + 1) * cs + pad > vx0 && x * cs - pad < vx1 && (y + 1) * cs + pad > vy0 && y * cs - pad < vy1) { visMiss++; res.visL[li]++; }
            continue;
          }
          const t0 = performance.now();
          const rocks = field.cellRocks(L.band, O.o.k, x, y);
          for (let i = 0; i < rocks.length; i++) { const rk = rocks[i]; scratch[0] = rk.x; scratch[1] = rk.y; scratch[19] = sunT(rk.x, rk.y); }
          const wallMs = performance.now() - t0;
          const ms = COST === 'model' ? (CELL_US + ROCK_US * rocks.length) / 1000 : wallMs;
          calib.cells++; calib.rocks += rocks.length; calib.ms += wallMs; calib.sxx += rocks.length * rocks.length; calib.sxy += rocks.length * wallMs;
          O.cells.set(key(x, y), { cx: x, cy: y, n: rocks.length });
          genAll += ms;
          spent += ms; loaded++;
          if (measure) res.cellsNew++;
        }
        pendAll += O.pending;
        pendLayer += O.pending;
      }
      genBud += spent;
      L.pendPrev = pendLayer;
      spentFrame += spent;
      // przebudowa koszyków (_compact) po przejechaniu 5% kadru
      const B = L.built;
      const vw = W / zoom;
      if (!(Math.abs(cx - B.x) < vw * REBUILD_MOVE && Math.abs(cy - B.y) < vw * REBUILD_MOVE)) {
        B.x = cx; B.y = cy;
        const t0 = performance.now();
        let n = 0;
        const bw = (W * 0.5 / zoom) * (1 + CULL_MARGIN + REBUILD_MOVE), bh = (H * 0.5 / zoom) * (1 + CULL_MARGIN) + vw * REBUILD_MOVE;
        for (const O of L.octs) for (const c of O.cells.values()) {
          const rocks = field.cellRocks(L.band, O.o.k, c.cx, c.cy);
          for (let i = 0; i < rocks.length; i++) {
            const rk = rocks[i];
            let pxu = zoom, hw = bw, hh = bh;
            if (L.persp) { const kk = camZ / (camZ + rk.z); pxu = FOCAL / (camZ + rk.z); hw *= kk; hh *= kk; }
            if (Math.abs(rk.x - cx) > hw + rk.r * 1.5 || Math.abs(rk.y - cy) > hh + rk.r * 1.5) continue;
            if (rk.r * pxu < minPx) continue;
            for (let q = 0; q < FLOATS; q++) scratch[q] = q;
            n++;
          }
        }
        compMs += performance.now() - t0;
        if (measure) res.rocks = Math.max(res.rocks, n);
      }
    }
    // mapa pola (FieldMap.update / _build)
    let mapMs = 0;
    {
      const camZm = FOCAL / zoom, spread = (camZm + 26000) / camZm;
      const hw = (W * 0.5 / zoom) * spread, hh = (H * 0.5 / zoom) * spread;
      const need = Math.max(hw, hh) * 2;
      const inside = m.valid && cx - hw >= m.x0 && cx + hw <= m.x0 + m.w && cy - hh >= m.y0 && cy + hh <= m.y0 + m.w && need >= m.w * 0.3;
      if (!inside) {
        const t0 = performance.now();
        const size = Math.pow(2, Math.ceil(Math.log2(need * 1.6)));
        const texel = size / 48;
        const mx0 = Math.floor((cx - size * 0.5) / texel) * texel, my0 = Math.floor((cy - size * 0.5) / texel) * texel;
        let acc = 0;
        for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++) {
          const wx = mx0 + (i + 0.5) * texel, wy = my0 + (j + 0.5) * texel;
          const T = sunT(wx, wy); const mac = field.sampleMacro(wx, wy);
          acc += T + mac.weight + stormIntensity(field.seed, wx, wy, mac.cluster);
        }
        m.x0 = mx0; m.y0 = my0; m.w = size; m.valid = acc >= -1;
        mapMs = performance.now() - t0;
        if (measure) res.mapBuilds++;
      }
    }
    field.endFrame(7000);
    if (measure) {
      res.frames++;
      res.gen.push(genAll); res.genBudget.push(genBud); res.comp.push(compMs); res.map.push(mapMs);
      res.pend += pendAll; if (pendAll > 0) res.pendFrames++;
      res.vis += visMiss; if (visMiss > 0) res.visFrames++;
    }
  }
  return res;
}

const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const f2 = (x) => x.toFixed(2);

// Trasa: przez szczyt najgęstszego pola rodziny (stycznie do Słońca) i radialnie przez pas główny.
for (const p of peaks) p._d = probe.densityAt(p.x, p.y);
const best = [...peaks].sort((a, b) => b._d - a._d)[0];
const pa = Math.atan2(best.y - SUN.y, best.x - SUN.x);
const tdx = -Math.sin(pa), tdy = Math.cos(pa);
const LEG = 600000; // [j.] odcinek pomiaru — start przed szczytem
const SPEEDS = (ARGS[0] || '24000,32000,40000').split(',').map(Number);
const ZOOMS = (ARGS[1] || '0.117,0.2133').split(',').map(Number);
console.log(`AU ${AU.toFixed(1)} · szczyt ${best.family?.id || best.familyId || '?'} gęstość ${(best._d || 0).toExponential(2)} · ${peaks.length} szczytów`);
for (const zoom of ZOOMS) {
  for (const v of SPEEDS) {
    const field = makeField();
    field.familyPeaks();
    const seconds = Math.min(6, LEG / v);
    const s0 = -Math.min(LEG / 2, v * seconds / 2);
    const a = run({ field, x0: best.x + tdx * s0, y0: best.y + tdy * s0, dirX: tdx, dirY: tdy, v, zoom, seconds });
    const bs = [];
    for (let rep = 0; rep < REPEAT; rep++) {
      const fb = makeField(); fb.familyPeaks();
      bs.push(run({ field: fb, x0: best.x + tdx * s0, y0: best.y + tdy * s0, dirX: tdx, dirY: tdy, v, zoom, seconds, budgeted: true }));
    }
    const b = bs[0];
    const holes = bs.map((r) => (100 * r.visFrames / r.frames).toFixed(0) + '%').join(' / ');
    console.log(`zoom ${zoom} v ${String(v).padStart(6)} j/s · ${a.frames} kl. · BEZ budżetu: gen śr ${f2(mean(a.gen))} p95 ${f2(q(a.gen, 0.95))} ms, nowe kom. ${(a.cellsNew / a.frames).toFixed(1)}/kl.`
      + ` · Z budżetem: gen śr ${f2(mean(b.gen))} p95 ${f2(q(b.gen, 0.95))}, kolejka ${(100 * b.pendFrames / b.frames).toFixed(0)}% kl. (śr ${(b.pend / b.frames).toFixed(1)}), DZIURY W KADRZE ${holes} kl. (śr ${(b.vis / b.frames).toFixed(2)} kom.; PLAY/RUBBLE/MID/DEEP ${b.visL.join('/')})`
      + ` · compact śr ${f2(mean(a.comp))} (skał ${a.rocks}) · mapa ${f2(a.mapBuilds / (a.frames / 60))}/s, max ${f2(Math.max(...a.map))} ms`);
  }
}

{ const n = calib.cells, mx = calib.rocks / n, my = calib.ms / n; const b = (calib.sxy / n - mx * my) / (calib.sxx / n - mx * mx); console.log(`regresja: ${(1000 * (my - b * mx)).toFixed(1)} µs/kom. + ${(1000 * b).toFixed(2)} µs/skałę`); }
console.log(`[${BUDGET_MODE}, koszt ${COST}] kalibracja zegara: ${calib.cells} kom., ${(calib.rocks / Math.max(1, calib.cells)).toFixed(1)} skał/kom., ${(1000 * calib.ms / Math.max(1, calib.cells)).toFixed(1)} µs/kom. (model ${CELL_US} + ${ROCK_US}·skał = ${(CELL_US + ROCK_US * calib.rocks / Math.max(1, calib.cells)).toFixed(1)} µs/kom.)`);
