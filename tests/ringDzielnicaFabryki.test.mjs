// Dzielnica ringu „fabryki” (fabryki podzespołów przy stoczni, dema/ring-dzielnice/fabryki) — testy wspólne układu
// i własne: sceny bez NaN i w budżecie, place odkładcze i stanowiska prób poza drogą, płomienie hamowni
// w przestrzeni i pod autostradą, towary w deklaracjach z ekonomii, ruch (suwnice, próby, wizyta w doku).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { RESOURCES } from '../src/data/resources.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS } from '../src/3d/portBuildings/portBuildingScene.js';
import plugin, { standState, visitPose } from '../dema/ring-dzielnice/fabryki/index.js';
import { RING_V, pointInConvex, yardPoint, yardToArc } from '../dema/ring-dzielnice/kit/uklad.js';
import { districtProbe, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const L = built.layout;
registerDistrictTests(test, assert, L);
const P = districtProbe(L);
const inSolid = (x, z) => L.solids.some((s) => s.zone !== 'RING' && pointInConvex(s.points, x, z));

test('fabryki: sceny budują się bez NaN, w budżecie instancji, grup, kanałów i lamp', () => {
  assert.ok(built.buildings.length >= 2 && built.buildings.length <= 4, 'dzielnica w 2–4 budowlach');
  for (const def of built.buildings) {
    const sc = def.scene;
    assert.ok(sc.instances > 0 && sc.instances <= 6000, `${def.name}: ${sc.instances} instancji`);
    for (const set of Object.values(sc.sets)) for (const arr of Object.values(set)) for (const v of arr) assert.ok(Number.isFinite(v), `NaN w ${def.name}`);
    for (const p of sc.plates) for (const [x, z] of p.points) assert.ok(Number.isFinite(x) && Number.isFinite(z), `NaN w płycie ${def.name}`);
    assert.ok(sc.rig.groups < PB_MAX_GROUPS, `${def.name}: ${sc.rig.groups} grup`);
    assert.ok(sc.lamps.length <= PB_MAX_LAMPS, `${def.name}: lampy`);
    const chans = new Set([...sc.rig.status.map((s) => s.ch), ...Object.values(sc.rig.chans)]);
    assert.ok(chans.size <= 16 && [...chans].every((c) => c >= 0 && c < 16), `${def.name}: kanały`);
    assert.equal(chans.size, sc.rig.status.length + Object.keys(sc.rig.chans).length, `${def.name}: kanały się powtarzają`);
  }
});

test('fabryki: długość 12–16 tys. j. łuku i cztery zakłady jeden przy drugim', () => {
  const len = L.sMax - L.sMin;
  assert.ok(len >= 12000 && len <= 16000, `długość ${len}`);
  for (let i = 0; i + 1 < L.plants.length; i++) assert.equal(L.plants[i].b, L.plants[i + 1].a, 'zakłady bez przerw');
  assert.equal(L.plants[0].a, L.sMin);
  assert.equal(L.plants.at(-1).b, L.sMax);
});

test('fabryki: towary zatok, przystanków i placów to id z ekonomii', () => {
  for (const d of [...L.truckBays, ...L.railStops]) assert.ok(RESOURCES[d.goods], `nieznany towar ${d.goods} (${d.id})`);
  for (const y of L.yards) for (const sl of y.slots) assert.ok(RESOURCES[sl.kind], `nieznany towar ${sl.kind} na placu ${y.id}`);
  for (const S of L.stands) assert.ok(RESOURCES[S.goods], `stanowisko ${S.id}: ${S.goods}`);
  const out = new Set(L.truckBays.filter((b) => b.dir === 'out').map((b) => b.goods).concat(L.railStops.filter((r) => r.dir === 'out').map((r) => r.goods)));
  for (const g of ['hull_plate', 'weapon_mount', 'thruster', 'avionics', 'reactor_core', 'shield_generator', 'life_support']) assert.ok(out.has(g), `brak odbioru ${g}`);
});

test('fabryki: place odkładcze, miejsca towarów i tory suwnic leżą na bryłach, poza drogą', () => {
  for (const y of L.yards) {
    const pts = [];
    const at = y.kind === 'pier' ? y.frame.at : (a, c) => yardPoint(y.sc + a / ((L.R0 + y.vc) / L.R0), y.vc + c);
    for (const sl of y.slots) pts.push([at(sl.a, sl.c), `towar ${sl.kind} (${y.id})`]);
    for (const a of [y.a0 - 140, (y.a0 + y.a1) / 2, y.kind === 'pier' ? 3720 : y.a1 + 140]) for (const c of [-y.span / 2 - 40, y.span / 2 + 40]) pts.push([at(a, c), `tor suwnicy ${y.id} a=${Math.round(a)}`]);
    for (const [[x, z], what] of pts) {
      assert.ok(inSolid(x, z), `${what} poza bryłą`);
      const o = yardToArc(x, z, {});
      assert.ok(o.v > RING_V.outer0 + 100, `${what} na drodze (v=${Math.round(o.v)})`);
    }
  }
});

test('fabryki: stanowiska prób na licu mola, płomienie w wolnej przestrzeni i pod autostradą', () => {
  for (const S of L.stands) {
    const o = yardToArc(S.nozzle[0], S.nozzle[1], {});
    assert.ok(Math.abs(o.v - L.pier.v1) < 2, `${S.id}: dysza nie w licu mola (v=${o.v})`);
    const t = yardToArc(S.tip[0], S.tip[1], {});
    assert.ok(t.v < 14000 - 100, `${S.id}: płomień sięga autostrady (v=${Math.round(t.v)})`);
    for (let k = 1; k <= 10; k++) {
      const x = S.nozzle[0] + ((S.tip[0] - S.nozzle[0]) * k) / 10;
      const z = S.nozzle[1] + ((S.tip[1] - S.nozzle[1]) * k) / 10;
      assert.equal(P.hit([{ x: x - 5, z: z - 5 }, { x: x + 5, z: z - 5 }, { x: x + 5, z: z + 5 }, { x: x - 5, z: z + 5 }]), null, `${S.id}: płomień przez bryłę`);
    }
    // pas MEGA importu nie leży na drodze płomienia
    const mb = L.mega.berth;
    assert.ok(Math.hypot(mb.x - S.tip[0], mb.z - S.tip[1]) > 2500, `${S.id}: płomień przy pasie MEGA`);
  }
});

test('fabryki: próby na stanowiskach mają pracę i przerwę, ciąg w 0…1', () => {
  for (const S of L.stands) {
    let work = 0;
    let rest = 0;
    let maxT = 0;
    for (let t = 0; t < 200; t += 0.25) {
      const st = standState(S, t);
      assert.ok(st.throttle >= 0 && st.throttle <= 1, `${S.id}: ciąg ${st.throttle}`);
      if (st.work) work++; else rest++;
      maxT = Math.max(maxT, st.throttle);
    }
    assert.ok(work > 0 && rest > 0, `${S.id}: brak pracy albo przerwy`);
    assert.ok(maxT > 0.9, `${S.id}: brak pełnego ciągu`);
  }
});

test('fabryki: statek dostaw wpływa do doku zakładu napędów i wraca na drogę bez dotknięcia brył', () => {
  const berth = L.berths.find((b) => b.id === L.visitBerth);
  assert.ok(berth && berth.cls === 'l', 'dok wizyty');
  assert.equal(built.hulls(berth), null, 'dok wizyty bez stałego statku');
  const o = {};
  let stay = false;
  for (let t = 0; t < 152; t += 0.5) {
    visitPose(berth, t, o);
    if (o.phase === 'stay') stay = true;
    if (o.opacity < 0.05) continue;
    const [x, z] = yardPoint(o.s, o.v);
    // kadłub frachtowca dalekiego zasięgu ~ klasa L (660 × 400) — prostokąt bez luzu
    const c = Math.cos(o.heading);
    const s = Math.sin(o.heading);
    const shape = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: x + a * 320 * c - b * 190 * s, z: z + a * 320 * s + b * 190 * c }));
    assert.equal(P.hit(shape), null, `t=${t} faza ${o.phase}: statek w bryle`);
  }
  assert.ok(stay, 'statek stoi w doku');
});

test('fabryki: suwnice jeżdżą i przewożą ładunek', () => {
  const api = { THREE: null };
  // init bez gospodarza: tylko symulacja (bez macierzy)
  const fakeThree = { Matrix4: class {}, Vector3: class { set() { return this; } } };
  built.init({ ...api, THREE: fakeThree });
  for (let i = 0; i < 2400; i++) built.step(0.1);
  const st = built.stats();
  assert.ok(st.gantries >= 4, 'co najmniej cztery suwnice');
  assert.ok(st.gantryMoves >= st.gantries * 2, `suwnice wykonały ${st.gantryMoves} przewozów`);
  assert.ok(st.tests > 0, 'hamownia zrobiła próby');
});

test('fabryki: widoki (3–6) mają nazwy i poprawne kadry', () => {
  assert.ok(built.views.length >= 3 && built.views.length <= 6);
  for (const v of built.views) {
    assert.ok(v.name && v.caption, 'nazwa i podpis');
    if (v.frame) for (const p of v.frame) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${v.name}: kadr`);
    else assert.ok(Number.isFinite(v.at[0]) && Number.isFinite(v.at[1]) && v.zoom > 0, `${v.name}: punkt`);
  }
});
