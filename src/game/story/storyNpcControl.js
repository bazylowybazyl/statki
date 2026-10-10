// ============================================================
// Sterowanie okrętami misji (2026-10-07) — rozkazy, które skrypt misji wydaje NPC przez klej StoryGame:
// wylot z doku trasą (eskorta z hali, zegar wodowania misji 1: wyjazd rufą ze stanowiska parkingu, wodowanie
// z pochylni), załoga przy działach (okręt w stanowisku strzela z miejsca), ucieczka (herszt przed skokiem).
// Mózg rozkazu siedzi w `npc.ai` (pętla NPC gry woła go co krok); lot przez model lotu NPC (shipFlightModel),
// ogień przez autonomiczne wieże (capitalAI). Gra podaje zegar i obudzenie mózgu bojowego:
//
//   const npcs = createStoryNpcControl({ gameTime: () => gameTime, wake: (npc) => storyWakeNpc(npc) });
//   StoryGame.init({ launchNpc: npcs.launch, armNpc: npcs.arm, fleeNpc: npcs.flee, … });
// ============================================================
import { setFlightArrive, setFlightStop, usesShipFlightModel } from '../flight/shipFlightModel.js';
import { processAutonomousWeapons } from '../../ai/capitalAI.js';
import { ENGINE_OFF, engineRunning, engineStateOf, igniteEngine, engineIgnitionDuration } from '../engineIgnition.js';

// Punkt trasy uznany za osiągnięty [j.] i domyślne cofanie [j/s] (poniżej pasma, w którym pilot obraca dziób
// w kierunek lotu — resolveFlightFacing).
const REACH = 280;
const REVERSE_SPEED = 160;

export function createStoryNpcControl({ gameTime, wake }) {
  const now = () => Number(gameTime()) || 0;
  return {
    /**
     * Wylot trasą: od punktu `opts.fightFrom` (domyślnie drugiego — za bramą) okręt walczy, na końcu trasy mózg
     * bojowy (`wake`). Punkt z `face` (kurs) i `speed` [j/s] = cofanie: wolno, dziobem w `face`. `delay` [s gry].
     */
    launch(npc, path, delay = 0, opts = {}) {
      if (!npc || npc.dead) return;
      if (!Array.isArray(path) || !path.length || !usesShipFlightModel(npc)) { wake(npc); return; }
      const start = now() + Math.max(0, Number(delay) || 0);
      const fightFrom = Number.isFinite(opts?.fightFrom) ? opts.fightFrom : 2;
      let k = 0;
      npc.combatDisabled = true;
      npc.__dockLaunching = true;
      // Silniki wyłączone w doku (src/game/engineIgnition.js): zapłon z dymem tyle przed startem, ile trwa — przy krótszym
      // opóźnieniu start czeka na pełną pracę silników (najwyżej długość zapłonu). Stoi w miejscu do pracy silników.
      const igniteAt = start - engineIgnitionDuration();
      const holdFace = Number(npc.angle) || 0;
      npc.ai = () => {
        if (npc.dead) return;
        const t = now();
        if (npc.engineIgn && engineStateOf(npc) === ENGINE_OFF && t >= igniteAt) igniteEngine(npc);
        if (t < start) return;
        if (!engineRunning(npc)) { setFlightStop(npc, holdFace); return; }
        const px = npc.pos ? npc.pos.x : npc.x;
        const py = npc.pos ? npc.pos.y : npc.y;
        if (Math.hypot(path[k].x - px, path[k].y - py) < REACH) {
          k++;
          if (k >= fightFrom) npc.combatDisabled = false;
          if (k >= path.length) {
            npc.__dockLaunching = false;
            wake(npc);
            return;
          }
        }
        const q = path[k];
        const last = k >= path.length - 1;
        if (Number.isFinite(q.face)) {
          setFlightArrive(npc, q.x, q.y, { arrival: 0, speedLimit: Number(q.speed) || REVERSE_SPEED, face: q.face, faceNear: 1e9, faceFar: 2e9 });
        } else {
          setFlightArrive(npc, q.x, q.y, { arrival: last ? 0 : 220, speedMode: 'combat', noBrake: !last, faceNear: 0, faceFar: 0 });
        }
      };
    },

    /** Załoga przy działach: okręt stoi w kursie, w którym go zastano, wieże strzelają same. */
    arm(npc) {
      if (!npc || npc.dead) return;
      const face = Number(npc.angle) || 0;
      npc.combatDisabled = false;
      npc.ai = (dt) => {
        if (npc.dead) return;
        if (usesShipFlightModel(npc)) setFlightStop(npc, face);
        processAutonomousWeapons(npc, dt);
      };
    },

    /** Ucieczka w punkt (np. przed skokiem warp): pełna prędkość bojowa, wieże strzelają dalej. */
    flee(npc, point) {
      if (!npc || npc.dead || !point) return;
      const x = point.x, y = point.y;
      npc.combatDisabled = false;
      // Ucieczka: zryw silników (system F, src/ai/npcShipSystem.js) wolno odpalić mimo wroga w zasięgu.
      npc.__fleeing = true;
      npc.ai = (dt) => {
        if (npc.dead) return;
        if (usesShipFlightModel(npc)) setFlightArrive(npc, x, y, { arrival: 0, speedMode: 'combat', faceNear: 0, faceFar: 0 });
        processAutonomousWeapons(npc, dt);
      };
    }
  };
}
