// Tryb torped jak w World of Warships (2026-09-30, src/game/torpedoAim.js): wachlarz niekierowanych
// torped (rury = burstCount), wąski / szeroki rozrzut z danych, wskaźnik wyprzedzenia (punkt
// celowania w układzie wyrzutni), gotowość wyrzutni; wpięcie w index.html i WeaponController.
// node --test tests/torpedoAim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import {
  isTorpedoWeapon, torpedoTubesOf, torpedoSpreadRad, writeTorpedoFan, solveTorpedoLead,
  torpedoLauncherState, TORPEDO_ALIGN_RAD, TORPEDO_TUBES_MAX, TORPEDO_SPREAD_DEFAULT
} from '../src/game/torpedoAim.js';

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('torpedy z danych: kategoria, rury, wąski < szeroki, grywalny czas dolotu', () => {
  const ids = Object.keys(MASTER_WEAPONS).filter((id) => isTorpedoWeapon(MASTER_WEAPONS[id]));
  assert.deepEqual(ids.sort(), ['siege_torpedo', 'siege_torpedo_mk2', 'torpedo_salvo']);
  assert.equal(isTorpedoWeapon(MASTER_WEAPONS.missile_rack), false, 'rakieta to nie torpeda');
  for (const id of ids) {
    const def = MASTER_WEAPONS[id];
    const tubes = torpedoTubesOf(def);
    assert.ok(tubes >= 2 && tubes <= TORPEDO_TUBES_MAX, `${id}: rury ${tubes}`);
    assert.ok(torpedoSpreadRad(def, false) < torpedoSpreadRad(def, true), `${id}: wąski < szeroki`);
    // Pełny zasięg w 5–12 s: wolniej niż pocisk działa (≤ 1,4 s), ale bez minuty dolotu. Dawniej
    // 45–80 tys. j. przy 500–800 j/s (do 100 s), potem 14–22 km (10–25 s); od 2026-10-07 torpedy 7–9 km.
    const t = def.baseRange / def.baseSpeed;
    assert.ok(t >= 5 && t <= 12, `${id}: dolot na pełny zasięg ${t.toFixed(1)} s`);
  }
  assert.equal(torpedoTubesOf(MASTER_WEAPONS.torpedo_salvo), 6);
  close(torpedoSpreadRad({}, false), TORPEDO_SPREAD_DEFAULT[0] * Math.PI / 180, 1e-12, 'domyślny wąski');
});

test('wachlarz: rury równo na całym kącie, symetrycznie wokół kursu; jedna rura = kurs', () => {
  const out = new Float64Array(TORPEDO_TUBES_MAX);
  const n = writeTorpedoFan(1.0, 6, 0.5, out);
  assert.equal(n, 6);
  close(out[0], 0.75, 1e-12, 'skrajna lewa');
  close(out[5], 1.25, 1e-12, 'skrajna prawa');
  for (let k = 1; k < 6; k++) close(out[k] - out[k - 1], 0.1, 1e-12, 'równy odstęp');
  close((out[0] + out[5]) / 2, 1.0, 1e-12, 'środek wachlarza = kurs');
  assert.equal(writeTorpedoFan(-2, 1, 0.5, out), 1);
  assert.equal(out[0], -2);
  assert.equal(writeTorpedoFan(0, 99, 0.2, out), TORPEDO_TUBES_MAX, 'przycięcie do bufora');
});

test('wyprzedzenie: torpeda puszczona w punkt celowania spotyka cel (też z pędzącej wyrzutni)', () => {
  const lead = { ok: false, t: 0, ax: 0, ay: 0, gx: 0, gy: 0 };
  // (Wyrzutnia −800 j/s: cel oddala się w jej układzie 774 j/s — torpeda 1400 j/s go dogoni.)
  for (const [svx, svy] of [[0, 0], [900, -300], [-800, 0]]) {
    const sx = 100; const sy = -50;
    const tx = 6000; const ty = 2000; const tvx = -150; const tvy = 420;
    const speed = 1400;
    solveTorpedoLead(sx, sy, svx, svy, tx, ty, tvx, tvy, speed, lead);
    assert.ok(lead.ok && lead.t > 0, 'jest rozwiązanie');
    // Torpeda: pęd wyrzutni + prędkość własna w kierunku punktu celowania (liczonego TERAZ).
    const dx = lead.ax - sx;
    const dy = lead.ay - sy;
    const l = Math.hypot(dx, dy);
    const px = sx + (svx + dx / l * speed) * lead.t;
    const py = sy + (svy + dy / l * speed) * lead.t;
    const cx = tx + tvx * lead.t;
    const cy = ty + tvy * lead.t;
    close(px, cx, 1e-6, 'x spotkania'); close(py, cy, 1e-6, 'y spotkania');
    close(lead.gx, cx, 1e-9, 'duch w świecie'); close(lead.gy, cy, 1e-9);
  }
  // Cel ucieka szybciej niż torpeda — brak rozwiązania.
  solveTorpedoLead(0, 0, 0, 0, 1000, 0, 5000, 0, 1400, lead);
  assert.equal(lead.ok, false);
});

test('gotowość wyrzutni: przeładowanie / brak amunicji, obrót wieżyczki, gotowa', () => {
  assert.equal(torpedoLauncherState(3.2, 5, 0), 'reload');
  assert.equal(torpedoLauncherState(0, 0, 0), 'reload', 'pusty magazyn');
  assert.equal(torpedoLauncherState(0, 5, TORPEDO_ALIGN_RAD * 2), 'turn');
  assert.equal(torpedoLauncherState(0, null, TORPEDO_ALIGN_RAD * 0.5), 'ready', 'bez limitu amunicji');
  assert.equal(torpedoLauncherState(0, 3, NaN), 'turn', 'nieznany błąd celowania — nie strzela');
});

test('wpięcie: klawisz 8, LPM / PPM trybu, nakładka, krok klatki; PPM rakiet pomija torpedy', () => {
  const html = read('index.html');
  // klawisz trybu — akcja 'mode.torpedo' (GameActions w index.html, warstwa wejścia — docs/PLAN-pad.md, etap 1)
  assert.match(html, /'mode\.torpedo': \{\n\s+gate: \(\) => !stationUI\.open && !CICDisplay\.active,/, 'klawisz trybu w keydown');
  assert.match(read('src/input/inputActions.js'), /'mode\.torpedo': \['Digit8', 'Numpad8'\]/, 'klawisz 8');
  assert.match(html, /if \(torpedoMouseDown\(e\)\) \{/, 'mysz trybu');
  assert.match(html, /drawTorpedoOverlay\(ctx, cam\);/, 'nakładka w rysunku 2D');
  assert.match(html, /stepTorpedoMode\(\);/, 'tryb gaśnie w klatce');
  // Torpedy trybu są niekierowane: bez celu i obrotu.
  const fan = html.slice(html.indexOf('function fireTorpedoFan(lo)'), html.indexOf('function drawTorpedoOverlay('));
  assert.match(fan, /target: null,\s*turnRate: 0,/);
  assert.match(fan, /type: 'torpedo'/);
  const ctrl = read('src/game/weaponController.js');
  assert.match(ctrl, /!isTorpedoWeapon\(e\.weapon\)/, 'PPM (rakiety) nie strzela torpedami');
  assert.match(ctrl, /torpedoManual && isTorpedoWeapon\(weapon\)/, 'w trybie torped wyrzutnie celują w kursor');
});
