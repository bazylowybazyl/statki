// Bezpieczniki hipercruise'u przy przeszkodach (E9, 2026-10-22; pomiar: node scripts/hipercruise-kolizje-sym.mjs --tryb ring):
//   1. płyta ringu na kursie — wyjście wymuszone, zanim płyta wejdzie w drogę hamowania (HaloRingCollider.rayToSlab +
//      hypercruiseObstacleAction);
//   2. uderzenie w płytę — prędkość przycięta do prędkości wyjścia; środek, który w kroku przeszedł przez płytę, wraca
//      do pozy sprzed kroku (blockTunnel) — mały kadłub przy 40 tys. j/s nie przebija płyty Ziemi (452 j.);
//   3. wyjście z warpa / hipercruise'u w głębi olbrzyma pasa — duch trwa, statek wypychany ku próżni (escapeFromRock).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');
const { haloLocalToGame } = await import('../src/game/haloRingPlanets.js');
const H = await import('../src/game/flight/hypercruise.js');
const { HYPERCRUISE_TUNE } = await import('../src/data/driveModes.js');
const { wallBeltGiants } = await import('./helpers/beltGiantWall.mjs');
const { readIndexHtml, loadIndexFunction, sliceFunction } = await import('./helpers/indexSource.mjs');

const DT = 1 / 60;
const html = readIndexHtml();

// Kierunek świata (z centrum planety) z dala od tranzytów i hal, tam, gdzie płyta jest.
function solidAngle(col) {
  for (let s = 0; s < 128; s++) {
    const a = s * Math.PI * 2 / 128 + 0.07;
    if (col.pointInSlab(col.place.x + Math.cos(a) * (col.floorMid - 5), col.place.y + Math.sin(a) * (col.floorMid - 5))) return a;
  }
  throw new Error('brak płyty');
}

test('rayToSlab: odległość do płyty wzdłuż kursu, tranzyt i kurs obok — Infinity', () => {
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 6123456.7, y: 4234567.8 });
  const a = solidAngle(col);
  const nx = Math.cos(a), ny = Math.sin(a);
  const r0 = col.floorMid + 20000;
  const x = col.place.x + nx * r0, y = col.place.y + ny * r0;
  const d = col.rayToSlab(x, y, -nx, -ny, 60000, 0);
  assert.ok(Number.isFinite(d), 'płyta na kursie');
  assert.ok(d > 20000 - 1000 - 200 && d < 20000 + 200, `około 20 km (${d.toFixed(0)})`);
  const dPad = col.rayToSlab(x, y, -nx, -ny, 60000, 900);
  assert.ok(dPad < d - 700, 'połowa kadłuba przybliża płytę');
  assert.equal(col.rayToSlab(x, y, -nx, -ny, 15000, 0), Infinity, 'za krótki zasięg');
  assert.equal(col.rayToSlab(x, y, nx, ny, 60000, 0), Infinity, 'kurs od ringu');
  // Tranzyt: kurs wprost w środek korytarza.
  const t = col.transitAngles[0];
  const pOut = haloLocalToGame(col.place, Math.cos(t) * r0, Math.sin(t) * r0, {});
  const dir = { x: col.place.x - pOut.x, y: col.place.y - pOut.y };
  const l = Math.hypot(dir.x, dir.y);
  assert.equal(col.rayToSlab(pOut.x, pOut.y, dir.x / l, dir.y / l, 30000, 0), Infinity, 'tranzyt — przelot');
});

test('blockTunnel: środek przez płytę poza tranzytem — powrót i prędkość w głąb zerowana; tranzyt — bez zmian', () => {
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 0, y: 0 });
  const a = solidAngle(col);
  const nx = Math.cos(a), ny = Math.sin(a);
  const prev = { x: nx * (col.floorMid + 300), y: ny * (col.floorMid + 300) };
  const ship = { pos: { x: nx * (col.back - 300), y: ny * (col.back - 300) }, vel: { x: -nx * 40000, y: -ny * 40000 } };
  const res = col.blockTunnel(ship, prev.x, prev.y);
  assert.equal(res.hit, true);
  assert.ok(Math.abs(ship.pos.x - prev.x) < 1e-9 && Math.abs(ship.pos.y - prev.y) < 1e-9, 'poza sprzed kroku');
  assert.ok(Math.abs(ship.vel.x * nx + ship.vel.y * ny) < 1e-6, 'bez prędkości w głąb płyty');
  assert.ok(res.impactSpeed > 39000);
  // Bez przejścia przez połowę płyty — nic.
  const calm = { pos: { x: nx * (col.floorMid + 100), y: ny * (col.floorMid + 100) }, vel: { x: 0, y: 0 } };
  assert.equal(col.blockTunnel(calm, prev.x, prev.y).hit, false);
  // Tranzyt — przelot dozwolony.
  const t = col.transitAngles[0];
  const pIn = haloLocalToGame(col.place, Math.cos(t) * (col.back - 300), Math.sin(t) * (col.back - 300), {});
  const pOut = haloLocalToGame(col.place, Math.cos(t) * (col.floorMid + 300), Math.sin(t) * (col.floorMid + 300), {});
  const tr = { pos: { x: pIn.x, y: pIn.y }, vel: { x: 0, y: 0 } };
  assert.equal(col.blockTunnel(tr, pOut.x, pOut.y).hit, false);
  assert.equal(tr.pos.x, pIn.x);
});

test('hypercruiseObstacleAction: wyjście, gdy przeszkoda wchodzi w drogę hamowania przechwytu', () => {
  const hc = H.createHypercruise();
  assert.equal(H.configureHypercruise(hc, 'hypercruise_mk3', 'frigate'), true);
  hc.state = H.HC_ACTIVE; hc.speed = hc.vmax;
  const stop = H.hypercruiseStopDistance(hc, true);
  const v = hc.vmax, ve = HYPERCRUISE_TUNE.exitSpeed;
  assert.ok(Math.abs(stop - (v * v - ve * ve) / (2 * hc.decel * HYPERCRUISE_TUNE.interruptDecelMul)) < 1e-6);
  const look = H.hypercruiseObstacleLookAhead(hc, DT);
  assert.ok(look > stop + H.HC_OBSTACLE_MARGIN);
  assert.equal(H.hypercruiseObstacleAction(hc, Infinity, DT), null);
  assert.equal(H.hypercruiseObstacleAction(hc, look + 1, DT), null);
  assert.equal(H.hypercruiseObstacleAction(hc, look - 1, DT), 'drop');
  H.dropHypercruise(hc, 'manual', false);
  assert.equal(H.hypercruiseObstacleAction(hc, look - 1, DT), 'brake', 'wyjście zwykłe — hamuj jak przechwyt');
  hc.interrupted = true;
  assert.equal(H.hypercruiseObstacleAction(hc, look - 1, DT), null);
  H.resetHypercruise(hc);
  assert.equal(H.hypercruiseObstacleLookAhead(hc, DT), 0, 'bez lotu — bez szukania');
});

// Pętla jak w grze (stepPlayerHypercruise → ruch → stepShipRingCollisions), strefa planety pominięta (najgorszy
// przypadek — pełna prędkość do płyty): fregata i niszczyciel Mk III czołowo i pod 45° na płytę Ziemi.
function flyAtRing(col, w, h, kat, engine = 'hypercruise_mk3', klasa = 'frigate') {
  const a = solidAngle(col);
  const nx = Math.cos(a), ny = Math.sin(a), tx = -ny, ty = nx;
  const k = kat * Math.PI / 180;
  const dx = -nx * Math.sin(k) + tx * Math.cos(k), dy = -ny * Math.sin(k) + ty * Math.cos(k);
  const L = 70000 / Math.sin(k);
  const ship = { pos: { x: col.place.x + nx * (col.floorMid + 60) - dx * L, y: col.place.y + ny * (col.floorMid + 60) - dy * L },
    vel: { x: 0, y: 0 }, angle: Math.atan2(dy, dx), w, h, radius: Math.hypot(w, h) / 2 };
  const hc = H.createHypercruise();
  H.configureHypercruise(hc, engine, klasa);
  hc.state = H.HC_ACTIVE; hc.speed = hc.vmax;
  const mid = (col.back + col.floorMid) / 2;
  const reach = ship.radius;
  let minR = Infinity, hitSpeed = 0, dropped = false;
  let prevOk = false, px = 0, py = 0;
  for (let step = 0; step < 60 * 30; step++) {
    if (H.hypercruiseDriving(hc)) {
      const dist = col.rayToSlab(ship.pos.x, ship.pos.y, Math.cos(ship.angle), Math.sin(ship.angle), H.hypercruiseObstacleLookAhead(hc, DT) + reach, reach) - reach;
      const act = H.hypercruiseObstacleAction(hc, dist, DT);
      if (act === 'drop') { H.dropHypercruise(hc, 'ring', true); dropped = true; } else if (act === 'brake') hc.interrupted = true;
    }
    H.stepHypercruise(hc, { speed: hc.speed, zone: 1, remaining: Infinity, stopMargin: 0, align: 1, thrust: 1 }, DT);
    if (H.hypercruiseDriving(hc)) { ship.vel.x = Math.cos(ship.angle) * hc.speed; ship.vel.y = Math.sin(ship.angle) * hc.speed; }
    ship.pos.x += ship.vel.x * DT; ship.pos.y += ship.vel.y * DT;
    const hcRing = H.hypercruiseDriving(hc);
    let tunnel = false;
    if (hcRing && prevOk) tunnel = col.blockTunnel(ship, px, py).hit;
    const res = col.constrainShip(ship, true);
    if (hcRing && (tunnel || res.hit)) {
      hitSpeed = Math.max(hitSpeed, res.impactSpeed);
      H.resetHypercruise(hc);
      const v = Math.hypot(ship.vel.x, ship.vel.y);
      if (v > HYPERCRUISE_TUNE.exitSpeed) { ship.vel.x *= HYPERCRUISE_TUNE.exitSpeed / v; ship.vel.y *= HYPERCRUISE_TUNE.exitSpeed / v; }
    }
    prevOk = H.hypercruiseDriving(hc);
    px = ship.pos.x; py = ship.pos.y;
    minR = Math.min(minR, Math.hypot(ship.pos.x - col.place.x, ship.pos.y - col.place.y));
    if (!H.hypercruiseDriving(hc) && Math.hypot(ship.vel.x, ship.vel.y) <= HYPERCRUISE_TUNE.exitSpeed + 1) break;
  }
  return { through: minR < mid, minR, mid, dropped, hitSpeed, v: Math.hypot(ship.vel.x, ship.vel.y) };
}

test('płyta Ziemi: fregata i niszczyciel Mk III (40 tys. j/s) wychodzą przed płytą — bez przebicia', () => {
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 0, y: 0 });
  for (const [w, h] of [[192, 143], [288, 215], [1800, 806]]) {
    for (const kat of [90, 45, 15]) {
      const r = flyAtRing(col, w, h, kat);
      assert.equal(r.through, false, `${w}×${h} ${kat}°: przebicie (min r ${r.minR.toFixed(0)} < ${r.mid.toFixed(0)})`);
      assert.equal(r.dropped, true, `${w}×${h} ${kat}°: bezpiecznik wyjścia`);
      assert.ok(r.v <= HYPERCRUISE_TUNE.exitSpeed + 1, `${w}×${h} ${kat}°: prędkość po wyjściu ${r.v.toFixed(0)}`);
    }
  }
});

test('index.html: bezpiecznik w stepPlayerHypercruise, test odcinka i przycięcie prędkości w stepShipRingCollisions', () => {
  const hcStep = sliceFunction(html, 'function stepPlayerHypercruise(dt) {');
  assert.match(hcStep, /haloWorld\.rayToSlab\(ship\.pos\.x, ship\.pos\.y, Math\.cos\(ship\.angle\), Math\.sin\(ship\.angle\), look \+ reach, reach\)/);
  assert.match(hcStep, /const act = hypercruiseObstacleAction\(hc, dist, dt\);\s+if \(act === 'drop'\) stopPlayerHypercruise\('ring', true,/);
  const ring = sliceFunction(html, 'function stepShipRingCollisions(dt) {');
  assert.match(ring, /tunnel = !!haloWorld\.blockTunnel\(ship, _ringPrevX, _ringPrevY\)/);
  assert.match(ring, /vmax = HYPERCRUISE_TUNE\.exitSpeed;\s+if \(v > vmax\) \{ ship\.vel\.x = vx \* vmax \/ v; ship\.vel\.y = vy \* vmax \/ v; \}/);
  assert.match(ring, /_ringPrevOk = !!\(ship && !ship\.dead && hypercruiseDriving\(hypercruise\)\);/);
});

test('olbrzym pasa: w głębi skały duch trwa i statek leci ku próżni; płytko — zwykły collideShip', () => {
  const giants = wallBeltGiants('arch', 0, 0);
  const G = giants.entries[0].giant;
  // Ściana: skała dla x lokalnego ≥ 0, próżnia po lewej; pasmo SDF ~480 j.
  const deep = giants.escapeFromRock(G.x + 4000, G.y, {});
  assert.ok(deep, 'głąb skały');
  assert.ok(deep.x < -0.99 && Math.abs(deep.y) < 0.1, `ku próżni (${deep.x.toFixed(2)}, ${deep.y.toFixed(2)})`);
  assert.ok(deep.dist > 3000 && deep.dist < 4000 + G.band, `odległość ${deep.dist.toFixed(0)}`);
  assert.equal(giants.escapeFromRock(G.x + 0.2 * G.band, G.y, {}), null, 'płytko — wypycha collideShip');
  assert.equal(giants.escapeFromRock(G.x - 2000, G.y, {}), null, 'próżnia');
  const ship = { pos: { x: G.x + 4000, y: G.y }, vel: { x: 200, y: 50 }, dead: false };
  const scope = { ship, beltWorld: { giants }, ROCK_ESCAPE_SPEED: 3000, _rockEscape: { x: 0, y: 0, dist: 0 } };
  const escape = loadIndexFunction(html, 'function playerRockEscape() {', 'playerRockEscape', scope);
  assert.equal(escape(), true);
  assert.ok(ship.vel.x <= -2990 && Math.abs(ship.vel.y) < 400, `prędkość ku próżni (${ship.vel.x.toFixed(0)}, ${ship.vel.y.toFixed(0)})`);
  ship.pos.x = G.x - 3000;
  assert.equal(escape(), false, 'poza skałą — nic');
  assert.match(sliceFunction(html, 'function updatePlayerWarpGhost() {'), /const inRock = playerRockEscape\(\);\s+_warpGhostLinger = inRock \|\| playerHullOverlapsAny\(/);
});
