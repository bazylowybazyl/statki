// HUTA — formowanie, etapy „Pasmo w polu” i „Kropla”: STACJE RYSUNKU METALU LINII (czysty JS, bez three; bez alokacji).
//
// Metal linii to JEDNA rura przekrojów (`STACJE.n` stacji × `STACJE.ring` punktów obwodu) w trzech odcinkach:
//   STRUGA   stacje o stałym s drogi `DROGA` od wargi wylewki do środka błony (przekrój z ciągłości: wypływ przez wargę /
//            prędkość; za wargą przewężenie między klapami i pierścieniami pola; pole ciągnie strugę w dół — przyspiesza
//            i cienieje wzdłuż łuku; kończy się na WIDOCZNEJ powierzchni metalu w błonie ze STOPĄ ZLANIA — `FOOT`);
//   BŁONA    stacje o stałym x wzdłuż RĘKAWA POLA (od tylnego kołnierza `BLONA.x0` do gardzieli G0, równo): przekrój metalu
//            z komórek rękawa (`blona.js`, symulacja `linia.js`) + mody drgań (oddech, przelewanie, ugięcie), fala η i
//            wgniecenie pod strugą na brzuchu (od zacisku do G0); za zaciskiem metalu nie ma — tylko zapadnięta błona;
//   PASMO    stacje o stałym s = x od G0 do tunelu (gęściej w części ciekłej i przy klatkach F1–F3).
// Między strugą a błoną stacje zapadają się w punkt (odcinek bez pola powierzchni). CPU co klatkę wypisuje stan w
// stacjach (bufor storage `STACJE.n × 28` float), wierzchołki liczy shader (`pasmoTSL.js`). Rekord stacji (7 × vec4):
//   v0  środek x, y, z (układ komory), s drogi (struga, pasmo) / u (błona)
//   v1  a — półszerokość (oś z), b — półwysokość (w płaszczyźnie przekroju), n — wykładnik nadelipsy, rodzaj (1 struga,
//       2 błona, 3 pasmo; ułamki na złączach; 0 — pusto)
//   v2  T̃ rdzenia, T̃ lica, f lica (udział fazy stałej na powierzchni 0…1), ξ zgorzeliny
//   v3  współrzędna wzoru wzdłuż [j.], udział miedzi, czas komórek [s] (stoi po zastygnięciu), skręt strugi [rad] /
//       uniesienie pętli (walcowanie)
//   v4  styczna osi (x, y — oś leży w płaszczyźnie x-y), POLE: jasność powłoki pola (z nacisku metalu: napięcie, ścisk,
//       uderzenie strugi, fala, mody), wychylenie fali η (ze znakiem)
//   v5  POWŁOKA POLA (etap „Wyciskanie”): półszerokość, półwysokość (na metalu — metal + warstwa pola; za zaciskiem —
//       płaski zapadnięty rękaw bez metalu), rodzaj powłoki (0 brak, 1 struga, 2 błona, 3 zapadnięty rękaw, 4 BRAMY
//       POLA G0–G4 — runda 7), siła zacisku / NACISK BRAMY w tym miejscu (pas siły na płaszczyźnie bramy)
//   v6  (runda 7, pasmo) JEZIORKO: półszerokość ciekłego rdzenia widzianego z góry (0…1 szerokości), udział cieczy
//       w rdzeniu 1 − f_s, T̃ powierzchni jeziorka (rdzeń), szerokość pasa przejścia [ułamek] — reszta stacji: 0
// Ułamek kroku α: stan z ostatniego kroku przesunięty o u·α·dt (granice plastrów, pakiety) — ruch płynny przy 240 Hz.
//
// RUNDA 7 („Formowanie — dopracowanie”, obraz z liczonego stanu, symulacja linii bez zmian):
//   JEZIORKO — ciekły rdzeń pasma widziany z góry. Rdzeń plastra ma udział fazy stałej f_s (entalpia, `linia.js`);
//       przekrój jeziorka przyjmujemy eliptyczny o obu półosiach ∝ √(1 − f_s) (pole = udział cieczy), więc z góry ciecz
//       zajmuje |z| < w_p · a, w_p = √(1 − f_s) − 0,18 · f_lica (brzegi łapią skórę pierwsze — lico krzepnie z
//       temperatury lica). Klin cieczy zwęża się od brzegów ku środkowi i kończy na froncie; przy większym przepływie
//       f_s rośnie wolniej wzdłuż drogi — klin jest dłuższy i szerszy (front 1921 / 2033 / 2229 przy 0,7 / 1 / 1,4 Q).
//   NACISK BRAM — bramy G1–G4 spłaszczają strugę w taśmę: siła pola na bramie k z liczonego stanu,
//       P_k = S_k · (A / A_odn)² · (0,55 + 0,45 · (v / v_nom)²) · (0,25 + 0,75 · √(1 − f_s)), gdzie S_k — względne
//       poszerzenie przekroju na bramie (√ z (w_k − w_{k−1}) / w_{k−1}, unormowane do G1), (A / A_odn)² — ciśnienie pola
//       Φ ∝ A² (fala grubości przechodząca przez bramę ściska mocniej), v² — strumień pędu, który pole zawraca w bok,
//       ostatni czynnik — ciało stałe pole tylko prowadzi. Powłoka pola wokół pasma w strefie bram: przewężona na
//       płaszczyźnie bramy (pole dociska metal), z „mostami” sięgającymi do lic emiterów i pasem siły (jasność z P_k).
//   CHŁODNICE — strumień ciepła odebrany przez panele (`chillFlux`): ta sama część promieniowania co w modelu ciepła
//       linii (χ − 1 chłodnicy, ε z f_s, (T/T_ref)⁴ − (T_env/T_ref)⁴, obwód plastra), w 12 przedziałach x od C1 do
//       końca C2; obraz paneli (żar lica) bierze z niego temperaturę z bezwładnością (`obrazLinii.js`).
import { BLONA, DROGA, HALA, LINIA, PATH } from './geometria.js';
import { areaAtW, sectionAt, sectionAtW } from './blona.js';
import { LIN_STAN, METAL_FIZ, PASMO, PJ, PL, TX_N, TX_S0, VOL_TON, VOL_UNIT, WREF, areaK } from './linia.js';
import { WALC, thickAt } from './walcownia.js';
// (runda 9, „Czysta stal”) front czyszczenia stacji odzgorzania w obrazie: ξ w strefie z profilu stacji w punkcie
import { OZ_X0, OZ_X1, descaleProfile } from './odzgorzanie.js';

/** Wzmocnienie fali grubości w obrazie części ciekłej (poprawki rundy 6). */
export const WAVE_GAIN = 6;
/**
 * Droga przed chwytem walców, na której pęka i odpada zgorzelina w obrazie [j.] (runda 7: 36 → 70 — zgorzelina pęka już
 * na wejściu w klin walców, przed łukiem styku; pas świeżego metalu przed walcem widać z góry spod krawędzi walca).
 */
export const CRACK_LEN = 70;
/**
 * (runda 7) STREFA WALCOWNI w rekordzie stacji (x od `MILL_X0`): v4.z — zgorzelina WWALCOWANA (ξ resztki z ostatniej
 * klatki: `xiKeep` · ξ przed nią — wyspy starej łuski wciśnięte w lico, wydłużają się z taśmą), v4.w — wydłużenie
 * względne taśmy λ = t0 / t (nominalnie: 1 → 1,5 → 2,31 → 3,33; wzór nowej łuski w układzie fizycznym), v6.y — czas od
 * wyjścia z ostatniej klatki [s] (−1 — przed F1). Poza strefą te pola niosą stan formowania (bramy, jeziorko).
 */
export const MILL_X0 = WALC.stands[0].e - CRACK_LEN - 60;
/** Wydłużenie względne λ = t0 / t (nominalnie) co 1 j. drogi od `TX_S0` — tablica (fill bez wywołań zwracających liczby). */
const LAMBDA = new Float64Array(TX_N);
for (let i = 0; i < TX_N; i++) LAMBDA[i] = WALC.T[0] / thickAt(TX_S0 + i + 0.5);

/**
 * (etap „Struga”) STOPA ZLANIA strugi z metalem w błonie: na drodze `len` · r nad powierzchnią struga rozszerza się
 * w poprzek do (1 + `wide`) · r i w płaszczyźnie łuku do (1 + `deep`) · r (profil ∝ g³ — menisk przyklejony do lustra),
 * a pod powierzchnią zwęża się w płaszczyźnie łuku do `tip` · b i kończy tam, gdzie cały przekrój jest już pod lustrem.
 */
export const FOOT = Object.freeze({ len: 2.6, wide: 0.6, deep: 0.25, tip: 0.45 });
/** (runda 8) żar brzegu cięcia nożem dzielenia (stal; miedź: τ / k_metal, α · k_metal) — jak `DZIEL.edge`. */
export const EDGE_CUT = Object.freeze({ tau: 3 * 3 / (4 * 8), alpha: 8, w0: 3 });
export const STACJE_STRIDE = 28;
export const STACJE_RING = 40;
/** Liczba stacji błony (u od tyłu do gardzieli). */
export const STACJE_BLONA = 150;

/** Rozkład stacji: [{ kind, n, s0 }] i tablice (s / u). */
function layout() {
  const jet = [];
  for (let s = PASMO.sLip - 6; s <= PASMO.sEnd + 1e-6; s += 3) jet.push(s);
  jet.push(PASMO.sEnd + 2);
  // (rękaw o stałym miejscu: stacje równo od tylnego kołnierza do G0; pierwsza 6 j. za kołnierzem — zamknięty koniec)
  const bag = [];
  for (let k = 0; k < STACJE_BLONA; k++) bag.push(k / (STACJE_BLONA - 1));
  const strip = [];
  const push = (s0, s1, step) => {
    const n = Math.max(1, Math.round((s1 - s0) / step));
    for (let k = 0; k < n; k++) strip.push(s0 + (s1 - s0) * k / n);
  };
  const sG0 = PASMO.sG0;
  const sLiq = sG0 + 420;
  push(sG0, sLiq, 4);
  let s = sLiq;
  for (const st of LINIA.stands) {
    const sc = st.x + PATH.xOff;
    push(s, sc - 40, 7);
    push(sc - 40, sc + 40, 2);
    s = sc + 40;
  }
  // (runda 9) STACJA ODZGORZANIA: gęsto (co 2 j.) wokół strefy czyszczenia — front brudne → czyste ostry z kamery gry
  const oz0 = OZ_X0 - 20 + PATH.xOff;
  const oz1 = OZ_X1 + 24 + PATH.xOff;
  push(s, oz0, 7);
  push(oz0, oz1, 2);
  s = oz1;
  push(s, PASMO.sExit + 14, 7);
  strip.push(PASMO.sExit + 14);
  return { jet: Float64Array.from(jet), bag: Float64Array.from(bag), strip: Float64Array.from(strip) };
}
const LAY = layout();
const NJ = LAY.jet.length;
const NB = LAY.bag.length;
const NP = LAY.strip.length;
/** Stacja pasma najbliższa każdej bramie G0–G4 (indeks w odcinku pasma). */
const GQ = Int32Array.from(LINIA.gates, (g) => {
  let best = 0;
  for (let q = 1; q < LAY.strip.length; q++) if (Math.abs(LAY.strip[q] - PATH.xOff - g.x) < Math.abs(LAY.strip[best] - PATH.xOff - g.x)) best = q;
  return best;
});
const J0 = 0;
const B0 = NJ;
const P0 = NJ + NB;
const N_ALL = NJ + NB + NP;

/** Stacje (struga, błona, pasmo) i ich parametry drogi (s strugi, u błony, s pasma). */
export const STACJE = Object.freeze({
  n: N_ALL, ring: STACJE_RING, stride: STACJE_STRIDE,
  jet: Object.freeze({ i0: J0, n: NJ }), bag: Object.freeze({ i0: B0, n: NB }), strip: Object.freeze({ i0: P0, n: NP }),
  s: Float64Array.from([...LAY.jet, ...LAY.bag, ...LAY.strip])
});
/** (zgodność wsteczna) s stacji pasma. */
export function stationS() { return STACJE.s; }

const WRAP = 1048576;            // współrzędna wzoru modulo 2^20 j. (precyzja float32 na GPU)
const MS = METAL_FIZ[0];
const MC = METAL_FIZ[1];
/** K(n) nadelipsy co 0,05 od n = 2 (tablica — bez wywołań w pętli). */
const AK = Float64Array.from({ length: 141 }, (_, i) => areaK(2 + i * 0.05));
// punkty drogi strugi (stałe)
const JX = Float64Array.from(LAY.jet, (s) => { const c = Math.min(Math.max(s, 0), DROGA.n - 1.001); const i = c | 0; const f = c - i; return DROGA.x[i] + (DROGA.x[i + 1] - DROGA.x[i]) * f; });
const JY = Float64Array.from(LAY.jet, (s) => { const c = Math.min(Math.max(s, 0), DROGA.n - 1.001); const i = c | 0; const f = c - i; return DROGA.y[i] + (DROGA.y[i + 1] - DROGA.y[i]) * f; });
const JTX = Float64Array.from(LAY.jet, (s) => DROGA.tx[Math.min(DROGA.n - 1, Math.max(0, Math.round(s)))]);
const JTY = Float64Array.from(LAY.jet, (s) => DROGA.ty[Math.min(DROGA.n - 1, Math.max(0, Math.round(s)))]);
const PY = HALA.passY;
/** x stacji błony (u = 0 — 6 j. za tylnym kołnierzem rękawa, u = 1 — G0). */
const BAGX = Float64Array.from(LAY.bag, (u) => BLONA.x0 - 6 + u * (BLONA.xG0 - BLONA.x0 + 6));
/** Półszerokość zapadniętego rękawa [j.] (`collW` × półszerokość przekroju A_ref). */
const COLL_W = (() => { const o = new Float64Array(5); sectionAt(BLONA.x0 + 40, BLONA.Aref, o); return BLONA.collW * o[0]; })();
/** K(n) przekroju brzucha (n 2,5) — wysokość spłaszczonego przekroju w rampie zacisku z pola przekroju. */
const KB = areaK(2.5);
function sstep(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

/**
 * BRAMY POLA (runda 7): x bram G0–G4, lico emitera (|z| pary emiterów G1–G4 — jak `polePasma.js`; G0 — pierścień r 115)
 * i udział bramy w spłaszczaniu S_k (√ względnego poszerzenia przekroju na bramie, unormowany do G1; G0 — 1).
 */
export const BRAMY = Object.freeze((() => {
  const g = LINIA.gates;
  const x = g.map((q) => q.x);
  const zE = g.map((q, k) => (k === 0 ? 115 : Math.max(q.a + 48, 118)) - 6);
  const wid = g.map((q) => 2 * q.a);
  const w1 = (wid[1] - wid[0]) / wid[0];
  // (G0 — gardziel formująca: pierścień tylko prowadzi strugę z szyi błony do G1, spłaszczania prawie nie robi — 0,7)
  const S = wid.map((w, k) => (k === 0 ? 0.7 : Math.sqrt(((w - wid[k - 1]) / wid[k - 1]) / w1)));
  return { n: g.length, x: Float64Array.from(x), zE: Float64Array.from(zE), S: Float64Array.from(S), x0: x[0], x1: x[x.length - 1] };
})());
/** Strefa powłoki pola bram: od G0 do G4 + `BRAMY_OUT` (powłoka wygasa za G4). */
const BRAMY_OUT = 60;
/** Warstwa pola nad metalem w strefie bram [j.]: luźna między bramami, dociśnięta na płaszczyźnie bramy. */
const GATE_LAYER = 11;
const GATE_TIGHT = 3;
/** (poprawki rundy 7) Ugięcie lica pod bramą przy nacisku 1: wgniecenie grubości, spiętrzenie przed bramą, przewężenie w planie. */
export const GATE_DENT = 0.22;
export const GATE_BULGE = 0.07;
export const GATE_WAIST = 0.025;

/** CHŁODNICE (runda 7): przedziały strumienia ciepła wzdłuż x — od początku C1 do końca C2. */
export const CHLODNICE = Object.freeze({
  n: 12, x0: LINIA.chill.C1[0], x1: LINIA.chill.C2[1],
  /** pierwszy kanał pola (`OU.pole`) z ciepłem paneli — przedział i → kanał `kanal + i` */
  kanal: 20,
  /** strumień odniesienia (stal, ciecz przy 1800 K, ε 0,35, χ − 1 = 1,2, półszerokość 80 j.) — P = 1 */
  qRef: PASMO.Kr * 0.35 * 1.2 * ((1800 / PASMO.Tref) ** 4 - (PASMO.Tenv / PASMO.Tref) ** 4) * 4 * 80 * (1 + 0.5708 * 0.5)
});

/**
 * Wypełnia rekordy stacji z linii (`createFormingLine`) i kinematyki (`mill`); `alpha` — ułamek kroku strony, `dt` —
 * krok strony; `out` — Float32Array(STACJE.n × 20). Zwraca liczbę stacji z metalem.
 */
export function createStationFiller() {
  const n = STACJE.n;
  // bufory pośrednie (rdzeń linii co klatkę, bez alokacji)
  const jetS = new Float64Array(1024);
  const jetL = new Float64Array(1024);          // λ — objętość na jednostkę długości [j²]
  const jetT = new Float64Array(1024);
  const jetX = new Float64Array(1024);
  const jetP = new Float64Array(1024);
  const jetM = new Float64Array(1024);
  const jetW = new Float64Array(1024);
  const jetV = new Float64Array(1024);
  const slC = new Float64Array(1024);           // środek plastra
  const slTop = new Float64Array(1024);
  const slBot = new Float64Array(1024);
  const slQ = new Float64Array(1024);           // przepływ plastra (ciało stałe: V / ∫dx/v) albo przekrój (ciecz)
  const CI = new Float64Array(TX_N + 1);        // ∫ dx / v (względna prędkość ciała stałego z kinematyki) od TX_S0
  const WB = new Float64Array(8);
  // (runda 7) stan stacji pasma do nacisku bram: odchyłka przekroju od odniesienia (fala) i f_s rdzenia
  const stDv = new Float64Array(NP);
  const stFs = new Float64Array(NP);
  /** NACISK BRAM G0–G4 z ostatniej klatki (P_k — opis na górze pliku); 0 — brama bez metalu. */
  const press = new Float64Array(BRAMY.n);
  const GW = new Float64Array(2);                // wejście `gatePass`: v / v_nom, modulacja wypływu G0
  // (runda 7) ξ zgorzeliny tuż przed strefą pękania każdej klatki (z tej klatki obrazu) — resztka wwalcowana za klatką
  const xiPre = new Float64Array(3);
  // (etap „Struga”) widoczna powierzchnia metalu w osi rękawu (wierzch, spód) przy stacjach błony; promień bazowy strugi
  const bTop = new Float64Array(NB);
  const bBot = new Float64Array(NB);
  const jR = new Float64Array(NJ);
  /**
   * Wejście strugi w obrazie: [0] s, [1] promień strugi na wejściu, [2] x, [3] y, [4] głębokość metalu pod wejściem,
   * [5] |styczna x|, [6] |styczna y| osi strugi na wejściu.
   */
  const entry = new Float64Array(8);
  let live = 0;

  function fill(line, mill, alpha, dt, out) {
    const LIFT = mill && mill.lift ? mill.lift : null;
    // walcownia: przekrój ciała stałego z przepływu — plaster niesie przepływ q = V / ∫dx/v, a przekrój w punkcie to
    // q / (v(s) · wydłużenie łuku): w łuku styku taśma idzie po okręgu walca, w pętli ma grubość z wyjścia klatki
    const KF = mill && mill.factor && mill.id !== 'otwarte' ? mill.factor : null;
    const KS = KF && mill.stretch ? mill.stretch : null;
    if (KF) { CI[0] = 0; for (let i = 0; i < TX_N; i++) CI[i + 1] = CI[i] + 1 / KF[i]; }
    const L = line.stan;
    const SL = line.view.slices;
    const JT = line.view.jet;
    const ring = line.view.ring;
    const TOPv = line.view.top;
    const TOPUv = line.view.topu;
    const ETA = line.view.eta;
    const time = L[LIN_STAN.time] + alpha * dt;
    const cutF = L[LIN_STAN.cutFront] > 0;
    const adv = alpha * dt;
    const xr = L[LIN_STAN.resX];
    const resTt = (L[LIN_STAN.resT] - (MS.T0 + (MC.T0 - MS.T0) * xr)) / ((MS.T1 + (MC.T1 - MS.T1) * xr) - (MS.T0 + (MC.T0 - MS.T0) * xr));
    live = 0;
    // ===================== BŁONA (rękaw pola) =====================
    // Metal z komórek rękawa (`line.view.tube`; przekrój → nadelipsa `sectionAt`), mody / fala / wgniecenie na brzuchu
    // (od zacisku do G0). Powłoka pola (v5) jest osobno: na brzuchu metal + warstwa pola, za zaciskiem ZAPADNIĘTY RĘKAW —
    // płaska, pusta błona (półszerokość `collW` · W przy A_ref, grubość `collH`), na zacisku przewężenie (`waist`) i jasny
    // pas siły zacisku (v5.w).
    const CV = line.view.tube;
    const V = L[LIN_STAN.resV];
    const q0 = L[LIN_STAN.q0];
    const q1 = L[LIN_STAN.q1];
    const q2 = L[LIN_STAN.q2];
    const sig = L[LIN_STAN.sq];
    const pT = L[LIN_STAN.pT];
    const xpr = L[LIN_STAN.pinX] + L[LIN_STAN.pinV] * adv;
    const pinF = L[LIN_STAN.pinF];
    const Lbody = Math.max(60, BLONA.xG0 - xpr);
    const Hbody = L[LIN_STAN.memH];
    const hitX = L[LIN_STAN.hitX];
    const dent = L[LIN_STAN.dent];
    const inR = Math.min(1, L[LIN_STAN.inRate] / 30);
    const modeAct = Math.min(1, 3 * (Math.abs(q0) + Math.abs(q1) + Math.abs(q2)));
    const Qn = L[LIN_STAN.Q] / PASMO.qNom;
    const NE = PASMO.etaN;
    const wp = BLONA.wp;
    // wzór metalu błony płynie z metalem ku gardzieli (faza linii pola — droga metalu w brzuchu)
    const flowPh = L[LIN_STAN.flowPh] % WRAP;
    for (let k = 0; k < NB; k++) {
      const x = BAGX[k];
      const u = LAY.bag[k];
      const r = (B0 + k) * STACJE_STRIDE;
      WB[5] = x;
      if (V > 0) areaAtW(CV, WB); else WB[6] = 0;
      const area = WB[6];
      sectionAtW(WB);
      let a = WB[0];
      let b = WB[1];
      // ZACISK ŚCISKA PRZEKRÓJ: w rampie zacisku przekrój spłaszcza się (aspekt 0,55 → 1 brzucha) — szerokość maleje
      // wolniej niż wysokość; brzuch zaokrągla się ku przewężce (z góry — przewężenie, z boku — klin), nie kończy ścianą
      const tr = sstep((x - xpr) / wp);
      if (area > 0 && tr < 1 && WB[4] > 0.99) {
        const asp = BLONA.aspect * (0.55 + 0.45 * tr);
        a = Math.sqrt(area / (KB * asp));
        b = a * asp;
      }
      const env = WB[4];
      let cy = BLONA.yc + WB[3];
      // brzuch: położenie od zacisku (0) do gardzieli (1) — mody, fala, wgniecenie
      const ub = (x - xpr) / Lbody;
      let eta = 0;
      let gh = 0;
      if (a > 0.05 && ub > 0) {
        const w = 2 * (ub < 1 ? ub : 1) - 1;
        const p3 = 0.5 * (5 * w * w * w - 3 * w);
        a *= 1 - 0.6 * q0 * env + 0.9 * q1 * p3 * env;
        b *= 1 + 0.6 * q0 * env + 0.9 * q1 * p3 * env;
        cy += q2 * 0.9 * Hbody * (1.5 * w * w - 0.5) * env;
        let fe = ub * (NE - 1);
        fe = fe < 0 ? 0 : fe > NE - 1.001 ? NE - 1.001 : fe;
        const ie = fe | 0;
        eta = ETA[ie] + (ETA[ie + 1] - ETA[ie]) * (fe - ie);
        b *= 1 + eta * env;
        a *= 1 - 0.4 * eta * env;
        const gd = (x - hitX) / 46;
        gh = Math.exp(-gd * gd);
        // (wgniecenie najwyżej do 0,6 przekroju)
        const dLoc = Math.min(dent * gh, 0.6 * b);
        b -= 0.5 * dLoc;
        cy -= 0.5 * dLoc;
        if (a < 0) a = 0;
        if (b < 0) b = 0;
      }
      const metal = a > 0.4 && b > 0.25;
      if (!metal) { a = 0; b = 0; }
      // POLE: jasność powłoki z nacisku metalu (napięcie, uderzenie strugi, fala, mody, napięcie ku gardzieli); zapadnięty
      // rękaw — przygaszony
      const fore = ub > 0.45 ? Math.min(1, (ub - 0.45) / 0.3) : 0;
      let glow = 0.3;
      if (metal) glow = 0.16 + 0.42 * Math.min(1.2, pT) * env + 0.9 * inR * gh + 2.6 * Math.abs(eta) + 0.5 * modeAct * env + (0.55 * (1 - env) + 0.45 * fore * env) * Math.min(1.3, Qn) * (0.7 + 0.6 * sig);
      // ZACISK: jasny pas na przewężeniu (siła zacisku z symulacji)
      const dp = (x - xpr - 0.2 * wp) / 18;
      const pin = V > 0 ? pinF * Math.exp(-dp * dp) : 0;
      // powłoka: na metalu warstwa pola; gdzie metalu nie ma (za zaciskiem i w otwartym, jeszcze pustym rękawie przy zrzucie)
      // — płaski zapadnięty rękaw (w szyi zwęża się z lejkiem); na zacisku przewężenie; tylny koniec rękawa zamknięty
      const infl = 9 + 3 * Math.min(glow + pin, 2.5);
      let sa = metal ? a + infl : 0;
      let sb = metal ? b + infl : 0;
      let collapsed = 0;
      {
        const dw = (x - xpr) / 24;
        const cap = sstep((x - (BLONA.x0 - 6)) / 14);
        const wc = COLL_W * (1 - BLONA.waist * Math.exp(-dw * dw)) * env * cap;
        const hc = (BLONA.collH + 3) * env * cap;
        if (wc > sa) sa = wc;
        if (hc > sb) sb = hc;
        if (!metal) { collapsed = 1; cy = BLONA.yc + WB[3]; }
      }
      if (metal) live++;
      // (etap „Struga”) widoczna powierzchnia w osi rękawu (z = 0): wierzch i spód metalu; pusty rękaw — jego dno (środek
      // płaskiej błony). Struga kończy się na tej powierzchni (wejście liczone z obrazu, z modami, falą i wgnieceniem)
      bTop[k] = metal ? cy + b : cy;
      bBot[k] = metal ? cy - b : cy;
      // (v3.w = u — położenie wzdłuż rękawa dla materiału metalu: kanał jaśniejszy ku gardzieli)
      out[r + 0] = x; out[r + 1] = cy; out[r + 2] = 0; out[r + 3] = u; out[r + 4] = a; out[r + 5] = b; out[r + 6] = WB[2]; out[r + 7] = metal ? 2 : 0; out[r + 8] = resTt; out[r + 9] = resTt; out[r + 10] = 0; out[r + 11] = 0; out[r + 12] = x - flowPh; out[r + 13] = xr; out[r + 14] = time; out[r + 15] = metal ? Math.min(1, Math.max(0, ub)) : 0; out[r + 16] = 1; out[r + 17] = 0; out[r + 18] = glow; out[r + 19] = eta;
      out[r + 20] = sa; out[r + 21] = sb; out[r + 22] = sa > 0.3 ? (collapsed ? 3 : 2) : 0; out[r + 23] = pin;
      out[r + 24] = 0; out[r + 25] = 0; out[r + 26] = 0; out[r + 27] = 0;
    }
    // styczne osi błony z sąsiednich środków (ugięcie, szyja)
    for (let k = 0; k < NB; k++) {
      const r = (B0 + k) * STACJE_STRIDE;
      const rp = (B0 + (k > 0 ? k - 1 : 0)) * STACJE_STRIDE;
      const rn = (B0 + (k < NB - 1 ? k + 1 : NB - 1)) * STACJE_STRIDE;
      const dx = out[rn] - out[rp];
      const dy = out[rn + 1] - out[rp + 1];
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 1e-4) { out[r + 16] = dx / l; out[r + 17] = dy / l; }
    }
    // ===================== STRUGA (etap „Struga”: liczona po błonie — wejście na jej widocznej powierzchni) =====================
    // Pakiety strugi leżą od wargi wylewki do błony (metal w rurze to osobna kolejka — rury nie widać). Przekrój z ciągłości:
    // λ = q · ρ / v(s) — q: wypływ przez wargę, gdy pakiet ją mijał (ciągły, maleje w ogonie spływu), v(s): prędkość z
    // energii pola na drodze (struga cienieje, przyspieszając). Koniec strugi przy błonie:
    //   — leci (jeszcze nie sięga powierzchni): zaokrąglone czoło najstarszego pakietu (co najmniej kropla 14 j.);
    //   — sięga: WEJŚCIE na widocznej powierzchni metalu w rękawie (wierzch z modami, falą i wgnieceniem — `bTop`) albo na
    //     dnie pustego rękawu; tuż nad powierzchnią STOPA ZLANIA (struga rozlewa się w poprzek w menisk), płytkie zanurzenie
    //     (najwyżej połowa głębokości metalu pod wejściem) — bez czubka, bez przenikania przez metal;
    //   — urwana na wardze (rura pusta): zaokrąglony koniec najmłodszego pakietu jedzie do błony i zlewa się ze stopą.
    const nj = ring[3];
    for (let k = 0; k < nj; k++) {
      const o = line.jetOffset(k);
      jetS[k] = JT[o + PJ.s] + JT[o + PJ.va] * adv;
      const xj = JT[o + PJ.x];
      const T0 = MS.T0 + (MC.T0 - MS.T0) * xj;
      const T1 = MS.T1 + (MC.T1 - MS.T1) * xj;
      jetT[k] = (JT[o + PJ.T] - T0) / (T1 - T0);
      jetX[k] = xj;
      jetP[k] = JT[o + PJ.p];
      jetM[k] = JT[o + PJ.m0];
      jetW[k] = JT[o + PJ.tw];
      jetL[k] = JT[o + PJ.q] * VOL_TON;
      jetV[k] = JT[o + PJ.v];
    }
    const flowing = L[LIN_STAN.lipQ] > 0;
    const sLip = PASMO.sLip;
    const yLip = JY[0] + (PASMO.sLip - LAY.jet[0]) * JTY[0];
    const head0 = nj > 0 ? jetS[0] : -1;
    const tailS = nj > 0 ? (flowing ? -1e9 : jetS[nj - 1]) : 0;
    // --- przejście 1: promień bazowy i cechy metalu w każdej stacji (poza pakietami — wartości skrajnego) ---
    let jk = nj - 1;
    for (let q = 0; q < NJ; q++) {
      const s = LAY.jet[q];
      const r = (J0 + q) * STACJE_STRIDE;
      let rj = 0;
      let Tt = 0;
      let xx = xr;
      let aux = 0;
      let pc = s;
      let glow = 0;
      if (nj > 0 && s >= sLip - 6) {
        while (jk > 0 && jetS[jk] < s) jk--;
        while (jk < nj - 1 && jetS[jk + 1] >= s) jk++;
        const k0 = jk;
        let k1 = jk + 1 < nj ? jk + 1 : jk;
        if (jetS[k0] < s) k1 = k0;
        let f = k1 !== k0 ? (jetS[k0] - s) / Math.max(jetS[k0] - jetS[k1], 1e-6) : 0;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        // pole ciągnie strugę w dół: prędkość z energii na spadku za wargą → przekrój = przepływ / prędkość
        const vp = jetV[k0] + (jetV[k1] - jetV[k0]) * f;
        const dy = s > sLip ? yLip - JY[q] : 0;
        const ec = s > sLip ? Math.min(1, (s - sLip) / PASMO.collarLen) : 0;
        const vs = Math.sqrt(vp * vp + PASMO.collarE * ec + 2 * PASMO.fieldG * (dy > 0 ? dy : 0));
        const qv = jetL[k0] + (jetL[k1] - jetL[k0]) * f;
        const lam = qv / (vs > 1 ? vs : 1);
        const pul = jetP[k0] + (jetP[k1] - jetP[k0]) * f;
        rj = Math.sqrt(lam / Math.PI) * (1 + 0.06 * Math.max(-2.5, Math.min(2.5, pul)));
        // za wargą: struga przechodzi między klapami zaworu i przez kołnierz pola (przewężenie)
        if (s < sLip + 12) rj = Math.min(rj, 58);
        Tt = jetT[k0] + (jetT[k1] - jetT[k0]) * f;
        xx = jetX[k0] + (jetX[k1] - jetX[k0]) * f;
        aux = jetW[k0] + (jetW[k1] - jetW[k0]) * f;
        const mm = jetM[k0] + (jetM[k1] - jetM[k0]) * f;
        pc = -((mm * VOL_UNIT / 12000) % WRAP);
        // pole wokół strugi: kołnierz i pierścienie przy wylewce ściskają, rękaw prowadzi (jasność z wypływu)
        const nearLip = Math.max(0, 1 - Math.max(0, s - sLip) / 90);
        glow = (0.3 + 0.7 * Math.min(1, qv / (30 * VOL_TON))) * (0.45 + 0.55 * nearLip);
      }
      jR[q] = rj;
      out[r + 0] = JX[q]; out[r + 1] = JY[q]; out[r + 2] = 0; out[r + 3] = s; out[r + 6] = 2; out[r + 8] = Tt; out[r + 9] = Tt; out[r + 10] = 0; out[r + 11] = 0; out[r + 12] = pc; out[r + 13] = xx; out[r + 14] = time; out[r + 15] = aux; out[r + 16] = JTX[q]; out[r + 17] = JTY[q]; out[r + 18] = glow; out[r + 19] = 0;
      out[r + 23] = 0; out[r + 24] = 0; out[r + 25] = 0; out[r + 26] = 0; out[r + 27] = 0;
    }
    // --- wejście w błonę: pierwszy punkt drogi strugi na widocznej powierzchni metalu (albo dnie pustego rękawu) ---
    entry[0] = PASMO.sEnd; entry[1] = 0; entry[2] = JX[NJ - 1]; entry[3] = JY[NJ - 1]; entry[4] = 0;
    entry[5] = Math.abs(JTX[NJ - 1]); entry[6] = Math.abs(JTY[NJ - 1]);
    {
      const bx0 = BAGX[0];
      const bdx = BAGX[1] - BAGX[0];
      let dPrev = 1e9;
      for (let q = 0; q < NJ; q++) {
        const s = LAY.jet[q];
        if (s < sLip + 20) continue;
        let fb = (JX[q] - bx0) / bdx;
        if (fb < 0) continue;
        if (fb > NB - 1.001) fb = NB - 1.001;
        const ib = fb | 0;
        const tb = fb - ib;
        const top = bTop[ib] + (bTop[ib + 1] - bTop[ib]) * tb;
        const d = JY[q] - top;
        if (d <= 0) {
          const t = dPrev < 1e8 ? dPrev / (dPrev - d) : 1;
          entry[0] = LAY.jet[q - 1] + (s - LAY.jet[q - 1]) * t;
          entry[1] = jR[q - 1] + (jR[q] - jR[q - 1]) * t;
          entry[2] = JX[q - 1] + (JX[q] - JX[q - 1]) * t;
          entry[3] = JY[q - 1] + (JY[q] - JY[q - 1]) * t;
          entry[4] = top - (bBot[ib] + (bBot[ib + 1] - bBot[ib]) * tb);
          entry[5] = Math.abs(JTX[q]); entry[6] = Math.abs(JTY[q]);
          break;
        }
        dPrev = d;
      }
    }
    const sE = entry[0];
    const rE = entry[1] > 1 ? entry[1] : 1;
    // struga sięga powierzchni: według symulacji (metal wpada do błony) albo już w obrazie (czoło minęło powierzchnię)
    const reach = nj > 0 && (L[LIN_STAN.landed] > 0 || head0 >= sE);
    // KONIEC POD POWIERZCHNIĄ: przekrój stopy zwęża się w płaszczyźnie łuku do `tip` · b_stopy, a koniec leży tak głęboko,
    // że cały jego przekrój jest pod lustrem (oś schodzi o |t_y| na jednostkę drogi, przekrój sięga ponad oś o |t_x| · b)
    // — powierzchnia metalu zakrywa koniec, z góry widać tylko linię zlania; przy płytkim metalu (pusty rękaw, pierwsza
    // kałuża) koniec płaski, żeby spód stopy nie przebił dna rękawu
    const txE = entry[5] > 0.05 ? entry[5] : 0.05;
    const tyE = entry[6] > 0.2 ? entry[6] : 0.2;
    const bFoot = (1 + FOOT.deep) * rE;
    let bTip = FOOT.tip * bFoot;
    const bShallow = (entry[4] - 3) / (2 * txE);
    if (bTip > bShallow) bTip = bShallow > 0 ? bShallow : 0;
    const sub = (txE * bTip + 2) / tyE;
    const lFoot = FOOT.len * rE;
    const head = reach ? sE + sub : head0;
    // --- przejście 2: koniec strugi (czoło / wejście ze stopą / ogon), powłoka pola ---
    for (let q = 0; q < NJ; q++) {
      const s = LAY.jet[q];
      const r = (J0 + q) * STACJE_STRIDE;
      let a = 0;
      let b = 0;
      let glow = out[r + 18];
      if (nj > 0 && s >= sLip - 6 && s <= head && s >= tailS && jR[q] > 0) {
        let rj = jR[q];
        let rb = rj;
        if (reach) {
          // STOPA ZLANIA: tuż nad powierzchnią struga rozlewa się w poprzek (menisk) — szerzej w poprzek (a) niż w
          // płaszczyźnie łuku (b); pod powierzchnią przekrój stopy do końca (schowany w metalu)
          const d = sE - s;
          if (d < lFoot) {
            const g = d <= 0 ? 1 : 1 - d / lFoot;
            const g3 = g * g * g;
            rj *= 1 + FOOT.wide * g3;
            rb *= 1 + FOOT.deep * g3;
          }
          if (d < 0) {
            // pod lustrem: zwężenie do końca (schowany w metalu)
            const k = Math.min(1, -d / sub);
            rb += (bTip - rb) * k;
            rj *= 1 - 0.3 * k;
          }
          // spód stopy nie schodzi pod dno metalu w rękawie (płytka kałuża, pusty rękaw)
          const fb = (JX[q] - BAGX[0]) / (BAGX[1] - BAGX[0]);
          if (fb >= 0 && fb <= NB - 1.001) {
            const ib = fb | 0;
            const bot = bBot[ib] + (bBot[ib + 1] - bBot[ib]) * (fb - ib);
            const tx = Math.abs(JTX[q]) > 0.05 ? Math.abs(JTX[q]) : 0.05;
            let bMax = (JY[q] - bot - 1) / tx;
            if (bMax < 0.2 * jR[q]) bMax = 0.2 * jR[q];
            if (rb > bMax) rb = bMax;
          }
          // pole przy wejściu: błona przyjmuje pęd strugi
          const nearHit = s > sE - 90 ? Math.min(1, (s - sE + 90) / 90) : 0;
          glow += 0.6 * nearHit * Math.min(1, glow / 0.45);
        } else {
          // czoło lecącego metalu: zaokrąglone, co najmniej kropla 14 j.
          const dh = head - s;
          if (rj < 14 && dh < 28) { rj = 14; rb = 14; }
          if (dh < rj) { const g = Math.min(1, Math.max(0, dh / rj)); const k = Math.sqrt(g * (2 - g)); rj *= k; rb *= k; }
        }
        if (!flowing) {
          // ogon po urwaniu na wardze: zaokrąglony koniec (zlewa się ze stopą, gdy dojedzie do powierzchni)
          const dt0 = s - tailS;
          const rr = jR[q];
          if (dt0 < rr) { const g = Math.min(1, Math.max(0, dt0 / rr)); const k = Math.sqrt(g * (2 - g)); rj *= k; rb *= k; }
        }
        a = rj;
        b = rb;
      }
      if (a > 0.05) live++; else { a = 0; b = 0; glow = 0; }
      out[r + 4] = a; out[r + 5] = b; out[r + 7] = a > 0 ? 1 : 0; out[r + 18] = glow;
      out[r + 20] = a > 0 ? a + 7 : 0; out[r + 21] = a > 0 ? b + 7 : 0; out[r + 22] = a > 0 ? 1 : 0;
    }
    // ===================== PASMO =====================
    const sG0 = PASMO.sG0;
    const ns = ring[1];
    for (let i = 0; i < ns; i++) {
      const o = line.sliceOffset(i);
      slBot[i] = SL[o + PL.s] + SL[o + PL.u] * adv;
      const t = SL[o + PL.tail];
      slTop[i] = t === 2 ? sG0 : TOPv[i] + TOPUv[i] * adv;
      if (slTop[i] > slBot[i] - 0.01) slTop[i] = slBot[i] - 0.01;
      slC[i] = 0.5 * (slTop[i] + slBot[i]);
      slQ[i] = SL[o + PL.A];
      if (KF) {
        let fa = slTop[i] - TX_S0;
        fa = fa < 0 ? 0 : fa > TX_N - 0.001 ? TX_N - 0.001 : fa;
        let fb = slBot[i] - TX_S0;
        fb = fb < 0 ? 0 : fb > TX_N - 0.001 ? TX_N - 0.001 : fb;
        const ia = fa | 0;
        const ib = fb | 0;
        const I = (CI[ib] + (CI[ib + 1] - CI[ib]) * (fb - ib)) - (CI[ia] + (CI[ia + 1] - CI[ia]) * (fa - ia));
        if (t !== 2 && SL[o + PL.fs] >= 0.999 && I > 1e-6) slQ[i] = SL[o + PL.m] * VOL_UNIT / I;
        else {
          // ciecz (przed walcownią — v = 1, bez pętli): przepływ = przekrój
          let fc = slC[i] - TX_S0 - 0.5;
          fc = fc < 0 ? 0 : fc > TX_N - 1.001 ? TX_N - 1.001 : fc;
          const ic = fc | 0;
          slQ[i] = SL[o + PL.A] * (KF[ic] + (KF[ic + 1] - KF[ic]) * (fc - ic)) * (KS ? KS[ic] : 1);
        }
      }
    }
    const WRv = line.view.wref;
    xiPre[0] = 0; xiPre[1] = 0; xiPre[2] = 0;
    // (runda 9) STACJA ODZGORZANIA: ξ ostatniej stacji przed strefą (`xiOz`) i prędkość taśmy tam; w strefie i tuż za nią
    // ξ = xiOz · profil stacji w punkcie (`descaleProfile` — ten sam rachunek co model), dalej stan plastrów (reszta)
    const ozOn = L[LIN_STAN.odzOn] > 0;
    const ozU = L[LIN_STAN.odzU];
    let xiOz = -1;
    let vOz = 0;
    let keepOz = 1;
    const MVv = mill && mill.view && mill.view.vExit ? mill.view : null;
    let si = ns - 1;              // plaster najbliżej wylotu (najmniejsze s) — idziemy w górę s
    for (let q = 0; q < NP; q++) {
      const s = LAY.strip[q];
      const r = (P0 + q) * STACJE_STRIDE;
      let a = 0;
      let b = 0;
      let nE = 2;
      let kind = 0;
      let Tt = 0;
      let Ts = 0;
      let fl = 0;
      let xi = 0;
      let pc = s;
      let xx = xr;
      let ct = time;
      let aux = 0;
      let slope = 0;
      let cy = PY;
      let wp = 0;
      let lq = 0;
      let dvW = 0;
      let fsK = 1;
      if (ns > 0) {
        while (si > 0 && slBot[si] < s) si--;
        while (si < ns - 1 && slTop[si] > s) si++;
        if (s <= slBot[si] && s >= slTop[si]) {
          const i0 = si;
          let i1 = s >= slC[i0] ? i0 - 1 : i0 + 1;
          if (i1 < 0 || i1 >= ns) i1 = i0;
          const o0 = line.sliceOffset(i0);
          if (i1 === i0 - 1 && SL[line.sliceOffset(i1) + PL.tail] === 1) i1 = i0;
          if (i1 === i0 + 1 && SL[o0 + PL.tail] === 1) i1 = i0;
          const o1 = line.sliceOffset(i1);
          let f = i1 === i0 ? 0 : (s - slC[i0]) / (slC[i1] - slC[i0]);
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          let A = (SL[o0 + PL.A] + (SL[o1 + PL.A] - SL[o0 + PL.A]) * f);
          if (KF) {
            let fs = s - TX_S0 - 0.5;
            fs = fs < 0 ? 0 : fs > TX_N - 1.001 ? TX_N - 1.001 : fs;
            const is = fs | 0;
            const ff = fs - is;
            const v = KF[is] + (KF[is + 1] - KF[is]) * ff;
            const w = KS ? KS[is] + (KS[is + 1] - KS[is]) * ff : 1;
            A = (slQ[i0] + (slQ[i1] - slQ[i0]) * f) / (v * w);
          }
          let ah = (SL[o0 + PL.a] + (SL[o1 + PL.a] - SL[o0 + PL.a]) * f);
          nE = (SL[o0 + PL.n] + (SL[o1 + PL.n] - SL[o0 + PL.n]) * f);
          let waveLift = 0;
          // udział fazy stałej rdzenia (krzepnięcie w plastrze — ciągłe przez front)
          const fsI = SL[o0 + PL.fs] + (SL[o1 + PL.fs] - SL[o0 + PL.fs]) * f;
          // FALA GRUBOŚCI w części ciekłej (poprawki rundy 6): odchyłka przekroju od nominalnego (liczona — wypływ G0
          // modulowany modami błony i uderzeniem zrzutu) wzmocniona w obrazie ×(1 + 6·ciecz) (w fizyce fala ma ±1–8 %
          // przekroju), żeby garby biegnące z pasmem były czytelne; garb trochę jaśnieje (grubszy metal — więcej ciepła);
          // za frontem (ciało stałe) bez wzmocnienia
          // (odchyłka od przekroju ODNIESIENIA w tym miejscu drogi — średnia krocząca w czasie liczona w kroku linii,
          // `WREF`; profil bram i szyi bez zmian, wzmacnia się tylko to, co przebiega)
          {
            let fw = (s - WREF.s0) / WREF.ds;
            let Ab = 0;
            if (fw >= 0 && fw < WREF.n - 1.001) {
              const iw = fw | 0;
              const A0w = WRv[iw];
              const A1w = WRv[iw + 1];
              if (A0w > 0 && A1w > 0) { fw -= iw; Ab = A0w + (A1w - A0w) * fw; }
            }
            if (s > sG0 + 30 && Ab > 0) {
              let dv = A / Ab - 1;
              dv = dv < -0.07 ? -0.07 : dv > 0.07 ? 0.07 : dv;
              dvW = dv;
              const gl = WAVE_GAIN * (1 - fsI) * Math.min(1, (s - sG0 - 30) / 60);
              A *= 1 + gl * dv;
              ah *= 1 + 0.35 * gl * dv;
              waveLift = 0.06 * gl * dv;
            }
          }
          const Kn = AK[Math.min(AK.length - 1, Math.max(0, Math.round((nE - 2) * 20)))];
          let bh = A / (Kn * Math.max(ah, 1));
          // końce pasma: czoło i ogon zaokrąglone (język) — w grubości na długości ~1,6 grubości, w planie na ~0,7
          // półszerokości (czoło zakrzepłe to zaokrąglony język, nie płaskie cięcie); `endK` — bliskość końca
          let isEnd = 0;
          let endK = 0;
          // (runda 8) czoło CIĘTE nożem dzielenia jest proste (bez języka) — koniec rysuje domknięcie niżej
          const front = si === 0 ? !cutF : SL[line.sliceOffset(si - 1) + PL.tail] === 1;
          if (front) {
            const d = slBot[si] - s;
            const e = Math.max(bh * 1.6, 10);
            const ew = Math.max(ah * 0.7, e);
            if (d < ew) {
              const gw = Math.min(1, Math.max(0, d / ew));
              const kw = Math.sqrt(gw * (2 - gw));
              ah *= 0.3 + 0.7 * kw;
              const g = Math.min(1, Math.max(0, d / e));
              bh *= Math.sqrt(g * (2 - g));
              endK = 1 - kw;
              isEnd = 1;
            }
          }
          if (SL[o0 + PL.tail] === 1) {
            const d = s - slTop[si];
            const e = Math.max(bh * 1.6, 10);
            const ew = Math.max(ah * 0.7, e);
            if (d < ew) {
              const gw = Math.min(1, Math.max(0, d / ew));
              const kw = Math.sqrt(gw * (2 - gw));
              ah *= 0.3 + 0.7 * kw;
              const g = Math.min(1, Math.max(0, d / e));
              bh *= Math.sqrt(g * (2 - g));
              endK = Math.max(endK, 1 - kw);
              isEnd = 1;
            }
          }
          const xs = (SL[o0 + PL.x] + (SL[o1 + PL.x] - SL[o0 + PL.x]) * f);
          const T0 = MS.T0 + (MC.T0 - MS.T0) * xs;
          const T1 = MS.T1 + (MC.T1 - MS.T1) * xs;
          const Tc = (SL[o0 + PL.T] + (SL[o1 + PL.T] - SL[o0 + PL.T]) * f);
          const Tl = (SL[o0 + PL.Ts] + (SL[o1 + PL.Ts] - SL[o0 + PL.Ts]) * f);
          // udział fazy stałej na licu: z temperatury lica (pasmo krzepnięcia rozszerzone do ±12 K na rysunek)
          const Tliq = MS.Tliq + (MC.Tliq - MS.Tliq) * xs + 6;
          const Tsol = Math.min(MS.Tsol + (MC.Tsol - MS.Tsol) * xs, Tliq - 30);
          const fo = Math.min(1, Math.max(0, (slBot[i0] - s) / Math.max(slBot[i0] - slTop[i0], 1e-6)));
          const mm = SL[o0 + PL.m0] + fo * SL[o0 + PL.m];
          a = ah; b = bh;
          Tt = (Tc - T0) / (T1 - T0) + waveLift;
          Ts = (Tl - T0) / (T1 - T0) + waveLift;
          // udział fazy stałej na licu: z temperatury lica, nie mniej niż w rdzeniu (miedź krzepnie prawie izotermicznie —
          // lico stoi na plateau krzepnięcia, a rdzeń przechodzi 0 → 1: bez tego skóra rosła skokiem na froncie)
          fl = Math.min(1, Math.max(0, (Tliq - Tl) / (Tliq - Tsol), fsI * fsI));
          // JEZIORKO (runda 7): ciekły rdzeń z góry — półszerokość w_p = √(1 − f_s) − 0,18 · f_lica (opis na górze pliku)
          lq = fsI < 0 ? 1 : fsI > 1 ? 0 : 1 - fsI;
          fsK = 1 - lq;
          wp = Math.sqrt(lq) - 0.18 * fl;
          wp = wp < 0 ? 0 : wp > 1 ? 1 : wp;
          xi = (SL[o0 + PL.xi] + (SL[o1 + PL.xi] - SL[o0 + PL.xi]) * f);
          // (runda 9) STACJA ODZGORZANIA — front czyszczenia w punkcie, nie w środku plastra (plaster ~21 j.): przed strefą
          // ξ plastra jeszcze nieoczyszczonego (środek przed strefą), w strefie i 24 j. za nią — profil stacji
          if (ozOn && fsI >= 0.999 && s > OZ_X0 - 30 + PATH.xOff && s < OZ_X1 + 24 + PATH.xOff) {
            const x = s - PATH.xOff;
            if (x < OZ_X0) {
              if (slC[i0] >= OZ_X0 + PATH.xOff && i1 !== i0) xi = SL[o1 + PL.xi];
              else if (slC[i1] >= OZ_X0 + PATH.xOff) xi = SL[o0 + PL.xi];
              xiOz = xi;
              vOz = SL[o0 + PL.u];
            } else if (xiOz >= 0) {
              keepOz = descaleProfile(OZ_X1, vOz, ozU);
              xi = xiOz * descaleProfile(x, vOz, ozU);
            }
          }
          // (runda 7) ξ tuż przed pękaniem zgorzeliny na klatce (ostatnia stacja przed strefą — rośniemy w s)
          if (KF && fsI >= 0.999) for (let k = 0; k < 3; k++) { const e0 = WALC.stands[k].e - CRACK_LEN; if (s <= e0 && s > e0 - 40) xiPre[k] = xi; }
          // czoło i ogon stygną szybciej (ciepło uchodzi też przez czoło): ciemniejszy brzeg języka
          if (endK > 0 && fsI > 0.5) Ts -= 0.05 * endK * endK;
          // KLATKI (poprawki rundy 6): w łuku styku lico stygnie stopniowo (dotyk walca) — od chwytu do osi; przed chwytem
          // zgorzelina pęka i odpada (jaśniejszy pas świeżego metalu przed walcem, widoczny z góry). Fizyka zmienia stan
          // plastra przy osi walców; obraz rozkłada tę samą zmianę na drodze, na której zachodzi.
          if (fsI >= 0.999) {
            const kk = SL[o0 + PL.k] | 0;
            for (let k = kk; k < 3; k++) {
              const S = WALC.stands[k];
              if (s < S.e - CRACK_LEN || s > S.x) continue;
              const cr = (s - (S.e - CRACK_LEN)) / (S.x - S.e + CRACK_LEN);
              const rem = (1 - WALC.xiKeep) * cr * cr * (3 - 2 * cr);
              // (świeży metal spod odpadającej zgorzeliny jest cieplejszy — zgorzelina izoluje: jaśniejszy pas przed walcem)
              Ts += 0.03 * rem * Math.min(1, xi / 0.3);
              xi *= 1 - rem;
              if (s >= S.e) {
                const c2 = (s - S.e) / (S.x - S.e);
                Ts += (WALC.dTs / (T1 - T0)) * c2 * c2 * (3 - 2 * c2);
              }
              break;
            }
          }
          pc = -((mm * VOL_UNIT / PASMO.A0) % WRAP);
          xx = xs;
          ct = (SL[o0 + PL.ct] + (SL[o1 + PL.ct] - SL[o0 + PL.ct]) * f);
          // złącze z błoną (gardziel G0): materiał przechodzi z błony w pasmo na 30 j.
          kind = 2 + Math.min(1, Math.max(0, (s - sG0) / 30));
          if (isEnd) kind = 3;
          if (LIFT) {
            // pętla między klatkami: uniesienie osi (interpolacja środków komórek) i nachylenie — przekrój prostopadły do osi
            let fl2 = s - TX_S0 - 0.5;
            fl2 = fl2 < 1 ? 1 : fl2 > LIFT.length - 2.001 ? LIFT.length - 2.001 : fl2;
            const il = fl2 | 0;
            aux = LIFT[il] + (LIFT[il + 1] - LIFT[il]) * (fl2 - il);
            slope = 0.5 * (LIFT[il + 1] - LIFT[il - 1]);
          }
          cy += aux;
        }
      }
      if (!(a > 0.05 && b > 0.05)) { a = 0; b = 0; kind = 0; wp = 0; lq = 0; } else live++;
      const tl = 1 / Math.sqrt(1 + slope * slope);
      out[r + 0] = s - PATH.xOff; out[r + 1] = cy; out[r + 2] = 0; out[r + 3] = s; out[r + 4] = a; out[r + 5] = b; out[r + 6] = nE; out[r + 7] = kind; out[r + 8] = Tt; out[r + 9] = Ts; out[r + 10] = fl; out[r + 11] = xi; out[r + 12] = pc; out[r + 13] = xx; out[r + 14] = ct; out[r + 15] = aux; out[r + 16] = tl; out[r + 17] = slope * tl; out[r + 18] = 0; out[r + 19] = 0;
      out[r + 20] = 0; out[r + 21] = 0; out[r + 22] = 0; out[r + 23] = 0;
      out[r + 24] = wp; out[r + 25] = lq; out[r + 26] = kind > 0 ? Tt : 0; out[r + 27] = 0.05;
      // (runda 7) strefa walcowni: zgorzelina wwalcowana, wydłużenie, czas od ostatniej klatki (opis przy `MILL_X0`)
      if (KF && s - PATH.xOff >= MILL_X0 && kind > 0) {
        let kk = -1;
        for (let k = 0; k < 3; k++) if (s > WALC.stands[k].x) kk = k;
        out[r + 18] = kk >= 0 ? WALC.xiKeep * xiPre[kk] : 0;
        // (runda 9) łuska wwalcowana zdejmowana razem z nową w strefie stacji odzgorzania (ten sam profil), dalej reszta
        if (ozOn && xiOz >= 0 && s - PATH.xOff > OZ_X0) out[r + 18] *= s - PATH.xOff < OZ_X1 ? descaleProfile(s - PATH.xOff, vOz, ozU) : keepOz;
        let il = (s - TX_S0) | 0;
        il = il < 0 ? 0 : il >= TX_N ? TX_N - 1 : il;
        out[r + 19] = LAMBDA[il];
        out[r + 25] = kk >= 0 && MVv ? (s - WALC.stands[kk].x) / Math.max(MVv.vExit[kk], 1) : -1;
      }
      stDv[q] = dvW;
      stFs[q] = kind > 0 ? fsK : 1;
    }
    // ===================== CZOŁO CIĘTE (runda 8, dzielenie): proste domknięcie na x czoła =====================
    // Stacje pasma stoją w stałych s (co 7 j. za klatkami): pierwsza stacja za czołem dostaje przekrój ostatniej żywej
    // i x czoła, druga — x czoła i zerowy przekrój (płaskie wieczko), więc koniec taśmy leży dokładnie na brzegu cięcia,
    // a nie na najbliższej stacji. ŻAR BRZEGU CIĘCIA liczy fragment pasma (`LM.cut`, `dzielenie/krawedzTSL.js`) z x
    // czoła — nie stacje: pas żaru (1,5–8 j.) jest węższy niż odstęp stacji, a odcinek między ostatnią stacją a czołem
    // zmienia długość 0…7 j., gdy czoło jedzie (próbkowany na stacjach pas pulsował ok. 48 razy na sekundę).
    if (cutF && ns > 0) {
      const xf = slBot[0];
      let q1 = -1;
      for (let q = 0; q < NP; q++) if (LAY.strip[q] > xf) { q1 = q; break; }
      if (q1 > 0 && q1 + 1 < NP) {
        const r0 = (P0 + q1 - 1) * STACJE_STRIDE;
        if (out[r0 + 7] !== 0) {
          for (let e = 0; e < 2; e++) {
            const r = (P0 + q1 + e) * STACJE_STRIDE;
            for (let c = 0; c < STACJE_STRIDE; c++) out[r + c] = out[r0 + c];
            out[r + 0] = xf - PATH.xOff;
            out[r + 3] = xf;
            if (e === 1) { out[r + 4] = 0; out[r + 5] = 0; }
          }
        }
      }
    }
    // ===================== BRAMY POLA (runda 7): nacisk z liczonego stanu i powłoka pola w strefie bram ==============
    GW[0] = L[LIN_STAN.vLine] / Math.max(1e-6, L[LIN_STAN.vNom]);
    GW[1] = L[LIN_STAN.aOut];
    gatePass(out, press, stDv, stFs, GW);
    // stacje bez metalu tuż za końcem (w obrębie odcinka): barwa i wzór sąsiada (bez skoku przy przesuwaniu czoła)
    for (let q = 0; q < n; q++) {
      const r = q * STACJE_STRIDE;
      if (out[r + 7] !== 0) continue;
      const first = q === J0 || q === B0 || q === P0;
      const last = q === B0 - 1 || q === P0 - 1 || q === n - 1;
      const rp = (q - 1) * STACJE_STRIDE;
      const rn = (q + 1) * STACJE_STRIDE;
      const prevLive = !first && out[rp + 7] !== 0;
      const nextLive = !last && out[rn + 7] !== 0;
      if (prevLive || nextLive) {
        const src = prevLive ? rp : rn;
        out[r + 8] = out[src + 8]; out[r + 9] = out[src + 9]; out[r + 10] = out[src + 10]; out[r + 11] = out[src + 11];
        out[r + 12] = out[src + 12]; out[r + 13] = out[src + 13]; out[r + 14] = out[src + 14];
      }
    }
    return live;
  }

  /**
   * Światła linii (blok `FormowanieSwiatloLinii`: `data` = tablica Vector4 32 × [A_i (xyz, promień), B_i (xyz, T̃)]):
   * [0] błona (odcinek wzdłuż korpusu), [1] struga od wargi wylewki do wejścia w błonę, [15] struga przy wylewce (duże
   * źródło — żar na płaszcz naczynia od spodu, nogi, rurę spustową i klapy), [2–13] 12 odcinków pasma od G0 do bramy (średnie T̃
   * ważone mocą świecenia, półszerokość), [14] błysk chwytu (etap „Walcowanie”) — zgaszony.
   */
  function fillLights(out, data, kStrip = 1) {
    const NL = 16;
    for (let i = 0; i < NL; i++) setLight(data, i, 0, 0, 0, 0, 0, 0, 0, 0);
    // błona: z rekordów stacji (zasięg w x, półszerokość, T̃)
    let r0r = 0; let r0T = 0; let r0n = 0; let rxa = 1e9; let rxb = -1e9;
    for (let q = B0; q < P0; q++) {
      const r = q * STACJE_STRIDE;
      if (out[r + 7] === 0) continue;
      r0n++; r0r = Math.max(r0r, out[r + 4]); r0T += out[r + 8];
      if (out[r] < rxa) rxa = out[r];
      if (out[r] > rxb) rxb = out[r];
    }
    if (r0n > 0 && rxb > rxa) {
      const yc = BLONA.yc;
      setLight(data, 0, rxa + Math.min(r0r * 0.5, (rxb - rxa) * 0.3), yc, 0, r0r * 1.05, rxb - Math.min(r0r * 0.6, (rxb - rxa) * 0.35), yc, 0, r0T / r0n);
    }
    // struga: odcinek od pierwszej do ostatniej żywej stacji
    let j0 = -1; let j1 = -1; let jT = 0; let jr = 0; let jn = 0;
    for (let q = J0; q < B0; q++) {
      const r = q * STACJE_STRIDE;
      if (out[r + 7] === 0) continue;
      if (j0 < 0) j0 = q;
      j1 = q; jT += out[r + 8]; jr += out[r + 4]; jn++;
    }
    if (jn > 1) {
      const a = j0 * STACJE_STRIDE; const b = j1 * STACJE_STRIDE;
      setLight(data, 1, out[a], out[a + 1], out[a + 2], jr / jn, out[b], out[b + 1], out[b + 2], jT / jn);
      // [15] struga przy wylewce: najbliżej naczynia — świeci na płaszcz od spodu, nogi, rurę i klapy (duże źródło)
      const c = Math.min(j1, j0 + 40) * STACJE_STRIDE;
      setLight(data, 15, out[a], out[a + 1], out[a + 2], 110, out[c], out[c + 1], out[c + 2], jT / jn);
    }
    // pasmo: 12 odcinków między G0 a bramą (część ciekła gęściej)
    const xs0 = LINIA.gates[0].x;
    // (do końca poduszki za F3 — x 3380, jak przed rundą 8; za nim taśma ~900 K prawie nie świeci)
    const xs1 = LINIA.cushion[1][1];
    const edges = SEG_EDGES;
    for (let k = 0; k < 12; k++) {
      const x0 = xs0 + (xs1 - xs0) * edges[k];
      const x1 = xs0 + (xs1 - xs0) * edges[k + 1];
      let wsum = 0; let Tw = 0; let aw = 0; let xa = 1e9; let xb = -1e9;
      for (let q = P0; q < n; q++) {
        const r = q * STACJE_STRIDE;
        if (out[r + 7] < 2.5) continue;
        const x = out[r];
        if (x < x0 || x >= x1) continue;
        const T = out[r + 9];
        const wgt = T * T * T + 1e-4;
        wsum += wgt; Tw += T * wgt; aw += out[r + 4] * wgt;
        if (x < xa) xa = x;
        if (x > xb) xb = x;
      }
      if (wsum > 1e-3 && xb > xa) setLight(data, 2 + k, xa, PY, 0, aw / wsum * kStrip, xb, PY, 0, Tw / wsum);
    }
  }

  /**
   * CHŁODNICE (runda 7): strumień ciepła odebrany przez panele C1 / C2 w `CHLODNICE.n` przedziałach x (unormowany do
   * `CHLODNICE.qRef`). Ta sama część promieniowania co w kroku linii: q = K_r · ε(f_s) · (χ − 1) · ((T/T_ref)⁴ −
   * (T_env/T_ref)⁴) na jednostkę powierzchni (χ C1 = 2,2 · k_metal, C2 = 1,4; „1” to otoczenie), razy obwód plastra i
   * długość w przedziale. Zwraca wewnętrzną tablicę (bez alokacji).
   */
  const chill = new Float64Array(CHLODNICE.n);
  const ENV4 = (PASMO.Tenv / PASMO.Tref) ** 4;
  const DXB = (CHLODNICE.x1 - CHLODNICE.x0) / CHLODNICE.n;
  function chillFlux(line) {
    chill.fill(0);
    const SL = line.view.slices;
    const TOPv = line.view.top;
    const ns = line.view.ring[1];
    const C1e = LINIA.chill.C1[1];
    for (let i = 0; i < ns; i++) {
      const o = line.sliceOffset(i);
      const sBot = SL[o + PL.s];
      const sTop = SL[o + PL.tail] === 2 ? PASMO.sG0 : TOPv[i];
      const len = sBot - sTop;
      if (!(len > 0)) continue;
      const xc = 0.5 * (sTop + sBot) - PATH.xOff;
      if (xc < CHLODNICE.x0 || xc >= CHLODNICE.x1) continue;
      const xm = SL[o + PL.x];
      const kM = MS.kMetal + (MC.kMetal - MS.kMetal) * xm;
      const chiEx = xc < C1e ? PASMO.chillC1 * kM - 1 : PASMO.chillC2 - 1;
      const el = MS.el + (MC.el - MS.el) * xm;
      const es = MS.es + (MC.es - MS.es) * xm;
      const eps = el + (es - el) * SL[o + PL.fs];
      const tr = SL[o + PL.T] / PASMO.Tref;
      const q = PASMO.Kr * eps * chiEx * (tr * tr * tr * tr - ENV4);
      let gn = (SL[o + PL.n] - 2) / 4;
      gn = gn < 0 ? 0 : gn > 1 ? 1 : gn;
      const per = 4 * SL[o + PL.a] * (1 + 0.5708 * (1 - gn));
      let bin = ((xc - CHLODNICE.x0) / DXB) | 0;
      bin = bin < 0 ? 0 : bin >= CHLODNICE.n ? CHLODNICE.n - 1 : bin;
      chill[bin] += q * per * len / (DXB * CHLODNICE.qRef);
    }
    return chill;
  }

  return { fill, fillLights, chillFlux, press, entry, get live() { return live; } };
}

/**
 * BRAMY POLA (runda 7): nacisk P_k bram G0–G4 z rekordów stacji pasma (opis na górze pliku) i powłoka pola w strefie bram
 * (v4.z jasność, v5 przekrój powłoki, rodzaj 4, pas siły). `W` = [v / v_nom, modulacja wypływu G0]. Funkcja modułu z
 * tablicami typowanymi (bez liczb w argumentach i wyniku — krok bez alokacji).
 */
function gatePass(out, press, stDv, stFs, W) {
  const dyn = 0.55 + 0.45 * W[0] * W[0];
  for (let k = 0; k < BRAMY.n; k++) {
    const q = GQ[k];
    const r = (P0 + q) * STACJE_STRIDE;
    if (out[r + 7] === 0) { press[k] = 0; continue; }
    // przekrój na bramie względem odniesienia (fala grubości); G0 — modulacja wypływu gardzieli
    const wv = k === 0 ? W[1] : 1 + stDv[q];
    const lqk = 1 - stFs[q];
    press[k] = BRAMY.S[k] * wv * wv * dyn * (0.25 + 0.75 * Math.sqrt(lqk > 0 ? lqk : 0));
  }
  const xEnd = BRAMY.x1 + BRAMY_OUT;
  for (let q = GQ[0]; q < NP; q++) {
    const r = (P0 + q) * STACJE_STRIDE;
    const x = out[r];
    if (x > xEnd) break;
    if (out[r + 7] === 0) continue;
    let tight = 0;
    let band = 0;
    let finZ = 0;
    // (poprawki rundy 7) UGIĘCIE LICA POD BRAMĄ: pole bramy dociska metal — płytkie wgniecenie grubości w płaszczyźnie
    // emiterów (∝ nacisk P_k; σ 6 j.) i małe spiętrzenie tuż przed nią (metal hamowany przed przewężeniem, σ 10 j., 15 j.
    // przed bramą), lekkie przewężenie w planie (emitery po bokach). Obraz z liczonego nacisku, jak fala ×6; przekrój w
    // fizyce bez zmian (przewężenie lokalne: przyspieszenie metalu w szczelinie pola). Normalne i połysk — z geometrii.
    let dent = 0;
    let bulge = 0;
    for (let k = 1; k < BRAMY.n; k++) {
      const d = x - BRAMY.x[k];
      dent += press[k] * Math.exp(-(d * d) / 72);
      const du = d + 15;
      bulge += press[k] * Math.exp(-(du * du) / 200);
    }
    const kb = 1 - GATE_DENT * Math.min(dent, 1.4) + GATE_BULGE * Math.min(bulge, 1.4);
    out[r + 5] *= kb;
    out[r + 4] *= 1 - GATE_WAIST * Math.min(dent, 1.4);
    const a = out[r + 4];
    const b = out[r + 5];
    for (let k = 0; k < BRAMY.n; k++) {
      const d = x - BRAMY.x[k];
      const g = Math.exp(-(d * d) / 256);
      if (g > tight) tight = g;
      band += press[k] * Math.exp(-(d * d) / 100);
      // most pola do lica emitera w poprzek (G1–G4: para emiterów po bokach; G0: boki pierścienia); profil o płaskim
      // szczycie (poprawki rundy 7) — most sięga do całego lica emitera (±12 j.), na nim wachlarz linii pola
      const q2 = (d * d) / 400;
      const gf = press[k] > 0 ? Math.exp(-q2 * q2) : 0;
      const ez = (BRAMY.zE[k] - a - GATE_TIGHT) * gf;
      if (ez > finZ) finZ = ez;
    }
    const fade = 1 - sstep((x - (BRAMY.x1 + 10)) / (BRAMY_OUT - 10));
    const layer = GATE_TIGHT + (GATE_LAYER - GATE_TIGHT) * (1 - tight);
    out[r + 18] = (0.22 + 0.9 * band) * fade;
    out[r + 19] = 0;
    out[r + 20] = a + layer + finZ * fade;
    out[r + 21] = b + layer;
    out[r + 22] = fade > 0.01 ? 4 : 0;
    out[r + 23] = band * fade;
  }
}

function setLight(data, i, ax, ay, az, r, bx, by, bz, T) {
  data[i].set(ax, ay, az, r);
  data[i + 16].set(bx, by, bz, T);
}

/** Granice 12 odcinków światła pasma (ułamek drogi G0 → brama): gęściej w części ciekłej. */
const SEG_EDGES = Object.freeze([0, 0.04, 0.09, 0.15, 0.22, 0.3, 0.39, 0.49, 0.6, 0.71, 0.8, 0.9, 1.0]);

/** Wysokość metalu linii nad pokładem hali w najniższym punkcie (test: ≥ 50 j.). */
export function lowestMetalY(out) {
  let lo = Infinity;
  for (let q = 0; q < STACJE.n; q++) {
    const r = q * STACJE_STRIDE;
    if (out[r + 7] === 0) continue;
    lo = Math.min(lo, out[r + 1] - out[r + 5]);
  }
  return lo - HALA.deckY;
}
