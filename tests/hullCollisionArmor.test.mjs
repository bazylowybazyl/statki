import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HULL_RENDER_PROFILES, getHullRenderSize } from '../src/data/ships.js';
import { HULL_COLLISION_ARMOR, getHullCollisionArmor } from '../src/data/hullArmor.js';
import { planShipyard } from '../src/game/story/shipyardLayout.js';
import { SHIP_SYSTEMS } from '../src/data/shipSystems.js';
import { readPng } from '../scripts/webgpu/png.mjs';
import { resizeBox } from './helpers/reactorHulls.mjs';

globalThis.window = { wrecks: [] };
const { HullBodies } = await import('../src/game/hullBodies.js');
const D = HullBodies.engine;

const IMAGES = new Map();
function hullImage(id) {
  if (!IMAGES.has(id)) {
    const path = id === 'atlas' ? '../assets/capital_ship_rect_v1.png' : `../src/assets/ships/${id.replace('_', '')}.png`;
    const png = readPng(new URL(path, import.meta.url));
    const size = getHullRenderSize(id, png.width, png.height);
    IMAGES.set(id, resizeBox(png, size.w, size.h));
  }
  return IMAGES.get(id);
}

function ship(id, x, y, angle, neutral = false) {
  const e = { x, y, angle, vx: 0, vy: 0, angVel: 0, shipFrame: id, mass: 200000 };
  assert.ok(HullBodies.createHull(e, hullImage(id)));
  if (neutral) e.beamHull.body.collisionArmor = 1;
  return e;
}

function step(entities, dt) {
  const all = [...entities, ...window.wrecks];
  for (const e of all) {
    if (e.dead) continue;
    e.x += e.vx * dt; e.y += e.vy * dt; e.angle += e.angVel * dt;
  }
  HullBodies.step(dt, all);
}

function release(entities) {
  for (const e of [...entities, ...window.wrecks]) HullBodies.release(e);
  window.wrecks.length = 0;
}

test('pancerz obejmuje każdy profil kadłuba, a nieznany nie dziedziczy odporności Atlasa', () => {
  for (const id of Object.keys(HULL_RENDER_PROFILES)) assert.ok(HULL_COLLISION_ARMOR[id] > 0, id);
  assert.equal(getHullCollisionArmor('unknown'), 1);
  assert.equal(getHullCollisionArmor(null), 1);
  assert.equal(getHullCollisionArmor('megafreighter_engine'), getHullCollisionArmor('megafreighter'));
  assert.ok(getHullCollisionArmor('atlas') > getHullCollisionArmor('battleship'));
  assert.ok(getHullCollisionArmor('battleship') > getHullCollisionArmor('destroyer'));
  assert.ok(getHullCollisionArmor('destroyer') > getHullCollisionArmor('frigate_pd'));
  assert.ok(getHullCollisionArmor('heavy_freighter') < getHullCollisionArmor('battleship'));
});

test('wszystkie ścieżki tworzenia kadłubów gry przekazują profil fizyce', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const calls = source.split('\n').filter(line => /HullBodies\.createHull\(/.test(line));
  assert.ok(calls.length >= 4, 'gracz, zmiana kadłuba, NPC i P2');
  for (const call of calls) assert.match(call, /hullProfileId/, call);
});

test('pancerz należy do ciała, współdzielony sprite nie zmienia pancerza ani obrażeń od broni drugiego statku', () => {
  const image = hullImage('pirate_destroyer');
  const a = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, mass: 20000 };
  const b = { ...a };
  HullBodies.createHull(a, image, { hullProfileId: 'atlas' });
  HullBodies.createHull(b, image, { hullProfileId: 'pirate_destroyer' });
  try {
    const A = a.beamHull.body, B = b.beamHull.body;
    assert.ok(A.collisionArmor > B.collisionArmor);
    assert.equal(A.config, B.config, 'globalne strojenie materiału zostaje wspólne');
    assert.equal(A.mass, B.mass, 'pancerz nie podmienia masy');
    HullBodies.impact(a, 0, 0, 300, { x: 100, y: 0 });
    HullBodies.impact(b, 0, 0, 300, { x: 100, y: 0 });
    assert.deepEqual(A.nodeStore.hp, B.nodeStore.hp, 'balans trafień bronią pozostaje taki sam');
    const wreck = HullBodies.convertToWreck(a);
    assert.equal(wreck.beamHull.body.collisionArmor, A.collisionArmor);
  } finally { release([a, b]); }
});

test('przy jednakowej masie mocne poszycie ustępuje słabemu, niezależnie od kolejności pary', () => {
  const image = { width: 300, height: 120, data: new Uint8ClampedArray(300 * 120 * 4).fill(255) };
  function contact(profile, reverse) {
    const a = { x: 0, y: 0, vx: 500, vy: 0, angle: 0, mass: 20000 };
    const b = { ...a, x: 300, vx: 0 };
    HullBodies.createHull(a, image, { hullProfileId: profile });
    HullBodies.createHull(b, image, { hullProfileId: 'frigate' });
    const A = a.beamHull.body, B = b.beamHull.body;
    try {
      assert.equal(A.mass, B.mass);
      A.vel.x = 500;
      D.collideBodies(reverse ? B : A, reverse ? A : B, 1 / 120, true);
      const dent = body => {
        const s = body.nodeStore;
        let sum = 0;
        // Droga zgniotu wzdłuż osi styku; wyboczenie na boki jest osobną reakcją.
        for (let i = 0; i < s.count; i++) sum += Math.abs(s.x[i] - s.ox[i]);
        return sum;
      };
      return [dent(A), dent(B)];
    } finally { release([a, b]); }
  }
  const neutral = contact('frigate', false);
  const armored = contact('atlas', false), reverse = contact('atlas', true);
  assert.ok(neutral[0] > 0 && neutral[1] > 0, 'kontrola musi faktycznie wgniatać poszycie');
  assert.ok(armored[0] < armored[1] * 0.05, `wgniecenia: ${armored}`);
  assert.ok(Math.abs(armored[0] + armored[1] - neutral[0] - neutral[1]) < 1e-8, `zgniot: ${neutral} → ${armored}, odwrotnie ${reverse}`);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(armored[i] - reverse[i]) < 1e-8, 'zamiana A/B nie zmienia ochrony');
});

// Prawdziwe sprite'y i rząd z misji 1, szarża z tabeli systemów. Same kadłuby:
// bez ostrzału, tarcz i skryptowego zabijania celów — rezultat daje fizyka.
function ramShipyard(neutral) {
  const site = planShipyard({ x: 0, y: 0 }, { x: -10000, y: 0 });
  const atlas = ship('atlas', site.rowStart.x - 1000, site.rowStart.y, 0, neutral);
  atlas.vx = 500;
  const targets = site.parked.map(p => ship(p.key.includes('battleship') ? 'pirate_battleship'
    : p.key.includes('destroyer') ? 'pirate_destroyer' : 'pirate_frigate', p.x, p.y, p.angle, neutral));
  const entities = [atlas, ...targets];
  const dt = 1 / 120, sys = SHIP_SYSTEMS.atlas;
  let contacts = 0;
  try {
    for (let i = 0; i < 1200; i++) {
      atlas.vx = i * dt < sys.duration ? Math.min(sys.speed, atlas.vx + sys.accel * dt)
        : Math.max(500, atlas.vx - sys.brake * dt);
      step(entities, dt);
      contacts += HullBodies.perf.lastContacts;
      for (const e of targets) {
        if (e.dead || !e.beamHull) continue;
        if (HullBodies.structuralState(e).ratio < 0.2) {
          HullBodies.convertToWreck(e);
          e.dead = true;
        }
      }
    }
    const ratio = HullBodies.structuralState(atlas).ratio;
    for (const wreck of window.wrecks) {
      if (neutral || wreck.dead) continue;
      // Także odłamki po rozpadzie trzymają materiał rodu, a nie domyślną fregatę.
      assert.ok([1, 1.5, 3, 16].includes(wreck.beamHull.body.collisionArmor));
      if (wreck.shipFrame) assert.equal(wreck.beamHull.body.collisionArmor, getHullCollisionArmor(wreck.shipFrame));
    }
    return { contacts, hpLoss: 1 - ratio ** 2.35, crushed: targets.filter(e => e.dead || HullBodies.structuralState(e).ratio < 0.3).length };
  } finally { release(entities); }
}

test('szarża Atlasa przez rząd misji 1 miażdży lekkie jednostki i zabiera mniej niż 1% kadłuba', () => {
  const old = ramShipyard(true), armored = ramShipyard(false);
  assert.ok(old.contacts > 0 && armored.contacts > 0);
  assert.ok(old.hpLoss > 0.03, `kontrola odtwarza stratę kadłuba: ${old.hpLoss}`);
  assert.ok(armored.hpLoss < 0.01, `Atlas stracił ${armored.hpLoss * 100}% HP kadłuba`);
  assert.ok(armored.hpLoss < old.hpLoss * 0.1, 'pancerz znacząco redukuje stratę');
  assert.ok(armored.crushed >= 3, `zgniecione cele: ${armored.crushed}`);
});

test('Atlas nie jest niezniszczalny: zderzenie z drugim Atlasem uszkadza ciężkie poszycie', () => {
  const a = ship('atlas', 0, 0, 0), b = ship('atlas', 2000, 0, Math.PI / 2);
  a.vx = SHIP_SYSTEMS.atlas.speed;
  let contacts = 0;
  try {
    for (let i = 0; i < 360; i++) { step([a, b], 1 / 120); contacts += HullBodies.perf.lastContacts; }
    assert.ok(contacts > 0);
    assert.ok(HullBodies.structuralState(a).ratio < 0.995 || HullBodies.structuralState(b).ratio < 0.995,
      `zderzenie nie uszkodziło kadłubów: ${HullBodies.structuralState(a).ratio} / ${HullBodies.structuralState(b).ratio}`);
  } finally { release([a, b]); }
});
