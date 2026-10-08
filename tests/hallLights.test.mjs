// Oświetlenie hali K-7 i źródła gazu (2026-10-07): oprzyrządowanie (haloPortK7Lights.js — lampy, reflektory,
// migające soczewki, harmonogram zaworów), lustro CPU migania ↔ stałe shadera hali, soczewki w bryłach K-7
// (kod migania w instancji), źródła gazu (hallGasSources.js — sączenie przewodów, upust, zerwanie rygla, zawory).
// Obraz w prawdziwej grze: node scripts/webgpu/hala-swiatla-gra.mjs
// node --test tests/hallLights.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { createK7Layout, k7HeightToZ, K7_HEIGHTS } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const L7 = await import('../src/3d/haloRing/haloPortK7Lights.js');
const { K7_BEACON, K7_BEACON_GRID, K7_BEACON_LOOK, K7_VENT_WARN, K7_VENT_DUR, k7BeaconLevel, k7LightRig, k7VentEnvelope, k7BeaconClock } = L7;
const { buildK7Scene, K7_INSTANCE_STRIDE } = await import('../src/3d/haloRing/haloPortK7Build.js');
const { HALL_DUST_IN, HALL_DUST_SERVICE, hallDustDomain } = await import('../src/3d/gasField/hallDustLayout.js');
const { HALL_GAS_EVENT, HALL_GAS_MAX, HALL_GAS_TUNE, createHallGasSources, writeHallGasSources } = await import('../src/3d/gasField/hallGasSources.js');

const L = createK7Layout();
const RIG = k7LightRig(L);
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('oprzyrządowanie: lampy i reflektory w hali, soczewki nad płaszczyzną lotu (FG) albo na pokładzie (BG)', () => {
  assert.ok(RIG.lamps.length >= 6 && RIG.lamps.length <= 8, 'lampy hali mieszczą się w 16 lampach shadera z zatokami');
  assert.ok(RIG.spots.length >= 6 && RIG.spots.length <= 10, 'reflektory ≤ MAX_SPOTS shadera');
  const inHall = (x, z, m = 200) => Math.abs(x) <= L.halfWidth + m && z >= L.backZ - m && z <= L.frontZ + L.apronDepth + m;
  for (const l of RIG.lamps) assert.ok(inHall(l.x, l.z) && k7HeightToZ(l.y) > 0, 'lampa nad halą');
  for (const s of RIG.spots) {
    assert.ok(inHall(s.x, s.z), 'reflektor w hali');
    assert.ok(Math.abs(Math.hypot(...s.dir) - 1) < 1e-9, 'oś jednostkowa');
    assert.ok(s.dir[1] < 0, 'snop w dół (przecina gaz)');
    assert.ok(s.cosOuter < s.cosInner, 'stożek wewnętrzny węższy (bez NaN ze smoothstep)');
  }
  const kinds = new Set(RIG.beacons.map((b) => b.kind));
  for (const k of [K7_BEACON.OBSTRUCTION, K7_BEACON.RABBIT, K7_BEACON.EDGE, K7_BEACON.STROBE, K7_BEACON.VENT]) assert.ok(kinds.has(k), `rodzaj ${k}`);
  assert.ok(kinds.has(K7_BEACON.CLEAR) || kinds.has(K7_BEACON.HOLD), 'narożniki stanowisk');
  for (const b of RIG.beacons) {
    assert.ok(inHall(b.x, b.z, 400), `soczewka w hali ${b.x},${b.z}`);
    if (b.set === 'fg') assert.ok(k7HeightToZ(b.y) > 0, 'FG nad płaszczyzną lotu');
    else assert.ok(b.y < K7_HEIGHTS.hullBottom, 'BG na pokładzie (pod gazem)');
    assert.ok(K7_BEACON_LOOK[b.kind], 'barwa rodzaju');
  }
  // każdy zawór ma kogut z tym samym harmonogramem
  for (let i = 0; i < RIG.vents.length; i++) {
    const v = RIG.vents[i];
    const b = RIG.beacons.find((q) => q.vent === i);
    assert.ok(b && b.kind === K7_BEACON.VENT && b.phase === v.phase && b.period === v.period, v.id);
    assert.equal(3600 % v.period, 0, 'okres dzieli zawinięcie zegara (bez skoku)');
  }
});

test('miganie: poziomy w zakresie, przeszkodowe razem, stroboskopy podejścia biegną ku stanowisku', () => {
  for (let k = 1; k <= 7; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 60; t += 0.01) {
      const v = k7BeaconLevel(k, t, 0.37, 30);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    assert.ok(lo >= 0 && hi <= 1.25, `rodzaj ${k}: ${lo}..${hi}`);
    if (k !== K7_BEACON.HOLD) assert.ok(hi - lo > 0.3, `rodzaj ${k} miga`);
  }
  const obs = RIG.beacons.filter((b) => b.kind === K7_BEACON.OBSTRUCTION);
  assert.ok(obs.every((b) => b.phase === 0), 'przeszkodowe w jednym takcie');
  // pas C-01: najjaśniejszy stroboskop przesuwa się od bramy ku stanowisku
  const lane = RIG.beacons.filter((b) => b.kind === K7_BEACON.RABBIT && b.x === L.lanes[0].x).sort((a, b) => b.z - a.z);
  const brightest = (t) => lane.reduce((best, b, i) => (k7BeaconLevel(b.kind, t, b.phase) > k7BeaconLevel(lane[best].kind, t, lane[best].phase) ? i : best), 0);
  const t0 = 9.0;   // początek cyklu 1,8 s
  const i0 = brightest(t0 + 0.02);
  const i1 = brightest(t0 + 0.02 + 0.055 * 5);
  assert.ok(lane[i1].z < lane[i0].z, `błysk biegnie ku stanowisku: ${lane[i0].z} → ${lane[i1].z}`);
  // zegar
  assert.ok(k7BeaconClock(3600500) < 1 && k7BeaconClock(1500) === 1.5);
});

test('lustro CPU migania ↔ shader hali: te same stałe wzorów', () => {
  const tsl = strip(readFileSync(new URL('../src/3d/haloRing/haloPortK7.js', import.meta.url), 'utf8'));
  const body = tsl.slice(tsl.indexOf('function k7BeaconLevelTSL'), tsl.indexOf('function k7BeaconColorTSL'));
  for (const c of ['div(1.5)', 'smoothstep(0.0, 0.05, f)', 'smoothstep(0.28, 0.46, f)', 'div(2.4)', 'pulse(0.3)', 'div(1.8)', 'mul(-18.0)',
    'TWO_PI / 3.2', 'div(1.4)', 'mul(-45.0)', 'step(0.18, s)', 'TWO_PI * 2.4', 'float(0.2)', 'mul(0.8)', 'assign(0.55)']) {
    assert.ok(body.includes(c), `shader: ${c}`);
  }
  const cpu = strip(readFileSync(new URL('../src/3d/haloRing/haloPortK7Lights.js', import.meta.url), 'utf8'));
  for (const c of ['/ 1.5', 'smooth(0, 0.05, f)', 'smooth(0.28, 0.46, f)', '/ 2.4', 'pulse(s, 0.3)', '/ 1.8', '-s * 18', '/ 3.2', '/ 1.4', '-s * 45',
    's >= 0.18', '2.4 * u', '0.2 + 0.8', 'return 0.55']) {
    assert.ok(cpu.includes(c), `CPU: ${c}`);
  }
});

test('zawór: kogut ostrzega przed upustem, upust trwa K7_VENT_DUR', () => {
  const env = { warn: 0, gas: 0, u: 0 };
  k7VentEnvelope(0.5, 0, 30, env);
  assert.ok(env.warn > 0.9 && env.gas === 0, 'najpierw kogut');
  k7VentEnvelope(K7_VENT_WARN + 1, 0, 30, env);
  assert.ok(env.gas > 0.9, 'upust');
  k7VentEnvelope(K7_VENT_WARN + K7_VENT_DUR + 1, 0, 30, env);
  assert.ok(env.gas === 0 && env.warn === 0, 'cisza do następnego cyklu');
});

test('bryły K-7: soczewki z kodem migania w instancji, narożniki stanowisk do przełączania, oprawy reflektorów', () => {
  const scene = buildK7Scene(L, {});
  let blink = 0;
  for (const set of ['bg', 'fg']) {
    const data = scene.sets[set].cyl;
    for (let i = 0; i < data.length; i += K7_INSTANCE_STRIDE) if (data[i + 13] > 0.5) blink++;
  }
  assert.equal(blink, RIG.beacons.length, 'jedna soczewka na światło');
  assert.equal(scene.beaconSlots.length, 16, '4 narożniki × 4 stanowiska capital');
  for (const s of scene.beaconSlots) {
    const kind = scene.sets[s.set].cyl[s.index * K7_INSTANCE_STRIDE + 13];
    assert.ok(kind === K7_BEACON.CLEAR || kind === K7_BEACON.HOLD, 'narożnik stanowiska');
  }
  assert.ok(scene.rig && scene.rig.spots.length === RIG.spots.length);
});

// ── źródła gazu ──────────────────────────────────────────────────────────────
const DOM = hallDustDomain(L);
const IN = new Float64Array(HALL_DUST_IN.size);
const S = HALL_DUST_SERVICE;
const setPose = (berth, p) => {
  const o = HALL_DUST_IN.service + berth * S.stride;
  IN[o + S.lock] = p.lock; IN[o + S.extension] = p.extension; IN[o + S.flow] = p.flow; IN[o + S.vent] = p.vent;
  IN[o + S.occupied] = p.occupied; IN[o + S.seat] = p.seat ?? p.extension;
};
const rec = (J, i) => ({
  x: J[i * 12], z: J[i * 12 + 1], len: J[i * 12 + 4], ring: J[i * 12 + 5], speed: J[i * 12 + 7], vapor: J[i * 12 + 9],
  dust: J[i * 12 + 10], radial: J[i * 12 + 11]
});
const recs = (J, first, n) => Array.from({ length: n }, (_, k) => rec(J, first + k));

test('źródła gazu: złączka tam, gdzie niesie ją ramię; buchy dookoła złączki przy ryglowaniu i odryglowaniu; upust, zawory, limit', () => {
  const src = createHallGasSources(L, RIG);
  const J = new Float32Array(64 * 12);
  assert.equal(src.hoses.length, 8, '2 przewody × 4 stanowiska capital');
  IN[HALL_DUST_IN.clock] = 5;
  for (let b = 0; b < 4; b++) setPose(b, { lock: 0, extension: 0, flow: 0, vent: 0, occupied: 0 });
  let n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  assert.ok(n <= HALL_GAS_MAX && n >= 20, `rekordy: ${n}`);
  assert.equal(src.eventCount, 0, 'bez buchów w spoczynku');
  assert.ok(recs(J, 16, n).every((r) => r.radial === 0), 'w spoczynku same stożki');
  // złączki złożonych ramion sączą parę przy słupkach
  const coupler0 = rec(J, 16);
  assert.ok(coupler0.vapor > HALL_GAS_TUNE.seep * 0.15 && coupler0.vapor < HALL_GAS_TUNE.seep * 1.2, `sączenie ${coupler0.vapor}`);
  assert.ok(coupler0.x > 0 && coupler0.x < DOM.nx && coupler0.z > 0 && coupler0.z < DOM.ny, 'w domenie (komórki)');
  const H0 = src.hoses[0];
  const anchorCell = (H0.anchor.x - DOM.x0) / DOM.h;
  assert.ok(Math.abs(coupler0.x - anchorCell) < 140 / DOM.h, 'złożone ramię: złączka przy słupku');
  // ramię nad wlewem, złączka na wlewie: rekord złączki na wlewie stanowiska
  setPose(0, { lock: 0, extension: 1, seat: 1, flow: 0, vent: 0, occupied: 1 });
  writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  const atPort = rec(J, 16);
  assert.ok(Math.abs(atPort.x - (H0.target.x - DOM.x0) / DOM.h) < 1 && Math.abs(atPort.z - (H0.target.z - DOM.z0) / DOM.h) < 1, 'złączka na wlewie');
  // RYGLOWANIE: rygiel przechodzi przez 0,5 — mały buch promieniowy dookoła złączki (oba przewody stanowiska)
  setPose(0, { lock: 0.6, extension: 1, seat: 1, flow: 0, vent: 0, occupied: 1 });
  n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  assert.equal(src.eventCount, 2, 'zdarzenia ryglowania: 2 przewody');
  assert.equal(src.events[0], HALL_GAS_EVENT.latch);
  let radial = recs(J, 16, n).filter((r) => r.radial === 1);
  assert.equal(radial.length, 2, 'buchy ryglowania');
  assert.ok(radial[0].vapor > HALL_GAS_TUNE.latch * 0.8 && radial[0].speed > 10, `buch ryglowania: ${radial[0].vapor}`);
  assert.ok(Math.abs(radial[0].ring * DOM.h - HALL_GAS_TUNE.ring) < DOM.h, 'para z obwodu złączki');
  setPose(0, { lock: 1, extension: 1, seat: 1, flow: 1, vent: 0, occupied: 1 });
  for (let i = 0; i < 90; i++) writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  assert.equal(src.stats.latches, 0, 'buch ryglowania zgasł');
  // ODRYGLOWANIE: rygiel w dół przez 0,5 — duży buch promieniowy (wszystkie strony po obwodzie)
  setPose(0, { lock: 0.4, extension: 1, seat: 1, flow: 0, vent: 0, occupied: 1 });
  n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  assert.equal(src.eventCount, 2);
  assert.equal(src.events[0], HALL_GAS_EVENT.unlatch);
  radial = recs(J, 16, n).filter((r) => r.radial === 1);
  assert.equal(radial.length, 2, 'buchy odryglowania');
  assert.ok(radial[0].vapor > HALL_GAS_TUNE.burst * 0.8 && radial[0].speed > 40 && radial[0].len > 20, `buch: para ${radial[0].vapor}, prędkość ${radial[0].speed}`);
  assert.ok(src.stats.bursts >= 2, 'oba przewody stanowiska');
  // buch gaśnie
  for (let i = 0; i < 150; i++) n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  assert.ok(recs(J, 16, n).every((r) => r.radial === 0), 'buch zgasł');
  // kontrolowany upust (poza vent): stożek z zaworu przedmuchu złączki
  setPose(1, { lock: 1, extension: 1, seat: 1, flow: 0, vent: 1, occupied: 1 });
  n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  const vents = recs(J, 16, n).filter((r) => r.radial === 0 && r.vapor > HALL_GAS_TUNE.vent * 0.9);
  assert.ok(vents.length >= 2 && vents[0].len > 20, `upust: ${vents.length}`);
  // zawór magazynu w oknie upustu
  const w0 = RIG.vents.find((v) => v.kind === 'wall');
  IN[HALL_DUST_IN.clock] = (K7_VENT_WARN + 1 - w0.phase + w0.period * 10) % w0.period;
  n = writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);
  const wx = (w0.x - DOM.x0) / DOM.h;
  const wallRec = recs(J, 16, n).find((r) => Math.abs(r.x - wx) < 0.01);
  assert.ok(wallRec && wallRec.vapor > HALL_GAS_TUNE.wall * 0.8, `upust magazynu: ${wallRec?.vapor}`);
  // limit miejsca
  assert.ok(writeHallGasSources(src, J, 16, 5, IN, DOM, 1 / 60) === 5);
  // pełna hala w buchach mieści się w limicie rekordów źródeł
  for (let b = 0; b < 4; b++) setPose(b, { lock: 1, extension: 1, seat: 1, flow: 0, vent: 0, occupied: 1 });
  for (let i = 0; i < 70; i++) writeHallGasSources(src, J, 16, 40, IN, DOM, 1 / 60);   // buchy ryglowania gasną
  for (let b = 0; b < 4; b++) setPose(b, { lock: 0, extension: 1, seat: 1, flow: 0, vent: 0.5, occupied: 1 });
  n = writeHallGasSources(src, J, 16, HALL_GAS_MAX, IN, DOM, 1 / 60);
  assert.ok(n <= HALL_GAS_MAX && recs(J, 16, n).filter((r) => r.radial === 1).length === 8, `wszystkie buchy w limicie: ${n}`);
  // deterministyczne, bez Math.random
  const code = strip(readFileSync(new URL('../src/3d/gasField/hallGasSources.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(code, /Math\.random/);
});

test('światła hali w siatce: rodzaje z zasięgiem mają barwę, krawędzie dróg bez światła (oszczędność)', () => {
  assert.equal(K7_BEACON_GRID[K7_BEACON.EDGE], null);
  for (const k of [K7_BEACON.OBSTRUCTION, K7_BEACON.RABBIT, K7_BEACON.VENT, K7_BEACON.STROBE]) {
    assert.ok(K7_BEACON_GRID[k].range > 300 && K7_BEACON_GRID[k].gain > 0);
  }
});
