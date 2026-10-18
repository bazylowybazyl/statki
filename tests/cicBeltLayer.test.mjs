// Warstwa pasów asteroid mapy CIC (src/ui/cicBeltLayer.js): poziomy piramidy, kontury (marching squares z łańcuchami),
// wypiek kafli w budżecie czasu na prawdziwym polu pasa, puste kafle bez próbkowania, opisy miejsca dla HUD-u.
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  CIC_BELT_CELL0, CIC_BELT_KMAX, CIC_BELT_N, CIC_BELT_TEX,
  cicBeltLevelFor, traceCicBeltContours, groupChainsByPalette, cicBeltColor, cicBeltCellValues,
  cicSunArcAnchor, CicBeltLayer, describeCicBeltAt, cicBeltPaletteIndex
} = await import('../src/ui/cicBeltLayer.js');
const { AsteroidBeltField } = await import('../src/game/asteroidBeltField.js');

const AU = 42253.52;
const SX = 6e6, SY = 6e6;
const planets = [
  { id: 'jupiter', x: SX + 50.2 * AU, y: SY, orbitRadius: 50.2 * AU },
  { id: 'earth', x: SX - 25 * AU, y: SY, orbitRadius: 25 * AU },
  { id: 'mars', x: SX, y: SY + 33 * AU, orbitRadius: 33 * AU },
  { id: 'neptune', x: SX, y: SY - 127 * AU, orbitRadius: 127 * AU }
];
const field = new AsteroidBeltField({ planets, sunX: SX, sunY: SY, auToWorld: AU });

// kontekst 2D-atrapa: każda metoda no-op, właściwości zapisywalne
function stubCtx() {
  const calls = { drawImage: 0, stroke: 0 };
  return new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'drawImage' || k === 'stroke') return () => { calls[k]++; };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

test('poziom piramidy: komórka ≈ 6 px, granice i histereza', () => {
  assert.equal(cicBeltLevelFor(0.08), 0);              // taktyczny: najdrobniejszy poziom
  assert.equal(cicBeltLevelFor(1e-9), CIC_BELT_KMAX);  // dalej niż układ — najgrubszy
  for (const z of [0.003, 0.001, 0.0004, 0.0001, 0.00006]) {
    const k = cicBeltLevelFor(z);
    const px = CIC_BELT_CELL0 * 2 ** k * z;
    assert.ok(px > 3.5 && px < 12, `zoom ${z}: komórka ${px.toFixed(1)} px (k ${k})`);
  }
  // histereza: lekkie przesunięcie zoomu nie zmienia poziomu
  const k = cicBeltLevelFor(0.0004);
  assert.equal(cicBeltLevelFor(0.0004 * 1.3, k), k);
  assert.equal(cicBeltLevelFor(0.0004 / 1.3, k), k);
  assert.notEqual(cicBeltLevelFor(0.0004 * 2.5, k), k);
  // najgrubszy kafel obejmuje cały układ (świat 12 mln j., Kuiper do 140 AU)
  assert.ok(CIC_BELT_CELL0 * 2 ** CIC_BELT_KMAX * CIC_BELT_N >= 12e6);
});

test('kontury: okrąg = jeden zamknięty łańcuch na promieniu', () => {
  const n = 40;
  const vals = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[j * n + i] = 12 - Math.hypot(i - 19.3, j - 20.1);
  const chains = traceCicBeltContours(vals, n, n, 0, 0, n - 1, 0, n - 1);
  assert.equal(chains.length, 1);
  const c = chains[0];
  assert.ok(c.length > 40);
  assert.equal(c[0], c[c.length - 2]);
  assert.equal(c[1], c[c.length - 1]);
  for (let i = 0; i < c.length; i += 2) {
    const r = Math.hypot(c[i] - 19.3, c[i + 1] - 20.1);
    assert.ok(Math.abs(r - 12) < 0.1, `punkt ${i / 2}: r ${r}`);
  }
  // pas (dwie krawędzie) przecięty przez zakres komórek: dwa otwarte łańcuchy
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[j * n + i] = 6 - Math.abs(i - 20);
  const open = traceCicBeltContours(vals, n, n, 0.5, 0, n - 1, 0, n - 1);
  assert.equal(open.length, 2);
  for (const ch of open) assert.notEqual(ch[1], ch[ch.length - 1]);
});

test('kontury: siodło rozstrzygnięte środkiem, bez zgubionych odcinków', () => {
  // szachownica 2 × 2 wartości — oba siodła
  const vals = Float32Array.from([1, 0, 0, 1]);
  const a = traceCicBeltContours(vals, 2, 2, 0.4, 0, 1, 0, 1); // środek 0,5 ≥ 0,4 → łączy rogi 1
  const b = traceCicBeltContours(vals, 2, 2, 0.6, 0, 1, 0, 1); // środek < 0,6 → rogi osobno
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.notDeepEqual([...a[0]], [...b[0]]);
});

test('barwa komórki: przezroczysta poza pasem, alfa z sufitem, pole jaśniejsze', () => {
  const d = new Uint8ClampedArray(12);
  cicBeltColor(0, 0, 0, 0, d, 0);
  assert.equal(d[3], 0);
  cicBeltColor(1, 0, 0, 0, d, 4);
  cicBeltColor(1, 1, 1, 0, d, 8);
  assert.ok(d[11] > d[7]);
  assert.ok(d[11] <= 0.62 * 255 + 1);
  assert.ok(d[8] + d[9] + d[10] > d[4] + d[5] + d[6]);
  assert.equal(cicBeltPaletteIndex('main'), 0);
  assert.equal(cicBeltPaletteIndex('kuiper_cold'), cicBeltPaletteIndex('kuiper'));
});

test('wartości komórki: luka Kirkwooda odjęta (raster bez mory), pole wygaszone przy krawędzi pasa', () => {
  const out = { w: 0, f: 0, rim: 0 };
  const m = { weight: 1, gap: 0.1, cluster: 0.05, rim: 0.02 };
  cicBeltCellValues(m, out);
  assert.ok(Math.abs(out.f - 0.5) < 1e-9);
  assert.ok(Math.abs(out.rim - 0.2) < 1e-9);
  cicBeltCellValues({ weight: 0.25, gap: 1, cluster: 0.8, rim: 0 }, out);
  assert.ok(Math.abs(out.f - 0.4) < 1e-9);
  cicBeltCellValues({ weight: 0, gap: 1, cluster: 0.8, rim: 0 }, out);
  assert.equal(out.f, 0);
});

test('wypiek kafli na prawdziwym polu: budżet, puste kafle, kontury, korzeń przypięty', () => {
  const tune = { on: true, cellPx: 6, bakeMs: 2, maxTiles: 96, contours: true, beltIso: 0.2, fieldIso: 0.16, lanes: true, labels: true, giants: true, families: true };
  const ctx = stubCtx();
  // rozgrzewka JIT (pierwsze domknięcie kafla na zimno trwa kilka ms) — inna warstwa, inny kadr
  const warm = new CicBeltLayer({ getField: () => field, tune });
  for (let f = 0; f < 60; f++) warm.draw(ctx, { W: 1600, H: 900, cx: 800, cy: 450, viewX: SX - 38.5 * AU, viewY: SY, zoom: 0.003, blend: 0 });
  const layer = new CicBeltLayer({ getField: () => field, keepLines: true, tune });
  // kadr nad pasem głównym (38 AU na osi x) przy średnim zoomie
  const v = { W: 1600, H: 900, cx: 800, cy: 450, viewX: SX + 38.5 * AU, viewY: SY, zoom: 0.0006, blend: 0 };
  const perCall = [];
  for (let f = 0; f < 400; f++) {
    const t0 = layer.stats.bakeMs;
    layer.draw(ctx, v);
    perCall.push(layer.stats.bakeMs - t0);
    if (layer.stats.ready > 0 && !layer.job && layer._need.length === 0) break;
  }
  const max = Math.max(...perCall);
  assert.ok(max < 2 + 1, `wypiek w klatce ${max.toFixed(2)} ms (budżet 2 ms + jeden wiersz)`);
  assert.ok(layer.stats.baked >= 2, `upieczone ${layer.stats.baked}`);
  const ready = [...layer.tiles.values()].filter((t) => t.state === 2);
  const root = [...layer.tiles.values()].find((t) => t.k === CIC_BELT_KMAX);
  assert.ok(root && root.pinned && root.state === 2, 'korzeń (cały układ) upieczony i przypięty');
  const fine = ready.filter((t) => t.k === layer.k);
  assert.ok(fine.length >= 1);
  // kontury pasa głównego: grupa palety 0 (piasek)
  assert.ok(fine.some((t) => t.belt?.[0]?.length > 0 || t.fieldLines?.[0]?.length > 0), 'kontury pasa głównego');
  // po dopieczeniu rysunek idzie z kafli docelowego poziomu (bez zastępstwa przodkiem)
  layer.draw(ctx, v);
  assert.equal(layer.stats.fallback, 0);
  const visible = [...layer._visible].map((key) => layer.tiles.get(key)).filter((t) => t && t.k === layer.k);
  assert.ok(visible.length >= 2 && visible.every((t) => t.state >= 2), 'kadr pokryty kaflami docelowego poziomu');

  // pusty obszar (wnętrze układu, 8 AU) — kafle puste bez próbkowania
  const samples0 = layer.stats.samples;
  const empty0 = layer.stats.empty;
  const v2 = { ...v, viewX: SX + 8 * AU, viewY: SY + 3 * AU, zoom: 0.02 };
  for (let f = 0; f < 40; f++) layer.draw(ctx, v2);
  assert.ok(layer.stats.empty > empty0);
  assert.equal(layer.stats.samples, samples0, 'pusty kadr nie próbkuje pola');
});

test('grupy konturów wg palety regionu przy łańcuchu', () => {
  const n = CIC_BELT_TEX;
  const Wv = new Float32Array(n * n);
  const Pv = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = j * n + i;
    Wv[o] = i < 40 ? 1 : (i > 80 ? 1 : 0);
    Pv[o] = i < 40 ? 0 : 2;
  }
  const chains = traceCicBeltContours(Wv, n, n, 0.5, 0, n - 2, 0, n - 2);
  const g = groupChainsByPalette(chains, Wv, Pv, n);
  assert.ok(g[0]?.length >= 1 && g[2]?.length >= 1);
});

test('opis miejsca: pas główny z rodziną i gęstością, luka Kirkwooda, poza pasami — null', () => {
  field.familyPeaks();
  const d = describeCicBeltAt(field, SX - 38.6 * AU, SY + 0.3 * AU);
  assert.match(d, /^PAS GŁÓWNY · /);
  const gap = describeCicBeltAt(field, SX, SY - 37.57 * AU);
  assert.match(gap, /LUKA KIRKWOODA 3:1/);
  assert.equal(describeCicBeltAt(field, SX + 10 * AU, SY), null);
  const k = describeCicBeltAt(field, SX + 133 * AU * Math.cos(2), SY + 133 * AU * Math.sin(2));
  assert.match(k, /PAS KUIPERA/);
  const anchor = cicSunArcAnchor(-5e5, 450, 5e5 + 800, 1600, 900, 0);
  assert.ok(anchor && Math.abs(anchor.x - 800) < 1 && Math.abs(anchor.y - 450) < 1);
});

test('LRU nie zamyka bitmapy kafla-przodka użytego w tej klatce jako zastępstwo', () => {
  // błąd z gry (2026-10-18): przodek w zastępstwie nie był „widoczny”, LRU zamykał jego ImageBitmap między zebraniem
  // kafli a rysunkiem → drawImage rzucał „image source is detached” i pętla gry stawała
  const layer = new CicBeltLayer({ getField: () => field, tune: { on: true, cache: false, fill: true, cellPx: 6, bakeMs: 0, maxTiles: 8, contours: false, lanes: false, labels: false, giants: false, families: false } });
  layer._attach(field);
  const v = { W: 1600, H: 900, cx: 800, cy: 450, viewX: SX + 38.5 * AU, viewY: SY, zoom: 0.003, blend: 0 };
  const k = cicBeltLevelFor(v.zoom);
  // gotowy przodek dwa poziomy wyżej (nie korzeń — nieprzypięty), stary w LRU
  const size = CIC_BELT_CELL0 * 2 ** (k + 2) * CIC_BELT_N;
  const anc = layer._tile(k + 2, Math.floor(v.viewX / size), Math.floor(v.viewY / size));
  anc.state = 2;
  anc.used = -100;
  anc.bitmap = { width: 130, height: 130, close() { this.width = 0; } };
  // śmieci w LRU ponad limit
  for (let i = 0; i < 30; i++) { const t = layer._tile(0, 1000 + i, 1000); t.used = -50; t.state = 2; t.bitmap = { width: 130, close() { this.width = 0; } }; }
  layer.frame = 1;
  const draws = layer._collectTiles({ ...v });
  const fb = draws.filter((d) => d.fallback === anc);
  assert.ok(fb.length > 0, 'kadr rysowany z przodka');
  layer._evict();
  const readyLeft = [...layer.tiles.values()].filter((t) => t.state === 2).length;
  assert.ok(readyLeft <= 8 + 1, `LRU trzyma limit kafli z obrazem (${readyLeft})`);
  assert.ok(layer.tiles.has(anc.key), 'przodek w użyciu nie wypada z pamięci');
  assert.ok(anc.bitmap.width > 0, 'bitmapa przodka nie zamknięta');
  // osłona: zamknięta bitmapa w liście rysunku jest pomijana (bez wyjątku)
  anc.bitmap.close();
  const ctx = stubCtx();
  ctx.drawImage = (src) => { if (!src.width) throw new Error('The image source is detached'); };
  layer._render(ctx, { ...v }, draws, field);
});

test('LRU: kafle czekające spoza kadru wypadają, upieczone zostają w limicie', () => {
  const layer = new CicBeltLayer({ getField: () => field, tune: { on: true, cache: false, fill: true, cellPx: 6, bakeMs: 0, maxTiles: 8, contours: false, lanes: false, labels: false, giants: false, families: false } });
  layer._attach(field);
  for (let i = 0; i < 6; i++) { const t = layer._tile(0, 2000 + i, 2000); t.state = 2; t.used = i; t.bitmap = { width: 130, close() { this.width = 0; } }; }
  for (let i = 0; i < 200; i++) layer._tile(0, 3000 + i, 3000); // czekające (zoom w ruchu)
  layer._visible.clear();
  layer.frame = 32;
  layer._evict();
  const states = [...layer.tiles.values()].map((t) => t.state);
  assert.equal(states.filter((x) => x === 0).length, 0);
  assert.equal(states.filter((x) => x === 2).length, 6);
});
