// src/game/hullDamageEvents.js
//
// Zdarzenia mapy ran kadłubów po stronie GRY (RW-22, docs/PLAN-render-worker.md § 3.3 „uzupełnienie 2026-10-15”,
// § 2.6 p. 25–26): haki silnika belek (HullBodies.onImpact / onNodeLost / onSolidNodeLost / onRepair), łaty roju
// naprawczego, rzazy przebić i źródło trafienia idą rekordami strumienia rozkazów (src/render/renderCommands.js +
// układy src/render/hullCommands.js) zamiast wywołań HullDamageMap. W chwili zdarzenia gra liczy to, o co mapa ran
// pytała silnik belek (poza encji, uv skóry, komórki kratownicy brył, środek komórki łaty) — render dostaje liczby,
// nie żywy kadłub. Tryb inline: rekord dyspozytor wykonuje od razu (ta sama kolejność co dawne wywołania — haki z
// fizyki przed recepturami efektów tej samej klatki, deduplikacja krater ↔ receptura bez zmian).

import { HullBodies, hullSpriteRotation } from './hullBodies.js';
import {
  HC, HULL_DEBRIS, STATION_FX, STATION_FX_KIND, DMG_HOOK, DMG_TEAR, DMG_SOLID_TEAR, DMG_REPAIR, DMG_PATCH, DMG_KERF, KERF_MAX, writeHullDesc
} from '../render/hullCommands.js';
import {
  stampFamilyFor, stampPowerFor, stampFlakRadiusFor
} from '../3d/hullDamageStamps.js';

// Długość kroku znaków rzazu (= DMG_KERF_STEP w hullDamageMap.js; pilnuje test) — liczba komórek brył na odcinek.
export const KERF_STEP = 22;

function entityAngleTheta(e) {
  // Kąt skóry jak HullBodies.entityPose: θ = −(kąt + obrót sprite'a).
  return -((Number(e?.angle) || 0) + hullSpriteRotation(e));
}

/**
 * Pisarz zdarzeń mapy ran na pisarzu rozkazów RW-21 (`RenderCommands.writer`).
 */
export function createHullDamageEvents(writer) {
  // Źródło trafienia najbliższego haka (dawniej HullDamageMap.setSource — stan renderu): rodzina, wariant, moc, flak.
  const src = { active: false, family: 'generic', variant: 'impact', power: 1, flakR: 0 };

  function desc(d, o, entity, hull) {
    const ent = writer.ids.entities;
    let slot = -1, gen = 0;
    if (entity && typeof entity === 'object') { slot = ent.slotOf(entity); gen = ent.gen(slot); }
    writeHullDesc(d, o, hull, slot, gen, entityAngleTheta(entity));
  }

  const api = {
    source: src,

    /** Źródło stempla dla najbliższego haka onImpact (pocisk gry, opis broni albo id / rodzina), wariant 18-B. */
    setSource(s, variant = 'impact') {
      src.active = true;
      src.family = stampFamilyFor(s);
      src.variant = variant || 'impact';
      src.power = stampPowerFor(s);
      src.flakR = stampFlakRadiusFor(s);
    },
    clearSource() { src.active = false; },

    /** HullBodies.onImpact (krater / rzaz; ciało płaskie i bryła 3D) — `r` = hullImpactResult. */
    impact(entity, r) {
      const hull = entity?.beamHull;
      if (!hull || !r || !(r.dmgKey > 0)) return;
      const fam = src.active ? writer.str(src.family) : -1;
      const vari = src.active ? writer.str(src.variant) : -1;
      const H = DMG_HOOK;
      const o = writer._begin(HC.DMG_HOOK, H.WORDS);
      const d = writer.ring.data;
      desc(d, o + H.HULL, entity, hull);
      d[o + H.R_KEY] = r.dmgKey;
      d[o + H.KIND] = r.kind === 'cut' ? 1 : 0;
      d[o + H.X] = r.x; d[o + H.Y] = r.y; d[o + H.U] = r.u; d[o + H.V] = r.v;
      d[o + H.DIR_X] = r.dirX || 0; d[o + H.DIR_Y] = r.dirY || 0; d[o + H.LEN] = r.len || 0;
      d[o + H.KILLED] = r.killed || 0; d[o + H.RADIUS] = r.radius || 0; d[o + H.CRATER] = r.crater || 0;
      d[o + H.LAT_X] = r.latX || 0; d[o + H.LAT_Y] = r.latY || 0; d[o + H.LAT_Z] = r.latZ || 0;
      d[o + H.SRC] = src.active ? 1 : 0;
      d[o + H.FAMILY] = fam; d[o + H.VARIANT] = vari; d[o + H.POWER] = src.power; d[o + H.FLAK_R] = src.flakR;
      writer._commit();
    },

    /** Część obrazowa HullBodies.onNodeLost (rozdarcie): uv komórki i punkt świata. */
    nodeLost(entity, hull, u, v, x, y) {
      if (!hull || !(hull.dmgKey > 0)) return;
      const T = DMG_TEAR;
      const o = writer._begin(HC.DMG_TEAR, T.WORDS);
      const d = writer.ring.data;
      desc(d, o + T.HULL, entity, hull);
      d[o + T.U] = u; d[o + T.V] = v; d[o + T.X] = x; d[o + T.Y] = y;
      writer._commit();
    },

    /** HullBodies.onSolidNodeLost — komórka kratownicy szablonu bryły. */
    solidNodeLost(entity, hull, ix, iy, iz, x, y) {
      if (!hull || !(hull.dmgKey > 0)) return;
      const T = DMG_SOLID_TEAR;
      const o = writer._begin(HC.DMG_SOLID_TEAR, T.WORDS);
      const d = writer.ring.data;
      desc(d, o + T.HULL, entity, hull);
      d[o + T.IX] = ix; d[o + T.IY] = iy; d[o + T.IZ] = iz; d[o + T.X] = x; d[o + T.Y] = y;
      writer._commit();
    },

    /** HullBodies.onRepair (naprawa wygasza osmalenie; koniec — czyści slot). */
    repair(entity, dt, changed) {
      const hull = entity?.beamHull;
      if (!hull || !(hull.dmgKey > 0)) return;
      const R = DMG_REPAIR;
      const o = writer._begin(HC.DMG_REPAIR, R.WORDS);
      const d = writer.ring.data;
      desc(d, o + R.HULL, entity, hull);
      d[o + R.DT] = Number(dt) || 0; d[o + R.CHANGED] = changed ? 1 : 0;
      writer._commit();
    },

    /** Łata roju naprawczego (komórka odbudowana) — środek komórki w świecie liczy gra. */
    patch(entity, ix, iy, seamHeat) {
      const hull = entity?.beamHull;
      if (!hull || hull.entity !== entity || !(hull.dmgKey > 0)) return;
      const w = HullBodies.cellWorld(entity, ix, iy);
      const P = DMG_PATCH;
      const o = writer._begin(HC.DMG_PATCH, P.WORDS);
      const d = writer.ring.data;
      desc(d, o + P.HULL, entity, hull);
      d[o + P.IX] = ix; d[o + P.IY] = iy;
      d[o + P.HAS_W] = w ? 1 : 0; d[o + P.WX] = w ? w.x : 0; d[o + P.WY] = w ? w.y : 0;
      d[o + P.SEAM] = seamHeat === undefined ? NaN : seamHeat;
      writer._commit();
    },

    /**
     * Stacja (RW-22 — dawniej gra czytała `station._mesh3d` renderu i wołała Destruction3D): kawałek przy progu
     * punktów (render odrywa go, jeśli stacja ma bryłę) albo rozpad przy śmierci (`destroyStation3D`).
     */
    station(st, kind, shockwave = false) {
      const S = STATION_FX;
      const o = writer._begin(HC.STATION_FX, S.WORDS);
      const d = writer.ring.data;
      const ent = writer.ids.entities;
      const slot = ent.slotOf(st);
      d[o + S.STATION] = slot; d[o + S.STATION + 1] = ent.gen(slot);
      d[o + S.KIND] = kind === STATION_FX_KIND.DESTROY ? STATION_FX_KIND.DESTROY : STATION_FX_KIND.CHUNK;
      d[o + S.SHOCKWAVE] = shockwave ? 1 : 0;
      writer._commit();
    },

    /** Odłamek zniszczonego węzła (HullBodies.onDebris) — losowanie skali i kształtownika robi render. */
    debris(x, y, vx, vy, r, g, b, cell, struct, solid, z, vz) {
      const D = HULL_DEBRIS;
      const o = writer._begin(HC.HULL_DEBRIS, D.WORDS);
      const d = writer.ring.data;
      d[o + D.X] = x; d[o + D.Y] = y; d[o + D.VX] = vx; d[o + D.VY] = vy;
      d[o + D.R] = r; d[o + D.G] = g; d[o + D.B] = b; d[o + D.CELL] = cell;
      d[o + D.STRUCT] = struct; d[o + D.SOLID] = solid; d[o + D.Z] = z; d[o + D.VZ] = vz;
      writer._commit();
    },

    /** Pas rzazu przebicia (odcinek świata gry) — uv początku (ciało płaskie) albo komórki znaków (bryła). */
    kerf(entity, x0, y0, x1, y1, family = 'hexlance') {
      const hull = entity?.beamHull;
      if (!hull || !(hull.dmgKey > 0)) return;
      const fam = writer.str(family);
      const K = DMG_KERF;
      const o = writer._begin(HC.DMG_KERF, K.WORDS);
      const d = writer.ring.data;
      desc(d, o + K.HULL, entity, hull);
      d[o + K.X0] = x0; d[o + K.Y0] = y0; d[o + K.X1] = x1; d[o + K.Y1] = y1; d[o + K.FAMILY] = fam;
      for (let i = 0; i < KERF_MAX * 4; i++) d[o + K.LAT + i] = 0;
      if (hull.solid3D) {
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        const n = Math.max(1, Math.min(KERF_MAX, Math.ceil(len / KERF_STEP)));
        d[o + K.N] = n;
        d[o + K.U0] = 0; d[o + K.V0] = 0;
        for (let k = 0; k < n; k++) {
          const f = n > 1 ? k / (n - 1) : 0;
          const L = HullBodies.solidLatticeAt(entity, x0 + dx * f, y0 + dy * f);
          const q = o + K.LAT + k * 4;
          d[q] = L.ok ? 1 : 0; d[q + 1] = L.latX; d[q + 2] = L.latY; d[q + 3] = L.latZ;
        }
      } else {
        const uv = HullBodies.spriteUvAt(entity, x0, y0);
        d[o + K.U0] = uv.u; d[o + K.V0] = uv.v; d[o + K.N] = 0;
      }
      writer._commit();
    }
  };
  return api;
}
