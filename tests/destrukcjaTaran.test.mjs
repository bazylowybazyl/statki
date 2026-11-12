// Odbiór prawa kontaktu v2 silnika belek w grze (audyt docs/AUDYT-destruktor-3d-2026-10-14.md, R1–R9): prawdziwy
// HullBodies + worldBodies + baza piratów, Atlas ze sprite'a gry — skrypt scripts/destrukcja-taran-sym.mjs (ten sam,
// którym mierzono przed / po), krok 60 Hz (gra) i 120 Hz (dema, testy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';

const script = fileURLToPath(new URL('../scripts/destrukcja-taran-sym.mjs', import.meta.url));
const out = execFileSync(process.execPath, [script, '--tryb', 'czolo,musniecie,wycof,statek,szyja', '--v', '1500,3000', '--dt', '60,120'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
const rows = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
// szyja przy ciągu W+Shift (150 j/s² do 1500) — ma nie dojechać do szyi
const outW = execFileSync(process.execPath, [script, '--tryb', 'szyja', '--v', '1500', '--ciag', '150', '--dt', '60,120'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
const rowsW = outW.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const czolo = (hz, v) => rows.find((r) => r.hz === hz && r.v === v && r.drum && r.atlas?.penEnd !== undefined && !r.tryb);
const musn = (hz, v) => rows.find((r) => r.hz === hz && r.v === v && r.atlas?.vxEnd !== undefined);
const wycof = (hz) => rows.find((r) => r.hz === hz && r.reverseFrom !== undefined);
const statek = (hz, kind, v) => rows.find((r) => r.hz === hz && r.kind === kind && r.v === v);
const szyja = (hz, v) => rows.find((r) => r.hz === hz && r.v === v && r.phase);

// Od 2026-11-11 habitat to miasto: tor czołowy (oś x habitatu, ćwiartka S) trafia wieżowiec zewnętrznego pierścienia, a za nim
// wewnętrzny. RING_FACE — głębokość lica wewnętrznego wieżowca od lica zewnętrznego (dawniej pierścień bębna za ścianą: 470).
const RING_FACE = (() => {
  const H = createPirateBaseLayout().habitat;
  const box = (b) => { const hx = (b.ux ? b.w : b.d) / 2, hz = (b.ux ? b.d : b.w) / 2; return { x0: b.x - hx, x1: b.x + hx, z1: b.z + hz, ring: b.ring }; };
  const S = H.buildings.filter((b) => b.quadrant === 'H-S').map(box);
  const face = Math.max(...S.filter((q) => q.ring === 1 && q.x0 <= 0 && q.x1 >= 0).map((q) => q.z1));
  const inner = Math.max(...S.filter((q) => q.ring === 0 && q.x0 <= 280 && q.x1 >= -280).map((q) => q.z1));
  return face - inner;
})();

test('taran czołowy: 1500 j/s (W+Shift) przechodzi wieżowiec zewnętrzny i staje w wewnętrznym, 3000 j/s (szarża) przebija oba — przy 60 i 120 Hz', () => {
  for (const hz of [60, 120]) {
    const a = czolo(hz, 1500), b = czolo(hz, 3000);
    assert.ok(a && b, `wiersze ${hz} Hz`);
    assert.ok(a.atlas.penEnd < RING_FACE + 150, `${hz} Hz 1500: nos ${a.atlas.penEnd} — wewnętrzny wieżowiec (lico ${RING_FACE}) ma trzymać`);
    assert.ok(b.atlas.penEnd > RING_FACE + 250, `${hz} Hz 3000: nos ${b.atlas.penEnd} — szarża przebija wewnętrzny wieżowiec`);
    assert.ok(a.drum.peakMaxR <= 1.3, `${hz} Hz: rozciągnięcie widoczne w renderze ${a.drum.peakMaxR}`);
    assert.ok(a.drum.insidePeak <= 20, `${hz} Hz 1500: węzły ściany w kadłubie ${a.drum.insidePeak}`);
  }
  // 60 ≈ 120 Hz (R4)
  const p60 = czolo(60, 1500).atlas.penEnd, p120 = czolo(120, 1500).atlas.penEnd;
  assert.ok(Math.abs(p60 - p120) / Math.max(p60, p120) <= 0.2, `głębokość 1500 j/s: 60 Hz ${p60}, 120 Hz ${p120}`);
});

// Od 2026-11-11 burta zahacza o NAROŻNIK wieżowca (słup narożny jest kotwicą), nie o styczną do łuku ściany bębna: przy locie
// przelotowym (1200 j/s) strata jak dawniej (< 15%), przy wolnym (600 j/s) narożnik odpycha mocniej (< 30%).
test('muśnięcie narożnika wieżowca o 25 j.: wzdłuż ruchu traci < 15% (1200 j/s) i < 30% (600 j/s), odpycha bokiem (normalna z geometrii)', () => {
  for (const hz of [60, 120]) {
    for (const [v, keep] of [[1200, 0.85], [600, 0.7]]) {
      const m = musn(hz, v);
      assert.ok(m, `wiersz ${hz} Hz ${v}`);
      assert.ok(m.atlas.vxEnd >= m.v * keep, `${hz} Hz ${m.v}: vx ${m.atlas.vxEnd}`);
      assert.ok(Math.abs(m.atlas.vyEnd) >= 5, `${hz} Hz ${m.v}: odepchnięcie boczne ${m.atlas.vyEnd}`);
    }
  }
});

test('wycofanie ciągiem wstecznym ze ściany < 2 s', () => {
  for (const hz of [60, 120]) {
    const w = wycof(hz);
    assert.ok(w && w.exitT > 0, `${hz} Hz: nos wyszedł ze ściany`);
    assert.ok(w.exitT - w.reverseFrom < 2, `${hz} Hz: ${(w.exitT - w.reverseFrom).toFixed(2)} s`);
  }
});

test('Atlas mijający niszczyciel z zakładem 20 j. nie porywa go z własną prędkością', () => {
  for (const hz of [60, 120]) {
    const s = statek(hz, 'musniecie', 1500);
    assert.ok(s, `wiersz ${hz} Hz`);
    assert.ok(Math.hypot(s.destroyer.vx, s.destroyer.vy) < 300, `${hz} Hz: niszczyciel ${s.destroyer.vx}, ${s.destroyer.vy}`);
    assert.ok(s.atlas.vx > 1400, `${hz} Hz: Atlas ${s.atlas.vx}`);
  }
});

// Silnik 3D (2026-10-15, prośba użytkownika: „ma się przechylić powoli / średnio wolno jak wieża i uderzyć BOKIEM,
// a bok wieży ma się rozwalić, płaszczyć jak w Teardown”): wieża (H-T) to bryła 3D na przegubie w nasadzie.
// Od 2026-11-11 (miasto): szarża liczy się z masą taranu z gry (skrypt: --taranMasa, domyślnie 2 = BASE_INTEGRITY_TUNE.chargeRamMass)
// — bez niej Atlas klinuje się między wieżowcami wewnętrznego pierścienia i nie dochodzi do podstawy wieży. Wieża kładzie się
// na wieżowcach (dachy ich ciał ~200 j. nad płaszczyzną), więc uderza przy mniejszym przechyle niż o koronę bębna i gniecie się mniej.
test('wieża habitatu: szarża od prawej zrywa ją, wieża 3D przewraca się powoli w prawo, kładzie się bokiem na wieżowcach; W+Shift — nie', () => {
  for (const hz of [60, 120]) {
    const s = szyja(hz, 3000);
    assert.ok(s, `wiersz ${hz} Hz`);
    assert.equal(s.phase, 'landed', `${hz} Hz: wieża osiadła`);
    assert.ok(s.frozen > 0, `${hz} Hz: wieża zamarzła w spoczynku`);
    // taran leci w −x (od prawej do lewej) → podcięta wieża przewraca się w +x
    assert.ok(s.fall.x > 0.9, `${hz} Hz: kierunek upadku ${s.fall.x}, ${s.fall.y}`);
    // powoli / średnio wolno: pierwsze uderzenie kilka sekund po zerwaniu
    assert.ok(s.impactT > 3 && s.impactT < 9, `${hz} Hz: uderzenie ${s.impactT} s po zerwaniu`);
    // bokiem: przy pierwszym uderzeniu wieża mocno przechylona (nie spada pionowo w dół)
    assert.ok(s.tiltAtImpactDeg >= 40, `${hz} Hz: przechył przy uderzeniu ${s.tiltAtImpactDeg}°`);
    assert.ok(s.impact.x > 300, `${hz} Hz: miejsce uderzenia ${s.impact.x}`);
    // bok się gniecie (zgniot lokalny — reszta wieży sztywna: tłumienie brył, HULL_BODY_CONFIG.solidNodeDamping), wieża
    // nie rozsypuje się w pył i leży po stronie upadku
    assert.ok(s.tower.disp1 >= 0.01 * s.tower.nodes0, `${hz} Hz: zgnieciona wieża ${s.tower.disp1} / ${s.tower.nodes0}`);
    assert.ok(s.tower.live >= 0.8 * s.tower.nodes0, `${hz} Hz: żywe węzły wieży ${s.tower.live} / ${s.tower.nodes0}`);
    assert.ok(s.tower.end.x > 300 && Math.abs(s.tower.end.y) < s.tower.end.x, `${hz} Hz: spoczynek ${s.tower.end.x}, ${s.tower.end.y}`);
    const w = rowsW.find((r) => r.hz === hz && r.phase);
    assert.ok(w && w.phase === 'attached', `${hz} Hz: W+Shift (1500 j/s) nie zrywa szyi`);
  }
});
