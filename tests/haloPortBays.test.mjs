// Otwarte zatoki portu Ziemi ze stanowiskami w standardzie K-7 i dokowanie
// gracza dowolnym kadłubem (poprawka użytkownika 2026-09-23: gracz lata
// frachtowcami jak NPC i dokuje także poza K-7; 2026-09-24: po jednej
// powiększonej zatoce z każdej strony K-7). Czysta logika, bez GPU.
// node --test tests/haloPortBays.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { HALO_PORT, haloPortComplexAngles } from '../src/3d/haloRing/haloRingConfig.js';
import {
  K7FlightModel,
  createK7Layout,
  k7BoxPoly,
  k7ConvexOverlap,
  k7Frame,
  k7HubToWorld
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { HALO_BAY, baySolidList, createBayLayout, haloBayLayouts, haloFrameToFrame, haloXfPoint } from '../src/3d/haloRing/haloPortBays.js';
import { HALO_PLAYER_HULLS, haloHullFits } from '../src/3d/haloRing/haloPortHulls.js';
import { PortDocking, buildPortCollision, createPortRegistry } from '../src/3d/haloRing/haloPortDocking.js';
import { berthClassForHull } from '../src/game/traffic/dockLayout.js';

const ring = createHaloRingLayout({});
const padPoly = (b) => k7BoxPoly(b.x, b.z, b.width, b.length);

test('zatoka: 2 pasy MEGA + podwójny grzebień 4 L / 4 M / 4 S w ścianach, bez zachodzenia na siebie', () => {
  {
    const l = createBayLayout({ index: 4, complex: 1 });
    assert.deepEqual(l.berths.map((b) => b.size), ['MEGA', 'MEGA', 'L', 'L', 'M', 'M', 'S', 'S', 'L', 'L', 'M', 'M', 'S', 'S']);
    // symetria: pasy MEGA przy obu ścianach, grzebienie lustrzane względem alei
    assert.equal(l.lanes.length, 2);
    assert.ok(Math.abs(l.lanes[0].x + l.lanes[1].x) < 1e-9);
    for (const b of l.berths) {
      assert.ok(Math.abs(b.x) + b.width / 2 <= HALO_BAY.innerHalf + 1e-6, `${b.id} poza ścianą boczną`);
      assert.ok(b.z - b.length / 2 >= l.backZ && b.z + b.length / 2 <= l.openZ, `${b.id} poza pokładem (z ${b.z})`);
    }
    for (let i = 0; i < l.berths.length; i++) {
      for (let j = i + 1; j < l.berths.length; j++) {
        assert.ok(!k7ConvexOverlap(padPoly(l.berths[i]), padPoly(l.berths[j])), `${l.berths[i].id} × ${l.berths[j].id}`);
      }
    }
    // pasy MEGA, grzbiety i aleja grzebienia wolne od pól grzebienia i od siebie
    // (aleja styka się z wewnętrznym końcem pól grzebienia, jak w K-7 — bez zachodzenia)
    const aisle = k7BoxPoly(l.aisle.x, (l.aisle.z0 + l.aisle.z1) / 2, l.aisle.width - 2, l.aisle.z1 - l.aisle.z0);
    const comb = l.berths.filter((b) => b.size !== 'MEGA');
    for (const ln of l.lanes) {
      const lane = k7BoxPoly(ln.x, (l.backZ + l.openZ) / 2, ln.width - 2, l.openZ - l.backZ);
      assert.ok(!k7ConvexOverlap(lane, aisle), 'pas MEGA na alei');
      for (const b of comb) assert.ok(!k7ConvexOverlap(lane, padPoly(b)), `${b.id} na pasie MEGA`);
      // megafrachtowiec mieści się w pasie (szerokość) i na polu (długość)
      const mega = l.berths.find((b) => b.id === ln.berthId);
      const mf = HALO_PLAYER_HULLS.megafreighter.fit;
      assert.ok(mf.length <= mega.maxLength && mega.maxLength <= mega.padLength, 'pole MEGA');
      assert.ok(mf.beam + 300 <= ln.width, 'pas MEGA za wąski');
    }
    for (const sp of l.spines) {
      const spine = k7BoxPoly(sp.x, (sp.z0 + sp.z1) / 2, sp.width - 2, sp.z1 - sp.z0);
      for (const b of l.berths) assert.ok(!k7ConvexOverlap(spine, padPoly(b)), `${b.id} na grzbiecie`);
    }
    for (const b of comb) {
      assert.ok(!k7ConvexOverlap(aisle, padPoly(b)), `${b.id} na alei`);
      // wjazd z alei prosto na pole (dziobem do grzbietu serwisowego po swojej stronie)
      assert.equal(b.approach.from.x, l.aisle.x);
      assert.equal(Math.sign(Math.cos(b.angle)), b.side);
      assert.equal(Math.sign(b.x), b.side);
    }
    assert.equal(comb.filter((b) => b.side < 0).length, 6);
    // bryły (słupki serwisowe i paliwowe) nie stoją na polach
    for (const s of baySolidList(l)) {
      if (!s.id.startsWith('SERVICE') && !s.id.startsWith('FUEL')) continue;
      for (const b of l.berths) assert.ok(!k7ConvexOverlap(k7BoxPoly(s.x, s.z, s.w, s.d), padPoly(b)), `${s.id} na ${b.id}`);
    }
  }
});

test('8 zatok (po jednej z każdej strony K-7): unikalne stanowiska, bez zachodzenia na hale i na siebie', () => {
  const bays = haloBayLayouts(ring);
  assert.equal(bays.length, HALO_PORT.complexes * HALO_PORT.docks);
  const ids = bays.flatMap((b) => b.berths.map((v) => v.id));
  assert.equal(new Set(ids).size, ids.length);
  const world = (frame, pts) => pts.map(([x, z]) => k7HubToWorld(frame, x, z, {})).map((p) => ({ x: p.x, z: p.y }));
  const rect = (half, z0, z1) => [[-half, z0], [half, z0], [half, z1], [-half, z1]];
  const halls = haloPortComplexAngles().map((a) => {
    const f = k7Frame(ring, a);
    const l = createK7Layout();
    return world(f, rect(l.halfWidth + HALO_PORT.collar + 100, l.backZ, l.bodyEndZ));
  });
  const bayPolys = bays.map((b) => world(b.frame, rect(b.halfWidth + HALO_PORT.sideWall + HALO_PORT.collar, b.floorZ, b.openZ)));
  // po jednej zatoce z każdej strony hali (symetrycznie)
  assert.deepEqual([...HALO_PORT.dockOffsets].sort((a, b) => a - b), [-HALO_PORT.dockOffsets[1], HALO_PORT.dockOffsets[1]]);
  bayPolys.forEach((p, i) => {
    for (const h of halls) assert.ok(!k7ConvexOverlap(p, h), `${bays[i].id} na hali K-7`);
    for (let j = i + 1; j < bayPolys.length; j++) assert.ok(!k7ConvexOverlap(p, bayPolys[j]), `${bays[i].id} × ${bays[j].id}`);
  });
});

test('kadłuby gracza: klasa stanowiska jak NPC ruchu v2 (mieści się w swojej, nie w mniejszej)', () => {
  const pads = {};
  for (const b of [...createK7Layout().berths, ...createBayLayout().berths]) pads[b.size] ??= b;
  const order = ['S', 'M', 'L', 'CAPITAL', 'MEGA'];
  const v2 = { s: 'S', m: 'M', l: 'L', capital: 'CAPITAL', mega: 'MEGA' };
  for (const h of Object.values(HALO_PLAYER_HULLS)) {
    const smallest = order.find((size) => haloHullFits(h, pads[size]));
    assert.ok(smallest, `${h.id} nie mieści się nigdzie`);
    assert.equal(smallest, h.cls, `${h.id}: najmniejsze stanowisko ${smallest}`);
    assert.equal(v2[berthClassForHull(h.id).id], h.cls, `${h.id} ≠ klasa ruchu v2`);
    // obrys kolizji: wypukły, w płaszczyźnie sprite'a
    for (const [u, v] of h.outline) assert.ok(Math.abs(u) <= 0.5 && Math.abs(v) <= 0.5);
  }
});

// Port jak w demie: hale i zatoki w układzie huba hali gracza (wszystkie
// stanowiska wolne — statków NPC ring nie udaje, zajętość da system ruchu).
function makePort() {
  const layouts = haloPortComplexAngles().map((a, i) => {
    const l = createK7Layout();
    if (i > 0) { l.berths[0].occupied = null; l.berths[0].reserved = null; }
    return { index: i, frame: k7Frame(ring, a), layout: l };
  });
  const frame = layouts[0].frame;
  const bays = haloBayLayouts(ring);
  const registry = createPortRegistry({ halls: layouts, bays, frame });
  const collision = buildPortCollision({ registry, frame, ringLayout: ring });
  return { registry, collision, frame, bays };
}

test('rejestr portu: 224 stanowiska, położenie zgodne z ramką zatoki / hali', () => {
  const { registry, frame } = makePort();
  assert.equal(registry.entries.length, 4 * 28 + 8 * 14);
  const q = {};
  for (const e of registry.entries.filter((v) => v.kind === 'bay').slice(0, 21)) {
    const a = k7HubToWorld(e.owner.frame, e.berth.x, e.berth.z, {});
    const b = k7HubToWorld(frame, e.x, e.z, q);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${e.label}: przejście ramek`);
  }
});

test('dokowanie gracza w otwartej zatoce każdym kadłubem: pole STOP → E → sekwencja → obsługa → wycofanie bez kolizji', () => {
  const pick = { megafreighter: 'Z02-MG1', heavy_freighter: 'Z01-MG2', long_haul_freighter: 'Z02-L03', container_ship: 'Z02-M02', inter_station_shuttle: 'Z01-S04' };
  for (const [id, label] of Object.entries(pick)) {
    const { registry, collision } = makePort();
    const h = HALO_PLAYER_HULLS[id];
    const e = registry.entries.find((v) => v.label === label);
    const player = new K7FlightModel(collision, { x: e.x, z: e.z, angle: e.angle }, { w: h.w, h: h.h }, h.outline, h.tune);
    player.locked = false;
    const dock = new PortDocking(registry, player, h);
    assert.equal(collision.test(player.polygon()), null, `${id}: kolizja na polu ${label} (${collision.test(player.polygon())})`);
    const c = dock.candidate();
    assert.equal(c.entry.label, label, `${id}: kandydat ${c.entry.label}`);
    assert.ok(c.ok, `${id}: ${c.reason}`);
    assert.ok(dock.requestDock());
    for (let t = 0; t < 5 * 120; t++) dock.update(1 / 120);
    assert.equal(dock.state, 'DOCKED', `${id}: stan ${dock.state}`);
    assert.equal(e.berth.occupied, 'player');
    assert.ok(dock.action());
    for (let t = 0; t < 5 * 120; t++) dock.update(1 / 120);
    assert.equal(dock.state, 'FREE');
    assert.equal(player.locked, false);
    // wycofanie ciągiem wstecznym (S) — z pola w aleję / pas, bez kolizji
    player.input.retro = 1;
    for (let t = 0; t < 4 * 120; t++) { player.step(1 / 120, 1); dock.update(1 / 120); }
    player.input.retro = 0;
    assert.equal(collision.hits, 0, `${id}: kolizja przy wycofaniu (${collision.lastHit})`);
    assert.ok(Math.hypot(player.x - e.x, player.z - e.z) > 150, `${id}: nie wycofał się`);
  }
});

test('dokowanie: za mały i zajęty kadłub nie dostaje stanowiska; capital K-7 z suwnicą jak w K-7', () => {
  const { registry, collision } = makePort();
  const mega = HALO_PLAYER_HULLS.megafreighter;
  const e = registry.entries.find((v) => v.label === 'C-02');
  const p = new K7FlightModel(collision, { x: e.x, z: e.z, angle: e.angle }, { w: mega.w, h: mega.h }, mega.outline, mega.tune);
  const d = new PortDocking(registry, p, mega);
  assert.equal(d.eligibility(e).reason, 'STANOWISKO ZA MAŁE');
  assert.notEqual(d.candidate().entry.kind, 'k7', 'megafrachtowiec nie mieści się w hali');
  // Atlas na C-02: sekwencja suwnicy 9,3 s
  const atlas = HALO_PLAYER_HULLS.atlas;
  const pa = new K7FlightModel(collision, { x: e.x, z: e.z, angle: e.angle }, { w: atlas.w, h: atlas.h }, atlas.outline, atlas.tune);
  pa.locked = false;
  const da = new PortDocking(registry, pa, atlas);
  assert.ok(da.requestDock());
  for (let t = 0; t < 5 * 120; t++) da.update(1 / 120);
  assert.equal(da.state, 'DOCKING', 'suwnica po 5 s jeszcze pracuje');
  for (let t = 0; t < 5 * 120; t++) da.update(1 / 120);
  assert.equal(da.state, 'DOCKED');
  assert.equal(e.owner.poses.get('C-02').lock, 1);
  // stanowisko zajęte (np. przez statek systemu ruchu)
  const z = registry.entries.find((v) => v.label === 'Z02-MG1');
  z.berth.occupied = 'npc-test';
  const pm = new K7FlightModel(collision, { x: z.x, z: z.z, angle: z.angle }, { w: mega.w, h: mega.h }, mega.outline, mega.tune);
  const dm = new PortDocking(registry, pm, mega);
  assert.equal(dm.eligibility(z).reason, 'STANOWISKO ZAJĘTE');
  assert.notEqual(dm.candidate().entry.label, 'Z02-MG1');
});

test('port bez udawanego życia: wszystkie stanowiska wolne, bez statków NPC w scenie i w kolizjach', async () => {
  const { buildK7Scene } = await import('../src/3d/haloRing/haloPortK7Build.js');
  const { registry, collision } = makePort();
  const taken = registry.entries.filter((e) => e.berth.occupied && e.berth.occupied !== 'player');
  assert.equal(taken.length, 0, `zajęte przez NPC: ${taken.map((e) => e.label).join(', ')}`);
  assert.ok(collision.items.every((it) => !String(it.id).startsWith('npc-')), 'kadłub NPC w kolizjach');
  const f = k7Frame(ring, haloPortComplexAngles()[0]);
  const bays = haloBayLayouts(ring).filter((b) => b.complex === 0).map((b) => ({ layout: b, xf: haloFrameToFrame(b.frame, f) }));
  const s = buildK7Scene(createK7Layout(), { floorZ: f.floorZ, rimZ: f.rimZ, floorR: f.floorR, bays });
  // płaskie wielokąty: pokład, pokład ciemny, fartuchy 3 bram, klin, dach — bez kadłubów NPC
  assert.ok(s.plates.length <= 7, `wielokąty sceny: ${s.plates.length}`);
});

test('scena kompleksu: stanowiska zatok w tych samych instancjach co hala (lampki, napisy, grupy ≤ 40)', async () => {
  const { buildK7Scene } = await import('../src/3d/haloRing/haloPortK7Build.js');
  const f = k7Frame(ring, haloPortComplexAngles()[0]);
  const l = createK7Layout();
  const bays = haloBayLayouts(ring).filter((b) => b.complex === 0).map((b) => ({ layout: b, xf: haloFrameToFrame(b.frame, f) }));
  const s = buildK7Scene(l, { floorZ: f.floorZ, rimZ: f.rimZ, bays });
  const ids = new Set(s.lamps.map((v) => v.berthId));
  for (const b of [...l.berths, ...bays.flatMap((v) => v.layout.berths)]) assert.ok(ids.has(b.id), `brak lampki ${b.id}`);
  assert.equal(s.lamps.length, 28 + 2 * 14);
  assert.ok(s.groups.length + 1 <= 40, `grupy ruchome ${s.groups.length}`);
  for (const b of bays.flatMap((v) => v.layout.berths)) assert.ok(s.labels.some((v) => v.text === b.id), `brak napisu ${b.id}`);
  // instancje zatok leżą w obrysie zatok (hub hali), pod płaszczyzną lotu pokładu
  const q = {};
  for (const { layout: bay, xf } of bays) {
    const c = haloXfPoint(xf, 0, (bay.floorZ + bay.openZ) / 2, q);
    const near = s.sets.bg.box.filter((_, i, a) => i % 16 === 0 && Math.hypot(a[i] - c.x, a[i + 2] - c.z) < 2600);
    assert.ok(near.length > 150, `${bay.id}: mało instancji w zatoce (${near.length})`);
  }
});
