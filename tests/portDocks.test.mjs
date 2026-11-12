// Doki portów bez ringu (E14): krzyż, okrąg i koło z wlotem — geometria (src/3d/portDocks/portDockLayout.js), układ
// stanowisk dla gospodarki (dockLayout.js: id, klasy, kolejność, promienie redy bez zmian), kolizje gry
// (src/game/portDockWorld.js). Dokowanie statków bańki z krokiem 0,2 s: scripts/tests/portPaths.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortDockGeometry, berthPadPolygon, portDockSolidsInGame, dockLocalToGame, dockGameToLocal
} from '../src/3d/portDocks/portDockLayout.js';
import { buildStationDocks, BERTH_CLASSES } from '../src/game/traffic/dockLayout.js';
import {
  BERTH_MIXES, PORT_DOCK_KIND, PORT_DOCK_PLACEMENT, portDockKindFor, BERTH_MIX_IDS
} from '../src/data/portDocks.js';
import { PortDockWorld } from '../src/game/portDockWorld.js';

/** SAT dwóch wielokątów wypukłych [[u, v]…]; styk krawędzią to nie nakładanie. */
function overlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = p[1] - q[1];
      const ny = q[0] - p[0];
      const len = Math.hypot(nx, ny) || 1;
      let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
      for (const v of a) { const d = (v[0] * nx + v[1] * ny) / len; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = (v[0] * nx + v[1] * ny) / len; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
    }
  }
  return true;
}

/** Pas o szerokości `w` wzdłuż odcinka — ślad kadłuba lecącego ścieżką. */
function strip(p, q, w) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * w / 2;
  const ny = (dx / L) * w / 2;
  return [[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]];
}

const VARIANTS = [
  { kind: 'cross', mix: 'default', repeats: 1, dockCount: 2 },
  { kind: 'cross', mix: 'hangar', repeats: 1, dockCount: 1 },
  { kind: 'round', mix: 'default', repeats: 2, dockCount: 2 },
  { kind: 'round', mix: 'default', repeats: 3, dockCount: 2 },
  { kind: 'wheel', mix: 'default', repeats: 4, dockCount: 2 },
  { kind: 'wheel', mix: 'default', repeats: 5, dockCount: 2 }
];

function pathPoints(arr) {
  const out = [];
  for (let k = 0; k < arr.length; k += 3) out.push([arr[k], arr[k + 1]]);
  return out;
}

test('geometria: skład stanowisk jak w składzie portu, kolejność id (dok, indeks)', () => {
  for (const spec of VARIANTS) {
    const g = buildPortDockGeometry(spec);
    const mix = BERTH_MIXES[spec.mix];
    assert.equal(g.berths.length, mix.length * spec.repeats * spec.dockCount, `${g.key}: liczba stanowisk`);
    g.berths.forEach((b, k) => {
      const d = Math.floor(k / (mix.length * spec.repeats));
      const i = k % (mix.length * spec.repeats);
      assert.equal(b.dock, d, `${g.key}: dok stanowiska ${k}`);
      assert.equal(b.index, i, `${g.key}: indeks stanowiska ${k}`);
      assert.equal(b.cls, mix[i % mix.length], `${g.key}: klasa stanowiska ${k}`);
      assert.equal(b.padLength, BERTH_CLASSES[b.cls].length);
      assert.equal(b.padWidth, BERTH_CLASSES[b.cls].width);
    });
    assert.equal(buildPortDockGeometry(spec), g, 'geometria z pamięci (ten sam obiekt)');
  }
});

test('geometria: pola nie nachodzą na bryły ani na siebie, ścieżki (ślad kadłuba) omijają bryły i cudze pola', () => {
  for (const spec of VARIANTS) {
    const g = buildPortDockGeometry(spec);
    const pads = g.berths.map(berthPadPolygon);
    let padSolid = 0; let padPad = 0; let pathSolid = 0; let pathPad = 0;
    for (let i = 0; i < pads.length; i++) {
      for (const s of g.solids) if (overlap(pads[i], s.points)) padSolid++;
      for (let j = i + 1; j < pads.length; j++) if (overlap(pads[i], pads[j])) padPad++;
    }
    g.berths.forEach((b, i) => {
      const legs = [pathPoints(b.inbound), [[b.u, b.v], ...pathPoints(b.outbound)]];
      for (const pts of legs) {
        for (let k = 0; k + 1 < pts.length; k++) {
          const poly = strip(pts[k], pts[k + 1], b.padWidth * 0.9);
          for (const s of g.solids) if (overlap(poly, s.points)) pathSolid++;
          pads.forEach((pp, j) => { if (j !== i && overlap(poly, pp)) pathPad++; });
        }
      }
    });
    assert.equal(padSolid, 0, `${g.key}: pole ∩ bryła`);
    assert.equal(padPad, 0, `${g.key}: pole ∩ pole`);
    assert.equal(pathSolid, 0, `${g.key}: ścieżka ∩ bryła`);
    assert.equal(pathPad, 0, `${g.key}: ścieżka ∩ cudze pole`);
  }
});

test('geometria: lejek i koniec wyjścia za dyskiem zapasu, ostatni odcinek wejścia = kurs stanowiska', () => {
  for (const spec of VARIANTS) {
    const g = buildPortDockGeometry(spec);
    for (const b of g.berths) {
      const wait = [b.inbound[0], b.inbound[1]];
      if (b.funnel) {
        assert.ok(Math.hypot(...b.funnel) > g.keepR, `${g.key}: lejek za dyskiem`);
        // Lejek leży na osi podejścia: odcinek lejek → punkt czekania wzdłuż `out`.
        const dx = b.funnel[0] - wait[0];
        const dy = b.funnel[1] - wait[1];
        const along = dx * b.out[0] + dy * b.out[1];
        assert.ok(along > 0 && Math.abs(dx * b.out[1] - dy * b.out[0]) < 1e-6, `${g.key}: lejek na osi podejścia`);
      } else {
        assert.ok(Math.hypot(...wait) > g.keepR, `${g.key}: punkt czekania za dyskiem (bez lejka)`);
      }
      const n = b.outbound.length / 3;
      assert.ok(Math.hypot(b.outbound[(n - 1) * 3], b.outbound[(n - 1) * 3 + 1]) > g.keepR, `${g.key}: wyjście za dysk`);
      const k = b.inbound.length / 3 - 2;
      const ang = Math.atan2(b.v - b.inbound[k * 3 + 1], b.u - b.inbound[k * 3]);
      const err = Math.atan2(Math.sin(ang - b.heading), Math.cos(ang - b.heading));
      assert.ok(Math.abs(err) < 1e-6, `${g.key}: wejście na pole dziobem w kursie stanowiska`);
    }
  }
});

test('koło: wejście i wyjście przez szczelinę — każda połowa ma swój pas wlotu (zewnętrzny) i wylotu (bliżej osi)', () => {
  const g = buildPortDockGeometry({ kind: 'wheel', mix: 'default', repeats: 4, dockCount: 2 });
  const m = g.model;
  for (const b of g.berths) {
    const side = b.dock === 0 ? 1 : -1;
    const pts = pathPoints(b.inbound);
    // Punkt czekania i brama przed obręczą, na pasie wlotu połowy (v = ±laneOff), potem wnętrze (r < Rin).
    assert.ok(pts[0][0] > m.Rout && pts[1][0] > m.Rout, 'wlot z zewnątrz obręczy');
    assert.ok(Math.abs(pts[0][1] - side * m.laneOff) < 1e-6 && m.laneOff < m.slotHalf, 'pas wlotu połowy w szczelinie');
    assert.ok(pts.slice(3).every(([u, v]) => Math.hypot(u, v) < m.Rin), 'dalej wewnątrz koła');
    const out = pathPoints(b.outbound);
    const last = out[out.length - 1];
    const gate = out[out.length - 2];
    assert.ok(Math.abs(last[1] - side * m.outOff) < 1e-6 && last[0] > m.Rout, 'wylot pasem wylotu połowy');
    assert.ok(Math.abs(gate[1] - side * m.outOff) < 1e-6 && gate[0] > m.Rout, 'brama wylotu przed obręczą');
    assert.ok(m.outOff < m.laneOff, 'wylot bliżej osi niż wlot');
    assert.equal(b.corridorOut, b.dock === 0 ? 'out1' : 'out2');
    assert.equal(b.corridor, b.dock === 0 ? 'in1' : 'in2');
  }
  assert.ok(m.hubR > 0 && m.ringB > m.hubR && m.ringA > m.ringB, 'piasta pod pierścieniami ruchu');
});

test('układ portu z budowlą: id, klasy, role, doki i promienie redy jak przy pomostach (gospodarka bez zmian)', () => {
  const station = { id: 'mercury', x: 1_234_567, y: -987_654, r: 120 };
  for (const [kind, repeats] of [['cross', 1], ['round', 3], ['wheel', 5]]) {
    const base = buildStationDocks(station, { berthMultiplier: repeats });
    const dock = buildStationDocks(station, { berthMultiplier: repeats, model: { kind, direction: 2.1 } });
    assert.equal(dock.berths.length, base.berths.length);
    dock.berths.forEach((b, k) => {
      const a = base.berths[k];
      for (const f of ['id', 'dockId', 'cls', 'rank', 'role', 'length', 'width', 'freeAt', 'occupantId']) {
        assert.equal(b[f], a[f], `${kind}: ${f} stanowiska ${k}`);
      }
    });
    assert.deepEqual(dock.docks.map((d) => [d.id, d.ringAngle, d.role]), base.docks.map((d) => [d.id, d.ringAngle, d.role]));
    for (const f of ['dockRadius', 'parkingRadius', 'parkingSlots', 'hasRing', 'ringRadius']) assert.equal(dock[f], base[f], f);
    assert.equal(base.model, null);
    const m = dock.model;
    assert.equal(m.kind, kind);
    // Dysk zapasu budowli zaczyna się `nodeClearance` od węzła (punkty manewrowe i pierwszy łuk kolejki poza nim).
    const dist = Math.hypot(m.x - station.x, m.y - station.y);
    assert.ok(Math.abs(dist - m.keepR - PORT_DOCK_PLACEMENT.nodeClearance) < 1e-6, `${kind}: odstęp od węzła`);
    // Pozy stanowisk = geometria w ramce budowli.
    const g = buildPortDockGeometry(m);
    const tmp = {};
    dock.berths.forEach((b, k) => {
      dockLocalToGame(m, g.berths[k].u, g.berths[k].v, tmp);
      assert.ok(Math.abs(tmp.x - b.x) < 1e-6 && Math.abs(tmp.y - b.y) < 1e-6, 'poza stanowiska');
      const l = dockGameToLocal(m, b.x, b.y, {});
      assert.ok(Math.abs(l.u - g.berths[k].u) < 1e-6 && Math.abs(l.v - g.berths[k].v) < 1e-6, 'odwrotność ramki');
    });
  }
});

test('przydział rodzaju po wielkości portu; nadpisanie z definicji rynku', () => {
  assert.equal(portDockKindFor(1), PORT_DOCK_KIND.CROSS);
  assert.equal(portDockKindFor(2), PORT_DOCK_KIND.ROUND);
  assert.equal(portDockKindFor(3), PORT_DOCK_KIND.ROUND);
  assert.equal(portDockKindFor(4), PORT_DOCK_KIND.WHEEL);
  assert.equal(portDockKindFor(6), PORT_DOCK_KIND.WHEEL);
  assert.equal(portDockKindFor(1, 'wheel'), PORT_DOCK_KIND.WHEEL);
  assert.equal(portDockKindFor(5, 'nonsens'), PORT_DOCK_KIND.WHEEL);
  assert.deepEqual(BERTH_MIX_IDS, ['default', 'megadock', 'hangar']);
});

test('kolizje gry: bryły zatrzymują kadłub i pocisk, hipercruise nie przelatuje bryły, objazdy autopilota', () => {
  const world = new PortDockWorld();
  const frame = { x: 4_000_000, y: 3_000_000, angle: 0.4 };
  const table = {};
  for (const [id, kind, repeats] of [['a', 'cross', 1], ['b', 'round', 2], ['c', 'wheel', 4]]) {
    const off = { a: 0, b: 60_000, c: 120_000 }[id];
    table[id] = { kind, mix: 'default', repeats, dockCount: 2, x: frame.x + off, y: frame.y, angle: frame.angle, keepR: 0, style: 'earth' };
  }
  assert.ok(world.sync(table, 1));
  assert.equal(world.sync(table, 1), false, 'ta sama wersja — bez przebudowy');
  assert.equal(world.count, 3);
  for (const d of world.docks) {
    const solids = portDockSolidsInGame(d.geometry, d);
    for (const s of solids) {
      const cx = s.points.reduce((t, p) => t + p.x, 0) / s.points.length;
      const cy = s.points.reduce((t, p) => t + p.y, 0) / s.points.length;
      assert.ok(world.pointInSolid(cx, cy), `${d.kind}/${s.tag}: środek bryły w bryle`);
      const ship = { pos: { x: cx, y: cy }, vel: { x: 300, y: -200 }, angle: 1, w: 320, h: 140 };
      world.constrainShip(ship);
      assert.ok(world.result.hit, `${d.kind}/${s.tag}: kolizja`);
      // Kadłub głęboko w bryle (teleport w środek piasty krzyża: wyjście w ramię, potem z ramienia) wychodzi
      // w kilku krokach fizyki; potem obwiednia nie siedzi w żadnej bryle (do zapasu na zaokrąglenia).
      for (let step = 0; step < 6 && world.result.hit; step++) world.constrainShip(ship);
      assert.ok(!world.result.hit || world.result.depth < 2, `${d.kind}/${s.tag}: kadłub wypchnięty`);
    }
    // Pola stanowisk są wolne (statek stoi tam, gdzie dokuje ruch).
    let blocked = 0;
    const tmp = {};
    for (const b of d.geometry.berths) {
      dockLocalToGame(d, b.u, b.v, tmp);
      if (world.pointInSolid(tmp.x, tmp.y)) blocked++;
    }
    assert.equal(blocked, 0, `${d.kind}: pola wolne`);
    // Hipercruise: odcinek przez środek budowli (piasta) — cofnięcie do pozy sprzed kroku.
    const ship = { pos: { x: d.x + 300, y: d.y }, vel: { x: 30_000, y: 0 }, angle: 0, w: 300, h: 120 };
    world.blockTunnel(ship, d.x - 3000 * Math.cos(d.angle + 0.3), d.y - 3000 * Math.sin(d.angle + 0.3));
    assert.ok(world.result.hit, `${d.kind}: przebicie bryły zatrzymane`);
  }
  // Daleko od budowli — nic.
  assert.equal(world.pointInSolid(0, 0), false);
  const far = { pos: { x: 0, y: 0 }, vel: { x: 1, y: 0 }, angle: 0, w: 100, h: 50 };
  world.constrainShip(far);
  assert.equal(world.result.hit, false);
  // Autopilot: dysk budowli na drodze; start albo cel w dysku — bez przeszkody.
  const out = world.pushCruiseObstacles([], { x: 0, y: 0 }, { x: 9e6, y: 9e6 });
  assert.equal(out.length, 3);
  const inside = world.pushCruiseObstacles([], { x: frame.x, y: frame.y }, { x: 0, y: 0 });
  assert.equal(inside.length, 2);
  // Lista obrazu w zasięgu kamery.
  assert.equal(world.renderList(frame.x, frame.y, 10_000, []).length, 1);
});
