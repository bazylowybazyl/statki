// src/3d/warpWorldLens.js
//
// Widok skoku — „soczewka świata” (docs/BRIEF-warp.md §4.3).
//
// Ciała stoją w PRAWDZIWYCH odległościach (user 2026-09-26: mijana planeta była
// „na siłę przybliżana do gracza, potem oddalana” — ma być jak naprawdę):
// soczewka to zwykły widok z góry w jednej skali S [px na jednostkę świata] dla
// wszystkich ciał — położenie = S · (ciało − statek), promień = S · r. Planeta
// mijana w bok leci w kadrze po prostej, w swojej prawdziwej odległości od kursu,
// a tarcza zakrywa statek tylko wtedy, gdy statek naprawdę nad nią leci.
// Skala idzie za NOMINALNĄ prędkością skoku (warpLensScale): w przelocie stała
// (krótszy bok kadru mieści framingDist w każdym kierunku), w rozpędzie
// i hamowaniu widok się przybliża. Ciało rośnie z perspektywy wzdłuż kursu
// (warpDepthScale: daleko przed dziobem mniejsze, przy mijaniu prawdziwe, za
// rufą znowu mniejsze), a statek zwalnia przy nim (warpFlybySlowdown
// w warpDrive.js, „grawitacja”) — planeta płynnie rośnie, przesuwa się wolniej
// i jest pokazana dłużej, potem maleje i zostaje z tyłu (user: „zwolnij statek,
// planetę powiększ (płynnie), pokaż ją, obracaj ją, pomniejsz, zostaw z tyłu”).
// Skala z faktycznej prędkości przybliżała widok przy zwolnieniu i planeta
// krążyła wokół statku w stałej odległości — znów „na siłę”. Ciało obraca się
// jak widziane z przelatującego statku (flybyTurn: wirtualna kamera nad statkiem
// patrzy na nie z boku, światło obraca się razem z nim). Bez sztucznych
// efektów: bez powiększania „z boku”, zginania tła wokół planety i ściągania
// kierunków ku przodowi.
// Dalekie ciała (słońce, planety po drugiej stronie układu) są w tej skali
// daleko za kadrem — widać tylko to, obok czego lecimy.
// CEL lotu (ctx.target) wisi przy krawędzi przed dziobem: wyłania się, gdy
// wejdzie w kadr, i rośnie (prawo perspektywy r·K/(d + d0) × holdSize), nie
// zbliżając się do statku; jego księżyce trzymają się go w tej samej skali.
// Gdy front wyjścia dochodzi do statku, cel „wjeżdża”: gwałtownie rośnie do
// prawdziwej wielkości pod statkiem (arriveBeta).
// Przejście β: 0 = zwykły widok gry, 1 = pełna soczewka; odstęp liniowo,
// wielkość w logarytmie (płynny „odjazd” kamery).
//
// Ciała są 3D (planet3d.assets.js), więc przestawienie ich pozycji i skali
// jest tanie: moduł NIE zmienia modułu planet — `applyToBodies` nakłada się
// na grupy PO updatePlanets3D (co klatkę i tak ustawia pozycję i skalę od nowa).
// Pass planet (perspektywa, z = −50 000) przelicza się przez głębokość, pass
// ringów (ortho, z = 0) wprost.
//
// Tło (mgławica i PRAWDZIWE gwiazdy gry) zgina pass soczewki w Core3D
// (setWarpViewWorld): bańka Alcubierre'a albo kropla z rybim okiem. Gwiazdy są
// te same co w zwykłym widoku (user: fejkowe gwiazdy tylko na czas skoku
// „osadzały się” przy wyjściu sztucznie): gra rozciąga je w warpie, a tu
// ograniczamy prędkość przesuwu ich wzoru (paralaksa warstwy „speed” 1,35 przy
// 150 tys. j/s to ~500 px na klatkę).
//
// Wyjście: przestrzeń prostuje się FRONTEM od dziobu ku rufie (user: statek
// nie może „spaść” do rzeczywistości — rzeczywistość ma się wyprostować przed
// nim). Front w promieniach kuli wzdłuż osi lotu: przed nim zwykły widok. Tło
// prostuje pass per piksel, ciała — solveSweepBodyBeta na ich obrazie; zasłona,
// gwiazdy i cienie idą za soczewką widoczną w kadrze (screenBeta).
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { warpDropGeometry, warpDropExit } from './warpLens3D.js';

export const WORLD_LENS_DEFAULTS = Object.freeze({
  axisFill: 0.93,       // dłuższy koniec kropli sięga tej części kadru wzdłuż osi lotu
  horizonMax: 0.6,      // promień kuli najwyżej × wysokość ekranu (lot w bok szerokiego kadru)
  // Skala soczewki od NOMINALNEJ prędkości skoku (warpLensScale): w przelocie
  // krótszy bok kadru (od środka) mieści framingDist — w każdym kierunku lotu
  // widać ciała do tej odległości od kursu i od statku; poniżej
  // zoomRefSpeed (rozpęd, hamowanie) widok się przybliża proporcjonalnie,
  // najwyżej do lensScaleMax × zoom kamery; zmiana wygładzona (lensScaleLag, s).
  // Zwolnienie przy mijanym ciele NIE zmienia skali — planeta leci po prostej.
  framingDist: 90000,
  zoomRefSpeed: 150000,
  lensScaleMax: 0.5,
  lensScaleLag: 0.15,
  // Perspektywa wzdłuż kursu: ciało w odległości a przed dziobem albo za rufą
  // ma wielkość × h/√(a² + h²) — przy mijaniu (a = 0) prawdziwą, daleko mniejszą:
  // rośnie płynnie, gdy statek się zbliża, i maleje, gdy zostaje z tyłu.
  sizeDepth: 30000,
  // Obrót mijanego ciała: wirtualna kamera na tej wysokości nad statkiem
  // (jednostki świata) — planeta 100 tys. j. przed dziobem jest widziana pod 45°;
  // flybyTilt 0 wyłącza obrót.
  flybyHeight: 100000,
  flybyTilt: 1,
  // Cel lotu przy krawędzi przed dziobem: wyłania się, gdy jest bliżej niż
  // targetWindow (od powierzchni), wielkość r·K/(d + d0) × holdSize (wjazd na
  // końcu tym gwałtowniejszy, im mniejszy), widoczna część średnicy, miękkość
  // zatrzymania [px], odstęp tarczy od kadłuba [px].
  targetWindow: 450000,
  sizeK: 600,
  sizeD0: 30000,
  holdSize: 0.5,
  holdPeek: 0.5,
  holdSoft: 40,
  edgeGap: 24,
  sunBoost: 5,          // słońce w widoku skoku (w grze ma tylko ~2,4 tys. j.)
  veil: 0.1             // lekkie przygaszenie tła przy β = 1
});

export const WARP_VIEW_DEFAULTS = Object.freeze({
  // Kształt zgięcia tła: 'alcubierre' — bańka z płatem ściśniętej przestrzeni
  // przed statkiem i rozszerzonej za nim, przewężenie po bokach (user
  // 2026-09-26: „klepsydra”, wizualizacja NASA); 'drop' — kropla z rybim okiem.
  shape: 'alcubierre',
  // Bańka (promienie kuli, warpAlcubierreHeight): środek płatów na osi lotu,
  // ich półszerokość w poprzek, płaskość wnętrza przy statku, siła załamania
  // tła (bez fałd: ≤ ~0,065); barwa płatów i relief. Siatki czasoprzestrzeni
  // nie ma (user 2026-09-26: „wywalamy tę siatkę”).
  alcPeak: 0.6,
  alcWidth: 0.42,
  alcFlat: 2.5,
  alcAmp: 0.05,
  tintGain: 0.12,
  shadeGain: 1.0,
  // Kropla w promieniach kuli: czoło bańki i czubek ogona od statku, promień
  // bańki i ogona (user: „zamiast koła kropla”).
  dropFront: 1.05,
  dropBack: 0.95,
  dropBulb: 0.8,
  dropTail: 0.07,
  coverAt: 0.88,        // przy β = 0 rogi kadru leżą na tej części promienia kropli
  flowSpeed: 2.2,       // opływ: promienie kuli na sekundę przy pełnej prędkości
  flowTravel: 1.2,      // droga przepływu na fazę flow mapy (promienie kuli)
  flowBlur: 0.4,        // długość smugi opływu (promienie kuli) przy pełnej prędkości
  flowGain: 0.9,        // jasność tła w opływie
  fisheye: 1.0,         // siła rybiego oka tła w kuli
  starSpeedCap: 14000,  // maks. prędkość przesuwu wzoru gwiazd gry (j/s kamery)
  starBright: 1.25,     // jasność gwiazd gry w widoku skoku (gra sama ściąga je do 0,4)
  starSize: 1.35,       // mnożnik wielkości gwiazd gry w widoku skoku
  starStretch: 1.5,     // mnożnik rozciągnięcia gwiazd gry w widoku skoku (pełna prędkość)
  starStretchSlow: 0.35, // … przy zatrzymaniu (smugi krótsze, gdy statek zwalnia)
  starWhipCut: 0.8,     // przygaszenie „bicza” gwiazd gry przy wyjściu (wyjście robi front)
  starChargeStretch: 1.0,  // ładowanie skoku: rozciągnięcie gwiazd gry na końcu (1 = skok)
  starChargeBright: 1.3,   // … i ich jasność (gra sama by je przygasiła)
  frontBand: 0.6,       // półszerokość pasa frontu wyjścia (promienie kuli)
  arriveBand: 0.35,     // wjazd celu: zaczyna się, gdy front jest 2× tyle przed statkiem, kończy przy statku
  bodyBetaRate: 2.5,    // maks. zmiana β ciała na sekundę (przeskok obraz → prawdziwe miejsce)
  bodyBetaK: 5,         // wygładzenie β ciała [1/s] — przeskok z wyhamowaniem, bez szarpnięcia
  // Punkt tarczy spotykający front: −1 = najbliższy statkowi, 0 = środek,
  // 1 = krawędź od dziobu.
  bodyFrontEdge: -1
});

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const wrapPi = (a) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Siła soczewki w punkcie przy froncie wyjścia — lustro shadera (uWVFront).
 * s = położenie wzdłuż osi lotu (promienie kuli, + przed statkiem); przed
 * frontem (s > front) zwykły widok.
 */
export function sweepBeta(beta, s, front, band) {
  const b = Math.max(0.01, Number(band) || 0.35);
  return clamp(Number(beta) || 0, 0, 1) * (1 - smoothstep(front - b, front + b, s));
}

const _sweepF = (sOf, B, front, band, b) => sweepBeta(B, sOf(b), front, band) - b;

/**
 * Soczewka CIAŁA przy froncie wyjścia. Tło prostuje się tam, gdzie je WIDAĆ
 * (piksel w shaderze), więc ciało też: β ciała to punkt stały
 *   b = sweepBeta(β, s(b)),  s(b) = położenie ciała na ekranie przy soczewce b.
 * Liczone z prawdziwego położenia ciało za rufą nigdy nie łapało frontu
 * (siedziało w kuli do końca i znikało skokiem), a ciało przed dziobem
 * wyskakiwało z kuli już na starcie frontu. Z punktu stałego ciało za rufą
 * jedzie na pasie frontu za kadr, a ciało przed dziobem prostuje się, gdy front
 * dojdzie do jego obrazu. Rozwiązań bywa kilka (obraz w kuli i prawdziwe miejsce
 * naraz) — bierzemy stabilne najbliższe `prev` (ciągłość w czasie). sOf(b) — s
 * przy soczewce b (promienie kuli wzdłuż osi lotu).
 */
export function solveSweepBodyBeta(sOf, beta, front, band, prev, steps = 16) {
  const B = clamp(Number(beta) || 0, 0, 1);
  if (B <= 0) return 0;
  const p = Number.isFinite(prev) ? prev : B;
  let best = -1;
  let bestDist = Infinity;
  let b0 = 0;
  let f0 = _sweepF(sOf, B, front, band, 0);
  for (let i = 1; i <= steps; i++) {
    const b1 = (B * i) / steps;
    const f1 = _sweepF(sOf, B, front, band, b1);
    // Zero w b = 0 (ciało już w prostej przestrzeni) — stabilne, gdy dalej f < 0.
    if (i === 1 && f0 <= 1e-9 && f1 <= 0) {
      best = 0;
      bestDist = Math.abs(p);
    }
    // Stabilne zero: f maleje przez zero (b dąży do niego z obu stron).
    if (f0 > 0 && f1 <= 0) {
      let lo = b0;
      let hi = b1;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) * 0.5;
        if (_sweepF(sOf, B, front, band, mid) > 0) lo = mid; else hi = mid;
      }
      const root = (lo + hi) * 0.5;
      const dist = Math.abs(root - p);
      if (dist < bestDist) {
        best = root;
        bestDist = dist;
      }
    }
    b0 = b1;
    f0 = f1;
  }
  return best < 0 ? B : best;
}

/**
 * Odległość od statku do krawędzi kadru wzdłuż kierunku (ux, uy) na ekranie [px]
 * (|u| = 1, y w dół). hw, hh — połowy kadru, (sx, sy) — statek względem środka kadru.
 */
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

/**
 * Soczewka CELU przy wyjściu: cel wisi przy krawędzi kadru do ostatniej chwili
 * i „wjeżdża”, gdy front wyjścia dochodzi do statku (user: „w ostatniej chwili
 * wyjścia … wjechać gwałtownym powiększeniem”) — β spada do 0 w pasie 2·band
 * przed statkiem i kończy się, gdy front go mija. Bez frontu (1000) zwykłe β.
 */
export function arriveBeta(beta, front, band) {
  const b = Math.max(0.01, Number(band) || 0.35);
  const f = Number.isFinite(front) ? front : 1000;
  return clamp(Number(beta) || 0, 0, 1) * smoothstep(0, 2 * b, f);
}

/**
 * Skala soczewki [px na jednostkę świata] od NOMINALNEJ prędkości skoku (bez
 * zwolnień przy mijanych ciałach): w przelocie edgePx (połowa krótszego boku
 * kadru) mieści framingDist — skala stała, więc mijana planeta leci po prostej
 * w swojej prawdziwej odległości od kursu. Poniżej
 * zoomRefSpeed (rozpęd, hamowanie) widok się przybliża proporcjonalnie do
 * prędkości; najwyżej maxScale.
 */
export function warpLensScale(speed, edgePx, p = WORLD_LENS_DEFAULTS, maxScale = Infinity) {
  const vr = Math.max(1, Number(p.zoomRefSpeed) || WORLD_LENS_DEFAULTS.zoomRefSpeed);
  const v = Math.max(1, Math.abs(Number(speed) || 0));
  const D = Math.max(1, Number(p.framingDist) || WORLD_LENS_DEFAULTS.framingDist) * Math.min(1, v / vr);
  const s = Math.max(1, Number(edgePx) || 1) / D;
  return Math.min(s, maxScale > 0 ? maxScale : Infinity);
}

/** Perspektywa wzdłuż kursu: mnożnik wielkości ciała a przed dziobem / za rufą. */
export function warpDepthScale(along, depth) {
  const h = Math.max(1, Number(depth) || 1);
  const a = Number(along) || 0;
  return h / Math.sqrt(a * a + h * h);
}

/**
 * Obrót ciała przy przelocie (user: „obracaj ją — efekt przelatywania obok”):
 * wirtualna kamera nad statkiem na wysokości h widzi ciało z ukosa, więc
 * obracamy je tak, żeby do ekranu była zwrócona strona widziana ze statku.
 * (ox, oy) — ciało względem statku w układzie three (x w prawo, y w górę,
 * jednostki świata). Wynik: oś obrotu (ax, ay, 0) i kąt — obrót o ten kąt
 * przenosi kierunek (−ox, −oy, h) na oś z (kamera). Przelot bokiem obraca
 * powierzchnię w stronę ruchu ciała w kadrze, jak widok z okna.
 */
export function flybyTurn(ox, oy, h, out = { ax: 1, ay: 0, angle: 0 }) {
  const hor = Math.hypot(ox, oy);
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
 * Odwzorowanie ciała względem statku → przesunięcie środka na ekranie [px],
 * promień [px] i odstęp krawędzi od statku (gap, px; ujemny = tarcza pod statkiem).
 * (dx, dy) — ciało minus statek w świecie gry (y w dół), r — promień w świecie.
 * o: { zoom, flatScale, beta, velAngle, lensScale (S — px na jednostkę świata
 *      w soczewce), sizeDepth (perspektywa wzdłuż kursu), sizeBoost, hold (1 =
 *      cel lotu: wisi przy krawędzi przed dziobem) i dla celu: viewHalfW,
 *      viewHalfH (połowy kadru, px), shipSx, shipSy (statek względem środka
 *      kadru, px), targetWindow, sizeK, sizeD0, holdSize, holdPeek, holdSoft,
 *      gapPx, hullHalfLen, hullHalfWid (kadłub w px) }
 * flatScale — px na jednostkę świata w ZWYKŁYM widoku tego ciała: zoom dla passu
 * ortho, zoom·Z/(Z − z) dla ciała w passie perspektywicznym na głębokości z
 * (planety leżą 50 tys. j. pod płaszczyzną gry — bez tego β → 0 skakałoby).
 * out.edge — krawędź kadru w kierunku celu [px] (0 dla zwykłego ciała).
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
  const P = WORLD_LENS_DEFAULTS;
  const d = Math.hypot(dx, dy);
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
  // Prawdziwa geometria w skali soczewki: środek tarczy w S·(dx, dy), promień
  // S·r pomniejszony perspektywą wzdłuż kursu (przy mijaniu prawdziwy) —
  // tarcza nigdy nie jest bliżej statku niż naprawdę.
  const S = Math.max(1e-12, Number(o.lensScale) || 0);
  const along = d * Math.cos(theta - va);
  let lensSize = rr * S * (Number(o.sizeBoost) || 1) * warpDepthScale(along, Number(o.sizeDepth) || P.sizeDepth);
  let lensGap = S * d - lensSize;
  // Cel lotu: nie podjeżdża do statku — wyłania się przy krawędzi kadru, gdy
  // jest bliżej niż targetWindow, krawędź tarczy zatrzymuje się tuż za krawędzią
  // kadru (widać holdPeek średnicy), a tarcza rośnie z odległością (prawo
  // perspektywy). Miękkie maksimum: wyłania się bez szarpnięcia.
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
  // Odstęp liniowo (tarcza pod statkiem — gap < 0), wielkość w logarytmie;
  // kierunek zawsze prawdziwy.
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
  return out;
}

/**
 * Promień kuli przy β = 1 [px]: dłuższy koniec kropli sięga axisFill krawędzi
 * kadru wzdłuż osi lotu (statek na środku kadru), nie więcej niż horizonMax·H.
 */
export function warpHorizonPx(W, H, velAngle, params = WORLD_LENS_DEFAULTS, view = WARP_VIEW_DEFAULTS) {
  const c = Math.abs(Math.cos(velAngle));
  const s = Math.abs(Math.sin(velAngle));
  const ext = Math.min(c > 1e-6 ? (W * 0.5) / c : Infinity, s > 1e-6 ? (H * 0.5) / s : Infinity);
  const reach = Math.max(view.dropFront, view.dropBack, 0.1);
  return Math.max(1, Math.min((params.axisFill * ext) / reach, params.horizonMax * H));
}

/**
 * Prędkość opływu wokół kuli (przepływ potencjalny wokół walca), w jednostkach
 * prędkości ośrodka — lustro CPU pola z shadera opływu (warpLens3D.js).
 */
export function flowAroundBall(px, py, R, fx, fy, out = { x: 0, y: 0 }) {
  const a = (px * fx + py * fy) / R;
  const b = (px * -fy + py * fx) / R;
  const q2 = Math.max(a * a + b * b, 1);
  const q4 = q2 * q2;
  const u = -1 + (a * a - b * b) / q4;
  const v = (2 * a * b) / q4;
  out.x = fx * u - fy * v;
  out.y = fy * u + fx * v;
  return out;
}

const _map = {};
const _mapS = {};
const _tgt = {};
const _pose = { x: 0, y: 0, z: 0, r: 0, flat: 0, ortho: false, scaled: null };
const _tgtWorld = { x: 0, y: 0 };
const _turn = { ax: 1, ay: 0, angle: 0 };
const _axis = new THREE.Vector3();
const _sunV = new THREE.Vector3();
const _drop = { ua: 0, ra: 1, ub: 0, rb: 1 };
const _mapOpts = {
  zoom: 1, flatScale: 0, lensScale: 0.001, sizeDepth: WORLD_LENS_DEFAULTS.sizeDepth,
  viewHalfW: 400, viewHalfH: 300, shipSx: 0, shipSy: 0, targetWindow: WORLD_LENS_DEFAULTS.targetWindow,
  sizeK: WORLD_LENS_DEFAULTS.sizeK, sizeD0: WORLD_LENS_DEFAULTS.sizeD0,
  gapPx: WORLD_LENS_DEFAULTS.edgeGap, hullHalfLen: 0, hullHalfWid: 0,
  hold: 0, holdSize: WORLD_LENS_DEFAULTS.holdSize, holdPeek: WORLD_LENS_DEFAULTS.holdPeek, holdSoft: WORLD_LENS_DEFAULTS.holdSoft,
  beta: 0, velAngle: 0, sizeBoost: 1
};

// Prawdziwe położenie (świat gry, y w dół), promień i skala zwykłego widoku
// ciała z planet3d.assets.js — ustawione przed chwilą przez jego update.
function bodyPose(ent, zoom, f, targetZ, bodyZoom, out) {
  const group = ent?.group;
  if (!group) return false;
  const scaled = (ent.sunLight || ent.parentData) ? ent.mesh : group;
  if (!scaled) return false;
  const r = scaled.scale.x;
  if (!(r > 0)) return false;
  const z = group.position.z;
  // Zwykły widok ciała: ortho (ring) albo perspektywa na głębokości z,
  // oddalony wokół statku o bodyZoom.
  const ortho = !!ent.isRingAnchored || z >= 0;
  out.x = group.position.x;
  out.y = -group.position.y;
  out.z = z;
  out.r = r;
  out.ortho = ortho;
  out.scaled = scaled;
  out.flat = (ortho ? zoom : f / (targetZ - z)) * bodyZoom;
  return true;
}

// Bez obrotu przelotu: grupa ciała i płaska poświata limbu planet przy ringu.
function resetTurn(ent) {
  if (!ent?.group) return;
  ent.group.quaternion.identity();
  if (ent.isRingAnchored && ent.atmosphere) ent.atmosphere.quaternion.identity();
}

// Bieżące ciało dla solveSweepBodyBeta (bez domknięć na klatkę). Punkt tarczy,
// który spotyka front, wybiera edge (view.bodyFrontEdge): −1 = najbliższy
// statkowi — ciało przed dziobem prostuje się dopiero, gdy front dojdzie do
// jego brzegu od strony statku, a ciało za rufą jedzie na froncie za kadr.
const _body = { dx: 0, dy: 0, r: 0, fx: 1, fy: 0, R: 1, edge: -1 };
const _bodyS = (b) => {
  _mapOpts.beta = b;
  mapWorldLens(_body.dx, _body.dy, _body.r, _mapOpts, _mapS);
  const sc = (_mapS.x * _body.fx + _mapS.y * _body.fy) / _body.R;
  const sz = _mapS.size / _body.R;
  if (_body.edge < 0) return Math.sign(sc) * Math.max(Math.abs(sc) + sz * _body.edge, 0);
  return sc + sz * _body.edge;
};
// Przekątne kadru od statku: kropla ma je objąć przy β = 0.
const _corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const _alc = { rPeak: 0.6, rWidth: 0.42, flat: 2.5, amp: 0.05, tintGain: 0.12, shadeGain: 1.0 };

export const WarpWorldLens = {
  params: { ...WORLD_LENS_DEFAULTS },
  view: { ...WARP_VIEW_DEFAULTS },
  beta: 0,
  screenBeta: 0,        // najsilniejsza soczewka w kadrze (front wyjścia za kadrem → 0)
  ballRadiusPx: 0,
  lensScale: 0,         // S soczewki ciał [px na jednostkę świata]
  flowPhase: 0,
  veil: null,
  _stars: null,
  // Ostatnie odwzorowanie ciał (etykiety w HUD): { name, x, y (px od środka
  // ekranu), size (px), d (j.), isSun, isMoon, isTarget, beta }.
  bodies: [],

  ensure() {
    if (this.veil) return true;
    if (!Core3D.isInitialized || !Core3D.scene) return false;
    const veilMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veilMat);
    veil.frustumCulled = false;
    veil.renderOrder = 0;
    veil.visible = false;
    veil.name = 'WARP_VEIL';
    Core3D.scene.add(veil);
    Core3D.enableBackground3D(veil);
    this.veil = veil;
    return true;
  },

  // Gwiazdy gry (StarSystem z planet3d.assets.js) — rozpoznawane po uniformach.
  // Core3D renderuje je w widoku skoku osobno od mgławicy (bez lustrzanego
  // odbicia w rybim oku kropli — tam leciały w drugą stronę).
  _findGameStars() {
    if (this._stars && this._stars.parent) return this._stars;
    this._stars = null;
    Core3D.scene?.traverse((o) => {
      if (!this._stars && o.isPoints && o.material?.uniforms?.stretchStrength && o.material.uniforms.cameraOffset) this._stars = o;
    });
    Core3D.setWarpStarsObject?.(this._stars);
    return this._stars;
  },

  /**
   * Gwiazdy gry w widoku skoku. Wzór przesuwa się z paralaksą (warstwa „speed”
   * 1,35× kamery) — przy prędkości warpa to szum, więc zgłaszamy StarSystemowi
   * limit prędkości kamery gwiazd na następną klatkę (userData.starSpeedCap;
   * sam go zeruje, gdy nikt go nie odnowi). Wołać PO updatePlanets3D. Gwiazdy
   * dalej rysuje i rozciąga gra — płasko, wzdłuż lotu, ogonem do tyłu.
   */
  _capStarParallax(cam, dt, beta, speedFrac = 1, charge = 0, velAngle = 0) {
    const stars = this._findGameStars();
    if (!stars) return;
    const u = stars.material.uniforms;
    // Ładowanie skoku (user: „rozciągnięcie gwiazd jak w Star Wars”, potem:
    // „powinny się rozciągać w 2D w stronę przeciwną do lotu”, nie zbiegać się
    // w tunel 3D): gwiazdy gry wydłużają się wzdłuż kursu, jaśnieją i bieleją.
    // Sama gra w stanie 'charging' tylko je przygasza i ledwie rozciąga.
    const ch = clamp(Number(charge) || 0, 0, 1);
    if (ch > 0 && u.warpFactor) {
      u.warpFactor.value = Math.max(u.warpFactor.value, this.view.starChargeStretch * Math.pow(ch, 1.3));
      u.globalBrightness.value += (this.view.starChargeBright - u.globalBrightness.value) * ch;
      if (u.moveDir) u.moveDir.value.set(Math.cos(velAngle), -Math.sin(velAngle));
    }
    stars.userData.starSpeedCap = this.view.starSpeedCap;
    // Te same gwiazdy, w skoku wyraźniejsze: gra ściąga je do 0,4 i rozciąga ×20.
    if (!stars.userData.warpBase) {
      stars.userData.warpBase = { size: u.baseSizeMul.value, stretch: u.stretchStrength.value };
    }
    const wb = stars.userData.warpBase;
    const v = this.view;
    u.baseSizeMul.value = wb.size * (1 + (v.starSize - 1) * beta);
    // Smugi krótsze, gdy statek zwalnia (mijanie planety, hamowanie).
    const stretch = v.starStretchSlow + (v.starStretch - v.starStretchSlow) * clamp(speedFrac, 0, 1);
    u.stretchStrength.value = wb.stretch * (1 + (stretch - 1) * beta);
    if (beta > 0.002) u.globalBrightness.value += (v.starBright - u.globalBrightness.value) * beta;
    // Gra przy warp → idle strzela „biczem” (0,34 s rozciągnięcia i błysku
    // całego nieba). Tu wyjście robi front — bicz tylko jako lekkie drgnięcie
    // (inaczej jedna jasna gwiazda ciągnęła smugę przez pół kadru).
    if (u.exitWhipFactor) u.exitWhipFactor.value *= 1 - v.starWhipCut * beta;
  },

  /** Promień kuli przy β = 1 dla kadru W×H i kierunku lotu (ta sama liczba co w update). */
  horizonFor(W, H, velAngle) {
    return warpHorizonPx(W, H, velAngle, this.params, this.view);
  },

  /**
   * Co klatkę PO updatePlanets3D i PRZED Core3D.render.
   * ctx: { ship: {x, y}, velAngle, speed (j/s — NOMINALNA prędkość skoku, bez
   *        zwolnień przy mijanych ciałach: skala soczewki ciał),
   *        speedFrac (0..1 — smugi gwiazd), beta, cam: {x, y, zoom},
   *        width, height, dt, bodies (window._entities),
   *        front (promienie kuli, domyślnie daleko przed statkiem),
   *        hullHalfLen, hullHalfWid (kadłub statku w px — cel trzyma odstęp),
   *        bodyBeta (soczewka ciał; domyślnie beta), bodyZoom (zwykły widok ciał
   *        skalowany wokół statku — rozpęd przed skokiem: planeta startu stoi przy
   *        krawędzi kadru i maleje, zamiast uciekać z kadru; domyślnie 1),
   *        charge (0..1 — ładowanie skoku: gwiazdy gry się rozciągają wzdłuż lotu),
   *        target (encja celu lotu z window._entities: wisi przy krawędzi kadru
   *        z księżycami i wjeżdża w ostatniej chwili wyjścia; bez — brak celu) }
   */
  update(ctx) {
    if (!this.ensure()) return;
    const beta = clamp(Number(ctx.beta) || 0, 0, 1);
    const bodyBeta = Number.isFinite(ctx.bodyBeta) ? clamp(ctx.bodyBeta, 0, 1) : beta;
    const bodyZoom = Number(ctx.bodyZoom) > 0 ? Math.min(Number(ctx.bodyZoom), 4) : 1;
    this.beta = beta;
    const cam = ctx.cam;
    const zoom = Math.max(1e-6, Number(cam.zoom) || 1);
    const W = Math.max(1, Number(ctx.width) || 1);
    const H = Math.max(1, Number(ctx.height) || 1);
    const dt = clamp(Number(ctx.dt) || 0, 0, 0.1);
    const p = this.params;
    const v = this.view;
    const speedFrac = clamp(Number(ctx.speedFrac) || 0, 0, 1);
    const front = Number.isFinite(ctx.front) ? ctx.front : 1000;
    const velAngle = Number(ctx.velAngle) || 0;
    const horizonPx = warpHorizonPx(W, H, velAngle, p, v);
    warpDropGeometry(v.dropFront, v.dropBack, v.dropBulb, v.dropTail, _drop);
    const shipSx = (ctx.ship.x - cam.x) * zoom;
    const shipSy = (ctx.ship.y - cam.y) * zoom;
    const vfx = Math.cos(velAngle);
    const vfy = Math.sin(velAngle);
    // Skala soczewki od nominalnej prędkości skoku, wygładzona w logarytmie
    // (zmiana biegu nie szarpie planetami); bez upływu czasu (pauza,
    // przewijanie) — od razu.
    const speed = Number.isFinite(ctx.speed) ? ctx.speed : p.zoomRefSpeed;
    const lensTarget = warpLensScale(speed, Math.min(W, H) * 0.5, p, zoom * p.lensScaleMax);
    if (!(this.lensScale > 0) || dt <= 0) this.lensScale = lensTarget;
    else this.lensScale *= Math.pow(lensTarget / this.lensScale, 1 - Math.exp(-dt / Math.max(1e-3, p.lensScaleLag)));
    _mapOpts.zoom = zoom;
    _mapOpts.lensScale = this.lensScale;
    _mapOpts.sizeDepth = p.sizeDepth;
    _mapOpts.targetWindow = p.targetWindow;
    _mapOpts.viewHalfW = W * 0.5;
    _mapOpts.viewHalfH = H * 0.5;
    _mapOpts.shipSx = shipSx;
    _mapOpts.shipSy = shipSy;
    _mapOpts.sizeK = p.sizeK;
    _mapOpts.sizeD0 = p.sizeD0;
    _mapOpts.gapPx = p.edgeGap;
    _mapOpts.holdSize = p.holdSize;
    _mapOpts.holdPeek = p.holdPeek;
    _mapOpts.holdSoft = p.holdSoft;
    _mapOpts.hold = 0;
    _mapOpts.hullHalfLen = Math.max(0, Number(ctx.hullHalfLen) || 0);
    _mapOpts.hullHalfWid = Math.max(0, Number(ctx.hullHalfWid) || 0);
    _mapOpts.velAngle = velAngle;
    this.horizonPx = horizonPx;

    // Kropla: przy β = 0 obejmuje cały kadr (zwykły widok — rogi kadru na
    // coverAt jej promienia), przy β = 1 ma promień kuli horizonPx — świat
    // „zwija się” do niej. Przy wyjściu zostaje — prostuje ją front.
    let coverR = horizonPx;
    for (let i = 0; i < 4; i++) {
      const cx = _corner[i][0] * W * 0.5 - shipSx;
      const cy = _corner[i][1] * H * 0.5 - shipSy;
      const cl = Math.hypot(cx, cy);
      if (cl < 1e-6) continue;
      const cu = (cx * vfx + cy * vfy) / cl;
      const cv = (cy * vfx - cx * vfy) / cl;
      coverR = Math.max(coverR, cl / (v.coverAt * warpDropExit(cu, cv, _drop)));
    }
    this.ballRadiusPx = horizonPx * Math.exp((1 - beta) * Math.log(coverR / horizonPx));

    // Najsilniejsza soczewka W KADRZE — w rogu ekranu najdalej za rufą. Gdy
    // front zejdzie za kadr, nic w nim nie jest już zgięte: zasłona, gwiazdy
    // i cienie wracają razem z frontem, a nie skokiem na końcu sekwencji.
    const sRear = (-(Math.abs(vfx) * W + Math.abs(vfy) * H) * 0.5 - (shipSx * vfx + shipSy * vfy)) / Math.max(1, this.ballRadiusPx);
    const screenBeta = sweepBeta(beta, sRear, front, v.frontBand);
    this.screenBeta = screenBeta;

    this._capStarParallax(cam, dt, screenBeta, speedFrac, ctx.charge, velAngle);
    // Faza opływu kropli CAŁKOWANA (prędkość zmienna w czasie — nie czas × prędkość).
    this.flowPhase = (this.flowPhase + dt * (v.flowSpeed * speedFrac) / Math.max(0.05, v.flowTravel)) % 1;
    if (beta > 0.002) {
      _alc.rPeak = v.alcPeak; _alc.rWidth = v.alcWidth; _alc.flat = v.alcFlat; _alc.amp = v.alcAmp;
      _alc.tintGain = v.tintGain; _alc.shadeGain = v.shadeGain;
      Core3D.setWarpViewWorld?.(ctx.ship.x, ctx.ship.y, this.ballRadiusPx, beta, velAngle, {
        phase: this.flowPhase,
        travel: v.flowTravel,
        blur: 0.04 + v.flowBlur * speedFrac,
        gain: v.flowGain,
        fisheye: v.fisheye,
        front,
        band: v.frontBand,
        drop: _drop,
        mode: v.shape,
        alc: _alc
      });
    } else {
      Core3D.clearWarpView?.();
    }

    const veil = this.veil;
    veil.visible = screenBeta > 0.002;
    if (veil.visible) {
      veil.material.opacity = p.veil * screenBeta;
      veil.position.set(cam.x, -cam.y, -100);
      veil.scale.set((W / zoom) * 1.4, (H / zoom) * 1.4, 1);
    }
    // Cienie shadow shafts liczą się z PRAWDZIWEGO słońca i pozycji (tarcze
    // planet z updatePlanets3D, sylwetka kadłuba) — w soczewce (i w oddalonym
    // widoku ciał) padałyby klinem na przestawione planety. Wygaszone, póki
    // w kadrze jest soczewka.
    const zoomOff = Math.abs(1 - bodyZoom);
    const shaftCut = Math.max(smoothstep(0, 0.35, screenBeta), smoothstep(0, 0.2, zoomOff));
    if (shaftCut > 0.002) {
      if ((screenBeta > 0.1 || zoomOff > 0.05) && typeof Core3D.beginShaftDiscFrame === 'function') Core3D.beginShaftDiscFrame();
      if (typeof Core3D.suppressShadowShafts === 'function') Core3D.suppressShadowShafts(shaftCut);
    }
    this.applyToBodies(ctx.bodies, ctx, bodyBeta, shipSx, shipSy, zoom, H, front, dt, bodyZoom);
  },

  /**
   * Nakłada soczewkę na ciała z planet3d.assets.js (window._entities) —
   * PO updatePlanets3D, które co klatkę ustawia ich prawdziwą pozycję i skalę.
   * Przy wyjściu ciało prostuje się, gdy front minie jego OBRAZ; ciała za rufą
   * jadą na pasie frontu za kadr. Cel lotu (ctx.target) i jego księżyce wiszą
   * przy krawędzi kadru i wjeżdżają razem, gdy front dochodzi do statku.
   */
  applyToBodies(bodies, ctx, beta, shipSx, shipSy, zoom, H, front = 1000, dt = 0, bodyZoom = 1) {
    this.bodies.length = 0;
    if (!Array.isArray(bodies) || (beta <= 0.002 && Math.abs(bodyZoom - 1) < 1e-4)) {
      this._bodyBeta = null;
      if (this._turned && Array.isArray(bodies)) for (const ent of bodies) resetTurn(ent);
      this._turned = false;
      return;
    }
    // β ciał przy froncie pamięta poprzednią klatkę (wybór rozwiązania).
    if (!this._bodyBeta) this._bodyBeta = new WeakMap();
    if (!this._bodyPool) this._bodyPool = [];
    const sweeping = front < 999;
    const maxStep = this.view.bodyBetaRate * dt;
    const follow = 1 - Math.exp(-this.view.bodyBetaK * dt);
    const cam = ctx.cam;
    const persp = Core3D.cameraPersp;
    const fovRad = THREE.MathUtils.degToRad((persp?.fov || 35) * 0.5);
    const f = (Math.max(1, Core3D.height || H) * 0.5) / Math.tan(fovRad);
    const targetZ = f / zoom;
    const sun = (typeof window !== 'undefined') ? window.SUN : null;
    const R = Math.max(1, this.ballRadiusPx);
    const fx = Math.cos(_mapOpts.velAngle);
    const fy = Math.sin(_mapOpts.velAngle);
    const tilt = Math.max(0, Number(this.params.flybyTilt) || 0);
    const hCam = Math.max(1, Number(this.params.flybyHeight) || 1);
    // Cel lotu: obraz przy krawędzi kadru (β = 1) liczony raz — jego księżyce
    // stoją wokół niego w tej samej skali (tScale, px obrazu na jednostkę
    // świata), a nie lecą do statku osobno. β celu idzie za frontem wyjścia.
    const target = ctx.target && ctx.target.group ? ctx.target : null;
    const tData = target ? (target.data || null) : null;
    const tBeta = sweeping ? arriveBeta(beta, front, this.view.arriveBand) : beta;
    let tScale = 0;
    if (target && bodyPose(target, zoom, f, targetZ, bodyZoom, _pose)) {
      _mapOpts.hold = 1;
      _mapOpts.beta = 1;
      _mapOpts.flatScale = _pose.flat;
      _mapOpts.sizeBoost = 1;
      mapWorldLens(_pose.x - ctx.ship.x, _pose.y - ctx.ship.y, _pose.r, _mapOpts, _tgt);
      _mapOpts.hold = 0;
      tScale = _tgt.size / _pose.r;
      _tgtWorld.x = _pose.x;
      _tgtWorld.y = _pose.y;
    }
    let n = 0;
    for (const ent of bodies) {
      if (!bodyPose(ent, zoom, f, targetZ, bodyZoom, _pose)) continue;
      const group = ent.group;
      const scaled = _pose.scaled;
      const isSun = !!ent.sunLight;
      const isMoon = !!ent.parentData;
      const tx = _pose.x;
      const ty = _pose.y;
      const z = _pose.z;
      const r = _pose.r;
      const ortho = _pose.ortho;
      _mapOpts.sizeBoost = isSun ? this.params.sunBoost : 1;
      _mapOpts.flatScale = _pose.flat;
      const dx = tx - ctx.ship.x;
      const dy = ty - ctx.ship.y;
      const isTarget = ent === target;
      const inGroup = !isTarget && tScale > 0 && tData !== null && ent.parentData === tData;
      // Front wyjścia prostuje ciało tam, gdzie je widać (solveSweepBodyBeta);
      // przeskok między rozwiązaniami rozłożony w czasie (bodyBetaRate).
      let bb = beta;
      if (isTarget || inGroup) {
        bb = tBeta;
      } else if (sweeping) {
        _body.dx = dx; _body.dy = dy; _body.r = r;
        _body.fx = fx; _body.fy = fy; _body.R = R; _body.edge = this.view.bodyFrontEdge;
        const prev = this._bodyBeta.get(ent);
        const sol = solveSweepBodyBeta(_bodyS, beta, front, this.view.frontBand, prev);
        bb = prev === undefined ? sol : prev + clamp((sol - prev) * follow, -maxStep, maxStep);
      }
      this._bodyBeta.set(ent, bb);
      _mapOpts.beta = bb;
      if (inGroup) {
        // Księżyc celu: obraz wokół obrazu celu w jego skali, przejście liniowo
        // (położenie) i w logarytmie (wielkość) jak u reszty ciał.
        const fl = _pose.flat;
        const lx = _tgt.x + (tx - _tgtWorld.x) * tScale;
        const ly = _tgt.y + (ty - _tgtWorld.y) * tScale;
        const ls = r * tScale;
        _map.x = dx * fl + (lx - dx * fl) * bb;
        _map.y = dy * fl + (ly - dy * fl) * bb;
        _map.size = Math.exp(Math.log(r * fl) * (1 - bb) + Math.log(Math.max(ls, 1e-6)) * bb);
        _map.d = Math.hypot(dx, dy);
      } else {
        _mapOpts.hold = isTarget ? 1 : 0;
        mapWorldLens(dx, dy, r, _mapOpts, _map);
        _mapOpts.hold = 0;
      }
      // Pixel na ekranie (od środka kadru) → świat na głębokości ciała.
      const sxPx = shipSx + _map.x;
      const syPx = shipSy + _map.y;
      const depthK = ortho ? 1 / zoom : (targetZ - z) / f;
      const nx = cam.x + sxPx * depthK;
      const ny = cam.y + syPx * depthK;
      const k = (_map.size * depthK) / r;
      group.position.set(nx, -ny, z);
      scaled.scale.multiplyScalar(k);
      if (isSun && ent.glow) ent.glow.scale.multiplyScalar(k);
      if (isMoon && ent.halo) ent.halo.scale.multiplyScalar(k);
      group.visible = true;
      // Przelot: ciało zwrócone do ekranu stroną widzianą ze statku (wirtualna
      // kamera nad statkiem), w soczewce — w zwykłym widoku bez obrotu. Planety
      // przy ringu mają płaską poświatę limbu — ta zostaje płaska.
      let turned = false;
      if (tilt > 0 && bb > 0.002) {
        flybyTurn(dx, -dy, hCam, _turn);
        const ang = _turn.angle * tilt * bb;
        if (ang > 1e-4) {
          _axis.set(_turn.ax, _turn.ay, 0);
          group.quaternion.setFromAxisAngle(_axis, ang);
          if (ent.isRingAnchored && ent.atmosphere) ent.atmosphere.quaternion.copy(group.quaternion).invert();
          turned = true;
          this._turned = true;
        }
      }
      if (!turned) resetTurn(ent);
      // Światło z prawdziwego kierunku słońca (przesunięte razem z ciałem
      // i obrócone razem z nim — przy przelocie przesuwa się też terminator).
      const u = ent.uniforms;
      if (sun) {
        _sunV.set(sun.x - tx, -(sun.y - ty), 0);
        if (turned) _sunV.applyQuaternion(group.quaternion);
        if (u?.sunPosition) {
          u.sunPosition.value.set(nx + _sunV.x, -ny + _sunV.y, z + _sunV.z);
          if (ent.cloudUniforms?.sunPosition) ent.cloudUniforms.sunPosition.value.copy(u.sunPosition.value);
          const atmU = ent.atmosphere?.material?.uniforms;
          if (atmU?.sunPosition) atmU.sunPosition.value.copy(u.sunPosition.value);
          if (atmU?.uSunDir) atmU.uSunDir.value.copy(_sunV).normalize();
        }
        const haloU = isMoon ? ent.halo?.material?.uniforms : null;
        if (haloU?.sunPosition) haloU.sunPosition.value.set(nx + _sunV.x, -ny + _sunV.y, z + _sunV.z);
      }
      // Pas cienia ringu liczony w prawdziwej skali — w soczewce wygaszony.
      if (u?.uRingShadowStrength) u.uRingShadowStrength.value *= (1 - bb);
      if (typeof Core3D.markPlanetLayersActive === 'function') {
        Core3D.markPlanetLayersActive(!!ent.isRingAnchored, !isSun);
      }
      // Ostatnie odwzorowanie (etykiety w HUD) — obiekty z puli, bez alokacji na klatkę.
      const rec = this._bodyPool[n] || (this._bodyPool[n] = { name: '', x: 0, y: 0, size: 0, d: 0, isSun: false, isMoon: false, isTarget: false, beta: 0 });
      n++;
      rec.name = ent.name || ent.data?.name || ent.tune?.id || (isSun ? 'słońce' : (isMoon ? 'moon' : ''));
      rec.x = sxPx;
      rec.y = syPx;
      rec.size = _map.size;
      rec.d = _map.d;
      rec.isSun = isSun;
      rec.isMoon = isMoon;
      rec.isTarget = isTarget;
      rec.beta = bb;
      this.bodies.push(rec);
    }
    _mapOpts.sizeBoost = 1;
    _mapOpts.flatScale = 0;
  }
};
