// Strumienie regionu pod kamerą (src/3d/planetGen/planetGenRegion.js): plan regionu na stałej kracie, ujścia
// (rzeki planety, brzeg regionu), spływ lokalny, wpięcie w graf pola i wypiekacz.
// node --test tests/planetGenRegion.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REGION_SIZE, REGION_SNAP, REGION_BORDER, REGION_FIT, REGION_CELL_KM, regionCellAngle, planRegion, regionCovers,
  regionSinkHeights, regionDrainage
} from '../src/3d/planetGen/planetGenRegion.js';
import { drainReceiver, drainFlowDecode } from '../src/3d/planetGen/planetGenDrainage.js';

const src = (f) => readFileSync(new URL(`../src/3d/planetGen/${f}`, import.meta.url), 'utf8');

test('komórka regionu: teksel mapy planety / 2^k, najbliżej 0,5 km', () => {
  const rKm = 5540;
  for (const gw of [2048, 4096, 8192]) {
    const c = regionCellAngle(gw, rKm);
    const stG = 2 * Math.PI / gw;
    const k = Math.log2(stG / c);
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `mapa ${gw}: potęga dwójki`);
    const km = c * rKm;
    assert.ok(km > REGION_CELL_KM * 0.7 && km < REGION_CELL_KM * 1.42, `mapa ${gw}: komórka ${km.toFixed(3)} km`);
  }
  // ta sama komórka dla map 4096 i 8192 (siatki strumieni zgodne między rozdzielczościami mapy)
  assert.ok(Math.abs(regionCellAngle(4096, rKm) - regionCellAngle(8192, rKm)) < 1e-12);
});

test('plan regionu: okno musi się mieścić, początek na stałej kracie, mały ruch okna nie zmienia regionu', () => {
  const cell = regionCellAngle(4096, 5540);
  const W = 6144;
  const H = 3072;
  // poziom za płytki: okno szersze niż region
  assert.equal(planRegion({ frame: 2, a0: 0.1, b0: 0.05, st: cell * 2 }, { width: W, height: H, cell }), null);
  const st = cell * REGION_SIZE * REGION_FIT / W * 0.9;
  // (okno ze środkiem dokładnie w środku regionu o początku na kracie — ruch o kilka komórek nie przekracza połowy kroku kraty)
  const win = { frame: 2, a0: (14 * REGION_SNAP + REGION_SIZE / 2) * cell - W * st / 2, b0: (3 * REGION_SNAP + REGION_SIZE / 2) * cell - H * st / 2, st };
  const p = planRegion(win, { width: W, height: H, cell });
  assert.ok(p);
  assert.equal(p.frame, 2);
  assert.equal(p.ox % REGION_SNAP, 0);
  assert.equal(p.oy % REGION_SNAP, 0);
  assert.ok(Math.abs(p.a0 - p.ox * cell) < 1e-12 && Math.abs(p.b0 - p.oy * cell) < 1e-12);
  // środek okna blisko środka regionu (w granicach kroku kraty)
  const ca = win.a0 + W * st / 2;
  assert.ok(Math.abs(ca - (p.a0 + REGION_SIZE * cell / 2)) <= REGION_SNAP * cell / 2 + 1e-12);
  // okno przesunięte o kilka komórek: ten sam region (ten sam klucz)
  const p2 = planRegion({ ...win, a0: win.a0 + 5 * cell, b0: win.b0 - 7 * cell }, { width: W, height: H, cell });
  assert.equal(p2.key, p.key);
  // głębsze okno w środku regionu jest pokryte; inna ściana albo okno przy krawędzi — nie
  const deep = { frame: 2, a0: p.a0 + 300 * cell, b0: p.b0 + 400 * cell, st: st / 4 };
  assert.equal(regionCovers(p, deep, W, H), true);
  assert.equal(regionCovers(p, { ...deep, frame: 3 }, W, H), false);
  assert.equal(regionCovers(p, { ...deep, a0: p.a0 + 10 * cell }, W, H), false);
  assert.equal(regionCovers(null, deep, W, H), false);
});

test('ujścia regionu: morze, rzeki planety i brzeg siatki; strumienie spływają do nich i tam się kończą', () => {
  const N = 96;
  const px = new Float32Array(N * N * 4);
  // teren: pochyła równina z falami; rzeka planety — pionowy pas wody w kolumnach 46–48; morze w rogu
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      px[o] = 0.2 + Math.abs(x - 47) * 0.004 + Math.sin(x * 0.7) * Math.cos(y * 0.5) * 0.003 + y * 0.0003;
      px[o + 1] = x >= 46 && x <= 48 ? 0.8 : -0.1;      // y > 0: woda; y < 0: wilgotność doliny (nie woda)
      if (x > 80 && y > 80) px[o] = -0.5;
    }
  }
  const h = regionSinkHeights(px, N);
  const at = (x, y) => h[y * N + x];
  assert.equal(at(47, 40), -1, 'rzeka planety jest ujściem');
  assert.equal(at(90, 90), -1, 'morze jest ujściem');
  assert.equal(at(0, 50), -1);
  assert.equal(at(REGION_BORDER - 1, 50), -1);
  assert.equal(at(N - 1, 50), -1, 'brzeg siatki jest ujściem');
  assert.ok(at(20, 40) > 0 && at(70, 40) > 0, 'ląd zostaje lądem');
  const d = regionDrainage(h, N, 5);
  assert.equal(d.width, N);
  assert.ok(d.stats.land > N * N * 0.7);
  let any = 0;
  for (let i = 0; i < N * N; i++) any += d.data[i * 4 + 3];
  assert.equal(any, 0, 'siatka regionu nie ma smug osadu');
  // każda komórka lądu ma odbiorcę, a idąc w dół dochodzi do ujścia (bez pętli); nikt nie przechodzi PRZEZ rzekę
  const land = (x, y) => d.data[(y * N + x) * 4] !== 0 || d.data[(y * N + x) * 4 + 1] !== 0;
  let toRiver = 0;
  for (let y = 4; y < N - 4; y += 3) {
    for (let x = 4; x < N - 4; x += 3) {
      if (!land(x, y)) continue;
      let cx = x;
      let cy = y;
      const side = Math.sign(x - 47);
      let steps = 0;
      for (; steps < N * 4; steps++) {
        const r = drainReceiver(d, cx, cy);
        assert.ok(r, `komórka lądu (${cx}, ${cy}) ma odbiorcę`);
        if (!land(r.x, r.y)) { if (r.x >= 46 && r.x <= 48) toRiver++; break; }
        assert.equal(Math.sign(r.x - 47), side, 'strumień nie przechodzi na drugi brzeg rzeki planety');
        cx = r.x; cy = r.y;
      }
      assert.ok(steps < N * 4, 'spływ kończy się w ujściu');
    }
  }
  assert.ok(toRiver > 100, `do rzeki planety spływa ${toRiver} próbek`);
  // przepływ rośnie ku rzece: przy rzece są cieki większe niż próg widoczności (14 komórek)
  let big = 0;
  for (let y = 4; y < N - 4; y++) for (const x of [45, 49]) if (land(x, y) && drainFlowDecode(d.data[(y * N + x) * 4 + 1]) >= 14) big++;
  assert.ok(big >= 3, `cieki przy rzece: ${big}`);
});

test('wpięcie: graf pola rysuje siatkę regionu tym samym riverNet, wypiekacz podaje ją tylko oknu tej samej ściany', () => {
  const solid = src('planetGenSolid.tsl.js');
  assert.match(solid, /function riverNet\(D, U, gp, cosL, stC, flatK, hash = null\)/);
  assert.match(solid, /riverNet\(D2, \{ uDr: U\.uDr2 \}, g2\.add\(warp2\), float\(1\.0\), stC2, flatK, \{ ox: int\(U\.uRg2\.x\), oy: int\(U\.uRg2\.y\) \}\)/);
  // tylko w oknie pod kamerą, z gaśnięciem przy brzegu siatki; dzielenie przez kąt komórki zabezpieczone
  assert.match(solid, /If\(U\.uDr2\.z\.greaterThan\(0\.5\)\.and\(U\.uWin\.w\.greaterThan\(0\.5\)\)/);
  assert.match(solid, /const rc = max\(U\.uRg\.z, 1e-9\)\.toVar\(\)/);
  assert.match(solid, /const inR = smoothstep\(8\.0, 40\.0, edgeD\)\.toVar\(\)/);
  const baker = src('planetGenBaker.js');
  assert.match(baker, /rg\.axes !== win\.frame\) return \{ uDr2: \[1, 1, 0, 0\], uRg: \[0, 0, 1, 0\], uRg2: \[0, 0, 0, 0\] \}/);
  assert.match(baker, /readRegionField\(base, region\)/);
  assert.equal((baker.match(/\.\.\.this\._regionU\(spec\.type, base, win\)/g) || []).length, 2, 'oba wypieki okna (cały i w pasach)');
  const region = src('planetGenRegion.js');
  // liczenie nie startuje w trakcie wypieku okna, a po policzeniu okno piecze się od nowa
  assert.match(region, /!cur \|\| this\.pending \|\| P\.job\) return/);
  assert.match(region, /this\.patches\.refresh\(\)/);
  assert.match(src('planetGenRegion.worker.js'), /wrapX: false, rowWeight: false, plumes: false/);
});
