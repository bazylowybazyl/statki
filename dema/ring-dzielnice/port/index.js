// PORT ZE STOCZNIĄ jako dzielnica ringu — opakowanie prototypu `dema/stocznia-ringu` (układ, bryły i ruch stoczni
// Ziemi bez zmian) w kontrakt wtyczki (dema/ring-dzielnice/README.md), żeby stał na jednym ringu z pozostałymi
// dzielnicami. Ścianę ringu i drogę daje gospodarz; ruch stoczni (budowa na pochylniach, kadłuby na wózkach po
// kratownicy, statki dostaw) jest przeniesiony z `dema/stocznia-ringu.js` na api wtyczki.
import { YARD_PLACE_LABEL, YARD_TRI, buildYardRingLayout, yardLocate } from '../../stocznia-ringu/layout.js';
import { buildBasinScene, buildGateScene, buildInnerRowScene, buildOuterRowScene, buildYardScene } from '../../stocznia-ringu/scene.js';
import { buildYardStreetScene, buildYardTriScene } from '../../stocznia-ringu/sceneTri.js';

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

// Statki w dokach (jak w demie portu): suchy dok floty — okręty Terra Novy, doki refitu — flota i cywile na zmianę,
// doki dostaw stoczni — frachtowce z surowcami.
const CIVIL = {
  s: ['inter_station_shuttle', 'belter', 'police_cutter', 'crew_shuttle'],
  m: ['container_ship', 'heavy_harvester', 'rescue_ship', 'crew_liner'],
  l: ['long_haul_freighter', 'tanker', 'refinery_tender', 'colony_liner']
};
const NAVY = { s: 'terran_frigate', m: 'terran_destroyer', l: 'terran_battleship', carrier: 'terran_carrier' };
const FIXED = {
  'OR-D1': 'heavy_freighter', 'OL-MG1': 'megafreighter', 'OR-MG1': 'megafreighter', 'B-MG1': 'megafreighter',
  'B-C1': 'terran_carrier', 'YH-R1': 'heavy_freighter', 'YH-R3': 'terran_carrier'
};
const REFIT = {
  s: ['terran_frigate', 'inter_station_shuttle', 'police_cutter'],
  m: ['terran_destroyer', 'container_ship', 'heavy_harvester'],
  l: ['terran_battleship', 'long_haul_freighter', 'tanker']
};
const SUPPLY = { m: ['container_ship', 'heavy_harvester', 'container_ship'], l: ['long_haul_freighter', 'tanker', 'refinery_tender'] };
const SUPPLY_HULLS = ['container_ship', 'long_haul_freighter', 'tanker', 'heavy_harvester', 'refinery_tender', 'container_ship', 'long_haul_freighter'];
function hullFor(b) {
  let id = FIXED[b.id] || null;
  if (!id && b.navy && b.cls !== 'capital') id = hash(b.s * 0.017 + b.v * 0.05) < 0.86 ? NAVY[b.cls] : null;
  const yardPool = b.zone === 'YT' ? SUPPLY : REFIT;
  if (!id && b.yard && yardPool[b.cls]) id = hash(b.s * 0.019 + b.v * 0.03) < 0.6 ? yardPool[b.cls][Math.floor(hash(b.s * 0.037 + 1.5) * yardPool[b.cls].length)] : null;
  if (!id && !b.navy && !b.yard && CIVIL[b.cls]) id = hash(b.s * 0.013 + b.v * 0.07) < 0.62 ? CIVIL[b.cls][Math.floor(hash(b.s * 0.031 + 2.5) * CIVIL[b.cls].length)] : null;
  return id;
}

const READY_S = 10;                // gotowy kadłub stoi na pochylni co najmniej tyle [s przy tempie ×1]
const GAP_S = 8;                   // pusta pochylnia przed położeniem następnej stępki

export default {
  id: 'port',
  name: 'Port ze stocznią',
  sub: 'Wjazd K-7, doki cywilne, suchy dok floty i stocznia Ziemi: ulica z kratownicą wokół trójkątnego suchego doku.',
  build({ style }) {
    const L = buildYardRingLayout({ yard: 'earth' });
    const Tr = L.yard.tri;
    const g = L.gate;
    const B = L.basin;
    // pola, których oczekuje gospodarz dzielnic
    const flat = { s: 0, m: 0, l: 0, carrier: 0, capital: 0, mega: 0 };
    for (const b of L.berths) flat[b.cls]++;
    L.id = 'port';
    L.counts = flat;
    L.extent = 36000;
    L.truckBays = [];
    L.railStops = [];
    L.openings = [
      { s0: g.s0, s1: g.s1, label: 'wjazd K-7' },
      { s0: B.s0, s1: B.s1, label: 'suchy dok floty' }
    ];
    L.lintelSkip = [[g.s0 - 900, g.s1 + 900], [B.mouth0 - 700, B.mouth1 + 700], [L.yard.sc - Tr.junctionHalf - 400, L.yard.sc + Tr.junctionHalf + 400]];
    L.placeLabels = YARD_PLACE_LABEL;
    L.locate = (x, z, arc, out) => { yardLocate(L, x, z, out); return true; };

    const occupied = new Set();
    for (const b of L.berths) if (hullFor(b)) occupied.add(b.id);

    // --- ruch stoczni Ziemi (jak w demie portu)
    const TRI = { dock: null, street: null, slips: [], cranes: [], transports: [], sledFree: [], sledAll: [], supply: [], t: 0, drones: 0, cranesBusy: 0, ready: 0, inBuild: 0, done: 0 };
    let api0 = null;
    const _o = {};
    const hullOf = (rec) => rec.sl.def.hulls[mod(rec.n + rec.sl.k, rec.sl.def.hulls.length)];
    const trussFree = (rec, len) => {
      for (const tr of TRI.transports) {
        const rem = tr.rec.sl.toJunction - tr.d;
        if (Math.abs(rem - rec.sl.toJunction) < (tr.len + len) / 2 + 700) return false;
      }
      return true;
    };
    let _v3 = null;
    const placeSled = (Mx, x, z, heading, len, beam) => {
      Mx.makeRotationY(-heading);
      Mx.scale(_v3.set(len + 140, 1, beam + 110));
      Mx.setPosition(x, 0, z);
    };

    return {
      layout: L,
      hulls: hullFor,
      lintelSkip: L.lintelSkip,
      buildings: [
        { name: 'Port: rząd przy ringu', scene: buildInnerRowScene(L, style, { occupied }) },
        { name: 'Port: doki cywilne (lewe)', scene: buildOuterRowScene(L, 'OL', style, { occupied }) },
        { name: 'Port: doki cywilne (prawe)', scene: buildOuterRowScene(L, 'OR', style, { occupied }) },
        { name: 'Port: wjazd K-7', scene: buildGateScene(L, style) },
        { name: 'Port: suchy dok floty', scene: buildBasinScene(L, style, { occupied }) },
        { name: 'Port: hala stoczni', scene: buildYardScene(L, style, { occupied }) },
        { name: 'Stocznia: suchy dok', scene: buildYardTriScene(L, style, { occupied }) },
        { name: 'Stocznia: ulica i kratownica', scene: buildYardStreetScene(L, style) }
      ],
      views: [
        { name: 'Wjazd K-7', sub: 'brama z dwoma pasami — wlot do drogi', caption: 'Wjazd K-7: prawy pas wjazd, lewy wyjazd; za bramą droga w lewo i w prawo', at: [g.laneIn.s, L.v.outer1 + 4200], heading: Math.PI / 2 - g.laneIn.s / L.R0 + Math.PI, zoom: 0.17 },
        { name: 'Suchy dok floty', sub: 'basen wojskowy z wylotem na drogę', caption: 'Suchy dok floty: capital, nosiciele, krążowniki, niszczyciele, fregaty', at: [B.mouthC, B.front1 + 500], heading: Math.PI / 2 - B.mouthC / L.R0, zoom: 0.115 },
        { name: 'Stocznia: suchy dok', sub: 'ulica z kratownicą wokół trójkątnego doku', caption: 'Stocznia Ziemi: kadłuby rosną na pochylniach, gotowe jadą kratownicą do doków; surowce przywożą statki', frame: Tr.outline(Tr.Dwall + 200).map(([a, c]) => Tr.at(a, c)).concat([Tr.at(Tr.aRoad - 1500, -3000), Tr.at(Tr.aRoad - 1500, 3000)]) }
      ],
      init(api) {
        api0 = api;
        _v3 = new api.THREE.Vector3();
        TRI.dock = api.building('Stocznia: suchy dok');
        TRI.street = api.building('Stocznia: ulica i kratownica');
        // wózki jadą także drogą ringu, poza bryłami ulicy — budowla ulicy bez odcinania po kuli
        for (const list of Object.values(TRI.street.meshes)) for (const m of list) m.frustumCulled = false;
        TRI.sledAll = TRI.street.scene.rig.sleds.slice();
        TRI.sledFree = TRI.sledAll.slice();
        const rig = TRI.dock.scene.rig;
        for (const sl of Tr.slips) {
          const hull = new api.YardHull(TRI.dock, sl, 300 + sl.index, 0);
          const drones = [];
          for (let j = 0; j < sl.def.drones; j++) drones.push({ seed: hash(sl.index * 7.3 + j * 2.1), period: 5 + 3 * hash(sl.index * 1.3 + j * 5.7), u: hash(j * 3.3 + sl.index), v: hash(j * 9.1 + sl.index * 0.7) });
          const dx = sl.crane.pickX - sl.cx;
          const dz = sl.crane.pickZ - sl.cz;
          const rec = {
            sl, hull, drones, phase: 'build', t: sl.def.build * hash(sl.index * 2.9 + 0.4), n: 0, len: 0, beam: 0, progress: 0, sled: -1,
            pickAl: dx * sl.ax + dz * sl.az, pickAc: dx * sl.az - dz * sl.ax,
            ch: rig.slipStatus.find((r) => r.index === sl.index).ch
          };
          TRI.slips.push(rec);
          TRI.cranes.push({ c: sl.crane, rec, group: rig.cranes.find((r) => r.index === sl.index).group, theta: Math.PI / 2, period: 8 + 4 * hash(sl.index * 4.1), phase: hash(sl.index * 6.7) });
        }
        const span = Tr.supply.len + 6000;
        SUPPLY_HULLS.forEach((hullId, i) => TRI.supply.push({ id: `dostawa-${i}`, hullId, off: (span * i) / SUPPLY_HULLS.length + 900 * hash(i * 3.1) }));
      },
      step(k) {
        TRI.t += k;
        for (const rec of TRI.slips) {
          const def = rec.sl.def;
          rec.t += k;
          if (rec.phase === 'build') {
            if (rec.t >= def.build) { rec.phase = 'ready'; rec.t = 0; }
          } else if (rec.phase === 'ready') {
            if (rec.sled < 0 && TRI.sledFree.length) rec.sled = TRI.sledFree.pop();
            const hullId = hullOf(rec);
            const size = api0.trafficHullRenderSize(hullId);
            const len = size?.w || def.len * 0.8;
            if (rec.t >= READY_S && rec.sled >= 0 && trussFree(rec, len)) {
              TRI.transports.push({ id: `yt-${rec.sl.index}-${rec.n}`, hullId, rec, d: 0, v: 0, len, beam: size?.h || def.w * 0.6, sled: rec.sled });
              rec.sled = -1;
              rec.phase = 'gap';
              rec.t = 0;
            }
          } else if (rec.t >= GAP_S) {
            rec.phase = 'build';
            rec.t = 0;
            rec.n++;
          }
        }
        for (const tr of TRI.transports) {
          tr.v = Math.min(YARD_TRI.speed, tr.v + 50 * k);
          tr.d += tr.v * k;
        }
        for (let i = TRI.transports.length - 1; i >= 0; i--) {
          const tr = TRI.transports[i];
          if (tr.d < tr.rec.sl.route.len) continue;
          TRI.sledFree.push(tr.sled);
          TRI.transports.splice(i, 1);
          TRI.done++;
        }
      },
      frame(api) {
        const Gd = TRI.dock.uniforms.uGroup.value;
        const Gs = TRI.street.uniforms.uGroup.value;
        for (const gi of TRI.sledAll) Gs[gi].elements[15] = 0;
        let building = 0;
        let ready = 0;
        for (const rec of TRI.slips) {
          const sl = rec.sl;
          const def = sl.def;
          const hullId = hullOf(rec);
          const size = api.trafficHullRenderSize(hullId);
          rec.len = size?.w || def.len * 0.8;
          rec.beam = size?.h || def.w * 0.6;
          if (rec.phase === 'build') {
            rec.progress = Math.min(1, rec.t / def.build);
            rec.hull.setState({ hullId, progress: rec.progress, seed: mod(rec.n, 89) * 3.7 + sl.index }, api.time);
            building++;
          } else {
            rec.hull.setState(null);
            if (rec.phase === 'ready') {
              ready++;
              api.proxy(`yt-${sl.index}-${rec.n}`, hullId, sl.cx, sl.cz, sl.heading);
              if (rec.sled >= 0) placeSled(Gs[rec.sled], sl.cx, sl.cz, sl.heading, rec.len, rec.beam);
            }
          }
          TRI.dock._setChan(rec.ch, rec.phase === 'ready' ? 1 : 0);
        }
        for (const tr of TRI.transports) {
          const R = tr.rec.sl.route;
          R.at(tr.d, _o);
          const fade = Math.max(0, Math.min(1, (R.len - tr.d) / 1500));
          api.proxy(tr.id, tr.hullId, _o.x, _o.z, _o.h, { opacity: fade });
          if (fade > 0.03) placeSled(Gs[tr.sled], _o.x, _o.z, _o.h, tr.len, tr.beam);
        }
        const S = Tr.supply;
        const span = S.len + 6000;
        for (const sh of TRI.supply) {
          const d = mod(TRI.t * YARD_TRI.supplySpeed + sh.off, span);
          if (d >= S.len) continue;
          S.at(d, _o);
          const fade = Math.max(0, Math.min(1, d / 1500, (S.len - d) / 1500));
          api.proxy(sh.id, sh.hullId, _o.x, _o.z, _o.h, { opacity: fade, vx: Math.cos(_o.h) * YARD_TRI.supplySpeed, vz: Math.sin(_o.h) * YARD_TRI.supplySpeed, throttle: 0.5 });
        }
        let busy = 0;
        const m4 = Gd[0].constructor;
        void m4;
        for (const cr of TRI.cranes) {
          const active = cr.rec.phase === 'build' && cr.rec.progress < 0.985;
          if (active) {
            busy++;
            const u = (TRI.t / cr.period + cr.phase) % 1;
            cr.theta = u < 0.15 ? Math.PI / 2 : u < 0.45 ? (Math.PI / 2) * (1 - smooth((u - 0.15) / 0.3)) : u < 0.65 ? 0 : (Math.PI / 2) * smooth((u - 0.65) / 0.35);
          } else {
            cr.theta += (Math.PI / 2 - cr.theta) * 0.08;
          }
          const Mx = Gd[cr.group];
          Mx.makeRotationY(cr.theta * cr.c.pickSign);
          const e = Mx.elements;
          const px = cr.c.px;
          const pz = cr.c.pz;
          Mx.setPosition(px - (e[0] * px + e[8] * pz), 0, pz - (e[2] * px + e[10] * pz));
        }
        TRI.inBuild = building;
        TRI.ready = ready;
        TRI.cranesBusy = busy;
      },
      drones(api) {
        const R = api.droneRec;
        const D = api.CARGO_DRONE;
        const pose = { x: 0, z: 0, angle: 0 };
        for (const rec of TRI.slips) {
          if (rec.phase !== 'build' || rec.progress > 0.99) continue;
          const sl = rec.sl;
          pose.x = sl.cx;
          pose.z = sl.cz;
          pose.angle = sl.heading;
          const front = api.hullBuildFront(Math.min(0.999, rec.progress));
          for (const d of rec.drones) {
            const u = (TRI.t / d.period + d.seed) % 1;
            const alS = rec.pickAl + (d.u - 0.5) * 70;
            const acS = rec.pickAc + (d.v - 0.5) * 70;
            const alW = (front - 0.5) * rec.len + (d.u - 0.5) * Math.min(rec.len * 0.3, 160);
            const acW = (d.v - 0.5) * rec.beam * 0.8;
            let k = 1;
            let out = true;
            if (u < 0.28) k = smooth(u / 0.28);
            else if (u >= 0.72) { k = 1 - smooth((u - 0.72) / 0.28); out = false; }
            const moving = k > 0.001 && k < 0.999;
            const dAl = (alW - alS) * (out ? 1 : -1);
            const dAc = (acW - acS) * (out ? 1 : -1);
            const dl = Math.sqrt(dAl * dAl + dAc * dAc) || 1;
            R[D.U] = alS + (alW - alS) * k;
            R[D.V] = -(acS + (acW - acS) * k);
            R[D.Z] = 26 + 34 * (1 - k) + 46 * Math.sin(Math.PI * k) * (moving ? 1 : 0);
            R[D.YAW] = Math.atan2(-dAc, dAl);
            R[D.CARRY] = out && u < 0.28 ? 1 : 0;
            R[D.THRUST] = moving ? 0.75 : 0.32;
            R[D.AU] = dAl / dl;
            R[D.AV] = -dAc / dl;
            R[D.AZ] = 0;
            R[D.CLIP] = -1e9;
            R[D.DROP] = 0;
            R[D.SEED] = d.seed;
            api.drone(pose);
          }
        }
      },
      hud: () => `<b>stocznia</b> w budowie ${TRI.inBuild} · gotowe ${TRI.ready} · na kratownicy ${TRI.transports.length} · żurawie ${TRI.cranesBusy}`,
      stats: () => ({ inBuild: TRI.inBuild, ready: TRI.ready, onTruss: TRI.transports.length, delivered: TRI.done, sledsFree: TRI.sledFree.length })
    };
  }
};
