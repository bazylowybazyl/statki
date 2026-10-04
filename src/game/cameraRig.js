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
  // Wstrząs (px ekranu)
  shakeScale: 0.5,      // camera.addShake(mag) → mag × to px
  weaponShakeScale: 0.12, // wstrząs strzałów (WeaponFx, window.__weapon3dCameraShake) → mag × to px
  shakeMaxPx: 16,
  shakeHz: 12,
  // Zoom startowy: kadłub zajmuje taki ułamek szerokości ekranu
  hullScreenFraction: 0.2,
  // Kop warpa (demo „Nurt”, createTripScene — liczby dema). 0 / 1 wyłącza człon.
  warpKickPx: 140,        // cofnięcie kamery przy skoku: 140 px × impuls(0,05 / 0,42 s) — szczyt ~96 px po 0,11 s (px przy kadrze 1080 wierszy)
  warpZoomOut: 0.55,      // zoom na czas ładowania i skoku (× zoom gracza); 1 = bez oddalenia
  warpZoomKick: 0.1,      // impuls zoomu przy skoku: × (1 − 0,1 · impuls(0,04 / 0,25 s))
  warpZoomExit: 0.1,      // impuls zoomu przy wyjściu: × (1 + 0,1 · impuls(0,03 / 0,18 s))
  warpZoomReturn: 1.4,    // s powrotu do zoomu gracza po wyjściu (easeOut³, liniowo w zoomie jak w demie)
  warpChargeShakePx: 4    // drżenie w drugiej połowie ładowania [px] (demo: 4 · smooth(0,5, 1, ładowanie))
});

// Zakresy dla panelu strojenia i sanitizacji zapisu.
export const CAMERA_RIG_RANGES = Object.freeze({
  navLook: [0, 1],
  navLead: [0, 0.8],
  navOmega: [0.5, 20],
  leadSpeedRef: [0.02, 2],
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
  shakeScale: [0, 3],
  weaponShakeScale: [0, 2],
  shakeMaxPx: [0, 80],
  shakeHz: [1, 40],
  hullScreenFraction: [0.03, 0.9],
  warpKickPx: [0, 400],
  warpZoomOut: [0.3, 1],
  warpZoomKick: [0, 0.3],
  warpZoomExit: [0, 0.3],
  warpZoomReturn: [0.2, 4],
  warpChargeShakePx: [0, 16]
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

// Wspólne strojenie gry: czyta je render(), pisze panel dev (src/ui/cameraTunerPanel.js).
// Jeden obiekt w instancji modułu — kolejność startu gry i panelu nie ma znaczenia.
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
//   lookFrozen         — true: trzymaj ostatni punkt patrzenia
//   lookEnabled        — false: kursor nie rusza kamerą (split-screen)
//   velX, velY         — prędkość statku (j/s), maxSpeed — v_max trybu napędu
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
  } else if (!input.lookFrozen) {
    rig.lookNX = clamp((finite(input.mouseX, halfW) - halfW) / halfW, -1.5, 1.5);
    rig.lookNY = clamp((finite(input.mouseY, halfH) - halfH) / halfH, -1.5, 1.5);
  }
  const lookGain = tune.navLook + (tune.combatLook - tune.navLook) * w;
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
  const leadGain = tune.navLead + (tune.combatLead - tune.navLead) * w;
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
  const maxY = halfH * 2 * (0.5 - margin);
  // Rulon warpa: statek na środku lejka (stepCameraRigWarp: warpLeadScale).
  const leadScale = clamp(finite(rig.warpLeadScale, 1), 0, 1);
  const targetX = clamp((lookX + leadX) * leadScale, -maxX, maxX);
  const targetY = clamp((lookY + leadY) * leadScale, -maxY, maxY);
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
  if (rig.springY > maxY) { rig.springY = maxY; if (rig.velY > 0) rig.velY = 0; }
  else if (rig.springY < -maxY) { rig.springY = -maxY; if (rig.velY < 0) rig.velY = 0; }

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
  rig.offsetX = clamp(rig.springX - wdx * lag, -maxX, maxX);
  rig.offsetY = clamp(rig.springY - wdy * lag, -maxY, maxY);
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
  let leadScale = 1;
  let aheadK = 0;
  if (on) {
    if (state === 'charging') leadScale = 1 - Math.min(1, warpRulonBend('charging', charge, 0, 0));
    else if (state === 'active') leadScale = 0;
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
  rig.warpLagPx = rig.warpKickAge >= 0
    ? Math.max(0, finite(tune.warpKickPx, 0)) * cameraWarpPulse(rig.warpKickAge, P.lagRise, P.lagFall)
    : 0;
  // Drżenie w drugiej połowie ładowania (wstrząs kopu i wyjścia to camera.addShake — warp „Nurt”).
  rig.warpShakePx = on && state === 'charging'
    ? Math.max(0, finite(tune.warpChargeShakePx, 0)) * smoothstep01((charge - 0.5) / 0.5)
    : 0;
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
