import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Turret2D, normalizeWeaponFxKey } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const source = readFileSync(new URL('../src/vfx/turret2D.js', import.meta.url), 'utf8');

// Sylwetka jest wybierana tym samym łańcuchem co dawny createWeapon3DMesh, więc
// KAŻDA broń montowalna na hardpoincie musi trafić na jakiś kształt — inaczej
// wieżyczka po prostu zniknie z kadłuba i nikt tego nie zauważy do bitwy.
test('every mountable weapon resolves to a turret silhouette with muzzles', () => {
  const skipped = new Set(['hangar', 'builtin']);
  let checked = 0;

  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (skipped.has(String(def.mountType || '').toLowerCase())) continue;
    const spec = Turret2D.resolveSpec(id, def.category);
    assert.ok(spec, `${id}: brak sylwetki`);
    assert.ok(Array.isArray(spec.m) && spec.m.length > 0, `${id}: brak punktów wylotowych`);
    assert.ok(Number.isFinite(spec.r) && spec.r > 0, `${id}: brak promienia LOD`);
    assert.ok(Array.isArray(spec.g) && spec.g.length > 0, `${id}: pusta sylwetka`);
    for (const group of spec.g) {
      assert.ok(typeof group.c === 'string' && group.c.startsWith('#'), `${id}: zła barwa grupy`);
      assert.ok(Array.isArray(group.p) && group.p.length > 0, `${id}: pusta grupa części`);
    }
    checked++;
  }

  assert.ok(checked > 20, `spodziewano się kilkudziesięciu broni, sprawdzono ${checked}`);
});

// Punkty wylotowe muszą leżeć PRZED obrysem (dodatni X), inaczej błysk 3D
// wychodzi ze środka wieżyczki albo zza niej.
test('muzzle points sit ahead of the turret body', () => {
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    const mountType = String(def.mountType || '').toLowerCase();
    if (mountType === 'hangar' || mountType === 'builtin') continue;
    const spec = Turret2D.resolveSpec(id, def.category);
    for (const [mx] of spec.m) {
      assert.ok(mx > 0, `${id}: punkt wylotowy nie jest z przodu (x=${mx})`);
      assert.ok(mx <= spec.r, `${id}: punkt wylotowy poza promieniem LOD (x=${mx}, r=${spec.r})`);
    }
  }
});

test('weapon fx keys match the ones weapon3DSystem asks for', () => {
  assert.equal(normalizeWeaponFxKey('railgun_mk1'), 'tempest');
  assert.equal(normalizeWeaponFxKey('flak_capital'), 'flak');
  assert.equal(normalizeWeaponFxKey('special_yamato_cannon'), 'yamato');
  assert.equal(normalizeWeaponFxKey('siege_railgun'), 'siegeRail');
  assert.equal(normalizeWeaponFxKey(''), '');
});

// Bufor rekordów jest pulowany — w bitwie idzie ich kilkaset na klatkę i nie
// wolno alokować per wieżyczkę.
test('frame buffer is pooled, not reallocated', () => {
  assert.match(source, /frameRecords\[frameCount\]/);
  assert.doesNotMatch(source, /frameRecords\.push\(/);
});

// Ścieżki muszą powstawać raz na sylwetkę, nie co klatkę — to jest cały powód,
// dla którego 2D ma być tańsze od siatek.
test('Path2D geometry is compiled once per silhouette', () => {
  assert.match(source, /if \(spec\.__layers\) return spec\.__layers;/);
  const drawBody = source.slice(source.indexOf('  draw(ctx, cam) {'));
  assert.doesNotMatch(drawBody.slice(0, drawBody.indexOf('\n  },')), /new Path2D\(/);
});

test('turret drawing is skipped while the CIC overlay is up', () => {
  assert.match(source, /window\.CICDisplay\?\.active/);
});

// Regresja: strzał myśliwca (bez wieżyczek) szukał najbliższej wieżyczki tego
// samego typu na DOWOLNYM okręcie, bez limitu odległości — dogfight daleko od
// kamery zapalał błyski i odrzut na CIWS-ach Atlasa i trząsł kamerą.
test('a shot is attributed only to the turrets of the ship that fired it', () => {
  const ciws = MASTER_WEAPONS.ciws_mk1;
  const shipA = { autoWeapons: [{ def: ciws, hpOffset: { x: 10, y: 0 } }] };
  const shipB = { autoWeapons: [{ def: ciws, hpOffset: { x: 10, y: 0 } }] };
  const fighter = { fighter: true, type: 'fighter' };

  try {
    Turret2D.enabled = true;
    Turret2D.beginFrame();
    Turret2D.sync(shipA, 0, 0, 0, 1);
    Turret2D.sync(shipB, 5000, 0, 0, 1);

    assert.equal(Turret2D.triggerShot('ciws', 5005, 0, fighter), null,
      'myśliwiec nie ma wieżyczek — żaden cudzy CIWS nie może dostać jego strzału');
    assert.equal(Turret2D.findTurretKey(5005, 0, 'ciws', fighter), null);

    // Strzał A oddany tuż przy B i tak należy do A.
    const shotA = Turret2D.triggerShot('ciws', 5005, 0, shipA);
    assert.ok(shotA && Math.hypot(shotA.x, shotA.y) < 200, 'błysk musi wyjść z lufy strzelca');
    const keyA = Turret2D.findTurretKey(5005, 0, 'ciws', shipA);
    const muzzleA = Turret2D.resolveMuzzle(keyA);
    assert.ok(muzzleA && Math.hypot(muzzleA.x, muzzleA.y) < 200);

    // Bez strzelca: tylko wieżyczka przy punkcie strzału, nie „najbliższa na mapie”.
    assert.equal(Turret2D.triggerShot('ciws', 20000, 0), null, 'daleki strzał bez strzelca nie trafia w nic');
    const nearB = Turret2D.triggerShot('ciws', 5010, 0);
    assert.ok(nearB && Math.abs(nearB.x - 5000) < 200, 'strzał przy lufie B nadal znajduje B');
  } finally {
    Turret2D.clear();
  }
});
