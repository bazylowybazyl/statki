// Miejsca rdzeni floty Terra Novy (src/data/reactorCores.js) — jedno źródło z kreatorem kadłubów: rdzeń presetu
// (gniazdo obudowy v 2, hullDesignSystemSlots.js) przeliczony ramą sprite'a = marker gry (x, y, hr). Obudowa nie
// nachodzi na wieże (SHIP_EDITOR_DEFAULTS) ani strefy mostków (BRIDGE_LAYOUT_PROPOSALS), komora na PRAWDZIWYM kadłubie
// belkowym (sprite w rozmiarze renderu) ma komórki i stoi w kadłubie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { REACTOR_CORE_MARKERS } = await import('../src/data/reactorCores.js');
const { HD_TN_SPRITE_FRAMES } = await import('../src/game/hullDesign/hullDesignSystemSlots.js');
const { hullDesignPreset } = await import('../src/game/hullDesign/hullDesignPresets.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { BRIDGE_LAYOUT_PROPOSALS } = await import('../src/game/shipBridge.js');
const { getHullRenderSize } = await import('../src/data/ships.js');
const { readPng } = await import('../scripts/webgpu/png.mjs');
const { resizeBox } = await import('./helpers/reactorHulls.mjs');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { attachReactorCores, reactorCellNode, reactorHull } = await import('../src/game/reactorCore.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// klucze tabel gry dla profili TN (edytor gniazd i strefy mostków)
const EDITOR_KEY = { terran_frigate: 'frigate', terran_destroyer: 'destroyer', terran_battleship: 'battleship', terran_carrier: 'terran_carrier', terran_supercapital: 'terran_supercapital' };
const BRIDGE_KEY = { terran_frigate: 'frigate', terran_destroyer: 'destroyer', terran_battleship: 'battleship', terran_carrier: 'terran_carrier', terran_supercapital: 'terran_supercapital' };
const SPRITE = {
  terran_frigate: 'src/assets/ships/terranfrigate.png', terran_destroyer: 'src/assets/ships/terrandestroyer.png',
  terran_battleship: 'src/assets/ships/terranbattleship.png', terran_carrier: 'src/assets/ships/terrancarrier.png',
  terran_supercapital: 'src/assets/ships/terransupercapital.png'
};

test('rdzeń presetu TN (gniazdo obudowy v 2) = marker gry: miejsce i promień obudowy w px PNG', () => {
  for (const [key, f] of Object.entries(HD_TN_SPRITE_FRAMES)) {
    const reactor = hullDesignPreset(key).modules.find((m) => m.type === 'reactor');
    assert.ok(reactor, `${key}: preset bez rdzenia`);
    assert.equal(reactor.v, 2, `${key}: rdzeń presetu bez gniazda obudowy`);
    const m = REACTOR_CORE_MARKERS[f.hull]?.[0];
    assert.ok(m, `${key}: brak markera ${f.hull}`);
    const px = reactor.x / f.s - f.dx, py = reactor.y / f.s - f.dy, hr = reactor.r / f.s;
    assert.ok(Math.abs(m.x - px) <= 1.5 && Math.abs(m.y - py) <= 1.5, `${key}: marker (${m.x}, ${m.y}) ≠ kreator (${px.toFixed(1)}, ${py.toFixed(1)})`);
    assert.ok(Math.abs(m.hr - hr) <= 0.5, `${key}: obudowa hr ${m.hr} ≠ kreator ${hr.toFixed(1)}`);
    assert.ok(m.r > 0 && m.tier && m.model === 'terran', `${key}: komora, poziom i rodzaj modelu`);
  }
});

test('obudowa rdzenia TN nie nachodzi na wieże ani strefy mostków sprite\'a', () => {
  for (const f of Object.values(HD_TN_SPRITE_FRAMES)) {
    const m = REACTOR_CORE_MARKERS[f.hull][0];
    // rama gniazda w kreatorze sięga 1,2 obrysu obudowy; gniazdo wieży — ~20 px PNG
    for (const h of SHIP_EDITOR_DEFAULTS.ships[EDITOR_KEY[f.hull]].hardpoints) {
      const d = Math.hypot(h.x - m.x, h.y - m.y);
      assert.ok(d > m.hr * 1.2 + 20, `${f.hull}: wieża ${h.id} (${h.x}, ${h.y}) ${d.toFixed(0)} px od rdzenia`);
    }
    const zones = Object.values(BRIDGE_LAYOUT_PROPOSALS[BRIDGE_KEY[f.hull]].variants).flat();
    for (const z of zones) {
      const dx = Math.max(0, Math.abs(m.x - z.x) - z.w / 2), dy = Math.max(0, Math.abs(m.y - z.y) - z.h / 2);
      assert.ok(Math.hypot(dx, dy) > m.hr, `${f.hull}: obudowa nachodzi na strefę mostka ${z.id}`);
    }
  }
});

test('komora rdzenia TN na prawdziwym kadłubie belkowym: komórki w kadłubie, środek pod obudową żywy', () => {
  for (const f of Object.values(HD_TN_SPRITE_FRAMES)) {
    const png = readPng(join(ROOT, SPRITE[f.hull]));
    assert.deepEqual([png.width, png.height], f.png, `${f.hull}: wymiary PNG jak w ramie`);
    const size = getHullRenderSize(f.hull, png.width, png.height);
    const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 1e5, hp: 1000, maxHp: 1000, type: 'battleship', shipFrame: f.hull };
    HullBodies.createHull(e, resizeBox(png, size.w, size.h));
    try {
      const [core] = attachReactorCores(e, REACTOR_CORE_MARKERS[f.hull], { pngWidth: png.width, pngHeight: png.height });
      assert.ok(core && !core.invalid, `${f.hull}: komora poza kadłubem`);
      assert.ok(core.cellX.length >= 6, `${f.hull}: komora ma ${core.cellX.length} komórek`);
      assert.ok(core.model && core.model.housingR > 0 && core.model.tier, `${f.hull}: parametry modelu z markera`);
      const hull = reactorHull(e), cs = hull.body.cellSize;
      const cx = Math.floor(core.gx / cs), cy = Math.floor(core.gy / cs);
      assert.ok(reactorCellNode(hull, cx, cy) >= 0, `${f.hull}: pod środkiem obudowy brak kadłuba`);
    } finally {
      HullBodies.release(e);
    }
  }
});
