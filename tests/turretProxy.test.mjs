// Wieże okrętów ruchu v2 na proxy bańki (E17b): tabela src/data/trafficProxyTurrets.js = kod gry (gniazda edytora,
// equipNpcWeapons z index.html, kąty spoczynku initAutonomousWeapons, rekordy Turret2D), a rekordy proxy w klatce
// (ProxyTurretFrame) leżą tam, gdzie rekordy NPC po awansie w tej samej pozie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
globalThis.window ??= globalThis;
window.wrecks ??= [];

const { TRAFFIC_PROXY_TURRETS } = await import('../src/data/trafficProxyTurrets.js');
const { proxyTurretsFor, trafficCombatHullIds } = await import('../scripts/wieze-proxy-ruchu.mjs');
const { Core3D } = await import('../src/3d/core3d.js');
const { ShipProxyBatch3D } = await import('../src/3d/shipProxyBatch3D.js');
const { ProxyTurretFrame } = await import('../src/3d/proxyTurretFrame.js');

test('tabela wież proxy = kod gry dla każdego okrętu ruchu i obu zestawów broni', () => {
  const ids = trafficCombatHullIds();
  assert.deepEqual(Object.keys(TRAFFIC_PROXY_TURRETS).sort(), [...ids].sort(), 'tabela = TRAFFIC_COMBAT_HULLS');
  for (const id of ids) {
    for (const f of ['terran', 'pirate']) {
      const want = proxyTurretsFor(id, f);
      assert.ok(want.length > 0, `${id}/${f}: okręt bez wież`);
      assert.deepEqual(TRAFFIC_PROXY_TURRETS[id][f].map((r) => [...r]), want, `${id}/${f} — node scripts/wieze-proxy-ruchu.mjs`);
    }
  }
});

Core3D.scene = new THREE.Scene();
Core3D.isInitialized = true;
Core3D.width = 1920;
Core3D.height = 1080;
ShipProxyBatch3D.setImageResolver((hullId) => ({ width: 64, height: 32, hullId }));

test('rekordy wież proxy w pozie okrętu (obrót y w dół jak Turret2D), stały klucz kursu, zestaw po flagze piratów', () => {
  const cam = { x: 1000, y: 2000, zoom: 1 };
  const pose = { x: 1040, y: 1980, angle: 0.6 };
  ShipProxyBatch3D.update([{ courseId: 31, hullId: 'terran_destroyer', ...pose }], 1, cam);
  assert.equal(ProxyTurretFrame.count, 1);
  const g = ProxyTurretFrame.list[0];
  const rows = TRAFFIC_PROXY_TURRETS.terran_destroyer.terran;
  assert.equal(g.recs.length, rows.length);
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  rows.forEach((r, i) => {
    const rec = g.recs[i];
    assert.equal(rec.weaponId, r[0]);
    assert.ok(Math.abs(rec.wx - (pose.x + r[1] * c - r[2] * s)) < 1e-9 && Math.abs(rec.wy - (pose.y + r[1] * s + r[2] * c)) < 1e-9);
    assert.ok(Math.abs(rec.ang - (pose.angle + r[3])) < 1e-12);
    assert.equal(rec.state, null, 'bez odrzutu');
  });
  ShipProxyBatch3D.update([{ courseId: 31, hullId: 'terran_destroyer', ...pose, angle: 0.7 }], 1, cam);
  assert.equal(ProxyTurretFrame.list[0], g, 'ta sama grupa kursu (stan wież w uchwycie)');
  ShipProxyBatch3D.update([{ courseId: 32, hullId: 'pirate_raider', ...pose, pirate: true }], 1, cam);
  assert.equal(ProxyTurretFrame.list[0].recs[0].weaponId, TRAFFIC_PROXY_TURRETS.pirate_raider.pirate[0][0]);
  // cywil — bez wież; daleki zoom — wieża poniżej 2 px
  ShipProxyBatch3D.update([{ courseId: 33, hullId: 'tanker', ...pose }], 1, cam);
  assert.equal(ProxyTurretFrame.count, 0);
  ShipProxyBatch3D.update([{ courseId: 31, hullId: 'terran_destroyer', ...pose }], 1, { ...cam, zoom: 0.02 });
  assert.equal(ProxyTurretFrame.count, 0);
});

test('partia wież dokłada grupy proxy (shipModels3DGame) — bez importu src/game w module proxy', () => {
  const models = readFileSync(new URL('../src/3d/ships3d/shipModels3DGame.js', import.meta.url), 'utf8');
  assert.match(models, /syncTurrets\(g\.holder, g\.view, g\.recs,/);
  const src = readFileSync(new URL('../src/3d/shipProxyBatch3D.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/game\//);
});
