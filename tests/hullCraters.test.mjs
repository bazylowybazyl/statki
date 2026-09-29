// Krater na miarę rany (zadanie 25c): lej rany z mapy ran nie jest większy niż prawdziwa dziura w
// belkach. Jedno źródło promienia — wpis stempla (src/3d/hullDamageStamps.js: lejRadius /
// craterRadiusFor); fizyka — HullBodies.impact { craterRadius } → D.applyImpact { killRadius }
// (wszystkie węzły w promieniu giną: wgniecenie, odrzut blachy z haszu, belki, oparcie, rozpad);
// rakieta — mały krater w punkcie styku głowicy (src/game/hullCraters.js). Bez Math.random w kraterze
// wymuszonym. Lej tylko w prawdziwej dziurze (kanał krateru mapy ran) — tests/hullDamageMap.test.mjs.
// node --test tests/hullCraters.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, hullImpactResult } = await import('../src/game/hullBodies.js');
const S = await import('../src/3d/hullDamageStamps.js');
const T = await import('../src/3d/hullDamageMap.tsl.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const C = await import('../src/game/hullCraters.js');
const D = HullBodies.engine;

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, ...extra });

// Math.random z licznikiem (krater wymuszony nie losuje z generatora gry).
function countRandom(fn) {
  const orig = Math.random;
  let calls = 0;
  let s = 12345;
  Math.random = () => { calls++; s = (s * 16807) % 2147483647; return s / 2147483647; };
  try { const v = fn(); return { calls, v }; } finally { Math.random = orig; }
}

// Hash stanu węzłów ciała (aktywność, HP, pozycja, prędkość).
function bodyHash(body) {
  const s = body.nodeStore;
  let h = 0;
  for (let i = 0; i < s.count; i++) {
    h = (h * 31 + s.active[i] * 7 + Math.round(s.hp[i] * 1e3)) % 1e12;
    h = (h * 31 + Math.round(s.x[i] * 1e4) + Math.round(s.y[i] * 1e4) * 3) % 1e12;
    h = (h * 31 + Math.round(s.vx[i] * 1e4) + Math.round(s.vy[i] * 1e4) * 5) % 1e12;
  }
  return h;
}

// Węzły kadłuba (środki w świecie gry) bliżej punktu niż r — niezależnie od silnika.
function nodesWithin(e, x, y, r) {
  const hull = e.beamHull, s = hull.body.nodeStore;
  let n = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const p = HullBodies.nodeWorld(hull, i);
    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) n++;
  }
  return n;
}

test('jedno źródło: promień leja z receptury (próg materiału) = promień krateru ciężkiej broni przy obrażeniach wzorcowych', () => {
  // Lej = brzeg · clamp(1,25 − 0,9 r/R) na środku progu smoothstep 0,52–0,6 (materiał i kernel mapy ran).
  assert.equal(S.RIM_EDGE_A, 1.25); assert.equal(S.RIM_EDGE_B, 0.9);
  assert.equal(S.LEJ_LO, 0.52); assert.equal(S.LEJ_HI, 0.6);
  const tsl = read('src/3d/hullDamageMap.tsl.js');
  assert.match(tsl, /clamp\(float\(1\.25\)\.sub\(r\.mul\(0\.9\)\), 0\.0, 1\.0\)/, 'profil brzegu w kernelu');
  assert.match(tsl, /smoothstep\(0\.52, 0\.6, holeF\)/, 'próg leja w materiale');
  for (const [fam, r] of [['yamato', 90.68], ['mjolnir', 55.8], ['armata', 35.35], ['valkyrie', 24.44], ['rocket', 18.0]]) {
    close(S.lejRadius(S.STAMP[fam].impact), r, 0.01, `lej ${fam}`);
  }
  close(S.lejRadius(S.STAMP.mjolnir.exit), 39.06, 0.01, 'lej wylotu Mjolnira');
  close(S.lejRadius(S.STAMP.valkyrie.stuck), 20, 1e-9, 'lej zakleszczenia Valkyrie');
  assert.equal(S.lejRadius(S.STAMP.helios.impact), 0, 'brzeg 0,5 < progu — bez leja');
  // Lustro CPU materiału: na promieniu leja wpisu kształt leja = połowa progu.
  const E = S.STAMP.yamato.impact;
  const Tx = { heat: 0, ion: 0, scorch: 0, rim: 0, cut: 0, crater: 0 };
  const rl = S.lejRadius(E);
  T.damageStampCpu(Tx, [0.5, 0.5, E[S.S_R] / 400, 0], [E[1], E[2], E[3], E[4]], [1, 0, 1, 0], 0.5 + rl / 400, 0.5, 1);
  const g = T.woundGlowCpu(Tx);
  close(g.lej ?? g.hole, 0.5, 1e-6, 'kształt leja na promieniu z lejRadius (bez szumu i falowania: ziarno 0 → falowanie 0)');
});

test('craterRadiusFor: ciężka broń na miarę rany (√ obrażeń), reszta — krater z budżetu HP; wzorce = obrażenia broni', () => {
  const W = MASTER_WEAPONS;
  // Wzorzec = baseDamage broni; wylot i zakleszczenie przebić — krater z 0,5 obrażeń (18-A). Balans
  // 2026-09-29: Yamato 60 j. i armata 24,7 j. przy pełnych obrażeniach (wzorzec większy niż baseDamage).
  close(S.craterRadiusFor({ vfxKey: 'special_yamato_cannon' }, 'impact', W.special_yamato_cannon.baseDamage), 60, 0.05, 'Yamato 60 j.');
  close(S.craterRadiusFor({ vfxKey: 'armata_mk1' }, 'impact', W.armata_mk1.baseDamage), 24.7, 0.05, 'armata 24,7 j.');
  assert.equal(S.STAMP.mjolnir.impact[S.S_CRATER], W.siege_railgun.baseDamage);
  assert.equal(S.STAMP.mjolnir.exit[S.S_CRATER], 0.5 * W.siege_railgun.baseDamage);
  assert.equal(S.STAMP.valkyrie.impact[S.S_CRATER], W.special_valkyrie_railgun.baseDamage);
  assert.equal(S.STAMP.valkyrie.exit[S.S_CRATER], 0.5 * W.special_valkyrie_railgun.baseDamage);
  assert.equal(S.STAMP.valkyrie.stuck[S.S_CRATER], 0.5 * W.special_valkyrie_railgun.baseDamage);
  assert.equal(S.STAMP.rocket.impact[S.S_CRATER], W.missile_rack.baseDamage);
  // Pocisk z gry (vfxKey, type): pełne obrażenia → promień leja; mniejsze → √.
  const yam = { vfxKey: 'special_yamato_cannon', type: 'plasma', weaponSize: 'Capital' };
  const yRef = S.STAMP.yamato.impact[S.S_CRATER];
  close(S.craterRadiusFor(yam, 'impact', yRef), S.lejRadius(S.STAMP.yamato.impact), 1e-9);
  close(S.craterRadiusFor(yam, 'impact', yRef / 4), S.lejRadius(S.STAMP.yamato.impact) / 2, 1e-9, '¼ obrażeń → ½ promienia');
  close(S.craterRadiusFor(yam, 'impact', yRef * 100), 2 * S.lejRadius(S.STAMP.yamato.impact), 1e-9, 'sufit: 2 promienie wzorcowe');
  // Rów przebicia Mjolnira (2026-09-29): wpis `kerf` z wzorcem = baseDamage → lej rzazu (26,5 j.); Valkyrie i Hexlance bez rowu.
  assert.equal(S.STAMP.mjolnir.kerf[S.S_CRATER], W.siege_railgun.baseDamage);
  close(S.trenchRadiusFor({ vfxKey: 'siege_railgun' }, 2500), S.lejRadius(S.STAMP.mjolnir.kerf), 1e-9);
  assert.equal(C.hasTrench({ vfxKey: 'siege_railgun' }), true);
  for (const src of [{ vfxKey: 'special_valkyrie_railgun' }, 'hexlance_siege', { vfxKey: 'armata_mk1' }, { vfxKey: 'special_yamato_cannon' }]) {
    assert.equal(S.trenchRadiusFor(src, 5000), 0, JSON.stringify(src));
    assert.equal(C.hasTrench(src), false);
  }
  close(S.craterRadiusFor({ vfxKey: 'siege_railgun' }, 'exit', 1250), S.lejRadius(S.STAMP.mjolnir.exit), 1e-9);
  close(S.craterRadiusFor({ id: 'missile_rack', category: 'rocket' }, 'impact', 1000), 18, 1e-9, 'rakieta: mały krater');
  close(S.craterRadiusFor({ vfxKey: 'siege_torpedo', type: 'torpedo' }, 'impact', 800), 18 * Math.sqrt(0.8), 1e-9, 'torpeda — rodzina rakiet');
  // Bez krateru na miarę rany: lekka broń, Goliath (decyzja 25c), gatling plazmowy, rykoszet, rzaz, wiązki, bez źródła.
  for (const [src, v, dmg] of [
    [{ vfxKey: 'railgun_mk2', type: 'rail' }, 'impact', 10], [{ vfxKey: 'heavy_autocannon_l' }, 'impact', 60],
    [{ vfxKey: 'special_goliath_autocannon' }, 'impact', 45], [{ vfxKey: 'special_plasma_gatling' }, 'impact', 60],
    [{ vfxKey: 'vulcan_minigun' }, 'ricochet', 4], [{ vfxKey: 'special_valkyrie_railgun' }, 'kerf', 500],
    [{ id: 'beam_pulse', category: 'beam' }, 'impact', 45], [null, 'impact', 1000], [yam, 'impact', 0]
  ]) {
    assert.equal(S.craterRadiusFor(src, v, dmg), 0, `${JSON.stringify(src)} ${v}`);
  }
  // Opcje dla HullBodies.impact: wspólny obiekt, null bez krateru.
  assert.equal(C.craterOptsFor({ vfxKey: 'railgun_mk2' }, 'impact', 10), null);
  const o = C.craterOptsFor(yam, 'impact', 850);
  assert.equal(o, C.hullCraterOpts);
  close(o.craterRadius, 60, 0.05);
});

test('silnik: killRadius zabija wszystkie węzły w promieniu (i tylko je), odrzut z haszu — bez Math.random, powtarzalnie', () => {
  const run = () => {
    const e = npcAt(0, 0);
    HullBodies.createHull(e, plate(600, 300));
    const R = 60;
    // Punkt w środku płyty (krater w głębi kadłuba — pełne koło).
    const inside = nodesWithin(e, 0, 0, R);
    const outsideRing = nodesWithin(e, 0, 0, R + 30) - inside;
    const before = e.beamHull.body.activeNodes;
    const rnd = countRandom(() => HullBodies.impact(e, 0, 0, 850, { x: 0, y: 600 }, { craterRadius: R }));
    const killed = before - e.beamHull.body.activeNodes;
    const res = { hit: rnd.v, calls: rnd.calls, killed, inside, outsideRing, crater: hullImpactResult.crater,
      radius: hullImpactResult.radius, rest: nodesWithin(e, 0, 0, R), ring: nodesWithin(e, 0, 0, R + 30), hash: bodyHash(e.beamHull.body) };
    HullBodies.release(e);
    return res;
  };
  const a = run();
  assert.equal(a.hit, true);
  assert.equal(a.calls, 0, 'krater wymuszony nie losuje z Math.random gry');
  assert.ok(a.inside > 40, `węzłów w kole: ${a.inside}`);
  assert.equal(a.rest, 0, 'w promieniu nie został żaden węzeł');
  assert.equal(a.killed, a.inside, `zabite = węzły w kole (${a.killed} / ${a.inside}) — nic poza kołem`);
  assert.equal(a.ring, a.outsideRing, 'pierścień za kołem nietknięty (tylko wgnieciony)');
  assert.ok(a.crater <= 60 + 1e-9 && a.crater > 60 - 15, `zasięg dziury ${a.crater}`);
  assert.ok(a.radius >= 60 + 15 - 1e-9, `wgniecenie sięga komórkę za dziurę: ${a.radius}`);
  const b = run();
  assert.equal(b.hash, a.hash, 'ten sam krater i odrzut w drugim przebiegu');
});

test('silnik: bez killRadius krater z budżetu bez zmian (ta sama sekwencja Math.random, ten sam stan)', () => {
  const run = (opts) => {
    const e = npcAt(0, 0);
    HullBodies.createHull(e, plate(400, 200));
    const body = e.beamHull.body;
    const s = body.nodeStore;
    let i0 = -1;
    for (let i = 0; i < s.count; i++) if (s.active[i] && s.coverage[i] >= 1) { i0 = i; break; }
    const cs = body.cellSize;
    const rnd = countRandom(() => D.applyImpact(body, s.x[i0] + body.pos.x, s.y[i0] + body.pos.y, 0, 2400, { x: 1, y: 0, z: 0 }, opts));
    const res = { calls: rnd.calls, active: body.activeNodes, hash: bodyHash(body), reach: D.lastCraterReach, cs };
    HullBodies.release(e);
    return res;
  };
  const a = run({ radius: 75, hpBudget: 2160 });
  const b = run({ radius: 75, hpBudget: 2160, killRadius: 0 });
  assert.ok(a.calls > 0, 'krater z budżetu losuje odrzut jak dotąd');
  assert.equal(b.calls, a.calls);
  assert.equal(b.hash, a.hash);
  assert.equal(b.active, a.active);
  assert.ok(a.reach > 0 && a.reach <= 75, `zasięg zabitych węzłów budżetu: ${a.reach}`);
});

test('HullBodies.impact z craterRadius na krawędzi kadłuba: dziura od brzegu, hullImpactResult.crater, rozpad przeciętej płyty', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(420, 60));
  try {
    const hull = e.beamHull;
    // Pocisk z góry w burtę (y −30): wejście na brzegu, krater Yamato (90,7 j.) przecina płytę 60 j.
    const hit = HullBodies.sweep(e, 0, -1000, 0, 0, 0);
    assert.ok(hit);
    const R = S.craterRadiusFor({ vfxKey: 'special_yamato_cannon' }, 'impact', 850);
    const inside = nodesWithin(e, hit.worldX, hit.worldY, R);
    const before = hull.body.activeNodes;
    assert.equal(HullBodies.impact(e, hit.worldX, hit.worldY, 850, { x: 0, y: 9000 }, C.craterOptsFor({ vfxKey: 'special_yamato_cannon' }, 'impact', 850)), true);
    assert.ok(before - hull.body.activeNodes >= inside, `zabite ${before - hull.body.activeNodes} ≥ w kole ${inside}`);
    assert.ok(hullImpactResult.crater > R - 15 && hullImpactResult.crater <= R + 1e-9, `zasięg dziury ${hullImpactResult.crater}`);
    // Rozpad (kroki silnika — sprawdzany co 10 kroków): płyta przecięta w poprzek → odłam wrakiem.
    for (let k = 0; k < 12; k++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
    assert.ok(window.wrecks.length >= 1, 'płyta przecięta dziurą — odłam');
  } finally {
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    HullBodies.release(e);
  }
});

test('rakieta: mały krater w punkcie styku głowicy (ten sam co obraz wybuchu), bez Math.random', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  try {
    const c = C.rocketHullContact(HullBodies, e, 0, -300, 0, -200);
    assert.equal(c.valid, true);
    close(c.y, -150, 12, 'styk na górnej burcie');
    assert.ok(c.ny < -0.9, 'normalna na zewnątrz burty');
    const before = e.beamHull.body.activeNodes;
    const rnd = countRandom(() => C.rocketCraterHit(HullBodies, e, 0, -300, 0, -200, 1000, MASTER_WEAPONS.missile_rack, { x: 0, y: 1800 }));
    assert.equal(rnd.calls, 0, 'krater rakiety bez Math.random gry');
    assert.ok(rnd.v > 0 && rnd.v === before - e.beamHull.body.activeNodes, `zabite węzły: ${rnd.v}`);
    close(hullImpactResult.crater, 18, 15, 'zasięg dziury ~ lej rakiety (18 j.)');
    // Obraz wybuchu bierze ten sam punkt (efekty rakiet: prepareContact → rocketHullContact).
    const fx = read('src/3d/rockets/effects.js');
    assert.match(fx, /rocketHullContact\(HB, target, x0, y0, x1, y1, this\.hc\[r\.index\], this\.hs\[r\.index\]\)/);
    assert.doesNotMatch(fx, /HullDamageMap\.stampAt\(onHull/, 'rana z haka krateru, nie drugi stempel efektu');
    // Pudło (odcinek z dala od kadłuba) — bez krateru.
    assert.equal(C.rocketCraterHit(HullBodies, e, 2000, -300, 2000, -200, 1000, 'rocket', null), 0);
  } finally { HullBodies.release(e); }
});

test('gra: applyHexImpact podaje krater na miarę rany, rakieta — hak applyRocketHullImpact przed obrażeniami HP', () => {
  const html = read('index.html');
  const fn = html.slice(html.indexOf('function applyHexImpact('), html.indexOf('// --- Trafienia wiązek'));
  assert.match(fn, /const craterOpts = craterOptsFor\(fxSource, fxVariant, damage\);/);
  assert.match(fn, /HullBodies\.impact\(entity, x, y, damage, vel, craterOpts\)/);
  assert.match(fn, /window\.applyRocketHullImpact = function/);
  assert.match(fn, /rocketCraterHit\(HullBodies, target, x0, y0, x1, y1, damage, weaponDef \|\| 'rocket', _rocketHullVel, applyHexImpact\)/);
  const rs = read('src/effects3d/rocketSystem3D.js');
  const onHit = rs.slice(rs.indexOf('_onHit(r'), rs.indexOf('_applyBlastDamage(r'));
  const i = onHit.indexOf('window.applyRocketHullImpact(');
  const j = onHit.indexOf('applyNpc(target, dmg');
  assert.ok(i > 0 && j > i, 'krater przed obrażeniami HP (śmierć celu zabiera kadłub wrakowi)');
  assert.match(onHit, /!shieldBlocking && target\.beamHull/, 'tylko gdy tarcza nie blokuje');
});
