// Dzielnica ringu „zbrojownia” (Zbrojownia i skład amunicji, dema/ring-dzielnice/zbrojownia) — testy wspólne układu
// i własne: bryły budowli w budżecie, towary z ekonomii, doki uzbrajania mieszczą okręty floty, strzelnica zamknięta,
// stanowiska prób na placu, symulacja (ogień, cykl doków, trasy niszczycieli bez wejścia w bryły).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS, PB_STRIDE } from '../src/3d/portBuildings/portBuildingScene.js';
import { RESOURCES } from '../src/data/resources.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { YARD_PITS, ringScale } from '../dema/ring-dzielnice/kit/uklad.js';
import plugin from '../dema/ring-dzielnice/zbrojownia/index.js';
import { ZB } from '../dema/ring-dzielnice/zbrojownia/uklad.js';
import { districtProbe, rect, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const layout = built.layout;
registerDistrictTests(test, assert, layout);
const P = districtProbe(layout);

test('zbrojownia: budowle bez NaN, w budżecie instancji, grup i lamp', () => {
  assert.ok(built.buildings.length >= 2 && built.buildings.length <= 4);
  for (const def of built.buildings) {
    const sc = def.scene;
    assert.ok(sc.instances > 0 && sc.instances <= 6000, `${def.name}: ${sc.instances} instancji`);
    assert.ok(sc.lamps.length <= PB_MAX_LAMPS, `${def.name}: lampy`);
    let maxGroup = 0;
    for (const set of Object.values(sc.sets)) {
      for (const arr of Object.values(set)) {
        for (const v of arr) assert.ok(Number.isFinite(v), `NaN w ${def.name}`);
        for (let i = 12; i < arr.length; i += PB_STRIDE) maxGroup = Math.max(maxGroup, arr[i]);
      }
    }
    assert.ok(maxGroup < PB_MAX_GROUPS, `${def.name}: grupa ${maxGroup}`);
  }
});

test('zbrojownia: zatoki i przystanki wożą towary z ekonomii; wsad wchodzi, uzbrojenie i amunicja wychodzą', () => {
  const all = [...layout.truckBays, ...layout.railStops];
  for (const p of all) assert.ok(RESOURCES[p.goods], `nieznany towar ${p.goods} (${p.id})`);
  const out = new Set(all.filter((p) => p.dir === 'out').map((p) => p.goods));
  const inn = new Set(all.filter((p) => p.dir === 'in').map((p) => p.goods));
  for (const g of ['gun_ballistic', 'gun_railgun', 'gun_energy', 'gun_plasma', 'launcher_ordnance', 'launcher_torpedo', 'pd_turret', 'flak_turret',
    'ammo_kinetic', 'flak_shell', 'missile_round', 'torpedo_round', 'fighter_craft']) assert.ok(out.has(g), `brak wysyłki ${g}`);
  for (const g of ['steel', 'titan_alloy', 'copper_wire', 'optic_lens', 'chips', 'hull_plate']) assert.ok(inn.has(g), `brak dostawy ${g}`);
});

test('zbrojownia: doki uzbrajania S / M / L mieszczą fregatę, niszczyciel i pancernik; nabrzeże i hangar od strony przestrzeni', () => {
  const arm = layout.pits.filter((p) => p.zone === 'ZU');
  assert.deepEqual(arm.map((p) => p.cls).sort(), ['l', 'l', 'm', 'm', 's', 's']);
  for (const pit of arm) {
    const size = trafficHullRenderSize(ZB.armHull[pit.cls]);
    const wid = YARD_PITS[pit.cls].w;
    const depth = pit.v1 - pit.v0;
    assert.ok(size.h * 0.75 + 60 <= wid, `${pit.id}: kadłub za szeroki`);
    assert.ok(size.length + 60 <= depth, `${pit.id}: kadłub za długi (${size.length} wobec ${depth})`);
    assert.equal(pit.open, -1, `${pit.id} ma być otwarty na drogę`);
  }
  const hangar = layout.pits.find((p) => p.kind === 'hangar');
  assert.ok(hangar && hangar.open > 0, 'hangar myśliwców z wylotem w przestrzeń');
  assert.equal(layout.megaLanes.length, 1, 'nabrzeże amunicyjne (pas MEGA)');
  assert.ok(layout.megaLanes[0].vFace >= ZB.bunkers.v1 - 1);
  assert.equal(built.hulls(layout.megaLanes[0].berth), 'megafreighter');
});

test('zbrojownia: strzelnica zamknięta z każdej strony, w środku bez brył; stanowiska prób stoją na placu', () => {
  const R = ZB.range;
  const A = ZB.armory;
  const armS = R.armW / ringScale((R.v0 + R.v1) / 2);
  for (let v = R.v0 + 30; v < R.v1; v += 100) {
    assert.ok(P.solidAt(A.a + armS / 2, v), `ramię lewe v=${v}`);
    assert.ok(P.solidAt(A.b - armS / 2, v), `ramię prawe v=${v}`);
  }
  for (let s = A.a + 20; s < A.b - 20; s += 60) {
    assert.ok(P.solidAt(s, R.v1 + 100), `kulochwyt s=${s}`);
    assert.ok(P.solidAt(s, R.v0 - 100), `plac (dno strzelnicy od ringu) s=${s}`);
    for (let v = R.v0 + 60; v < R.v1 - 60; v += 400) if (s > A.a + armS + 20 && s < A.b - armS - 20) assert.equal(P.solidAt(s, v), null, `bryła w strzelnicy s=${s} v=${v}`);
  }
  for (const st of ZB.stands) {
    for (const [ds, dv] of [[-220, -300], [220, -300], [-220, 300], [220, 300]]) assert.ok(P.solidAt(st.s + ds / ringScale(ZB.yard.standV), ZB.yard.standV + dv), `stanowisko ${st.label} poza placem`);
  }
});

function fakeApi() {
  const mk = () => ({
    uniforms: { uGroup: { value: Array.from({ length: PB_MAX_GROUPS }, () => ({ elements: new Float64Array(16) })) } },
    chan: new Float64Array(16),
    meshes: {},
    _setChan(i, v) { this.chan[i] = v; }
  });
  const proxies = [];
  return { buildings: [mk(), mk(), mk()], proxies, proxy(id, hullId, x, z, angle, opts) { proxies.push({ id, hullId, x, z, angle, opts }); } };
}

test('zbrojownia: symulacja — wieże strzelają i trafiają, doki ładują, niszczyciele przechodzą trasą bez wejścia w bryły', () => {
  const run = plugin.build({ style: resolvePortBuildingStyle('earth') });
  const api = fakeApi();
  run.init(api);
  const dt = 1 / 30;
  const phases = new Map();
  let muzzleSeen = 0;
  let hitSeen = 0;
  let maxRot = 0;
  for (let i = 0; i < 30 * 240; i++) {
    run.step(dt, api);
    api.proxies.length = 0;
    run.frame(api);
    const R = api.buildings[1];
    if (R.chan[0] > 0) muzzleSeen++;
    if (R.chan[1] > 0) hitSeen++;
    for (let g = 1; g <= 8; g++) maxRot = Math.max(maxRot, Math.abs(R.uniforms.uGroup.value[g].elements[8]));
    for (const p of api.proxies) {
      assert.equal(p.hullId, 'terran_destroyer');
      for (const v of [p.x, p.z, p.angle]) assert.ok(Number.isFinite(v), 'NaN w pozie okrętu');
      if ((p.opts?.opacity ?? 1) < 0.05) continue;
      // kadłub niszczyciela (288 × 204) nie wchodzi w bryły na żadnym etapie trasy (luz 20 j.)
      const id = P.hit(rect(p.x, p.z, p.angle, 288 - 40, 204 - 40));
      assert.equal(id, null, `${p.id} wchodzi w ${id}`);
    }
    for (const d of run.stats().docks) {
      if (!phases.has(d.id)) phases.set(d.id, new Set());
      phases.get(d.id).add(d.phase);
    }
  }
  const st = run.stats();
  assert.ok(st.shots > 20, `za mało strzałów: ${st.shots}`);
  assert.ok(muzzleSeen > 0 && hitSeen > 0, 'błyski u wylotu i trafienia');
  assert.ok(maxRot > 0.05, 'wieże się obracają');
  for (const [id, set] of phases) {
    assert.ok(set.has('load'), `${id} nie ładował`);
    if (id.includes('-M')) for (const ph of ['in', 'back', 'turn', 'out']) assert.ok(set.has(ph), `${id}: brak etapu ${ph}`);
    else assert.ok(set.has('ready'), `${id}: nie skończył ładowania`);
  }
});
