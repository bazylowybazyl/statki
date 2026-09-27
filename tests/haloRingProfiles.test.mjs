// Profile ringów „Halo” per planeta (Z6, 2026-09-26): Ziemia bez zmian (tło
// menu), ringi Marsa i Jowisza oraz ich doki inne niż Ziemi (decyzja
// użytkownika), wspólne programy GPU (wartości uniformów, nie źródła),
// geometria stanowisk i kolizje doków w standardzie K-7. Bez GPU.
// node --test tests/haloRingProfiles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HALO_ATMOSPHERE,
  HALO_HDR,
  HALO_LIGHT,
  HALO_SECTOR_PLAN_16,
  HALO_TERRAIN,
  haloPortComplexAngles
} from '../src/3d/haloRing/haloRingConfig.js';
import {
  HALO_MEGA_PALETTE_SIZE,
  HALO_PROFILE_KEYS,
  HALO_RING_PROFILES,
  HALO_STRUCTURE_PALETTE_KEYS,
  HALO_TERRAIN_PALETTE_KEYS,
  resolveHaloProfile
} from '../src/3d/haloRing/haloRingProfiles.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { buildHaloLandmarkPlan, haloCivicContext, haloLandmarkParts, HALO_INDUSTRIAL_LANDMARK_KINDS } from '../src/3d/haloRing/haloRingLandmarks.js';
import { buildHaloDomePlan } from '../src/3d/haloRing/haloRingDomes.js';
import { buildK7Scene } from '../src/3d/haloRing/haloPortK7Build.js';
import { createK7Layout, k7Frame, k7SolidList } from '../src/3d/haloRing/haloPortK7Layout.js';
import { baySolidList, haloBayLayouts, haloFrameToFrame } from '../src/3d/haloRing/haloPortBays.js';
import { IND_KIT_CDF_DEFAULT, IND_LOT, IND_PARTS, indKitPart, indKitType } from '../src/3d/haloRing/haloRingIndustryKit.js';
import { industrialCellRule } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_RING_PLANETS, haloRingLayoutFor } from '../src/game/haloRingPlanets.js';
import { HaloRingCollider } from '../src/game/haloRingCollision.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layoutOf = (key) => createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: key });

test('Ziemia = liczby sprzed profili (ring Ziemi i tło menu bez zmian)', () => {
  const e = HALO_RING_PROFILES.earth;
  assert.equal(e.sectorPlan, HALO_SECTOR_PLAN_16);
  assert.deepEqual(e.air.rayleigh, HALO_ATMOSPHERE.rayleigh);
  assert.equal(e.air.mie, HALO_ATMOSPHERE.mie);
  assert.equal(e.air.scaleHeight, HALO_ATMOSPHERE.scaleHeight);
  assert.equal(e.air.skyBoost, HALO_ATMOSPHERE.skyBoost);
  assert.deepEqual(e.air.cloudCoverBias, HALO_ATMOSPHERE.cloudCoverBias);
  assert.deepEqual(e.air.mieTint, [1, 1, 1]);
  for (const k of ['sunIntensity', 'planetAlbedo', 'planetshineGain', 'planetAtmosphereHeight', 'skyAmbient', 'nightAmbient']) {
    assert.equal(e.light[k], HALO_LIGHT[k], k);
  }
  assert.deepEqual(e.light.sunColor, HALO_LIGHT.sunColor);
  assert.deepEqual(e.hdr.windowWarm, HALO_HDR.windowWarm);
  assert.deepEqual(e.hdr.windowSodium, HALO_HDR.windowSodium);
  assert.deepEqual(e.hdr.windowCool, HALO_HDR.windowCool);
  assert.deepEqual(e.hdr.strip, HALO_HDR.stripBlue);
  assert.equal(e.terrain.seaDepth, HALO_TERRAIN.seaDepth);
  assert.deepEqual([e.terrain.plateau, e.terrain.rivers, e.canyons.length, e.frag.sulfur, e.frag.lineae, e.storm.strength], [0, 1, 0, 0, 0, 0]);
  assert.deepEqual([...e.domeTint, ...e.leafTint, ...e.indTopTint, ...e.structurePalette.roofTint], Array(12).fill(1));
  assert.deepEqual(e.industryKit.cdf, [...IND_KIT_CDF_DEFAULT]);
  assert.equal(e.port.name, 'PORT KEPLER');
  assert.deepEqual([e.port.roof, e.port.walls, e.port.bays], ['k7', 'k7', 'k7']);
  // Ziemia bez cech terenu Marsa i Jowisza
  assert.ok(HALO_SECTOR_PLAN_16.every((s) => !s.feat));
});

test('profile kompletne: palety, pasma HDR, reguły; nieznany klucz = Ziemia', () => {
  assert.deepEqual([...HALO_PROFILE_KEYS], ['earth', 'mars', 'jupiter']);
  assert.equal(resolveHaloProfile('venus'), HALO_RING_PROFILES.earth);
  assert.equal(resolveHaloProfile(HALO_RING_PROFILES.mars), HALO_RING_PROFILES.mars);
  const fin3 = (c) => Array.isArray(c) && c.length === 3 && c.every((x) => Number.isFinite(x) && x >= 0);
  for (const p of Object.values(HALO_RING_PROFILES)) {
    for (const k of HALO_TERRAIN_PALETTE_KEYS) assert.ok(fin3(p.terrainPalette[k]), `${p.key}: teren ${k}`);
    for (const k of HALO_STRUCTURE_PALETTE_KEYS) assert.ok(fin3(p.structurePalette[k]), `${p.key}: konstrukcja ${k}`);
    assert.equal(p.megaPalette.length, HALO_MEGA_PALETTE_SIZE);
    assert.ok(p.megaPalette.every(fin3));
    // albedo < 0,8 (oświetlona powierzchnia zostaje pod progiem bloomu, brief §9)
    for (const c of [...Object.values(p.terrainPalette), ...p.megaPalette]) assert.ok(Math.max(...c) < 0.8, `${p.key}: albedo ${c}`);
    // barwne światła w paśmie 0,9–1,4 (bloomują i zostają barwne)
    for (const [k, c] of Object.entries(p.hdr)) assert.ok(Math.max(...c) >= 0.9 && Math.max(...c) <= 1.4, `${p.key}: HDR ${k}`);
    assert.equal(p.sectorPlan.length, 16);
    assert.ok(p.sectorPlan[0].port, `${p.key}: sektor 0 = port`);
    assert.equal(p.port.k7Palette.length, 14);
    assert.equal(p.port.k7Emit.length, 5);
    assert.equal(p.roofRules.occupancy.length, 4);
    assert.equal(p.industryKit.cdf.length, 8);
    for (let i = 1; i < 8; i++) assert.ok(p.industryKit.cdf[i] >= p.industryKit.cdf[i - 1], `${p.key}: cdf rosnące`);
  }
});

test('Mars i Jowisz — ringi i doki inne niż Ziemia (decyzja użytkownika 2026-09-26)', () => {
  const E = HALO_RING_PROFILES.earth;
  for (const key of ['mars', 'jupiter']) {
    const P = HALO_RING_PROFILES[key];
    const names = new Set(P.sectorPlan.map((s) => s.name));
    assert.ok(E.sectorPlan.every((s) => !names.has(s.name)), `${key}: własne nazwy sektorów`);
    for (const k of ['grassLush', 'sandA', 'rockA', 'snow', 'cityRoof']) assert.notDeepEqual(P.terrainPalette[k], E.terrainPalette[k], `${key}: teren ${k}`);
    for (const k of ['hull', 'roof', 'wall']) assert.notDeepEqual(P.structurePalette[k], E.structurePalette[k], `${key}: konstrukcja ${k}`);
    assert.notDeepEqual(P.air.rayleigh, E.air.rayleigh, `${key}: powietrze`);
    assert.notDeepEqual(P.sky.tint, E.sky.tint, `${key}: niebo`);
    assert.notDeepEqual(P.hdr.strip, E.hdr.strip, `${key}: pasy świateł`);
    // doki: nazwa, paleta, emisja, napisy, dach, ściany z zewnątrz, zatoki
    assert.notEqual(P.port.name, E.port.name);
    assert.ok(P.port.k7Palette.filter((c, i) => c !== E.port.k7Palette[i]).length >= 12, `${key}: paleta K-7`);
    assert.notDeepEqual(P.port.k7Emit[0], E.port.k7Emit[0]);
    assert.notEqual(P.port.labels.gate, E.port.labels.gate);
    assert.notEqual(P.port.roof, E.port.roof);
    assert.notEqual(P.port.walls, E.port.walls);
    assert.notEqual(P.port.bays, E.port.bays);
  }
  // Mars: kaniony, kratery, kopuły-miasta; Jowisz: przemysł, lód z liniami, siarka, burze
  const M = HALO_RING_PROFILES.mars;
  assert.ok(M.canyons.length === 2 && M.sectorPlan.some((s) => s.feat?.canyon > 0) && M.sectorPlan.some((s) => s.feat?.crater > 0.5));
  assert.equal(M.sectorPlan.filter((s) => s.type === 'industrial').length, 0, 'Mars: przemysł tylko wokół doków (jak Ziemia)');
  const J = HALO_RING_PROFILES.jupiter;
  assert.ok(J.sectorPlan.filter((s) => s.type === 'industrial').length >= 6, 'Jowisz: przemysł przerobu gazów');
  assert.ok(J.frag.lineae > 0 && J.frag.sulfur > 0 && J.storm.strength > 0);
  assert.ok(J.industryKit.cdf[6] < 1 && indKitType(0.95, J.industryKit.cdf) === 7, 'Jowisz: pola radiatorów');
});

test('trzy ringi = te same programy GPU: ten sam zestaw uniformów, inne wartości', () => {
  const us = ['earth', 'mars', 'jupiter'].map((k) => createHaloUniforms(layoutOf(k)));
  const keys = us.map((u) => Object.keys(u).sort().join(','));
  assert.equal(keys[1], keys[0]);
  assert.equal(keys[2], keys[0]);
  const t = (u) => u.uTerPal.value.map((v) => v.toArray().join(',')).join(';');
  assert.notEqual(t(us[1]), t(us[0]));
  assert.notEqual(t(us[2]), t(us[0]));
  assert.equal(us[0].uStorm.value.x, 0);
  assert.ok(us[2].uStorm.value.x > 0);
  // shadery nie wstawiają wartości profilu do źródeł (brak ${…HALO_HDR…} w kodzie ringu)
  for (const f of ['haloRingTerrain.js', 'haloRingStructure.js', 'haloRingAtmosphere.js']) {
    assert.doesNotMatch(read(`src/3d/haloRing/${f}`), /HALO_HDR\./, `${f}: HDR z uniformów profilu`);
  }
  assert.doesNotMatch(read('src/3d/haloRing/haloPortK7.js'), /K7_PALETTE\.map/, 'paleta K-7 z uniformów');
});

test('doki: styl zmienia wygląd, nie stanowiska ani kolizje; nic nad kamerą gry', () => {
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
    for (const b of bays) assert.ok(baySolidList(b.layout).length > 20);
  }
  // porty trzech planet: 4 kompleksy, ten sam rejestr stanowisk i świat ścian
  const walls = ['earth', 'mars', 'jupiter'].map((k) => new HaloRingCollider({ id: k, x: 0, y: 0 }));
  for (const c of walls) {
    assert.equal(c.registry.halls.length, 4);
    assert.equal(c.registry.bays.length, 8);
    assert.equal(c.wallItems.length, walls[0].wallItems.length);
  }
});

test('Jowisz w grze: promień i profil w układzie ringu (kolizje, ruch v2, render — ten sam)', () => {
  const L = haloRingLayoutFor({ id: 'jupiter' });
  assert.equal(L.planetRadius, RING_PLANET_WORLD_RADII.jupiter);
  assert.equal(L.planetProfile.key, 'jupiter');
  assert.equal(L.seed, HALO_RING_PLANETS.jupiter.seed);
  assert.ok(RING_PLANET_WORLD_RADII.jupiter > RING_PLANET_WORLD_RADII.earth, 'Jowisz największy');
  // obwiednia: port z halami i redą (~R + 21 tys.) przed księżycami mapy (Europa 105 tys.)
  assert.ok(L.radii.rim + 9000 + 12000 < 105000);
  assert.equal(haloRingLayoutFor({ id: 'mars' }).planetProfile.key, 'mars');
  assert.equal(haloRingLayoutFor({ id: 'earth' }).planetProfile.key, 'earth');
});

test('megabudowle i kopuły per planeta: Mars — miasta pod kopułami, Jowisz — zakłady przemysłowe', () => {
  const plan = (key) => {
    const L = layoutOf(key);
    const ctx = haloCivicContext(L, {});
    return { L, lms: buildHaloLandmarkPlan(L, { ctx }), domes: buildHaloDomePlan(L, { ctx }) };
  };
  const m = plan('mars');
  assert.ok(m.lms.length >= 6, `Mars: megabudowle ${m.lms.length}`);
  assert.ok(m.domes.filter((d) => d.city).length >= 6, `Mars: miasta pod kopułami ${m.domes.filter((d) => d.city).length}`);
  for (const d of m.domes) assert.ok(!m.L.sectors[d.sector].port);
  const j = plan('jupiter');
  const ind = j.lms.filter((l) => HALO_INDUSTRIAL_LANDMARK_KINDS.has(l.kind));
  assert.ok(ind.length >= 5, `Jowisz: zakłady ${ind.length}`);
  for (const l of ind) {
    assert.equal(j.L.sectors[l.sector].type, 'industrial');
    assert.ok(l.apron && !l.pond && l.pavilions.length === 0, `${l.name}: fartuch bez parku`);
    const parts = haloLandmarkParts(l);
    assert.ok(parts.boxes.some((b) => b.prim === 'dome') || parts.boxes.some((b) => b.prim === 'cyl'), `${l.name}: zbiorniki / kolumny`);
    for (const b of parts.boxes) assert.ok(b.sa > 0 && b.sq > 0 && b.su > 0 && Number.isFinite(b.u0));
    // pochodnia i wieże w zasięgu wysokości megabudowli
    for (const b of parts.boxes) assert.ok(b.u0 + (b.flip ? 0 : b.su) < l.h * 1.4 + 40, `${l.name}: za wysoko`);
  }
  // Ziemia: bez zmian (9 budowli ECUMENE, 12 kopuł)
  const e = plan('earth');
  assert.equal(e.lms.length, 9);
  assert.equal(e.domes.length, 12);
  assert.ok(e.lms.every((l) => !l.apron));
});

test('zestaw zakładów: pola radiatorów Jowisza mieszczą się w działce; reguły dachu z profilu', () => {
  const J = HALO_RING_PROFILES.jupiter.industryKit.cdf;
  let seen7 = 0;
  for (let i = 0; i < 400; i++) {
    const lotH = (i + 0.5) / 400;
    assert.ok(indKitType(lotH) <= 6, 'Ziemia bez radiatorów');
    if (indKitType(lotH, J) !== 7) continue;
    seen7++;
    for (let p = 0; p < IND_PARTS; p++) {
      const { A, B } = indKitPart(lotH, p, J);
      if (!(B[1] > 0)) continue;
      const box = p < 2;
      const hx = box ? A[2] / 2 : A[2];
      const hy = box ? A[3] / 2 : A[2];
      assert.ok(Math.abs(A[0]) + hx <= IND_LOT.halfU + 1 && Math.abs(A[1]) + hy <= IND_LOT.halfW + 1, `radiator p${p} poza działką`);
      assert.ok(B[1] < 60, 'radiator niski');
    }
  }
  assert.ok(seen7 > 50);
  // reguły dachu: Jowisz więcej zbiorników i radiatorów niż Ziemia
  const count = (rules, kind) => {
    let n = 0;
    for (let i = 0; i < 400; i++) for (let j = 0; j < 6; j++) if (industrialCellRule(i, j, 2, 56, rules)?.kind === kind) n++;
    return n;
  };
  const E = HALO_RING_PROFILES.earth.roofRules;
  const JR = HALO_RING_PROFILES.jupiter.roofRules;
  assert.ok(count(JR, 1) > count(E, 1) && count(JR, 3) > count(E, 3), 'zbiorniki i radiatory');
  assert.equal(count(E, 1), count(undefined, 1), 'domyślnie reguły Ziemi');
});
