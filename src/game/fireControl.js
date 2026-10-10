// src/game/fireControl.js
//
// KIEROWANIE OGNIEM okrętu gracza (2026-10-01, docs/BRIEF-kierowanie-ogniem.md): gracz dowodzi okrętem,
// a nie obsługuje każdą wieżę. Wzorzec: Starsector (grupy broni na auto, jedna „w ręku”).
//
//   • grupa W RĘKU (domyślnie `special`, bez niej `main`): celuje w kursor, strzela przy trzymanym LPM;
//   • pozostałe grupy na AUTO: każda wieża sama wybiera cel w swoim zasięgu, wyprzedza go i strzela,
//     gdy lufa jest wycelowana i na linii ognia nie ma sojusznika — kilka celów naraz bez namierzania;
//   • ŁUKI OSTRZAŁU (env.arcOf, src/game/weaponAim.js): działa 180°, broń specjalna 270° — wieża bije
//     tylko to, co ma po swojej stronie kadłuba;
//   • CEL PRIORYTETOWY (klawisz T, lista `lockedTargets` gry; T trzymane + kursor = malowanie kilku):
//     wieże, które mogą go razić, biorą go przed innymi;
//   • RAKIETY NA AUTO (fcPlanMissileSalvo): każda salwa sama wybiera cele w zasięgu — cele priorytetowe,
//     a w postawie „swobodny” także wrogów, którzy zagrażają — z budżetem (rakiety w locie odejmują się
//     od potrzeb celu) i dzieli się na kilka celów; postawa „tylko cel” — wyłącznie cele priorytetowe;
//   • POSTAWA OGNIA: swobodny / tylko cel priorytetowy / wstrzymać (pod maskowaniem zawsze cisza —
//     strzał zrywa maskowanie).
//
// Moduł jest czysty (bez DOM, three i okna gry): całą grę podaje `env` (dostęp do celów, wylotów,
// strzału). Stan wieży żyje na stanie celowania gniazda (src/game/weaponAim.js) i na samym gnieździe
// (`hp.fcCd` — własne przeładowanie działa głównego; dawniej cała bateria miała jedno wspólne).
// Wpięcie: blok „KIEROWANIE OGNIEM” w index.html (gracz 1 — jedyne sterowanie, dawne „klasyczne” usunięte
// 2026-10-03). Gracz 2 (podzielony ekran) zostaje jeszcze na ścieżce WeaponController.update.
// Stan wież dla HUD-u (fc.turrets, FC_TURRET): celownik src/ui/weaponReticle.js, sylwetka src/ui/turretPanel.js.

export const FC_GROUPS = Object.freeze(['main', 'special', 'missile']);
export const FC_GROUP_LABEL = Object.freeze({ main: 'DZIAŁA', special: 'BATERIA GŁÓWNA', missile: 'RAKIETY' });
export const FC_GROUP_KEY = Object.freeze({ main: '1', special: '2', missile: '3' });

export const FC_POSTURES = Object.freeze(['free', 'focus', 'hold']);
export const FC_POSTURE_LABEL = Object.freeze({
  free: 'OGIEŃ SWOBODNY',
  focus: 'TYLKO CEL PRIORYTETOWY',
  hold: 'WSTRZYMAĆ OGIEŃ'
});

// Strojenie wyboru celu i bramki strzału.
export const FC_TUNE = {
  scanInterval: 0.3,        // [s] co ile wieża ocenia cele na nowo (plus rozrzut, żeby nie skanowały razem)
  scanJitter: 0.2,
  priorityBonus: 1000,      // cel priorytetowy (T) wygrywa z każdym innym w zasięgu
  cursorBonus: 400,         // wróg przy kursorze, gdy gracz strzela grupą w ręku („bij tam, gdzie ja”)
  stickBonus: 60,           // lepkość: obecny cel zostaje, dopóki inny nie jest wyraźnie lepszy
  matchWeight: 100,         // dopasowanie kalibru do klasy celu × szansa trafienia
  // Zagrożenie (pole `threat` kandydata, 0..1 — klej gry): 1 = strzela do gracza / ma go za cel. Bez tego
  // bateria biła zaparkowany pancernik (cel nieruchomy, „pewne trafienie”), a fregaty eskorty z 1,3 km
  // rozbierały tarczę gracza (pomiar 2026-10-01, misja 1 faza defences: 10 z 15 dział w pancerniku).
  threatWeight: 150,
  woundWeight: 70,          // dobijanie: premia × ubytek (1 − need / needMax)
  killWeight: 60,           // szybkie zabicie: premia × (1 − need / killRef) — najpierw fregaty, potem niszczyciel
  killRef: 8000,
  focusBonus: 60,           // dołączenie do ognia na celu, któremu ten ogień jeszcze nie wystarcza
  maxTargets: 2,            // tylu celów naraz bateria bije bez kary (skupienie ognia — cel ginie, zanim się zregeneruje)
  spreadPenalty: 120,       // kara za otwarcie kolejnego celu ponad maxTargets
  anglePenalty: 10,         // [pkt/rad] obrót wieży do celu
  sidePenalty: 8,           // [pkt/rad] cel po przeciwnej burcie niż wieża: baterie biją to, co mają po swojej stronie
  rangePenalty: 30,         // [pkt] przy pełnym zasięgu
  overkillPenalty: 160,     // kara za ogień PONAD potrzeby celu (dopiero wtedy wieże idą na kolejny cel)
  overkillSeconds: 2,       // ile sekund przydzielonego ognia liczy się jako „dość”
  // Bramka strzału: lufa w stożku, w który mieści się cel (połowa promienia), w granicach:
  aimTolMin: 0.012,
  aimTolMax: 0.09,
  handTol: 0.12,            // grupa w ręku: strzał, gdy lufa jest do 7° od kursora (ciężka wieża nie pluje bokiem)
  // Unik celu w czasie lotu pocisku: przyspieszenie klasy × ułamek, którego AI naprawdę używa (kluczenie).
  evadeAccel: Object.freeze({ fighter: 2200, frigate: 1750, destroyer: 830, battleship: 325, station: 0, other: 300 }),
  evadeUse: 0.35,
  // Dopasowanie rozmiaru broni do klasy celu (0..1).
  classMatch: Object.freeze({
    S: Object.freeze({ fighter: 1, frigate: 1, destroyer: 0.7, battleship: 0.5, station: 0.3, other: 0.8 }),
    M: Object.freeze({ fighter: 0.5, frigate: 1, destroyer: 1, battleship: 0.8, station: 0.5, other: 0.9 }),
    L: Object.freeze({ fighter: 0.15, frigate: 0.8, destroyer: 1, battleship: 1, station: 0.8, other: 0.9 }),
    Capital: Object.freeze({ fighter: 0.05, frigate: 0.6, destroyer: 1, battleship: 1, station: 1, other: 0.8 })
  }),
  salvoStep: 0.085,         // [s] odstęp luf jednej wieży (jak SALVO_STEP broni specjalnej)
  cdJitter: 0.12,           // rozrzut przeładowania wież na auto (bateria nie strzela jednym taktem)
  rocketInterval: 0.11,     // [s] odstęp wyrzutni rakiet
  // RAKIETY NA AUTO (2026-10-04, wzór Starsector): każda salwa sama wybiera cele z BUDŻETEM — obrażenia
  // rakiet w locie odejmują się od potrzeb celu (tarcza + kadłub × missileMargin, zapas na obronę
  // punktową), salwa dzieli się na kilka celów (najwyżej missileSplitMax). Dawniej cała salwa szła
  // w pierwszy cel priorytetowy — fregata (~2,5 tys.) dostawała Grada + manewrujące (~7,3 tys.).
  missileMargin: 1.3,
  missileSplitMax: 4,
  missileMinUse: 0.3,       // salwa rusza, gdy co najmniej tyle jej obrażeń ma cel do pokrycia (bez dobijania jednym Gradem)
  missileMinMatch: 0.25,    // poniżej — rodzaj rakiety nie leci na auto w tę klasę (ciężkie w myśliwce)
  // Dopasowanie RODZAJU rakiety do klasy celu: lekkie (mikrorakiety, szybkie) na drobnicę, ciężkie na duże.
  // Ciężkie we fregatę 0,5 (do 2026-10-07: 0,6): kara za odległość liczy się względem zasięgu wyrzutni, a
  // zasięgi rakiet spadły o połowę — przy 0,6 fregata 3 km bliżej wygrywała z niszczycielem i manewrujące
  // szły we fregaty Grada. 0,5 = niszczyciel do ~6 km dalej niż fregata (dawniej ~4,7 km).
  missileMatch: Object.freeze({
    light: Object.freeze({ fighter: 0.6, frigate: 1, destroyer: 0.75, battleship: 0.5, station: 0.4, other: 0.8 }),
    heavy: Object.freeze({ fighter: 0.1, frigate: 0.5, destroyer: 1, battleship: 1, station: 1, other: 0.8 })
  })
};

/** Rodzaj rakiety do doboru celu: `missileRole` z karty broni albo z wyglądu (mikro / szybka = lekka). */
export function fcMissileRole(weapon) {
  const own = weapon?.missileRole;
  if (own === 'light' || own === 'heavy') return own;
  return (weapon?.rocketVfx === 'micro' || weapon?.rocketVfx === 'fast') ? 'light' : 'heavy';
}

/** Rakiet w salwie wyrzutni (jak rocketSalvoSize w src/data/weapons.js). */
export function fcSalvoSize(weapon) {
  const n = Math.round(Number(weapon?.burstCount) || 1);
  return n > 1 ? n : 1;
}

/** Obrażenia JEDNEJ rakiety salwy (kasetowa — wszystkie głowice), bez modyfikatorów okrętu. */
export function fcMissileDamage(weapon) {
  const split = Math.round(Number(weapon?.submunition?.count) || 0);
  return (Number(weapon?.baseDamage) || 0) * (split > 0 ? split : 1);
}

// Stan wieży dla HUD (celownik — src/ui/weaponReticle.js, sylwetka okrętu — src/ui/turretPanel.js).
export const FC_TURRET = Object.freeze({
  RELOAD: 0,    // przeładowanie (progress 0..1, left [s])
  READY: 1,     // naładowana i lufa na punkcie celowania — strzeli
  TRAVERSE: 2,  // naładowana, lufa jeszcze się obraca
  NO_ARC: 3,    // naładowana, ale punkt celowania leży poza łukiem ostrzału wieży
  CHARGE: 4,    // ładowanie przed strzałem (Valkyrie, Mjolnir — progress 0..1)
  DOWN: 5,      // gniazdo zniszczone
  IDLE: 6,      // na auto, naładowana, bez celu
  STILL: 7      // naładowana, ale broń strzela tylko z postoju (`requiresStationary` — Mjolnir), a okręt się rusza
});

function turretEntry(fc, group, n) {
  const list = fc.turrets[group];
  return list[n] || (list[n] = { hp: null, state: FC_TURRET.IDLE, progress: 1, left: 0, cdMax: 0, angle: 0, x: 0, y: 0, hand: false, arcC: 0, arcH: Math.PI });
}

function writeTurret(fc, group, n, hp, state, left, cdBase, angle, hand, arc = null) {
  const t = turretEntry(fc, group, n);
  if (t.hp !== hp) { t.hp = hp; t.cdMax = 0; }
  // Pełny czas przeładowania: największy widziany „left” od strzału (bez pola na gnieździe —
  // gniazda gracza idą do zapisu).
  if (left > t.cdMax) t.cdMax = left;
  const full = Math.max(t.cdMax, cdBase, 1e-3);
  t.state = state;
  t.left = left;
  t.progress = left > 0 ? Math.max(0, Math.min(1, 1 - left / full)) : 1;
  t.angle = angle;
  const p = hp.pos || hp;
  t.x = Number(p.x) || 0;
  t.y = Number(p.y) || 0;
  t.hand = hand;
  // Łuk ostrzału w układzie kadłuba (kompas łuków); π = bez łuku.
  t.arcC = arc ? arc.center : 0;
  t.arcH = arc ? arc.half : Math.PI;
  return t;
}

export function createFireControl() {
  return {
    inHand: 'special',
    auto: { main: true, special: true, missile: true },
    posture: 'free',
    candidates: [],          // [{ e, kind, need, needMax, threat, prio }]
    candidateCount: 0,
    scanCd: 0,
    rocketCd: 0,
    _load: new Map(),        // cel → przydzielone obrażenia/s
    // Rakiety na auto: obrażenia rakiet w locie na cel (env.missileIncoming), kolejna wyrzutnia,
    // plan salwy (cel per rakieta) i najlepsze cele planu.
    _incoming: new Map(),
    _missileNext: 0,
    _salvoTargets: [],
    _pickE: [],
    _pickScore: [],
    _pickRem: [],
    _pickNeed: [],
    // Ostatnia salwa na auto (HUD, diagnostyka): ile celów, ile rakiet.
    lastSalvo: { targets: 0, rockets: 0 },
    // Stan wież dla HUD po ostatnim kroku: turrets[grupa][0..turretCount[grupa]) (FC_TURRET).
    turrets: { main: [], special: [] },
    turretCount: { main: 0, special: 0 },
    // Statystyki ostatniego kroku (HUD): wieże grupy w ręku gotowe / wycelowane, lufy auto na celach.
    stats: { handTotal: 0, handReady: 0, handAligned: 0, autoTotal: 0, autoEngaged: 0, targets: 0 }
  };
}

/** Grupa w ręku, która naprawdę ma broń: wybrana, a bez niej special → main → missile. */
export function fcResolveInHand(fc, weapons) {
  const has = (g) => Array.isArray(weapons?.[g]) && weapons[g].length > 0;
  if (has(fc.inHand)) return fc.inHand;
  if (has('special')) return 'special';
  if (has('main')) return 'main';
  if (has('missile')) return 'missile';
  return null;
}

/** Bierze grupę w rękę. Zwraca true, gdy się zmieniła. */
export function fcSetInHand(fc, group, weapons) {
  if (!FC_GROUPS.includes(group)) return false;
  if (!(Array.isArray(weapons?.[group]) && weapons[group].length > 0)) return false;
  const changed = fc.inHand !== group;
  fc.inHand = group;
  return changed;
}

export function fcToggleAuto(fc, group) {
  if (!FC_GROUPS.includes(group)) return false;
  fc.auto[group] = !fc.auto[group];
  return fc.auto[group];
}

export function fcCyclePosture(fc, dir = 1) {
  const i = Math.max(0, FC_POSTURES.indexOf(fc.posture));
  fc.posture = FC_POSTURES[(i + (dir >= 0 ? 1 : FC_POSTURES.length - 1)) % FC_POSTURES.length];
  return fc.posture;
}

/** Stożek, w którym lufa „trafia” w cel o promieniu `radius` z odległości `dist` [rad]. */
export function fcAimTolerance(dist, radius, tune = FC_TUNE) {
  const tol = Math.atan2(Math.max(8, radius * 0.5), Math.max(1, dist));
  return tol < tune.aimTolMin ? tune.aimTolMin : (tol > tune.aimTolMax ? tune.aimTolMax : tol);
}

/**
 * Szansa trafienia 0..1 z czasu lotu pocisku: o ile cel może zejść z toru (½·a·t²) względem swojego
 * rozmiaru. Wiązka i cel nieruchomy = 1. Poniżej 0,05 działo nie strzela (armata 2500 j/s do fregaty
 * 5 km dalej to zmarnowany pocisk).
 */
export function fcHitFactor(weapon, dist, radius, kind, tune = FC_TUNE) {
  const speed = Number(weapon?.baseSpeed);
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  const accel = (tune.evadeAccel[kind] ?? tune.evadeAccel.other) * tune.evadeUse;
  if (accel <= 0) return 1;
  const t = dist / speed;
  const evade = 0.5 * accel * t * t;
  const size = Math.max(20, radius);
  const f = 1 - evade / (3 * size);
  return f < 0 ? 0 : (f > 1 ? 1 : f);
}

function wrapAngle(a) {
  const TAU = Math.PI * 2;
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function weaponDps(weapon) {
  const barrels = Math.max(1, Number(weapon?.barrelsPerShot) || 1);
  return (Number(weapon?.baseDamage) || 0) * barrels / Math.max(0.05, Number(weapon?.cooldown) || 1);
}

/**
 * Najlepszy cel dla wieży: najwyższa ocena wśród kandydatów w zasięgu (albo null).
 * `current` — obecny cel (lepkość), `fc._load` — Map cel → przydzielone obrażenia/s BEZ tej wieży,
 * `outward` — kierunek „na zewnątrz kadłuba” z miejsca wieży [rad] albo NaN: wieża woli cele po swojej
 * burcie, więc okręt otoczony z kilku stron bije kilka celów naraz (cel priorytetowy i tak wygrywa).
 * `arcHalf` — połowa łuku ostrzału wokół `outward` [rad] (src/game/weaponAim.js, MOUNT_ARCS): cel poza
 * łukiem odpada (także priorytetowy — tej wieży kadłub zasłania go). π = bez łuku.
 */
export function fcPickTarget(fc, weapon, baseX, baseY, turretAngle, current, env, tune = FC_TUNE, outward = NaN, arcHalf = Math.PI) {
  const range = env.rangeOf(weapon);
  const match = tune.classMatch[weapon?.size] || tune.classMatch.M;
  const focusOnly = fc.posture === 'focus';
  let best = null;
  let bestScore = -Infinity;
  const list = fc.candidates;
  for (let i = 0; i < fc.candidateCount; i++) {
    const c = list[i];
    const e = c.e;
    if (!env.alive(e)) continue;
    const prio = c.prio >= 0;
    if (focusOnly && !prio) continue;
    const dx = env.tx(e) - baseX;
    const dy = env.ty(e) - baseY;
    const r = env.tr(e);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > range + r) continue;
    const bearing = Math.atan2(dy, dx);
    if (arcHalf < Math.PI && outward === outward && Math.abs(wrapAngle(bearing - outward)) > arcHalf) continue;
    const hit = fcHitFactor(weapon, dist, r, c.kind, tune);
    // Cel priorytetowy bije się zawsze, gdy da się w niego trafić w ogóle; pozostałe — gdy szansa ma sens.
    if (hit < (prio ? 0.01 : 0.05)) continue;
    let score = tune.matchWeight * (match[c.kind] ?? match.other) * hit;
    if (prio) score += tune.priorityBonus - c.prio * 10;
    const threat = Number(c.threat) || 0;
    if (threat > 0) score += tune.threatWeight * (threat > 1 ? 1 : threat);
    const needMax = Number(c.needMax) || 0;
    if (needMax > c.need) score += tune.woundWeight * (1 - c.need / needMax);
    if (c.need < tune.killRef) score += tune.killWeight * (1 - c.need / tune.killRef);
    if (e === env.cursorTarget && env.trigger) score += tune.cursorBonus;
    if (e === current) score += tune.stickBonus;
    score -= Math.abs(wrapAngle(bearing - turretAngle)) * tune.anglePenalty;
    if (outward === outward) score -= Math.abs(wrapAngle(bearing - outward)) * tune.sidePenalty;
    score -= (dist / Math.max(1, range)) * tune.rangePenalty;
    if (!prio) {
      const load = fc._load.get(e) || 0;
      if (load > 0) {
        // Skupienie: póki przydzielony ogień nie wystarcza celowi, wieże dołączają; kara dopiero za nadmiar.
        const excess = (load * tune.overkillSeconds) / Math.max(1, c.need) - 1;
        if (excess > 0) score -= Math.min(1.5, excess) * tune.overkillPenalty;
        else score += tune.focusBonus;
      } else if (fc._load.size >= tune.maxTargets) {
        score -= tune.spreadPenalty;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * Wróg najbliżej punktu (kursor) w promieniu chwytu — do klawisza T i podświetlenia pod kursorem.
 * Liczy odległość do OBRYSU (środek − promień), więc duży okręt łapie się całym kadłubem.
 */
export function fcPickNearPoint(list, count, x, y, grab, env) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const e = list[i].e;
    if (!env.alive(e)) continue;
    const dx = env.tx(e) - x;
    const dy = env.ty(e) - y;
    const d = Math.sqrt(dx * dx + dy * dy) - env.tr(e);
    if (d > grab || d >= bestD) continue;
    bestD = d;
    best = e;
  }
  return best;
}

const _base = { x: 0, y: 0 };
const _vel = { x: 0, y: 0 };
const _point = { x: 0, y: 0 };

function barrelsOf(weapon) {
  const n = Math.round(Number(weapon?.barrelsPerShot));
  if (Number.isFinite(n) && n > 0) return n;
  return weapon?.size === 'L' ? 1 : 2;
}

// Przydzielony ogień: cel → suma obrażeń/s wież, które go trzymają (do kary za nadmiar).
function rebuildLoad(fc, env) {
  const load = fc._load;
  load.clear();
  const groups = env.weapons;
  for (let g = 0; g < 2; g++) {
    const list = groups[g === 0 ? 'main' : 'special'];
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const lo = list[i];
      if (!lo?.weapon || !lo.hp || lo.hp.destroyed) continue;
      const t = env.aimOf(lo).fcTarget;
      if (t) load.set(t, (load.get(t) || 0) + weaponDps(lo.weapon));
    }
  }
}

// Cel wieży na auto: obecny, dopóki żyje i jest w zasięgu, z ponowną oceną co scanInterval.
function resolveAutoTarget(fc, lo, aim, env, dt, tune, arc) {
  let target = aim.fcTarget || null;
  aim.fcScan = (aim.fcScan || 0) - dt;
  const weapon = lo.weapon;
  let stale = false;
  if (target) {
    if (!env.alive(target)) stale = true;
    else {
      const dx = env.tx(target) - _base.x;
      const dy = env.ty(target) - _base.y;
      const reach = env.rangeOf(weapon) + env.tr(target);
      if (dx * dx + dy * dy > reach * reach) stale = true;
      // Kadłub obrócił się i cel wyszedł z łuku tej wieży.
      else if (arc && arc.half < Math.PI && Math.abs(wrapAngle(Math.atan2(dy, dx) - env.heading - arc.center)) > arc.half) stale = true;
    }
  }
  if (stale || aim.fcScan <= 0) {
    if (target) {
      // Ocena bez własnego wkładu tej wieży w przydział.
      const left = (fc._load.get(target) || 0) - weaponDps(weapon);
      if (left > 1e-6) fc._load.set(target, left); else fc._load.delete(target);
    }
    target = arc
      ? fcPickTarget(fc, weapon, _base.x, _base.y, aim.angle, stale ? null : target, env, tune, env.heading + arc.center, arc.half)
      : fcPickTarget(fc, weapon, _base.x, _base.y, aim.angle, stale ? null : target, env, tune,
        env.outwardOf ? env.outwardOf(lo) : NaN);
    if (target) fc._load.set(target, (fc._load.get(target) || 0) + weaponDps(weapon));
    aim.fcTarget = target;
    aim.fcScan = tune.scanInterval + env.rnd() * tune.scanJitter;
  }
  return target;
}

/**
 * Krok kierowania ogniem: celowanie każdej wieży grup main / special / missile i strzały.
 * `env` — klej gry (opis pól: index.html, blok „KIEROWANIE OGNIEM”). Zwraca fc.stats.
 */
export function stepFireControl(fc, env, tune = FC_TUNE) {
  const dt = env.dt;
  const stats = fc.stats;
  stats.handTotal = stats.handReady = stats.handAligned = stats.autoTotal = stats.autoEngaged = stats.targets = 0;
  const inHand = fcResolveInHand(fc, env.weapons);
  const holding = fc.posture === 'hold' || env.silent;
  fc.rocketCd = Math.max(0, fc.rocketCd - dt);
  rebuildLoad(fc, env);

  // ---- działa: main i special ----
  for (let g = 0; g < 2; g++) {
    const group = g === 0 ? 'main' : 'special';
    const list = env.weapons[group];
    fc.turretCount[group] = 0;
    if (!list) continue;
    const hand = group === inHand;
    const autoOn = !hand && fc.auto[group] && !holding;
    for (let i = 0; i < list.length; i++) {
      const lo = list[i];
      const weapon = lo?.weapon;
      const hp = lo?.hp;
      if (weapon && hp && hp.destroyed && !env.skip(group, lo)) {
        writeTurret(fc, group, fc.turretCount[group]++, hp, FC_TURRET.DOWN, 0, 0, env.heading, hand);
        continue;
      }
      if (!weapon || !hp || hp.destroyed || env.skip(group, lo)) continue;
      const aim = env.aimOf(lo);
      env.baseOf(lo, _base);
      // Łuk ostrzału gniazda (układ kadłuba; null = 360°). Kurs kadłuba: env.heading.
      const arc = env.arcOf ? env.arcOf(group, lo) : null;
      if (group === 'main') hp.fcCd = Math.max(0, (Number(hp.fcCd) || 0) - dt);

      let target = null;
      let aimPoint = env.cursor;
      if (hand) {
        aim.fcTarget = null;
        // Lufy grupy w ręku celują w kursor. Gdy kursor leży przy wrogu (`snapTarget`), komputer dokłada
        // wyprzedzenie: punkt celowania = kursor + (punkt przechwycenia − cel), więc pocisk dolatuje tam,
        // gdzie gracz wskazał NA kadłubie, a nie tam, gdzie kadłub był w chwili strzału.
        const st = env.snapTarget;
        if (st && weapon.category !== 'beam' && env.alive(st)) {
          const lead = env.lead(_base, st, env.speedOf(weapon), env.velAt(_base.x, _base.y, _vel));
          _point.x = env.cursor.x + (lead.x - env.tx(st));
          _point.y = env.cursor.y + (lead.y - env.ty(st));
          aimPoint = _point;
          target = st;
        }
      } else if (autoOn) {
        target = resolveAutoTarget(fc, lo, aim, env, dt, tune, arc);
        if (target) {
          if (weapon.category === 'beam') {
            _point.x = env.tx(target);
            _point.y = env.ty(target);
            aimPoint = _point;
          } else {
            aimPoint = env.lead(_base, target, env.speedOf(weapon), env.velAt(_base.x, _base.y, _vel));
          }
        }
      } else {
        aim.fcTarget = null;
      }
      aim.target = target;
      env.aim(lo, aim, _base, aimPoint, dt, arc);

      // Reszta salwy wielolufowej działa głównego (lufy co salvoStep).
      if (group === 'main' && hp.fcBarrels > 0) {
        hp.fcBarrelT -= dt;
        if (hp.fcBarrelT <= 0) {
          if (env.canFire) {
            env.fireMain(i, lo, env.alive(aim.target) ? aim.target : null, hp.fcBarrelNext % barrelsOf(weapon), !hand);
          }
          hp.fcBarrelNext++;
          hp.fcBarrels--;
          hp.fcBarrelT += tune.salvoStep;
        }
      }

      const ready = group === 'main' ? hp.fcCd <= 0 : !(Number(hp.specialCd) > 0);
      const left = group === 'main' ? Math.max(0, Number(hp.fcCd) || 0) : Math.max(0, Number(hp.specialCd) || 0);
      const charging = aim.charge && aim.charge.charge >= 0;
      // Broń z postoju (Mjolnir) w ruchu nie zacznie ładowania — wieża w osobnym stanie, żeby gracz wiedział czemu.
      const still = weapon.requiresStationary === true && env.stationary === false;
      if (hand) {
        stats.handTotal++;
        const aligned = aim.aimErr <= tune.handTol;
        if (ready) stats.handReady++;
        if (ready && aligned) stats.handAligned++;
        // Punkt celowania poza łukiem wieży (kadłub zasłania) — wieża tam nie strzeli.
        let outside = false;
        if (arc && arc.half < Math.PI) {
          const b = Math.atan2(aimPoint.y - _base.y, aimPoint.x - _base.x);
          outside = Math.abs(wrapAngle(b - env.heading - arc.center)) > arc.half + 1e-6;
        }
        const st = charging ? FC_TURRET.CHARGE
          : !ready ? FC_TURRET.RELOAD
          : outside ? FC_TURRET.NO_ARC
          : still ? FC_TURRET.STILL
          : aligned ? FC_TURRET.READY : FC_TURRET.TRAVERSE;
        const t = writeTurret(fc, group, fc.turretCount[group]++, hp, st, left, Number(weapon.cooldown) || 0, aim.angle, true, arc);
        if (charging) t.progress = Math.max(0, Math.min(1, Number(aim.charge.u) || 0));
        if (!env.trigger || !env.canFire || env.silentHand || !ready || !aligned) continue;
        if (group === 'main') fireMainNow(hp, i, lo, target, false, env, tune);
        else if (env.chargeTime(weapon) > 0) env.chargeSpecial(i, lo, true);
        else env.fireSpecial(i, lo, false);
        continue;
      }

      stats.autoTotal++;
      {
        const engaged = !!target && aim.aimErr <= tune.aimTolMax;
        const st = charging ? FC_TURRET.CHARGE
          : !ready ? FC_TURRET.RELOAD
          : !target ? FC_TURRET.IDLE
          : still ? FC_TURRET.STILL
          : engaged ? FC_TURRET.READY : FC_TURRET.TRAVERSE;
        const t = writeTurret(fc, group, fc.turretCount[group]++, hp, st, left, Number(weapon.cooldown) || 0, aim.angle, false, arc);
        if (charging) t.progress = Math.max(0, Math.min(1, Number(aim.charge.u) || 0));
      }
      if (!target) continue;
      stats.autoEngaged++;
      if (!env.canFire || !ready) continue;
      const dx = env.tx(target) - _base.x;
      const dy = env.ty(target) - _base.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (aim.aimErr > fcAimTolerance(dist, env.tr(target), tune)) continue;
      if (env.blocked(target, env.rangeOf(weapon))) {
        // Sojusznik na linii ognia: puść cel i poszukaj innego przy najbliższej ocenie.
        aim.fcScan = 0;
        continue;
      }
      if (group === 'main') fireMainNow(hp, i, lo, target, true, env, tune);
      else if (env.chargeTime(weapon) > 0) env.chargeSpecial(i, lo, false);
      else env.fireSpecial(i, lo, true);
    }
  }
  stats.targets = fc._load.size;

  // ---- rakiety ----
  const missiles = env.weapons.missile;
  if (missiles && missiles.length && env.canFire) {
    const hand = inHand === 'missile';
    if (hand) {
      if (env.trigger && !env.silentHand && fc.rocketCd <= 0) {
        if (env.fireMissile(env.priority.length ? env.priority[0] : env.cursorTarget)) fc.rocketCd = tune.rocketInterval;
      }
    } else if (fc.auto.missile && !holding && fc.rocketCd <= 0) {
      stepAutoMissiles(fc, env, tune, missiles);
    }
  }
  return stats;
}

// Rakiety na auto: najwyżej jedna salwa na krok (odstęp rocketInterval), wyrzutnie po kolei.
function stepAutoMissiles(fc, env, tune, list) {
  const n = list.length;
  let incoming = false;
  for (let k = 0; k < n; k++) {
    const idx = (fc._missileNext + k) % n;
    const lo = list[idx];
    if (!lo?.weapon || !lo.hp || !env.missileReady(lo)) continue;
    if (!incoming) {
      // Rakiety w locie i w kolejkach salw — także te z poprzednich kroków (budżet celu).
      if (env.missileIncoming) env.missileIncoming(fc._incoming); else fc._incoming.clear();
      incoming = true;
    }
    const count = fcPlanMissileSalvo(fc, lo, env, tune);
    if (count <= 0) continue;
    if (!env.fireMissileSalvo(lo, fc._salvoTargets, count)) continue;
    fc.rocketCd = tune.rocketInterval;
    fc._missileNext = (idx + 1) % n;
    return;
  }
}

/**
 * Plan salwy wyrzutni `lo` na auto: cele per rakieta w `fc._salvoTargets[0..count)`. Zwraca liczbę
 * rakiet albo 0 (nic wartego salwy w zasięgu). Kandydaci: cele priorytetowe, a w postawie
 * „ogień swobodny” także wrogowie z zagrożeniem (`threat` > 0 — strzelają do gracza albo jego
 * skrzydła; uśpionych i biernych rakiety same nie biją). Każdy cel dostaje tyle rakiet, ile
 * brakuje mu po odjęciu rakiet już w locie (`fc._incoming`), najlepsze cele pierwsze; reszta
 * salwy (wszystko pokryte) — na cel z największą potrzebą.
 */
export function fcPlanMissileSalvo(fc, lo, env, tune = FC_TUNE) {
  const weapon = lo.weapon;
  const count = Math.min(64, fcSalvoSize(weapon));
  const per = Math.max(1, env.missileDamage ? env.missileDamage(weapon) : fcMissileDamage(weapon));
  const range = env.rangeOf(weapon);
  const match = tune.missileMatch[fcMissileRole(weapon)];
  const focusOnly = fc.posture === 'focus';
  const cap = Math.max(1, tune.missileSplitMax | 0);
  const pickE = fc._pickE, pickScore = fc._pickScore, pickRem = fc._pickRem, pickNeed = fc._pickNeed;
  env.baseOf(lo, _base);
  let m = 0;
  const list = fc.candidates;
  for (let i = 0; i < fc.candidateCount; i++) {
    const c = list[i];
    const e = c.e;
    if (!env.alive(e)) continue;
    const prio = c.prio >= 0;
    if (focusOnly && !prio) continue;
    const threat = Number(c.threat) || 0;
    if (!prio && !(threat > 0)) continue;
    const fit = match[c.kind] ?? match.other;
    if (!prio && fit < tune.missileMinMatch) continue;
    const dx = env.tx(e) - _base.x;
    const dy = env.ty(e) - _base.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > range + env.tr(e)) continue;
    const need = Math.max(1, Number(c.need) || 1) * tune.missileMargin;
    const rem = need - (fc._incoming.get(e) || 0);
    if (rem < per * 0.5) continue;   // pokryty rakietami w locie
    let score = tune.matchWeight * fit;
    if (prio) score += tune.priorityBonus - c.prio * 10;
    if (threat > 0) score += tune.threatWeight * (threat > 1 ? 1 : threat);
    const needMax = Number(c.needMax) || 0;
    if (needMax > c.need) score += tune.woundWeight * (1 - c.need / needMax);
    if (c.need < tune.killRef) score += tune.killWeight * (1 - c.need / tune.killRef);
    score -= (dist / Math.max(1, range)) * tune.rangePenalty;
    // Wstawienie do listy najlepszych (malejąco), najwyżej `cap` celów.
    let at = m;
    while (at > 0 && pickScore[at - 1] < score) at--;
    if (at >= cap) continue;
    const last = m < cap ? m : cap - 1;
    for (let j = last; j > at; j--) {
      pickE[j] = pickE[j - 1];
      pickScore[j] = pickScore[j - 1];
      pickRem[j] = pickRem[j - 1];
      pickNeed[j] = pickNeed[j - 1];
    }
    pickE[at] = e;
    pickScore[at] = score;
    pickRem[at] = rem;
    pickNeed[at] = need;
    if (m < cap) m++;
  }
  if (m === 0) return 0;
  const out = fc._salvoTargets;
  let k = 0;
  let used = 0;
  let useful = 0;
  for (let i = 0; i < m && k < count; i++) {
    const take = Math.min(count - k, Math.ceil(pickRem[i] / per));
    for (let j = 0; j < take; j++) out[k++] = pickE[i];
    useful += Math.min(take * per, pickRem[i]);
    used++;
  }
  // Salwa w cele prawie pokryte (dobijanie jednym Gradem) — zostaje w wyrzutni; dobiją działa.
  if (useful < tune.missileMinUse * count * per) {
    for (let j = 0; j < k; j++) out[j] = null;
    for (let i = 0; i < m; i++) pickE[i] = null;
    return 0;
  }
  if (k < count) {
    let big = 0;
    for (let i = 1; i < m; i++) if (pickNeed[i] > pickNeed[big]) big = i;
    while (k < count) out[k++] = pickE[big];
  }
  fc.lastSalvo.targets = used;
  fc.lastSalvo.rockets = count;
  for (let i = 0; i < m; i++) pickE[i] = null;
  return count;
}

function fireMainNow(hp, index, lo, target, auto, env, tune) {
  const weapon = lo.weapon;
  const barrels = barrelsOf(weapon);
  const start = Number(hp.fcBarrelStart) || 0;
  hp.fcBarrelStart = (start + 1) % barrels;
  const cd = env.fireMain(index, lo, target, start, auto);
  const base = Math.max(0.02, Number(cd) || Number(weapon.cooldown) || 0.25);
  hp.fcCd = auto ? base * (1 - tune.cdJitter * 0.5 + env.rnd() * tune.cdJitter) : base;
  if (barrels > 1) {
    hp.fcBarrels = barrels - 1;
    hp.fcBarrelNext = start + 1;
    hp.fcBarrelT = tune.salvoStep;
  } else {
    hp.fcBarrels = 0;
  }
}
