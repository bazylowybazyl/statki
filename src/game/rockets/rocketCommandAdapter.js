// src/game/rockets/rocketCommandAdapter.js — reżyser efektów rakiet po stronie GRY (RW-23, docs/PLAN-render-worker.md
// § 3.3): symulacja (rocketSim.js) woła te same metody co dawniej reżysera renderu (`effects`), a adapter zapisuje
// zdarzenia jako rekordy RKT_* strumienia rozkazów (src/render/renderCommands.js). Dekoder renderu
// (src/3d/rockets/rocketFxCommands.js) woła reżysera z rakietą z puli (inline: obiekt symulacji; worker: lustro bloku
// ROCKETS). Kolejność rekordów = kolejność dawnych wywołań (także krok lotu każdej rakiety), więc w trybie inline obraz
// jest bit w bit jak przy wywołaniach wprost.
//
// Szarpnięcie kasety wyrzutni (odrzut wieży z danych broni — Turret2D.triggerShot) robi gra tutaj, przy wyrzucie
// (dawniej reżyser renderu w onLaunch); głowica potomna Hydry kasety nie szarpie.

import { Turret2D, normalizeWeaponFxKey } from '../../vfx/turret2D.js';
import { LAUNCH_SPLIT } from './rocketSim.js';

/** writer — RenderCommandWriter (RenderCommands.writer). */
export function createRocketCommandAdapter(writer) {
  return {
    /** Szarpnięcie kasety wyrzutni przy wyrzucie (dawne `opts.launcherKick` reżysera). */
    launcherKick: true,
    beginUpdate(active) { writer.rocketBegin(active); },
    onLaunch(r, colorTheme = 'blue') {
      if (r.mode !== LAUNCH_SPLIT && r.shooter && this.launcherKick) {
        try { Turret2D.triggerShot(normalizeWeaponFxKey(r.weaponDef?.id), r.position.x, r.position.z, r.shooter); } catch { /* bez wieżyczki */ }
      }
      writer.rocketLaunch(r, colorTheme);
    },
    onIgnite(r) { writer.rocketIgnite(r); },
    onFly(r, dt) { writer.rocketFly(r, dt); },
    onSplit(r) { writer.rocketSplit(r); },
    onIntercept(r, x, y) { writer.rocketIntercept(r, x, y); },
    prepareContact(r, x0, y0, x1, y1) { writer.rocketContact(r, x0, y0, x1, y1); },
    onDetonate(r, x, y, hit, hitShield) { writer.rocketDetonate(r, x, y, hit, hitShield); },
    update(dt) { writer.rocketUpdate(dt); }
  };
}
