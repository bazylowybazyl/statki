// ============================================================
// Warstwa wejścia gracza (docs/PLAN-pad.md § 4, etap 1): klawiatura + pady + konteksty → zapytania gry o AKCJE.
// Moduł czysty (bez DOM i okna gry). Klej w index.html (blok „WEJŚCIE / PAD”) karmi go zdarzeniami klawiszy
// i flagami stanu gry, gra pyta o akcje zamiast o klawisze i numery przycisków.
//
//   const Input = createInput({ read: () => navigator.getGamepads?.() });
//   Input.update(nowRaf, flags)       // RAZ na klatkę (strażnik znacznika rAF: druga pętla w tej samej klatce = nic)
//   Input.keyDown(code) / keyUp(code) // główny keydown / keyup gry (po jego bramkach menu i fabuły)
//   Input.keyHeld('fly.back')         // klawiatura
//   Input.padPressed('nav.warp')      // zbocze przycisku pada gracza 1 w kontekście akcji (nie zjedzony)
//   Input.padHeld('fly.boost'), Input.padAxis('fly.thrust'), Input.axis('fly.turn'), Input.manualFlight()
//
// Pady graczy: `players[0]` — pad gracza 1 (gra jednoosobowa: AKTYWNY pad urządzeń; podzielony ekran: przypisany),
// `players[1]` — gracza 2; ustawia klej (setPlayerPads) po update. Kontekst (inputContext.js) bramkuje TYLKO pad —
// klawiatura ma swoje bramki w słuchaczach DOM (menu, nakładka fabuły, panel stacji, główny keydown).
// ============================================================
import { createPadDevice, PAD_BUTTONS, axisCurve } from './padDevice.js';
import { createInputContext } from './inputContext.js';
import { ACTION_BY_ID, KEYBOARD_LAYOUT, KEY_AXES, PAD_LAYOUT, PAD_LAYOUT_P2, padBindings } from './inputActions.js';

/** Gałka lotu poza martwą strefą tyle ms = gracz przejmuje stery od autopilota (dryf gałki go nie zdejmuje). */
export const PAD_MANUAL_FLIGHT_MS = 100;
/** Próg połowy osi jako „trzymania” (np. LS ↓ = S przy hamulcu szarży). */
export const PAD_AXIS_HOLD = 0.5;

const NB = PAD_BUTTONS;

export function createInput(opts = {}) {
  const device = opts.device || createPadDevice({ read: opts.read, tune: opts.tune });
  const context = opts.context || createInputContext();
  const layouts = [opts.padLayout || PAD_LAYOUT, opts.padLayoutP2 || PAD_LAYOUT_P2];
  // wiązania pada znormalizowane do list RAZ (zapytania co klatkę bez alokacji)
  const bindCache = layouts.map(() => new Map());
  const NO_BINDINGS = Object.freeze([]);
  const bindingsOf = (li, id) => {
    const cache = bindCache[li] || bindCache[0];
    let list = cache.get(id);
    if (!list) {
      list = padBindings(layouts[li] || layouts[0], id);
      if (!list.length) list = NO_BINDINGS;
      cache.set(id, list);
    }
    return list;
  };
  const keyLayout = opts.keyLayout || KEYBOARD_LAYOUT;
  // klawisze trzymane (KeyboardEvent.code) — zbiór kodów, zmiany tylko na zdarzeniach
  const keysDown = new Set();
  const flagsZero = {};

  // akcja → czy działa w kontekście (pamięć zbiorów kontekstów)
  const ctxSets = new Map();
  const inCtx = (id) => {
    let set = ctxSets.get(id);
    if (!set) {
      const a = ACTION_BY_ID[id];
      set = new Set(a ? a.ctx : []);
      ctxSets.set(id, set);
    }
    return set.has(input.ctx);
  };

  const input = {
    device,
    context,
    ctx: 'none',
    now: -1,
    frame: 0,
    dtMs: 0,
    /** pady graczy (slot urządzenia albo −1) */
    players: new Int8Array([-1, -1]),
    /** ostatnio użyte urządzenie: 'keyboard' | 'mouse' | 'pad' (podpowiedzi — etap 5) */
    lastDevice: 'keyboard',

    /**
     * Raz na klatkę rAF. `nowMs` — znacznik rAF (wspólny dla wszystkich wywołań rAF w jednej klatce): drugie
     * wywołanie z tym samym znacznikiem nic nie robi i zwraca false.
     */
    update(nowMs, flags = flagsZero) {
      if (nowMs === input.now) return false;
      input.dtMs = input.now >= 0 ? Math.min(100, Math.max(0, nowMs - input.now)) : 0;
      input.now = nowMs;
      input.frame++;
      device.update(nowMs);
      input.ctx = context.update(flags, device);
      for (let s = 0; s < device.connected.length; s++) {
        if (!device.connected[s]) continue;
        const b0 = s * NB;
        for (let b = 0; b < NB; b++) if (device.pressed[b0 + b]) { input.lastDevice = 'pad'; break; }
        if (device.stickMag[s * 2] > 0.5 || device.stickMag[s * 2 + 1] > 0.5) input.lastDevice = 'pad';
      }
      return true;
    },

    setPlayerPads(p1 = -1, p2 = -1) {
      input.players[0] = p1;
      input.players[1] = p2;
    },

    /** Pad gracza (slot albo −1). */
    pad(player = 0) { return input.players[player] ?? -1; },

    // --- klawiatura ---
    keyDown(code) {
      if (!code) return;
      keysDown.add(code);
      input.lastDevice = 'keyboard';
    },
    keyUp(code) { if (code) keysDown.delete(code); },
    isKeyDown(code) { return keysDown.has(code); },
    /** Trzymane kody (lista — utrata fokusu: klej puszcza je po kolei). */
    heldKeys() { return Array.from(keysDown); },
    clearKeys() { keysDown.clear(); },
    /** Akcja trzymana na klawiaturze (dowolny jej klawisz). */
    keyHeld(id) {
      const codes = keyLayout[id];
      if (!codes) return false;
      for (let i = 0; i < codes.length; i++) if (keysDown.has(codes[i])) return true;
      return false;
    },
    /** Oś z klawiatury: −1 / 0 / 1 (obie strony naraz = 0). */
    keyAxis(id) {
      const pair = KEY_AXES[id];
      if (!pair) return 0;
      return (input.keyHeld(pair[1]) ? 1 : 0) - (input.keyHeld(pair[0]) ? 1 : 0);
    },
    noteMouse() { input.lastDevice = 'mouse'; },

    // --- pad (w kontekście akcji, bez zjedzonych przycisków) ---
    padPressed(id, player = 0) { return padQuery(id, input.players[player], player, 0); },
    padHeld(id, player = 0) { return padQuery(id, input.players[player], player, 1); },
    padReleased(id, player = 0) { return padQuery(id, input.players[player], player, 2); },
    /** Przytrzymanie z progiem wiązania (`holdMs`) przekroczone w tej klatce. */
    padHoldCrossed(id, player = 0) { return padQuery(id, input.players[player], player, 3); },
    /** Zbocze akcji na KONKRETNYM slocie (przypisanie padów — każdy pad zgłasza się sam; układ gracza 1). */
    padPressedSlot(id, slot) { return padQuery(id, slot, 0, 0); },
    /** Oś akcji z pada: wiązanie { axis, invert, curve } po martwej strefie gałki (0 poza kontekstem). */
    padAxis(id, player = 0) {
      const slot = input.players[player];
      if (!(slot >= 0) || !inCtx(id)) return 0;
      const list = bindingsOf(player, id);
      for (let k = 0; k < list.length; k++) {
        const bnd = list[k];
        if (typeof bnd.axis !== 'number' || bnd.dir) continue;
        let v = device.axis(slot, bnd.axis);
        if (bnd.invert) v = -v;
        return axisCurve(v, bnd.curve || 1);
      }
      return 0;
    },
    /** Wektor gałki akcji ({ stick: 'left' | 'right' }) do out[0], out[1]; zwraca moduł. */
    padVector(id, out, player = 0) {
      out[0] = 0; out[1] = 0;
      const slot = input.players[player];
      if (!(slot >= 0) || !inCtx(id)) return 0;
      const list = bindingsOf(player, id);
      for (let k = 0; k < list.length; k++) {
        const bnd = list[k];
        if (!bnd.stick) continue;
        const a = bnd.stick === 'right' ? 2 : 0;
        out[0] = device.axis(slot, a);
        out[1] = device.axis(slot, a + 1);
        return device.stickMag[slot * 2 + (a ? 1 : 0)];
      }
      return 0;
    },
    /** Oś scalona: klawiatura (−1 / 0 / 1) albo pad — wygrywa większy moduł (remis: klawiatura). */
    axis(id, player = 0, useKeys = true) {
      const k = useKeys ? input.keyAxis(id) : 0;
      const p = input.padAxis(id, player);
      return Math.abs(p) > Math.abs(k) ? p : k;
    },
    /** Akcja trzymana: klawiatura albo pad gracza 1. */
    held(id) { return input.keyHeld(id) || padQuery(id, input.players[0], 0, 1); },

    /**
     * Gracz steruje ręcznie (przejmuje stery od autopilota): klawisze lotu albo lewa gałka poza martwą strefą
     * przez ≥ PAD_MANUAL_FLIGHT_MS (dryf zużytej gałki nie anuluje rozkazu). `useKeys` — klawiatura należy do gracza.
     */
    manualFlight(useKeys = true, player = 0) {
      if (useKeys && (input.keyHeld('fly.forward') || input.keyHeld('fly.back') || input.keyHeld('fly.left')
        || input.keyHeld('fly.right') || input.keyHeld('fly.strafeLeft') || input.keyHeld('fly.strafeRight'))) return true;
      const slot = input.players[player];
      return slot >= 0 && inCtx('fly.thrust') && device.stickActiveMs(slot) >= PAD_MANUAL_FLIGHT_MS;
    },

    /** Lewa gałka gracza daje wejście lotu w tej klatce (poza martwą strefą, w kontekście lotu). */
    padFlightActive(player = 0) {
      const slot = input.players[player];
      return slot >= 0 && inCtx('fly.thrust') && device.stickMag[slot * 2] > 0;
    },

    /** Utrata fokusu / ukrycie karty: klawisze puszczone (klej obsłużył keyup), pady od zera, trzymane zjedzone. */
    clear() {
      keysDown.clear();
      context.eatHeld(device);
      device.clear();
    }
  };

  // q: 0 zbocze wciśnięcia, 1 trzymanie, 2 puszczenie, 3 przytrzymanie (holdMs) przekroczone; li — układ (gracz)
  function padQuery(id, slot, li, q) {
    if (!(slot >= 0) || !inCtx(id)) return false;
    const list = bindingsOf(li, id);
    for (let k = 0; k < list.length; k++) {
      const bnd = list[k];
      if (typeof bnd.button === 'number') {
        const b = bnd.button;
        if (context.isEaten(slot, b)) continue;
        if (q === 0 ? (bnd.holdMs ? false : device.wasPressed(slot, b))
          : q === 1 ? device.isDown(slot, b)
            : q === 2 ? device.wasReleased(slot, b)
              : (bnd.holdMs ? device.crossed(slot, b, bnd.holdMs) : false)) return true;
      } else if (typeof bnd.axis === 'number' && bnd.dir) {
        if (q === 0) {
          const t = (bnd.edge || PAD_AXIS_HOLD) * bnd.dir;
          if (device.rawCrossed(slot, bnd.axis, t)) return true;
        } else if (q === 1) {
          if (device.axis(slot, bnd.axis) * bnd.dir >= (bnd.edge || PAD_AXIS_HOLD)) return true;
        }
      }
    }
    return false;
  }

  return input;
}
