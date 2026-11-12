// Liny bazy piratów (prośba użytkownika 2026-11-12: „widzę szpary, pusta przestrzeń ciągnie w dół — trzeba dodać coś, co trzyma, jakieś druty”).
// Plan lin w scenie (scenaBazy.js, planLin), kernel kLiny w solverze, upadek z linami (grupyGry.czesciUpadku) i rysunek (linyObraz.js). Bez GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { scenaB1 } from '../src/3d/woksele/scenaBazy.js';
import { createWokseleSolver } from '../src/3d/woksele/solver.js';
import { createGrupyGry, UPADEK_BOKI_LINY } from '../src/3d/woksele/grupyGry.js';
import { createLinyObraz, ileWidocznych } from '../src/3d/woksele/linyObraz.js';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const plan = scenaB1({ dx: 40, wGrze: true });
const L = plan.liny, sc = plan.scena, cz = plan.miasto.budynki;
const czesc = (i) => cz.find((b) => i >= b.start && i < b.start + b.n)?.nazwa;
const srodek = (n) => n === 'H-C + H-T' || n === 'trzon' || n === 'dysk D-1…8' || /^B-\d+$/.test(n);

test('plan lin: każdy bok połączony ze środkiem, każdy węzeł ciągnięty raz, widoczne na początku, liny do dysku przy obu pomostach', () => {
  assert.ok(L.length > 50 && L.length < 512, `lin ${L.length}`);
  assert.equal(new Set(L.map((l) => l.b)).size, L.length, 'każdy b w jednej linie (pisze go jeden wątek kLiny)');
  for (const l of L) {
    assert.notEqual(czesc(l.a), czesc(l.b), 'lina łączy dwie części');
    assert.ok(!srodek(czesc(l.b)), 'ciągnięty jest bok, nie środek');
    assert.ok(l.L0 > 0 && l.rozcMax > 0 && l.k > 0 && l.k <= 1);
  }
  const nW = ileWidocznych(L);
  assert.ok(nW > 0 && L.slice(nW).every((l) => !l.widac), 'widoczne pierwsze');
  for (const pomost of ['N-P', 'F-P']) assert.ok(L.filter((l) => l.widac && czesc(l.a) === 'dysk D-1…8' && czesc(l.b) === pomost).length >= 8, `${pomost}: liny do dysku`);
  assert.ok(L.some((l) => czesc(l.a) === 'N-P' && czesc(l.b) === 'AG-1'), 'reaktor zespojony z pomostem');
  // Sieć: od środka po linach dochodzi się do każdej części boku (zbiorniki i magazyn mostami przez szczeliny).
  const sas = new Map();
  for (const l of L) for (const [p, q] of [[czesc(l.a), czesc(l.b)], [czesc(l.b), czesc(l.a)]]) { if (!sas.has(p)) sas.set(p, new Set()); sas.get(p).add(q); }
  const siec = new Set(['dysk D-1…8']), st = ['dysk D-1…8'];
  while (st.length) for (const q of sas.get(st.pop()) ?? []) if (!siec.has(q)) { siec.add(q); st.push(q); }
  const poza = cz.map((b) => b.nazwa).filter((n) => !srodek(n) && !siec.has(n));
  assert.deepEqual(poza, [], 'boki poza siecią lin');
  assert.deepEqual(scenaB1({ dx: 80, liny: false }).liny, [], 'liny: false — bez lin');
});

test('kLiny: kernel tylko z opcją liny, po kI w każdym podkroku; kF bez zmian; wczytaj ustawia liczbę lin', () => {
  const kod = (s, k) => { const b = renderer.backend.createNodeBuilder(s.kernele[k], renderer); b.build(); return b.computeShader; };
  const bez = createWokseleSolver(), z = createWokseleSolver({ liny: 64 });
  assert.equal(bez.liny, null);
  assert.ok(!('kLiny' in bez.kernele));
  assert.equal(kod(z, 'kF'), kod(bez, 'kF'), 'kF bajt w bajt');
  assert.match(kod(z, 'kLiny'), /wokLinyE/);
  assert.equal(z.liny.wczytaj([{ a: 1, b: 2, L0: 100 }, { a: 3, b: 4, L0: 50 }]), 2);
  assert.equal(z.liny.n, 2);
  const p = z.liny.atrybuty.p.array;
  assert.deepEqual([p[0], p[3], p[4]], [100, 1, 50], 'L0 i stan całej liny');
});

test('upadek z linami: boki puszczają razem chwilę po środku, bez obrotu startowego', () => {
  const l = createPirateBaseLayout({ id: 'B1' });
  const grupy = createGrupyGry({ w: sc, l, dx: 40 });
  const start = 3;
  const plan1 = grupy.czesciUpadku(cz, { start, zLinami: true });
  for (const c of plan1) {
    if (srodek(c.nazwa)) continue;
    assert.ok(c.t >= start + UPADEK_BOKI_LINY.po - 1e-9 && c.t <= start + UPADEK_BOKI_LINY.po + UPADEK_BOKI_LINY.rozrzut + 1e-9, `${c.nazwa}: t ${c.t}`);
    assert.ok(!c.om, `${c.nazwa}: bez obrotu startowego`);
  }
});

test('linyObraz: materiał buduje się w Node (3 bufory storage w wierzchołkach), rysunek tylko widocznych lin', () => {
  const s = createWokseleSolver({ liny: 256 });
  const lo = createLinyObraz({ solver: s });
  lo.ustaw(ileWidocznych(L));
  assert.equal(lo.n, ileWidocznych(L));
  const b = renderer.backend.createNodeBuilder(lo.mesh, renderer);
  b.material = lo.mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = lo.mesh.material;
  b.build();
  assert.ok(b.vertexShader.length > 100 && b.fragmentShader.length > 50);
  assert.doesNotMatch(b.vertexShader + b.fragmentShader, /\bpow\(/);
  assert.ok((b.vertexShader.match(/var<storage/g) || []).length <= 8, 'limit buforów storage w wierzchołkach');
  assert.equal(createLinyObraz({ solver: createWokseleSolver() }), null, 'solver bez lin: bez rysunku');
});
