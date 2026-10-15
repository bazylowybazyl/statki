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
  const dmg = sliceFunction(src, "function applyDamageToNPC(npc, dmg, cause = 'default', opts = {}, byPlayer = false) {");
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
  assert.match(blast, /GameBlasts\.blast\(o\)/);
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
  // RW-22: gra pisze rekordy EXPLOSION (GameBlasts.blast(o) — bez zmiatania dronów, blast(o, true) — z nim); dekoder
  // woła fabrykę BEZ opakowania (shipBlastFactory), opakowanie zostaje dla wybuchów renderu (Destruction3D) i konsoli.
  assert.match(src, /shipBlastFactory = window\.makeReactorBlow;/);
  assert.match(src, /GameBlasts\.ready = !!shipBlastFactory;/);
  assert.match(src, /window\.makeReactorBlow = withRepairDroneBlast\(window\.makeReactorBlow\);/);
  assert.match(src, /installExplosionCommands\(RenderCommands\.reader, \(\) => shipBlastFactory\)/);
});

// ─── PĘKNIĘCIE zbiornika za życia okrętu (2026-10-15, prośba użytkownika: „wybuchy dymu przy taranowaniu, jeśli rozwalę
// fuel tank”; stepFuelTankRupture, FUEL_TANK_TUNE.ruptureDeadFrac) ───
const { reactorCellWorld } = await import('../src/game/reactorCore.js');

function liveTankCells(e) {
  const t = e.fuelTank;
  let n = 0;
  for (let k = 0; k < t.cellX.length; k++) if (reactorCellNode(e.beamHull, t.cellX[k], t.cellY[k]) >= 0) n++;
  return n;
}
// Zabija komórkę k zbiornika kraterem na jej miejscu (krater na miarę rany zabija każdy węzeł w promieniu).
function killTankCell(e, k) {
  const p = reactorCellWorld(e.fuelTank, k, {});
  HullBodies.impact(e, p.x, p.y, 1e7, { x: 0, y: 0 }, { craterRadius: e.beamHull.body.cellSize * 0.45 });
}
function extentX(e) {
  const s = e.beamHull.body.nodeStore, q = {};
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    HullBodies.nodeWorld(e.beamHull, i, q);
    if (q.x < lo) lo = q.x;
    if (q.x > hi) hi = q.x;
  }
  return { lo, hi };
}

test('pęknięcie: od połowy martwych komórek zbiornik wybucha RAZ za życia; potem śmierć bez drugiego wybuchu zbiornika; remont — znów cały', () => {
  const e = shipWithTank('battleship', 4000, -2500, 0.6);
  e.vx = 140; e.vy = -35;
  const t = e.fuelTank;
  const n = t.cellX.length;
  const need = Math.ceil(n * DATA.FUEL_TANK_TUNE.ruptureDeadFrac);
  assert.ok(n >= 3, `zbiornik pancernika ma kilka komórek (${n})`);
  assert.equal(t.ruptured, false);
  assert.equal(FT.stepFuelTankRupture(e, {}, { time: 1 }), null, 'cały zbiornik');
  const before = FT.fuelTankBlast(e, {});
  // Poniżej progu — bez pęknięcia (krater po kraterze).
  let k = 0;
  while (n - liveTankCells(e) < need - 1 && k < n) killTankCell(e, k++);
  assert.ok(n - liveTankCells(e) < need, 'poniżej progu');
  assert.equal(FT.stepFuelTankRupture(e, {}, { time: 2 }), null, 'za mało martwych komórek');
  assert.equal(t.ruptured, false);
  while (n - liveTankCells(e) < need && k < n) killTankCell(e, k++);
  assert.ok(n - liveTankCells(e) >= need, 'próg osiągnięty');
  const r = FT.stepFuelTankRupture(e, {}, { candidates: window.wrecks, time: 3.5 });
  assert.ok(r, 'zbiornik pęka');
  assert.equal(t.ruptured, true);
  assert.equal(t.rupturedAt, 3.5);
  assert.ok(r.onHost && r.entity === e);
  assert.equal(r.vx, 140); assert.equal(r.vy, -35);
  assert.equal(r.size, t.size); assert.equal(r.profile, t.profile);
  assert.ok(Math.hypot(r.x - before.x, r.y - before.y) < t.gridR * 2, 'miejsce zbiornika');
  assert.ok(Math.abs(r.axisX - Math.cos(0.6)) < 1e-6 && Math.abs(r.axisY - Math.sin(0.6)) < 1e-6, 'oś kadłuba');
  // Raz: dalsze kroki i dalsze straty — nic; śmierć gospodarza nie ma drugiego wybuchu zbiornika.
  assert.equal(FT.stepFuelTankRupture(e, {}, { time: 4 }), null);
  while (k < n) killTankCell(e, k++);
  assert.equal(FT.stepFuelTankRupture(e, {}, { time: 5 }), null, 'pęka tylko raz');
  assert.equal(FT.fuelTankBlast(e, {}, { candidates: window.wrecks }), null, 'śmierć po pęknięciu — bez wybuchu zbiornika');
  // Remont (dok / odrost dronów): wszystkie komórki znów żyją → zbiornik znów cały.
  HullBodies.restoreHull(e);
  assert.equal(liveTankCells(e), n);
  assert.equal(FT.stepFuelTankRupture(e, {}, { time: 9 }), null);
  assert.equal(t.ruptured, false, 'naprawiony zbiornik jest znów cały');
  assert.ok(FT.fuelTankBlast(e, {}), 'wybuch zbiornika przy śmierci wraca');
  cleanup([e]);
});

test('pęknięcie: zbiornik odcięty z odłamem (komórki żywe na wraku rodu) nie pęka', () => {
  const e = shipWithTank('battleship', 0, 0, 0);
  const t = e.fuelTank;
  const other = shipWithTank('battleship', 9000, 0, 0);
  other.beamHull.dmgKey = e.beamHull.dmgKey;
  const b0 = FT.fuelTankBlast(e, {});
  HullBodies.impact(e, b0.x, b0.y, 1e7, { x: 0, y: 0 }, { craterRadius: t.gridR * 3 });
  assert.equal(liveTankCells(e), 0, 'u gospodarza nie ma komórek zbiornika');
  assert.equal(FT.stepFuelTankRupture(e, {}, { candidates: [other], time: 1 }), null, 'komórki na wraku rodu — zbiornik cały');
  assert.equal(t.ruptured, false);
  // Bez wraku z komórkami — rozbity (sprawdzenie po następnej zmianie kadłuba gospodarza: trafienie przy dziobie).
  HullBodies.impact(e, extentX(e).hi - 40, 0, 1e7, { x: 0, y: 0 }, { craterRadius: e.beamHull.body.cellSize * 1.5 });
  assert.ok(FT.stepFuelTankRupture(e, {}, { candidates: [], time: 2 }), 'bez wraku — pęka');
  cleanup([e, other]);
});

test('pęknięcie w taranie (Node, prawdziwy silnik belek): Atlas szarżą w rufę pancernika rozbija zbiornik, a okręt żyje', () => {
  // Jak scripts/zbiornik-taran-sym.mjs (strona „rufa”, tryb „szarza”): ciąg szarży 1100 j/s² od 2200 do 3000 j/s.
  const V = shipWithTank('battleship', 0, 0, 0);
  const tail = extentX(V).lo;
  const A = shipWithTank('atlas', 0, 0, 0);
  const nose = extentX(A).hi;
  HullBodies.release(A);
  const atlas = shipWithTank('atlas', tail - nose - 120, 0, 0);
  atlas.vx = 2200;
  const dt = 1 / 60;
  let ruptureT = null;
  for (let k = 0; k < 90 && ruptureT === null; k++) {
    if (atlas.vx < 3000) atlas.vx += 1100 * dt;
    for (const e of [atlas, V, ...window.wrecks]) { e.x += e.vx * dt; e.y += e.vy * dt; e.angle += (e.angVel || 0) * dt; }
    HullBodies.step(dt, [atlas, V, ...window.wrecks]);
    if (FT.stepFuelTankRupture(V, {}, { candidates: window.wrecks, time: (k + 1) * dt })) ruptureT = (k + 1) * dt;
  }
  assert.ok(ruptureT !== null && ruptureT < 1.5, `zbiornik pęka w szarży (${ruptureT})`);
  const st = HullBodies.structuralState(V);
  assert.ok(st && st.ratio > 0.2, `pancernik żyje (konstrukcja ${st?.ratio?.toFixed(2)}) — dawniej taran bez śmierci nie dawał wybuchu`);
  cleanup([atlas, V]);
});

test('index.html: pęknięcie zbiornika w kroku integralności (gracz i okręty) PRZED sufitem punktów; śmierć po pęknięciu', () => {
  const src = readIndexHtml();
  assert.match(src, /import \{[^}]*stepFuelTankRupture[^}]*\} from "\.\/src\/game\/fuelTank\.js"/);
  const hp = sliceFunction(src, 'function updateHardpointIntegrity(');
  assert.match(hp, /if \(ship && !ship\.destroyed\) stepEntityFuelTankRupture\(ship\);/);
  assert.match(hp, /if \(entity\.fuelTank\) stepEntityFuelTankRupture\(entity\);/);
  const iHp = src.indexOf('updateHardpointIntegrity(_integrityDtAcc, dynamicDestructibles);');
  const iCap = src.indexOf('enforceNpcHexIntegrityBalance();', iHp);
  assert.ok(iHp > 0 && iCap > iHp && iCap - iHp < 200, 'pęknięcie przed sufitem punktów (śmierć w tym samym ticku nie dubluje wybuchu)');
  const step = sliceFunction(src, 'function stepEntityFuelTankRupture(');
  assert.match(step, /SHIP_BLAST_TUNE\.rupture/);
  assert.match(step, /stepFuelTankRupture\(entity, _fuelBlast, \{ candidates: window\.wrecks, time: HullBodies\.simTime \}\)/);
  assert.match(step, /GameBlasts\.blast\(fuelBlastOpts\(tb\)\)/);
  assert.match(src, /const SHIP_BLAST_TUNE = \{[^}]*rupture: true/);
  const blast = sliceFunction(src, 'function spawnShipDeathBlast(');
  assert.match(blast, /tank\?\.ruptured/);
  assert.match(blast, /HullBodies\.simTime - tank\.rupturedAt < FUEL_TANK_TUNE\.ruptureQuiet\) return true/);
  assert.match(blast, /\* k;/);
  assert.ok(DATA.FUEL_TANK_TUNE.ruptureDeadFrac > 0 && DATA.FUEL_TANK_TUNE.ruptureDeadFrac <= 1);
  assert.ok(DATA.FUEL_TANK_TUNE.afterRuptureSize > 0 && DATA.FUEL_TANK_TUNE.afterRuptureSize < 1);
});
