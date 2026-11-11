// Przepisy syntezy używane przez grę (src/audio/dzwiekiGry.js) i demo dema/dzwieki.html — jedyne dwa
// dźwięki z syntezy, które użytkownik przyjął (2026-11-11): silnik MAIN i seria Vulcan / CIWS. Reszta dema
// zostaje w dema/dzwieki/ (gra jej nie importuje). Przepis = { id, params, play(E, p, at) → uchwyt }.
import { lerp } from './synteza.js';

function gatlingShot(E, V, t, s) {
  const C = E.voice({ t }, { parent: V });
  const k = E.vary(1, 0.05);
  const g = E.vary(1, 0.12);
  C.burst(t, 'white', { type: 'highpass', f: lerp(2400, 1400, s), Q: 0.7, attack: 0.0004, decay: 0.03, peak: 0.8 * g });
  C.thump(t, lerp(240, 150, s) * k, lerp(95, 60, s) * k, 0.025, lerp(0.08, 0.14, s), 0.5 * g, { drive: 1.6 });
  C.burst(t, 'pink', { type: 'bandpass', f: lerp(1900, 1100, s) * k, Q: 1.1, attack: 0.0008, decay: lerp(0.06, 0.1, s), peak: 0.5 * g });
  C.finish();
}

export const gatling = {
  id: 'gatling',
  group: 'Działa',
  name: 'Vulcan / Gatling',
  desc: 'Rozkręcanie luf i seria.',
  hold: true,
  params: [
    { id: 'rate', name: 'Szybkostrzelność', min: 15, max: 70, step: 1, value: 42, unit: '/s' },
    { id: 'size', name: 'Kaliber', min: 0, max: 1, step: 0.01, value: 0.3 },
  ],
  length: (p, hold) => hold + 1.2,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const live = { rate: p.rate, size: p.size };
    // silnik obrotu luf
    const mo = V.osc('sawtooth', 70, t);
    mo.frequency.exponentialRampToValueAtTime(260, t + 0.22);
    const mb = V.bp(500, 2.5, t);
    mb.frequency.exponentialRampToValueAtTime(1500, t + 0.22);
    const mg = V.gain(0);
    V.env(mg.gain, t, [[0, 0, 's'], [0.18, 0.05, 'l']]);
    V.chain(mo, mb, mg, V.in);
    // seria
    E.loop(h, t + 0.13, (ts) => {
      gatlingShot(E, V, ts, live.size);
      return ts + E.vary(1 / live.rate, 0.035);
    });
    h.params.rate = (v) => {
      live.rate = v;
    };
    h.params.size = (v) => {
      live.size = v;
    };
    h.onRelease((tr) => {
      E.hold(mo.frequency, tr);
      mo.frequency.setTargetAtTime(45, tr, 0.3);
      E.hold(mb.frequency, tr);
      mb.frequency.setTargetAtTime(300, tr, 0.3);
      E.hold(mg.gain, tr);
      mg.gain.setTargetAtTime(0, tr, 0.18);
      V.stop(tr + 1.2);
    });
    V.start();
    return h;
  },
};

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
