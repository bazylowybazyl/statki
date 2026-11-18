// HUTA — formowanie, etap „Złożenie”: BRYŁY OTOCZENIA (czysty JS, rejestrator `Budowniczy` z `../wytop/wyposazenie.js`).
//
// Jedna siatka stała, jeden materiał (`otoczenieTSL.js`): NACZYNIE-LEJEK (gładka bryła obrotowa: kołnierz, walec,
// zaokrąglone przejście w stożek, gardziel, dysza z wargą; okno zatoki taśmy), kołnierz od góry (pierścień między
// studnią a krawędzią pomostu), obudowy generatorów pola 0 g, pierścienie usztywniające, PIERŚCIEŃ NOŚNY z żebrami,
// 4 NOGI ze stopami i zastrzały, skrzynia zatoki taśmy, słupy i dźwigary POMOSTU GÓRNEGO, POKŁAD HALI z dołami
// zgorzeliny pod klatkami, FUNDAMENTY linii formowania i walcowania, kanał kablowy ze STYKAMI, oznaczenia korytarza,
// lampy hali, RURA TLENU (zejście z kołnierza do hali) i ZBIORNIKI (`buildOxygenPlant` — wygląd rundy 5, nowe miejsce),
// DOK ŻUŻLA z rurą z odbieralnika komory; etap „Kropla” (wylot bokiem): RURA SPUSTOWA spod dyszy (kolano, rura pod
// stożkiem poza obrys naczynia, podpory z pokładu), WYLEWKA z otworem (żar płynącego metalu — rodzaj `wylewka`) i ZAWÓR
// WYLEWKI (klapy obraca shader — rodzaj `klapa`, rama `ZAWOR`).
// Osprzęt pola linii (kołnierz i pierścienie pola przy wylewce, bramki zacisku pola i łoże błony, bramy G0–G4, poduszka,
// chłodnice C1 / C2) dokłada `polePasma.js`; metal linii i powłoka pola — osobne siatki (`pasmoTSL.js`); klatki F1–F3,
// pętlowniki polowe, noże C3, brama „DO ZWIJARKI” z osłoną tunelu — `walcowniaBryly.js` (etap „Walcowanie”).
import { KOMORA, filletPath, pathSample } from '../wytop/geometria.js';
import { RODZAJ, buildOxygenPlant, sweepTube } from '../wytop/wyposazenie.js';
import { deckPieces } from '../wytop/scena.js';
import { BLONA, DOK_ZUZLA, DROGA, HALA, LINIA, NACZYNIE, POMOST, SPUST, ZAWOR, legAt, slagDockFrame, spustPoint } from './geometria.js';
import { OTO_POLE, buildLineField } from './polePasma.js';
import { OTO_WALC, buildRollingMill } from './walcowniaBryly.js';
import { buildDivider } from '../dzielenie/bryly.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Rodzaje powierzchni otoczenia (atrybut `aK.x`; 0, 3, 8 — jak w komorze: farba, lampa, stal). */
export const OTO = Object.freeze({
  farba: RODZAJ.farba, lampa: RODZAJ.lampa, stal: RODZAJ.stal,
  naczynie: 20,                 // płaszcz naczynia (płyty ze szwami, osmalenie ku gardzieli)
  poklad: 21,                   // płyty pokładu hali (szwy siatki `HALA.deck.plate`)
  emiter: 22,                   // szczelina obudowy generatora pola (cyjan; świeci, gdy generator 0 g pracuje)
  klapa: 23,                    // klapa zaworu wylewki (parametr: numer klapy) — obrót wokół zawiasu w shaderze
  granulat: 24,                 // granulat żużla w doku (wysokość w shaderze; aM = u, v w skrzyni)
  dysza: 25,                    // wnętrze wargi dyszy (żar gardzieli)
  dol: 26,                      // wykładzina dołu zgorzeliny
  pasy: 27,                     // pasy ostrzegawcze (żółto-czarne)
  krata: 28,                    // pokrywa kanału kablowego (krata)
  pole: OTO_POLE.pole,          // emiter pola linii (parametr: kanał siły `POLE_KANAL`) — etap „Pasmo w polu”
  chlodnica: OTO_POLE.chlodnica, // panel chłodnicy C1 / C2 (dosunięcie przy miedzi w wierzchołkach: kierunek `aM`)
  wylewka: 31,                  // wnętrze wargi wylewki i dyszy (żar metalu płynącego rurą spustową)
  rura: 32,                     // płaszcz rury spustowej (nagrzewa się, gdy płynie metal)
  walec: OTO_WALC.walec         // walec klatki F1–F3 (parametr: 2·klatka + górny) — wzór obraca shader kątem walca
});

// barwy liniowe (albedo); wygląd brył to jawna MAKIETA do tury „materiały strefy huty” — gładkie, staranne, proste
const SHELL = [0.15, 0.153, 0.165];
const SHELL_TOP = [0.16, 0.162, 0.17];
const STEEL = [0.14, 0.145, 0.158];
const DARK = [0.045, 0.047, 0.052];
const FRAME = [0.105, 0.108, 0.118];
const YELLOW = [0.5, 0.33, 0.04];
const DECK = [0.11, 0.112, 0.118];
const CONCRETE = [0.165, 0.162, 0.156];
const PIT = [0.05, 0.048, 0.047];
const SLAG = [0.05, 0.046, 0.044];
const AMBER = [1.0, 0.66, 0.2];
const CYAN = [0.2, 0.9, 1.0];
const WARM = [1.0, 0.72, 0.42];

// ---------------------------------------------------------------------------
// Profil obrotowy z zaokrągleniami

/**
 * Próbki profilu [r, y] z zaokrąglonymi narożami: lista łańcuchów { r, y, nr, ny } (normalna na zewnątrz materiału);
 * ostre naroże zaczyna nowy łańcuch (dwie normalne w jednym punkcie).
 */
export function profileChains(profile, arcStep = 0.09, splitY = []) {
  const P = profile;
  const dir = (a, b) => { const dr = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dr, dy); return [dr / l, dy / l]; };
  const chains = [];
  let cur = [];
  const push = (r, y, t) => cur.push({ r, y, nr: -t[1], ny: t[0] });
  let start = [P[0][0], P[0][1]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    const d0 = dir(a, b);
    const R = i < P.length - 1 ? P[i][2] : 0;
    let end = [b[0], b[1]];
    let arc = null;
    if (R > 0) {
      const d1 = dir(b, P[i + 1]);
      const ang = Math.acos(Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1])));
      const t = R * Math.tan(ang / 2);
      end = [b[0] - d0[0] * t, b[1] - d0[1] * t];
      const sg = Math.sign(d0[0] * d1[1] - d0[1] * d1[0]) || 1;
      const L = [-d0[1], d0[0]];
      const C = [end[0] + L[0] * R * sg, end[1] + L[1] * R * sg];
      arc = { C, ang, sg, d0 };
    }
    // odcinek prosty start → end (z podziałem na wysokościach `splitY` — krawędzie okien)
    push(start[0], start[1], d0);
    for (const ys of splitY) {
      if ((start[1] - ys) * (end[1] - ys) < 0) {
        const f = (ys - start[1]) / (end[1] - start[1]);
        push(start[0] + (end[0] - start[0]) * f, ys, d0);
      }
    }
    push(end[0], end[1], d0);
    if (arc) {
      const n = Math.max(2, Math.ceil(arc.ang / arcStep));
      for (let k = 1; k <= n; k++) {
        const phi = (arc.ang * k) / n * arc.sg;
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        const vr = end[0] - arc.C[0];
        const vy = end[1] - arc.C[1];
        const pr = arc.C[0] + vr * c - vy * s;
        const py = arc.C[1] + vr * s + vy * c;
        const t = [arc.d0[0] * c - arc.d0[1] * s, arc.d0[0] * s + arc.d0[1] * c];
        push(pr, py, t);
      }
      start = [cur[cur.length - 1].r, cur[cur.length - 1].y];
    } else {
      chains.push(cur);
      cur = [];
      start = [b[0], b[1]];
    }
  }
  if (cur.length) chains.push(cur);
  return chains.filter((c) => c.length > 1);
}

/** Promień zewnętrzny płaszcza naczynia na wysokości y z próbek profilu (z zaokrągleniami); 0 — poza bryłą. */
export function shellRadiusAt(y) {
  let best = 0;
  for (const ch of SHELL_CHAINS) {
    for (let i = 0; i + 1 < ch.length; i++) {
      const a = ch[i];
      const b = ch[i + 1];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      const r = a.r + (b.r - a.r) * ((y - a.y) / (b.y - a.y));
      if (r > best) best = r;
    }
  }
  return best;
}
const BAY = KOMORA.bay;
const BOX = NACZYNIE.bayBox;
/** Okno zatoki taśmy w płaszczu: azymuty [rad] i zakres wysokości. */
const WIN = Object.freeze({
  a0: Math.PI - Math.asin((BAY.z1 + BOX.thick) / NACZYNIE.profile[2][0]),
  a1: Math.PI - Math.asin((BAY.z0 - BOX.thick) / NACZYNIE.profile[2][0]),
  y0: BOX.floorY - BOX.thick, y1: NACZYNIE.flange.y0
});
const SHELL_CHAINS = profileChains(NACZYNIE.profile, 0.09, [WIN.y0]);

/** Azymuty obrotu: `segs` równych i dodatkowe (krawędzie okna). */
function thetas(segs, extra = []) {
  const out = [];
  for (let k = 0; k <= segs; k++) out.push((k / segs) * TAU);
  for (const e of extra) out.push(e);
  return out.sort((a, b) => a - b);
}

/** Pas bryły obrotowej między próbkami a i b profilu, na azymutach `th`; `skip(θ, y)` — pomija ścianki (okno). */
function lathe(B, a, b, th, skip = null) {
  for (let k = 0; k + 1 < th.length; k++) {
    const t0 = th[k];
    const t1 = th[k + 1];
    if (t1 - t0 < 1e-9) continue;
    if (skip && skip((t0 + t1) / 2, (a.y + b.y) / 2)) continue;
    const c0 = Math.cos(t0); const s0 = Math.sin(t0);
    const c1 = Math.cos(t1); const s1 = Math.sin(t1);
    const V = (p, c, s) => B.v(p.r * c, p.y, p.r * s, p.nr * c, p.ny, p.nr * s);
    V(a, c0, s0); V(a, c1, s1); V(b, c1, s1);
    V(a, c0, s0); V(b, c1, s1); V(b, c0, s0);
  }
}

/** Pierścień (rurka r wokół osi y na promieniu R, wysokość y) na łuku th0…th1. */
function hoop(B, R, y, r, th0 = 0, th1 = TAU, segs = 128, sides = 10) {
  const n = Math.max(4, Math.ceil(segs * (th1 - th0) / TAU));
  const th = [];
  for (let k = 0; k <= n; k++) th.push(th0 + (th1 - th0) * k / n);
  for (let j = 0; j < sides; j++) {
    const v0 = (j / sides) * TAU;
    const v1 = ((j + 1) / sides) * TAU;
    const a = { r: R + Math.cos(v0) * r, y: y + Math.sin(v0) * r, nr: Math.cos(v0), ny: Math.sin(v0) };
    const b = { r: R + Math.cos(v1) * r, y: y + Math.sin(v1) * r, nr: Math.cos(v1), ny: Math.sin(v1) };
    lathe(B, a, b, th);
  }
}

/** Prostopadłościan zbieżny między punktami a → b (przekrój kwadratowy w0 → w1; `side` — kierunek boku [x, z]). */
function taperBeam(B, a, b, w0, w1, side) {
  let dx = b[0] - a[0]; let dy = b[1] - a[1]; let dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  dx /= l; dy /= l; dz /= l;
  // bok: poziomy, prostopadły do osi
  let sx = side[0]; const sy = 0; let sz = side[1];
  const d = sx * dx + sz * dz;
  sx -= dx * d; sz -= dz * d;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sz /= sl;
  // trzecia oś: oś × bok
  const tx = dy * sz - dz * sy;
  const ty = dz * sx - dx * sz;
  const tz = dx * sy - dy * sx;
  const C = (p, w, i, j) => [p[0] + (sx * i + tx * j) * w / 2, p[1] + (sy * i + ty * j) * w / 2, p[2] + (sz * i + tz * j) * w / 2];
  const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let k = 0; k < 4; k++) {
    const [i0, j0] = ring[k];
    const [i1, j1] = ring[(k + 1) % 4];
    const p0 = C(a, w0, i0, j0); const p1 = C(a, w0, i1, j1); const p2 = C(b, w1, i1, j1); const p3 = C(b, w1, i0, j0);
    B.quad(...p0, ...p3, ...p2, ...p1);
  }
}

/** Wielokąt płaski y = const (wierzchołki [x, z] zgodnie z ruchem przeciwnym do wskazówek patrząc z góry), wachlarz. */
function flat(B, poly, y, up = true) {
  const ny = up ? 1 : -1;
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[0]; const b = poly[i]; const c = poly[i + 1];
    if (up) { B.v(a[0], y, a[1], 0, ny, 0); B.v(c[0], y, c[1], 0, ny, 0); B.v(b[0], y, b[1], 0, ny, 0); }
    else { B.v(a[0], y, a[1], 0, ny, 0); B.v(b[0], y, b[1], 0, ny, 0); B.v(c[0], y, c[1], 0, ny, 0); }
  }
}

/** Odcięcie wielokąta półpłaszczyzną (Sutherland–Hodgman): zostaje strona, gdzie f(p) ≥ 0 (f liniowa). */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Naczynie

function buildVessel(B) {
  const N = NACZYNIE;
  const segs = N.segs;
  const thUni = thetas(segs);
  const thWin = thetas(segs, [WIN.a0, WIN.a1]);
  const inWin = (t, y) => t > WIN.a0 + 1e-7 && t < WIN.a1 - 1e-7 && y > WIN.y0 && y < WIN.y1;
  // płaszcz: kołnierz (dwa pierwsze odcinki) na azymutach krawędzi pomostu, walec z oknem zatoki, reszta
  for (const ch of SHELL_CHAINS) {
    for (let i = 0; i + 1 < ch.length; i++) {
      const a = ch[i];
      const b = ch[i + 1];
      const onCyl = Math.abs(a.r - N.profile[2][0]) < 1e-6 && Math.abs(b.r - N.profile[2][0]) < 1e-6 && a.y <= N.flange.y0 + 1e-6;
      B.paint(...(a.y > N.flange.y0 - 1e-6 && b.y > N.flange.y0 - 1e-6 ? SHELL_TOP : SHELL), a.nr < -0.5 ? OTO.dysza : OTO.naczynie, 0);
      lathe(B, a, b, onCyl ? thWin : thUni, onCyl ? inWin : null);
    }
  }
  // kołnierz od góry: pierścień między studnią (32-kąt) a krawędzią pomostu (te same wierzchołki), bez zatoki taśmy
  const R0 = KOMORA.pitR;
  const n = KOMORA.sides;
  const per = segs / n;
  B.paint(...SHELL_TOP, OTO.naczynie, 1);
  for (let k = 0; k < segs; k++) {
    const t0 = (k / segs) * TAU;
    const t1 = ((k + 1) / segs) * TAU;
    // punkt boku 32-kąta na promieniu pod kątem t (bok między wierzchołkami ⌊k / per⌋ i ⌊k / per⌋ + 1)
    const side = Math.floor(k / per);
    const pa = (side / n) * TAU;
    const pb = ((side + 1) / n) * TAU;
    const A = [Math.cos(pa) * R0, Math.sin(pa) * R0];
    const Bv = [Math.cos(pb) * R0, Math.sin(pb) * R0];
    const onEdge = (t) => {
      const dx = Math.cos(t); const dz = Math.sin(t);
      const ex = Bv[0] - A[0]; const ez = Bv[1] - A[1];
      const den = dx * ez - dz * ex;
      const s = (A[0] * ez - A[1] * ex) / den;
      return [dx * s, dz * s];
    };
    const Ro = N.flange.rOut;
    let poly = [onEdge(t0), [Math.cos(t0) * Ro, Math.sin(t0) * Ro], [Math.cos(t1) * Ro, Math.sin(t1) * Ro], onEdge(t1)];
    if (KOMORA.bay.sides.includes(side) || (t0 > 0.6 * Math.PI && t1 < 1.1 * Math.PI)) {
      // zatoka taśmy: z kołnierza zostaje to, co leży poza pasem z0…z1 (po stronie x < 0)
      const lo = clip(poly, (p) => BAY.z0 - p[1]);
      const hi = clip(poly, (p) => p[1] - BAY.z1);
      for (const q of [lo, hi]) if (q.length >= 3) flat(B, q.slice().reverse(), N.flange.y1);
      continue;
    }
    flat(B, poly.slice().reverse(), N.flange.y1);
  }
  // CZERŃ ZA KRATĄ SZCZELINY pierścienia odciągu: wnęka szczeliny (za licem studni, do r 538) leżała dotąd w grubości
  // płyt pokładu zestawu (r ≥ 520, y 354…400) i przez kratę widać było czerń. Kołnierz naczynia jest pusty w środku —
  // pas czerni tuż za licem (r 521) przywraca ten sam obraz (rodzaj `lampa` o mocy 0 — czysta czerń)
  {
    const G = KOMORA.gaz.ring;
    const rb = KOMORA.pitR + 1;
    const ya = G.y0 - G.lipH;
    const yb = KOMORA.deckY - 1;                                       // pod wierzchem kołnierza
    const thB = thetas(segs).filter((t) => !(t > 135 * DEG - 1e-6 && t < 168.75 * DEG + 1e-6));
    B.paint(0.0, 0.0, 0.0, OTO.lampa, 0);
    for (let k = 0; k + 1 < thB.length; k++) {
      if (thB[k + 1] - thB[k] > 0.1) continue;                   // przerwa na zatokę taśmy
      lathe(B, { r: rb, y: ya, nr: -1, ny: 0 }, { r: rb, y: yb, nr: -1, ny: 0 }, [thB[k], thB[k + 1]]);
    }
  }
  // pierścienie usztywniające walec (bez okna zatoki)
  B.paint(...FRAME, OTO.stal);
  for (const y of N.bands) {
    if (y > WIN.y0 && y < WIN.y1) {
      hoop(B, N.profile[2][0] + 3, y, 5.5, WIN.a1 + 0.01, WIN.a0 + TAU - 0.01, 128, 10);
    } else hoop(B, N.profile[2][0] + 3, y, 5.5, 0, TAU, 128, 10);
  }
  // kołnierz gardzieli: pierścień śrub
  B.paint(...DARK, OTO.stal);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    B.abox(Math.cos(a) * 118, -760, Math.sin(a) * 118, 3.2, 4, 3.2);
  }
  // obudowy generatorów pola 0 g na kołnierzu: niska skrzynka, szczelina emitera od strony studni
  for (const azd of N.flange.gens) {
    const a = azd * DEG;
    const c = Math.cos(a); const s = Math.sin(a);
    const r = N.flange.genR;
    B.paint(...FRAME, OTO.stal);
    B.box(c * r, N.flange.y1 + 4, s * r, c * 26, 0, s * 26, 0, 4, 0, -s * 17, 0, c * 17);
    B.paint(...DARK, OTO.stal);
    B.box(c * (r + 4), N.flange.y1 + 8.6, s * (r + 4), c * 18, 0, s * 18, 0, 0.6, 0, -s * 12, 0, c * 12);
    B.paint(...CYAN, OTO.emiter, 1);
    B.box(c * (r - 22), N.flange.y1 + 8.2, s * (r - 22), c * 2, 0, s * 2, 0, 0.5, 0, -s * 12, 0, c * 12);
  }
}

// ---------------------------------------------------------------------------
// Pierścień nośny, nogi, zastrzały

function buildSupport(B) {
  const N = NACZYNIE;
  const G = N.ring;
  const y0 = G.y - G.h / 2;
  const y1 = G.y + G.h / 2;
  const th = thetas(N.segs);
  // dźwigar skrzynkowy przyspawany do płaszcza (od płaszcza do r1)
  const rIn = Math.min(shellRadiusAt(y0), shellRadiusAt(y1)) - 1;
  B.paint(...FRAME, OTO.stal);
  const P = (r, y, nr, ny) => ({ r, y, nr, ny });
  lathe(B, P(G.r1, y1, 0, 1), P(rIn, y1, 0, 1), th);
  lathe(B, P(G.r1, y0, 1, 0), P(G.r1, y1, 1, 0), th);
  lathe(B, P(rIn, y0, 0, -1), P(G.r1, y0, 0, -1), th);
  // listwa krawędzi i żebra pod pierścieniem (do płaszcza)
  B.paint(...DARK, OTO.stal);
  hoop(B, G.r1, y1 - 1, 3, 0, TAU, 128, 8);
  for (let k = 0; k < 360 / G.ribDeg; k++) {
    const a = k * G.ribDeg * DEG;
    const c = Math.cos(a); const s = Math.sin(a);
    const yb = y0 - 70;
    const rb = shellRadiusAt(yb) - 1;
    // żebro trójkątne: od spodu pierścienia (rIn…r1) w dół do płaszcza
    const t = 4;
    const px = -s * t; const pz = c * t;
    const A = [c * rIn, y0, s * rIn]; const Bq = [c * G.r1, y0, s * G.r1]; const C = [c * rb, yb, s * rb];
    for (const sd of [-1, 1]) {
      const o = [px * sd, 0, pz * sd];
      B.v(A[0] + o[0], A[1], A[2] + o[2], -s * sd, 0, c * sd);
      B.v(Bq[0] + o[0], Bq[1], Bq[2] + o[2], -s * sd, 0, c * sd);
      B.v(C[0] + o[0], C[1], C[2] + o[2], -s * sd, 0, c * sd);
    }
    // krawędź skośna żebra
    B.quad(Bq[0] - px, Bq[1], Bq[2] - pz, C[0] - px, C[1], C[2] - pz, C[0] + px, C[1], C[2] + pz, Bq[0] + px, Bq[1], Bq[2] + pz);
  }
  // nogi: głowica pod pierścieniem, stopa na pokładzie hali
  const L = N.legs;
  for (let k = 0; k < L.az.length; k++) {
    const a = L.az[k] * DEG;
    const c = Math.cos(a); const s = Math.sin(a);
    const head = legAt(k, y0);
    const foot = legAt(k, HALA.deckY + 12);
    B.paint(...STEEL, OTO.stal);
    taperBeam(B, [head[0], y0, head[1]], [foot[0], HALA.deckY + 12, foot[1]], L.w0, L.w1, [-s, c]);
    // głowica: płyta pod pierścieniem
    B.paint(...DARK, OTO.stal);
    B.box(head[0], y0 - 4, head[1], c * (L.w0 / 2 + 14), 0, s * (L.w0 / 2 + 14), 0, 4, 0, -s * (L.w0 / 2 + 14), 0, c * (L.w0 / 2 + 14));
    // stopa: płyta i cokół na pokładzie, śruby
    B.paint(...FRAME, OTO.stal);
    B.box(foot[0], HALA.deckY + 6, foot[1], c * L.foot / 2, 0, s * L.foot / 2, 0, 6, 0, -s * L.foot / 2, 0, c * L.foot / 2);
    B.paint(...CONCRETE, OTO.farba);
    B.box(foot[0], HALA.deckY + 1, foot[1], c * (L.foot / 2 + 16), 0, s * (L.foot / 2 + 16), 0, 1, 0, -s * (L.foot / 2 + 16), 0, c * (L.foot / 2 + 16));
    B.paint(...DARK, OTO.stal);
    for (const i of [-1, 1]) for (const j of [-1, 1]) {
      const bx = foot[0] + (c * i - s * j) * (L.foot / 2 - 14);
      const bz = foot[1] + (s * i + c * j) * (L.foot / 2 - 14);
      B.abox(bx, HALA.deckY + 14, bz, 4, 2, 4);
    }
  }
  // zastrzały (X) między nogami 130–230° i 230–310° — niżej, niż sięga stożek naczynia
  B.paint(...FRAME, OTO.stal);
  const yT = -560;
  const yB = HALA.deckY + 90;
  for (const [a0, a1] of L.braces) {
    const i0 = L.az.indexOf(a0);
    const i1 = L.az.indexOf(a1);
    const pA = (y) => { const q = legAt(i0, y); return [q[0], y, q[1]]; };
    const pB = (y) => { const q = legAt(i1, y); return [q[0], y, q[1]]; };
    B.beam(...pA(yT), ...pB(yB), 26, 26);
    B.beam(...pA(yB), ...pB(yT), 26, 26);
    B.beam(...pA(yB), ...pB(yB), 30, 30);
  }
}

// ---------------------------------------------------------------------------
// Zatoka taśmy: skrzynia pod pomostem

function buildBayBox(B) {
  const t = BOX.thick;
  const yb = BOX.floorY - t;
  const yt = NACZYNIE.flange.y0;
  const R = NACZYNIE.profile[2][0];
  const x0 = BAY.x0;
  const z0 = BAY.z0 - t;
  const z1 = BAY.z1 + t;
  const xe = (z) => -Math.sqrt(R * R - z * z);
  B.paint(...FRAME, OTO.farba);
  // ściany boczne (na zewnątrz ±z)
  B.quad(x0, yb, z0, xe(z0), yb, z0, xe(z0), yt, z0, x0, yt, z0);
  B.quad(xe(z1), yb, z1, x0, yb, z1, x0, yt, z1, xe(z1), yt, z1);
  // ściana czołowa przy krawędzi pomostu (−x)
  B.quad(x0, yb, z1, x0, yb, z0, x0, yt, z0, x0, yt, z1);
  // dno od spodu: do łuku płaszcza (te same azymuty co okno)
  const poly = [[x0, z0], [x0, z1]];
  const th = thetas(NACZYNIE.segs, [WIN.a0, WIN.a1]).filter((a) => a >= WIN.a0 - 1e-9 && a <= WIN.a1 + 1e-9);
  for (const a of th) poly.push([Math.cos(a) * R, Math.sin(a) * R]);
  flat(B, poly, yb, false);
  // żebra dna co 180 j.
  B.paint(...DARK, OTO.stal);
  for (let x = x0 + 120; x < xe(z1) - 30; x += 180) B.abox(x, yb - 6, (z0 + z1) / 2, 6, 6, (z1 - z0) / 2);
}

// ---------------------------------------------------------------------------
// Pomost górny: słupy i dźwigary

function buildPlatform(B) {
  const D = KOMORA.deck;
  const yS = NACZYNIE.flange.y0;               // spód płyt pomostu
  const g = POMOST.girder;
  B.paint(...STEEL, OTO.stal);
  for (const [x, z] of POMOST.cols) {
    B.abox(x, (HALA.deckY + yS) / 2, z, POMOST.colW / 2, (yS - HALA.deckY) / 2, POMOST.colW / 2);
  }
  B.paint(...FRAME, OTO.stal);
  for (const [x, z] of POMOST.cols) {
    B.abox(x, yS - g - 8, z, POMOST.colW / 2 + 12, 8, POMOST.colW / 2 + 12);
    B.abox(x, HALA.deckY + 7, z, POMOST.colW / 2 + 22, 7, POMOST.colW / 2 + 22);
  }
  // spód płyt pomostu (płyty zestawu portowego od spodu są nieoświetlone — czarne w widokach z boku i z dołu)
  B.paint(...FRAME, OTO.stal);
  for (const p of deckPieces()) flat(B, p, yS - 1.2, false);
  // dźwigary pod krawędziami płyt i na liniach słupów (bez przejścia przez skrzynię zatoki i kołnierz)
  const gy = yS - g / 2;
  const zc = Math.sqrt(D.flangeR * D.flangeR - D.x1 * D.x1) + 4;
  const bz0 = BAY.z0 - BOX.thick;
  const bz1 = BAY.z1 + BOX.thick;
  B.abox((D.x0 + D.x1) / 2, gy, D.z0 + g / 2, (D.x1 - D.x0) / 2, g / 2, g / 2);
  B.abox((D.x0 + D.x1) / 2, gy, D.z1 - g / 2, (D.x1 - D.x0) / 2, g / 2, g / 2);
  for (const x of [D.x0 + g / 2, POMOST.cols[2][0], POMOST.cols[0][0]]) {
    B.abox(x, gy, (D.z0 + bz0) / 2, g / 2, g / 2, (bz0 - D.z0) / 2);
    B.abox(x, gy, (bz1 + D.z1) / 2, g / 2, g / 2, (D.z1 - bz1) / 2);
  }
  for (const s of [-1, 1]) {
    const za = s * zc;
    const zb = s * D.z1;
    B.abox(D.x1 - g / 2, gy, (za + zb) / 2, g / 2, g / 2, Math.abs(zb - za) / 2);
  }
  // zastrzały słupów pod pomostem (w płaszczyźnie x = const, ku środkowi)
  B.paint(...FRAME, OTO.stal);
  for (const [x, z] of POMOST.cols) {
    const sz = -Math.sign(z);
    B.beam(x, yS - 260, z, x, yS - g, z + sz * 220, 18, 18);
  }
}

// ---------------------------------------------------------------------------
// Pokład hali, doły zgorzeliny, fundamenty, kanał, styki, oznaczenia, lampy

function buildHallDeck(B) {
  const H = HALA.deck;
  const y = HALA.deckY;
  const L = LINIA;
  const pits = L.stands.map((s) => [s.x - L.pit.hx, -L.pit.hz, s.x + L.pit.hx, L.pit.hz]);
  // wierzch: pasy w z (poza dołami pełne), środkowy pas pocięty dołami
  B.paint(...DECK, OTO.poklad, 0);
  const rect = (x0, z0, x1, z1) => flat(B, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]], y);
  rect(H.x0, H.z0, H.x1, -L.pit.hz);
  rect(H.x0, L.pit.hz, H.x1, H.z1);
  let xc = H.x0;
  for (const p of pits) { rect(xc, -L.pit.hz, p[0], L.pit.hz); xc = p[2]; }
  rect(xc, -L.pit.hz, H.x1, L.pit.hz);
  // boki i spód płyty
  B.paint(...FRAME, OTO.stal);
  const yb = y - H.thick;
  B.quad(H.x0, yb, H.z0, H.x1, yb, H.z0, H.x1, y, H.z0, H.x0, y, H.z0);
  B.quad(H.x1, yb, H.z1, H.x0, yb, H.z1, H.x0, y, H.z1, H.x1, y, H.z1);
  B.quad(H.x0, yb, H.z1, H.x0, yb, H.z0, H.x0, y, H.z0, H.x0, y, H.z1);
  B.quad(H.x1, yb, H.z0, H.x1, yb, H.z1, H.x1, y, H.z1, H.x1, y, H.z0);
  flat(B, [[H.x0, H.z0], [H.x1, H.z0], [H.x1, H.z1], [H.x0, H.z1]], yb, false);
  // obrzeże płyty: żółta listwa
  B.paint(...YELLOW, OTO.farba);
  B.abox((H.x0 + H.x1) / 2, y + 2, H.z0 + 5, (H.x1 - H.x0) / 2, 2, 5);
  B.abox((H.x0 + H.x1) / 2, y + 2, H.z1 - 5, (H.x1 - H.x0) / 2, 2, 5);
  B.abox(H.x0 + 5, y + 2, (H.z0 + H.z1) / 2, 5, 2, (H.z1 - H.z0) / 2 - 10);
  B.abox(H.x1 - 5, y + 2, (H.z0 + H.z1) / 2, 5, 2, (H.z1 - H.z0) / 2 - 10);
  // doły zgorzeliny pod klatkami: ściany, dno, obramowanie z kątownika
  for (const [x0, z0, x1, z1] of pits) {
    const yd = y - L.pit.depth;
    B.paint(...PIT, OTO.dol);
    B.quad(x0, yd, z0, x0, y, z0, x1, y, z0, x1, yd, z0);
    B.quad(x1, yd, z1, x1, y, z1, x0, y, z1, x0, yd, z1);
    B.quad(x0, yd, z1, x0, y, z1, x0, y, z0, x0, yd, z0);
    B.quad(x1, yd, z0, x1, y, z0, x1, y, z1, x1, yd, z1);
    flat(B, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]], yd);
    B.paint(...YELLOW, OTO.pasy, 0);
    B.abox((x0 + x1) / 2, y + 0.6, z0 - 4, (x1 - x0) / 2 + 8, 0.6, 4);
    B.abox((x0 + x1) / 2, y + 0.6, z1 + 4, (x1 - x0) / 2 + 8, 0.6, 4);
    B.abox(x0 - 4, y + 0.6, (z0 + z1) / 2, 4, 0.6, (z1 - z0) / 2);
    B.abox(x1 + 4, y + 0.6, (z0 + z1) / 2, 4, 0.6, (z1 - z0) / 2);
  }
  // FUNDAMENTY linii (niskie cokoły z kotwami) — miejsce dla etapów „Pasmo” i „Walcowanie”
  const plinth = (cx, cz, hx, hz, h = 8) => {
    B.paint(...CONCRETE, OTO.farba);
    B.abox(cx, y + h / 2, cz, hx, h / 2, hz);
    B.paint(...DARK, OTO.stal);
    for (const i of [-1, 1]) for (const j of [-1, 1]) B.abox(cx + i * (hx - 9), y + h + 2, cz + j * (hz - 9), 2.6, 2, 2.6);
  };
  for (const g of L.gates) plinth(g.x, 0, 18, (g.r || g.a) + 110);                    // bramy G0–G4
  for (const sd of [-1, 1]) {
    plinth((L.chill.C1[0] + L.chill.C2[1]) / 2, sd * (L.chill.side0 + L.chill.side1) / 2, (L.chill.C2[1] - L.chill.C1[0]) / 2, (L.chill.side1 - L.chill.side0) / 2, 6);
  }
  for (const s of L.stands) for (const sd of [-1, 1]) plinth(s.x, sd * (L.pit.hz + 55), 110, 45, 10);   // korpusy klatek (poza dołem)
  plinth((L.chill.C3[0] + 20 + L.chill.C3[1]) / 2, 0, (L.chill.C3[1] - L.chill.C3[0] - 20) / 2, 40, 5);   // rozdzielacze noży gazowych
  // KANAŁ KABLOWY wzdłuż linii (krata) i STYKI przy każdym elemencie: skrzynka z kontrolką (bez zasilania — przygaszona)
  const zt = -L.corridor - 120;
  const k0 = 300;
  const XC3 = L.cushion[1][1];                 // koniec poduszki za F3 (x 3380 — dawniej brama „DO ZWIJARKI”)
  const k1 = XC3 + 100;
  B.paint(...DARK, OTO.krata, 0);
  B.abox((k0 + k1) / 2, y + 0.5, zt, (k1 - k0) / 2, 0.5, 22);
  B.paint(...FRAME, OTO.stal);
  B.abox((k0 + k1) / 2, y + 1.2, zt - 23, (k1 - k0) / 2, 1.2, 1.5);
  B.abox((k0 + k1) / 2, y + 1.2, zt + 23, (k1 - k0) / 2, 1.2, 1.5);
  // (styki: łoże błony, bramy, chłodnice, klatki, noże, brama; bramki zacisku i wylewka mają swoje przy progach i podporach)
  const styki = [...BLONA.bed, ...L.gates.map((g) => g.x), L.chill.C1[0], L.chill.C2[0], ...L.stands.map((s) => s.x), L.chill.C3[0], XC3];
  for (const x of styki) {
    B.paint(...STEEL, OTO.stal);
    B.abox(x, y + 14, zt + 40, 16, 14, 11);
    B.paint(...DARK, OTO.stal);
    B.abox(x, y + 29, zt + 40, 18, 1.2, 13);
    B.paint(...CYAN, OTO.lampa, 0.14);
    B.abox(x - 7, y + 30.4, zt + 40, 3, 0.4, 3);
    B.paint(...WARM, OTO.lampa, 0.1);
    B.abox(x + 7, y + 30.4, zt + 40, 3, 0.4, 3);
  }
  // OZNACZENIA: krawędzie korytarza linii (pasy) i oś pasma (przerywana)
  for (const sd of [-1, 1]) {
    B.paint(...YELLOW, OTO.pasy, 1);
    B.abox((L.corridorX + L.corridorX1) / 2, y + 0.4, sd * L.corridor, (L.corridorX1 - L.corridorX) / 2, 0.4, 7);
  }
  B.paint(0.4, 0.38, 0.3, OTO.farba);
  for (let x = L.gates[0].x + 60; x < L.corridorX1; x += 120) {
    const blocked = pits.some((p) => x + 30 > p[0] - 10 && x - 30 < p[2] + 10);
    if (!blocked) B.abox(x, y + 0.3, 0, 30, 0.3, 2.5);
  }
  // lampy hali: oprawy przy brzegach płyty (ciepłe, małe — skala i orientacja z kamery gry)
  for (let x = H.x0 + 150; x < H.x1; x += 300) {
    for (const z of [H.z0 + 24, H.z1 - 24]) {
      B.paint(...DARK, OTO.stal);
      B.abox(x, y + 3, z, 12, 3, 7);
      B.paint(...WARM, OTO.lampa, 0.55);
      B.abox(x, y + 6.4, z, 8, 0.6, 4);
    }
  }
}

// ---------------------------------------------------------------------------
// Dok żużla i rura z odbieralnika

/** Droga rury żużla (z płaszcza naczynia do skrzyni doku). */
export function slagChutePath() {
  const D = DOK_ZUZLA;
  const a = D.az * DEG;
  const c = Math.cos(a); const s = Math.sin(a);
  const P = (r, y) => [c * r, y, s * r];
  const ySlant = D.exitY - (D.r1 - 610) * Math.tan(60 * DEG);
  const top = HALA.deckY + D.h;
  const yKnee = top + 40 + (D.r - D.r1) * Math.tan(58 * DEG);
  return filletPath([P(NACZYNIE.profile[2][0] - 20, D.exitY), P(610, D.exitY), P(D.r1, ySlant), P(D.r1, yKnee), P(D.r, top + 40), P(D.r, top - 20)], [0, 30, 60, 60, 40, 0]);
}

function buildSlagDock(B) {
  const D = DOK_ZUZLA;
  const F = slagDockFrame();
  const y = HALA.deckY;
  const c = F.c; const s = F.s;
  const along = (u, v) => [F.x + c * u - s * v, F.z + s * u + c * v];
  const hl = D.len / 2; const hw = D.wid / 2;
  const t = 8;
  // rura (pneumatyczna) z płaszcza, kołnierz przy płaszczu, obejmy
  const path = slagChutePath();
  B.paint(0.07, 0.064, 0.058, OTO.stal);
  sweepTube(B, path, D.pipeR, 20);
  B.paint(...DARK, OTO.stal);
  const q = new Float64Array(6);
  for (const sAt of [24, path.len * 0.35, path.len * 0.55, path.len * 0.75, path.len - 30]) {
    pathSample(path, sAt, q);
    B.tube(q[0] - q[3] * 3, q[1] - q[4] * 3, q[2] - q[5] * 3, q[0] + q[3] * 3, q[1] + q[4] * 3, q[2] + q[5] * 3, D.pipeR + 3.5, D.pipeR + 3.5, 20, true);
  }
  // wspornik rury do pierścienia nośnego
  {
    const yS = NACZYNIE.ring.y;
    B.paint(...FRAME, OTO.stal);
    B.beam(c * NACZYNIE.ring.r1, yS, s * NACZYNIE.ring.r1, c * (D.r1 - D.pipeR), yS, s * (D.r1 - D.pipeR), 14, 14);
  }
  // skrzynia: ściany z zewnątrz i od środka, obrzeże
  B.paint(...FRAME, OTO.farba);
  const wall = (u0, v0, u1, v1) => {
    const a = along(u0, v0); const b = along(u1, v1);
    const nx = b[1] - a[1]; const nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz);
    const ox = nx / l * t / 2; const oz = nz / l * t / 2;
    B.box((a[0] + b[0]) / 2, y + D.h / 2, (a[1] + b[1]) / 2, (b[0] - a[0]) / 2, 0, (b[1] - a[1]) / 2, 0, D.h / 2, 0, ox, 0, oz);
  };
  wall(-hl, -hw, hl, -hw); wall(hl, hw, -hl, hw); wall(-hl, hw, -hl, -hw); wall(hl, -hw, hl, hw);
  B.paint(...YELLOW, OTO.pasy, 0);
  for (const [u0, v0, u1, v1] of [[-hl, -hw, hl, -hw], [hl, hw, -hl, hw], [-hl, hw, -hl, -hw], [hl, -hw, hl, hw]]) {
    const a = along(u0, v0); const b = along(u1, v1);
    const nx = b[1] - a[1]; const nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz);
    B.box((a[0] + b[0]) / 2, y + D.h + 1.5, (a[1] + b[1]) / 2, (b[0] - a[0]) / 2 + nx / l * 0, 0, (b[1] - a[1]) / 2, 0, 1.5, 0, nx / l * (t / 2 + 2), 0, nz / l * (t / 2 + 2));
  }
  // dno skrzyni (płyta grawitacji: ciemna, z bursztynowymi lampkami w narożach)
  B.paint(...DARK, OTO.stal);
  const p0 = along(-hl, -hw); const p1 = along(hl, -hw); const p2 = along(hl, hw); const p3 = along(-hl, hw);
  flat(B, [p0, p3, p2, p1], y + 2);
  for (const [u, v] of [[-hl + 14, -hw + 14], [hl - 14, -hw + 14], [hl - 14, hw - 14], [-hl + 14, hw - 14]]) {
    const p = along(u, v);
    B.paint(...DARK, OTO.stal);
    B.abox(p[0], y + D.h + 4, p[1], 6, 2, 6);
    B.paint(...AMBER, OTO.lampa, 0.8);
    B.abox(p[0], y + D.h + 6.4, p[1], 3.4, 0.6, 3.4);
  }
  // granulat: siatka 12 × 9 (wysokość liczy shader z wypełnienia; aM = u, v ∈ −1…1)
  const nu = 12; const nv = 9;
  const iu = hl - t; const iv = hw - t;
  B.paint(...SLAG, OTO.granulat, 0);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = -1 + (2 * i) / nu; const u1 = -1 + (2 * (i + 1)) / nu;
    const v0 = -1 + (2 * j) / nv; const v1 = -1 + (2 * (j + 1)) / nv;
    const V = (u, v) => { const p = along(u * iu, v * iv); B.move(u, v, 0); B.v(p[0], y + 3, p[1], 0, 1, 0); };
    V(u0, v0); V(u0, v1); V(u1, v1);
    V(u0, v0); V(u1, v1); V(u1, v0);
  }
  B.move(0, 0, 0);
  // wylot w dnie do sieci ringu: przenośnik kryty od skrzyni do krawędzi pokładu (+z)
  {
    const a = along(0, hw);
    const z1 = HALA.deck.z1 - 12;
    B.paint(...STEEL, OTO.stal);
    B.abox(a[0], y + 16, (a[1] + z1) / 2, 22, 16, (z1 - a[1]) / 2);
    B.paint(...YELLOW, OTO.farba);
    B.abox(a[0], y + 34, z1 - 4, 28, 2, 4);
    B.abox(a[0] - 28, y + 18, z1 - 4, 2, 16, 4);
    B.abox(a[0] + 28, y + 18, z1 - 4, 2, 16, 4);
  }
}

// ---------------------------------------------------------------------------
// Rura tlenu: wsporniki do konstrukcji (rura i zbiorniki — `buildOxygenPlant`)

function buildOxygenSupports(B) {
  const P = KOMORA.gaz.pipe;
  const a = P.az * DEG;
  const c = Math.cos(a); const s = Math.sin(a);
  B.paint(...FRAME, OTO.stal);
  for (const y of P.brackets) {
    let from;
    if (y > NACZYNIE.ring.y + NACZYNIE.ring.h / 2) {
      const r = shellRadiusAt(y);
      from = [c * r, y, s * r];
    } else if (y > NACZYNIE.ring.y - NACZYNIE.ring.h / 2 - 1) {
      from = [c * NACZYNIE.ring.r1, y, s * NACZYNIE.ring.r1];
    } else {
      // najbliższa noga (310°)
      const q = legAt(3, y);
      from = [q[0], y, q[1]];
    }
    const to = [c * (P.r1 - P.r - 2), y, s * (P.r1 - P.r - 2)];
    B.beam(...from, ...to, 12, 12);
    B.paint(...DARK, OTO.stal);
    B.tube(c * P.r1, y - 5, s * P.r1, c * P.r1, y + 5, s * P.r1, P.r + 2.2, P.r + 2.2, 24, true);
    B.paint(...FRAME, OTO.stal);
  }
}

// ---------------------------------------------------------------------------
// Rura spustowa i wylewka (wylot bokiem) — zawór wylewki: klapy

/**
 * RURA SPUSTOWA: kołnierz pod dyszą naczynia, płaszcz rury wzdłuż drogi (kolano pod stożkiem, rura pozioma, łuk
 * wylewki), opaski, podpory z pokładu hali; WYLEWKA: czoło z otworem (wnętrze żarzy się, gdy płynie metal).
 */
function buildDrainPipe(B) {
  const S = SPUST;
  const P = DROGA.pipe;
  const q = new Float64Array(6);
  // kołnierz rury pod dyszą (obejmuje wargę dyszy naczynia)
  B.paint(...STEEL, OTO.stal);
  B.tube(0, S.y0 + 6, 0, 0, S.y0 - 10, 0, 104, 104, 64, true);
  B.paint(...DARK, OTO.stal);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    B.abox(Math.cos(a) * 98, S.y0 - 2, Math.sin(a) * 98, 3, 9, 3);
  }
  // płaszcz rury (od kołnierza do wargi wylewki)
  B.paint(0.085, 0.082, 0.08, OTO.rura, 0);
  sweepTube(B, P, S.rOut, 40, 4, P.len - 2, 0.06);
  // opaski płaszcza co ~110 j.
  B.paint(...DARK, OTO.stal);
  for (let s = 150; s < P.len - 60; s += 110) {
    pathSample(P, s, q);
    B.tube(q[0] - q[3] * 6, q[1] - q[4] * 6, 0, q[0] + q[3] * 6, q[1] + q[4] * 6, 0, S.rOut + 3.5, S.rOut + 3.5, 40, true);
  }
  // czoło wylewki: pierścień płaszcza i otwór (wnętrze wargi — rodzaj `wylewka`, żar płynącego metalu)
  pathSample(P, P.len, q);
  const tx = q[3]; const ty = q[4];
  const lip = [q[0], q[1]];
  B.paint(...STEEL, OTO.stal);
  B.tube(lip[0] - tx * 22, lip[1] - ty * 22, 0, lip[0], lip[1], 0, S.rOut + 6, S.rOut + 6, 48, false);
  // czoło (pierścień od otworu do płaszcza) — normalna wzdłuż strugi
  {
    const ux = -ty; const uy = tx;
    const n = 48;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU; const a1 = ((k + 1) / n) * TAU;
      const P2 = (r, a) => [lip[0] + ux * Math.cos(a) * r, lip[1] + uy * Math.cos(a) * r, Math.sin(a) * r];
      const A = P2(SPUST.klapy.rAp, a0); const Bq = P2(S.rOut + 6, a0); const C = P2(S.rOut + 6, a1); const D2 = P2(SPUST.klapy.rAp, a1);
      B.v(A[0], A[1], A[2], tx, ty, 0); B.v(Bq[0], Bq[1], Bq[2], tx, ty, 0); B.v(C[0], C[1], C[2], tx, ty, 0);
      B.v(A[0], A[1], A[2], tx, ty, 0); B.v(C[0], C[1], C[2], tx, ty, 0); B.v(D2[0], D2[1], D2[2], tx, ty, 0);
    }
    // otwór: wnętrze wargi (normalne do środka), 46 j. w głąb
    B.paint(0.06, 0.03, 0.02, OTO.wylewka, 0);
    const back = 46;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU; const a1 = ((k + 1) / n) * TAU;
      const r = SPUST.klapy.rAp;
      const Pt = (a, d) => [lip[0] - tx * d + ux * Math.cos(a) * r, lip[1] - ty * d + uy * Math.cos(a) * r, Math.sin(a) * r];
      const Nn = (a) => [-ux * Math.cos(a), -uy * Math.cos(a), -Math.sin(a)];
      const A = Pt(a0, 0); const Bq = Pt(a0, back); const C = Pt(a1, back); const D2 = Pt(a1, 0);
      const na = Nn(a0); const nb = Nn(a1);
      B.v(A[0], A[1], A[2], ...na); B.v(C[0], C[1], C[2], ...nb); B.v(Bq[0], Bq[1], Bq[2], ...na);
      B.v(A[0], A[1], A[2], ...na); B.v(D2[0], D2[1], D2[2], ...nb); B.v(C[0], C[1], C[2], ...nb);
    }
    // dno otworu (ciemne — rura dalej)
    B.paint(0.03, 0.012, 0.008, OTO.wylewka, 0);
    B.disc(lip[0] - tx * back, lip[1] - ty * back, 0, tx, ty, 0, SPUST.klapy.rAp, 48);
  }
  // podpory rury z pokładu hali (słup, siodło z obejmą)
  for (const x of S.cols) {
    const yb = S.y - S.rOut;
    B.paint(...STEEL, OTO.stal);
    B.abox(x, (yb - 14 + HALA.deckY) / 2, 0, 16, (yb - 14 - HALA.deckY) / 2, 16);
    B.paint(...FRAME, OTO.stal);
    B.abox(x, yb - 8, 0, 26, 8, 40);
    B.abox(x, HALA.deckY + 8, 0, 34, 8, 34);
    B.paint(...DARK, OTO.stal);
    B.tube(x - 7, S.y, 0, x + 7, S.y, 0, S.rOut + 4, S.rOut + 4, 40, true);
  }
}

/**
 * Klapa `k` w położeniu ZAMKNIĘTYM: trójkąt (środek wargi, dwa wierzchołki sześciokąta o apotemie `apo`) w płaszczyźnie
 * wargi wylewki (rama `ZAWOR`: e1, e2 w płaszczyźnie, d — bieg strugi); zawias = bok sześciokąta (środek `h`, kierunek
 * `t`). Shader obraca klapę wokół zawiasu (wzór `flapRotate` — ten sam): kąt dodatni wychyla środek z biegiem strugi.
 */
export function flapHinge(k) {
  const K = SPUST.klapy;
  const Z = ZAWOR;
  const a = (k / K.n) * TAU;
  const c = Math.cos(a); const s = Math.sin(a);
  const h = [0, 1, 2].map((j) => Z.c[j] + K.apo * (c * Z.e1[j] + s * Z.e2[j]));
  const t = [0, 1, 2].map((j) => -s * Z.e1[j] + c * Z.e2[j]);
  return { h, t, a };
}
/** Obrót punktu p [x, y, z] wokół zawiasu klapy `k` o kąt θ (Rodrigues; ten sam wzór liczy shader). */
export function flapRotate(p, k, theta) {
  const H = flapHinge(k);
  const d = [p[0] - H.h[0], p[1] - H.h[1], p[2] - H.h[2]];
  const T = H.t;
  const c = Math.cos(theta); const s = Math.sin(theta);
  const x = [T[1] * d[2] - T[2] * d[1], T[2] * d[0] - T[0] * d[2], T[0] * d[1] - T[1] * d[0]];
  const td = T[0] * d[0] + T[1] * d[1] + T[2] * d[2];
  return [0, 1, 2].map((j) => H.h[j] + d[j] * c + x[j] * s + T[j] * td * (1 - c));
}
/** Punkt płaszczyzny wargi (u wzdłuż e1, v wzdłuż e2) przesunięty o w wzdłuż biegu strugi. */
export function valvePoint(u, v, w = 0) {
  const Z = ZAWOR;
  return [0, 1, 2].map((j) => Z.c[j] + u * Z.e1[j] + v * Z.e2[j] + w * Z.d[j]);
}

function buildFlaps(B) {
  const K = SPUST.klapy;
  const Z = ZAWOR;
  const rv = K.apo / Math.cos(Math.PI / K.n);
  const h = K.thick / 2;
  const d = Z.d;
  for (let k = 0; k < K.n; k++) {
    const a = (k / K.n) * TAU;
    const a0 = a - Math.PI / K.n;
    const a1 = a + Math.PI / K.n;
    const O = [0, 0];
    const P0 = [Math.cos(a0) * rv, Math.sin(a0) * rv];
    const P1 = [Math.cos(a1) * rv, Math.sin(a1) * rv];
    B.paint(0.07, 0.072, 0.08, OTO.klapa, k);
    // strona z biegiem strugi (normalna d) i strona ku rurze (−d), krawędzie boczne
    const V = (p, w) => valvePoint(p[0], p[1], w);
    const tri = (A, Bq, C, w, n) => { const a2 = V(A, w); const b2 = V(Bq, w); const c2 = V(C, w); B.v(...a2, ...n); B.v(...b2, ...n); B.v(...c2, ...n); };
    tri(O, P0, P1, h, d);
    tri(O, P1, P0, -h, [-d[0], -d[1], -d[2]]);
    for (const [A, C] of [[O, P0], [P1, O], [P0, P1]]) {
      const a2 = V(A, h); const c2 = V(C, h); const c3 = V(C, -h); const a3 = V(A, -h);
      B.quad(...a2, ...c2, ...c3, ...a3);
    }
    // żebro usztywniające po stronie strugi (od zawiasu ku środkowi)
    B.paint(0.05, 0.052, 0.058, OTO.klapa, k);
    const hm = [Math.cos(a) * K.apo, Math.sin(a) * K.apo];
    const cm = V([hm[0] * 0.55, hm[1] * 0.55], h + 1.6);
    const ua = [0, 1, 2].map((j) => (Math.cos(a) * Z.e1[j] + Math.sin(a) * Z.e2[j]) * K.apo * 0.42);
    const ub = [0, 1, 2].map((j) => d[j] * 1.6);
    const uc = [0, 1, 2].map((j) => (-Math.sin(a) * Z.e1[j] + Math.cos(a) * Z.e2[j]) * 1.8);
    B.box(cm[0], cm[1], cm[2], ...ua, ...ub, ...uc);
  }
}

// ---------------------------------------------------------------------------

/** Cała siatka stała otoczenia. Zwraca liczbę wierzchołków. */
export function buildFormingStatic(B) {
  buildVessel(B);
  buildSupport(B);
  buildBayBox(B);
  buildPlatform(B);
  buildHallDeck(B);
  buildOxygenPlant(B);
  buildOxygenSupports(B);
  buildSlagDock(B);
  buildDrainPipe(B);
  buildFlaps(B);
  buildLineField(B);
  buildRollingMill(B);
  // (runda 8) DZIELENIE: nóż polowy z szynami, rynna odpadu, gniazda ze stołami, odbiór, ściana czołowa z bramami WYJAZD
  buildDivider(B);
  B.move(0, 0, 0);
  return B.n;
}
