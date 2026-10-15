// Rozdzielczość dynamiczna (src/game/dynamicResolution.js): skala renderu schodzi stopniami, gdy czas GPU klatki
// przekracza budżet docelowego FPS, wraca przy zapasie; histereza (czasy trzymania, przewidywanie kosztu stopnia
// wyżej), zmiany rzadko (resize celów najwyżej co ~1 s), bez próbek — bez zmian. Klej: pętla gry, Core3D.setRenderScale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const D = await import('../src/game/dynamicResolution.js');
const G = await import('../src/game/graphicsQuality.js');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const T = { ...D.DYN_RES_TUNE };

// Symulacja: `ms(scale, t)` — czas GPU klatki przy skali; próbka co `every` klatek (jak gpuTimerSampleEvery 4),
// z opóźnieniem `lag` klatek (wynik znaczników czasu przychodzi później — liczył skalę sprzed lag klatek).
function run({ base = 1, fps = 60, ms, seconds = 30, hz = 60, every = 4, lag = 6, tune = T, st = D.createDynResState(), t0 = 0 }) {
  const hist = [];
  const scales = [];
  const changes = [];
  let scale = st.scale > 0 ? st.scale : base;
  for (let f = 0; f < seconds * hz; f++) {
    const t = t0 + f / hz;
    scales.push(scale);
    const measured = f >= lag && f % every === 0 ? ms(scales[f - lag], t) : null;
    const s = D.stepDynRes(st, t, base, fps, measured, tune);
    if (s !== scale) changes.push({ t: +t.toFixed(3), from: scale, to: s });
    scale = s;
    hist.push(s);
  }
  return { st, hist, changes, scale };
}
// Koszt GPU: część stała + część ∝ liczbie pikseli (skala²).
const cost = (fixed, perPx) => (s) => fixed + perPx * s * s;

test('drabina: najwyżej 3 stopnie poniżej skali z opcji, nie mniej niż 50%', () => {
  assert.deepEqual(D.dynResLevels(1), [1, 0.85, 0.75, 0.67]);
  assert.deepEqual(D.dynResLevels(1.25), [1.25, 1, 0.85, 0.75]);
  assert.deepEqual(D.dynResLevels(0.85), [0.85, 0.75, 0.67, 0.5]);
  assert.deepEqual(D.dynResLevels(0.67), [0.67, 0.5]);
  assert.deepEqual(D.dynResLevels(0.5), [0.5]);
  for (const s of G.GFX_SETTINGS.renderScale.values) {
    const lv = D.dynResLevels(s);
    assert.equal(lv[0], s, 'pierwszy stopień = skala z opcji');
    for (let i = 1; i < lv.length; i++) assert.ok(lv[i] < lv[i - 1] && D.DYN_RES_LADDER.includes(lv[i]), `${s}: ${lv}`);
  }
});

test('wyłączona: skala = skala z opcji, zero zmian; włączona bez próbek (brak znaczników czasu GPU) — też', () => {
  const off = run({ fps: 0, ms: cost(5, 40) });
  assert.ok(off.hist.every((s) => s === 1));
  assert.equal(off.st.changes, 0);
  const noSamples = run({ ms: () => NaN });
  assert.ok(noSamples.hist.every((s) => s === 1));
});

test('przeciążenie: schodzi stopniami do skali, przy której mieści się w budżecie, i tam zostaje', () => {
  // 60 FPS (16,7 ms): przy 1,0 — 26 ms, 0,85 — 20,6, 0,75 — 17,5, 0,67 — 15,0 (< 0,9 × budżet = 15).
  const r = run({ ms: cost(3, 23), seconds: 40 });
  assert.equal(r.scale, 0.67);
  assert.deepEqual(r.changes.map((c) => c.to), [0.85, 0.75, 0.67], 'po kolei, bez skoków i powrotów');
  for (let i = 1; i < r.changes.length; i++) assert.ok(r.changes[i].t - r.changes[i - 1].t >= T.minInterval - 1e-9, 'zmiany co ≥ minInterval');
  assert.ok(r.changes[0].t >= T.downHold, 'nie od pierwszej próbki');
  // Lżej przeciążona: wystarczy jeden stopień.
  const one = run({ ms: cost(4, 13), seconds: 40 });   // 1,0 → 17 ms; 0,85 → 13,4
  assert.equal(one.scale, 0.85);
  assert.equal(one.changes.length, 1);
});

test('zapas: wraca w górę dopiero po upHold i upInterval, bez oscylacji', () => {
  // Bitwa 10 s (ciężko), potem spokój (lekko) — w dół w bitwie, w górę po niej, potem stoi.
  const ms = (s, t) => (t < 10 ? cost(3, 23)(s) : cost(2, 6)(s));
  const r = run({ ms, seconds: 60 });
  assert.equal(r.scale, 1, 'po bitwie z powrotem 100%');
  const ups = r.changes.filter((c) => c.to > c.from);
  assert.ok(ups.length >= 1);
  for (const u of ups) assert.ok(u.t >= 10 + T.upHold, `w górę za wcześnie: ${u.t}`);
  // Po powrocie do 1,0 — bez dalszych zmian (stabilnie).
  const last = r.changes[r.changes.length - 1];
  assert.equal(last.to, 1);
  assert.ok(r.hist.slice(Math.ceil((last.t + 1) * 60)).every((s) => s === 1));
});

test('histereza: koszt na granicy nie daje migania (≤ 2 zmiany na minutę)', () => {
  // Przy 1,0 — 15,3 ms (tuż nad 0,9 × 16,7), przy 0,85 — 11,6: w dół raz; w górę przewidziane 15,3 > 0,72 × budżet — stoi.
  const r = run({ ms: cost(2.2, 13.1), seconds: 60 });
  assert.ok(r.st.changes <= 2, `zmian: ${r.st.changes}`);
  // Szum ±20% próbek wokół kosztu na granicy — dalej rzadko.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const noisy = run({ ms: (s) => cost(2.2, 13.1)(s) * (0.8 + 0.4 * rnd()), seconds: 120 });
  assert.ok(noisy.st.changes <= 4, `zmian przy szumie: ${noisy.st.changes}`);
  for (let i = 1; i < noisy.changes.length; i++) assert.ok(noisy.changes[i].t - noisy.changes[i - 1].t >= T.minInterval - 1e-9);
});

test('pojedyncze skoki (wybuch 0,3 s) nie zmieniają skali', () => {
  const r = run({ ms: (s, t) => (Math.floor(t) % 5 === 0 && t % 1 < 0.3 ? 40 : cost(2, 6)(s)), seconds: 30 });
  assert.equal(r.st.changes, 0);
});

test('nowa skala z opcji / inne FPS — sterownik od nowa (z nowej skali), 120 FPS ciaśniej niż 60', () => {
  const st = D.createDynResState();
  run({ ms: cost(3, 23), seconds: 20, st });
  assert.equal(st.scale, 0.67);
  // Gracz ustawia 85% — start od 0,85 (drabina od niej), bez natychmiastowego skoku.
  D.stepDynRes(st, 20.01, 0.85, 60, null);
  assert.equal(st.scale, 0.85);
  assert.equal(st.changed, true);
  assert.deepEqual(st.levels, [0.85, 0.75, 0.67, 0.5]);
  // Wyłączenie — od razu skala z opcji.
  run({ base: 1, ms: cost(3, 23), seconds: 10, st, t0: 30 });
  D.stepDynRes(st, 41, 1, 0, null);
  assert.equal(st.scale, 1);
  // Ten sam koszt, 120 FPS (8,3 ms) — schodzi niżej niż przy 60 FPS.
  const at60 = run({ ms: cost(1, 9), seconds: 30 });
  const at120 = run({ ms: cost(1, 9), fps: 120, seconds: 30 });
  assert.equal(at60.scale, 1);
  assert.ok(at120.scale < 1);
  // Inne docelowe FPS przy włączonej opcji — stopień zostaje (bez skoku do 100% i z powrotem), potem w górę po stopniu.
  const keep = D.createDynResState();
  run({ ms: cost(3, 23), seconds: 20, st: keep });
  assert.equal(keep.scale, 0.67);
  const up = run({ ms: cost(3, 23), fps: 20, seconds: 30, st: keep, t0: 20 });
  assert.equal(up.hist[0], 0.67, '60 → 20 FPS: bez skoku');
  assert.deepEqual(up.changes.map((c) => c.to), [0.75, 0.85, 1], 'zapas przy 20 FPS — w górę po stopniu');
  for (let i = 1; i < up.changes.length; i++) assert.ok(up.changes[i].t - up.changes[i - 1].t >= T.upInterval - 1e-9);
  // Nadpisanie z konsoli (DynamicResTune.targetFps) bije opcję.
  const forced = run({ fps: 0, ms: cost(3, 23), seconds: 20, tune: { ...T, targetFps: 60 } });
  assert.equal(forced.scale, 0.67);
});

test('klej: krok w pętli gry, resize tylko przy zmianie stopnia, opcja w panelu', () => {
  assert.equal(G.normalizeGfxValue('dynamicRes', 60), '60');
  assert.equal(G.normalizeGfxValue('dynamicRes', 'x'), 'off');
  assert.equal(G.defaultGfx().dynamicRes, 'off', 'domyślnie wyłączona');
  assert.ok(!G.GFX_PRESET_KEYS.includes('dynamicRes'), 'preferencja poza presetami');
  assert.equal(G.gfxDynamicTargetFps('off'), 0);
  assert.equal(G.gfxDynamicTargetFps('120'), 120);
  const html = src('index.html');
  const loop = html.indexOf('function loop(now) {');
  const call = html.indexOf('stepDynamicResolution(now);', loop);
  const firstReturn = html.indexOf('return;', loop);
  assert.ok(loop > 0 && call > loop && call < firstReturn, 'krok przed gałęzią pauzy (render trwa też w pauzie)');
  assert.match(html, /if \(dynRes\.changed && Core3D\.renderScale !== scale\) \{\s*Core3D\.setRenderScale\(scale\);/);
  for (const v of ['off', '60', '120']) assert.ok(html.includes(`data-gfx-dyn-res="${v}"`), `chip ${v}`);
  const core = src('src/3d/core3d.js');
  assert.match(core, /if \(type === 'render'\) \{ this\.gpuFrameMs = ms; this\.gpuFrameSamples\+\+; \}/);
});
