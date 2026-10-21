// Drednoty w kreatorze kadłubów (klasa VII, tylko NPC — docs/BRIEF-drednot.md, src/data/shipClasses.js): klasa ponad
// drabiną gracza (gracz jej nie wybierze), rdzeń R7 skalibrowany na drednocie TN, preset z klocków „bez czitowania”
// z ramą w jednym kawałku, gniazda na typ wg briefu § 4.2, systemy na stałych miejscach (§ 4.4) i sieć bez wolnych końców,
// mieszczący się w limitach kompozytora (moduły, osprzęt sieci — numer 16-bitowy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHullDesign, expandHullDesign } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, sampleHullField, hullFrameIntegrity } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignPreset, HD_PRESET_KEYS } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_PRESET_CLASS, HD_NPC_PRESET_MOUNTS } from '../src/game/hullDesign/hullDesignSystemSlots.js';
import { HD_SYSTEM_TYPES } from '../src/game/hullDesign/hullDesignSystems.js';
import { pipeNetworkCheck, pipeModuleSdf, rasterPipeNetwork, HD_PIPE_TUNE } from '../src/game/hullDesign/hullDesignPipes.js';
import { isPlayerBuildable, HD_BUILD_LIMITS } from '../src/game/hullDesign/hullDesignBuildable.js';
import { hullDesignClass, hullDesignLevels, hullDesignMountList } from '../src/game/hullDesign/hullDesignClass.js';
import {
  SHIP_CLASSES, SHIP_CLASS_MAX, NPC_SHIP_CLASSES, NPC_CORE_LEVELS, CORE_CALIBRATION_SPARE, DEVICE_MW, shipClass, coreLevel,
  coreLevelMax, classForHull, isNpcClassLevel, mountPowerMW, hullUpkeepMW, shieldMW, weaponPowerMW
} from '../src/data/shipClasses.js';
import { HD_COMPOSER_LIMITS } from '../src/3d/hullDesign/hullComposer.js';

const NPC = ['dreadnought'];
const fields = new Map();
const fieldOf = (key, pipes = false) => {
  const k = `${key}:${pipes}`;
  if (!fields.has(k)) fields.set(k, buildHullField(hullDesignPreset(key), { pipes }));
  return fields.get(k);
};
const count = (list, f) => list.reduce((m, g) => { const k = f(g); m[k] = (m[k] || 0) + 1; return m; }, {});

test('klasa VII tylko dla NPC: poza drabiną gracza (SHIP_CLASSES, SHIP_CLASS_MAX, coreLevelMax), limity z briefu, superbroń', () => {
  assert.equal(SHIP_CLASSES.length, 6);
  assert.equal(SHIP_CLASS_MAX, 6);
  assert.ok(SHIP_CLASSES.every((c) => !c.npcOnly && c.level <= 6), 'drabina gracza bez klasy VII');
  const vii = NPC_SHIP_CLASSES[0];
  assert.deepEqual([vii.level, vii.roman, vii.areaMax, vii.mountsMax, vii.heavyMax, vii.weaponSize], [7, 'VII', 7000000, 80, 48, 'Capital']);
  assert.ok(vii.npcOnly && vii.superweapon.mw === 1000, 'superlaser osiowy 1 000 MW (brief § 5.1)');
  assert.equal(shipClass(7), vii);
  assert.equal(shipClass(9), vii, 'poziom ponad VII → VII');
  assert.equal(coreLevel(7), NPC_CORE_LEVELS[0]);
  assert.equal(NPC_CORE_LEVELS[0].cores, 2, 'R7 = dwa rdzenie razem');
  assert.ok(NPC_CORE_LEVELS[0].mw > 4 * coreLevel(6).mw, 'R7 > 4 × R6');
  // gracz: rdzeń najwyżej R6 (mostek VI), klasa z powierzchni najwyżej VI — nawet dla kadłuba drednota
  assert.equal(coreLevelMax(6), 6);
  assert.equal(coreLevelMax(7), 7);
  assert.equal(classForHull(6.5e6, []), SHIP_CLASS_MAX);
  assert.ok(isNpcClassLevel(7) && !isNpcClassLevel(6));
  // typowa broń gniazda wbudowanego: w klasie VII superbroń klasy, poza nią — mediana (Hexlance)
  assert.equal(mountPowerMW('builtin', 'Capital', undefined, vii), 1000);
  assert.equal(mountPowerMW('builtin', 'Capital', undefined, shipClass(6)), 200);
  assert.equal(mountPowerMW('builtin', 'Capital', 'death_ray', vii), weaponPowerMW('death_ray'), 'przypisana broń ma pierwszeństwo');
});

test('gracz nie wybierze klasy VII: projekt bez pola npc — mostek i rdzeń obcięte do VI / R6; projekt NPC — VII / R7', () => {
  const p = normalizeHullDesign({ bridgeLevel: 7, coreLevel: 7 });
  assert.equal(p.npc, false);
  assert.deepEqual([p.bridgeLevel, p.coreLevel], [6, 6]);
  const n = normalizeHullDesign({ npc: true, bridgeLevel: 7, coreLevel: 9 });
  assert.equal(n.npc, true);
  assert.deepEqual([n.bridgeLevel, n.coreLevel], [7, 7]);
  // rdzeń ponad mostek gracza nie przechodzi (komora rdzenia) — R7 tylko przy mostku VII
  assert.equal(hullDesignLevels(normalizeHullDesign({ bridgeLevel: 6, coreLevel: 7 }), 1e5, []).core, 6);
  assert.equal(hullDesignLevels(n, 1e5, []).core, 7);
  // presety: klasa VII tylko w presetach NPC
  for (const key of HD_PRESET_KEYS) {
    const d = hullDesignPreset(key);
    assert.equal(isNpcClassLevel(d.bridgeLevel), NPC.includes(key), `${key}: klasa ${d.bridgeLevel}`);
    assert.equal(d.npc, NPC.includes(key), `${key}: npc`);
  }
});

test('drednot TN: z klocków „bez czitowania”, rama w jednym kawałku, ~5 400 j. długości, w limitach klasy VII', () => {
  const d = hullDesignPreset('dreadnought');
  assert.deepEqual(HD_PRESET_CLASS.dreadnought, [7, 7]);
  const r = isPlayerBuildable(d);
  assert.ok(r.ok, r.violations.map((v) => v.text).join('; '));
  assert.ok(d.shapes.every((s) => s.kind === 'block'), 'kadłub tylko z klocków');
  assert.ok(d.shapes.length <= HD_BUILD_LIMITS.shapes, `${d.shapes.length} klocków`);
  const f = fieldOf('dreadnought');
  const { pieces, holes } = hullFrameIntegrity(f);
  assert.equal(pieces.length, 1, 'rama w jednym kawałku');
  assert.equal(holes.length, 0, 'bez szpar na wylot');
  const len = f.bounds.maxX - f.bounds.minX, wid = f.bounds.maxY - f.bounds.minY;
  assert.ok(len > 5300 && len < 5560, `długość ${len}`);
  assert.ok(wid > 1500 && wid <= 1800, `szerokość ${wid}`);
  assert.ok(f.area > 5.5e6 && f.area < 7e6, `powierzchnia ${f.area}`);
  const cls = hullDesignClass(f);
  assert.deepEqual([cls.levels.bridge, cls.levels.core], [7, 7]);
  assert.deepEqual(cls.check.issues, []);
  // detal w skali floty TN (nie długość / 1700), siatka klocków stała
  assert.equal(d.detail, 1.25);
  assert.equal(d.grid, 4);
});

test('drednot TN: gniazda na typ wg briefu § 4.2 (67, ciężkich 47) i broń z listy § 4.2', () => {
  const mounts = hullDesignMountList(expandHullDesign(hullDesignPreset('dreadnought')).modules);
  assert.equal(mounts.length, 67);
  assert.equal(mounts.filter((g) => ['main', 'special', 'hangar', 'builtin'].includes(g.slot)).length, 47);
  assert.deepEqual(count(mounts, (g) => `${g.slot} ${g.size}`), {
    'builtin Capital': 1, 'special Capital': 12, 'main L': 16, 'special L': 10, 'aux L': 14, 'missile L': 6, 'hangar S': 8
  });
  assert.deepEqual(count(mounts, (g) => `${g.slot}:${g.weapon ?? '—'}`), {
    'builtin:—': 1, 'special:special_yamato_cannon': 12, 'main:helios_lance_l': 8, 'main:heavy_autocannon_l': 8,
    'special:—': 10, 'aux:ciws_mk2': 8, 'aux:flak_l': 6, 'missile:siege_torpedo': 4, 'missile:missile_rack': 2, 'hangar:—': 8
  });
  // dane gniazd: pary w lustrze (y < 0) i oś
  for (const g of HD_NPC_PRESET_MOUNTS.dreadnought) assert.ok(g.y <= 0, `(${g.x}, ${g.y})`);
});

test('drednot TN: systemy na stałych miejscach — 2 rdzenie w obudowach, 3 mostki, 4 zbiorniki, 8 MAIN, 12 SIDE, 4 generatory tarczy, 2 projektory studni', () => {
  const mods = expandHullDesign(hullDesignPreset('dreadnought')).modules;
  const n = count(mods.filter((m) => HD_SYSTEM_TYPES.includes(m.type)), (m) => m.type);
  assert.deepEqual(n, { reactor: 2, bridge: 3, fuel_tank: 4, engine: 8, thruster_side: 12, shield_gen: 4, grav_proj: 2 });
  assert.ok(mods.filter((m) => HD_SYSTEM_TYPES.includes(m.type)).every((m) => m.lock), 'systemy presetu zablokowane');
  assert.ok(mods.filter((m) => m.type === 'reactor').every((m) => m.v === 2 && m.r > 30), 'gniazda obudowy R7');
  assert.deepEqual(mods.filter((m) => m.type === 'bridge' && m.y === 0).map((m) => m.x), [-1790], 'mostek główny na rufie, na osi');
  assert.deepEqual(mods.filter((m) => m.type === 'grav_proj').map((m) => m.y), [0, 0], 'projektory na grzbiecie');
  // dysze: MAIN + SIDE = sufit 20 stref dysz na kadłub w grze (src/3d/hullLacquer.js)
  assert.equal(n.engine + n.thruster_side, 20);
});

test('drednot TN: gniazda w kadłubie, bez nakładania na siebie, na systemy i obudowy rdzeni', () => {
  const f = fieldOf('dreadnought');
  const mods = f.expanded.modules;
  const D = f.expanded.design.detail;
  const mounts = mods.filter((m) => m.type === 'mount');
  const hard = mods.filter((m) => HD_SYSTEM_TYPES.includes(m.type) || m.type === 'hangar');
  const housings = mods.filter((m) => m.type === 'reactor').map((m) => ({ x: m.x, y: m.y, R: m.r * 1.3 + D }));
  for (const m of mounts) {
    const F = m.r * 1.16;
    assert.ok(sampleHullField(f, 0, m.x, m.y) <= -F, `gniazdo ${m.slot} (${m.x}, ${m.y}) za płytko`);
    for (const q of hard) assert.ok(pipeModuleSdf(q, m.x, m.y) >= F, `gniazdo (${m.x}, ${m.y}) na ${q.type} (${q.x}, ${q.y})`);
    for (const h of housings) assert.ok(Math.hypot(m.x - h.x, m.y - h.y) >= h.R + F, `gniazdo (${m.x}, ${m.y}) na obudowie rdzenia`);
    for (const q of mounts) if (q !== m) assert.ok(Math.hypot(q.x - m.x, q.y - m.y) >= F + q.r * 1.16, `gniazda (${m.x}, ${m.y}) i (${q.x}, ${q.y})`);
  }
});

test('drednot TN: sieć systemów — 0 wolnych końców i wiązek poza obrysem, prąd i paliwo wszędzie, przyłącza paliwa widoczne, w limitach kompozytora', () => {
  const f = fieldOf('dreadnought', true);
  const net = f.pipeNet;
  const c = pipeNetworkCheck(net, f);
  assert.equal(c.freeEnds, 0, 'wolne końce');
  assert.equal(c.outside, 0, 'poza obrysem');
  assert.deepEqual(c.unpowered, []);
  assert.deepEqual(c.unfueled, []);
  assert.deepEqual(c.fuelHidden, []);
  assert.ok(net.mirror, 'sieć w lustrze (każdy moduł ma bliźniaka)');
  assert.ok(net.runs.length <= HD_PIPE_TUNE.maxRuns && net.runs.length < HD_COMPOSER_LIMITS.pipeRuns, `${net.runs.length} biegów`);
  assert.ok(net.fits.length <= HD_PIPE_TUNE.maxFits && net.fits.length < HD_COMPOSER_LIMITS.pipeFits, `${net.fits.length} osprzętu`);
  assert.ok(net.fits.length > 255, 'osprzętu więcej niż 8-bitowy numer — cały w rastrze (16 bitów)');
  assert.ok(f.expanded.modules.length <= HD_COMPOSER_LIMITS.modules, `${f.expanded.modules.length} modułów`);
  assert.ok(f.expanded.decals.length <= HD_COMPOSER_LIMITS.decals);
  // raster: numer osprzętu ponad 255 zapisany na dwóch bajtach (G + 256 · A)
  const pt = rasterPipeNetwork(net, f.grid);
  let maxFit = 0;
  for (let k = 0; k < pt.mask.length; k++) maxFit = Math.max(maxFit, pt.b[k * 4 + 1] + 256 * pt.b[k * 4 + 3]);
  assert.ok(maxFit > 255 && maxFit <= net.fits.length, `największy numer osprzętu w rastrze ${maxFit}`);
});

test('drednot TN: rdzeń R7 skalibrowany jak R1–R6 — utrzymanie, tarcza, projektory i broń z briefu zajmują ~80% mocy', () => {
  const cls = hullDesignClass(fieldOf('dreadnought'));
  const p = cls.power;
  assert.ok(Math.abs(p.spareFrac - CORE_CALIBRATION_SPARE) <= 0.05, `zapas ${(p.spareFrac * 100).toFixed(1)}% (R7 ${p.capacity} MW)`);
  assert.equal(cls.deadMounts, 0);
  // rachunek wprost: utrzymanie 0,07 · pow^0,6, tarcza ½, 2 projektory, broń § 4.2 (superlaser 1 000 w gnieździe wbudowanym)
  const area = cls.area;
  const dev = p.devices.filter((d) => d.cat === 'device');
  assert.equal(dev.length, 2);
  assert.ok(dev.every((d) => d.mw === DEVICE_MW.gravWell));
  assert.equal(p.devices.find((d) => d.cat === 'builtin').mw, 1000);
  const weapons = p.devices.filter((d) => d.i >= 0).reduce((a, d) => a + d.mw, 0);
  assert.ok(Math.abs(p.used - (hullUpkeepMW(area) + shieldMW(area) + 2 * DEVICE_MW.gravWell + weapons)) < 1e-6);
  assert.ok(Math.abs(weapons - 2592) < 1, `broń ${weapons} MW (brief: ~2 590)`);
});

test('drednot TN: niedobór mocy — tarcza bez prądu gasi generatory tarczy, projektory w kolejce jako urządzenia', () => {
  const prio = ['main', 'special', 'aux', 'missile', 'builtin', 'hangar', 'device', 'shield'];
  const f = buildHullField({ ...hullDesignPreset('dreadnought'), powerPriority: prio }, { pipes: false });
  const full = hullDesignClass(f);
  assert.ok(full.power.devices.every((d) => d.on), 'na R7 wszystko z prądem');
  // ten sam kadłub na rdzeniu R6 (1 150 MW): broń z przodu kolejki, tarcza i urządzenia na końcu — bez prądu
  const low = hullDesignClass({ ...f, expanded: { ...f.expanded, design: { ...f.expanded.design, coreLevel: 6 } } });
  assert.equal(low.levels.core, 6);
  assert.equal(low.power.devices.find((d) => d.cat === 'shield').on, false, 'tarcza bez prądu');
  const idx = (type) => f.expanded.modules.map((m, i) => (m.type === type ? i : -1)).filter((i) => i >= 0);
  assert.equal(idx('shield_gen').length, 4);
  assert.ok(idx('shield_gen').every((i) => low.dead.has(i)), 'generatory tarczy martwe');
  assert.ok(idx('grav_proj').every((i) => low.dead.has(i)), 'projektory bez prądu');
  assert.ok(!idx('shield_gen').some((i) => full.dead.has(i)));
});
