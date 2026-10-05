// Sceny — dźwięki złożone z innych przepisów (dema/dzwieki.html).
import { cannon, railgun, gatling, laserPD, flak } from './bronie.js';
import { salvo } from './rakiety.js';
import { explosion } from './wybuchy.js';
import { hullHit, ricochet, shieldHit, engineMain } from './okret.js';
import { alarm } from './interfejs.js';

export const battle = {
  id: 'bitwa',
  group: 'Sceny',
  name: 'Bitwa',
  desc: 'Losowa bitwa wokół okrętu: działa, rakiety, trafienia, wybuchy w oddali.',
  hold: true,
  wavHold: 16,
  params: [{ id: 'intensity', name: 'Natężenie', min: 0.2, max: 1, step: 0.01, value: 0.6 }],
  length: (p, hold) => hold + 5,
  play(E, p, at) {
    const V = E.voice({ ...at, dist: 0, pan: 0 });
    const h = E.handle(V);
    const t = V.t;
    const st = { k: p.intensity };
    const engine = E.play(engineMain, { throttle: 0.45 }, { dist: 0, pan: 0, t, gain: 0.55 });
    const far = (pos) => ({ ...pos, dist: Math.max(pos.dist, 0.35) });
    const near = (ts) => ({ pan: E.pick(-0.5, 0.5), dist: E.pick(0, 0.1), t: ts });
    const n = (a, b) => a + Math.floor(E.rand() * (b - a + 1));
    const EVENTS = [
      [3, (ts, pos) => E.play(cannon, { size: E.pick(0.3, 1) }, { ...pos, t: ts })],
      [2, (ts, pos) => E.play(railgun, { power: E.rand() }, { ...pos, t: ts })],
      [1.5, (ts, pos) => E.play(gatling, { rate: E.pick(35, 60), size: E.rand() * 0.5 }, { ...pos, t: ts }).release(ts + E.pick(0.4, 1.1))],
      [1.2, (ts, pos) => E.play(laserPD, { pulses: n(1, 4) }, { ...pos, t: ts })],
      [0.8, (ts, pos) => E.play(salvo, { count: n(3, 8), kind: E.rand() < 0.5 ? 'micro' : 'cruise' }, { ...pos, t: ts })],
      [1.4, (ts, pos) => E.play(explosion, { size: E.rand() }, { ...far(pos), t: ts })],
      [1.3, (ts) => E.play(shieldHit, { power: E.rand() }, near(ts))],
      [0.9, (ts) => E.play(hullHit, { caliber: E.rand() }, near(ts))],
      [0.5, (ts, pos) => E.play(flak, { bursts: n(3, 6) }, { ...pos, t: ts })],
      [0.3, (ts) => E.play(ricochet, {}, near(ts))],
      [0.12, (ts) => E.play(alarm, {}, { t: ts, gain: 0.7 }).release(ts + 1.5)],
    ];
    const total = EVENTS.reduce((s, e) => s + e[0], 0);
    E.loop(h, t + 0.3, (ts) => {
      let r = E.rand() * total;
      let ev = EVENTS[0][1];
      for (const [w, fn] of EVENTS) {
        r -= w;
        if (r <= 0) {
          ev = fn;
          break;
        }
      }
      ev(ts, { pan: E.pick(-0.95, 0.95), dist: E.pick(0.1, 0.95) });
      return ts + E.pick(0.12, 0.9) / (0.4 + st.k);
    });
    h.params.intensity = (v) => {
      st.k = v;
    };
    h.onRelease((tr) => {
      engine.release(tr);
      V.stop(tr + 0.1);
    });
    V.start();
    return h;
  },
};

const CHIRP = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];

export const bridge = {
  id: 'mostek',
  group: 'Sceny',
  name: 'Mostek — tło',
  desc: 'Buczenie zasilania, wentylacja, odgłosy komputerów i jęki kadłuba.',
  hold: true,
  wavHold: 14,
  params: [],
  length: (p, hold) => hold + 1.5,
  play(E, p, at) {
    const V = E.voice({ ...at, dist: 0 });
    const h = E.handle(V);
    const t = V.t;
    const bus = V.gain(0);
    V.env(bus.gain, t, [[0, 0, 's'], [1, 1, 'l']]);
    // zasilanie 50 Hz z harmonicznymi, głośność powoli płynie
    const mains = V.gain(0.75);
    const ml = V.osc('sine', 0.07, t);
    const mlg = V.gain(0.25);
    V.chain(ml, mlg);
    mlg.connect(mains.gain);
    [[50, 0.12], [100, 0.07], [150, 0.035], [200, 0.02]].forEach(([f, a]) => V.chain(V.osc('sine', f, t), V.gain(a), mains));
    V.chain(mains, bus);
    // wentylacja
    V.chain(V.noise('pink', 1, t), V.lp(900, 0.7, t), V.hp(140, 0.7, t), V.gain(0.12), bus);
    V.chain(bus, V.in);
    // zdarzenia: komputer, jęk kadłuba, tyknięcie metalu
    E.loop(h, t + E.pick(1, 2.5), (ts) => {
      const C = E.voice({ t: ts }, { parent: V });
      const r = E.rand();
      if (r < 0.45) {
        const notes = 2 + Math.floor(E.rand() * 3);
        for (let i = 0; i < notes; i++) {
          C.beep(ts + i * 0.08, CHIRP[Math.floor(E.rand() * CHIRP.length)], 0.06, 0.035, { out: C.sub({ pan: 0.3 }) });
        }
      } else if (r < 0.75) {
        C.groan(ts, { f: E.pick(40, 60), res: E.pick(250, 450), dur: E.pick(1, 1.6), peak: 0.09, out: C.sub({ pan: E.pick(-0.8, 0.8) }) });
      } else {
        C.modal(ts, E.pick(1500, 3500), [1, 2.76], [1, 0.3], [0.25, 0.1], 0.03, { out: C.sub({ pan: E.pick(-0.8, 0.8) }) });
      }
      C.finish();
      return ts + E.pick(2.5, 7);
    });
    h.onRelease((tr) => {
      E.hold(bus.gain, tr);
      bus.gain.setTargetAtTime(0, tr, 0.3);
      V.stop(tr + 1.5);
    });
    V.start();
    return h;
  },
};
