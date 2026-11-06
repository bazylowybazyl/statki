import test from 'node:test';
import assert from 'node:assert/strict';

// Ciała świata w grze (docs/PLAN-zniszczenia-swiata-3d.md F2): kawałki bazy piratów jako płaskie, zakotwiczone ciała
// silnika belek (src/game/worldBodies.js, src/game/worldChannels.js, układ i kotwice:
// src/game/story/pirateBaseBodies.js). Bez three i DOM.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { worldBodies, WORLD_BODY_TUNE: T } = await import('../src/game/worldBodies.js');
const { createPirateBaseLayout } = await import('../src/3d/portBuildings/pirateBaseLayout.js');
const { buildPirateBaseScene } = await import('../src/3d/portBuildings/pirateBaseScene.js');
const { resolvePortBuildingStyle } = await import('../src/3d/portBuildings/portBuildingStyle.js');
const { placePirateBase } = await import('../src/game/story/pirateBaseSite.js');
const { createPirateBaseSites, pirateBasePinTest } = await import('../src/game/story/pirateBaseBodies.js');

const layout = createPirateBaseLayout();
const style = resolvePortBuildingStyle('pirate');
const scene = buildPirateBaseScene(layout, style);
const AXIS = 0.3;
const CENTER = { x: 5e6, y: 4e6 };
const place = placePirateBase(CENTER, AXIS, layout);
const DT = 1 / 120;
const FOCUS = [CENTER];
const OWNERS = { habitat: { id: 'hab' }, fuel: { id: 'fuel' }, warehouse: { id: 'mag' }, piers: { id: 'pom' } };

// Miejsce jednej budowli na świeżym świecie. Bez dostrojenia bańki: kawałki statyką.
function newSite(structure) {
  worldBodies.reset();
  window.wrecks.length = 0;
  const site = createPirateBaseSites(OWNERS, { layout, scene, style }, place, {})[structure];
  worldBodies.addSite(site);
  return site;
}
// Świeża budowla: wszystkie kawałki od razu ciałami (bańka bez limitu).
function freshSite(structure) {
  const site = newSite(structure);
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
// Rozpad z ziarnem: liczbę odłamów losuje Math.random (ziarna Voronoi, voronoiFracture w hullBodies.js).
function seeded(seed, fn) {
  const saved = Math.random;
  let s = seed >>> 0;
  Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  try { return fn(); } finally { Math.random = saved; }
}
const boxCenter = (b) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });

test('kotwice w miejscu z układu bazy (raster bez lustra) i w każdej spójnej składowej kratownicy', () => {
  for (const [structure, id, grid] of [['piers', 'YA-1', false], ['piers', 'NP', false], ['fuel', 'P-1', false], ['warehouse', 'M-1', true]]) {
    const site = freshSite(structure);
    const p = pieceOf(site, id);
    assert.equal(p.state, 'live', `${id} — ciało`);
    const h = p.entity.beamHull, s = h.body.nodeStore, e = h.body.beamStore;
    const pinTest = pirateBasePinTest(layout, p.chunk);
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
    assert.ok(inLayout > 0.5 * pins || grid, `${id}: ${inLayout} z ${pins} kotwic w miejscach układu`);
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

test('budowla stoi sama: 2 s kroków bez ubytków, wysp i odłamów', () => {
  const site = freshSite('piers');
  run(240);
  for (const p of site.pieces) {
    if (p.state !== 'live') continue;
    assert.equal(p.alive, p.baseNodes, `${p.id}: ${p.alive} z ${p.baseNodes}`);
    assert.equal(p.touched, false, `${p.id} nieruszony`);
  }
  assert.equal(window.wrecks.length, 0);
});

// statek-pudło 800 × 300 j. (Atlas: pancerz 16), tor przez (x, z) układu bazy wzdłuż +x układu
function boxShip(speed, x, z, armor = 16) {
  const w = 800, h = 300, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 120; data[i * 4 + 1] = 120; data[i * 4 + 2] = 130; data[i * 4 + 3] = 255; }
  const ship = { name: 'atlas-test', x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 800000, visual: { spriteScale: 1 }, isCollidable: true };
  HullBodies.createHull(ship, { width: w, height: h, data }, { collisionArmor: armor });
  const start = place.toGame(x, z, {});
  ship.x = start.x; ship.y = start.y; ship.angle = AXIS;
  ship.vx = Math.cos(AXIS) * speed; ship.vy = Math.sin(AXIS) * speed;
  return ship;
}

test('taran pomostu: pancerny kadłub przechodzi (pancerz pary z ciałem zakotwiczonym = mniejszy), pomost pęka, sąsiedzi stoją', () => {
  const site = freshSite('piers');
  const b = pieceOf(site, 'MP').chunk.box;
  const c = boxCenter(b);
  const ship = boxShip(1500, b.x0 - 520, c.z);   // W + Shift (przy 800 j/s kadłub staje na pomoście)
  for (let k = 0; k < 240; k++) {
    ship.x += ship.vx * DT; ship.y += ship.vy * DT;
    worldBodies.step(DT, [ship]);
    HullBodies.step(DT, worldBodies.withEntities([ship, ...window.wrecks]));
  }
  const v = Math.hypot(ship.vx, ship.vy);
  const mp = pieceOf(site, 'MP');
  assert.ok(v > 300, `kadłub przeszedł przez pomost: ${Math.round(v)} j/s`);
  assert.ok(mp.touched, 'pomost ruszony');
  assert.ok(mp.alive < mp.baseNodes, `pomost pęknięty: ${mp.alive} z ${mp.baseNodes}`);
  // pomosty daleko od toru nietknięte
  for (const id of ['YA-1', 'YB-1', 'PP']) assert.equal(pieceOf(site, id).alive, pieceOf(site, id).baseNodes, `${id} nietknięty`);
  HullBodies.release(ship);
});

// salwa pocisków gry w poprzek kawałka
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

test('pociski: drobny kaliber nie odrywa płyt, ciężki robi dziurę, orka hamuje pocisk', () => {
  let site = freshSite('warehouse');
  assert.ok(volley(site, 'M-1', 15, 24, 9000) > 0, 'trafienia');
  let m1 = pieceOf(site, 'M-1');
  assert.ok(m1.baseNodes - m1.alive <= 20, `railgun 24 obr. × 15: ubytek ${m1.baseNodes - m1.alive}`);
  assert.equal(window.wrecks.filter((w) => w.beamHull?.world?.id === 'M-1').length, 0, 'bez oderwanych płyt');
  site = freshSite('warehouse');
  volley(site, 'M-1', 3, 850, 9000);
  m1 = pieceOf(site, 'M-1');
  const lost = m1.baseNodes - m1.alive;
  assert.ok(lost > 0 && lost < 250, `Yamato 850 × 3: dziura ${lost} węzłów`);
  // hamowanie: prędkość po orce mniejsza
  site = freshSite('warehouse');
  const c = pieceOf(site, 'M-1').chunk.box;
  const from = place.toGame((c.x0 + c.x1) / 2, c.z1 + 50, {}), to = place.toGame((c.x0 + c.x1) / 2, c.z0, {});
  const l = Math.hypot(to.x - from.x, to.y - from.y);
  const b = { x: from.x, y: from.y, vx: (to.x - from.x) / l * 9000, vy: (to.y - from.y) / l * 9000, damage: 150, r: 4 };
  const res = worldBodies.hitBullet(site.id, b, from.x, from.y, to.x, to.y);
  assert.ok(res, 'trafienie');
  assert.ok(Math.hypot(b.vx, b.vy) < 9000, 'pocisk wyhamował');
});

test('Hexlance: przechodzi w poprzek pomostu, grzęźnie wzdłuż długiego', () => {
  for (const [id, through] of [['MP', true], ['NP', false]]) {
    const site = freshSite('piers');
    const c = pieceOf(site, id).chunk.box;
    const from = place.toGame(c.x0 - 300, (c.z0 + c.z1) / 2 + 30, {});
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
    // kanał: pręt rozcina konstrukcję (zakotwiczone wyspy zostają na miejscu) albo niszczy węzły
    const p = pieceOf(site, id);
    if (!through) assert.ok(p.touched && (p.islands.length > 0 || p.alive < p.baseNodes), `kanał: wyspy ${p.islands.length}, ${p.alive} z ${p.baseNodes}`);
  }
});

// Odłamy kawałka (wraki `worldDebris` z bryłą kawałka) z węzłami.
const fragmentsOf = (p) => window.wrecks.filter((w) => w.worldDebris && w.beamHull?.world === p && w.beamHull.body.activeNodes > 0);

test('próg punktów: kawałek PĘKA (ocena 2026-10-07: „duże kawałki, brak debris”) — kilka odłamów, odłamki jak u statków, dryf od budowli', () => {
  const site = freshSite('piers');
  const p = pieceOf(site, 'YA-1');
  const base = p.baseNodes;
  const c = boxCenter(p.chunk.box);
  const at = place.toGame(c.x, c.z, {});
  let particles = 0;
  window.spawnHullDebris = () => { particles++; };
  const res = seeded(1, () => worldBodies.breakPiece(p, at.x, at.y, { power: 1.4, speed: 70, outX: at.x - CENTER.x, outY: at.y - CENTER.y }));
  window.spawnHullDebris = undefined;
  assert.ok(res && res.fragments >= 2, `odłamy: ${res?.fragments}`);
  assert.equal(p.state, 'lost', 'z kawałka nic nie zostało na miejscu (od razu — statyka schowana w tej klatce)');
  const frags = fragmentsOf(p);
  assert.ok(frags.length >= 2 && frags.length <= T.shatterCellsMax * 3, `odłamy-wraki: ${frags.length}`);
  for (const w of frags) assert.ok(w.beamHull.body.activeNodes >= T.shatterMinFragment, `drobnica w odłamki: ${w.beamHull.body.activeNodes}`);
  const left = frags.reduce((n, w) => n + w.beamHull.body.activeNodes, 0);
  assert.ok(res.debris >= base * 0.1 && particles >= res.debris, `odłamki: ${res.debris} węzłów, ${particles} cząstek z ${base}`);
  assert.ok(left + res.debris <= base, 'węzły odłamów + odłamki ≤ kawałek');
  assert.ok(Math.max(...frags.map((w) => w.beamHull.body.activeNodes)) < base * 0.7, 'żaden odłam nie jest prawie całym kawałkiem');
  const out = { x: at.x - CENTER.x, y: at.y - CENTER.y };
  const mass = frags.reduce((m, w) => m + w.beamHull.body.activeNodes, 0);
  const drift = frags.reduce((m, w) => m + (w.vx * out.x + w.vy * out.y) * w.beamHull.body.activeNodes, 0) / mass;
  assert.ok(drift > 0, 'odłamy dryfują od budowli');
  run(60);
  assert.ok(fragmentsOf(p).length >= 2, 'odłamy żyją po krokach');
});

test('rozpad kawałka STATYCZNEGO (poza bańką): ciało powstaje na miejscu i pęka', () => {
  const site = newSite('piers');
  worldBodies.step(DT, [{ x: CENTER.x + 1e6, y: CENTER.y }]);   // gracz daleko — wszystko statyką
  const p = pieceOf(site, 'NP');
  assert.equal(p.state, 'static');
  const c = boxCenter(p.chunk.box);
  const at = place.toGame(c.x, c.z, {});
  const res = seeded(1, () => worldBodies.breakPiece(p, at.x, at.y, { power: 2, speed: 95, outX: at.x - CENTER.x, outY: at.y - CENTER.y }));
  assert.ok(res && res.fragments >= 3, `pomost pęka na kilka odłamów: ${res?.fragments}`);
  assert.equal(p.state, 'lost');
  assert.ok(fragmentsOf(p).length >= 3);
});

test('płaski DUCH: ciałem dopiero w rozpadzie (setAllLive / breakPiece), bez kolizji, pęka na odłamy', () => {
  // Duchy bazy to dziś bryły 3D (wieża, dysk): tu kawałek płaski oznaczony duchem, rzadsza kratownica jak u duchów.
  worldBodies.reset();
  window.wrecks.length = 0;
  const site = createPirateBaseSites(OWNERS, { layout, scene, style }, place, {}).warehouse;
  const roof = pieceOf(site, 'M-1');
  roof.ghost = true;
  roof.cellSize = 30;
  worldBodies.addSite(site);
  const saved = { r: T.bubbleRadius, b: T.buildBudgetMs };
  T.bubbleRadius = 1e6; T.buildBudgetMs = 1e6;
  worldBodies.step(DT, FOCUS);
  assert.equal(roof.state, 'static', 'bańka nie buduje ducha');
  // budowla przed rozpadem: wszystkie kawałki ciałami, duch poza krokiem silnika
  worldBodies.setAllLive(site.id, true);
  T.bubbleRadius = saved.r;
  worldBodies.step(DT, [{ x: CENTER.x + 1e6, y: CENTER.y }]);
  T.buildBudgetMs = saved.b;
  for (const p of site.pieces) assert.equal(p.state, 'live', `${p.id} — ciało (setAllLive, gracz daleko)`);
  assert.ok(!worldBodies.entities().includes(roof.entity), 'duch nie wchodzi do kolizji i broni');
  assert.ok(roof.entity.beamHull.body.cellSize > T.cellSize, 'rzadsza kratownica ducha');
  run(30);
  assert.ok(!roof.touched, 'stoi nietknięty');
  const c = boxCenter(roof.chunk.box);
  const at = place.toGame(c.x, c.z, {});
  const res = seeded(1, () => worldBodies.breakPiece(roof, at.x, at.y, { power: 1.8, speed: 140, outX: at.x - CENTER.x, outY: at.y - CENTER.y }));
  assert.ok(res && res.fragments >= 3, `duch pęka: ${res?.fragments} odłamów`);
  const frags = fragmentsOf(roof);
  assert.ok(frags.length >= 3);
  for (const w of frags) assert.equal(w.isCollidable, false, 'odłam ducha nie zderza się z niczym');
  assert.equal(roof.state, 'lost');
});

test('wybuch: front ciśnienia rusza ciała w zasięgu, zwraca właściciela budowli', () => {
  const site = freshSite('piers');
  const p = pieceOf(site, 'YB-1');
  const c = boxCenter(p.chunk.box);
  const at = place.toGame(c.x, c.z, {});
  const owners = worldBodies.detonateDamage(at.x, at.y, 300, 2700);
  assert.equal(owners.length, 1);
  assert.equal(owners[0], site.owner);
  run(60);
  assert.ok(p.touched, 'pomost ruszony');
  const far = worldBodies.detonateDamage(CENTER.x + 1e5, CENTER.y, 300, 2700);
  assert.equal(far.length, 0, 'poza zasięgiem — nic');
});
