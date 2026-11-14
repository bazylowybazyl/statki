// Dzielnica ringu „huta” (dema/ring-dzielnice/huta), wersja „widoczny proces”: testy wspólne dzielnic oraz własne —
// układ torów rudy (statek dziobem do nabrzeża, pirs z odkurzaczem, zasiek, piec), trasa ciężarówek z drogi przez bramę
// do zatok przy regałach i z powrotem, BILANS MATERIAŁU procesu (ruda i metal nie rodzą się ani nie znikają),
// receptury jak w ekonomii gry, sceny i rysunek tworzywa bez NaN.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { RECIPES, RESOURCES } from '../src/data/resources.js';
import { hullFootprint } from '../src/game/traffic/dockLayout.js';
import { RING_V, pointInConvex, yardToArc } from '../dema/ring-dzielnice/kit/uklad.js';
import { TworzywoRecorder } from '../dema/ring-dzielnice/kit/tworzywo.js';
import plugin from '../dema/ring-dzielnice/huta/index.js';
import { LANES, PLANT, buildHutaLayout } from '../dema/ring-dzielnice/huta/uklad.js';
import { TUNE, createHutaProcess, moundCones, moundHeightAt } from '../dema/ring-dzielnice/huta/proces.js';
import { districtProbe, rect, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const L = built.layout;
const Hu = L.huta;
// rząd zewnętrzny szukany do 2 300 j. od lica drogi: w bramach ciężarówek ulica jest pusta aż do zakładu za rzędem
registerDistrictTests(test, assert, L, { outerDepth: 2300 });
const P = districtProbe(L);
const inPlant = (x, z) => Math.abs(x) <= PLANT.halfW && z >= Hu.Z0 + PLANT.top && z <= Hu.Z0 + PLANT.depth;

test('huta: pięć torów rudy — statek dziobem do nabrzeża poza bryłami, pirs z odkurzaczem sięga całej ładowni', () => {
  assert.equal(Hu.lanes.length, 5);
  const fp = hullFootprint('heavy_freighter');
  const ores = new Set();
  for (const lane of Hu.lanes) {
    ores.add(lane.ore);
    const b = lane.berth;
    assert.ok(fp.length <= b.length && fp.width <= b.width, `frachtowiec nie mieści się na stanowisku ${b.id}`);
    // podejście z przestrzeni prosto na stanowisko jest wolne
    for (let off = 0; off <= TUNE.shipReach; off += 200) assert.equal(P.hit(rect(b.x, b.z + off, b.heading, fp.length, fp.width)), null, `tor ${lane.index + 1}: podejście (${off} j.)`);
    // pola ładowni: w obrysie statku, w zasięgu suwnicy na pirsie i wysięgnika
    assert.equal(lane.cells.length, 24);
    for (const c of lane.cells) {
      assert.ok(Math.abs(c.x - b.x) < fp.width / 2 && Math.abs(c.z - b.z) < fp.length / 2, `tor ${lane.index + 1}: pole ładowni poza statkiem`);
      assert.ok(c.z > lane.pier.z0 + 100 && c.z < lane.pier.z1 - 100, `tor ${lane.index + 1}: pole ładowni poza długością pirsu`);
      assert.ok(lane.gantry.x - c.x < 720, `tor ${lane.index + 1}: wysięgnik nie sięga pola`);
    }
    // wylot odkurzacza i kopiec leżą w zasieku, zasiek w zakładzie
    const B = lane.bunker;
    for (const q of [lane.spout, lane.mound]) assert.ok(q.x > B.x0 && q.x < B.x1 && q.z > B.z0 && q.z < B.z1, `tor ${lane.index + 1}: wylot albo kopiec poza zasiekiem`);
    assert.ok(inPlant(B.x0, B.z0) && inPlant(B.x1, B.z1));
    // pełny kopiec mieści się w zasieku
    for (const c of moundCones(lane, TUNE.bunkerCap)) assert.ok(c.x - c.r > B.x0 - 1 && c.x + c.r < B.x1 + 1 && c.z - c.r > B.z0 - 1 && c.z + c.r < B.z1 + 1, `tor ${lane.index + 1}: pełny kopiec wychodzi z zasieku`);
    assert.ok(moundHeightAt(moundCones(lane, TUNE.bunkerCap), lane.mound.x, lane.mound.z) + B.floor < lane.spout.y - 40, 'kopiec nie sięga wylotu');
  }
  for (const ore of ['iron_ore', 'copper_ore', 'aluminum_ore', 'titanium_ore', 'carbon_ore']) assert.ok(ores.has(ore), `brak toru: ${ore}`);
});

test('huta: receptury torów są recepturami ekonomii gry, towary istnieją', () => {
  const R = { stal: 'smelt_steel', miedz: 'draw_copper_wire', glin: 'smelt_aluminum', tytan: 'alloy_titanium', ceramika: 'sinter_ceramic_armor' };
  for (const lane of LANES) {
    const rec = RECIPES[R[lane.id]];
    assert.ok(rec, `brak receptury ${R[lane.id]}`);
    assert.ok(RESOURCES[lane.ore] && RESOURCES[lane.out], `nieznany towar toru ${lane.id}`);
    assert.ok(rec.in[lane.ore] > 0 && rec.out[lane.out] > 0, `tor ${lane.id}: receptura nie zgadza się z towarem`);
    const out = lane.product === 'plate' ? TUNE.plate : TUNE.heat;
    assert.ok(Math.abs(lane.need / out - rec.in[lane.ore] / rec.out[lane.out]) < 1e-9, `tor ${lane.id}: ruda na jednostkę wyrobu`);
    if (lane.ingots) assert.ok(Math.abs(lane.ingots / out - rec.in.aluminum / rec.out[lane.out]) < 1e-9, 'tytan: dodatek glinu');
    if (lane.needAlu) assert.ok(Math.abs(lane.needAlu / out - rec.in.aluminum_ore / rec.out[lane.out]) < 1e-9, 'ceramika: ruda glinu');
  }
  for (const p of [...L.truckBays, ...L.railStops]) assert.ok(RESOURCES[p.goods], `nieznany towar „${p.goods}” (${p.id})`);
});

test('huta: ciężarówki wjeżdżają z pobocza drogi przez bramę, stają w zatoce przy każdym regale i wracają na pobocze', () => {
  const TR = Hu.truck;
  const o = {};
  const q = {};
  assert.equal(TR.routes.length, Hu.racks.length);
  TR.routes.forEach((route, r) => {
    // początek i koniec na poboczu drogi po stronie przestrzeni, w dzielnicy
    for (const d of [0, route.length]) {
      route.at(d, o);
      yardToArc(o.x, o.z, q);
      assert.ok(Math.abs(q.v - (RING_V.road + RING_V.shoulderOff)) < 2, `trasa ${r}: koniec poza poboczem (v=${q.v.toFixed(0)})`);
      assert.ok(Math.abs(q.s) < L.sMax, `trasa ${r}: koniec poza dzielnicą`);
    }
    let prevH = null;
    let inRow = 0;
    for (let d = 0; d <= route.length; d += 25) {
      route.at(d, o);
      yardToArc(o.x, o.z, q);
      // łagodne łuki: kurs nie skacze
      if (prevH !== null) { let dh = Math.abs(o.h - prevH); if (dh > Math.PI) dh = 2 * Math.PI - dh; assert.ok(dh < 0.25, `trasa ${r}: skok kursu ${dh.toFixed(2)} (d=${d})`); }
      prevH = o.h;
      // przez rząd zewnętrzny tylko bramą (zgłoszonym otworem), poza tym: droga albo zakład
      if (q.v > RING_V.outer0 + 5 && !inPlant(o.x, o.z)) {
        inRow++;
        assert.ok(L.openings.some((g) => q.s > g.s0 + 40 && q.s < g.s1 - 40), `trasa ${r}: przez rząd poza bramą (s=${q.s.toFixed(0)}, v=${q.v.toFixed(0)})`);
        for (const sld of L.solids) assert.ok(!pointInConvex(sld.points, o.x, o.z), `trasa ${r}: w bryle ${sld.id}`);
      }
    }
    assert.ok(inRow > 20, `trasa ${r}: nie przechodzi przez bramę`);
    // postój: naczepa w zatoce przy swoim regale, w zasięgu suwnicy, która obsługuje regał
    route.at(TR.stops[r], o);
    const R = Hu.racks[r];
    assert.ok(Math.abs(o.z - TR.bayZ) < 1 && o.x > R.x0 - 300 && o.x < R.x1 + 300, `trasa ${r}: postój poza zatoką regału`);
    const crane = Hu.cranes.find((c) => c.racks.includes(r));
    assert.ok(crane && o.x - 220 > crane.x0 && o.x + 220 < crane.x1 && o.z > crane.z0 && o.z < crane.z1, `regał ${r}: zatoka poza zasięgiem suwnicy`);
    for (const s of R.slots) assert.ok(s.x > crane.x0 && s.x < crane.x1 && s.z > crane.z0 + 60 && s.z < crane.z1 - 60, `regał ${r}: miejsce poza zasięgiem suwnicy`);
  });
});

test('huta: bilans materiału — ruda i metal nie rodzą się ani nie znikają; każdy tor pracuje od statku po ciężarówkę', () => {
  const proc = createHutaProcess(buildHutaLayout().huta, { seed: 11, prewarm: 0 });
  let maxChunks = 0;
  for (let i = 0; i < 60 * 540; i++) {
    proc.step(1 / 60);
    if (proc.chunks.length > maxChunks) maxChunks = proc.chunks.length;
    if (i % 1800 === 0) {
      const a = proc.audit();
      for (const e of [...a.oreErr, ...a.metalErr]) assert.ok(Math.abs(e) < 1e-6, `bilans w kroku ${i}: ${e}`);
    }
  }
  const a = proc.audit();
  for (const e of [...a.oreErr, ...a.metalErr]) assert.ok(Math.abs(e) < 1e-6, `bilans na końcu: ${e}`);
  const s = proc.stats();
  // w 9 minut: każdy statek co najmniej raz przypłynął, każdy piec zrobił kilka wytopów, z każdego toru wyjechał wyrób
  for (let i = 0; i < 5; i++) {
    assert.ok(proc.ore.delivered[i] > 300 || i === 4, `tor ${i + 1}: brak dostawy rudy`);
    assert.ok(proc.metal.made[i] > 0, `tor ${i + 1}: brak wyrobu`);
    assert.ok(proc.metal.shipped[i] > 0, `tor ${i + 1}: nic nie wyjechało ciężarówką`);
    assert.ok(proc.stock[i] >= 0 && proc.stock[i] <= TUNE.bunkerCap + 1, `tor ${i + 1}: zasiek poza pojemnością (${proc.stock[i]})`);
  }
  for (const h of s.heats) assert.ok(h >= 5, `piec zrobił tylko ${h} wytopów`);
  // ruda na wyrób jak w recepturze (stal: 3 → 2)
  assert.ok(Math.abs(proc.ore.used[0] / proc.metal.made[0] - 1.5) < 1e-9);
  assert.ok(s.trucksOut >= 20, `wyjechało tylko ${s.trucksOut} ciężarówek`);
  assert.ok(maxChunks > 10 && maxChunks < 400, `bryłek w locie naraz: ${maxChunks}`);
  // regały się nie zatykają (suwnice i ciężarówki nadążają)
  proc.racks.forEach((R, r) => assert.ok(R.top < R.slots.length, `regał ${r} pełny`));
});

test('huta: ten sam przebieg z tego samego ziarna; kadzie trzymają odstęp na pętli, ciężarówki na trasie', () => {
  const run = () => {
    const proc = createHutaProcess(buildHutaLayout().huta, { seed: 5, prewarm: 0 });
    const LP = proc.lanes.length && buildHutaLayout().huta.loop.length;
    let minLadle = Infinity;
    let minTruck = Infinity;
    for (let i = 0; i < 60 * 240; i++) {
      proc.step(1 / 60);
      for (const a of proc.ladles) for (const b of proc.ladles) if (a !== b) { const d = (((b.d - a.d) % LP) + LP) % LP; if (d < minLadle) minLadle = d; }
      for (const a of proc.trucks) for (const b of proc.trucks) if (a !== b && !a.inBay && !b.inBay && Math.abs(a.z - b.z) < 60 && Math.abs(a.x - b.x) < minTruck) minTruck = Math.abs(a.x - b.x);
    }
    return { stats: JSON.stringify(proc.stats()), minLadle, minTruck };
  };
  const a = run();
  const b = run();
  assert.equal(a.stats, b.stats);
  assert.ok(a.minLadle > TUNE.ladleGap - 5, `kadzie za blisko: ${a.minLadle.toFixed(0)} j.`);
  assert.ok(a.minTruck > 440, `ciężarówki na pasie za blisko: ${a.minTruck.toFixed(0)} j.`);
});

test('huta: sceny budują się bez NaN, grupy ruchome w limicie; rysunek procesu przez tworzywo bez NaN i bez przepełnienia', () => {
  assert.equal(built.buildings.length, 3);
  for (const def of built.buildings) {
    assert.ok(def.scene.instances > 200 && def.scene.instances < 6000, `${def.name}: ${def.scene.instances} instancji`);
    for (const set of Object.values(def.scene.sets)) for (const arr of Object.values(set)) for (const v of arr) assert.ok(Number.isFinite(v), `NaN w ${def.name}`);
    for (const p of def.scene.plates) for (const [x, z] of p.points) assert.ok(Number.isFinite(x) && Number.isFinite(z), `NaN w płycie ${def.name}`);
    assert.ok(def.scene.lamps.length <= 8, `${def.name}: ${def.scene.lamps.length} lamp`);
  }
  assert.equal(built.buildings[1].scene.rig.cranes.length, Hu.cranes.length);
  assert.equal(built.buildings[2].scene.rig.vacs.length, Hu.lanes.length);
  // atrapa api gospodarza: macierze grup i rejestrator tworzywa
  const M4 = () => ({ makeTranslation() { return this; } });
  const fake = (scene) => ({ scene, uniforms: { uGroup: { value: Array.from({ length: 64 }, M4) } } });
  const rec = new TworzywoRecorder();
  const proxies = [];
  const api = { buildings: built.buildings.map((b) => fake(b.scene)), occupied: new Set(), tworzywo: rec, proxy: (...a) => proxies.push(a) };
  built.init(api);
  let peak = 0;
  for (let i = 0; i < 400; i++) {
    built.step(1 / 5, api);
    rec.begin();
    proxies.length = 0;
    built.frame(api);
    peak = Math.max(peak, rec.total());
    for (const k in rec.data) { const a = rec.data[k]; for (let j = 0; j < rec.count[k] * 16; j++) assert.ok(Number.isFinite(a[j]), `NaN w tworzywie ${k} (klatka ${i})`); }
    for (const p of proxies) assert.ok(p.slice(2, 5).every(Number.isFinite), 'NaN w pozie statku');
  }
  assert.equal(rec.dropped, 0, 'tworzywo: przepełniony bufor');
  assert.ok(peak > 300, `tworzywo: tylko ${peak} brył`);
});
