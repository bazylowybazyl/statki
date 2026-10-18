// Powietrze budowli bazy piratów (src/game/story/pirateBaseAtmosphere.js): dekompresja (dławiony wypływ, adiabata),
// kajuty małych wyrw (krótki syk), moduł wypalony nie wieje drugi raz, ogień tylko z tlenem, wyrwy przyczepione do ciał
// (bryła 3D i ciało płaskie), zgniot, stan klatki dla obrazu, determinizm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placePirateBase } from '../src/game/story/pirateBaseSite.js';
import {
  ATMO_TUNE, attachPirateBaseAtmosphere, breach, ignite, noteBaseChunkBreak, noteBaseCrater, noteBaseNodeLost,
  noteBaseNeckSnap, noteBaseBlast, pirateBaseAtmoModules, pirateBaseAtmosphereState, pirateBaseVentFrame,
  stepPirateBaseAtmosphere, pirateBaseAtmoFlicker, detachPirateBaseAtmosphere, rehomePirateBaseVents
} from '../src/game/story/pirateBaseAtmosphere.js';
import { VENT_REC, VENT_MAX, createPirateVentsBlock, applyPirateVentsBlock, createPirateVentsFrame } from '../src/render/blocks/pirateVentsBlock.js';

const DT = 1 / 60;
const place = placePirateBase({ x: 2.5e6, y: -1.2e6 }, 0.7);
const S = () => pirateBaseAtmosphereState();
const mod = (id) => S().byId.get(id);
const run = (sec, fn = null) => { for (let t = 0; t < sec; t += DT) { stepPirateBaseAtmosphere(DT); if (fn) fn(t); } };
const ventById = (id) => S().vents.find((v) => v.id === id) || null;
const fresh = () => attachPirateBaseAtmosphere(place);

test('moduły z układu: bęben, szyb, wieża, dysk, magazyn — objętości dodatnie, przejścia symetryczne', () => {
  const mods = pirateBaseAtmoModules(place.layout);
  const ids = mods.map((m) => m.id);
  for (const id of ['H-E', 'H-S', 'H-W', 'H-N', 'H-C', 'H-T', 'D-1', 'D-8', 'M-1']) assert.ok(ids.includes(id), id);
  for (const id of ['NP', 'P-1', 'P-M', 'M-2']) assert.ok(!ids.includes(id), `${id} bez powietrza`);
  for (const m of mods) {
    assert.ok(m.V > 1e6, `${m.id} objętość`);
    assert.ok(m.z1 > m.z0, `${m.id} zakres z`);
    for (const l of m.links) {
      const o = mods.find((q) => q.id === l.to);
      assert.ok(o.links.some((k) => k.to === m.id), `przejście ${m.id} ↔ ${l.to} w obie strony`);
    }
  }
  // dysk pod płaszczyzną gry, głowa wieży nad nią
  assert.ok(mods.find((m) => m.id === 'D-3').z < -700);
  assert.ok(mods.find((m) => m.id === 'H-T').z > 1000);
});

test('pęknięcie ćwiartki bębna: gwałtownie, potem słabnie, koniec po kilku–kilkunastu s; nie wieje drugi raz', () => {
  fresh();
  const id = noteBaseChunkBreak('H-E', null, {});
  assert.ok(id > 0);
  const v = ventById(id);
  assert.ok(v.main);
  const flows = [];
  let endT = -1;
  run(30, (t) => {
    const u = ventById(id);
    if (Math.abs(t - 0.5) < DT / 2 || Math.abs(t - 1) < DT / 2 || Math.abs(t - 3) < DT / 2) flows.push(u ? u.flow : 0);
    if (!u && endT < 0) endT = t;
  });
  assert.ok(flows[0] > 0.6 && flows[0] < 0.95, `po 0,5 s strumień ${flows[0]}`);
  assert.ok(flows[1] < flows[0] && flows[2] < 0.45 * flows[0], `słabnie: ${flows}`);
  assert.ok(endT > 4 && endT < 25, `koniec po ${endT} s`);
  assert.ok(mod('H-E').spent, 'ćwiartka wypalona');
  // ćwiartka ostygła adiabatycznie w trakcie wypływu (T < 1)
  assert.ok(mod('H-E').T < 1);
  assert.equal(noteBaseChunkBreak('H-E', null, {}), -1, 'drugie pęknięcie wypalonej ćwiartki nie wieje');
  assert.equal(breach({ module: 'H-E', size: 300 }), -1);
});

test('krater broni: krótki syk z kajuty (sekundy), drugi krater obok nie wieje', () => {
  fresh();
  const m = mod('H-W');
  const id = noteBaseCrater('H-W', null, m.gx, m.gy, 0, 24);
  assert.ok(id > 0);
  const v = ventById(id);
  assert.equal(v.main, false, 'mała wyrwa — kajuta');
  let endT = -1;
  run(6, (t) => { if (!ventById(id) && endT < 0) endT = t; });
  assert.ok(endT > 0.4 && endT < 3.5, `syk ${endT} s`);
  assert.ok(mod('H-W').rho > 0.99, 'główna objętość nietknięta (przegrody trzymają)');
  assert.equal(noteBaseCrater('H-W', null, m.gx + 15, m.gy, 0, 24), -1, 'kajuta już opróżniona');
  // krater daleko od pierwszego — nowa kajuta
  assert.ok(noteBaseCrater('H-W', null, m.gx + 300, m.gy + 200, 0, 24) > 0);
});

test('duża wyrwa (taran, zgniot): główna objętość; zgniot sumuje węzły w jedną wyrwę', () => {
  fresh();
  const m = mod('H-S');
  for (let i = 0; i < 300; i++) noteBaseNodeLost('H-S', null, m.gx + (i % 10) * 15, m.gy + Math.floor(i / 10) * 3, 0, 15);
  run(0.3);
  const vs = S().vents.filter((v) => v.module.id === 'H-S');
  assert.equal(vs.length, 1, 'jedna wyrwa zgniotu');
  assert.ok(vs[0].main, '300 węzłów — przegrody puszczają');
  // mało węzłów — kajuta
  fresh();
  for (let i = 0; i < 3; i++) noteBaseNodeLost('H-N', null, mod('H-N').gx + i * 15, mod('H-N').gy, 0, 15);
  run(0.2);
  const vn = S().vents.filter((v) => v.module.id === 'H-N');
  assert.equal(vn.length, 1);
  assert.equal(vn[0].main, false);
});

test('ogień tylko z tlenem: zapłon w szczelnym module płonie, po rozszczelnieniu gaśnie i przechodzi w żarzenie', () => {
  fresh();
  assert.ok(ignite({ module: 'D-2' }));
  run(1.5);
  const d = mod('D-2');
  assert.ok(d.burning && d.fire > 0.5, `pożar ${d.fire}`);
  assert.ok(d.x < ATMO_TUNE.o2, 'ogień zużywa tlen');
  const id = noteBaseChunkBreak('D-2', null, {});
  const v = ventById(id);
  run(0.3);
  assert.ok(v.fire > 0.3, 'języki ognia w wylatującym tlenie');
  let outT = -1;
  run(15, (t) => { if (!d.burning && outT < 0) outT = t; });
  assert.ok(outT > 0 && outT < 10, `ogień zgasł po ${outT} s rozszczelnienia`);
  assert.equal(d.fire, 0);
  // żarzenie gaśnie wykładniczo
  assert.ok(d.smolder < ATMO_TUNE.smolderFromFire);
  // wypalony moduł bez tlenu: zapłon nie rozpala
  run(30);
  assert.equal(ignite({ module: 'D-2' }), false, 'bez powietrza nie płonie');
  assert.equal(mod('D-2').burning, false);
});

test('pęknięcie otwiera grodzie: sąsiad (szyb) uchodzi przez rozerwaną ćwiartkę', () => {
  fresh();
  noteBaseChunkBreak('H-N', null, {});
  run(4);
  assert.ok(mod('H-C').rho < 0.9, `szyb ${mod('H-C').rho}`);
  assert.ok(mod('H-E').rho > 0.999, 'pozostałe ćwiartki za zamkniętymi grodziami');
});

test('wyrwa przyczepiona do bryły 3D: jedzie i obraca się z ciałem, normalna z nim', () => {
  fresh();
  const body = { pos: { x: place.habitat.x, y: -place.habitat.y, z: 1500 }, vel: { x: 0, y: 0, z: -200 },
    angVel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, planar: false, dead: false };
  const tower = { x: body.pos.x, y: -body.pos.y, z: body.pos.z, solid3D: true, beamHull: { body, solid3D: true, dmgKey: 77 } };
  tower.beamHull.entity = tower;
  const id = breach({ module: 'H-T', x: place.habitat.x + 300, y: place.habitat.y, z: 1500, nx: 1, ny: 0, nz: 0, size: 150, entity: tower });
  const v = ventById(id);
  assert.equal(v.solid, true);
  // obrót o 90° wokół z świata silnika (y gry odbite), ciało opada
  const a = Math.PI / 4;
  body.quat = { x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) };
  body.pos.z = 1000;
  stepPirateBaseAtmosphere(DT);
  assert.ok(Math.abs(v.wz - 1000) < 1e-6, `z ${v.wz}`);
  // punkt +300 w osi x silnika po obrocie o +90° → +y silnika = −y gry
  assert.ok(Math.abs(v.wx - place.habitat.x) < 1e-6 && Math.abs(v.wy - (place.habitat.y - 300)) < 1e-6, `${v.wx}, ${v.wy}`);
  assert.ok(Math.abs(v.nx) < 1e-9 && Math.abs(v.ny + 1) < 1e-9, `normalna ${v.nx}, ${v.ny}`);
  assert.equal(v.vz, -200);
  // stan klatki: pozycja dosunięta do czasu renderu (ciało jedzie dalej z prędkością punktu)
  const f = pirateBaseVentFrame(-0.01, DT);
  const o = f.rec.subarray(0, VENT_REC.STRIDE);
  assert.equal(f.n, 1);
  assert.ok(Math.abs(o[VENT_REC.Z] - (1000 + 2)) < 1e-6);
  assert.equal(o[VENT_REC.HOST], 77);
  // ciało znikło — wyrwa dryfuje z ostatnią prędkością
  body.dead = true;
  stepPirateBaseAtmosphere(0.1);
  assert.equal(v.ent, null);
  assert.ok(v.wz < 1000);
});

test('wyrwa przyczepiona do ciała płaskiego: obrót encji obraca punkt i normalną', () => {
  fresh();
  const e = { x: 1000, y: 2000, angle: 0, vx: 50, vy: 0, angVel: 0, dead: false };
  const m = mod('M-1');
  const id = breach({ module: 'M-1', x: 1100, y: 2000, z: 10, nx: 1, ny: 0, nz: 0, size: 40, entity: e });
  const v = ventById(id);
  e.angle = Math.PI / 2;
  stepPirateBaseAtmosphere(DT);
  assert.ok(Math.abs(v.wx - 1000) < 1e-6 && Math.abs(v.wy - 2100) < 1e-6, `${v.wx}, ${v.wy}`);
  assert.ok(Math.abs(v.nx) < 1e-9 && Math.abs(v.ny - 1) < 1e-9);
  assert.equal(v.vx, 50);
  assert.ok(m);
});

test('awans płaskiego odłamu do bryły 3D: wyrwa przechodzi na nową encję; obca wyrwa daleko od ciała zostaje', () => {
  fresh();
  const hx = place.habitat.x, hy = place.habitat.y;
  // płaski odłam ćwiartki z wyrwą zgniotu
  const flat = { x: hx + 1200, y: hy, angle: 0, vx: 0, vy: 0, angVel: 0, dead: false };
  const id = breach({ module: 'H-E', x: hx + 1300, y: hy, z: 0, nx: 1, ny: 0, nz: 0, size: 120, entity: flat });
  // druga wyrwa tego modułu na innym (już martwym) ciele — 3 km dalej
  const other = { x: hx + 4200, y: hy, angle: 0, vx: 0, vy: 0, angVel: 0, dead: false };
  const id2 = breach({ module: 'H-E', x: hx + 4300, y: hy + 40, z: 0, nx: 1, ny: 0, nz: 0, size: 110, entity: other, kind: 'main' });
  stepPirateBaseAtmosphere(DT);
  other.dead = true;
  stepPirateBaseAtmosphere(DT);
  // fizyka upadku: nowa bryła w miejscu odłamu (płaski znika) — przejęcie od rodzica
  const body = { pos: { x: hx + 1200, y: -hy, z: 0 }, vel: { x: 0, y: 0, z: -150 }, angVel: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 }, planar: false, dead: false, radius: 260 };
  const solid = { x: hx + 1200, y: hy, solid3D: true, beamHull: { body, solid3D: true, dmgKey: 5 } };
  solid.beamHull.entity = solid;
  flat.dead = true;
  assert.equal(rehomePirateBaseVents(solid, flat, 'H-E'), 1);
  const v = ventById(id), v2 = ventById(id2);
  assert.equal(v.ent, solid);
  assert.notEqual(v2.ent, solid, 'obca wyrwa 3 km dalej nie przechodzi na bryłę');
  body.pos.z = -400;
  stepPirateBaseAtmosphere(DT);
  assert.ok(Math.abs(v.wz + 400) < 1e-6 && Math.abs(v.wx - (hx + 1300)) < 1e-6, `${v.wx}, ${v.wz}`);
});

test('zerwanie szyi: wyrwa u spodu wieży (z bryłą) i u szczytu szybu', () => {
  fresh();
  const body = { pos: { x: place.habitat.x, y: -place.habitat.y, z: 900 }, vel: { x: 0, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, planar: false, dead: false };
  const tower = { x: 0, y: 0, solid3D: true, beamHull: { body, solid3D: true, dmgKey: 9 } };
  tower.beamHull.entity = tower;
  assert.equal(noteBaseNeckSnap(tower), 2);
  const vt = S().vents.find((v) => v.module.id === 'H-T');
  const vc = S().vents.find((v) => v.module.id === 'H-C');
  assert.ok(vt && vt.ent === tower && vt.nz < -0.9, 'wieża: w dół wieży');
  assert.ok(vc && vc.nz > 0.9, 'szyb: w górę');
});

test('wybuch w module zapala go (paliwo z rur, rozpad); poza bazą — nic', () => {
  fresh();
  const m = mod('M-1');
  const n = noteBaseBlast(m.gx, m.gy, 400);
  run(0.2);
  assert.ok(n >= 1 && m.burning, 'magazyn płonie');
  assert.equal(noteBaseBlast(m.gx + 1e6, m.gy, 400), 0);
});

test('stan klatki → blok migawki → lustro: te same liczby; sufit wyrw', () => {
  fresh();
  // pęknięcia (długie wyrwy) w wielu modułach naraz — sufit wyrw: najsłabsze wypierane
  const ids = ['H-E', 'H-S', 'H-W', 'H-N', 'H-C', 'H-T', 'M-1', 'D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6', 'D-7', 'D-8'];
  for (let k = 0; k < VENT_MAX + 6; k++) {
    const m = mod(ids[k % ids.length]);
    const a = k * 0.7;
    breach({ module: m.id, x: m.gx + Math.cos(a) * 900, y: m.gy + Math.sin(a) * 900, z: m.z, size: 90 + (k % 5) * 30, kind: 'main' });
  }
  run(0.1);
  assert.equal(S().vents.length, VENT_MAX, 'sufit wyrw');
  assert.ok(S().stats.dropped >= 1);
  // kajuty: nowa kajuta w module najwcześniej po cabinEvery
  const w = mod('M-1');
  fresh();
  assert.ok(noteBaseCrater('M-1', null, w.gx, w.gy, 0, 20) > 0);
  assert.equal(noteBaseCrater('M-1', null, w.gx + 600, w.gy, 0, 20), -1, 'za szybko po poprzedniej');
  run(ATMO_TUNE.cabinEvery + 0.05);
  assert.ok(noteBaseCrater('M-1', null, w.gx + 600, w.gy, 0, 20) > 0);
  const f = pirateBaseVentFrame(0, DT);
  const blk = createPirateVentsBlock();
  const B = { f64: new Float64Array(blk.f64) };
  blk.pack(B, { pirateVents: f });
  const mir = applyPirateVentsBlock(B, createPirateVentsFrame());
  assert.equal(mir.has, true);
  assert.equal(mir.n, f.n);
  for (let i = 0; i < f.n * VENT_REC.STRIDE; i++) assert.equal(mir.rec[i], f.rec[i]);
});

test('światła wnętrza: rozszczelniona ćwiartka miga, bez powietrza gaśnie; reszta świeci', () => {
  fresh();
  const qi = mod('H-S').qi;
  noteBaseChunkBreak('H-S', null, {});
  let minQ = 1;
  run(1, () => { minQ = Math.min(minQ, pirateBaseAtmoFlicker().drumQ[qi]); });
  assert.ok(minQ < 0.8, `miganie ${minQ}`);
  run(25);
  const fl = pirateBaseAtmoFlicker();
  assert.ok(mod('H-S').spent);
  assert.ok(fl.drumQ[qi] <= ATMO_TUNE.lightEmergency + 1e-9, `ćwiartka bez powietrza ciemna: ${fl.drumQ[qi]}`);
  for (let q = 0; q < 4; q++) if (q !== qi) assert.ok(fl.drumQ[q] > 0.97, `ćwiartka ${q} świeci`);
  assert.ok(fl.tech > 0.97 && fl.disc > 0.97);
  // wieża po wylocie powietrza (zerwana szyja) — okna głowy gasną
  noteBaseNeckSnap(null);
  run(30);
  assert.ok(pirateBaseAtmoFlicker().tech <= ATMO_TUNE.lightEmergency + 1e-9);
});

test('determinizm: ten sam przebieg — te same liczby (bez Math.random)', () => {
  const trace = () => {
    fresh();
    noteBaseChunkBreak('H-E', null, {});
    noteBaseChunkBreak('D-4', null, {});
    ignite({ module: 'H-T' });
    noteBaseChunkBreak('H-T', null, {});
    const out = [];
    run(6, (t) => { if (Math.round(t * 60) % 30 === 0) out.push(...S().vents.map((v) => v.flow + v.fire * 3 + v.spark * 7)); });
    return out;
  };
  const rnd = Math.random;
  Math.random = () => { throw new Error('Math.random w atmosferze'); };
  try {
    const a = trace();
    const b = trace();
    assert.deepEqual(a, b);
  } finally { Math.random = rnd; }
  detachPirateBaseAtmosphere();
  assert.equal(breach({ module: 'H-E', size: 200 }), -1, 'bez bazy — nic');
});

test('blok migawki bazy: światła wnętrza (głowa wieży, ćwiartki bębna) w obie strony', async () => {
  const { createPirateBaseBlock, createPirateBaseMirror, applyPirateBaseBlock } = await import('../src/render/blocks/pirateBaseBlock.js');
  const blk = createPirateBaseBlock();
  const B = { f64: new Float64Array(blk.f64) };
  const state = { hidden: false, habitatDead: false, alarm: true, bays: 0, berths: [1, 0, 1], habitat: 0.9, disc: 0.7, fuel: 1,
    warehouse: 0.5, tech: 0.06, drumQ: [1, 0.06, 0.8, 1], sun: { x: 1, y: 2 }, daylight: 0.3 };
  blk.pack(B, { pirateBase: state, pirateBaseDt: 0.016 }, { resizeBlock() { throw new Error('resize'); } });
  const m = applyPirateBaseBlock(B, createPirateBaseMirror());
  assert.equal(m.state.tech, 0.06);
  assert.deepEqual(m.state.drumQ, [1, 0.06, 0.8, 1]);
  assert.deepEqual(m.state.berths, [1, 0, 1]);
  // stan bez pól świateł (dawny kształt) — jak habitat
  blk.pack(B, { pirateBase: { ...state, tech: undefined, drumQ: undefined }, pirateBaseDt: 0 }, {});
  const m2 = applyPirateBaseBlock(B, createPirateBaseMirror());
  assert.equal(m2.state.tech, 0.9);
  assert.deepEqual(m2.state.drumQ, [0.9, 0.9, 0.9, 0.9]);
});
