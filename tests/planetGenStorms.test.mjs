// Burze planet generatora (src/3d/planetGen/planetGenStorms.js): układy burzowe z ziarna i błyski piorunów jako
// funkcja czasu; wpięcie w bryłę chmur, cień na gruncie i krok czasu planety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planetStorms, stormFlashes, rotateY, STORM_MAX, FLASH_MAX, FLASH_SLOT, FLASH_LENGTH
} from '../src/3d/planetGen/planetGenStorms.js';
import { describePlanet } from '../src/3d/planetGen/planetGenSpec.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const len = (v) => Math.hypot(v[0], v[1], v[2]);

test('układy burzowe: z ziarna, powtarzalne, w granicach; pył bez burz', () => {
  const spec = describePlanet({ type: 'terran', seed: 21 });
  const a = planetStorms(spec);
  const b = planetStorms(describePlanet({ type: 'terran', seed: 21 }));
  assert.deepEqual(a, b, 'to samo ziarno — te same burze');
  assert.ok(a.length >= 2 && a.length <= STORM_MAX, `liczba burz ${a.length}`);
  for (const s of a) {
    assert.ok(Math.abs(len(s.dir) - 1) < 1e-9, 'kierunek jednostkowy');
    assert.ok(s.radius >= 0.075 && s.radius <= 0.14, `promień ${s.radius}`);
    assert.ok(s.rate > 0 && s.rate <= 1);
    assert.ok(Math.abs(Math.asin(s.dir[1])) < 57 * Math.PI / 180, 'tropiki albo średnie szerokości');
  }
  assert.notDeepEqual(planetStorms(describePlanet({ type: 'terran', seed: 22 })), a, 'inne ziarno — inne burze');
  // różne ziarna: nigdy ponad STORM_MAX (tyle uniformów ma bryła chmur)
  for (let seed = 1; seed < 40; seed++) assert.ok(planetStorms(describePlanet({ type: 'ocean', seed })).length <= STORM_MAX);
  assert.deepEqual(planetStorms({ seed: 5, type: 'desert', clouds: { style: 2 } }), [], 'pył — bez burz');
  assert.deepEqual(planetStorms({ seed: 5, type: 'barren', clouds: null }), [], 'bez chmur — bez burz');
});

test('błyski piorunów: funkcja czasu (bez stanu), w tarczy burzy i w chmurze, gasną między wyładowaniami', () => {
  const storms = planetStorms(describePlanet({ type: 'terran', seed: 21 }));
  const base = 1.003; const thick = 0.014;
  const o1 = new Float32Array(FLASH_MAX * 4);
  const o2 = new Float32Array(FLASH_MAX * 4);
  let lit = 0; let dark = 0; let peak = 0; let starts = 0; let prev = 0;
  const N = 3000;      // 60 s co 20 ms
  for (let i = 0; i < N; i++) {
    const t = i * 0.02;
    const n = stormFlashes(storms, t, { seed: 21, base, thick, out: o1 });
    stormFlashes(storms, t, { seed: 21, base, thick, out: o2 });
    assert.deepEqual(o1, o2, 'ta sama chwila — te same błyski');
    assert.ok(n <= FLASH_MAX);
    let sum = 0;
    for (let k = 0; k < FLASH_MAX; k++) {
      const w = o1[k * 4 + 3];
      if (!(w > 0)) continue;
      sum += w;
      assert.ok(w <= 1.7, `jasność błysku ${w}`);
      const p = [o1[k * 4], o1[k * 4 + 1], o1[k * 4 + 2]];
      const r = len(p);
      assert.ok(r > base + thick * 0.25 && r < base + thick * 0.65, `błysk w środku chmury: promień ${r}`);
      // w tarczy którejś burzy (0,75 promienia + zapas zaokrągleń)
      assert.ok(storms.some((s) => Math.acos(Math.min(1, (p[0] * s.dir[0] + p[1] * s.dir[1] + p[2] * s.dir[2]) / r)) <= s.radius * 0.76));
    }
    if (sum > 0.05) lit++; else dark++;
    if (sum > 0.3 && prev <= 0.3) starts++;
    peak = Math.max(peak, sum);
    prev = sum;
  }
  assert.ok(lit > N * 0.05 && dark > N * 0.2, `błyska ${lit} z ${N} próbek, ciemno ${dark}`);
  assert.ok(starts > 20 && starts < 600, `rozbłyski na minutę: ${starts}`);
  assert.ok(peak > 0.8, `najjaśniejsza chwila ${peak}`);
  // bez burz i przed czasem zero — nic
  assert.equal(stormFlashes([], 3.3, { out: o1 }), 0);
  assert.ok(o1.every((v) => v === 0));
  assert.ok(FLASH_LENGTH > FLASH_SLOT * 0.7, 'okno poprzednie obejmuje trwający błysk');
});

test('obrót wokół osi planety jak w grafie chmur: (0, 0, 1) → (sin a, 0, cos a)', () => {
  const r = rotateY([0, 0, 1], 0.3);
  assert.ok(Math.abs(r[0] - Math.sin(0.3)) < 1e-12 && Math.abs(r[2] - Math.cos(0.3)) < 1e-12 && r[1] === 0);
  const back = rotateY(rotateY([0.3, 0.5, -0.8], 0.7), -0.7);
  assert.ok(Math.abs(back[0] - 0.3) < 1e-12 && Math.abs(back[2] + 0.8) < 1e-12);
});

test('wpięcie: bryła chmur, cień na gruncie i krok czasu planety dostają burze; moduł bez Math.random', () => {
  const mod = read('src/3d/planetGen/planetGenStorms.js');
  assert.doesNotMatch(mod, /Math\.random\(/);
  assert.doesNotMatch(mod, /from 'three/);
  const vol = read('src/3d/planetGen/planetGenCloudVolume.tsl.js');
  assert.match(vol, /export function stormAt\(dir, storms, edge, scale = 1\)/);
  assert.match(vol, /export const stormCover = /);
  assert.match(vol, /If\(flashOn\.greaterThan\(0\.001\)/, 'błyski tylko, gdy któryś świeci');
  // błysk poza gałęzią światła słońca — widać go także po nocnej stronie
  assert.ok(vol.indexOf('If(flashOn.greaterThan(0.001)') > vol.indexOf('If(mu.greaterThan(-0.2)'));
  const srf = read('src/3d/planetGen/planetGenSurfaceNear.tsl.js');
  assert.match(srf, /stormAt\(dc, gStorms, regS\.w\)/, 'cień burzy na gruncie z tych samych układów');
  const near = read('src/3d/planetGen/planetGenNear.js');
  assert.match(near, /stormFlashes\(stormsNow, stormClock/);
  assert.match(near, /bandRateAt\(/, 'wiatr pasa szerokości przenosi burzę');
  // „brak” burzy i błysku: wektor niezerowy (pułapka 46 — wektor samych zer zostaje po kompilacji przy starej wartości)
  assert.match(vol, /uCvSt\$\{i\}`, \{ value: new THREE\.Vector4\(0, 1, 0, 0\) \}/);
  assert.match(vol, /uCvFl\$\{i\}`, \{ value: new THREE\.Vector4\(2, 0, 0, 0\) \}/);
});
