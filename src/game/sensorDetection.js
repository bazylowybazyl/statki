// ============================================================
// Wykrywanie czujnikami — ZASIĘG RADARÓW (2026-11-03, podwaliny; etap 1 = propozycje wyglądu w
// dema/radar-zasiegi.html, wpięcie w grę czeka na decyzje — docs/PLAN-zasieg-czujnikow.md).
// Czysta logika (bez three / DOM / window).
//
// Model w duchu Starsectora (tam: siła czujników + profil celu, oba w jednostkach odległości). Tu ILOCZYN — tę postać
// liczy już obraz sytuacji AI (src/ai/fleetAwareness.js, `detectedBy`: zasięg pasywny × wykrywalność klasy), a skala
// kadłubów od myśliwca po superkapitał jest za szeroka na sumę (Atlas widziałby myśliwiec z 80 km):
//
//   zasięg wykrycia = CZUJNIKI obserwatora [j.] × SYGNATURA celu [×] × OSŁONA terenu przy celu [×]
//
//  - CZUJNIKI: zasięg pasywny profilu (SHIP_SENSOR_PROFILES.passiveRange — fregata 18 km … Atlas 80 km, Corvus 42 km),
//    po impulsie skanera X rośnie ku aktywnemu (`activeRange`), cicha praca go obcina.
//  - SYGNATURA: wykrywalność klasy (getEntitySizeModifier z sensorSystem.js: myśliwiec 0,5 … stacja 1,5) × STAN
//    bytu: ciąg silnika, dopalacz / hipercruise / warp, ciepło ostrzału, impuls skanera, cicha praca, wrak.
//  - OSŁONA: teren przy celu (gęste pole pasa asteroid, gaz) — liczy gra, tu tylko mnożnik.
//
// Poziomy: KONTAKT — cel w zasięgu wykrycia: wiadomo, że coś jest (przybliżone miejsce, rozmiar z sygnatury);
// IDENTYFIKACJA — cel w zasięgu wzroku (dziś mgła wojny gracza, src/game/fogOfWar.js: klasa, strona, namiar).
// Stan neutralny (bez ciągu, ostrzału, impulsu, cichej pracy) daje mnożniki 1 — koło AI bit w bit jak dziś.
// ============================================================

export const SENSOR_LEVEL = Object.freeze({ NONE: 0, CONTACT: 1, IDENTIFIED: 2 });

// Tryb napędu w stanie czujników (tabela prędkości — src/data/driveModes.js; tu tylko, jak bardzo napęd świeci).
export const SENSOR_DRIVE = Object.freeze({ combat: 0, boost: 1, hyper: 2, warp: 3 });

export const DETECTION_TUNE = Object.freeze({
  signature: Object.freeze({
    // Pełny ciąg MAIN dokłada tyle do sygnatury (liniowo z ułamkiem ciągu 0..1).
    thrustAdd: 0.35,
    // Napęd: mnożnik sygnatury wg SENSOR_DRIVE (dopalacz, hipercruise, warp — skok widać z daleka).
    driveMul: Object.freeze([1, 1.25, 2.5, 4]),
    // Ostrzał: świeży strzał dokłada fireAdd, ciepło gaśnie liniowo przez fireSec (jak odsłona mgły po trafieniu, 4 s).
    fireAdd: 0.6,
    fireSec: 4,
    // Impuls skanera X: aktywny radar zdradza nadawcę.
    pingAdd: 1.0,
    pingSec: 3,
    // Cicha praca (zgaszone emisje, jak „Go Dark” w Starsectorze).
    silentMul: 0.5,
    wreckMul: 0.3,
    // Podłoga — nawet zgaszony wrak w pasie da się wykryć z bliska.
    min: 0.05
  }),
  strength: Object.freeze({
    // Cicha praca obcina też czujniki (wyłączone emitery).
    silentMul: 0.6
  }),
  // Osłona terenu przy celu (mnożnik sygnatury). Gra wybiera wartość z pola pasa / gazu w miejscu celu.
  cover: Object.freeze({ open: 1, beltRim: 0.8, belt: 0.6, gas: 0.5 }),
  // Rozmiar kontaktu z sygnatury: progi MAŁY / ŚREDNI / DUŻY (powyżej — OGROMNY).
  sizeBands: Object.freeze([0.6, 0.9, 1.2]),
  // Niepewność miejsca KONTAKTU: błąd = errFrac × odległość × (0 przy granicy identyfikacji … 1 przy granicy wykrycia);
  // przesunięcie wędruje płynnie, nowe co jitterSec (deterministycznie z id — bez Math.random).
  contactErrFrac: 0.07,
  contactJitterSec: 2.5
});

export const SENSOR_SIZE_LABELS = Object.freeze(['MAŁY', 'ŚREDNI', 'DUŻY', 'OGROMNY']);

/** Stan czujnikowy bytu (pisze go gra: ciąg, napęd, strzały, impuls X, cicha praca). */
export function createSensorState() {
  return { thrust: 0, drive: SENSOR_DRIVE.combat, fireHeat: 0, pingHeat: 0, silent: false, wreck: false };
}

export function resetSensorState(s) {
  s.thrust = 0; s.drive = SENSOR_DRIVE.combat; s.fireHeat = 0; s.pingHeat = 0; s.silent = false; s.wreck = false;
  return s;
}

/** Strzał (broń główna, rakieta): ciepło na pełne. weight < 1 — słabsza broń (obrona punktowa). */
export function noteSensorFire(s, weight = 1) {
  const w = weight > 0 ? (weight < 1 ? weight : 1) : 0;
  if (w > s.fireHeat) s.fireHeat = w;
}

/** Impuls skanera X (aktywny radar). */
export function noteSensorPing(s) {
  s.pingHeat = 1;
}

/** Gaśnięcie ciepła ostrzału i impulsu — liniowo w czasie (wynik nie zależy od kroku fizyki). */
export function stepSensorState(s, dt, tune = DETECTION_TUNE) {
  const t = dt > 0 ? dt : 0;
  if (s.fireHeat > 0) s.fireHeat = Math.max(0, s.fireHeat - t / tune.signature.fireSec);
  if (s.pingHeat > 0) s.pingHeat = Math.max(0, s.pingHeat - t / tune.signature.pingSec);
}

/** Mnożnik sygnatury ze stanu (1 = stan neutralny). */
export function signatureMul(s, tune = DETECTION_TUNE) {
  if (!s) return 1;
  const T = tune.signature;
  const thrust = s.thrust > 0 ? (s.thrust < 1 ? s.thrust : 1) : 0;
  let m = 1 + T.thrustAdd * thrust;
  m *= T.driveMul[s.drive | 0] || 1;
  if (s.fireHeat > 0) m *= 1 + T.fireAdd * s.fireHeat;
  if (s.pingHeat > 0) m *= 1 + T.pingAdd * s.pingHeat;
  if (s.silent) m *= T.silentMul;
  if (s.wreck) m *= T.wreckMul;
  return m;
}

/** Sygnatura bytu: wykrywalność klasy × stan (z podłogą). */
export function entitySignature(base, s, tune = DETECTION_TUNE) {
  const b = base > 0 ? base : 0;
  const v = b * signatureMul(s, tune);
  return v > tune.signature.min ? v : tune.signature.min;
}

/**
 * Moc czujników [j.]: zasięg pasywny, po impulsie X rośnie ku aktywnemu (`active` ≤ passive — bez zmiany),
 * cicha praca obcina.
 */
export function sensorStrength(passive, active, s, tune = DETECTION_TUNE) {
  let v = passive > 0 ? passive : 0;
  if (s && s.pingHeat > 0 && active > v) v += (active - v) * s.pingHeat;
  if (s && s.silent) v *= tune.strength.silentMul;
  return v;
}

/** Zasięg wykrycia celu przez obserwatora [j.]. */
export function detectionRange(strength, signature, cover = 1) {
  return strength * signature * cover;
}

/** Poziom wykrycia z kwadratu odległości i promieni (identyfikacja wygrywa — wzrok widzi niezależnie od sygnatury). */
export function detectionLevel(dist2, detectR, identR) {
  if (identR > 0 && dist2 <= identR * identR) return SENSOR_LEVEL.IDENTIFIED;
  if (detectR > 0 && dist2 <= detectR * detectR) return SENSOR_LEVEL.CONTACT;
  return SENSOR_LEVEL.NONE;
}

/** Rozmiar KONTAKTU z sygnatury: 0 MAŁY, 1 ŚREDNI, 2 DUŻY, 3 OGROMNY (napis: SENSOR_SIZE_LABELS). */
export function contactSizeClass(signature, tune = DETECTION_TUNE) {
  const B = tune.sizeBands;
  for (let i = 0; i < B.length; i++) if (signature < B[i]) return i;
  return B.length;
}

// Hasz 32-bit (id, kubełek czasu, oś) → [0, 1). Deterministyczny; wizualia gry nie biorą Math.random.
function hash01(id, k, salt) {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((k | 0) + salt, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Przybliżone miejsce KONTAKTU: przesunięcie od prawdziwego (out.x, out.y — względne) i promień niepewności out.err.
 * Błąd rośnie od 0 na granicy identyfikacji do errFrac × odległość na granicy wykrycia; przesunięcie płynie między
 * losowaniami co jitterSec. `id` — liczba całkowita (numer bytu / śladu), `time` — czas gry [s].
 */
export function contactOffset(id, time, dist, detectR, identR, out, tune = DETECTION_TUNE) {
  const span = detectR - identR;
  let t = span > 0 ? (dist - identR) / span : 1;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const err = tune.contactErrFrac * dist * t;
  out.err = err;
  if (!(err > 0)) { out.x = 0; out.y = 0; return out; }
  const u = time / tune.contactJitterSec;
  const k = Math.floor(u);
  let f = u - k;
  f = f * f * (3 - 2 * f);
  // dwa losowania (kubełek i następny) w kole o promieniu err, płynne przejście
  const a0 = hash01(id, k, 11) * Math.PI * 2, r0 = Math.sqrt(hash01(id, k, 23));
  const a1 = hash01(id, k + 1, 11) * Math.PI * 2, r1 = Math.sqrt(hash01(id, k + 1, 23));
  const x0 = Math.cos(a0) * r0, y0 = Math.sin(a0) * r0;
  const x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
  out.x = (x0 + (x1 - x0) * f) * err;
  out.y = (y0 + (y1 - y0) * f) * err;
  return out;
}

// ---------------------------------------------------------------- obraz wykrycia stron
// Źródła: { x, y, strength, ident, side } (strength — sensorStrength; ident — zasięg wzroku albo 0), cele:
// { x, y, signature, cover, side }. Strona to dowolna wartość porównywana `!==` (np. 'friendly' / 'pirate');
// źródło nie wykrywa celów swojej strony. Wynik w tablicach typowanych (pula, bez alokacji przy stałej liczbie celów).

export function createDetectionPicture(cap = 64) {
  return {
    n: 0,
    level: new Uint8Array(cap),     // najlepszy poziom (SENSOR_LEVEL)
    seenBy: new Uint16Array(cap),   // ile źródeł ma cel co najmniej w KONTAKCIE
    depth: new Float64Array(cap),   // max po źródłach (zasięg wykrycia − odległość): > 0 — w zasięgu, < 0 — do krawędzi
    by: new Int32Array(cap),        // źródło z największą głębią (−1 — brak źródeł)
    detectR: new Float64Array(cap)  // zasięg wykrycia źródła `by`
  };
}

function growPicture(p, n) {
  if (p.level.length >= n) return;
  let cap = p.level.length || 16;
  while (cap < n) cap *= 2;
  p.level = new Uint8Array(cap);
  p.seenBy = new Uint16Array(cap);
  p.depth = new Float64Array(cap);
  p.by = new Int32Array(cap);
  p.detectR = new Float64Array(cap);
}

/** Kto z celów jest wykryty przez źródła strony przeciwnej (O(źródła × cele)). */
export function computeDetectionPicture(p, sources, nSources, targets, nTargets) {
  growPicture(p, nTargets);
  p.n = nTargets;
  for (let t = 0; t < nTargets; t++) {
    const tg = targets[t];
    const sig = tg.signature * (tg.cover >= 0 ? tg.cover : 1);
    let level = 0, seen = 0, depth = -Infinity, by = -1, byR = 0;
    for (let i = 0; i < nSources; i++) {
      const s = sources[i];
      if (s.side === tg.side) continue;
      const dx = tg.x - s.x, dy = tg.y - s.y;
      const d2 = dx * dx + dy * dy;
      const R = s.strength * sig;
      const lv = detectionLevel(d2, R, s.ident);
      if (lv > level) level = lv;
      if (lv > 0) seen++;
      const dep = (lv === SENSOR_LEVEL.IDENTIFIED && s.ident > R ? s.ident : R) - Math.sqrt(d2);
      if (dep > depth) { depth = dep; by = i; byR = R; }
    }
    p.level[t] = level;
    p.seenBy[t] = seen;
    p.depth[t] = depth;
    p.by[t] = by;
    p.detectR[t] = byR;
  }
  return p;
}
