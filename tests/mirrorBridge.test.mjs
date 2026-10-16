// RW-11a: przejściowe mosty gra ↔ lustro (src/render/mirrorBridge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeGameToMirrors, bridgeMirrorsToGame } from '../src/render/mirrorBridge.js';
import { MirrorEntity } from '../src/render/renderMirror.js';

test('mosty: pola renderu przez obiekty gry w obie strony, tożsamość __lightMate → lustro', () => {
  const look = { active: true };
  const gA = { __warpHullU: { a: 1 }, __warpNurtMode: 'active', __bayCut: { x: 0 }, __lightOcclude: () => true };
  const gB = { name: 'holownik' };
  gA.__lightMate = gB;
  const mA = new MirrorEntity(0, 1), mB = new MirrorEntity(1, 1);
  const rm = { entities: [mA, mB] };
  const games = [gA, gB];
  bridgeGameToMirrors(rm, (s) => games[s], (o) => games.indexOf(o));
  assert.equal(mA.__game, gA);
  assert.equal(mA.__warpHullU, gA.__warpHullU);
  assert.equal(mA.__warpNurtMode, 'active');
  assert.equal(mA.__lightOcclude, gA.__lightOcclude);
  assert.equal(mA.__lightMate, mB, 'tożsamość partnera świateł → jego lustro');
  // render pisze na lustrach
  mA.__cloakLook = look; mA.__inDrawBox = true; mA.__hiddenFromView = false;
  mB.__inDrawBox = false; mB._coldSkinFrame = 7;
  bridgeMirrorsToGame(rm, [mA], [mB]);
  assert.equal(gA.__cloakLook, look);
  assert.equal(gA.__inDrawBox, true);
  assert.equal(gB._coldSkinFrame, 7);
  assert.equal('__inDrawBox' in gB, false, 'zimny wrak — bez pola pudła rysowania (jak dziś)');
});
