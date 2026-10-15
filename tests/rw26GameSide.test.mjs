import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDrawBoxEntities, isEntityInDrawBox } from '../src/render/drawBox.js';
import { Turret2D } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { stepCloakLooks, CLOAK_LOOK_FRAME } from '../src/game/cloakLooks.js';

// RW-26 (docs/PLAN-render-worker.md): rekordy wież, odrzut i krok wyglądu maskowania po stronie gry.

const cull = { x: 0, y: 0, halfW: 30000, halfH: 30000, drawHalfW: 1000, drawHalfH: 1000 };

test('pudło rysowania: martwe, ukryte, hideHexVisual, poza pudłem — odpadają; kolejność listy zostaje', () => {
  const a = { x: 0, y: 0 }, b = { x: 500, y: 0 }, far = { x: 20000, y: 0 }, out3 = { x: 90000, y: 0 };
  const dead = { x: 0, y: 0, dead: true }, hid = { x: 0, y: 0, hideHexVisual: true }, fog = { x: 0, y: 0, fog: true };
  const list = collectDrawBoxEntities([b, dead, a, far, hid, fog, out3, null], cull, 1, (e) => e.fog === true, []);
  assert.deepEqual(list, [b, a]);
  assert.equal(isEntityInDrawBox(far, cull, 1), false);
  assert.deepEqual(collectDrawBoxEntities([far], { x: 0, y: 0, halfW: 30000, halfH: 30000 }, 1, null, []), [far], 'bez drawHalfW — całe pudło');
});

function npc(x, y, id = 'ciws_mk1') {
  return { x, y, angle: 0, autoWeapons: [{ def: MASTER_WEAPONS[id], hpOffset: { x: 10, y: 0 }, visualAngle: 0.3 }] };
}

test('Turret2D.syncFrame = beginFrame + sync encji z pudła + wygaszanie odrzutu (te same rekordy)', () => {
  const A = npc(0, 0), B = npc(400, 0), C = npc(50000, 0);
  try {
    Turret2D.syncFrame([A, B, C], { cull, zoom: 1, hidden: null, poseOf: (e) => (e === B ? { x: 410, y: 5, angle: 0.5 } : null), enabled: true });
    assert.equal(Turret2D.frameCount, 2, 'C poza pudłem — bez rekordu');
    assert.equal(Turret2D.recordsFor(C), null);
    const rb = Turret2D.recordsFor(B)[0];
    assert.ok(Math.abs(rb.wx - (410 + 10 * Math.cos(0.5))) < 1e-6, 'poza z poseOf');
    Turret2D.syncFrame([A], { cull, zoom: 1, enabled: false });
    assert.equal(Turret2D.frameCount, 0, 'przełącznik „Bronie” gasi rekordy');
  } finally {
    Turret2D.enabled = true;
    Turret2D.clear();
  }
});

test('odrzut po stronie gry: shotMuzzle nie rusza stanu, recoilForShot rusza, wiązka ciągła bez odrzutu', () => {
  const A = npc(0, 0);
  try {
    Turret2D.syncFrame([A], { cull, zoom: 1, enabled: true });
    const rec = Turret2D.recordsFor(A)[0];
    const m = rec.spec.m[0];
    const mx = rec.wx + m[0] * rec.scale * Math.cos(rec.ang) - m[1] * rec.scale * Math.sin(rec.ang);
    const my = rec.wy + m[0] * rec.scale * Math.sin(rec.ang) + m[1] * rec.scale * Math.cos(rec.ang);
    const pos = Turret2D.shotMuzzle('ciws', mx, my, A);
    assert.ok(pos && pos.entity === A);
    const px = pos.x, py = pos.y;
    assert.equal(rec.state.barrel, 0, 'shotMuzzle bez odrzutu');
    assert.equal(Turret2D.recoilForShot({ weaponId: 'ciws_mk1', shooter: A, x: mx, y: my, isBeam: true, beam: { kind: 'continuous' } }), null);
    assert.equal(rec.state.barrel, 0, 'wiązka ciągła — bez odrzutu');
    const shot = Turret2D.recoilForShot({ weaponId: 'ciws_mk1', shooter: A, x: mx, y: my, isBeam: false, beam: null });
    assert.ok(shot && Math.abs(shot.x - px) < 1e-9 && Math.abs(shot.y - py) < 1e-9, 'ta sama lufa co efekt wylotu');
    assert.ok(rec.state.barrel > 0 && rec.state.housing > 0, 'odrzut zadany');
  } finally {
    Turret2D.clear();
  }
});

test('stepCloakLooks: wygląd tworzony przy encji z cloak, bez kadłuba — nieaktywny i poza listą; dt z czasu klatki', () => {
  const e = { x: 0, y: 0, cloak: { level: 0, active: false } };
  const plain = { x: 0, y: 0 };
  stepCloakLooks([e, plain], 1000, null, e);
  assert.ok(e.__cloakLook, 'wygląd od razu (pierwsze włączenie to zdarzenie)');
  assert.equal(e.__cloakLook.active, false);
  assert.equal(plain.__cloakLook, undefined);
  assert.equal(CLOAK_LOOK_FRAME.list.length, 0);
  assert.equal(CLOAK_LOOK_FRAME.playerLook, null, 'bez pozy — bez wizjera');
  stepCloakLooks([e], 1016, null, e);
  assert.ok(Math.abs(CLOAK_LOOK_FRAME.dt - 0.016) < 1e-9);
  assert.equal(CLOAK_LOOK_FRAME.time, 1.016);
});
