// Nadproża bram K-7 nad okrętem w bramie (zgłoszenie użytkownika 2026-10-13): obrysy nadproży w świecie gry
// i test punktu (wieże kanwy, lampy pozycyjne, okna mostków pod nadprożem gasną) — src/game/k7GateLintels.js.
// node --test tests/k7GateLintels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { createK7Layout, k7GateLintelList, K7_GATE_LINTEL } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const { createLintelCover, refreshLintelCover, lintelCovers } = await import('../src/game/k7GateLintels.js');
const { hallToGameAffine } = await import('../src/game/hallDustInput.js');
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');

test('nadproża: obrys z góry nad otworem każdej bramy (otwór + zakład, głębokość listwy)', () => {
  const l = createK7Layout();
  const list = k7GateLintelList(l);
  assert.equal(list.length, l.gates.length);
  for (const L of list) {
    const g = l.gates.find((q) => q.id === L.gateId);
    assert.equal(L.hl * 2, g.clearWidth + K7_GATE_LINTEL.extra);
    assert.equal(L.hd * 2, K7_GATE_LINTEL.depth);
  }
});

test('nadproża w świecie gry: punkt w otworze bramy przykryty, w hali i za bramą — nie; hala daleko od kamery — pusto', () => {
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 6123456.7, y: 4234567.8 });
  const rings = [{ collider: col }];
  const l = createK7Layout();
  const a = hallToGameAffine(col.place, col.registry.halls[1].frame, {});
  const at = (x, z) => ({ x: a.p0x + x * a.ax + z * a.bx, y: a.p0y + x * a.ay + z * a.by });
  const cover = createLintelCover();
  const cam = at(0, l.frontZ);
  refreshLintelCover(cover, rings, cam.x, cam.y, 8000);
  assert.ok(cover.n >= 3 && cover.n <= 12, `nadproża przy kamerze: ${cover.n}`);
  const g1 = l.gates.find((g) => g.id === 'G-01');
  for (const u of [-3000, -810, 0, 2500]) {
    const p = at(g1.x + g1.ux * u, g1.z + g1.uz * u);
    assert.ok(lintelCovers(cover, p.x, p.y), `pod nadprożem u=${u}`);
  }
  for (const [x, z] of [[-810, l.frontZ - 300], [-810, l.frontZ + 300], [0, 3500]]) {
    const p = at(x, z);
    assert.ok(!lintelCovers(cover, p.x, p.y), `poza nadprożem (${x}, ${z})`);
  }
  // bramy boczne (G-02, G-03)
  for (const g of l.gates.filter((q) => q.id !== 'G-01')) {
    const p = at(g.x, g.z);
    assert.ok(lintelCovers(cover, p.x, p.y), g.id);
  }
  refreshLintelCover(cover, rings, cam.x + 5e6, cam.y, 8000);
  assert.equal(cover.n, 0, 'kamera daleko — bez nadproży');
  refreshLintelCover(cover, null, cam.x, cam.y, 8000);
  assert.equal(cover.n, 0, 'bez ringów');
});
