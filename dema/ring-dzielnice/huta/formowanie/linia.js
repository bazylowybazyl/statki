// HUTA — element 3, etapy „Pasmo w polu” i „Kropla” (wylot bokiem): SYMULACJA LINII FORMOWANIA (czysty JS, bez three).
//
// Metal wypływa z gardzieli naczynia (przyrost `LICZNIK.delivered` komory w kroku strony — wejście `LIN_WEJ`) i:
//   RURA     — metal (kolejka pakietów-znaczników, `view.pipe`) płynie drogą `DROGA` od wargi dyszy kolanem pod stożkiem
//              i rurą spustową poza obrys naczynia do wylewki (masa w rurze — licznik `pipe`): czoło nowego metalu biegnie
//              rurą, a gdy dojdzie do wargi, metal w rurze to ciągła KOLUMNA ściskana polem rury — wypływ przez wargę
//              z wypełnienia (`pipeStep`: Q = pipeQ·√(M/M_pełna)), więc maleje w sposób ciągły, gdy dopływ słabnie;
//              ZAWÓR WYLEWKI (6 klap) otwiera się przed metalem i zamyka po opróżnieniu rury — metal wychodzi z wylewki
//              tylko przy otwartym zaworze;
//   STRUGA   — za wargą wylewki pakiety lecą łukiem (prowadzi je pole: kołnierz i pierścienie przy wylewce, rękaw pola)
//              i wchodzą w BŁONĘ z góry; pole ciągnie strugę w dół wzdłuż łuku (v² = v₀² + 2·g_pola·spadek — struga
//              przyspiesza i cienieje, ściśnięta przez pole), a błona przyjmuje jej pęd bez rozbryzgu (wgniecenie, fala,
//              mody); pakiet niesie masę, temperaturę, metal, puls i skręt wiru gardzieli;
//   BŁONA    — elastyczny worek pola obok naczynia (kształt `blona.js`): masa = całka dopływ − odpływ; CIŚNIENIE z napięcia
//              błony (rośnie z wypełnieniem) i ze ŚCISKU prasy pola od strony naczynia; WYPŁYW przez gardziel
//              formującą G0 z ciśnienia — regulator linii steruje ŚCISKIEM (σ), nie prędkością ciągnięcia; trzy mody
//              drgań (oddech, przelewanie wzdłuż osi, ugięcie) i FALA na błonie (1D, od wlotu ku prasie i gardzieli)
//              pobudzane pędem strugi, tłumione jak kula wytopu (`kula.js`); grzanie indukcyjne do temperatury wytrzymania;
//   PASMO    — Lagrange'owskie plastry (pierścień, plaster ≤ 1/6 t) od wylotu G0 do tunelu bramy „DO ZWIJARKI”:
//              część ciekła to płytka woda w polu (ciśnienie Φ = ½·g_f·A²/w, fale grubości biegnące w dół pasma,
//              lepkość i opór pola rosną z udziałem fazy stałej), ciało stałe jedzie sztywno z prędkością z `kin`
//              (`openMill()` — bez gniotu; etap „Walcowanie” podmienia). Ciepło skupione po grubości (entalpia
//              H = T + L·f_l): promieniowanie do chłodnic i otoczenia, konwekcja noży gazowych; lico chłodniejsze od
//              rdzenia (skóra), zgorzelina rośnie na ciele stałym.
// Regulator: przepływ zadany Q_zad z objętości błony (jak zasobnik etapu „Pasmo”) → ścisk σ = Q_zad/Q_nom − p_napięcia
// → wypływ Q = Q_nom·(p_napięcia + σ) (mocniejszy ścisk → większy wypływ; przy σ = 1 wypływ ograniczony ściskiem).
// Tryby (`TRYB`): PUSTA → ROZRUCH (czoło, nawlekanie 0,6·v_nom do bramy) → PRACA → DOBIEG (`drain()`: błona do 3 t)
// → OGON (wylot odcięty, pasmo wyjeżdża).
//
// BILANS (jednostki całkowite 1/1536 t — te same co komora): prefill + inflow = pipe + jet + reservoir + strip + exited
// + scale po KAŻDYM podkroku (`audit()`). (runda 9) Masa plastra obejmuje jego warstwę tlenku (masę metalu w tlenku);
// tlenek zdjęty w STACJI ODZGORZANIA przechodzi całymi jednostkami z plastra na konto `scale` (odciąg i dół zgorzeliny —
// odpad). Zrzut zgorzeliny w klatkach F1–F3, iskry i drganie dalej nie mają masy (model klatek bez zmian). Podkrok 1/240 s (4 na krok strony 1/60 s).
// KROK NIE ALOKUJE (tablice typowane, bez obiektów i domknięć w pętli). Losowość: mulberry32 z ziarna (`hash()`).
import { UNITS_PER_TON } from '../wytop/komora.js';
import { BALL, modeGamma, modeOmega } from '../wytop/kula.js';
import { BLONA, DROGA, LINIA, PATH, SPUST } from './geometria.js';
import { RK_CN, RK_DX, RK_G, RK_N, RK_NECK0, RK_X, areaAtW, sectionAtW } from './blona.js';
import { AREA_DN, AREA_N0, AREA_TAB, areaK } from './nadelipsa.js';
// (runda 8, element „Dzielenie”) pasmo przechodzi przez NÓŻ POLOWY za F3 i jest rozdzielane w modelu linii (`cutAt`):
// koniec pasma `LINIA.stripEndX` to już tylko bezpiecznik (plaster za nim = błąd — licznik `overrun`), x rozdzielenia `XB`
import { XB } from '../dzielenie/geometria.js';
// (runda 9, „Czysta stal”) STACJA ODZGORZANIA za F3 i KURTYNA OSŁONY (argon): zdejmowanie tlenku w strefie stacji
// (ξ → ξ · exp(−k · U · h) w podkroku), masa zdjętego tlenku na konto `scale`, brak przyrostu tlenku za kurtyną
import { ODZG, OZ_X0, OZ_X1 } from './odzgorzanie.js';

export { areaK };

/** Objętość 1 t metalu [j³] (ta sama gęstość co kula: R = 38 · m^⅓) i jednej jednostki masy. */
export const VOL_TON = 4 / 3 * Math.PI * BALL.rPerCbrtTon ** 3;
export const VOL_UNIT = VOL_TON / UNITS_PER_TON;

/** Własności metali linii (PROJEKT § 2.6; K — temperatura fizyki, T̃ = (T − T0)/(T1 − T0) — barwa jak kula).
 *  `Tfin` (runda 9, etap „Gorętsza taśma”) — temperatura KOŃCA WALCOWANIA [K], cel regulatora noży C3 za F3: stal 1150
 *  (koniec walcowania w walcowni gorącej 1120–1220 K), miedź 1000 (727 °C — walcowanie miedzi na gorąco, 356 K poniżej
 *  solidusu, 0,74 T_top; zapas na plamy cieplne taśmy ±30 K i przegrzanie przy 1,3 Q_nom). Paleta żaru bez zmian. */
export const METAL_FIZ = Object.freeze([
  Object.freeze({ id: 'stal', Thold: 1830, Tliq: 1800, Tsol: 1740, L: 340, el: 0.35, es: 0.8, kMetal: 1, kSkin: 1, T0: 750, T1: 1850, Kox: 25, Tfin: 1150 }),
  Object.freeze({ id: 'miedz', Thold: 1430, Tliq: 1360, Tsol: 1356, L: 410, el: 0.15, es: 0.7, kMetal: 5.8, kSkin: 0.08, T0: 700, T1: 1450, Kox: 200, Tfin: 1000 })
]);

/** Liczby linii. Długości [j.], czas [s], masa [t] albo [jedn.]. */
export const PASMO = Object.freeze({
  A0: LINIA.w * LINIA.t0,                 // przekrój pasma (stały od G0 do pierwszej klatki) [j²]
  sliceUnits: 256,                        // plaster = 1/6 t
  qNom: 240 / 91.9,                       // średni wypływ gardzieli [t/s] (240 t co 91,9 s)
  h: 1 / 240, substeps: 4,
  sG0: LINIA.gates[0].x + PATH.xOff,      // gardziel formująca błony (G0) na drodze taśmy
  // (runda 8) koniec drogi pasma za nożem dzielenia (najdalsze czoło przed cięciem 4227 + zapas): plaster, którego
  // górna granica minie `sExit`, wychodzi z linii licznikiem `exited` i `LIN_STAN.overrun` (z dzieleniem — błąd; bez
  // dzielenia — dawne wyjście pasma)
  sExit: LINIA.stripEndX + PATH.xOff,
  sJet0: 0,                               // warga dyszy naczynia (początek rury spustowej)
  sLip: DROGA.sLip,                       // warga wylewki (zawór) na drodze metalu
  sEnd: DROGA.sEnd,                       // koniec drogi strugi (środek błony pod wlotem)
  // struga: prędkość wylotu z głębokości jeziora (bez grawitacji poza naczyniem), przekrój dyszy
  jetG: 520, jetCd: 0.9, jetR: 70, jetVmin: 120, jetVmax: 700,
  // pole prowadzi strugę po łuku: kołnierz pola na wardze wylewki przyspiesza ją (energia `collarE` [j²/s²] na
  // `collarLen` j. za wargą — struga cienieje, ściśnięta polem), a pole błony ciągnie ją w dół (przyspieszenie `fieldG`
  // [j./s²] wzdłuż spadku); prędkość z energii: v² = v₀² + E_kołnierza + 2·g_pola·spadek
  collarE: 2.0e6, collarLen: 30, fieldG: 3200,
  // zawór wylewki: czas otwarcia / zamknięcia [s], przytrzymanie po opróżnieniu rury [s]
  spoutTime: 0.25, spoutHold: 0.3,
  // RURA SPUSTOWA jako przewód pola (etap „Struga”, 2026-11-18): czoło spływu (cienka struga rozruchu) biegnie rurą jak
  // dotąd; gdy przez wargę przejdzie pełny spływ albo rura się wypełni, metal w rurze to ciągła KOLUMNA — pole rury
  // ściska ją, a ciśnienie rośnie z wypełnieniem; wypływ przez wargę (pełnym przekrojem)
  // Q = pipeQ · √(M / M_pełna) [t/s], prędkość na wardze u = Q · ρ / A_rury. Pełna rura daje pełny spływ gardzieli 36 t/s
  // (ten sam przelot ~1,4 s i ta sama prędkość ~600 j./s co dotąd); gdy dopływ słabnie, rura opróżnia się w sposób ciągły
  // (wypływ maleje z masą, nie rośnie) i kończy w skończonym czasie (Q maleje liniowo do zera — nić cienieje i urywa się).
  // `pipeVmin` — najmniejsza prędkość na wardze (kołnierz ciągnie metal), `rampOut` — przejście z fazy czoła do kolumny [s].
  pipeQ: 36, pipeVmin: 40, rampOut: 0.5,
  // błona: ciśnienie napięcia p_t = pT · (V / Vpk)^⅔ (w jednostkach Q_nom), ścisk σ 0…1 (narastanie `sqRate` / s)
  // (poprawki rundy 6: pT 1,1 → 0,95 — napięcie pełnej błony nie wystarcza do zadanego wypływu, prasa ściska przez
  // cały obieg, także w szczycie zrzutu; wypływ dalej idzie za przepływem zadanym — stan taśmy bez zmian)
  pT: 0.95, sqRate: 0.6,
  // fala na błonie: węzły wzdłuż osi, prędkość [j./s], tłumienie [1/s], pobudzenie pędem strugi
  etaN: 24, etaC: 260, etaGamma: 0.6, etaKick: 0.6, etaMax: 0.3,
  resHoldTau: 8, resTinOver: 400,
  // regulator i tryby
  // (etap „Wyciskanie”: MOCNIEJSZY ŚCISK ZARAZ PO ZRZUCIE — wzmocnienie 0,35 → 0,5, masa odniesienia 120 → 100 t, górna
  // granica 1,25 → 1,4 (stal) / 1,3 (miedź): tyle linia wytrzymuje w stanie ustalonym z frontem krzepnięcia ≥ 200 j. przed
  // F1 (stal 1,4 → 2235, miedź 1,3 → ~2240; miedź przy 1,5 krzepnie za F1). Przepływ nominalny i stan taśmy przy Q_nom bez
  // zmian; szczyt masy błony 232 → 221 t, średnia 122 → 106 t — liczby: RAPORT-wyciskanie.md)
  regBeta: 0.5, regVrefT: 100, regLo: 0.7, regHi: 1.4, regHiCu: 1.3, slew: 0.06,
  startT: 30, startGap: 300, cutT: 3, thread: 0.6,
  // płytka woda w polu: c = 70 j./s przy t0 (g_f = c² / t0), opór pola γ = γ0 + γS·f_s⁴, lepkość ν = ν0·(1 + νS·f_s²)
  c: 70, gamma0: 0.7, gammaS: 200, nu0: 160, nuS: 15, minLen: 0.2, endHold: 0.85,
  // PRASOWANIE w bramach G1–G4: pole formujące jest sztywniejsze (× ironG) i tłumi ruch (+ ironGamma) — fale grubości
  // wygładzają się w bramach, zanim metal zastygnie (bez tego zamarzały w taśmie jako garby)
  ironG: 2.5, ironGamma: 3, ironX0: LINIA.gates[0].x, ironX1: LINIA.gates[4].x + 40, ironEdge: 110,
  // modulacja wypływu przez mody zasobnika i szum strugi (fale grubości)
  outSlosh: 0.9, outBreath: 0.4, outNoise: 0.02, outNoiseDump: 0.05, outNoiseTau: 0.35,
  // ciepło (PROJEKT § 2.6): K_r, odniesienie, otoczenie; konwekcja noży gazowych C3
  // (hC3: etap „Walcowanie” — noże C3 krótsze (za F3 na nowym miejscu, 240 j. zamiast 380), mocniejszy nadmuch: taśma
  // przy bramie „DO ZWIJARKI” w tej samej temperaturze co bez walcowni)
  // (runda 9, „Gorętsza taśma”) NOŻE C3 jako REGULATOR TEMPERATURY KOŃCA WALCOWANIA: dawniej dmuchały pełną mocą i
  // gasiły taśmę za F3 z ok. 1300 do ok. 900 K (arkusze nie świeciły). Dziś zawory noży `c3u` 0…1 (h = hC3 · c3u)
  // trzyma regulator: model strefy z pirometru przed nożami (wejście) + całka błędu pirometru za nożami (wyjście),
  // cel `METAL_FIZ.Tfin`; poniżej celu noże stoją (taśmy się nie grzeje). Zawór z inercją `c3Tau` [s]; pirometry
  // `c3PyIn` j. przed i `c3PyOut` j. za strefą noży; całka `c3Ki` [1/s], ograniczenie ±`c3Imax` K.
  Kr: 1327, Tref: 1850, Tenv: 420, hC3: 6200, Tgas: 400, chillC1: 2.2, chillC2: 1.4,
  c3Tau: 0.25, c3Ki: 0.8, c3Imax: 150, c3PyIn: 20, c3PyOut: 30,
  skin: 2400, oxE: 9000
});

/** Szerokość nominalna pasma i wykładnik nadelipsy w bramach G0–G4 (x → w, n; po G4 stałe). */
const GATE_X = LINIA.gates.map((g) => g.x);
const GATE_W = LINIA.gates.map((g) => g.a * 2);
const GATE_N = [2, 2.6, 3.4, 4.5, 6];
export const GATE_SHAPE = Object.freeze({ x: Object.freeze(GATE_X.slice()), w: Object.freeze(GATE_W.slice()), n: Object.freeze(GATE_N.slice()) });

/** Udział strefy prasowania bram G1–G4 na x (0…1, gładkie brzegi). */
export function ironAt(x) {
  const P = PASMO;
  const a = (x - P.ironX0) / P.ironEdge;
  const b = (P.ironX1 - x) / P.ironEdge;
  const f = Math.min(a, b);
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  return f * f * (3 - 2 * f);
}

/** Szerokość nominalna [j.] pasma na x drogi poziomej. */
export function gateWidth(x) {
  if (x <= GATE_X[0]) return GATE_W[0];
  for (let i = 1; i < GATE_X.length; i++) {
    if (x <= GATE_X[i]) { const f = (x - GATE_X[i - 1]) / (GATE_X[i] - GATE_X[i - 1]); return GATE_W[i - 1] + (GATE_W[i] - GATE_W[i - 1]) * f; }
  }
  return GATE_W[GATE_W.length - 1];
}
/** Wykładnik nadelipsy przekroju na x. */
export function gateExp(x) {
  if (x <= GATE_X[0]) return GATE_N[0];
  for (let i = 1; i < GATE_X.length; i++) {
    if (x <= GATE_X[i]) { const f = (x - GATE_X[i - 1]) / (GATE_X[i] - GATE_X[i - 1]); return GATE_N[i - 1] + (GATE_N[i] - GATE_N[i - 1]) * f; }
  }
  return GATE_N[GATE_N.length - 1];
}

// (pole nadelipsy K(n) — `nadelipsa.js`, wspólne z błoną)

/** Tryby linii. */
export const TRYB = Object.freeze({ PUSTA: 0, ROZRUCH: 1, PRACA: 2, DOBIEG: 3, OGON: 4 });
export const TRYB_NAMES = Object.freeze(['pusta', 'rozruch', 'praca', 'dobieg', 'ogon']);

/** Wejście kroku (wypełnia strona po `sim.step`): `Float64Array(LIN_WEJ_N)`. */
export const LIN_WEJ = Object.freeze({
  units: 0,          // przyrost LICZNIK.delivered w tym kroku [jedn.] — metal oddany gardzielą
  tempT: 1,          // temperatura metalu komory T̃ (STAN.temp)
  head: 2,           // głębokość jeziora nad gardzielą [j.] (STAN.level − throatY)
  metal: 3,          // metal komory (indeks: 0 stal, 1 miedź)
  impactT: 4,        // czas od zetknięcia masy z lejem [s] (< 0 — przed)
  funnelUnits: 5,    // metal w leju [jedn.]
  twist: 6,          // kąt skręcenia wiru gardzieli [rad] (STAN.twist)
  valve: 7           // otwarcie zaworu dyszy 0…1
});
export const LIN_WEJ_N = 8;

/** Stan skalarny linii (`line.view.stan`). */
export const LIN_STAN = Object.freeze({
  mode: 0, time: 1, vLine: 2, Q: 3, Qtarget: 4, vNom: 5,
  resV: 6, resT: 7, resX: 8,                 // BŁONA (dawny zasobnik): masa [jedn.], temperatura [K], udział miedzi
  q0: 9, q1: 10, q2: 11, qd0: 12, qd1: 13, qd2: 14,
  resL: 15, resR: 16, resReq: 17,            // długość błony, półszerokość korpusu, promień kuli o tej masie
  aOut: 18, noise: 19, carry: 20,            // modulacja wypływu (A_out / A0), szum, ułamek jednostki
  front: 21, tail: 22, attached: 23,         // czoło (największe s pasma), ogon najnowszego pasma, wylot otwarty
  frontSolid: 24,                            // s frontu krzepnięcia (pierwszy plaster od wylotu z f_s ≥ 0,999)
  jetHead: 25, jetTail: 26, jetQ: 27, jetV: 28, jetOn: 29,
  inRate: 30,                                // dopływ strugi do zasobnika (wygładzony) [t/s]
  m0: 31,                                    // współrzędna masy wylotu G0 (jedn. od startu)
  jm0: 32,                                   // współrzędna masy wylotu dyszy (jedn. od startu)
  pulse: 33, twist: 34,                      // szum pulsu strugi, skręt wiru przy wylocie
  splash: 35,                                // uderzenie strugi w zasobnik (iskry, rysunek) [t/s]
  chill: 36,                                 // dosunięcie paneli C1 (udział miedzi pod chłodnicą) 0…1
  frontSpeed: 37, cuts: 38, starts: 39,
  dumpT: 40,                                 // czas od początku ostatniego spływu [s] (−1 — brak)
  threadT: 41,
  jetQs: 42,                                 // wypływ z dyszy wygładzony (bez drgań całkowitych jednostek) [t/s]
  pulse2: 43,
  // --- etap „Kropla” (błona pola, wylot bokiem) ---
  Qcmd: 44,                                  // przepływ zadany regulatora [t/s] (Q — rzeczywisty wypływ z gardzieli)
  sq: 45, sqT: 46,                           // ścisk prasy σ 0…1 i jego cel
  pT: 47,                                    // ciśnienie napięcia błony (w jednostkach Q_nom)
  memW: 48, memH: 49, memXb: 50,             // półszerokość, półwysokość korpusu, tył błony (x) — `resL` = długość
  hitS: 51, hitX: 52, hitY: 53,              // wejście strugi w błonę: droga s, punkt (x, y) na powierzchni
  spout: 54, spoutWant: 55, spoutIdle: 56,   // zawór wylewki 0…1, ma być otwarty, czas od opróżnienia rury [s]
  vIn: 57,                                   // prędkość strugi przy wejściu (po hamowaniu polem) [j./s]
  flowPh: 58,                                // faza linii pola: droga metalu w korpusie ku gardzieli [j.] (całka)
  dent: 59,                                  // wgniecenie błony pod strugą [j.]
  etaE: 60,                                  // energia fali na błonie (wielkość względna)
  sqForce: 61,                               // ścisk wymuszony (≥ 0) — testy; −1 — regulator
  // --- etap „Wyciskanie”: ZACISK POLA wędrujący wzdłuż rękawa ---
  pinX: 62, pinV: 63,                        // położenie zacisku (początek rampy) [j.] i jego posuw [j./s] (+ ku G0)
  pinF: 64,                                  // siła zacisku (jasność bramki i powłoki na zacisku) 0…~2
  pinR: 65,                                  // rozciągnięcie brzucha tuż przed zaciskiem (a / A_ref) i
  pinRt: 66,                                 //   jego cel z ciśnienia (Q / Q_nom)^pExp
  landX: 67,                                 // miejsce wpadania strugi na pusty rękaw [j.]
  bagX: 68,                                  // tył metalu w rękawie [j.]
  opening: 69,                               // zacisk otwiera się przed zrzutem (0 / 1)
  // --- etap „Struga”: rura spustowa jako kolumna (wypływ z wypełnienia), struga na wardze i przy błonie ---
  lipQ: 70,                                  // wypływ przez wargę wylewki [t/s] (ciągły; 0 — nic nie wypływa)
  lipV: 71,                                  // prędkość metalu na wardze [j./s]
  landed: 72,                                // struga sięga błony (ciągła od wargi albo od ogona do powierzchni) 0 / 1
  pipeFront: 73,                             // czoło metalu w rurze [j. drogi] (faza czoła; w fazie kolumny — warga)
  lipCarry: 74,                              // ułamek jednostki wypływu przez wargę
  pipeOn: 75,                                // faza KOLUMNY (przez wargę przeszedł pełny spływ) 0 / 1; 0 — faza czoła
  lipRamp: 76,                               // przejście z fazy czoła do kolumny (waga 1 → 0 w `rampOut` s)
  lipQ0: 77,                                 // wypływ ostatniego pakietu fazy czoła [t/s] (początek przejścia)
  // --- runda 8, element „Dzielenie”: czoło pasma po cięciu nożem polowym ---
  cutFront: 80,                              // czoło najstarszego pasma jest cięte (proste, z żarem brzegu) 0 / 1
  cutT: 81,                                  // czas linii w chwili ostatniego cięcia [s]
  cutDT0: 82,                                // nadwyżka temperatury brzegu cięcia nad taśmą w chwili cięcia (T_sol − T) [K]
  overrun: 83,                               // masa, która minęła koniec drogi pasma `sExit` [jedn.] (z dzieleniem ma być 0)
  // --- runda 9, „Gorętsza taśma”: regulator temperatury końca walcowania (noże C3 za F3) ---
  c3u: 84,                                   // otwarcie zaworów noży C3 0…1 (h = hC3 · c3u)
  c3Tin: 85, c3Tout: 86,                     // pirometr przed nożami (za F3) i za nimi [K] (0 — brak taśmy)
  c3Set: 87,                                 // cel: T końca walcowania metalu pod pirometrem wyjścia [K]
  c3I: 88,                                   // całka błędu pirometru wyjścia [K]
  // --- runda 9, „Czysta stal”: stacja odzgorzania za F3 (`odzgorzanie.js`) ---
  odzU: 89,                                  // moc stacji 0…1 (narasta, gdy pod linią styku jest ciało stałe taśmy)
  odzXiIn: 90, odzXiOut: 91,                 // ξ przed strefą stacji i za nią (sondy na drodze; 0 — brak taśmy)
  odzTot: 92,                                // zdjęta masa tlenku narastająco [jedn., ułamkowo — obraz: płatki i pył]
  odzAcc: 93,                                // ułamek jednostki zdjętej, jeszcze w plastrach (przechodzi całymi jednostkami)
  odzRate: 94,                               // strumień zdjętej masy (wygładzony) [t/s]
  odzOn: 95                                  // stacja i osłona działają (1) — 0: A/B bez stacji (tlenek rośnie wszędzie)
});
export const LIN_STAN_N = 96;

/** Liczniki mas [jedn.] (całkowite): `pipe` — rura spustowa (przed wargą wylewki), `jet` — struga w powietrzu,
 *  `scale` — (runda 9) tlenek zdjęty w stacji odzgorzania (odciąg i dół zgorzeliny — odpad). */
export const LIN_LICZNIK = Object.freeze({ prefill: 0, inflow: 1, jet: 2, reservoir: 3, strip: 4, exited: 5, pipe: 6, scale: 7 });
export const LIN_LICZNIK_N = 8;

/**
 * Plaster pasma: rekord w pierścieniu (`view.slices`, krok `SLICE_STRIDE`). `s` — granica DOLNA (w dół pasma, większe s),
 * `u` — jej prędkość; granica górna = `s` następnego (młodszego) plastra, wolny ogon (`tail` = 1: `ts`, `tu`) albo wylot
 * G0 (plaster otwarty, `tail` = 2).
 */
export const PL = Object.freeze({
  s: 0, u: 1, m: 2, H: 3, x: 4, xi: 5, m0: 6, k: 7, T: 8, fs: 9, Ts: 10, A: 11, a: 12, tail: 13, ts: 14, tu: 15,
  dTs: 16, F: 17, n: 18, ct: 19
});
export const SLICE_STRIDE = 20;
export const SLICE_CAP = 1024;

/**
 * Pakiet strugi (`view.jet`, krok `JET_STRIDE`): s, prędkość bazowa, masa [jedn.], T [K], udział miedzi, puls, współrzędna
 * masy, skręt, wypływ [t/s], prędkość bieżąca [j./s].
 * - W RURZE (`view.pipe` — osobny pierścień, kolejka od wargi): `v` — prędkość wylotu z gardzieli (czoło przy napełnianiu),
 *   `q` — dopływ w chwili wylotu; `s` nieużywane (metal w rurze to kolumna — wypływ z wypełnienia, nie z drogi pakietu).
 * - W STRUDZE (`view.jet`, od wargi do błony): pakiet powstaje na wardze co podkrok z metalu wypchniętego z rury; `v` —
 *   prędkość na wardze (baza równania energii pola), `q` — wypływ przez wargę w tej chwili (przekrój strugi = q · ρ / v(s)),
 *   `va` — prędkość po ostatnim podkroku (obraz przesuwa pakiet w ułamku kroku strony tą prędkością), `m0` — współrzędna
 *   wzoru z zegara wargi (w jednostkach masy pełnego spływu; w rurze — współrzędna masy).
 */
export const PJ = Object.freeze({ s: 0, v: 1, m: 2, T: 3, x: 4, p: 5, m0: 6, tw: 7, q: 8, va: 9 });
export const JET_STRIDE = 10;
export const JET_CAP = 1024;

/**
 * TABLICE WZDŁUŻ DROGI (co 1 j. od `TX_S0` — wylot G0 − 60 — do końca tunelu + 60): szerokość nominalna, wykładnik
 * nadelipsy, udział prasowania bram, chłodzenie promieniste χ (C1 = 2,2 — mnożone przez k_metal), konwekcja noży C3.
 * Krok linii czyta je indeksem (bez wywołań funkcji w pętlach plastrów).
 */
export const TX_S0 = Math.floor(LINIA.gates[0].x + PATH.xOff - 60);
export const TX_N = Math.ceil(LINIA.stripEndX + PATH.xOff + 60) - TX_S0;
const TAB_W = new Float64Array(TX_N);
const TAB_N = new Float64Array(TX_N);
const TAB_IRON = new Float64Array(TX_N);
const TAB_CHI = new Float64Array(TX_N);
const TAB_HC = new Float64Array(TX_N);
// (runda 9) TLEN (1 — gaz hali, 0 — atmosfera ochronna za kurtyną osłony) i STREFA ODZGORZANIA (szybkość k [1/s])
const TAB_OX = new Float64Array(TX_N);
const TAB_DS = new Float64Array(TX_N);
for (let i = 0; i < TX_N; i++) {
  const x = TX_S0 + i + 0.5 - PATH.xOff;
  TAB_W[i] = gateWidth(x);
  TAB_N[i] = gateExp(x);
  TAB_IRON[i] = ironAt(x);
  TAB_CHI[i] = x >= LINIA.chill.C1[0] && x < LINIA.chill.C1[1] ? PASMO.chillC1 : x >= LINIA.chill.C2[0] && x < LINIA.chill.C2[1] ? PASMO.chillC2 : 1;
  TAB_HC[i] = x >= LINIA.chill.C3[0] && x < LINIA.chill.C3[1] ? PASMO.hC3 : 0;
  TAB_OX[i] = x >= ODZG.xc ? 0 : 1;
  TAB_DS[i] = x >= OZ_X0 && x < OZ_X1 ? ODZG.k : 0;
}

/** Kinematyka ciała stałego bez gniotu (otwarte klatki): prędkość = prędkość linii wszędzie. Etap „Walcowanie” podmienia. */
export function openMill() {
  return {
    id: 'otwarte',
    /** Współczynnik prędkości ciała stałego względem prędkości linii co 1 j. drogi od `TX_S0` (czyta linia w kroku). */
    factor: new Float64Array(TX_N).fill(1),
    /** Prędkość ciała stałego na drodze s przy prędkości linii v (wylot G0) [j./s]. */
    speedAt(s, v) { return v; },
    /** Grubość docelowa ciała stałego na s (nominalna t0). */
    thickAt(s) { return LINIA.t0; },
    /** Krok kinematyki (pętle, chwyty) — tu nic. */
    step(h, line) {}
  };
}


/**
 * Linia formowania. `seed` — ziarno losowości, `metal` — metal startowy (indeks), `prefillTons` — zasobnik na starcie
 * strony (z pasmem wypełnionym do tunelu przebiegiem `prefillRun` s), `cold` — start od pustej linii (pierwsze czoło
 * z pierwszego spływu), `kin` — kinematyka ciała stałego (`openMill()`).
 */
// --- stałe kroku (wspólne dla wszystkich linii) ----------------------------------------------------------------------
const P = PASMO;
const h = P.h;
const MASK = SLICE_CAP - 1;
const JMASK = JET_CAP - 1;
const UNITS_T = UNITS_PER_TON;
const sliceVol = P.sliceUnits * VOL_UNIT;
const lNom = sliceVol / P.A0;
const gF = P.c * P.c / LINIA.t0;
/** Przekrój rury spustowej [j²] i masa pełnej rury od wargi dyszy do wargi wylewki [t]. */
const A_PIPE = Math.PI * SPUST.r * SPUST.r;
const PIPE_FULL_T = A_PIPE * DROGA.sLip / VOL_TON;
const LIP_TAU_K = 1 - Math.exp(-h / 0.1);
/** Tempo współrzędnej wzoru strugi [jedn./s] — tyle, ile metalu oddaje pełny spływ (wzór strugi jak dotąd w pełnym spływie). */
const PAT_RATE = PASMO.pipeQ * UNITS_PER_TON;
const vNom = P.qNom * VOL_TON / P.A0;
const env4 = (P.Tenv / P.Tref) ** 4;
// (poprawki rundy 7) powrót lica po styku z walcem: chłód styku sięga ułamka milimetra (√(α · t_styku)), więc lico odbudowuje
// temperaturę z rdzenia w setnych częściach sekundy — τ 0,08 s (było 0,3 s: ciemny pas za klatką na 60–130 j. zamiast pasa
// świeżego, odsłoniętego metalu). Zmienia tylko lico (obraz) — bez sprzężenia z ciepłem plastra i z bilansem.
const dTsDecay = Math.exp(-h / 0.08);
const CHILL_K4 = 1 - Math.exp(-4 * h / 1.5);
// (runda 8) ROZRUCH → PRACA, gdy czoło nowego pasma minie nóż dzielenia (było: brama „DO ZWIJARKI”)
const GATE_S = XB + PATH.xOff;
const C1_S0 = LINIA.chill.C1[0] + PATH.xOff;
const C1_S1 = LINIA.chill.C1[1] + PATH.xOff;
const MS = METAL_FIZ[0];
const MC = METAL_FIZ[1];
const MP0 = Float64Array.of(MS.Tsol, MS.Tliq, MS.L, MS.el, MS.es, MS.kMetal, MS.kSkin, MS.T0, MS.T1, MS.Kox, MS.Thold);
const MP1 = Float64Array.of(MC.Tsol, MC.Tliq, MC.L, MC.el, MC.es, MC.kMetal, MC.kSkin, MC.T0, MC.T1, MC.Kox, MC.Thold);
/** Przesunięcie rekordu plastra o indeksie i (od czoła). */
const sl = (ring, i) => ((ring[0] + i) & MASK) * SLICE_STRIDE;

// --- KROK LINII: funkcje modułu z kontekstem X (bez domknięć — jeden kod dla wszystkich egzemplarzy; KROK NIE ALOKUJE:
// żadna liczba zmiennoprzecinkowa nie idzie przez argument ani wynik — tablice kontekstu i brudnopis W)
/** Liczba losowa 0…1 do W[15] (wynik przez brudnopis — bez liczby w wyniku funkcji). */
function rnd(X) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  rs[0] += 0x6D2B79F5;
  let t = rs[0];
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  W[15] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Własności metalu przy udziale miedzi W[14] → W[0..10]. */
function props(X) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  const x = W[14];
  for (let k = 0; k < 11; k++) W[k] = MP0[k] + (MP1[k] - MP0[k]) * x;
}

/** H (W[13]) → T (W[11]), f_s (W[12]) przy własnościach w W (po `props`). */
function thermo(X) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  const H = W[13];
  const Tsol = W[0];
  const Tliq = W[1];
  const L = W[2];
  if (H <= Tsol) { W[11] = H; W[12] = 1; return; }
  if (H >= Tliq + L) { W[11] = H - L; W[12] = 0; return; }
  const k = L / (Tliq - Tsol);
  const T = (H + k * Tsol) / (1 + k);
  W[11] = T;
  W[12] = 1 - (T - Tsol) / (Tliq - Tsol);
}

/**
 * Stan kształtu rękawa z komórek (`blona.js`): tył metalu, długość wypełnionej części (`resL`), półszerokość i półwysokość
 * brzucha (największe przekroje przed szyją), promień kuli o tej masie (mody drgań jak kula wytopu).
 */
function resShape(X) {
const { S, CV, WB } = X;
  const Vt = S[LIN_STAN.resV] / UNITS_T;
  const thr = 0.02 * BLONA.Aref * RK_DX;
  let i0 = -1;
  let amax = 0;
  for (let i = 0; i < RK_N; i++) {
    if (i0 < 0 && CV[i] > thr) i0 = i;
    if (i < RK_NECK0 && CV[i] > amax) amax = CV[i];
  }
  const xb = i0 < 0 ? BLONA.xG0 : RK_X[i0] - 0.5 * RK_DX;
  S[LIN_STAN.bagX] = xb;
  S[LIN_STAN.memXb] = xb;
  S[LIN_STAN.resL] = BLONA.xG0 - xb;
  WB[5] = BLONA.xN - 1; WB[6] = amax / RK_DX;
  sectionAtW(WB);
  S[LIN_STAN.resR] = WB[0];
  S[LIN_STAN.memW] = WB[0];
  S[LIN_STAN.memH] = WB[1];
  S[LIN_STAN.resReq] = BALL.rPerCbrtTon * Math.cbrt(Math.max(Vt, 0.5));
}

/**
 * Wejście strugi w błonę: pierwszy punkt drogi za wargą wylewki, który leży na powierzchni metalu w rękawie albo na
 * zapadniętym rękawie (wierzch przekroju z komórek — bez fal; wgniecenie pod strugą wlicza się z opóźnieniem). Pusty
 * rękaw pod drogą — struga sięga płaskiej błony (`collH` nad środkiem).
 */
function hitScan(X) {
const { S, CV, WB } = X;
  const D = DROGA;
  let i = Math.ceil(P.sLip) | 0;
  const iEnd = D.n - 2;
  S[LIN_STAN.hitS] = P.sEnd;
  S[LIN_STAN.hitX] = D.x[iEnd];
  S[LIN_STAN.hitY] = D.y[iEnd];
  for (; i <= iEnd; i += 2) {
    const x = D.x[i];
    if (x < BLONA.x0) continue;
    WB[5] = x;
    areaAtW(CV, WB);
    sectionAtW(WB);
    const b = WB[1] > BLONA.collH ? WB[1] : BLONA.collH;
    const dl = 0.5 * S[LIN_STAN.dent] < 0.5 * b ? 0.5 * S[LIN_STAN.dent] : 0.5 * b;
    const top = BLONA.yc + WB[3] + b - dl;
    if (D.y[i] <= top) {
      S[LIN_STAN.hitS] = i;
      S[LIN_STAN.hitX] = x;
      S[LIN_STAN.hitY] = D.y[i];
      return;
    }
  }
}

/**
 * Miejsce wpadania strugi na PUSTY rękaw (raz przy ładowaniu modułu): pierwszy punkt łuku strugi na wysokości płaskiej
 * błony. Zacisk otwiera rękaw za tym punktem, zanim metal dotrze do wylewki.
 */
export const LAND_X0 = (() => {
  for (let i = Math.ceil(DROGA.sLip); i < DROGA.n - 1; i++) if (DROGA.y[i] <= BLONA.yc + BLONA.collH) return DROGA.x[i];
  return DROGA.x[DROGA.n - 1];
})();

/**
 * ZACISK POLA (krok 1/240 s): wędrująca przewężka rękawa. Cel: brzuch tuż przed rampą zacisku rozciągnięty tak, jak
 * trzyma go ciśnienie wypływu — r* = (Q / Q_nom)^pExp (przekrój / A_ref). Brzuch luźniejszy niż cel (metal ubył przez
 * gardziel) → zacisk POSUWA się ku G0 i wyciska metal przed sobą; brzuch bardziej rozciągnięty (zrzut) → zacisk cofa się
 * ku tyłowi rękawa. Przed zrzutem (zawór wylewki chce się otworzyć, metal w rurze albo w strudze) zacisk OTWIERA rękaw za
 * miejscem wpadania strugi (`landMargin`). Posuw ma bezwładność bramki (τ `tauU`) — położenie zmienia się płynnie.
 */
function pinchStep(X) {
const { S, CV, C } = X;
  const B = BLONA;
  const xp = S[LIN_STAN.pinX];
  // rozciągnięcie brzucha tuż przed rampą (dwie komórki za jej końcem)
  let ib = Math.ceil((xp + B.wp - B.x0) / RK_DX - 0.5) | 0;
  ib = ib < 0 ? 0 : ib > RK_N - 2 ? RK_N - 2 : ib;
  const r = 0.5 * (CV[ib] / RK_CN[ib] + CV[ib + 1] / RK_CN[ib + 1]) / (RK_DX * B.Aref);
  let p = S[LIN_STAN.attached] ? S[LIN_STAN.Q] / P.qNom : 1;
  p = p < 0.5 ? 0.5 : p > 1.6 ? 1.6 : p;
  const rt = Math.pow(p, B.pExp);
  S[LIN_STAN.pinR] = r;
  S[LIN_STAN.pinRt] = rt;
  // bramka pola TRZYMA położenie, dopóki brzuch nie przeważy jej wyraźnie (rozciągnięcie ponad cel o `hold`): przy
  // zwykłym wahaniu ciśnienia i przy zwalnianiu linii zacisk stoi albo idzie naprzód — między zrzutami jedzie tylko ku G0
  const over = r * r - rt * rt * (1 + B.hold);
  let u = r < rt ? B.kU * (rt * rt - r * r) / (rt * rt) : over > 0 ? -B.kU * over / (rt * rt) : 0;
  u = u > B.uFwd ? B.uFwd : u < -B.uBack ? -B.uBack : u;
  // otwarcie przed zrzutem: zacisk za miejscem wpadania strugi (na pusty rękaw albo w miejscu wejścia w metal)
  const want = S[LIN_STAN.spoutWant] > 0 || C[LIN_LICZNIK.pipe] > 0 || C[LIN_LICZNIK.jet] > 0;
  S[LIN_STAN.opening] = 0;
  if (want) {
    const xl = S[LIN_STAN.inRate] > 0.5 && S[LIN_STAN.hitX] < LAND_X0 ? S[LIN_STAN.hitX] : LAND_X0;
    S[LIN_STAN.landX] = xl;
    // (cel położenia, nie próg: zacisk dochodzi do `xo` i stoi — przed nim pusty rękaw, ciśnienie brzucha nie pcha go
    // z powrotem pod strugę)
    const xo = xl - B.landMargin;
    let uo = 3 * (xo - xp);
    uo = uo < -B.uOpen ? -B.uOpen : uo > 0 ? 0 : uo;
    if (u > uo) { u = uo; S[LIN_STAN.opening] = xp > xo + 2 ? 1 : 0; }
  } else S[LIN_STAN.landX] = LAND_X0;
  S[LIN_STAN.pinV] += (u - S[LIN_STAN.pinV]) * (1 - Math.exp(-h / B.tauU));
  let x = xp + S[LIN_STAN.pinV] * h;
  const lo = B.x0 - 0.35 * B.wp;
  if (x < lo) { x = lo; if (S[LIN_STAN.pinV] < 0) S[LIN_STAN.pinV] = 0; }
  if (x > B.xpMax) { x = B.xpMax; if (S[LIN_STAN.pinV] > 0) S[LIN_STAN.pinV] = 0; }
  S[LIN_STAN.pinX] = x;
  // siła zacisku: ciśnienie, które bramka trzyma (rozciągnięcie brzucha przy niej), ścisk regulatora, posuw naprzód
  const adv = S[LIN_STAN.pinV] > 0 ? S[LIN_STAN.pinV] / B.uFwd : 0;
  const rr = r < 1.4 ? r : 1.4;
  S[LIN_STAN.pinF] = S[LIN_STAN.resV] > 0 ? (0.45 + 0.9 * S[LIN_STAN.sq]) * (0.25 + 0.75 * rr) + 0.6 * (adv < 1 ? adv : 1) : 0.2;
}

/**
 * RĘKAW (krok 1/240 s): komórki objętości metalu wzdłuż rękawa, przepływ między nimi z różnicy ciśnień napięcia błony
 * (Φ = G · (a / (c · A_ref))², c — szyja × rampa zacisku), tłumiony polem (γ). Komórki za zaciskiem (rampa < `cMin`) są
 * zamknięte: ich metal przechodzi do pierwszej otwartej przed nimi (zacisk wyciska), ściany przy nich nie przepuszczają.
 * Przepływ ograniczony do 45 % objętości dawcy na krok. Objętość wraca do masy błony (`resV`) co do zaokrąglenia — masa
 * całkowita jest w liczniku, komórki niosą jej rozkład.
 */
function tubeStep(X) {
const { S, CV, CU, CC, CP, FL } = X;
  const B = BLONA;
  const xp = S[LIN_STAN.pinX];
  const cMin = B.cMin;
  let carry = 0;
  for (let i = 0; i < RK_N; i++) {
    let t = (RK_X[i] - xp) / B.wp;
    t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); t *= t;
    const c = RK_CN[i] * t;
    CC[i] = c;
    if (c < cMin) { carry += CV[i]; CV[i] = 0; CP[i] = 0; continue; }
    if (carry > 0) { CV[i] += carry; carry = 0; }
    let r = CV[i] / (RK_DX * c * B.Aref);
    r = r > B.rMax ? B.rMax : r;
    CP[i] = RK_G * r * r;
  }
  if (carry > 0) CV[RK_N - 1] += carry;
  const damp = 1 / (1 + h * B.gamma);
  CU[0] = 0; CU[RK_N] = 0; FL[0] = 0; FL[RK_N] = 0;
  for (let j = 1; j < RK_N; j++) {
    if (CC[j - 1] < cMin || CC[j] < cMin) { CU[j] = 0; FL[j] = 0; continue; }
    let u = (CU[j] - h * (CP[j] - CP[j - 1]) / RK_DX) * damp;
    const d = u >= 0 ? j - 1 : j;
    const ad = CV[d] / RK_DX;
    let v = u * ad * h;
    const lim = 0.45 * CV[d];
    if (v > lim) { v = lim; u = ad > 1e-9 ? v / (ad * h) : 0; } else if (v < -lim) { v = -lim; u = ad > 1e-9 ? v / (ad * h) : 0; }
    CU[j] = u;
    FL[j] = v;
  }
  for (let j = 1; j < RK_N; j++) { CV[j - 1] -= FL[j]; CV[j] += FL[j]; }
  tubeNorm(X);
}

/** Rozkład komórek dopasowany do masy błony (`resV`) — zaokrąglenia; ujemne resztki do zera. */
function tubeNorm(X) {
const { S, CV } = X;
  const want = S[LIN_STAN.resV] * VOL_UNIT;
  let sum = 0;
  for (let i = 0; i < RK_N; i++) { if (CV[i] < 0) CV[i] = 0; sum += CV[i]; }
  if (want <= 0) { for (let i = 0; i < RK_N; i++) CV[i] = 0; return; }
  if (sum <= 0) { CV[RK_N - 1] = want; return; }
  const k = want / sum;
  for (let i = 0; i < RK_N; i++) CV[i] *= k;
}

/**
 * Dopływ strugi: objętość TV[0] do komórek wokół miejsca wejścia (Gauss σ 20 j.), tylko otwartych (przed zaciskiem).
 * (Objętość przez brudnopis — bez liczby w argumencie.)
 */
function tubeInflow(X) {
const { S, CV, CC, CW, TV } = X;
  const v = TV[0];
  const x0 = S[LIN_STAN.hitX];
  let sum = 0;
  for (let i = 0; i < RK_N; i++) {
    const d = (RK_X[i] - x0) / 20;
    const w = CC[i] >= BLONA.cMin && d * d < 16 ? Math.exp(-d * d) : 0;
    CW[i] = w; sum += w;
  }
  if (sum <= 0) {
    // (nie zdarza się: zacisk otwiera rękaw za miejscem wpadania) — do pierwszej otwartej komórki przed zaciskiem
    for (let i = 0; i < RK_N; i++) if (CC[i] >= BLONA.cMin) { CV[i] += v; return; }
    CV[RK_N - 1] += v;
    return;
  }
  for (let i = 0; i < RK_N; i++) if (CW[i] > 0) CV[i] += v * CW[i] / sum;
}

/** Wypływ przez gardziel G0: objętość TV[0] z ostatniej komórki szyi (brak — z poprzednich). */
function tubeOutflow(X) {
const { CV, TV } = X;
  let v = TV[0];
  for (let i = RK_N - 1; i >= 0 && v > 0; i--) {
    const t = CV[i] < v ? CV[i] : v;
    CV[i] -= t;
    v -= t;
  }
}

/**
 * Rozkład równowagi (start strony z wypełnioną błoną): zacisk tam, gdzie brzuch o przekroju r* · A_ref (szyja × rampa)
 * mieści masę `resV`; przy masie większej niż cały rękaw — zacisk na tylnym ograniczniku, brzuch rozciągnięty.
 */
function tubeEquilibrium(X, p) {
const { S, CV } = X;
  const B = BLONA;
  const want = S[LIN_STAN.resV] * VOL_UNIT;
  const a = Math.pow(p, B.pExp) * B.Aref * RK_DX;
  const lo = B.x0 - 0.35 * B.wp;
  let xp = B.xpMax;
  for (; xp > lo; xp -= 1) {
    let cap = 0;
    for (let i = 0; i < RK_N; i++) {
      let t = (RK_X[i] - xp) / B.wp;
      t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); t *= t;
      cap += RK_CN[i] * t * a;
    }
    if (cap >= want) break;
  }
  S[LIN_STAN.pinX] = xp < lo ? lo : xp;
  S[LIN_STAN.pinV] = 0;
  for (let i = 0; i < RK_N; i++) {
    let t = (RK_X[i] - S[LIN_STAN.pinX]) / B.wp;
    t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); t *= t;
    CV[i] = RK_CN[i] * t * a;
    X.CC[i] = RK_CN[i] * t;
  }
  tubeNorm(X);
}

/**
 * Fala na błonie (1D wzdłuż brzucha od zacisku do gardzieli, węzły u = i / (N − 1), końce przy zacisku i gardzieli
 * unieruchomione): równanie falowe z tłumieniem, prędkość `etaC` [j./s] (w u: / L); średnia zero (objętość w masie, fala
 * tylko ją przesuwa). Fala powierzchni — drobna, ponad przepływ w rękawie (`tubeStep`).
 */
function waveStep(X) {
const { S, ETA } = X;
  const N = P.etaN;
  const Lb = BLONA.xG0 - S[LIN_STAN.pinX];
  const L = Lb > 60 ? Lb : 60;
  const du = 1 / (N - 1);
  const cu = P.etaC / L;
  const k2 = cu * cu / (du * du);
  const damp = 1 / (1 + 2 * P.etaGamma * h);
  for (let i = 1; i < N - 1; i++) {
    const a = k2 * (ETA[i - 1] - 2 * ETA[i] + ETA[i + 1]);
    ETA[N + i] = (ETA[N + i] + a * h) * damp;
  }
  let mean = 0;
  let e = 0;
  for (let i = 1; i < N - 1; i++) {
    ETA[i] += ETA[N + i] * h;
    if (ETA[i] > P.etaMax) { ETA[i] = P.etaMax; if (ETA[N + i] > 0) ETA[N + i] = 0; }
    if (ETA[i] < -P.etaMax) { ETA[i] = -P.etaMax; if (ETA[N + i] < 0) ETA[N + i] = 0; }
    mean += ETA[i];
  }
  mean /= N - 2;
  for (let i = 1; i < N - 1; i++) { ETA[i] -= mean; e += ETA[i] * ETA[i]; }
  ETA[0] = 0; ETA[N - 1] = 0; ETA[N] = 0; ETA[2 * N - 1] = 0;
  S[LIN_STAN.etaE] = Math.sqrt(e / (N - 2));
}

/** s granicy górnej plastra o indeksie (kolejność od czoła) i. */
function upS(X, i) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  const o = sl(ring, i);
  const t = SL[o + PL.tail];
  if (t === 2) return P.sG0;
  if (t === 1) return SL[o + PL.ts];
  return SL[sl(ring, i + 1) + PL.s];
}

function upU(X, i) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  const o = sl(ring, i);
  const t = SL[o + PL.tail];
  if (t === 2) return S[LIN_STAN.vLine];
  if (t === 1) return SL[o + PL.tu];
  return SL[sl(ring, i + 1) + PL.u];
}

/** TOP[i], TOPU[i] — granica górna plastra i (od czoła) i jej prędkość. */
function tops(X, n) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  const sG0 = P.sG0;
  const vL = S[LIN_STAN.vLine];
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    const t = SL[o + PL.tail];
    if (t === 2) { TOP[i] = sG0; TOPU[i] = vL; } else if (t === 1) { TOP[i] = SL[o + PL.ts]; TOPU[i] = SL[o + PL.tu]; } else { const on = sl(ring, i + 1); TOP[i] = SL[on + PL.s]; TOPU[i] = SL[on + PL.u]; }
  }
}

/** Nowy plaster otwarty przy G0 (na końcu pierścienia). */
function openSlice(X, front) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  if (ring[1] >= SLICE_CAP) return -1;
  const i = ring[1];
  ring[1]++;
  const o = sl(ring, i);
  for (let k = 0; k < SLICE_STRIDE; k++) SL[o + k] = 0;
  SL[o + PL.s] = P.sG0;
  SL[o + PL.u] = S[LIN_STAN.vLine];
  const x = S[LIN_STAN.resX];
  W[14] = x; props(X);
  SL[o + PL.H] = S[LIN_STAN.resT] + W[2];
  SL[o + PL.x] = x;
  SL[o + PL.m0] = S[LIN_STAN.m0];
  SL[o + PL.tail] = 2;
  SL[o + PL.a] = GATE_W[0] / 2;
  SL[o + PL.A] = P.A0;
  SL[o + PL.n] = GATE_N[0];
  SL[o + PL.ct] = S[LIN_STAN.time];
  // poprzedni otwarty plaster zamyka się: jego granicą górną jest teraz dolna granica nowego
  if (i > 0 && !front) {
    const op = sl(ring, i - 1);
    if (SL[op + PL.tail] === 2) SL[op + PL.tail] = 0;
  }
  return i;
}

function regTarget(X) {
const { S, RG, REG } = X;
  const Vt = S[LIN_STAN.resV] / UNITS_T;
  // górna granica z metalu (miedź krzepnie dalej — `regHiCu`), mieszana udziałem miedzi w błonie
  const hi = REG[2] + (REG[4] - REG[2]) * S[LIN_STAN.resX];
  let k = 1 + REG[0] * (Vt / REG[1] - 1);
  k = k < REG[3] ? REG[3] : k > hi ? hi : k;
  RG[0] = P.qNom * k;
}

/**
 * RURA SPUSTOWA (podkrok), dwie fazy:
 * CZOŁO SPŁYWU (`pipeOn` = 0) — pierwszy metal z gardzieli to cienka struga rozruchu (dopływ rośnie od zera): pakiety
 *   biegną rurą każdy z prędkością wylotu (jak dotąd) i przechodzą przez wargę w kolejności; struga za wargą ma przekrój
 *   z dopływu z chwili wylotu — czoło dolatuje do błony cienką nicią z kroplą, a struga grubieje, gdy dochodzi pełny spływ.
 * KOLUMNA (`pipeOn` = 1; od chwili, gdy przez wargę przechodzi metal pełnego spływu, do opróżnienia rury) — metal w rurze
 *   jest ciągły (nie rozrywa się w rurze): pole rury ściska go, ciśnienie rośnie z wypełnieniem, wypływ przez wargę
 *   Q = pipeQ · √(M / M_pełna) (pełna rura — pełny spływ gardzieli), więc gdy dopływ słabnie, wypływ maleje w sposób ciągły
 *   (nigdy nie rośnie, gdy masy ubywa) i kończy się w skończonym czasie; przejście z fazy czoła płynne (`rampOut` s).
 *   Metal opuszcza rurę od najstarszego — co podkrok jeden pakiet strugi na wardze (masa, temperatura, metal, puls, skręt
 *   i współrzędna wzoru ważone masą); prędkość na wardze: pełnym przekrojem Q · ρ / A_rury, a gdy metal w rurze płynie
 *   cieńszą strugą — z prędkością jego wylotu (bezwładność τ 0,1 s).
 * Koniec: wypływ z wypełnienia maleje liniowo do zera (√M) — nić na wardze cienieje do zera w ~0,1 s i urywa się; ogon
 * strugi leci do błony. Zawór zamknięty — metal czeka w rurze. (Bez alokacji; wartości przez tablice kontekstu.)
 */
function pipeStep(X, open) {
  const { S, C, JT, PT, ring } = X;
  const sLip = P.sLip;
  if (ring[5] === 0) {
    // rura pusta: koniec spływu (dopóki komora oddaje metal, kolumna zostaje — pakiet dojdzie w tym kroku strony)
    if (S[LIN_STAN.jetOn] === 0) { S[LIN_STAN.pipeOn] = 0; S[LIN_STAN.pipeFront] = 0; S[LIN_STAN.lipCarry] = 0; S[LIN_STAN.lipV] = 0; S[LIN_STAN.lipRamp] = 0; }
    S[LIN_STAN.lipQ] = 0;
    return;
  }
  if (S[LIN_STAN.pipeOn] === 0) {
    // --- CZOŁO SPŁYWU: pakiety biegną rurą z prędkością wylotu, przez wargę w kolejności (bez wyprzedzania) ---
    let crossed = 0;
    for (let k = 0; k < ring[5]; k++) {
      const i = ((ring[4] + k) & JMASK) * JET_STRIDE;
      PT[i + PJ.s] += PT[i + PJ.v] * h;
    }
    while (ring[5] > 0) {
      const i = (ring[4] & JMASK) * JET_STRIDE;
      if (PT[i + PJ.s] < sLip) break;
      if (!open) { PT[i + PJ.s] = sLip - 0.25; break; }      // zawór zamknięty — metal czeka w wylewce
      if (ring[3] >= JET_CAP) break;
      const j = ((ring[2] + ring[3]) & JMASK) * JET_STRIDE;
      ring[3]++;
      for (let k = 0; k < JET_STRIDE; k++) JT[j + k] = PT[i + k];
      JT[j + PJ.va] = PT[i + PJ.v];
      const m = PT[i + PJ.m];
      // współrzędna wzoru strugi z ZEGARA WARGI (niżej, w fazie kolumny — to samo)
      JT[j + PJ.m0] = S[LIN_STAN.time] * PAT_RATE + crossed;
      crossed += m;
      C[LIN_LICZNIK.pipe] -= m;
      C[LIN_LICZNIK.jet] += m;
      ring[4] = (ring[4] + 1) & JMASK; ring[5]--;
      S[LIN_STAN.lipQ] = PT[i + PJ.q];
      S[LIN_STAN.lipV] = PT[i + PJ.v];
      // przez wargę przechodzi już pełny spływ — dalej prowadzi kolumna
      if (PT[i + PJ.q] >= 0.97 * S[LIN_STAN.jetQ]) {
        S[LIN_STAN.pipeOn] = 1;
        S[LIN_STAN.lipRamp] = 1;
        S[LIN_STAN.lipQ0] = PT[i + PJ.q];
        S[LIN_STAN.lipCarry] = 0;
        break;
      }
    }
    S[LIN_STAN.pipeFront] = ring[5] > 0 ? PT[(ring[4] & JMASK) * JET_STRIDE + PJ.s] : 0;
    // rura już pełna za czołem (metal przeszedł przez wargę, a masa w rurze sięga jej objętości) — kolumna prowadzi od tej
    // chwili (pełny spływ dogania cienkie czoło; bez tego szybszy metal zbijałby się za wolniejszym czołem w rurze)
    if (S[LIN_STAN.pipeOn] === 0 && S[LIN_STAN.lipQ] > 0 && C[LIN_LICZNIK.pipe] >= PIPE_FULL_T * UNITS_T) {
      S[LIN_STAN.pipeOn] = 1;
      S[LIN_STAN.lipRamp] = 1;
      S[LIN_STAN.lipQ0] = S[LIN_STAN.lipQ];
      S[LIN_STAN.lipCarry] = 0;
    }
    if (S[LIN_STAN.pipeOn] === 0) return;
  }
  // --- KOLUMNA ---
  S[LIN_STAN.pipeFront] = sLip;
  if (!open) { S[LIN_STAN.lipQ] = 0; return; }
  const Mt = C[LIN_LICZNIK.pipe] / UNITS_T;
  let Q = P.pipeQ * Math.sqrt(Mt / PIPE_FULL_T);
  if (S[LIN_STAN.lipRamp] > 0) {
    // przejście z fazy czoła: od wypływu ostatniego pakietu czoła do wypływu z wypełnienia
    S[LIN_STAN.lipRamp] -= h / P.rampOut;
    if (S[LIN_STAN.lipRamp] < 0) S[LIN_STAN.lipRamp] = 0;
    Q += (S[LIN_STAN.lipQ0] - Q) * S[LIN_STAN.lipRamp];
  }
  const want = Q * UNITS_T * h + S[LIN_STAN.lipCarry];
  let du = Math.floor(want);
  S[LIN_STAN.lipCarry] = want - du;
  if (du >= C[LIN_LICZNIK.pipe]) { du = C[LIN_LICZNIK.pipe]; S[LIN_STAN.lipCarry] = 0; }
  const ih = (ring[4] & JMASK) * JET_STRIDE;
  let ut = Q * VOL_TON / A_PIPE;
  if (PT[ih + PJ.v] > ut) ut = PT[ih + PJ.v];
  if (ut < P.pipeVmin) ut = P.pipeVmin;
  let u = S[LIN_STAN.lipV];
  u = u <= 0 ? ut : u + (ut - u) * LIP_TAU_K;
  S[LIN_STAN.lipQ] = Q;
  S[LIN_STAN.lipV] = u;
  if (du <= 0 || ring[3] >= JET_CAP) return;
  // pakiet strugi z czoła kolumny: masa z najstarszych pakietów rury, cechy ważone masą
  let left = du;
  let mT = 0, mX = 0, mP = 0, mW = 0;
  while (left > 0 && ring[5] > 0) {
    const i = (ring[4] & JMASK) * JET_STRIDE;
    const have = PT[i + PJ.m];
    const t = have < left ? have : left;
    mT += PT[i + PJ.T] * t; mX += PT[i + PJ.x] * t; mP += PT[i + PJ.p] * t; mW += PT[i + PJ.tw] * t;
    left -= t;
    if (t >= have) { ring[4] = (ring[4] + 1) & JMASK; ring[5]--; } else { PT[i + PJ.m] = have - t; PT[i + PJ.m0] += t; }
  }
  const j = ((ring[2] + ring[3]) & JMASK) * JET_STRIDE;
  ring[3]++;
  JT[j + PJ.s] = sLip;
  JT[j + PJ.v] = u;
  JT[j + PJ.m] = du;
  JT[j + PJ.T] = mT / du;
  JT[j + PJ.x] = mX / du;
  JT[j + PJ.p] = mP / du;
  // WSPÓŁRZĘDNA WZORU strugi (pola cieplejsze i chłodniejsze, komórki — obraz) z zegara wargi, w jednostkach masy przy pełnym
  // spływie: metal niesie wzór (płynie z nim), a rozmiar pól na strudze nie rośnie, gdy wypływ maleje — przy współrzędnej
  // z masy w ogonie jedno pole obejmowało całą strugę i struga migała ciemno ↔ jasno (~2 Hz)
  JT[j + PJ.m0] = S[LIN_STAN.time] * PAT_RATE;
  JT[j + PJ.tw] = mW / du;
  JT[j + PJ.q] = Q;
  JT[j + PJ.va] = u;
  C[LIN_LICZNIK.pipe] -= du;
  C[LIN_LICZNIK.jet] += du;
}

function substep(X, emitUnits, inp) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  S[LIN_STAN.time] += h;
  const time = S[LIN_STAN.time];
  // ===== STRUGA: nowy pakiet przy wardze, ruch, oddanie do zasobnika =====
  if (emitUnits > 0) {
    const x = inp[LIN_WEJ.metal] ? 1 : 0;
    W[14] = x; props(X);
    let Tin = W[10] + P.resTinOver * (inp[LIN_WEJ.tempT] - 1);
    if (Tin < W[1] + 5) Tin = W[1] + 5;
    const qT = emitUnits / UNITS_T / (h * 2);            // dwa pakiety na krok strony → tempo z jednego
    // wypływ wygładzony (τ 0,05 s): całkowite jednostki komory drgają o ±1 — prędkość i przekrój strugi nie
    if (S[LIN_STAN.jetQs] <= 0) S[LIN_STAN.jetQs] = qT;
    S[LIN_STAN.jetQs] += (qT - S[LIN_STAN.jetQs]) * (1 - Math.exp(-(h * 2) / 0.05));
    const qS = S[LIN_STAN.jetQs];
    const vh = Math.sqrt(2 * P.jetG * Math.max(inp[LIN_WEJ.head], 0));
    const vq = qS * VOL_TON / (P.jetCd * Math.PI * P.jetR * P.jetR);
    let v = vh > vq ? vh : vq;
    v = v < P.jetVmin ? P.jetVmin : v > P.jetVmax ? P.jetVmax : v;
    // puls wylotu (wir gardzieli, zawirowania w dyszy): proces Ornsteina–Uhlenbecka o wariancji 1, τ 0,12 s — niesie
    // go pakiet (przewężenia i zgrubienia płyną ze strugą)
    S[LIN_STAN.pulse] += (-S[LIN_STAN.pulse] / 0.12) * (h * 2) + (rnd(X), W[15] - 0.5) * 3.4641 * Math.sqrt(2 * (h * 2) / 0.12);
    // drugi stopień (gładki przebieg: przekrój zmienia się płynnie wzdłuż strugi, bez chropowatości ruchu Browna)
    S[LIN_STAN.pulse2] += (S[LIN_STAN.pulse] - S[LIN_STAN.pulse2]) * ((h * 2) / 0.07);
    const PT = X.PT;
    if (ring[5] < JET_CAP) {
      // metal wchodzi do RURY (kolejka od wargi dyszy); `v` — prędkość wylotu z gardzieli (czoło przy napełnianiu)
      const j = ((ring[4] + ring[5]) & JMASK) * JET_STRIDE;
      ring[5]++;
      PT[j + PJ.s] = P.sJet0;
      PT[j + PJ.v] = v;
      PT[j + PJ.m] = emitUnits;
      PT[j + PJ.T] = Tin;
      PT[j + PJ.x] = x;
      PT[j + PJ.p] = S[LIN_STAN.pulse2] * 1.6;
      PT[j + PJ.m0] = S[LIN_STAN.jm0];
      PT[j + PJ.tw] = inp[LIN_WEJ.twist];
      PT[j + PJ.q] = qS;
      PT[j + PJ.va] = v;
      S[LIN_STAN.jm0] += emitUnits;
      C[LIN_LICZNIK.pipe] += emitUnits;
      C[LIN_LICZNIK.inflow] += emitUnits;
      S[LIN_STAN.jetV] = v;
      S[LIN_STAN.jetQ] = qS;
    } else {
      // (pierścień pełny — nie zdarza się: rura i struga ≤ ~700 pakietów) masa od razu do błony
      C[LIN_LICZNIK.inflow] += emitUnits;
      S[LIN_STAN.resV] += emitUnits;
      C[LIN_LICZNIK.reservoir] += emitUnits;
      X.TV[0] = emitUnits * VOL_UNIT;
      tubeInflow(X);
    }
  }
  let arrived = 0;
  {
    const sHit = S[LIN_STAN.hitS];
    const sLip = P.sLip;
    const open = S[LIN_STAN.spout] >= 0.999;
    const yLip = DROGA.y[Math.ceil(sLip) | 0];
    pipeStep(X, open);
    // pakiety strugi od najstarszego (najdalej): warga → pole ciągnie w dół wzdłuż łuku → błona. Prędkość z energii na
    // drodze (v² = v_wargi² + E_kołnierza + 2·g_pola·spadek) — ta sama funkcja drogi dla każdego pakietu, a prędkość na
    // wardze maleje w czasie, więc pakiety nie wyprzedzają się, a struga rozciąga się tylko w sposób ciągły
    for (let k = 0; k < ring[3]; k++) {
      const j = ((ring[2] + k) & JMASK) * JET_STRIDE;
      const s0 = JT[j + PJ.s];
      let v = JT[j + PJ.v];
      if (s0 > sLip) {
        const dy = yLip - DROGA.y[s0 < DROGA.n - 1 ? s0 | 0 : DROGA.n - 1];
        const ec = (s0 - sLip) / P.collarLen;
        v = Math.sqrt(v * v + P.collarE * (ec < 1 ? ec : 1) + 2 * P.fieldG * (dy > 0 ? dy : 0));
      }
      JT[j + PJ.s] = s0 + v * h;
      JT[j + PJ.va] = v;
    }
    while (ring[3] > 0) {
      const j = (ring[2] & JMASK) * JET_STRIDE;
      if (JT[j + PJ.s] < sHit || JT[j + PJ.s] < sLip) break;
      const m = JT[j + PJ.m];
      const V0 = S[LIN_STAN.resV];
      const Vn = V0 + m;
      // mieszanie: temperatura i metal ważone masą
      S[LIN_STAN.resT] = (S[LIN_STAN.resT] * V0 + JT[j + PJ.T] * m) / Vn;
      S[LIN_STAN.resX] = (S[LIN_STAN.resX] * V0 + JT[j + PJ.x] * m) / Vn;
      S[LIN_STAN.resV] = Vn;
      // metal wchodzi do rękawu w miejscu wejścia strugi (komórki wokół punktu wejścia) — rozpływa się z ciśnienia
      X.TV[0] = m * VOL_UNIT;
      tubeInflow(X);
      C[LIN_LICZNIK.jet] -= m;
      C[LIN_LICZNIK.reservoir] += m;
      arrived += m;
      // pęd strugi (z góry, po hamowaniu polem) pobudza błonę: ugięcie w dół (mod pionowy), przelewanie wzdłuż osi
      // (składowa pozioma strugi ku gardzieli), oddech — losowo; fala rusza od wlotu
      const Req = S[LIN_STAN.resReq];
      const vp = JT[j + PJ.v];
      const vIn = Math.sqrt(vp * vp + P.collarE + 2 * P.fieldG * (yLip - S[LIN_STAN.hitY] > 0 ? yLip - S[LIN_STAN.hitY] : 0));
      S[LIN_STAN.vIn] = vIn;
      const dv = (m / Vn) * vIn;
      const iS = S[LIN_STAN.hitS] | 0;
      const tx = DROGA.tx[iS];
      const ty = DROGA.ty[iS];
      S[LIN_STAN.qd2] += 0.45 * ty * dv / Req;
      S[LIN_STAN.qd1] += 0.32 * tx * dv / Req;
      S[LIN_STAN.qd0] += (rnd(X), 0.07 + 0.13 * (W[15] - 0.5)) * dv / Req;
      {
        const N = P.etaN;
        let iu = Math.round((S[LIN_STAN.hitX] - S[LIN_STAN.pinX]) / Math.max(60, BLONA.xG0 - S[LIN_STAN.pinX]) * (N - 1));
        iu = iu < 1 ? 1 : iu > N - 2 ? N - 2 : iu;
        X.ETA[N + iu] -= P.etaKick * dv / Req;
        X.ETA[N + iu - 1] -= 0.5 * P.etaKick * dv / Req;
        X.ETA[N + iu + 1] -= 0.5 * P.etaKick * dv / Req;
      }
      ring[2] = (ring[2] + 1) & JMASK;
      ring[3]--;
    }
    // struga sięga błony od pierwszego metalu, który do niej doleciał, do zniknięcia ostatniego pakietu (ogon wpada)
    if (arrived > 0) S[LIN_STAN.landed] = 1;
    if (ring[3] === 0) S[LIN_STAN.landed] = 0;
    // czoło i ogon strugi
    if (ring[3] > 0) {
      S[LIN_STAN.jetHead] = JT[(ring[2] & JMASK) * JET_STRIDE + PJ.s];
      S[LIN_STAN.jetTail] = JT[((ring[2] + ring[3] - 1) & JMASK) * JET_STRIDE + PJ.s];
    } else { S[LIN_STAN.jetHead] = -1; S[LIN_STAN.jetTail] = -1; }
  }
  const inRate = arrived / UNITS_T / h;
  S[LIN_STAN.inRate] += (inRate - S[LIN_STAN.inRate]) * (1 - Math.exp(-h / 0.25));
  S[LIN_STAN.splash] = inRate;

  // ===== BŁONA: kształt, fala, wgniecenie pod strugą, mody, temperatura =====
  resShape(X);
  waveStep(X);
  {
    // wgniecenie pod strugą: strumień pędu (dopływ × prędkość wejścia) wgniata błonę — rośnie szybko, puszcza z napięciem
    const want = Math.min(0.0008 * S[LIN_STAN.inRate] * S[LIN_STAN.vIn], 0.4 * S[LIN_STAN.memH]);
    S[LIN_STAN.dent] += (want - S[LIN_STAN.dent]) * (want > S[LIN_STAN.dent] ? 1 - Math.exp(-h / 0.15) : 1 - Math.exp(-h / 0.6));
  }
  {
    const Req = S[LIN_STAN.resReq];
    for (let k = 0; k < 3; k++) {
      const l = k === 1 ? 3 : 2;
      const om = modeOmega(l, Req);
      const ga = modeGamma(l, Req) + 0.15;
      const iq = LIN_STAN.q0 + k;
      const iv = LIN_STAN.qd0 + k;
      // półniejawnie (stabilnie przy małej masie): v += (−ω²q − 2γv)·h; q += v·h
      S[iv] = (S[iv] - om * om * S[iq] * h) / (1 + 2 * ga * h);
      S[iq] += S[iv] * h;
      if (S[iq] > 0.16) { S[iq] = 0.16; if (S[iv] > 0) S[iv] = 0; }
      if (S[iq] < -0.16) { S[iq] = -0.16; if (S[iv] < 0) S[iv] = 0; }
    }
    if (S[LIN_STAN.resV] > 0) {
      W[14] = S[LIN_STAN.resX]; props(X);
      S[LIN_STAN.resT] += (W[10] - S[LIN_STAN.resT]) * (h / P.resHoldTau);
    } else {
      W[14] = S[LIN_STAN.resX]; props(X);
      S[LIN_STAN.resT] = W[10];
    }
  }

  // ===== TRYB I PRĘDKOŚĆ LINII =====
  const mode = S[LIN_STAN.mode];
  const Vt = S[LIN_STAN.resV] / UNITS_T;
  if (mode === TRYB.PUSTA || mode === TRYB.OGON) {
    // nowe czoło: dość metalu w zasobniku i ogon poprzedniego pasma daleko za wylotem
    tops(X, ring[1]);
    const lastTail = ring[1] > 0 ? TOP[ring[1] - 1] : 1e9;
    if (Vt >= P.startT && (ring[1] === 0 || lastTail > P.sG0 + P.startGap) && ring[1] < SLICE_CAP - 8) {
      S[LIN_STAN.mode] = TRYB.ROZRUCH;
      S[LIN_STAN.threadT] = 0;
      S[LIN_STAN.attached] = 1;
      S[LIN_STAN.starts]++;
      S[LIN_STAN.Qcmd] = P.thread * P.qNom;
      S[LIN_STAN.vLine] = P.thread * vNom;
      openSlice(X, true);
    }
  }
  if (S[LIN_STAN.mode] === TRYB.ROZRUCH) {
    S[LIN_STAN.threadT] += h;
    S[LIN_STAN.Qtarget] = P.thread * P.qNom;
    S[LIN_STAN.Qcmd] = P.thread * P.qNom;
    // czoło nowego pasma minęło nóż dzielenia → rampa do regulatora
    // (czoło najnowszego pasma; wynik w tablicy — bez zmiennej o dwóch reprezentacjach)
    RG[1] = -1;
    for (let i = ring[1] - 1; i >= 0; i--) {
      if (i === 0 || SL[sl(ring, i - 1) + PL.tail] === 1) { RG[1] = SL[sl(ring, i) + PL.s]; break; }
    }
    if (RG[1] >= GATE_S) S[LIN_STAN.mode] = TRYB.PRACA;
  } else if (S[LIN_STAN.mode] === TRYB.PRACA || S[LIN_STAN.mode] === TRYB.DOBIEG) {
    regTarget(X);
    const tgt = S[LIN_STAN.mode] === TRYB.DOBIEG ? P.qNom * P.regHi : CTL[0] > 0 ? P.qNom * CTL[0] : RG[0];
    const REG = X.REG;
    S[LIN_STAN.Qtarget] = tgt;
    const dq = tgt - S[LIN_STAN.Qcmd];
    const lim = REG[5] * P.qNom * h;
    S[LIN_STAN.Qcmd] += dq > lim ? lim : dq < -lim ? -lim : dq;
  }
  // ===== BŁONA: ciśnienie napięcia, ŚCISK prasy (regulator), WYPŁYW przez gardziel formującą =====
  // p = p_napięcia(V) + σ (w jednostkach Q_nom); wypływ Q = Q_nom · p — gardziel przepuszcza tyle, ile wyciska ciśnienie
  {
    const pt = P.pT * Math.pow(Vt / BLONA.Vpk + 1e-12, 2 / 3);
    S[LIN_STAN.pT] = pt;
    let st = S[LIN_STAN.Qcmd] / P.qNom - pt;
    st = st < 0 ? 0 : st > 1 ? 1 : st;
    if (S[LIN_STAN.sqForce] >= 0) st = S[LIN_STAN.sqForce];
    if (!S[LIN_STAN.attached]) st = 0;
    S[LIN_STAN.sqT] = st;
    const ds = st - S[LIN_STAN.sq];
    const lim = (S[LIN_STAN.sqForce] >= 0 ? 50 : P.sqRate) * h;
    S[LIN_STAN.sq] += ds > lim ? lim : ds < -lim ? -lim : ds;
    S[LIN_STAN.Q] = S[LIN_STAN.attached] ? P.qNom * (pt + S[LIN_STAN.sq]) : 0;
    // faza linii pola: metal w korpusie płynie ku gardzieli z prędkością Q·ρ / przekrój korpusu
    const Ab = 3.3 * (S[LIN_STAN.memW] + 20) * (S[LIN_STAN.memH] + 10);
    S[LIN_STAN.flowPh] += S[LIN_STAN.Q] * VOL_TON / Ab * h;
  }
  if (S[LIN_STAN.attached]) S[LIN_STAN.vLine] = S[LIN_STAN.Q] * VOL_TON / P.A0;

  // ===== WYLOT G0: modulacja i pobór do plastra otwartego =====
  {
    const tauN = P.outNoiseTau;
    const amp = (P.outNoise + P.outNoiseDump * Math.min(1, S[LIN_STAN.inRate] / 36)) * X.noise;
    S[LIN_STAN.noise] += (-S[LIN_STAN.noise] / tauN) * h + (rnd(X), W[15] - 0.5) * 3.46 * Math.sqrt(2 * h / tauN);
    let ao = 1 + P.outSlosh * S[LIN_STAN.q1] + P.outBreath * S[LIN_STAN.q0] + amp * S[LIN_STAN.noise];
    if (CTL[2] > 0) { ao += CTL[1]; CTL[2] -= h; }
    ao = ao < 0.55 ? 0.55 : ao > 1.6 ? 1.6 : ao;
    S[LIN_STAN.aOut] = ao;
  }
  if (S[LIN_STAN.attached] && ring[1] > 0) {
    const want = S[LIN_STAN.Q] * S[LIN_STAN.aOut] * UNITS_T * h + S[LIN_STAN.carry];
    let du = Math.floor(want);
    S[LIN_STAN.carry] = want - du;
    if (du > S[LIN_STAN.resV]) { du = S[LIN_STAN.resV]; S[LIN_STAN.carry] = 0; }
    if (du > 0) {
      S[LIN_STAN.resV] -= du;
      X.TV[0] = du * VOL_UNIT;
      tubeOutflow(X);
      C[LIN_LICZNIK.reservoir] -= du;
      C[LIN_LICZNIK.strip] += du;
      S[LIN_STAN.m0] += du;
      let o = sl(ring, ring[1] - 1);
      const room = P.sliceUnits - SL[o + PL.m];
      if (du < room) SL[o + PL.m] += du;
      else {
        SL[o + PL.m] += room;
        const i = openSlice(X, false);
        if (i >= 0) { o = sl(ring, i); SL[o + PL.m] = du - room; SL[o + PL.m0] = S[LIN_STAN.m0] - (du - room); }
        else { o = sl(ring, ring[1] - 1); SL[o + PL.m] += du - room; }
      }
    }
    // koniec wsadu: zasobnik pusty (dobieg albo komora przestała dawać) → wylot odcina pasmo
    const cut = S[LIN_STAN.mode] === TRYB.DOBIEG ? P.cutT : 0.25;
    if (S[LIN_STAN.resV] / UNITS_T <= cut && S[LIN_STAN.mode] !== TRYB.ROZRUCH) cutStrip(X);
    else if (S[LIN_STAN.mode] === TRYB.ROZRUCH && S[LIN_STAN.resV] / UNITS_T <= 0.25) cutStrip(X);
  }

  // ===== RĘKAW: zacisk wędruje (posuw z ciśnienia brzucha, otwarcie przed zrzutem), metal płynie w rękawie =====
  pinchStep(X);
  tubeStep(X);

  // ===== PASMO: stan plastrów =====
  // (w pętlach plastrów żadna funkcja nie zwraca liczby zmiennoprzecinkowej — tablice wzdłuż drogi, granice w TOP/TOPU)
  const n = ring[1];
  const KF = K.factor;
  // (walcownia: długość taśmy na jednostkę x w pętlach między klatkami — przekrój = objętość / długość łuku)
  const KS = K.stretch || null;
  tops(X, n);
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    W[14] = SL[o + PL.x]; props(X);
    W[13] = SL[o + PL.H]; thermo(X);
    SL[o + PL.T] = W[11];
    SL[o + PL.fs] = W[12];
    const sTop = TOP[i];
    const len = SL[o + PL.s] - sTop;
    const vol = SL[o + PL.m] * VOL_UNIT;
    let ix = ((SL[o + PL.s] + sTop) * 0.5 - TX_S0) | 0;
    ix = ix < 0 ? 0 : ix >= TX_N ? TX_N - 1 : ix;
    const wN = TAB_W[ix];
    let A;
    if (SL[o + PL.tail] === 2) A = P.A0 * S[LIN_STAN.aOut];
    else A = vol / ((len > 0.05 * lNom ? len : 0.05 * lNom) * (KS ? KS[ix] : 1));
    SL[o + PL.A] = A;
    // szerokość: ciecz oddycha z grubością (fala czytelna z góry), ciało stałe — szerokość z chwili zastygnięcia
    if (W[12] < 0.999) SL[o + PL.a] = wN * 0.5 * (1 + 0.5 * (A / P.A0 - 1));
    SL[o + PL.n] = TAB_N[ix];
    SL[o + PL.F] = 0.5 * gF * (1 + (P.ironG - 1) * TAB_IRON[ix]) * A * A / wN;
    IXC[i] = ix;
  }
  // granice: przyspieszenie (różnica ciśnień, lepkość), opór pola do prędkości linii — niejawnie
  const vL = S[LIN_STAN.vLine];
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    const front = i === 0 || SL[sl(ring, i - 1) + PL.tail] === 1;
    const od = front ? -1 : sl(ring, i - 1);
    const fsB = front ? SL[o + PL.fs] : 0.5 * (SL[o + PL.fs] + SL[od + PL.fs]);
    const s = SL[o + PL.s];
    let ib = (s - TX_S0) | 0;
    ib = ib < 0 ? 0 : ib >= TX_N ? TX_N - 1 : ib;
    // prędkość ciała stałego z tablicy kinematyki: interpolacja między środkami komórek, punkt środkowy kroku (RK2) —
    // granice plastra przechodzą przez łuk styku walców tą samą drogą (stałość przepływu bez błędu fazy kroku)
    let fq = s - TX_S0 - 0.5;
    fq = fq < 0 ? 0 : fq > TX_N - 1.001 ? TX_N - 1.001 : fq;
    let iq = fq | 0;
    const f0 = KF[iq] + (KF[iq + 1] - KF[iq]) * (fq - iq);
    fq = s + 0.5 * h * vL * f0 - TX_S0 - 0.5;
    fq = fq < 0 ? 0 : fq > TX_N - 1.001 ? TX_N - 1.001 : fq;
    iq = fq | 0;
    const vRigid = vL * (KF[iq] + (KF[iq + 1] - KF[iq]) * (fq - iq));
    if (fsB >= 0.999) { SL[o + PL.u] = vRigid; continue; }
    // plaster otwarty: metal wychodzi z wylotu G0 z prędkością linii (warunek kinematyczny — przekrój plastra = A_out;
    // fale grubości rodzą się z modulacji wypływu, a nie z „wystrzału” granicy)
    if (SL[o + PL.tail] === 2) { SL[o + PL.u] = vL; continue; }
    const Vi = SL[o + PL.m] * VOL_UNIT;
    const Vd = front ? 0 : SL[od + PL.m] * VOL_UNIT;
    const Vb = 0.5 * (Vi + Vd) + 0.05 * sliceVol;
    // czoło: pole domyka koniec pasma (ciśnienie z zewnątrz `endHold` · ciśnienie nominalne) — czoło nie rozlewa się
    // w cienką błonę, tylko trzyma grubość bliską nominalnej i zaokrągla się
    const Fd = front ? P.endHold * 0.5 * gF * P.A0 * P.A0 / TAB_W[ib] : SL[od + PL.F];
    let acc = (SL[o + PL.F] - Fd) / Vb;
    // lepkość: wygładzanie prędkości granic (sąsiednie granice)
    const uUp = TOPU[i];
    const uDn = front ? SL[o + PL.u] : SL[od + PL.u];
    const lb = front ? lNom : 0.5 * (SL[od + PL.s] - TOP[i]);
    const nu = P.nu0 * (1 + P.nuS * fsB * fsB);
    acc += nu * (uUp + uDn - 2 * SL[o + PL.u]) / (lb * lb + 1);
    const f4 = fsB * fsB * fsB * fsB;
    const gam = P.gamma0 + P.gammaS * f4 + P.ironGamma * TAB_IRON[ib];
    SL[o + PL.u] = (SL[o + PL.u] + h * (acc + gam * vRigid)) / (1 + h * gam);
  }
  // wolne ogony
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    if (SL[o + PL.tail] !== 1) continue;
    let ib = (SL[o + PL.ts] - TX_S0) | 0;
    ib = ib < 0 ? 0 : ib >= TX_N ? TX_N - 1 : ib;
    let fq = SL[o + PL.ts] - TX_S0 - 0.5;
    fq = fq < 0 ? 0 : fq > TX_N - 1.001 ? TX_N - 1.001 : fq;
    let iq = fq | 0;
    const f0 = KF[iq] + (KF[iq + 1] - KF[iq]) * (fq - iq);
    fq = SL[o + PL.ts] + 0.5 * h * vL * f0 - TX_S0 - 0.5;
    fq = fq < 0 ? 0 : fq > TX_N - 1.001 ? TX_N - 1.001 : fq;
    iq = fq | 0;
    const vRigid = vL * (KF[iq] + (KF[iq + 1] - KF[iq]) * (fq - iq));
    if (SL[o + PL.fs] >= 0.999) { SL[o + PL.tu] = vRigid; continue; }
    const Vb = 0.5 * SL[o + PL.m] * VOL_UNIT + 0.05 * sliceVol;
    const acc = (P.endHold * 0.5 * gF * P.A0 * P.A0 / TAB_W[ib] - SL[o + PL.F]) / Vb;
    const fs = SL[o + PL.fs];
    const gam = P.gamma0 + P.gammaS * fs * fs * fs * fs;
    SL[o + PL.tu] = (SL[o + PL.tu] + h * (acc + gam * vRigid)) / (1 + h * gam);
  }
  // położenia + strażnik długości (od czoła w górę pasma)
  const lMin = P.minLen * lNom;
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    SL[o + PL.s] += SL[o + PL.u] * h;
    if (SL[o + PL.tail] === 1) SL[o + PL.ts] += SL[o + PL.tu] * h;
  }
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    const t = SL[o + PL.tail];
    if (t === 2) {
      // plaster otwarty: granica dolna nie cofa się za wylot
      if (SL[o + PL.s] < P.sG0) { SL[o + PL.s] = P.sG0; if (SL[o + PL.u] < 0) SL[o + PL.u] = 0; }
      continue;
    }
    const mr = SL[o + PL.m] / P.sliceUnits;
    const lm = SL[o + PL.m] > 0 ? lMin * (mr > 0.1 ? mr : 0.1) : 0;
    if (t === 1) {
      if (SL[o + PL.ts] > SL[o + PL.s] - lm) { SL[o + PL.ts] = SL[o + PL.s] - lm; if (SL[o + PL.tu] > SL[o + PL.u]) SL[o + PL.tu] = SL[o + PL.u]; }
    } else if (i + 1 < n) {
      const on = sl(ring, i + 1);
      if (SL[on + PL.s] > SL[o + PL.s] - lm) { SL[on + PL.s] = SL[o + PL.s] - lm; if (SL[on + PL.u] > SL[o + PL.u]) SL[on + PL.u] = SL[o + PL.u]; }
    }
  }
  // ciepło: promieniowanie (chłodnice C1, C2, otoczenie), noże gazowe C3; lico, zgorzelina (runda 9: stacja odzgorzania)
  const odzOn = S[LIN_STAN.odzOn] > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    W[14] = SL[o + PL.x]; props(X);
    const T = SL[o + PL.T];
    const fs = SL[o + PL.fs];
    const ix = IXC[i];
    const chi = TAB_CHI[ix] > 1.9 ? TAB_CHI[ix] * W[5] : TAB_CHI[ix];
    const hc = TAB_HC[ix] * S[LIN_STAN.c3u];
    const eps = W[3] + (W[4] - W[3]) * fs;
    const tr = T / P.Tref;
    const q = P.Kr * eps * chi * (tr * tr * tr * tr - env4) + hc * (T - P.Tgas) / P.Tref;
    const A = SL[o + PL.A];
    const a = SL[o + PL.a];
    const nE = SL[o + PL.n];
    // obwód / pole: 2 / t płaskiej taśmy, 2 / r okrągłej strugi (nadelipsa między nimi)
    let gn = (nE - 2) / 4;
    gn = gn < 0 ? 0 : gn > 1 ? 1 : gn;
    const perA = 4 * a / A * (1 + 0.5708 * (1 - gn));
    SL[o + PL.H] -= q * perA * h;
    let fk = (nE - AREA_N0) / AREA_DN;
    fk = fk < 0 ? 0 : fk > AREA_TAB.length - 1.001 ? AREA_TAB.length - 1.001 : fk;
    const ik = fk | 0;
    const Kn = AREA_TAB[ik] + (AREA_TAB[ik + 1] - AREA_TAB[ik]) * (fk - ik);
    const tt = A / (Kn * a) * 2;
    SL[o + PL.Ts] = T - W[6] * q * tt / P.skin + SL[o + PL.dTs];
    if (SL[o + PL.dTs] !== 0) SL[o + PL.dTs] *= dTsDecay;
    if (fs >= 0.999) {
      const xi0 = SL[o + PL.xi];
      // (runda 9) za kurtyną osłony (argon) tlenek nie rośnie; bez stacji (A/B) — tlen wszędzie
      if (odzOn === 0 || TAB_OX[ix] > 0) SL[o + PL.xi] = Math.sqrt(xi0 * xi0 + W[9] * Math.exp(-P.oxE / (T > 300 ? T : 300)) * h);
      // STACJA ODZGORZANIA: w strefie tlenek odrywa się z szybkością k · U; zdjęta masa metalu w tlenku (κ · Δξ · m)
      // przechodzi całymi jednostkami z plastra na konto zgorzeliny (ułamek czeka w `odzAcc`)
      const kd = odzOn * TAB_DS[ix] * S[LIN_STAN.odzU];
      if (kd > 0) {
        const xa = SL[o + PL.xi];
        const xb = xa * Math.exp(-kd * h);
        SL[o + PL.xi] = xb;
        const dm = (xa - xb) * ODZG.kappa * SL[o + PL.m];
        S[LIN_STAN.odzTot] += dm;
        S[LIN_STAN.odzAcc] += dm;
        const take = Math.floor(S[LIN_STAN.odzAcc]);
        if (take > 0 && take < SL[o + PL.m]) {
          SL[o + PL.m] -= take;
          C[LIN_LICZNIK.strip] -= take;
          C[LIN_LICZNIK.scale] += take;
          S[LIN_STAN.odzAcc] -= take;
        }
      }
    } else SL[o + PL.ct] = time;
  }
  K.step(h, X.api);
  // (runda 8) DZIELENIE: nóż, ciała arkuszy, gniazda — w tym samym podkroku, po ruchu plastrów i kinematyce walcowni
  // (rozdziela pasmo `cutAt` / `releaseAll`; bilans linii i dzielenia po każdym podkroku)
  if (X.D !== null) X.D.step(h);
  // wyjście: plaster, którego górna granica minęła koniec drogi pasma (z dzieleniem — nie zdarza się: `overrun`)
  tops(X, ring[1]);
  let gone = 0;
  while (gone < ring[1]) {
    const o = sl(ring, gone);
    if (SL[o + PL.tail] === 2) break;
    // (runda 9, styk zwijarki) koniec drogi pasma zmienny w biegu (`setStripExit`) — w programie ARKUSZE = `PASMO.sExit`
    if (TOP[gone] < X.sExit[0]) break;
    C[LIN_LICZNIK.strip] -= SL[o + PL.m];
    C[LIN_LICZNIK.exited] += SL[o + PL.m];
    S[LIN_STAN.overrun] += SL[o + PL.m];
    if (SL[o + PL.tail] === 1) S[LIN_STAN.cutFront] = 0;
    gone++;
  }
  if (gone > 0) { ring[0] = (ring[0] + gone) & MASK; ring[1] -= gone; tops(X, ring[1]); }
  // czoło, ogon, front krzepnięcia
  if (ring[1] > 0) {
    S[LIN_STAN.front] = SL[sl(ring, 0) + PL.s];
    S[LIN_STAN.tail] = TOP[ring[1] - 1];
    // front krzepnięcia: od wylotu w dół pasma — pierwszy plaster w pełni stały, za którym jest już tylko stałe
    S[LIN_STAN.frontSolid] = -1;
    for (let i = ring[1] - 1; i >= 0; i--) {
      const o = sl(ring, i);
      if (SL[o + PL.fs] >= 0.999) { S[LIN_STAN.frontSolid] = TOP[i]; break; }
    }
  } else { S[LIN_STAN.front] = -1; S[LIN_STAN.tail] = -1; S[LIN_STAN.frontSolid] = -1; }
  if (S[LIN_STAN.mode] === TRYB.OGON && ring[1] === 0) S[LIN_STAN.mode] = TRYB.PUSTA;
}

/**
 * Chłodnice C1: udział miedzi w metalu pod panelami (panele dosuwają się do miedzi) — raz na krok strony, wygładzone.
 */
/**
 * Przekrój ODNIESIENIA części ciekłej (poprawki rundy 6 — obraz fali): średnia krocząca w czasie (τ `WREF.tau`)
 * przekroju plastrów w stałych punktach drogi od G0 (co `WREF.ds` j.). Obraz wzmacnia tylko odchyłkę od niej — fale
 * przebiegające po pasmie, a nie stały profil bram i szyi. Liczona w kroku strony (niezależnie od tego, czy klatka
 * rysuje), poza haszem stanu.
 */
export const WREF = Object.freeze({ s0: PASMO.sG0, ds: 6, n: 121, tau: 2.5 });
function waveRefUpdate(X, dt) {
  const { SL, ring, TOP, WR } = X;
  const n = ring[1];
  const k = 1 - Math.exp(-dt / WREF.tau);
  let i = 0;                                    // od czoła (największe s) w dół drogi
  for (let g = WREF.n - 1; g >= 0; g--) {
    const s = WREF.s0 + g * WREF.ds;
    while (i < n && TOP[i] > s) i++;
    if (i >= n || SL[sl(ring, i) + PL.s] < s) { WR[g] = 0; continue; }
    const A = SL[sl(ring, i) + PL.A];
    WR[g] = WR[g] > 0 ? WR[g] + (A - WR[g]) * k : A;
  }
}

function chillUpdate(X) {
  const { S, SL, ring, RG } = X;
  RG[0] = 0;
  RG[1] = 0;
  const n = ring[1];
  const r0 = ring[0];
  for (let i = 0; i < n; i++) {
    const o = ((r0 + i) & MASK) * SLICE_STRIDE;
    const s = SL[o];
    if (s >= C1_S0 && s < C1_S1) { RG[0] += SL[o + 4] * SL[o + 2]; RG[1] += SL[o + 2]; }
  }
  S[LIN_STAN.chill] += ((RG[1] > 0 ? RG[0] / RG[1] : S[LIN_STAN.resX]) - S[LIN_STAN.chill]) * CHILL_K4;
}

/**
 * Pirometr na drodze `sq`: T rdzenia, udział miedzi, prędkość, A i półszerokość — interpolacja liniowa między środkami
 * plastrów (ciało stałe; plastry otwarte i wolne ogony pomija) → `C3W[0..4]`; `C3W[5]` = 1, gdy taśma jest pod
 * pirometrem. Po `tops` (granice górne aktualne).
 */
function pyrometer(X, sq) {
  const { SL, ring, TOP, C3W } = X;
  C3W[5] = 0;
  const n = ring[1];
  let pc = -1;
  let po = -1;
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    if (SL[o + PL.tail] !== 0) { pc = -1; continue; }
    const c = 0.5 * (SL[o + PL.s] + TOP[i]);
    if (c < sq) {
      if (pc < 0) { if (SL[o + PL.s] < sq) return; po = o; pc = c; }
      const f = pc > c ? (pc - sq) / (pc - c) : 0;
      C3W[0] = SL[po + PL.T] + (SL[o + PL.T] - SL[po + PL.T]) * f;
      C3W[1] = SL[po + PL.x] + (SL[o + PL.x] - SL[po + PL.x]) * f;
      C3W[2] = SL[po + PL.u] + (SL[o + PL.u] - SL[po + PL.u]) * f;
      C3W[3] = SL[po + PL.A] + (SL[o + PL.A] - SL[po + PL.A]) * f;
      C3W[4] = SL[po + PL.a] + (SL[o + PL.a] - SL[po + PL.a]) * f;
      C3W[5] = SL[o + PL.fs] >= 0.999 ? 1 : 0;
      return;
    }
    po = o; pc = c;
  }
}

/**
 * (runda 9) REGULATOR TEMPERATURY KOŃCA WALCOWANIA — noże gazowe C3 za F3, raz na krok strony. Model strefy: taśma
 * wchodzi w noże z T_we (pirometr przed nożami), w strefie długości L jedzie τ = L / v; konwekcja noży zbija nadwyżkę
 * nad gazem wykładniczo, promieniowanie odejmuje ok. ΔT_rad, więc otwarcie potrzebne do celu T*:
 *   u = Tref · ln((T_we − T_gaz) / (T* + ΔT_rad − T_gaz)) / (perA · hC3 · τ),  perA = 4a / A (płaska taśma).
 * T* = T_fin − I, a całka I błędu pirometru za nożami usuwa resztę (plamy, przybliżenie strefy). Zawór goni u z
 * inercją; poniżej celu noże stoją (u = 0 — nie grzeją), całka wtedy nie narasta w dół (bez nawijania).
 */
const C3_S0 = LINIA.chill.C3[0] + PATH.xOff;
const C3_S1 = LINIA.chill.C3[1] + PATH.xOff;
function c3Update(X, dt) {
  const { S, C3W, REG } = X;
  const kv = 1 - Math.exp(-dt / P.c3Tau);
  if (REG[6] >= 0) { S[LIN_STAN.c3u] = REG[6]; return; }
  pyrometer(X, C3_S1 + P.c3PyOut);
  const outOk = C3W[5];
  const Tout = C3W[0];
  const xo = C3W[1];
  pyrometer(X, C3_S0 - P.c3PyIn);
  if (C3W[5] === 0 || C3W[2] <= 1) {
    // brak ciała stałego pod pirometrem wejścia — noże się zamykają, całka zostaje
    S[LIN_STAN.c3Tin] = 0;
    S[LIN_STAN.c3Tout] = outOk ? Tout : 0;
    S[LIN_STAN.c3u] += (0 - S[LIN_STAN.c3u]) * kv;
    return;
  }
  const Tin = C3W[0];
  const xi = C3W[1];
  const Tset = MS.Tfin + (MC.Tfin - MS.Tfin) * (outOk ? xo : xi);
  S[LIN_STAN.c3Tin] = Tin;
  S[LIN_STAN.c3Tout] = outOk ? Tout : 0;
  S[LIN_STAN.c3Set] = Tset;
  const perA = 4 * C3W[4] / (C3W[3] > 1e-6 ? C3W[3] : 1e-6);
  const tau = (C3_S1 - C3_S0) / C3W[2];
  const eps = MS.es + (MC.es - MS.es) * xi;
  const Tt = Tset - S[LIN_STAN.c3I];
  const tm = 0.5 * (Tin + Tt) / P.Tref;
  const dRad = perA * P.Kr * eps * (tm * tm * tm * tm - env4) * tau;
  const num = Tin - P.Tgas;
  const den = Tt + dRad - P.Tgas;
  let u = den > 1 && num > den ? P.Tref * Math.log(num / den) / (perA * P.hC3 * tau) : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  // całka z pirometru wyjścia (bez nawijania przy zaworze w ograniczeniu, w stronę ograniczenia)
  if (outOk) {
    const e = Tout - Tset;
    if (!((u <= 0 && e < 0) || (u >= 1 && e > 0))) {
      let I = S[LIN_STAN.c3I] + P.c3Ki * e * dt;
      I = I < -P.c3Imax ? -P.c3Imax : I > P.c3Imax ? P.c3Imax : I;
      S[LIN_STAN.c3I] = I;
    }
  }
  S[LIN_STAN.c3u] += (u - S[LIN_STAN.c3u]) * kv;
}

/**
 * (runda 9) STACJA ODZGORZANIA — raz na krok strony: moc U goni 1, gdy pod linią styku stoi ciało stałe taśmy (inaczej
 * czuwanie), z bezwładnością `ODZG.tau`; sondy ξ przed strefą (x0 − 6) i za nią (x1 + 30); strumień zdjętej masy [t/s].
 */
const ODZ_SIN = OZ_X0 - 6 + PATH.xOff;
const ODZ_SOUT = OZ_X1 + 30 + PATH.xOff;
const ODZ_SF = ODZG.xf + PATH.xOff;
function odzUpdate(X, dt) {
  const { S, SL, ring, TOP, ODZ } = X;
  const n = ring[1];
  let under = 0;
  let xin = 0;
  let xout = 0;
  for (let i = 0; i < n; i++) {
    const o = sl(ring, i);
    if (SL[o + PL.tail] === 2 || SL[o + PL.fs] < 0.999) continue;
    const bot = SL[o + PL.s];
    const top = TOP[i];
    if (top <= ODZ_SF && bot >= ODZ_SF) under = 1;
    if (top <= ODZ_SIN && bot >= ODZ_SIN) xin = SL[o + PL.xi];
    if (top <= ODZ_SOUT && bot >= ODZ_SOUT) xout = SL[o + PL.xi];
  }
  const want = S[LIN_STAN.odzOn] > 0 ? (under ? 1 : ODZG.standby) : 0;
  S[LIN_STAN.odzU] += (want - S[LIN_STAN.odzU]) * (1 - Math.exp(-dt / ODZG.tau));
  S[LIN_STAN.odzXiIn] = xin;
  S[LIN_STAN.odzXiOut] = xout;
  const d = S[LIN_STAN.odzTot] - ODZ[0];
  ODZ[0] = S[LIN_STAN.odzTot];
  S[LIN_STAN.odzRate] += (d / UNITS_T / (dt > 0 ? dt : 1) - S[LIN_STAN.odzRate]) * (1 - Math.exp(-dt / 0.25));
}

/**
 * (runda 8) REKORD KAWAŁKA oddanego dzieleniu (`cutAt` / `releaseAll`, `Float64Array(KAW_N)`): jednostki kawałka i
 * szczeliny, długość, szerokość i grubość na tyle / przodzie (min / max po długości), temperatura w 4 węzłach wzdłuż
 * (przód → tył), ξ, udział miedzi (ważone masą), współrzędna masy wzoru na przodzie i gęstość liniowa [jedn./j.],
 * przód był brzegiem cięcia (1) albo czołem pasma (0), x przodu i tyłu, kawałek kończy pasmo (ogon), T_sol metalu.
 */
export const KAW = Object.freeze({
  units: 0, kerf: 1, len: 2, wB: 3, wF: 4, tB: 5, tF: 6, T0: 7, T1: 8, T2: 9, T3: 10, xi: 11, cu: 12, m0F: 13, dens: 14,
  cutF: 15, wMin: 16, wMax: 17, tMin: 18, tMax: 19, xF: 20, xB: 21, tail: 22, Tsol: 23, tcF: 24, dTF: 25, Tcut: 26
});
export const KAW_N = 28;

/**
 * Rozdzielenie najstarszego pasma szczeliną [xc − wk/2, xc + wk/2] (`all` — oddanie całej reszty pasma do ogona):
 * plastry całe za szczeliną przechodzą do kawałka, plaster(y) przecięte — udziałem długości (całkowicie: kawałek
 * floor, szczelina round, reszta = m − oba); czoło pasma po cięciu na xc − wk/2, proste (flaga `cutFront`). Licznik
 * `exited` rośnie o kawałek + szczelinę (bilans linii bez zmian w zasadzie). Bez alokacji.
 */
function cutPiece(X, xc, wk, out, all) {
  const { S, C, SL, ring, TOP, W } = X;
  for (let k = 0; k < KAW_N; k++) out[k] = 0;
  const n = ring[1];
  if (n === 0) return;
  tops(X, n);
  // koniec najstarszego pasma: pierwszy plaster z wolnym ogonem (1) albo otwarty przy wylocie (2)
  let iEnd = n - 1;
  for (let i = 0; i < n; i++) { if (SL[sl(ring, i) + PL.tail] !== 0) { iEnd = i; break; } }
  const o0 = sl(ring, 0);
  const xF = SL[o0 + PL.s];
  if (all && SL[sl(ring, iEnd) + PL.tail] !== 1) return;     // pasmo przyczepione do wylotu G0 — nie oddaje się
  const kl = all ? -1e9 : xc - wk / 2;
  const kr = all ? -1e9 : xc + wk / 2;
  if (!all && xF <= kr) return;                               // za szczeliną nie ma metalu
  const xB = all ? TOP[iEnd] : kr;
  const len = xF - xB;
  out[KAW.xF] = xF;
  out[KAW.xB] = xB;
  out[KAW.len] = len;
  out[KAW.cutF] = S[LIN_STAN.cutFront];
  out[KAW.tcF] = S[LIN_STAN.cutT];
  out[KAW.dTF] = S[LIN_STAN.cutDT0];
  out[KAW.m0F] = SL[o0 + PL.m0];
  out[KAW.tail] = all ? 1 : 0;
  let units = 0;
  let kerf = 0;
  let gone = 0;
  let wMin = 1e9; let wMax = 0; let tMin = 1e9; let tMax = 0; let xiS = 0; let cuS = 0;
  for (let i = 0; i <= iEnd; i++) {
    const o = sl(ring, i);
    const bot = SL[o + PL.s];
    const top = TOP[i];
    if (!all && bot <= kl) break;
    const m = SL[o + PL.m];
    const Ls = bot - top > 1e-9 ? bot - top : 1e-9;
    let mp = m;
    let mk = 0;
    if (!all && top < kr) {
      const pa = bot - (top > kr ? top : kr);
      const ka = (bot < kr ? bot : kr) - (top > kl ? top : kl);
      mp = pa > 0 ? Math.floor(m * pa / Ls) : 0;
      mk = ka > 0 ? Math.round(m * ka / Ls) : 0;
      if (mp + mk > m) mk = m - mp;
      // plaster cały za lewym brzegiem szczeliny: reszty nie ma (zaokrąglenie idzie do szczeliny) — inaczej zostałby
      // plaster o ujemnej długości
      if (top >= kl) mk = m - mp;
    }
    // przekrój i własności części w kawałku
    const wid = 2 * SL[o + PL.a];
    const thk = SL[o + PL.A] / Math.max(1e-6, wid);
    if (mp > 0) {
      if (wid < wMin) wMin = wid;
      if (wid > wMax) wMax = wid;
      if (thk < tMin) tMin = thk;
      if (thk > tMax) tMax = thk;
      xiS += SL[o + PL.xi] * mp;
      cuS += SL[o + PL.x] * mp;
      if (i === 0) { out[KAW.wF] = wid; out[KAW.tF] = thk; }
      out[KAW.wB] = wid; out[KAW.tB] = thk;
      // węzły temperatury (przód → tył) w środkach ćwiartek długości kawałka
      const lo = top > xB ? top : xB;
      for (let q = 0; q < 4; q++) {
        const xq = xF - (q + 0.5) * 0.25 * len;
        if (xq <= bot && xq >= lo) out[KAW.T0 + q] = SL[o + PL.T];
      }
    }
    units += mp;
    kerf += mk;
    const rest = m - mp - mk;
    if (!all && rest > 0) {
      // reszta plastra zostaje w pasmie: nowe czoło na lewym brzegu szczeliny, współrzędna masy wzoru ciągła
      SL[o + PL.m] = rest;
      SL[o + PL.m0] += mp + mk;
      if (SL[o + PL.s] > kl) SL[o + PL.s] = kl;
      break;
    }
    gone = i + 1;
  }
  // węzły bez plastra (kawałek krótszy niż plaster) — temperatura sąsiada
  for (let q = 1; q < 4; q++) if (out[KAW.T0 + q] === 0) out[KAW.T0 + q] = out[KAW.T0 + q - 1];
  for (let q = 2; q >= 0; q--) if (out[KAW.T0 + q] === 0) out[KAW.T0 + q] = out[KAW.T0 + q + 1];
  out[KAW.units] = units;
  out[KAW.kerf] = kerf;
  out[KAW.wMin] = wMin < 1e9 ? wMin : 0;
  out[KAW.wMax] = wMax;
  out[KAW.tMin] = tMin < 1e9 ? tMin : 0;
  out[KAW.tMax] = tMax;
  out[KAW.xi] = units > 0 ? xiS / units : 0;
  out[KAW.cu] = units > 0 ? cuS / units : 0;
  out[KAW.dens] = len > 1e-6 ? units / len : 0;
  W[14] = out[KAW.cu]; props(X);
  out[KAW.Tsol] = W[0];
  C[LIN_LICZNIK.strip] -= units + kerf;
  C[LIN_LICZNIK.exited] += units + kerf;
  if (gone > 0) { ring[0] = (ring[0] + gone) & MASK; ring[1] -= gone; }
  tops(X, ring[1]);
  if (all || gone > iEnd) {
    // całe pasmo oddane: najstarsze jest teraz kolejne pasmo — jego czoło nie jest cięte
    S[LIN_STAN.cutFront] = 0;
  } else {
    // nowe czoło: brzeg cięcia (temperatura solidusu — nadwyżka nad taśmą stygnie przewodzeniem; dzielenie liczy jej zanik)
    const oF = sl(ring, 0);
    W[14] = SL[oF + PL.x]; props(X);
    S[LIN_STAN.cutFront] = 1;
    S[LIN_STAN.cutT] = S[LIN_STAN.time];
    S[LIN_STAN.cutDT0] = Math.max(0, W[0] - SL[oF + PL.T]);
    out[KAW.Tcut] = SL[oF + PL.T];
  }
  S[LIN_STAN.front] = ring[1] > 0 ? SL[sl(ring, 0) + PL.s] : -1;
}

/** Odcięcie pasma przy wylocie (koniec wsadu): plaster otwarty dostaje wolny ogon. */
function cutStrip(X) {
const { K, S, C, SL, JT, ring, W, RG, TOP, TOPU, IXC, CTL, rs } = X;
  if (!S[LIN_STAN.attached]) return;
  S[LIN_STAN.attached] = 0;
  S[LIN_STAN.cuts]++;
  if (ring[1] > 0) {
    const o = sl(ring, ring[1] - 1);
    if (SL[o + PL.m] <= 0) {
      // pusty plaster otwarty — znika (bez masy)
      ring[1]--;
      if (ring[1] > 0) {
        const op = sl(ring, ring[1] - 1);
        SL[op + PL.tail] = 1;
        SL[op + PL.ts] = P.sG0;
        SL[op + PL.tu] = S[LIN_STAN.vLine];
      }
    } else {
      SL[o + PL.tail] = 1;
      SL[o + PL.ts] = P.sG0;
      SL[o + PL.tu] = S[LIN_STAN.vLine];
    }
  }
  S[LIN_STAN.mode] = TRYB.OGON;
}

export function createFormingLine({ seed = 11, metal = 0, prefillTons = 250, prefillRun = 18, cold = false, kin = null, noise = 1, reg = null, divider = null, descale = true } = {}) {
  const K = kin || openMill();
  const S = new Float64Array(LIN_STAN_N);
  const C = new Float64Array(LIN_LICZNIK_N);
  const SL = new Float64Array(SLICE_CAP * SLICE_STRIDE);
  const JT = new Float64Array(JET_CAP * JET_STRIDE);
  // (etap „Struga”) metal w RURZE spustowej — osobna kolejka (od wargi dyszy do wargi wylewki), ten sam rekord co pakiet
  const PT = new Float64Array(JET_CAP * JET_STRIDE);
  // pierścienie: plastry od czoła (najstarszy) `ring[0]`, liczba `ring[1]`; pakiety strugi od najstarszego `ring[2]`,
  // liczba `ring[3]`; metal w rurze od najstarszego `ring[4]`, liczba `ring[5]`
  const ring = new Int32Array(6);
  // brudnopis (wartości przekazywane bez alokacji)
  const W = new Float64Array(16);
  const RG = new Float64Array(2);
  // granice górne plastrów (s, prędkość) w kolejności od czoła i indeks tablic x środka plastra — wypełnia `tops`
  const TOP = new Float64Array(SLICE_CAP);
  const TOPU = new Float64Array(SLICE_CAP);
  const IXC = new Int32Array(SLICE_CAP);
  // sterowanie z zewnątrz (testy, demo): [0] wymuszony przepływ (× Q_nom; 0 — regulator), [1] dodatek do A_out,
  // [2] czas trwania dodatku [s]
  const CTL = new Float64Array(4);

  // --- losowość: mulberry32 (stan w tablicy typowanej) ---------------------------------------------------------
  const rs = new Uint32Array(1);
  rs[0] = (seed >>> 0) ^ 0x2545F491;

  S[LIN_STAN.vNom] = vNom;
  S[LIN_STAN.resT] = METAL_FIZ[metal ? 1 : 0].Thold;
  S[LIN_STAN.resX] = metal ? 1 : 0;
  S[LIN_STAN.aOut] = 1;
  S[LIN_STAN.dumpT] = -1;
  S[LIN_STAN.jetHead] = -1;
  S[LIN_STAN.jetTail] = -1;
  S[LIN_STAN.front] = -1;
  S[LIN_STAN.tail] = -1;
  S[LIN_STAN.frontSolid] = -1;
  S[LIN_STAN.hitS] = P.sEnd;
  S[LIN_STAN.sqForce] = -1;
  S[LIN_STAN.spoutIdle] = 99;
  // błona — RĘKAW POLA (`blona.js`): objętości komórek, prędkości na ścianach, konstrykcja (szyja × rampa zacisku),
  // ciśnienie, przepływy kroku, wagi dopływu; brudnopis przekroju; fala powierzchni (η i ∂η/∂t na `etaN` węzłach)
  const CV = new Float64Array(RK_N);
  const CU = new Float64Array(RK_N + 1);
  const CC = new Float64Array(RK_N);
  const CP = new Float64Array(RK_N);
  const FL = new Float64Array(RK_N + 1);
  const CW = new Float64Array(RK_N);
  const TV = new Float64Array(2);
  const WB = new Float64Array(8);
  S[LIN_STAN.pinX] = BLONA.xpMax;
  S[LIN_STAN.landX] = LAND_X0;
  const ETA = new Float64Array(P.etaN * 2);
  const WR = new Float64Array(WREF.n);           // przekrój odniesienia części ciekłej (obraz fali; poza haszem)

  // W: 0 Tsol, 1 Tliq, 2 L, 3 el, 4 es, 5 kMetal, 6 kSkin, 7 T0, 8 T1, 9 Kox, 10 Thold

  // --- zasobnik: kształt z masy ---------------------------------------------------------------------------------
  /** s tylnego końca zasobnika (wpada tu struga). */

  // --- plastry: dostęp -------------------------------------------------------------------------------------------



  // --- regulator -------------------------------------------------------------------------------------------------

  // --- jeden podkrok -------------------------------------------------------------------------------------------
  // (brudnopis W: 0–10 własności metalu, 11 T, 12 f_s, 13 H — wejście `thermo`, 14 udział miedzi — wejście `props`,
  // 15 liczba losowa)

  // kontekst kroku: funkcje kroku są na poziomie modułu (jedna funkcja dla wszystkich linii — kod zoptymalizowany nie
  // zależy od egzemplarza; wartości przez tablice typowane kontekstu)
  // regulator (strojenie — testy, próby): [0] wzmocnienie β, [1] masa odniesienia [t], [2] górna granica (stal), [3] dolna,
  // [4] górna granica (miedź), [5] narastanie [Q_nom/s]
  // [6] (runda 9) noże C3: stałe otwarcie 0…1 zamiast regulatora (A/B dema `?c3=1` — dawne pełne dmuchanie); −1 — regulator
  const REG = Float64Array.of(P.regBeta, P.regVrefT, P.regHi, P.regLo, P.regHiCu, P.slew, -1);
  if (reg) { const k = ['beta', 'vref', 'hi', 'lo', 'hiCu', 'slew', 'c3']; k.forEach((n, i) => { if (reg[n] !== undefined && reg[n] !== null) REG[i] = reg[n]; }); }
  // (runda 9) brudnopis pirometru noży C3: T, udział miedzi, prędkość, A, półszerokość, taśma pod pirometrem
  const C3W = new Float64Array(6);
  // (runda 9) stacja odzgorzania (`descale` = false — A/B bez stacji i osłony): [0] `odzTot` przy poprzednim kroku strony
  const ODZ = new Float64Array(2);
  S[LIN_STAN.odzOn] = descale ? 1 : 0;
  const X = { K, S, C, SL, JT, PT, ring, W, RG, TOP, TOPU, IXC, CTL, rs, noise, CV, CU, CC, CP, FL, CW, TV, WB, ETA, WR, REG, C3W, ODZ, api: null, D: null, sExit: Float64Array.of(PASMO.sExit) };

  // wejście kroku: rozkład jednostek na dwa pakiety
  const inp0 = new Float64Array(LIN_WEJ_N);
  inp0[LIN_WEJ.tempT] = 1;

  const api = {
    stan: S,
    counters: C,
    kin: K,
    /** Krok strony dt (1/60 s): 4 podkroki; wejście `inp` (`LIN_WEJ`) — przyrost spływu komory w tym kroku. */
    step(dt, inp = inp0) {
      const n = Math.max(1, Math.round(dt / h));
      const du = inp[LIN_WEJ.units] | 0;
      const a = du >> 1;
      const b = du - a;
      if (du > 0) {
        if (S[LIN_STAN.dumpT] < 0 || S[LIN_STAN.jetOn] === 0) S[LIN_STAN.dumpT] = 0;
        S[LIN_STAN.jetOn] = 1;
      } else { S[LIN_STAN.jetOn] = 0; S[LIN_STAN.jetQs] = 0; }
      if (S[LIN_STAN.dumpT] >= 0) S[LIN_STAN.dumpT] += dt;
      // ZAWÓR WYLEWKI: otwarty, gdy komora otwiera spływ albo w rurze jest metal; zamyka się `spoutHold` s po wyjściu
      // ostatniego metalu z wylewki (ruch klap `spoutTime`)
      if (C[LIN_LICZNIK.pipe] > 0 || du > 0) S[LIN_STAN.spoutIdle] = 0; else S[LIN_STAN.spoutIdle] += dt;
      S[LIN_STAN.spoutWant] = inp[LIN_WEJ.valve] > 0.5 || S[LIN_STAN.spoutIdle] < P.spoutHold ? 1 : 0;
      {
        const dv = dt / P.spoutTime;
        S[LIN_STAN.spout] = S[LIN_STAN.spoutWant] ? Math.min(1, S[LIN_STAN.spout] + dv) : Math.max(0, S[LIN_STAN.spout] - dv);
      }
      // (dwa pakiety na krok strony; krok jednego podkroku — testy bilansu po podkroku — oddaje wszystko w nim)
      const kb = n >> 1;
      for (let k = 0; k < n; k++) substep(X, k === 0 ? (kb === 0 ? du : a) : k === kb ? b : 0, inp);
      // wejście strugi w błonę (kształt po kroku — pakiety następnego kroku oddają masę na tej powierzchni)
      hitScan(X);
      S[LIN_STAN.twist] = inp[LIN_WEJ.twist];
      chillUpdate(X);
      tops(X, ring[1]);
      c3Update(X, dt);
      odzUpdate(X, dt);
      waveRefUpdate(X, dt);
    },
    /** Wymuszony przepływ linii (× Q_nom, bez narastania); 0 / null — regulator. Testy i strojenie. */
    setQ(k) { CTL[0] = k > 0 ? k : 0; if (k > 0 && S[LIN_STAN.mode] === TRYB.PRACA) S[LIN_STAN.Qcmd] = P.qNom * k; },
    /** Wymuszony ścisk prasy σ (0…1; wypływ wynika z ciśnienia); < 0 / null — regulator. Testy. */
    setSqueeze(sq) { S[LIN_STAN.sqForce] = sq >= 0 ? Math.min(1, sq) : -1; },
    /** Ciśnienie i wypływ przy danym ścisku dla bieżącej masy błony: { pT, p, Q [t/s] } (bez kroku). */
    outflowAt(sq) {
      const pt = P.pT * Math.pow(S[LIN_STAN.resV] / UNITS_T / BLONA.Vpk + 1e-12, 2 / 3);
      const s = Math.max(0, Math.min(1, sq));
      return { pT: pt, p: pt + s, Q: P.qNom * (pt + s) };
    },
    /** Impuls wypływu: A_out += dA przez `dur` s (fala grubości — test). */
    kick(dA, dur) { CTL[1] = dA; CTL[2] = dur; },
    /**
     * (runda 8) DZIELENIE: rozdzielenie najstarszego pasma szczeliną szerokości `wk` na x (`KAW` w `out`); `releaseAll` —
     * oddanie całej reszty najstarszego pasma (ogon minął nóż); `attachDivider` — krok dzielenia w podkroku linii.
     */
    cutAt(x, wk, out) { cutPiece(X, x, wk, out, false); return out; },
    releaseAll(out) { cutPiece(X, 0, 0, out, true); return out; },
    /**
     * (runda 9, STYK ZWIJARKI) Koniec drogi pasma [s] zmieniany w biegu: program ARKUSZE — `PASMO.sExit` (domyślnie),
     * program KRĘGI (etap 2) — s stycznej zwijarki. Zmiana działa tylko na plastry, których górna granica minęła nowy
     * koniec (wyjście z linii licznikiem `exited`) — plastrów przed nożem nie rusza.
     */
    setStripExit(s) { X.sExit[0] = s; },
    get stripExit() { return X.sExit[0]; },
    attachDivider(D) { X.D = D || null; },
    /** Koniec wsadu na żądanie: linia przyspiesza, opróżnia zasobnik do 3 t, odcina pasmo. */
    drain() {
      if (S[LIN_STAN.mode] === TRYB.PRACA || S[LIN_STAN.mode] === TRYB.ROZRUCH) S[LIN_STAN.mode] = TRYB.DOBIEG;
    },
    /**
     * Bilans: (prefill + inflow) − (pipe + jet + reservoir + strip + exited + scale) — ma być 0; do tego zgodność liczników z
     * tablicami (rura = kolejka metalu w rurze, struga = pakiety za wargą wylewki).
     */
    audit() {
      let jet = 0;
      let pipe = 0;
      for (let k = 0; k < ring[3]; k++) jet += JT[((ring[2] + k) & JMASK) * JET_STRIDE + PJ.m];
      for (let k = 0; k < ring[5]; k++) pipe += PT[((ring[4] + k) & JMASK) * JET_STRIDE + PJ.m];
      let strip = 0;
      for (let i = 0; i < ring[1]; i++) strip += SL[sl(ring, i) + PL.m];
      const balance = C[LIN_LICZNIK.prefill] + C[LIN_LICZNIK.inflow] - C[LIN_LICZNIK.pipe] - C[LIN_LICZNIK.jet] - C[LIN_LICZNIK.reservoir] - C[LIN_LICZNIK.strip] - C[LIN_LICZNIK.exited] - C[LIN_LICZNIK.scale];
      const mismatch = Math.abs(jet - C[LIN_LICZNIK.jet]) + Math.abs(pipe - C[LIN_LICZNIK.pipe]) + Math.abs(strip - C[LIN_LICZNIK.strip]) + Math.abs(S[LIN_STAN.resV] - C[LIN_LICZNIK.reservoir]);
      return { balance, mismatch };
    },
    /** Hasz stanu (powtarzalność z ziarna). */
    hash() {
      let hh = 0x811C9DC5 | 0;
      const mix = (v) => { hh = Math.imul(hh ^ (Math.round(v * 1e5) | 0), 0x01000193); hh = Math.imul(hh ^ (hh >>> 13), 0x5BD1E995); };
      for (let k = 0; k < LIN_STAN_N; k++) mix(S[k]);
      for (let k = 0; k < LIN_LICZNIK_N; k++) mix(C[k]);
      for (let i = 0; i < ring[1]; i++) { const o = sl(ring, i); mix(SL[o + PL.s]); mix(SL[o + PL.m]); mix(SL[o + PL.H]); mix(SL[o + PL.u]); }
      for (let k = 0; k < ring[3]; k++) { const j = ((ring[2] + k) & JMASK) * JET_STRIDE; mix(JT[j + PJ.s]); mix(JT[j + PJ.m]); }
      for (let k = 0; k < ring[5]; k++) { const j = ((ring[4] + k) & JMASK) * JET_STRIDE; mix(PT[j + PJ.m]); mix(PT[j + PJ.m0]); }
      return (hh >>> 0).toString(16);
    },
    /** Tony w częściach linii. */
    tons() {
      const t = (u) => u / UNITS_T;
      return { rura: t(C[LIN_LICZNIK.pipe]), struga: t(C[LIN_LICZNIK.jet]), blona: t(C[LIN_LICZNIK.reservoir]), zasobnik: t(C[LIN_LICZNIK.reservoir]), pasmo: t(C[LIN_LICZNIK.strip]), wyszlo: t(C[LIN_LICZNIK.exited]), prefill: t(C[LIN_LICZNIK.prefill]), doplyw: t(C[LIN_LICZNIK.inflow]), zgorzelina: t(C[LIN_LICZNIK.scale]) };
    },
    /** Plaster o indeksie i (od czoła): przesunięcie rekordu w `view.slices`. */
    sliceOffset(i) { return sl(ring, i); },
    /** s granicy górnej plastra i. */
    sliceTop(i) { return upS(X, i); },
    sliceTopU(i) { return upU(X, i); },
    /** Przesunięcie rekordu pakietu k (od najstarszego) w `view.jet`. */
    jetOffset(k) { return ((ring[2] + k) & JMASK) * JET_STRIDE; },
    /** Przesunięcie rekordu metalu k w rurze (od najstarszego, przy wardze) w `view.pipe`. */
    pipeOffset(k) { return ((ring[4] + k) & JMASK) * JET_STRIDE; },
    /** Własności metalu przy udziale miedzi x → tablica [Tsol, Tliq, L, el, es, kMetal, kSkin, T0, T1, Kox, Thold]. */
    props(x, out) { W[14] = x; props(X); for (let k = 0; k < 11; k++) out[k] = W[k]; return out; },
    view: { stan: S, counters: C, slices: SL, jet: JT, pipe: PT, ring, top: TOP, topu: TOPU, tube: CV, tubeC: CC, eta: ETA, wref: WR }
  };

  X.api = api;
  // (runda 8) DZIELENIE od początku — także w rozbiegu strony (pasmo z rozbiegu przechodzi przez nóż: czoło, arkusze)
  if (divider) { divider.bind(api); X.D = divider; }
  resShape(X);
  hitScan(X);

  // --- start strony: zasobnik pełny, pasmo wypełnione do tunelu (`prefillRun` s z otwartym wylotem) --------------
  if (!cold && prefillTons > 0) {
    const u = Math.round(prefillTons * UNITS_T);
    S[LIN_STAN.resV] = u;
    C[LIN_LICZNIK.prefill] = u;
    C[LIN_LICZNIK.reservoir] = u;
    W[14] = S[LIN_STAN.resX]; props(X);
    S[LIN_STAN.resT] = W[10];
    S[LIN_STAN.mode] = TRYB.PRACA;
    S[LIN_STAN.attached] = 1;
    regTarget(X);
    S[LIN_STAN.Qcmd] = RG[0];
    {
      const pt = P.pT * Math.pow(u / UNITS_T / BLONA.Vpk, 2 / 3);
      S[LIN_STAN.sq] = Math.max(0, Math.min(1, RG[0] / P.qNom - pt));
      S[LIN_STAN.Q] = P.qNom * (pt + S[LIN_STAN.sq]);
    }
    // rękaw w równowadze: zacisk tam, gdzie brzuch pod ciśnieniem wypływu mieści masę
    tubeEquilibrium(X, S[LIN_STAN.Q] / P.qNom);
    resShape(X);
    hitScan(X);
    S[LIN_STAN.vLine] = S[LIN_STAN.Q] * VOL_TON / P.A0;
    S[LIN_STAN.starts] = 1;
    openSlice(X, true);
    const steps = Math.round(prefillRun / (1 / 60));
    for (let k = 0; k < steps; k++) api.step(1 / 60, inp0);
    S[LIN_STAN.dumpT] = -1;
  }
  return api;
}
