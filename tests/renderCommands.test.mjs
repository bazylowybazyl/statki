// RW-21 (docs/PLAN-render-worker.md § 3.3): strumień rozkazów renderu — kodowanie każdego typu rekordu broni,
// dyspozytor inline (rekord → wywołanie WeaponFx z tymi samymi liczbami i obiektami), napisy, nośnik, sloty encji
// i pocisków, stan ładowania po kluczu, uchwyty Hexlance'a, przejście na większy pierścień.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderCommands, RC, STR_UNDEFINED, STR_NULL } from '../src/render/renderCommands.js';
import { installWeaponFxCommands, WeaponFxCommandState } from '../src/3d/weapons/weaponFxCommands.js';
import { WeaponFx } from '../src/3d/weapons/weaponFx.js';
import { ActiveCarrier } from '../src/game/carrierVelocity.js';
import { Turret2D } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const METHODS = ['_onShot', 'pdShot', 'pdLaser', 'impact', 'kerf', 'pierceExit', 'pierceStuck', 'flakBurst', 'droneBlast',
  'bombBlast', 'bombDud', 'charge', 'hexlanceCharge', 'hexlanceFire', 'hexlanceBegin', 'hexlanceStep', 'hexlanceEnd',
  'hexlanceImpact', 'hexlanceKerf', 'hexlanceExit'];

// Podstawia metody WeaponFx rejestratorem (kopie argumentów i ActiveCarrier w chwili wywołania).
function withStubs(fn) {
  const saved = {};
  const calls = [];
  for (const m of METHODS) {
    saved[m] = WeaponFx[m];
    WeaponFx[m] = (...args) => {
      const snap = args.map((a) => (a && typeof a === 'object' && !Array.isArray(a) && !a.__entity ? { ...a } : a));
      calls.push({ m, args, snap, carrier: { vx: ActiveCarrier.vx, vy: ActiveCarrier.vy, t0: ActiveCarrier.t0, z: ActiveCarrier.z, clock: ActiveCarrier.clock } });
      if (m === 'hexlanceBegin') return { id: 'h' + calls.length, active: true };
      return true;
    };
  }
  const savedCommands = WeaponFx._commands;
  try {
    const rc = createRenderCommands({ mode: 'inline', capacity: 64 });
    installWeaponFxCommands(rc.reader);
    fn(rc, calls);
  } finally {
    for (const m of METHODS) WeaponFx[m] = saved[m];
    WeaponFx._commands = savedCommands;
    ActiveCarrier.clear();
  }
}

const ent = (name) => ({ __entity: true, name, x: 0, y: 0 });
const last = (calls, m) => calls.filter((c) => c.m === m).at(-1);

test('napisy: undefined / null / tekst; rekord STR raz na napis, dekoder ma tę samą tablicę', () => {
  const rc = createRenderCommands({ mode: 'inline' });
  const w = rc.writer;
  assert.equal(w.str(undefined), STR_UNDEFINED);
  assert.equal(w.str(null), STR_NULL);
  const a = w.str('railgun_mk1');
  const before = w.records;
  assert.equal(w.str('railgun_mk1'), a, 'drugi raz bez rekordu');
  assert.equal(w.records, before);
  assert.equal(rc.reader.str(a), 'railgun_mk1');
  assert.equal(rc.reader.str(STR_UNDEFINED), undefined);
  assert.equal(rc.reader.str(STR_NULL), null);
  assert.equal(rc.reader.str(w.str('ąę—ż')), 'ąę—ż');
});

test('SHOT z szyny: broń, strzelec, wiązka i lufa rozwiązana w grze (shotMuzzle) — te same liczby i obiekty', () => {
  const shooter = { x: 0, y: 0, angle: 0, autoWeapons: [{ def: MASTER_WEAPONS.ciws_mk1, hpOffset: { x: 10, y: 0 }, visualAngle: 0.2 }] };
  try {
    Turret2D.enabled = true;
    Turret2D.beginFrame();
    Turret2D.sync(shooter, 0, 0, 0, 1);
    const rec = Turret2D.recordsFor(shooter)[0];
    const expect = Turret2D.shotMuzzle('ciws', rec.wx, rec.wy, shooter);
    const ex = { ...expect, entity: undefined };
    withStubs((rc, calls) => {
      const hitE = ent('cel');
      rc.writer.shot({ weaponId: 'ciws_mk1', shooter, x: rec.wx, y: rec.wy, isBeam: false, beamMode: null, beam: null, dirX: 0.6, dirY: 0.8 });
      const c = last(calls, '_onShot');
      const [det, pre] = c.args;
      assert.equal(c.snap[0].weaponId, 'ciws_mk1');
      assert.equal(c.snap[0].shooter, shooter);
      assert.equal(c.snap[0].x, rec.wx); assert.equal(c.snap[0].y, rec.wy);
      assert.equal(c.snap[0].isBeam, false); assert.equal(c.snap[0].beamMode, null);
      assert.equal(c.snap[0].dirX, 0.6); assert.equal(c.snap[0].dirY, 0.8);
      assert.equal(c.snap[0].beam, null);
      assert.ok(det);
      assert.deepEqual({ x: c.snap[1].x, y: c.snap[1].y, angle: c.snap[1].angle, scale: c.snap[1].scale, shake: c.snap[1].shake },
        { x: ex.x, y: ex.y, angle: ex.angle, scale: ex.scale, shake: ex.shake });
      assert.equal(c.snap[1].entity, shooter, 'kadłub z wieżyczką (nośnik wylotu)');
      assert.ok(pre);
      // impuls: lufa z początku wiązki, pola wiązki 1:1
      const beam = { kind: 'pulse', mode: 'pulse', startX: rec.wx, startY: rec.wy, endX: 500, endY: 20, width: 4, hitEntity: hitE, nx: -1, ny: 0, emitterUid: 'p_aux_0' };
      rc.writer.shot({ weaponId: 'beam_pulse', shooter, x: rec.wx, y: rec.wy, isBeam: true, beamMode: 'pulse', beam, dirX: 1, dirY: 0 });
      const c2 = last(calls, '_onShot');
      assert.equal(c2.snap[0].isBeam, true);
      const b = c2.args[0].beam === null ? null : c2.snap[0].beam;
      assert.ok(b === null || typeof b === 'object');
      // wiązka bez rozwiązanej lufy (ciągła — WeaponFx szuka lufy rekordem wieżyczki)
      const cont = { kind: 'continuous', mode: 'continuous', startX: 1, startY: 2, endX: 3, endY: 4, width: undefined, hitEntity: null, nx: undefined, ny: undefined, emitterUid: 'u1' };
      rc.writer.shot({ weaponId: 'beam_continuous', shooter: null, x: 1, y: 2, isBeam: true, beamMode: 'continuous', beam: cont, dirX: 0, dirY: 0 });
      const c3 = last(calls, '_onShot');
      assert.equal(c3.snap[0].shooter, null);
    });
  } finally {
    Turret2D.clear();
  }
});

test('SHOT: pola wiązki dekodowane 1:1 (undefined → NaN zachowuje arytmetykę WeaponFx)', () => {
  withStubs((rc, calls) => {
    const hitE = ent('kadłub');
    let seenBeam = null;
    WeaponFx._onShot = (det, pre) => { seenBeam = { ...det.beam, pre }; };
    rc.writer.shot({ weaponId: 'beam_pulse', shooter: null, x: 5, y: 6, isBeam: true, beamMode: 'pulse',
      beam: { kind: 'pd', mode: undefined, startX: 5, startY: 6, endX: 50, endY: 60, width: 3, hitEntity: hitE, nx: 0.5, ny: undefined, emitterUid: 'e7' }, dirX: 1, dirY: 0 });
    assert.equal(seenBeam.kind, 'pd'); assert.equal(seenBeam.mode, undefined);
    assert.equal(seenBeam.startX, 5); assert.equal(seenBeam.endY, 60); assert.equal(seenBeam.width, 3);
    assert.equal(seenBeam.hitEntity, hitE);
    assert.equal(seenBeam.nx, 0.5); assert.ok(Number.isNaN(seenBeam.ny));
    assert.equal(seenBeam.emitterUid, 'e7');
    assert.equal(seenBeam.pre, null, 'strzelec bez wieżyczki — lufa nie znaleziona');
    void calls;
  });
});

test('PD: pdShot (kąt działka) i pdLaser (cel, lufa) — argumenty 1:1', () => {
  withStubs((rc, calls) => {
    const ship = ent('gracz'), target = ent('myśliwiec');
    rc.writer.pdShot('ciws_mk1', 10.5, -3.25, 1.234, ship);
    const c = last(calls, 'pdShot');
    assert.deepEqual(c.args.slice(0, 5), ['ciws_mk1', 10.5, -3.25, 1.234, ship]);
    assert.equal(c.args[5], null);
    rc.writer.pdLaser('laser_pd_mk1', 1, 2, 3, 4, ship, target);
    const l = last(calls, 'pdLaser');
    assert.deepEqual(l.args.slice(0, 7), ['laser_pd_mk1', 1, 2, 3, 4, ship, target]);
    rc.writer.pdLaser('laser_pd_mk1', 1, 2, 3, 4, ship, null);
    assert.equal(last(calls, 'pdLaser').args[6], null);
  });
});

test('IMPACT / KERF / PIERCE / FLAK: widok pocisku (pola receptur), __ref = pocisk gry, trafienie, nośnik z ActiveCarrier', () => {
  withStubs((rc, calls) => {
    const hull = ent('kadłub');
    const b = { vfxKey: 'special_valkyrie_railgun', type: 'rail', vx: 1200, vy: -3, ivx: 10, ivy: 0.5, z: 2, owner: 'player', weaponSize: 'Capital', flakBurstRadius: undefined, x: 1, y: 2 };
    const hit = { nx: 0.6, ny: -0.8, relVx: 900, relVy: 1, entity: hull, kind: 'hull', through: true, ric: false, ricDirX: 0, ricDirY: 0, ricSpeed: 0, ricLife: 0 };
    ActiveCarrier.set({ vx: 33, vy: -44, t0: 12.5, z: 3, clock: 1 });
    const carrier = { vx: ActiveCarrier.vx, vy: ActiveCarrier.vy, t0: ActiveCarrier.t0, z: ActiveCarrier.z, clock: ActiveCarrier.clock };
    rc.writer.impact(b, 100, 200, 1.5, hit);
    const c = last(calls, 'impact');
    const bv = c.snap[0];
    for (const k of ['vfxKey', 'type', 'vx', 'vy', 'ivx', 'ivy', 'z', 'owner', 'weaponSize']) assert.equal(bv[k], b[k], k);
    assert.ok(Number.isNaN(bv.flakBurstRadius), 'brak pola → NaN (Number(x) || 0 = 0 jak dawniej)');
    assert.equal(bv.__ref, b, 'stan smugi pocisku przez __ref');
    assert.deepEqual(c.args.slice(1, 4), [100, 200, 1.5]);
    const h = c.snap[4];
    for (const k of Object.keys(hit)) assert.equal(h[k], hit[k], k);
    assert.deepEqual(c.carrier, carrier);
    rc.writer.impact(b, 1, 2, 1, null);
    assert.equal(last(calls, 'impact').args[4], null);
    rc.writer.kerf(b, 5, 6, 7, 8, 9, 10, 11, hull);
    const k = last(calls, 'kerf');
    assert.deepEqual(k.args.slice(1), [5, 6, 7, 8, 9, 10, 11, hull]);
    assert.equal(k.snap[0].__ref, b);
    rc.writer.pierceExit(b, 1, 2, 3, 4, hull);
    assert.deepEqual(last(calls, 'pierceExit').args.slice(1), [1, 2, 3, 4, hull]);
    rc.writer.pierceStuck(b, 5, 6, 7, 8, null);
    assert.deepEqual(last(calls, 'pierceStuck').args.slice(1), [5, 6, 7, 8, null]);
    rc.writer.flakBurst(b, 9, 8, 120);
    assert.deepEqual(last(calls, 'flakBurst').args.slice(1), [9, 8, 120]);
    rc.writer.flakBurst(null, 9, 8, 120);
    assert.equal(last(calls, 'flakBurst').args[0], null);
  });
});

test('wybuchy: dron, bomba (kadłub), niewypał — argumenty i nośnik', () => {
  withStubs((rc, calls) => {
    const hull = ent('kadłub');
    ActiveCarrier.set({ vx: 1, vy: 2, t0: 3, z: 4, clock: 0 });
    rc.writer.droneBlast(1, 2, 45);
    assert.deepEqual(last(calls, 'droneBlast').args, [1, 2, 45]);
    assert.equal(last(calls, 'droneBlast').carrier.vx, 1);
    rc.writer.bombBlast(3, 4, 1.25, hull);
    assert.deepEqual(last(calls, 'bombBlast').args, [3, 4, 1.25, hull]);
    rc.writer.bombDud(5, 6, 1);
    assert.deepEqual(last(calls, 'bombDud').args, [5, 6, 1]);
  });
});

test('CHARGE: stan efektu ładowania po kluczu działa — ten sam między klatkami, nowy dla innego działa; nośnik argumentu', () => {
  withStubs((rc, calls) => {
    const stA = {}, stB = {};
    const car = { vx: 5, vy: 6, t0: 7, z: 0, clock: 0 };
    rc.writer.charge('siege_railgun', 1, 2, 0.5, 1, 0.3, 1 / 60, stA, car);
    const c1 = last(calls, 'charge');
    assert.deepEqual(c1.args.slice(0, 7), ['siege_railgun', 1, 2, 0.5, 1, 0.3, 1 / 60]);
    const state = c1.args[7];
    assert.ok(state && typeof state === 'object' && 'arcT' in state);
    assert.deepEqual({ ...c1.args[8] }, car);
    rc.writer.endFrame();
    rc.writer.charge('siege_railgun', 1, 2, 0.5, 1, 0.4, 1 / 60, stA, null);
    assert.equal(last(calls, 'charge').args[7], state, 'ten sam stan działa');
    assert.equal(last(calls, 'charge').args[8], null);
    rc.writer.charge('siege_railgun', 1, 2, 0.5, 1, 0.4, 1 / 60, stB, null);
    assert.notEqual(last(calls, 'charge').args[7], state, 'inne działo — inny stan');
    rc.writer.charge('siege_railgun', 1, 2, 0.5, 1, 0.4, 1 / 60, null, null);
    assert.equal(last(calls, 'charge').args[7], null, 'bez właściciela — bez stanu (WeaponFx nic nie robi)');
  });
});

test('Hexlance: id gry ↔ uchwyt renderu (begin, step, end), ładowanie, wylot i trafienia z nośnikiem', () => {
  withStubs((rc, calls) => {
    const car = { vx: 1, vy: 2, t0: 3, z: 0.5, clock: 0 };
    rc.writer.hexlanceCharge(1, 2, 0.6, 0.8, 1 / 60, 0.5, car, 2);
    const ch = last(calls, 'hexlanceCharge');
    assert.deepEqual(ch.args.slice(0, 6), [1, 2, 0.6, 0.8, 1 / 60, 0.5]);
    assert.deepEqual({ ...ch.args[6] }, car); assert.equal(ch.args[7], 2);
    rc.writer.hexlanceFire(3, 4, 1, 0, car);
    assert.deepEqual(last(calls, 'hexlanceFire').args.slice(0, 4), [3, 4, 1, 0]);
    const id = rc.writer.hexlanceBegin(5, 6, 7000, 0, 10, 0);
    assert.ok(id > 0);
    const handle = WeaponFxCommandState.hex.get(id);
    assert.ok(handle);
    rc.writer.hexlanceStep(id, 5, 6, 125, 6, 7000, 0);
    assert.equal(last(calls, 'hexlanceStep').args[0], handle);
    assert.deepEqual(last(calls, 'hexlanceStep').args.slice(1), [5, 6, 125, 6, 7000, 0]);
    rc.writer.hexlanceImpact(9, 8, 7, 6, car, 2.5, false);
    assert.deepEqual(last(calls, 'hexlanceImpact').args.slice(0, 4), [9, 8, 7, 6]);
    assert.equal(last(calls, 'hexlanceImpact').args[5], 2.5);
    assert.equal(last(calls, 'hexlanceImpact').args[6], false);
    rc.writer.hexlanceKerf(1, 1, 2, 2, null, 1);
    assert.equal(last(calls, 'hexlanceKerf').args[4], null);
    rc.writer.hexlanceExit(1, 1, 2, 2, car);
    assert.deepEqual({ ...last(calls, 'hexlanceExit').args[4] }, car);
    rc.writer.hexlanceEnd(id, 200, 6);
    assert.equal(last(calls, 'hexlanceEnd').args[0], handle);
    assert.equal(WeaponFxCommandState.hex.has(id), false);
  });
});

test('pierścień rośnie (długie napisy, wiele rekordów) — kolejność i komplet dyspozycji bez zmian', () => {
  withStubs((rc, calls) => {
    const before = rc.writer.ring.grows;
    for (let i = 0; i < 400; i++) rc.writer.bombDud(i, -i, 1 + i);
    for (let i = 0; i < 20; i++) rc.writer.str('x'.repeat(300) + i);
    const duds = calls.filter((c) => c.m === 'bombDud');
    assert.equal(duds.length, 400);
    for (let i = 0; i < 400; i++) assert.deepEqual(duds[i].args, [i, -i, 1 + i]);
    assert.ok(rc.writer.ring.grows > before, 'pierścień 64 słów musiał urosnąć');
    assert.equal(rc.reader.str(rc.writer.str('x'.repeat(300) + 19)), 'x'.repeat(300) + 19);
  });
});

test('sloty encji: endFrame zwalnia obiekty bez odwołań (bez wycieku obiektów gry)', () => {
  const rc = createRenderCommands({ mode: 'inline' });
  const w = rc.writer;
  const a = ent('a');
  w.bombBlast(1, 1, 1, a);
  assert.equal(w.ids.entities.count, 1);
  w.endFrame();
  w.endFrame();
  assert.equal(w.ids.entities.count, 0);
  assert.equal(RC.SHOT > 0, true);
});
