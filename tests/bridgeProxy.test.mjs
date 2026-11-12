// Mostek na proxy statków ruchu v2 (E17b): model w strefie kadłuba ruchu bez kadłuba na belkach (bridge3D.js —
// proxyBridgeState / proxyBridgeBasis, rekord z host = null). Awans do NPC nie może przesunąć ani podmienić mostka —
// punkty modelu i emitery proxy leżą tam, gdzie u NPC na prawdziwym kadłubie (ten sam klucz, wariant, strefa, rodzaj).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const RT = await import('../src/game/shipBridgeRuntime.js');
const { TRAFFIC_HULLS, trafficHullRenderSize } = await import('../src/data/trafficHulls.js');
const { getHullRenderSize } = await import('../src/data/ships.js');
const { readPng } = await import('../scripts/webgpu/png.mjs');
const { resizeBox } = await import('./helpers/reactorHulls.mjs');
const { BRIDGE3D_KINDS, buildBridgeModel, resolveBridgeModelKind } = await import('../src/3d/bridge3DShapes.js');
const {
  beamBridgeInstanceBasis, bridgeModelToGrid, createBeamBridgeRecordCore, proxyBridgeBasis, proxyBridgeState
} = await import('../src/3d/bridge3D.js');

const MODELS = {};
function kindRes(name) {
  const model = MODELS[name] || (MODELS[name] = buildBridgeModel(name));
  const list = model.emitters.filter((e) => e.lit);
  const E = {
    count: list.length,
    type: Uint8Array.from(list.map((e) => e.type)),
    colorKey: list.map((e) => e.color),
    cx: Float32Array.from(list.map((e) => e.c[0])),
    cy: Float32Array.from(list.map((e) => e.c[1])),
    cz: Float32Array.from(list.map((e) => e.c[2])),
    level: Float32Array.from(list.map((e) => e.level ?? 1)),
    seed: Float32Array.from(list.map((e) => e.seed ?? 0)),
    period: Float32Array.from(list.map((e) => e.period ?? 1.5)),
    phase: Float32Array.from(list.map((e) => e.phase ?? 0))
  };
  return { name, index: BRIDGE3D_KINDS[name].index, model, emit: E };
}

// NPC po awansie: kadłub belkowy ze sprite'a w rozmiarze renderu, typ = kadłub (megafrachtowiec → wariant `sklad`).
function npc(id, pose) {
  const img = readPng(fileURLToPath(TRAFFIC_HULLS[id].sprite));
  const size = getHullRenderSize(id, img.width, img.height);
  const e = { x: pose.x, y: pose.y, vx: 0, vy: 0, angle: pose.angle, angVel: 0, mass: 1e4, hp: 1000, maxHp: 1000, type: id, shipFrame: id };
  HullBodies.createHull(e, resizeBox(img, size.w, size.h), {
    visualImage: { naturalWidth: img.width, naturalHeight: img.height, width: img.width, height: img.height }
  });
  RT.attachEntityBridges(e);
  return e;
}

test('mostek proxy = mostek NPC po awansie: rodzaj, punkty modelu i emitery w tym samym miejscu świata', () => {
  const pose = { x: 6_400_120, y: 3_100_450, angle: 0.83 };
  for (const id of ['container_ship', 'heavy_freighter', 'police_cutter', 'pirate_raider', 'terran_destroyer', 'megafreighter']) {
    const e = npc(id, pose);
    try {
      const st = e.bridgeState;
      assert.ok(st && st.bridges.length >= 1, `${id}: mostek NPC`);
      const size = trafficHullRenderSize(id);
      const pst = proxyBridgeState(id, size.w, size.h, TRAFFIC_HULLS[id].png[0], TRAFFIC_HULLS[id].png[1]);
      assert.ok(pst, `${id}: stan mostków proxy`);
      assert.equal(pst.bridges.length, st.bridges.length, `${id}: liczba mostków`);
      assert.equal(pst.hullKey, st.hullKey || RT.resolveBridgeHullKey(e), `${id}: klucz kadłuba`);
      for (let b = 0; b < st.bridges.length; b++) {
        const kind = resolveBridgeModelKind(pst.hullKey, pst.defs[b]);
        assert.equal(kind, resolveBridgeModelKind(pst.hullKey, st.bridges[b].def), `${id}: rodzaj modelu`);
        const K = kindRes(kind);
        const nr = createBeamBridgeRecordCore(e, st, b, K, 0);
        const pr = createBeamBridgeRecordCore(null, pst, b, K, 0);
        assert.equal(pr.pristine, true);
        assert.ok(pr.existed.every((v) => v === 1), `${id}: proxy — komórki nietknięte`);
        const BN = beamBridgeInstanceBasis(nr, e, pose, {});
        const BP = proxyBridgeBasis(pr, pose, {});
        const pts = [[0, 0], [20, -8], [-35, 14]];
        for (let i = 0; i < K.emit.count; i++) pts.push([K.emit.cx[i], K.emit.cy[i]]);
        const tol = Math.max(1, 0.01 * Math.hypot(BN.ax, BN.ay) * 40);
        for (const [x, y] of pts) {
          const nx = BN.ox + BN.ax * x + BN.bx * y, ny = BN.oy + BN.ay * x + BN.by * y;
          const px = BP.ox + BP.ax * x + BP.bx * y, py = BP.oy + BP.ay * x + BP.by * y;
          assert.ok(Math.hypot(nx - px, ny - py) < tol, `${id}: punkt (${x}, ${y}) o ${Math.hypot(nx - px, ny - py).toFixed(2)} j.`);
        }
        assert.ok(Math.abs(BP.sz / BN.sz - 1) < 0.01, `${id}: wysokość modelu ${BP.sz} / ${BN.sz}`);
        // Bez odbicia (FrontSide) i ten sam obrys strefy.
        assert.ok(BP.ax * BP.by - BP.ay * BP.bx > 0);
        assert.ok(Math.abs(pr.map.zoneW / nr.map.zoneW - 1) < 0.01, `${id}: strefa`);
        // Proxy: model → komórki bloku leżą w bloku (shader czyta nietknięty blok bufora obrażeń).
        const g = bridgeModelToGrid(pr.map, 0, 0);
        assert.ok(Number.isFinite(g.x) && pr.blockW > 0 && pr.blockH > 0);
      }
    } finally {
      RT.releaseShipBridges?.(e);
      HullBodies.release(e);
    }
  }
});

test('kadłub ruchu bez mostka nie ma stanu proxy; moduł proxy rysuje mostki przez Bridge3D, bez importu src/game', () => {
  assert.equal(proxyBridgeState('nie_ma_takiego', 100, 50, 100, 50), null);
  const src = readFileSync(new URL('../src/3d/shipProxyBatch3D.js', import.meta.url), 'utf8');
  assert.match(src, /Bridge3D\.drawProxyBridges\(bridgeViews, bridgeViewCount\)/);
  assert.doesNotMatch(src, /from '\.\.\/game\//);
});
