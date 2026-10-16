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
  // widok klatki gry (RW-31) → lustro
  gA.__inDrawBox = false; gB._coldDrawFrame = 7;
  bridgeGameToMirrors(rm, (s) => games[s], (o) => games.indexOf(o));
  assert.equal(mA.__inDrawBox, false);
  assert.equal(mB._coldDrawFrame, 7);
  // render pisze na lustrach — do gry wraca tylko paleta zastępcza dysz (warpTraffic.js)
  const fb = { warpPalette: 'x' };
  mA.__engineFxFallback = fb; mA.__cloakLook = look; mA.__hiddenFromView = true;
  bridgeMirrorsToGame(rm, [mA, mB]);
  assert.equal(gA.__engineFxFallback, fb);
  assert.equal('__cloakLook' in gA, false, 'wygląd maskowania liczy gra (RW-26) — bez mostu');
  assert.equal('__hiddenFromView' in gA, false);
  assert.equal('__engineFxFallback' in gB, false, 'bez pola, którego render nie ustawił');
});
