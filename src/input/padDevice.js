// ============================================================
// Pady — warstwa urządzeń (docs/PLAN-pad.md § 4, etap 1). Moduł czysty: bez DOM i okna gry — funkcję odczytu
// dostaje z zewnątrz (gra: () => navigator.getGamepads(), testy: atrapa).
//
//   const dev = createPadDevice({ read: () => navigator.getGamepads?.() });
//   dev.update(nowMs);                 // RAZ na klatkę rAF (getGamepads w Chrome to migawka — nie trzymamy obiektów)
//   dev.down[i], dev.pressed[i] …      // i = slot * PAD_BUTTONS + przycisk (PB.A …)
//   dev.stick[slot * 4 + 0..3]         // LS x, LS y, RS x, RS y po martwej strefie promieniowej i krzywej
//
// Co liczy: mapowanie `standard` (indeksy jak w W3C Gamepad; tabela znanych niestandardowych — `remaps`),
// martwe strefy PROMIENIOWE z przeskalowaniem (bez skoku przy wyjściu ze strefy) i krzywe, spusty z histerezą
// (wartość analogowa, nie `pressed` przeglądarki), zbocza wciśnięcia / puszczenia, stuknięcie / przytrzymanie /
// podwójne w czasie rzeczywistym (ms z rAF), rodzinę pada z `pad.id` (ikony — etap 5), podłączenie i odłączenie
// (z odpytywania — jedno źródło prawdy z resztą stanu), AKTYWNY pad (ostatnia aktywność, nie indeks 0 —
// urządzenia-widma ze stałym wychyleniem osi nie przejmują go, bo aktywność to zbocza).
// Zero alokacji na klatkę po naszej stronie (tablice typowane, bez domknięć w update).
// ============================================================

export const PAD_SLOTS = 4;
export const PAD_BUTTONS = 17;   // mapowanie standard: 0..16
export const PAD_AXES = 4;

/** Przyciski w mapowaniu `standard` (W3C). Nazwy Xbox; PlayStation: A ✕, B ○, X □, Y △, LB L1 … */
export const PB = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16
});

export const PAD_FAMILY = Object.freeze({ GENERIC: 0, XBOX: 1, PLAYSTATION: 2, NINTENDO: 3 });
export const PAD_FAMILY_IDS = Object.freeze(['generic', 'xbox', 'playstation', 'nintendo']);

export const PAD_TUNE = Object.freeze({
  // gałki: martwa strefa wewnętrzna / zewnętrzna (promieniowo) i wykładnik krzywej modułu (1 = liniowo);
  // krzywe osobno dla ciągu i obrotu — inputActions (oś akcji), tu wspólna dla gałki
  leftInner: 0.12, leftOuter: 0.95, leftCurve: 1,
  rightInner: 0.10, rightOuter: 0.95, rightCurve: 1,
  // spusty (LT / RT): wciśnięty powyżej `triggerOn`, puszczony poniżej `triggerOff`
  triggerOn: 0.35, triggerOff: 0.25,
  // stuknięcie = puszczone przed `tapMs`; przytrzymanie = trzymane dłużej; podwójne = drugie stuknięcie
  // w `doubleMs` od poprzedniego
  tapMs: 250,
  doubleMs: 300,
  // aktywność pada (wybór aktywnego): wciśnięcie przycisku albo przejście gałki przez ten próg
  activityStick: 0.5
});

const TRIGGER_MASK = (1 << PB.LT) | (1 << PB.RT);

/** Rodzina pada z `Gamepad.id` (Chrome: „… (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)”). */
export function padFamilyFromId(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return PAD_FAMILY.GENERIC;
  if (/xinput|xbox|vendor: ?045e|^045e-/.test(s)) return PAD_FAMILY.XBOX;
  if (/vendor: ?054c|^054c-|dualsense|dualshock|playstation|wireless controller/.test(s)) return PAD_FAMILY.PLAYSTATION;
  if (/vendor: ?057e|^057e-|nintendo|pro controller|joy-con/.test(s)) return PAD_FAMILY.NINTENDO;
  return PAD_FAMILY.GENERIC;
}

/**
 * Martwa strefa PROMIENIOWA z przeskalowaniem: moduł (x, y) w [inner, outer] → [0, 1], potem krzywa
 * (moduł^curve). Kierunek bez zmian. Wynik do out[o], out[o + 1]; zwraca moduł po krzywej.
 */
export function radialDeadzone(x, y, inner, outer, curve, out, o = 0) {
  const m = Math.sqrt(x * x + y * y);
  if (!(m > inner)) { out[o] = 0; out[o + 1] = 0; return 0; }
  const span = outer > inner ? outer - inner : 1e-6;
  let t = (m - inner) / span;
  if (t > 1) t = 1;
  const k = curve === 1 ? t : Math.pow(t, curve);
  const s = k / m;
  out[o] = x * s;
  out[o + 1] = y * s;
  return k;
}

/** Krzywa odpowiedzi jednej osi: znak × |v|^wykładnik (precyzja przy małym wychyleniu). */
export function axisCurve(v, exp = 1) {
  if (!v) return 0;
  if (exp === 1) return v;
  return v < 0 ? -Math.pow(-v, exp) : Math.pow(v, exp);
}

// Tabela znanych padów bez mapowania `standard`: { test: RegExp na id, buttons: [źródło dla przycisku standard],
// axes: [źródło dla osi standard] }. Pusta — wpisy dopiero z prawdziwego pada (etap 7: przypisanie ręczne).
export const PAD_REMAPS = Object.freeze([]);

function clampAxis(v) {
  const n = Number(v);
  if (!(n === n)) return 0;   // NaN
  return n < -1 ? -1 : (n > 1 ? 1 : n);
}

/**
 * @param {{ read?: () => ArrayLike<any>|null, tune?: object, remaps?: Array }} [opts]
 */
export function createPadDevice(opts = {}) {
  const S = PAD_SLOTS;
  const NB = PAD_BUTTONS;
  const NA = PAD_AXES;
  const N = S * NB;
  const tune = { ...PAD_TUNE, ...(opts.tune || {}) };
  const remaps = opts.remaps || PAD_REMAPS;
  const remapOf = new Array(S).fill(null);

  const dev = {
    tune,
    read: typeof opts.read === 'function' ? opts.read : null,
    now: 0,
    dt: 0,
    frame: 0,
    // sloty (indeks z Gamepad.index)
    connected: new Uint8Array(S),
    connectedNow: new Uint8Array(S),     // zbocze podłączenia w tej klatce
    disconnectedNow: new Uint8Array(S),
    standard: new Uint8Array(S),         // mapping === 'standard'
    family: new Uint8Array(S),
    ids: new Array(S).fill(''),
    lastActive: new Float64Array(S).fill(-Infinity),
    stickActiveSince: new Float64Array(S).fill(-1),   // LS poza martwą strefą od (ms), −1 = w strefie
    active: -1,                          // aktywny pad (ostatnia aktywność)
    changes: 0,                          // licznik zmian podłączenia (UI)
    // przyciski: i = slot * PAD_BUTTONS + b
    value: new Float32Array(N),
    down: new Uint8Array(N),
    pressed: new Uint8Array(N),          // zbocze wciśnięcia w tej klatce
    released: new Uint8Array(N),
    tapped: new Uint8Array(N),           // puszczone przed tapMs (w tej klatce)
    doubled: new Uint8Array(N),          // drugie stuknięcie w doubleMs
    holdStart: new Uint8Array(N),        // przekroczyło tapMs w tej klatce (początek przytrzymania)
    downAt: new Float64Array(N),
    heldMs: new Float64Array(N),         // czas trzymania (0 = puszczony)
    prevHeldMs: new Float64Array(N),
    lastTapAt: new Float64Array(N).fill(-Infinity),
    // osie: surowe (bieżące i z poprzedniej klatki) i gałki po strefie i krzywej
    raw: new Float32Array(S * NA),
    prevRaw: new Float32Array(S * NA),
    stick: new Float32Array(S * 4),
    stickMag: new Float32Array(S * 2),
    prevStickMag: new Float32Array(S * 2),

    /** Odczyt urządzeń i cały stan na tę klatkę. `pads` — wynik getGamepads (domyślnie z `read`). */
    update(nowMs, pads = dev.read ? dev.read() : null) {
      const now = Number(nowMs) || 0;
      dev.dt = dev.frame > 0 ? Math.max(0, now - dev.now) : 0;
      dev.now = now;
      dev.frame++;
      dev.pressed.fill(0);
      dev.released.fill(0);
      dev.tapped.fill(0);
      dev.doubled.fill(0);
      dev.holdStart.fill(0);
      dev.connectedNow.fill(0);
      dev.disconnectedNow.fill(0);
      for (let s = 0; s < S; s++) {
        const p = pads ? pads[s] : null;
        const ok = !!p && p.connected !== false;
        if (!ok) {
          if (dev.connected[s]) disconnect(s);
          continue;
        }
        const id = typeof p.id === 'string' ? p.id : '';
        if (dev.connected[s] && dev.ids[s] !== id) disconnect(s);   // inne urządzenie w tym slocie
        const fresh = !dev.connected[s];
        if (fresh) connect(s, p, id, now);
        readPad(s, p, now, fresh);
      }
      if (dev.active >= 0 && !dev.connected[dev.active]) dev.active = pickActive(-1);
      return dev;
    },

    /** Utrata fokusu / ukrycie karty: stan przycisków od zera (bez zboczy), gałki w spoczynku. */
    clear() {
      dev.value.fill(0);
      dev.down.fill(0);
      dev.pressed.fill(0);
      dev.released.fill(0);
      dev.tapped.fill(0);
      dev.doubled.fill(0);
      dev.holdStart.fill(0);
      dev.heldMs.fill(0);
      dev.prevHeldMs.fill(0);
      dev.raw.fill(0);
      dev.prevRaw.fill(0);
      dev.stick.fill(0);
      dev.stickMag.fill(0);
      dev.prevStickMag.fill(0);
      dev.stickActiveSince.fill(-1);
    },

    // --- zapytania (slot −1 = brak pada → fałsz / 0) ---
    isDown(slot, b) { return slot >= 0 && dev.down[slot * NB + b] === 1; },
    wasPressed(slot, b) { return slot >= 0 && dev.pressed[slot * NB + b] === 1; },
    wasReleased(slot, b) { return slot >= 0 && dev.released[slot * NB + b] === 1; },
    wasTapped(slot, b) { return slot >= 0 && dev.tapped[slot * NB + b] === 1; },
    wasDoubled(slot, b) { return slot >= 0 && dev.doubled[slot * NB + b] === 1; },
    holdStarted(slot, b) { return slot >= 0 && dev.holdStart[slot * NB + b] === 1; },
    holdTime(slot, b) { return slot >= 0 ? dev.heldMs[slot * NB + b] : 0; },
    /** Trzymany przycisk przekroczył `ms` w tej klatce (przytrzymanie z własnym progiem: B 0,6 s, Y 0,5 s …). */
    crossed(slot, b, ms) {
      if (slot < 0) return false;
      const i = slot * NB + b;
      return dev.down[i] === 1 && dev.prevHeldMs[i] < ms && dev.heldMs[i] >= ms;
    },
    /** Gałka po strefie i krzywej: 0 LS x, 1 LS y, 2 RS x, 3 RS y (y w dół dodatnie, jak w Gamepad API). */
    axis(slot, a) { return slot >= 0 ? dev.stick[slot * 4 + a] : 0; },
    /** Surowa oś przeszła przez próg `t` (t > 0: w górę przez +t, t < 0: w dół przez t) w tej klatce. */
    rawCrossed(slot, a, t) {
      if (slot < 0) return false;
      const i = slot * NA + a;
      const v = dev.raw[i];
      const p = dev.prevRaw[i];
      return t > 0 ? (v > t && p <= t) : (v < t && p >= t);
    },
    /** Ile ms LS jest poza martwą strefą bez przerwy (0 = w strefie). */
    stickActiveMs(slot) {
      if (slot < 0) return 0;
      const since = dev.stickActiveSince[slot];
      return since < 0 ? 0 : dev.now - since;
    }
  };

  function connect(s, p, id, now) {
    dev.connected[s] = 1;
    dev.connectedNow[s] = 1;
    dev.ids[s] = id;
    dev.family[s] = padFamilyFromId(id);
    dev.standard[s] = p.mapping === 'standard' ? 1 : 0;
    remapOf[s] = null;
    if (!dev.standard[s]) {
      for (let k = 0; k < remaps.length; k++) {
        if (remaps[k] && remaps[k].test && remaps[k].test.test(id)) { remapOf[s] = remaps[k]; break; }
      }
    }
    dev.changes++;
    // nowy pad: stan od zera, pierwsza klatka bez zboczy (przycisk, który „pokazał” pad przeglądarce, nie strzela)
    resetSlot(s);
    dev.lastActive[s] = now;
    if (dev.active < 0) dev.active = s;
  }

  function disconnect(s) {
    dev.connected[s] = 0;
    dev.disconnectedNow[s] = 1;
    dev.ids[s] = '';
    remapOf[s] = null;
    dev.changes++;
    // puszczenie wszystkiego, co było wciśnięte (zbocza — gra puszcza akcje)
    for (let b = 0; b < NB; b++) {
      const i = s * NB + b;
      if (dev.down[i]) dev.released[i] = 1;
    }
    resetSlot(s);
    dev.lastActive[s] = -Infinity;
    if (dev.active === s) dev.active = pickActive(s);
  }

  function resetSlot(s) {
    const b0 = s * NB;
    for (let i = b0; i < b0 + NB; i++) {
      dev.value[i] = 0; dev.down[i] = 0; dev.heldMs[i] = 0; dev.prevHeldMs[i] = 0; dev.lastTapAt[i] = -Infinity;
    }
    for (let a = 0; a < NA; a++) { dev.raw[s * NA + a] = 0; dev.prevRaw[s * NA + a] = 0; }
    for (let a = 0; a < 4; a++) dev.stick[s * 4 + a] = 0;
    dev.stickMag[s * 2] = 0; dev.stickMag[s * 2 + 1] = 0;
    dev.prevStickMag[s * 2] = 0; dev.prevStickMag[s * 2 + 1] = 0;
    dev.stickActiveSince[s] = -1;
  }

  // Aktywny pad po odłączeniu: najświeższa aktywność wśród podłączonych (bez `skip`).
  function pickActive(skip) {
    let best = -1;
    let bestT = -Infinity;
    for (let s = 0; s < S; s++) {
      if (s === skip || !dev.connected[s]) continue;
      if (best < 0 || dev.lastActive[s] > bestT) { best = s; bestT = dev.lastActive[s]; }
    }
    return best;
  }

  function readPad(s, p, now, fresh) {
    const map = remapOf[s];
    const buttons = p.buttons;
    const axes = p.axes;
    const nb = buttons ? buttons.length : 0;
    const na = axes ? axes.length : 0;
    const tapMs = tune.tapMs;
    let activity = false;
    for (let b = 0; b < NB; b++) {
      const src = map && map.buttons ? map.buttons[b] : b;
      const bt = src >= 0 && src < nb ? buttons[src] : null;
      let v = 0;
      let pr = false;
      if (bt != null) {
        if (typeof bt === 'object') {
          v = Number(bt.value) || 0;
          pr = !!bt.pressed;
          if (pr && v <= 0) v = 1;
        } else {
          v = Number(bt) || 0;
          pr = v >= 0.5;
        }
      }
      const i = s * NB + b;
      const was = dev.down[i] === 1;
      let now1;
      if ((TRIGGER_MASK >> b) & 1) now1 = was ? v > tune.triggerOff : v > tune.triggerOn;
      else now1 = pr;
      dev.value[i] = v;
      dev.prevHeldMs[i] = dev.heldMs[i];
      if (fresh) {
        // pierwsza klatka nowego pada: bieżący stan bez zboczy; przycisk trzymany przy podłączeniu (ten, który
        // „pokazał” pad przeglądarce) nie da ani stuknięcia, ani przytrzymania — tylko puszczenie
        dev.down[i] = now1 ? 1 : 0;
        dev.downAt[i] = now1 ? -Infinity : now;
        dev.heldMs[i] = now1 ? Infinity : 0;
        continue;
      }
      if (now1 && !was) {
        dev.down[i] = 1;
        dev.pressed[i] = 1;
        dev.downAt[i] = now;
        dev.heldMs[i] = 0;
        activity = true;
      } else if (!now1 && was) {
        dev.down[i] = 0;
        dev.released[i] = 1;
        const held = now - dev.downAt[i];
        dev.heldMs[i] = 0;
        if (held < tapMs) {
          dev.tapped[i] = 1;
          if (now - dev.lastTapAt[i] <= tune.doubleMs) {
            dev.doubled[i] = 1;
            dev.lastTapAt[i] = -Infinity;
          } else {
            dev.lastTapAt[i] = now;
          }
        }
      } else if (now1) {
        const held = now - dev.downAt[i];
        dev.heldMs[i] = held;
        if (dev.prevHeldMs[i] < tapMs && held >= tapMs) dev.holdStart[i] = 1;
      }
    }
    // osie
    for (let a = 0; a < NA; a++) {
      const src = map && map.axes ? map.axes[a] : a;
      const i = s * NA + a;
      dev.prevRaw[i] = fresh ? (src >= 0 && src < na ? clampAxis(axes[src]) : 0) : dev.raw[i];
      dev.raw[i] = src >= 0 && src < na ? clampAxis(axes[src]) : 0;
    }
    const r = s * NA;
    const o = s * 4;
    dev.prevStickMag[s * 2] = dev.stickMag[s * 2];
    dev.prevStickMag[s * 2 + 1] = dev.stickMag[s * 2 + 1];
    const ml = radialDeadzone(dev.raw[r], dev.raw[r + 1], tune.leftInner, tune.leftOuter, tune.leftCurve, dev.stick, o);
    const mr = radialDeadzone(dev.raw[r + 2], dev.raw[r + 3], tune.rightInner, tune.rightOuter, tune.rightCurve, dev.stick, o + 2);
    dev.stickMag[s * 2] = ml;
    dev.stickMag[s * 2 + 1] = mr;
    if (ml > 0) { if (dev.stickActiveSince[s] < 0) dev.stickActiveSince[s] = now; } else dev.stickActiveSince[s] = -1;
    if (fresh) {
      dev.prevStickMag[s * 2] = ml;
      dev.prevStickMag[s * 2 + 1] = mr;
      return;
    }
    // aktywność: zbocza, nie stan (widmo ze stałym wychyleniem nie przejmuje aktywnego pada)
    const th = tune.activityStick;
    if ((ml >= th && dev.prevStickMag[s * 2] < th) || (mr >= th && dev.prevStickMag[s * 2 + 1] < th)) activity = true;
    if (activity) {
      dev.lastActive[s] = now;
      dev.active = s;
    }
  }

  return dev;
}
