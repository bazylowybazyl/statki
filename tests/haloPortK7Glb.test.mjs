// Hala K-7 z Blendera (pilot 2026-10-13, docs/PILOT-blender-k7.md): loader src/3d/haloRing/haloPortK7Glb.js,
// pliki assets/k7/k7_hala(.glb|_lod1.glb) ze skryptu scripts/blender/k7/k7_hala.py, wpięcie w hali
// (haloPortK7.js: sekcje pomijane, geometria scalona na zestaw i LOD, graf K-7 `glb`). GLB parsowany w Node.
// node --test tests/haloPortK7Glb.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import {
  K7_GLB_ELEMENTS, K7_GLB_TAGS, K7_GLB_TRI_BUDGET, K7_GLB_TUNE, buildK7GlbBuffers, k7GlbEnabled, k7GlbUrl, parseK7Glb,
  registerK7Glb, resetK7Glb
} from '../src/3d/haloRing/haloPortK7Glb.js';
import { K7_MAT, K7_TAGS, buildK7Scene } from '../src/3d/haloRing/haloPortK7Build.js';
import { K7_ABOVE_SCALE, K7_FUEL_STATION, K7_HEIGHTS, createK7Layout, k7Frame, k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { HaloPortK7, k7Graphs } from '../src/3d/haloRing/haloPortK7.js';

const abOf = (url) => {
  const buf = readFileSync(fileURLToPath(url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const lod0 = await parseK7Glb(abOf(k7GlbUrl(0)), 'k7_hala.glb');
const lod1 = await parseK7Glb(abOf(k7GlbUrl(1)), 'k7_hala_lod1.glb');
const DATA = JSON.parse(readFileSync(new URL('../scripts/blender/k7/k7-dane.json', import.meta.url), 'utf8'));
const ring = createHaloRingLayout({});
const fr = k7Frame(ring);
const sceneOf = (extra = {}) => buildK7Scene(createK7Layout(), { floorZ: fr.floorZ, rimZ: fr.rimZ, floorR: fr.floorR, ...extra });
const CODES = new Set(Object.values(K7_MAT));
const SETS = {
  'fuel-base-W': ['bg', 'fg'], 'fuel-base-E': ['bg', 'fg'], 'fuel-link1': ['fg'], 'fuel-link2': ['fg'], 'fuel-rod': ['fg'],
  'fuel-coupler': ['fg'], 'clamp-pad': ['bg'], 'fuel-tank': ['bg'], 'fuel-pump': ['bg'], 'fuel-headers': ['bg'],
  'fuel-rack-W': ['bg'], 'fuel-rack-E': ['bg'], 'fuel-vent': ['bg'], 'wall-pipes': ['fg'], spot: ['fg'], 'gate-jamb': ['bg'],
  'gate-lintel-main': ['fg'], 'gate-lintel-side': ['fg']
};

// obwiednia części elementu (układ lokalny huba: x, wysokość K-7, z)
function boundsOf(part) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const P = part.pos;
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return { lo, hi };
}
function boundsOfElement(el) {
  const b = Object.values(el.sets).map(boundsOf);
  return { lo: [0, 1, 2].map((k) => Math.min(...b.map((q) => q.lo[k]))), hi: [0, 1, 2].map((k) => Math.max(...b.map((q) => q.hi[k]))) };
}
// obwiednia starych brył elementu (bryły referencyjne z k7-dane.json: macierz jednostkowej bryły w układzie elementu)
function boundsOfPrims(prims) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const m = p.m;
    const e = p.kind === 'box' ? 0.5 : 1;
    const ys = p.kind === 'torus' ? [-0.13, 0.13] : [-0.5, 0.5];
    for (const a of [-e, e]) for (const b of (p.kind === 'torus' ? [-1, 1] : ys)) for (const c of (p.kind === 'torus' ? ys : [-e, e])) {
      const v = [m[0] * a + m[1] * b + m[2] * c + m[3], m[4] * a + m[5] * b + m[6] * c + m[7], m[8] * a + m[9] * b + m[10] * c + m[11]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    }
  }
  return { lo, hi };
}

test('przełącznik: domyślnie hala z Blendera; ?k7=stara i window.__K7_GLB', () => {
  assert.equal(k7GlbEnabled(), false, 'Node bez przełącznika — stara (pliku nie ma skąd pobrać)');
  globalThis.window = globalThis;
  assert.equal(k7GlbEnabled(), true, 'przeglądarka bez przełącznika — hala z Blendera');
  globalThis.location = { search: '?dev=1&k7=blender' };
  assert.equal(k7GlbEnabled(), true);
  globalThis.location = { search: '?dev=1&k7=stara' };
  assert.equal(k7GlbEnabled(), false, '?k7=stara — stara hala');
  globalThis.__K7_GLB = true;
  assert.equal(k7GlbEnabled(), true, 'window.__K7_GLB bierze górę');
  delete globalThis.__K7_GLB;
  globalThis.location = { search: '?k7=0' };
  assert.equal(k7GlbEnabled(), false);
  delete globalThis.location;
  delete globalThis.window;
  const rel = (u) => fileURLToPath(u).replaceAll('\\', '/').replace(/^.*\/assets\//, 'assets/');
  assert.equal(rel(k7GlbUrl(0)), 'assets/k7/k7_hala.glb', 'plik poza public/ (tests/devPublicShadow.test.mjs)');
  assert.equal(rel(k7GlbUrl(1)), 'assets/k7/k7_hala_lod1.glb');
});

test('format pliku: wszystkie elementy z zestawami bg / fg, materiały K-7, tryb wysokości, AO, normalne jednostkowe', () => {
  for (const [name, P] of [['LOD0', lod0], ['LOD1', lod1]]) {
    assert.deepEqual(P.unknownMaterials, [], `${name}: materiały tylko z K7_MAT`);
    assert.deepEqual(Object.keys(P.elements).sort(), [...K7_GLB_ELEMENTS].sort(), `${name}: elementy`);
    for (const [el, sets] of Object.entries(SETS)) {
      assert.deepEqual(Object.keys(P.elements[el].sets).sort(), [...sets].sort(), `${name} ${el}: zestawy`);
      assert.equal(P.elements[el].mode, el === 'fuel-rod' || el === 'fuel-coupler' ? 'lin' : 'abs', `${name} ${el}: tryb wysokości`);
      for (const part of Object.values(P.elements[el].sets)) {
        assert.equal(part.pos.length, part.nor.length);
        assert.equal(part.mat.length * 3, part.pos.length);
        assert.equal(part.index.length % 3, 0);
        for (const m of part.mat) assert.ok(CODES.has(m), `${name} ${el}: kod materiału ${m}`);
        let aoLo = 1;
        let aoSum = 0;
        for (let i = 0; i < part.ao.length; i++) { aoLo = Math.min(aoLo, part.ao[i]); aoSum += part.ao[i]; }
        assert.ok(aoLo >= 0 && aoSum / part.ao.length > 0.2 && aoSum / part.ao.length < 0.98, `${name} ${el}: AO wypieczone (śr. ${(aoSum / part.ao.length).toFixed(2)})`);
        for (let i = 0; i < part.nor.length; i += 97) {
          const l = Math.hypot(part.nor[i - (i % 3)], part.nor[i - (i % 3) + 1], part.nor[i - (i % 3) + 2]);
          assert.ok(Math.abs(l - 1) < 1e-3, `${name} ${el}: normalna jednostkowa`);
        }
      }
    }
    // status: listwy zamków i pierścień złączki świecą emisją grupy
    assert.ok([...P.elements['clamp-pad'].sets.bg.mat].includes(K7_MAT.status), `${name}: listwa stanu zamków`);
    assert.ok([...P.elements['fuel-coupler'].sets.fg.mat].includes(K7_MAT.status), `${name}: pierścień stanu złączki`);
  }
  assert.equal(lod0.lod, 0);
  assert.equal(lod1.lod, 1);
});

test('wymiary z gry: hasz k7-dane.json = bieżący eksport z haloPortK7Layout / haloPortK7Build = hasz w obu GLB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'k7-dane-'));
  const out = join(dir, 'k7-dane.json');
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/blender/k7/k7-dane.mjs', import.meta.url)), '--out', out], { stdio: 'ignore' });
  const fresh = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(fresh.hash, DATA.hash, 'k7-dane.json nieaktualne: node scripts/blender/k7/k7-dane.mjs, potem wypiek modeli (k7_hala.py)');
  assert.equal(lod0.hash, DATA.hash, 'k7_hala.glb z innych wymiarów — ponowny wypiek: scripts/blender/k7/k7_hala.py');
  assert.equal(lod1.hash, DATA.hash, 'k7_hala_lod1.glb z innych wymiarów — ponowny wypiek (--lod 1)');
});

test('budżet trójkątów hali (wszystkie miejsca elementów): LOD0 / LOD1', () => {
  const s = sceneOf();
  const b0 = buildK7GlbBuffers(lod0, s.places);
  const b1 = buildK7GlbBuffers(lod1, s.places);
  const t0 = b0.bg.tris + b0.fg.tris;
  const t1 = b1.bg.tris + b1.fg.tris;
  assert.ok(t0 <= K7_GLB_TRI_BUDGET.lod0, `LOD0 ${t0} trójkątów na halę (budżet ${K7_GLB_TRI_BUDGET.lod0})`);
  assert.ok(t1 <= K7_GLB_TRI_BUDGET.lod1, `LOD1 ${t1} trójkątów na halę (budżet ${K7_GLB_TRI_BUDGET.lod1})`);
  assert.ok(t1 < t0 * 0.35, `LOD1 (${t1}) wyraźnie lżejszy od LOD0 (${t0})`);
  // indeksy w zakresie, unorm8: kod materiału i grupa całkowite
  for (const b of [b0.bg, b0.fg, b1.bg, b1.fg]) {
    let max = 0;
    for (const i of b.index) max = Math.max(max, i);
    assert.ok(max < b.verts);
    assert.equal(b.k7.constructor, Uint8Array);
  }
});

test('części na miejscach z układu: obwiednia modelu ≈ obwiednia starych brył elementu (te same kotwice, kurs, wysokości)', () => {
  for (const el of K7_GLB_ELEMENTS) {
    const ref = DATA.elements[el];
    assert.ok(ref, `${el}: bryły referencyjne w k7-dane.json`);
    const A = boundsOfElement(lod0.elements[el]);
    const R = boundsOfPrims(ref.prims);
    for (let k = 0; k < 3; k++) {
      const size = Math.max(1, R.hi[k] - R.lo[k]);
      const tol = Math.max(14, size * 0.28);
      const cA = (A.lo[k] + A.hi[k]) / 2;
      const cR = (R.lo[k] + R.hi[k]) / 2;
      assert.ok(Math.abs(cA - cR) < tol, `${el}: środek osi ${'xyz'[k]} ${cA.toFixed(0)} ≠ ${cR.toFixed(0)} (stare bryły)`);
      const sA = A.hi[k] - A.lo[k];
      assert.ok(sA < size * 1.45 + 30 && sA > size * 0.6 - 10, `${el}: rozmiar osi ${'xyz'[k]} ${sA.toFixed(0)} vs ${size.toFixed(0)}`);
    }
  }
  // słupek W: bęben i prowadnica od strony stanowiska (+x), E — lustrzany (−x)
  const reelX = (el) => { const b = boundsOf(lod0.elements[el].sets.fg); return (b.lo[0] + b.hi[0]) / 2; };
  assert.ok(reelX('fuel-base-W') > 15 && reelX('fuel-base-E') < -15, 'bęben ku stanowisku (W: +x, E: −x)');
});

test('oś obrotu członów = obrotnica / łokieć: piasta w (0, 0), człon wzdłuż +x do długości z K7_FUEL_STATION', () => {
  const F = K7_FUEL_STATION;
  const hubCentre = (part, y0, y1) => {
    let sx = 0, sz = 0, n = 0, r = 0;
    for (let i = 0; i < part.pos.length; i += 3) {
      const y = part.pos[i + 1];
      if (y < y0 || y > y1 || part.pos[i] > 60) continue;
      sx += part.pos[i]; sz += part.pos[i + 2]; n++;
      r = Math.max(r, Math.hypot(part.pos[i], part.pos[i + 2]));
    }
    return { x: sx / n, z: sz / n, r };
  };
  const l1 = lod0.elements['fuel-link1'].sets.fg;
  const c1 = hubCentre(l1, 307, 316);   // piasta barku pod członem
  assert.ok(Math.hypot(c1.x, c1.z) < 3, `piasta barku w osi obrotnicy (${c1.x.toFixed(1)}, ${c1.z.toFixed(1)})`);
  assert.ok(Math.abs(c1.r - (F.shoulder.r - 6)) < 4, `promień piasty barku ${c1.r.toFixed(1)}`);
  const b1 = boundsOf(l1);
  assert.ok(Math.abs(b1.hi[0] - (F.link1.len + (F.link1.w - 6) / 2)) < 3, `człon 1 kończy się na łokciu (x = ${b1.hi[0].toFixed(0)})`);
  const l2 = lod0.elements['fuel-link2'].sets.fg;
  const c2 = hubCentre(l2, F.elbow.y0 - 0.5, F.elbow.y0 + 1.5);   // spód obudowy łokcia (pod członem)
  assert.ok(Math.hypot(c2.x, c2.z) < 3, `łokieć w osi (${c2.x.toFixed(1)}, ${c2.z.toFixed(1)})`);
  const b2 = boundsOf(l2);
  assert.ok(Math.abs(b2.hi[0] - (F.link2.len + 19.5)) < 4, `człon 2 kończy się tuleją wysięgnika (x = ${b2.hi[0].toFixed(0)})`);
  // obrotnica słupka (część stała): oś w (0, 0) — ta sama, wokół której obraca się grupa członu 1
  const base = lod0.elements['fuel-base-W'].sets.fg;
  const ct = hubCentre(base, F.column.top, F.column.top + 6);
  assert.ok(Math.hypot(ct.x, ct.z) < 4, `obrotnica w osi słupka (${ct.x.toFixed(1)}, ${ct.z.toFixed(1)})`);
  // wysięgnik i złączka: oś pionowa przez początek grupy
  for (const el of ['fuel-rod', 'fuel-coupler']) {
    const b = boundsOfElement(lod0.elements[el]);
    assert.ok(Math.abs((b.lo[0] + b.hi[0]) / 2) < 2 && Math.abs((b.lo[2] + b.hi[2]) / 2) < 2, `${el}: oś przez początek grupy`);
  }
});

test('sekcje z modelu: skipTags zdejmuje ich bryły, miejsca, grupy i lampki stanowisk bez zmian; nad otworami bram tylko FG', () => {
  const stats0 = {};
  const stats1 = {};
  const a = sceneOf({ stats: stats0 });
  const b = sceneOf({ stats: stats1, skipTags: K7_GLB_TAGS });
  for (const t of K7_GLB_TAGS) assert.ok(K7_TAGS.includes(t), `${t}: sekcja z K7_TAGS`);
  for (const key of Object.keys(stats1)) assert.ok(!K7_GLB_TAGS.includes(key.split('|')[0]), `${key}: bryły sekcji z modelu nagrane`);
  for (const key of Object.keys(stats0)) if (!K7_GLB_TAGS.includes(key.split('|')[0])) assert.equal(stats1[key], stats0[key], `${key}: bryły pozostałych sekcji bez zmian`);
  assert.deepEqual(b.places.map((p) => [p.element, p.x, p.z, p.yaw, p.group]), a.places.map((p) => [p.element, p.x, p.z, p.yaw, p.group]));
  assert.deepEqual(b.groups, a.groups);
  assert.equal(b.lamps.length, a.lamps.length);
  assert.equal(b.beaconSlots.length, a.beaconSlots.length);
  // każdy element ma miejsca i każde miejsce ma element w pliku
  const elems = new Set(b.places.map((p) => p.element));
  assert.deepEqual([...elems].sort(), [...K7_GLB_ELEMENTS].sort());
  // nad płaszczyzną lotu nad korytarzem przelotu bram: modelowe bg — nic (jak strażnik brył w haloPortK7.test.mjs)
  const l = createK7Layout();
  const buf = buildK7GlbBuffers(lod0, b.places);
  const P = buf.bg.position;
  for (const g of l.gates) {
    let hits = 0;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i + 1] <= 0) continue;
      const x = P[i], z = P[i + 2];
      if (Math.abs((x - g.x) * g.ux + (z - g.z) * g.uz) < g.clearWidth / 2 - 60 && Math.abs((x - g.x) * g.nx + (z - g.z) * g.nz) < 150) hits++;
    }
    assert.equal(hits, 0, `${g.id}: wierzchołki bg nad płaszczyzną lotu nad otworem`);
  }
});

test('odwzorowanie wysokości jak bryły starej hali; nic nad kamerą gry przy zoomie 3,2', () => {
  const s = sceneOf();
  const buf = buildK7GlbBuffers(lod0, s.places);
  let top = -Infinity;
  for (const set of ['bg', 'fg']) {
    const P = buf[set].position;
    const K = buf[set].k7;
    for (let i = 0, v = 0; i < P.length; i += 3, v++) {
      // grupy ruchome w trybie 'lin' (wysięgnik, złączka) leżą w początku — ich wysokość w scenie daje macierz grupy
      if (K[v * 4 + 2] && P[i + 1] < 120 && Math.abs(P[i]) < 60 && Math.abs(P[i + 2]) < 60) continue;
      top = Math.max(top, P[i + 1]);
    }
  }
  const F = K7_FUEL_STATION;
  top = Math.max(top, k7HeightToZ(F.couplerUp + F.wrist) + 160 * K7_ABOVE_SCALE);
  assert.ok(top < 435, `najwyższy punkt hali z Blendera z = ${top.toFixed(0)}`);
  // kotwica pokładu: zbiornik stoi na pokładzie (z = k7HeightToZ(0)), pochodna nad płaszczyzną lotu ×0,42
  const tank = s.places.find((p) => p.element === 'fuel-tank');
  const one = buildK7GlbBuffers(lod0, [tank]);
  let lo = Infinity;
  for (let i = 1; i < one.bg.position.length; i += 3) lo = Math.min(lo, one.bg.position[i]);
  assert.ok(Math.abs(lo - k7HeightToZ(0)) < 1, `spód zbiornika na pokładzie (${lo.toFixed(1)})`);
  assert.equal(k7HeightToZ(K7_HEIGHTS.hullTop + 100) - k7HeightToZ(K7_HEIGHTS.hullTop), 100 * K7_ABOVE_SCALE);
});

test('hala w grze: siatki LOD0 / LOD1 na grafie K-7 `glb`, wspólna geometria hal, LOD z rozmiaru piksela, WGSL bez błędów', () => {
  registerK7Glb(lod0, lod1);
  globalThis.__K7_GLB = true;
  try {
    const uniforms = createHaloUniforms(ring);
    const mk = (i) => new HaloPortK7({ ringLayout: ring, uniforms, layout: createK7Layout(), angle: i * Math.PI / 2, index: i, bays: [], style: ring.planetProfile.port });
    const h0 = mk(0);
    const h1 = mk(1);
    assert.ok(h0.glb && h1.glb, 'hale z modelem');
    const G = k7Graphs(uniforms);
    const meshes = {};
    h0.root.traverse((o) => { if (o.isMesh) meshes[o.name] = o; });
    for (const n of ['K7_glb0_bg', 'K7_glb0_fg', 'K7_glb1_bg', 'K7_glb1_fg']) {
      assert.ok(meshes[n], n);
      assert.equal(meshes[n].material.vertexNode, G.glb.vertexNode, `${n}: wspólny graf K-7`);
      assert.ok(!meshes[n].geometry.isInstancedBufferGeometry && !meshes[n].isInstancedMesh, `${n}: geometria scalona (bez InstancedMesh)`);
    }
    assert.ok(h0.meshes.bg.includes(meshes.K7_glb0_bg) && h0.meshes.fg.includes(meshes.K7_glb0_fg), 'zestawy bg / fg — warstwy hali');
    // wspólna geometria dla hal o tym samym układzie
    const g1 = {};
    h1.root.traverse((o) => { if (o.isMesh) g1[o.name] = o; });
    assert.equal(g1.K7_glb0_bg.geometry, meshes.K7_glb0_bg.geometry, 'geometria wspólna dla hal');
    // stare bryły sekcji z modelu zniknęły (mniej instancji niż w starej hali)
    globalThis.__K7_GLB = false;
    const old = mk(2);
    globalThis.__K7_GLB = true;
    const inst = (h) => Object.values(h.instances).reduce((s, v) => s + v.geo.instanceCount, 0);
    assert.ok(inst(old) - inst(h0) > 1000, `instancje: z modelem ${inst(h0)}, stara ${inst(old)}`);
    old.dispose();
    // LOD z rozmiaru piksela: kamera nad halą blisko → LOD0, daleko → LOD1; histereza
    const camAt = (h, dist) => {
      const f = h.frame;
      return new THREE.Vector3(f.origin.x + 2500 * f.rx, f.origin.y + 2500 * f.ry, 300 + dist);
    };
    const pixelAngle = 2 / (1712 * 2 / 1080 * 1080);   // ≈ kamera gry 1080p, fov 35°
    h0.updateGlbLod(camAt(h0, 1500), pixelAngle);
    assert.equal(h0.glb.lod, 0, 'blisko — LOD0');
    assert.ok(meshes.K7_glb0_bg.visible && !meshes.K7_glb1_bg.visible);
    h0.updateGlbLod(camAt(h0, 9000), pixelAngle);
    assert.equal(h0.glb.lod, 1, 'daleko — LOD1');
    assert.ok(!meshes.K7_glb0_bg.visible && meshes.K7_glb1_bg.visible);
    const dCut = 1 / (pixelAngle * K7_GLB_TUNE.lod0Ppu);
    h0.updateGlbLod(camAt(h0, dCut * 0.98), pixelAngle);
    assert.equal(h0.glb.lod, 1, 'histereza: tuż przy progu zostaje LOD1');
    K7_GLB_TUNE.forceLod = 0;
    h0.updateGlbLod(camAt(h0, 50000), pixelAngle);
    assert.equal(h0.glb.lod, 0, 'wymuszony LOD (A/B)');
    K7_GLB_TUNE.forceLod = -1;
    assert.equal(h0.drawCalls, h0.meshes.bg.length + h0.meshes.fg.length - 2, 'draw calle: jeden poziom widoczny');
    // WGSL grafu `glb` w Node (bez GPU): buduje się, wierzchołek czyta aK7 i macierze grup, AO w fragmencie
    const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
    const renderer = new THREE.WebGPURenderer({ canvas });
    renderer.hasFeature = () => false;
    const mesh = meshes.K7_glb0_fg;
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    assert.match(b.vertexShader, /aK7/, 'atrybut aK7 w wierzchołkach');
    assert.match(b.vertexShader, /k7Groups/, 'macierze grup ruchomych');
    assert.ok(b.fragmentShader.length > 1000);
    const vb = new Set(Object.values(mesh.geometry.attributes).map((a) => (a.isInterleavedBufferAttribute ? a.data : a)));
    assert.ok(vb.size <= 8, `${vb.size} buforów wierzchołków`);
    // zwalnianie: geometria wspólna żyje, dopóki używa jej druga hala
    h0.dispose();
    assert.ok(g1.K7_glb0_bg.geometry.attributes.position.array.length > 0);
    h1.dispose();
  } finally {
    delete globalThis.__K7_GLB;
    resetK7Glb();
  }
});
