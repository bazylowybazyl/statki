import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tryby okrętu pod ŚPM (src/game/shipModes.js), jeden celownik broni (src/ui/weaponReticle.js)
// i postawa w napędzie (src/game/flight/driveTransmission.js) — przebudowa celownika 2026-10-03.
const {
  SHIP_MODE_IDS, SHIP_MODE_DEFS, SHIP_STANCE_TUNE, SHIP_MODE_TAP, createShipModes, stanceTune, resolveShipMode,
  shipModeFromWheelVector, openShipModeWheel, releaseShipModeWheel
} = await import('../src/game/shipModes.js');
const { FC_TURRET } = await import('../src/game/fireControl.js');
const { orderRingTurrets, drawArcCompass, drawWeaponReticle } = await import('../src/ui/weaponReticle.js');
const { createDriveTransmission, applyDriveSpeedGovernor } = await import('../src/game/flight/driveTransmission.js');

test('koło trybów: siedem sektorów od góry zgodnie z zegarem, środek bez wyboru', () => {
  assert.deepEqual([...SHIP_MODE_IDS], ['combat', 'shield', 'cruise', 'cloak', 'torpedo', 'mining', 'fleet']);
  for (const id of SHIP_MODE_IDS) assert.equal(SHIP_MODE_DEFS[id].id, id);
  assert.equal(shipModeFromWheelVector(0, 0), -1);
  assert.equal(shipModeFromWheelVector(10, -10), -1, 'martwa strefa');
  assert.equal(shipModeFromWheelVector(0, -100), 0, 'góra = BOJOWY');
  const step = (Math.PI * 2) / SHIP_MODE_IDS.length;
  for (let i = 0; i < SHIP_MODE_IDS.length; i++) {
    const a = -Math.PI / 2 + i * step;
    assert.equal(shipModeFromWheelVector(Math.cos(a) * 100, Math.sin(a) * 100), i, SHIP_MODE_IDS[i]);
  }
});

test('puszczenie ŚPM: sektor wybiera tryb, stuknięcie wraca do poprzedniego', () => {
  const m = createShipModes();
  resolveShipMode(m, {});
  m.stance = 'shield';
  resolveShipMode(m, {});
  assert.equal(m.current, 'shield');
  assert.equal(m.previous, 'combat');

  openShipModeWheel(m, 500, 400, 10);
  m.wheel.hover = SHIP_MODE_IDS.indexOf('cruise');
  assert.equal(releaseShipModeWheel(m, 10.5), 'cruise');
  assert.equal(m.wheel.open, false);

  openShipModeWheel(m, 500, 400, 20);
  assert.equal(releaseShipModeWheel(m, 20 + SHIP_MODE_TAP * 0.5), 'combat', 'stuknięcie = poprzedni tryb');
  openShipModeWheel(m, 500, 400, 30);
  assert.equal(releaseShipModeWheel(m, 30 + SHIP_MODE_TAP * 2), null, 'przytrzymanie bez sektora nic nie zmienia');
  openShipModeWheel(m, 500, 400, 40);
  m.wheel.hover = SHIP_MODE_IDS.indexOf('shield');
  assert.equal(releaseShipModeWheel(m, 41), null, 'sektor bieżącego trybu nic nie zmienia');
});

test('tryb widoczny: systemy gry wygrywają z postawą, postawa wraca po ich wyłączeniu', () => {
  const m = createShipModes();
  m.stance = 'cruise';
  assert.equal(resolveShipMode(m, { cloak: true }), 'cloak');
  assert.equal(resolveShipMode(m, { cloak: true, torpedo: true }), 'torpedo');
  assert.equal(resolveShipMode(m, { torpedo: true, mining: true }), 'mining');
  assert.equal(resolveShipMode(m, { mining: true, fleet: true }), 'fleet');
  assert.equal(resolveShipMode(m, {}), 'cruise');
  assert.equal(m.previous, 'fleet');
});

test('postawy: TARCZE kosztem napędu, PRZELOT szybciej z zimną bronią, BOJOWY bez zmian', () => {
  const combat = SHIP_STANCE_TUNE.combat;
  for (const k of ['speed', 'thrust', 'turn', 'shieldRegen', 'shieldDelay', 'shieldTaken']) assert.equal(combat[k], 1, k);
  assert.equal(combat.weaponsCold, false);
  const shield = SHIP_STANCE_TUNE.shield;
  assert.ok(shield.shieldRegen > 1 && shield.shieldDelay < 1 && shield.shieldTaken < 1);
  assert.ok(shield.speed < 1 && shield.thrust < 1 && shield.turn < 1);
  assert.equal(shield.weaponsCold, false);
  // 2026-10-05: TARCZE — pole znacznie twardsze i widoczne, okręt ZNACZNIE wolniejszy i ociężały.
  assert.ok(shield.shieldHardness >= 2 && shield.shieldShow === true);
  assert.ok(shield.speed <= 0.5 && shield.thrust <= 0.6 && shield.turn <= 0.6 && shield.turnRate < 1);
  for (const k of ['turnRate', 'shieldHardness']) assert.equal(combat[k], 1, k);
  assert.equal(combat.shieldShow, false, 'domyślnie tarcza niewidoczna');
  assert.equal(SHIP_STANCE_TUNE.cruise.shieldShow, false);
  const cruise = SHIP_STANCE_TUNE.cruise;
  assert.ok(cruise.speed > 1 && cruise.thrust > 1);
  assert.equal(cruise.weaponsCold, true);
  const m = createShipModes();
  m.stance = 'cloak';
  assert.equal(stanceTune(m), combat, 'tryb bez postawy = nastawy bojowe');
});

test('PRZELOT na biegach: Atlas 500 → 750 / 1000 / 1250 / 1500 j/s, w górę przy gazie pod limitem, w dół bez gazu i Ctrl', async () => {
  const { CRUISE_GEARS, cruiseGearMul, stepCruiseGear, shiftCruiseGearDown } = await import('../src/game/shipModes.js');
  assert.deepEqual([...CRUISE_GEARS.muls].map((m) => m * 500), [750, 1000, 1250, 1500]);
  const m = createShipModes();
  assert.equal(stepCruiseGear(m, 1000, 500, 1, 1), null, 'poza PRZELOTEM bez biegów');
  m.stance = 'cruise';
  assert.equal(m.cruiseGear, 1);
  assert.equal(stepCruiseGear(m, 600, 500, 1, 0.1), null, 'pod limitem biegu');
  assert.equal(stepCruiseGear(m, 740, 500, 1, 0.1), 'up');
  assert.equal(m.cruiseGear, 2);
  assert.equal(stepCruiseGear(m, 990, 500, 1, 0.1), null, 'odstęp między zmianami');
  let ev = null;
  for (let i = 0; i < 20 && !ev; i++) ev = stepCruiseGear(m, 990, 500, 1, 0.1);
  assert.equal(ev, 'up');
  assert.equal(cruiseGearMul(m.cruiseGear) * 500, 1250);
  m.cruiseShiftCd = 0;
  assert.equal(stepCruiseGear(m, 400, 500, 0, 0.1), 'down', 'bez gazu, wolno — w dół');
  m.cruiseShiftCd = 0;
  assert.equal(shiftCruiseGearDown(m), true);
  assert.equal(m.cruiseGear, 1);
  assert.equal(shiftCruiseGearDown(m), false);
  assert.equal(cruiseGearMul(99), 3, 'najwyższy bieg = 3 × limit bojowy');
});

test('postawa w napędzie: regulator trzyma limit × stanceLimit, zryw szarży nadal wygrywa', () => {
  const st = createDriveTransmission({ hullClass: 'battleship' });
  st.speedLimit = 500;
  st.governorDeceleration = 1e9;
  const v = { x: 2000, y: 0 };
  st.stanceLimit = SHIP_STANCE_TUNE.cruise.speed;
  applyDriveSpeedGovernor(st, v, 1);
  assert.ok(Math.abs(v.x - 500 * SHIP_STANCE_TUNE.cruise.speed) < 1e-6, `PRZELOT: ${v.x}`);
  st.stanceLimit = SHIP_STANCE_TUNE.shield.speed;
  applyDriveSpeedGovernor(st, v, 1);
  assert.ok(Math.abs(v.x - 500 * SHIP_STANCE_TUNE.shield.speed) < 1e-6, `TARCZE: ${v.x}`);
  st.burnLimit = 3000;
  v.x = 2500;
  applyDriveSpeedGovernor(st, v, 1);
  assert.equal(v.x, 2500, 'szarża podnosi limit ponad postawę');
});

const turret = (x, y, state, progress = 1, arcC = 0, arcH = Math.PI) => ({ x, y, state, progress, left: 0, arcC, arcH });

test('pierścień celownika: prawa burta od dziobu, potem lewa od rufy (bez alokacji tablicy)', () => {
  const list = [
    turret(-550, -250, FC_TURRET.READY), turret(-550, 250, FC_TURRET.READY),
    turret(-800, -350, FC_TURRET.READY), turret(-800, 350, FC_TURRET.READY),
    turret(-1100, -300, FC_TURRET.READY), turret(-1100, 300, FC_TURRET.READY)
  ];
  const out = [];
  const n = orderRingTurrets(list, list.length, out);
  assert.equal(n, 6);
  assert.deepEqual(out.map((t) => [t.x, Math.sign(t.y)]), [
    [-550, 1], [-800, 1], [-1100, 1], [-1100, -1], [-800, -1], [-550, -1]
  ]);
  const again = orderRingTurrets(list, 3, out);
  assert.equal(again, 3);
  assert.equal(out.length, 3, 'tablica wielokrotnego użytku przycięta');
});

// Atrapa kontekstu 2D: liczy łuki według koloru (kompas) i napisy.
function fakeCtx() {
  const log = { arcs: [], text: [] };
  const ctx = {
    log, globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    lineCap: '', shadowColor: '', shadowBlur: 0,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {}, translate() {}, rotate() {},
    arc(x, y, r, a0, a1) { this._arc = { r, a0, a1 }; },
    stroke() { if (this._arc) log.arcs.push({ ...this._arc, color: this.strokeStyle, width: this.lineWidth }); this._arc = null; },
    fillText(t) { log.text.push(String(t)); },
    measureText(t) { return { width: String(t).length * 8 }; }
  };
  return ctx;
}

test('kompas łuków: liczba wież sięgających kursora (bateria 270° Atlasa — burty po 3, dziób 6)', () => {
  // Łuki baterii Atlasa: środek w burtę (±90°), połowa 135°.
  const half = Math.PI * 0.75;
  const list = [];
  for (let i = 0; i < 3; i++) list.push(turret(-600 - i * 250, 300, FC_TURRET.READY, 1, Math.PI / 2, half));
  for (let i = 0; i < 3; i++) list.push(turret(-600 - i * 250, -300, FC_TURRET.READY, 1, -Math.PI / 2, half));
  const at = (bearing) => drawArcCompass(fakeCtx(), 0, 0, 100, 0, list, list.length, bearing, 1);
  assert.equal(at(0), 6, 'dziób');
  assert.equal(at(Math.PI), 6, 'rufa');
  assert.equal(at(Math.PI / 2), 3, 'prawa burta');
  assert.equal(at(-Math.PI / 2), 3, 'lewa burta');
  assert.equal(at(NaN), -1, 'bez kursora');
  // Okręt obrócony o 90°: dziób w dół ekranu.
  assert.equal(drawArcCompass(fakeCtx(), 0, 0, 100, Math.PI / 2, list, list.length, Math.PI / 2, 1), 6);
  // Martwy kierunek rysowany na czerwono.
  const one = [turret(0, 300, FC_TURRET.READY, 1, Math.PI / 2, Math.PI / 4)];
  const ctx = fakeCtx();
  drawArcCompass(ctx, 0, 0, 100, 0, one, 1, 0, 1);
  assert.ok(ctx.log.arcs.some((a) => a.color === '#ff4d5e'), 'martwe kierunki');
  assert.ok(ctx.log.arcs.some((a) => a.color === '#52ff9a'), 'kierunki z pokryciem');
});

test('celownik: gotowe / przeładowanie / poza łukiem — liczba i druga linia', () => {
  const list = [
    turret(0, 1, FC_TURRET.READY), turret(0, 2, FC_TURRET.RELOAD, 0.4),
    turret(0, -1, FC_TURRET.NO_ARC), turret(0, -2, FC_TURRET.TRAVERSE)
  ];
  list[1].left = 1.84;
  let ctx = fakeCtx();
  assert.equal(drawWeaponReticle(ctx, 0, 0, list, 4, { distance: 12400 }), 1);
  assert.ok(ctx.log.text.includes('1') && ctx.log.text.includes('/4') && ctx.log.text.includes('12,4 km'), ctx.log.text.join('|'));
  // Przeładowanie wypełnia część segmentu na czerwono.
  assert.ok(ctx.log.arcs.some((a) => a.color === '#ff4d5e'));

  list[0].state = FC_TURRET.RELOAD; list[0].left = 3; list[0].progress = 0.2;
  list[3].state = FC_TURRET.RELOAD; list[3].left = 0.9; list[3].progress = 0.8;
  ctx = fakeCtx();
  assert.equal(drawWeaponReticle(ctx, 0, 0, list, 4, { distance: 1000 }), 0);
  assert.ok(ctx.log.text.includes('za 0,9 s'), 'czas do najbliższej wieży w łuku');

  const out = [turret(0, 1, FC_TURRET.NO_ARC), turret(0, -1, FC_TURRET.NO_ARC)];
  ctx = fakeCtx();
  drawWeaponReticle(ctx, 0, 0, out, 2, { distance: 1000 });
  assert.ok(ctx.log.text.includes('POZA ŁUKIEM'));

  ctx = fakeCtx();
  drawWeaponReticle(ctx, 0, 0, list, 4, { distance: 1000, cold: true, tag: 'PRZELOT — BROŃ ZIMNA' });
  assert.ok(!ctx.log.text.includes('/4'), 'broń zimna — bez licznika');
  assert.ok(ctx.log.text.includes('PRZELOT — BROŃ ZIMNA'));
});

test('index.html: ŚPM otwiera koło trybów, dawne tryby celownika i opcja „Klasyczne” usunięte', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /TARGETING_MODE|targetingMode\b|confirmTargetingSelection|data-fire-control|isFireControlCommand/);
  assert.match(html, /openShipModeWheelAt\(mouse\.x, mouse\.y\)/);
  assert.match(html, /closeShipModeWheel\(\)/);
  // PRZELOT: broń zimna przez kierowanie ogniem, TARCZE: tarcza przyjmuje mniej.
  assert.match(html, /env\.canFire = [^;]*!stanceTune\(shipModes\)\.weaponsCold/);
  assert.match(html, /amount \* taken/);
  assert.match(html, /stanceTune\(shipModes\)\.shieldRegen/);
  assert.match(html, /stanceTune\(shipModes\)\.turn/);
  assert.match(html, /applyShipStance\(dt\)/);
  // PRZELOT na biegach (QOL 2026-10-03): limit z biegu, Ctrl redukuje; warp bez biegów.
  assert.match(html, /driveState\.stanceLimit = cruiseGearMul\(shipModes\.cruiseGear\);/);
  assert.match(html, /shiftCruiseGearDown\(shipModes\)/);
  assert.doesNotMatch(html, /gearSpeeds|shiftWarpGearUp|setWarpGear/);
});
