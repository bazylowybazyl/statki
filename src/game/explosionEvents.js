// src/game/explosionEvents.js
//
// Wybuchy po stronie GRY (RW-22, docs/PLAN-render-worker.md § 3.3 „uzupełnienie 2026-10-15”, § 2.6 p. 23): rekord
// EXPLOSION (src/render/hullCommands.js) zamiast wywołania fabryki wybuchów WebGPU (`window.makeReactorBlow`,
// `shipBlastFactory`). Gra rozwiązuje opcje fabryki (domyślne `??` jak w createExplosionFactory) i sama zmiata drony
// naprawcze w zasięgu (dawne opakowanie withRepairDroneBlast — rozgrywka nie może czekać na render). Wynik fabryki
// (czy wybuch ruszył) gry nie steruje — `ready` mówi tylko, czy render ma fabrykę (inline: ustawia index.html przy
// tworzeniu fabryki; worker — flaga z kanału zwrotnego).

import { HC, EXPLOSION } from '../render/hullCommands.js';

/**
 * @param writer — pisarz rozkazów (RenderCommands.writer)
 * @param sweepDrones — (opts) → void: obrażenia dronów naprawczych w zasięgu wybuchu (gra)
 */
/** Pojemność pierścienia ostatnich wybuchów (`api.recent`). */
export const RECENT_BLASTS = 32;
const RECENT = RECENT_BLASTS;

export function createExplosionEvents(writer, { sweepDrones = null } = {}) {
  const api = {
    ready: false,
    stats: { written: 0, swept: 0 },
    // Ostatnie wybuchy (x, y, size — świat gry) w pierścieniu: czytają je moduły gry, które same pakują wejście renderu
    // (gaz w otwartej przestrzeni — src/game/spaceGasInput.js: front wybuchu wydmuchuje dziurę w gazie). `count` rośnie
    // z każdym wybuchem — czytający pamięta, ile już widział.
    recent: new Float64Array(RECENT * 3),
    count: 0,
    /**
     * Wybuch z opcjami fabryki `{ x, y, size, profile, vx, vy, axisX, axisY, jetVelTau, tint, gasOnly, hostKey }`.
     * `drones` — zmieść drony naprawcze (dawne window.makeReactorBlow: rozpad bazy, szyja, fabuła, śmierć gracza bez
     * rdzenia); bez — wybuchy okrętów (zbiornik, zgniot, gaz rdzenia) jak shipBlastFactory. Zwraca `ready`.
     */
    blast(o, drones = false) {
      // Bez fabryki w renderze (przed startem 3D) nie było też opakowania z dronami — ani wybuchu, ani obrażeń.
      if (!api.ready || !o) return false;
      if (drones && sweepDrones) { sweepDrones(o); api.stats.swept++; }
      const prof = writer.str(o.profile ?? 'capital');
      const E = EXPLOSION;
      const r = writer._begin(HC.EXPLOSION, E.WORDS);
      const d = writer.ring.data;
      d[r + E.X] = o.x ?? 0;
      d[r + E.Y] = o.y ?? 0;
      d[r + E.SIZE] = o.size ?? 300;
      d[r + E.PROFILE] = prof;
      d[r + E.VX] = o.vx ?? 0;
      d[r + E.VY] = o.vy ?? 0;
      d[r + E.AXIS_X] = Number(o.axisX) || 0;
      d[r + E.AXIS_Y] = Number(o.axisY) || 0;
      d[r + E.JET_TAU] = Number(o.jetVelTau);
      const tint = o.tint || null;
      d[r + E.HAS_TINT] = tint ? 1 : 0;
      d[r + E.TINT_R] = tint ? tint[0] : 0;
      d[r + E.TINT_G] = tint ? tint[1] : 0;
      d[r + E.TINT_B] = tint ? tint[2] : 0;
      d[r + E.GAS_ONLY] = o.gasOnly ? 1 : 0;
      d[r + E.HOST_KEY] = Number(o.hostKey) || 0;
      writer._commit();
      api.stats.written++;
      const k = (api.count % RECENT) * 3;
      api.recent[k] = o.x ?? 0;
      api.recent[k + 1] = o.y ?? 0;
      api.recent[k + 2] = o.size ?? 300;
      api.count++;
      return true;
    }
  };
  return api;
}
