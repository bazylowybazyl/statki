import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AsteroidBeltField,
  BELT_BAND,
  BELT_BANDS,
  BELT_FIELD_CONFIG,
  REF_DIAMETER,
  buildBeltRegions,
  regionPenetration,
  kirkwoodGapFactor,
  fbm2,
  hash32
} from '../src/game/asteroidBeltField.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { BELT_GIANTS_CONFIG } from '../src/game/asteroidBeltGiants.js';
import {
  ROCK_TYPES, NEUTRAL_TYPE, ROCK_FAMILIES, FAMILY, SHAPE_COUNT, SHAPE_VARIANTS,
  pickFamily, familyOfShape, oreShareAtDepth, oreTierFactor,
  ROCK_TYPE_INDEX, NEUTRAL_CARBON_TYPE, ORE_ROCK_TYPES, ORE_TIER, isNeutralType
} from '../src/game/asteroidRockKinds.js';
import { buildSystemMap } from '../src/data/systemMap.js';

const SUN = { x: 6_000_000, y: 6_000_000 };

function makeField(extra = {}) {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3,
    sunRadius: 823,
    angleFor: (def) => ({ jupiter: 250 }[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  return { field: new AsteroidBeltField({ planets, sunX: SUN.x, sunY: SUN.y, auToWorld: auInWorldUnits, ...extra }), au: auInWorldUnits };
}

// Rdzeń pola w Main Belt: szukamy deterministycznie po siatce kątów.
function findFieldCore(field, au) {
  let best = null;
  for (let i = 0; i < 4000; i++) {
    const a = (i / 4000) * Math.PI * 2;
    for (const rAu of [38, 40, 41.5, 43, 45]) {
      const x = SUN.x + Math.cos(a) * rAu * au;
      const y = SUN.y + Math.sin(a) * rAu * au;
      const d = field.densityAt(x, y);
      if (!best || d > best.d) best = { x, y, d };
    }
  }
  return best;
}

test('belt regions match BELT_DEFINITIONS (ring + 2 arcs + 3 Hildas + Kuiper)', () => {
  const { field } = makeField();
  const kinds = field.regions.map((r) => `${r.beltId}:${r.kind}`);
  assert.deepEqual(kinds, [
    'main:ring', 'greeks:arc', 'trojans:arc', 'hildas:arc', 'hildas:arc', 'hildas:arc', 'kuiper:ring',
    'nea:ring', 'hungarias:ring', 'plutinos:ring', 'kuiper_cold:ring'
  ]);
  const kuiper = field.regions.find((r) => r.beltId === 'kuiper');
  assert.equal(kuiper.ice, 1);
});

// Kąt Jowisza w polu testów (makeField: 250°).
function jupiterAngle(field) {
  const jup = field.regions.find((r) => r.beltId === 'greeks');
  return jup.angMid - Math.PI / 3;
}

test('Hildas sit in the L3 / L4 / L5 vertices and win the region there, not next to Jupiter', () => {
  const { field, au } = makeField();
  const ja = jupiterAngle(field);
  const hildas = field.regions.filter((r) => r.beltId === 'hildas');
  assert.equal(hildas.length, 3);
  // wierzchołki trójkąta: L3 (+180°), L4 (+60°), L5 (−60°)
  const offsets = hildas.map((r) => Math.round(((((r.angMid - ja) * 180 / Math.PI) % 360) + 360) % 360)).sort((a, b) => a - b);
  assert.deepEqual(offsets, [60, 180, 300]);
  for (const r of hildas) assert.ok(Math.abs(r.rMid / au - 44.4) < 0.05, `promień łuku Hild ${(r.rMid / au).toFixed(2)} AU`);
  // łuk leży w pasie głównym — mimo płytszego wniknięcia wygrywa skład (priorytet)
  for (const deg of [60, 180, -60]) {
    for (const dA of [-0.12, 0, 0.12]) {
      for (const rAu of [43.3, 44.4, 45.5]) {
        const a = ja + deg * Math.PI / 180 + dA;
        const m = field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au);
        assert.equal(m.region?.beltId, 'hildas', `${deg}° ${dA} rad, ${rAu} AU`);
      }
    }
  }
  // przy Jowiszu i między wierzchołkami — pas główny
  for (const deg of [0, 15, -15, 120, 240]) {
    const a = ja + deg * Math.PI / 180;
    const m = field.sampleMacro(SUN.x + Math.cos(a) * 44.4 * au, SUN.y + Math.sin(a) * 44.4 * au);
    assert.equal(m.region?.beltId, 'main', `${deg}° od Jowisza`);
  }
});

test('Hilda priority changes composition only — density and belt weight are untouched', () => {
  // pełny pas (bez przycięcia) — łuki Hild leżą w pasie głównym
  const { field, au } = makeField({ config: { mainOuterAu: null } });
  const { field: noHildas } = makeField({ config: { mainOuterAu: null }, beltDefs: BELT_DEFINITIONS.filter((b) => b.id !== 'hildas') });
  const ja = jupiterAngle(field);
  for (let i = 0; i < 400; i++) {
    const a = ja + (i / 400) * Math.PI * 2;
    const rAu = 42 + (i % 9) * 0.5;
    const x = SUN.x + Math.cos(a) * rAu * au;
    const y = SUN.y + Math.sin(a) * rAu * au;
    const m = { ...field.sampleMacro(x, y) };
    const n = noHildas.sampleMacro(x, y);
    assert.equal(m.density, n.density);
    assert.equal(m.weight, n.weight);
    assert.equal(m.cluster, n.cluster);
  }
});

test('Kirkwood gaps thin the belt (and its fields) at the resonances, softly', () => {
  const gaps = BELT_FIELD_CONFIG.kirkwoodGaps;
  assert.deepEqual(gaps.map((g) => g.id), ['3:1', '5:2', '7:3', '2:1']);
  const soft = BELT_FIELD_CONFIG.kirkwoodSoftAu;
  const dens = BELT_FIELD_CONFIG.kirkwoodDensity;
  for (const g of gaps) {
    assert.ok(g.width >= 0.2 && g.width <= 0.6, `${g.id}: szerokość ${g.width}`);
    assert.ok(Math.abs(kirkwoodGapFactor(g.au, gaps, soft, dens) - dens) < 1e-12, `${g.id}: środek luki`);
    // połowa głębokości na brzegu nominalnym, miękko i monotonicznie na zewnątrz
    const half = kirkwoodGapFactor(g.au + g.width / 2, gaps, soft, dens);
    assert.ok(Math.abs(half - (dens + 1) / 2) < 0.02, `${g.id}: brzeg ${half}`);
    let prev = 0;
    for (let t = 0; t <= g.width; t += 0.01) {
      const v = kirkwoodGapFactor(g.au + t, [g], soft, dens);
      assert.ok(v >= prev - 1e-12, `${g.id}: monotonicznie`);
      prev = v;
    }
    assert.equal(kirkwoodGapFactor(g.au + g.width / 2 + (g.soft ?? soft) / 2 + 1e-6, [g], soft, dens), 1, `${g.id}: za luką bez zmian`);
  }
  assert.equal(kirkwoodGapFactor(36.5, gaps, soft, dens), 1);
  assert.equal(kirkwoodGapFactor(44.4, gaps, soft, dens), 1, 'Hildy poza lukami');

  // W polu: średnia gęstość po kątach w luce ≪ ramiona luki, pola w luce przerzedzone
  const { field, au } = makeField();
  const ring = (rAu) => {
    let d = 0; let c = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const m = field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au);
      d += m.density; c += m.cluster;
    }
    return { d: d / 720, c: c / 720 };
  };
  for (const g of gaps) {
    const mid = ring(g.au);
    const sh = (ring(g.au - 0.7).d + ring(g.au + 0.7).d) / 2;
    assert.ok(mid.d < sh * 0.25, `${g.id}: w luce ${mid.d.toExponential(2)} vs ramiona ${sh.toExponential(2)}`);
    assert.ok(mid.d > 0, `${g.id}: rzadki przesmyk, nie pustka`);
  }
  // Bez luk (A/B) — ta sama gęstość poza lukami, wyższa w nich
  const { field: none } = makeField({ config: { kirkwoodGaps: [] } });
  const x = SUN.x + 37.57 * au;
  assert.ok(Math.abs(field.densityAt(x, SUN.y) / none.densityAt(x, SUN.y) - BELT_FIELD_CONFIG.kirkwoodDensity) < 1e-9);
  assert.equal(none.densityAt(SUN.x + 38.5 * au, SUN.y), field.densityAt(SUN.x + 38.5 * au, SUN.y));
});

test('Kirkwood gaps leave the giant core scan rings and the main belt field share intact', () => {
  // Pierścienie skanu rdzeni olbrzymów poza lukami: rdzenie mają remisy maksymalnej gęstości, więc
  // ogon luki na pierścieniu skanu przestawia olbrzymy (findBeltCores — pierwszy maksymalny wygrywa).
  const [r0, r1] = BELT_GIANTS_CONFIG.scanRAu;
  const n = BELT_GIANTS_CONFIG.scanRadii;
  for (let k = 0; k < n; k++) {
    const rAu = r0 + (r1 - r0) * (k + 0.5) / n;
    assert.equal(kirkwoodGapFactor(rAu, BELT_FIELD_CONFIG.kirkwoodGaps, BELT_FIELD_CONFIG.kirkwoodSoftAu, BELT_FIELD_CONFIG.kirkwoodDensity), 1,
      `pierścień skanu ${rAu.toFixed(2)} AU w luce`);
  }
  // Udział pól na powierzchni pasa głównego (36–47 AU) nadal 4–30%
  const { field, au } = makeField();
  let inField = 0;
  let total = 0;
  for (let j = 0; j < 40; j++) {
    const rAu = Math.sqrt(36 * 36 + (47 * 47 - 36 * 36) * (j + 0.5) / 40);
    for (let i = 0; i < 600; i++) {
      const a = (i / 600) * Math.PI * 2;
      if (field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au).cluster > 0.2) inField++;
      total++;
    }
  }
  const share = inField / total;
  assert.ok(share > 0.04 && share < 0.3, `udział pól w pasie głównym ${share.toFixed(3)} poza 4–30%`);
});

test('mainOuterAu trims the main belt and leaves the Hildas standing on their own', () => {
  const { field, au } = makeField({ config: { mainOuterAu: 41.5 } });
  const ja = jupiterAngle(field);
  const main = field.regions.find((r) => r.beltId === 'main');
  assert.ok(Math.abs(main.rOuter / au - 41.5) < 1e-9);
  const at = (deg, rAu) => {
    const a = ja + deg * Math.PI / 180;
    return field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au);
  };
  assert.equal(at(0, 44.4).density, 0, 'za przyciętym pasem przy Jowiszu pusto');
  const m = at(180, 44.4);
  assert.equal(m.region?.beltId, 'hildas');
  assert.equal(m.weight, 1, 'łuk Hild — własna obwiednia');
  // domyślnie przycięty do 41,5 (decyzja użytkownika 2026-10-11)
  assert.equal(BELT_FIELD_CONFIG.mainOuterAu, 41.5);
});

test('density is zero far from belts and positive inside the main belt', () => {
  const { field, au } = makeField();
  assert.equal(field.densityAt(SUN.x + 10 * au, SUN.y), 0, 'wewnętrzny układ jest pusty');
  assert.equal(field.densityAt(SUN.x + 90 * au, SUN.y), 0, 'między pasami pusto');
  const inside = field.densityAt(SUN.x + 41.5 * au, SUN.y);
  assert.ok(inside > 0, 'środek Main Belt ma skały');
  assert.ok(inside <= field.maxDensity + 1e-18);
});

test('dense fields cover a minority of the belt and reach the configured core density', () => {
  const { field, au } = makeField();
  let inField = 0;
  let n = 0;
  for (let i = 0; i < 6000; i++) {
    const a = (i / 6000) * Math.PI * 2;
    const m = field.sampleMacro(SUN.x + Math.cos(a) * 41.5 * au, SUN.y + Math.sin(a) * 41.5 * au);
    if (m.cluster > 0.2) inField++;
    n++;
  }
  const share = inField / n;
  assert.ok(share > 0.04 && share < 0.3, `udział pól ${share.toFixed(3)} poza 4–30%`);
  const core = findFieldCore(field, au);
  assert.ok(core.d > field.config.fieldDensity * 0.6, 'rdzeń pola jest gęsty');
});

test('cell generation is deterministic and independent of query order', () => {
  const { field: a, au } = makeField();
  const { field: b } = makeField();
  const core = findFieldCore(a, au);
  const oct = a.bands[BELT_BAND.PLAY].octaves[0];
  const cx = Math.floor(core.x / oct.cell);
  const cy = Math.floor(core.y / oct.cell);
  // b generuje najpierw sąsiadów i większe oktawy — wynik ma być ten sam.
  b.cellRocks(BELT_BAND.PLAY, 2, Math.floor(core.x / b.bands[0].octaves[2].cell), Math.floor(core.y / b.bands[0].octaves[2].cell));
  b.cellRocks(BELT_BAND.PLAY, 0, cx + 1, cy);
  const ra = a.cellRocks(BELT_BAND.PLAY, 0, cx, cy);
  const rb = b.cellRocks(BELT_BAND.PLAY, 0, cx, cy);
  assert.ok(ra.length > 0, 'komórka w rdzeniu nie jest pusta');
  assert.equal(ra.length, rb.length);
  for (let i = 0; i < ra.length; i++) {
    assert.equal(ra[i].id, rb[i].id);
    assert.equal(ra[i].x, rb[i].x);
    assert.equal(ra[i].d, rb[i].d);
    assert.equal(ra[i].type, rb[i].type);
  }
  // Po wyczyszczeniu cache — dokładnie to samo.
  a.clearCache();
  const again = a.cellRocks(BELT_BAND.PLAY, 0, cx, cy);
  assert.deepEqual(again.map((r) => r.id), ra.map((r) => r.id));
});

test('rock ids are unique across cells, octaves and bands', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  const seen = new Set();
  for (const band of [BELT_BAND.PLAY, BELT_BAND.RUBBLE, BELT_BAND.MID]) {
    field.forEachRockInRect(band, core.x - 6000, core.y - 4000, core.x + 6000, core.y + 4000, 0, (rock) => {
      assert.ok(!seen.has(rock.id), `powtórzone id ${rock.id}`);
      seen.add(rock.id);
    });
  }
  assert.ok(seen.size > 50);
});

test('play rocks respect size octaves, spin only around Z and do not overlap bigger rocks', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  const rocks = [];
  field.forEachRockInRect(BELT_BAND.PLAY, core.x - 12000, core.y - 12000, core.x + 12000, core.y + 12000, 0, (r) => rocks.push(r));
  assert.ok(rocks.length > 20, `za mało skał w rdzeniu: ${rocks.length}`);
  const band = BELT_BANDS[BELT_BAND.PLAY];
  for (const r of rocks) {
    const oct = field.bands[BELT_BAND.PLAY].octaves[r.oct];
    assert.ok(r.d >= oct.d0 - 1e-9 && r.d <= oct.d1 + 1e-9, 'średnica w oktawie');
    assert.ok(r.d >= band.dMin && r.d <= band.dMax);
    assert.equal(r.ax, 0); assert.equal(r.ay, 0); assert.equal(r.az, 1);
    assert.equal(r.z, 0);
    assert.ok(Math.abs(r.qx * r.qx + r.qy * r.qy + r.qz * r.qz + r.qw * r.qw - 1) < 1e-9, 'kwaternion jednostkowy');
  }
  // Mniejsza skała nie wchodzi na większą ponad dozwolone zachodzenie.
  const allow = field.config.playOverlap;
  for (let i = 0; i < rocks.length; i++) {
    for (let j = 0; j < rocks.length; j++) {
      const a = rocks[i];
      const b = rocks[j];
      if (a === b || a.oct >= b.oct) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(dist >= (a.r + b.r) * allow - 1e-6, `skała ${a.id} wchodzi na większą ${b.id}`);
    }
  }
});

test('background bands spin in 3D and sit at their depth range', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  for (const bandIndex of [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP]) {
    const band = BELT_BANDS[bandIndex];
    let n = 0;
    let tilted = 0;
    field.forEachRockInRect(bandIndex, core.x - 20000, core.y - 20000, core.x + 20000, core.y + 20000, 0, (r) => {
      n++;
      assert.ok(r.z >= band.zNear && r.z <= band.zFar, `${band.id}: z ${r.z}`);
      assert.ok(Math.abs(Math.hypot(r.ax, r.ay, r.az) - 1) < 1e-9, 'oś jednostkowa');
      if (Math.abs(r.az) < 0.9) tilted++;
    });
    assert.ok(n > 0, `${band.id}: brak skał`);
    assert.ok(tilted > 0, `${band.id}: wszystkie osie pionowe`);
  }
});

test('minDiameter skips whole octaves of small rocks', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  const before = field.stats.cellsGenerated;
  let small = 0;
  field.forEachRockInRect(BELT_BAND.RUBBLE, core.x - 30000, core.y - 30000, core.x + 30000, core.y + 30000, 200, (r) => {
    if (r.d < 200) small++;
  });
  assert.equal(small, 0, 'żadnej skały poniżej minDiameter');
  const generated = field.stats.cellsGenerated - before;
  // Oktawy 24–192 j. mają komórki 1–2 tys. j.: przy 60×60 tys. j. byłoby ich ~5 tys.
  assert.ok(generated < 400, `wygenerowano ${generated} komórek — oktawy drobnicy nie zostały pominięte`);
});

test('density falls off softly at the belt edge instead of a hard cut', () => {
  const { field, au } = makeField();
  // Zewnętrzna krawędź pasa głównego (41,5, krawędź 1,2 AU); wewnętrzna (35,5) jest ostra — 4:1 / ν6, strumień E.
  const outer = BELT_FIELD_CONFIG.mainOuterAu * au;
  const samples = [];
  for (let dAu = -1.5; dAu <= 2.5; dAu += 0.25) samples.push(field.sampleMacro(SUN.x + outer - dAu * au, SUN.y).weight);
  assert.equal(samples[0], 0, 'daleko przed krawędzią pusto');
  assert.equal(samples[samples.length - 1], 1, 'głęboko w pasie pełna waga');
  let steps = 0;
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] >= samples[i - 1] - 1e-12, 'waga rośnie monotonicznie w głąb');
    if (samples[i] > samples[i - 1] + 1e-9) steps++;
  }
  assert.ok(steps >= 4, 'przejście rozłożone na kilka próbek (miękka krawędź)');
});

test('ore provinces bias composition but keep only belt types', () => {
  const { field, au } = makeField();
  const counts = new Map();
  const kuiperR = 132 * au;
  for (let i = 0; i < 3000; i++) {
    const a = (i / 3000) * Math.PI * 2;
    const x = SUN.x + Math.cos(a) * kuiperR;
    const y = SUN.y + Math.sin(a) * kuiperR;
    const m = field.sampleMacro(x, y);
    const t = field._pickType(m.region, x, y, (hash32(i, 7) % 1000) / 1000);
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  // Kuiper: lód, prymitywna (D), kryształ, uran (indeksy 5, 12, 4, 6) — bez żelaza i miedzi.
  assert.ok(!counts.has(0) && !counts.has(1), 'Kuiper bez żelaza i miedzi');
  assert.ok((counts.get(5) || 0) > 300, 'lód dominuje w Kuiperze');
});

test('field edges are neutral filler, ores sit deeper and rare ores in the core', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  const ang = Math.atan2(core.y - SUN.y, core.x - SUN.x);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Profil od strony słońca przez rdzeń: skały PLAY w kwadratach 8×8 tys. j.
  const zones = { rim: { n: 0, neutral: 0, rare: 0 }, core: { n: 0, neutral: 0, rare: 0 } };
  let rimDensity = 0;
  for (let dist = -120000; dist <= 20000; dist += 4000) {
    const cx = core.x + ux * dist;
    const cy = core.y + uy * dist;
    const m = field.sampleMacro(cx, cy);
    const zone = m.cluster > 0.95 ? zones.core : (m.cluster < 0.2 && m.rim > 0.5 ? zones.rim : null);
    if (m.cluster < 0.05 && m.rim > 0.5) rimDensity = Math.max(rimDensity, m.density);
    if (!zone) continue;
    field.forEachRockInRect(BELT_BAND.PLAY, cx - 4000, cy - 4000, cx + 4000, cy + 4000, 0, (r) => {
      zone.n++;
      if (isNeutralType(r.type)) zone.neutral++;
      if (ORE_TIER[ROCK_TYPES[r.type]] === 2 && ROCK_TYPES[r.type] !== 'energy') zone.rare++;
    });
  }
  assert.ok(zones.rim.n > 30 && zones.core.n > 100, `są skały w obu strefach (obrzeże ${zones.rim.n}, rdzeń ${zones.core.n})`);
  assert.ok(zones.rim.neutral / zones.rim.n > 0.75, `obrzeże to wypełniacz: ${(zones.rim.neutral / zones.rim.n).toFixed(2)}`);
  assert.ok(zones.core.neutral / zones.core.n < 0.3, `rdzeń bogaty w rudy: neutralne ${(zones.core.neutral / zones.core.n).toFixed(2)}`);
  assert.ok(zones.rare > 0 || zones.core.rare > 0, 'rzadkie rudy istnieją');
  assert.ok(zones.core.rare / zones.core.n > 3 * (zones.rim.rare / zones.rim.n), 'rzadkie rudy głównie w rdzeniu');
  // Obrzeże dokłada gęstość PRZED polem (pole = 0, a skał więcej niż w rzadkim pasie).
  assert.ok(rimDensity > field.config.baseDensity * 5, `wypełniacz zagęszcza obrzeże: ${rimDensity.toExponential(2)}`);
});

test('ore share and ore tiers grow with depth; neutral rock is outside the old ore list', () => {
  // 7 rud + neutralna (7) + energetyczna (8, tylko z burz — asteroidStorms.js) + typy z widm (9–13)
  // + wypełniacz węglowy (14). Indeksy dawnych typów bez zmian (tablice uniformów, zapisane dane).
  assert.deepEqual(ROCK_TYPES.slice(0, 9), ['iron', 'copper', 'silicon', 'titan', 'crystal', 'ice', 'uran', 'rock', 'energy']);
  assert.deepEqual(ROCK_TYPES.slice(9), ['carbon', 'metal', 'basalt', 'primitive', 'platinum', 'rock_c', 'carbon_ice']);
  assert.equal(ROCK_TYPES[NEUTRAL_TYPE], 'rock');
  assert.equal(ROCK_TYPES[8], 'energy');
  let prev = -1;
  for (let d = 0; d <= 1.0001; d += 0.1) {
    const s = oreShareAtDepth(d);
    assert.ok(s >= prev - 1e-12, 'udział rud nie maleje w głąb');
    prev = s;
  }
  assert.ok(oreShareAtDepth(0) < 0.2 && oreShareAtDepth(1) > 0.8);
  const crystal = ROCK_TYPES.indexOf('crystal');
  const iron = ROCK_TYPES.indexOf('iron');
  assert.equal(oreTierFactor(iron, 0), 1);
  assert.ok(oreTierFactor(crystal, 0) < 0.1 && oreTierFactor(crystal, 1) === 1);
});

test('shape families follow type and size', () => {
  const count = (type, d) => {
    const fam = new Array(ROCK_FAMILIES.length).fill(0);
    for (let i = 0; i < 4000; i++) fam[pickFamily(type, d, (i + 0.5) / 4000)]++;
    return fam;
  };
  const small = count(NEUTRAL_TYPE, 90);
  const large = count(NEUTRAL_TYPE, 2400);
  assert.ok(small[FAMILY.shard] > large[FAMILY.shard] * 2, 'drobnica to głównie odłamy');
  assert.ok(large[FAMILY.rubble] > small[FAMILY.rubble] * 4, 'duże skały częściej gruzowiskami');
  const ice = count(ROCK_TYPES.indexOf('ice'), 600);
  const titan = count(ROCK_TYPES.indexOf('titan'), 600);
  assert.ok(ice[FAMILY.binary] > titan[FAMILY.binary] * 2, 'lód (komety) częściej podwójny');
  assert.ok(titan[FAMILY.angular] + titan[FAMILY.shard] > ice[FAMILY.angular] + ice[FAMILY.shard], 'tytan blokowy');
  for (let s = 0; s < SHAPE_COUNT; s++) assert.equal(familyOfShape(s), Math.floor(s / SHAPE_VARIANTS));
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  field.forEachRockInRect(BELT_BAND.PLAY, core.x - 6000, core.y - 6000, core.x + 6000, core.y + 6000, 0, (r) => {
    assert.ok(Number.isInteger(r.shape) && r.shape >= 0 && r.shape < SHAPE_COUNT);
  });
});

test('fbm2 stays in [0,1] and REF_DIAMETER matches the play band floor', () => {
  for (let i = 0; i < 2000; i++) {
    const v = fbm2(i * 0.37 - 400, i * 0.11 + 90, 1234, 4);
    assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(REF_DIAMETER, BELT_BANDS[BELT_BAND.PLAY].dMin);
  const regions = buildBeltRegions(BELT_DEFINITIONS, { sunX: 0, sunY: 0, auToWorld: 1000 });
  const main = regions.find((r) => r.beltId === 'main');
  assert.ok(regionPenetration(main, 41_500, 0) > 0);
  assert.ok(regionPenetration(main, 20_000, 0) < 0);
});

test('cache trimming keeps recent cells and bounds memory', () => {
  const { field, au } = makeField();
  const core = findFieldCore(field, au);
  field.forEachRockInRect(BELT_BAND.RUBBLE, core.x - 40000, core.y - 40000, core.x + 40000, core.y + 40000, 0, () => {});
  for (let i = 0; i < 5; i++) field.endFrame(100000);
  const big = field.cacheSize;
  assert.ok(big > 500);
  field.forEachRockInRect(BELT_BAND.PLAY, core.x - 1000, core.y - 1000, core.x + 1000, core.y + 1000, 0, () => {});
  field.endFrame(200);
  assert.ok(field.cacheSize <= 200, `cache ${field.cacheSize} > 200`);
  // Świeżo użyte komórki PLAY zostały.
  const hits = field.stats.cacheHits;
  field.forEachRockInRect(BELT_BAND.PLAY, core.x - 1000, core.y - 1000, core.x + 1000, core.y + 1000, 0, () => {});
  assert.ok(field.stats.cacheHits > hits);
});

// ── Populacje małych ciał (strumień E, 2026-10-12; docs/PLAN-pas-realizm.md § „E: projekt”) ──────────────────

// Pole z danymi kątami planet [°] (gra losuje je przy każdym starcie).
function makeFieldAt(angles, extra = {}) {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3, sunRadius: 823,
    angleFor: (def) => (angles[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  const field = new AsteroidBeltField({ planets, sunX: SUN.x, sunY: SUN.y, auToWorld: auInWorldUnits, ...extra });
  return { field, au: auInWorldUnits, planets };
}
// Średnia gęstość PLAY na okręgu rAu (n kątów, opcjonalnie wycinek [a0, a1] rad).
function ringDensity(field, au, rAu, n = 720, a0 = 0, a1 = Math.PI * 2) {
  let d = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n;
    d += field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au).density;
  }
  return d / n;
}

test('world scale stays tied to the Kuiper edge (140 AU)', () => {
  assert.equal(getOutermostBeltEdgeAu(BELT_DEFINITIONS), 140);
  const kuiper = BELT_DEFINITIONS.find((b) => b.id === 'kuiper');
  assert.equal(kuiper.innerAU, 125);
  assert.equal(kuiper.outerAU, 140);
});

test('main belt and Hildas between 37.5 and 45.5 AU are bit-identical to the belt without population fields', () => {
  // Olbrzymy szukają rdzeni w tym paśmie gęstością pola (remisy) — każda zmiana gęstości przestawiłaby je.
  const strip = (b) => {
    const { edgeInAU, profile, densityMul, fieldMul, holes, avoid, overlay, angLeadDeg, angTrailDeg, angCoreDeg, angEnd, bananaK, edgeAU, ...rest } = b;
    return b.id === 'main' ? { ...rest, innerAU: 36 } : rest;
  };
  const oldDefs = BELT_DEFINITIONS.filter((b) => ['main', 'greeks', 'trojans', 'hildas', 'kuiper'].includes(b.id)).map(strip);
  const angles = { jupiter: 250, mars: 120, earth: 330, neptune: 40 };
  const { field, au } = makeFieldAt(angles);
  const { field: old } = makeFieldAt(angles, { beltDefs: oldDefs });
  for (let i = 0; i < 6000; i++) {
    const rAu = 37.5 + 8 * ((hash32(i, 1) % 10000) / 10000);
    const a = (hash32(i, 2) % 100000) / 100000 * Math.PI * 2;
    const x = SUN.x + Math.cos(a) * rAu * au;
    const y = SUN.y + Math.sin(a) * rAu * au;
    const m = { ...field.sampleMacro(x, y) };
    const o = old.sampleMacro(x, y);
    assert.equal(m.density, o.density, `${rAu.toFixed(3)} AU`);
    assert.equal(m.cluster, o.cluster);
    // region poza pasem (obwiednia 0) = najgłębsze wniknięcie — zależy od geometrii Trojańczyków; nieistotny
    if (o.density > 0) assert.equal(m.region?.beltId, o.region?.beltId);
  }
});

test('belt machinery never wakes at the K-7 halls; no rocks around Earth and Mars ports', async () => {
  const { k7HallCenter } = await import('../src/game/story/k7Dock.js');
  const W = 1920, H = 1080, focal = (H * 0.5) / Math.tan(17.5 * Math.PI / 180);
  // jak AsteroidBelt._viewTouchesBelt (paralaksa najgłębszego pasma tła)
  const touches = (field, x, y, zoom) => {
    const camZ = focal / zoom, spread = (camZ + 26000) / camZ;
    const hw = W * 0.5 / zoom * spread * 1.3, hh = H * 0.5 / zoom * spread * 1.3;
    return field.rectTouchesBelt(x - hw, y - hh, x + hw, y + hh);
  };
  for (let k = 0; k < 12; k++) {
    const { field, planets } = makeFieldAt({ earth: k * 30, mars: 15 + k * 30, jupiter: 250, neptune: 7 * k });
    for (const id of ['earth', 'mars']) {
      const pl = planets.find((p) => p.id === id);
      for (let c = 0; c < 4; c++) {
        const h = k7HallCenter(pl, c);
        for (const zoom of [0.45, 0.07]) assert.equal(touches(field, h.x, h.y, zoom), false, `${id} K-7 ${c} zoom ${zoom} (k=${k})`);
        if (id === 'earth') assert.equal(touches(field, h.x, h.y, 0.02), false, `Ziemia K-7 ${c} zoom 0,02`);
      }
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2;
        // Mars: pas główny (35,5) zaczyna się 106 tys. j. za jego orbitą — sprawdzamy port i studnię.
        for (const d of (id === 'earth' ? [20000, 60000, 110000] : [20000, 60000])) {
          assert.equal(field.densityAt(pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d), 0, `${id} ${d} j.`);
        }
      }
    }
  }
});

test('NEA: sparse single rocks around Earth orbit, no dense fields, Hungarias cut off from the main belt', () => {
  const { field, au } = makeFieldAt({ jupiter: 250, earth: 330, mars: 120 });
  const main = ringDensity(field, au, 38.2);
  const nea = ringDensity(field, au, 26.5);
  assert.ok(nea > 0 && nea < main * 0.25, `NEA ${nea} vs pas ${main}`);
  assert.equal(ringDensity(field, au, 20), 0);
  assert.equal(ringDensity(field, au, 32), 0);
  assert.ok(ringDensity(field, au, 22.5) < nea * 0.6, 'wewnątrz orbity Ziemi rzadziej (Ateny, Atiry)');
  for (let i = 0; i < 2000; i++) {
    const a = i / 2000 * Math.PI * 2;
    assert.equal(field.sampleMacro(SUN.x + Math.cos(a) * 26.5 * au, SUN.y + Math.sin(a) * 26.5 * au).cluster, 0, 'NEA bez gęstych pól');
  }
  const hung = ringDensity(field, au, 34.65);
  const gap = ringDensity(field, au, 35.25);
  assert.ok(hung > 0 && hung < main, `Hungarie ${hung}`);
  assert.ok(gap < hung * 0.15, `przesmyk 35,25 AU ${gap} vs Hungarie ${hung}`);
  const m = field.sampleMacro(SUN.x + 34.65 * au, SUN.y);
  assert.ok(['hungarias', 'main'].includes(m.region?.beltId));
});

test('Trojans: wide tadpole swarms with L4 : L5 ≈ 1.64, asymmetric away from Jupiter', () => {
  const { field, au } = makeFieldAt({ jupiter: 250 });
  const ja = 250 * Math.PI / 180;
  // Obwiednia (weight) — gęste pola to szum, który w jednym roju trafia inaczej niż w drugim.
  const sw = (deg0, deg1) => {
    let d = 0;
    let n = 0;
    for (let rAu = 47.5; rAu <= 53; rAu += 0.25) {
      for (let i = 0; i < 160; i++) {
        const a = ja + (deg0 + (deg1 - deg0) * (i + 0.5) / 160) * Math.PI / 180;
        d += field.sampleMacro(SUN.x + Math.cos(a) * rAu * au, SUN.y + Math.sin(a) * rAu * au).weight;
        n++;
      }
    }
    return d / n;
  };
  const l4 = sw(20, 110);
  const l5 = sw(-110, -20);
  assert.ok(Math.abs(l4 / l5 - 1.64) < 0.08, `L4/L5 ${l4 / l5}`);
  // rój sięga kilkadziesiąt stopni od punktu L, dalej od Jowisza niż ku niemu
  assert.ok(ringDensity(field, au, 50.2, 40, ja + 95 * Math.PI / 180, ja + 100 * Math.PI / 180) > 0, 'L4 +40° od L');
  assert.ok(ringDensity(field, au, 50.2, 40, ja + 18 * Math.PI / 180, ja + 22 * Math.PI / 180) === 0, 'przy Jowiszu pusto');
  assert.ok(ringDensity(field, au, 50.2, 40, ja + 115 * Math.PI / 180, ja + 120 * Math.PI / 180) === 0, 'za końcem łuku pusto');
});

test('Kuiper: plutinos avoid Neptune, nu8 gap, cold classical core, cliff at 137.5', () => {
  const { field, au } = makeFieldAt({ jupiter: 250, neptune: 40 });
  const na = 40 * Math.PI / 180;
  const plutNear = ringDensity(field, au, 127, 120, na - 0.3, na + 0.3);
  const plutFar = ringDensity(field, au, 127, 120, na + 2, na + 3);
  assert.ok(plutNear < plutFar * 0.3, `plutonki przy Neptunie ${plutNear} vs daleko ${plutFar}`);
  const gap = ringDensity(field, au, 129.3);
  const classical = ringDensity(field, au, 131.2);
  const core = ringDensity(field, au, 133.5);
  const scattered = ringDensity(field, au, 139);
  assert.ok(gap < classical * 0.3, `przerwa ν8 ${gap} vs klasyczny ${classical}`);
  assert.ok(core > classical, 'zimny rdzeń gęstszy');
  assert.ok(scattered < core * 0.15, `urwisko: rozproszony ${scattered} vs rdzeń ${core}`);
  assert.ok(scattered > 0, 'dysk rozproszony do 140');
  const m = field.sampleMacro(SUN.x + Math.cos(na + 2.5) * 127 * au, SUN.y + Math.sin(na + 2.5) * 127 * au);
  assert.equal(m.region?.beltId, 'plutinos');
  assert.equal(m.ice, 1);
});

// ---------------------------------------------------------------------------
// A1 (2026-10-12): typy z widm planetoid (C, M, V, D, platynowce) i skład zmienny z odległością
// od Słońca — docs/PLAN-pas-realizm.md § Typy. Jowisz w makeField: 250°.

const A1_JUPITER = 250 * Math.PI / 180;

/** Udziały rud (_pickType, głębokość 1) na okręgu rAu — średnia po kątach zmywa prowincje. */
function a1OreShares(field, au, rAu, a0 = 0, a1 = Math.PI * 2, n = 2400) {
  const counts = new Map();
  const belts = new Map();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n;
    const x = SUN.x + Math.cos(a) * rAu * au;
    const y = SUN.y + Math.sin(a) * rAu * au;
    const region = field.sampleMacro(x, y).region;
    if (!region) continue;
    belts.set(region.beltId, (belts.get(region.beltId) || 0) + 1);
    const t = ROCK_TYPES[field._pickType(region, x, y, (hash32(i, 11) % 10007) / 10007, 1)];
    counts.set(t, (counts.get(t) || 0) + 1);
    total++;
  }
  const share = (id) => (counts.get(id) || 0) / Math.max(1, total);
  const top = [...counts.entries()].sort((p, q) => q[1] - p[1]).map(([k]) => k);
  const belt = [...belts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
  return { share, top, belt, total };
}

/** Udział odmiany węglowej wśród wypełniacza (_pickRockType na głębokości 0 — obrzeże). */
function a1DarkFiller(field, au, rAu, a0 = 0, a1 = Math.PI * 2, n = 600) {
  let dark = 0;
  let all = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n;
    const x = SUN.x + Math.cos(a) * rAu * au;
    const y = SUN.y + Math.sin(a) * rAu * au;
    const region = field.sampleMacro(x, y).region;
    if (!region) continue;
    for (let k = 0; k < 8; k++) {
      const t = field._pickRockType(region, x, y, (k + 0.5) / 8, 0, 0, true);
      if (!isNeutralType(t)) continue;
      all++;
      if (t === NEUTRAL_CARBON_TYPE) dark++;
    }
  }
  return dark / Math.max(1, all);
}

test('A1: every belt composition names known ore types; spectral types sit after energy', () => {
  for (const id of ['carbon', 'metal', 'basalt', 'primitive', 'platinum']) {
    assert.ok(ORE_ROCK_TYPES.includes(id), id);
    assert.ok(ROCK_TYPE_INDEX[id] > ROCK_TYPE_INDEX.energy, `${id} po energy`);
  }
  assert.ok(!ORE_ROCK_TYPES.includes('rock') && !ORE_ROCK_TYPES.includes('rock_c') && !ORE_ROCK_TYPES.includes('energy'));
  assert.ok(ROCK_TYPES.length < 256, 'klucz szablonów minerałów: kształt · 256 + typ');
  for (const belt of BELT_DEFINITIONS) {
    const stops = Array.isArray(belt.types) ? belt.types : [{ ore: belt.types || {} }];
    for (const s of stops) {
      for (const id of Object.keys(s.ore || {})) assert.ok(ORE_ROCK_TYPES.includes(id), `${belt.id}: nieznany typ ${id}`);
      if (s.dark !== undefined) assert.ok(s.dark >= 0 && s.dark <= 1, `${belt.id}: dark ${s.dark}`);
    }
  }
});

test('A1: main belt goes S (with Vesta V) inside → S + C with M in the middle → C outside', () => {
  // Gradient TŁA (przystanki `types`); pola mają skład rodzin (A2 — testy niżej), więc tu pole bez rodzin.
  const { field, au } = makeField({ families: [] });
  const inner = a1OreShares(field, au, 36.0);
  const vesta = a1OreShares(field, au, 36.9);
  const mid = a1OreShares(field, au, 38.6);
  const outer = a1OreShares(field, au, 40.8);
  for (const s of [inner, vesta, mid, outer]) assert.equal(s.belt, 'main');
  assert.equal(inner.top[0], 'silicon', `wewnątrz: ${inner.top.slice(0, 4)}`);
  assert.ok(inner.share('silicon') > 4 * inner.share('carbon'), `S ≫ C wewnątrz (${inner.share('silicon').toFixed(2)} / ${inner.share('carbon').toFixed(2)})`);
  assert.ok(vesta.share('basalt') >= 0.12, `rodzina Westy: bazalt ${vesta.share('basalt').toFixed(3)}`);
  assert.ok(vesta.share('basalt') > 2 * outer.share('basalt'));
  assert.ok(mid.share('metal') >= 0.1, `środek: M ${mid.share('metal').toFixed(3)}`);
  assert.ok(mid.share('metal') > inner.share('metal') && mid.share('metal') > outer.share('metal'), 'szczyt M w środku pasa');
  assert.ok(mid.share('carbon') >= 0.15 && mid.share('silicon') >= 0.12, 'środek: S + C');
  assert.equal(outer.top[0], 'carbon', `na zewnątrz: ${outer.top.slice(0, 4)}`);
  assert.ok(outer.share('carbon') >= 0.35 && outer.share('silicon') < 0.15, `C dominuje na zewnątrz (${outer.share('carbon').toFixed(2)})`);
  // Platynowce: tylko śladowo i tylko tam, gdzie M (szczebel 2 — w rdzeniach pól).
  assert.ok(mid.share('platinum') > 0 && mid.share('platinum') < 0.08);
  assert.equal(inner.share('platinum'), 0);
  // Uran tylko w Kuiperze (decyzja użytkownika).
  for (const s of [inner, vesta, mid, outer]) assert.equal(s.share('uran'), 0);
  // Śladowa domieszka (< provinceMinWeight) nie staje się rudą prowincji: lód 1% w środku pasa.
  assert.ok(mid.share('ice') < 0.03, `lód w środku pasa ${mid.share('ice').toFixed(3)}`);
  // C z lodem w rdzeniach (A2): dopiero za linią śniegu (~38,5 AU mapy), na zewnątrz mniej niż zwykłej C.
  for (const s of [inner, vesta, mid]) assert.equal(s.share('carbon_ice'), 0);
  assert.ok(outer.share('carbon_ice') > 0.02 && outer.share('carbon_ice') < 0.5 * outer.share('carbon'),
    `na zewnątrz: C z lodem ${outer.share('carbon_ice').toFixed(3)}`);
});

test('A1: Hildas and Trojans are primitive (D), not metallic; Kuiper is ice, D, crystal and uranium', () => {
  const { field, au } = makeField();
  const hildas = a1OreShares(field, au, 44.4, A1_JUPITER + Math.PI - 0.1, A1_JUPITER + Math.PI + 0.1, 800);
  const l4 = a1OreShares(field, au, 50.2, A1_JUPITER + Math.PI / 3 - 0.1, A1_JUPITER + Math.PI / 3 + 0.1, 800);
  const kuiper = a1OreShares(field, au, 132);
  assert.equal(hildas.belt, 'hildas');
  for (const [name, s] of [['Hildy', hildas], ['Trojańczycy L4', l4]]) {
    assert.ok(s.total > 100, `${name}: próbki ${s.total}`);
    assert.ok(s.share('primitive') + s.share('carbon') >= 0.6, `${name}: D + C ${(s.share('primitive') + s.share('carbon')).toFixed(2)}`);
    for (const metal of ['iron', 'copper', 'titan', 'uran']) assert.equal(s.share(metal), 0, `${name}: bez ${metal}`);
  }
  assert.ok(l4.share('primitive') > l4.share('carbon'), 'Trojańczycy: D przed C');
  assert.equal(kuiper.top[0], 'ice');
  assert.ok(kuiper.share('primitive') > 0.1 && kuiper.share('uran') > 0, `Kuiper: D ${kuiper.share('primitive').toFixed(2)}, uran ${kuiper.share('uran').toFixed(3)}`);
  for (const t of ['iron', 'copper', 'silicon', 'titan']) assert.equal(kuiper.share(t), 0, `Kuiper bez ${t}`);
});

test('A1: neutral filler darkens outward (stony inside, carbonaceous outside and beyond)', () => {
  const { field, au } = makeField();
  const inner = a1DarkFiller(field, au, 36.0);
  const mid = a1DarkFiller(field, au, 39.1);
  const outer = a1DarkFiller(field, au, 41.3);
  assert.equal(inner, 0, 'wewnątrz kamienny');
  assert.ok(mid > 0.45 && mid < 0.85, `39,1 AU: ${mid.toFixed(2)}`);
  assert.ok(outer >= 0.85, `41,3 AU: ${outer.toFixed(2)}`);
  const hildas = a1DarkFiller(field, au, 44.4, A1_JUPITER + Math.PI - 0.1, A1_JUPITER + Math.PI + 0.1, 200);
  const kuiper = a1DarkFiller(field, au, 132, 0, Math.PI * 2, 200);
  assert.ok(hildas > 0.95 && kuiper > 0.95, `Hildy ${hildas.toFixed(2)}, Kuiper ${kuiper.toFixed(2)}`);
});

test('A1: composition never moves rocks — same ids, positions and sizes as with a flat old composition', () => {
  const flatTypes = { iron: 0.30, silicon: 0.28, copper: 0.20, titan: 0.15, crystal: 0.07 };
  const flat = BELT_DEFINITIONS.map((b) => ({ ...b, types: flatTypes }));
  const { field: a, au } = makeField();
  const { field: b } = makeField({ beltDefs: flat });
  for (const rAu of [36.4, 38.6, 40.6]) {
    const x = SUN.x + rAu * au;
    const y = SUN.y;
    const ra = [];
    const rb = [];
    a.forEachRockInRect(BELT_BAND.PLAY, x - 30000, y - 30000, x + 30000, y + 30000, 0, (r) => ra.push(`${r.id}:${r.x.toFixed(3)}:${r.y.toFixed(3)}:${r.r.toFixed(3)}`));
    b.forEachRockInRect(BELT_BAND.PLAY, x - 30000, y - 30000, x + 30000, y + 30000, 0, (r) => rb.push(`${r.id}:${r.x.toFixed(3)}:${r.y.toFixed(3)}:${r.r.toFixed(3)}`));
    assert.ok(ra.length > 0, `${rAu} AU: są skały`);
    assert.deepEqual(ra, rb, `${rAu} AU: te same skały`);
  }
});

// ---------------------------------------------------------------------------
// A2 (2026-10-12): pole = rodzina kolizyjna (src/data/asteroidFamilies.js; AsteroidBeltField.familyAt,
// familyPeaks, setSmallBodyAnchors) — docs/PLAN-pas-realizm.md § A2.

const { ASTEROID_FAMILIES, REGION_FAMILIES, familyTitle } = await import('../src/data/asteroidFamilies.js');
const { SMALL_BODY_BY_ID, smallBodyPosition } = await import('../src/data/smallBodies.js');
const { planBeltGiantSites } = await import('../src/game/asteroidBeltGiants.js');
const { readFileSync } = await import('node:fs');

/** Punkty gęstych pól pasa głównego (cluster ≥ minCluster) na siatce okręgów, z rodziną. */
function a2FieldSamples(field, au, minCluster = 0.4) {
  const out = [];
  for (let i = 0; i < 720; i++) {
    for (let k = 0; k < 25; k++) {
      const rAu = 35.6 + k * 0.25;
      const a = (i / 720) * Math.PI * 2;
      const x = SUN.x + Math.cos(a) * rAu * au;
      const y = SUN.y + Math.sin(a) * rAu * au;
      const m = field.sampleMacro(x, y);
      if (m.region?.beltId !== 'main' || m.cluster < minCluster) continue;
      out.push({ x, y, rAu, a, region: m.region, fam: field.familyAt(x, y) });
    }
  }
  return out;
}

test('A2: every dense field of the main belt belongs to a family; all nine families have fields', () => {
  const { field, au } = makeField();
  assert.equal(ASTEROID_FAMILIES.length, 9);
  const samples = a2FieldSamples(field, au);
  assert.ok(samples.length > 500, `próbki pól ${samples.length}`);
  const withFam = samples.filter((s) => s.fam).length;
  assert.ok(withFam / samples.length >= 0.97, `pola z rodziną ${(withFam / samples.length).toFixed(3)}`);
  const peaks = field.familyPeaks();
  for (let fi = 0; fi < field.families.length; fi++) {
    assert.ok(peaks.some((p) => p.fam === fi), `${field.families[fi].id}: ma pole`);
    assert.ok(samples.some((s) => s.fam === field.families[fi]), `${field.families[fi].id}: próbki w polu`);
  }
  // Nazwa dla gracza
  assert.equal(familyTitle(ASTEROID_FAMILIES.find((f) => f.id === 'themis')), 'Rodzina Themis · węglowe, lód');
  // Roje przy Jowiszu są „rodziną” regionu, Kuiper — bez rodziny
  const ja = A1_JUPITER + Math.PI;
  assert.equal(field.familyAt(SUN.x + Math.cos(ja) * 44.4 * au, SUN.y + Math.sin(ja) * 44.4 * au), REGION_FAMILIES.hildas);
  assert.equal(field.familyAt(SUN.x + 132 * au, SUN.y), null);
  assert.equal(field.regions.find((r) => r.beltId === 'main').familyRegion, 'main');
  assert.equal(field.regions.find((r) => r.beltId === 'kuiper').familyRegion, null);
});

test('A2: the parent type dominates the ores of a family field', () => {
  const { field, au } = makeField();
  const samples = a2FieldSamples(field, au, 0.4);
  const want = {
    vesta: ['basalt', 0.4], themis: ['carbon', 0.45], hygiea: ['carbon', 0.55], veritas: ['carbon', 0.55],
    koronis: ['silicon', 0.4], flora: ['silicon', 0.4], eunomia: ['silicon', 0.35], eos: ['metal', 0.2]
  };
  for (const [id, [type, min]] of Object.entries(want)) {
    const pts = samples.filter((s) => s.fam?.id === id);
    assert.ok(pts.length > 0, `${id}: punkty pola`);
    let hit = 0;
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let k = 0; k < 6; k++) {
        const t = ROCK_TYPES[field._pickType(pts[i].region, pts[i].x, pts[i].y, ((hash32(i, k, 3) % 10007) + 0.5) / 10007, 1)];
        if (t === type || (type === 'carbon' && t === 'carbon_ice')) hit++;
        n++;
      }
    }
    assert.ok(hit / n >= min, `${id}: ${type} ${(hit / n).toFixed(2)} ≥ ${min}`);
  }
  // Themis — „węglowe, lód”: dużo C z lodem w rdzeniach (typ carbon_ice), w Hygiei i Veritas śladowo.
  const iceShare = (id) => {
    const pts = samples.filter((s) => s.fam?.id === id);
    let hit = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let k = 0; k < 6; k++) {
        if (ROCK_TYPES[field._pickType(pts[i].region, pts[i].x, pts[i].y, ((hash32(i, k, 7) % 10007) + 0.5) / 10007, 1)] === 'carbon_ice') hit++;
      }
    }
    return hit / Math.max(1, pts.length * 6);
  };
  const themisIce = iceShare('themis');
  assert.ok(themisIce >= 0.15, `themis: C z lodem ${themisIce.toFixed(2)}`);
  assert.ok(iceShare('hygiea') < 0.5 * themisIce && iceShare('veritas') < 0.5 * themisIce, 'C z lodem — znak rodziny Themis');
  // Nysa-Polana: S + C
  const ny = samples.filter((s) => s.fam?.id === 'nysa');
  let sc = 0;
  for (let i = 0; i < ny.length; i++) {
    const t = ROCK_TYPES[field._pickType(ny[i].region, ny[i].x, ny[i].y, ((hash32(i, 9) % 10007) + 0.5) / 10007, 1)];
    if (t === 'silicon' || t === 'carbon') sc++;
  }
  assert.ok(sc / Math.max(1, ny.length) >= 0.5, `nysa: S + C ${(sc / ny.length).toFixed(2)}`);
});

test('A2: Vesta and Hygiea families sit at their bodies and follow the bodies (setSmallBodyAnchors)', () => {
  const { field, au } = makeField();
  const at = (id, angles) => smallBodyPosition(SMALL_BODY_BY_ID[id], SUN, au, { x: 0, y: 0 }, angles);
  for (const id of ['vesta', 'hygiea']) {
    const p = at(id);
    // tuż obok ciała (poza wyłączeniem skał) — rodzina ciała, także w rzadkim pasie
    for (const [dx, dy] of [[4000, 0], [0, -6000], [-5000, 3000]]) {
      assert.equal(field.familyAt(p.x + dx, p.y + dy)?.id, id, `${id} (${dx}, ${dy})`);
    }
    // szczyt pola z kotwicą tej rodziny leży blisko ciała (łuk ≤ maxArcDeg, |Δr| ≤ maxDr)
    const fi = field.families.findIndex((f) => f.id === id);
    const peak = field.familyPeaks().find((q) => q.fam === fi && q.anchored);
    assert.ok(peak, `${id}: pole przy ciele`);
    const bodyAng = Math.atan2(p.y - SUN.y, p.x - SUN.x);
    const da = Math.abs(Math.atan2(Math.sin(peak.ang - bodyAng), Math.cos(peak.ang - bodyAng))) * 180 / Math.PI;
    assert.ok(da <= field.familyConfig.anchorClaim.maxArcDeg, `${id}: łuk ${da.toFixed(1)}°`);
    assert.ok(Math.abs(peak.rAu - SMALL_BODY_BY_ID[id].orbitAU) <= field.familyConfig.anchorClaim.maxDr);
  }
  // Ciało przestawione (inny świat gry) — rodzina idzie za nim
  const moved = { vesta: SMALL_BODY_BY_ID.vesta.angle + 2.2, hygiea: SMALL_BODY_BY_ID.hygiea.angle - 1.7 };
  const anchors = ['vesta', 'hygiea'].map((id) => ({ id, ...at(id, moved) }));
  field.setSmallBodyAnchors(anchors);
  for (const a of anchors) {
    assert.equal(field.familyAt(a.x + 4000, a.y)?.id, a.id, `${a.id} po przestawieniu`);
    const old = at(a.id);
    assert.notEqual(field.familyAt(old.x + 4000, old.y)?.id, a.id, `${a.id}: stare miejsce bez kotwicy`);
  }
});

test('A2: families change composition only — rocks and giant sites are the same as without families', () => {
  const { field: a, au } = makeField();
  const { field: b } = makeField({ families: [] });
  const ga = planBeltGiantSites(a, { sunX: SUN.x, sunY: SUN.y, au, cfg: BELT_GIANTS_CONFIG }).map((g) => [Math.round(g.x), Math.round(g.y)]);
  const gb = planBeltGiantSites(b, { sunX: SUN.x, sunY: SUN.y, au, cfg: BELT_GIANTS_CONFIG }).map((g) => [Math.round(g.x), Math.round(g.y)]);
  assert.deepEqual(ga, gb, 'olbrzymy w tych samych miejscach');
  const core = findFieldCore(a, au);
  const ra = [];
  const rb = [];
  a.forEachRockInRect(BELT_BAND.PLAY, core.x - 30000, core.y - 30000, core.x + 30000, core.y + 30000, 0, (r) => ra.push(`${r.id}:${r.x.toFixed(3)}:${r.y.toFixed(3)}:${r.r.toFixed(3)}`));
  b.forEachRockInRect(BELT_BAND.PLAY, core.x - 30000, core.y - 30000, core.x + 30000, core.y + 30000, 0, (r) => rb.push(`${r.id}:${r.x.toFixed(3)}:${r.y.toFixed(3)}:${r.r.toFixed(3)}`));
  assert.ok(ra.length > 50);
  assert.deepEqual(ra, rb);
});

test('A2: exposed white ice is at most a trace in the main belt (water sits in C and D)', () => {
  const { field, au } = makeField();
  const samples = a2FieldSamples(field, au, 0.2);
  let ice = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = ROCK_TYPES[field._pickType(samples[i].region, samples[i].x, samples[i].y, ((hash32(i, 5) % 10007) + 0.5) / 10007, 1)];
    if (t === 'ice') ice++;
    n++;
  }
  assert.ok(ice / n <= 0.03, `lód w polach pasa głównego ${(ice / n).toFixed(3)}`);
  // Tło (rzadki pas, bez rodzin) na zewnątrz pasa też ≤ 3%
  const { field: bare } = makeField({ families: [] });
  for (const rAu of [39.1, 40.5, 41.3]) {
    const s = a1OreShares(bare, au, rAu, 0, Math.PI * 2, 1200);
    assert.ok(s.share('ice') <= 0.035, `${rAu} AU: lód ${s.share('ice').toFixed(3)}`);
  }
});

test('A2: family assignment is deterministic, query-order independent and the field module stays pure', () => {
  const { field: a, au } = makeField();
  const { field: b } = makeField();
  const pts = a2FieldSamples(a, au, 0.3).filter((_, i) => i % 7 === 0);
  const fa = pts.map((p) => a.familyAt(p.x, p.y)?.id || null);
  const fb = [...pts].reverse().map((p) => b.familyAt(p.x, p.y)?.id || null).reverse();
  assert.deepEqual(fa, fb);
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const path of ['src/game/asteroidBeltField.js', 'src/data/asteroidFamilies.js']) {
    const src = strip(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(src, /\bwindow\b|\bdocument\b/, `${path}: bez window / document`);
  }
});
