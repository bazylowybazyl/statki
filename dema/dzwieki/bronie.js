// Działa, wiązki i superbronie — przepisy syntezy (dema/dzwieki.html).
//
// Każdy przepis: { id, group, name, desc, params, length(p, hold), play(E, p, at) }.
// `length` = czas dźwięku bez ogona pogłosu (render offline, eksport WAV).
import { lerp } from './silnik.js';

const SIZE_MARKS = ['S', 'M', 'L', 'Capital'];
const BAR = [1, 2.756, 5.404, 8.933]; // drgania własne swobodnej belki (szyny)

export const cannon = {
  id: 'dzialo',
  group: 'Działa',
  name: 'Działo',
  desc: 'Trzask wylotu, huk, podmuch, dudnienie i zamek.',
  params: [{ id: 'size', name: 'Kaliber', min: 0, max: 1, step: 0.01, value: 0.66, marks: SIZE_MARKS }],
  length: (p) => 0.5 + 3.2 * p.size,
  play(E, p, at) {
    const s = p.size;
    const V = E.voice(at);
    const t = V.t;
    const k = E.vary(1, 0.04);
    // trzask wylotu
    V.burst(t, 'white', { type: 'highpass', f: lerp(3200, 1300, s), Q: 0.7, attack: 0.0008, decay: lerp(0.06, 0.16, s), peak: lerp(0.45, 0.6, s) });
    // korpus huku: fala z harmonicznymi ze spadkiem częstotliwości, przesterowana
    V.thump(t, lerp(230, 92, s) * k, lerp(70, 34, s) * k, lerp(0.05, 0.24, s), lerp(0.28, 1.7, s), lerp(0.7, 0.9, s), { drive: lerp(1.6, 3.2, s) });
    // podmuch: szum różowy, filtr zamyka się od jasnego do ciemnego
    V.burst(t, 'pink', { type: 'lowpass', f: lerp(7500, 4200, s), f1: lerp(1400, 380, s), sweep: lerp(0.25, 1.0, s), Q: 0.9, attack: 0.0015, decay: lerp(0.3, 2.0, s), peak: lerp(0.6, 0.95, s) });
    // średnica huku (to ją słychać na małych głośnikach)
    V.burst(t, 'pink', { type: 'bandpass', f: lerp(1600, 700, s), Q: 0.8, attack: 0.001, decay: lerp(0.15, 0.6, s), peak: lerp(0.55, 0.75, s) });
    // dudnienie (od kalibru L)
    if (s > 0.3) {
      const r = (s - 0.3) / 0.7;
      V.burst(t + 0.01, 'brown', { type: 'lowpass', f: lerp(260, 140, s), Q: 0.7, attack: lerp(0.03, 0.08, s), decay: lerp(0.9, 3.4, s), peak: lerp(0.15, 0.9, r) });
    }
    // odrzut i zamek: dwa brzęki, mniejsze działo — wyższy ton
    const m = lerp(1.7, 0.75, s) * k;
    V.clank(t + lerp(0.07, 0.17, s), 330 * m, lerp(0.14, 0.22, s), { decay: lerp(0.6, 1.2, s) });
    V.clank(t + lerp(0.2, 0.55, s), 540 * m, lerp(0.09, 0.15, s), { decay: lerp(0.5, 1, s) });
    V.wet(lerp(0.5, 1.1, s));
    V.finish();
  },
};

export const railgun = {
  id: 'railgun',
  group: 'Działa',
  name: 'Działo szynowe',
  desc: 'Pisk kondensatora, trzask wyładowania, kopnięcie i dzwonienie szyn.',
  params: [{ id: 'power', name: 'Moc', min: 0, max: 1, step: 0.01, value: 0.5 }],
  length: (p) => 1.3 + 1.1 * p.power,
  play(E, p, at) {
    const w = p.power;
    const V = E.voice(at);
    const t = V.t;
    const tf = t + 0.11;
    const k = E.vary(1, 0.03);
    // pisk kondensatora tuż przed strzałem
    const c = V.osc('sine', 1600 * k, t);
    c.frequency.exponentialRampToValueAtTime(6400 * k, tf);
    const cg = V.gain(0);
    V.env(cg.gain, t, [[0, 0, 's'], [0.1, 0.07, 'l'], [0.11, 0, 'l']], true);
    V.endOf(c, tf + 0.01);
    V.chain(c, cg, V.in);
    // trzask wyładowania
    V.burst(tf, 'white', { type: 'bandpass', f: 4800, Q: 0.8, attack: 0.0005, decay: 0.07, peak: 0.9 });
    // „snap”: piła gwałtownie w dół
    const sn = V.osc('sawtooth', 2600 * k, tf);
    sn.frequency.exponentialRampToValueAtTime(170, tf + 0.05);
    const sg = V.gain(0);
    V.ad(sg.gain, tf, 0.3, 0.0008, 0.1);
    V.endOf(sn, tf + 0.12);
    V.chain(sn, V.lp(6500, 0.7, tf), sg, V.in);
    // kopnięcie
    V.thump(tf, 165 * k, 48 * k, 0.08, lerp(0.35, 0.8, w), 0.6, { drive: 2.2 });
    // dzwonienie szyn — dwie lekko rozstrojone strony (szerokość stereo)
    const f0 = lerp(1150, 720, w) * k;
    const AM = [0.36, 0.25, 0.17, 0.11];
    const DE = [0.9, 0.5, 0.3, 0.18].map((d) => d * lerp(0.6, 1.25, w));
    V.modal(tf, f0, BAR, AM, DE, 1, { out: V.sub({ pan: -0.35 }), detune: 0.004 });
    V.modal(tf, f0 * 1.006, BAR, AM, DE, 1, { out: V.sub({ pan: 0.35 }), detune: 0.004 });
    // świst odlatującego pocisku
    const z = V.osc('sawtooth', 7200 * k, tf);
    z.frequency.exponentialRampToValueAtTime(950, tf + 0.38);
    const zb = V.bp(7200, 6, tf);
    zb.frequency.exponentialRampToValueAtTime(950, tf + 0.38);
    const zg = V.gain(0);
    V.ad(zg.gain, tf, 0.14, 0.004, 0.42);
    V.endOf(z, tf + 0.45);
    V.chain(z, zb, zg, V.in);
    V.wet(0.75);
    V.finish();
  },
};

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

export const laserPD = {
  id: 'laserPD',
  group: 'Działa',
  name: 'Laser PD',
  desc: 'Obrona punktowa: krótkie impulsy z modulacją FM.',
  params: [{ id: 'pulses', name: 'Impulsy', min: 1, max: 6, step: 1, value: 3 }],
  length: (p) => 0.25 + p.pulses * 0.08,
  play(E, p, at) {
    const V = E.voice(at);
    const n = Math.round(p.pulses);
    let ti = V.t;
    for (let i = 0; i < n; i++) {
      const k = E.vary(1, 0.03);
      const o = V.osc('square', 1900 * k, ti);
      o.frequency.exponentialRampToValueAtTime(330 * k, ti + 0.11);
      const m = V.osc('sine', 260 * k, ti);
      const mg = V.gain(520);
      V.chain(m, mg);
      mg.connect(o.frequency);
      const a = V.gain(0);
      V.ad(a.gain, ti, 0.2, 0.001, 0.15);
      V.endOf(o, ti + 0.17);
      V.endOf(m, ti + 0.17);
      V.chain(o, V.lp(5200, 0.8, ti), a, V.in);
      V.burst(ti, 'white', { type: 'highpass', f: 5200, attack: 0.0004, decay: 0.035, peak: 0.12 });
      ti += E.vary(0.072, 0.08);
    }
    V.wet(0.5);
    V.finish();
  },
};

export const beam = {
  id: 'wiazka',
  group: 'Działa',
  name: 'Wiązka ciągła',
  desc: 'Zapłon, buczenie z iskrzeniem, wygaszenie.',
  hold: true,
  params: [{ id: 'power', name: 'Moc', min: 0, max: 1, step: 0.01, value: 0.5 }],
  length: (p, hold) => hold + 0.8,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const baseF = (x) => lerp(150, 95, x);
    const f = baseF(p.power);
    // zapłon
    V.burst(t, 'white', { type: 'bandpass', f: 2600, f1: 600, sweep: 0.16, Q: 1.2, attack: 0.002, decay: 0.28, peak: 0.45 });
    const ig = V.osc('sawtooth', 180, t);
    ig.frequency.exponentialRampToValueAtTime(1100, t + 0.09);
    const igg = V.gain(0);
    V.ad(igg.gain, t, 0.12, 0.002, 0.12);
    V.endOf(ig, t + 0.14);
    V.chain(ig, igg, V.in);
    // buczenie: rozstrojone piły przez falujący rezonans (samogłoskowe „aaa”) + lekki sub
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [0.09, 1, 'l']]);
    const reso = V.peak(950, 2.5, 10, t);
    const lfo = V.osc('sine', 6.3, t);
    const lg = V.gain(260);
    V.chain(lfo, lg);
    lg.connect(reso.frequency);
    const muls = [1, 1.0075, 2.003];
    const oscs = [];
    [0.16, 0.16, 0.09].forEach((g, i) => {
      const o = V.osc('sawtooth', f * muls[i], t);
      V.chain(o, V.gain(g), reso);
      oscs.push(o);
    });
    const sub = V.osc('sine', f * 0.5, t);
    V.chain(sub, V.gain(0.12), bus);
    V.chain(reso, V.lp(2600, 1, t), bus, V.in);
    // iskrzenie i migoczący syk
    V.chain(V.noise('crackle', 1.4, t), V.bp(3400, 0.9, t), V.gain(0.6), bus);
    const szg = V.gain(0.05);
    V.chain(V.noise('white', 1, t), V.hp(6000, 0.7, t), szg, bus);
    const flg = V.gain(0.1);
    V.chain(V.noise('brown', 0.6, t), V.lp(35, 0.7, t), flg);
    flg.connect(szg.gain);
    h.params.power = (v, tt) => {
      const nf = baseF(v);
      oscs.forEach((o, i) => o.frequency.setTargetAtTime(nf * muls[i], tt, 0.15));
      sub.frequency.setTargetAtTime(nf * 0.5, tt, 0.15);
    };
    h.onRelease((tr) => {
      for (const o of [...oscs, sub]) {
        o.detune.setValueAtTime(0, tr);
        o.detune.linearRampToValueAtTime(-1200, tr + 0.35);
      }
      E.hold(bus.gain, tr);
      bus.gain.setTargetAtTime(0, tr, 0.09);
      V.burst(tr, 'white', { type: 'bandpass', f: 1800, Q: 1, attack: 0.001, decay: 0.08, peak: 0.25 });
      V.stop(tr + 0.7);
    });
    V.start();
    return h;
  },
};

export const flak = {
  id: 'flak',
  group: 'Działa',
  name: 'Flak',
  desc: 'Strzał i rozerwania pocisków w oddali.',
  params: [{ id: 'bursts', name: 'Rozerwania', min: 1, max: 8, step: 1, value: 4 }],
  length: (p) => 1.6 + p.bursts * 0.15,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    V.burst(t, 'white', { type: 'highpass', f: 2200, attack: 0.0006, decay: 0.05, peak: 0.42 });
    V.thump(t, 210, 80, 0.05, 0.25, 0.65, { drive: 1.6 });
    V.burst(t, 'pink', { type: 'lowpass', f: 5200, f1: 700, sweep: 0.15, attack: 0.0015, decay: 0.32, peak: 0.45 });
    let tb = t + E.pick(0.5, 0.7);
    for (let i = 0; i < Math.round(p.bursts); i++) {
      const S = V.sub({ pan: E.pick(-0.75, 0.75), lp: E.pick(1800, 3200), gain: E.pick(0.45, 0.75) });
      V.thump(tb, 135, 52, 0.05, 0.4, 0.55, { drive: 2, out: S });
      V.burst(tb, 'pink', { type: 'lowpass', f: 2600, f1: 450, sweep: 0.2, attack: 0.001, decay: 0.45, peak: 0.5, out: S });
      V.crackle(tb + 0.01, { rate: 1.7, f: 2200, attack: 0.005, decay: 0.3, peak: 0.35, out: S });
      tb += E.pick(0.05, 0.19);
    }
    V.wet(0.9);
    V.finish();
  },
};

// ---------------------------------------------------------------------------------------------
// Superbronie

export const hexlance = {
  id: 'hexlance',
  group: 'Superbronie',
  name: 'Hexlance',
  desc: 'Ładowanie z iskrzeniem, zassanie powietrza i wyładowanie.',
  params: [{ id: 'charge', name: 'Ładowanie', min: 0.8, max: 3, step: 0.1, value: 2.2, unit: ' s' }],
  length: (p) => p.charge + 4.2,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const T = p.charge;
    const tf = t + T;
    // narastający ton z przyspieszającym tremolo
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [T - 0.03, 0.34, 'l'], [T - 0.015, 0, 'l']]);
    const trem = V.gain(0.55);
    const lfo = V.osc('sine', 4, t);
    lfo.frequency.exponentialRampToValueAtTime(34, tf);
    const lg = V.gain(0.45);
    V.chain(lfo, lg);
    lg.connect(trem.gain);
    const f = V.lp(380, 6, t);
    f.frequency.exponentialRampToValueAtTime(6500, tf);
    const o1 = V.osc('sawtooth', 70, t);
    o1.frequency.exponentialRampToValueAtTime(1450, tf);
    const o2 = V.osc('sine', 140, t);
    o2.frequency.exponentialRampToValueAtTime(2900, tf);
    V.endOf(o1, tf);
    V.endOf(o2, tf);
    V.endOf(lfo, tf);
    V.chain(o1, f);
    V.chain(o2, V.gain(0.5), f);
    V.chain(f, trem, bus, V.in);
    // iskrzenie coraz gęściej
    let tc = t + 0.15;
    while (tc < tf - 0.05) {
      const x = (tc - t) / T;
      V.burst(tc, 'white', { type: 'highpass', f: E.pick(2500, 6000), attack: 0.0004, decay: E.pick(0.012, 0.03), peak: E.pick(0.06, 0.2) * (0.4 + x), out: V.sub({ pan: E.pick(-0.8, 0.8) }) });
      tc += lerp(0.22, 0.018, Math.pow(x, 0.7)) * E.vary(1, 0.4);
    }
    // zassanie tuż przed strzałem
    const sw = V.noise('pink', 1, tf - 0.5);
    const swf = V.lp(250, 1, tf - 0.5);
    swf.frequency.exponentialRampToValueAtTime(12000, tf - 0.02);
    const swg = V.gain(0);
    V.env(swg.gain, tf - 0.5, [[0, 0.002, 's'], [0.47, 0.55, 'e'], [0.485, 0, 'l']], true);
    V.endOf(sw, tf);
    V.chain(sw, swf, swg, V.in);
    // wyładowanie po krótkiej ciszy
    const tx = tf + 0.005;
    V.burst(tx, 'white', { type: 'highpass', f: 900, attack: 0.0005, decay: 0.28, peak: 1 });
    V.thump(tx, 112, 30, 0.4, 2.4, 0.9, { drive: 3.6 });
    V.burst(tx, 'pink', { type: 'bandpass', f: 900, Q: 0.7, attack: 0.002, decay: 0.9, peak: 0.6 });
    for (const [fr, pn] of [[220, -0.4], [277.2, 0.4], [330, 0]]) {
      const o = V.osc('sawtooth', fr, tx);
      o.frequency.exponentialRampToValueAtTime(fr * 0.25, tx + 1.1);
      const lp = V.lp(8000, 1.5, tx);
      lp.frequency.exponentialRampToValueAtTime(380, tx + 1.2);
      const g = V.gain(0);
      V.ad(g.gain, tx, 0.13, 0.003, 1.6);
      V.endOf(o, tx + 1.62);
      V.chain(o, lp, g, V.sub({ pan: pn }));
    }
    V.crackle(tx, { rate: 2, f: 5200, Q: 0.8, attack: 0.01, decay: 3.0, peak: 0.6 });
    V.burst(tx, 'brown', { type: 'lowpass', f: 160, attack: 0.05, decay: 4.0, peak: 0.9 });
    V.wet(1.1);
    V.finish();
  },
};

export const mjolnir = {
  id: 'mjolnir',
  group: 'Superbronie',
  name: 'Mjolnir',
  desc: 'Ładowanie (buczenie, pisk, przyspieszający puls), cisza i strzał.',
  params: [{ id: 'charge', name: 'Ładowanie', min: 1, max: 4, step: 0.1, value: 3, unit: ' s' }],
  length: (p) => p.charge + 5.4,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const T = p.charge;
    const tf = t + T;
    const gap = 0.12;
    const tq = tf - gap; // koniec ładowania — chwila ciszy przed strzałem
    // buczenie
    const hb = V.gain(0);
    V.env(hb.gain, t, [[0, 0, 's'], [T - gap, 0.36, 'l'], [T - gap + 0.02, 0, 'l']]);
    const hf = V.lp(170, 3, t);
    hf.frequency.exponentialRampToValueAtTime(950, tq);
    for (const mul of [1, 1.006, 2.01]) {
      const o = V.osc('sawtooth', 41 * mul, t);
      o.frequency.exponentialRampToValueAtTime(98 * mul, tq);
      V.endOf(o, tq + 0.03);
      V.chain(o, V.gain(mul > 2 ? 0.3 : 0.5), hf);
    }
    V.chain(hf, hb, V.in);
    // pisk kondensatorów
    const w = V.osc('sine', 2000, t);
    w.frequency.exponentialRampToValueAtTime(9800, tq);
    const wg = V.gain(0);
    V.env(wg.gain, t, [[0, 0, 's'], [T - gap, 0.05, 'l'], [T - gap + 0.01, 0, 'l']]);
    V.endOf(w, tq + 0.02);
    V.chain(w, wg, V.in);
    // puls coraz szybciej
    let tp = t + 0.2;
    let iv = 0.6;
    while (tp < tq - 0.05) {
      const x = (tp - t) / T;
      V.thump(tp, 82, 40, 0.06, 0.24, 0.3 + 0.45 * x, { drive: 1.5 });
      tp += iv;
      iv = Math.max(0.1, iv * 0.83);
    }
    // iskrzenie narasta do końca ładowania
    V.crackle(t + 0.3, { rate: 0.9, f: 1500, Q: 0.8, attack: Math.max(0.05, T - gap - 0.32), decay: 0.03, peak: 0.45 });
    // strzał
    V.burst(tf, 'white', { type: 'highpass', f: 700, attack: 0.0005, decay: 0.38, peak: 1 });
    V.thump(tf, 76, 28, 0.6, 3.2, 0.9, { drive: 4.2 });
    V.burst(tf, 'pink', { type: 'bandpass', f: 800, Q: 0.7, attack: 0.002, decay: 1.1, peak: 0.65 });
    V.modal(tf, 182, BAR, [0.36, 0.26, 0.17, 0.11], [2.6, 1.6, 1.0, 0.7], 1, { out: V.sub({ pan: -0.3 }), detune: 0.003 });
    V.modal(tf, 183.4, BAR, [0.36, 0.26, 0.17, 0.11], [2.4, 1.5, 0.9, 0.6], 1, { out: V.sub({ pan: 0.3 }), detune: 0.003 });
    V.burst(tf, 'pink', { type: 'lowpass', f: 5200, f1: 120, sweep: 1.5, Q: 0.8, attack: 0.002, decay: 3.0, peak: 0.95 });
    V.burst(tf + 0.02, 'brown', { type: 'lowpass', f: 125, attack: 0.08, decay: 5.0, peak: 1 });
    V.wet(1.15);
    V.finish();
  },
};
