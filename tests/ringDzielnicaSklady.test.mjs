// Dzielnica ringu „sklady” (dema/ring-dzielnice/sklady): testy wspólne układu + własne — towary z ekonomii, połączenie
// z zewnątrz, punkt nadań, terminal kolei, budżet brył (instancje, grupy ruchome, lampy), ruch bez NaN.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { RESOURCES } from '../src/data/resources.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS } from '../src/3d/portBuildings/portBuildingScene.js';
import plugin from '../dema/ring-dzielnice/sklady/index.js';
import { SK } from '../dema/ring-dzielnice/sklady/uklad.js';
import { districtProbe, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const L = built.layout;
registerDistrictTests(test, assert, L);

test('sklady: długość 14–18 tys. j. łuku', () => {
  const len = L.sMax - L.sMin;
  assert.ok(len >= 14000 && len <= 18000, `długość ${len}`);
});

test('sklady: towary zatok, przystanków i farmy to id z ekonomii (src/data/resources.js)', () => {
  for (const b of L.truckBays) assert.ok(RESOURCES[b.goods], `zatoka ${b.id}: nieznany towar „${b.goods}”`);
  for (const r of L.railStops) assert.ok(RESOURCES[r.goods], `przystanek ${r.id}: nieznany towar „${r.goods}”`);
  for (const f of SK.fluids) assert.ok(RESOURCES[f.id], `płyn farmy ${f.id}`);
});

test('sklady: Ziemia nie dostaje tu ról, których nie ma (bez rud — rudy idą do huty)', () => {
  const ores = /_ore$|^ice$|^scrap$/;
  for (const b of L.truckBays) assert.ok(!ores.test(b.goods), `zatoka ${b.id}: ${b.goods}`);
  for (const r of L.railStops) assert.ok(!ores.test(r.goods), `przystanek ${r.id}: ${r.goods}`);
});

test('sklady: połączenie z zewnątrz — nabrzeże tankowców, nabrzeże L terminalu, pas MEGA, doki eksportu', () => {
  const toSpace = (zone) => L.pits.filter((p) => p.zone === zone && p.open > 0);
  assert.ok(toSpace('TQ').length >= 4, 'nabrzeże tankowców');
  assert.ok(toSpace('CL').length >= 2, 'nabrzeże L terminalu');
  assert.ok(toSpace('HQ').length >= 2, 'doki eksportu wysokich składów');
  assert.equal(L.megaLanes.length, 1, 'pas MEGA terminalu');
  // stanowiska od przestrzeni: wylot doku dalej niż rząd zewnętrzny
  for (const p of [...toSpace('TQ'), ...toSpace('CL'), ...toSpace('HQ')]) assert.ok(p.v1 > L.v.outer1, `${p.id} nie wychodzi w przestrzeń`);
  // tankowce przy zbiornikach, megafrachtowiec na pasie MEGA, frachtowce przy terminalu
  for (const b of L.berths) {
    const h = built.hulls(b);
    if (b.role === 'tanker-quay' && h) assert.equal(h, 'tanker', b.id);
    if (b.role === 'mega') assert.equal(h, 'megafreighter', b.id);
    if ((b.role === 'import-quay' || b.role === 'freight-road' || b.role === 'export') && h) assert.ok(['long_haul_freighter', 'container_ship'].includes(h), `${b.id}: ${h}`);
  }
});

test('sklady: punkt nadań gracza — cztery rampy (dwie dostawy, dwa odbiory) przy rzędzie przy ringu, poza dokami', () => {
  const bays = L.truckBays.filter((b) => b.player);
  assert.equal(bays.length, 4);
  assert.equal(bays.filter((b) => b.dir === 'in').length, 2);
  assert.equal(bays.filter((b) => b.dir === 'out').length, 2);
  for (const b of bays) assert.ok(b.side === -1 && b.s > SK.inner.pnA && b.s < SK.inner.pnB, b.id);
  const rig = built.buildings[0].scene.rig.player;
  assert.equal(rig.length, 4, 'lampy stanu ramp');
});

test('sklady: terminal kolei — co najmniej trzy przystanki, dużo zatok ciężarówek', () => {
  assert.ok(L.railStops.length >= 3, `przystanki ${L.railStops.length}`);
  assert.ok(L.truckBays.length >= 16, `zatoki ${L.truckBays.length}`);
  assert.ok(L.truckBays.some((b) => b.dir === 'in') && L.truckBays.some((b) => b.dir === 'out'));
});

test('sklady: basen farmy i plac kontenerowy są bryłami (statek nie wleci między zbiorniki ani stosy)', () => {
  const P = districtProbe(L);
  for (let s = SK.farm.a + 100; s < SK.farm.b; s += 400) for (let v = SK.farm.road1 + 50; v < SK.farm.basin1; v += 400) assert.ok(P.solidAt(s, v), `farma s=${s} v=${v}`);
  for (let s = SK.ct.a + 100; s < SK.ct.b; s += 400) for (let v = SK.ct.road1 + 50; v < SK.ct.yard1; v += 400) assert.ok(P.solidAt(s, v), `plac s=${s} v=${v}`);
});

test('sklady: budowle w budżecie (instancje, grupy ruchome, lampy) i bez NaN', () => {
  assert.ok(built.buildings.length >= 2 && built.buildings.length <= 4);
  for (const def of built.buildings) {
    const sc = def.scene;
    assert.ok(sc.instances > 0 && sc.instances <= 6000, `${def.name}: ${sc.instances} instancji`);
    assert.ok(sc.lamps.length <= PB_MAX_LAMPS, `${def.name}: lampy ${sc.lamps.length}`);
    let gmax = 0;
    for (const set of Object.values(sc.sets)) {
      for (const arr of Object.values(set)) {
        for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `NaN w ${def.name}`);
        for (let i = 12; i < arr.length; i += 20) gmax = Math.max(gmax, arr[i]);
      }
    }
    assert.ok(gmax < PB_MAX_GROUPS, `${def.name}: grupa ${gmax}`);
    for (const p of sc.plates) for (const [x, z] of p.points) assert.ok(Number.isFinite(x) && Number.isFinite(z), `płyta NaN w ${def.name}`);
  }
  const rig = built.buildings[2].scene.rig;
  assert.ok(rig.gantries.length >= 4, 'suwnice bramowe');
  assert.ok(rig.sts.length >= 2, 'suwnice nabrzeżowe');
});

test('sklady: ruch — suwnice, statki zawijające i droga dają skończone pozy, tempo mnoży czas', () => {
  const mats = Array.from({ length: PB_MAX_GROUPS }, () => ({ elements: new Float64Array(16) }));
  const chans = [];
  const mk = (scene) => ({ scene, uniforms: { uGroup: { value: mats } }, _setChan: (ch, v) => { chans.push([ch, v]); } });
  const api = {
    buildings: built.buildings.map((b) => mk(b.scene)),
    occupied: new Set(L.berths.filter((b) => built.hulls(b)).map((b) => b.id)),
    proxies: [],
    proxy(id, hullId, x, z, h, o) { this.proxies.push({ id, hullId, x, z, h, o }); }
  };
  for (let i = 0; i < 400; i++) {
    built.step(0.5, api);
    api.proxies.length = 0;
    chans.length = 0;
    built.frame(api);
    for (const p of api.proxies) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.h), `poza ${p.id}`);
      assert.ok(p.hullId, `kadłub ${p.id}`);
    }
    for (const [ch, v] of chans) assert.ok(ch >= 0 && ch < 16 && v >= 0 && v <= 1, `kanał ${ch} = ${v}`);
    for (const m of mats) for (const e of m.elements) assert.ok(Number.isFinite(e), 'macierz grupy NaN');
  }
  const st = built.stats();
  assert.ok(st.gantries >= 4 && st.calls >= 2);
  for (const v of Object.values(st.levels)) assert.ok(v >= 0 && v <= 1);
});
