// Rakiety i torpedy — przepisy syntezy (dema/dzwieki.html).
//
// Rakieta = zimny wyrzut z komory (pneumatyczne „tunk” i syk gazu), zapłon (trzask) i ryk
// silnika odlatujący od okrętu: ciszej, ciemniej (filtr się zamyka), niżej (doppler — wolniejsze
// odtwarzanie szumu), panorama płynie w stronę lotu.
import { lerp, clamp } from './silnik.js';

const KIND_OPTIONS = [
  ['cruise', 'Manewrująca'],
  ['fast', 'Szybka'],
  ['micro', 'Mikro (Rój)'],
  ['torpedo', 'Torpeda'],
];

const MISSILE = {
  cruise: { pitch: 0.85, ignite: 0.42, fly: 3.0, loud: 1, crackle: 1 },
  fast: { pitch: 1.25, ignite: 0.26, fly: 1.9, loud: 0.9, crackle: 0.7, whistle: true },
  micro: { pitch: 1.75, ignite: 0.14, fly: 1.3, loud: 0.5, crackle: 0.5 },
  torpedo: { pitch: 0.6, ignite: 0.55, fly: 3.6, loud: 1.1, crackle: 0.3, torpedo: true },
};

/** Jedna rakieta w głosie V od chwili t. */
export function launchMissile(E, V, t, kind, { pan0 = 0, pan1 = 0.5, gain = 1 } = {}) {
  const m = MISSILE[kind] || MISSILE.cruise;
  const pt = m.pitch * E.vary(1, 0.05);
  const L = m.loud * gain;
  // 1. zimny wyrzut
  V.thump(t, 115 * pt, 44 * pt, 0.06, m.torpedo ? 0.5 : 0.28, 0.5 * L, { drive: 1.8 });
  V.burst(t, 'pink', { type: 'bandpass', f: 460 * pt, Q: 0.8, attack: 0.002, decay: m.torpedo ? 0.7 : 0.45, peak: 0.6 * L });
  V.burst(t, 'white', { type: 'highpass', f: 3600, attack: 0.004, decay: 0.55, peak: 0.12 * L });
  if (m.torpedo) V.clank(t + 0.03, 210, 0.2 * L, { decay: 1.2 });
  // 2. zapłon
  const ti = t + m.ignite * E.vary(1, 0.08);
  V.burst(ti, 'white', { type: 'highpass', f: 2100, attack: 0.001, decay: 0.07, peak: 0.42 * L });
  V.thump(ti, 150 * pt, 62 * pt, 0.04, 0.2, 0.42 * L, { drive: 1.5 });
  // 3. ryk silnika odlatuje
  const S = V.sub({ pan: pan0 });
  S.pan.setValueAtTime(clamp(pan0, -1, 1), ti);
  S.pan.linearRampToValueAtTime(clamp(pan1, -1, 1), ti + m.fly);
  const lp = V.lp(3400, 0.7, ti);
  lp.frequency.exponentialRampToValueAtTime(480, ti + m.fly);
  const g = V.gain(0);
  V.env(g.gain, ti, [[0, 0, 's'], [0.05, 0.6 * L, 'l'], [m.fly, 0.0003, 'e']], true);
  V.chain(lp, g, S);
  const roar = V.noise('pink', pt, ti);
  roar.playbackRate.linearRampToValueAtTime(pt * 0.8, ti + m.fly);
  V.endOf(roar, ti + m.fly + 0.02);
  V.chain(roar, V.hp(120, 0.7, ti), V.peak(380 * pt, 1.3, 9, ti), lp);
  if (m.crackle > 0) {
    const cr = V.noise('crackle', 1.5 * pt, ti);
    cr.playbackRate.linearRampToValueAtTime(1.2 * pt, ti + m.fly);
    V.endOf(cr, ti + m.fly + 0.02);
    V.chain(cr, V.bp(2600, 0.7, ti), V.gain(0.6 * m.crackle), lp);
  }
  if (m.whistle) {
    const o = V.osc('sine', 2600 * pt, ti);
    o.frequency.linearRampToValueAtTime(2000 * pt, ti + m.fly);
    V.endOf(o, ti + m.fly);
    V.chain(o, V.gain(0.045), lp);
  }
  if (m.torpedo) {
    // głęboki silnik torpedy z falowaniem
    const o = V.osc('sawtooth', 72, ti);
    const wob = V.osc('sine', 5.5, ti);
    const wg = V.gain(4);
    V.chain(wob, wg);
    wg.connect(o.frequency);
    V.endOf(o, ti + m.fly);
    V.endOf(wob, ti + m.fly);
    V.chain(o, V.lp(320, 2, ti), V.gain(0.22), lp);
  }
  return ti + m.fly;
}

export const missile = {
  id: 'rakieta',
  group: 'Rakiety',
  name: 'Rakieta',
  desc: 'Zimny wyrzut z komory, zapłon i odlot.',
  params: [{ id: 'kind', name: 'Rodzaj', options: KIND_OPTIONS, value: 'cruise' }],
  length: (p) => {
    const m = MISSILE[p.kind] || MISSILE.cruise;
    return m.ignite * 1.1 + m.fly + 0.4;
  },
  play(E, p, at) {
    const V = E.voice(at);
    launchMissile(E, V, V.t, p.kind, { pan0: 0, pan1: E.pick(-0.7, 0.7) });
    V.wet(0.7);
    V.finish();
  },
};

export const salvo = {
  id: 'salwa',
  group: 'Rakiety',
  name: 'Salwa',
  desc: 'Kolejne komory, wachlarz od lewej do prawej.',
  params: [
    { id: 'count', name: 'Rakiety', min: 2, max: 24, step: 1, value: 8 },
    { id: 'kind', name: 'Rodzaj', options: KIND_OPTIONS, value: 'micro' },
  ],
  length: (p) => salvoInterval(p.kind) * p.count * 1.15 + 4.2,
  play(E, p, at) {
    const V = E.voice(at);
    const n = Math.round(p.count);
    const iv = salvoInterval(p.kind);
    const g = Math.min(1, 1.4 / Math.sqrt(n));
    let ti = V.t;
    for (let i = 0; i < n; i++) {
      const x = n > 1 ? i / (n - 1) : 0.5;
      launchMissile(E, V, ti, p.kind, {
        pan0: lerp(-0.5, 0.5, x) + E.pick(-0.1, 0.1),
        pan1: lerp(-0.9, 0.9, x) + E.pick(-0.15, 0.15),
        gain: g,
      });
      ti += iv * E.vary(1, 0.15);
    }
    V.wet(0.75);
    V.finish();
  },
};

function salvoInterval(kind) {
  return kind === 'micro' ? 0.075 : kind === 'torpedo' ? 0.32 : 0.16;
}
