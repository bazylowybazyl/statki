import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WeaponShotBus, on, off, emit, listenerCount } from '../src/game/weaponShotBus.js';
import { SHOT_AUDIO_LIMITS, createVoiceLimiter, shotDistanceGain } from '../src/game/audioVoiceLimiter.js';
import { Turret2D } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { readIndexHtml, sliceFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Szyna strzałów

test('emit nie tworzy nowego detail: ten sam obiekt, nadpisane pola', () => {
  const seen = [];
  const fn = (d) => seen.push({ ref: d, id: d.weaponId, x: d.x, shooter: d.shooter, beam: d.beam });
  on(fn);
  try {
    const shooter = { id: 1 };
    const beam = { endX: 5 };
    emit('railgun_mk2', shooter, 10, 20, false, null, null);
    emit('beam_pulse', shooter, 30, 40, true, 'pulse', beam);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].ref, seen[1].ref, 'każdy strzał dostaje ten sam obiekt detail');
    assert.deepEqual([seen[0].id, seen[0].x], ['railgun_mk2', 10]);
    assert.deepEqual([seen[1].id, seen[1].x, seen[1].beam], ['beam_pulse', 30, beam]);
    assert.equal(seen[0].shooter, shooter);
    // Po emisji detail nie trzyma strzelca ani wiązki (nic nie przecieka między strzałami).
    assert.equal(seen[1].ref.shooter, null);
    assert.equal(seen[1].ref.beam, null);
  } finally {
    off(fn);
  }
});

test('słuchacze w kolejności rejestracji; off działa, także w trakcie emisji', () => {
  const order = [];
  const a = () => order.push('a');
  const b = () => { order.push('b'); off(b); };
  const c = () => order.push('c');
  on(a); on(b); on(c);
  on(a); // podwójna rejestracja ignorowana
  try {
    const before = listenerCount();
    emit('x', null, 0, 0);
    assert.deepEqual(order, ['a', 'b', 'c'], 'wypisanie się w trakcie nie gubi reszty');
    assert.equal(listenerCount(), before - 1);
    order.length = 0;
    emit('x', null, 0, 0);
    assert.deepEqual(order, ['a', 'c']);
    assert.equal(off(b), false);
  } finally {
    off(a); off(c);
  }
});

test('strzał z wnętrza słuchacza nie psuje detail strzału zewnętrznego', () => {
  const seen = [];
  const outer = (d) => {
    if (d.weaponId === 'outer') emit('inner', null, 2, 2);
    seen.push([d.weaponId, d.x]);
  };
  on(outer);
  try {
    emit('outer', null, 1, 1);
    assert.deepEqual(seen, [['inner', 2], ['outer', 1]]);
  } finally {
    off(outer);
  }
  assert.equal(WeaponShotBus.emit('pusto', null, 0, 0), null, 'bez słuchaczy nic się nie dzieje');
});

test('fireWeaponCore nadaje szyną, CustomEvent zostaje tylko dla superbroni', () => {
  const fire = sliceFunction(html, 'window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {');
  assert.match(fire, /WeaponShotBus\.emit\(\s*weapon\.id,\s*shooter,/);
  assert.doesNotMatch(html, /new CustomEvent\('game_weapon_fired'/, 'rdzeń broni nie tworzy zdarzeń DOM per strzał');
  assert.match(read('../src/game/superweapon.js'), /new CustomEvent\('game_weapon_fired'/);
  // Słuchacze obu źródeł.
  assert.match(html, /WeaponShotBus\.on\(onWeaponShotAudio\);/);
  assert.match(html, /window\.addEventListener\('game_weapon_fired', \(e\) => onWeaponShotAudio\(e\.detail\)\);/);
  const w3d = read('../src/3d/weapon3DSystem.js');
  assert.match(w3d, /WeaponShotBus\.on\(this\._shotBusListener\)/);
  assert.match(w3d, /window\.addEventListener\('game_weapon_fired', this\._shotListener\)/);
  assert.match(w3d, /WeaponShotBus\.off\(this\._shotBusListener\)/);
});

// ---------------------------------------------------------------------------
// Limit głosów audio (bez AudioContext)

test('tłumienie odległością: pełna do 2000 u, zero od 12000 u', () => {
  assert.equal(SHOT_AUDIO_LIMITS.fullVolumeDist, 2000);
  assert.equal(SHOT_AUDIO_LIMITS.silentDist, 12000);
  assert.equal(shotDistanceGain(0), 1);
  assert.equal(shotDistanceGain(2000), 1);
  assert.ok(Math.abs(shotDistanceGain(7000) - 0.5) < 1e-9);
  assert.equal(shotDistanceGain(12000), 0);
  assert.equal(shotDistanceGain(50000), 0);
  assert.equal(shotDistanceGain(NaN), 1, 'brak pozycji = pełny głos');
});

test('najwyżej 12 równoczesnych głosów na dźwięk i 40 ms między startami', () => {
  const lim = createVoiceLimiter();
  let played = 0;
  for (let t = 0; t < 2000; t += 10) {
    if (lim.admit('sfx_railgun', t, 0.5, 0, 1500) > 0) played++;
  }
  // Co 40 ms, ale najwyżej 12 naraz przez 1,5 s życia głosu.
  assert.equal(lim.activeVoices('sfx_railgun', 1999), 12);
  assert.ok(played <= 12 + Math.ceil(500 / 40) + 1, `za dużo głosów: ${played}`);
  assert.equal(lim.admit('sfx_railgun', 2000, 0.5, 0, 1500), 0, 'pełny limit');
  assert.ok(lim.admit('sfx_hexlance', 2000, 0.5, 0, 1500) > 0, 'limit jest per dźwięk');
  // Głosy wygasają po czasie trwania.
  assert.equal(lim.activeVoices('sfx_railgun', 10000), 0);
  assert.ok(lim.admit('sfx_railgun', 10000, 0.5, 0, 1500) > 0);
});

test('za cicho (daleko albo mała głośność) = brak głosu i brak zajętego slotu', () => {
  const lim = createVoiceLimiter();
  assert.equal(lim.admit('sfx_railgun', 0, 0.05, 11990, 500), 0, '0,05 × ~0,001 < 0,01');
  assert.equal(lim.activeVoices('sfx_railgun', 1), 0);
  const v = lim.admit('sfx_railgun', 100, 0.05, 1000, 500);
  assert.ok(Math.abs(v - 0.05) < 1e-12);
});

test('playDynamicSound pyta limiter przed utworzeniem BufferSource', () => {
  const play = sliceFunction(html, 'function playDynamicSound(soundKey, x, y, pitchVar = 0, volume = 1.0) {');
  const admitAt = play.indexOf('shotVoiceLimiter.admit(');
  const sourceAt = play.indexOf('ctx.createBufferSource()');
  assert.ok(admitAt > 0 && sourceAt > admitAt, 'limit i odległość przed alokacją węzłów audio');
  assert.match(play, /Math\.hypot\(x - camera\.x, y - camera\.y\)/);
});

// ---------------------------------------------------------------------------
// Turret2D: indeks rekordów per encja

test('strzał ze strzelcem przegląda tylko jego wieżyczki (indeks per encja)', () => {
  const ciws = MASTER_WEAPONS.ciws_mk1;
  const owner = { autoWeapons: [{ def: ciws, hpOffset: { x: 10, y: 0 } }] };
  const crowd = [];
  for (let i = 0; i < 300; i++) crowd.push({ autoWeapons: [{ def: ciws, hpOffset: { x: 10, y: 0 } }] });
  try {
    Turret2D.enabled = true;
    Turret2D.beginFrame();
    for (let i = 0; i < crowd.length; i++) Turret2D.sync(crowd[i], 3000 + i * 5, 0, 0, 1);
    Turret2D.sync(owner, 0, 0, 0, 1);
    const shot = Turret2D.triggerShot('ciws', 3001, 0, owner);
    assert.ok(shot && Math.hypot(shot.x, shot.y) < 200, 'błysk z lufy strzelca, nie z tłumu obok punktu');
    const again = Turret2D.triggerShot('ciws', 0, 0, owner);
    assert.equal(again, shot, 'wynik to wspólny obiekt, bez alokacji per strzał');
    assert.ok(Turret2D.findTurretKey(3001, 0, 'ciws', owner), 'klucz lufy strzelca');

    // Nowa klatka czyści indeks: encja bez sync w tej klatce nie ma rekordów.
    Turret2D.beginFrame();
    Turret2D.sync(crowd[0], 3000, 0, 0, 1);
    assert.equal(Turret2D.triggerShot('ciws', 0, 0, owner), null);
  } finally {
    Turret2D.clear();
  }
  const src = read('../src/vfx/turret2D.js');
  const trigger = src.slice(src.indexOf('  triggerShot(weaponKey, shotX, shotY, owner = null) {'), src.indexOf('  findTurretKey('));
  assert.match(trigger, /owner \? recordsByEntity\.get\(owner\) : frameRecords/);
});
