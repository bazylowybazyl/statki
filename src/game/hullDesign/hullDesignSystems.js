// src/game/hullDesign/hullDesignSystems.js
//
// KREATOR KADŁUBÓW — SIEĆ SYSTEMÓW: kto z kim (czysta: bez three i DOM; testy tests/hullDesignNetwork.test.mjs).
// Trasy liczy src/game/hullDesign/hullDesignPipes.js, rysuje kompozytor (src/3d/hullDesign/hullComposer.js).
//
// Dwie sieci (prośba użytkownika 2026-10-20: „kable idą od rdzenia do każdego elementu statku — rdzeń daje prąd;
// rury idą od zbiornika przez reaktor do silników MAIN i bocznych”, nic nie kończy się „donikąd”):
//
//   PALIWO (rury)    — DOPŁYW: każdy zbiornik paliwa → najbliższy reaktor; ZASILANIE SILNIKÓW: reaktor → każda
//                      gondola MAIN i każda dysza SIDE (najbliższy reaktor). Paliwo idzie do silników przez rdzeń.
//   PRĄD (kable)     — reaktor → każde URZĄDZENIE (najbliższy reaktor).
//
// URZĄDZENIA (pobór prądu, HD_POWER_LOAD — waga trasy = kabli w wiązce do urządzenia): wieże i gniazda broni
// (`mount`; pobór w MW i bilans mocy rdzenia — src/data/shipClasses.js, hullDesignClass.js), mostek, gondola MAIN, dysza SIDE, zbiornik paliwa (pompa), wrota hangaru, ładownia, pierścień i iluminatory
// (`well` — studnia, światło, czujniki), luk ładunkowy (`hatch` v 0 — napędzany). NIE są urządzeniami: kratki
// (`vent` — wentylacja bierna), klapy serwisowe TN (`hatch` v 1 — pokrywy otwierane ręcznie), naklejki, rowki, rury
// ręczne; reaktor jest źródłem.

/** Rola modułu w sieci systemów: źródło prądu i węzeł paliwa, zbiornik, silnik MAIN, dysza SIDE. */
export const HD_SYSTEM_ROLE = Object.freeze({ reactor: 'core', fuel_tank: 'tank', engine: 'main', thruster_side: 'side' });

/** Moduły systemów, które preset stawia na stałym miejscu klasy i kadłuba (blokada w edytorze). */
export const HD_SYSTEM_TYPES = Object.freeze(['reactor', 'bridge', 'engine', 'fuel_tank', 'thruster_side', 'cargo']);

/** Pobór prądu na typ modułu (kabli w trasie do urządzenia). */
export const HD_POWER_LOAD = Object.freeze({
  turret_s: 1, turret_m: 1, turret_l: 2, bridge: 2, engine: 1, thruster_side: 1, fuel_tank: 1,
  hangar: 1, cargo: 1, well: 1, hatch: 1, mount: 1
});

/** Waga trasy paliwa (rur w wiązce do odbiornika): gondola MAIN — zasilanie, powrót, chłodzenie dyszy. */
export const HD_FUEL_LOAD = Object.freeze({ engine: 3, thruster_side: 1, fuel_tank: 3 });

/** Urządzenie pobierające prąd (klapa serwisowa TN — `hatch` v 1 — nie). */
export function powerLoad(m) {
  if (m.type === 'hatch' && (m.v || 0) >= 1) return 0;
  // gniazdo broni L / Capital — gruby kabel jak wieża L
  if (m.type === 'mount' && (m.size === 'L' || m.size === 'Capital')) return 2;
  return HD_POWER_LOAD[m.type] || 0;
}

/** Odbiornik paliwa (MAIN / SIDE) albo zbiornik — waga trasy rur; 0 — moduł spoza sieci paliwa. */
export function fuelLoad(m) {
  return HD_FUEL_LOAD[m.type] || 0;
}

const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/**
 * Graf systemów z listy modułów (rozwiniętych: expandHullDesign → modules, kopie lustra osobno). Zwraca { cores,
 * tanks, mains, sides, consumers (indeksy modułów), links: [{ net: 'supply' | 'feed' | 'power', from, to, load }],
 * issues: [{ level: 'bad' | 'warn', code, text }] }. Krawędź `from` → `to` w kierunku przepływu (zbiornik → reaktor,
 * reaktor → silnik, reaktor → urządzenie); reaktor — najbliższy (przy kilku).
 */
export function hullDesignSystems(modules) {
  const cores = [], tanks = [], mains = [], sides = [], consumers = [];
  modules.forEach((m, i) => {
    const role = HD_SYSTEM_ROLE[m.type];
    if (role === 'core') cores.push(i);
    else if (role === 'tank') tanks.push(i);
    else if (role === 'main') mains.push(i);
    else if (role === 'side') sides.push(i);
    if (powerLoad(m) > 0) consumers.push(i);
  });
  const nearestCore = (i) => {
    let best = -1, bv = Infinity;
    for (const c of cores) { const v = dist2(modules[i], modules[c]); if (v < bv - 1e-9) { bv = v; best = c; } }
    return best;
  };
  const links = [];
  if (cores.length) {
    for (const t of tanks) links.push({ net: 'supply', from: t, to: nearestCore(t), load: fuelLoad(modules[t]) });
    for (const e of [...mains, ...sides]) links.push({ net: 'feed', from: nearestCore(e), to: e, load: fuelLoad(modules[e]) });
    for (const c of consumers) links.push({ net: 'power', from: nearestCore(c), to: c, load: powerLoad(modules[c]) });
  }
  return { cores, tanks, mains, sides, consumers, links, issues: systemIssues(modules, { cores, tanks, mains }) };
}

/**
 * KANAŁ SERWISOWY dyszy SIDE, zbiornika paliwa i — gdy przy szyjce nie ma rowu — gondoli MAIN: wycięcie w płytach od
 * strony kadłuba (SIDE i zbiornik: lokalne −x modułu, gondola: +x — szyjka), którym rura paliwa (i kabel) dochodzi do
 * urządzenia — urządzenia stoją zwykle na płytach (SIDE przy burcie, zbiornik na płycie grzbietu, gondola kadłuba
 * z klocków przy płycie rufy), a ostatni odcinek rury ma być widać. Generator tras traktuje kanał jak rów maszynowni,
 * kompozytor rysuje w nim maszynownię (płyty zdjęte, wysokość ramy) — te same wymiary w obu (hullComposer.js, gałęzie
 * modułów; kanał gondoli — znacznik w kodzie typu modułu). Wymiary w jd: długość lenDu (SIDE — co najmniej
 * sideLenK · w), pół-szerokość halfDu (co najmniej k · h).
 */
export const HD_SERVICE_CHANNEL = Object.freeze({ lenDu: 22, sideLenK: 1.8, halfDu: 7, sideHalfK: 0.8, tankHalfK: 0.5, mainHalfK: 0.45, mainInK: 0.6 });

/**
 * Kanał serwisowy modułu: { x, y, rot, w, h, dir } (środek, obrót, pół-wymiary [j.], dir — strona kanału na osi modułu:
 * −1 / +1) albo null. `D` — detal [j./jd], `engine` — gondola MAIN dostaje kanał (generator: przy szyjce brak rowu).
 */
export function serviceChannel(m, D, engine = false) {
  const C = HD_SERVICE_CHANNEL;
  let x0, x1, hc, dir = -1;
  if (m.type === 'engine') {
    if (!engine) return null;
    x0 = C.mainInK * m.w; x1 = m.w + C.lenDu * D;
    hc = Math.max(C.mainHalfK * m.h, C.halfDu * D);
    dir = 1;
  } else if (m.type === 'thruster_side') {
    const Lc = Math.max(C.sideLenK * m.w, C.lenDu * D);
    x0 = -m.w - Lc; x1 = -0.3 * m.w;
    hc = Math.max(C.sideHalfK * m.h, C.halfDu * D);
  } else if (m.type === 'fuel_tank') {
    x0 = -m.w - C.lenDu * D; x1 = -m.w + D;
    hc = Math.max(C.tankHalfK * m.h, C.halfDu * D);
  } else return null;
  const lx = (x0 + x1) * 0.5, c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
  return { x: m.x + lx * c, y: m.y + lx * s, rot: m.rot || 0, w: (x1 - x0) * 0.5, h: hc, dir };
}

/** Pole kanału [j.]: ujemne wewnątrz. */
export function serviceChannelSdf(ch, x, y) {
  const c = Math.cos(ch.rot), s = Math.sin(ch.rot);
  const dx = x - ch.x, dy = y - ch.y;
  const qx = Math.abs(dx * c + dy * s) - ch.w, qy = Math.abs(-dx * s + dy * c) - ch.h;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/** Walidacja kompletu systemów: rdzeń, zbiornik, mostek i MAIN wymagane (projekt od zera — gracz je stawia). */
export function systemIssues(modules, sys = null) {
  const s = sys || {
    cores: modules.filter((m) => m.type === 'reactor'), tanks: modules.filter((m) => m.type === 'fuel_tank'),
    mains: modules.filter((m) => m.type === 'engine')
  };
  const out = [];
  if (!s.cores.length) out.push({ level: 'bad', code: 'core', text: 'Brak reaktora — okręt bez zasilania: kable nie mają źródła (moduł Reaktor).' });
  if (!s.tanks.length) out.push({ level: 'bad', code: 'tank', text: 'Brak zbiornika paliwa — gondole MAIN i dysze SIDE bez paliwa (moduł Zbiornik paliwa).' });
  if (!modules.some((m) => m.type === 'bridge')) out.push({ level: 'bad', code: 'bridge', text: 'Brak mostka — okręt bez dowodzenia (moduł Mostek).' });
  if (!s.mains.length) out.push({ level: 'bad', code: 'main', text: 'Brak gondoli MAIN — okręt bez napędu głównego.' });
  return out;
}
