// Wspólne testy układu dzielnicy ringu (dema/ring-dzielnice/README.md). Każda dzielnica woła w swoim teście
// `registerDistrictTests(test, assert, layout, opcje)` i dokłada własne przypadki.
import { K7_ATLAS, K7_ATLAS_COLLISION, k7ConvexOverlap } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { RING_V, pointInConvex, yardPoint, yardTangent, yardToArc } from '../../dema/ring-dzielnice/kit/uklad.js';

export const poly = (pts) => pts.map(([x, z]) => ({ x, z }));
export function rect(x, z, heading, length, width) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
    x: x + (a * length / 2) * c - (b * width / 2) * s,
    z: z + (a * length / 2) * s + (b * width / 2) * c
  }));
}
/** Obrys kolizyjny Atlasa w pozie (x, z, kurs). */
export function atlas(x, z, heading) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return K7_ATLAS_COLLISION.map(([u, v]) => ({
    x: x + u * K7_ATLAS.w * c - v * K7_ATLAS.h * s,
    z: z + u * K7_ATLAS.w * s + v * K7_ATLAS.h * c
  }));
}
/** Narzędzia na układzie: `hit(kształt)` → id bryły albo null, `solidAt(s, v)`, `sweepArc(s0, s1, v)`. */
export function districtProbe(layout) {
  const hit = (shape) => {
    for (const s of layout.solids) if (k7ConvexOverlap(shape, s.poly || (s.poly = poly(s.points)))) return s.id;
    return null;
  };
  const solidAt = (s, v) => {
    const [x, z] = yardPoint(s, v);
    for (const q of layout.solids) if (pointInConvex(q.points, x, z)) return q.id;
    return null;
  };
  const sweepArc = (s0, s1, v, step = 150, turn = 0) => {
    const n = Math.ceil(Math.abs(s1 - s0) / step);
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const [x, z] = yardPoint(s, v);
      const id = hit(atlas(x, z, yardTangent(s) + turn));
      if (id) return `${id} (s=${Math.round(s)})`;
    }
    return null;
  };
  return { hit, solidAt, sweepArc };
}

/**
 * Rejestruje testy wspólne. Opcje: `maxV` — najdalszy zasięg w przestrzeń (domyślnie 14 000, pod autostradą),
 * `outerDepth` — do jakiej głębokości od lica drogi szukać bryły rzędu zewnętrznego (domyślnie 2 700).
 */
export function registerDistrictTests(test, assert, layout, { maxV = 14000, outerDepth = 2700 } = {}) {
  const V = layout.v;
  const P = districtProbe(layout);
  const name = layout.id;

  test(`${name}: bryły są wypukłe i mają dodatnie pole`, () => {
    for (const s of layout.solids) {
      let sign = 0;
      let area = 0;
      const n = s.points.length;
      for (let i = 0; i < n; i++) {
        const a = s.points[i];
        const b = s.points[(i + 1) % n];
        const c = s.points[(i + 2) % n];
        area += a[0] * b[1] - b[0] * a[1];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 1e-6) continue;
        const sg = cr > 0 ? 1 : -1;
        if (sign === 0) sign = sg;
        assert.equal(sg, sign, `wklęsła bryła ${s.id}`);
      }
      assert.ok(Math.abs(area) > 100, `pusta bryła ${s.id}`);
    }
  });

  test(`${name}: bez szpar — rząd przy ringu przylega do ściany, rząd zewnętrzny jest ciągły (poza zgłoszonymi otworami)`, () => {
    const open = (s) => (layout.openings || []).some((o) => s > o.s0 && s < o.s1);
    for (let s = layout.sMin + 30; s <= layout.sMax - 30; s += 60) {
      assert.ok(P.solidAt(s, 40), `szpara przy ringu s=${s}`);
      assert.ok(P.solidAt(s, -40), `brak ściany ringu s=${s}`);
      let blocked = false;
      for (let v = V.outer0 + 20; v <= V.outer0 + outerDepth; v += 20) if (P.solidAt(s, v)) { blocked = true; break; }
      assert.equal(blocked, !open(s), `rząd zewnętrzny s=${s}: ${blocked ? 'zamknięty w zgłoszonym otworze' : 'szpara'}`);
    }
  });

  test(`${name}: pole każdego stanowiska leży poza bryłami (z luzem 30 j.)`, () => {
    for (const b of layout.berths) {
      const id = P.hit(rect(b.x, b.z, b.heading, b.length + 60, b.width + 60));
      assert.equal(id, null, `stanowisko ${b.id} wchodzi w ${id}`);
    }
  });

  test(`${name}: Atlas przejeżdża drogę oboma pasami i obraca się w miejscu na osi drogi`, () => {
    const a = -layout.extent + 1500;
    const b = layout.extent - 1500;
    for (const off of [-RING_V.laneOff, 0, RING_V.laneOff]) assert.equal(P.sweepArc(a, b, V.road + off), null, `pas drogi ${off}`);
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const s = layout.sMin + (layout.sMax - layout.sMin) * t;
      const [x, z] = yardPoint(s, V.road);
      for (let ang = 0; ang < 360; ang += 10) assert.equal(P.hit(atlas(x, z, (ang * Math.PI) / 180)), null, `obrót na drodze s=${Math.round(s)} kąt ${ang}`);
    }
  });

  test(`${name}: zatoki ciężarówek i przystanki kolei leżą w dzielnicy, poza wylotami doków i nie zachodzą na siebie`, () => {
    for (const bay of layout.truckBays) {
      assert.ok(bay.s - bay.len / 2 >= layout.sMin && bay.s + bay.len / 2 <= layout.sMax, `zatoka ${bay.id} poza dzielnicą`);
      const half = bay.len / 2 / ((layout.R0 + bay.vFace) / layout.R0);
      for (const p of layout.pits) {
        if (p.orient !== 'arc') continue;
        const mouth = p.open > 0 ? p.v1 : p.v0;
        if (Math.abs(mouth - bay.vFace) > 1) continue;
        assert.ok(bay.s + half < p.s0 || bay.s - half > p.s1, `zatoka ${bay.id} w wylocie doku ${p.id}`);
      }
      for (const other of layout.truckBays) {
        if (other === bay || other.side !== bay.side) continue;
        assert.ok(Math.abs(other.s - bay.s) >= (other.len + bay.len) / 2, `zatoki ${bay.id} i ${other.id} zachodzą na siebie`);
      }
    }
    for (const st of layout.railStops) {
      assert.ok(st.s - st.len / 2 >= layout.sMin && st.s + st.len / 2 <= layout.sMax, `przystanek ${st.id} poza dzielnicą`);
      for (const other of layout.railStops) {
        if (other === st || other.side !== st.side) continue;
        assert.ok(Math.abs(other.s - st.s) >= (other.len + st.len) / 2 + 100, `przystanki ${st.id} i ${other.id} zachodzą na siebie`);
      }
    }
    assert.ok(layout.truckBays.length >= 2, 'dzielnica ma co najmniej dwie zatoki ciężarówek (dostawa i odbiór)');
    assert.ok(layout.railStops.length >= 1, 'dzielnica ma przystanek kolei');
  });

  test(`${name}: dzielnica mieści się w swoim wycinku ringu i pod autostradą`, () => {
    const o = {};
    assert.ok(layout.sMax - layout.sMin <= 18000, 'dzielnica najwyżej 18 000 j. łuku');
    for (const s of layout.solids) {
      if (s.zone === 'RING') continue;
      for (const [x, z] of s.points) {
        yardToArc(x, z, o);
        assert.ok(o.s >= layout.sMin - 1 && o.s <= layout.sMax + 1, `bryła ${s.id} wychodzi poza wycinek (s=${Math.round(o.s)})`);
        assert.ok(o.v >= -1 && o.v <= maxV, `bryła ${s.id} poza zasięgiem (v=${Math.round(o.v)})`);
      }
    }
  });
}
