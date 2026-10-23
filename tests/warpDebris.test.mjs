// Smugi skał pasa w skoku (2026-10-19, src/3d/asteroids/warpDebris.js): gęstość z pola pasa, pula skał w przestrzeni
// widocznej warpa (wlot z przodu pudła, uzupełnienie braku w całym pudle, gaśnięcie nadmiaru), wektor smugi; wpięcie
// w pas (tryb skoku z prędkości kamery, pole wyłączone, kadr pola obejmuje obrócony kadr).
// node --test tests/warpDebris.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WarpDebris, WARP_DEBRIS, WARP_DEBRIS_LOOKS, WARP_DEBRIS_LOOK_DEFAULT, warpDebrisDensity } from '../src/3d/asteroids/warpDebris.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('gęstość smug: poza pasem 0, w paśmie minimum z obwiedni, pola rodzin do pełnej puli', () => {
  assert.equal(warpDebrisDensity({ weight: 0, density: 0 }, 1), 0);
  assert.ok(Math.abs(warpDebrisDensity({ weight: 1, density: 0 }, 1) - WARP_DEBRIS.bandFloor) < 1e-12, 'rzadki pas');
  assert.ok(Math.abs(warpDebrisDensity({ weight: 0.5, density: 0 }, 1) - WARP_DEBRIS.bandFloor * 0.5) < 1e-12);
  assert.equal(warpDebrisDensity({ weight: 1, density: 1 }, 1), 1, 'rdzeń pola');
  assert.ok(warpDebrisDensity({ weight: 1, density: 0.25 }, 1) === 0.5, 'pierwiastek gęstości względnej');
  assert.equal(warpDebrisDensity({ weight: 1, density: 4 }, 1), 1, 'sufit');
});

function rig(macro) {
  const drawn = { list: null, origin: null, visible: false, updates: 0 };
  const set = {
    group: {}, enabled: false,
    setVisible(v) { this.enabled = !!v; drawn.visible = !!v; },
    set(list) { drawn.list = list; },
    setOrigin(x, y) { drawn.origin = [x, y]; },
    update() { drawn.updates++; }
  };
  const vec = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  const material = { smear: { vec: { value: vec } } };
  const field = { m: macro, sampleMacro() { return this.m; }, maxDensity: 1 };
  const deb = new WarpDebris({ material, field, set });
  const frame = { cam: { zoom: 0.1 }, viewW: 1600, viewH: 900, focalPx: 1427 };
  const f = { dt: 1 / 60, camX: 0, camY: 0, originX: 0, originY: 0, frame, speed: 14000, stretch: 1, dirX: 0, dirY: -1 };
  return { deb, drawn, vec, field, f };
}

test('pula: w pasie napełnia się do celu (cała w pudle), skały płyną wstecz wzdłuż kursu, smuga w stronę nadlotu', () => {
  const { deb, drawn, vec, f } = rig({ weight: 1, density: 0 });
  const target = Math.round(WARP_DEBRIS.cap * WARP_DEBRIS.bandFloor);
  for (let i = 0; i < 90; i++) { f.camY -= 4000; deb.update(f); }   // 1,5 s skoku kursem w górę (y gry maleje)
  const n = drawn.list.length;
  assert.ok(Math.abs(n - target) <= target * 0.1, `skał ${n} (cel ${target})`);
  assert.equal(drawn.visible, true);
  // Kurs (0, −1): skała u > 0 jest przed statkiem (mniejsze y), płynie do tyłu — u maleje o prędkość × dt.
  const r = drawn.list[0];
  const u0 = r.u;
  f.camY -= 4000;
  deb.update(f);
  if (r.alive && !r.dying) assert.ok(Math.abs(r.u - (u0 - 14000 / 60)) < 1e-6, 'przepływ widoczny');
  assert.ok(Math.abs(r.y - (f.camY - r.u)) < 1e-6, 'świat = kamera + u · kurs');
  // Smuga w scenie (y w górę): w stronę nadlotu = +kurs → (0, +1) · prędkość · naświetlanie · długość wyglądu.
  const lookLen = WARP_DEBRIS_LOOKS[WARP_DEBRIS_LOOK_DEFAULT].length;
  assert.ok(Math.abs(vec.x) < 1e-9 && Math.abs(vec.y - 14000 * WARP_DEBRIS.exposure * lookLen) < 1e-6, `smuga ${vec.x}, ${vec.y}`);
  // Wszystkie w pudle (pół boku na najgłębszej warstwie).
  const camZ = 1427 / 0.1;
  const half = 1600 * 0.5 / 0.1 * ((camZ + WARP_DEBRIS.depthMax) / camZ) * WARP_DEBRIS.boxMul;
  for (const k of drawn.list) assert.ok(Math.abs(k.u) <= half + 1 && Math.abs(k.w) <= half + 1);
});

test('pula: wylot z pasa — skały gasną (maleją), pas „zostaje” jeszcze chwilę, po ~4 s pusto; hide czyści', () => {
  const { deb, drawn, field, f } = rig({ weight: 1, density: 0.25 });
  for (let i = 0; i < 90; i++) deb.update(f);
  assert.ok(drawn.list.length > 100);
  field.m = { weight: 0, density: 0 };
  let shrinking = 0;
  for (let i = 0; i < 30; i++) {
    deb.update(f);
    for (const k of drawn.list) if (k.dying && k.r < k.r0) shrinking++;
  }
  assert.ok(shrinking > 0, 'nadmiar maleje zamiast znikać');
  assert.ok(drawn.list.length > 20, `pół s po wylocie: ${drawn.list.length} (gęstość gaśnie ~0,8 s)`);
  for (let i = 0; i < 210; i++) deb.update(f);
  assert.equal(drawn.list.length, 0, `po 4 s zostało ${drawn.list.length}`);
  deb.hide();
  assert.equal(drawn.visible, false);
  assert.equal(drawn.list.length, 0);
});

test('wpięcie w pas: tryb skoku z prędkości kamery (histereza, cięcie), pole wyłączone, dt sumowane, kadr z obrotem', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /const WARP_MODE_ON = 30000;\s*const WARP_MODE_OFF = 20000;/);
  assert.match(src, /this\._warpMode = !!this\.warpDebris && stretch > this\.warpDebris\.cfg\.minStretch\s*&& camSpeed > \(this\._warpMode \? WARP_MODE_OFF : WARP_MODE_ON\);/);
  assert.match(src, /if \(viewOk && this\._warpMode\) \{\s*this\._deactivate\(\);\s*this\._frameActive = false;\s*this\._warpStep\(ctx, stretch\);/);
  assert.match(src, /if \(sp > WARP_CUT_SPEED\) this\._camSpeed = 0;/);
  assert.match(src, /i\.dt = \(i\.prepared \? i\.dt : 0\) \+ Math\.max\(0, Number\(dt\) \|\| 0\);/);
  assert.match(src, /rolledHalfExtents\(bufW \* 0\.5, bufH \* 0\.5, cameraRoll\(cam1\)/);
  assert.match(src, /new RockNodeMaterial\(\{ shared, backdrop: true, smear: true \}\)/);
  // Smugi z modułów pasa bez nowego importu z gry (szew renderu).
  assert.match(read('src/3d/asteroids/warpDebris.js'), /from '\.\/rockMaterial\.js';/);
});

test('wygląd smugi (2026-10-23, „słabo się rozciągają”): warianty = uniformy materiału, długość × wygląd; rozgrzewka z odsłoniętą grupą', () => {
  const uni = () => ({ value: -1 });
  const vec = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  const material = { smear: { vec: { value: vec }, taper: uni(), tail: uni(), fade: uni(), blur: uni(), sunMix: uni(), gain: uni() } };
  const set = { group: {}, enabled: false, setVisible(v) { this.enabled = !!v; }, set() {}, setOrigin() {}, update() {} };
  const deb = new WarpDebris({ material, field: { sampleMacro: () => ({ weight: 1, density: 0 }), maxDensity: 1 }, set });
  assert.ok(Object.keys(WARP_DEBRIS_LOOKS).length >= 2, 'dwa wyglądy do porównania');
  assert.equal(deb.look, WARP_DEBRIS_LOOK_DEFAULT);
  for (const [name, L] of Object.entries(WARP_DEBRIS_LOOKS)) {
    assert.equal(deb.setLook(name), name);
    for (const k of ['taper', 'tail', 'fade', 'blur', 'sunMix', 'gain']) assert.equal(material.smear[k].value, L[k], `${name}.${k}`);
    assert.ok(L.length > 1 && L.taper > 0 && L.taper <= 1 && L.tail > 0 && L.tail <= 1 && L.fade > 0, name);
    const f = { dt: 1 / 60, camX: 0, camY: 0, originX: 0, originY: 0, frame: { cam: { zoom: 0.1 }, viewW: 1600, viewH: 900, focalPx: 1427 },
      speed: 14000, stretch: 1, dirX: 1, dirY: 0 };
    deb.update(f);
    assert.ok(Math.abs(vec.x - 14000 * WARP_DEBRIS.exposure * L.length) < 1e-6, `${name}: długość smugi`);
  }
  assert.equal(deb.setLook('nie-ma'), null);
  // Materiał: ogon zwęża się (taper), głowa pełna, ogon od krycia `tail` gaśnie (podstawa potęgi ≥ 0), mipy w ogonie.
  const mat = read('src/3d/asteroids/rockMaterial.js');
  assert.match(mat, /pl = iPos\.xyz\.add\(local\.mul\(mix\(float\(1\.0\), sm\.taper, tail\)\)\)\.add\(sv\.mul\(tail\)\);/);
  assert.match(mat, /sm\.tail\.mul\(pow\(float\(1\.0\)\.sub\(t\), sm\.fade\)\)/);
  assert.match(mat, /V\.info\.w\.add\(V\.smearT\.mul\(this\.smear\.blur\)\)/);
  // Rozgrzewka: grupa smug (schowana poza skokiem) odsłonięta na czas kompilacji passów pasa.
  const belt = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(belt, /const debrisHidden = !!debris && debris\.visible === false;\s*if \(debrisHidden\) debris\.visible = true;/);
});
