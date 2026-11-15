// DZIELNICA RINGU „ZAKŁADY ELEKTRONIKI” (prototyp układu, demo — niewpięte w grę; kontrakt: ../README.md).
//
// Drugi przemysł Ziemi (22% mocy): układy scalone, optyka, taśma nadprzewodząca. Dzielnica „czysta” — równe hale,
// siatki wentylatorów, szkło i chłodne światło — z trzema polami radiatorów wystającymi w przestrzeń, kopułą prób
// z kolimatorem i stacją zasilania. Pliki: uklad.js (układ i towary), narzedzia.js (ramka prosta, hale, zbiorniki,
// radiator, łącznik), rzad.js / fab.js / optyka.js / krio.js (cztery budowle), ruch.js (symulacja).
import { RING_V, yardPoint } from '../kit/uklad.js';
import { buildElektronikaLayout } from './uklad.js';
import { RZAD_CH, buildRzadScene } from './rzad.js';
import { FAB_CH, buildFabScene } from './fab.js';
import { OPT_CH, buildOptykaScene } from './optyka.js';
import { KRIO_CH, KRIO_YARD, buildKrioScene } from './krio.js';
import { createRuch } from './ruch.js';

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = (list, b) => list[Math.floor(hash(b.s * 0.031 + b.v * 0.013 + 2.5) * list.length)];
const K7_ABOVE = 0.42;          // skala wysokości nad płaszczyzną lotu (grupa ruchoma przesuwana w pionie)

/** Kto stoi w dokach: rola doku → kadłub (null = puste). Dok masowca z ruchem zostaje pusty — statek przylatuje. */
function makeHulls(layout) {
  const imports = layout.berths.filter((b) => b.role === 'krzem-import');
  const bulkBerth = imports[imports.length - 1] || null;
  const hulls = (b) => {
    if (b === bulkBerth) return null;
    const busy = hash(b.s * 0.017 + b.v * 0.07) < 0.68;
    if (b.role === 'krzem-import') return 'long_haul_freighter';
    if (!busy) return null;
    if (b.role === 'kurier') return b.cls === 's' ? pick(['inter_station_shuttle', 'police_cutter', 'inter_station_shuttle'], b) : 'container_ship';
    if (b.role === 'lab') return b.cls === 's' ? 'crew_shuttle' : b.cls === 'm' ? pick(['container_ship', 'rescue_ship'], b) : 'long_haul_freighter';
    if (b.role === 'wsad-krio') return b.cls === 'l' ? 'tanker' : 'container_ship';
    return b.cls === 'l' ? 'long_haul_freighter' : 'container_ship';
  };
  return { hulls, bulkBerth };
}

const corners = (s0, s1, v0, v1) => [yardPoint(s0, v0), yardPoint(s1, v0), yardPoint(s0, v1), yardPoint(s1, v1)].map((p) => [p[0], p[1]]);

export default {
  id: 'elektronika',
  name: 'Zakłady elektroniki',
  sub: 'Fabryka układów, zakład optyki i zakład taśmy nadprzewodzącej: czyste hale, kopuła prób z kolimatorem, kriogenika, stacja zasilania i trzy pola radiatorów.',
  note: 'Wsad: ruda krzemu i niklu, surowy kryształ, ziemie rzadkie, przewód miedziany, nadstop niklu — koleją, ciężarówkami i statkami (doki od drogi; ruda krzemu także dokami od strony przestrzeni). Wyroby: układy, soczewki, taśma — łącznikami nad drogą do magazynów przy ringu, stamtąd ciężarówkami, koleją i kurierami. Radiatory żarzą się w takt pracy linii.',
  build({ style }) {
    const layout = buildElektronikaLayout();
    const { hulls, bulkBerth } = makeHulls(layout);
    const occupied = new Set();
    for (const b of layout.berths) if (hulls(b)) occupied.add(b.id);
    const buildings = [
      { name: 'Elektronika: rząd przy ringu', scene: buildRzadScene(layout, style, occupied) },
      { name: 'Fabryka układów', scene: buildFabScene(layout, style, occupied) },
      { name: 'Zakład optyki i stacja zasilania', scene: buildOptykaScene(layout, style, occupied) },
      { name: 'Zakład taśmy nadprzewodzącej', scene: buildKrioScene(layout, style, occupied) }
    ];
    const ruch = createRuch(layout, { yard: KRIO_YARD, bulkBerth });
    const S = ruch.state;
    const dome = buildings[2].scene.rig.dome;
    const yard = buildings[3].scene.rig.yard;

    function apply(api) {
      const [rzad, fab, opt, krio] = api.buildings;
      const [L0, L1, L2] = S.lines;
      S.lines.forEach((L, i) => {
        rzad._setChan(RZAD_CH.stock(i), L.stock);
        rzad._setChan(RZAD_CH.status(i), L.working);
      });
      fab._setChan(FAB_CH.status, L0.working);
      fab._setChan(FAB_CH.progress, L0.progress);
      fab._setChan(FAB_CH.heat, L0.heat);
      fab._setChan(FAB_CH.ship, L0.shipping);
      opt._setChan(OPT_CH.status, L1.working);
      opt._setChan(OPT_CH.progress, L1.progress);
      opt._setChan(OPT_CH.test, S.test.on);
      opt._setChan(OPT_CH.furnace, L1.phase === 'praca' ? L1.progress : L1.phase === 'wysyłka' ? 1 : 0);
      opt._setChan(OPT_CH.heat, S.power);
      opt._setChan(OPT_CH.dome, S.test.on || S.test.slew ? 0 : 1);
      krio._setChan(KRIO_CH.status, L2.working);
      krio._setChan(KRIO_CH.progress, L2.progress);
      krio._setChan(KRIO_CH.heat, L2.heat);
      // kopuła prób: obrót szczeliny wokół osi kopuły
      const Go = opt.uniforms.uGroup.value;
      const Md = Go[dome.group];
      Md.makeRotationY(S.dome.az);
      const e = Md.elements;
      Md.setPosition(dome.x - (e[0] * dome.x + e[8] * dome.z), 0, dome.z - (e[2] * dome.x + e[10] * dome.z));
      // suwnica placu szpul: brama wzdłuż u, wózek po belce (w), szpula na haku
      const Gk = krio.uniforms.uGroup.value;
      const C = S.crane;
      const [tx, tz] = yard.t;
      const [rx, rz] = yard.r;
      const dw = C.w - KRIO_YARD.home;
      Gk[yard.gantry].makeTranslation(tx * C.u, 0, tz * C.u);
      Gk[yard.trolley].makeTranslation(tx * C.u + rx * dw, 0, tz * C.u + rz * dw);
      Gk[yard.spool].makeTranslation(tx * C.u + rx * dw, -(1 - C.lift) * 38 * K7_ABOVE, tz * C.u + rz * dw);
      if (!C.carry) Gk[yard.spool].elements[15] = 0;
    }

    const E = layout.el;
    return {
      layout,
      hulls,
      buildings,
      lintelSkip: [[layout.sMin, layout.sMax]],   // zamiast bramownic: trzy łączniki zakład ↔ magazyn (budowla rzędu)
      views: [
        { name: 'Fabryka układów', sub: 'hale czyste, port krzemu, kolumny oczyszczania', caption: 'Dwie hale czyste z magistralą mediów; z tyłu doki rudy od strony przestrzeni i oddział oczyszczania krzemu',
          frame: corners(E.fab.s0 - 100, E.fab.s1 + 100, RING_V.outer0 - 400, E.fab.vPort + 500) },
        { name: 'Zakład optyki', sub: 'piece, szlifiernia, kopuła prób, kolimator, stacja zasilania', caption: 'Hodowla kryształu i szlifiernia; kopuła prób z tunelem kolimatora skierowanym w przestrzeń; obok stacja zasilania',
          frame: corners(E.opt.s0 - 100, E.opt.s1 + 300, RING_V.outer0 - 400, E.tunnel.v1 + 200) },
        { name: 'Zakład taśmy', sub: 'hala powlekania, plac szpul, kriogenika, zbiorniki', caption: 'Hala taśmy nadprzewodzącej, plac szpul z suwnicą, kriogenika i farma zbiorników helu i azotu',
          frame: corners(E.krio.s0 - 100, E.krio.s1 + 100, RING_V.outer0 - 400, E.krio.vBack + 500) },
        { name: 'Pola radiatorów', sub: 'żar pulsuje w takt pracy linii', caption: 'Pole radiatorów fabryki układów: trzon z kolektorami, sześć par paneli; im większe obciążenie, tym dalej sięga żar',
          at: [-3700, 11200], zoom: 0.14 },
        { name: 'Plac szpul', sub: 'suwnica: odbiór z hali → ekspedycja', caption: 'Suwnica bramowa przenosi szpule taśmy od wylotu hali do rampy ekspedycji',
          at: [KRIO_YARD.sc, RING_V.outer0 + 1850], zoom: 0.4 },
        { name: 'Kopuła prób', sub: 'obrotowa szczelina, tunel kolimatora', caption: 'Po każdej partii soczewek kopuła obraca szczelinę, a w tunelu kolimatora biegną światła próby',
          at: [E.dome.s, E.dome.v + 500], zoom: 0.3 }
      ],
      init(api) { apply(api); },
      step(dt) { ruch.step(dt); },
      frame(api) {
        apply(api);
        for (const p of ruch.ships()) api.proxy(p.id, p.hullId, p.x, p.z, p.heading, p);
      },
      hud() {
        const pct = (x) => `${Math.round(x * 100)}%`;
        const L = S.lines.map((l) => `${l.name} ${l.phase === 'praca' ? pct(l.progress) : l.phase}`).join(' · ');
        const test = S.test.slew ? ' · kopuła: obrót' : S.test.on ? ' · kolimator: próba' : '';
        return `<b>elektronika</b> ${L}${test} · radiatory ${pct((S.lines[0].heat + S.power + S.lines[2].heat) / 3)}`;
      },
      stats() {
        return {
          time: S.time,
          lines: S.lines.map((l) => ({ id: l.id, phase: l.phase, progress: l.progress, batches: l.batches, stock: l.stock, heat: l.heat })),
          power: S.power, test: { ...S.test }, domeAz: S.dome.az,
          crane: { ...S.crane }, bulk: { phase: S.bulk.phase, v: S.bulk.v, calls: S.bulk.calls }
        };
      },
      ruch
    };
  }
};
