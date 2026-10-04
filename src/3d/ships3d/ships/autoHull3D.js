// src/3d/ships3d/ships/autoHull3D.js
//
// MODELE 3D KADŁUBÓW Z AUTOMATU (tabela: autoHulls3D.js, obrysy: autoOutlines3D.js z generatora
// scripts/webgpu/obrysy-floty.mjs). Ten sam rdzeń co flota (fleetHull3D.js → buildHullCore) i ten
// sam kształt wyniku co buildAtlasHull3D / buildFleetHull3D; specyfikacja powstaje z obrysu:
// wysokości w hu = 1% szerokości kadłuba (alfa), kil z profilem głębokości wzdłuż kadłuba,
// tarasy nadbudówek z mapy odległości od krawędzi, gniazda / światła / mostek z danych gry.

import { buildHullCore } from './fleetHull3D.js';
import { AUTO3D_TABLE } from './autoHulls3D.js';
import { AUTO3D_OUTLINES } from './autoOutlines3D.js';
import { getHullRenderSize, getWeaponTierForHull } from '../../../data/ships.js';

export { AUTO3D_TABLE };
export const AUTO3D_IDS = Object.freeze(Object.keys(AUTO3D_TABLE));

function outlinesOf(id) {
  const t = AUTO3D_TABLE[id];
  if (!t) throw new Error(`nieznany kadłub z automatu: ${id}`);
  const out = AUTO3D_OUTLINES[t.outlineOf || id];
  if (!out) throw new Error(`${id}: brak obrysu — uruchom node scripts/webgpu/obrysy-floty.mjs`);
  return out;
}

/** Skala świata na px sprite'a: profil kadłuba (jak NPC) albo szerokość płótna (myśliwiec). */
export function autoHullScale(id) {
  const t = AUTO3D_TABLE[id];
  const out = outlinesOf(id);
  const [W, H] = out.sprite;
  if (t.worldWidth) return t.worldWidth / W;
  return getHullRenderSize(t.profile, W, H).w / W;
}

/** Specyfikacja (jak FLEET3D_SPECS) wyliczona z tabeli i obrysu. */
export function autoHullSpec(id) {
  const t = AUTO3D_TABLE[id];
  const out = outlinesOf(id);
  const [x0, y0, x1, y1] = out.bbox;
  const L = x1 - x0;
  const hu = (y1 - y0) / 100; // 1% szerokości kadłuba (alfa) — jak hu floty
  const kd = t.keel?.depth ?? 11;
  const spec = {
    label: t.label, faction: t.faction, profile: t.profile || null, editor: t.editor || null,
    bridge: t.bridge || null, tier: t.tier || (t.profile ? getWeaponTierForHull(t.profile) : 'S'), sprite: t.sprite,
    hu, axisY: -out.axisY,
    z: { belt: -3, deck: 3, bevel: 0.5 },
    keel: {
      s: t.keel?.s ?? 0.55,
      x: [x0, x0 + L * 0.12, x0 + L * 0.45, x0 + L * 0.82, x1],
      z: [-kd * 0.5, -kd * 0.85, -kd, -kd * 0.7, -kd * 0.25]
    },
    pod: { z: 0 },
    blocks: []
  };
  // Płyta z dziurami: kil pod pierwszym tarasem (dziury zostają przelotowe), inaczej pod całą płytą.
  if (out.plates.some((p) => p.holes.length) && out.tiers[0]?.parts.length) {
    const big = out.tiers[0].parts.reduce((a, b) => (area(b.outer) > area(a.outer) ? b : a));
    spec.keel.poly = big.outer;
  }
  return spec;
}

function area(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i]; const b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/**
 * Model kadłuba z automatu — wynik jak buildFleetHull3D (px sprite'a w budowniczym, dane
 * w jednostkach świata, zapytania heightAt / bottomAt / contains).
 * @param {string} id klucz AUTO3D_TABLE (= id HULL_RENDER_PROFILES, moduły megafrachtowca, fighter)
 */
export function buildAutoHull3D(id, o = {}) {
  const spec = autoHullSpec(id);
  const h = buildHullCore(id, spec, outlinesOf(id), autoHullScale(id), o);
  h.auto = true;
  return h;
}
