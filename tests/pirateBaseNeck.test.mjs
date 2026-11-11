// Szyja habitatu (src/game/story/pirateBaseNeck.js): taran zapisany przez noteNeckRam.
// Zgłoszenie użytkownika 2026-11-07 „trzeba na dwa razy”: szarża F dociśnięta do szybu (styk wolny — ściana bębna zjada
// rozpęd) ma zrywać szyję przy pierwszej szarży; zwykły docisk bez szarży — nie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeckState, noteNeckRam, snapNeck, towerFallSign, towerCrushChunks } from '../src/game/story/pirateBaseNeck.js';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';

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

// Wieża pada na STOJĄCE wieżowce (prośba użytkownika 2026-11-11): kierunek upadku odwraca się tylko wtedy, gdy ćwiartka
// miasta po stronie upadku już leży, a przeciwna stoi.
test('kierunek upadku wieży: na stojącą ćwiartkę miasta', () => {
  const L = createPirateBaseLayout();
  const down = (...ids) => (id) => ids.includes(id);
  // upadek ku +x (ćwiartka E): stoi wszystko — zostaje; E leży — odwrót na W; E i W leżą — zostaje
  assert.equal(towerFallSign(L, 1, 0, down()), 1);
  assert.equal(towerFallSign(L, 1, 0, down('H-E')), -1);
  assert.equal(towerFallSign(L, 1, 0, down('H-E', 'H-W')), 1);
  assert.equal(towerFallSign(L, 1, 0, down('H-W')), 1, 'leży tylko przeciwna — wieża i tak pada na stojącą');
  // ku +z (ćwiartka S) przy wyłomie w S: odwrót na N
  assert.equal(towerFallSign(L, 0.1, 1, down('H-S')), -1);
  assert.equal(towerFallSign(null, 1, 0, down('H-E')), 1, 'bez układu — bez zmian');
});

test('co wieża miażdży: ćwiartka po stronie upadku i dwa sektory dysku pod torem', () => {
  const L = createPirateBaseLayout();
  const n = L.habitat.discSectors;
  const e = towerCrushChunks(L, { x: 1, z: 0.05 });
  assert.equal(e.quadrant, 'H-E');
  assert.deepEqual(e.sectors, ['D-1', 'D-2'], 'sektor pod kierunkiem i sąsiad od strony odchylenia');
  const s = towerCrushChunks(L, { x: -0.05, z: 1 });
  assert.equal(s.quadrant, 'H-S');
  assert.equal(s.sectors.length, 2);
  for (const id of s.sectors) assert.ok(L.chunkById.get(id)?.kind === 'disc', id);
  const w = towerCrushChunks(L, { x: -1, z: -0.01 });
  assert.equal(w.quadrant, 'H-W');
  assert.ok(w.sectors.every((id) => /^D-[1-8]$/.test(id)) && new Set(w.sectors).size === 2, `${w.sectors} z ${n}`);
});

test('zerwanie wieży pyta klej o kierunek (pickFall): odwrócony kierunek trafia do stanu, przegub i obrót idą za nim', () => {
  const L = createPirateBaseLayout();
  const body = { nodeStore: { count: 0, active: [], x: [], y: [], z: [] }, quat: { x: 0, y: 0, z: 0, w: 1 }, pos: { x: 0, y: 0, z: 500 }, angVel: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, activeNodes: 10 };
  const tower = { beamHull: { body } };
  const site = { pieces: [{ id: 'H-T' }] };
  const mk = (pickFall) => ({ worldBodies: { detachPiece: () => [tower] }, engine: null, layout: L, habitat: { x: 0, y: 0 }, simTime: 1, pickFall });
  const a = createNeckState();
  assert.equal(snapNeck(a, site, mk(null), -1, 0, 1000), true);
  assert.deepEqual([a.fallX, a.fallY], [1, -0], 'bez haka: ku stronie, z której przyszedł taran');
  const b = createNeckState();
  assert.equal(snapNeck(b, site, mk((fx, fy) => ({ x: -fx, y: -fy })), -1, 0, 1000), true);
  assert.deepEqual([b.fallX, b.fallY], [-1, 0], 'hak odwraca kierunek');
  assert.ok(body.angVel.y < 0, 'obrót startowy ku odwróconej stronie');
});
