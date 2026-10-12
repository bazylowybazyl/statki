// Reżyser kadru kamery statku (2026-10-11): kamera wie, gdzie jest bitwa.
//
// Zgłoszenie użytkownika: „kamera nie pokazuje dobrze pola bitwy i jest nie tam, gdzie powinna — piraci warpują
// w prawy dół, a kamera trzyma się lewego górnego”. Pomiar (.tmp/kamera, fala 1 odwetu, misja 2): domyślny kadr
// 9 × 5 km, piraci przylatują 11 km od Atlasa i stoją ~9,5 km od niego — przez całą falę 0 z 13 wrogów w kadrze.
// Rig (cameraRig.js) zna tylko kursor i prędkość statku, nie wie nic o wrogach ani przylotach.
//
// Reżyser liczy co klatkę (czysto — bez gry, DOM i three):
//  - PUNKTY KADRU: wrogowie istotni dla gracza (gra wybiera ich ~4 Hz: widoczni, nie uśpieni, w zasięgu walki —
//    index.html, blok „KAMERA STATKU”), z wagą (wielkość, zagrożenie, cel priorytetowy) i flagą „musi być w kadrze”;
//    do tego SYGNAŁY — zapowiedziane przyloty wroga (nić zwiastuna warpa) i inne punkty uwagi z czasem życia.
//  - ZOOM: najmniejsze oddalenie, przy którym statek (z promieniem kadłuba) i punkty „musi” mieszczą się w BEZPIECZNYM
//    PROSTOKĄCIE kadru: bez pasów zasłoniętych przez HUD (`insets` w px — gra mierzy panel celu misji u góry i kopułę
//    radaru u dołu) i z odstępem `edgePad` pół kadru (dokładnie: minimalna połowa kadru na oś — wzór przy axisFit).
//    Środek statku pilnuje dodatkowo rig (frameMargin). Wynik to człon log(zoom)
//    ≤ 0 względem zoomu gracza (cameraZoom.js: camera.zoom = zoomBase · e^człon) — kamera najwyżej się ODDALA, do
//    `minZoomFactor` zoomu gracza i nie dalej, niż kadłub ma `minShipFrac` szerokości kadru. Oddala się szybko,
//    przybliża powoli i dopiero po `zoomInHold` s (bez „pompowania”, gdy ginie pojedynczy wróg).
//  - ŚRODEK: przesunięcie kadru względem statku w j. świata — `bias` drogi do środka ciężkości wag, przycięte do
//    przedziału, w którym wszystko się mieści; sprężyna krytyczna. Rig dodaje je do swojego offsetu (px) i pilnuje
//    kadru statku jak dotąd.
//  - KÓŁKO GRACZA ma pierwszeństwo: przybliżenie kółkiem, gdy reżyser oddala, zmniejsza jego władzę nad zoomem
//    (`authority`), która wraca w `authorityRecover` s albo od razu przy nowym przylocie wroga. Oddalenie kółkiem
//    działa samo (zoom gracza poniżej potrzeby — reżyser nic nie dokłada).
//  - KURSOR: przy aktywnym reżyserze zaglądanie za kursorem słabnie (`lookDamp`) — kursor i reżyser nie kłócą się
//    o kadr; rig dostaje `lookScale`.
// Wyłączenia: `suspend` (przejście kamery, tryb inny niż statek) zeruje stan od razu — przejście startuje z zoomu na
// ekranie; `enabled = false` (warp, ujęcie fabuły, stery fregaty, opcja) wygasza kadr płynnie.

export const CAMERA_DIRECTOR_DEFAULTS = Object.freeze({
  bias: 0.5,              // ułamek drogi statek → środek ciężkości punktów
  leanMax: 0.3,           // bez punktów „musi” i sygnałów (tylko dalecy wrogowie, drony): wychylenie kadru najwyżej
                          // tyle pół kadru — kamera nie ucieka od statku ku czemuś, czego i tak nie pokaże
  biasOmega: 2.4,         // 1/s — sprężyna środka kadru (95% po ~2 s)
  edgePad: 0.06,          // odstęp punktów (z promieniem) od brzegu bezpiecznego prostokąta, ułamek pół kadru
  minZoomFactor: 0.3,     // najdalej × to zoomu gracza
  minShipFrac: 0.06,      // kadłub nie mniejszy niż taki ułamek szerokości kadru
  zoomOutOmega: 2.2,      // 1/s — oddalanie (95% po ~2,2 s)
  zoomInOmega: 0.7,       // 1/s — przybliżanie (95% po ~6,7 s)
  zoomInHold: 2.5,        // s potrzeby mniejszej od bieżącego oddalenia, zanim kadr się zwęzi
  zoomInDeadband: 0.06,   // log(zoom) — mniejsze różnice nie przybliżają
  enterTime: 0.6,         // s narastania kadru bitwy
  exitTime: 2.2,          // s wygaszania (bez punktów, wyłączenie)
  fastExitTime: 0.4,      // s wygaszania przy `fast` (warp — kop warpa ma własny zoom)
  lingerSec: 3,           // s trzymania kadru po zniknięciu ostatniego punktu
  cueLife: 4,             // s życia sygnału po ostatnim odświeżeniu
  wheelDrop: 0.35,        // ubytek władzy nad zoomem na ząbek kółka (×1,22) przybliżenia
  authorityRecover: 12,   // s powrotu pełnej władzy
  authorityOmega: 6,      // 1/s — władza zmienia się płynnie (zoom bez skoku)
  lookDamp: 0.5           // zaglądanie za kursorem × (1 − lookDamp · obecność kadru)
});

export const CAMERA_DIRECTOR_RANGES = Object.freeze({
  bias: [0, 1],
  leanMax: [0, 1],
  biasOmega: [0.3, 12],
  edgePad: [0, 0.45],
  minZoomFactor: [0.1, 1],
  minShipFrac: [0.01, 0.3],
  zoomOutOmega: [0.2, 12],
  zoomInOmega: [0.1, 12],
  zoomInHold: [0, 10],
  zoomInDeadband: [0, 0.5],
  enterTime: [0.05, 5],
  exitTime: [0.05, 8],
  fastExitTime: [0.05, 3],
  lingerSec: [0, 15],
  cueLife: [0.2, 20],
  wheelDrop: [0, 1],
  authorityRecover: [0.5, 60],
  authorityOmega: [0.5, 30],
  lookDamp: [0, 1]
});

// Opcja „Kadr bitwy” (menu → Sterowanie, localStorage sc_camera_frame): 'full' — środek i zoom, 'pan' — sam środek
// (zoom tylko z kółka), 'off' — kamera jak przed 2026-10-11.
export const CAMERA_FRAME_MODES = Object.freeze(['full', 'pan', 'off']);

export function normalizeCameraFrameMode(mode) {
  return CAMERA_FRAME_MODES.includes(mode) ? mode : 'full';
}

// Najwięcej punktów (wrogów) i sygnałów w kadrze naraz.
export const CAMERA_DIRECTOR_MAX_POINTS = 32;
export const CAMERA_DIRECTOR_MAX_CUES = 32;
// Flagi punktu.
export const CAM_POINT_MUST = 1;

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function finite(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function createCameraDirectorTune(overrides = null) {
  const tune = { ...CAMERA_DIRECTOR_DEFAULTS };
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(CAMERA_DIRECTOR_DEFAULTS)) {
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
      const [min, max] = CAMERA_DIRECTOR_RANGES[key];
      tune[key] = clamp(finite(overrides[key], CAMERA_DIRECTOR_DEFAULTS[key]), min, max);
    }
  }
  return tune;
}

// Wspólne strojenie gry (konsola: window.CameraDirector.tune).
export const cameraDirectorTune = createCameraDirectorTune();

export function createCameraDirector() {
  const P = CAMERA_DIRECTOR_MAX_POINTS;
  const C = CAMERA_DIRECTOR_MAX_CUES;
  return {
    // Punkty kadru tej klatki — pisze gra (beginCameraDirectorPoints / pushCameraDirectorPoint), j. świata.
    n: 0,
    px: new Float64Array(P), py: new Float64Array(P), pr: new Float64Array(P), pw: new Float64Array(P),
    pf: new Uint8Array(P),
    // Sygnały (zapowiedziane przyloty, punkty uwagi): klucz → pozycja, promień, waga, życie [s].
    cueN: 0,
    cueKey: new Array(C).fill(null),
    cx: new Float64Array(C), cy: new Float64Array(C), cr: new Float64Array(C), cw: new Float64Array(C),
    cLife: new Float64Array(C),
    // Obecność kadru bitwy 0..1 (liniowa) i czas trzymania po ostatnim punkcie.
    presence: 0,
    linger: 0,
    // Ostatni policzony cel (trzymany, gdy punkty znikną — kadr gaśnie z obecnością, nie skacze).
    goalBX: 0, goalBY: 0, goalLog: 0,
    // Wynik: przesunięcie środka kadru względem statku [j. świata] (sprężyna) …
    biasX: 0, biasY: 0, bvx: 0, bvy: 0,
    // … i człon log(zoom) ≤ 0 (sprężyna w log), po władzy gracza: zoomLog.
    zlog: 0, zvel: 0, zoomLog: 0,
    holdIn: 0,
    authority: 1, authorityTarget: 1, wheelAge: 1e9,
    lookScale: 1,
    // Diagnostyka (panel, sonda): ile punktów, zoom potrzebny, przyczyna.
    count: 0, cues: 0, needZoom: 0, reason: ''
  };
}

/** Początek listy punktów tej klatki. */
export function beginCameraDirectorPoints(dir) {
  dir.n = 0;
}

/** Punkt kadru: pozycja [j.], promień [j.], waga (> 0), flagi (CAM_POINT_MUST). Zwraca false, gdy brak miejsca. */
export function pushCameraDirectorPoint(dir, x, y, r, w, flags = CAM_POINT_MUST) {
  const i = dir.n;
  if (i >= dir.px.length || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  dir.px[i] = x;
  dir.py[i] = y;
  dir.pr[i] = Math.max(0, finite(r, 0));
  dir.pw[i] = Math.max(0, finite(w, 1));
  dir.pf[i] = flags | 0;
  dir.n = i + 1;
  return true;
}

/**
 * Sygnał (punkt uwagi) z kluczem: wstawia albo odświeża — żyje `life` s (domyślnie tune.cueLife) od ostatniego
 * wywołania. Nowy klucz przywraca pełną władzę nad zoomem (nowy przylot wroga ma być widać, nawet gdy gracz
 * przybliżył kadr kółkiem). Zwraca true dla nowego sygnału.
 */
export function noteCameraDirectorCue(dir, key, x, y, r = 0, w = 1.5, life = NaN, tune = cameraDirectorTune) {
  if (key == null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const lifeSec = Number.isFinite(life) && life > 0 ? life : finite(tune.cueLife, CAMERA_DIRECTOR_DEFAULTS.cueLife);
  let i = 0;
  for (; i < dir.cueN; i++) if (dir.cueKey[i] === key) break;
  const fresh = i === dir.cueN;
  if (fresh) {
    if (dir.cueN >= dir.cueKey.length) return false;
    dir.cueN++;
    dir.cueKey[i] = key;
    dir.authorityTarget = 1;
    dir.wheelAge = 1e9;
  }
  dir.cx[i] = x;
  dir.cy[i] = y;
  dir.cr[i] = Math.max(0, finite(r, 0));
  dir.cw[i] = Math.max(0, finite(w, 1));
  dir.cLife[i] = Math.max(dir.cLife[i] * (fresh ? 0 : 1), lifeSec);
  return fresh;
}

export function clearCameraDirectorCues(dir) {
  for (let i = 0; i < dir.cueN; i++) dir.cueKey[i] = null;
  dir.cueN = 0;
}

/**
 * Kółko / pad zmieniło zoom gracza o mnożnik `factor` (> 1 = przybliżenie). Przybliżenie, gdy reżyser oddala
 * kadr, zabiera mu część władzy nad zoomem — kółko działa od pierwszego ząbka.
 */
export function noteCameraDirectorWheel(dir, factor, tune = cameraDirectorTune) {
  const f = Number(factor);
  if (!(f > 1) || !Number.isFinite(f)) return;
  if (!(dir.zoomLog < -0.02)) return;
  // ząbek kółka = e^0,2 (index.html: wheelSpeed 0,002 × 100 px)
  const notches = Math.log(f) / 0.2;
  dir.authorityTarget = Math.max(0, dir.authorityTarget - finite(tune.wheelDrop, 0.35) * notches);
  dir.wheelAge = 0;
}

/**
 * Oddalenie reżysera przechodzi na zoom gracza (wejście w RTS: kadr bitwy zostaje widokiem floty). Zwraca człon
 * log(zoom), który trzeba dodać do zoomu gracza; stan reżysera wraca do zera.
 */
export function foldCameraDirectorZoom(dir) {
  const log = dir.zoomLog;
  resetCameraDirector(dir);
  return log;
}

export function resetCameraDirector(dir) {
  dir.presence = 0;
  dir.linger = 0;
  dir.goalBX = dir.goalBY = dir.goalLog = 0;
  dir.biasX = dir.biasY = dir.bvx = dir.bvy = 0;
  dir.zlog = dir.zvel = dir.zoomLog = 0;
  dir.holdIn = 0;
  dir.authority = dir.authorityTarget = 1;
  dir.lookScale = 1;
  dir.reason = '';
}

// Jedna oś sprężyny krytycznej (jak cameraRig.js): rozwiązanie dokładne dla stałego celu w kroku.
function spring(dir, posKey, velKey, target, omega, h) {
  const x0 = dir[posKey] - target;
  const v0 = dir[velKey];
  const decay = Math.exp(-omega * h);
  const k = v0 + omega * x0;
  dir[posKey] = target + (x0 + k * h) * decay;
  dir[velKey] = (v0 - k * omega * h) * decay;
}

/**
 * Najmniejsza połowa kadru E na jednej osi. Bezpieczny przedział kadru o środku C to [C − fLo·E, C + fHi·E]
 * (fLo, fHi < 1 — pasy HUD i odstęp od brzegu po każdej stronie). Statek [s − rS, s + rS] i punkty „musi”
 * [p − r, p + r] mają się w nim zmieścić: C ≥ hi_i − fHi·E i C ≤ lo_j + fLo·E dla każdej pary ⇒
 * E = (max hi − min lo) / (fLo + fHi). Środek: przedział [max hi − fHi·E, min lo + fLo·E].
 */
function axisFit(dir, s, rS, fLo, fHi, horizontal, out) {
  let hi = s + rS;
  let lo = s - rS;
  const pos = horizontal ? dir.px : dir.py;
  for (let i = 0; i < dir.n; i++) {
    if (!(dir.pf[i] & CAM_POINT_MUST)) continue;
    const p = pos[i];
    const r = dir.pr[i];
    if (p + r > hi) hi = p + r;
    if (p - r < lo) lo = p - r;
  }
  const cpos = horizontal ? dir.cx : dir.cy;
  for (let i = 0; i < dir.cueN; i++) {
    const p = cpos[i];
    const r = dir.cr[i];
    if (p + r > hi) hi = p + r;
    if (p - r < lo) lo = p - r;
  }
  out.hi = hi;
  out.lo = lo;
  out.half = Math.max(0, (hi - lo) / Math.max(1e-6, fLo + fHi));
  return out;
}

// Środek osi dla połowy kadru `half`: preferowany `pref`, przycięty do przedziału, w którym wszystko się mieści;
// gdy przedział jest pusty (zoom na podłodze) — środek przedziału przycięty tak, by statek został w kadrze.
function axisCenter(s, rS, fLo, fHi, a, half, pref) {
  const lo = a.hi - fHi * half;
  const hi = a.lo + fLo * half;
  if (lo <= hi) return clamp(pref, lo, hi);
  const shipLo = s + rS - fHi * half;
  const shipHi = s - rS + fLo * half;
  const mid = (lo + hi) * 0.5;
  return shipLo <= shipHi ? clamp(mid, shipLo, shipHi) : s;
}

const _ax = { half: 0, hi: 0, lo: 0 };
const _ay = { half: 0, hi: 0, lo: 0 };

// Ułamek pół kadru dostępny po jednej stronie: bez pasa HUD (px) i odstępu edgePad.
function sideFrac(insetPx, halfPx, pad) {
  return clamp(1 - Math.max(0, finite(insetPx, 0)) / halfPx - pad, 0.05, 1);
}

/**
 * Krok reżysera o `input.dt` s (czas klatki renderu). input:
 *   viewW, viewH       — kadr [px]
 *   shipX, shipY       — statek (poza renderu) [j.]
 *   shipLength         — długość kadłuba [j.] (podłoga zoomu: minShipFrac; promień w kadrze: połowa)
 *   insetTop, insetBottom, insetLeft, insetRight — pasy kadru zasłonięte przez HUD [px]
 *   baseZoom           — zoom gracza (stan sprężyny zoomu, bez członów przejściowych)
 *   minZoom, maxZoom   — granice zoomu kamery
 *   mode               — 'full' | 'pan' | 'off'
 *   enabled            — false: kadr gaśnie (warp, ujęcie fabuły, stery fregaty); fast — szybko
 *   suspend            — true: stan zerowany od razu (przejście kamery, tryb inny niż statek)
 * Punkty kadru — przed krokiem (beginCameraDirectorPoints / pushCameraDirectorPoint), sygnały — noteCameraDirectorCue.
 * Wynik w dir: biasX/biasY [j. świata, środek kadru − statek], zoomLog (człon log(zoom) ≤ 0), lookScale.
 */
export function stepCameraDirector(dir, input, tune = cameraDirectorTune) {
  if (input.suspend === true) {
    resetCameraDirector(dir);
    return dir;
  }
  const h = Math.max(0, finite(input.dt, 0));
  const mode = normalizeCameraFrameMode(input.mode);

  // Sygnały starzeją się (życie od ostatniego odświeżenia).
  let w = 0;
  for (let i = 0; i < dir.cueN; i++) {
    const life = dir.cLife[i] - h;
    if (life <= 0) { dir.cueKey[i] = null; continue; }
    if (w !== i) {
      dir.cueKey[w] = dir.cueKey[i]; dir.cueKey[i] = null;
      dir.cx[w] = dir.cx[i]; dir.cy[w] = dir.cy[i]; dir.cr[w] = dir.cr[i]; dir.cw[w] = dir.cw[i];
    }
    dir.cLife[w] = life;
    w++;
  }
  dir.cueN = w;

  const on = mode !== 'off' && input.enabled !== false;
  let must = 0;
  for (let i = 0; i < dir.n; i++) if (dir.pf[i] & CAM_POINT_MUST) must++;
  const has = on && (dir.n > 0 || dir.cueN > 0);
  dir.count = dir.n;
  dir.cues = dir.cueN;

  // --- Obecność kadru bitwy ---
  if (has) dir.linger = Math.max(0, finite(tune.lingerSec, 3));
  else dir.linger = Math.max(0, dir.linger - h);
  const presTarget = on && (has || dir.linger > 0) ? 1 : 0;
  if (dir.presence < presTarget) {
    dir.presence = Math.min(presTarget, dir.presence + h / Math.max(1e-3, finite(tune.enterTime, 0.6)));
  } else if (dir.presence > presTarget) {
    const exitT = input.fast ? tune.fastExitTime : tune.exitTime;
    dir.presence = Math.max(presTarget, dir.presence - h / Math.max(1e-3, finite(exitT, 2)));
  }
  const pres = dir.presence * dir.presence * (3 - 2 * dir.presence);

  // --- Cel: zoom i środek z punktów (gdy są) — inaczej ostatni cel gaśnie z obecnością ---
  const halfW = Math.max(1, finite(input.viewW, 1) * 0.5);
  const halfH = Math.max(1, finite(input.viewH, 1) * 0.5);
  const sx = finite(input.shipX, 0);
  const sy = finite(input.shipY, 0);
  const zMin = Math.max(1e-5, finite(input.minZoom, 1e-4));
  const zMax = Math.max(zMin, finite(input.maxZoom, 10));
  const base = clamp(finite(input.baseZoom, 1), zMin, zMax);
  // bezpieczny prostokąt: pasy HUD + odstęp od brzegu (y w dół: góra = strona „lo” osi y)
  const pad = clamp(finite(tune.edgePad, 0.06), 0, 0.45);
  const fL = sideFrac(input.insetLeft, halfW, pad);
  const fR = sideFrac(input.insetRight, halfW, pad);
  const fT = sideFrac(input.insetTop, halfH, pad);
  const fB = sideFrac(input.insetBottom, halfH, pad);
  const shipLen = Math.max(1, finite(input.shipLength, 1));
  // promień kadłuba w kadrze, ale najwyżej taki, że sam statek mieści się przy zoomie gracza — przybliżenie gracza
  // (kadłub większy od kadru) nie jest powodem do oddalania
  const rSx = Math.min(shipLen * 0.5, 0.95 * 0.5 * (fL + fR) * halfW / base);
  const rSy = Math.min(shipLen * 0.5, 0.95 * 0.5 * (fT + fB) * halfH / base);
  if (has) {
    axisFit(dir, sx, rSx, fL, fR, true, _ax);
    axisFit(dir, sy, rSy, fT, fB, false, _ay);
    let zNeed = base;
    if (mode === 'full') {
      let fit = Infinity;
      if (_ax.half > 1e-6) fit = Math.min(fit, halfW / _ax.half);
      if (_ay.half > 1e-6) fit = Math.min(fit, halfH / _ay.half);
      const floorShip = finite(tune.minShipFrac, 0.06) * halfW * 2 / shipLen;
      const floor = Math.max(zMin, base * clamp(finite(tune.minZoomFactor, 0.3), 0.01, 1), Math.min(base, floorShip));
      zNeed = clamp(fit, floor, base);
    }
    dir.needZoom = zNeed;
    // środek ciężkości wag (wrogowie + sygnały)
    let gw = 0, gx = 0, gy = 0;
    for (let i = 0; i < dir.n; i++) { const wi = dir.pw[i]; gw += wi; gx += dir.px[i] * wi; gy += dir.py[i] * wi; }
    for (let i = 0; i < dir.cueN; i++) { const wi = dir.cw[i]; gw += wi; gx += dir.cx[i] * wi; gy += dir.cy[i] * wi; }
    const bias = clamp(finite(tune.bias, 0.5), 0, 1);
    const prefX = gw > 1e-9 ? sx + (gx / gw - sx) * bias : sx;
    const prefY = gw > 1e-9 ? sy + (gy / gw - sy) * bias : sy;
    const cxW = axisCenter(sx, rSx, fL, fR, _ax, halfW / zNeed, prefX);
    const cyW = axisCenter(sy, rSy, fT, fB, _ay, halfH / zNeed, prefY);
    let gbx = cxW - sx;
    let gby = cyW - sy;
    if (must === 0 && dir.cueN === 0) {
      // sami dalecy wrogowie / drony: tylko wychylenie w ich stronę (eliptycznie — ułamek pół kadru na osi)
      const lean = clamp(finite(tune.leanMax, 0.3), 0, 1);
      const ex = gbx / Math.max(1e-6, lean * halfW / zNeed);
      const ey = gby / Math.max(1e-6, lean * halfH / zNeed);
      const e = Math.sqrt(ex * ex + ey * ey);
      if (e > 1) { gbx /= e; gby /= e; }
    }
    dir.goalBX = gbx;
    dir.goalBY = gby;
    dir.goalLog = Math.min(0, Math.log(zNeed / base));
    dir.reason = must > 0 ? (dir.cueN > 0 ? 'wrogowie + przylot' : 'wrogowie') : (dir.cueN > 0 ? 'przylot' : 'wrogowie (bez kadru)');
  } else if (pres <= 0) {
    dir.reason = '';
  }

  // --- Środek kadru: sprężyna ku celowi × obecność ---
  const bo = Math.max(0.05, finite(tune.biasOmega, 2.4));
  if (h > 0) {
    spring(dir, 'biasX', 'bvx', dir.goalBX * pres, bo, h);
    spring(dir, 'biasY', 'bvy', dir.goalBY * pres, bo, h);
  }

  // --- Zoom: oddalanie szybko, przybliżanie z odczekaniem i wolno ---
  const target = mode === 'full' ? dir.goalLog * pres : 0;
  if (h > 0) {
    if (target < dir.zlog - 1e-4) {
      dir.holdIn = 0;
      spring(dir, 'zlog', 'zvel', target, Math.max(0.05, finite(tune.zoomOutOmega, 2.2)), h);
    } else if (target > dir.zlog + 1e-4) {
      // przy wygaszaniu (obecność maleje) bez czekania; inaczej mała różnica i krótka chwila nie przybliżają
      const leaving = presTarget === 0;
      const big = target - dir.zlog > finite(tune.zoomInDeadband, 0.06);
      dir.holdIn = big || leaving ? dir.holdIn + h : 0;
      if (leaving || dir.holdIn >= finite(tune.zoomInHold, 2.5)) {
        spring(dir, 'zlog', 'zvel', target, Math.max(0.05, finite(tune.zoomInOmega, 0.7)), h);
      } else {
        // czekanie: resztka ruchu oddalania gaśnie (bez skoku prędkości), kadr stoi
        dir.zvel *= Math.exp(-6 * h);
        dir.zlog = Math.min(dir.zlog + dir.zvel * h, target);
      }
    } else {
      dir.zlog = target;
      dir.zvel = 0;
      dir.holdIn = 0;
    }
    if (dir.zlog > 0) { dir.zlog = 0; if (dir.zvel > 0) dir.zvel = 0; }
  }

  // --- Władza gracza nad zoomem (kółko) ---
  dir.wheelAge += h;
  if (dir.wheelAge > 1.5 && dir.authorityTarget < 1) {
    dir.authorityTarget = Math.min(1, dir.authorityTarget + h / Math.max(0.1, finite(tune.authorityRecover, 12)));
  }
  const ao = Math.max(0.05, finite(tune.authorityOmega, 6));
  dir.authority += (dir.authorityTarget - dir.authority) * (1 - Math.exp(-ao * h));
  dir.zoomLog = dir.zlog * clamp(dir.authority, 0, 1);

  dir.lookScale = 1 - clamp(finite(tune.lookDamp, 0.5), 0, 1) * pres;
  return dir;
}
