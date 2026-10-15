// src/render/blocks/repairBlock.js — blok migawki: rój dronów naprawczych (docs/PLAN-render-worker.md § 3.2, RW-11b).
//
// Obraz roju (`src/3d/repair/repairDrones3D.js`: syncRepairDrones3D) czyta `RepairSwarm` gry: rigi (nosiciel, cel,
// liczba dronów w powietrzu, zegar, strojenie), drony (stan, układ, poza w układzie, chwytak, płyta, spaw, ciąg,
// zadanie) i pierścień zdarzeń `fx` (render pamięta własny odczyt per rig — WeakMap po rigu). Blok niesie to w
// Float64 o zmiennej długości; lustro rigu ma stałą tożsamość (numer obiektu rigu gry), pierścień zdarzeń lustra
// dostaje wpisy dopisane od ostatniej strony, pod tymi samymi indeksami (fxWrite jak w grze).
//
// Rejestracja (strona gry): `packer.addBlock(createRepairBlock())`, w klatce `frame.repair = RepairSwarm`.
// Strona renderu: `applyRepairBlock(view.blocks.repair, mirrors, state)` → lustro `{ rigs, out }` dla
// syncRepairDrones3D. Czysty moduł (bez three, DOM i `window`).

export const REPAIR_BLOCK = Object.freeze({
  HEAD: 3,                         // [liczba rigów, out roju, słowa użyte]
  RIG: Object.freeze({ ID: 0, CARRIER_SLOT: 1, CARRIER_GEN: 2, TARGET_SLOT: 3, TARGET_GEN: 4, OUT: 5, TIME: 6,
    FX_WRITE: 7, DRONE_N: 8, FX_N: 9, DRONE_LENGTH: 10, WELD_TIME: 11, PLATE_FORWARD: 12, STRIDE: 13 }),
  DRONE: Object.freeze({ INDEX: 0, STATE: 1, FRAME: 2, LX: 3, LY: 4, LZ: 5, YAW: 6, HIT_T: 7, ARM: 8, PLATE: 9,
    WELD: 10, THRUST: 11, JOB: 12, JOB_TIMER: 13, STRIDE: 14 }),
  FX: Object.freeze({ AT: 0, KIND: 1, X: 2, Y: 3, Z: 4, A: 5, DRONE: 6, T: 7, STRIDE: 8 }),
  FX_CAP: 64,
  WORDS: 2048
});

const R = REPAIR_BLOCK.RIG, D = REPAIR_BLOCK.DRONE, X = REPAIR_BLOCK.FX;
const num = (v) => (typeof v === 'number' ? v : NaN);

/** Blok do `packer.addBlock` (faza begin). */
export function createRepairBlock() {
  const rigIds = new WeakMap();
  let rigSeq = 0;
  const fxSent = new WeakMap();      // rig → fxWrite z ostatniej spakowanej strony
  return {
    name: 'repair', f64: REPAIR_BLOCK.WORDS, phase: 'begin',
    pack(blk, frame, packer) {
      const F = blk.f64;
      const sw = frame.repair;
      const rigs = sw && Array.isArray(sw.rigs) ? sw.rigs : null;
      const ents = packer.ids.entities;
      let o = REPAIR_BLOCK.HEAD, n = 0;
      if (rigs) {
        for (let r = 0; r < rigs.length; r++) {
          const rig = rigs[r];
          if (!rig) continue;
          const drones = Array.isArray(rig.drones) ? rig.drones : [];
          const fw = rig.fxWrite | 0;
          const sent = fxSent.has(rig) ? fxSent.get(rig) : Math.max(0, fw - REPAIR_BLOCK.FX_CAP);
          const fxN = Math.min(REPAIR_BLOCK.FX_CAP, Math.max(0, fw - sent));
          const need = R.STRIDE + drones.length * D.STRIDE + fxN * X.STRIDE;
          if (o + need > F.length) { packer.resizeBlock('repair', { f64: (o + need) * 2 }); break; }
          let id = rigIds.get(rig);
          if (id === undefined) { id = ++rigSeq; rigIds.set(rig, id); }
          const cs = rig.carrier ? ents.peek(rig.carrier) : -1;
          const ts = rig.target ? ents.peek(rig.target) : -1;
          F[o + R.ID] = id;
          F[o + R.CARRIER_SLOT] = cs; F[o + R.CARRIER_GEN] = cs >= 0 ? ents.gen(cs) : 0;
          F[o + R.TARGET_SLOT] = ts; F[o + R.TARGET_GEN] = ts >= 0 ? ents.gen(ts) : 0;
          F[o + R.OUT] = num(rig.out); F[o + R.TIME] = num(rig.time); F[o + R.FX_WRITE] = fw;
          F[o + R.DRONE_N] = drones.length; F[o + R.FX_N] = fxN;
          const tune = rig.tune || null;
          F[o + R.DRONE_LENGTH] = tune ? num(tune.droneLength) : NaN;
          F[o + R.WELD_TIME] = tune ? num(tune.weldTime) : NaN;
          F[o + R.PLATE_FORWARD] = tune ? num(tune.plateForward) : NaN;
          let p = o + R.STRIDE;
          for (let i = 0; i < drones.length; i++, p += D.STRIDE) {
            const d = drones[i];
            F[p + D.INDEX] = num(d.index); F[p + D.STATE] = num(d.state); F[p + D.FRAME] = num(d.frame);
            F[p + D.LX] = num(d.lx); F[p + D.LY] = num(d.ly); F[p + D.LZ] = num(d.lz); F[p + D.YAW] = num(d.yaw);
            F[p + D.HIT_T] = num(d.hitT); F[p + D.ARM] = num(d.arm); F[p + D.PLATE] = num(d.plate);
            F[p + D.WELD] = num(d.weld); F[p + D.THRUST] = num(d.thrust); F[p + D.JOB] = num(d.job);
            F[p + D.JOB_TIMER] = num(d.jobTimer);
          }
          const ring = rig.fx;
          for (let k = fw - fxN; k < fw; k++, p += X.STRIDE) {
            const at = k % REPAIR_BLOCK.FX_CAP;
            const f = ring[at];
            F[p + X.AT] = k;
            F[p + X.KIND] = num(f.kind); F[p + X.X] = num(f.x); F[p + X.Y] = num(f.y); F[p + X.Z] = num(f.z);
            F[p + X.A] = num(f.a); F[p + X.DRONE] = num(f.drone); F[p + X.T] = num(f.t);
          }
          fxSent.set(rig, fw);
          o = p;
          n++;
        }
      }
      F[0] = n;
      F[1] = sw ? num(sw.out) : 0;
      F[2] = o;
    }
  };
}

/**
 * Lustro roju ze strony: `state` = { rigs: [], out: 0, _rigs: Map } (trzymane przez wołającego), encje → lustra
 * (`entityAt(slot, gen)`). Zwraca `state`.
 */
export function applyRepairBlock(blk, entityAt, state) {
  const F = blk.f64;
  const out = state.rigs;
  out.length = 0;
  const n = F[0] | 0;
  state.out = F[1];
  let o = REPAIR_BLOCK.HEAD;
  const seen = state._seen || (state._seen = new Set());
  seen.clear();
  for (let r = 0; r < n; r++) {
    const id = F[o + R.ID];
    let rig = state._rigs.get(id);
    if (!rig) {
      rig = { id, carrier: null, target: null, out: 0, time: 0, fxWrite: 0, launched: false,
        tune: { droneLength: 0, weldTime: 0, plateForward: 0 }, drones: [], fx: [] };
      for (let i = 0; i < REPAIR_BLOCK.FX_CAP; i++) rig.fx.push({ kind: 0, x: 0, y: 0, z: 0, a: 0, drone: -1, t: 0 });
      state._rigs.set(id, rig);
    }
    seen.add(id);
    rig.carrier = entityAt(F[o + R.CARRIER_SLOT], F[o + R.CARRIER_GEN]);
    rig.target = entityAt(F[o + R.TARGET_SLOT], F[o + R.TARGET_GEN]);
    rig.out = F[o + R.OUT]; rig.time = F[o + R.TIME]; rig.fxWrite = F[o + R.FX_WRITE];
    rig.tune.droneLength = F[o + R.DRONE_LENGTH]; rig.tune.weldTime = F[o + R.WELD_TIME];
    rig.tune.plateForward = F[o + R.PLATE_FORWARD];
    const dn = F[o + R.DRONE_N] | 0, fxN = F[o + R.FX_N] | 0;
    const drones = rig.drones;
    drones.length = dn;
    let p = o + R.STRIDE;
    for (let i = 0; i < dn; i++, p += D.STRIDE) {
      let d = drones[i];
      if (!d) { d = { index: 0, state: 0, frame: 0, lx: 0, ly: 0, lz: 0, yaw: 0, hitT: 0, arm: 0, plate: 0, weld: 0, thrust: 0, job: 0, jobTimer: 0 }; drones[i] = d; }
      d.index = F[p + D.INDEX]; d.state = F[p + D.STATE]; d.frame = F[p + D.FRAME];
      d.lx = F[p + D.LX]; d.ly = F[p + D.LY]; d.lz = F[p + D.LZ]; d.yaw = F[p + D.YAW]; d.hitT = F[p + D.HIT_T];
      d.arm = F[p + D.ARM]; d.plate = F[p + D.PLATE]; d.weld = F[p + D.WELD]; d.thrust = F[p + D.THRUST];
      d.job = F[p + D.JOB]; d.jobTimer = F[p + D.JOB_TIMER];
    }
    for (let k = 0; k < fxN; k++, p += X.STRIDE) {
      const f = rig.fx[F[p + X.AT] % REPAIR_BLOCK.FX_CAP];
      f.kind = F[p + X.KIND]; f.x = F[p + X.X]; f.y = F[p + X.Y]; f.z = F[p + X.Z];
      f.a = F[p + X.A]; f.drone = F[p + X.DRONE]; f.t = F[p + X.T];
    }
    o = p;
    out.push(rig);
  }
  for (const id of state._rigs.keys()) if (!seen.has(id)) state._rigs.delete(id);
  return state;
}

export function createRepairMirrorState() {
  return { rigs: [], out: 0, _rigs: new Map(), _seen: null };
}
