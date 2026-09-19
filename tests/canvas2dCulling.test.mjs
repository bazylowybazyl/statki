import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Warstwa 2D rysowała bez cullingu: pętla po pociskach leciała po WSZYSTKICH
// pociskach świata (walki NPC vs NPC po drugiej stronie mapy też), a budżet
// MAX_PARTICLES_DRAW konsumowały cząstki spoza kadru — przez co wycinane były te
// widoczne. Do tego każde rzutowanie alokowało dwa obiekty (wynik + viewport).

const VW = 1000;
const VH = 800;

function installFakeWindow() {
  const prev = globalThis.window;
  const worldToScreenInto = (wx, wy, cam, out) => {
    const z = cam?.zoom || 1;
    out.x = (wx - (cam?.x || 0)) * z + VW / 2;
    out.y = (wy - (cam?.y || 0)) * z + VH / 2;
    return out;
  };
  globalThis.window = {
    W: VW,
    H: VH,
    worldToScreenInto,
    worldToScreen: (wx, wy, cam) => worldToScreenInto(wx, wy, cam, { x: 0, y: 0 })
  };
  return () => { globalThis.window = prev; };
}

function makeCtx() {
  const rec = { ops: 0, gradients: 0, canvas: { width: VW, height: VH } };
  const noop = () => { rec.ops++; };
  for (const m of [
    'save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo',
    'closePath', 'fill', 'stroke', 'arc', 'fillRect', 'roundRect', 'setTransform'
  ]) rec[m] = noop;
  const grad = { addColorStop() {} };
  rec.createLinearGradient = () => { rec.ops++; rec.gradients++; return grad; };
  rec.createRadialGradient = () => { rec.ops++; rec.gradients++; return grad; };
  // save/restore same w sobie nie znaczą "narysowano" — liczymy je osobno.
  rec.save = () => {};
  rec.restore = () => {};
  return rec;
}

const CAM = { x: 0, y: 0, zoom: 1 };

test('budżet cząstek konsumują tylko cząstki widoczne', async () => {
  const restore = installFakeWindow();
  const { CanvasVFX } = await import('../src/vfx/canvasParticleSystem.js');
  const prevBudget = CanvasVFX.MAX_PARTICLES_DRAW;
  const prevActive = CanvasVFX.activeParticles;

  try {
    CanvasVFX.MAX_PARTICLES_DRAW = 3;
    const mk = (x) => ({ flash: false, beam: false, pos: { x, y: 0 }, size: 4, age: 0, life: 1, color: '#fff' });
    // Pięć cząstek daleko poza kadrem, potem jedna w środku ekranu.
    CanvasVFX.activeParticles = [mk(9e5), mk(9e5), mk(9e5), mk(9e5), mk(9e5), mk(0)];

    const ctx = makeCtx();
    CanvasVFX.drawParticles(ctx, CAM);

    // Stara kolejność (drawn++ przed testem kadru) dawała 0 — limit wyczerpywały
    // cząstki niewidoczne, a ta w środku ekranu nie zdążyła się narysować.
    assert.equal(ctx.ops, 1, 'dokładnie jedna widoczna cząstka trafia na kanwę');
  } finally {
    CanvasVFX.MAX_PARTICLES_DRAW = prevBudget;
    CanvasVFX.activeParticles = prevActive;
    restore();
  }
});

test('pocisk poza kadrem nie dotyka kanwy, pocisk w kadrze rysuje się', async () => {
  const restore = installFakeWindow();
  const { CanvasVFX } = await import('../src/vfx/canvasParticleSystem.js');

  try {
    const mkBullet = (x) => ({
      x, y: 0, px: x, py: 0, vx: 100, vy: 0, type: 'bolt',
      vfx: { len: 50, widthOuter: 10, widthInner: 4, color: '#ffffff', trailColor: '#88ccff' }
    });

    const onScreen = makeCtx();
    CanvasVFX.drawBulletVisual(onScreen, mkBullet(0), CAM, 1);
    assert.ok(onScreen.ops > 0, 'pocisk w kadrze musi się rysować');

    const offScreen = makeCtx();
    CanvasVFX.drawBulletVisual(offScreen, mkBullet(500000), CAM, 1);
    assert.equal(offScreen.ops, 0, 'pocisk spoza kadru nie może kosztować ani jednej operacji');
  } finally {
    restore();
  }
});

test('pocisk tuż za krawędzią wciąż się rysuje (zapas na smugę)', async () => {
  const restore = installFakeWindow();
  const { CanvasVFX } = await import('../src/vfx/canvasParticleSystem.js');

  try {
    // Środek 20 px za prawą krawędzią: smuga i poświata wchodzą jeszcze w kadr,
    // więc culling NIE może go uciąć.
    const b = {
      x: VW / 2 + 20, y: 0, px: VW / 2 + 20, py: 0, vx: 100, vy: 0, type: 'bolt',
      vfx: { len: 50, widthOuter: 10, widthInner: 4, color: '#ffffff', trailColor: '#88ccff' }
    };
    const ctx = makeCtx();
    CanvasVFX.drawBulletVisual(ctx, b, CAM, 1);
    assert.ok(ctx.ops > 0, 'margines musi obejmować długość pocisku i poświatę');
  } finally {
    restore();
  }
});

test('rzutowanie świat→ekran nie alokuje viewportu', () => {
  // getViewportForCamera było wołane raz na KAŻDE rzutowanie i za każdym razem
  // zwracało świeży obiekt — drugie tyle śmieci co sam wynik.
  assert.match(
    indexHtml,
    /const _vpScratch = \{ x: 0, y: 0, w: 0, h: 0 \};/,
    'viewport musi iść przez scratch'
  );
  assert.doesNotMatch(
    indexHtml,
    /return \{ x: vpX, y: vpY, w: vpW, h: vpH \};/,
    'stara alokująca wersja nie może wrócić'
  );

  // Wariant bez alokacji dla gorących pętli; worldToScreen ZOSTAJE alokujący,
  // bo część wołających trzyma dwa wyniki naraz.
  assert.match(indexHtml, /function worldToScreenInto\(wx, wy, cam, out\)/);
  assert.match(indexHtml, /window\.worldToScreenInto = worldToScreenInto;/);
  assert.match(
    indexHtml,
    /function worldToScreen\(wx, wy, cam\) \{\s*\n\s*return worldToScreenInto\(wx, wy, cam, \{ x: 0, y: 0 \}\);/,
    'worldToScreen musi iść przez wspólną ścieżkę'
  );
});
