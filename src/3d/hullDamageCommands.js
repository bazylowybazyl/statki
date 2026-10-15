// src/3d/hullDamageCommands.js
//
// Dekoder rekordów mapy ran (RW-22, src/render/hullCommands.js) po stronie RENDERU: z rekordu buduje zastępnik
// kadłuba (pola, które czytają HullDamageMap i SolidWounds; poza z rekordu) i wynik haka, i woła te same funkcje
// mapy ran co dawne wywołania gry — ten sam kod stempli, więc obraz bit w bit. Wzór: src/3d/weapons/weaponFxCommands.js.

import { HullDamageMap } from './hullDamageMap.js';
import { fxRandom } from './fx/fxRandom.js';
import { SparkSystem3D } from './sparkSystem3D.js';
import {
  HC, HULL_DEBRIS, SPARK_BURST, SPARK_SEAM, DMG_HOOK, DMG_TEAR, DMG_SOLID_TEAR, DMG_REPAIR, DMG_PATCH, DMG_KERF, KERF_MAX, createHullProxy, readHullDesc
} from '../render/hullCommands.js';

const _proxy = createHullProxy();
// Wynik haka (pola hullImpactResult, które czyta HullDamageMap.onHullImpact / SolidWounds.onImpact).
const _r = {
  kind: '', killed: 0, radius: 0, u: 0, v: 0, x: 0, y: 0, dmgKey: 0, dirX: 0, dirY: 0, len: 0, crater: 0,
  latX: 0, latY: 0, latZ: 0
};
const _world = { x: 0, y: 0 };
const _kerfPre = { u0: 0, v0: 0, lat: new Float64Array(KERF_MAX * 4) };
let _seam = new Float32Array(64);

/** Rejestruje obsługę rekordów mapy ran w czytelniku rozkazów (RenderCommands.reader). */
export function installHullDamageCommands(reader) {
  reader.on(HC.DMG_HOOK, (rd, d, o) => {
    const H = DMG_HOOK;
    const hull = readHullDesc(d, o + H.HULL, _proxy, rd.ent(d, o + H.HULL));
    const r = _r;
    r.kind = d[o + H.KIND] === 1 ? 'cut' : 'impact';
    r.x = d[o + H.X]; r.y = d[o + H.Y]; r.u = d[o + H.U]; r.v = d[o + H.V];
    r.dirX = d[o + H.DIR_X]; r.dirY = d[o + H.DIR_Y]; r.len = d[o + H.LEN];
    r.killed = d[o + H.KILLED]; r.radius = d[o + H.RADIUS]; r.crater = d[o + H.CRATER];
    r.latX = d[o + H.LAT_X]; r.latY = d[o + H.LAT_Y]; r.latZ = d[o + H.LAT_Z];
    r.dmgKey = d[o + H.R_KEY];
    const M = HullDamageMap;
    const prev = M._src.active;
    if (d[o + H.SRC]) M.setSourceRaw(rd.str(d[o + H.FAMILY]), rd.str(d[o + H.VARIANT]), d[o + H.POWER], d[o + H.FLAK_R]);
    else M._src.active = false;
    M.onHullImpact(hull.entity, r);
    M._src.active = prev;
  });

  reader.on(HC.DMG_TEAR, (rd, d, o) => {
    const T = DMG_TEAR;
    const hull = readHullDesc(d, o + T.HULL, _proxy, null);
    HullDamageMap.onHullNodeLost(hull.entity, hull, d[o + T.U], d[o + T.V], d[o + T.X], d[o + T.Y]);
  });

  reader.on(HC.DMG_SOLID_TEAR, (rd, d, o) => {
    const T = DMG_SOLID_TEAR;
    const hull = readHullDesc(d, o + T.HULL, _proxy, null);
    HullDamageMap.onSolidNodeLost(hull.entity, hull, d[o + T.IX], d[o + T.IY], d[o + T.IZ], d[o + T.X], d[o + T.Y]);
  });

  reader.on(HC.DMG_REPAIR, (rd, d, o) => {
    const R = DMG_REPAIR;
    const hull = readHullDesc(d, o + R.HULL, _proxy, null);
    HullDamageMap.onHullRepair(hull.entity, d[o + R.DT], d[o + R.CHANGED] === 1);
  });

  reader.on(HC.DMG_PATCH, (rd, d, o) => {
    const P = DMG_PATCH;
    const hull = readHullDesc(d, o + P.HULL, _proxy, null);
    let world = null;
    if (d[o + P.HAS_W]) { _world.x = d[o + P.WX]; _world.y = d[o + P.WY]; world = _world; }
    const seam = d[o + P.SEAM];
    HullDamageMap.patchCell(hull.entity, d[o + P.IX], d[o + P.IY], Number.isNaN(seam) ? undefined : seam, world);
  });

  reader.on(HC.DMG_KERF, (rd, d, o) => {
    const K = DMG_KERF;
    const hull = readHullDesc(d, o + K.HULL, _proxy, null);
    _kerfPre.u0 = d[o + K.U0];
    _kerfPre.v0 = d[o + K.V0];
    const lat = _kerfPre.lat;
    for (let i = 0; i < KERF_MAX * 4; i++) lat[i] = d[o + K.LAT + i];
    HullDamageMap.stampKerf(hull.entity, d[o + K.X0], d[o + K.Y0], d[o + K.X1], d[o + K.Y1], rd.str(d[o + K.FAMILY]), _kerfPre);
  });

  // Odłamek węzła: losowanie skali i kształtownika w strumieniu efektów (ta sama kolejność losowań co dawniej
  // w hullBodies.js — kształtownik losowany tylko przy kandydacie), potem pula odłamków (hullDebris3D.js).
  reader.on(HC.HULL_DEBRIS, (rd, d, o) => {
    const D = HULL_DEBRIS;
    const spawn = typeof window !== 'undefined' ? window.spawnHullDebris : null;
    if (typeof spawn !== 'function') return;
    const cell = d[o + D.CELL];
    if (d[o + D.SOLID]) {
      const scale3 = cell * (0.6 + fxRandom.next() * 0.7);
      spawn(d[o + D.X], d[o + D.Y], d[o + D.VX], d[o + D.VY], d[o + D.R], d[o + D.G], d[o + D.B], scale3,
        fxRandom.next() < 0.4, d[o + D.Z], d[o + D.VZ]);
      return;
    }
    const scale = cell * (0.9 + fxRandom.next() * 0.9);
    const structural = d[o + D.STRUCT] === 1 && fxRandom.next() < 0.4;
    spawn(d[o + D.X], d[o + D.Y], d[o + D.VX], d[o + D.VY], d[o + D.R], d[o + D.G], d[o + D.B], scale, structural);
  });

  // Iskry kadłubów (budżet policzony w grze): snop i szew → SparkSystem3D (te same argumenty co dawne wywołania).
  reader.on(HC.SPARK_BURST, (rd, d, o) => {
    const S = SPARK_BURST;
    SparkSystem3D.grindingBurst(d[o + S.X], d[o + S.Y], d[o + S.NX], d[o + S.NY], d[o + S.TX], d[o + S.TY],
      d[o + S.APPROACH], d[o + S.SLIDE], d[o + S.BVX], d[o + S.BVY], d[o + S.COUNT], d[o + S.GAIN]);
  });
  reader.on(HC.SPARK_SEAM, (rd, d, o) => {
    const S = SPARK_SEAM;
    const n = d[o + S.N];
    if (_seam.length < n * 4) _seam = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) _seam[i] = d[o + S.POINTS + i];
    // Bufor pokrywa dokładnie n punktów (grindingSeam bierze min(pointCount, długość / 4)).
    const pts = _seam.length === n * 4 ? _seam : _seam.subarray(0, n * 4);
    SparkSystem3D.grindingSeam(pts, n, d[o + S.TX], d[o + S.TY], d[o + S.APPROACH], d[o + S.SLIDE],
      d[o + S.BVX], d[o + S.BVY], d[o + S.COUNT], d[o + S.GAIN]);
  });

  return reader;
}
