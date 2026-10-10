// src/game/engineIgnition.js
//
// ODPALANIE I GASZENIE SILNIKÓW GŁÓWNYCH (etap E2 2026-10-09, prośba użytkownika: „dym z silnika przy odpalaniu — coś jak
// rakieta: najpierw idzie dym, potem się zapala; będzie fajny efekt w doku — i mechanika odpalania / gaszenia silnika,
// dosyć prosta”).
//
// Automat stanów silników MAIN okrętu (wszystkie dysze MAIN razem — jeden przełącznik na okręt):
//
//   WYŁĄCZONE ──zapłon──▶ ZAPŁON ──(dym smokeTime, błysk, struga narasta flameTime)──▶ PRACA
//       ▲                    │ gaszenie przed błyskiem → WYŁĄCZONE                       │
//       │                    └ gaszenie po błysku → GASZENIE (od mocy strugi)            │ gaszenie
//       └────────────(shutdownTime: ciąg i struga spadają do zera)──── GASZENIE ◀──────────┘
//                                         └ zapłon w trakcie gaszenia = GORĄCY zapłon (bez dymu, od błysku)
//
// Rozgrywka (czyta gra): WYŁĄCZONE i ZAPŁON — brak ciągu głównego (dysze SIDE / RCS działają, jak przy zniszczonym
// napędzie — engineDamage.js), skok (warp, TRAVEL TO) i szarża zablokowane; GASZENIE — ciąg spada do zera.
// Obraz (czyta render): moc strugi MAIN (`enginePlumeScale` — 0 do błysku, potem narasta) i znacznik zapłonu
// (`serial`, `state`, `t`) — dym zapłonu i resztkowy dym gaszenia (src/3d/explosions/explosionFx.js, gaz z siatki 3D).
//
// Stan na encji: `entity.engineIgn` (stały kształt obiektu). Encja BEZ stanu = silniki zawsze w PRACY (NPC poza wylotem
// z doku, stare zapisy, dema). Czas = czas gry (krok fizyki; pauza i sceny fabuły stoją). Bez three i DOM (testy node).

export const ENGINE_OFF = 0;
export const ENGINE_IGNITION = 1;
export const ENGINE_RUNNING = 2;
export const ENGINE_SHUTDOWN = 3;

/** Strojenie (konsola: window.EngineIgnitionTune). Czasy [s] czasu gry. */
export const ENGINE_IGNITION_TUNE = {
  smokeTime: 1.1,      // ZAPŁON: zimny dym z dysz przed błyskiem
  flameTime: 0.7,      // ZAPŁON: od błysku do pełnej pracy (struga MAIN narasta)
  shutdownTime: 1.0,   // GASZENIE: ciąg i struga spadają do zera, z dysz resztkowy dym
  autoIgnite: true,    // ciąg (W / S, gałka) przy wyłączonych silnikach odpala zapłon
  flameKick: 0.6,      // rozbłysk strugi w płomieniu zapłonu (dolna granica mocy strugi, potem jałowa / pilot)
  smokeFlow: 0.45      // przepływ zimnego gazu z dysz w dymie zapłonu (× ciąg pełny) — pole gazu hali K-7 (pył 2D)
};

/** Pełny zapłon z WYŁĄCZONYCH (dym + płomień) [s] — wylot z doku zaczyna zapłon tyle przed startem. */
export function engineIgnitionDuration(T = ENGINE_IGNITION_TUNE) {
  return T.smokeTime + T.flameTime;
}

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Nowy stan silników (domyślnie w PRACY). */
export function createEngineIgnition(running = true) {
  return {
    state: running ? ENGINE_RUNNING : ENGINE_OFF,
    t: 0,          // czas w bieżącym stanie [s]
    serial: 0,     // rośnie przy każdym wejściu w ZAPŁON albo GASZENIE (obraz: jeden dym na przejście)
    hot: false     // ZAPŁON bez dymu (gorący — z gaszenia)
  };
}

/** Stan silników encji (tworzy go przy pierwszym użyciu). */
export function engineIgnitionOf(entity, running = true) {
  if (!entity) return null;
  if (!entity.engineIgn) entity.engineIgn = createEngineIgnition(running);
  return entity.engineIgn;
}

/** Stan (ENGINE_*) — encja bez stanu = PRACA. */
export function engineStateOf(entity) {
  const s = entity?.engineIgn;
  return s ? s.state : ENGINE_RUNNING;
}

/** Silniki w pełnej PRACY (encja bez stanu też). */
export function engineRunning(entity) {
  const s = entity?.engineIgn;
  return !s || s.state === ENGINE_RUNNING;
}

/** Czas od początku ZAPŁONU do błysku [s] (gorący zapłon — 0). */
function flashAt(s, T) {
  return s.hot ? 0 : T.smokeTime;
}

/**
 * Mnożnik ciągu głównego 0..1: WYŁĄCZONE i ZAPŁON — 0, PRACA — 1, GASZENIE — spada gładko do 0.
 * Encja bez stanu — 1.
 */
export function engineThrustScale(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s) return 1;
  switch (s.state) {
    case ENGINE_RUNNING: return 1;
    case ENGINE_SHUTDOWN: return 1 - smooth(s.t / Math.max(1e-3, T.shutdownTime));
    default: return 0;
  }
}

/**
 * Moc strugi MAIN 0..1 (obraz): ZAPŁON — 0 do błysku, potem narasta przez flameTime; PRACA — 1; GASZENIE — gaśnie
 * (szybciej niż ciąg na początku — struga „zwija się” do dyszy); WYŁĄCZONE — 0. Encja bez stanu — 1.
 */
export function enginePlumeScale(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s) return 1;
  switch (s.state) {
    case ENGINE_RUNNING: return 1;
    case ENGINE_IGNITION: {
      const u = (s.t - flashAt(s, T)) / Math.max(1e-3, T.flameTime);
      return smooth(u);
    }
    case ENGINE_SHUTDOWN: {
      const u = 1 - s.t / Math.max(1e-3, T.shutdownTime);
      return u <= 0 ? 0 : u * u;
    }
    default: return 0;
  }
}

/**
 * Rozbłysk strugi przy zapłonie 0..1 (obraz): w płomieniu zapłonu struga MAIN na chwilę mocniejsza niż jałowa (silnik
 * „łapie” — potem opada do tego, czego chce pilot); dolna granica mocy strugi, nie ciąg.
 */
export function engineIgnitionKick(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s || s.state !== ENGINE_IGNITION) return 0;
  const u = (s.t - flashAt(s, T)) / Math.max(1e-3, T.flameTime);
  if (u <= 0) return 0;
  return T.flameKick * smooth(Math.min(1, u * 4)) * (1 - 0.65 * Math.min(1, u));
}

/** Skok (warp, TRAVEL TO) i szarża wymagają silników w PRACY. */
export function engineBlocksDrive(entity) {
  const s = entity?.engineIgn;
  return !!s && s.state !== ENGINE_RUNNING;
}

/**
 * ZAPŁON. Z WYŁĄCZONYCH — od dymu; z GASZENIA — gorący (od błysku, struga od bieżącej mocy). W ZAPŁONIE / PRACY — nic.
 * Zwraca true, gdy sekwencja ruszyła.
 */
export function igniteEngine(entity, T = ENGINE_IGNITION_TUNE) {
  const s = engineIgnitionOf(entity);
  if (!s) return false;
  if (s.state === ENGINE_OFF) {
    s.state = ENGINE_IGNITION; s.t = 0; s.hot = false; s.serial++;
    return true;
  }
  if (s.state === ENGINE_SHUTDOWN) {
    // Gorący zapłon: struga wraca od mocy, na której gaśnie (bez skoku obrazu).
    const p = enginePlumeScale(entity, T);
    s.state = ENGINE_IGNITION; s.hot = true; s.serial++;
    s.t = inverseSmooth(p) * T.flameTime;
    return true;
  }
  return false;
}

/**
 * GASZENIE. Z PRACY — od pełnej mocy; z ZAPŁONU przed błyskiem — od razu WYŁĄCZONE (dym, który już leci, dogasa sam);
 * po błysku — GASZENIE od bieżącej mocy strugi. Zwraca true, gdy coś się zmieniło.
 */
export function shutdownEngine(entity, T = ENGINE_IGNITION_TUNE) {
  const s = engineIgnitionOf(entity);
  if (!s) return false;
  if (s.state === ENGINE_RUNNING) {
    s.state = ENGINE_SHUTDOWN; s.t = 0; s.hot = false; s.serial++;
    return true;
  }
  if (s.state === ENGINE_IGNITION) {
    const p = enginePlumeScale(entity, T);
    if (p <= 0) { s.state = ENGINE_OFF; s.t = 0; s.hot = false; return true; }
    s.state = ENGINE_SHUTDOWN; s.hot = false; s.serial++;
    s.t = (1 - Math.sqrt(p)) * T.shutdownTime;
    return true;
  }
  return false;
}

/** Przełącznik: PRACA / ZAPŁON → gaszenie, WYŁĄCZONE / GASZENIE → zapłon. */
export function toggleEngine(entity, T = ENGINE_IGNITION_TUNE) {
  const st = engineStateOf(entity);
  return (st === ENGINE_RUNNING || st === ENGINE_IGNITION) ? shutdownEngine(entity, T) : igniteEngine(entity, T);
}

/** Stan od razu (start w doku — WYŁĄCZONE, statek na pokładzie holownika, dema), bez sekwencji i bez dymu. */
export function setEngineState(entity, state) {
  const s = engineIgnitionOf(entity);
  if (!s) return;
  s.state = state === ENGINE_RUNNING || state === ENGINE_IGNITION || state === ENGINE_SHUTDOWN ? state : ENGINE_OFF;
  s.t = 0;
  s.hot = false;
}

/** Krok automatu (czas gry): ZAPŁON → PRACA, GASZENIE → WYŁĄCZONE. */
export function stepEngineIgnition(entity, dt, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s || !(dt > 0)) return;
  if (s.state === ENGINE_IGNITION) {
    s.t += dt;
    if (s.t >= flashAt(s, T) + T.flameTime) { s.state = ENGINE_RUNNING; s.t = 0; s.hot = false; }
  } else if (s.state === ENGINE_SHUTDOWN) {
    s.t += dt;
    if (s.t >= T.shutdownTime) { s.state = ENGINE_OFF; s.t = 0; }
  } else {
    s.t += dt;
  }
}

/**
 * Przepływ gazu z dysz POZA strugą 0..1 (pył hal K-7 — gasField2D): dym zapłonu przed błyskiem (narasta 0,2 s) i resztki
 * przy gaszeniu; po błysku przepływ daje moc strugi (EngineFrame.power).
 */
export function engineSmokeFlow(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s) return 0;
  if (s.state === ENGINE_IGNITION && s.t < flashAt(s, T)) return T.smokeFlow * smooth(s.t / 0.2);
  if (s.state === ENGINE_SHUTDOWN) return T.smokeFlow * 0.7 * (1 - smooth(s.t / Math.max(1e-3, T.shutdownTime)));
  return 0;
}

/** Faza obrazu ZAPŁONU: 0 — dym (przed błyskiem), 1 — płomień (po błysku); poza zapłonem −1. */
export function ignitionPhase(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s || s.state !== ENGINE_IGNITION) return -1;
  return s.t < flashAt(s, T) ? 0 : 1;
}

/** Napis HUD (kokpit, sylwetka): null w PRACY, inaczej „WYŁ.” / „ZAPŁON” / „GASZENIE”. */
export function engineHudLabel(entity) {
  switch (engineStateOf(entity)) {
    case ENGINE_OFF: return 'WYŁ.';
    case ENGINE_IGNITION: return 'ZAPŁON';
    case ENGINE_SHUTDOWN: return 'GASZENIE';
    default: return null;
  }
}

/** Postęp zapłonu / gaszenia 0..1 (HUD). */
export function engineSequenceProgress(entity, T = ENGINE_IGNITION_TUNE) {
  const s = entity?.engineIgn;
  if (!s) return 1;
  if (s.state === ENGINE_IGNITION) return Math.min(1, s.t / Math.max(1e-3, flashAt(s, T) + T.flameTime));
  if (s.state === ENGINE_SHUTDOWN) return Math.min(1, s.t / Math.max(1e-3, T.shutdownTime));
  return s.state === ENGINE_RUNNING ? 1 : 0;
}

/** Odwrotność smoothstep na [0, 1] (gorący zapłon: czas, przy którym rampa daje moc p). */
function inverseSmooth(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // smoothstep(u) = 3u² − 2u³ — rozwiązanie na [0, 1]: u = ½ − sin(asin(1 − 2p) / 3)
  return 0.5 - Math.sin(Math.asin(1 - 2 * p) / 3);
}

if (typeof window !== 'undefined') window.EngineIgnitionTune = ENGINE_IGNITION_TUNE;
