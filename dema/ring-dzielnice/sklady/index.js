// DZIELNICA RINGU „SKŁADY” — węzeł logistyczny ringu Ziemi: tu towar zmienia środek transportu (statek z zewnątrz ↔
// magazyn ↔ ciężarówka albo pociąg po ringu). Farma zbiorników z nabrzeżem tankowców, terminal kontenerowy z suwnicami
// i pasem MEGA, wysokie składy podzespołów z rampami, punkt nadań gracza, terminal kolei (cztery przystanki).
// Kontrakt wtyczki: dema/ring-dzielnice/README.md. Demo, niewpięte w grę.
import { RING_V, arcShiftElements, yardPoint, yardRadial, yardTangent } from '../kit/uklad.js';
import { SK, buildSkladyLayout } from './uklad.js';
import { buildFarmScene, buildHighBayScene, buildInnerScene, buildTerminalScene } from './sceny.js';

const V = RING_V;
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Statek zawijający z przestrzeni do doku otwartego ku +v: podejście dziobem, postój, cofnięcie, obrót, odejście. */
function berthCall(pit, t, period, hullId, out) {
  const B = pit.berth;
  const mouth = pit.v1;
  const far = Math.min(13600, mouth + 3200);
  const turnV = mouth + 900;
  const T = {
    in: 0.2, dock: 0.55, back: 0.67, turn: 0.75, leave: 0.95
  };
  const u = ((t / period) % 1 + 1) % 1;
  const head = B.heading;                       // dziób ku −v (do ściany tylnej)
  const radial = yardRadial(B.s);
  let v = far;
  let h = head;
  let thr = 0;
  let speed = 0;
  let dir = -1;
  let opacity = 1;
  if (u < T.in) {
    const k = u / T.in;
    v = far + (B.v - far) * smooth(k);
    thr = 0.5;
    speed = Math.abs(far - B.v) / (period * T.in) * 1.5 * (1 - Math.abs(2 * k - 1));
    opacity = clamp01(k / 0.15);
  } else if (u < T.dock) {
    v = B.v;
  } else if (u < T.back) {
    const k = (u - T.dock) / (T.back - T.dock);
    v = B.v + (turnV - B.v) * smooth(k);
    dir = 1;
    thr = 0.2;
    speed = 120;
  } else if (u < T.turn) {
    const k = (u - T.back) / (T.turn - T.back);
    v = turnV;
    h = head + Math.PI * smooth(k);
    thr = 0.15;
  } else if (u < T.leave) {
    const k = (u - T.turn) / (T.leave - T.turn);
    v = turnV + (far - turnV) * smooth(k);
    h = head + Math.PI;
    dir = 1;
    thr = 0.7;
    speed = 300;
    opacity = clamp01((1 - k) / 0.2);
  } else {
    opacity = 0;
  }
  const [x, z] = yardPoint(B.s, v);
  out.x = x;
  out.z = z;
  out.h = h;
  out.vx = Math.cos(radial) * speed * dir;
  out.vz = Math.sin(radial) * speed * dir;
  out.throttle = thr;
  out.opacity = opacity;
  out.inPit = opacity > 0 && v < mouth + 60;
  out.docked = u >= T.in && u < T.dock;
  out.hullId = hullId;
  return out;
}

export default {
  id: 'sklady',
  name: 'Składy',
  sub: 'Węzeł logistyczny ringu: farma zbiorników z nabrzeżem tankowców, terminal kontenerowy z suwnicami i pasem MEGA, wysokie składy, punkt nadań gracza, cztery przystanki kolei.',
  build({ style }) {
    const layout = buildSkladyLayout();
    const pitsOf = (zone) => layout.pits.filter((p) => p.zone === zone);
    // statki zawijające (ruch): tankowiec na nabrzeżu farmy, frachtowiec na nabrzeżu terminalu
    const calls = [
      { id: 'sk-tankowiec-1', pit: pitsOf('TQ')[2], period: 140, offset: 10, hulls: ['tanker'] },
      { id: 'sk-tankowiec-2', pit: pitsOf('TQ')[4], period: 170, offset: 95, hulls: ['tanker'] },
      { id: 'sk-frachtowiec-1', pit: pitsOf('CL')[1], period: 150, offset: 40, hulls: ['long_haul_freighter', 'container_ship'] },
      { id: 'sk-frachtowiec-2', pit: pitsOf('HQ')[2], period: 160, offset: 120, hulls: ['container_ship', 'long_haul_freighter'] }
    ].filter((c) => c.pit);
    const moving = new Set(calls.map((c) => c.pit.berth.id));
    // kto stoi w dokach: tankowce przy farmie, frachtowce przy terminalu i składach, megafrachtowiec na pasie MEGA
    const pick = (b, list, free = 0.3) => {
      const h = Math.abs(Math.sin(b.s * 0.0137 + b.v * 0.0071) * 43758.5453) % 1;
      return h < free ? null : list[Math.floor(h * 97) % list.length];
    };
    const hulls = (b) => {
      if (moving.has(b.id)) return null;
      switch (b.role) {
        case 'tanker-quay': return pick(b, ['tanker'], 0.25);
        case 'tank-road': return pick(b, ['tanker', 'refinery_tender'], 0.35);
        case 'freight-road': return pick(b, ['container_ship', 'long_haul_freighter'], 0.3);
        case 'import-quay': return pick(b, ['long_haul_freighter', 'container_ship'], 0.2);
        case 'export': return pick(b, ['long_haul_freighter', 'container_ship'], 0.3);
        case 'mega': return 'megafreighter';
        default: return undefined;
      }
    };
    const occupied = new Set(layout.berths.filter((b) => hulls(b)).map((b) => b.id));
    const scenes = {
      inner: buildInnerScene(layout, style, { occupied }),
      farm: buildFarmScene(layout, style, { occupied }),
      terminal: buildTerminalScene(layout, style, { occupied }),
      high: buildHighBayScene(layout, style, { occupied })
    };

    // ruch na drodze: frachtowce i tankowce obu pasami (ruch prawostronny: od przestrzeni ku +s, przy ringu ku −s)
    const ROAD = [
      { id: 'sk-droga-1', hullId: 'tanker', lane: 1, off: 0 },
      { id: 'sk-droga-2', hullId: 'container_ship', lane: 1, off: 0.37 },
      { id: 'sk-droga-3', hullId: 'long_haul_freighter', lane: 1, off: 0.71 },
      { id: 'sk-droga-4', hullId: 'refinery_tender', lane: -1, off: 0.15 },
      { id: 'sk-droga-5', hullId: 'container_ship', lane: -1, off: 0.52 },
      { id: 'sk-droga-6', hullId: 'tanker', lane: -1, off: 0.83 }
    ];
    const ROAD_SPEED = 280;
    const state = { t: 0, levels: SK.fluids.map((_, i) => 0.45 + 0.1 * i), dockedTankers: 0, cranesBusy: 0 };
    const gan = (scenes.terminal.rig.gantries || []).map((g, i) => ({ ...g, cur: g.s, from: g.s, to: g.s, t0: 0, dur: 1, tv: 0, seed: i * 1.73 + 0.4 }));
    const sts = (scenes.terminal.rig.sts || []).map((c, i) => ({ ...c, phase: i * 0.33 }));
    const pose = {};
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    function moveGantries(t) {
      for (const g of gan) {
        if (t >= g.t0 + g.dur) {
          g.from = g.to;
          g.to = g.sMin + (g.sMax - g.sMin) * hash(g.seed + Math.floor(t / 7) * 0.917);
          g.t0 = t;
          g.dur = 9 + 8 * hash(g.seed * 3.1 + t * 0.01);
        }
        const k = (t - g.t0) / g.dur;
        // jazda 60%, potem przekładanie kontenera (wózek w poprzek bloku)
        g.cur = g.from + (g.to - g.from) * smooth(k / 0.6);
        const w = k < 0.6 ? 0 : Math.sin(((k - 0.6) / 0.4) * Math.PI);
        g.tv = (hash(g.seed + Math.floor(t / 7)) - 0.5) * (g.v1 - g.v0) * 0.8 * w;
        g.busy = k >= 0.6;
      }
    }

    return {
      layout,
      hulls,
      lintelSkip: layout.lintelSkip,
      buildings: [
        { name: 'Składy: rząd przy ringu i punkt nadań', scene: scenes.inner },
        { name: 'Składy: farma zbiorników', scene: scenes.farm },
        { name: 'Składy: terminal kontenerowy', scene: scenes.terminal },
        { name: 'Składy: wysokie składy', scene: scenes.high }
      ],
      views: [
        {
          name: 'Farma zbiorników', sub: 'przepompownia, basen z obwałowaniami, nabrzeże tankowców',
          caption: 'Płyny od olbrzymów: tankowce od przestrzeni → zbiorniki → rurociągi do kratownicy, cysterny i kolej K1',
          frame: [yardPoint(SK.farm.a, V.outer0 - 600), yardPoint(SK.farm.b, V.outer0 - 600), yardPoint(SK.farm.a, SK.farm.quay1 + 1200), yardPoint(SK.farm.b, SK.farm.quay1 + 1200)]
        },
        {
          name: 'Nabrzeże tankowców', sub: 'tankowiec podchodzi od przestrzeni',
          caption: 'Doki L otwarte w przestrzeń: ramiona nalewcze, kolektor nabrzeża, lampa stanu (czerwona — tankowiec przy nabrzeżu)',
          at: [pitsOf('TQ')[2]?.sc ?? -5500, SK.farm.basin1 + 800], zoom: 0.16
        },
        {
          name: 'Terminal kontenerowy', sub: 'plac pod suwnicami, nabrzeże L i pas MEGA',
          caption: 'Import rafinatów i eksport Ziemi: frachtowce i megafrachtowiec od przestrzeni ↔ plac ↔ magazyn przy drodze, kolej K2 / K3',
          frame: [yardPoint(SK.ct.a, V.outer0 - 600), yardPoint(SK.ct.b, V.outer0 - 600), yardPoint(SK.ct.a, 12000), yardPoint(SK.ct.b, 12000)]
        },
        {
          name: 'Suwnice nad placem', sub: 'stosy w rodzinach barw, suwnice bramowe i nabrzeżowe',
          caption: 'Suwnice bramowe jeżdżą po szynach wzdłuż bloków i przekładają kontenery; nabrzeżowe obsługują megafrachtowiec',
          at: [SK.ct.megaS - 600, 8600], zoom: 0.2
        },
        {
          name: 'Punkt nadań', sub: 'rampa gracza w rzędzie przy ringu',
          caption: 'Towar kupiony w usługach ringu wyjeżdża ciężarówką z ramp NADANIE, sprzedany przyjeżdża do ramp ODBIÓR; lampy stanu ramp',
          at: [(SK.inner.pnA + SK.inner.pnB) / 2, 1000], zoom: 0.3
        },
        {
          name: 'Wysokie składy', sub: 'hale z rampami od drogi, eksport od przestrzeni',
          caption: 'Podzespoły z fabryk ringu przyjeżdżają ciężarówkami i koleją K4, wyjeżdżają frachtowcami w przestrzeń',
          frame: [yardPoint(SK.hs.a, V.inner0), yardPoint(SK.hs.b, V.inner0), yardPoint(SK.hs.a, SK.hs.quay1 + 1600), yardPoint(SK.hs.b, SK.hs.quay1 + 1600)]
        }
      ],
      step(dt) {
        state.t += dt;
        moveGantries(state.t);
        // napełnienie zbiorników: tankowiec przy nabrzeżu tłoczy płyn swojego cyklu, odbiór koleją i cysternami stale
        let docked = 0;
        calls.forEach((c, ci) => {
          if (!c.pit.zone.startsWith('TQ')) return;
          berthCall(c.pit, state.t + c.offset, c.period, 'tanker', pose);
          if (pose.docked) {
            docked++;
            const cycle = Math.floor((state.t + c.offset) / c.period);
            const fl = (cycle * 2 + ci) % SK.fluids.length;
            state.levels[fl] = Math.min(1, state.levels[fl] + dt * 0.012);
          }
        });
        for (let i = 0; i < state.levels.length; i++) state.levels[i] = Math.max(0.12, state.levels[i] - dt * (0.0025 + 0.001 * i));
        state.dockedTankers = docked;
      },
      frame(api) {
        const [inner, farm, term, high] = api.buildings;
        const t = state.t;
        // statki zawijające
        const busy = new Map();
        for (const c of calls) {
          const cycle = Math.floor((t + c.offset) / c.period);
          berthCall(c.pit, t + c.offset, c.period, c.hulls[cycle % c.hulls.length], pose);
          busy.set(c.pit.berth.id, pose.inPit);
          if (pose.opacity > 0.01) api.proxy(c.id, pose.hullId, pose.x, pose.z, pose.h, { opacity: pose.opacity, vx: pose.vx, vz: pose.vz, throttle: pose.throttle });
        }
        const lamp = (b, list) => {
          if (!b) return;
          for (const q of list || []) b._setChan(q.ch, busy.get(q.berthId) || api.occupied.has(q.berthId) ? 0 : 1);
        };
        lamp(farm, farm?.scene.rig.quay);
        lamp(term, term?.scene.rig.quay);
        lamp(high, high?.scene.rig.quay);
        if (term) for (const m of term.scene.rig.mega || []) term._setChan(m.ch, api.occupied.has(m.berthId) ? 0 : 1);
        if (farm) for (const lv of farm.scene.rig.levels || []) farm._setChan(lv.ch, state.levels[SK.fluids.findIndex((f) => f.id === lv.id)]);
        // punkt nadań: rampy na zmianę — załadunek (czerwona) i zestaw gotowy (zielona)
        if (inner) for (const p of inner.scene.rig.player || []) inner._setChan(p.ch, ((t / (23 + p.ch * 7) + p.ch * 0.3) % 1) < 0.55 ? 1 : 0);
        // suwnice bramowe i nabrzeżowe
        if (term) {
          const G = term.uniforms.uGroup.value;
          let nb = 0;
          for (const g of gan) {
            arcShiftElements(G[g.g].elements, g.cur - g.s, g.s, 0);
            arcShiftElements(G[g.gt].elements, g.cur - g.s, g.s, g.tv);
            if (g.busy) nb++;
          }
          for (const c of sts) {
            const u = ((t / 26 + c.phase) % 1 + 1) % 1;
            // wózek: nad statkiem → nad zapleczem → nad statkiem; suwnica przesuwa się o rząd co cykl
            const k = u < 0.4 ? smooth(u / 0.4) : u < 0.5 ? 1 : u < 0.9 ? 1 - smooth((u - 0.5) / 0.4) : 0;
            const vt = c.vShip + (c.vBack - c.vShip) * k;
            const cyc = Math.floor(t / 26 + c.phase);
            const ds = (hash(c.g * 0.37 + cyc * 0.61) - 0.5) * (c.sMax - c.sMin);
            c.ds = (c.ds ?? ds) + (ds - (c.ds ?? ds)) * 0.02;
            arcShiftElements(G[c.g].elements, c.ds, c.s, 0);
            arcShiftElements(G[c.gt].elements, c.ds, c.s, vt - c.vLegs);
            nb++;
          }
          state.cranesBusy = nb;
        }
        // ruch na drodze
        const E = layout.extent - 600;
        const span = 2 * E;
        for (const r of ROAD) {
          const d = ((t * ROAD_SPEED / span + r.off) % 1) * span;
          const s = r.lane > 0 ? -E + d : E - d;
          const v = V.road + r.lane * V.laneOff;
          const [x, z] = yardPoint(s, v);
          const h = yardTangent(s) + (r.lane > 0 ? 0 : Math.PI);
          const fade = clamp01(Math.min(d, span - d) / 1800);
          api.proxy(r.id, r.hullId, x, z, h, { opacity: fade, vx: Math.cos(h) * ROAD_SPEED, vz: Math.sin(h) * ROAD_SPEED, throttle: 0.45 });
        }
      },
      hud() {
        const lv = SK.fluids.map((f, i) => `${f.label.split(' ')[0].toLowerCase()} ${Math.round(state.levels[i] * 100)}%`).join(' · ');
        return `<b>składy</b> tankowce przy nabrzeżu ${state.dockedTankers} · suwnice w pracy ${state.cranesBusy} · ${lv}`;
      },
      stats() {
        return {
          levels: Object.fromEntries(SK.fluids.map((f, i) => [f.id, +state.levels[i].toFixed(3)])),
          dockedTankers: state.dockedTankers,
          cranesBusy: state.cranesBusy,
          gantries: gan.length,
          sts: sts.length,
          calls: calls.length,
          playerBays: (layout.playerBays || []).length,
          truckBays: layout.truckBays.length,
          railStops: layout.railStops.length
        };
      },
      note: 'Farma: paliwo fuzyjne, chłodziwo, tlen, azot, polimer — tankowce od przestrzeni, odbiór koleją K1 i cysternami. Terminal: import nadstopu, kompozytu, katalizatora i prętów paliwowych; eksport stali, układów, przewodu i stopów (MEGA + doki L). Wysokie składy: płyty kadłuba, awionika, optyka, taśma, napędy, uzbrojenie na eksport. Punkt nadań: rampy gracza (zakupy i sprzedaż w usługach ringu).'
    };
  }
};

