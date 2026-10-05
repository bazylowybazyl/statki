// Pył kosmiczny (2026-10-05, „nie czuć, że statek leci, zwłaszcza przy przybliżeniu”): drobiny w warstwach
// paralaksy, smugi z ruchu kamery, oktawy zoomu (stała gęstość na ekranie), światło efektów z siatki, poświata
// dysz MAIN (stożki z EngineFrame), pył 3D w kamerach K (sześcian wokół kamery).
// Logika: src/3d/dust/spaceDust.js (lustra CPU shadera — dustMotePx, dust3DMoteRel, dustPlumeLightCpu), obraz:
// src/3d/dust/spaceDust3D.js (WGSL budowany w Node bez GPU). W grze: node scripts/webgpu/pyl-gra.mjs.
// node --test tests/spaceDust.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SPACE_DUST_TUNE, DUST_HEADER_VEC4, DUST_SLOT_VEC4, DUST_INSTANCE_STRIDE, DUST_MAX_LAYERS, DUST_PLUME_CAP,
  DUST3D_HEADER_VEC4, DUST3D_SLOT_VEC4, DustViewTracker,
  buildDust3DInstances, buildDustInstances, dust3DMoteRel, dust3DPlumeBase, dust3DUniformCount, dustOctaves,
  dustPlumeBase, dustPlumeLightCpu, dustUniformCount, dustVisibility, dustMotePx, writeDust3DUniforms,
  writeDustPlumes, writeDustUniforms
} from '../src/3d/dust/spaceDust.js';
import { EngineFrame } from '../src/3d/engineFrame.js';

const tune = SPACE_DUST_TUNE;
const VIEW = (o = {}) => ({ camX: 6013169.37, camY: -4734110.81, zoomPx: 0.45, halfW: 800, halfH: 450, velX: 0, velY: 0, gridX: 0, gridY: 0, time: 1, vis: 1, ...o });
const U = (o) => writeDustUniforms(tune, VIEW(o), new Float32Array(dustUniformCount() * 4));
const ortho = buildDustInstances(tune, 'ortho');
const fg = buildDustInstances(tune, 'fg');
const slotOf = (i, inst = ortho) => inst.data[i * DUST_INSTANCE_STRIDE + 3];
const layerOfSlot = (s) => Math.floor(s / 2);

test('instancje: dwa sloty (parzystość oktawy) na warstwę, podział na passy, dane w zakresach', () => {
  const want = (pass) => tune.layers.reduce((n, L, i) => n + ((L.pass || 'ortho') === pass && i < DUST_MAX_LAYERS ? 2 * L.count : 0), 0);
  assert.equal(ortho.count, want('ortho'));
  assert.equal(fg.count, want('fg'));
  for (const inst of [ortho, fg]) {
    for (let i = 0; i < inst.count; i++) {
      const a = i * DUST_INSTANCE_STRIDE;
      const d = inst.data;
      assert.ok(d[a] >= 0 && d[a] < 1 && d[a + 1] >= 0 && d[a + 1] < 1, 'baza w [0, 1)');
      assert.ok(d[a + 2] >= 0 && d[a + 2] < 1, 'ranga');
      const L = tune.layers[layerOfSlot(d[a + 3])];
      assert.equal(L.pass || 'ortho', inst === ortho ? 'ortho' : 'fg');
      assert.ok(d[a + 4] >= L.size[0] - 1e-6 && d[a + 4] <= L.size[1] + 1e-6, 'promień');
      assert.ok(d[a + 5] >= L.bright[0] - 1e-6 && d[a + 5] <= L.bright[1] + 1e-6, 'jasność');
    }
  }
  // deterministycznie (własny strumień FxRandom ze stałym ziarnem)
  assert.deepEqual(buildDustInstances(tune, 'ortho').data, ortho.data);
});

test('oktawy: kontener na ekranie w (D/2, 2D], wagi dwóch oktaw sumują się do 1', () => {
  for (const L of tune.layers) {
    for (let z = 0.03; z < 4; z *= 1.07) {
      const o = dustOctaves(tune, L.p, z, 1600);
      assert.ok(o.t >= 0 && o.t < 1);
      const D = tune.octavePx * 1600;
      const c0 = tune.C0 * 2 ** o.k0 * z * L.p;
      assert.ok(c0 > D / 2 - 1e-6 && c0 <= D + 1e-6, `k0 na ekranie ${c0} przy D ${D}`);
    }
  }
});

test('zoom bez przeskoków: waga i położenie drobiny w slocie zmieniają się ciągle (zmiana oktawy przy wadze 0)', () => {
  let prev = null;
  const pos = { x: 0, y: 0, fade: 0 };
  for (let z = 0.06; z < 3.2; z *= 1.0015) {
    const u = U({ zoomPx: z });
    const cur = [];
    for (let i = 0; i < ortho.count; i += 37) {
      dustMotePx(u, ortho.data, i, tune, pos);
      cur.push({ x: pos.x, y: pos.y, fade: pos.fade });
    }
    if (prev) {
      for (let j = 0; j < cur.length; j++) {
        const a = prev[j];
        const b = cur[j];
        // przy zmianie oktawy slotu (k → k ± 2) drobina jest niewidoczna z obu stron
        if (a.fade > 1e-6 && b.fade > 1e-6) {
          assert.ok(Math.abs(b.fade - a.fade) < 0.05, `waga skacze ${a.fade} → ${b.fade} przy zoomie ${z}`);
          // zoom × 1,0015 rozsuwa wzór o 0,15% — bez zawinięcia kontenera w kadrze
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          assert.ok(d < 0.004 * Math.hypot(a.x, a.y) + 0.01, `drobina skacze o ${d.toFixed(2)} px przy zoomie ${z.toFixed(4)}`);
        }
      }
    }
    prev = cur;
  }
});

test('świat: drobina warstwy p przesuwa się o −p · ruch kamery · zoom (kotwica w świecie, double na CPU)', () => {
  const pos0 = { x: 0, y: 0, fade: 0 };
  const pos1 = { x: 0, y: 0, fade: 0 };
  const zoom = 0.45;
  const dx = 37.25;
  const dy = -12.5;
  const u0 = U({ zoomPx: zoom });
  const u1 = U({ zoomPx: zoom, camX: VIEW().camX + dx, camY: VIEW().camY + dy });
  let checked = 0;
  for (let i = 0; i < ortho.count; i++) {
    dustMotePx(u0, ortho.data, i, tune, pos0);
    dustMotePx(u1, ortho.data, i, tune, pos1);
    const s = slotOf(i);
    const cpx = u0[(DUST_HEADER_VEC4 + s * DUST_SLOT_VEC4) * 4 + 2];
    // pomijamy drobiny, które przeszły przez brzeg kontenera (zawinięcie)
    if (Math.abs(pos1.x - pos0.x) > cpx / 2 || Math.abs(pos1.y - pos0.y) > cpx / 2) continue;
    const p = tune.layers[layerOfSlot(s)].p;
    assert.ok(Math.abs(pos1.x - pos0.x + dx * p * zoom) < 2e-3, `x: ${pos1.x - pos0.x} vs ${-dx * p * zoom}`);
    assert.ok(Math.abs(pos1.y - pos0.y + dy * p * zoom) < 2e-3);
    checked++;
  }
  assert.ok(checked > ortho.count * 0.9);
});

test('gęstość na ekranie prawie stała w całym zakresie zoomu (oktawy), wzór nie powtarza się w kadrze', () => {
  const pos = { x: 0, y: 0, fade: 0 };
  const counts = [];
  for (let z = 0.09; z < 3.2; z *= 1.11) {
    const u = U({ zoomPx: z });
    let n = 0;
    for (let i = 0; i < ortho.count; i++) {
      dustMotePx(u, ortho.data, i, tune, pos);
      if (pos.fade > 0 && Math.abs(pos.x) < 800 && Math.abs(pos.y) < 450) n += pos.fade;
    }
    counts.push(n);
    for (let s = 0; s < 2 * tune.layers.length; s++) {
      const o = (DUST_HEADER_VEC4 + s * DUST_SLOT_VEC4) * 4;
      if (u[o + 3] > 1e-6) assert.ok(u[o + 2] >= 1600 - 1e-3, `kontener ${u[o + 2]} px węższy niż kadr przy wadze ${u[o + 3]}`);
    }
  }
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  assert.ok(lo > 80, `za mało drobin w kadrze: ${lo}`);
  assert.ok(hi / lo < 1.6, `gęstość skacze z zoomem: ${lo.toFixed(0)}…${hi.toFixed(0)}`);
});

test('smuga: prędkość slotu = −prędkość kamery × p × zoom; widoczność gaśnie w warpie i w widoku strategicznym', () => {
  const u = U({ zoomPx: 0.5, velX: 1500, velY: -300 });
  for (let li = 0; li < tune.layers.length; li++) {
    const o = (DUST_HEADER_VEC4 + li * 2 * DUST_SLOT_VEC4) * 4;
    const p = tune.layers[li].p;
    assert.ok(Math.abs(u[o + 4] + 1500 * p * 0.5) < 1e-3);
    assert.ok(Math.abs(u[o + 5] - 300 * p * 0.5) < 1e-3);
  }
  assert.equal(dustVisibility(tune, 0.45, 500), 1);
  assert.equal(dustVisibility(tune, 0.45, 3000), 1, 'dopalacz w PRZELOCIE (3000 j/s) — pył widoczny');
  assert.equal(dustVisibility(tune, 0.45, 260000), 0, 'warp — pył zgaszony');
  assert.equal(dustVisibility(tune, 0.035, 0), 0, 'zoom strategiczny — bez pyłu');
  assert.equal(dustVisibility(tune, 0.178, 0), 1, 'zoom startowy Atlasa');
  assert.ok(Number.isFinite(dustVisibility(tune, NaN, NaN)));
});

test('uniformy bez NaN przy skrajnych danych; slot bez warstwy ma wagę 0', () => {
  for (const o of [{ zoomPx: 1e-7 }, { zoomPx: 1e4 }, { camX: 1.2e7, camY: -1.2e7 }, { camX: NaN, velX: Infinity, zoomPx: NaN }, { halfW: 0, halfH: 0 }]) {
    const u = U(o);
    for (const v of u) assert.ok(Number.isFinite(v), `NaN/Inf w uniformach dla ${JSON.stringify(o)}`);
  }
  const u = U({});
  for (let li = tune.layers.length; li < DUST_MAX_LAYERS; li++) {
    for (const j of [0, 1]) assert.equal(u[(DUST_HEADER_VEC4 + (li * 2 + j) * DUST_SLOT_VEC4) * 4 + 3], 0);
  }
  // precyzja: przesunięcie wzoru z kamery przy 12 mln j. liczone w double — przesuw o 0,01 j. widać
  const a = U({ camX: 1.2e7, zoomPx: 1 });
  const b = U({ camX: 1.2e7 + 0.01, zoomPx: 1 });
  const o = (DUST_HEADER_VEC4 + 4 * DUST_SLOT_VEC4) * 4;   // warstwa p = 1
  assert.ok(Math.abs((b[o] - a[o]) * a[o + 2] - 0.01) < 2e-3 || Math.abs((b[o + 8] - a[o + 8]) * a[o + 10] - 0.01) < 2e-3);
});

test('prędkość kamery: wygładzona, teleport = cięcie bez smug, pauza wygasza', () => {
  const t = new DustViewTracker();
  let x = 5e6;
  t.step(x, 0, 0.45, 1 / 144, tune, 1600);
  for (let i = 0; i < 144; i++) { x += 500 / 144; t.step(x, 0, 0.45, 1 / 144, tune, 1600); }
  assert.ok(Math.abs(t.vx - 500) < 1, `po sekundzie lotu 500 j/s: ${t.vx}`);
  t.step(x + 300000, 0, 0.45, 1 / 144, tune, 1600);
  assert.equal(t.speed, 0, 'teleport 300 tys. j. = cięcie');
  x += 300000;
  for (let i = 0; i < 144; i++) t.step(x, 0, 0.45, 1 / 144, tune, 1600);
  assert.ok(t.speed < 1e-6);
  // warp (260 tys. j/s) to nie cięcie — prędkość rośnie, widoczność gaśnie
  for (let i = 0; i < 144; i++) { x += 260000 / 144; t.step(x, 0, 0.2, 1 / 144, tune, 1600); }
  assert.ok(t.speed > 200000);
  assert.equal(dustVisibility(tune, 0.2, t.speed), 0);
  t.step(NaN, 0, 0.2, 1 / 144, tune, 1600);
  assert.ok(Number.isFinite(t.vx));
});

test('poświata dysz: stożek za gromadą dysz w barwie palety, nic przed rufą i z boku, głęboki pył słabiej', () => {
  const camX = 6013169.37;
  const camY = -4734110.81;
  EngineFrame.begin();
  const ship = {};
  EngineFrame.beginShip(ship, 500, 0, true);
  // cztery dysze na rufie 1000 j. przed kamerą, wydech w −x, rozstaw w poprzek ±90
  for (const dy of [-90, -30, 30, 90]) EngineFrame.nozzle(camX + 1000, camY + dy, -1, 0, 12, 1.0, 1);
  EngineFrame.endShip();
  assert.equal(EngineFrame.count, 1);
  const u = new Float32Array(dustUniformCount() * 4);
  const base = dustPlumeBase();
  const n = writeDustPlumes(tune, EngineFrame, camX, camY, 2000, u, base);
  assert.equal(n, 1);
  const behind = dustPlumeLightCpu(u, base, n, 1000 - 200, 0, 0);
  const ahead = dustPlumeLightCpu(u, base, n, 1000 + 400, 0, 0);
  const side = dustPlumeLightCpu(u, base, n, 1000 - 200, 900, 0);
  const deep = dustPlumeLightCpu(u, base, n, 1000 - 200, 0, -520);
  assert.ok(behind[2] > 0.3 && behind[2] > behind[0], 'za rufą — poświata w barwie plazmy: ' + behind);
  assert.ok(ahead[2] < behind[2] * 0.02, 'przed rufą prawie nic');
  assert.ok(side[2] < behind[2] * 0.05, 'z boku stożka nic');
  assert.ok(deep[2] < behind[2] * 0.8, 'głębszy pył dostaje mniej poświaty');
  // zgaszony silnik — bez stożka
  EngineFrame.begin();
  EngineFrame.beginShip(ship, 0, 0, true);
  for (const dy of [-90, -30, 30, 90]) EngineFrame.nozzle(camX + 1000, camY + dy, -1, 0, 12, 0.0, 1);
  EngineFrame.endShip();
  assert.equal(writeDustPlumes(tune, EngineFrame, camX, camY, 2000, u, base), 0);
  // limit: 30 okrętów — DUST_PLUME_CAP najbliższych (ta sama moc)
  EngineFrame.begin();
  for (let k = 0; k < 30; k++) {
    EngineFrame.beginShip({ k }, 0, 0, false);
    EngineFrame.nozzle(camX + 300 + k * 120, camY, -1, 0, 10, 1.0, 0);
    EngineFrame.endShip();
  }
  const m = writeDustPlumes(tune, EngineFrame, camX, camY, 6000, u, base);
  assert.equal(m, DUST_PLUME_CAP);
  const xs = [];
  for (let i = 0; i < m; i++) xs.push(u[(base + i * 3) * 4]);
  assert.ok(Math.max(...xs) < 300 + DUST_PLUME_CAP * 120, 'wybrane najbliższe: ' + Math.max(...xs));
  EngineFrame.begin();
  assert.equal(writeDustPlumes(tune, EngineFrame, camX, camY, 2000, u, base), 0);
  for (const v of u) assert.ok(Number.isFinite(v));
});

test('pył 3D (kamery K): sześcian wokół kamery — kotwica w świecie, zanik przy kamerze i brzegu, oktawy bez przeskoków', () => {
  const inst = buildDust3DInstances(tune);
  assert.equal(inst.count, 2 * tune.free3d.count);
  const V3 = (o = {}) => ({ camX: 6000000.37, camY: -4700000.81, camZ: 3200, dist: 8000, halfW: 800, halfH: 450, vis: 1, time: 1, ...o });
  const W3 = (o) => writeDust3DUniforms(tune, V3(o), new Float32Array(dust3DUniformCount() * 4));
  const u0 = W3({});
  const u1 = W3({ camX: 6000000.37 + 55.5, camZ: 3200 - 20 });
  const r0 = { x: 0, y: 0, z: 0, fade: 0 };
  const r1 = { x: 0, y: 0, z: 0, fade: 0 };
  let checked = 0;
  for (let i = 0; i < inst.count; i++) {
    dust3DMoteRel(u0, inst.data, i, tune, r0);
    dust3DMoteRel(u1, inst.data, i, tune, r1);
    const C = u0[(DUST3D_HEADER_VEC4 + inst.data[i * DUST_INSTANCE_STRIDE + 7] * DUST3D_SLOT_VEC4) * 4 + 3];
    if (Math.abs(r1.x - r0.x) > C / 2 || Math.abs(r1.z - r0.z) > C / 2) continue;   // zawinięcie sześcianu
    assert.ok(Math.abs(r1.x - r0.x + 55.5) < 0.02 && Math.abs(r1.z - r0.z - 20) < 0.02 && Math.abs(r1.y - r0.y) < 0.02);
    checked++;
  }
  assert.ok(checked > inst.count * 0.9);
  // zanik: przy kamerze i przy brzegu sześcianu zero
  for (let i = 0; i < inst.count; i++) {
    dust3DMoteRel(u0, inst.data, i, tune, r0);
    const s = inst.data[i * DUST_INSTANCE_STRIDE + 7];
    const o = (DUST3D_HEADER_VEC4 + s * DUST3D_SLOT_VEC4) * 4;
    const d = Math.hypot(r0.x, r0.y, r0.z);
    if (d < u0[o + 5] || d > u0[o + 8]) assert.equal(r0.fade, 0);
  }
  // oktawy: odległość kamery od celu rośnie płynnie — zanik drobiny bez skoków, liczba widocznych prawie stała
  let prev = null;
  const sums = [];
  for (let dist = 1500; dist < 90000; dist *= 1.004) {
    const u = W3({ dist });
    const cur = [];
    let sum = 0;
    for (let i = 0; i < inst.count; i += 7) {
      dust3DMoteRel(u, inst.data, i, tune, r0);
      cur.push(r0.fade);
      sum += r0.fade;
    }
    if (prev) for (let j = 0; j < cur.length; j++) {
      assert.ok(Math.abs(cur[j] - prev[j]) < 0.08, 'skok zaniku ' + prev[j] + ' → ' + cur[j] + ' przy odległości ' + dist.toFixed(0));
    }
    prev = cur;
    sums.push(sum);
  }
  assert.ok(Math.max(...sums) / Math.min(...sums) < 1.7, 'gęstość skacze: ' + Math.min(...sums).toFixed(0) + '…' + Math.max(...sums).toFixed(0));
  for (const v of W3({ dist: NaN, camX: NaN, velX: Infinity })) assert.ok(Number.isFinite(v));
  // prędkość kamery 3D: step3, cięcie przy skoku
  const t = new DustViewTracker();
  t.step3(0, 0, 3000, 1 / 60, tune, 50000);
  for (let i = 1; i <= 60; i++) t.step3(i * 500 / 60, 0, 3000 - i * 100 / 60, 1 / 60, tune, 50000);
  assert.ok(Math.abs(t.vx - 500) < 2 && Math.abs(t.vz + 100) < 1);
  t.step3(1e6, 0, 0, 1 / 60, tune, 50000);
  assert.equal(t.speed, 0);
});

test('obraz w TSL: bez GLSL, trzy siatki (ortho, FG, kamery 3D) na wspólnym fragmencie, ONE/ONE, WGSL w Node', async () => {
  const src = readFileSync(new URL('../src/3d/dust/spaceDust3D.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /new\s+(THREE\.)?(Raw)?ShaderMaterial\s*\(|gl_Position|gl_FragColor|WebGLRenderer/);
  assert.doesNotMatch(src + readFileSync(new URL('../src/3d/dust/spaceDust.js', import.meta.url), 'utf8'), /Math\.random/);
  globalThis.window = globalThis.window || {};
  globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  const THREE = await import('three/webgpu');
  const { Core3D } = await import('../src/3d/core3d.js');
  const { SpaceDust3D, DUST_MESH } = await import('../src/3d/dust/spaceDust3D.js');
  const { LightGrid } = await import('../src/3d/fx/lightGrid.js');
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  Core3D.fx = Core3D.fx || { grid: new LightGrid({ name: 'fxGrid' }) };
  if (!Core3D.fx.grid) Core3D.fx.grid = new LightGrid({ name: 'fxGrid' });
  const warm = [];
  Core3D.warmup = { add: (e) => warm.push(e) };
  const hooks = [];
  Core3D.addPassHook = (name, fn) => hooks.push([name, fn]);
  assert.equal(SpaceDust3D.init(), true);
  const { ortho: mo, fg: mf, free: m3 } = SpaceDust3D.meshes;
  assert.ok(mo && mf && m3);
  assert.equal(mo.material.vertexNode, mf.material.vertexNode, 'wspólny graf wierzchołków z góry');
  assert.notEqual(m3.material.vertexNode, mo.material.vertexNode, 'kamery 3D — własny graf wierzchołków');
  assert.equal(mo.material.fragmentNode, mf.material.fragmentNode, 'wspólny graf fragmentu');
  assert.equal(m3.material.fragmentNode, mo.material.fragmentNode);
  assert.equal(mo.material.depthTest, true);
  assert.equal(mf.material.depthTest, false);
  assert.equal(m3.material.depthTest, true, 'kamery 3D: wspólna głębia — kadłuby i planety zasłaniają pył');
  assert.equal(mo.layers.mask, 1 << DUST_MESH.ortho.layer);
  assert.equal(mf.layers.mask, 1 << DUST_MESH.fg.layer);
  assert.equal(m3.layers.mask, 1 << DUST_MESH.free.layer);
  for (const m of [mo.material, mf.material, m3.material]) {
    assert.equal(m.blending, THREE.CustomBlending);
    assert.equal(m.blendSrc, THREE.OneFactor);
    assert.equal(m.blendDst, THREE.OneFactor);
    assert.equal(m.depthWrite, false);
    assert.equal(m.transparent, true);
  }
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0][0], 'ortho');
  assert.equal(warm.length, 2);
  assert.deepEqual(warm[0].objects(), [mo, mf]);
  assert.equal(warm[1].objects(), m3);
  assert.equal(warm[1].ortho, false, 'siatka kamer 3D rozgrzewana kamerą perspektywy');

  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  for (const [mesh, camera, name] of [[mo, new THREE.OrthographicCamera(), 'spaceDust'], [mf, new THREE.PerspectiveCamera(), 'spaceDust'], [m3, new THREE.PerspectiveCamera(), 'spaceDust3d']]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = Core3D.scene;
    b.camera = camera;
    b.context.material = mesh.material;
    b.build();
    const vs = b.vertexShader;
    const fs = b.fragmentShader;
    assert.match(vs, /fn main/);
    assert.match(fs, /fn main/);
    const inputs = ((vs.match(/fn main\s*\(([\s\S]*?)\)\s*->/) || ['', ''])[1].match(/@location\( ?\d+ ?\)/g) || []).length;
    assert.ok(inputs <= 3, inputs + ' atrybutów wierzchołka (pozycja + 2 z przeplotu)');
    assert.match(vs, new RegExp(name + '\\b'), 'tablica uniformów pyłu ze stałą nazwą');
    assert.match(vs, /fxGridIndex|fxGridLights/, 'siatka świateł czytana w wierzchołkach');
    assert.match(vs, /dustPlume/, 'pętla stożków poświaty dysz');
  }
  // hak: przed passem ortho w kamerze z góry — uniformy z kamery passa, siatki widoczne
  SpaceDust3D.frame(1 / 60, { x: 6013169, y: 4734110, zoom: 0.45 }, null, true);
  for (let i = 0; i < 30; i++) SpaceDust3D.frame(1 / 60, { x: 6013169 + (i + 1) * 500 / 60, y: 4734110, zoom: 0.45 }, null, true);
  Core3D.composerTarget = { width: 1600, height: 900 };
  const cam = new THREE.OrthographicCamera(-800 / 0.45, 800 / 0.45, 450 / 0.45, -450 / 0.45, 1, 300000);
  cam.position.set(6013169 + 250, -4734110, 150000);
  hooks[0][1](cam);
  assert.equal(mo.visible, true);
  assert.equal(mf.visible, true);
  assert.equal(m3.visible, false);
  const arr = SpaceDust3D.uniforms.array;
  assert.ok(Math.abs(arr[2].z - 0.45) < 1e-6, 'zoom px z kamery passa');
  assert.ok(arr[3].w > 0.99, 'widoczność');
  // kamera 3D (free3d): pass ortho rysuje kamerą perspektywy — sześcian drobin wokół niej
  const cam3 = { x: 6013169, y: 4734110, zoom: 0.45, mode: 'free3d', viewDistance: 8000, position: { x: 6013169, y: -4734110 - 6000, z: 3000 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  Core3D.activeCam1 = cam3;
  for (let i = 0; i < 30; i++) {
    cam3.position.x += 500 / 60;
    SpaceDust3D.frame(1 / 60, cam3, null, true);
  }
  const persp = new THREE.PerspectiveCamera(50, 16 / 9, 2, 4e7);
  persp.position.set(cam3.position.x, cam3.position.y, cam3.position.z);
  hooks[0][1](persp);
  assert.equal(m3.visible, true);
  assert.equal(mo.visible, false);
  assert.equal(mf.visible, false);
  const a3 = SpaceDust3D.uniforms3.array;
  assert.ok(Math.abs(a3[4].x - 500) < 5, 'prędkość kamery 3D w uniformach: ' + a3[4].x);
  assert.equal(SpaceDust3D.stats.mode, '3d');
  // opcja wyłączona
  Core3D.activeCam1 = { x: 6013169, y: 4734110, zoom: 0.45 };
  SpaceDust3D.frame(1 / 60, { x: 6013169, y: 4734110, zoom: 0.45 }, null, false);
  hooks[0][1](cam);
  assert.equal(mo.visible, false);
  assert.equal(m3.visible, false);
  SpaceDust3D.dispose();
});

