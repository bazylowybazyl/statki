import test from 'node:test';
import assert from 'node:assert/strict';

import { EngineSlotKeyInternals } from '../src/3d/engineVfxSystem.js';

// EngineVfxSystem.update liczy sloty dysz i ich klucz tekstowy tylko wtedy, gdy
// zmieni się odcisk wejść (slotInputHash). Warunek poprawności: każda zmiana
// klucza musi zmienić odcisk — inaczej dysze zostałyby w starym układzie.
const { buildSlots, makeSlotKey, slotInputHash } = EngineSlotKeyInternals;
const keyOf = (entity) => makeSlotKey(buildSlots(entity));

let seed = 20260927;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const ODD_VALUES = [0, -0, 1, -1, 12.5, 12.504, 12.5049, 90, 180, 270, -45, 45, 1e-7, NaN, Infinity, undefined, null, '12.5', '', 'abc', 360.2];
const value = () => (rnd() < 0.7 ? Math.round((rnd() - 0.5) * 2000) / 100 : pick(ODD_VALUES));
const MOUNTS = ['rear_left', 'rear_right', 'upper_left', 'center', '', 0, null, 5];
const SIDES = ['left', 'right', 'up', '', null, undefined];

function makeThruster(withSide) {
  if (rnd() < 0.04) return null;
  const t = {};
  if (rnd() > 0.05) t.offset = { x: value(), y: value() };
  if (rnd() < 0.8) t.forward = { x: value(), y: value() };
  if (rnd() < 0.5) t.baseDeg = value();
  if (rnd() < 0.5) t.gimbalMinDeg = value();
  if (rnd() < 0.5) t.gimbalMaxDeg = value();
  if (rnd() < 0.5) t.nozzleDeg = value();
  if (rnd() < 0.7) t.mount = pick(MOUNTS);
  if (withSide && rnd() < 0.6) t.side = pick(SIDES);
  return t;
}

function makeEntity() {
  const entity = { visual: {} };
  if (rnd() < 0.6) entity.visual.mainThrusters = Array.from({ length: Math.floor(rnd() * 5) }, () => makeThruster(false));
  if (rnd() < 0.4) {
    const main = { vfxForward: rnd() < 0.5 ? { x: value(), y: value() } : undefined, baseDeg: value(), gimbalMinDeg: value(), gimbalMaxDeg: value(), mount: pick(MOUNTS) };
    main[pick(['vfxOffset', 'visualOffset', 'offset'])] = rnd() < 0.1 ? null : { x: value(), y: value() };
    entity.engines = { main: rnd() < 0.1 ? null : main };
  }
  if (rnd() < 0.6) entity.visual.torqueThrusters = Array.from({ length: Math.floor(rnd() * 4) }, () => makeThruster(true));
  if (rnd() < 0.3) entity.capitalProfile = { engineOffsets: Array.from({ length: Math.floor(rnd() * 3) }, () => (rnd() < 0.1 ? null : { x: value(), y: value() })) };
  return entity;
}

// Zmiana w miejscu (jak edytor gniazd): liść, dodanie/usunięcie dyszy, zdjęcie offsetu.
function mutate(entity) {
  const lists = [entity.visual.mainThrusters, entity.visual.torqueThrusters].filter(Array.isArray);
  const roll = rnd();
  if (roll < 0.08 && lists.length) {
    const list = pick(lists);
    list.push(makeThruster(list === entity.visual.torqueThrusters));
    return;
  }
  if (roll < 0.14 && lists.length) {
    const list = pick(lists);
    if (list.length) list.splice(Math.floor(rnd() * list.length), 1);
    return;
  }
  if (roll < 0.18) {
    entity.visual.mainThrusters = rnd() < 0.5 ? [] : [makeThruster(false)];
    return;
  }
  const holders = [];
  for (const list of lists) {
    for (const t of list) {
      if (!t) continue;
      holders.push([t, ['baseDeg', 'gimbalMinDeg', 'gimbalMaxDeg', 'nozzleDeg', 'mount', 'side', 'offset']]);
      if (t.offset) holders.push([t.offset, ['x', 'y']]);
      if (t.forward) holders.push([t.forward, ['x', 'y']]);
    }
  }
  const main = entity.engines?.main;
  if (main) {
    holders.push([main, ['baseDeg', 'gimbalMinDeg', 'gimbalMaxDeg', 'mount', 'nozzleDeg']]);
    for (const k of ['vfxOffset', 'visualOffset', 'offset']) if (main[k]) holders.push([main[k], ['x', 'y']]);
    if (main.vfxForward) holders.push([main.vfxForward, ['x', 'y']]);
  }
  for (const o of entity.capitalProfile?.engineOffsets || []) if (o) holders.push([o, ['x', 'y']]);
  if (!holders.length) {
    entity.visual.torqueThrusters = [makeThruster(true)];
    return;
  }
  const [obj, keys] = pick(holders);
  const key = pick(keys);
  const old = obj[key];
  if (key === 'offset') obj.offset = rnd() < 0.5 ? null : { x: value(), y: value() };
  else if (key === 'mount') obj.mount = pick(MOUNTS);
  else if (key === 'side') obj.side = pick(SIDES);
  else if (typeof old === 'number' && rnd() < 0.4) obj[key] = old + pick([1e-9, 0.004, 0.006, 1, -0.003]);
  else obj[key] = value();
}

test('odcisk wejść dysz zmienia się przy każdej zmianie klucza slotów', () => {
  let keyChanges = 0;
  for (let i = 0; i < 3000; i++) {
    const entity = makeEntity();
    for (let m = 0; m < 8; m++) {
      const hashBefore = slotInputHash(entity);
      const keyBefore = keyOf(entity);
      mutate(entity);
      assert.equal(slotInputHash(entity), slotInputHash(entity), 'odcisk deterministyczny');
      if (keyOf(entity) !== keyBefore) {
        keyChanges++;
        assert.notEqual(slotInputHash(entity), hashBefore, `klucz się zmienił, odcisk nie: ${JSON.stringify(entity)}`);
      }
    }
  }
  assert.ok(keyChanges > 3000, `za mało zmian klucza w próbie: ${keyChanges}`);
});

test('odcisk pomija pozycję dyszy w gimbalu (nozzleDeg nie wchodzi do klucza)', () => {
  const thruster = { offset: { x: -700, y: 40 }, forward: { x: 0, y: 1 }, gimbalMinDeg: -30, gimbalMaxDeg: 30, nozzleDeg: 0, mount: 'rear_left' };
  const entity = { visual: { mainThrusters: [thruster], torqueThrusters: [] } };
  const hash = slotInputHash(entity);
  thruster.nozzleDeg = 25;
  assert.equal(slotInputHash(entity), hash);
  thruster.offset.x = -690;
  assert.notEqual(slotInputHash(entity), hash);
});

// Szybka ścieżka (2026-10-07, koszt renderu w bitwie): odcisk nie liczy się, gdy wejścia to te same obiekty
// i długości tablic co przy ostatnim odcisku. Podmiana tablicy / obiektu albo zmiana długości — od razu;
// zapis w miejscu — co klatkę przez SLOT_INPUT_SETTLE klatek po budowie, potem najpóźniej po SLOT_INPUT_RECHECK.
test('szybka ścieżka odcisku: podmiana wejść od razu, zapis w miejscu najpóźniej po SLOT_INPUT_RECHECK', () => {
  const { createSlotInputRefs, slotInputRefsSame, rememberSlotInputRefs, SLOT_INPUT_SETTLE, SLOT_INPUT_RECHECK } = EngineSlotKeyInternals;
  const e = {
    visual: { mainThrusters: [{ offset: { x: -700, y: 40 }, mount: 'rear_left' }], torqueThrusters: [] },
    engines: { main: { offset: { x: 0, y: 0 }, vfxForward: { x: 0, y: 1 } } },
    capitalProfile: { engineOffsets: [{ x: 1, y: 2 }] }
  };
  const refs = createSlotInputRefs();
  let frame = 0;
  for (let i = 0; i < SLOT_INPUT_SETTLE; i++) {
    assert.equal(slotInputRefsSame(e, refs, ++frame), false, 'po budowie: pełny odcisk co klatkę');
    rememberSlotInputRefs(e, refs);
  }
  let full = 0;
  for (let i = 0; i < SLOT_INPUT_RECHECK * 3; i++) {
    if (!slotInputRefsSame(e, refs, ++frame)) { full++; rememberSlotInputRefs(e, refs); }
  }
  assert.equal(full, 3, 'te same wejścia: pełny odcisk raz na SLOT_INPUT_RECHECK klatek');
  const changes = [
    () => { e.visual.mainThrusters = e.visual.mainThrusters.slice(); },
    () => { e.visual.mainThrusters.push({ offset: { x: 1, y: 1 } }); },
    () => { e.visual.torqueThrusters = [{ offset: { x: 0, y: 5 } }]; },
    () => { e.visual.torqueThrusters.length = 0; },
    () => { e.engines.main = { offset: { x: 0, y: 0 } }; },
    () => { e.engines.main.vfxOffset = { x: 3, y: 4 }; },
    () => { e.engines.main.vfxForward = { x: 1, y: 0 }; },
    () => { e.capitalProfile.engineOffsets = []; },
    () => { e.visual = { mainThrusters: e.visual.mainThrusters, torqueThrusters: e.visual.torqueThrusters }; }
  ];
  for (const change of changes) {
    // klatka zwykła (nie kontrolna)
    while (((frame + 1 + refs.phase) % SLOT_INPUT_RECHECK) === 0) frame++;
    assert.equal(slotInputRefsSame(e, refs, frame + 1), true);
    change();
    assert.equal(slotInputRefsSame(e, refs, ++frame), false, `zmiana wejść od razu: ${change}`);
    rememberSlotInputRefs(e, refs);
  }
  // Zapis w miejscu (liść) — wykryty najpóźniej w klatce kontrolnej.
  const hash = slotInputHash(e);
  e.visual.mainThrusters[0].offset.x = -650;
  assert.notEqual(slotInputHash(e), hash);
  let seen = -1;
  for (let i = 1; i <= SLOT_INPUT_RECHECK; i++) {
    if (!slotInputRefsSame(e, refs, ++frame)) { seen = i; break; }
  }
  assert.ok(seen > 0 && seen <= SLOT_INPUT_RECHECK, `zapis w miejscu złapany po ${seen} klatkach`);
});

test('kierunek dyszy z pamięci slotu = kierunek liczony od nowa (gimbal, baza, zakres w biegu)', () => {
  const { resolveSlotForward, computeSlotForward } = EngineSlotKeyInternals;
  let checks = 0;
  for (let i = 0; i < 400; i++) {
    const entity = makeEntity();
    const slots = buildSlots(entity);
    for (let step = 0; step < 12; step++) {
      for (const slot of slots) {
        const src = slot.source;
        if (src && rnd() < 0.5) src[pick(['nozzleDeg', 'nozzleDeg', 'baseDeg', 'gimbalMinDeg', 'gimbalMaxDeg'])] = value();
        const got = resolveSlotForward(slot);
        const want = computeSlotForward(slot, src);
        assert.ok(Object.is(got.x, want.x) && Object.is(got.y, want.y), `${JSON.stringify(src)} → ${got.x},${got.y} ≠ ${want.x},${want.y}`);
        checks++;
      }
    }
  }
  assert.ok(checks > 1000, `za mało prób: ${checks}`);
});
