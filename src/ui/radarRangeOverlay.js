// ============================================================
// Zasięg radarów w świecie gry — nakładka 2D (prototyp `?radarZasiegi`, 2026-11-04; plan: docs/PLAN-zasieg-czujnikow.md).
// Wygląd z prośby użytkownika (obrazek: trójkąty w narożnikach, łuki przy okręcie, niebieski = swoi, czerwony = wróg;
// 2026-11-04: „mój zasięg względem nich oraz ich zasięg względem mnie, żeby obustronnie można było ocenić”; „wachlarz ode
// mnie i OD przeciwnika, przeciwnik też ma swój, a nie że ja mam dwa”):
//  - OCENA OBUSTRONNA (drawThreatLook): trzy propozycje wyglądu na tych samych danych — WACHLARZ, STRUNA, BŁONA (opis przy
//    kodzie niżej). Stoją przy okrętach (bez lotu). Grupy wrogów w obrazie czujników (src/game/sensorPicture.js, P.threats)
//    — flota daje jeden znak, nie milion znaczników.
//  - ZNACZNIKI: trójkąt wzdłuż kursu (gdy kadłub na ekranie mały) i narożniki wokół kadłuba; KONTAKT bez identyfikacji —
//    przerywane koło niepewności z „?”; ślad kropek za graczem.
//  - Fala LECĄCA w skali prawdziwej (strokeCoverageSectors, strokeSectorArc, frontAlpha) zostaje jako podstawa
//    umiejętności „impuls czujników” (użytkownik: „to, co zrobiłeś, nadaje się jako skill — wysyłasz falę, a ona
//    sprawdza, co jest po drodze”); nakładka jej dziś nie rysuje.
// Czysty rysunek na kanwie (bez window / DOM): dane — obraz czujników (src/game/sensorPicture.js), rzut — widok wołającego.
// view: { W, H, zoom, roll, time, alpha, project(x, y, out), screenAngle(a), poseOf(e, out) → bool, hullHalf(e, out),
//         player, playerDestroyed } — metody wołane na obiekcie widoku (`this` = widok; rzut kamery wołającego).
// ============================================================

import { createPointGroups, groupPoints } from '../game/sensorCoverage.js';
import { contactSizeClass, SENSOR_SIZE_LABELS } from '../game/sensorDetection.js';
import { sensorKnowState } from '../game/sensorPicture.js';
import { radarColor } from './radar/radarSymbols.js';
import { formatRadarDistance } from './radar/radarConfig.js';

const TAU = Math.PI * 2;

export const RADAR_RANGE_STYLE = {
  ownRgb: '110, 204, 255',
  enemyRgb: '255, 112, 104',
  warnRgb: '255, 196, 110',
  outlineRgb: '3, 6, 10',
  // Fala LECĄCA (podstawa umiejętności „impuls czujników” — nakładka dziś jej nie rysuje): okres [s] i liczba czół
  // w locie; promień czoła = u^pow (czoło zwalnia przy nadajniku, potem przyspiesza ku granicy).
  period: 4,
  fronts: 4,
  frontPow: 2.3,
  // Sektor fal [rad]: pół szerokości (alfa schodzi do zera na brzegu, 7 pasm); łuk dłuższy niż 2 × maxHalfPx px
  // zwęża się (daleka fala = wąska wiązka wycelowana w gracza, nie kreska przez cały ekran).
  sectorHalf: 0.9,
  maxHalfPx: 250,
  edgeMaxHalfPx: 300,
  frontLw: 1.9,
  frontAlpha: 1,
  edgeLw: 2,
  edgeAlpha: 0.8,
  // Poświata pod łukiem (szersza linia, ta sama ścieżka; alfa × glowAlpha).
  glowLw: 6,
  glowAlpha: 0.2,
  // Wachlarz (jeden na okręt): łuków, odstęp i grubość [px], pół szerokości [rad], odstęp od ramki okrętu [px], najwięcej
  // grup, alfa pustych miejsc skali i radarów zgadniętych, odstęp znaku wroga od krawędzi kadru [px].
  fanArcs: 7,
  fanGap: 14,
  fanLw: 2.2,
  fanHalf: 0.2,
  fanPad: 8,
  fanMaxGroups: 6,
  fanEmptyAlpha: 0.1,
  fanEstAlpha: 0.6,
  fanEdgeInset: 64,
  // Struna: połowa długości łuku [px] i górny limit [rad], odstęp od ramki [px], grubość, amplituda przy progu [px], drganie
  // spoczynkowe [px], od jakiego ułamka zaczyna drgać, liczba odcinków.
  strunaHalfPx: 70,
  strunaMaxHalf: 0.75,
  strunaGap: 16,
  strunaLw: 1.8,
  strunaAmp: 15,
  strunaIdle: 0.5,
  strunaStart: 0.35,
  strunaSeg: 48,
  // Błona: odstęp od ramki [px], promień od śladu [px na 1,0 sygnatury], wybrzuszenie [px], jego szerokość [rad], pół
  // rozdarcia [rad], grubość, alfa wypełnienia, liczba odcinków.
  blonaGap: 6,
  blonaSig: 20,
  blonaLift: 92,
  blonaWidth: 0.34,
  blonaTear: 0.11,
  blonaLw: 1.7,
  blonaFill: 0.06,
  blonaSeg: 150,
  labelRgb: '170, 186, 204',
  // Znaczniki: trójkąt [px] pokazuje się, gdy kadłub na ekranie krótszy niż iconMaxPx.
  iconSize: 9,
  iconMaxPx: 30,
  iconMinPx: 14,
  bracketPad: 6,
  bracketMin: 13,
  // Ślad gracza: próbka co trailSec [s], najwyżej trailN kropek.
  trailSec: 0.32,
  trailN: 14,
  trailMinMove: 60,
  // Napis „STREFA x km” przy graczu, gdy krawędź bliżej niż [j.].
  edgeHintRange: 30000
};

// Pasma sektora (7 równych kawałków kąta): alfa po kolei — miękkie końce łuku.
const BAND_W = [0.14, 0.4, 0.78, 1, 0.78, 0.4, 0.14];

function smooth01(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }


const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0 };

// Fragment łuku [a0, a1] (a1 > a0) wspólny z pasmem [s0, s1] (s1 − s0 < 2π) — do dwóch kawałków (zawinięcie kąta).
function addArcBandPieces(ctx, cx, cy, rPx, a0, a1, s0, s1, angleOff) {
  const span = s1 - s0;
  let b0 = a0 + ((s0 - a0) % TAU + TAU) % TAU;
  for (let rep = 0; rep < 2; rep++) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b0 + span);
    if (hi > lo + 1e-6) {
      ctx.moveTo(cx + Math.cos(lo - angleOff) * rPx, cy + Math.sin(lo - angleOff) * rPx);
      ctx.arc(cx, cy, rPx, lo - angleOff, hi - angleOff);
    }
    b0 -= TAU;
  }
}

/**
 * Łuki sumy kół `cov` w sektorach zwróconych ku punktowi (tx, ty) — dla każdego koła osobno (od jego środka), alfa
 * schodzi do zera na brzegach sektora. pick(tag) → true: tylko te koła (np. radary pewne / oszacowane).
 * view: { project(x, y, out), zoom, roll } (roll — obrót kadru: kąt ekranu = kąt świata − roll).
 */
export function strokeCoverageSectors(ctx, cov, view, tx, ty, rgb, alpha, lw, half, pick = null, maxHalfPx = Infinity,
  glowLw = 0, glowAlpha = 0) {
  if (!cov.arcN || alpha <= 0.005) return;
  const roll = view.roll || 0;
  for (let band = 0; band < BAND_W.length; band++) {
    const a = alpha * BAND_W[band];
    if (a <= 0.005) continue;
    ctx.beginPath();
    let any = false;
    for (let k = 0; k < cov.arcN; k++) {
      const i = cov.arcCircle[k];
      if (pick && !pick(cov.tag[i])) continue;
      const cx = cov.x[i], cy = cov.y[i];
      const rPx = cov.r[i] * view.zoom;
      if (rPx < 2) continue;
      const h = Math.min(half, maxHalfPx / rPx);
      const bw = (2 * h) / BAND_W.length;
      const b = Math.atan2(ty - cy, tx - cx);
      const s0 = b - h + band * bw;
      view.project(cx, cy, _p);
      addArcBandPieces(ctx, _p.x, _p.y, rPx, cov.arcA0[k], cov.arcA1[k], s0, s0 + bw, roll);
      any = true;
    }
    if (!any) continue;
    if (glowLw > 0 && glowAlpha > 0) {
      ctx.lineWidth = glowLw;
      ctx.strokeStyle = radarColor(rgb, a * glowAlpha);
      ctx.stroke();
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = radarColor(rgb, a);
    ctx.stroke();
  }
}

/** Łuk-sektor jednego koła (fale własne): środek (sx, sy) px, promień px, kierunek na ekranie, pół szerokości. */
export function strokeSectorArc(ctx, sx, sy, rPx, dirScreen, half, rgb, alpha, lw, maxHalfPx = Infinity, glowLw = 0, glowAlpha = 0) {
  if (alpha <= 0.005 || rPx < 2) return;
  const h = Math.min(half, maxHalfPx / rPx);
  const bw = (2 * h) / BAND_W.length;
  for (let band = 0; band < BAND_W.length; band++) {
    const a = alpha * BAND_W[band];
    const s0 = dirScreen - h + band * bw;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(s0) * rPx, sy + Math.sin(s0) * rPx);
    ctx.arc(sx, sy, rPx, s0, s0 + bw);
    if (glowLw > 0 && glowAlpha > 0) {
      ctx.lineWidth = glowLw;
      ctx.strokeStyle = radarColor(rgb, a * glowAlpha);
      ctx.stroke();
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = radarColor(rgb, a);
    ctx.stroke();
  }
}

/** Alfa czoła fali w fazie u ∈ [0, 1): wejście i gaśnięcie ku granicy. */
export function frontAlpha(u) {
  return smooth01(u / 0.08) * Math.pow(1 - u, 1.1);
}

// ---------------------------------------------------------------- wygląd oceny obustronnej: wachlarz / struna / błona
// Dane: grupy zagrożeń obrazu czujników (P.threats): `them` — ich zasięg względem mnie (mój ślad sygnałowy) / odległość,
// `me` — mój zasięg względem nich / odległość, ≥ 1 = sięga. Propozycje do oceny użytkownika:
//  - WACHLARZ: jeden wachlarz NA OKRĘT — przy mnie niebieski w stronę wroga (me), przy wrogu czerwony w stronę mnie (them).
//  - STRUNA: łuk przy mnie w stronę wroga, drga tym mocniej, im bliżej wykrycia (them), przy progu pęka; słabsza struna
//    przy wrogu w stronę mnie — z me („drgająca struna, tym mocniej, im bliżej wykrycia przez przeciwnika jesteś”).
//  - BŁONA: jedna zamknięta błona wokół mnie: promień bazowy = mój ślad, wybrzuszenia w stronę grup rosną z them, sięgnięcie
//    rozrywa ją w tym miejscu — wiele grup to jeden kształt.
// Wróg poza kadrem: znak wroga przy krawędzi kadru, na prostej ku graczowi. Wartości wygładzone po stronie widoku (obraz
// czujników przebudowuje się co 0,2 s, a ciąg i cisza zmieniają ślad skokiem).

export const RADAR_LOOKS = Object.freeze(['wachlarz', 'struna', 'blona']);
export const RADAR_LOOK_LABELS = Object.freeze({ wachlarz: 'WACHLARZ', struna: 'STRUNA', blona: 'BŁONA' });
const radarLook = { name: RADAR_LOOKS[0] };

/** Wybrany wygląd (wspólny dla świata i CIC). Nazwa spoza listy — bez zmiany. */
export function setRadarLook(name) {
  if (RADAR_LOOKS.includes(name)) radarLook.name = name;
  return radarLook.name;
}
export function nextRadarLook() {
  return setRadarLook(RADAR_LOOKS[(RADAR_LOOKS.indexOf(radarLook.name) + 1) % RADAR_LOOKS.length]);
}
export function radarLookName() { return radarLook.name; }

const LOOK_TAU = 0.25;       // wygładzanie ułamków [s]
const LOOK_POS_TAU = 0.45;   // wygładzanie miejsca kontaktu [s] (miejsce przybliżone wędruje, obraz odświeża się co 0,2 s)
const LOOK_STALE_VERS = 2;   // rekord nieużyty przez tyle przebudów obrazu jest nieaktualny
const LOOK_REACH_EXIT = 0.93; // sięgnięcie gaśnie dopiero poniżej tego ułamka: miejsce kontaktu wędruje (±2 × błąd), a próg
                             // bez histerezy dawałby serię „świeżych wykryć” przy stojących okrętach
const MAX_THREATS = 16;
const _sel = new Int32Array(MAX_THREATS);
const _recs = new Array(MAX_THREATS).fill(null);
const _ax = new Float64Array(MAX_THREATS), _ay = new Float64Array(MAX_THREATS);   // kotwica znaku wroga [px]
const _dir = new Float64Array(MAX_THREATS);    // kierunek ode mnie ku wrogowi na ekranie
const _rE = new Float64Array(MAX_THREATS);     // promień startowy znaku wroga [px]
const _span = new Float64Array(MAX_THREATS);   // odległość mnie od kotwicy [px]
const _vis = new Uint8Array(MAX_THREATS);      // kotwica osiągalna (prosta przechodzi przez kadr)
const _inFrame = new Uint8Array(MAX_THREATS);  // sam wróg w kadrze (nie znak przy krawędzi)
const _strunaDrawn = new Uint8Array(MAX_THREATS);
const _fanDrawn = new Uint8Array(MAX_THREATS);
const _pose = { x: 0, y: 0, angle: 0 };
const _a = { x: 0, y: 0 };
const _hh = { hx: 0, hy: 0 };
const BLONA_MAX_SEG = 180;
const _mbX = new Float64Array(BLONA_MAX_SEG + 1), _mbY = new Float64Array(BLONA_MAX_SEG + 1);
const _mbD = new Float64Array(BLONA_MAX_SEG + 1), _mbT = new Uint8Array(BLONA_MAX_SEG + 1);

function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function parseRgb(s) { return s.split(',').map(Number); }

// Rampa barwy spokój → ostrzeżenie → wykrycie (stałe napisy: radarColor trzyma pamięć po napisie barwy).
const LOOK_RAMP = (() => {
  const o = parseRgb(RADAR_RANGE_STYLE.ownRgb), w = parseRgb(RADAR_RANGE_STYLE.warnRgb), e = parseRgb(RADAR_RANGE_STYLE.enemyRgb);
  const out = [];
  for (let i = 0; i <= 16; i++) {
    const q = i / 16;
    const u = q < 0.55 ? q / 0.55 : (q - 0.55) / 0.45;
    const A = q < 0.55 ? o : w, B = q < 0.55 ? w : e;
    out.push(`${Math.round(A[0] + (B[0] - A[0]) * u)}, ${Math.round(A[1] + (B[1] - A[1]) * u)}, ${Math.round(A[2] + (B[2] - A[2]) * u)}`);
  }
  return out;
})();
function rampRgb(q) { return LOOK_RAMP[Math.round(Math.max(0, Math.min(1, q)) * 16)]; }

/** Stan wyglądu (wygładzanie ułamków na wpis wiedzy lidera, chwila sięgnięcia) — osobny dla świata i CIC. */
export function createThreatLookState() {
  return { smooth: new WeakMap(), last: NaN, dt: 0, seed: 0.2, sig: NaN };
}

function threatRec(state, k, them, me, x, y, time, ver) {
  let r = state.smooth.get(k);
  if (!r) {
    state.seed = (state.seed + 0.6180339887) % 1;
    r = { them, me, x, y, reached: them >= 1, at: -1e9, seed: state.seed * TAU, ver };
    state.smooth.set(k, r);
    return r;
  }
  if (ver - r.ver > LOOK_STALE_VERS) {
    // rekord nieodświeżany (byt przestał prowadzić grupę, nakładka nie rysowała — CIC): wartości wprost, bez błysku — próg
    // przekroczony w czasie, gdy nikt tego nie rysował, to nie jest świeże wykrycie
    r.them = them; r.me = me; r.x = x; r.y = y;
    r.reached = them >= 1;
    r.at = -1e9;
    r.ver = ver;
    return r;
  }
  r.ver = ver;
  const a = 1 - Math.exp(-state.dt / LOOK_TAU);
  r.them += (them - r.them) * a;
  r.me += (me - r.me) * a;
  const ap = 1 - Math.exp(-state.dt / LOOK_POS_TAU);
  r.x += (x - r.x) * ap;
  r.y += (y - r.y) * ap;
  if (r.reached ? r.them < LOOK_REACH_EXIT : r.them >= 1) {
    r.reached = !r.reached;
    if (r.reached) r.at = time;
  }
  return r;
}

// Najwyżej fanMaxGroups grup — najgroźniejsze (największy `them`), kolejność malejąco.
function selectThreats(F, S) {
  const cap = Math.min(F.n, S.fanMaxGroups, MAX_THREATS);
  let n = 0;
  for (let g = 0; g < F.n; g++) {
    let at = n;
    while (at > 0 && F.them[_sel[at - 1]] < F.them[g]) at--;
    if (at >= cap) continue;
    for (let q = Math.min(n, cap - 1); q > at; q--) _sel[q] = _sel[q - 1];
    _sel[at] = g;
    if (n < cap) n++;
  }
  return n;
}

// Koniec odcinka (px, py) → (ex, ey) w prostokącie kadru (najbliższy wroga); false — odcinek omija kadr.
function clipEnemyAnchor(px, py, ex, ey, x0, y0, x1, y1, out) {
  let t0 = 0, t1 = 1;
  const dx = ex - px, dy = ey - py;
  if (Math.abs(dx) < 1e-9) { if (px < x0 || px > x1) return false; } else {
    const a = (x0 - px) / dx, b = (x1 - px) / dx;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dy) < 1e-9) { if (py < y0 || py > y1) return false; } else {
    const a = (y0 - py) / dy, b = (y1 - py) / dy;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1) return false;
  out.x = px + dx * t1;
  out.y = py + dy * t1;
  return true;
}

function drawFan(ctx, ax, ay, r0, dir, ratio, reached, gap, rgb, alpha, est, S) {
  const N = S.fanArcs;
  const lit = Math.max(0, Math.min(1, ratio)) * N;
  const full = Math.floor(lit);
  const a0 = dir - S.fanHalf, a1 = dir + S.fanHalf;
  // puste miejsca skali
  ctx.lineWidth = S.fanLw;
  ctx.beginPath();
  let any = false;
  for (let i = Math.ceil(lit); i < N; i++) {
    const r = r0 + i * gap;
    ctx.moveTo(ax + Math.cos(a0) * r, ay + Math.sin(a0) * r);
    ctx.arc(ax, ay, r, a0, a1);
    any = true;
  }
  if (any) {
    ctx.strokeStyle = radarColor(rgb, S.fanEmptyAlpha * alpha);
    ctx.stroke();
  }
  const ea = est ? S.fanEstAlpha : 1;
  for (let i = 0; i < Math.ceil(lit); i++) {
    const part = i < full ? 1 : lit - full;
    const a = alpha * ea * part * (1 - 0.35 * i / N);
    if (a <= 0.01) continue;
    const r = r0 + i * gap;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(a0) * r, ay + Math.sin(a0) * r);
    ctx.arc(ax, ay, r, a0, a1);
    ctx.lineWidth = S.fanLw + 3;
    ctx.strokeStyle = radarColor(rgb, a * S.glowAlpha);
    ctx.stroke();
    ctx.lineWidth = S.fanLw;
    ctx.strokeStyle = radarColor(rgb, a);
    ctx.stroke();
  }
  if (reached) {
    // grot: zasięg sięga
    const rt = r0 + N * gap + 2;
    const c = Math.cos(dir), s = Math.sin(dir);
    ctx.beginPath();
    ctx.moveTo(ax + c * (rt + 7), ay + s * (rt + 7));
    ctx.lineTo(ax + c * rt - s * 4.5, ay + s * rt + c * 4.5);
    ctx.lineTo(ax + c * rt + s * 4.5, ay + s * rt - c * 4.5);
    ctx.closePath();
    ctx.fillStyle = radarColor(rgb, 0.95 * alpha * ea);
    ctx.fill();
  }
}

function lookLabel(ctx, x, y, dir, line, rgb, alpha, S) {
  ctx.font = '600 10px Consolas, "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = Math.cos(dir) >= -0.2 ? 'left' : 'right';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = radarColor(S.outlineRgb, 0.8 * alpha);
  ctx.strokeText(line, x, y);
  ctx.fillStyle = radarColor(rgb, 0.9 * alpha);
  ctx.fillText(line, x, y);
}

function drawFansLook(ctx, F, n, px, py, r0, alpha, S, labels) {
  for (let q = 0; q < n; q++) {
    const g = _sel[q], R = _recs[q];
    const dirE = _dir[q] + Math.PI;
    // wachlarz wroga nie wchodzi na mój: gdy okręty są blisko, odstępy łuków się skracają
    const room = _vis[q] ? (_span[q] - r0 - _rE[q]) / (2 * S.fanArcs) : S.fanGap;
    const gap = Math.max(2, Math.min(S.fanGap, room));
    if (_vis[q]) drawFan(ctx, _ax[q], _ay[q], _rE[q], dirE, R.them, R.reached, gap, S.enemyRgb, alpha, !!F.est[g], S);
    // mój wachlarz w tym kierunku — chyba że nakładałby się na już narysowany ku groźniejszej grupie
    let overlap = false;
    for (let u = 0; u < q; u++) {
      if (_fanDrawn[u] && Math.abs(wrapPi(_dir[q] - _dir[u])) < 2 * S.fanHalf) { overlap = true; break; }
    }
    _fanDrawn[q] = overlap ? 0 : 1;
    if (!overlap) drawFan(ctx, px, py, r0, _dir[q], R.me, R.me >= 1, gap, S.ownRgb, alpha, false, S);
    if (labels && q === 0) {
      if (_vis[q]) {
        const rl = _rE[q] + S.fanArcs * gap + 18;
        const lx = _ax[q] + Math.cos(dirE) * rl, ly = _ay[q] + Math.sin(dirE) * rl;
        lookLabel(ctx, lx, ly - 6, dirE, `ONI ${formatRadarDistance(F.themR[g])}`, S.enemyRgb, alpha, S);
        lookLabel(ctx, lx, ly + 6, dirE, `${formatRadarDistance(F.themD[g])} STĄD`, S.labelRgb, alpha, S);
      }
      const rm = r0 + S.fanArcs * gap + 18;
      lookLabel(ctx, px + Math.cos(_dir[q]) * rm, py + Math.sin(_dir[q]) * rm, _dir[q], `TY ${formatRadarDistance(F.meR[g])}`, S.ownRgb, alpha, S);
    }
  }
}

// Drganie struny w punkcie s ∈ [0, 1]: suma harmonicznych o stałych, niewspółmiernych częstotliwościach (zmiana częstotliwości
// przy dużym t to skok fazy) — amplituda rośnie z bliskością q, a wyższe harmoniczne dochodzą pod koniec.
function strunaU(s, A, m2, m3, m4, w, seed) {
  return A * (Math.sin(Math.PI * s) * Math.cos(w * 3.1 + seed)
    + 0.6 * m2 * Math.sin(2 * Math.PI * s) * Math.cos(w * 5.3 + seed * 1.7)
    + 0.38 * m3 * Math.sin(3 * Math.PI * s) * Math.cos(w * 8.9 + seed * 2.3)
    + 0.22 * m4 * Math.sin(5 * Math.PI * s) * Math.cos(w * 14.7 + seed * 3.1));
}

function strokeGlow(ctx, rgb, a, lw, glow) {
  ctx.lineWidth = lw + 4;
  ctx.strokeStyle = radarColor(rgb, a * glow);
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = radarColor(rgb, a);
  ctx.stroke();
}

// Struna cała (q — bliskość progu 0…1; A = 0: prosty łuk).
function drawStringWhole(ctx, ax, ay, r, dir, q, ampMul, rgb, alpha, time, seed, S) {
  const h = Math.min(S.strunaMaxHalf, S.strunaHalfPx / r);
  const A = S.strunaAmp * ampMul * Math.pow(q, 1.3) * (0.86 + 0.14 * Math.sin(time * 4.4 + seed)) + (ampMul > 0 ? S.strunaIdle : 0);
  const m2 = smooth01(q / 0.45), m3 = smooth01((q - 0.3) / 0.45), m4 = smooth01((q - 0.6) / 0.4);
  const w = TAU * time;
  const M = S.strunaSeg;
  ctx.beginPath();
  for (let i = 0; i <= M; i++) {
    const s = i / M;
    const th = dir - h + 2 * h * s;
    const rr = r + strunaU(s, A, m2, m3, m4, w, seed);
    const x = ax + Math.cos(th) * rr, y = ay + Math.sin(th) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  strokeGlow(ctx, rgb, alpha, S.strunaLw * (1 + 0.5 * q), 0.12 + 0.28 * q);
  // węzły struny
  ctx.fillStyle = radarColor(rgb, alpha);
  for (let e = -1; e <= 1; e += 2) {
    ctx.beginPath();
    ctx.arc(ax + Math.cos(dir + e * h) * r, ay + Math.sin(dir + e * h) * r, 2.1, 0, TAU);
    ctx.fill();
  }
}

// Struna pęknięta (wykryty): dwa końce przy węzłach, wolne końce biczują coraz spokojniej, błysk w chwili pęknięcia.
function drawStringBroken(ctx, ax, ay, r, dir, rgb, alpha, time, since, seed, S) {
  const h = Math.min(S.strunaMaxHalf, S.strunaHalfPx / r);
  const fresh = Math.exp(-Math.max(0, since) * 1.6);
  const whip = S.strunaAmp * (0.35 + 0.9 * fresh);
  const gapS = 0.05 + 0.13 * (1 - Math.exp(-Math.max(0, since) * 3));
  const w = TAU * time;
  const M = S.strunaSeg >> 1;
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      const v = i / M;                 // 0 — węzeł, 1 — wolny koniec
      const s = side === 0 ? v * (0.5 - gapS) : 1 - v * (0.5 - gapS);
      const th = dir - h + 2 * h * s;
      const u = whip * v * v * Math.sin(w * (2.3 + side * 0.9) + 3.4 * v * sgn + seed + side);
      const rr = r + u;
      const x = ax + Math.cos(th) * rr, y = ay + Math.sin(th) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    strokeGlow(ctx, rgb, alpha, S.strunaLw * 1.4, 0.4);
    ctx.fillStyle = radarColor(rgb, alpha);
    ctx.beginPath();
    const te = dir + (side === 0 ? -h : h);
    ctx.arc(ax + Math.cos(te) * r, ay + Math.sin(te) * r, 2.1, 0, TAU);
    ctx.fill();
  }
  if (fresh > 0.02) {
    const fl = Math.exp(-Math.max(0, since) * 3.2);
    ctx.beginPath();
    ctx.arc(ax + Math.cos(dir) * r, ay + Math.sin(dir) * r, 5 + 46 * (1 - fl), 0, TAU);
    ctx.lineWidth = 1.5 + 2.5 * fl;
    ctx.strokeStyle = radarColor(rgb, 0.85 * alpha * fl);
    ctx.stroke();
  }
}

function drawStringsLook(ctx, F, n, px, py, r0, alpha, S, labels, time) {
  const r = r0 + S.strunaGap;
  const window2 = 2 * Math.min(S.strunaMaxHalf, S.strunaHalfPx / r);
  for (let q = 0; q < n; q++) {
    const g = _sel[q], R = _recs[q];
    const dir = _dir[q];
    const ea = F.est[g] ? 0.72 : 1;
    const nearT = smooth01((R.them - S.strunaStart) / (1 - S.strunaStart));
    // jedna struna na kierunek: grupy idą od najgroźniejszej, struna nakładająca się na już narysowaną odpada
    let overlap = false;
    for (let u = 0; u < q; u++) {
      if (_strunaDrawn[u] && Math.abs(wrapPi(dir - _dir[u])) < window2) { overlap = true; break; }
    }
    _strunaDrawn[q] = overlap ? 0 : 1;
    if (!overlap) {
      if (R.reached) {
        drawStringBroken(ctx, px, py, r, dir, S.enemyRgb, alpha * ea, time, time - R.at, R.seed, S);
      } else {
        drawStringWhole(ctx, px, py, r, dir, nearT, 1, rampRgb(nearT), alpha * ea * (0.5 + 0.5 * nearT), time, R.seed, S);
      }
    }
    // słabsza struna przy wrogu w stronę mnie: im bliżej jestem wykrycia JEGO, tym mocniej; sięgam — spokojny łuk, tylko przy
    // wrogu w kadrze (przy krawędzi kadru łuk bez drgania nic nie mówi)
    if (_vis[q]) {
      const dirE = dir + Math.PI;
      const rE = _rE[q] + S.strunaGap;
      if (R.me < 1) {
        const nm = smooth01((R.me - S.strunaStart) / (1 - S.strunaStart));
        drawStringWhole(ctx, _ax[q], _ay[q], rE, dirE, nm, 0.7, S.ownRgb, alpha * (0.35 + 0.35 * nm), time, R.seed + 1, S);
      } else if (_inFrame[q]) {
        drawStringWhole(ctx, _ax[q], _ay[q], rE, dirE, 0, 0, S.ownRgb, alpha * 0.55, time, R.seed + 1, S);
      }
    }
    if (labels && q === 0) {
      const rl = r + S.strunaAmp + 20;
      const lx = px + Math.cos(dir) * rl, ly = py + Math.sin(dir) * rl;
      lookLabel(ctx, lx, ly - 12, dir, `ONI ${formatRadarDistance(F.themR[g])}`, S.enemyRgb, alpha, S);
      lookLabel(ctx, lx, ly, dir, `TY ${formatRadarDistance(F.meR[g])}`, S.ownRgb, alpha, S);
      lookLabel(ctx, lx, ly + 12, dir, `${formatRadarDistance(F.themD[g])} STĄD`, S.labelRgb, alpha, S);
    }
  }
}

function drawMembraneLook(ctx, F, n, px, py, r0, alpha, S, labels, state, time, sigEff) {
  const a = 1 - Math.exp(-state.dt / LOOK_TAU);
  state.sig = Number.isFinite(state.sig) ? state.sig + (sigEff - state.sig) * a : sigEff;
  const base = r0 + S.blonaGap + S.blonaSig * Math.min(2.5, Math.max(0.2, state.sig));
  const M = Math.min(S.blonaSeg, BLONA_MAX_SEG);
  const w2 = S.blonaWidth * S.blonaWidth;
  let peak = 0;
  for (let i = 0; i <= M; i++) {
    const th = (i % M) / M * TAU;
    let bump = 0, danger = 0, torn = 0;
    for (let q = 0; q < n; q++) {
      const R = _recs[q];
      const d = wrapPi(th - _dir[q]);
      const b = Math.exp(-(d * d) / w2);
      const t = Math.min(1, Math.max(0, R.them));
      bump += b * S.blonaLift * Math.pow(t, 1.7);
      const dg = b * t * t;
      if (dg > danger) danger = dg;
      if (R.reached) {
        // sięgnięcie: rozdarcie w szczycie, otwiera się po chwili sięgnięcia
        const open = S.blonaTear * (1 - Math.exp(-Math.max(0, time - R.at) * 3));
        if (Math.abs(d) < open) torn = 1;
      }
    }
    if (danger > peak) peak = danger;
    const wob = 1.6 * Math.sin(3 * th + 0.9 * time + 1.1) + 1.2 * Math.sin(5 * th - 0.7 * time) + 0.7 * Math.sin(8 * th + 1.3 * time);
    const rr = base + bump + wob * (1 + 1.5 * danger) + danger * danger * 3 * Math.sin(17 * th + 9 * time);
    _mbX[i] = px + Math.cos(th) * rr;
    _mbY[i] = py + Math.sin(th) * rr;
    _mbD[i] = danger;
    _mbT[i] = torn;
  }
  ctx.beginPath();
  ctx.moveTo(_mbX[0], _mbY[0]);
  for (let i = 1; i <= M; i++) ctx.lineTo(_mbX[i], _mbY[i]);
  ctx.closePath();
  ctx.fillStyle = radarColor(rampRgb(peak), S.blonaFill * alpha);
  ctx.fill();
  // obrys kawałkami tej samej barwy (rampa: spokój → wykrycie), rozdarcia pominięte
  let i = 0;
  while (i < M) {
    if (_mbT[i] || _mbT[i + 1]) { i++; continue; }
    const step = Math.round(Math.max(0, Math.min(1, _mbD[i])) * 16);
    ctx.beginPath();
    ctx.moveTo(_mbX[i], _mbY[i]);
    let j = i + 1;
    ctx.lineTo(_mbX[j], _mbY[j]);
    while (j < M && !_mbT[j + 1] && Math.round(Math.max(0, Math.min(1, _mbD[j])) * 16) === step) {
      j++;
      ctx.lineTo(_mbX[j], _mbY[j]);
    }
    strokeGlow(ctx, LOOK_RAMP[step], alpha * (0.62 + 0.38 * step / 16), S.blonaLw, 0.14 + 0.26 * step / 16);
    i = j;
  }
  if (labels && n > 0) {
    const g = _sel[0], R = _recs[0];
    const dir = _dir[0];
    const rl = base + S.blonaLift * Math.pow(Math.min(1, Math.max(0, R.them)), 1.7) + 22;
    const lx = px + Math.cos(dir) * rl, ly = py + Math.sin(dir) * rl;
    lookLabel(ctx, lx, ly - 12, dir, `ONI ${formatRadarDistance(F.themR[g])}`, S.enemyRgb, alpha, S);
    lookLabel(ctx, lx, ly, dir, `TY ${formatRadarDistance(F.meR[g])}`, S.ownRgb, alpha, S);
    lookLabel(ctx, lx, ly + 12, dir, `${formatRadarDistance(F.themD[g])} STĄD`, S.labelRgb, alpha, S);
  }
}

/**
 * Rysuje wybrany wygląd oceny obustronnej. (px, py) — gracz [px], r0 — promień ramki gracza [px], S — styl (RADAR_RANGE_STYLE
 * albo kopia ze skalą CIC), state — createThreatLookState(), time — zegar widoku [s]. view: { W, H, zoom, bottomInset,
 * vpX?, vpY?, vpW?, vpH? (prostokąt kadru — podzielony ekran; domyślnie cała kanwa), project(x, y, out), poseOf?(e, out),
 * hullHalf?(e, out) }; labels — podpisy przy grupie najgroźniejszej.
 */
export function drawThreatLook(ctx, P, view, px, py, r0, alpha, S, state, time, labels = false) {
  const F = P.threats;
  if (!F || !F.n || alpha <= 0.01) return;
  state.dt = Number.isFinite(state.last) ? Math.max(0, Math.min(0.1, time - state.last)) : 0;
  state.last = time;
  const n = selectThreats(F, S);
  const inset = S.fanEdgeInset;
  const vx = view.vpX || 0, vy = view.vpY || 0;
  const x0 = vx + inset, y0 = vy + inset;
  const x1 = vx + (view.vpW || view.W) - inset, y1 = vy + (view.vpH || view.H) - inset - (view.bottomInset || 0);
  for (let q = 0; q < n; q++) {
    const g = _sel[q];
    const k = F.lead[g];
    const R = threatRec(state, k, F.them[g], F.me[g], F.x[g], F.y[g], time, P.version);
    _recs[q] = R;
    // miejsce wroga: identyfikacja w zasięgu wzroku — poza renderu i kadłub, kontakt — miejsce przybliżone i koło niepewności
    const seen = k.level === 2 && !!view.poseOf && view.poseOf(k.e, _pose);
    if (seen) view.project(_pose.x, _pose.y, _a);
    else view.project(R.x, R.y, _a);
    const ex = _a.x, ey = _a.y;
    _dir[q] = Math.atan2(ey - py, ex - px);
    const inFrame = ex >= x0 && ex <= x1 && ey >= y0 && ey <= y1;
    let rE = S.bracketMin + S.fanPad;
    _inFrame[q] = inFrame ? 1 : 0;
    if (inFrame) {
      _ax[q] = ex; _ay[q] = ey; _vis[q] = 1;
      if (seen && view.hullHalf) {
        view.hullHalf(k.e, _hh);
        rE = Math.max(S.bracketMin, Math.max(_hh.hx, _hh.hy) + S.bracketPad) + S.fanPad;
      } else if (!seen) {
        rE = Math.max(10, Math.min(160, (k.err || 0) * view.zoom)) + S.fanPad;
      }
    } else {
      // poza kadrem: przy krawędzi, na prostej ku graczowi
      _vis[q] = clipEnemyAnchor(px, py, ex, ey, x0, y0, x1, y1, _a) ? 1 : 0;
      _ax[q] = _a.x; _ay[q] = _a.y;
      rE = 4;
    }
    _rE[q] = rE;
    const sx = _ax[q] - px, sy = _ay[q] - py;
    _span[q] = Math.sqrt(sx * sx + sy * sy);
    // okręty na ekranie zbyt blisko na dwa znaki (oddalona mapa): łuki wroga wypadałyby za graczem — zostaje znak przy mnie
    if (_span[q] < r0 + rE + 4 * S.fanArcs) _vis[q] = 0;
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (radarLook.name === 'struna') drawStringsLook(ctx, F, n, px, py, r0, alpha, S, labels, time);
  else if (radarLook.name === 'blona') drawMembraneLook(ctx, F, n, px, py, r0, alpha, S, labels, state, time, P.player.sigEff);
  else drawFansLook(ctx, F, n, px, py, r0, alpha, S, labels);
  ctx.restore();
}

export function createRadarRangeOverlay(style = RADAR_RANGE_STYLE) {
  const S = style;
  const trail = { x: new Float64Array(32), y: new Float64Array(32), n: 0, head: 0, lastT: -1e9, lastX: 0, lastY: 0, has: false };
  const groups = createPointGroups(32);
  const gx = new Float64Array(256), gy = new Float64Array(256);
  const gk = [];
  const pose = { x: 0, y: 0, angle: 0 };
  const half = { hx: 0, hy: 0 };
  const lookState = createThreatLookState();

  function bracketPath(ctx, x, y, hx, hy) {
    const arm = Math.max(4, Math.min(hx, hy) * 0.45);
    for (let q = 0; q < 4; q++) {
      const sxn = q === 0 || q === 3 ? -1 : 1;
      const syn = q < 2 ? -1 : 1;
      const cx = x + sxn * hx, cy = y + syn * hy;
      ctx.moveTo(cx, cy - syn * arm);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - sxn * arm, cy);
    }
  }

  function trianglePath(ctx, x, y, ang, s) {
    const c = Math.cos(ang), sn = Math.sin(ang);
    const bx = -0.75 * s, by = 0.72 * s;
    ctx.moveTo(x + s * c, y + s * sn);
    ctx.lineTo(x + bx * c - by * sn, y + bx * sn + by * c);
    ctx.lineTo(x + bx * c + by * sn, y + bx * sn - by * c);
    ctx.closePath();
  }

  // Znacznik okrętu: narożniki wokół kadłuba + trójkąt przy małym kadłubie. Zwraca promień ramki [px].
  function drawShipMarker(ctx, view, e, x, y, angScreen, rgb, alpha, dashed) {
    view.hullHalf(e, half);
    const len = Math.max(half.hx, half.hy) * 2;
    const hx = Math.max(S.bracketMin, half.hx + S.bracketPad);
    const hy = Math.max(S.bracketMin, half.hy + S.bracketPad);
    ctx.lineWidth = 1.2;
    if (dashed) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    bracketPath(ctx, x, y, hx, hy);
    ctx.strokeStyle = radarColor(rgb, 0.75 * alpha);
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);
    const ia = smooth01((S.iconMaxPx - len) / (S.iconMaxPx - S.iconMinPx));
    if (ia > 0.02) {
      ctx.beginPath();
      trianglePath(ctx, x, y, angScreen, S.iconSize);
      ctx.fillStyle = radarColor(rgb, 0.12 * alpha * ia);
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = radarColor(rgb, 0.95 * alpha * ia);
      ctx.stroke();
    }
    return Math.max(hx, hy);
  }

  function text(ctx, s, x, y, rgb, alpha, align = 'center') {
    ctx.font = '600 10px Consolas, "Courier New", monospace';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = radarColor(S.outlineRgb, 0.8 * alpha);
    ctx.strokeText(s, x, y);
    ctx.fillStyle = radarColor(rgb, alpha);
    ctx.fillText(s, x, y);
  }

  function stepTrail(px, py, time) {
    if (time < trail.lastT) { trail.lastT = time; trail.has = false; trail.n = 0; } // zegar cofnięty (nowa gra)
    if (time - trail.lastT < S.trailSec) return;
    const dx = px - trail.lastX, dy = py - trail.lastY;
    trail.lastT = time;
    if (trail.has && dx * dx + dy * dy < S.trailMinMove * S.trailMinMove) {
      // stoi — ślad gaśnie od najstarszej kropki (i zostaje pusty, póki statek się nie ruszy)
      if (trail.n > 0) trail.n--;
      return;
    }
    trail.lastX = px; trail.lastY = py; trail.has = true;
    trail.x[trail.head] = px; trail.y[trail.head] = py;
    trail.head = (trail.head + 1) % S.trailN;
    if (trail.n < S.trailN) trail.n++;
  }

  return {
    style: S,
    trail,
    /** Rysuje nakładkę. P — obraz czujników (src/game/sensorPicture.js), view — rzut kadru. */
    draw(ctx, P, view) {
      if (!P || !P.ready) return;
      const alpha = view.alpha == null ? 1 : view.alpha;
      if (alpha <= 0.01) return;
      const time = view.time;
      const pl = view.player;
      const havePlayer = !!pl && !view.playerDestroyed && view.poseOf(pl, pose);
      // poza gracza skopiowana od razu — `pose` to bufor wspólny dla wszystkich znaczników niżej
      const px = havePlayer ? pose.x : P.player.x, py = havePlayer ? pose.y : P.player.y;
      const pa = havePlayer ? pose.angle : 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // --- ślad kropek za graczem i ocena obustronna (wybrany wygląd: wachlarz / struna / błona)
      if (havePlayer) {
        stepTrail(px, py, time);
        for (let i = 0; i < trail.n; i++) {
          const idx = (trail.head - 1 - i + S.trailN * 2) % S.trailN;
          view.project(trail.x[idx], trail.y[idx], _q);
          const a = (1 - i / S.trailN) * 0.55 * alpha;
          ctx.beginPath();
          ctx.arc(_q.x, _q.y, 2.1 - i * 0.08, 0, TAU);
          ctx.fillStyle = radarColor(S.ownRgb, a);
          ctx.fill();
        }
        view.project(px, py, _p);
        view.hullHalf(pl, half);
        const r0 = Math.max(S.bracketMin, Math.max(half.hx, half.hy) + S.bracketPad) + S.fanPad;
        drawThreatLook(ctx, P, view, _p.x, _p.y, r0, alpha, S, lookState, time, true);
      }

      // --- znaczniki: sojusznicy, gracz, wróg zidentyfikowany (poza renderu), kontakty niepewne (grupy)
      for (let i = 0; i < P.n; i++) {
        const r = P.recs[i];
        if (r.side !== 'friendly' || !r.e || r.isPlayer || r.kind !== 'ship') continue;
        if (!view.poseOf(r.e, pose)) continue;
        view.project(pose.x, pose.y, _p);
        if (_p.x < -60 || _p.y < -60 || _p.x > view.W + 60 || _p.y > view.H + 60) continue;
        drawShipMarker(ctx, view, r.e, _p.x, _p.y, view.screenAngle(pose.angle), S.ownRgb, 0.8 * alpha, false);
      }
      let gn = 0;
      gk.length = 0;
      for (let j = 0; j < P.knowList.length; j++) {
        const k = P.knowList[j];
        if (sensorKnowState(P, k) !== 'live') continue;
        if (k.level === 2 && view.poseOf(k.e, pose)) {
          view.project(pose.x, pose.y, _p);
          if (_p.x < -60 || _p.y < -60 || _p.x > view.W + 60 || _p.y > view.H + 60) continue;
          drawShipMarker(ctx, view, k.e, _p.x, _p.y, view.screenAngle(pose.angle), S.enemyRgb, alpha, false);
        } else if (k.ident) {
          // zidentyfikowany, śledzony czujnikami poza wzrokiem — przerywane narożniki w miejscu kontaktu, kurs z ostatniej
          // identyfikacji (bieżący kurs bytu ukrytego mgłą nie wychodzi na ekran)
          view.project(k.x, k.y, _p);
          if (_p.x < -60 || _p.y < -60 || _p.x > view.W + 60 || _p.y > view.H + 60) continue;
          drawShipMarker(ctx, view, k.e, _p.x, _p.y, view.screenAngle(k.ang), S.enemyRgb, 0.8 * alpha, true);
        } else if (gn < 256) {
          view.project(k.x, k.y, _p);
          gx[gn] = _p.x; gy[gn] = _p.y; gk.push(k); gn++;
        }
      }
      groupPoints(groups, gx, gy, gn, 28);
      for (let g = 0; g < groups.n; g++) {
        let size = 0, errPx = 0;
        for (let i = 0; i < gn; i++) {
          if (groups.groupOf[i] !== g) continue;
          const sc = contactSizeClass(gk[i].sigSeen);
          if (sc > size) size = sc;
          errPx = Math.max(errPx, gk[i].err * view.zoom);
        }
        const n = groups.count[g];
        const x = groups.cx[g], y = groups.cy[g];
        if (x < -80 || y < -80 || x > view.W + 80 || y > view.H + 80) continue;
        const rr = Math.max(10, Math.min(160, errPx));
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.strokeStyle = radarColor(S.enemyRgb, 0.45 * alpha);
        ctx.stroke();
        ctx.setLineDash([]);
        text(ctx, n > 1 ? `? ×${n}` : '?', x, y - 6, S.enemyRgb, 0.9 * alpha);
        text(ctx, SENSOR_SIZE_LABELS[size], x, y + rr + 3, S.enemyRgb, 0.6 * alpha);
      }

      if (havePlayer) {
        view.project(px, py, _p);
        const pl0 = P.player;
        const rgb = pl0.detectedKnown > 0 ? S.enemyRgb : S.ownRgb;
        const rb = drawShipMarker(ctx, view, pl, _p.x, _p.y, view.screenAngle(pa), rgb, alpha, false);
        if (pl0.detectedKnown > 0) {
          text(ctx, `WYKRYTY ×${pl0.detectedKnown}`, _p.x, _p.y + rb + 5, S.enemyRgb, 0.95 * alpha);
        } else if (pl0.edge.arc >= 0 && pl0.edge.dist < S.edgeHintRange) {
          text(ctx, `STREFA ${formatRadarDistance(pl0.edge.dist)}`, _p.x, _p.y + rb + 5, S.warnRgb, 0.85 * alpha);
        }
      }
      ctx.restore();
    }
  };
}
