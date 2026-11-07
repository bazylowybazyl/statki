// ============================================================
// Kampania (2026-10-07): rozdział 1 = dwie misje jedna po drugiej, w tym samym świecie.
//
//   misja 1 „Cicha baza” (src/game/story/missions/mission01.js) — dok K-7 → rozpoznanie → taran rzędu →
//     drony, zegar startów (okręty z załogą odchodzą od pomostów po kolei) → supercapital herszta → habitat bazy
//     piratów (rozpad i upadek, ogień w rurach tylko po wysadzeniu zbiorników); kończy się w polu, nad gruzami bazy;
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

// WZNOWIENIE Z ZAPISU GRACZA (src/game/playerSave.js — campaignCheckpoint): fazy, od których kampania umie ruszyć skokiem
// (pierwsza = zwykły start; reszta działa jak skoki dev ?story=<faza> — wcześniejsze fazy „pominięte”), i fazy, w których
// skrypt wypłaca nagrodę misji (`api.rewards.grant`). Zapis zrobiony w fazie z nagrodą albo po niej wznawia od NASTĘPNEGO
// punktu — inaczej nagroda (już w zapisanych kredytach, reputacji i EXP) przyszłaby drugi raz. Strażnik: test kampanii
// w tests/storyMission.test.mjs zbiera fazy wypłat na atrapie gry. Nowa nagroda w skrypcie = faza tutaj.
export const CAMPAIGN_RESUME = Object.freeze({
  phases: CAMPAIGN_PHASES,
  missions: Object.freeze([MISSION01_PHASES, MISSION02_PHASES]),
  checkpoints: Object.freeze(['intro', 'repair', 'ambush', 'return']),
  rewardPhases: Object.freeze(['aftermath', 'victory'])
});

export async function runCampaign(ctx) {
  const r1 = await mission01(ctx);
  if (r1 !== 'complete') return r1;
  return mission02(ctx);
}
