// GOSPODARZ ZAWALENIA (src/game/structureCollapse.js; synteza dema D20 § 2e, § 2g) na prawdziwym HullBodies: graf nośny E1
// + klastry E2, sceny dema (dema/zawalenia-budowli/scenariusze.js, symulacja.js — te same liczby co narzędzie
// scripts/zawalenia-sym.mjs i demo). Testy nie mierzą czasu ściany (budżety krokami); alokacje — do stanu ustalonego JIT.
//
// Pokrycie: kikut bez przenikania (punkty styku cienkich płyt), D11 — przechył i ruina ku stronie ostrzału (±x, ±y),
// przegub pęka przy 40 ± 3° (wieża na pomoście nad pustką) i przy zastoju z narożnikiem na ziemi, front κ 0,2 → ziemia /
// κ 1 → stop, kikut poziomu L znika w kroku FRONT L, respawn zachowuje pęd i moment (±1%), impuls wyspy nie ginie po ocenie
// części zakotwiczonej, tempo D12 (dach na ziemi g 80 / g 400 w 2,0–2,6 z tłumieniem i bez), te same zerwania przy g 400
// i 80 do oderwania, determinizm 3×, 60 / 120 Hz ±10%, sufity klastrów, nic głębiej niż 2 promienie pod podłożem,
// spoczynek po 30 s, kroki bez narodzin bez alokacji.
import test from 'node:test';
import assert from 'node:assert/strict';
import { untilSteady, allocatedBytes } from './helpers/alokacje.mjs';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const SG = await import('../src/game/structureGraph.js');
const SC = await import('../src/game/structureCollapse.js');
const { createScenaSym, archetypWiezy } = await import('../dema/zawalenia-budowli/symulacja.js');
const { PODLOZE, scenaUstaw, STRONY } = await import('../dema/zawalenia-budowli/scenariusze.js');
HullBodies.init();
HullBodies.warmUpClusters();

const W = SG.STRUCT_EV_STRIDE, EV = SG.STRUCT_EV;

// Jedna wieża W-1 (ziarno 5) na gruncie sceny; bateria z `strona` jak w scenie 1 (albo bez — ładunek / ręczne obciążenia).
function wieza(o = {}) {
  return {
    nr: 0, nazwa: 'test', przewin: 0, czas: 20, podloze: PODLOZE,
    wieze: [{ id: 'w', ziarno: o.ziarno ?? 5, g: o.g ?? 400, x: o.x ?? 0, y: 0, yaw: o.yaw ?? 0, nadPodlozem: o.nad ?? 0 }],
    bateria: o.bateria === null ? null : { strona: o.strona ?? '+x', co: 0.2, od: 0, do: 6, bron: 'bateria', ziarno: o.salwa ?? 11, pas: 70, auto: true },
    ladunek: o.ladunek ?? null, kappa: o.kappa ?? null
  };
}

function fnv(h, arr) {
  const f = arr instanceof Float64Array ? arr : Float64Array.from(arr);
  const u = new Uint32Array(f.buffer, f.byteOffset, f.length * 2);
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// Przebieg sceny: każdy krok — callback each(sym, s). Zwraca wynik z `done(sym)` (przed dispose).
function run(cfg, opts, seconds, each = null, done = null) {
  const sym = createScenaSym(HullBodies, cfg, opts);
  const steps = Math.round(seconds * sym.hz);
  try {
    for (let s = 0; s < steps; s++) {
      sym.step();
      if (each && each(sym, s) === false) break;
    }
    return done ? done(sym) : null;
  } finally { sym.dispose(); }
}

// Środek masy klastrów-wysp gospodarza (świat silnika) — ruina
function ruinCom(h) {
  let M = 0, x = 0, y = 0;
  for (const r of h.cls) {
    if (!r.alive || r.kind !== 0) continue;
    const m = r.f[3];
    M += m; x += m * r.body.pos.x; y += m * r.body.pos.y;
  }
  return M > 0 ? { x: x / M, y: y / M, M } : null;
}

test('kikut: punkty styku poziomów bez przenikania (cienkie płyty i rdzenie kondygnacji 35 j. — prostopadłościany styku)', () => {
  const A = archetypWiezy(5, 400);
  const H = SC.createCollapseHost(A, { bodies: HullBodies, origin: { x: 0, y: 0, z: 156 }, ground: PODLOZE });
  try {
    const P = [];
    let pts = 0;
    for (const r of H.cls) {
      const b = r.body, g = b.rg;
      pts += g.n;
      for (let i = 0; i < g.n; i++) P.push([b.pos.x + g.lx[i], b.pos.y + g.ly[i], b.pos.z + g.lz[i], g.r[i], r.k]);
    }
    assert.equal(H.cls.length, A.nLevels, 'zamrożony klaster na każdy poziom');
    assert.ok(H.cls.every((r) => r.body.anchored), 'kikut zamrożony');
    let worst = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      if (P[i][4] === P[j][4]) continue;
      const p = P[i], q = P[j], dz = p[2] - q[2];
      if (dz > 80 || dz < -80) continue;
      const d = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + dz * dz);
      worst = Math.max(worst, p[3] + q[3] - d);
    }
    assert.ok(worst <= 1e-6, `przenikanie kul sąsiednich poziomów ${worst.toFixed(2)} j. (${pts} punktów)`);
    // masa kikuta = masa budowli × 45² (bloki z prostopadłościanami)
    let M = 0;
    for (const r of H.cls) M += r.f[3];
    assert.ok(Math.abs(M / (A.totalMass * SG.STRUCT_MASS_UNIT) - 1) < 1e-9, `masa kikuta ${M}`);
  } finally { SC.collapseDispose(H); }
});

// D11 × 4 strony (wspólne przebiegi: sufity klastrów, podłoże)
const SIDES = new Map();
function sideRun(strona) {
  if (SIDES.has(strona)) return SIDES.get(strona);
  let maxCl = 0, maxAwake = 0, depth = 0;
  const probe = { depth: 0, clusters: 0 };
  const res = run(wieza({ strona }), { hz: 60 }, 13, (sym, s) => {
    if (s % 15) return;
    const h = sym.hosts[0];
    SC.collapseProbe(h, probe);
    depth = Math.max(depth, probe.depth);
    maxCl = Math.max(maxCl, HullBodies.clusterCount());
    maxAwake = Math.max(maxAwake, HullBodies.engine.rigidPerf.awake);
  }, (sym) => {
    const h = sym.hosts[0];
    return { tl: SC.collapseTimeline(h), com: ruinCom(h), o: { ...h.origin }, st: SC.collapseStats(h) };
  });
  res.maxCl = maxCl; res.maxAwake = maxAwake; res.depth = depth;
  SIDES.set(strona, res);
  return res;
}

test('D11: wieża przechyla się i kładzie W STRONĘ strzałów (+x, −x, +y, −y): zawias, ruina ku stronie ostrzału', () => {
  for (const s of ['+x', '-x', '+y', '-y']) {
    const r = sideRun(s), d = STRONY[s];
    assert.ok(r.tl.detach > 0 && r.tl.hinge > 0, `${s}: oderwanie ${r.tl.detach}, zawias ${r.tl.hinge}`);
    assert.ok(r.tl.maxTilt > 60, `${s}: przechył najwyższy ${r.tl.maxTilt.toFixed(1)}°`);
    assert.ok(r.com, `${s}: ruina — klastry wysp`);
    const off = (r.com.x - r.o.x) * d[0] + (r.com.y - r.o.y) * d[1];   // świat silnika = układ archetypu (yaw 0)
    assert.ok(off > 150, `${s}: środek masy ruiny ${off.toFixed(0)} j. ku stronie ostrzału`);
  }
});

test('sufity: klastry ≤ 256, aktywne ≤ 160; żaden punkt klastra głębiej niż 2 promienie pod podłożem', () => {
  for (const s of ['+x', '-x', '+y', '-y']) {
    const r = sideRun(s);
    assert.ok(r.maxCl <= 256 && r.maxAwake <= 160, `${s}: klastry ${r.maxCl}, aktywne ${r.maxAwake}`);
    assert.ok(r.depth <= 2, `${s}: najgłębiej ${r.depth.toFixed(2)} promienia pod podłożem`);
    assert.equal(r.st.clusterCap, 0, `${s}: bez sufitu createCluster`);
  }
});

test('przegub: na pomoście nad pustką pęka przy 40 ± 3° (kąt z grafu, radiany silnika), kikut pod krawędzią zmiażdżony, wieża spada; na gruncie — zastój z narożnikiem na ziemi', () => {
  const up = run(wieza({ nad: 900 }), { hz: 60 }, 9, null, (sym) => ({ ...SC.collapseTimeline(sym.hosts[0]), st: SC.collapseStats(sym.hosts[0]) }));
  assert.equal(up.breakMode, 'kat', `pęknięcie: ${up.breakMode}`);
  assert.ok(Math.abs(up.jointTilt - 40) <= 3, `kąt pęknięcia ${up.jointTilt.toFixed(2)}°`);
  // przechył 40° przemiata spodem wyspy ~240 j. — kikut pod krawędzią (kondygnacje 0–1) idzie w gruz (reguła geometryczna);
  // front startuje, gdy pod wyspą został kikut, inaczej wieża spada wolna
  assert.ok(up.frontStart >= up.jointBroken || up.st.crushed >= 20, `front ${up.frontStart} s, zmiażdżone bloki kikuta ${up.st.crushed}`);
  assert.ok(up.roofGround > up.jointBroken, `dach na ziemi ${up.roofGround} s po przegubie ${up.jointBroken} s`);
  const gr = sideRun('+x').tl;
  assert.equal(gr.breakMode, 'zastoj', 'na gruncie róg siada na ziemi przed 40°');
  assert.ok(gr.jointTilt > 15 && gr.jointTilt < 40, `zastój przy ${gr.jointTilt.toFixed(1)}°`);
});

test('front: κ 0,2 schodzi do ziemi, κ 1 staje; kikut poziomu L znika w kroku zdarzenia FRONT L', () => {
  const cfg = (kappa) => ({ ...scenaUstaw(3, { kappa }), przewin: 0 });
  const seen = [];
  const low = run(cfg(0.2), { hz: 60 }, 8, (sym) => {
    const h = sym.hosts[0], S = h.S;
    for (let j = 0; j < S.evCount; j++) {
      if (S.ev[j * W] !== EV.FRONT) continue;
      const L = S.ev[j * W + 2];
      const k = h.stumpCl[L];
      seen.push({ L, alive: k >= 0 && h.cls[k].alive, dead: h.A.level.every((l, b) => l !== L || h.A.anchor[b] || h.S.dead[b] || h.S.island[b] !== -1) });
    }
  }, (sym) => SC.collapseTimeline(sym.hosts[0]));
  assert.equal(low.frontEndKind, 'ziemia', `κ 0,2: koniec frontu ${low.frontEndKind}`);
  assert.deepEqual(low.frontLevels.map((f) => f.level), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(seen.length, 13);
  for (const s of seen) {
    assert.equal(s.alive, false, `poziom ${s.L}: klaster kikuta zwolniony w kroku FRONT`);
    assert.ok(s.dead, `poziom ${s.L}: bloki kikuta martwe`);
  }
  const hi = run(cfg(1), { hz: 60 }, 8, null, (sym) => SC.collapseTimeline(sym.hosts[0]));
  assert.equal(hi.frontEndKind, 'stop', `κ 1: ${hi.frontEndKind}`);
  assert.ok(hi.frontLevels.length >= 1 && hi.frontLevels.length <= 3, `κ 1: ${hi.frontLevels.length} poziomy`);
});

// Wolna wyspa wysoko nad gruntem: cała wieża bez kondygnacji 0 (ładunek), w locie z ruchem i obrotem.
function freeIsland() {
  const sym = createScenaSym(HullBodies, wieza({ bateria: null, nad: 6000 }), { hz: 60 });
  const h = sym.hosts[0];
  SC.collapseCharge(h, 0, 2);
  let isl = null;
  for (let s = 0; s < 60 && !isl; s++) {
    sym.step();
    isl = h.cls.find((r) => r.alive && r.kind === 0 && r.nb > 100) || null;
  }
  return { sym, h, isl };
}

function momenta(h) {
  const P = [0, 0, 0], L = [0, 0, 0];
  for (const r of h.cls) {
    if (!r.alive || r.kind !== 0) continue;
    const b = r.body, m = b.mass, q = b.quat;
    P[0] += m * b.vel.x; P[1] += m * b.vel.y; P[2] += m * b.vel.z;
    L[0] += m * (b.pos.y * b.vel.z - b.pos.z * b.vel.y); L[1] += m * (b.pos.z * b.vel.x - b.pos.x * b.vel.z); L[2] += m * (b.pos.x * b.vel.y - b.pos.y * b.vel.x);
    // spin: R I Rᵀ ω
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    const I = b.inertiaLocal, o = b.angVel;
    const lw = [R[0] * o.x + R[3] * o.y + R[6] * o.z, R[1] * o.x + R[4] * o.y + R[7] * o.z, R[2] * o.x + R[5] * o.y + R[8] * o.z];
    const li = [I[0] * lw[0] + I[1] * lw[1] + I[2] * lw[2], I[3] * lw[0] + I[4] * lw[1] + I[5] * lw[2], I[6] * lw[0] + I[7] * lw[1] + I[8] * lw[2]];
    L[0] += R[0] * li[0] + R[1] * li[1] + R[2] * li[2]; L[1] += R[3] * li[0] + R[4] * li[1] + R[5] * li[2]; L[2] += R[6] * li[0] + R[7] * li[1] + R[8] * li[2];
  }
  return { P, L };
}
const norm = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const diff = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test('respawn: podział wyspy w locie zachowuje pęd i moment pędu (±1%), dzieci z pozą i polem prędkości rodzica', () => {
  const { sym, h, isl } = freeIsland();
  try {
    assert.ok(isl, 'wyspa całej wieży (kondygnacja 0 zniszczona)');
    assert.equal(isl.phase, SC.COLLAPSE_PHASE.FREE, 'bez frontu (najniższy poziom 0)');
    HullBodies.driveCluster(isl.entity, null, { x: 120, y: -80, z: 40 }, { x: 0.15, y: -0.25, z: 0.1 }, { gravity: true });
    sym.step();
    SC.collapseCharge(h, 9, 2);
    let births = SC.collapseStats(h).births, checked = 0;
    for (let s = 0; s < 30 && checked < 3; s++) {
      sym.drive(); sym.pre(); sym.physics();
      const a = momenta(h);
      sym.post();
      const st = SC.collapseStats(h);
      if (st.births === births) continue;
      births = st.births;
      const b = momenta(h);
      const dP = norm(diff(a.P, b.P)) / norm(a.P), dL = norm(diff(a.L, b.L)) / norm(a.L);
      assert.ok(dP < 0.01, `pęd: zmiana ${(dP * 100).toFixed(3)}%`);
      assert.ok(dL < 0.01, `moment pędu: zmiana ${(dL * 100).toFixed(3)}%`);
      checked++;
    }
    assert.ok(checked >= 1, 'podział wyspy urodził klastry-dzieci');
    assert.ok(h.cls.filter((r) => r.alive && r.kind === 0 && r.nb > 20).length >= 2, 'dwie duże części');
  } finally { sym.dispose(); }
});

test('impuls styku wyspy nie ginie po ocenie części zakotwiczonej (bufor gospodarza → structureSolveIsland)', () => {
  const { sym, h, isl } = freeIsland();
  try {
    assert.ok(isl);
    const M = isl.f[3], J = 400 * M;   // Δv 400 j/s — uderzenie
    const blk = isl.blocks[0], e = isl.entity, b = isl.body;
    const before = SC.collapseStats(h).solvedImpulse;
    // hak w świecie GRY (y w dół); punkt — środek masy klastra
    h.onClusterContact(e, e.beamHull, blk, J, 0, 0, b.pos.x, -b.pos.y, b.pos.z);
    // krok: ocena części zakotwiczonej (zeruje S.jx) idzie przed rozwiązaniem wyspy
    let solved = 0;
    for (let s = 0; s < 4; s++) { sym.step(); solved = SC.collapseStats(h).solvedImpulse - before; if (solved > 0) break; }
    const expect = J / SG.STRUCT_MASS_UNIT * h.T.impactScale;
    assert.ok(Math.abs(solved / expect - 1) < 0.01, `impuls do grafu wyspy ${solved.toFixed(1)} / ${expect.toFixed(1)}`);
    assert.ok(SC.collapseStats(h).solves >= 1);
  } finally { sym.dispose(); }
});

// Scena 1 (lewa g 400, prawa g 80): zerwania do oderwania, oś czasu, spoczynek
const S1 = new Map();
function scene1(tl, hz = 60, seconds = 30) {
  const key = `${tl}:${hz}:${seconds}`;
  if (S1.has(key)) return S1.get(key);
  const breaks = [[], []], det = [false, false];
  let awake = -1;
  const res = run(scenaUstaw(1), { hz, tlumienie: tl }, seconds, (sym) => {
    sym.hosts.forEach((h, i) => {
      if (det[i]) return;
      const S = h.S;
      for (let j = 0; j < S.evCount; j++) {
        const o = j * W;
        if (S.ev[o] === EV.BREAK) breaks[i].push(`${S.ev[o + 2]}@${Math.round(S.ev[o + 1] * hz)}`);
        if (S.ev[o] === EV.ISLAND && S.ev[o + 14] === -1 && S.ev[o + 13] >= 0.3 * h.A.totalMass) det[i] = true;
      }
    });
  }, (sym) => {
    awake = 0;
    for (const h of sym.hosts) awake += SC.collapseStats(h).awake;
    return { tl: sym.hosts.map((h) => SC.collapseTimeline(h)), st: sym.hosts.map((h) => SC.collapseStats(h)) };
  });
  res.breaks = breaks; res.awake = awake;
  S1.set(key, res);
  return res;
}

test('D12: dach na ziemi g 80 / g 400 (od oderwania) w 2,0–2,6, z tłumieniem obrotu silnika i bez', () => {
  for (const tl of [1, 0]) {
    const r = scene1(tl);
    const [a, b] = r.tl;
    assert.ok(a.roofGround > 0 && b.roofGround > 0, `tłumienie ${tl}: dach ${a.roofGround} / ${b.roofGround}`);
    const ratio = (b.roofGround - b.detach) / (a.roofGround - a.detach);
    assert.ok(ratio >= 2 && ratio <= 2.6, `tłumienie ${tl}: g 80 / g 400 = ${ratio.toFixed(2)} (${(a.roofGround - a.detach).toFixed(2)} / ${(b.roofGround - b.detach).toFixed(2)} s)`);
  }
});

test('g 400 i g 80 (J broni × g/400): te same zerwania do oderwania (wiązania, kolejność, kroki)', () => {
  const r = scene1(1);
  assert.ok(r.breaks[0].length > 20, `zerwania przed oderwaniem: ${r.breaks[0].length}`);
  assert.deepEqual(r.breaks[1], r.breaks[0]);
});

test('spoczynek: po 30 s wszystkie klastry śpią albo są zamrożone', () => {
  const r = scene1(1);
  assert.equal(r.awake, 0, `w ruchu: ${r.st.map((s) => s.awake)}`);
});

test('60 / 120 Hz: oderwanie, zawias i dach na ziemi ±10% (od startu)', () => {
  const a = scene1(1, 60), b = scene1(1, 120, 24);
  for (let i = 0; i < 2; i++) {
    for (const k of ['detach', 'roofGround']) {
      const x = a.tl[i][k], y = b.tl[i][k];
      assert.ok(x > 0 && y > 0 && Math.abs(y / x - 1) <= 0.1, `wieża ${i} ${k}: 60 Hz ${x?.toFixed(2)} s, 120 Hz ${y?.toFixed(2)} s`);
    }
  }
});

test('determinizm: 3 przebiegi sceny 1 — hasz póz, zdarzeń grafu i rekordów obrazu bit w bit', () => {
  const hashes = [];
  for (let k = 0; k < 3; k++) {
    let h32 = 2166136261;
    run(scenaUstaw(1), { hz: 60 }, 8, (sym) => {
      for (const h of sym.hosts) {
        h32 = fnv(h32, h.S.ev.subarray(0, h.S.evCount * W));
        for (const r of h.cls) if (r.alive) { const b = r.body; h32 = fnv(h32, [b.pos.x, b.pos.y, b.pos.z, b.quat.x, b.quat.y, b.quat.z, b.quat.w]); }
      }
    }, (sym) => {
      for (const h of sym.hosts) h32 = fnv(h32, h.rec.buf.subarray(0, Math.min(h.rec.head, h.rec.cap) * h.rec.stride));
    });
    hashes.push(h32.toString(16));
  }
  assert.equal(hashes[1], hashes[0]);
  assert.equal(hashes[2], hashes[0]);
});

// Krok GOSPODARZA (collapsePreStep + collapseStep: graf, przeguby, front, kikut pod wieżą, uderzenia, oś czasu) w fazie
// przewracania, bez HullBodies.step (silnik ma własne testy alokacji) — stan ustalony JIT jak test grafu: rozgrzewka 1200
// kroków, pomiar 1200; próg 64 B / krok jak w teście grafu (resztka: dt w argumentach stepStructure → per120 / ticksAt120).
test('krok gospodarza bez narodzin klastrów nie alokuje (przewracanie wieży, stan ustalony JIT)', async () => {
  const sym = createScenaSym(HullBodies, wieza({}), { hz: 60 });
  const h = sym.hosts[0];
  try {
    for (let s = 0; s < 60 * 12 && SC.collapseTimeline(h).jointBroken < 0; s++) sym.step();
    assert.ok(SC.collapseTimeline(h).jointBroken > 0);
    let tick = 1 << 20;
    const fn = () => { SC.collapsePreStep(h, 1 / 60); SC.collapseStep(h, 1 / 60, tick++); };
    const perStep = await untilSteady(() => {
      const births = SC.collapseStats(h).births;
      const v = allocatedBytes(fn, 1200) / 1200;
      return SC.collapseStats(h).births === births ? v : Infinity;
    }, (b) => b < 64, { warm: () => { for (let i = 0; i < 1200; i++) fn(); }, rounds: 12 });
    assert.ok(perStep < 64, `alokacje: ${perStep.toFixed(1)} B/krok`);
  } finally { sym.dispose(); }
});
