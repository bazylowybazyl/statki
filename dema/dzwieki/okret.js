// Kadłub, tarcza, zderzenia i napęd okrętu — przepisy syntezy (dema/dzwieki.html).
import { lerp } from './silnik.js';

// drgania własne płyty (stosunki częstotliwości modów okrągłej płyty)
const PLATE = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501];

export const hullHit = {
  id: 'kadlub',
  group: 'Kadłub i tarcza',
  name: 'Trafienie w kadłub',
  desc: 'Głuche uderzenie, drgania płyty pancerza, rwanie blachy.',
  params: [{ id: 'caliber', name: 'Kaliber', min: 0, max: 1, step: 0.01, value: 0.5 }],
  length: (p) => 0.7 + 1.6 * p.caliber,
  play(E, p, at) {
    const c = p.caliber;
    const V = E.voice(at);
    const t = V.t;
    const k = E.vary(1, 0.08);
    V.thump(t, lerp(250, 110, c) * k, lerp(92, 42, c) * k, 0.05, lerp(0.16, 0.65, c), 0.6, { drive: 2.2 });
    V.burst(t, 'white', { type: 'bandpass', f: lerp(3600, 1800, c), Q: 0.9, attack: 0.0005, decay: lerp(0.05, 0.16, c), peak: 0.75 });
    const amps = PLATE.map((_, i) => (1 - i * 0.09) * E.pick(0.6, 1));
    const dec = PLATE.map((_, i) => lerp(0.5, 1.6, c) * (1 - i * 0.08));
    V.modal(t, lerp(620, 160, c) * k, PLATE, amps, dec, 0.2, { detune: 0.01 });
    if (c > 0.4) V.crackle(t, { rate: 2.5, f: 2500, Q: 0.6, attack: 0.002, decay: lerp(0.1, 0.5, c), peak: 0.7 * ((c - 0.4) / 0.6) });
    if (c > 0.6) V.groan(t + 0.12, { f: 58, res: 420, dur: 0.7, peak: 0.18 * ((c - 0.6) / 0.4) });
    V.wet(0.6);
    V.finish();
  },
};

export const ricochet = {
  id: 'rykoszet',
  group: 'Kadłub i tarcza',
  name: 'Rykoszet',
  desc: 'Brzęk i świst odbitego pocisku.',
  params: [],
  length: () => 0.9,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const k = E.vary(1, 0.12);
    V.burst(t, 'white', { type: 'bandpass', f: 4200, Q: 1, attack: 0.0004, decay: 0.025, peak: 0.45 });
    V.modal(t, 2300 * k, [1, 2.76], [1, 0.4], [0.18, 0.08], 0.12);
    const dir = E.rand() < 0.5 ? -1 : 1;
    const S = V.sub({ pan: 0 });
    S.pan.setValueAtTime(0, t + 0.02);
    S.pan.linearRampToValueAtTime(0.9 * dir, t + 0.6);
    const o = V.osc('sine', 3300 * k, t + 0.02);
    o.frequency.exponentialRampToValueAtTime(1350 * k, t + 0.6);
    const v = V.osc('sine', E.pick(24, 36), t + 0.02);
    const vg = V.gain(90);
    V.chain(v, vg);
    vg.connect(o.frequency);
    const g = V.gain(0);
    V.ad(g.gain, t + 0.02, 0.22, 0.004, 0.6);
    V.endOf(o, t + 0.65);
    V.endOf(v, t + 0.65);
    V.chain(o, g, S);
    V.wet(0.6);
    V.finish();
  },
};

export const shieldHit = {
  id: 'tarcza',
  group: 'Kadłub i tarcza',
  name: 'Trafienie w tarczę',
  desc: 'Dzwon FM, przemiatany szum i rezonans pola.',
  params: [{ id: 'power', name: 'Siła', min: 0, max: 1, step: 0.01, value: 0.5 }],
  length: (p) => 1 + 0.9 * p.power,
  play(E, p, at) {
    const w = p.power;
    const V = E.voice(at);
    const t = V.t;
    const k = E.vary(1, 0.06) * lerp(1.25, 0.8, w);
    // FM: modulator 2,71× nośnej (niecałkowity — dzwon), indeks gaśnie
    const fc = 600 * k;
    const car = V.osc('sine', fc, t);
    const mod = V.osc('sine', fc * 2.71, t);
    const idx = V.gain(0);
    V.env(idx.gain, t, [[0, fc * 5.5, 's'], [0.5, 4, 'e']]);
    V.chain(mod, idx);
    idx.connect(car.frequency);
    const dd = lerp(0.6, 1.4, w);
    const cg = V.gain(0);
    V.ad(cg.gain, t, 0.3, 0.002, dd);
    V.endOf(car, t + dd + 0.01);
    V.endOf(mod, t + dd + 0.01);
    V.chain(car, cg, V.in);
    // szum przemiatany w dół
    V.burst(t, 'pink', { type: 'bandpass', f: 4300, f1: 520, sweep: 0.35, Q: 5, attack: 0.002, decay: 0.45, peak: 1.7 });
    // uderzenie
    V.thump(t, 145, 62, 0.05, 0.3, lerp(0.22, 0.42, w), { drive: 1.5 });
    // kryształowe iskry
    for (let i = 0; i < 4; i++) {
      const o = V.osc('sine', E.pick(2800, 6400), t);
      const g = V.gain(0);
      const d = E.pick(0.3, 0.8);
      V.ad(g.gain, t, 0.035, 0.004, d);
      V.endOf(o, t + d + 0.01);
      V.chain(o, g, V.sub({ pan: E.pick(-0.6, 0.6) }));
    }
    // rezonans pola: dwa sinusy z dudnieniem
    const dr = lerp(0.8, 1.7, w);
    for (const f of [110, 110.9]) {
      const o = V.osc('sine', f * lerp(1.1, 0.85, w), t);
      const g = V.gain(0);
      V.ad(g.gain, t, 0.1, 0.04, dr);
      V.endOf(o, t + dr + 0.05);
      V.chain(o, g, V.in);
    }
    V.wet(0.85);
    V.finish();
  },
};

export const grind = {
  id: 'zgrzyt',
  group: 'Kadłub i tarcza',
  name: 'Zgrzyt kadłubów',
  desc: 'Tarcie przy zderzeniu: rezonanse blach, poślizg, jęk.',
  hold: true,
  params: [{ id: 'force', name: 'Nacisk', min: 0, max: 1, step: 0.01, value: 0.6 }],
  length: (p, hold) => hold + 0.8,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const lvl = (v) => 0.35 + 0.65 * v;
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [0.15, lvl(p.force), 'l']]);
    // rezonanse blach: szum przez wąskie filtry, częstotliwości pływają
    const src = V.noise('white', 1, t);
    const reso = [[380, 12], [1150, 14], [2600, 10], [4100, 9]];
    const bps = reso.map(([f, Q]) => {
      const b = V.bp(f * lerp(0.85, 1.15, p.force), Q, t);
      const lfo = V.osc('sine', E.pick(0.4, 2.2), t);
      const lg = V.gain(f * 0.07);
      V.chain(lfo, lg);
      lg.connect(b.frequency);
      V.chain(src, b, V.gain(E.nbGain(f, Q, f < 1000 ? 0.13 : 0.08)), bus);
      return b;
    });
    // jęk konstrukcji
    const gr = V.osc('sawtooth', 46, t);
    const vib = V.osc('sine', 3.1, t);
    const vg = V.gain(4);
    V.chain(vib, vg);
    vg.connect(gr.frequency);
    V.chain(gr, V.lp(260, 9, t), V.gain(0.35), bus);
    // trzaski
    V.chain(V.noise('crackle', 1.2, t), V.bp(3000, 0.8, t), V.gain(0.5), bus);
    // poślizg: głośność faluje losowo (stick-slip)
    const slip = V.gain(0.55);
    V.chain(V.noise('brown', 1, t), V.lp(14, 0.7, t), V.gain(5)).connect(slip.gain);
    V.chain(bus, slip, V.in);
    h.params.force = (v, tt) => {
      bus.gain.setTargetAtTime(lvl(v), tt, 0.1);
      bps.forEach((b, i) => b.frequency.setTargetAtTime(reso[i][0] * lerp(0.85, 1.15, v), tt, 0.2));
    };
    h.onRelease((tr) => {
      E.hold(bus.gain, tr);
      bus.gain.setTargetAtTime(0, tr, 0.12);
      V.stop(tr + 0.7);
    });
    V.start();
    return h;
  },
};

export const ram = {
  id: 'taran',
  group: 'Kadłub i tarcza',
  name: 'Taran',
  desc: 'Zderzenie okrętów: zgniot, rwanie, jęk i odłamki.',
  params: [{ id: 'mass', name: 'Masa', min: 0, max: 1, step: 0.01, value: 0.7 }],
  length: (p) => 2.4 + p.mass,
  play(E, p, at) {
    const m = p.mass;
    const V = E.voice(at);
    const t = V.t;
    V.thump(t, lerp(120, 80, m), lerp(42, 30, m), 0.2, lerp(0.9, 1.6, m), 0.9, { drive: 3.6 });
    V.burst(t, 'pink', { type: 'lowpass', f: 4200, f1: 280, sweep: 0.5, attack: 0.002, decay: lerp(0.8, 1.4, m), peak: 0.85 });
    V.crackle(t + 0.01, { rate: 2.2, f: 1800, Q: 0.5, attack: 0.005, decay: lerp(0.6, 1.1, m), peak: 0.8 });
    V.modal(t, lerp(170, 105, m), PLATE, PLATE.map((_, i) => 1 - i * 0.1), PLATE.map((_, i) => 2.1 * (1 - i * 0.09)), 0.07, { detune: 0.01 });
    V.groan(t + 0.25, { f: 52, res: 380, dur: 1.1, peak: 0.22 });
    V.groan(t + 0.75, { f: 70, res: 560, dur: 0.9, peak: 0.16 });
    for (let i = 0; i < 6; i++) {
      V.clank(t + 0.1 + E.rand() * 1.6, E.pick(300, 1300), E.pick(0.05, 0.12), { out: V.sub({ pan: E.pick(-0.8, 0.8) }) });
    }
    V.wet(0.9);
    V.finish();
  },
};

// ---------------------------------------------------------------------------------------------
// Napęd

export const engineMain = {
  id: 'silnik',
  group: 'Okręt',
  name: 'Silnik MAIN',
  desc: 'Dudnienie, ryk, ton i turbina. Suwaki działają na żywo.',
  hold: true,
  params: [
    { id: 'throttle', name: 'Ciąg', min: 0, max: 1, step: 0.01, value: 0.5 },
    { id: 'boost', name: 'Dopalacz', toggle: true, value: 0 },
  ],
  length: (p, hold) => hold + 1.6,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const master = V.gain(0);
    V.env(master.gain, t, [[0, 0, 's'], [0.7, 1, 'l']]);
    // dudnienie, ryk
    const ruf = V.lp(90, 0.8, t);
    const rug = V.gain(0);
    V.chain(V.noise('brown', 1, t), ruf, rug, master);
    const rof = V.bp(220, 0.7, t);
    const rog = V.gain(0);
    V.chain(V.noise('pink', 1, t), rof, rog, master);
    // ton: piły w kwincie + sub, powolne pływanie stroju
    const DR = [36, 54, 18];
    const dr = [V.osc('sawtooth', DR[0], t), V.osc('sawtooth', DR[1], t), V.osc('sine', DR[2], t)];
    const drf = V.lp(160, 2, t);
    const drift = V.osc('sine', 0.13, t);
    const dg = V.gain(6);
    V.chain(drift, dg);
    dr.forEach((o, i) => {
      dg.connect(o.detune);
      V.chain(o, V.gain(i === 2 ? 0.9 : 0.5), drf);
    });
    V.chain(drf, V.gain(0.22), master);
    // turbina
    const TU = [900, 1350];
    const tu = TU.map((f) => V.osc('sine', f, t));
    const tug = V.gain(0);
    const vib = V.osc('sine', 5, t);
    const vibg = V.gain(4);
    V.chain(vib, vibg);
    tu.forEach((o) => {
      vibg.connect(o.frequency);
      V.chain(o, tug);
    });
    V.chain(tug, master);
    // dopalacz: trzaski i syk
    const bog = V.gain(0);
    V.chain(V.noise('crackle', 1.3, t), V.bp(1400, 0.6, t), bog, master);
    const bhg = V.gain(0);
    V.chain(V.noise('white', 1, t), V.hp(2600, 0.7, t), bhg, master);
    V.chain(master, V.in);
    const st = { thr: p.throttle, boost: p.boost ? 1 : 0 };
    const apply = (tt, tau) => {
      const x = st.thr;
      const b = st.boost;
      ruf.frequency.setTargetAtTime(90 + 420 * x + 200 * b, tt, tau);
      rug.gain.setTargetAtTime(0.4 + 0.5 * x + 0.3 * b, tt, tau);
      rof.frequency.setTargetAtTime(220 + 900 * x + 500 * b, tt, tau);
      rog.gain.setTargetAtTime(0.06 + 0.5 * x + 0.35 * b, tt, tau);
      const pm = 1 + 0.35 * x + 0.15 * b;
      dr.forEach((o, i) => o.frequency.setTargetAtTime(DR[i] * pm, tt, tau * 1.5));
      drf.frequency.setTargetAtTime(160 + 380 * x + 200 * b, tt, tau);
      tu.forEach((o, i) => o.frequency.setTargetAtTime((TU[i] + 1700 * x * (i ? 1.5 : 1)) * (1 + 0.1 * b), tt, tau * 2));
      tug.gain.setTargetAtTime(0.01 + 0.03 * x, tt, tau);
      bog.gain.setTargetAtTime(0.7 * b, tt, tau * 0.5);
      bhg.gain.setTargetAtTime(0.1 * b, tt, tau * 0.5);
    };
    apply(t, 0.01);
    h.params.throttle = (v, tt) => {
      st.thr = v;
      apply(tt, 0.25);
    };
    h.params.boost = (v, tt) => {
      const on = v >= 0.5;
      const kick = on && !st.boost;
      st.boost = on ? 1 : 0;
      apply(tt, 0.25);
      if (kick) {
        V.thump(tt, 78, 34, 0.12, 0.6, 0.7, { drive: 2.5 });
        V.burst(tt, 'pink', { type: 'bandpass', f: 300, f1: 2400, sweep: 0.35, Q: 1.2, attack: 0.05, decay: 0.5, peak: 0.6 });
      }
    };
    h.onRelease((tr) => {
      E.hold(master.gain, tr);
      master.gain.setTargetAtTime(0, tr, 0.35);
      for (const o of dr) {
        o.detune.setValueAtTime(0, tr);
        o.detune.linearRampToValueAtTime(-900, tr + 1.2);
      }
      for (const o of tu) {
        o.detune.setValueAtTime(0, tr);
        o.detune.linearRampToValueAtTime(-1500, tr + 1.2);
      }
      V.stop(tr + 1.5);
    });
    V.start();
    return h;
  },
};

export const rcs = {
  id: 'rcs',
  group: 'Okręt',
  name: 'Dysze manewrowe',
  desc: 'Krótkie syknięcia gazu z dysz SIDE.',
  params: [{ id: 'pulses', name: 'Impulsy', min: 1, max: 5, step: 1, value: 2 }],
  length: (p) => 0.45 + p.pulses * 0.28,
  play(E, p, at) {
    const V = E.voice(at);
    let ti = V.t;
    for (let i = 0; i < Math.round(p.pulses); i++) {
      const S = V.sub({ pan: E.pick(-0.6, 0.6) });
      const hold = E.pick(0.06, 0.14);
      const src = V.noise('white', 1, ti);
      const g = V.gain(0);
      V.env(g.gain, ti, [[0, 0, 's'], [0.006, 0.32, 'l'], [hold, 0.26, 'l'], [hold + 0.16, 0.0003, 'e']], true);
      V.endOf(src, ti + hold + 0.17);
      V.chain(src, V.bp(E.pick(2400, 3400), 0.6, ti), g, S);
      V.burst(ti, 'pink', { type: 'lowpass', f: 650, attack: 0.004, decay: 0.16, peak: 0.35, out: S });
      ti += hold + E.pick(0.06, 0.14);
    }
    V.wet(0.45);
    V.finish();
  },
};
