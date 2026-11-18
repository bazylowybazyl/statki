// HUTA — formowanie, etap „Złożenie”: STAN RZECZY RUCHOMYCH OTOCZENIA (czysty JS, bez three; krok bez alokacji).
//
//   • ZAWÓR DYSZY naczynia (klapy; STYK WYPŁYWU): otwiera się tuż przed spływem metalu gardzielą — gdy czas od zetknięcia
//     masy z lejem `impactT` ≥ `drainDelay` − `lead` — i zamyka `hold` s po ostatniej jednostce metalu w leju. Etap
//     „Pasmo” bierze stąd chwilę otwarcia (struga wychodzi z dyszy dopiero przy otwartym zaworze).
//   • DOK ŻUŻLA: granulat z odbieralnika komory (licznik `wywiezione` — tony żużla, który zsunął się z koryta do kanału
//     w ścianie) trafia rurą (transport pneumatyczny, `DOK_ZUZLA.pipeRate` t/s) do skrzyni w hali; skrzynia oddaje go
//     wylotem w dnie do sieci ringu stałym tempem. Poziom = całka dopływ − odpływ (bilans: przyjęte = w rurze + w skrzyni
//     + oddane).
import { PROCES } from '../wytop/komora.js';
import { DOK_ZUZLA, SPUST } from './geometria.js';

// (Od etapu „Kropla” klapy siedzą na WYLEWCE rury spustowej: zawór wylewki — `linia.js`, `LIN_STAN.spout` — otwiera się
// na zezwolenie spływu stąd albo na metal w rurze i zamyka po opróżnieniu rury; kąt klap: `valveAngle(open)`.)

/** Kąt obrotu klap zaworu wylewki [rad] przy otwarciu 0…1 (gładki start i koniec ruchu). */
export function valveAngle(open) { const u = Math.max(0, Math.min(1, open)); return SPUST.klapy.open * u * u * (3 - 2 * u); }

/** Zawór dyszy: `open` 0…1 (rysunek), `want` — zawór ma być otwarty. */
export function createNozzleValve({ lead = 0.25, hold = 0.4, time = 0.25 } = {}) {
  const st = { open: 0, want: 0, empty: 0 };
  return {
    state: st,
    /**
     * @param {number} dt
     * @param {number} impactT  czas od zetknięcia masy z lejem [s] (< 0 — przed zetknięciem)
     * @param {number} funnelUnits  metal w leju [jednostki]
     */
    step(dt, impactT, funnelUnits) {
      if (impactT >= 0 && funnelUnits <= 0) st.empty += dt; else st.empty = 0;
      st.want = impactT >= PROCES.drainDelay - lead && st.empty < hold ? 1 : 0;
      const d = dt / time;
      st.open = st.want ? Math.min(1, st.open + d) : Math.max(0, st.open - d);
      return st.open;
    },
    /** Kąt obrotu klap [rad] (gładki start i koniec ruchu). */
    angle() { return valveAngle(st.open); }
  };
}

/** Dok żużla: `pipe` — w rurze [t], `level` — w skrzyni [t], `heat` 0…1 (świeży granulat), bilans `inT = pipe + level + outT`. */
export function createSlagDock() {
  const st = { pipe: 0, level: 0, heat: 0, inT: 0, outT: 0, lastSeen: -1, spill: 0 };
  return {
    state: st,
    /**
     * @param {number} dt
     * @param {number} deliveredT  łączne tony żużla wywiezione z odbieralnika komory (licznik rosnący)
     */
    step(dt, deliveredT) {
      if (st.lastSeen < 0) st.lastSeen = deliveredT;          // start: to, co wywieziono przed wejściem, już odjechało
      let add = deliveredT - st.lastSeen;
      st.lastSeen = deliveredT;
      if (!(add > 0)) add = 0;
      st.inT += add;
      st.pipe += add;
      const arrive = Math.min(st.pipe, DOK_ZUZLA.pipeRate * dt);
      st.pipe -= arrive;
      st.level += arrive;
      if (arrive > 0) st.heat = Math.min(1, st.heat + arrive / 8);
      const out = Math.min(st.level, DOK_ZUZLA.drain * dt);
      st.level -= out;
      st.outT += out;
      // przepełnienie (nie zdarza się przy obiegu ~60 t): nadmiar od razu do wylotu
      if (st.level > DOK_ZUZLA.cap) { st.outT += st.level - DOK_ZUZLA.cap; st.spill += st.level - DOK_ZUZLA.cap; st.level = DOK_ZUZLA.cap; }
      st.heat *= Math.exp(-dt / 9);
      return st.level;
    },
    /** Wypełnienie skrzyni 0…1. */
    fill() { return st.level / DOK_ZUZLA.cap; },
    audit() { return st.inT - st.pipe - st.level - st.outT; }
  };
}
