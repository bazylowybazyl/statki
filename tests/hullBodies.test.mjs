import test from 'node:test';
import assert from 'node:assert/strict';

// Kadłuby gry na silniku belek (src/game/hullBodies.js): układy (odbicie y, kotwica
// środka sprite'a), zapytania pocisków, krater, taran, wraki, łup, okruchy.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, HULL_BODY_CONFIG, HEX_PITCH_PX } = await import('../src/game/hullBodies.js');
const { CollisionFX } = await import('../src/vfx/collisionFx.js');
const D = HullBodies.engine;

// Płyta w × h px (komórka HULL_BODY_CONFIG.cellPx jak w grze); `notch` wycina prawą górną ćwiartkę OBRAZU.
function plate(w, h, notch = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (notch && x > w / 2 && y < h / 2) continue;
      const o = (y * w + x) * 4;
      data[o] = 140; data[o + 1] = 150; data[o + 2] = 160; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const NOTCHED = plate(400, 200, true);
const SMALL = plate(160, 80);
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, ...extra });

test('kotwica = środek sprite\'a, oś y gry w dół (wycięcie obrazu w prawej górze ekranu)', () => {
  const e = npcAt(1e6, 2e6);
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    const cells = 400 * 200 * 0.75 / HULL_BODY_CONFIG.cellPx ** 2;
    assert.ok(hull && hull.body.activeNodes > 0.8 * cells, `kadłub z płyty: ${hull?.body.activeNodes} z ~${Math.round(cells)}`);
    assert.equal(e.beamHull, hull);
    assert.ok(Math.abs(e.radius - Math.hypot(200, 100)) < 12, `promień od środka sprite'a: ${e.radius}`);
    assert.equal(HullBodies.probe(e, e.x + 100, e.y - 50), false, 'wycięcie (x+, y− = góra obrazu)');
    assert.equal(HullBodies.probe(e, e.x + 100, e.y + 50), true);
    assert.equal(HullBodies.probe(e, e.x - 100, e.y - 50), true);
    // Obrót gry o +90° (y w dół: dziób +x → +y): piksel obrazu (x+100, y−50) → świat (x+50, y+100).
    e.angle = Math.PI / 2;
    assert.equal(HullBodies.probe(e, e.x + 50, e.y + 100), false);
    assert.equal(HullBodies.probe(e, e.x - 50, e.y + 100), true);
  } finally { HullBodies.release(e); }
});

test('sweep pocisku: punkt wejścia na brzegu kadłuba, dziura w obrazie = pudło, skrócony odcinek zgodny', () => {
  const e = npcAt(0, 0, { angle: 0.3 });
  HullBodies.createHull(e, NOTCHED);
  try {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    const from = { x: c * 1000 + (-s) * 50, y: s * 1000 + c * 50 };
    const to = { x: (-s) * 50, y: c * 50 };
    const full = HullBodies.sweep(e, from.x, from.y, to.x, to.y, 0);
    assert.ok(full, 'trafienie od dziobu');
    const along = (full.worldX - e.x) * c + (full.worldY - e.y) * s;
    assert.ok(Math.abs(along - 200) < 8, `wejście przy dziobie (200): ${along}`);
    const fullT = full.t;
    const part = HullBodies.sweep(e, from.x, from.y, from.x + (to.x - from.x) * 0.9, from.y + (to.y - from.y) * 0.9, 0);
    assert.ok(part && Math.abs(part.t * 0.9 - fullT) < 1e-9, 'ten sam węzeł na skróconym odcinku');
    // Przez wycięcie (góra obrazu = −y lokalnie): nic.
    const miss = HullBodies.sweep(e, c * 1000 - (-s) * 50, s * 1000 - c * 50, c * 150 - (-s) * 50, s * 150 - c * 50, 0);
    assert.ok(miss === null, 'pocisk przez wycięcie pudłuje');
  } finally { HullBodies.release(e); }
});

test('krater: budżet HP ∝ obrażeniom, od najbliższego węzła; lekki pocisk tylko drapie', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    // Węzeł = (bok / odstęp heksa)² heksów po 80 HP: ten sam pancerz na powierzchnię co heksy.
    const pitch = 400 / Math.round(400 / HULL_BODY_CONFIG.cellPx);
    assert.ok(Math.abs(hull.hexPerNode - (pitch / HEX_PITCH_PX) ** 2) < 1e-9, `heksy na węzeł: ${hull.hexPerNode}`);
    const st0 = hull.body.nodeStore;
    let full = -1;
    for (let i = 0; i < st0.count; i++) if (st0.active[i] && st0.coverage[i] >= 1) { full = i; break; }
    assert.ok(Math.abs(st0.maxHp[full] - 80 * hull.hexPerNode) < 1e-6, `HP pełnego węzła: ${st0.maxHp[full]}`);
    const before = hull.body.activeNodes;
    assert.equal(HullBodies.impact(e, -100, 50, 1000, { x: -600, y: 0 }), true);
    const killed = before - hull.body.activeNodes;
    const expected = 1000 * HULL_BODY_CONFIG.craterHpPerDamage / (80 * hull.hexPerNode);
    assert.ok(Math.abs(killed - expected) <= 1.5, `zabite ${killed}, oczekiwane ~${expected}`);
    const mid = hull.body.activeNodes;
    assert.equal(HullBodies.impact(e, -40, 50, 30, { x: -600, y: 0 }), true);
    assert.equal(hull.body.activeNodes, mid, '30 obrażeń nie zabija węzła');
    const st = HullBodies.structuralState(e);
    assert.equal(st.total, before);
    assert.ok(st.ratio > 0.97 && st.ratio < 1);
    assert.equal(HullBodies.impact(e, 5000, 5000, 1000, null), false, 'trafienie w pustkę');
  } finally { HullBodies.release(e); }
});

test('taran: styk pary dla AI, zdarzenia CollisionFX, odrzut, wraki z kotwicą w środku masy', () => {
  const a = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, angVel: 0, mass: 200000, isPlayer: true };
  const b = npcAt(430, 0, { mass: 20000 });
  HullBodies.createHull(a, NOTCHED);
  HullBodies.createHull(b, SMALL);
  const grinds = [], impacts = [];
  const onGrind = (ev) => grinds.push({ A: ev.A, B: ev.B, n: ev.contactsCount, points: ev.pointCount });
  const onImpact = (ev) => impacts.push(ev.approachSpeed);
  CollisionFX.on('grind', onGrind);
  CollisionFX.on('impact', onImpact);
  window.wrecks.length = 0;
  try {
    b.vx = -900;
    const dt = 1 / 120;
    let touched = false;
    for (let k = 0; k < 120; k++) {
      for (const e of [a, b, ...window.wrecks]) {
        if (e.pos) { e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.x = e.pos.x; e.y = e.pos.y; }
        else { e.x += e.vx * dt; e.y += e.vy * dt; }
        e.angle += (e.angVel || 0) * dt;
      }
      HullBodies.step(dt, [a, b, ...window.wrecks]);
      if (HullBodies.hasContact(a, b)) touched = true;
    }
    assert.ok(touched, 'styk pary');
    assert.ok(grinds.length > 0 && grinds.every((g) => g.n > 0), 'tarcie z liczbą kontaktów');
    assert.ok(grinds.some((g) => g.points > 0), 'punkty szwu dla iskier');
    assert.ok(impacts.length >= 1 && impacts[0] > 100, `uderzenie ${impacts[0]}`);
    assert.ok(a.vel.x < -10, `odrzut lżejszym taranem: ${a.vel.x}`);
    assert.ok(b.vx > -900, 'taranujący zwolnił');
    for (const w of window.wrecks) {
      const h = w.beamHull;
      assert.ok(h && h.anchorMode === 'com' && h.isFragment);
      assert.ok(h.dmgKey === a.beamHull.dmgKey || h.dmgKey === b.beamHull.dmgKey, 'odłam z taranu w warstwie ran rodzica');
      // Okruch rozpuszczony w odłamki: ciało martwe, pętla wraków gry usuwa encję.
      if (!HullBodies.hasHull(w)) continue;
      assert.ok(Math.abs(w.x - h.body.pos.x) < 1e-6 && Math.abs(w.y + h.body.pos.y) < 1e-6, 'kotwica wraku = początek ciała');
      assert.ok(h.body.activeNodes >= D.config.splitMinNodes, 'okruchy rozpuszczone');
    }
    // Kotwica statku po kroku: środek sprite'a w układzie ciała → świat = pozycja encji.
    const hull = a.beamHull, body = hull.body;
    const th = 2 * Math.atan2(body.quat.z, body.quat.w);
    const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
    const wx = body.pos.x + Math.cos(th) * ax - Math.sin(th) * ay;
    const wy = body.pos.y + Math.sin(th) * ax + Math.cos(th) * ay;
    assert.ok(Math.abs(wx - a.pos.x) < 1e-6 && Math.abs(-wy - a.pos.y) < 1e-6);
  } finally {
    CollisionFX.off('grind', onGrind);
    CollisionFX.off('impact', onImpact);
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    HullBodies.release(a); HullBodies.release(b);
  }
});

test('filtr par: wyłączona kolizja (isCollidable, właściciel) nie daje styku', () => {
  const a = npcAt(0, 0);
  const b = npcAt(100, 0);
  HullBodies.createHull(a, SMALL);
  HullBodies.createHull(b, SMALL);
  try {
    b.isCollidable = false;
    HullBodies.step(1 / 120, [a, b]);
    assert.equal(HullBodies.hasContact(a, b), false);
    b.isCollidable = true;
    b.owner = a;
    HullBodies.step(1 / 120, [a, b]);
    assert.equal(HullBodies.hasContact(a, b), false, 'moduł tego samego właściciela');
    b.owner = null;
    HullBodies.step(1 / 120, [a, b]);
    assert.equal(HullBodies.hasContact(a, b), true, 'nakładające się kadłuby');
  } finally { HullBodies.release(a); HullBodies.release(b); }
});

test('śmierć: cały kadłub przechodzi na encję wraku; okruch wraku znika', () => {
  window.wrecks.length = 0;
  const e = npcAt(50, 60, { vx: 12, vy: -3, angle: 0.4, angVel: 0.05 });
  const hull = HullBodies.createHull(e, SMALL);
  const body = hull.body;
  const wreck = HullBodies.convertToWreck(e);
  try {
    assert.ok(wreck && wreck.isWreck && window.wrecks.includes(wreck));
    assert.ok(e.beamHull === null && wreck.beamHull.body === body && body.entity === wreck);
    assert.ok(hull.dmgKey > 0 && wreck.beamHull.dmgKey === hull.dmgKey, 'wrak dziedziczy klucz mapy ran');
    assert.ok(Math.abs(wreck.x - body.pos.x) < 1e-9 && Math.abs(wreck.y + body.pos.y) < 1e-9);
    assert.ok(Math.abs(wreck.angle - 0.4) < 1e-9, 'kąt wraku z kadłuba');
    // Wrak rozebrany do 3 węzłów (mniej niż najmniejszy odłam) rozpada się w odłamki.
    const s = body.nodeStore;
    let alive = body.activeNodes;
    for (let i = 0; i < s.count && alive > 3; i++) if (s.active[i]) { D.destroyNode(body, i); alive--; }
    HullBodies.step(1 / 120, [wreck]);
    assert.equal(HullBodies.hasHull(wreck), false, 'okruch rozpuszczony');
  } finally { HullBodies.release(wreck); window.wrecks.length = 0; }
});

test('łup: broń przypięta do komórki kadłuba odlatuje z odłamem, który ją niesie', async () => {
  const { ensureSalvageManifest, fieldCutNodesPerSecond, FIELD_CUT_SHARDS_PER_SECOND } = await import('../src/game/salvage.js');
  const e = npcAt(0, 0, { editorHardpoints: [{ id: 'l', type: 'main', mount: 'laser_mk1', x: -60, y: 0 }, { id: 'r', type: 'main', mount: 'railgun_mk1', x: 60, y: 0 }] });
  const hull = HullBodies.createHull(e, SMALL);
  try {
    const manifest = ensureSalvageManifest(e);
    assert.equal(manifest.sourceShards, hull.baseNodes);
    // Stawki łupu są na heks: węzeł waży hexPerNode heksów (siatka 15 px nie zmniejsza łupu 4×).
    assert.equal(manifest.materials.scrap, Math.round(hull.baseNodes * hull.hexPerNode * 0.14));
    // Cięcie w polu: to samo tempo powierzchni co heksy (mniej, ale większych komórek na sekundę).
    assert.ok(Math.abs(fieldCutNodesPerSecond(e) - FIELD_CUT_SHARDS_PER_SECOND / hull.hexPerNode) < 1e-9);
    assert.equal(fieldCutNodesPerSecond({}), FIELD_CUT_SHARDS_PER_SECOND);
    const left = manifest.weapons.find((w) => w.weaponId === 'laser_mk1');
    const right = manifest.weapons.find((w) => w.weaponId === 'railgun_mk1');
    assert.match(left.cell, /^\d+,\d+$/);
    assert.equal(HullBodies.hasCell(e, left.cell), true);
    // Przecięcie w poprzek środka → dwa odłamy; broń idzie z tym, który ma jej komórkę.
    window.wrecks.length = 0;
    HullBodies.cutSegment(e, 0, -200, 0, 200, 6);
    HullBodies.step(1 / 120, [e]);
    for (let k = 0; k < 12 && window.wrecks.length === 0; k++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
    assert.equal(window.wrecks.length, 1, 'jeden odłam odpadł');
    const wreck = window.wrecks[0];
    assert.equal(wreck.beamHull.dmgKey, hull.dmgKey, 'odłam z rozpadu dziedziczy klucz mapy ran');
    const carried = wreck._salvage?.weapons?.map((w) => w.weaponId) || [];
    const onWreck = HullBodies.hasCell(wreck, left.cell) ? 'laser_mk1' : 'railgun_mk1';
    assert.deepEqual(carried, [onWreck], 'broń z komórki odłamu');
    assert.ok(HullBodies.hasCell(wreck, left.cell) !== HullBodies.hasCell(wreck, right.cell));
  } finally {
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    HullBodies.release(e);
  }
});

test('krytyczny wybuch reaktora: wrak, chmura odłamków z rdzenia, kilka odłamów pchniętych od wybuchu', () => {
  window.wrecks.length = 0;
  const debris = [];
  window.spawnHullDebris = (x, y, vx, vy, r, g, b, scale) => debris.push(scale > 0 ? Math.hypot(vx, vy) : -1);
  const e = npcAt(1000, -500, { mass: 30000 });
  HullBodies.createHull(e, plate(480, 160));
  try {
    const nodes = e.beamHull.body.activeNodes;
    const key = e.beamHull.dmgKey;
    const result = HullBodies.shatter(e, e.x, e.y, 0.9);
    assert.equal(e.beamHull, null, 'statek oddał kadłub');
    assert.ok(window.wrecks.length > 0 && window.wrecks.every((w) => w.beamHull.dmgKey === key),
      'wszystkie odłamy wybuchu reaktora w warstwie ran rodzica (ten sam dmgKey)');
    assert.ok(result.debris > nodes * 0.2, `rdzeń w odłamki: ${result.debris}/${nodes}`);
    // Pierwsze idą odłamki rdzenia (szybkie); potem węzły z rzazów i drobnica rozpadu.
    assert.ok(debris.length >= result.debris && debris.slice(0, result.debris).every((v) => v > 300), 'odłamki rdzenia lecą od wybuchu');
    assert.ok(result.fragments >= 2 && window.wrecks.length === result.fragments, `odłamy: ${result.fragments}`);
    for (const w of window.wrecks) {
      const away = (w.x - 1000) * w.vx + (w.y + 500) * w.vy;
      assert.ok(away > 0, 'odłam oddala się od punktu wybuchu');
    }
  } finally {
    delete window.spawnHullDebris;
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
  }
});

test('klucz mapy ran: każdy nowy kadłub ma własny, ponowna budowa dostaje nowy', () => {
  const a = npcAt(0, 0), b = npcAt(500, 0);
  const ha = HullBodies.createHull(a, SMALL);
  const hb = HullBodies.createHull(b, SMALL);
  try {
    assert.ok(Number.isInteger(ha.dmgKey) && ha.dmgKey > 0);
    assert.notEqual(ha.dmgKey, hb.dmgKey, 'wspólna konstrukcja (ten sam obraz), osobne rany');
    HullBodies.release(a);
    const again = HullBodies.createHull(a, SMALL);
    assert.ok(again.dmgKey > hb.dmgKey, 'nowy kadłub tej samej encji = nowa warstwa ran');
  } finally { HullBodies.release(a); HullBodies.release(b); }
});

test('naprawa: kształt, belki i HP wracają w skończonym czasie, bez budzenia solvera', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, SMALL);
  const body = hull.body, s = body.nodeStore, b = body.beamStore;
  try {
    // Wgniecenie i zerwane belki między żywymi węzłami, obniżone HP.
    for (let i = 0; i < s.count; i += 7) { s.x[i] += 3; s.y[i] -= 2; s.hp[i] *= 0.4; }
    let torn = 0;
    for (let bi = 0; bi < b.count && torn < 25; bi += 11) { if (!b.broken[bi]) { b.broken[bi] = 1; torn++; } }
    body.liveBeams -= torn;
    for (let bi = 0; bi < b.count; bi += 5) b.rest[bi] *= 1.1;
    let steps = 0;
    while (HullBodies.repair([e], 1 / 120) && steps < 120 * 10) steps++;
    assert.ok(steps < 120 * 5, `naprawa kończy się (${steps} kroków)`);
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      assert.equal(s.x[i], s.ox[i]); assert.equal(s.y[i], s.oy[i]);
      assert.equal(s.hp[i], s.maxHp[i]);
    }
    for (let bi = 0; bi < b.count; bi++) {
      if (!s.active[b.a[bi]] || !s.active[b.b[bi]]) continue;
      assert.equal(b.broken[bi], 0);
      assert.equal(b.rest[bi], b.restBase[bi]);
    }
    assert.ok(!body._region || body._region.list.length === 0, 'solver lokalny nie dostał całego kadłuba');
  } finally { HullBodies.release(e); }
});

test('masy: zderzenia z powierzchni (jedna gęstość), masa gry encji w swojej skali, wrak też', () => {
  // Kapitał lekki na j.² i gęsta fregata z szablonów gry — w silniku ta sama gęstość.
  const big = npcAt(0, 0, { mass: 50000, inertia: 9e9 });
  const small = npcAt(5000, 0, { mass: 25000 });
  const van = npcAt(-5000, 0);
  delete van.mass;
  HullBodies.createHull(big, NOTCHED);
  HullBodies.createHull(small, SMALL);
  HullBodies.createHull(van, SMALL);
  window.wrecks.length = 0;
  try {
    const density = (e) => e.beamHull.body.mass / HullBodies.structureFor(e === big ? NOTCHED : SMALL).area;
    assert.ok(Math.abs(density(big) - HULL_BODY_CONFIG.massPerArea) < 1e-9, 'masa zderzeń = gęstość · powierzchnia');
    assert.ok(Math.abs(density(small) - density(big)) < 1e-9, 'jedna gęstość dla wszystkich kadłubów');
    assert.equal(big.mass, 50000, 'masa gry encji bez zmian');
    assert.equal(small.mass, 25000);
    assert.equal(van.mass, van.beamHull.body.mass, 'bez masy gry — masa zderzeń');

    // Trafienie: masa gry i moment bezwładności maleją jak masa ciała (ciąg dysz ∝ masa).
    const body = big.beamHull.body, m0 = body.mass;
    assert.equal(HullBodies.impact(big, -100, 50, 4000, { x: -600, y: 0 }), true);
    HullBodies.step(1 / 120, [big]);
    const ratio = body.mass / m0;
    assert.ok(ratio < 1 && ratio > 0.9, `ubytek masy ciała: ${ratio}`);
    assert.ok(Math.abs(big.mass - 50000 * ratio) < 1e-6, `masa gry proporcjonalnie: ${big.mass}`);
    assert.ok(Math.abs(big.inertia - 9e9 * ratio) < 1, 'moment bezwładności razem z masą');

    // Wrak z całego kadłuba: masa gry encji, nie masa zderzeń ciała.
    const wreck = HullBodies.convertToWreck(big);
    assert.ok(Math.abs(wreck.mass - big.mass) < 1e-6, `wrak w skali gry: ${wreck.mass} vs ${big.mass}`);
    assert.ok(Math.abs(wreck.beamHull.body.mass - body.mass) < 1e-9, 'ciało wraku = to samo ciało');
  } finally {
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    for (const e of [big, small, van]) HullBodies.release(e);
  }
});
