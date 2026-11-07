// Szyja habitatu (src/game/story/pirateBaseNeck.js): taran zapisany przez noteNeckRam.
// Zgłoszenie użytkownika 2026-11-07 „trzeba na dwa razy”: szarża F dociśnięta do szybu (styk wolny — ściana bębna zjada
// rozpęd) ma zrywać szyję przy pierwszej szarży; zwykły docisk bez szarży — nie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeckState, noteNeckRam } from '../src/game/story/pirateBaseNeck.js';

const core = { id: 'H-C', structure: 'habitat' };
const drum = { id: 'H-E', structure: 'habitat' };
const ship = (vx, vy, angle) => ({ x: 900, y: 0, vx, vy, angle, mass: 800000 });

test('szarża dociśnięta do szybu zrywa szyję także bez prędkości, kierunek z dziobu', () => {
  const st = createNeckState();
  noteNeckRam(st, core, ship(0, 0, Math.PI), 10, 300, 0, true);
  assert.equal(st.ramCharge, true);
  assert.equal(st.ramT, 10);
  assert.ok(Math.abs(st.ramVx + 1) < 1e-9 && Math.abs(st.ramVy) < 1e-9, `kierunek ${st.ramVx}, ${st.ramVy}`);
});

test('szarża: kierunek z dziobu, prędkość styku zostaje (przechył wieży)', () => {
  const st = createNeckState();
  noteNeckRam(st, core, ship(30, 40, Math.PI / 2), 5, 0, 300, true);
  assert.equal(st.ramCharge, true);
  assert.ok(Math.abs(st.ramVx) < 1e-9 && Math.abs(st.ramVy - 50) < 1e-9, `kierunek ${st.ramVx}, ${st.ramVy}`);
  assert.equal(st.ramPeak, 50);
});

test('docisk bez szarży i szarża o bęben nie zrywają szyi', () => {
  const a = createNeckState();
  noteNeckRam(a, core, ship(0, 0, Math.PI), 10, 300, 0, false);
  assert.equal(a.ramCharge, false);
  assert.equal(a.ramT < 0, true);
  const b = createNeckState();
  noteNeckRam(b, drum, ship(-60, 0, Math.PI), 10, 900, 0, true);
  assert.equal(b.ramCharge, false);
  assert.equal(b.ramT, 10);
});

test('po zerwaniu szyi taran niczego nie zapisuje', () => {
  const st = createNeckState();
  st.phase = 'toppling';
  noteNeckRam(st, core, ship(0, 0, 0), 10, 300, 0, true);
  assert.equal(st.ramCharge, false);
});
