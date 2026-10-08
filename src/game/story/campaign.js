// ============================================================
// Kampania (2026-10-07): rozdział 1 = dwie misje jedna po drugiej, w tym samym świecie.
//
//   misja 1 „Cicha stocznia” (src/game/story/missions/mission01.js) — dok K-7 → rozpoznanie → taran →
//     zegar wodowania (okręty na parkingu i pochylniach startują po kolei) → supercapital herszta → suchy dok;
//     kończy się w polu, nad gruzami stoczni (podsumowanie misji 1);
//   misja 2 „Odwet” (src/game/story/missions/mission02.js) — naprawa w polu → trzy fale piratów (w trzeciej
//     okręt herszta), posiłki z Ziemi w drugiej → powrót do K-7.
//
// Fazy obu misji tworzą jedną listę (skoki dev ?story=<faza>; nazwy jak dawniej tam, gdzie używają ich skrypty
// harnessu: ram, defences, shipyard, counter, return, done). Skok do fazy misji 2 przechodzi misję 1 w trybie
// „pominięte” (świat jak po niej).
// ============================================================
import { mission01, MISSION01_PHASES } from './missions/mission01.js';
import { mission02, MISSION02_PHASES } from './missions/mission02.js';

export const CAMPAIGN_PHASES = Object.freeze([...MISSION01_PHASES, ...MISSION02_PHASES]);

export async function runCampaign(ctx) {
  const r1 = await mission01(ctx);
  if (r1 !== 'complete') return r1;
  return mission02(ctx);
}
