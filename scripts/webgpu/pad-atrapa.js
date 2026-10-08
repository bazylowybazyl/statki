// Atrapa pada (docs/PLAN-pad.md § 6) — wstrzykiwana do strony gry PRZED jej skryptami
// (CDP Page.addScriptToEvaluateOnNewDocument) przez scripts/webgpu/pad-gra.mjs. Podmienia
// navigator.getGamepads na pad sterowany z harnessu; gry nie zmienia.
//
//   window.__fakePad.connect({ id?, mapping?, index? })   // pad widoczny dla strony (jak po naciśnięciu przycisku w Chrome)
//   window.__fakePad.set({ buttons: { 7: 1 }, axes: [0, -1, 0, 0] })   // stan: przyciski (indeks → wartość 0..1), osie
//   window.__fakePad.press(0) / release(0) / reset() / disconnect()
//   window.__fakePad.rumble                                  // wywołania vibrationActuator.playEffect
// Indeksy jak w mapowaniu `standard`: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3,
// 12–15 D-pad (góra, dół, lewo, prawo), 16 Home; osie: 0 LS ↔, 1 LS ↕ (w górę ujemna), 2 RS ↔, 3 RS ↕.
(() => {
  if (window.__fakePad) return;
  const NB = 17;
  const NA = 4;
  const XBOX_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
  const now = () => performance.now();
  const st = {
    connected: false,
    id: XBOX_ID,
    mapping: 'standard',
    index: 0,
    buttons: new Array(NB).fill(0),
    axes: new Array(NA).fill(0),
    timestamp: 0,
    reads: 0
  };
  const rumble = [];
  const actuator = {
    type: 'dual-rumble',
    effects: ['dual-rumble', 'trigger-rumble'],
    playEffect(type, params) { rumble.push({ type, ...(params || {}), t: now() }); return Promise.resolve('complete'); },
    reset() { return Promise.resolve('complete'); }
  };
  // Migawka jak w Chrome: nowy obiekt przy każdym odczycie (gra nie może trzymać go między klatkami).
  const snapshot = () => ({
    id: st.id,
    index: st.index,
    connected: true,
    mapping: st.mapping,
    timestamp: st.timestamp,
    axes: st.axes.slice(),
    buttons: st.buttons.map((v) => ({ pressed: v >= 0.5, touched: v > 0, value: v })),
    vibrationActuator: actuator
  });
  const getGamepads = function getGamepads() {
    st.reads++;
    const out = [null, null, null, null];
    if (st.connected) out[st.index] = snapshot();
    return out;
  };
  try {
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: getGamepads, configurable: true, writable: true });
  } catch {
    navigator.getGamepads = getGamepads;
  }
  const fire = (type) => {
    try {
      const ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: snapshot() });
      window.dispatchEvent(ev);
    } catch { /* bez zdarzenia */ }
  };
  const touch = () => { st.timestamp = now(); };
  window.__fakePad = {
    state: st,
    rumble,
    connect(o = {}) {
      if (o.id) st.id = String(o.id);
      if (o.mapping !== undefined) st.mapping = String(o.mapping);
      if (Number.isInteger(o.index)) st.index = Math.max(0, Math.min(3, o.index));
      st.connected = true;
      touch();
      fire('gamepadconnected');
      return true;
    },
    disconnect() {
      if (!st.connected) return false;
      fire('gamepaddisconnected');
      st.connected = false;
      return true;
    },
    set(o = {}) {
      if (o.buttons) for (const k of Object.keys(o.buttons)) st.buttons[k | 0] = Math.max(0, Math.min(1, Number(o.buttons[k]) || 0));
      if (o.axes) for (let i = 0; i < NA; i++) if (o.axes[i] !== undefined) st.axes[i] = Math.max(-1, Math.min(1, Number(o.axes[i]) || 0));
      touch();
      return true;
    },
    press(b, v = 1) { return this.set({ buttons: { [b]: v } }); },
    release(b) { return this.set({ buttons: { [b]: 0 } }); },
    reset() { st.buttons.fill(0); st.axes.fill(0); touch(); return true; }
  };
})();
