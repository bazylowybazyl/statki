// Dzielnica ringu „dworzec” (dworzec promów, dema/ring-dzielnice/dworzec) — testy wspólne układu oraz własne:
// stanowiska i transport, przejścia z wnętrza ringu z kładkami nad drogą, brak zabudowy mieszkalnej (ludzie mieszkają
// w ringu — decyzja użytkownika 2026-11-13), trasy promów wolne od brył, symulacja ruchu, budżet brył.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { RESOURCES } from '../src/data/resources.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS, YARD_STATUS_CHANNELS, k7HeightToZ } from '../dema/ring-dzielnice/kit/sceny.js';
import { RING_V, yardToArc } from '../dema/ring-dzielnice/kit/uklad.js';
import plugin from '../dema/ring-dzielnice/dworzec/index.js';
import { FERRY, RAIL, createFerryTraffic, ferrySize, railSchedule } from '../dema/ring-dzielnice/dworzec/ruch.js';
import { DW, FERRY_HULL, berthRoutes, parkedHull } from '../dema/ring-dzielnice/dworzec/uklad.js';
import { districtProbe, rect, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const layout = built.layout;
// plac dworcowy ma 2 400 j. głębokości — rząd zewnętrzny sprawdzany do 2 300 j. od lica drogi
registerDistrictTests(test, assert, layout, { outerDepth: 2300 });
const P = districtProbe(layout);
const V = RING_V;

test('dworzec: długość samego dworca, stanowiska promów S / M / L, postój, przystanki kolei i zatoki zaopatrzenia', () => {
  const len = layout.sMax - layout.sMin;
  assert.equal(len, 2 * DW.termHalf, `dzielnica ma długość dworca (${len})`);
  assert.ok(len >= 6000 && len <= 8000, `długość ${len}`);
  const term = layout.terminalBerths;
  assert.ok(term.length >= 8, `stanowiska dworca: ${term.length}`);
  for (const cls of ['s', 'm', 'l']) assert.ok(term.some((b) => b.cls === cls), `brak stanowiska ${cls} na dworcu`);
  assert.ok(layout.parkBerths.length >= 6, 'postój promów');
  assert.equal(layout.berths.length, layout.terminalBerths.length + layout.parkBerths.length, 'wszystkie stanowiska to dworzec albo postój');
  const pass = layout.railStops.filter((q) => q.goods === 'workforce');
  assert.ok(pass.length >= 2, 'co najmniej dwa przystanki kolei pasażerskiej');
  assert.ok(layout.truckBays.length >= 2, 'co najmniej dwie zatoki zaopatrzenia');
  for (const q of [...layout.truckBays, ...layout.railStops]) assert.ok(RESOURCES[q.goods], `towar „${q.goods}” istnieje w ekonomii`);
  for (const g of ['oxygen', 'polymer']) assert.ok(layout.truckBays.some((b) => b.goods === g && b.dir === 'in'), `zaopatrzenie: ${g}`);
});

test('dworzec: promy stoją dziobem do terminalu, część postoju jest pusta, kadłuby mieszczą się w polach', () => {
  for (const b of layout.terminalBerths) {
    const pit = layout.pits.find((p) => p.berth === b);
    // dziób (kurs) wskazuje ścianę tylną doku: przeciwnie do wylotu
    const nose = [b.x + Math.cos(b.heading) * 100, b.z + Math.sin(b.heading) * 100];
    const ax = berthRoutes(layout, b);
    const dOut = Math.hypot(ax.pivot[0] - b.x, ax.pivot[1] - b.z);
    const dNose = Math.hypot(ax.pivot[0] - nose[0], ax.pivot[1] - nose[1]);
    assert.ok(dNose > dOut + 90, `${b.id}: dziób ku wylotowi`);
    assert.equal(parkedHull(b), null, `${b.id}: stanowisko dworca obsługuje symulacja`);
    const size = trafficHullRenderSize(FERRY_HULL[b.cls]);
    assert.ok(size.w + 40 <= b.length + 60 && size.h + 40 <= b.width, `${b.id}: kadłub ${FERRY_HULL[b.cls]} mieści się w polu`);
    assert.deepEqual([ferrySize(b.cls).length, ferrySize(b.cls).width], [size.w, size.h], 'rozmiary promów w ruch.js zgodne z tabelą kadłubów');
    assert.ok(pit, b.id);
  }
  const parked = layout.parkBerths.map(parkedHull);
  assert.ok(parked.some((h) => h === null), 'na postoju są wolne pola');
  assert.ok(parked.filter(Boolean).length >= 4, 'na postoju stoją promy');
  for (const h of parked) if (h) assert.ok(['crew_shuttle', 'crew_liner', 'colony_liner'].includes(h));
});

test('dworzec: trasy przylotu, wycofania i odlotu każdego stanowiska omijają bryły i nie mają skoków kursu', () => {
  const o = {};
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const b of layout.terminalBerths) {
    const R = berthRoutes(layout, b);
    const size = ferrySize(b.cls);
    for (const key of R.used) {
      const route = R[key];
      assert.ok(route.gate > 100 && route.gate < route.len, `${b.id} ${key}: próg placu na trasie`);
      let prev = null;
      for (let d = 0; d <= route.len; d += 30) {
        route.at(d, o);
        const hit = P.hit(rect(o.x, o.z, o.h, size.length + 30, size.width + 30));
        assert.equal(hit, null, `${b.id} ${key}: prom wchodzi w ${hit} (d=${d})`);
        if (prev !== null) assert.ok(Math.abs(wrap(o.h - prev)) < 0.3, `${b.id} ${key}: skok kursu przy d=${d}`);
        prev = o.h;
      }
    }
    // przylot kończy się w środku pola, kursem pola
    R[R.arrive[0]].at(1e9, o);
    assert.ok(Math.hypot(o.x - b.x, o.z - b.z) < 1, `${b.id}: koniec przylotu w polu`);
    assert.ok(Math.abs(wrap(o.h - b.heading)) < 0.05, `${b.id}: koniec przylotu kursem pola`);
    // wycofanie i obrót w miejscu: kadłub obrócony o dowolny kąt w punkcie obrotu nie dotyka brył
    for (let d = 0; d <= R.back.len; d += 25) {
      R.back.at(d, o);
      assert.equal(P.hit(rect(o.x, o.z, b.heading, size.length + 30, size.width + 30)), null, `${b.id}: wycofanie`);
    }
    for (let a = 0; a < Math.PI * 2; a += 0.2) assert.equal(P.hit(rect(R.pivot[0], R.pivot[1], a, size.length + 40, size.width + 40)), null, `${b.id}: obrót w miejscu`);
  }
});

test('dworzec: symulacja — promy przylatują, stoją ~60 s i odlatują; lampy stanu idą za zajętością; bez zbliżeń', () => {
  const occupied = new Set();
  const sim = createFerryTraffic(layout, { occupied });
  const seen = new Map();
  let minGap = Infinity;
  const live = [];
  for (let i = 0; i < 60 * 12 * 5; i++) {           // 12 minut po 0,2 s
    sim.step(0.2);
    live.length = 0;
    sim.each((sl, p, docked) => {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.h), 'poza promu');
      if (!docked) live.push([p.x, p.z, sl.size.length]);
      if (sl.phase === 'dock' || sl.phase === 'in') assert.ok(occupied.has(sl.berth.id), `${sl.berth.id}: lampa czerwona, gdy prom stoi albo leci`);
    });
    for (const sl of sim.slots) {
      if (sl.phase === 'empty') assert.ok(!occupied.has(sl.berth.id), `${sl.berth.id}: lampa zielona, gdy pole wolne`);
      if (sl.phase === 'dock') seen.set(sl.berth.id, (seen.get(sl.berth.id) || 0) + 0.2);
    }
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        const gap = Math.hypot(live[a][0] - live[b][0], live[a][1] - live[b][1]) - (live[a][2] + live[b][2]) / 2;
        if (gap < minGap) minGap = gap;
      }
    }
  }
  const st = sim.stats();
  assert.ok(st.arrivals >= 20 && st.departures >= 20, `ruch w 12 min: ${st.arrivals} przylotów, ${st.departures} odlotów`);
  assert.ok(seen.size === layout.terminalBerths.length, 'każde stanowisko dworca miało prom');
  assert.ok(minGap > 40, `promy w ruchu trzymają odstęp (najmniejszy ${minGap.toFixed(0)} j.)`);
  assert.ok(FERRY.dock === 60, 'postój 60 s jak w ekonomii');
});

test('dworzec: kolej pasażerska staje na przystankach dzielnicy i wraca po okresie', () => {
  const stops = layout.railStops.map((q) => q.s).sort((a, b) => a - b);
  const plan = railSchedule(stops, 1, 0);
  const o = {};
  const visited = new Set();
  let prev = null;
  for (let t = 0; t <= plan.period; t += 0.25) {
    plan.at(t, o);
    if (o.stop) for (const s of stops) if (Math.abs(o.s - s) < 1) visited.add(s);
    if (prev !== null && Math.abs(o.s - prev) < RAIL.span) assert.ok(Math.abs(o.s - prev) <= RAIL.speed * 2 * 0.25 + 1, `skład nie skacze (t=${t})`);
    prev = o.s;
  }
  assert.equal(visited.size, stops.length, 'skład staje na każdym przystanku');
  assert.ok(Math.abs(plan.at(3, {}).s - plan.at(3 + plan.period, {}).s) < 1e-6, 'rozkład okresowy');
});

test('dworzec: sceny budują się bez NaN i mieszczą się w budżecie brył, grup, lamp i kanałów', () => {
  assert.equal(built.buildings.length, 2, 'dwie budowle: dworzec, postój z przejściami');
  assert.ok(built.views.length >= 3 && built.views.length <= 6, 'trzy do sześciu widoków');
  for (const def of built.buildings) {
    const sc = def.scene;
    assert.ok(sc.instances > 0 && sc.instances <= 6000, `${def.name}: ${sc.instances} instancji`);
    assert.ok(sc.lamps.length <= PB_MAX_LAMPS, `${def.name}: lampy`);
    let maxGroup = 0;
    for (const set of Object.values(sc.sets)) {
      for (const arr of Object.values(set)) {
        for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `NaN w ${def.name}`);
        for (let i = 12; i < arr.length; i += 20) if (arr[i] > maxGroup) maxGroup = arr[i];
      }
    }
    assert.ok(maxGroup < PB_MAX_GROUPS, `${def.name}: grupy ruchome ${maxGroup}`);
    assert.ok((sc.rig.status || []).length <= YARD_STATUS_CHANNELS, `${def.name}: kanały lamp stanu`);
    for (const p of sc.plates) for (const [x, z] of p.points) assert.ok(Number.isFinite(x) && Number.isFinite(z), `płyta ${def.name}`);
  }
  // każde stanowisko ma lampę stanu
  const lamps = new Set(built.buildings.flatMap((b) => (b.scene.rig.status || []).map((s) => s.berthId)));
  for (const b of layout.berths) assert.ok(lamps.has(b.id), `lampa stanu ${b.id}`);
});

test('dworzec: nadbudowa (FG) stoi na bryłach — nad drogą są tylko kładki pasażerskie na podporach, nad placem nic', () => {
  // środki instancji zestawu FG (poza grupami ruchomymi) muszą leżeć nad bryłą z `solids` albo w pasie kładki
  const arc = {};
  const onBridge = (x, z) => {
    yardToArc(x, z, arc);
    return layout.gates.some((g) => Math.abs(arc.s - g.bridge.s) * ((layout.R0 + arc.v) / layout.R0) <= g.bridge.half + 30 && arc.v >= g.bridge.v0 - 10 && arc.v <= g.bridge.v1 + 10);
  };
  for (const def of built.buildings) {
    for (const [kind, arr] of Object.entries(def.scene.sets.fg)) {
      for (let i = 0; i < arr.length; i += 20) {
        if (arr[i + 12] !== 0) continue;
        const x = arr[i];
        const z = arr[i + 2];
        let ok = onBridge(x, z);
        for (const q of layout.solids) {
          if (ok) break;
          if (q.zone === 'RING') continue;
          const m = 46;                                   // okapy, rękawy i listwy wystają najwyżej tyle poza krawędź bryły
          for (const [dx, dz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) if (P.solidAt !== undefined && pointIn(q.points, x + dx, z + dz)) { ok = true; break; }
          if (ok) break;
        }
        assert.ok(ok, `${def.name}: bryła FG (${kind}) wisi poza budowlą w x=${x.toFixed(0)}, z=${z.toFixed(0)}`);
      }
    }
  }
});

function pointIn(pts, x, z) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cr) < 1e-9) continue;
    const sg = cr > 0 ? 1 : -1;
    if (sign === 0) sign = sg; else if (sg !== sign) return false;
  }
  return true;
}

test('dworzec: opis miejsca — plac dworcowy ma własną nazwę, stanowisko zostaje dokiem', async () => {
  const { districtLocate, yardPoint } = await import('../dema/ring-dzielnice/kit/uklad.js');
  const [x, z] = yardPoint(0, 4800);
  assert.equal(districtLocate(layout, x, z, {}).place, 'court');
  const b = layout.terminalBerths.find((q) => q.cls === 'l');
  assert.equal(districtLocate(layout, b.x, b.z, {}).place, 'pit');
  const [rx, rz] = yardPoint(0, 2300);
  assert.equal(districtLocate(layout, rx, rz, {}).place, 'road');
});

test('dworzec: bez zabudowy mieszkalnej — tylko dworzec, postój i przejścia; nazwa bez słowa „mieszkalna”', () => {
  assert.ok(!/mieszkaln|osiedl/i.test(`${plugin.name} ${plugin.sub}`), 'nazwa i opis wtyczki');
  for (const def of built.buildings) assert.ok(!/osiedl|mieszk|kopuł|ogr[oó]d/i.test(def.name), `budowla ${def.name}`);
  for (const v of built.views) assert.ok(!/osiedl|mieszk|kopuł|park/i.test(`${v.name} ${v.sub} ${v.caption}`), `widok ${v.name}`);
  const zones = new Set(layout.solids.map((q) => q.zone));
  assert.deepEqual([...zones].sort(), ['DW', 'PP', 'PR', 'RING']);
  for (const def of built.buildings) for (const l of def.scene.labels) assert.ok(!/OSIEDLE|KWATERY|HOTEL|OGRÓD|PARK/.test(`${l.text} ${l.small}`), `napis ${l.text}`);
  // nic nie odstaje poza obrys dworca: rząd przy ringu, dworzec z apsydą
  const o = {};
  for (const q of layout.solids) {
    if (q.zone === 'RING') continue;
    for (const [x, z] of q.points) { yardToArc(x, z, o); assert.ok(o.v <= DW.apse.v1 + 1, `${q.id} sięga v=${Math.round(o.v)}`); }
  }
});

test('dworzec: przejścia z wnętrza ringu — śluza przy ścianie ringu, kładka nad drogą na podporach, peron kolei przy przejściu', () => {
  assert.equal(layout.gates.length, 2, 'dwa przejścia z ringu');
  const row = built.buildings.find((b) => /przejścia z ringu/i.test(b.name));
  assert.ok(row, 'budowla z przejściami');
  const fg = row.scene.sets.fg.box;
  const arc = {};
  for (const g of layout.gates) {
    // przejście stoi na pełnym bloku rzędu przy ringu (bez wnęk promów) i sięga od ściany ringu do lica drogi
    for (let s = g.s0 + 20; s <= g.s1 - 20; s += 40) for (const v of [20, 500, 980]) assert.ok(P.solidAt(s, v), `przejście ${g.id}: blok w s=${s}, v=${v}`);
    for (const p of layout.pits) assert.ok(p.s1 < g.s0 || p.s0 > g.s1 || p.zone === 'DW', `wnęka ${p.id} w przejściu ${g.id}`);
    // kładka: podpory na bryłach po obu stronach drogi, przęsło nad całą drogą, spód nad korytarzem lotu
    const B = g.bridge;
    assert.ok(P.solidAt(B.s, B.v0 + 50) && P.solidAt(B.s, B.v1 - 50), `kładka ${g.id}: podpory na rzędach`);
    assert.ok(B.v0 < V.inner1 && B.v1 > V.outer0, `kładka ${g.id} sięga nad całą drogę`);
    let over = 0;
    let lowest = Infinity;
    let portal = 0;
    for (let i = 0; i < fg.length; i += 20) {
      yardToArc(fg[i], fg[i + 2], arc);
      const ds = Math.abs(arc.s - B.s) * ((layout.R0 + arc.v) / layout.R0);
      if (ds <= B.half + 30 && arc.v > V.inner1 + 20 && arc.v < V.outer0 - 20) { over++; lowest = Math.min(lowest, fg[i + 1] - fg[i + 5] / 2); }
      if (ds <= 320 && arc.v < 110) portal++;
    }
    assert.ok(over >= 10, `kładka ${g.id}: bryły nad drogą (${over})`);
    assert.ok(lowest >= k7HeightToZ(400) - 0.5, `kładka ${g.id}: spód nad korytarzem lotu (z=${lowest.toFixed(0)})`);
    assert.ok(portal >= 6, `śluza ${g.id}: portal przy ścianie ringu (${portal})`);
    // kolej pasażerska staje przy przejściu, po stronie ringu
    assert.ok(layout.railStops.some((q) => q.goods === 'workforce' && q.side === -1 && Math.abs(q.s - g.s) < 1), `peron przy przejściu ${g.id}`);
    // kładka trafia w oś galerii pirsu (dojście do hali odlotów)
    assert.ok(Math.abs(Math.abs(g.s) - DW.gateS) < 1 && DW.gateS > DW.courtHalf && DW.gateS < DW.wingS, 'kładka ląduje na pirsie');
  }
  assert.deepEqual(layout.lintelSkip, [[-DW.sHalf, DW.sHalf]], 'bramownice gospodarza ustępują kładkom');
});
