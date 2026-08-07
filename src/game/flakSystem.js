// src/game/flakSystem.js
//
// FLAK — artyleria zaporowa z zapalnikiem czasowo-zbliżeniowym.
//
// Trzecia rodzina obrony punktowej obok CIWS (strumień pocisków) i lasera PD
// (natychmiastowa wiązka). Flak nie trafia w cel — wyrzuca pocisk, który pęka
// w POWIETRZU w wyliczonym punkcie wyprzedzenia i zasypuje odłamkami całą kulę
// o promieniu `burstRadius`. Dzięki temu jedna salwa zdejmuje formację
// myśliwców zamiast pojedynczej maszyny.
//
// Zapalnik jest podwójny, tak jak w prawdziwej artylerii plot.:
//   • czasowy    — pęka po `fuseTime` (dystans do punktu wyprzedzenia / prędkość),
//   • zbliżeniowy— pęka wcześniej, gdy coś wrogiego wejdzie w `fuseRadius`.
// Oba są zablokowane przez `ARM_TIME`, żeby pocisk nie eksplodował na własnym
// kadłubie tuż po wyjściu z lufy.
//
// Moduł jest CZYSTY (bez dostępu do stanu gry) — index.html podaje kandydatów,
// dostaje listę trafień. Dzięki temu balans daje się przetestować node:test.

export const FLAK_TUNING = Object.freeze({
  ARM_TIME: 0.07,          // [s] martwa strefa zapalnika po wystrzale
  FUSE_JITTER: 0.06,       // rozrzut zapalnika czasowego (± frakcja) — salwa pęka warstwami
  MIN_FUSE_TIME: 0.09,     // [s] najkrótszy sensowny lot (cel tuż przy burcie)
  MAX_FUSE_TIME: 8.0,      // [s] bezpiecznik — pocisk zawsze w końcu pęka
  EDGE_TAPER: 0.15,        // ostatnie 15% promienia wygasza obrażenia do zera
  // Zapora rani też swoich — gra ma friendly fire i flak nie jest od niego wyjęty.
  // 0.15 jest dobrane tak, żeby najcięższe pęknięcie (Perun, 460 dmg) dawało
  // swojemu przechwytywaczowi 69 obrażeń przy 80 HP: własna eskadra wychodzi
  // z zapory poobijana, ale żywa. Przy 0.25 Perun kasował własne myśliwce
  // jednym pęknięciem, a myśliwce ścigają dokładnie te cele, do których strzela.
  FRIENDLY_FACTOR: 0.15,
  SHELL_RADIUS: 3          // promień kolizyjny samego pocisku [u]
});

// Domyślne parametry rozbłysku per klasa hardpointu. Definicja broni może
// nadpisać każdy z nich (flakBurstRadius / flakFuseRadius / flakFalloff).
//
// Skala: myśliwiec ma promień 12 u i 80-150 HP, eskadra 9 maszyn w klinie
// rozciąga się na ~250-400 u. Stąd: S gasi pojedynczą maszynę, Capital wycina
// cały klin jednym pęknięciem.
// falloff trzymamy wspólny (0.35): gęstość odłamków spada tak samo niezależnie
// od kalibru, klasy różnią się PROMIENIEM i siłą ładunku. Zasięg śmiertelny
// wychodzi wtedy z relacji obrażenia/HP celu, a nie z osobnego pokrętła na tier.
export const FLAK_SIZE_DEFAULTS = Object.freeze({
  S: Object.freeze({ burstRadius: 95, fuseRadius: 34, falloff: 0.35, hullFactor: 0.10 }),
  M: Object.freeze({ burstRadius: 170, fuseRadius: 46, falloff: 0.35, hullFactor: 0.12 }),
  L: Object.freeze({ burstRadius: 270, fuseRadius: 62, falloff: 0.35, hullFactor: 0.14 }),
  Capital: Object.freeze({ burstRadius: 480, fuseRadius: 92, falloff: 0.35, hullFactor: 0.16 })
});

const FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone', 'bomber']);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

export function isFlakWeapon(def) {
  return String(def?.category || '').toLowerCase() === 'flak';
}

/**
 * Normalizuje definicję broni do parametrów zapalnika i rozbłysku.
 * Braki uzupełnia z FLAK_SIZE_DEFAULTS wg klasy hardpointu.
 */
export function resolveFlakProfile(def) {
  const size = String(def?.size || 'M').trim();
  const base = FLAK_SIZE_DEFAULTS[size] || FLAK_SIZE_DEFAULTS.M;
  return {
    size,
    damage: Math.max(0, num(def?.baseDamage, 60)),
    speed: Math.max(1, num(def?.baseSpeed, 1600)),
    range: Math.max(1, num(def?.baseRange, 2000)),
    burstRadius: Math.max(1, num(def?.flakBurstRadius, base.burstRadius)),
    fuseRadius: Math.max(0, num(def?.flakFuseRadius, base.fuseRadius)),
    falloff: clamp(num(def?.flakFalloff, base.falloff), 0, 1),
    hullFactor: clamp(num(def?.flakHullFactor, base.hullFactor), 0, 1),
    shells: Math.max(1, Math.floor(num(def?.burstCount, 1))),
    armTime: Math.max(0, num(def?.flakArmTime, FLAK_TUNING.ARM_TIME))
  };
}

/**
 * Obrażenia odłamków w odległości `dist` od środka pęknięcia.
 *
 * Rdzeń: LINIOWY spadek od `damage` w środku do `damage*falloff` przy krawędzi.
 * Spadek kwadratowy wyglądał "fizyczniej", ale ściskał strefę śmiertelną do
 * kilku jednostek wokół samego środka — lekki flak trafiał wtedy tylko przy
 * bezpośrednim uderzeniu i sprawiał wrażenie zepsutego. Liniowy daje kopułę
 * rażenia, którą widać w grze i którą da się wycelować.
 *
 * Ostatnie EDGE_TAPER promienia dogasza do zera, żeby nie było skokowej
 * ściany obrażeń tuż przy krawędzi kuli.
 */
export function flakDamageAt(dist, radius, damage, falloff = FLAK_SIZE_DEFAULTS.M.falloff) {
  const r = num(radius, 0);
  const d = num(dist, Infinity);
  if (!(r > 0) || !(d < r) || d < 0) return 0;
  const dmg = Math.max(0, num(damage, 0));
  if (dmg <= 0) return 0;
  const f = clamp(num(falloff, 0), 0, 1);
  const k = 1 - d / r;                      // 1 w środku → 0 na krawędzi
  const core = f + (1 - f) * k;
  const edge = Math.min(1, k / FLAK_TUNING.EDGE_TAPER);
  return dmg * core * edge;
}

/**
 * Promień, w którym pęknięcie ZABIJA cel o `hp` punktach wytrzymałości.
 * To jest właściwa miara siły flaku — nie same obrażenia, tylko jak szeroka
 * jest kopuła, w której myśliwiec po prostu przestaje istnieć.
 */
export function flakLethalRadius(def, hp = 120) {
  const p = resolveFlakProfile(def);
  const target = Math.max(1, num(hp, 120));
  if (p.damage < target) return 0;
  // Binarne szukanie brzegu — krzywa jest monotoniczna, więc 40 iteracji
  // daje dokładność ułamka jednostki nawet dla promienia 480 u.
  let lo = 0;
  let hi = p.burstRadius;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) * 0.5;
    if (flakDamageAt(mid, p.burstRadius, p.damage, p.falloff) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Zapalnik czasowy: kiedy pocisk ma pęknąć, żeby złapać cel w środek kuli.
 * `jitter` z zakresu [-1,1] rozrzuca salwę w głąb (każdy pocisk trochę inaczej).
 */
export function flakFuseTime(distance, speed, jitter = 0) {
  const d = Math.max(0, num(distance, 0));
  const v = Math.max(1, num(speed, 1));
  const j = clamp(num(jitter, 0), -1, 1) * FLAK_TUNING.FUSE_JITTER;
  return clamp(d / v * (1 + j), FLAK_TUNING.MIN_FUSE_TIME, FLAK_TUNING.MAX_FUSE_TIME);
}

/** Pocisk uzbrojony? Przed ARM_TIME żaden zapalnik nie zadziała. */
export function isFlakArmed(shell) {
  const age = num(shell?.flakAge, 0);
  const arm = num(shell?.flakArmTime, FLAK_TUNING.ARM_TIME);
  return age >= arm;
}

/**
 * Czy pocisk ma pęknąć w tym kroku?
 * @param {object} shell            pocisk (pole flakAge aktualizuje wywołujący)
 * @param {number} nearestHostile   dystans do najbliższego wrogiego celu (Infinity gdy brak)
 * @returns {''|'time'|'proximity'|'expired'}  powód pęknięcia ('' = leci dalej)
 */
export function flakDetonationReason(shell, nearestHostile = Infinity) {
  if (!shell) return '';
  const age = num(shell.flakAge, 0);
  if (isFlakArmed(shell)) {
    if (num(nearestHostile, Infinity) <= num(shell.flakFuseRadius, 0)) return 'proximity';
    if (age >= num(shell.flakFuseTime, Infinity)) return 'time';
  }
  if (num(shell.life, 1) <= 0) return 'expired';
  return '';
}

export function isFlakFighterTarget(entity) {
  if (!entity) return false;
  if (entity.fighter === true) return true;
  return FIGHTER_TYPES.has(String(entity.type || '').toLowerCase());
}

/**
 * Zbiera trafienia jednego pęknięcia.
 *
 * @param {{x:number,y:number,radius:number,damage:number,falloff:number,hullFactor:number,friendly:boolean,source:object}} burst
 * @param {Array<object>} candidates  encje z polami x, y, radius (npc, myśliwce, rakiety)
 * @param {Array<object>} out         bufor wyniku (reużywalny) — czyszczony na wejściu
 * @returns {Array<{entity:object,damage:number,dist:number}>}
 */
export function collectFlakBurstHits(burst, candidates, out = []) {
  out.length = 0;
  if (!burst || !Array.isArray(candidates) || candidates.length === 0) return out;

  const bx = num(burst.x, 0);
  const by = num(burst.y, 0);
  const radius = Math.max(0, num(burst.radius, 0));
  const damage = Math.max(0, num(burst.damage, 0));
  if (radius <= 0 || damage <= 0) return out;

  const falloff = clamp(num(burst.falloff, FLAK_SIZE_DEFAULTS.M.falloff), 0, 1);
  const hullFactor = clamp(num(burst.hullFactor, FLAK_SIZE_DEFAULTS.M.hullFactor), 0, 1);
  const shooterFriendly = burst.friendly === true;

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (!e || e === burst.source || e.dead === true || e.destroyed === true) continue;
    if (num(e.life, 1) <= 0) continue;

    const dx = num(e.x, num(e.pos?.x, NaN)) - bx;
    const dy = num(e.y, num(e.pos?.y, NaN)) - by;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;

    // Odłamki liczą się do OBRYSU celu, nie do jego środka — inaczej wielki
    // kadłub stojący krawędzią w chmurze odłamków nie dostawałby nic.
    const dist = Math.max(0, Math.hypot(dx, dy) - Math.max(0, num(e.radius, 0)));
    if (dist >= radius) continue;

    let dmg = flakDamageAt(dist, radius, damage, falloff);
    if (dmg <= 0) continue;

    // Flak to broń przeciwlotnicza: pancerz okrętu zjada większość odłamków.
    if (!isFlakFighterTarget(e)) dmg *= hullFactor;
    // Zapora nie odróżnia swoich od obcych, ale gra nie może karać za posiadanie eskorty.
    if ((e.friendly === true) === shooterFriendly) dmg *= FLAK_TUNING.FRIENDLY_FACTOR;
    if (dmg <= 0) continue;

    out.push({ entity: e, damage: dmg, dist });
  }
  return out;
}

/**
 * Ilu myśliwców o danym HP nie przeżyje jednego pęknięcia.
 *
 * Miara „pole śmiertelne / pole na maszynę”: myśliwce lecą w luźnym szyku
 * co `spacing` jednostek, więc w kopule o promieniu R mieści się ich
 * πR²/spacing². To jest oszacowanie GÓRNE dla zwartej formacji — służy do
 * porównywania klas między sobą i do pilnowania balansu w testach, nie do
 * przewidywania konkretnej walki.
 */
export function estimateFlakKills(def, fighterHp = 120, spacing = 90) {
  const lethal = flakLethalRadius(def, fighterHp);
  if (lethal <= 0) return 0;
  const step = Math.max(1, num(spacing, 90));
  const perShell = (Math.PI * lethal * lethal) / (step * step);
  return Math.round(perShell * resolveFlakProfile(def).shells);
}
