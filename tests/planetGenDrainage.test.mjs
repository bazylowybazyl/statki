// Spływ wody generatora planet (src/3d/planetGen/planetGenDrainage.js): drzewo rzek do morza, bez pętli i przecięć.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDrainage, drainReceiver, riverMouths, drainFlowDecode, drainFlowEncode, DRAIN_CODE_STEP, DRAIN_JITTER, DRAIN_SEA_K
} from '../src/3d/planetGen/planetGenDrainage.js';

// teren próbny: suma sinusów z haszem (deterministyczny, z zagłębieniami bez odpływu), ~45% lądu
function terrain(W, H, seed = 1) {
  const h = new Float32Array(W * H);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const waves = [];
  for (let k = 0; k < 24; k++) {
    const f = 1 + Math.floor(rnd() * (2 + k));
    waves.push([f, 1 + Math.floor(rnd() * (1 + k)), rnd() * 6.283, rnd() * 6.283, 1 / (1 + k * 0.6)]);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = -0.15;
      const a = x / W * 2 * Math.PI;
      const b = y / H * Math.PI;
      for (const [fx, fy, p1, p2, amp] of waves) v += Math.sin(a * fx + p1) * Math.sin(b * fy + p2) * amp;
      h[y * W + x] = v * 0.8;
    }
  }
  return h;
}

test('spływ: każda komórka lądu spływa do morza, bez pętli', () => {
  const W = 256;
  const H = 128;
  const h = terrain(W, H, 7);
  const d = computeDrainage(h, null, W, H);
  assert.ok(d.stats.land > W * H * 0.15 && d.stats.land < W * H * 0.85, `udział lądu ${d.stats.land / (W * H)}`);
  assert.ok(d.stats.filled > 0, 'teren próbny ma zagłębienia do wypełnienia');
  let checked = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(h[i] > 0)) { assert.equal(d.data[i * 4], 0); assert.equal(d.data[i * 4 + 1], 0); continue; }
      // ścieżka w dół: najwyżej tyle kroków, ile jest komórek lądu
      let cx = x; let cy = y; let steps = 0;
      for (;;) {
        const r = drainReceiver(d, cx, cy);
        assert.ok(r, `komórka lądu (${cx}, ${cy}) bez odbiorcy`);
        assert.ok(Math.abs(r.y - cy) <= 1 && r.y >= 0 && r.y < H);
        if (!(h[r.y * W + r.x] > 0)) break;
        cx = r.x; cy = r.y;
        assert.ok(++steps <= d.stats.land, 'pętla w drzewie spływu');
      }
      checked++;
    }
  }
  assert.equal(checked, d.stats.land);
});

test('spływ: przepływ rośnie w dół rzeki, a odcinki drzewa się nie krzyżują', () => {
  const W = 256;
  const H = 128;
  const h = terrain(W, H, 11);
  const d = computeDrainage(h, null, W, H);
  const code = (x, y) => Math.round(d.data[(y * W + ((x + W) % W)) * 4] / DRAIN_CODE_STEP);
  let diag = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (h[i] > 0) {
        const r = drainReceiver(d, x, y);
        const ri = r.y * W + r.x;
        // przepływ odbiorcy (ląd) nie mniejszy niż własny (z dokładnością kodowania)
        if (h[ri] > 0) assert.ok(d.data[ri * 4 + 1] >= d.data[i * 4 + 1]);
        // kanał B = odległość od morza: ląd > 0, komórka z odbiorcą-morzem = 1 komórka, sąsiedzi różnią się o ≤ 1
        const b = d.data[i * 4 + 2];
        assert.ok(b >= DRAIN_SEA_K && b % DRAIN_SEA_K === 0, `odległość od morza ${b}`);
        if (!(h[ri] > 0)) assert.equal(b, DRAIN_SEA_K);
        const bx = d.data[(y * W + ((x + 1) % W)) * 4 + 2];
        if (h[y * W + ((x + 1) % W)] > 0) assert.ok(Math.abs(bx - b) <= DRAIN_SEA_K);
        else assert.equal(bx, 0);
      }
      // kwadrat 2 × 2 o rogu (x, y): przekątna „/” to (x, y) ↔ (x + 1, y + 1), „\” to (x + 1, y) ↔ (x, y + 1)
      const up = code(x, y) === 9 || code(x + 1, y + 1) === 1;        // (+1, +1) = kod 9, (−1, −1) = kod 1
      const dn = code(x + 1, y) === 7 || code(x, y + 1) === 3;        // (−1, +1) = kod 7, (+1, −1) = kod 3
      if (up || dn) diag++;
      assert.ok(!(up && dn), `skrzyżowane przekątne w kwadracie (${x}, ${y})`);
    }
  }
  assert.ok(diag > 50, 'teren próbny używa połączeń po przekątnej');
  assert.ok(DRAIN_JITTER < 0.25, 'przesunięcie węzłów ≥ 0,25 komórki pozwala skrzyżować odcinki');
});

test('spływ: opad waży przepływ, ujścia posortowane, kodowanie przepływu odwracalne', () => {
  const W = 256;
  const H = 128;
  const h = terrain(W, H, 3);
  const wet = computeDrainage(h, null, W, H);
  const rain = new Float32Array(W * H).fill(0.1);
  const dry = computeDrainage(h, rain, W, H);
  assert.ok(dry.stats.maxFlow < wet.stats.maxFlow * 0.11 && dry.stats.maxFlow > wet.stats.maxFlow * 0.09);
  const m = riverMouths(wet, 20);
  assert.ok(m.length > 3, `ujść ${m.length}`);
  for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].flow >= m[i].flow);
  for (const s of m) assert.ok(h[s.y * W + s.x] > 0 && s.u > 0 && s.u < 1 && s.v > 0 && s.v < 1);
  for (const f of [0, 1, 14, 300, 20000]) assert.ok(Math.abs(drainFlowDecode(drainFlowEncode(f)) - f) <= f * 0.04 + 0.03);
  // ten sam teren = ten sam wynik (bez losowości)
  const again = computeDrainage(h, null, W, H);
  assert.deepEqual(again.data, wet.data);
});

test('spływ: mapa bez lądu i mapa bez morza nie rzucają', () => {
  const W = 32;
  const H = 16;
  const sea = computeDrainage(new Float32Array(W * H).fill(-1), null, W, H);
  assert.equal(sea.stats.land, 0);
  const landH = new Float32Array(W * H);
  for (let i = 0; i < landH.length; i++) landH[i] = 0.5 + (i % 7) * 0.01 + Math.floor(i / W) * 0.02;
  const all = computeDrainage(landH, null, W, H);
  assert.equal(all.stats.land, W * H);
  assert.equal(all.stats.seeds, 1);
});

// ── Wpięcie w wypiek (WGSL w Node bez GPU) ────────────────────────────────────────────────────────────────────────
const THREE = await import('three/webgpu');
const { PlanetGenBaker } = await import('../src/3d/planetGen/planetGenBaker.js');
const { drainTexture } = await import('../src/3d/planetGen/planetGenBake.tsl.js');
const { RIVER_FLOW_MIN, RIVER_W0, RIVER_W_MAX } = await import('../src/3d/planetGen/planetGenSolid.tsl.js');
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;
function buildQuad(material) {
  const quad = new THREE.QuadMesh(material);
  const b = renderer.backend.createNodeBuilder(quad, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = quad.camera;
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}

test('spływ w wypieku: graf pola czyta teksturę spływu, przejście wejścia spływu tylko dla rodzajów z rzekami', () => {
  const baker = new PlanetGenBaker(renderer);
  for (const type of ['terran', 'ocean']) {
    assert.ok(baker.passesFor(type).some(([k, f]) => k === `drain:${type}` && f === 'float'), `${type}: przejście drain`);
    const g = baker.graph(`field:${type}`);
    assert.ok(g.drain && g.U.uDr, `${type}: węzeł tekstury spływu i uDr`);
    const wgsl = buildQuad(g.material);
    assert.match(wgsl, /textureLoad\(/);
    assert.doesNotMatch(wgsl, /\bNaN\b/);
    const dw = buildQuad(baker.graph(`drain:${type}`).material);
    assert.ok(dw.includes('fn main'));
  }
  assert.ok(!baker.passesFor('volcanic').some(([k]) => k.startsWith('drain:')));
  assert.ok(!baker.passesFor('desert').some(([k]) => k.startsWith('drain:')));
  // bez spływu gałąź rzek wyłączona, uniformy skończone (rozmiar 1 × 1 — bez dzielenia i modulo przez zero)
  assert.deepEqual(baker._bindDrain('terran', null), [1, 1, 0, 0]);
  assert.deepEqual(baker._bindDrain('volcanic', { texture: null, uniforms: [8, 4, 1, 3] }), [1, 1, 0, 0]);
  const tex = drainTexture(new Uint8Array(8 * 4 * 4), 8, 4);
  assert.equal(tex.minFilter, THREE.NearestFilter);
  assert.equal(tex.generateMipmaps, false);
  const u = baker._bindDrain('terran', { texture: tex, uniforms: [8, 4, 1, 3] });
  assert.deepEqual(u, [8, 4, 1, 3]);
  assert.equal(baker.graph('field:terran').drain.value, tex);
  // szerokości rzek: rosną z przepływem, w granicach pewnych odległości sąsiedztwa 5 × 5
  assert.ok(RIVER_FLOW_MIN > 1 && RIVER_W0 < RIVER_W_MAX && RIVER_W_MAX <= 0.25);
});

// ── Spójność między poziomami zbliżenia (strażniki źródeł — obraz sprawdza seria zrzutów jednego miejsca) ─────────
const { readFileSync } = await import('node:fs');
const src = (p) => readFileSync(new URL(`../src/3d/planetGen/${p}`, import.meta.url), 'utf8');

test('spójność zbliżeń: brzeg bez detalu na płaskim, skupiska drzew o średniej zero, łuk rzeki przy ujściu', () => {
  // brzeg morza: detal wysokości tylko na stromym brzegu (na płaskiej nizinie wybijał kałuże z pianą, inne na
  // każdym poziomie zbliżenia) — w obu materiałach powierzchni
  for (const f of ['planetGenSurface.tsl.js', 'planetGenSurfaceNear.tsl.js']) {
    const s = src(f);
    assert.match(s, /dH\.mul\(coastK\)/, `${f}: detal w progu morza bramkowany nachyleniem`);
    assert.doesNotMatch(s, /const hC = \w+(\.x)?\.add\(dH\)\.toVar\(\)/, `${f}: sam detal w progu morza`);
    assert.match(s, /skyFill/, `${f}: światło nieba na stokach w cieniu`);
  }
  const solid = src('planetGenSolid.tsl.js');
  // skupiska drzew przesuwają granicę lasu w obie strony: stała = średnia odległość komórek (0,516 ± 0,01)
  const cl = solid.match(/const clump = float\((0\.\d+)\)\.sub\(cA\.x\)[\s\S]*?float\((0\.\d+)\)\.sub\(cB\.x\)/);
  assert.ok(cl, 'człon skupisk drzew');
  for (const v of [Number(cl[1]), Number(cl[2])]) assert.ok(Math.abs(v - 0.516) < 0.01, `stała skupisk ${v}`);
  // ujście (B = C): zerowa styczna zastąpiona cięciwą — inaczej „odległość 0” w całym sąsiedztwie (prostokąt wody)
  assert.match(solid, /const chord = C\.sub\(A\)/);
  assert.match(solid, /mix\(chord, tan0, step\(/);
  // barwy lądu bez członów zależnych od skali teksela w progu lasu (krzywizna)
  assert.doesNotMatch(solid, /const Mv = [^;]*curv/);
});

test('smugi osadu: morze przy ujściu wielkiej rzeki ma smugę, daleko od ujść nie; siatka gęstsza — ten sam zasięg w km', async () => {
  const { PLUME_LF0, PLUME_CELLS } = await import('../src/3d/planetGen/planetGenDrainage.js');
  const W = 256;
  const H = 128;
  const h = terrain(W, H, 7);
  const d = computeDrainage(h, null, W, H);
  const land = (i) => d.data[i * 4] !== 0 || d.data[i * 4 + 1] !== 0;
  // (siatka próbna ma 256 komórek w obwodzie — próg przepływu smugi liczony jak dla siatki 2048 przesuwa się o 2·log2(256/2048))
  const lf0 = PLUME_LF0 + 2 * Math.log2(W / 2048);
  const mouths = riverMouths(d).filter((m) => Math.log2(1 + m.flow) >= lf0 + 1);
  assert.ok(mouths.length > 0, 'teren próbny ma ujścia dość dużych rzek');
  // smuga: w komórce morza, do której uchodzi rzeka, i w jej sąsiedztwie
  let withPlume = 0;
  for (const m of mouths) {
    const r = drainReceiver(d, m.x, m.y);
    assert.ok(r && !land(r.y * W + r.x), 'ujście spływa do morza');
    if (d.data[(r.y * W + r.x) * 4 + 3] > 60) withPlume++;
  }
  assert.equal(withPlume, mouths.length, 'każde duże ujście ma smugę w morzu');
  // wartości tylko w zasięgu smugi: większość morza jest czysta, smuga nie przekracza zasięgu
  let sea = 0;
  let seaPl = 0;
  for (let i = 0; i < W * H; i++) if (!land(i)) { sea++; if (d.data[i * 4 + 3] > 0) seaPl++; }
  assert.ok(seaPl > 0 && seaPl < sea * 0.5, `smugi zajmują ${(seaPl / sea * 100).toFixed(1)}% morza`);
  assert.ok(PLUME_CELLS > 2 && PLUME_CELLS < 30);
  // mapa lokalna (mapa terenu) — bez smug; wyłączenie jawne
  const loc = computeDrainage(h, null, W, H, { wrapX: false, rowWeight: false });
  let any = 0;
  for (let i = 0; i < W * H; i++) any += loc.data[i * 4 + 3];
  assert.equal(any, 0, 'mapa lokalna nie ma smug');
  const off = computeDrainage(h, null, W, H, { plumes: false });
  any = 0;
  for (let i = 0; i < W * H; i++) any += off.data[i * 4 + 3];
  assert.equal(any, 0);
  // powtarzalność
  assert.deepEqual(computeDrainage(h, null, W, H).data, d.data);
});

test('planeta z daleka: barwy krajobrazu z palet mapy terenu, woda słodka ciemna / mętna, smuga osadu i przybój', async () => {
  const fs = await import('node:fs');
  const { terrainLandscape, TERRAIN_WATER, TERRAIN_VEGETATION } = await import('../src/3d/planetGen/planetGenTerrainMap.js');
  for (const veg of TERRAIN_VEGETATION) {
    const L = terrainLandscape(veg);
    for (const k of ['forest', 'fen', 'fenWet', 'grass', 'meadow']) assert.ok(L[k].length === 3 && L[k].every((v) => v >= 0 && v <= 255), `${veg}.${k}`);
    assert.ok(L.fenAmount > 0 && L.fenAmount <= 1);
    // torfowisko jaśniejsze od lasu (mozaika jasnych pól w ciemnym lesie)
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(lum(L.fen) > lum(L.forest) * 1.5, `${veg}: torfowisko jaśniejsze od lasu`);
  }
  // woda leśna ciemna, muł jasny i ciepły
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(TERRAIN_WATER.dark) < 50 && lum(TERRAIN_WATER.mud) > 100 && TERRAIN_WATER.mud[0] > TERRAIN_WATER.mud[2]);
  const src = fs.readFileSync(new URL('../src/3d/planetGen/planetGenSolid.tsl.js', import.meta.url), 'utf8');
  // rzeki nie są już malowane barwą morza; barwy pól i wody idą z uniformów palety mapy terenu
  assert.ok(!/mix\(U\.uShallow, U\.uOcean, 0\.75\)/.test(src), 'woda słodka bez barwy morza');
  for (const u of ['uFenA', 'uFenB', 'uGrassA', 'uMeadowB', 'uWDark', 'uWMud', 'uWIce', 'uSilt', 'uSandB']) assert.ok(src.includes(`U.${u}`), u);
  // warstwa pól, której cel nie rozdziela, wchodzi średnią (jasność krainy ta sama na każdym poziomie zbliżenia)
  assert.match(src, /return mix\(fenMean, edge\(/);
  // smuga osadu: głębokość z widoczności dna, bez wynoszenia nad wodę; barwa tylko pod wodą
  assert.match(src, /const hSea = mix\(hSea0, max\(hSea0, hPlume\), smoothstep\(0\.0, 0\.25, plume\)\)/);
  assert.match(src, /const plume = max\(f\.y\.negate\(\), 0\.0\)\.mul\(float\(1\.0\)\.sub\(onLand\)\)\.mul\(float\(1\.0\)\.sub\(step\(0\.0, h\)\)\)/);
  // przybój z daleka nie robi obwódki wokół lądu i nie pieni całej płycizny smugi
  const near = fs.readFileSync(new URL('../src/3d/planetGen/planetGenSurfaceNear.tsl.js', import.meta.url), 'utf8');
  assert.match(near, /foam\.assign\(shal\.mul\(mix\(float\(0\.08\)/);
  assert.match(near, /smoothstep\(0\.004, 0\.03, length\(gMap\)\)/);
});
