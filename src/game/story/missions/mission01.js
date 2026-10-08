// ============================================================
// Misja 1 „Cicha stocznia” (prolog kampanii, zarazem samouczek) — 2026-09-30, przebudowa 2026-10-07.
//
// Dok K-7 (intro, odprawa) → odcumowanie → skok na obrzeża → ROZPOZNANIE przez mgłę wojny (czujniki
// grawitacyjne widzą tylko dużą masę — dron zwiadu albo ostrożne podejście) → maskowanie i podejście → taran
// parkingu suchego doku → ZEGAR WODOWANIA (2026-10-07: po alarmie załogi biegną do okrętów — okręty z parkingu
// startują po kolei bramami stanowisk, pancerniki z pochylni w hali bramą G-01; co nie wystartuje, nie walczy)
// razem z eskortą i SUPERCAPITALEM HERSZTA (66% — herszt przyspiesza starty, 33% — ucieka i ładuje skok; mostek
// = słaby punkt) → suchy dok bronią wbudowaną (4) → łańcuch wybuchów → podsumowanie w polu, nad gruzami.
// Dalej misja 2 „Odwet” (mission02.js) — kampania: src/game/story/campaign.js.
//
// Dialogi: src/data/story/mission01.dialogue.js (miejsce na fabułę). Podpowiedzi samouczka pokazują się tylko
// z włączonym samouczkiem (panel „Nowa gra”). `api` — klej z grą (src/game/story/storyGame.js).
// Skoki dev: ?story=<faza> (fazy kampanii) — wcześniejsze fazy pominięte, świat ustawiony jak po nich.
// ============================================================
import { MISSION01_DIALOGUE as D, MISSION01_TITLE } from '../../../data/story/mission01.dialogue.js';

export const MISSION01 = Object.freeze({
  id: 'm01_silent_shipyard',
  title: MISSION01_TITLE,
  banner: 'MISJA 1 UKOŃCZONA',
  description: 'Wejść po cichu do ukrytej stoczni piratów na obrzeżach układu, nie dopuścić do wodowania ich floty i zniszczyć zakład.',
  ramTarget: 3,            // taran „zaliczony” (baner) — ile kadłubów zmiażdżyć przy wejściu
  // Zegar wodowania (2026-10-07) [s od alarmu]: okręty z parkingu startują od końca parkingu (G-E) ku wjazdowi
  // (G-W, skąd taranuje Atlas) co `step`, pancerniki o `battleshipExtra` później; w połowie rozgrzewania
  // (`armAt`) załoga siada przy działach — okręt strzela ze stanowiska. Pochylnie w hali: `slips`. Pancernik na
  // pochylni jest niedokończony (`slipHp` punktów). Odliczanie w podpisie celu od `countdownFrom` s.
  launch: Object.freeze({ first: 40, step: 8, battleshipExtra: 20, armAt: 0.5, slips: Object.freeze([150, 200]), slipHp: 0.7, countdownFrom: 30, slipWarnAt: 35 }),
  // Supercapital herszta: przy `rushAt` punktów przyspiesza starty (pozostały czas × `rushScale`, nie mniej niż
  // `rushMin` s), przy `fleeAt` ucieka w stronę głębi obrzeży i ładuje skok `escapeSec` s (potem odlot warpem).
  boss: Object.freeze({ rushAt: 0.66, rushScale: 0.5, rushMin: 6, fleeAt: 0.33, escapeSec: 40, escapeDistance: 30000 }),
  // Suchy dok (2026-10-07: 16 000 + 4 000 → 36 000 + 4 000 — ~7 trafień Hexlance'a; finał misji, nie jeden klawisz).
  dock: Object.freeze({ hp: 36000, shield: 4000 }),
  rewards: Object.freeze({ exp: 900, credits: 40000, rep: Object.freeze({ terra_nova: 10, pirates: -12 }) }),
  // Premie: każdy okręt zatrzymany przed startem, herszt zniszczony albo bez dowodzenia (mostek).
  bonus: Object.freeze({ perStopped: Object.freeze({ exp: 40, credits: 1500 }), boss: Object.freeze({ exp: 300, credits: 10000 }) })
});

export const MISSION01_HINTS = Object.freeze({
  undock: { keys: ['LPM', 'Enter'], title: 'Odcumowanie', text: 'Atlas jest przypięty do stanowiska — paliwo, zasilanie, mocowania. Kliknij ODDOKUJ (albo Enter): obsługa odłączy przewody i zwolni mocowania, potem stery są twoje.' },
  flight: { keys: ['W', 'S', 'A', 'D', 'Q', 'E'], title: 'Sterowanie', text: 'Atlas stoi dziobem do bramy. W / S — ciąg przód i wstecz, A / D — obrót, Q / E — ruch na boki. Wyprowadź Atlasa naprzód przez bramę G-01.' },
  scout: { keys: ['PPM', 'M'], title: 'Mgła wojny', text: 'Widzisz tylko to, co jest w zasięgu wzroku Atlasa i twojej floty — dalej jest mgła. Czujniki grawitacyjne pokazują dużą masę, ale nie mówią, czym jest. Rozpoznaj ją: PPM w pustej przestrzeni → DRON ZWIADU (leci w punkt i odsłania mgłę wokół siebie; także mapa CIC, M) albo podejdź ostrożnie — niezamaskowanego Atlasa obrona wykryje z ~9 km.' },
  warp: { keys: ['CapsLock', '9', 'A', 'D', 'Shift'], title: 'Skok warp', text: 'Kurs jest wyznaczony; TRAVEL TO może wykonać podróż sam. Jeśli przejmiesz stery, A / D obróć dziób według wskaźnika WARP. Zielony kurs (±5°): naciśnij CapsLock (albo 9) — komputer doprecyzuje kierunek i sam wyjdzie przy punkcie kursu. Poza zielonym pasmem wyjście jest ręczne (CapsLock / 9 jeszcze raz). Shift to dopalacz.' },
  cloak: { keys: ['I'], title: 'Maskowanie', text: 'I — maskowanie. Czujniki i działa piratów cię nie widzą. Pęka przy strzale, taranie i trafieniu; energia wystarcza na minutę.' },
  sneak: { keys: [], title: 'Podejście', text: 'Nie strzelaj. Leć prosto w początek rzędu zaparkowanych okrętów — znacznik na ekranie.' },
  ram: { keys: ['F', '4'], title: 'Szarża albo broń wbudowana', text: 'Okręty stoją w jednym rzędzie — ustaw dziób wzdłuż niego. F — szarża: kilka sekund pełnej mocy kosztem całego ładunku reaktora; rozpędzony Atlas miażdży kadłuby po kolei. Albo 4 — Hexlance (BUILT-IN): naładuj i odpal wzdłuż dziobu — pręt przebija rząd na wylot i tnie wszystkie okręty na swojej drodze. Jedno i drugie zdejmuje maskowanie.' },
  launch: { keys: ['F', '4', 'LPM'], title: 'Zegar wodowania', text: 'Załogi biegną do okrętów. Każdy okręt z parkingu wystartuje, gdy rozgrzeje reaktor (odliczanie przy znaczniku i w celu misji) — w połowie siada przy działach i strzela ze stanowiska. Co zniszczysz przed startem, nie będzie z tobą walczyć. Szarża F ładuje się ~30 s — zawróć i taranuj jeszcze raz. Pancerniki na pochylniach stoją w hali pod dachem: Hexlance (4) przebija dach.' },
  weapons: { keys: ['LPM', 'T', '1', '2', '3'], title: 'Broń', text: 'Działa burtowe strzelają same do wszystkiego w zasięgu. LPM — salwa baterii głównej w kursor (komputer wyprzedza cel przy kursorze), T — cel priorytetowy dla całego okrętu (trzymaj T i przeciągnij kursor po wrogach — kilka naraz; rakiety same biorą to, co strzela do ciebie), 1–3 — która grupa jest w ręku. Zniszcz okręty, które wylatują z hali — eskortę i supercapital.' },
  bridge: { keys: ['LPM', '2'], title: 'Słaby punkt', text: 'MOSTEK supercapitala jest oznaczony. Zniszczony mostek = okręt bez dowodzenia: dryfuje i nie walczy. Bateria główna w ręku (2) i salwy LPM prosto w mostek — gdy pole tarczy zgaśnie albo pęknie.' },
  builtin: { keys: ['4'], title: 'Broń wbudowana', text: '4 — Hexlance. Naciśnij, by naładować, i jeszcze raz, by odpalić wzdłuż dziobu. Wyceluj Atlasa w suchy dok — pręt przebija trzon i halę na wylot.' }
});

// Fazy misji 1 w kolejności (część kampanii — src/game/story/campaign.js).
export const MISSION01_PHASES = Object.freeze(['intro', 'briefing', 'undock', 'course', 'scout', 'approach', 'ram', 'defences', 'shipyard', 'aftermath']);

const clockText = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export async function mission01(ctx) {
  const api = ctx.api;
  const M = MISSION01;
  const tutorial = !!api.tutorial;
  const hint = (key, until) => (tutorial ? api.ui.hint(MISSION01_HINTS[key], until) : null);
  const from = Math.max(0, api.phaseIndex(api.startPhase || 'intro'));
  const run = (phase) => api.phaseIndex(phase) >= from;

  api.journal.begin(M, [
    'Odcumuj z hali K-7.',
    'Skocz na obrzeża układu.',
    'Rozpoznaj sygnaturę masy.',
    'Podejdź niewykryty i uderz w parking.',
    'Nie dopuść do wodowania floty piratów.',
    'Zatrzymaj supercapital herszta.',
    'Zniszcz suchy dok.'
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

    // Odcumowanie na rozkaz gracza (2026-10-07): HUD i stery wracają, Atlas stoi przypięty do stanowiska, dopóki
    // gracz nie kliknie ODDOKUJ; obsługa odłącza się po kolei (upust z przewodów paliwowych), potem wylot sam.
    ctx.phase('undock');
    await api.cinema.release();
    const berthId = api.dock.berthId();
    api.ui.objective('undock', `Odcumuj Atlasa ze stanowiska ${berthId}`, () => api.dock.step());
    hint('undock', () => !api.dock.locked());
    await api.ui.action({
      id: 'undock', title: `STANOWISKO ${berthId} · K-7`, subtitle: 'OBSŁUGA PODŁĄCZONA',
      label: 'ODDOKUJ', busyLabel: 'ODCUMOWANIE…', key: 'Enter', rows: () => api.dock.serviceRows()
    });
    await api.dock.undock();
    api.say(D.undock, 'radio');
    ctx.spawn(async (sub) => { await sub.wait(1.6); api.ui.action(null); });
    api.ui.objective('undock', 'Wyprowadź Atlasa z hali K-7 przez bramę G-01');
    hint('flight', () => api.dock.isOutside());
    await ctx.until(() => api.dock.isOutside());
    api.ui.action(null);
  } else if (api.phaseIndex(api.startPhase) <= api.phaseIndex('course')) {
    const p = api.dock.approachPoint();
    api.dev.teleport(p.x, p.y);
  }
  api.journal.step(0);

  // ---------------------------------------------------------------- 3. KURS I SKOK
  // Skok „kawałek dalej” (site.warpIn, ~60 km przed rzędem) — za zasięgiem wzroku Atlasa: bez pewniaka.
  ctx.phase('course');
  const site = api.site.plan();
  api.site.spawn(site, { dockHp: M.dock.hp, dockShield: M.dock.shield, slipHp: M.launch.slipHp });
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

  // ---------------------------------------------------------------- 6. TARAN (do alarmu)
  ctx.phase('ram');
  const ramGoal = Math.min(M.ramTarget, site.parkedCount());
  const berthLabel = (e) => `D-${String((e.__dockBerth ?? 0) + 1).padStart(2, '0')}`;
  if (run('ram')) {
    if (!spotted) api.say(D.ramOrder, 'radio');
    api.ui.marker('row', site.rowStart, 'Rząd okrętów');
    api.ui.objective('ram', 'Uderz w parking — taran (F) albo Hexlance wzdłuż rzędu (4)');
    hint('ram', () => site.parkedKilled() >= 1);
    // QOL (2026-10-05): każdy okręt z parkingu ma znacznik; zniszczony go traci (zegar wodowania niżej).
    site.parkedList.forEach((e, i) => api.ui.target(`ram-${i}`, e, berthLabel(e), { group: 'Parking' }));
    // Alarm: pierwsze zderzenie z rzędem, zniszczony kadłub albo wykrycie.
    await ctx.until(() => spotted || site.rammed() || site.parkedKilled() > 0);
    alarmWatch?.cancel();
    api.site.alarm(site);
    api.fire.hold(false);
    api.say(spotted && !site.rammed() ? D.spotted : D.alarm, 'radio');
  } else {
    alarmWatch?.cancel();
    if (run('defences')) api.dev.kill(site.parkedList.slice(0, ramGoal));
    api.site.alarm(site);
    api.fire.hold(false);
  }
  api.ui.marker('row', null);
  api.journal.step(3);

  // Łańcuch rozpadu doku — kiedykolwiek dok padnie (także w środku bitwy, gdy gracz uderzy w niego wcześniej):
  // ginie wszystko, co jeszcze stoi w stanowiskach, na pochylniach i w hali.
  let chainDone = false;
  ctx.spawn(async (sub) => {
    await sub.until(() => site.buildingDestroyed());
    api.ui.target('yard', null);
    await api.site.chainExplosion(site);
    api.say(D.shipyardDown, 'radio');
    api.journal.step(6);
    chainDone = true;
  });

  // ---------------------------------------------------------------- 7. BITWA W STOCZNI: ZEGAR WODOWANIA + HERSZT
  ctx.phase('defences');
  const L = M.launch;
  const B = M.boss;
  const gone = (e) => api.fleet.gone(e);
  const boss = site.flagship || null;
  const escorts = site.defenderList.filter((e) => e !== boss);
  // Zegar wodowania: rekord na okręt w stanowisku i na pochylni.
  //   state: 'parked' → 'armed' (strzela ze stanowiska) → 'launched' (wystartował — wróg w polu) → 'done'
  const yard = [];
  let stoppedN = 0;
  let launchedN = 0;
  let bossResult = boss ? null : 'none';   // 'killed' | 'hulk' | 'escaped' | 'none'
  let fleeing = false;
  let fleeT0 = 0;
  if (run('defences')) {
    const T0 = ctx.time;
    // Parking od końca (G-E) ku wjazdowi (G-W — tam wchodzi Atlas). Okręty zmiażdżone przed alarmem też są
    // w zegarze — pierwszy krok liczy je jako zatrzymane (baner, premia).
    const order = site.parkedList.slice().sort((a, b) => (b.__dockBerth ?? 0) - (a.__dockBerth ?? 0));
    let rank = 0;
    for (const e of order) {
      const down = gone(e) || site.parkedCrushed(e);
      const bs = /battleship/.test(String(e.__storyKey || e.type || ''));
      const launchAt = T0 + L.first + L.step * rank + (bs ? L.battleshipExtra : 0);
      if (!down) rank++;
      yard.push({ e, kind: 'parked', id: `ram-${site.parkedList.indexOf(e)}`, label: berthLabel(e), group: 'Parking',
        launchAt, armAt: T0 + (launchAt - T0) * L.armAt, state: 'parked', shown: '' });
    }
    site.slipList.forEach((e, i) => {
      const launchAt = T0 + (L.slips[i] ?? L.slips[L.slips.length - 1]);
      yard.push({ e, kind: 'slip', id: `slip-${i}`, label: `Pochylnia H-P${(e.__slip ?? i) + 1}`, group: 'Pochylnie',
        launchAt, armAt: Infinity, state: 'parked', shown: '' });
    });
    for (const r of yard) { r.shown = r.label; api.ui.target(r.id, r.e, r.label, { group: r.group }); }
    let escortNo = 0;
    site.defenderList.forEach((e, i) => {
      // Eskorta w szyku — jeden podpis grupy; supercapital zawsze z własnym.
      const label = e === boss ? 'Supercapital Iron Skull' : `Eskorta ${String(++escortNo).padStart(2, '0')}`;
      api.ui.target(`yard-def-${i}`, e, label, e === boss ? {} : { group: 'Eskorta' });
    });
    ctx.spawn(async (sub) => { await sub.wait(3); api.say(D.crews, 'radio'); });

    // --- krok zegara (co tick gry)
    let firstParked = true;
    let firstSlip = true;
    let slipWarned = false;
    let lastLabels = -1;
    let objectiveId = null;
    const inBerth = () => yard.filter((r) => r.state === 'parked' || r.state === 'armed');
    const nextLaunch = () => { let t = Infinity; for (const r of yard) if (r.state === 'parked' || r.state === 'armed') t = Math.min(t, r.launchAt); return t; };
    const enemiesLeft = () => yard.filter((r) => r.state === 'launched').length + escorts.filter((e) => !gone(e)).length + (boss && !gone(boss) ? 1 : 0);
    const setObjective = (id) => {
      if (id === objectiveId) return;
      objectiveId = id;
      if (id === 'boss-flee') {
        api.ui.objective(id, 'Zatrzymaj supercapital herszta — ładuje skok', () => `skok ${Math.min(100, Math.round(((ctx.time - fleeT0) / B.escapeSec) * 100))}%`);
      } else if (id === 'launch') {
        api.ui.objective(id, 'Nie dopuść do startu — zniszcz okręty na parkingu i pochylniach', () => {
          const t = nextLaunch() - ctx.time;
          return `${stoppedN} / ${yard.length}` + (Number.isFinite(t) ? ` · start za ${clockText(t)}` : '');
        });
      } else {
        api.ui.objective(id, 'Zniszcz okręty piratów w stoczni', () => `zostało ${enemiesLeft()}`);
      }
    };
    const stepYard = () => {
      const now = ctx.time;
      for (const r of yard) {
        const e = r.e;
        if (r.state === 'done') continue;
        if (r.state === 'launched') {
          if (gone(e)) { r.state = 'done'; api.ui.target(r.id, null); }
          continue;
        }
        // zatrzymany przed startem: zniszczony albo zmiażdżony (taran zostawia resztkę punktów)
        if (gone(e) || (r.kind === 'parked' && site.parkedCrushed(e))) {
          r.state = 'done';
          stoppedN++;
          api.ui.target(r.id, null);
          const how = r.kind === 'parked' && site.parkedTouching(e) ? 'STARANOWANY' : 'ZNISZCZONY';
          api.ui.banner(`${how} ${r.label} · ${stoppedN} / ${yard.length}`, 2.4);
          continue;
        }
        if (now >= r.launchAt) {
          r.state = 'launched';
          launchedN++;
          api.site.launch(site, e);
          r.shown = r.label;
          api.ui.target(r.id, e, r.label, { group: 'Wystartowały' });
          api.ui.banner(r.kind === 'slip' ? `WODOWANIE · ${r.label}` : `${r.label} STARTUJE`, 2.4);
          if (r.kind === 'slip' && firstSlip) { firstSlip = false; api.say(D.slipLaunch, 'radio'); }
          if (r.kind === 'parked' && firstParked) { firstParked = false; api.say(D.firstLaunch, 'radio'); }
          continue;
        }
        if (r.state === 'parked' && now >= r.armAt) { r.state = 'armed'; api.site.arm(e); }
        if (r.kind === 'slip' && !slipWarned && r.launchAt - now <= L.slipWarnAt) { slipWarned = true; api.say(D.slipWarn, 'radio'); }
      }
      // podpisy z odliczaniem (co 0,5 s)
      if (now - lastLabels >= 0.5 || lastLabels < 0) {
        lastLabels = now;
        for (const r of yard) {
          if (r.state !== 'parked' && r.state !== 'armed') continue;
          const left = r.launchAt - now;
          const label = left <= L.countdownFrom ? `${r.label} · ${clockText(left)}` : r.label;
          if (label !== r.shown) { r.shown = label; api.ui.target(r.id, r.e, label, { group: r.group }); }
        }
      }
      site.defenderList.forEach((e, i) => { if (gone(e)) api.ui.target(`yard-def-${i}`, null); });
      setObjective(fleeing ? 'boss-flee' : inBerth().length ? 'launch' : 'fight');
      return false;
    };
    const yardThread = ctx.spawn(async (sub) => { await sub.until(stepYard); });

    // --- herszt: przyspieszenie startów, ucieczka ze skokiem, mostek jako słaby punkt
    const bossThread = ctx.spawn(async (sub) => {
      if (!boss) return;
      const bp = { x: 0, y: 0 };
      let lastMark = -1;
      const markBridge = () => {
        if (gone(boss) || ctx.time - lastMark < 0.1) return;
        lastMark = ctx.time;
        const p = api.fleet.bridgePoint(boss, bp);
        if (p && Number.isFinite(p.x)) api.ui.marker('bridge', p, 'MOSTEK', { journal: false });
      };
      const mark = sub.spawn(async (m) => { await m.until(() => { markBridge(); return gone(boss); }); });
      await sub.until(() => gone(boss) || api.fleet.hpFrac(boss) <= B.rushAt);
      if (!gone(boss)) {
        api.say(D.bossRush, 'radio');
        const now = ctx.time;
        for (const r of yard) {
          if (r.state !== 'parked' && r.state !== 'armed') continue;
          r.launchAt = now + Math.max(B.rushMin, (r.launchAt - now) * B.rushScale);
          r.armAt = Math.min(r.armAt, now);
        }
      }
      await sub.until(() => gone(boss) || api.fleet.hpFrac(boss) <= B.fleeAt);
      if (!gone(boss)) {
        const bx = boss.pos ? boss.pos.x : boss.x;
        const by = boss.pos ? boss.pos.y : boss.y;
        const a = Math.atan2(site.origin.y - by, site.origin.x - bx);
        api.fleet.flee(boss, { x: bx + Math.cos(a) * B.escapeDistance, y: by + Math.sin(a) * B.escapeDistance });
        fleeing = true;
        fleeT0 = ctx.time;
        api.say(D.bossFlee, 'radio');
        api.ui.banner('SUPERCAPITAL ŁADUJE SKOK', 2.4);
        await sub.until(() => gone(boss) || ctx.time - fleeT0 >= B.escapeSec);
        // skok: obrót, ładowanie tunelu, zniknięcie (do zanurzenia w szczelinę dalej da się go zatrzymać)
        if (!gone(boss)) {
          api.fleet.warpOut([boss], site.origin);
          await sub.until(() => gone(boss));
        }
      }
      fleeing = false;
      mark.cancel();
      api.ui.marker('bridge', null);
      bossResult = boss.warpedOut ? 'escaped' : api.fleet.isHulk(boss) ? 'hulk' : 'killed';
      api.ui.banner(bossResult === 'escaped' ? 'SUPERCAPITAL UCIEKŁ' : bossResult === 'hulk' ? 'SUPERCAPITAL BEZ DOWODZENIA' : 'SUPERCAPITAL ZNISZCZONY', 3);
      api.say(bossResult === 'escaped' ? D.bossEscaped : bossResult === 'hulk' ? D.bossHulk : D.bossKilled, 'radio');
      api.journal.step(5);
    });

    // --- podpowiedzi samouczka po kolei
    ctx.spawn(async (sub) => {
      if (!tutorial) return;
      // karta zegara wisi do pierwszego startu (taran zwykle zalicza kilka kadłubów już przy alarmie)
      const c1 = () => launchedN >= 1 || stoppedN >= 6 || !inBerth().length;
      hint('launch', c1);
      await sub.until(c1, { timeout: 45 });
      const c2 = () => escorts.filter(gone).length >= 2 || !escorts.some((e) => !gone(e));
      hint('weapons', c2);
      await sub.until(c2, { timeout: 30 });
      if (boss && !gone(boss)) {
        const c3 = () => gone(boss) || api.fleet.hpFrac(boss) < 0.5;
        hint('bridge', c3);
        await sub.until(c3, { timeout: 45 });
      }
    });

    await ctx.until(() => yard.every((r) => r.state === 'done') && escorts.every(gone) && bossResult !== null);
    yardThread.cancel();
    await bossThread.done;
    for (const r of yard) api.ui.target(r.id, null);
    for (let i = 0; i < site.defenderList.length; i++) api.ui.target(`yard-def-${i}`, null);
    api.ui.objective(null);
    if (!site.buildingDestroyed()) api.say(D.defencesDown, 'radio');
  } else {
    // skok dev za bitwę: parking, pochylnie, eskorta i herszt pokonani
    api.dev.kill([...site.parkedList, ...site.slipList, ...site.turretList, ...site.defenderList]);
    if (boss) bossResult = 'killed';
  }
  for (let i = 0; i < site.parkedList.length; i++) api.ui.target(`ram-${i}`, null);
  api.journal.step(4);
  api.journal.step(5);

  // ---------------------------------------------------------------- 8. SUCHY DOK
  ctx.phase('shipyard');
  if (run('shipyard')) {
    if (!site.buildingDestroyed()) {
      api.ui.target('yard', site.station, 'Suchy dok piratów', { radius: site.buildingRadius, primary: true });
      api.ui.objective('yard', 'Zniszcz suchy dok bronią wbudowaną (4)', () => `${Math.round(site.buildingHpFrac() * 100)}%`);
      hint('builtin', () => site.buildingHpFrac() < 0.9 || site.buildingDestroyed());
    }
  } else {
    api.dev.destroyStation(site.station);
  }
  await ctx.until(() => chainDone);
  api.ui.target('yard', null);
  api.ui.objective(null);

  // ---------------------------------------------------------------- 9. PODSUMOWANIE W POLU
  ctx.phase('aftermath');
  const bossDown = bossResult === 'killed' || bossResult === 'hulk';
  const P = M.bonus;
  const reward = api.rewards.grant({
    exp: M.rewards.exp + stoppedN * P.perStopped.exp + (bossDown ? P.boss.exp : 0),
    credits: M.rewards.credits + stoppedN * P.perStopped.credits + (bossDown ? P.boss.credits : 0),
    rep: M.rewards.rep
  });
  const campaign = api.campaign;
  campaign.m1 = { stopped: stoppedN, launched: launchedN, total: yard.length, boss: bossResult };
  campaign.bossEscaped = bossResult === 'escaped';
  if (run('aftermath')) {
    api.say(D.yardVictory, 'radio');
    await ctx.wait(3);
    const bossText = { killed: 'zniszczony', hulk: 'bez dowodzenia', escaped: 'uciekł', none: '—' }[bossResult] || '—';
    await api.ui.summary({
      title: 'MISJA WYKONANA', subtitle: M.title, reward,
      stats: [
        ['Zatrzymane przed startem', `${stoppedN} / ${yard.length}`],
        ['Supercapital herszta', bossText, bossResult === 'escaped' ? 'neg' : bossDown ? 'pos' : '']
      ]
    });
  }
  api.journal.complete();
  defeatWatch.cancel('complete');
  return 'complete';
}
