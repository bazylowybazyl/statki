// Skały pasa w skoku (src/3d/asteroids/warpDebris.js; 2026-10-19, przebudowa DECYZJE-2 S1–S4 2026-10-26): gęstość
// z pola pasa (luki, wyrwy), przepływ z prawdziwej prędkości, trzy pasma głębi we własnych pudłach, pas nadlatujący
// z profilu wzdłuż kursu, wyglądy (bryła + ślad światła domyślnie, dawne do A/B), wpięcie w pas (tryb skoku, deflektor,
// fale, rozgrzewka partii śladów).
// node --test tests/warpDebris.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warpTrailIntensity } from '../src/3d/asteroids/warpTrails.js';
import {
  WarpDebris, WARP_DEBRIS, WARP_DEBRIS_LOOKS, WARP_DEBRIS_LOOK_DEFAULT, WARP_TRAIL_TYPE_COLOR, warpDebrisDensity,
  warpDebrisFlowQ, warpBeltProfile, WarpBeltTrack, warpDebrisLookFromSearch
} from '../src/3d/asteroids/warpDebris.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('gęstość: poza pasem 0, w paśmie minimum z obwiedni × luka Kirkwooda × wyrwa, pola rodzin do pełnej puli', () => {
  assert.equal(warpDebrisDensity({ weight: 0, density: 0 }, 1), 0);
  assert.ok(Math.abs(warpDebrisDensity({ weight: 1, density: 0 }, 1) - WARP_DEBRIS.bandFloor) < 1e-12, 'rzadki pas (bez pól gap/hole — jak dawniej)');
  assert.ok(Math.abs(warpDebrisDensity({ weight: 0.5, density: 0 }, 1) - WARP_DEBRIS.bandFloor * 0.5) < 1e-12);
  assert.equal(warpDebrisDensity({ weight: 1, density: 1 }, 1), 1, 'rdzeń pola');
  assert.ok(warpDebrisDensity({ weight: 1, density: 0.25 }, 1) === 0.5, 'pierwiastek gęstości względnej');
  assert.equal(warpDebrisDensity({ weight: 1, density: 4 }, 1), 1, 'sufit');
  // Luka Kirkwooda (sampleMacro: gap 0,1 w środku) i wyrwa po wydobyciu (hole) przerzedzają pas — płaskie 0,35 znika.
  assert.ok(Math.abs(warpDebrisDensity({ weight: 1, density: 0, gap: 0.1, hole: 1 }, 1) - WARP_DEBRIS.bandFloor * 0.1) < 1e-12, 'luka');
  assert.ok(Math.abs(warpDebrisDensity({ weight: 1, density: 0, gap: 1, hole: 0.5 }, 1) - WARP_DEBRIS.bandFloor * 0.5) < 1e-12, 'wyrwa');
  assert.ok(warpDebrisDensity({ weight: 1, density: 1, hole: 0.25 }, 1) === 0.5, 'wyrwa w polu rodziny');
});

test('przepływ z PRAWDZIWEJ prędkości: q log-liniowo od progu trybu skoku do przelotu w pasie, monotonicznie', () => {
  const C = WARP_DEBRIS;
  assert.equal(warpDebrisFlowQ(0), C.flowMin);
  assert.equal(warpDebrisFlowQ(C.flowMinSpeed), C.flowMin);
  assert.equal(warpDebrisFlowQ(C.flowRefSpeed), 1);
  assert.equal(warpDebrisFlowQ(400000), 1);
  let prev = 0;
  for (let v = 20000; v <= 200000; v += 5000) {
    const q = warpDebrisFlowQ(v);
    assert.ok(q >= prev - 1e-12 && q >= C.flowMin && q <= 1, `q(${v}) = ${q}`);
    prev = q;
  }
  // Zwolnienie przy mijanej planecie (raport: przelot ~150 tys. → 36 tys. j/s) widać: przepływ spada o ~40%.
  assert.ok(warpDebrisFlowQ(150000) / warpDebrisFlowQ(36000) > 1.55, 'zwolnienie widać w tempie skał');
});

// Atrapy: zestaw rysujący, materiał smug, partia śladów, pole (pas na zadanym odcinku y).
function rig(sample, opts = {}) {
  const drawn = { list: null, visible: false, updates: 0 };
  const set = {
    group: {}, enabled: false, lodExtra: 0,
    setVisible(v) { this.enabled = !!v; drawn.visible = !!v; },
    set(list) { drawn.list = list; },
    setOrigin() {},
    update() { drawn.updates++; }
  };
  const vec = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  const uni = () => ({ value: -1 });
  const material = { smear: { vec: { value: vec }, taper: uni(), tail: uni(), fade: uni(), blur: uni(), sunMix: uni(), gain: uni() } };
  const trails = {
    items: [], glints: 0, look: null, hidden: 0, focal: 0, camZ: 0,
    stats: { trails: 0, glints: 0 },
    begin() { this.items.length = 0; this.glints = 0; this.stats.trails = 0; this.stats.glints = 0; },
    addTrail(...a) { this.items.push(a); this.stats.trails++; return true; },
    addGlint() { this.glints++; this.stats.glints++; return true; },
    commit(f, z) { this.focal = f; this.camZ = z; },
    hide() { this.hidden++; },
    setLook(g, h, t, gl) { this.look = [g, h, t, gl]; }
  };
  const field = { sampleMacro: sample, maxDensity: 1, calls: 0 };
  const deb = new WarpDebris({ material, field, set, trails: opts.trails === false ? null : trails });
  const frame = { cam: { zoom: 0.1173 }, viewW: 1920, viewH: 1080, focalPx: 1712.7 };
  const f = { dt: 1 / 60, camX: 0, camY: 0, originX: 0, originY: 0, frame, camSpeed: 125000, flowCap: 14000, stretch: 1, dirX: 0, dirY: -1, lens: null };
  return { deb, drawn, vec, field, f, trails, material, set };
}
const belt = (lo, hi, extra = {}) => (x, y) => ({ weight: (y < -lo && y > -hi) ? 1 : 0, density: 0, gap: 1, hole: 1, ...extra });
const everywhere = (macro) => () => macro;

test('pasma głębi: każde we własnym pudle (płytkie trafiają w kadr), paralaksa w przedziale pasma, napełnienie do oczekiwanego', () => {
  const { deb, drawn, f } = rig(everywhere({ weight: 1, density: 0 }));
  for (let i = 0; i < 120; i++) { f.camY -= 125000 / 60; deb.update(f); }   // 2 s skoku kursem w górę (y gry maleje)
  const camZ = 1712.7 / 0.1173;
  const halfView = 1920 * 0.5 / 0.1173;
  const perBand = [0, 0, 0];
  let inFrame = [0, 0, 0];
  for (const r of drawn.list) {
    const B = WARP_DEBRIS.bands[r.band];
    const k = 1 / (1 + r.zk);
    assert.ok(k >= B.kMin - 1e-9 && k <= B.kMax + 1e-9, `paralaksa pasma ${B.id}: ${k}`);
    assert.ok(Math.abs(r.z - r.zk * camZ) < 1e-6, 'głębokość w jednostkach camZ');
    const H = halfView * (1 / B.kMin) * WARP_DEBRIS.boxMul;
    assert.ok(Math.abs(r.u) <= H * 1.0001 && Math.abs(r.w) <= H * 1.0001, `w pudle pasma ${B.id}`);
    perBand[r.band]++;
    // w kadrze (pozornie): |k·u| ≤ pół wysokości, |k·w| ≤ pół szerokości (kurs w górę: u — pion)
    if (Math.abs(k * r.u) <= 1080 * 0.5 / 0.1173 && Math.abs(k * r.w) <= halfView) inFrame[r.band]++;
  }
  WARP_DEBRIS.bands.forEach((B, i) => {
    const want = B.cap * WARP_DEBRIS.bandFloor;
    assert.ok(Math.abs(perBand[i] - want) <= want * 0.25 + 3, `pasmo ${B.id}: ${perBand[i]} (oczekiwane ${want.toFixed(0)})`);
  });
  // Pasmo bliskie: większość skał w kadrze (dawne jedno pudło najgłębszej warstwy: płytkie w kadrze ~14%).
  assert.ok(inFrame[0] / perBand[0] > 0.3, `bliskie w kadrze: ${inFrame[0]} / ${perBand[0]}`);
});

test('przepływ: skały płyną wstecz z flowCap · q, wolniej przy niższej prędkości, nie szybciej niż kamera', () => {
  const { deb, drawn, f } = rig(everywhere({ weight: 1, density: 0 }));
  for (let i = 0; i < 60; i++) deb.update(f);
  const r = drawn.list.find((x) => !x.dying && x.u < 0);
  const u0 = r.u;
  deb.update(f);
  assert.ok(Math.abs(r.u - (u0 - 14000 * warpDebrisFlowQ(125000) / 60)) < 1e-6, 'przepływ przy q = 1');
  assert.ok(Math.abs(r.y - (f.camY - r.u)) < 1e-6, 'świat = kamera + u · kurs (deflektor wyłączony)');
  f.camSpeed = 36000;
  const u1 = r.u;
  deb.update(f);
  assert.ok(Math.abs(r.u - (u1 - 14000 * warpDebrisFlowQ(36000) / 60)) < 1e-6, 'zwolnienie przy planecie');
  assert.ok(deb.stats.speed < 14000 * 0.7, `przepływ ${deb.stats.speed}`);
  f.camSpeed = 5000;
  deb.update(f);
  assert.equal(deb.stats.speed, 5000, 'nie szybciej niż prawdziwa kamera');
});

test('pas jako zdarzenie trasy (profil wzdłuż kursu): pas nadlatuje z przodu pudła, zostaje za rufą, luka zostaje pusta', () => {
  // Pas 300–700 tys. j. przed startem (kurs w górę: y gry maleje). Prędkość 125 tys. j/s → 1 j. przestrzeni widocznej =
  // v / przepływ ≈ 8,9 j. kursu.
  const { deb, drawn, f } = rig(belt(300000, 700000));
  let firstAt = -1;
  let frontFirst = false;
  for (let i = 0; i < 600; i++) {
    f.camY -= 125000 / 60;
    deb.update(f);
    if (firstAt < 0 && drawn.list.length > 0) {
      firstAt = -f.camY;
      // pierwsze skały tylko z przodu pudła (pas nadlatuje), nie w całym pudle
      frontFirst = drawn.list.every((r) => r.u > 0);
    }
  }
  assert.ok(firstAt > 0 && firstAt < 300000, `pierwsze skały przed wlotem kamery w pas (${firstAt})`);
  assert.ok(frontFirst, 'pas wchodzi przodem pudła');
  // Po wylocie (kamera 700 tys. + ~2 s): pusto.
  assert.equal(drawn.list.length, 0, 'po pasie pusto');
  // Luka w środku pasa: skały w przestrzeni widocznej, które przedstawiają punkty luki, nie powstają.
  const gapLo = 480000; const gapHi = 520000;
  const g = rig((x, y) => ({ weight: (y < -300000 && y > -700000) ? 1 : 0, density: 0, gap: (y < -gapLo && y > -gapHi) ? 0 : 1, hole: 1 }));
  let inGap = 0; let total = 0;
  for (let i = 0; i < 300; i++) {
    g.f.camY -= 125000 / 60;
    g.deb.update(g.f);
    const m = g.deb.stats.ratio;
    for (const r of g.drawn.list) {
      if (r.dying || r.age < 0.05) continue;
      const s = -g.f.camY + m * r.u;  // punkt kursu, który skała przedstawia
      total++;
      if (s > gapLo + 8000 && s < gapHi - 8000) inGap++;
    }
  }
  assert.ok(total > 1000, `próbek ${total}`);
  assert.ok(inGap / total < 0.01, `skały w luce: ${inGap} / ${total}`);
});

test('wylot z pola rodziny: nadmiar maleje (bez znikania), po pasie pusto; hide czyści skały i ślady', () => {
  const r = rig(everywhere({ weight: 1, density: 0.6 }));
  for (let i = 0; i < 90; i++) r.deb.update(r.f);
  const full = r.drawn.list.length;
  assert.ok(full > 120, `pole rodziny: ${full}`);
  r.field.sampleMacro = everywhere({ weight: 1, density: 0 });
  r.deb.track.invalidate();   // pole się zmieniło (test) — profil od nowa
  let shrinking = 0;
  for (let i = 0; i < 60; i++) {
    r.deb.update(r.f);
    for (const k of r.drawn.list) if (k.dying && k.r < k.r0) shrinking++;
  }
  assert.ok(shrinking > 0, 'nadmiar maleje zamiast znikać');
  assert.ok(r.drawn.list.length < full, `po 1 s: ${r.drawn.list.length}`);
  r.deb.hide();
  assert.equal(r.drawn.visible, false);
  assert.equal(r.drawn.list.length, 0);
  assert.equal(r.trails.hidden, 1, 'partia śladów schowana');
});

test('wyglądy: ślad światła domyślny (bryła + ślad), bryła, dawne „ślad” / „klin” do A/B — uniformy, bez nowych pipeline\'ów', () => {
  assert.equal(WARP_DEBRIS_LOOK_DEFAULT, 'swiatlo', 'decyzja 10-23: ślad światła domyślny');
  assert.deepEqual(Object.keys(WARP_DEBRIS_LOOKS).sort(), ['bryla', 'klin', 'slad', 'swiatlo']);
  const { deb, material, trails, set, f, vec } = rig(everywhere({ weight: 1, density: 0 }));
  assert.equal(deb.look, WARP_DEBRIS_LOOK_DEFAULT);
  for (const [name, L] of Object.entries(WARP_DEBRIS_LOOKS)) {
    assert.equal(deb.setLook(name), name);
    for (const k of ['taper', 'tail', 'fade', 'blur', 'sunMix', 'gain']) assert.equal(material.smear[k].value, L[k], `${name}.${k}`);
    assert.deepEqual(trails.look, [L.trailGain, L.trailHead, L.trailTaper, L.trailGlow], `${name}: wygląd śladu`);
    for (let i = 0; i < 30; i++) deb.update(f);
    const S = 14000 * warpDebrisFlowQ(f.camSpeed);
    assert.ok(Math.abs(Math.hypot(vec.x, vec.y) - S * L.head) < 1e-6, `${name}: rozmycie bryły`);
    assert.ok(Math.abs(set.lodExtra - L.lodBlur * S * L.head) < 1e-6, `${name}: LOD z rozmiaru bryły`);
    if (L.trail > 0) {
      assert.ok(trails.items.length > 0, `${name}: ślady`);
      const len = trails.items[0][5];
      assert.ok(Math.abs(len - L.trail * S * warpDebrisFlowQ(f.camSpeed)) < 1e-6, `${name}: długość śladu`);
    } else assert.equal(trails.items.length, 0, `${name}: bez śladu`);
  }
  // Bryła: rozmycie 1–2 klatek przy 60 Hz (raport A); dawny ślad — długi klin jak przed przebudową (14 000 · 0,055 · 3,4).
  const head = WARP_DEBRIS_LOOKS.swiatlo.head * 60;
  assert.ok(head >= 1 && head <= 2, `rozmycie bryły ${head.toFixed(2)} kl.`);
  assert.ok(Math.abs(14000 * WARP_DEBRIS_LOOKS.slad.head - 2618) < 1, 'dawny ślad bez zmian');
  assert.equal(deb.setLook('nie-ma'), null);
  assert.equal(warpDebrisLookFromSearch('?dev&smugi=slad'), 'slad');
  assert.equal(warpDebrisLookFromSearch('?smugi=zle'), null);
  assert.equal(warpDebrisLookFromSearch(undefined), null);
});

test('ślad światła: barwa oświetlonej strony (paleta typu × słońce), ogon pod progiem bloomu, kierunek do tyłu drogi', () => {
  for (let i = 0; i < WARP_TRAIL_TYPE_COLOR.length; i++) {
    assert.ok(WARP_TRAIL_TYPE_COLOR[i] > 0.02 && WARP_TRAIL_TYPE_COLOR[i] <= 0.8 + 1e-6, `barwa ${i}: ${WARP_TRAIL_TYPE_COLOR[i]}`);
  }
  const { deb, trails, f } = rig(everywhere({ weight: 1, density: 0 }));
  deb.sunT = () => 0.5;
  for (let i = 0; i < 60; i++) deb.update(f);
  for (const a of trails.items) {
    const [, , z, dx, dy, len, halfW, head, cr, cg, cb] = a;
    assert.ok(z < 0, 'pod płaszczyzną gry');
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-9, 'kierunek jednostkowy');
    assert.ok(dy > 0.9, `kurs w górę gry = −y gry → ślad do tyłu drogi = +y sceny (${dy})`);
    assert.ok(halfW > 0 && head > 0 && head < 1 && len > 0);
    assert.ok(Math.max(cr, cg, cb) <= 0.8 * 0.5 + 1e-6, 'barwa × słońce ≤ 0,4 (głowa HDR dokłada shader)');
  }
});

test('ślad światła: ponad progiem bloomu tylko głowa tuż za bryłą — każde pasmo (rMax), przelot i zwolnienie (q min), najjaśniejsza barwa', () => {
  // Recenzja S (2026-10-26): dawna głowa rosła z promieniem — dalekie i średnie skały przy zwolnieniu świeciły na 50–100%
  // widocznego śladu (pasy 25–35 px jak komety). Liczy wzór fragmentu (lustro warpTrailIntensity) na śladach z warstwy.
  const L = WARP_DEBRIS_LOOKS.swiatlo;
  const C_MAX = 0.8;   // najjaśniejsza barwa palety śladu (× słońce 1, bez zamglenia)
  for (const speed of [WARP_DEBRIS.flowMinSpeed, 36000, WARP_DEBRIS.flowRefSpeed]) {
    const { deb, trails, f } = rig(everywhere({ weight: 1, density: 1 }));
    f.camSpeed = speed;
    for (let i = 0; i < 90; i++) { f.camY -= speed / 60; deb.update(f); }
    const S = deb.stats.speed;
    const blur = S * L.head;
    const byBand = [0, 0, 0];
    const rMax = [0, 0, 0];
    for (const r of deb.list) { byBand[r.band]++; rMax[r.band] = Math.max(rMax[r.band], r.r0); }
    assert.ok(byBand.every((n) => n > 5), `skały w każdym paśmie: ${byBand}`);
    assert.ok(rMax[2] > WARP_DEBRIS.bands[2].rMax * 0.5, `duże skały pasma dalekiego: ${rMax[2].toFixed(0)}`);
    for (const a of trails.items) {
      const len = a[5];
      const head = a[7];
      const r = head * len;
      // HDR (jasność × barwa > 0,9) za brzegiem skały: najwyżej min(pół promienia, trailGlow · długość)
      let last = -1;
      let hdrVisible = 0;
      let visible = 0;
      const edge = Math.min(1, (r + 0.85 * blur) / len);   // za bryłą z rozmyciem (zwężenie 0,85)
      for (let s = head; s <= 1; s += 0.002) {
        const hot = warpTrailIntensity(s, head, L.trailGain, L.trailHead, L.trailGlow) * C_MAX > 0.9;
        if (hot) last = s;
        if (s >= edge) { visible++; if (hot) hdrVisible++; }
      }
      const hdrLen = last >= head ? (last - head) * len : 0;
      assert.ok(hdrLen <= Math.min(0.5 * r, L.trailGlow * len) + 0.003 * len, `v ${speed}, r ${r.toFixed(0)}: głowa HDR ${hdrLen.toFixed(0)} j.`);
      assert.ok(visible < 3 || hdrVisible / visible <= 0.05, `v ${speed}, r ${r.toFixed(0)}: HDR na ${(100 * hdrVisible / visible).toFixed(0)}% widocznego śladu`);
    }
  }
  // Głowa jest (światło za bryłą łapie bloom) także przy ciemnej barwie palety.
  assert.ok(warpTrailIntensity(0.1, 0.1, L.trailGain, L.trailHead, L.trailGlow) * 0.3 > 1);
});

test('S4: profil pasa wzdłuż kursu — funkcja czysta i pamięć leniwa (próbki raz, interpolacja)', () => {
  let calls = 0;
  const field = { maxDensity: 1, sampleMacro: (x, y) => { calls++; return { weight: y < -100000 ? 1 : 0, density: 0, gap: 1, hole: 1 }; } };
  const out = new Float32Array(50);
  warpBeltProfile(field, 0, 0, 0, -1, 0, 4000, out);
  assert.equal(calls, 50);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[49] - WARP_DEBRIS.bandFloor) < 1e-6, 'pas po 100 tys. j.');
  const tr = new WarpBeltTrack(field);
  tr.reset(0, 0, 0, -1);
  calls = 0;
  const a = tr.at(98000);
  const b = tr.at(102000);
  const again = tr.at(98000);
  assert.equal(a, again);
  assert.ok(calls <= 3, `próbek ${calls}`);
  assert.ok(b > a, 'brzeg pasa interpolowany');
});

test('wpięcie w pas: tryb skoku, przepływ z prędkości kamery, soczewka → deflektor, fale, partia śladów w rozgrzewce', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /const WARP_MODE_ON = 30000;\s*const WARP_MODE_OFF = 20000;/);
  assert.match(src, /this\._warpMode = !!this\.warpDebris && stretch > this\.warpDebris\.cfg\.minStretch\s*&& camSpeed > \(this\._warpMode \? WARP_MODE_OFF : WARP_MODE_ON\);/);
  assert.match(src, /if \(viewOk && this\._warpMode\) \{\s*this\._deactivate\(\);\s*this\._frameActive = false;\s*this\._warpStep\(ctx, stretch\);/);
  assert.match(src, /if \(sp > WARP_CUT_SPEED\) this\._camSpeed = 0;/);
  assert.match(src, /i\.dt = \(i\.prepared \? i\.dt : 0\) \+ Math\.max\(0, Number\(dt\) \|\| 0\);/);
  assert.match(src, /rolledHalfExtents\(bufW \* 0\.5, bufH \* 0\.5, cameraRoll\(cam1\)/);
  assert.match(src, /new RockNodeMaterial\(\{ shared, backdrop: true, smear: true \}\)/);
  // przepływ: prawdziwa prędkość kamery + kamera gwiazd (limit klatki)
  assert.match(src, /wf\.camSpeed = this\._camSpeed \|\| 0;\s*wf\.flowCap = Number\(WARP_STAR_CAMERA\.speedCap\) \|\| 0;/);
  // deflektor tylko w skoku gracza (soczewka świata), A/B z adresu; fale przez Core3D.fxDistortion (sama refrakcja)
  assert.match(src, /wf\.lens = WARP_WORLD_LENS\.active \? WARP_WORLD_LENS : null;\s*wf\.deflect = warpDeflectorOn\(RenderWorld\.pageSearch\);/);
  assert.match(src, /const D = Core3D\.fxDistortion\?\.\(\);[\s\S]{0,300}D\.shock\(r\.x, r\.y, r\.r, r\.w, r\.amp, disp\)/);
  // partia śladów: warstwa tła, rozgrzewana z passem tła pasa z licznikiem instancji ≥ 2
  assert.match(src, /new WarpTrailBatch\(\{ parent: root, layer: BELT_LAYER_BACK, capacity: WARP_DEBRIS\.trailCap \}\)/);
  assert.match(src, /const debrisHidden = !!debris && debris\.visible === false;\s*if \(debrisHidden\) debris\.visible = true;\s*const trailRestore = trailMesh \? WARIANT_INSTANCJI\.apply\(trailMesh\) : null;/);
  assert.match(src, /if \(trailRestore\) trailRestore\(\);/);
  // wygląd z adresu (gra i worker)
  assert.match(src, /warpDebrisLookFromSearch\(RenderWorld\.pageSearch\)/);
  // moduły skał w skoku bez importów z gry (szew renderu): pole, soczewka, kamera — tylko z argumentów klatki
  for (const p of ['src/3d/asteroids/warpDebris.js', 'src/3d/asteroids/warpDeflector.js', 'src/3d/asteroids/warpTrails.js']) {
    const s = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // sam kod, bez komentarzy
    assert.doesNotMatch(s, /from '\.\.\/\.\.\/game\//, `${p}: bez src/game`);
    assert.doesNotMatch(s, /RenderWorld|window\.|Math\.random|Math\.hypot/, `${p}: bez stanu gry, Math.random i Math.hypot`);
  }
  // LOD z rozmiaru bryły w zestawie skał
  assert.match(read('src/3d/asteroids/rockLayers.js'), /pickRockLod\(lodExtra > 0 \? \(rock\.r \+ lodExtra\) \* pxPerUnit : rPx, this\.maxLod\)/);
});

test('bez alokacji w klatce: rekordy skał stałe, lista przepisywana w miejscu, deterministycznie przy tym samym ziarnie', async () => {
  const { fxRandom } = await import('../src/3d/fx/fxRandom.js');
  const run = () => {
    if (typeof fxRandom.seed === 'function') fxRandom.seed(12345);
    const { deb, drawn, f } = rig(everywhere({ weight: 1, density: 0.3 }));
    const rocks = deb.rocks.slice();
    let list = null;
    for (let i = 0; i < 120; i++) {
      f.camY -= 125000 / 60;
      deb.update(f);
      if (i === 60) list = drawn.list;
    }
    assert.equal(drawn.list, list, 'ta sama tablica listy');
    assert.ok(deb.rocks.every((r, i) => r === rocks[i]), 'te same rekordy');
    return drawn.list.map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.r.toFixed(3)}`).join(';');
  };
  if (typeof fxRandom.seed === 'function') assert.equal(run(), run(), 'te same wejścia → ten sam obraz (off ≡ worker przy tym samym strumieniu)');
  else run();
});
