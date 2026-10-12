// Gaz i pył hali K-7 v2 — siatka 3D (src/3d/hallGas3d/, docs/BRIEF-gaz-hali-3d.md, plan docs/PLAN-3d-gaz.md, etap E1):
// domena i rastr zajętości (ułamek 0–1, deterministyczny), lustra CPU kerneli (stożek strugi przyściennej, źródło objętości
// = wydatek, rzut ciśnienia: dywergencja ŚCIANOWA = cel — Rhie–Chow, filtr biharmoniczny bez tarcia ściany, wymiana pyłu
// z pokładem — masa zachowana, szczelina pod kadłubem), wejście klatki (nadzbiór wejścia pyłu 2D + dach), WGSL kerneli
// i brył w Node (limity wiązań, żaden kernel nie czyta i nie pisze tej samej tekstury), macierz brył (wyznacznik > 0),
// szew gra ↔ render (bez window / DOM, bez Math.random).
// Fizyka na GPU (miary § 10 briefu): node scripts/webgpu/3d-gaz-demo.mjs --tryb e1
// node --test tests/hallGas3d.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { createK7Layout, k7HeightToZ, K7_HEIGHTS } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const L = await import('../src/3d/hallGas3d/hallGas3dLayout.js');
const { HallGas3dGrid } = await import('../src/3d/hallGas3d/hallGas3dGrid.js');
const { HallGas3dVolume, createHallGas3dLook, hallGas3dTransmittanceCpu } = await import('../src/3d/hallGas3d/hallGas3dVolume.js');
const { createHallGas3dInput, packHallGas3dFrame } = await import('../src/game/hallGas3dInput.js');
const { HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_SHIP } = await import('../src/3d/gasField/hallDustLayout.js');
const { packHallDustFrame } = await import('../src/game/hallDustInput.js');
const { fxNoise } = await import('../src/3d/fx/noise.js');

const LAY = createK7Layout();
const DOM = L.hallGas3dDomain(LAY);
const RASTER = L.rasterizeHallGas3d(LAY, DOM);
const DECK = L.hallGas3dDeckStart(LAY, DOM, RASTER);
const T = L.createHallGas3dTune();
const cellOf = (x, z, y) => {
  const i = Math.floor((x - DOM.x0) / DOM.h), j = Math.floor((z - DOM.z0) / DOM.h), k = Math.floor(y / DOM.h);
  const o = ((k * DOM.nd + j) * DOM.nx + i) * 4;
  const d = RASTER.data;
  return { occ: d[o] / 255, air: d[o + 1] > 127, dist: d[o + 2] / 4, col: d[o + 3] > 127 };
};

test('domena: komórka 56 j. (pomiar E0), nx i nd wielokrotności 8, dispatch wielokrotnością 64, hala z zapasem, próżnia za bramą, pokład 2× drobniejszy', () => {
  assert.equal(DOM.h, L.HALL_GAS3D_GRID.cell);
  assert.equal(DOM.h, 56);
  assert.equal(DOM.nx % 8, 0);
  assert.equal(DOM.nd % 8, 0);
  assert.equal(DOM.cells, DOM.nx * DOM.nd * DOM.nh);
  assert.equal(DOM.dispatch % 64, 0);
  assert.ok(DOM.dispatch >= DOM.cells);
  assert.ok(DOM.x0 < -LAY.halfWidth && DOM.x1 > LAY.halfWidth, 'ściany boczne w domenie');
  assert.ok(DOM.z0 < LAY.backZ - LAY.wallThickness * 0.5, 'ściana tylna w domenie');
  assert.ok(DOM.z1 >= LAY.frontZ + L.HALL_GAS3D_GRID.vacuum - 1e-6, 'pas próżni za bramą G-01');
  assert.ok(DOM.top >= L.HALL_GAS3D_GRID.roofY, 'strop hali w domenie');
  assert.equal(DOM.deckNx, 2 * DOM.nx);
  assert.equal(DOM.deckNd, 2 * DOM.nd);
});

test('wysokość K-7 ↔ z sceny: lustro k7HeightToZ (pod szczytem kadłuba 1:1, wyżej ściśnięte), odwracalne', () => {
  for (const y of [0, 28, 48, 76, 116, 160, 300, 600, 711, 768]) {
    assert.ok(Math.abs(L.hallGas3dHeightToZ(y) - k7HeightToZ(y)) < 1e-9, `y=${y}`);
    assert.ok(Math.abs(L.hallGas3dZToHeight(L.hallGas3dHeightToZ(y)) - y) < 1e-9, `y=${y}`);
  }
  assert.equal(L.hallGas3dHeightToZ(K7_HEIGHTS.hullTop), 0);
});

test('rastr: ściana tylna do stropu, otwór bramy pod nadprożem, słupki paliwowe C-01, powietrze w hali, próżnia za bramą, pole odległości', () => {
  for (const y of [28, 300, 690]) assert.ok(cellOf(0, LAY.backZ, y).occ >= 0.5, `ściana tylna y=${y}`);
  const g = LAY.gates[0];
  assert.ok(cellOf(g.x, g.z, 300).occ < 0.5, 'otwór bramy G-01');
  assert.ok(cellOf(g.x, g.z, 680).occ >= 0.5, 'nadproże bramy G-01');
  const mid = cellOf(0, 3500, 200);
  assert.ok(mid.air && mid.col && mid.occ < 0.5, 'wnętrze hali');
  const vac = cellOf(0, LAY.frontZ + 1000, 200);
  assert.ok(!vac.air && !vac.col, 'próżnia za bramą');
  const c01 = LAY.berths.find((b) => b.id === 'C-01');
  for (const a of c01.serviceAnchors) assert.ok(cellOf(a.x, a.z, 100).occ >= 0.5, `słupek paliwowy C-01/${a.side}`);
  assert.equal(cellOf(0, LAY.backZ, 300).dist, 0);
  assert.ok(mid.dist >= 1);
  // udział zajętości z 64 próbek (4 × 4 × 4)
  assert.equal(L.hallGas3dMaskFraction(0xffffffff, 0xffffffff), 1);
  assert.equal(L.hallGas3dMaskFraction(0, 0), 0);
  assert.equal(L.hallGas3dMaskFraction(0xffff, 0), 0.25);
});

test('rastr i wzór kurzu na pokładzie deterministyczne (hasz, bez Math.random), kurz 0…1 tylko w hali, pod bryłami 0', () => {
  const r2 = L.rasterizeHallGas3d(LAY, DOM);
  assert.equal(Buffer.compare(Buffer.from(r2.data), Buffer.from(RASTER.data)), 0);
  const d2 = L.hallGas3dDeckStart(LAY, DOM, RASTER);
  assert.equal(Buffer.compare(Buffer.from(d2.buffer), Buffer.from(DECK.buffer)), 0);
  let inHall = 0, sum = 0;
  for (let b = 0; b < DOM.deckNd; b++) {
    for (let a = 0; a < DOM.deckNx; a++) {
      const v = DECK[b * DOM.deckNx + a];
      assert.ok(v >= 0 && v <= 1);
      const x = DOM.x0 + (a + 0.5) * DOM.h * 0.5, z = DOM.z0 + (b + 0.5) * DOM.h * 0.5;
      if (!L.hallGas3dInsidePolygon(LAY.footprint, x, z)) assert.equal(v, 0, 'poza obrysem hali bez kurzu');
      else if (RASTER.occ[(b >> 1) * DOM.nx + (a >> 1)] < 0.5) { inHall++; sum += v; }
    }
  }
  assert.ok(sum / inHall > 0.15, 'kurz na pokładzie hali');
});

test('stożek strugi (lustro kernela): na osi 1, przekrój ELIPTYCZNY — przy pokładzie strumień przyścienny rozpływa się na boki szybciej niż w pion', () => {
  const Lc = 50, w0 = 1.2;
  assert.ok(Math.abs(L.hallGas3dConeProfileCpu(5, 0, 0, Lc, w0, 0.05, 0.3) - 1) < 1e-12);
  const side = L.hallGas3dConeProfileCpu(10, 4, 0, Lc, w0, 0.05, 0.3);
  const up = L.hallGas3dConeProfileCpu(10, 0, 4, Lc, w0, 0.05, 0.3);
  assert.ok(side > 3 * up, `boki ${side}, pion ${up}`);
  // przekrój okrągły (bez widenLat): zależy tylko od aH² + aV²
  assert.ok(Math.abs(L.hallGas3dConeProfileCpu(10, 3, 1, Lc, w0, 0.1) - L.hallGas3dConeProfileCpu(10, 1, 3, Lc, w0, 0.1)) < 1e-12);
  assert.equal(L.hallGas3dConeProfileCpu(-w0 - 0.01, 0, 0, Lc, w0, 0.1), 0);
  assert.equal(L.hallGas3dConeProfileCpu(Lc, 0, 0, Lc, w0, 0.1), 0);
  // prędkość na osi: rdzeń potencjalny (pełna), dalej ∝ rdzeń / x, nie mniej niż 0,2; stożek źródeł hali ∝ w0 / szerokość
  assert.equal(L.hallGas3dConeSpeedCpu(1000, 1, 1, 5, 10), 1000);
  assert.equal(L.hallGas3dConeSpeedCpu(1000, 1, 1, 20, 10), 500);
  assert.equal(L.hallGas3dConeSpeedCpu(1000, 1, 1, 1000, 10), 200);
  assert.equal(L.hallGas3dConeSpeedCpu(1000, 2, 4, 0, 0), 500);
  assert.equal(L.hallGas3dConeSpeedCpu(1000, 1, 10, 0, 0), 250);
});

// Źródło objętości w komórce (lustro kernela reakcji: przekrój jak profil pędu, waga wzdłuż osi) z rekordu stożka.
function sourceAt(J, n, px, py, pz) {
  const R = L.HALL_GAS3D_JET;
  const b = n * R.stride;
  const rel = [px - J[b + R.A], py - J[b + R.A + 1], pz - J[b + R.A + 2]];
  const B = [J[b + R.B], J[b + R.B + 1], J[b + R.B + 2]];
  const along = rel[0] * B[0] + rel[1] * B[1] + rel[2] * B[2];
  const across2 = Math.max(rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2] - along * along, 0);
  const nv = [-B[0] * B[2], -B[1] * B[2], 1 - B[2] * B[2]];
  const lv = Math.hypot(nv[0], nv[1], nv[2]);
  const av = lv > 0.2 ? (rel[0] * nv[0] + rel[1] * nv[1] + rel[2] * nv[2]) / lv : 0;
  const prof = L.hallGas3dConeProfileCpu(along, Math.max(across2 - av * av, 0), av * av, J[b + R.B + 3], J[b + R.C], J[b + R.C + 1], J[b + R.MIN + 3]);
  return J[b + R.D] * prof * L.hallGas3dSourceAlongCpu(along, J[b + R.D + 1]);
}

test('źródło objętości: cel dywergencji zsumowany po komórkach siatki = wydatek strumienia (przekrój eliptyczny, oś skośna)', () => {
  const J = new Float32Array(L.HALL_GAS3D_JET.stride);
  for (const o of [
    { x: -800, z: 3200, y: 380, dx: 1, dz: 0.4, dy: 0, len: 1800, w0: 70, widen: 0.05, widenLat: 0.3, speed: 2600, rate: 16, flow: 2.1e8, srcLen: 600, core: 400, exhaust: 1 },
    { x: 600, z: 2500, y: 360, dx: -0.3, dz: 1, dy: 0.2, len: 900, w0: 90, widen: 0.2, speed: 400, rate: 6, flow: 3e7, srcLen: 450 }
  ]) {
    assert.equal(L.hallGas3dWriteCone(J, 0, DOM, o), 1);
    const R = L.HALL_GAS3D_JET;
    let sum = 0;
    for (let k = Math.max(0, Math.floor(J[R.MIN + 2])); k <= Math.min(DOM.nh - 1, Math.ceil(J[R.MAX + 2])); k++) {
      for (let j = Math.max(0, Math.floor(J[R.MIN + 1])); j <= Math.min(DOM.nd - 1, Math.ceil(J[R.MAX + 1])); j++) {
        for (let i = Math.max(0, Math.floor(J[R.MIN])); i <= Math.min(DOM.nx - 1, Math.ceil(J[R.MAX])); i++) sum += sourceAt(J, 0, i + 0.5, j + 0.5, k + 0.5);
      }
    }
    const want = o.flow / (DOM.h * DOM.h * DOM.h);
    assert.ok(Math.abs(sum - want) / want < 0.03, `suma ${sum.toFixed(2)} vs wydatek ${want.toFixed(2)} kom.³/s`);
  }
});

test('rzut ciśnienia (lustra kerneli): po zbieżnym Jacobim dywergencja ŚCIANOWA = cel (Rhie–Chow), pokład bez przenikania, strop otwarty', () => {
  const nx = 8, ny = 6, nz = 5, N = nx * ny * nz;
  const id = (i, j, k) => (k * ny + j) * nx + i;
  const v = Array.from({ length: N }, (_, c) => [Math.sin(c * 1.3) * 2, Math.cos(c * 0.7) * 1.5, Math.sin(c * 0.31)]);
  const S = new Float64Array(N);
  S[id(3, 2, 1)] = 2;
  S[id(4, 3, 2)] = 1;
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const codeOf = (i, j, k, d) => {
    const ii = i + d[0], jj = j + d[1], kk = k + d[2];
    if (kk < 0) return 1;                 // pokład
    if (kk >= nz) return 2;               // strop otwarty
    if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) return 1;
    return 0;
  };
  const cells = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push([i, j, k]);
  const rhs = new Float64Array(N);
  for (const [i, j, k] of cells) {
    const c = id(i, j, k);
    let D = 0;
    NB.forEach((d, q) => {
      const a = q >> 1, cd = codeOf(i, j, k, d);
      const vn = cd === 0 ? v[id(i + d[0], j + d[1], k + d[2])][a] : 0;
      const F = L.hallGas3dFacePriorCpu(v[c][a], vn, cd, 0);
      D += q % 2 === 0 ? F : -F;
    });
    rhs[c] = D - S[c];
  }
  let p = new Float64Array(N);
  const nb = new Array(6), codes = new Array(6);
  for (let it = 0; it < 6000; it++) {
    const q2 = new Float64Array(N);
    for (const [i, j, k] of cells) {
      const c = id(i, j, k);
      NB.forEach((d, q) => { codes[q] = codeOf(i, j, k, d); nb[q] = codes[q] === 0 ? p[id(i + d[0], j + d[1], k + d[2])] : 0; });
      q2[c] = L.hallGas3dJacobiCellCpu(p[c], nb, codes, rhs[c], false);
    }
    p = q2;
  }
  // ściany po rzucie (+x, +y, +z każdej komórki; −: ściana sąsiada albo przeszkoda / pokład) → Σ(F₊ − F₋) = S
  const face = (i, j, k, a) => {
    const d = NB[a * 2];
    const cd = codeOf(i, j, k, d);
    const c = id(i, j, k);
    if (cd === 0) { const n = id(i + d[0], j + d[1], k + d[2]); return L.hallGas3dFaceCpu(v[c][a], v[n][a], p[c], p[n], 0, 0); }
    return L.hallGas3dFaceCpu(v[c][a], 0, p[c], 0, cd, 0);
  };
  let worst = 0;
  for (const [i, j, k] of cells) {
    let div = 0;
    for (let a = 0; a < 3; a++) {
      div += face(i, j, k, a);
      const d = NB[a * 2 + 1];
      div -= codeOf(i, j, k, d) === 0 ? face(i + d[0], j + d[1], k + d[2], a) : 0;
    }
    worst = Math.max(worst, Math.abs(div - S[id(i, j, k)]));
  }
  assert.ok(worst < 1e-6, `|Σ ścian − cel| = ${worst}`);
});

test('rzut prędkości komórki (lustro): v − ∇p / 2 (różnica centralna), Neumann przy bryle, 0 za brzegiem otwartym, sufit prędkości', () => {
  const out = [0, 0, 0];
  L.hallGas3dProjectCellCpu([1, 0, 0], 0, [1, -1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], 100, out);
  assert.ok(Math.abs(out[0]) < 1e-12);
  L.hallGas3dProjectCellCpu([0, 0, 5], 2, [0, 0, 0, 0, 9, 9], [0, 0, 0, 0, 1, 2], 100, out);
  assert.equal(out[2], 4);
  L.hallGas3dProjectCellCpu([300, 400, 0], 0, [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], 50, out);
  assert.ok(Math.abs(Math.hypot(out[0], out[1], out[2]) - 50) < 1e-9);
});

test('filtr biharmoniczny przy ścianach (lustro): odbicie — składowa normalna 2·v_s − v, styczne bez zmian (filtr bez tarcia ściany)', () => {
  assert.deepEqual(L.hallGas3dFilterNbCpu([9, 9, 0], true, [5, 3, 2], 2), [5, 3, -2]);
  assert.deepEqual(L.hallGas3dFilterNbCpu([1, 0, 0], true, [5, 3, 2], 0), [-3, 3, 2]);
  assert.deepEqual(L.hallGas3dFilterNbCpu([7, 8, 9], false, [5, 3, 2], 1), [7, 8, 9]);
  // jednorodny przepływ wzdłuż pokładu: laplasjan filtra w warstwie 0 = 0 (bez poślizgu byłby −v — tarcie)
  const v0 = [4, -2, 0];
  const n = [[4, -2, 0], [4, -2, 0], [4, -2, 0], [4, -2, 0], [4, -2, 0]];
  const deck = L.hallGas3dFilterNbCpu([0, 0, 0], true, v0, 2);
  const lap = [0, 1, 2].map((a) => n.reduce((s, q) => s + q[a], 0) + deck[a] - 6 * v0[a]);
  assert.deepEqual(lap, [0, 0, 0]);
});

test('pokład ↔ warstwa 0 (lustro kernela): masa dokładnie zachowana, opadanie do sufitu 1, podrywanie strumieniem do wyczerpania, nie poza halą', () => {
  const h = DOM.h, dt = 1 / 120;
  for (const [D, c0, sp, ins] of [[0.3, 0.2, 0, 1], [0.3, 0.2, 2000, 1], [0.999, 5, 0, 1], [0.001, 0, 3000, 1], [0.5, 0.1, 3000, 0]]) {
    const r = L.hallGas3dDeckExchangeCpu(D, c0, sp, ins, T, h, dt);
    assert.ok(Math.abs(T.deckMass * (r.D - D) + r.e) < 1e-12, `masa D=${D}`);
    assert.ok(r.D <= 1 + 1e-12 && r.D >= -1e-12);
  }
  const a = L.hallGas3dDeckExchangeCpu(0.8, 0, 5000, 1, T, h, dt);
  const b = L.hallGas3dDeckExchangeCpu(0.3, 0, 5000, 1, T, h, dt);
  assert.ok(Math.abs((0.8 - a.D) - T.liftRate * dt) < 1e-12, 'pełne podrywanie = liftRate · dt');
  assert.ok(Math.abs((0.8 - a.D) - (0.3 - b.D)) < 1e-12, 'strumień niezależny od depozytu');
  assert.equal(L.hallGas3dDeckExchangeCpu(0.5, 0, 5000, 0, T, h, dt).D, 0.5, 'próżnia: bez podrywania');
  assert.equal(L.hallGas3dDeckExchangeCpu(0.5, 0, T.liftLo - 1, 1, T, h, dt).D, 0.5, 'poniżej progu: bez podrywania');
  assert.ok(L.hallGas3dSettleCpu(5000, T, h, dt) > 0, 'opadanie nigdy 0');
  assert.ok(L.hallGas3dSettleCpu(0, T, h, dt) <= 0.5);
});

test('szczelina pod kadłubem: obwód / pole obrysu w rozdzielczości siatki, źródło = edgePush · |v| · obwód / pole (sufit), cel wleczenia ½·v', () => {
  const IN = new Float64Array(HALL_DUST_IN.size);
  const b = HALL_DUST_IN.header;
  IN[b + HALL_DUST_SHIP.tx] = 28;
  IN[b + HALL_DUST_SHIP.ty] = 28;
  for (let j = 6; j < 26; j++) {
    for (let i = 12; i < 52; i++) {
      const k = j * HALL_DUST_MASK.w + i;
      IN[b + HALL_DUST_SHIP.mask + (k >>> 5)] += 2 ** (k & 31);
    }
  }
  const pr = L.hallGas3dMaskPerimeterRatio(IN, 0, 56);
  const want = 2 * (1120 + 560) / (1120 * 560);
  assert.ok(Math.abs(pr - want) / want < 1e-9, `${pr} vs ${want}`);
  assert.ok(Math.abs(L.hallGas3dGapSourceCpu(pr, 300, 0, T) - T.edgePush * 300 * want) < 1e-9);
  assert.equal(L.hallGas3dGapSourceCpu(1, 1e5, 0, T), T.gapSourceMax);
  assert.equal(L.hallGas3dMaskPerimeterRatio(new Float64Array(HALL_DUST_IN.size), 0, 56), 0);
  const g = L.hallGas3dGapFlowCpu([2, 0], [1, 0], 0.5, 1.6, { gapLead: 0 });
  assert.deepEqual(g, [1, 0, 2.6]);
  const lead = L.hallGas3dGapFlowCpu([2, 0], [1, 0], 1, 1, { gapLead: 0.5 });
  const trail = L.hallGas3dGapFlowCpu([2, 0], [1, 0], -1, 1, { gapLead: 0.5 });
  assert.ok(lead[2] > trail[2], 'krawędź natarcia — więcej');
  // zajętość: max(statyka, dach × (1 − otwarcie), płyta kadłuba); udział warstwy w płycie 48–116
  assert.equal(L.hallGas3dOccCpu(0.2, 1, 0.5, 0, 1, 0.14), 0.5);
  assert.equal(L.hallGas3dOccCpu(0.2, 1, 0.5, 1, 1, 0.14), 0.2);
  assert.ok(Math.abs(L.hallGas3dLayerOverlapCpu(0, 56, 48, 116) - 8 / 56) < 1e-12);
  assert.equal(L.hallGas3dLayerOverlapCpu(1, 56, 48, 116), 1);
  assert.ok(Math.abs(L.hallGas3dLayerOverlapCpu(2, 56, 48, 116) - 4 / 56) < 1e-12);
});

test('obraz: przepuszczalność kolumny (lustro marszu) = exp(−Σ σ · droga)', () => {
  const look = createHallGas3dLook();
  const t = hallGas3dTransmittanceCpu([{ dust: 1, vapor: 0, exhaust: 0, len: 2 }, { dust: 0, vapor: 0.5, exhaust: 2, len: 1 }], look);
  assert.ok(Math.abs(t - Math.exp(-(2 * look.densDust + 0.5 * look.densVapor + 2 * look.densExhaust))) < 1e-12);
});

test('wejście klatki 3D: nadzbiór wejścia pyłu 2D (te same pola) + blok dachu i wersja; bez dachu — zamknięty', () => {
  assert.equal(L.HALL_GAS3D_IN.size, HALL_DUST_IN.size + 7);
  const a = createHallGas3dInput();
  assert.equal(a.length, L.HALL_GAS3D_IN.size);
  const o = { dt: 1 / 60, camX: 0, camY: 0, viewHalf: 5000 };
  packHallGas3dFrame(a, o);
  const ref = packHallDustFrame(new Float64Array(HALL_DUST_IN.size), o);
  for (let k = 0; k < HALL_DUST_IN.size; k++) if (k !== HALL_DUST_IN.serial) assert.equal(a[k], ref[k], `pole ${k}`);
  const I = L.HALL_GAS3D_IN;
  assert.equal(a[I.version], L.HALL_GAS3D_IN_VERSION);
  assert.equal(a[I.roofOpen], 0);
  assert.equal(a[I.roofView], 0);
  packHallGas3dFrame(a, { ...o, roof: { open: 1.7, x0: -300, z0: 900, x1: 300, z1: 1800, view: 0.4 } });
  assert.equal(a[I.roofOpen], 1);
  assert.equal(a[I.roofX0], -300);
  assert.equal(a[I.roofZ1], 1800);
  assert.equal(a[I.roofView], 0.4);
});

// --- WGSL w Node (bez GPU)
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const GRID = new HallGas3dGrid({ domain: DOM, stat: RASTER.data, deckStart: DECK, noise3D: fxNoise.noise3D() });

test('kernele siatki: WGSL buduje się, ≤ 4 tekstury storage, ≤ 8 buforów storage, ≤ 12 buforów uniformów; żaden kernel nie czyta i nie pisze tej samej tekstury', () => {
  const kernels = GRID.kernels();
  assert.ok(kernels.length >= 10);
  for (const k of kernels) {
    const b = renderer.backend.createNodeBuilder(k, renderer);
    b.build();
    const w = b.computeShader;
    const storageTex = (w.match(/texture_storage_/g) || []).length;
    const storageBuf = (w.match(/var<storage/g) || []).length;
    const uniformBuf = (w.match(/var<uniform>/g) || []).length;
    assert.ok(storageTex <= 4, `${k.name}: ${storageTex} tekstur storage`);
    assert.ok(storageBuf <= 8, `${k.name}: ${storageBuf} buforów storage`);
    assert.ok(uniformBuf <= 12, `${k.name}: ${uniformBuf} buforów uniformów`);
    const written = new Set(), read = new Set();
    for (const g of b.getBindings()) for (const x of g.bindings || []) if (x.texture) (x.store ? written : read).add(x.texture);
    assert.ok(written.size > 0 || storageBuf > 0, `${k.name}: kernel nic nie pisze`);
    for (const t of written) assert.ok(!read.has(t), `${k.name}: ${t.name} czytana i pisana w jednym kernelu`);
  }
});

test('siatka: pamięć w budżecie § 11 (≤ 80 MB), strojenie w jednostkach świata przeliczone na komórki', () => {
  assert.ok(GRID.memoryBytes <= 80e6, `${(GRID.memoryBytes / 1e6).toFixed(1)} MB`);
  assert.ok(Math.abs(GRID.U.liftLo.value - T.liftLo / DOM.h) < 1e-9);
  assert.ok(Math.abs(GRID.U.turbulence.value - T.turbulence / DOM.h) < 1e-9);
  assert.equal(GRID.U.wallCd.value, T.wallCd);
});

test('obraz: bryły back / front budują się (WGSL), macierz bryły ma wyznacznik > 0 przy obu orientacjach hali (pułapka 37)', () => {
  const vol = new HallGas3dVolume({ grid: GRID });
  for (const mesh of [vol.meshes.back, vol.meshes.front]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.OrthographicCamera();
    b.context.material = mesh.material;
    b.build();
    assert.ok(b.fragmentShader.length > 1000, mesh.name);
  }
  const c = Math.cos(0.7), s = Math.sin(0.7);
  for (const aff of [
    { p0x: 6e6, p0y: -2e6, ax: 1, ay: 0, bx: 0, by: 1 },
    { p0x: 6e6, p0y: -2e6, ax: 1, ay: 0, bx: 0, by: -1 },
    { p0x: -3e6, p0y: 5e6, ax: c, ay: s, bx: -s, by: c },
    { p0x: -3e6, p0y: 5e6, ax: c, ay: s, bx: s, by: -c }
  ]) {
    vol.place(aff);
    for (const mesh of [vol.meshes.back, vol.meshes.front]) assert.ok(mesh.matrix.determinant() > 0, `${mesh.name} ${JSON.stringify(aff)}`);
  }
});

test('szew gra ↔ render: src/3d/hallGas3d bez window / document / requestIdleCallback i bez Math.random (wejście z tablicy klatki)', () => {
  const files = readdirSync('src/3d/hallGas3d').filter((f) => f.endsWith('.js')).map((f) => `src/3d/hallGas3d/${f}`);
  files.push('src/game/hallGas3dInput.js');
  for (const f of files) {
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const re of [/\bwindow\./, /\bdocument\./, /requestIdleCallback/, /Math\.random/]) assert.ok(!re.test(code), `${f}: ${re}`);
  }
  assert.ok(!/from 'three/.test(readFileSync('src/game/hallGas3dInput.js', 'utf8')), 'wejście klatki bez three');
});
