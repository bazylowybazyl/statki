// Mostki na poziomy klas I–VI (src/data/bridgeLevels.js) — jedno źródło miejsc mostka floty Terra Novy:
// moduł `bridge` presetu kreatora (gniazdo v 2, poziom klasy presetu) przeliczony ramą sprite'a = strefa gry
// (BRIDGE_LAYOUT_PROPOSALS: miejsce, wymiary = obrys modelu poziomu / s, `level`) = obrys modelu 3D poziomu
// (src/3d/bridge3DShapes.js). Gniazdo w kreatorze nie nachodzi na inne moduły presetu (obudowa reaktora, zbiorniki,
// gniazda broni, dysze), strefa — na obudowę reaktora gry, a na PRAWDZIWYM kadłubie belkowym leży na kadłubie.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { BRIDGE_LEVELS, bridgeLevel, clampBridgeLevel } = await import('../src/data/bridgeLevels.js');
const { HD_TN_SPRITE_FRAMES, HD_PRESET_CLASS } = await import('../src/game/hullDesign/hullDesignSystemSlots.js');
const { hullDesignPreset } = await import('../src/game/hullDesign/hullDesignPresets.js');
const { normalizeHullDesign, expandHullDesign, isBridgeSocket, bridgeSocketModule } = await import('../src/game/hullDesign/hullDesignSchema.js');
const { pipeModuleSdf } = await import('../src/game/hullDesign/hullDesignPipes.js');
const { BRIDGE_LAYOUT_PROPOSALS } = await import('../src/game/shipBridge.js');
const { REACTOR_CORE_MARKERS } = await import('../src/data/reactorCores.js');
const { BRIDGE3D_KINDS, buildBridgeModel, resolveBridgeModelKind } = await import('../src/3d/bridge3DShapes.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const RT = await import('../src/game/shipBridgeRuntime.js');
const BB = await import('../src/game/shipBridgeBeams.js');

// klucz strefy gry dla profilu TN; poziomy kadłubów TN — decyzja użytkownika (2026-10-21)
const BRIDGE_KEY = { terran_frigate: 'frigate', terran_destroyer: 'destroyer', terran_battleship: 'battleship', terran_carrier: 'terran_carrier', terran_supercapital: 'terran_supercapital' };
const TN_LEVEL = { custos: 1, hasta: 2, bellator: 4, citadella: 5, colossus: 6 };
const zoneOf = (hull) => { const e = BRIDGE_LAYOUT_PROPOSALS[hull]; return e.variants[e.defaultVariant][0]; };
const socketOf = (key) => normalizeHullDesign(hullDesignPreset(key)).modules.find((m) => m.type === 'bridge');

test('poziomy mostka: sześć, obrys rośnie z poziomem, faza pokładu mniejsza od pół-wymiarów, model na poziom', () => {
  assert.equal(BRIDGE_LEVELS.length, 6);
  BRIDGE_LEVELS.forEach((lv, i) => {
    assert.equal(lv.level, i + 1);
    assert.ok(lv.ch > 0 && lv.ch < lv.h / 2 && lv.ch < lv.w / 2, `${lv.roman}: faza`);
    assert.ok(BRIDGE3D_KINDS[lv.model] && BRIDGE3D_KINDS[lv.model].level === lv.level, `${lv.roman}: rodzaj modelu ${lv.model}`);
    if (i) {
      const p = BRIDGE_LEVELS[i - 1];
      assert.ok(lv.w >= p.w * 1.25 && lv.h >= p.h * 1.25, `${lv.roman}: wyraźnie większy od ${p.roman}`);
    }
  });
  assert.equal(clampBridgeLevel(0), 1);
  assert.equal(clampBridgeLevel(9), 6);
  assert.equal(bridgeLevel('x').level, 1);
});

test('model poziomu: obrys = obrys poziomu (pokład wypełnia strefę), z poziomem więcej pięter, okien i lamp', () => {
  let prev = null;
  for (const lv of BRIDGE_LEVELS) {
    const m = buildBridgeModel(lv.model);
    const b = m.bounds;
    assert.ok(Math.abs(b.x0 + lv.w / 2) < 1e-3 && Math.abs(b.x1 - lv.w / 2) < 1e-3, `${lv.roman}: X ${b.x0}..${b.x1}`);
    assert.ok(Math.abs(b.y0 + lv.h / 2) < 1e-3 && Math.abs(b.y1 - lv.h / 2) < 1e-3, `${lv.roman}: Y ${b.y0}..${b.y1}`);
    const windows = m.emitters.filter((e) => e.type === 0).length;
    const beacons = m.emitters.filter((e) => e.type === 1).length;
    const stats = { z: b.zMax, windows, beacons, modules: m.modules.length };
    if (prev) {
      assert.ok(stats.z > prev.z && stats.windows > prev.windows && stats.beacons >= prev.beacons && stats.modules >= prev.modules,
        `${lv.roman}: wzrost z poziomem ${JSON.stringify(prev)} → ${JSON.stringify(stats)}`);
    }
    prev = stats;
  }
});

test('preset TN: gniazdo mostka (v 2) poziomu klasy = strefa gry (miejsce, obrys modelu / s, poziom)', () => {
  for (const [key, f] of Object.entries(HD_TN_SPRITE_FRAMES)) {
    const m = socketOf(key);
    assert.ok(m && isBridgeSocket(m), `${key}: preset bez gniazda mostka v 2`);
    assert.equal(m.lv, TN_LEVEL[key], `${key}: poziom gniazda`);
    assert.equal(m.lv, HD_PRESET_CLASS[key][0], `${key}: poziom = klasa presetu`);
    const lv = bridgeLevel(m.lv);
    assert.ok(Math.abs(m.w * 2 - lv.w) < 1e-9 && Math.abs(m.h * 2 - lv.h) < 1e-9, `${key}: gniazdo = obrys poziomu`);
    assert.equal(m.y, 0, `${key}: mostek w osi`);
    const z = zoneOf(BRIDGE_KEY[f.hull]);
    const px = m.x / f.s - f.dx, py = m.y / f.s - f.dy;
    assert.ok(Math.abs(z.x - px) <= 1.5 && Math.abs(z.y - py) <= 1.5, `${key}: strefa (${z.x}, ${z.y}) ≠ kreator (${px.toFixed(1)}, ${py.toFixed(1)})`);
    assert.ok(Math.abs(z.w - lv.w / f.s) <= 0.5 && Math.abs(z.h - lv.h / f.s) <= 0.5, `${key}: strefa ${z.w}×${z.h} ≠ obrys ${(lv.w / f.s).toFixed(1)}×${(lv.h / f.s).toFixed(1)}`);
    assert.equal(z.level, m.lv, `${key}: poziom strefy`);
    assert.equal(z.rot || 0, 0);
    assert.equal(resolveBridgeModelKind(BRIDGE_KEY[f.hull], z), lv.model, `${key}: model poziomu na strefie`);
  }
});

test('zmiana poziomu mostka w projekcie zmienia gniazdo (obrys, poziom); 0 — poziom modułu', () => {
  const d = hullDesignPreset('bellator');
  for (const lv of BRIDGE_LEVELS) {
    const m = normalizeHullDesign({ ...d, bridgeLevel: lv.level }).modules.find((q) => q.type === 'bridge');
    assert.equal(m.lv, lv.level);
    assert.equal(m.w, lv.w / 2);
    assert.equal(m.h, lv.h / 2);
    assert.ok(m.rim > 0);
  }
  const free = { ...d, bridgeLevel: 0, modules: d.modules.map((q) => (q.type === 'bridge' ? { ...q, lv: 3 } : q)) };
  assert.equal(normalizeHullDesign(free).modules.find((q) => q.type === 'bridge').lv, 3);
  // klasa ponad drabiną modeli (drednot VII, tylko NPC): poziom z modułu, nie przycięty poziom projektu
  const sock = { type: 'bridge', x: 0, y: 0, v: 2, lv: 5 };
  assert.equal(bridgeSocketModule(sock, 7).lv, 5);
  assert.equal(bridgeSocketModule(sock, 6).lv, 6);
  assert.equal(bridgeSocketModule(sock, 0).lv, 5);
  // bryła gniazda (poziom 3) sięga ramy: pokład + rim
  const ex = expandHullDesign(normalizeHullDesign(d));
  const m = ex.modules.find((q) => q.type === 'bridge');
  const body = ex.shapes.find((s) => s.module === 'bridge');
  assert.ok(body && Math.abs(body.w - (m.w + m.rim)) < 1e-9 && Math.abs(body.h - (m.h + m.rim)) < 1e-9 && body.ch > bridgeLevel(m.lv).ch);
});

test('gniazdo mostka TN w kreatorze nie nachodzi na inne moduły presetu (obudowa reaktora, zbiorniki, gniazda, dysze)', () => {
  for (const key of Object.keys(HD_TN_SPRITE_FRAMES)) {
    const ex = expandHullDesign(normalizeHullDesign(hullDesignPreset(key)));
    const m = ex.modules.find((q) => q.type === 'bridge');
    const R = m.w + m.rim, H = m.h + m.rim, ch = bridgeLevel(m.lv).ch + m.rim * (2 - Math.SQRT2);
    const inSocket = (x, y) => {
      const ax = Math.abs(x - m.x), ay = Math.abs(y - m.y);
      return ax <= R && ay <= H && ax + ay <= R + H - ch;
    };
    const D = ex.design.detail;
    const step = Math.max(0.25, Math.min(R, H) / 40);
    for (const o of ex.modules) {
      if (o === m || ['vent', 'hatch', 'well'].includes(o.type)) continue;
      // obudowa reaktora v 2: rama gniazda obudowy sięga 1,2 r + 0,8 jd
      const sdf = o.type === 'reactor' && o.v === 2
        ? (x, y) => Math.hypot(x - o.x, y - o.y) - (o.r * 1.2 + 0.8 * D)
        : (x, y) => pipeModuleSdf(o, x, y);
      let hit = null;
      for (let y = m.y - H; y <= m.y + H && !hit; y += step) {
        for (let x = m.x - R; x <= m.x + R; x += step) if (inSocket(x, y) && sdf(x, y) < 0) { hit = [x, y]; break; }
      }
      assert.equal(hit, null, `${key}: gniazdo mostka nachodzi na ${o.type}${o.slot ? ' ' + o.slot : ''} (${o.x}, ${o.y}) w ${hit}`);
    }
  }
});

test('strefa mostka TN nie nachodzi na obudowę reaktora (1,2 obrysu), leży na prawdziwym kadłubie belkowym', () => {
  for (const f of Object.values(HD_TN_SPRITE_FRAMES)) {
    const z = zoneOf(BRIDGE_KEY[f.hull]);
    const c = REACTOR_CORE_MARKERS[f.hull][0];
    const dx = Math.max(0, Math.abs(c.x - z.x) - z.w / 2), dy = Math.max(0, Math.abs(c.y - z.y) - z.h / 2);
    assert.ok(Math.hypot(dx, dy) > c.hr * 1.2, `${f.hull}: strefa mostka nachodzi na obudowę reaktora`);
    const e = makeBridgeShip(HullBodies, BRIDGE_KEY[f.hull]);
    try {
      RT.attachEntityBridges(e);
      const st = e.bridgeState;
      assert.ok(st && st.bridges.length === 1, `${f.hull}: mostek zamontowany`);
      const br = st.bridges[0];
      assert.equal(br.def.level, z.level, `${f.hull}: poziom w stanie mostka (lustro workera kopiuje def)`);
      assert.ok(br.total >= 1, `${f.hull}: strefa bez komórek`);
      // środek i wnętrze strefy na kadłubie (komórki z węzłem)
      const hull = e.beamHull, cs = hull.body.cellSize, lm = hull.body.latticeMin, p = { x: 0, y: 0 };
      for (const [u, v] of [[0, 0], [-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) {
        BB.beamPngToLattice(st, z.x + u * z.w, z.y + v * z.h, p);
        const ix = Math.floor(p.x / cs), iy = Math.floor(p.y / cs);
        assert.ok(BB.bridgeCellNode(hull, ix, iy) >= 0, `${f.hull}: punkt strefy (${u}, ${v}) poza kadłubem (lattice ${lm.x.toFixed(0)})`);
      }
    } finally {
      HullBodies.release(e);
    }
  }
});
