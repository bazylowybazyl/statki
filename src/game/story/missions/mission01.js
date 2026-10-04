// ============================================================
// Misja 1 „Cicha stocznia” (prolog kampanii, zarazem samouczek) — 2026-09-30.
//
// Dok K-7 (intro, odprawa) → odcumowanie → skok na obrzeża → maskowanie i podejście → taran rzędu
// zaparkowanych okrętów → obrona stoczni (wieżyczki, eskorta) → budynek bronią wbudowaną (4) → łańcuch wybuchów
// → odwet piratów (7 pancerników, 8 niszczycieli, 15 fregat) → wsparcie z Ziemi (10 / 5 / 5) → zwycięstwo,
// nagrody (EXP, kredyty, reputacja) → wszyscy wracają → dok K-7.
//
// Dialogi: src/data/story/mission01.dialogue.js (miejsce na fabułę). Podpowiedzi samouczka pokazują się tylko
// z włączonym samouczkiem (panel „Nowa gra”). `api` — klej z grą (src/game/story/storyGame.js).
// Skoki dev: ?story=<faza> (MISSION01_PHASES) — wcześniejsze fazy pominięte, świat ustawiony jak po nich.
// ============================================================
import { MISSION01_DIALOGUE as D, MISSION01_TITLE } from '../../../data/story/mission01.dialogue.js';

export const MISSION01 = Object.freeze({
  id: 'm01_silent_shipyard',
  title: MISSION01_TITLE,
  description: 'Wejść po cichu do ukrytej stoczni piratów na obrzeżach układu, zniszczyć zaparkowaną flotę i zakład.',
  // Skład odwetu i wsparcia (decyzja użytkownika 2026-09-30).
  counterAttack: Object.freeze({ battleship: 7, destroyer: 8, frigate: 15 }),
  support: Object.freeze({ battleship: 10, destroyer: 5, frigate: 5 }),
  rewards: Object.freeze({ exp: 1500, credits: 60000, rep: Object.freeze({ terra_nova: 15, pirates: -20 }) }),
  ramTarget: 3,            // ile zaparkowanych trzeba zmiażdżyć (reszta może zostać)
  routFraction: 0.2,       // przy tej części żywego odwetu reszta ucieka warpem
  supportDelaySec: 22,     // od pierwszego wyrzutu piratów do wezwania wsparcia
  homeRadius: 25000        // „przy porcie” — dalej dokowanie przejmuje port (przejście przez czerń)
});

export const MISSION01_HINTS = Object.freeze({
  flight: { keys: ['W', 'S', 'A', 'D', 'Q', 'E'], title: 'Sterowanie', text: 'W / S — ciąg przód i wstecz, A / D — obrót, Q / E — ruch na boki. Wyprowadź Atlasa przez bramę G-01.' },
  warp: { keys: ['9', 'Shift', 'A', 'D'], title: 'Skok warp', text: 'Kurs jest wyznaczony; TRAVEL TO może wykonać podróż sam. Jeśli przejmiesz stery, A / D obróć dziób według wskaźnika WARP. Zielony kurs (±5°): naciśnij 9 lub trzymaj Shift — komputer doprecyzuje kierunek i sam wyjdzie przy punkcie kursu. Poza zielonym pasmem wyjście jest ręczne. Shift w studni grawitacyjnej Ziemi to dopalacz.' },
  cloak: { keys: ['I'], title: 'Maskowanie', text: 'I — maskowanie. Czujniki i działa piratów cię nie widzą. Pęka przy strzale, taranie i trafieniu; energia wystarcza na minutę.' },
  sneak: { keys: [], title: 'Podejście', text: 'Nie strzelaj. Leć prosto w początek rzędu zaparkowanych okrętów — znacznik na ekranie.' },
  ram: { keys: ['F'], title: 'Szarża', text: 'Ustaw dziób wzdłuż rzędu i naciśnij F — szarża: kilka sekund pełnej mocy kosztem całego ładunku reaktora. Rozpędzony Atlas miażdży kadłuby po kolei, a taran zdejmuje maskowanie.' },
  weapons: { keys: ['LPM', 'T', '1', '2', '3'], title: 'Broń', text: 'Działa burtowe strzelają same do wszystkiego w zasięgu. LPM — salwa baterii głównej w kursor (komputer wyprzedza cel przy kursorze), T — cel priorytetowy dla całego okrętu, 1–3 — która grupa jest w ręku. Zniszcz wieżyczki i eskortę.' },
  builtin: { keys: ['4'], title: 'Broń wbudowana', text: '4 — Hexlance. Naciśnij, by naładować, i jeszcze raz, by odpalić wzdłuż dziobu. Wyceluj Atlasa w budynek stoczni.' },
  fleet: { keys: [], title: 'Wsparcie', text: 'Posiłki z Ziemi walczą przy tobie. Rozkazy skrzydła (ESKORTA / ATAK) — zakładka Rezerwa w kokpicie.' },
  home: { keys: ['9', 'Shift'], title: 'Powrót', text: 'Kurs na Ziemię wyznaczony. TRAVEL TO prowadzi podróż; ręcznie ustaw zielony kurs (±5°) i skocz: 9 albo trzymaj Shift. Warp wyjdzie przed studnią grawitacyjną, dalej leć napędem ku hali K-7 — dokowanie przejmie port.' }
});

// Kolejność faz (skoki dev: ?story=<faza> — pomija wcześniejsze, stawia świat jak po nich).
export const MISSION01_PHASES = Object.freeze(['intro', 'briefing', 'undock', 'course', 'approach', 'ram', 'defences', 'shipyard', 'counter', 'victory', 'return', 'done']);

export async function mission01(ctx) {
  const api = ctx.api;
  const M = MISSION01;
  const tutorial = !!api.tutorial;
  const hint = (key, until) => (tutorial ? api.ui.hint(MISSION01_HINTS[key], until) : null);
  const from = Math.max(0, MISSION01_PHASES.indexOf(api.startPhase || 'intro'));
  const run = (phase) => MISSION01_PHASES.indexOf(phase) >= from;

  api.journal.begin(M, [
    'Odcumuj z hali K-7.',
    'Skocz w pobliże stoczni.',
    'Podejdź niewykryty i staranuj zaparkowane okręty.',
    'Zniszcz obronę i budynek stoczni.',
    'Odeprzyj odwet piratów.',
    'Wróć do K-7.'
  ]);

  // Porażka: Atlas zniszczony — przerwij misję (gra pokazuje własny ekran śmierci).
  const defeatWatch = ctx.spawn(async (sub) => {
    await sub.event('playerDestroyed');
    api.ui.objective(null);
    api.ui.hint(null);
    api.journal.fail('Atlas zniszczony.');
    api.say(D.defeat, 'radio');
    ctx.cancel('player-destroyed');
  });

  // ---------------------------------------------------------------- 1. DOK I INTRO, 2. ODCUMOWANIE
  if (run('intro')) {
    ctx.phase('intro');
    api.dock.place('C-01');
    await api.cinema.intro();
    ctx.phase('briefing');
    await api.say(D.briefing, 'scene');

    ctx.phase('undock');
    api.say(D.undock, 'radio');
    await api.dock.undock();
    await api.cinema.release();
    api.ui.objective('undock', 'Wyprowadź Atlasa z hali K-7 przez bramę G-01');
    hint('flight', () => api.dock.isOutside());
    await ctx.until(() => api.dock.isOutside());
  } else if (MISSION01_PHASES.indexOf(api.startPhase) <= MISSION01_PHASES.indexOf('course')) {
    const p = api.dock.approachPoint();
    api.dev.teleport(p.x, p.y);
  }
  api.journal.step(0);

  // ---------------------------------------------------------------- 3. KURS I SKOK
  ctx.phase('course');
  const site = api.site.plan();
  api.site.spawn(site);
  if (run('course')) {
    api.nav.setCourse(site.rally.x, site.rally.y, 'Stocznia piratów');
    api.say(D.course, 'radio');
    api.ui.objective('warp', 'Skocz w pobliże stoczni piratów');
    hint('warp', () => api.nav.inWarp() || api.nav.distanceTo(site.rally) < 30000);
    await ctx.until(() => api.nav.distanceTo(site.rally) < 30000 && !api.nav.inWarp());
    api.nav.clearCourse();
  } else {
    api.dev.teleport(site.rally.x, site.rally.y, site.rally.angle);
  }
  api.journal.step(1);

  // ---------------------------------------------------------------- 4. MASKOWANIE I PODEJŚCIE
  ctx.phase('approach');
  api.cloak.enable(true);
  // Podejście po cichu: wieże na auto milczą do alarmu (grupa w ręku strzela tylko na rozkaz gracza).
  api.fire.hold(true);
  let spotted = false;
  let alarmWatch = null;
  if (run('approach')) {
    api.say(D.arrival, 'radio');
    alarmWatch = ctx.spawn(async (sub) => {
      await sub.until(() => api.site.detected(site));
      spotted = true;
    });
    api.ui.objective('cloak', 'Włącz maskowanie (I)');
    hint('cloak', () => api.cloak.hidden() || spotted);
    await ctx.until(() => api.cloak.hidden() || spotted);
    if (!spotted) api.say(D.cloaked, 'radio');
    api.ui.marker('row', site.rowStart, 'Rząd okrętów');
    api.ui.objective('sneak', 'Podkradnij się do rzędu zaparkowanych okrętów');
    hint('sneak', () => spotted || api.nav.distanceTo(site.rowStart) < 5000);
    await ctx.until(() => spotted || api.nav.distanceTo(site.rowStart) < 5000);
  } else {
    const back = 5000;
    api.dev.teleport(site.rowStart.x - Math.cos(site.axis) * back, site.rowStart.y - Math.sin(site.axis) * back, site.axis);
  }

  // ---------------------------------------------------------------- 5. TARAN
  ctx.phase('ram');
  const ramGoal = Math.min(M.ramTarget, site.parkedCount());
  if (run('ram')) {
    if (!spotted) api.say(D.ramOrder, 'radio');
    api.ui.marker('row', site.rowStart, 'Rząd okrętów');
    api.ui.objective('ram', 'Staranuj zaparkowane okręty', () => `${Math.min(ramGoal, site.parkedKilled())} / ${ramGoal}`);
    hint('ram', () => site.parkedKilled() >= 1);
    // Alarm: pierwsze zderzenie z rzędem, zniszczony kadłub albo wykrycie.
    await ctx.until(() => spotted || site.rammed() || site.parkedKilled() > 0);
    alarmWatch?.cancel();
    api.site.alarm(site);
    api.fire.hold(false);
    api.say(spotted && !site.rammed() ? D.spotted : D.alarm, 'radio');
    await ctx.until(() => site.parkedKilled() >= ramGoal, { timeout: 30 });
  } else {
    alarmWatch?.cancel();
    api.dev.kill(site.parkedList.slice(0, ramGoal));
    api.site.alarm(site);
    api.fire.hold(false);
  }
  api.ui.marker('row', null);
  api.journal.step(2);

  // ---------------------------------------------------------------- 6. OBRONA STOCZNI
  ctx.phase('defences');
  if (run('defences')) {
    api.ui.objective('defences', 'Zniszcz obronę stoczni',
      () => `wieżyczki ${site.turretsKilled()} / ${site.turretCount()}, eskorta ${site.defendersKilled()} / ${site.defenderCount()}`);
    hint('weapons', () => site.turretsKilled() + site.defendersKilled() >= 2);
    await ctx.until(() => site.turretsAlive() === 0 && site.defendersAlive() === 0);
    api.say(D.defencesDown, 'radio');
  } else {
    api.dev.kill([...site.turretList, ...site.defenderList]);
  }

  // ---------------------------------------------------------------- 7. BUDYNEK
  ctx.phase('shipyard');
  if (run('shipyard')) {
    api.ui.marker('yard', site.building, 'Stocznia');
    api.ui.objective('yard', 'Zniszcz budynek stoczni bronią wbudowaną (4)', () => `${Math.round(site.buildingHpFrac() * 100)}%`);
    hint('builtin', () => site.buildingHpFrac() < 0.9 || site.buildingDestroyed());
  } else {
    api.dev.destroyStation(site.station);
  }
  await ctx.until(() => site.buildingDestroyed());
  api.ui.marker('yard', null);
  api.ui.objective(null);
  await api.site.chainExplosion(site);
  api.say(D.shipyardDown, 'radio');
  api.journal.step(3);

  // ---------------------------------------------------------------- 8. ODWET
  ctx.phase('counter');
  let allies = null;
  if (run('counter')) {
    await ctx.wait(4);
    api.say(D.counterAttack, 'radio');
    const pirates = api.fleet.pirateCounterAttack(site, M.counterAttack);
    api.ui.objective('survive', 'Przetrwaj — posiłki z Ziemi w drodze');
    await ctx.until(() => pirates.arrived() > 0, { timeout: 30 });
    await ctx.wait(M.supportDelaySec);
    allies = api.fleet.earthSupport(site, M.support);
    api.say(D.support, 'radio');
    hint('fleet', () => allies.arrived() >= 5);
    api.ui.objective('counter', 'Zniszcz flotę odwetową', () => `${pirates.killed()} / ${pirates.total()}`);
    await ctx.until(() => pirates.pending() === 0 && pirates.alive() <= Math.ceil(pirates.total() * M.routFraction));
    if (pirates.alive() > 0) {
      api.say(D.pirateRout, 'radio');
      pirates.retreat();
    }
    await ctx.until(() => pirates.alive() === 0, { timeout: 45 });
  }
  api.journal.step(4);

  // ---------------------------------------------------------------- 9. ZWYCIĘSTWO
  ctx.phase('victory');
  api.ui.objective(null);
  const reward = api.rewards.grant(M.rewards);
  if (run('victory')) {
    api.say(D.victory, 'radio');
    await ctx.wait(3);
    allies?.returnHome();
    await api.ui.summary({ title: 'MISJA WYKONANA', subtitle: M.title, reward });
  }

  // ---------------------------------------------------------------- 10. POWRÓT
  ctx.phase('return');
  const home = api.dock.approachPoint();
  api.nav.setCourse(home.x, home.y, 'Ziemia — hala K-7');
  api.ui.objective('home', 'Wróć do hali K-7');
  hint('home', () => api.dock.nearHall(M.homeRadius * 2));
  await ctx.until(() => api.dock.nearHall(M.homeRadius) && !api.nav.inWarp());
  api.nav.clearCourse();
  api.ui.objective(null);
  await api.cinema.dockReturn('C-01');
  await api.say(D.homecoming, 'scene');
  api.journal.step(5);
  api.journal.complete();
  await api.cinema.release();
  api.dock.release();
  defeatWatch.cancel('complete');
  ctx.phase('done');
  return 'complete';
}
