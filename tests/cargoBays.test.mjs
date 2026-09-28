// Ładownie kadłubów (zadanie 26, demo dema/ladownia-webgpu.html): strefy na sprite'ach,
// sloty modułów, pojemność, przebieg wrót „à la Venator”. Czysta logika, bez GPU.
// node --test tests/cargoBays.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decodePng } from '../scripts/webgpu/png.mjs';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneMargin } from '../src/game/shipBridge.js';
import { getHullRenderSize, getWeaponTierForHull } from '../src/data/ships.js';
import {
  CARGO_BAY_HULLS,
  CARGO_BAY_HULL_ORDER,
  CARGO_BAY_PARAMS,
  CARGO_CONTAINER,
  CARGO_COPPER_ROCK_ORE_T,
  CARGO_TONNES_DEFAULT,
  CARGO_TONNES_OPTIONS,
  cargoBayDoorPose,
  cargoBayDoorProgress,
  cargoBayDoorTimeline,
  cargoBayGeometry,
  cargoBayLamps,
  cargoBayScale,
  cargoBaySlots,
  cargoBayToShip,
  cargoBayZoneRects,
  cargoCapacityTable,
  cargoContainersForMass,
  cargoHullBays,
  cargoHullCapacity,
  cargoModuleContainer,
  cargoModuleSize,
  cargoShipToWorld,
  validateCargoBays
} from '../src/data/cargoBays.js';

const repoFile = (p) => new URL(`../${p}`, import.meta.url);
const pngSize = (p) => {
  const b = readFileSync(repoFile(p));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('every hull has its sprite at the recorded size and the render length of the game', () => {
  for (const [id, H] of Object.entries(CARGO_BAY_HULLS)) {
    assert.deepEqual(pngSize(H.sprite), [H.png.w, H.png.h], `${id}: sprite zmienił rozmiar — przesuń strefy ładowni`);
    if (H.profile) {
      const size = getHullRenderSize(H.profile, H.png.w, H.png.h);
      assert.equal(Math.max(size.w, size.h), H.renderLength, `${id}: renderLength ≠ getHullRenderSize`);
    }
    assert.ok(H.bays.length >= 1, `${id}: bez ładowni`);
    assert.ok(H.cargoToday > 0 && typeof H.todayNote === 'string', `${id}: brak dzisiejszej ładowni`);
  }
  // Wagon megafrachtowca: moduł składu 2760 j. (megafreighterTrain.js).
  assert.equal(CARGO_BAY_HULLS.megafreighter_wagon.renderLength, 2760);
});

test('bays and door parking bands lie on the hull (sprite alpha), not in space', () => {
  for (const [id, H] of Object.entries(CARGO_BAY_HULLS)) {
    const img = decodePng(readFileSync(repoFile(H.sprite)));
    const W = img.width;
    const Hh = img.height;
    for (const r of cargoBayZoneRects(H)) {
      let n = 0;
      let opaque = 0;
      for (let y = Math.ceil(r.y0 + Hh / 2); y < r.y1 + Hh / 2; y += 3) {
        for (let x = Math.ceil(r.x0 + W / 2); x < r.x1 + W / 2; x += 3) {
          n++;
          if (x >= 0 && y >= 0 && x < W && y < Hh && img.data[(y * W + x) * 4 + 3] > 200) opaque++;
        }
      }
      assert.ok(n > 0, `${id}/${r.bayId}: pusta strefa`);
      assert.ok(opaque / n >= 0.97, `${id}/${r.bayId} ${r.kind}: tylko ${(100 * opaque / n).toFixed(1)}% kadłuba`);
    }
  }
});

test('bays clear hardpoints, engines, cores and bridge zones (parking bands with the full bridge margin)', () => {
  for (const [id, H] of Object.entries(CARGO_BAY_HULLS)) {
    if (!H.editorKey) continue;
    const cfg = SHIP_EDITOR_DEFAULTS.ships[H.editorKey];
    assert.ok(cfg, `${id}: brak wpisu edytora ${H.editorKey}`);
    const entry = BRIDGE_LAYOUT_PROPOSALS[H.bridgeKey];
    const zones = entry ? entry.variants[entry.defaultVariant] : [];
    const size = getHullRenderSize(H.profile, H.png.w, H.png.h);
    const margin = bridgeZoneMargin(Math.min(size.w / H.png.w, size.h / H.png.h), getWeaponTierForHull(H.profile));
    assert.deepEqual(validateCargoBays(H, cfg, zones, margin), [], id);
  }
  // Detektor: strefa na wieżyczce i na mostku to błąd.
  const fake = { png: { w: 400, h: 200 }, renderLength: 400, bays: [{ id: 'x', x: 0, y: 0, w: 100, h: 40, door: 'over', leaves: 1, module: { nx: 1, ny: 1, nz: 1 } }] };
  const hit = validateCargoBays(fake, { hardpoints: [{ id: 'a', type: 'main', x: 0, y: 30 }] }, [{ id: 'm', x: 40, y: 0, w: 10, h: 10 }], 20);
  assert.deepEqual(hit.map((i) => `${i.zone}:${i.kind}`).sort(), ['bay:bridge', 'bay:hardpoint', 'parking:hardpoint'].sort());
  // Punkt startu myśliwców (hangar) nie koliduje: hangar i ładownia to ten sam pokład.
  assert.deepEqual(validateCargoBays(fake, { hardpoints: [{ id: 'h', type: 'hangar', x: 0, y: 0 }] }, [], 20), []);
});

test('module slots fit the opening with wall and module gaps, never overlap, fill order from the stern', () => {
  const P = CARGO_BAY_PARAMS;
  for (const id of CARGO_BAY_HULL_ORDER) {
    for (const g of cargoHullBays(id)) {
      const slots = cargoBaySlots(g);
      assert.equal(slots.length, g.cols * g.rows, `${id}/${g.id}`);
      assert.ok(g.slots >= 1, `${id}/${g.id}: bez slotu`);
      const orders = new Set(slots.map((s) => s.index));
      assert.equal(orders.size, slots.length, `${id}/${g.id}: kolejność nie jest permutacją`);
      for (const s of slots) {
        assert.ok(Math.abs(s.a) + g.module.L / 2 <= g.halfA - P.wallGap + 1e-6, `${id}/${g.id}: slot wystaje (a)`);
        assert.ok(Math.abs(s.b) + g.module.W / 2 <= g.halfB - P.wallGap + 1e-6, `${id}/${g.id}: slot wystaje (b)`);
      }
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const A = slots[i];
          const B = slots[j];
          const sepA = Math.abs(A.a - B.a) >= g.module.L + P.moduleGap - 1e-6;
          const sepB = Math.abs(A.b - B.b) >= g.module.W + P.moduleGap - 1e-6;
          assert.ok(sepA || sepB, `${id}/${g.id}: sloty ${i} i ${j} nachodzą`);
        }
      }
      // Od rufy: kolumny rosną w kolejności, w kolumnie od osi.
      for (let k = 1; k < slots.length; k++) assert.ok(slots[k].col >= slots[k - 1].col);
      if (g.rows > 1) assert.ok(Math.abs(slots[0].b) <= g.pitchB / 2 + 1e-6, `${id}/${g.id}: pierwszy slot nie przy osi`);
      // Głębia mieści stos modułu, wrota zamykają się nad ładunkiem.
      assert.ok(g.depth >= g.module.H + 1, `${id}/${g.id}: płytka ładownia`);
    }
  }
});

test('containers in a module stack tier by tier inside the module footprint', () => {
  const mod = cargoModuleSize({ nx: 2, ny: 2, nz: 2 }, {});
  assert.equal(mod.count, 8);
  assert.equal(mod.L, 2 * CARGO_CONTAINER.L + CARGO_CONTAINER.gap);
  const seen = new Set();
  for (let k = 0; k < mod.count; k++) {
    const c = cargoModuleContainer(mod, k, {});
    assert.equal(c.tier, k < 4 ? 0 : 1);
    assert.ok(Math.abs(c.a) + CARGO_CONTAINER.L / 2 <= mod.L / 2 + 1e-9);
    assert.ok(Math.abs(c.b) + CARGO_CONTAINER.W / 2 <= mod.W / 2 + 1e-9);
    seen.add(`${c.a}:${c.b}:${c.z}`);
  }
  assert.equal(seen.size, 8, 'kontenery modułu nie nachodzą');
});

test('capacity = containers × tonnes; the Atlas takes more than one copper rock at the default tonnage', () => {
  assert.ok(CARGO_TONNES_OPTIONS.includes(CARGO_TONNES_DEFAULT));
  for (const t of CARGO_TONNES_OPTIONS) {
    const table = cargoCapacityTable(t);
    assert.equal(table.length, CARGO_BAY_HULL_ORDER.length);
    for (const row of table) {
      const cap = cargoHullCapacity(row.id, t);
      assert.equal(row.tonnes, cap.containers * t, row.id);
      assert.equal(row.containers, row.bays.reduce((s, b) => s + b.containers, 0), row.id);
      assert.ok(row.containers >= 1, `${row.id}: bez kontenera`);
    }
  }
  const atlas = cargoHullCapacity('atlas', CARGO_TONNES_DEFAULT);
  assert.ok(atlas.tonnes >= CARGO_COPPER_ROCK_ORE_T, `Atlas: ${atlas.tonnes} t < jedna skała miedzi`);
  assert.ok(atlas.tonnes > CARGO_BAY_HULLS.atlas.cargoToday * 5, 'Atlas: ładownia nie urosła');
  // Widok liczby: kontenery na masę.
  assert.equal(cargoContainersForMass(100, 0, 2), 0);
  assert.equal(cargoContainersForMass(100, 0.1, 2), 1);
  assert.equal(cargoContainersForMass(100, 7, 2), 4);
  assert.equal(cargoContainersForMass(10, 1000, 2), 10);
});

test('door timeline: closed at 0, open at the end, the opening grows monotonically and leaves cover the rest', () => {
  for (const id of CARGO_BAY_HULL_ORDER) {
    for (const g of cargoHullBays(id)) {
      const T = cargoBayDoorTimeline(g);
      assert.ok(T.total >= T.warn + T.unlock + T.slide);
      const closed = cargoBayDoorPose(g, 0);
      assert.equal(closed.open, 0);
      assert.equal(closed.lamps, 0);
      for (const q of closed.leaves) { assert.equal(q.db, 0); assert.equal(q.z1, 0); }
      const open = cargoBayDoorPose(g, T.total);
      assert.equal(open.open, 1);
      assert.equal(open.lamps, 1);
      g.leaves.forEach((L, k) => {
        const q = open.leaves[k];
        assert.ok(Math.abs(q.db - L.side * L.travel) < 1e-9, `${id}/${g.id}: skrzydło nie dojechało`);
        if (g.door === 'over') assert.ok(q.z0 >= 0, `${id}/${g.id}: skrzydło „over” pod poszyciem`);
        else assert.ok(q.z1 < 0, `${id}/${g.id}: skrzydło „pocket” nad poszyciem`);
      });
      // Odsłonięty pas |b| < open · halfB; skrzydła pokrywają resztę połowy otworu bez szpar.
      let prev = -1;
      for (let p = 0; p <= T.total + 1e-9; p += T.total / 40) {
        const pose = cargoBayDoorPose(g, p);
        assert.ok(pose.open >= prev - 1e-12, 'otwarcie maleje');
        prev = pose.open;
        for (const side of [1, -1]) {
          const cover = g.leaves.filter((L) => L.side === side).map((L) => {
            const q = pose.leaves[g.leaves.indexOf(L)];
            const lo = Math.min(L.b0, L.b1) + q.db;
            const hi = Math.max(L.b0, L.b1) + q.db;
            return side > 0 ? [lo, hi] : [-hi, -lo];
          }).sort((u, v) => u[0] - v[0]);
          assert.ok(Math.abs(cover[0][0] - pose.open * g.halfB) < 1e-6, `${id}/${g.id}: brzeg otworu`);
          for (let k = 1; k < cover.length; k++) assert.ok(cover[k][0] <= cover[k - 1][1] + 1e-6, `${id}/${g.id}: szpara między skrzydłami`);
        }
      }
    }
  }
});

test('door progress for scenes: opening, then closing retraces the same path', () => {
  const g = cargoBayGeometry('atlas', 'grzbiet');
  const T = cargoBayDoorTimeline(g);
  assert.equal(cargoBayDoorProgress(g, -1, 0), 0);
  assert.equal(cargoBayDoorProgress(g, T.total + 5, 0), T.total);
  assert.equal(cargoBayDoorProgress(g, 30, 0, 30), T.total);
  assert.ok(Math.abs(cargoBayDoorProgress(g, 31.5, 0, 30) - (T.total - 1.5)) < 1e-9);
  assert.equal(cargoBayDoorProgress(g, 30 + T.total + 1, 0, 30), 0);
});

test('lamps line both long walls just under the rim; transforms bay → ship → world follow Core3D', () => {
  const g = cargoBayGeometry('atlas', 'grzbiet');
  const lamps = cargoBayLamps(g);
  assert.equal(lamps.length, 2 * g.lamps);
  for (const L of lamps) {
    assert.ok(Math.abs(L.a) < g.halfA && Math.abs(Math.abs(L.b) - g.halfB) < 1 && L.z < 0 && L.z > -g.depth);
  }
  const s = cargoBayScale('atlas');
  const p = cargoBayToShip(g, 0, 0, {});
  assert.ok(Math.abs(p.x - 66 * s) < 1e-9 && Math.abs(p.y) < 1e-9);
  // Poza gry: statek na (100, 50), kąt π/2 (dziób w dół ekranu gry = −y sceny).
  const w = cargoShipToWorld({ x: 100, y: 50, angle: Math.PI / 2 }, 10, 0, {});
  assert.ok(Math.abs(w.x - 100) < 1e-9 && Math.abs(w.y - (-50 - 10)) < 1e-9, JSON.stringify(w));
});
