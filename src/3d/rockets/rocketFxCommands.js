// src/3d/rockets/rocketFxCommands.js — dekoder rekordów rakiet strumienia rozkazów (RW-23, docs/PLAN-render-worker.md
// § 3.3): RKT_* → reżyser efektów rakiet (effects.js) z rakietą z puli symulacji. `rocketAt(slot)` — rakieta w slocie
// (inline: pula src/game/rockets/rocketSim.js; worker: lustro bloku ROCKETS migawki). Kilwater torpedy — pocisk z
// czytelnika (slot pocisku).

import { RC, RKT } from '../../render/renderCommands.js';

/**
 * director — RocketEffects (createRocketFx(Core3D).director), rocketAt(slot) → rakieta. Bez reżysera (brak GPU) —
 * rekordy przepadają (dawniej: symulacja bez `effects`).
 */
export function installRocketFxCommands(reader, director, rocketAt) {
  if (!reader || !director || typeof rocketAt !== 'function') return false;
  reader.on(RC.RKT_BEGIN, (r, d, o) => { if (typeof director.beginUpdate === 'function') director.beginUpdate(d[o]); });
  reader.on(RC.RKT_LAUNCH, (r, d, o) => director.onLaunch(rocketAt(d[o + RKT.SLOT]), r.str(d[o + RKT.L_COLOR])));
  reader.on(RC.RKT_IGNITE, (r, d, o) => director.onIgnite(rocketAt(d[o + RKT.SLOT])));
  reader.on(RC.RKT_FLY, (r, d, o) => director.onFly(rocketAt(d[o + RKT.SLOT]), d[o + RKT.F_DT]));
  reader.on(RC.RKT_SPLIT, (r, d, o) => { if (typeof director.onSplit === 'function') director.onSplit(rocketAt(d[o + RKT.SLOT])); });
  reader.on(RC.RKT_INTERCEPT, (r, d, o) => {
    if (typeof director.onIntercept === 'function') director.onIntercept(rocketAt(d[o + RKT.SLOT]), d[o + RKT.I_X], d[o + RKT.I_Y]);
  });
  reader.on(RC.RKT_CONTACT, (r, d, o) => director.prepareContact(rocketAt(d[o + RKT.SLOT]),
    d[o + RKT.C_X0], d[o + RKT.C_Y0], d[o + RKT.C_X1], d[o + RKT.C_Y1]));
  reader.on(RC.RKT_DETONATE, (r, d, o) => director.onDetonate(rocketAt(d[o + RKT.SLOT]),
    d[o + RKT.D_X], d[o + RKT.D_Y], r.ent(d, o + RKT.D_HIT), d[o + RKT.D_SHIELD] === 1));
  reader.on(RC.RKT_UPDATE, (r, d, o) => director.update(d[o]));
  reader.on(RC.RKT_WAKE, (r, d, o) => {
    const b = r.shot(d, o + RKT.W_SHOT);
    if (b && typeof director.torpedoWake === 'function') director.torpedoWake(b, d[o + RKT.W_DT]);
  });
  // Szarpnięcie kasety wyrzutni robi gra (adapter rakiet) — reżyser renderu nie rusza stanu wież.
  if (director.opts) director.opts.launcherKick = false;
  return true;
}
