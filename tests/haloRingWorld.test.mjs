// Świat ringów po stronie gry (RW-27, src/game/haloRingWorld.js): teren archetypów z planów od razu, Ziemia po
// zdarzeniu z renderu, zajętość i lampki stanowisk w rejestrze, zegar migania, poziom lamp hal liczony jak w obrazie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HaloRingWorld, HALO_WORLD } from '../src/game/haloRingWorld.js';
import { HALO_GAME } from '../src/3d/haloRing/haloRingGame.js';
import { k7BeaconClock } from '../src/3d/haloRing/haloPortK7Lights.js';
import { createEcumenePlan } from '../src/3d/haloRing/arch/ecumenePlan.js';
import { createFablePlan } from '../src/3d/haloRing/arch/fablePlan.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';
import { resolveRingPlanetWorldRadius } from '../src/3d/ringScale.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const MARS = { id: 'mars', x: 1700000, y: 400000, r: 2000 };
const JUPITER = { id: 'jupiter', x: -2600000, y: 900000, r: 6000 };

let _w = null;
const world = () => (_w || (_w = new HaloRingWorld({ planets: [EARTH, MARS, JUPITER] })));

test('teren: Mars i Jowisz od razu z planów CPU (jak treść ringu-archetypu), Ziemia po zdarzeniu z renderu', () => {
  const w = world();
  assert.deepEqual(w.entries.map((e) => e.key), ['earth', 'mars', 'jupiter']);
  const earth = w.entry('earth');
  assert.equal(earth.collider.terrainHeightAt, null, 'Ziemia: sama płyta do mapy ringu');
  assert.equal(earth.terrainReady, false);
  for (const [key, planet, make] of [['mars', MARS, createEcumenePlan], ['jupiter', JUPITER, createFablePlan]]) {
    const e = w.entry(key);
    assert.equal(e.terrainReady, true, key);
    // layout jak w archRing.js (createHaloRingLayout z opcji ringu gry)
    const spec = HALO_RING_PLANETS[key];
    const layout = createHaloRingLayout({ planetRadius: resolveRingPlanetWorldRadius(planet), seed: spec.seed, profile: spec.profile, quality: 'high' });
    const plan = make(layout, layout.seed);
    const L = e.collider.layout;
    let nonZero = 0;
    for (let i = 0; i < 400; i++) {
      const a = i * 0.0157 - 3.1;
      const r = L.radii.floorMid + ((i * 37) % 900) - 450;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      let th = Math.atan2(y, x);
      if (th < 0) th += Math.PI * 2;
      const want = plan.heightAt(th, 0);
      assert.equal(e.collider.terrainHeightAt(x, y), want);
      if (want !== 0) nonZero++;
    }
    assert.ok(nonZero > 0 || key === 'jupiter', `${key}: teren z rzeźbą`);
  }
  const fn = (lx, ly) => lx * 0 + ly * 0 + 7;
  w.setRingTerrain('earth', fn);
  assert.equal(earth.collider.terrainHeightAt, fn);
  assert.equal(earth.terrainReady, true);
});

test('stanowiska: wolne od startu, zajętość fabuły w rejestrze z wersją (także wymuszona)', () => {
  const w = world();
  const owner = w.hall('earth', 0);
  assert.ok(owner.layout.berths.length > 0);
  for (const b of owner.layout.berths) { assert.equal(b.occupied, null); assert.equal(b.reserved, null); }
  const id = owner.layout.berths.find((b) => b.size === 'CAPITAL').id;
  const v0 = owner.berthVersion;
  assert.equal(w.setBerthState('earth', 0, id, 'player', 'player'), true);
  assert.equal(owner.berthVersion, v0 + 1);
  assert.equal(w.setBerthState('earth', 0, id, 'player', 'player'), false, 'bez zmiany — bez nowej wersji');
  assert.equal(w.setBerthState('earth', 0, id, 'player', 'player', true), true, 'wymuszona');
  assert.equal(w.setBerthState('earth', 0, 'NIE-MA', 'player', 'player'), false);
  w.setBerthState('earth', 0, id, null, null);
});

test('klatka: zegar migania z zegara ściany, poziom lamp hal = wzór obrazu (uSunDir jak THREE.Vector3.normalize)', () => {
  const w = world();
  const sun = { x: 0, y: 0 };
  w.frame({ nowMs: 123456.789, gameDt: 1 / 60, ship: null, sun });
  assert.equal(w.clock, k7BeaconClock(123456.789));
  assert.equal(HALO_WORLD.sunElevationDeg, HALO_GAME.sunElevationDeg);
  let night = 0;
  for (const e of w.entries) {
    // obraz: HaloRingGame._applySun → ring.setSun(local, el) → uSunDir; _daylight → hl.x = 0.22 + 0.5 · (1 − d)
    const world0 = Math.atan2(-(sun.y - e.place.y), sun.x - e.place.x);
    const local = world0 - e.place.rot;
    const el = HALO_GAME.sunElevationDeg * Math.PI / 180;
    const ce = Math.cos(el);
    const v = new THREE.Vector3().set(ce * Math.cos(local), ce * Math.sin(local), Math.sin(el)).normalize();
    assert.deepEqual([e.sunX, e.sunY, e.sunZ], [v.x, v.y, v.z], e.key);
    const L = e.collider.layout;
    for (const owner of e.collider.registry.halls) {
      const o = owner.frame.origin;
      const oz = -L.planetCenterZ;
      const t = -(o.x * v.x + o.y * v.y + oz * v.z);
      let d = 1;
      if (t > 0) {
        const dd = Math.sqrt(Math.max(0, o.x * o.x + o.y * o.y + oz * oz - t * t));
        const k = Math.min(1, Math.max(0, (dd - (L.planetRadius - 500)) / 1300));
        d = k * k * (3 - 2 * k);
      }
      assert.equal(owner.lampLevel, 0.22 + 0.5 * (1 - d));
      if (owner.lampLevel > 0.3) night++;
    }
  }
  assert.ok(night > 0, 'część hal po nocnej stronie planety');
});

test('obraz ringów: bez rozgrywki (kolidery, automat, lampki z rejestru), index.html na świecie ringów', () => {
  const game = read('src/3d/haloRing/haloRingGame.js');
  for (const bad of ['new HaloRingCollider(', 'stepK7BerthService(', 'k7BeaconClock(', 'owner.lampLevel =', 'collider.setTerrain(', 'constrainShip(', 'pointInSlab(']) {
    assert.ok(!game.includes(bad), `haloRingGame.js: ${bad}`);
  }
  assert.match(game, /this\.world\.setRingTerrain\(e\.key, \(lx, ly\) => ring\.terrainHeightAt\(lx, ly, 0\)\)/);
  const story = read('src/game/story/storyGame.js');
  assert.match(story, /this\.deps\.k7SetBerth\(0, berthId, occ, occ, force\)/);
  const html = read('index.html');
  assert.doesNotMatch(html, /haloRings\??\.(constrainShip|pointInSlab|entries\b(?!\.map|\.find))/);
  assert.doesNotMatch(html, /k7Hall: \(/, 'fabuła nie pisze w obiekcie hali 3D');
  assert.match(html, /k7HallPoses: \(i = 0\) => haloWorld\?\.hall\('earth', i\)\?\.poses \|\| null,/);
});
