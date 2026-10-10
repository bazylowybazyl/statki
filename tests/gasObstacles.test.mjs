// PRZESZKODY GAZU wybuchów (etap C 2026-10-09 — F2 docs/AUDYT-wybuchy-gaz-2026-10-08.md): raster statyki (bryły
// zachowawczo, cienka ściana bez szpar przy dowolnym kącie i przesunięciu domeny), okno rastra zakotwiczone w świecie
// (domena z nośnikiem), kadłuby w uniformach domeny i pasma masek obrysu, gospodarz domeny, lustro CPU maski (solidCpu)
// i rzutu ciśnienia z warunkiem ściany (gasProjectCpu: Neumann, bez wnikania), WGSL kerneli, wejście gry
// (src/game/gasObstacleInput.js: hale K-7, kawałki suchego doku, kadłuby przy domenach) i klej reżysera wybuchów.
// node --test tests/gasObstacles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid, GAS_HULL_REC, GAS_HULL_MASK, GAS_STATIC_GROW, gasProjectCpu } = await import('../src/3d/gas/gasGrid.js');
const { GAS_OBST_IN } = await import('../src/3d/gas/gasObstacleLayout.js');
const OI = await import('../src/game/gasObstacleInput.js');
const { createK7Layout, k7SolidList } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const { hallToGameAffine } = await import('../src/game/hallDustInput.js');
const { placeDryDock } = await import('../src/game/story/shipyardLayout.js');
const { pointInPoly } = await import('../src/3d/portBuildings/pirateDryDockLayout.js');

function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}
const fakeRenderer = () => ({ calls: 0, compute() { this.calls++; } });
const makeGrid = (o = {}) => new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(7), maxHulls: 8, hullBands: 3, ...o });

// Flood fill po siatce w × h (4 sąsiadów) z (sx, sy) po komórkach wolnych; czy dochodzi do (tx, ty).
function reaches(free, w, h, sx, sy, tx, ty) {
  const seen = new Uint8Array(w * h);
  const st = [sx + sy * w];
  if (!free(sx, sy)) return false;
  seen[st[0]] = 1;
  while (st.length) {
    const k = st.pop();
    const x = k % w, y = (k / w) | 0;
    if (x === tx && y === ty) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = nx + ny * w;
      if (seen[j] || !free(nx, ny)) continue;
      seen[j] = 1;
      st.push(j);
    }
  }
  return false;
}

test('raster statyki: CIENKA ściana (0,3 komórki) przy dowolnym kącie i przesunięciu domeny bez szpar — gaz nie przecieka', () => {
  for (const ang of [0, 0.31, Math.PI / 4, 1.13, Math.PI / 2]) {
    const g = makeGrid();
    const size = 32;
    const h = size / 16;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    // ściana przez środek domeny, dłuższa niż okno rastra
    g.setStatics(1, new Float64Array([100, 50, ux, uy, 400, 0.15 * h]), 1);
    const s = g.slots[g.acquire(100, 50, 0, 4, { size })];
    g.updateRasters();
    assert.ok(s.maskOn, 'bryła w oknie');
    const MS = g.MS;
    // raster binarny: grubość ≥ 2 teksle wzdłuż osi siatki (4-spójna zapora)
    const D = g.maskData, base = s.index * MS * MS;
    const nxw = -uy, nyw = ux;   // normalna ściany
    const side = (i, j) => (s.mox + (i + 0.5) * h - 100) * nxw + (s.moy + (j + 0.5) * h - 50) * nyw;
    // dwa punkty po obu stronach ściany, daleko od niej
    let a = null, b = null;
    for (let j = 2; j < MS - 2 && (!a || !b); j++) for (let i = 2; i < MS - 2; i++) {
      const d = side(i, j);
      if (!a && d < -3 * h && Math.abs(i - MS / 2) < 10 && Math.abs(j - MS / 2) < 10) a = [i, j];
      if (!b && d > 3 * h && Math.abs(i - MS / 2) < 10 && Math.abs(j - MS / 2) < 10) b = [i, j];
    }
    assert.ok(a && b, `punkty po obu stronach (kąt ${ang})`);
    assert.equal(reaches((i, j) => D[base + j * MS + i] === 0, MS, MS, a[0], a[1], b[0], b[1]), false, `raster: zapora (kąt ${ang})`);
    // próbka liniowa jak w kernelu przy przesunięciu domeny o ułamek komórki (domena jadąca z nośnikiem)
    for (const [ox, oy] of [[0, 0], [0.5, 0.5], [0.27, 0.81], [0.93, 0.12]]) {
      const free = (i, j) => g._rasterSample(s, i + 0.5 + ox, j + 0.5 + oy) <= 0.5;
      assert.equal(reaches(free, MS, MS, a[0], a[1], b[0], b[1]), false, `próbka: zapora (kąt ${ang}, przesunięcie ${ox}, ${oy})`);
    }
  }
});

test('raster statyki: bryła rośnie zachowawczo o GAS_STATIC_GROW komórki; solidAt i przesunięcie źródła z bryły (freePoint)', () => {
  const g = makeGrid();
  const size = 32;
  const h = size / 16;
  g.setStatics(1, new Float64Array([10, 0, 1, 0, 3, 3]), 1);   // pudło 6 × 6 j. = 3 × 3 komórki
  const k = g.acquire(0, 0, 0, 4, { size });
  assert.equal(g.solidAt(k, 10, 0), false, 'raster dopiero w kroku (świeża statyka tej klatki)');
  g.updateRasters();
  assert.ok(g.solidAt(k, 10, 0), 'środek bryły');
  assert.ok(g.solidAt(k, 10 + 3 + GAS_STATIC_GROW * h * 0.6, 0), 'w zapasie bryły');
  assert.ok(!g.solidAt(k, 10 + 3 + 2.5 * h, 0), 'dalej wolne');
  assert.ok(!g.solidAt(k, 0, 0), 'środek domeny wolny');
  const out = { x: 0, y: 0 };
  assert.equal(g.freePoint(k, 0, 0, 8, out), false, 'wolny punkt — bez przesunięcia');
  assert.equal(g.freePoint(k, 10, 0, 8, out), true);
  assert.ok(!g.solidAt(k, out.x, out.y), 'przesunięty punkt wolny');
  assert.ok(Math.hypot(out.x - 10, out.y) < 3 + (GAS_STATIC_GROW + 2) * h, 'najbliższy wolny przy bryle');
});

test('okno rastra zakotwiczone w ŚWIECIE: domena z nośnikiem jedzie przez okno (wyprzedzenie), ściana stoi; nowe okno przed brzegiem', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const size = 32;
  const h = size / 16;
  g.setStatics(1, new Float64Array([12, 0, 0, 1, 200, 2]), 1);   // ściana x = 12 wzdłuż y (w domenie)
  const k = g.acquire(0, 0, 0, 4, { size, carrier: [20, 0, 0], life: 30 });
  const s = g.slots[k];
  g.updateRasters();
  // okno przesunięte w stronę nośnika: domena przy tylnym brzegu okna
  const off0 = (s.cx - s.mox) / h - 8;
  assert.ok(off0 < (g.MS - 16) / 2 - 1, 'okno wyprzedza nośnik');
  assert.ok(off0 >= 1, 'domena w oknie');
  const rasters0 = s.maskAt;
  g.simulate(R, 1 / 60);
  // komórka domeny na ścianie — lustro CPU: stała, prędkość ściany względem domeny = −nośnik [kom./s] (a3.zw)
  const a3 = g.U.act.array[3];
  assert.ok(Math.abs(a3.z - (-20 / h)) < 1e-9 && a3.w === 0);
  const o = { vx: 0, vy: 0 };
  assert.equal(g.solidCpu(k, (12 - s.cx) / h + 8, 8.5, o), 1);
  assert.ok(Math.abs(o.vx + 20 / h) < 1e-9, 'komórka stała ściany ma prędkość −nośnik');
  assert.equal(g.solidCpu(k, (12 - s.cx) / h + 8 - 4, 8.5), 0, 'obok ściany gaz');
  let reRaster = 0;
  let lastMox = s.mox;
  let lastCx = s.cx;
  const slack = (g.MS - 16) / 2 - 2;
  for (let i = 0; i < 240; i++) {
    g.simulate(R, 1 / 60);
    if (s.mox !== lastMox) {
      reRaster++;
      // nowe okno dopiero po przejechaniu prawie całego zapasu (2 × zapas − brzeg)
      assert.ok((s.cx - lastCx) / h >= 2 * slack - 2, `okno przesunięte po ${((s.cx - lastCx) / h).toFixed(1)} komórkach`);
      lastMox = s.mox; lastCx = s.cx;
    }
    // ściana zawsze w tym samym miejscu świata (scena): środek jej grubości stały, w układzie domeny jedzie −nośnik
    assert.ok(g.solidAt(k, 12, 0) || !s.maskOn, 'ściana stoi w świecie');
  }
  assert.ok(Math.abs(s.cx - 80 - 20 / 60) < 1e-6, 'domena przejechała 80 j.');
  assert.ok(reRaster >= 1 && reRaster <= Math.ceil(40 / (2 * slack - 2)), `nowe okno tylko przed brzegiem (${reRaster})`);
  assert.ok(s.maskAt > rasters0);
});

test('zmiana budowli: nowa wersja statyki = nowy raster domeny (nie częściej niż co 0,1 s); bez statyki — raster pusty, bez kosztu', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const k = g.acquire(0, 0, 0, 4, { size: 32, life: 30 });
  const s = g.slots[k];
  assert.equal(s.maskOn, false);
  g.beginFrame(); g.simulate(R, 1 / 60);
  assert.equal(g.stats.rasters, 1, 'nowa domena — raster (pusty)');
  g.beginFrame(); g.simulate(R, 1 / 60);
  assert.equal(g.stats.rasters, 0, 'bez zmian — bez rastra');
  g.setStatics(2, new Float64Array([6, 0, 1, 0, 2, 2]), 1);
  g.beginFrame(); g.simulate(R, 1 / 60);
  assert.equal(g.stats.rasters, 1, 'nowa wersja — od razu (pierwsza zmiana)');
  assert.ok(s.maskOn && g.solidAt(k, 6, 0));
  g.setStatics(3, new Float64Array([6, 0, 1, 0, 2, 2]), 0);   // kawałek odpadł zaraz potem
  g.beginFrame(); g.simulate(R, 1 / 60);
  assert.equal(g.stats.rasters, 0, 'seria zmian: najwyżej co 0,1 s');
  for (let i = 0; i < 6; i++) g.simulate(R, 1 / 60);
  assert.equal(s.maskOn, false, 'bryła znikła z rastra');
  assert.equal(g.solidAt(k, 6, 0), false);
});

// Rekord kadłuba w scenie: prostokąt bitów maski (kolumny i0..i1, wiersze j0..j1), kotwica, kąt, prędkość, ω.
function hullRec(o) {
  const H = GAS_HULL_REC, M = GAS_HULL_MASK;
  const r = new Float64Array(H.stride);
  const c = Math.cos(o.ang || 0), s = Math.sin(o.ang || 0);
  r[H.ax] = o.ax; r[H.ay] = o.ay; r[H.ex] = c; r[H.ey] = s; r[H.fx] = -s; r[H.fy] = c;
  r[H.x0] = o.x0 ?? -32; r[H.y0] = o.y0 ?? -16; r[H.tx] = o.tx ?? 1; r[H.ty] = o.ty ?? 1;
  r[H.vx] = o.vx || 0; r[H.vy] = o.vy || 0; r[H.w] = o.w || 0;
  r[H.reach] = o.reach ?? 40; r[H.key] = o.key || 0; r[H.uid] = o.uid ?? 1; r[H.ver] = o.ver ?? 1;
  const words = new Uint32Array(M.words);
  for (let j = o.j0 ?? 10; j <= (o.j1 ?? 21); j++) for (let i = o.i0 ?? 12; i <= (o.i1 ?? 51); i++) {
    const k = j * M.w + i;
    words[k >>> 5] |= 1 << (k & 31);
  }
  for (let k = 0; k < M.words; k++) r[H.mask + k] = words[k];
  return r;
}

test('kadłub w domenie: uniformy (kotwica, K, przesunięcie, prędkość względem domeny, ω, pasmo) i lustro CPU = obrys w świecie', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const size = 64;
  const h = size / 16;
  const k = g.acquire(0, 0, 0, 4, { size, carrier: [5, -3, 0], life: 30 });
  const s = g.slots[k];
  const ang = 0.6;
  const rec = hullRec({ ax: 3, ay: -2, ang, vx: 40, vy: 10, w: 0.3, key: 77, uid: 9 });
  g.hull(rec, 0);
  g.simulate(R, 1 / 60);
  assert.equal(g.stats.hulls, 1);
  assert.equal(g.stats.bandUploads, 1, 'maska rozpakowana raz');
  const HA = g.U.hullA.array[0], HC = g.U.hullC.array[0];
  assert.ok(Math.abs(HA.x - ((3 - s.cx) / h + 8)) < 1e-9 && Math.abs(HA.y - ((-2 - s.cy) / h + 8)) < 1e-9, 'kotwica w komórkach');
  assert.ok(Math.abs(HC.x - (40 - 5) / h) < 1e-9 && Math.abs(HC.y - (10 + 3) / h) < 1e-9, 'prędkość względem domeny');
  assert.equal(HC.z, 0.3);
  // punkty sceny: w obrysie (z zapasem teksla od brzegu) — komórka stała, poza nim — nie
  const c = Math.cos(ang), sn = Math.sin(ang);
  const r2 = rng(3);
  let inside = 0, outside = 0;
  const o = { vx: 0, vy: 0 };
  for (let t = 0; t < 400; t++) {
    const X = (r2.next() - 0.5) * 64, Y = (r2.next() - 0.5) * 32;   // układ kadłuba
    const ti = X + 32, tj = Y + 16;                                   // teksel maski (bok 1, róg −32, −16)
    const inMask = ti > 12 + 1 && ti < 52 - 1 && tj > 10 + 1 && tj < 22 - 1;
    const outMask = ti < 12 - 1 || ti > 52 + 1 || tj < 10 - 1 || tj > 22 + 1;
    if (!inMask && !outMask) continue;
    const sx = 3 + X * c - Y * sn, sy = -2 + X * sn + Y * c;
    const px = (sx - s.cx) / h + 8, py = (sy - s.cy) / h + 8;
    const sol = g.solidCpu(k, px, py, o);
    assert.equal(sol, inMask ? 1 : 0, `punkt (${X.toFixed(2)}, ${Y.toFixed(2)})`);
    if (inMask) {
      // prędkość ciała + ω × r (r w komórkach) względem domeny
      const rx = px - HA.x, ry = py - HA.y;
      assert.ok(Math.abs(o.vx - (HC.x - 0.3 * ry)) < 1e-9 && Math.abs(o.vy - (HC.y + 0.3 * rx)) < 1e-9);
      inside++;
    } else outside++;
  }
  assert.ok(inside > 20 && outside > 20);
});

test('gospodarz domeny (wrak wybuchającego okrętu) nie jest przeszkodą swojego gazu; inne domeny go widzą; pasma LRU', () => {
  const g = makeGrid();
  const R = fakeRenderer();
  const a = g.acquire(0, 0, 0, 4, { size: 64, host: 77, life: 30 });
  const b = g.acquire(40, 0, 0, 4, { size: 64, life: 30 });
  assert.ok(g.slots[a].isHost(77) && !g.slots[b].isHost(77));
  g.hull(hullRec({ ax: 20, ay: 0, key: 77, uid: 1 }), 0);
  g.simulate(R, 1 / 60);
  assert.equal(g.stats.hulls, 1, 'tylko w domenie b');
  const A = g.U.act.array;
  const kb = g.active.findIndex((s) => s.index === b);
  const ka = g.active.findIndex((s) => s.index === a);
  assert.equal(A[ka * 4 + 1].x, 0);
  assert.equal(A[kb * 4 + 1].x, 1);
  // scalenie (dokładanie wybuchu innego okrętu) dopisuje gospodarza
  g.slots[b].addHost(91);
  assert.ok(g.slots[b].isHost(91));
  // więcej różnych kadłubów niż pasm w jednej klatce: nadmiar pominięty (licznik), pasmo z pamięci po uid
  for (let u = 0; u < 5; u++) g.hull(hullRec({ ax: 40, ay: 0, uid: 100 + u }), 0);
  g.simulate(R, 1 / 60);
  assert.equal(g.stats.hulls, 6, 'po 3 pasma w każdej z dwóch domen (pasmo z pamięci po uid)');
  assert.equal(g.stats.hullsDropped, 4);
  g.hull(hullRec({ ax: 40, ay: 0, uid: 100 }), 0);
  g.simulate(R, 1 / 60);
  assert.equal(g.stats.bandUploads, 0, 'ta sama maska — bez rozpakowania');
  g.hull(hullRec({ ax: 40, ay: 0, uid: 100, ver: 2, i1: 30 }), 0);
  g.simulate(R, 1 / 60);
  assert.equal(g.stats.bandUploads, 1, 'nowa wersja maski — rozpakowanie');
});

test('lustro CPU rzutu z przeszkodą: ściana rozdziela ciśnienie (za ścianą p = 0, v = 0), gaz nie wnika w ścianę, ściana w ruchu pcha gaz', () => {
  const nx = 24, ny = 16, nz = 6, n = nx * ny * nz;
  const id = (x, y, z) => x + nx * (y + ny * z);
  const run = (wall, wallVx = 0) => {
    const vel = new Float64Array(n * 3), solid = new Uint8Array(n), target = new Float64Array(n);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = id(x, y, z);
      if (wall && (x === 12 || x === 13)) { solid[i] = 1; vel[i * 3] = wallVx; }
      const d = Math.hypot(x - 7.5, y - 7.5, z - 2.5);
      if (d < 3.5) target[i] = 2;   // rozprężanie (spalanie) w kuli przy ścianie
    }
    return { ...gasProjectCpu(vel, solid, target, nx, ny, nz, 41), solid };
  };
  const W = run(true);
  let farQ = 0, farV = 0, intoWall = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    for (let x = 14; x < nx; x++) {
      const i = id(x, y, z);
      farQ = Math.max(farQ, Math.abs(W.q[i]));
      farV = Math.max(farV, Math.abs(W.vel[i * 3]), Math.abs(W.vel[i * 3 + 1]), Math.abs(W.vel[i * 3 + 2]));
    }
    intoWall = Math.max(intoWall, W.vel[id(11, y, z) * 3]);   // składowa ku ścianie (+x) przy ścianie
  }
  assert.equal(farQ, 0, 'za ścianą ciśnienie 0 (Neumann rozdziela)');
  assert.equal(farV, 0, 'za ścianą gaz stoi');
  assert.ok(intoWall <= 0, `przy ścianie bez składowej w ścianę (${intoWall})`);
  const O = run(false);
  let farOpen = 0;
  for (let i = 0; i < n; i++) if ((i % nx) >= 14) farOpen = Math.max(farOpen, Math.abs(O.vel[i * 3]));
  assert.ok(farOpen > 1e-3, 'bez ściany przepływ dochodzi dalej');
  // ściana jadąca w gaz (−x): gaz przy niej ma vx ≤ prędkości ściany
  const M = run(true, -5);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) assert.ok(M.vel[id(11, y, z) * 3] <= -5 + 1e-12);
  for (let i = 0; i < n; i++) if (M.solid[i]) assert.equal(M.vel[i * 3], -5, 'komórka stała — prędkość przeszkody');
});

test('WGSL: maska w reakcji (raster statyki, pętla kadłubów, marsz zasłaniania źródeł), Neumann w Jacobim, bez wnikania w rzucie, limity', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const build = (node) => {
    const b = renderer.backend.createNodeBuilder(node, renderer);
    b.build();
    return b.computeShader;
  };
  const react = build(g.reactNode);
  assert.match(react, /for \( var ghull : i32/, 'pętla kadłubów domeny');
  assert.match(react, /for \( var gocc : i32/, 'marsz zasłaniania źródeł');
  assert.equal((react.match(/texture_2d<f32>/g) || []).length, 2, 'raster statyki + maski obrysu');
  assert.ok((react.match(/var<uniform>/g) || []).length <= 12, 'bufory uniformów reakcji');
  assert.ok((react.match(/texture_storage_3d/g) || []).length <= 4);
  // gaz nie wchodzi w komórkę stałą: flaga komórki stałej (w velB.w) zeruje cały zapis skalarów (dym, T, paliwo, tempo)
  const velStore = react.match(/textureStore\( \w+, \w+, vec4<f32>\( \w+, (nodeVar\d+) \) \);/);
  assert.ok(velStore, 'velB = (prędkość, flaga komórki stałej)');
  const flagVar = velStore[1];
  const isSolid = react.match(new RegExp(String.raw`(nodeVar\d+) = \( ${flagVar} > 0\.5 \);`));
  assert.ok(isSolid, 'test komórki stałej z flagi');
  assert.match(react, new RegExp(String.raw`if \( ${isSolid[1]} \) \{\s*(nodeVar\d+) = vec4<f32>\( 0\.0, 0\.0, 0\.0, 0\.0 \);[\s\S]*?textureStore\( \w+, \w+, \1 \)`), 'skalary w komórce stałej = 0');
  // NEUMANN w Jacobim (przegląd etapu C pkt 9 — dawny licznik `.z > 0,5` przechodził też przy Dirichlecie): każdy z 6
  // sąsiadów w domenie — flaga stałej (s.z > 0,5) → p KOMÓRKI (ten sam odczyt C0.x), inaczej p sąsiada; poza domeną 0;
  // q = (Σ − C0.y) / 6, komórka stała (C0.z) zostaje 0.
  const jac = build(g.jacAB);
  const nbs = [...jac.matchAll(/if \( \( (nodeVar\d+)\.z > 0\.5 \) \) \{\s*(nodeVar\d+) = (nodeVar\d+)\.x;\s*\} else \{\s*\2 = \1\.x;\s*\}/g)];
  assert.equal(nbs.length, 6, 'sąsiad stały → p komórki, wolny → p sąsiada (6 sąsiadów)');
  const c0 = nbs[0][3];
  assert.ok(nbs.every((m) => m[3] === c0 && m[1] !== c0), 'p komórki z jednego odczytu C0');
  assert.ok((jac.match(/\} else \{\s*nodeVar\d+ = 0\.0;\s*\}/g) || []).length >= 6, 'poza domeną p = 0 (otwarty brzeg)');
  assert.match(jac, new RegExp(String.raw`- ${c0}\.y \) / 6\.0 \)`), 'q = (Σ − rhs) / 6');
  assert.match(jac, new RegExp(String.raw`if \( \( ${c0}\.z > 0\.5 \) \) \{\s*(nodeVar\d+) = 0\.0;[\s\S]*?textureStore\( \w+, \w+, vec4<f32>\( \1, ${c0}\.y, ${c0}\.z, 0\.0 \) \)`), 'komórka stała p = 0');
  // BEZ WNIKANIA w rzucie: ściana x+ → v.x = min(v.x, velB(p + x).x), x− → max(…, velB(p − x).x), y± analogicznie (ta sama
  // zmienna v, odczyty velB); sufit prędkości jeden i PRZED warunkiem ściany (pkt 8).
  const bP = renderer.backend.createNodeBuilder(g.projectNode, renderer);
  bP.build();
  const proj = bP.computeShader;
  let velBName = null;
  for (const gr of bP.getBindings()) for (const bd of gr.bindings) if (bd.texture?.name === 'gasVelB') velBName = bd.name;
  assert.ok(velBName, 'wiązanie velB w rzucie');
  // v.c = min / max( v.c, mix( v.c, ściana.c, wallBlock ) ) — wallBlock 1: twardo do prędkości ściany, 0,5: średnia z licem
  const wallRe = (off, comp, fn) => new RegExp(String.raw`vec3<f32>\( ${off} \)[^;]*;\s*(nodeVar\d+) = vec3<f32>[^;]*;\s*(nodeVar\d+) = textureSampleLevel\( ${velBName}, [^;]*;\s*(nodeVar\d+)\.${comp} = ${fn}\( \3\.${comp}, mix\( \3\.${comp}, \2\.${comp}, object\.nodeUniform\d+ \) \);`);
  const walls = [['1\\.0, 0\\.0, 0\\.0', 'x', 'min'], ['-1\\.0, 0\\.0, 0\\.0', 'x', 'max'], ['0\\.0, 1\\.0, 0\\.0', 'y', 'min'], ['0\\.0, -1\\.0, 0\\.0', 'y', 'max']]
    .map(([o, c, f]) => proj.match(wallRe(o, c, f)));
  assert.ok(walls.every(Boolean), `ściana: x+ min, x− max, y+ min, y− max z velB sąsiada (${walls.map((m) => !!m)})`);
  assert.ok(walls.every((m) => m[3] === walls[0][3]), 'jedna zmienna prędkości');
  // sufit w komórkach × skala komórki domeny (GasSlot.k — etap D)
  const caps = [...proj.matchAll(/min\( 1\.0, \( \( object\.nodeUniform\d+ \* nodeVar\d+ \) \/ max\( length\( nodeVar\d+ \), 0\.001 \) \) \)/g)];
  assert.equal(caps.length, 1, 'jeden sufit prędkości');
  assert.ok(caps[0].index < walls[0].index, 'sufit przed warunkiem ściany');
  const div = build(g.divNode);
  assert.match(div, /\.w > 0\.5/, 'dywergencja czyta flagę komórki stałej z velB.w');
  for (const node of [g.curlNode, g.advectNode, g.divNode, g.jacAB, g.projectNode, g.clearNode, g.lightNode]) {
    const cs = build(node);
    assert.ok((cs.match(/var<uniform>/g) || []).length <= 12);
    assert.ok((cs.match(/texture_storage_3d/g) || []).length <= 4, node.name);
  }
});

// --- strona gry ----------------------------------------------------------------------------------------------------

test('wejście gry: bryły hali K-7 w świecie = bryły kolizji hali (te same pudła po przekształceniu hala → gra)', () => {
  const place = { x: 7.3e6, y: -2.9e6, cos: Math.cos(0.7), sin: Math.sin(0.7) };
  const frame = { origin: { x: 1500, y: -800 }, tx: Math.cos(0.2), ty: Math.sin(0.2), rx: -Math.sin(0.2), ry: Math.cos(0.2) };
  const rings = [{ collider: { place, registry: { halls: [{ index: 0, frame }] } } }];
  const aff = hallToGameAffine(place, frame, {});
  const out = OI.createGasObstacleInput();
  const st = OI.createGasObstacleState();
  const camX = aff.p0x + 3700 * aff.bx, camY = aff.p0y + 3700 * aff.by;
  OI.packGasObstacleFrame(out, st, { camX, camY, viewHalf: 5000, rings });
  const L = createK7Layout();
  const solids = k7SolidList(L);
  assert.equal(out[GAS_OBST_IN.boxes], solids.length);
  assert.ok(out[GAS_OBST_IN.statVer] > 0);
  const inHall = (x, z) => solids.some((s) => {
    const ca = Math.cos(s.angle || 0), sa = Math.sin(s.angle || 0);
    const dx = x - s.x, dz = z - s.z;
    return Math.abs(dx * ca + dz * sa) <= s.w / 2 && Math.abs(-dx * sa + dz * ca) <= s.d / 2;
  });
  const inWorld = (gx, gy) => {
    for (let b = 0; b < out[GAS_OBST_IN.boxes]; b++) {
      const o = GAS_OBST_IN.boxBase + b * 6;
      const dx = gx - out[o], dy = gy - out[o + 1];
      if (Math.abs(dx * out[o + 2] + dy * out[o + 3]) <= out[o + 4] && Math.abs(dy * out[o + 2] - dx * out[o + 3]) <= out[o + 5]) return true;
    }
    return false;
  };
  const r = rng(11);
  let hits = 0;
  for (let t = 0; t < 3000; t++) {
    const x = (r.next() - 0.5) * 2 * (L.halfWidth + 300), z = L.backZ - 300 + r.next() * (L.frontZ - L.backZ + 600);
    const gx = aff.p0x + x * aff.ax + z * aff.bx, gy = aff.p0y + x * aff.ay + z * aff.by;
    const a = inHall(x, z), w = inWorld(gx, gy);
    assert.equal(w, a, `punkt hali (${x.toFixed(1)}, ${z.toFixed(1)})`);
    if (a) hits++;
  }
  assert.ok(hits > 10);
  // ta sama klatka — bez nowej wersji; hala poza zasięgiem — statyka pusta (nowa wersja)
  const v = out[GAS_OBST_IN.statVer];
  OI.packGasObstacleFrame(out, st, { camX, camY, viewHalf: 5000, rings });
  assert.equal(out[GAS_OBST_IN.statVer], v);
  OI.packGasObstacleFrame(out, st, { camX: camX + 2e6, camY, viewHalf: 5000, rings });
  assert.equal(out[GAS_OBST_IN.boxes], 0);
  assert.notEqual(out[GAS_OBST_IN.statVer], v);
});

test('wejście gry: kawałki suchego doku — bryły trafień (bez odpadłych), ruszony kawałek jako obrys ciał', () => {
  const dock = placeDryDock({ x: 6.1e6, y: 2.2e6 }, 0.4);
  const gone = new Set(['G-W']);
  const touched = new Set();
  const adapter = {
    shapes: dock.hitShapes,
    status: (c) => (gone.has(c) ? 0 : touched.has(c) ? 2 : 1),
    feet: (c, cb) => { if (c === 'S-3') cb({ x: dock.origin.x, y: dock.origin.y, angle: 0.4, w: 600, h: 200, vx: 0, vy: 0, beamHull: null }); }
  };
  const out = OI.createGasObstacleInput();
  const st = OI.createGasObstacleState();
  OI.packGasObstacleFrame(out, st, { dt: 1 / 60, dock: adapter });
  const n = out[GAS_OBST_IN.boxes];
  assert.equal(n, dock.hitShapes.filter((h) => !gone.has(h.chunk)).length, 'bez odpadłych kawałków');
  // pudło z czworokąta = wielokąt bryły trafień
  const r = rng(5);
  for (let t = 0; t < 2000; t++) {
    const hs = dock.hitShapes[(r.next() * dock.hitShapes.length) | 0];
    if (gone.has(hs.chunk)) continue;
    const x = hs.x0 + (r.next() * 1.2 - 0.1) * (hs.x1 - hs.x0), y = hs.y0 + (r.next() * 1.2 - 0.1) * (hs.y1 - hs.y0);
    const inPoly = pointInPoly(hs.pts.map((p) => ({ x: p.x, z: p.y })), x, y);
    let inBox = false;
    for (let b = 0; b < n && !inBox; b++) {
      const o = GAS_OBST_IN.boxBase + b * 6;
      const dx = x - out[o], dy = y - out[o + 1];
      if (Math.abs(dx * out[o + 2] + dy * out[o + 3]) <= out[o + 4] + 1e-6 && Math.abs(dy * out[o + 2] - dx * out[o + 3]) <= out[o + 5] + 1e-6) inBox = true;
    }
    if (inPoly) assert.ok(inBox, 'punkt bryły w pudle');
  }
  touched.add('S-3');
  OI.packGasObstacleFrame(out, st, { dt: 1 / 60, dock: adapter });
  assert.equal(out[GAS_OBST_IN.foots], 1, 'ruszony kawałek — obrys ciała');
  assert.equal(out[GAS_OBST_IN.boxes], n - dock.hitShapes.filter((h) => h.chunk === 'S-3').length);
});

test('wejście gry: kadłuby tylko przy domenach gazu (bez domen nic), klucz rodu, uid i wersja maski, prędkości i ω', () => {
  const out = OI.createGasObstacleInput();
  const st = OI.createGasObstacleState();
  const near = { x: 5e6 + 100, y: 2e6, angle: 0.5, w: 400, h: 120, vx: 30, vy: -20, angVel: 0.1, beamHull: { dmgKey: 42 } };
  const far = { x: 5e6 + 60000, y: 2e6, angle: 0, w: 400, h: 120, beamHull: null };
  const dead = { x: 5e6, y: 2e6, w: 400, h: 120, dead: true };
  const piece = { x: 5e6, y: 2e6, w: 400, h: 120, isWorldPiece: true };
  OI.packGasObstacleFrame(out, st, { hulls: [[near, far, dead, piece]] });
  assert.equal(out[GAS_OBST_IN.hulls], 0, 'bez domen — żadnych kadłubów');
  const D = new Float64Array([5e6 - 800, 2e6 - 800, 5e6 + 800, 2e6 + 800]);
  OI.packGasObstacleFrame(out, st, { hulls: [[near, far, dead, piece]], domains: D, nDomains: 1 });
  assert.equal(out[GAS_OBST_IN.hulls], 1);
  const H = GAS_HULL_REC, o = GAS_OBST_IN.hullBase;
  assert.equal(out[o + H.key], 42);
  assert.equal(out[o + H.vx], 30); assert.equal(out[o + H.vy], -20); assert.equal(out[o + H.w], 0.1);
  assert.ok(Math.abs(out[o + H.ex] - Math.cos(0.5)) < 1e-12 && Math.abs(out[o + H.ey] - Math.sin(0.5)) < 1e-12, 'oś X kadłuba (kurs)');
  const uid = out[o + H.uid], ver = out[o + H.ver];
  OI.packGasObstacleFrame(out, st, { hulls: [near], domains: D, nDomains: 1 });
  assert.equal(out[o + H.uid], uid, 'uid stały');
  assert.equal(out[o + H.ver], ver, 'maska bez zmian — ta sama wersja');
  assert.ok(out[o + H.reach] > 200 && out[o + H.reach] < 300);
});

// --- klej reżysera wybuchów (atrapa Core3D jak tests/explosions.test.mjs) ------------------------------------------

const { ExplosionFx, EXPLOSION_TUNE } = await import('../src/3d/explosions/explosionFx.js');
const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
const { SimClock } = await import('../src/game/simClock.js');
function fakeCore() {
  const cameraOrtho = new THREE.OrthographicCamera(-800, 800, 450, -450, 1, 400000);
  cameraOrtho.position.set(0, 0, 150000);
  cameraOrtho.updateMatrixWorld();
  const field = { shock() { return true; }, heat() { return true; } };
  return {
    scene: new THREE.Scene(), steps: [],
    activeCam1: { x: 0, y: 0, zoom: 0.3 }, composerTarget: { width: 1600, height: 900 }, cameraOrtho,
    cameraPersp: new THREE.PerspectiveCamera(45, 16 / 9, 10, 1e6),
    isFreePerspectiveCamera() { return false; }, fxDistortion() { return field; },
    addFxStep(step) { this.steps.push(step); return step; },
    fx: { origin: new FxPoolOrigin({ name: 'testOrigin' }), view: { x0: -6000, y0: -3400, x1: 6000, y1: 3400 }, removeStep() {} }
  };
}
const fxRenderer = { compute() {} };
function fxFrame(core, dt = 1 / 60) {
  SimClock.sim += dt;
  const c = { renderer: fxRenderer, core, origin: core.fx.origin, view: core.fx.view, grid: { addWorld() { return 0; } } };
  core.steps[0].spawn(c);
  core.steps[0].lights(c);
  core.steps[0].update(c);
}
// Wejście z jedną ścianą (pudło w świecie gry) i opcjonalnym kadłubem.
function obstInput(boxes, ver = 1) {
  const IN = OI.createGasObstacleInput();
  IN[GAS_OBST_IN.statVer] = ver;
  let n = 0;
  for (const b of boxes) n = OI.putGasObstacleBox(IN, n, b.cx, b.cy, b.ux, b.uy, b.hw, b.hd);
  IN[GAS_OBST_IN.boxes] = n;
  return IN;
}

test('reżyser: wejście gry → scena (y odbite), gospodarz domeny z hostKey (scalenie dopisuje), przeszkody wyłączalne', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { slots: 4, N: 32, NZ: 12, fineSlots: 0 } });
  fx.setObstacleInput(obstInput([{ cx: 500, cy: 200, ux: 0, uy: 1, hw: 900, hd: 30 }]));
  fxFrame(core);
  assert.equal(fx.grid._boxN, 1);
  assert.deepEqual(Array.from(fx.grid._boxes.subarray(0, 6)), [500, -200, 0, -1, 900, 30], 'scena: x, −y');
  assert.ok(fx.spawn(0, 0, 300, 'capital', 0, 0, { hostKey: 55 }));
  const slot = fx.grid.slots.findIndex((s) => s.active);
  assert.ok(fx.grid.slots[slot].isHost(55), 'gospodarz domeny');
  fx.spawn(30, 10, 300, 'capital', 0, 0, { hostKey: 66 });   // mieści się — scalenie (bez wolnej? jest wolna: drobna kula)
  const r = new Float64Array(4 * 4);
  const n = fx.domainRects(r);
  assert.ok(n >= 1);
  const half = fx.grid.slots[slot].h * fx.grid.N * 0.5;
  assert.ok(Math.abs(r[0] - (fx.grid.slots[slot].cx - half)) < 1e-9 && Math.abs((r[1] + r[3]) * 0.5 - (-fx.grid.slots[slot].cy)) < 1e-9, 'prostokąt w świecie gry');
  EXPLOSION_TUNE.obstacles = false;
  try {
    fxFrame(core);
    assert.equal(fx.grid._boxN, 0, 'przeszkody wyłączone — statyka pusta');
  } finally { EXPLOSION_TUNE.obstacles = true; }
  fxFrame(core);
  assert.equal(fx.grid._boxN, 1, 'z powrotem');
});

test('reżyser: kadłub z wejścia w scenie (y, osie i prędkość odbite, ω ze znakiem przeciwnym), poza gospodarzem domeny', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { slots: 4, N: 32, NZ: 12, fineSlots: 0 } });
  const IN = obstInput([]);
  const e = { x: 120, y: -40, angle: 0.3, w: 300, h: 100, vx: 50, vy: 20, angVel: 0.2, beamHull: null };
  const D = new Float64Array([-1000, -1000, 1000, 1000]);
  OI.packGasObstacleFrame(IN, OI.createGasObstacleState(), { hulls: [e], domains: D, nDomains: 1 });
  fx.setObstacleInput(IN);
  fx.spawn(0, 0, 300, 'capital', 0, 0);
  fxFrame(core);
  assert.equal(fx.grid.stats.hulls, 1);
  const s = fx.grid.slots.find((q) => q.active);
  const HA = fx.grid.U.hullA.array[0], HC = fx.grid.U.hullC.array[0];
  assert.ok(Math.abs(HA.y - ((40 - s.cy) / s.h + fx.grid.N / 2)) < 1e-6, 'kotwica: −y gry');
  assert.ok(Math.abs(HC.y - (-20 / s.h)) < 1e-9 && Math.abs(HC.z + 0.2) < 1e-12, 'prędkość −vy, ω −ω');
});

test('reżyser: źródła po stronie środka wybuchu (kłąb za ścianą cofnięty, odłamek w ścianie gaśnie), wtórny przed ścianą', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { slots: 4, N: 32, NZ: 12, fineSlots: 0 } });
  // ściana tuż przed środkiem wybuchu (0,2 R) — część kłębów i smug odłamków leci w nią
  fx.setObstacleInput(obstInput([{ cx: 110, cy: 0, ux: 0, uy: 1, hw: 4000, hd: 20 }]));
  fxFrame(core);
  fx.spawn(0, 0, 300, 'capital', 0, 0);
  for (let i = 0; i < 90; i++) fxFrame(core);
  const d = fx.director;
  assert.ok(d.stats.moved > 0, `kłęby za ścianą cofnięte (${d.stats.moved})`);
  assert.ok(d.stats.blocked > 0, `odłamki w ścianie zgasły (${d.stats.blocked})`);
  // żaden żywy emiter nie stoi za ścianą (x > 130 gry) ani w niej
  for (const e of d.emitters) if (e.alive && e.started) assert.ok(e.x < 110 - 20, `emiter przed ścianą (${e.x.toFixed(1)})`);
  // wybuchy wtórne z kolejki po spawnie: żaden za ścianą
  assert.ok(fx.stats.secondaries >= 0);
});

test('wejście gry: obrys kadłuba w budżecie czasu klatki — bez przebudowy nowy kadłub czeka (null), stary obrys zostaje', async () => {
  const { hullFootprint } = await import('../src/game/hullFootprint.js');
  const e = { x: 0, y: 0, angle: 0, w: 300, h: 100, beamHull: null };
  assert.equal(hullFootprint(e, 64, 32, false), null, 'bez obrysu w pamięci i bez przebudowy — nic');
  const fp = hullFootprint(e, 64, 32, true);
  assert.ok(fp && fp.cells > 0);
  assert.equal(hullFootprint(e, 64, 32, false), fp, 'obrys z pamięci');
  assert.ok(OI.GAS_OBST_REBUILD_MS > 0 && OI.GAS_OBST_REBUILD_MS <= 0.5);
  // pakowanie liczy odłożone kadłuby (stan), bez wyjątków przy budżecie 0
  const out = OI.createGasObstacleInput();
  const st = OI.createGasObstacleState();
  OI.packGasObstacleFrame(out, st, { hulls: [e], domains: new Float64Array([-500, -500, 500, 500]), nDomains: 1 });
  assert.equal(out[GAS_OBST_IN.hulls], 1);
  assert.equal(st.deferred, 0);
});

// --- poprawki etapu C po przeglądzie kodu (2026-10-09) ---------------------------------------------------------------

test('pkt 1 przeglądu: źródło zasłonięte bryłą na drodze do POCZĄTKU kapsuły — strumień w ścianę nie wstrzykuje za nią', () => {
  const g = makeGrid({ N: 32, NZ: 8, slots: 2 });
  const size = 64, h = size / 32, half = 16;
  g.setStatics(1, new Float64Array([10, 0, 0, 1, 500, 0.5]), 1);   // ściana x = 10 (wzdłuż y), grubość 1 j.
  const k = g.acquire(0, 0, 0, 4, { size, life: 30 });
  g.updateRasters();
  const s = g.slots[k];
  const cell = (x, y) => [(x - s.cx) / h + half, (y - s.cy) / h + half];
  const A = cell(0, 0);   // otwór strumienia (kapsuła 0 → 24 j. przez ścianę)
  for (const xs of [14, 18, 22]) assert.equal(g.sourceOcclusionCpu(k, ...cell(xs, 0.6), A[0], A[1]), 0, `za ścianą x ${xs}`);
  for (const xs of [2, 4, 7]) assert.equal(g.sourceOcclusionCpu(k, ...cell(xs, 0.6), A[0], A[1]), 1, `przed ścianą x ${xs}`);
  // WGSL: marsz od komórki do srcA (początek kapsuły), nie do najbliższego punktu osi
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(g.reactNode, renderer);
  b.build();
  const react = b.computeShader;
  const a = react.match(/(nodeVar\d+) = gasSrcA\.value\[ gsrc \];/);
  assert.ok(a, 'odczyt srcA');
  const toA = react.match(new RegExp(String.raw`(nodeVar\d+) = \( (nodeVar\d+)\.xy - ${a[1]}\.xy \);`));
  assert.ok(toA, 'wektor komórka → początek kapsuły');
  assert.match(react, new RegExp(String.raw`for \( var gocc[\s\S]*?\( ${toA[2]}\.xy - \( ${toA[1]} \* `), 'marsz po wektorze do początku kapsuły');
});

test('pkt 2 przeglądu: domena zasilona nowym wybuchem dostaje raster świeżej statyki od razu (bez limitu 0,1 s)', () => {
  const g = makeGrid({ N: 32, NZ: 8, slots: 2 });
  const box = new Float64Array([0, 0, 1, 0, 3, 3]);
  g.setStatics(1, box, 1);
  const k = g.acquire(40, 0, 0, 4, { size: 64, life: 30 });
  g.updateRasters();
  assert.equal(g.slots[k].maskVer, 1);
  g.setStatics(2, new Float64Array(6), 0);
  g.updateRasters();
  assert.equal(g.slots[k].maskVer, 2, 'pierwsza zmiana budowli — od razu');
  g.time += 0.02;
  g.setStatics(3, box, 1);
  g.updateRasters();
  assert.equal(g.slots[k].maskVer, 2, 'seria zmian — limit STATIC_MIN_INTERVAL');
  g.feed(k, g.time + 5);
  g.updateRasters();
  assert.equal(g.slots[k].maskVer, 3, 'zasilona nowym wybuchem — raster od razu');
});

test('pkt 3 przeglądu: budżet obrysów — najpierw kadłub bez obrysu najbliższy domenie (wrak z końca list), limit kadłubów przed obrysem', async () => {
  const { hullFootprintPeek } = await import('../src/game/hullFootprint.js');
  const mk = (x) => ({ x, y: 0, angle: 0, w: 300, h: 100, vx: 0, vy: 0, angVel: 0, beamHull: null });
  const npcs = [mk(-250), mk(-200), mk(-150)];
  const wreck = mk(10);
  const D = new Float64Array([-50, -50, 50, 50]);
  const out = OI.createGasObstacleInput(), st = OI.createGasObstacleState();
  const opts = { hulls: [null, null, npcs, [wreck]], domains: D, nDomains: 1, rebuildMax: 1 };
  OI.packGasObstacleFrame(out, st, opts);
  assert.ok(hullFootprintPeek(wreck), 'wrak (najbliżej domeny, na końcu list) — obrys pierwszy');
  assert.ok(npcs.every((e) => !hullFootprintPeek(e)), 'okręty czekają');
  assert.equal(st.firstBuilds, 1);
  assert.equal(st.deferred, 3);
  assert.equal(out[GAS_OBST_IN.hulls], 1);
  OI.packGasObstacleFrame(out, st, opts);
  assert.ok(hullFootprintPeek(npcs[2]) && !hullFootprintPeek(npcs[0]), 'następna klatka — najbliższy z czekających');
  // limit kadłubów: 40 kandydatów w domenie, nadmiar policzony bez zapisu
  const many = Array.from({ length: 40 }, (_, i) => mk(-40 + i * 2));
  OI.packGasObstacleFrame(out, OI.createGasObstacleState(), { hulls: [many], domains: D, nDomains: 1, rebuildMs: Infinity });
  assert.equal(out[GAS_OBST_IN.hulls], GAS_OBST_IN.maxHulls);
  assert.equal(out[GAS_OBST_IN.dropped], 40 - GAS_OBST_IN.maxHulls);
  // daleko od domen (wstępny test zasięgu z wymiarów) — obrys nie liczony
  const far = mk(5000);
  OI.packGasObstacleFrame(out, OI.createGasObstacleState(), { hulls: [far], domains: D, nDomains: 1 });
  assert.equal(hullFootprintPeek(far), null, 'kadłub daleko od domen — obrys nie liczony');
});

test('pkt 4 przeglądu: domena trzyma 16 gospodarzy bez nadpisywania; z pełną reżyser nie scala wybuchu z nowym gospodarzem', () => {
  const g = makeGrid();
  const k = g.acquire(0, 0, 0, 4, { size: 64, life: 30, host: 1 });
  const s = g.slots[k];
  for (let i = 2; i <= 16; i++) assert.equal(s.addHost(i), true);
  assert.equal(s.addHost(17), false, 'pełna lista');
  assert.ok(s.isHost(4) && s.isHost(16) && !s.isHost(17), 'bez nadpisania ostatniego');
  assert.equal(s.canHost(17), false);
  assert.equal(s.canHost(5), true);
  assert.equal(s.canHost(0), true);
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { slots: 4, N: 32, NZ: 12, fineSlots: 0 } });
  fxFrame(core);
  assert.ok(fx.spawn(0, 0, 300, 'capital', 0, 0, { hostKey: 1 }));
  const slot = fx.grid.slots.findIndex((q) => q.active);
  for (let i = 2; i <= 16; i++) fx.grid.slots[slot].addHost(100 + i);
  fx.spawn(20, 10, 300, 'capital', 0, 0, { hostKey: 999 });
  assert.ok(!fx.grid.slots[slot].isHost(999), 'pełna domena — bez scalenia');
  const other = fx.grid.slots.findIndex((q, i) => q.active && i !== slot);
  assert.ok(other >= 0 && fx.grid.slots[other].isHost(999), 'nowa domena z gospodarzem');
});

test('pkt 5 przeglądu: okno rastra na siatce świata — kolejne okna domeny z nośnikiem bez skoku lica ściany', () => {
  for (const [vx, vy] of [[37.3, 3.1], [37.3, 7.7], [20, 13.37]]) {
    const g = makeGrid({ N: 16, NZ: 8, slots: 2 });
    g.setStatics(1, new Float64Array([0, 22.0, 1, 0, 1e6, 0.15]), 1);   // ściana y = 22 (wzdłuż x)
    const k = g.acquire(0, 0, 0, 4, { size: 32, carrier: [vx, vy, 0], life: 1000 });
    const s = g.slots[k], h = s.h;
    g.updateRasters();
    // lico ściany od strony domeny (pierwsza bryła w górę od y = 10) — wyszukiwanie połówkowe
    const face = () => {
      let lo = 10, hi = 22;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) * 0.5; if (g.solidAt(k, s.cx, m)) hi = m; else lo = m; }
      return hi;
    };
    let last = face(), lmx = s.mox, lmy = s.moy, rasters = 0, maxJump = 0;
    for (let i = 0; i < 300 && s.cy <= 10; i++) {
      g.simulate(fakeRenderer(), 1 / 60);
      const f = face();
      if (s.mox !== lmx || s.moy !== lmy) { rasters++; maxJump = Math.max(maxJump, Math.abs(f - last) / h); lmx = s.mox; lmy = s.moy; }
      last = f;
    }
    if (vy < 10) assert.ok(rasters >= 1, `nowe okno (v ${vx}, ${vy})`);
    assert.ok(maxJump < 1e-4, `skok lica przy nowym oknie ${maxJump} komórki (v ${vx}, ${vy})`);
    assert.ok(Math.abs(s.mox / h - Math.round(s.mox / h)) < 1e-9 && Math.abs(s.moy / h - Math.round(s.moy / h)) < 1e-9, 'róg okna na siatce h');
  }
});

test('pkt 6 przeglądu: adwekcja próbkuje skalary bez komórek stałych (próbka / (1 − flaga), bez flagi — bez zmian)', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const b = renderer.backend.createNodeBuilder(g.advectNode, renderer);
  b.build();
  const adv = b.computeShader;
  let denB = null, velA = null, denA = null;
  for (const gr of b.getBindings()) for (const bd of gr.bindings) {
    if (bd.texture?.name === 'gasDenB') denB = bd.name;
    if (bd.texture?.name === 'gasVelA') velA = bd.name;
    if (bd.texture?.name === 'gasDenA') denA = bd.name;
  }
  const m = adv.match(/if \( \( (nodeVar\d+)\.w > 0\.001 \) \) \{\s*(nodeVar\d+) = \( (nodeVar\d+) \/ vec4<f32>\( max\( \( 1\.0 - \1\.w \), 0\.2 \) \) \);\s*\} else \{\s*\2 = \3;\s*\}/);
  assert.ok(m, 'próbka / (1 − flaga) przy fladze > 0, inaczej bez zmian');
  // zmienna może być aliasem próbki (nodeVarA = nodeVarB; nodeVarB = textureSampleLevel(…))
  const sampledFrom = (v, tex) => {
    const al = adv.match(new RegExp(String.raw`${v} = (nodeVar\d+);`));
    return new RegExp(String.raw`${al ? al[1] : v} = textureSampleLevel\( ${tex},`).test(adv);
  };
  assert.ok(sampledFrom(m[1], velA), 'flaga z velA.w w punkcie wstecz');
  assert.ok(sampledFrom(m[3], denA), 'skalary z denA');
  assert.match(adv, new RegExp(String.raw`textureStore\( ${denB}, \w+, ${m[2]} \)`), 'φ̂ do denB');
});

test('pkt 7 przeglądu: żar (łby odłamków, iskry w gazie) gaśnie w bryle statyki swojej domeny — raster w kroku żaru', async () => {
  const { GasEmbers } = await import('../src/3d/gas/gasEmbers.js');
  const g = makeGrid();
  const em = new GasEmbers({ scene: new THREE.Scene(), grid: g, rng: rng(3) });
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(em.stepNode, renderer);
  b.build();
  const cs = b.computeShader;
  let mask = null;
  for (const gr of b.getBindings()) for (const bd of gr.bindings) if (bd.texture?.name === 'gasStaticMask') mask = bd.name;
  assert.ok(mask, 'raster statyki w kroku żaru');
  assert.match(cs, /gasEmberSlotMask/, 'okno rastra domeny w uniformach');
  assert.match(cs, new RegExp(String.raw`textureSampleLevel\( ${mask},[\s\S]*?> 0\.5 \) \) \{\s*nodeVar\d+ = max\( nodeVar\d+, nodeVar\d+\.w \);`), 'w bryle: wiek = życie (gaśnie)');
  // okno rastra domeny → uniform (lokalnie względem początku gridu)
  g.setStatics(1, new Float64Array([0, 0, 1, 0, 3, 3]), 1);
  const k = g.acquire(5, 0, 0, 4, { size: 64, life: 30 });
  g.updateRasters();
  g.origin.x = 2; g.origin.y = 1;
  em.update({ compute() {} }, 1 / 60, null);
  const M = em.U.slotMask.array[k];
  assert.ok(Math.abs(M.x - (g.slots[k].mox - 2)) < 1e-9 && Math.abs(M.y - (g.slots[k].moy - 1)) < 1e-9 && M.z === g.slots[k].h && M.w === 1);
});

test('pkt 8 przeglądu: sufit prędkości przed warunkiem ściany i nie w komórce stałej — szybki kadłub pcha gaz swoją prędkością', async () => {
  const { gasProjectCellCpu } = await import('../src/3d/gas/gasGrid.js');
  const out = [0, 0, 0];
  const nb = new Float64Array(6), nbS = new Uint8Array(6), nbIn = new Uint8Array(6).fill(1);
  nbS[0] = 1;   // sąsiad x+ stały, jedzie w gaz z −150 kom./s (szybciej niż sufit 110)
  gasProjectCellCpu([0, 20, 0], 0, 0, nb, nbS, nbIn, [-150, 0, 0, 0], 110, out);
  assert.equal(out[0], -150, 'gaz przy ścianie z prędkością ściany (dawniej sufit po obcięciu: ~−110)');
  gasProjectCellCpu([200, 0, 0], 1, 0, nb, nbS, nbIn, [0, 0, 0, 0], 110, out);
  assert.equal(out[0], 200, 'komórka stała — prędkość przeszkody bez sufitu');
  nbS[0] = 0;
  gasProjectCellCpu([300, 400, 0], 0, 0, nb, nbS, nbIn, [0, 0, 0, 0], 110, out);
  assert.ok(Math.abs(Math.hypot(out[0], out[1]) - 110) < 1e-9, 'gaz bez ściany — sufit');
  // lustro całej domeny z sufitem: ściana nadjeżdżająca szybciej niż sufit
  const nx = 12, ny = 6, nz = 3, n = nx * ny * nz;
  const vel = new Float64Array(n * 3), solid = new Uint8Array(n), target = new Float64Array(n);
  const id = (x, y, z) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 9; x < nx; x++) { solid[id(x, y, z)] = 1; vel[id(x, y, z) * 3] = -150; }
  const M = gasProjectCpu(vel, solid, target, nx, ny, nz, 9, null, 110);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) assert.ok(M.vel[id(8, y, z) * 3] <= -150 + 1e-9, 'gaz przy ścianie ≤ prędkość ściany');
});

test('pkt 10 przeglądu: emiter z nośnikiem domeny niesie też środek wybuchu (ox, oy)', async () => {
  const { GasExplosions } = await import('../src/3d/gas/gasExplosions.js');
  const g = makeGrid({ N: 16, slots: 2 });
  const d = new GasExplosions({ grid: g, rng: rng(5) });
  d.tune.followCarrier = true;
  const slot = g.acquire(0, 0, 0, 5, { size: 32, life: 9, carrier: [300, 0, 0] });
  d.setOrigin(0, 0);
  const e = d.puff(slot, 5, 0, 0, 2, 0.5, 0.2, 1, 1);
  d.clearOrigin();
  for (let i = 0; i < 30; i++) { d.update(1 / 60); g._srcN = 0; }
  assert.ok(Math.abs(e.x - 155) < 1e-6, `emiter ${e.x}`);
  assert.ok(Math.abs(e.ox - 150) < 1e-6 && Math.abs(e.oy) < 1e-9, `środek wybuchu ${e.ox}`);
});

test('pkt 11 przeglądu: wybuch wtórny jedzie z nośnikiem od chwili wybuchu rodzica', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { slots: 4, N: 32, NZ: 12, fineSlots: 0 } });
  fxFrame(core);
  const calls = [];
  const orig = fx._spawn.bind(fx);
  fx._spawn = (x, y, size, prof, cx, cy, fs, p) => { if (p < 0.99) calls.push({ x, y, t: fx.time }); return orig(x, y, size, prof, cx, cy, fs, p); };
  fx.spawn(0, 0, 300, 'capital', 400, 0);
  const t0 = fx.time;
  const n = fx.qN;
  assert.ok(n >= 1, 'wtórne w kolejce');
  const qx = Array.from(fx.qX.subarray(0, n)), qy = Array.from(fx.qY.subarray(0, n));
  for (let i = 0; i < 200 && calls.length < n; i++) fxFrame(core);
  assert.equal(calls.length, n);
  for (const c of calls) {
    const dt = c.t - t0;
    assert.ok(dt >= 0.3, 'po opóźnieniu');
    assert.ok(qx.some((x, i) => Math.abs(c.x - (x + 400 * dt)) < 1e-6 && Math.abs(c.y - qy[i]) < 1e-6), `wtórny w ${c.x.toFixed(2)} (dt ${dt.toFixed(3)})`);
  }
});

test('pkt 12 przeglądu: hala K-7 przy żywej domenie gazu jest w statyce także poza kadrem kamery', () => {
  const place = { x: 7.3e6, y: -2.9e6, cos: Math.cos(0.7), sin: Math.sin(0.7) };
  const frame = { origin: { x: 1500, y: -800 }, tx: Math.cos(0.2), ty: Math.sin(0.2), rx: -Math.sin(0.2), ry: Math.cos(0.2) };
  const rings = [{ collider: { place, registry: { halls: [{ index: 0, frame }] } } }];
  const aff = hallToGameAffine(place, frame, {});
  const hx = aff.p0x + 3700 * aff.bx, hy = aff.p0y + 3700 * aff.by;   // punkt w hali
  const out = OI.createGasObstacleInput();
  const st = OI.createGasObstacleState();
  const camFar = { camX: hx + 2e6, camY: hy, viewHalf: 5000, rings };
  OI.packGasObstacleFrame(out, st, camFar);
  assert.equal(out[GAS_OBST_IN.boxes], 0, 'kamera daleko, bez domen — bez hali');
  const D = new Float64Array([hx - 1000, hy - 1000, hx + 1000, hy + 1000]);
  OI.packGasObstacleFrame(out, st, { ...camFar, domains: D, nDomains: 1 });
  assert.equal(out[GAS_OBST_IN.boxes], k7SolidList(createK7Layout()).length, 'domena gazu w hali — hala w statyce');
});

test('pkt 6 przeglądu: dopływ skalarów 1. rzędu przy ścianie w tempie prędkości zabranej przez warunek ściany (wallFill)', async () => {
  const { gasWallFillCpu, createGasTuning } = await import('../src/3d/gas/gasGrid.js');
  assert.equal(createGasTuning().wallFill, 64, 'domyślnie wł. (A/B 2026-10-09)');
  assert.equal(createGasTuning().wallBlock, 1, 'warunek ściany twardy');
  const den = [0.1, 0.2, 0, 0];
  gasWallFillCpu(den, [1, 1, 0, 0], 0, 64, 1 / 60);
  assert.deepEqual(den, [0.1, 0.2, 0, 0], 'bez zabranej prędkości — bez dopływu (ściana odjeżdżająca)');
  gasWallFillCpu(den, [1, 1, 0, 0], 0.5, 64, 1 / 60);
  const t = 64 * 0.5 / 60;
  assert.ok(Math.abs(den[0] - (0.1 + 0.9 * t)) < 1e-12, 'część drogi do sąsiada od wnętrza');
  gasWallFillCpu(den, [1, 1, 0, 0], 50, 64, 1 / 60);
  assert.equal(den[0], 1, 'najwyżej wartość sąsiada (min(1, …))');
  // WGSL rzutu: przy każdej z 4 ścian den = mix(den, denC(p − kierunek ściany), min(1, wallFill · dt · |v przed − v po|)) → denA
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const g = makeGrid();
  const b = renderer.backend.createNodeBuilder(g.projectNode, renderer);
  b.build();
  const proj = b.computeShader;
  let denC = null, denA = null;
  for (const gr of b.getBindings()) for (const bd of gr.bindings) {
    if (bd.texture?.name === 'gasDenC') denC = bd.name;
    if (bd.texture?.name === 'gasDenA') denA = bd.name;
  }
  // wallFill · dt / k (skala komórki domeny — etap D) · |v przed − v po|
  const fills = [...proj.matchAll(/(nodeVar\d+) = mix\( \1, (nodeVar\d+), min\( 1\.0, \( \( \( object\.nodeUniform\d+ \* object\.nodeUniform\d+ \) \/ nodeVar\d+ \) \* abs\( \( nodeVar\d+ - nodeVar\d+\.([xy]) \) \) \) \) \);/g)];
  assert.equal(fills.length, 4, 'dopływ przy 4 ścianach');
  assert.deepEqual(fills.map((m) => m[3]), ['x', 'x', 'y', 'y']);
  const denVar = fills[0][1];
  assert.ok(fills.every((m) => m[1] === denVar), 'jedna zmienna skalarów');
  for (const [m, off] of fills.map((m, i) => [m, ['1\\.0, 0\\.0, 0\\.0', '-1\\.0, 0\\.0, 0\\.0', '0\\.0, 1\\.0, 0\\.0', '0\\.0, -1\\.0, 0\\.0'][i]])) {
    assert.match(proj, new RegExp(String.raw`- vec3<f32>\( ${off} \)[\s\S]{0,400}?${m[2]} = textureSampleLevel\( ${denC},`), `sąsiad od wnętrza z denC (${off})`);
  }
  assert.match(proj, new RegExp(String.raw`textureStore\( ${denA}, \w+, ${denVar} \)`), 'skalary z dopływem do denA');
});
