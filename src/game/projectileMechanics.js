/**
 * projectileMechanics — przebicia i rykoszety pocisków na kadłubach belkowych
 * (mechanika z dema dema/bronie-webgpu: projectiles.js — przebicie z budżetem materiału
 * i hamowaniem; recipes.js — rykoszet działek). Decyzje z zadania 18 (docs/webgpu/PROJEKT-BRONI.md
 * §2.3, §5 p. 1, 2, 7):
 *  - rykoszet: kąt padania ponad ~65° od normalnej (dn ≥ −cosMax) i hash01(serial, węzeł) ≤ chance
 *    → obrażenia kadłuba × hullFrac, pocisk znika (smugowiec odbity jest kosmetyczny, ten sam hash);
 *  - przebicie: bronie z `penDepth` (Mjolnir ∞, Valkyrie 260 j.) przechodzą przez materiał
 *    z budżetem `penDepth`, hamując v·exp(−penSpeedLoss·6·t); N-ty kadłub (`penetration`)
 *    zatrzymuje pocisk; po wyjściu obrażenia = dmg0·(|v|/v0)²·(left/penDepth);
 *  - krater wyjścia = 0,5 × obrażeń po rozliczeniu (bez HP — HP spada przez sufit strukturalny),
 *    zakleszczenie (budżet wyczerpany w środku) = krater 0,5 × energii niesionej w tym kadłubie.
 *
 * Moduł bez Math.random i bez alokacji w gorącej ścieżce: stan w polach pocisku
 * (`b.serial`, `b.pen`), wyniki we współdzielonych obiektach. Zapytania kadłuba tylko przez
 * HullBodies (traceThrough). Wpięcie w bulletsAndCollisionsStep — zadanie 18-B (opis wpięcia:
 * docs/webgpu/MECHANIKA-BRONI.md).
 */

import { HullBodies } from './hullBodies.js';
import { writePointVelocity } from './carrierVelocity.js';

// Decyzja przy trafieniu w kadłub (resolveHullHit).
export const HIT_STOP = 'stop';
export const HIT_RICOCHET = 'ricochet';
export const HIT_PENETRATE = 'penetrate';

// Krok pocisku w materiale (stepInsideHull).
export const PASS_NONE = 'none';       // pocisk nie jest w kadłubie
export const PASS_INSIDE = 'inside';   // dalej w materiale
export const PASS_EXIT = 'exit';       // wyszedł: krater wyjścia, lot dalej z rozliczoną energią
export const PASS_STUCK = 'stuck';     // ugrzązł: wybuch i krater w środku, pocisk znika

export const PENETRATION_CONFIG = {
  speedLossRate: 6,        // demo: v·exp(−speedLoss·6·h) w każdym podkroku w materiale
  stuckSpeed: 300,         // demo: poniżej 300 j/s (względem kadłuba) pocisk grzęźnie
  kerfStep: 22,            // demo: znak rzazu co 22 j. drogi w materiale
  exitCraterFrac: 0.5,     // decyzja §5 p. 2: krater wyjścia = 0,5 × obrażenia (bez HP)
  stuckCraterFrac: 0.5,    // zakleszczenie: to samo prawo dla energii złożonej w środku
  ricochetJitter: 0.15,    // [rad] rozrzut kierunku smugowca odbitego (demo: rand(−0,15, 0,15))
  ricochetSpeedMin: 0.35,  // prędkość smugowca odbitego × 0,35–0,6 (demo)
  ricochetSpeedMax: 0.6,
  ricochetLifeMin: 0.2,    // życie smugowca odbitego 0,2–0,45 s (demo)
  ricochetLifeMax: 0.45
};

const P = PENETRATION_CONFIG;

// ============================ NUMER POCISKU I HASH ============================

let _serial = 0;

/** Kolejny numer pocisku (`b.serial` nadaje fireWeaponCore w 18-B) — źródło decyzji bez losowania. */
export function nextProjectileSerial() {
  _serial = (_serial + 1) >>> 0;
  return _serial;
}

/** Licznik od zera (testy, harness). */
export function resetProjectileSerial(value = 0) {
  _serial = (Number(value) >>> 0);
}

function mix32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Deterministyczny „rzut” w [0, 1) z numeru pocisku i węzła trafienia (sól rozdziela kolejne
 * wartości tego samego trafienia: 0 = decyzja, 1–3 = obraz rykoszetu). Bez Math.random —
 * sekwencja losowań gry się nie zmienia, a ta sama sytuacja daje ten sam wynik.
 */
export function hash01(serial, node, salt = 0) {
  let h = mix32(((serial | 0) ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0);
  h = mix32((h ^ Math.imul(((node | 0) + 0x632be5ab) | 0, 0x85ebca6b)) >>> 0);
  return h / 4294967296;
}

// ============================ DANE BRONI ============================

/** Budżet materiału przebicia [j.] (`penDepth`, Infinity = bez limitu) albo 0 — broń nie przebija. */
export function penetrationDepthOf(def) {
  const d = Number(def?.penDepth);
  return d > 0 ? d : 0;
}

/** Ile kadłubów pocisk może trafić (istniejące pole `penetration`; N-ty go zatrzymuje). */
export function penetrationLimitOf(def) {
  const n = Math.round(Number(def?.penetration));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Mnożnik obrażeń kadłuba przy rykoszecie (1 = broń bez rykoszetu). */
export function ricochetDamageFactor(def) {
  const f = Number(def?.ricochet?.hullFrac);
  return def?.ricochet && Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 1;
}

// ============================ TRAFIENIE ============================

function createPenState() {
  return {
    entity: null,     // encja kadłuba, w którym pocisk jest (null = na zewnątrz)
    body: null,       // jego ciało — przeżywa convertToWreck (encja statku → wrak)
    lastBody: null,   // ciało, z którego pocisk wyszedł w tym kroku (pętla kandydatów je pomija)
    bodies: [],       // ciała, w które pocisk już wszedł (≤ penetration)
    repeat: false,    // ostatnie wejście = ponowne w ten sam kadłub (wklęsła sylwetka)
    left: 0,          // budżet materiału [j.]
    count: 0,         // ile RÓŻNYCH kadłubów pocisk już trafił (z bieżącym)
    v0: 0,            // prędkość względem celu przy pierwszym wejściu
    dmg0: 0,          // obrażenia przy pierwszym wejściu
    vIn: 0,           // prędkość względem kadłuba przy wejściu w bieżący kadłub
    x: 0, y: 0,       // ostatni punkt w materiale (świat gry) — początek następnego odcinka
    kerfAcc: 0        // droga w materiale od ostatniego znaku rzazu
  };
}

/**
 * Co robi pocisk `b` po trafieniu w kadłub (przed obrażeniami):
 *  - HIT_RICOCHET — broń z `ricochet`, kąt padania płaski (kierunek·normalna ≥ −cosMax)
 *    i hash01(b.serial, node) ≤ chance: obrażenia × ricochetDamageFactor(def), pocisk znika;
 *  - HIT_PENETRATE — broń z `penDepth`, to nie N-ty kadłub (`penetration`) i jest budżet:
 *    `b.pen` dostaje stan przejścia (encja, punkt wejścia, budżet, prędkość i obrażenia
 *    wejścia); obrażenia wejścia jak dziś, potem stepInsideHull w tym samym kroku;
 *  - HIT_STOP — jak dziś (krater, obrażenia, pocisk znika).
 * Ponowne wejście pocisku w ten sam kadłub (wklęsła sylwetka: wyjście z jednego ramienia,
 * wejście w drugie) nie liczy się do limitu `penetration` i nie daje drugi raz HP —
 * `b.pen.repeat`, mnożniki w entryDamage(); kratery zostają (to nowa dziura).
 * normal: { nx, ny } na zewnątrz (HullBodies.surfaceNormal przed impact()); relVel: prędkość
 * pocisku względem trafionego punktu kadłuba { x, y } (brak = b.vx/b.vy); node: węzeł trafienia
 * (hash); entity, hitX, hitY: kadłub i punkt wejścia (potrzebne tylko do przebicia).
 */
export function resolveHullHit(b, def, normal, relVel, node = -1, entity = null, hitX = b?.x, hitY = b?.y) {
  if (!b || !def) return HIT_STOP;
  const vx = Number(relVel?.x ?? b.vx) || 0;
  const vy = Number(relVel?.y ?? b.vy) || 0;
  const speed = Math.sqrt(vx * vx + vy * vy);

  const ric = def.ricochet;
  if (ric && normal && speed > 1e-9) {
    const dn = (vx * normal.nx + vy * normal.ny) / speed;
    const cosMax = Number(ric.cosMax) || 0;
    const chance = Number(ric.chance) || 0;
    if (dn >= -cosMax && hash01(b.serial, node) <= chance) return HIT_RICOCHET;
  }

  const depth = penetrationDepthOf(def);
  if (depth <= 0) return HIT_STOP;
  let pen = b.pen;
  const body = (entity?._realEntity || entity)?.beamHull?.body || null;
  const first = !pen || pen.count <= 0;
  const repeat = !first && !!body && pen.bodies.indexOf(body) >= 0;
  if (pen) pen.repeat = repeat;
  const count = (first ? 0 : pen.count) + (repeat ? 0 : 1);
  if (!repeat && count >= penetrationLimitOf(def)) return HIT_STOP;
  if (!first && !(pen.left > 0)) return HIT_STOP;
  if (!pen) pen = b.pen = createPenState();
  if (first) {
    pen.left = depth;
    pen.v0 = speed;
    pen.dmg0 = Number(b.damage) || 0;
    pen.bodies.length = 0;
  }
  if (!repeat && body) pen.bodies.push(body);
  pen.count = count;
  pen.vIn = speed;
  pen.entity = entity || null;
  pen.body = body;
  pen.lastBody = null;
  pen.x = Number.isFinite(hitX) ? hitX : (Number(b.x) || 0);
  pen.y = Number.isFinite(hitY) ? hitY : (Number(b.y) || 0);
  pen.kerfAcc = 0;
  return HIT_PENETRATE;
}

/** Wynik entryDamage() — mnożniki obrażeń pocisku przy wejściu: HP (applyDamageToNPC) i krater. */
export const entryDamageResult = { hp: 1, crater: 1 };

/**
 * Obrażenia wejścia dla decyzji resolveHullHit (mnożniki b.damage): rykoszet — hullFrac
 * na HP i krater (decyzja §5 p. 1); ponowne wejście w ten sam kadłub — krater tak, HP nie;
 * reszta — pełne, jak dziś.
 */
export function entryDamage(b, def, decision, out = entryDamageResult) {
  out.hp = 1;
  out.crater = 1;
  if (decision === HIT_RICOCHET) {
    out.hp = out.crater = ricochetDamageFactor(def);
  } else if (b?.pen?.repeat) {
    out.hp = 0;
  }
  return out;
}

/** Wynik ricochetBounce() — kierunek (świat gry), mnożnik prędkości i życie smugowca odbitego. */
export const ricochetResult = { dirX: 0, dirY: 0, speedFactor: 0, life: 0 };

/**
 * Obraz rykoszetu (kosmetyczny smugowiec, receptura z 17): odbicie kierunku względem normalnej
 * z rozrzutem i prędkością z tego samego hasha co decyzja (sole 1–3) — bez Math.random.
 * Prędkość smugowca = |v względem kadłuba| · speedFactor (plus nośnik kadłuba).
 */
export function ricochetBounce(b, normal, relVel, node = -1, out = ricochetResult) {
  const vx = Number(relVel?.x ?? b?.vx) || 0;
  const vy = Number(relVel?.y ?? b?.vy) || 0;
  const l = Math.sqrt(vx * vx + vy * vy);
  const dx = l > 1e-9 ? vx / l : 1, dy = l > 1e-9 ? vy / l : 0;
  const nx = Number(normal?.nx) || 0, ny = Number(normal?.ny) || 0;
  const dn = dx * nx + dy * ny;
  const rx = dx - 2 * dn * nx, ry = dy - 2 * dn * ny;
  const serial = b?.serial;
  const a = Math.atan2(ry, rx) + (hash01(serial, node, 1) * 2 - 1) * P.ricochetJitter;
  out.dirX = Math.cos(a);
  out.dirY = Math.sin(a);
  out.speedFactor = P.ricochetSpeedMin + hash01(serial, node, 2) * (P.ricochetSpeedMax - P.ricochetSpeedMin);
  out.life = P.ricochetLifeMin + hash01(serial, node, 3) * (P.ricochetLifeMax - P.ricochetLifeMin);
  return out;
}

// ============================ W MATERIALE ============================

/** Czy pocisk jest teraz w materiale kadłuba. */
export function isInsideHull(b) {
  return !!b?.pen?.body;
}

/**
 * Czy pętla kandydatów ma pominąć kadłub encji dla tego pocisku: pocisk jest w jego
 * materiale (liczy go stepInsideHull) albo właśnie z niego wyszedł w tym kroku.
 * Porównanie po ciele — encja statku mogła w międzyczasie oddać kadłub wrakowi.
 */
export function skipsHull(b, entity) {
  const pen = b?.pen;
  if (!pen) return false;
  const body = (entity?._realEntity || entity)?.beamHull?.body;
  return !!body && (body === pen.body || body === pen.lastBody);
}

/** Obrażenia po wyjściu z kadłuba: dmg0 · (|v|/v0)² · (left / penDepth); penDepth ∞ bez ostatniego czynnika. */
export function settledDamage(pen, speed, depth) {
  const k = pen.v0 > 0 ? speed / pen.v0 : 1;
  const energy = pen.dmg0 * k * k;
  return Number.isFinite(depth) && depth > 0 ? energy * Math.max(0, Math.min(1, pen.left / depth)) : energy;
}

/**
 * Wynik stepInsideHull() — współdzielony, ważny do następnego wywołania.
 * event: PASS_*; entity — kadłub (po convertToWreck to już wrak); x, y, t — punkt wyjścia /
 * zakleszczenia (t na odcinku kroku); solidLen — droga w materiale w tym kroku;
 * kerfs — liczba znaków rzazu w tym kroku, pierwszy w (kerfX, kerfY), następne co
 * (kerfDX, kerfDY); craterDamage — obrażenia krateru wyjścia / zakleszczenia dla
 * HullBodies.impact (bez obrażeń HP).
 */
export const hullPassResult = {
  event: PASS_NONE, entity: null, x: 0, y: 0, t: 0, solidLen: 0,
  kerfs: 0, kerfX: 0, kerfY: 0, kerfDX: 0, kerfDY: 0, craterDamage: 0
};

const _cv = { x: 0, y: 0 };
const _trace = { solidLen: 0, entryT: -1, exitT: -1, node: -1 };

function resetPass(out, b) {
  out.event = PASS_NONE;
  out.entity = null;
  out.x = Number(b?.x) || 0;
  out.y = Number(b?.y) || 0;
  out.t = 0;
  out.solidLen = 0;
  out.kerfs = 0;
  out.kerfX = 0;
  out.kerfY = 0;
  out.kerfDX = 0;
  out.kerfDY = 0;
  out.craterDamage = 0;
  return out;
}

function leaveHull(pen) {
  pen.lastBody = pen.body;
  pen.body = null;
  pen.entity = null;
}

// Znaki rzazu co kerfStep drogi w materiale (licznik przez kolejne kroki jak w demie).
function writeKerfs(pen, sx, sy, dx, dy, len, out) {
  const step = P.kerfStep;
  if (!(step > 0) || !(len > 0)) return;
  const first = step - pen.kerfAcc;
  if (len < first) { pen.kerfAcc += len; return; }
  const n = 1 + Math.floor((len - first) / step);
  out.kerfs = n;
  out.kerfX = sx + dx * first;
  out.kerfY = sy + dy * first;
  out.kerfDX = dx * step;
  out.kerfDY = dy * step;
  pen.kerfAcc = (len - first) - (n - 1) * step;
}

/**
 * Krok pocisku w materiale (po stepProjectileKinematics i w kroku wejścia — zaraz po
 * HIT_PENETRATE): odcinek od ostatniego punktu w materiale (`b.pen.x/y`) do (b.x, b.y),
 * HullBodies.traceThrough → budżet −= droga w materiale, hamowanie względem kadłuba
 * (t = droga / |v|; zmienia b.vx/b.vy), znaki rzazu, potem:
 *  - PASS_EXIT — wyjście: b.damage rozliczone (settledDamage), craterDamage = 0,5 × b.damage,
 *    pocisk leci dalej (pętla kandydatów w tym kroku pomija kadłub wyjścia — skipsHull);
 *  - PASS_STUCK — budżet wyczerpany albo |v| < stuckSpeed: craterDamage = 0,5 × obrażeń
 *    niesionych w tym kadłubie × (|v|/v_wejścia)², pocisk do usunięcia;
 *  - PASS_INSIDE — dalej w środku; PASS_NONE — pocisk nie był w kadłubie (czyści pominięcie
 *    kadłuba wyjścia z poprzedniego kroku).
 * Kadłub, który zniknął (okruch, rozpad), = wyjście w ostatnim punkcie bez krateru.
 */
export function stepInsideHull(b, def, out = hullPassResult) {
  resetPass(out, b);
  const pen = b?.pen;
  if (!pen) return out;
  if (!pen.body) { pen.lastBody = null; return out; }
  const body = pen.body;
  const entity = body.entity || null;
  const depth = penetrationDepthOf(def);
  if (!entity || body.dead || entity.beamHull?.body !== body || !HullBodies.hasHull(entity)) {
    out.event = PASS_EXIT;
    out.entity = entity;
    out.x = pen.x;
    out.y = pen.y;
    b.damage = settledDamage(pen, pen.vIn, depth);
    leaveHull(pen);
    return out;
  }
  pen.entity = entity;
  out.entity = entity;
  const x0 = pen.x, y0 = pen.y;
  const sx = (Number(b.x) || 0) - x0, sy = (Number(b.y) || 0) - y0;
  const segLen = Math.sqrt(sx * sx + sy * sy);
  if (segLen < 1e-9) { out.event = PASS_INSIDE; return out; }
  const ux = sx / segLen, uy = sy / segLen;

  // Materiał leci z kadłubem: hamowanie i próg zakleszczenia względem niego.
  writePointVelocity(entity, x0, y0, _cv);
  let rvx = b.vx - _cv.x, rvy = b.vy - _cv.y;
  let speed = Math.sqrt(rvx * rvx + rvy * rvy);

  const tr = HullBodies.traceThrough(entity, x0, y0, b.x, b.y, Number(b.r) || 0, _trace);
  if (!tr || tr.entryT < 0) {
    // Na odcinku nie ma już materiału (pocisk stał na brzegu, kadłub się obrócił): wyjście w starcie.
    out.event = PASS_EXIT;
    out.x = x0;
    out.y = y0;
    b.damage = settledDamage(pen, speed, depth);
    out.craterDamage = P.exitCraterFrac * b.damage;
    leaveHull(pen);
    pen.x = x0;
    pen.y = y0;
    return out;
  }
  const runStart = tr.entryT;
  const runEnd = tr.exitT >= 0 ? tr.exitT : 1;
  let consumed = tr.solidLen;
  let stuck = false;
  let stuckT = runEnd;
  // Budżet kończy się przed wyjściem → zakleszczenie tam, gdzie się skończył (jak w demie
  // wyjście wygrywa, gdy budżet starcza dokładnie do brzegu).
  if (pen.left < consumed) {
    stuck = true;
    consumed = Math.max(0, pen.left);
    stuckT = Math.min(runEnd, runStart + consumed / segLen);
  }
  if (Number.isFinite(pen.left)) pen.left = Math.max(0, pen.left - consumed);
  out.solidLen = consumed;

  const loss = Number(def?.penSpeedLoss) || 0;
  if (loss > 0 && consumed > 0 && speed > 1e-9) {
    const k = Math.exp(-loss * P.speedLossRate * consumed / speed);
    rvx *= k;
    rvy *= k;
    speed *= k;
    b.vx = _cv.x + rvx;
    b.vy = _cv.y + rvy;
  }
  // Za wolny w materiale grzęźnie na końcu kroku (wyjście w tym kroku wygrywa, jak w demie).
  if (!stuck && tr.exitT < 0 && speed < P.stuckSpeed) stuck = true;

  writeKerfs(pen, x0 + sx * runStart, y0 + sy * runStart, ux, uy, consumed, out);

  if (stuck) {
    out.event = PASS_STUCK;
    out.t = stuckT;
    out.x = x0 + sx * stuckT;
    out.y = y0 + sy * stuckT;
    const k = pen.vIn > 0 ? speed / pen.vIn : 1;
    out.craterDamage = P.stuckCraterFrac * (Number(b.damage) || 0) * k * k;
    pen.left = 0;
    leaveHull(pen);
    pen.x = out.x;
    pen.y = out.y;
    return out;
  }
  if (tr.exitT >= 0) {
    out.event = PASS_EXIT;
    out.t = tr.exitT;
    out.x = x0 + sx * tr.exitT;
    out.y = y0 + sy * tr.exitT;
    b.damage = settledDamage(pen, speed, depth);
    out.craterDamage = P.exitCraterFrac * b.damage;
    leaveHull(pen);
    pen.x = out.x;
    pen.y = out.y;
    return out;
  }
  out.event = PASS_INSIDE;
  pen.x = b.x;
  pen.y = b.y;
  return out;
}
