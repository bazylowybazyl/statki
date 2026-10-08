// Mapa ran na kadłubach belkowych (zadanie 18-C, src/3d/hullDamageMap.js + .tsl.js, PROJEKT-BRONI §3):
// klasy slotów, LRU po widoczności, wspólny klucz rodu (kadłub, wrak, odłamy), reguła „dziura albo
// krater”, stemple z tabeli receptur dema, stygnięcie (wzór zamknięty), naprawa, lista zadań kernela,
// pasma HDR rany (lustra CPU), WGSL kernela i materiału kadłuba (Node, bez GPU), zero alokacji.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const THREE = await import('three/webgpu');
const { HullBodies, hullImpactResult } = await import('../src/game/hullBodies.js');
const M = await import('../src/3d/hullDamageMap.js');
const T = await import('../src/3d/hullDamageMap.tsl.js');
const S = await import('../src/3d/hullDamageStamps.js');
const { HullDamageMap, DMG_CLASSES, damageClassFor, worldVecToUv } = M;
const { HullNodeMaterial, HULL_FLAT_NORMAL_TEXTURE } = await import('../src/3d/hexShips3D.tsl.js');
const { HullLacquer } = await import('../src/3d/hullLacquer.js');

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Płyta w × h px (jak tests/hullBodies.test.mjs).
function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, ...extra });

// Kadłub „na niby” (bez silnika): tylko pola, które czyta hak (rozmiar, skala, komórka, klucz, poza).
let fakeKey = 90000;
function fakeHull(W, H, { angle = 0, cellSize = 15 } = {}) {
  const e = { x: 0, y: 0, angle, vx: 0, vy: 0 };
  e.beamHull = { entity: e, srcWidth: W, srcHeight: H, scale: 1, cellSize, dmgKey: ++fakeKey };
  return e;
}
function impactResult(e, over = {}) {
  return Object.assign({
    kind: 'impact', hit: true, killed: 0, radius: 15, node: 0, u: 0.5, v: 0.3, x: 0, y: 0,
    dmgKey: e.beamHull.dmgKey, dirX: 0, dirY: 1, len: 0, crater: 0
  }, over);
}
// Ostatni stempel w kolejce: { slot, u, v, r (j. świata), cut, heat, scorch, rim, ion, cx, cy, el,
// hole — promień prawdziwej dziury (j. świata; 0 = bez dziury — lej się nie maluje, zadanie 25c) }.
const SF = M.DMG_STAMP_FLOATS;
function lastStamp(slot) {
  const i = HullDamageMap._qCount - 1;
  const Q = HullDamageMap._qData, o = i * SF;
  return {
    slot: HullDamageMap._qSlot[i], u: Q[o], v: Q[o + 1], r: Q[o + 2] * slot.worldH, cut: Q[o + 3],
    heat: Q[o + 4], scorch: Q[o + 5], rim: Q[o + 6], ion: Q[o + 7], cx: Q[o + 8], cy: Q[o + 9], el: Q[o + 10],
    hole: Q[o + 12] * slot.worldH
  };
}
function fresh() {
  HullDamageMap.reset();
  HullDamageMap.frame = 10;
  HullDamageMap._time = 0;
  // Test od czystej puli: brudne prostokąty poprzednich testów (w grze zostają do czyszczenia).
  for (const s of HullDamageMap.slots) { s.dx0 = 1; s.dy0 = 1; s.dx1 = 0; s.dy1 = 0; }
}

// Pierwszy w pliku: późniejsze testy (różne kształty encji i wyników) robią dostęp do pól megamorficznym,
// a taki odczyt pola double w V8 kopiuje liczbę (alokacja) — w grze hak dostaje zawsze ten sam obiekt wyniku.
test('bez alokacji: trafienie + klatka zadań (kolejka, sortowanie stempli, wysyłka) nie tworzy obiektów', () => {
  fresh();
  HullDamageMap._ensureGpu();
  HullDamageMap.keepCpuCopy = true;      // bez oddawania kopii CPU prawdziwej puli (atrapa renderera)
  const e = fakeHull(720, 380);
  const r = impactResult(e, { u: 0.5, v: 0.5 });
  const u = { uDmgSlot: { value: new THREE.Vector4() }, uDmgWorld: { value: new THREE.Vector2() } };
  const fakeRenderer = { compute() {} };
  const ctx = { time: 0.5, renderer: fakeRenderer };
  const newSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      HullDamageMap.setSource('vulcan_minigun');
      HullDamageMap.onHullImpact(e, r);
      HullDamageMap.clearSource();
      HullDamageMap.bind(e.beamHull.dmgKey, u);
      ctx.time += 1 / 60;
      HullDamageMap.update(ctx);
    }
  };
  run(2000);   // rozgrzewka JIT
  let best = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = newSpace();
    run(2000);
    const d = newSpace() - before;
    if (d >= 0) best = Math.min(best, d);
  }
  // Parametry stempla idą przez tablicę (nie argumenty double), krok bez performance.now — zostaje
  // pojedyncze pakowanie liczby przy zapisie pola (≤ ~16 B na klatkę z pracą; pomiar: 17 B).
  assert.ok(best < 2000 * 48, `przyrost young generation ${best} B na 2000 klatek (trafienie + klatka)`);
  HullDamageMap.keepCpuCopy = false;
});

test('klasy slotów: długość kadłuba w świecie → L / M / S / bez mapy; pula 24 MB', () => {
  assert.equal(damageClassFor(1800), 0, 'Atlas → L');
  assert.equal(damageClassFor(1080), 0, 'lotniskowiec → L');
  assert.equal(damageClassFor(720), 1, 'pancernik piracki → M');
  assert.equal(damageClassFor(624), 1, 'pancernik Terra Nova → M');
  assert.equal(damageClassFor(360), 2, 'niszczyciel → S');
  assert.equal(damageClassFor(192), 2, 'fregata → S');
  assert.equal(damageClassFor(120), -1, 'myśliwiec bez mapy');
  assert.deepEqual(DMG_CLASSES.map((c) => [c.name, c.w, c.h, c.count]), [['L', 512, 256, 12], ['M', 256, 128, 32], ['S', 128, 64, 64]]);
  assert.equal(T.DMG_POOL_TEXELS, 12 * 512 * 256 + 32 * 256 * 128 + 64 * 128 * 64);
  assert.equal(HullDamageMap.stats.poolBytes, 24 * 1024 * 1024, 'teksel 8 B: 24 MB');
  // Pula to singleton o rozmiarze z klas — materiał (pierwszy) i kernel dostają ten sam bufor.
  assert.equal(T.hullDamagePool().texels, T.DMG_POOL_TEXELS);
  assert.equal(T.hullDamagePool(), T.hullDamagePool());
});

test('przydział: klasa z rozmiaru, ten sam slot dla klucza, pełna klasa → mniejsza, potem brak', () => {
  fresh();
  const a = HullDamageMap.acquire(1001, 1800, 806);
  assert.equal(a.cls, 0);
  assert.equal(HullDamageMap.acquire(1001, 1800, 806), a, 'klucz → ten sam slot');
  assert.equal(HullDamageMap.acquire(1002, 120, 60), null, 'myśliwiec bez slotu');
  // Pełna klasa L w kadrze (widziane w tej klatce): kolejny kadłub L dostaje slot M.
  for (let k = 0; k < 11; k++) HullDamageMap.acquire(2000 + k, 1560, 700);
  const d = HullDamageMap.acquire(3000, 1800, 806);
  assert.equal(d.cls, 1, 'zapas w klasie M');
  assert.ok(HullDamageMap.stats.downgrades >= 1);
  // Pełna klasa S w kadrze: kadłub S bierze WOLNY slot większej klasy (nie wypycha innych).
  for (let k = 0; k < 64; k++) HullDamageMap.acquire(6000 + k, 300, 120);
  const up = HullDamageMap.acquire(6999, 300, 120);
  assert.equal(up.cls, 1, 'wolny slot M dla fregaty, gdy S pełne');
  assert.equal(HullDamageMap.stats.upgrades, 1);
  assert.equal(HullDamageMap.stats.evictions, 0, 'nikt nie stracił ran');
  // Wszystkie sloty (L, M, S) widziane teraz → brak slotu, licznik.
  for (let k = 0; k < 200; k++) HullDamageMap.acquire(4000 + k, 1800, 806);
  const before = HullDamageMap.stats.noSlot;
  assert.equal(HullDamageMap.acquire(9999, 1800, 806), null);
  assert.equal(HullDamageMap.stats.noSlot, before + 1);
  assert.equal(HullDamageMap.stats.slotsL + HullDamageMap.stats.slotsM + HullDamageMap.stats.slotsS, 108);
});

test('LRU: oddaje slot najdawniej widzianego kadłuba spoza kadru; widziane i ze stemplami są chronione', () => {
  fresh();
  const S0 = [];
  for (let k = 0; k < 64; k++) S0.push(HullDamageMap.acquire(100 + k, 300, 120));
  assert.ok(S0.every((s) => s && s.cls === 2));
  // Klatki mijają: widoczność z bind() (materiał kadłuba).
  HullDamageMap.frame = 50;
  // Większe klasy zajęte przez kadłuby w kadrze (inaczej fregata dostałaby wolny slot M / L).
  for (let k = 0; k < 44; k++) HullDamageMap.acquire(800 + k, 1800, 806);
  assert.equal(HullDamageMap.stats.slotsL + HullDamageMap.stats.slotsM, 44);
  const holder = () => ({ uDmgSlot: { value: new THREE.Vector4() }, uDmgWorld: { value: new THREE.Vector2() } });
  for (let k = 0; k < 64; k++) S0[k].seen = 20 + k % 20;       // różne „ostatnio widziane”
  S0[3].seen = 5;                                                // najdawniej
  S0[7].seen = 2; S0[7].pending = 1;                             // najdawniej, ale ze stemplem tej klatki
  const u = holder();
  assert.equal(HullDamageMap.bind(100 + 9, u), true);            // widziany teraz
  S0[9].seen = 1;                                                // (nadpisane niżej przez bind)
  HullDamageMap.bind(100 + 9, u);
  const s = HullDamageMap.acquire(5000, 300, 120);
  assert.equal(s, S0[3], 'LRU: najdawniej widziany, bez stempli');
  assert.equal(HullDamageMap.slotOf(103), undefined, 'stary klucz odpięty');
  assert.equal(s.clear, false, 'slot bez brudnych tekseli nie wymaga czyszczenia');
  assert.equal(HullDamageMap.stats.evictions, 1);
  // Materiał kadłuba odpiętego klucza: mapa wyłączona (w = 0), nowego — slot i rozmiar kadłuba.
  const v = holder();
  v.uDmgSlot.value.w = 1;
  assert.equal(HullDamageMap.bind(103, v), false);
  assert.equal(v.uDmgSlot.value.w, 0);
  assert.equal(HullDamageMap.bind(5000, v), true);
  assert.deepEqual(v.uDmgSlot.value.toArray(), [s.base, 128, 64, 1]);
  assert.deepEqual(v.uDmgWorld.value.toArray(), [300, 120]);
  S0[7].pending = 0;
});

test('reguła „dziura albo krater”: krater → żar na brzegu dziury, bez przezroczystości; mały kaliber → przestrzelina z receptury', () => {
  fresh();
  const e = fakeHull(1800, 806);
  const slot = () => HullDamageMap.slotOf(e.beamHull.dmgKey);
  // Armata bez zabitego węzła (150 obr. < HP węzła): promień z receptury, brzeg jak w demie, otwór 0.
  HullDamageMap.setSource('armata_mk1');
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 0 }));
  HullDamageMap.clearSource();
  let st = lastStamp(slot());
  close(st.r, 62, 1e-3, 'promień armaty');
  assert.equal(st.cut, 0, 'bez fałszywej dziury (62 j. > 0,6 komórki)');
  close(st.rim, 0.76, 1e-6, 'kształt brzegu z receptury');
  close(st.heat, 3.2, 1e-6);
  close(st.scorch, 0.95, 1e-6);
  assert.equal(st.hole, 0, 'bez dziury w belkach — lej się nie maluje (25c)');
  // Ten sam pocisk z kraterem (zabite węzły): promień obejmuje brzeg prawdziwej dziury, lej w jej zasięgu.
  HullDamageMap.setSource('armata_mk1');
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 3, radius: 80, crater: 70 }));
  HullDamageMap.clearSource();
  st = lastStamp(slot());
  close(st.r, 70 + 7.5, 1e-3, 'max(receptura, zasięg dziury + ½ komórki)');
  close(st.hole, 70, 1e-3, 'lej w promieniu prawdziwej dziury (hullImpactResult.crater)');
  assert.equal(st.cut, 0, 'dziurę robi geometria');
  // Zabite węzły bez krateru (sama utrata oparcia): bez przestrzeliny i bez leja.
  HullDamageMap.setSource('armata_mk1');
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 2, crater: 0 }));
  HullDamageMap.clearSource();
  st = lastStamp(slot());
  assert.equal(st.hole, 0);
  assert.equal(st.cut, 0);
  // Vulcan (r = 7 ≤ 0,6 · 15): przestrzelina przezroczysta z receptury.
  HullDamageMap.setSource({ vfxKey: 'vulcan_minigun', type: 'rail', weaponSize: 'M' });
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 0 }));
  HullDamageMap.clearSource();
  st = lastStamp(slot());
  close(st.r, 7, 1e-4);
  close(st.cut, 0.3, 1e-6, 'otwór = przestrzelina receptury');
  // Tempest L: promień × moc rozmiaru (20 · 1,25), poświata jonowa.
  HullDamageMap.setSource({ vfxKey: 'tempest_ion_l', weaponSize: 'L' });
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 0 }));
  HullDamageMap.clearSource();
  st = lastStamp(slot());
  close(st.r, 25, 1e-3);
  close(st.ion, 1.0, 1e-6);
  // Flak: promień z promienia rażenia (0,2 × flakBurstRadius).
  HullDamageMap.setSource({ type: 'flak', flakBurstRadius: 270 });
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 0 }));
  HullDamageMap.clearSource();
  close(lastStamp(slot()).r, 54, 1e-3);
  // Bez źródła: stempel ogólny.
  HullDamageMap.onHullImpact(e, impactResult(e, { killed: 0 }));
  close(lastStamp(slot()).r, S.STAMP.generic.impact[S.S_R], 1e-3);
});

test('rzaz (cutSegment, Hexlance): znaki wzdłuż cięcia, wydłużone w kierunku lotu, bez przezroczystości', () => {
  fresh();
  const e = fakeHull(720, 380);
  const before = HullDamageMap._qCount;
  // Cięcie poziome od u = 0,3 na 150 j. (dziób +x, bez obrotu): znaki co ≤ 22 j. (7), ≤ DMG_KERF_MAX.
  HullDamageMap.onHullImpact(e, impactResult(e, { kind: 'cut', killed: 12, radius: 35, u: 0.3, v: 0.5, dirX: 1, dirY: 0, len: 150 }));
  const n = HullDamageMap._qCount - before;
  assert.equal(n, Math.min(M.DMG_KERF_MAX, Math.ceil(150 / M.DMG_KERF_STEP)));
  assert.equal(n, 7);
  const slot = HullDamageMap.slotOf(e.beamHull.dmgKey);
  const Q = HullDamageMap._qData;
  const first = before * SF, last = (before + n - 1) * SF;
  close(Q[first], 0.3, 1e-6, 'pierwszy znak w wejściu');
  close((Q[last] - Q[first]) * 720, 150, 1e-3, 'ostatni znak na końcu cięcia (u × szerokość)');
  close(Q[last + 1], 0.5, 1e-6, 'v bez zmian przy cięciu poziomym');
  const st = lastStamp(slot);
  close(st.el, 2.2, 1e-6, 'wydłużenie rzazu');
  close(st.cx, 1, 1e-6); close(st.cy, 0, 1e-6);
  assert.equal(st.cut, 0);
  close(st.r, 35 + 7.5, 1e-3, 'pół szerokości rzazu + ½ komórki');
  close(st.hole, 35, 1e-3, 'rzaz jest prawdziwą dziurą: lej w pasie (pół szerokości)');
  // Kierunek w układzie uv obraca się z kadłubem: kadłub obrócony o +90° (y w dół), cięcie w +y świata.
  const r = fakeHull(720, 380, { angle: Math.PI / 2 });
  HullDamageMap.onHullImpact(r, impactResult(r, { kind: 'cut', killed: 5, radius: 35, u: 0.5, v: 0.5, dirX: 0, dirY: 1, len: 40 }));
  const s2 = lastStamp(HullDamageMap.slotOf(r.beamHull.dmgKey));
  close(s2.cx, 1, 1e-9, 'lot +y świata = wzdłuż dziobu obróconego kadłuba');
  close(s2.cy, 0, 1e-9);
});

test('worldVecToUv: wektor świata → przesunięcie uv skóry (obrót kadłuba, v w dół obrazu)', () => {
  const e = fakeHull(800, 400);
  const out = {};
  worldVecToUv(e.beamHull, 80, 0, out);
  close(out.du, 0.1, 1e-12); close(out.dv, 0, 1e-12);
  worldVecToUv(e.beamHull, 0, 40, out);      // +y świata = w dół ekranu = w dół obrazu
  close(out.du, 0, 1e-12); close(out.dv, 0.1, 1e-12);
  e.angle = Math.PI / 2;                       // dziób w +y świata
  worldVecToUv(e.beamHull, 0, 80, out);
  close(out.du, 0.1, 1e-12, 'lot wzdłuż dziobu = +u'); close(out.dv, 0, 1e-12);
});

test('prawdziwe kadłuby: krater i rzaz przez hak onImpact, klucz rodu wspólny dla wraku i odłamów, uv stempla = uv krateru', () => {
  fresh();
  HullBodies.onImpact = HullDamageMap.onHullImpact;
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, plate(420, 160));
  try {
    const key = hull.dmgKey;
    HullDamageMap.setSource('armata_mk1');
    assert.equal(HullBodies.impact(e, 200, 0, 150, { x: -600, y: 0 }), true);
    HullDamageMap.clearSource();
    const slot = HullDamageMap.slotOf(key);
    assert.ok(slot, 'slot rodu po pierwszym trafieniu');
    assert.equal(slot.cls, 1, 'płyta 420 j. → M');
    const st = lastStamp(slot);
    close(st.u, hullImpactResult.u, 1e-6, 'uv stempla = uv krateru');
    close(st.v, hullImpactResult.v, 1e-6);
    // hullImpactResult niesie kierunek lotu (impact: wektor prędkości, bez drogi).
    close(hullImpactResult.dirX, -1, 1e-12); close(hullImpactResult.dirY, 0, 1e-12);
    assert.equal(hullImpactResult.len, 0);
    // Rzaz na wylot: kierunek i droga od wejścia do końca odcinka.
    const q0 = HullDamageMap._qCount;
    const killed = HullBodies.cutSegment(e, -100, -300, -100, 300, 35);
    assert.ok(killed > 0);
    assert.equal(hullImpactResult.kind, 'cut');
    close(hullImpactResult.dirX, 0, 1e-12); close(hullImpactResult.dirY, 1, 1e-12);
    close(hullImpactResult.len, 300 - hullImpactResult.y, 1e-6, 'droga od wejścia do końca odcinka');
    assert.ok(HullDamageMap._qCount - q0 >= 2, 'znaki rzazu');
    // Śmierć: wrak z całego kadłuba i odłamy (rozpad po rzazie) mają klucz rodu — ten sam slot.
    const wreck = HullBodies.convertToWreck(e);
    assert.equal(wreck.beamHull.dmgKey, key);
    HullDamageMap.setSource('railgun_mk1');
    HullBodies.impact(wreck, wreck.x - 150, wreck.y, 60, { x: 600, y: 0 });
    HullDamageMap.clearSource();
    assert.equal(HullDamageMap.slotOf(key), slot, 'wrak stempluje ten sam slot');
    HullBodies.step(1 / 120, [wreck, ...window.wrecks]);
    for (const w of window.wrecks) if (w.beamHull) assert.equal(w.beamHull.dmgKey, key, 'odłam w warstwie ran rodzica');
    const u = { uDmgSlot: { value: new THREE.Vector4() }, uDmgWorld: { value: new THREE.Vector2() } };
    assert.equal(HullDamageMap.bind(wreck.beamHull.dmgKey, u), true);
    assert.equal(u.uDmgSlot.value.x, slot.base);
    for (const w of window.wrecks) HullBodies.release(w);
    HullBodies.release(wreck);
  } finally {
    HullBodies.onImpact = null;
    HullBodies.release(e);
    window.wrecks.length = 0;
  }
});

test('lej tylko w prawdziwej dziurze (25c): stempel krateru niesie zasięg zabitych węzłów; receptura, stampAt, stampKerf — bez dziury', async () => {
  const { craterOptsFor } = await import('../src/game/hullCraters.js');
  fresh();
  HullBodies.onImpact = HullDamageMap.onHullImpact;
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  try {
    const key = e.beamHull.dmgKey;
    const last = () => lastStamp(HullDamageMap.slotOf(key));
    // Yamato na miarę rany: krater 60 j. (balans 2026-09-29) — lej w zasięgu zabitych węzłów, rana z receptury.
    const yam = { vfxKey: 'special_yamato_cannon', type: 'plasma', weaponSize: 'Capital' };
    const hit = HullBodies.sweep(e, 0, -1000, 0, 0, 0);
    HullDamageMap.setSource(yam);
    HullBodies.impact(e, hit.worldX, hit.worldY, 850, { x: 0, y: 9000 }, craterOptsFor(yam, 'impact', 850));
    HullDamageMap.clearSource();
    let st = last();
    assert.ok(hullImpactResult.crater > 45, `zasięg dziury ${hullImpactResult.crater}`);
    close(st.hole, hullImpactResult.crater, 1e-3, 'lej = zasięg zabitych węzłów');
    close(st.r, 130, 1e-3, 'rana w promieniu receptury (żar i osmalenie sięgają dalej)');
    // Lekki pocisk bez zabitego węzła: bez leja.
    const hit2 = HullBodies.sweep(e, -200, -1000, -200, 0, 0);
    HullDamageMap.setSource({ vfxKey: 'railgun_mk2', type: 'rail', weaponSize: 'M' });
    HullBodies.impact(e, hit2.worldX, hit2.worldY, 10, { x: 0, y: 9000 });
    HullDamageMap.clearSource();
    assert.equal(last().hole, 0, 'bez dziury — bez leja');
    HullDamageMap.frame++;
    assert.equal(HullDamageMap.stampRecipe(e, 150, 40, 55, 2.8, 0.9, 0.5, 0.3), true);
    assert.equal(last().hole, 0, 'receptura (wtórny wybuch Yamato) bez leja');
    assert.equal(HullDamageMap.stampAt(e, -150, 40, 'rocket'), true);
    assert.equal(last().hole, 0, 'stampAt bez leja');
    assert.ok(HullDamageMap.stampKerf(e, -250, 0, 250, 0, 'mjolnir') > 0);
    assert.equal(last().hole, 0, 'pas rzazu przebicia (bez rzazu w belkach) bez leja');
  } finally {
    HullBodies.onImpact = null;
    HullBodies.release(e);
    window.wrecks.length = 0;
  }
  // Materiał: kształt leja z receptury × kanał krateru; środek bez dziury nie świeci (jak lej), ale nie jest czarny.
  const tsl = read('src/3d/hullDamageMap.tsl.js');
  assert.match(tsl, /const lej = smoothstep\(0\.52, 0\.6, holeF\)\.toVar\(\);/);
  assert.match(tsl, /const hole = lej\.mul\(D\.crater\)\.toVar\(\);/);
  assert.match(tsl, /mul\(float\(1\.0\)\.sub\(lej\)\)\.toVar\(\);\n    const heatCol/, 'żar środka rany gaszony kształtem leja');
});

test('stemple tylko w kadrze z zapasem: trafienie daleko poza ekranem nie zajmuje slotu', async () => {
  fresh();
  const { Core3D } = await import('../src/3d/core3d.js');
  T.effectLightGrid();
  const view = Core3D.fx.view;
  const prev = { ...view };
  Object.assign(view, { x0: 0, y0: 0, x1: 1000, y1: 600 });
  try {
    const e = fakeHull(720, 380);
    HullDamageMap.onHullImpact(e, impactResult(e, { x: 1400, y: 300 }));
    assert.ok(HullDamageMap.slotOf(e.beamHull.dmgKey), 'w zapasie (pół kadru) — stempel');
    const f = fakeHull(720, 380);
    const off = HullDamageMap.stats.offView;
    HullDamageMap.onHullImpact(f, impactResult(f, { x: 1600, y: 300 }));
    assert.equal(HullDamageMap.slotOf(f.beamHull.dmgKey), undefined, 'poza zapasem — bez slotu');
    assert.equal(HullDamageMap.stats.offView, off + 1);
  } finally { Object.assign(view, prev); }
});

test('źródło stempla: pocisk, broń, id; rodziny 27 broni dema zgodne z tabelą efektów (17)', () => {
  assert.equal(S.stampFamilyFor({ vfxKey: 'railgun_mk2', type: 'rail' }), 'tempest');
  assert.equal(S.stampFamilyFor({ type: 'ciws' }), 'ciws', 'CIWS bez vfxKey');
  assert.equal(S.stampFamilyFor({ type: 'rocket' }), 'rocket');
  assert.equal(S.stampFamilyFor({ id: 'beam_continuous', category: 'beam' }), 'beamC');
  assert.equal(S.stampFamilyFor({ id: 'laser_pd_mk1', category: 'beam' }), 'laserPD');
  assert.equal(S.stampFamilyFor({ category: 'beam', beamMode: 'continuous' }), 'beamC');
  assert.equal(S.stampFamilyFor('special_yamato_cannon'), 'yamato');
  assert.equal(S.stampFamilyFor('mjolnir'), 'mjolnir', 'nazwa rodziny wprost');
  assert.equal(S.stampFamilyFor(null), 'generic');
  assert.equal(S.stampPowerFor({ weaponSize: 'Capital' }), 1.6);
  // 27 broni dema + 3 warianty rozmiarowe broni specjalnej + Lanca M / L (własne, mniejsze wpisy stempla).
  assert.equal(Object.keys(S.WEAPON_STAMP_FAMILY).length, 32);
  for (const fam of new Set(Object.values(S.WEAPON_STAMP_FAMILY))) assert.ok(S.STAMP[fam]?.impact, `rodzina ${fam} ma stempel trafienia`);
  assert.equal(S.stampFamilyFor({ vfxKey: 'special_valkyrie_s', type: 'rail', weaponSize: 'S' }), 'valkyrieS');
  assert.equal(S.stampFamilyFor({ vfxKey: 'special_valkyrie_m', type: 'rail', weaponSize: 'M' }), 'valkyrieM');
  assert.equal(S.stampFamilyFor({ vfxKey: 'special_yamato_l', type: 'plasma', weaponSize: 'L' }), 'yamatoL');
  assert.equal(S.stampFamilyFor({ vfxKey: 'lance_rail_m', type: 'rail', weaponSize: 'M' }), 'lanceM');
  assert.equal(S.stampFamilyFor({ vfxKey: 'lance_rail_l', type: 'rail', weaponSize: 'L' }), 'lanceL');
  // Warianty przebijające mają te same warianty stempla co Valkyrie (rzaz, wylot, zakleszczenie).
  for (const fam of ['valkyrieS', 'valkyrieM', 'lanceM', 'lanceL']) {
    for (const v of ['impact', 'kerf', 'exit', 'stuck']) {
      assert.ok(S.STAMP[fam][v], `${fam}.${v}`);
      assert.ok(S.STAMP[fam][v][S.S_R] < S.STAMP.valkyrie[v][S.S_R], `${fam}.${v}: mniejszy od rodzica`);
    }
  }
  assert.ok(S.STAMP.yamatoL.impact[S.S_R] < S.STAMP.yamato.impact[S.S_R]);
  // Parametry z wywołań ctx.stamp w recepturach dema (recipes.js): kilka kontrolnych.
  const demo = read('dema/bronie-webgpu/recipes.js');
  for (const [fam, needle] of [['armata', 'ctx.stamp(hull, hit.x, hit.y, 62, 3.2, 0.95, 0.76, 0)'], ['vulcan', 'ctx.stamp(hull, hit.x, hit.y, 7, 1.5, 0.35, 0.3, 0)'],
    ['plasmaGatling', 'ctx.stamp(hull, hit.x, hit.y, 34, 2.2, 0.55, 0.56, 0.8)'], ['yamato', 'ctx.stamp(hull, hit.x, hit.y, 130, 3.6, 1.0, 0.9, 0.4)']]) {
    assert.ok(demo.includes(needle), `demo: ${needle}`);
    const e = S.STAMP[fam].impact;
    const nums = needle.match(/[\d.]+/g).slice(-5).map(Number);
    assert.deepEqual([e[S.S_R], e[S.S_HEAT], e[S.S_SCORCH], e[S.S_HOLE], e[S.S_ION]], nums, fam);
  }
  // Rzaz Mjolnira i Hexlance'a: wydłużenie 2,2 (ctx.stamp(..., p.vx, p.vy, 2.2)).
  assert.equal(S.STAMP.hexlance.kerf[S.S_ELONG], 2.2);
  assert.equal(S.STAMP.mjolnir.kerf[S.S_ELONG], 2.2);
  assert.equal(S.STAMP.valkyrie.kerf[S.S_ELONG], 2.4);
});

test('ctx.stamp receptur (17) → stampRecipe: krater z haka tej klatki pominięty, reszta na mapę; zdarzenie opóźnione jedzie z nośnikiem', async () => {
  fresh();
  const { ActiveCarrier } = await import('../src/game/carrierVelocity.js');
  const { SimClock, CLOCK_SIM } = await import('../src/game/simClock.js');
  HullBodies.onImpact = HullDamageMap.onHullImpact;
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, plate(420, 160));
  try {
    // Trafienie: krater z haka (źródło — armata), potem receptura trafienia w tym samym punkcie.
    HullDamageMap.setSource('armata_mk1');
    assert.equal(HullBodies.impact(e, 200, 0, 150, { x: -600, y: 0 }), true);
    HullDamageMap.clearSource();
    const q = HullDamageMap._qCount;
    const hx = hullImpactResult.x, hy = hullImpactResult.y;
    assert.equal(HullDamageMap.stampRecipe(e, hx, hy, 62, 3.2, 0.95, 0.76, 0), false, 'to samo trafienie: bez drugiego stempla');
    assert.equal(HullDamageMap.stats.recipeDup, 1);
    assert.equal(HullDamageMap._qCount, q);
    // Inny punkt (wtórny wybuch, wiązka między taktami) — na mapę, parametry receptury.
    assert.equal(HullDamageMap.stampRecipe(e, -150, 20, 55, 2.8, 0.9, 0.5, 0.3), true);
    const st = lastStamp(HullDamageMap.slotOf(hull.dmgKey));
    close(st.r, 55, 1e-3); close(st.heat, 2.8, 1e-6); close(st.rim, 0.5, 1e-6); close(st.ion, 0.3, 1e-6);
    assert.equal(st.cut, 0, 'receptura nigdy nie robi przezroczystej dziury');
    assert.equal(st.hole, 0, 'receptura nie ma dziury w belkach — bez leja (25c)');
    const uv = HullBodies.spriteUvAt(e, -150, 20);
    close(st.u, uv.u, 1e-6); close(st.v, uv.v, 1e-6);
    // Następna klatka: pamięć kraterów nie blokuje nowych trafień w to miejsce.
    HullDamageMap.frame++;
    assert.equal(HullDamageMap.stampRecipe(e, hx, hy, 62, 3.2, 0.95, 0.76, 0), true);
    // Zdarzenie opóźnione (Yamato: punkt z chwili trafienia): kadłub przesunął się o v · dt nośnika.
    ActiveCarrier.set({ vx: 300, vy: -100, t0: SimClock.now(CLOCK_SIM) - 0.2, clock: CLOCK_SIM });
    try {
      assert.equal(HullDamageMap.stampRecipe(e, -100, 0, 50, 2.8, 0.9, 0.5, 0.3), true);
    } finally { ActiveCarrier.clear(); }
    const moved = HullBodies.spriteUvAt(e, -100 + 60, -20);
    const st2 = lastStamp(HullDamageMap.slotOf(hull.dmgKey));
    close(st2.u, moved.u, 1e-6, 'u po przesunięciu nośnika'); close(st2.v, moved.v, 1e-6);
    // Bez kadłuba belkowego (asteroida, tarcza, Hexlance z hull = null) — nic.
    assert.equal(HullDamageMap.stampRecipe(null, 0, 0, 30, 3, 1, 0.5, 0), false);
    assert.equal(HullDamageMap.stampRecipe({ x: 0, y: 0 }, 0, 0, 30, 3, 1, 0.5, 0), false);
  } finally {
    HullBodies.onImpact = null;
    HullBodies.release(e);
  }
  // Fasada 17 podaje ctx.stamp mapie ran; płonąca wyrwa tli się stemplami żaru co 0,25 s.
  const wfx = read('src/3d/weapons/weaponFx.js');
  assert.match(wfx, /stamp\(hull, x, y, r, heat, scorch, hole, ion, dx, dy, elong\) \{ HullDamageMap\.stampRecipe\(hull, x, y, r, heat, scorch, hole, ion, dx, dy, elong\); \}/);
  const { burnStep } = await import('../src/3d/weapons/recipes.js');
  const { GpuFx } = await import('../src/3d/weapons/gpuFx.js');
  const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
  const { LightGrid } = await import('../src/3d/fx/lightGrid.js');
  const { FxLights } = await import('../src/3d/fx/fxLights.js');
  const { createTile2DTexture } = await import('../src/3d/fx/noise.js');
  const gfx = new GpuFx({ origin: new FxPoolOrigin({ name: 'tstDmgBurn' }), noise: createTile2DTexture(32), grid: new LightGrid({ name: 'tstDmgBurnGrid' }) });
  const calls = [];
  const ctxB = { fx: gfx, lights: new FxLights(), time: 0, after() {}, shake() {}, stamp: (...a) => calls.push(a), burn() {}, hullInside() { return true; }, ricochet() {} };
  const ent = { id: 7 };
  const b = { entity: ent, x: 5, y: 6, nx: 0, ny: -1, age: 0.35, dur: 3.5, power: 1.6, pal: 'yamato', seed: 1, stampAcc: 0.24 };
  burnStep(ctxB, b, 1 / 60);
  assert.equal(calls.length, 1, 'stempel żaru co 0,25 s');
  const k = 1.6 * (1 - 0.1) * (1 - 0.1);
  const [he, hx2, hy2, hr, hheat, hscorch, hhole, hion] = calls[0];
  assert.equal(he, ent); assert.equal(hx2, 5); assert.equal(hy2, 6);
  close(hr, 18 * 1.6, 1e-9); close(hheat, 0.6 + 1.4 * k, 1e-9); close(hscorch, 0.04 * k, 1e-9);
  assert.equal(hhole, 0, 'ogień nie powiększa leja'); assert.equal(hion, 0);
  burnStep(ctxB, b, 1 / 60);
  assert.equal(calls.length, 1, 'następny dopiero po 0,25 s');
});

test('stygnięcie: wzór zamknięty = całkowanie dema krokiem klatki; niezależne od podziału czasu', () => {
  // Demo (hull.js): H ← H·exp(−(1,3H + 0,45)·dt) co klatkę.
  for (const h0 of [0.5, 2, 4]) {
    let h = h0;
    const dt = 1 / 600;
    for (let i = 0; i < 600 * 3; i++) h *= Math.exp(-(1.3 * h + 0.45) * dt);
    close(T.damageCoolHeatCpu(h0, 3), h, 2e-3 * h0, `H0 = ${h0} po 3 s`);
  }
  // Półgrupa: stygnięcie o a + b = stygnięcie o a, potem o b (slot poza kadrem nadrabia jednym krokiem).
  const a = T.damageCoolHeatCpu(T.damageCoolHeatCpu(3.2, 0.7), 2.1);
  close(a, T.damageCoolHeatCpu(3.2, 2.8), 1e-12);
  // Biel → pomarańcz szybko, czerwień długo; zimne po ~6,3 s od sufitu żaru.
  assert.ok(T.damageCoolHeatCpu(3.2, 0.3) < 1.6, 'po 0,3 s poniżej połowy');
  close(M.DMG_HOT_SEC, T.damageHotSeconds(T.DMG_HEAT_MAX), 1e-12);
  assert.ok(M.DMG_HOT_SEC > 5.5 && M.DMG_HOT_SEC < 7, `czas stygnięcia ${M.DMG_HOT_SEC}`);
  close(T.damageCoolHeatCpu(T.DMG_HEAT_MAX, M.DMG_HOT_SEC), T.DMG_HEAT_EPS, 1e-9);
});

test('zadania: czyszczenie przejętego slotu (brudny prostokąt), stygnięcie w kadrze, nadrabianie poza kadrem, zgaszenie żaru', () => {
  fresh();
  const g = HullDamageMap._ensureGpu();
  const J = g.jobsU32, JF = g.jobsF32;
  const e = fakeHull(720, 380);
  const key = e.beamHull.dmgKey;
  HullDamageMap.onHullImpact(e, impactResult(e, { u: 0.5, v: 0.5 }));
  const slot = HullDamageMap.slotOf(key);
  const u = { uDmgSlot: { value: new THREE.Vector4() }, uDmgWorld: { value: new THREE.Vector2() } };
  HullDamageMap.bind(key, u);
  let threads = HullDamageMap.buildJobs(1.0);
  assert.equal(HullDamageMap.stats.jobs, 1);
  assert.equal(J[7] & T.DMG_FLAG_CLEAR, 0, 'świeży slot bez brudu — bez czyszczenia');
  assert.equal(J[9], 1, 'jeden stempel w zadaniu');
  assert.equal(threads, J[6] * (slot.hy1 - slot.hy0 + 1), 'wątki = prostokąt stempla');
  assert.ok(slot.hot && slot.dx0 <= slot.dx1, 'gorący i brudny');
  // Następna klatka w kadrze: tylko stygnięcie (Δ = krok zegara efektów) w gorącym prostokącie.
  HullDamageMap.frame++;
  HullDamageMap.bind(key, u);
  HullDamageMap.buildJobs(1.02);
  close(JF[11], 0.02, 1e-6, 'Δ stygnięcia');
  assert.equal(J[9], 0, 'bez stempli');
  // Poza kadrem (bez bind): nic — Δ się zbiera.
  HullDamageMap.frame += 5;
  assert.equal(HullDamageMap.buildJobs(2.0), 0);
  // Powrót do kadru: jeden krok o cały zaległy czas.
  HullDamageMap.bind(key, u);
  HullDamageMap.buildJobs(3.0);
  close(JF[11], 3.0 - 1.02, 1e-6, 'zaległe stygnięcie jednym krokiem (wzór zamknięty)');
  // Po czasie stygnięcia: zadanie zeruje żar, slot przestaje być gorący.
  HullDamageMap.frame++;
  HullDamageMap.bind(key, u);
  HullDamageMap.buildJobs(1.0 + M.DMG_HOT_SEC + 0.1);
  assert.ok(J[7] & T.DMG_FLAG_ZERO_HEAT, 'flaga zgaszenia');
  assert.equal(slot.hot, false);
  HullDamageMap.frame++;
  HullDamageMap.bind(key, u);
  assert.equal(HullDamageMap.buildJobs(9), 0, 'zimny slot w kadrze — bez pracy');
  // Przejęcie slotu przez inny kadłub (LRU): pierwsze zadanie czyści brudny prostokąt poprzednika.
  HullDamageMap.frame += 10;
  // 31 wolnych M, 12 wolnych L (większa klasa — tylko wolne), potem LRU w M: ten slot.
  for (let k = 0; k < 44; k++) HullDamageMap.acquire(70000 + k, 720, 380);
  assert.equal(HullDamageMap.slotOf(key), undefined, 'wypchnięty przez LRU');
  const owner = [...HullDamageMap._byKey.entries()].find(([, s]) => s === slot)?.[0];
  assert.ok(owner >= 70000, 'slot ma nowego właściciela');
  assert.equal(slot.clear, true);
  HullDamageMap.buildJobs(10);
  const o = [...Array(HullDamageMap.stats.jobs).keys()].map((j) => j * 16).find((b) => J[b + 1] === slot.base);
  assert.ok(o !== undefined && (J[o + 7] & T.DMG_FLAG_CLEAR), 'czyszczenie w zadaniu');
  assert.equal(slot.dx0 > slot.dx1, true, 'po czyszczeniu czysty');
});

test('naprawa R: wygaszanie osmalenia i przestrzelin w trakcie, koniec naprawy czyści i zwalnia slot', () => {
  fresh();
  HullBodies.onRepair = HullDamageMap.onHullRepair;
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, plate(420, 160));
  try {
    HullDamageMap.onHullImpact(e, impactResult(e, { dmgKey: hull.dmgKey, u: 0.4, v: 0.5 }));
    const g = HullDamageMap._ensureGpu();
    HullDamageMap.buildJobs(1);
    const slot = HullDamageMap.slotOf(hull.dmgKey);
    // Wgniecenie, żeby naprawa miała co robić (changed = true), potem naprawa krok po kroku.
    hull.body.nodeStore.x[0] += 3;
    const calls = [];
    const orig = HullBodies.onRepair;
    HullBodies.onRepair = (en, dt, changed) => { calls.push(changed); orig(en, dt, changed); };
    assert.equal(HullBodies.repair([e], 0.1), true);
    assert.deepEqual(calls, [true]);
    close(slot.heal, 0.1 * M.DMG_HEAL_RATE, 1e-9, 'wygaszanie ∝ dt');
    HullDamageMap.buildJobs(1.1);
    close(g.jobsF32[12], 0.08, 1e-6, 'naprawa w zadaniu');
    // Naprawa kończy się (nic do zmiany): pełne czyszczenie i zwolnienie slotu.
    for (let i = 0; i < 200 && HullBodies.repair([e], 0.1); i++);
    assert.equal(calls[calls.length - 1], false);
    HullDamageMap.buildJobs(2);
    assert.equal(HullDamageMap.slotOf(hull.dmgKey), undefined, 'slot oddany');
    assert.equal(slot.key, 0);
  } finally {
    HullBodies.onRepair = null;
    HullBodies.release(e);
  }
});

test('pasma HDR rany (lustro CPU kernela i materiału): biały brzeg 8–12, stygnięcie w pomarańcz i czerwień pod progiem, lej ciemny', () => {
  const E = S.STAMP.armata.impact;
  // Stempel krateru z prawdziwą dziurą o promieniu leja receptury (armata na miarę rany, zadanie 25c).
  const holeH = S.lejRadius(E) / 380;
  const tex = (cx, cy, hole = holeH) => {
    const Tx = { heat: 0, ion: 0, scorch: 0, rim: 0, cut: 0, crater: 0 };
    T.damageStampCpu(Tx, [0.5, 0.5, E[0] / 380, 0], [E[1], E[2], E[3], E[4]], [1, 0, 1, 0], cx, cy, 720 / 380, [hole, 0, 0, 0], 128);
    Tx.heat = Math.min(T.DMG_HEAT_MAX, Tx.heat);
    return Tx;
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let maxRim = 0, center = null;
  for (let r = 0; r <= 1.5; r += 0.02) {
    const Tx = tex(0.5 + (r * E[0] / 720), 0.5);
    const g = T.woundGlowCpu(Tx);
    if (r === 0) center = g;
    maxRim = Math.max(maxRim, Math.max(...g.heat));
  }
  assert.ok(maxRim >= 8 && maxRim <= 12, `brzeg świeżej rany ${maxRim.toFixed(2)} (8–12 HDR)`);
  assert.ok(center.hole > 0.99 && Math.max(...center.heat) < 1e-6, 'lej nie świeci (w demie była tam dziura)');
  assert.ok(center.burnt < 0.1, `lej ciemny: ${center.burnt}`);
  assert.ok(center.gloss < 0.01, 'lej bez lakieru (odbicie nieba nie zależy od albedo — czarny lej lśniłby jak blacha)');
  assert.equal(T.woundGlowCpu({ heat: 0, ion: 0, scorch: 0, rim: 0, cut: 0, crater: 0 }).gloss, 1, 'czysta blacha: pełny lakier');
  // Ta sama rana bez dziury w belkach (25c): środek to osmalona blacha, nie lej — nie świeci, ale nie jest
  // czarny (× 0,08) i ma ślad lakieru; brzeg świeci jak przy kraterze.
  let maxRimNoHole = 0, noHole = null;
  for (let r = 0; r <= 1.5; r += 0.02) {
    const g = T.woundGlowCpu(tex(0.5 + (r * E[0] / 720), 0.5, 0));
    if (r === 0) noHole = g;
    maxRimNoHole = Math.max(maxRimNoHole, Math.max(...g.heat));
  }
  close(maxRimNoHole, maxRim, 1e-9, 'pierścień brzegu bez zmian');
  assert.ok(noHole.lej > 0.99 && noHole.hole < 1e-9, 'kształt leja jest, lej nie');
  assert.ok(Math.max(...noHole.heat) < 1e-6, 'środek bez dziury nie świeci (bez tarczy bieli)');
  assert.ok(noHole.burnt > center.burnt * 5, `osmalona blacha jaśniejsza od leja: ${noHole.burnt} vs ${center.burnt}`);
  assert.ok(noHole.gloss > 0.1, 'osmalona blacha ma ślad lakieru');
  // Lej kończy się na brzegu prawdziwej dziury: dziura mniejsza niż lej receptury (np. słabszy strzał) —
  // ten sam punkt kształtu leja jest lejem tylko w dziurze, poza nią osmaloną blachą.
  const px = 0.5 + 0.8 * holeH * 380 / 720;
  const inside = T.woundGlowCpu(tex(px, 0.5));
  const outside = T.woundGlowCpu(tex(px, 0.5, holeH * 0.5));
  assert.ok(inside.lej > 0.99 && inside.hole > 0.99, `w dziurze lej: ${inside.hole}`);
  assert.ok(outside.lej > 0.99 && outside.hole === 0, 'poza dziurą (mniejszą niż lej receptury) bez leja');
  // Po 3 s: pomarańcz/czerwień (bez bieli), po czasie stygnięcia — pod progiem bloomu 0,9.
  let max3 = 0, maxCold = 0;
  for (let r = 0; r <= 1.5; r += 0.02) {
    const Tx = tex(0.5 + (r * E[0] / 720), 0.5);
    const h0 = Tx.heat;
    max3 = Math.max(max3, lum(T.woundGlowCpu({ ...Tx, heat: T.damageCoolHeatCpu(h0, 3) }).heat));
    maxCold = Math.max(maxCold, lum(T.woundGlowCpu({ ...Tx, heat: T.damageCoolHeatCpu(h0, 6) }).heat));
  }
  assert.ok(max3 < 4, `po 3 s bez bieli (luminancja ${max3.toFixed(2)})`);
  assert.ok(maxCold < 0.9, `po 6 s pod progiem bloomu (luminancja ${maxCold.toFixed(3)})`);
  // Przestrzelina małego kalibru: szum brzegu (nz) otwiera ją tylko w rdzeniu.
  assert.equal(T.woundGlowCpu({ heat: 0, ion: 0, scorch: 0, rim: 0.3, cut: 0.3 }, 0.3).cut, true);
  assert.equal(T.woundGlowCpu({ heat: 0, ion: 0, scorch: 0, rim: 0.3, cut: 0.3 }, 0.0).cut, false);
  assert.equal(T.woundGlowCpu({ heat: 0, ion: 0, scorch: 0, rim: 0.76, cut: 0 }, 0.3).cut, false, 'bez kanału otworu nigdy');
});

// ── WGSL (Node, bez GPU) ─────────────────────────────────────────────────────

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = mesh.material;
  b.build();
  return b;
}
function holders() {
  const t = new THREE.Texture(); t.image = { width: 64, height: 32 }; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  return {
    uSprite: { value: t }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uHasNormalMap: { value: 0 },
    uSpriteSize: { value: new THREE.Vector2(64, 32) }, uLightDir: { value: new THREE.Vector3(0, 0, 1) }, uRotation: { value: 0 },
    uLodOpacity: { value: 1 }, uBillboardLighting: { value: 0 }, uShipLightCount: { value: 0 }, uEngineZoneCount: { value: 0 },
    uLightBase: { value: 0 }, uShapeMap: HullLacquer.flatShapeUniform, uLacquerWeight: { value: 1 }, uLacquerGlint: { value: 1 },
    uDmgSlot: { value: new THREE.Vector4(0, 1, 1, 0) }, uDmgWorld: { value: new THREE.Vector2(1, 1) }, uGridOwner: { value: 0 }
  };
}
function beamGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(4), 1));
  g.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

test('WGSL materiału: skóra belek czyta pulę ran i siatkę świateł (tylko odczyt), heksy i płyta pancerza — nie', () => {
  const beam = buildMesh(new THREE.Mesh(beamGeometry(), new HullNodeMaterial('beam', holders()))).fragmentShader;
  const armor = buildMesh(new THREE.Mesh(new THREE.PlaneGeometry(64, 32), new HullNodeMaterial('armor', holders()))).fragmentShader;
  assert.match(beam, /var<storage, read> hullDamagePool\b/);
  assert.match(beam, /var<storage, read> fxGridLights\b/);
  assert.match(beam, /var<storage, read> fxGridIndex\b/);
  assert.doesNotMatch(beam, /read_write/, 'materiał nie pisze do puli');
  assert.ok((beam.match(/var<storage/g) || []).length <= 8, 'limit 8 buforów storage na etap');
  assert.ok((beam.match(/var<uniform>/g) || []).length <= 12, 'limit 12 buforów uniformów na etap');
  assert.doesNotMatch(beam, /mat3x3<f32>/, 'szum rany bez macierzy uv (jawne uv)');
  assert.match(beam, /unpack2x16float/, 'żar i jony z f16');
  // Rana tylko przy slocie (warunek jednolity: slot ran z bufora danych kadłuba — indeks z uniformu obiektu,
  // zadanie 23) i jedno źródło żaru (max ze skórą).
  assert.match(beam, /if \( \( hullObjects\.value\[ \( \w+ \+ 12u \) \]\.w > 0\.5 \) \)/);
  assert.match(beam, /max\( \(?[^;]*heat|max\(/);
  for (const v of [armor]) {
    assert.doesNotMatch(v, /hullDamagePool|fxGrid/, 'płyta pancerza bez mapy ran i świateł efektów');
  }
  // Graf wariantu wspólny — mapa nie rozbija klucza programu na kadłub.
  const a = new HullNodeMaterial('beam', holders());
  const b = new HullNodeMaterial('beam', holders());
  b.uniforms.uDmgSlot.value.set(4096, 256, 128, 1);
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());
  // Haki w hexShips3D.tsl.js: żar skóry przez hullDamageHeat (max), rany tylko skóra belek (damage: true).
  const tsl = read('src/3d/hexShips3D.tsl.js');
  assert.match(tsl, /finalColor\.addAssign\(hullDamageHeat\(ctx, heatRamp\(heat\)/);
  // Lakier na ranie: mnożnik per piksel PO warunku jednolitym bloku lakieru (inaczej pochodne w niejednolitym przepływie).
  assert.match(tsl, /const lacquerW = hullDamageLacquer\(ctx, lacquerW0\.mul\(shape\.z\)\)\.toVar\(\);/);
  assert.ok(tsl.indexOf('If(lacquerW0.greaterThan(0.001)') < tsl.indexOf('const lacquerW = hullDamageLacquer('));
  assert.match(tsl, /damage: true/);
  assert.match(tsl, /damage: opts\.damage === true/);
});

test('WGSL kernela: pula read_write, zadania i stemple tylko do odczytu, wyszukiwanie binarne, przesunięcia na u32', () => {
  HullDamageMap._ensureSlots();
  const g = HullDamageMap._ensureGpu();
  const b = renderer.backend.createNodeBuilder(g.kernel, renderer);
  b.build();
  const w = b.computeShader;
  assert.match(w, /var<storage, read_write> hullDamagePoolRW\b/);
  assert.match(w, /var<storage, read> hullDamageJobs\b/);
  assert.match(w, /var<storage, read> hullDamageStamps\b/);
  assert.match(w, /pack2x16float/);
  assert.match(w, /fn hullDamageCool/);
  assert.equal((w.match(/hullDamageJobs\.value\[ \( nodeVar\d+ \* 4u \) \]\.x <= instanceIndex/g) || []).length, Math.log2(M.DMG_JOB_CAP), 'kroki wyszukiwania binarnego');
  assert.doesNotMatch(w, /(>>|<<) \d+(?![\du])/, 'przesunięcia tylko o u32');
  assert.match(w, />> 8u/);
  // Kanał krateru (25c): czwarty bajt słowa 1, czwarty vec4 stempla (promień prawdziwej dziury).
  assert.match(w, /<< 24u/);
  assert.equal(T.DMG_STAMP_VEC4, 4);
});
