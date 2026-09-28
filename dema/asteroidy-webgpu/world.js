// dema/asteroidy-webgpu/world.js
//
// Świat dema WebGPU: to samo słońce, ta sama mapa układu i to samo pole
// asteroid co demo WebGL (dema/asteroidy.js) — i te same miejsca scen:
// galerie typów i kształtów, olbrzymy (rząd w pustej przestrzeni i Labirynt
// na obrzeżu gęstego pola), gęste pole (scena 5), przelot od słońca w głąb
// pola, głąb pola (najciemniej), rzadki pas w słońcu, rdzeń pola Kuipera
// i burza energetyczna.
//
// Funkcje findSpot / freeSpotNear / findDeepSpot / findStormSpot i układ
// olbrzymów SKOPIOWANE z dema/asteroidy.js (tam są w pliku strony, nie
// w module do importu). Kolejność jak tam: miejsca pola i Kuipera liczone
// PRZED wykluczeniem obrysu olbrzyma pola, głąb / rzadki pas / burza — po
// policzeniu cienia pól (potrzebują transmitancji słońca).

import { buildSystemMap } from '../../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../src/data/asteroidTypes.js';
import { AsteroidBeltField, BELT_BAND } from '../../src/game/asteroidBeltField.js';
import { FieldSunOcclusion } from '../../src/game/asteroidFieldLight.js';
import { GIANT_PRESETS, GIANT_PRESET_IDS, buildGiantPlan } from '../../src/game/asteroidGiants.js';
import { ROCK_TYPE_INDEX } from '../../src/game/asteroidRockKinds.js';

export { BELT_BAND };

// Słońce w środku świata gry (jak w demie WebGL i w grze).
export const SUN = Object.freeze({ x: 6000000, y: 6000000, r: 823 });

const systemMap = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
  planetScale: 3,
  sunRadius: SUN.r,
  angleFor: (def) => ({ jupiter: 250, saturn: 60, mars: 120, earth: 330 }[def.id] ?? 0) * Math.PI / 180
});
export const AU = systemMap.auInWorldUnits;
export const PLANETS = systemMap.planets;
for (const p of PLANETS) {
  p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
  p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
}

export const field = new AsteroidBeltField({ planets: PLANETS, sunX: SUN.x, sunY: SUN.y, auToWorld: AU });

export function findSpot(rAu0, rAu1, want, accept = null) {
  let best = null;
  for (let i = 0; i < 6000; i++) {
    const a = (i / 6000) * Math.PI * 2;
    for (let k = 0; k < 6; k++) {
      const rAu = rAu0 + (rAu1 - rAu0) * (k + 0.5) / 6;
      const x = SUN.x + Math.cos(a) * rAu * AU;
      const y = SUN.y + Math.sin(a) * rAu * AU;
      const m = field.sampleMacro(x, y);
      let score = want === 'core' ? m.density : (m.weight > 0.99 ? -m.cluster : -9);
      if (accept && !accept(x, y)) score -= 9;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

// Atlas nie może stać na dużej skale gry: najbliższe miejsce bez skał ≥ 300 j.
// pod kadłubem (jak w demie WebGL).
export function freeSpotNear(spot, clearR = 950) {
  const test = (x, y) => {
    let hit = false;
    field.forEachRockInRect(BELT_BAND.PLAY, x - clearR - 1400, y - clearR - 1400, x + clearR + 1400, y + clearR + 1400, 300, (r) => {
      if (!hit && Math.hypot(r.x - x, r.y - y) < r.r * 1.35 + clearR) hit = true;
    });
    return !hit;
  };
  for (let ring = 0; ring < 40; ring++) {
    const n = Math.max(1, ring * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = spot.x + Math.cos(a) * ring * 700;
      const y = spot.y + Math.sin(a) * ring * 700;
      if (test(x, y)) return { x, y };
    }
  }
  return spot;
}

export const CORE = findSpot(37.5, 45.5, 'core');
// Przelot: start po stronie słońca, lot RADIALNIE od słońca przez rdzeń —
// wejście jasne, w głąb ciemniej (słońce przesłaniane przez pole).
export const FLIGHT = (() => {
  const dx = CORE.x - SUN.x;
  const dy = CORE.y - SUN.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return Object.freeze({ x: CORE.x - ux * 90000, y: CORE.y - uy * 90000, angle: Math.atan2(uy, ux), ux, uy });
})();

export const SPOTS = {
  gallery: { x: SUN.x + 20 * AU, y: SUN.y - 0.3 * AU },
  shapes: { x: SUN.x + 20 * AU, y: SUN.y - 0.3 * AU + 9000 },
  // Olbrzymy w pustej przestrzeni (poza pasami), w pełnym słońcu.
  giants: { x: SUN.x + 23 * AU, y: SUN.y + 1.5 * AU },
  field: freeSpotNear(CORE),
  deep: null,   // najciemniejszy punkt linii przelotu — po cieniu pól (findDeepSpot)
  sparse: null, // rzadki pas w pełnym słońcu — po cieniu pól (findSparseSpot)
  storm: null,  // najsilniejsza burza w mroku pola — po cieniu pól (findStormSpot)
  kuiper: freeSpotNear(findSpot(126, 139, 'core'))
};
// Scena 5: wolne miejsce przy rdzeniu pola, Atlas dziobem pod kątem −0,4 rad.
export const FIELD_SPOT = Object.freeze({ ...SPOTS.field, angle: -0.4, zoom: 1.0 });
field.clearCache();

// ---------------------------------------------------------------------------
// Olbrzymy (asteroidGiants.js): rząd pięciu w pustej przestrzeni i Labirynt
// (inne ziarno) na obrzeżu gęstego pola obok linii przelotu. Pole nie stawia
// skał gry w obrysie olbrzyma pola.

const GIANT_GAP = 16000;
export const GIANTS = (() => {
  const list = GIANT_PRESET_IDS.map((id) => ({ id, preset: GIANT_PRESETS[id], seed: 1, where: 'gallery' }));
  const widths = list.map((g) => g.preset.half[0] * 2);
  const total = widths.reduce((a, b) => a + b, 0) + GIANT_GAP * (list.length - 1);
  let x = SPOTS.giants.x - total / 2;
  list.forEach((g, i) => {
    g.x = x + widths[i] / 2;
    g.y = SPOTS.giants.y;
    x += widths[i] + GIANT_GAP;
  });
  return list;
})();
export const FIELD_GIANTS = (() => {
  const px = -FLIGHT.uy;
  const py = FLIGHT.ux;
  const id = 'warren';
  const x = FLIGHT.x + FLIGHT.ux * 52000 + px * 26000;
  const y = FLIGHT.y + FLIGHT.uy * 52000 + py * 26000;
  return [{ id, preset: GIANT_PRESETS[id], seed: 2, x, y, where: 'field' }];
})();
export const ALL_GIANTS = [...GIANTS, ...FIELD_GIANTS];
field.setExclusions(FIELD_GIANTS.map((g) => {
  const [hx, hy] = buildGiantPlan(g.id, g.seed).half;
  return { x: g.x, y: g.y, rx: hx + 600, ry: hy + 600 };
}));

// ---------------------------------------------------------------------------
// Słońce przesłaniane przez pole

export const sunOcclusion = new FieldSunOcclusion(field);
sunOcclusion.prefetch(FIELD_SPOT.x, FIELD_SPOT.y, 200000);

/** Transmitancja słońca w punkcie świata (1 = pełne słońce). */
export function sunTransmittance(x, y) {
  return sunOcclusion.transmittance(x, y);
}

/** Cień pól dla całego układu (jak ekran ładowania gry; ~1 s, oddaje wątek). */
export async function precomputeOcclusion(onProgress) {
  await sunOcclusion.precomputeAll({ onProgress });
}

export function findDeepSpot() {
  let best = null;
  for (let d = 0; d <= 240000; d += 3000) {
    const x = FLIGHT.x + FLIGHT.ux * d;
    const y = FLIGHT.y + FLIGHT.uy * d;
    const T = sunTransmittance(x, y);
    if (!best || T < best.T) best = { x, y, T, d };
  }
  return freeSpotNear(best);
}

/** Rzadki pas w pełnym słońcu (~10% rzadkiego pasa leży w cieniu pól bliżej słońca). */
export function findSparseSpot() {
  return freeSpotNear(findSpot(38.5, 44.5, 'sparse', (x, y) => sunTransmittance(x, y) > 0.9));
}

/**
 * Burza: w komórkach burz pasa głównego miejsce z największym skupiskiem skał
 * energetycznych warstwy gry, w mroku pola; Atlas tuż obok, dziobem w skupisko.
 */
export function findStormSpot() {
  const cands = [];
  for (let i = 0; i < 2400; i++) {
    const a = (i / 2400) * Math.PI * 2;
    for (let k = 0; k < 5; k++) {
      const rAu = 37.5 + 8 * (k + 0.5) / 5;
      const x = SUN.x + Math.cos(a) * rAu * AU;
      const y = SUN.y + Math.sin(a) * rAu * AU;
      const st = field.stormAt(x, y);
      if (st > 0.7) cands.push({ x, y, st: st * (1.2 - sunTransmittance(x, y)) });
    }
  }
  cands.sort((p, q) => q.st - p.st);
  let best = null;
  for (const c of cands.slice(0, 40)) {
    let n = 0;
    field.forEachRockInRect(BELT_BAND.PLAY, c.x - 2200, c.y - 1300, c.x + 2200, c.y + 1300, 120, (r) => { if (r.type === ROCK_TYPE_INDEX.energy) n++; });
    const score = n * c.st;
    if (!best || score > best.score) best = { x: c.x, y: c.y, score, n };
  }
  if (!best) return null;
  const spot = freeSpotNear(best, 900);
  spot.angle = Math.atan2(best.y - spot.y, best.x - spot.x) || 0;
  spot.energyRocks = best.n;
  return spot;
}
