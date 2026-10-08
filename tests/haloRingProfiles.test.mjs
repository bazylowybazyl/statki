// Profile ringów per planeta (Z6, 2026-09-26/27): Ziemia bez zmian (tło
// menu), Mars = ECUMENE, Jowisz = ring Fable — INNE RINGI (decyzja
// użytkownika 2026-09-27: „kompletnie inne ringi, nie tylko skórka”), doki
// w stylu dem, geometria stanowisk i kolizje doków w standardzie K-7. Bez GPU.
// node --test tests/haloRingProfiles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HALO_ATMOSPHERE,
  HALO_GEOMETRY_DEFAULTS,
  HALO_HDR,
  HALO_LIGHT,
  HALO_SECTOR_PLAN_16,
  HALO_TERRAIN,
  haloPortComplexAngles,
  haloTransitAngles
} from '../src/3d/haloRing/haloRingConfig.js';
import { HALO_PROFILE_KEYS, HALO_RING_PROFILES, resolveHaloProfile } from '../src/3d/haloRing/haloRingProfiles.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { buildK7Scene } from '../src/3d/haloRing/haloPortK7Build.js';
import { createK7Layout, k7Frame, k7SolidList } from '../src/3d/haloRing/haloPortK7Layout.js';
import { baySolidList, haloBayLayouts, haloFrameToFrame } from '../src/3d/haloRing/haloPortBays.js';
import { IND_KIT_CDF_DEFAULT } from '../src/3d/haloRing/haloRingIndustryKit.js';
import { HALO_RING_PLANETS, computeHaloPortStation, haloRingLayoutFor } from '../src/game/haloRingPlanets.js';
import { HaloRingCollider } from '../src/game/haloRingCollision.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layoutOf = (key) => createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: key });
const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

test('Ziemia = liczby sprzed profili (ring Ziemi i tło menu bez zmian)', () => {
  const e = HALO_RING_PROFILES.earth;
  assert.equal(e.archetype, 'halo');
  assert.equal(e.geometry, null);
  assert.equal(e.sectorPlan, HALO_SECTOR_PLAN_16);
  assert.deepEqual(e.air.rayleigh, HALO_ATMOSPHERE.rayleigh);
  assert.equal(e.air.mie, HALO_ATMOSPHERE.mie);
  assert.equal(e.air.scaleHeight, HALO_ATMOSPHERE.scaleHeight);
  assert.equal(e.air.skyBoost, HALO_ATMOSPHERE.skyBoost);
  assert.deepEqual(e.air.cloudCoverBias, HALO_ATMOSPHERE.cloudCoverBias);
  for (const k of ['sunIntensity', 'planetAlbedo', 'planetshineGain', 'planetAtmosphereHeight', 'skyAmbient', 'nightAmbient']) {
    assert.equal(e.light[k], HALO_LIGHT[k], k);
  }
  assert.deepEqual(e.light.sunColor, HALO_LIGHT.sunColor);
  assert.deepEqual(e.hdr.windowWarm, HALO_HDR.windowWarm);
  assert.deepEqual(e.hdr.strip, HALO_HDR.stripBlue);
  assert.equal(e.terrain.seaDepth, HALO_TERRAIN.seaDepth);
  assert.deepEqual(e.industryKit.cdf, [...IND_KIT_CDF_DEFAULT]);
  assert.equal(e.port.name, 'PORT KEPLER');
  assert.deepEqual([e.port.roof, e.port.walls, e.port.bays], ['k7', 'k7', 'k7']);
  // układ Ziemi = wartości domyślne geometrii (obwiednia, kolizje, ruch v2 bez zmian)
  const L = layoutOf('earth');
  assert.equal(L.archetype, 'halo');
  assert.deepEqual([L.width, L.wallHeight, L.hullThickness, L.wallThickness, L.sectors.length],
    [HALO_GEOMETRY_DEFAULTS.width, HALO_GEOMETRY_DEFAULTS.wallHeight, HALO_GEOMETRY_DEFAULTS.hullThickness, HALO_GEOMETRY_DEFAULTS.wallThickness, 16]);
  assert.deepEqual([L.radii.rim, L.radii.floorMid, L.radii.back], [43752, 42252, 41800]);
});

test('Mars = ECUMENE, Jowisz = ring Fable: archetyp, geometria dem ×3, plan dzielnic', () => {
  assert.deepEqual([...HALO_PROFILE_KEYS], ['earth', 'mars', 'jupiter']);
  assert.equal(resolveHaloProfile('venus'), HALO_RING_PROFILES.earth);
  const M = HALO_RING_PROFILES.mars;
  const J = HALO_RING_PROFILES.jupiter;
  assert.equal(M.archetype, 'ecumene');
  assert.equal(J.archetype, 'fable');
  // ECUMENE: podłoga 3 × 2 100, krawędzie 3 × 54, 12 dzielnic dema (każda raz)
  const LM = layoutOf('mars');
  assert.equal(LM.archetype, 'ecumene');
  assert.equal(LM.floor.spanZ, 6300);
  assert.equal(LM.wallHeight, 162);
  assert.equal(LM.sectors.length, 12);
  assert.deepEqual(LM.sectors.map((s) => s.district).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // Fable: podłoga 3 × 1 800, ściany 3 × 260, 12 układów dema × 2
  const LJ = layoutOf('jupiter');
  assert.equal(LJ.archetype, 'fable');
  assert.equal(LJ.floor.spanZ, 5400);
  assert.equal(LJ.wallHeight, 780);
  assert.equal(LJ.sectors.length, 24);
  const layouts = new Set(LJ.sectors.map((s) => s.layout));
  assert.equal(layouts.size, 12);
  // kompleksy portu (co 90°) trafiają na dzielnice portowe, nie na kopuły ani supertalle
  const sectorAt = (L, th) => L.sectorIndexAt(wrap(th));
  const mPorts = haloPortComplexAngles().map((a) => LM.sectors[sectorAt(LM, a)].district);
  assert.deepEqual(mPorts, [7, 10, 1, 5], 'KEPLER (gracz), DAEDALUS, VESPER, DEMETER');
  const jPorts = haloPortComplexAngles().map((a) => LJ.sectors[sectorAt(LJ, a)].layout);
  assert.deepEqual(jPorts, ['port', 'shipyard', 'port', 'shipyard']);
  // tranzyty (środki między kompleksami) Jowisza: las i rolnictwo, bez kopuł
  const jTransit = haloTransitAngles().map((a) => LJ.sectors[sectorAt(LJ, a)].layout);
  for (const l of jTransit) assert.ok(l === 'forest' || l === 'farms', `tranzyt w sektorze ${l}`);
  // nazwy własne (bez powtórek z ringiem Ziemi)
  const earthNames = new Set(HALO_SECTOR_PLAN_16.map((s) => s.name));
  for (const L of [LM, LJ]) for (const s of L.sectors) assert.ok(!earthNames.has(s.name), `${s.name} jak na Ziemi`);
});

test('doki Marsa i Jowisza w stylu dem; Z7 dostaje swoje rodziny budowli', () => {
  const E = HALO_RING_PROFILES.earth.port;
  for (const [key, style] of [['mars', 'ecumene'], ['jupiter', 'fable']]) {
    const P = HALO_RING_PROFILES[key].port;
    assert.deepEqual([P.roof, P.walls, P.bays], [style, style, style]);
    assert.notEqual(P.name, E.name);
    assert.equal(P.k7Palette.length, 14);
    assert.equal(P.k7Emit.length, 5);
    assert.ok(P.k7Palette.filter((c, i) => c !== E.k7Palette[i]).length >= 12, `${key}: paleta K-7`);
    assert.notEqual(P.labels.gate, E.labels.gate);
    for (const c of P.k7Emit) assert.ok(Math.max(...c) >= 0.9 && Math.max(...c) <= 1.4, `${key}: emisja w paśmie HDR`);
  }
  // budowle portowe Z7 (portBuildingStyle.js): rodziny jak dotąd (blok buildings)
  assert.deepEqual(['earth', 'mars', 'jupiter'].map((k) => resolvePortBuildingStyle(k).family), ['k7', 'vault', 'radiator']);
});

test('hala K-7: styl zmienia wygląd, nie stanowiska ani kolizje; nic nad kamerą gry', () => {
  const rot = (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const refSolids = JSON.stringify(k7SolidList(createK7Layout()));
  for (const key of ['earth', 'mars', 'jupiter']) {
    const L = layoutOf(key);
    const f = k7Frame(L, haloPortComplexAngles()[0]);
    const bays = haloBayLayouts(L).filter((b) => b.complex === 0).map((b) => ({ layout: b, xf: haloFrameToFrame(b.frame, f) }));
    const s = buildK7Scene(createK7Layout(), { floorZ: f.floorZ, rimZ: f.rimZ, floorR: f.floorR, bays, style: L.planetProfile.port });
    let top = -Infinity;
    for (const set of Object.values(s.sets)) {
      for (const [kind, data] of Object.entries(set)) {
        const ext = kind === 'box' ? 0.5 : 1;
        for (let i = 0; i < data.length; i += 16) {
          const q = [data[i + 8], data[i + 9], data[i + 10], data[i + 11]];
          for (const cx of [-ext, ext]) for (const cy of [-0.5, 0.5]) for (const cz of [-ext, ext]) {
            const v = rot(q, [cx * data[i + 4], cy * data[i + 5], cz * data[i + 6]]);
            top = Math.max(top, data[i + 1] + v[1] * data[i + 3]);
          }
        }
      }
    }
    assert.ok(top < 435, `${key}: najwyższy punkt hali z = ${top.toFixed(0)} (kamera przy zoomie 3,2 wisi 535 j.)`);
    assert.equal(s.lamps.length, 28 + 2 * 14, `${key}: lampki stanowisk`);
    assert.ok(s.labels.some((l) => l.vertical && l.text === L.planetProfile.port.name), `${key}: nazwa terminalu`);
    assert.equal(JSON.stringify(k7SolidList(createK7Layout())), refSolids, 'kolizje hali wspólne');
    for (const b of bays) assert.ok(baySolidList(b.layout).length > 15, 'zatoka: ściany, słupki serwisowe i paliwowe (bez nóg suwnic — 2026-10-07)');
  }
  // porty trzech planet: 4 kompleksy, ten sam rejestr stanowisk i świat ścian
  const walls = ['earth', 'mars', 'jupiter'].map((k) => new HaloRingCollider({ id: k, x: 0, y: 0 }));
  for (const c of walls) {
    assert.equal(c.registry.halls.length, 4);
    assert.equal(c.registry.bays.length, 8);
    assert.equal(c.wallItems.length, walls[0].wallItems.length);
  }
});

test('geometria archetypu z profilu trafia wszędzie: render, kolizje, ruch v2, stacja-port', () => {
  for (const key of ['mars', 'jupiter']) {
    const L = haloRingLayoutFor({ id: key });
    const P = HALO_RING_PROFILES[key].geometry;
    assert.equal(L.width, P.width);
    assert.equal(L.wallHeight, P.wallHeight);
    assert.equal(L.hullThickness, P.hullThickness);
    // płyta kolizji = od kadłuba (z żebrami) do podłogi
    assert.equal(L.radii.floorMid - L.radii.back, P.hullThickness);
    const c = new HaloRingCollider({ id: key, x: 0, y: 0 });
    assert.equal(c.layout.radii.back, L.radii.back);
    // stacja-port liczona z tej samej ramy hali
    const st = computeHaloPortStation({ id: key });
    assert.ok(st.orbitRadius > L.radii.floorMid);
  }
  const J = haloRingLayoutFor({ id: 'jupiter' });
  assert.equal(J.planetRadius, RING_PLANET_WORLD_RADII.jupiter);
  assert.equal(J.seed, HALO_RING_PLANETS.jupiter.seed);
  // obwiednia: port z halami i redą (~R + 21 tys.) przed księżycami mapy (Europa 105 tys.)
  assert.ok(J.radii.rim + 9000 + 12000 < 105000);
});

test('trzy ringi dzielą uniformy hali K-7 (światło z profilu); shadery Halo bez stałych profilu', () => {
  const us = ['earth', 'mars', 'jupiter'].map((k) => createHaloUniforms(layoutOf(k)));
  const keys = us.map((u) => Object.keys(u).sort().join(','));
  assert.equal(keys[1], keys[0]);
  assert.equal(keys[2], keys[0]);
  assert.notDeepEqual(us[1].uSkyTint.value.toArray(), us[0].uSkyTint.value.toArray());
  for (const f of ['haloRingTerrain.js', 'haloRingStructure.js', 'haloRingAtmosphere.js']) {
    assert.doesNotMatch(read(`src/3d/haloRing/${f}`), /HALO_HDR\./, `${f}: HDR z uniformów profilu`);
  }
  assert.doesNotMatch(read('src/3d/haloRing/haloPortK7.js'), /K7_PALETTE\.map/, 'paleta K-7 z uniformów');
});
