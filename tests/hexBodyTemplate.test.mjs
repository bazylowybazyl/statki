import test from 'node:test';
import assert from 'node:assert/strict';
import { initHexBody, disposeHexBody } from '../src/game/destructor.js';

// Szablon ciała heksowego per obraz (przycięcie przy spawnie floty): drugi
// i kolejne kadłuby z tym samym obrazkiem nie czytają pikseli ani nie rysują
// heksów od zera. Obraz pancerza, maski krawędzi i wierzchołki są wspólne,
// stan zniszczeń (heksy, odkształcenia, kanwa cache) — per encja.

function withCanvasStub(run) {
  const previousDocument = globalThis.document;
  const stats = { getImageData: 0, clip: 0, copies: [] };
  const noop = () => {};
  const makeContext = (canvas) => ({
    save: noop, restore: noop, translate: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, closePath: noop, fill: noop, clearRect: noop,
    clip() { stats.clip++; },
    drawImage(src) { stats.copies.push({ into: canvas, src }); },
    getImageData(_x, _y, w, h) {
      stats.getImageData++;
      // Kadłub = prostokąt w środku, reszta przezroczysta — są też heksy brzegowe z maską.
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = Math.floor(h * 0.2); y < Math.ceil(h * 0.8); y++) {
        for (let x = Math.floor(w * 0.1); x < Math.ceil(w * 0.9); x++) data[(y * w + x) * 4 + 3] = 255;
      }
      return { data };
    }
  });
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => makeContext(canvas);
      return canvas;
    }
  };
  const entities = [];
  try {
    run({ stats, entities });
  } finally {
    for (const e of entities) disposeHexBody(e);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

const makeEntity = () => ({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 50000, noSplit: true });

test('szablon: drugi kadłub z tym samym obrazkiem bez getImageData i z tym samym układem heksów', () => {
  withCanvasStub(({ stats, entities }) => {
    const image = { width: 120, height: 60 };
    const a = makeEntity();
    const b = makeEntity();
    entities.push(a, b);
    initHexBody(a, image);
    assert.equal(stats.getImageData, 1);
    initHexBody(b, image);
    assert.equal(stats.getImageData, 1, 'drugi kadłub nie czyta pikseli');

    assert.ok(a.hexGrid && b.hexGrid);
    assert.ok(a.hexGrid.shards.some(s => s.edgeMask), 'obrazek ma heksy brzegowe');
    assert.equal(b.hexGrid.shards.length, a.hexGrid.shards.length);
    assert.equal(b.hexGrid.rawRadius, a.hexGrid.rawRadius);
    assert.equal(b.mass, a.mass);
    for (let i = 0; i < a.hexGrid.shards.length; i++) {
      const sa = a.hexGrid.shards[i];
      const sb = b.hexGrid.shards[i];
      assert.equal(sb.gridX, sa.gridX);
      assert.equal(sb.gridY, sa.gridY);
      assert.equal(sb.hp, sa.hp);
      assert.equal(sb.edgeMask, sa.edgeMask);
      assert.notEqual(sb, sa);
      assert.notEqual(sb.deformation, sa.deformation, 'odkształcenia per heks');
    }
    assert.equal(b.hexGrid.armorImage, a.hexGrid.armorImage, 'obraz pancerza wspólny — a z nim pula odłamków GPU');
    assert.equal(b.hexGrid.shards[0].img, a.hexGrid.shards[0].img);
    assert.notEqual(b.hexGrid.cacheCanvas, a.hexGrid.cacheCanvas, 'kanwa cache per encja (wymazywanie heksów)');
  });
});

test('szablon: od trzeciego kadłuba cache to jedna kopia wzorca, bez rysowania heksów', () => {
  withCanvasStub(({ stats, entities }) => {
    const image = { width: 120, height: 60 };
    const a = makeEntity();
    const b = makeEntity();
    const c = makeEntity();
    entities.push(a, b, c);
    initHexBody(a, image);
    assert.ok(stats.clip > 0, 'pierwszy kadłub rysuje heksy wprost (bez dodatkowej kanwy)');
    initHexBody(b, image);
    const clipsAfterSecond = stats.clip;
    initHexBody(c, image);
    assert.equal(stats.clip, clipsAfterSecond, 'trzeci nie rysuje ani jednego heksa');
    const copies = stats.copies.filter(k => k.into === c.hexGrid.cacheCanvas);
    assert.equal(copies.length, 1);
    assert.notEqual(copies[0].src, image, 'kopia z wzorca, nie z surowego sprite’a');
  });
});

test('szablon: inny próg alfy albo inny obiekt obrazka = osobny szablon', () => {
  withCanvasStub(({ stats, entities }) => {
    const image = { width: 120, height: 60 };
    const a = makeEntity();
    const b = makeEntity();
    const c = makeEntity();
    entities.push(a, b, c);
    initHexBody(a, image, false, null, 40);
    initHexBody(b, image, false, null, 90);
    initHexBody(c, { width: 120, height: 60 });
    assert.equal(stats.getImageData, 3);
    assert.notEqual(b.hexGrid.armorImage, a.hexGrid.armorImage);
  });
});

test('heksy: wierzchołki i strzępy wspólne i zamrożone', () => {
  withCanvasStub(({ entities }) => {
    const e = makeEntity();
    entities.push(e);
    initHexBody(e, { width: 80, height: 40 });
    const [s0, s1] = e.hexGrid.shards;
    assert.equal(s0.verts, s1.verts);
    assert.equal(s0.frays, s1.frays);
    assert.ok(Object.isFrozen(s0.verts) && Object.isFrozen(s0.verts[0]));
    assert.throws(() => { s0.frays[0].x = 1; }, TypeError);
  });
});
