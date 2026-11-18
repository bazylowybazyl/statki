// HUTA — element 4: DZIELENIE TAŚMY NA ARKUSZE — GEOMETRIA, KRZYWKA NOŻA, CHWYT, STOJAK, KASETY (czyste liczby, bez three
// i DOM).
//
// Projekt: `.tmp/huta/formowanie/PROJEKT-dzielenie.md` (runda 8 — nóż) i `PROJEKT-chwyt-zwijanie.md` (runda 9 — wszystko po
// rozdzieleniu). Układ za klatką F3 (x od naczynia, z = +y gry — w dół ekranu, y w górę; oś taśmy y −1060, pokład y −1300):
//   NÓŻ POLOWY      dwa wózki na szynach po obu stronach taśmy (jedna grupa ruchoma), ostrze pola między nimi; wózki
//                   jadą KRZYWKĄ ELEKTRONICZNĄ sprzęgniętą z DROGĄ TAŚMY M (nie z czasem): faza u = drogi / P, w oknie
//                   synchronizacji (u ∈ [0, w]) wózek jedzie dokładnie z taśmą (g' = 1), poza nim wraca (g' < 0) —
//                   ruch okresowy bez postoju, g'' ciągłe. Rozdzielenie na końcu przemiatania ogniska (faza `U_CUT`) —
//                   zawsze na x `XB`; długość arkusza = L z drogi, przy każdej prędkości (runda 8, zasada G).
//   (runda 9) PO ROZDZIELENIU arkusz jest CIAŁEM SWOBODNYM w nieważkości: WYRZUT listwami pola wzdłuż obu krawędzi
//                   (+40 j./s w 0,2 s), LOT własnym pędem, CHWYT krawędzi −z polem LISTWY PRZECHYŁU (pole jedzie z krawędzią
//                   — prędkość względna 0), UNIESIENIE o 15 j. nad pasmo, HAMOWANIE w x do spoczynku z tyłem na `CHWYT.xStop`,
//                   PRZECHYŁ na sztorc wokół chwyconej krawędzi, MARSZ w −z GRZEBIENIEM pola do KASETY (8 arkuszy na sztorc
//                   co 24 j.), kaseta z pokrywą pola odjeżdża do ODBIORU i przez bramę WYJAZD KASET; ODPAD (czoło, ogon, metal
//                   mieszany, arkusz niezłapany) leci prosto w osi przez otwór PRZETOP w ścianie czołowej.
// Wszystkie liczby położeń w jednym miejscu (`DZIEL`, `CHWYT`, `STOJAK`, `KASETA`, `PRZETOP`, `WOLNE`).
import { HALA } from '../formowanie/geometria.js';

const TAU = Math.PI * 2;

/** S5(u) = u³(6u² − 15u + 10) (gładkie C2) i pochodne. */
export const S5 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));
export const S5d = (u) => (u <= 0 || u >= 1 ? 0 : 30 * u * u * (u - 1) * (u - 1));
export const S5dd = (u) => (u <= 0 || u >= 1 ? 0 : 60 * u * (2 * u * u - 3 * u + 1));

// ---------------------------------------------------------------------------------------------------------------------
// KRZYWKA NOŻA: g'(u) = 1 w oknie [0, w]; poza nim g' = 1 − (1 − cos θ) / (1 − w), θ = 2π (u − w) / (1 − w)
// (∮ g' = 0 — ruch okresowy; r = g'_min = −1 − 2w / (1 − w)). Całka w postaci zamkniętej.
const W_SYNC = 0.14;
const KW = 1 / (1 - W_SYNC);

/** g(u) (okresowa, g(0) = 0). */
export function camG(u) {
  const f = u - Math.floor(u);
  if (f <= W_SYNC) return f;
  const th = TAU * (f - W_SYNC) * KW;
  return f - (f - W_SYNC) * KW + Math.sin(th) / TAU;
}
/** g'(u) — prędkość wózka / prędkość taśmy. */
export function camGp(u) {
  const f = u - Math.floor(u);
  if (f <= W_SYNC) return 1;
  const th = TAU * (f - W_SYNC) * KW;
  return 1 - (1 - Math.cos(th)) * KW;
}
/** g''(u) — przyspieszenie wózka = g'' · v² / P. */
export function camGpp(u) {
  const f = u - Math.floor(u);
  if (f <= W_SYNC) return 0;
  const th = TAU * (f - W_SYNC) * KW;
  return -TAU * Math.sin(th) * KW * KW;
}

/** Faza tylnego zawrotu (g' = 0, x najmniejsze) i przedniego (x największe). */
export const U_HOME = W_SYNC + (1 - W_SYNC) * (TAU - Math.acos(W_SYNC)) / TAU;
export const U_FRONT = W_SYNC + (1 - W_SYNC) * Math.acos(W_SYNC) / TAU;
const G_MIN = camG(U_HOME);

/**
 * DZIEL — liczby dzielenia [j.], [s], [t]. `P` = L + w_k (okres krzywki w drodze taśmy).
 *   car       wózek noża (oś ostrza): spoczynek `X_HOME` (tylny zawrót), półdługość, pas z, wysokość, lico emitera
 *   rails     szyny wózków
 *   kerf      (runda 9) krótka rynna pod nożem (krople szczeliny; iskry): x0…x1, |z| ≤ hz, krawędzie `yTop`, dno `yFloor`
 *   wall      ściana czołowa hali (x0…x1, wierzch); exit — brama WYJAZD KASET (strona −z: z0…z1, y0…y1, nadproże `yL`)
 *   T         czasy [s]: metal szczeliny do rynny, z rynny dnem do przetopu
 *   head      zimne czoło (§ 5.4 rundy 8): szerokość ≥ w, grubość ≤ t na `run` j. + `margin`, nie mniej niż `min`, nie więcej niż `max`
 *   tol       tolerancje arkusza (runda 9, SPEC § 12.1 F: odrzuca TYLKO metal mieszany — wymiary są zapisem, nie progiem)
 *   N         arkuszy w kasecie (jednostka odbioru 40,1 t)
 */
export const DZIEL = Object.freeze({
  L: 640, WK: 2, P: 642, N: 8,
  W_SYNC, U_SW0: 0.02, U_SW1: 0.12, U_CUT: 0.12, U_FOLD: 0.14,
  X_HOME: 3428,
  car: Object.freeze({ hx: 35, z0: 110, z1: 190, y0: -1075, y1: -1010, face: 118, fy0: -1070, fy1: -1050 }),
  rails: Object.freeze({ x0: 3390, x1: 3720, z0: 140, z1: 160, y0: -1110, y1: -1095 }),
  kerf: Object.freeze({ x0: 3480, x1: 3610, hz: 100, yTop: -1075, yFloor: -1235.5 }),
  wall: Object.freeze({ x0: 4700, x1: 4740, yTop: -900 }),
  exit: Object.freeze({ z0: -752, z1: -520, y0: -1070, y1: -835, yL: -815 }),
  T: Object.freeze({ kerfHold: 0.8, kerfOut: 2.4 }),
  head: Object.freeze({ w: 197, t: 9.3, run: 100, margin: 20, min: 205, max: 700 }),
  tol: Object.freeze({ len: 0.5, w0: 197, w1: 203, t0: 8.7, t1: 9.3, cu: 0.05 }),
  servoCar: Object.freeze({ om: 40, ze: 1, amax: 4000 }),
  // ciepło brzegu cięcia (§ 3.3 rundy 8): pas przegrzany polem przy topieniu szczeliny `w0` [j.], α stali [j.²/s];
  // τ = w0² / (4α) — czas, po którym przewodzenie podwaja szerokość pasa; miedź — τ / k_metal
  edge: Object.freeze({ w0: 3, alpha: 8, tau: 3 * 3 / (4 * 8) }),
  // iskry szczeliny: cząstek na jednostkę masy szczeliny
  sparkPerUnit: 8
});

/**
 * CHWYT (§ 2 projektu rundy 9) — prawo ruchu arkusza od rozdzielenia (t = 0):
 *   kick      WYRZUT: aₓ = (2Δv/τ) sin²(πt/τ) — obie listwy (+z: listwa wyrzutu, −z: listwa przechyłu) po połowie siły
 *   xGrab     CHWYT, gdy tył arkusza minie x `xGrab` (najwcześniej po wyrzucie): pole listwy przechyłu zamyka się na krawędzi
 *             −z (prędkość względna 0); do chwytu LOT SWOBODNY (prędkość stała co do bitu). (Decyzja wykonawcy: projekt
 *             chwytał zaraz po wyrzucie, w 0,2 s — chwyt w miejscu daje lot 0,19 / 0,08 / 0,01 s przy 0,7 / 1 / 1,4 Q,
 *             a hamowanie przy 1,4 Q zostaje w granicy projektu.)
 *   ramp      narastanie i zanik opóźnienia hamowania (1 − cos)/2 [s]; A = v_g / (T_h − ramp), T_h = 2 D / v_g — tył staje
 *             dokładnie na `xStop` (regulator położenia: A liczone przy chwycie z drogi i prędkości)
 *   rise      UNIESIENIE od chwytu: y = h · S5, zawias z: krawędź → `zHinge` (ten sam czas)
 *   tilt      PRZECHYŁ na sztorc od końca uniesienia: θ = 90° · S5 w czasie `t`
 *   rail      LISTWA PRZECHYŁU (−z): odcinki emitera po `seg` j.; kickRail — LISTWA WYRZUTU (+z)
 */
export const CHWYT = Object.freeze({
  kick: Object.freeze({ dv: 40, t: 0.2 }),
  xGrab: 3686,
  ramp: 0.25,
  xStop: 4020,
  rise: Object.freeze({ h: 15, t: 0.5 }),
  tilt: Object.freeze({ t: 2.0 }),
  zHinge: -107,
  // (decyzja wykonawcy: listwy szersze i odsunięte od pasa — z −126…−110 / 110…126 zamiast −110…−104: chwycona krawędź
  // płyty (zawias −107) zakrywała listwę z kamery gry, a teraz lico listwy i pas pola od lica do krawędzi widać obok płyty)
  rail: Object.freeze({ x0: 3730, x1: 4680, z0: -126, z1: -110, y0: -1056, y1: -1050, seg: 30 }),
  kickRail: Object.freeze({ x0: 3730, x1: 4330, z0: 110, z1: 126, y0: -1056, y1: -1050, seg: 30 }),
  // podpory listew: słupy listwy przechyłu pod nią (z `postZ` — poza strefą pod pasem), listwa wyrzutu wisi na dwóch słupach
  // na końcach (x `hangX`, z `hangZ`) — pod pasem i po stronie +z zostaje wolne miejsce dla zwijarki (etap 2)
  postZ: -118, hangX: Object.freeze([3726, 4334]), hangZ: 152
});

/**
 * STOJAK (§ 3.2) — GRZEBIEŃ pola: wejście z `zIn` (= zawias po uniesieniu), pierwsza podziałka SPRZĘGNIĘTA Z DROGĄ TAŚMY
 * (droga w podziałkach u = ΔM / P: rampa (1 − cos) szerokości `uRamp` na początku i na końcu — arkusz staje dokładnie
 * podziałkę dalej w chwili, gdy następny zaczyna przechył), dalej do celu (slot kasety albo miejsce w buforze) ruchem
 * pięciomianowym (S-profil piątego stopnia) z ograniczeniami `vMax`, `aMax`, bez cofania — szczyt 160 j./s daje ten sam czas
 * dosuwu co trapez 100 j./s z projektu (S-profil ma szczyt 1,875 × średniej); bufor `buf` miejsc co `pitch` od `zBuf0` ku wejściu.
 *   line      linie emiterów pola (z −131 … −251, y wierzchu) i ramy końcowe (słupki trzymające płyty za końce)
 */
export const STOJAK = Object.freeze({
  pitch: 24, zIn: -107, buf: 6, zBuf0: -251, vMax: 160, aMax: 200, uRamp: 0.2,
  line: Object.freeze({ x0: 4015, x1: 4665, y: -1052, hw: 1.2 }),
  frame: Object.freeze({ xa0: 3995, xa1: 4015, xb0: 4665, xb1: 4685, z0: -256, z1: -142, yTop: -850 })
});

/**
 * KASETA (§ 3.3) — jednostka odbioru: 8 arkuszy na sztorc (40,1 t) w slotach z `slot0` + 24 k (k = 0 — daleki), rama
 * x0…x1 × z0…z1 × y0…y1 (dno y0…yD), masa ramy `mass` [t]. Ruchy S5 z masą: DOWÓZ pustej zza krawędzi pokładu (+z o
 * `supply.dz` w `supply.t`), WJAZD z bufora pustej (+x o `in.dx` w `in.t`), ODJAZD pełnej (−z o `out.dz`), WYJAZD przez
 * bramę (+x o `exit.dx`). Pusta rusza do załadunku, gdy pełna zjechała o `release` j. (pusta dochodzi do x ramy pełnej po
 * 0,31 s, pełna jest wtedy 234 j. niżej — rama nie zachodzi na ramę, odstęp > 5 j.; test).
 * Pokrywa pola zamyka się w `lid` s na początku odjazdu; postój w odbiorze `pick` s (tryb 'auto').
 */
export const KASETA = Object.freeze({
  n: 8, slot0: -451, pitch: 24, x0: 3995, x1: 4685, z0: -472, z1: -262, y0: -1062, yD: -1052, y1: -840,
  mass: 6,
  supply: Object.freeze({ dz: 1000, t: 4.5 }),
  in: Object.freeze({ dx: 695, t: 3.0 }),
  out: Object.freeze({ dz: -270, t: 2.6 }),
  exit: Object.freeze({ dx: 790, t: 5.0 }),
  pick: 3, lid: 0.8, release: 180, exitClear: 520,
  deck: Object.freeze({ y: -1080, x0: 3300, x1: 4690, zb0: -742, zb1: -528 })
});

/**
 * PRZETOP (§ 2.7, § 3.6): otwór w ścianie czołowej na wysokości pasa (|z| ≤ hz, y0…y1) i tunel za ścianą do `x1`.
 * Odpad leci przez niego z prędkością po wyrzucie (bez hamowania w hali — kolejne kawałki co okres cięcia leciałyby na
 * siebie; hamownia złomu poza zakresem) i za `x1` przechodzi na konto `przetop`.
 */
export const PRZETOP = Object.freeze({ hz: 120, y0: -1100, y1: -1040, x1: 5460 });

/**
 * WOLNE OBSZARY dla etapu 2 („Zwijarka”) — prostopadłościany [x0, x1, y0, y1, z0, z1], w których nic nie stoi:
 *   osPasma   oś od rozdzielenia do otworu PRZETOP (lot odpadu, czoło taśmy do kręgów)
 *   podPasem  strefa skrętarki pod pasem
 *   plusZ     bieg taśmy do zwijarek wzdłuż ściany i zwijarki
 */
export const WOLNE = Object.freeze({
  osPasma: Object.freeze([3586, 4740, -1065, -1045, -103, 103]),
  // (z do +108: wózki noża jeżdżą na z 110…190 do x 3713 — runda 8, zasada G)
  podPasem: Object.freeze([3610, 4400, -1300, -1064.5, -110, 108]),
  plusZ: Object.freeze([4400, 4665, -1300, -1040, 100, 1150])
});

/** Oś ostrza w spoczynku krzywki (faza u) [x]. */
export function camX(u) { return DZIEL.X_HOME + DZIEL.P * (camG(u) - G_MIN); }
/** x ROZDZIELENIA (faza `U_CUT`) — ten sam przy każdej prędkości. */
export const XB = camX(DZIEL.U_CUT);
/** Najdalsze położenie osi ostrza (przedni zawrót). */
export const X_FRONT = camX(U_FRONT);
/** Najdalsze czoło taśmy przed cięciem (XB + L + w_k / 2). */
export const FRONT_MAX = XB + DZIEL.L + DZIEL.WK / 2;

/** Wysokości: oś taśmy (środek arkusza w locie), półgrubość nominalna. */
export const PASS_Y = HALA.passY;
export const HALF_T = 4.5;

/** z slotu k kasety w miejscu załadunku (zawias arkusza na sztorc). */
export function slotZ(k) { return KASETA.slot0 + KASETA.pitch * k; }

/**
 * WIDOKI dzielenia (kino: `at` [x, y, z], `az` — skąd patrzy kamera, `el`, `dist`; top: [x, z, zoom]):
 *   D         „Dzielenie z ukosa” (runda 9) — od strony walcowni: nóż, chwyt i przechył, grzebień, kasety
 *   noz       zbliżenie ostrza; chwytGora / kasetyGora — z góry
 */
export const WIDOKI_DZ = Object.freeze({
  D: Object.freeze({ at: Object.freeze([4200, -1000, -250]), az: 2.6, el: 0.45, dist: 1700 }),
  noz: Object.freeze({ at: Object.freeze([3590, -1060, 0]), az: 2.2, el: 0.45, dist: 600 }),
  chwytGora: Object.freeze([4200, -150, 1.8]),
  kasetyGora: Object.freeze([4250, -420, 1.8]),
  dzielGora: Object.freeze([4100, -250, 1.5])
});
