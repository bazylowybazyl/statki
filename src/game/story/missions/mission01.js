// ============================================================
// Misja 1 „Cicha stocznia” (prolog kampanii, zarazem samouczek) — 2026-09-30.
//
// Dok K-7 (intro, odprawa) → odcumowanie → skok na obrzeża → ROZPOZNANIE przez mgłę wojny (czujniki grawitacyjne
// widzą tylko dużą masę — dron zwiadu albo ostrożne podejście) → maskowanie i podejście → taran rzędu
// okrętów w suchym doku → obrona stoczni (eskorta i supercapital z hali) → dok bronią wbudowaną (4) → łańcuch wybuchów
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
  scout: { keys: ['PPM', 'M'], title: 'Mgła wojny', text: 'Widzisz tylko to, co jest w zasięgu wzroku Atlasa i twojej floty — dalej jest mgła. Czujniki grawitacyjne pokazują dużą masę, ale nie mówią, czym jest. Rozpoznaj ją: PPM w pustej przestrzeni → DRON ZWIADU (leci w punkt i odsłania mgłę wokół siebie; także mapa CIC, M) albo podejdź ostrożnie — niezamaskowanego Atlasa obrona wykryje z ~9 km.' },
  warp: { keys: ['CapsLock', '9', 'A', 'D', 'Shift'], title: 'Skok warp', text: 'Kurs jest wyznaczony; TRAVEL TO może wykonać podróż sam. Jeśli przejmiesz stery, A / D obróć dziób według wskaźnika WARP. Zielony kurs (±5°): naciśnij CapsLock (albo 9) — komputer doprecyzuje kierunek i sam wyjdzie przy punkcie kursu. Poza zielonym pasmem wyjście jest ręczne (CapsLock / 9 jeszcze raz). Shift to dopalacz.' },
  cloak: { keys: ['I'], title: 'Maskowanie', text: 'I — maskowanie. Czujniki i działa piratów cię nie widzą. Pęka przy strzale, taranie i trafieniu; energia wystarcza na minutę.' },
  sneak: { keys: [], title: 'Podejście', text: 'Nie strzelaj. Leć prosto w początek rzędu zaparkowanych okrętów — znacznik na ekranie.' },
  ram: { keys: ['F', '4'], title: 'Szarża albo broń wbudowana', text: 'Okręty stoją w jednym rzędzie — ustaw dziób wzdłuż niego. F — szarża: kilka sekund pełnej mocy kosztem całego ładunku reaktora; rozpędzony Atlas miażdży kadłuby po kolei. Albo 4 — Hexlance (BUILT-IN): naładuj i odpal wzdłuż dziobu — pręt przebija rząd na wylot i tnie wszystkie okręty na swojej drodze. Jedno i drugie zdejmuje maskowanie.' },
  weapons: { keys: ['LPM', 'T', '1', '2', '3'], title: 'Broń', text: 'Działa burtowe strzelają same do wszystkiego w zasięgu. LPM — salwa baterii głównej w kursor (komputer wyprzedza cel przy kursorze), T — cel priorytetowy dla całego okrętu (trzymaj T i przeciągnij kursor po wrogach — kilka naraz; rakiety same biorą to, co strzela do ciebie), 1–3 — która grupa jest w ręku. Zniszcz okręty, które wylatują z hali — eskortę i supercapital.' },
  builtin: { keys: ['4'], title: 'Broń wbudowana', text: '4 — Hexlance. Naciśnij, by naładować, i jeszcze raz, by odpalić wzdłuż dziobu. Wyceluj Atlasa w suchy dok — pręt przebija trzon i halę na wylot.' },
  fleet: { keys: [], title: 'Wsparcie', text: 'Posiłki z Ziemi walczą przy tobie. Rozkazy skrzydła (ESKORTA / ATAK) — zakładka Rezerwa w kokpicie.' },
  home: { keys: ['CapsLock', '9'], title: 'Powrót', text: 'Kurs na Ziemię wyznaczony. TRAVEL TO prowadzi podróż; ręcznie ustaw zielony kurs (±5°) i skocz: CapsLock albo 9. Warp wyjdzie przed studnią grawitacyjną, dalej leć napędem ku hali K-7 — dokowanie przejmie port.' }
});

// Kolejność faz (skoki dev: ?story=<faza> — pomija wcześniejsze, stawia świat jak po nich).
export const MISSION01_PHASES = Object.freeze(['intro', 'briefing', 'undock', 'course', 'scout', 'approach', 'ram', 'defences', 'shipyard', 'counter', 'victory', 'return', 'done']);

export async function mission01(ctx) {
  const api = ctx.api;
  const M = MISSION01;
  const tutorial = !!api.tutorial;
  const hint = (key, until) => (tutorial ? api.ui.hint(MISSION01_HINTS[key], until) : null);
  const from = Math.max(0, MISSION01_PHASES.indexOf(api.startPhase || 'intro'));
  const run = (phase) => MISSION01_PHASES.indexOf(phase) >= from;

  api.journal.begin(M, [
    'Odcumuj z hali K-7.',
    'Skocz na obrzeża układu.',
    'Rozpoznaj sygnaturę masy.',
    'Podejdź niewykryty i staranuj zaparkowane okręty.',
    'Zniszcz obronę i suchy dok stoczni.',
    'Odeprzyj odwet piratów.',
    'Wróć do K-7.'
  ]);

  // Porażka: Atlas zniszczony — przerwij misję (gra pokazuje własny ekran śmierci).
  const defeatWatch = ctx.spawn(async (sub) => {
    await sub.event('playerDestroyed');
    api.ui.objective(null);
    api.ui.hint(null);
    api.ui.clearTargets();
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
  // Skok „kawałek dalej” (site.warpIn, ~60 km przed rzędem) — za zasięgiem wzroku Atlasa: bez pewniaka.
  ctx.phase('course');
  const site = api.site.plan();
  api.site.spawn(site);
  if (run('course')) {
    api.nav.setCourse(site.warpIn.x, site.warpIn.y, 'Obrzeża układu');
    api.say(D.course, 'radio');
    api.ui.objective('warp', 'Skocz na obrzeża układu');
    hint('warp', () => api.nav.inWarp() || api.nav.distanceTo(site.warpIn) < 30000);
    await ctx.until(() => api.nav.distanceTo(site.warpIn) < 30000 && !api.nav.inWarp());
    api.nav.clearCourse();
  } else {
    // skok dev: do rozpoznania — punkt wyjścia z warpa; dalej — zbiórka (fazy niżej ustawiają resztę)
    const p = run('scout') ? site.warpIn : site.rally;
    api.dev.teleport(p.x, p.y, p.angle);
  }
  api.journal.step(1);

  // Wykrycie przez obronę stoczni (niezamaskowany Atlas za blisko) — od rozpoznania do taranu.
  let spotted = false;
  let alarmWatch = null;
  const watchAlarm = () => {
    if (alarmWatch) return;
    alarmWatch = ctx.spawn(async (sub) => {
      await sub.until(() => api.site.detected(site));
      spotted = true;
    });
  };

  // ---------------------------------------------------------------- 4. ROZPOZNANIE (mgła wojny)
  // Czujniki grawitacyjne widzą DUŻĄ MASĘ — miejsce niepewne (odchyłka), bez tożsamości. Rozpoznanie = budynek
  // albo okręt stoczni w zasięgu wzroku strony gracza (dron zwiadu, Atlas, sojusznik). Sygnatura gaśnie sama.
  ctx.phase('scout');
  // Podejście po cichu: wieże na auto milczą do alarmu (grupa w ręku strzela tylko na rozkaz gracza).
  api.fire.hold(true);
  const massId = 'm01-yard-mass';
  if (run('scout')) {
    const off = 4200;
    const massOffset = { x: Math.cos(site.axis + 2.1) * off, y: Math.sin(site.axis + 2.1) * off };
    const massAt = { x: site.building.x + massOffset.x, y: site.building.y + massOffset.y };
    api.fog.mass(massId, {
      x: site.building.x, y: site.building.y,
      offset: massOffset,
      spread: 13000,
      mass: 1.2e6 + site.parkedCount() * 9e4,
      label: 'Nieznana masa',
      entity: site.station
    });
    api.say(D.massContact, 'radio');
    watchAlarm();
    // Prowadzenie gracza (demo, prośba użytkownika 2026-10-05): kamera odjeżdża nad „nieznane” i czeka tam ze
    // znacznikiem z ikoną PPM — PPM na nim → DRON ZWIADU; po starcie drona (albo po 30 s) wraca do Atlasa.
    let droneSent = false;
    ctx.spawn(async (sub) => { await sub.event('droneLaunched'); droneSent = true; });
    api.ui.marker('mass', massAt, 'Nieznana masa', { action: { mouse: 'rmb', text: 'PPM → dron zwiadu' } });
    api.ui.objective('scout', 'Rozpoznaj sygnaturę masy — dron zwiadu (PPM) albo ostrożne podejście');
    hint('scout', () => spotted || api.site.scouted(site));
    await api.cinema.lookAt(massAt, {
      viewHeight: 30000, inSec: 1.8, holdSec: 30, outSec: 1.4,
      holdUntil: () => droneSent || spotted || api.site.scouted(site)
    });
    await ctx.until(() => spotted || api.site.scouted(site));
    api.ui.marker('mass', null);
    if (!spotted) api.say(D.identified, 'radio');
  }
  // sygnatura gaśnie sama po rozpoznaniu; skok dev / wykrycie — zdejmowana tu
  if (!api.fog.massResolved(massId)) api.fog.clearMass(massId);
  api.journal.step(2);

  // ---------------------------------------------------------------- 5. MASKOWANIE I PODEJŚCIE
  ctx.phase('approach');
  api.cloak.enable(true);
  api.fire.hold(true);
  if (run('approach')) {
    if (!spotted) api.say(D.arrival, 'radio');
    watchAlarm();
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

  // ---------------------------------------------------------------- 6. TARAN
  ctx.phase('ram');
  const ramGoal = Math.min(M.ramTarget, site.parkedCount());
  let ramWatch = null;
  if (run('ram')) {
    if (!spotted) api.say(D.ramOrder, 'radio');
    api.ui.marker('row', site.rowStart, 'Rząd okrętów');
    api.ui.objective('ram', 'Zniszcz zaparkowane okręty — taran (F) albo Hexlance wzdłuż rzędu (4)', () => `${Math.min(ramGoal, site.parkedKilled())} / ${ramGoal}`);
    hint('ram', () => site.parkedKilled() >= 1);
    // QOL (2026-10-05): każdy okręt z parkingu ma znacznik; zmiażdżony go traci, a ekran mówi, że taran zaliczony.
    const rammed = new Set();
    site.parkedList.forEach((e, i) => api.ui.target(`ram-${i}`, e, `D-${String(i + 1).padStart(2, '0')}`));
    ramWatch = ctx.spawn(async (sub) => {
      await sub.until(() => {
        site.parkedList.forEach((e, i) => {
          if (rammed.has(i) || !site.parkedCrushed(e)) return;
          rammed.add(i);
          api.ui.target(`ram-${i}`, null);
          const n = rammed.size;
          const how = site.parkedTouching(e) ? 'STARANOWANY' : 'PRZECIĘTY';
          api.ui.banner(n === ramGoal ? `${how} ${n} / ${ramGoal} — CEL OSIĄGNIĘTY` : `${how} ${n} / ${ramGoal}`, 2.4);
        });
        return false;
      });
    });
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
  ramWatch?.cancel();
  for (let i = 0; i < site.parkedList.length; i++) api.ui.target(`ram-${i}`, null);
  api.journal.step(3);

  // ---------------------------------------------------------------- 7. OBRONA STOCZNI
  ctx.phase('defences');
  if (run('defences')) {
    // Wrogowie z hali oznaczeni (2026-10-05: wieżyczek już nie ma; supercapital wylatuje pierwszy).
    let escortNo = 0;
    site.defenderList.forEach((e, i) => {
      const label = e.__storyFlagship ? 'Supercapital Iron Skull' : `Eskorta ${String(++escortNo).padStart(2, '0')}`;
      api.ui.target(`yard-def-${i}`, e, label);
    });
    api.ui.objective('defences', 'Zniszcz okręty obrony stoczni',
      () => `${site.defendersKilled()} / ${site.defenderCount()}`);
    hint('weapons', () => site.defendersKilled() >= 2);
    await ctx.until(() => {
      // zniszczony cel znika ze znaczników od razu
      site.defenderList.forEach((e, i) => { if (e.dead || e.hp <= 0) api.ui.target(`yard-def-${i}`, null); });
      return site.turretsAlive() === 0 && site.defendersAlive() === 0;
    });
    for (let i = 0; i < site.defenderList.length; i++) api.ui.target(`yard-def-${i}`, null);
    api.say(D.defencesDown, 'radio');
  } else {
    api.dev.kill([...site.turretList, ...site.defenderList]);
  }

  // ---------------------------------------------------------------- 8. BUDYNEK
  ctx.phase('shipyard');
  if (run('shipyard')) {
    api.ui.target('yard', site.station, 'Suchy dok piratów', { radius: site.buildingRadius, primary: true });
    api.ui.objective('yard', 'Zniszcz suchy dok bronią wbudowaną (4)', () => `${Math.round(site.buildingHpFrac() * 100)}%`);
    hint('builtin', () => site.buildingHpFrac() < 0.9 || site.buildingDestroyed());
  } else {
    api.dev.destroyStation(site.station);
  }
  await ctx.until(() => site.buildingDestroyed());
  api.ui.target('yard', null);
  api.ui.objective(null);
  await api.site.chainExplosion(site);
  api.say(D.shipyardDown, 'radio');
  api.journal.step(4);

  // ---------------------------------------------------------------- 9. ODWET
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
  api.journal.step(5);

  // ---------------------------------------------------------------- 10. ZWYCIĘSTWO
  ctx.phase('victory');
  api.ui.objective(null);
  const reward = api.rewards.grant(M.rewards);
  if (run('victory')) {
    api.say(D.victory, 'radio');
    await ctx.wait(3);
    allies?.returnHome();
    await api.ui.summary({ title: 'MISJA WYKONANA', subtitle: M.title, reward });
  }

  // ---------------------------------------------------------------- 11. POWRÓT
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
  api.journal.step(6);
  api.journal.complete();
  await api.cinema.release();
  api.dock.release();
  defeatWatch.cancel('complete');
  ctx.phase('done');
  return 'complete';
}
