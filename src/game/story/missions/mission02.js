// ============================================================
// Misja 2 „Odwet” (2026-10-07) — dalszy ciąg misji 1 w tym samym świecie, nad gruzami stoczni piratów.
//
// Naprawa w polu → trzy fale piratów z różnych stron (fala 1: fregaty i niszczyciele, fala 2: pancerniki z flanki,
// w niej posiłki z Ziemi — słabsze od odwetu, fala 3: okręt herszta; jeśli herszt uciekł w misji 1, wraca ten sam
// supercapital, połatany) → zwycięstwo → ZASADZKA W PASIE (kurs stocznia → Ziemia zawsze przecina pas asteroid:
// piraci wyrywają Atlasa z warpa przy olbrzymie albo w najgęstszym polu na kursie, zakłócacz trzyma go w miejscu,
// walka wśród skał) → powrót do K-7 (dok, scena). Kampania: src/game/story/campaign.js.
//
// Dialogi: src/data/story/mission02.dialogue.js. Składy fal, posiłków, zasadzki, przerwy i nagrody: MISSION02.
// Miejsce zasadzki i wyzwalacz: src/game/story/beltAmbush.js (api.belt).
// AGENT: naprawa w polu (faza 'repair') to dziś naprawa własna (R) — docelowo okręt wsparcia z rojem dronów
// naprawczych (osobna sesja).
// ============================================================
import { MISSION02_DIALOGUE as D, MISSION02_TITLE } from '../../../data/story/mission02.dialogue.js';

export const MISSION02 = Object.freeze({
  id: 'm02_reprisal',
  title: MISSION02_TITLE,
  banner: 'ROZDZIAŁ 1 UKOŃCZONY',
  description: 'Piraci odpowiadają na zniszczenie stoczni. Utrzymać pole nad gruzami, aż odwet się złamie, i wrócić do K-7.',
  // Odwet w trzech falach: łącznie skład z decyzji użytkownika 2026-09-30 (7 pancerników, 8 niszczycieli,
  // 15 fregat) + okręt herszta w trzeciej. bearing [rad] — obrót kierunku nadejścia względem głębi obrzeży
  // (site.origin): każda fala z innej strony.
  waves: Object.freeze([
    Object.freeze({ phase: 'counter', counts: Object.freeze({ battleship: 0, destroyer: 4, frigate: 9 }), bearing: 0, say: 'wave1', down: 'wave1Down', hint: 'barrage' }),
    Object.freeze({ phase: 'counter2', counts: Object.freeze({ battleship: 5, destroyer: 3, frigate: 3 }), bearing: 1.1, say: 'wave2', down: 'wave2Down', hint: 'shields' }),
    Object.freeze({ phase: 'counter3', counts: Object.freeze({ battleship: 2, destroyer: 1, frigate: 3 }), bearing: -0.9, boss: 'pirate_supercapital', hint: 'bridge' })
  ]),
  // Posiłki z Ziemi (2026-10-07: słabsze od odwetu, dochodzą w drugiej fali — `supportDelaySec` po jej
  // pierwszym przylocie; dawniej 10 / 5 / 5 po 22 s i bitwa rozstrzygała się bez gracza).
  support: Object.freeze({ battleship: 4, destroyer: 4, frigate: 4 }),
  supportDelaySec: 25,
  breakSec: 18,          // przerwa między falami [s] — naprawa (R), tarcze wracają
  rout: Object.freeze({ at: 0.15, delay: 20 }),   // z fali zostaje ≤ 15% — po `delay` s reszta ucieka warpem
  bossRoutDelay: 6,      // po upadku okrętu herszta reszta trzeciej fali ucieka po tylu sekundach
  bossHpEscaped: 0.6,    // herszt, który uciekł z misji 1, wraca z tą częścią punktów
  repairSec: 45,         // naprawa w polu: najwyżej tyle, potem odwet przychodzi i tak
  // Zasadzka w pasie asteroid w drodze powrotnej (2026-10-07): mała grupa wyrywa Atlasa z warpa. Front z
  // zakłócaczem warpa (`jammer` — póki żyje, skok jest przerywany) `distance` przed Atlasem na kursie, po
  // `flankDelay` s skrzydło z boku kursu (`flankBearing` [rad] od kursu); tunele z pola przed Atlasem
  // (`originDistance` — nić zwiastuna wychodzi ze skał). Po zakłócaczu: reszta łamie się jak fale (`rout`) albo
  // zostaje w pasie, gdy Atlas odleci dalej niż `leaveDist`. Skok dev ?story=ambush: Atlas `devBack` przed miejscem.
  ambush: Object.freeze({
    counts: Object.freeze({ battleship: 0, destroyer: 1, frigate: 4 }),
    jammer: 'destroyer',
    distance: 6500,
    flank: Object.freeze({ battleship: 0, destroyer: 0, frigate: 3 }),
    flankDelay: 12,
    flankBearing: 1.75,
    flankDistance: 7500,
    originDistance: 40000,
    leaveDist: 40000,
    devBack: 120000
  }),
  rewards: Object.freeze({ exp: 1300, credits: 50000, rep: Object.freeze({ terra_nova: 10, pirates: -10 }) }),
  homeRadius: 25000      // „przy porcie” — dalej dokowanie przejmuje port (przejście przez czerń)
});

export const MISSION02_HINTS = Object.freeze({
  repair: { keys: ['R'], title: 'Naprawa', text: 'R — naprawa kadłuba (włącz / wyłącz). Odbudowuje zniszczone sekcje; tarcza wraca sama, gdy przestajesz obrywać.' },
  barrage: { keys: ['5'], title: 'Supernova Barrage', text: '5 — salwa czterech głowic Supernowej, każda w inny okręt zbitej grupy. Magazynek: dwie salwy — oszczędzaj na skupiska.' },
  shields: { keys: ['ŚPM'], title: 'Tryby okrętu', text: 'Trzymaj ŚPM — koło trybów. TARCZE: pole odnawia się szybciej i trudniej je przebić, kosztem prędkości i obrotu. Stuknięcie ŚPM — powrót do poprzedniego trybu.' },
  fleet: { keys: [], title: 'Wsparcie', text: 'Posiłki z Ziemi walczą przy tobie. Rozkazy skrzydła (ESKORTA / ATAK) — zakładka Rezerwa w kokpicie.' },
  bridge: { keys: ['LPM', '2'], title: 'Słaby punkt', text: 'MOSTEK okrętu herszta jest oznaczony. Zniszczony mostek = okręt bez dowodzenia — reszta fali się złamie.' },
  jammer: { keys: ['T', 'LPM'], title: 'Zakłócacz warpa', text: 'Póki zakłócacz żyje, skok się zrywa. T — cel priorytetowy (wieże na auto biją w niego pierwsze), LPM — ogień grupy w ręku.' },
  home: { keys: ['CapsLock', '9'], title: 'Powrót', text: 'Kurs na Ziemię wyznaczony. TRAVEL TO prowadzi podróż; ręcznie ustaw zielony kurs (±5°) i skocz: CapsLock albo 9. Warp wyjdzie przed studnią grawitacyjną, dalej leć napędem ku hali K-7 — dokowanie przejmie port.' }
});

// Fazy misji 2 w kolejności (część kampanii — src/game/story/campaign.js). 'counter' = fala 1 (nazwa jak w
// skryptach harnessu: ogien-gra, zasiegi-gra, rakiety-auto-gra). 'ambush' = droga przez pas z zasadzką,
// 'return' = reszta drogi do K-7 i dok (skok dev ?story=return omija zasadzkę).
export const MISSION02_PHASES = Object.freeze(['repair', 'counter', 'counter2', 'counter3', 'victory', 'ambush', 'return', 'done']);

const clockText = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export async function mission02(ctx) {
  const api = ctx.api;
  const M = MISSION02;
  const tutorial = !!api.tutorial;
  const hint = (key, until) => (tutorial && key ? api.ui.hint(MISSION02_HINTS[key], until) : null);
  const from = Math.max(0, api.phaseIndex(api.startPhase || 'intro'));
  const run = (phase) => api.phaseIndex(phase) >= from;
  const site = api.site.current();
  const camp = api.campaign;

  api.journal.begin(M, [
    'Przygotuj Atlasa na odwet.',
    'Odeprzyj pierwszą falę.',
    'Odeprzyj drugą falę.',
    'Pokonaj okręt herszta.',
    'Przeleć przez pas asteroid.',
    'Wróć do K-7.'
  ]);

  // Porażka: Atlas zniszczony — przerwij misję (gra pokazuje własny ekran śmierci).
  const defeatWatch = ctx.spawn(async (sub) => {
    await sub.event('playerDestroyed');
    api.ui.objective(null);
    api.ui.hint(null);
    api.ui.clearTargets();
    api.ui.marker('bridge', null);
    api.journal.fail('Atlas zniszczony.');
    api.say(D.defeat, 'radio');
    ctx.cancel('player-destroyed');
  });

  // ---------------------------------------------------------------- 1. NAPRAWA W POLU
  ctx.phase('repair');
  if (run('repair')) {
    api.say(D.repair, 'radio');
    const t0 = ctx.time;
    api.ui.objective('repair', 'Napraw Atlasa przed odwetem',
      () => `kadłub ${Math.round(api.player.hullFrac() * 100)}% · piraci za ${clockText(M.repairSec - (ctx.time - t0))}`);
    hint('repair', () => api.player.repairing() || api.player.hullFrac() >= 0.98);
    // pełna naprawa skraca czekanie (chwila na oddech), inaczej piraci przychodzą po repairSec
    await ctx.until(() => ctx.time - t0 >= M.repairSec || (api.player.hullFrac() >= 0.98 && ctx.time - t0 >= 8));
  }
  api.journal.step(0);

  // ---------------------------------------------------------------- 2. FALE ODWETU
  let allies = null;
  let supportCalled = false;
  const R = M.rout;
  const brk = async (nextWave) => {
    const t0 = ctx.time;
    api.ui.objective('break', 'Przegrupuj się — następna fala w drodze', () => `${clockText(M.breakSec - (ctx.time - t0))}`);
    if (tutorial && api.player.hullFrac() < 0.9) hint('repair', () => api.player.repairing() || api.player.hullFrac() >= 0.98);
    await ctx.wait(M.breakSec);
    api.ui.objective(null);
    return nextWave;
  };

  for (let i = 0; i < M.waves.length; i++) {
    const W = M.waves[i];
    ctx.phase(W.phase);
    if (!run(W.phase)) { api.journal.step(1 + i); continue; }
    const isBoss = !!W.boss;
    if (isBoss) api.say(camp.bossEscaped ? D.bossReturns : D.newCommander, 'radio');
    else api.say(D[W.say], 'radio');
    const g = api.fleet.pirateWave(site, W.counts, {
      bearing: W.bearing, tag: W.phase,
      extra: isBoss ? [{ key: W.boss, mark: '__storyBoss' }] : null
    });
    api.ui.objective(W.phase, `Fala ${i + 1} z ${M.waves.length}: odeprzyj piratów`, () => `${g.killed()} / ${g.total()}`);
    await ctx.until(() => g.arrived() > 0, { timeout: 30 });
    const hintAt = ctx.time;
    hint(W.hint, () => ctx.time - hintAt > 25);

    // posiłki z Ziemi: w drugiej fali (albo w pierwszej obecnej po skoku dev)
    if (!supportCalled && (i >= 1 || !run('counter2'))) {
      supportCalled = true;
      ctx.spawn(async (sub) => {
        await sub.wait(M.supportDelaySec);
        allies = api.fleet.earthSupport(site, M.support);
        api.say(D.support, 'radio');
        hint('fleet', () => allies.arrived() >= 5);
      });
    }

    if (isBoss) {
      // okręt herszta: znacznik, mostek jako słaby punkt; po jego upadku reszta fali ucieka
      await ctx.until(() => g.members.some((e) => e.__storyBoss) || g.pending() === 0, { timeout: 40 });
      const boss = g.members.find((e) => e.__storyBoss) || null;
      if (boss) {
        if (camp.bossEscaped && boss.maxHp > 0) boss.hp = Math.max(1, Math.round(boss.maxHp * M.bossHpEscaped));
        boss.displayName = camp.bossEscaped ? 'Iron Skull — herszt' : 'Iron Skull — nowy herszt';
        api.ui.target('boss', boss, 'Okręt herszta');
        const bp = { x: 0, y: 0 };
        let lastMark = -1;
        await ctx.until(() => {
          if (api.fleet.gone(boss)) return true;
          if (ctx.time - lastMark >= 0.1) {
            lastMark = ctx.time;
            const p = api.fleet.bridgePoint(boss, bp);
            if (p && Number.isFinite(p.x)) api.ui.marker('bridge', p, 'MOSTEK', { journal: false });
          }
          return false;
        });
        api.ui.marker('bridge', null);
        api.ui.target('boss', null);
        api.say(D.bossDown, 'radio');
        api.ui.banner(api.fleet.isHulk(boss) ? 'OKRĘT HERSZTA BEZ DOWODZENIA' : 'OKRĘT HERSZTA ZNISZCZONY', 3);
      }
      await ctx.until(() => g.pending() === 0, { timeout: 30 });
      if (g.alive() > 0) {
        await ctx.until(() => g.alive() === 0, { timeout: M.bossRoutDelay });
        if (g.alive() > 0) { api.say(D.rout, 'radio'); g.retreat(); }
      }
    } else {
      await ctx.until(() => g.pending() === 0 && g.alive() <= Math.floor(g.total() * R.at));
      if (g.alive() > 0) {
        await ctx.until(() => g.alive() === 0, { timeout: R.delay });
        if (g.alive() > 0) { api.say(D.rout, 'radio'); g.retreat(); }
      }
    }
    await ctx.until(() => g.alive() === 0, { timeout: 45 });
    api.ui.objective(null);
    api.journal.step(1 + i);
    if (i + 1 < M.waves.length) {
      if (W.down) api.say(D[W.down], 'radio');
      if (run(M.waves[i + 1].phase)) await brk(i + 1);
    }
  }

  // ---------------------------------------------------------------- 3. ZWYCIĘSTWO
  ctx.phase('victory');
  api.ui.objective(null);
  const reward = api.rewards.grant(M.rewards);
  if (run('victory')) {
    api.say(D.victory, 'radio');
    await ctx.wait(3);
    allies?.returnHome();
    await api.ui.summary({ title: 'MISJA WYKONANA', subtitle: M.title, reward });
  } else {
    allies?.returnHome();
  }

  // ---------------------------------------------------------------- 4. ZASADZKA W PASIE
  // Droga do domu przecina pas asteroid; tam piraci wyrywają Atlasa z warpa (beltAmbush.js — przy olbrzymie albo
  // w najgęstszym polu na kursie). Gracz o zasadzce nie wie: cel to powrót, dziennik mówi „przeleć przez pas”.
  ctx.phase('ambush');
  const home = api.dock.approachPoint();
  let courseSet = false;
  let homeHinted = false;
  const setHomeCourse = () => {
    if (!courseSet) api.nav.setCourse(home.x, home.y, 'Ziemia — hala K-7');
    courseSet = true;
    api.ui.objective('home', 'Wróć do hali K-7');
    if (!homeHinted) { homeHinted = true; hint('home', () => api.dock.nearHall(M.homeRadius * 2)); }
  };
  if (run('ambush')) {
    const plan = api.belt.ambushPlan(home);
    if (plan && api.startPhase === 'ambush') {
      // skok dev: Atlas na kursie przed miejscem zasadzki — skok warpem (TRAVEL TO) i wyrwanie w pasie
      const b = Math.max(0, plan.along - M.ambush.devBack);
      api.dev.teleport(plan.from.x + plan.dirX * b, plan.from.y + plan.dirY * b, plan.angle);
    }
    setHomeCourse();
    if (plan) {
      const hit = await ctx.until(() => (api.belt.reached(plan) ? 'ambush' : api.dock.nearHall(M.homeRadius) ? 'home' : null));
      if (hit === 'ambush') {
        courseSet = false;
        await beltAmbush(plan);
      }
    }
  }
  api.journal.step(4);

  async function beltAmbush(plan) {
    const A = M.ambush;
    // wyrwanie z warpa (hamowanie jak przy studni grawitacji) — kurs zdjęty na czas walki (automat podróży
    // obracałby okręt do skoku)
    const pulled = api.nav.interdict();
    api.nav.clearCourse();
    api.ui.objective(null);
    api.ui.hint(null);
    api.ui.banner(pulled ? 'WYRWANI Z WARPA — ZASADZKA' : 'ZASADZKA', 3);
    api.say(D.ambush, 'radio');
    // zakłócacz: póki żyje (albo jeszcze nie doleciał), każdy skok — także ładowanie — jest zrywany
    let jamOn = true;
    const jam = ctx.spawn(async (sub) => {
      await sub.until(() => {
        if (!jamOn) return true;
        if (api.nav.inWarp() && api.nav.interdict()) api.ui.banner('WARP ZAKŁÓCANY', 1.5);
        return false;
      });
    });
    // szyk zasadzki liczony od miejsca, w którym Atlas wyhamował (~1 s po wyrwaniu)
    await ctx.until(() => api.player.speed() < 1500, { timeout: 2 });
    const p = api.player.pos();
    const ux = plan.dirX, uy = plan.dirY;
    const at = (bearing, dist) => {
      const c = Math.cos(bearing), s = Math.sin(bearing);
      return { x: p.x + (ux * c - uy * s) * dist, y: p.y + (uy * c + ux * s) * dist };
    };
    const groups = [api.fleet.pirateWave(site, A.counts, {
      at: at(0, A.distance), origin: at(0, A.originDistance), tag: 'ambush', extra: [{ key: A.jammer, mark: '__storyJammer' }]
    })];
    const sum = (f) => groups.reduce((n, g) => n + g[f](), 0);
    const far = () => api.nav.distanceTo(p) > A.leaveDist;
    let flankDone = false;
    const flank = ctx.spawn(async (sub) => {
      await sub.wait(A.flankDelay);
      if (!far()) {
        groups.push(api.fleet.pirateWave(site, A.flank, { at: at(A.flankBearing, A.flankDistance), origin: at(A.flankBearing, A.originDistance), tag: 'ambush' }));
        api.say(D.ambushFlank, 'radio');
      }
      flankDone = true;
    });
    api.ui.objective('ambush', 'Zasadzka: zniszcz zakłócacz warpa', () => `${sum('killed')} / ${sum('total')}`);
    await ctx.until(() => groups[0].members.some((e) => e.__storyJammer) || groups[0].pending() === 0, { timeout: 30 });
    const jammer = groups[0].members.find((e) => e.__storyJammer) || null;
    if (jammer) {
      jammer.displayName = 'Zakłócacz warpa';
      api.ui.target('jammer', jammer, 'Zakłócacz warpa', { primary: true });
      hint('jammer', () => api.fleet.gone(jammer));
      // zakłócacz gaśnie z okrętem (albo Atlas ucieka napędem poza jego zasięg)
      await ctx.until(() => api.fleet.gone(jammer) || far());
      api.ui.target('jammer', null);
      api.ui.banner('WARP ODBLOKOWANY', 2.5);
      api.say(D.jammerDown, 'radio');
    }
    jamOn = false;
    jam.cancel('jammer-down');
    // reszta zasadzki: łamie się jak fale odwetu; Atlas może też po prostu odlecieć (skok już działa)
    api.ui.objective('ambush', 'Rozbij zasadzkę albo leć dalej', () => `${sum('killed')} / ${sum('total')}`);
    const R = M.rout;
    await ctx.until(() => far() || (flankDone && sum('pending') === 0 && sum('alive') <= Math.floor(sum('total') * R.at)));
    flank.cancel('ambush-over');
    if (sum('alive') > 0) {
      if (!far()) await ctx.until(() => sum('alive') === 0 || far(), { timeout: R.delay });
      if (sum('alive') > 0) {
        if (!far()) api.say(D.ambushRout, 'radio');
        for (const g of groups) g.retreat();
      }
    }
    await ctx.until(() => sum('alive') === 0, { timeout: 45 });
    api.ui.objective(null);
    api.say(D.ambushDown, 'radio');
  }

  // ---------------------------------------------------------------- 5. POWRÓT
  ctx.phase('return');
  setHomeCourse();
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
