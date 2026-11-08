// Demo A/B kawałków wiązanych wokseli (src/3d/woksele/kawalki.js, kawalkiObraz.js, docs/RAPORT-kawalki-zawalen.md): prefraktura przy wypieku, zbrojenie, wiązanie ciągliwe
// we wzorcu CPU i obraz w WGSL z Node. Kadry i koszt na GPU: scripts/webgpu/woksele-kawalki.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { zbudujPlan, STRONA, ND } from '../src/3d/woksele/budowa.js';
import { S1 } from '../src/3d/woksele/scena.js';
import { zbudujKawalki, wybierzZbrojenie, wypiekZeZbrojeniem, nakladkaKruchosci, KRUCHOSC, BRAK } from '../src/3d/woksele/kawalki.js';
import { zbuduj, parametry } from '../src/3d/woksele/budowa.js';
import { createWokseleSolver } from '../src/3d/woksele/solver.js';
import { createWokseleObraz } from '../src/3d/woksele/obraz.js';
import { WzorzecCpu } from '../dema/woksele-zawalenia/wzorzec-cpu.js';

const { w } = zbudujPlan(S1());
const kaw = zbudujKawalki(w);

test('prefraktura: bryłki poziomu 2 dzielą budynek bez szpar i zakładek (objętość = liczba węzłów), poziomy 0 i 1 są zamknięte', () => {
  const [v0, v1, v2] = kaw.stat.objetoscPoziomow;
  assert.ok(Math.abs(v2 - w.n) < 1e-3, `poziom 2: ${v2} wobec ${w.n}`);
  // Poziomy 0 i 1 obejmują część węzłów, a przesunięte narożniki na ich brzegu zmieniają objętość najwyżej o ułamek komórki na węzeł brzegu.
  const w0 = w.n - kaw.stat.poziom0.wezlowBez, w1 = kaw.stat.poziom1.wezlowW;
  assert.ok(Math.abs(v0 - w0) < 0.05 * w0, `poziom 0: ${v0} wobec ${w0}`);
  assert.ok(Math.abs(v1 - w1) < 0.05 * w1, `poziom 1: ${v1} wobec ${w1}`);
});

test('kawałki: poziom 0 spójny po wiązaniach wewnątrz kawałka, poziom 1 zawiera się w rodzicu, maski wewnętrzne symetryczne', () => {
  const { kawWez, kawInfo, kawCzl, K0, K } = kaw;
  for (let k = 0; k < K; k++) {
    const start = kawInfo[4 * k], ile = kawInfo[4 * k + 1], poz = kawInfo[4 * k + 3] & 3;
    assert.ok(ile >= 2, `kawałek ${k} ma ${ile} węzłów`);
    assert.equal(poz, k < K0 ? 0 : 1);
    const czl = new Set(kawCzl.subarray(start, start + ile));
    // Spójność: przejście po bitach maski wewnętrznej z pierwszego węzła odwiedza wszystkie.
    const st = [kawCzl[start]], byl = new Set(st);
    while (st.length) {
      const i = st.pop();
      const m = kawWez[4 * i + 2 + poz];
      for (let d = 0; d < ND; d++) if ((m >>> d) & 1) { const j = w.nbr[STRONA * i + d]; if (!byl.has(j)) { byl.add(j); st.push(j); } }
    }
    assert.equal(byl.size, czl.size, `kawałek ${k} niespójny`);
    if (poz === 1) for (const i of czl) assert.equal(kawWez[4 * i], kawInfo[4 * k + 2], 'część poziomu 1 poza rodzicem');
  }
  for (let i = 0; i < w.n; i++) for (let d = 0; d < ND; d++) {
    const j = w.nbr[STRONA * i + d];
    if (j < 0) continue;
    for (const p of [2, 3]) assert.equal((kawWez[4 * i + p] >>> d) & 1, (kawWez[4 * j + p] >>> (d ^ 1)) & 1, `maska ${p} ${i}–${j}`);
  }
  // Liczba wiązań wewnętrznych w kawInfo.w zgadza się z maskami.
  for (let k = 0; k < K; k++) {
    const start = kawInfo[4 * k], ile = kawInfo[4 * k + 1], poz = kawInfo[4 * k + 3] & 3;
    let suma = 0;
    for (let q = start; q < start + ile; q++) { let m = kawWez[4 * kawCzl[q] + 2 + poz]; for (; m; m &= m - 1) suma++; }
    assert.equal(kawInfo[4 * k + 3] >>> 2, suma);
  }
});

test('prefraktura i zbrojenie są deterministyczne (bajt w bajt), bez Math.random', () => {
  const los = Math.random;
  Math.random = () => { throw new Error('Math.random w wypieku kawałków'); };
  try {
    const b = zbudujKawalki(w);
    for (const k of ['kawWez', 'kawInfo', 'kawRest', 'kawCzl']) assert.deepEqual(b[k], kaw[k], k);
    for (const k of ['pozycja', 'id', 'odlup', 'indeksy']) assert.deepEqual(b.geometria[k], kaw.geometria[k], k);
    const z1 = wybierzZbrojenie(w, kaw), z2 = wybierzZbrojenie(w, b);
    assert.deepEqual(z1.druty, z2.druty);
  } finally {
    Math.random = los;
  }
});

test('zbrojenie: tylko osiowe wiązania na granicy kawałków poziomu 0, klasa + 12 na obu końcach, wypiek wejściowy bez zmian', () => {
  const klasa0 = w.klasaW.slice(), ft0 = w.Ft.slice(), it0 = w.iT.slice();
  const z = wybierzZbrojenie(w, kaw);
  assert.ok(z.ile > 100, `prętów ${z.ile}`);
  assert.deepEqual(w.klasaW, klasa0);
  assert.deepEqual(w.Ft, ft0);
  assert.deepEqual(w.iT, it0);
  const pret = new Set();
  for (let q = 0; q < z.ile; q++) {
    const i = z.druty[4 * q], j = z.druty[4 * q + 1], d = z.druty[4 * q + 2];
    assert.ok(d < 6, 'pręt na wiązaniu osiowym');
    assert.equal(w.nbr[STRONA * i + d], j);
    assert.ok(kaw.kawWez[4 * i] === BRAK || kaw.kawWez[4 * i] !== kaw.kawWez[4 * j], 'pręt na granicy kawałków');
    assert.equal(z.klasaW[STRONA * i + d], w.klasaW[STRONA * i + d] + 12);
    assert.equal(z.klasaW[STRONA * j + (d ^ 1)], z.klasaW[STRONA * i + d]);
    pret.add(STRONA * i + d).add(STRONA * j + (d ^ 1));
  }
  for (let q = 0; q < z.klasaW.length; q++) if (!pret.has(q)) assert.equal(z.klasaW[q], w.klasaW[q]);
  assert.equal(z.kruszTab.length, 18);
  assert.ok(z.ciagl.twardy > 1 + w.par.rozcHard);
});

test('wzorzec CPU: wypiek bez prętów liczy bit w bit tak samo, pręt rozciągnięty do 2 R0 przeżywa, beton pęka', () => {
  const zero = wypiekZeZbrojeniem(w, wybierzZbrojenie(w, kaw, { gestosc: 0 }));
  const a = new WzorzecCpu(w), b = new WzorzecCpu(zero);
  for (let k = 0; k < 2; k++) { a.krok(); b.krok(); }
  assert.deepEqual(b.pos, a.pos);
  assert.deepEqual(b.vel, a.vel);
  assert.deepEqual(b.maskaW, a.maskaW);
  assert.deepEqual(b.D, a.D);

  const z = wybierzZbrojenie(w, kaw);
  const wz = wypiekZeZbrojeniem(w, z);
  // Pręt i zwykłe wiązanie osiowe (beton): koniec j odsunięty wzdłuż wiązania do 2 R0, jeden przebieg F.
  // Węzły stojące (dolna warstwa) nie liczą przebiegu F: oba końce obu wiązań muszą być wolne, a wiązania daleko od siebie.
  let q = 0;
  while (w.nieruchomy[z.druty[4 * q]] || w.nieruchomy[z.druty[4 * q + 1]]) q++;
  const i = z.druty[4 * q], j = z.druty[4 * q + 1], d = z.druty[4 * q + 2];
  let ib = -1, jb = -1, db = -1;
  for (let x = 0; x < w.n && ib < 0; x++) for (let e = 0; e < 6; e++) {
    const y = w.nbr[STRONA * x + e];
    if (y >= 0 && ((w.maska[x] >>> e) & 1) && wz.klasaW[STRONA * x + e] < 12 && !w.nieruchomy[x] && !w.nieruchomy[y] && Math.abs(x - i) > 2000) { ib = x; jb = y; db = e; break; }
  }
  const rozciagnij = (m, a1, b1) => {
    for (let c = 0; c < 3; c++) m.pos[3 * b1 + c] = m.pos[3 * a1 + c] + 2 * (w.pos[3 * b1 + c] - w.pos[3 * a1 + c]);
  };
  const m = new WzorzecCpu(wz);
  rozciagnij(m, i, j);
  rozciagnij(m, ib, jb);
  m._przebudujListe();
  m._przebiegF(); // po przebiegu bufory masek się zamieniają: wynik w maskaW
  assert.equal((m.maskaW[i] >>> d) & 1, 1, 'pręt przy 2 R0 zostaje');
  assert.equal((m.maskaW[ib] >>> db) & 1, 0, 'beton przy 2 R0 pęka');
});

test('kruchość: poziom 0 to ta sama nakładka, wyższe poziomy zwężają granice gięcia (szyja, zgłoszenie 2026-11-08), a wypiek bez nich bajt w bajt', () => {
  assert.equal(nakladkaKruchosci(undefined, 0), undefined);
  const n2 = nakladkaKruchosci({ ziarno: 7 }, 2);
  assert.equal(n2.ziarno, 7);
  assert.equal(n2.zlomB, KRUCHOSC[2].zlomB);
  assert.equal(n2.ziarna.zlomWewn, KRUCHOSC[2].zlomWewn);
  assert.equal(n2.ziarna.wewn, w.par.ziarna.wewn, 'reszta ziaren bez zmian');
  const plan = S1();
  const wk = zbuduj(plan.scena, parametry(n2));
  assert.equal(wk.n, w.n);
  let mniej = 0;
  for (let i = 0; i < w.n; i++) { assert.ok(wk.bMax2W[i] <= w.bMax2W[i]); if (wk.bMax2W[i] < w.bMax2W[i]) mniej++; }
  assert.ok(mniej > 0.9 * w.n, `węższa granica gięcia u ${mniej} z ${w.n}`);
  assert.equal(wk.par.zlomB, KRUCHOSC[2].zlomB);
  // Bez nakładki: mnożnik 1 nie zmienia granicy ani bitu.
  assert.deepEqual(zbuduj(plan.scena).bMax2W, w.bMax2W);
});

test('sztywność: K × s², podkroki × s, wytrzymałości i sprężenie bez zmian, bez pola bajt w bajt (zgłoszenie 2026-11-08: szyja jak guma)', () => {
  const plan = S1();
  const w2 = zbuduj(plan.scena, parametry({ sztywnosc: 2 }));
  assert.ok(Math.abs(w2.K / w.K - 4) < 1e-9, `K ${w2.K} wobec ${w.K}`);
  assert.equal(w2.podkrokiEf, 2 * w.podkrokiEf);
  assert.ok(Math.abs(w2.h * Math.sqrt(12 * w2.K) - w.h * Math.sqrt(12 * w.K)) < 1e-9, 'ta sama stabilność h·√(12K)');
  assert.deepEqual(w2.Ft, w.Ft);
  assert.deepEqual(w2.Fc, w.Fc);
  assert.deepEqual(w2.F0, w.F0);
  assert.deepEqual(w2.bMax2W, w.bMax2W);
  assert.deepEqual(zbuduj(plan.scena, parametry({})).Ft, w.Ft);
});

// ── Obraz w WGSL z Node ──
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const camera = new THREE.PerspectiveCamera(32, 1, 20, 700000);
const solver = createWokseleSolver({ ciagliwe: true });
const obraz = createWokseleObraz({ solver, camera, kawalki: true });

function nieprzypisane(kod) {
  const zle = [];
  for (const nazwa of new Set([...kod.matchAll(/var (nodeVar\d+)\b/g)].map((m) => m[1]))) {
    const zapis = kod.search(new RegExp(`\\b${nazwa}\\s*(\\.[xyzw]+\\s*)?=[^=]`));
    const odczyt = kod.search(new RegExp(`(?<!var )\\b${nazwa}\\b(?!\\s*(\\.[xyzw]+\\s*)?=[^=])`));
    if (odczyt >= 0 && (zapis < 0 || odczyt < zapis)) zle.push(nazwa);
  }
  return zle;
}

test('obraz kawałków: kernele i wierzchołki najwyżej 8 buforów storage, solver tylko do odczytu, bez nieprzypisanych zmiennych', () => {
  for (const k of Object.values(obraz.kawalki.kernele)) {
    const b = renderer.backend.createNodeBuilder(k, renderer);
    b.build();
    assert.ok((b.computeShader.match(/var<storage/g) || []).length <= 8);
    assert.doesNotMatch(b.computeShader, /var<storage, read_write> \w*[wW]okWez/);
  }
  for (const [mesh, scena] of [[obraz.kawalki.mesh, obraz.scene], [obraz.kawalki.meshGleb, obraz.sceneGleb], [obraz.kawalki.meshDruty, obraz.scene], [obraz.kawalki.meshDrutyGleb, obraz.sceneGleb]]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.scene = scena;
    b.camera = camera;
    b.material = mesh.material;
    b.lightsNode = renderer.lighting.getNode(scena);
    b.build();
    assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8, mesh.name);
    assert.doesNotMatch(b.vertexShader, /var<storage, read_write>/, mesh.name);
    assert.deepEqual(nieprzypisane(b.vertexShader), [], `${mesh.name}: wierzchołek`);
    assert.deepEqual(nieprzypisane(b.fragmentShader), [], `${mesh.name}: fragment`);
  }
});

test('obraz bez opcji kawałków: te same sceny i kernele co dotąd; tryb obrazu to sama widoczność siatek', () => {
  const o = createWokseleObraz({ solver: createWokseleSolver(), camera });
  assert.equal(o.kawalki, null);
  assert.deepEqual(o.scene.children.map((c) => c.name).filter(Boolean), ['WokGrunt', 'WokBryly', 'WokGruz']);
  assert.ok(!Object.keys(o.kernele).some((k) => k.startsWith('kKaw')));
  obraz.ustawTryb(2);
  assert.equal(obraz.mesh.visible, false);
  assert.equal(obraz.kawalki.mesh.visible, true);
  assert.equal(obraz.kawalki.meshDruty.visible, true);
  obraz.ustawTryb(1);
  assert.equal(obraz.kawalki.meshDruty.visible, false);
  obraz.ustawTryb(0);
  assert.equal(obraz.mesh.visible, true);
  assert.equal(obraz.kawalki.mesh.visible, false);
});
