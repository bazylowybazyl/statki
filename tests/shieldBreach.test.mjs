import test from 'node:test';
import assert from 'node:assert/strict';

// RW-29 (docs/PLAN-render-worker.md § 2.6 p. 1): przebicia tarcz przez kanał zwrotny RET. Render (shield3D.js) pisze
// rekord na slot puli — slot i generacja encji, klucz obrysu, epoka, bity płytek; gra (src/game/shieldBreach.js)
// przepisuje zmienione rekordy raz na klatkę, stawia `__shieldBreach` i sama testuje punkt na siatce płytek.

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const R = await import('../src/render/returnLayout.js');
const { createRenderIds } = await import('../src/render/renderIds.js');
const { createShieldBreachReader, shieldProfileOf } = await import('../src/game/shieldBreach.js');
const L = await import('../src/3d/shield/shieldLattice.js');
const { getShieldHullAngle, sampleShieldProfileRadius } = await import('../shieldSystem.js');
const { readIndexHtml } = await import('./helpers/indexSource.mjs');
const { readFileSync } = await import('node:fs');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > w * 0.7 && y < h * 0.3) continue;   // obrys nie jest prostokątem
    const o = (y * w + x) * 4;
    data[o] = 120; data[o + 1] = 140; data[o + 2] = 160; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
const IMAGE = plate(600, 220);

function shieldedShip(x, y, angle) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 5000, shield: { max: 1000, val: 1000, state: 'active' } };
  HullBodies.createHull(e, IMAGE);
  return e;
}

function setup() {
  const views = R.createReturnViews(R.createReturnBuffer(R.RET_DEFAULT_LAYOUT, { shared: false }));
  const ids = createRenderIds();
  const reader = createShieldBreachReader({
    ret: views,
    entityAt: (slot, gen) => (ids.entities.isLive(slot, gen) ? ids.entities.objectAt(slot) : null)
  });
  return { views, ids, reader };
}

// Płytka, którą test punktu sprawdza najpierw (1 odstęp siatki w głąb od wejścia w obrys) — jak render przed RW-29.
function tileAt(e, lat, profile, wx, wy, k = 1) {
  const a = getShieldHullAngle(e), c = Math.cos(a), s = Math.sin(a);
  const dx = wx - e.x, dy = wy - e.y;
  const lx = dx * c + dy * s, ly = dx * s - dy * c;
  const r = Math.hypot(lx, ly) || 1;
  const Rr = sampleShieldProfileRadius(profile, Math.atan2(-ly, lx));
  const f = Math.max(0, Rr - k * lat.cell) / r;
  return { t: L.nearestShieldTile(lat, lx * f, ly * f), lx: lx * f, ly: ly * f };
}

test('stałe puli wspólne: rekord RET mieści bity slotu, klucz obrysu deterministyczny', () => {
  assert.equal(R.RET_BREACH.SLOTS, L.SHIELD_SLOTS);
  assert.equal(R.RET_BREACH.WORDS, L.SHIELD_SLOT_CAP / 32);
  const p = L.circleShieldProfile(300);
  assert.equal(L.shieldProfileHash(p), L.shieldProfileHash({ bins: Float32Array.from(p.bins) }));
  assert.notEqual(L.shieldProfileHash(p), L.shieldProfileHash(L.circleShieldProfile(301)));
});

test('geometria płytek: punkt wejścia w obrys trafia płytkę 1 odstęp w głąb, przy samym brzegu siatki', () => {
  window.wrecks.length = 0;
  const e = shieldedShip(5000, -2000, 0.7);
  const profile = shieldProfileOf(e);
  assert.ok(profile && profile.bins, 'obrys z kadłuba na belkach');
  const lat = L.acquireShieldLattice(profile, L.SHIELD_SLOT_CAP);
  let checked = 0;
  for (let i = 0; i < 64; i++) {
    const g = (i / 64) * Math.PI * 2;
    const a = getShieldHullAngle(e);
    // Kierunek świata wyjścia z klatki lokalnej (x wzdłuż kadłuba, y = −y gry) przy kącie obrysu g.
    const Rr = sampleShieldProfileRadius(profile, g);
    const lx = Math.cos(g) * Rr * 1.3, ly = -Math.sin(g) * Rr * 1.3;
    const wx = e.x + lx * Math.cos(a) + ly * Math.sin(a);
    const wy = e.y + lx * Math.sin(a) - ly * Math.cos(a);
    const { t, lx: px, ly: py } = tileAt(e, lat, profile, wx, wy);
    if (t < 0) continue;
    checked++;
    const d = Math.hypot(lat.rest[t * 4] - px, lat.rest[t * 4 + 1] - py);
    // Komórka Woronoja siatki trójkątnej ma promień d/√3; przy brzegu siatki najbliższa ISTNIEJĄCA płytka bywa dalej.
    assert.ok(d <= lat.cell, `płytka ${t} przy punkcie (${d.toFixed(1)} j., odstęp ${lat.cell.toFixed(1)})`);
    assert.ok(lat.nrm[t * 4 + 3] > 0.6, 'płytka w pasie przy brzegu tarczy');
  }
  assert.ok(checked >= 56, `płytki znalezione w ${checked}/64 kierunkach`);
  HullBodies.release(e);
});

test('przebicie: bit płytki z RET przepuszcza punkt w dziurze, druga strona tarczy dalej blokuje', () => {
  window.wrecks.length = 0;
  const { views, ids, reader } = setup();
  const e = shieldedShip(0, 0, -0.4);
  const profile = shieldProfileOf(e);
  const lat = L.acquireShieldLattice(profile, L.SHIELD_SLOT_CAP);
  ids.entities.begin(); const slot = ids.entities.slotOf(e); ids.entities.end();
  const dir = 0.9, far = 4000;
  const hitX = e.x + Math.cos(dir) * far, hitY = e.y + Math.sin(dir) * far;
  const { t } = tileAt(e, lat, profile, hitX, hitY);
  assert.ok(t >= 0);
  const bits = new Uint32Array(R.RET_BREACH.WORDS);
  bits[t >> 5] |= 1 << (t & 31);
  // Przed odczytem — nic.
  reader.refresh();
  assert.equal(!!e.__shieldBreach, false);
  R.retWriteBreach(views, 5, slot, ids.entities.gen(slot), L.shieldProfileHash(profile), 1, bits);
  reader.refresh();
  assert.equal(e.__shieldBreach, true, 'flaga z rekordu');
  assert.equal(reader.isShieldBreachedAt(e, hitX, hitY), true, 'w dziurze');
  assert.equal(reader.isShieldBreachedAt({ _realEntity: e }, hitX, hitY), true, 'przez _realEntity');
  assert.equal(reader.isShieldBreachedAt(e, e.x - Math.cos(dir) * far, e.y - Math.sin(dir) * far), false, 'druga strona');
  // Kadłub się obraca — dziura jedzie z tarczą (klatka lokalna), więc ten sam punkt świata już jej nie trafia.
  e.angle += Math.PI;
  assert.equal(reader.isShieldBreachedAt(e, hitX, hitY), false);
  e.angle -= Math.PI;
  // Obrys inny niż w rekordzie (przebudowa kadłuba) — płytki nie pasują: brak przebicia.
  R.retWriteBreach(views, 5, slot, ids.entities.gen(slot), L.shieldProfileHash(profile) + 1, 2, bits);
  reader.refresh();
  assert.equal(reader.isShieldBreachedAt(e, hitX, hitY), false);
  // Slot zwolniony (tarcza zeszła z ekranu) — flaga gaśnie.
  R.retWriteBreach(views, 5, slot, ids.entities.gen(slot), L.shieldProfileHash(profile), 3, bits);
  reader.refresh();
  assert.equal(reader.isShieldBreachedAt(e, hitX, hitY), true);
  R.retWriteBreach(views, 5, -1, 0, 0, 4, null);
  reader.refresh();
  assert.equal(e.__shieldBreach, null);
  assert.equal(reader.isShieldBreachedAt(e, hitX, hitY), false);
  HullBodies.release(e);
});

test('właściciel slotu puli: inny slot puli, inna generacja encji, rekord bez przebić', () => {
  window.wrecks.length = 0;
  const { views, ids, reader } = setup();
  const a = shieldedShip(0, 0, 0), b = shieldedShip(9000, 0, 0);
  ids.entities.begin(); const sa = ids.entities.slotOf(a); const sb = ids.entities.slotOf(b); ids.entities.end();
  const pa = L.shieldProfileHash(shieldProfileOf(a));
  const bits = new Uint32Array(R.RET_BREACH.WORDS).fill(0xffffffff);
  R.retWriteBreach(views, 0, sa, ids.entities.gen(sa), pa, 1, bits);
  reader.refresh();
  assert.equal(a.__shieldBreach, true);
  // Slot puli 0 przechodzi do b (a zeszła z ekranu), a dostaje slot 3 bez przebić.
  R.retWriteBreach(views, 0, sb, ids.entities.gen(sb), pa, 2, bits);
  R.retWriteBreach(views, 3, sa, ids.entities.gen(sa), pa, 2, null);
  reader.refresh();
  assert.equal(a.__shieldBreach, null, 'a — rekord bez przebić');
  assert.equal(b.__shieldBreach, true);
  assert.equal(reader.slotOf.get(a), 3);
  // Encja zniknęła z list (slot zwolniony, nowa generacja) — stary rekord nie trafia w nowego właściciela.
  ids.entities.begin(); ids.entities.slotOf(b); ids.entities.end();
  const c = { x: 0, y: 0, shield: { max: 1 } };
  ids.entities.begin(); ids.entities.slotOf(b); const sc = ids.entities.slotOf(c); ids.entities.end();
  assert.equal(sc, sa, 'slot a przejęty przez c');
  R.retWriteBreach(views, 3, sa, ids.entities.gen(sa) - 1, pa, 3, bits);   // generacja a — nieaktualna
  reader.refresh();
  assert.equal(!!c.__shieldBreach, false);
  HullBodies.release(a); HullBodies.release(b);
});

test('wpięcie: render pisze RET, gra odświeża przed fizyką i testuje punkt sama', () => {
  const shield = readFileSync(new URL('../src/3d/shield3D.js', import.meta.url), 'utf8');
  assert.match(shield, /export function setShieldReturnChannel\(views, keyOf\)/);
  assert.match(shield, /if \(retViews\) \{ writeBreachRecord\(s, rec, breachCpu, s \* wordsPerSlot\); continue; \}/);
  assert.match(shield, /if \(retViews\) retWriteBreach\(retViews, s, -1, 0, 0, breachEpoch, null\);/);
  const src = readIndexHtml();
  assert.match(src, /const isShieldBreachedAt = ShieldBreach\.isShieldBreachedAt;/);
  assert.doesNotMatch(src, /import \{[^}]*isShieldBreachedAt[^}]*\} from "\.\/src\/3d\/shield3D\.js"/);
  assert.match(src, /setShieldReturnChannel\(RenderReturn, /);
  const refresh = src.indexOf('ShieldBreach.refresh();');
  assert.ok(refresh > 0 && refresh < src.indexOf('while (acc >= PHYS_DT && steps < 10)'), 'odświeżenie przed krokami fizyki');
  const marks = src.indexOf('RenderSlots.entities.begin();');
  assert.ok(marks > 0 && marks < src.indexOf('updateShields3D(PAUSED ? 0 : frameDt, renderSeen'), 'sloty encji przed tarczami');
});
