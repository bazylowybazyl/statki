// DZIELNICA RINGU „Zbrojownia i skład amunicji” (wtyczka dema/ring-dzielnica.html?d=zbrojownia; kontrakt:
// dema/ring-dzielnice/README.md). Stoi przy suchym doku floty (port leży po stronie −s) i uzbraja okręty Terra Novy.
// Układ: ./uklad.js, bryły: ./sceny.js. Ruch w demie:
//   • stanowiska prób — wieże obracają się ku tarczom na kulochwycie i strzelają seriami (błysk u wylotu, po chwili
//     błysk trafienia; koguty strzelnicy świecą w czasie ognia), bez pocisków;
//   • suwnica placu gotowych wież jeździ po łuku między rzędami i odkłada wieże;
//   • doki uzbrajania: niszczyciele (doki M) podchodzą pasem od strony przestrzeni (ruch ku +s), wchodzą dziobem,
//     ładują amunicję (lampa stanu czerwona, lampy postępu rosną), cofają się na oś drogi, obracają w miejscu i odchodzą
//     pasem przy ringu ku −s (do suchego doku floty); w dokach S i L stoją fregaty i pancerniki (`hulls`) — ładowanie
//     w pętli, po załadunku lampa zielona („gotowy”);
//   • wieże obrony punktowej strzegą pola bunkrów.
import { RING_V, arcShiftElements, yardPoint, yardTangent } from '../kit/uklad.js';
import { AMMO_CH, RANGE_CH, buildAmmoScene, buildArmoryScene, buildRangeScene } from './sceny.js';
import { ZB, buildZbrojowniaLayout } from './uklad.js';

const TAU = Math.PI * 2;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

/** Obrót grupy wokół osi pionowej w punkcie (px, pz): kierunek lufy z +v o kąt `th` (macierz kolumnowa three). */
function rotAbout(e, th, px, pz) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  e[0] = c; e[1] = 0; e[2] = -s; e[3] = 0;
  e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
  e[8] = s; e[9] = 0; e[10] = c; e[11] = 0;
  e[12] = px - (c * px + s * pz); e[13] = 0; e[14] = pz - (-s * px + c * pz); e[15] = 1;
}

// Serie ognia wg rodzaju wieży: liczba strzałów, odstęp [s], długość błysku [s], opóźnienie trafienia [s]
const BURST = {
  kin: { n: 6, gap: 0.32, flash: 0.07, hit: 0.35 },
  rail: { n: 2, gap: 1.3, flash: 0.1, hit: 0.08 },
  laser: { n: 1, gap: 1.0, flash: 0.9, hit: 0.0 },
  plasma: { n: 3, gap: 0.65, flash: 0.12, hit: 0.55 },
  launcher: { n: 4, gap: 0.45, flash: 0.14, hit: 1.4 },
  torpedo: { n: 1, gap: 1.0, flash: 0.25, hit: 2.4 },
  pd: { n: 14, gap: 0.1, flash: 0.04, hit: 0.2 },
  flak: { n: 8, gap: 0.22, flash: 0.06, hit: 0.45 }
};

/** Łamana (s, v) → próbnik pozy w układzie lokalnym (x, z, kurs) po długości. */
function route(pts) {
  const xz = pts.map(([s, v]) => yardPoint(s, v));
  const cum = [0];
  for (let i = 1; i < xz.length; i++) cum.push(cum[i - 1] + Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]));
  const len = cum[cum.length - 1];
  return {
    len,
    at(d, out) {
      const dd = Math.max(0, Math.min(len, d));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < dd) i++;
      const t = (dd - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      out.x = xz[i - 1][0] + (xz[i][0] - xz[i - 1][0]) * t;
      out.z = xz[i - 1][1] + (xz[i][1] - xz[i - 1][1]) * t;
      out.h = Math.atan2(xz[i][1] - xz[i - 1][1], xz[i][0] - xz[i - 1][0]);
      return out;
    }
  };
}
/** Krzywa Béziera w (s, v) jako łamana. */
function bezier(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ]);
  }
  return out;
}

export default {
  id: 'zbrojownia',
  name: 'Zbrojownia',
  sub: 'Zbrojownia i skład amunicji przy suchym doku floty: montaż dział, wyrzutni i wież, stanowiska prób ze strzelnicą, doki uzbrajania S / M / L, bunkry amunicji z importu, hangar myśliwców, nabrzeże amunicyjne.',
  build({ style }) {
    const layout = buildZbrojowniaLayout();
    const armory = buildArmoryScene(layout, style);
    const range = buildRangeScene(layout, style);
    const ammo = buildAmmoScene(layout, style);
    const V = RING_V;
    const armPits = layout.pits.filter((p) => p.zone === 'ZU').sort((p, q) => p.s0 - q.s0);
    // okręty w dokach: S i L stoją (fregaty, pancerniki), M — niszczyciele w ruchu (rysuje `frame`)
    const hulls = (b) => {
      if (b.role === 'uzbrajanie') return b.cls === 'm' ? null : ZB.armHull[b.cls];
      if (b.role === 'mysliwce') return 'heavy_freighter';
      if (b.role === 'amunicja') return 'megafreighter';
      return undefined;
    };

    // --- stan symulacji
    let t = 0;
    let shots = 0;
    const turrets = range.rig.stands.map((st, i) => ({
      ...st, theta: 0, aim: 0, phase: 'cool', timer: 1 + 2.5 * hash(i * 3.3), shot: 0, nextShot: 0, flashUntil: -1, target: 0, hits: []
    }));
    const hitUntil = new Float64Array(ZB.targets.length).fill(-1);
    const targetXZ = ZB.targets.map((s) => yardPoint(s, ZB.range.v1 + 175));
    const gantry = { s: armory.rig.gantry.s0, goal: armory.rig.gantry.s0, wait: 3, s0: armory.rig.gantry.s0 };
    const guards = ammo.rig.guards.map((g, i) => ({ ...g, theta: 0, period: 11 + 4 * hash(i * 7.1), ph: hash(i * 2.9) }));

    // doki uzbrajania: S i L — ładowanie w pętli, M — pełny cykl z okrętem w ruchu
    const docks = armPits.map((pit, i) => {
      const rig = ammo.rig.docks[i];
      const B = pit.berth;
      const d = { pit, B, ch: rig, cls: pit.cls, moving: pit.cls === 'm', phase: 'load', t: 0, dur: 30 + 20 * hash(i * 1.7), progress: hash(i * 5.1), ship: null };
      if (d.moving) {
        const sc = pit.sc;
        const lane = V.road + V.laneOff;
        const back = V.road - V.laneOff;
        d.inRoute = route([
          [sc - 4200, lane], [sc - 1100, lane],
          ...bezier([sc - 1100, lane], [sc - 380, lane], [sc, lane + 120], [sc, V.outer0 - 220], 18).slice(1),
          [sc, B.v]
        ]);
        d.backRoute = route([[sc, B.v], [sc, V.road]]);
        d.outRoute = route([
          ...bezier([sc, V.road], [sc - 500, V.road], [sc - 900, back], [sc - 1500, back], 18),
          [sc - 5200, back]
        ]);
        d.phase = i < 2 ? 'wait' : 'in';
        d.t = i < 2 ? 6 : 0;
        d.progress = 0;
      }
      return d;
    });
    const pose = { x: 0, z: 0, h: 0 };
    const SPEED_IN = 340;
    const SPEED_BACK = 120;

    function stepTurrets(dt) {
      for (let i = 0; i < turrets.length; i++) {
        const tr = turrets[i];
        const B = BURST[tr.kind];
        tr.timer -= dt;
        if (tr.phase === 'cool' && tr.timer <= 0) {
          // nowa tarcza: jedna z trzech najbliższych osi stanowiska
          let best = 0;
          let bd = Infinity;
          ZB.targets.forEach((ts, k) => { const dd = Math.abs(ts - tr.s); if (dd < bd) { bd = dd; best = k; } });
          const pick = Math.max(0, Math.min(ZB.targets.length - 1, best + Math.floor(hash(tr.group * 9.7 + shots * 0.37 + t * 0.013) * 3) - 1));
          tr.target = pick;
          const [tx, tz] = targetXZ[pick];
          tr.aim = wrap(Math.atan2(tx - tr.px, tz - tr.pz) - tr.s / layout.R0);
          tr.phase = 'slew';
        }
        if (tr.phase === 'slew') {
          const diff = tr.aim - tr.theta;
          const stepA = (tr.kind === 'pd' ? 1.2 : tr.kind === 'torpedo' ? 0.25 : 0.5) * dt;
          if (Math.abs(diff) <= stepA) {
            tr.theta = tr.aim;
            tr.phase = 'fire';
            tr.shot = 0;
            tr.nextShot = t + 0.4;
          } else tr.theta += Math.sign(diff) * stepA;
        }
        if (tr.phase === 'fire' && t >= tr.nextShot) {
          tr.flashUntil = t + B.flash;
          tr.hits.push(t + B.hit);
          tr.shot++;
          shots++;
          tr.nextShot = t + B.gap;
          if (tr.shot >= B.n) { tr.phase = 'cool'; tr.timer = 2.5 + 3 * hash(tr.group * 4.1 + shots * 0.11); }
        }
        while (tr.hits.length && tr.hits[0] <= t) {
          tr.hits.shift();
          hitUntil[tr.target] = Math.max(hitUntil[tr.target], t + (tr.kind === 'torpedo' || tr.kind === 'launcher' ? 0.35 : 0.12));
        }
      }
    }

    function stepGantry(dt) {
      if (gantry.wait > 0) { gantry.wait -= dt; return; }
      const span = ZB.armory.b - ZB.armory.a - 900;
      const diff = gantry.goal - gantry.s;
      const v = 140 * dt;
      if (Math.abs(diff) <= v) {
        gantry.s = gantry.goal;
        gantry.wait = 4 + 3 * hash(gantry.goal * 0.01 + t * 0.001);
        gantry.goal = ZB.armory.a + 450 + span * hash(t * 0.031 + gantry.s * 0.002);
      } else gantry.s += Math.sign(diff) * v;
    }

    function stepDocks(dt) {
      for (const d of docks) {
        d.t += dt;
        if (!d.moving) {
          if (d.phase === 'load') {
            d.progress = Math.min(1, d.progress + dt / d.dur);
            if (d.progress >= 1) { d.phase = 'ready'; d.t = 0; }
          } else if (d.t > 18) { d.phase = 'load'; d.progress = 0; d.t = 0; }
          continue;
        }
        if (d.phase === 'wait' && d.t > 8) { d.phase = 'in'; d.t = 0; }
        else if (d.phase === 'in' && d.t * SPEED_IN >= d.inRoute.len) { d.phase = 'load'; d.t = 0; d.progress = 0; }
        else if (d.phase === 'load') {
          d.progress = Math.min(1, d.t / d.dur);
          if (d.progress >= 1 && d.t > d.dur + 3) { d.phase = 'back'; d.t = 0; }
        } else if (d.phase === 'back' && d.t * SPEED_BACK >= d.backRoute.len) { d.phase = 'turn'; d.t = 0; }
        else if (d.phase === 'turn' && d.t >= 5) { d.phase = 'out'; d.t = 0; }
        else if (d.phase === 'out' && d.t * SPEED_IN >= d.outRoute.len) { d.phase = 'wait'; d.t = 0; d.progress = 0; }
      }
    }

    /** Poza okrętu doku M (albo null) i nieprzezroczystość. */
    function dockShip(d) {
      const sc = d.pit.sc;
      const radial = Math.PI / 2 - sc / layout.R0;
      if (d.phase === 'in') {
        d.inRoute.at(d.t * SPEED_IN, pose);
        return { x: pose.x, z: pose.z, h: pose.h, op: Math.min(1, (d.t * SPEED_IN) / 900), v: SPEED_IN, thr: 0.5 };
      }
      if (d.phase === 'load') { const [x, z] = yardPoint(sc, d.B.v); return { x, z, h: radial, op: 1, v: 0, thr: 0 }; }
      if (d.phase === 'back') {
        d.backRoute.at(d.t * SPEED_BACK, pose);
        return { x: pose.x, z: pose.z, h: radial, op: 1, v: -SPEED_BACK, thr: 0.2 };
      }
      if (d.phase === 'turn') {
        const [x, z] = yardPoint(sc, V.road);
        return { x, z, h: radial + (Math.PI / 2) * smooth(d.t / 5), op: 1, v: 0, thr: 0.1 };
      }
      if (d.phase === 'out') {
        const dist = d.t * SPEED_IN;
        d.outRoute.at(dist, pose);
        return { x: pose.x, z: pose.z, h: pose.h, op: Math.min(1, (d.outRoute.len - dist) / 900), v: SPEED_IN, thr: 0.6 };
      }
      return null;
    }

    let bArm = null;
    let bRange = null;
    let bAmmo = null;
    return {
      layout,
      hulls,
      buildings: [
        { name: 'Zbrojownia: hale i plac wież', scene: armory },
        { name: 'Zbrojownia: strzelnica i stanowiska prób', scene: range },
        { name: 'Skład amunicji: doki, bunkry, nabrzeże', scene: ammo }
      ],
      views: [
        { name: 'Stanowiska prób', sub: 'osiem wież na krawędzi placu, strzelnica i kulochwyt', caption: 'Wieże na stanowiskach prób obracają się ku tarczom i strzelają seriami — błysk u wylotu, po chwili trafienie na kulochwycie',
          frame: [yardPoint(ZB.armory.a, 8900), yardPoint(ZB.armory.b, 8900), yardPoint(ZB.armory.a, ZB.range.backV1), yardPoint(ZB.armory.b, ZB.range.backV1)] },
        { name: 'Zbrojownia', sub: 'hale montażu, plac gotowych wież z suwnicą', caption: 'Hale przy ringu (lufy, emitery) i przy drodze (wieże, wyrzutnie), za nimi plac gotowych wież; wsad z prawej strony drogi, wysyłka zatokami przy ringu i koleją',
          frame: [yardPoint(ZB.armory.a, -200), yardPoint(ZB.armory.b + 600, -200), yardPoint(ZB.armory.a, ZB.yard.v1), yardPoint(ZB.armory.b + 600, ZB.yard.v1)] },
        { name: 'Doki uzbrajania', sub: 'Atlas na drodze przed dokami S / M / L', caption: 'Fregaty, niszczyciele i pancerniki pobierają amunicję z doków od strony drogi; lampy na koronach ścian pokazują postęp ładowania',
          at: [3100, V.road + V.laneOff], heading: yardTangent(3100), zoom: 0.12 },
        { name: 'Bunkry i nabrzeże', sub: 'pole bunkrów z wałami, hangar myśliwców, pas MEGA', caption: 'Amunicja z importu: megafrachtowiec przy nabrzeżu amunicyjnym, bunkry w odstępach z wałami, podajniki do doków uzbrajania',
          frame: [yardPoint(ZB.guard.a, 3400), yardPoint(ZB.ammo.b, 3400), yardPoint(ZB.guard.a, 12100), yardPoint(ZB.ammo.b, 12100)] },
        { name: 'Hangar myśliwców', sub: 'myśliwce z importu pod dachem z polem siłowym', caption: 'Hangar z wylotem w przestrzeń: frachtowiec z myśliwcami z Wenus i Saturna, myśliwce przy ścianach (dach znika, gdy Atlas jest w środku)',
          at: [1075, 9500], zoom: 0.24 },
        { name: 'Wieża na stanowisku', sub: 'zbliżenie: działo szynowe i laser w próbie', caption: 'Wieże na stanowiskach prób: osłona tylna, ramka ostrzegawcza, koguty w czasie ognia',
          at: [-4370, ZB.yard.standV + 150], zoom: 0.62 }
      ],
      // bramownice drogi nie stają w wylotach doków M (słup trafiałby w dok)
      lintelSkip: armPits.filter((p) => p.cls === 'm').map((p) => [p.sc - 700, p.sc + 700]),
      init(api) {
        [bArm, bRange, bAmmo] = api.buildings;
        // wieże i suwnica przesuwają się w obrębie budowli — bez odcinania siatek po kuli (jak w stoczni portu)
        for (const b of [bArm, bRange, bAmmo]) for (const list of Object.values(b.meshes)) for (const m of list) m.frustumCulled = false;
      },
      step(dt) {
        t += dt;
        stepTurrets(dt);
        stepGantry(dt);
        stepDocks(dt);
        for (const g of guards) g.theta = 0.9 * Math.sin(((t / g.period) + g.ph) * TAU);
      },
      frame(api) {
        if (bRange) {
          const G = bRange.uniforms.uGroup.value;
          let muzzle = 0;
          let firing = 0;
          for (let i = 0; i < turrets.length; i++) {
            const tr = turrets[i];
            rotAbout(G[tr.group].elements, tr.theta, tr.px, tr.pz);
            if (t < tr.flashUntil) muzzle |= 1 << i;
            if (tr.phase === 'fire' || tr.phase === 'slew') firing = 1;
          }
          let hit = 0;
          for (let k = 0; k < hitUntil.length; k++) if (t < hitUntil[k]) hit |= 1 << k;
          bRange._setChan(RANGE_CH.muzzle, muzzle);
          bRange._setChan(RANGE_CH.hit, hit);
          bRange._setChan(RANGE_CH.fire, firing);
        }
        if (bArm) arcShiftElements(bArm.uniforms.uGroup.value[armory.rig.gantry.group].elements, gantry.s - gantry.s0, gantry.s0);
        if (bAmmo) {
          const G = bAmmo.uniforms.uGroup.value;
          for (const g of guards) rotAbout(G[g.group].elements, g.theta, g.px, g.pz);
          for (const d of docks) {
            const busy = d.phase === 'load' || d.phase === 'in' && d.t * SPEED_IN > d.inRoute.len - 900;
            bAmmo._setChan(d.ch.chS, busy ? 0 : 1);
            bAmmo._setChan(d.ch.chP, d.moving && (d.phase === 'wait' || d.phase === 'in') ? 0 : d.progress);
          }
        }
        for (const d of docks) {
          if (!d.moving) continue;
          const p = dockShip(d);
          if (!p) continue;
          const vx = Math.cos(p.h) * p.v;
          const vz = Math.sin(p.h) * p.v;
          api.proxy(`uzbrajanie-${d.pit.id}`, ZB.armHull.m, p.x, p.z, p.h, { opacity: Math.max(0, p.op), vx, vz, throttle: p.thr });
        }
      },
      hud() {
        const loading = docks.filter((d) => d.phase === 'load').length;
        const ready = docks.filter((d) => d.phase === 'ready').length;
        const firing = turrets.filter((tr) => tr.phase === 'fire').length;
        return `<b>zbrojownia</b> próby: ogień ${firing} / ${turrets.length} · strzały ${shots} · <b>uzbrajanie</b> ładuje ${loading} · gotowe ${ready}`;
      },
      stats() {
        return {
          shots,
          turrets: turrets.map((tr) => ({ kind: tr.kind, phase: tr.phase, theta: +tr.theta.toFixed(3) })),
          docks: docks.map((d) => ({ id: d.pit.id, phase: d.phase, progress: +d.progress.toFixed(2) })),
          gantryS: Math.round(gantry.s),
          instances: [armory.instances, range.instances, ammo.instances]
        };
      },
      note: 'Zbrojownia (rola Ziemi, 6% mocy) montuje działa, wyrzutnie i wieże z wsadu huty, elektroniki i fabryk; amunicja i myśliwce są z importu (Wenus, Saturn) — nabrzeże amunicyjne od strony przestrzeni. Wysyłka do stoczni i suchego doku floty zatokami przy ringu (ruch ku −s) i koleją.'
    };
  }
};

