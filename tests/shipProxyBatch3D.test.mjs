import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { TRAFFIC_HULLS, trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { mainExhaustPaletteIndex } from '../src/data/engineFx.js';

const source = readFileSync(new URL('../src/3d/shipProxyBatch3D.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tslSource = readFileSync(new URL('../src/3d/shipProxyBatch3D.tsl.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hullTslSource = readFileSync(new URL('../src/3d/hexShips3D.tsl.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const squash = (s) => s.replace(/\s+/g, ' ');

test('materiał proxy: TSL, instancje względem początku przy kamerze (precyzja float32)', () => {
  assert.doesNotMatch(source, /new THREE\.ShaderMaterial|sunShadowMaskGLSL|SUN_SHADOW_GLSL|gl_Position|WebGLRenderer|setUsage\(/);
  assert.doesNotMatch(tslSource, /new THREE\.ShaderMaterial|sunShadowMaskGLSL|gl_Position|cameraViewMatrix|positionWorld/);
  assert.match(tslSource, /extends THREE\.NodeMaterial/);
  assert.match(tslSource, /InstancedInterleavedBuffer/);
  assert.match(source, /sceneOriginNearCamera\(origin, camera\)/);
  assert.match(source, /mesh\.position\.set\(origin\.x, origin\.y, 0\)/);
});

test('materiał proxy: rdzeń światła = fragment kadłubów (hexShips3D.tsl.js — maska słońca, glow)', () => {
  const proxy = squash(tslSource);
  const hull = squash(hullTslSource);
  const shared = [
    'normalize(vec3(p.x.mul(0.45), p.y.mul(-0.45), 1.0))',
    'sunVisibility().toVar()',
    '.mul(sunFill(sunVis)).add(dayDiffuse.mul(',
    'pow(max(dot(worldNormal, halfVector), 0.0), 32.0)',
    'smoothstep(-0.02, 0.08, NdotL)',
    '.mul(litMask).mul(sunVis)));',
    'step(0.6, sunlitColor.z).mul(step(sunlitColor.x, 0.5))',
    'float(1.0).sub(fieldDarkness())',
    '.mul(isGlowing).mul(1.5).mul(fieldLit.mul(0.7).add(0.3))'
  ];
  for (const line of shared) {
    assert.ok(hull.includes(line), `kadłuby zmieniły model światła — popraw lustro w shipProxyBatch3D.tsl.js: ${line}`);
    assert.ok(proxy.includes(line), `proxy nie ma: ${line}`);
  }
});

// Atrapa Core3D bez WebGL: scena three, rozmiar widoku, obrazek {width, height}.
Core3D.scene = new THREE.Scene();
Core3D.isInitialized = true;
Core3D.width = 1920;
Core3D.height = 1080;
ShipProxyBatch3D.setImageResolver((hullId) => ({ width: 64, height: 32, hullId }));

const cam = { x: 7_080_000, y: 6_290_000, zoom: 0.5 };
const meshOf = (file) => Core3D.scene.children.find((o) => o.isMesh && o.name === `shipProxy:${file}`);
const dataOf = (mesh) => mesh.userData.shipProxyBuffer.array;
const countOf = (mesh) => mesh.geometry.instanceCount;
function actor(o) {
  return { courseId: o.id, unitClass: o.cls, hullId: o.hull, x: o.x, y: o.y, angle: o.angle ?? 0,
    prevX: o.px ?? o.x, prevY: o.py ?? o.y, prevAngle: o.pa ?? o.angle ?? 0,
    vx: o.vx ?? 0, vy: o.vy ?? 0, speed: o.speed ?? 0, throttle: o.throttle ?? 0, mode: o.mode };
}

test('instancja: środek względem początku przy kamerze, osie × wymiary sprite\'a, obrót i krycie w kolumnie 2', () => {
  const a = actor({ id: 'haul-00001', cls: 'freighter-medium', x: cam.x + 100, y: cam.y - 50, angle: 0.5 });
  ShipProxyBatch3D.update([a], 1, cam);
  const mesh = meshOf('container_ship.png');
  assert.ok(mesh, 'rodzaj kontenerowca w scenie');
  assert.equal(countOf(mesh), 1);
  assert.equal(mesh.visible, true);
  assert.deepEqual([mesh.position.x, mesh.position.y], [cam.x, -cam.y]);
  const M = dataOf(mesh);
  const { w, h } = trafficHullRenderSize('container_ship');
  const c = Math.cos(-0.5);
  const s = Math.sin(-0.5);
  const close = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-3, `${msg}: ${got} ≠ ${want}`);
  close(M[0], c * w, 'oś x'); close(M[1], s * w, 'oś x');
  close(M[4], -s * h, 'oś y'); close(M[5], c * h, 'oś y');
  close(M[8], c, 'cos'); close(M[9], s, 'sin'); close(M[10], 1, 'krycie');
  close(M[12], 100, 'x względem początku'); close(M[13], 50, 'y sceny = −y gry');
  assert.equal(ShipProxyBatch3D.stats.drawCalls, 1);
});

test('interpolacja między krokami bańki (alpha) i przycinanie do kadru', () => {
  const a = actor({ id: 'haul-00002', hull: 'container_ship', x: cam.x + 100, y: cam.y, px: cam.x, py: cam.y, angle: 0.4, pa: 0 });
  const far = actor({ id: 'haul-00003', hull: 'container_ship', x: cam.x + 1e6, y: cam.y });
  ShipProxyBatch3D.update([a, far], 0.25, cam);
  const M = dataOf(meshOf('container_ship.png'));
  assert.ok(Math.abs(M[12] - 25) < 1e-6, `x = prev + 0,25 · Δ, jest ${M[12]}`);
  assert.ok(Math.abs(M[8] - Math.cos(-0.1)) < 1e-6, 'kąt interpolowany');
  assert.equal(ShipProxyBatch3D.stats.drawn, 1);
  assert.equal(ShipProxyBatch3D.stats.culled, 1);
});

test('pusty rodzaj: count 0 i visible = false (zero draw calli)', () => {
  ShipProxyBatch3D.update([], 1, cam);
  const mesh = meshOf('container_ship.png');
  assert.equal(countOf(mesh), 0);
  assert.equal(mesh.visible, false);
  assert.equal(ShipProxyBatch3D.stats.drawCalls, 0);
});

test('jedna siatka na teksturę: ciężki frachtowiec dzieli sprite i mesh z dalekiego zasięgu', () => {
  const list = [
    actor({ id: 'haul-00010', hull: 'long_haul_freighter', x: cam.x, y: cam.y }),
    actor({ id: 'haul-00011', cls: 'freighter-capital', x: cam.x + 300, y: cam.y })
  ];
  ShipProxyBatch3D.update(list, 1, cam);
  const mesh = meshOf('long_haul_freighter.png');
  assert.equal(countOf(mesh), 2);
  assert.equal(ShipProxyBatch3D.stats.drawCalls, 1);
  const M = dataOf(mesh);
  assert.equal(Math.round(M[16]), trafficHullRenderSize('heavy_freighter').w, 'druga instancja w skali 1800 j.');
});

test('rodzaj rośnie ponad pojemność początkową bez gubienia instancji', () => {
  const list = [];
  for (let i = 0; i < 70; i++) list.push(actor({ id: `haul-1${i}`, hull: 'smuggler', x: cam.x + i * 10, y: cam.y }));
  ShipProxyBatch3D.update(list, 1, cam);
  const meshes = Core3D.scene.children.filter((o) => o.name === 'shipProxy:smuggler.png');
  assert.equal(meshes.length, 1, 'stary mesh odpięty');
  assert.equal(countOf(meshes[0]), 70);
  assert.ok(Math.abs(dataOf(meshes[0])[69 * 16 + 12] - 690) < 1e-6);
});

test('dysze: widok encji z układem MAIN kadłuba, postój bez dysz, budżet na flotę', () => {
  const moving = actor({ id: 'haul-00020', cls: 'raider', x: cam.x, y: cam.y, speed: 300, vx: 300, throttle: 0.5 });
  const docked = actor({ id: 'haul-00021', cls: 'freighter-medium', x: cam.x + 400, y: cam.y });
  ShipProxyBatch3D.update([moving, docked], 1, cam);
  const views = ShipProxyBatch3D.engineEntities;
  assert.equal(views.length, 1, 'stojący przy stanowisku nie odpala dysz');
  const view = views[0];
  const { w, h } = trafficHullRenderSize('pirate_raider');
  const marker = TRAFFIC_HULLS.pirate_raider.main[0];
  assert.equal(view.visual.mainThrusters.length, TRAFFIC_HULLS.pirate_raider.main.length);
  assert.ok(Math.abs(view.visual.mainThrusters[0].offset.x - marker[0] * w / 1774) < 1e-9);
  assert.ok(Math.abs(view.visual.mainThrusters[0].offset.y - marker[1] * h / 887) < 1e-9);
  assert.equal(view.visual.engineFx.mainPaletteIndex, mainExhaustPaletteIndex('rakieta'), 'piraci: paleta rakiety');
  assert.ok(view.visual.engineFx.nozzleRadius > 0);
  assert.equal(view.thrusterInput.main, 0.5);
  assert.equal(view.x, moving.x);

  // Ta sama encja w następnej klatce = ten sam obiekt widoku (stan strug EngineVfxSystem).
  ShipProxyBatch3D.update([moving], 1, cam);
  assert.equal(ShipProxyBatch3D.engineEntities[0], view);

  const fleet = [];
  for (let i = 0; i < 80; i++) fleet.push(actor({ id: `haul-2${i}`, cls: 'tug', x: cam.x + (i % 10) * 200, y: cam.y + Math.floor(i / 10) * 150, speed: 200, throttle: 1 }));
  ShipProxyBatch3D.update(fleet, 1, cam);
  assert.equal(ShipProxyBatch3D.engineEntities.length, 48, 'pula strug MAIN jest wspólna — proxy mają limit');

  // Warp bańki: dopalacz MAIN, nie plazma (pula WARP_PLUME_CAP zostaje dla gracza).
  const warp = actor({ id: 'haul-00030', cls: 'freighter-large', x: cam.x, y: cam.y, speed: 5700, throttle: 0, mode: 'warp' });
  ShipProxyBatch3D.update([warp], 1, cam);
  assert.equal(ShipProxyBatch3D.engineEntities[0].__editorBoost, true);
  assert.equal(ShipProxyBatch3D.engineEntities[0].phase, undefined);
});

test('pickAt: proxy pod punktem świata z ostatniej klatki', () => {
  const a = actor({ id: 'haul-00040', hull: 'container_ship', x: cam.x + 500, y: cam.y + 200 });
  ShipProxyBatch3D.update([a], 1, cam);
  assert.equal(ShipProxyBatch3D.pickAt(cam.x + 510, cam.y + 205), a);
  assert.equal(ShipProxyBatch3D.pickAt(cam.x - 5000, cam.y), null);
});
