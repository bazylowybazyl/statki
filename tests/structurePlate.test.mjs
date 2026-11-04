// WIĄZANIE GRAFU DYSKU Z POLEM PŁYTY silnika (src/game/structurePlate.js; synteza dema D20 § 2f, § 2g) i sceny habitatu
// dema (dema/zawalenia-budowli/habitat.js — te same liczby co narzędzie scripts/zawalenia-sym.mjs --scena 4,5 i demo) na
// prawdziwym HullBodies: wieża H-T to bryła belek z gry (pirateBaseSolidOf 'H-T').
//
// Pokrycie: mapowanie utrzymania (F.hold = okno smoothstep plateSigma E1 przy liniowej nośności silnika), wiązanie komórek
// z blokami (górna warstwa + bliźniak dolnej), impuls styku do grafu (−n·j / 45² po blokach komórek styku), zabijanie bloków
// otworami (≥ 60%, z bliźniakiem) i zdejmowanie komórek bloków spoza części zakotwiczonej, bilans pędu pola z ciałem w każdym
// kroku, przegląd otworów w tych samych chwilach przy 60 i 120 Hz (odstęp przez ticksAt120), UPADEK (scena 4: utrzymanie 0
// przy dojściu wieży — otwór w kształcie talerza, IoU z pierścieniem 560–880 ≥ 0,7; ten sam otwór przy 60 i 120 Hz;
// D22 — wieża pierwsza na skale, wycinki dysku wyraźnie później i nie przed stykiem wieży), SZYJA (scena 5: utrzymanie 1 —
// rów bez otworu, graf traci ≤ 5% bloków w czasie pokazu — D7), haki bez alokacji. `todo`: pierwsza wyspa dysku po minięciu
// wieży (synteza § 2g — wymaga prefraktury, D22), szyja przy 120 Hz i po 40 s (R15 / E6). Testy nie mierzą czasu ściany.
import test from 'node:test';
import assert from 'node:assert/strict';
import { untilSteady, allocatedBytes } from './helpers/alokacje.mjs';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const SG = await import('../src/game/structureGraph.js');
const SP = await import('../src/game/structurePlate.js');
const { createPlateField, plateCapacity } = await import('../src/game/beamPlateField3D.js');
const { buildClusterDesc } = await import('../src/game/beamRigid3D.js');
const { createHabitatSym, archetypDysku } = await import('../dema/zawalenia-budowli/habitat.js');
HullBodies.init();
HullBodies.warmUpClusters();

const MU = SG.STRUCT_MASS_UNIT;

// Pole dysku (bez silnika) + egzemplarz grafu + wiązanie bez haków (testy wołają je wprost).
function bound(o = {}) {
  const A = archetypDysku();
  const S = SG.createStructure(A, { id: 2 });
  const F = createPlateField(SP.discPlateOptions(A, {}));
  const Pb = SP.createPlateBinding(F, S, { hooks: false, ...o });
  return { A, S, F, Pb };
}

test('mapowanie utrzymania: F.hold daje liniową nośnością silnika σ z okna smoothstep plateSigma (E1) × 45², graf dostaje h', () => {
  const { S, F, Pb } = bound();
  const T = SG.PLATE_TUNE;
  assert.equal(F.capacityHeld, T.sigmaHeld * MU);
  assert.equal(F.capacityFree, T.sigmaFree * MU);
  for (const h of [1, 0.8, 0.5, 0.45, 0.3, 0.2, 0.15, 0.1, 0.05, 0]) {
    SP.plateSetHold(Pb, h);
    const want = SG.plateSigma({ hold: h, holdFree: T.holdFree, holdHeld: T.holdHeld, sigmaFree: T.sigmaFree, sigmaHeld: T.sigmaHeld }) * MU;
    assert.ok(Math.abs(plateCapacity(F) - want) <= 1e-9 * want, `h ${h}: ${plateCapacity(F)} ≠ ${want}`);
    assert.equal(S.hold, h);
  }
  // poza oknem: płasko (≤ holdFree — σ_free, ≥ holdHeld — σ_held)
  SP.plateSetHold(Pb, 0.07); assert.equal(F.hold, 0);
  SP.plateSetHold(Pb, 0.6); assert.equal(F.hold, 1);
});

test('wiązanie: każda komórka dysku ma blok górnej warstwy i bliźniaka dolnej (ten sam rzut), Σ komórek bloków = komórki pola', () => {
  const { A, F, Pb } = bound();
  let cells = 0, sum = 0;
  for (let c = 0; c < Pb.N; c++) {
    if (!(F.thick0[c] > 0)) { assert.equal(Pb.cellUp[c], -1); continue; }
    cells++;
    const b = Pb.cellUp[c], l = Pb.cellLo[c];
    assert.ok(b >= 0 && l >= 0, `komórka ${c} bez bloku`);
    assert.ok(A.z[b] > A.z[l]);
    assert.ok(Math.abs(A.x[b] - A.x[l]) < 1 && Math.abs(A.y[b] - A.y[l]) < 1);
  }
  for (let b = 0; b < A.n; b++) sum += Pb.blockCells[b];
  assert.equal(sum, cells);
  assert.equal(cells, F.alive);
  // pierścień 560…1950 po 45 j. (jak prototyp E1: 5416 komórek)
  assert.equal(cells, 5416);
});

test('styk: reakcja płyty −n·j / 45² rozdzielona po blokach komórek styku (udział = komórki bloku / komórki styku)', () => {
  const { S, F, Pb } = bound();
  // dwa bloki: 3 komórki pierwszego i 1 drugiego
  const byBlock = new Map();
  for (let c = 0; c < Pb.N && byBlock.size < 2; c++) {
    const b = Pb.cellUp[c];
    if (b < 0) continue;
    if (!byBlock.has(b)) byBlock.set(b, []);
  }
  const [b1, b2] = [...byBlock.keys()];
  const cells = [];
  for (let c = 0; c < Pb.N; c++) if (Pb.cellUp[c] === b1 && cells.filter((q) => Pb.cellUp[q] === b1).length < 3) cells.push(c);
  for (let c = 0; c < Pb.N; c++) if (Pb.cellUp[c] === b2) { cells.push(c); break; }
  F._cells = Int32Array.from(cells); F._nCells = cells.length;
  const j = 4000 * MU;
  SP.plateOnContact(Pb, F, null, { impulse: j });
  assert.ok(Math.abs(S.jz[b1] - (-4000 * 3 / 4)) < 1e-9);
  assert.ok(Math.abs(S.jz[b2] - (-4000 / 4)) < 1e-9);
  assert.equal(S.jx[b1], 0); assert.equal(S.jy[b1], 0);
  assert.ok(Math.abs(Pb.fv[0] - 4000) < 1e-9);
  // blok poza częścią zakotwiczoną — jego udział idzie do bliźniaka dolnej warstwy (materiał komórki stoi), a bez
  // obu — przepada
  S.jz.fill(0);
  SG.structureDestroyBlock(S, b2);
  SP.plateOnContact(Pb, F, null, { impulse: j });
  assert.ok(Math.abs(S.jz[Pb.twin[b2]] - (-4000 / 4)) < 1e-9);
  SG.structureDestroyBlock(S, Pb.twin[b2]);
  S.jz.fill(0);
  SP.plateOnContact(Pb, F, null, { impulse: j });
  assert.ok(Math.abs(S.jz[b1] - (-4000 * 3 / 4)) < 1e-9);
  assert.equal(S.jz[b2] + S.jz[Pb.twin[b2]], 0);
});

test('otwory: blok z ≥ 60% komórek-otworów ginie razem z bliźniakiem, reszta jego komórek znika z pola; wyspa — przez plateClearIsland', () => {
  const { A, S, F, Pb } = bound();
  // blok pierścienia 2 (nie przy podporach — bez wysp po jego śmierci)
  let b = -1;
  for (let k = 0; k < A.n; k++) if (!A.anchor[k] && A.level[k] === 2 && Pb.blockCells[k] > 0) { b = k; break; }
  const mine = [];
  for (let c = 0; c < Pb.N; c++) if (Pb.cellUp[c] === b) mine.push(c);
  const need = Math.ceil(0.6 * mine.length);
  for (let i = 0; i < need - 1; i++) { F.thick[mine[i]] = 0; F.alive--; SP.plateOnCellLost(Pb, F, mine[i], 0, 0, 0, 0, 0, -100, 1); }
  assert.equal(SP.plateKillBlocks(Pb), 0, 'poniżej 60% blok stoi');
  F.thick[mine[need - 1]] = 0; F.alive--;
  SP.plateOnCellLost(Pb, F, mine[need - 1], 0, 0, 0, 0, 0, -100, 1);
  assert.equal(Pb.rec.head, need, 'rekord obrazu na każdą komórkę');
  assert.equal(SP.plateKillBlocks(Pb), 1);
  assert.equal(S.dead[b], 2);
  assert.equal(S.dead[Pb.twin[b]], 2);
  const v0 = F.version;
  const cleared = SP.plateSync(Pb);
  assert.equal(cleared, mine.length - need, 'reszta komórek zabitego bloku znika');
  assert.ok(F.version > v0);
  const st = SP.plateStats(Pb);
  assert.equal(st.holes, need); assert.equal(st.killedCells, mine.length - need); assert.equal(st.killedBlocks, 1);
  // IoU „przebicie” liczy otwory zgniotu i resztę zabitego bloku, nie komórki wysp
  assert.ok(SP.plateHoleIoU(Pb, 0, 0, 1950) > 0);
  // wyspa: podpory puszczają → cały dysk jest wyspą, plateClearIsland zdejmuje jej komórki
  for (let k = 0; k < A.n; k++) if (A.anchor[k]) SG.structureReleaseAnchor(S, k);
  SG.stepStructure(S, 1 / 60, 0);
  let id = -1;
  for (let k = 0; k < A.n && id < 0; k++) if (!A.anchor[k] && !S.dead[k] && S.island[k] >= 0) id = S.island[k];
  assert.ok(id >= 0, 'dysk bez podpór jest wyspą');
  const n = SP.plateClearIsland(Pb, id);
  assert.ok(n > 0);
  assert.equal(SP.plateStats(Pb).detached, n);
});

test('przegląd otworów co 4 kroki 1/120 s: blok ginie w tej samej chwili przy 60 i 120 Hz (ODSTĘP przez ticksAt120, zasada 8)', () => {
  // otwory ≥ 60% bloku pierścienia 2 powstają w chwili t0 (siatka 1/60 s, przed krokiem); blok ginie w pierwszym przeglądzie
  // ≥ t0 — przegląd co 1/30 s przy każdym kroku (odstęp to liczba kroków, nie budżet na krok: per-budżet dawał przy 60 Hz
  // przegląd co 8 kroków = 133 ms zamiast 33 ms)
  const t0 = [0, 1 / 60, 3 / 60, 6 / 60, 15 / 60, 25 / 60];
  const killAt = (hz) => {
    const { A, S, F, Pb } = bound();
    const dt = 1 / hz;
    const blocks = [];
    for (let k = 0; k < A.n && blocks.length < t0.length; k++) if (!A.anchor[k] && A.level[k] === 2 && Pb.blockCells[k] > 0) blocks.push(k);
    assert.equal(blocks.length, t0.length);
    const out = new Array(t0.length).fill(-1);
    for (let k = 0; k < hz; k++) {
      for (let i = 0; i < t0.length; i++) {
        if (Math.round(t0[i] * hz) !== k) continue;
        const mine = [];
        for (let c = 0; c < Pb.N; c++) if (Pb.cellUp[c] === blocks[i]) mine.push(c);
        for (let q = 0; q < Math.ceil(0.6 * mine.length); q++) {
          F.thick[mine[q]] = 0; F.alive--;
          SP.plateOnCellLost(Pb, F, mine[q], 0, 0, 0, 0, 0, -100, 1);
        }
      }
      SP.plateStep(Pb, dt, k);
      for (let i = 0; i < t0.length; i++) if (out[i] < 0 && S.dead[blocks[i]]) out[i] = k * dt;
    }
    return out;
  };
  const a = killAt(60), b = killAt(120);
  for (let i = 0; i < t0.length; i++) {
    assert.ok(a[i] >= 0 && b[i] >= 0, `blok ${i} nie zginął (60 Hz ${a[i]}, 120 Hz ${b[i]})`);
    assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `t0 ${t0[i]}: 60 Hz ${a[i]} s, 120 Hz ${b[i]} s`);
    assert.ok(a[i] - t0[i] < 1 / 30 + 1e-9, `t0 ${t0[i]}: przegląd po ${a[i] - t0[i]} s (> 1/30 s)`);
  }
});

test('bilans pędu: klaster przez płytę dysku przy utrzymaniu 0 — Δp ciała − m·g·dt = stats.j − stats.p w każdym kroku, impuls do grafu', () => {
  HullBodies.init();
  const D = HullBodies.engine;
  D.terrains.length = 0;
  for (const f of D.plateFields.slice()) D.removePlateField(f);
  const A = archetypDysku();
  const S = SG.createStructure(A, { id: 3 });
  const F = D.addPlateField(SP.discPlateOptions(A, {}));
  const Pb = SP.createPlateBinding(F, S, {});
  SP.plateSetHold(Pb, 0);
  const desc = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 120, hy: 120, hz: 60, mass: 3e6, id: 0 }], { spacing: 40, maxPoints: 4096 });
  const e = { name: 'taran płyty', isWreck: true };
  const g = 400;
  HullBodies.createCluster(e, desc, { position: { x: 700, y: 0, z: -560 }, velocity: { x: 40, y: 0, z: -900 }, gravity: { x: 0, y: 0, z: -g } });
  const b = e.beamHull.body, m = b.mass, dt = 1 / 60;
  // integrate silnika: v ← (v + g·dt) · exp(−linearDamping · dt), potem impulsy styków (pole płyty)
  const linK = Math.exp(-D.config.linearDamping * dt);
  let crush = 0, maxErr = 0, scale = 0;
  for (let k = 0; k < 90; k++) {
    const vx0 = b.vel.x, vz0 = b.vel.z;
    HullBodies.step(dt, [e]);
    SP.plateStep(Pb, dt, k);
    const djx = m * (b.vel.x - vx0 * linK), djz = m * (b.vel.z - (vz0 - g * dt) * linK);
    const st = F.stats;
    if (st.crushing) crush++;
    maxErr = Math.max(maxErr, Math.abs(djz - (st.jz - st.pz)), Math.abs(djx - (st.jx - st.px)));
    scale = Math.max(scale, Math.abs(st.jz));
  }
  assert.ok(crush > 0, 'klaster przebija płytę (σ_free)');
  assert.ok(scale > 0 && maxErr <= 1e-6 * scale, `bilans: błąd ${maxErr} wobec ${scale}`);
  assert.ok(Pb.fv[0] > 0 && Pb.iv[2] > 0, 'impuls do grafu i otwory');
  HullBodies.release(e);
  D.removePlateField(F);
});

// Scena 4 raz na częstotliwość kroku (prawdziwa bryła belek H-T z gry) — wynik dzielony przez testy upadku, D22 i 60 / 120 Hz.
const upadki = new Map();
function scenaUpadek(hz = 60) {
  if (upadki.has(hz)) return upadki.get(hz);
  const sym = createHabitatSym(HullBodies, 4, { hz });
  const steps = Math.round(12 * sym.hz);
  let holdAtTouch = null, passedAt = -1, iouAt = null;
  for (let k = 0; k < steps; k++) {
    sym.step();
    const tl = sym.timeline();
    if (holdAtTouch === null && tl.dotyk !== null) holdAtTouch = sym.plate.F.hold;
    if (passedAt < 0 && tl.przejscie !== null) { passedAt = sym.t; iouAt = tl.iouPrzejscie; }
  }
  const u = { tl: sym.timeline(), holdAtTouch, passedAt, iouAt, stats: SP.plateStats(sym.plate.Pb) };
  sym.dispose();
  upadki.set(hz, u);
  return u;
}

test('UPADEK (scena 4, utrzymanie 0 przy dojściu wieży): wieża H-T przebija dysk otworem w kształcie talerza — IoU z pierścieniem 560–880 ≥ 0,7', () => {
  const u = scenaUpadek();
  assert.ok(u.tl.dotyk !== null, 'wieża dochodzi do dysku');
  assert.equal(u.holdAtTouch, 0, 'zegar D8 (2,5 s) kończy się przed dojściem wieży');
  assert.ok(u.tl.przebicie !== null && u.stats.holes > 300, `otwory zgniotu: ${u.stats.holes}`);
  assert.ok(u.passedAt > 0, 'wieża mija dysk');
  assert.ok(u.iouAt >= 0.7, `IoU otworu ${u.iouAt}`);
  assert.ok(u.tl.vPrzejscie > 600, `wieża za dyskiem ${u.tl.vPrzejscie} j/s (traci część pędu, nie staje)`);
});

test('D22 (scena 4): wieża pierwsza na skale, wycinki dysku wyraźnie później (≥ 2 s) i nie przed stykiem wieży z dyskiem', () => {
  const u = scenaUpadek();
  const tl = u.tl;
  assert.ok(tl.wiezaNaSkale !== null && tl.wycinekNaSkale !== null, JSON.stringify(tl));
  assert.ok(tl.pierwszyWycinek >= tl.dotyk, `pierwszy wycinek ${tl.pierwszyWycinek} s przed stykiem wieży ${tl.dotyk} s`);
  assert.ok(tl.wycinekNaSkale - tl.wiezaNaSkale >= 2, `wycinek na skale ${tl.wycinekNaSkale} s, wieża ${tl.wiezaNaSkale} s`);
});

// AGENT: synteza dema § 2g chce pierwszej wyspy dysku PO minięciu dysku przez wieżę. Dziś talerz H-T (r 480…~1000) nakrywa
// cały pierścień 0 grafu (jedyne połączenie z podporami), więc reszta dysku odrywa się JEDNĄ wyspą ~0,1 s po przebiciu
// (3,9 s), zanim wieża minie dysk (5,0 s), i spada od spoczynku jednym pierścieniem. Odpadanie wycinkami kolejno od otworu
// wymaga prefraktury / linii załomu (plan § 4.2 p. 5, E3 / E6) albo zawiasu wycinków — decyzja użytkownika (D22).
test.todo('D22 wg syntezy § 2g (scena 4): pierwsza wyspa dysku rodzi się PO minięciu dysku przez wieżę', () => {
  const tl = scenaUpadek().tl;
  assert.ok(tl.przejscie !== null && tl.pierwszyWycinek >= tl.przejscie, `pierwszy wycinek ${tl.pierwszyWycinek} s, minięcie dysku ${tl.przejscie} s`);
});

test('UPADEK 60 / 120 Hz (scena 4): ten sam otwór — IoU ±0,02, otwory zgniotu i reszty bloków zabitych ±10%, te same bloki zabite; D22 przy obu', () => {
  const a = scenaUpadek(60), b = scenaUpadek(120);
  assert.ok(Math.abs(a.iouAt - b.iouAt) <= 0.02, `IoU 60 Hz ${a.iouAt}, 120 Hz ${b.iouAt}`);
  assert.equal(a.stats.killedBlocks, b.stats.killedBlocks, 'bloki zabite otworami');
  // przegląd otworów w tych samych chwilach (ticksAt120): reszty zabitych bloków zdążają zejść z pola przed oderwaniem
  // reszty dysku przy obu częstotliwościach (przegląd co 8 kroków przy 60 Hz dawał 0 reszt wobec ~120 przy 120 Hz)
  const near = (x, y) => Math.abs(x - y) <= 0.1 * Math.max(x, y);
  assert.ok(near(a.stats.holes, b.stats.holes), `otwory zgniotu 60 Hz ${a.stats.holes}, 120 Hz ${b.stats.holes}`);
  assert.ok(near(a.stats.killedCells, b.stats.killedCells), `reszty bloków 60 Hz ${a.stats.killedCells}, 120 Hz ${b.stats.killedCells}`);
  assert.ok(b.tl.wycinekNaSkale - b.tl.wiezaNaSkale >= 2, `120 Hz: wycinek na skale ${b.tl.wycinekNaSkale} s, wieża ${b.tl.wiezaNaSkale} s`);
});

// Scena 5 przez `czas` s (18 — pętla pokazu dema; graf dysku pęka dalej PO spoczynku wieży, więc krótszy przebieg zaniża straty).
function scenaSzyja(hz, czas) {
  const sym = createHabitatSym(HullBodies, 5, { hz });
  for (let k = 0; k < Math.round((czas ?? sym.cfg.czas) * sym.hz); k++) sym.step();
  const tl = sym.timeline();
  sym.dispose();
  return tl;
}

test('SZYJA (scena 5, utrzymanie 1, czas pokazu 18 s): wieża kładzie się bokiem na koronie i dysku — rów bez otworu, graf traci ≤ 5% bloków (D7)', () => {
  const tl = scenaSzyja(60);
  assert.ok(tl.korona !== null && tl.dotyk !== null, `uderzenie: korona ${tl.korona}, dysk ${tl.dotyk}`);
  assert.equal(tl.otwory, 0, 'bez otworów zgniotu');
  assert.ok(tl.row > 0, 'rów w kształcie boku wieży');
  assert.ok(tl.ulamekUtraconych <= 0.05, `utracone bloki ${tl.blokiUtracone} / ${tl.blokow}`);
  assert.equal(tl.koronaOtwory, 0);
});

// AGENT: ryzyko R15 planu (E6). (1) Krok: przy 120 Hz uderzenie zrywa ~6× więcej wiązań dysku (do 9 s: 505 wobec 89 przy
// 60 Hz) przy prawie tej samej historii impulsów płyty, a graf traci 13% bloków w czasie pokazu (×3 przechyłu — cały dysk);
// luka 60 / 120 Hz grafu — test `todo` w structureGraph. (2) Pełzanie: po spoczynku wieży (bez styku z płytą) uszkodzony graf
// pęka dalej pod własnym ciężarem — przy 60 Hz wiązania 1878 → ~1000 i 44 / 316 bloków (14%, wyspa 36 bloków przy ~24 s) po
// 40 s. Oba do zamknięcia w E6 (zmęczenie uszkodzonego grafu, ocena wiązań niezależna od kroku).
test.todo('SZYJA 120 Hz (scena 5, R15 / E6): graf traci ≤ 5% bloków (D7) także przy kroku 1/120 s', () => {
  const tl = scenaSzyja(120);
  assert.ok(tl.ulamekUtraconych <= 0.05, `120 Hz: utracone bloki ${tl.blokiUtracone} / ${tl.blokow}`);
});

test.todo('SZYJA po 40 s (scena 5, R15 / E6): uszkodzony graf dysku nie pęka dalej po spoczynku wieży (≤ 5% bloków)', () => {
  const tl = scenaSzyja(60, 40);
  assert.ok(tl.ulamekUtraconych <= 0.05, `po 40 s: utracone bloki ${tl.blokiUtracone} / ${tl.blokow}`);
});

test('haki i krok wiązania bez alokacji (styk, utrata komórki, krok bez zmian topologii)', async () => {
  const { F, Pb } = bound();
  const cells = [];
  for (let c = 0; c < Pb.N && cells.length < 40; c++) if (Pb.cellUp[c] >= 0) cells.push(c);
  F._cells = Int32Array.from(cells); F._nCells = cells.length;
  const info = { impulse: 1e5 };
  let c0 = 0;
  const call = (i) => {
    SP.plateOnContact(Pb, F, null, info);
    if ((i & 15) === 0) { Pb.hole[cells[c0 % 40]] = 0; SP.plateOnCellLost(Pb, F, cells[c0++ % 40], 1.5, 2.5, 3.5, 0.5, 0.5, -0.5, 2.5); }
    SP.plateStep(Pb, 1 / 60, i * 3 + 1, null);
  };
  for (let i = 0; i < 2000; i++) call(i);
  const per = await untilSteady(() => allocatedBytes(call, 600) / 600, (v) => v < 8, { warm: () => { for (let i = 0; i < 2000; i++) call(i); } });
  assert.ok(per < 8, `${per.toFixed(1)} B na wywołanie`);
});
