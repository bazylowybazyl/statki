// beamConstraintSolver3D z przełącznikiem trybu: 'js' — oryginalne funkcje z src (bez zmian), 'A' / 'B' — jądra
// Rust → WASM na tych samych tablicach (bufory robocze solvera w pamięci WASM). Wskaźniki idą przez blok
// parametrów (RT.P / RT.F) — jedno wywołanie eksportu na funkcję, bez kopiowania danych.
import { RT } from './runtime.mjs';
import * as orig from '../../../src/game/beamConstraintSolver3D.js?orig';

export const refreshBeamMounts = orig.refreshBeamMounts;

export function beamSolverScratch(body) {
  const nc = body.nodeStore.count, bc = body.beamStore.count;
  let s = body._solverScratch;
  if (!s || s.weights.length < nc || s.rest.length < bc) {
    s = body._solverScratch = {};
    const a = RT.allocArrays(s, [['positions', Float64Array, nc * 3], ['weights', Float64Array, nc], ['active', Uint8Array, nc],
      ['localSupport', Uint16Array, nc], ['mountFailed', Uint8Array, nc], ['a', Uint32Array, bc], ['b', Uint32Array, bc],
      ['rest', Float64Array, bc], ['factor', Float64Array, bc]]);
    // Kolejność pól jak w oryginale (kształt obiektu).
    s.positions = a.positions; s.weights = a.weights; s.active = a.active;
    s.localSupport = a.localSupport; s.mountFailed = a.mountFailed;
    s.a = a.a; s.b = a.b; s.rest = a.rest; s.factor = a.factor;
  }
  return s;
}

const P = RT.P, F = RT.F;
const off = (t) => t.byteOffset;
function check(...arrs) {
  for (const t of arrs) if (t && !RT.inWasm(t)) throw new Error('rust-beams: tablica spoza pamięci WASM');
}

// Wolna ścieżka tylko dla testów, które podają kopie tablic spoza pamięci WASM (np. .slice() w
// tests/beamLocalSolverExact.test.mjs): kopia do pamięci WASM, wywołanie, kopia z powrotem.
const SCRATCH_KEYS = ['positions', 'weights', 'active', 'mountFailed', 'a', 'b', 'rest', 'factor'];
const BEAM_KEYS = ['a', 'b', 'broken', 'type', 'rest', 'restBase', 'deform', 'brk', 'strain', 'fatigue', 'stiffness'];
function staged(objs, fn) {
  const back = [];
  const out = objs.map(([o, keys]) => {
    if (!o) return o;
    const c = Array.isArray(o) || ArrayBuffer.isView(o) ? null : { ...o };
    const one = (t) => {
      if (!t || RT.inWasm(t)) return t;
      const w = RT.allocArrays({}, [['t', t.constructor, t.length]]).t;
      w.set(t); back.push([t, w]); return w;
    };
    if (!c) return one(o);
    for (const k of keys) c[k] = one(o[k]);
    return c;
  });
  const r = fn(...out);
  for (const [t, w] of back) t.set(w);
  return [r, out];
}
const needsStage = (s, beams, list) => !RT.inWasm(s.positions) || !RT.inWasm(s.a) || !RT.inWasm(s.rest) || (beams && !RT.inWasm(beams.rest)) || (list && !RT.inWasm(list));

function setScratch(s) {
  P[0] = off(s.positions); P[1] = off(s.weights); P[2] = off(s.active); P[3] = off(s.mountFailed);
  P[4] = off(s.a); P[5] = off(s.b); P[6] = off(s.rest); P[7] = off(s.factor);
}

function wasmPrepare(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq, flat) {
  if (needsStage(s, beams, list)) {
    const [r, [sc]] = staged([[s, SCRATCH_KEYS], [beams, BEAM_KEYS], [list, null]],
      (sc, bs, ls) => wasmPrepare(sc, bs, ls, listCount, cfg, dt, plasticRate, stepScaleSq, flat));
    s.count = sc.count; s.deformed = sc.deformed;
    return r;
  }
  if (RT.check) check(s.positions, s.weights, s.active, s.mountFailed, s.a, s.b, s.rest, s.factor, beams.a, beams.b,
    beams.broken, beams.type, beams.rest, beams.restBase, beams.deform, beams.brk, beams.strain, beams.fatigue, beams.stiffness, list);
  setScratch(s);
  P[8] = off(beams.a); P[9] = off(beams.b); P[10] = off(beams.broken); P[11] = off(beams.type);
  P[12] = off(beams.rest); P[13] = off(beams.restBase); P[14] = off(beams.deform); P[15] = off(beams.brk);
  P[16] = off(beams.strain); P[17] = off(beams.fatigue); P[18] = off(beams.stiffness);
  P[19] = list ? off(list) : 0;
  P[20] = list ? listCount : beams.count;
  P[21] = (cfg.breakEnabled | 0) === 1 ? 1 : 0;
  P[22] = flat ? 1 : 0;
  F[0] = cfg.globalStiffnessMul; F[1] = cfg.globalBreakMul; F[2] = cfg.plasticFatigue;
  F[3] = 1 - cfg.maxRestDrift; F[4] = 1 + cfg.maxRestDrift; F[5] = dt; F[6] = plasticRate; F[7] = stepScaleSq;
  const brokenNow = RT.exports.prepare(RT.PARAM, RT.PF);
  s.count = P[30];
  s.deformed = P[31] === 1;
  return brokenNow;
}

function wasmProject(s, count, iterations, flat) {
  if (needsStage(s, null, null)) return staged([[s, SCRATCH_KEYS]], (sc) => wasmProject(sc, count, iterations, flat))[0];
  if (RT.check) check(s.positions, s.weights, s.a, s.b, s.rest, s.factor);
  setScratch(s);
  P[30] = count;
  return RT.exports.project(RT.PARAM, iterations, flat ? 1 : 0);
}

const now = () => performance.now();

export function prepareBeamConstraints(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq, flat = false) {
  const t0 = RT.timing ? now() : 0;
  const r = RT.mode === 'js' ? orig.prepareBeamConstraints(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq, flat)
    : wasmPrepare(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq, flat);
  if (RT.timing) { RT.t.prepare += now() - t0; RT.t.nPrepare++; }
  return r;
}

export function projectBeamConstraints(s, count, iterations) {
  const t0 = RT.timing ? now() : 0;
  const r = RT.mode === 'js' ? orig.projectBeamConstraints(s, count, iterations) : wasmProject(s, count, iterations, false);
  if (RT.timing) { RT.t.project += now() - t0; RT.t.nProject++; }
  return r;
}

export function projectBeamConstraints2D(s, count, iterations) {
  const t0 = RT.timing ? now() : 0;
  const r = RT.mode === 'js' ? orig.projectBeamConstraints2D(s, count, iterations) : wasmProject(s, count, iterations, true);
  if (RT.timing) { RT.t.project += now() - t0; RT.t.nProject++; }
  return r;
}
