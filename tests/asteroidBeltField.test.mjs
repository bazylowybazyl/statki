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
  pickFamily, familyOfShape, oreShareAtDepth, oreTierFactor
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
    'main:ring', 'greeks:arc', 'trojans:arc', 'hildas:arc', 'hildas:arc', 'hildas:arc', 'kuiper:ring'
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
  const inner = 36 * au;
  const samples = [];
  for (let dAu = -1.5; dAu <= 2.5; dAu += 0.25) samples.push(field.sampleMacro(SUN.x + inner + dAu * au, SUN.y).weight);
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
  // Kuiper: lód, kryształ, krzem, uran, tytan (indeksy 5, 4, 2, 6, 3) — bez żelaza i miedzi.
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
      if (r.type === NEUTRAL_TYPE) zone.neutral++;
      if (ROCK_TYPES[r.type] === 'crystal' || ROCK_TYPES[r.type] === 'uran') zone.rare++;
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
  // 7 rud + neutralna (7) + energetyczna (8, tylko z burz — asteroidStorms.js).
  assert.equal(ROCK_TYPES.length, 9);
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
