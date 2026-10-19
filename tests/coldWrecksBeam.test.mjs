import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Zimne wraki na belkach (etap 3 portu silnika belek): migawka ciała względem szablonu kadłuba
// (src/game/hullColdSnapshot.js), zamrożenie / odmrożenie w src/game/coldWrecks.js, ciało do rysowania
// w kadrze, limity i wpięcie w index.html. Prawdziwy silnik belek i HullBodies; atrapą jest tylko obraz
// (płyta RGBA) i to, czego system pyta grę (odwołania, kadr, obudzone ciała).

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { createColdWreckSystem, COLD_WRECK_CONFIG, THAW_RESULT, isBeamColdWreck } = await import('../src/game/coldWrecks.js');
const { beamColdSnapshotBytes, COLD_BEAM_KIND } = await import('../src/game/hullColdSnapshot.js');
const { rebuildWreckIndex, getWreckIndex } = await import('../src/ai/aiWreckIndex.js');
const { createRadarFeed } = await import('../src/ui/radar/radarFeed.js');
const { RADAR_TUNE } = await import('../src/ui/radar/radarConfig.js');
const { buildWreckFields, WRECK_FIELD_CONFIG } = await import('../src/game/wreckFields.js');
const { readIndexHtml, sliceFunction } = await import('./helpers/indexSource.mjs');
const { buildHullSkinTopology, writeHullSkin } = await import('../src/3d/beamHullSkin.js');
const D = HullBodies.engine;

// Płyta w × h px z wycięciem prawej górnej ćwiartki (kadłub nie jest prostokątem).
function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > w * 0.6 && y < h * 0.35) continue;
      const o = (y * w + x) * 4;
      data[o] = 120 + (x % 7) * 9; data[o + 1] = 140 + (y % 5) * 7; data[o + 2] = 160; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const IMAGE = plate(600, 240);

function ship(x = 0, y = 0, extra = {}) {
  const e = { x, y, vx: 0, vy: 0, angle: 0.35, angVel: 0, mass: 5000, name: 'próba', ...extra };
  HullBodies.createHull(e, IMAGE);
  return e;
}

function stepAll(list, n = 30, dt = 1 / 60) {
  for (let k = 0; k < n; k++) HullBodies.step(dt, list);
}

// Wrak z ranami: kratery (martwe węzły, wgniecenia, plastyczne belki), pancerz „mostka” (maks. HP ×3 na kilku
// węzłach), łaty dronów, ciepło broni, węzeł o odwrotności masy spoza szablonu (jak po odroście z zagęszczonego
// magazynu), zmęczone belki. Kotwica wraku = środek masy (convertToWreck).
function damagedWreck(x = 0, y = 0) {
  window.wrecks.length = 0;
  const e = ship(x, y);
  HullBodies.impact(e, e.x + 110, e.y + 25, 2600, { x: -600, y: 0 });
  HullBodies.impact(e, e.x - 140, e.y - 15, 1900, { x: 0, y: 500 });
  stepAll([e], 40);
  const s = e.beamHull.body.nodeStore, b = e.beamHull.body.beamStore;
  let armored = 0, patched = 0, tuned = 0;
  for (let i = 0; i < s.count && armored < 6; i++) {
    if (!s.active[i]) continue;
    if (i % 17 === 0) { s.maxHp[i] *= 3; s.hp[i] *= 2.5; armored++; }
  }
  for (let i = 0; i < s.count && patched < 4; i++) if (s.active[i] && i % 23 === 5) { s.patch[i] = 1; patched++; }
  for (let i = 0; i < s.count && tuned < 2; i++) if (s.active[i] && i % 31 === 7) { s.invMass[i] = 1 / s.mass[i]; s.temp[i] = 1.25; tuned++; }
  for (let k = 0; k < b.count; k += 41) b.fatigue[k] = 0.3;
  const wreck = HullBodies.convertToWreck(e);
  e.dead = true;
  assert.ok(wreck && wreck.beamHull, 'wrak z kadłuba');
  stepAll(window.wrecks.slice(), 20);
  return wreck;
}

// Stan ciała po komórkach (ix, iy): pozycja, HP, maks. HP, próg oparcia, łata, ciepło, masa; belki po parze komórek.
function describe(entity) {
  const body = entity.beamHull.body, s = body.nodeStore, e = body.beamStore;
  const nodes = new Map();
  const key = (i) => `${s.ix[i]},${s.iy[i]},${s.iz[i]}`;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    nodes.set(key(i), { x: s.x[i], y: s.y[i], z: s.z[i], hp: s.hp[i], maxHp: s.maxHp[i], support: s.beamCount[i],
      patch: s.patch[i], temp: s.temp[i], mass: s.mass[i], invMass: s.invMass[i], ox: s.ox[i], oy: s.oy[i] });
  }
  const beams = new Map();
  for (let q = 0; q < e.count; q++) {
    if (!s.active[e.a[q]] || !s.active[e.b[q]]) continue;
    beams.set(`${key(e.a[q])}|${key(e.b[q])}|${e.type[q]}`, { rest: e.rest[q], broken: e.broken[q], fatigue: e.fatigue[q] });
  }
  return { nodes, beams, mass: body.mass, inv: Array.from(body.invInertiaLocal), radius: body.radius,
    live: body.liveBeams, active: body.activeNodes, lm: { ...body.latticeMin }, armor: body.collisionArmor };
}

// Skóra kadłuba (beamHullSkin.js — to, co rysuje hexShips3D): narożniki czworokątów, jasność blachy i rozdarcie
// brzegu dziury po komórkach żywych węzłów. Żar pomijamy (migawka go nie niesie — po ~20 s snu zgasł).
function skinOf(entity) {
  const body = entity.beamHull.body;
  const topo = buildHullSkinTopology(body);
  const n = topo.count * 4;
  const pos = new Float32Array(n * 3), shade = new Float32Array(n), heat = new Float32Array(n * 2), tear = new Float32Array(n);
  writeHullSkin(body, topo, pos, shade, heat, tear);
  const s = body.nodeStore, out = new Map();
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    out.set(`${s.ix[i]},${s.iy[i]}`, { p: Array.from(pos.subarray(i * 12, i * 12 + 12)),
      sh: Array.from(shade.subarray(i * 4, i * 4 + 4)), t: Array.from(tear.subarray(i * 4, i * 4 + 4)) });
  }
  return out;
}

function assertSameSkin(before, after, label) {
  assert.equal(after.size, before.size, `${label}: czworokąty`);
  let torn = 0;
  for (const [k, a] of before) {
    const b = after.get(k);
    assert.ok(b, `${label}: czworokąt ${k}`);
    for (let q = 0; q < 12; q++) assert.ok(Math.abs(a.p[q] - b.p[q]) < 1e-3, `${label}: narożnik ${k}`);
    for (let q = 0; q < 4; q++) assert.ok(Math.abs(a.sh[q] - b.sh[q]) < 1e-4, `${label}: jasność blachy ${k}`);
    assert.deepEqual(b.t, a.t, `${label}: rozdarcie brzegu ${k}`);
    for (let q = 0; q < 4; q++) if (a.t[q] > 0) torn++;
  }
  return torn;
}

function assertSameBody(before, after, label) {
  assert.equal(after.active, before.active, `${label}: żywe węzły`);
  assert.equal(after.nodes.size, before.nodes.size, `${label}: komórki`);
  for (const [k, a] of before.nodes) {
    const b = after.nodes.get(k);
    assert.ok(b, `${label}: komórka ${k}`);
    assert.ok(Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4, `${label}: pozycja ${k}`);
    assert.equal(b.hp, a.hp, `${label}: HP ${k}`);
    assert.equal(b.maxHp, a.maxHp, `${label}: maks. HP ${k}`);
    assert.equal(b.support, a.support, `${label}: próg oparcia ${k}`);
    assert.equal(b.patch, a.patch, `${label}: łata ${k}`);
    assert.ok(Math.abs(b.temp - a.temp) < 1e-6, `${label}: ciepło ${k}`);
    assert.equal(b.mass, a.mass, `${label}: masa ${k}`);
    assert.equal(b.invMass, a.invMass, `${label}: odwrotność masy ${k}`);
  }
  assert.equal(after.beams.size, before.beams.size, `${label}: belki`);
  for (const [k, a] of before.beams) {
    const b = after.beams.get(k);
    assert.ok(b, `${label}: belka ${k}`);
    assert.ok(Math.abs(a.rest - b.rest) < 1e-5, `${label}: długość plastyczna ${k}`);
    assert.equal(b.broken, a.broken, `${label}: zerwanie ${k}`);
    assert.ok(Math.abs(a.fatigue - b.fatigue) < 1e-6, `${label}: zmęczenie ${k}`);
  }
  assert.equal(after.live, before.live, `${label}: żywe belki`);
  assert.equal(after.mass, before.mass, `${label}: masa ciała`);
  assert.deepEqual(after.inv, before.inv, `${label}: tensor`);
  assert.deepEqual(after.lm, before.lm, `${label}: latticeMin`);
  assert.equal(after.armor, before.armor, `${label}: pancerz zderzeń`);
  assert.ok(Math.abs(after.radius - before.radius) < 1e-4, `${label}: promień`);
}

test('migawka → zwolnienie → odtworzenie: węzły, belki, masy i rekord kadłuba bez zmian (wrak z ran, odłamy z rozpadu)', () => {
  const whole = damagedWreck(2e6, 3e6);
  // Wrak z całego kadłuba (magazyn w układzie konstrukcji, z martwymi węzłami) i odłamy z rozpadu (zagęszczone
  // magazyny w kolejności wyspy, nie szablonu).
  const list = [whole];
  window.wrecks.length = 0;
  const e = ship(-2e6, 3e6);
  HullBodies.impact(e, e.x + 60, e.y, 1500, { x: -600, y: 0 });
  // Rozpad z ziarnem (shatter losuje kąty rzazów z Math.random).
  const random = Math.random;
  let seed = 7;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let shattered;
  try {
    shattered = HullBodies.shatter(e, e.x, e.y, 0.6, { cuts: 4, cutWidth: 1.5, debrisFrac: 0.04 });
  } finally {
    Math.random = random;
  }
  e.dead = true;
  stepAll(window.wrecks.slice(), 10);
  for (const w of window.wrecks) if (HullBodies.hasHull(w)) list.push(w);
  assert.ok(shattered.fragments >= 2 && list.length >= 3, `odłamy po rozpadzie: ${list.length - 1}`);
  let tornCorners = 0;
  for (const w of list) {
    const hull = w.beamHull;
    // Promień ciała silnik odświeża przy przebudowie — odtworzone ciało liczy go dokładnie z żywych węzłów.
    D._updateRadius(hull.body);
    const before = describe(w);
    const skinBefore = skinOf(w);
    const pivot = { ...hull.pivot };
    const dmgKey = hull.dmgKey;
    const pose = { x: w.x, y: w.y, angle: w.angle };
    const snap = HullBodies.captureColdSnapshot(w);
    assert.ok(snap, 'wrak leży na szablonie kadłuba');
    assert.equal(snap.kind, COLD_BEAM_KIND);
    assert.equal(snap.hull, hull, 'migawka trzyma rekord kadłuba');
    assert.equal(snap.liveNodes, before.active, 'żywe węzły');
    assert.ok(snap.nodeCount >= snap.liveNodes, 'migawka = żywe + martwi sąsiedzi (brzeg rozdarcia)');
    assert.ok(snap.invMass === null || snap.invMass.length === snap.nodeCount);
    const bytes = beamColdSnapshotBytes(snap);
    assert.ok(bytes / snap.nodeCount < 120, `migawka ${Math.round(bytes / snap.nodeCount)} B na węzeł`);

    assert.equal(HullBodies.releaseColdBody(w), true);
    assert.equal(w.beamHull, null, 'zimny bez ciała');
    assert.equal(hull.body, null);
    assert.equal(HullBodies.hasHull(w), false);

    const restored = HullBodies.restoreColdBody(w, snap);
    assert.equal(restored, hull, 'ten sam rekord kadłuba');
    assert.equal(w.beamHull, hull);
    assert.equal(hull.entity, w);
    assert.equal(hull.dmgKey, dmgKey, 'ród mapy ran');
    assert.deepEqual({ ...hull.pivot }, pivot, 'pivot (środek masy w pikselach sprite\'a)');
    assert.deepEqual({ x: w.x, y: w.y, angle: w.angle }, pose, 'poza encji');
    assert.equal(hull.body.isSleeping, true, 'odtworzone ciało stoi i śpi');
    assert.equal(hull.body.isWreck, true);
    assertSameBody(before, describe(w), 'odtworzenie');
    tornCorners += assertSameSkin(skinBefore, skinOf(w), 'skóra po odtworzeniu');
    // Drugi raz z tej samej migawki — ten sam stan (migawka nie zależy od ciała, które zwolniliśmy).
    HullBodies.releaseColdBody(w);
    HullBodies.restoreColdBody(w, snap);
    assertSameBody(before, describe(w), 'ponowne odtworzenie');
    // Ciało działa: zapytania i krok silnika.
    assert.ok(HullBodies.structuralState(w).ratio > 0);
    stepAll([w], 5);
  }
  assert.ok(tornCorners > 20, `rozdarte brzegi dziur w skórze (wrak z całego kadłuba): ${tornCorners}`);
});

test('ciało odtworzone ma układ pól wraku z rozpadu (jedna klasa ukryta V8)', () => {
  const wreck = damagedWreck(0, 0);
  const literal = Object.keys(wreck.beamHull.body);
  const snap = HullBodies.captureColdSnapshot(wreck);
  HullBodies.releaseColdBody(wreck);
  HullBodies.restoreColdBody(wreck, snap);
  const restored = Object.keys(wreck.beamHull.body);
  // Ciało wraku z kadłuba (createBody) i z rozpadu (_spawnWreck) zaczynają się tym samym literałem.
  const n = literal.indexOf('_maxDisp') + 1;
  assert.ok(n > 40);
  assert.deepEqual(restored.slice(0, n), literal.slice(0, n));
});

test('wrak spoza szablonu (zmieniona belka) nie ma migawki i nie marznie', () => {
  const wreck = damagedWreck(0, 0);
  const e = wreck.beamHull.body.beamStore;
  e.brk[3] *= 0.5;
  assert.equal(HullBodies.captureColdSnapshot(wreck), null);
  wreck._wreckSleeping = true;
  wreck._wreckSleptSec = 999;
  wreck._lastImpactMs = -1e12;
  wreck.beamHull.body.structureDirty = false;
  const wrecks = [wreck], cold = [];
  const system = createColdWreckSystem({ wrecks, coldWrecks: cold });
  assert.equal(system.freeze(wreck), false);
  assert.equal(wreck._coldUnsupported, true);
  assert.equal(system.stats.unsupported, 1);
  assert.equal(system.isFreezeCandidate(wreck), false, 'nie próbujemy znowu');
  assert.ok(wrecks.includes(wreck) && HullBodies.hasHull(wreck));
});

// Wrak gotowy do zamrożenia: śpi od dawna, cisza po trafieniu (zegar HullBodies), bez czekającego rozpadu.
function sleepyWreck(x, y) {
  const w = damagedWreck(x, y);
  window.wrecks.length = 0;
  w.vx = 0; w.vy = 0; w.angVel = 0;
  w._wreckSleeping = true;
  w._wreckSleptSec = COLD_WRECK_CONFIG.afterSec + 1;
  w._lastImpactMs = (HullBodies.simTime - COLD_WRECK_CONFIG.afterSec - 5) * 1000;
  w.beamHull.body.structureDirty = false;
  D.splitQueue.length = 0;
  HullBodies.sleep(w);
  return w;
}

test('warunki: zegar trafień HullBodies, rozpad w kolejce, budowla, rdzeń w stopieniu blokują; reszta marznie', () => {
  const [ok, recent, dirty, queued, debris, melting] = [0, 1, 2, 3, 4, 5].map((k) => sleepyWreck(k * 5000, 0));
  recent._lastImpactMs = HullBodies.simTime * 1000;           // świeże trafienie (HullBodies.impact)
  // Sama flaga structureDirty bez kolejki (processSplits ją zeruje, a niszczenie okruchów ustawia z powrotem) — nie
  // blokuje: inaczej po bitwie prawie żaden wrak nie marzł.
  dirty.beamHull.body.structureDirty = true;
  D.splitQueue.push(queued.beamHull.body);
  debris.worldDebris = true;
  melting.reactorCores = [{ host: melting, state: 'meltdown' }];
  const wrecks = [ok, recent, dirty, queued, debris, melting];
  const system = createColdWreckSystem({ wrecks, coldWrecks: [] });   // domyślny zegar: po rodzaju wraku
  assert.equal(system.isFreezeCandidate(ok), true);
  assert.equal(system.isFreezeCandidate(dirty), true, 'structureDirty bez kolejki nie blokuje');
  for (const w of [recent, queued, debris, melting]) assert.equal(system.isFreezeCandidate(w), false);
  assert.deepEqual([ok, recent, dirty, queued, debris, melting].map((w) => system.explain(w)),
    [null, 'trafiony-niedawno', null, 'rozpad-w-kolejce', 'budowla', 'rdzen-stopienie']);
  D.splitQueue.length = 0;
  // Promień wraku na belkach jest już w świecie — nie mnożymy go skalą sprite'a (ruchome ciało tuż za strefą).
  const r = ok.radius;
  const body = { x: ok.x + COLD_WRECK_CONFIG.clearRadius + r + 50, y: ok.y, radius: 10, vx: 300, vy: 0 };
  const sys2 = createColdWreckSystem({ wrecks: [ok], coldWrecks: [], getAwakeBodies: () => [body] });
  assert.equal(sys2.isFreezeCandidate(ok), true, 'ruchome ciało za strefą nie blokuje');
  body.x -= 100;
  assert.equal(sys2.isFreezeCandidate(ok), false, 'ruchome ciało w strefie blokuje');
  assert.equal(sys2.explain(ok), 'ruch-w-poblizu');
  // Stojący okręt (flota w szyku po bitwie) blokuje tylko z bliska; gracz — w całej strefie.
  body.vx = 0;
  assert.equal(sys2.isFreezeCandidate(ok), true, 'stojący okręt w strefie nie blokuje');
  body.x = ok.x + r + 10 + COLD_WRECK_CONFIG.clearContactPad - 50;
  assert.equal(sys2.isFreezeCandidate(ok), false, 'stojący okręt tuż przy wraku blokuje');
  assert.equal(sys2.explain(ok), 'okret-tuz-obok');
  body.x = ok.x + COLD_WRECK_CONFIG.clearRadius + r - 50;
  body.isPlayer = true;
  assert.equal(sys2.isFreezeCandidate(ok), false, 'gracz w strefie blokuje, choćby stał');
  assert.equal(sys2.explain(ok), 'gracz-w-poblizu');
});

test('zamrożenie: poza listą, duch, migawka i smuga; ciało do rysowania wraca do migawki, gdy render o nie nie prosi', () => {
  const w = sleepyWreck(0, 0);
  const wrecks = [w], cold = [];
  let frame = 100, now = 5000;
  const frozen = [];
  const system = createColdWreckSystem({
    wrecks, coldWrecks: cold, getFrameId: () => frame, getTimeMs: () => now,
    onBeforeFreeze: (wreck, snap) => { frozen.push(wreck); snap.impostor = { x: 0, y: 0, wx: 0, wy: 0, reach: 10, halfW: 5, halfH: 5 }; }
  });
  const bodyBefore = w.beamHull.body;
  assert.equal(system.freeze(w), true);
  assert.deepEqual(frozen, [w]);
  assert.equal(wrecks.length, 0);
  assert.deepEqual(cold, [w]);
  assert.equal(w.isCold, true);
  assert.equal(w.isCollidable, false);
  assert.ok(isBeamColdWreck(w));
  assert.ok(w._coldSnapshot.summary && w._coldSnapshot.summary.liveHexes === w._coldSnapshot.liveNodes);
  assert.equal(system.stats.coldNodes, w._coldSnapshot.nodeCount);
  assert.equal(w.beamHull.body, bodyBefore, 'ciało zostaje do rysowania (bez przebudowy skóry)');
  assert.equal(system.renderBodyCount, 1);
  // Render prosi o ciało (wrak w kadrze): zostaje.
  for (let k = 0; k < 10; k++) {
    frame++;
    now += 500;
    assert.equal(system.ensureRenderBody(w), true);
    system.step(1 / 60);
  }
  assert.equal(w.beamHull?.body, bodyBefore, 'render prosi co klatkę — ciało zostaje (5 s)');
  // Render przestaje prosić: po renderIdleSec (czas rzeczywisty, nie klatki) ciało znika, migawka zostaje.
  for (let k = 0; k < 500; k++) { frame++; system.step(1 / 60); }
  assert.equal(w.beamHull?.body, bodyBefore, 'setki klatek w ułamku sekundy (500 fps) nie zwalniają ciała');
  now += COLD_WRECK_CONFIG.renderIdleSec * 1000 + 1;
  frame++;
  system.step(1 / 60);
  assert.equal(w.beamHull, null);
  assert.equal(bodyBefore.dead, true);
  assert.equal(system.stats.renderReleases, 1);
  assert.equal(system.renderBodyCount, 0);
  assert.ok(w._coldSnapshot, 'migawka');
});

test('ciała do rysowania w budżecie węzłów klatki; odmrożenie bierze ciało do rysowania albo odtwarza z migawki', () => {
  const a = sleepyWreck(0, 0);
  const b = sleepyWreck(20000, 0);
  const c = sleepyWreck(40000, 0);
  const wrecks = [a, b, c], cold = [];
  let frame = 1, now = 0;
  const system = createColdWreckSystem({
    wrecks, coldWrecks: cold, getFrameId: () => frame, getTimeMs: () => now,
    config: { renderRestoreNodesPerFrame: Math.ceil(a.beamHull.body.activeNodes * 1.5) }
  });
  for (const w of [a, b, c]) system.freeze(w);
  // Zamrożone poza kadrem (render po nie nie sięga): ciała wracają do migawek po renderClaimMs.
  now += COLD_WRECK_CONFIG.renderClaimMs + 1;
  frame++;
  system.step(1 / 60);
  assert.ok(!a.beamHull && !b.beamHull && !c.beamHull);
  frame++;
  assert.equal(system.ensureRenderBody(a), true, 'pierwszy w klatce');
  assert.equal(system.ensureRenderBody(b), false, 'budżet węzłów klatki — smuga, spróbuje w następnej');
  assert.equal(system.stats.renderDeferred, 1);
  frame++;
  assert.equal(system.ensureRenderBody(b), true);
  assert.equal(system.stats.renderRestores, 2);
  assert.equal(b.beamHull.body.isSleeping, true);
  // Odmrożenie: a z ciałem do rysowania (to samo ciało), c z migawki.
  const bodyA = a.beamHull.body;
  const ready = [];
  frame++;
  assert.equal(system.thaw(a, 'tow', (w) => ready.push(w)), THAW_RESULT.THAWED);
  assert.equal(a.beamHull.body, bodyA);
  assert.equal(system.thaw(c, 'salvage', (w) => ready.push(w)), THAW_RESULT.QUEUED);
  frame++;
  system.step(1 / 60);
  assert.deepEqual(ready, [a, c]);
  for (const w of [a, c]) {
    assert.equal(w.isCold, false);
    assert.equal(w.isCollidable, true);
    assert.equal(w._coldSnapshot, null);
    assert.equal(w._wreckSleeping, false);
    assert.ok(wrecks.includes(w) && HullBodies.hasHull(w));
    assert.equal(cold.includes(w), false);
  }
  assert.equal(system.stats.coldNodes, b._coldSnapshot.nodeCount, 'liczniki węzłów migawek');
  // b zostaje zimny; jego ciało do rysowania znika bez rysowania.
  now += COLD_WRECK_CONFIG.renderIdleSec * 1000 + 1;
  frame++;
  system.step(1 / 60);
  assert.equal(b.beamHull, null);
  assert.equal(system.renderBodyCount, 0);
});

test('limity: maxColdNodes wyrzuca najdalszego bez ładunku; recykling przez HullBodies (też bez ciała)', () => {
  const near = sleepyWreck(100, 0);
  const far = sleepyWreck(90000, 0);
  const cargo = sleepyWreck(200000, 0);
  cargo._cargoManifest = { ore_iron: 2 };
  const wrecks = [near, far, cargo], cold = [];
  const evicted = [];
  let now = 0;
  const system = createColdWreckSystem({
    wrecks, coldWrecks: cold, getPlayerPos: () => ({ x: 0, y: 0 }), onEvicted: (w) => evicted.push(w), getTimeMs: () => now
  });
  for (const w of [near, far, cargo]) system.freeze(w);
  now += COLD_WRECK_CONFIG.renderClaimMs + 1;
  system.step(1 / 60);
  assert.equal(far.beamHull, null, 'bez ciała — sama migawka');
  system.config.maxColdNodes = system.stats.coldNodes - 1;
  system.enforceColdLimit();
  assert.deepEqual(evicted, [far], 'najdalszy bez ładunku');
  assert.equal(far.dead, true);
  assert.equal(far.isCold, false);
  assert.equal(far._coldSnapshot, null);
  assert.equal(far._salvage, null, 'łup czyszczony dopiero przy recyklingu');
  assert.ok(cold.includes(cargo) && cold.includes(near));
  assert.equal(system.stats.coldNodes, near._coldSnapshot.nodeCount + cargo._coldSnapshot.nodeCount);
});

test('pola wraków (CIC): promień zimnego wraku na belkach bez skali sprite’a (już w świecie)', () => {
  const beam = (x) => ({ x, y: 0, radius: 400, visual: { spriteScale: 3 }, isWreck: true, isCold: true,
    _coldSnapshot: { kind: COLD_BEAM_KIND, summary: null } });
  const a = beam(0), b = beam(2000);
  const fields = buildWreckFields([a, b]);
  assert.equal(fields.length, 1);
  assert.ok(Math.abs(fields[0].radius - Math.max(WRECK_FIELD_CONFIG.minRadius, 1000 + 400)) < 1, `promień pola ${fields[0].radius}`);
});

test('indeks przeszkód AI: zimny wrak (bez kolizji) zostaje przeszkodą lotu; radar widzi zimne wraki', () => {
  const hot = { x: 0, y: 0, radius: 300, angle: 0, isWreck: true };
  const cold = { x: 5000, y: 0, radius: 300, angle: 0, isWreck: true, isCold: true, isCollidable: false };
  const ghost = { x: 9000, y: 0, radius: 300, angle: 0, isWreck: true, isCollidable: false };
  rebuildWreckIndex([hot, ghost], [cold]);
  const idx = getWreckIndex();
  assert.deepEqual(idx.refs.slice(0, idx.count), [hot, cold], 'zimny tak, duch odłamu budowli nie');

  const fb = createRadarFeed({ ...RADAR_TUNE });
  const feed = fb.collect({
    ship: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 }, range: 20000,
    npcs: [], stations: [], wrecks: [hot], coldWrecks: [cold],
    hides: () => false, cloaked: () => false, isHostile: () => false
  });
  const keys = feed.targets.slice(0, feed.count).map((r) => r.key);
  assert.ok(keys.includes(hot) && keys.includes(cold));
  assert.equal(feed.targets.slice(0, feed.count).find((r) => r.key === cold).kind, 'wreck');
});

test('index.html: wpięcie zimnych wraków na belkach', () => {
  const src = readIndexHtml();
  const options = src.slice(src.indexOf('const coldWreckSystem = createColdWreckSystem({'), src.indexOf('function thawWreck(wreck, reason'));
  assert.match(options, /recycle: recycleWreckEntity,/, 'recykling po rodzaju wraku');
  // RW-31: bramka z widoku klatki gry (src/game/coldWreckView.js).
  assert.match(options, /coldFreezeVisuallySafe\(w, _drawView, coldWreckSystem\.config\)/);
  assert.match(options, /captureBeamColdImpostor\(w, w\._coldSnapshot, coldWreckSystem\.config\)/);
  assert.doesNotMatch(options, /HullDamageEvents\.invalidate\(w\)|captureColdWreckImpostor/,
    'wrak na belkach zostaje z siatką skóry (render przejmuje ją bez przebudowy); smuga tylko z migawki gry');
  assert.doesNotMatch(options, /getSimTimeMs/, 'zegar „ciszy po trafieniu” po rodzaju wraku (HullBodies.simTime)');
  assert.match(src, /drawn: \(w\) => w\._coldDrawFrame === renderFrameId,\s*config: coldWreckSystem\.config,/);
  assert.match(src, /const _coldEnsureBody = \(w\) => coldWreckSystem\.ensureRenderBody\(w\);/);
  assert.match(src, /listedForExtras: \(w\) => w\._coldExtrasFrame === renderFrameId/);
  const render = sliceFunction(src, 'function withColdNearWrecks(seen)');
  assert.match(render, /coldWreckSystem\.renderList/);
  assert.match(src, /const renderSeenCold = withColdNearWrecks\(renderSeen\);/);
  assert.match(src, /Bridge3D\.update\(renderSeenCold,/);
  assert.match(src, /BridgeFx3D\.update\(renderSeenCold,/);
  assert.match(src, /syncShipModels3D\(\{ entities: renderSeenCold,/);
  assert.match(src, /_reactorCoreLists\[3\] = _coldNearList\.length > 0 \? _coldNearList : null;/);
  assert.match(src, /updateShields3D\(PAUSED \? 0 : frameDt, renderSeen,/, 'tarcze bez zimnych');
  assert.match(src, /window\.rebuildWreckIndex\(wrecks, coldWrecks\);/);
  assert.match(sliceFunction(src, 'function refreshRadarFeed(range)'), /env\.coldWrecks = coldWrecks;/);
  const hex = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
  assert.match(hex, /updateColdBeamWrecks\(coldWrecks, cullInfo, camX, camY, cameraZoom, frameId, valid, validSet\)/);
  assert.ok(hex.indexOf('updateColdBeamWrecks(coldWrecks') < hex.indexOf('HullLightStore.commit();'), 'zimne przed zapisem slotów lamp');
});

test('mostek 3D: rekord przeszły na wrak czeka, gdy zimny oddaje ciało, i rysuje się po odtworzeniu z migawki', async () => {
  const THREE = await import('three');
  const { Bridge3D } = await import('../src/3d/bridge3D.js');
  const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
  const RT = await import('../src/game/shipBridgeRuntime.js');
  window.wrecks.length = 0;
  D.splitQueue.length = 0;
  const e = makeBridgeShip(HullBodies, 'battleship', 0, 0, 0.3);
  RT.attachEntityBridges(e);
  assert.ok(Bridge3D.attach(new THREE.Scene()));
  const drawn = () => Bridge3D.kinds.reduce((s, K) => s + K.count, 0);
  const opts = { nowSec: 1, dt: 0, zoom: 0.4 };
  try {
    Bridge3D.update([e], opts);
    assert.ok((e.__bridge3D || []).length > 0 && drawn() > 0, 'okręt ma model mostka');
    const recs = e.__bridge3D.slice();
    // Śmierć: kadłub przechodzi na wrak (to samo ciało), rekord idzie za nim — wrak nie ma własnego stanu mostków.
    const w = HullBodies.convertToWreck(e);
    e.dead = true;
    Bridge3D.update([w], opts);
    assert.ok(recs.every((r) => r.host === w) && !w.bridgeState, 'rekord na wraku');
    assert.ok(drawn() > 0);
    w.vx = w.vy = 0; w.angVel = 0;
    w._wreckSleeping = true;
    w._wreckSleptSec = COLD_WRECK_CONFIG.afterSec + 1;
    w._lastImpactMs = -1e9;
    D.splitQueue.length = 0;
    HullBodies.sleep(w);
    const wrecks = [w], cold = [];
    let now = 1000;
    const system = createColdWreckSystem({ wrecks, coldWrecks: cold, getTimeMs: () => now });
    assert.equal(system.freeze(w), true);
    Bridge3D.update([w], opts);
    assert.ok(drawn() > 0, 'zimny z ciałem do rysowania — model jak u śpiącego');
    // Render nie prosi o ciało: wraca do migawki, wrak znika z listy mostków (withColdNearWrecks).
    now += COLD_WRECK_CONFIG.renderIdleSec * 1000 + 1;
    system.step(1 / 60);
    assert.equal(w.beamHull, null);
    for (let k = 0; k < 5; k++) Bridge3D.update([], opts);
    assert.ok(recs.every((r) => !r.dead && Bridge3D.records.includes(r) && w.__bridge3D.includes(r)),
      'rekord czeka na zimnego gospodarza (wrak nie przyjąłby go ponownie)');
    // Kadr wraca: ciało z migawki, ten sam rekord rysuje model.
    assert.equal(system.ensureRenderBody(w), true);
    Bridge3D.update([w], opts);
    assert.ok(recs.every((r) => !r.dead && r.host === w) && drawn() > 0, 'model po odtworzeniu z migawki');
    // Odmrożenie — dalej ten sam rekord.
    assert.equal(system.thaw(w, 'test'), THAW_RESULT.THAWED);
    Bridge3D.update([w], opts);
    assert.ok(drawn() > 0, 'model po odmrożeniu');
    // Wrak usunięty (recykling) — rekord odchodzi.
    system.freeze(w);
    HullBodies.recycleWreck(w);
    Bridge3D.update([], opts);
    assert.ok(recs.every((r) => r.dead), 'usunięty wrak oddaje rekord');
  } finally {
    Bridge3D.dispose();
    window.wrecks.length = 0;
  }
});
