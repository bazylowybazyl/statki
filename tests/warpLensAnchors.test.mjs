// Etap 3A nowego warpa „podniesiony świat” (DECYZJE E1–E4, 2026-10-26): REJESTR KOTWIC soczewki (rzeczy przypięte do
// ciał — ring, stacje, doki — jadą obrazem ciała, β → 0 = prawdziwe miejsce), REKORDY DODATKOWE (komety, olbrzymy,
// Hidalgo, doki bez ciała — ta sama mapa co ciała), PUNKTY (floty, NPC, wraki — kropki na pozycjach mapy C), ukrycie
// skór przy β, mgła wojny, HUD gaszony z β, warstwy pod statkiem.
// node --test tests/warpLensAnchors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  WarpWorldLens, WARP_WORLD_LENS, WARP_LENS_ANCHORS, WARP_LENS_EXTRA, WARP_LENS_UNDER_Z, newLensBody, mapWorldLens,
  warpLensAnchorSlot, writeLensAnchor, lensAnchorPoint, lensImageToWorld, lensPivotElements, warpLensExtraBody,
  setWarpLensExtra, clearWarpLensAnchors, warpLensAnchorOn, dropWarpLensExtra, lensDiscInFrame
} from '../src/3d/warp/worldLens.js';
import {
  warpLensHudBeta, warpLensFrontBeta, warpLensBeta, warpExitFrontS, warpLensDotFor, WARP_LENS_DOT_SWAP, WARP_LENS_PHASE,
  warpExitFrontCross, warpLensPointBeta, warpLensPointExitBeta
} from '../src/render/warpLensPhase.js';
import { PORT_DOCK_ANCHOR_IDS, portDockAnchorCode, applyPortDockBlock, createPortDockBlock } from '../src/render/blocks/portDockBlock.js';
import { SnapshotPacker, createSnapshotFrame } from '../src/render/snapshotPack.js';
import { LIST, ENT, ENT_FLAG } from '../src/render/snapshotLayout.js';
import { PORT_DOCK_KIND_IDS, BERTH_MIX_IDS, PORT_DOCK_STYLE_IDS } from '../src/data/portDocks.js';

const { Core3D } = await import('../src/3d/core3d.js');
const { updatePortDocks3D, PORT_DOCKS3D } = await import('../src/3d/portDocks3D.js');
const { HexBodyImpostorBatch, HexBodyLensBatch, WARP_LENS_DOT_Z } = await import('../src/3d/hexBodyImpostorBatch.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);

// Kadr 1080p jak w grze: kamera perspektywy passów (FOV 35°), statek w skoku obok środka kadru, obrót kadru.
function makeCtx(beta, o = {}) {
  const zoom = 0.12;
  const H = 1080;
  const W = 1920;
  const focal = (H * 0.5) / Math.tan((35 * Math.PI / 180) * 0.5);
  const camX = 5_000_000;
  const camY = -3_000_000;
  const roll = o.roll ?? 0.3;
  const shipX = camX + 900;
  const shipY = camY - 400;
  const rc = Math.cos(roll);
  const rs = Math.sin(roll);
  const wx = shipX - camX;
  const wy = shipY - camY;
  return {
    ...WARP_WORLD_LENS, active: true, beta, zoom, W, H, focal, camZ: focal / zoom, camX, camY, roll, shipX, shipY,
    shipSx: (rc * wx + rs * wy) * zoom, shipSy: (-rs * wx + rc * wy) * zoom, anchorSx: o.anchorSx ?? 20, anchorSy: o.anchorSy ?? 160,
    velAngle: o.velAngle ?? -1.2, hullHalfLen: 108, hullHalfWid: 40, dt: 1 / 60, target: null, origin: null,
    exitAge: o.exitAge ?? -1, exitSlow: o.exitSlow ?? 0.7, exitHalt: 0, arriving: null
  };
}

function body(id, kind, x, y, r, z, ctx) {
  const b = newLensBody(id, kind);
  b.x = x; b.y = y; b.r = r; b.z = z;
  b.flat = z === 0 ? ctx.zoom : ctx.focal / Math.max(1, ctx.camZ - z);
  b.gate = 1;
  b.ready = true;
  return b;
}

test('rejestr kotwic: rzecz przypięta do ciała jedzie jego obrazem; β → 0 = prawdziwe miejsce (płaszczyzna i tło z paralaksą)', () => {
  for (const beta of [0, 1]) {
    const ctx = makeCtx(beta);
    const lens = new WarpWorldLens();
    const ceres = body('ceres', 'small', ctx.shipX + 60_000, ctx.shipY + 30_000, 4717, 0, ctx);
    const venus = body('venus', 'planet', ctx.shipX - 210_000, ctx.shipY + 90_000, 12_600, -50_000, ctx);
    for (let f = 0; f < 3; f++) {
      ceres.ready = venus.ready = true;
      lens.update([ceres, venus], 2, ctx);
    }
    for (const b of [ceres, venus]) {
      const slot = writeLensAnchor({ on: false }, ctx, b, b.out.size, true);
      // stacja / dok przy ciele (punkt płaszczyzny gry)
      const px = b.x + 8000;
      const py = b.y - 3000;
      const p = lensAnchorPoint(slot, px, py, {});
      if (beta === 0) {
        near(p.x, px, 1e-6 * Math.abs(px), `${b.id} β 0: x prawdziwe`);
        near(p.y, py, 1e-6 * Math.abs(py), `${b.id} β 0: y prawdziwe`);
        near(slot.k, 1, 1e-9, `${b.id} β 0: skala 1`);
        near(slot.real, 1, 1e-12, `${b.id} β 0: prawdziwy widok`);
      } else {
        // β = 1: kotwica = punkt płaszczyzny pod obrazem środka ciała, skala = promień obrazu / prawdziwy promień
        const a = lensImageToWorld(ctx, b.out.x, b.out.y, 0, true, {});
        near(slot.x, a.x, 1e-6, `${b.id} β 1: kotwica pod obrazem (x)`);
        near(slot.y, a.y, 1e-6, `${b.id} β 1: kotwica pod obrazem (y)`);
        near(slot.k, b.out.size / (b.flat * b.r), 1e-12, `${b.id} β 1: skala obrazu`);
        assert.ok(slot.k < 0.5, `${b.id}: obraz mniejszy od prawdziwego`);
        // rzecz przypięta maleje razem z ciałem: jej odstęp na ekranie / prawdziwy odstęp = obraz ciała / prawdziwy obraz
        const rel = Math.hypot(p.x - slot.x, p.y - slot.y) / Math.hypot(8000, 3000);
        near(rel, b.out.size / (b.flat * b.r), 1e-9, `${b.id}: ta sama skala co ciało`);
      }
    }
  }
});

test('rejestr kotwic: klucz = id ciała, ten sam rekord, on gaśnie poza soczewką; zasięg rzeczy przypiętych w decyzji wejścia', () => {
  const s = warpLensAnchorSlot('test-anchor');
  assert.equal(warpLensAnchorSlot('test-anchor'), s);
  assert.equal(WARP_LENS_ANCHORS['test-anchor'], s);
  s.on = true; s.real = 0.5;
  assert.equal(warpLensAnchorOn('test-anchor'), s);
  s.real = 1;
  assert.equal(warpLensAnchorOn('test-anchor'), null, 'prawdziwy widok — rzecz na swoim miejscu');
  s.on = true; s.real = 0.2;
  clearWarpLensAnchors();
  assert.equal(s.on, false);
  delete WARP_LENS_ANCHORS['test-anchor'];
  // Decyzja wejścia: ciało poza kadrem, ale dok przypięty do niego w kadrze (statek w doku) — tryb RUCHU (bez
  // przestawienia doku pod statkiem w klatce emerge0); bez zasięgu — wynurzenie w miejscu.
  const ctx = makeCtx(0.5);
  for (const attachR of [0, 305_000]) {
    const lens = new WarpWorldLens();
    // ciało 300 tys. j. przed dziobem (obraz w soczewce ~70 × mniejszy od prawdziwego — wynurzenie), dok przy statku
    const b = body('ceres', 'small', ctx.shipX + 300_000 * Math.cos(ctx.velAngle), ctx.shipY + 300_000 * Math.sin(ctx.velAngle), 4717, 0, ctx);
    b.attachR = attachR;
    lens.update([b], 1, { ...ctx, beta: 0 });
    b.ready = true;
    lens.update([b], 1, { ...ctx, beta: 0.01 });
    assert.equal(b.entry, attachR ? 1 : 2, `zasięg ${attachR}: tryb ${b.entry}`);
  }
});

test('rekordy dodatkowe (komety, olbrzymy, Hidalgo, doki bez ciała): ta sama mapa i przejścia co ciała, rekord raz na klucz', () => {
  const rec = warpLensExtraBody('test:extra', 'small');
  assert.equal(warpLensExtraBody('test:extra', 'small'), rec, 'jeden rekord na klucz');
  assert.ok(WARP_LENS_EXTRA.includes(rec));
  assert.equal(rec.anchor, warpLensAnchorSlot('test:extra'), 'kotwica rekordu w rejestrze');
  setWarpLensExtra(rec, 5_100_000, -2_950_000, 30_000, 0);
  assert.equal(rec.alive, true);
  assert.equal(rec.plane, true);
  setWarpLensExtra(rec, 5_100_000, -2_950_000, 30_000, -56_000);
  assert.equal(rec.plane, false, 'skała pod płaszczyzną — tło z perspektywą');
  // Ten sam przebieg co ciało o tych samych danych → ten sam obraz (jedno źródło matematyki).
  for (const beta of [0.3, 1]) {
    const ctx = makeCtx(beta);
    const a = body('ref', 'small', rec.x, rec.y, rec.r, rec.z, ctx);
    const e = rec;
    e.flat = a.flat; e.gate = 1; e.ready = true; e.entry = 0; e.entrySession = -1; e.seenFrame = -1;
    e.cross = -1; e.lateAge = -1; e.gatePrev = 1; e.gateOpenSession = -1; e.attachR = 0;
    const l1 = new WarpWorldLens();
    const l2 = new WarpWorldLens();
    l1.update([a], 1, ctx);
    l2.update([e], 1, ctx);
    for (const k of ['x', 'y', 'size', 'beta', 'realW']) near(e.out[k], a.out[k], 1e-9, `β ${beta}: ${k}`);
  }
  WARP_LENS_EXTRA.splice(WARP_LENS_EXTRA.indexOf(rec), 1);
  delete WARP_LENS_ANCHORS['test:extra'];
  // planet3d dokłada rekordy do przebiegu ciał i pisze ich kotwice; poza soczewką zeruje `alive`
  const planets = read('src/3d/planet3d.assets.js');
  assert.match(planets, /for \(let i = 0; i < WARP_LENS_EXTRA\.length; i\+\+\) \{\s*const b = WARP_LENS_EXTRA\[i\];\s*if \(!b\.alive\) continue;\s*b\.flat = b\.plane \? L\.zoom : L\.focal \/ Math\.max\(1, L\.camZ - b\.z\);/);
  assert.match(planets, /writeLensAnchor\(b\.anchor \|\| warpLensAnchorSlot\(b\.id\), L, b, fit\.size, !fit\.off\);/);
});

test('punkty (floty, NPC, wraki): mapPoint = mapa C w płaszczyźnie gry, β → 0 = prawdziwe miejsce, w wyjściu front smug gwiazd', () => {
  const pts = [[30_000, -8000], [-250_000, 40_000], [700_000, 1_200_000], [-1500, 900]];
  for (const beta of [0, 0.45, 1]) {
    const ctx = makeCtx(beta);
    const lens = new WarpWorldLens();
    lens.update([], 0, ctx);
    for (const [ox, oy] of pts) {
      const out = lens.mapPoint(ctx.shipX + ox, ctx.shipY + oy, {});
      const rc = Math.cos(ctx.roll);
      const rs = Math.sin(ctx.roll);
      const dx = rc * ox + rs * oy;
      const dy = -rs * ox + rc * oy;
      assert.equal(out.beta, beta);
      if (beta === 0) {
        near(out.x, ctx.shipSx + ctx.zoom * dx, 1e-6, 'β 0: x prawdziwe');
        near(out.y, ctx.shipSy + ctx.zoom * dy, 1e-6, 'β 0: y prawdziwe');
      }
      if (beta === 1) {
        // bezstanowa mapa jednego ciała (mapWorldLens) przy tej samej kotwicy — ta sama mapa C
        const m = mapWorldLens(dx, dy, 0, {
          zoom: ctx.zoom, beta: 1, velAngle: ctx.velAngle - ctx.roll, viewHalfW: ctx.W / 2, viewHalfH: ctx.H / 2,
          shipSx: ctx.anchorSx, shipSy: ctx.anchorSy
        });
        near(out.x, ctx.anchorSx + m.x, 1e-6, 'β 1: x = mapa C');
        near(out.y, ctx.anchorSy + m.y, 1e-6, 'β 1: y = mapa C');
        near(out.q, m.q, 1e-12, 'β 1: skala');
      }
    }
  }
  // Wyjście: front smug gwiazd (od dziobu ku rufie) — punkt, który front minął ponad `submerge` s temu, wrócił do świata,
  // za frontem jeszcze w soczewce.
  const ctx = makeCtx(1, { exitAge: 0.35, exitSlow: 0.7, velAngle: -Math.PI / 2, roll: 0 });
  const lens = new WarpWorldLens();
  lens.update([], 0, ctx);
  const f = warpExitFrontS(0.35, 0.7);
  const ahead = lens.mapPoint(ctx.shipX, ctx.shipY - (f + 40_000), {});
  const behind = lens.mapPoint(ctx.shipX, ctx.shipY - (f - 40_000), {});
  assert.equal(ahead.beta, 0, 'przed frontem: prawdziwy świat');
  near(behind.beta, 1, 1e-9, 'za frontem: soczewka');
  // poza soczewką (reset) — prawdziwy obraz
  lens.reset();
  const off = lens.mapPoint(ctx.shipX + 10_000, ctx.shipY, {});
  assert.equal(off.beta, 0);
  assert.equal(off.alpha, 1);
});

test('punkty w wyjściu (W1): front mija PRAWDZIWE miejsce (odwrotność frontu, j. świata), powrót w 0,3 s — bez skoku; strona = render', () => {
  const P = WARP_LENS_PHASE;
  // odwrotność frontu: front(t_c(a)) = a w paśmie frontu; przed startem frontu — 0, za końcem — exitSlow
  for (const a of [17_000, 9000, 0, -4000, -17_500]) near(warpExitFrontS(warpExitFrontCross(a, 0.7), 0.7), a, 1e-6, `front(${a})`);
  assert.equal(warpExitFrontCross(40_000, 0.7), 0);
  near(warpExitFrontCross(-40_000, 0.7), 0.7, 1e-12, 'za końcem frontu');
  for (let a = -20_000; a < 20_000; a += 1000) assert.ok(warpExitFrontCross(a, 0.7) >= warpExitFrontCross(a + 1000, 0.7), 'dziób wcześniej niż rufa');
  // udział punktu: b0 · zanurzenie od przejścia frontu; po zwolnieniu + zanurzeniu — 0 wszędzie
  const ex = (t) => ({ state: 'idle', exitAge: t, exitSlow: 0.7, exitBeta: 1, hyper: false });
  near(warpLensPointBeta(ex(0.15), 30_000), 1 - (0.5 * 0.5 * (3 - 1)), 1e-12, 'punkt przed startem frontu: zanurza się od chwili 0');
  assert.equal(warpLensPointBeta(ex(0.7 + P.submerge), -40_000), 0);
  assert.equal(warpLensPointBeta({ state: 'active', kickAge: 3 }, 5000), 1, 'lot: β osi');
  near(warpLensPointExitBeta(0.6, 0.2, 0.7, 50_000), 0.6 * (1 - (2 / 3) * (2 / 3) * (3 - 4 / 3)), 1e-12, 'wyjście w trakcie kopu: × β wyjścia');
  // ciągłość: kadr 1080p, zoom 0,12, 60 Hz — kropka widoczna (krycie > 0,1) przesuwa się ≤ 70 px na klatkę (dawniej pasmo HUD-u:
  // 240–895 px), punkt z prawdziwym miejscem poza kadrem stoi w obrazie, póki gaśnie; decyzja strony = udział renderu
  const pts = [[0, -5000], [0, -12000], [0, -25000], [3000, -3000], [0, 4000], [6000, 0], [500, -800], [40_000, -40_000]];
  for (const [ox, oy] of pts) {
    let prev = null;
    let maxStep = 0;
    let swap = null;
    for (let fr = 0; fr <= 72; fr++) {
      const age = fr / 60;
      const c = makeCtx(1, { exitAge: age, exitSlow: 0.7, velAngle: -Math.PI / 2, roll: 0, anchorSx: 0, anchorSy: 160 });
      Object.assign(c, { shipSx: 0, shipSy: 0, camX: c.shipX, camY: c.shipY });
      const l = new WarpWorldLens();
      l.update([], 0, c);
      const o = { ...l.mapPoint(c.shipX + ox, c.shipY + oy, {}, 400) };
      // strona gry: kurs (0, −1) w świecie gry — wzdłuż kursu = −oy
      near(warpLensPointBeta(ex(age), -oy), o.beta, 1e-12, `strona = render (${ox}, ${oy}) @${age}`);
      assert.equal(warpLensDotFor(ex(age), ox, oy, 0, -1, 0.12, false), o.beta >= WARP_LENS_DOT_SWAP);
      if (prev && prev.alpha > 0.1 && o.alpha > 0.1) maxStep = Math.max(maxStep, Math.hypot(o.x - prev.x, o.y - prev.y));
      if (swap === null && o.beta < WARP_LENS_DOT_SWAP) swap = o;
      prev = o;
    }
    assert.ok(maxStep <= 70, `(${ox}, ${oy}): ruch widocznej kropki ${maxStep.toFixed(0)} px/kl`);
    // oddanie skórze: kropka na prawdziwym miejscu (w kadrze) albo zgaszona (poza kadrem)
    const real = [0.12 * ox, 0.12 * oy];
    const inFrame = lensDiscInFrame(real[0], real[1], 0.12 * 400, 1920, 1080);
    // (β 0,02: skala ~97% i kotwica kadru 160 px × β)
    if (inFrame) assert.ok(Math.hypot(swap.x - real[0], swap.y - real[1]) < 0.03 * (Math.hypot(real[0], real[1]) + 160) + 2, `(${ox}, ${oy}) na prawdziwym miejscu`);
    else assert.ok(swap.alpha < 0.05 || Math.hypot(swap.x - real[0], swap.y - real[1]) < 0.05 * Math.hypot(real[0], real[1]), `(${ox}, ${oy}) zgaszona albo na miejscu poza kadrem`);
  }
});

test('HUD (E4) i kropki (E2): ta sama oś — warpLensHudBeta / warpLensFrontBeta; mgła wojny wygrywa', () => {
  const s = { state: 'charging', charge: 0.5, kickAge: NaN, exitAge: -1, exitSlow: NaN, exitBeta: NaN, abortAge: -1, abortBeta: 0, hyper: false };
  near(warpLensHudBeta(s), warpLensBeta(s), 1e-12, 'ładowanie: cała warstwa z β');
  near(1 - warpLensHudBeta(s), 1 - 0.45, 1e-12, 'alfa znaczników = 1 − β');
  // wyjście: front (dawny wzór HUD-u bez zmian)
  const ex = { state: 'idle', exitAge: 0.3, exitSlow: 0.7, exitBeta: 1, hyper: false };
  for (const y of [-3000, 0, 500, 5000]) {
    const f = warpExitFrontS(0.3, 0.7) * 0.12;
    const t = Math.min(1, Math.max(0, (f - y + WARP_LENS_PHASE.hudBand) / (2 * WARP_LENS_PHASE.hudBand)));
    near(warpLensHudBeta(ex, y, 0.12), t * t * (3 - 2 * t), 1e-12, `front y ${y}`);
    near(warpLensFrontBeta(1, 0.3, 0.7, y, 0.12), warpLensHudBeta(ex, y, 0.12), 1e-15, 'jedno źródło');
  }
  assert.equal(warpLensHudBeta({ ...ex, exitAge: 0.8 }, 0, 0.12), 0, 'po zwolnieniu znaczniki wróciły');
  // decyzja kropki: od progu WARP_LENS_DOT_SWAP, ukryta mgłą — nigdy
  const fly = { state: 'active', kickAge: 3, exitAge: -1, hyper: false };
  assert.equal(warpLensDotFor(fly, 1000, 0, 1, 0, 0.12, false), true);
  assert.equal(warpLensDotFor(fly, 1000, 0, 1, 0, 0.12, true), false, 'mgła wojny: brak kropki');
  assert.equal(warpLensDotFor({ ...s, charge: 0.05 }, 0, 0, 1, 0, 0.12, false), 0.9 * 0.05 * 0.05 * (3 - 0.1) >= WARP_LENS_DOT_SWAP);
  assert.equal(warpLensDotFor({ state: 'idle', exitAge: -1, hyper: false }, 0, 0, 1, 0, 0.12, false), false, 'poza skokiem');
  // wpięcie strony: znaczniki świata × alfa, kontakty, podpisy planet, nakładki NPC; HUD kursu warpa bez zmian
  const html = read('index.html');
  assert.match(html, /_hudLensAlpha = warpLensOverlayAllowed\(\) \? 1 - warpLensHudBeta\(s\) : 1;/);
  assert.match(html, /if \(_hudLensAlpha < 0\.999\) ctx\.globalAlpha \*= _hudLensAlpha;\s*ContactMarkers\.draw\(/);
  assert.match(html, /if \(hudLensA < 0\.999\) ctx\.globalAlpha \*= hudLensA;\s*if \(hudLensWorld\) InfrastructureUI\.drawInstances\(ctx, cam\);\s*drawPlanetLabels\(ctx, cam\);/);
  // absolutna alfa w rysunku (liny, zaznaczenie, ikony infrastruktury) — chowane od progu kropki (D1)
  assert.match(html, /function warpLensHudWorld\(\) \{ return _hudLensAlpha > 1 - WARP_LENS_DOT_SWAP; \}/);
  assert.match(html, /if \(hudLensWorld\) drawTowRopes\(ctx, cam\);/);
  assert.match(html, /if \(hudLensWorld\) \{\s*ctx\.save\(\);\s*if \(hudLensA < 0\.999\) ctx\.globalAlpha \*= hudLensA;\s*drawSelectionOverlay\(/);
  assert.match(html, /_npcFogQuiet = SensorSystem\.hides\(npc\) \|\| npc\.__lensDot === true \|\| _hudLensAlpha < 0\.01;/);
  assert.doesNotMatch(html, /globalAlpha[^\n]*\n\s*drawWarpCourseHud/, 'HUD kursu warpa zostaje');
});

test('ukrycie skór przy β (E2): kropka = ukryta jak we mgle (predykat kadłubów, listy *_SEEN, flagi migawki), mgła bez kropki', () => {
  // migawka: encja z kropką — FOG_HIDDEN + LENS_DOT, poza SEEN; mgła — tylko FOG_HIDDEN; zwykła — nic
  const mk = (id, x) => ({ id, x, y: 0, pos: { x, y: 0 }, angle: 0, vel: { x: 0, y: 0 }, vx: 0, vy: 0, radius: 100, dead: false });
  const ship = mk(1, 0);
  const dot = mk(2, 5000);
  const fog = mk(3, 9000);
  const plain = mk(4, 12000);
  dot.__lensDot = true;
  const packer = new SnapshotPacker({ shared: false });
  const frame = createSnapshotFrame();
  Object.assign(frame, {
    frameId: 1, frameDt: 1 / 60, W: 1600, H: 900, cam: { x: 0, y: 0, zoom: 0.2 }, camNoShake: { x: 0, y: 0, zoom: 0.2 },
    ship, npcs: [dot, fog, plain], wrecks: [], coldWrecks: [], coldRenderList: [], stations: [], bullets: [],
    fog: true, lensDots: true, hides: (e) => e === fog || e.__lensDot === true
  });
  packer.begin(frame);
  const v = packer.view;
  const seen = packer._lists[LIST.SEEN];
  const slotOf = (e) => packer.ids.entities.slotOf(e);
  const flags = (e) => v.entI32[slotOf(e) * ENT.stride.i32 + ENT.I32.FLAGS];
  assert.ok(!seen.includes(dot) && !seen.includes(fog) && seen.includes(plain), 'SEEN bez kropki i mgły');
  assert.ok(!packer._lists[LIST.SEEN_COLD].includes(dot) && !packer._lists[LIST.NPCS_SEEN].includes(dot));
  assert.ok(flags(dot) & ENT_FLAG.FOG_HIDDEN, 'kropka: skóra schowana');
  assert.ok(flags(dot) & ENT_FLAG.LENS_DOT, 'kropka: render rysuje kropkę');
  assert.ok(flags(fog) & ENT_FLAG.FOG_HIDDEN);
  assert.ok(!(flags(fog) & ENT_FLAG.LENS_DOT), 'mgła: bez kropki');
  assert.ok(!(flags(plain) & (ENT_FLAG.FOG_HIDDEN | ENT_FLAG.LENS_DOT)));
  packer.finish(frame);
  // kropki bez mgły (mgła wyłączona w grze) — `hides` i tak pytany
  frame.fog = false;
  frame.hides = (e) => e.__lensDot === true;
  packer.begin(frame);
  assert.ok(flags(dot) & ENT_FLAG.FOG_HIDDEN);
  assert.ok(!packer._lists[LIST.SEEN].includes(dot));
  packer.finish(frame);
  // lustro workera i predykaty
  assert.match(read('src/render/renderMirror.js'), /m\.lensDot = \(flags & ENT_FLAG\.LENS_DOT\) !== 0;/);
  const html = read('index.html');
  assert.match(html, /setEntityHiddenTest\(\(e\) => \(e\.__mirror === true \? e\.fogHidden : \(SensorSystem\.hides\(e\) \|\| e\.__lensDot === true\)\)\);/);
  assert.match(html, /const _snapHides = \(e\) => SensorSystem\.hides\(e\) \|\| e\.__lensDot === true;/);
  assert.match(html, /if \(e && !SensorSystem\.hides\(e\) && e\.__lensDot !== true\) out\.push\(e\);/);
  assert.match(html, /e\.__lensDot = lensDotAt\(ex, ey, SensorSystem\.hides\(e\)\);/);
  assert.match(html, /return warpLensDotFor\(_warpLensPhase, x - c\.sx, y - c\.sy, c\.cu, c\.cv, 1, hidden\);/);
  // decyzja klatki przed listami obrazu; proxy ruchu v2 od progu kropki poza listą (W2); zimne wraki — dodatki per wrak (W3)
  assert.match(html, /prepareWarpLensDots\(\);\s*\/\/[^\n]*\n\s*trafficRenderFrame\(alpha\);\s*lensHideTrafficProxies\(_trafficRender\);/);
  assert.match(html, /const dot = _lensDotsActive && lensDotAt\(/);
  assert.match(html, /f\.coldNearExtras = coldWreckSystem\.config\.nearExtras !== false;/);
  assert.match(html, /if \(e === ship \|\| e === player2Ship\) \{ e\.__lensDot = false; continue; \}/, 'gracz zawsze normalnie');
  assert.match(html, /if \(e && e\.__lensDot === true\) e\.__lensDot = false;/, 'poza skokiem flagi zdjęte');
  // render: kropka z flagi (lustro / gra), skórę chowa predykat ukrycia (worker: fogHidden ⊃ kropka)
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /if \(lensDots && lensDotFlag\(entity\) && pushEntityLensDot\(entity\)\) lodFrameStats\.lensDots\+\+;\s*if \(entityHiddenTest && entityHiddenTest\(entity\)\) \{/);
  // kropka: krycie z mapy punktu (wyjście) × maskowanie (D2), najmniej ~2 px widocznej plamki (D7)
  assert.match(hex, /const opacity = img\.alpha \* \(cl && cl\.active \? Math\.max\(0, Math\.min\(1, Number\(cl\.vis\) \|\| 0\)\) : 1\);/);
  assert.match(hex, /minHalfLen: 2\.2,/);
  assert.match(hex, /minHalfWid: 1\.8,/);
  assert.match(read('src/render/render.worker.js'), /hex\.setEntityHiddenTest\(\(e\) => \(e\.__mirror === true \? e\.fogHidden : false\)\);/);
});

test('kropki soczewki: osobna partia na TYM SAMYM materiale smug, pod kadłubami (z ≤ WARP_LENS_UNDER_Z), jeden rysunek', () => {
  const prevScene = Core3D.scene;
  const prevInit = Core3D.isInitialized;
  Core3D.scene = new THREE.Scene();
  Core3D.isInitialized = true;
  try {
    HexBodyLensBatch.begin();
    assert.ok(HexBodyLensBatch.pushRaw(100, -50, 0.2, 40, 20, 0.5, 0.4, 0.3, 1));
    HexBodyLensBatch.flush();
    const lensMesh = Core3D.scene.children.find((o) => o.name === 'HexBodyLensBatch');
    const main = Core3D.scene.children.find((o) => o.material?.name === 'hull:impostor' && o !== lensMesh);
    assert.ok(lensMesh && main, 'dwie partie w scenie');
    assert.equal(lensMesh.material, main.material, 'wspólny materiał (ten sam graf i pipeline)');
    assert.equal(lensMesh.geometry.instanceCount, 1);
    assert.ok(lensMesh.visible);
    assert.ok(lensMesh.position.z === WARP_LENS_DOT_Z && WARP_LENS_DOT_Z <= WARP_LENS_UNDER_Z, 'pod kadłubami');
    HexBodyLensBatch.begin();
    HexBodyLensBatch.flush();
    assert.equal(lensMesh.visible, false, 'pusta partia schowana');
    HexBodyImpostorBatch.dispose();
  } finally {
    Core3D.scene = prevScene;
    Core3D.isInitialized = prevInit;
  }
  assert.match(read('src/3d/hexBodyImpostorBatch.js'), /Core3D\.warmup\?\.add\(\{ name: 'kropki soczewki skoku \(HexBodyLensBatch\)', objects: \(\) => \(ensureLensBuilt\(\) \? lensMesh : null\), layer: 0, phase: 'loading' \}\);/);
});

test('doki portów bez ringu (E1): dok jedzie obrazem ciała (księżyc bez bryły — planeta), pod statkiem, po skoku na miejscu', () => {
  // kod ciała w bloku migawki
  assert.equal(PORT_DOCK_ANCHOR_IDS[portDockAnchorCode('luna')], 'luna');
  assert.equal(PORT_DOCK_ANCHOR_IDS[portDockAnchorCode('venus')], 'venus');
  assert.equal(PORT_DOCK_ANCHOR_IDS[portDockAnchorCode('ceres')], 'ceres');
  assert.equal(PORT_DOCK_ANCHOR_IDS[portDockAnchorCode('fobos')], 'fobos');
  assert.equal(portDockAnchorCode('hilda-nest'), -1);
  const packer = new SnapshotPacker({ shared: false });
  packer.addBlock(createPortDockBlock());
  const rec = (stationId, kind, x, y) => ({
    stationId, kind, spec: { kind, mix: 'default', repeats: 1, dockCount: 2 }, x, y, angle: 0.4, style: 'earth',
    kindIndex: PORT_DOCK_KIND_IDS.indexOf(kind), mixIndex: BERTH_MIX_IDS.indexOf('default'), styleIndex: PORT_DOCK_STYLE_IDS.indexOf('earth')
  });
  const frame = createSnapshotFrame();
  frame.portDocks = { list: [rec('luna', 'cross', 1, 2), rec('hilda-nest', 'cross', 3, 4)], count: 2 };
  packer.begin(frame);
  const out = [];
  applyPortDockBlock(packer.view.blocks.portDocks, out);
  packer.finish(frame);
  assert.equal(out[0].anchorId, 'luna');
  assert.equal(out[1].anchorId, null);

  const prev = Core3D.scene;
  Core3D.scene = new THREE.Scene();
  const mars = warpLensAnchorSlot('mars');
  try {
    const saved = { zoom: WARP_WORLD_LENS.zoom, camX: WARP_WORLD_LENS.camX, camY: WARP_WORLD_LENS.camY, W: WARP_WORLD_LENS.W, H: WARP_WORLD_LENS.H, roll: WARP_WORLD_LENS.roll };
    Object.assign(WARP_WORLD_LENS, { zoom: 0.12, camX: 2_002_500, camY: 998_500, W: 1920, H: 1080, roll: 0.4 });
    // Fobos (bez bryły) → kotwica Marsa; obraz w soczewce
    Object.assign(mars, { on: true, x: 2_000_000, y: 1_000_000, k: 0.05, rx: 2_100_000, ry: 1_050_000, real: 0.1, vis: true, reach: 0 });
    const d = rec('fobos', 'cross', 2_150_000, 1_020_000);
    updatePortDocks3D([d], 1, 0, null);
    const root = Core3D.scene.children[0];
    assert.ok(root, 'budowla w scenie');
    const c = new THREE.Vector3(0, 0, 0).applyMatrix4(root.matrix);
    near(c.x, mars.x + mars.k * (d.x - mars.rx), 1e-3, 'środek doku: obraz Marsa + k · odstęp (x)');
    near(c.y, -(mars.y + mars.k * (d.y - mars.ry)), 1e-3, 'środek doku (y sceny)');
    near(c.z, 0, 1e-6, 'z bez przesunięcia — pod statkiem przez pass tła');
    assert.equal(root.visible, true, 'obraz doku w kadrze');
    assert.ok(mars.reach > Math.hypot(d.x - mars.rx, d.y - mars.ry), 'zasięg doku w kotwicy (decyzja wejścia Marsa)');
    let layers = new Set();
    root.traverse((o) => { if (o.isMesh) layers.add(o.layers.mask); });
    assert.deepEqual([...layers], [1 << 1], 'w soczewce cała budowla w passie tła (warstwa 1: perspektywa jak FG, przed passem gry)');
    // po skoku: ramka gry, FG nad statkami
    mars.on = false;
    updatePortDocks3D([d], 1, 0, null);
    const c2 = new THREE.Vector3(0, 0, 0).applyMatrix4(root.matrix);
    near(c2.x, d.x, 1e-6, 'po skoku: prawdziwe miejsce (x)');
    near(c2.y, -d.y, 1e-6, 'po skoku: prawdziwe miejsce (y)');
    layers = new Set();
    root.traverse((o) => { if (o.isMesh) layers.add(o.layers.mask); });
    assert.ok(layers.has(1 << 2), 'po skoku: zestaw FG znów nad statkami');
    // dok bez ciała — własny rekord soczewki
    updatePortDocks3D([rec('hilda-nest', 'cross', 9e5, 9e5)], 1, 0, null);
    assert.ok(WARP_LENS_EXTRA.some((r) => r.id.startsWith('dock:') && r.alive && r.x === 9e5), 'rekord dodatkowy doku');
    // obraz doku za kadrem — schowany (ciało może być w kadrze albo nie: liczy się obraz doku)
    mars.on = true;
    Object.assign(WARP_WORLD_LENS, { camX: 2_500_000 });
    updatePortDocks3D([d], 1, 0, null);
    assert.equal(root.visible, false, 'obraz doku poza kadrem');
    // D5: rekord doku bez ciała znika z budowlą zwolnioną z puli (rejestry nie rosną)
    mars.on = false;
    const own = WARP_LENS_EXTRA.find((r) => r.id.startsWith('dock:') && r.x === 9e5);
    const ownKey = own.id;
    for (let i = 0; i <= PORT_DOCKS3D.keep; i++) {
      const list = [];
      // inny kształt niż dok kryjówki — pula nie użyje go ponownie, tylko zwolni jako najdawniej widziany
      for (let j = 0; j <= i; j++) list.push(rec('luna', 'round', 7e5 + j * 1e4, 7e5));
      updatePortDocks3D(list, list.length, 0, null);
    }
    updatePortDocks3D([rec('luna', 'round', 7e5, 7e5)], 1, 0, null);
    assert.ok(!WARP_LENS_EXTRA.includes(own), 'rekord zwolniony');
    assert.equal(WARP_LENS_ANCHORS[ownKey], undefined, 'kotwica zwolniona');
    Object.assign(WARP_WORLD_LENS, saved);
  } finally {
    Core3D.scene = prev;
    mars.on = false;
  }
});

test('rekord dodatkowy: dropWarpLensExtra wyjmuje rekord z przebiegu i kotwicę z rejestru', () => {
  const rec = warpLensExtraBody('test:drop', 'small');
  const a = rec.anchor;
  a.on = true;
  dropWarpLensExtra(rec);
  assert.ok(!WARP_LENS_EXTRA.includes(rec));
  assert.equal(WARP_LENS_ANCHORS['test:drop'], undefined);
  assert.equal(a.on, false);
  assert.notEqual(warpLensAnchorSlot('test:drop'), a, 'nowy klucz — nowa kotwica');
  delete WARP_LENS_ANCHORS['test:drop'];
});

test('start z doku (D8): ciało poza kadrem, dok w kadrze — zasięg wymusza RUCH, obraz doku w ładowaniu i kopie ≤ 60 px na klatkę', () => {
  // Ceres poza kadrem (20–40 tys. j.), statek przy doku; ładowanie 0,8 s (β 0 → 0,9), kop 0,45 s, 60 Hz, kadr 1080p
  for (const [zoom, dist, ang] of [[0.12, 20_000, 2.4], [0.12, 40_000, 3.0], [0.3, 15_000, 2.4], [0.05, 25_000, 0]]) {
    const c = makeCtx(0, { roll: 0, velAngle: -0.3, anchorSx: 0, anchorSy: 160 });
    Object.assign(c, { zoom, camZ: c.focal / zoom, camX: c.shipX, camY: c.shipY, shipSx: 0, shipSy: 0 });
    const b = body('ceres', 'small', c.shipX + dist * Math.cos(ang), c.shipY + dist * Math.sin(ang), 4717, 0, c);
    const dock = { x: c.shipX + 600, y: c.shipY - 300 };
    b.attachR = Math.hypot(dock.x - b.x, dock.y - b.y) + 3000;
    const lens = new WarpWorldLens();
    const slot = { on: false };
    let prev = null;
    let maxStep = 0;
    for (let f = 0; f <= 75; f++) {
      const t = f / 60;
      c.beta = warpLensBeta(t <= 0.8 ? { state: 'charging', charge: t / 0.8 } : { state: 'active', kickAge: t - 0.8 });
      b.ready = true;
      lens.update([b], 1, c);
      writeLensAnchor(slot, c, b, b.out.size, true);
      const p = lensAnchorPoint(slot, dock.x, dock.y, {});
      const sx = (p.x - c.camX) * zoom;
      const sy = (p.y - c.camY) * zoom;
      if (prev) maxStep = Math.max(maxStep, Math.hypot(sx - prev[0], sy - prev[1]));
      prev = [sx, sy];
    }
    assert.equal(b.entry, 1, 'tryb ruchu');
    assert.ok(maxStep <= 60, `zoom ${zoom}, ${dist} j.: obraz doku ${maxStep.toFixed(1)} px/kl`);
  }
});

test('stacje, komety, olbrzymy, Hidalgo (E1, E3): kotwica ciała / rekord, warstwa pod statkiem, prawdziwy widok gaśnie od progu kropek', () => {
  const st = read('src/3d/stations3D.js');
  assert.match(st, /const id = station\?\.planet\?\.id;/, 'kotwica ciała stacji (gra: planeta, worker: opis planet.id)');
  assert.match(st, /lensAnchorPoint\(lens, station\.x, station\.y, _lensPt\);/);
  assert.match(st, /group\.position\.set\(_lensPt\.x, -_lensPt\.y, -100\);/, 'z jak poza soczewką (rzut bez zmian)');
  assert.match(st, /const STATION_LENS_LAYER = 1;/, 'pass tła — perspektywa jak FG, przed passem gry (W4)');
  assert.match(st, /if \(on\) group\.traverse\(\(child\) => \{ child\.layers\.set\(STATION_LENS_LAYER\); \}\);\s*else Core3D\.enableForeground3D\(group\);/);
  assert.match(read('src/3d/haloRing/haloRingGame.js'), /lensLayers: Object\.freeze\(\{ default: 1, fg: 1 \}\),/, 'ten sam wzór co ring w soczewce');
  const comets = read('src/3d/comets/comets3D.js');
  assert.match(comets, /setWarpLensExtra\(rec, s\.x, s\.y, s\.reach \* 1\.1, 0\);/);
  assert.match(comets, /const z = lens \? WARP_LENS_UNDER_Z - s\.R \* k \* 1\.5 : COMET_Z;/);
  const belt = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(belt, /rec = warpLensExtraBody\(`giant:\$\{e\.id\}`, 'small'\);\s*rec\.smudge = \{/);
  assert.match(belt, /&& !this\._giantLensed\(e\);/);
  assert.match(belt, /return !!\(a && a\.on && 1 - a\.real >= WARP_LENS_DOT_SWAP\);/);
  assert.match(read('src/3d/hexShips3D.js'), /!\(1 - a\.real >= WARP_LENS_DOT_SWAP\)\) continue;/, 'smuga od tego samego progu');
  const pb = read('src/3d/pirateBaseGame.js');
  assert.match(pb, /setWarpLensExtra\(_lensRec, rockAt\.x, rockAt\.y, R, cz\);/, 'Hidalgo jak małe ciało z głębokością');
  assert.match(pb, /lensImageToWorld\(WARP_WORLD_LENS, o\.x, o\.y, cz, false, _lensWorld\);/);
  assert.match(pb, /hidden: \(\) => fogHidden \|\| _lensOn,/);
  // macierz soczewki: punkt sceny p → A + s · (p − C), wyznacznik > 0
  const el = lensPivotElements(10, 20, -500, 0.25, 100, 200, 0, new Array(16));
  const m = new THREE.Matrix4().fromArray(el);
  const p = new THREE.Vector3(100, 200, 0).applyMatrix4(m);
  assert.deepEqual([p.x, p.y, p.z], [10, 20, -500]);
  const q = new THREE.Vector3(140, 200, 80).applyMatrix4(m);
  assert.deepEqual([q.x, q.y, q.z], [20, 20, -480]);
  assert.ok(m.determinant() > 0);
});
