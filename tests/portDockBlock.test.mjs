// Doki portów bez ringu w obrazie (E14): blok migawki `portDocks` (gra → worker renderu), dane scen trzech rodzajów,
// budowla PortDock3D na atrapie (three bez GPU) — ramka z wyznacznikiem +1 kładzie bryły na wielokątach kolizji gry,
// obraca się tylko piasta koła — i klej updatePortDocks3D (pula, limit budowy na klatkę). Wpięcie w index.html i worker.
// node --test tests/portDockBlock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { PORT_DOCK_BLOCK, applyPortDockBlock, createPortDockBlock } from '../src/render/blocks/portDockBlock.js';
import { buildPortDockGeometry, dockLocalToGame, portDockSolidsInGame } from '../src/3d/portDocks/portDockLayout.js';
import { buildPortDockScene, PORT_DOCK_HEIGHTS } from '../src/3d/portBuildings/portDockScene.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS, PB_STRIDE } from '../src/3d/portBuildings/portBuildingScene.js';
import { PORT_DOCK_KIND_IDS, BERTH_MIX_IDS, PORT_DOCK_STYLE_IDS } from '../src/data/portDocks.js';

const { Core3D } = await import('../src/3d/core3d.js');
const { PortDock3D, PORT_DOCK_HUB_SPIN } = await import('../src/3d/portBuildings/portDock3D.js');
const { updatePortDocks3D, portDocks3DStats, PORT_DOCKS3D } = await import('../src/3d/portDocks3D.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const SPECS = [
  { kind: 'cross', mix: 'default', repeats: 1, dockCount: 2 },
  { kind: 'cross', mix: 'hangar', repeats: 1, dockCount: 1 },
  { kind: 'round', mix: 'default', repeats: 2, dockCount: 2 },
  { kind: 'round', mix: 'default', repeats: 3, dockCount: 2 },
  { kind: 'wheel', mix: 'default', repeats: 4, dockCount: 2 },
  { kind: 'wheel', mix: 'default', repeats: 5, dockCount: 2 }
];

/** Rekord budowli jak `PortDockWorld.renderList` (gra). */
function gameRecord(spec, x, y, angle, style = 'earth') {
  return {
    stationId: `p-${spec.kind}`, kind: spec.kind, spec, x, y, angle, style,
    kindIndex: PORT_DOCK_KIND_IDS.indexOf(spec.kind), mixIndex: BERTH_MIX_IDS.indexOf(spec.mix),
    styleIndex: PORT_DOCK_STYLE_IDS.indexOf(style)
  };
}

test('blok portDocks: rekordy renderu = rekordy gry (rodzaj, skład, styl, mnożnik, doki, poza), limit, pusta klatka', () => {
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createPortDockBlock());
  const frame = createSnapshotFrame();
  const out = [];
  const list = SPECS.map((s, i) => gameRecord(s, 4.5e6 + i * 1e5 + 0.25, -2.25e6 - i * 7.5, 0.3 * i - 1, PORT_DOCK_STYLE_IDS[i % 4]));
  for (const count of [list.length, 2, 0]) {
    frame.portDocks = { list, count };
    packer.begin(frame);
    applyPortDockBlock(packer.view.blocks.portDocks, out);
    packer.finish(frame);
    assert.equal(out.length, Math.min(count, PORT_DOCK_BLOCK.CAP));
    out.forEach((r, i) => {
      const g = list[i];
      assert.equal(r.kindIndex, g.kindIndex);
      assert.equal(r.mixIndex, g.mixIndex);
      assert.equal(r.styleIndex, g.styleIndex);
      assert.equal(r.repeats, g.spec.repeats);
      assert.equal(r.dockCount, g.spec.dockCount);
      assert.ok(Object.is(r.x, g.x) && Object.is(r.y, g.y) && Object.is(r.angle, g.angle), `${i}: poza w double`);
    });
  }
  const big = Array.from({ length: 20 }, (_, i) => gameRecord(SPECS[0], i * 1000, 0, 0));
  frame.portDocks = { list: big, count: big.length };
  packer.begin(frame);
  applyPortDockBlock(packer.view.blocks.portDocks, out);
  packer.finish(frame);
  assert.equal(out.length, PORT_DOCK_BLOCK.CAP, 'nadmiar ucięty do pojemności bloku');
  frame.portDocks = null;
  packer.begin(frame);
  applyPortDockBlock(packer.view.blocks.portDocks, out);
  packer.finish(frame);
  assert.equal(out.length, 0, 'bez listy — pusto');
});

test('sceny doków: dane skończone, grupy i lampy w limicie, tylko koło ma piastę ruchomą, style zmieniają wygląd', () => {
  for (const spec of SPECS) {
    const g = buildPortDockGeometry(spec);
    for (const style of PORT_DOCK_STYLE_IDS) {
      const sc = buildPortDockScene(g, resolvePortBuildingStyle(style));
      let n = 0;
      for (const set of Object.values(sc.sets)) {
        for (const data of Object.values(set)) {
          assert.equal(data.length % PB_STRIDE, 0);
          for (const v of data) assert.ok(Number.isFinite(v), `${spec.kind}×${spec.repeats} ${style}: liczba w instancji`);
          n += data.length / PB_STRIDE;
        }
      }
      assert.equal(n, sc.instances);
      assert.ok(n > 200 && n < 6000, `${spec.kind}: ${n} instancji`);
      assert.ok(sc.groups.length + 1 <= PB_MAX_GROUPS);
      assert.ok(sc.lamps.length <= PB_MAX_LAMPS);
      assert.equal(sc.labels.length, 0, 'bez atlasu napisów na budowlę');
      assert.equal(sc.rig.hubGroup > 0, spec.kind === 'wheel');
      for (const p of sc.plates) for (const pt of p.points) assert.ok(pt.every(Number.isFinite));
      // nadbudówki nie wyżej niż K-7 (kamera gry ~535 j. nad płaszczyzną)
      for (const set of Object.values(sc.sets)) {
        for (const data of Object.values(set)) for (let i = 0; i < data.length; i += PB_STRIDE) assert.ok(data[i + 1] < 160, `${spec.kind}: wysokość ${data[i + 1]}`);
      }
    }
  }
  const g = buildPortDockGeometry(SPECS[4]);
  const earth = buildPortDockScene(g, resolvePortBuildingStyle('earth'));
  const jupiter = buildPortDockScene(g, resolvePortBuildingStyle('jupiter'));
  assert.notEqual(earth.instances, jupiter.instances, 'rodzina radiatorów — inne przypory ściany koła');
});

test('PortDock3D: ramka kładzie układ doku na grze (y sceny = −y gry), wyznacznik +1, warstwy, piasta koła się obraca', () => {
  for (const spec of SPECS) {
    const g = buildPortDockGeometry(spec);
    const x = 7_080_123.5;
    const y = -2_290_456.25;
    const angle = 2.2;
    const d = new PortDock3D({ geometry: g, style: 'mars', x, y, angle });
    d.setLayers(1, 2);
    d.root.updateMatrixWorld(true);
    assert.ok(d.root.matrix.determinant() > 0.999, 'bez odbicia (pułapka 37)');
    // wierzchołki brył kolizji: punkt budowli (x = −v, z = u) → scena == (x gry, −y gry) z dockLocalToGame
    const v3 = new THREE.Vector3();
    const tmp = {};
    for (const s of g.solids.slice(0, 6)) {
      for (const [u, v] of s.points) {
        v3.set(-v, 0, u).applyMatrix4(d.root.matrix);
        dockLocalToGame({ x, y, angle }, u, v, tmp);
        assert.ok(Math.abs(v3.x - tmp.x) < 1e-6 && Math.abs(v3.y + tmp.y) < 1e-6, `${spec.kind}: ${s.tag}`);
      }
    }
    assert.ok(d.meshes.bg.length >= 2 && d.meshes.fg.length >= 1);
    for (const m of d.meshes.bg) assert.ok(m.layers.isEnabled(1) && !m.layers.isEnabled(2));
    for (const m of d.meshes.fg) assert.ok(m.layers.isEnabled(2));
    assert.ok(d.drawCalls <= 10, `${spec.kind}: ${d.drawCalls} rysunków`);
    const G = d.uniforms.uGroup.value;
    d.update(10);
    if (spec.kind === 'wheel') {
      const h = d.rig.hubGroup;
      const a = Math.atan2(-G[h].elements[8], G[h].elements[0]);
      assert.ok(Math.abs(Math.abs(a) - PORT_DOCK_HUB_SPIN * 10) < 1e-6, 'piasta: obrót wokół osi pionowej');
      assert.ok(Math.abs(G[h].elements[5] - 1) < 1e-9, 'oś pionowa stoi');
    }
    for (let k = 0; k < (spec.kind === 'wheel' ? d.rig.hubGroup : 1); k++) assert.ok(G[k].equals(new THREE.Matrix4()), 'reszta budowli stoi');
    d.dispose();
  }
});

test('PortDock3D: lite części obrazu leżą na wielokątach kolizji (piasta, ramiona, obręcz, ściana koła)', () => {
  // Płyty budowli (korpus z wielokątów kolizji) i bryły ramion — punkt środka każdej bryły kolizji jest pod korpusem.
  for (const spec of SPECS) {
    const g = buildPortDockGeometry(spec);
    const sc = buildPortDockScene(g, resolvePortBuildingStyle('earth'));
    const solids = portDockSolidsInGame(g, { x: 0, y: 0, angle: 0 });
    const box = sc.sets.bg.box;
    for (const s of solids) {
      const cx = s.points.reduce((a, p) => a + p.x, 0) / s.points.length;
      const cy = s.points.reduce((a, p) => a + p.y, 0) / s.points.length;
      // budowla: x = −v, z = u (kąt doku 0: u = x gry, v = y gry)
      const bx = -cy;
      const bz = cx;
      const inPlate = sc.plates.some((p) => pointIn(p.points, bx, bz));
      let inBox = false;
      for (let i = 0; i < box.length && !inBox; i += PB_STRIDE) {
        const q = [box[i + 8], box[i + 9], box[i + 10], box[i + 11]];
        // obrót bryły wokół osi pionowej: kąt z kwaternionu (oś Y)
        const ang = 2 * Math.atan2(q[1], q[3]);
        const dx = bx - box[i];
        const dz = bz - box[i + 2];
        const lx = dx * Math.cos(ang) - dz * Math.sin(ang);
        const lz = dx * Math.sin(ang) + dz * Math.cos(ang);
        const bottom = box[i + 1] - box[i + 5] / 2;
        if (Math.abs(lx) <= box[i + 4] / 2 + 1 && Math.abs(lz) <= box[i + 6] / 2 + 1 && bottom < 0) inBox = true;
      }
      assert.ok(inPlate || inBox, `${spec.kind}×${spec.repeats}: bryła ${s.tag} bez korpusu w obrazie`);
    }
  }
  function pointIn(pts, x, z) {
    let sign = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (Math.abs(c) < 1e-9) continue;
      const sg = c > 0 ? 1 : -1;
      if (!sign) sign = sg;
      else if (sg !== sign) return false;
    }
    return true;
  }
  assert.ok(PORT_DOCK_HEIGHTS.bodyBottom < 116 && PORT_DOCK_HEIGHTS.deckTop > 116, 'korpus przecina płaszczyznę gry');
});

test('updatePortDocks3D: budowle z puli, najwyżej jedna nowa na klatkę, niewidoczne poza listą, limit pamięci', () => {
  const prev = Core3D.scene;
  Core3D.scene = new THREE.Scene();
  try {
    const list = SPECS.slice(0, 4).map((s, i) => gameRecord(s, 1e6 + i * 50_000, 2e6, 0.5 * i));
    updatePortDocks3D(list, list.length, 1 / 60, { x: 0, y: 0 });
    assert.equal(portDocks3DStats().built, 1, 'jedna budowla na klatkę');
    for (let k = 0; k < 5; k++) updatePortDocks3D(list, list.length, 1 / 60, { x: 0, y: 0 });
    let st = portDocks3DStats();
    assert.equal(st.built, 4);
    assert.equal(st.visible, 4);
    // ta sama lista — bez nowych budowli; druga klatka z jedną budowlą — reszta znika, nic nie powstaje
    updatePortDocks3D(list, 1, 1 / 60, { x: 0, y: 0 });
    st = portDocks3DStats();
    assert.equal(st.built, 4);
    assert.equal(st.visible, 1);
    // ten sam kształt i styl w innym miejscu — budowla z puli (bez budowy)
    const moved = [gameRecord(SPECS[1], -3e6, 1e5, 1.1)];
    updatePortDocks3D(moved, 1, 0, null);
    assert.equal(portDocks3DStats().built, 4, 'pula zamiast nowej budowli');
    // więcej kształtów niż limit — zwalnia najdawniej widziane
    const many = SPECS.map((s, i) => gameRecord(s, i * 1e5, 0, 0, PORT_DOCK_STYLE_IDS[(i + 1) % 4]));
    for (let k = 0; k < 12; k++) updatePortDocks3D(many, many.length, 0, null);
    st = portDocks3DStats();
    assert.ok(st.built <= Math.max(PORT_DOCKS3D.keep, many.length));
    assert.equal(st.visible, many.length);
  } finally {
    Core3D.scene = prev;
  }
});

test('wpięcie: blok w migawce (tryb worker), rysunek w trybie off, worker dekoduje blok przed kadłubami', () => {
  const src = read('../index.html');
  assert.match(src, /if \(RW_WORKER\) renderSnapshot\.addBlock\(createPortDockBlock\(\)\);/);
  assert.match(src, /f\.portDocks = RW_WORKER \? _portDockRender : null;/);
  assert.match(src, /updatePortDocks3D\(_portDockRender\.list, _portDockRender\.count, PAUSED \? 0 : frameDt\);/);
  const worker = read('../src/render/render.worker.js');
  assert.match(worker, /applyPortDockBlock\(v\.blocks\.portDocks, st\.portDockList\)/);
  assert.match(worker, /updatePortDocks3D\(/);
  const glue = read('../src/3d/portDocks3D.js');
  assert.match(glue, /Core3D\.warmup\?\.add\?\.\(\{\s*name: 'doki portów/);
  assert.doesNotMatch(glue, /window\.|document\.|GameState/);
});
