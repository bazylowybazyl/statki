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
// Dawniej (do 2026-09-27) kamera brała 2× odległość kursora od środka bez
// limitu i bez wygładzania: statek wypadał z kadru, gdy kursor odjechał o ćwierć
// ekranu (270 px w pionie przy 1080 p), a świat pod kursorem jechał 3× szybciej
// niż ręka.

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
  hullScreenFraction: 0.2
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
  hullScreenFraction: [0.03, 0.9]
});

export const CAMERA_LOOK_MODES = Object.freeze(['auto', 'always', 'never']);

export function normalizeCameraLookMode(mode) {
  return CAMERA_LOOK_MODES.includes(mode) ? mode : 'auto';
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
    // Offset kamery względem statku w px ekranu (kamera przed statkiem) i jego prędkość.
    offsetX: 0,
    offsetY: 0,
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
    targetY: 0
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
  const r = Math.hypot(rig.lookNX, rig.lookNY);
  if (lookGain > 0 && r > 1e-6) {
    const mag = cameraLookMagnitude(r, tune.lookDeadZone, tune.lookExponent) * lookGain;
    lookX = (rig.lookNX / r) * mag * halfW;
    lookY = (rig.lookNY / r) * mag * halfH;
  }

  // --- Wyprzedzenie z prędkości ---
  const vx = finite(input.velX, 0);
  const vy = finite(input.velY, 0);
  const speed = Math.hypot(vx, vy);
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
  const targetX = clamp(lookX + leadX, -maxX, maxX);
  const targetY = clamp(lookY + leadY, -maxY, maxY);
  rig.targetX = targetX;
  rig.targetY = targetY;

  // --- Sprężyna ---
  const omega = Math.max(0.05, tune.navOmega + (tune.combatOmega - tune.navOmega) * w);
  if (h > 0) {
    springAxis(rig, 'offsetX', 'velX', targetX, omega, h);
    springAxis(rig, 'offsetY', 'velY', targetY, omega, h);
  }
  // Gwarancja kadru także w trakcie ruchu (przestrzał z rozpędu, zmiana okna).
  if (rig.offsetX > maxX) { rig.offsetX = maxX; if (rig.velX > 0) rig.velX = 0; }
  else if (rig.offsetX < -maxX) { rig.offsetX = -maxX; if (rig.velX < 0) rig.velX = 0; }
  if (rig.offsetY > maxY) { rig.offsetY = maxY; if (rig.velY > 0) rig.velY = 0; }
  else if (rig.offsetY < -maxY) { rig.offsetY = -maxY; if (rig.velY < 0) rig.velY = 0; }
  return rig;
}

// Zoom, przy którym kadłub o długości `hullLength` zajmuje `hullScreenFraction` szerokości.
export function defaultShipZoom(viewW, hullLength, tune = CAMERA_RIG_DEFAULTS, minZoom = 0.035, maxZoom = 3.2) {
  const len = Math.max(1, finite(hullLength, 1));
  const zoom = finite(tune.hullScreenFraction, CAMERA_RIG_DEFAULTS.hullScreenFraction) * finite(viewW, 1) / len;
  return clamp(zoom, minZoom, maxZoom);
}

// Amplituda wstrząsu w px: camera.addShake (bieżące mag po wygaszaniu)
// + wstrząs strzałów z WeaponFx (window.__weapon3dCameraShake), z sufitem.
export function cameraShakeAmplitudePx(cameraMag, weaponMag, tune = CAMERA_RIG_DEFAULTS) {
  const a = Math.max(0, finite(cameraMag, 0)) * tune.shakeScale
    + Math.max(0, finite(weaponMag, 0)) * tune.weaponShakeScale;
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
