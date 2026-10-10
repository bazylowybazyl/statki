// src/game/hullFootprint.js
//
// OBRYS KADŁUBA Z GÓRY jako maska bitowa w układzie kadłuba — z ŻYWYCH węzłów siatki belek (hullBodies.js):
// sylwetka okrętu (zwężony dziób, nadbudówki, wcięcia), a rany, wyrwy i odcięte części zmieniają obrys.
// Dziś: przeszkoda w polu gazu hal K-7 (src/game/hallDustInput.js → src/3d/gasField/gasField2D.js; zgłoszenie
// użytkownika 2026-10-07: „statek powinien rozcinać dym w takim kształcie, w jakim jest statek, a nie
// w prostokącie” — dawniej obrócone pudło 0,94 w × 0,78 h sprite'a).
//
// UKŁAD maski: układ ciała silnika belek względem kotwicy encji (statek — środek sprite'a, wrak — środek masy):
// X ku dziobowi obrazu, Y w górę obrazu. Do świata gry jak HullBodies.nodeWorld: θ = −(angle + rot),
// gra = poza + (c·X − s·Y, −(s·X + c·Y)), c = cos θ, s = sin θ (`rot` — obrót sprite'a encji).
// Maska w × h teksli: obrys komórek z żywymi węzłami + 1 teksel PUSTEGO brzegu z każdej strony (próbka liniowa
// obcięta do brzegu nie wycieka poza kadłub). Bit k = wiersz (Y) · w + kolumna (X) w słowach 32-bitowych.
// Teksel zapalony, gdy co najmniej połowa jego próbek (do 4 × 4, gęstość ~ komórka siatki) leży w komórce
// z żywym węzłem. Kadłub bez silnika belek — fazowany prostokąt z wymiarów sprite'a (jak haloShipOutline).
//
// Koszt: przebudowa tylko przy zmianie ciała (inne ciało, inna liczba żywych węzłów, przesunięta siatka —
// klucz jak hullMounts.js), ~0,1 ms; na klatkę O(1). Bez three i DOM (testy node).

import { HullBodies, hullSpriteRotation } from './hullBodies.js';

const _cache = new WeakMap();
let _occ = new Uint8Array(0);

function newFootprint(W, H) {
  return {
    W, H,
    words: new Uint32Array(Math.ceil((W * H) / 32)),
    x0: 0, y0: 0, tx: 1, ty: 1,   // róg maski i bok teksla w układzie kadłuba [j.]
    reach: 0,                     // najdalszy róg maski od kotwicy [j.]
    rot: 0,                       // obrót sprite'a encji (kurs osi X = angle + rot)
    cells: 0,                     // zapalone teksle (0 = brak obrysu)
    version: 0,                   // rośnie przy każdej przebudowie
    body: null, active: -1, lmx: NaN, lmy: NaN, ax: NaN, ay: NaN, fw: NaN, fh: NaN
  };
}

function setFrame(fp, xMin, yMin, xMax, yMax) {
  const W = fp.W, H = fp.H;
  fp.tx = Math.max(1e-6, (xMax - xMin) / (W - 2));
  fp.ty = Math.max(1e-6, (yMax - yMin) / (H - 2));
  fp.x0 = xMin - fp.tx;
  fp.y0 = yMin - fp.ty;
  const rx = Math.max(Math.abs(fp.x0), Math.abs(fp.x0 + W * fp.tx));
  const ry = Math.max(Math.abs(fp.y0), Math.abs(fp.y0 + H * fp.ty));
  fp.reach = Math.sqrt(rx * rx + ry * ry);
}

// Obrys z siatki belek: komórki (ix, iy) z żywym węzłem (dowolna warstwa z), w układzie kotwicy.
function rasterBody(fp, body, ax, ay) {
  const d = body.dims, s = body.nodeStore, cs = body.cellSize, n = d.x * d.y;
  if (_occ.length < n) _occ = new Uint8Array(n);
  else _occ.fill(0, 0, n);
  let ix0 = d.x, ix1 = -1, iy0 = d.y, iy1 = -1;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ix = s.ix[i], iy = s.iy[i];
    if (ix < 0 || iy < 0 || ix >= d.x || iy >= d.y) continue;
    _occ[ix + iy * d.x] = 1;
    if (ix < ix0) ix0 = ix;
    if (ix > ix1) ix1 = ix;
    if (iy < iy0) iy0 = iy;
    if (iy > iy1) iy1 = iy;
  }
  const words = fp.words;
  words.fill(0);
  fp.cells = 0;
  if (ix1 < 0) return;
  // komórka (ix, iy) = [lmx + ix·cs, lmx + (ix + 1)·cs] × [lmy + iy·cs, …] w układzie kotwicy
  const lmx = body.latticeMin.x - ax, lmy = body.latticeMin.y - ay;
  setFrame(fp, lmx + ix0 * cs, lmy + iy0 * cs, lmx + (ix1 + 1) * cs, lmy + (iy1 + 1) * cs);
  const W = fp.W, H = fp.H, tx = fp.tx, ty = fp.ty, x0 = fp.x0, y0 = fp.y0;
  const kx = Math.min(4, Math.max(1, Math.ceil(tx / cs - 1e-6)));
  const ky = Math.min(4, Math.max(1, Math.ceil(ty / cs - 1e-6)));
  const need = kx * ky;
  const inv = 1 / cs;
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      let c = 0;
      for (let b = 0; b < ky; b++) {
        const cy = Math.floor((y0 + (j + (b + 0.5) / ky) * ty - lmy) * inv);
        if (cy < 0 || cy >= d.y) continue;
        const row = cy * d.x;
        for (let a = 0; a < kx; a++) {
          const cx = Math.floor((x0 + (i + (a + 0.5) / kx) * tx - lmx) * inv);
          if (cx >= 0 && cx < d.x && _occ[row + cx]) c++;
        }
      }
      if (2 * c >= need) {
        const k = j * W + i;
        words[k >>> 5] |= 1 << (k & 31);
        fp.cells++;
      }
    }
  }
}

// Bez silnika belek: fazowany prostokąt (dziób, burty, rufa — kadłuby węższe na końcach), jak haloShipOutline;
// bez wymiarów sprite'a — koło z promienia.
function rasterBox(fp, w, h, r) {
  const words = fp.words;
  words.fill(0);
  fp.cells = 0;
  const hw = w > 0 && h > 0 ? w * 0.5 : r;
  const hh = w > 0 && h > 0 ? h * 0.45 : r;
  const round = !(w > 0 && h > 0);
  setFrame(fp, -hw, -hh, hw, hh);
  const cw = hw * 0.82, ch = hh * 0.62;
  const W = fp.W, H = fp.H;
  for (let j = 1; j < H - 1; j++) {
    const Y = Math.abs(fp.y0 + (j + 0.5) * fp.ty);
    for (let i = 1; i < W - 1; i++) {
      const X = Math.abs(fp.x0 + (i + 0.5) * fp.tx);
      const inside = round
        ? X * X + Y * Y <= r * r
        : X <= hw && Y <= hh && (X - cw) / (hw - cw) + (Y - ch) / (hh - ch) <= 1;
      if (inside) {
        const k = j * W + i;
        words[k >>> 5] |= 1 << (k & 31);
        fp.cells++;
      }
    }
  }
}

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Obrys kadłuba encji w masce W × H (rekord z pamięci encji — nie zmieniać; przebudowa tylko przy zmianie
 * ciała). Zwraca null bez encji. `allowRebuild` false — bez przebudowy (wołający z budżetem czasu na klatkę: przeszkody
 * gazu wybuchów przy masowej śmierci okrętów): obrys nieaktualny zostaje (ciało straciło kilka węzłów), obrysu jeszcze nie
 * było — null.
 */
export function hullFootprint(entity, W = 64, H = 32, allowRebuild = true) {
  if (!entity) return null;
  let fp = _cache.get(entity);
  if (!fp || fp.W !== W || fp.H !== H) {
    if (!allowRebuild) return null;
    fp = newFootprint(W, H);
    _cache.set(entity, fp);
  }
  const hull = entity.beamHull;
  const body = hull && hull.entity === entity ? hull.body : null;
  if (body && !body.dead && body.activeNodes > 0 && body.dims && body.nodeStore) {
    fp.rot = hullSpriteRotation(entity);
    const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
    if (fp.body !== body || fp.active !== body.activeNodes || fp.lmx !== body.latticeMin.x
      || fp.lmy !== body.latticeMin.y || fp.ax !== ax || fp.ay !== ay) {
      // bez przebudowy: ten sam korpus z kilkoma węzłami mniej — stary obrys; inne ciało (kotwica mogła się zmienić) — brak
      if (!allowRebuild) return fp.body === body && fp.cells ? fp : null;
      fp.body = body;
      fp.active = body.activeNodes;
      fp.lmx = body.latticeMin.x;
      fp.lmy = body.latticeMin.y;
      fp.ax = ax;
      fp.ay = ay;
      rasterBody(fp, body, ax, ay);
      fp.version++;
    }
    return fp;
  }
  fp.rot = 0;
  const w = num(entity.w), h = num(entity.h);
  const r = Math.max(40, num(entity.radius, 60));
  const fw = w > 0 && h > 0 ? w : -r;
  if (fp.body !== null || fp.fw !== fw || fp.fh !== h) {
    fp.body = null;
    fp.active = -1;
    fp.fw = fw;
    fp.fh = h;
    rasterBox(fp, w, h, r);
    fp.version++;
  }
  return fp;
}

/**
 * Obrys z pamięci encji BEZ przebudowy i bez sprawdzania aktualności (np. zasięg `reach` do wstępnego testu odległości)
 * albo null (brak obrysu w pamięci).
 */
export function hullFootprintPeek(entity, W = 64, H = 32) {
  const fp = entity ? _cache.get(entity) : null;
  return fp && fp.W === W && fp.H === H && fp.cells ? fp : null;
}

/** Bit maski (i — kolumna X, j — wiersz Y); poza maską 0. */
export function hullFootprintBit(fp, i, j) {
  if (i < 0 || j < 0 || i >= fp.W || j >= fp.H) return 0;
  const k = j * fp.W + i;
  return (fp.words[k >>> 5] >>> (k & 31)) & 1;
}
