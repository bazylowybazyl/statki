import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32,
  hashChunkSeed,
  computeBeltRegions,
  regionPenetration,
  beltImmersionAt,
  chunksForView,
  planChunkContent,
  computeBackdropZoomFade,
  computeBackdropVisibility,
  makeRockGeometry,
  CHUNK_SIZE,
  BACKDROP_Z_NEAR,
  BACKDROP_Z_FAR,
  ROCK_RADIUS_MIN,
  ROCK_RADIUS_MAX,
  BIG_ROCK_RADIUS,
  GIANT_ROCK_CHANCE,
  GIANT_RADIUS_MIN,
  GIANT_RADIUS_MAX,
  GIANT_Z_NEAR,
  GIANT_Z_FAR,
  DUST_Z_NEAR,
  DUST_Z_FAR,
  DUST_SIZE_MIN,
  DUST_SIZE_MAX,
  WEBGL_DUST_ENABLED,
  ROCK_VARIANTS,
  ZOOM_FADE_START_WORLD_W,
  ZOOM_FADE_END_WORLD_W,
} from '../src/3d/asteroidBeltBackdrop3D.js';
import { BELT_DEFINITIONS } from '../src/data/asteroidTypes.js';

const AU = 3000;
const RING_DEFS = [{
  id: 'main', shape: 'ring', innerAU: 36, outerAU: 47, count: 225000,
}];

function ringRegions() {
  return computeBeltRegions(RING_DEFS, { sunX: 0, sunY: 0, auToWorld: AU });
}

test('mulberry32 i hashChunkSeed są deterministyczne', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  assert.equal(hashChunkSeed(3, -7, 42), hashChunkSeed(3, -7, 42));
  assert.notEqual(hashChunkSeed(3, -7, 42), hashChunkSeed(4, -7, 42));
  assert.notEqual(hashChunkSeed(3, -7, 42), hashChunkSeed(3, -7, 43));
});

test('computeBeltRegions: ring ma poprawne promienie w world units', () => {
  const [region] = ringRegions();
  assert.equal(region.kind, 'ring');
  assert.equal(region.rInner, 36 * AU);
  assert.equal(region.rOuter, 47 * AU);
  assert.ok(region.density > 0.3 && region.density < 2.3);
  assert.equal(region.maxHalf, (47 - 36) * AU / 2);
});

test('computeBeltRegions: lagrange L4 kotwiczy 60 stopni przed planetą', () => {
  const jupiter = { id: 'jupiter', x: 50.2 * AU, y: 0 };
  const defs = [{
    id: 'greeks', shape: 'lagrange', lagrange: 'L4', anchorPlanet: 'jupiter',
    spreadAU: 6, arcSpread: 0.35, count: 60000,
  }];
  const [region] = computeBeltRegions(defs, { planets: [jupiter], sunX: 0, sunY: 0, auToWorld: AU });
  assert.equal(region.kind, 'arc');
  assert.ok(Math.abs(region.angMid - Math.PI / 3) < 1e-9);
  assert.ok(Math.abs(region.rMid - 50.2 * AU) < 1e-6);

  // Punkt w L4 jest w środku regionu, punkt w L5 (przeciwny) poza nim.
  const l4x = Math.cos(Math.PI / 3) * 50.2 * AU;
  const l4y = Math.sin(Math.PI / 3) * 50.2 * AU;
  assert.ok(regionPenetration(region, l4x, l4y) > 0);
  const l5x = Math.cos(-Math.PI / 3) * 50.2 * AU;
  const l5y = Math.sin(-Math.PI / 3) * 50.2 * AU;
  assert.ok(regionPenetration(region, l5x, l5y) < 0);
});

test('computeBeltRegions: triangle daje 3 klastry co 120 stopni', () => {
  const jupiter = { id: 'jupiter', x: 50.2 * AU, y: 0 };
  const defs = [{
    id: 'hildas', shape: 'triangle', anchorPlanet: 'jupiter',
    radiusAU: 42, spreadAU: 3, count: 45000,
  }];
  const regions = computeBeltRegions(defs, { planets: [jupiter], sunX: 0, sunY: 0, auToWorld: AU });
  assert.equal(regions.length, 3);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(regions[k].angMid - k * Math.PI * 2 / 3) < 1e-9);
  }
});

test('computeBeltRegions: pełne BELT_DEFINITIONS bez planet pomija lagrange', () => {
  const withPlanets = computeBeltRegions(BELT_DEFINITIONS, {
    planets: [{ id: 'jupiter', x: 50.2 * AU, y: 0 }],
    sunX: 0, sunY: 0, auToWorld: AU,
  });
  // 2 ringi + 2 lagrange + 3 kluster hildas
  assert.equal(withPlanets.length, 7);
  const withoutPlanets = computeBeltRegions(BELT_DEFINITIONS, { sunX: 0, sunY: 0, auToWorld: AU });
  // lagrange wypadają (brak kotwicy), hildas zostają z fallbackiem na słońce
  assert.equal(withoutPlanets.length, 5);
});

test('regionPenetration: ring — znak i wartości na krawędziach', () => {
  const [region] = ringRegions();
  assert.equal(regionPenetration(region, 36 * AU, 0), 0);
  assert.equal(regionPenetration(region, 47 * AU, 0), 0);
  assert.ok(regionPenetration(region, 41.5 * AU, 0) > 0);
  assert.ok(regionPenetration(region, 30 * AU, 0) < 0);
  assert.ok(regionPenetration(region, 50 * AU, 0) < 0);
  // Symetria obrotowa
  const p1 = regionPenetration(region, 40 * AU, 0);
  const p2 = regionPenetration(region, 0, 40 * AU);
  assert.ok(Math.abs(p1 - p2) < 1e-6);
});

test('beltImmersionAt: 0 na krawędzi, 1 w głębi, monotoniczna rampa', () => {
  const regions = ringRegions();
  const ramp = 2.5 * AU;
  assert.equal(beltImmersionAt(regions, 60 * AU, 0, ramp), 0);
  assert.equal(beltImmersionAt(regions, 36 * AU, 0, ramp), 0);
  // Pełna immersja po przejściu rampy (7500u = 2.5 AU) w głąb
  assert.equal(beltImmersionAt(regions, 36 * AU + ramp, 0, ramp), 1);
  // Połowa rampy => smoothstep(0.5) = 0.5
  const half = beltImmersionAt(regions, 36 * AU + ramp / 2, 0, ramp);
  assert.ok(Math.abs(half - 0.5) < 1e-9);
  // Monotoniczność wejścia
  let prev = -1;
  for (let d = 0; d <= ramp; d += ramp / 10) {
    const v = beltImmersionAt(regions, 36 * AU + d, 0, ramp);
    assert.ok(v >= prev);
    prev = v;
  }
});

test('chunksForView: zwraca chunki pasa posortowane po odległości', () => {
  const regions = ringRegions();
  const cam = { x: 41.5 * AU, y: 0, zoom: 0.5 };
  const chunks = chunksForView(cam, 1600, 900, regions);
  assert.ok(chunks.length > 0);
  const camKey = Math.floor(cam.x / CHUNK_SIZE) + ',' + Math.floor(cam.y / CHUNK_SIZE);
  assert.ok(chunks.some((c) => c.key === camKey), 'zestaw zawiera chunk kamery');
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i - 1].d2 <= chunks[i].d2, 'sortowanie po odległości');
  }
});

test('chunksForView: pusto daleko poza pasem i przy ekstremalnym zoom-out', () => {
  const regions = ringRegions();
  assert.equal(chunksForView({ x: 5 * AU, y: 0, zoom: 0.5 }, 1600, 900, regions).length, 0);
  // Bezpiecznik: gigantyczny rect => [] zanim zadziała zoomFade
  assert.equal(chunksForView({ x: 41.5 * AU, y: 0, zoom: 0.001 }, 1920, 1080, regions).length, 0);
});

test('planChunkContent: deterministyczny i respektuje granice pasa', () => {
  const regions = ringRegions();
  const cx = Math.floor((41.5 * AU) / CHUNK_SIZE);
  const a = planChunkContent(cx, 0, regions, 0xB4CD07);
  const b = planChunkContent(cx, 0, regions, 0xB4CD07);
  assert.deepEqual(a, b);
  assert.ok(a.rocks.length >= 8 && a.rocks.length <= 44, `chunk ma gęste tło skał (${a.rocks.length})`);

  for (const rock of a.rocks) {
    assert.ok(regionPenetration(regions[0], rock.x, rock.y) > 0, 'skała wewnątrz pasa');
    assert.ok(rock.z >= BACKDROP_Z_NEAR && rock.z <= BACKDROP_Z_FAR, 'głębokość w zakresie');
    assert.ok(rock.variant >= 0 && rock.variant < ROCK_VARIANTS);
    assert.ok(rock.radius >= ROCK_RADIUS_MIN && rock.radius <= ROCK_RADIUS_MAX, 'promień w zakresie zwykłych skał');
    if (rock.radius > BIG_ROCK_RADIUS) assert.ok(rock.variant >= 4, 'duże bryły używają gęstszych wariantów');
    else assert.ok(rock.variant < 4);
    assert.equal(rock.tint.length, 3);
  }
  for (const giant of a.giants) {
    assert.ok(regionPenetration(regions[0], giant.x, giant.y) > 0, 'gigant wewnątrz pasa');
    assert.ok(giant.z >= GIANT_Z_NEAR && giant.z <= GIANT_Z_FAR, 'gigant w najgłębszym pasmie');
    assert.ok(giant.radius >= GIANT_RADIUS_MIN && giant.radius <= GIANT_RADIUS_MAX);
    assert.ok(giant.variant >= 4 && giant.variant < ROCK_VARIANTS, 'gigant używa gęstej siatki');
  }
  for (const puff of a.dust) {
    assert.ok(regionPenetration(regions[0], puff.x, puff.y) > 0, 'pył wewnątrz pasa');
    assert.ok(puff.z >= DUST_Z_NEAR && puff.z <= DUST_Z_FAR, 'pył leży głęboko za gameplayem');
    assert.ok(puff.size >= DUST_SIZE_MIN && puff.size <= DUST_SIZE_MAX, 'płat pyłu ma bezpieczny rozmiar');
  }

  // Inny chunk lub inny seed => inna zawartość
  const other = planChunkContent(cx + 1, 0, regions, 0xB4CD07);
  assert.notDeepEqual(a.rocks[0], other.rocks[0]);
  const reseeded = planChunkContent(cx, 0, regions, 0xB4CD08);
  assert.notDeepEqual(a.rocks[0], reseeded.rocks[0]);

  // Chunk daleko poza pasem => pusto
  const empty = planChunkContent(0, 0, regions, 0xB4CD07);
  assert.equal(empty.rocks.length, 0);
  assert.equal(empty.dust.length, 0);
});

test('computeBackdropZoomFade: 1 przy gameplayowym zoomie, 0 przy sector-map', () => {
  assert.equal(computeBackdropZoomFade(10000), 1);
  assert.equal(computeBackdropZoomFade(ZOOM_FADE_START_WORLD_W), 1);
  assert.equal(computeBackdropZoomFade(ZOOM_FADE_END_WORLD_W), 0);
  assert.equal(computeBackdropZoomFade(ZOOM_FADE_END_WORLD_W + 50000), 0);
  const mid = computeBackdropZoomFade((ZOOM_FADE_START_WORLD_W + ZOOM_FADE_END_WORLD_W) / 2);
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
});

test('computeBackdropVisibility: skały pojawiają się płynnie dopiero wewnątrz pasa', () => {
  assert.equal(computeBackdropVisibility(1, 0), 0);
  assert.equal(computeBackdropVisibility(1, 1), 1);
  assert.equal(computeBackdropVisibility(0, 1), 0);
  assert.ok(Math.abs(computeBackdropVisibility(0.8, 0.5) - 0.4) < 1e-9);
  assert.ok(computeBackdropVisibility(1, 0.1) < 0.03);
});

// Pył wrócił do WebGL po znalezieniu prawdziwej przyczyny "czarnej zasłony"
// (NaN w vertex colors, nie alfa billboardów) — potwierdzone bisekcją na żywo.
test('pył WebGL włączony (addytywny — świeci, nie zaciemnia)', () => {
  assert.equal(WEBGL_DUST_ENABLED, true);
});

test('giganty: rzadkie, deterministyczne, tylko w pasie', () => {
  const regions = ringRegions();
  // Skan bloku chunków pokrywającego cały ring (36-47 AU => ~318 chunków w pasie).
  const maxC = Math.ceil((47 * AU) / CHUNK_SIZE) + 1;
  let giantCount = 0;
  let beltChunks = 0;
  for (let cy = -maxC; cy <= maxC; cy++) {
    for (let cx = -maxC; cx <= maxC; cx++) {
      const centerX = (cx + 0.5) * CHUNK_SIZE;
      const centerY = (cy + 0.5) * CHUNK_SIZE;
      if (regionPenetration(regions[0], centerX, centerY) <= 0) continue;
      beltChunks++;
      const plan = planChunkContent(cx, cy, regions, 0xB4CD07);
      giantCount += plan.giants.length;
      assert.ok(plan.giants.length <= 1, 'maksymalnie jeden gigant na chunk');
    }
  }
  assert.ok(beltChunks > 200, `skan objął pas (${beltChunks} chunków)`);
  // Oczekiwana częstość ~GIANT_ROCK_CHANCE (5%) — szeroki przedział, bo to
  // deterministyczna próba, nie prawdziwa losowość.
  const expected = beltChunks * GIANT_ROCK_CHANCE;
  assert.ok(giantCount >= expected * 0.3 && giantCount <= expected * 2.5,
    `częstość gigantów w rozsądnym przedziale (${giantCount}/${beltChunks}, oczekiwane ~${Math.round(expected)})`);
  assert.ok(GIANT_ROCK_CHANCE > 0 && GIANT_ROCK_CHANCE < 0.15, 'giganty pozostają rzadkie');
});

// Regresja: seed 0xB4CD07 (pula 0 w grze) produkował NaN w vertex colors —
// float32 zaokrąglał promień wierzchołka-minimum PONIŻEJ float64 rMin i
// Math.pow(-epsilon, 1.15) dawał NaN. Jeden NaN wpuszczony w HDR bloom
// rozmazywał się w czarne bloki zasłaniające pół ekranu.
test('makeRockGeometry: position/normal/color zawsze skończone (NaN-safe AO)', () => {
  const GAME_SEED = 0xB4CD07;
  const seeds = [];
  for (let vIdx = 0; vIdx < ROCK_VARIANTS; vIdx++) seeds.push({ seed: GAME_SEED + vIdx * 7919, detail: vIdx >= 4 ? 2 : 1 });
  for (let s = 0; s < 40; s++) seeds.push({ seed: (s * 2654435761) >>> 0, detail: 1 });

  for (const { seed, detail } of seeds) {
    const geo = makeRockGeometry(seed, detail);
    for (const name of ['position', 'normal', 'color']) {
      const attr = geo.getAttribute(name);
      assert.ok(attr, `atrybut ${name} istnieje (seed ${seed})`);
      for (let i = 0; i < attr.array.length; i++) {
        assert.ok(Number.isFinite(attr.array[i]), `${name}[${i}] skończone dla seed ${seed} (jest: ${attr.array[i]})`);
      }
    }
    geo.dispose();
  }
});
