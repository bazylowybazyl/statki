import test from 'node:test';
import assert from 'node:assert/strict';
import { AsteroidBeltField } from '../src/game/asteroidBeltField.js';
import { FieldSunOcclusion, FIELD_LIGHT_CONFIG } from '../src/game/asteroidFieldLight.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import { buildSystemMap } from '../src/data/systemMap.js';

const SUN = { x: 6_000_000, y: 6_000_000 };

function makeField() {
  const { planets, auInWorldUnits } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    planetScale: 3,
    sunRadius: 823,
    angleFor: (def) => ({ jupiter: 250 }[def.id] ?? 0) * Math.PI / 180
  });
  for (const p of planets) {
    p.x = SUN.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = SUN.y + Math.sin(p.angle) * p.orbitRadius;
  }
  const field = new AsteroidBeltField({ planets, sunX: SUN.x, sunY: SUN.y, auToWorld: auInWorldUnits });
  return { field, au: auInWorldUnits };
}

// Kąt i promień rdzenia pola w Main Belt (deterministycznie po siatce).
function findCore(field, au) {
  let best = null;
  for (let i = 0; i < 3000; i++) {
    const a = (i / 3000) * Math.PI * 2;
    for (const rAu of [39, 40.5, 42, 43.5]) {
      const x = SUN.x + Math.cos(a) * rAu * au;
      const y = SUN.y + Math.sin(a) * rAu * au;
      const m = field.sampleMacro(x, y);
      if (!best || m.cluster > best.cluster) best = { a, rAu, cluster: m.cluster };
    }
  }
  return best;
}

function radialProfile(occ, field, a, rAu0, rAu1, au, steps = 120) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const rAu = rAu0 + (rAu1 - rAu0) * (i / steps);
    const x = SUN.x + Math.cos(a) * rAu * au;
    const y = SUN.y + Math.sin(a) * rAu * au;
    out.push({ rAu, T: occ.transmittance(x, y), cluster: field.sampleMacro(x, y).cluster });
  }
  return out;
}

test('sunlight is untouched away from the belts', () => {
  const { field, au } = makeField();
  const occ = new FieldSunOcclusion(field);
  assert.equal(occ.transmittance(SUN.x + 10 * au, SUN.y), 1, 'wewnętrzny układ');
  assert.equal(occ.transmittance(SUN.x + 95 * au, SUN.y - 3 * au), 1, 'między pasami, za odbudową');
  assert.equal(occ.transmittance(SUN.x, SUN.y), 1, 'samo słońce');
});

test('entering a dense field from the sun side is bright, deeper is darker', () => {
  const { field, au } = makeField();
  const occ = new FieldSunOcclusion(field);
  const core = findCore(field, au);
  assert.ok(core.cluster > 0.8, 'jest gęsty rdzeń');
  const prof = radialProfile(occ, field, core.a, 35, 49, au);
  // Pierwsza próbka w polu (pole > 0,3) po stronie słońca — nadal jasno.
  const firstIn = prof.findIndex((p) => p.cluster > 0.3);
  assert.ok(firstIn > 0, 'profil wchodzi w pole');
  assert.ok(prof[firstIn].T > 0.7, `wejście od słońca jasne: T = ${prof[firstIn].T.toFixed(3)}`);
  // W gęstym rdzeniu T nie skacze w górę. Tam, gdzie pole trochę rzednie,
  // światło może lekko wracać (odbudowa wygrywa ze słabszą ekstynkcją) — to
  // zamierzone, więc tylko bez wyraźnych skoków.
  let minT = 1;
  for (let i = firstIn + 1; i < prof.length; i++) {
    if (prof[i].cluster > 0.75 && prof[i - 1].cluster > 0.75) {
      assert.ok(prof[i].T <= prof[i - 1].T + 0.03, `w głąb rdzenia nie jaśnieje skokowo (${prof[i].rAu.toFixed(2)} AU)`);
    }
    minT = Math.min(minT, prof[i].T);
  }
  assert.ok(minT < 0.3, `głęboko w rdzeniu ciemno: min T = ${minT.toFixed(3)}`);
});

test('light recovers behind the field instead of casting a shadow across the system', () => {
  const { field, au } = makeField();
  const occ = new FieldSunOcclusion(field);
  const core = findCore(field, au);
  // Daleko za pasem (poza oknem odbudowy — łuki Trojańczyków sięgają ~70 AU) — pełne słońce.
  const far = occ.transmittance(SUN.x + Math.cos(core.a) * 80 * au, SUN.y + Math.sin(core.a) * 80 * au);
  assert.equal(far, 1);
  // Za zewnętrzną krawędzią pasa światło rośnie z odległością.
  const t1 = occ.transmittance(SUN.x + Math.cos(core.a) * 49 * au, SUN.y + Math.sin(core.a) * 49 * au);
  const t2 = occ.transmittance(SUN.x + Math.cos(core.a) * 55 * au, SUN.y + Math.sin(core.a) * 55 * au);
  assert.ok(t2 >= t1, `odbudowa za polem: ${t1.toFixed(3)} → ${t2.toFixed(3)}`);
});

test('sectors are built lazily and cached with a bounded count', () => {
  const { field, au } = makeField();
  const occ = new FieldSunOcclusion(field, { maxSectors: 4 });
  const x = SUN.x + 41 * au;
  const y = SUN.y;
  occ.transmittance(x, y);
  const built = occ.stats.sectorsBuilt;
  assert.ok(built >= 1 && built <= 2);
  for (let i = 0; i < 50; i++) occ.transmittance(x + i * 50, y + i * 30);
  assert.equal(occ.stats.sectorsBuilt, built, 'pobliskie zapytania z cache');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    occ.transmittance(SUN.x + Math.cos(a) * 41 * au, SUN.y + Math.sin(a) * 41 * au);
  }
  assert.ok(occ._sectors.size <= 5, `cache sektorów ograniczony: ${occ._sectors.size}`);
  assert.ok(occ.isReady(SUN.x + Math.cos(11 / 12 * Math.PI * 2) * 41 * au, SUN.y + Math.sin(11 / 12 * Math.PI * 2) * 41 * au));
});

test('scene map texels match transmittance at the flipped-y world point', () => {
  const { field, au } = makeField();
  const occ = new FieldSunOcclusion(field);
  const core = findCore(field, au);
  const cx = SUN.x + Math.cos(core.a) * core.rAu * au;
  const cy = SUN.y + Math.sin(core.a) * core.rAu * au;
  const w = 80000;
  const h = 60000;
  // Prostokąt w układzie sceny: x jak świat, y = −świat.
  const x0 = cx - w / 2;
  const y0 = -cy - h / 2;
  const nx = 16;
  const ny = 12;
  const map = occ.buildSceneMap(x0, y0, w, h, nx, ny);
  for (const [i, j] of [[0, 0], [15, 0], [7, 5], [0, 11], [15, 11]]) {
    const xs = x0 + (i + 0.5) * (w / nx);
    const ys = y0 + (j + 0.5) * (h / ny);
    const T = occ.transmittance(xs, -ys);
    assert.ok(Math.abs(map[j * nx + i] - Math.round(T * 255)) <= 1, `teksel ${i},${j}`);
  }
  assert.ok(FIELD_LIGHT_CONFIG.recovery > 0);
});
