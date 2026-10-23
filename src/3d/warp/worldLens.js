// src/3d/warp/worldLens.js
//
// SOCZEWKA ŚWIATA — planety i księżyce w skoku gracza (demo „Nurt”: dema/warp-webgpu/worldLens.js,
// propozycja 1: dawny src/3d/warpWorldLens.js; user 2026-10-07: „zauważ, jak tam fajnie zachowują
// się planety — Mars jest rozlewany, rozciągany, a finalna planeta pokazywana, a potem wlatuje; ten
// feel zniknął z gry”). Port warpa do gry (zadanie 22) soczewki nie przeniósł: w skoku planety
// leżały w prawdziwych miejscach, setki tysięcy jednostek od kadru — przez cały lot żadna nie
// trafiała do obrazu, a przy wyjściu kadr był pusty.
//
// Zasada (docs/BRIEF-warp.md §4.3, user 2026-09-26: „przelatujemy obok → statek zwalnia, planeta
// płynnie rośnie, obraca się, maleje, zostaje z tyłu, bez sztucznych efektów”):
//   • jedna skala S [px na jednostkę świata] dla wszystkich ciał, z NOMINALNEJ prędkości skoku
//     (warpLensScale) — mijane ciało leci po prostej w swojej prawdziwej odległości od kursu;
//   • wielkość × perspektywa wzdłuż kursu h/√(a² + h²) — rośnie przy zbliżaniu, prawdziwa przy
//     mijaniu, maleje za rufą; statek zwalnia przy ciele (warpFlybySlowdown, warpDrive.js);
//   • przelot obraca ciało (flybyTurn — wirtualna kamera nad statkiem, słońce obraca się z ciałem);
//   • CEL wisi przy krawędzi kadru przed dziobem i rośnie; przy wyjściu β spada do 0 i cel
//     „wlatuje” na swoje prawdziwe miejsce;
//   • rulon (rulon.js) zgina ciała jak resztę gry — w lejku przy statku planeta rozlewa się
//     w klepsydrę (boost powiększa ciało przeciągane przez lejek).
// Przejście β (0 = prawdziwy widok, 1 = soczewka): odstęp liniowo, wielkość w logarytmie.
//
// Czysty moduł (bez three, bez DOM). Stan klatki pisze sterownik warpa (warpNurt.js:
// WARP_WORLD_LENS), ciała rozstawia planet3d.assets.js (applyWarpWorldLens). Demo bierze stąd
// czyste funkcje (jedno źródło matematyki).

export const WORLD_LENS_DEFAULTS = Object.freeze({
  framingDist: 90000,   // [j.] tyle świata mieści się od statku do krawędzi kadru przy zoomRefSpeed
  zoomRefSpeed: 150000, // [j/s] wolniejszy skok — ciaśniejszy kadr (ciała mijają kadr w tym samym tempie)
  lensScaleMax: 0.5,    // S najwyżej × zoom kamery
  lensScaleLag: 0.15,   // [s] wygładzenie zmian S
  sizeDepth: 30000,     // [j.] h perspektywy wzdłuż kursu (za rufą; przed dziobem — perspektywa przelotu niżej)
  // PRZELOT Z DALEKA (2026-10-23, user: „przelot ma wyglądać podobnie do dotarcia do celu — planeta z daleka, powoli
  // rośnie, pod statkiem duża, potem ucieka za statek; obecnie się po prostu pojawia”): mijane ciało przed dziobem
  // w perspektywie z punktem zbiegu na kursie (approachEdge × odległość statek → krawędź kadru przed dziobem):
  // położenie i wielkość × k = A0 / (a + A0), A0 = E / S (w trawersie k = 1 — obraz jak dawniej, za rufą bez zmian).
  // Tylko ciała, które w tym skoku miniemy: obraz w trawersie w kadrze (odstęp od kursu × S do approachLatNear /
  // approachLatFar drogi od statku do krawędzi kadru w bok) i przed końcem skoku (cel — WarpWorldLens: approachMax).
  approachEdge: 0.8,    // punkt zbiegu: ułamek drogi od statku do krawędzi kadru przed dziobem
  approachLatNear: 0.8, // odstęp od kursu w trawersie (× droga do krawędzi kadru w bok): do tego pełna perspektywa,
  approachLatFar: 1.2,  // od tego żadna (ciało i tak nie wejdzie w kadr przy mijaniu)
  flybyHeight: 100000,  // [j.] wysokość wirtualnej kamery obrotu przelotu
  flybyTilt: 1,         // siła obrotu przelotu
  targetWindow: 450000, // [j.] cel bliżej niż to zjeżdża od krawędzi kadru ku statkowi
  sizeK: 600,           // wielkość celu przy krawędzi: r · sizeK / (d + sizeD0) · holdSize [px]
  sizeD0: 30000,
  holdSize: 0.5,
  holdPeek: 0.5,        // jaka część tarczy celu wystaje zza krawędzi kadru
  holdSoft: 40,         // [px] miękkie maksimum odstępów celu
  edgeGap: 24,          // [px] najmniejszy odstęp celu od kadłuba
  // PRZYLOT (WarpWorldLens.update — cel trzyma się krawędzi, póki prawdziwy obraz go nie dogoni):
  arrivalKneePx: 60,    // [px] miękkie kolano przejścia (dogonienie bez ruchu celu na zewnątrz kadru)
  arrivalStopPx: 40,    // [px/s] statek „stoi”, gdy prawdziwy obraz celu zbliża się wolniej — puszczenie
  arrivalRelease: 0.8,  // [s] puszczenie celu na prawdziwe miejsce (statek stanął przed dogonieniem)
  arrivalHoldMax: 8     // [s] po rampie wyjścia najdłużej tyle trzymania
});

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Odległość od statku do krawędzi kadru wzdłuż (ux, uy) [px] (y w dół). */
export function viewEdgeDistance(ux, uy, hw, hh, sx = 0, sy = 0) {
  const w = Math.max(0, Number(hw) || 0);
  const h = Math.max(0, Number(hh) || 0);
  const x0 = Number(sx) || 0;
  const y0 = Number(sy) || 0;
  const tx = ux > 1e-9 ? (w - x0) / ux : (ux < -1e-9 ? (-w - x0) / ux : Infinity);
  const ty = uy > 1e-9 ? (h - y0) / uy : (uy < -1e-9 ? (-h - y0) / uy : Infinity);
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Skala soczewki [px/j.] od nominalnej prędkości skoku. */
export function warpLensScale(speed, edgePx, p = WORLD_LENS_DEFAULTS, maxScale = Infinity) {
  const vr = Math.max(1, Number(p.zoomRefSpeed) || WORLD_LENS_DEFAULTS.zoomRefSpeed);
  const v = Math.max(1, Math.abs(Number(speed) || 0));
  const D = Math.max(1, Number(p.framingDist) || WORLD_LENS_DEFAULTS.framingDist) * Math.min(1, v / vr);
  const s = Math.max(1, Number(edgePx) || 1) / D;
  return Math.min(s, maxScale > 0 ? maxScale : Infinity);
}

/** Perspektywa wzdłuż kursu: mnożnik wielkości ciała `along` przed dziobem / za rufą. */
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

/**
 * Ciało względem statku (dx, dy — świat, y w dół; r — promień) → przesunięcie środka na
 * ekranie od statku [px, y w dół], promień [px] i odstęp krawędzi od statku.
 * o: { zoom, flatScale (px/j. prawdziwego widoku ciała; domyślnie zoom), beta (0..1),
 *   velAngle (kurs), lensScale (S), sizeDepth, sizeBoost,
 *   hold (0..1 — cel przy krawędzi), viewHalfW/H, shipSx/Sy (statek od środka kadru, px),
 *   gapPx, hullHalfLen/Wid [px], sizeK, sizeD0, holdSize, holdPeek, holdSoft, targetWindow }
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
  const P = WORLD_LENS_DEFAULTS;
  const d = Math.sqrt(dx * dx + dy * dy);
  const zoom = Math.max(1e-6, Number(o.zoom) || 1);
  const flat = Number(o.flatScale) > 0 ? Number(o.flatScale) : zoom;
  const beta = clamp(Number(o.beta) || 0, 0, 1);
  const va = Number(o.velAngle) || 0;
  const theta = d > 1e-9 ? Math.atan2(dy, dx) : va;
  const rr = Math.max(0, r);
  const flatSize = rr * flat;
  const flatGap = d * flat - flatSize;
  out.d = d;
  out.edge = 0;
  if (beta <= 0) {
    out.x = dx * flat;
    out.y = dy * flat;
    out.size = flatSize;
    out.theta = theta;
    out.gap = flatGap;
    return out;
  }
  const S = Math.max(1e-12, Number(o.lensScale) || 0);
  const along = d * Math.cos(theta - va);
  let lensSize = rr * S * (Number(o.sizeBoost) || 1) * warpDepthScale(along, Number(o.sizeDepth) || P.sizeDepth);
  let lensGap = S * d - lensSize;
  const hold = clamp(Number(o.hold) || 0, 0, 1) * smoothstep(0, 0.5, Math.cos(theta - va));
  if (hold > 0) {
    const cu = Math.cos(theta - va);
    const cv = Math.sin(theta - va);
    const edgePx = viewEdgeDistance(Math.cos(theta), Math.sin(theta), o.viewHalfW, o.viewHalfH, o.shipSx, o.shipSy);
    const margin = Math.max(0, Number(o.gapPx) || 0)
      + Math.abs(cu) * Math.max(0, Number(o.hullHalfLen) || 0)
      + Math.abs(cv) * Math.max(0, Number(o.hullHalfWid) || 0);
    const K = Number(o.sizeK) || P.sizeK;
    const d0 = Math.max(1, Number(o.sizeD0) || P.sizeD0);
    const sh = rr * K / (d + d0) * Math.max(1e-3, Number(o.holdSize) || 1);
    const peek = clamp(Number.isFinite(o.holdPeek) ? o.holdPeek : 0.5, 0, 1);
    const gh = Math.max(margin, edgePx - 2 * sh * peek);
    const win = Math.max(1, Number(o.targetWindow) || P.targetWindow);
    const gn = margin + Math.max(0, edgePx - margin) * Math.max(0, d - rr) / win;
    const w = Math.max(1, Number(o.holdSoft) || 1);
    const gm = 0.5 * (gn + gh + Math.sqrt((gn - gh) * (gn - gh) + w * w));
    lensGap += (gm - lensGap) * hold;
    lensSize = (lensSize > 1e-12 && sh > 1e-12)
      ? Math.exp(Math.log(lensSize) * (1 - hold) + Math.log(sh) * hold)
      : lensSize + (sh - lensSize) * hold;
    out.edge = edgePx;
  }
  const gap = flatGap + (lensGap - flatGap) * beta;
  const size = (flatSize > 1e-9 && lensSize > 1e-9)
    ? Math.exp(Math.log(flatSize) * (1 - beta) + Math.log(lensSize) * beta)
    : flatSize * (1 - beta) + lensSize * beta;
  const rho = Math.max(0, gap + size);
  out.x = Math.cos(theta) * rho;
  out.y = Math.sin(theta) * rho;
  out.size = size;
  out.theta = theta;
  out.gap = gap;
  // PRZELOT Z DALEKA (mijane ciało przed dziobem, nie cel): perspektywa z punktem zbiegu na kursie. Pełna soczewka
  // (β = 1): położenie i wielkość × k = A0 / (a + A0), A0 = E / S. Przejście β (wejście w soczewkę, wyjście) w tej samej
  // rodzinie rzutów: skala S_β = flat^(1−β) · S^β (logarytmicznie), k_β = 1 / (1 + a · β / A0) — β → 0 daje prawdziwy
  // obraz (położenie i wielkość), β = 1 perspektywę, bez skoku przy każdym β (przegląd 2026-10-23: wielkość × β
  // w punkcie zbiegu, a przy β = 0 prawdziwy obraz — planeta przed dziobem przy wyjściu kurczyła się do kropki
  // i wskakiwała na prawdziwe miejsce). Przy trawersie (a → 0) i za rufą — obraz jak wyżej. Tylko ciała, które w tym
  // skoku miniemy: blisko kursu (approachLat*) i przed końcem skoku (o.approachMax [j.] wzdłuż kursu — cel).
  const app = clamp(Number(o.approach) || 0, 0, 1) * (1 - hold);
  if (app > 0 && along > 0) {
    const ux = Math.cos(va);
    const uy = Math.sin(va);
    const lat = d * Math.sin(theta - va);
    const sideX = lat >= 0 ? -uy : uy;
    const sideY = lat >= 0 ? ux : -ux;
    const acrossPx = Math.max(1, viewEdgeDistance(sideX, sideY, o.viewHalfW, o.viewHalfH, o.shipSx, o.shipSy));
    const pLat = Number(o.approachLatNear) || P.approachLatNear;
    const pFar = Math.max(pLat + 1e-3, Number(o.approachLatFar) || P.approachLatFar);
    const edgePx = viewEdgeDistance(ux, uy, o.viewHalfW, o.viewHalfH, o.shipSx, o.shipSy);
    const E = Math.max(1, edgePx * (Number(o.approachEdge) || P.approachEdge));
    const A0 = E / S;
    const aMax = Number.isFinite(o.approachMax) ? o.approachMax : Infinity;
    // udział: blisko kursu pełny, płynnie od trawersu (ciągłość przy a ≈ 0), przed końcem skoku (za celem — żaden)
    const w = app * (1 - smoothstep(pLat, pFar, Math.abs(lat) * S / acrossPx)) * smoothstep(0, 0.05 * A0, along)
      * (aMax < Infinity ? 1 - smoothstep(aMax * 0.85, aMax, along) : 1);
    if (w > 0) {
      const Sb = Math.exp(Math.log(Math.max(1e-12, flat)) * (1 - beta) + Math.log(S) * beta);
      const kb = 1 / (1 + along * beta / A0);
      const lx = Sb * kb * (along * ux - lat * uy);
      const ly = Sb * kb * (along * uy + lat * ux);
      const ls = rr * Sb * kb * (1 + ((Number(o.sizeBoost) || 1) - 1) * beta);
      out.x += (lx - out.x) * w;
      out.y += (ly - out.y) * w;
      out.size = size + (ls - size) * w;
      out.gap = Math.sqrt(out.x * out.x + out.y * out.y) - out.size;
    }
  }
  return out;
}

/**
 * Stan soczewki w klatce — pisze sterownik warpa (warpNurt.js), czyta planet3d.assets.js.
 * Piksele = bufor rysowania celu sceny (jak rulon), świat gry (y w dół), kamera bez wstrząsu.
 */
export const WARP_WORLD_LENS = {
  active: false,      // soczewka w tej klatce (skok gracza, kamera z góry, bez podzielonego ekranu)
  beta: 0,            // 0..1 — oś czasu skoku (player.js: lensBeta)
  speed: 0,           // nominalna prędkość skoku [j/s] (bez zwolnień przy ciałach i stref)
  velAngle: 0,        // kurs skoku
  zoom: 1,
  W: 1, H: 1,         // bufor rysowania [px]
  focal: 1, camZ: 1,  // kamera perspektywy passa planet tła (z = −50 000)
  camX: 0, camY: 0,   // kamera gry (świat)
  roll: 0,            // obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach EKRANU — wejścia o −roll, rozstawienie o +roll
  shipX: 0, shipY: 0, // statek (świat)
  shipSx: 0, shipSy: 0, // statek od środka kadru [px, y w dół, osie ekranu]
  hullHalfLen: 0, hullHalfWid: 0, // [px]
  dt: 0,
  target: null,       // ciało celu (dane planety z gry) albo null
  exitAge: -1,        // [s] wiek wyjścia gracza (rampa) — przylot; < 0: skok albo brak
  exitHalt: 0,        // [s] zatrzymanie na rampie wyjścia (warpDrive.js: tHalt)
  targetHold: 0       // WYNIK WarpWorldLens.update: cel trzymany przy krawędzi (0..1) — sterownik trzyma soczewkę,
                      // póki > 0, choć β wyjścia już opadło
};

/** Wyłącza soczewkę (sterownik bez skoku gracza). */
export function resetWarpWorldLens() {
  WARP_WORLD_LENS.active = false;
  WARP_WORLD_LENS.beta = 0;
  WARP_WORLD_LENS.target = null;
  WARP_WORLD_LENS.exitAge = -1;
  WARP_WORLD_LENS.targetHold = 0;
}

/**
 * RING „HALO” W SOCZEWCE (user 2026-10-19: ring ma iść w soczewce razem z planetą — dawniej mijana planeta i cel przy
 * krawędzi leciały bez ringu, a prawdziwy ring przechodził przez kadr osobno, np. przy przelocie obok Marsa). Pisze
 * planet3d.assets.js (DirectPlanet._lensPlace — planety z ringiem), czyta haloRingGame.js: ring = obraz planety
 * przesunięty i przeskalowany wokół jej środka. Klucz = id planety ('earth', 'mars', 'jupiter').
 *   on — planeta w soczewce w tej klatce; x, y — środek obrazu planety (świat gry); k — skala obrazu do prawdziwej
 *   (1 — prawdziwy widok); q — obrót przelotu bryły (THREE.Quaternion, kopia) albo null; real — udział prawdziwego
 *   widoku 1 − β (cień ringu w smugach gaśnie z nim jak tarcza planety); vis — obraz planety w kadrze.
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

/** Nowy rekord ciała soczewki (raz na ciało; `out` wypełnia WarpWorldLens.update). */
export function newLensBody(id) {
  return {
    id: String(id || ''),
    x: 0, y: 0,      // prawdziwy środek (świat)
    r: 1,            // promień rysowanej kuli [j.]
    z: 0,            // głębokość passa (0 — płaszczyzna gry, −50 000 — tło perspektywy)
    flat: 1,         // px/j. prawdziwego widoku (β = 0)
    gate: 1,         // 0..1 — udział soczewki (0: prawdziwy ring tego ciała jest w kadrze)
    gateOpenSession: -1, // skok (WarpWorldLens.session), w którym bramka się otworzyła — potem zostaje otwarta
    parent: null,    // rekord planety (księżyce)
    ready: false,    // rekord odświeżony w tej klatce
    entry: 0,        // wejście w soczewkę w tym skoku: 0 — do oceny, 1 — w soczewce, −1 — czeka (WarpWorldLens)
    entrySession: -1,
    out: { x: 0, y: 0, size: 0, beta: 0, ax: 1, ay: 0, angle: 0, isTarget: false }
  };
}

/**
 * WEJŚCIE CIAŁA W SOCZEWKĘ (user 2026-10-08: „jak odpalam warp obok Ziemi, strona nocna nagle skacze na
 * środek ekranu i mocno świeci”). Przejście β przenosi ciało z prawdziwego miejsca na miejsce w soczewce.
 * W demie statek startował 288 px nad tarczą — prawdziwa i soczewkowa Ziemia leżały przy sobie, więc
 * planeta płynnie odpływała za rufę. W grze statek startuje dziesiątki tysięcy jednostek od planety: jej
 * prawdziwy obraz jest daleko za kadrem, a soczewkowy tuż przy statku — w 0,3 s wlatywała pod statek, a lejek
 * rozciągał ją na pół ekranu. Zasada: ciało, którego prawdziwy obraz jest poza kadrem, a obraz w soczewce
 * w kadrze, wchodzi w soczewkę tylko PRZED DZIOBEM (wlatuje od strony lotu, jak przelot). Za rufą i z boku
 * (planeta startu) czeka na prawdziwym miejscu, aż jego obraz w soczewce wyjdzie z kadru — wtedy przechodzi
 * niewidocznie.
 */
export const WORLD_LENS_ENTRY = Object.freeze({
  aheadCos: 0.5   // cos kąta od kursu: „przed dziobem” (±60°)
});

/**
 * Tarcza (px od środka kadru, y w dół) w kadrze W × H — domyślny test widoczności (bez rulonu). Koło ∩
 * prostokąt (nie prostokąt otaczający: ogromna tarcza po skosie „wchodziła” do kadru samym rogiem pudła).
 */
export function lensDiscInFrame(x, y, r, W, H) {
  const ex = Math.max(0, Math.abs(x) - W * 0.5);
  const ey = Math.max(0, Math.abs(y) - H * 0.5);
  return ex * ex + ey * ey < r * r;
}

/**
 * Widok ciał w klatce (odpowiednik WorldLensView dema): dla każdego rekordu środek na ekranie
 * [px od środka kadru, y w dół], promień [px] i obrót przelotu. Bez alokacji.
 */
export class WarpWorldLens {
  constructor(params = {}) {
    this.params = { ...WORLD_LENS_DEFAULTS, ...params };
    this.lensScale = 0;
    this.session = 0;   // numer skoku — wejście ciał w soczewkę (`entry`) liczy się od nowa w każdym
    const p = this.params;
    this._o = {
      zoom: 1, flatScale: 0, lensScale: 0.001, sizeDepth: p.sizeDepth,
      viewHalfW: 400, viewHalfH: 300, shipSx: 0, shipSy: 0, targetWindow: p.targetWindow,
      sizeK: p.sizeK, sizeD0: p.sizeD0, gapPx: p.edgeGap,
      hullHalfLen: 0, hullHalfWid: 0, hold: 0, holdSize: p.holdSize,
      holdPeek: p.holdPeek, holdSoft: p.holdSoft, beta: 0, velAngle: 0, sizeBoost: 1,
      approach: 0, approachEdge: p.approachEdge, approachLatNear: p.approachLatNear, approachLatFar: p.approachLatFar,
      approachMax: Infinity
    };
    this._map = { x: 0, y: 0, size: 0, d: 0, edge: 0, theta: 0, gap: 0 };
    this._tgt = { x: 0, y: 0, size: 0, d: 0, edge: 0, theta: 0, gap: 0 };
    this._full = { x: 0, y: 0, size: 0, d: 0, edge: 0, theta: 0, gap: 0 };
    this._turn = { ax: 1, ay: 0, angle: 0 };
    // Przylot: prawdziwy odstęp celu w poprzedniej klatce [px], tempo zbliżania [px/s] (wygładzone, z ilu próbek),
    // czas puszczania [s] (< 0 — trzyma).
    this._arr = { prevGap: NaN, closing: 0, samples: 0, releaseT: -1 };
  }

  /** Koniec skoku (soczewka wyłączona): skala od nowa, wejście ciał oceniane od nowa w następnym. */
  reset() {
    this.lensScale = 0;
    this.session++;
    this._arrivalReset();
  }

  _arrivalReset() {
    this._arr.prevGap = NaN;
    this._arr.closing = 0;
    this._arr.samples = 0;
    this._arr.releaseT = -1;
  }

  /**
   * PRZYLOT (user 2026-10-19: „planeta docelowa pokazuje się na chwilę, potem jej nie widać i znowu wskakuje”). β
   * wyjścia opada z czasem rampy, a statek wychodzący z pędem ślizga się jeszcze kilka km — cel jechał na prawdziwe
   * miejsce za krawędzią kadru i wracał, gdy ślizg go przybliżył. Teraz przy wyjściu cel trzyma się obrazu z pełnej
   * soczewki (przy krawędzi, `tg`), póki bliski brzeg jego prawdziwego obrazu jest za krawędzią kadru; gdy wejdzie
   * w kadr — β puszcza cel (miękkie kolano, bez wypadania z kadru), a gdy statek stanie przed tym (tempo zbliżania <
   * arrivalStopPx, albo arrivalHoldMax s po rampie) — puszczenie w arrivalRelease s. Zwraca udział trzymania 0..1.
   */
  _arrivalHold(target, tg, ctx, dt) {
    const A = this._arr;
    const p = this.params;
    const realGap = (tg.d - target.r) * target.flat;
    // Cięcie (teleport, nowa podróż): prawdziwy obraz celu odskoczył w klatce dalej niż o kadr — koniec trzymania
    // od razu (bez puszczania przez kadr).
    if (Number.isFinite(A.prevGap) && realGap - A.prevGap > Math.max(Number(ctx.W) || 0, Number(ctx.H) || 0)) {
      A.releaseT = Infinity;
    }
    if (Number.isFinite(A.prevGap) && dt > 0) {
      const rate = (A.prevGap - realGap) / dt;
      A.closing = A.samples > 0 ? A.closing + (rate - A.closing) * (1 - Math.exp(-dt / 0.2)) : rate;
      A.samples++;
    }
    A.prevGap = realGap;
    // Trzymanie tylko pilnuje KADRU: puszcza, gdy bliski brzeg prawdziwej tarczy jest w kadrze (krawędź − kolano;
    // kadr przylotu kamery — cameraRig.js, arrivalDist — wprowadza go tam w trakcie hamowania), a nie dopiero przy
    // obrazie z soczewki (ten siedzi głębiej — przejście spadało na koniec ślizgu, „planeta rośnie po hamowaniu”).
    const w = Math.max(1, p.arrivalKneePx);
    const x = realGap - Math.max(tg.gap, tg.edge - w);
    const k = 0.5 * (1 + x / Math.sqrt(x * x + w * w));
    const halt = Number(ctx.exitHalt) || 0;
    // „Stoi” dopiero z kilku próbek tempa (pierwsza klatka przylotu nie ma jeszcze z czym porównać).
    const stopped = A.samples >= 6 && A.closing < p.arrivalStopPx;
    if (A.releaseT < 0 && ctx.exitAge > halt && (stopped || ctx.exitAge > halt + p.arrivalHoldMax)) A.releaseT = 0;
    else if (A.releaseT >= 0) A.releaseT += dt;
    const rel = A.releaseT >= 0 ? 1 - smoothstep(0, Math.max(0.05, p.arrivalRelease), A.releaseT) : 1;
    return k * rel;
  }

  // Wejście ciała w soczewkę (WORLD_LENS_ENTRY): `full` — obraz w pełnej soczewce (β = 1).
  _entry(b, dx, dy, full, ctx, visible) {
    if (b.entrySession !== this.session) {
      b.entrySession = this.session;
      b.entry = 0;
    }
    if (b.entry === 1) return 1;
    // Bramka ringu zamknięta (prawdziwy ring w kadrze) — ciało i tak zostaje prawdziwe; decyzja zapada przy
    // otwieraniu bramki (planet3d.assets.js wygładza otwarcie — przejście niesie wtedy bramka).
    if (!(b.gate > 0)) {
      b.entry = 0;
      return 0;
    }
    const lensOn = visible(ctx.shipSx + full.x, ctx.shipSy + full.y, full.size, ctx.W, ctx.H);
    if (!lensOn) {
      // obraz w soczewce poza kadrem — przejście niewidoczne
      b.entry = 1;
      return 1;
    }
    if (b.entry === 0) {
      // Prawdziwy obraz — w płaskim kadrze (rulon ściska daleki świat ku horyzontowi walca: ogromna tarcza
      // za kadrem „mieściłaby się” po rulonie, choć jej nie widać).
      const fl = b.flat;
      const realOn = lensDiscInFrame(ctx.shipSx + dx * fl, ctx.shipSy + dy * fl, b.r * fl, ctx.W, ctx.H);
      // kurs w osiach ekranu (update: velAngle − roll), jak `full.theta`
      const ahead = Math.cos(full.theta - this._o.velAngle) > WORLD_LENS_ENTRY.aheadCos;
      // prawdziwy obraz w kadrze (przejście ciągłe) albo ciało przed dziobem (wlatuje od strony lotu)
      b.entry = realOn || ahead ? 1 : -1;
    }
    return b.entry === 1 ? 1 : 0;
  }

  /**
   * bodies — rekordy newLensBody (gotowe: `ready`), n — ile; ctx — WARP_WORLD_LENS;
   * target — rekord ciała celu albo null; visible(x, y, r, W, H) — tarcza (px od środka kadru, y w dół)
   * w kadrze (gra: z rulonem; domyślnie lensDiscInFrame).
   */
  update(bodies, n, ctx, target = null, visible = lensDiscInFrame) {
    const p = this.params;
    const o = this._o;
    const zoom = Math.max(1e-6, Number(ctx.zoom) || 1);
    const beta = clamp(Number(ctx.beta) || 0, 0, 1);
    const dt = clamp(Number(ctx.dt) || 0, 0, 0.1);
    const goal = warpLensScale(Number(ctx.speed) > 0 ? ctx.speed : p.zoomRefSpeed, Math.min(ctx.W, ctx.H) * 0.5, p, zoom * p.lensScaleMax);
    if (!(this.lensScale > 0) || dt <= 0) this.lensScale = goal;
    else this.lensScale *= Math.pow(goal / this.lensScale, 1 - Math.exp(-dt / Math.max(1e-3, p.lensScaleLag)));
    o.zoom = zoom;
    o.lensScale = this.lensScale;
    o.viewHalfW = ctx.W * 0.5;
    o.viewHalfH = ctx.H * 0.5;
    o.shipSx = ctx.shipSx;
    o.shipSy = ctx.shipSy;
    o.hullHalfLen = Math.max(0, ctx.hullHalfLen || 0);
    o.hullHalfWid = Math.max(0, ctx.hullHalfWid || 0);
    // Obrót kadru (src/3d/viewRoll.js): soczewka liczy w osiach ekranu — przesunięcia ze świata R(−roll),
    // kurs − roll; obrót przelotu (flybyTurn) zostaje w osiach świata (kręci kulą w scenie).
    const roll = Number(ctx.roll) || 0;
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    o.velAngle = (Number(ctx.velAngle) || 0) - roll;
    o.hold = 0;
    o.sizeBoost = 1;
    const vis = typeof visible === 'function' ? visible : lensDiscInFrame;
    const sx0 = ctx.shipX;
    const sy0 = ctx.shipY;
    // Cel: obraz w pełnej soczewce (β = 1, przy krawędzi) — księżyce celu krążą wokół niego w jego skali.
    let tScale = 0;
    let tx0 = 0;
    let ty0 = 0;
    let tBeta = 0;
    let arrHold = 0;
    const tg = this._tgt;
    // Przelot z daleka tylko przed końcem skoku: z celem — do jego bliskiego brzegu wzdłuż kursu; swobodny skok — bez
    // końca (każde ciało przed dziobem może zostać minięte).
    o.approachMax = Infinity;
    if (target && target.ready) {
      const twx = target.x - sx0;
      const twy = target.y - sy0;
      const tdx = rc * twx + rs * twy;
      const tdy = -rs * twx + rc * twy;
      o.approachMax = Math.max(0, tdx * Math.cos(o.velAngle) + tdy * Math.sin(o.velAngle) - target.r);
      o.hold = 1;
      o.beta = 1;
      o.flatScale = target.flat;
      mapWorldLens(tdx, tdy, target.r, o, tg);
      o.hold = 0;
      tScale = tg.size / Math.max(1e-9, target.r);
      tx0 = target.x;
      ty0 = target.y;
      // Przylot: przy wyjściu cel trzymany przy krawędzi niezależnie od β (_arrivalHold); w skoku — zwykłe β.
      if (Number(ctx.exitAge) >= 0) arrHold = this._arrivalHold(target, tg, ctx, dt);
      else this._arrivalReset();
      tBeta = Math.max(beta, arrHold) * clamp(target.gate, 0, 1) * this._entry(target, tdx, tdy, tg, ctx, vis);
    } else this._arrivalReset();
    ctx.targetHold = arrHold;
    const tilt = Math.max(0, p.flybyTilt);
    const hCam = Math.max(1, p.flybyHeight);
    const m = this._map;
    const full = this._full;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b || !b.ready) continue;
      const wdx = b.x - sx0;
      const wdy = b.y - sy0;
      const dx = rc * wdx + rs * wdy;
      const dy = -rs * wdx + rc * wdy;
      const isTarget = b === target;
      const inGroup = !isTarget && tScale > 0 && b.parent === target;
      const fl = b.flat;
      // Cel i jego księżyce — udział celu (β albo trzymanie przy przylocie), reszta — β · bramka · wejście.
      let bb = tBeta;
      if (!inGroup && !isTarget) {
        let e = 1;
        if (b.entrySession !== this.session || b.entry !== 1) {
          o.beta = 1;
          o.flatScale = fl;
          o.approach = 1;
          mapWorldLens(dx, dy, b.r, o, full);
          o.approach = 0;
          e = this._entry(b, dx, dy, full, ctx, vis);
        }
        bb = beta * clamp(b.gate, 0, 1) * e;
      }
      if (inGroup) {
        // Księżyc celu: wokół obrazu celu w jego skali (przesunięcie od celu w osiach ekranu).
        const mwx = b.x - tx0;
        const mwy = b.y - ty0;
        const lx = tg.x + (rc * mwx + rs * mwy) * tScale;
        const ly = tg.y + (-rs * mwx + rc * mwy) * tScale;
        const ls = Math.max(b.r * tScale, 1e-6);
        m.x = dx * fl + (lx - dx * fl) * bb;
        m.y = dy * fl + (ly - dy * fl) * bb;
        m.size = Math.exp(Math.log(Math.max(b.r * fl, 1e-9)) * (1 - bb) + Math.log(ls) * bb);
      } else {
        o.beta = bb;
        o.flatScale = fl;
        o.hold = isTarget ? 1 : 0;
        // mijane ciało przed dziobem — przelot z daleka (perspektywa z punktem zbiegu); cel ma trzymanie przy krawędzi
        o.approach = isTarget ? 0 : 1;
        mapWorldLens(dx, dy, b.r, o, m);
        o.hold = 0;
        o.approach = 0;
      }
      const out = b.out;
      out.x = ctx.shipSx + m.x;
      out.y = ctx.shipSy + m.y;
      out.size = m.size;
      out.beta = bb;
      out.isTarget = isTarget;
      // Obrót przelotu (w soczewce): wirtualna kamera nad statkiem patrzy na ciało pod kątem. Cel i jego księżyce bez
      // obrotu (user 2026-10-19: „przy wejściu planeta docelowa się obraca, a powinna być taka sama, jak mi się
      // pokazała”) — obrót × udział soczewki wracał do zera przy przylocie razem ze światłem (terminator); cel ma tylko
      // ustawienie tarczy (planet3d.assets.js: lensFaceQuat), które przy przylocie zostaje.
      out.ax = 1;
      out.ay = 0;
      out.angle = 0;
      if (tilt > 0 && bb > 0.002 && !isTarget && !inGroup) {
        flybyTurn(wdx, -wdy, hCam, this._turn);
        out.ax = this._turn.ax;
        out.ay = this._turn.ay;
        out.angle = this._turn.angle * tilt * bb;
      }
    }
    return n;
  }
}
