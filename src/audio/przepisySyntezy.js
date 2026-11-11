// Przepisy syntezy używane przez grę (src/audio/dzwiekiGry.js) i demo dema/dzwieki.html: seria Vulcan / CIWS
// (przyjęta z dema 2026-11-11), silnik MAIN (druga wersja — rakietowa; pierwszą, z tonem turbiny, użytkownik
// wyrzucił: „wyje jak suszarka”) i silniki SIDE. Reszta dema zostaje w dema/dzwieki/ (gra jej nie importuje).
// Przepis = { id, params, play(E, p, at) → uchwyt }.
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

// Silnik MAIN — silnik rakietowy. Pierwsza wersja („dudnienie, ryk, ton i turbina”) miała dwa czyste tony turbiny
// (sinusy 900 i 1350 Hz jadące z ciągiem do 2,6 i 3,9 kHz, 30–35 dB ponad szum) i piły w kwincie — użytkownik
// 2026-11-11: „wyje jak suszarka, do kosza go”. Tu nie ma żadnego tonu powyżej basu: dudnienie i ryk to szerokie
// pasma szumu, ciężar daje jeden niski sinus, fakturę — trzask płomienia. Ta sama rodzina co silniki SIDE (niżej),
// większa dysza: pasma niżej, wolniejsze narastanie. Nie dodawaj oscylatorów powyżej ~100 Hz.
/** Niski sinus silnika MAIN [Hz] — jedyny oscylator dźwięku w przepisie. */
const SUB_MAIN = 32;
export const engineMain = {
  id: 'silnik',
  group: 'Okręt',
  name: 'Silnik MAIN',
  desc: 'Silnik rakietowy: dudnienie, ryk i trzask płomienia, bez tonu turbiny. Suwaki działają na żywo.',
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
    V.env(master.gain, t, [[0, 0, 's'], [0.5, 1, 'l']]);
    // dudnienie, ryk
    const ruf = V.lp(80, 0.8, t);
    const rug = V.gain(0);
    V.chain(V.noise('brown', 1, t), ruf, rug, master);
    const rof = V.bp(200, 0.6, t);
    const rog = V.gain(0);
    V.chain(V.noise('pink', 1, t), rof, rog, master);
    // ciężar: jeden niski sinus z powolnym pływaniem stroju
    const sub = V.osc('sine', SUB_MAIN, t);
    const drift = V.osc('sine', 0.11, t);
    const dg = V.gain(5);
    V.chain(drift, dg);
    dg.connect(sub.detune);
    const subg = V.gain(0);
    V.chain(sub, subg, master);
    // trzask płomienia — dochodzi z ciągiem
    const crg = V.gain(0);
    V.chain(V.noise('crackle', 1.1, t), V.bp(700, 0.7, t), crg, master);
    // dopalacz: gęstszy trzask i szum wylotu (pasmo środka, nie syk)
    const bog = V.gain(0);
    V.chain(V.noise('crackle', 1.3, t), V.bp(1200, 0.6, t), bog, master);
    const bhg = V.gain(0);
    V.chain(V.noise('pink', 1, t), V.bp(1700, 0.5, t), bhg, master);
    V.chain(master, V.in);
    const st = { thr: p.throttle, boost: p.boost ? 1 : 0 };
    const apply = (tt, tau) => {
      const x = st.thr;
      const b = st.boost;
      ruf.frequency.setTargetAtTime(80 + 300 * x + 140 * b, tt, tau);
      rug.gain.setTargetAtTime(0.42 + 0.58 * x + 0.3 * b, tt, tau);
      rof.frequency.setTargetAtTime(200 + 620 * x + 350 * b, tt, tau);
      rog.gain.setTargetAtTime(0.07 + 0.55 * x + 0.35 * b, tt, tau);
      sub.frequency.setTargetAtTime(SUB_MAIN * (1 + 0.25 * x + 0.1 * b), tt, tau * 1.5);
      subg.gain.setTargetAtTime(0.1 + 0.12 * x, tt, tau);
      crg.gain.setTargetAtTime(0.3 * x * x, tt, tau);
      bog.gain.setTargetAtTime(0.6 * b, tt, tau * 0.5);
      bhg.gain.setTargetAtTime(0.14 * b, tt, tau * 0.5);
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
        V.burst(tt, 'pink', { type: 'bandpass', f: 300, f1: 1800, sweep: 0.35, Q: 1.0, attack: 0.05, decay: 0.5, peak: 0.6 });
      }
    };
    h.onRelease((tr) => {
      E.hold(master.gain, tr);
      master.gain.setTargetAtTime(0, tr, 0.35);
      sub.detune.setValueAtTime(0, tr);
      sub.detune.linearRampToValueAtTime(-900, tr + 1.2);
      V.stop(tr + 1.5);
    });
    V.start();
    return h;
  },
};

// Silniki SIDE: mniejsze silniki rakietowe burt o pracy ciągłej. Decyzja użytkownika 2026-11-11: „sam syk nic nie
// robi — bo side to też silniki rakietowe z ciągłą pracą”. Budowa jak silnik MAIN (dudnienie, ryk, ton), pasma
// wyżej (mniejsza dysza), szybsze narastanie i gaśnięcie, zapłon z krótkim kopnięciem; syk dyszy to tylko dodatek.
export const engineSide = {
  id: 'silnikSide',
  group: 'Okręt',
  name: 'Silniki SIDE',
  desc: 'Mniejszy silnik rakietowy burty: zapłon, ryk, dudnienie i ton. Praca ciągła.',
  hold: true,
  params: [
    { id: 'throttle', name: 'Ciąg', min: 0, max: 1, step: 0.01, value: 0.7 },
  ],
  length: (p, hold) => hold + 0.8,
  play(E, p, at) {
    const V = E.voice(at);
    const h = E.handle(V);
    const t = V.t;
    const master = V.gain(0);
    V.env(master.gain, t, [[0, 0, 's'], [0.12, 1, 'l']]);
    // dudnienie, ryk
    const ruf = V.lp(150, 0.8, t);
    const rug = V.gain(0);
    V.chain(V.noise('brown', 1, t), ruf, rug, master);
    const rof = V.bp(480, 0.7, t);
    const rog = V.gain(0);
    V.chain(V.noise('pink', 1, t), rof, rog, master);
    // ton: piły w kwincie + sub, oktawę nad silnikiem MAIN
    const DR = [72, 108, 36];
    const dr = [V.osc('sawtooth', DR[0], t), V.osc('sawtooth', DR[1], t), V.osc('sine', DR[2], t)];
    const drf = V.lp(280, 2, t);
    const drift = V.osc('sine', 0.21, t);
    const dg = V.gain(6);
    V.chain(drift, dg);
    dr.forEach((o, i) => {
      dg.connect(o.detune);
      V.chain(o, V.gain(i === 2 ? 0.8 : 0.45), drf);
    });
    V.chain(drf, V.gain(0.16), master);
    // syk dyszy — cicho, pod rykiem
    const hig = V.gain(0);
    V.chain(V.noise('white', 1, t), V.hp(3000, 0.7, t), hig, master);
    V.chain(master, V.in);
    const st = { thr: p.throttle };
    const apply = (tt, tau) => {
      const x = st.thr;
      ruf.frequency.setTargetAtTime(150 + 380 * x, tt, tau);
      rug.gain.setTargetAtTime(0.3 + 0.45 * x, tt, tau);
      rof.frequency.setTargetAtTime(480 + 1000 * x, tt, tau);
      rog.gain.setTargetAtTime(0.12 + 0.5 * x, tt, tau);
      const pm = 1 + 0.3 * x;
      dr.forEach((o, i) => o.frequency.setTargetAtTime(DR[i] * pm, tt, tau * 1.5));
      drf.frequency.setTargetAtTime(280 + 480 * x, tt, tau);
      hig.gain.setTargetAtTime(0.02 + 0.05 * x, tt, tau);
    };
    apply(t, 0.01);
    // zapłon: kopnięcie i podmuch
    V.thump(t, 96, 46, 0.09, 0.4, 0.4, { drive: 2 });
    V.burst(t, 'pink', { type: 'bandpass', f: 420, f1: 2200, sweep: 0.22, Q: 1.1, attack: 0.02, decay: 0.3, peak: 0.4 });
    h.params.throttle = (v, tt) => {
      st.thr = v;
      apply(tt, 0.12);
    };
    h.onRelease((tr) => {
      E.hold(master.gain, tr);
      master.gain.setTargetAtTime(0, tr, 0.14);
      for (const o of dr) {
        o.detune.setValueAtTime(0, tr);
        o.detune.linearRampToValueAtTime(-700, tr + 0.6);
      }
      V.stop(tr + 0.8);
    });
    V.start();
    return h;
  },
};
