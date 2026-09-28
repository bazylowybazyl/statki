// Wiązki pulsacyjne i laser PD (WeaponFx, zadanie 17). Dawniej każdy impuls to była grupa Three
// + 2 siatki + 2 materiały w scenie (weapon3DSystem.js, pula do 96 — audyt bitwy 2026-09-24,
// p. 2.2: tysiące strzałów PD na sekundę = setki grup i draw calli). Dziś impulsy siedzą
// w pierścieniu o stałej pojemności PULSE_CAP (nadpisywany najstarszy), rysuje je jeden draw
// call (BeamSystem), a strzał nie dokłada do sceny ani obiektu.
// node --test tests/pulseBeamPoolLimit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import * as THREE from 'three/webgpu';
import { Core3D } from '../src/3d/core3d.js';
import { FxFrame } from '../src/3d/fx/fxFrame.js';
import { WeaponFx, PULSE_CAP } from '../src/3d/weapons/weaponFx.js';
import { BEAM } from '../src/3d/weapons/beams.js';

// WeaponFx na scenie bez urządzenia (Node): pule, pierścienie i siatki powstają, render nie.
Core3D.isInitialized = true;
Core3D.scene = new THREE.Scene();
Core3D.fx = Core3D.fx || new FxFrame();
assert.ok(WeaponFx.ensure(), 'WeaponFx bez sceny Core3D');

const beam = { startX: 0, startY: 0, endX: 500, endY: 0, width: 5, mode: 'pulse', kind: 'pulse', emitterUid: null, hitEntity: null, nx: 0, ny: 0 };
const detail = { weaponId: 'beam_pulse', shooter: null, x: 0, y: 0, isBeam: true, beamMode: 'pulse', beam, dirX: 1, dirY: 0 };
function pulse(i, kind = 'pulse', weaponId = 'beam_pulse') {
  beam.startX = i; beam.endX = i + 500; beam.kind = kind;
  detail.x = i; detail.weaponId = weaponId;
  WeaponFx._onShot(detail);
}
const activePulses = () => WeaponFx._pulses.reduce((n, p) => n + (p.active ? 1 : 0), 0);

test('pierścień impulsów ma stałą pojemność PULSE_CAP, scena nie rośnie ze strzałami', () => {
  assert.ok(PULSE_CAP >= 96, 'nie mniej niż dawna pula (96)');
  assert.equal(WeaponFx._pulses.length, PULSE_CAP);
  const children = Core3D.scene.children.length;
  for (let i = 0; i < PULSE_CAP * 3; i++) pulse(i, i % 2 ? 'pd' : 'pulse', i % 2 ? 'laser_pd_mk1' : 'beam_pulse');
  assert.equal(WeaponFx._pulses.length, PULSE_CAP, 'pierścień nie rośnie');
  assert.equal(activePulses(), PULSE_CAP);
  assert.equal(Core3D.scene.children.length, children, 'strzał dołożył obiekt do sceny');
  assert.equal(WeaponFx.beams.mesh.parent, Core3D.scene, 'wiązki: jedna siatka w scenie');
});

test('po zapełnieniu nadpisywany jest najstarszy impuls (głowa pierścienia)', () => {
  WeaponFx.reset();
  for (let i = 0; i < PULSE_CAP; i++) pulse(i);
  const head = WeaponFx._pulseHead;
  const oldest = WeaponFx._pulses[head];
  assert.equal(oldest.x0, head, 'głowa wskazuje najstarszy impuls');
  pulse(123456, 'pd', 'laser_pd_mk1');
  assert.equal(oldest.x0, 123456, 'nowy impuls zajął miejsce najstarszego');
  assert.equal(oldest.style, BEAM.PD, 'laser PD — styl PD');
  assert.equal(WeaponFx._pulseHead, (head + 1) % PULSE_CAP);
  assert.equal(activePulses(), PULSE_CAP);
});

const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
test('strzał impulsem i laserem PD bez alokacji obiektów (po rozgrzewce JIT)', () => {
  WeaponFx.reset();
  const shot = (i) => { pulse(i & 1023); pulse(i & 1023, 'pd', 'laser_pd_mk1'); };
  for (let i = 0; i < 20000; i++) shot(i);
  let best = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < 2000; i++) shot(i);
    const d = newSpaceUsed() - before;
    if (d >= 0 && d < best) best = d;
  }
  // Wylot każdego impulsu to receptura (paczki GPU przez budowniczego — bez obiektów); zostaje
  // pakowanie liczb double w niewklejonych wywołaniach (jak w tests/weaponRecipes.test.mjs).
  assert.ok(best < 2000 * 600, `alokacja ${best} B na 2000 par strzałów (${(best / 2000).toFixed(0)} B na parę)`);
  WeaponFx.reset();
});
