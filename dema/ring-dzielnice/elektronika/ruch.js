// Dzielnica „Zakłady elektroniki” — RUCH (czysta symulacja, bez three i DOM; test kroczy nią w Node).
//
// Trzy linie pracują w partiach: praca (postęp 0 → 1) → wysyłka partii do magazynu (kilka sekund) → co kilka partii
// przezbrojenie (lampa stanu czerwona). Z pracy linii wynikają: obciążenie cieplne pól radiatorów (pulsuje w takt
// kroków linii), zapas w magazynach (rośnie z partią; gdy magazyn jest prawie pełny, transport zabiera większą część), wygrzanie pieców optyki,
// próba soczewek w kolimatorze (kopuła obraca szczelinę, potem biegną światła tunelu), kursy suwnicy na placu szpul.
// Statki: dostawcy na drodze i masowiec z rudą krzemu w doku od strony przestrzeni. Czasy są umowne (panel: tempo).
import { RING_V, yardPoint, yardTangent } from '../kit/uklad.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export const RUCH = Object.freeze({
  shipTime: 6,          // wysyłka partii do magazynu [s]
  retoolEvery: 5,       // co ile partii przezbrojenie
  retoolTime: 11,
  testTime: 15,         // próba w kolimatorze po partii soczewek
  slewTime: 7,          // obrót kopuły przed próbą
  crane: Object.freeze({ pick: 3, travel: 10, drop: 3, back: 9, wait: 2 }),
  roadSpeed: 300,
  bulk: Object.freeze({ approach: 26, dwell: 46, leave: 20, pause: 14, far: 13600 })
});

export function createRuch(layout, { yard, bulkBerth = null } = {}) {
  const lines = layout.lines.map((L, i) => ({
    id: L.id, name: L.name, takt: L.takt,
    t: L.takt * [0.35, 0.7, 0.1][i], phase: 'praca', progress: 0, batches: 0, working: 1,
    pulse: [2.6, 4.2, 1.9][i], heat: 0.5, stock: [0.45, 0.3, 0.6][i], hauls: 0, shipping: 0
  }));
  const S = {
    time: 0,
    lines,
    power: 0.5,
    test: { on: 0, t: 0, slew: 0, queued: false },
    dome: { az: 0.6, from: 0.6, to: 0.6 },
    crane: { t: 0, u: yard.pick.u, w: yard.home, lift: 1, carry: 0, moves: 0 },
    bulk: { t: 8, phase: 'approach', v: RUCH.bulk.far, opacity: 0, speed: 0, calls: 0 }
  };
  const C = RUCH.crane;
  const craneCycle = C.pick + C.travel + C.drop + C.back + C.wait;

  function stepLine(L, dt) {
    L.t += dt;
    if (L.phase === 'praca') {
      L.progress = clamp01(L.t / L.takt);
      if (L.t >= L.takt) { L.phase = 'wysyłka'; L.t = 0; L.batches++; }
    } else if (L.phase === 'wysyłka') {
      L.progress = 1;
      if (L.t >= RUCH.shipTime) {
        L.stock = clamp01(L.stock + 0.21);
        // magazyn prawie pełny: transport zabiera większą część zapasu
        if (L.stock > 0.86) { L.stock -= 0.62; L.hauls++; }
        L.t = 0;
        L.progress = 0;
        L.phase = L.batches % RUCH.retoolEvery === 0 ? 'przezbrojenie' : 'praca';
        if (L.id === 'optic_lens') S.test.queued = true;
      }
    } else if (L.t >= RUCH.retoolTime) {
      L.phase = 'praca';
      L.t = 0;
    }
    L.working = L.phase === 'przezbrojenie' ? 0 : 1;
    L.shipping = L.phase === 'wysyłka' ? 1 : 0;
    const beat = 0.5 + 0.5 * Math.sin((S.time * Math.PI * 2) / L.pulse);
    const target = L.phase === 'praca' ? 0.5 + 0.42 * beat : L.phase === 'wysyłka' ? 0.42 : 0.14;
    L.heat += (target - L.heat) * (1 - Math.exp(-dt / 0.7));
  }

  function stepTest(dt) {
    const T = S.test;
    if (!T.on && !T.slew && T.queued) {
      T.queued = false;
      T.slew = 1;
      T.t = 0;
      S.dome.from = S.dome.az;
      S.dome.to = S.dome.az + 1.1 + 3.4 * hash(lines[1].batches * 3.7);
    }
    if (T.slew) {
      T.t += dt;
      S.dome.az = S.dome.from + (S.dome.to - S.dome.from) * smooth(T.t / RUCH.slewTime);
      if (T.t >= RUCH.slewTime) { T.slew = 0; T.on = 1; T.t = 0; }
    } else if (T.on) {
      T.t += dt;
      if (T.t >= RUCH.testTime) { T.on = 0; T.t = 0; }
    }
  }

  function stepCrane(dt) {
    const K = S.crane;
    const tape = lines[2];
    // suwnica pracuje, gdy linia taśmy nie jest w przezbrojeniu; rozpoczęty kurs zawsze kończy
    if (K.t === 0 && !tape.working) return;
    K.t += dt;
    let t = K.t;
    const a = yard.pick;
    const b = yard.drop;
    if (t < C.pick) {
      K.u = a.u; K.w = a.w; K.carry = t > C.pick * 0.5 ? 1 : 0;
      K.lift = 1 - Math.sin((t / C.pick) * Math.PI);
    } else if ((t -= C.pick) < C.travel) {
      const k = smooth(t / C.travel);
      K.u = a.u + (b.u - a.u) * k; K.w = a.w + (b.w - a.w) * smooth(t / (C.travel * 0.6)); K.carry = 1; K.lift = 1;
    } else if ((t -= C.travel) < C.drop) {
      K.u = b.u; K.w = b.w; K.carry = t < C.drop * 0.5 ? 1 : 0;
      K.lift = 1 - Math.sin((t / C.drop) * Math.PI);
    } else if ((t -= C.drop) < C.back) {
      const k = smooth(t / C.back);
      K.u = b.u + (a.u - b.u) * k; K.w = b.w + (a.w - b.w) * k; K.carry = 0; K.lift = 1;
    } else {
      K.u = a.u; K.w = a.w; K.carry = 0; K.lift = 1;
    }
    if (K.t >= craneCycle) { K.t = 0; K.moves++; }
  }

  function stepBulk(dt) {
    const B = S.bulk;
    if (!bulkBerth) return;
    const Q = RUCH.bulk;
    const near = bulkBerth.v;
    B.t += dt;
    if (B.phase === 'approach') {
      const k = smooth(B.t / Q.approach);
      B.v = Q.far + (near - Q.far) * k;
      B.opacity = clamp01(B.t / 3);
      B.speed = -1;
      if (B.t >= Q.approach) { B.phase = 'dwell'; B.t = 0; B.calls++; }
    } else if (B.phase === 'dwell') {
      B.v = near; B.opacity = 1; B.speed = 0;
      if (B.t >= Q.dwell) { B.phase = 'leave'; B.t = 0; }
    } else if (B.phase === 'leave') {
      const k = smooth(B.t / Q.leave);
      B.v = near + (Q.far - near) * k;
      B.opacity = clamp01((Q.leave - B.t) / 3);
      B.speed = 1;
      if (B.t >= Q.leave) { B.phase = 'pause'; B.t = 0; }
    } else {
      B.v = Q.far; B.opacity = 0; B.speed = 0;
      if (B.t >= Q.pause) { B.phase = 'approach'; B.t = 0; }
    }
  }

  function step(dt) {
    if (!(dt > 0)) return;
    // krok dzielony: przy tempie ×12 i rzadkich klatkach pojedynczy dt bywa długi
    let left = Math.min(dt, 30);
    while (left > 1e-6) {
      const h = Math.min(left, 0.1);
      left -= h;
      S.time += h;
      for (const L of lines) stepLine(L, h);
      stepTest(h);
      stepCrane(h);
      stepBulk(h);
      const want = 0.3 + 0.2 * (lines[0].heat + lines[1].heat + lines[2].heat);
      S.power += (want - S.power) * (1 - Math.exp(-h / 1.5));
    }
  }

  /** Statki na drodze: [{ id, hullId, x, z, heading, opacity, vx, vz }] — dwa pasem zakładów (+s), jeden pasem ringu (−s). */
  const ROAD = [
    { id: 'el-dostawa-1', hullId: 'container_ship', dir: 1, off: 0 },
    { id: 'el-dostawa-2', hullId: 'long_haul_freighter', dir: 1, off: 0.52 },
    { id: 'el-kurier', hullId: 'inter_station_shuttle', dir: -1, off: 0.3 }
  ];
  const out = [];
  function ships() {
    out.length = 0;
    const E = layout.extent;
    const span = 2 * E - 2000;
    for (const r of ROAD) {
      const d = ((S.time * RUCH.roadSpeed) / span + r.off) % 1;
      const s = r.dir > 0 ? -E + 1000 + d * span : E - 1000 - d * span;
      const [x, z] = yardPoint(s, RING_V.road + r.dir * RING_V.laneOff);
      const h = r.dir > 0 ? yardTangent(s) : yardTangent(s) + Math.PI;
      const edge = Math.min(1, (s + E - 1000) / 1500, (E - 1000 - s) / 1500);
      out.push({ id: r.id, hullId: r.hullId, x, z, heading: h, opacity: clamp01(edge), vx: Math.cos(h) * RUCH.roadSpeed, vz: Math.sin(h) * RUCH.roadSpeed, throttle: 0.5 });
    }
    if (bulkBerth && S.bulk.opacity > 0.01) {
      const B = S.bulk;
      const [x, z] = yardPoint(bulkBerth.s, B.v);
      const h = bulkBerth.heading;
      // kurs = dziobem do doku; odejście rufą naprzód (holowanie)
      const sp = B.speed * 170;
      out.push({ id: 'el-masowiec', hullId: 'long_haul_freighter', x, z, heading: h, opacity: B.opacity, vx: -Math.cos(h) * sp, vz: -Math.sin(h) * sp, throttle: B.speed < 0 ? 0.35 : 0 });
    }
    return out;
  }

  return { state: S, step, ships, craneCycle };
}
