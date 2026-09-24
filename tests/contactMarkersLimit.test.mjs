import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactMarkers } from '../src/ui/contactMarkers.js';

// Strzałki kontaktów poza kadrem: w dużej bitwie każdy wróg dawał strzałkę
// z etykietą i shadowBlur, a stos przy krawędzi rósł w głąb ekranu.

const W = 1920;
const H = 1080;

function makeCtx() {
  const calls = { rotate: 0, fillText: [], shadowBlur: 0 };
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, resetTransform: noop, translate: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fill: noop, stroke: noop, setLineDash: noop, fillRect: noop, strokeRect: noop,
    rotate() { calls.rotate++; },
    measureText: (text) => ({ width: String(text).length * 6 }),
    fillText(text) { calls.fillText.push(String(text)); }
  };
  let blur = 0;
  Object.defineProperty(ctx, 'shadowBlur', {
    get: () => blur,
    set: (v) => { blur = v; if (v > 0) calls.shadowBlur++; }
  });
  return { ctx, calls };
}

function drawWith(npcs) {
  const prevWindow = globalThis.window;
  const { ctx, calls } = makeCtx();
  globalThis.window = {
    npcs,
    worldToScreen: (x, y, cam) => ({ x: (x - cam.x) * cam.zoom + W / 2, y: (y - cam.y) * cam.zoom + H / 2 })
  };
  try {
    const sensors = { getGhosts: () => new Map(), getSensorSources: () => [] };
    ContactMarkers.draw(ctx, W, H, { pos: { x: 0, y: 0 } }, sensors, 1.25, { x: 0, y: 0, zoom: 0.05 }, null, false);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
  return calls;
}

const hostile = (x, y) => ({ x, y, radius: 60, _sensorAwareness: 2, type: 'destroyer', friendly: false, dead: false });

test('stos na jednym odcinku krawędzi: 3 strzałki + licznik reszty', () => {
  const npcs = [];
  for (let i = 0; i < 100; i++) npcs.push(hostile(200000 + i * 50, i));
  const calls = drawWith(npcs);
  assert.equal(calls.rotate, 3);
  assert.ok(calls.fillText.includes('+97'), `licznik nadmiaru: ${calls.fillText.join(', ')}`);
});

test('kontakty dookoła: najwyżej 24 strzałki, bez shadowBlur', () => {
  const npcs = [];
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2;
    npcs.push(hostile(Math.cos(a) * 200000, Math.sin(a) * 200000));
  }
  const calls = drawWith(npcs);
  assert.equal(calls.rotate, 24);
  assert.equal(calls.shadowBlur, 0);
});

test('przy limicie strzałki dostają najbliższe kontakty', () => {
  const npcs = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const d = 200000 + i * 10000; // indeks = odległość rośnie
    npcs.push(hostile(Math.cos(a) * d, Math.sin(a) * d));
  }
  const calls = drawWith(npcs);
  assert.equal(calls.rotate, 24);
  // Etykieta dystansu najdalszej narysowanej strzałki: 24. kontakt = 430 000 u.
  const dists = calls.fillText.filter(t => /k$/.test(t)).map(t => parseFloat(t) * 1000);
  assert.equal(dists.length, 24);
  assert.ok(Math.max(...dists) <= 430000 + 1, `najdalsza narysowana: ${Math.max(...dists)}`);
});
