// src/3d/warp/worldLens.js
//
// SOCZEWKA ŚWIATA — „PODNIESIONY ŚWIAT” w skoku gracza (DECYZJE M / P / T, 2026-10-25; projekt C „perspektywa drogi”
// z przeszczepami z B „kropla 2.0” i D). Prośba usera (2026-10-25): „w warpie ustawiasz planetę daleko, jest mała,
// i jak mijasz, to ogromna, potem znowu mała, i inne elementy gry też takie powinny być”.
//
// MAPA C (osie EKRANU, kurs = (cu, cv); ciało względem statku: a — wzdłuż kursu, + przed dziobem; l — w bok, + w prawo):
//   W   = w_s · e_s                         pas boczny (e_s — droga od kotwicy do krawędzi kadru w bok)
//   S_b = W / √(l² + B²)                    skala w trawersie [px/j.] — każde ciało, nawet 2 mln j. z boku, ma pas w kadrze
//   E   = h_f · e_f (a ≥ 0) | h_b · e_b      punkt zbiegu przed dziobem / za rufą (h_b > 1 — POZA kadrem: ciało wyjeżdża
//                                           dolną krawędzią malejąc, nie parkuje)
//   A   = E / S_b,  |a|ε = √(a² + ε²) − ε,  ε = eps · A,  κ = A / (A + |a|ε)
//   q   = S_b · κ;   obraz = P0 + q · (dx, dy),   promień = q · r
// Namiar prawdziwy (obraz na kierunku ciała od kotwicy), tarcza nigdy nie zachodzi na statek (q · (d − r) > 0), przed
// dziobem proste przechodzą w proste do punktu zbiegu („przelot po prostej”), wielkość z daleka ≈ r · E / a.
// Przejście β (0 — prawdziwy obraz, 1 — soczewka): q_β = flat^(1−β) · S_b^β · A / (A + β · |a|ε) — β → 0 daje DOKŁADNIE
// prawdziwy obraz, rodzina monotoniczna w β (ciało jedzie po swoim namiarze bez przestrzału).
//
// KOTWICA P0 (M3): P0(β) = statek + (P0_nom − statek) · β, P0_nom — nominalne miejsce statku w kadrze (sprężyna riga bez
// impulsu kopu i bez wysunięcia przy wyjściu, ctx.anchorSx / anchorSy; brak — statek). Przy β = 1 świat soczewki stoi
// w kadrze jak gwiazdy, a statek wyrywa się względem niego. Planety tła (z = −50 000): kotwica × (flat / zoom)^(1−β).
//
// PRZEJŚCIA (P2 / P3): tryb ciała ustalany RAZ na przejście (wejście: ładowanie + kop — decyzja zapada, gdy ciało
// naprawdę zaczyna przejście, np. przy otwarciu bramki ringu; wyjście — w chwili wyjścia):
//   RUCH — rodzina q_β: prawdziwy obraz w kadrze albo obraz bliski (farRatio) i wjeżdżający w kadr wolno (moveLog — próg
//          P4; duża bliska tarcza, np. planeta startu z ringiem, go nie spełnia); przy wyjściu: cel i ciało z prawdziwym
//          obrazem w kadrze; `ctx.origin` + originMove — planeta startu zawsze ruchem (A/B);
//   WYNURZENIE / ZANURZENIE — pozostałe: stoją w miejscu obrazu soczewki × (1 + emergeLift · (1 − β)), promień
//          × smoothstep(emerge0, emerge1, β) — nie przelatują przez kadr i nie wjeżdżają pod statek (reguła 10-08);
//          przy β ≤ emerge0 (promień w soczewce 0) — dokładnie prawdziwy obraz (poza kadrem), więc β → 0 = prawdziwy widok.
// Wyjście: ciało spoza celu prostuje się, gdy minie je FRONT smug gwiazd (src/render/warpLensPhase.js — od dziobu ku
// rufie w czasie ramp.slow), w `submerge` s. Wyjście w trakcie kopu (β wyjścia < 1) zostawia tryby z wejścia. Ciało,
// którego nie było w poprzedniej klatce skoku (bryła gotowa później), wynurza się w miejscu w lateTime s. Decyzja wejścia
// widzi prawdziwy obraz także w kadrze skoku po oddaleniu ładowania (ctx.zoomJump).
//
// CEL (T1 / T2): w soczewce od kopu jak każde ciało, skala q_T = miękkie maksimum (q, z_v) w logarytmie, z_v = skala
// OBRAZU celu w kadrze przylotu kamery (src/render/warpArrivalFrame.js: warpArrivalScale — ta sama funkcja co kamera;
// planety tła z perspektywą i paralaksą, miękkie minimum z kadrem skoku ctx.zoomRef). Po zatrzymaniu rampy q_T nie
// mniejsze niż prawdziwy obraz (podłoga w arrivalFloorTime s — kamera przybliżająca ponad podgląd ciągnie cel ze sobą).
// Przy wyjściu β_T = β wyjścia, dopóki skala prawdziwego obrazu celu (flat) nie zbiegnie z q_T (|ln| < arrivalConvLog
// przez arrivalConvTime s po rampie) albo do zatrzymania (koniec ślizgu, ctx.arriving) + arrivalStopGrace; potem
// 1 − smoothstep(0, arrivalRelease). Cięcie — od razu. Księżyce celu jadą jego skalą. Cel bez obrotu przelotu
// (planet3d.assets.js: lensFaceQuat).
//
// STOŻEK ZA CELEM (M4): ciało dalej wzdłuż kursu niż bliski brzeg celu, w stożku ±coneDeg wokół kursu — zanurza się
// (promień → 0 płynnie z kątem; wynurzanie / zanurzanie w miejscu — pełne od emerge0), poza stożkiem widoczne. KIESZEŃ
// KADŁUBA (poza celem): q · (d − rExt) ≥ elipsa kadłuba + edgeGap (miękkie maksimum z nośnikiem zwartym — przy zwykłych
// przelotach nieaktywna; najwyżej do skali prawdziwego obrazu — statek w promieniu pierścienia). KROPKI (M5): rekord
// z `minDot` nie mniejszy niż tyle px (planety, słońce), słońce × sunBoost; obraz < minPx gaśnie.
//
// Czysty moduł (bez three, bez DOM, bez alokacji w update). Stan klatki pisze sterownik warpa (warpNurt.js:
// WARP_WORLD_LENS), ciała rozstawia planet3d.assets.js (applyWarpWorldLens), β liczy src/render/warpLensPhase.js.
// Weryfikacja: tests/warpWorldLens.test.mjs, tests/warpLensMapC.test.mjs, tests/warpLensPrzejscia.test.mjs,
// `node scripts/webgpu/warp-soczewka-sym.mjs` (S1–S6, oba warianty kamery, `--wpiecie dzis`).

import { WARP_ARRIVAL_FRAME, warpViewEdgePx, warpArrivalScale } from '../../render/warpArrivalFrame.js';
import { WARP_LENS_PHASE, warpExitFrontS, warpBodySubmerge, warpLensExitSlow } from '../../render/warpLensPhase.js';

export const WORLD_LENS_DEFAULTS = Object.freeze({
  // MAPA C (M1–M2; px — ułamki dróg od kotwicy do krawędzi kadru, skalują się z rozdzielczością)
  hf: 0.8,              // punkt zbiegu przed dziobem × droga do krawędzi przed dziobem
  hb: 1.25,             // punkt zbiegu za rufą × droga do krawędzi za rufą (> 1 — poza kadrem)
  ws: 0.8,              // pas boczny × droga do krawędzi w bok (sędzia 2: dalszy brzeg Marsa 75 tys. w kadrze)
  B: 45000,             // [j.] miękkość pasa (warp-soczewka-sym.mjs: kontrole przechodzą dla 40–52 tys., od 55 tys. Mars
                        // 75 tys. w trawersie < 250 px przy 1080p; 45 tys. — środek: Mars 263 px)
  eps: 0.5,             // zaokrąglenie trawersu: ε = eps · A
  // Przejścia (P2)
  farRatio: 12,         // prawdziwy obraz dalej niż × obraz soczewki — wynurzenie / zanurzenie w miejscu
  moveLog: 3.5,         // ruch tylko, gdy d / (d − r) · ln(flat / Q) ≤ tyle (P4: ≤ 60 px/kl. przy wejściu w kadr przy β'
                        // ładowania ≤ 1,7/s: 60 · 60 / (540 · 1,7) ≈ 3,9)
  originMove: false,    // planeta startu (ctx.origin) zawsze „ruchem” (projekt B; A/B — symulator: ruch 100 px/kl.,
                        // promień 66 px/kl. przy wejściu w kadr, ponad progi P4; domyślnie reguła ogólna — wynurzenie)
  emerge0: 0.1,         // promień wynurzenia × smoothstep(emerge0, emerge1, β)
  emerge1: 0.8,
  emergeLift: 0.06,     // położenie wynurzenia × (1 + emergeLift · (1 − β))
  // Kieszeń kadłuba (siatka bezpieczeństwa)
  edgeGap: 24,          // [px] najmniejszy odstęp tarczy (z ringiem — rExt) od elipsy kadłuba
  pocketSoft: 20,       // [px] miękkość kieszeni
  // Kropki (M5)
  minDot: 2,            // [px] planety i słońce (newLensBody(…, 'planet' | 'sun')) nie mniejsze
  minPx: 1.5,           // [px] obraz mniejszy gaśnie
  sunBoost: 5,          // słońce w soczewce × tyle
  // Stożek za celem (M4)
  coneDeg: 30,          // [°] półkąt stożka wokół kursu
  coneSoftDeg: 3,       // [°] przejście (pełne zanurzenie od coneDeg − coneSoftDeg)
  coneRamp: 20000,      // [j.] przejście wzdłuż kursu za bliskim brzegiem celu
  // Cel i przylot (T1–T2)
  targetSoft: 0.15,     // miękkie maksimum log q celu i podglądu kadru przylotu
  arrivalConvLog: 0.05, // |ln(skala prawdziwego obrazu celu / q_T)| — kamera zbiegła z podglądem
  arrivalConvTime: 0.05, // [s] … przez tyle czasu gry (po rampie; 3 klatki przy 60 Hz — ten sam warunek przy 240 Hz workera)
  arrivalFloorTime: 1,  // [s] po zatrzymaniu rampy skala celu wchodzi pod podłogę „prawdziwy obraz” (od q_T · e^−arrivalConvLog)
  arrivalRelease: 0.6,  // [s] puszczenie celu na prawdziwy obraz
  arrivalStopGrace: 0.3, // [s] zapas po zatrzymaniu (koniec ślizgu), gdy kamera nie zbiegła
  arrivalSlideFallback: 5.5, // [s] po rampie: „zatrzymanie”, gdy sterownik nie podaje ctx.arriving
  arrivalHoldMax: 8,    // [s] po rampie najdłużej tyle trzymania
  // Ciało, które pojawia się w trakcie skoku (bryła gotowa później — `ready`), wynurza się w miejscu w tyle s
  lateTime: 0.4,
  // Obrót przelotu
  flybyHeight: 100000,  // [j.] wysokość wirtualnej kamery obrotu przelotu
  flybyTilt: 1,         // siła obrotu przelotu
  // Dawna skala jednej soczewki (warpLensScale — demo „Nurt”, dema/warp-webgpu); mapa C jej nie używa
  framingDist: 90000,
  zoomRefSpeed: 150000,
  lensScaleMax: 0.5,
  lensScaleLag: 0.15,   // [s] wygładzenie S w demie „Nurt” (dema/warp-webgpu/worldLens.js)
  sizeDepth: 30000
});

/** Tryby przejścia ciała. */
export const WORLD_LENS_MODE = Object.freeze({ NONE: 0, MOVE: 1, FAR: 2 });
const MOVE = 1;
const FAR = 2;
const ENTRY_DECIDE_BB = 0.02;   // przy wejściu tryb ustalany, póki udział soczewki ciała mniejszy (zmiana niewidoczna)
const GATE_CLOSED = 1e-6;       // bramka ringu „zamknięta”

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Miękkie maksimum dwóch dodatnich wartości w logarytmie (szerokość w). */
export function softMaxLog(a, b, w) {
  const la = Math.log(a);
  const lb = Math.log(b);
  return Math.exp(0.5 * (la + lb + Math.sqrt((la - lb) * (la - lb) + w * w)));
}

/**
 * Miękkie maksimum z nośnikiem zwartym (log): dokładnie `q`, gdy q ≥ qMin · e^w, dokładnie qMin, gdy qMin ≥ q · e^w,
 * pomiędzy — gładko (C¹). Kieszeń kadłuba nie rusza mapy przy zwykłych przelotach.
 */
export function softMaxCompact(q, qMin, w) {
  if (!(qMin > 0) || !(q > 0)) return q > 0 ? q : qMin;
  const x = Math.log(qMin / q);
  if (x <= -w) return q;
  if (x >= w) return qMin;
  return q * Math.exp((x + w) * (x + w) / (4 * w));
}

/** Odległość od punktu (sx, sy — px od środka kadru) do krawędzi kadru wzdłuż (ux, uy) [px] (y w dół). */
export function viewEdgeDistance(ux, uy, hw, hh, sx = 0, sy = 0) {
  return warpViewEdgePx(num(ux, 0), num(uy, 0), Math.max(0, num(hw, 0)), Math.max(0, num(hh, 0)), num(sx, 0), num(sy, 0));
}

/** Dawna skala jednej soczewki [px/j.] od nominalnej prędkości skoku (demo „Nurt”; mapa C jej nie używa). */
export function warpLensScale(speed, edgePx, p = WORLD_LENS_DEFAULTS, maxScale = Infinity) {
  const vr = Math.max(1, Number(p.zoomRefSpeed) || WORLD_LENS_DEFAULTS.zoomRefSpeed);
  const v = Math.max(1, Math.abs(Number(speed) || 0));
  const D = Math.max(1, Number(p.framingDist) || WORLD_LENS_DEFAULTS.framingDist) * Math.min(1, v / vr);
  const s = Math.max(1, Number(edgePx) || 1) / D;
  return Math.min(s, maxScale > 0 ? maxScale : Infinity);
}

/** Dawna perspektywa wzdłuż kursu h / √(a² + h²) (demo „Nurt”; mapa C jej nie używa). */
export function warpDepthScale(along, depth) {
  const h = Math.max(1, Number(depth) || 1);
  const a = Number(along) || 0;
  return h / Math.sqrt(a * a + h * h);
}

/** Obrót ciała przy przelocie: oś (ax, ay, 0) i kąt (układ sceny, y w górę). */
export function flybyTurn(ox, oy, h, out = { ax: 1, ay: 0, angle: 0 }) {
  const hor = Math.sqrt(ox * ox + oy * oy);
  if (!(hor > 1e-9)) {
    out.ax = 1;
    out.ay = 0;
    out.angle = 0;
    return out;
  }
  out.ax = -oy / hor;
  out.ay = ox / hor;
  out.angle = Math.atan2(hor, Math.max(1e-9, Number(h) || 0));
  return out;
}

/** Nowy kadr soczewki (rekord do warpLensFrame — raz, bez alokacji w klatce). */
export function newWarpLensFrame() {
  return { cu: 0, cv: -1, ef: 1, eb: 1, esR: 1, esL: 1, ec: 1, Ef: 1, Eb: 1, WR: 1, WL: 1, B: 1, eps: 0.5 };
}

/**
 * Kadr soczewki: kurs (cu, cv) w osiach ekranu, kadr hw × hh [px], kotwica P0 (p0x, p0y — px od środka kadru, y w dół).
 * Krawędzie liczone od kotwicy (ec — od środka kadru, przed dziobem: paralaksa tła w kadrze przylotu); E_f, E_b — punkty
 * zbiegu, W_R, W_L — pasy boczne [px]; p — parametry mapy.
 */
export function warpLensFrame(cu, cv, hw, hh, p0x, p0y, p = WORLD_LENS_DEFAULTS, out = newWarpLensFrame()) {
  const w = Math.max(0, num(hw, 0));
  const h = Math.max(0, num(hh, 0));
  const x0 = num(p0x, 0);
  const y0 = num(p0y, 0);
  out.cu = cu;
  out.cv = cv;
  out.ef = warpViewEdgePx(cu, cv, w, h, x0, y0);
  out.eb = warpViewEdgePx(-cu, -cv, w, h, x0, y0);
  out.esR = warpViewEdgePx(-cv, cu, w, h, x0, y0);
  out.esL = warpViewEdgePx(cv, -cu, w, h, x0, y0);
  out.ec = warpViewEdgePx(cu, cv, w, h, 0, 0);
  out.Ef = Math.max(1, num(p.hf, WORLD_LENS_DEFAULTS.hf) * out.ef);
  out.Eb = Math.max(1, num(p.hb, WORLD_LENS_DEFAULTS.hb) * out.eb);
  const ws = num(p.ws, WORLD_LENS_DEFAULTS.ws);
  out.WR = Math.max(1, ws * out.esR);
  out.WL = Math.max(1, ws * out.esL);
  out.B = Math.max(1, num(p.B, WORLD_LENS_DEFAULTS.B));
  out.eps = Math.max(0, num(p.eps, WORLD_LENS_DEFAULTS.eps));
  return out;
}

/**
 * Mapa C dla punktu / ciała: (dx, dy) — przesunięcie od statku w osiach ekranu [j.], β, flat — skala prawdziwego
 * widoku [px/j.], F — kadr (warpLensFrame). Wynik: out.q — skala [px/j.] (obraz = kotwica + q · (dx, dy)), a, l, d,
 * sb (S_b), A, kappa (κ_β). Bez alokacji.
 */
export function warpLensQ(dx, dy, beta, flat, F, out) {
  const a = dx * F.cu + dy * F.cv;
  const l = -dx * F.cv + dy * F.cu;
  // Pas boczny: kotwica poza osią kursu (obrót kadru w toku) daje różne boki — przejście w |l| < B bez skoku.
  const W = F.WR === F.WL ? F.WR : F.WL + (F.WR - F.WL) * smoothstep(-F.B, F.B, l);
  const sb = W / Math.sqrt(l * l + F.B * F.B);
  const E = a >= 0 ? F.Ef : F.Eb;
  const A = E / sb;
  const eps = F.eps * A;
  const aa = Math.sqrt(a * a + eps * eps) - eps;
  const b = beta > 1 ? 1 : (beta > 0 ? beta : 0);
  const kb = A / (A + b * aa);
  const fl = flat > 0 ? flat : sb;
  const qs = b >= 1 ? sb : (b <= 0 ? fl : Math.exp((1 - b) * Math.log(fl) + b * Math.log(sb)));
  out.q = qs * kb;
  out.a = a;
  out.l = l;
  out.d = Math.sqrt(dx * dx + dy * dy);
  out.sb = sb;
  out.A = A;
  out.kappa = kb;
  return out;
}

/**
 * Odwrotność mapy C (β = 1) dla HUD-u: punkt obrazu (X, Y — px od kotwicy, osie ekranu) → przesunięcie od statku
 * (out.dx, out.dy) [j.]. Postać zamknięta (namiar prawdziwy, ρ(d) rośnie monotonicznie na każdym promieniu).
 * Dokładna, gdy pas boczny nie przechodzi między stronami (W_R = W_L albo |l| ≥ B). Punkt poza rombem horyzontu —
 * out.ok = false (NaN).
 */
export function warpLensInverse(X, Y, F, out) {
  const rho = Math.sqrt(X * X + Y * Y);
  out.ok = false;
  out.dx = NaN;
  out.dy = NaN;
  if (!(rho > 1e-12)) { out.ok = true; out.dx = 0; out.dy = 0; return out; }
  const c = (X * F.cu + Y * F.cv) / rho;
  const s = (-X * F.cv + Y * F.cu) / rho;
  const E = c >= 0 ? F.Ef : F.Eb;
  const W = s >= 0 ? F.WR : F.WL;
  const K = E / rho;
  const e = F.eps;
  const ac = Math.abs(c);
  // (1 − 2e)·y² − 2K(1 − e)·y + (K² − c²) = 0,  y = A / d,  √(c² + e²y²) = K − (1 − e)·y ≥ 0
  let y = NaN;
  const qa = 1 - 2 * e;
  if (Math.abs(qa) < 1e-12) {
    y = (K * K - c * c) / (2 * K * (1 - e));
  } else {
    const disc = K * K * e * e + qa * c * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const y1 = (K * (1 - e) - sq) / qa;
      const y2 = (K * (1 - e) + sq) / qa;
      const ok1 = y1 > 0 && K - (1 - e) * y1 >= -1e-12;
      const ok2 = y2 > 0 && K - (1 - e) * y2 >= -1e-12;
      y = ok1 && ok2 ? Math.min(y1, y2) : (ok1 ? y1 : (ok2 ? y2 : NaN));
    }
  }
  if (!(y > 0) || !(K > ac - 1e-12)) return out;
  const g = y * W / E;
  const den = g * g - s * s;
  if (!(den > 0)) return out;
  const d = F.B / Math.sqrt(den);
  out.dx = X / rho * d;
  out.dy = Y / rho * d;
  out.ok = true;
  return out;
}

// Parametry i kadr mapWorldLens (bez alokacji).
const _mP = { hf: 0, hb: 0, ws: 0, B: 0, eps: 0 };
const _mF = newWarpLensFrame();
const _mQ = { q: 0, a: 0, l: 0, d: 0, sb: 0, A: 0, kappa: 1 };

/**
 * Mapa C jednego ciała (bez stanu): (dx, dy) — świat względem statku w OSIACH EKRANU [j.], y w dół; r — promień.
 * o: { zoom, flatScale (domyślnie zoom), beta, velAngle (kurs w osiach ekranu), viewHalfW/H, shipSx/Sy (KOTWICA —
 * px od środka kadru), opcjonalnie hf, hb, ws, B, eps }. Wynik (przesunięcie od kotwicy): out.x, out.y, out.size, out.q,
 * out.gap (q · (d − r)), out.d, out.theta, out.edge (droga do krawędzi przed dziobem), out.a, out.l.
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
  const P = WORLD_LENS_DEFAULTS;
  const zoom = Math.max(1e-6, num(o.zoom, 1));
  const flat = num(o.flatScale, 0) > 0 ? Number(o.flatScale) : zoom;
  const va = num(o.velAngle, 0);
  _mP.hf = num(o.hf, P.hf);
  _mP.hb = num(o.hb, P.hb);
  _mP.ws = num(o.ws, P.ws);
  _mP.B = num(o.B, P.B);
  _mP.eps = num(o.eps, P.eps);
  const F = warpLensFrame(Math.cos(va), Math.sin(va), num(o.viewHalfW, 0), num(o.viewHalfH, 0), num(o.shipSx, 0), num(o.shipSy, 0), _mP, _mF);
  const Q = warpLensQ(dx, dy, num(o.beta, 0), flat, F, _mQ);
  const rr = Math.max(0, num(r, 0));
  out.q = Q.q;
  out.x = Q.q * dx;
  out.y = Q.q * dy;
  out.size = Q.q * rr;
  out.d = Q.d;
  out.gap = Q.q * (Q.d - rr);
  out.theta = Q.d > 1e-9 ? Math.atan2(dy, dx) : va;
  out.edge = F.ef;
  out.a = Q.a;
  out.l = Q.l;
  return out;
}

/**
 * Stan soczewki w klatce — pisze sterownik warpa (warpNurt.js), czyta planet3d.assets.js.
 * Piksele = bufor rysowania celu sceny (NIE px CSS), świat gry (y w dół), kamera bez wstrząsu. Pola „(nowe)” mają wartości
 * domyślne, gdy sterownik ich nie podaje — zachowanie sensowne (kotwica = statek, front z ramp.slow 0,7 s, zatrzymanie
 * z czasu, kadr przylotu bez miękkiego minimum z kadrem skoku, decyzja wejścia na bieżącym kadrze).
 */
export const WARP_WORLD_LENS = {
  active: false,      // soczewka w tej klatce (skok gracza, kamera z góry, bez podzielonego ekranu)
  beta: 0,            // 0..1 — oś czasu skoku (src/render/warpLensPhase.js: warpLensBeta; dawniej player.js: lensBeta)
  speed: 0,           // nominalna prędkość skoku [j/s] (diagnostyka; mapa C jej nie używa)
  velAngle: 0,        // kurs skoku (świat)
  zoom: 1,            // zoom kamery [px bufora / j.] — prawdziwy widok płaszczyzny gry
  W: 1, H: 1,         // bufor rysowania [px]
  focal: 1, camZ: 1,  // kamera perspektywy passa planet tła (z = −50 000)
  camX: 0, camY: 0,   // kamera gry (świat)
  roll: 0,            // obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach EKRANU — wejścia o −roll, rozstawienie o +roll
  shipX: 0, shipY: 0, // statek (świat)
  shipSx: 0, shipSy: 0, // statek od środka kadru [px bufora, y w dół, osie ekranu]
  anchorSx: NaN, anchorSy: NaN, // (nowe, M3) kotwica P0_nom [px BUFORA od środka kadru, osie ekranu]: nominalne miejsce
                      // statku w kadrze — sprężyna riga bez impulsu kopu i wysunięcia (gra: −cameraRig.nominalX / Y w px CSS →
                      // setWarpLensAnchor(L, cssX, cssY, bufW / viewW)); NaN — statek
  hullHalfLen: 0, hullHalfWid: 0, // [px bufora]
  dt: 0,              // [s] czas gry klatki (zegar efektu; w pauzie 0)
  target: null,       // ciało celu (dane planety z gry) albo null
  origin: null,       // (nowe, P2) ciało startu (planet3d: rekord ciała) — A/B `originMove`; null — reguła ogólna
  exitAge: -1,        // [s] wiek wyjścia gracza (rampa albo wirtualna rampa wyjścia bez rampy — warpLensPhase.js:
                      // stepWarpLensTrack) z ZEGARA GRY, ciągły aż do targetHold = 0; < 0: skok albo brak
  exitSlow: 0,        // (nowe, P3) [s] koniec zwolnienia rampy (ramp.tSlowEnd) — czas frontu; 0 — WARP_LENS_PHASE.exitSlow
  exitHalt: 0,        // [s] zatrzymanie na rampie wyjścia (warpDrive.js: tHalt); wyjście bez rampy — 0
  arriving: null,     // (nowe, T2) ślizg z pędem po rampie trwa (warp.exitSlide.active) — ten sam zegar i klatka co
                      // exitAge; null — zatrzymanie z czasu (arrivalSlideFallback)
  arrivalFill: NaN,   // (nowe, T1) ułamek kadru przylotu (cameraRigTune.warpArrivalFill); NaN — WARP_ARRIVAL_FRAME.fill
  zoomRef: NaN,       // (nowe, T1) zoom odniesienia skoku [px bufora / j.] (input.zoomRef riga × pxScale) — miękkie minimum
                      // kadru przylotu z kadrem skoku jak w kamerze; NaN — bez
  zoomJump: NaN,      // (nowe, P2) zoom kadru skoku [px bufora / j.] (zoomRef × warpZoomOut) — decyzja wejścia: prawdziwy
                      // obraz w kadrze także po oddaleniu w ładowaniu; NaN — bieżący kadr
  targetHold: 0       // WYNIK WarpWorldLens.update: cel trzymany przy przylocie (0..1) — sterownik trzyma soczewkę,
                      // póki > 0, choć β wyjścia już opadło
};

/** Wyłącza soczewkę (sterownik bez skoku gracza) — wszystkie pola klatki do wartości domyślnych. */
export function resetWarpWorldLens() {
  const L = WARP_WORLD_LENS;
  L.active = false;
  L.beta = 0;
  L.target = null;
  L.origin = null;
  L.exitAge = -1;
  L.exitSlow = 0;
  L.exitHalt = 0;
  L.arriving = null;
  L.arrivalFill = NaN;
  L.zoomRef = NaN;
  L.zoomJump = NaN;
  L.anchorSx = NaN;
  L.anchorSy = NaN;
  L.targetHold = 0;
}

/**
 * Kotwica P0_nom w stanie klatki (M3): gra publikuje ją w px CSS (−cameraRig.nominalX / Y, klatka „Nurtu”: anchorSX / SY,
 * migawka WORLD.WARP_ANCHOR_SX / SY), soczewka liczy w px bufora — pxScale = bufor / CSS (Core3D.pxScale, bufW / viewW).
 * Brak liczby albo skali — NaN (kotwica = statek).
 */
export function setWarpLensAnchor(L, cssX, cssY, pxScale) {
  const s = Number(pxScale);
  const x = Number(cssX);
  const y = Number(cssY);
  const ok = s > 0 && Number.isFinite(s) && Number.isFinite(x) && Number.isFinite(y);
  L.anchorSx = ok ? x * s : NaN;
  L.anchorSy = ok ? y * s : NaN;
  return L;
}

/**
 * RING „HALO” W SOCZEWCE (user 2026-10-19: ring ma iść w soczewce razem z planetą). Pisze planet3d.assets.js
 * (DirectPlanet._lensPlace — planety z ringiem), czyta haloRingGame.js: ring = obraz planety przesunięty
 * i przeskalowany wokół jej środka. Klucz = id planety ('earth', 'mars', 'jupiter').
 *   on — planeta w soczewce w tej klatce; x, y — środek obrazu planety (świat gry); k — skala obrazu do prawdziwej
 *   (1 — prawdziwy widok); q — obrót przelotu bryły (THREE.Quaternion, kopia) albo null; real — udział prawdziwego
 *   widoku 1 − β; vis — obraz planety w kadrze.
 */
export const WARP_RING_LENS = Object.create(null);

/** Rekord ringu w soczewce dla planety `id` (tworzony raz; `q` przypina właściciel — three nie jest tu importowane). */
export function warpRingLensSlot(id) {
  let s = WARP_RING_LENS[id];
  if (!s) {
    s = { on: false, x: 0, y: 0, k: 1, q: null, turned: false, real: 1, vis: false };
    WARP_RING_LENS[id] = s;
  }
  return s;
}

/**
 * Nowy rekord ciała soczewki (raz na ciało; `out` wypełnia WarpWorldLens.update). kind (opcjonalnie): 'planet' —
 * kropka minDot, 'sun' — kropka i sunBoost, 'moon' / 'small' / '' — bez.
 */
export function newLensBody(id, kind = '') {
  const P = WORLD_LENS_DEFAULTS;
  const k = String(kind || '');
  return {
    id: String(id || ''),
    kind: k,
    x: 0, y: 0,      // prawdziwy środek (świat)
    r: 1,            // promień rysowanej kuli [j.]
    rExt: 0,         // [j.] promień z ringiem / pierścieniem (kieszeń kadłuba); 0 — r
    z: 0,            // głębokość passa (0 — płaszczyzna gry, −50 000 — tło perspektywy)
    flat: 1,         // px/j. prawdziwego widoku (β = 0)
    gate: 1,         // 0..1 — udział soczewki (0: prawdziwy ring tego ciała jest w kadrze)
    gateOpenSession: -1, // skok (WarpWorldLens.session), w którym bramka się otworzyła — potem zostaje otwarta
    gatePrev: 1,     // bramka w poprzedniej klatce soczewki (otwarcie bramki = nowa decyzja trybu)
    parent: null,    // rekord planety (księżyce)
    ready: false,    // rekord odświeżony w tej klatce
    sizeBoost: k === 'sun' ? P.sunBoost : 1, // promień w soczewce × tyle (β = 1)
    minDot: k === 'sun' || k === 'planet' ? P.minDot : 0, // [px] kropka w soczewce
    entry: 0,        // tryb przejścia (WORLD_LENS_MODE: 1 — ruch, 2 — wynurzenie / zanurzenie; 0 — nieustalony)
    entrySession: -1, // przejście (WarpWorldLens._epoch), w którym tryb ustalono
    cross: -1,       // [s] wiek wyjścia, w którym front dotknął obrazu (< 0 — jeszcze nie)
    seenFrame: -1,   // ostatnia klatka soczewki (WarpWorldLens._frame), w której rekord był gotowy
    lateAge: -1,     // [s] wynurzenie ciała, które pojawiło się w trakcie skoku (< 0 — brak)
    out: { x: 0, y: 0, size: 0, beta: 0, ax: 1, ay: 0, angle: 0, isTarget: false, q: 0 }
  };
}

/** Dawna reguła wejścia (2026-10-08) — dziś tryby przejścia (WORLD_LENS_MODE); zostaje dla zgodności importów. */
export const WORLD_LENS_ENTRY = Object.freeze({
  aheadCos: 0.5
});

/**
 * Tarcza (px od środka kadru, y w dół) w kadrze W × H — koło ∩ prostokąt (nie prostokąt otaczający: ogromna tarcza
 * po skosie „wchodziła” do kadru samym rogiem pudła).
 */
export function lensDiscInFrame(x, y, r, W, H) {
  const ex = Math.max(0, Math.abs(x) - W * 0.5);
  const ey = Math.max(0, Math.abs(y) - H * 0.5);
  return ex * ex + ey * ey < r * r;
}

/**
 * Widok ciał w klatce: dla każdego rekordu środek na ekranie [px od środka kadru, y w dół], promień [px], udział
 * soczewki i obrót przelotu. Bez alokacji.
 */
export class WarpWorldLens {
  constructor(params = {}) {
    this.params = { ...WORLD_LENS_DEFAULTS, ...params };
    this.lensScale = 0;   // dawne pole (mapa C nie ma jednej skali)
    this.session = 0;     // numer skoku (bramka ringu planet3d.assets.js: gateOpenSession)
    this._epoch = 0;      // numer przejścia (wejście / wyjście) — tryb ciała ustalany raz na przejście
    this._frame = 0;      // licznik klatek soczewki (rekord: seenFrame)
    this._sessionFrames = 0; // klatki od resetu (ciało, którego nie było w poprzedniej klatce — wynurzenie)
    this._exitOn = false;
    this._betaAtExit = 1;
    this._F = newWarpLensFrame();
    this._q = { q: 0, a: 0, l: 0, d: 0, sb: 0, A: 0, kappa: 1 };
    this._turn = { ax: 1, ay: 0, angle: 0 };
    // Przylot: czas zbieżności kamery [s], czas puszczania [s] (< 0 — trzyma, Infinity — cięcie), poprzednia odległość
    // celu, wiek wyjścia przy zatrzymaniu.
    this._arr = { conv: 0, releaseT: -1, prevD: NaN, stopT: -1 };
    // Cel tej klatki (dla księżyców celu): obraz, skala położeń qp, mnożnik promienia sf, udział, prawdziwy obraz.
    this._tg = { on: false, x: 0, y: 0, qp: 0, sf: 1, bb: 0, flat: 1, realX: 0, realY: 0, aMax: Infinity, qT: 0 };
    // Wynik ostatniego _full: pełna skala (β = 1, z kieszenią i podglądem celu) i jej stosunek do mapy.
    this._Qfull = 0;
    this._gfac = 1;
    this._fa = 0;         // a i d ciała z ostatniego _full (stożek za celem)
    this._fd = 0;
    this._sf = 1;         // mnożnik promienia ostatniego _place (księżyce celu)
    // Wejścia klatki (bez alokacji w update).
    this._L = {
      zoom: 1, W: 1, H: 1, sx: 0, sy: 0, ax: 0, ay: 0, sdx: 0, sdy: 0, pa: 1, pb: 1, fill: 0.75, dt: 0,
      exiting: false, exitAge: -1, exitHalt: 0, zoomRef: NaN, zoomJump: NaN, floorW: 0
    };
  }

  /** Koniec skoku (soczewka wyłączona): tryby ciał i trzymanie celu od nowa. */
  reset() {
    this.session++;
    this._epoch++;
    this._sessionFrames = 0;
    this._exitOn = false;
    this._arrivalReset();
  }

  _arrivalReset() {
    const A = this._arr;
    A.conv = 0;
    A.releaseT = -1;
    A.prevD = NaN;
    A.stopT = -1;
  }

  /**
   * Pełna skala ciała (β = 1) [px/j.]: mapa C × kieszeń kadłuba; cel — miękkie maksimum z podglądem kadru przylotu
   * (skala OBRAZU celu przy zoomie kadru przylotu kamery: planety tła z perspektywą i paralaksą, miękkie minimum z kadrem
   * skoku — warpArrivalScale), po zatrzymaniu rampy — nie mniej niż prawdziwy obraz (podłoga L.floorW).
   * Ustawia this._Qfull i this._gfac (Q / q mapy); this._q — wielkości mapy (a, l, A, κ).
   */
  _full(b, dx, dy, isTarget, F, L) {
    const p = this.params;
    const m = warpLensQ(dx, dy, 1, b.flat, F, this._q);
    let Q = m.q;
    const d = m.d;
    // Kieszeń kadłuba: odstęp tarczy (z ringiem) od statku ≥ elipsa kadłuba + edgeGap (statek względem kotwicy wliczony).
    // Najwyżej do skali prawdziwego obrazu: bliżej brzegu ringu (d → rExt) żadna skala nie odsunie tarczy, a statek wewnątrz
    // promienia z ringiem (pierścień Saturna sięga 1,77 r — dalej niż studnia, statek staje w nim) — wtedy obraz w soczewce
    // nie mniejszy niż prawdziwy (ciągle przy d = rExt; bez granicy skala rosła tu w nieskończoność). Cel — bez kieszeni:
    // jego bliski brzeg trzyma kadr przylotu (z_v: fill drogi do krawędzi), a gdzie kamera go nie dosięga (tło w pierścieniu),
    // soczewka ma oddać prawdziwy obraz — kieszeń zawyżałaby skalę i kamera nie zbiegałaby z celem.
    const rExt = Math.max(b.r, num(b.rExt, 0));
    if (!isTarget && d > 1e-9) {
      const ux = dx / d;
      const uy = dy / d;
      const ua = (ux * F.cu + uy * F.cv) / L.pa;
      const ul = (-ux * F.cv + uy * F.cu) / L.pb;
      const pk = 1 / Math.sqrt(ua * ua + ul * ul);
      const delta = Math.max(0, L.sdx * ux + L.sdy * uy);
      const room = d - rExt;
      const cap = Math.max(m.q, b.flat > 0 ? b.flat : m.q);
      const qMin = room > 1e-6 ? Math.min((pk + delta) / room, cap) : cap;
      Q = softMaxCompact(Q, qMin, Math.max(1e-3, p.pocketSoft / Math.max(1, pk)));
    }
    if (isTarget) {
      const ts = Math.max(1e-6, p.targetSoft);
      // Głębokość celu / ogniskowa [j./px] z prawdziwej skali (flat = zoom / (1 + k · zoom)); płaszczyzna gry — 0.
      const fl = b.flat;
      const k = b.z !== 0 && fl > 0 ? Math.max(0, 1 / fl - 1 / L.zoom) : 0;
      const zv = warpArrivalScale(F.ef, d - b.r, L.fill, k, F.ec, L.zoomRef);
      Q = softMaxLog(Q, zv, ts);
      // Podłoga po zatrzymaniu rampy (kamera przybliża ponad podgląd — np. powrót do zoomu gracza): cel jedzie z prawdziwym
      // obrazem, puszczenie bez skoku. Wchodzi od Q · e^−w (tam dokładnie Q) do prawdziwej skali w arrivalFloorTime s;
      // szerokość w = arrivalConvLog — przy zbieżnej kamerze cel rośnie najwyżej o e^(w/4) ≈ 1,3%.
      if (L.floorW > 0 && fl > 0) {
        const w = Math.max(1e-6, p.arrivalConvLog);
        const q0 = Q * Math.exp(-w);
        if (fl > q0) Q = softMaxCompact(Q, Math.exp(Math.log(q0) + L.floorW * Math.log(fl / q0)), w);
      }
    }
    this._Qfull = Q;
    this._gfac = Q / m.q;
    this._fa = m.a;
    this._fd = d;
    return Q;
  }

  /**
   * Tryb przejścia ciała (raz na przejście; przy wejściu — ustalany jeszcze, póki udział soczewki < ENTRY_DECIDE_BB:
   * wtedy oba tryby wyglądają tak samo — ruch to prawdziwy obraz, wynurzenie to promień 0 — więc zmiana jest niewidoczna,
   * a decyzja zapada w chwili, gdy ciało naprawdę zaczyna przejście, np. przy otwarciu bramki ringu).
   */
  _decide(b, isTarget, isOrigin, Q, dx, dy, L) {
    const p = this.params;
    const fl = b.flat;
    const mb = fl / L.zoom;
    const X = L.sx * mb + dx * fl;
    const Y = L.sy * mb + dy * fl;
    const R = b.r * fl;
    let realIn = lensDiscInFrame(X, Y, R, L.W, L.H);
    if (L.exiting) return isTarget || realIn ? MOVE : FAR;
    // Ładowanie oddala kamerę do kadru skoku (zoomJump): prawdziwy obraz, który wejdzie w kadr po oddaleniu, też „w kadrze”
    // (inaczej wynurzenie pokazałoby go prawdziwego przy β ≤ emerge0 i zgasiło przy emerge0). Kamera stoi — obraz
    // skaluje się wokół środka kadru (płaszczyzna: zoomJump / zoom, tło: skala perspektywy przy zoomJump / flat).
    if (!realIn && L.zoomJump > 0 && L.zoomJump < L.zoom && fl > 0) {
      const k = b.z !== 0 ? Math.max(0, 1 / fl - 1 / L.zoom) : 0;
      const s = L.zoomJump / (1 + k * L.zoomJump) / fl;
      realIn = lensDiscInFrame(X * s, Y * s, R * s, L.W, L.H);
    }
    // Bramka ringu zamknięta (prawdziwy ring z portem w kadrze) — ruch: przy β · bramka → 0 dokładnie prawdziwy obraz
    // (ring jedzie w slocie za obrazem planety). Pierwsza klatka otwarcia ustala tryb od nowa (ring jest już za kadrem).
    if (!(b.gate > GATE_CLOSED) || realIn || (isOrigin && p.originMove)) return MOVE;
    // Ruch tylko dla obrazów bliskich prawdziwemu (farRatio) i takich, których obraz wjeżdża w kadr wolno: przy wejściu
    // brzegu w kadr (podobieństwo wokół kotwicy) środek jedzie ≈ krawędź · d / (d − r) · ln(flat / Q) · β' — duża bliska
    // tarcza (planeta startu z ringiem: × 2,9 · 2,4) przekracza próg P4 — wynurza się w miejscu.
    const ratio = fl / Math.max(1e-12, Q);
    const d = Math.sqrt(dx * dx + dy * dy);
    const near = d > b.r * 1.0001 ? d / (d - b.r) : Infinity;
    return ratio <= p.farRatio && near * Math.log(Math.max(1, ratio)) <= p.moveLog ? MOVE : FAR;
  }

  /**
   * Tryb ciała w tej klatce (pisze b.entry, b.entrySession, b.cross, b.seenFrame, b.lateAge). Nowe przejście (wejście /
   * wyjście) — decyzja od nowa; ciała nie było w poprzedniej klatce skoku (bryła gotowa później) — wynurza się w miejscu
   * w lateTime s; wyjście w trakcie kopu (β wyjścia < 1) — tryby z wejścia zostają (przestawienie ruch ↔ wynurzenie przy
   * β < 1 to skok położenia).
   */
  _mode(b, isTarget, isOrigin, Q, dx, dy, bb, open, L) {
    const exiting = L.exiting;
    const fresh = b.entrySession !== this._epoch;
    const appear = !exiting && this._sessionFrames > 0 && b.seenFrame !== this._frame - 1 && bb >= ENTRY_DECIDE_BB;
    if (appear) {
      b.entrySession = this._epoch;
      b.cross = -1;
      b.entry = FAR;
      b.lateAge = 0;
    } else if (fresh || (!exiting && (bb < ENTRY_DECIDE_BB || open))) {
      b.entrySession = this._epoch;
      b.cross = -1;
      const keep = exiting && fresh && this._betaAtExit < 1 - 1e-6 && b.entry !== 0;
      if (!keep) b.entry = this._decide(b, isTarget, isOrigin, Q, dx, dy, L);
      if (!exiting && this._sessionFrames === 0) b.lateAge = -1;
    }
    b.seenFrame = this._frame;
    if (b.lateAge >= 0) {
      b.lateAge += L.dt;
      if (b.lateAge >= this.params.lateTime) b.lateAge = -1;
    }
  }

  /**
   * Obraz ciała przy udziale soczewki bb (pełna skala już w this._Qfull). Pisze b.out.x / y / size, zwraca skalę
   * położeń (px/j.) — dla księżyców celu (this._tg).
   */
  _place(b, dx, dy, bb, isTarget, F, L) {
    const p = this.params;
    const out = b.out;
    const fl = b.flat;
    const Q = this._Qfull;
    const boost = num(b.sizeBoost, 1) > 0 ? Number(b.sizeBoost) : 1;
    const dot = Math.max(0, num(b.minDot, 0));
    let size;
    let qp;
    let sf = 1;
    if (b.entry === FAR && bb <= p.emerge0) {
      // Wynurzenie przed startem / po zanurzeniu (promień w soczewce byłby 0): DOKŁADNIE prawdziwy obraz (poza kadrem —
      // tryb FAR wybiera się tylko wtedy), więc β → 0 = prawdziwy widok, a smugi słońca i ring liczą się z prawdziwego.
      const mb = fl / L.zoom;
      out.x = L.sx * mb + fl * dx;
      out.y = L.sy * mb + fl * dy;
      size = fl * b.r;
      qp = fl;
    } else if (b.entry === FAR) {
      // Wynurzenie / zanurzenie w miejscu obrazu soczewki (od kotwicy kadru — świat stoi jak gwiazdy); ciało nowe w skoku
      // (lateAge) — dodatkowo wynurza się w lateTime s.
      const k = 1 + p.emergeLift * (1 - bb);
      out.x = L.ax + k * Q * dx;
      out.y = L.ay + k * Q * dy;
      const full = Math.max(Q * b.r * boost, dot);
      let e = smoothstep(p.emerge0, p.emerge1, bb);
      if (b.lateAge >= 0) e *= smoothstep(0, Math.max(1e-3, p.lateTime), b.lateAge);
      size = full * e;
      qp = k * Q;
      sf = b.r > 0 ? size / (b.r * qp) : 1;
    } else {
      // Ruch: rodzina q_β (cel — log-lerp skali celu), kotwica P0(β), planety tła × (flat / zoom)^(1−β).
      let q;
      if (isTarget) q = bb >= 1 ? Q : (bb <= 0 ? fl : Math.exp((1 - bb) * Math.log(fl) + bb * Math.log(Q)));
      else {
        warpLensQ(dx, dy, bb, fl, F, this._q);
        q = this._q.q * (this._gfac === 1 || bb <= 0 ? 1 : Math.pow(this._gfac, bb));
      }
      const ax = L.sx + (L.ax - L.sx) * bb;
      const ay = L.sy + (L.ay - L.sy) * bb;
      const mb = fl === L.zoom || bb >= 1 ? 1 : Math.pow(fl / L.zoom, 1 - bb);
      out.x = ax * mb + q * dx;
      out.y = ay * mb + q * dy;
      size = q * b.r * (boost === 1 || bb <= 0 ? 1 : Math.pow(boost, bb));
      if (dot > 0 && size < dot * bb) size = dot * bb;
      qp = q;
      sf = b.r > 0 && q > 0 ? size / (b.r * q) : 1;
    }
    out.size = size;
    out.q = qp;
    this._sf = sf;
    return qp;
  }

  /** Obraz < minPx gaśnie (z udziałem soczewki — β → 0 zostaje prawdziwy). */
  _fadeTiny(out, bb) {
    const mp = this.params.minPx;
    if (!(mp > 0) || !(bb > 0) || out.size >= mp) return;
    out.size *= 1 - bb * (1 - smoothstep(mp * (2 / 3), mp, out.size));
  }

  /**
   * PRZYLOT (T2): β celu przy wyjściu. 1, dopóki skala prawdziwego obrazu celu (flat — zoom kamery w głębokości celu) nie
   * zbiegnie z q_T (po rampie, przez arrivalConvTime s czasu gry) albo do zatrzymania + zapas (ctx.arriving === false; bez
   * pola — po arrivalSlideFallback s ślizgu); potem puszczenie w arrivalRelease s. Cięcie (prawdziwa odległość celu
   * skoczyła o więcej niż 2 kadry) — 0 od razu.
   */
  _arrivalHold(target, d, qT, ctx, L) {
    const p = this.params;
    const A = this._arr;
    if (A.releaseT === Infinity) return 0;
    const fl = Math.max(1e-12, num(target.flat, L.zoom));
    if (Number.isFinite(A.prevD) && Math.abs(d - A.prevD) * fl > 2 * Math.max(L.W, L.H)) {
      A.releaseT = Infinity;
      A.prevD = d;
      return 0;
    }
    A.prevD = d;
    const age = L.exitAge;
    const halt = L.exitHalt;
    if (age >= halt && Math.abs(Math.log(fl / Math.max(1e-12, qT))) < p.arrivalConvLog) A.conv += L.dt;
    else A.conv = 0;
    const arr = ctx.arriving;
    if (arr === true) A.stopT = -1;
    else if (age >= halt && A.stopT < 0 && (arr === false || age >= halt + p.arrivalSlideFallback)) A.stopT = age;
    if (A.releaseT < 0) {
      if ((A.conv > 0 && A.conv >= p.arrivalConvTime - 1e-9) || (A.stopT >= 0 && age - A.stopT >= p.arrivalStopGrace)
        || age > halt + p.arrivalHoldMax) A.releaseT = 0;
    } else A.releaseT += L.dt;
    return A.releaseT < 0 ? 1 : 1 - smoothstep(0, Math.max(0.05, p.arrivalRelease), A.releaseT);
  }

  /**
   * bodies — rekordy newLensBody (gotowe: `ready`), n — ile; ctx — WARP_WORLD_LENS; target — rekord ciała celu albo null;
   * visible — dawny test kadru po rulonie (mapa C go nie potrzebuje; zostaje w sygnaturze).
   */
  update(bodies, n, ctx, target = null, visible = lensDiscInFrame) { // visible — nieużywany (zgodność wywołań)
    const p = this.params;
    const L = this._L;
    this._frame++;
    L.zoom = Math.max(1e-6, num(ctx.zoom, 1));
    const beta = clamp(num(ctx.beta, 0), 0, 1);
    L.dt = clamp(num(ctx.dt, 0), 0, 0.1);
    L.W = Math.max(1, num(ctx.W, 1));
    L.H = Math.max(1, num(ctx.H, 1));
    // Obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach ekranu — przesunięcia ze świata R(−roll), kurs − roll;
    // obrót przelotu (flybyTurn) zostaje w osiach świata (kręci kulą w scenie).
    const roll = num(ctx.roll, 0);
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    const course = num(ctx.velAngle, 0) - roll;
    const cu = Math.cos(course);
    const cv = Math.sin(course);
    L.sx = num(ctx.shipSx, 0);
    L.sy = num(ctx.shipSy, 0);
    L.ax = Number.isFinite(ctx.anchorSx) ? ctx.anchorSx : L.sx;
    L.ay = Number.isFinite(ctx.anchorSy) ? ctx.anchorSy : L.sy;
    L.sdx = L.sx - L.ax;
    L.sdy = L.sy - L.ay;
    L.pa = Math.max(1, num(ctx.hullHalfLen, 0)) + Math.max(0, p.edgeGap);
    L.pb = Math.max(1, num(ctx.hullHalfWid, 0)) + Math.max(0, p.edgeGap);
    L.fill = num(ctx.arrivalFill, WARP_ARRIVAL_FRAME.fill);
    L.zoomRef = num(ctx.zoomRef, NaN);
    L.zoomJump = num(ctx.zoomJump, NaN);
    const F = warpLensFrame(cu, cv, L.W * 0.5, L.H * 0.5, L.ax, L.ay, p, this._F);
    // Wyjście: nowe przejście (tryby od nowa — poza wyjściem w trakcie kopu), front smug gwiazd, trzymanie celu.
    const exitAge = Number(ctx.exitAge);
    const exiting = exitAge >= 0;
    if (exiting !== this._exitOn) {
      this._exitOn = exiting;
      this._epoch++;
      this._betaAtExit = beta;
      this._arrivalReset();
    }
    L.exiting = exiting;
    L.exitAge = exiting ? exitAge : -1;
    L.exitHalt = Math.max(0, num(ctx.exitHalt, 0));
    L.floorW = exiting ? smoothstep(L.exitHalt, L.exitHalt + Math.max(1e-3, p.arrivalFloorTime), exitAge) : 0;
    const exitSlow = warpLensExitSlow(ctx.exitSlow);
    const frontPx = exiting ? warpExitFrontS(exitAge, exitSlow) * L.zoom : Infinity;
    const origin = ctx.origin || null;
    const sx0 = num(ctx.shipX, 0);
    const sy0 = num(ctx.shipY, 0);
    const tilt = Math.max(0, p.flybyTilt);
    const hCam = Math.max(1, p.flybyHeight);
    const coneCos0 = Math.cos(Math.max(0, p.coneDeg) * Math.PI / 180);
    const coneCos1 = Math.cos(Math.max(0, p.coneDeg - p.coneSoftDeg) * Math.PI / 180);

    // --- Cel (przed resztą: księżyce celu jadą jego skalą) ---
    const T = this._tg;
    T.on = false;
    T.aMax = Infinity;
    let targetHold = 0;
    if (target && target.ready) {
      const twx = target.x - sx0;
      const twy = target.y - sy0;
      const tdx = rc * twx + rs * twy;
      const tdy = -rs * twx + rc * twy;
      const td = Math.sqrt(tdx * tdx + tdy * tdy);
      T.aMax = tdx * cu + tdy * cv - target.r;
      const Q = this._full(target, tdx, tdy, true, F, L);
      let bT;
      if (exiting) {
        targetHold = this._arrivalHold(target, td, Q, ctx, L);
        bT = targetHold * this._betaAtExit;
      } else {
        this._arrivalReset();
        bT = beta;
      }
      bT *= clamp(num(target.gate, 1), 0, 1);
      const tOpen = target.gatePrev <= GATE_CLOSED && target.gate > GATE_CLOSED;
      target.gatePrev = num(target.gate, 1);
      this._mode(target, true, target === origin, Q, tdx, tdy, bT, tOpen, L);
      const qp = this._place(target, tdx, tdy, bT, true, F, L);
      const out = target.out;
      this._fadeTiny(out, bT);
      out.beta = bT;
      out.isTarget = true;
      out.ax = 1;
      out.ay = 0;
      out.angle = 0;
      const fl = target.flat;
      const mT = fl / L.zoom;
      T.on = true;
      T.x = out.x;
      T.y = out.y;
      T.qp = qp;
      T.sf = this._sf;
      T.bb = bT;
      T.flat = fl;
      T.realX = L.sx * mT + tdx * fl;
      T.realY = L.sy * mT + tdy * fl;
      T.qT = Q;
    } else this._arrivalReset();
    ctx.targetHold = targetHold;

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b || !b.ready || b === target) continue;
      const wdx = b.x - sx0;
      const wdy = b.y - sy0;
      const dx = rc * wdx + rs * wdy;
      const dy = -rs * wdx + rc * wdy;
      const out = b.out;
      out.isTarget = false;
      out.ax = 1;
      out.ay = 0;
      out.angle = 0;
      if (T.on && b.parent === target) {
        // Księżyc celu: wokół obrazu celu w jego skali; przy β → 0 dokładnie prawdziwy obraz (poprawka różnicy skal).
        const mwx = b.x - target.x;
        const mwy = b.y - target.y;
        const rx = rc * mwx + rs * mwy;
        const ry = -rs * mwx + rc * mwy;
        const fl = b.flat;
        const mM = fl / L.zoom;
        const cx = (L.sx * mM + dx * fl) - (T.realX + rx * T.flat);
        const cy = (L.sy * mM + dy * fl) - (T.realY + ry * T.flat);
        const w = 1 - T.bb;
        out.x = T.x + rx * T.qp + cx * w;
        out.y = T.y + ry * T.qp + cy * w;
        out.size = b.r * T.qp * T.sf * (fl === T.flat || w <= 0 ? 1 : Math.pow(fl / T.flat, w));
        out.q = T.qp;
        out.beta = T.bb;
        b.entry = target.entry;
        b.seenFrame = this._frame;
        this._fadeTiny(out, T.bb);
        continue;
      }
      const Q = this._full(b, dx, dy, false, F, L);
      let bb = beta * clamp(num(b.gate, 1), 0, 1);
      const open = b.gatePrev <= GATE_CLOSED && b.gate > GATE_CLOSED;
      b.gatePrev = num(b.gate, 1);
      this._mode(b, false, b === origin, Q, dx, dy, bb, open, L);
      if (exiting) {
        // Front smug gwiazd (od dziobu ku rufie): dotknął obrazu soczewki — ciało zanurza się / wraca w `submerge` s.
        if (b.cross < 0) {
          const lead = (L.ax + Q * dx - L.sx) * cu + (L.ay + Q * dy - L.sy) * cv + Q * b.r * num(b.sizeBoost, 1);
          if (frontPx <= lead || exitAge >= exitSlow) b.cross = exitAge;
        }
        bb *= warpBodySubmerge(b.cross, exitAge, WARP_LENS_PHASE);
      }
      const fa = this._fa;
      const fd = this._fd;
      this._place(b, dx, dy, bb, false, F, L);
      // Stożek za celem (M4): zanurzenie z kątem od kursu (za bliskim brzegiem celu). Wynurzenie / zanurzenie w miejscu —
      // pełne już od emerge0 (promień i tak gaśnie z bb; iloczyn z 1 − h · bb wyskakiwał przy zanurzaniu w wyjściu).
      if (T.on && bb > 0 && fd > 1e-9 && fa > T.aMax) {
        const h = smoothstep(coneCos0, coneCos1, fa / fd) * smoothstep(0, Math.max(1, p.coneRamp), fa - T.aMax);
        if (h > 0) out.size *= 1 - h * (b.entry === FAR ? smoothstep(0, p.emerge0, bb) : bb);
      }
      this._fadeTiny(out, bb);
      out.beta = bb;
      // Obrót przelotu (w soczewce): wirtualna kamera nad statkiem patrzy na ciało pod kątem.
      if (tilt > 0 && bb > 0.002) {
        flybyTurn(wdx, -wdy, hCam, this._turn);
        out.ax = this._turn.ax;
        out.ay = this._turn.ay;
        out.angle = this._turn.angle * tilt * bb;
      }
    }
    this._sessionFrames++;
    return n;
  }
}
