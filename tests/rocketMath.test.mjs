// RW-23: lot rakiet po stronie gry bez three — src/game/rockets/rocketMath.js musi liczyć BIT W BIT jak three r183
// (Vector3, Quaternion.setFromUnitVectors, MathUtils), bo symulacja przeszła 1:1 z src/effects3d/rocketSystem3D.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Vec3, Quat, clamp, lerp, degToRad } from '../src/game/rockets/rocketMath.js';

let seed = 0x9e3779b9;
function rnd() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const r = (k = 1) => (rnd() * 2 - 1) * k;
const same = (a, b, msg) => assert.ok(Object.is(a, b), `${msg}: ${a} ≠ ${b}`);

test('Vec3 = THREE.Vector3 bit w bit (set, copy, multiplyScalar, addScaledVector, length, normalize, dot)', () => {
  for (let i = 0; i < 2000; i++) {
    const x = r(3000), y = r(400), z = r(3000), s = r(5), dt = rnd() / 30;
    const a = new Vec3(x, y, z), b = new THREE.Vector3(x, y, z);
    same(a.length(), b.length(), 'length');
    a.normalize(); b.normalize();
    same(a.x, b.x, 'nx'); same(a.y, b.y, 'ny'); same(a.z, b.z, 'nz');
    a.multiplyScalar(s); b.multiplyScalar(s);
    const va = new Vec3(r(900), r(90), r(900)), vb = new THREE.Vector3(va.x, va.y, va.z);
    a.addScaledVector(va, dt); b.addScaledVector(vb, dt);
    same(a.x, b.x, 'ax'); same(a.y, b.y, 'ay'); same(a.z, b.z, 'az');
    same(a.dot(va), b.dot(vb), 'dot');
    a.set(x, y); b.set(x, y);
    same(a.z, b.z, 'set bez z');
    a.copy(va); b.copy(vb);
    same(a.x, b.x, 'copy');
  }
  const zero = new Vec3(0, 0, 0).normalize();
  same(zero.x, 0, 'zerowy wektor'); same(zero.y, 0, 'zerowy wektor');
});

test('Quat.setFromUnitVectors = THREE.Quaternion bit w bit (także wektory przeciwne)', () => {
  const fwd = new Vec3(0, 1, 0), fwdT = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 2000; i++) {
    const az = r(Math.PI), el = r(1.2), ce = Math.cos(el);
    const d = new Vec3(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az)).normalize();
    const dT = new THREE.Vector3(d.x, d.y, d.z);
    const q = new Quat().setFromUnitVectors(fwd, d), qT = new THREE.Quaternion().setFromUnitVectors(fwdT, dT);
    same(q.x, qT.x, 'qx'); same(q.y, qT.y, 'qy'); same(q.z, qT.z, 'qz'); same(q.w, qT.w, 'qw');
  }
  for (const v of [[0, -1, 0], [1, 0, 0], [-0.6, 0, 0.8]]) {
    const from = new Vec3(...v), to = new Vec3(-v[0], -v[1], -v[2]);
    const q = new Quat().setFromUnitVectors(from, to);
    const qT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...v), new THREE.Vector3(-v[0], -v[1], -v[2]));
    same(q.x, qT.x, 'przeciwne x'); same(q.y, qT.y, 'przeciwne y'); same(q.z, qT.z, 'przeciwne z'); same(q.w, qT.w, 'przeciwne w');
  }
});

test('clamp / lerp / degToRad = THREE.MathUtils bit w bit', () => {
  for (let i = 0; i < 2000; i++) {
    const a = r(10), b = r(10), t = rnd();
    same(clamp(a, -1, 1.5), THREE.MathUtils.clamp(a, -1, 1.5), 'clamp');
    same(lerp(a, b, t), THREE.MathUtils.lerp(a, b, t), 'lerp');
    same(degToRad(a * 90), THREE.MathUtils.degToRad(a * 90), 'degToRad');
  }
});

test('symulacja rakiet w grze: bez three i bez obrazu (efekty przez wstrzyknięty reżyser)', () => {
  const src = readFileSync(new URL('../src/game/rockets/rocketSim.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from ["']three|THREE\./);
  assert.doesNotMatch(src, /from ["'][^"']*\/3d\//, 'gra nie importuje renderu');
});
