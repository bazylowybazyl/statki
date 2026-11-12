// src/game/shipAlarms.js
//
// ALARMY OKRĘTU GRACZA (2026-11-11, prośba użytkownika: „syreny alarmowe — np. low-hp”). Szyna po stronie gry: gra
// co krok podaje WARUNKI (`setAlarmCondition`), szyna wybiera JEDEN alarm o najwyższym priorytecie i daje:
//   • stan `state` (czytany co klatkę: obraz — koguty na kadłubie, czerwona ramka HUD; dźwięk — sesja dźwięków),
//   • zdarzenia `on(fn)` przy zmianie alarmu (fn({ id, name, label, priority, active, since })).
// Decyzja użytkownika 2026-11-11: jeden alarm naraz (priorytet), po kilku sekundach ciszej (`state.volume` opada do
// `quietLevel` po `quietAfter` s; nowy, ważniejszy alarm zaczyna głośno od nowa).
// Szyna nie gra dźwięku i nie rysuje — tylko stan. Czas = czas gry (pauza stoi). Czysty moduł: bez three, DOM i `window`.

/** Id alarmów (stałe — kod idzie do renderu w migawce: ENT.ALARM). */
export const SHIP_ALARM = Object.freeze({
  NONE: 0,
  REACTOR: 1,   // rdzeń reaktora krytyczny (stopienie / odliczanie detonacji)
  HULL: 2,      // kadłub poniżej progu (25%)
  MISSILE: 3,   // rakieta lub torpeda z namiarem na gracza
  BRIDGE: 4,    // mostek trafiony (integralność spada)
  SHIELD: 5,    // tarcza się zapadła
  DETECTED: 6   // wróg wykrył okręt (strona wroga ma gracza jako widoczny kontakt)
});

/** Opis alarmów: priorytet (większy wygrywa), nazwa (id dźwięku / klucz), napis HUD, barwa kogutów. */
export const SHIP_ALARM_INFO = Object.freeze({
  [SHIP_ALARM.REACTOR]: { name: 'reaktor', label: 'REAKTOR KRYTYCZNY', priority: 100, color: '#ff3020' },
  [SHIP_ALARM.HULL]: { name: 'kadlub', label: 'KADŁUB KRYTYCZNY', priority: 80, color: '#ff3a26' },
  [SHIP_ALARM.MISSILE]: { name: 'rakieta', label: 'RAKIETA NA KURSIE', priority: 70, color: '#ff8a1e' },
  [SHIP_ALARM.BRIDGE]: { name: 'mostek', label: 'MOSTEK TRAFIONY', priority: 60, color: '#ff5a2a' },
  [SHIP_ALARM.SHIELD]: { name: 'tarcza', label: 'TARCZA ZAPADNIĘTA', priority: 50, color: '#ffb02a' },
  [SHIP_ALARM.DETECTED]: { name: 'wykryty', label: 'WYKRYTY', priority: 40, color: '#ffc24a' }
});

/** Strojenie (konsola: window.ShipAlarmTune). */
export const SHIP_ALARM_TUNE = {
  quietAfter: 4.0,    // [s] po tylu sekundach tego samego alarmu dźwięk i obraz ciszej
  quietLevel: 0.35,   // poziom po wyciszeniu (0..1)
  quietFade: 1.5,     // [s] przejście do cichszego poziomu
  hold: 1.0,          // [s] alarm trwa jeszcze tyle po zniknięciu warunku (bez migotania na progu)
  hullFrac: 0.25,     // próg kadłuba
  bridgeHold: 6.0     // [s] alarm mostka po trafieniu
};

const ALARM_COUNT = 7;

/** Nowa szyna alarmów. */
export function createShipAlarms() {
  return {
    cond: new Float64Array(ALARM_COUNT),   // czas gry, do którego warunek trwa (−1 — nie trwa)
    state: { id: SHIP_ALARM.NONE, name: '', label: '', priority: 0, color: '', active: false, since: 0, volume: 0, age: 0 },
    listeners: [],
    time: 0,
    serial: 0
  };
}

/** Warunek alarmu `id` w tej chwili (`on`: trwa / nie trwa). `holdSec` — jak długo trwa po ostatnim zgłoszeniu. */
export function setAlarmCondition(bus, id, on, holdSec = SHIP_ALARM_TUNE.hold) {
  if (!bus || !(id > 0 && id < ALARM_COUNT)) return;
  if (on) {
    const until = bus.time + Math.max(0, holdSec);
    if (until > bus.cond[id]) bus.cond[id] = until;
  }
}

/** Zgaś wszystkie warunki (śmierć, nowy statek, menu). */
export function clearShipAlarms(bus) {
  if (!bus) return;
  bus.cond.fill(-1);
}

/** Słuchacz zmian alarmu. Zwraca funkcję odpięcia. */
export function onShipAlarm(bus, fn) {
  if (!bus || typeof fn !== 'function') return () => {};
  bus.listeners.push(fn);
  return () => {
    const i = bus.listeners.indexOf(fn);
    if (i >= 0) bus.listeners.splice(i, 1);
  };
}

/** Krok szyny (czas gry). Wybiera alarm o najwyższym priorytecie spośród trwających; zdarzenie przy zmianie. */
export function stepShipAlarms(bus, dt, T = SHIP_ALARM_TUNE) {
  if (!bus) return;
  if (dt > 0) bus.time += dt;
  let best = SHIP_ALARM.NONE, bestP = -1;
  for (let id = 1; id < ALARM_COUNT; id++) {
    if (bus.cond[id] >= bus.time) {
      const p = SHIP_ALARM_INFO[id].priority;
      if (p > bestP) { bestP = p; best = id; }
    }
  }
  const st = bus.state;
  if (best !== st.id) {
    st.id = best;
    st.active = best !== SHIP_ALARM.NONE;
    const info = st.active ? SHIP_ALARM_INFO[best] : null;
    st.name = info ? info.name : '';
    st.label = info ? info.label : '';
    st.priority = info ? info.priority : 0;
    st.color = info ? info.color : '';
    st.since = bus.time;
    bus.serial++;
    const ev = { id: st.id, name: st.name, label: st.label, priority: st.priority, active: st.active, since: st.since };
    for (let i = 0; i < bus.listeners.length; i++) {
      try { bus.listeners[i](ev); } catch (err) { /* słuchacz nie może zatrzymać gry */ }
    }
  }
  st.age = st.active ? bus.time - st.since : 0;
  st.volume = st.active ? alarmVolumeAt(st.age, T) : 0;
}

/** Głośność / jasność alarmu po `age` s: pełna, po `quietAfter` łagodnie do `quietLevel`. */
export function alarmVolumeAt(age, T = SHIP_ALARM_TUNE) {
  if (!(age > T.quietAfter)) return 1;
  const u = Math.min(1, (age - T.quietAfter) / Math.max(1e-3, T.quietFade));
  return 1 + (T.quietLevel - 1) * u * u * (3 - 2 * u);
}

/** Szyna gry (jedna na stronę) — gra pisze warunki, obraz i dźwięk czytają `ShipAlarm.state` / `ShipAlarm.on(fn)`. */
export const ShipAlarm = (() => {
  const bus = createShipAlarms();
  clearShipAlarms(bus);
  return {
    bus,
    get state() { return bus.state; },
    set: (id, on, holdSec) => setAlarmCondition(bus, id, on, holdSec),
    clear: () => clearShipAlarms(bus),
    step: (dt) => stepShipAlarms(bus, dt),
    on: (fn) => onShipAlarm(bus, fn),
    ids: SHIP_ALARM,
    info: SHIP_ALARM_INFO,
    tune: SHIP_ALARM_TUNE
  };
})();

if (typeof window !== 'undefined') { window.ShipAlarm = ShipAlarm; window.ShipAlarmTune = SHIP_ALARM_TUNE; }
