// Cały ring Ziemi w jednym demie (dema/ring-dzielnica.html, złożenie: dema/ring-dzielnice/kit/zlozenie.js): port ze
// stocznią w środku, dzielnice obok siebie bez przerw; każda bryła leży w wycinku swojej dzielnicy, stanowiska są poza
// bryłami także po obrocie, a Atlas przejeżdża drogę przez wszystkie dzielnice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { k7ConvexOverlap } from '../src/3d/haloRing/haloPortK7Layout.js';
import { RING_V, yardPoint, yardTangent, yardToArc } from '../dema/ring-dzielnice/kit/uklad.js';
import { RING_ORDER, chainOffsets, composeRing } from '../dema/ring-dzielnice/kit/zlozenie.js';
import { atlas, poly, rect } from './helpers/ringDzielnica.mjs';

const style = resolvePortBuildingStyle('earth');
const ids = [...RING_ORDER.left, RING_ORDER.center, ...RING_ORDER.right];
const layouts = {};
const built = {};
for (const id of ids) {
  const plugin = (await import(`../dema/ring-dzielnice/${id}/index.js`)).default;
  built[id] = await plugin.build({ style });
  layouts[id] = built[id].layout;
}
const S = chainOffsets(layouts, RING_ORDER);
const ring = composeRing(ids.map((id) => ({ id, name: id, layout: layouts[id], S: S[id] })));
const hit = (shape) => {
  for (const s of ring.solids) if (k7ConvexOverlap(shape, s.poly || (s.poly = poly(s.points)))) return s.id;
  return null;
};

test('cały ring: siedem dzielnic stoi obok siebie bez przerw — fabryki przy stoczni, zbrojownia za portem', () => {
  assert.deepEqual(ring.parts.map((p) => p.id), ['elektronika', 'huta', 'fabryki', 'port', 'zbrojownia', 'sklady', 'dworzec']);
  for (let i = 0; i + 1 < ring.parts.length; i++) {
    assert.ok(Math.abs(ring.parts[i].sMax - ring.parts[i + 1].sMin) < 1e-6, `przerwa między ${ring.parts[i].id} a ${ring.parts[i + 1].id}`);
  }
  assert.equal(ring.merged.sMin, ring.parts[0].sMin);
  assert.ok(ring.merged.sMax - ring.merged.sMin < 2 * Math.PI * ring.merged.R0 * 0.6, 'złożenie mieści się na ringu');
});

test('cały ring: każda bryła leży w wycinku swojej dzielnicy (dzielnice nie zachodzą na siebie)', () => {
  const o = {};
  for (const s of ring.solids) {
    if (!s.part) continue;
    const p = ring.parts.find((q) => q.id === s.part);
    for (const [x, z] of s.points) {
      yardToArc(x, z, o);
      assert.ok(o.s >= p.sMin - 1 && o.s <= p.sMax + 1, `${s.id}: s=${Math.round(o.s)} poza ${Math.round(p.sMin)}…${Math.round(p.sMax)}`);
    }
  }
});

test('cały ring: stanowiska po obrocie leżą poza bryłami; opis miejsca trafia we właściwą dzielnicę', () => {
  const out = {};
  for (const b of ring.berths) {
    assert.equal(hit(rect(b.x, b.z, b.heading, b.length + 40, b.width + 40)), null, `stanowisko ${b.part}:${b.id}`);
    ring.locate(b.x, b.z, out);
    assert.equal(out.part && out.part.id, b.part, `opis miejsca stanowiska ${b.part}:${b.id}`);
  }
});

test('cały ring: Atlas przejeżdża drogę przez wszystkie dzielnice (oba pasy i oś)', () => {
  const a = ring.merged.sMin - 3000;
  const b = ring.merged.sMax + 3000;
  for (const off of [-RING_V.laneOff, 0, RING_V.laneOff]) {
    for (let s = a; s <= b; s += 220) {
      const [x, z] = yardPoint(s, ring.merged.v.road + off);
      const id = hit(atlas(x, z, yardTangent(s)));
      assert.equal(id, null, `droga, pas ${off}, s=${Math.round(s)}: ${id}`);
    }
  }
});

test('cały ring: zatoki ciężarówek i przystanki kolei wszystkich dzielnic są na wspólnej drodze', () => {
  assert.ok(ring.merged.truckBays.length >= 30, `zatok: ${ring.merged.truckBays.length}`);
  assert.ok(ring.merged.railStops.length >= 12, `peronów: ${ring.merged.railStops.length}`);
  for (const bay of ring.merged.truckBays) {
    const p = ring.parts.find((q) => q.id === bay.part);
    assert.ok(bay.s >= p.sMin && bay.s <= p.sMax, `zatoka ${bay.id} poza dzielnicą ${bay.part}`);
  }
});
