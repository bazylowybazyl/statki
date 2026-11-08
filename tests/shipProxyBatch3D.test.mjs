import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { PROXY_INSTANCE_STRIDE } from '../src/3d/shipProxyBatch3D.tsl.js';
import { HullLightStore } from '../src/3d/hexShips3D.tsl.js';
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

test('materiał proxy: fragment = fragment pełnego kadłuba (E17 — oświetlenie v2, lakier, lampy; bez ran i warpa)', () => {
  const proxy = squash(tslSource);
  const hull = squash(hullTslSource);
  // Proxy nie ma własnego modelu światła (dawne lustro klasycznego modelu) — bierze fragment skóry belek.
  assert.match(proxy, /import \{ hullProxyFragmentNode \} from '\.\/hexShips3D\.tsl\.js'/);
  assert.match(proxy, /fragmentNode = hullProxyFragmentNode\(/);
  assert.doesNotMatch(proxy, /dayDiffuse|sunVisibility\(\)|isGlowing/);
  // Wariant proxy fragmentu kadłuba: bez mapy ran, żaru i jasności blachy; światła efektów z siatki (lampy hali K-7) — tak (E17b).
  assert.match(hull, /export function hullProxyFragmentNode\(.*\) \{ return hullFragmentNode\(\{ perObject, spriteUV, localWorld, lodOpacity, cutDiscard, shade: null, heat: null, damage: false, effectLights: true \}\); \}/);
  assert.match(hull, /function hullEffectLights\(ctx\) \{ if \(!ctx\.effectLights\) return vec3\(0\.0\);/);
  assert.match(proxy, /uGridOwner: float\(0\.0\)/);
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

test('jedna siatka na teksturę: ciężki frachtowiec ma własny sprite Z11 (E13) — osobna siatka w skali 1800 j.', () => {
  const list = [
    actor({ id: 'haul-00010', hull: 'long_haul_freighter', x: cam.x, y: cam.y }),
    actor({ id: 'haul-00011', cls: 'freighter-capital', x: cam.x + 300, y: cam.y }),
    actor({ id: 'haul-00012', cls: 'freighter-capital', x: cam.x + 600, y: cam.y })
  ];
  ShipProxyBatch3D.update(list, 1, cam);
  assert.equal(countOf(meshOf('long_haul_freighter.png')), 1);
  const mesh = meshOf('heavy_freighter.png');
  assert.equal(countOf(mesh), 2, 'dwa ciężkie frachtowce — jedna siatka');
  assert.equal(ShipProxyBatch3D.stats.drawCalls, 2);
  const M = dataOf(mesh);
  assert.equal(Math.round(M[0]), trafficHullRenderSize('heavy_freighter').w, 'instancja w skali 1800 j.');
});

test('rodzaj rośnie ponad pojemność początkową bez gubienia instancji', () => {
  const list = [];
  for (let i = 0; i < 70; i++) list.push(actor({ id: `haul-1${i}`, hull: 'smuggler', x: cam.x + i * 10, y: cam.y }));
  ShipProxyBatch3D.update(list, 1, cam);
  const meshes = Core3D.scene.children.filter((o) => o.name === 'shipProxy:smuggler.png');
  assert.equal(meshes.length, 1, 'stary mesh odpięty');
  assert.equal(countOf(meshes[0]), 70);
  assert.ok(Math.abs(dataOf(meshes[0])[69 * PROXY_INSTANCE_STRIDE + 12] - 690) < 1e-6);
});

test('wygląd rodzaju (E17): lampy w slocie HullLightStore z bramką promienia, lampy cywila, strefy dysz, odblask', () => {
  const near = { x: cam.x, y: cam.y, zoom: 0.5 };
  const destroyer = actor({ id: 'haul-00050', hull: 'terran_destroyer', x: near.x, y: near.y });
  const freighter = actor({ id: 'haul-00051', hull: 'container_ship', x: near.x + 1200, y: near.y });
  ShipProxyBatch3D.update([destroyer, freighter], 1, near);
  const D = dataOf(meshOf('terrandestroyer.png'));
  assert.equal(D[14], 8, 'niszczyciel: lampy statku na blasze (6 nawigacyjnych + reflektor daleki i otoczenia)');
  assert.ok(D[19] >= 0 && D[19] < 1, 'faza migania okrętu w instancji');
  assert.equal(D[16] % HullLightStore.slotVec4, 0, 'slot lamp rodzaju w vec4');
  const lamps = HullLightStore.array();
  const base = HullLightStore.slotFloatOffset(D[16] / HullLightStore.slotVec4);
  assert.ok(lamps[base + 3] > 0, 'moc pierwszej lampy w slocie');
  assert.ok(D[17] > 0, 'strefy dysz (lakier gaśnie przy wylotach)');
  assert.equal(D[18], 1, 'waga lakieru');
  assert.ok(D[15] > 0.99, 'duży na ekranie — pełny odblask lakieru');
  const F = dataOf(meshOf('container_ship.png'));
  assert.equal(F[14], 6, 'cywil: 6 świateł nawigacyjnych z src/data/shipNavLights.js, bez reflektorów otoczenia');
  assert.ok(F[17] > 0, 'cywil ma strefy dysz MAIN / SIDE');
  assert.equal(ShipProxyBatch3D.stats.lights, 2, 'widoki lamp pozycyjnych (billboardy) — niszczyciel i frachtowiec');

  // Daleko: bez lamp na blasze (promień < 4 px) i bez billboardów (< 2,5 px), odblask zgaszony.
  ShipProxyBatch3D.update([destroyer], 1, { ...near, zoom: 0.003 });
  const Far = dataOf(meshOf('terrandestroyer.png'));
  assert.equal(Far[14], 0);
  assert.equal(Far[15], 0);
  assert.equal(ShipProxyBatch3D.stats.lights, 0);
});

test('budżet lamp proxy w puli billboardów: przy nadmiarze zostają kadłuby największe na ekranie', () => {
  const near = { x: cam.x, y: cam.y, zoom: 0.5 };
  // 100 frachtowców × 6 lamp > budżet; jeden duży (ciężki frachtowiec) musi zostać.
  const list = [];
  for (let i = 0; i < 100; i++) list.push(actor({ id: `haul-3${i}`, hull: 'inter_station_shuttle', x: near.x + (i % 10) * 130 - 600, y: near.y + Math.floor(i / 10) * 70 - 350 }));
  list.push(actor({ id: 'haul-39999', hull: 'heavy_freighter', x: near.x, y: near.y }));
  ShipProxyBatch3D.update(list, 1, near);
  const kept = ShipProxyBatch3D.stats.lights;
  assert.ok(kept * 6 <= 384 && kept > 0, `widoków lamp ${kept}`);
  assert.equal(ShipProxyBatch3D.stats.lightsDropped, 101 - kept);
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
