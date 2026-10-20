// Sieć systemów kreatora kadłubów (src/game/hullDesign/hullDesignSystems.js — kto z kim, hullDesignPipes.js — trasy,
// hullDesignSystemSlots.js — sloty presetów): rury paliwa zbiornik → reaktor → MAIN / SIDE, kable reaktor → urządzenia,
// zero wolnych końców, cała szerokość wiązki w sylwetce, symetria i determinizm, koszt generatora.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHullDesign, expandHullDesign, HD_MODULES } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { HD_PRESET_KEYS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { hullDesignMounts, hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';
import { hullDesignSystems, powerLoad, systemIssues, HD_SYSTEM_TYPES } from '../src/game/hullDesign/hullDesignSystems.js';
import { HD_SYSTEM_SLOTS, applySystemSlots } from '../src/game/hullDesign/hullDesignSystemSlots.js';
import { HD_PIPE_FIT, HD_PIPE_MAT_CABLE, pipeModuleSdf, pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';

const TN = ['custos', 'hasta', 'bellator', 'citadella', 'colossus'];
const netKey = (net) => JSON.stringify({ runs: net.runs, fits: net.fits, nodes: net.graph.nodes });
const fields = new Map();
const fieldOf = (key) => {
  if (!fields.has(key)) fields.set(key, buildHullField(hullDesignPreset(key)));
  return fields.get(key);
};

test('graf systemów: role, urządzenia (kratki i klapy serwisowe nie), kierunek przepływu, walidacja kompletu', () => {
  const mods = [
    { type: 'reactor', x: 0, y: 0, r: 10 }, { type: 'fuel_tank', x: -50, y: 0, w: 10, h: 5 },
    { type: 'engine', x: -100, y: -20, w: 10, h: 8 }, { type: 'thruster_side', x: 20, y: -40, w: 3, h: 2 },
    { type: 'turret_m', x: 40, y: 0, r: 6 }, { type: 'vent', x: 10, y: 10, w: 4, h: 2 },
    { type: 'hatch', x: 30, y: 10, w: 3, h: 2, v: 1 }, { type: 'hatch', x: 30, y: -10, w: 3, h: 2 },
    { type: 'bridge', x: -20, y: 0, w: 6, h: 4 }, { type: 'cargo', x: 60, y: 0, w: 8, h: 4 }
  ];
  const s = hullDesignSystems(mods);
  assert.deepEqual(s.cores, [0]);
  assert.deepEqual(s.tanks, [1]);
  assert.deepEqual(s.mains, [2]);
  assert.deepEqual(s.sides, [3]);
  assert.ok(!s.consumers.includes(5), 'kratka nie jest urządzeniem');
  assert.ok(!s.consumers.includes(6), 'klapa serwisowa TN (hatch v 1) nie jest urządzeniem');
  assert.ok(s.consumers.includes(7) && s.consumers.includes(9) && s.consumers.includes(8), 'luk, ładownia, mostek — urządzenia');
  assert.equal(powerLoad({ type: 'vent' }), 0);
  assert.ok(s.links.some((l) => l.net === 'supply' && l.from === 1 && l.to === 0), 'zbiornik → reaktor');
  assert.ok(s.links.some((l) => l.net === 'feed' && l.from === 0 && l.to === 2), 'reaktor → MAIN');
  assert.ok(s.links.some((l) => l.net === 'feed' && l.from === 0 && l.to === 3), 'reaktor → SIDE');
  assert.ok(s.links.every((l) => l.net !== 'power' || l.from === 0), 'kable z reaktora');
  assert.deepEqual(s.issues, []);
  // projekt od zera: komplet wymagany (rdzeń, zbiornik, mostek, MAIN)
  const codes = systemIssues([]).map((w) => w.code).sort();
  assert.deepEqual(codes, ['bridge', 'core', 'main', 'tank']);
  assert.deepEqual(systemIssues(mods.filter((m) => m.type !== 'fuel_tank')).map((w) => w.code), ['tank']);
});

test('nowe moduły: zbiornik, dysza SIDE, ładownia — schemat, blokada, mocowania dla gry (deg jak edytor gniazd)', () => {
  for (const t of ['fuel_tank', 'thruster_side', 'cargo']) assert.ok(HD_MODULES[t] && HD_MODULES[t].w > 0, t);
  const codes = Object.values(HD_MODULES).map((m) => m.code);
  assert.equal(new Set(codes).size, codes.length, 'kody modułów różne');
  const d = normalizeHullDesign({ v: 2, mirror: true, modules: [{ type: 'thruster_side', x: 10, y: -50, w: 4, h: 3, rot: -Math.PI / 2, lock: true }, { type: 'cargo', x: 0, y: 0, lock: 'tak' }] });
  assert.equal(d.modules[0].lock, true);
  assert.equal(d.modules[1].lock, undefined, 'blokada tylko true');
  const f = buildHullField(hullDesignPreset('citadella'));
  const m = hullDesignMounts(f);
  assert.equal(m.sideThrusters.length, 4, 'Citadella: 2 dysze SIDE na burtę');
  for (const s of m.sideThrusters) assert.ok(s.deg === 0 || s.deg === 180, `deg ${s.deg}`);
  assert.ok(m.sideThrusters.some((s) => s.deg === 180 && s.y < 0) && m.sideThrusters.some((s) => s.deg === 0 && s.y > 0), 'lewa burta 180, prawa 0');
  assert.equal(m.fuelTanks.length, 2);
  assert.equal(m.cores.length, 1);
});

test('sloty presetów: systemy TN z tabel gry, w kadłubie, bez nakładania na moduły presetu, zablokowane; od zera wolne', () => {
  for (const key of TN) {
    const d = hullDesignPreset(key);
    const ex = expandHullDesign(d);
    const f = fieldOf(key);
    const sys = hullDesignSystems(ex.modules);
    assert.deepEqual(sys.issues, [], `${key}: komplet systemów`);
    assert.ok(sys.tanks.length >= 1 && sys.mains.length >= 1 && sys.sides.length >= 2, `${key}: zbiornik, MAIN, SIDE`);
    for (const m of d.modules) if (HD_SYSTEM_TYPES.includes(m.type)) assert.equal(m.lock, true, `${key}: ${m.type} zablokowany`);
    for (const m of ex.modules.filter((q) => ['fuel_tank', 'thruster_side', 'cargo'].includes(q.type))) {
      // środek (SIDE — koniec od strony kadłuba) w kadłubie; bez nakładania na inne moduły (poza reaktorem wewnątrz)
      const inner = m.type === 'thruster_side' ? m.w * 0.6 : 0;
      assert.ok(sampleHullField(f, 0, m.x - Math.cos(m.rot || 0) * inner, m.y - Math.sin(m.rot || 0) * inner) < 0, `${key}: ${m.type} (${m.x}, ${m.y}) w kadłubie`);
      for (const o of ex.modules) {
        if (o === m || (o.type === 'reactor' && o.v >= 1)) continue;
        assert.ok(pipeModuleSdf(o, m.x, m.y) > 0, `${key}: ${m.type} (${m.x}, ${m.y}) na ${o.type} (${o.x}, ${o.y})`);
      }
    }
  }
  // Bellator: rdzeń z REACTOR_CORE_MARKERS (PNG −32 px → −17 j.), zbiornik z FUEL_TANK_MARKERS (−300 px → −161 j.)
  const bel = hullDesignPreset('bellator');
  assert.equal(bel.modules.find((m) => m.type === 'reactor').x, -17);
  assert.ok(Math.abs(bel.modules.find((m) => m.type === 'fuel_tank').x + 161) < 3);
  // projekt od zera: bez slotów i bez blokad
  const empty = hullDesignPreset('empty');
  assert.equal(empty.modules.length, 0);
  assert.deepEqual(applySystemSlots('empty', { modules: [{ type: 'reactor', x: 0, y: 0 }] }).modules[0].lock, undefined);
  assert.ok(Object.keys(HD_SYSTEM_SLOTS).length >= TN.length);
});

test('sieć TN: zero wolnych końców, cała szerokość wiązki w sylwetce, każdy odbiornik zasilony, każdy silnik z paliwem', () => {
  for (const key of TN) {
    const f = fieldOf(key);
    const net = f.pipeNet;
    assert.ok(net, key);
    assert.equal(net.stats.unrouted, 0, `${key}: urządzenia bez trasy`);
    const c = pipeNetworkCheck(net, f);
    assert.equal(c.freeEnds, 0, `${key}: wolne końce`);
    assert.equal(c.outside, 0, `${key}: wiązki poza sylwetką`);
    assert.deepEqual(c.unpowered, [], `${key}: urządzenia bez prądu`);
    assert.deepEqual(c.unfueled, [], `${key}: silniki bez paliwa ze zbiornika przez reaktor`);
    // przyłącza rur paliwa WIDAĆ: ostatni odcinek do gondoli MAIN, dyszy SIDE i przy zbiorniku biegnie rowem / kanałem
    for (const [kind, [seen, all]] of Object.entries(c.fuelEnds)) {
      assert.ok(all > 0 && seen === all, `${key}: widoczne przyłącza ${kind} ${seen}/${all} (${JSON.stringify(c.fuelHidden)})`);
    }
    // każdy koniec łamanej: przyłącze urządzenia (wewnątrz albo na brzegu modułu) albo węzeł wspólny z innym biegiem
    const mods = f.expanded.modules;
    const D = net.detail;
    const ends = new Map();
    for (const r of net.runs) if (r.auto) r.ends.forEach(([a, b]) => { ends.set(a, (ends.get(a) || 0) + 1); ends.set(b, (ends.get(b) || 0) + 1); });
    for (const [id, deg] of ends) {
      const n = net.graph.nodes[id];
      if (n.dev >= 0) assert.ok(pipeModuleSdf(mods[n.dev], n.x, n.y) < 0.5 * D, `${key}: przyłącze poza urządzeniem ${mods[n.dev].type}`);
      else assert.ok(deg >= 2, `${key}: węzeł (${n.x.toFixed(1)}, ${n.y.toFixed(1)}) z jednym biegiem`);
    }
    // sieci: kable (materiał kabli), rury do silników, dopływ — po jednym typie na bieg
    const nets = new Set(net.runs.filter((r) => r.auto).map((r) => r.net));
    for (const id of ['feed', 'supply', 'power']) assert.ok(nets.has(id), `${key}: sieć ${id}`);
    for (const r of net.runs) if (r.net === 'power') assert.equal(r.mat, HD_PIPE_MAT_CABLE);
  }
});

test('sieć TN: kable gęstnieją przy rdzeniu, przyłącza z osprzętem, symetria burt, determinizm', () => {
  for (const key of TN) {
    const f = fieldOf(key);
    const net = f.pipeNet;
    const d = hullDesignPreset(key);
    assert.equal(netKey(net), netKey(buildHullField(d).pipeNet), `${key}: deterministyczna`);
    // kable: najgrubsza wiązka zaczyna się przy reaktorze
    const mods = f.expanded.modules;
    const cable = net.runs.filter((r) => r.net === 'power');
    const maxN = Math.max(...cable.map((r) => r.n));
    const thick = cable.filter((r) => r.n === maxN);
    assert.ok(thick.some((r) => r.ends.flat().some((id) => mods[net.graph.nodes[id].dev]?.type === 'reactor')), `${key}: najgrubsze kable przy rdzeniu`);
    assert.ok(maxN > Math.min(...cable.map((r) => r.n)), `${key}: grubość wiązek kabli z liczby tras`);
    // lustro: druga łamana biegu = pierwsza odbita; osprzęt w parach
    for (const r of net.runs) {
      if (!r.auto) continue;
      assert.equal(r.polys.length, 2);
      const [a, b] = r.polys;
      for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i][0] - b[i][0]) < 1e-9 && Math.abs(a[i][1] + b[i][1]) < 1e-9);
    }
    for (const ft of net.fits) {
      if (Math.abs(ft.y) <= 0.5 * net.detail) continue;
      assert.ok(net.fits.some((g) => g.type === ft.type && Math.abs(g.x - ft.x) < 1e-6 && Math.abs(g.y + ft.y) < 1e-6), `${key}: osprzęt bez pary lustra`);
    }
    const types = new Set(net.fits.map((x) => x.type));
    assert.ok(types.has(HD_PIPE_FIT.gland) || types.has(HD_PIPE_FIT.jbox), `${key}: osprzęt kabli`);
    // zaślepki mają tylko rury ręczne projektu (Citadella: rdzeń dziobu) — po dwie na łamaną; sieć generowana — żadnej
    const manualEnds = net.runs.filter((r) => !r.auto).reduce((a, r) => a + 2 * r.polys.length, 0);
    assert.equal(net.fits.filter((x) => x.type === HD_PIPE_FIT.cap).length, manualEnds, `${key}: zaślepki poza rurami ręcznymi`);
  }
  // pompa przy zbiorniku i kolektory przy gondolach — tam, gdzie przyłącze widać z rowu (Citadella, Colossus)
  for (const key of ['citadella', 'colossus']) {
    const types = new Set(fieldOf(key).pipeNet.fits.map((x) => x.type));
    assert.ok(types.has(HD_PIPE_FIT.collector), `${key}: kolektor przy gondoli`);
  }
});

test('sieć: projekt od zera z kompletem systemów (bez lustra), kadłub z części ze szwami, koszt generatora', () => {
  // asymetryczny projekt od zera (bez lustra): rdzeń, zbiornik, MAIN, SIDE, mostek, wieże
  const d = normalizeHullDesign({
    v: 2, mirror: false, detail: 0.6, pipeNet: { density: 1 },
    shapes: [{ kind: 'rect', op: 'add', x: 0, y: 0, w: 260, h: 90, level: 0 }, { kind: 'rect', op: 'add', x: 40, y: -45, w: 160, h: 30, level: 1 },
      { kind: 'rect', op: 'add', x: 40, y: 45, w: 160, h: 30, level: 1 }, { kind: 'rect', op: 'add', x: -150, y: 0, w: 60, h: 25, level: 1 }],
    modules: [
      { type: 'reactor', x: -60, y: 0, r: 14 }, { type: 'fuel_tank', x: -140, y: 50, w: 18, h: 8 },
      { type: 'engine', x: -270, y: -50, w: 24, h: 14 }, { type: 'engine', x: -270, y: 50, w: 24, h: 14 },
      { type: 'thruster_side', x: 120, y: -84, w: 8, h: 6, rot: -Math.PI / 2 }, { type: 'bridge', x: 100, y: 0, w: 16, h: 12 },
      { type: 'turret_m', x: 30, y: -45, r: 12 }, { type: 'turret_m', x: 30, y: 45, r: 12 }
    ]
  });
  const f = buildHullField(d);
  const c = pipeNetworkCheck(f.pipeNet, f);
  assert.equal(f.pipeNet.stats.unrouted, 0);
  assert.equal(c.freeEnds, 0);
  assert.equal(c.outside, 0);
  assert.deepEqual([c.unpowered, c.unfueled], [[], []]);
  assert.ok(f.pipeNet.runs.every((r) => r.polys.length === 1), 'bez lustra — bez kopii');
  // kadłub z gotowych części stykających się szwem (pole ramy = min brył): szew nie jest burtą — sieć przechodzi
  const fp = fieldOf('tnparts2');
  assert.equal(fp.pipeNet.stats.unrouted, 0, 'tnparts2: trasy przez szwy części');
  assert.equal(pipeNetworkCheck(fp.pipeNet, fp).freeEnds, 0);
  // koszt: praca A* (rozwinięte komórki) najwyżej 1,5 × komórek siatki trasowania na okręt TN (dziś 0,4–0,8; stary
  // generator po stanach komórka × kierunek ~3–4) — miara deterministyczna, czas zależy od obciążenia maszyny (pomiar
  // czasu: docs/KREATOR-KADLUBA.md § „Sieć systemów”)
  for (const key of TN) {
    const st = fieldOf(key).pipeNet.stats;
    assert.ok(st.expanded <= 1.5 * st.cells, `${key}: A* ${st.expanded} rozwinięć na ${st.cells} komórek`);
  }
});

test('sieć ogólna: każdy preset z włączoną siecią (bloki, części, koło, bez lustra) — komplet tras, bez wolnych końców', () => {
  for (const key of HD_PRESET_KEYS) {
    if (key === 'empty') continue;
    const d = hullDesignPreset(key);
    const f = buildHullField({ ...d, pipeNet: { density: 1, seed: d.pipeNet?.seed || 0 } });
    const c = pipeNetworkCheck(f.pipeNet, f);
    assert.equal(f.pipeNet.stats.unrouted, 0, `${key}: bez trasy`);
    assert.deepEqual([c.freeEnds, c.outside, c.unpowered.length, c.unfueled.length], [0, 0, 0, 0], `${key}: wolne końce, poza, bez prądu, bez paliwa`);
  }
});

test('receptura: ostrzeżenia z kompletu systemów, dysza SIDE przy burcie nie jest „poza kadłubem”', () => {
  for (const key of TN) assert.deepEqual(hullDesignRecipe(fieldOf(key)).warnings, [], key);
  const f = buildHullField(normalizeHullDesign({ v: 2, mirror: true, blocks: [[0, -1, 0], [1, -1, 0]], modules: [{ type: 'reactor', x: 60, y: 0, r: 10 }] }));
  const texts = hullDesignRecipe(f).warnings.map((w) => w.text).join(' | ');
  assert.match(texts, /zbiornika paliwa/);
  assert.match(texts, /mostka/);
  assert.match(texts, /MAIN/);
});
