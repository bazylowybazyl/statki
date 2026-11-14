// DZIELNICA RINGU „FABRYKI PODZESPOŁÓW PRZY STOCZNI” (wtyczka, kontrakt: dema/ring-dzielnice/README.md).
//
// Robi wszystko, co stocznia montuje w kadłub (role ekonomii „Stocznia” bez pochylni i „Zakłady systemowe”):
// Z-1 walcownia i prasownia (płyty kadłuba, podstawy uzbrojenia), Z-2 napędy z HAMOWNIĄ na molu (manewrowe,
// przelotowe, hipercruise, warp), Z-3 reaktory i emitery tarcz ze składem importu (pas MEGA), Z-4 awionika
// i podtrzymywanie życia. Układ: uklad.js, bryły: sceny.js. Ruch: suwnice na placach, próby silników (praca /
// przerwa, płomienie), próby pola warp, rdzenia i emitera, statek dostaw wpływa do doku zakładu napędów.
import { RING_V, arcShiftElements, yardPoint, yardRadial, yardTangent } from '../kit/uklad.js';
import { buildFabrykiLayout } from './uklad.js';
import { buildDrivesScene, buildRollingScene, buildSystemsScene } from './sceny.js';

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const mod = (a, b) => ((a % b) + b) % b;

/** Ciąg na stanowisku w czasie próby (u = 0…1): rozbieg, połowa mocy, pełny ciąg, impulsy, wygaszenie. */
export function standThrottle(u, seed = 0) {
  if (u <= 0 || u >= 1) return 0;
  if (u < 0.12) return 0.55 * smooth(u / 0.12);
  if (u < 0.4) return 0.55 + 0.03 * Math.sin(u * 90 + seed);
  if (u < 0.46) return 0.55 + 0.45 * smooth((u - 0.4) / 0.06);
  if (u < 0.8) return 0.98 + 0.02 * Math.sin(u * 140 + seed);
  if (u < 0.93) return Math.sin((u - 0.8) * 120) > 0 ? 0.95 : 0.45;
  return 0.45 * (1 - smooth((u - 0.93) / 0.07));
}

/** Stan stanowiska prób w chwili t: { work, u, throttle, rest (s do końca przerwy), tests }. */
export function standState(S, t) {
  const cyc = S.work + S.rest;
  const off = S.index * 9.3;
  const tt = t + off;
  const p = mod(tt, cyc);
  const tests = Math.floor(tt / cyc);
  if (p < S.rest) return { work: false, u: 0, throttle: 0, rest: S.rest - p, tests };
  const u = (p - S.rest) / S.work;
  return { work: true, u, throttle: standThrottle(u, S.index * 1.7), rest: 0, tests: tests + (u > 0.99 ? 1 : 0) };
}

/** Cykl wizyty statku dostaw w doku L zakładu napędów (czasy w s). */
const VISIT = { approach: 40, turnIn: 8, enter: 14, stay: 40, exit: 14, turnOut: 8, depart: 28 };
const VISIT_T = Object.values(VISIT).reduce((a, b) => a + b, 0);
/** Poza statku dostaw w chwili t: { s, v, heading, phase, opacity, speed }. */
export function visitPose(berth, t, out = {}) {
  const laneV = RING_V.road + RING_V.laneOff;
  const sc = berth.s;
  const s0 = sc - 6000;
  const s1 = sc + 6000;
  const hT = yardTangent(sc);
  const hR = yardRadial(sc);
  let p = mod(t, VISIT_T);
  out.opacity = 1;
  out.speed = 0;
  const seq = [
    ['approach', VISIT.approach], ['turnIn', VISIT.turnIn], ['enter', VISIT.enter], ['stay', VISIT.stay],
    ['exit', VISIT.exit], ['turnOut', VISIT.turnOut], ['depart', VISIT.depart]
  ];
  for (const [name, d] of seq) {
    if (p > d) { p -= d; continue; }
    const u = p / d;
    out.phase = name;
    if (name === 'approach') {
      const e = 1 - (1 - u) * (1 - u);
      out.s = s0 + (sc - s0) * e;
      out.v = laneV;
      out.heading = yardTangent(out.s);
      out.opacity = Math.min(1, p / 3);
      out.speed = (2 * (1 - u) * (sc - s0)) / d;
    } else if (name === 'turnIn') {
      out.s = sc; out.v = laneV; out.heading = hT + (hR - hT) * smooth(u);
    } else if (name === 'enter') {
      out.s = sc; out.v = laneV + (berth.v - laneV) * smooth(u); out.heading = hR;
      out.speed = 40;
    } else if (name === 'stay') {
      out.s = sc; out.v = berth.v; out.heading = hR;
    } else if (name === 'exit') {
      out.s = sc; out.v = berth.v + (laneV - berth.v) * smooth(u); out.heading = hR;
    } else if (name === 'turnOut') {
      out.s = sc; out.v = laneV; out.heading = hR + (hT - hR) * smooth(u);
    } else {
      out.s = sc + (s1 - sc) * u * u;
      out.v = laneV;
      out.heading = yardTangent(out.s);
      out.opacity = Math.min(1, (d - p) / 3);
      out.speed = (2 * u * (s1 - sc)) / d;
    }
    return out;
  }
  out.phase = 'depart';
  out.s = s1; out.v = laneV; out.heading = yardTangent(s1); out.opacity = 0;
  return out;
}

/** Suwnica: odbiera z hali i odkłada na plac, potem z placu do wysyłki (molo: z placu na stanowisko prób). */
class Gantry {
  constructor(yard, rec, n, layout) {
    this.yard = yard;
    this.rec = rec;
    this.layout = layout;
    const lo = yard.a0 + ((yard.a1 - yard.a0) * rec.index) / n;
    const hi = yard.a0 + ((yard.a1 - yard.a0) * (rec.index + 1)) / n;
    this.lo = lo + (rec.index > 0 ? 260 : 0);
    this.hi = hi - (rec.index < n - 1 ? 260 : 0);
    this.slots = yard.slots.filter((sl) => sl.a >= this.lo && sl.a <= this.hi);
    if (!this.slots.length) this.slots = yard.slots;
    this.a = (this.lo + this.hi) / 2;
    this.c = 0;
    this.load = false;
    this.wait = 1 + rec.index * 3;
    this.seed = 17 + rec.index * 31 + yard.id.charCodeAt(0);
    this.leg = 0;
    this.moves = 0;
    this.target = null;
    this.standTarget = -1;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  slot() { return this.slots[Math.floor(this.rnd() * this.slots.length) % this.slots.length]; }
  handoff() {
    const h = this.yard.handoff;
    return { a: h.a ?? this.lo + (this.hi - this.lo) * (0.15 + 0.7 * this.rnd()), c: h.c };
  }
  plan(t) {
    // kolejne odcinki: [odbiór → odłożenie]; parzyste — z hali na plac, nieparzyste — z placu do wysyłki / na stanowisko
    const even = this.leg % 2 === 0;
    let from;
    let to;
    this.standTarget = -1;
    if (even) { from = this.handoff(); to = this.slot(); } else {
      from = this.slot();
      to = this.handoff();
      if (this.yard.kind === 'pier') {
        // silnik na stanowisko, które ma przerwę (co najmniej 14 s do próby)
        let best = null;
        for (const S of this.layout.stands) {
          const st = standState(S, t);
          if (!st.work && st.rest > 14 && (!best || st.rest > best.rest)) best = { S, rest: st.rest };
        }
        if (best) { to = { a: best.S.a, c: best.S.c }; this.standTarget = best.S.index; }
      }
    }
    this.target = { from, to, stage: 0 };
    this.leg++;
  }
  step(dt, t) {
    if (this.wait > 0) { this.wait -= dt; return; }
    if (!this.target) this.plan(t);
    const tg = this.target;
    const goal = tg.stage === 0 ? tg.from : tg.to;
    const va = this.yard.kind === 'pier' ? 230 : 170;
    const vc = 130;
    const da = goal.a - this.a;
    const dc = goal.c - this.c;
    this.a += Math.sign(da) * Math.min(Math.abs(da), va * dt);
    this.c += Math.sign(dc) * Math.min(Math.abs(dc), vc * dt);
    if (Math.abs(goal.a - this.a) < 0.5 && Math.abs(goal.c - this.c) < 0.5) {
      if (tg.stage === 0) { this.load = true; tg.stage = 1; this.wait = 2.5; } else {
        this.load = false;
        this.target = null;
        this.moves++;
        this.wait = 3 + this.rnd() * 3;
      }
    }
  }
}

const HULLS = {
  'A-L1': 'long_haul_freighter', 'A-L2': 'tanker',
  'B-L1': 'long_haul_freighter', 'B-M1': 'container_ship',
  'C-M1': 'container_ship', 'C-L1': 'tanker',
  'D-M1': 'container_ship', 'D-S1': 'inter_station_shuttle'
};

export default {
  id: 'fabryki',
  name: 'Fabryki podzespołów',
  sub: 'Przy stoczni: walcownia płyt kadłuba, napędy z hamownią na molu, reaktory i emitery tarcz z importem przez pas MEGA, awionika i podtrzymywanie życia.',
  build({ style }) { return buildFabryki({ style }); }
};

/** Budowa wtyczki (osobno, żeby test mógł ją wołać bez gospodarza). */
export function buildFabryki({ style }) {
  const layout = buildFabrykiLayout();
  const scenes = [
    { name: 'Fabryki: walcownia i składy wsadu', scene: buildRollingScene(layout, style) },
    { name: 'Fabryki: napędy i hamownia', scene: buildDrivesScene(layout, style) },
    { name: 'Fabryki: reaktory, tarcze i awionika', scene: buildSystemsScene(layout, style) }
  ];
  const visitBerth = layout.berths.find((b) => b.id === layout.visitBerth);
  const stands = layout.stands;
  const pier = layout.yards.find((y) => y.id === 'B');
  const H3 = stands[2];

  const sim = { t: 0, gantries: [], tests: 0 };
  const visit = {};
  let api0 = null;
  let mats = null;
  const _v = { x: 0, y: 0, z: 0 };

  return {
    layout,
    buildings: scenes,
    hulls: (b) => {
      if (b.id === layout.visitBerth) return null;
      if (b.role === 'import') return 'megafreighter';
      return HULLS[b.id];
    },
    views: [
      {
        name: 'Hamownia', sub: 'molo z czterema stanowiskami prób, płomienie w przestrzeń',
        caption: 'Z-2 Napędy: suwnica wozi silniki z placu na stanowiska H-1…H-4; próba (czerwona lampa, kogut) — płomień w przestrzeń, przerwa — wymiana silnika',
        frame: [yardPoint(layout.pier.s0, layout.pier.v0 - 400), yardPoint(layout.pier.s1, layout.pier.v0 - 400), ...stands.map((S) => S.tip)]
      },
      {
        name: 'Walcownia i plac płyt', sub: 'hala walcowni, prasownia, plac płyt pod dwiema suwnicami',
        caption: 'Z-1: stal z huty przyjeżdża koleją, stop glinu i tytanu ciężarówkami i statkami (doki L); płyty kadłuba i podstawy uzbrojenia jadą ciężarówkami do stoczni',
        at: [-5000, 6000], zoom: 0.13
      },
      {
        name: 'Reaktory, tarcze, import', sub: 'osłonięte komory, próba emitera, pas MEGA ze składem importu',
        caption: 'Z-3: rdzenie reaktorów jadą koleją (przystanek przy zakładzie), emitery tarcz — ciężarówkami; wsad z pasa (nadstop, kompozyt, katalizator, chłodziwo, pręty) przypływa megafrachtowcem',
        at: [3600, 6400], zoom: 0.13
      },
      {
        name: 'Droga przy napędach', sub: 'doki dostaw, zatoki ciężarówek, przystanek kolei NAPĘDY WARP',
        caption: 'Atlas na drodze przed Z-2: statek dostaw wchodzi do doku L, silniki manewrowe i lekkie odbierają ciężarówki, napędy warp i ciężkie — kolej',
        at: [-300, RING_V.road + RING_V.laneOff], heading: yardTangent(-300), zoom: 0.2
      },
      {
        name: 'Awionika', sub: 'hala awioniki i podtrzymywania życia, plac systemów, zatoki',
        caption: 'Z-4: układy i soczewki przyjeżdżają z elektroniki ciężarówkami (lico przy ringu), awionika i podtrzymywanie życia wyjeżdżają ciężarówkami ku stoczni',
        at: [6000, 4700], zoom: 0.24
      },
      {
        name: 'Stanowisko H-3 z bliska', sub: 'napęd przelotowy ciężki na ramie oporowej',
        caption: 'H-3: rama oporowa, kolektor chłodziwa, kogut ostrzegawczy; płomień w czasie próby sięga ~2 250 j. w przestrzeń',
        frame: [pier.frame.at(H3.edge - 700, H3.c - 500), pier.frame.at(H3.edge - 700, H3.c + 500), pier.frame.at(H3.edge + H3.flame, H3.c)]
      }
    ],
    init(api) {
      api0 = api;
      const T3 = api.THREE;
      mats = { m: new T3.Matrix4(), v: new T3.Vector3() };
      const counts = {};
      for (let bi = 0; bi < scenes.length; bi++) {
        for (const g of scenes[bi].scene.rig.gantries || []) counts[g.yard] = (counts[g.yard] || 0) + 1;
      }
      for (let bi = 0; bi < scenes.length; bi++) {
        for (const g of scenes[bi].scene.rig.gantries || []) {
          const yard = layout.yards.find((y) => y.id === g.yard);
          const gy = new Gantry(yard, g, counts[g.yard], layout);
          gy.b = bi;
          sim.gantries.push(gy);
        }
      }
    },
    step(dt) {
      sim.t += dt;
      for (const g of sim.gantries) g.step(dt, sim.t);
    },
    frame(api) {
      const t = sim.t;
      const B = api.buildings;
      // suwnice
      for (const g of sim.gantries) {
        const G = B[g.b].uniforms.uGroup.value;
        const r = g.rec;
        if (r.arc) {
          arcShiftElements(G[r.gG].elements, g.a / r.k, r.sc, 0);
          arcShiftElements(G[r.gT].elements, g.a / r.k, r.sc, g.c);
          if (g.load) arcShiftElements(G[r.gL].elements, g.a / r.k, r.sc, g.c);
          else G[r.gL].elements[15] = 0;
        } else {
          const ax = g.yard.axis;
          const cx = g.yard.cross;
          G[r.gG].makeTranslation(ax[0] * g.a, 0, ax[1] * g.a);
          G[r.gT].makeTranslation(ax[0] * g.a + cx[0] * g.c, 0, ax[1] * g.a + cx[1] * g.c);
          if (g.load) G[r.gL].makeTranslation(ax[0] * g.a + cx[0] * g.c, 0, ax[1] * g.a + cx[1] * g.c);
          else G[r.gL].elements[15] = 0;
        }
      }
      // hamownia: płomienie, lampy stanu, koguty
      const drives = B[1];
      const DG = drives.uniforms.uGroup.value;
      const chans = scenes[1].scene.rig.chans;
      const st = stands.map((S) => standState(S, t));
      for (const S of stands) {
        const s = st[S.index];
        drives._setChan(chans[`stand${S.index}`], s.work ? 0 : 1);
        drives._setChan(chans[`fire${S.index}`], s.work && s.throttle > 0.05 ? 1 : 0);
      }
      for (const fl of scenes[1].scene.rig.flames) {
        const S = stands[fl.stand];
        const thr = st[fl.stand].throttle;
        const m = DG[fl.group];
        if (thr < 0.03) { m.elements[15] = 0; continue; }
        m.makeRotationY(-fl.heading);
        m.scale(mats.v.set(S.flame * Math.pow(thr, 0.7), 1, S.w * (0.7 + 0.3 * thr)));
        m.setPosition(fl.at[0], 0, fl.at[1]);
      }
      // próby pola: warp (Z-2), rdzeń reaktora i emiter tarcz (Z-3)
      drives._setChan(chans.warp, mod(t, 46) < 16 ? 1 : 0);
      const sys = B[2];
      const sc = scenes[2].scene.rig.chans;
      sys._setChan(sc.reactor, mod(t + 20, 54) < 24 ? 1 : 0);
      sys._setChan(sc.shield, mod(t + 7, 38) < 14 ? 1 : 0);
      // statek dostaw: droga → dok L zakładu napędów → droga ku stoczni
      visitPose(visitBerth, t, visit);
      if (visit.opacity > 0.01) {
        const [x, z] = yardPoint(visit.s, visit.v);
        const h = visit.heading;
        api.proxy('fab-dostawa', 'long_haul_freighter', x, z, h, { opacity: visit.opacity, vx: Math.cos(h) * visit.speed, vz: Math.sin(h) * visit.speed, throttle: visit.speed > 5 ? 0.5 : 0 });
      }
      // ruch przelotowy pasem przy ringu (ku −s): frachtowiec z wsadem z huty
      const span = 2 * layout.extent - 3000;
      for (const [k, hull, speed, off] of [[0, 'container_ship', 300, 0], [1, 'tanker', 240, 0.55]]) {
        const d = mod(t * speed + off * span, span);
        const s = layout.extent - 1500 - d;
        const [x, z] = yardPoint(s, RING_V.road - RING_V.laneOff);
        const h = yardTangent(s) + Math.PI;
        const edge = Math.max(0, Math.min(1, d / 1500, (span - d) / 1500));
        api.proxy(`fab-kurs-${k}`, hull, x, z, h, { opacity: edge, vx: Math.cos(h) * speed, vz: Math.sin(h) * speed, throttle: 0.5 });
      }
      void _v;
      void api0;
    },
    hud() {
      const st = stands.map((S) => standState(S, sim.t));
      const parts = stands.map((S, i) => `${S.id} ${st[i].work ? `próba ${Math.round(st[i].throttle * 100)}%` : 'przerwa'}`);
      const loaded = sim.gantries.filter((g) => g.load).length;
      return `<b>Fabryki</b> hamownia: ${parts.join(' · ')} | suwnice z ładunkiem ${loaded}/${sim.gantries.length} | dostawa: ${visit.phase || '—'}`;
    },
    stats() {
      const st = stands.map((S) => standState(S, sim.t));
      return {
        time: Math.round(sim.t * 10) / 10,
        firing: st.filter((s) => s.work && s.throttle > 0.05).length,
        tests: st.reduce((a, s) => a + s.tests, 0),
        gantries: sim.gantries.length,
        gantriesLoaded: sim.gantries.filter((g) => g.load).length,
        gantryMoves: sim.gantries.reduce((a, g) => a + g.moves, 0),
        visit: visit.phase || null
      };
    },
    note: 'Fabryki podzespołów przy stoczni (prototyp układu): Z-1 walcownia i prasownia, Z-2 napędy z hamownią, Z-3 reaktory i emitery tarcz z pasem MEGA importu, Z-4 awionika. Stocznia leży za prawym końcem (+s): odbiór ciężarówkami poboczem od strony przestrzeni (ruch ku +s), duże moduły koleją. Tempo z panelu mnoży czas symulacji.'
  };
}
