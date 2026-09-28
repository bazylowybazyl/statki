// Mapa ran (18-C) z mechaniką broni z dema (18-B): wariant stempla z krateru rykoszetu, wylotu i
// zakleszczenia (HullDamageMap.setSource(pocisk, wariant) → hak onHullImpact) — tabela
// src/3d/hullDamageStamps.js. Rykoszet Vulcana / Gatlinga: płytkie osmalenie wydłużone wzdłuż
// lotu, bez brzegu rany i bez otworu (demo stemplowało go jak zwykłe trafienie).
// node --test tests/hullDamageMechanics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullDamageMap, DMG_STAMP_FLOATS } = await import('../src/3d/hullDamageMap.js');
const S = await import('../src/3d/hullDamageStamps.js');

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

let fakeKey = 190000;
function fakeHull(W, H) {
  const e = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
  e.beamHull = { entity: e, srcWidth: W, srcHeight: H, scale: 1, cellSize: 15, dmgKey: ++fakeKey };
  return e;
}
function lastStamp(slot) {
  const i = HullDamageMap._qCount - 1;
  const Q = HullDamageMap._qData, o = i * DMG_STAMP_FLOATS;
  return {
    r: Q[o + 2] * slot.worldH, cut: Q[o + 3], heat: Q[o + 4], scorch: Q[o + 5], rim: Q[o + 6], ion: Q[o + 7], el: Q[o + 10],
    hole: Q[o + 12] * slot.worldH
  };
}
function stampFrom(e, src, variant, killed = 0) {
  const r = {
    kind: 'impact', hit: true, killed, radius: 15, node: 0, u: 0.5, v: 0.5, x: 0, y: 0,
    dmgKey: e.beamHull.dmgKey, dirX: 1, dirY: 0, len: 0, crater: killed > 0 ? 15 : 0
  };
  const q = HullDamageMap._qCount;
  HullDamageMap.setSource(src, variant);
  HullDamageMap.onHullImpact(e, r);
  HullDamageMap.clearSource();
  assert.equal(HullDamageMap._qCount, q + 1, `${variant}: jeden stempel`);
  return lastStamp(HullDamageMap.slotOf(e.beamHull.dmgKey));
}

test('rykoszet: płytkie osmalenie Vulcana i Gatlinga S — wydłużone wzdłuż lotu, bez brzegu rany i otworu', () => {
  HullDamageMap.reset();
  HullDamageMap.frame = 10;
  const e = fakeHull(720, 380);
  const ric = S.STAMP.vulcan.ricochet;
  assert.ok(ric, 'wpis rykoszetu w rodzinie Vulcana');
  for (const src of [
    { vfxKey: 'vulcan_minigun', type: 'autocannon', weaponSize: 'M' },
    { vfxKey: 'gatling_s', type: 'autocannon', weaponSize: 'S' }
  ]) {
    const st = stampFrom(e, src, 'ricochet');
    close(st.r, ric[S.S_R], 1e-3, 'promień');
    close(st.heat, ric[S.S_HEAT], 1e-6, 'żar');
    close(st.scorch, ric[S.S_SCORCH], 1e-6, 'osmalenie');
    assert.equal(st.rim, 0, 'bez brzegu rany');
    assert.equal(st.cut, 0, 'bez przestrzeliny');
    close(st.el, ric[S.S_ELONG], 1e-6, 'wydłużenie wzdłuż lotu');
    assert.ok(st.heat < S.STAMP.vulcan.impact[S.S_HEAT], 'chłodniejszy niż trafienie');
  }
  // Zwykłe trafienie Vulcana bez zmian (demo: ctx.stamp(hull, x, y, 7, 1.5, 0.35, 0.3, 0)).
  const hit = stampFrom(e, { vfxKey: 'vulcan_minigun', type: 'autocannon', weaponSize: 'M' }, 'impact');
  close(hit.r, 7, 1e-3);
  close(hit.heat, 1.5, 1e-6);
  close(hit.rim, 0.3, 1e-6);
});

test('wylot i zakleszczenie przebić: wpisy rodzin Mjolnira i Valkyrie; rodzina bez wariantu — trafienie', () => {
  HullDamageMap.reset();
  HullDamageMap.frame = 11;
  const e = fakeHull(900, 400);
  const mj = { vfxKey: 'siege_railgun', type: 'rail', weaponSize: 'Capital' };
  const vk = { vfxKey: 'special_valkyrie_railgun', type: 'rail', weaponSize: 'Capital' };
  // Krater zabił węzły: promień = max(receptura, krater + ½ komórki) — tu receptura większa.
  close(stampFrom(e, mj, 'exit', 3).r, S.STAMP.mjolnir.exit[S.S_R], 1e-3, 'wylot Mjolnira');
  close(stampFrom(e, vk, 'exit', 3).r, S.STAMP.valkyrie.exit[S.S_R], 1e-3, 'wylot Valkyrie');
  close(stampFrom(e, vk, 'stuck', 3).r, S.STAMP.valkyrie.stuck[S.S_R], 1e-3, 'zakleszczenie Valkyrie');
  close(stampFrom(e, mj, 'stuck', 3).r, S.STAMP.mjolnir.impact[S.S_R], 1e-3, 'Mjolnir bez `stuck` — trafienie');
  close(stampFrom(e, { vfxKey: 'armata_mk1', type: 'armata' }, 'ricochet', 3).r, S.STAMP.armata.impact[S.S_R], 1e-3,
    'rodzina bez rykoszetu — trafienie');
  // Lej tylko w prawdziwej dziurze (25c): stempel niesie zasięg zabitych węzłów krateru, bez krateru — 0.
  close(stampFrom(e, vk, 'stuck', 3).hole, 15, 1e-3, 'zakleszczenie: lej w dziurze krateru');
  assert.equal(stampFrom(e, vk, 'exit', 0).hole, 0, 'wylot bez zabitych węzłów: bez leja');
});
