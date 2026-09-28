// Zadanie 23 portu WebGPU: kopie CPU buforów storage liczonych wyłącznie na GPU (src/3d/tsl/kopiaCpu.js) —
// dym i mgławica rakiet, ośrodek warpa, pule efektów broni i iskry pasa trzymały ~140 MB tablic, które three
// wysyła raz (przy utworzeniu bufora) i nigdy więcej nie czyta. Kopia oddana, gdy bufor GPU już istnieje;
// liczba elementów (węzły storage budowane później) bez zmian. Bez GPU (atrapa backendu).
// node --test tests/kopiaCpu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instancedArray } from 'three/tsl';
import { oddajKopieCpu, stanKopiiCpu } from '../src/3d/tsl/kopiaCpu.js';

const code = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fakeRenderer(withBuffer) {
  const data = new WeakMap();
  return {
    backend: {
      get(o) { let d = data.get(o); if (!d) data.set(o, (d = {})); return d; },
      create(attr) { this.get(attr).buffer = { size: attr.array.byteLength }; }
    },
    withBuffer
  };
}

test('kopia CPU oddana dopiero, gdy bufor GPU istnieje; liczba elementów bez zmian; raz', () => {
  const r = fakeRenderer();
  const a = instancedArray(1024, 'vec4');
  const b = instancedArray(512, 'vec4');
  const count0 = a.value.count;
  const before = stanKopiiCpu.oddaneBajty;
  assert.equal(oddajKopieCpu(r, [a, b]), 2, 'bez buforów GPU — obie kopie zostają (wołaj ponownie)');
  assert.equal(a.value.array.length, 1024 * 4);
  r.backend.create(a.value);
  assert.equal(oddajKopieCpu(r, [a, b]), 1, 'a oddana, b czeka na bufor');
  assert.equal(a.value.array.length, 4, 'atrapa: jeden element (itemSize)');
  assert.ok(a.value.array instanceof Float32Array);
  assert.equal(a.value.count, count0, 'liczba elementów z konstrukcji zostaje (rozmiar tablicy WGSL)');
  assert.equal(stanKopiiCpu.oddaneBajty - before, 1024 * 16);
  r.backend.create(b.value);
  assert.equal(oddajKopieCpu(r, [a, b]), 0);
  assert.equal(stanKopiiCpu.oddaneBajty - before, 1024 * 16 + 512 * 16, 'a nie liczona drugi raz');
  assert.equal(oddajKopieCpu({}, [a]), 1, 'bez backendu — nic');
});

test('bufory tylko GPU oddają kopie: dym i mgławica rakiet, ośrodek warpa, pule broni, iskry pasa', () => {
  const rocket = code('src/3d/rockets/rocketFx.js');
  assert.match(rocket, /this\._gpuOnly = \[s\.sP, s\.sV, s\.sC, s\.sD, s\.sL, s\.sM, n\.nA, n\.nB, n\.nC, n\.nD, n\.nE\];/);
  assert.doesNotMatch(rocket.slice(rocket.indexOf('this._gpuOnly = ['), rocket.indexOf('this._gpuOnly = [') + 200), /s\.q\b/, 'kolejka zleceń dymu (pisze ją CPU) zostaje');
  assert.match(rocket, /if \(this\._kopieCpu > 0\) this\._kopieCpu = oddajKopieCpu\(ctx\.renderer, this\._gpuOnly\);/);
  const gpu = code('src/3d/weapons/gpuFx.js');
  assert.match(gpu, /this\.poolList\.map\(\(p\) => p\.buf\)/, 'stan cząstek pul (paczki pisze CPU — zostają)');
  const med = code('src/3d/warp/medium.js');
  assert.match(med, /\[this\.pos, this\.vel, this\.aux, this\.vis\]/);
  const sp = code('src/3d/asteroids/sparks.js');
  assert.match(sp, /\[this\.pos, this\.vel, this\.col\]/);
  // CPU nie pisze do tych buforów (wysyłka atrapy nadpisałaby początek bufora GPU)
  for (const [src, names] of [[code('src/3d/rockets/smoke.js'), ['sP', 'sV', 'sC', 'sD', 'sL', 'sM']], [code('src/3d/rockets/nebula.js'), ['nA', 'nB', 'nC', 'nD', 'nE']]]) {
    for (const n of names) assert.doesNotMatch(src, new RegExp(`this\\.${n}\\.value\\.(array|needsUpdate)`), `${n}: bez zapisu CPU`);
  }
});
