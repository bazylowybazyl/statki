// src/3d/swarm/swarmClassTable.js
//
// TABLICA KLAS DRONÓW ROJU (uniformArray vec4, stała nazwa bloku) — wspólna dla symulacji GPU
// (swarmSim.js: lot, zasięgi do unikania, miejsca w chwycie), bryły (swarmDrones.tsl.js: ramiona,
// teleskop, chwytaki) i świateł. Wiersze klasy k od k · SWARM_CLASS_ROWS (src/data/swarmDrones.js —
// źródło liczb):
//   0  kadłub L, W, H, gap            1  chwyt L, W, H (warstwa płasko), grubość ramienia
//   2  chwytak, silniki, ramiona, pierwszeństwo
//   3  lot: vMax, przyspieszenie, vPion, przyspieszenie pionowe
//   4  kurs: prędkość, przyspieszenie; promień gniazda; kontenery w chwycie
//   5  zasięg pusty: rh, dół, góra, obrys x   6  zasięg z ładunkiem: rh, dół, góra, obrys y
//   7  obrys pusty (półosie x, y) do testu kolizji, chwyt nx, ny (kontenery wzdłuż / w poprzek)
//   8…57  ramiona (10 × 5): [bark xyz, l1], [nadgarstek w chwycie xyz, l2 w chwycie],
//         [azymut, θ1, przedramię — złożone, aktywne], [azymut, θ1, przedramię — chwyt (IK raz na
//         CPU), tuleja = l2 złożonego], [rozstaw chwytaka podwójnego (0 — pojedynczy), wysuw od e,
//         wysuw do e, —]
//   58…69 światła (12): lewe, prawe, stroboskop, stan, silniki 0–3, RCS 0–3 — [x, y, z, promień]
import * as THREE from 'three/webgpu';
import { uniformArray } from 'three/tsl';
import { SWARM_ARM_REACH, SWARM_DRONE_CLASS_LIST, SWARM_JAW_REACH, SWARM_MAX_ARMS, swarmArmPose } from '../../data/swarmDrones.js';

export const SWARM_ARM_ROWS = 5;
export const SWARM_CLASS_ROW = Object.freeze({
  BODY: 0, PAYLOAD: 1, PARTS: 2, FLIGHT: 3, YAW: 4, EXT_EMPTY: 5, EXT_LOADED: 6, FOOT_EMPTY: 7, ARMS: 8,
  LIGHTS: 8 + SWARM_MAX_ARMS * SWARM_ARM_ROWS
});
export const SWARM_CLASS_ROWS = SWARM_CLASS_ROW.LIGHTS + 12;
export const SWARM_LIGHT_SLOT = Object.freeze({ NAV_L: 0, NAV_R: 1, STROBE: 2, STATUS: 3, ENGINE: 4, RCS: 8 });

/**
 * Obrys pustego drona z góry (półosie) — kadłub z dyszami, złożone ramiona (szczęki zamknięte),
 * obudowy barków, bloki RCS. Musi się mieścić w obrysie warstwy klasy (+ zapas unikania): pusty dron
 * schodzi w szyb kolumny 1 j. obok pracującego (wagon — dwa chwyty Capital na warstwę slotu).
 */
export function swarmEmptyFootprint(cls) {
  let hx = cls.body.L / 2 + 0.12 * cls.body.H + 0.05 * cls.body.L;
  let hy = cls.body.W / 2 + 0.06 * cls.body.W;
  const r = SWARM_ARM_REACH * cls.armBeam;
  const j = SWARM_JAW_REACH * cls.armBeam;
  for (const a of cls.arms) {
    const p = swarmArmPose(a, 0, {});
    const foot = a.twin > 0 ? a.twin / 2 + 0.55 * cls.armBeam : 0.63 * cls.armBeam;
    hx = Math.max(hx, Math.abs(p.elbow[0]) + r, Math.abs(p.wrist[0]) + foot, Math.abs(a.shoulder[0]) + 1.1 * cls.armBeam);
    hy = Math.max(hy, Math.abs(p.elbow[1]) + r, Math.abs(p.wrist[1]) + j, Math.abs(a.shoulder[1]) + r);
  }
  return { hx, hy };
}

/** Wiersze tablicy (Float32Array 4 × SWARM_CLASS_ROWS × liczba klas) — też do testów. */
export function swarmClassTableRows() {
  const out = new Float32Array(SWARM_DRONE_CLASS_LIST.length * SWARM_CLASS_ROWS * 4);
  for (const cls of SWARM_DRONE_CLASS_LIST) {
    const base = cls.index * SWARM_CLASS_ROWS;
    const set = (row, a, b, c, d) => { const o = (base + row) * 4; out[o] = a; out[o + 1] = b; out[o + 2] = c; out[o + 3] = d; };
    const R = SWARM_CLASS_ROW;
    set(R.BODY, cls.body.L, cls.body.W, cls.body.H, cls.body.gap);
    set(R.PAYLOAD, cls.payload.L, cls.payload.W, cls.payload.H, cls.armBeam);
    set(R.PARTS, cls.clawLen, cls.engineCount, cls.armCount, cls.priority);
    set(R.FLIGHT, cls.flight.vMax, cls.flight.accel, cls.flight.vVert, cls.flight.accelVert);
    set(R.YAW, cls.flight.yawRate, cls.flight.yawAccel, cls.padRadius, cls.volume);
    const fp = swarmEmptyFootprint(cls);
    set(R.EXT_EMPTY, cls.extents.empty.rh, cls.extents.empty.zLo, cls.extents.empty.zHi, fp.hx);
    set(R.EXT_LOADED, cls.extents.loaded.rh, cls.extents.loaded.zLo, cls.extents.loaded.zHi, fp.hy);
    set(R.FOOT_EMPTY, fp.hx, fp.hy, cls.pack.nx, cls.pack.ny);
    for (let k = 0; k < SWARM_MAX_ARMS; k++) {
      const a = cls.arms[k];
      const r = R.ARMS + k * SWARM_ARM_ROWS;
      if (!a) {
        set(r, 0, 0, 0, 1); set(r + 1, 0, 0, 0, 1); set(r + 2, 0, 0, 0, 0); set(r + 3, 0, 0, 0, 1); set(r + 4, 0, 0.35, 0.95, 0);
        continue;
      }
      set(r, a.shoulder[0], a.shoulder[1], a.shoulder[2], a.l1);
      set(r + 1, a.grip[0], a.grip[1], a.grip[2], a.l2Grip);
      set(r + 2, a.foldPhi, a.foldTheta1, a.foldFore, 1);
      set(r + 3, a.gripPhi, a.gripTheta1, a.gripFore, a.sleeve);
      set(r + 4, a.twin, a.extA, a.extB, 0);
    }
    const Lp = cls.lights;
    const lights = [Lp.navLeft, Lp.navRight, Lp.strobe, Lp.status];
    for (let k = 0; k < 4; k++) lights.push(Lp.engines[k] || [0, 0, 0, 0]);
    for (let k = 0; k < 4; k++) lights.push(Lp.rcs[k] || [0, 0, 0, 0]);
    for (let k = 0; k < 12; k++) set(R.LIGHTS + k, lights[k][0], lights[k][1], lights[k][2], lights[k][3]);
  }
  return out;
}

let _node = null;
/** Węzeł tablicy (jeden na stronę; ta sama nazwa bloku we wszystkich materiałach i kernelach). */
export function swarmClassTable() {
  if (_node) return _node;
  const rows = swarmClassTableRows();
  const list = [];
  for (let i = 0; i < rows.length; i += 4) list.push(new THREE.Vector4(rows[i], rows[i + 1], rows[i + 2], rows[i + 3]));
  _node = uniformArray(list, 'vec4').setName('swarmClassTable');
  return _node;
}
