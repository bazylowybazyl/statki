// Baza piratów (misja 1, szkic użytkownika 2026-10-11): układ, bryły, sieć paliwowa, plan misji, kotwice ciał świata.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPirateBaseLayout, pirateBaseShipCorners, pirateBaseChunkAt, PIRATE_BASE_CREWED, PIRATE_BASE_BOSS } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { buildPirateBaseScene, PBASE_BERTH_BITS } from '../src/3d/portBuildings/pirateBaseScene.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS } from '../src/3d/portBuildings/portBuildingScene.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { dryDockPlanarSolids, dryDockChunkSolids } from '../src/3d/portBuildings/pirateDryDockChunks.js';
import { planFuelChain } from '../src/game/story/pirateBaseFuel.js';
import { placePirateBase, planPirateBase } from '../src/game/story/pirateBaseSite.js';
import { pirateBaseChunkRaster, pirateBasePinTest } from '../src/game/story/pirateBaseBodies.js';

const L = createPirateBaseLayout();
const SCENE = buildPirateBaseScene(L, resolvePortBuildingStyle('pirate'));

// SAT dla wielokątów wypukłych (x, z), `pad` — zapas
const axes = (p) => p.map((a, i) => { const b = p[(i + 1) % p.length]; const ex = b.x - a.x; const ez = b.z - a.z; const l = Math.hypot(ex, ez) || 1; return { x: -ez / l, z: ex / l }; });
const proj = (p, ax) => { let mn = Infinity; let mx = -Infinity; for (const v of p) { const d = v.x * ax.x + v.z * ax.z; if (d < mn) mn = d; if (d > mx) mx = d; } return [mn, mx]; };
const overlap = (A, B, pad = 0) => { for (const ax of [...axes(A), ...axes(B)]) { const [a0, a1] = proj(A, ax); const [b0, b1] = proj(B, ax); if (a1 + pad < b0 || b1 + pad < a0) return false; } return true; };

test('układ bazy: kawałki w limicie grup, budowle, stanowiska z załogą i herszt', () => {
  assert.ok(L.chunks.length + 1 <= PB_MAX_GROUPS, `${L.chunks.length} kawałków`);
  const all = Object.values(L.structures).flat();
  assert.equal(all.length, L.chunks.length, 'każdy kawałek należy do jednej budowli');
  assert.deepEqual(Object.keys(L.structures).sort(), ['fuel', 'habitat', 'piers', 'warehouse']);
  assert.equal(L.berths.length, 48);
  assert.ok(L.berths.length <= 2 * PBASE_BERTH_BITS, 'lampki stanowisk mieszczą się w dwóch kanałach');
  assert.equal(L.berths.filter((b) => b.crew && !b.boss).length, PIRATE_BASE_CREWED.length);
  const boss = L.berths.find((b) => b.boss);
  assert.equal(boss.id, PIRATE_BASE_BOSS);
  assert.equal(boss.cls, 'supercapital');
  assert.equal(L.berths.filter((b) => b.supercap).length, 3, 'trzy supercapitale w zatoce');
  for (const b of L.berths) assert.equal(L.chunkById.get(b.chunk)?.kind, 'pier', `${b.id} przy pomoście`);
  for (const h of L.hitSolids) assert.ok(L.chunkById.has(h.chunk), h.id);
  assert.equal(L.ram.berths.length, 4, 'rząd do taranu: cztery okręty');
  assert.ok(L.width > 12000 && L.depth > 7000, 'baza większa niż dawny dok');
});

test('okręty w stanowiskach nie nachodzą na siebie ani na bryły bazy', () => {
  const ships = L.berths.map((b) => ({ b, poly: pirateBaseShipCorners(b) }));
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) assert.ok(!overlap(ships[i].poly, ships[j].poly, 50), `${ships[i].b.id} × ${ships[j].b.id}`);
  }
  for (const s of ships) {
    for (const h of L.hitSolids) {
      if (h.chunk.startsWith('H-')) {
        assert.ok(s.poly.every((v) => Math.hypot(v.x, v.z) > L.habitat.drumR + 40), `${s.b.id} × bęben`);
        continue;
      }
      assert.ok(!overlap(s.poly, h.poly, 15), `${s.b.id} × ${h.chunk}`);
    }
  }
});

test('bryły: bez NaN, każdy kawałek ma bryły (ciała: w płaszczyźnie gry; duchy: wszystkie), lampy w limicie', () => {
  let nan = 0;
  for (const set of Object.values(SCENE.sets)) for (const a of Object.values(set)) for (const v of a) if (!Number.isFinite(v)) nan++;
  assert.equal(nan, 0);
  assert.ok(SCENE.lamps.length <= PB_MAX_LAMPS);
  assert.ok(SCENE.instances < 9000, `${SCENE.instances} brył`);
  for (const c of L.chunks) {
    const n = c.ghost ? dryDockChunkSolids(L, SCENE, [c.id]).length : dryDockPlanarSolids(L, SCENE, [c.id], { band: 4 }).length;
    assert.ok(n > 0, `${c.id}: ${n}`);
  }
});

test('kotwice: każdy kawałek-ciało ma węzły przypięte w rastrze', () => {
  for (const c of L.chunks) {
    if (c.ghost) continue;
    const r = pirateBaseChunkRaster(L, SCENE, c.id);
    assert.ok(r, c.id);
    const pin = pirateBasePinTest(L, c);
    const { width: W, height: H, data } = r.image;
    let pinned = 0;
    let solid = 0;
    for (let row = 0; row < H; row += 3) {
      for (let col = 0; col < W; col += 3) {
        if (data[(row * W + col) * 4 + 3] === 0) continue;
        solid++;
        const sx = (col + 0.5 - W / 2) * r.upp;
        const sy = (H / 2 - row - 0.5) * r.upp;
        if (pin(r.cx + sx, r.cz - sy)) pinned++;
      }
    }
    assert.ok(solid > 0 && pinned > 0, `${c.id}: ${pinned} / ${solid}`);
    assert.ok(pinned < solid, `${c.id}: nie cały przypięty`);
  }
});

test('sieć paliwowa: zbiorniki zapalają całą sieć, śluzy zatrzymują front na habitacie', () => {
  const taps = L.berths.length;
  const full = planFuelChain(L, 'P', { sluices: false });
  assert.equal(full.events.filter((e) => e.kind === 'tap').length, taps, 'bez śluz — wszystkie stanowiska');
  assert.ok(full.events.some((e) => e.kind === 'habitat') && full.events.some((e) => e.kind === 'warehouse'));
  assert.ok(full.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t), 'rosnąco w czasie');
  assert.ok(full.events.at(-1).t < 25, `cała baza w ${full.events.at(-1).t.toFixed(1)} s`);
  const sl = planFuelChain(L, 'P', { sluices: true });
  assert.ok(!sl.events.some((e) => e.kind === 'habitat'), 'śluzy: habitat nietknięty');
  const near = new Set(L.berths.filter((b) => ['Y-A', 'Y-B', 'N-P'].includes(b.pier)).map((b) => b.id));
  assert.ok(!sl.events.some((e) => e.kind === 'tap' && near.has(e.berth)), 'śluzy: ramiona Y i pomost wschodni bez ognia');
  const fromH = planFuelChain(L, 'H', { sluices: true });
  assert.deepEqual(fromH.events.map((e) => e.kind), ['habitat'], 'habitat ze śluzami — ogień zostaje w środku');
  const done = new Set(full.events.map((e) => e.node).filter(Boolean));
  const again = planFuelChain(L, 'H', { sluices: false, done });
  assert.ok(!again.events.some((e) => e.kind === 'tap'), 'węzły wypalone nie zapalają się drugi raz');
});

test('plan misji: trasy startów nie przecinają innych okrętów, herszt wychodzi z zatoki, miejsce w grze', () => {
  const center = { x: 4_200_000, y: 1_300_000 };
  const plan = planPirateBase(center, { x: 1_000_000, y: 900_000 });
  const place = plan.dock;
  // przejścia układ ↔ gra
  const g = place.toGame(1234, -567);
  const h = place.toHub(g.x, g.y);
  assert.ok(Math.abs(h.x - 1234) < 1e-6 && Math.abs(h.z + 567) < 1e-6);
  assert.ok(place.distance(center.x, center.y) === 0);
  assert.equal(pirateBaseChunkAt(L, 0, 0), 'H-C');
  assert.ok(Math.hypot(plan.warpIn.x - plan.building.x, plan.warpIn.y - plan.building.y) > 55000, 'wyjście z warpa za mgłą');
  // okręty w układzie bazy: prostokąty; trasa startu w punktach z krokiem 150 j. (kurs okrętu bez zmian na odcinku
  // cofania, potem kurs w stronę punktu)
  const polys = L.berths.map((b) => pirateBaseShipCorners(b));
  for (const p of plan.parked) {
    if (!p.crew) continue;
    const b = L.berthById.get(p.berth);
    const pts = [{ x: b.x, z: b.z }, ...p.launch.path.map((q) => place.toHub(q.x, q.y))];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const c = pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 150));
      const ang = k === 0 ? b.angle : Math.atan2(c.z - a.z, c.x - a.x);
      for (let i = 1; i <= n; i++) {
        const q = { ...b, x: a.x + ((c.x - a.x) * i) / n, z: a.z + ((c.z - a.z) * i) / n, angle: ang };
        const me = pirateBaseShipCorners(q);
        L.berths.forEach((o, j) => {
          if (o === b) return;
          assert.ok(!overlap(me, polys[j], 0), `${b.id} (start, odcinek ${k}) × ${o.id}`);
        });
      }
    }
  }
});
