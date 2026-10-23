// Ring BUDOWA (Jowisz, ring w budowie — decyzja użytkownika 2026-10-23: „zupełnie inny ring, z pojedynczymi
// »brudnymi« domami, wszędzie pył, gaz, małe części stoją”). Czysta matematyka planu (bez GPU) i pole gazu ringu:
//   • wyspy płyty = zbudowane segmenty (4 porty K-7, 4 tranzyty, luźne), większość obwodu to przerwy;
//   • w przerwie NIC z konstrukcji nie wchodzi w korytarz przelotu |z| < 300 (płaszczyzna gry z = 0) — przerwa jest
//     przelotem, jak w koliderze; na wyspach i frontach płyta (kolizja);
//   • baraki tylko na wyspach (poza frontem, płytami doków i tranzytami), baraki w płaszczyźnie gry = teren kolidera;
//   • gaz: scena `ring` wejścia gazu (kotwica w środku planety, obwiednia wokół obręczy, strugi frontów, płyta
//     w rastrze przeszkód z kolidera gry).
// node --test tests/haloRingBudowa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { haloRingLayoutFor, createHaloRingPlacement, haloLocalToGame } from '../src/game/haloRingPlanets.js';
import { HaloRingCollider } from '../src/game/haloRingCollision.js';
import { haloGapEdgeDistance } from '../src/3d/haloRing/haloRingConstruction.js';
import { haloPortComplexAngles, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';
import { PORT_PAD_H } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { BUD, BUD_KIND, buildBudowaDrones, buildBudowaHouses, buildBudowaStructure, createBudowaPlan, wallAt } from '../src/3d/haloRing/arch/budowaPlan.js';
import { createRingGasField, RING_GAS_VENT_TYPE, RING_GAS_VENT_TYPES } from '../src/game/ringGasField.js';
import { packSpaceGasFrame, createSpaceGasInputState, SPACE_GAS_IN, SPACE_GAS_SCENE } from '../src/game/spaceGasInput.js';

const jupiter = haloRingLayoutFor({ id: 'jupiter' });
const K = jupiter.construction;
const plan = createBudowaPlan(jupiter);
const lights = () => ({ n: 0, add() { this.n++; } });

// zakres z instancji partii (bryła jednostkowa: x, z ∈ [−0,5; 0,5], y ∈ [0; 1]) — zachowawczo po kolumnach macierzy
function* instances(batch) {
  for (let i = 0; i < batch.count; i++) {
    const m = batch.m;
    const o = i * 16;
    const x = m[o + 12]; const y = m[o + 13]; const z = m[o + 14];
    const hx = (Math.abs(m[o + 2]) + Math.abs(m[o + 10])) * 0.5;
    const z0 = z + Math.min(0, m[o + 6]) - hx;
    const z1 = z + Math.max(0, m[o + 6]) + hx;
    // kąt środka bryły (punkt w połowie osi Y)
    const th = Math.atan2(y + m[o + 5] * 0.5, x + m[o + 4] * 0.5);
    // zc — środek bryły w z (partia FG / BG wybierana po środku, belka zaczyna się w p0)
    yield { th, z0, z1, kind: batch.a[i * 4], x, y, z, zc: z + m[o + 6] * 0.5 };
  }
}

test('wyspy: zbudowane segmenty — 4 porty K-7, 4 tranzyty, luźne; większość obwodu to przerwy', () => {
  assert.equal(plan.islands.length, K.segments.length);
  const kinds = plan.islands.map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === 'port').length, 4);
  assert.equal(kinds.filter((k) => k === 'transit').length, 4);
  assert.ok(kinds.filter((k) => k === 'loose').length >= 3);
  const built = plan.islands.reduce((s, i) => s + i.len, 0);
  assert.ok(built / plan.CIRC < 0.45, `zbudowane ${(100 * built / plan.CIRC).toFixed(0)}% obwodu`);
  for (const a of haloPortComplexAngles()) assert.ok(plan.edgeDist(a) > K.front);
  for (const a of haloTransitAngles()) assert.ok(plan.edgeDist(a) > K.front);
});

test('kręgosłup: w przerwie nic nie wchodzi w korytarz przelotu (płaszczyzna gry); FG tylko nad płaszczyzną', () => {
  const L = lights();
  const st = buildBudowaStructure(plan, L);
  assert.ok(st.stats.panels > 500 && st.stats.ribs > 40 && st.stats.parked > 30 && st.stats.welds > 200, JSON.stringify(st.stats));
  assert.equal(st.stats.fronts, K.gaps.length * 2);
  let inGap = 0;
  for (const batch of [st.bg, st.fg]) {
    for (const b of instances(batch)) {
      assert.ok([b.x, b.y, b.z, b.z0, b.z1].every(Number.isFinite));
      // głęboko w przerwie (dalej niż 300 j. od krawędzi): korytarz |z| < 300 wolny
      if (haloGapEdgeDistance(b.th, K) * plan.R > -300) continue;
      inGap++;
      assert.ok(b.z0 >= 300 || b.z1 <= -300, `bryła w korytarzu przelotu: z ${b.z0.toFixed(0)}…${b.z1.toFixed(0)}, θ ${b.th.toFixed(4)}`);
    }
  }
  assert.ok(inGap > 5000, `kręgosłup w przerwach: ${inGap} brył`);
  for (const b of instances(st.fg)) assert.ok(b.zc > jupiter.z.topIn - 1, 'FG tylko nad płaszczyzną gry');
  // stal budowy (rodzaj 9) — kratownica brudna, nie gładka
  let steel = 0;
  for (const b of instances(st.bg)) if (b.kind === BUD_KIND.steel) steel++;
  assert.ok(steel > st.bg.count * 0.6, `stal budowy ${steel} / ${st.bg.count}`);
  // światła robocze: spawanie (faza ≥ 1) i maszty (< 0) dla siatki świateł gry
  assert.equal(st.work.length % 4, 0);
  let welds = 0;
  for (let i = 3; i < st.work.length; i += 4) if (st.work[i] >= 1) welds++;
  assert.equal(welds, st.stats.welds);
});

test('baraki: tylko na wyspach (bez frontu, płyt doków, tranzytów), pojedynczo; w płaszczyźnie gry = teren kolidera', () => {
  const H = plan.houses;
  assert.ok(H.length > 40 && H.length < 200, `baraków ${H.length}`);
  for (const h of H) {
    assert.ok(plan.edgeDist(h.theta) > K.front, 'barak na froncie albo w przerwie');
    assert.notEqual(plan.portClass(h.theta, h.u, h.rad), 2, 'barak na płycie doku');
    assert.equal(plan.nearTransit(h.theta, h.rad / plan.R), false, 'barak w tranzycie');
    assert.ok(Math.abs(h.u) + h.rad < plan.HW, 'barak poza podłogą');
    // teren: dach baraku w obrysie
    assert.ok(Math.abs(plan.heightAt(h.theta, h.u) - h.hgt) < 1e-9 || plan.heightAt(h.theta, h.u) >= h.hgt);
  }
  // bez miasta: na wyspie portu (~30 tys. j.) kilkanaście–kilkadziesiąt baraków
  for (const isl of plan.islands.filter((i) => i.kind === 'port')) {
    const n = H.filter((h) => { let d = h.theta - isl.a0; d -= Math.PI * 2 * Math.floor(d / (Math.PI * 2)); return d < isl.a1 - isl.a0; }).length;
    assert.ok(n >= 5 && n <= 60, `wyspa portu: ${n} baraków`);
  }
  // teren: w przerwie 0, na płycie doku PORT_PAD_H
  assert.equal(plan.heightAt(K.gaps[0].center, 0), 0);
  const site = plan.sites.find((s) => s.kind === 'k7' || s.kind === 'hall') || plan.sites[0];
  assert.equal(plan.heightAt(site.theta, (site.zMin + site.zMax) * 0.5), PORT_PAD_H);
  const parts = buildBudowaHouses(plan, lights());
  assert.equal(parts.count, H.length);
  const nParts = parts.per.reduce((s, p) => s + p.box.count + p.cyl.count, 0);
  assert.ok(nParts > H.length * 10, `detal baraków: ${nParts} brył na ${H.length}`);
  // ściany wysp kawałkami, nie przy frontach
  const g = K.gaps[0];
  assert.equal(wallAt(plan, g.center + g.half + K.front * 0.5, 1), false);
});

test('drony: lot w shaderze (rodzaj 8), przy frontach i wyspach', () => {
  const d = buildBudowaDrones(plan);
  assert.ok(d.count > 200);
  for (let i = 0; i < d.count; i++) {
    assert.equal(d.a[i * 4], BUD_KIND.drone);
    assert.ok(d.a[i * 4 + 2] > 0 && d.a[i * 4 + 3] > 0, 'amplituda i tempo');
  }
  assert.ok(BUD.slot >= 300);
});

test('gaz ringu: obwiednia wokół obręczy, strugi frontów, płyta wysp jako przeszkoda, pakowanie sceny `ring`', () => {
  const planet = { id: 'jupiter', x: 3_000_000, y: -1_200_000 };
  const col = new HaloRingCollider(planet);
  const place = createHaloRingPlacement(planet);
  const f = createRingGasField({ key: 'jupiter', collider: col });
  assert.ok(f);
  assert.equal(createRingGasField({ key: 'mars', collider: new HaloRingCollider({ id: 'mars', x: 0, y: 0 }) }), null, 'ring bez budowy — bez sceny');
  const R = jupiter.radii;
  const at = (th, r) => haloLocalToGame(place, Math.cos(th) * r, Math.sin(th) * r, {});
  // pas pyłu: gęsto przy obręczy, nic daleko
  const g = K.gaps[0];
  const p0 = at(g.center, (R.back + R.rim) * 0.5);
  assert.ok(f.sampleMacro(p0.x, p0.y).weight > 0.3);
  const p1 = at(g.center, R.rim + 40000);
  assert.equal(f.sampleMacro(p1.x, p1.y).weight, 0);
  assert.equal(f.rectTouchesBelt(p0.x - 100, p0.y - 100, p0.x + 100, p0.y + 100), true);
  assert.equal(f.rectTouchesBelt(planet.x - 100, planet.y - 100, planet.x + 100, planet.y + 100), false, 'środek planety');
  // strugi: po dwie na front, z kierunkiem wylotu
  assert.equal(f.vents.length, K.gaps.length * 4);
  for (const v of f.vents) { assert.equal(v.type, RING_GAS_VENT_TYPE); assert.ok(Math.abs(Math.hypot(v.dx, v.dy) - 1) < 1e-9); }
  // przeszkoda: płyta wyspy w bryle, przerwa wolna (kolider gry)
  const giant = f.giants.entries[0].giant;
  const mid = (R.back + R.floorMid) * 0.5;
  const isl = plan.islands.find((i) => i.kind === 'loose');
  const q = at((isl.a0 + isl.a1) * 0.5, mid);
  assert.ok(giant.sampleWorld(q.x, q.y) < 0, 'płyta wyspy = przeszkoda gazu');
  const qg = at(g.center, mid);
  assert.ok(giant.sampleWorld(qg.x, qg.y) > 0, 'przerwa przepuszcza gaz');
  // pakowanie: scena ring, kotwica w środku planety, obwiednia, raster płyty przy wyspie, strugi frontu z kierunkiem pola
  const out = new Float64Array(SPACE_GAS_IN.size);
  const st = createSpaceGasInputState();
  const I = SPACE_GAS_IN;
  const cam = at(g.center + g.half, R.rim);
  packSpaceGasFrame(out, st, { dt: 1 / 60, camX: cam.x, camY: cam.y, halfW: 4000, halfH: 2250, field: f, scene: SPACE_GAS_SCENE.ring,
    anchorX: f.anchorX, anchorY: f.anchorY, sunX: 0, sunY: 0, windowCells: 256, cell: 64, iceTypes: RING_GAS_VENT_TYPES, time: 3, giants: f.giants });
  assert.equal(out[I.scene], SPACE_GAS_SCENE.ring);
  assert.equal(out[I.active], 1);
  assert.equal(out[I.anchorX], planet.x);
  assert.ok(out[I.envMax] > 0.3);
  assert.ok(out[I.jets] >= 1, 'strugi frontu w oknie');
  assert.equal(out[I.rasterOn], 1, 'płyta wyspy w rastrze przeszkód');
  // kierunek ku Słońcu (0, 0), nie ku kotwicy
  const sl = Math.hypot(cam.x, cam.y);
  assert.ok(Math.abs(out[I.sunX] + cam.x / sl) < 1e-9 && Math.abs(out[I.sunY] + cam.y / sl) < 1e-9);
});
