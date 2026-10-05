// Warp „Nurt” — przepisy syntezy (dema/dzwieki.html).
//
// Skok: ładowanie (dron z dudnieniem coraz szybszym, pisk w górę o trzy oktawy, impulsy cewek,
// przyspieszające tremolo), zassanie (szum z otwierającym się filtrem), 60 ms ciszy i skok:
// trzask, opadający sub, szum odlatujący w stereo, opadający ton.

export const warpJump = {
  id: 'warpSkok',
  group: 'Warp „Nurt”',
  name: 'Ładowanie i skok',
  desc: 'Dron z dudnieniem, cewki, zassanie, cisza i skok.',
  params: [{ id: 'charge', name: 'Ładowanie', min: 1, max: 5, step: 0.1, value: 2.6, unit: ' s' }],
  length: (p) => p.charge + 3.8,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const T = p.charge;
    const tj = t + T;
    const cut = tj - 0.06;
    // szyna ładowania z przyspieszającym tremolo
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [T - 0.06, 1, 'l'], [T - 0.05, 0, 'l']]);
    const trem = V.gain(0.65);
    const tl = V.osc('sine', 2.5, t);
    tl.frequency.exponentialRampToValueAtTime(24, cut);
    const tg = V.gain(0.35);
    V.chain(tl, tg);
    tg.connect(trem.gain);
    V.endOf(tl, tj);
    // dron: dwie piły, dudnienie przyspiesza
    const df = V.lp(280, 3, t);
    df.frequency.exponentialRampToValueAtTime(3400, cut);
    const d1 = V.osc('sawtooth', 55, t);
    d1.frequency.exponentialRampToValueAtTime(82.5, cut);
    const d2 = V.osc('sawtooth', 55.5, t);
    d2.frequency.exponentialRampToValueAtTime(92.4, cut);
    V.endOf(d1, tj);
    V.endOf(d2, tj);
    V.chain(d1, V.gain(0.3), df);
    V.chain(d2, V.gain(0.3), df);
    V.chain(df, trem);
    // pisk w górę
    const w = V.osc('sine', 220, t);
    w.frequency.exponentialRampToValueAtTime(1760, cut);
    const w2 = V.osc('triangle', 440, t);
    w2.frequency.exponentialRampToValueAtTime(3520, cut);
    const wg = V.gain(0);
    V.env(wg.gain, t, [[0, 0, 's'], [T - 0.06, 0.12, 'l']]);
    V.endOf(w, tj);
    V.endOf(w2, tj);
    V.chain(w, wg);
    V.chain(w2, V.gain(0.35), wg);
    V.chain(wg, trem);
    // powietrze
    const ai = V.noise('white', 1, t);
    const af = V.bp(800, 1.5, t);
    af.frequency.exponentialRampToValueAtTime(6500, cut);
    const ag = V.gain(0);
    V.env(ag.gain, t, [[0, 0.001, 's'], [T - 0.06, 0.5, 'e']]);
    V.endOf(ai, tj);
    V.chain(ai, af, ag, trem);
    V.chain(trem, bus, V.in);
    // cewki — impulsy coraz gęściej
    let tp = t + 0.25;
    let iv = 0.45;
    while (tp < cut - 0.03) {
      const x = (tp - t) / T;
      V.thump(tp, 72, 36, 0.05, 0.2, 0.18 + 0.4 * x, { drive: 1.6 });
      tp += iv;
      iv = Math.max(0.055, iv * 0.82);
    }
    // zassanie
    const sw = V.noise('pink', 1, tj - 0.55);
    const swf = V.lp(260, 1, tj - 0.55);
    swf.frequency.exponentialRampToValueAtTime(14000, cut);
    const swg = V.gain(0);
    V.env(swg.gain, tj - 0.55, [[0, 0.002, 's'], [0.49, 0.65, 'e'], [0.5, 0, 'l']], true);
    V.endOf(sw, tj);
    V.chain(sw, swf, swg, V.in);
    // SKOK
    V.burst(tj, 'white', { type: 'highpass', f: 800, attack: 0.0005, decay: 0.3, peak: 0.9 });
    V.thump(tj, 96, 28, 0.9, 2.6, 0.9, { drive: 4 });
    for (const [pn, f0, f1, d] of [[-0.6, 7000, 120, 1.4], [0.6, 6000, 140, 1.6]]) {
      const src = V.noise('pink', 1, tj);
      const b = V.bp(f0, 2, tj);
      b.frequency.exponentialRampToValueAtTime(f1, tj + d);
      const g = V.gain(0);
      V.ad(g.gain, tj, 1.7, 0.005, d + 0.4);
      V.endOf(src, tj + d + 0.45);
      V.chain(src, b, g, V.sub({ pan: pn }));
    }
    const fo = V.osc('sawtooth', 880, tj);
    fo.frequency.exponentialRampToValueAtTime(55, tj + 1.2);
    const fl = V.lp(6000, 1, tj);
    fl.frequency.exponentialRampToValueAtTime(200, tj + 1.3);
    const fg = V.gain(0);
    V.ad(fg.gain, tj, 0.28, 0.002, 1.4);
    V.endOf(fo, tj + 1.42);
    V.chain(fo, fl, fg, V.in);
    V.burst(tj + 0.02, 'brown', { type: 'lowpass', f: 140, attack: 0.06, decay: 3.4, peak: 0.85 });
    V.wet(1.1);
    V.finish();
  },
};

export const warpCruise = {
  id: 'warpLot',
  group: 'Warp „Nurt”',
  name: 'Lot w warpie',
  desc: 'Szum przepływu, płynący akord i sub.',
  hold: true,
  params: [],
  length: (p, hold) => hold + 2,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [1.2, 1, 'l']]);
    // akord: rozstrojone piły, filtr powoli faluje
    const pf = V.lp(700, 3, t);
    const pl = V.osc('sine', 0.09, t);
    const plg = V.gain(350);
    V.chain(pl, plg);
    plg.connect(pf.frequency);
    for (const f of [55, 82.5, 110, 164.8]) {
      for (const d of [-0.0025, 0.0025]) V.chain(V.osc('sawtooth', f * (1 + d), t), V.gain(0.05), pf);
    }
    V.chain(pf, bus);
    // przepływ
    const rf = V.bp(520, 0.8, t);
    const rl = V.osc('sine', 0.21, t);
    const rlg = V.gain(260);
    V.chain(rl, rlg);
    rlg.connect(rf.frequency);
    V.chain(V.noise('pink', 1, t), rf, V.gain(0.5), bus);
    V.chain(V.noise('white', 1, t), V.hp(5000, 0.7, t), V.gain(0.03), bus);
    V.chain(V.osc('sine', 27.5, t), V.gain(0.3), bus);
    // powolne fale głośności
    const sw = V.gain(0.8);
    const sl = V.osc('sine', 0.05, t);
    const slg = V.gain(0.2);
    V.chain(sl, slg);
    slg.connect(sw.gain);
    V.chain(bus, sw, V.in);
    h.onRelease((tr) => {
      E.hold(bus.gain, tr);
      bus.gain.setTargetAtTime(0, tr, 0.45);
      V.stop(tr + 2);
    });
    V.start();
    return h;
  },
};

export const warpExit = {
  id: 'warpWyjscie',
  group: 'Warp „Nurt”',
  name: 'Wyjście z warpa',
  desc: 'Nadlatujący szum, hamowanie, gasnąca energia i stygnący kadłub.',
  params: [],
  length: () => 4.1,
  play(E, p, at) {
    const V = E.voice(at);
    const t = V.t;
    const te = t + 0.7;
    const src = V.noise('pink', 1, t);
    const b = V.bp(150, 2, t);
    b.frequency.exponentialRampToValueAtTime(5000, te);
    const g = V.gain(0);
    V.env(g.gain, t, [[0, 0.01, 's'], [0.68, 1.6, 'e'], [0.72, 0.6, 'l'], [1.1, 0.0003, 'e']], true);
    V.endOf(src, t + 1.15);
    V.chain(src, b, g, V.in);
    V.burst(te, 'white', { type: 'highpass', f: 1500, attack: 0.0005, decay: 0.14, peak: 0.6 });
    V.thump(te, 72, 30, 0.3, 1.8, 0.6, { drive: 3 });
    for (const [f, pn] of [[1760, -0.3], [2640, 0.3]]) {
      const o = V.osc('triangle', f, te);
      o.frequency.exponentialRampToValueAtTime(f / 16, te + 1.4);
      const og = V.gain(0);
      V.ad(og.gain, te, 0.14, 0.01, 1.6);
      V.endOf(o, te + 1.62);
      V.chain(o, og, V.sub({ pan: pn }));
    }
    V.burst(te + 0.02, 'brown', { type: 'lowpass', f: 150, attack: 0.05, decay: 2.2, peak: 0.6 });
    // stygnący kadłub: drobne tyknięcia metalu
    for (let i = 0; i < 9; i++) {
      V.modal(te + 0.6 + E.rand() * 2.4, E.pick(1800, 4200), [1, 2.76], [1, 0.3], [0.15, 0.06], E.pick(0.03, 0.06), { out: V.sub({ pan: E.pick(-0.8, 0.8) }) });
    }
    V.groan(te + 0.9, { f: 50, res: 360, dur: 0.9, peak: 0.12 });
    V.wet(0.95);
    V.finish();
  },
};

export const arrival = {
  id: 'przylot',
  group: 'Warp „Nurt”',
  name: 'Przylot okrętu',
  desc: 'Okręt wpada z daleka i gwałtownie hamuje (doppler).',
  params: [],
  length: () => 2.9,
  play(E, p, at) {
    const V = E.voice({ ...at, reverb: (at.reverb ?? 1) * 1.3 });
    const t = V.t;
    const tb = t + 0.9;
    const dir = E.rand() < 0.5 ? -1 : 1;
    const S = V.sub({ pan: -0.9 * dir });
    S.pan.setValueAtTime(-0.9 * dir, t);
    S.pan.linearRampToValueAtTime(0.25 * dir, tb);
    // świst z dopplerem: wysoko przy nadlocie, opada przy hamowaniu
    const o = V.osc('sawtooth', 1900, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.6);
    o.frequency.exponentialRampToValueAtTime(380, tb + 0.15);
    const of = V.lp(5000, 1.5, t);
    of.frequency.exponentialRampToValueAtTime(900, tb + 0.2);
    const og = V.gain(0);
    V.env(og.gain, t, [[0, 0.002, 's'], [0.85, 0.2, 'e'], [1.3, 0.0005, 'e']], true);
    V.endOf(o, t + 1.35);
    V.chain(o, of, og, S);
    const nb = V.bp(700, 1.6, t);
    nb.frequency.exponentialRampToValueAtTime(4800, tb);
    nb.frequency.exponentialRampToValueAtTime(260, tb + 0.9);
    const ng = V.gain(0);
    V.env(ng.gain, t, [[0, 0.01, 's'], [0.88, 1.6, 'e'], [1.9, 0.0005, 'e']], true);
    const nz = V.noise('pink', 1, t);
    V.endOf(nz, t + 1.95);
    V.chain(nz, nb, ng, S);
    V.thump(tb, 80, 32, 0.25, 1.5, 0.5, { drive: 2.8 });
    V.burst(tb, 'white', { type: 'highpass', f: 1600, attack: 0.0006, decay: 0.12, peak: 0.45 });
    V.wet(1);
    V.finish();
  },
};
