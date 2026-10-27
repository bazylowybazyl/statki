// ============================================================
// Misja 1 „Cicha baza” (prolog kampanii, zarazem samouczek) — 2026-09-30, przebudowa 2026-10-07, BAZA PIRATÓW
// zamiast suchego doku 2026-10-11 (szkic użytkownika: habitat, pomosty z okrętami, zbiorniki paliwa, magazyn).
//
// Dok K-7 (intro, odprawa) → odcumowanie → skok na obrzeża → ROZPOZNANIE przez mgłę wojny (czujniki
// grawitacyjne widzą tylko dużą masę) FREGATĄ ZWIADU z ładowni Atlasa: oblot bazy, skan, oznaczanie celów (bez
// fregaty — dron zwiadu albo ostrożne podejście) → maskowanie i podejście lejkiem
// ramion Y → TARAN rzędu okrętów przy ramieniu A → alarm: DRONY z hangarów habitatu (gracz odpala swoje — Z),
// ZEGAR STARTÓW (kilkanaście okrętów z załogą odchodzi od pomostów po kolei, w połowie rozgrzewania strzela ze
// stanowiska; reszta stoi w remoncie, bez załogi) i SUPERCAPITAL HERSZTA z zatoki przy zbiornikach (66% — przyspiesza
// starty, 33% — ucieka i ładuje skok; mostek = słaby punkt) → HABITAT (finał: bęben pęka, dysk mieszkalny i część
// techniczna implodują, ogień idzie rurami) → podsumowanie w polu. Bez podpowiedzi: ZBIORNIKI PALIWA (P) wysadzone
// w dowolnej chwili zapalają rurociąg — reakcja łańcuchowa niszczy okręty w stanowiskach (decyzja użytkownika).
// Dalej misja 2 „Odwet” (mission02.js) — kampania: src/game/story/campaign.js.
//
// Dialogi: src/data/story/mission01.dialogue.js (miejsce na fabułę). Podpowiedzi samouczka pokazują się tylko
// z włączonym samouczkiem (panel „Nowa gra”). `api` — klej z grą (src/game/story/storyGame.js).
// Skoki dev: ?story=<faza> (fazy kampanii) — wcześniejsze fazy pominięte, świat ustawiony jak po nich.
// ============================================================
import { MISSION01_DIALOGUE as D, MISSION01_TITLE } from '../../../data/story/mission01.dialogue.js';
import { engineIgnitionDuration } from '../../engineIgnition.js';

export const MISSION01 = Object.freeze({
  id: 'm01_silent_shipyard',
  title: MISSION01_TITLE,
  banner: 'MISJA 1 UKOŃCZONA',
  description: 'Wejść po cichu do ukrytej bazy piratów na obrzeżach układu, nie dopuścić do startu ich floty i zniszczyć habitat.',
  ramTarget: 3,            // taran „zaliczony” (baner) — ile kadłubów zmiażdżyć przy wejściu
  // Zegar startów (2026-10-07, baza 2026-10-11) [s od alarmu]: okręty z załogą startują od najdalszych (zbiorniki,
  // magazyn) ku wylotowi lejka (skąd wchodzi Atlas) co `step`; w połowie rozgrzewania (`armAt`) załoga siada przy
  // działach — okręt strzela ze stanowiska. Odliczanie w podpisie celu od `countdownFrom` s.
  launch: Object.freeze({ first: 40, step: 9, armAt: 0.5, countdownFrom: 30 }),
  // Supercapital herszta: przy `rushAt` punktów przyspiesza starty (pozostały czas × `rushScale`, nie mniej niż
  // `rushMin` s), przy `fleeAt` ucieka w stronę głębi obrzeży i ładuje skok `escapeSec` s (potem odlot warpem).
  boss: Object.freeze({ rushAt: 0.66, rushScale: 0.5, rushMin: 6, fleeAt: 0.33, escapeSec: 40, escapeDistance: 30000 }),
  // Habitat (finał misji; pole `dock` — zgodność z api.site.spawn): ~7 trafień Hexlance'a.
  dock: Object.freeze({ hp: 36000, shield: 4000 }),
  rewards: Object.freeze({ exp: 900, credits: 40000, rep: Object.freeze({ terra_nova: 10, pirates: -12 }) }),
  // Premie: okręt zatrzymany przed startem, herszt zniszczony albo bez dowodzenia (mostek), okręt zniszczony reakcją
  // łańcuchową, magazyn.
  bonus: Object.freeze({
    perStopped: Object.freeze({ exp: 40, credits: 1500 }),
    boss: Object.freeze({ exp: 300, credits: 10000 }),
    perChain: Object.freeze({ exp: 15, credits: 600 }),
    warehouse: Object.freeze({ exp: 120, credits: 8000 })
  })
});

export const MISSION01_HINTS = Object.freeze({
  undock: { keys: ['F'], title: 'Odcumowanie', text: 'Atlas jest przypięty do stanowiska. F — ODDOKOWANIE (albo klik): obsługa odłączy przewody i zwolni mocowania, potem stery są twoje.' },
  flight: { keys: ['W', 'S', 'A', 'D', 'Q', 'E'], title: 'Sterowanie', text: 'Atlas stoi dziobem do bramy, silniki główne są zimne. W — zapłon i ciąg naprzód (najpierw dym z dysz, potem płomień), S — wstecz, A / D — obrót, Q / E — ruch na boki. Wyprowadź Atlasa naprzód przez bramę G-01.' },
  scoutBay: { keys: ['H'], title: 'Fregata zwiadu', text: 'Widzisz tylko to, co jest w zasięgu wzroku Atlasa i twojej floty — dalej jest mgła; czujniki grawitacyjne pokazują dużą masę, ale nie mówią, czym jest. W ładowni Atlasa czeka fregata zwiadu: H — wrota się otwierają, fregata wylatuje, a ty przejmujesz jej stery i kamerę (Atlas stoi w miejscu). Jej wzrok sięga 10 km. Niezamaskowanego Atlasa obrona zobaczy z ~9 km — podleć nim najwyżej do skraju mgły.' },
  scoutFly: { keys: ['W', 'S', 'A', 'D', 'I', 'X', '3', '4', 'T', 'H'], title: 'Zwiad', text: 'W / S — prędkość, A / D — skręt, Q / E — w bok. I — maskowanie fregaty (obrona jej nie widzi; pęka przy trafieniu i taranie). 3 — OKO: sonda odsłania mgłę w kole pod kursorem (do 22 km od fregaty, z baterii). 4 — DALEKI SKAN w stronę kursora: klin do 70 km zostawia echa — przybliżone położenie, klasę masy i liczbę obiektów. X — skan: fala oznacza wrogie kontakty w 10 km od fregaty. T nad kontaktem — oznacz go (trzymaj T i przeciągnij kursor — kilka naraz). Obleć bazę dookoła — to, co leży za habitatem, widać dopiero z drugiej strony. Bez maskowania obrona wykryje fregatę bliżej niż ~3 km od bazy. H — fregata sama wraca do ładowni.' },
  scout: { keys: ['PPM', 'M'], title: 'Mgła wojny', text: 'Widzisz tylko to, co jest w zasięgu wzroku Atlasa i twojej floty — dalej jest mgła. Czujniki grawitacyjne pokazują dużą masę, ale nie mówią, czym jest. Rozpoznaj ją: PPM w pustej przestrzeni → DRON ZWIADU (leci w punkt i odsłania mgłę wokół siebie; także mapa CIC, M) albo podejdź ostrożnie — niezamaskowanego Atlasa obrona wykryje z ~9 km.' },
  warp: { keys: ['CapsLock', '9', 'A', 'D', 'Shift'], title: 'Skok warp', text: 'Kurs jest wyznaczony; TRAVEL TO może wykonać podróż sam. W studni grawitacji Ziemi skok nie ruszy — najpierw odleć za jej brzeg (TRAVEL TO wyprowadzi okręt sam). Jeśli przejmiesz stery, A / D obróć dziób według wskaźnika WARP. Dziób do 20° od kursu (zielone pasmo to ±5°): naciśnij CapsLock (albo 9) — komputer obróci dziób na kurs i sam wyjdzie przy punkcie kursu. Dalej od kursu skok idzie do celu przed dziobem albo awaryjnie 400 km w dziób. CapsLock / 9 w skoku — wyjście od razu. Shift to dopalacz.' },
  cloak: { keys: ['I'], title: 'Maskowanie', text: 'I — maskowanie. Czujniki i działa piratów cię nie widzą. Pęka przy strzale, taranie i trafieniu; energia wystarcza na minutę.' },
  sneak: { keys: [], title: 'Podejście', text: 'Nie strzelaj. Wleć w lejek między ramionami bazy i ustaw się na początku rzędu okrętów przy lewym ramieniu — znacznik na ekranie.' },
  ram: { keys: ['F', '4'], title: 'Szarża albo broń wbudowana', text: 'Okręty stoją w rzędzie prostopadle do pomostu — leć wzdłuż ramienia, w połowie ich długości. F — szarża: kilka sekund pełnej mocy kosztem całego ładunku reaktora; rozpędzony Atlas miażdży kadłuby po kolei. Albo 4 — Hexlance (BUILT-IN): naładuj i odpal wzdłuż dziobu — pręt przebija rząd na wylot. Jedno i drugie zdejmuje maskowanie.' },
  launch: { keys: ['F', '4', 'LPM'], title: 'Zegar startów', text: 'Załogi biegną do okrętów. Okręt z załogą odejdzie od pomostu, gdy rozgrzeje reaktor (odliczanie przy znaczniku i w celu misji) — w połowie siada przy działach i strzela ze stanowiska. Co zniszczysz przed startem, nie będzie z tobą walczyć. Okręty bez znacznika stoją w remoncie — bez załogi. Szarża F ładuje się ~30 s.' },
  drones: { keys: ['Z'], title: 'Drony piratów', text: 'Z habitatu wystartowały drony. Z — wypuść myśliwce z hangarów Atlasa: same wybierają drony i okręty wroga; drugie Z — atak, trzecie — powrót. Obrona punktowa (CIWS) też je zestrzeliwuje.' },
  weapons: { keys: ['LPM', 'T', '1', '2', '3'], title: 'Broń', text: 'Działa burtowe strzelają same do wszystkiego w zasięgu. LPM — salwa baterii głównej w kursor (komputer wyprzedza cel przy kursorze), T — cel priorytetowy dla całego okrętu (trzymaj T i przeciągnij kursor po wrogach — kilka naraz; rakiety same biorą to, co strzela do ciebie), 1–3 — która grupa jest w ręku.' },
  bridge: { keys: ['LPM', '2'], title: 'Słaby punkt', text: 'MOSTEK supercapitala jest oznaczony. Zniszczony mostek = okręt bez dowodzenia: dryfuje i nie walczy. Bateria główna w ręku (2) i salwy LPM prosto w mostek — gdy pole tarczy zgaśnie albo pęknie.' },
  builtin: { keys: ['4', 'F'], title: 'Habitat', text: 'Habitat to otwarty bęben — ściana, grodzie i szyb. 4 — Hexlance przebija go na wylot; szarża F wgniata ścianę. Zniszczony bęben pociągnie za sobą dysk mieszkalny pod spodem.' }
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
    'Rozpoznaj bazę — fregata zwiadu z ładowni.',
    'Podejdź niewykryty i uderz w rząd okrętów.',
    'Nie dopuść do startu załóg piratów.',
    'Zatrzymaj supercapital herszta.',
    'Zniszcz habitat bazy.'
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
    // gracz nie naciśnie F — ODDOKOWANIE; obsługa odłącza się po kolei (upust z przewodów paliwowych), potem wylot sam.
    // Silniki główne zostają zimne do pierwszego W (zapłon: dym, potem płomień). Poprawki użytkownika 2026-10-14:
    // klawisz F (dawniej Enter, chwilę E), sam przycisk ODDOKOWANIE — bez panelu stanowiska (wiersze obsługi: paliwo,
    // złącza, przewody, mocowania, napęd) i bez przycisku WYPOSAŻENIE (`api.dock.openFitting` zostaje).
    ctx.phase('undock');
    await api.cinema.release();
    const berthId = api.dock.berthId();
    api.ui.objective('undock', `Odcumuj Atlasa ze stanowiska ${berthId} (F)`, () => api.dock.step());
    hint('undock', () => !api.dock.locked());
    await api.ui.action({ id: 'undock', label: 'ODDOKOWANIE', busyLabel: 'ODDOKOWANIE…', key: 'F' });
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
  // Skok „kawałek dalej” (site.warpIn, ~60 km przed wylotem lejka) — za zasięgiem wzroku Atlasa: bez pewniaka.
  ctx.phase('course');
  const site = api.site.plan();
  api.site.spawn(site, { dockHp: M.dock.hp, dockShield: M.dock.shield });
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

  // Wykrycie przez obronę bazy (niezamaskowany Atlas za blisko) — od rozpoznania do taranu.
  let spotted = false;
  let alarmWatch = null;
  const watchAlarm = () => {
    if (alarmWatch) return;
    alarmWatch = ctx.spawn(async (sub) => {
      await sub.until(() => api.site.detected(site));
      spotted = true;
    });
  };

  // ---------------------------------------------------------------- 4. ROZPOZNANIE (mgła wojny, fregata zwiadu)
  // Fregata zwiadu w ładowni Atlasa (2026-10-11, src/game/scoutBay.js — prośba użytkownika: „w ładowni fregata
  // zwiadowcza, którą obleci sobie dookoła bazę, przeprowadzi zwiad, oznaczy sobie cele”): H — start (stery i kamera
  // fregaty, Atlas stoi), X — skan, T — oznaczenia (zostają po powrocie), H — powrót. Obrona wykrywa fregatę bliżej
  // niż PIRATE_BASE_TUNE.scoutDetect od bazy (StoryGame._detected). Gra bez fregaty: dron zwiadu albo podejście.
  ctx.phase('scout');
  api.fire.hold(true);
  const frigate = api.scout.grant();
  if (frigate) api.scout.avoidBase(site);
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
    api.say(frigate ? D.massContactScout : D.massContact, 'radio');
    watchAlarm();
    let droneSent = false;
    ctx.spawn(async (sub) => { await sub.event('droneLaunched'); droneSent = true; });
    const scoutGoing = () => droneSent || api.scout.launched();
    api.ui.marker('mass', massAt, 'Nieznana masa', {
      action: frigate ? { text: 'H → fregata zwiadu' } : { mouse: 'rmb', text: 'PPM → dron zwiadu' }
    });
    // budowle bazy rozpoznane przez stronę gracza (zbiorniki i magazyn leżą za habitatem — trzeba oblecieć)
    const total = api.site.structureCount(site);
    const reconDone = () => api.site.structuresSeen(site) >= total;
    api.ui.objective('scout', frigate
      ? 'Rozpoznaj sygnaturę masy — fregata zwiadu z ładowni (H)'
      : 'Rozpoznaj sygnaturę masy — dron zwiadu (PPM) albo ostrożne podejście',
    // licznik budowli od startu fregaty (do 2026-10-11 dopiero od pierwszej rozpoznanej budowli)
    frigate && total > 0 ? () => (api.scout.launched() ? `budowle ${api.site.structuresSeen(site)} / ${total}` : '') : undefined);
    hint(frigate ? 'scoutBay' : 'scout', () => spotted || api.site.scouted(site) || api.scout.controlling());
    if (frigate) {
      ctx.spawn(async (sub) => {
        await sub.until(() => api.scout.controlling() || spotted);
        if (!spotted) hint('scoutFly', () => spotted || reconDone() || !api.scout.controlling());
      });
    }
    await api.cinema.lookAt(massAt, {
      viewHeight: 30000, inSec: 1.8, holdSec: 30, outSec: 1.4,
      holdUntil: () => scoutGoing() || spotted || api.site.scouted(site)
    });
    await ctx.until(() => spotted || api.site.scouted(site));
    api.ui.marker('mass', null);
    if (!spotted) api.say(D.identified, 'radio');
    // OBLOT BAZY fregatą (wzrok 10 km): ostrzeżenie w celu misji, gdy fregata podchodzi pod zasięg wykrycia.
    if (frigate && !spotted && total > 0 && !reconDone() && !api.scout.lost()) {
      api.ui.objective('recon', 'Obleć bazę fregatą zwiadu — rozpoznaj budowle (T — oznacz cele, 3 — oko, 4 — daleki skan)', () => {
        const near = !api.scout.hidden() && api.scout.distanceTo(site) < api.site.scoutWarn();
        return `budowle ${api.site.structuresSeen(site)} / ${total}${near ? ' · ZA BLISKO — WYKRYJĄ' : ''}`;
      });
      await ctx.until(() => spotted || reconDone() || api.scout.lost());
      if (!spotted && reconDone()) api.say(D.reconDone, 'radio');
    }
    // stery wracają na Atlasa — fregata sama leci do ładowni (podejście w maskowaniu nie czeka na lądowanie)
    if (frigate && !spotted && api.scout.controlling()) {
      api.ui.objective('recall', 'Odwołaj fregatę zwiadu (H) — sama wróci do ładowni');
      await ctx.until(() => spotted || !api.scout.controlling() || api.scout.lost());
    }
  }
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
    api.ui.objective('sneak', 'Podkradnij się do rzędu okrętów przy ramieniu bazy');
    hint('sneak', () => spotted || api.nav.distanceTo(site.rowStart) < 5000);
    await ctx.until(() => spotted || api.nav.distanceTo(site.rowStart) < 5000);
  } else {
    const back = 5000;
    const a = site.ramAngle;
    api.dev.teleport(site.rowStart.x - Math.cos(a) * back, site.rowStart.y - Math.sin(a) * back, a);
  }

  // Wątki niezależne od faz (od wejścia do bazy): zbiorniki paliwa → reakcja łańcuchowa (bez podpowiedzi — gracz sam
  // musi się domyślić), magazyn → premia; habitat → finał (rozpad i ogień w rurach od środka).
  let chainKills = 0;
  ctx.spawn(async (sub) => {
    await sub.until(() => site.structureDestroyed('fuel') || site.chain.fuel || site.chain.burnt.has('P'));
    if (site.chain.fuel || site.chain.burnt.has('P')) return;
    api.ui.banner('REAKCJA ŁAŃCUCHOWA', 3);
    api.say(D.chainReaction, 'radio');
    chainKills = await api.site.fuelChain(site, 'P');
    if (chainKills > 0) api.ui.banner(`REAKCJA ŁAŃCUCHOWA · ${chainKills} OKRĘTÓW`, 3);
  });
  let warehouseDown = false;
  ctx.spawn(async (sub) => {
    await sub.until(() => site.structureDestroyed('warehouse'));
    warehouseDown = true;
    api.site.collapse?.(site, 'warehouse');
    api.ui.banner('MAGAZYN ZNISZCZONY', 2.4);
    api.say(D.warehouseDown, 'radio');
  });
  ctx.spawn(async (sub) => {
    await sub.until(() => site.structureDestroyed('piers'));
    api.site.collapse?.(site, 'piers');
  });
  let chainDone = false;
  ctx.spawn(async (sub) => {
    await sub.until(() => site.buildingDestroyed());
    api.ui.target('yard', null);
    // podsumowanie po ogniu w rurach (okręty w stanowiskach liczą się do reakcji); misja pominięta — bez czekania
    await api.site.chainExplosion(site, { waitFuel: run('aftermath') });
    api.say(D.shipyardDown, 'radio');
    api.journal.step(6);
    chainDone = true;
  });

  // ---------------------------------------------------------------- 6. TARAN (do alarmu)
  ctx.phase('ram');
  const ramRow = site.ramList();
  const ramGoal = Math.min(M.ramTarget, ramRow.length);
  const berthLabel = (e) => e.__berthId || `D-${String((e.__dockBerth ?? 0) + 1).padStart(2, '0')}`;
  if (run('ram')) {
    if (!spotted) api.say(D.ramOrder, 'radio');
    api.ui.marker('row', site.rowStart, 'Rząd okrętów');
    api.ui.objective('ram', 'Uderz w rząd okrętów — taran (F) albo Hexlance wzdłuż ramienia (4)');
    hint('ram', () => site.parkedKilled() >= 1);
    ramRow.forEach((e, i) => api.ui.target(`ram-${i}`, e, berthLabel(e), { group: 'Rząd' }));
    // Alarm: pierwsze zderzenie z bazą lub rzędem, zniszczony kadłub albo wykrycie.
    await ctx.until(() => spotted || site.rammed() || site.parkedKilled() > 0);
    alarmWatch?.cancel();
    api.site.alarm(site);
    api.fire.hold(false);
    api.say(spotted && !site.rammed() ? D.spotted : D.alarm, 'radio');
  } else {
    alarmWatch?.cancel();
    if (run('defences')) api.dev.kill(ramRow.slice(0, ramGoal));
    api.site.alarm(site);
    api.fire.hold(false);
  }
  api.ui.marker('row', null);
  for (let i = 0; i < ramRow.length; i++) api.ui.target(`ram-${i}`, null);
  api.journal.step(3);

  // ---------------------------------------------------------------- 7. BITWA W BAZIE: ZEGAR STARTÓW, DRONY, HERSZT
  ctx.phase('defences');
  const L = M.launch;
  const B = M.boss;
  const gone = (e) => api.fleet.gone(e);
  const boss = site.flagship || null;
  // Zegar startów: rekord na okręt z załogą. state: 'parked' → 'armed' (strzela ze stanowiska) → 'launched' → 'done'
  const yard = [];
  let stoppedN = 0;
  let launchedN = 0;
  let bossResult = boss ? null : 'none';   // 'killed' | 'hulk' | 'escaped' | 'none'
  let fleeing = false;
  let fleeT0 = 0;
  const dronesLeft = () => site.droneList.filter((e) => !gone(e)).length;
  // wszystkie fale dronów wystartowały (albo habitat padł — więcej nie będzie) i żaden nie lata
  const dronesDone = () => (site.droneWave >= site.droneWaves || site.buildingDestroyed()) && dronesLeft() === 0;
  if (run('defences')) {
    const T0 = ctx.time;
    // od najdalszych od wylotu lejka (zbiorniki, magazyn) ku wejściu Atlasa
    const m = site.mouth;
    const far = (e) => Math.hypot((e.pos ? e.pos.x : e.x) - m.x, (e.pos ? e.pos.y : e.y) - m.y);
    const order = site.crewList.slice().sort((a, b) => far(b) - far(a));
    let rank = 0;
    for (const e of order) {
      const down = gone(e) || site.parkedCrushed(e);
      const launchAt = T0 + L.first + L.step * rank;
      if (!down) rank++;
      yard.push({ e, id: `crew-${e.__dockBerth}`, label: berthLabel(e), group: 'Z załogą',
        launchAt, armAt: T0 + (launchAt - T0) * L.armAt, state: 'parked', shown: '' });
    }
    for (const r of yard) { r.shown = r.label; api.ui.target(r.id, r.e, r.label, { group: r.group }); }
    if (boss) api.ui.target('boss', boss, 'Supercapital Iron Skull');
    ctx.spawn(async (sub) => { await sub.wait(3); api.say(D.crews, 'radio'); });

    // --- drony: znaczniki (grupa) i podpowiedź — gracz odpala swoje myśliwce (Z)
    const dronesSeen = new Set();
    let dronesWarned = false;
    const stepDrones = () => {
      for (const e of site.droneList) {
        if (dronesSeen.has(e)) { if (gone(e)) api.ui.target(`drone-${e.id ?? dronesSeen.size}`, null); continue; }
        dronesSeen.add(e);
        e.__droneTag = `drone-${e.id ?? dronesSeen.size}`;
        api.ui.target(e.__droneTag, e, 'Dron', { group: 'Drony' });
      }
      for (const e of dronesSeen) if (gone(e) && e.__droneTag) api.ui.target(e.__droneTag, null);
      if (!dronesWarned && site.droneList.length) {
        dronesWarned = true;
        api.say(D.slipWarn, 'radio');
      }
    };

    // --- krok zegara (co tick gry)
    let firstParked = true;
    let lastLabels = -1;
    let objectiveId = null;
    let lastWave = 0;
    const inBerth = () => yard.filter((r) => r.state === 'parked' || r.state === 'armed');
    const nextLaunch = () => { let t = Infinity; for (const r of yard) if (r.state === 'parked' || r.state === 'armed') t = Math.min(t, r.launchAt); return t; };
    const enemiesLeft = () => yard.filter((r) => r.state === 'launched').length + dronesLeft() + (boss && !gone(boss) ? 1 : 0);
    const setObjective = (id) => {
      if (id === objectiveId) return;
      objectiveId = id;
      if (id === 'boss-flee') {
        api.ui.objective(id, 'Zatrzymaj supercapital herszta — ładuje skok', () => `skok ${Math.min(100, Math.round(((ctx.time - fleeT0) / B.escapeSec) * 100))}%`);
      } else if (id === 'launch') {
        api.ui.objective(id, 'Nie dopuść do startu — zniszcz okręty z załogą przy pomostach', () => {
          const t = nextLaunch() - ctx.time;
          return `${stoppedN} / ${yard.length}` + (Number.isFinite(t) ? ` · start za ${clockText(t)}` : '');
        });
      } else {
        api.ui.objective(id, 'Zniszcz okręty i drony piratów', () => `zostało ${enemiesLeft()}`);
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
        if (gone(e) || site.parkedCrushed(e)) {
          r.state = 'done';
          stoppedN++;
          api.ui.target(r.id, null);
          const how = site.parkedTouching(e) ? 'STARANOWANY' : 'ZNISZCZONY';
          api.ui.banner(`${how} ${r.label} · ${stoppedN} / ${yard.length}`, 2.4);
          continue;
        }
        // Zapłon silników z dymem tyle przed startem, ile trwa (okręt rusza o czasie).
        if (!r.ignited && now >= r.launchAt - engineIgnitionDuration()) { r.ignited = true; api.site.ignite?.(e); }
        if (now >= r.launchAt) {
          r.state = 'launched';
          launchedN++;
          api.site.launch(site, e);
          r.shown = r.label;
          api.ui.target(r.id, e, r.label, { group: 'Wystartowały' });
          api.ui.banner(`${r.label} STARTUJE`, 2.4);
          if (firstParked) { firstParked = false; api.say(D.firstLaunch, 'radio'); }
          continue;
        }
        if (r.state === 'parked' && now >= r.armAt) { r.state = 'armed'; api.site.arm(e); }
      }
      if (now - lastLabels >= 0.5 || lastLabels < 0) {
        lastLabels = now;
        for (const r of yard) {
          if (r.state !== 'parked' && r.state !== 'armed') continue;
          const left = r.launchAt - now;
          const label = left <= L.countdownFrom ? `${r.label} · ${clockText(left)}` : r.label;
          if (label !== r.shown) { r.shown = label; api.ui.target(r.id, r.e, label, { group: r.group }); }
        }
      }
      stepDrones();
      if ((site.droneWave || 0) > lastWave) {
        if (lastWave > 0) api.say(D.slipLaunch, 'radio');
        lastWave = site.droneWave || 0;
      }
      if (boss && gone(boss)) api.ui.target('boss', null);
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
      const mark = sub.spawn(async (mk) => { await mk.until(() => { markBridge(); return gone(boss); }); });
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
      // najpierw drony (lecą od razu — gracz odpala swoje myśliwce, Z), potem zegar startów
      if (site.droneList.length) {
        const cd = () => dronesLeft() < site.droneList.length * 0.5;
        hint('drones', cd);
        await sub.until(cd, { timeout: 25 });
      }
      const c1 = () => launchedN >= 1 || stoppedN >= 4 || !inBerth().length;
      hint('launch', c1);
      await sub.until(c1, { timeout: 45 });
      const c2 = () => yard.filter((r) => r.state === 'launched' && gone(r.e)).length >= 2 || !yard.some((r) => r.state === 'launched' && !gone(r.e));
      hint('weapons', c2);
      await sub.until(c2, { timeout: 30 });
      if (boss && !gone(boss)) {
        const c3 = () => gone(boss) || api.fleet.hpFrac(boss) < 0.5;
        hint('bridge', c3);
        await sub.until(c3, { timeout: 45 });
      }
    });

    await ctx.until(() => yard.every((r) => r.state === 'done') && dronesDone() && bossResult !== null);
    yardThread.cancel();
    await bossThread.done;
    for (const r of yard) api.ui.target(r.id, null);
    for (const e of site.droneList) if (e.__droneTag) api.ui.target(e.__droneTag, null);
    api.ui.target('boss', null);
    api.ui.objective(null);
    if (!site.buildingDestroyed()) api.say(D.defencesDown, 'radio');
  } else {
    // skok dev za bitwę: okręty z załogą, drony i herszt pokonani
    api.dev.kill([...site.crewList, ...site.droneList, ...(boss ? [boss] : [])]);
    if (boss) bossResult = 'killed';
  }
  api.journal.step(4);
  api.journal.step(5);

  // ---------------------------------------------------------------- 8. HABITAT
  ctx.phase('shipyard');
  if (run('shipyard')) {
    if (!site.buildingDestroyed()) {
      api.ui.target('yard', site.station, 'Habitat piratów', { radius: site.buildingRadius, primary: true });
      api.ui.objective('yard', 'Zniszcz habitat bazy — broń wbudowana (4) albo taran', () => `${Math.round(site.buildingHpFrac() * 100)}%`);
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
  chainKills = Math.max(chainKills, site.chain.killed || 0);
  const reward = api.rewards.grant({
    exp: M.rewards.exp + stoppedN * P.perStopped.exp + (bossDown ? P.boss.exp : 0) + chainKills * P.perChain.exp + (warehouseDown ? P.warehouse.exp : 0),
    credits: M.rewards.credits + stoppedN * P.perStopped.credits + (bossDown ? P.boss.credits : 0) + chainKills * P.perChain.credits + (warehouseDown ? P.warehouse.credits : 0),
    rep: M.rewards.rep
  });
  api.scout.clearAvoid();
  const campaign = api.campaign;
  campaign.m1 = { stopped: stoppedN, launched: launchedN, total: yard.length, boss: bossResult, chain: chainKills, warehouse: warehouseDown, fuelChain: !!site.chain.fuel };
  campaign.bossEscaped = bossResult === 'escaped';
  if (run('aftermath')) {
    api.say(D.yardVictory, 'radio');
    await ctx.wait(3);
    const bossText = { killed: 'zniszczony', hulk: 'bez dowodzenia', escaped: 'uciekł', none: '—' }[bossResult] || '—';
    const stats = [
      ['Zatrzymane przed startem', `${stoppedN} / ${yard.length}`],
      ['Supercapital herszta', bossText, bossResult === 'escaped' ? 'neg' : bossDown ? 'pos' : '']
    ];
    if (site.chain.fuel || chainKills > 0) stats.push(['Reakcja łańcuchowa', `${chainKills} okrętów`, 'pos']);
    stats.push(['Magazyn piratów', warehouseDown ? 'zniszczony' : 'cały', warehouseDown ? 'pos' : '']);
    await api.ui.summary({ title: 'MISJA WYKONANA', subtitle: M.title, reward, stats });
  }
  api.journal.complete();
  defeatWatch.cancel('complete');
  return 'complete';
}
