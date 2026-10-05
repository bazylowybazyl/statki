import test from 'node:test';
import assert from 'node:assert/strict';

// Ciała świata w grze (docs/PLAN-zniszczenia-swiata-3d.md F2): kawałki suchego doku piratów jako płaskie,
// zakotwiczone ciała silnika belek (src/game/worldBodies.js, src/game/worldChannels.js, układ i kotwice:
// src/game/story/pirateDryDockBodies.js). Bez three i DOM.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { worldBodies, WORLD_BODY_TUNE: T } = await import('../src/game/worldBodies.js');
const { createPirateDryDockLayout } = await import('../src/3d/portBuildings/pirateDryDockLayout.js');
const { buildPirateDryDockScene } = await import('../src/3d/portBuildings/pirateDryDockScene.js');
const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
const { placeDryDock } = await import('../src/game/story/shipyardLayout.js');
const { createPirateDryDockSite, dryDockPinTest, prebuildPirateDryDockBodies } = await import('../src/game/story/pirateDryDockBodies.js');

const layout = createPirateDryDockLayout();
const style = resolvePortBuildingStyle('pirate');
const scene = buildPirateDryDockScene(layout, style);
const AXIS = 0.3;
const CENTER = { x: 5e6, y: 4e6 };
const place = placeDryDock(CENTER, AXIS, layout);
const DT = 1 / 120;
const FOCUS = [CENTER];
prebuildPirateDryDockBodies(layout, scene, style.palette);

// Świeży dok: wszystkie kawałki od razu ciałami (bańka bez limitu).
function freshSite(id = 'T') {
  worldBodies.reset();
  window.wrecks.length = 0;
  const site = createPirateDryDockSite({ id, x: CENTER.x, y: CENTER.y }, { layout, scene, style }, place, {});
  worldBodies.addSite(site);
  const saved = { r: T.bubbleRadius, b: T.buildBudgetMs };
  T.bubbleRadius = 1e6; T.buildBudgetMs = 1e6;
  worldBodies.step(DT, FOCUS);
  T.bubbleRadius = saved.r; T.buildBudgetMs = saved.b;
  return site;
}
function run(steps, extra = []) {
  for (let k = 0; k < steps; k++) {
    worldBodies.step(DT, FOCUS);
    HullBodies.step(DT, worldBodies.withEntities([...extra, ...window.wrecks]));
  }
}
const pieceOf = (site, id) => site.pieces.find((p) => p.id === id);

test('kotwice w miejscu z układu doku (raster bez lustra) i w każdej spójnej składowej kratownicy', () => {
  const site = freshSite();
  for (const id of ['K-W', 'S-2', 'H-W1', 'G-W']) {
    const p = pieceOf(site, id);
    assert.equal(p.state, 'live', `${id} — ciało`);
    const h = p.entity.beamHull, s = h.body.nodeStore, e = h.body.beamStore;
    const pinTest = dryDockPinTest(layout, p.chunk);
    let pins = 0, inLayout = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i] || s.invMass[i] !== 0) continue;
      pins++;
      const w = HullBodies.nodeWorld(h, i, {});
      const q = place.toHub(w.x, w.y, {});
      if (pinTest(q.x, q.z)) inLayout++;
    }
    assert.ok(pins > 0, `${id}: kotwice`);
    // kotwice z układu trafiają w swoje miejsca; reszta to fundamenty siatki i kotwice składowych
    assert.ok(inLayout > 0.5 * pins || id === 'S-2', `${id}: ${inLayout} z ${pins} kotwic w miejscach układu`);
    // każda spójna składowa (belki niezerwane) ma kotwicę
    const seen = new Uint8Array(s.count);
    for (let i0 = 0; i0 < s.count; i0++) {
      if (!s.active[i0] || seen[i0]) continue;
      const stack = [i0]; seen[i0] = 1; let pinned = false;
      while (stack.length) {
        const i = stack.pop();
        if (s.invMass[i] === 0) pinned = true;
        for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
          const bi = s.adj[q];
          if (e.broken[bi]) continue;
          const o = e.a[bi] === i ? e.b[bi] : e.a[bi];
          if (s.active[o] && !seen[o]) { seen[o] = 1; stack.push(o); }
        }
      }
      assert.ok(pinned, `${id}: składowa od węzła ${i0} bez kotwicy`);
    }
  }
});

test('dok stoi sam: 2 s kroków bez ubytków, wysp i odłamów', () => {
  const site = freshSite();
  run(240);
  for (const p of site.pieces) {
    if (p.state !== 'live') continue;
    assert.equal(p.alive, p.baseNodes, `${p.id}: ${p.alive} z ${p.baseNodes}`);
    assert.equal(p.touched, false, `${p.id} nieruszony`);
  }
  assert.equal(window.wrecks.length, 0);
});

// statek-pudło 800 × 300 j. (Atlas: pancerz 16) na torze bramy G-W, wzdłuż osi doku
function boxShip(speed, armor = 16) {
  const w = 800, h = 300, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 120; data[i * 4 + 1] = 120; data[i * 4 + 2] = 130; data[i * 4 + 3] = 255; }
  const ship = { name: 'atlas-test', x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 800000, visual: { spriteScale: 1 }, isCollidable: true };
  HullBodies.createHull(ship, { width: w, height: h, data }, { collisionArmor: armor });
  const gate = layout.chunkById.get('G-W').box;
  const start = place.toGame(gate.x0 - 520, layout.parking.laneZ, {});
  ship.x = start.x; ship.y = start.y; ship.angle = AXIS;
  ship.vx = Math.cos(AXIS) * speed; ship.vy = Math.sin(AXIS) * speed;
  return ship;
}

test('taran cienkiej bramy: pancerny kadłub przechodzi (pancerz pary z ciałem zakotwiczonym = mniejszy), brama pęka', () => {
  const site = freshSite();
  const ship = boxShip(800);
  for (let k = 0; k < 240; k++) {
    ship.x += ship.vx * DT; ship.y += ship.vy * DT;
    worldBodies.step(DT, [ship]);
    HullBodies.step(DT, worldBodies.withEntities([ship, ...window.wrecks]));
  }
  const v = Math.hypot(ship.vx, ship.vy);
  const gw = pieceOf(site, 'G-W');
  assert.ok(v > 550, `kadłub przeszedł przez bramę: ${Math.round(v)} j/s`);
  assert.ok(gw.touched, 'brama ruszona');
  assert.ok(gw.alive < gw.baseNodes, `brama pęknięta: ${gw.alive} z ${gw.baseNodes}`);
  // trzon obok toru nietknięty (bryły pod płaszczyzną — rękawy trapów — nie są ciałem)
  for (const id of ['S-W', 'S-1', 'S-2']) assert.equal(pieceOf(site, id).alive, pieceOf(site, id).baseNodes, `${id} nietknięty`);
  HullBodies.release(ship);
});

// salwa pocisków gry z parkingu w trzon (wieże Atlasa po alarmie)
function volley(site, id, n, damage, speed) {
  const c = pieceOf(site, id).chunk.box;
  let r = 7;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  let hits = 0;
  for (let q = 0; q < n; q++) {
    const x = c.x0 + 60 + rnd() * (c.x1 - c.x0 - 120);
    const from = place.toGame(x, c.z1 + 700, {}), to = place.toGame(x, c.z0 - 600, {});
    const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy);
    const b = { x: from.x, y: from.y, vx: dx / l * speed, vy: dy / l * speed, damage, r: 4 };
    for (let k = 0; k < 80; k++) {
      const x0 = b.x, y0 = b.y, x1 = b.x + b.vx * DT, y1 = b.y + b.vy * DT;
      const res = worldBodies.hitBullet(site.id, b, x0, y0, x1, y1);
      if (res) hits++;
      if (res && res.stopped) break;
      b.x = x1; b.y = y1;
      run(1);
    }
    run(6);
  }
  run(240);
  return hits;
}

test('pociski: drobny kaliber nie odrywa płyt trzonu, ciężki robi dziurę, orka hamuje pocisk', () => {
  let site = freshSite();
  assert.ok(volley(site, 'S-2', 15, 24, 9000) > 0, 'trafienia');
  let s2 = pieceOf(site, 'S-2');
  assert.ok(s2.baseNodes - s2.alive <= 20, `railgun 24 obr. × 15: ubytek ${s2.baseNodes - s2.alive}`);
  assert.equal(window.wrecks.filter((w) => w.beamHull?.world?.id === 'S-2').length, 0, 'bez oderwanych płyt');
  site = freshSite();
  volley(site, 'S-2', 3, 850, 9000);
  s2 = pieceOf(site, 'S-2');
  const lost = s2.baseNodes - s2.alive;
  assert.ok(lost > 0 && lost < 150, `Yamato 850 × 3: dziura ${lost} węzłów`);
  // hamowanie: prędkość po orce mniejsza, ułamek straty jak przy prędkości orki dema
  site = freshSite();
  const c = pieceOf(site, 'S-2').chunk.box;
  const from = place.toGame((c.x0 + c.x1) / 2, c.z1 + 50, {}), to = place.toGame((c.x0 + c.x1) / 2, c.z0, {});
  const l = Math.hypot(to.x - from.x, to.y - from.y);
  const b = { x: from.x, y: from.y, vx: (to.x - from.x) / l * 9000, vy: (to.y - from.y) / l * 9000, damage: 150, r: 4 };
  const res = worldBodies.hitBullet(site.id, b, from.x, from.y, to.x, to.y);
  assert.ok(res, 'trafienie');
  assert.ok(Math.hypot(b.vx, b.vy) < 9000, 'pocisk wyhamował');
});

test('Hexlance: przechodzi przez cienką bramę, grzęźnie w trzonie', () => {
  for (const [id, through] of [['G-E', true], ['S-3', false]]) {
    const site = freshSite();
    const c = pieceOf(site, id).chunk.box;
    const z = id.startsWith('G-') ? layout.parking.laneZ : (c.z0 + c.z1) / 2 + 30;
    const from = place.toGame(c.x0 - 300, z, {});
    const ux = Math.cos(AXIS), uy = Math.sin(AXIS);
    const proj = { x: from.x, y: from.y, vx: ux * 12000, vy: uy * 12000 };
    let stopped = false;
    for (let k = 0; k < 240 && !stopped; k++) {
      const x0 = proj.x, y0 = proj.y, x1 = proj.x + proj.vx * DT, y1 = proj.y + proj.vy * DT;
      const res = worldBodies.plowLance(site.id, proj, x0, y0, x1, y1);
      if (res && res.stopped) stopped = true;
      else { proj.x = x1; proj.y = y1; }
      run(1);
    }
    assert.equal(!stopped, through, `${id}: ${through ? 'przechodzi' : 'grzęźnie'} (v ${Math.round(Math.hypot(proj.vx, proj.vy))})`);
    // kanał w trzonie: pręt rozcina konstrukcję (zakotwiczone wyspy zostają na miejscu) albo niszczy węzły
    const p = pieceOf(site, id);
    if (!through) assert.ok(p.touched && (p.islands.length > 0 || p.alive < p.baseNodes), `kanał w trzonie: wyspy ${p.islands.length}, ${p.alive} z ${p.baseNodes}`);
  }
});

test('próg punktów: kawałek odpada fizycznie (kotwice puszczają, dryf od doku), wrak z bryłą kawałka', () => {
  const site = freshSite();
  const p = pieceOf(site, 'H-W1');
  const c = p.chunk.box;
  const at = place.toGame((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, {});
  assert.ok(worldBodies.breakPiece(p, at.x, at.y, { power: 1.4, speed: 70, outX: at.x - CENTER.x, outY: at.y - CENTER.y }));
  run(60);
  assert.equal(p.state, 'lost', 'z kawałka nic nie zostało na miejscu');
  const debris = window.wrecks.filter((w) => w.worldDebris && w.beamHull?.world === p);
  assert.ok(debris.length >= 1, 'odłam(y) jako wraki');
  const out = { x: at.x - CENTER.x, y: at.y - CENTER.y };
  const big = debris.sort((a, b) => b.beamHull.body.activeNodes - a.beamHull.body.activeNodes)[0];
  assert.ok((big.vx * out.x + big.vy * out.y) > 0, 'dryf od doku');
});

test('wybuch: front ciśnienia rusza ciała w zasięgu, zwraca właściciela budowli', () => {
  const site = freshSite();
  const p = pieceOf(site, 'H-W2');
  const c = p.chunk.box;
  const at = place.toGame((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, {});
  const owners = worldBodies.detonateDamage(at.x, at.y, 300, 2700);
  assert.equal(owners.length, 1);
  assert.equal(owners[0], site.owner);
  run(60);
  assert.ok(p.touched, 'ściana ruszona');
  const far = worldBodies.detonateDamage(CENTER.x + 1e5, CENTER.y, 300, 2700);
  assert.equal(far.length, 0, 'poza zasięgiem — nic');
});
