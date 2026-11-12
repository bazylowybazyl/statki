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
  assert.match(src, /return vec2\(mix\(mean, edge\(v, 0\.003\), on\)/);
  // smuga osadu: głębokość z widoczności dna, bez wynoszenia nad wodę; barwa tylko pod wodą
  assert.match(src, /const hSea = mix\(hSea0, max\(hSea0, hPlume\), smoothstep\(0\.0, 0\.25, plume\)\)/);
  assert.match(src, /const plume = max\(f\.y\.negate\(\), 0\.0\)\.mul\(float\(1\.0\)\.sub\(onLand\)\)\.mul\(float\(1\.0\)\.sub\(step\(0\.0, h\)\)\)/);
  // przybój z daleka nie robi obwódki wokół lądu i nie pieni całej płycizny smugi
  const near = fs.readFileSync(new URL('../src/3d/planetGen/planetGenSurfaceNear.tsl.js', import.meta.url), 'utf8');
  assert.match(near, /foam\.assign\(shal\.mul\(mix\(float\(0\.08\)/);
  assert.match(near, /smoothstep\(0\.004, 0\.03, length\(gMap\)\)/);
});

test('głębokie zbliżenie: rzeka o ostrym brzegu i gładkich łączeniach, drobne pola, korony w rzeźbie', async () => {
  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL(`../src/3d/planetGen/${f}`, import.meta.url), 'utf8');
  const src = read('planetGenSolid.tsl.js');
  const { RIVER_MEANDER, EARTH_CANOPY_KM } = await import('../src/3d/planetGen/planetGenSolid.tsl.js');
  // sąsiedztwo 7 × 7 (łuk należy do dawcy, a leży wokół odbiorcy)
  assert.match(src, /Loop\(\{ start: int\(-3\), end: int\(4\), type: 'int', condition: '<', name: 'dj' \}/);
  // łączenia łuków: obwiednia sin² (wychylenie i jego pochodna znikają w węzłach), wychylenie ≤ 0,45 promienia łuku
  assert.match(src, /const env = envS\.mul\(envS\)\.toVar\(\)/);
  assert.match(src, /rMin\.mul\(0\.45\)/);
  assert.ok(RIVER_MEANDER <= 0.55, 'zakola łagodne (zbocze do ~57°), nie zęby piły');
  // odległość od koryta: poprawka stromości tylko przy korycie
  assert.match(src, /const dn = abs\(dc\)\.div\(sqrt\(dm\.mul\(dm\)\.mul\(nearK\)\.add\(1\.0\)\)\)/);
  // brzeg ostry z bliska, ta sama średnia szerokość (0,7 szerokości) na każdym poziomie
  assert.match(src, /inv\(wt\.mul\(0\.7\)\.sub\(soft\.mul\(0\.5\)\), wt\.mul\(0\.7\)\.add\(soft\.mul\(0\.5\)\), dist\)/);
  // szerokość i muł płynnie wzdłuż odcinka głównego dawcy; muł ważony pokryciem
  assert.match(src, /const lfT = mix\(lf, lfRc, tt\.mul\(step\(lfRc\.sub\(1\.0\), lf\)\)\.mul\(hasRR\)\)/);
  assert.match(src, /mud: clamp\(mud\.div\(max\(line, 1e-3\)\), 0\.0, 1\.0\)/);
  // drobne warstwy pól i wyspy drzew wchodzą średnią, gdy cel ich nie rozdziela
  assert.match(src, /fenLayer\(2200\.0,/);
  assert.match(src, /fenLayer\(8000\.0,/);
  assert.match(src, /return mix\(float\(0\.06\), step\(0\.72, c\.z\)/);
  // wysokość koron: alfa mapy dnia na lądzie → graf rzeźby (na morzu alfa to lód)
  assert.equal(EARTH_CANOPY_KM, 0.12);
  assert.match(src, /const alpha = mix\(seaIce, clamp\(canopyM\.div\(EARTH_CANOPY_KM \* 1000\), 0\.0, 1\.0\), step\(0\.0, h\)\)/);
  const bake = read('planetGenBake.tsl.js');
  assert.match(bake, /h0\.add\(day\.load\(ivec2\(x, y\)\)\.a\.mul\(U\.uRel\.w\)\.mul\(step\(0\.0, h0\)\)\)/);
  const baker = read('planetGenBaker.js');
  assert.match(baker, /_reliefU\(spec, dayTexture, canopy = true\)/);
  // planeta z plików: wysokość w pliku ma już korony — bez drugiego dodatku
  assert.match(baker, /uRel: this\._reliefU\(spec, out\.rt\.day\.texture, false\)/);
});

test('brzeg nie zmienia kształtu przy zbliżaniu: ogon szeregu szumu; roślinność planety z palet mapy terenu', async () => {
  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL(`../src/3d/planetGen/${f}`, import.meta.url), 'utf8');
  const { COAST_TAIL, COVER_TAIL } = await import('../src/3d/planetGen/planetGenSolid.tsl.js');
  // ogon: oktawy dokładane przez głębsze poziomy gasną szybciej niż rośnie ich częstość (gain · lakunarność < 1) —
  // dokładają szczegół, a nie otwierają i zamykają cieśnin widocznych poziom wyżej
  for (const t of [COAST_TAIL, COVER_TAIL]) {
    assert.ok(t.gain * 2.03 < 1, `gain ogona ${t.gain}`);
    assert.ok(t.from >= 3, 'pierwsze oktawy (kształt z daleka) bez zmian');
  }
  const noise = read('planetGenNoise.tsl.js');
  assert.match(noise, /export function pgFbm\(p0, octaves, lac = 2\.03, gain = 0\.5, full = false, tail = null\)/);
  assert.match(noise, /amp\.mulAssign\(tail \? mix\(float\(tail\.gain\), float\(gain\), step\(float\(i\)\.add\(1\.5\), float\(tail\.from\)\)\) : gain\)/);
  const solid = read('planetGenSolid.tsl.js');
  assert.match(solid, /octX, 2\.03, 0\.62, full, COAST_TAIL\)/);
  assert.equal((solid.match(/2\.03, 0\.6, true, COVER_TAIL\)/g) || []).length, 2, 'granice lasu i pól (nMo, nD)');
  // roślinność: jedno mapowanie planeta → palety mapy terenu dla barw planety i dla mapy miejsca
  const { PLANET_VEGETATION, TERRAIN_VEGETATION, terrainLandscape } = await import('../src/3d/planetGen/planetGenTerrainMap.js');
  const { describePlanet, PLANET_VEGETATION_SETS } = await import('../src/3d/planetGen/planetGenSpec.js');
  for (const set of PLANET_VEGETATION_SETS) {
    assert.ok(PLANET_VEGETATION[set], `zestaw ${set} ma palety mapy terenu`);
    for (const p of PLANET_VEGETATION[set]) assert.ok(TERRAIN_VEGETATION.includes(p));
  }
  for (const set of ['czerwona', 'purpurowa', 'zlota']) assert.ok(PLANET_VEGETATION_SETS.includes(set));
  // nadpisanie roślinności: barwy lasu z zestawu, reszta planety (kształt, morze) bez zmian
  const a = describePlanet({ type: 'terran', seed: 21 });
  const b = describePlanet({ type: 'terran', seed: 21, vegetation: 'czerwona' });
  assert.equal(b.look.vegetation, 'czerwona');
  assert.notDeepEqual(b.look.palette.forest, a.look.palette.forest);
  assert.ok(b.look.palette.forest[0] > b.look.palette.forest[1] * 2, 'czerwony las: czerwień ponad zielenią');
  assert.deepEqual(b.look.palette.ocean, a.look.palette.ocean);
  assert.equal(b.look.water, a.look.water);
  assert.deepEqual(b.seedOffset, a.seedOffset);
  // zestaw nieznany — bez zmian
  assert.equal(describePlanet({ type: 'terran', seed: 21, vegetation: 'nie-ma' }).look.vegetation, a.look.vegetation);
  // kępy drugiego gatunku: tajga bez, pozostałe palety mają barwę odstającą od lasu
  assert.equal(terrainLandscape('tajga').accent, null);
  for (const p of ['tropik', 'czerwona', 'purpura', 'zlota']) assert.equal(terrainLandscape(p).accent.length, 3);
  assert.match(solid, /mix\(forestC, accentC, accent\.mul\(0\.8\)\)\.mul\(canopy\)/);
});

test('pustynia: wydmy są rzeźbą (wysokość w polu), wspólna funkcja dla pola i barw, suche koryta', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/3d/planetGen/planetGenSolid.tsl.js', import.meta.url), 'utf8');
  const { DUNES } = await import('../src/3d/planetGen/planetGenSolid.tsl.js');
  // rozmiary jak w naturze: megawydmy co 2–3,5 km o wysokości rzędu 100 m, drobne co kilkaset metrów
  assert.equal(DUNES.megaKm.length, 3);
  for (const km of DUNES.megaKm) assert.ok(km >= 1.5 && km <= 4);
  assert.ok(DUNES.heightKm >= 0.05 && DUNES.heightKm <= 0.2 && DUNES.smallKm < 1 && DUNES.smallHeightKm < DUNES.heightKm / 4);
  // wysokość wydm dodana do terenu w polu (światło i cień liczy materiał), nie paski barwy
  assert.match(src, /hLand\.addAssign\(DN\.h\.mul\(DUNES\.heightKm\)\.add\(DN\.small\.mul\(DUNES\.smallHeightKm\)\)\.mul\(erg\)\)/);
  assert.ok(!/const mega = sin\(duneP/.test(src), 'bez dawnych pasków barwy');
  // ta sama funkcja i te same maski w polu i w barwach
  assert.equal((src.match(/const DN = duneField\(U, C, ps\)/g) || []).length, 2);
  assert.ok((src.match(/ergMask\(ps\)/g) || []).length >= 2);
  assert.ok((src.match(/hamadaMask\(ps, /g) || []).length >= 2);
  // wydmy tylko w pełnym polu (wejście spływu i próba bez wydm), nie gaszone powoli rosnącą wagą lądu
  assert.match(src, /If\(U\.uDr\.z\.greaterThan\(0\.5\)\.and\(desertK\.greaterThan\(0\.01\)\)/);
  assert.match(src, /const shoreK = smoothstep\(0\.0, 0\.03, d\)\.toVar\(\)/);
  // klimat w polu ten sam co w barwach; cieki regionu w pustyni suche
  assert.match(src, /const KF = earthClimate\(U, C, hLand, d\)/);
  assert.match(src, /uK: \[L\.temp, L\.wet, L\.axisTilt, 0\]/);
  assert.match(src, /\.mul\(float\(1\.0\)\.sub\(desertK\)\)\)\);/);
  // profil wydmy niesymetryczny (łagodny stok dowietrzny, stromy zawietrzny)
  assert.match(src, /pow\(min\(t\.div\(0\.72\), float\(1\.0\)\.sub\(t\)\.div\(0\.28\)\), 1\.35\)/);
});
