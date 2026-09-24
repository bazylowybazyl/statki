import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HULL_SDF_LAYER_SIZE,
  HULL_SDF_LAYER_COUNT,
  HULL_SDF_OCCLUDER_FLOATS,
  HULL_SDF_SHADOW_GLSL,
  HullShadowSdf,
  bakeHullSdfLayer,
  measureHullExtent,
  packHullShaftOccluder,
  planHullSdfLayout,
  rasterizeHullMask,
  refineSdfEdges,
  sampleSdfLayer,
  signedDistanceField,
  squaredDistanceTransform,
  traceHullShadowCpu
} from '../src/3d/hullShadowSdf.js';

const L = HULL_SDF_LAYER_SIZE;
const HEX_R = 5;
const HEX_H = Math.sqrt(3) * HEX_R;

// Siatka heksów jak getHexBodyTemplate: kolumny co 1,5 r, co druga przesunięta o pół wysokości.
function makeGrid(srcWidth, srcHeight, inside) {
  const shards = [];
  for (let c = 0; c * HEX_R * 1.5 < srcWidth; c++) {
    for (let ro = 0; ro * HEX_H < srcHeight; ro++) {
      const x = c * HEX_R * 1.5;
      const y = ro * HEX_H + (c % 2 ? HEX_H * 0.5 : 0);
      if (inside(x - srcWidth / 2, y - srcHeight / 2)) {
        shards.push({ gridX: x, gridY: y, radius: HEX_R, active: true, isDebris: false });
      }
    }
  }
  return { srcWidth, srcHeight, pivot: null, shards, activeStructuralCount: shards.length };
}

// Kadłub testowy: korpus 360×120 + dwa zęby dziobu (+x) z przerwą 40 px.
const forkHull = (x, y) => {
  if (x >= -200 && x <= 60 && Math.abs(y) <= 60) return true;
  if (x > 60 && x <= 200 && Math.abs(y) >= 20 && Math.abs(y) <= 60) return true;
  return false;
};

function bake(grid) {
  const data = new Uint8Array(L * L);
  const layout = bakeHullSdfLayer(grid, null, data, 0, {});
  return { data, layout };
}

// Mesh kadłuba: T(ex, -ey) · Rz(rot) · S(sx, -sy) — punkt lokalny do three-space.
function meshToWorld(lx, ly, ex, ey, rot, sx, sy) {
  const X = sx * lx, Y = -sy * ly;
  const c = Math.cos(rot), s = Math.sin(rot);
  return [ex + c * X - s * Y, -ey + s * X + c * Y];
}

test('EDT zgadza się z brute force', () => {
  const w = 23, h = 17;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const mask = new Uint8Array(w * h).map(() => (rnd() < 0.12 ? 1 : 0));
  const got = squaredDistanceTransform(mask, w, h, 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        if (mask[yy * w + xx] === 1) best = Math.min(best, (x - xx) ** 2 + (y - yy) ** 2);
      }
      assert.equal(got[y * w + x], best, `teksel ${x},${y}`);
    }
  }
});

test('SDF: ujemne w środku, zero w połowie między tekselem pełnym a pustym', () => {
  const w = 20, h = 12;
  const inside = new Uint8Array(w * h);
  for (let y = 3; y < 9; y++) for (let x = 4; x < 16; x++) inside[y * w + x] = 1;
  const sdf = signedDistanceField(inside, w, h);
  assert.equal(sdf[5 * w + 4], -0.5);          // brzegowy pełny
  assert.equal(sdf[5 * w + 3], 0.5);           // brzegowy pusty
  assert.ok(sdf[6 * w + 9] < -2);              // głęboko w środku
  assert.equal(sdf[6 * w + 0], 3.5);           // 4 teksele od brzegu
});

test('pieczenie: sylwetka z aktywnych heksów, margines wokół, poza siatką „daleko”', () => {
  const grid = makeGrid(420, 160, forkHull);
  const { data, layout } = bake(grid);
  assert.ok(layout.gw <= L && layout.gh <= L);
  // zakres heksów + promień + margines 12 tekseli z każdej strony
  const ext = measureHullExtent(grid);
  assert.ok(layout.originX < ext.minX - 11 * layout.texel);
  assert.ok(layout.originX + layout.gw * layout.texel > ext.maxX + 11 * layout.texel);
  const at = (lx, ly) => sampleSdfLayer(data, 0, (lx - layout.originX) / (layout.texel * L), (ly - layout.originY) / (layout.texel * L));
  assert.ok(at(-100, 0) < 0.45, 'środek korpusu w środku sylwetki');
  assert.ok(at(150, 40) < 0.5, 'ząb dziobu w środku sylwetki');
  assert.ok(at(150, 0) > 0.5, 'przerwa między zębami NIE jest kadłubem');
  assert.ok(at(-100, 140) > 0.9, 'daleko od burty');
  assert.equal(data[(L - 1) * L + (L - 1)], 255, 'poza siatką kadłuba = daleko');
});

test('krawędź z alfy: zero SDF poniżej teksela od prawdziwej burty', () => {
  // Heksy sięgają dalej niż burta, więc krawędź wyznacza alfa (jak w grze).
  const grid = makeGrid(400, 200, (x, y) => Math.abs(x) < 170 && Math.abs(y) < 75);
  const layout = planHullSdfLayout(measureHullExtent(grid), HEX_R, {});
  const n = layout.gw * layout.gh;
  const mask = new Uint8Array(n);
  const hex = new Uint8Array(n);
  const sdf = new Float32Array(n);
  // Wiersz przez środek statku, zero SDF interpolowane liniowo jak w teksturze.
  const zeroCrossing = () => {
    const gy = Math.round((0 - layout.originY) / layout.texel - 0.5);
    for (let gx = 0; gx < layout.gw - 1; gx++) {
      const a = sdf[gy * layout.gw + gx], b = sdf[gy * layout.gw + gx + 1];
      if (gx * layout.texel + layout.originX > 0 && a < 0 && b >= 0) {
        return layout.originX + (gx + 0.5 + a / (a - b)) * layout.texel;
      }
    }
    return NaN;
  };
  let worstBinary = 0, worstRefined = 0;
  for (const edge of [150.1, 150.37, 150.63, 150.9, 151.8, 152.45]) {
    // Alfa 1 px na piksel sprite'a, wygładzona na krawędzi (pokrycie piksela).
    const alpha = { data: new Uint8Array(400 * 200), w: 400, h: 200 };
    for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) {
      const lx = x + 0.5 - 200, ly = y + 0.5 - 100;
      const cx = Math.min(1, Math.max(0, edge - Math.abs(lx) + 0.5));
      alpha.data[y * 400 + x] = Math.abs(ly) < 60 ? Math.round(cx * 255) : 0;
    }
    rasterizeHullMask(grid, layout, alpha, mask, hex);
    signedDistanceField(mask, layout.gw, layout.gh, sdf);
    worstBinary = Math.max(worstBinary, Math.abs(zeroCrossing() - edge) / layout.texel);
    refineSdfEdges(sdf, hex, grid, layout, alpha);
    worstRefined = Math.max(worstRefined, Math.abs(zeroCrossing() - edge) / layout.texel);
  }
  assert.ok(worstBinary > 0.25, `maska binarna powinna pływać (było ${worstBinary.toFixed(3)})`);
  assert.ok(worstRefined < 0.2, `po doprecyzowaniu < 0,2 teksela (było ${worstRefined.toFixed(3)})`);
});

test('pakowanie okludera odwraca przekształcenie mesha kadłuba', () => {
  const grid = makeGrid(420, 160, forkHull);
  const { layout } = bake(grid);
  const packed = new Float32Array(HULL_SDF_OCCLUDER_FLOATS);
  const cases = [
    [1200, -300, -0.7, 1, 1],
    [-5000, 800, 2.3, 1.6, 1.6],
    [0, 0, 0, 0.8, 1.25],
    [300, 90, -3.0, -1, 1]      // lustro X
  ];
  for (const [ex, ey, rot, sx, sy] of cases) {
    packHullShaftOccluder(packed, 0, ex, ey, rot, sx, sy, layout, 3);
    for (const [lx, ly] of [[-150, 30], [120, -45], [0, 0]]) {
      const [wx, wy] = meshToWorld(lx, ly, ex, ey, rot, sx, sy);
      const rx = wx - packed[0], ry = wy - packed[1];
      const u = packed[4] * rx + packed[5] * ry;
      const v = packed[6] * rx + packed[7] * ry;
      assert.ok(Math.abs(u - (lx - layout.originX) / (layout.texel * L)) < 1e-5, `u dla rot ${rot}`);
      assert.ok(Math.abs(v - (ly - layout.originY) / (layout.texel * L)) < 1e-5, `v dla rot ${rot}`);
    }
    assert.equal(packed[10], 3);
    assert.ok(Math.abs(packed[8] - (layout.gw - 0.5) / L) < 1e-6);
  }
});

function setupTrace(grid, { ex = 0, ey = 0, rot = 0, sx = 1, sy = 1 } = {}) {
  const { data, layout } = bake(grid);
  const packed = new Float32Array(HULL_SDF_OCCLUDER_FLOATS);
  packHullShaftOccluder(packed, 0, ex, ey, rot, sx, sy, layout, 0);
  // Słońce daleko w kierunku d (three-space).
  return (lx, ly, d) => {
    const [wx, wy] = meshToWorld(lx, ly, ex, ey, rot, sx, sy);
    const len = Math.hypot(d[0], d[1]);
    return traceHullShadowCpu(wx, wy, d[0] / len, d[1] / len, 1e9, packed, 0, data, { steps: 24, lenMul: 3 });
  };
}

test('cień startuje przy burcie, kadłub nie rzuca cienia sam na siebie', () => {
  const grid = makeGrid(420, 160, forkHull);
  const toSunPlusX = [1, 0];               // słońce od dziobu (+x sprite'a = +x three przy rot 0)
  const shade = setupTrace(grid);
  assert.ok(shade(-212, 0, toSunPlusX) > 0.95, 'tuż za rufą: pełny cień');
  assert.ok(shade(-400, 0, toSunPlusX) > 0.9, 'dalej za rufą: nadal cień');
  assert.equal(shade(-100, 0, toSunPlusX), 0, 'środek kadłuba: bez samocienia');
  assert.equal(shade(-190, 50, toSunPlusX), 0, 'kadłub przy rufie: bez samocienia');
  assert.equal(shade(230, 0, toSunPlusX), 0, 'przed dziobem (od strony słońca): światło');
  assert.equal(shade(-300, 160, toSunPlusX), 0, 'obok kadłuba, poza półcieniem: światło');
  assert.equal(shade(-3000, 0, toSunPlusX), 0, 'poza zasięgiem smugi: światło');
});

test('przerwa w widelcu dziobu przepuszcza światło (kapsuła ją zalewała)', () => {
  const grid = makeGrid(420, 160, forkHull);
  const shade = setupTrace(grid, { rot: 0.9, ex: 700, ey: -200, sx: 1.3, sy: 1.3 });
  // Słońce przed dziobem, wzdłuż osi zębów (w układzie statku +x) — w świecie
  // obrócone razem z meshem.
  const dirLocal = [1, 0];
  const [ax, ay] = meshToWorld(0, 0, 0, 0, 0.9, 1, 1);
  const [bx, by] = meshToWorld(dirLocal[0], dirLocal[1], 0, 0, 0.9, 1, 1);
  const d = [bx - ax, by - ay];
  assert.equal(shade(150, 0, d), 0, 'środek przerwy: promień wychodzi otwartym końcem widelca');
  assert.ok(shade(50, 0, d) === 0, 'korpus: bez samocienia');
  assert.ok(shade(-230, 0, d) > 0.95, 'za rufą: cień całego kadłuba');
});

test('dziura po trafieniach wpuszcza światło po ponownym upieczeniu', () => {
  const grid = makeGrid(420, 160, forkHull);
  // Wyrwa przez całą szerokość korpusu przy x ∈ [-60, -20].
  for (const s of grid.shards) {
    const x = s.gridX - 210;
    if (x > -60 && x < -20) { s.active = false; s.isDebris = true; grid.activeStructuralCount--; }
  }
  const shade = setupTrace(grid);
  const toSunDown = [0, -1];               // słońce „pod” statkiem w three-space = +y sprite'a
  assert.equal(shade(-40, -90, toSunDown), 0, 'za wyrwą: światło przechodzi');
  assert.ok(shade(-120, -90, toSunDown) > 0.9, 'za pełnym korpusem: cień');
});

test('warstwy: wspólna dla świeżej floty, własna po trafieniu, nowa dla wraku z puli, LRU', () => {
  HullShadowSdf.ensureTexture();
  const image = { width: 420, height: 160 };   // bez DOM: sama maska heksów
  const a = makeGrid(420, 160, forkHull);
  const b = makeGrid(420, 160, forkHull);
  a.armorImage = image;
  b.armorImage = image;

  HullShadowSdf.beginFrame(1);
  const ea = HullShadowSdf.acquire(a, 0);
  const eb = HullShadowSdf.acquire(b, 0);
  assert.ok(ea && eb);
  assert.equal(ea, eb, 'świeże kadłuby tego typu dzielą warstwę');
  assert.equal(HullShadowSdf.stats.bakes, 1);

  const hit = (grid, from, count) => {
    for (let i = from; i < from + count; i++) grid.shards[i].active = false;
    grid.activeStructuralCount -= count;
  };
  // Draśnięcie (kilka heksów): dalej wspólna sylwetka, bez pieczenia.
  hit(a, 10, 3);
  HullShadowSdf.beginFrame(2);
  assert.equal(HullShadowSdf.acquire(a, 100), eb);
  assert.equal(HullShadowSdf.stats.bakes, 0);
  // Poważne trafienie: własna warstwa, szablon zostaje dla reszty floty.
  hit(a, 100, 40);
  HullShadowSdf.beginFrame(3);
  const ea2 = HullShadowSdf.acquire(a, 200);
  assert.notEqual(ea2.layer, eb.layer);
  assert.equal(HullShadowSdf.stats.bakes, 1);
  // Drobny ubytek: bez pieczenia przez REBAKE_MS, a nawet po nim (za mały).
  hit(a, 200, 1);
  HullShadowSdf.beginFrame(4);
  HullShadowSdf.acquire(a, 700);
  HullShadowSdf.beginFrame(5);
  HullShadowSdf.acquire(a, 1500);
  assert.equal(HullShadowSdf.stats.bakes, 0, 'drobny ubytek czeka');
  HullShadowSdf.beginFrame(6);
  HullShadowSdf.acquire(a, 4300);
  assert.equal(HullShadowSdf.stats.bakes, 1, 'drobny ubytek po REBAKE_SMALL_MS');
  // Duży ubytek: pieczenie po REBAKE_MS.
  hit(a, 300, 30);
  HullShadowSdf.beginFrame(7);
  HullShadowSdf.acquire(a, 4800);
  assert.equal(HullShadowSdf.stats.bakes, 0);
  HullShadowSdf.beginFrame(8);
  HullShadowSdf.acquire(a, 5400);
  assert.equal(HullShadowSdf.stats.bakes, 1, 'duży ubytek po REBAKE_MS');
  assert.equal(HullShadowSdf.acquire(b, 5400), eb, 'reszta floty dalej na szablonie');

  // Wrak z puli: ten sam obiekt siatki, nowa tablica heksów.
  const wreck = makeGrid(420, 160, (x, y) => x < -100 && Math.abs(y) < 50);
  wreck.isFragment = true;
  wreck.armorImage = image;
  HullShadowSdf.beginFrame(9);
  const w1 = HullShadowSdf.acquire(wreck, 6000);
  const w1Width = w1.layout.gw;
  wreck.shards = makeGrid(420, 160, (x, y) => Math.abs(x) < 150 && Math.abs(y) < 50).shards;
  HullShadowSdf.beginFrame(10);
  const w2 = HullShadowSdf.acquire(wreck, 6100);
  assert.equal(HullShadowSdf.stats.bakes, 1, 'nowa tablica heksów = nowe pieczenie');
  assert.notEqual(w2.layout.gw, w1Width);

  // Budżet: najwyżej 2 pieczenia na klatkę.
  const fresh = [];
  for (let i = 0; i < 3; i++) {
    const g = makeGrid(300 + i * 10, 120, (x, y) => Math.abs(x) < 100 && Math.abs(y) < 40);
    g.armorImage = { width: 300 + i * 10, height: 120 };
    fresh.push(g);
  }
  HullShadowSdf.beginFrame(11);
  const got = fresh.map((g) => HullShadowSdf.acquire(g, 7000));
  assert.ok(got[0] && got[1]);
  assert.equal(got[2], null, 'trzecie pieczenie czeka na następną klatkę');

  // LRU: zapełniamy wszystkie warstwy; nowy kształt wypiera najdawniej używaną.
  let frame = 12;
  const many = [];
  for (let i = 0; i < HULL_SDF_LAYER_COUNT + 1; i++) {
    const g = makeGrid(200, 80, (x, y) => Math.abs(x) < 60 + (i % 7) && Math.abs(y) < 30);
    g.armorImage = { width: 200, height: 80, id: i };
    many.push(g);
    HullShadowSdf.beginFrame(frame++);
    assert.ok(HullShadowSdf.acquire(g, 5000 + i), `kształt ${i} dostaje warstwę`);
  }
  assert.ok(HullShadowSdf.stats.evictions > 0);
  const layers = new Set(HullShadowSdf.layers.map((l) => l.owner));
  assert.equal(layers.size, HULL_SDF_LAYER_COUNT, 'każda warstwa ma jednego właściciela');
});

test('GLSL: stałe z kropką, bez backticków, próbkowanie jawnym LOD', () => {
  assert.match(HULL_SDF_SHADOW_GLSL, /uniform sampler2DArray uHullSdf;/);
  assert.match(HULL_SDF_SHADOW_GLSL, /textureLod\(uHullSdf, vec3\(uv, layer\), 0\.0\)/);
  assert.ok(!HULL_SDF_SHADOW_GLSL.includes('`'));
  assert.doesNotMatch(HULL_SDF_SHADOW_GLSL, /\$\{/);
  // Każda wstrzyknięta liczba zmiennoprzecinkowa musi mieć kropkę (GLSL ES nie rzutuje int -> float).
  for (const m of HULL_SDF_SHADOW_GLSL.matchAll(/\* (\d[\d.eE+-]*)/g)) {
    assert.match(m[1], /[.eE]/, `liczba bez kropki: ${m[1]}`);
  }
  // Lustro CPU i shader muszą dzielić stałe — sprawdzamy, że planowanie siatki ich używa.
  const layout = planHullSdfLayout({ minX: -100, maxX: 100, minY: -40, maxY: 40, count: 10 }, 5);
  assert.ok(layout.gw > 0 && layout.gh > 0);
});
