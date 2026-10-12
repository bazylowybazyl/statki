// Komety (strumień B planu docs/PLAN-pas-realizm.md): czysta logika — odwzorowanie AU, aktywność, orbita, kierunki
// i kształt warkoczy (lustra CPU wzorów shadera z src/3d/comets/comets.tsl.js), dżety, jądro (nawinięcie, normalne,
// obrys, pole odległości), rozstawienie, kolizje — oraz budowa WGSL obu grafów w Node (limity WebGPU, wspólny graf).
// node --test tests/comets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { COMETS, COMET_BY_ID, COMET_TUNE, realAuToMapAu, realAuToMapSlope } from '../src/data/comets.js';
import {
  cometActivity, cometOrbitState, cometGasGeometry, dustTailEnvelope, dustTailBounds, ionTailAxis, ionTailWidth,
  jetEmission, cometSheetExtent, placeComets, planetKeepOut, trojanKeepOut
} from '../src/game/comets.js';
import {
  buildNucleusSurface, bakeNucleusSdfGrid, sampleNucleusSdfGrid, prepareNucleusShape, nucleusSdf, outlineRadiusAt,
  NUCLEUS_SDF_RANGE
} from '../src/game/cometNucleus.js';
import { CometField } from '../src/game/cometField.js';

const AU = 42253.52;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b} (±${eps})`);

test('AU prawdziwe → AU mapy: umowa planu (Ziemia 25, Mars 33, Jowisz 50,2; Mars–Jowisz 4,675 / AU)', () => {
  near(realAuToMapAu(1), 25, 1e-9, 'Ziemia');
  near(realAuToMapAu(1.524), 33, 1e-9, 'Mars');
  near(realAuToMapAu(5.203), 50.2, 1e-9, 'Jowisz');
  near(realAuToMapAu(2.77), 33 + (2.77 - 1.524) * 4.675, 0.01, 'Ceres (umowa planu)');
  near(realAuToMapSlope(3), (50.2 - 33) / (5.203 - 1.524), 1e-9, 'nachylenie Mars–Jowisz');
  let prev = -1;
  for (let r = 0; r < 60; r += 0.25) {
    const m = realAuToMapAu(r);
    assert.ok(m > prev, `monotoniczne przy ${r} AU`);
    prev = m;
  }
});

test('aktywność: rośnie ku Słońcu, lód wody budzi się ~3 AU, CO daje aktywność dalej', () => {
  const w = { production: 1, co: 0 };
  const a1 = cometActivity(w, 1), a2 = cometActivity(w, 2), a3 = cometActivity(w, 3), a45 = cometActivity(w, 4.5);
  assert.ok(a1 > a2 && a2 > a3 && a3 > a45, 'malejąca z odległością');
  assert.ok(a3 / a1 < 0.25 && a3 / a1 > 0.02, `przy 3 AU próg sublimacji (${(a3 / a1).toFixed(3)})`);
  assert.ok(a45 / a1 < 0.005, `przy 4,5 AU wygaszona (${(a45 / a1).toFixed(4)})`);
  const co = { production: 1, co: 0.3 };
  assert.ok(cometActivity(co, 4.5) > 20 * cometActivity(w, 4.5), 'CO trzyma komę daleko (Hale–Bopp)');
  // komety gry: 3 aktywne, Tempel 1 przy ~4,6 AU uśpiony (samo jądro)
  for (const c of COMETS) {
    const st = cometOrbitState(c);
    const g = cometGasGeometry(c, st, AU);
    assert.equal(g.active, c.id !== 'tempel-1', `${c.id}: aktywna przy ${st.rAu.toFixed(2)} AU`);
  }
});

test('orbita: odległość z q, e, ν; prędkość prostopadła do promienia w peryhelium; obieg wsteczny odwraca kierunek', () => {
  const def = COMET_BY_ID.halley;
  const p0 = cometOrbitState(def, 0, COMET_TUNE, 0);
  near(p0.rAu, def.orbit.q, 1e-12, 'r(ν = 0) = q');
  near(p0.ux * p0.vx + p0.uy * p0.vy, 0, 1e-9, 'v ⟂ r w peryhelium');
  const st = cometOrbitState(def, 0, COMET_TUNE, 77);
  const p = def.orbit.q * (1 + def.orbit.e);
  near(st.rAu, p / (1 + def.orbit.e * Math.cos(77 * Math.PI / 180)), 1e-12, 'r(ν)');
  assert.ok(st.ux * st.vx + st.uy * st.vy > 0, 'po peryhelium oddala się od Słońca');
  // Halley obiega wstecznie (dir = −1): obrót od r do v przeciwny niż u komety prostej
  const pro = cometOrbitState(COMET_BY_ID['hale-bopp']);
  const crossH = st.ux * st.vy - st.uy * st.vx;
  const crossP = pro.ux * pro.vy - pro.uy * pro.vx;
  assert.ok(crossH * crossP < 0, 'obieg wsteczny');
  // vis-viva: v² = GM (2/r − 1/a)
  const a = def.orbit.q / (1 - def.orbit.e);
  near(st.vKm, 29.78 * Math.sqrt(2 / st.rAu - 1 / a), 1e-6, 'vis-viva');
});

test('warkocze: jonowy od Słońca z aberracją w tył, pył za ruchem, wachlarz między syndyną a synchroną', () => {
  for (const c of COMETS) {
    const st = cometOrbitState(c);
    const g = cometGasGeometry(c, st, AU);
    if (!g.active) continue;
    // oś „za ruchem” w świecie gry
    const yx = -g.ay * g.lagSign, yy = g.ax * g.lagSign;
    assert.ok(yx * st.vx + yy * st.vy < 0, `${c.id}: strona lag przeciwna do ruchu`);
    const ax = ionTailAxis(g);
    const wx = g.ax * ax.x + yx * ax.y, wy = g.ay * ax.x + yy * ax.y;
    const cosSun = wx * st.ux + wy * st.uy;
    assert.ok(cosSun > Math.cos(10 * Math.PI / 180), `${c.id}: jonowy ~od Słońca (${(Math.acos(cosSun) * 57.3).toFixed(1)}°)`);
    assert.ok(g.ionAngle > 0.02 && g.ionAngle < 0.15, `${c.id}: aberracja kilka stopni`);
    assert.ok(ionTailWidth(g.ionLen, g) > ionTailWidth(0, g), 'jonowy rozszerza się');
    // pył: jasny w wachlarzu za ruchem, prawie zero po drugiej stronie, gaśnie za końcem
    for (const X of [0.2, 0.5, 0.8]) {
      const b = dustTailBounds(X, g);
      assert.ok(b.yOut > b.yIn, `${c.id}: wachlarz przy X = ${X}`);
      const mid = 0.5 * (b.yIn + b.yOut);
      const inside = dustTailEnvelope(X, mid, g);
      const mirror = dustTailEnvelope(X, -mid, g);
      assert.ok(inside > 0.5, `${c.id}: pył w wachlarzu (X = ${X}: ${inside.toFixed(2)})`);
      // u nasady (w komie i tuż za nią) pył startuje z całej komy — rozmycie ~ rozmiar komy; dalej jednostronny
      const inComa = X * g.dustLen < g.comaR;
      assert.ok(mirror < inside * (inComa ? 0.95 : 0.02), `${c.id}: pył po stronie przeciwnej (X = ${X}: ${mirror.toFixed(4)} / ${inside.toFixed(2)})`);
    }
    assert.ok(dustTailEnvelope(1.3, dustTailBounds(1.0, g).yOut * 0.7, g) === 0, `${c.id}: koniec warkocza pyłowego`);
    // pył dalej od osi = starszy: kąt synchrony rośnie, krawędź od strony antysłonecznej zakrzywia się
    const b02 = dustTailBounds(0.2, g), b08 = dustTailBounds(0.8, g);
    assert.ok(b08.yIn / 0.8 > b02.yIn / 0.2, `${c.id}: syndyna zakrzywia się za ruchem`);
    const e = cometSheetExtent(g);
    assert.ok(e[1] >= g.ionLen && e[3] > 0 && e[2] < 0 && e[0] < 0, `${c.id}: arkusz obejmuje warkocze`);
  }
});

test('dżety: tylko ze strony dziennej w chwili emisji, spirala opóźniona o ω·τ', () => {
  const R = 4000, v = COMET_TUNE.gasSpeed, om = 0.02;
  const jet = { lon: Math.PI, lat: 0 };     // w układzie warkocza Słońce leży na kącie π
  const day = jetEmission(R * 1.2, jet, 0, om, v, R);
  assert.ok(day.lit > 0.9 && day.insolation > 0.9, 'dżet ku Słońcu świeci');
  const night = jetEmission(R * 1.2, { lon: 0, lat: 0 }, 0, om, v, R);
  assert.equal(night.lit, 0, 'dżet po stronie nocnej nie świeci');
  const far = jetEmission(R * 6, jet, 0, om, v, R);
  near(far.phi, Math.PI - om * (R * 6 - 0.85 * R) / v, 1e-9, 'materia dalej — wyrzucona wcześniej (spirala)');
});

test('jądro: trójkąty przodem na zewnątrz, normalne na zewnątrz, obrys z góry obejmuje wierzchołki', () => {
  const def = COMET_BY_ID['67p'];
  const s = buildNucleusSurface(def.nucleus, 20, 128);
  const P = s.positions, Nn = s.normals, I = s.indices;
  let out = 0, total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (nx * cx + ny * cy + nz * cz > 0) out++;
    total++;
  }
  assert.ok(out / total > 0.97, `przód trójkątów na zewnątrz: ${(out / total * 100).toFixed(1)}%`);
  let nOut = 0;
  for (let i = 0; i < P.length; i += 3) if (Nn[i] * P[i] + Nn[i + 1] * P[i + 1] + Nn[i + 2] * P[i + 2] > 0) nOut++;
  assert.ok(nOut / (P.length / 3) > 0.95, 'normalne na zewnątrz');
  for (let i = 0; i < P.length; i += 3) {
    const r = Math.hypot(P[i], P[i + 1]);
    assert.ok(r <= outlineRadiusAt(s.outline, Math.atan2(P[i + 1], P[i])) + 1e-6, 'wierzchołek w obrysie');
  }
  assert.ok(s.zMax > 0.3 && s.zMin < -0.3, 'bryła 3D');
});

test('jądro: pole odległości — środek w środku, narożniki na zewnątrz, siatka zgodna z polem', () => {
  const def = COMET_BY_ID.halley;
  const shape = prepareNucleusShape(def.nucleus);
  assert.ok(nucleusSdf(shape, 0, 0, 0) < 0, 'środek w bryle');
  const g = bakeNucleusSdfGrid(def.nucleus, 24, shape);
  near(sampleNucleusSdfGrid(g, g.extent * 0.98, g.extent * 0.98, g.extent * 0.98), NUCLEUS_SDF_RANGE, 1e-6, 'narożnik daleko');
  assert.ok(sampleNucleusSdfGrid(g, 0, 0, 0) < 0, 'środek siatki w bryle');
});

test('rozstawienie: deterministyczne, poza strefami planet; Trojańczycy jako strefy', () => {
  const sun = { x: 6e6, y: 6e6 };
  const planets = [
    { id: 'earth', x: sun.x + 25 * AU * Math.cos(1.0), y: sun.y + 25 * AU * Math.sin(1.0), r: 2800 * 4, ringWorldRadius: 37800 },
    { id: 'mars', x: sun.x + 33 * AU * Math.cos(2.0), y: sun.y + 33 * AU * Math.sin(2.0), r: 3000 * 4, ringWorldRadius: 30000 },
    { id: 'jupiter', x: sun.x + 50.2 * AU * Math.cos(4.0), y: sun.y + 50.2 * AU * Math.sin(4.0), r: 3800 * 4 }
  ];
  const moons = [{ parentId: 'jupiter', orbitRadius: 250000 }];
  const keep = planetKeepOut(planets, moons, AU, 1.5, trojanKeepOut(planets[2], sun.x, sun.y, 8 * AU));
  const a = placeComets(COMETS, { sunX: sun.x, sunY: sun.y, au: AU, keepOut: keep });
  const b = placeComets(COMETS, { sunX: sun.x, sunY: sun.y, au: AU, keepOut: keep });
  assert.deepEqual(a.map((p) => [p.x, p.y]), b.map((p) => [p.x, p.y]), 'deterministyczne');
  for (const p of a) {
    assert.equal(p.blocked, false, `${p.def.id}: znalazła miejsce`);
    for (const z of keep) assert.ok(Math.hypot(p.x - z.x, p.y - z.y) >= z.r, `${p.def.id} poza strefą`);
    near(Math.hypot(p.x - sun.x, p.y - sun.y) / AU, p.state.rMap, 1e-6, `${p.def.id}: odległość = r mapy`);
  }
});

test('rozstawienie: avoid (pola pasa w ich kształcie) obraca peryhelium; bez miejsca — ostatni kandydat z flagą', () => {
  const sun = { x: 6e6, y: 6e6 };
  // „pole” = klin ±40° wokół kierunku, w którym stoją komety bez przesunięcia — każda musi z niego wyjść
  const free = placeComets(COMETS, { sunX: sun.x, sunY: sun.y, au: AU });
  const wedge = (p) => (x, y) => {
    const d = Math.atan2(y - sun.y, x - sun.x) - Math.atan2(p.y - sun.y, p.x - sun.x);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 40 * Math.PI / 180;
  };
  for (const p of free) {
    const avoid = wedge(p);
    const [q] = placeComets([p.def], { sunX: sun.x, sunY: sun.y, au: AU, avoid });
    assert.equal(q.blocked, false, `${p.def.id}: wolne miejsce poza klinem`);
    assert.equal(avoid(q.x, q.y), false, `${p.def.id}: poza klinem`);
    assert.ok(Math.abs(q.offset) > 0, `${p.def.id}: orbita obrócona`);
    near(Math.hypot(q.x - sun.x, q.y - sun.y) / AU, q.state.rMap, 1e-6, `${p.def.id}: ta sama odległość od Słońca`);
  }
  // avoid dostaje zapas komety (need = max(2 · koma, 4 · jądro)), wszystko zajęte → blocked
  const needs = [];
  const [one] = placeComets([COMETS[0]], { sunX: sun.x, sunY: sun.y, au: AU, maxSteps: 6, avoid: (x, y, need) => { needs.push(need); return true; } });
  assert.equal(one.blocked, true, 'bez miejsca');
  assert.equal(needs.length, 7, 'każdy kandydat sprawdzony (k = 0 … maxSteps)');
  assert.ok(needs.every((n) => n > 0), 'zapas komety > 0');
  const all = placeComets(COMETS, { sunX: sun.x, sunY: sun.y, au: AU, maxSteps: 6, avoid: () => true });
  for (const p of all) assert.equal(p.blocked, true, `${p.def.id}: bez miejsca`);
});

test('pole komet: kolizja wypycha kadłub z obrysu i odbija prędkość, pociski gasną, obrót obraca obrys', async () => {
  const field = new CometField({ sun: { x: 6e6, y: 6e6 }, au: AU, defs: [COMET_BY_ID['67p']], useWorkers: false });
  await field.build();
  const s = field.sites[0];
  assert.ok(s.ready && s.outline && s.reach > s.R * 0.5, 'jądro zbudowane');
  field.update(0);
  // statek wjeżdża w jądro od strony +x świata gry
  const r0 = field.outlineRadius(s, 1, 0);
  const body = { pos: { x: s.x + r0 + 100, y: s.y }, vel: { x: -300, y: 0 }, angle: Math.PI / 2, w: 600, h: 300, radius: 300 };
  const depth = field.collideShip(body);
  assert.ok(depth > 0, 'kolizja');
  assert.ok(body.vel.x > 0, 'prędkość w głąb odbita');
  const rAfter = Math.hypot(body.pos.x - s.x, body.pos.y - s.y);
  assert.ok(rAfter >= field.outlineRadius(s, body.pos.x - s.x, body.pos.y - s.y) + 300 * COMET_TUNE.hullCircle * 0.99 - 1, 'koła kadłuba poza obrysem');
  assert.ok(field.pointBlocked(s.x, s.y), 'pocisk w jądrze');
  assert.ok(!field.pointBlocked(s.x + s.reach * 1.05, s.y), 'pocisk poza');
  const far = { pos: { x: s.x + 1e5, y: s.y }, vel: { x: 0, y: 0 }, angle: 0, w: 600, h: 300 };
  assert.equal(field.collideShip(far), 0, 'daleko bez kolizji');
  // obrót: obrys w kierunku (1, 0) gry po obrocie o Δ = obrys w kierunku obróconym o −Δ (scena: y odbite)
  const d = 0.7;
  field.update(d / s.omega);
  near(field.outlineRadius(s, 1, 0), outlineRadiusAt(s.outline, -d) * s.R, 1e-6, 'obrót obrysu');
  // punkty orientacyjne: kierunek warkocza jonowego od Słońca
  const lm = field.landmarks()[0];
  assert.ok(lm.ionX * s.state.ux + lm.ionY * s.state.uy > 0.98, 'oś warkocza w punkcie orientacyjnym');
});

test('WGSL: arkusz i jądro budują się w Node, mieszczą w limitach, klony dzielą graf', async () => {
  const THREE = await import('three/webgpu');
  const { createCometSheetMaterial, createCometSheetGeometry, createCometNucleusMaterial, createCometSdfAtlas, COMET_LOOK } = await import('../src/3d/comets/comets.tsl.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (material, geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = material; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const ubufs = (w) => (w.match(/var<uniform>/g) || []).length;
  const sheetGeo = createCometSheetGeometry();
  const m1 = createCometSheetMaterial(), m2 = createCometSheetMaterial();
  assert.equal(m1.fragmentNode, m2.fragmentNode, 'arkusze: wspólny graf');
  assert.notEqual(m1.uniforms, m2.uniforms, 'arkusze: własne wartości');
  const w1 = build(m1, sheetGeo), w2 = build(m2, sheetGeo);
  assert.equal(w1.fragment, w2.fragment, 'ten sam WGSL (jeden program)');
  assert.ok(ubufs(w1.fragment) <= 12 && ubufs(w1.vertex) <= 12, 'bufory uniformów arkusza');
  assert.ok(sheetGeo.index.count / 6 >= 64 * 32, 'arkusz gęsty (rulon warpa gnie wierzchołki)');
  assert.notEqual(m1.rulonBend, false, 'arkusz gnie się w rulonie');
  assert.equal(COMET_LOOK.sheetSegX * COMET_LOOK.sheetSegY * 6, sheetGeo.index.count);
  const s = buildNucleusSurface(COMET_BY_ID.halley.nucleus, 6, 64);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
  g.setAttribute('aAo', new THREE.BufferAttribute(s.ao, 1));
  g.setIndex(new THREE.BufferAttribute(s.indices, 1));
  const atlas = createCometSdfAtlas(48, 4);
  const n1 = createCometNucleusMaterial(atlas, 48), n2 = createCometNucleusMaterial(atlas, 48);
  assert.equal(n1.fragmentNode, n2.fragmentNode, 'jądra: wspólny graf');
  const wn = build(n1, g);
  assert.ok(ubufs(wn.fragment) <= 12, 'bufory uniformów jądra');
  assert.ok(Object.keys(g.attributes).length <= 8, 'bufory wierzchołków jądra');
  assert.ok(/textureSampleLevel/.test(wn.fragment), 'pole odległości próbkowane z poziomu 0 (pętla cienia)');
});
