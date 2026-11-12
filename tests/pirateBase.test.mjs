// Baza piratów (misja 1, szkic użytkownika 2026-10-11): układ, bryły, sieć paliwowa, plan misji, kotwice ciał świata.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPirateBaseLayout, pirateBaseShipCorners, pirateBaseChunkAt, PIRATE_BASE_CREWED, PIRATE_BASE_BOSS } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { buildPirateBaseScene, PBASE_BERTH_BITS } from '../src/3d/portBuildings/pirateBaseScene.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS } from '../src/3d/portBuildings/portBuildingScene.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { chunkPlanarSolids, chunkSolids } from '../src/3d/portBuildings/buildingChunkSolids.js';
import { planFuelChain } from '../src/game/story/pirateBaseFuel.js';
import { placePirateBase, planPirateBase } from '../src/game/story/pirateBaseSite.js';
import { pirateBaseChunkRaster, pirateBasePinTest } from '../src/game/story/pirateBaseBodies.js';
import { dryDockSegmentHit } from '../src/game/story/shipyardLayout.js';

const L = createPirateBaseLayout();
const SCENE = buildPirateBaseScene(L, resolvePortBuildingStyle('pirate'));

// SAT dla wielokątów wypukłych (x, z), `pad` — zapas
const axes = (p) => p.map((a, i) => { const b = p[(i + 1) % p.length]; const ex = b.x - a.x; const ez = b.z - a.z; const l = Math.hypot(ex, ez) || 1; return { x: -ez / l, z: ex / l }; });
const proj = (p, ax) => { let mn = Infinity; let mx = -Infinity; for (const v of p) { const d = v.x * ax.x + v.z * ax.z; if (d < mn) mn = d; if (d > mx) mx = d; } return [mn, mx]; };
const overlap = (A, B, pad = 0) => { for (const ax of [...axes(A), ...axes(B)]) { const [a0, a1] = proj(A, ax); const [b0, b1] = proj(B, ax); if (a1 + pad < b0 || b1 + pad < a0) return false; } return true; };

test('dryDockSegmentHit: najbliższa bryła mimo kolejności, skip, punkt na licu, start w bryle, pudło', () => {
  const box = (chunk, x0, y0, x1, y1) => ({ chunk, x0, y0, x1, y1, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
  const far = box('daleko', 300, -50, 400, 50);
  const near = box('blisko', 100, -50, 200, 50);
  // dalsza bryła pierwsza na liście: wygrywa i tak najbliższe wejście
  const hit = dryDockSegmentHit([far, near], 0, 0, 500, 0);
  assert.equal(hit.chunk, 'blisko');
  assert.ok(Math.abs(hit.x - 100) < 1e-9 && Math.abs(hit.y) < 1e-9, 'punkt wejścia na licu');
  assert.ok(Math.abs(hit.t - 0.2) < 1e-9);
  // kawałka już nie ma: pocisk leci do następnego
  const next = dryDockSegmentHit([far, near], 0, 0, 500, 0, {}, new Set(['blisko']));
  assert.equal(next.chunk, 'daleko');
  assert.ok(Math.abs(next.x - 300) < 1e-9);
  // start w bryle: trafienie w t = 0, także gdy dalej leży druga bryła
  const inside = dryDockSegmentHit([far, near], 150, 0, 500, 0);
  assert.equal(inside.chunk, 'blisko');
  assert.equal(inside.t, 0);
  assert.equal(inside.x, 150);
  // pudła: obok brył, odcinek za krótki, wynik w podanym obiekcie
  assert.equal(dryDockSegmentHit([far, near], 0, 60, 500, 60), null);
  assert.equal(dryDockSegmentHit([far, near], 0, 0, 90, 0), null);
  const out = {};
  assert.equal(dryDockSegmentHit([near], 0, 0, 500, 0, out), out);
});

test('miasto habitatu (2026-11-11): wieżowce na siatce wokseli, każdy osobnym kawałkiem z własną bryłą trafień, ulica między nimi wolna', () => {
  const place = placePirateBase({ x: 0, y: 0 }, 0);
  const H = L.habitat;
  const G = L.spec.city.grid;
  assert.equal(H.buildings.length, 24);
  const boxOf = (b) => { const hx = (b.ux ? b.w : b.d) / 2, hz = (b.ux ? b.d : b.w) / 2; return { x0: b.x - hx, x1: b.x + hx, z0: b.z - hz, z1: b.z + hz }; };
  for (const qd of H.quadrants) {
    const mine = H.buildings.filter((b) => b.quadrant === qd.id);
    assert.equal(mine.length, 6, `${qd.id}: sześć wieżowców w dzielnicy`);
    assert.equal(mine.filter((b) => b.ring === 0).length, 3, `${qd.id}: trzy w pierścieniu wewnętrznym`);
    assert.ok(!L.chunkById.has(qd.id), `${qd.id}: dzielnica nie jest kawałkiem`);
  }
  // każdy wieżowiec = kawałek habitatu (jak dawne wieżowce na pomostach): własna bryła trafień, nie duch
  for (const b of H.buildings) {
    const c = L.chunkById.get(b.id);
    assert.ok(c && c.kind === 'highrise' && c.structure === 'habitat' && !c.ghost, `${b.id}: kawałek`);
    assert.equal(b.chunk, b.id);
    const shapes = place.hitShapes.filter((h) => h.chunk === b.id);
    assert.equal(shapes.length, 1, `${b.id}: jedna bryła trafień`);
    assert.equal(shapes[0].pts.length, 4);
  }
  for (const b of H.buildings) {
    const q = boxOf(b);
    // boki na siatce komórek wokseli (ściana komórki = wielokrotność G przesunięta o pół komórki)
    for (const v of [q.x0, q.x1, q.z0, q.z1]) assert.ok(Math.abs((v / G - 0.5) - Math.round(v / G - 0.5)) < 1e-9, `${b.id}: bok ${v} na siatce`);
    // poza podstawą wieży i cokołem, w obrębie miasta
    const near = Math.hypot(Math.max(q.x0, Math.min(0, q.x1)), Math.max(q.z0, Math.min(0, q.z1)));
    assert.ok(near > H.stemR + 40, `${b.id}: ${near} od osi`);
    for (const [x, z] of [[q.x0, q.z0], [q.x1, q.z0], [q.x1, q.z1], [q.x0, q.z1]]) assert.ok(Math.hypot(x, z) <= H.drumR, `${b.id}: róg w mieście`);
    // podstawa tuż pod płaszczyzną gry (y 116): statek i pociski tną wieżowiec nisko, prawie cała bryła jest nad cięciem
    assert.ok(b.baseY < -150 && b.baseY > -450 && b.roofY > b.fgY + 600, `${b.id}: podstawa ${b.baseY}, dach ${b.roofY}`);
    assert.ok((b.roofY - 116) > 3 * (116 - b.baseY), `${b.id}: nad płaszczyzną ponad trzy razy więcej niż pod nią`);
  }
  for (let i = 0; i < H.buildings.length; i++) for (let j = i + 1; j < H.buildings.length; j++) {
    const a = boxOf(H.buildings[i]), b = boxOf(H.buildings[j]);
    const gap = Math.max(Math.max(a.x0 - b.x1, b.x0 - a.x1), Math.max(a.z0 - b.z1, b.z0 - a.z1));
    assert.ok(gap >= G, `${H.buildings[i].id} × ${H.buildings[j].id}: odstęp ${gap}`);
  }
  // odcinek z zewnątrz do środka wieżowca trafia jego ćwiartkę na ścianie; krótki odcinek na placu przy wieży — nic
  const habShapes = place.hitShapes.filter((h) => h.structure === 'habitat');
  for (const b of H.buildings) {
    const g = place.toGame(b.x, b.z, {});
    const o = place.toGame(b.x * 2.2, b.z * 2.2, {});
    const hit = dryDockSegmentHit(habShapes, o.x, o.y, g.x, g.y);
    assert.ok(hit && hit.chunk.startsWith('B-'), `${b.id}: trafienie w wieżowiec`);
  }
  const r = (H.coreR + H.stemR) / 2;
  const p0 = place.toGame(r, -60, {}), p1 = place.toGame(r, 60, {});
  assert.equal(dryDockSegmentHit(habShapes, p0.x, p0.y, p1.x, p1.y), null, 'plac przy wieży wolny');
});

test('wieża zasłonięta z każdej strony: strzał z zewnątrz w podstawę wieży zawsze przechodzi przez wieżowiec', () => {
  const place = placePirateBase({ x: 0, y: 0 }, 0);
  const H = L.habitat;
  const city = place.hitShapes.filter((h) => h.structure === 'habitat' && h.chunk !== 'H-C');
  let open = 0;
  for (let ai = 0; ai < 720; ai++) {
    const a = (ai / 720) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let oi = -12; oi <= 12; oi++) {
      const off = (oi / 12) * H.coreR * 0.98;
      const t = Math.sqrt(H.coreR * H.coreR - off * off);
      const s = place.toGame(-dz * off - dx * 4000, dx * off - dz * 4000, {});
      const e = place.toGame(-dz * off - dx * t, dx * off - dz * t, {});
      if (!dryDockSegmentHit(city, s.x, s.y, e.x, e.y)) open++;
    }
  }
  assert.equal(open, 0, `${open} torów do wieży bez wieżowca po drodze`);
});

test('układ bazy: kawałki w limicie grup, budowle, stanowiska z załogą i herszt', () => {
  assert.ok(L.chunks.length + 1 <= PB_MAX_GROUPS, `${L.chunks.length} kawałków`);
  const all = Object.values(L.structures).flat();
  assert.equal(all.length, L.chunks.length, 'każdy kawałek należy do jednej budowli');
  assert.deepEqual(Object.keys(L.structures).sort(), ['antigrav1', 'antigrav2', 'fuel', 'habitat', 'piers', 'warehouse']);
  assert.equal(L.berths.length, 48);
  assert.ok(L.berths.length <= 2 * PBASE_BERTH_BITS, 'lampki stanowisk mieszczą się w dwóch kanałach');
  assert.equal(L.berths.filter((b) => b.crew && !b.boss).length, PIRATE_BASE_CREWED.length);
  const boss = L.berths.find((b) => b.boss);
  assert.equal(boss.id, PIRATE_BASE_BOSS);
  assert.equal(boss.cls, 'supercapital');
  assert.equal(L.berths.filter((b) => b.supercap).length, 3, 'trzy supercapitale w zatoce');
  for (const b of L.berths) assert.equal(L.chunkById.get(b.chunk)?.kind, 'pier', `${b.id} przy pomoście`);
  for (const h of L.hitSolids) assert.ok(L.chunkById.has(h.chunk), h.id);
  assert.equal(L.ram.berths.length, 9, 'rząd do taranu: zewnętrzna strona poprzeczki T (4 + 5)');
  assert.ok(L.ram.berths.every((id) => L.berthById.get(id).crew), 'rząd do taranu: same okręty z załogą');
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
        assert.ok(s.poly.every((v) => Math.hypot(v.x, v.z) > L.habitat.drumR + 40), `${s.b.id} × miasto`);
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
    const n = c.ghost ? chunkSolids(L, SCENE, [c.id]).length : chunkPlanarSolids(L, SCENE, [c.id], { band: 4 }).length;
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

test('reaktory antygrawitacyjne (2026-11-11, w miejscu wieżowców): osobne budowle okrakiem nad pomostem, poza torem taranu i trasami wyjazdu ze stanowisk', () => {
  assert.equal(L.antigravs.length, 2);
  const rect = (ax, az, bx, bz, half) => {
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / l * half, nz = (bx - ax) / l * half;
    return [{ x: ax + nx, z: az + nz }, { x: bx + nx, z: bz + nz }, { x: bx - nx, z: bz - nz }, { x: ax - nx, z: az - nz }];
  };
  const ram = rect(L.ram.start.x, L.ram.start.z, L.ram.end.x, L.ram.end.z, 403 + 100);   // Atlas (szer. 806) + zapas
  for (const h of L.antigravs) {
    assert.deepEqual(L.structures[h.structure], [h.chunk], `${h.structure}: jeden kawałek`);
    const c = L.chunkById.get(h.chunk);
    assert.equal(c.kind, 'antigrav');
    assert.ok(!c.ghost);
    const poly = L.hitSolids.find((s) => s.chunk === h.chunk)?.poly;
    assert.ok(poly, `${h.chunk}: bryła trafień`);
    // środek na osi pomostu, pudło między stanowiskami (wzdłuż pomostu)
    const p = L.piers.find((q) => q.id === h.pier);
    assert.ok(Math.abs((h.x - p.ax) * p.nx + (h.z - p.az) * p.nz) < 1e-6, `${h.chunk} na osi pomostu`);
    for (const b of L.berths.filter((q) => q.pier === h.pier)) assert.ok(Math.abs(b.s - h.s) >= h.w / 2 + b.beam / 2 + 20, `${h.chunk} × ${b.id}`);
    assert.ok(!overlap(poly, ram), `${h.chunk} × tor taranu`);
    // wyjazd rufą ze stanowiska (kierunek out, korytarz szerokości okrętu) omija wieżowiec
    for (const b of L.berths) {
      const a = { x: b.x, z: b.z };
      const e = { x: b.x + b.out.x * (b.length + 2600), z: b.z + b.out.z * (b.length + 2600) };
      assert.ok(!overlap(poly, rect(a.x, a.z, e.x, e.z, b.beam / 2), 10), `${h.chunk} × wyjazd ${b.id}`);
    }
    // pierścień pola i dzwon emitera mieszczą się nad / pod obudową z zapasem na pomost
    assert.ok(h.ringR + 40 <= Math.max(h.w, h.d) / 2 + 80 && h.bellR <= h.d / 2, `${h.chunk}: pierścień i dzwon`);
    {
    }
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
