// Wybuchy — przepisy syntezy (dema/dzwieki.html).
import { lerp } from './silnik.js';

export const explosion = {
  id: 'wybuch',
  group: 'Wybuchy',
  name: 'Wybuch',
  desc: 'Trzask, huk, ogień, fala i odłamki o kadłub.',
  params: [{ id: 'size', name: 'Wielkość', min: 0, max: 1, step: 0.01, value: 0.55, marks: ['rakieta', 'fregata', 'pancernik'] }],
  length: (p) => 1.2 + 4 * p.size,
  play(E, p, at) {
    const s = p.size;
    const V = E.voice(at);
    const t = V.t;
    const k = E.vary(1, 0.06);
    V.burst(t, 'white', { type: 'highpass', f: lerp(2600, 900, s), attack: 0.0005, decay: lerp(0.08, 0.25, s), peak: 0.85 });
    V.thump(t, lerp(135, 68, s) * k, lerp(48, 28, s) * k, lerp(0.08, 0.42, s), lerp(0.6, 3.2, s), 0.9, { drive: lerp(2.2, 4.2, s) });
    V.burst(t, 'pink', { type: 'lowpass', f: lerp(6500, 4200, s), f1: lerp(900, 300, s), sweep: lerp(0.4, 2, s), attack: 0.003, decay: lerp(0.7, 3.6, s), peak: 0.95 });
    V.burst(t, 'pink', { type: 'bandpass', f: lerp(1200, 700, s), Q: 0.7, attack: 0.002, decay: lerp(0.3, 1.2, s), peak: 0.6 });
    V.burst(t + 0.01, 'brown', { type: 'lowpass', f: 380, f1: 110, sweep: lerp(0.4, 2, s), attack: lerp(0.02, 0.1, s), decay: lerp(1, 4.6, s), peak: lerp(0.45, 1, s) });
    V.crackle(t + 0.02, { rate: lerp(1.9, 1.1, s), f: 1800, Q: 0.6, attack: 0.03, decay: lerp(0.8, 3.6, s), peak: lerp(0.4, 0.65, s) });
    if (s > 0.45) {
      // fala: szum przemiatany w górę i w dół, szeroko w stereo
      const amp = 0.4 + 0.8 * ((s - 0.45) / 0.55);
      for (const pn of [-0.6, 0.6]) {
        const src = V.noise('pink', 1, t + 0.03);
        const b = V.bp(220, 1.1, t + 0.03);
        b.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
        b.frequency.exponentialRampToValueAtTime(260, t + 1.2);
        const g = V.gain(0);
        V.ad(g.gain, t + 0.03, amp, 0.15, 1.1);
        V.endOf(src, t + 1.3);
        V.chain(src, b, g, V.sub({ pan: pn }));
      }
    }
    // odłamki obijają się o kadłub
    const n = Math.round(lerp(2, 11, s));
    for (let i = 0; i < n; i++) {
      const ti = t + 0.15 + E.rand() * lerp(0.7, 2.6, s);
      V.clank(ti, E.pick(320, 1500), E.pick(0.05, 0.14), { decay: E.pick(0.4, 1), out: V.sub({ pan: E.pick(-0.85, 0.85) }) });
    }
    V.wet(lerp(0.65, 1.1, s));
    V.finish();
  },
};

export const reactor = {
  id: 'reaktor',
  group: 'Wybuchy',
  name: 'Wybuch reaktora',
  desc: 'Stopienie (alarm, jęk konstrukcji, łuki), zassanie, detonacja.',
  params: [{ id: 'melt', name: 'Stopienie', min: 1, max: 6, step: 0.5, value: 3.5, unit: ' s' }],
  length: (p) => p.melt + 8,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const T = p.melt;
    const ti = t + T; // zassanie
    const td = ti + 0.62; // detonacja
    // alarm z interkomu
    const al = V.osc('square', 660, t);
    for (let x = 0, i = 0; x < T; x += 0.42, i++) al.frequency.setValueAtTime(i % 2 ? 520 : 660, t + x);
    const alg = V.gain(0);
    V.env(alg.gain, t, [[0, 0, 's'], [0.03, 0.13, 'l'], [T, 0.13, 's'], [T + 0.03, 0, 'l']]);
    V.endOf(al, ti + 0.05);
    V.chain(al, V.shaper(1.5), V.bp(1150, 2.2, t), alg, V.in);
    // buczenie rdzenia, dudnienie przyspiesza; w zassaniu ton wystrzeliwuje w górę
    const hb = V.gain(0);
    V.env(hb.gain, t, [[0, 0, 's'], [T, 0.4, 'l'], [td - t - 0.1, 0.5, 'l'], [td - t - 0.085, 0, 'l']]);
    const hf = V.lp(120, 4, t);
    hf.frequency.exponentialRampToValueAtTime(800, ti);
    hf.frequency.exponentialRampToValueAtTime(5000, td - 0.09);
    const h1 = V.osc('sawtooth', 40, t);
    h1.frequency.exponentialRampToValueAtTime(88, ti);
    h1.frequency.exponentialRampToValueAtTime(260, td - 0.09);
    const h2 = V.osc('sawtooth', 40.4, t);
    h2.frequency.exponentialRampToValueAtTime(95, ti);
    h2.frequency.exponentialRampToValueAtTime(285, td - 0.09);
    V.endOf(h1, td);
    V.endOf(h2, td);
    V.chain(h1, hf);
    V.chain(h2, hf);
    V.chain(hf, hb, V.in);
    // jęki konstrukcji
    for (let i = 0; i < 3; i++) {
      V.groan(t + 0.4 + E.rand() * Math.max(0.2, T - 1.2), { f: E.pick(48, 80), res: E.pick(300, 650), dur: E.pick(0.6, 1.1), peak: 0.22, out: V.sub({ pan: E.pick(-0.7, 0.7) }) });
    }
    // łuki elektryczne narastają
    V.crackle(t + 0.2, { rate: 1.2, f: 2400, Q: 0.7, attack: Math.max(0.05, T - 0.2), decay: 0.6, peak: 0.4 });
    // zassanie
    const sw = V.noise('pink', 1, ti);
    const swf = V.lp(200, 1, ti);
    swf.frequency.exponentialRampToValueAtTime(13000, td - 0.09);
    const swg = V.gain(0);
    V.env(swg.gain, ti, [[0, 0.003, 's'], [td - ti - 0.09, 0.7, 'e'], [td - ti - 0.08, 0, 'l']], true);
    V.endOf(sw, td);
    V.chain(sw, swf, swg, V.in);
    // detonacja po 80 ms ciszy
    V.burst(td, 'white', { type: 'highpass', f: 600, attack: 0.0005, decay: 0.55, peak: 1 });
    V.thump(td, 62, 26, 1.2, 5, 0.9, { drive: 5 });
    V.burst(td, 'pink', { type: 'bandpass', f: 700, Q: 0.6, attack: 0.003, decay: 2.2, peak: 0.7 });
    V.burst(td, 'pink', { type: 'lowpass', f: 9000, f1: 90, sweep: 3.5, attack: 0.002, decay: 5.2, peak: 1 });
    V.burst(td + 0.05, 'brown', { type: 'lowpass', f: 115, attack: 0.12, decay: 7, peak: 1 });
    for (const pn of [-0.7, 0.7]) {
      const src = V.noise('pink', 1, td);
      const b = V.bp(150, 1.5, td);
      b.frequency.exponentialRampToValueAtTime(4200, td + 0.5);
      b.frequency.exponentialRampToValueAtTime(200, td + 2.2);
      const g = V.gain(0);
      V.ad(g.gain, td, 1.1, 0.25, 2.2);
      V.endOf(src, td + 2.6);
      V.chain(src, b, g, V.sub({ pan: pn }));
    }
    V.crackle(td + 0.1, { rate: 1.3, f: 2000, Q: 0.6, attack: 0.1, decay: 6, peak: 0.6 });
    for (let i = 0; i < 26; i++) {
      V.clank(td + 0.6 + E.rand() * 4.6, E.pick(260, 1700), E.pick(0.04, 0.16), { decay: E.pick(0.4, 1.2), out: V.sub({ pan: E.pick(-0.9, 0.9) }) });
    }
    V.wet(1.2);
    V.finish();
  },
};
