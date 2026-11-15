// DZIELNICA RINGU „Dworzec promów” — wtyczka dema (kontrakt: dema/ring-dzielnice/README.md).
//
// Miejsce, z którego ludzie ringu odlatują na kontrakty rotacyjne i do którego wracają. Ludzie mieszkają W RINGU
// (habitat) — poza ringiem nie ma zabudowy mieszkalnej; pasażerowie przychodzą z wnętrza ringu przejściami w rzędzie
// przy ringu (śluza, hala dojścia, windy na peron kolei) i kładkami nad drogą idą na pirsy i do hali odlotów.
//   uklad.js     — geometria (bryły = kolizje), trasy promów;
//   ruch.js      — symulacja stanowisk dworca (przylot, postój ~60 s, odlot) i rozkład kolei pasażerskiej;
//   bryly.js     — elementy: biurowce i rotundy z oknami, kopuła, szklane nawy, rękawy, budynki zaplecza;
//   dworzec.js   — budowla „Dworzec”; przejscia.js — budowla „Postój i przejścia z ringu” (z kładkami i koleją).
import { RING_V, arcShiftElements, yardPoint, yardRadial } from '../kit/uklad.js';
import { buildTerminalScene } from './dworzec.js';
import { TRAINS, buildRingRowScene } from './przejscia.js';
import { RAIL, createFerryTraffic, railSchedule } from './ruch.js';
import { DW, buildDworzecLayout, parkedHull } from './uklad.js';

const I_TERMINAL = 0;
const I_ROW = 1;

export default {
  id: 'dworzec',
  name: 'Dworzec promów',
  sub: 'Dworzec promów: plac w podkowie, hala odlotów i przylotów, postój promów i przejścia z wnętrza ringu z kładkami nad drogą.',
  build({ style }) {
    const layout = buildDworzecLayout();
    const terminal = buildTerminalScene(layout, style);
    const row = buildRingRowScene(layout, style);

    let traffic = null;
    let trains = [];
    const rail = { stopsUp: layout.railStops.map((q) => q.s).sort((a, b) => a - b) };
    rail.stopsDown = rail.stopsUp.slice().reverse();
    const lPit = layout.pits.find((p) => p.zone === 'DW' && p.cls === 'l' && Math.abs(p.sc) < 200);
    const gate = layout.gates[0];
    const o = {};

    return {
      layout,
      hulls: parkedHull,
      buildings: [
        { name: 'Dworzec', scene: terminal },
        { name: 'Postój i przejścia z ringu', scene: row }
      ],
      views: [
        { name: 'Dworzec', sub: 'plac w podkowie, pirsy, hala, wieża kontroli', caption: 'Promy skręcają z drogi na plac, stają dziobem do hali i pirsów; lampy: zielona = wolne',
          frame: [yardPoint(-3600, 3300), yardPoint(3600, 3300), yardPoint(-1200, 9500), yardPoint(1200, 9500)] },
        { name: 'Stanowisko promu', sub: 'rękaw z hali do stanowiska L', caption: 'Stanowisko liniowca: rękaw z hali, poczekalnie, lampa stanu nad ścianą tylną',
          at: [lPit.sc, lPit.vc + 240], zoom: 0.5 },
        { name: 'Przejście z ringu', sub: 'śluza habitatu, hala dojścia, kładka nad drogą', caption: 'Pasażerowie przychodzą z wnętrza ringu: śluza w ścianie, hala dojścia, windy na peron kolei, kładka nad drogą do pirsu',
          frame: [yardPoint(gate.s0 - 500, -200), yardPoint(gate.s1 + 500, -200), yardPoint(gate.s0 - 500, 4300), yardPoint(gate.s1 + 500, 4300)] },
        { name: 'Biuro kontraktów', sub: 'KADRY — usługa ringu przy dworcu', caption: 'Biuro kontraktów (usługa „Kadry”): rotunda na cokole z pomarańczowym pasem przy wlocie na plac',
          at: [-3075, 4350], zoom: 0.36 },
        { name: 'Postój promów', sub: 'promy czekające na kurs, przy ringu', caption: 'Postój między przejściami z ringu: wnęki S / M / L otwarte na drogę, część pól wolna',
          at: [0, 900], zoom: 0.26 },
        { name: 'Atlas na placu', sub: 'lot między promami (potem 9 — kino)', caption: 'Atlas na placu dworcowym; klawisz 9 pokazuje dworzec z ukosa',
          at: [0, 4750], heading: yardRadial(0), zoom: 0.12 }
      ],
      note: 'Ludzie mieszkają w ringu: pasażerowie wychodzą śluzami habitatu, kładkami nad drogą idą na pirsy i do hali. Promy: przylot drogą (ruch prawostronny), postój ~60 s × tempo, odlot. Lampa stanowiska: zielona = wolne. Kolej pasażerska staje przy obu przejściach.',

      init(api) {
        traffic = createFerryTraffic(layout, { occupied: api.occupied });
        trains = row.rig.trains.map((t) => ({ ...t, plan: railSchedule(t.dir > 0 ? rail.stopsUp : rail.stopsDown, t.dir, t.phase) }));
        // grupy ruchome jeżdżą wzdłuż całej dzielnicy i poza nią — budowla z koleją bez odcinania po kuli
        const b = api.buildings[I_ROW];
        for (const list of Object.values(b.meshes)) for (const m of list) m.frustumCulled = false;
      },
      step(dt) { if (traffic) traffic.step(dt); },
      frame(api) {
        if (!traffic) return;
        traffic.each((sl, p, docked) => {
          const sp = p.rev ? -p.speed : p.speed;
          api.proxy(`prom-${sl.index}-${sl.n}`, sl.hull, p.x, p.z, p.h, {
            opacity: Math.max(0, p.fade), vx: Math.cos(p.h) * sp, vz: Math.sin(p.h) * sp, throttle: docked || p.rev ? 0 : Math.min(0.7, p.speed / 420)
          });
        });
        // kolej: skład = grupa ruchoma obracana wokół środka ringu
        const G = api.buildings[I_ROW].uniforms.uGroup.value;
        for (const t of trains) {
          t.plan.at(traffic.time, o);
          arcShiftElements(G[t.group].elements, o.s);
          if (o.hidden) G[t.group].elements[15] = 0;
        }
        // radar wieży kontroli: obrót wokół osi wieży
        const R = terminal.rig.radar;
        const e = api.buildings[I_TERMINAL].uniforms.uGroup.value[R.group].elements;
        const a = traffic.time * 0.9;
        const c = Math.cos(a);
        const s = Math.sin(a);
        e[0] = c; e[2] = -s; e[8] = s; e[10] = c;
        e[12] = R.x - c * R.x - s * R.z;
        e[14] = R.z + s * R.x - c * R.z;
      },
      hud() {
        if (!traffic) return '';
        const st = traffic.stats();
        return `<b>dworzec</b> przy rękawach ${st.dock} · w locie ${st.in + st.out} · wolne ${st.empty} · przyloty ${st.arrivals} · odloty ${st.departures}`;
      },
      stats() {
        return traffic ? { ...traffic.stats(), trains: TRAINS, railPeriod: trains[0]?.plan.period, railSpeed: RAIL.speed, sHalf: DW.sHalf, roadV: RING_V.road } : null;
      }
    };
  }
};
