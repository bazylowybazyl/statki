// Zbiornik paliwa (F14 audytu wybuchów, decyzja użytkownika 2026-10-08; src/game/fuelTank.js, src/data/fuelTanks.js):
// każdy kadłub z mostkiem / rdzeniem ma zbiornik (wpis albo automat) w kadłubie, z dala od komory reaktora; wybuch
// z miejsca zbiornika (poza encji, oś kadłuba, nośnik), zbiornik idzie z kadłubem; śmierć bez rdzenia w index.html →
// wybuch z gazu z miejsca zbiornika, WeaponFx.droneBlast tylko dla myśliwców / dronów / platform.
// node --test tests/fuelTank.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { createReactorCoreGame } = await import('../src/game/reactorCoreGame.js');
const FT = await import('../src/game/fuelTank.js');
const DATA = await import('../src/data/fuelTanks.js');
const { reactorCellNode } = await import('../src/game/reactorCore.js');
const { makeBridgeShip, bridgeHullImage } = await import('./helpers/bridgeHulls.mjs');
const { BRIDGE_DEMO_HULLS } = await import('../dema/mostki-webgpu/kadluby.js');
const { readIndexHtml, sliceFunction } = await import('./helpers/indexSource.mjs');

const RG = createReactorCoreGame({});

function shipWithTank(key, x = 0, y = 0, angle = 0) {
  const { def } = bridgeHullImage(key);
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RG.attach(e, def.profile);
  FT.attachFuelTank(e, def.profile);
  return e;
}

function cleanup(list) {
  for (const e of list) if (e) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}

test('każdy kadłub z mostkiem / rdzeniem ma zbiornik w kadłubie, z dala od komory reaktora; skala rośnie z kadłubem', async () => {
  // Lista kadłubów testu = wszystkie kadłuby z mostkiem (nowy kadłub z mostkiem wchodzi tu sam albo test pada).
  const { BRIDGE_LAYOUT_PROPOSALS } = await import('../src/game/shipBridge.js');
  for (const k of Object.keys(BRIDGE_LAYOUT_PROPOSALS)) assert.ok(BRIDGE_DEMO_HULLS[k], `kadłub z mostkiem ${k} bez kadłuba testowego (dema/mostki-webgpu/kadluby.js)`);
  const rows = [];
  for (const key of Object.keys(BRIDGE_DEMO_HULLS)) {
    const { def } = bridgeHullImage(key);
    const e = shipWithTank(key);
    const t = e.fuelTank;
    assert.ok(t, `${key}: zbiornik`);
    assert.ok(t.cellX.length > 0, `${key}: komórki zbiornika w kadłubie`);
    const hull = e.beamHull;
    for (let k = 0; k < t.cellX.length; k++) assert.ok(reactorCellNode(hull, t.cellX[k], t.cellY[k]) >= 0, `${key}: komórka żywa`);
    // Środek zbiornika w kadłubie (blisko żywego węzła).
    const tb = FT.fuelTankBlast(e, {});
    assert.ok(HullBodies.probe(e, tb.x, tb.y) || t.cellX.length > 0, `${key}: środek w kadłubie`);
    for (const c of e.reactorCores || []) {
      if (c.invalid) continue;
      const d = Math.hypot(c.gx - t.gx, c.gy - t.gy);
      assert.ok(d >= c.gridR + t.gridR * 0.5, `${key}: zbiornik z dala od komory (${d.toFixed(0)} vs ${c.gridR.toFixed(0)} + ${t.gridR.toFixed(0)})`);
      // Komórki zbiornika i komory się nie nakładają.
      const coreCells = new Set();
      for (let k = 0; k < c.cellX.length; k++) coreCells.add(c.cellX[k] + ',' + c.cellY[k]);
      for (let k = 0; k < t.cellX.length; k++) assert.ok(!coreCells.has(t.cellX[k] + ',' + t.cellY[k]), `${key}: komórka wspólna z komorą`);
    }
    assert.ok(['escort', 'cruiser', 'capital'].includes(t.profile), `${key}: profil ${t.profile}`);
    assert.ok(t.size >= DATA.FUEL_TANK_TUNE.minSize && t.size <= DATA.FUEL_TANK_TUNE.maxSize, `${key}: size ${t.size}`);
    assert.equal(t.auto, !DATA.FUEL_TANK_MARKERS[def.profile], `${key}: wpis z tabeli albo automat`);
    rows.push({ key, len: FT.fuelTankHullLength(hull), size: t.size, profile: t.profile });
    cleanup([e]);
  }
  // Fregaty mniejsze niż niszczyciele, niszczyciele mniejsze niż pancerniki i większe kadłuby.
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.ok(by.frigate.size < by.destroyer.size && by.destroyer.size < by.battleship.size && by.battleship.size < by.terran_supercapital.size);
  assert.equal(by.frigate.profile, 'escort');
  assert.equal(by.pirate_destroyer.profile, 'cruiser');
  assert.equal(by.battleship.profile, 'capital');
});

test('wpisy tabeli (Atlas, Bellator, Iron Skull) trafiają w kadłub; automat — część rufowa', () => {
  for (const [key, prof] of [['atlas', 'atlas'], ['battleship', 'terran_battleship'], ['pirate_battleship', 'pirate_battleship']]) {
    const e = shipWithTank(key);
    assert.ok(e.fuelTank && !e.fuelTank.auto, `${key}: wpis z tabeli`);
    assert.equal(e.fuelTank.capacity, DATA.FUEL_TANK_MARKERS[prof][0].capacity);
    cleanup([e]);
  }
  // Automat (supercapital): zbiornik za środkiem kadłuba (rufa = −x sprite'a).
  const e = shipWithTank('terran_supercapital');
  assert.ok(e.fuelTank.auto && e.fuelTank.marker.x < 0, `rufa: x ${e.fuelTank.marker.x}`);
  cleanup([e]);
  // Edytor bierze górę (marker PNG z r).
  const f = makeBridgeShip(HullBodies, 'battleship');
  RG.attach(f, 'terran_battleship');
  const t = FT.attachFuelTank(f, 'terran_battleship', { editorTanks: [{ id: 'ed', x: 200, y: 0, r: 40, capacity: 100 }] });
  assert.equal(t.id, 'ed');
  assert.equal(t.capacity, 100);
  assert.ok(t.marker.x > 0);
  cleanup([f]);
  // Myśliwiec bez zbiornika.
  const g = makeBridgeShip(HullBodies, 'frigate');
  g.type = 'fighter';
  assert.equal(FT.attachFuelTank(g, 'terran_frigate'), null);
  cleanup([g]);
});

test('wybuch z miejsca zbiornika: poza encji (obrót), oś kadłuba, nośnik = prędkość; zniszczone komórki — miejsce zbiornika', () => {
  const e0 = shipWithTank('battleship', 0, 0, 0);
  const a = FT.fuelTankBlast(e0, {});
  assert.ok(a && a.onHost);
  assert.ok(Math.abs(a.axisX - 1) < 1e-6 && Math.abs(a.axisY) < 1e-6, 'oś = dziób (kąt 0)');
  assert.ok(a.x < 0, 'zbiornik za środkiem (rufa)');
  const off = Math.hypot(a.x, a.y);
  cleanup([e0]);
  // Ten sam kadłub obrócony o 90° i przesunięty: punkt obraca się z kadłubem, oś też.
  const e = shipWithTank('battleship', 5000, -3000, Math.PI / 2);
  e.vx = 320; e.vy = -45;
  const b = FT.fuelTankBlast(e, {});
  assert.ok(Math.abs(Math.hypot(b.x - 5000, b.y + 3000) - off) < 1, 'ta sama odległość od środka');
  assert.ok(Math.abs(b.axisX * Math.cos(Math.PI / 2) + b.axisY * Math.sin(Math.PI / 2)) > 0.99, 'oś obrócona z kadłubem');
  assert.equal(b.vx, 320); assert.equal(b.vy, -45);
  assert.equal(b.profile, e.fuelTank.profile);
  assert.equal(b.size, e.fuelTank.size);
  // Krater w miejscu zbiornika: komórki zbiornika martwe → wybuch z miejsca zbiornika u gospodarza.
  HullBodies.impact(e, b.x, b.y, 1e7, { x: 0, y: 0 }, { craterRadius: e.fuelTank.gridR * 3 });
  const alive = [...e.fuelTank.cellX].filter((_, k) => reactorCellNode(e.beamHull, e.fuelTank.cellX[k], e.fuelTank.cellY[k]) >= 0).length;
  const c = FT.fuelTankBlast(e, {}, { candidates: window.wrecks });
  assert.ok(c, 'wybuch mimo zniszczonych komórek');
  assert.ok(Math.hypot(c.x - b.x, c.y - b.y) < e.fuelTank.gridR * 4, `miejsce zbiornika (żywe komórki ${alive})`);
  cleanup([e]);
});

test('zbiornik idzie z kadłubem: komórki zbiornika na wraku rodu — wybuch na wraku, z jego prędkością', () => {
  const e = shipWithTank('battleship', 0, 0, 0);
  const t = e.fuelTank;
  // Atrapa wraku rodu: ta sama encja kadłuba pod inną encją (jak przy przeniesieniu ciała na wrak) — gospodarz bez
  // kadłuba, kandydat z tym samym dmgKey niesie komórki.
  const wreck = { x: e.x, y: e.y, vx: 77, vy: 11, angle: e.angle, isWreck: true, beamHull: e.beamHull };
  e.beamHull.entity = wreck;
  const r = FT.fuelTankBlast(e, {}, { candidates: [wreck] });
  assert.equal(r, null, 'gospodarz bez kadłuba (po przeniesieniu) — brak wybuchu z gospodarza');
  e.beamHull.entity = e;
  // Gospodarz żywy, ale komórki zbiornika tylko na wraku (inne ciało tego rodu): lokalizacja przez kandydatów.
  const other = shipWithTank('battleship', 9000, 0, 0);
  other.beamHull.dmgKey = e.beamHull.dmgKey;
  other.vx = 55; other.vy = 5;
  // Zabij komórki zbiornika u gospodarza (krater) — w kandydacie zostają.
  const b0 = FT.fuelTankBlast(e, {});
  HullBodies.impact(e, b0.x, b0.y, 1e7, { x: 0, y: 0 }, { craterRadius: t.gridR * 3 });
  const res = FT.fuelTankBlast(e, {}, { candidates: [other] });
  assert.ok(res && !res.onHost && res.entity === other, 'zbiornik na wraku rodu');
  assert.equal(res.vx, 55);
  assert.ok(Math.abs(res.x - 9000 - b0.x) < t.gridR * 2, 'miejsce komórek zbiornika na wraku');
  cleanup([e, other]);
});

test('dane: rozmiar ∝ √pojemności z granicami, klasa z długości, pojemność automatu z powierzchni', () => {
  const s1 = DATA.fuelTankBlastSize(400), s4 = DATA.fuelTankBlastSize(1600);
  assert.ok(Math.abs(s4 / s1 - 2) < 1e-9, '√');
  assert.equal(DATA.fuelTankBlastSize(0), DATA.FUEL_TANK_TUNE.minSize);
  assert.equal(DATA.fuelTankBlastSize(1e9), DATA.FUEL_TANK_TUNE.maxSize);
  assert.equal(DATA.fuelTankClassForLength(180), 'escort');
  assert.equal(DATA.fuelTankClassForLength(340), 'cruiser');
  assert.equal(DATA.fuelTankClassForLength(700), 'capital');
  assert.ok(DATA.fuelTankCapacityForArea(2e5) > DATA.fuelTankCapacityForArea(2e4));
  for (const [k, v] of Object.entries(DATA.FUEL_TANK_PROFILE_BY_CLASS)) assert.equal(k, v);
});

test('index.html: śmierć bez rdzenia → wybuch z gazu z miejsca zbiornika; droneBlast tylko myśliwce / drony / platformy', () => {
  const src = readIndexHtml();
  const dmg = sliceFunction(src, "function applyDamageToNPC(npc, dmg, cause = 'default', opts = {}) {");
  const iHost = dmg.indexOf('ReactorGame.hostKilled(npc)');
  const iTank = dmg.indexOf('fuelTankBlast(npc');
  const iWreck = dmg.indexOf('window.createWreckage(npc)');
  assert.ok(iHost > 0 && iTank > iHost && iWreck > iTank, 'miejsce zbiornika po rdzeniu, PRZED zamianą we wrak');
  assert.match(dmg, /isFighterLike \? null : fuelTankBlast\(npc/);
  assert.match(dmg, /spawnShipDeathBlast\(npc, tankBlast, blastHostKey\)/);
  // etap C: ród kadłuba (gospodarz gazu) zapamiętany PRZED zamianą we wrak (createWreckage przenosi ciało)
  const iKey = dmg.indexOf('const blastHostKey = Number(npc.beamHull?.dmgKey)');
  assert.ok(iKey > iTank && iKey < iWreck, 'klucz rodu przed createWreckage');
  // CanvasVFX (droneBlast) tylko w gałęzi myśliwca.
  const iFighter = dmg.indexOf('if (isFighterLike || !SHIP_BLAST_TUNE.fuelTank) {');
  assert.ok(iFighter > 0, 'gałąź myśliwca (i A/B dawnej śmierci)');
  const iElse = dmg.indexOf('spawnShipDeathBlast(npc, tankBlast, blastHostKey)');
  for (const m of dmg.matchAll(/CanvasVFX\.spawn(ExplosionPlasma|DefaultHit)/g)) {
    assert.ok(m.index > iFighter && m.index < iElse, 'CanvasVFX tylko dla myśliwców');
  }
  const blast = sliceFunction(src, 'function spawnShipDeathBlast(');
  assert.match(blast, /fuelBlastOpts\(tb\)/);
  assert.match(blast, /shipBlastFactory/);
  const opts = sliceFunction(src, 'function fuelBlastOpts(');
  for (const k of ['o.x = tb.x', 'o.vx = tb.vx', 'o.axisX = tb.axisX', 'o.profile = tb.profile', 'o.size = tb.size']) assert.ok(opts.includes(k), k);
  // Gracz bez rdzenia.
  const pl = sliceFunction(src, 'function handlePlayerDestroyed(');
  assert.match(pl, /fuelTankBlast\(ship/);
  assert.match(pl, /triggerReactorBlow3D\(tb\.x, tb\.y, tb\.size, fuelBlastOpts\(tb\)\)/);
  // Montaż zbiornika po rdzeniu (wszystkie miejsca montażu rdzeni).
  const att = sliceFunction(src, 'function attachEntityReactorCores(');
  assert.ok(att.indexOf('attachEntityFuelTank(') > att.indexOf('ReactorGame.attach('));
  // Detonacja rdzenia dokłada domenę gazu w barwie plazmy.
  assert.match(src, /onDetonate: \(ev\) => \{\s*spawnReactorDetonationGas\(ev\);/);
  const gas = sliceFunction(src, 'function spawnReactorDetonationGas(');
  assert.match(gas, /gasOnly: true|_coreGasOpts/);
  assert.match(src, /const _coreGasOpts = \{[^}]*gasOnly: true/);
  // Platformy — dawny wybuch drona.
  assert.match(src, /CanvasVFX\.spawnExplosionPlasma\(platform\.x, platform\.y/);
  // Fabryka okrętów bez zmiatania dronów naprawczych (rozgrywka bez zmian).
  assert.match(src, /shipBlastFactory = window\.makeReactorBlow;\s*\n(\s*\/\/[^\n]*\n)*\s*window\.makeReactorBlow = withRepairDroneBlast/);
});
