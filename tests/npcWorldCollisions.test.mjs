// Z12 (2026-09-26): NPC realnie ograniczane przez płytę ringu „Halo” i asteroidy.
//
// NPC całkują ruch w x/y/vx/vy (stepShipFlight, npcFlight, npcStep), a pos/vel
// mają najwyżej jako lustro, które następny krok nadpisuje. Dawne pętle kolizji
// w index.html brały tylko NPC z lustrem i wypychały lustro: NPC bez pos
// przelatywały przez ring i skały, a NPC z pos traciły wypchnięcie w następnym
// kroku ruchu. Testy puszczają PRAWDZIWE pętle z index.html
// (stepShipRingCollisions, stepShipAsteroidCollisions) na przemian z prawdziwym
// krokiem ruchu NPC (stepShipFlight) — tak jak physicsStep.
// node --test tests/npcWorldCollisions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadIndexFunction, readIndexHtml } from './helpers/indexSource.mjs';
import {
  createNpcCollisionBody,
  loadNpcCollisionBody,
  npcCollidesWithWorld,
  storeNpcCollisionBody
} from '../src/game/npcCollisionBody.js';
import { HaloRingCollider, haloShipOutline } from '../src/game/haloRingCollision.js';
import { haloGameToLocal, haloLocalToGame } from '../src/game/haloRingPlanets.js';
import { setFlightArrive, stepShipFlight } from '../src/game/flight/shipFlightModel.js';
import { syncNpcFlightState } from '../src/game/flight/npcFlight.js';
import { AsteroidField } from '../src/3d/asteroidField3D.js';
import { resolveShipAsteroidCollision } from '../src/game/asteroidDestructor.js';

const DT = 1 / 120;
const html = readIndexHtml();
const EARTH = { id: 'earth', x: 1060000, y: -250000, r: 2800 };
const TH = 0.4; // lokalny kąt ringu między tranzytem a kompleksem portu — sama płyta

const helpers = { npcCollidesWithWorld, loadNpcCollisionBody, storeNpcCollisionBody };

// Niszczyciel Terra Novy na modelu lotu (stepShipFlight): tylko x/y/vx/vy.
function makeDestroyer(x, y, extra = {}) {
  return {
    x, y, vx: 0, vy: 0, angle: 0, angVel: 0,
    mission: true, type: 'destroyer', shipFrame: 'terran_destroyer',
    radius: 300, mass: 30000,
    ...extra
  };
}

function unit(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

const ringPoint = (col, r, theta = TH) => haloLocalToGame(col.place, Math.cos(theta) * r, Math.sin(theta) * r, {});
const ringR = (col, x, y) => {
  const l = haloGameToLocal(col.place, x, y, {});
  return Math.hypot(l.x, l.y);
};

// HaloRingGame.constrainShip dla jednego ringu (bez Three): planeta, kolizja,
// wynik tylko przy trafieniu. `hits` liczy trafienia NPC (walls = false).
function ringGameFor(col, planet = EARTH) {
  return {
    hits: 0,
    constrainShip(s, walls = false) {
      col.setPlanet(planet);
      const res = col.constrainShip(s, walls);
      if (res.hit && !walls) this.hits++;
      return res.hit ? res : null;
    }
  };
}

function loadRingStep(haloRings, npcs, extra = {}) {
  const scope = {
    haloRings,
    ship: null,
    player2Ship: null,
    npcs,
    _haloRingNoticeAtMs: 0,
    pushZoneMessage: () => {},
    _npcCollisionBody: createNpcCollisionBody(),
    ...helpers,
    ...extra
  };
  return loadIndexFunction(html, 'function stepShipRingCollisions(dt) {', 'stepShipRingCollisions', scope);
}

// Czy obrys NPC (jak w kolizji) wchodzi w płytę — świeży widok, NPC nietknięty.
function inRingSlab(col, npc) {
  col.setPlanet(EARTH);
  return col.constrainShip(loadNpcCollisionBody(createNpcCollisionBody(), npc), false).hit;
}

// NPC nad habitatem leci promieniowo w płytę: cel po stronie planety, więc
// pilot pcha kadłub w płytę przez cały lot. Kolejność jak w physicsStep:
// ruch NPC (npcStep → stepShipFlight), potem pętla kolizji ringu.
function flyIntoRing(col, npc, steps = 600) {
  const aim = ringPoint(col, col.back - 3000);
  setFlightArrive(npc, aim.x, aim.y, { speedMode: 'combat', arrival: 50 });
  const haloRings = ringGameFor(col);
  const stepRing = loadRingStep(haloRings, [npc]);
  let minR = Infinity;
  for (let i = 0; i < steps; i++) {
    stepShipFlight(npc, DT);
    stepRing(DT);
    minR = Math.min(minR, ringR(col, npc.x, npc.y));
  }
  return { hits: haloRings.hits, minR };
}

function destroyerAboveRing(col, extra = {}) {
  const start = ringPoint(col, col.floorMid + 1500);
  const inward = unit(EARTH.x - start.x, EARTH.y - start.y);
  // prostokąt kadłuba (obrys 8 punktów w kolizji ringu), dziobem w płytę
  return makeDestroyer(start.x, start.y, { w: 1040, h: 440, angle: Math.atan2(inward.y, inward.x), ...extra });
}

test('ring: NPC z samym x/vx nie przelatuje przez płytę, wypchnięcie trwa po kroku ruchu', () => {
  const col = new HaloRingCollider(EARTH);
  const npc = destroyerAboveRing(col);
  const { hits, minR } = flyIntoRing(col, npc);
  assert.ok(hits > 0, 'NPC doleciał do płyty');
  assert.ok(minR > col.floorMid, `środek kadłuba nigdy za podłogą (min ${minR.toFixed(1)}, podłoga ${col.floorMid})`);
  assert.equal(npc.pos, undefined, 'bez zakładania lustra pos/vel');
  // kolejny krok ruchu (pilot dalej pcha w płytę) nie wciska kadłuba z powrotem
  stepShipFlight(npc, DT);
  assert.equal(inRingSlab(col, npc), false, 'po kroku ruchu kadłub nad płytą');
  // prędkość w głąb płyty zgaszona w x/vx, które czyta następny krok
  const out = unit(npc.x - EARTH.x, npc.y - EARTH.y);
  assert.ok(npc.vx * out.x + npc.vy * out.y > -20, `prędkość w płytę ${(npc.vx * out.x + npc.vy * out.y).toFixed(2)}`);
});

test('ring: NPC z lustrem pos/vel (syncNpcFlightState) — x/vx wypchnięte, lustro zgodne', () => {
  const col = new HaloRingCollider(EARTH);
  const npc = destroyerAboveRing(col);
  syncNpcFlightState(npc);
  const { hits, minR } = flyIntoRing(col, npc);
  assert.ok(hits > 0, 'NPC doleciał do płyty');
  assert.ok(minR > col.floorMid, `środek kadłuba nigdy za podłogą (min ${minR.toFixed(1)})`);
  assert.deepEqual([npc.pos.x, npc.pos.y], [npc.x, npc.y], 'lustro pos = x/y');
  assert.deepEqual([npc.vel.x, npc.vel.y], [npc.vx, npc.vy], 'lustro vel = vx/vy');
  stepShipFlight(npc, DT);
  assert.equal(inRingSlab(col, npc), false, 'po kroku ruchu kadłub nad płytą');
});

test('ring: kolizja liczy się z x/y, nie z nieaktualnego lustra; bez odbicia, styczna zostaje', () => {
  const col = new HaloRingCollider(EARTH);
  const p = ringPoint(col, col.floorMid + 100);
  const out = unit(p.x - EARTH.x, p.y - EARTH.y);
  const tan = { x: -out.y, y: out.x };
  const npc = makeDestroyer(p.x, p.y, {
    vx: -out.x * 300 + tan.x * 200,
    vy: -out.y * 300 + tan.y * 200,
    // lustro z dawnego kroku, daleko nad płytą — nie może zasłonić kolizji
    pos: { x: p.x + out.x * 5000, y: p.y + out.y * 5000 },
    vel: { x: 0, y: 0 }
  });
  const haloRings = ringGameFor(col);
  loadRingStep(haloRings, [npc])(DT);
  assert.equal(haloRings.hits, 1);
  assert.ok(ringR(col, npc.x, npc.y) > col.floorMid + 100, 'x/y wypchnięte z płyty');
  assert.equal(inRingSlab(col, npc), false);
  assert.deepEqual([npc.pos.x, npc.pos.y, npc.vel.x, npc.vel.y], [npc.x, npc.y, npc.vx, npc.vy], 'lustro przepisane z wyniku');
  const radial = npc.vx * out.x + npc.vy * out.y;
  const tangent = npc.vx * tan.x + npc.vy * tan.y;
  assert.ok(Math.abs(radial) < 1e-6, `prędkość w głąb płyty wyzerowana (${radial})`);
  assert.ok(Math.abs(tangent - 200) < 1e-6, `styczna bez zmian (${tangent})`);
});

test('ring: skok tranzytu, duchy, dok, wagony i martwe NPC przechodzą jak dotąd', () => {
  const col = new HaloRingCollider(EARTH);
  const p = ringPoint(col, col.floorMid + 100);
  const exempt = [
    { phase: 'warping' },          // prosta brama → brama (frachtowiec, zlecenie liczy postęp z pozycji)
    { isCollidable: false },       // duch: przylot z warpa ('warping_in')
    { docking: true },             // pozycja przypięta do portu
    { towTrainChild: true },       // wagon megafrachtowca: poza z zaczepu
    { dead: true }
  ].map((extra) => makeDestroyer(p.x, p.y, { vx: 5, vy: -7, ...extra }));
  const control = makeDestroyer(p.x, p.y);
  const haloRings = ringGameFor(col);
  loadRingStep(haloRings, [...exempt, control])(DT);
  for (const npc of exempt) {
    assert.deepEqual([npc.x, npc.y, npc.vx, npc.vy], [p.x, p.y, 5, -7], JSON.stringify(Object.keys(npc).slice(-1)));
    assert.equal(npcCollidesWithWorld(npc), false);
  }
  assert.equal(haloRings.hits, 1, 'tylko zwykły NPC');
  assert.ok(ringR(col, control.x, control.y) > col.floorMid + 100);
});

test('ring: gracz bez zmian — pos/vel, ściany portu i komunikat przy uderzeniu', () => {
  const col = new HaloRingCollider(EARTH);
  const p = ringPoint(col, col.floorMid + 250);
  const out = unit(p.x - EARTH.x, p.y - EARTH.y);
  const player = { pos: { x: p.x, y: p.y }, vel: { x: -out.x * 300, y: -out.y * 300 }, angle: 0, w: 1800, h: 806, radius: 300, isPlayer: true };
  const messages = [];
  let wallsArg = null;
  const haloRings = {
    constrainShip(s, walls) {
      if (s === player) wallsArg = walls;
      col.setPlanet(EARTH);
      const res = col.constrainShip(s, walls);
      return res.hit ? res : null;
    }
  };
  // performance.now() w node startuje od zera — ostatni komunikat „dawno temu”
  loadRingStep(haloRings, [], { ship: player, pushZoneMessage: (text) => messages.push(text), _haloRingNoticeAtMs: -1e9 })(DT);
  assert.equal(wallsArg, true, 'gracz ze ścianami portu');
  assert.ok(ringR(col, player.pos.x, player.pos.y) > col.floorMid + 250, 'gracz wypchnięty przez pos');
  assert.ok(Math.abs(player.vel.x * out.x + player.vel.y * out.y) < 1e-6);
  assert.equal(player.x, undefined, 'graczowi nie dopisujemy x/y');
  assert.deepEqual(messages, ['RING: PŁYTA HABITATU — PRZELOT TYLKO TRANZYTEM']);
});

// ---------------------------------------------------------------------------
// Asteroidy
// ---------------------------------------------------------------------------

// BIG żelazna (promień kolizji 630) w (0, 0); pole bez GPU jak w
// asteroidHexAdapter.test.mjs. Skała nieruchoma: impuls nie przesuwa świata.
function makeRockField() {
  const asteroid = { alive: true, type: 'iron', size: 'BIG', worldX: 0, worldY: 0, scale: 1500, vx: 0, vy: 0, hardness: 0.7 };
  const field = Object.create(AsteroidField.prototype);
  field.spatial = { forEachInRadius(_x, _y, _r, cb) { cb(asteroid); } };
  field._isNearView = () => false;
  field._promoteAsteroidToHex = () => null;
  field._applyImpulseToAsteroid = () => {};
  field.applyDamageAt = () => {};
  field._flushAll = () => {};
  return { field, asteroid };
}

// Środowisko pętli: window gry (pole, obrażenia), przywracane po teście.
function withGameWindow(win, fn) {
  const old = globalThis.window;
  globalThis.window = win;
  try {
    return fn();
  } finally {
    if (old === undefined) delete globalThis.window;
    else globalThis.window = old;
  }
}

function loadAsteroidStep(npcs, extra = {}) {
  const scope = {
    ship: null,
    player2Ship: null,
    npcs,
    _npcCollisionBody: createNpcCollisionBody(),
    ...helpers,
    ...extra
  };
  return loadIndexFunction(html, 'function stepShipAsteroidCollisions(dt) {', 'stepShipAsteroidCollisions', scope);
}

// Głębokość wejścia kadłuba w skałę (jak w kolizji) — świeży widok.
function rockPenetration(npc, asteroid) {
  const res = resolveShipAsteroidCollision(loadNpcCollisionBody(createNpcCollisionBody(), npc), asteroid);
  return res?.collided ? Math.hypot(res.separationDx, res.separationDy) / 1.05 : 0;
}

// NPC leci przez środek skały do punktu za nią; ruch NPC, potem pętla kolizji.
function flyIntoRock(npc, steps = 600) {
  const { field, asteroid } = makeRockField();
  const damage = [];
  const win = { asteroidField: field, applyDamageToNPC: (target, dmg, src) => damage.push({ target, dmg, src }) };
  return withGameWindow(win, () => {
    setFlightArrive(npc, -3000, 0, { speedMode: 'combat', arrival: 50 });
    const stepRocks = loadAsteroidStep([npc]);
    let minX = Infinity;
    for (let i = 0; i < steps; i++) {
      stepShipFlight(npc, DT);
      stepRocks(DT);
      minX = Math.min(minX, npc.x);
    }
    stepShipFlight(npc, DT); // kolejny krok ruchu po ostatniej kolizji
    return { damage, minX, penetration: rockPenetration(npc, asteroid) };
  });
}

test('asteroidy: NPC z samym x/vx odbija się od skały, obrażenia idą w encję NPC', () => {
  const npc = makeDestroyer(2200, 0, { angle: Math.PI });
  const { damage, minX, penetration } = flyIntoRock(npc);
  assert.ok(damage.length > 0, 'zderzenie ze skałą');
  assert.ok(damage.every((d) => d.target === npc && d.src === 'asteroid'), 'obrażenia w NPC, nie w widok kinematyki');
  assert.ok(minX > 630, `kadłub nie przeszedł przez skałę (min x ${minX.toFixed(1)})`);
  assert.ok(penetration < 1, `po kroku ruchu kadłub poza skałą (wejście ${penetration.toFixed(3)})`);
  assert.equal(npc.pos, undefined, 'bez zakładania lustra pos/vel');
});

test('asteroidy: NPC z lustrem pos/vel — wypchnięcie w x/vx, lustro zgodne', () => {
  const npc = makeDestroyer(2200, 0, { angle: Math.PI });
  syncNpcFlightState(npc);
  delete npc.w; // syncNpcFlightState dopisuje wymiary — tu kadłub kołowy (promień)
  delete npc.h;
  const { damage, minX, penetration } = flyIntoRock(npc);
  assert.ok(damage.length > 0);
  assert.ok(minX > 630, `kadłub nie przeszedł przez skałę (min x ${minX.toFixed(1)})`);
  assert.ok(penetration < 1, `po kroku ruchu kadłub poza skałą (wejście ${penetration.toFixed(3)})`);
  assert.deepEqual([npc.pos.x, npc.pos.y, npc.vel.x, npc.vel.y], [npc.x, npc.y, npc.vx, npc.vy]);
});

test('asteroidy: gracz bez zmian (pos/vel, obrażenia gracza), skok tranzytu NPC przelatuje', () => {
  const { field, asteroid } = makeRockField();
  const player = { pos: { x: 700, y: 0 }, vel: { x: -300, y: 0 }, radius: 300, angle: 0, isPlayer: true, mass: 800000 };
  const warping = makeDestroyer(0, 500, { vx: 4000, vy: 0, phase: 'warping' });
  const playerHits = [];
  const npcHits = [];
  const win = {
    asteroidField: field,
    ship: player,
    applyDamageToPlayer: (dmg) => playerHits.push(dmg),
    applyDamageToNPC: (target) => npcHits.push(target)
  };
  withGameWindow(win, () => loadAsteroidStep([warping], { ship: player })(DT));
  assert.ok(Math.hypot(player.pos.x, player.pos.y) > 700, 'gracz wypchnięty przez pos');
  assert.ok(player.vel.x > -300, 'prędkość gracza w skałę zgaszona');
  assert.equal(player.x, undefined, 'graczowi nie dopisujemy x/y');
  assert.equal(playerHits.length, 1, 'obrażenia gracza przez applyDamageToPlayer');
  assert.deepEqual([warping.x, warping.y, warping.vx], [0, 500, 4000], 'skok tranzytu bez kolizji');
  assert.equal(npcHits.length, 0);
  assert.equal(asteroid.alive, true);
});

// ---------------------------------------------------------------------------
// Widok kinematyki
// ---------------------------------------------------------------------------

test('widok kinematyki: ta sama kolizja co statek z pos/vel, zapis do x/y/vx/vy i lustra', () => {
  const npc = { x: 850, y: -40, vx: -250, vy: 30, angle: 2.8, radius: 260, mass: 40000 };
  const asPlayerShape = { pos: { x: npc.x, y: npc.y }, vel: { x: npc.vx, y: npc.vy }, angle: npc.angle, radius: npc.radius, mass: npc.mass };
  const body = loadNpcCollisionBody(createNpcCollisionBody(), npc);
  const rock = { alive: true, type: 'iron', size: 'L', worldX: 0, worldY: 0, scale: 1400, vx: 0, vy: 0 };
  assert.deepEqual(resolveShipAsteroidCollision(body, rock), resolveShipAsteroidCollision(asPlayerShape, rock),
    'brak w/h/rammingMass = zera w widoku, ta sama kolizja');
  const a = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  const b = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  assert.equal(haloShipOutline(body, a), haloShipOutline(asPlayerShape, b));
  assert.deepEqual(a, b, 'ten sam obrys w kolizji ringu');

  body.pos.x += 12; body.pos.y -= 3; body.vel.x = 7; body.vel.y = 0;
  storeNpcCollisionBody(body, npc);
  assert.deepEqual([npc.x, npc.y, npc.vx, npc.vy], [862, -43, 7, 0]);
  assert.equal(npc.pos, undefined, 'lustra nie zakładamy');
  const mirrored = { x: 1, y: 2, vx: 3, vy: 4, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
  storeNpcCollisionBody(loadNpcCollisionBody(createNpcCollisionBody(), mirrored), mirrored);
  assert.deepEqual([mirrored.pos.x, mirrored.pos.y, mirrored.vel.x, mirrored.vel.y], [1, 2, 3, 4], 'lustro z x/y/vx/vy');
});
