import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionTargetMarkers } from '../src/ui/missionTargetMarkers.js';
import { ViewState3D } from '../src/game/view3D.js';
import { layoutSelectionLabels } from '../src/ui/commandOverlay.js';

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
  assert.ok(ctx.labels.includes('0,5 km'));
  assert.ok(!ctx.labels.some((t) => t.includes('ZNISZCZ')), 'bez napisu ZNISZCZ — czerwień mówi, że to wróg');
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

test('markery misji: rząd celów jednej grupy ma ramkę każdy, ale jeden podpis z licznikiem', () => {
  const painter = createMissionTargetMarkers(), ctx = canvasSpy(), v = view();
  v.radarRange = 5000;
  const targets = new Map();
  // Jak parking suchego doku: 10 okrętów burta w burtę (ramki ~100 px, co 60 px).
  for (let i = 0; i < 10; i++) {
    targets.set(`ram-${i}`, { entity: { x: -250 + i * 60, y: 0, hp: 100 }, label: `D-${String(i + 1).padStart(2, '0')}`, radius: 50, group: 'Parking' });
  }
  targets.set('boss', target({ x: 0, y: -260, hp: 100 }, 'Supercapital Iron Skull'));
  assert.equal(painter.draw(ctx, targets, v), 11, 'wszystkie cele dalej mają ramki');
  const subs = ctx.labels.filter((t) => t.endsWith(' km'));
  assert.equal(subs.length, 2, `jeden podpis rzędu + jeden celu bez grupy (było: ${subs.join(' | ')})`);
  assert.ok(ctx.labels.includes('PARKING'));
  assert.ok(ctx.labels.includes('×10 · 0,0 km'), 'licznik i odległość do najbliższego');
  assert.ok(ctx.labels.includes('SUPERCAPITAL IRON SKULL'), 'cel spoza grupy z własną nazwą');
  assert.ok(!ctx.labels.includes('D-04'));

  // Rozsunięte daleko — znowu osobne podpisy.
  let i = 0;
  for (const m of targets.values()) if (m.group) m.entity.x = -2400 + (i++) * 480;
  ctx.labels.length = 0;
  v.W = 6000; v.project = (x, y, out) => { out.x = 3000 + x; out.y = 350 + y; out.depth = 1; return out; };
  painter.draw(ctx, targets, v);
  assert.equal(ctx.labels.filter((t) => t.endsWith(' km')).length, 11);
});

test('markery misji: cele grupy poza kadrem przy jednej krawędzi — jeden grot', () => {
  const painter = createMissionTargetMarkers(), ctx = canvasSpy(), v = view();
  v.radarRange = 5000;
  const targets = new Map();
  for (let i = 0; i < 6; i++) targets.set(`e-${i}`, { entity: { x: 1500, y: -40 + i * 15, hp: 100 }, label: `Eskorta 0${i + 1}`, radius: 40, group: 'Eskorta' });
  assert.equal(painter.draw(ctx, targets, v), 6);
  assert.deepEqual(ctx.labels.filter((t) => t.endsWith(' km')), ['×6 · 1,5 km']);
});

test('układ podpisów celów: kreska wyprowadzenia nie rośnie ponad limit', () => {
  const frame = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, len: 150, prev: { sx: 1, sy: -1, gap: 180 } });
  // Ciasny tłum ramek (12 celów prawie w jednym miejscu): bez limitu układ szukał miejsca kreskami 80–180 px.
  const entries = [];
  for (let k = 0; k < 12; k++) {
    const x = 500 + (k % 3) * 2, y = 400 + Math.floor(k / 3) * 2;
    entries.push(frame(x, y, x + 40, y + 40));
  }
  layoutSelectionLabels(entries, 1600, 900, [], { maxGap: 52 });
  for (const e of entries) assert.ok(e.place.gap <= 52, `kreska ${e.place.gap} px`);
  layoutSelectionLabels(entries, 1600, 900, [], { maxGap: 52, drop: true });
  assert.ok(entries.some((e) => e.place === null), 'drop: podpis bez miejsca znika, zostaje ramka');
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
