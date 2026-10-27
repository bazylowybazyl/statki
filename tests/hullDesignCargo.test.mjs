// Statki cywilne w kreatorze kadłubów (frachtowce, decyzje użytkownika 2026-10-27): rola projektu, nazwy klas cywilnych
// na tych samych progach powierzchni, klasa VI cywilna bez limitu powierzchni, receptura bez wymogu broni, bilans mocy bez
// tarczy, ŁADUNEK (src/game/hullDesign/hullDesignCargo.js — kontener gry, stelaż, zasobniki, zbiorniki ładunku bez rur
// paliwa) i ZAŁADUNEK jako wygląd (klucz wyglądu i klucze budowy bez zmian).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHullDesign, expandHullDesign, hullDesignShapeKey, hullDesignLookKey, HD_MODULES, HD_PALETTES, HD_PALETTE_EMBLEM } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignRecipe, hullDesignMounts } from '../src/game/hullDesign/hullDesignRecipe.js';
import { hullDesignClass } from '../src/game/hullDesign/hullDesignClass.js';
import { hullDesignSystems, powerLoad, fuelLoad, HD_SYSTEM_TYPES } from '../src/game/hullDesign/hullDesignSystems.js';
import { HD_CARGO, hullCargoBox, hullCargoFit, hullCargoGrid, hullDesignCargo } from '../src/game/hullDesign/hullDesignCargo.js';
import { createHullDesignBuilder } from '../src/game/hullDesign/hullDesignBuild.js';
import { pipeModuleSdf } from '../src/game/hullDesign/hullDesignPipes.js';
import { HD_PRESETS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_FREIGHTERS } from '../src/game/hullDesign/freighters/index.js';
import { SHIP_CLASSES, SHIP_CLASS_MAX, shipClassLabel, shipClassCheck, classForHull } from '../src/data/shipClasses.js';
import { bridgeLevel } from '../src/data/bridgeLevels.js';
import { CARGO_CONTAINER, CARGO_TONNES_DEFAULT } from '../src/data/cargoBays.js';

/** Frachtowiec próbny 320 × 96 j.: rama, płyty, nadbudówka, systemy, stelaż, zasobniki, walec i kule ładunku. */
const freighter = (o = {}) => ({
  v: 2, name: 'Próbny frachtowiec', role: 'civil', palette: 'freight', style: 'chamfer', mirror: true, detail: 0.18, grid: 1,
  pipeNet: { density: 1 },
  shapes: [
    { kind: 'block', shape: 'rect', x: 0, y: 0, w: 320, h: 96, level: 0 },
    { kind: 'block', shape: 'rect', x: 0, y: 0, w: 316, h: 92, level: 1 },
    { kind: 'block', shape: 'rect', x: 130, y: 0, w: 40, h: 56, level: 2 }
  ],
  modules: [
    { type: 'engine', x: -150, y: -26, w: 14, h: 9, n: 2 },
    { type: 'reactor', x: -118, y: 0, r: 8, v: 1 },
    { type: 'fuel_tank', x: -120, y: -30, w: 9, h: 4 },
    { type: 'bridge', x: 130, y: 0, v: 2 },
    { type: 'cargo', x: 40, y: -26, w: 62, h: 18, v: 2 },
    { type: 'cargo', x: -58, y: -26, w: 35, h: 18, v: 3, n: 2 },
    { type: 'cargo_tank', x: 40, y: 0, w: 62, h: 7, v: 0, n: 1 },
    { type: 'cargo_tank', x: -58, y: 0, w: 35, h: 7, v: 1, n: 1 },
    { type: 'thruster_side', x: 100, y: -46, w: 5, h: 4, rot: -Math.PI / 2 }
  ],
  ...o
});

let fCivil = null;
const civilField = () => (fCivil ||= buildHullField(freighter()));

test('rola projektu: domyślnie wojskowa, cywilna przechodzi przez normalizację i zmienia klucz kształtu', () => {
  assert.equal(normalizeHullDesign({}).role, 'military');
  assert.equal(normalizeHullDesign({ role: 'civil' }).role, 'civil');
  assert.equal(normalizeHullDesign({ role: 'pirat' }).role, 'military');
  assert.notEqual(hullDesignShapeKey(normalizeHullDesign({ role: 'civil' })), hullDesignShapeKey(normalizeHullDesign({})));
});

test('klasy cywilne: nazwy na progach I–VI, VI bez limitu powierzchni (megafrachtowce), okręt wojenny — z limitem', () => {
  assert.deepEqual(SHIP_CLASSES.map((c) => c.civil), ['Prom', 'Frachtowiec lekki', 'Frachtowiec', 'Frachtowiec ciężki', 'Transportowiec', 'Megafrachtowiec']);
  assert.equal(shipClassLabel(3, 'civil'), 'Frachtowiec');
  assert.equal(shipClassLabel(3), 'Krążownik');
  assert.equal(classForHull(5000, [], 'civil'), 1);
  assert.equal(classForHull(52000, [], 'civil'), classForHull(52000, []), 'te same progi powierzchni co okręty');
  const big = 1.93e6;
  assert.deepEqual(shipClassCheck({ bridgeLevel: SHIP_CLASS_MAX, coreLevel: SHIP_CLASS_MAX, area: big, role: 'civil' }).issues, []);
  assert.deepEqual(shipClassCheck({ bridgeLevel: SHIP_CLASS_MAX, coreLevel: SHIP_CLASS_MAX, area: big }).issues.map((i) => i.code), ['area']);
  assert.equal(classForHull(big, [], 'civil'), SHIP_CLASS_MAX);
  // niższe klasy cywilne dalej mają limit powierzchni (klasa z powierzchni)
  assert.deepEqual(shipClassCheck({ bridgeLevel: 1, coreLevel: 1, area: 20000, role: 'civil' }).issues.map((i) => i.code), ['area']);
});

test('receptura i bilans: cywil bez broni — bez ostrzeżenia i bez tarczy; ten sam kadłub wojenny — ostrzeżenie i tarcza', () => {
  const f = civilField();
  const r = hullDesignRecipe(f);
  assert.deepEqual(r.warnings, [], r.warnings.map((w) => w.text).join('; '));
  const c = hullDesignClass(f);
  assert.equal(c.role, 'civil');
  assert.equal(c.label, shipClassLabel(c.levels.bridge, 'civil'));
  assert.equal(c.power.shield, 0);
  assert.deepEqual(c.check.issues, []);
  const fm = buildHullField(freighter({ role: 'military' }));
  assert.ok(hullDesignRecipe(fm).warnings.some((w) => /Brak gniazd uzbrojenia/.test(w.text)));
  const cm = hullDesignClass(fm);
  assert.ok(cm.power.shield > 0);
  assert.equal(cm.label, SHIP_CLASSES[cm.levels.bridge - 1].label);
});

test('ładunek: kontener gry, stelaż i zasobniki n × n, zbiorniki — siatka, ładowność w recepturze i mocowaniach', () => {
  assert.equal(HD_CARGO.L, CARGO_CONTAINER.L);
  assert.equal(HD_CARGO.W, CARGO_CONTAINER.W);
  assert.equal(HD_CARGO.tonnes, CARGO_TONNES_DEFAULT);
  const D = 0.18;
  const rack = hullCargoGrid({ type: 'cargo', w: 62, h: 18, v: 2 }, D);
  // wnętrze 2 · (62 − 2,2 · 0,18) = 123,2 j. → floor(124,2 / 17) = 7; 2 · (18 − 0,396) = 35,2 → floor(36,2 / 9) = 4
  assert.deepEqual([rack.n, rack.nx, rack.ny, rack.containers], [1, 7, 4, 28]);
  const pods = hullCargoGrid({ type: 'cargo', w: 35, h: 18, v: 3, n: 2 }, D);
  assert.equal(pods.cellL, 2 * CARGO_CONTAINER.L + CARGO_CONTAINER.gap);
  assert.deepEqual([pods.nx, pods.ny, pods.containers], [2, 2, 16]);
  assert.equal(hullCargoGrid({ type: 'cargo', w: 35, h: 18, v: 3 }, D).n, HD_CARGO.podN, 'zasobnik bez n — domyślny');
  assert.equal(hullCargoGrid({ type: 'cargo', w: 5, h: 3, v: 2 }, D).containers, 0, 'za mały stelaż — bez kontenerów');
  // receptura: suma siatek po lustrze (stelaż i zasobniki poza osią — dwa razy), zbiorniki w tonach
  const f = civilField();
  const r = hullDesignRecipe(f);
  const exp = hullDesignCargo(f.expanded.modules, D);
  assert.deepEqual(r.cargo, exp);
  assert.equal(r.cargo.containers, 2 * (28 + 16));
  assert.equal(r.cargo.holds, 4);
  assert.equal(r.cargo.tanks, 2);
  assert.ok(r.cargo.tankTonnes > 0);
  assert.equal(r.cargo.tonnes, r.cargo.containers * CARGO_TONNES_DEFAULT + r.cargo.tankTonnes);
  const mounts = hullDesignMounts(f);
  assert.equal(mounts.cargoBays.length, 4);
  assert.equal(mounts.cargoBays.reduce((s, b) => s + b.containers, 0), r.cargo.containers);
  assert.deepEqual(mounts.cargoTanks.map((t) => t.v).sort(), [0, 1]);
});

test('zbiornik ładunku: osobny typ (kod 15) — kabel pompy, bez rur paliwa do reaktora; system ze stałym miejscem', () => {
  assert.equal(HD_MODULES.cargo_tank.code, 15);
  const codes = Object.values(HD_MODULES).map((m) => m.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(powerLoad({ type: 'cargo_tank' }), 1);
  assert.equal(fuelLoad({ type: 'cargo_tank' }), 0);
  assert.ok(HD_SYSTEM_TYPES.includes('cargo_tank'));
  const mods = expandHullDesign(freighter()).modules;
  const sys = hullDesignSystems(mods);
  const tanks = mods.map((m, i) => (m.type === 'cargo_tank' ? i : -1)).filter((i) => i >= 0);
  assert.equal(tanks.length, 2);
  for (const i of tanks) {
    assert.ok(sys.links.some((l) => l.net === 'power' && l.to === i), 'kabel do zbiornika ładunku');
    assert.ok(!sys.links.some((l) => l.net !== 'power' && (l.to === i || l.from === i)), 'bez rur paliwa');
    assert.ok(!sys.tanks.includes(i), 'nie jest zbiornikiem paliwa');
  }
});

test('sieć próbnego frachtowca: wszystko zasilone, silniki z paliwem, bez wolnych końców', async () => {
  const { pipeNetworkCheck } = await import('../src/game/hullDesign/hullDesignPipes.js');
  const f = civilField();
  const c = pipeNetworkCheck(f.pipeNet, f);
  assert.equal(f.pipeNet.stats.unrouted, 0);
  assert.deepEqual([c.freeEnds, c.outside, c.unpowered.length, c.unfueled.length], [0, 0, 0, 0]);
});

test('załadunek: wygląd — przycięty do 0–1, klucz wyglądu i klucze budowy (geometria, sieć) bez zmian', async () => {
  assert.equal(normalizeHullDesign({}).cargoLoad, 1);
  assert.equal(normalizeHullDesign({ cargoLoad: 0.35 }).cargoLoad, 0.35);
  assert.equal(normalizeHullDesign({ cargoLoad: 7 }).cargoLoad, 1);
  const a = normalizeHullDesign(freighter({ cargoLoad: 1 })), b = normalizeHullDesign(freighter({ cargoLoad: 0.2 }));
  assert.equal(hullDesignLookKey(a), hullDesignLookKey(b));
  assert.notEqual(hullDesignShapeKey(a), hullDesignShapeKey(b));
  const builder = createHullDesignBuilder();
  const ra = await builder.run(a, {});
  const rb = await builder.run(b, {});
  assert.equal(rb.keys.geo, ra.keys.geo);
  assert.equal(rb.keys.pipes, ra.keys.pipes);
});

test('paleta „Frachtowiec”: wszystkie wiersze, bez emblematu nacji', () => {
  assert.ok(HD_PALETTES.freight && HD_PALETTES.freight.label);
  assert.equal(HD_PALETTE_EMBLEM.freight, null);
});

test('moduł ładunku na siatkę kontenerów: hullCargoBox daje dokładnie nx × ny komórek, hullCargoFit — co najmniej jedną', () => {
  for (const D of [0.047, 0.18, 0.3, 0.6, 1.5]) {
    for (const m of [{ type: 'cargo', v: 2 }, { type: 'cargo', v: 3, n: 2 }, { type: 'cargo', v: 3, n: 3 }, { type: 'cargo', v: 0 }]) {
      for (const [nx, ny] of [[1, 1], [3, 2], [7, 4]]) {
        const box = hullCargoBox(m, D, nx, ny);
        const g = hullCargoGrid({ ...m, ...box }, D);
        assert.deepEqual([g.nx, g.ny], [nx, ny], `${m.type} v ${m.v} n ${m.n || '-'} detal ${D}: ${nx} × ${ny}`);
      }
    }
    const tiny = hullCargoFit({ type: 'cargo', v: 3, n: 2, w: 2, h: 2 }, D);
    assert.equal(hullCargoGrid(tiny, D).cells, 1, `mały zasobnik po dopasowaniu (detal ${D})`);
    const big = hullCargoFit({ type: 'cargo', v: 2, w: 200, h: 60 }, D);
    assert.deepEqual([big.w, big.h], [200, 60], 'duży moduł bez zmian');
    assert.deepEqual(hullCargoFit({ type: 'vent', w: 1, h: 1 }, D), { type: 'vent', w: 1, h: 1 }, 'inne typy bez zmian');
  }
});

test('presety frachtowców: rola cywilna, paleta, grupa „civil”; gniazdo mostka poza obudową reaktora i innymi systemami', () => {
  assert.ok(HD_FREIGHTERS.length >= 1);
  for (const f of HD_FREIGHTERS) {
    assert.equal(HD_PRESETS[f.key]?.group, 'civil', `${f.key}: grupa`);
    const d = hullDesignPreset(f.key);
    assert.equal(d.role, 'civil', `${f.key}: rola`);
    assert.deepEqual([d.bridgeLevel, d.coreLevel], f.cls, `${f.key}: klasa z pliku presetu`);
    // jak test gniazd mostka floty TN (tests/bridgeLevels.test.mjs): obudowa reaktora v 2 sięga 1,2 r + 0,8 jd
    const ex = expandHullDesign(d);
    const m = ex.modules.find((q) => q.type === 'bridge' && q.v === 2);
    if (!m) continue;
    const R = m.w + m.rim, H = m.h + m.rim, ch = bridgeLevel(m.lv).ch + m.rim * (2 - Math.SQRT2);
    const inSocket = (x, y) => {
      const ax = Math.abs(x - m.x), ay = Math.abs(y - m.y);
      return ax <= R && ay <= H && ax + ay <= R + H - ch;
    };
    const D = ex.design.detail;
    const step = Math.max(0.25, Math.min(R, H) / 40);
    for (const o of ex.modules) {
      if (o === m || !HD_SYSTEM_TYPES.includes(o.type)) continue;
      const sdf = o.type === 'reactor' && o.v === 2
        ? (x, y) => Math.hypot(x - o.x, y - o.y) - (o.r * 1.2 + 0.8 * D)
        : (x, y) => pipeModuleSdf(o, x, y);
      let hit = null;
      for (let y = m.y - H; y <= m.y + H && !hit; y += step) {
        for (let x = m.x - R; x <= m.x + R; x += step) if (inSocket(x, y) && sdf(x, y) < 0) { hit = [x, y]; break; }
      }
      assert.equal(hit, null, `${f.key}: gniazdo mostka nachodzi na ${o.type} (${o.x}, ${o.y}) w ${hit}`);
    }
  }
});
