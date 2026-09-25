import test from 'node:test';
import assert from 'node:assert/strict';

import * as ships from '../src/data/ships.js';
import { computeHaloRingLayout, createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { computeHaloPortStation } from '../src/game/haloRingPlanets.js';

const IMAGE_SIZES = Object.freeze({
  atlas: [3747, 1677],
  terran_battleship: [1158, 714],
  terran_carrier: [1672, 941],
  terran_supercapital: [1672, 941]
});

const whole = (value) => Math.round(value);

test('hull render sizes use the shared world-scale tuning', () => {
  assert.equal(ships.HULL_RENDER_WORLD_SCALE, 0.6);

  const atlas = ships.getHullRenderSize('atlas', ...IMAGE_SIZES.atlas);
  const battleship = ships.getHullRenderSize('terran_battleship', ...IMAGE_SIZES.terran_battleship);
  const carrier = ships.getHullRenderSize('terran_carrier', ...IMAGE_SIZES.terran_carrier);
  const supercapital = ships.getHullRenderSize('terran_supercapital', ...IMAGE_SIZES.terran_supercapital);

  assert.equal(atlas.length, 1800);
  assert.equal(atlas.w, 1800);
  assert.equal(atlas.h, 806);
  assert.equal(atlas.radius, 300);

  assert.equal(battleship.length, 624);
  assert.equal(battleship.w, 624);
  assert.equal(battleship.h, 385);
  assert.equal(battleship.radius, 132);

  assert.equal(carrier.length, 1080);
  assert.equal(carrier.w, 1080);
  assert.equal(carrier.h, 608);
  assert.equal(carrier.radius, 192);

  assert.equal(supercapital.length, 1560);
  assert.equal(supercapital.w, 1560);
  assert.equal(supercapital.h, 878);
  assert.equal(supercapital.radius, 300);
});

test('planetary ring envelope stays compact (ring „Halo” keeps the old orbit zones)', () => {
  const layout = computeHaloRingLayout({ id: 'earth', r: 2800 });

  assert.equal(layout.planetR, 37800);
  assert.equal(whole(layout.inner.innerR), 41202);
  assert.equal(whole(layout.inner.outerR), whole(layout.industrial.innerR));
  assert.equal(whole(layout.military.outerR), 43752);
  assert.equal(whole(layout.outerRadius), 43752);
  assert.equal(whole(layout.military.outerR - layout.inner.innerR), 2550);
  assert.equal(whole(layout.parking.outerR - layout.parking.innerR), 880);

  const defenseLapDistance = Math.PI * 2 * layout.militaryCenter;
  assert.ok(defenseLapDistance / 1000 > 240, 'a 1000 u/s ship should need over four minutes for one ring lap');

  // bryła ringu w obwiedni; płyta podłogi (kadłub → podłoga) to przeszkoda w płaszczyźnie gry
  const ring = createHaloRingLayout({ planetRadius: layout.planetR });
  assert.ok(ring.bounds.insideEnvelope);
  assert.equal(ring.radii.rim, layout.outerRadius);
  assert.ok(ring.radii.floorMid - ring.radii.back > 400, 'płyta podłogi grubsza niż krok pocisku (≤ ~170 j.)');

  // stacja Ziemi = port ringu w hali K-7, poza obwiednią ringu (spawn i strefy bez zmian)
  const port = computeHaloPortStation({ id: 'earth', r: 2800 });
  assert.ok(port.orbitRadius > layout.outerRadius + 2000, `stacja-port na ${port.orbitRadius}`);
  assert.ok(port.orbitRadius < 57252, 'stacja-port przed orbitą spawnu');
});
