// src/3d/warpWorldLens.js
//
// Widok skoku — „soczewka świata” (docs/BRIEF-warp.md §4.3).
//
// W widoku z góry planeta mijana przez statek NIE zmienia wielkości — tylko
// się przesuwa. Żeby Ziemia malała za rufą, a Mars rósł z oddali, był prawie
// pełny przy mijaniu i znowu malał, położenie i wielkość ciał liczymy
// z ODLEGŁOŚCI od statku. Świat mieści się w KROPLI wokół statku (bańka
// z przodu, ogon za rufą — warpDropGeometry): nieskończoność ląduje na jej
// brzegu B(kierunek). Ciało ustawia KRAWĘDŹ BLIŻSZA STATKOWI:
//   odstęp od statku g(d) = m + (B − m) · dₛ / (dₛ + L),  dₛ = d − r (do powierzchni),
//   wielkość         s(d) = r · K / (d + d0) · mijanie   — prawo perspektywy,
//   środek tarczy w g + s, kierunek jak w świecie, ściągnięty ku lotowi (aberracja).
// m = kadłub statku + odstęp, więc ciało NIGDY nie wjeżdża pod statek przed
// wyjściem (user: „spadasz na Jowisza, bo przesuwasz go pod statek”): Ziemię przy
// starcie trzyma krawędź kadru, cel stoi przed dziobem. Przed dziobem L jest
// krótka — cel wisi wysoko, aż statek do niego podejdzie; z boku ciało rośnie
// mocniej (mijanie, user: „bardziej je pokazać”).
// Przejście β: 0 = zwykły widok gry, 1 = pełna soczewka; odstęp liniowo,
// wielkość w logarytmie (płynny „odjazd” kamery).
//
// Ciała są 3D (planet3d.assets.js), więc przestawienie ich pozycji i skali
// jest tanie: moduł NIE zmienia modułu planet — `applyToBodies` nakłada się
// na grupy PO updatePlanets3D (co klatkę i tak ustawia pozycję i skalę od nowa).
// Pass planet (perspektywa, z = −50 000) przelicza się przez głębokość, pass
// ringów (ortho, z = 0) wprost.
//
// Tło (mgławica i PRAWDZIWE gwiazdy gry) zwija się razem ze światem w kulę
// wokół statku: pass soczewki w Core3D (setWarpViewWorld) — w kuli rybie oko,
// na zewnątrz opływ. Gwiazdy są te same co w zwykłym widoku (user: fejkowe
// gwiazdy tylko na czas skoku „osadzały się” przy wyjściu sztucznie): gra
// rozciąga je w warpie, a tu ograniczamy prędkość przesuwu ich wzoru
// (paralaksa warstwy „speed” 1,35 przy 150 tys. j/s to ~500 px na klatkę).
//
// Wyjście: przestrzeń prostuje się FRONTEM od dziobu ku rufie (user: statek
// nie może „spaść” do rzeczywistości — rzeczywistość ma się wyprostować przed
// nim). Front w promieniach kuli wzdłuż osi lotu: przed nim zwykły widok. Tło
// prostuje pass per piksel, ciała — solveSweepBodyBeta na ich obrazie; zasłona,
// gwiazdy i cienie idą za soczewką widoczną w kadrze (screenBeta).
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { warpDropGeometry, warpDropExit, WARP_SPACE_TYPE } from './warpLens3D.js';

export const WORLD_LENS_DEFAULTS = Object.freeze({
  axisFill: 0.93,       // dłuższy koniec kropli sięga tej części kadru wzdłuż osi lotu
  horizonMax: 0.6,      // promień kuli najwyżej × wysokość ekranu (lot w bok szerokiego kadru)
  lengthScale: 220000,  // L z boku: w tej odległości od powierzchni ciało jest w pół drogi do brzegu
  lengthFront: 45000,   // L przed dziobem — cel wisi wysoko aż do podejścia
  lengthBack: 90000,    // L za rufą — planeta startu po kopnięciu zostaje przy krawędzi kadru
  frontCone: 4,         // szerokość stożków L przodu i tyłu (cos^k kąta od osi lotu)
  sizeK: 600,           // s(d) = r·K/(d + d0) [px]
  sizeD0: 30000,
  passBoost: 1.1,       // mijanie: ciało z boku rośnie do (1 + passBoost)× …
  passScale: 150000,    // … gdy jest bliżej niż ta odległość
  edgeGap: 24,          // odstęp tarczy od kadłuba statku [px]
  aberration: 0.55,     // siła ściągania kierunków ku przodowi przy pełnej prędkości
  sunBoost: 5,          // słońce w widoku skoku (w grze ma tylko ~2,4 tys. j.)
  veil: 0.1             // lekkie przygaszenie tła przy β = 1
});

export const WARP_VIEW_DEFAULTS = Object.freeze({
  // Kropla w promieniach kuli: czoło bańki i czubek ogona od statku, promień
  // bańki i ogona (user: „zamiast koła kropla” — cel mieści się wyżej).
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
  gravityLens: 0.3,     // mijane ciało zgina tło wokół siebie (połknięcie POINT) — „grawitacja”
  frontBand: 0.6,       // półszerokość pasa frontu wyjścia (promienie kuli)
  bodyBetaRate: 2.5,    // maks. zmiana β ciała na sekundę (przeskok obraz → prawdziwe miejsce)
  bodyBetaK: 5,         // wygładzenie β ciała [1/s] — przeskok z wyhamowaniem, bez szarpnięcia
  // Punkt tarczy spotykający front: −1 = najbliższy statkowi (cel „wjeżdża” na
  // samym końcu), 0 = środek, 1 = krawędź od dziobu.
  bodyFrontEdge: -1
});

const CIRCLE_DROP = Object.freeze({ ua: 0, ra: 1, ub: 0, rb: 1 });

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

/** Aberracja: kąt względem kierunku ruchu ściągnięty ku przodowi (0 = przód). */
export function aberrateAngle(alpha, b) {
  const k = clamp(Number(b) || 0, 0, 0.95);
  if (k <= 0) return alpha;
  const c = Math.cos(alpha);
  const cp = (c + k) / (1 + k * c);
  const a = Math.acos(clamp(cp, -1, 1));
  return alpha < 0 ? -a : a;
}

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
 * (siedziało w kuli do końca i znikało skokiem), a cel przed dziobem
 * wyskakiwał z kuli już na starcie frontu. Z punktu stałego ciało za rufą
 * jedzie na pasie frontu za kadr, a cel prostuje się, gdy front dojdzie do
 * jego obrazu. Rozwiązań bywa kilka (obraz w kuli i prawdziwe miejsce naraz) —
 * bierzemy stabilne najbliższe `prev` (ciągłość w czasie). sOf(b) — s przy
 * soczewce b (promienie kuli wzdłuż osi lotu).
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
 * Odwzorowanie ciała względem statku → przesunięcie środka na ekranie [px],
 * promień [px] i odstęp krawędzi od statku (gap, px; ujemny = tarcza pod statkiem).
 * (dx, dy) — ciało minus statek w świecie gry (y w dół), r — promień w świecie.
 * o: { zoom, flatScale, beta, velAngle, aberration, horizonPx (promień kuli
 *      przy β = 1), drop (warpDropGeometry; bez — koło), lengthScale,
 *      lengthFront, lengthBack, frontCone, sizeK, sizeD0, sizeBoost, passBoost,
 *      passScale, gapPx, hullHalfLen, hullHalfWid (kadłub statku w px) }
 * flatScale — px na jednostkę świata w ZWYKŁYM widoku tego ciała: zoom dla passu
 * ortho, zoom·Z/(Z − z) dla ciała w passie perspektywicznym na głębokości z
 * (planety leżą 50 tys. j. pod płaszczyzną gry — bez tego β → 0 skakałoby).
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
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
  out.pass = 1;
  if (beta <= 0) {
    out.x = dx * flat;
    out.y = dy * flat;
    out.size = flatSize;
    out.theta = theta;
    out.gap = flatGap;
    return out;
  }
  const alpha = wrapPi(theta - va);
  const alphaL = aberrateAngle(alpha, Number(o.aberration) || 0);
  const cu = Math.cos(alphaL);
  const cv = Math.sin(alphaL);
  // Brzeg kropli w kierunku ciała i margines: kadłub statku (prostokąt) + odstęp.
  const edgePx = warpDropExit(cu, cv, o.drop || CIRCLE_DROP) * Math.max(0, Number(o.horizonPx) || 0);
  const margin = Math.max(0, Number(o.gapPx) || 0)
    + Math.abs(cu) * Math.max(0, Number(o.hullHalfLen) || 0)
    + Math.abs(cv) * Math.max(0, Number(o.hullHalfWid) || 0);
  // Skala długości: osobna w stożku przed dziobem i za rufą.
  const Ls = Math.max(1, Number(o.lengthScale) || WORLD_LENS_DEFAULTS.lengthScale);
  const Lf = Math.max(1, Number(o.lengthFront) || Ls);
  const Lb = Math.max(1, Number(o.lengthBack) || Ls);
  const cone = Math.pow(Math.abs(cu), Math.max(0.5, Number(o.frontCone) || 4));
  const L = Ls + ((cu > 0 ? Lf : Lb) - Ls) * cone;
  const ds = Math.max(0, d - rr);
  let lensGap = margin + Math.max(0, edgePx - margin) * ds / (ds + L);
  // Wielkość: prawo perspektywy × mijanie (sin² kąta od osi lotu, maleje z odległością).
  const K = Number(o.sizeK) || WORLD_LENS_DEFAULTS.sizeK;
  const d0 = Math.max(1, Number(o.sizeD0) || WORLD_LENS_DEFAULTS.sizeD0);
  const sa = Math.sin(alpha);
  const pS = Math.max(1, Number(o.passScale) || WORLD_LENS_DEFAULTS.passScale);
  const pass = 1 + Math.max(0, Number(o.passBoost) || 0) * sa * sa * pS / (d + pS);
  const lensSize = rr * K / (d + d0) * (Number(o.sizeBoost) || 1) * pass;
  // Za rufą planeta, która zmieści się w ogonie kropli, jest w nim CAŁA
  // (user: po kopnięciu „dopiero pokażesz ją całą”); duża stoi przy krawędzi.
  // Przed dziobem odwrotnie: cel wystaje za krawędź i rośnie, aż „wjedzie”.
  if (cu < 0 && lensSize > 0) {
    const room = Math.max(1e-6, edgePx - margin);
    const fit = cone * smoothstep(1, 0.55, (2 * lensSize) / room);
    const inside = Math.max(margin, edgePx - 2 * lensSize);
    if (fit > 0 && lensGap > inside) lensGap += (inside - lensGap) * fit;
  }
  // Odstęp liniowo (zwykły widok może mieć tarczę pod statkiem — gap < 0),
  // wielkość w logarytmie.
  const gap = flatGap + (lensGap - flatGap) * beta;
  const size = (flatSize > 1e-9 && lensSize > 1e-9)
    ? Math.exp(Math.log(flatSize) * (1 - beta) + Math.log(lensSize) * beta)
    : flatSize * (1 - beta) + lensSize * beta;
  const th = theta + wrapPi(va + alphaL - theta) * beta;
  const rho = Math.max(0, gap + size);
  out.x = Math.cos(th) * rho;
  out.y = Math.sin(th) * rho;
  out.size = size;
  out.theta = th;
  out.gap = gap;
  out.pass = 1 + (pass - 1) * beta;
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
const _drop = { ua: 0, ra: 1, ub: 0, rb: 1 };
const _mapOpts = {
  zoom: 1, flatScale: 0, horizonPx: 400, drop: _drop,
  lengthScale: WORLD_LENS_DEFAULTS.lengthScale, lengthFront: WORLD_LENS_DEFAULTS.lengthFront,
  lengthBack: WORLD_LENS_DEFAULTS.lengthBack, frontCone: WORLD_LENS_DEFAULTS.frontCone, sizeK: WORLD_LENS_DEFAULTS.sizeK, sizeD0: WORLD_LENS_DEFAULTS.sizeD0,
  passBoost: WORLD_LENS_DEFAULTS.passBoost, passScale: WORLD_LENS_DEFAULTS.passScale,
  gapPx: WORLD_LENS_DEFAULTS.edgeGap, hullHalfLen: 0, hullHalfWid: 0,
  beta: 0, velAngle: 0, aberration: 0, sizeBoost: 1
};
// Bieżące ciało dla solveSweepBodyBeta (bez domknięć na klatkę). Punkt tarczy,
// który spotyka front, wybiera edge (view.bodyFrontEdge): −1 = najbliższy
// statkowi — cel wiszący przed dziobem prostuje się dopiero, gdy front dojdzie
// pod dziób („wjeżdża” na końcu), a ciało za rufą jedzie na froncie za kadr.
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

export const WarpWorldLens = {
  params: { ...WORLD_LENS_DEFAULTS },
  view: { ...WARP_VIEW_DEFAULTS },
  beta: 0,
  screenBeta: 0,        // najsilniejsza soczewka w kadrze (front wyjścia za kadrem → 0)
  ballRadiusPx: 0,
  flowPhase: 0,
  veil: null,
  _stars: null,
  _starCam: null,
  // Ostatnie odwzorowanie ciał (etykiety w HUD): { name, x, y (px od środka
  // ekranu), size (px), d (j.) }.
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
  _findGameStars() {
    if (this._stars && this._stars.parent) return this._stars;
    this._stars = null;
    Core3D.scene?.traverse((o) => {
      if (!this._stars && o.isPoints && o.material?.uniforms?.stretchStrength && o.material.uniforms.cameraOffset) this._stars = o;
    });
    return this._stars;
  },

  /**
   * Wzór gwiazd gry przesuwa się z paralaksą (warstwa „speed” 1,35× kamery).
   * Przy prędkości warpa to szum — kamera gwiazd goni prawdziwą z ograniczoną
   * prędkością. Wołać PO updatePlanets3D (StarSystem ustawia cameraOffset od
   * prawdziwej kamery). Gwiazdy dalej rysuje i rozciąga gra.
   */
  _capStarParallax(cam, dt, beta, speedFrac = 1) {
    const stars = this._findGameStars();
    if (!stars) return;
    const u = stars.material.uniforms;
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
    let c = this._starCam;
    if (!c) c = this._starCam = { x: cam.x, y: cam.y, lx: cam.x, ly: cam.y };
    const dx = cam.x - c.lx;
    const dy = cam.y - c.ly;
    c.lx = cam.x;
    c.ly = cam.y;
    const dist = Math.hypot(dx, dy);
    const maxStep = this.view.starSpeedCap * dt;
    const k = dist > maxStep && dist > 0 ? maxStep / dist : 1;
    c.x += dx * k;
    c.y += dy * k;
    u.cameraOffset.value.set(c.x, -c.y);
  },

  /** Promień kuli przy β = 1 dla kadru W×H i kierunku lotu (ta sama liczba co w update). */
  horizonFor(W, H, velAngle) {
    return warpHorizonPx(W, H, velAngle, this.params, this.view);
  },

  /**
   * Co klatkę PO updatePlanets3D i PRZED Core3D.render.
   * ctx: { ship: {x, y}, velAngle, speedFrac (0..1), beta, cam: {x, y, zoom},
   *        width, height, dt, bodies (window._entities),
   *        front (promienie kuli, domyślnie daleko przed statkiem),
   *        hullHalfLen, hullHalfWid (kadłub statku w px — ciała trzymają odstęp),
   *        bodyBeta (soczewka ciał; domyślnie beta), bodyZoom (zwykły widok ciał
   *        oddalony wokół statku — rozpęd przed skokiem: planeta startu stoi przy
   *        krawędzi kadru i maleje, zamiast uciekać z kadru; domyślnie 1) }
   */
  update(ctx) {
    if (!this.ensure()) return;
    const beta = clamp(Number(ctx.beta) || 0, 0, 1);
    const bodyBeta = Number.isFinite(ctx.bodyBeta) ? clamp(ctx.bodyBeta, 0, 1) : beta;
    const bodyZoom = Number(ctx.bodyZoom) > 0 ? Math.min(Number(ctx.bodyZoom), 1) : 1;
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
    _mapOpts.zoom = zoom;
    _mapOpts.horizonPx = horizonPx;
    _mapOpts.lengthScale = p.lengthScale;
    _mapOpts.lengthFront = p.lengthFront;
    _mapOpts.lengthBack = p.lengthBack;
    _mapOpts.frontCone = p.frontCone;
    _mapOpts.sizeK = p.sizeK;
    _mapOpts.sizeD0 = p.sizeD0;
    _mapOpts.passBoost = p.passBoost;
    _mapOpts.passScale = p.passScale;
    _mapOpts.gapPx = p.edgeGap;
    _mapOpts.hullHalfLen = Math.max(0, Number(ctx.hullHalfLen) || 0);
    _mapOpts.hullHalfWid = Math.max(0, Number(ctx.hullHalfWid) || 0);
    _mapOpts.velAngle = velAngle;
    _mapOpts.aberration = p.aberration * speedFrac * beta;
    this.horizonPx = horizonPx;
    const shipSx = (ctx.ship.x - cam.x) * zoom;
    const shipSy = (ctx.ship.y - cam.y) * zoom;
    const vfx = Math.cos(velAngle);
    const vfy = Math.sin(velAngle);

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

    this._capStarParallax(cam, dt, screenBeta, speedFrac);
    // Faza przepływu CAŁKOWANA (prędkość zmienna w czasie — nie czas × prędkość).
    this.flowPhase = (this.flowPhase + dt * (v.flowSpeed * speedFrac) / Math.max(0.05, v.flowTravel)) % 1;
    if (beta > 0.002) {
      Core3D.setWarpViewWorld?.(ctx.ship.x, ctx.ship.y, this.ballRadiusPx, beta, velAngle, {
        phase: this.flowPhase,
        travel: v.flowTravel,
        blur: 0.04 + v.flowBlur * speedFrac,
        gain: v.flowGain,
        fisheye: v.fisheye,
        front,
        band: v.frontBand,
        drop: _drop
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
    const shaftCut = Math.max(smoothstep(0, 0.35, screenBeta), smoothstep(0, 0.2, 1 - bodyZoom));
    if (shaftCut > 0.002) {
      if ((screenBeta > 0.1 || bodyZoom < 0.95) && typeof Core3D.beginShaftDiscFrame === 'function') Core3D.beginShaftDiscFrame();
      if (typeof Core3D.suppressShadowShafts === 'function') Core3D.suppressShadowShafts(shaftCut);
    }
    this.applyToBodies(ctx.bodies, ctx, bodyBeta, shipSx, shipSy, zoom, H, front, dt, bodyZoom);
  },

  /**
   * Nakłada soczewkę na ciała z planet3d.assets.js (window._entities) —
   * PO updatePlanets3D, które co klatkę ustawia ich prawdziwą pozycję i skalę.
   * Przy wyjściu ciało prostuje się, gdy front minie jego OBRAZ; ciała za rufą
   * jadą na pasie frontu za kadr.
   */
  applyToBodies(bodies, ctx, beta, shipSx, shipSy, zoom, H, front = 1000, dt = 0, bodyZoom = 1) {
    this.bodies.length = 0;
    if (!Array.isArray(bodies) || (beta <= 0.002 && bodyZoom >= 0.9999)) {
      this._bodyBeta = null;
      return;
    }
    // β ciał przy froncie pamięta poprzednią klatkę (wybór rozwiązania).
    if (!this._bodyBeta) this._bodyBeta = new WeakMap();
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
    for (const ent of bodies) {
      const group = ent?.group;
      if (!group) continue;
      const isSun = !!ent.sunLight;
      const isMoon = !!ent.parentData;
      const scaled = (isSun || isMoon) ? ent.mesh : group;
      if (!scaled) continue;
      // Prawdziwe położenie i promień (ustawione przed chwilą przez update ciała).
      const tx = group.position.x;
      const ty = -group.position.y;
      const z = group.position.z;
      const r = scaled.scale.x;
      if (!(r > 0)) continue;
      _mapOpts.sizeBoost = isSun ? this.params.sunBoost : 1;
      // Zwykły widok ciała: ortho (ring) albo perspektywa na głębokości z,
      // oddalony wokół statku o bodyZoom.
      const ortho = ent.isRingAnchored || z >= 0;
      _mapOpts.flatScale = (ortho ? zoom : f / (targetZ - z)) * bodyZoom;
      const dx = tx - ctx.ship.x;
      const dy = ty - ctx.ship.y;
      // Front wyjścia prostuje ciało tam, gdzie je widać (solveSweepBodyBeta);
      // przeskok między rozwiązaniami rozłożony w czasie (bodyBetaRate).
      let bb = beta;
      if (sweeping) {
        _body.dx = dx; _body.dy = dy; _body.r = r;
        _body.fx = fx; _body.fy = fy; _body.R = R; _body.edge = this.view.bodyFrontEdge;
        const prev = this._bodyBeta.get(ent);
        const target = solveSweepBodyBeta(_bodyS, beta, front, this.view.frontBand, prev);
        bb = prev === undefined ? target : prev + clamp((target - prev) * follow, -maxStep, maxStep);
      }
      this._bodyBeta.set(ent, bb);
      _mapOpts.beta = bb;
      mapWorldLens(dx, dy, r, _mapOpts, _map);
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
      // Światło z prawdziwego kierunku słońca (przesunięte razem z ciałem).
      const u = ent.uniforms;
      if (u?.sunPosition && sun) {
        u.sunPosition.value.set(nx + (sun.x - tx), -(ny + (sun.y - ty)), z);
        if (ent.cloudUniforms?.sunPosition) ent.cloudUniforms.sunPosition.value.copy(u.sunPosition.value);
        if (ent.atmosphere?.material?.uniforms?.sunPosition) ent.atmosphere.material.uniforms.sunPosition.value.copy(u.sunPosition.value);
      }
      // Pas cienia ringu liczony w prawdziwej skali — w soczewce wygaszony.
      if (u?.uRingShadowStrength) u.uRingShadowStrength.value *= (1 - _mapOpts.beta);
      if (typeof Core3D.markPlanetLayersActive === 'function') {
        Core3D.markPlanetLayersActive(!!ent.isRingAnchored, !isSun);
      }
      // Mijana planeta zgina tło wokół siebie („grawitacja nas przyciąga”):
      // połknięcie POINT w passie soczewki, w miejscu jej obrazu na ekranie.
      const pull = (_map.pass - 1) / Math.max(1e-3, this.params.passBoost);
      if (!isSun && pull > 0.15 && this.view.gravityLens > 0 && typeof Core3D.pushWarpSpaceWorld === 'function') {
        const lensR = (_map.size * 2.2) / zoom;
        Core3D.pushWarpSpaceWorld(WARP_SPACE_TYPE.POINT, cam.x + sxPx / zoom, cam.y + syPx / zoom, 0, lensR, lensR,
          this.view.gravityLens * smoothstep(0.15, 0.6, pull));
      }
      this.bodies.push({
        name: ent.name || ent.data?.name || (isSun ? 'słońce' : ''),
        x: sxPx, y: syPx, size: _map.size, d: _map.d, isSun, isMoon, beta: _mapOpts.beta, pass: _map.pass
      });
    }
    _mapOpts.sizeBoost = 1;
    _mapOpts.flatScale = 0;
  }
};
