// Dzielnica ringu „Zakłady elektroniki” (dema/ring-dzielnice/elektronika) — testy wspólne układu i własne:
// towary i drogi transportu, budżet brył, budynki na pokładach, łączniki na podporach, wolne podejście do doków
// od strony przestrzeni, symulacja ruchu (linie, radiatory, suwnica, kopuła).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { RECIPES, isResource } from '../src/data/resources.js';
import { PB_MAX_GROUPS, PB_MAX_LAMPS } from '../src/3d/portBuildings/portBuildingScene.js';
import { RING_V, pointInConvex, ringScale, yardPoint } from '../dema/ring-dzielnice/kit/uklad.js';
import plugin from '../dema/ring-dzielnice/elektronika/index.js';
import { EL, EL_LINES } from '../dema/ring-dzielnice/elektronika/uklad.js';
import { KRIO_YARD } from '../dema/ring-dzielnice/elektronika/krio.js';
import { RUCH, createRuch } from '../dema/ring-dzielnice/elektronika/ruch.js';
import { districtProbe, rect, registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
const layout = built.layout;
registerDistrictTests(test, assert, layout);
const P = districtProbe(layout);
const GROUP_AT = 12;
const STRIDE = 20;

test('elektronika: długość 12–16 tys. j., trzy zakłady stykają się bez przerw', () => {
  const len = layout.sMax - layout.sMin;
  assert.ok(len >= 12000 && len <= 16000, `długość ${len}`);
  assert.equal(EL.fab.s0, layout.sMin);
  assert.equal(EL.fab.s1, EL.opt.s0);
  assert.equal(EL.opt.s1, EL.krio.s0);
  assert.equal(EL.krio.s1, layout.sMax);
  // pokład zakładów jest pełny od pasa frontowego do tylnej krawędzi (bez dziur między halami)
  for (const [Z, vBack] of [[EL.fab, EL.fab.vBack], [EL.opt, EL.opt.vBack], [EL.krio, EL.krio.vBack]]) {
    for (let s = Z.s0 + 40; s < Z.s1; s += 120) for (let v = EL.vFront + 40; v < vBack; v += 200) assert.ok(P.solidAt(s, v), `dziura w pokładzie s=${s} v=${v}`);
  }
});

test('elektronika: sceny bez NaN, w budżecie instancji, grup ruchomych i lamp', () => {
  assert.ok(built.buildings.length >= 2 && built.buildings.length <= 4, 'dzielnica ma 2–4 budowle');
  for (const def of built.buildings) {
    assert.ok(def.scene.instances > 300 && def.scene.instances <= 6000, `${def.name}: ${def.scene.instances} instancji`);
    assert.ok(def.scene.lamps.length <= PB_MAX_LAMPS, `${def.name}: lampy`);
    let maxGroup = 0;
    for (const set of Object.values(def.scene.sets)) {
      for (const arr of Object.values(set)) {
        for (const v of arr) assert.ok(Number.isFinite(v), `NaN w ${def.name}`);
        for (let i = GROUP_AT; i < arr.length; i += STRIDE) maxGroup = Math.max(maxGroup, arr[i]);
      }
    }
    assert.ok(maxGroup < PB_MAX_GROUPS, `${def.name}: grupa ${maxGroup}`);
    for (const p of def.scene.plates) for (const [x, z] of p.points) assert.ok(Number.isFinite(x) && Number.isFinite(z), `płyta NaN w ${def.name}`);
  }
});

test('elektronika: bryły nad drogą należą do zestawu FG i mają spód nie niżej niż 400', () => {
  // w zestawie bg nic nie leży w pasie drogi powyżej płaszczyzny lotu (łączniki idą do fg)
  const o = {};
  for (const def of built.buildings) {
    for (const kind of ['box', 'cyl', 'cone']) {
      const arr = def.scene.sets.bg[kind];
      for (let i = 0; i < arr.length; i += STRIDE) {
        const x = arr[i];
        const z = arr[i + 2];
        o.s = Math.atan2(x, z + layout.R0) * layout.R0;
        o.v = Math.hypot(x, z + layout.R0) - layout.R0;
        const inRoad = o.v > RING_V.inner1 + 140 && o.v < RING_V.outer0 - 140;
        assert.ok(!inRoad, `${def.name}: bryła bg nad drogą (s=${Math.round(o.s)}, v=${Math.round(o.v)})`);
      }
    }
  }
});

test('elektronika: towary w zatokach i na przystankach istnieją i pokrywają receptury trzech linii', () => {
  const bays = layout.truckBays;
  const stops = layout.railStops;
  assert.ok(bays.length >= 3, 'co najmniej 3 zatoki ciężarówek');
  assert.ok(stops.length >= 2, 'co najmniej 2 przystanki kolei');
  for (const p of [...bays, ...stops]) assert.ok(isResource(p.goods), `nieznany towar ${p.goods} (${p.id})`);
  const inbound = new Set([...bays, ...stops].filter((p) => p.dir === 'in').map((p) => p.goods));
  const outbound = new Set([...bays, ...stops].filter((p) => p.dir === 'out').map((p) => p.goods));
  const recipes = { chips: 'etch_chips', superconductor: 'tape_superconductor' };
  for (const L of EL_LINES) {
    assert.ok(outbound.has(L.id), `wyrób ${L.id} nie ma odbioru`);
    for (const g of Object.keys(L.in)) assert.ok(inbound.has(g), `wsad ${g} linii ${L.id} nie ma dostawy lądem`);
    // wyroby wyjeżdżają także od strony magazynów (rząd przy ringu)
    assert.ok(bays.some((b) => b.side < 0 && b.goods === L.id && b.dir === 'out'), `magazyn ${L.id} bez zatoki`);
    if (recipes[L.id]) {
      assert.deepEqual({ ...L.in }, { ...RECIPES[recipes[L.id]].in }, `receptura ${L.id}`);
      assert.equal(L.out, RECIPES[recipes[L.id]].out[L.id]);
    }
  }
  const lens = Object.values(RECIPES).find((r) => r.out && r.out.optic_lens);
  assert.deepEqual({ ...EL_LINES[1].in }, { ...lens.in });
});

test('elektronika: zatoki, przystanki i łączniki stoją przy pełnych kawałkach rzędów (nie nad wylotami doków)', () => {
  const faceSolid = (s, side) => layout.pieces.some((p) => !p.pit && p.face && Math.abs(p.face.v - (side > 0 ? RING_V.outer0 : RING_V.inner1)) < 1 && s >= p.s0 && s <= p.s1);
  for (const bay of layout.truckBays) {
    const half = bay.len / 2 / ringScale(bay.vFace);
    for (const s of [bay.s - half, bay.s, bay.s + half]) assert.ok(faceSolid(s, bay.side), `zatoka ${bay.id} (${bay.goods}) przy wylocie doku`);
  }
  for (const st of layout.railStops) {
    const half = st.len / 2 / ringScale(RING_V.road);
    for (const s of [st.s - half, st.s, st.s + half]) assert.ok(faceSolid(s, st.side), `przystanek ${st.id} przy wylocie doku`);
  }
  assert.equal(layout.bridges.length, 3);
  for (const b of layout.bridges) {
    for (const side of [-1, 1]) for (const ds of [-80, 0, 80]) assert.ok(faceSolid(b.s + ds, side), `wieża łącznika ${b.id} nad dokiem (strona ${side})`);
    // wieże nie stoją w zatokach ani na windach peronów
    for (const bay of layout.truckBays) assert.ok(Math.abs(bay.s - b.s) > bay.len / 2 + 90, `łącznik ${b.id} w zatoce ${bay.id}`);
  }
});

test('elektronika: budynki stoją na pokładach (obrysy wewnątrz brył układu)', () => {
  let n = 0;
  for (const def of built.buildings) {
    for (const fp of def.scene.rig.footprints) {
      n++;
      for (const [x, z] of fp.points) {
        assert.ok(layout.solids.some((q) => q.zone !== 'RING' && pointInConvex(q.points, x, z)), `${def.name}: „${fp.name}” wystaje poza pokład`);
      }
    }
  }
  assert.ok(n >= 20, `zgłoszone obrysy: ${n}`);
});

test('elektronika: pola radiatorów — trzy, w zasięgu, panele po obu stronach trzonu, nie zasłaniają doków i kolimatora', () => {
  assert.equal(layout.radiators.length, 3);
  for (const R of layout.radiators) {
    assert.ok(R.v1 <= 14000 && R.panels.length === 2 * R.n);
    for (const p of R.panels) {
      assert.ok(p.v1 <= R.v1 && p.v0 >= R.v0, `${R.zone}: panel poza trzonem`);
      assert.ok(P.solidAt((p.a + p.b) / 2, (p.v0 + p.v1) / 2), `${R.zone}: panel bez bryły kolizji`);
      assert.ok(p.a >= layout.sMin && p.b <= layout.sMax);
    }
    // między panelami jest przerwa (pole nie jest pełną płytą)
    assert.ok(R.pitch - R.depth >= 150, `${R.zone}: panele bez przerw`);
  }
  // tunel kolimatora ma po bokach wolną przestrzeń
  const T = EL.tunnel;
  for (let v = EL.dome.v1 + 200; v < T.v1; v += 300) {
    assert.equal(P.solidAt(T.s0 - 400, v), null, `zabudowa przy kolimatorze v=${v}`);
    assert.equal(P.solidAt(T.s1 + 400, v), null, `zabudowa przy kolimatorze v=${v}`);
  }
});

test('elektronika: doki od strony przestrzeni mają wolne podejście (statek L leci promieniowo do doku)', () => {
  const ext = layout.berths.filter((b) => b.role === 'krzem-import');
  assert.equal(ext.length, 2);
  for (const b of ext) {
    for (let v = b.v; v <= RUCH.bulk.far; v += 120) {
      const [x, z] = yardPoint(b.s, v);
      assert.equal(P.hit(rect(x, z, b.heading, b.length + 40, b.width + 40)), null, `podejście do ${b.id} zablokowane (v=${Math.round(v)})`);
    }
  }
  // dok z ruchem zostaje pusty — masowiec przylatuje jako statek w ruchu
  assert.equal(built.hulls(ext[1]), null);
  assert.equal(built.hulls(ext[0]), 'long_haul_freighter');
});

test('elektronika: widoki i dobór kadłubów', () => {
  assert.ok(built.views.length >= 3 && built.views.length <= 6);
  for (const v of built.views) {
    assert.ok(v.name && (v.frame || v.at));
    if (v.frame) for (const [x, z] of v.frame) assert.ok(Number.isFinite(x) && Number.isFinite(z));
  }
  const cls = { inter_station_shuttle: 's', police_cutter: 's', crew_shuttle: 's', container_ship: 'm', rescue_ship: 'm', long_haul_freighter: 'l', tanker: 'l' };
  let busy = 0;
  for (const b of layout.berths) {
    const h = built.hulls(b);
    assert.notEqual(h, undefined, `stanowisko ${b.id} bez decyzji`);
    if (!h) continue;
    busy++;
    assert.equal(cls[h], b.cls, `kadłub ${h} w doku klasy ${b.cls} (${b.id})`);
  }
  assert.ok(busy >= 10 && busy < layout.berths.length, `zajęte doki: ${busy}`);
});

test('elektronika: ruch — linie robią partie, radiatory pulsują, suwnica i kopuła pracują w zakresie', () => {
  const ruch = createRuch(layout, { yard: KRIO_YARD, bulkBerth: layout.berths.filter((b) => b.role === 'krzem-import')[1] });
  const S = ruch.state;
  const heat = [[1, 0], [1, 0], [1, 0]];
  let tests = 0;
  let wasTest = 0;
  let carried = 0;
  let retool = 0;
  const az0 = S.dome.az;
  for (let i = 0; i < 60 * 600; i++) {
    ruch.step(1 / 60);
    S.lines.forEach((L, k) => {
      assert.ok(L.progress >= 0 && L.progress <= 1 && L.stock >= 0 && L.stock <= 1 && L.heat >= 0 && L.heat <= 1, `linia ${L.id} poza zakresem`);
      heat[k][0] = Math.min(heat[k][0], L.heat);
      heat[k][1] = Math.max(heat[k][1], L.heat);
      if (L.phase === 'przezbrojenie') retool++;
    });
    if (S.test.on && !wasTest) tests++;
    wasTest = S.test.on;
    const C = S.crane;
    assert.ok(C.u >= KRIO_YARD.u0 + 100 && C.u <= KRIO_YARD.u1 - 100, `suwnica poza torem (u=${C.u})`);
    assert.ok(C.w >= KRIO_YARD.railA + 60 && C.w <= KRIO_YARD.railB - 60, `wózek poza belką (w=${C.w})`);
    assert.ok(C.lift >= 0 && C.lift <= 1);
    if (C.carry) carried++;
    assert.ok(S.power > 0 && S.power < 1);
    assert.ok(S.bulk.v >= layout.berths[0].v - 1e-6 || S.bulk.v > 7000);
  }
  for (const L of S.lines) assert.ok(L.batches >= Math.floor(600 / (L.takt + RUCH.shipTime + RUCH.retoolTime)) - 1 && L.batches >= 5, `linia ${L.id}: ${L.batches} partii`);
  for (const [lo, hi] of heat) assert.ok(hi - lo > 0.4, `radiatory nie pulsują (${lo.toFixed(2)}…${hi.toFixed(2)})`);
  assert.ok(tests >= 4, `próby w kolimatorze: ${tests}`);
  assert.ok(Math.abs(S.dome.az - az0) > 1, 'kopuła się obraca');
  assert.ok(S.crane.moves >= 10 && carried > 0, `kursy suwnicy: ${S.crane.moves}`);
  assert.ok(retool > 0, 'przezbrojenia się zdarzają');
  assert.ok(S.bulk.calls >= 4, `zawinięcia masowca: ${S.bulk.calls}`);
  // jeden długi krok (tempo ×12, rzadkie klatki) nie psuje stanu
  ruch.step(25);
  for (const L of S.lines) assert.ok(Number.isFinite(L.heat) && Number.isFinite(L.stock));
  for (const p of ruch.ships()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && p.opacity >= 0 && p.opacity <= 1, `statek ${p.id}`);
});

test('elektronika: statki na drodze trzymają pasy, masowiec stoi w swoim doku', () => {
  const berth = layout.berths.filter((b) => b.role === 'krzem-import')[1];
  const ruch = createRuch(layout, { yard: KRIO_YARD, bulkBerth: berth });
  let docked = false;
  for (let i = 0; i < 400; i++) {
    ruch.step(0.5);
    for (const p of ruch.ships()) {
      const v = Math.hypot(p.x, p.z + layout.R0) - layout.R0;
      if (p.id === 'el-masowiec') {
        assert.ok(v >= berth.v - 1 && v <= RUCH.bulk.far + 1);
        if (Math.abs(v - berth.v) < 1) docked = true;
      } else {
        assert.ok(Math.abs(Math.abs(v - RING_V.road) - RING_V.laneOff) < 1, `statek ${p.id} poza pasem (v=${v})`);
      }
    }
  }
  assert.ok(docked, 'masowiec dociera do doku');
});
