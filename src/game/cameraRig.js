// Kamera statku gracza: dwie postawy (nawigacja / walka) mieszane płynnie.
//
// Kamera = statek + offset. Offset liczymy w PIKSELACH EKRANU (zoom go nie
// rusza) i prowadzimy sprężyną krytyczną krokowaną raz na klatkę renderu.
// Sam statek zostaje przyklejony sztywno — wygładzamy tylko offset, bo
// wygładzona pozycja kamery w świecie gubiłaby statek przy 10 000 j/s.
//
// - Nawigacja: kursor to wskaźnik (świat stoi), kamera wyprzedza lot o ułamek
//   pół ekranu proporcjonalny do prędkości, sprężyna wolna (kamera sunie).
// - Walka: kamera zagląda za kursorem (martwa strefa, krzywa do `combatLook`
//   pół ekranu przy krawędzi), wyprzedzenie mniejsze, sprężyna szybka
//   (filtruje drżenie ręki).
// - Kadr: środek statku nigdy bliżej krawędzi niż `frameMargin` ekranu.
// - Postawę wybiera waga walki 0…1: sygnały walki (strzał, trafienie, wrogi cel,
//   wróg w zasięgu) trzymają ją `combatHold` s, wejście i wyjście liniowe.
// - Zamrożony kursor (menu PPM, koło ŚPM, Alt, tablet, kursor poza kanwą)
//   trzyma OSTATNI punkt patrzenia — nie zeruje go, więc nie ma skoku.
//
// - Kop warpa (zadanie 22-B, demo „Nurt”: dema/warp-webgpu/scenes.js — createTripScene /
//   createFreeScene): przy skoku statek wyrywa się do przodu w kadrze, a kamera go dogania
//   (cofnięcie kamery wzdłuż kursu, impuls PO sprężynie — kształt z dema), zoom −10% i wstrząs;
//   na czas ładowania i skoku zoom × warpZoomOut, przy wyjściu impuls +10% i powrót do zoomu
//   gracza w warpZoomReturn s. Zoom to przejściowy człon log(zoom) dla sprężyny zoomu
//   (cameraZoom.js: camera.zoom = zoomBase · e^człon) — targetZoom gracza nietknięty.
//   Oś kopu biegnie w czasie gry (w pauzie stoi): stepCameraRigWarp raz na klatkę przed
//   zoomem i rigiem; zdarzenia z automatu warpa gracza: noteCameraRigWarp('kick' | 'exit').
// - Rulon warpa (2026-10-03, demo „Nurt” iteracja 3): w ładowaniu i w locie statek idzie na ŚRODEK
//   kadru w lejku (wyprzedzenie i kursor × (1 − lejek)); WYJŚCIE = przylot jak u NPC — kamera
//   zostaje ZA statkiem (nigdy go nie wyprzedza): statek wysuwa się w stronę celu do WARP_EXIT.ahead
//   pół kadru i tam staje, kamera dogania go w WARP_EXIT.settle s; oddalenie trzymane do końca
//   zwolnienia (input.exitAge / exitSlow / exitHalt — rampa wyjścia rozgrywki).
//
// Dawniej (do 2026-09-27) kamera brała 2× odległość kursora od środka bez
// limitu i bez wygładzania: statek wypadał z kadru, gdy kursor odjechał o ćwierć
// ekranu (270 px w pionie przy 1080 p), a świat pod kursorem jechał 3× szybciej
// niż ręka.

import { WARP_EXIT, warpRulonBend } from './warpDrive.js';

export const CAMERA_RIG_DEFAULTS = Object.freeze({
  // Nawigacja
  navLook: 0,           // kursor → kamera przy krawędzi (ułamek pół ekranu)
  navLead: 0.35,        // pełne wyprzedzenie lotu (ułamek pół ekranu)
  navOmega: 3,          // 1/s — 95% drogi po ~1,6 s
  // Wyprzedzenie = pełne × (1 − e^(−v / (to × v_max))): 63% przy ¼ v_max, 98% przy v_max.
  // Liniowe v / v_max było niewidoczne — Atlas (v_max 10 000) po 6 s ciągu leci ~1400 j/s.
  leadSpeedRef: 0.25,
  // Stery fregaty zwiadu (2026-10-11, prośba użytkownika: „fregata jest na środku ekranu — trudniej zbadać bazę;
  // kamera wraz z przyspieszeniem powinna przejść do przodu”): pełne wyprzedzenie z prędkości fregaty, bez kursora.
  scoutLead: 0.55,
  // Walka
  combatLook: 0.75,
  combatLead: 0.12,
  combatOmega: 8,       // 1/s — 95% drogi po ~0,6 s
  lookDeadZone: 0.12,   // martwa strefa kursora (ułamek pół ekranu)
  lookExponent: 1.2,    // krzywa za martwą strefą (1 = liniowa)
  // Kadr
  frameMargin: 0.12,    // min. odległość środka statku od krawędzi (ułamek ekranu)
  // Przełączanie postaw
  combatHold: 6,        // s bez sygnałów walki do powrotu do nawigacji
  combatEnterTime: 0.5, // s przejścia nawigacja → walka
  combatExitTime: 1.5,  // s przejścia walka → nawigacja
  hostileRangeScale: 1.2, // wróg bliżej niż zasięg broni głównej × to = walka
  // Kursor poza kanwą (nad panelem HUD, poza oknem): punkt patrzenia trzymany tyle s, potem wraca do środka
  // (2026-10-11: dawniej trzymany bez końca — kadr zostawał przesunięty tam, gdzie kursor zszedł z kanwy).
  lookAwayHold: 2.5,
  lookAwayTau: 1.2,     // s — stała zaniku punktu patrzenia po lookAwayHold
  // Wstrząs (px ekranu)
  shakeScale: 0.5,      // camera.addShake(mag) → mag × to px
  weaponShakeScale: 0.12, // wstrząs strzałów (WeaponFx, window.__weapon3dCameraShake) → mag × to px
  shakeMaxPx: 16,
  shakeHz: 12,
  // Kopnięcie kadru od ciężkich strzałów gracza (2026-10-13, „feel strzelania”): sprężyna w px ekranu, impuls
  // WZDŁUŻ strzału — okręt na ekranie odskakuje w tył jak od odrzutu, kadr wraca z lekkim przerzutem. Tylko
  // grupa w ręku (wieże na auto mają wstrząs × 0,1 — poniżej progu) i broń ze `shake` ≥ weaponKickMin
  // (src/data/weapons.js: armata 6,5, Lanca L 9, Valkyrie 12, Yamato 20, Hexlance 14). 0 w weaponKickPerShake wyłącza.
  weaponKickMin: 5,         // wstrząs broni (pole shake), od którego strzał kopie kadrem
  weaponKickPerShake: 0.9,  // px szczytu kopnięcia na jednostkę shake ponad próg (Yamato: ~13 px)
  weaponKickShotMaxPx: 14,  // sufit jednego strzału
  weaponKickMaxPx: 16,      // sufit wychylenia (salwa 6 wież Yamato sumuje się do niego)
  weaponKickHz: 5,          // częstotliwość sprężyny
  weaponKickDamping: 0.55,  // tłumienie ζ (< 1; im bliżej 1, tym mniejszy przerzut)
  weaponKickSign: 1,        // 1 — kadr w stronę strzału (okręt na ekranie w tył); −1 — odwrotnie
  // Zoom startowy: kadłub zajmuje taki ułamek szerokości ekranu
  hullScreenFraction: 0.2,
  // Kop warpa (demo „Nurt”, createTripScene — liczby dema). 0 / 1 wyłącza człon.
  warpKickPx: 140,        // cofnięcie kamery przy skoku: 140 px × impuls(0,05 / 0,42 s) — szczyt ~96 px po 0,11 s (px przy kadrze 1080 wierszy)
  warpZoomOut: 0.55,      // zoom na czas ładowania i skoku (× zoom gracza); 1 = bez oddalenia
  warpZoomKick: 0.1,      // impuls zoomu przy skoku: × (1 − 0,1 · impuls(0,04 / 0,25 s))
  warpZoomExit: 0.1,      // impuls zoomu przy wyjściu: × (1 + 0,1 · impuls(0,03 / 0,18 s))
  warpZoomReturn: 1.4,    // s powrotu do zoomu gracza po wyjściu (easeOut³, liniowo w zoomie jak w demie)
  // Ujednolicony kadr skoku (demo „Pęd”, 2026-10-19): oddalenie liczy się od zoomu odniesienia (input.zoomRef —
  // domyślny zoom statku), nie od zoomu gracza; 1 — pełne, 0 — dawne (× zoom gracza). Działa przy warpZoomOut < 1.
  warpZoomUnify: 1,
  warpZoomUnifyHold: 1,   // s po zatrzymaniu (koniec rampy wyjścia), zanim kadr wróci do zoomu gracza
  // Kadr przylotu (ujednolicony zoom, wyjście — input.arrivalDist): bliski brzeg prawdziwej tarczy celu na tym ułamku
  // drogi od statku do krawędzi kadru przed dziobem; sprężyna logarytmu zoomu [1/s]. 0 w warpArrivalFill wyłącza.
  warpArrivalFill: 0.75,
  warpArrivalOmega: 3,
  warpChargeShakePx: 4,   // drżenie w drugiej połowie ładowania [px] (demo: 4 · smooth(0,5, 1, ładowanie))
  // Obrót kadru w skoku (stepCameraRigRoll — demo „Pęd”, 2026-10-19): sprężyna krytyczna kąta [1/s]
  // (90° w ~1 s) i ile sekund po zatrzymaniu kadr jeszcze trzyma kurs, zanim wróci do północy.
  warpRollOmega: 3.2,
  warpRollHold: 0.5,
  // Obrót kadru w skoku WARPA gracza (gra, port dema „Pęd” 2026-10-23 — input.omega): szybciej niż hipercruise, żeby kadr
  // stał już przy kopie (przy 3,2/s i kursie ~150° obrót trwał jeszcze sekundę lotu).
  warpJumpRollOmega: 5
});

// Zakresy strojenia (sanityzacja wartości z konsoli i testów).
export const CAMERA_RIG_RANGES = Object.freeze({
  navLook: [0, 1],
  navLead: [0, 0.8],
  navOmega: [0.5, 20],
  leadSpeedRef: [0.02, 2],
  scoutLead: [0, 0.8],
  combatLook: [0, 1.2],
  combatLead: [0, 0.8],
  combatOmega: [0.5, 30],
  lookDeadZone: [0, 0.6],
  lookExponent: [0.5, 3],
  frameMargin: [0, 0.45],
  combatHold: [0, 30],
  combatEnterTime: [0.05, 5],
  combatExitTime: [0.05, 8],
  hostileRangeScale: [0, 3],
  lookAwayHold: [0, 30],
  lookAwayTau: [0.05, 10],
  shakeScale: [0, 3],
  weaponShakeScale: [0, 2],
  shakeMaxPx: [0, 80],
  shakeHz: [1, 40],
  weaponKickMin: [0, 40],
  weaponKickPerShake: [0, 4],
  weaponKickShotMaxPx: [0, 60],
  weaponKickMaxPx: [0, 80],
  weaponKickHz: [1, 20],
  weaponKickDamping: [0.1, 0.95],
  weaponKickSign: [-1, 1],
  hullScreenFraction: [0.03, 0.9],
  warpKickPx: [0, 400],
  warpZoomOut: [0.3, 1],
  warpZoomKick: [0, 0.3],
  warpZoomExit: [0, 0.3],
  warpZoomReturn: [0.2, 4],
  warpZoomUnify: [0, 1],
  warpZoomUnifyHold: [0, 5],
  warpArrivalFill: [0, 0.95],
  warpArrivalOmega: [0.5, 12],
  warpChargeShakePx: [0, 16],
  warpRollOmega: [0.5, 12],
  warpRollHold: [0, 3],
  warpJumpRollOmega: [0.5, 12]
});

// Impulsy kopu warpa (s): narastanie i zanik — stałe dema (dema/warp-webgpu/scenes.js).
export const CAMERA_WARP_PULSES = Object.freeze({
  lagRise: 0.05, lagFall: 0.42,          // cofnięcie kamery (statek wyrywa się do przodu)
  kickZoomRise: 0.04, kickZoomFall: 0.25, // zoom −10% przy skoku
  exitZoomRise: 0.03, exitZoomFall: 0.18  // zoom +10% przy wyjściu
});
// Po tylu sekundach impuls jest zerem (lag: 140 · e^(−4 / 0,42) ≈ 0,01 px).
const WARP_PULSE_END = 4;
// Oddalanie: mnożnik zoomu idzie za celem najwyżej tyle na sekundę. Krzywa ładowania (0,8 s gry:
// do 0,84/s) przechodzi dokładnie, skok celu (np. powrót do kamery statku w skoku) to rampa ~0,3 s.
const WARP_ZOOM_OUT_RATE = 1.5;
// Kop w px przy kadrze tej wysokości (demo 1920×1080) — wyżej / niżej proporcjonalnie, jak wyprzedzenie.
const WARP_KICK_REF_H = 1080;
// Odstęp środka statku od pasa HUD (ułamek wysokości kadru) — input.insetTop / insetBottom.
const HUD_PAD = 0.04;

export const CAMERA_LOOK_MODES = Object.freeze(['auto', 'always', 'never']);

export function normalizeCameraLookMode(mode) {
  return CAMERA_LOOK_MODES.includes(mode) ? mode : 'auto';
}

// Opcja „Kop kamery przy warpie” (menu → Sterowanie, localStorage sc_camera_warp_kick):
// 'off' wyłącza cofnięcie kamery, impulsy i oddalenie zoomu warpa (wstrząsy zostają).
export const CAMERA_WARP_KICK_MODES = Object.freeze(['on', 'off']);

export function normalizeCameraWarpKickMode(mode) {
  return mode === 'off' ? 'off' : 'on';
}

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function finite(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Kopia strojenia z domyślnych + nadpisań (zapis panelu dev), przycięta do zakresów.
export function createCameraRigTune(overrides = null) {
  const tune = { ...CAMERA_RIG_DEFAULTS };
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(CAMERA_RIG_DEFAULTS)) {
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
      const [min, max] = CAMERA_RIG_RANGES[key];
      tune[key] = clamp(finite(overrides[key], CAMERA_RIG_DEFAULTS[key]), min, max);
    }
  }
  return tune;
}

// Wspólne strojenie gry: czyta je render(); na żywo z konsoli — CameraRig.tune (index.html).
// Jeden obiekt w instancji modułu.
export const cameraRigTune = createCameraRigTune();

export function createCameraRig() {
  return {
    // Offset kamery względem statku w px ekranu (kamera przed statkiem): wynik riga = sprężyna
    // + kop warpa, w kadrze. Stan sprężyny (springX/Y) i jego prędkość (velX/Y) osobno — kop
    // idzie po sprężynie, nie przez nią.
    offsetX: 0,
    offsetY: 0,
    springX: 0,
    springY: 0,
    velX: 0,
    velY: 0,
    // Ostatni punkt patrzenia kursora, znormalizowany do pół ekranu (−1…1 na krawędzi).
    lookNX: 0,
    lookNY: 0,
    // Ile s kursor jest poza kanwą (input.lookAway).
    lookAwayT: 0,
    // Waga walki 0…1 (liniowa) i jej wygładzona postać używana do mieszania.
    combatRaw: 0,
    combat: 0,
    // Ile sekund jeszcze trzymać walkę bez nowych sygnałów.
    combatHoldLeft: 0,
    combatReason: '',
    // Do podglądu w panelu: skąd wziął się ostatni cel offsetu.
    targetX: 0,
    targetY: 0,
    // Kop warpa (stepCameraRigWarp). Wyjście na tę klatkę: człon log(zoom) dla sprężyny zoomu,
    // cofnięcie kamery wzdłuż kursu [px] i drżenie ładowania [px].
    warpZoomLog: 0,
    warpLagPx: 0,
    warpShakePx: 0,
    warpDirX: 1,
    warpDirY: 0,
    // Stan: zdarzenia automatu czekające na krok, wiek impulsów [s] (< 0 = brak), mnożnik zoomu
    // na czas skoku (1 = zoom gracza) i powrót po wyjściu (easeOut³ od warpRelFrom).
    warpKickPending: false,
    warpExitPending: false,
    warpKickAge: -1,
    warpExitAge: -1,
    warpHold: 1,
    warpRelFrom: 1,
    warpRelAge: -1,
    // Ujednolicony kadr skoku (input.zoomRef): waga 0…1 (1 — zoom liczony od zoomu odniesienia) i jej powrót do
    // zoomu gracza po zatrzymaniu (easeOut³ od warpUnifyFrom).
    warpUnifyW: 0,
    warpUnifyFrom: 0,
    warpUnifyRelAge: -1,
    // Kadr przylotu: zatrzaśnięty przy wyjściu, log zoomu kadru (sprężyna) i jego prędkość.
    warpArrOn: false,
    warpArrLog: 0,
    warpArrVel: 0,
    // Obrót kadru w skoku (stepCameraRigRoll): kąt [rad] dla kamery gry (`cam.roll` — src/3d/viewRoll.js)
    // i prędkość sprężyny.
    roll: 0,
    rollVel: 0,
    // Rulon (stepCameraRigWarp → stepCameraRig): mnożnik celu offsetu (1 − lejek; 0 przy wyjściu)
    // i wysunięcie statku przed kamerę przy wyjściu [× pół kadru wzdłuż kursu].
    warpLeadScale: 1,
    warpAheadK: 0
  };
}

// Sygnał walki: trzyma postawę walki przez `combatHold` s od teraz.
export function noteCameraRigCombat(rig, tune = CAMERA_RIG_DEFAULTS, reason = '') {
  if (!rig) return;
  const hold = Math.max(0, finite(tune.combatHold, CAMERA_RIG_DEFAULTS.combatHold));
  if (hold >= rig.combatHoldLeft) {
    rig.combatHoldLeft = hold;
    if (reason) rig.combatReason = reason;
  }
}

// Wielkość przesunięcia kursora (ułamek pół ekranu) z martwą strefą i krzywą.
// Bez górnego limitu — róg ekranu sięga dalej, kadr i tak przycina oś.
export function cameraLookMagnitude(r, deadZone, exponent) {
  const dz = clamp(finite(deadZone, 0), 0, 0.95);
  if (!(r > dz)) return 0;
  const t = (r - dz) / (1 - dz);
  const p = Math.max(0.05, finite(exponent, 1));
  return p === 1 ? t : Math.pow(t, p);
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function easeOut3(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

function smoothRange(a, b, x) {
  return smoothstep01((x - a) / Math.max(1e-6, b - a));
}

/** Impuls 0 → 1 → 0 (demo: narasta w `rise`, gaśnie z czasem `fall`); szczyt po rise·ln((rise + fall) / rise). */
export function cameraWarpPulse(t, rise, fall) {
  return t <= 0 ? 0 : (1 - Math.exp(-t / rise)) * Math.exp(-t / fall);
}

// Jedna oś sprężyny krytycznej: x(t) = (x0 + (v0 + ωx0)t)·e^(−ωt), dokładnie
// dla stałego celu w obrębie kroku — przebieg nie zależy od FPS.
function springAxis(rig, posKey, velKey, target, omega, h) {
  const x0 = rig[posKey] - target;
  const v0 = rig[velKey];
  const decay = Math.exp(-omega * h);
  const k = v0 + omega * x0;
  rig[posKey] = target + (x0 + k * h) * decay;
  rig[velKey] = (v0 - k * omega * h) * decay;
}

// Krok kamery o `input.dt` s (czas klatki renderu).
// input:
//   viewW, viewH       — rozmiar kadru w px
//   mouseX, mouseY     — kursor w px kadru
//   lookFrozen         — true: trzymaj ostatni punkt patrzenia (kursor zajęty UI)
//   lookAway           — true: kursor poza kanwą — trzymaj lookAwayHold s, potem wróć do środka
//   lookEnabled        — false: kursor nie rusza kamerą (split-screen)
//   lookScale          — mnożnik zaglądania za kursorem (reżyser kadru: cameraDirector.lookScale), domyślnie 1
//   biasX, biasY       — przesunięcie środka kadru od reżysera kadru [px, po sprężynie, w kadrze]
//   insetTop, insetBottom — pasy kadru zasłonięte przez HUD [px]: środek statku zostaje poza nimi (+ HUD_PAD)
//   velX, velY         — prędkość prowadzonego okrętu (j/s), maxSpeed — jego v_max (Atlas: tryb napędu)
//   leadGain           — pełne wyprzedzenie (ułamek pół ekranu) zamiast mieszanki postaw (stery fregaty zwiadu:
//                        tune.scoutLead); brak / NaN — navLead ↔ combatLead wg wagi walki
//   mode               — 'auto' | 'always' | 'never' (opcja „Kamera za kursorem”)
//   holdDt             — czas gry tej klatki (0 w pauzie) — tyle schodzi z trzymania walki
// Zwraca rig (offsetX/offsetY w px: kamera = statek + offset / zoom).
export function stepCameraRig(rig, input, tune = CAMERA_RIG_DEFAULTS) {
  const h = Math.max(0, finite(input.dt, 0));
  const halfW = Math.max(1, finite(input.viewW, 1) * 0.5);
  const halfH = Math.max(1, finite(input.viewH, 1) * 0.5);
  const mode = normalizeCameraLookMode(input.mode);

  // --- Waga walki ---
  const holdDt = Math.max(0, finite(input.holdDt, h));
  rig.combatHoldLeft = Math.max(0, rig.combatHoldLeft - holdDt);
  const combatTarget = mode === 'always' ? 1 : (mode === 'never' ? 0 : (rig.combatHoldLeft > 0 ? 1 : 0));
  if (rig.combatRaw < combatTarget) {
    rig.combatRaw = Math.min(combatTarget, rig.combatRaw + h / Math.max(1e-3, tune.combatEnterTime));
  } else if (rig.combatRaw > combatTarget) {
    rig.combatRaw = Math.max(combatTarget, rig.combatRaw - h / Math.max(1e-3, tune.combatExitTime));
  }
  const w = smoothstep01(rig.combatRaw);
  rig.combat = w;

  // --- Punkt patrzenia kursora ---
  if (input.lookEnabled === false) {
    rig.lookNX = 0;
    rig.lookNY = 0;
    rig.lookAwayT = 0;
  } else if (input.lookFrozen) {
    rig.lookAwayT = 0;
  } else if (input.lookAway) {
    rig.lookAwayT += h;
    if (rig.lookAwayT > finite(tune.lookAwayHold, 2.5)) {
      const k = Math.exp(-h / Math.max(0.05, finite(tune.lookAwayTau, 1.2)));
      rig.lookNX *= k;
      rig.lookNY *= k;
    }
  } else {
    rig.lookAwayT = 0;
    rig.lookNX = clamp((finite(input.mouseX, halfW) - halfW) / halfW, -1.5, 1.5);
    rig.lookNY = clamp((finite(input.mouseY, halfH) - halfH) / halfH, -1.5, 1.5);
  }
  const lookScale = clamp(finite(input.lookScale, 1), 0, 1);
  const lookGain = (tune.navLook + (tune.combatLook - tune.navLook) * w) * lookScale;
  let lookX = 0;
  let lookY = 0;
  // Math.sqrt, nie Math.hypot — ten alokuje w V8 (pułapka z zadania 17), a krok idzie co klatkę.
  const r = Math.sqrt(rig.lookNX * rig.lookNX + rig.lookNY * rig.lookNY);
  if (lookGain > 0 && r > 1e-6) {
    const mag = cameraLookMagnitude(r, tune.lookDeadZone, tune.lookExponent) * lookGain;
    lookX = (rig.lookNX / r) * mag * halfW;
    lookY = (rig.lookNY / r) * mag * halfH;
  }

  // --- Wyprzedzenie z prędkości ---
  const vx = finite(input.velX, 0);
  const vy = finite(input.velY, 0);
  const speed = Math.sqrt(vx * vx + vy * vy);
  const maxSpeed = Math.max(1, finite(input.maxSpeed, 1));
  const leadOverride = Number(input.leadGain);
  const leadGain = Number.isFinite(leadOverride)
    ? Math.max(0, leadOverride)
    : tune.navLead + (tune.combatLead - tune.navLead) * w;
  let leadX = 0;
  let leadY = 0;
  if (speed > 1e-3 && leadGain > 0) {
    // W px ekranu, bez zoomu: zoom w locie nie przesuwa statku po ekranie.
    const vRef = Math.max(1e-3, finite(tune.leadSpeedRef, CAMERA_RIG_DEFAULTS.leadSpeedRef)) * maxSpeed;
    const s = (1 - Math.exp(-speed / vRef)) * leadGain;
    leadX = (vx / speed) * s * halfW;
    leadY = (vy / speed) * s * halfH;
  }

  // --- Cel w kadrze ---
  const margin = clamp(finite(tune.frameMargin, 0), 0, 0.49);
  const maxX = halfW * 2 * (0.5 - margin);
  // Pionowo asymetrycznie: środek statku nie wchodzi pod panel celu misji u góry ani pod kopułę radaru u dołu
  // (offsetY > 0 — statek nad środkiem kadru). Bez pasów HUD — symetrycznie jak dawniej.
  const marginPx = halfH * 2 * margin;
  const padPx = halfH * 2 * HUD_PAD;
  const maxYUp = Math.max(0, halfH - Math.max(marginPx, finite(input.insetTop, 0) + padPx));
  const maxYDown = Math.max(0, halfH - Math.max(marginPx, finite(input.insetBottom, 0) + padPx));
  // Rulon warpa: statek na środku lejka (stepCameraRigWarp: warpLeadScale).
  const leadScale = clamp(finite(rig.warpLeadScale, 1), 0, 1);
  const targetX = clamp((lookX + leadX) * leadScale, -maxX, maxX);
  const targetY = clamp((lookY + leadY) * leadScale, -maxYDown, maxYUp);
  rig.targetX = targetX;
  rig.targetY = targetY;

  // --- Sprężyna ---
  const omega = Math.max(0.05, tune.navOmega + (tune.combatOmega - tune.navOmega) * w);
  if (h > 0) {
    springAxis(rig, 'springX', 'velX', targetX, omega, h);
    springAxis(rig, 'springY', 'velY', targetY, omega, h);
  }
  // Gwarancja kadru także w trakcie ruchu (przestrzał z rozpędu, zmiana okna).
  if (rig.springX > maxX) { rig.springX = maxX; if (rig.velX > 0) rig.velX = 0; }
  else if (rig.springX < -maxX) { rig.springX = -maxX; if (rig.velX < 0) rig.velX = 0; }
  if (rig.springY > maxYUp) { rig.springY = maxYUp; if (rig.velY > 0) rig.velY = 0; }
  else if (rig.springY < -maxYDown) { rig.springY = -maxYDown; if (rig.velY < 0) rig.velY = 0; }

  // --- Kop warpa: kamera cofa się wzdłuż kursu (statek wyrywa się do przodu), PO sprężynie —
  // impuls ma kształt z dema (sprężyna ω 3–8/s zjadłaby szczyt po 0,11 s). Kadr pilnuje sumy.
  // Px dema przy 1080 wierszach — w innym kadrze proporcjonalnie (jak wyprzedzenie).
  // Wyjście: kamera ZA statkiem — statek wysuwa się wzdłuż kursu o warpAheadK pół kadru (pół
  // kadru mierzone wzdłuż kursu: do brzegu w tym kierunku).
  const wdx = finite(rig.warpDirX, 0);
  const wdy = finite(rig.warpDirY, 0);
  const ahK = Math.max(0, finite(rig.warpAheadK, 0));
  let ahead = 0;
  if (ahK > 0) {
    const ax = Math.abs(wdx);
    const ay = Math.abs(wdy);
    ahead = ahK * Math.min(ax > 1e-3 ? halfW / ax : Infinity, ay > 1e-3 ? halfH / ay : Infinity);
  }
  const lag = finite(rig.warpLagPx, 0) * (halfH * 2 / WARP_KICK_REF_H) + ahead;
  // Reżyser kadru (cameraDirector.js): przesunięcie ku bitwie — już wygładzone, dokładane po sprężynie; kadr
  // statku pilnuje suma.
  const bx = finite(input.biasX, 0);
  const by = finite(input.biasY, 0);
  rig.offsetX = clamp(rig.springX - wdx * lag + bx, -maxX, maxX);
  rig.offsetY = clamp(rig.springY - wdy * lag + by, -maxYDown, maxYUp);
  return rig;
}

// Zdarzenie automatu warpa gracza (index.html: engageWarp → 'kick', exitWarp → 'exit'). Rozgrywka
// tylko zgłasza — impuls rusza w najbliższym stepCameraRigWarp (czas gry, raz na klatkę).
export function noteCameraRigWarp(rig, event) {
  if (!rig) return;
  if (event === 'kick') rig.warpKickPending = true;
  else if (event === 'exit') rig.warpExitPending = true;
}

// Krok kopu warpa o `input.dt` s CZASU GRY (0 w pauzie — oś stoi), raz na klatkę renderu PRZED
// zoomem (updateCameraZoom bierze warpZoomLog) i rigiem (stepCameraRig bierze warpLagPx).
// input:
//   dt              — czas gry tej klatki
//   state, charge   — automat warpa gracza: 'idle' | 'charging' | 'active', ładowanie 0..1
//   dirX, dirY      — kurs skoku (jednostkowy; świat = ekran, y w dół)
//   enabled         — opcja „Kop kamery przy warpie” i kamera statku; false: zdarzenia przepadają,
//                     oddalenie wraca do zoomu gracza (rozpoczęte impulsy dobiegają końca)
//   suspend         — zoom prowadzi przejście kamery (fokus stacji / edytor): kop znika od razu
//                     (przejście startuje z zoomu na ekranie, więc bez skoku)
//   exitAge         — wiek rampy wyjścia [s] (< 0: brak), exitSlow / exitHalt — koniec zwolnienia
//                     i zatrzymanie (warpDrive.js: createWarpExitRamp)
//   rulon           — false: styl skoku bez rulonu (domyślny 'ped' — warpRulonEnabled) — statek nie idzie na środek lejka
//   zoomRef, zoomBase — UJEDNOLICONY KADR SKOKU (user 2026-10-19: „na przybliżonej kamerze największe skoki, na
//                     oddalonej w miarę ok — może ujednolicić kamerę na czas warpa”): zoom odniesienia (domyślny zoom
//                     statku — defaultShipZoom) i zoom gracza; w skoku kadr = zoomRef × warpZoomOut niezależnie od
//                     zoomu gracza (soczewka świata, kop i przejścia wyglądają zawsze jak przy zoomie domyślnym), wejście
//                     i powrót tą samą krzywą co oddalenie. Bez nich (albo warpZoomUnify 0) — oddalenie × zoom gracza.
//   arriving        — statek po rampie wyjścia wciąż dolatuje (ślizg z pędem): ujednolicony kadr trzyma się do końca
//                     ślizgu (powrót do zoomu gracza dopiero po nim — cel przylotu zostaje w kadrze)
//   arrivalDist, viewW, viewH — KADR PRZYLOTU (user 2026-10-19: „przy zoomie stałym statek najpierw hamuje, a planeta
//                     powiększa się potem — opóźniona; przy oddalonej kamerze OK”): odległość statku od bliskiego brzegu
//                     tarczy celu [j.] (< 0 — brak celu) i kadr [px]. Od wyjścia ujednolicony zoom nie jest większy niż
//                     ten, przy którym brzeg leży na warpArrivalFill drogi do krawędzi kadru przed dziobem — kamera
//                     odsuwa się w zwolnieniu (sprężyna warpArrivalOmega), planeta rośnie razem z hamowaniem i dolotem
//                     (soczewka świata oddaje ją w trakcie hamowania), przy zatrzymaniu kadr wraca do zoomu odniesienia
//                     (hipercruise gracza karmi te same stany — index.html: updateCameraWarpKick, E5 2026-10-22)
// Wynik w rig: warpZoomLog (człon log(zoom)), warpLagPx, warpShakePx, warpDirX/Y.
export function stepCameraRigWarp(rig, input, tune = CAMERA_RIG_DEFAULTS) {
  const dt = Math.max(0, finite(input.dt, 0));
  const on = input.enabled !== false;
  const P = CAMERA_WARP_PULSES;
  if (input.suspend === true) {
    rig.warpKickPending = false;
    rig.warpExitPending = false;
    rig.warpKickAge = -1;
    rig.warpExitAge = -1;
    rig.warpHold = 1;
    rig.warpRelAge = -1;
    rig.warpUnifyW = 0;
    rig.warpUnifyRelAge = -1;
    rig.warpArrOn = false;
    rig.warpZoomLog = 0;
    rig.warpLagPx = 0;
    rig.warpShakePx = 0;
    rig.warpLeadScale = 1;
    rig.warpAheadK = 0;
    return rig;
  }

  // Wiek impulsów, potem nowe zdarzenia (przy wyłączonym kopie przepadają). Klatka zdarzenia ma
  // wiek 0 — jak efekty warpa „Nurt” (player.js: kickT / exitT = czas klatki, w której automat
  // pierwszy raz pokazał skok / wyjście), więc kamera i efekt idą w tym samym czasie.
  if (rig.warpKickAge >= 0) { rig.warpKickAge += dt; if (rig.warpKickAge > WARP_PULSE_END) rig.warpKickAge = -1; }
  if (rig.warpExitAge >= 0) { rig.warpExitAge += dt; if (rig.warpExitAge > WARP_PULSE_END) rig.warpExitAge = -1; }
  if (rig.warpKickPending) { rig.warpKickPending = false; if (on) rig.warpKickAge = 0; }
  if (rig.warpExitPending) { rig.warpExitPending = false; if (on) rig.warpExitAge = 0; }

  // Kurs (cofnięcie kamery idzie wzdłuż niego).
  const dx = finite(input.dirX, 0);
  const dy = finite(input.dirY, 0);
  const dl = Math.sqrt(dx * dx + dy * dy);
  if (dl > 1e-6) { rig.warpDirX = dx / dl; rig.warpDirY = dy / dl; }

  // Oddalenie na czas ładowania i skoku: mnożnik zoomu liniowo jak `zf` dema — ładowanie
  // lerp(1, warpZoomOut, smoothstep(ładowanie)), skok warpZoomOut, poza nimi 1 (zoom gracza).
  const state = input.state;
  const charge = clamp(finite(input.charge, 0), 0, 1);
  const zoomOut = clamp(finite(tune.warpZoomOut, 1), 0.05, 1);
  let target = 1;
  const exitAge = finite(input.exitAge, -1);
  const exitSlow = Math.max(0.05, finite(input.exitSlow, WARP_EXIT.slow));
  const exitHalt = Math.max(exitSlow, finite(input.exitHalt, exitSlow));
  if (on) {
    if (state === 'active') target = zoomOut;
    else if (state === 'charging') target = 1 + (zoomOut - 1) * smoothstep01(charge);
    // Wyjście: oddalenie zostaje do końca zwolnienia (demo: zoom wraca od wlotu).
    else if (exitAge >= 0 && exitAge < exitSlow) target = Math.min(rig.warpHold, zoomOut);
  }
  // Rulon: statek na środku lejka (ładowanie: × (1 − lejek), lot: 0), przy wyjściu kamera za nim.
  // Bez rulonu (styl skoku — input.rulon === false) w ładowaniu i locie zwykłe wyprzedzenie, jak przed rulonem.
  const rulonOn = input.rulon !== false;
  let leadScale = 1;
  let aheadK = 0;
  if (on) {
    if (state === 'charging') leadScale = rulonOn ? 1 - Math.min(1, warpRulonBend('charging', charge, 0, 0)) : 1;
    else if (state === 'active') leadScale = rulonOn ? 0 : 1;
    else if (exitAge >= 0) {
      const settle = WARP_EXIT.settle;
      aheadK = WARP_EXIT.ahead * smoothRange(exitSlow, exitHalt, exitAge) * (1 - smoothRange(exitHalt, exitHalt + settle, exitAge));
      leadScale = smoothRange(exitHalt, exitHalt + settle, exitAge);
    }
  }
  rig.warpLeadScale = leadScale;
  rig.warpAheadK = aheadK;
  if (target < rig.warpHold - 1e-9) {
    // oddalanie: za celem z limitem tempa (ładowanie — po krzywej dema, skok celu — rampa)
    rig.warpHold = Math.max(target, rig.warpHold - WARP_ZOOM_OUT_RATE * dt);
    rig.warpRelAge = -1;
  } else if (target > rig.warpHold + 1e-9 || rig.warpRelAge >= 0) {
    // powrót do zoomu gracza: easeOut³ w warpZoomReturn s od chwili rozpoczęcia (demo: wyjście
    // lerp(0,55, 1, easeOut³(t / 1,4))); cel czytany co klatkę — jego zmiana nie daje skoku
    // klatka rozpoczęcia ma wiek 0 (jak impuls wyjścia)
    if (rig.warpRelAge < 0) { rig.warpRelAge = 0; rig.warpRelFrom = rig.warpHold; }
    else rig.warpRelAge += dt;
    const u = easeOut3(rig.warpRelAge / Math.max(0.05, finite(tune.warpZoomReturn, 1.4)));
    rig.warpHold = rig.warpRelFrom + (target - rig.warpRelFrom) * u;
    if (u >= 1) { rig.warpHold = target; rig.warpRelAge = -1; }
  }

  // Impulsy: zoom −10% przy skoku, +10% przy wyjściu; cofnięcie kamery przy skoku.
  const kickZoom = rig.warpKickAge >= 0 ? cameraWarpPulse(rig.warpKickAge, P.kickZoomRise, P.kickZoomFall) : 0;
  const exitZoom = rig.warpExitAge >= 0 ? cameraWarpPulse(rig.warpExitAge, P.exitZoomRise, P.exitZoomFall) : 0;
  const f = rig.warpHold
    * (1 - finite(tune.warpZoomKick, 0) * kickZoom)
    * (1 + finite(tune.warpZoomExit, 0) * exitZoom);
  rig.warpZoomLog = f > 0 && f !== 1 ? Math.log(Math.max(1e-3, f)) : 0;
  // Ujednolicony kadr: waga wchodzi z oddaleniem (postęp warpHold 1 → warpZoomOut), trzyma przez skok i przylot do
  // zatrzymania + warpZoomUnifyHold s (zoom wraca od wlotu do zoomRef — przylot jak przy zoomie domyślnym), potem
  // wraca do zoomu gracza (easeOut³ w warpZoomReturn s). Zoom = zoomBase × warpHold × (zoomRef / zoomBase)^waga —
  // przy pełnej wadze zoom gracza zmieniany w skoku kadru nie rusza.
  const span = 1 - zoomOut;
  const inJump = on && (state === 'charging' || state === 'active' || input.arriving === true
    || (exitAge >= 0 && exitAge < exitHalt + Math.max(0, finite(tune.warpZoomUnifyHold, 1))));
  if (inJump && span > 1e-3) {
    rig.warpUnifyW = Math.max(rig.warpUnifyW, clamp((1 - rig.warpHold) / span, 0, 1));
    rig.warpUnifyRelAge = -1;
  } else if (rig.warpUnifyW > 0) {
    if (rig.warpUnifyRelAge < 0) { rig.warpUnifyRelAge = 0; rig.warpUnifyFrom = rig.warpUnifyW; }
    else rig.warpUnifyRelAge += dt;
    const u = easeOut3(rig.warpUnifyRelAge / Math.max(0.05, finite(tune.warpZoomReturn, 1.4)));
    rig.warpUnifyW = rig.warpUnifyFrom * (1 - u);
    if (u >= 1) { rig.warpUnifyW = 0; rig.warpUnifyRelAge = -1; }
  }
  const zRef = finite(input.zoomRef, 0);
  const zBase = finite(input.zoomBase, 0);
  const unify = clamp(finite(tune.warpZoomUnify, 0), 0, 1);
  const unifyOk = unify > 0 && zRef > 0 && zBase > 0;
  // Kadr przylotu: zatrzask od wyjścia (rampa albo ślizg) do końca powrotu wagi ujednolicenia, nowy skok go zdejmuje.
  // Sprężyna prowadzi log zoomu, przy którym bliski brzeg tarczy celu leży na `warpArrivalFill` drogi od statku do
  // krawędzi kadru przed dziobem (statek na ekranie = środek − offset riga, kurs w osiach ekranu); kadr skoku bierze
  // miękkie minimum z nim (kamera tylko się odsuwa). Start sprężyny nad kadrem skoku — zatrzask bez skoku zoomu.
  const B = Math.log(Math.max(1e-9, zRef)) + rig.warpZoomLog;
  const fill = clamp(finite(tune.warpArrivalFill, 0), 0, 0.95);
  const arrDist = finite(input.arrivalDist, -1);
  const vw = finite(input.viewW, 0);
  const vh = finite(input.viewH, 0);
  if (state === 'charging' || state === 'active' || !unifyOk || !(rig.warpUnifyW > 0)) rig.warpArrOn = false;
  else if (!rig.warpArrOn && on && fill > 0 && arrDist >= 0 && vw > 0 && vh > 0
    && (exitAge >= 0 || input.arriving === true)) {
    rig.warpArrOn = true;
    rig.warpArrLog = B + 0.3;
    rig.warpArrVel = 0;
  }
  let arrive = 0;
  if (rig.warpArrOn) {
    if (arrDist >= 0 && vw > 0 && vh > 0) {
      const edge = edgeAheadPx(rig.warpDirX, rig.warpDirY, vw * 0.5, vh * 0.5, -rig.offsetX, -rig.offsetY);
      const target = Math.log(clamp(Math.max(1, edge) * fill / Math.max(1, arrDist), 1e-5, 1e3));
      // Odsuwanie łagodne (ω), dosuwanie za dolotem 3× szybciej — inaczej kamera zostaje w ślizgu ~25% za kadrem
      // i część wzrostu planety przechodzi na czas po zatrzymaniu.
      const omega = Math.max(0.1, finite(tune.warpArrivalOmega, 3)) * (target > rig.warpArrLog ? 3 : 1);
      springAxis(rig, 'warpArrLog', 'warpArrVel', target, omega, dt);
    }
    const d = rig.warpArrLog - B;
    arrive = 0.5 * (d - Math.sqrt(d * d + ARRIVAL_SOFT * ARRIVAL_SOFT));
  }
  if (unifyOk && rig.warpUnifyW > 0) {
    rig.warpZoomLog += rig.warpUnifyW * unify * (Math.log(zRef / zBase) + arrive);
  }
  rig.warpLagPx = rig.warpKickAge >= 0
    ? Math.max(0, finite(tune.warpKickPx, 0)) * cameraWarpPulse(rig.warpKickAge, P.lagRise, P.lagFall)
    : 0;
  // Drżenie w drugiej połowie ładowania (wstrząs kopu i wyjścia to camera.addShake — warp „Nurt”).
  rig.warpShakePx = on && state === 'charging'
    ? Math.max(0, finite(tune.warpChargeShakePx, 0)) * smoothstep01((charge - 0.5) / 0.5)
    : 0;
  return rig;
}

// Kadr przylotu: miękkość minimum zoomu skoku i kadru celu [log zoomu].
const ARRIVAL_SOFT = 0.1;

// Odległość od statku (sx, sy — px od środka kadru, y w dół) do krawędzi kadru hw × hh wzdłuż (ux, uy) [px].
function edgeAheadPx(ux, uy, hw, hh, sx, sy) {
  const tx = ux > 1e-9 ? (hw - sx) / ux : (ux < -1e-9 ? (-hw - sx) / ux : Infinity);
  const ty = uy > 1e-9 ? (hh - sy) / uy : (uy < -1e-9 ? (-hh - sy) / uy : Infinity);
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

// Kąt do przedziału (−π, π].
function wrapPi(a) {
  const t = a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
  return t <= -Math.PI ? t + Math.PI * 2 : t;
}

export const CAMERA_WARP_ROLL_MODES = Object.freeze(['up', 'right', 'off']);

// Opcja „Kamera w hipercruisie” (menu → Sterowanie, localStorage sc_camera_hyper_roll; 2026-10-23, zgłoszenie
// użytkownika: „odpalenie hipercruise = przestawienie kamery za statkiem”): 'up' — kadr kursem w górę (domyślnie),
// 'off' — północ w górę jak w zwykłym locie; 'right' (kurs w prawo) tylko z adresu `?hcKamera=right` (A/B).
export function normalizeCameraHyperRollMode(mode) {
  return CAMERA_WARP_ROLL_MODES.includes(mode) ? mode : 'up';
}

// OBRÓT KADRU W SKOKU (user 2026-10-19: „obracajmy kamerę na czas warpu w kierunku lotu — możemy wtedy lepiej
// bawić się tym, co jest przed nami”; demo „Pęd”, dema/warp-ped.html). Od startu ładowania do `warpRollHold` s po
// zatrzymaniu na rampie wyjścia kadr obraca się KURSEM W GÓRĘ ekranu (mode 'up': roll = kurs + π/2; 'right' — kurs
// w prawo, wzdłuż dłuższego boku kadru: roll = kurs; 'off' — bez obrotu), potem wraca do północy (roll 0).
// Sprężyna krytyczna na kącie (`warpRollOmega`), najkrótszą drogą, dokładna w kroku — nie zależy od FPS.
// input: dt (czas gry tej klatki; w pauzie 0 — stoi), state ('idle' | 'charging' | 'active'), dirX, dirY (kurs skoku),
//        exitAge, exitHalt (rampa wyjścia — jak stepCameraRigWarp), arriving (ślizg z pędem po rampie — kurs trzymany
//        do końca ślizgu), hold (kurs trzymany — np. hamowanie wyjścia z hipercruise'u w grze, 2026-10-23; po nim
//        wołający podaje exitAge od końca hamowania z exitHalt 0), enabled (kamera statku), mode, omega (opcjonalnie —
//        sprężyna tego wejścia [1/s]; warp gracza w grze: warpJumpRollOmega).
// Wynik: rig.roll [rad] — kamera gry `cam.roll` (src/3d/viewRoll.js: ekran = R(−roll)·(świat − kamera)). Rig
// liczy wyprzedzenie i kop w osiach EKRANU: wołający obraca prędkość i kurs o −roll, a offset o +roll.
export function stepCameraRigRoll(rig, input, tune = CAMERA_RIG_DEFAULTS) {
  const dt = Math.max(0, finite(input.dt, 0));
  const mode = CAMERA_WARP_ROLL_MODES.includes(input.mode) ? input.mode : 'up';
  const exitAge = finite(input.exitAge, -1);
  const inWarp = input.state === 'charging' || input.state === 'active' || input.arriving === true || input.hold === true
    || (exitAge >= 0 && exitAge < finite(input.exitHalt, 0) + finite(tune.warpRollHold, 0.5));
  const on = input.enabled !== false && mode !== 'off' && inWarp;
  let target = 0;
  if (on) {
    const course = Math.atan2(finite(input.dirY, 0), finite(input.dirX, 1));
    target = mode === 'right' ? course : course + Math.PI * 0.5;
  }
  const cur = finite(rig.roll, 0);
  rig.rollVel = finite(rig.rollVel, 0);
  // input.omega — sprężyna tego wejścia (warp gracza: warpJumpRollOmega), inaczej warpRollOmega strojenia.
  const omega = finite(input.omega, 0) > 0 ? input.omega : finite(tune.warpRollOmega, 3.2);
  springAxis(rig, 'roll', 'rollVel', cur + wrapPi(target - cur), Math.max(0.1, omega), dt);
  // Kąt bez narastania (pełne obroty niewidoczne); po powrocie dokładne zero — kadr osiami świata jak dawniej.
  if (Math.abs(rig.roll) > Math.PI) rig.roll = wrapPi(rig.roll);
  if (!on && Math.abs(rig.roll) < 1e-4 && Math.abs(rig.rollVel) < 1e-3) {
    rig.roll = 0;
    rig.rollVel = 0;
  }
  return rig;
}

// Zoom, przy którym kadłub o długości `hullLength` zajmuje `hullScreenFraction` szerokości.
export function defaultShipZoom(viewW, hullLength, tune = CAMERA_RIG_DEFAULTS, minZoom = 0.035, maxZoom = 3.2) {
  const len = Math.max(1, finite(hullLength, 1));
  const zoom = finite(tune.hullScreenFraction, CAMERA_RIG_DEFAULTS.hullScreenFraction) * finite(viewW, 1) / len;
  return clamp(zoom, minZoom, maxZoom);
}

// Amplituda wstrząsu w px: camera.addShake (bieżące mag po wygaszaniu)
// + wstrząs strzałów z WeaponFx (window.__weapon3dCameraShake) + `extraPx` wprost w px
// (drżenie ładowania warpa: rig.warpShakePx), z sufitem.
export function cameraShakeAmplitudePx(cameraMag, weaponMag, tune = CAMERA_RIG_DEFAULTS, extraPx = 0) {
  const a = Math.max(0, finite(cameraMag, 0)) * tune.shakeScale
    + Math.max(0, finite(weaponMag, 0)) * tune.weaponShakeScale
    + Math.max(0, finite(extraPx, 0));
  return Math.min(Math.max(0, tune.shakeMaxPx), a);
}

// Kopnięcie kadru od strzału (sprężyna tłumiona w px ekranu): stan { x, y, vx, vy }.
const KICK_PEAK_INV = 1.92;
export function createCameraKick() {
  return { x: 0, y: 0, vx: 0, vy: 0 };
}

// Strzał gracza w kierunku (dirX, dirY) [świat = ekran, y w dół] bronią o wstrząsie `shake` (pole broni × ułamek
// grupy — wieże na auto ściszone) i przeładowaniu `cooldown` [s]: impuls prędkości, którego szczyt wychylenia ≈
// kopnięcie strzału. Szybkostrzelne (Goliath, Plasma Gatling) kopią słabiej — × clamp(cooldown / 1 s, ¼, 1), inaczej
// seria trzymałaby kadr przesunięty. Zwraca px.
export function addCameraKick(kick, dirX, dirY, shake, tune = CAMERA_RIG_DEFAULTS, cooldown = 1) {
  const rate = Math.min(1, Math.max(0.25, finite(cooldown, 1)));
  const px = Math.min(Math.max(0, finite(tune.weaponKickShotMaxPx, 14)),
    (finite(shake, 0) - finite(tune.weaponKickMin, 5)) * Math.max(0, finite(tune.weaponKickPerShake, 0))) * rate;
  if (!(px > 0)) return 0;
  const l = Math.sqrt(dirX * dirX + dirY * dirY);
  if (!(l > 1e-9)) return 0;
  const w = 2 * Math.PI * Math.max(0.5, finite(tune.weaponKickHz, 5));
  // Szczyt odpowiedzi sprężyny na impuls v0 to v0/ω · e^(−ζ·atan(√(1−ζ²)/ζ)/√(1−ζ²)) ≈ 0,52 · v0/ω przy ζ = 0,55.
  const v = px * w * KICK_PEAK_INV * (finite(tune.weaponKickSign, 1) < 0 ? -1 : 1) / l;
  kick.vx += dirX * v;
  kick.vy += dirY * v;
  // Salwa wielu wież: prędkość nie większa niż ta, która dociągnęłaby do sufitu wychylenia.
  const vmax = Math.max(0, finite(tune.weaponKickMaxPx, 16)) * w * KICK_PEAK_INV;
  const vl = Math.sqrt(kick.vx * kick.vx + kick.vy * kick.vy);
  if (vl > vmax) { kick.vx *= vmax / vl; kick.vy *= vmax / vl; }
  return px;
}

// Krok sprężyny — rozwiązanie dokładne oscylatora tłumionego (ζ < 1), więc ten sam ruch przy każdym FPS;
// wychylenie z sufitem. Zwraca stan.
export function stepCameraKick(kick, dt, tune = CAMERA_RIG_DEFAULTS) {
  const h = Math.min(0.1, Math.max(0, finite(dt, 0)));
  if (h <= 0 || (kick.x === 0 && kick.y === 0 && kick.vx === 0 && kick.vy === 0)) return kick;
  const w = 2 * Math.PI * Math.max(0.5, finite(tune.weaponKickHz, 5));
  const z = Math.min(0.95, Math.max(0.05, finite(tune.weaponKickDamping, 0.55)));
  const a = z * w;
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-a * h);
  const c = Math.cos(wd * h);
  const s = Math.sin(wd * h);
  const max = Math.max(0, finite(tune.weaponKickMaxPx, 16));
  const bx = (kick.vx + a * kick.x) / wd;
  const by = (kick.vy + a * kick.y) / wd;
  const x = e * (kick.x * c + bx * s);
  const y = e * (kick.y * c + by * s);
  kick.vx = e * (kick.vx * c - (wd * kick.x + a * bx) * s);
  kick.vy = e * (kick.vy * c - (wd * kick.y + a * by) * s);
  kick.x = x;
  kick.y = y;
  const r = Math.sqrt(kick.x * kick.x + kick.y * kick.y);
  if (r > max) { kick.x *= max / r; kick.y *= max / r; }
  if (r < 0.02 && Math.abs(kick.vx) + Math.abs(kick.vy) < 0.5) { kick.x = 0; kick.y = 0; kick.vx = 0; kick.vy = 0; }
  return kick;
}

// Gładki szum wstrząsu (dwie sinusoidy na oś o niewspółmiernych częstotliwościach):
// w przedziale ±amplitude, ciągły w czasie — nie biały szum losowany co klatkę.
export function sampleCameraShakePx(amplitude, timeSec, tune = CAMERA_RIG_DEFAULTS, out = { x: 0, y: 0 }) {
  const a = Math.max(0, finite(amplitude, 0));
  if (a <= 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const w = 2 * Math.PI * Math.max(0.1, finite(tune.shakeHz, 12));
  const t = finite(timeSec, 0);
  out.x = a * (0.6 * Math.sin(w * t + 1.3) + 0.4 * Math.sin(w * 1.73 * t + 4.1));
  out.y = a * (0.6 * Math.sin(w * 1.19 * t + 2.7) + 0.4 * Math.sin(w * 2.07 * t + 0.4));
  return out;
}
