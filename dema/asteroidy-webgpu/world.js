// dema/asteroidy-webgpu/world.js
//
// Świat dema WebGPU: to samo słońce, ta sama mapa układu i to samo pole
// asteroid co scena „5 · Gęste pole (Main Belt)” w dema/asteroidy.js.
// Miejsce sceny liczone identycznie (findSpot → rdzeń pola, freeSpotNear →
// wolne miejsce na Atlasa), łącznie z wykluczeniem obrysu olbrzyma pola
// (Labirynt), które w demie WebGL zmienia zestaw skał gry.
//
// Funkcje findSpot / freeSpotNear / FLIGHT skopiowane z dema/asteroidy.js
// (tam są w pliku strony, nie w module do importu).

import { buildSystemMap } from '../../src/data/systemMap.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../src/data/asteroidTypes.js';
import { AsteroidBeltField, BELT_BAND } from '../../src/game/asteroidBeltField.js';
import { FieldSunOcclusion } from '../../src/game/asteroidFieldLight.js';
import { buildGiantPlan } from '../../src/game/asteroidGiants.js';

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

function findSpot(rAu0, rAu1, want, accept = null) {
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
function freeSpotNear(spot, clearR = 950) {
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

const CORE = findSpot(37.5, 45.5, 'core');
const FLIGHT = (() => {
  const dx = CORE.x - SUN.x;
  const dy = CORE.y - SUN.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return { x: CORE.x - ux * 90000, y: CORE.y - uy * 90000, ux, uy };
})();

// Scena 5: wolne miejsce przy rdzeniu pola, Atlas dziobem pod kątem −0,4 rad.
export const FIELD_SPOT = Object.freeze({ ...freeSpotNear(CORE), angle: -0.4, zoom: 1.0 });
field.clearCache();

// Olbrzym pola (Labirynt) z dema WebGL: jego obrys wyklucza skały gry.
// Samego olbrzyma to demo nie rysuje (leży ~45 tys. j. od sceny).
{
  const px = -FLIGHT.uy;
  const py = FLIGHT.ux;
  const x = FLIGHT.x + FLIGHT.ux * 52000 + px * 26000;
  const y = FLIGHT.y + FLIGHT.uy * 52000 + py * 26000;
  const [hx, hy] = buildGiantPlan('warren', 2).half;
  field.setExclusions([{ x, y, rx: hx + 600, ry: hy + 600 }]);
}

// Słońce przesłaniane przez pole: sektory wokół sceny liczone od razu
// (~30 ms), bez przeliczania całego układu (w demie WebGL 1,2 s).
export const sunOcclusion = new FieldSunOcclusion(field);
sunOcclusion.prefetch(FIELD_SPOT.x, FIELD_SPOT.y, 200000);

/** Transmitancja słońca w punkcie świata (1 = pełne słońce). */
export function sunTransmittance(x, y) {
  return sunOcclusion.transmittance(x, y);
}
