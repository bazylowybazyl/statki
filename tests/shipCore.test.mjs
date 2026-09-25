import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DestructorSystem, DESTRUCTOR_CONFIG } from '../src/game/destructor.js';
import {
  attachShipCores,
  detachShipCores,
  updateShipCores,
  notifyCoreHostKilled,
  computeCoreLayout,
  coreMarkerToGrid,
  gridToLocal,
  getCoreLocal,
  getCoreWorld,
  worldToLocal,
  exportCoreMarkers,
  normalizeCoreMarker,
  markCoreChainExposure,
  computeCoreBlast,
  planCoreBreakup,
  applyCoreBreakup,
  probeCoreSupport,
  applyBlastCoreShock,
  forceCoreMeltdown,
  chooseCoreDetonationVariant,
  applyVariantToBlast,
  applyCoreDetonation,
  createCoreJet,
  stepCoreJet,
  createPlasmaOrb,
  stepPlasmaOrbs,
  planSecondaryBlasts,
  rollSecondaryBlasts,
  locateShard,
  CORE_DETONATION_VARIANTS,
  CORE_VARIANT_IDS,
  CORE_SECONDARY_PROFILES,
  CORE_STATE,
  CORE_KILL_MODE,
  CORE_PROBE_CONFIG,
  CORE_CLASS_PROFILES
} from '../src/game/shipCore.js';
import { makeDestructorHull } from './helpers/destructorHull.mjs';
import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneDistance, bridgeZoneMargin, normalizeBridgeList, validateBridgeLayout } from '../src/game/shipBridge.js';
import { getHullRenderSize, getWeaponTierForHull } from '../src/data/ships.js';
import { HULLS as DEMO_HULLS } from '../dema/rdzen-hulls-data.js';

const CAPITAL = CORE_CLASS_PROFILES.capital;

function withCanvasDocument(fn) {
  const prev = globalThis.document;
  const noop = () => {};
  const ctx = {
    drawImage: noop, save: noop, restore: noop, translate: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, closePath: noop, clip: noop, fill: noop, clearRect: noop,
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) })
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try { return fn(); } finally {
    if (prev === undefined) delete globalThis.document;
    else globalThis.document = prev;
  }
}

function hull(opts = {}) {
  return makeDestructorHull({ width: 320, height: 120, maxHp: 12000, hp: 12000, radius: 260, ...opts });
}

// Kadłub w skali renderu 0,5 (PNG 640×240 → siatka 320×120), rdzeń w środku.
function coredHull(markers = [{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }], options = {}, hullOpts = {}) {
  const e = hull(hullOpts);
  const cores = attachShipCores(e, markers, { pngWidth: 640, pngHeight: 240, classId: 'capital', ...options });
  return { e, core: cores[0], cores };
}

function run(entity, seconds, ctx = {}) {
  const events = [];
  const step = CORE_PROBE_CONFIG.probeEverySec / 4;
  let t = ctx.time0 || 0;
  for (let acc = 0; acc < seconds; acc += step) {
    t += step;
    updateShipCores(entity, step, { time: t, entities: ctx.entities || [entity], events });
  }
  return events;
}

function localOf(entity, shard) {
  return gridToLocal(entity, shard.origGridX, shard.origGridY, {});
}

test('komora: heksy w promieniu r dostają znacznik i pancerz × armorMul, reszta nie', () => {
  const { e, core } = coredHull();
  assert.equal(core.invalid, null);
  const rGrid = 40 * 0.5;
  assert.ok(Math.abs(core.gridR - rGrid) < 1e-9, 'r z PNG przez skalę układu');
  assert.ok(core.chamber.length > 10);
  for (const s of e.hexGrid.shards) {
    const l = localOf(e, s);
    const inside = Math.hypot(l.x, l.y) <= rGrid + 1e-9;
    if (inside) {
      assert.equal(s.__coreId, 'r');
      assert.ok(Math.abs(s.maxHp - s.__coreArmorBase * 3) < 1e-6);
      assert.ok(Math.abs(s.hp - s.maxHp) < 1e-6);
    } else {
      assert.equal(s.__coreId, undefined);
      assert.equal(s.__coreArmorBase, undefined);
    }
  }
  assert.ok(Math.abs(core.chamberMaxHpSum - core.chamber.reduce((a, s) => a + s.maxHp, 0)) < 1e-6);
});

test('pancerz komory: ten sam strzał, który zabija zwykły heks, heksa komory nie zabija', () => {
  const { e, core } = coredHull();
  const target = core.chamber[0];
  const plain = e.hexGrid.shards.find((s) => !s.__coreId && Math.hypot(localOf(e, s).x, localOf(e, s).y) > 60);
  const hitAt = (s) => {
    const l = localOf(e, s);
    return getWorldFromLocal(e, l.x, l.y);
  };
  const dmg = plain.maxHp / 0.9 + 1; // bezpośrednie obrażenia applyImpact = 0,9 × dmg
  const pp = hitAt(plain);
  const cp = hitAt(target);
  assert.ok(DestructorSystem.applyImpact(e, pp.x, pp.y, dmg, { x: 0, y: 0 }));
  assert.ok(DestructorSystem.applyImpact(e, cp.x, cp.y, dmg, { x: 0, y: 0 }));
  assert.equal(plain.active, false, 'zwykły heks ginie');
  assert.equal(target.active, true, 'heks komory przeżywa');
});

function getWorldFromLocal(e, lx, ly) {
  // encja testowa: kąt 0, skala 1
  return { x: (e.x || 0) + lx, y: (e.y || 0) + ly };
}

test('ODSŁONIĘTY dopiero, gdy dziura dotknie komory; obok komory stan zostaje NOMINALNY', () => {
  const { e, core } = coredHull();
  const rGrid = core.gridR;
  // pierścień tuż za komorą (r..r+15) — wyrwa DOOKOŁA, ale nie W komorze
  for (const s of e.hexGrid.shards) {
    const d = Math.hypot(localOf(e, s).x, localOf(e, s).y);
    if (d > rGrid + 0.5 && d < rGrid + 15) DestructorSystem.destroyShard(e, s);
  }
  let events = run(e, 0.5);
  assert.equal(core.state, CORE_STATE.NOMINAL);
  assert.equal(events.filter((ev) => ev.type === 'state').length, 0);
  // pierwszy heks komory
  DestructorSystem.destroyShard(e, core.chamber[0]);
  events = run(e, 0.2, { time0: 0.5 });
  assert.equal(core.state, CORE_STATE.EXPOSED);
  assert.deepEqual(events.filter((ev) => ev.type === 'state').map((ev) => ev.to), [CORE_STATE.EXPOSED]);
});

test('przejścia: KRYTYCZNY pod criticalFrac, STOPIENIE pod killFrac, DETONACJA po meltdownSec', () => {
  const { e, core } = coredHull();
  const n = core.chamber.length;
  const killUntil = (frac) => {
    for (const s of core.chamber) {
      if (core.integrity <= frac) break;
      if (s.active) DestructorSystem.destroyShard(e, s);
      run(e, 0.1);
    }
  };
  killUntil(CAPITAL.criticalFrac - 0.01);
  assert.equal(core.state, CORE_STATE.CRITICAL);
  killUntil(CAPITAL.killFrac);
  assert.equal(core.state, CORE_STATE.MELTDOWN);
  assert.equal(core.cause, 'containment');
  assert.ok(core.deadCount < n, 'stopienie zanim zginie cała komora');
  const events = run(e, CAPITAL.meltdownSec + 0.2);
  const det = events.filter((ev) => ev.type === 'detonate');
  assert.equal(det.length, 1);
  assert.equal(core.state, CORE_STATE.DETONATED);
  // profil klasy; wariant może go zmniejszyć albo wyłączyć (wyrzut, kula)
  assert.equal(det[0].blast.baseReactorProfile, 'capital');
  assert.ok(CORE_VARIANT_IDS.includes(det[0].variant));
});

test('detonacja ZAWSZE: każdy kill rdzeniem kończy się dokładnie jedną detonacją (bez losowania)', () => {
  const realRandom = Math.random;
  try {
    for (let seed = 1; seed <= 12; seed++) {
      let s = seed * 7919;
      Math.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 30 + seed, armorMul: 1 + (seed % 3) }]);
      const order = core.chamber.slice().sort(() => Math.random() - 0.5);
      let detonations = 0;
      let t = 0;
      for (const sh of order) {
        if (sh.active) DestructorSystem.destroyShard(e, sh);
        for (let k = 0; k < 4; k++) {
          t += 0.05;
          detonations += updateShipCores(e, 0.05, { time: t }).filter((ev) => ev.type === 'detonate').length;
        }
      }
      for (let k = 0; k < 200 && core.state !== CORE_STATE.DETONATED; k++) {
        t += 0.05;
        detonations += updateShipCores(e, 0.05, { time: t }).filter((ev) => ev.type === 'detonate').length;
      }
      assert.equal(detonations, 1, `ziarno ${seed}`);
    }
  } finally {
    Math.random = realRandom;
  }
});

test('trafienia obok komory (applyImpact) nie zabijają — ani próg osłony, ani sonda', () => {
  for (const killMode of [CORE_KILL_MODE.CONTAINMENT, CORE_KILL_MODE.PROBE]) {
    const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }], { killMode });
    const rGrid = core.gridR;
    // salwa wokół komory w odległości r + 14 (rozlew bendingRadius 24 sięga brzegu komory)
    for (let k = 0; k < 36; k++) {
      const a = k / 36 * Math.PI * 2;
      const p = getWorldFromLocal(e, Math.cos(a) * (rGrid + 14), Math.sin(a) * (rGrid + 14));
      DestructorSystem.applyImpact(e, p.x, p.y, 120, { x: -Math.cos(a) * 300, y: -Math.sin(a) * 300 });
    }
    run(e, 1.0);
    assert.notEqual(core.state, CORE_STATE.MELTDOWN, killMode);
    assert.notEqual(core.state, CORE_STATE.DETONATED, killMode);
  }
});

test('sonda punktu (dzisiejsza gra): kill dopiero po 2 kontrolach bez heksa w 5 punktach', () => {
  const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 1 }], { killMode: CORE_KILL_MODE.PROBE });
  const w = getCoreWorld(core, {});
  // czyścimy okolicę sondy poza JEDNYM heksem blisko środka
  const probeR = CORE_PROBE_CONFIG.coreProbeRadius * 0.5;
  const footprint = probeR + DESTRUCTOR_CONFIG.gridDivisions * 1.3 * 2 + 2;
  let keep = null;
  for (const s of e.hexGrid.shards) {
    const l = localOf(e, s);
    const d = Math.hypot(l.x - (w.x - e.x), l.y - (w.y - e.y));
    if (d > footprint) continue;
    if (!keep && d < 6) { keep = s; continue; }
    DestructorSystem.destroyShard(e, s);
  }
  assert.ok(keep, 'jest heks przy środku');
  assert.equal(probeCoreSupport(core), true);
  run(e, 0.5);
  assert.notEqual(core.state, CORE_STATE.MELTDOWN, 'jeden heks trzyma rdzeń');
  DestructorSystem.destroyShard(e, keep);
  assert.equal(probeCoreSupport(core), false);
  run(e, CORE_PROBE_CONFIG.probeEverySec * (CORE_PROBE_CONFIG.coreLostChecksToDestroy + 1), { time0: 1 });
  assert.equal(core.state, CORE_STATE.MELTDOWN);
  assert.equal(core.cause, 'probe');
});

test('odcięcie: rdzeń idzie z fragmentem (skrócone stopienie), stary kadłub traci zasilanie', () => {
  withCanvasDocument(() => {
    DestructorSystem.splitQueue = [];
    const e = makeDestructorHull({ width: 400, height: 80, maxHp: 12000, hp: 12000, radius: 260, noSplit: false });
    // rdzeń przy lewym końcu (lokalnie x = -160), mniejsza wyspa po cięciu x < -120
    const [core] = attachShipCores(e, [{ id: 'r', x: -320, y: 0, r: 30, armorMul: 2 }], { pngWidth: 800, pngHeight: 160, classId: 'capital' });
    assert.ok(core.chamber.length > 0);
    for (const s of e.hexGrid.shards) {
      const l = localOf(e, s);
      if (l.x > -125 && l.x < -108) DestructorSystem.destroyShard(e, s);
    }
    const entities = [e];
    DestructorSystem.splitQueue.push(e);
    for (let i = 0; i < 24; i++) DestructorSystem.update(1 / 120, entities);
    assert.ok(entities.length >= 2, 'powstał wrak');
    const wreck = entities.find((x) => x !== e && x.isWreck);
    assert.ok(wreck, 'wrak w liście encji');
    const events = run(e, 0.2, { entities });
    const severed = events.find((ev) => ev.type === 'severed');
    assert.ok(severed, 'zdarzenie odcięcia');
    assert.equal(core.host, wreck);
    assert.ok(wreck.shipCores.includes(core));
    assert.ok(!e.shipCores.includes(core));
    assert.equal(core.state, CORE_STATE.MELTDOWN);
    assert.equal(core.cause, 'severed');
    assert.ok(Math.abs(core.meltdownDuration - CORE_CLASS_PROFILES[core.classId].meltdownSec * 0.5) < 1e-9);
    assert.ok(events.some((ev) => ev.type === 'reactorLost' && ev.host === e));
    // pozycja rdzenia na wraku = ta sama w świecie (siatka wspólna, inny pivot)
    const wl = getCoreLocal(core, {});
    const back = worldToLocal(wreck, getCoreWorld(core, {}).x, getCoreWorld(core, {}).y, {});
    assert.ok(Math.abs(wl.x - back.x) < 1e-6 && Math.abs(wl.y - back.y) < 1e-6);
    // a detonacja idzie z fragmentu
    const later = run(wreck, core.meltdownDuration + 0.2, { entities, time0: 1 });
    assert.equal(later.filter((ev) => ev.type === 'detonate').length, 1);
  });
});

test('odcięcie drobnicy bez rdzenia nie rusza rdzenia', () => {
  withCanvasDocument(() => {
    DestructorSystem.splitQueue = [];
    const e = makeDestructorHull({ width: 400, height: 80, maxHp: 12000, hp: 12000, radius: 260, noSplit: false });
    const [core] = attachShipCores(e, [{ id: 'r', x: 0, y: 0, r: 30, armorMul: 2 }], { pngWidth: 800, pngHeight: 160, classId: 'capital' });
    for (const s of e.hexGrid.shards) {
      const l = localOf(e, s);
      if (l.x > 150 && l.x < 166) DestructorSystem.destroyShard(e, s);
    }
    const entities = [e];
    DestructorSystem.splitQueue.push(e);
    for (let i = 0; i < 24; i++) DestructorSystem.update(1 / 120, entities);
    const events = run(e, 0.3, { entities });
    assert.equal(core.host, e);
    assert.equal(events.filter((ev) => ev.type === 'severed').length, 0);
    assert.equal(core.state, CORE_STATE.NOMINAL);
  });
});

test('PNG → siatka: gracz i NPC dają TEN SAM wynik (łapie podwójne skalowanie rdzeni gracza)', () => {
  // Atlas: PNG 3747×1677 → kanwa renderu 1800×806 (×0,48)
  const markers = [{ id: 'atlas_A', x: -830, y: 0, r: 56, armorMul: 3 }, { id: 'atlas_B', x: 70, y: 120, r: 40 }];
  const npc = makeDestructorHull({ width: 1800, height: 806, maxHp: 12000, hp: 12000, radius: 900 });
  const player = makeDestructorHull({
    width: 1800, height: 806, isPlayer: true, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
    hull: { val: 12000, max: 12000 }, visual: { spriteScale: 1 }, radius: 900
  });
  const a = attachShipCores(npc, markers, { pngWidth: 3747, pngHeight: 1677 });
  const b = attachShipCores(player, markers, { pngWidth: 3747, pngHeight: 1677 });
  const layout = computeCoreLayout(3747, 1677, npc.hexGrid);
  for (let i = 0; i < markers.length; i++) {
    const la = getCoreLocal(a[i], {});
    const lb = getCoreLocal(b[i], {});
    assert.ok(Math.abs(la.x - markers[i].x * layout.x) < 1e-9, 'NPC: marker × skala raz');
    assert.ok(Math.abs(lb.x - la.x) < 1e-9 && Math.abs(lb.y - la.y) < 1e-9, 'gracz = NPC');
    const ids = (cores) => cores[i].chamber.map((s) => `${s.c},${s.r}`).sort().join('|');
    assert.equal(ids(b), ids(a), 'te same heksy komory');
  }
  // Dzisiejsza ścieżka gracza w index.html: buildPlayerDefaultEditorCores mnoży
  // przez __hardpointScaleX, a getEntityCoreLocalPos drugi raz. Marker
  // przeskalowany z góry trafia 0,48 × bliżej środka — to musi się różnić.
  const prescaled = { x: markers[0].x * layout.x, y: markers[0].y * layout.y };
  const wrong = coreMarkerToGrid(prescaled, layout, npc.hexGrid);
  const right = coreMarkerToGrid(markers[0], layout, npc.hexGrid);
  assert.ok(Math.abs((wrong.gridX - 900) / (right.gridX - 900) - layout.x) < 1e-6);
});

test('PORT poprawka 1 (TODO integracji): index.html nie skaluje rdzeni gracza z góry', { todo: 'dziś uśpiony błąd — odblokować przy integracji (docs/PORT-rdzen.md)' }, () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = src.indexOf('function buildPlayerDefaultEditorCores');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n    }\n', start));
  assert.doesNotMatch(body, /x\s*\*\s*scaleX|y\s*\*\s*scaleY/);
});

test('PORT poprawka 3 (TODO integracji): normalizeEditorCore zachowuje pola rdzenia', { todo: 'dziś wycina wszystko poza id/x/y — odblokować przy integracji' }, () => {
  const src = readFileSync(new URL('../src/game/npcHardpointRuntime.js', import.meta.url), 'utf8');
  const start = src.indexOf('function normalizeEditorCore');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /armorMul/);
});

test('rdzeń poza obrysem jest nieważny i nigdy nie zabija (łapie pułapkę klucza pirate_)', () => {
  const { e, core } = coredHull([{ id: 'daleko', x: 5000, y: 0, r: 40 }], { killMode: CORE_KILL_MODE.PROBE });
  assert.equal(core.invalid, 'poza-kadłubem');
  const events = run(e, 1.0);
  assert.equal(core.state, CORE_STATE.NOMINAL);
  assert.equal(events.length, 0);
});

test('eksport markerów: przestrzeń PNG, zachowane r/armorMul/profile, round-trip', () => {
  const markers = [{ id: 'a', x: -219.004, y: -5, r: 48.123, armorMul: 3, profile: 'capital', junk: 1 }];
  const { core } = coredHull(markers);
  const out = exportCoreMarkers([core.marker]);
  assert.deepEqual(out, [{ id: 'a', x: -219, y: -5, r: 48.12, armorMul: 3, profile: 'capital' }]);
  assert.deepEqual(normalizeCoreMarker(out[0]), { id: 'a', x: -219, y: -5, r: 48.12, armorMul: 3, profile: 'capital' });
});

test('detach przywraca HP heksów sprzed pancerza', () => {
  const { e, core } = coredHull();
  const s = core.chamber[0];
  const base = s.__coreArmorBase;
  s.hp = s.maxHp * 0.5;
  detachShipCores(e);
  assert.equal(s.maxHp, base);
  assert.ok(Math.abs(s.hp - base * 0.5) < 1e-9);
  assert.equal(s.__coreId, undefined);
});

test('pula HP: rdzeń KRYTYCZNY detonuje przy śmierci z wyniszczenia, NOMINALNY nie', () => {
  const a = coredHull();
  assert.equal(notifyCoreHostKilled(a.e, 1).filter((ev) => ev.type === 'detonate').length, 0);
  const b = coredHull();
  for (const s of b.core.chamber) {
    if (b.core.integrity < CAPITAL.criticalFrac - 0.02) break;
    DestructorSystem.destroyShard(b.e, s);
    run(b.e, 0.1);
  }
  assert.equal(b.core.state, CORE_STATE.CRITICAL);
  const ev = notifyCoreHostKilled(b.e, 2);
  assert.equal(ev.filter((x) => x.type === 'detonate').length, 1);
  assert.equal(b.core.state, CORE_STATE.DETONATED);
});

test('łańcuch: stopienie w oknie po fali dostaje głębokość; wybuch na limicie nie ma krateru', () => {
  const { e, core } = coredHull();
  markCoreChainExposure(e, 1, 0);
  for (const s of core.chamber) {
    if (core.state === CORE_STATE.MELTDOWN) break;
    DestructorSystem.destroyShard(e, s);
    updateShipCores(e, CORE_PROBE_CONFIG.probeEverySec, { time: 0.1 });
  }
  assert.equal(core.state, CORE_STATE.MELTDOWN);
  assert.equal(core.cause, 'chain');
  assert.equal(core.chainDepth, 1);
  const blast = computeCoreBlast(core);
  assert.equal(blast.hexDamage, 0, 'maxChainDepth = 1: fala z ogniwa nie kopie');
  assert.ok(blast.aoeDamage < computeCoreBlast({ ...core, chainDepth: 0 }).aoeDamage);
});

test('rozpad przy detonacji: krater wokół RDZENIA wyparowuje, reszta idzie w fragmenty', () => {
  withCanvasDocument(() => {
    const { e, core } = coredHull([{ id: 'r', x: -200, y: 0, r: 30 }], {}, { noSplit: false });
    const plan = planCoreBreakup(core, { seed: 3 });
    const craterR = core.gridR * CAPITAL.craterMul;
    for (const s of plan.vaporize) {
      const l = localOf(e, s);
      const c = getCoreLocal(core, {});
      assert.ok(Math.hypot(l.x - c.x, l.y - c.y) <= craterR + 1e-6);
    }
    assert.ok(plan.groups.length >= 2);
    const entities = [e];
    const wrecks = applyCoreBreakup(core, plan, entities, { seed: 5 });
    assert.ok(wrecks.length >= 2);
    for (const s of plan.vaporize) assert.equal(s.active, false);
    // fragmenty odlatują OD rdzenia
    const cw = getCoreWorld(core, {});
    for (const w of wrecks) {
      const dx = w.x - cw.x;
      const dy = w.y - cw.y;
      assert.ok(dx * w.vx + dy * w.vy > 0, 'prędkość od rdzenia');
    }
    // odłamki krateru też (nie wiszą w miejscu wybuchu z prędkością kadłuba)
    let flung = 0;
    for (const s of plan.vaporize) {
      if (!s.isDebris) continue;
      const dx = s.worldX - cw.x;
      const dy = s.worldY - cw.y;
      if (Math.hypot(dx, dy) < 1) continue;
      assert.ok(dx * s.dvx + dy * s.dvy > 0, 'odłamek krateru leci od rdzenia');
      assert.ok(Math.hypot(s.dvx, s.dvy) > 240, 'odłamek krateru szybszy od fragmentów');
      flung++;
    }
    assert.ok(flung > 10, 'krater daje odłamki');
  });
});

test('fala detonacji: osłabia komory sąsiadów w promieniu (spadek liniowy), źródło i dalsze kadłuby nietknięte', () => {
  const src = coredHull();
  const near = coredHull([{ id: 'n', x: 0, y: 0, r: 40, armorMul: 3 }], {}, { x: 300, y: 0 });
  const far = coredHull([{ id: 'f', x: 0, y: 0, r: 40, armorMul: 3 }], {}, { x: 900, y: 0 });
  const hp = (c) => c.chamber.map((s) => s.hp);
  const hp0 = { src: hp(src.core), near: hp(near.core), far: hp(far.core) };
  const R = 600;
  // obrażenia fali na połowę pancerza najsłabszego heksa komory: nikt nie ginie
  const minMax = Math.min(...near.core.chamber.map((s) => s.maxHp));
  const shock = { shockRadius: R, shockDamage: minMax * 0.5 / (1 - 300 / R) };
  const touched = applyBlastCoreShock(shock, 0, 0, [src.e, near.e, far.e], src.e);
  assert.equal(touched, 1, 'tylko sąsiad w promieniu');
  assert.deepEqual(hp(src.core), hp0.src, 'źródło wybuchu nie dostaje własnej fali');
  assert.deepEqual(hp(far.core), hp0.far, 'poza promieniem bez zmian');
  const expected = shock.shockDamage * (1 - 300 / R);
  near.core.chamber.forEach((s, i) => assert.ok(Math.abs(hp0.near[i] - s.hp - expected) < 1e-6));
  assert.ok(near.core.chamber.every((s) => s.active), 'fala osłabia, nie kopie dziury');
  assert.equal(near.core.probeTimer, 0, 'ocena w najbliższym kroku');
});

test('KRYTYCZNY bez dziury: osłona pod criticalFrac przez fale, zanim zginie pierwszy heks', () => {
  const { e, core } = coredHull();
  for (const s of core.chamber) s.hp = s.maxHp * (CAPITAL.criticalFrac - 0.1);
  const events = run(e, 0.2);
  assert.equal(core.deadCount, 0);
  assert.equal(core.state, CORE_STATE.CRITICAL);
  assert.deepEqual(events.filter((ev) => ev.type === 'state').map((ev) => ev.to), [CORE_STATE.CRITICAL]);
  // dalsze osłabienie pod killFrac = stopienie, też bez dziury
  for (const s of core.chamber) s.hp = s.maxHp * (CAPITAL.killFrac - 0.05);
  run(e, 0.2, { time0: 0.2 });
  assert.equal(core.state, CORE_STATE.MELTDOWN);
});

// ---------------------------------------------------------------------------
// Warianty detonacji
// ---------------------------------------------------------------------------

function sideOf(core, s, nx, ny) {
  return ((s.gridX - core.gridX) * nx + (s.gridY - core.gridY) * ny) >= 0 ? 1 : -1;
}

test('wariant: wymuszenie z opcji i configu, losowanie powtarzalne i zgodne z wagami klasy', () => {
  const { core } = coredHull();
  core.config = { ...core.config, detonationVariant: 'jet' };
  assert.equal(chooseCoreDetonationVariant(core), 'jet');
  assert.equal(chooseCoreDetonationVariant(core, { force: 'orb' }), 'orb');
  core.config = { ...core.config, detonationVariant: null };
  assert.equal(chooseCoreDetonationVariant(core, { seed: 77 }), chooseCoreDetonationVariant(core, { seed: 77 }));
  const counts = Object.fromEntries(CORE_VARIANT_IDS.map((id) => [id, 0]));
  for (let s = 1; s <= 600; s++) counts[chooseCoreDetonationVariant(core, { seed: s * 7919 })]++;
  for (const id of CORE_VARIANT_IDS) assert.ok(counts[id] > 30, `${id} w 600 losowaniach: ${counts[id]}`);
  const escort = { ...core, classId: 'escort' };
  for (let s = 1; s <= 300; s++) {
    const v = chooseCoreDetonationVariant(escort, { seed: s * 104729 });
    assert.ok(v !== 'orb' && v !== 'thirds', `eskorta bez kuli i trójpodziału (${v})`);
  }
});

test('zdarzenie detonacji niesie wariant i wybuch przeskalowany wariantem (reszta energii w base*)', () => {
  const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }], { config: { detonationVariant: 'hole' } });
  const base = computeCoreBlast(core);
  forceCoreMeltdown(core, 0);
  const events = run(e, core.meltdownDuration + 0.2);
  const det = events.find((ev) => ev.type === 'detonate');
  assert.ok(det, 'detonacja');
  assert.equal(det.variant, 'hole');
  assert.ok(Math.abs(det.blast.aoeDamage - base.aoeDamage * CORE_DETONATION_VARIANTS.hole.aoeMul) < 1e-6);
  assert.ok(Math.abs(det.blast.baseAoeDamage - base.aoeDamage) < 1e-6);
});

test('przełamanie: dwa wraki po dwóch stronach szczeliny, odchodzą od niej i rozchylają się', () => {
  withCanvasDocument(() => {
    const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 30 }], {}, { noSplit: false });
    const plan = planCoreBreakup(core, { mode: 'halves', seed: 5 });
    assert.equal(plan.mode, 'halves');
    assert.equal(plan.groups.length, 2);
    const n0 = plan.groupDirs[0];
    for (const [gi, group] of plan.groups.entries()) {
      const want = gi === 0 ? 1 : -1;
      for (const s of group) assert.equal(sideOf(core, s, n0.x, n0.y), want, 'heks po swojej stronie szczeliny');
    }
    assert.ok(Math.abs(plan.craterRadius - core.gridR * CAPITAL.craterMul * CORE_DETONATION_VARIANTS.halves.craterMul) < 1e-9);
    assert.equal(plan.cuts.length, 1);
    const res = applyCoreDetonation(core, plan, [e], { seed: 9 });
    assert.equal(res.wrecks.length, 2);
    assert.ok(res.keptHost === null);
    // prędkość każdej połowy ma składową od szczeliny (świat = siatka, kąt 0)
    for (const [gi, w] of res.wrecks.entries()) {
      const nd = plan.groupDirs[gi];
      assert.ok(w.vx * nd.x + w.vy * nd.y > 0, 'połowa odchodzi od szczeliny');
    }
    assert.ok(Math.sign(res.wrecks[0].angVel) !== Math.sign(res.wrecks[1].angVel), 'przeciwne obroty');
  });
});

test('rozerwanie na trzy: trzy wraki z trzech sektorów między pęknięciami', () => {
  withCanvasDocument(() => {
    const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 30 }], {}, { noSplit: false });
    const plan = planCoreBreakup(core, { mode: 'thirds', seed: 12 });
    assert.equal(plan.cuts.length, 3);
    assert.equal(plan.groups.length, 3);
    const res = applyCoreDetonation(core, plan, [e], { seed: 4 });
    assert.equal(res.wrecks.length, 3);
  });
});

test('wyrwa: duży poszarpany krater, kadłub zostaje jednym kawałkiem', () => {
  withCanvasDocument(() => {
    const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 30 }], {}, { noSplit: false });
    const shatter = planCoreBreakup(core, { mode: 'shatter', seed: 2 });
    const plan = planCoreBreakup(core, { mode: 'hole', seed: 2 });
    assert.equal(plan.keepHost, true);
    assert.equal(plan.groups.length, 0);
    assert.ok(plan.vaporize.length > shatter.vaporize.length * 1.5, `wyrwa większa od krateru rozprysku (${plan.vaporize.length} vs ${shatter.vaporize.length})`);
    const Rmax = plan.craterRadius * 1.36;
    for (const s of plan.vaporize) {
      assert.ok(Math.hypot(s.gridX - core.gridX, s.gridY - core.gridY) <= Rmax + 1e-6, 'w obrysie poszarpanego krateru');
    }
    const aliveBefore = e.hexGrid.shards.filter((s) => s.active && !s.isDebris).length;
    const res = applyCoreDetonation(core, plan, [e], { seed: 1 });
    assert.equal(res.wrecks.length, 0);
    assert.ok(res.keptHost === e);
    const aliveAfter = e.hexGrid.shards.filter((s) => s.active && !s.isDebris).length;
    assert.equal(aliveBefore - aliveAfter, plan.vaporize.length);
    assert.ok(aliveAfter > aliveBefore * 0.5, 'kadłub zostaje');
    assert.ok(plan.edgeShards.length > 10, 'brzeg wyrwy do rozżarzenia');
  });
});

test('wyrzut: kierunek losowy (tryb wound — przez wyrwę), kanał do krawędzi, odrzut w przeciwną stronę', () => {
  withCanvasDocument(() => {
    const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }], {}, { noSplit: false });
    // wyrwa komory od strony +X (jak kanał wykopany z dziobu)
    for (const s of core.chamber) if (localOf(e, s).x > core.gridR * 0.4) DestructorSystem.destroyShard(e, s);
    run(e, 0.2);
    assert.ok(core.deadCount > 0);
    // domyślnie losowo: kierunki z różnych ziaren rozchodzą się po całym kole
    const angles = [];
    for (let seed = 1; seed <= 16; seed++) {
      const p = planCoreBreakup(core, { mode: 'jet', seed });
      assert.ok(Math.abs(Math.hypot(p.dirGridX, p.dirGridY) - 1) < 1e-9);
      angles.push(Math.atan2(p.dirGridY, p.dirGridX));
    }
    assert.ok(angles.some((a) => Math.cos(a) < -0.5), 'bywa też od strony przeciwnej do wyrwy');
    assert.ok(angles.some((a) => Math.abs(Math.sin(a)) > 0.8), 'i w bok');
    // tryb 'wound' zostaje: strumień przez wyrwę (+X)
    const wound = planCoreBreakup(core, { mode: 'jet', seed: 21, exit: 'wound' });
    assert.ok(wound.dirGridX > Math.cos(0.5), `wound: strumień przez wyrwę (+X), jest ${wound.dirGridX.toFixed(2)}`);
    const plan = planCoreBreakup(core, { mode: 'jet', seed: 21 });
    // kanał: przed rdzeniem w paśmie 0,7 × półszerokości nie zostaje nic żywego
    const half = core.gridR * 0.55 * 0.8 * 0.85;
    for (const s of e.hexGrid.shards) {
      if (!s.active || s.isDebris || plan.vaporize.includes(s)) continue;
      const dx = s.gridX - core.gridX;
      const dy = s.gridY - core.gridY;
      const t = dx * plan.dirGridX + dy * plan.dirGridY;
      const d = Math.abs(-dx * plan.dirGridY + dy * plan.dirGridX);
      assert.ok(!(t > 0 && d < half), 'kanał wypalony do krawędzi');
    }
    const res = applyCoreDetonation(core, plan, [e], { seed: 3 });
    assert.ok(res.keptHost === e);
    assert.ok(res.recoil && res.recoil.x * plan.dirGridX + res.recoil.y * plan.dirGridY < 0, 'odrzut przeciwnie do strumienia');
    assert.ok(e.vx * plan.dirGridX + e.vy * plan.dirGridY < 0, 'kadłub pchnięty wstecz');
  });
});

test('strumień plazmy: bije w pierwszy kadłub na linii (krater + pula HP), gospodarza pomija, gaśnie', () => {
  const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }]);
  const target = hull({ x: 700, y: 0 });
  const blast = applyVariantToBlast(computeCoreBlast(core), 'jet');
  const jet = createCoreJet(core, { dirGridX: 1, dirGridY: 0 }, blast);
  const hitsOn = new Map();
  const hooks = { hullDamage: (ent, dmg) => hitsOn.set(ent, (hitsOn.get(ent) || 0) + dmg) };
  const aliveBefore = target.hexGrid.shards.filter((s) => s.active && !s.isDebris).length;
  let alive = true;
  let steps = 0;
  while (alive && steps < 1000) { alive = stepCoreJet(jet, 1 / 120, [e, target], { hooks, time: steps / 120 }); steps++; }
  assert.equal(jet.done, true);
  assert.ok(Math.abs(steps / 120 - jet.duration) < 0.02, 'gaśnie po czasie trwania');
  assert.ok((hitsOn.get(target) || 0) > 0, 'pula HP celu dostała');
  assert.equal(hitsOn.get(e) || 0, 0, 'gospodarz pominięty');
  const aliveAfter = target.hexGrid.shards.filter((s) => s.active && !s.isDebris).length;
  assert.ok(aliveAfter < aliveBefore, 'krater w celu');
  assert.ok(target.__coreChain && target.__coreChain.depth === 1, 'trafiony oznaczony do łańcucha');
});

test('kula plazmy: topi własny kadłub i cel na drodze (żar brzegu), wybucha po zapalniku liczonym od wyjścia — raz', () => {
  const alive = (ent) => ent.hexGrid.shards.filter((s) => s.active && !s.isDebris).length;
  const { e, core } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }]);
  const blast = applyVariantToBlast(computeCoreBlast(core), 'orb');
  const plan = planCoreBreakup(core, { mode: 'orb', seed: 4 });
  assert.equal(plan.cuts.length, 0, 'kula nie dostaje kanału z planu — topi go sama');
  const target = hull({ x: 620, y: 0 });
  const orb = createPlasmaOrb(core, { dirGridX: 1, dirGridY: 0 }, blast, { seed: 2 });
  assert.ok(orb.vx > 200, 'wyrzut w zadanym kierunku');
  assert.ok(orb.blast.aoeRadius < blast.baseAoeRadius && orb.blast.aoeDamage < blast.baseAoeDamage);
  const hostBefore = alive(e);
  const targetBefore = alive(target);
  const dmg = new Map();
  const hooks = { hullDamage: (ent, d) => dmg.set(ent, (dmg.get(ent) || 0) + d), blocksHexes: () => false };
  const events = [];
  let t = 0;
  let vOut = 0;
  for (let i = 0; i < 3000 && !orb.detonated; i++) {
    t += 1 / 120;
    stepPlasmaOrbs([orb], 1 / 120, [e, target], { events, time: t, hooks });
    if (orb.left && !vOut) vOut = Math.hypot(orb.vx, orb.vy);
  }
  assert.equal(events.length, 1);
  // encje porównujemy przez === — assert.equal na kadłubie liczy różnicę tysięcy heksów
  assert.ok(events[0].hit === null, 'bez tarczy nie ma zetknięcia — przelatuje, topiąc');
  assert.ok(orb.left && Math.abs(orb.flight - orb.fuse) < 0.02, 'zapalnik od wyjścia z kadłuba');
  assert.ok(hostBefore - alive(e) > 20, `wytopiony kanał wyjścia w gospodarzu (${hostBefore - alive(e)})`);
  assert.ok(targetBefore - alive(target) > 20, `wytopiony kanał w celu (${targetBefore - alive(target)})`);
  assert.ok((dmg.get(target) || 0) > 0, 'pula HP celu dostała');
  assert.equal(dmg.get(e) || 0, 0, 'gospodarz nie dostaje z puli');
  assert.ok(target.hexGrid.shards.some((s) => s.active && !s.isDebris && (s.heat || 0) > 0.5), 'brzeg kanału rozżarzony');
  assert.ok(Math.hypot(orb.vx, orb.vy) < vOut * 0.97, 'grzęźnie w celu (własny kadłub nie hamuje)');
  assert.ok(target.__coreChain && target.__coreChain.depth === 1, 'topiony oznaczony do łańcucha');
  stepPlasmaOrbs([orb], 1 / 120, [e, target], { events, hooks });
  assert.equal(events.length, 1, 'jeden wybuch');
  // tarcza trzyma plazmę: wybuch na celu, heksy celu nietknięte
  const { e: e2, core: core2 } = coredHull([{ id: 'r', x: 0, y: 0, r: 40, armorMul: 3 }]);
  const shielded = hull({ x: 620, y: 0 });
  const before2 = alive(shielded);
  const orb2 = createPlasmaOrb(core2, { dirGridX: 1, dirGridY: 0 }, applyVariantToBlast(computeCoreBlast(core2), 'orb'), { seed: 2 });
  const ev3 = [];
  for (let i = 0; i < 3000 && !orb2.detonated; i++) stepPlasmaOrbs([orb2], 1 / 120, [e2, shielded], { events: ev3, hooks: { blocksHexes: (ent) => ent === shielded } });
  assert.equal(ev3.length, 1);
  assert.ok(ev3[0].hit === shielded, 'wybuch na tarczy');
  assert.equal(alive(shielded), before2);
  // bez celów: zapalnik po wyjściu z kadłuba
  const lone = createPlasmaOrb(core, { dirGridX: 0, dirGridY: 1 }, blast, { seed: 5 });
  const ev2 = [];
  let steps = 0;
  let exitAt = -1;
  while (!lone.detonated && steps < 3000) {
    stepPlasmaOrbs([lone], 1 / 120, [e], { events: ev2 });
    steps++;
    if (lone.left && exitAt < 0) exitAt = steps;
  }
  assert.equal(ev2.length, 1);
  assert.ok(ev2[0].hit === null);
  assert.ok(exitAt > 0 && Math.abs((steps - exitAt + 1) / 120 - lone.fuse) < 0.02, 'po zapalniku od wyjścia');
  DestructorSystem.splitQueue = [];
});

test('wybuchy wtórne: żywe heksy kawałków, opóźnienia w zakresie klasy, posortowane', () => {
  const { e } = coredHull();
  const items = planSecondaryBlasts([e], { count: 5, classId: 'capital', seed: 3 });
  assert.equal(items.length, 5);
  const P = CORE_SECONDARY_PROFILES.capital;
  let prev = -1;
  for (const it of items) {
    assert.ok(it.entity === e);
    assert.ok(it.shard.active && !it.shard.isDebris && it.shard.hp > 0);
    assert.ok(it.delay >= P.delayMin && it.delay <= P.delayMax);
    assert.ok(it.delay >= prev);
    prev = it.delay;
  }
  assert.equal(rollSecondaryBlasts('jet', 'escort', () => 0.99), 0);
  const n = rollSecondaryBlasts('hole', 'capital', () => 0);
  assert.ok(n >= P.countMin && n <= P.countMax);
  const loc = locateShard(items[0].shard, [e], {});
  assert.ok(loc.entity === e);
});

// Reaktor przy środku masy, poza mostkami (docs/PORT-rdzen.md § 3). Komora (koło r)
// ma stać ≥ bridgeZoneMargin od każdej strefy KAŻDEGO wariantu — heks należy albo
// do komory, albo do mostka. Po dopisaniu rdzeni do hardpointEditorDefaults ten sam
// układ sprawdza test mostków (validateBridgeLayout, sam punkt rdzenia).
test('rdzenie dema: komora poza strefami mostków we wszystkich wariantach', () => {
  for (const def of Object.values(DEMO_HULLS)) {
    const entry = BRIDGE_LAYOUT_PROPOSALS[def.editorKey];
    assert.ok(entry, `${def.id}: kadłub bez propozycji mostków — test nieaktualny`);
    const size = getHullRenderSize(def.renderProfile, def.pngWidth, def.pngHeight);
    const margin = bridgeZoneMargin(size.w / def.pngWidth, getWeaponTierForHull(def.renderProfile));
    for (const [variant, list] of Object.entries(entry.variants)) {
      for (const core of def.cores) {
        for (const z of normalizeBridgeList(list)) {
          const gap = bridgeZoneDistance(z, core.x, core.y) - core.r;
          assert.ok(gap >= margin, `${def.id}/${core.id} ↔ ${variant}/${z.id}: brzeg komory ${gap.toFixed(1)} px PNG od mostka (min ${margin.toFixed(1)})`);
        }
      }
      const issues = validateBridgeLayout(list, { cores: def.cores }, { margin }).filter((i) => i.kind === 'core');
      assert.deepEqual(issues, [], `${def.id}/${variant}`);
    }
  }
});
