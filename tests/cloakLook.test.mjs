// Wygląd maskowania (src/game/cloakLook.js, 2026-10-04 / 10-05): fazy z poziomu maskowania gry, komórki
// przełączane w losowej kolejności (bez fali od środka), cofanie przy zmianie kierunku, zakłócenie po zerwaniu,
// soczewka globalna, heksy-ekrany tylko przy awarii, lustro CPU wzoru z shadera (wieżyczki, dysze, lampy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOAK_EVENT, CLOAK_HEX_RY, CLOAK_LOOK, CLOAK_LOOK_OFF, cloakHashCpu, cloakHexCellCpu,
  cloakHiddenProgress, cloakLightGain, cloakVisAtWorld, cloakVisLocal, createCloakLook, entityCloakVisAt, stepCloakLook
} from '../src/game/cloakLook.js';
import { createCloak, breakCloak, engageCloak, stepCloak, toggleCloak } from '../src/game/cloak.js';

const pose = (o = {}) => ({ x: 1000, y: 2000, angle: 0, scale: 1, spriteW: 400, spriteH: 160, speed: 0, turn: 0, ...o });

test('hasz komórki: 24 bity w [0, 1), deterministyczny, rozkład bez zgrubień', () => {
  const seen = new Set();
  let sum = 0;
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 4000; i++) {
    const h = cloakHashCpu(16384 + (i % 80), 16384 + Math.floor(i / 80), 7);
    assert.ok(h >= 0 && h < 1);
    assert.equal(h, cloakHashCpu(16384 + (i % 80), 16384 + Math.floor(i / 80), 7));
    assert.equal(h * 16777216, Math.floor(h * 16777216), 'dokładnie 24 bity (float32 na GPU bez zaokrągleń)');
    seen.add(h);
    sum += h;
    bins[Math.floor(h * 10)]++;
  }
  assert.ok(seen.size > 3990, 'brak kolizji w siatce 80 × 50');
  assert.ok(Math.abs(sum / 4000 - 0.5) < 0.02);
  for (const b of bins) assert.ok(b > 330 && b < 470, `kubełek ${b}`);
  // ziarno zmienia wzór
  assert.notEqual(cloakHashCpu(16400, 16400, 1), cloakHashCpu(16400, 16400, 2));
});

test('komórka heksa: środek w komórce, odległość od środka ≤ pół komórki (sześciokąt), id całkowite', () => {
  const c = {};
  for (let i = 0; i < 500; i++) {
    const px = (i * 0.731) % 37 - 18;
    const py = (i * 1.137) % 29 - 14;
    cloakHexCellCpu(px, py, c);
    const q = [Math.abs(c.gx), Math.abs(c.gy)];
    const hd = Math.max(q[0] * 0.5 + q[1] * 0.8660254, q[0]);
    assert.ok(hd <= 0.5 + 1e-9, `punkt w swoim sześciokącie (${hd})`);
    assert.ok(Math.abs(c.idx + c.gx - px) < 1e-9 && Math.abs(c.idy + c.gy - py) < 1e-9);
    assert.ok(Number.isInteger(c.ix) && Number.isInteger(c.iy) && c.ix > 0 && c.iy > 0);
    // środki komórek na siatce: x co ½, y co √3/2
    assert.ok(Math.abs(c.idx * 2 - Math.round(c.idx * 2)) < 1e-9);
    assert.ok(Math.abs(c.idy / (CLOAK_HEX_RY * 0.5) - Math.round(c.idy / (CLOAK_HEX_RY * 0.5))) < 1e-9);
  }
});

// Punkty kadłuba (sprite 400 × 160 px, skala 1) z promieniem od środka — do sprawdzania kolejności przełączania.
function hullPoints() {
  const pts = [];
  for (let x = -180; x <= 180; x += 24) for (let y = -60; y <= 60; y += 24) pts.push({ x, y, r: Math.hypot(x, y) / 200, at: -1 });
  return pts;
}
// Korelacja promienia z chwilą przełączenia (fala od środka dawała ~1).
function radiusCorrelation(pts) {
  const n = pts.length;
  const mr = pts.reduce((s, p) => s + p.r, 0) / n;
  const mt = pts.reduce((s, p) => s + p.at, 0) / n;
  let cov = 0, vr = 0, vt = 0;
  for (const p of pts) { cov += (p.r - mr) * (p.at - mt); vr += (p.r - mr) ** 2; vt += (p.at - mt) ** 2; }
  return cov / Math.sqrt(vr * vt);
}

test('włączanie: impuls siatki, potem komórki gasną w LOSOWEJ kolejności na całym kadłubie (bez fali od środka)', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 5);
  assert.equal(stepCloakLook(look, cloak, 0.016, 10, pose()), false, 'bez maskowania nieaktywny');
  assert.equal(look.a.y, 0);
  assert.ok(engageCloak(cloak));
  stepCloak(cloak, 0.05);
  stepCloakLook(look, cloak, 0.05, 10.05, pose());
  assert.ok(look.events & CLOAK_EVENT.ENGAGE, 'zdarzenie startu');
  assert.ok(look.active && look.phase === 'engage');
  assert.equal(look.vis, 1, 'impuls przed przełączaniem — jeszcze widać');
  const pts = hullPoints();
  let t = 10.05;
  let i = 0;
  let ev = 0;
  while (cloak.state === 'engaging') {
    stepCloak(cloak, 0.05);
    t += 0.05;
    i++;
    stepCloakLook(look, cloak, 0.05, t, pose());
    ev |= look.events;
    for (const p of pts) if (p.at < 0 && cloakVisAtWorld(look, 1000 + p.x, 2000 + p.y) < 0.5) p.at = i;
    if (look.pulse > 0) assert.ok(look.pulse <= 1);
  }
  stepCloakLook(look, cloak, 0.05, t + 0.05, pose());
  ev |= look.events;
  assert.ok(ev & CLOAK_EVENT.HIDDEN);
  assert.ok(pts.every((p) => p.at > 0), 'na końcu cały kadłub ukryty');
  const corr = radiusCorrelation(pts);
  assert.ok(Math.abs(corr) < 0.3, `kolejność bez związku z odległością od środka (korelacja ${corr.toFixed(2)})`);
  assert.ok(new Set(pts.map((p) => p.at)).size > 8, 'komórki gasną w różnych chwilach');
  assert.equal(look.vis, 0);
  assert.equal(look.phase, 'hidden');
  assert.equal(cloakVisAtWorld(look, 1000 + 120, 2000 + 30), 0);
  assert.equal(cloakLightGain({ __cloakLook: look }), 0, 'światła zgaszone');
});

test('zmiana kierunku w połowie fali cofa front (bez przeskoku mozaiki)', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 1);
  engageCloak(cloak);
  let t = 0;
  for (let i = 0; i < 16; i++) { stepCloak(cloak, 0.05); t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose()); }
  assert.equal(cloak.state, 'engaging');
  const frontMid = look.front;
  const visMid = look.vis;
  assert.ok(visMid > 0.1 && visMid < 0.9, `w połowie (${visMid})`);
  assert.equal(look.dir, 1);
  // wyłączenie w trakcie: tryb fali zostaje, front maleje razem z poziomem
  assert.ok(toggleCloak(cloak));
  stepCloak(cloak, 0.02);
  t += 0.02;
  stepCloakLook(look, cloak, 0.02, t, pose());
  assert.ok(look.events & CLOAK_EVENT.REVEAL);
  assert.equal(look.dir, 1, 'ten sam tryb — cofanie, nie odwrócenie');
  assert.ok(look.front <= frontMid + 1e-9 && frontMid - look.front < 0.2, 'front bez skoku');
  // punkt, który już zniknął, wraca dopiero, gdy front się cofnie
  let prev = look.front;
  while (cloak.state === 'revealing') {
    stepCloak(cloak, 0.05);
    t += 0.05;
    stepCloakLook(look, cloak, 0.05, t, pose());
    assert.ok(look.front <= prev + 1e-9, 'front monotonicznie wraca');
    prev = look.front;
  }
  stepCloakLook(look, cloak, 0.05, t + 0.05, pose());
  assert.equal(look.active, false, 'po powrocie wygląd wyłączony');
  assert.equal(cloakVisAtWorld(look, 1000, 2000), 1);
});

test('pełne ukrycie → powrót: komórki wracają w losowej kolejności (tryb −1), impuls na starcie', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 3);
  engageCloak(cloak);
  let t = 0;
  for (let i = 0; i < 60; i++) { stepCloak(cloak, 0.05); t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose()); }
  assert.equal(look.phase, 'hidden');
  assert.equal(look.dir, -1, 'ukryty: tryb odsłaniania');
  toggleCloak(cloak);
  stepCloak(cloak, 0.05);
  t += 0.05;
  stepCloakLook(look, cloak, 0.05, t, pose());
  assert.ok(look.pulse > 0, 'impuls siatki przy wyjściu z ukrycia');
  const pts = hullPoints();
  let i = 0;
  let mid = false;
  while (cloak.state === 'revealing') {
    stepCloak(cloak, 0.02);
    t += 0.02;
    i++;
    stepCloakLook(look, cloak, 0.02, t, pose());
    let shown = 0;
    for (const p of pts) {
      const v = cloakVisAtWorld(look, 1000 + p.x, 2000 + p.y);
      if (v > 0.5) shown++;
      if (p.at < 0 && v > 0.5) p.at = i;
    }
    if (shown > pts.length * 0.25 && shown < pts.length * 0.75) mid = true;
  }
  assert.ok(mid, 'w połowie część komórek widać, część nie — rozsypane po kadłubie');
  assert.ok(pts.every((p) => p.at > 0), 'na końcu cały kadłub widać');
  const corr = radiusCorrelation(pts);
  assert.ok(Math.abs(corr) < 0.3, `kolejność bez związku z odległością od środka (korelacja ${corr.toFixed(2)})`);
});

test('zerwanie: natychmiast widać, zakłócenie gaśnie w glitchSec, zdarzenie BREAK raz', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 9);
  engageCloak(cloak);
  let t = 0;
  for (let i = 0; i < 60; i++) { stepCloak(cloak, 0.05); t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose()); }
  assert.ok(breakCloak(cloak, 'fire'));
  stepCloakLook(look, cloak, 0.016, t + 0.016, pose());
  assert.ok(look.events & CLOAK_EVENT.BREAK);
  assert.equal(look.phase, 'glitch');
  assert.ok(look.glitch > 0.9 && look.active);
  assert.equal(look.vis, 1, 'rozgrywka: okręt widoczny od razu');
  stepCloakLook(look, cloak, 0.016, t + 0.032, pose());
  assert.equal(look.events & CLOAK_EVENT.BREAK, 0, 'raz');
  let n = 0;
  while (look.active && n < 200) { stepCloakLook(look, cloak, 0.05, t + n * 0.05, pose()); n++; }
  assert.ok(Math.abs(n * 0.05 - CLOAK_LOOK.glitchSec) < 0.1, `zakłócenie ~${CLOAK_LOOK.glitchSec} s (${n * 0.05})`);
});

test('końcówka energii: migotanie w ukryciu rośnie, gdy energia spada', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 2);
  engageCloak(cloak);
  for (let i = 0; i < 60; i++) { stepCloak(cloak, 0.05); stepCloakLook(look, cloak, 0.05, i * 0.05, pose()); }
  cloak.energy = 30;
  stepCloakLook(look, cloak, 0.05, 4, pose());
  assert.equal(look.flicker, 0);
  cloak.energy = 2;
  stepCloakLook(look, cloak, 0.05, 4.05, pose());
  assert.ok(look.flicker > 0.5 && look.a.w === look.flicker);
});

test('lustro CPU: układ kanoniczny (x ku dziobowi, y w dół obrazu) przy obróconym okręcie i skali', () => {
  const look = createCloakLook(null, 4);
  const cloak = { state: 'on', level: 1, energy: 60, lastBreak: null };
  stepCloakLook(look, cloak, 0.016, 1, pose({ angle: Math.PI / 2, scale: 2 }));
  // obrót o 90°: dziób w stronę +y świata
  const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
  const lx = 50, ly = 20;
  const wx = 1000 + (lx * c - ly * s) * 2;
  const wy = 2000 + (lx * s + ly * c) * 2;
  assert.equal(cloakVisAtWorld(look, wx, wy), cloakVisLocal(look, lx, ly));
  // ukryty cały kadłub
  assert.equal(cloakVisLocal(look, lx, ly), 0);
  assert.equal(entityCloakVisAt({}, 1, 2), 1, 'encja bez wyglądu — widoczna');
  assert.equal(entityCloakVisAt({ __cloakLook: look }, wx, wy), 0);
  // komórka cellWorld [j. świata] przy skali 2 → połowa w px sprite'a
  assert.equal(look.b.z, CLOAK_LOOK.cellWorld / 2);
});

test('heksy-ekrany tylko przy awarii: bez ekranów przy włączaniu i w ukryciu (także w ruchu), pas przy wyłączaniu, końcówka energii', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 6);
  assert.deepEqual({ ...CLOAK_LOOK_OFF.e }, { x: 0, y: 0, z: 0, w: 0 }, 'wyłączone — bez ekranów');
  engageCloak(cloak);
  let t = 0;
  while (cloak.state === 'engaging') {
    stepCloak(cloak, 0.05);
    t += 0.05;
    stepCloakLook(look, cloak, 0.05, t, pose());
    assert.equal(look.e.y, 0, 'włączanie — bez pasa ekranów');
    assert.equal(look.e.z, 0, 'włączanie — bez utraty obrazu');
  }
  for (let i = 0; i < 40; i++) { t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose({ speed: 600 })); }
  assert.equal(look.phase, 'hidden');
  assert.equal(look.e.y, 0);
  assert.equal(look.e.z, 0, 'ukryty przy pełnej energii, także w ruchu — bez ekranów (spójnie)');
  assert.equal(look.e.w, CLOAK_LOOK.tvStrength);
  // końcówka energii: pojedyncze ekrany jako ostrzeżenie przed wyjściem z maskowania
  cloak.energy = 2;
  t += 0.05;
  stepCloakLook(look, cloak, 0.05, t, pose());
  assert.ok(look.e.z > 0.2, `końcówka energii — utrata obrazu (${look.e.z.toFixed(2)})`);
  cloak.energy = 40;
  t += 0.05;
  stepCloakLook(look, cloak, 0.05, t, pose());
  assert.equal(look.e.z, 0);
  // wyłączanie z pełnego ukrycia: pas po stronie ukrytej frontu (tryb −1 — przed frontem)
  toggleCloak(cloak);
  for (let i = 0; i < 3; i++) { stepCloak(cloak, 0.05); t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose()); }
  assert.equal(look.phase, 'reveal');
  assert.equal(look.e.y, -1);
  assert.equal(look.e.x, look.front);
});

test('soczewka globalna (D.z): rośnie z postępem ukrycia całego okrętu, w ruchu mocniejsza, bez maskowania zero', () => {
  const cloak = createCloak();
  const look = createCloakLook(cloak, 8);
  stepCloakLook(look, cloak, 0.05, 1, pose());
  assert.equal(look.d.z, 0);
  engageCloak(cloak);
  let t = 1;
  let prev = -1;
  let half = null;
  while (cloak.state === 'engaging') {
    stepCloak(cloak, 0.05);
    t += 0.05;
    stepCloakLook(look, cloak, 0.05, t, pose());
    if (look.pulseT <= 0) { assert.ok(look.d.z >= prev - 1e-9, 'bez spadków po impulsie'); prev = look.d.z; }
    if (half === null && look.progress >= 0.5) half = look.d.z;
  }
  assert.ok(half > 0.3 && half < 0.8, `w połowie przejścia ~połowa (${half})`);
  stepCloakLook(look, cloak, 0.05, t + 0.05, pose());
  assert.ok(Math.abs(look.d.z - CLOAK_LOOK.lensStrength) < 1e-9, 'ukryty w spoczynku — pełna soczewka');
  for (let i = 0; i < 40; i++) { t += 0.05; stepCloakLook(look, cloak, 0.05, t, pose({ speed: 600 })); }
  assert.ok(look.d.z > CLOAK_LOOK.lensStrength * 1.3, 'w ruchu mocniejsza');
  assert.equal(look.d.w, CLOAK_LOOK.spread, 'D.w — rozrzut progów komórek');
});

test('postęp ukrycia: 0 do levelLo, 1 od levelHi, monotoniczny', () => {
  assert.equal(cloakHiddenProgress(0), 0);
  assert.equal(cloakHiddenProgress(CLOAK_LOOK.levelLo), 0);
  assert.equal(cloakHiddenProgress(CLOAK_LOOK.levelHi), 1);
  assert.equal(cloakHiddenProgress(1), 1);
  let prev = 0;
  for (let l = 0; l <= 1; l += 0.01) { const p = cloakHiddenProgress(l); assert.ok(p >= prev - 1e-12); prev = p; }
});

test('wpięcie: shader, slot, refrakcja, wieżyczki, dysze, lampy, cień (źródła)', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /uCloakA: cloakHullHolder\(entity, 'a'\)/);
  assert.match(hex, /updateCloakLooks\(valid, now, getInterpolatedRenderPose/);
  assert.match(hex, /syncCloakDist\(_skinBatches\.values\(\), Core3D\.scene\)/);
  assert.match(hex, /if \(cloakHidesShadow\(entity\)\) continue;/);
  // wygląd PRZED światłami i wieżyczkami tej klatki
  assert.ok(hex.indexOf('updateCloakLooks(valid') < hex.indexOf('buildRoadLightWorldEmitters(visibleHex'));
  assert.ok(hex.indexOf('updateCloakLooks(valid') < hex.indexOf('Turret2D.sync(entity'));
  assert.match(read('src/vfx/turret2D.js'), /entityCloakVisAt\(rec\.entity, rec\.wx, rec\.wy\)/);
  assert.match(read('src/3d/engineVfxSystem.js'), /cloakVisAtWorld\(cloakLook, nozzleWorldX, -nozzleWorldY\)/);
  assert.match(read('src/game/shipLightRuntime.js'), /entityCloakVisAt\(entity, wx, wy\)/);
  assert.match(read('src/3d/fx/lightGrid.js'), /cloakLightGain\(entity\)/);
  // dawny „szew” na uniformach warpa usunięty
  assert.doesNotMatch(read('index.html'), /applyCloakHullLook/);
});
