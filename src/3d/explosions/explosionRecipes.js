// src/3d/explosions/explosionRecipes.js
//
// RECEPTURY WYBUCHÓW (dane, bez three i bez DOM) — wybuchy WebGPU gry (explosionFx.js): suchy dok piratów
// (progi punktów, łańcuch rozpadu misji 1), rozpad stacji (Destruction3D), śmierć gracza bez rdzenia,
// skrypty (`window.makeReactorBlow({ x, y, size, profile })`). Zastępują dawny wybuch reaktora
// src/effects3d/reactorblow.js (port overlaya WebGL) — użytkownik 2026-10-07: „tragiczne, do usunięcia”.
//
// Jednostka `size` jak w dawnej fabryce: j. świata gry (Atlas ≈ 280 = 0,35 długości kadłuba). Profil mówi,
// JAK wybucha (kula ognia z gazu albo z cząstek, iskry, odłamki, dym, światło, fala, wtórne); wymiary
// efektu to mnożniki `size`. Liczby cząstek skalują się pierwiastkiem z rozmiaru (`countScale`) — duży
// wybuch ma więcej, ale nie 10× więcej iskier.
//
// LOD (`explosionLod`): kula ognia z GAZU (siatka 3D w compute — src/3d/gas/) tylko w kadrze i od
// GAS_MIN_PX promienia na ekranie; mniejsze — wersja z CZĄSTEK (ogień ADD broni, dym rakiet, iskry);
// poza kadrem — samo światło (sięga w kadr), bez cząstek i gazu.

/** Promień kuli ognia [px ekranu], od którego wybuch dostaje gaz (mniejszy — cząstki). */
export const GAS_MIN_PX = 14;
/** Zapas kadru [ułamek połowy kadru + j. świata], w którym wybuch jeszcze rysuje cząstki i gaz. */
export const VIEW_MARGIN_FRAC = 0.25;
export const VIEW_MARGIN_UNITS = 600;
/** Rozmiar odniesienia liczb cząstek (dawny „capital” Atlasa). */
export const COUNT_REF_SIZE = 300;

/**
 * Profile (klucze dawnej fabryki reactorblow.js + nowe). Pola:
 *   fire       — promień kuli ognia / size,
 *   gas        — kula ognia z gazu dozwolona (fighter: zawsze cząstki),
 *   power      — paliwo i jasność kuli ognia,
 *   lobes      — [min, max] kłębów paliwa wokół rdzenia (nieregularna kula),
 *   trails     — [min, max] płonących odłamków ze smugą ognia i dymu („pająk”),
 *   jets       — [min, max] strumieni gazu bijących z miejsca wybuchu (rozerwane rury, wyrwy — gaz wychodzi
 *                z punktu i leci dalej własnym pędem; część z ogniem, część sam dym),
 *   sparks     — iskier przy size = COUNT_REF_SIZE,
 *   embers     — żaru porywanego przez gaz (tylko z gazem),
 *   chunks     — rozżarzonych odłamków konstrukcji,
 *   smoke      — ilość dymu (1 = wybuch okrętu),
 *   flash      — błysk (rdzeń + poświata),
 *   light      — moc świateł w siatce (oświetlają kadłuby obok),
 *   shock      — fala uderzeniowa (SAMA refrakcja; 0 = bez),
 *   haze       — gorące powietrze nad kulą ognia,
 *   secondaries — [min, max] wybuchów wtórnych,
 *   afterburn  — dogasające ogniska [s] (0 = bez),
 *   life       — mnożnik czasu dymu.
 */
export const EXPLOSION_PROFILES = Object.freeze({
  // Drobne błyski rozpadu (Destruction3D: impulsy przy pękaniu skorupy, size 14–40).
  fighter: Object.freeze({ fire: 1.1, gas: false, power: 0.55, lobes: [2, 3], trails: [0, 1], jets: [0, 0], sparks: 70, embers: 0, chunks: 4, smoke: 0.35, flash: 0.7, light: 0.55, shock: 0, haze: 0.5, secondaries: [0, 0], afterburn: 0, life: 0.7 }),
  // Fregata / korweta (dawne tiery kadłuba).
  escort: Object.freeze({ fire: 1.3, gas: true, power: 0.8, lobes: [3, 4], trails: [3, 5], jets: [1, 2], sparks: 300, embers: 700, chunks: 12, smoke: 0.8, flash: 0.85, light: 0.85, shock: 0.6, haze: 0.8, secondaries: [0, 1], afterburn: 0, life: 0.85 }),
  cruiser: Object.freeze({ fire: 1.4, gas: true, power: 0.9, lobes: [4, 5], trails: [4, 7], jets: [2, 3], sparks: 460, embers: 1100, chunks: 18, smoke: 0.95, flash: 0.95, light: 0.95, shock: 0.8, haze: 0.9, secondaries: [1, 2], afterburn: 1.0, life: 0.95 }),
  // Domyślny: wybuch okrętu liniowego / dużej konstrukcji (kawałek suchego doku, śmierć gracza bez rdzenia).
  capital: Object.freeze({ fire: 1.6, gas: true, power: 1.0, lobes: [4, 7], trails: [6, 9], jets: [2, 4], sparks: 640, embers: 1600, chunks: 26, smoke: 1.0, flash: 1.0, light: 1.0, shock: 1.0, haze: 1.0, secondaries: [1, 2], afterburn: 1.6, life: 1.0 }),
  // Rozpad stacji: wybuchy łańcuchowe przy oderwanych fragmentach, cięcie skorupy, finał.
  chain: Object.freeze({ fire: 1.15, gas: true, power: 0.8, lobes: [3, 5], trails: [3, 6], jets: [1, 3], sparks: 340, embers: 800, chunks: 12, smoke: 0.8, flash: 0.85, light: 0.85, shock: 0.6, haze: 0.8, secondaries: [0, 1], afterburn: 0, life: 0.85 }),
  cut: Object.freeze({ fire: 1.45, gas: true, power: 1.0, lobes: [4, 6], trails: [5, 8], jets: [2, 3], sparks: 520, embers: 1300, chunks: 20, smoke: 1.0, flash: 1.0, light: 1.0, shock: 0.9, haze: 1.0, secondaries: [1, 2], afterburn: 1.0, life: 1.0 }),
  final: Object.freeze({ fire: 2.0, gas: true, power: 1.3, lobes: [6, 8], trails: [10, 14], jets: [4, 6], sparks: 1300, embers: 2600, chunks: 44, smoke: 1.35, flash: 1.3, light: 1.4, shock: 1.4, haze: 1.3, secondaries: [2, 4], afterburn: 2.4, life: 1.25 })
});

export const DEFAULT_EXPLOSION_PROFILE = 'capital';

/** Profil po nazwie (nieznany — domyślny). */
export function explosionProfile(name) {
  return EXPLOSION_PROFILES[name] || EXPLOSION_PROFILES[DEFAULT_EXPLOSION_PROFILE];
}

/** Mnożnik liczb cząstek dla rozmiaru (pierwiastek względem COUNT_REF_SIZE, w [0,25; 2,2]). */
export function countScale(size) {
  const k = Math.sqrt(Math.max(0, Number(size) || 0) / COUNT_REF_SIZE);
  return k < 0.25 ? 0.25 : (k > 2.2 ? 2.2 : k);
}

/** Promień kuli ognia [j.] dla rozmiaru i profilu. */
export function fireRadius(size, profile) {
  return Math.max(1, Number(size) || 0) * (profile?.fire ?? 1.3);
}

export const LOD_OFF = 0;      // poza kadrem z zapasem — samo światło
export const LOD_PARTICLES = 1; // cząstki (bez gazu)
export const LOD_GAS = 2;       // kula ognia i dym z gazu + cząstki

/**
 * Poziom szczegółów wybuchu: R — promień kuli ognia [j.], pxPerUnit — px ekranu na j. świata w miejscu
 * wybuchu, inView — środek (z zapasem promienia dymu) w kadrze, gasAllowed — profil i przełączniki.
 */
export function explosionLod(R, pxPerUnit, inView, gasAllowed) {
  if (!inView) return LOD_OFF;
  if (gasAllowed && R * pxPerUnit >= GAS_MIN_PX) return LOD_GAS;
  return LOD_PARTICLES;
}

/**
 * Czy punkt (x, y) świata z promieniem `reach` leży w kadrze (x0..x1, y0..y1 — świat gry) z zapasem.
 * view — { x0, y0, x1, y1 } (Core3D.fx.view: już z zapasem FX_VIEW_MARGIN).
 */
export function explosionInView(view, x, y, reach) {
  if (!view) return true;
  const mx = (view.x1 - view.x0) * VIEW_MARGIN_FRAC * 0.5 + VIEW_MARGIN_UNITS + reach;
  const my = (view.y1 - view.y0) * VIEW_MARGIN_FRAC * 0.5 + VIEW_MARGIN_UNITS + reach;
  return x > view.x0 - mx && x < view.x1 + mx && y > view.y0 - my && y < view.y1 + my;
}

/** Losowa liczba całkowita z przedziału [a, b] profilu (rng.next() z [0, 1)). */
export function rollRange(range, rng) {
  const a = range[0] | 0;
  const b = range[1] | 0;
  if (b <= a) return a;
  return a + Math.floor(rng.next() * (b - a + 1));
}
