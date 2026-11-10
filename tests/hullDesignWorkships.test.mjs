// Statki robocze złomowania w kreatorze kadłubów (decyzje użytkownika 2026-11-10): moduły-GNIAZDA pod ruchome części
// (obrotnica wysięgnika / dźwigu — zwykłe gniazdo broni, paszcza, gardziel młyna, rampa, gniazdo dampera, kosz otwarty
// od góry), paleta „Roboczy”, sześć presetów o różnych kształtach (src/game/hullDesign/workships/) i KONTRAKT DLA GRY —
// osprzęt w ułamkach długości kadłuba liczony z pozycji modułów (src/game/hullDesign/hullDesignWorkRig.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeHullDesign, hullDesignMountOf, HD_MODULES, HD_MOUNT_MODULES, HD_PALETTES, HD_PALETTE_EMBLEM
} from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, hullFrameIntegrity } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignRecipe, hullDesignMounts } from '../src/game/hullDesign/hullDesignRecipe.js';
import { hullDesignClass } from '../src/game/hullDesign/hullDesignClass.js';
import { powerLoad, fuelLoad, HD_SYSTEM_ROLE } from '../src/game/hullDesign/hullDesignSystems.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { hullCargoGrid, isOpenCargo, isTopCargo } from '../src/game/hullDesign/hullDesignCargo.js';
import { isPlayerBuildable } from '../src/game/hullDesign/hullDesignBuildable.js';
import { HD_PRESETS, HD_PRESET_GROUPS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_WORKSHIPS, HD_WORKSHIP_KEYS } from '../src/game/hullDesign/workships/index.js';
import { hullDesignWorkRig, hasWorkRig, HD_WORK_RIG_FIELDS } from '../src/game/hullDesign/hullDesignWorkRig.js';
import { HD_COMPOSER_LIMITS } from '../src/3d/hullDesign/hullComposer.js';
import { classForHull } from '../src/data/shipClasses.js';

const WORK_TYPES = ['rig', 'maw', 'mill', 'ramp', 'damper'];

/** Pola (z siecią systemów) presetów roboczych — liczone raz. */
const fields = new Map();
const fieldOf = (key) => {
  if (!fields.has(key)) fields.set(key, buildHullField(hullDesignPreset(key)));
  return fields.get(key);
};
const rigOf = (key) => hullDesignWorkRig(fieldOf(key));
/** Wymiary okrętu floty TN w kreatorze [długość, szerokość] — wraki, które mają się mieścić w komorach. */
const sizeOf = (key) => {
  const b = buildHullField(hullDesignPreset(key), { pipes: false }).bounds;
  return [b.maxX - b.minX, b.maxY - b.minY];
};

test('moduły-gniazda statków roboczych: kody, etykiety, kabel zasilania, bez paliwa; obrotnica to gniazdo broni', () => {
  assert.deepEqual(WORK_TYPES.map((t) => HD_MODULES[t].code), [16, 17, 18, 19, 20]);
  const codes = Object.values(HD_MODULES).map((m) => m.code);
  assert.equal(new Set(codes).size, codes.length, 'kody modułów bez powtórzeń');
  for (const t of WORK_TYPES) {
    assert.ok(HD_MODULES[t].label, `${t}: etykieta`);
    assert.ok(powerLoad({ type: t }) >= 1, `${t}: urządzenie sieci zasilania`);
    assert.equal(fuelLoad({ type: t }), 0, `${t}: bez rur paliwa`);
    assert.equal(HD_SYSTEM_ROLE[t], undefined, `${t}: nie jest źródłem ani silnikiem`);
    assert.ok(Object.keys(HD_MODULES[t].parts).length >= 1, `${t}: komponenty receptury`);
  }
  // lasery tnące i dźwigi siedzą w ZWYKŁYCH gniazdach broni: obrotnica = gniazdo główne z rozmiarem
  assert.deepEqual({ ...HD_MOUNT_MODULES.rig }, { slot: 'main', size: 'M' });
  assert.deepEqual(hullDesignMountOf({ type: 'rig', r: 12 }), { slot: 'main', size: 'M', weapon: undefined });
  assert.equal(hullDesignMountOf({ type: 'rig', r: 80, size: 'L' }).size, 'L');
  assert.equal(powerLoad({ type: 'rig', size: 'L' }), 2, 'duża obrotnica — gruby kabel jak wieża L');
  for (const t of ['maw', 'mill', 'ramp', 'damper']) assert.equal(hullDesignMountOf({ type: t }), null, `${t}: nie jest gniazdem broni`);
});

test('normalizacja: warianty obrotnicy, liczba walców młyna, kosz (ładownia v 4) liczony jak stelaż', () => {
  const d = normalizeHullDesign({
    modules: [
      { type: 'rig', x: 10, y: -20, r: 12, v: 1, size: 'L' }, { type: 'mill', x: 0, y: 0, w: 30, h: 50, n: 3 },
      { type: 'cargo', x: -60, y: 0, w: 40, h: 30, v: 4 }, { type: 'cargo', x: -160, y: 0, w: 40, h: 30, v: 9 },
      { type: 'maw', x: 90, y: 0 }, { type: 'ramp', x: -200, y: 0, rot: Math.PI }, { type: 'damper', x: 0, y: -80 }
    ]
  });
  const by = (t) => d.modules.filter((m) => m.type === t);
  assert.deepEqual([by('rig')[0].v, by('rig')[0].size, by('rig')[0].r], [1, 'L', 12]);
  assert.equal(by('mill')[0].n, 3);
  assert.deepEqual(by('cargo').map((m) => m.v), [4, 4], 'wariant ładowni 0–4');
  assert.deepEqual([by('maw')[0].w, by('maw')[0].h], [HD_MODULES.maw.w, HD_MODULES.maw.h], 'wymiary domyślne');
  assert.equal(by('ramp')[0].rot, Math.PI);
  const bin = { type: 'cargo', w: 40, h: 30, v: 4 }, rack = { ...bin, v: 2 };
  assert.equal(hullCargoGrid(bin, 0.3).containers, hullCargoGrid(rack, 0.3).containers);
  assert.ok(isTopCargo(bin) && !isOpenCargo(bin) && isOpenCargo(rack) && !isTopCargo(rack));
});

test('kompozytor: każdy kod modułu ma gałąź rysunku (kod bez gałęzi się nie rysuje), wariant kosza też', () => {
  const src = readFileSync(new URL('../src/3d/hullDesign/hullComposer.js', import.meta.url), 'utf8');
  for (const [type, def] of Object.entries(HD_MODULES)) {
    if (type === 'mount') continue;                      // gniazdo `mount` idzie gałęzią wież (_mountLook)
    const c = def.code;
    const hit = src.includes(`type.lessThan(${c}.5)`) || (c <= 3 && src.includes('type.lessThan(3.5)'));
    assert.ok(hit, `${type} (kod ${c}): brak gałęzi type.lessThan(${c}.5) w kompozytorze`);
  }
  assert.ok(/B\.w\.greaterThan\(3\.5\)/.test(src), 'gałąź kosza (cargo v 4)');
  assert.ok(src.includes("m.type === 'mill'"), 'liczba walców młyna w uniformie modułu');
});

test('paleta „Roboczy”: komplet barw, bez emblematu nacji', () => {
  assert.ok(HD_PALETTES.work && HD_PALETTES.work.label);
  assert.deepEqual(Object.keys(HD_PALETTES.work).sort(), Object.keys(HD_PALETTES.freight).sort());
  assert.equal(HD_PALETTE_EMBLEM.work, null);
});

test('rejestr: sześć statków roboczych w grupie „Statki robocze”, rola cywilna, paleta, klasa z pliku', () => {
  assert.deepEqual([...HD_WORKSHIP_KEYS], ['zlomiarz', 'paszcza', 'mlyn', 'rafineria', 'rampowiec', 'dzwig']);
  assert.ok(HD_PRESET_GROUPS.work);
  for (const f of HD_WORKSHIPS) {
    assert.equal(HD_PRESETS[f.key]?.group, 'work', `${f.key}: grupa`);
    const d = hullDesignPreset(f.key);
    assert.equal(d.role, 'civil', `${f.key}: rola`);
    assert.equal(d.palette, 'work', `${f.key}: paleta`);
    assert.deepEqual([d.bridgeLevel, d.coreLevel], f.cls, `${f.key}: klasa z pliku presetu`);
  }
});

test('każdy statek roboczy: tylko narzędzia gracza, rama w jednej bryle, receptura, klasa, sieć systemów, limit modułów', () => {
  for (const key of HD_WORKSHIP_KEYS) {
    const d = hullDesignPreset(key);
    const b = isPlayerBuildable(d);
    assert.ok(b.ok, `${key}: ${b.violations.slice(0, 3).map((v) => v.text).join('; ')}`);
    const integ = hullFrameIntegrity(buildHullField(d, { pipes: false }));
    assert.deepEqual([integ.pieces.length, integ.holes.length], [1, 0], `${key}: rama`);
    const f = fieldOf(key);
    const r = hullDesignRecipe(f);
    assert.deepEqual(r.warnings.map((w) => w.text), [], `${key}: receptura`);
    const cls = hullDesignClass(f);
    assert.deepEqual(cls.check.issues.map((i) => i.text), [], `${key}: limity klasy`);
    assert.equal(d.bridgeLevel, classForHull(f.area, cls.mounts, d.role), `${key}: klasa = najniższa z powierzchni`);
    assert.ok(cls.power.spareFrac > 0.15, `${key}: zapas mocy ${cls.power.spareFrac}`);
    const c = pipeNetworkCheck(f.pipeNet, f);
    assert.deepEqual([f.pipeNet.stats.unrouted, c.freeEnds, c.outside, c.unpowered.length, c.unfueled.length], [0, 0, 0, 0, 0], `${key}: sieć`);
    assert.ok(f.expanded.modules.length <= HD_COMPOSER_LIMITS.modules, `${key}: modułów ${f.expanded.modules.length}`);
    // gniazda pod ruchome części leżą na kadłubie
    for (const m of f.expanded.modules) if (WORK_TYPES.includes(m.type)) assert.ok(r.counts[m.type] >= 1);
  }
});

test('różne kształty: każdy statek ma inne proporcje sylwetki i własny zestaw gniazd', () => {
  const sig = HD_WORKSHIP_KEYS.map((k) => {
    const f = fieldOf(k), b = f.bounds;
    const L = b.maxX - b.minX, Wd = b.maxY - b.minY;
    return { k, aspect: L / Wd, fill: f.area / (L * Wd), rig: HD_WORK_RIG_FIELDS.filter((q) => rigOf(k)[q]).join('+') };
  });
  for (let i = 0; i < sig.length; i++) {
    for (let j = i + 1; j < sig.length; j++) {
      const a = sig[i], b = sig[j];
      const shape = Math.abs(a.aspect - b.aspect) > 0.12 || Math.abs(a.fill - b.fill) > 0.04;
      assert.ok(shape, `${a.k} i ${b.k}: te same proporcje (${a.aspect.toFixed(2)} / ${a.fill.toFixed(2)})`);
      assert.notEqual(a.rig, b.rig, `${a.k} i ${b.k}: ten sam zestaw osprzętu (${a.rig})`);
    }
  }
});

test('złomiarz: 2–4 obrotnice wysięgników wokół dziobu, 1–2 dźwigi przy koszu na śródokręciu, klasa II–III', () => {
  const r = rigOf('zlomiarz'), d = hullDesignPreset('zlomiarz');
  assert.ok(d.bridgeLevel >= 2 && d.bridgeLevel <= 3);
  assert.ok(r.mounts.length >= 2 && r.mounts.length <= 4, `wysięgników ${r.mounts.length}`);
  assert.ok(r.mounts.every(([x]) => x > 0.15), 'wysięgniki w dziobowej części');
  assert.ok(r.cranes.length >= 1 && r.cranes.length <= 2);
  assert.equal(r.holdTop, true, 'ładownia otwarta od góry');
  assert.ok(Math.abs(r.hold[0]) < 0.12 && r.hold[1] === 0, `kosz na śródokręciu, na osi: ${r.hold}`);
  for (const [x, y] of r.cranes) assert.ok(Math.abs(x - r.hold[0]) < r.holdSize[0] && Math.abs(y) < 0.3, 'dźwig przy ładowni');
  assert.ok(fieldOf('zlomiarz').expanded.modules.some((m) => isTopCargo(m)), 'kosz v 4');
  assert.equal(r.maw, undefined); assert.equal(r.ramp, undefined);
});

test('paszcza: szczęki na dziobie i komora wzdłuż osi na cały kadłub niszczyciela, klasa IV–V', () => {
  const r = rigOf('paszcza'), d = hullDesignPreset('paszcza');
  assert.ok(d.bridgeLevel >= 4 && d.bridgeLevel <= 5);
  assert.ok(r.maw[0] > 0.3 && r.maw[1] === 0, `paszcza na dziobie, na osi: ${r.maw}`);
  assert.ok(r.maw[0] + r.mawLen / 2 > 0.45, 'szczęki sięgają dziobu');
  assert.equal(r.holdTop, false, 'komora pod wrotami — wrak wchodzi paszczą, nie od góry');
  assert.equal(r.hold[1], 0);
  const [hl, hw] = sizeOf('hasta');
  assert.ok(r.holdSize[0] * r.L >= hl * 1.05 && r.holdSize[1] * r.L >= hw * 1.05,
    `komora ${(r.holdSize[0] * r.L).toFixed(0)} × ${(r.holdSize[1] * r.L).toFixed(0)} j. ≥ Hasta ${hl.toFixed(0)} × ${hw.toFixed(0)} j.`);
  assert.ok(r.mawR * r.L * 2 >= hw, 'rozwarcie szczęk ≥ szerokość niszczyciela');
});

test('młyn: gardziel na dziobie, za nią kosze na złom, złącza przeładunku na obu burtach, klasa III–IV', () => {
  const r = rigOf('mlyn'), d = hullDesignPreset('mlyn');
  assert.ok(d.bridgeLevel >= 3 && d.bridgeLevel <= 4);
  assert.ok(r.mill[0] > 0.3 && r.mill[1] === 0, `gardziel na dziobie: ${r.mill}`);
  assert.ok(r.millRolls >= 2);
  assert.ok(r.holds.length >= 2 && r.holds.every(([x]) => x < r.mill[0]), 'zasobniki za gardzielą');
  assert.equal(r.holdTop, true);
  assert.ok(r.ports.some(([, y]) => y < 0) && r.ports.some(([, y]) => y > 0), 'złącza na obu burtach');
});

test('rafineria: zbiorniki i piece, złącza przeładunku po obu burtach, klasa IV', () => {
  const r = rigOf('rafineria'), d = hullDesignPreset('rafineria');
  assert.equal(d.bridgeLevel, 4);
  const tanks = fieldOf('rafineria').expanded.modules.filter((m) => m.type === 'cargo_tank');
  assert.ok(tanks.length >= 4 && tanks.some((m) => (m.v || 0) === 0) && tanks.some((m) => m.v === 1), 'walce i kule');
  assert.ok(r.ports.filter(([, y]) => y < 0).length >= 1 && r.ports.filter(([, y]) => y > 0).length >= 1);
  // staje burta w burtę z młynem: złącza przy samej burcie (ostatnie 8% pół-szerokości)
  for (const [, y] of r.ports) assert.ok(Math.abs(y) > r.W / 2 * 0.9, `złącze przy burcie: ${y} z ${r.W / 2}`);
  assert.equal(r.hold, undefined, 'bez ładowni — ładunek w zbiornikach');
});

test('frachtowiec z rampą: rampa rufowa na osi i ładownia-tunel na cały wrak pancernika, klasa V–VI', () => {
  const r = rigOf('rampowiec'), d = hullDesignPreset('rampowiec');
  assert.ok(d.bridgeLevel >= 5);
  assert.ok(r.ramp[0] < -0.3 && r.ramp[1] === 0, `rampa na rufie, na osi: ${r.ramp}`);
  assert.deepEqual(r.rampDir, [-1, 0], 'klapa opada ku rufie');
  assert.equal(r.holdTop, false, 'tunel pod wrotami — wraki wjeżdżają rampą');
  const [bl, bw] = sizeOf('bellator');
  assert.ok(r.holdSize[0] * r.L >= bl * 1.03 && r.holdSize[1] * r.L >= bw * 1.03,
    `tunel ${(r.holdSize[0] * r.L).toFixed(0)} × ${(r.holdSize[1] * r.L).toFixed(0)} j. ≥ Bellator ${bl.toFixed(0)} × ${bw.toFixed(0)} j.`);
  // rampa otwiera wejście do tunelu: styka się z nim od rufy
  assert.ok(Math.abs((r.ramp[0] + r.rampSize[0] / 2) - (r.hold[0] - r.holdSize[0] / 2)) < 0.02, 'rampa przy rufowym końcu tunelu');
  // gondole nie zasłaniają rampy: wszystkie dysze MAIN poza szerokością klapy
  const mt = hullDesignMounts(fieldOf('rampowiec')).mainThrusters;
  for (const t of mt) assert.ok(Math.abs(t.y) > r.rampSize[1] / 2 * r.L, 'dysza MAIN poza rampą');
});

test('dźwig: jedna ogromna obrotnica na śródokręciu, cztery dampery w narożach, mała ładownia, klasa IV–V', () => {
  const r = rigOf('dzwig'), d = hullDesignPreset('dzwig');
  assert.ok(d.bridgeLevel >= 4 && d.bridgeLevel <= 5);
  assert.equal(r.cranes.length, 1);
  assert.ok(Math.abs(r.cranes[0][0]) < 0.1 && r.cranes[0][1] === 0, `obrotnica na śródokręciu: ${r.cranes[0]}`);
  assert.ok(r.craneR > 0.12, `ogromna obrotnica: promień ${r.craneR} L`);
  assert.ok(r.craneR > 3 * rigOf('zlomiarz').craneR * rigOf('zlomiarz').L / r.L, 'kilka razy większa niż dźwigi złomiarza');
  assert.equal(r.dampers.length, 4);
  const quad = new Set(r.dampers.map(([x, y]) => `${Math.sign(x)}${Math.sign(y)}`));
  assert.equal(quad.size, 4, 'po jednym damperze w każdym narożu');
  for (const [x, y] of r.dampers) assert.ok(Math.abs(x) > 0.25 && Math.abs(y) > r.W / 2 * 0.6, `damper w narożu: ${x}, ${y}`);
  r.dampers.forEach(([, y], i) => assert.equal(Math.sign(r.damperDir[i][1]), Math.sign(y), 'podpora wysuwa się na zewnątrz'));
  assert.ok(r.holdSize[0] * r.holdSize[1] < 0.06, 'mała ładownia');
  assert.equal(hullDesignClass(fieldOf('dzwig')).mounts.length, 1, 'obrotnica to jedyne gniazdo broni');
});

test('kontrakt dla gry: ułamki długości kadłuba z pozycji modułów (x — dziób, y — prawa burta, początek w środku)', () => {
  // kadłub 700 × 240 j. jak złomiarz NPC gry: paszcza 0,455 L, wysięgniki [0,33; ∓0,105]
  const L = 700;
  const at = (fx, fy) => ({ x: fx * L, y: fy * L });
  const base = (mods) => normalizeHullDesign({
    v: 2, role: 'civil', mirror: false, detail: 0.4, grid: 2, pipeNet: { density: 0 },
    shapes: [{ kind: 'block', shape: 'rect', x: 0, y: 0, w: L, h: 240, level: 0 }], modules: mods
  });
  const mods = [
    { type: 'maw', ...at(0.455, 0), w: 30, h: 0.065 * L },
    { type: 'rig', ...at(0.33, -0.105), r: 14, v: 0 }, { type: 'rig', ...at(0.33, 0.105), r: 14, v: 0 },
    { type: 'rig', ...at(0, -0.12), r: 20, v: 1 },
    { type: 'cargo', ...at(-0.1, 0), w: 70, h: 49, v: 4 },
    { type: 'ramp', ...at(-0.45, 0), w: 28, h: 70, rot: Math.PI },
    { type: 'mill', ...at(0.2, 0.1), w: 20, h: 35, n: 4, rot: Math.PI / 2 },
    { type: 'damper', ...at(-0.3, -0.14), w: 14, h: 14, rot: -Math.PI / 2 },
    { type: 'well', ...at(0.1, 0.15), r: 6, v: 0 }, { type: 'well', ...at(0.1, -0.15), r: 6, v: 1 }
  ];
  const f = buildHullField(base(mods), { pipes: false });
  const r = hullDesignWorkRig(f);
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.004, `${msg}: ${a} ≠ ${b}`);
  near(r.L, L, 'długość'); assert.equal(r.front, 0.5);
  near(r.maw[0], 0.455, 'maw x'); assert.equal(r.maw[1], 0); near(r.mawR, 0.065, 'mawR'); near(r.mawLen, 60 / L, 'mawLen');
  assert.equal(r.mounts.length, 2);
  near(r.mounts[0][0], 0.33, 'mounts x'); near(r.mounts[0][1], -0.105, 'lewa burta pierwsza'); near(r.mounts[1][1], 0.105, 'prawa burta');
  near(r.mountR, 14 / L, 'mountR');
  assert.equal(r.cranes.length, 1); near(r.cranes[0][1], -0.12, 'crane y'); near(r.craneR, 20 / L, 'craneR');
  near(r.hold[0], -0.1, 'hold x'); near(r.holdSize[0], 140 / L, 'hold długość'); near(r.holdSize[1], 98 / L, 'hold szerokość');
  assert.equal(r.holdTop, true); assert.equal(r.holds, undefined, 'jedna ładownia — bez listy');
  near(r.ramp[0], -0.45, 'ramp x'); assert.deepEqual(r.rampDir, [-1, 0]); near(r.rampSize[1], 140 / L, 'ramp szerokość');
  // młyn obrócony o 90°: wymiary w osiach OKRĘTU (wzdłuż = 2h, w poprzek = 2w)
  near(r.millSize[0], 70 / L, 'mill wzdłuż'); near(r.millSize[1], 40 / L, 'mill w poprzek'); assert.equal(r.millRolls, 4);
  near(r.dampers[0][1], -0.14, 'damper y'); assert.deepEqual(r.damperDir, [[0, -1]]);
  assert.equal(r.ports.length, 1, 'złącze = pierścień v 0 (iluminator v 1 nie)'); near(r.ports[0][1], 0.15, 'port y');
  assert.ok(hasWorkRig(r));

  // liczy się z pozycji modułów: przesunięcie gniazda zmienia tabelę
  const moved = mods.map((m) => (m.type === 'maw' ? { ...m, x: m.x - 70 } : m));
  near(hullDesignWorkRig(buildHullField(base(moved), { pipes: false })).maw[0], 0.355, 'paszcza po przesunięciu');
  // kadłub bez osprzętu roboczego: same wymiary
  const plain = hullDesignWorkRig(buildHullField(base([{ type: 'vent', x: 0, y: 0 }]), { pipes: false }));
  assert.deepEqual(Object.keys(plain), ['L', 'W', 'front']);
  assert.ok(!hasWorkRig(plain));
});

test('kontrakt presetów: symetria burt, pola tylko tych gniazd, które statek ma, obrotnice są gniazdami broni receptury', () => {
  const want = {
    zlomiarz: ['mounts', 'cranes', 'hold'], paszcza: ['maw', 'hold'], mlyn: ['hold', 'mill', 'ports'],
    rafineria: ['ports'], rampowiec: ['hold', 'ramp'], dzwig: ['cranes', 'hold', 'dampers']
  };
  for (const key of HD_WORKSHIP_KEYS) {
    const r = rigOf(key);
    assert.deepEqual(HD_WORK_RIG_FIELDS.filter((q) => r[q]), want[key], `${key}: pola osprzętu`);
    assert.equal(r.front, 0.5, `${key}: dziób`);
    for (const q of ['mounts', 'cranes', 'dampers', 'ports']) {
      for (const [x, y] of r[q] || []) {
        if (y === 0) continue;
        assert.ok(r[q].some(([x2, y2]) => x2 === x && y2 === -y), `${key}.${q}: [${x}; ${y}] bez pary na drugiej burcie`);
      }
    }
    // obrotnice = gniazda broni mocowań (hardpoints) — zwykłe gniazda główne
    const hp = hullDesignMounts(fieldOf(key)).hardpoints;
    assert.equal(hp.length, (r.mounts?.length || 0) + (r.cranes?.length || 0), `${key}: gniazd broni`);
    assert.ok(hp.every((h) => h.type === 'main'));
  }
});
