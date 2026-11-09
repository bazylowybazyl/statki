// src/game/escapePods.js
//
// KAPSUŁY RATUNKOWE (E22, reguła `kapsuly-ratunkowe`). Zniszczony statek (bez pirackich) „umiera” — wrak, wybuch
// zbiornika — a po krótkiej chwili wystrzeliwuje kapsuły: wylot z kadłuba na zewnątrz (100% prędkości kadłuba +
// impuls wyrzutu), krótki dryf, potem silnik i lot trasą do najbliższej przyjaznej stacji (prom — do portu nadania),
// gdzie kapsuła znika. Daleko od gracza kapsuła przechodzi w rozliczenie bez obrazu (dolot po czasie z długości
// trasy). Rozgrywka w 2D (zasada żelazna 1): pula, wyrzut, lot, dolot; obraz czyta ramkę (`fillEscapePodRenderFrame`).
//
// Kapsuły to duchy: bez zderzeń i trafień, AI i celowanie gracza ich nie widzą (nie są encjami `npcs`). Trasę liczy
// wołający (`env.route` — src/game/escapePodRoutes.js: objazd brył doków i płyty ringu), cel (indeks stacji) też.
//
// Pula SoA (x / y w Float64Array — świat 5–10 mln j.), usuwanie zamianą z ostatnią (z punktami trasy). Krok bez
// alokacji. Losowość wyrzutu z ziarna statku (`podHash01`) — bez Math.random. Stałe na sekundę: krok 60 / 120 Hz
// daje ten sam przebieg (dt w całkach, bez stałych „na krok”).

import { cloakVisAtWorld } from './cloakLook.js';

export const POD_TUNE = Object.freeze({
  // Najwięcej kapsuł w locie naraz; pełna pula → najstarsza kapsuła w locie przechodzi w rozliczenie bez obrazu.
  cap: 192,
  // Najwięcej punktów trasy na kapsułę (dłuższa trasa: ostatnie punkty — cel ważniejszy od gęstości łuku).
  maxWaypoints: 48,
  // Liczba kapsuł z długości kadłuba [j.] (prom 200 → 1, fregata 320 → 2, niszczyciel 480 / kontenerowiec 520 → 3,
  // frachtowiec dalekiego zasięgu 900 / pancernik 1040 → 4, lotniskowiec 1800 → 6, ciężki frachtowiec 3000 → 8,
  // megafrachtowiec 4600 → 12).
  countByLength: Object.freeze([[260, 1], [420, 2], [700, 3], [1100, 4], [2000, 6], [3500, 8], [Infinity, 12]]),
  // Od śmierci do pierwszego wyrzutu [s] (najpierw wrak i wybuch zbiornika) i odstęp między kolejnymi.
  delayMin: 1.4,
  delayMax: 2.2,
  stagger: 0.22,
  // Miejsce wyrzutu: ± ułamek długości wzdłuż osi, na burcie (± pół szerokości); impuls wyrzutu [j./s] poprzecznie
  // do osi (z odchyleniem wzdłuż).
  spreadAlong: 0.38,
  ejectMin: 150,
  ejectMax: 230,
  ejectAlong: 0.35,
  // Dryf bez ciągu po wyrzucie [s], potem silnik: przyspieszenie [j./s²], prędkość przelotowa [j./s], obrót [rad/s].
  coast: 1.3,
  accel: 170,
  cruise: 900,
  turnRate: 2.6,
  // Punkt pośredni zaliczony bliżej niż `wpReach` [j.]; dolot do celu — `arriveR`.
  wpReach: 180,
  arriveR: 45,
  // Dalej od gracza [j.] → rozliczenie bez obrazu (dolot po czasie z pozostałej trasy / `cruise`).
  abstractDist: 40000,
  // Bezpiecznik [s]: kapsuła dłużej w obrazie → rozliczenie bez obrazu.
  ttl: 900,
  // Rozliczenia bez obrazu naraz (pełna lista → dolot od razu).
  transitCap: 512,
  // Wymiary kapsuły [j.] (obraz, radar).
  length: 20,
  width: 8
});

/** Stan kapsuły: w kadłubie (czeka na wyrzut), dryf po wyrzucie, lot z silnikiem. */
export const POD_STATE = Object.freeze({ PENDING: 0, COAST: 1, FLY: 2 });

/** Rodzaj ładunku: załoga statku, pasażerowie promu (ludzie z kontraktu — workforce, krok K4). */
export const POD_KIND = Object.freeze({ CREW: 0, FERRY: 1 });

/** Hasz [0, 1) z ziarna, numeru kapsuły i soli — deterministyczny rozrzut bez Math.random. */
export function podHash01(seed, k, salt) {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((k | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(salt | 0, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Liczba kapsuł statku o długości kadłuba [j.]. */
export function escapePodCount(length, tune = POD_TUNE) {
  const len = Math.max(0, Number(length) || 0);
  for (const [max, n] of tune.countByLength) if (len < max) return n;
  return tune.countByLength[tune.countByLength.length - 1][1];
}

const FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone', 'ally_fighter', 'carrier_fighter', 'bomber']);

/**
 * Czy statek ma kapsuły. Piraci ich nie mają (decyzja użytkownika 2026-11-08): `isPirate`, frakcja piratów, kadłub
 * albo typ z „pirate” (jak `isPirate` NPC). Myśliwce i drony — bez kapsuł (pilot ma fotel, dron nie ma załogi).
 * `info`: { isPirate, factionId, hull (id kadłuba / ramy / klasy), type, fighter, drone }.
 */
export function escapePodsAllowed(info) {
  if (!info) return false;
  if (info.isPirate === true || info.factionId === 'pirates') return false;
  const hull = String(info.hull || '').toLowerCase();
  const type = String(info.type || '').toLowerCase();
  if (hull.includes('pirate') || type.includes('pirate')) return false;
  if (info.fighter || info.drone || FIGHTER_TYPES.has(type) || hull.includes('drone')) return false;
  return true;
}

/** Pula kapsuł. */
export function createEscapePods(cap = POD_TUNE.cap, tune = POD_TUNE) {
  const n = Math.max(1, cap | 0);
  const wpN = Math.max(2, tune.maxWaypoints | 0);
  const tn = Math.max(1, tune.transitCap | 0);
  return {
    cap: n,
    wpCap: wpN,
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    // Kurs kapsuły (oś, dziób), impuls wyrzutu (do chwili wyrzutu), ciąg 0…1 w tym kroku (obraz: płomień).
    ang: new Float32Array(n),
    ix: new Float32Array(n),
    iy: new Float32Array(n),
    thrust: new Float32Array(n),
    state: new Uint8Array(n),
    timer: new Float32Array(n),
    age: new Float32Array(n),
    // Cel: indeks stacji wołającego (−1 — brak: kapsuła dryfuje do rozliczenia), ludzie na pokładzie, rodzaj, kurs
    // promu (−1 — brak), ziarno wyglądu, stały numer kapsuły.
    target: new Int16Array(n),
    people: new Float64Array(n),
    kind: new Uint8Array(n),
    course: new Int32Array(n),
    seed: new Int32Array(n),
    uid: new Int32Array(n),
    // Trasa: punkty [x, y, vmax] w slocie kapsuły, liczba i bieżący punkt.
    wp: new Float64Array(n * wpN * 3),
    wpCount: new Int16Array(n),
    wpAt: new Int16Array(n),
    nextUid: 1,
    // Rozliczenia bez obrazu: cel, czas dolotu [s gry], ludzie, rodzaj, kurs.
    transit: {
      cap: tn,
      count: 0,
      target: new Int16Array(tn),
      eta: new Float64Array(tn),
      people: new Float64Array(tn),
      kind: new Uint8Array(tn),
      course: new Int32Array(tn)
    },
    clock: 0,
    stats: {
      launched: 0, ships: 0, arrived: 0, arrivedPeople: 0, abstracted: 0, settled: 0, lost: 0,
      evicted: 0, routeFails: 0
    }
  };
}

export function clearEscapePods(st) {
  st.count = 0;
  st.transit.count = 0;
}

function copySlot(st, from, to) {
  st.x[to] = st.x[from]; st.y[to] = st.y[from];
  st.vx[to] = st.vx[from]; st.vy[to] = st.vy[from];
  st.ang[to] = st.ang[from]; st.ix[to] = st.ix[from]; st.iy[to] = st.iy[from]; st.thrust[to] = st.thrust[from];
  st.state[to] = st.state[from]; st.timer[to] = st.timer[from]; st.age[to] = st.age[from];
  st.target[to] = st.target[from]; st.people[to] = st.people[from]; st.kind[to] = st.kind[from];
  st.course[to] = st.course[from]; st.seed[to] = st.seed[from]; st.uid[to] = st.uid[from];
  const n = st.wpCount[from];
  st.wpCount[to] = n; st.wpAt[to] = st.wpAt[from];
  const a = from * st.wpCap * 3;
  const b = to * st.wpCap * 3;
  for (let k = 0; k < n * 3; k++) st.wp[b + k] = st.wp[a + k];
}

/** Usuwa kapsułę `i` (zamiana z ostatnią). */
export function removeEscapePod(st, i) {
  const last = st.count - 1;
  if (i < 0 || i > last) return;
  if (i !== last) copySlot(st, last, i);
  st.count = last;
}

/** Pozostała długość trasy kapsuły `i` [j.] (od pozycji przez kolejne punkty). */
export function escapePodRemaining(st, i) {
  const n = st.wpCount[i];
  const base = i * st.wpCap * 3;
  let px = st.x[i];
  let py = st.y[i];
  let d = 0;
  for (let k = st.wpAt[i]; k < n; k++) {
    const qx = st.wp[base + k * 3];
    const qy = st.wp[base + k * 3 + 1];
    const dx = qx - px;
    const dy = qy - py;
    d += Math.sqrt(dx * dx + dy * dy);
    px = qx; py = qy;
  }
  return d;
}

/** Rozliczenie bez obrazu: dolot o `eta` (pełna lista — dolot od razu przez `onArrive`). */
function pushTransit(st, target, eta, people, kind, course, env) {
  const t = st.transit;
  if (t.count >= t.cap) {
    st.stats.settled++;
    arrive(st, target, people, kind, course, NaN, NaN, env);
    return;
  }
  const k = t.count++;
  t.target[k] = target; t.eta[k] = eta; t.people[k] = people; t.kind[k] = kind; t.course[k] = course;
}

function arrive(st, target, people, kind, course, x, y, env) {
  st.stats.arrived++;
  st.stats.arrivedPeople += people;
  if (env && typeof env.onArrive === 'function') env.onArrive(target, people, kind, course, x, y);
}

/** Kapsuła `i` → rozliczenie bez obrazu (bez celu — przepada) i zdjęcie z puli. */
function abstractPod(st, i, tune, env) {
  const target = st.target[i];
  if (target >= 0) {
    const eta = st.clock + escapePodRemaining(st, i) / tune.cruise + Math.max(0, st.timer[i]);
    st.stats.abstracted++;
    pushTransit(st, target, eta, st.people[i], st.kind[i], st.course[i], env);
  } else {
    st.stats.lost++;
    if (env && typeof env.onLost === 'function') env.onLost(st.people[i], st.kind[i], st.course[i]);
  }
  removeEscapePod(st, i);
}

/** Najstarsza kapsuła poza kadłubem (do zwolnienia miejsca przy pełnej puli) albo −1. */
function oldestFlying(st) {
  let best = -1;
  let bestAge = -1;
  for (let i = 0; i < st.count; i++) {
    if (st.state[i] === POD_STATE.PENDING) continue;
    if (st.age[i] > bestAge) { bestAge = st.age[i]; best = i; }
  }
  return best;
}

/**
 * Wyrzut kapsuł zniszczonego statku. `spec`: x, y, vx, vy (ruch kadłuba — 100% dziedziczenia), angle (oś kadłuba),
 * length, width (obrys), count (brak — z długości), seed (ziarno statku — rozrzut deterministyczny), target (indeks
 * stacji albo −1), people (ludzie na pokładzie, dzieleni po równo), kind (`POD_KIND`), course (kurs promu albo −1),
 * delay (brak — z ziarna, `delayMin…delayMax`). `env` — do rozliczenia przy pełnej puli (`onArrive`). Zwraca liczbę
 * kapsuł.
 */
export function launchEscapePods(st, spec, env = null, tune = POD_TUNE) {
  const len = Math.max(8, Number(spec?.length) || 120);
  const wid = Math.max(4, Number(spec?.width) || len * 0.4);
  const count = Math.max(0, Math.floor(Number.isFinite(spec?.count) ? spec.count : escapePodCount(len, tune)));
  if (!count) return 0;
  const seed = Number(spec.seed) | 0;
  const x0 = Number(spec.x) || 0;
  const y0 = Number(spec.y) || 0;
  const vx0 = Number(spec.vx) || 0;
  const vy0 = Number(spec.vy) || 0;
  const a0 = Number(spec.angle) || 0;
  const c = Math.cos(a0);
  const s = Math.sin(a0);
  const target = Number.isFinite(spec.target) ? spec.target | 0 : -1;
  const people = Math.max(0, Number(spec.people) || 0);
  const kind = spec.kind === POD_KIND.FERRY ? POD_KIND.FERRY : POD_KIND.CREW;
  const course = Number.isFinite(spec.course) ? spec.course | 0 : -1;
  const delay0 = Number.isFinite(spec.delay) ? Math.max(0, spec.delay)
    : tune.delayMin + podHash01(seed, 0, 7) * (tune.delayMax - tune.delayMin);
  // Ludzie po równo, całe osoby (reszta w pierwszej kapsule).
  const each = Math.floor(people / count);
  const rest = people - each * count;
  for (let k = 0; k < count; k++) {
    if (st.count >= st.cap) {
      const victim = oldestFlying(st);
      if (victim < 0) {
        // Pula pełna samych kapsuł w kadłubach: reszta tego statku od razu w rozliczenie.
        const p = each + (k === 0 ? rest : 0);
        if (target >= 0) pushTransit(st, target, st.clock + delay0 + 60, p, kind, course, env);
        st.stats.evicted++;
        continue;
      }
      st.stats.evicted++;
      abstractPod(st, victim, tune, env);
    }
    const i = st.count++;
    const h1 = podHash01(seed, k, 11);
    const h2 = podHash01(seed, k, 13);
    const h3 = podHash01(seed, k, 17);
    // Burta na przemian (lewa / prawa), miejsce wzdłuż osi rozłożone po długości.
    const side = (k & 1) ? 1 : -1;
    const along = ((count > 1 ? k / (count - 1) : 0.5) * 2 - 1) * tune.spreadAlong * len + (h1 - 0.5) * 0.1 * len;
    const across = side * wid * 0.5;
    st.x[i] = x0 + along * c - across * s;
    st.y[i] = y0 + along * s + across * c;
    st.vx[i] = vx0;
    st.vy[i] = vy0;
    const ej = tune.ejectMin + h2 * (tune.ejectMax - tune.ejectMin);
    const ea = (h3 * 2 - 1) * tune.ejectAlong;
    // Kierunek wyrzutu: normalna burty (lokalne ±y) z odchyleniem wzdłuż osi.
    const lx = ea;
    const ly = side;
    const ll = Math.sqrt(lx * lx + ly * ly);
    st.ix[i] = (lx * c - ly * s) / ll * ej;
    st.iy[i] = (lx * s + ly * c) / ll * ej;
    st.ang[i] = Math.atan2(st.iy[i], st.ix[i]);
    st.thrust[i] = 0;
    st.state[i] = POD_STATE.PENDING;
    st.timer[i] = delay0 + k * tune.stagger;
    st.age[i] = 0;
    st.target[i] = target;
    st.people[i] = each + (k === 0 ? rest : 0);
    st.kind[i] = kind;
    st.course[i] = course;
    st.seed[i] = seed;
    st.uid[i] = st.nextUid++;
    st.wpCount[i] = 0;
    st.wpAt[i] = 0;
    st.stats.launched++;
  }
  st.stats.ships++;
  return count;
}

/** Wpisuje trasę kapsuły `i` z bufora ścieżki (`{ data, count }`, krok `stride`; punkt 0 = start — pomijany). */
export function setEscapePodRoute(st, i, path, stride) {
  const base = i * st.wpCap * 3;
  const total = Math.max(0, (path?.count | 0) - 1);
  // Za długa trasa: pierwszy punkt po starcie i ostatnie punkty (cel ważniejszy od gęstości łuku).
  const cap = st.wpCap;
  let n = 0;
  for (let k = 1; k <= total; k++) {
    if (total > cap && k > 1 && k <= total - (cap - 1)) continue;
    const o = k * stride;
    st.wp[base + n * 3] = path.data[o];
    st.wp[base + n * 3 + 1] = path.data[o + 1];
    const v = path.data[o + 2];
    st.wp[base + n * 3 + 2] = Number.isFinite(v) && v > 0 ? v : Infinity;
    n++;
  }
  st.wpCount[i] = n;
  st.wpAt[i] = 0;
  return n;
}

/**
 * Prom (K4): świat ruchu podał cel kapsuł kursu `course` (port nadania) i ludzi z kontraktu (`pods-target`). Kapsuły
 * tego kursu (`POD_KIND.FERRY` — w puli i w rozliczeniu bez obrazu) dostają cel `target` i ludzi po równo (reszta
 * w pierwszej); kapsuła już poza kadłubem dostaje nową trasę (`env.route`). Zwraca liczbę kapsuł kursu.
 */
export function retargetEscapePods(st, course, target, people, env = null) {
  const c = course | 0;
  const t = st.transit;
  let n = 0;
  for (let i = 0; i < st.count; i++) if (st.kind[i] === POD_KIND.FERRY && st.course[i] === c) n++;
  for (let k = 0; k < t.count; k++) if (t.kind[k] === POD_KIND.FERRY && t.course[k] === c) n++;
  if (!n) return 0;
  const total = Math.max(0, Math.floor(Number(people) || 0));
  const each = Math.floor(total / n);
  let rest = total - each * n;
  for (let i = 0; i < st.count; i++) {
    if (st.kind[i] !== POD_KIND.FERRY || st.course[i] !== c) continue;
    st.target[i] = target;
    st.people[i] = each + rest;
    rest = 0;
    if (st.state[i] !== POD_STATE.PENDING && target >= 0 && env && typeof env.route === 'function') {
      if (!env.route(i, st.x[i], st.y[i], target)) { st.wpCount[i] = 0; st.wpAt[i] = 0; st.stats.routeFails++; }
    }
  }
  for (let k = 0; k < t.count; k++) {
    if (t.kind[k] !== POD_KIND.FERRY || t.course[k] !== c) continue;
    t.target[k] = target;
    t.people[k] = each + rest;
    rest = 0;
  }
  return n;
}

function turnToward(cur, want, maxStep) {
  let d = want - cur;
  d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return cur + d;
}

/**
 * Krok puli (w `physicsStep`, czas gry). `env` (obiekt wielokrotnego użytku wołającego):
 *   px, py, hasPlayer — gracz (odległość do rozliczenia bez obrazu);
 *   route(i, x, y, target) — trasa kapsuły `i` od (x, y) do stacji `target` (woła `setEscapePodRoute`), zwraca bool;
 *   onArrive(target, people, kind, course, x, y) — dolot (x / y NaN — rozliczenie bez obrazu);
 *   onLost(people, kind, course) — kapsuła bez celu przepadła.
 */
export function stepEscapePods(st, dt, env, tune = POD_TUNE) {
  if (!(dt > 0)) return;
  st.clock += dt;
  // Rozliczenia bez obrazu (od końca — usuwanie zamianą).
  const t = st.transit;
  for (let k = t.count - 1; k >= 0; k--) {
    if (t.eta[k] > st.clock) continue;
    const target = t.target[k];
    const people = t.people[k];
    const kind = t.kind[k];
    const course = t.course[k];
    const last = t.count - 1;
    if (k !== last) {
      t.target[k] = t.target[last]; t.eta[k] = t.eta[last]; t.people[k] = t.people[last];
      t.kind[k] = t.kind[last]; t.course[k] = t.course[last];
    }
    t.count = last;
    st.stats.settled++;
    arrive(st, target, people, kind, course, NaN, NaN, env);
  }
  if (st.count === 0) return;
  const hasPlayer = !!env?.hasPlayer;
  const px = Number(env?.px) || 0;
  const py = Number(env?.py) || 0;
  const far2 = tune.abstractDist * tune.abstractDist;
  const accel = tune.accel;
  const dvMax = accel * dt;
  const turn = tune.turnRate * dt;
  const reach2 = tune.wpReach * tune.wpReach;
  const arrive2 = tune.arriveR * tune.arriveR;
  for (let i = st.count - 1; i >= 0; i--) {
    st.age[i] += dt;
    const state = st.state[i];
    if (state === POD_STATE.PENDING) {
      // W kadłubie: jedzie z wrakiem (pęd kadłuba), czeka na wyrzut.
      st.x[i] += st.vx[i] * dt;
      st.y[i] += st.vy[i] * dt;
      st.timer[i] -= dt;
      if (st.timer[i] > 0) continue;
      st.vx[i] += st.ix[i];
      st.vy[i] += st.iy[i];
      st.ix[i] = 0; st.iy[i] = 0;
      st.state[i] = POD_STATE.COAST;
      st.timer[i] = tune.coast;
      st.age[i] = 0;
      if (st.target[i] >= 0 && !(env && typeof env.route === 'function' && env.route(i, st.x[i], st.y[i], st.target[i]))) {
        st.stats.routeFails++;
      }
      continue;
    }
    // Daleko od gracza albo zbyt długo w obrazie → rozliczenie bez obrazu.
    if (hasPlayer) {
      const dx = st.x[i] - px;
      const dy = st.y[i] - py;
      if (dx * dx + dy * dy > far2) { abstractPod(st, i, tune, env); continue; }
    }
    if (st.age[i] > tune.ttl) { abstractPod(st, i, tune, env); continue; }
    st.thrust[i] = 0;
    if (state === POD_STATE.COAST) {
      st.timer[i] -= dt;
      if (st.timer[i] <= 0) st.state[i] = POD_STATE.FLY;
    } else {
      // Dolot zdjął kapsułę: w slocie `i` stoi już przerobiona (ostatnia) — dalej.
      if (steer(st, i, dvMax, accel, reach2, arrive2, tune, env)) continue;
    }
    // Obrót ku ciągowi (dryf — ku pierwszemu punktowi trasy).
    const n = st.wpCount[i];
    const at = st.wpAt[i];
    if (n > at) {
      const base = (i * st.wpCap + at) * 3;
      const want = Math.atan2(st.wp[base + 1] - st.y[i], st.wp[base] - st.x[i]);
      st.ang[i] = turnToward(st.ang[i], want, turn);
    }
    st.x[i] += st.vx[i] * dt;
    st.y[i] += st.vy[i] * dt;
  }
}

/**
 * Sterowanie kapsuły w locie: prędkość zadana ku bieżącemu punktowi trasy (prędkość przelotowa, sufit punktu,
 * hamowanie przed wolniejszym następnym punktem i przed celem: v = √(v₁² + 2 a d)), korekta najwyżej `accel · dt`.
 * Dolot do ostatniego punktu → `onArrive` i zdjęcie z puli (zwraca true).
 */
function steer(st, i, dvMax, accel, reach2, arrive2, tune, env) {
  const n = st.wpCount[i];
  let at = st.wpAt[i];
  if (at >= n) {
    // Bez trasy (brak celu albo router zawiódł): dryf z wygaszaniem prędkości do rozliczenia.
    const k = Math.max(0, 1 - 0.05 * (dvMax / Math.max(1e-6, accel)));
    st.vx[i] *= k; st.vy[i] *= k;
    return false;
  }
  const wpBase = i * st.wpCap * 3;
  let o = wpBase + at * 3;
  let dx = st.wp[o] - st.x[i];
  let dy = st.wp[o + 1] - st.y[i];
  let d2 = dx * dx + dy * dy;
  // Punkt pośredni zaliczony (blisko albo minięty — rzut prędkości na odcinek do następnego).
  while (at < n - 1 && d2 < reach2) {
    at++;
    o = wpBase + at * 3;
    dx = st.wp[o] - st.x[i];
    dy = st.wp[o + 1] - st.y[i];
    d2 = dx * dx + dy * dy;
  }
  st.wpAt[i] = at;
  const last = at === n - 1;
  if (last && d2 < arrive2) {
    const x = st.x[i];
    const y = st.y[i];
    const target = st.target[i];
    const people = st.people[i];
    const kind = st.kind[i];
    const course = st.course[i];
    removeEscapePod(st, i);
    arrive(st, target, people, kind, course, x, y, env);
    return true;
  }
  const d = Math.sqrt(d2);
  const vCap = Math.min(tune.cruise, st.wp[o + 2]);
  // Prędkość przy następnym punkcie: 0 przy celu, jego sufit przy punkcie pośrednim.
  const vNext = last ? 0 : Math.min(tune.cruise, st.wp[o + 5]);
  const want = Math.min(vCap, Math.sqrt(vNext * vNext + 2 * accel * d));
  const inv = d > 1e-6 ? want / d : 0;
  let ex = dx * inv - st.vx[i];
  let ey = dy * inv - st.vy[i];
  const e = Math.sqrt(ex * ex + ey * ey);
  if (e > dvMax) { ex *= dvMax / e; ey *= dvMax / e; }
  st.vx[i] += ex;
  st.vy[i] += ey;
  st.thrust[i] = dvMax > 0 ? Math.min(1, e / dvMax) : 0;
  return false;
}

/**
 * Kapsuła w (x, y) zgaszona maskowaniem: w obrysie sprite'a maskowanej encji z `entities` (lista `CLOAK_LOOK_FRAME`
 * — encje z aktywnym wyglądem maskowania), a wzór maskowania w tym punkcie ukrywa (`visAt` < ½). Wzór
 * (`cloakVisAtWorld`) jest nieograniczony — stąd test obrysu. Bez alokacji.
 */
export function escapePodCloakHidden(entities, x, y, visAt = cloakVisAtWorld) {
  if (!entities || !entities.length) return false;
  for (let i = 0; i < entities.length; i++) {
    const look = entities[i]?.__cloakLook;
    if (!look || !look.active) continue;
    const dx = x - look.px;
    const dy = y - look.py;
    const lx = (dx * look.cos + dy * look.sin) * look.invScale;
    const ly = (dy * look.cos - dx * look.sin) * look.invScale;
    if (Math.abs(lx) > look.spriteW * 0.5 || Math.abs(ly) > look.spriteH * 0.5) continue;
    if (visAt(look, x, y) < 0.5) return true;
  }
  return false;
}

/** Flagi kapsuły w ramce obrazu — te same liczby co `POD_BLOCK.ENGINE` (src/render/blocks/escapePodBlock.js). */
export const POD_RENDER_FLAG = Object.freeze({ ENGINE: 1 });

/**
 * Ramka obrazu kapsuł (blok `pods`, ramka z `createEscapePodFrame`): pozy w chwili klatki renderu (`lag` s przed
 * stanem fizyki: x − vx · lag), tylko kapsuły poza kadłubem, widoczne (`visible(x, y)` — mgła wojny i maskowanie)
 * i poza kropkami soczewki skoku (`hidden(x, y)`); silnik i ciąg (płomień), wiek po wyrzucie (lampa). Bez alokacji.
 */
export function fillEscapePodRenderFrame(st, out, lag = 0, visible = null, hidden = null) {
  const cap = out.cap | 0;
  let n = 0;
  for (let i = 0; i < st.count && n < cap; i++) {
    if (st.state[i] === POD_STATE.PENDING) continue;
    const x = st.x[i] - st.vx[i] * lag;
    const y = st.y[i] - st.vy[i] * lag;
    if (visible && !visible(x, y)) continue;
    if (hidden && hidden(x, y)) continue;
    out.x[n] = x;
    out.y[n] = y;
    out.ang[n] = st.ang[i];
    out.thrust[n] = st.thrust[i];
    out.age[n] = st.age[i];
    out.seed[n] = st.seed[i];
    out.uid[n] = st.uid[i];
    // Silnik pracuje przez cały lot (płomień: 0,35 + 0,65 · ciąg tego kroku), dryf po wyrzucie — bez płomienia.
    out.flags[n] = st.state[i] === POD_STATE.FLY ? POD_RENDER_FLAG.ENGINE : 0;
    n++;
  }
  out.count = n;
  return out;
}
