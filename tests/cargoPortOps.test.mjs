// Kontenery i drony przeładunkowe (Z5, plan ruchu v2 § 3.4): dane ładowni,
// reguła rodzin, liczba kontenerów i bezstanowy przeładunek przy stanowisku.
// Czysta logika, bez GPU. node --test tests/cargoPortOps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { RESOURCES, RESOURCE_KEYS, CATEGORY } from '../src/data/resources.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { VAN_CLASSES } from '../src/game/cargoFleet.js';
import { hullForVanClass } from '../src/game/traffic/transportCompanies.js';
import {
  CARGO_HOLD_LAYOUTS,
  CONTAINER_FAMILY,
  allocateCargoContainers,
  cargoContainerCount,
  cargoDeckFill,
  cargoFillOrder,
  cargoHoldLayout,
  cargoHoldSlots,
  cargoLayoutScale,
  cargoResourceIndex,
  cargoUnitSize,
  containerFamilyOf,
  containerLook,
  isHazmatCargo
} from '../src/data/cargoContainers.js';
import {
  CARGO_DRONE,
  CARGO_DRONE_STRIDE,
  CARGO_LOOSE,
  CARGO_LOOSE_STRIDE,
  CARGO_MODE,
  CARGO_PORT,
  berthLocalPoint,
  cargoBerthGeometry,
  cargoDeckMask,
  cargoHullExtent,
  cargoTransferPlan,
  cargoTransferWindow,
  createTransferState,
  planCargoTransfer,
  transferState
} from '../src/game/cargoPortOps.js';
import { createBayLayout, haloBayLayouts } from '../src/3d/haloRing/haloPortBays.js';
import { createK7Layout, k7Frame, k7HeadingToWorld, k7HubToWorld } from '../src/3d/haloRing/haloPortK7Layout.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';

const bay = createBayLayout({ index: 1 });
const berthOf = (size, side = 1) => bay.berths.find((b) => b.size === size && (b.side ?? 1) === side);
const CAP = Object.fromEntries(VAN_CLASSES.map((c) => [hullForVanClass(c.id), c.capacity]));

function ctxFor(layoutId, mode, { size = null, cargo = null, seed = 11, win = null } = {}) {
  const lay = cargoHoldLayout(layoutId);
  const berthSize = size || ({ inter_station_shuttle: 'S', container_ship: 'M', long_haul_freighter: 'L', heavy_freighter: 'MEGA', megafreighter: 'MEGA' }[layoutId]);
  const berth = berthOf(berthSize, -1) || berthOf(berthSize, 1);
  const cap = CAP[layoutId] || 900;
  return {
    seed,
    layoutId,
    cargo: cargo || { iron_ore: cap * 0.5, chips: cap * 0.2, helium3: cap * 0.15 },
    capacity: cap,
    mode,
    window: win || cargoTransferWindow({ seconds: mode === CARGO_MODE.LOAD ? 90 : 120, moveSeconds: 20 }),
    berth: cargoBerthGeometry(berth, cargoHullExtent(lay))
  };
}

// ---------------------------------------------------------------------------
// Dane

test('forma i rodzina: gazy/ciecze w zbiornikach, tanie sypkie w zsypach, reszta standard; hazmat = pręty i amunicja', () => {
  for (const id of RESOURCE_KEYS) {
    assert.ok(['solid', 'liquid', 'gas'].includes(RESOURCES[id].form), `${id}: form`);
  }
  const expect = {
    helium3: 'tank', methane: 'tank', ammonia: 'tank', hydrogen: 'tank', oxygen: 'tank', coolant: 'tank', fusion_fuel: 'tank',
    iron_ore: 'hopper', ice: 'hopper', scrap: 'hopper', steel: 'hopper', uranium_ore: 'hopper', polymer: 'hopper',
    titan_alloy: 'standard', chips: 'standard', hull_plate: 'standard', fuel_rods: 'standard', ammo_kinetic: 'standard'
  };
  for (const [id, fam] of Object.entries(expect)) assert.equal(containerFamilyOf(id), fam, id);
  // Reguła wprost z danych (plan § 3.4).
  for (const id of RESOURCE_KEYS) {
    const d = RESOURCES[id];
    const fam = d.form !== 'solid' ? 'tank' : (d.unit === 't' && d.value < 40 ? 'hopper' : 'standard');
    assert.equal(containerFamilyOf(id), fam, `${id}: reguła`);
    assert.equal(isHazmatCargo(id), id === 'fuel_rods' || d.category === CATEGORY.ORDNANCE, `${id}: hazmat`);
  }
  assert.ok(Object.values(CONTAINER_FAMILY).every((f) => RESOURCE_KEYS.some((id) => containerFamilyOf(id) === f)), 'każda rodzina ma towar');
  // Wygląd: ten sam kontener (ziarno kursu, slot) wygląda tak samo; hazmat żółty.
  assert.deepEqual(containerLook('chips', 7, 3), containerLook('chips', 7, 3));
  assert.equal(containerLook('ammo_kinetic', 1, 1).paint, containerLook('fuel_rods', 9, 4).paint);
});

test('układy ładowni: liczby slotów z pustych pokładów, sloty w płótnie i w sylwetce, bez nakładania', () => {
  const expect = { inter_station_shuttle: 8, container_ship: 18, long_haul_freighter: 28, heavy_freighter: 48, megafreighter: 20, megafreighter_wagon: 32 };
  for (const [id, n] of Object.entries(expect)) {
    const L = CARGO_HOLD_LAYOUTS[id];
    const slots = cargoHoldSlots(L);
    assert.equal(slots.length, n, id);
    for (const s of slots) {
      const x0 = s.x - s.w / 2 + L.png.w / 2;
      const y0 = s.y - s.h / 2 + L.png.h / 2;
      assert.ok(x0 >= L.hull.x0 && x0 + s.w <= L.hull.x1 && y0 >= L.hull.y0 && y0 + s.h <= L.hull.y1, `${id}#${s.index} poza sylwetką`);
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.5;
        assert.ok(!overlap, `${id}: sloty ${i} i ${j} zachodzą`);
      }
    }
    const u = cargoUnitSize(L);
    assert.ok(u.L > 0 && u.W > 0 && u.H > 0 && u.L <= L.grid.w * cargoLayoutScale(L), id);
  }
  // Pusty i stary sprite mają to samo płótno (sloty wspólne) — ścieżki podane.
  for (const L of Object.values(CARGO_HOLD_LAYOUTS)) assert.ok(L.sprite.empty.includes('_empty') && L.sprite.painted, L.hullId);
});

test('skala układów = rozmiar renderu kadłuba gry; każda klasa ładowni ruchu ma układ', () => {
  for (const cls of VAN_CLASSES) {
    const hullId = hullForVanClass(cls.id);
    const L = cargoHoldLayout(hullId);
    assert.ok(L, `${cls.id} → ${hullId}: brak układu ładowni`);
    assert.equal(L.vanClass, cls.id, hullId);
    const r = getHullRenderSize(hullId, L.png.w, L.png.h);
    assert.equal(r.w, L.renderLength, `${hullId}: renderLength ${L.renderLength} vs gra ${r.w}`);
  }
});

test('liczba kontenerów = ceil(sloty × masa / ładownia), podział między surowce sumuje się', () => {
  assert.equal(cargoContainerCount(18, 160, 160), 18);
  assert.equal(cargoContainerCount(18, 80, 160), 9);
  assert.equal(cargoContainerCount(18, 80.1, 160), 10);
  assert.equal(cargoContainerCount(18, 0.01, 160), 1);
  assert.equal(cargoContainerCount(18, 0, 160), 0);
  assert.equal(cargoContainerCount(18, 999, 160), 18);
  const alloc = allocateCargoContainers({ iron_ore: 100, steel: 40, chips: 5 }, 18, 160);
  assert.equal(alloc.reduce((s, a) => s + a.count, 0), cargoContainerCount(18, 145, 160));
  assert.ok(alloc.every((a) => a.count >= 1));
  // Mniej kontenerów niż surowców: nie więcej niż liczba.
  const tiny = allocateCargoContainers({ iron_ore: 1, steel: 1, chips: 1 }, 18, 160);
  assert.equal(tiny.reduce((s, a) => s + a.count, 0), 1);
  // Pokład: grupy surowców w kolejności zapełniania, od środka ładowni.
  const fill = cargoDeckFill('container_ship', { iron_ore: 60, steel: 30 }, 160);
  assert.equal(fill.count, cargoContainerCount(18, 90, 160));
  const order = cargoFillOrder('container_ship');
  const seq = [...order].map((s) => fill.slots[s]).filter((r) => r >= 0);
  assert.deepEqual(seq, [...seq].sort((a, b) => seq.indexOf(a) - seq.indexOf(b)), 'surowce grupami');
  assert.equal(seq[0], cargoResourceIndex('iron_ore'));
  const slots = cargoHoldSlots('container_ship');
  const cx = slots.reduce((s, x) => s + x.x, 0) / slots.length;
  assert.ok(Math.abs(slots[order[0]].x - cx) <= Math.abs(slots[order[order.length - 1]].x - cx), 'od środka na zewnątrz');
});

// ---------------------------------------------------------------------------
// Geometria stanowiska

test('układ stanowiska (u, v) ma skrętność świata gry: punkt zatoki przez hub = przez pozę statku', () => {
  const ring = createHaloRingLayout({});
  const bays = haloBayLayouts({ radii: ring.radii });
  for (const l of bays.slice(0, 4)) {
    for (const b of l.berths.filter((x) => x.servicePoint)) {
      const q = berthLocalPoint(b, b.servicePoint.x, b.servicePoint.z, {});
      // Świat sceny z huba zatoki, potem świat gry (y w dół).
      const sp = k7HubToWorld(l.frame, b.servicePoint.x, b.servicePoint.z, {});
      const c0 = k7HubToWorld(l.frame, b.x, b.z, {});
      const psi = -k7HeadingToWorld(l.frame, b.angle);
      const gx = c0.x + q.u * Math.cos(psi) - q.v * Math.sin(psi);
      const gy = -c0.y + q.u * Math.sin(psi) + q.v * Math.cos(psi);
      assert.ok(Math.abs(gx - sp.x) < 1e-6 && Math.abs(gy + sp.y) < 1e-6, `${b.id}: (${gx}, ${gy}) vs (${sp.x}, ${-sp.y})`);
      // Słupek serwisowy przed dziobem, gniazdo na jego szczycie.
      assert.ok(q.u > b.padLength / 2, `${b.id}: słupek za dziobem`);
    }
  }
  assert.ok(Math.abs(CARGO_PORT.postZ - 17.64) < 0.01);
  assert.ok(Math.abs(CARGO_PORT.spineZ + 96) < 1e-9);
});

test('geometria przeładunku: gniazda i place dla grzebieni zatok, pasów MEGA, banków i stanowisk capital K-7', () => {
  const k7 = createK7Layout();
  const all = [...bay.berths, ...k7.berths];
  for (const b of all) {
    const hull = { halfBeam: Math.min(b.maxBeam, b.padBeam) * 0.3 };
    const g = cargoBerthGeometry(b, hull);
    assert.ok(g.nests.length >= 1, `${b.id}: gniazdo`);
    assert.ok(g.yards.length >= 1, `${b.id}: plac`);
    for (const y of g.yards) {
      assert.ok(Math.min(Math.abs(y.v0), Math.abs(y.v1)) >= hull.halfBeam, `${b.id}: plac pod kadłubem`);
      assert.ok(y.u1 > y.u0 && y.v1 > y.v0, `${b.id}: pusty plac`);
    }
  }
  // MEGA: gniazda na grzbiecie 725 j. od osi pasa, po stronie grzebienia.
  const mega = cargoBerthGeometry(berthOf('MEGA', 1), { halfBeam: 456 });
  for (const n of mega.nests) assert.ok(Math.abs(Math.abs(n.v) - 725) < 1e-6 && n.z === CARGO_PORT.spineZ);
  // Okno: klamra 4,6 s, suwnica 9,3 s, postój minus dojście.
  assert.deepEqual(cargoTransferWindow({ seconds: 90, moveSeconds: 20 }), { start: 4.6, end: 70 });
  assert.ok(Math.abs(cargoTransferWindow({ seconds: 120, moveSeconds: 0, fuel: true }).start - 7.0) < 1e-9, 'capital K-7: ustawienie 1,1 s + obsługa paliwowa 5,9 s');
});

// ---------------------------------------------------------------------------
// Przeładunek

function sweep(plan, from, to, dt, fn) {
  const st = createTransferState(plan);
  for (let t = from; t <= to + 1e-9; t += dt) fn(transferState(plan, t, st), t);
}

test('bez stanu: ten sam stan dla tego samego t niezależnie od kolejności odczytów i od odtworzenia planu', () => {
  for (const mode of [CARGO_MODE.UNLOAD, CARGO_MODE.LOAD]) {
    const ctx = ctxFor('long_haul_freighter', mode);
    const a = planCargoTransfer(ctx);
    const b = planCargoTransfer({ ...ctx });
    const sa = createTransferState(a);
    const sb = createTransferState(b);
    const times = [];
    for (let t = -2; t < 110; t += 0.37) times.push(t);
    const shuffled = times.slice().sort((x, y) => Math.sin(x * 12.9898) - Math.sin(y * 12.9898));
    const snap = (s) => JSON.stringify([s.onboard, s.carriedCount, s.yardCount, s.droneCount, [...s.slotRes],
      [...s.drones.subarray(0, s.droneCount * CARGO_DRONE_STRIDE)].map((v) => Math.round(v * 1000)),
      [...s.yard.subarray(0, s.yardCount * CARGO_LOOSE_STRIDE)].map((v) => Math.round(v * 1000))]);
    const seen = new Map();
    for (const t of times) seen.set(t, snap(transferState(a, t, sa)));
    for (const t of shuffled) assert.equal(snap(transferState(b, t, sb)), seen.get(t), `${mode} t=${t}`);
  }
});

test('rozładunek: pokład maleje do zera w oknie, kontenery nie giną ani się nie mnożą, drony wracają do gniazda', () => {
  for (const id of ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter']) {
    const ctx = ctxFor(id, CARGO_MODE.UNLOAD);
    const plan = planCargoTransfer(ctx);
    assert.ok(plan.N > 0 && plan.D >= 1, id);
    let prev = Infinity;
    let maxYard = 0;
    sweep(plan, 0, plan.window.end + 40, 0.25, (st, t) => {
      assert.ok(st.onboard <= prev, `${id}: pokład rośnie przy t=${t}`);
      prev = st.onboard;
      assert.ok(st.carriedCount <= plan.D && st.carriedCount <= st.droneCount, `${id}: niesione bez drona`);
      let released = 0;
      for (let i = 0; i < plan.jobs.n; i++) if (plan.jobs.tRelease[i] <= t) released++;
      assert.equal(st.onboard + st.carriedCount + released, plan.N, `${id}: bilans kontenerów przy t=${t}`);
      assert.ok(st.yardCount <= released, `${id}: plac większy niż odłożone`);
      if (t < plan.window.start) assert.equal(st.onboard, plan.N);
      maxYard = Math.max(maxYard, st.yardCount);
    });
    const end = transferState(plan, plan.window.end);
    assert.equal(end.onboard, 0, `${id}: nie rozładowany w oknie`);
    assert.equal(end.carriedCount, 0, id);
    assert.ok(Math.max(...plan.jobs.tRelease) <= plan.window.end - CARGO_PORT.endMargin + 1e-6, `${id}: odłożenie po oknie`);
    assert.ok(maxYard > 0, `${id}: plac nigdy nie widział kontenera`);
    const late = transferState(plan, plan.window.end + 60);
    assert.equal(late.droneCount, 0, `${id}: drony nie wróciły`);
    assert.equal(late.yardCount, 0, `${id}: plac nie opustoszał (winda)`);
  }
});

test('załadunek: pokład rośnie do pełnej obsady kursu, plac startuje windą, nie przed dokowaniem', () => {
  for (const id of ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter']) {
    const ctx = ctxFor(id, CARGO_MODE.LOAD);
    const plan = planCargoTransfer(ctx);
    let prev = -1;
    sweep(plan, 0, plan.window.end + 5, 0.25, (st, t) => {
      assert.ok(st.onboard >= prev, `${id}: pokład maleje przy t=${t}`);
      prev = st.onboard;
    });
    const at0 = transferState(plan, 0);
    assert.equal(at0.onboard, 0);
    assert.equal(at0.yardCount, 0, `${id}: kontenery na placu przed wyjazdem windy`);
    const end = transferState(plan, plan.window.end);
    const fill = cargoDeckFill(id, ctx.cargo, ctx.capacity);
    assert.deepEqual([...end.slotRes], [...fill.slots], `${id}: końcowy pokład ≠ obsada kursu`);
    assert.equal(end.yardCount, 0, `${id}: coś zostało na placu`);
  }
});

test('drony: pod płaszczyzną lotu tylko poza sylwetką kadłuba; nad pokładem statku na wysokości przelotu albo nad slotem', () => {
  for (const id of ['container_ship', 'long_haul_freighter', 'megafreighter']) {
    for (const mode of [CARGO_MODE.UNLOAD, CARGO_MODE.LOAD]) {
      const ctx = ctxFor(id, mode);
      const plan = planCargoTransfer(ctx);
      const ext = cargoHullExtent(plan.layout, plan.scale);
      const slots = cargoHoldSlots(plan.layout);
      sweep(plan, 0, plan.window.end + 30, 0.1, (st, t) => {
        for (let i = 0; i < st.droneCount; i++) {
          const o = i * CARGO_DRONE_STRIDE;
          const u = st.drones[o + CARGO_DRONE.U];
          const v = st.drones[o + CARGO_DRONE.V];
          const z = st.drones[o + CARGO_DRONE.Z];
          const inside = Math.abs(u) < ext.halfLength - 2 && Math.abs(v) < ext.halfBeam - 2;
          if (z < -1) assert.ok(!inside, `${id}/${mode}: dron pod kadłubem (u ${u.toFixed(0)}, v ${v.toFixed(0)}, z ${z.toFixed(0)}) t=${t.toFixed(1)}`);
          // (stan w Float32Array — tolerancja ułamka jednostki)
          if (inside && z < plan.cruise - 1e-3) {
            const onSlot = slots.some((s) => Math.abs(s.x * plan.scale - u) < 0.5 && Math.abs(s.y * plan.scale - v) < 0.5);
            assert.ok(onSlot, `${id}/${mode}: dron nisko nad pokładem poza slotem t=${t.toFixed(1)}`);
          }
        }
      });
    }
  }
});

test('odlot gracza przed końcem okna: zero nowych chwytów, rozpoczęte dokończone albo zwrócone, drony w gnieździe', () => {
  // Rozładunek: kontener w powietrzu trafia na plac, reszta zostaje na pokładzie.
  {
    const ctx = ctxFor('container_ship', CARGO_MODE.UNLOAD);
    const base = planCargoTransfer(ctx);
    const ta = (base.window.start + base.window.end) * 0.45;
    const ctxA = { ...ctx, abortAt: ta };
    const plan = cargoTransferPlan(ctxA);
    const before = transferState(plan, ta - 1e-6);
    const onboardAtAbort = transferState(base, ta).onboard;
    let prev = before.onboard;
    sweep(plan, ta, ta + 60, 0.2, (st, t) => {
      assert.ok(st.onboard <= prev, `pokład rośnie po odlocie t=${t}`);
      prev = st.onboard;
      assert.ok(st.onboard >= onboardAtAbort, `nowe zdjęcia po odlocie t=${t}`);
    });
    const after = transferState(plan, ta + 60);
    assert.equal(after.droneCount, 0, 'drony nie wróciły po odlocie');
    assert.equal(after.carriedCount, 0);
    assert.equal(after.onboard, onboardAtAbort, 'pokład po odlocie = stan w chwili odlotu');
  }
  // Załadunek: niesiony kontener wraca na plac, a plac zjeżdża windą.
  {
    const ctx = ctxFor('long_haul_freighter', CARGO_MODE.LOAD);
    const base = planCargoTransfer(ctx);
    let ta = 0;
    sweep(base, base.window.start, base.window.end, 0.2, (st, t) => { if (!ta && st.carriedCount > 0 && t > base.window.start + 8) ta = t; });
    assert.ok(ta > 0, 'nie znalazłem chwili z kontenerem w powietrzu');
    const plan = cargoTransferPlan({ ...ctx, abortAt: ta });
    const onboardAtAbort = transferState(base, ta).onboard;
    const late = transferState(plan, ta + 80);
    assert.equal(late.onboard, onboardAtAbort, 'załadunek po odlocie');
    assert.equal(late.droneCount, 0);
    assert.equal(late.yardCount, 0, 'plac nie zjechał po odlocie');
    const soon = transferState(plan, ta + 0.5);
    assert.ok(soon.carriedCount > 0, 'kontener w powietrzu zniknął w chwili odlotu');
  }
});

test('materializacja w połowie postoju: stan od razu z planu (bez historii), plan z pamięci podręcznej per kontekst', () => {
  const ctx = ctxFor('container_ship', CARGO_MODE.UNLOAD, { seed: 99 });
  const a = cargoTransferPlan(ctx);
  assert.equal(cargoTransferPlan(ctx), a, 'ten sam obiekt kontekstu → ten sam plan');
  const mid = (a.window.start + a.window.end) / 2;
  const fresh = transferState(planCargoTransfer({ ...ctx }), mid);
  const cached = transferState(a, mid);
  assert.deepEqual([...fresh.slotRes], [...cached.slotRes]);
  assert.ok(fresh.onboard > 0 && fresh.onboard < a.N, 'w połowie postoju pokład częściowo rozładowany');
});

test('maska pokładu z uszkodzeń: sloty nad wyrwą w kadłubie znikają, reszta stoi', () => {
  const pose = { x: 1000, y: -500, angle: 0.9 };
  const scale = cargoLayoutScale('long_haul_freighter');
  const slots = cargoHoldSlots('long_haul_freighter');
  const hole = slots[5];
  // Wyrwa: koło wokół środka slotu 5 (świat gry), promień ~ bok slotu.
  const hx = pose.x + hole.x * scale * Math.cos(pose.angle) - hole.y * scale * Math.sin(pose.angle);
  const hy = pose.y + hole.x * scale * Math.sin(pose.angle) + hole.y * scale * Math.cos(pose.angle);
  const r = hole.w * scale * 0.9;
  const mask = cargoDeckMask('long_haul_freighter', pose, (x, y) => Math.hypot(x - hx, y - hy) > r);
  assert.equal(mask[5], 0, 'slot nad wyrwą');
  assert.ok(mask.reduce((a, b) => a + b, 0) >= slots.length - 4, 'wyrwa zabiera tylko sąsiadów');
  assert.ok([...cargoDeckMask('long_haul_freighter', pose, () => true)].every((v) => v === 1));
  assert.ok([...cargoDeckMask('long_haul_freighter', pose, () => false)].every((v) => v === 0));
});

test('koszt: plan w milisekundach, odczyt stanu w mikrosekundach', () => {
  const ctxs = ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter']
    .flatMap((id) => [ctxFor(id, CARGO_MODE.UNLOAD, { seed: 3 }), ctxFor(id, CARGO_MODE.LOAD, { seed: 4 })]);
  for (const c of ctxs) planCargoTransfer(c);
  const t0 = performance.now();
  const plans = ctxs.map((c) => planCargoTransfer({ ...c, seed: c.seed + 1 }));
  const planMs = (performance.now() - t0) / plans.length;
  const st = createTransferState(null);
  const t1 = performance.now();
  let n = 0;
  for (let rep = 0; rep < 20; rep++) for (const p of plans) { transferState(p, 10 + rep * 3, st); n++; }
  const readUs = (performance.now() - t1) / n * 1000;
  assert.ok(planMs < 25, `plan ${planMs.toFixed(2)} ms`);
  assert.ok(readUs < 200, `odczyt ${readUs.toFixed(1)} µs`);
});
