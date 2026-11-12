// Szyja habitatu (src/game/story/pirateBaseNeck.js): taran zapisany przez noteNeckRam.
// Zgłoszenie użytkownika 2026-11-07 „trzeba na dwa razy”: szarża F dociśnięta do szybu (styk wolny — ściana bębna zjada
// rozpęd) ma zrywać szyję przy pierwszej szarży; zwykły docisk bez szarży — nie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeckState, noteNeckRam, snapNeck, towerFallSign, towerCrushChunks, TOWER_FALL_HALF_ANGLE } from '../src/game/story/pirateBaseNeck.js';
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
test('kierunek upadku wieży: tam, gdzie w pasie upadku stoi więcej wieżowców', () => {
  const L = createPirateBaseLayout();
  const B = L.habitat.buildings;
  const band = (a) => B.filter((b) => Math.abs(Math.atan2(Math.sin(b.a - a), Math.cos(b.a - a))) <= TOWER_FALL_HALF_ANGLE).map((b) => b.id);
  const east = band(0), west = band(Math.PI);
  assert.ok(east.length >= 4 && west.length >= 4, `pas upadku: ${east.length} / ${west.length} wieżowców`);
  const down = (ids) => (id) => ids.includes(id);
  // upadek ku +x: stoi wszystko — zostaje; wyłom po tej stronie (2 wieżowce) — odwrót; wyłomy po obu stronach równe — zostaje
  assert.equal(towerFallSign(L, 1, 0, down([])), 1);
  assert.equal(towerFallSign(L, 1, 0, down(east.slice(0, 2))), -1);
  assert.equal(towerFallSign(L, 1, 0, down([...east.slice(0, 2), ...west.slice(0, 2)])), 1);
  assert.equal(towerFallSign(L, 1, 0, down(west.slice(0, 2))), 1, 'wyłom po przeciwnej stronie — wieża i tak pada na stojące');
  assert.equal(towerFallSign(L, 0.1, 1, down(band(Math.atan2(1, 0.1)).slice(0, 1))), -1);
  assert.equal(towerFallSign(null, 1, 0, down(east)), 1, 'bez układu — bez zmian');
});

test('co wieża miażdży: wieżowce w pasie upadku (od wewnętrznego pierścienia) i dwa sektory dysku pod torem', () => {
  const L = createPirateBaseLayout();
  const e = towerCrushChunks(L, { x: 1, z: 0.05 });
  assert.ok(e.buildings.length >= 4 && e.buildings.length <= 8, `wieżowców ${e.buildings.length}`);
  for (const id of e.buildings) {
    const b = L.habitat.buildings.find((q) => q.id === id);
    assert.ok(b && b.x > 0, `${id} po stronie upadku`);
    assert.equal(L.chunkById.get(id).kind, 'highrise');
  }
  assert.equal(L.habitat.buildings.find((q) => q.id === e.buildings[0]).ring, 0, 'najpierw pierścień wewnętrzny');
  assert.ok(e.buildings.some((id) => L.habitat.buildings.find((q) => q.id === id).ring === 1), 'także zewnętrzny');
  assert.deepEqual(e.sectors, ['D-1', 'D-2'], 'sektor pod kierunkiem i sąsiad od strony odchylenia');
  const s = towerCrushChunks(L, { x: -0.05, z: 1 });
  assert.equal(s.sectors.length, 2);
  for (const id of s.sectors) assert.ok(L.chunkById.get(id)?.kind === 'disc', id);
  assert.ok(s.buildings.every((id) => L.habitat.buildings.find((q) => q.id === id).z > 0));
  // pasy przeciwnych kierunków nie mają wspólnych wieżowców
  const w = towerCrushChunks(L, { x: -1, z: -0.05 });
  assert.ok(!w.buildings.some((id) => e.buildings.includes(id)));
  assert.ok(w.sectors.every((id) => /^D-[1-8]$/.test(id)) && new Set(w.sectors).size === 2);
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
