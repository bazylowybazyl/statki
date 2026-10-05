// Interfejs i czujniki — przepisy syntezy (dema/dzwieki.html). Dźwięki `ui` grają sucho,
// bez odległości i pogłosu (słychać je „w kokpicie”).

export const uiClick = {
  id: 'klik',
  group: 'Interfejs',
  name: 'Klik',
  desc: 'Przycisk, przełącznik.',
  ui: true,
  params: [],
  length: () => 0.1,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const o = V.osc('sine', 2300, t);
    const g = V.gain(0);
    V.ad(g.gain, t, 0.22, 0.0005, 0.035);
    V.endOf(o, t + 0.04);
    V.chain(o, g, V.in);
    V.burst(t, 'white', { type: 'bandpass', f: 6000, Q: 1.5, attack: 0.0003, decay: 0.01, peak: 0.25 });
    V.finish();
  },
};

export const uiConfirm = {
  id: 'potwierdzenie',
  group: 'Interfejs',
  name: 'Potwierdzenie',
  desc: 'Rozkaz przyjęty.',
  ui: true,
  params: [],
  length: () => 0.25,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    V.beep(t, 1046.5, 0.07, 0.1, { type: 'square', lp: 3500 });
    V.beep(t + 0.075, 1568, 0.11, 0.1, { type: 'square', lp: 3500 });
    V.finish();
  },
};

export const uiError = {
  id: 'blad',
  group: 'Interfejs',
  name: 'Odmowa',
  desc: 'Nie da się (brak amunicji, poza łukiem).',
  ui: true,
  params: [],
  length: () => 0.3,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    for (const dt of [0, 0.14]) {
      V.beep(t + dt, 196, 0.09, 0.14, { type: 'square', lp: 1200 });
      V.beep(t + dt, 197.6, 0.09, 0.08, { type: 'sawtooth', lp: 1200 });
    }
    V.finish();
  },
};

export const lockOn = {
  id: 'namiar',
  group: 'Interfejs',
  name: 'Namiar celu',
  desc: 'Coraz szybsze sygnały i ciągły ton namiaru.',
  ui: true,
  params: [],
  length: () => 1.35,
  play(E, p, at) {
    const V = E.voice(at);
    let tb = V.t;
    let iv = 0.2;
    for (let i = 0; i < 9; i++) {
      V.beep(tb, 1500, 0.035, 0.1, { type: 'triangle' });
      tb += iv;
      iv *= 0.8;
    }
    V.beep(tb, 1500, 0.36, 0.08, { type: 'triangle' });
    V.beep(tb, 2250, 0.36, 0.05, { type: 'triangle' });
    V.finish();
  },
};

export const paint = {
  id: 'malowanie',
  group: 'Interfejs',
  name: 'Malowanie celu',
  desc: 'Cel dopisany do kolejki (T).',
  ui: true,
  params: [],
  length: () => 0.35,
  play(E, p, at) {
    const V = E.voice(at);
    [900, 1200, 1500, 1800].forEach((f, i) => V.beep(V.t + i * 0.065, f, 0.03, 0.09));
    V.finish();
  },
};

export const weaponGroup = {
  id: 'grupa',
  group: 'Interfejs',
  name: 'Zmiana grupy broni',
  desc: 'Mechaniczny przeskok i krótki sygnał.',
  ui: true,
  params: [],
  length: () => 0.3,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    V.thump(t, 150, 80, 0.03, 0.12, 0.3);
    V.clank(t + 0.005, 820, 0.08, { decay: 0.5 });
    const o = V.osc('sine', 1200, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.11);
    const g = V.gain(0);
    V.env(g.gain, t + 0.06, [[0, 0, 's'], [0.004, 0.08, 'l'], [0.05, 0.08, 'l'], [0.06, 0, 'l']], true);
    V.endOf(o, t + 0.13);
    V.chain(o, g, V.in);
    V.finish();
  },
};

export const alarm = {
  id: 'alarm',
  group: 'Interfejs',
  name: 'Alarm',
  desc: 'Kadłub krytyczny — klakson dwutonowy.',
  ui: true,
  hold: true,
  params: [],
  length: (p, hold) => hold + 0.3,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const o = V.osc('square', 740, t);
    let hi = false;
    E.loop(h, t, (ts) => {
      o.frequency.setValueAtTime(hi ? 740 : 560, ts);
      hi = !hi;
      return ts + 0.38;
    });
    const g = V.gain(0);
    V.env(g.gain, t, [[0, 0, 's'], [0.02, 0.12, 'l']]);
    const rot = V.gain(0.8);
    const rl = V.osc('sine', 2, t);
    const rg = V.gain(0.2);
    V.chain(rl, rg);
    rg.connect(rot.gain);
    V.chain(o, V.shaper(1.8), V.bp(1100, 1.5, t), g, rot, V.in);
    h.onRelease((tr) => {
      E.hold(g.gain, tr);
      g.gain.setTargetAtTime(0, tr, 0.03);
      V.stop(tr + 0.25);
    });
    V.start();
    return h;
  },
};
