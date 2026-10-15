// Spike Rust → WASM: pomiar kroku fizyki belek JS ↔ WASM (A skalar, B simd128) na przemian w jednym procesie.
//
//   node --expose-gc --import ./experiments/rust-beams/js/register.mjs experiments/rust-beams/bench.mjs
//     [--sceny szyja,taran,ostrzal] [--rundy 4] [--tryby js,A,B] [--hz 60] [--out plik.json] [--przejscie 1]
//
// Sceny (fizyka jak scripts/destrukcja-taran-sym.mjs — prawdziwy HullBodies + worldBodies, kadłuby z PNG gry):
//   szyja   — Atlas szarżą (3000 j/s, ciąg 1100 j/s² przez 4 s) w szyb habitatu: zerwanie, przechył wieży 3D,
//             uderzenie bokiem w koronę bębna i dysk, osiadanie (18 s).
//   taran   — „pchanie / szarża”: Atlas 900 j/s + ciąg do 3000 j/s w ścianę bębna przez 4 s, potem 2 s (6 s).
//   ostrzal — Atlas, 4 pancerniki i 8 niszczycieli, 6 kraterów broni na krok (ogony trafień solvera lokalnego, 10 s).
// Runda = każdy tryb raz, kolejność rotuje; runda 0 = rozgrzewka (odrzucana). Krok k każdej sceny jest w każdym
// trybie ten sam (A i B bit w bit — sprawdza hash stanu), więc czasy porównujemy krok w krok (mediana z rund).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { RT } from './js/runtime.mjs';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const imp = (p) => import(new URL('file:///' + join(repo, p).replace(/\\/g, '/')).href);
const { readPng } = await imp('scripts/webgpu/png.mjs');
const { resizeBox } = await imp('tests/helpers/reactorHulls.mjs');
const { getHullRenderSize } = await imp('src/data/ships.js');
const { HullBodies } = await imp('src/game/hullBodies.js');
const { worldBodies, WORLD_BODY_TUNE: T } = await imp('src/game/worldBodies.js');
const { createPirateBaseLayout } = await imp('src/3d/portBuildings/pirateBaseLayout.js');
const { buildPirateBaseScene } = await imp('src/3d/portBuildings/pirateBaseScene.js');
const { resolvePortBuildingStyle } = await imp('src/3d/portBuildings/portBuildingStyle.js');
const { placePirateBase } = await imp('src/game/story/pirateBaseSite.js');
const { createPirateBaseSites } = await imp('src/game/story/pirateBaseBodies.js');
const { CollisionFX } = await imp('src/vfx/collisionFx.js');
const { createNeckState, stepNeck, noteNeckRam } = await imp('src/game/story/pirateBaseNeck.js');

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const SCENES = String(arg('sceny', 'szyja,taran,ostrzal')).split(',');
const ROUNDS = Number(arg('rundy', 4));
const MODES = String(arg('tryby', 'js,A,B')).split(',');
const DT = 1 / Number(arg('hz', 60));

HullBodies.init();
const D = HullBodies.engine;

// ---------------------------------------------------------------------------------------------
// _contactCandidates: prolog (macierze, pudło, sfera) jak w src — skan węzłów w WASM.
// ---------------------------------------------------------------------------------------------
const ccOrig = D._contactCandidates;
const P = RT.P, F = RT.F;
function ccWasm(iter, holder, mI, mH, grid, contactDist, reach, start, total, zLo = grid.minZ, zHi = grid.maxZ) {
  if (!(grid.minX <= grid.maxX)) return 0;
  const hcx = (grid.minX + grid.maxX) * 0.5, hcy = (grid.minY + grid.maxY) * 0.5, hcz = (zLo + zHi) * 0.5;
  const hex = (grid.maxX - grid.minX) * 0.5 + contactDist;
  const hey = (grid.maxY - grid.minY) * 0.5 + contactDist;
  const hez = (zHi - zLo) * 0.5 + contactDist;
  const pIx = iter.pos.x, pIy = iter.pos.y, pIz = iter.pos.z;
  const pHx = holder.pos.x, pHy = holder.pos.y, pHz = holder.pos.z;
  const dx = pHx - pIx, dy = pHy - pIy, dz = pHz - pIz;
  const ox = mI[0] * dx + mI[3] * dy + mI[6] * dz;
  const oy = mI[1] * dx + mI[4] * dy + mI[7] * dz;
  const oz = mI[2] * dx + mI[5] * dy + mI[8] * dz;
  const m00 = mI[0] * mH[0] + mI[3] * mH[3] + mI[6] * mH[6];
  const m01 = mI[0] * mH[1] + mI[3] * mH[4] + mI[6] * mH[7];
  const m02 = mI[0] * mH[2] + mI[3] * mH[5] + mI[6] * mH[8];
  const m10 = mI[1] * mH[0] + mI[4] * mH[3] + mI[7] * mH[6];
  const m11 = mI[1] * mH[1] + mI[4] * mH[4] + mI[7] * mH[7];
  const m12 = mI[1] * mH[2] + mI[4] * mH[5] + mI[7] * mH[8];
  const m20 = mI[2] * mH[0] + mI[5] * mH[3] + mI[8] * mH[6];
  const m21 = mI[2] * mH[1] + mI[5] * mH[4] + mI[8] * mH[7];
  const m22 = mI[2] * mH[2] + mI[5] * mH[5] + mI[8] * mH[8];
  const cx = ox + m00 * hcx + m01 * hcy + m02 * hcz;
  const cy = oy + m10 * hcx + m11 * hcy + m12 * hcz;
  const cz = oz + m20 * hcx + m21 * hcy + m22 * hcz;
  const ax = Math.abs(m00) * hex + Math.abs(m01) * hey + Math.abs(m02) * hez;
  const ay = Math.abs(m10) * hex + Math.abs(m11) * hey + Math.abs(m12) * hez;
  const az = Math.abs(m20) * hex + Math.abs(m21) * hey + Math.abs(m22) * hez;
  const sphere = reach >= 0 ? reach : Infinity;
  const eps = 1e-12 * (Math.abs(pIx) + Math.abs(pIy) + Math.abs(pIz) + Math.abs(pHx) + Math.abs(pHy) + Math.abs(pHz) +
    Math.abs(hcx) + Math.abs(hcy) + Math.abs(hcz) + hex + hey + hez + (reach >= 0 ? reach : 0)) + 1e-9;
  const rx0 = Math.max(cx - ax, ox - sphere) - eps, rx1 = Math.min(cx + ax, ox + sphere) + eps;
  const ry0 = Math.max(cy - ay, oy - sphere) - eps, ry1 = Math.min(cy + ay, oy + sphere) + eps;
  const rz0 = Math.max(cz - az, oz - sphere) - eps, rz1 = Math.min(cz + az, oz + sphere) + eps;
  if (!(rx0 <= rx1 && ry0 <= ry1 && rz0 <= rz1)) return 0;
  let list = this._ncList;
  if (!RT.inWasm(list) || list.length < total) list = this._ncList = RT.allocArrays(null, [['l', Int32Array, Math.max(total, list.length * 2)]]).l;
  const s = iter.nodeStore;
  P[0] = s.x.byteOffset; P[1] = s.y.byteOffset; P[2] = s.z.byteOffset; P[3] = s.active.byteOffset;
  P[4] = list.byteOffset; P[5] = start; P[6] = total;
  F[0] = rx0; F[1] = rx1; F[2] = ry0; F[3] = ry1; F[4] = rz0; F[5] = rz1;
  return RT.exports.scan(RT.PARAM, RT.PF);
}
D._contactCandidates = function (iter, holder, mI, mH, grid, contactDist, reach, start, total, zLo, zHi) {
  const t0 = RT.timing ? performance.now() : 0;
  const r = RT.mode === 'js' ? ccOrig.call(this, iter, holder, mI, mH, grid, contactDist, reach, start, total, zLo, zHi)
    : ccWasm.call(this, iter, holder, mI, mH, grid, contactDist, reach, start, total, zLo, zHi);
  if (RT.timing) { RT.t.scan += performance.now() - t0; RT.t.nScan++; }
  return r;
};

// ---------------------------------------------------------------------------------------------
// Scena: wspólne (kopie z scripts/destrukcja-taran-sym.mjs)
// ---------------------------------------------------------------------------------------------
const IMAGES = new Map();
function hullImage(id) {
  if (!IMAGES.has(id)) {
    const path = id === 'atlas' ? 'assets/capital_ship_rect_v1.png' : `src/assets/ships/${id.replace('_', '')}.png`;
    const png = readPng(join(repo, path));
    const size = getHullRenderSize(id, png.width, png.height);
    IMAGES.set(id, resizeBox(png, size.w, size.h));
  }
  return IMAGES.get(id);
}
function ship(id, x, y, angle, mass) {
  const e = { x, y, angle, vx: 0, vy: 0, angVel: 0, shipFrame: id, mass, name: id };
  if (!HullBodies.createHull(e, hullImage(id), { hullProfileId: id })) throw new Error('kadłub ' + id);
  return e;
}
function hullExtent(e) {
  const b = e.beamHull.body, s = b.nodeStore, h = e.beamHull;
  const ax = b.latticeMin.x + h.anchorDX, ay = b.latticeMin.y + h.anchorDY;
  let maxX = -Infinity;
  for (let i = 0; i < s.count; i++) if (s.active[i] && s.x[i] - ax > maxX) maxX = s.x[i] - ax;
  return { nose: maxX };
}
const L = createPirateBaseLayout();
const style = resolvePortBuildingStyle('pirate');
const scene = buildPirateBaseScene(L, style);
const place = placePirateBase({ x: 5e6, y: 4e6 }, 0, L);
const HAB = place.habitat, H = L.habitat;
const owners = { habitat: { id: 'hab', hp: 36000, maxHp: 36000 }, fuel: { id: 'fuel', hp: 1, maxHp: 1 }, warehouse: { id: 'w', hp: 1, maxHp: 1 }, piers: { id: 'p', hp: 1, maxHp: 1 } };
function freshHabitat() {
  worldBodies.reset();
  window.wrecks.length = 0;
  const sites = createPirateBaseSites(owners, { layout: L, scene, style }, place, {});
  worldBodies.addSite(sites.habitat);
  T.bubbleRadius = 1e6; T.buildBudgetMs = 1e6;
  worldBodies.step(1 / 60, [HAB]);
  return sites.habitat;
}
function integrate(e, dt) { e.x += e.vx * dt; e.y += e.vy * dt; e.angle += e.angVel * dt; }
function stepAll(ents, dt, focusE = ents[0]) {
  for (const e of ents) if (!e.dead) integrate(e, dt);
  for (const w of window.wrecks) if (!w.dead && !w.solid3D) integrate(w, dt);
  worldBodies.step(dt, [{ x: focusE.x, y: focusE.y }]);
  HullBodies.step(dt, worldBodies.withEntities([...ents, ...window.wrecks]));
  for (let i = window.wrecks.length - 1; i >= 0; i--) {
    const w = window.wrecks[i];
    if (w.solid3D && w.z < HullBodies.config.solidFloorZ) { HullBodies.release(w); window.wrecks.splice(i, 1); }
  }
}
function release(ents) { for (const e of [...ents, ...window.wrecks]) HullBodies.release(e); window.wrecks.length = 0; }
const ATLAS_MASS = 800000;
const EXT = (() => { const a = ship('atlas', 0, 0, 0, ATLAS_MASS); const x = hullExtent(a); HullBodies.release(a); return x; })();

// Hash stanu: FNV-1a po bitach x, y, z, vx, vy, vz węzłów i pozie ciał (kolejność: encje, wraki, kawałki miejsc).
function stateHash(ents, site) {
  let h = 0x811c9dc5 >>> 0, bodies = 0, nodes = 0;
  const mix = (u) => { h = Math.imul(h ^ u, 0x01000193) >>> 0; };
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const num = (v) => { f[0] = v; mix(u[0]); mix(u[1]); };
  const seen = new Set();
  const body = (e) => {
    const b = e?.beamHull?.entity === e ? e.beamHull.body : null;
    if (!b || b.dead || seen.has(b)) return;
    seen.add(b); bodies++;
    const s = b.nodeStore;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
      const a = s[k], w = new Uint32Array(a.buffer, a.byteOffset, s.count * 2);
      for (let i = 0; i < w.length; i++) mix(w[i]);
    }
    nodes += b.activeNodes;
    num(b.pos.x); num(b.pos.y); num(b.pos.z); num(b.vel.x); num(b.vel.y); num(b.vel.z);
  };
  for (const e of ents) body(e);
  for (const w of window.wrecks) body(w);
  if (site) for (const p of site.pieces) { body(p.entity); for (const e of p.islands || []) body(e); }
  return { hash: h.toString(16), bodies, nodes };
}

// ---------------------------------------------------------------------------------------------
// Sceny: każda zwraca czasy kroków (ms), części silnika (solver / kolizje) i hash stanu na końcu.
// ---------------------------------------------------------------------------------------------
function runScene(name) {
  // Krater z budżetu losuje odrzut węzłów Math.random — ten sam ciąg w każdym przebiegu (hash porównywalny).
  let rs = 0x9E3779B9;
  Math.random = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rec = { step: [], solver: [], col: [], phase: [], kSolve: [], kScan: [] };
  let lastSolve = 0, lastScan = 0;
  const t = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
  const push = (ms, ph) => {
    const ks = RT.t.prepare + RT.t.project, kc = RT.t.scan;
    rec.kSolve.push(ks - lastSolve); rec.kScan.push(kc - lastScan); lastSolve = ks; lastScan = kc;
    rec.step.push(ms); rec.solver.push(D.perf.lastSolverMs); rec.col.push(D.perf.lastCollisionMs); rec.phase.push(ph); };
  let ents, site;
  if (name === 'szyja') {
    site = freshHabitat();
    const st = createNeckState();
    const onFx = (ev) => {
      const pa = ev.A?.worldPiece || null, pb = ev.B?.worldPiece || null;
      if (!pa === !pb) return;
      const other = pa ? ev.B : ev.A;
      if (!other || other.isWreck || other.worldDebris) return;
      noteNeckRam(st, pa || pb, other, HullBodies.simTime, ev.x, ev.y);
    };
    CollisionFX.on('impact', onFx); CollisionFX.on('grind', onFx);
    const atlas = ship('atlas', HAB.x + H.drumR + 300 + EXT.nose, HAB.y + 60, Math.PI, ATLAS_MASS);
    atlas.vx = -3000;
    ents = [atlas];
    const ctx = { worldBodies, engine: D, layout: L, habitat: HAB, simTime: 0, onSnap() {}, onImpact() {} };
    const steps = Math.round(18 / DT);
    for (let k = 0; k < steps; k++) {
      const ms = t(() => {
        if (k * DT < 4 && -atlas.vx < 3000) atlas.vx -= 1100 * DT;
        stepAll(ents, DT);
        ctx.simTime = HullBodies.simTime;
        stepNeck(st, site, ctx, DT);
      });
      push(ms, st.phase);
    }
    CollisionFX.off?.('impact', onFx); CollisionFX.off?.('grind', onFx);
    rec.meta = { impactT: +st.impactT.toFixed(2), landT: +st.landT.toFixed(2), snapAt: +st.snapAt.toFixed(2) };
  } else if (name === 'taran') {
    site = freshHabitat();
    const wallY = HAB.y + H.drumR;
    const atlas = ship('atlas', HAB.x, wallY + 300 + EXT.nose, -Math.PI / 2, ATLAS_MASS);
    atlas.vy = -900;
    ents = [atlas];
    const steps = Math.round(6 / DT);
    for (let k = 0; k < steps; k++) {
      const ms = t(() => {
        if (k * DT < 4 && -atlas.vy < 3000) atlas.vy -= 1100 * DT;
        stepAll(ents, DT);
      });
      push(ms, HullBodies.perf.lastContacts > 0 ? 'styk' : 'lot');
    }
  } else if (name === 'ostrzal') {
    worldBodies.reset(); window.wrecks.length = 0; site = null;
    const X0 = 5.3e6, Y0 = 4.2e6;
    const atlas = ship('atlas', X0, Y0 + 3000, -Math.PI / 2, ATLAS_MASS);
    const tgts = [];
    // 4 pancerniki i 8 niszczycieli w trzech rzędach — w bitwie solver lokalny liczy ogony trafień wielu kadłubów naraz
    for (let i = 0; i < 12; i++) {
      const id = i < 4 ? (i % 2 ? 'pirate_battleship' : 'terran_battleship') : 'pirate_destroyer';
      tgts.push(ship(id, X0 - 6000 + (i % 4) * 4000, Y0 - (i >> 2) * 3000, Math.PI / 2, i < 4 ? 600000 : 300000));
    }
    ents = [atlas, ...tgts];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const w = { x: 0, y: 0 };
    const steps = Math.round(10 / DT);
    let hits = 0;
    for (let k = 0; k < steps; k++) {
      const ms = t(() => {
        {
          // salwa co krok: 6 trafień (działko ~ krater z budżetu, co 5. — ciężki pocisk z kraterem na miarę rany)
          for (let q = 0; q < 6; q++) {
            const e = tgts[(rnd() * tgts.length) | 0];
            const b = e.beamHull?.body;
            if (!b || b.dead || b.activeNodes < 30) continue;
            const s = b.nodeStore;
            let i = (rnd() * s.count) | 0, tries = 0;
            while (!s.active[i] && tries++ < 64) i = (i + 1) % s.count;
            if (!s.active[i]) continue;
            HullBodies.nodeWorld(e.beamHull, i, w);
            const heavy = rnd() < 0.2;
            const vx = w.x - atlas.x, vy = w.y - atlas.y, l = Math.hypot(vx, vy) || 1;
            HullBodies.impact(e, w.x, w.y, heavy ? 900 : 120, { x: vx / l * 4000, y: vy / l * 4000 }, heavy ? { craterRadius: 45 } : null);
            hits++;
          }
        }
        stepAll(ents, DT);
      });
      push(ms, 'ostrzał');
    }
    rec.meta = { hits };
  }
  rec.state = stateHash(ents, site);
  release(ents);
  worldBodies.reset();
  return rec;
}

// ---------------------------------------------------------------------------------------------
// Koszt przejścia JS ↔ WASM
// ---------------------------------------------------------------------------------------------
function crossingCost() {
  const N = 5e6;
  const jsNoop = (x) => x;
  const ex = RT.A.exports;
  let acc = 0;
  const run = (fn) => { const t0 = performance.now(); for (let i = 0; i < N; i++) acc += fn(i); return (performance.now() - t0) * 1e6 / N; };
  for (let r = 0; r < 2; r++) { run(jsNoop); run(ex.noop); }
  const js = run(jsNoop), wasm = run(ex.noop);
  // Pełne wywołanie jądra przez dyspozytor (blok parametrów, 23 słowa + 8 f64) przy 0 belek.
  const s = {};
  const a = RT.allocArrays(s, [['positions', Float64Array, 3], ['weights', Float64Array, 1], ['active', Uint8Array, 1],
    ['mountFailed', Uint8Array, 1], ['a', Uint32Array, 1], ['b', Uint32Array, 1], ['rest', Float64Array, 1], ['factor', Float64Array, 1]]);
  Object.assign(s, a);
  const beams = RT.allocArrays({}, ['a', 'b', 'stamp'].map((f) => [f, Int32Array, 1]).concat(
    ['rest', 'restBase', 'stiffness', 'deform', 'brk', 'strain', 'fatigue'].map((f) => [f, Float64Array, 1]),
    ['type', 'broken', 'restBridge'].map((f) => [f, Uint8Array, 1])));
  beams.count = 0;
  const list = RT.allocArrays(null, [['l', Int32Array, 1]]).l;
  const cfg = D.config;
  return import('./js/beamConstraintSolver3D.mjs').then(({ prepareBeamConstraints }) => {
    const mode = RT.mode, chk = RT.check; RT.mode = 'A'; RT.check = false;
    const M = 1e6;
    const one = () => { const t0 = performance.now(); for (let i = 0; i < M; i++) prepareBeamConstraints(s, beams, list, 0, cfg, DT, 0.5, 1, false); return (performance.now() - t0) * 1e6 / M; };
    one(); one();
    const prep = one();
    RT.mode = mode; RT.check = chk;
    return { jsCallNs: +js.toFixed(2), wasmCallNs: +wasm.toFixed(2), prepareDispatchNs: +prep.toFixed(1), acc };
  });
}

// ---------------------------------------------------------------------------------------------
// Pomiar
// ---------------------------------------------------------------------------------------------
const q = (arr, f) => { const a = Float64Array.from(arr).sort(); return a.length ? a[Math.min(a.length - 1, Math.floor(f * (a.length - 1)))] : 0; };
const mean = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
const r2 = (v) => +v.toFixed(3);
const gc = globalThis.gc || (() => {});

const report = { hz: Math.round(1 / DT), rounds: ROUNDS, modes: MODES, node: process.version, scenes: {} };
report.crossing = await crossingCost();
console.log('przejście JS → WASM:', JSON.stringify(report.crossing));

for (const name of SCENES) {
  const runs = Object.fromEntries(MODES.map((m) => [m, []]));
  for (let r = 0; r < ROUNDS; r++) {
    const order = MODES.map((_, k) => MODES[(k + r) % MODES.length]);
    for (const m of order) {
      RT.mode = m; RT.timing = true; RT.resetTimes();
      gc();
      const t0 = performance.now();
      const rec = runScene(name);
      rec.wall = performance.now() - t0;
      rec.kernel = { ...RT.t };
      RT.timing = false;
      if (r > 0) runs[m].push(rec);
      console.log(`${name} runda ${r}${r === 0 ? ' (rozgrzewka)' : ''} ${m}: ${(rec.wall / 1000).toFixed(2)} s, kroki Σ ${mean(rec.step).toFixed(3)} ms/krok, hash ${rec.state.hash} (${rec.state.bodies} ciał, ${rec.state.nodes} węzłów), wasm ${JSON.stringify(RT.stats())}`);
    }
  }
  // Mediana z rund dla każdego kroku, potem statystyki po krokach. Okno piku = kroki, w których JS > p90 JS.
  const steps = runs[MODES[0]][0].step.length;
  const med = (m, key) => { const out = new Float64Array(steps); for (let k = 0; k < steps; k++) out[k] = q(runs[m].map((rr) => rr[key][k]), 0.5); return out; };
  const base = med(MODES[0], 'step');
  const thr = q(base, 0.9);
  const peak = []; for (let k = 0; k < steps; k++) if (base[k] >= thr) peak.push(k);
  const out = { steps, peakSteps: peak.length, peakThresholdMs: r2(thr), meta: runs[MODES[0]][0].meta || null, modes: {} };
  for (const m of MODES) {
    const st = med(m, 'step'), so = med(m, 'solver'), co = med(m, 'col'), ks = med(m, 'kSolve'), kc = med(m, 'kScan');
    const pk = peak.map((k) => st[k]);
    const kern = (key) => r2(q(runs[m].map((rr) => rr.kernel[key]), 0.5) / steps);
    out.modes[m] = {
      meanMs: r2(mean(st)), p50Ms: r2(q(st, 0.5)), p95Ms: r2(q(st, 0.95)), maxMs: r2(Math.max(...st)),
      peakMeanMs: r2(mean(pk)), peakSolverMs: r2(mean(peak.map((k) => so[k]))), peakCollisionMs: r2(mean(peak.map((k) => co[k]))),
      solverMs: r2(mean(so)), collisionMs: r2(mean(co)),
      kernelMs: { solve: r2(mean(ks)), scan: r2(mean(kc)) },
      peakKernelMs: { solve: r2(mean(peak.map((k) => ks[k]))), scan: r2(mean(peak.map((k) => kc[k]))) },
      kernelMsPerStep: { prepare: kern('prepare'), project: kern('project'), scan: kern('scan') },
      callsPerStep: { prepare: kern('nPrepare') * 1, project: kern('nProject') * 1, scan: kern('nScan') * 1 },
      wallS: r2(q(runs[m].map((rr) => rr.wall), 0.5) / 1000),
      hashes: [...new Set(runs[m].map((rr) => rr.state.hash))]
    };
  }
  const h0 = out.modes[MODES[0]].hashes;
  out.bitExact = Object.fromEntries(MODES.map((m) => [m, out.modes[m].hashes.length === 1 && out.modes[m].hashes[0] === h0[0]]));
  report.scenes[name] = out;
  console.log(`\n== ${name}: ${steps} kroków, okno piku ${peak.length} kroków (JS ≥ ${r2(thr)} ms)`);
  for (const m of MODES) {
    const o = out.modes[m], b = out.modes[MODES[0]];
    console.log(`  ${m.padEnd(3)} śr ${o.meanMs} (×${(b.meanMs / o.meanMs).toFixed(2)})  p50 ${o.p50Ms}  p95 ${o.p95Ms} (×${(b.p95Ms / o.p95Ms).toFixed(2)})  max ${o.maxMs}  pik ${o.peakMeanMs} (×${(b.peakMeanMs / o.peakMeanMs).toFixed(2)}; solver ${o.peakSolverMs}, kolizje ${o.peakCollisionMs}, jądra w piku ${JSON.stringify(o.peakKernelMs)})  jądra/krok ${JSON.stringify(o.kernelMs)} wywołania/krok ${JSON.stringify(o.callsPerStep)}  bit w bit: ${out.bitExact[m]}`);
  }
  console.log('');
}
const outPath = arg('out', '');
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
