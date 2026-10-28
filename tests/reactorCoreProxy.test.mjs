// Obudowa rdzenia reaktora na proxy statków ruchu v2 (E17b): proxy nie ma kadłuba na belkach, więc rdzeń niesie
// własną ramę (reactor3D: createFramedReactorCore, źródło rdzeni proxy). Awans do NPC nie może niczego dokładać
// ani przesuwać — rama, promień komory, skala obudowy i rodzaj modelu proxy = rdzeń NPC na prawdziwym kadłubie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
globalThis.window ??= globalThis;
const { Core3D } = await import('../src/3d/core3d.js');
const { ShipProxyBatch3D } = await import('../src/3d/shipProxyBatch3D.js');
const { resolveReactorKind } = await import('../src/3d/reactor3D.js');
const { TRAFFIC_HULLS } = await import('../src/data/trafficHulls.js');
const { REACTOR_CORE_MARKERS, TRAFFIC_AUTO_CORE_MARKERS, trafficCoreMarker } = await import('../src/data/reactorCores.js');
const { getHullRenderSize } = await import('../src/data/ships.js');
const { readPng } = await import('../scripts/webgpu/png.mjs');
const { resizeBox } = await import('./helpers/reactorHulls.mjs');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { attachReactorCores, reactorCoreFrame } = await import('../src/game/reactorCore.js');
const { trafficHullsWithAutoCore, autoCoreMarkerFor } = await import('../scripts/rdzenie-auto-ruchu.mjs');
const { applyTrafficBlock, packTrafficBlock, TRAFFIC_BLOCK } = await import('../src/render/blocks/trafficBlock.js');

test('rdzenie z automatu kadłubów ruchu bez markera: tabela = autoReactorMarker na prawdziwym kadłubie', () => {
  const ids = trafficHullsWithAutoCore();
  assert.deepEqual(Object.keys(TRAFFIC_AUTO_CORE_MARKERS).sort(), [...ids].sort(), 'tabela = kadłuby bez markera');
  for (const id of ids) {
    const m = autoCoreMarkerFor(id);
    const t = TRAFFIC_AUTO_CORE_MARKERS[id];
    assert.ok(m, `${id}: automat`);
    for (const k of ['x', 'y', 'r']) assert.ok(Math.abs(m[k] - t[k]) < 0.02, `${id}.${k}: tabela ${t[k]}, automat ${m[k]} — node scripts/rdzenie-auto-ruchu.mjs`);
  }
  for (const id of Object.keys(TRAFFIC_HULLS)) assert.ok(trafficCoreMarker(id), `${id}: marker rdzenia proxy`);
});

// Atrapa Core3D bez GPU (jak tests/shipProxyBatch3D.test.mjs).
Core3D.scene = new THREE.Scene();
Core3D.isInitialized = true;
Core3D.width = 1920;
Core3D.height = 1080;
ShipProxyBatch3D.setImageResolver((hullId) => ({ width: 64, height: 32, hullId }));

function npcCore(id, pose) {
  const img = readPng(fileURLToPath(TRAFFIC_HULLS[id].sprite));
  const size = getHullRenderSize(id, img.width, img.height);
  const e = { x: pose.x, y: pose.y, vx: 0, vy: 0, angle: pose.angle, angVel: 0, mass: 1e4, hp: 1000, maxHp: 1000, type: id, shipFrame: id };
  HullBodies.createHull(e, resizeBox(img, size.w, size.h), {
    visualImage: { naturalWidth: img.width, naturalHeight: img.height, width: img.width, height: img.height }
  });
  const marker = REACTOR_CORE_MARKERS[id] || [TRAFFIC_AUTO_CORE_MARKERS[id]];
  const [core] = attachReactorCores(e, marker, { pngWidth: img.width, pngHeight: img.height });
  return { e, core };
}

test('rama rdzenia proxy = rama rdzenia NPC po awansie (środek, osie, komora, obudowa, rodzaj)', () => {
  const cam = { x: 7_080_000, y: 6_290_000, zoom: 0.5 };
  const pose = { x: cam.x + 120, y: cam.y - 80, angle: 0.7 };
  for (const id of ['container_ship', 'heavy_freighter', 'pirate_raider', 'terran_destroyer', 'pirate_frigate', 'megafreighter']) {
    const { e, core } = npcCore(id, pose);
    try {
      assert.ok(core && !core.invalid, `${id}: rdzeń NPC`);
      const want = reactorCoreFrame(core, {}, pose);
      const pirate = id.startsWith('pirate');
      ShipProxyBatch3D.update([{ courseId: 77, hullId: id, x: pose.x, y: pose.y, angle: pose.angle, pirate }], 1, cam);
      const [pc] = ShipProxyBatch3D.reactorCores;
      assert.ok(pc && pc.frame, `${id}: rdzeń proxy`);
      const f = pc.frame;
      const tol = Math.max(0.5, want.R * 0.01);
      assert.ok(Math.hypot(f.x - want.x, f.y - want.y) < tol, `${id}: środek ${f.x - want.x}, ${f.y - want.y}`);
      for (const k of ['axX', 'axY', 'ayX', 'ayY']) assert.ok(Math.abs(f[k] - want[k]) < tol, `${id}.${k}: ${f[k]} / ${want[k]}`);
      assert.ok(Math.abs(f.R / want.R - 1) < 0.01, `${id}: komora ${f.R} / ${want.R}`);
      const hr = core.model?.housingR || 0;
      assert.ok(Math.abs((pc.model.housingR || 0) - hr) <= hr * 0.01, `${id}: obudowa ${pc.model.housingR} / ${hr}`);
      // rodzaj modelu: rdzeń NPC z gospodarzem (piraci po kadłubie / frakcji)
      e.isPirate = pirate;
      assert.equal(pc.model.kind, resolveReactorKind(core), `${id}: rodzaj modelu`);
    } finally {
      HullBodies.release(e);
    }
  }
});

test('rdzeń proxy: stały obiekt na kurs (ziarno i fazy plazmy), poza kadrem i bez krycia — bez rdzenia', () => {
  const cam = { x: 0, y: 0, zoom: 0.5 };
  ShipProxyBatch3D.update([{ courseId: 5, hullId: 'tanker', x: 10, y: 0, angle: 0 }], 1, cam);
  const a = ShipProxyBatch3D.reactorCores[0];
  ShipProxyBatch3D.update([{ courseId: 5, hullId: 'tanker', x: 30, y: 0, angle: 0.2 }], 1, cam);
  assert.equal(ShipProxyBatch3D.reactorCores[0], a, 'ten sam rdzeń kursu');
  ShipProxyBatch3D.update([{ courseId: 5, hullId: 'tanker', x: 1e6, y: 0, angle: 0 }], 1, cam);
  assert.equal(ShipProxyBatch3D.reactorCores.length, 0, 'poza kadrem');
  ShipProxyBatch3D.update([{ courseId: 5, hullId: 'tanker', x: 10, y: 0, angle: 0, proxyOpacity: 0 }], 1, cam);
  assert.equal(ShipProxyBatch3D.reactorCores.length, 0, 'krycie 0');
  ShipProxyBatch3D.update([], 1, cam);
  assert.equal(ShipProxyBatch3D.reactorCores.length, 0, 'pusta klatka');
});

test('barwa plazmy proxy po frakcji: blok migawki niesie flagę piratów', () => {
  const F = new Float64Array(TRAFFIC_BLOCK.HEAD + 4 * TRAFFIC_BLOCK.SHIP.STRIDE);
  packTrafficBlock(F, [
    { courseId: 1, hullId: 'tanker', x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0, throttle: 0, mode: 'warp', pirate: true },
    { courseId: 2, hullId: 'tanker', x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0, throttle: 0, mode: null, pirate: false }
  ], 2);
  const out = applyTrafficBlock({ f64: F }, []);
  assert.equal(out[0].pirate, true);
  assert.equal(out[0].mode, 'warp');
  assert.equal(out[1].pirate, false);
  const cam = { x: 0, y: 0, zoom: 0.5 };
  ShipProxyBatch3D.update([{ courseId: 9, hullId: 'smuggler', x: 0, y: 0, angle: 0, pirate: true },
    { courseId: 10, hullId: 'smuggler', x: 400, y: 0, angle: 0 }], 1, cam);
  const [p, t] = ShipProxyBatch3D.reactorCores;
  assert.ok(p.color[0] > 0.9 && t.color[2] > 0.9, 'piracka czerwień / terrański błękit');
});

test('moduł proxy nie importuje src/game (szew renderu) — rdzenie z src/data', () => {
  const src = readFileSync(new URL('../src/3d/shipProxyBatch3D.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/game\//);
  assert.match(src, /trafficCoreMarker/);
});
