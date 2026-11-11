import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Kursor = centralne miejsce informacji (2026-11-11): koło ładowania warpa / rozruchu hipercruise'u na pierścieniu
// celownika (src/ui/cursorChargeRing.js) i streszczenie stanu skoku pod celownikiem zamiast ramki u góry ekranu
// (src/ui/warpCourseOverlay.js).
const { CHARGE_RING_TUNE, CHARGE_RING_PHASE, CHARGE_RING_COLORS, createChargeRing, stepChargeRing, chargeRingVisible, drawChargeRing } =
  await import('../src/ui/cursorChargeRing.js');
const { warpCursorLines, drawWarpCursorInfo, drawWarpCourseHud } = await import('../src/ui/warpCourseOverlay.js');

// Atrapa kontekstu 2D: zapisuje napisy, prostokąty, łuki (promień, kąty, barwa, grubość) i liczby niebędące liczbami.
function fakeCtx() {
  const log = { text: [], rects: 0, arcs: [], nan: [] };
  const state = {
    log, globalAlpha: 1, font: '', lineWidth: 1, strokeStyle: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
    textAlign: '', textBaseline: '', lineCap: '',
    fillText(t, x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) log.nan.push(`fillText ${t}`);
      log.text.push(String(t));
    },
    fillRect() { log.rects++; },
    arc(x, y, r, a0, a1) {
      if (![x, y, r, a0, a1].every(Number.isFinite)) log.nan.push('arc');
      log.arcs.push({ r, a0, a1, alpha: state.globalAlpha, color: state.strokeStyle, width: state.lineWidth });
    },
    stroke() {
      const a = log.arcs[log.arcs.length - 1];
      if (a) { a.color = state.strokeStyle; a.width = state.lineWidth; a.alpha = state.globalAlpha; }
    }
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { if (args.some((v) => typeof v === 'number' && !Number.isFinite(v))) log.nan.push(String(k)); };
    },
    set(t, k, v) {
      if (k === 'globalAlpha' && !Number.isFinite(v)) log.nan.push('globalAlpha');
      t[k] = v;
      return true;
    }
  });
}

const { IDLE, CHARGE, POP, ABORT } = CHARGE_RING_PHASE;

test('koło: ładowanie → start = skok kompletności, potem znika', () => {
  const r = createChargeRing();
  let t = 10;
  for (let p = 0; p <= 1; p += 0.1, t += 1 / 60) stepChargeRing(r, 'hyper', 'charge', p, t);
  assert.equal(r.phase, CHARGE);
  assert.equal(r.kind, 'hyper');
  stepChargeRing(r, '', 'done', 0, t);
  assert.equal(r.phase, POP, 'pełne ładowanie i start lotu → skok kompletności');
  assert.equal(r.progress, 1);
  const t0 = t;
  for (; t < t0 + CHARGE_RING_TUNE.popS - 0.02; t += 1 / 60) stepChargeRing(r, '', 'done', 0, t);
  assert.equal(r.phase, POP, 'skok trwa popS');
  stepChargeRing(r, '', 'done', 0, t0 + CHARGE_RING_TUNE.popS + 0.01);
  assert.equal(r.phase, IDLE);
  assert.equal(chargeRingVisible(r), false);
  // długi lot ('done' bez ładowania) nie odpala skoku ponownie
  stepChargeRing(r, '', 'done', 0, t0 + 2);
  assert.equal(r.phase, IDLE);
});

test('koło: przerwane ładowanie gaśnie (bez skoku), nowe ładowanie przerywa skok', () => {
  const r = createChargeRing();
  stepChargeRing(r, 'warp', 'charge', 0.4, 1);
  stepChargeRing(r, '', '', 0, 1.016);
  assert.equal(r.phase, ABORT);
  assert.equal(r.progress, 0.4, 'gaśnie od miejsca przerwania');
  stepChargeRing(r, '', '', 0, 1.016 + CHARGE_RING_TUNE.abortS + 0.01);
  assert.equal(r.phase, IDLE);

  stepChargeRing(r, 'warp', 'charge', 1, 2);
  stepChargeRing(r, '', 'done', 0, 2.016);
  assert.equal(r.phase, POP);
  stepChargeRing(r, 'hyper', 'charge', 0.1, 2.05);
  assert.equal(r.phase, CHARGE);
  assert.equal(r.kind, 'hyper');
});

test('koło: przejście po przerwie w krokach (celownik schowany) się nie liczy', () => {
  const r = createChargeRing();
  stepChargeRing(r, 'warp', 'charge', 0.5, 1);
  // celownik schowany (RTS, koło trybów) — warp ruszył bez kroków koła
  stepChargeRing(r, '', 'done', 0, 1 + CHARGE_RING_TUNE.staleS + 0.5);
  assert.equal(r.phase, IDLE, 'bez spóźnionego skoku');
});

test('koło: rysunek — tor, wypełnienie od góry zgodnie z zegarem, skok rośnie i gaśnie, bez NaN', () => {
  const R = 27;
  const r = createChargeRing();
  stepChargeRing(r, 'warp', 'charge', 0.25, 0);
  let ctx = fakeCtx();
  drawChargeRing(ctx, 400, 300, R, r, 0, 1);
  const fill = ctx.log.arcs.filter((a) => a.color === CHARGE_RING_COLORS.warp && a.alpha === 1 && a.r === R);
  assert.ok(ctx.log.arcs.some((a) => a.r === CHARGE_RING_TUNE.head), 'jasna główka na końcu wypełnienia');
  assert.equal(fill.length, 1);
  assert.ok(Math.abs(fill[0].a0 + Math.PI / 2) < 1e-9, 'od góry');
  assert.ok(Math.abs(fill[0].a1 - fill[0].a0 - Math.PI / 2) < 1e-9, 'ćwierć koła przy 25%');
  assert.deepEqual(ctx.log.nan, []);

  stepChargeRing(r, '', 'done', 0, 0.01);
  const radii = [];
  for (let k = 0; k <= 10; k++) {
    const now = 0.01 + (k / 10) * CHARGE_RING_TUNE.popS * 0.98;
    ctx = fakeCtx();
    drawChargeRing(ctx, 400, 300, R, r, now, 1.33);
    assert.deepEqual(ctx.log.nan, []);
    const ring = ctx.log.arcs.find((a) => a.color === CHARGE_RING_COLORS.warp);
    radii.push(ring.r);
    if (k === 10) assert.ok(ring.alpha < 0.05, 'pod koniec skoku koło prawie zgasło');
  }
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i] >= radii[i - 1], 'koło rośnie przez cały skok');
  assert.ok(radii.at(-1) > R * (1 + CHARGE_RING_TUNE.popGrow * 0.9), 'skok kompletności = wyraźne powiększenie');
  ctx = fakeCtx();
  drawChargeRing(ctx, 400, 300, R, r, 0.01 + CHARGE_RING_TUNE.punchS * 0.5, 1);
  const flash = ctx.log.arcs.find((a) => a.color === CHARGE_RING_COLORS.flash);
  assert.ok(flash && flash.r > R * 1.2, 'biały błysk podskakuje');
});

function warpHud(over) {
  return {
    state: 'idle', exiting: false, autoExit: false, aligned: false, canWarp: true, inCone: false, detour: false, wellExit: false,
    err: 0, dist: 1_234_000, along: 1_200_000, miss: 900, exitIn: 4.25, label: 'MARS', jumpKind: '',
    clipX: 0, clipW: 1920, height: 1080, scale: 1, radius: 90, shipX: 960, shipY: 540,
    headingScreen: -Math.PI / 2, bearingScreen: -Math.PI / 2 + 0.1, previewX: 960, previewY: 200, ...over
  };
}

test('warp pod kursorem: dwie linie dla każdego stanu', () => {
  const out = {};
  const L = (over) => warpCursorLines(warpHud(over), out);
  assert.equal(L({ aligned: true }).status, 'WARP · KURS OK · CAPS');
  assert.equal(out.color, '#75efb0');
  assert.equal(out.detail, 'MARS · 1234 km');
  assert.equal(L({ inCone: true, err: -0.2 }).status, '← 11,5° · CAPS: SKOK KURSEM');
  assert.equal(L({ err: 0.6 }).status, 'DO KURSU 34,4° D →');
  assert.equal(out.color, '#ffc978');
  assert.equal(L({ canWarp: false, wellExit: true }).status, 'STUDNIA · WYLEĆ NAPĘDEM');
  assert.equal(L({ canWarp: false, detour: true }).status, 'OBJAZD STUDNI · NAPĘDEM');
  assert.equal(L({ state: 'charging', autoExit: true }).status, 'WARP · ŁADOWANIE · AUTO');
  assert.equal(out.detail, 'MARS · 1200 km');
  assert.equal(L({ state: 'active', autoExit: true }).status, 'WARP · WYJŚCIE ZA 4,3 s');
  assert.equal(L({ state: 'active' }).status, 'WARP · WYJŚCIE ZA 4,3 s · CAPS');
  assert.equal(out.color, '#ff897e');
  assert.equal(out.detail, 'MARS · MINIĘCIE 900 m');
  assert.equal(L({ state: 'active', exitIn: 0.1 }).status, 'WYJDŹ TERAZ · CAPS');
  assert.equal(L({ state: 'active', exitIn: -1 }).status, 'WARP · ZA PÓŹNO');
  assert.equal(L({ state: 'active', along: -5 }).status, 'WARP · CEL ZA STATKIEM');
  assert.equal(L({ exiting: true, autoExit: true }).status, 'WARP · HAMOWANIE');
  assert.equal(out.detail, 'MARS');
  assert.equal(L({ label: '', aligned: true }).detail, 'PUNKT KURSU · 1234 km');

  const ctx = fakeCtx();
  drawWarpCursorInfo(ctx, 500, 400, L({ aligned: true }), 1.33);
  assert.deepEqual(ctx.log.text, ['WARP · KURS OK · CAPS', 'MARS · 1234 km']);
  assert.deepEqual(ctx.log.nan, []);
});

test('HUD kursu warpa: bez ramki u góry ekranu (pasmo i groty przy statku zostają)', () => {
  const ctx = fakeCtx();
  drawWarpCourseHud(ctx, warpHud({ state: 'active', autoExit: true }));
  assert.equal(ctx.log.rects, 0, 'bez prostokąta ramki');
  assert.deepEqual(ctx.log.text, [], 'bez napisów — stan skoku jest pod kursorem');
  assert.ok(ctx.log.arcs.some((a) => a.r === 90), 'pasmo ±5° przy statku');
  assert.deepEqual(ctx.log.nan, []);
});

test('klej gry: kursor dostaje koło ładowania i stan skoku, celownik zimny w warpie', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('function _drawPlayerReticle('), html.indexOf('function _drawPlayerHitMarker('));
  assert.equal((body.match(/_drawCursorDriveInfo\(cursor, scale/g) || []).length, 2, 'oba warianty celownika (zwykły, torpedy / kopalnia)');
  assert.match(body, /opts\.cold = [^\n]*warp\.isBusy\(\)/);
  const fn = html.slice(html.indexOf('function _drawCursorDriveInfo('), html.indexOf('function _drawReticle('));
  assert.match(fn, /hypercruiseSpoolProgress\(hypercruise\)/);
  assert.match(fn, /warp\.charge\) \|\| 0\) \/ warp\.chargeTime/);
});
