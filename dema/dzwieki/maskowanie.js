// Maskowanie — przepisy syntezy (dema/dzwieki.html).
//
// Włączenie: fala heksów przechodzi przez kadłub — kaskada szklanych tyknięć płynie przez
// stereo, opadający połysk z dudnieniem, energia „wciągnięta” (spadający filtr i sub).
// Wyłączenie: to samo odwrotnie. Zerwanie: zakłócenie — losowo bramkowany, skwantowany sygnał.
import { lerp } from './silnik.js';

function glassCascade(E, V, t, dur, n, f0, f1, pan0, pan1, peak) {
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const ti = Math.max(V.t, t + dur * Math.pow(x, 0.75) + E.pick(-0.01, 0.01));
    const o = V.osc('sine', lerp(f0, f1, x) * E.pick(0.85, 1.15), ti);
    const g = V.gain(0);
    const d = E.pick(0.03, 0.09);
    V.ad(g.gain, ti, peak * E.pick(0.5, 1), 0.0008, d);
    V.endOf(o, ti + d + 0.01);
    V.chain(o, g, V.sub({ pan: lerp(pan0, pan1, x) + E.pick(-0.15, 0.15) }));
  }
}

export const cloakOn = {
  id: 'maskaWl',
  group: 'Maskowanie',
  name: 'Włączenie',
  desc: 'Fala heksów przez kadłub, szklany połysk, cichy szum pola.',
  params: [],
  length: () => 2.4,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    V.thump(t, 92, 40, 0.3, 0.9, 0.2, { drive: 1.5 });
    V.burst(t, 'pink', { type: 'lowpass', f: 2500, f1: 180, sweep: 0.6, attack: 0.01, decay: 0.9, peak: 0.35 });
    for (const [f, pn] of [[2600, -0.3], [2604, 0.3]]) {
      const o = V.osc('sine', f, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f * 0.27, t + 1.15);
      const g = V.gain(0);
      V.ad(g.gain, t + 0.05, 0.11, 0.05, 1.2);
      V.endOf(o, t + 1.32);
      V.chain(o, g, V.sub({ pan: pn }));
    }
    glassCascade(E, V, t + 0.05, 1.1, 36, 7000, 2400, -0.85, 0.85, 0.11);
    V.burst(t + 0.05, 'white', { type: 'bandpass', f: 9000, f1: 2500, sweep: 1.1, Q: 2, attack: 0.3, decay: 0.9, peak: 0.3 });
    for (const f of [220, 330.6]) {
      const o = V.osc('triangle', f, t + 0.6);
      const g = V.gain(0);
      V.ad(g.gain, t + 0.6, 0.03, 0.35, 1.4);
      V.endOf(o, t + 2.4);
      V.chain(o, g, V.in);
    }
    V.wet(0.9);
    V.finish();
  },
};

export const cloakOff = {
  id: 'maskaWyl',
  group: 'Maskowanie',
  name: 'Wyłączenie',
  desc: 'Fala heksów w drugą stronę i materializacja.',
  params: [],
  length: () => 1.8,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const tm = t + 0.9;
    for (const [f, pn] of [[700, -0.3], [703, 0.3]]) {
      const o = V.osc('sine', f, t);
      o.frequency.exponentialRampToValueAtTime(f * 3.7, tm);
      const g = V.gain(0);
      V.env(g.gain, t, [[0, 0, 's'], [0.75, 0.08, 'l'], [0.95, 0.0005, 'e']], true);
      V.endOf(o, tm + 0.1);
      V.chain(o, g, V.sub({ pan: pn }));
    }
    glassCascade(E, V, t, 0.85, 30, 2400, 7000, 0.85, -0.85, 0.11);
    V.burst(t, 'pink', { type: 'lowpass', f: 300, f1: 3200, sweep: 0.85, attack: 0.8, decay: 0.3, peak: 0.3 });
    V.thump(tm, 70, 40, 0.12, 0.55, 0.3, { drive: 1.8 });
    V.burst(tm, 'white', { type: 'bandpass', f: 1800, Q: 0.8, attack: 0.001, decay: 0.12, peak: 0.3 });
    V.wet(0.9);
    V.finish();
  },
};

export const cloakBreak = {
  id: 'maskaZerwanie',
  group: 'Maskowanie',
  name: 'Zerwanie',
  desc: 'Zakłócenie, rwący się sygnał, trzask i spadek mocy.',
  params: [],
  length: () => 1.1,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    // źródło: piła + szum, bramkowane losowo i skwantowane
    const o = V.osc('sawtooth', 600, t);
    const nz = V.noise('white', 1, t);
    const sum = V.gain(1);
    V.chain(o, sum);
    V.chain(nz, V.gain(0.5), sum);
    const gate = V.gain(0);
    let x = t;
    while (x < t + 0.75) {
      gate.gain.setValueAtTime(E.rand() < 0.65 ? E.pick(0.1, 0.3) : 0, x);
      o.frequency.setValueAtTime(E.pick(150, 1400), x);
      x += E.pick(0.015, 0.06);
    }
    gate.gain.setValueAtTime(0, x);
    V.until(x + 0.01);
    V.endOf(o, x + 0.01);
    V.endOf(nz, x + 0.01);
    V.chain(sum, V.shaper(6, 'stairs'), V.lp(7000, 0.7, t), gate, V.in);
    // trzask i spadek mocy
    V.burst(x, 'white', { type: 'bandpass', f: 1500, attack: 0.001, decay: 0.08, peak: 0.5 });
    V.thump(x, 170, 50, 0.04, 0.26, 0.6, { drive: 2 });
    const pf = V.osc('sine', 1200, t);
    pf.frequency.exponentialRampToValueAtTime(60, t + 0.75);
    const pg = V.gain(0);
    V.ad(pg.gain, t, 0.12, 0.01, 0.75);
    V.endOf(pf, t + 0.8);
    V.chain(pf, pg, V.in);
    V.wet(0.6);
    V.finish();
  },
};
