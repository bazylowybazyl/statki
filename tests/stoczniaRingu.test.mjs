// Port przy ringu z drogą w środku i stocznią (koncept, dema/stocznia-ringu) — geometria kompleksu: budowle bez szpar
// (do drogi wchodzi się tylko wjazdem i końcami), stanowiska mieszczą się w dokach, Atlas przejeżdża wjazdem, drogą
// i wylotem suchego doku floty, stanowisk każdej klasy jest nie mniej niż w dzisiejszym kompleksie, linie budowy
// stoczni Jowisza mieszczą swoje kadłuby i zostawiają alejki, a stocznia Ziemi jest zamknięta: ulica z kratownicą
// od drogi ringu obiega trójkątny suchy dok, wlot tylko od drogi; kadłuby i statki dostaw mają wolne trasy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { K7_ATLAS, K7_ATLAS_COLLISION, k7ConvexOverlap } from '../src/3d/haloRing/haloPortK7Layout.js';
import { hullFootprint } from '../src/game/traffic/dockLayout.js';
import {
  YARD_RING, YARD_TODAY, YARD_TRI, buildYardRingLayout, pointInConvex, yardLocate, yardPoint, yardRadial, yardTangent, yardToArc
} from '../dema/stocznia-ringu/layout.js';

const poly = (pts) => pts.map(([x, z]) => ({ x, z }));
function rect(x, z, heading, length, width) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
    x: x + (a * length / 2) * c - (b * width / 2) * s,
    z: z + (a * length / 2) * s + (b * width / 2) * c
  }));
}
function atlas(x, z, heading) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return K7_ATLAS_COLLISION.map(([u, v]) => ({
    x: x + u * K7_ATLAS.w * c - v * K7_ATLAS.h * s,
    z: z + u * K7_ATLAS.w * s + v * K7_ATLAS.h * c
  }));
}
const L = buildYardRingLayout();
function hit(shape) {
  for (const s of L.solids) if (k7ConvexOverlap(shape, s.poly || (s.poly = poly(s.points)))) return s.id;
  return null;
}
function solidAt(s, v) {
  const [x, z] = yardPoint(s, v);
  for (const q of L.solids) if (pointInConvex(q.points, x, z)) return q.id;
  return null;
}
function sweep(from, to, heading, step = 150) {
  const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step);
  for (let i = 0; i <= n; i++) {
    const id = hit(atlas(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n, heading));
    if (id) return id;
  }
  return null;
}
function sweepArc(s0, s1, v, step = 150) {
  const n = Math.ceil(Math.abs(s1 - s0) / step);
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const [x, z] = yardPoint(s, v);
    const id = hit(atlas(x, z, yardTangent(s)));
    if (id) return id;
  }
  return null;
}

test('bryły są wypukłe i mają dodatnie pole', () => {
  for (const s of L.solids) {
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

test('bez szpar: z przestrzeni do drogi wchodzi się tylko pasami wjazdu', () => {
  const g = L.gate;
  const inLane = (s) => (s > g.island.s1 && s < g.s1) || (s > g.s0 && s < g.island.s0);
  for (let s = L.sMin + 40; s <= L.sMax - 40; s += 60) {
    // promień od przestrzeni ku drodze: gdzieś po drodze musi być bryła
    // w pasie skrzyżowania z ulicą stoczni hala ma otwór — od przestrzeni zamykają go budowle wokół doku
    const junction = L.yard.tri && Math.abs(s - L.yard.sc) < L.yard.tri.junctionHalf + 120;
    let blocked = false;
    for (let v = junction ? L.yard.tipV + 400 : L.basin.v1 + 200; v > L.v.outer0 - 5; v -= 20) if (solidAt(s, v)) { blocked = true; break; }
    assert.equal(blocked, !inLane(s), `s=${s}: ${blocked ? 'zamknięte' : 'otwarte'}`);
    // rząd przy ringu przylega do ściany ringu
    assert.ok(solidAt(s, 40), `szpara przy ringu s=${s}`);
    assert.ok(solidAt(s, -40), `brak ściany ringu s=${s}`);
  }
});

test('stanowisk każdej klasy jest nie mniej niż w dzisiejszym kompleksie (cywilne i flota osobno)', () => {
  for (const k of Object.keys(YARD_TODAY.civil)) assert.ok(L.counts.civil[k] >= YARD_TODAY.civil[k], `cywilne ${k}: ${L.counts.civil[k]}`);
  // flota: stanowisko mniejszej klasy może zająć większe (nosiciele i capital liczone razem z L)
  const n = L.counts.navy;
  const t = YARD_TODAY.navy;
  assert.ok(n.capital + n.carrier >= t.capital, 'capital floty');
  assert.ok(n.capital + n.carrier + n.l >= t.capital + t.l, 'L floty');
  assert.ok(n.capital + n.carrier + n.l + n.m >= t.capital + t.l + t.m, 'M floty');
  const all = (o) => o.s + o.m + o.l + o.carrier + o.capital;
  assert.ok(all(n) >= all(t) - 2, `flota razem: ${all(n)} wobec ${all(t)}`);
});

test('pole każdego stanowiska leży poza bryłami (z luzem 30 j.)', () => {
  for (const b of L.berths) {
    const id = hit(rect(b.x, b.z, b.heading, b.length + 60, b.width + 60));
    assert.equal(id, null, `stanowisko ${b.id} wchodzi w ${id}`);
  }
});

test('Atlas stoi w dokach capital i na stanowiskach capital floty, a w doku L się nie mieści', () => {
  const caps = L.berths.filter((b) => b.cls === 'capital');
  assert.ok(caps.length >= 9);
  assert.equal(caps.filter((b) => b.kind === 'refit').length, 3, 'doki refitu capital w hali stoczni');
  for (const b of caps) assert.equal(hit(atlas(b.x, b.z, b.heading)), null, `Atlas nie mieści się w ${b.id}`);
  assert.ok(L.home && L.home.kind === 'slip', 'stanowisko domowe w suchym doku floty');
  const l = L.berths.find((b) => b.cls === 'l');
  assert.ok(hit(atlas(l.x, l.z, l.heading)), 'Atlas nie powinien mieścić się w doku L');
});

test('Atlas obraca się w miejscu na drodze i na placu suchego doku floty', () => {
  const spots = [];
  for (const s of [-24000, -16000, -9000, -3000, 0, 4000, 10000, 16000]) spots.push([s, L.v.road]);
  for (const s of [L.basin.in0 + 2200, L.basin.mouthC, L.basin.in1 - 2200]) spots.push([s, L.basin.laneV]);
  for (const [s, v] of spots) {
    const [x, z] = yardPoint(s, v);
    for (let a = 0; a < 360; a += 5) assert.equal(hit(atlas(x, z, (a * Math.PI) / 180)), null, `s=${s} v=${v} kąt ${a}`);
  }
});

test('trasy Atlasa są wolne: oba pasy wjazdu, droga od końca do końca, wylot suchego doku floty do stanowiska domowego', () => {
  for (const lane of [L.gate.laneIn, L.gate.laneOut]) {
    assert.equal(sweep(yardPoint(lane.s, L.v.outer1 + 4000), yardPoint(lane.s, L.v.road), yardRadial(lane.s) + Math.PI), null, `pas wjazdu s=${lane.s}`);
  }
  assert.equal(sweepArc(L.sMin - 2500, L.sMax + 2500, L.v.road), null, 'droga');
  for (const off of [-650, 650]) assert.equal(sweepArc(L.sMin - 2500, L.sMax + 2500, L.v.road + off), null, `pas drogi ${off}`);
  const B = L.basin;
  assert.equal(sweep(yardPoint(B.mouthC, L.v.road), yardPoint(B.mouthC, B.laneV), yardRadial(B.mouthC)), null, 'wylot suchego doku');
  const h = L.home.berth;
  assert.equal(sweep(yardPoint(h.s, B.laneV), [h.x, h.z], h.heading), null, 'stanowisko domowe');
});

test('opis miejsca: droga, wjazd, suchy dok floty, doki, przestrzeń', () => {
  const at = (s, v) => { const [x, z] = yardPoint(s, v); return yardLocate(L, x, z, {}); };
  assert.equal(at(-8000, L.v.road).place, 'road');
  assert.equal(at(L.gate.laneIn.s, L.v.outer0 + 1200).place, 'gate');
  assert.equal(at(L.basin.mouthC, L.basin.laneV).place, 'basin');
  assert.equal(at(L.home.sc, L.home.vc).place, 'navy');
  assert.equal(at(0, L.basin.v1 + 9000).place, 'space');
  assert.equal(at(-20000, L.v.road).place, 'yardroad');
  const refit = L.pits.find((p) => p.kind === 'refit');
  assert.equal(at(refit.sc, refit.vc).place, 'refit');
  const dock = L.pits.find((p) => p.kind === 'drydock');
  const hang = L.pits.find((p) => p.kind === 'hangar');
  assert.equal(at(dock.sc, dock.vc).place, 'drydock');
  assert.equal(at(hang.sc, hang.vc).pit.id, hang.id);
  const side = L.pits.find((p) => p.orient === 'rad');
  assert.equal(at(side.sc, side.vc).pit.id, side.id);
  const back = yardToArc(...yardPoint(1234, 567), {});
  assert.ok(Math.abs(back.s - 1234) < 1e-6 && Math.abs(back.v - 567) < 1e-6);
  assert.ok(YARD_RING.roadW >= 2000);
});

test('stocznia Jowisza (fabryka taśmowa): krótkie linie mieszczą swoje kadłuby, nie zachodzą na siebie i zostawiają alejki', () => {
  const J = buildYardRingLayout({ yard: 'jupiter' });
  const hitJ = (shape) => {
    for (const s of J.solids) if (k7ConvexOverlap(shape, s.poly || (s.poly = poly(s.points)))) return s.id;
    return null;
  };
  const lines = J.yard.lines;
  assert.equal(J.yard.kind, 'jupiter');
  assert.equal(lines.length, 9);
  assert.equal(J.yard.tri, null);
  const E = buildYardRingLayout({ yard: 'jupiter' }).yard.lines.map((l) => l.len);
  // krótsze taśmy i wolniejszy takt niż w pierwszym szkicu linii
  for (let i = 0; i < lines.length; i++) {
    assert.ok(lines[i].stations <= 4, `${lines[i].id}: ${lines[i].stations} stanowisk`);
    assert.ok(lines[i].takt >= 40, `${lines[i].id}: takt ${lines[i].takt}`);
    assert.equal(lines[i].len, E[i]);
  }
  const polyOf = (l) => { const hw = l.width / 2; return [l.at(0, -hw), l.at(l.len, -hw), l.at(l.len, hw), l.at(0, hw)].map(([x, z]) => ({ x, z })); };
  for (const l of lines) {
    for (const id of l.hulls) {
      const fp = hullFootprint(id);
      assert.ok(fp.width + 80 <= l.width, `${l.id}: ${id} za szeroki (${fp.width} w ${l.width})`);
      assert.ok(fp.length + 100 <= l.pitch, `${l.id}: ${id} za długi (${fp.length} w ${l.pitch})`);
    }
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    assert.equal(k7ConvexOverlap(polyOf(a), polyOf(b)), false, `linie ${a.id} i ${b.id} zachodzą na siebie`);
    const far = Math.max(a.len, b.len) + 2500;
    const heading = (a.heading + b.heading) / 2 + Math.PI;
    for (let d = far; d >= 1150; d -= 150) {
      const p = a.at(d, a.width / 2);
      const q = b.at(d, -b.width / 2);
      const id = hitJ(atlas((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, heading));
      assert.equal(id, null, `alejka ${a.id}–${b.id} w odległości ${d} od hali: ${id}`);
    }
  }
  const mid = lines[4];
  const [x, z] = mid.at(mid.len + 800, 0);
  assert.equal(yardLocate(J, x, z, {}).place, 'yard');
});

test('stocznia Ziemi: ulica od drogi ringu obiega trójkątny suchy dok, pochylnie mieszczą kadłuby', () => {
  const Tr = L.yard.tri;
  assert.equal(L.yard.kind, 'earth');
  assert.ok(Tr, 'wariant ziemski ma trójkątny dok');
  assert.equal(L.yard.lines.length, 0);
  assert.equal(Tr.verts.length, 3);
  assert.equal(L.counts.build, Tr.slips.length);
  assert.ok(Tr.slips.length >= 15, `pochylni: ${Tr.slips.length}`);
  // pomost z żurawiem mieści się między pochylniami (kadłub ma całą szerokość pochylni)
  for (const sd of Tr.sides) assert.ok(sd.gap >= YARD_TRI.fingerW + 10, `bok ${sd.key}: odstęp ${Math.round(sd.gap)} za wąski na pomost`);
  assert.equal(Tr.Dout - Tr.Din, YARD_RING.roadW, 'ulica stoczni tak szeroka jak droga przy ringu');
  const hard = L.solids.filter((s) => s.tag === 'core' || s.tag === 'hub' || s.tag === 'wall' || s.tag === 'pit-back').map((s) => poly(s.points));
  for (const s of Tr.slips) {
    for (const id of s.def.hulls) {
      const fp = hullFootprint(id);
      assert.ok(fp.width + 80 <= s.w, `${s.id}: ${id} za szeroki (${fp.width} w ${s.w})`);
      assert.ok(fp.length + 100 <= s.def.len, `${s.id}: ${id} za długi (${fp.length} w ${s.def.len})`);
      const r = rect(s.cx, s.cz, s.heading, fp.length, fp.width);
      for (const h of hard) assert.equal(k7ConvexOverlap(r, h), false, `${s.id}: kadłub w bryle stoczni`);
    }
    // dziób ku ulicy: punkt przed dziobem jest dalej od trójkąta niż środek kadłuba
    const tip = s.at(200, 0);
    const q0 = Tr.toLocal(s.cx, s.cz, {});
    const q1 = Tr.toLocal(tip[0], tip[1], {});
    assert.ok(Tr.dist(q1.along, q1.across) > Tr.dist(q0.along, q0.across), `${s.id}: dziób ma patrzeć ku ulicy`);
    // żuraw sięga osi kadłuba
    const c = s.crane;
    const hx = c.px + c.hx * c.reach;
    const hz = c.pz + c.hz * c.reach;
    const ax = s.at(0, 0);
    const dAxis = Math.abs((hx - ax[0]) * (-s.az) + (hz - ax[1]) * s.ax);
    assert.ok(dAxis < 80, `${s.id}: wysięgnik ${Math.round(dAxis)} j. od osi kadłuba`);
  }
});

test('stocznia Ziemi jest zamknięta: z ulicy nie da się wylecieć w przestrzeń, wlot tylko od drogi ringu', () => {
  const Tr = L.yard.tri;
  // siatka zajętości w układzie stoczni (a wzdłuż, c w poprzek); a < 0 (hala i droga ringu) traktowane jak ściana
  const cell = 60;
  const a0 = -300;
  const a1 = Tr.far + 1500;
  const c0 = -Tr.halfWidth - 1500;
  const c1 = Tr.halfWidth + 1500;
  const nx = Math.ceil((a1 - a0) / cell);
  const nz = Math.ceil((c1 - c0) / cell);
  const grid = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = a0 + (i + 0.5) * cell;
      const c = c0 + (j + 0.5) * cell;
      if (a < 0) { grid[i * nz + j] = 1; continue; }
    }
  }
  for (const s of L.solids) {
    if (s.zone !== 'YT') continue;
    let la0 = Infinity; let la1 = -Infinity; let lc0 = Infinity; let lc1 = -Infinity;
    for (const [x, z] of s.points) {
      const q = Tr.toLocal(x, z, {});
      la0 = Math.min(la0, q.along); la1 = Math.max(la1, q.along); lc0 = Math.min(lc0, q.across); lc1 = Math.max(lc1, q.across);
    }
    const i0 = Math.max(0, Math.floor((la0 - a0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((la1 - a0) / cell));
    const j0 = Math.max(0, Math.floor((lc0 - c0) / cell));
    const j1 = Math.min(nz - 1, Math.floor((lc1 - c0) / cell));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (grid[i * nz + j]) continue;
        const [x, z] = Tr.at(a0 + (i + 0.5) * cell, c0 + (j + 0.5) * cell);
        if (pointInConvex(s.points, x, z)) grid[i * nz + j] = 1;
      }
    }
  }
  // zalewanie od osi ulicy przy skrzyżowaniu z obwodnicą
  const start = [Math.floor((Tr.junction[0] - a0) / cell), Math.floor((0 - c0) / cell)];
  assert.equal(grid[start[0] * nz + start[1]], 0, 'oś ulicy wolna');
  const seen = new Uint8Array(nx * nz);
  const stack = [start[0] * nz + start[1]];
  seen[stack[0]] = 1;
  let escaped = false;
  let filled = 0;
  while (stack.length) {
    const k = stack.pop();
    filled++;
    const i = Math.floor(k / nz);
    const j = k % nz;
    if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) { escaped = true; break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = (i + di) * nz + (j + dj);
      if (!grid[m] && !seen[m]) { seen[m] = 1; stack.push(m); }
    }
  }
  assert.equal(escaped, false, 'z ulicy stoczni jest wyjście w przestrzeń');
  // ulica zajmuje sensowną powierzchnię (zalane pole ≈ odcinek od hali + obwodnica)
  const loopLen = 3 * Tr.sides[0].len + 2 * Math.PI * Tr.Dc;
  const expect = (loopLen * YARD_RING.roadW + Tr.stemEnd * YARD_RING.roadW) / (cell * cell);
  assert.ok(filled > expect * 0.7 && filled < expect * 1.5, `zalane ${filled}, oczekiwane ~${Math.round(expect)}`);
});

test('stocznia Ziemi: Atlas wjeżdża z drogi ringu, objeżdża dok oboma pasami i obraca się na ulicy', () => {
  const Tr = L.yard.tri;
  const headingOf = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  // odcinek od drogi ringu do obwodnicy: oba pasy
  for (const lane of [-650, 650]) {
    const p = Tr.at(Tr.aRoad + 200, lane);
    const q = Tr.at(Tr.junction[0] - 200, lane);
    assert.equal(sweep(p, q, headingOf(p, q)), null, `pas ${lane} ulicy od hali`);
  }
  // obwodnica: pas wewnętrzny i zewnętrzny (krzywe równoległe do trójkąta)
  for (const lane of [-650, 0, 650]) {
    const ring = Tr.outline(Tr.Dc + lane).map(([a, c]) => Tr.at(a, c));
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(len / 150));
      for (let k = 0; k <= n; k++) {
        const x = p[0] + ((q[0] - p[0]) * k) / n;
        const z = p[1] + ((q[1] - p[1]) * k) / n;
        const id = hit(atlas(x, z, headingOf(p, q)));
        assert.equal(id, null, `obwodnica pas ${lane}, odcinek ${i}: ${id}`);
      }
    }
  }
  // obrót w osi ulicy: odcinek od hali i trzy boki obwodnicy
  const spots = [Tr.at(Tr.stemEnd * 0.5, 0)];
  for (const sd of Tr.sides) spots.push(Tr.at((sd.P[0] + sd.Q[0]) / 2 + sd.n[0] * Tr.Dc, (sd.P[1] + sd.Q[1]) / 2 + sd.n[1] * Tr.Dc));
  for (const [x, z] of spots) {
    for (let a = 0; a < 360; a += 10) assert.equal(hit(atlas(x, z, (a * Math.PI) / 180)), null, `obrót na ulicy kąt ${a}`);
    assert.equal(yardLocate(L, x, z, {}).place, 'yardstreet');
  }
  const pit = Tr.pits[0];
  assert.equal(yardLocate(L, pit.berth.x, pit.berth.z, {}).pit.id, pit.id);
  // trasa dostaw (bez taśm — surowce przywożą statki): frachtowiec przejeżdża ją bez dotknięcia brył i mija
  // kadłub capital wieziony osią ulicy
  const fp = hullFootprint('long_haul_freighter');
  const cap = hullFootprint('heavy_freighter');
  assert.ok(YARD_TRI.supplyOff - fp.width / 2 > cap.width / 2 + 20, 'statek dostaw mija kadłub capital na kratownicy');
  assert.ok(YARD_TRI.supplyOff + fp.width / 2 < Tr.hwS - 40, 'statek dostaw mieści się w ulicy');
  const o = {};
  let prevH = null;
  for (let d = 0; d <= Tr.supply.len; d += 100) {
    Tr.supply.at(d, o);
    const id = hit(rect(o.x, o.z, o.h, fp.length, fp.width));
    assert.equal(id, null, `trasa dostaw wchodzi w ${id} (droga ${d})`);
    if (prevH !== null) assert.ok(Math.abs(Math.atan2(Math.sin(o.h - prevH), Math.cos(o.h - prevH))) < 0.4, `trasa dostaw: skok kursu na drodze ${d}`);
    prevH = o.h;
  }
  assert.ok(Tr.supply.len > 40000, 'trasa dostaw obiega cały dok');
});

test('stocznia Ziemi: kadłub wyjeżdża z pochylni na kratownicę i jedzie nią przez skrzyżowanie na drogę ringu', () => {
  const Tr = L.yard.tri;
  const walls = L.solids.filter((s) => s.tag !== 'buildstrip').map((s) => ({ id: s.id, p: poly(s.points) }));
  const o = {};
  for (const s of Tr.slips) {
    const R = s.route;
    assert.ok(R.len > s.toJunction + 5000, `${s.id}: trasa kończy się na drodze ringu`);
    R.at(0, o);
    assert.ok(Math.hypot(o.x - s.cx, o.z - s.cz) < 1, `${s.id}: trasa zaczyna się na pochylni`);
    const fp = hullFootprint(s.def.hulls[0]);
    let prev = null;
    for (let d = YARD_TRI.slipD + 300; d < R.len - 200; d += 120) {
      R.at(d, o);
      for (const w of walls) {
        assert.equal(k7ConvexOverlap(rect(o.x, o.z, o.h, fp.length, fp.width), w.p), false, `${s.id}: kadłub na kratownicy wchodzi w ${w.id} (droga ${d})`);
      }
      if (prev !== null) {
        const dh = Math.abs(Math.atan2(Math.sin(o.h - prev), Math.cos(o.h - prev)));
        assert.ok(dh < 0.5, `${s.id}: skok kursu ${dh.toFixed(2)} rad na drodze ${d}`);
      }
      prev = o.h;
    }
    // koniec trasy leży na osi drogi ringu, w stronę portu
    R.at(R.len, o);
    const q = yardToArc(o.x, o.z, {});
    assert.ok(Math.abs(q.v - L.v.road) < 5 && q.s > L.yard.sc + 5000, `${s.id}: koniec trasy s=${Math.round(q.s)} v=${Math.round(q.v)}`);
  }
});
