// Mgła wojny (2026-10-04): logika wzroku strony gracza (src/game/fogOfWar.js), orkiestracja w SensorSystem,
// rzut na uniformy postu (src/3d/fog/fogOfWarView.js) i wpięcie w grę (strażnicy źródeł).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};

const F = await import('../src/game/fogOfWar.js');
const { SensorSystem } = await import('../src/game/sensorSystem.js');
const { packFogView, FOG_TIME_WRAP } = await import('../src/3d/fog/fogOfWarView.js');
const { createFogPostUniforms, FOG_MAX_CIRCLES, FOG_TILE_WORLD } = await import('../src/3d/fog/fogOfWarPost.js');
const { uniformsAdapter } = await import('../src/3d/tsl/uniformy.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function player(x, y) {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, isPlayer: true, type: 'atlas', radius: 500 };
}
const pirate = (x, y, extra = {}) => ({ x, y, type: 'frigate_pd', radius: 60, isPirate: true, friendly: false, ...extra });

test('zasięg wzroku: Atlas, zwiadowca z profilem radaru, myśliwiec, jawny visionRange', () => {
  assert.equal(F.visionRangeOf(player(0, 0)), F.FOG_TUNE.vision.atlas);
  assert.equal(F.visionRangeOf({ type: 'frigate_pd', sensors: { role: 'radar' } }), F.FOG_TUNE.vision.radar);
  assert.equal(F.visionRangeOf({ type: 'fighter_light', fighter: true }), F.FOG_TUNE.vision.fighter);
  assert.equal(F.visionRangeOf({ type: 'battleship' }), F.FOG_TUNE.vision.battleship);
  assert.equal(F.visionRangeOf({ type: 'destroyer', sensors: { visionRange: 7777 } }), 7777);
  // mgła ma być widoczna po oddaleniu kamery: wzrok Atlasa mniejszy niż czujniki pasywne AI (80 km)
  assert.ok(F.FOG_TUNE.vision.atlas < 40000);
});

test('widoczność: w kręgu wzroku tak, poza nim nie; nowy byt ukryty do pierwszej oceny; sojusznik widzi dla strony', () => {
  const S = F.createFogState();
  const me = player(0, 0);
  const near = pirate(15000, 0);
  const far = pirate(60000, 0);
  const scout = { x: 55000, y: 0, type: 'frigate_pd', friendly: true, radius: 60 };
  const fresh = pirate(1000, 0);
  assert.equal(F.fogHides(S, fresh, me), true, 'nowy byt bez oceny — ukryty (bez błysku w mgle)');
  F.collectFogSources(S, { player: me, npcs: [near, far] });
  F.stepFogEntities(S, { player: me, npcs: [near, far] });
  assert.equal(F.fogHides(S, near, me), false);
  assert.equal(F.fogHides(S, far, me), true);
  assert.equal(F.fogHides(S, me, me), false, 'gracz zawsze');
  // sojusznik 55 km dalej (fregata: 9 km wzroku) odsłania okręt przy sobie
  F.collectFogSources(S, { player: me, npcs: [near, far, scout] });
  F.stepFogEntities(S, { player: me, npcs: [near, far, scout] });
  assert.equal(F.fogHides(S, far, me), false, 'zwiad sojusznika');
  assert.equal(F.fogHides(S, scout, me), false);
  // dron / sonda z puli SensorSystem (extraCount)
  const pool = [{ x: 0, y: 0, range: 1, type: 'ship' }, { x: 120000, y: 0, range: 20000, type: 'drone' }, { x: 9e9, y: 0, range: 1e9, type: 'drone' }];
  const deep = pirate(130000, 0);
  F.collectFogSources(S, { player: me, npcs: [deep], extra: pool, extraCount: 2 });
  F.stepFogEntities(S, { player: me, npcs: [deep] });
  assert.equal(F.fogHides(S, deep, me), false, 'dron zwiadu odsłania punkt');
  assert.ok(F.fogPointVisible(S, 125000, 0) && !F.fogPointVisible(S, 9e9, 0), 'pula: tylko extraCount pierwszych');
  // wyłączona mgła — nic nie chowa
  S.enabled = false;
  F.stepFogEntities(S, { player: me, npcs: [far] });
  assert.equal(F.fogHides(S, far, me), false);
});

test('stacje pirackie i wraki: ukryte do zobaczenia, potem znane (jak teren w RTS); przyjazne stacje widzą', () => {
  const S = F.createFogState();
  const me = player(0, 0);
  const yard = { x: 50000, y: 0, r: 300, isPirate: true };
  const port = { x: -200000, y: 0, r: 300 };
  const wreck = { x: 52000, y: 0, radius: 200 };
  F.collectFogSources(S, { player: me, stations: [yard, port] });
  F.stepFogEntities(S, { player: me, stations: [yard, port], wrecks: [wreck] });
  assert.equal(F.fogHides(S, yard, me), true);
  assert.equal(F.fogHides(S, wreck, me), true);
  assert.equal(F.fogHides(S, port, me), false);
  assert.ok(F.fogPointVisible(S, -190000, 0), 'przyjazna stacja jest źródłem wzroku');
  // podejście
  me.pos.x = 40000;
  F.collectFogSources(S, { player: me, stations: [yard, port] });
  F.stepFogEntities(S, { player: me, stations: [yard, port], wrecks: [wreck] });
  assert.equal(F.fogHides(S, yard, me), false);
  // odlot — stacja i wrak zostają znane
  me.pos.x = -300000;
  F.collectFogSources(S, { player: me, stations: [yard, port] });
  F.stepFogEntities(S, { player: me, stations: [yard, port], wrecks: [wreck] });
  assert.equal(F.fogHides(S, yard, me), false, 'odkryta stacja zostaje na mapie');
  assert.equal(F.fogHides(S, wreck, me), false);
  // nowy wrak bez oceny (z walki w kadrze) — widoczny do pierwszego kroku
  assert.equal(F.fogHides(S, { x: 0, y: 0, isWreck: true, __fogKind: 'wreck' }, me), false);
});

test('strefa fabuły i odsłonięcie bytu (ostrzał zdradza pozycję) mijają z czasem gry', () => {
  const S = F.createFogState();
  const me = player(0, 0);
  const sniper = pirate(70000, 0);
  F.revealFogEntity(S, sniper, 4);
  F.collectFogSources(S, { player: me, npcs: [sniper] });
  F.stepFogEntities(S, { player: me, npcs: [sniper] });
  assert.equal(F.fogHides(S, sniper, me), false, 'trafił gracza — widoczny');
  F.advanceFogClock(S, 5);
  F.stepFogEntities(S, { player: me, npcs: [sniper] });
  assert.equal(F.fogHides(S, sniper, me), true);
  F.revealFogArea(S, 'intel', 200000, 0, 10000, 3);
  F.collectFogSources(S, { player: me });
  assert.ok(F.fogPointVisible(S, 205000, 0));
  F.advanceFogClock(S, 4);
  F.collectFogSources(S, { player: me });
  assert.ok(!F.fogPointVisible(S, 205000, 0), 'strefa wygasła');
  assert.equal(S.reveals.length, 0);
});

test('sygnatura masy: miejsce wskazane z odchyłką, rozpoznanie przez byt, wygaszenie, wyłączona mgła = rozpoznana', () => {
  const S = F.createFogState();
  const me = player(0, 0);
  const yard = { x: 60000, y: 0, r: 300, isPirate: true };
  const m = F.setMassSignature(S, 'yard', { x: 60000, y: 0, offset: { x: 3000, y: -1000 }, spread: 12000, mass: 2e6, entity: yard });
  assert.deepEqual([m.shownX, m.shownY], [63000, -1000]);
  F.stepMassSignatures(S, 1);
  assert.ok(m.alpha > 0 && !m.resolved);
  assert.equal(F.isMassSignatureResolved(S, 'yard'), false);
  // dron odsłania stocznię
  F.revealFogArea(S, 'drone', 60000, 0, 20000);
  F.collectFogSources(S, { player: me, stations: [yard] });
  F.stepFogEntities(S, { player: me, stations: [yard] });
  F.stepMassSignatures(S, 0.1);
  assert.equal(F.isMassSignatureResolved(S, 'yard'), true);
  for (let i = 0; i < 40; i++) F.stepMassSignatures(S, 0.1);
  assert.equal(S.masses.length, 0, 'wygasła i zniknęła');
  // bez mgły
  const S2 = F.createFogState();
  S2.enabled = false;
  F.setMassSignature(S2, 'x', { x: 0, y: 0, mass: 1 });
  F.stepMassSignatures(S2, 0.1);
  assert.equal(F.isMassSignatureResolved(S2, 'x'), true);
  assert.equal(F.formatMassEstimate(2.04e6), '~2,0 mln t');
  assert.equal(F.formatMassEstimate(45000), '~45 tys. t');
});

test('świat mgły → uniformy postu: osie sceny, kadr z zapasem, zawinięte kafle szumu, kamery 3D', () => {
  const S = F.createFogState();
  const me = player(5_000_000, 7_000_000);
  F.collectFogSources(S, { player: me });
  F.pushFogSource(S, 9_000_000, 7_000_000, 20000, F.FOG_KIND.ally);   // daleko poza kadrem
  F.setMassSignature(S, 'm', { x: 5_030_000, y: 7_010_000, spread: 9000, mass: 1e6 });
  S.masses[0].alpha = 0.8;
  S.time = 1234.5;
  const world = F.createFogWorld();
  F.exportFogWorld(S, world);
  assert.equal(world.on, true);
  assert.equal(world.count, 2);
  assert.equal(world.massCount, 1);
  const U = uniformsAdapter(createFogPostUniforms());
  const view = { persp: false, refX: 5_000_000 + 100, refY: 7_000_000 - 50, zoom: 0.05, bufW: 1920, bufH: 1080 };
  const n = packFogView(U, world, view);
  assert.equal(n, 1, 'koło poza kadrem (z zapasem) odrzucone');
  const c = U.uFogData.value[0];
  assert.ok(Math.abs(c.x - -100) < 1e-6 && Math.abs(c.y - -50) < 1e-6, 'względem kamery, oś y w górę (−y gry)');
  assert.equal(c.z, F.FOG_TUNE.vision.atlas);
  const mass = U.uFogData.value[FOG_MAX_CIRCLES];
  assert.ok(Math.abs(mass.x - 29900) < 1e-6 && Math.abs(mass.y - -10050) < 1e-6 && Math.abs(mass.w - 0.8) < 1e-6);
  assert.equal(U.uFogOn.value, 1);
  assert.equal(U.uFogCount.value, 1);
  assert.equal(U.uFogMassCount.value, 1);
  for (const b of [U.uFogBaseA.value, U.uFogBaseB.value]) {
    assert.ok(b.x >= 0 && b.x < 1 && b.y >= 0 && b.y < 1, 'kafel szumu zawinięty (bez współrzędnych 5–10 mln j. w shaderze)');
  }
  // przesunięcie kamery o cały kafel nie zmienia wzoru (szum okresowy w kaflu)
  const a = U.uFogBaseA.value.clone();
  packFogView(U, world, { ...view, refX: view.refX + FOG_TILE_WORLD });
  assert.ok(Math.abs(U.uFogBaseA.value.x - a.x) < 1e-9 && Math.abs(U.uFogBaseA.value.y - a.y) < 1e-9);
  assert.ok(U.uFogTime.value < FOG_TIME_WRAP);
  // kamery 3D: bez cullingu, wysokość oka
  packFogView(U, world, { persp: true, refX: 5_000_000, refY: 7_000_000, bufW: 1920, bufH: 1080, camZ: 8000, inv: null });
  assert.equal(U.uFogPersp.value, 1);
  assert.equal(U.uFogCamZ.value, 8000);
  assert.equal(U.uFogCount.value, 2);
  // wyłączona — post bez mgły
  world.on = false;
  assert.equal(packFogView(U, world, view), -1);
  assert.equal(U.uFogOn.value, 0);
});

test('SensorSystem: z mgłą świadomość = wzrok strony gracza, hides(); bez mgły — dawne koło czujników', () => {
  const me = player(0, 0);
  window.ship = me;
  const near = pirate(15000, 0);
  const far = pirate(60000, 0);
  const ally = { x: 0, y: 1000, friendly: true, type: 'destroyer', radius: 80 };
  SensorSystem.init();
  SensorSystem.setFogEnabled(true);
  SensorSystem.update(0.1, me, [near, far, ally], null, [], 0, { player2: null, wrecks: [] });
  const AW = SensorSystem.AWARENESS;
  assert.equal(near._sensorAwareness, AW.TRACKED);
  assert.equal(far._sensorAwareness, AW.HIDDEN);
  assert.equal(SensorSystem.hides(far), true);
  assert.equal(SensorSystem.hides(ally), false);
  assert.equal(SensorSystem.fogWorld.on, true);
  assert.ok(SensorSystem.fogWorld.count >= 2, 'statek i sojusznik w świecie mgły');
  assert.equal(SensorSystem.getSensorSources()[0].range, F.FOG_TUNE.vision.atlas, 'koło statku = wzrok');
  // zgubiony kontakt zostaje duchem
  near.x = 90000;
  SensorSystem.update(0.1, me, [near, far, ally], null, [], 0, null);
  assert.equal(SensorSystem.hides(near), true);
  assert.ok([...SensorSystem.getGhosts().values()].some((g) => g.x === 15000), 'duch w ostatniej znanej pozycji');
  SensorSystem.setFogEnabled(false);
  SensorSystem.update(0.1, me, [near, far, ally], null, [], 0, null);
  assert.equal(SensorSystem.hides(far), false);
  assert.equal(SensorSystem.fogWorld.on, false);
  SensorSystem.setFogEnabled(true);
  SensorSystem.init();
  delete window.ship;
});

test('wpięcie w grę: render, celowanie, HUD i post respektują mgłę (źródła)', () => {
  const html = read('index.html');
  assert.match(html, /const renderSeen = fogSeenInto\(renderEntities, _renderSeenList\);/);
  assert.match(html, /Bridge3D\.update\(renderSeen,/);
  assert.match(html, /updateShields3D\(PAUSED \? 0 : frameDt, renderSeen,/);
  assert.match(html, /syncShipModels3D\(\{ entities: renderSeen,/);
  assert.match(html, /setEntityHiddenTest\(\(e\) => SensorSystem\.hides\(e\)\);/);
  assert.match(html, /setWorld3DHiddenTest\(\(st\) => SensorSystem\.hides\(st\)\);/);
  assert.match(html, /isPlayerLockTargetInRange\(target\) && !SensorSystem\.hides\(target\);/, 'namiar tylko na widziane');
  assert.match(html, /if \(SensorSystem\.hides\(e\)\) return;   \/\/ mgła wojny: wieże/, 'wieże na auto nie strzelają w mgłę');
  assert.match(html, /SensorSystem\.revealEntity\(b\.source, FOG_FIRE_REVEAL_SEC\)/, 'ostrzał zdradza pozycję');
  assert.match(html, /Core3D\.setFogOfWar\(SensorSystem\.fogWorld\);/);
  assert.match(html, /data-fog-of-war="1"/, 'opcja w menu Nowa gra');
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /if \(entityHiddenTest && entityHiddenTest\(entity\)\) \{/);
  assert.match(hex, /if \(entity\.__hiddenFromView === true\) continue;   \/\/ mgła wojny: cień zdradzałby okręt/);
  // siatka zostaje (validSet przed testem) — bez przebudowy skóry na brzegu kręgu wzroku
  const loop = hex.slice(hex.indexOf('if (hasBody) validSet.add(entity);'), hex.indexOf('if (entityHiddenTest && entityHiddenTest(entity))'));
  assert.ok(loop.length > 0 && loop.length < 80);
  const core = read('src/3d/core3d.js');
  const render = core.slice(core.indexOf('\n  render() {'), core.indexOf('\n  _runScenePass('));
  assert.ok(render.indexOf('this._updateFogUniforms(freePerspective);') > render.indexOf('this.syncCamera(this.activeCam1, this.composerTarget.width'), 'rzut na kamerę TEGO renderu');
  assert.match(core, /if \(u\.uFogOn\) u\.uFogOn\.value = 0;/, 'tło menu bez mgły');
});
