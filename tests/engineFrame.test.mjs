// Lista dysz MAIN tej klatki per okręt (EngineFrame, 2026-10-05) — źródło poświaty dysz na pyle kosmicznym
// (src/3d/dust/spaceDust.js: writeDustPlumes). Pisze ją EngineVfxSystem (engineVfxSystem.js).
// node --test tests/engineFrame.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EngineFrame, ENGINE_FRAME_CAP } from '../src/3d/engineFrame.js';

const X0 = 6013169.37;
const Y0 = -4734110.81;

// Okręt z czterema dyszami na rufie: środek gromady (sx, sy), kurs `ang` (scena), wydech przeciwnie do kursu.
function pushShip(entity, sx, sy, vx, vy, ang, power, pal = 1) {
  const fx = Math.cos(ang);
  const fy = Math.sin(ang);
  EngineFrame.beginShip(entity, vx, vy, true);
  for (const off of [-90, -30, 30, 90]) EngineFrame.nozzle(sx - fy * off, sy + fx * off, -fx, -fy, 12, power, pal);
  return EngineFrame.endShip();
}

test('EngineFrame: gromada dysz → środek, kierunek wydechu, rozrzut, moc średnia; bez martwych referencji', () => {
  EngineFrame.begin();
  const e = {};
  const k = pushShip(e, X0, Y0, 500, 0, 0, 0.8);
  assert.equal(k, 0);
  assert.equal(EngineFrame.count, 1);
  assert.ok(Math.abs(EngineFrame.x[0] - X0) < 1e-6 && Math.abs(EngineFrame.y[0] - Y0) < 1e-6, 'środek gromady (double)');
  assert.ok(Math.abs(EngineFrame.dirX[0] + 1) < 1e-6 && Math.abs(EngineFrame.dirY[0]) < 1e-6, 'wydech za rufę');
  assert.ok(Math.abs(EngineFrame.spread[0] - 102) < 1e-3, 'rozrzut = skrajna dysza + promień');
  assert.ok(Math.abs(EngineFrame.radius[0] - 24) < 1e-3, 'dysza równoważna √Σr²');
  assert.ok(Math.abs(EngineFrame.power[0] - 0.8) < 1e-6);
  assert.equal(EngineFrame.palette[0], 1);
  assert.equal(EngineFrame.indexOf(e), 0);
  // okręt bez dysz MAIN — bez wpisu
  EngineFrame.beginShip({}, 0, 0, false);
  assert.equal(EngineFrame.endShip(), -1);
  assert.equal(EngineFrame.count, 1);
  const serial = EngineFrame.serial;
  EngineFrame.begin();
  assert.equal(EngineFrame.count, 0);
  assert.equal(EngineFrame.entity[0], null, 'nowa klatka nie trzyma okrętu poprzedniej');
  assert.equal(EngineFrame.serial, serial + 1);
  // limit listy
  for (let i = 0; i < ENGINE_FRAME_CAP + 5; i++) pushShip({ i }, X0, Y0, 0, 0, 0, 1);
  assert.equal(EngineFrame.count, ENGINE_FRAME_CAP);
  // NaN w dyszy — pominięta, wpis bez NaN
  EngineFrame.begin();
  EngineFrame.beginShip(e, 0, 0, false);
  EngineFrame.nozzle(NaN, Y0, -1, 0, 12, 1, 0);
  EngineFrame.nozzle(X0, Y0, -1, 0, 12, 1, 0);
  EngineFrame.endShip();
  assert.equal(EngineFrame.count, 1);
  assert.ok(Number.isFinite(EngineFrame.x[0]) && Number.isFinite(EngineFrame.spread[0]));
});

test('engineVfxSystem wypełnia EngineFrame: początek klatki, okręt, dysza MAIN z mocą strugi × maskowanie', () => {
  const src = readFileSync(new URL('../src/3d/engineVfxSystem.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /import \{ EngineFrame \} from '\.\/engineFrame\.js';/);
  assert.match(src, /MainExhaust3D\.begin\([^)]*\);\n\s*EngineFrame\.begin\(\);/, 'lista czyszczona raz na klatkę');
  assert.match(src, /EngineFrame\.beginShip\(entity,/);
  assert.match(src, /EngineFrame\.nozzle\(nozzleWorldX, nozzleWorldY, dirX, dirY, nozzleR,\s*\n\s*warpOn \|\| isHulk \? 0 : \(Number\(item\.main\.power\) \|\| 0\) \* cloakVis, p\.palette\);/,
    'moc = moc strugi po rampie × widoczność maskowania (ukryty okręt nie świeci)');
  assert.match(src, /EngineFrame\.endShip\(\);\n\}/, 'koniec okrętu po pętli dysz');
});

test('EngineFrame.side: dysze SIDE z ciągiem — lista płaska (próg mocy, NaN, zdublowany marker), czyszczona w begin', async () => {
  const { ENGINE_FRAME_SIDE_MIN } = await import('../src/3d/engineFrame.js');
  EngineFrame.begin();
  assert.equal(EngineFrame.sdN, 0);
  const from = EngineFrame.sdN;
  assert.equal(EngineFrame.side(X0, Y0, 1, 0, 15, 0.6, 100, -50, from), 0);
  assert.equal(EngineFrame.side(X0 + 1, Y0, 1, 0, 15, 0.9, 100, -50, from), 0, 'ten sam wylot (zdublowany marker edytora) — jedna dysza');
  assert.ok(Math.abs(EngineFrame.sdP[0] - 0.9) < 1e-6, 'moc większa z dwóch');
  assert.equal(EngineFrame.side(X0 + 200, Y0, -1, 0, 15, ENGINE_FRAME_SIDE_MIN * 0.5, 0, 0, from), -1, 'poniżej progu (płomyk dyżurny) — bez wpisu');
  assert.equal(EngineFrame.side(NaN, Y0, -1, 0, 15, 1, 0, 0, from), -1);
  assert.equal(EngineFrame.side(X0 + 200, Y0, -1, 0, 15, 1.4, 0, 0, from), 1);
  assert.ok(Math.abs(EngineFrame.sdX[1] - (X0 + 200)) < 1e-6 && Math.abs(EngineFrame.sdY[1] - Y0) < 1e-6, 'wylot w double');
  assert.equal(EngineFrame.sdP[1], 1, 'moc obcięta do 1');
  assert.equal(EngineFrame.sdVX[0], 100);
  assert.equal(EngineFrame.sdVY[0], -50);
  assert.equal(EngineFrame.count, 0, 'dysze SIDE nie tworzą wpisu gromady MAIN');
  EngineFrame.begin();
  assert.equal(EngineFrame.sdN, 0, 'nowa klatka — pusta lista SIDE');
});

test('engineVfxSystem: dysza SIDE z ciągiem na listę EngineFrame.side — wylot dzwonu, moc strugi × maskowanie, bez hulka', () => {
  const src = readFileSync(new URL('../src/3d/engineVfxSystem.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const sideGasFrom = EngineFrame\.sdN;/, 'początek dysz SIDE okrętu (zdublowane markery łączą się)');
  assert.match(src, /if \(!isHulk\) EngineFrame\.side\(flameX, flameY, dirX, dirY, sideNozzleR, jetPower \* cloakVis, shipSceneVX, shipSceneVY, sideGasFrom\);\n\s*if \(cloakVis <= 0\.01\) continue;/,
    'po automacie dyszy (jetPower), przed odrzuceniem dysz ukrytych');
});
