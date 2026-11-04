// KLASTRY SZTYWNE i POLE PŁYTY w prawdziwym silniku (HullBodies + kontakt v2), Node — bramki E2 planu
// docs/PLAN-zawalenia-budowli-3d.md (§ 3.5, § 6 wiersz E2). Wzór: .tmp/destrukcja-2026-11-03/weryfikacja/klastry-silnik.mjs
// (sceptyk wydajności — te same bryły 200 × 200 × 100 j. z 32 punktami styku, ten sam teren 257 × 129 z odczytem
// atan2 / acos jak skała Hidalgo i normalną z 4 dodatkowych odczytów), ale klaster to ciało `rigid` (beamRigid3D.js).
//
//   node scripts/klastry-sym.mjs --tryb stos  [--n 200] [--czas 8] [--spread 1400] [--powt 3] [--hz 60] [--seed 12345]
//   node scripts/klastry-sym.mjs --tryb stos  --n 100,200,256 --powt 3            (bramki: p95 ≤ 1 / 2,5 / 3,5, max ≤ 6 ms)
//   node scripts/klastry-sym.mjs --tryb plyta [--powt 3] [--v 900] [--cell 45]     (wieża ~13 tys. węzłów przez płytę ≤ 4 ms p95)
//   node scripts/klastry-sym.mjs --tryb taran [--v 1500]                           (klaster × ciało płaskie: µs na parę)
//   node scripts/klastry-sym.mjs --tryb bryla [--n 24] [--v 300]                   (klaster × bryła belek ~13 tys. węzłów: µs na parę)
//   Max z ZIMNEGO procesu (pierwsze zawalenie w grze): osobne uruchomienie na każde N z --powt 1 (np. --n 200 --powt 1);
//   przebiegi po pierwszym w jednym procesie są już rozgrzane.
//   --json — jedna linia JSON na przebieg. Mediana z przebiegów na końcu. Obciążenie maszyny z os.cpus() w czasie przebiegu.
import os from 'node:os';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { buildClusterDesc } = await import('../src/game/beamRigid3D.js');
const { buildBeamStructure } = await import('../src/game/beamBody3D.js');
HullBodies.init();
HullBodies.warmUpClusters();   // rozgrzewka JIT klastrów jak w grze po wpięciu (ekran ładowania)
const D = HullBodies.engine;
// czasy modułów klastrów i płyty (w grze wyłączone — kosztują). --czasy 0: bez nich, jak w grze — do pomiaru ZIMNEGO
// pierwszego kroku (rozgrzewka JIT w HullBodies.warmUpClusters idzie bez czasów; gałąź czasów w pierwszym kroku narzędzia to kod
// bez informacji o typach — deoptymalizacja i krok 0 w interpreterze, którego gra nie ma)
const TIMING = !process.argv.includes('--czasy') || process.argv[process.argv.indexOf('--czasy') + 1] !== '0';
D.rigidPerf.timing = TIMING;
D.platePerf.timing = TIMING;
// --budzet N — sufit aktywnych klastrów (domyślnie gra: HULL_BODY_CONFIG.clusterMaxActive 160; 0 = bez sufitu)
{ const i = process.argv.indexOf('--budzet'); if (i >= 0) { const v = Number(process.argv[i + 1]); D.rigidConfig.maxActive = v > 0 ? v : 1e9; } }

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : f; };
const TRYB = String(arg('tryb', 'stos'));
const NS = String(arg('n', '200')).split(',').map(Number);
const CZAS = Number(arg('czas', 8));
const SPREAD = Number(arg('spread', 1400));
const POWT = Math.max(1, Number(arg('powt', 3)) | 0);
const HZ = Number(arg('hz', 60));
const SEED = Number(arg('seed', 12345)) >>> 0;
const JSON_OUT = process.argv.includes('--json');
const dt = 1 / HZ;

const pct = (a, f) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]; };
const avg = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0);
const med = (a) => pct(a, 0.5);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');

// obciążenie maszyny (wszystkie rdzenie) w czasie przebiegu — z liczników os.cpus()
function cpuSnap() { let idle = 0, total = 0; for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; } return { idle, total }; }
const cpuLoad = (a, b) => { const tot = b.total - a.total; return tot > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / tot)) : -1; };

function reset() {
  for (const h of HullBodies._clusters) if (h.entity) HullBodies.release(h.entity);
  HullBodies._clusters.length = 0;
  D.terrains.length = 0;
  D.plateFields.length = 0;
  D.splitQueue.length = 0;
  window.wrecks.length = 0;
}

// --- teren jak skała Hidalgo (kula R 32 km, mapa 257 × 129, atan2 / acos, dwuliniowo; normalna z 4 odczytów) ---
function makeTerrain(seed, counter) {
  let s = seed >>> 0; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const RT = 32000, W = 256, H = 128, grid = new Float32Array((W + 1) * (H + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = (rnd() - 0.5) * 0.004;
  const TWO_PI = Math.PI * 2;
  const relAt = (lx, ly, lz) => {
    let phi = Math.atan2(lz, -lx); if (phi < 0) phi += TWO_PI;
    const theta = Math.acos(ly > 1 ? 1 : ly < -1 ? -1 : ly);
    const fx = phi / TWO_PI * W, fy = theta / Math.PI * H;
    let x0 = Math.floor(fx), y0 = Math.floor(fy); let tx = fx - x0, ty = fy - y0;
    if (x0 >= W) { x0 = W - 1; tx = 1; } if (y0 >= H) { y0 = H - 1; ty = 1; }
    const r0 = y0 * (W + 1), r1 = r0 + W + 1;
    const a = grid[r0 + x0] * (1 - tx) + grid[r0 + x0 + 1] * tx, b = grid[r1 + x0] * (1 - tx) + grid[r1 + x0 + 1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const EPS = 0.004;
  const rr = (dx, dy, dz) => { counter.reads++; const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; return RT * (1 + relAt(dx / l, dy / l, dz / l)); };
  return { name: 'kula', cx: 0, cy: 0, cz: -RT, R: RT, rMax: RT * 1.003, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
    radius(ex, ey, ez) { counter.reads++; return RT * (1 + relAt(ex, ey, ez)); },
    normal(ex, ey, ez, r, out) {
      let ax = 0, ay = 0, az = 1; if (Math.abs(ez) > 0.9) { ax = 1; az = 0; }
      let t1x = ay * ez - az * ey, t1y = az * ex - ax * ez, t1z = ax * ey - ay * ex; const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
      t1x /= l1; t1y /= l1; t1z /= l1; const t2x = ey * t1z - ez * t1y, t2y = ez * t1x - ex * t1z, t2z = ex * t1y - ey * t1x;
      const g1 = (rr(ex + t1x * EPS, ey + t1y * EPS, ez + t1z * EPS) - rr(ex - t1x * EPS, ey - t1y * EPS, ez - t1z * EPS)) / (2 * EPS);
      const g2 = (rr(ex + t2x * EPS, ey + t2y * EPS, ez + t2z * EPS) - rr(ex - t2x * EPS, ey - t2y * EPS, ez - t2z * EPS)) / (2 * EPS);
      const k = 1 / Math.max(1, r); const ox = ex - g1 * k * t1x - g2 * k * t2x, oy = ey - g1 * k * t1y - g2 * k * t2y, oz = ez - g1 * k * t1z - g2 * k * t2z;
      const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1; out.x = ox / l; out.y = oy / l; out.z = oz / l; return out;
    } };
}

// klaster jak bryła sceptyka: 4 × 4 × 2 komórki po 50 j. = 200 × 200 × 100, 32 punkty, masa 1,8 · 50² · 32
const CELL = 50, BX = 4, BY = 4, BZ = 2;
const CLUSTER_MASS = 1.8 * CELL * CELL * BX * BY * BZ;
const clusterDesc = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: BX * CELL / 2, hy: BY * CELL / 2, hz: BZ * CELL / 2, mass: CLUSTER_MASS, id: 0 }], { spacing: 50, radiusMul: 0.6 });

function runStos(N, rep) {
  reset();
  const counter = { reads: 0 };
  D.addTerrain(makeTerrain(SEED, counter));
  let s = (SEED + 7919 * rep) >>> 0; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const ents = [];
  for (let i = 0; i < N; i++) {
    const e = { x: 0, y: 0, name: 'klaster', isWreck: true };
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * SPREAD;
    const z = 200 + (i % 40) * (BZ * CELL * 1.6) + rnd() * 50;
    const ang = rnd() * Math.PI, ax = rnd() - 0.5, ay = rnd() - 0.5, az = rnd() - 0.5, al = Math.sqrt(ax * ax + ay * ay + az * az) || 1, sn = Math.sin(ang / 2);
    const hull = HullBodies.createCluster(e, clusterDesc, { position: { x: Math.cos(a) * r, y: Math.sin(a) * r, z },
      quaternion: { x: ax / al * sn, y: ay / al * sn, z: az / al * sn, w: Math.cos(ang / 2) }, gravity: { x: 0, y: 0, z: -400 } });
    if (!hull) throw new Error('createCluster: limit klastrów');
    ents.push(e);
  }
  const P = D.rigidPerf;
  const steps = Math.round(CZAS / dt);
  const ms = [], col = [], rr = [], narrow = [], pairs = [], cont = [], terr = [], awake = [], prep = [], ter = [], rig = [];
  const c0 = cpuSnap();
  for (let k = 0; k < steps; k++) {
    counter.reads = 0;
    const t0 = performance.now();
    HullBodies.step(dt, ents);
    ms.push(performance.now() - t0);
    col.push(D.perf.lastCollisionMs || 0);
    rr.push(P.rrMs); prep.push(P.prepMs); ter.push(P.terrainMs); rig.push(P.ms); narrow.push(P.narrow); pairs.push(P.pairs); cont.push(P.contacts); terr.push(counter.reads); awake.push(P.awake);
  }
  const load = cpuLoad(c0, cpuSnap());
  const TOP = Number(arg('top', 0));
  if (TOP > 0) {
    const idx = ms.map((v, i) => i).sort((a, b) => ms[b] - ms[a]).slice(0, TOP);
    for (const i of idx) console.log(`  najwolniejszy krok ${i} (t=${(i / HZ).toFixed(2)}s): ${ms[i].toFixed(2)} ms, kolizje ${col[i].toFixed(2)}, pary ${pairs[i]}, narrow ${narrow[i]}, styki ${cont[i]}, aktywne ${awake[i]}, pary klastrów ${rr[i].toFixed(2)} ms, przygotowanie ${prep[i].toFixed(2)}, teren ${ter[i].toFixed(2)}, moduł ${rig[i].toFixed(2)}`);
  }
  // okno szczytu: 1 s o największej sumie kroku
  const W = Math.round(HZ);
  let best = -1, bi = 0;
  for (let s0 = 0; s0 + W <= steps; s0 += Math.max(1, W >> 3)) { let t = 0; for (let j = s0; j < s0 + W; j++) t += ms[j]; if (t > best) { best = t; bi = s0; } }
  const win = (a) => a.slice(bi, bi + W);
  const usPair = avg(win(rr)) * 1000 / Math.max(1e-9, avg(win(narrow)));
  let usAll = 0, nAll = 0; for (let k = 0; k < steps; k++) { usAll += rr[k]; nAll += narrow[k]; }
  let minZ = Infinity; for (const e of ents) if (e.z < minZ) minZ = e.z;
  return { tryb: 'stos', N, hz: HZ, rep, load,
    krok: { p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: pct(ms, 1) },
    kolizje: { p50: pct(col, 0.5), p95: pct(col, 0.95), max: pct(col, 1) },
    szczyt: { t: bi / HZ, krok: avg(win(ms)), paryZSiatki: Math.round(avg(win(pairs))), paryNarrow: Math.round(avg(win(narrow))),
      styki: Math.round(avg(win(cont))), odczytyTerenu: Math.round(avg(win(terr))), aktywne: Math.round(avg(win(awake))), usNaPare: usPair,
      msModul: avg(win(rig)), msPary: avg(win(rr)), msPrzyg: avg(win(prep)), msTeren: avg(win(ter)) },
    usNaPareCaly: usAll * 1000 / Math.max(1, nAll),
    koniec: { aktywne: P.awake, spiace: P.sleeping, minZ: Math.round(minZ) } };
}

// --- wieża (talerz r 880 × 3 warstwy + szyja r 260) ~13 tys. węzłów, komórka 45, przez pole płyty (dysk r 336–1950) ---
function towerStructure(cell) {
  const cells = [];
  const R1 = 880, R2 = 260, NECK = Math.round(13286 / 1);
  const nx = Math.ceil((2 * R1) / cell) + 3, ny = nx;
  const pts = new Set();
  let nz = 0;
  const key = (i, j, k) => i + nx * (j + ny * k);
  const add = (i, j, k) => { const kk = key(i, j, k); if (!pts.has(kk)) { pts.add(kk); if (k + 1 > nz) nz = k + 1; } };
  const c0 = (nx - 1) / 2;
  for (let k = 0; k < 3; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i - c0) * cell, y = (j - c0) * cell; if (x * x + y * y <= R1 * R1) add(i, j, k);
  }
  for (let k = 3; pts.size < 13286; k++) for (let j = 0; j < ny && pts.size < 13286; j++) for (let i = 0; i < nx && pts.size < 13286; i++) {
    const x = (i - c0) * cell, y = (j - c0) * cell; if (x * x + y * y <= R2 * R2) add(i, j, k);
  }
  nz += 2;
  const solidMask = new Uint8Array(nx * ny * nz);
  for (const kk of pts) solidMask[kk] = 1;
  const origin = { x: -c0 * cell - cell / 2, y: -c0 * cell - cell / 2, z: -cell / 2 };
  for (const kk of pts) {
    const i = kk % nx, j = Math.floor(kk / nx) % ny, k = Math.floor(kk / (nx * ny));
    let surf = false;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const I = i + a, J = j + b, K = k + c;
      if (I < 0 || J < 0 || K < 0 || I >= nx || J >= ny || K >= nz || !solidMask[key(I, J, K)]) { surf = true; break; }
    }
    cells.push({ ix: i, iy: j, iz: k, x: origin.x + (i + 0.5) * cell, y: origin.y + (j + 0.5) * cell, z: origin.z + (k + 0.5) * cell,
      surface: surf, depth: surf ? 1 : 2, coverage: 1, r: 0.6, g: 0.6, b: 0.6 });
  }
  return buildBeamStructure({ cells, solidMask, nx, ny, nz, cellSize: cell, origin,
    aabb: { minX: origin.x, minY: origin.y, minZ: origin.z, maxX: origin.x + nx * cell, maxY: origin.y + ny * cell, maxZ: origin.z + nz * cell } },
  { bulkheadEvery: 0, frameStride: 2, maxFrameSpan: 14 });
}

let towerCache = null;
function runPlyta(rep) {
  reset();
  const cell = Number(arg('cell', 45)), v0 = Number(arg('v', 900));
  const tb = performance.now();
  if (!towerCache) towerCache = towerStructure(cell);
  const buildMs = performance.now() - tb;
  const st = towerCache;
  const DISK_R = 1950, STEM_R = 336, PCELL = 45;
  const n = Math.ceil((2 * DISK_R) / PCELL);
  let lostCells = 0, contacts = 0;
  const F = D.addPlateField({ origin: { x: -DISK_R, y: -DISK_R, z: -1034 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 },
    cell: PCELL, nu: n, nv: n, thickness: 360,
    mask: (iu, iv) => { const x = (iu + 0.5) * PCELL - DISK_R, y = (iv + 0.5) * PCELL - DISK_R, r2 = x * x + y * y; return r2 <= DISK_R * DISK_R && r2 >= STEM_R * STEM_R; },
    // nośność [masa / (j · s²)]: wieża 43 mln przy 900 j/s przebija płytę 360 j. przy ≲ 2·10⁴ (energia kinetyczna wobec
    // pracy oporu na całym przekroju talerza); 3·10³ — przejście z utratą ~części prędkości (próg rozstrzyga prototyp E1 / E6)
    capacity: Number(arg('nosnosc', 3e3)), massPerCell: 1.19 * PCELL * PCELL * 8, friction: 0.5,
    onCellLost: () => { lostCells++; }, onContact: () => { contacts++; } });
  const e = { x: 0, y: 0, name: 'wieża' };
  // wieża przechylona o 6°, talerz w dół, czoło ~120 j. nad płytą; spada z v0
  const ang = 0.105;
  const hull = HullBodies.createSolid(e, st, { position: { x: 180, y: -120, z: -650 + 140 }, quaternion: { x: Math.sin(ang / 2), y: 0, z: 0, w: Math.cos(ang / 2) },
    gravity: { x: 0, y: 0, z: -400 }, massPerArea: 1.6 / (45 * 45) * 45 * 45, collisionArmor: 3.5, hexPerNode: 4 });
  hull.body.vel.z = -v0;
  const ents = [e];
  const steps = Math.round(Number(arg('czas', 4)) / dt);
  const ms = [], plate = [], solver = [], pc = [];
  const c0 = cpuSnap();
  let passT = -1;
  for (let k = 0; k < steps; k++) {
    const t0 = performance.now();
    HullBodies.step(dt, ents);
    ms.push(performance.now() - t0);
    plate.push(D.platePerf.ms); solver.push(D.perf.lastSolverMs || 0); pc.push(D.platePerf.contacts);
    if (passT < 0 && hull.body.pos.z < -1034 - 2400) passT = k;
    if (process.env.SLAD && k % 5 === 0) console.log(k, "z", hull.body.pos.z.toFixed(0), "vz", hull.body.vel.z.toFixed(0), "styki", D.platePerf.contacts, "komórki", D.platePerf.cells, "zgniot", F.stats.crushing, "zjedzone", F.stats.eaten.toFixed(0), "żywe", F.alive);
  }
  const load = cpuLoad(c0, cpuSnap());
  const nodes = hull.body.activeNodes;
  // PRZEJŚCIE = kroki ze stykiem wieży z płytą (platePerf.contacts > 0) — p95 i max tylko z nich (recenzja E2, zgł. 9:
  // dawne okno ± 10 kroków rozcieńczało p95 krokami bez styku)
  const winMs = [], winPlate = [], winSolver = [];
  for (let k = 0; k < steps; k++) if (pc[k] > 0) { winMs.push(ms[k]); winPlate.push(plate[k]); winSolver.push(solver[k]); }
  return { tryb: 'plyta', rep, load, wezly: nodes, budowaMs: buildMs,
    przejscie: { krokow: winMs.length, p50: pct(winMs, 0.5), p95: pct(winMs, 0.95), max: pct(winMs, 1), plytaP95: pct(winPlate, 0.95), solverP95: pct(winSolver, 0.95) },
    komorkiZgubione: lostCells, zywe: F.alive, styki: contacts, vKoniec: Math.round(hull.body.vel.z) };
}

// --- taran: klaster w ciało płaskie (pomost / kadłub, 1 komórka grubości ... pełna płyta), µs na parę klaster × płaskie ---
function runTaran(rep) {
  reset();
  const v = Number(arg('v', 1500));
  const cells = [], nx = 80, ny = 12, cs = 15;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
    cells.push({ ix: i, iy: j, iz: 0, x: (i + 0.5) * cs, y: (j + 0.5) * cs, z: 0, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
  }
  const st = buildBeamStructure({ cells, nx, ny, nz: 1, cellSize: cs, origin: { x: 0, y: 0, z: 0 } }, { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
  const ship = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0, name: 'pomost', mass: 5e5 };
  // ciało płaskie przez D wprost (bez obrazu sprite'a): jak budowla
  const body = D.createBody(st, { planar: true, anchored: true, massMultiplier: (1.19 * cs * cs * st.nodeStore.count) / st.mass,
    collisionArmor: Number(arg('pancerz', 3)) });
  for (let i = 0; i < body.nodeStore.count; i += 4) body.nodeStore.invMass[i] = 0;
  body.colZ0 = -70; body.colZ1 = 70;
  const N = Number(arg('n', 16));
  const rig = [];
  for (let i = 0; i < N; i++) {
    const rb = D.createRigidBody(clusterDesc, { position: { x: -450 + (i % 5) * 225, y: Number(arg('y0', 600)) + Math.floor(i / 5) * 260, z: (i % 2) * 30 }, velocity: { x: 0, y: -v, z: 0 } });
    rig.push(rb);
  }
  const bodies = [body, ...rig];
  const P = D.rigidPerf;
  const steps = Math.round(1.0 / dt);
  let bms = 0, bn = 0, crushes = 0;
  const c0 = cpuSnap();
  for (let k = 0; k < steps; k++) {
    D.integrate(dt, rig);
    D.update(dt, bodies);
    bms += P.beamMs; bn += P.beamNarrow; crushes += P.crushes;
  }
  const load = cpuLoad(c0, cpuSnap());
  let through = 0; for (const rb of rig) if (rb.pos.y < -60) through++;
  return { tryb: 'taran', rep, load, v, N, usNaPareKlasterPlaskie: bms * 1000 / Math.max(1, bn), paryNarrow: bn,
    przeszly: through, wezlyPomostu: body.activeNodes, wezlyPomostu0: st.nodeStore.count, zgniecenia: crushes };
}

// --- klaster × BRYŁA BELEK (wieża H-T ~13 tys. węzłów, leżąca, swobodna bez grawitacji): klastry spadają na nią ---
function runBryla(rep) {
  reset();
  const cell = Number(arg('cell', 45)), v = Number(arg('v', 300)), N = Number(arg('n', 24));
  if (!towerCache) towerCache = towerStructure(cell);
  const e = { x: 0, y: 0, name: 'wieża' };
  const hull = HullBodies.createSolid(e, towerCache, { position: { x: 0, y: 0, z: 0 }, gravity: null,
    massPerArea: 1.6 / (45 * 45) * 45 * 45, collisionArmor: 3.5, hexPerNode: 4 });
  const T = hull.body;
  let topZ = -Infinity; const s0 = T.nodeStore; for (let i = 0; i < s0.count; i++) if (s0.z[i] > topZ) topZ = s0.z[i];
  const ents = [e];
  for (let i = 0; i < N; i++) {
    const ce = { x: 0, y: 0, name: 'klaster', isWreck: true };
    const a = (i / N) * Math.PI * 2, r = 120 + (i % 4) * 160;
    HullBodies.createCluster(ce, clusterDesc, { position: { x: Math.cos(a) * r, y: Math.sin(a) * r, z: topZ + 150 + (i % 3) * 140 },
      velocity: { x: 0, y: 0, z: -v }, gravity: { x: 0, y: 0, z: -400 } });
    ents.push(ce);
  }
  const P = D.rigidPerf;
  const steps = Math.round(Number(arg('czas', 3)) / dt);
  let bms = 0, bn = 0, be = 0, crushes = 0, maxStep = 0;
  const per = [];
  const c0 = cpuSnap();
  for (let k = 0; k < steps; k++) {
    const t0 = performance.now();
    HullBodies.step(dt, ents);
    const t = performance.now() - t0; if (t > maxStep) maxStep = t;
    bms += P.beamMs; bn += P.beamNarrow; be += P.beamEval; crushes += P.crushes;
    if (P.beamEval > 0) per.push(P.beamMs * 1000 / P.beamEval);
  }
  const load = cpuLoad(c0, cpuSnap());
  // µs na WYWOŁANIE pary (obie iteracje, także bez styku — tyle kosztuje para z siatki) i na parę ze stykiem
  return { tryb: 'bryla', rep, load, N, v, wezly: T.activeNodes, usNaWywolanie: bms * 1000 / Math.max(1, be), usNaWywolanieP95: pct(per, 0.95),
    usNaStyk: bms * 1000 / Math.max(1, bn), wywolania: be, paryNarrow: bn, zgniecenia: crushes, maxKrok: maxStep, spiace: P.sleeping };
}

const out = [];
if (TRYB === 'bryla') {
  for (let r = 0; r < POWT; r++) {
    const res = runBryla(r);
    if (JSON_OUT) console.log(JSON.stringify(res));
    else console.log(`bryła #${r} obc.${res.load}%  ${res.N} klastrów na wieży ${res.wezly} węzłów: ${f2(res.usNaWywolanie)} µs/wywołanie pary (p95 kroku ${f2(res.usNaWywolanieP95)}; ${res.wywolania} wywołań), ${f2(res.usNaStyk)} µs na parę ze stykiem (${res.paryNarrow}), zgnieceń ${res.zgniecenia}, max kroku ${f2(res.maxKrok)} ms, śpiące na końcu ${res.spiace}`);
  }
} else if (TRYB === 'stos') {
  for (const N of NS) {
    const runs = [];
    for (let r = 0; r < POWT; r++) {
      const res = runStos(N, r);
      runs.push(res);
      if (JSON_OUT) console.log(JSON.stringify(res));
      else console.log(`N=${N} #${r} obc.${res.load}%  krok p50/p95/max ${f2(res.krok.p50)} / ${f2(res.krok.p95)} / ${f2(res.krok.max)} ms` +
        `  kolizje p95 ${f2(res.kolizje.p95)}  szczyt t=${res.szczyt.t.toFixed(1)}s: pary ${res.szczyt.paryZSiatki} narrow ${res.szczyt.paryNarrow}` +
        ` styki ${res.szczyt.styki} odczyty terenu ${res.szczyt.odczytyTerenu} aktywne ${res.szczyt.aktywne} — ${f2(res.szczyt.usNaPare)} µs/parę` +
        ` [moduł ${f2(res.szczyt.msModul)}: pary ${f2(res.szczyt.msPary)}, przyg. ${f2(res.szczyt.msPrzyg)}, teren ${f2(res.szczyt.msTeren)}] (cały ${f2(res.usNaPareCaly)})  koniec: aktywne ${res.koniec.aktywne}, śpiące ${res.koniec.spiace}, minZ ${res.koniec.minZ}`);
    }
    out.push({ N, p95: med(runs.map(r => r.krok.p95)), max: med(runs.map(r => r.krok.max)), p50: med(runs.map(r => r.krok.p50)),
      us: med(runs.map(r => r.szczyt.usNaPare)), load: runs.map(r => r.load).join('/') });
  }
  if (!JSON_OUT) for (const o of out) console.log(`MEDIANA N=${o.N}: p50 ${f2(o.p50)}  p95 ${f2(o.p95)}  max ${f2(o.max)} ms  µs/parę ${f2(o.us)}  (obc. ${o.load}%)`);
} else if (TRYB === 'plyta') {
  const runs = [];
  for (let r = 0; r < POWT; r++) {
    const res = runPlyta(r);
    runs.push(res);
    if (JSON_OUT) console.log(JSON.stringify(res));
    else console.log(`płyta #${r} obc.${res.load}%  wieża ${res.wezly} węzłów (budowa ${res.budowaMs.toFixed(0)} ms)  przejście ${res.przejscie.krokow} kroków:` +
      ` p50/p95/max ${f2(res.przejscie.p50)} / ${f2(res.przejscie.p95)} / ${f2(res.przejscie.max)} ms, płyta p95 ${f2(res.przejscie.plytaP95)}, solver p95 ${f2(res.przejscie.solverP95)}` +
      `  komórek zgubionych ${res.komorkiZgubione}, żywych ${res.zywe}, vz końcowe ${res.vKoniec}`);
  }
  if (!JSON_OUT) console.log(`MEDIANA płyta: p95 ${f2(med(runs.map(r => r.przejscie.p95)))}  max ${f2(med(runs.map(r => r.przejscie.max)))} ms  (obc. ${runs.map(r => r.load).join('/')}%)`);
} else if (TRYB === 'taran') {
  for (let r = 0; r < POWT; r++) {
    const res = runTaran(r);
    if (JSON_OUT) console.log(JSON.stringify(res));
    else console.log(`taran #${r} obc.${res.load}%  v ${res.v}  ${res.N} klastrów: ${f2(res.usNaPareKlasterPlaskie)} µs/parę klaster × płaskie (${res.paryNarrow} par), przeszło ${res.przeszly}, zgnieceń ${res.zgniecenia}, węzłów pomostu ${res.wezlyPomostu} z ${res.wezlyPomostu0}`);
  }
} else {
  if (TRYB !== 'bryla') { console.error('nieznany --tryb (stos | plyta | taran | bryla)'); process.exit(1); }
}
