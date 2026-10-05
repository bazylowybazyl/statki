import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionTargetMarkers } from '../src/ui/missionTargetMarkers.js';
import { ViewState3D } from '../src/game/view3D.js';

function canvasSpy() {
  const labels = [];
  return {
    labels, save() {}, restore() {}, setLineDash() {}, translate() {}, rotate() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, strokeText() {},
    measureText: (text) => ({ width: text.length * 7 }), fillText: (text) => labels.push(text)
  };
}
const target = (entity, label = 'Wieżyczka 01') => ({ entity, label, radius: 50 });
const view = () => ({
  ship: { pos: { x: 0, y: 0 } }, W: 1000, H: 700, radarRange: 1000, time: 1,
  project(x, y, out) { out.x = 500 + x; out.y = 350 + y; out.depth = 1; return out; }
});

test('markery misji: tylko wskazane cele, aktualny zasięg radaru i żywa pozycja encji', () => {
  const painter = createMissionTargetMarkers(), ctx = canvasSpy(), v = view();
  const turret = { pos: { x: 300, y: 400 }, x: 99999, y: 99999, hp: 100 };
  const distant = { x: 1001, y: 0, hp: 100 };
  const targets = new Map([['turret', target(turret)], ['far', target(distant, 'Daleki cel')]]);
  assert.equal(painter.draw(ctx, targets, v), 1);
  assert.ok(ctx.labels.includes('WIEŻYCZKA 01'));
  assert.ok(ctx.labels.includes('ZNISZCZ · 0,5 km'));
  assert.ok(!ctx.labels.includes('DALEKI CEL'));
  // Cel jedzie z encją; snapshot x/y i poprzedni zasięg niczego nie odsłaniają.
  turret.pos.x = 1001; turret.pos.y = 0;
  assert.equal(painter.draw(ctx, targets, v), 0);
  v.radarRange = 2000;
  assert.equal(painter.draw(ctx, targets, v), 2, 'zmiana zasięgu radaru działa bez ponownej rejestracji');
  targets.delete('turret');
  assert.equal(painter.draw(ctx, targets, v), 1, 'zdjęty cel nie zostaje w cache rysunku');
  targets.clear();
  assert.equal(painter.draw(ctx, targets, v), 0);
});

test('markery misji: wrak, rozbita stacja, odlot i maskowanie chowają podpis od razu', () => {
  const painter = createMissionTargetMarkers(), ctx = canvasSpy(), v = view();
  const entity = { x: 100, y: 0, hp: 100 };
  const targets = new Map([['target', target(entity)]]);
  assert.equal(painter.draw(ctx, targets, v), 1);
  for (const flag of ['dead', 'destroyed', '_destroyed3D', 'removed', 'warpedOut']) {
    entity[flag] = true;
    assert.equal(painter.draw(ctx, targets, v), 0, flag);
    entity[flag] = false;
  }
  entity.hp = 0;
  assert.equal(painter.draw(ctx, targets, v), 0);
  entity.hp = 100;
  entity.cloak = { state: 'on' };
  assert.equal(painter.draw(ctx, targets, v), 0);
});

test('markery misji: cele na granicy radaru poza kadrem i za kamerą 3D zachowują etykietę', () => {
  const painter = createMissionTargetMarkers(), ctx = canvasSpy(), v = view();
  const targets = new Map([['edge', target({ x: 1000, y: 0, hp: 100 })]]);
  assert.equal(painter.draw(ctx, targets, v), 1, 'dokładnie na granicy radaru');
  const camera = new ViewState3D();
  camera.setLookAt({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 45, v.W, v.H, 10, 10000);
  v.project = (x, y, out) => camera.project(x, y, 0, out);
  targets.set('edge', target({ x: 100, y: 50, hp: 100 }));
  assert.equal(painter.draw(ctx, targets, v), 1, 'rzut perspektywy, bez camera.zoom');
  camera.setLookAt({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 1000 }, { x: 0, y: 1, z: 0 }, 45, v.W, v.H, 10, 10000);
  assert.equal(painter.draw(ctx, targets, v), 1, 'cel za kamerą ma wskaźnik krawędzi');
});
