import test from 'node:test';
import assert from 'node:assert/strict';

import { voxelizeTriangles, buildVoxelBody, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { Destructor3D, createDestructor3DConfig, getSearchOffsets3D } from '../src/game/destructor3D.js';

const CS = 0.5;

function makeCubeBody({ size = 2, position = { x: 0, y: 0, z: 0 }, velocity = { x: 0, y: 0, z: 0 }, name = 'cube', noSplit = false } = {}) {
  const vox = voxelizeTriangles(
    makeBoxTriangles(size, size, size, 0.05, 0.05, 0.05),
    null,
    { cellSize: CS, shellLayers: 0 }
  );
  const data = buildVoxelBody(vox, { cellMassBase: 10 });
  return Destructor3D.createBody(data, { position, velocity, name, noSplit });
}

function makeBarBody({ length = 6, position = { x: 0, y: 0, z: 0 } } = {}) {
  const vox = voxelizeTriangles(
    makeBoxTriangles(length, 1, 1, 0.05, 0.05, 0.05),
    null,
    { cellSize: CS, shellLayers: 0 }
  );
  const data = buildVoxelBody(vox, { cellMassBase: 10 });
  return Destructor3D.createBody(data, { position, name: 'bar' });
}

function freshSystem() {
  Destructor3D.init(createDestructor3DConfig(CS));
  Destructor3D.onDebris = null;
  Destructor3D.perf.bodiesSplit = 0;
  return Destructor3D.config;
}

function totalActive(bodies) {
  let sum = 0;
  for (const b of bodies) if (!b.dead) sum += b.grid.activeCount;
  return sum;
}

function maxDeformation(body) {
  let peak = 0;
  for (const c of body.grid.cells) {
    if (!c.active) continue;
    const m = Math.abs(c.tx) + Math.abs(c.ty) + Math.abs(c.tz);
    if (m > peak) peak = m;
  }
  return peak;
}

test('getSearchOffsets3D: posortowane rosnąco, zaczyna od zera', () => {
  const offs = getSearchOffsets3D(2);
  assert.equal(offs[0], 0);
  assert.equal(offs[1], 0);
  assert.equal(offs[2], 0);
  let prev = 0;
  for (let i = 0; i < offs.length; i += 3) {
    const d2 = offs[i] * offs[i] + offs[i + 1] * offs[i + 1] + offs[i + 2] * offs[i + 2];
    assert.ok(d2 >= prev, 'offsety nieposortowane');
    prev = d2;
    assert.ok(d2 <= 4);
  }
});

test('createBody: masa, promień, granica, ekspozycja', () => {
  freshSystem();
  const body = makeCubeBody({});
  assert.ok(body.mass > 0);
  assert.ok(body.radius > 1);
  assert.equal(body.grid.activeCount, body.grid.cells.length);
  Destructor3D.rebuildBoundary(body.grid);
  assert.ok(body.grid.boundary.length > 0, 'brak komórek brzegowych');
  assert.ok(body.grid.boundary.length <= body.grid.cells.length);
  // wnętrze pełnego sześcianu nie jest brzegiem
  const interior = body.grid.cells.filter((c) => !c.exposed);
  assert.ok(interior.length > 0, 'pełny sześcian powinien mieć nieodsłonięte wnętrze');
});

test('kolizja czołowa: kontakty, zachowanie pędu, odbicie', () => {
  freshSystem();
  const A = makeCubeBody({ position: { x: -3, y: 0, z: 0 }, velocity: { x: 4, y: 0, z: 0 }, name: 'A' });
  const B = makeCubeBody({ position: { x: 3, y: 0, z: 0 }, velocity: { x: -4, y: 0, z: 0 }, name: 'B' });
  const bodies = [A, B];
  const dt = 1 / 120;
  const momentum0 = A.mass * A.vel.x + B.mass * B.vel.x;

  let sawContacts = false;
  for (let i = 0; i < 600; i++) {
    Destructor3D.integrate(dt, bodies);
    Destructor3D.update(dt, bodies);
    if (Destructor3D.perf.lastContacts > 0) sawContacts = true;
  }

  assert.ok(sawContacts, 'brak kontaktów w kolizji czołowej');
  assert.ok(A.vel.x < 4, 'A nie zwolnił po zderzeniu');
  assert.ok(B.vel.x > -4, 'B nie zwolnił po zderzeniu');
  const momentum1 = A.mass * A.vel.x + B.mass * B.vel.x;
  // damping liniowy jest wyłączalny tylko konfigiem — dopuszczamy niewielki dryf
  assert.ok(Math.abs(momentum1 - momentum0) < Math.abs(momentum0) * 0.5 + 60,
    `pęd rozjechany: ${momentum0} -> ${momentum1}`);
  // ciała nie mogą się przeniknąć na wylot
  assert.ok(A.pos.x < B.pos.x, 'ciała zamieniły się miejscami (tunelowanie)');
});

test('taran z przewagą masy (overrun): deformacja i zniszczenia komórek', () => {
  const cfg = freshSystem();
  const speed = cfg.crashApproachSpeedThreshold * 1.8;
  // przewaga masy ~11× → tryb overrun/hardWall z capami rosnącymi log2 — jak w 2D
  const A = makeCubeBody({ size: 4.5, position: { x: -6, y: 0, z: 0 }, velocity: { x: speed, y: 0, z: 0 }, name: 'A', noSplit: true });
  const B = makeCubeBody({ size: 2, position: { x: 2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, name: 'B', noSplit: true });
  const bodies = [A, B];
  const initialCells = totalActive(bodies);
  let debris = 0;
  Destructor3D.onDebris = () => { debris++; };

  const dt = 1 / 120;
  let peakDef = 0;
  for (let i = 0; i < 900; i++) {
    Destructor3D.integrate(dt, bodies);
    Destructor3D.update(dt, bodies);
    Destructor3D.updateVisuals(dt, bodies);
    peakDef = Math.max(peakDef, maxDeformation(A), maxDeformation(B));
  }

  assert.ok(peakDef > cfg.cellSize * 0.05, `brak deformacji (peak=${peakDef})`);
  const destroyed = initialCells - totalActive(bodies);
  assert.ok(destroyed > 0, 'crash nie zniszczył żadnej komórki');
  assert.equal(debris, destroyed, 'hook debris nie zgadza się z licznikiem zniszczeń');
  Destructor3D.onDebris = null;
});

test('rozerwanie w pół: findIslands + processSplits tworzą wrak', () => {
  freshSystem();
  const body = makeBarBody({ position: { x: 10, y: 5, z: -3 } });
  const bodies = [body];
  const before = body.grid.activeCount;
  const massBefore = body.mass;

  // wytnij środkowy plaster wzdłuż długiej osi (lokalne |x| < 0.4)
  let removed = 0;
  let removedMass = 0;
  for (const cell of body.grid.cells) {
    if (cell.active && Math.abs(cell.gx) < 0.4) {
      removedMass += cell.mass;
      Destructor3D.destroyCell(body, cell);
      removed++;
    }
  }
  assert.ok(removed > 0, 'nie usunięto plastra');

  const groups = Destructor3D.findIslands(body.grid);
  assert.equal(groups.length, 2, `oczekiwano 2 wysp, jest ${groups.length}`);

  Destructor3D.splitQueue.push(body);
  Destructor3D.processSplits(bodies);

  assert.equal(bodies.length, 2, 'nie powstał wrak');
  const wreck = bodies.find((b) => b !== body);
  assert.ok(wreck.isWreck, 'nowe ciało nie jest wrakiem');
  assert.ok(wreck.mass > 0 && body.mass > 0);
  assert.ok(Math.abs((wreck.mass + body.mass) - (massBefore - removedMass)) < 1e-6,
    'masa po rozpadzie nie sumuje się');
  assert.equal(totalActive(bodies), before - removed, 'zgubione komórki po splicie');

  // oba fragmenty mają poprawne, skończone tensory i nowe środki mas
  for (const b of bodies) {
    for (const v of b.invInertiaLocal) assert.ok(Number.isFinite(v));
    let mx = 0, m = 0;
    for (const c of b.grid.cells) { mx += c.gx * c.mass; m += c.mass; }
    assert.ok(Math.abs(mx / m) < 1e-6, `fragment nie recentrowany: ${mx / m}`);
  }
  // wrak odsunięty od rodzica wzdłuż długiej osi
  assert.ok(Math.abs(wreck.pos.x - body.pos.x) > 0.5, 'wrak nie odsunięty od rodzica');
});

test('nbrBase: powierzchnia to nie rana, martwy sąsiad to rana', () => {
  freshSystem();
  const body = makeCubeBody({});
  const cells = body.grid.cells;

  const aliveNeighbors = (cell) => cell.neighbors.reduce((n, x) => n + (x.active ? 1 : 0), 0);
  // Nietknięta bryła: żadna komórka nie jest raną (skóra ją zakrywa).
  for (const cell of cells) {
    assert.equal(aliveNeighbors(cell), cell.nbrBase, 'nietknięta komórka wygląda jak rana');
  }
  // Komórki powierzchni mają mniej niż 6 sąsiadów — to właśnie te, które stara
  // reguła „odsłonięta" renderowałaby mimo nienaruszonego poszycia.
  assert.ok(cells.some((c) => c.nbrBase < 6), 'brak komórek powierzchni');

  const victim = cells.find((c) => c.nbrBase === 6);
  assert.ok(victim, 'brak komórki wnętrza do zniszczenia');
  Destructor3D.destroyCell(body, victim);
  for (const n of victim.neighbors) {
    assert.ok(aliveNeighbors(n) < n.nbrBase, 'sąsiad zniszczonej komórki nie zgłasza rany');
  }
});

test('skóra przeżywa rozłam: wrak dziedziczy dane i pierwotny układ kratownicy', () => {
  freshSystem();
  const body = makeBarBody({ position: { x: 4, y: 0, z: 0 } });
  // Atrapa danych skóry — testujemy propagację, nie rendering.
  body.skin = { parts: [], occupancy: new Uint8Array(8), dims: { x: 2, y: 2, z: 2 }, triangleCount: 12 };
  const originalSkinMin = { ...body.grid.skinLatticeMin };

  for (const cell of body.grid.cells) {
    if (cell.active && Math.abs(cell.gx) < 0.4) Destructor3D.destroyCell(body, cell);
  }
  const bodies = [body];
  Destructor3D.splitQueue.push(body);
  Destructor3D.processSplits(bodies);
  assert.equal(bodies.length, 2, 'nie powstał wrak');

  const wreck = bodies.find((b) => b !== body);
  assert.equal(wreck.skin, body.skin, 'wrak nie dziedziczy skóry rodzica');
  // Mapowanie wierzchołek → komórka musi przetrwać recentrowanie fragmentów,
  // inaczej skóra rozjeżdża się z kratownicą po każdym rozłamie.
  for (const b of bodies) {
    assert.deepEqual(b.grid.skinLatticeMin, originalSkinMin, 'pierwotny układ kratownicy został przesunięty');
    assert.notDeepEqual(b.grid.latticeMin, b.grid.skinLatticeMin, 'latticeMin nie przesunął się do środka masy');
  }
  // Komórki po rozłamie zachowują indeksy kratownicy — na nich opiera się maska.
  for (const cell of wreck.grid.cells) {
    assert.ok(Number.isInteger(cell.ix) && cell.ix >= 0, 'wrak zgubił indeksy kratownicy');
  }
});

test('applyImpact: trafienie deformuje i uszkadza komórki', () => {
  const cfg = freshSystem();
  const body = makeCubeBody({ position: { x: 2, y: 1, z: 0 } });
  const hpBefore = body.grid.cells.reduce((s, c) => s + c.hp, 0);

  // raycast z zewnątrz w stronę ciała
  const hit = Destructor3D.raycastBody(body, 20, 1, 0, -1, 0, 0, 100);
  assert.ok(hit, 'raycast nie trafił w ciało');
  assert.ok(hit.x > body.pos.x, 'trafienie powinno być po stronie +X');

  const ok = Destructor3D.applyImpact(body, hit.x, hit.y, hit.z, 300, { x: -cfg.cellSize * 30, y: 0, z: 0 });
  assert.ok(ok, 'applyImpact nie trafił');

  const hpAfter = body.grid.cells.reduce((s, c) => s + c.hp, 0);
  assert.ok(hpAfter < hpBefore, 'obrażenia nie zostały zadane');
  assert.ok(maxDeformation(body) > 0, 'brak deformacji po trafieniu');
});

test('updateVisuals: deformacja wizualna dogania target i siatka zasypia', () => {
  freshSystem();
  const body = makeCubeBody({});
  const cell = body.grid.cells.find((c) => c.exposed || true);
  cell.tx = 0.5;

  const bodies = [body];
  for (let i = 0; i < 200; i++) Destructor3D.updateVisuals(1 / 60, bodies);

  assert.ok(Math.abs(cell.dx - cell.tx) < 0.05, `lerp nie dogonił targetu: d=${cell.dx} t=${cell.tx}`);
  // po ustaniu aktywności siatka powinna zasnąć
  for (let i = 0; i < 400; i++) Destructor3D.updateVisuals(1 / 60, bodies);
  assert.ok(body.grid.isSleeping, 'siatka nie zasnęła po wygaśnięciu deformacji');
});

test('repair: przywraca strukturę po uszkodzeniach', () => {
  freshSystem();
  const body = makeCubeBody({});
  const cell = body.grid.cells[0];
  cell.tx = 1.2; cell.dx = 1.2; cell.gx += 0.8; cell.bkx = 0.8; cell.hp = 10;

  for (let i = 0; i < 80; i++) Destructor3D.repair([body], 0.1);

  assert.ok(Math.abs(cell.tx) < 0.02, `target nie wrócił: ${cell.tx}`);
  assert.ok(Math.abs(cell.gx - cell.ox) < 0.02, `baza nie wróciła: ${cell.gx - cell.ox}`);
  assert.ok(cell.hp >= cell.maxHp * 0.98, `hp nie odbudowane: ${cell.hp}/${cell.maxHp}`);
});
