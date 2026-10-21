// Klasa okrętu w kreatorze kadłubów (etap 2 stoczni z klocków — src/game/hullDesign/hullDesignClass.js, dane
// src/data/shipClasses.js, gniazda presetów src/game/hullDesign/hullDesignSystemSlots.js): presety w limitach swojej klasy,
// gniazda floty TN zgodne z edytorem gniazd gry, uzbrojenie = domyślne NPC, kalibracja rdzeni (~20% zapasu), martwe kable
// przy niedoborze mocy, straż twardych limitów mostka.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHullDesign, expandHullDesign, hullDesignMountOf } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { HD_PRESET_KEYS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_PRESET_CLASS, HD_PRESET_MOUNTS, HD_PRESET_OUTSIDE_LADDER } from '../src/game/hullDesign/hullDesignSystemSlots.js';
import { HD_SYSTEM_TYPES } from '../src/game/hullDesign/hullDesignSystems.js';
import { pipeNetworkCheck, pipeModuleSdf, markPipeNetPower } from '../src/game/hullDesign/hullDesignPipes.js';
import {
  hullDesignClass, applyHullDesignPower, hullDesignCheck, hullDesignLimitBreach, hullDesignMountAddIssue, hullDesignMountList
} from '../src/game/hullDesign/hullDesignClass.js';
import { CORE_CALIBRATION_SPARE, classForHull } from '../src/data/shipClasses.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { WEAPON_TIER_BY_HULL } from '../src/data/ships.js';
import { TN_MOUNT_HULLS, dedupeMarkers, npcLoadout, fitWeaponToSize } from '../scripts/kreator-gniazda-tn.mjs';

const TN = ['custos', 'hasta', 'bellator', 'citadella', 'colossus'];
const fields = new Map();
/** Pole presetu (bez sieci — szybko) albo z siecią. */
const fieldOf = (key, pipes = false) => {
  const k = `${key}:${pipes}`;
  if (!fields.has(k)) fields.set(k, buildHullField(hullDesignPreset(key), { pipes }));
  return fields.get(k);
};

test('presety: klasa z decyzji użytkownika (TN, fregata z klocków), reszta z powierzchni; każdy w limitach swojej klasy', () => {
  const want = { custos: [1, 1], hasta: [2, 2], bellator: [4, 4], citadella: [5, 5], colossus: [6, 6], klocki: [1, 1] };
  for (const [k, v] of Object.entries(want)) assert.deepEqual(HD_PRESET_CLASS[k], v, k);
  for (const key of HD_PRESET_KEYS) {
    const d = hullDesignPreset(key);
    const f = fieldOf(key);
    const cls = hullDesignClass(f);
    if (key === 'empty') {
      assert.equal(d.bridgeLevel, 0, 'projekt od zera — klasę wybiera gracz (0 — z powierzchni)');
      assert.ok(cls.levels.auto && cls.check.issues.length === 0, 'pusty: najniższa pasująca klasa');
      continue;
    }
    assert.ok(d.bridgeLevel >= 1 && d.coreLevel >= 1, `${key}: poziomy w projekcie`);
    if (HD_PRESET_OUTSIDE_LADDER.includes(key)) {
      assert.ok(f.area > 900000, `${key}: poza drabiną (jak Atlas)`);
      continue;
    }
    assert.deepEqual(cls.check.issues, [], `${key}: limity klasy ${d.bridgeLevel} — pow. ${Math.round(f.area)}`);
    // presety spoza TN: najniższa klasa z kadłuba
    if (!want[key]) assert.equal(d.bridgeLevel, classForHull(f.area, cls.mounts), `${key}: klasa z powierzchni`);
  }
});

test('gniazda floty TN = edytor gniazd gry: liczba na typ (bez duplikatów), hangary = wrota, rozmiar broni kadłuba', () => {
  for (const key of TN) {
    const hull = TN_MOUNT_HULLS[key];
    const markers = dedupeMarkers(SHIP_EDITOR_DEFAULTS.ships[hull.editor].hardpoints);
    const game = {};
    for (const m of markers) game[m.type] = (game[m.type] || 0) + 1;
    const mods = expandHullDesign(hullDesignPreset(key)).modules;
    const mine = {};
    for (const g of hullDesignMountList(mods)) mine[g.slot] = (mine[g.slot] || 0) + 1;
    assert.deepEqual(mine, game, `${key}: gniazda na typ`);
    const size = WEAPON_TIER_BY_HULL[hull.frame];
    assert.equal(HD_PRESET_MOUNTS[key].size, size, `${key}: rozmiar`);
    assert.ok(mods.every((m) => !m.type.startsWith('turret_')), `${key}: wieże presetu zastąpione gniazdami`);
    assert.ok(mods.filter((m) => m.type === 'mount').every((m) => m.size === size));
  }
  // liczby gry (2026-10-21): Custos 4 (5 markerów, 1 duplikat), Hasta 8, Bellator 31, Citadella 35 (40, 5 duplikatów), Colossus 56
  const total = (key) => hullDesignMountList(expandHullDesign(hullDesignPreset(key)).modules).length;
  assert.deepEqual(TN.map(total), [4, 8, 31, 35, 56]);
});

test('uzbrojenie gniazd TN = domyślne NPC (equipNpcWeapons z index.html), broń za duża → rodzina w rozmiarze gniazda', () => {
  for (const key of TN) {
    const hull = TN_MOUNT_HULLS[key];
    const markers = dedupeMarkers(SHIP_EDITOR_DEFAULTS.ships[hull.editor].hardpoints);
    const size = HD_PRESET_MOUNTS[key].size;
    const npc = npcLoadout(hull, markers).map((w) => (w ? fitWeaponToSize(w, size) : ''));
    const bag = (list) => list.filter((g) => g.slot !== 'hangar').map((g) => `${g.slot}:${g.weapon}`).sort();
    const game = markers.map((m, i) => ({ slot: m.type, weapon: npc[i] }));
    const mine = hullDesignMountList(expandHullDesign(hullDesignPreset(key)).modules);
    assert.deepEqual(bag(mine), bag(game), `${key}: broń na typ gniazda`);
  }
  // Custos: NPC nosi railgun_mk2 (M) w gniazdach S — w kreatorze Tempest Ion S
  const cus = hullDesignMountList(expandHullDesign(hullDesignPreset('custos')).modules);
  assert.ok(cus.filter((g) => g.slot === 'main').every((g) => g.weapon === 'tempest_ion_s'));
  // Colossus: promień śmierci w gnieździe wbudowanym
  const col = hullDesignMountList(expandHullDesign(hullDesignPreset('colossus')).modules);
  assert.deepEqual(col.filter((g) => g.slot === 'builtin').map((g) => g.weapon), ['death_ray']);
});

test('gniazda TN: podstawa cała w kadłubie, bez nakładania na siebie, na systemy i kanały serwisowe', () => {
  for (const key of TN) {
    const f = fieldOf(key);
    const mods = f.expanded.modules;
    const mounts = mods.filter((m) => m.type === 'mount');
    const hard = mods.filter((m) => HD_SYSTEM_TYPES.includes(m.type) || m.type === 'reactor' || m.type === 'hangar');
    // obudowa reaktora nad kadłubem (gałąź reaktor-obudowa, `reactor` v 2): ośmiokąt do 1,2 · r + 0,8 · D — z zapasem
    // koło r · 1,3 + D wokół rdzenia
    const D = f.expanded.design.detail;
    const housings = mods.filter((m) => m.type === 'reactor').map((m) => ({ x: m.x, y: m.y, R: m.r * 1.3 + D }));
    for (const m of mounts) {
      const F = m.r * 1.16;
      assert.ok(sampleHullField(f, 0, m.x, m.y) <= -F, `${key}: gniazdo ${m.slot} (${m.x}, ${m.y}) za płytko`);
      for (const q of hard) assert.ok(pipeModuleSdf(q, m.x, m.y) >= F, `${key}: gniazdo (${m.x}, ${m.y}) na ${q.type} (${q.x}, ${q.y})`);
      for (const h of housings) assert.ok(Math.hypot(m.x - h.x, m.y - h.y) >= h.R + F, `${key}: gniazdo (${m.x}, ${m.y}) na obudowie reaktora (${h.x}, ${h.y})`);
      for (const q of mounts) {
        if (q === m) continue;
        assert.ok(Math.hypot(q.x - m.x, q.y - m.y) >= F + q.r * 1.16, `${key}: gniazda (${m.x}, ${m.y}) i (${q.x}, ${q.y}) nachodzą`);
      }
    }
  }
});

test('kalibracja rdzeni: preset TN na swoim rdzeniu — utrzymanie, tarcza i broń NPC zajmują ~80% mocy, nic nie gaśnie', () => {
  for (const key of TN) {
    const cls = hullDesignClass(fieldOf(key));
    const spare = cls.power.spareFrac;
    assert.ok(Math.abs(spare - CORE_CALIBRATION_SPARE) <= 0.05, `${key}: zapas ${(spare * 100).toFixed(1)}% (R${cls.levels.core} ${cls.power.capacity} MW)`);
    assert.equal(cls.deadMounts, 0, `${key}: wszystko z prądem`);
    assert.ok(cls.power.drive > 0.9 && cls.power.drive < 1.05, `${key}: napęd × ${cls.power.drive.toFixed(2)}`);
  }
});

test('niedobór mocy: urządzenia ponad moc bez prądu, ich kable martwe, sieć dalej bez wolnych końców i poza obrysem', () => {
  const d = { ...hullDesignPreset('bellator'), coreLevel: 2 };
  const f = buildHullField(d);
  const base = f.pipeNet;
  const cls = hullDesignClass(f);
  assert.equal(cls.levels.core, 2);
  assert.ok(cls.deadMounts >= 10, `martwe gniazda ${cls.deadMounts}`);
  applyHullDesignPower(f, cls);
  assert.notEqual(f.pipeNet, base);
  assert.equal(f.pipeNet.base, base, 'sieć bez oznaczeń w `base`');
  const dead = f.pipeNet.runs.filter((r) => r.dead);
  assert.ok(dead.length > 0, 'martwe biegi');
  assert.ok(dead.every((r) => r.net === 'power'), 'martwe są tylko kable');
  // każdy martwy bieg prowadzi wyłącznie do urządzeń bez prądu: urządzenia na jego końcach — bez prądu
  const nodes = f.pipeNet.graph.nodes;
  for (const r of dead) for (const ends of r.ends) for (const id of ends) {
    const dev = nodes[id].dev;
    if (dev >= 0 && f.expanded.modules[dev].type !== 'reactor') assert.ok(cls.dead.has(dev), `martwy kabel do urządzenia z prądem (${f.expanded.modules[dev].type})`);
  }
  // kabel do urządzenia z prądem nie jest martwy
  for (const r of f.pipeNet.runs.filter((q) => q.net === 'power' && !q.dead)) {
    for (const ends of r.ends) for (const id of ends) {
      const dev = nodes[id].dev;
      if (dev >= 0 && cls.dead.has(dev)) assert.fail(`żywy kabel kończy się na urządzeniu bez prądu (${f.expanded.modules[dev].type})`);
    }
  }
  const c = pipeNetworkCheck(f.pipeNet, f);
  assert.equal(c.freeEnds, 0, 'wolne końce');
  assert.equal(c.outside, 0, 'wiązki poza sylwetką');
  // raster przeliczony (numer biegu w teksturze B)
  assert.ok(f.pipeTex.mask.some((v) => v));
  // bez niedoboru — sieć bez zmian; ponowne oznaczenie liczy się od sieci bazowej
  assert.equal(markPipeNetPower(base, f.expanded.modules, new Set()), base);
  assert.equal(markPipeNetPower(f.pipeNet, f.expanded.modules, new Set()), base);
});

test('straż twardych limitów mostka: akcja zwiększająca przekroczenie odrzucona z komunikatem, zmniejszająca — nie', () => {
  const d = hullDesignPreset('custos');
  const f = fieldOf('custos');
  const mods = f.expanded.modules;
  const before = hullDesignCheck(d, f.area, mods);
  assert.deepEqual(before.issues, []);
  // powierzchnia ponad 10 000 j² (klasa I)
  const big = hullDesignCheck(d, 12000, mods);
  assert.match(hullDesignLimitBreach(before, big), /Powierzchnia/);
  // projekt już ponad limit: dalsze zmniejszanie przechodzi, powiększanie nie
  assert.equal(hullDesignLimitBreach(big, hullDesignCheck(d, 11000, mods)), null);
  assert.match(hullDesignLimitBreach(big, hullDesignCheck(d, 13000, mods)), /Powierzchnia/);
  // gniazdo M w klasie I, gniazdo ponad limit gniazd ciężkich
  const gm = (slot, size) => hullDesignMountOf({ type: 'mount', slot, size });
  const list = hullDesignMountList(mods);
  assert.match(hullDesignMountAddIssue(1, list, gm('main', 'M')), /najwyżej S/);
  assert.equal(hullDesignMountAddIssue(1, list, gm('main', 'S'), 2), null);
  const full = [...list, ...Array.from({ length: 5 }, () => gm('main', 'S'))];
  assert.match(hullDesignMountAddIssue(1, full, gm('special', 'S')), /ciężkich/);
  assert.equal(hullDesignMountAddIssue(1, full, gm('aux', 'S')), null, 'lekkie gniazdo jeszcze wejdzie');
  // broń za duża na gniazdo
  assert.match(hullDesignMountAddIssue(1, list, { slot: 'main', size: 'S', weapon: 'railgun_mk2' }), /za duża/);
});

test('schemat: gniazdo `mount` (typ, rozmiar, broń), wieże jako gniazda główne, poziomy i kolejka mocy', () => {
  const d = normalizeHullDesign({
    bridgeLevel: 9, coreLevel: -2, powerPriority: ['main', 'bogus', 'main', 'shield'],
    modules: [
      { type: 'mount', x: 0, y: 0, slot: 'missile', size: 'L', weapon: 'grad_launcher' },
      { type: 'mount', x: 10, y: 0, slot: 'hangar', size: 'X', weapon: 'nie_ma' },
      { type: 'turret_l', x: 20, y: 0 }, { type: 'hangar', x: 30, y: 0, weapon: '' }
    ]
  });
  assert.equal(d.bridgeLevel, 6);
  assert.equal(d.coreLevel, 0);
  assert.deepEqual(d.powerPriority.slice(0, 2), ['main', 'shield']);
  assert.equal(d.powerPriority.length, 7);
  const g = d.modules.map(hullDesignMountOf);
  assert.deepEqual(g[0], { slot: 'missile', size: 'L', weapon: 'grad_launcher' });
  assert.deepEqual(g[1], { slot: 'main', size: 'M', weapon: undefined }, 'typ hangar tylko z wrót, nieznana broń — typowa');
  assert.deepEqual(g[2], { slot: 'main', size: 'L', weapon: undefined });
  assert.deepEqual(g[3], { slot: 'hangar', size: 'S', weapon: '' });
});
