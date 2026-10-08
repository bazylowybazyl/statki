// src/game/engineDamage.js
//
// USZKODZENIE SILNIKÓW GŁÓWNYCH (2026-10-08, decyzja użytkownika: okręt, którego nie da się naprawić w polu,
// „bo np. ma uszkodzone silniki”, zabiera holownik serwisowy). Do tej pory ciąg w ogóle nie zależał od dysz:
// dysza MAIN tylko gasła wizualnie z komórką kadłuba pod sobą (hullMounts.js, engineVfxSystem.js).
//
// Model:
//  - dysza MAIN = mocowanie na komórce siatki belek (to samo wiązanie co obraz dyszy — hullMounts.js);
//  - komórka pod dyszą zginęła (krater, rzaz, odcięta rufa) → dysza ZNISZCZONA i zostaje zniszczona
//    (ZATRZASK) aż do remontu w doku. Odrost komórki (rój dronów: HullBodies.regrowCell) jej NIE przywraca —
//    w polu silniki ani broń nie wracają (broń tylko z inwentarza);
//  - ciąg główny × (żywe dysze MAIN / wszystkie): dysza zniszczona nie daje siły (thrusterModel.js
//    pomija ją w sile, momencie i obwiedni wstecznego), model lotu NPC (shipFlightModel.js) mnoży przez ten
//    ułamek przyspieszenie do przodu; zero = brak ciągu głównego, zostają dysze manewrowe (RCS);
//  - remont w doku (HullBodies.restoreHull + repairEngines) zdejmuje zatrzaski.
//
// Stan na encji (`entity.__engineDamage`), flaga na obiekcie dyszy (`thruster.__destroyed`) — czyta ją
// model dysz i obraz dyszy (engineVfxSystem.js), bez szukania indeksów. Obiekty dysz są per encja (model dysz
// pisze na nich stan przepustnic). Koszt: wiązanie raz na układ dysz i ród kadłuba, potem O(1) na wywołanie,
// dopóki ciało się nie zmieni (klucz jak refreshHullMountSet). Bez three i DOM (testy node).

import {
  beginHullMountBind,
  bindHullMount,
  createHullMountSet,
  mountHullOf,
  refreshHullMountSet
} from './hullMounts.js';

export const ENGINE_REPAIR = Object.freeze({
  // Remont dysz w doku (handleRepair w index.html): kredyty za każdą zniszczoną dyszę MAIN.
  dockCostPerNozzle: 60
});

function createState() {
  return {
    thrusters: null,   // tablica visual.mainThrusters, dla której są wiązania
    count: 0,
    lineage: 0,        // ród kadłuba (dmgKey) wiązań
    set: createHullMountSet(),
    latched: new Uint8Array(0),
    dead: 0,           // ile dysz zniszczonych (zatrzaśniętych)
    frac: 1,           // żywe / wszystkie
    version: 0,        // rośnie przy każdej zmianie zatrzasków (sonda zdolności obrotu, HUD)
    lostAt: 0          // licznik zniszczeń (komunikaty)
  };
}

/** Stan uszkodzeń silników encji albo null (encja bez dysz MAIN / jeszcze nieoceniona). */
export function engineDamageState(entity) {
  return entity?.__engineDamage || null;
}

/** Ułamek sprawnych dysz MAIN (1 — bez dysz albo bez uszkodzeń). */
export function mainEngineFraction(entity) {
  const s = entity?.__engineDamage;
  return s && s.count > 0 ? s.frac : 1;
}

/** Okręt z dyszami MAIN, z których żadna nie działa — bez ciągu głównego (holownik). */
export function isMainDriveDestroyed(entity) {
  const s = entity?.__engineDamage;
  return !!(s && s.count > 0 && s.dead >= s.count);
}

/** { live, total } dysz MAIN (out — bufor wielokrotnego użytku). */
export function mainEngineCounts(entity, out = { live: 0, total: 0 }) {
  const s = entity?.__engineDamage;
  if (s && s.count > 0) {
    out.total = s.count;
    out.live = s.count - s.dead;
  } else {
    const list = entity?.visual?.mainThrusters;
    out.total = Array.isArray(list) ? list.length : 0;
    out.live = out.total;
  }
  return out;
}

function writeFlags(state) {
  const list = state.thrusters;
  if (!list) return;
  for (let k = 0; k < state.count; k++) {
    const t = list[k];
    if (!t) continue;
    const dead = state.latched[k] === 1;
    if ((t.__destroyed === true) !== dead) t.__destroyed = dead;
  }
}

function recount(state) {
  let dead = 0;
  for (let k = 0; k < state.count; k++) if (state.latched[k]) dead++;
  state.dead = dead;
  state.frac = state.count > 0 ? (state.count - dead) / state.count : 1;
}

/**
 * Ocena dysz MAIN encji: wiązanie (po zmianie układu dysz albo rodu kadłuba), żywotność komórek, zatrzask.
 * Zwraca liczbę dysz zniszczonych W TYM wywołaniu (0 — bez zmian). Encja bez kadłuba belkowego: bez zmian
 * (zatrzaski zostają — kadłub mógł być chwilowo przebudowywany).
 */
export function stepEngineDamage(entity) {
  if (!entity) return 0;
  const list = entity.visual?.mainThrusters;
  if (!Array.isArray(list) || list.length === 0) {
    if (entity.__engineDamage) entity.__engineDamage.count = 0;
    return 0;
  }
  const hull = mountHullOf(entity);
  if (!hull) return 0;
  let s = entity.__engineDamage;
  if (!s) s = entity.__engineDamage = createState();
  if (s.thrusters !== list || s.count !== list.length || s.lineage !== hull.dmgKey) {
    // Ta sama liczba dysz na tym samym rodzie kadłuba (tablica odtworzona z tego samego układu) — zatrzaski
    // zostają; nowy kadłub albo nowy układ (montaż w doku) — dysze sprawne.
    const keep = s.lineage === hull.dmgKey && s.count === list.length;
    const n = list.length;
    if (s.latched.length < n || !keep) {
      const next = new Uint8Array(n);
      if (keep) next.set(s.latched.subarray(0, n));
      s.latched = next;
    }
    const rest = beginHullMountBind(s.set, hull, n);
    for (let k = 0; k < n; k++) {
      const off = list[k]?.offset;
      const sx = Number(off?.x), sy = Number(off?.y);
      s.set.cells[k] = Number.isFinite(sx) && Number.isFinite(sy) ? bindHullMount(hull, sx, sy, rest) : -1;
    }
    s.thrusters = list;
    s.count = n;
    s.lineage = hull.dmgKey;
    recount(s);
    writeFlags(s);
    s.version++;
  }
  refreshHullMountSet(s.set, hull);
  const alive = s.set.alive;
  let lost = 0;
  for (let k = 0; k < s.count; k++) {
    if (!alive[k] && !s.latched[k]) {
      s.latched[k] = 1;
      lost++;
    }
  }
  if (lost > 0) {
    recount(s);
    writeFlags(s);
    s.version++;
    s.lostAt++;
  }
  return lost;
}

/**
 * Remont w doku: zatrzaski zdjęte (wołać PO HullBodies.restoreHull — komórki pod dyszami muszą żyć, inaczej
 * następna ocena zatrzaśnie je od nowa). Zwraca liczbę przywróconych dysz.
 */
export function repairEngines(entity) {
  const s = entity?.__engineDamage;
  if (!s || s.count === 0) return 0;
  const restored = s.dead;
  s.latched.fill(0);
  recount(s);
  writeFlags(s);
  // Wiązanie od nowa przy następnej ocenie (ciało po remoncie bywa nowe).
  s.set.body = null;
  s.set.active = -1;
  s.version++;
  return restored;
}

/**
 * Zniszczenie dyszy z zewnątrz (narzędzia, testy, skrypty misji): indeksy jak visual.mainThrusters.
 * Bez indeksów — wszystkie. Zwraca liczbę nowo zniszczonych.
 */
export function destroyMainEngines(entity, indices = null) {
  if (!entity) return 0;
  stepEngineDamage(entity);
  const s = entity.__engineDamage;
  if (!s || s.count === 0) return 0;
  let lost = 0;
  const mark = (k) => {
    if (k >= 0 && k < s.count && !s.latched[k]) { s.latched[k] = 1; lost++; }
  };
  if (Array.isArray(indices)) for (const k of indices) mark(k | 0);
  else for (let k = 0; k < s.count; k++) mark(k);
  if (lost > 0) {
    recount(s);
    writeFlags(s);
    s.version++;
    s.lostAt++;
  }
  return lost;
}

/** Komórka siatki belek (ix + iy · dims.x) pod dyszą MAIN `k` albo −1 (testy, narzędzia). */
export function mainEngineCell(entity, k) {
  const s = entity?.__engineDamage;
  return s && k >= 0 && k < s.count ? s.set.cells[k] : -1;
}
