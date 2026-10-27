// src/game/lootContainers.js
//
// KONTENERY-ŁUP (K1, docs/PROPOZYCJA-kontenery-lup.md): zniszczony statek ruchu gubi część ładunku jako paczki
// kontenerów dryfujące w przestrzeni; gracz zbiera je sprzętem z gniazda ZBIÓRKA (src/data/lootGear.js — wiązka;
// drony w K3). Rozgrywka w 2D (zasada żelazna 1): pula paczek, zrzut, dryf, czas życia, wiązka i chwyt. Obraz
// (K2) czyta tę pulę przez blok migawki; nic stąd nie zależy od renderu.
//
// Ekonomia: towar opuścił gospodarkę przy załadunku kursu i siedzi w rekordzie wraku świata ruchu (`byPirates`
// false — nie idzie do kryjówki, złomiarze go nie biorą). Paczka niesie część tego ładunku; do gospodarki wraca
// dopiero sprzedażą w terminalu (`adjustStationStock`). Nic się nie dubluje.
//
// Pula SoA (tablice typowane, x / y w Float64Array — świat 5–10 mln j.), usuwanie zamianą z ostatnią. Krok bez
// alokacji (wiązka: lista najbliższych w tablicy typowanej). Losowość zrzutu z numeru kursu (`cargoHash01`) — bez
// Math.random. Stałe na sekundę: krok 60 / 120 Hz daje ten sam przebieg (tłumienie wykładnicze od dt).

import { RESOURCES } from '../data/resources.js';
import { cargoHash01, cargoResourceIndex, cargoResourceKey } from '../data/cargoContainers.js';
import { VAN_CLASSES } from './traffic/shipmentOrders.js';
import { PIRACY_MODEL } from './traffic/piracy.js';

export const LOOT_TUNE = Object.freeze({
  // Najwięcej paczek naraz (D5); pełna pula → doklejanie do najbliższej paczki tego samego towaru.
  cap: 256,
  // Ile ładunku przetrwa wybuch (D2) — ta sama stała co łup piratów (jedna liczba dla gracza i AI).
  survive: PIRACY_MODEL.lootRecovery,
  // Paczek na klasę ładowni (najmniejsza klasa, która mieści ładunek — `vanClassForMass`).
  piecesByClass: Object.freeze({ van: 2, hauler: 4, bulk: 6, heavy: 10, mega: 16 }),
  // Czas życia paczki [s gry] i jej zanik na końcu (lampka mruga szybciej — obraz K2).
  ttl: 300,
  fadeSec: 10,
  // Paczka dalej od gracza przepada (WRECK_DESPAWN_DIST).
  despawnDist: 50000,
  // Miejsce w obrysie statku: ± ułamek długości wzdłuż osi i szerokości w poprzek.
  spreadAlong: 0.3,
  spreadAcross: 0.25,
  // Pęd od środka wybuchu [j./s] ponad prędkość wraku.
  burstMin: 40,
  burstMax: 140,
  // Obrót w płaszczyźnie [rad/s].
  spinMin: 0.2,
  spinMax: 1.2,
  // Po `dampAfter` s paczka zwalnia (stała czasowa 1 / dampRate) do `dampTo` j./s — dryf nie ucieka graczowi.
  dampAfter: 20,
  dampTo: 15,
  dampRate: 0.12,
  // Najwięcej celów wiązki naraz (sufit tablicy; kadłub ma swoją liczbę w lootGear.js).
  maxTargets: 8
});

export const LOOT_FLAG = Object.freeze({ TRACTOR: 1, HELD: 2 });

/** Pula paczek. `cap` — pojemność tablic. */
export function createLootContainers(cap = LOOT_TUNE.cap) {
  const n = Math.max(1, cap | 0);
  return {
    cap: n,
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    ang: new Float32Array(n),
    spin: new Float32Array(n),
    // Sztuki towaru (jednostki świata, całe) i masa sztuki [t].
    units: new Float64Array(n),
    mpu: new Float32Array(n),
    age: new Float32Array(n),
    ttl: new Float32Array(n),
    // Indeks towaru (`cargoResourceIndex`), ziarno wyglądu (`containerLook`: kurs, numer paczki), stały numer paczki.
    res: new Int16Array(n),
    seed: new Int32Array(n),
    unit: new Int16Array(n),
    uid: new Int32Array(n),
    flags: new Uint8Array(n),
    nextUid: 1,
    // Wiązka: indeksy celów tego kroku (posortowane po odległości) i odległości².
    targets: new Int32Array(LOOT_TUNE.maxTargets),
    targetD2: new Float64Array(LOOT_TUNE.maxTargets),
    targetCount: 0,
    stats: {
      spawned: 0, spawnedUnits: 0, collected: 0, collectedUnits: 0, expired: 0, lostUnits: 0,
      merged: 0, evicted: 0, held: 0
    }
  };
}

export function clearLootContainers(st) {
  st.count = 0;
  st.targetCount = 0;
}

function copySlot(st, from, to) {
  st.x[to] = st.x[from]; st.y[to] = st.y[from];
  st.vx[to] = st.vx[from]; st.vy[to] = st.vy[from];
  st.ang[to] = st.ang[from]; st.spin[to] = st.spin[from];
  st.units[to] = st.units[from]; st.mpu[to] = st.mpu[from];
  st.age[to] = st.age[from]; st.ttl[to] = st.ttl[from];
  st.res[to] = st.res[from]; st.seed[to] = st.seed[from]; st.unit[to] = st.unit[from];
  st.uid[to] = st.uid[from]; st.flags[to] = st.flags[from];
}

/** Usuwa paczkę `i` (zamiana z ostatnią). */
export function removeLootContainer(st, i) {
  const last = st.count - 1;
  if (i < 0 || i > last) return;
  if (i !== last) copySlot(st, last, i);
  st.count = last;
}

/** Najbliższa paczka towaru `res` (indeks albo −1). */
function nearestSameResource(st, res, x, y) {
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < st.count; i++) {
    if (st.res[i] !== res) continue;
    const dx = st.x[i] - x;
    const dy = st.y[i] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

/** Paczka z najkrótszym pozostałym życiem (do zastąpienia przy pełnej puli bez paczki tego towaru). */
function shortestLife(st) {
  let best = 0;
  let bestLeft = Infinity;
  for (let i = 0; i < st.count; i++) {
    const left = st.ttl[i] - st.age[i];
    if (left < bestLeft) { bestLeft = left; best = i; }
  }
  return best;
}

/**
 * Wstawia paczkę. Pełna pula: doklejenie do najbliższej paczki tego samego towaru (D5), a bez takiej — zastąpienie
 * paczki z najkrótszym pozostałym życiem (jej ładunek przepada). Zwraca indeks.
 */
function insert(st, res, units, mpu, x, y, vx, vy, ang, spin, ttl, seed, unit) {
  if (st.count >= st.cap) {
    const same = nearestSameResource(st, res, x, y);
    if (same >= 0) {
      st.units[same] += units;
      // Doklejony ładunek jest świeży — paczka żyje od nowa.
      st.age[same] = 0;
      st.stats.merged++;
      return same;
    }
    const victim = shortestLife(st);
    st.stats.evicted++;
    st.stats.lostUnits += st.units[victim];
    removeLootContainer(st, victim);
  }
  const i = st.count++;
  st.x[i] = x; st.y[i] = y;
  st.vx[i] = vx; st.vy[i] = vy;
  st.ang[i] = ang; st.spin[i] = spin;
  st.units[i] = units; st.mpu[i] = mpu;
  st.age[i] = 0; st.ttl[i] = ttl;
  st.res[i] = res; st.seed[i] = seed | 0; st.unit[i] = unit;
  st.uid[i] = st.nextUid++;
  st.flags[i] = 0;
  return i;
}

/** Najmniejsza klasa ładowni (`VAN_CLASSES`), która mieści masę [t]; ponad największą — największa. */
export function vanClassForMass(mass) {
  const m = Math.max(0, Number(mass) || 0);
  for (const cls of VAN_CLASSES) if (m <= cls.capacity + 1e-6) return cls.id;
  return VAN_CLASSES[VAN_CLASSES.length - 1].id;
}

/**
 * Plan podziału ładunku na paczki (czysty, bez puli — także do testów): `cargo` { towar: sztuki } (jednostki świata),
 * `mass` — masa całego ładunku [t] (brak — z tabeli towarów). Przetrwa `survive` każdej pozycji, ucięte do całych
 * sztuk; paczek tyle, ile klasa ładowni z masy (`piecesByClass`), rozdzielonych proporcjonalnie do masy towarów
 * (każdy towar co najmniej jedna, paczka co najmniej sztuka); ostatnia paczka towaru bierze resztę dzielenia.
 * Zwraca [{ res, units, mpu }].
 */
export function planLootSpill(cargo, mass = null, tune = LOOT_TUNE) {
  const rows = [];
  let total = 0;
  for (const id in cargo || {}) {
    const def = RESOURCES[id];
    const n = Number(cargo[id]) || 0;
    if (!def || !(n > 0)) continue;
    const mpu = Number(def.mass) > 0 ? Number(def.mass) : 1;
    rows.push({ id, units: n, mpu, mass: n * mpu });
    total += n * mpu;
  }
  if (!rows.length) return [];
  rows.sort((a, b) => b.mass - a.mass || (a.id < b.id ? -1 : 1));
  const cargoMass = Number(mass) > 0 ? Number(mass) : total;
  const pieces = tune.piecesByClass[vanClassForMass(cargoMass)] || 3;
  const out = [];
  for (const row of rows) {
    const survived = Math.floor(row.units * tune.survive);
    if (survived < 1) continue;
    const share = total > 0 ? row.mass / total : 1;
    const k = Math.max(1, Math.min(survived, Math.round(pieces * share)));
    const base = Math.floor(survived / k);
    for (let j = 0; j < k; j++) {
      const units = j === k - 1 ? survived - base * (k - 1) : base;
      out.push({ res: row.id, units, mpu: row.mpu });
    }
  }
  return out;
}

/**
 * Zrzut ładunku zniszczonego statku. `spec`: x, y, vx, vy (ruch wraku — 100% dziedziczenia), angle (kurs statku),
 * length, width (obrys), cargo { towar: sztuki }, mass (masa ładunku), seed (numer kursu — wygląd i rozrzut
 * deterministyczne), blastX / blastY (środek wybuchu; brak — środek statku). Zwraca liczbę paczek.
 */
export function spillLootCargo(st, spec, tune = LOOT_TUNE) {
  const plan = planLootSpill(spec?.cargo, spec?.mass, tune);
  if (!plan.length) return 0;
  const x0 = Number(spec.x) || 0;
  const y0 = Number(spec.y) || 0;
  const bvx = Number(spec.vx) || 0;
  const bvy = Number(spec.vy) || 0;
  const a0 = Number(spec.angle) || 0;
  const len = Math.max(16, Number(spec.length) || 120);
  const wid = Math.max(8, Number(spec.width) || len * 0.4);
  const bx = Number.isFinite(spec.blastX) ? spec.blastX : x0;
  const by = Number.isFinite(spec.blastY) ? spec.blastY : y0;
  const seed = Number(spec.seed) | 0;
  const c = Math.cos(a0);
  const s = Math.sin(a0);
  for (let k = 0; k < plan.length; k++) {
    const p = plan[k];
    const h1 = cargoHash01(seed, k, 101);
    const h2 = cargoHash01(seed, k, 103);
    const h3 = cargoHash01(seed, k, 107);
    const h4 = cargoHash01(seed, k, 109);
    const h5 = cargoHash01(seed, k, 113);
    const h6 = cargoHash01(seed, k, 127);
    const h7 = cargoHash01(seed, k, 131);
    const along = (h1 * 2 - 1) * tune.spreadAlong * len;
    const across = (h2 * 2 - 1) * tune.spreadAcross * wid;
    const x = x0 + along * c - across * s;
    const y = y0 + along * s + across * c;
    let dx = x - bx;
    let dy = y - by;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) {
      const t = h3 * Math.PI * 2;
      dx = Math.cos(t); dy = Math.sin(t); d = 1;
    }
    const burst = tune.burstMin + h4 * (tune.burstMax - tune.burstMin);
    const vx = bvx + dx / d * burst;
    const vy = bvy + dy / d * burst;
    const ang = a0 + (h5 - 0.5) * 1.2;
    const sp = (h6 < 0.5 ? -1 : 1) * (tune.spinMin + Math.abs(h6 - 0.5) * 2 * (tune.spinMax - tune.spinMin));
    const ttl = tune.ttl * (0.9 + 0.2 * h7);
    insert(st, cargoResourceIndex(p.res), p.units, p.mpu, x, y, vx, vy, ang, sp, ttl, seed, k);
    st.stats.spawned++;
    st.stats.spawnedUnits += p.units;
  }
  return plan.length;
}

/** Wstawienie celu wiązki do posortowanej listy najbliższych (bez alokacji). */
function considerTarget(st, i, d2, max) {
  const list = st.targets;
  const dist = st.targetD2;
  let n = st.targetCount;
  if (n >= max && d2 >= dist[n - 1]) return;
  let k = n < max ? n : max - 1;
  while (k > 0 && dist[k - 1] > d2) {
    list[k] = list[k - 1];
    dist[k] = dist[k - 1];
    k--;
  }
  list[k] = i;
  dist[k] = d2;
  if (n < max) st.targetCount = n + 1;
}

/**
 * Krok puli (w `physicsStep`, czas gry). `env` (obiekt wielokrotnego użytku wołającego):
 *   px, py, pvx, pvy — statek gracza (środek, ruch); shipSpeed — jego prędkość [j./s];
 *   cx, cy — punkt chwytu (luk); gear — parametry sprzętu (`lootGearParams`) albo null (D15: bez sprzętu nic);
 *   visible(x, y) — mgła wojny (null = wszystko widać); free() — wolna masa ładowni [t];
 *   take(resKey, units) — przyjęcie do ładowni, zwraca przyjęte sztuki; onCollect(resKey, units, x, y) — komunikat.
 */
export function stepLootContainers(st, dt, env, tune = LOOT_TUNE) {
  st.targetCount = 0;
  if (!(dt > 0) || st.count === 0) return;
  const px = Number(env?.px) || 0;
  const py = Number(env?.py) || 0;
  const despawn2 = tune.despawnDist * tune.despawnDist;
  const damp = Math.exp(-tune.dampRate * dt);
  // Ruch, wiek, zanik — od końca (usuwanie zamianą z ostatnią nie przeskakuje paczek).
  for (let i = st.count - 1; i >= 0; i--) {
    st.flags[i] = 0;
    const age = st.age[i] + dt;
    st.age[i] = age;
    const dx = st.x[i] - px;
    const dy = st.y[i] - py;
    if (age >= st.ttl[i] || dx * dx + dy * dy > despawn2) {
      st.stats.expired++;
      st.stats.lostUnits += st.units[i];
      removeLootContainer(st, i);
      continue;
    }
    if (age > tune.dampAfter) {
      const vx = st.vx[i];
      const vy = st.vy[i];
      const v = Math.sqrt(vx * vx + vy * vy);
      if (v > tune.dampTo) {
        const k = Math.max(tune.dampTo / v, damp);
        st.vx[i] = vx * k;
        st.vy[i] = vy * k;
      }
    }
    st.x[i] += st.vx[i] * dt;
    st.y[i] += st.vy[i] * dt;
    st.ang[i] += st.spin[i] * dt;
  }
  const gear = env?.gear;
  if (!gear || gear.kind !== 'tractor' || st.count === 0) return;
  if ((Number(env.shipSpeed) || 0) > gear.maxShipSpeed) return;
  stepTractor(st, dt, env, gear);
}

function stepTractor(st, dt, env, gear) {
  let free = typeof env.free === 'function' ? Math.max(0, Number(env.free()) || 0) : Infinity;
  const cx = Number(env.cx) || 0;
  const cy = Number(env.cy) || 0;
  const range2 = gear.range * gear.range;
  const max = Math.min(st.targets.length, Math.max(1, gear.targets | 0));
  const visible = typeof env.visible === 'function' ? env.visible : null;
  for (let i = 0; i < st.count; i++) {
    // Wiązka nie łapie paczki, z której nie wejdzie choć jedna sztuka.
    if (st.mpu[i] > free) continue;
    const dx = st.x[i] - cx;
    const dy = st.y[i] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > range2) continue;
    if (visible && !visible(st.x[i], st.y[i])) continue;
    considerTarget(st, i, d2, max);
  }
  const n = st.targetCount;
  if (!n) return;
  const pvx = Number(env.pvx) || 0;
  const pvy = Number(env.pvy) || 0;
  const capture2 = gear.capture * gear.capture;
  const dvMax = gear.accel * dt;
  // Ściąganie: prędkość względna ku punktowi chwytu z hamowaniem (v = √(2 a d), sufit maxSpeed).
  for (let k = 0; k < n; k++) {
    const i = st.targets[k];
    st.flags[i] |= LOOT_FLAG.TRACTOR;
    const dx = cx - st.x[i];
    const dy = cy - st.y[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    const want = d > 1e-6 ? Math.min(gear.maxSpeed, Math.sqrt(2 * gear.accel * d)) / d : 0;
    let ex = dx * want - (st.vx[i] - pvx);
    let ey = dy * want - (st.vy[i] - pvy);
    const e = Math.sqrt(ex * ex + ey * ey);
    if (e > dvMax) { ex *= dvMax / e; ey *= dvMax / e; }
    st.vx[i] += ex;
    st.vy[i] += ey;
  }
  // Chwyt: od najwyższego indeksu (usuwanie zamianą z ostatnią nie rusza niższych celów).
  sortTargetsByIndexDesc(st);
  for (let k = 0; k < st.targetCount; k++) {
    const i = st.targets[k];
    const dx = st.x[i] - cx;
    const dy = st.y[i] - cy;
    if (dx * dx + dy * dy > capture2) continue;
    const key = cargoResourceKey(st.res[i]);
    const fits = Math.min(st.units[i], Math.floor(free / st.mpu[i]));
    const taken = fits > 0 && key && typeof env.take === 'function' ? Math.max(0, Math.floor(env.take(key, fits)) || 0) : 0;
    if (taken > 0) {
      free -= taken * st.mpu[i];
      st.units[i] -= taken;
      st.stats.collected++;
      st.stats.collectedUnits += taken;
      if (typeof env.onCollect === 'function') env.onCollect(key, taken, st.x[i], st.y[i]);
    }
    if (st.units[i] < 1) {
      removeLootContainer(st, i);
      continue;
    }
    // Reszta nie weszła (pełna ładownia): paczka wisi przy luku z prędkością statku.
    st.flags[i] |= LOOT_FLAG.HELD;
    st.vx[i] = pvx;
    st.vy[i] = pvy;
    st.stats.held++;
  }
  // Po chwycie indeksy celów są nieaktualne — lista wiązki do obrazu to flaga TRACTOR na paczce.
  st.targetCount = 0;
}

function sortTargetsByIndexDesc(st) {
  const a = st.targets;
  for (let k = 1; k < st.targetCount; k++) {
    const v = a[k];
    let j = k - 1;
    while (j >= 0 && a[j] < v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
}

/** Odległość² do najbliższej widocznej paczki od (x, y) (Infinity — brak). Do podpowiedzi HUD. */
export function nearestLootD2(st, x, y, visible = null) {
  let best = Infinity;
  for (let i = 0; i < st.count; i++) {
    const dx = st.x[i] - x;
    const dy = st.y[i] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= best) continue;
    if (visible && !visible(st.x[i], st.y[i])) continue;
    best = d2;
  }
  return best;
}
