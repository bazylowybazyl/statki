// HUTA — wtyczka dzielnicy ringu Ziemi, wersja „widoczny proces” (kontrakt: dema/ring-dzielnice/README.md).
// Układ: uklad.js · symulacja z bilansem materiału: proces.js · bryły stałe: sceny.js. Tu: rysunek tego, co się rusza
// — statki z rudą, ssawy odkurzaczy, bryłki w locie, kopce, przenośniki, kąpiel w piecach, kadzie, kęsiska stygnące
// w walcowni, kręgi, suwnice, ciężarówki — przez tworzywo gospodarza (kit/tworzywo.js).
import { buildHutaLayout } from './uklad.js';
import { createHutaProcess, moundCones } from './proces.js';
import { buildHutaDockScene, buildHutaPlantScene, buildHutaRowsScene } from './sceny.js';

const FLOOR = 18;
const WALL = 150;
const DECK = 116;               // wierzch kadłuba statku (płaszczyzna lotu)
const C = {
  dark: [0.07, 0.078, 0.09], iron: [0.2, 0.21, 0.24], steel: [0.5, 0.54, 0.6], black: [0.012, 0.012, 0.016],
  white: [1.0, 0.93, 0.78], red: [1.0, 0.06, 0.03], hold: [0.05, 0.055, 0.065], yellow: [0.95, 0.6, 0.08], lining: [0.11, 0.045, 0.025], hook: [0.9, 0.6, 0.1], rim: [0.6, 0.62, 0.64]
};
const PAINTS = [[0.95, 0.6, 0.08], [0.85, 0.86, 0.88], [0.8, 0.26, 0.07], [0.2, 0.42, 0.62], [0.55, 0.6, 0.25]];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export default {
  id: 'huta',
  name: 'Huta',
  sub: 'Cały proces na widoku: statek z rudą staje przy pirsie, odkurzacz wysysa ładownię do zasieku, rośnie kopiec; przenośnik karmi piec, kadź wiezie ciekły metal do odlewni, kęsisko przechodzi przez trzy klatki i zwijarkę, a kręgi z placu zabierają ciężarówki z drogi przy ringu. Pięć rud, pięć kolorów, pięć torów.',
  note: 'Bilans materiału jest ścisły: to, co wyssano ze statku, leży w zasieku, jedzie przenośnikiem, topi się, płynie i wyjeżdża na naczepie. Receptury jak w ekonomii gry (ruda 3 → metal 2; tytan z dodatkiem glinu; ceramika z rudy glinu i węglistej). Tempo pracy umowne — suwak tempa przyspiesza.',
  build({ style }) {
    const layout = buildHutaLayout();
    const Hu = layout.huta;
    const Z = Hu.Z0;
    const lanes = Hu.lanes;
    const P = createHutaProcess(Hu, { seed: 7, prewarm: 90 });
    const oreShades = lanes.map((L) => [shade(L.oreColor, 0.82), L.oreColor, shade(L.oreColor, 1.22)]);
    // bryłki w locie jaśniejsze (pył w słońcu) — strumień z wylotu ma się odcinać od kopca
    const airShades = lanes.map((L) => [mixc(L.oreColor, [0.5, 0.5, 0.5], 0.25), mixc(shade(L.oreColor, 1.5), [0.6, 0.6, 0.6], 0.2), shade(L.oreColor, 1.8)]);
    const occupied = new Set();
    let plant = null;
    let dock = null;
    let clock = 0;
    const _p = {};
    const _q = {};
    const _look = {};
    const _cones = [{}, {}, {}];

    // -- wyrób (krąg, pakiet blach, płyta) na podstawie `base` (wysokość spodu)
    function drawItem(tw, it, base) {
      const L = lanes[it.lane];
      const y0 = base + (it.lift || 0) * 170;
      if (it.kind === 'coil') {
        tw.cyl('bg', it.x, y0 + 48, it.z, 60, 96, L.metal, it.heat, 1);
        tw.cyl('bg', it.x, y0 + 97, it.z, 21, 3, C.black, it.heat * 0.5, 0);
      } else if (it.kind === 'pack') {
        for (let k = 0; k < 3; k++) tw.box('bg', it.x + (k - 1) * 3, y0 + 8 + k * 15, it.z, 250 - k * 8, 14, 106, it.yaw || 0, L.metal, it.heat, 1);
      } else {
        tw.box('bg', it.x, y0 + 14, it.z, 122, 28, 122, it.yaw || 0, L.metal, it.heat, 0);
        tw.box('bg', it.x, y0 + 29, it.z, 96, 3, 96, it.yaw || 0, shade(L.metal, 0.8), it.heat, 0);
      }
    }

    function draw(api) {
      const tw = api.tworzywo;
      const t = clock;

      // ---- znaki barw torów (inny metal = inny kolor): obrzeża zasieków, kanały wyrzutowe, pirsy, regały
      lanes.forEach((L, i) => {
        const B = L.bunker;
        for (const z of [B.z0 - 30, B.z1 + 30]) tw.box('bg', L.x, WALL + 6, z, 1500, 8, 44, 0, L.oreColor);
        tw.box('bg', L.spout.x - 5, L.spout.y + 16, L.spout.z - 30, 120, 12, 60, Math.PI / 2, L.oreColor);
        tw.box('bg', L.blower.x, FLOOR + 232, L.blower.z, 150, 8, 130, 0, L.oreColor);
        tw.box('bg', (L.pier.x0 + L.pier.x1) / 2, WALL + 8, L.pier.z0 + 70, 120, 8, 90, 0, L.oreColor);
        const R = Hu.racks[i];
        tw.box('bg', (R.x0 + R.x1) / 2, FLOOR + 3, Z + 1036, R.x1 - R.x0 + 40, 6, 22, 0, L.metal, 0, 1);
        tw.box('bg', R.stop.x, FLOOR + 3, Z + 505, 540, 6, 16, 0, L.metal, 0, 1);
        if (L.furnace) for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + Math.PI / 4; tw.box('bg', L.furnace.x + Math.cos(a) * 418, 262, L.furnace.z + Math.sin(a) * 418, 76, 8, 76, a, L.oreColor); }
        else tw.box('bg', L.kiln.x, FLOOR + 236, L.kiln.mixer.z, 200, 8, 130, 0, L.oreColor);
      });

      // ---- statki z rudą na pokładach i odkurzacze
      const Gd = dock.uniforms.uGroup.value;
      lanes.forEach((L, i) => {
        const s = P.ships[i];
        const v = P.vacs[i];
        const sh = oreShades[i];
        if (s.state !== 'away') {
          const moving = s.state === 'approach' || s.state === 'depart';
          const speed = moving ? 380 * (s.state === 'approach' ? Math.max(0.1, 1 - s.t / P.TUNE.shipArrive) : Math.min(1, s.t / P.TUNE.shipLeave + 0.1)) : 0;
          api.proxy(`ruda-${i}`, 'heavy_freighter', L.x, L.berth.z + s.off, -Math.PI / 2, moving ? { vx: 0, vz: -speed, throttle: s.state === 'approach' ? 0.15 : 0.5 } : null);
          const m0 = P.TUNE.shipLoad / L.cells.length;
          // dno ładowni (sprite statku ma na pokładzie kontenery — ładownia masowca jest pusta albo z rudą)
          tw.box('fg', L.x, DECK + 1.5, L.berth.z + s.off + 129, 352, 3, 694, 0, C.hold);
          for (let k = 1; k < 8; k++) tw.box('fg', L.x, DECK + 4, L.berth.z + s.off - 211 + k * 85, 352, 5, 6, 0, C.iron, 0, 1);
          for (const o of [-58, 58]) tw.box('fg', L.x + o, DECK + 4, L.berth.z + s.off + 129, 6, 5, 694, 0, C.iron, 0, 1);
          for (let k = 0; k < L.cells.length; k++) {
            const frac = s.cells[k] / m0;
            if (frac < 0.015) continue;
            const c = L.cells[k];
            const q = Math.cbrt(frac);
            tw.box('fg', c.x, DECK + 7 * q, c.z + s.off, 104 * (0.5 + 0.5 * q), 14 * q, 76 * (0.5 + 0.5 * q), 0, sh[k % 3]);
            tw.cone('fg', c.x + ((k * 7) % 5 - 2) * 3, DECK + 14 * q + 30 * q, c.z + s.off + ((k * 3) % 5 - 2) * 2, 44 * q, 60 * q, sh[(k + 1) % 3]);
          }
          if (s.state === 'dock') occupied.add(L.berth.id); else occupied.delete(L.berth.id);
        } else occupied.delete(L.berth.id);
        const dz = v.gz - L.gantry.park;
        Gd[dock.scene.rig.vacs[i].gantry].makeTranslation(0, 0, dz);
        Gd[dock.scene.rig.vacs[i].trolley].makeTranslation(v.tx - 280, 0, dz);
        // ssawa: rura teleskopowa i dzwon nad polem ładowni
        const hx = L.x + v.tx;
        const hy = 292 - 122 * v.headY;
        tw.cyl('fg', hx, (290 + hy) / 2, v.gz, 30, Math.max(2, 290 - hy), C.iron, 0, 1);
        tw.cyl('fg', hx, hy - 12, v.gz, 74, 8, C.yellow, 0, 1);
        tw.cyl('fg', hx, hy - 6, v.gz, 62, 18, C.dark, 0, 1);
        tw.cyl('fg', hx, hy + 4, v.gz, 40, 8, L.oreColor);
        if (v.sucking) {
          for (let j = 0; j < 9; j++) {
            const u = (t * 2.6 + j / 9) % 1;
            const ang = j * 2.4 + t * 3;
            const rad = 46 * (1 - u);
            tw.box('fg', hx + Math.cos(ang) * rad, DECK + 20 + (hy - 30 - DECK - 20) * u, v.gz + Math.sin(ang) * rad, 20 * (1 - 0.5 * u), 16 * (1 - 0.5 * u), 20 * (1 - 0.5 * u), ang, sh[j % 3]);
          }
        }
        // lampa pracy dmuchawy
        tw.box('bg', L.blower.x + 96, FLOOR + 238, L.blower.z - 80, 22, 10, 22, 0, v.flow > 0.3 ? [0.3, 1.0, 0.45] : [0.9, 0.5, 0.1], v.flow > 0.3 ? 0.5 : 0.12, 2);
        // kopiec w zasieku
        const cones = moundCones(L, P.stock[i], _cones);
        for (let k = 0; k < 3; k++) {
          const c = cones[k];
          if (!(c.r > 6)) continue;
          tw.cone('bg', c.x, L.bunker.floor + c.h / 2, c.z, c.r, c.h, sh[k === 0 ? 1 : k === 1 ? 0 : 2]);
          tw.cyl('bg', c.x, L.bunker.floor + 3, c.z, c.r * 1.04, 6, sh[0]);
          // bryły na zboczu: kopiec z rudy, nie gładki stożek
          const nub = Math.round(10 + c.r * 0.07);
          for (let j = 0; j < nub; j++) {
            const hsh = Math.sin((i * 31 + k * 17 + j) * 12.9898) * 43758.5453;
            const u1 = hsh - Math.floor(hsh);
            const hs2 = Math.sin((i * 13 + k * 7 + j) * 78.233) * 12543.123;
            const u2 = hs2 - Math.floor(hs2);
            const q = 0.12 + 0.82 * Math.sqrt(u1);
            const a = u2 * 6.2832;
            const sz = 22 + 34 * u2;
            tw.box('bg', c.x + Math.cos(a) * c.r * q, L.bunker.floor + c.h * (1 - q) + sz * 0.2, c.z + Math.sin(a) * c.r * q, sz, sz * 0.7, sz * 0.9, a * 3, sh[j % 3]);
          }
        }
      });
      // ---- bryłki w locie z wylotu do zasieku
      for (const c of P.chunks) tw.box('bg', c.x, c.y, c.z, c.size * 1.15, c.size * 0.9, c.size * 1.15, c.rot + c.age * 4, airShades[c.lane][(c.size | 0) % 3]);

      // ---- przenośniki: paczki rudy i wlewki
      const parcels = (conv, cols, ingot) => {
        for (const it of conv.items) {
          conv.path.at(it.d, _p);
          if (ingot) tw.box('bg', _p.x, _p.y + 12, _p.z, 52, 18, 26, _p.h, cols, 0, 1);
          else {
            const k = (it.d * 0.37) | 0;
            tw.box('bg', _p.x + ((k % 3) - 1) * 9, _p.y + 12, _p.z + (((k >> 1) % 3) - 1) * 7, 30, 18, 26, _p.h + k, cols[k % 3]);
            tw.box('bg', _p.x - ((k % 3) - 1) * 10, _p.y + 10, _p.z - 12, 22, 14, 20, _p.h - k, cols[(k + 1) % 3]);
          }
        }
      };
      P.feeds.forEach((cv, i) => parcels(cv, oreShades[i], false));
      parcels(P.crossFeed, oreShades[2], false);
      parcels(P.carbonFeed, oreShades[4], false);
      parcels(P.ingotFeed, lanes[2].metal, true);
      const ingN = Math.round(P.ingotStock / 3);
      for (let k = 0; k < ingN; k++) tw.box('bg', Hu.ingots.x - 60 + (k % 3) * 60, FLOOR + 20 + Math.floor(k / 9) * 20, Hu.ingots.z - 100 + (Math.floor(k / 3) % 3) * 80, 52, 18, 60, 0, lanes[2].metal, 0, 1);

      // ---- piece: kąpiel (poziom, żar), wsad na powierzchni, spust rynną
      for (const fu of P.furnaces) {
        const L = lanes[fu.lane];
        const F = L.furnace;
        const look = P.furnaceLook(fu, _look);
        const ys = 150 + 118 * look.level;
        const fl = 0.965 + 0.035 * Math.sin(t * 6.3 + fu.lane * 2.1) + (look.heat > 0.9 ? 0.02 * Math.sin(t * 17 + fu.lane) : 0);
        const hot = Math.min(1, look.heat * fl);
        const bath = mixc(C.lining, L.metal, Math.max(0, Math.min(1, (look.heat - 0.3) * 1.7)));
        // kąpiel: brzeg chłodniejszy, środek gorętszy, kożuch żużla pływa po wierzchu
        tw.cyl('bg', F.x, ys - 6, F.z, F.pool, 12, bath, hot * 0.8, 0);
        tw.cyl('bg', F.x, ys - 3, F.z, F.pool * 0.8, 12, bath, hot * 0.93, 0);
        if (look.heat > 0.45) {
          tw.cyl('bg', F.x + 20 * Math.sin(t * 0.4 + fu.lane), ys, F.z + 16 * Math.cos(t * 0.33), F.pool * 0.5, 12, bath, hot * 1.08, 0);
          tw.cyl('bg', F.x - 14 * Math.cos(t * 0.5), ys + 3, F.z + 20 * Math.sin(t * 0.37 + 1), F.pool * 0.24, 12, bath, hot * 1.22, 0);
          for (let j = 0; j < 9; j++) {
            const a = j * 0.698 + t * (0.05 + 0.012 * j) * (j % 2 ? 1 : -1) + fu.lane;
            const rr = F.pool * (0.36 + 0.5 * ((j * 37) % 10) / 10);
            tw.box('bg', F.x + Math.cos(a) * rr, ys + 6, F.z + Math.sin(a) * rr, 36 + (j % 3) * 22, 6, 22 + (j % 2) * 16, a * 2, C.lining, hot * 0.42, 0);
          }
        }
        if (fu.state === 'charge' || (fu.state === 'melt' && fu.t < 9)) {
          const k = fu.state === 'charge' ? Math.min(1, fu.got / L.need) : 1 - fu.t / 9;
          if (k > 0.03) tw.cone('bg', F.x - 110, ys + 34 * k, F.z + 90, 60 + 130 * k, 68 * k, oreShades[fu.lane][1], 0.12);
        }
        if (fu.state === 'tap') {
          const [ra, rb] = L.runner;
          tw.box('bg', F.x, FLOOR + 100, (ra[1] + rb[1]) / 2 - 5, 34, 10, ra[1] - rb[1] + 10, 0, L.metal, 1);
          tw.box('bg', F.x, FLOOR + 128, rb[1] - 26, 26, 70, 26, 0, L.metal, 1);
        }
      }

      // ---- kadzie na pętli
      for (const l of P.ladles) {
        Hu.loop.at(l.d, _p);
        tw.box('bg', _p.x, FLOOR + 21, _p.z, 214, 26, 176, _p.h, C.dark, 0, 1);
        tw.cyl('bg', _p.x, FLOOR + 92, _p.z, 88, 116, C.iron, 0, 1);
        tw.cyl('bg', _p.x, FLOOR + 150, _p.z, 96, 8, C.rim, 0, 1);
        for (const o of [-1, 1]) tw.box('bg', _p.x - Math.sin(_p.h) * o * 104, FLOOR + 120, _p.z + Math.cos(_p.h) * o * 104, 40, 30, 26, _p.h, C.hook, 0, 1);
        const full = l.melt / P.TUNE.heat;
        if (l.melt > 0.5) {
          // wnętrze rysowane nad obręczą (walec obręczy jest pełny): żar kąpieli, im pełniej, tym jaśniej
          tw.cyl('bg', _p.x, FLOOR + 157, _p.z, 76, 6, lanes[l.metalLane].metal, 0.7 + 0.18 * Math.min(1, full));
          tw.cyl('bg', _p.x, FLOOR + 160, _p.z, 50, 6, lanes[l.metalLane].metal, 0.85 + 0.25 * Math.min(1, full));
        }
        else tw.cyl('bg', _p.x, FLOOR + 157, _p.z, 76, 6, C.lining, 0.24);
        if (l.state === 'pour' && l.melt > 0.2) {
          const tz = Hu.caster.tundish[1];
          tw.box('bg', _p.x, FLOOR + 150, (_p.z + tz) / 2 - 30, 26, 10, Math.abs(_p.z - tz) - 80, 0, lanes[l.metalLane].metal, 1);
          tw.box('bg', _p.x, FLOOR + 132, tz + 20, 24, 40, 24, 0, lanes[l.metalLane].metal, 1);
        }
      }

      // ---- odlewnia: kadź pośrednia, wychodzące kęsisko; linia: kęsiska i pasma w klatkach, zwijarka, układarka
      const LN = Hu.line;
      const cs = P.caster;
      if (cs.lane >= 0 && (cs.buffer > 0.5 || cs.pouring)) tw.box('bg', Hu.caster.x, FLOOR + 127, Hu.caster.tundish[1], 150, 8, 96, 0, lanes[cs.lane].metal, 0.95);
      const yLine = FLOOR + 17;
      // pasmo: środek gorętszy niż brzegi
      const strip = (x, y, len, th, col, heat) => {
        tw.box('bg', x, y, LN.z, len, th, LN.width, 0, col, heat);
        if (heat > 0.3 && len > 40) tw.box('bg', x, y + th / 2 + 1, LN.z, len - 18, 2, LN.width * 0.56, 0, col, heat * 1.13);
      };
      if (cs.emerging) {
        const len = LN.lens[0] * Math.min(1, cs.emerging.t / P.TUNE.castTime);
        strip(LN.x0 + len / 2, yLine + LN.ths[0] / 2, len, LN.ths[0], lanes[cs.emerging.lane].metal, 0.92);
      }
      for (const e of P.line) {
        const L = lanes[e.lane];
        const stop = P.stopOf(e);
        const tail = P.tailOf(e);
        let head = e.u;
        if (e.stage === 3 && e.u > stop) {
          // nawijanie kręgu albo układanie pakietu
          head = stop;
          const frac = Math.min(1, (e.u - stop) / LN.lens[3]);
          if (L.product === 'coil') {
            const r = Math.sqrt(400 + (frac * LN.lens[3] * LN.ths[3] * 3.4) / Math.PI);
            tw.cyl('bg', LN.x0 + stop, FLOOR + 10 + 48, LN.z, r, 96, L.metal, e.heat, 1);
            tw.cyl('bg', LN.x0 + stop, FLOOR + 107, LN.z, 21, 3, C.black, e.heat * 0.5, 0);
          } else {
            tw.box('bg', LN.x0 + stop, FLOOR + 10 + 22 * frac, LN.z, 250, 44 * frac, 106, 0, L.metal, e.heat, 1);
          }
        }
        if (e.stage < 3 && e.u > LN.stands[e.stage]) {
          const us = LN.stands[e.stage];
          strip(LN.x0 + (us + e.u) / 2, yLine + LN.ths[e.stage + 1] / 2, e.u - us, LN.ths[e.stage + 1], L.metal, e.heat);
          if (us - tail > 1) strip(LN.x0 + (tail + us) / 2, yLine + LN.ths[e.stage] / 2, us - tail, LN.ths[e.stage], L.metal, e.heat);
        } else if (head - tail > 1) {
          strip(LN.x0 + (tail + head) / 2, yLine + LN.ths[e.stage] / 2, head - tail, LN.ths[e.stage], L.metal, e.heat);
        }
      }
      for (const key of ['coiler', 'stacker']) if (P.stations[key]) drawItem(tw, P.stations[key], FLOOR + 10);

      // ---- wyroby na samotokach, w regałach i na hakach; płyty w piecu tunelowym
      for (const it of P.items) drawItem(tw, it, it.state === 'rack' || it.state === 'reserved' ? FLOOR + 12 : FLOOR + 16);
      const K = lanes[4].kiln;
      for (const pl of P.kiln.plates) {
        tw.box('bg', K.x, FLOOR + 30, K.z0 - pl.u, 122, 26, 122, 0, lanes[4].metal, pl.heat, 0);
      }
      if (P.kiln.out) drawItem(tw, P.kiln.out, FLOOR + 16);

      // ---- suwnice placu: most i wózek (grupy budowli), lina i trawersa (tworzywo)
      const Gp = plant.uniforms.uGroup.value;
      P.cranes.forEach((c, i) => {
        const rig = plant.scene.rig.cranes[i];
        const mid = (c.z0 + c.z1) / 2;
        Gp[rig.bridge].makeTranslation(c.x - c.home, 0, 0);
        Gp[rig.trolley].makeTranslation(c.x - c.home, 0, c.z - mid);
        const yh = 330 - 190 * c.hook;
        tw.box('bg', c.x, (360 + yh) / 2, c.z, 7, 360 - yh, 7, 0, C.dark);
        tw.box('bg', c.x, yh, c.z, 120, 14, 34, 0, C.hook, 0, 1);
      });

      // ---- ciężarówki: kabina, naczepa, światła; ładunek na naczepie
      const TR = Hu.truck;
      for (const tr of P.trucks) {
        const route = TR.routes[tr.rack];
        const paint = PAINTS[tr.paint % PAINTS.length];
        route.at(tr.d, _p);
        const fx = Math.cos(_p.h);
        const fz = Math.sin(_p.h);
        tw.box('bg', _p.x, FLOOR + 40, _p.z, 96, 64, 104, _p.h, paint, 0, 1);
        tw.box('bg', _p.x + fx * 24, FLOOR + 76, _p.z + fz * 24, 30, 10, 94, _p.h, C.black, 0, 1);
        tw.box('bg', _p.x - fx * 22, FLOOR + 78, _p.z - fz * 22, 44, 12, 84, _p.h, shade(paint, 0.7), 0, 1);
        tw.box('bg', _p.x + fx * 52, FLOOR + 22, _p.z + fz * 52, 10, 20, 108, _p.h, C.iron, 0, 1);
        tw.box('bg', _p.x - fx * 62, FLOOR + 30, _p.z - fz * 62, 30, 24, 60, _p.h, C.dark, 0, 1);
        const lx = -Math.sin(_p.h);
        const lz = Math.cos(_p.h);
        for (const o of [-1, 1]) tw.box('bg', _p.x + Math.cos(_p.h) * 50 + lx * o * 36, FLOOR + 30, _p.z + Math.sin(_p.h) * 50 + lz * o * 36, 6, 12, 18, _p.h, C.white, 0.75, 2);
        route.at(tr.d - 215, _q);
        tw.box('bg', _q.x, FLOOR + 22, _q.z, 336, 20, 112, _q.h, C.iron, 0, 1);
        tw.box('bg', _q.x, FLOOR + 33, _q.z, 330, 3, 96, _q.h, C.dark);
        const sx = -Math.sin(_q.h);
        const sz = Math.cos(_q.h);
        for (const o of [-1, 1]) {
          tw.box('bg', _q.x + sx * o * 57, FLOOR + 36, _q.z + sz * o * 57, 336, 8, 5, _q.h, paint, 0, 1);
          for (const e of [-120, -75, 100]) tw.box('bg', _q.x + Math.cos(_q.h) * e + sx * o * 60, FLOOR + 14, _q.z + Math.sin(_q.h) * e + sz * o * 60, 34, 22, 8, _q.h, C.black);
        }
        route.at(tr.d - 384, _q);
        const tx = -Math.sin(_q.h);
        const tz = Math.cos(_q.h);
        for (const o of [-1, 1]) tw.box('bg', _q.x + tx * o * 44, FLOOR + 26, _q.z + tz * o * 44, 6, 10, 16, _q.h, C.red, tr.v < 60 ? 0.9 : 0.4, 2);
        for (const it of tr.load) drawItem(tw, it, FLOOR + 35);
      }
    }

    return {
      layout,
      hulls: (b) => (b.kind === 'ore' ? null : b.kind === 'drydock' ? 'heavy_freighter' : undefined),
      buildings: [
        { name: 'Huta: rzędy przy drodze', scene: buildHutaRowsScene(layout, style, { occupied }) },
        { name: 'Huta: zakład', scene: buildHutaPlantScene(layout, style) },
        { name: 'Huta: nabrzeże rudy', scene: buildHutaDockScene(layout, style) }
      ],
      views: [
        { name: 'Cały zakład', sub: 'od nabrzeża rudy po bramy ciężarówek', caption: 'Huta: ruda wchodzi od strony kosmosu (dół), wyroby wyjeżdżają ciężarówkami na drogę przy ringu (góra)', frame: [[-4900, Z - 300], [4900, Z + 7300]] },
        { name: 'Odkurzacz i zasiek', sub: 'statek dziobem do nabrzeża, ssawa nad ładownią, kopiec rośnie', caption: 'Tor 1 — ruda żelaza: ssawa wysysa pola ładowni, wylot nad murem sypie bryłki na kopiec', frame: [[lanes[0].x - 1000, Z + 3600], [lanes[0].x + 1000, Z + 7000]] },
        { name: 'Piece i tor kadzi', sub: 'wsad z przenośnika, żar kąpieli, spust do kadzi', caption: 'Cztery piece: stal, miedź, glin, tytan. Kadź staje pod rynną, zabiera wytop i wiezie go do odlewni', frame: [[-4500, Z + 2050], [900, Z + 3750]] },
        { name: 'Walcownia', sub: 'odlewnia, piec grzewczy, trzy klatki, zwijarka', caption: 'Kęsisko wychodzi z odlewni, dogrzewa się, w każdej klatce robi się cieńsze i dłuższe, na końcu zwijarka robi krąg', frame: [[-4500, Z + 1250], [1900, Z + 2100]] },
        { name: 'Plac i suwnice', sub: 'regały kręgów, zatoki załadunku, suwnice bramowe', caption: 'Kręgi stygną na samotoku i trafiają do regałów; suwnica ładuje po trzy na naczepę', frame: [[-4400, Z - 50], [0, Z + 1250]] },
        { name: 'Brama ciężarówek', sub: 'wjazd z drogi przy ringu przez rząd hal', caption: 'Ciężarówki zjeżdżają z pobocza drogi w bramę wjazdową, wyjeżdżają bramą po drugiej stronie zakładu', frame: [[-5200, Z - 3000], [-3300, Z + 700]] }
      ],
      init(api) {
        plant = api.buildings[1];
        dock = api.buildings[2];
        for (const L of lanes) api.occupied.delete(L.berth.id);
      },
      step(dt) { P.step(dt); clock += dt; },
      frame(api) {
        draw(api);
        for (const L of lanes) { if (occupied.has(L.berth.id)) api.occupied.add(L.berth.id); else api.occupied.delete(L.berth.id); }
      },
      hud() {
        const s = P.stats();
        const docked = s.ships.filter((q) => q === 'dock').length;
        return `<b>huta</b> statki przy pirsach ${docked} · wytopy ${s.heats.join(' / ')} · kęsiska ${s.cast} · w regałach ${s.racks.join(' / ')} · ciężarówki wyjechały ${s.trucksOut}`;
      },
      stats: () => ({ ...P.stats(), audit: P.audit() }),
      process: P
    };
  }
};
