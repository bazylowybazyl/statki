// HUTA — wytop: GAZ KOMORY — stałe styku symulacja ↔ pole gazu (czysty moduł, bez three i DOM).
//
// RUNDA 5 (decyzja użytkownika „Tak, symulowany”, SPEC wpisy 7 i 8; plan: `.tmp/huta/wytop/PROJEKT-gaz.md`). Ruda to
// trzy strumienie: ruda = metal + żużel + GAZ (podział w `metale.js`: `split`). Gaz powstaje w czterech miejscach
// procesu (dym i wyrzuty z grzanej kupy, wtopienia i bąble kąpieli, opary przy ściąganiu żużla, kłąb przy uderzeniu
// masy w lej), krąży w komorze, odciąg (cztery okapy dolne + pierścień górny) wciąga go do rury zbiorczej na pokładzie,
// separator oddaje tlen do trzech leżących zbiorników, a pełny zbiornik oddaje tlen do sieci ringu.
//
// Ten moduł trzyma tylko STAŁE: układ rekordu źródła (`view.gaz` komory, `takeGas`), sloty, rodzaje z zakresami
// z tabeli § 2 projektu i liczby odciągu. Pule, rekordy i liczby w biegu liczy `komora.js` (etap 1), pole gazu na GPU
// (etapy 3–6) czyta rekordy przez `takeGas(out)` i nie wraca do symulacji. Druga część pliku („POLE GAZU”): stałe
// pola, układ wejścia kroku i lustra CPU kerneli z małym krokiem CPU do testów.
import { KOMORA } from './geometria.js';

/** Długość rekordu źródła [float] i liczba slotów (rekordy o STAŁYCH slotach — tablica `Float32Array(32 × 12)`). */
export const GAZ_STRIDE = 12;
export const GAZ_SLOTS = 32;

/**
 * Pola rekordu źródła (układ komory: x, z w planie, y w górę; początek = środek pola):
 *   x, y, z     punkt źródła (na powierzchni bryły, 2–6 j. nad nią — poza bryłą stałą)
 *   units       jednostki gazu (1/1536 t) wydane do komory od ostatniego `takeGas` — NARASTAJĄ, aż odbiorca je zabierze
 *   dx, dy, dz  kierunek wypływu (jednostkowy)
 *   speed       prędkość wypływu [j./s]
 *   kind        rodzaj (`GAZ_RODZAJ`)
 *   temp        temperatura gazu w skali `STAN.temp` (0…1,2)
 *   radius      promień plamy [j.] — pole rozkłada jednostki w kuli o tym promieniu
 *   dym         udział składnika `dym` (pył i para z rudy — ciężkie drobiny); reszta to `opar` (opary metalu i tlen)
 * Kierunek, prędkość i punkt rekordu, do którego w jednym kroku GPU wpadło kilka zdarzeń, to średnia ważona jednostkami.
 */
export const GAZ_REC = Object.freeze({ x: 0, y: 1, z: 2, units: 3, dx: 4, dy: 5, dz: 6, speed: 7, kind: 8, temp: 9, radius: 10, dym: 11 });

/** Sloty rekordów: początek i liczba dla każdego rodzaju (0–5 dym kupy, 6–9 wyrzuty, 10–17 sektory wtopień, 18–25 bąble, 26 ssawa, 27–31 uderzenie). */
export const GAZ_SLOT = Object.freeze({
  heap: 0, heapN: 6, burst: 6, burstN: 4, melt: 10, meltN: 8, bubble: 18, bubbleN: 8, suck: 26, suckN: 1, impact: 27, impactN: 5
});

/** Rodzaje źródeł (pole `kind` rekordu). */
export const GAZ_RODZAJ = Object.freeze({ DYM_KUPY: 0, WYRZUT: 1, WTOPIENIE: 2, BABEL: 3, SSAWA: 4, UDERZENIE: 5 });

/**
 * Tabela rodzajów (§ 2 projektu): fazy (numery `PHASE` z `komora.js`: 2 docisk, 3 topienie, 4 dokarmianie,
 * 5 rafinacja, 7 zrzut), zakres prędkości wypływu [j./s], temperatury, promienia plamy i udział `dym`.
 * WTOPIENIE: 60–90 j./s po normalnej + prędkość powierzchni kuli ω · R (przy rafinacji ω = 0,9 rad/s) — stąd górna
 * granica 350; pojedyncze ziarna wtapiają się też pod koniec topienia (brama otwiera się 2,4 s przed jego końcem)
 * i tuż po wejściu w rafinację (ostatnie ziarna w locie).
 */
export const GAZ_RODZAJE = Object.freeze([
  Object.freeze({ id: 0, nazwa: 'dym kupy', fazy: Object.freeze([2, 3]), speed: Object.freeze([30, 45]), temp: Object.freeze([0.35, 0.55]), radius: Object.freeze([40, 40]), dym: 0.85 }),
  Object.freeze({ id: 1, nazwa: 'wyrzut z kupy', fazy: Object.freeze([3]), speed: Object.freeze([120, 180]), temp: Object.freeze([0.75, 0.75]), radius: Object.freeze([30, 30]), dym: 0.5 }),
  Object.freeze({ id: 2, nazwa: 'wtopienie', fazy: Object.freeze([3, 4, 5]), speed: Object.freeze([60, 350]), temp: Object.freeze([0.8, 0.8]), radius: Object.freeze([45, 45]), dym: 0.3 }),
  Object.freeze({ id: 3, nazwa: 'bąbel', fazy: Object.freeze([4, 5, 6, 7]), speed: Object.freeze([150, 220]), temp: Object.freeze([0.95, 0.95]), radius: Object.freeze([18, 40]), dym: 0.15 }),
  Object.freeze({ id: 4, nazwa: 'opary ssawy', fazy: Object.freeze([5]), speed: Object.freeze([40, 40]), temp: Object.freeze([0.7, 0.7]), radius: Object.freeze([30, 30]), dym: 0.6 }),
  Object.freeze({ id: 5, nazwa: 'kłąb uderzenia', fazy: Object.freeze([7]), speed: Object.freeze([300, 380]), temp: Object.freeze([0.9, 0.9]), radius: Object.freeze([60, 60]), dym: 0.25 })
]);

/**
 * Liczby procesu gazu (wspólne dla metali; ile gazu daje ziarno — `metale.js`: `split[2]`).
 *   airShare       gaz wtapianego ziarna od razu do komory (rekord WTOPIENIE); reszta rozpuszcza się w kąpieli
 *   bathTau        kąpiel oddaje rozpuszczony gaz bąblami z czasem [s] (ponad rezerwy)
 *   bubbleT        bąbel [t]: najmniejszy, największy; `bubbleTopT` — największy na górnej półkuli
 *   bubbleZones    progi losowania strefy bąbla: pas ±`bandLat` (70 %), górna półkula poza czapą (20 %), dolna (10 %)
 *   bubbleBusy     slot bąbla zajęty po wypuszczeniu [s] (strumień 0,1 s, potem kłąb)
 *   suckShare      rezerwa kąpieli na opary ssawy [udział gazu obiegu] — wydawana proporcjonalnie do ściągniętego żużla
 *   impactShare    najmniejsza rezerwa na kłąb uderzenia [udział gazu obiegu]; przy uderzeniu wychodzi CAŁA kąpiel
 *   clearShare, clearTau   rezerwa kąpieli oddawana bąblami w ODSUWIE i w zrzucie do włączenia grawitacji [udział
 *                  gazu obiegu] z czasem [s] — gorąca mgiełka przy przymkniętych okapach (drugi znak grawitacji)
 *   heapSmoke      dym kupy: udział gazu ziaren kupy (zaliczka spłacana przy wchłonięciu ziarna); `heapBurst` — wyrzuty
 *   heapHeatFull   średni żar kupy, przy którym dym kupy jest wydany w całości (żar rośnie od stref pod cewkami)
 *   burstT, burstTime   wyrzut z kupy: porcja [t] i czas wypływu [s]
 *   impactTime     kłąb uderzenia: czas wypływu od zetknięcia [s]
 *   airTau0, airTauG    odciąg: czas pobytu gazu w komorze przy 0 g (okapy dolne ssą) i przy grawitacji (pierścień
 *                  górny ssie 2 × Q₀) [s]; `ventRamp` — przełączenie wentylacji razem z grawitacją [s]
 *   ductDelay, ductBuckets   rura zbiorcza: droga gazu od studni do separatora [s], przedziały kolejki
 *   tanks, tankTons, tankDrain   zbiorniki tlenu: liczba, pojemność [t], oddanie pełnego zbiornika do sieci ringu [s]
 *   hoodTau, hoodMin, hoodFull   żaluzje okapów: czas ruchu [s], otwarcie najmniejsze, gaz w komorze [t] przy pełnym;
 *                  `hoodHold` — otwarcie przed zrzutem (odsuw): poniżej `hoodMin` odciąg 0 g dławiony proporcjonalnie
 *   flowTau        wygładzenie wskaźników przepływu [s]
 *   pulse*         CYKL ODCIĄGU W DOKARMIANIU (runda 6, „zasysanie gazu” — słowa użytkownika: „bardzo dużo gazu i po
 *                  chwili mocno zassany do wentylatorów, żeby było widoczne zasysanie”): od początku dokarmiania okres
 *                  `pulsePeriod` [s] = NARASTANIE `pulseHold` [s] (żaluzje przymknięte do `pulseHood`, odciąg 0 g
 *                  dławiony do `pulseIdle` × zwykły — gaz zbiera się przy ścianach i wokół kuli) → CIĄG (żaluzje
 *                  otwarte, odciąg × `pulseDraw` — okapy wciągają komorę, czas pobytu `airTau0` / `pulseDraw`).
 *                  `pulseTau` — wygładzenie siły ciągu [s] (żaluzje i wentylatory nie skaczą). Dwa pełne okresy mieszczą
 *                  się w dokarmianiu (~24,5 s) i kończą ciągiem; poza dokarmianiem odciąg jak w rundzie 5 (ciąg 1).
 *                  Gaz i tlen bez zmian w sumie — zmienia się tylko tempo odciągu (bilans 0 po każdym kroku).
 *                  Ciąg na końcu dokarmiania zostawia w rafinacji mniej gazu, więc rezerwa odsuwu `clearShare`
 *                  wzrosła 0,035 → 0,044: gaz w komorze w chwili włączenia grawitacji (wstęga po ścianach) jest taki
 *                  jak w rundzie 5 (stal ~3,8–4,0 t, miedź ~1,9–2,0 t).
 */
export const GAZ_PROCES = Object.freeze({
  airShare: 0.6, bathTau: 5,
  bubbleT: Object.freeze([0.125, 0.5]), bubbleTopT: 0.125, bubbleZones: Object.freeze([0.7, 0.9]), bandLat: 40, bubbleBusy: 0.12,
  suckShare: 0.04, impactShare: 0.06, clearShare: 0.044, clearTau: 1.2,
  heapSmoke: 0.5, heapBurst: 0.5, heapHeatFull: 0.8, burstT: 0.25, burstTime: 0.3,
  impactTime: 0.5,
  airTau0: 7, airTauG: 2.5, ventRamp: 0.3,
  ductDelay: 3, ductBuckets: 60,
  tanks: 3, tankTons: 40, tankDrain: 4,
  hoodTau: 0.8, hoodMin: 0.3, hoodFull: 8, hoodHold: 0.06,
  flowTau: 0.35,
  pulsePeriod: 12, pulseHold: 7, pulseIdle: 0.1, pulseDraw: 4, pulseHood: 0.1, pulseTau: 0.5
});

/**
 * Faza cyklu odciągu w chwili `t` od początku dokarmiania: 1 — narastanie, 2 — ciąg (lustro `komora.js`; poza
 * dokarmianiem cyklu nie ma — 0).
 */
export function gazPulsePhase(t) {
  const P = GAZ_PROCES;
  if (!(t >= 0)) return 0;
  return t % P.pulsePeriod < P.pulseHold ? 1 : 2;
}

/**
 * Z siły ciągu `draw` (mnożnik odciągu 0 g: `pulseIdle` … 1 … `pulseDraw`) → `out` = [narastanie 0…1, ciąg 0…1]
 * (pole gazu i regulator masy czytają obie wielkości z jednej liczby wejścia).
 */
export function gazPulseOf(draw, out) {
  const P = GAZ_PROCES;
  const d = draw > 0 ? draw : 1;
  out[0] = d < 1 ? Math.min(1, (1 - d) / (1 - P.pulseIdle)) : 0;
  out[1] = d > 1 ? Math.min(1, (d - 1) / (P.pulseDraw - 1)) : 0;
  return out;
}

// ===========================================================================
// POLE GAZU (runda 5, etapy 3–6) — stałe, układ wejścia i LUSTRA CPU kerneli (`gazSiatka.js`).
//
// Gaz komory to ośrodek nieściśliwy na siatce kartezjańskiej 3D (komórka sześcienna) z trzema skalarami: `dym` (pył
// i para z rudy — ciężkie drobiny), `opar` (opary metalu i tlen — lekka mgiełka) i `T` (nadwyżka temperatury 0…1).
// Gęstość pola: tony gazu na 10⁶ j.³, prędkość: j./s. Pole jest tylko OBRAZEM — nie wraca do symulacji komory.
// Wszystko, co niżej, jest czyste (bez three i DOM): kernele GPU liczą te same wzory w TSL, a test porównuje znaki
// i bilanse z tymi lustrami oraz sprawdza fizykę małym krokiem CPU (`createGazCpu`).

/** Domena pola w układzie komory (x, z w planie; y w górę) i presety jakości (`?gazJakosc=0…2`). */
export const GAZ = Object.freeze({
  x0: -528, y0: -716, z0: -528, size: 1056,
  /** ściana studni (lico 32-kąta ≈ 515,5) i błona pola nad studnią; stożek leja i gardziel — z `geometria.js` */
  wallR: 516, ceilY: 400,
  /**
   * presety: siatka (x × y × z), komórka [j.], iteracje Jacobiego (nieparzyste — wynik w `prsB`), kroki marszu obrazu,
   * przenikanie dwóch stanów obrazu, kroki cienia promienistego w kernelu obrazu (0 — bez cienia).
   * Liczby komórek są wielokrotnościami 64 (grupy wątków three r183).
   * SKALARY NA SIATCE GĘSTSZEJ (runda 5, poprawki — wada „wata”): dym, opar, T i obraz gazu leżą na siatce `snx × sny ×
   * snz` o komórce `scell` (ta sama domena), prędkość i ciśnienie zostają na siatce `nx × ny × nz`. Skalary niesie
   * pole prędkości próbkowane trójliniowo — brzegi kłębów i strugi wyostrzają się z przepływu (bez szumu na gęstości),
   * a koszt rośnie tylko w kernelach skalarów i obrazu.
   */
  presets: Object.freeze([
    Object.freeze({ id: 0, nazwa: 'oszczędny', nx: 48, ny: 52, nz: 48, cell: 22, snx: 72, sny: 78, snz: 72, scell: 1056 / 72, jacobi: 9, march: 18, blend: false, shadow: 0 }),
    Object.freeze({ id: 1, nazwa: 'zwykły', nx: 64, ny: 68, nz: 64, cell: 16.5, snx: 128, sny: 136, snz: 128, scell: 8.25, jacobi: 11, march: 40, blend: true, shadow: 5 }),
    Object.freeze({ id: 2, nazwa: 'wysoki', nx: 96, ny: 104, nz: 96, cell: 11, snx: 144, sny: 156, snz: 144, scell: 1056 / 144, jacobi: 17, march: 52, blend: true, shadow: 8 })
  ])
});

/**
 * Liczby fizyki pola (wspólne dla presetów — jednostki świata, nie komórek).
 *   swirl*      WIR POLA 0 g: składowa obwodowa relaksuje do v_θ(ρ) = `swirlV` · ρ / `swirlR` (ρ < `swirlR`), dalej
 *               · (`swirlR` / ρ)^`swirlPow`; tempo `swirlRate` [1/s] × `pole` (obieg szewronów wyświetlacza)
 *   buoyT, buoyDym   WYPÓR przy grawitacji: a_y = grav · (`buoyT` · T − `buoyDym` · dym) [j./s²]
 *   drag, dragQ      opór: 1/s + 1/j. · |v| (bez oporu Jacobi o małej liczbie iteracji nie domyka rzutu)
 *   vMax        sufit prędkości [j./s]
 *   coil*       cewki jako strefa porowata: tłumienie [1/s] w torusie o grubości `coilThick` komórek (nie cieńszym niż rura)
 *   tauDym, tauOpar, driftMax   DRYF ODŚRODKOWY drobin: u_r = min(`driftMax`, τ · v_θ² / ρ) — wir działa jak cyklon
 *   coolTau, coolWall, wallBand  stygnięcie T [s] w głębi i przy ścianie (pas `wallBand` j. od ściany)
 *   decay       zanik podstawowy dymu i oparów [1/s] (dym nie wisi, gdy liczby symulacji mówią zero)
 *   mass*       REGULATOR MASY (`gazKrok.js`): co `massEvery` kroków odczyt masy pola; gdy pole trzyma więcej gazu niż
 *               `massBand` × liczba symulacji (gaz w komorze; nie mniej niż `massFloor` t), dochodzi zanik
 *               `massGain` · (pole / symulacja − `massBand`) [1/s], najwyżej `massMax`. Adwekcja półlagranżowska
 *               z korektą MacCormacka nie zachowuje masy w silnie rozbieżnym przepływie (strugi nawiewu, upusty,
 *               kłąb uderzenia) — regulator trzyma obraz przy liczbach bilansu; gdy pole ma mniej gazu niż
 *               symulacja, przymyka zanik podstawowy (upusty i obmywanie bryły pracują dalej)
 *   mac, macDiv korekta MacCormacka skalarów (1 — włączona; 0 — sama adwekcja półlagranżowska) — tylko tam, gdzie
 *               |dt · div v| < `macDiv` (w polu rozbieżnym korekta dorabia masę)
 *   undil       próbka skalarów z pominięciem komórek stałych (zdjęcie rozcieńczenia przy ścianach)
 *   thinOn, thinLo   zachowanie masy w polu rozbieżnym: gęstość × 1 / (1 + clamp(dt · div v, thinLo, 1))
 *   soft        miękki rzut (tłumi niezgodność bilansu objętości w zamkniętej komorze)
 *   vort        wzmacnianie wirów (siła ∝ komórka · |ω|; trzyma zawirowania, które zjada adwekcja półlagranżowska)
 *   turb, turbT MIESZANIE OŚRODKA: pole sił o zerowej dywergencji (trzy skale, fazy płyną z czasem) w równaniu pędu —
 *               przyspieszenie [j./s²] × (1 + `turbT` · T): gorący gaz przy kąpieli jest burzliwy, zimny spokojny.
 *               Siatka o komórce kilkunastu jednostek sama nie rozwija turbulencji (lepkość numeryczna) — bez mieszania
 *               gaz płynie laminarnie i wygląda jak mgła. Gęstości nikt nie dotyka: kłęby rysuje sam przepływ.
 *               Mieszanie gaśnie z wysokością między `turbY0` a `turbY1` — pod błoną płynie spokojny nawiew, który
 *               trzyma czysty słup nad kulą (kamera z góry)
 *   q0          wydatek wentylacji 0 g [j.³/s] (wymiana komory w ~20 s); przy grawitacji okapy dmuchają `gravQ` × q0
 *   wash*       OBMYWANIE BRYŁY nawiewem (0 g): w strefie nad górną połową bryły (do `washR` j. od jej powierzchni)
 *               prędkość dociągana w tempie `washRate` [1/s] do opływu kuli strumieniem z góry o prędkości `washU`
 *               [j./s] (przepływ potencjalny: spływ nad biegunem, rozejście po górnej półkuli) — czysty gaz z pierścienia
 *               górnego trzyma słup nad bryłą wolny od dymu; kilkanaście iteracji Jacobiego samo nie zbuduje tego
 *               dalekiego przepływu z upustów; `washClear` [1/s] — czysty nawiew rozcieńcza gaz w tej strefie
 *   heatShell   KĄPIEL GRZEJE GAZ: w powłoce do `heatShell` promienia nad powierzchnią bryły T gazu nie spada poniżej
 *               temperatury bryły × (zanik z odległością) — czysty gorący gaz (widać go tylko drganiem powietrza);
 *               w 0 g spływa z nawiewem, po włączeniu grawitacji rusza w górę i porywa resztki dymu
 *   bell*       DZWON SSAWY żużla jako lokalny upust (ssawa ściąga czapę razem z jej oparami): w kuli `bellR` j. od wylotu
 *               skalary znikają w tempie `bellFlush` [1/s], w zasięgu `bellPull` j. prędkość dociągana ku wylotowi
 *               (`bellU` j./s na promieniu `bellR`, dalej ∝ 1 / d²; tempo dociągania `bellRate` [1/s])
 *   volPerTon   objętość, którą zajmuje tona świeżego gazu przy źródle [10⁶ j.³/t] — rozprężanie kłębu
 *   ventFlush   tempo czyszczenia skalarów w strefie upustu / nawiewu [1/s]
 *   srcMinCells najmniejszy promień plamy źródła [komórki] (mniejsza plama gubiłaby masę między komórkami)
 *   impulse     siła narzucenia prędkości wypływu w plamie źródła (0…1 na krok w środku plamy)
 *   kDym, kOpar tłumienie obrazu σ [1/j.] na jednostkę gęstości [t / 10⁶ j.³]
 *   pulse*      POLE W CYKLU ODCIĄGU (runda 6, `GAZ_PROCES.pulse*`; wejście `draw`): w CIĄGU zasięg dociągania okapów
 *               rośnie do `pulsePull` [j.], tempo dociągania × `pulseRate`, a prędkość ku wlotowi ma profil ujścia
 *               w warstwie grubości `pulseLayer` [j.] (∝ 1 / d² przy wlocie, ∝ 1 / d dalej — komora ogranicza przepływ
 *               do warstwy, więc daleko od wlotu prędkość maleje wolniej niż przy ujściu punktowym); strugi gazu
 *               zbiegają się do czterech wlotów. W NARASTANIU obmywanie bryły sięga tylko `pulseWash` [j.] poza kulę
 *               (gaz wolno zajść na brzeg kuli, środek tarczy zostaje czysty). W CIĄGU regulator masy toleruje
 *               `pulseBand` × więcej gazu w polu niż w liczbach symulacji (gaz ma DOPŁYNĄĆ do okapów, nie zgasnąć
 *               w miejscu, gdy symulacja liczy szybki odciąg). `pulseLook` — w cyklu pierścień widocznego gazu
 *               (look4) zaczyna się `pulseLook` [j.] od powierzchni kuli zamiast przy ścianie
 */
export const GAZ_FIZ = Object.freeze({
  swirlV: 90, swirlR: 300, swirlPow: 0.35, swirlRate: 0.5,
  buoyT: 2000, buoyDym: 60,
  drag: 0.25, dragQ: 0.0006, vMax: 600,
  coilDamp: 6, coilThick: 1.2,
  tauDym: 1.0, tauOpar: 0.3, driftMax: 40,
  coolTau: 6, coolWall: 2, wallBand: 60,
  decay: 0.05, massEvery: 12, massBand: 1.15, massGain: 1.5, massMax: 3, massFloor: 0.4,
  mac: 1, macDiv: 0.03, undil: 1, thinOn: 1, thinLo: 0,
  soft: 0.004,
  vort: 1.0,
  turb: 45, turbT: 3, turbY0: 120, turbY1: 300,
  q0: 3.3e7, gravQ: 2,
  washU: 55, washRate: 3, washR: 130, washClear: 3,
  bellR: 50, bellPull: 170, bellU: 260, bellRate: 9, bellFlush: 16,
  heatShell: 0.3,
  volPerTon: 3.0,
  ventFlush: 14,
  srcMinCells: 1.6,
  impulse: 0.85,
  kDym: 0.04, kOpar: 0.016,
  pulsePull: 650, pulseRate: 3, pulseLayer: 100, pulseWash: 25, pulseBand: 3, pulseLook: 30
});

/**
 * STREFY WENTYLACJI (geometria z `KOMORA.gaz`, tu liczby dla pola):
 *   ring   pierścień górny: pas komórek przy ścianie (grubość `thick` komórek) na wysokości `y` ± `half` (nie mniej
 *          niż 0,75 komórki) — w 0 g nawiewa czysty gaz ku osi, przy grawitacji ssie
 *   hood   cztery okapy dolne: środek wlotu (`rho`, `y`) na azymutach `KOMORA.gaz.hoods.az`, strefa = komórki gazu
 *          w kuli o promieniu `r` wokół środka wlotu (nie mniej niż 2,4 komórki); kierunek wlotu `nr`, `ny`
 *          (w górę i ku osi — normalna krawędzi wlotu); `pull` — zasięg dociągania prędkości do pola upustu [j.],
 *          `pullRate` — tempo dociągania [1/s]
 */
export const GAZ_WENT = Object.freeze({
  ring: Object.freeze({ y: 373, half: 21, thick: 1.5 }),
  hood: Object.freeze({ rho: 437.5, y: -65, r: 70, nr: -0.419, ny: 0.908, pull: 190, pullRate: 5 })
});

/** Przekrój okapu jako bryły stałej pola: promień wewnętrzny bryły na wysokości y (poza zakresem — brak bryły). */
export const GAZ_OKAP = Object.freeze({ yTop: -36, yRoof: -50, yMouth: -80, yLip: -100, yBottom: -153, rWall: 516, rRoof: 470, rMouth: 405, rLip: 401, halfDeg: 15 });

/**
 * UKŁAD WEJŚCIA KROKU (`Float32Array(GAZ_IN_N)`, pakuje `packGasInput` z `gazWejscie.js`; krok pola czyta tylko tę
 * tablicę — przy wpięciu w grę to blok migawki klatki):
 *   dt, pole (obieg szewronów 0…1), grav (0…1), wentyl (+1 tryb 0 g … −1 tryb grawitacji)
 *   body*    bryła w środku (kupa albo kula): środek, półosie (pozioma, pionowa), prędkość [j./s]; rx = 0 — brak;
 *            bodyOm — prędkość kątowa bryły wokół osi pionowej [rad/s] (powierzchnia: ω · (z, 0, −x) — ciągnie gaz);
 *            bodyT — temperatura bryły 0…1 (grzeje gaz przy swojej powierzchni: przy grawitacji ten gaz idzie w górę)
 *   cage*    cewki: środek klatki, promień pierścienia, wysokość osi segmentów (±)
 *   light*   światło bryły / masy w leju: środek, promień źródła, barwa × moc
 *   disp*    barwa × jasność wyświetlacza (światło robocze)
 *   qRing, qHood   wydatek wentylacji [j.³/s]: pierścień górny i okapy razem (+ nawiew, − ssanie); qSrc — objętość źródeł
 *   metal, gasAirT (gaz w komorze wg symulacji [t]), emitT (gaz wydany w tym kroku [t]), time, bubble (pobudzenie)
 *   bell*    dzwon ssawy żużla (płaszczyzna z = 0): wylot x, y; bellOn 0…1 — ssawa ściąga (lokalny upust oparów)
 *   hood     drożność okapów 0…1 (żaluzje przymknięte przed zrzutem dławią upust — gaz zostaje przy ścianach)
 *   draw     siła ciągu odciągu 0 g (runda 6, cykl odciągu w dokarmianiu): mnożnik wydatku wentylacji — `pulseIdle`
 *            w narastaniu, `pulseDraw` w ciągu, 1 poza cyklem (`gazPulseOf` → narastanie, ciąg 0…1)
 *   hoodGlow jasność pasów światła w gardłach okapów 0…1 (ta sama liczba co pas w `odciag.js`: przepływ × ssanie ×
 *            otwarcie żaluzji) — pas oświetla gaz wciągany do wlotu (runda 6: strugi do okapów widać w ich świetle)
 *   lake     33 × (grubość masy nad wykładziną leja [j.], prędkość lustra [j./s]): [0] nad gardzielą, [1 + j] pierścień j
 *   src      32 × 12: x, y, z, promień | dx, dy, dz, prędkość | dym [t w kroku], opar [t w kroku], T, rodzaj
 */
export const GAZ_LAKE_N = 33;
export const GAZ_IN = Object.freeze({
  dt: 0, pole: 1, grav: 2, wentyl: 3,
  bodyX: 4, bodyY: 5, bodyZ: 6, bodyRx: 7, bodyRy: 8, bodyVx: 9, bodyVy: 10, bodyVz: 11,
  cageX: 12, cageY: 13, cageZ: 14, coilR: 15, coilY: 16,
  lightX: 17, lightY: 18, lightZ: 19, lightR: 20, lightCr: 21, lightCg: 22, lightCb: 23,
  dispR: 24, dispG: 25, dispB: 26,
  qRing: 27, qHood: 28, qSrc: 29,
  metal: 30, gasAirT: 31, emitT: 32, time: 33, bodyOm: 34, bellX: 35, bellY: 36, bellOn: 37, bodyT: 38, hood: 39,
  draw: 40, hoodGlow: 41,
  lake: 42,
  src: 42 + GAZ_LAKE_N * 2
});
export const GAZ_IN_N = GAZ_IN.src + GAZ_SLOTS * GAZ_STRIDE;
/** Barwa światła pasów w gardłach okapów (liniowa; kopia `OXY` z `odciag.js` — test pilnuje równości). */
export const GAZ_HOOD_LIGHT = Object.freeze([0.55, 0.78, 1.0]);
/** Środek pasa światła w gardle okapu: promień w planie, wysokość (gardło `KOMORA.gaz.hoods.throat` + 6). */
export const GAZ_HOOD_LAMP = Object.freeze({ rho: KOMORA.gaz.hoods.throat[0] - 2.5, y: KOMORA.gaz.hoods.throat[1] + 6 });
/** Pola rekordu źródła w wejściu. */
export const GAZ_SRC = Object.freeze({ x: 0, y: 1, z: 2, radius: 3, dx: 4, dy: 5, dz: 6, speed: 7, dym: 8, opar: 9, temp: 10, kind: 11 });

const DEG_ = Math.PI / 180;
const FUN_ = KOMORA.funnel;
/** Przyrost wysokości stożka leja na jednostkę promienia. */
export const GAZ_FLOOR_SLOPE = (FUN_.rimY - FUN_.throatY) / (FUN_.rimR - FUN_.throatR);
const DSP_ = KOMORA.display;
/** Lico wyświetlacza: dół pasa [y], góra [y], promień przy dole, przyrost promienia na jednostkę wysokości. */
export const GAZ_DISP = Object.freeze({ y0: DSP_.y - DSP_.half, y1: DSP_.y + DSP_.half, r0: DSP_.rIn, slope: (DSP_.rOut - DSP_.rIn) / (2 * DSP_.half) });
const HOOD_AZ = KOMORA.gaz.hoods.az.map((a) => a * DEG_);
/** Kierunki okapów w planie (cos, sin azymutu; azymut od +x ku +z). */
export const GAZ_HOOD_DIR = Object.freeze(HOOD_AZ.map((a) => Object.freeze([Math.cos(a), Math.sin(a)])));
export const GAZ_HOOD_COS = Math.cos(GAZ_OKAP.halfDeg * DEG_);
/** Pole masy w leju (`masa.js`): promień gardzieli i odstęp pierścieni. */
export const GAZ_MASA = Object.freeze({ r0: FUN_.throatR, dr: (KOMORA.pitR - FUN_.throatR) / 32 });

/** Dno komory dla pola: stożek leja, nad gardzielą — poziom gardzieli (gardziel jest dla gazu zamknięta). */
export function gazFloorCpu(rho) {
  return rho <= FUN_.throatR ? FUN_.throatY : FUN_.throatY + (rho - FUN_.throatR) * GAZ_FLOOR_SLOPE;
}

/** Promień wewnętrzny bryły okapu na wysokości y (lustro kernela prędkości). */
export function gazHoodRhoCpu(y) {
  const O = GAZ_OKAP;
  if (y >= O.yRoof) return O.rRoof + (y - O.yRoof) * (O.rWall - O.rRoof) / (O.yTop - O.yRoof);
  if (y >= O.yMouth) return O.rMouth + (y - O.yMouth) * (O.rRoof - O.rMouth) / (O.yRoof - O.yMouth);
  if (y >= O.yLip) return O.rLip + (y - O.yLip) * (O.rMouth - O.rLip) / (O.yMouth - O.yLip);
  return O.rLip + (O.yLip - y) * (O.rWall - O.rLip) / (O.yLip - O.yBottom);
}

/** Grubość masy w leju nad wykładziną na promieniu ρ (interpolacja po pierścieniach pola masy) i prędkość lustra → `out`. */
export function gazLakeCpu(rho, inp, out) {
  let a = (rho - GAZ_MASA.r0) / GAZ_MASA.dr + 0.5;
  if (a < 0) a = 0; else if (a > GAZ_LAKE_N - 1) a = GAZ_LAKE_N - 1;
  let i0 = Math.floor(a);
  if (i0 > GAZ_LAKE_N - 2) i0 = GAZ_LAKE_N - 2;
  const f = a - i0;
  const o = GAZ_IN.lake + i0 * 2;
  out[0] = inp[o] + (inp[o + 2] - inp[o]) * f;
  out[1] = inp[o + 1] + (inp[o + 3] - inp[o + 1]) * f;
  return out[0];
}

const lakeTmp = new Float64Array(2);
/**
 * KOMÓRKA STAŁA pola w punkcie komory (lustro kernela prędkości): ściana studni, błona nad studnią, dno-lej, pas
 * wyświetlacza (klin pod pochylonym licem), cztery okapy, bryła w środku (kupa / kula — elipsoida), masa w leju
 * (lustro z pola masy). `vel` (opcjonalnie) dostaje prędkość bryły [j./s]. `topY` — powyżej leży górna warstwa
 * komórek siatki (brzeg domeny, stała). Zwraca 1 / 0.
 */
export function gazSolidCpu(x, y, z, inp, vel = null, topY = GAZ.ceilY) {
  if (vel) { vel[0] = 0; vel[1] = 0; vel[2] = 0; }
  const rho = Math.sqrt(x * x + z * z);
  if (rho > GAZ.wallR || y > GAZ.ceilY || y > topY) return 1;
  const floor = gazFloorCpu(rho);
  if (y < floor) return 1;
  // wyświetlacz: klin między ścianą a pochylonym licem
  if (y > GAZ_DISP.y0 && y < GAZ_DISP.y1 && rho > GAZ_DISP.r0 + (y - GAZ_DISP.y0) * GAZ_DISP.slope) return 1;
  // okapy
  if (y > GAZ_OKAP.yBottom && y < GAZ_OKAP.yTop && rho > GAZ_OKAP.rLip && rho > gazHoodRhoCpu(y)) {
    for (let k = 0; k < GAZ_HOOD_DIR.length; k++) if (x * GAZ_HOOD_DIR[k][0] + z * GAZ_HOOD_DIR[k][1] > GAZ_HOOD_COS * rho) return 1;
  }
  // masa w leju
  const h = gazLakeCpu(rho, inp, lakeTmp);
  if (h > 0.5 && y < floor + h) {
    if (vel) vel[1] = lakeTmp[1];
    return 1;
  }
  // bryła w środku
  const rx = inp[GAZ_IN.bodyRx];
  if (rx > 0.5) {
    const ry = inp[GAZ_IN.bodyRy];
    const dx = (x - inp[GAZ_IN.bodyX]) / rx;
    const dy = (y - inp[GAZ_IN.bodyY]) / ry;
    const dz = (z - inp[GAZ_IN.bodyZ]) / rx;
    if (dx * dx + dy * dy + dz * dz < 1) {
      if (vel) {
        const om = inp[GAZ_IN.bodyOm];
        vel[0] = inp[GAZ_IN.bodyVx] + om * (z - inp[GAZ_IN.bodyZ]);
        vel[1] = inp[GAZ_IN.bodyVy];
        vel[2] = inp[GAZ_IN.bodyVz] - om * (x - inp[GAZ_IN.bodyX]);
      }
      return 1;
    }
  }
  return 0;
}

/**
 * WIR POLA: docelowa prędkość obwodowa [j./s] na promieniu ρ i kierunek styczny (tx, tz) w punkcie (x, z) — ten sam
 * zwrot co wir ziaren w `komora.js` (styczna (z, −x) / ρ: przeciwnie do wskazówek zegara na ekranie widoku z góry)
 * i obieg szewronów wyświetlacza. `out` = [tx, tz, v_θ].
 */
export function gazSwirlCpu(x, z, out) {
  const F = GAZ_FIZ;
  const rho = Math.sqrt(x * x + z * z);
  const r = rho > 1e-3 ? rho : 1e-3;
  out[0] = z / r;
  out[1] = -x / r;
  out[2] = rho < F.swirlR ? F.swirlV * rho / F.swirlR : F.swirlV * Math.pow(F.swirlR / rho, F.swirlPow);
  return out[2];
}

/**
 * OBMYWANIE BRYŁY (lustro kernela prędkości): prędkość docelowa `out` [vx, vy, vz] opływu bryły strumieniem z góry
 * i waga 0…1 strefy w punkcie (x, y, z). Bryła jak w wejściu (środek, półosie); opływ kuli w układzie, w którym
 * elipsoida jest kulą o promieniu półosi poziomej. Zwraca wagę (0 — poza strefą albo brak bryły).
 */
export function gazWashCpu(x, y, z, inp, out) {
  const F = GAZ_FIZ;
  const R = inp[GAZ_IN.bodyRx];
  out[0] = 0; out[1] = 0; out[2] = 0;
  if (!(R > 0.5)) return 0;
  const ky = R / Math.max(inp[GAZ_IN.bodyRy], 1);
  const dx = x - inp[GAZ_IN.bodyX];
  const dy = (y - inp[GAZ_IN.bodyY]) * ky;
  const dz = z - inp[GAZ_IN.bodyZ];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (r < 1) return 0;
  const k = R * R * R / (2 * r * r * r);
  const vr = -F.washU * dy / r;                      // V · r̂, V = (0, −U, 0)
  out[0] = -k * 3 * vr * dx / r;
  out[1] = -F.washU - k * (3 * vr * dy / r + F.washU);
  out[2] = -k * 3 * vr * dz / r;
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  return smooth(-0.2 * R, 0.2 * R, dy) * (1 - smooth(R + 0.5 * F.washR, R + F.washR, Math.sqrt(dx * dx + dz * dz))) * (r > R ? 1 : 0);
}

/** KĄPIEL GRZEJE GAZ (lustro kernela skalarów): najmniejsza T gazu w punkcie przy powierzchni bryły (0 — poza powłoką). */
export function gazBodyHeatCpu(x, y, z, inp) {
  const rx = inp[GAZ_IN.bodyRx];
  if (!(rx > 0.5)) return 0;
  const dx = (x - inp[GAZ_IN.bodyX]) / rx;
  const dy = (y - inp[GAZ_IN.bodyY]) / Math.max(inp[GAZ_IN.bodyRy], 1);
  const dz = (z - inp[GAZ_IN.bodyZ]) / rx;
  const t = Math.max(0, Math.min(1, (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) / GAZ_FIZ.heatShell));
  return inp[GAZ_IN.bodyT] * (1 - t * t * (3 - 2 * t));
}

/** WYPÓR: przyspieszenie pionowe [j./s²] gazu o nadwyżce temperatury T i gęstości dymu `dym` przy grawitacji `grav` 0…1. */
export function gazBuoyancyCpu(T, dym, grav) {
  return grav * (GAZ_FIZ.buoyT * T - GAZ_FIZ.buoyDym * dym);
}

/** DRYF ODŚRODKOWY drobin [j./s] na promieniu ρ przy prędkości obwodowej gazu vθ (τ — czas relaksacji drobiny). */
export function gazDriftCpu(vTheta, rho, tau) {
  const u = tau * vTheta * vTheta / (rho > 20 ? rho : 20);
  return u < GAZ_FIZ.driftMax ? u : GAZ_FIZ.driftMax;
}

/**
 * KSZTAŁT PLAMY ŹRÓDŁA: gęstość w odległości d od środka plamy o promieniu r, unormowana do całki 1 po objętości
 * [1 / j.³]: (1 − d² / r²)² · 105 / (32 π r³). Masa wstrzyknięta = jednostki rekordu.
 */
export function gazSourceShapeCpu(d, r) {
  if (!(d < r)) return 0;
  const q = 1 - d * d / (r * r);
  return q * q * 105 / (32 * Math.PI * r * r * r);
}

/**
 * WYDŁUŻENIE PLAMY ŹRÓDŁA wzdłuż wypływu (runda 5, poprawki — wada „wata”): plama jest elipsoidą obrotową o osi
 * wzdłuż kierunku wypływu, `s` razy dłuższą niż szeroką — gaz wychodzi z powierzchni smugą po normalnej, nie
 * okrągłą kuleczką. Indeks = rodzaj (`GAZ_RODZAJ`): dym kupy, wyrzut, wtopienie, bąbel (gejzer), opary ssawy, uderzenie.
 */
export const GAZ_SRC_STRETCH = Object.freeze([1.8, 2.4, 2.2, 2.8, 1.0, 1.5]);
/**
 * Mnożnik prędkości wypływu w POLU (rodzaj jak wyżej): gaz wtopień wylatuje z pasa równika dalej ku ścianie — wał
 * przy ścianie (pierścień K4), nie kłąb przy strudze ziaren; bąbel — krótki gejzer.
 */
export const GAZ_SRC_SPEED = Object.freeze([1.0, 1.0, 1.9, 1.6, 1.0, 1.0]);
/** Wydłużenie plamy rodzaju `kind` (spoza tabeli — 1). */
export const gazSourceStretch = (kind) => GAZ_SRC_STRETCH[kind | 0] || 1;

/**
 * Kształt plamy WYDŁUŻONEJ: (dx, dy, dz) — od środka plamy, (ux, uy, uz) — kierunek wypływu (jednostkowy), `r` —
 * promień poprzeczny, `s` — wydłużenie. Całka po objętości = 1 (elipsoida ma objętość `s` × kula).
 */
export function gazSourceStreakCpu(dx, dy, dz, ux, uy, uz, r, s) {
  const al = dx * ux + dy * uy + dz * uz;
  const e2 = dx * dx + dy * dy + dz * dz - al * al + al * al / (s * s);
  return gazSourceShapeCpu(Math.sqrt(Math.max(0, e2)), r) / s;
}

/**
 * ŚRODEK PLAMY ŹRÓDŁA w polu (rekord wejścia pod `o`, komórka `cell`) → `out` [x, y, z]; zwraca promień plamy.
 * Plama ma co najmniej `srcMinCells` komórek promienia, jej środek jest wysunięty o 0,55 półosi (promień × wydłużenie
 * rodzaju) wzdłuż wypływu
 * (gaz wychodzi z powierzchni bryły — plama leży w gazie), a gdy mimo to wypada w bryle środkowej (wtopienie w jądro
 * wewnątrz topionej kupy), jest wypchnięty po promieniu bryły tuż nad jej powierzchnię.
 */
export function gazSourceCenterCpu(inp, o, cell, out) {
  const r = Math.max(inp[o + GAZ_SRC.radius], GAZ_FIZ.srcMinCells * cell);
  // plama wydłużona wzdłuż wypływu: środek o 0,55 długości półosi od punktu na powierzchni
  const L = 0.55 * r * gazSourceStretch(inp[o + GAZ_SRC.kind]);
  let x = inp[o + GAZ_SRC.x] + inp[o + GAZ_SRC.dx] * L;
  let y = inp[o + GAZ_SRC.y] + inp[o + GAZ_SRC.dy] * L;
  let z = inp[o + GAZ_SRC.z] + inp[o + GAZ_SRC.dz] * L;
  const rx = inp[GAZ_IN.bodyRx];
  if (rx > 0.5) {
    const ry = Math.max(inp[GAZ_IN.bodyRy], 1);
    const dx = (x - inp[GAZ_IN.bodyX]) / rx;
    const dy = (y - inp[GAZ_IN.bodyY]) / ry;
    const dz = (z - inp[GAZ_IN.bodyZ]) / rx;
    const q = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (q < 1.06) {
      const k = q > 1e-3 ? 1.06 / q : 0;
      x = inp[GAZ_IN.bodyX] + (k ? dx * k : 1.06) * rx;
      y = inp[GAZ_IN.bodyY] + dy * k * ry;
      z = inp[GAZ_IN.bodyZ] + dz * k * rx;
    }
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return r;
}

/**
 * WENTYLACJA: wydatki [j.³/s] z trybu `wentyl` (+1 … −1) i objętości źródeł `qSrc` [j.³/s] — nawiew, odciąg i źródła
 * sumują się do zera (komora zamknięta, gaz nieściśliwy). 0 g: pierścień górny nawiewa q0, okapy ssą q0 + źródła;
 * grawitacja: okapy dmuchają `gravQ` · q0, pierścień ssie tyle + źródła. `out` = [qRing, qHood]. `draw` — siła ciągu
 * cyklu odciągu (mnożnik wydatku 0 g; nawiew rośnie i maleje razem z odciągiem — suma dalej zero).
 */
export function gazVentCpu(wentyl, qSrc, out, draw = 1) {
  const F = GAZ_FIZ;
  const w = wentyl > 1 ? 1 : wentyl < -1 ? -1 : wentyl;
  if (w >= 0) {
    out[0] = F.q0 * w * (draw > 0 ? draw : 1);
    out[1] = -(out[0] + qSrc);
  } else {
    out[1] = F.gravQ * F.q0 * -w;
    out[0] = -(out[1] + qSrc);
  }
  return out;
}

/** Połowa wysokości pasa pierścienia górnego dla komórki `cell` (pas ma co najmniej półtorej komórki). */
export const gazRingHalf = (cell) => Math.max(GAZ_WENT.ring.half, 0.75 * cell);
/** Promień strefy wlotu okapu dla komórki `cell`. */
export const gazHoodR = (cell) => Math.max(GAZ_WENT.hood.r, 2.4 * cell);

/** Strefa pierścienia górnego: 1, gdy punkt gazu leży w pasie nawiewu (komórka `cell`). */
export function gazRingZoneCpu(x, y, z, cell) {
  const rho = Math.sqrt(x * x + z * z);
  return rho > GAZ.wallR - GAZ_WENT.ring.thick * cell && rho <= GAZ.wallR && Math.abs(y - GAZ_WENT.ring.y) < gazRingHalf(cell) ? 1 : 0;
}

/** Strefa wlotu okapu: numer okapu 0…3, gdy punkt leży w kuli wokół środka wlotu; −1 — poza strefami. */
export function gazHoodZoneCpu(x, y, z, cell) {
  const Hd = GAZ_WENT.hood;
  const r = gazHoodR(cell);
  const dy = y - Hd.y;
  for (let k = 0; k < GAZ_HOOD_DIR.length; k++) {
    const dx = x - Hd.rho * GAZ_HOOD_DIR[k][0];
    const dz = z - Hd.rho * GAZ_HOOD_DIR[k][1];
    if (dx * dx + dy * dy + dz * dz < r * r) return k;
  }
  return -1;
}

const zoneZero = new Float32Array(GAZ_IN_N);
/**
 * Liczba komórek GAZU w strefach wentylacji dla siatki `P` (nx, ny, nz, cell) przy pustej komorze — strefy leżą poza
 * bryłami ruchomymi: { ring, hood } — z nich kernel dywergencji bierze źródło objętości na komórkę.
 */
export function gazZoneCells(P) {
  let ring = 0;
  let hood = 0;
  const topY = GAZ.y0 + (P.ny - 1) * P.cell;
  for (let k = 0; k < P.nz; k++) for (let j = 0; j < P.ny; j++) for (let i = 0; i < P.nx; i++) {
    const x = GAZ.x0 + (i + 0.5) * P.cell;
    const y = GAZ.y0 + (j + 0.5) * P.cell;
    const z = GAZ.z0 + (k + 0.5) * P.cell;
    if (gazSolidCpu(x, y, z, zoneZero, null, topY)) continue;
    if (gazRingZoneCpu(x, y, z, P.cell)) ring++;
    else if (gazHoodZoneCpu(x, y, z, P.cell) >= 0) hood++;
  }
  return { ring, hood };
}

/** Przesłona pionowa z grubości optycznej τ: 1 − e^(−τ). */
export const gazPrzeslonaCpu = (tau) => 1 - Math.exp(-tau);

/** Moc żaru z temperatury (jak `heatPower` w `wspolneTSL.js` / `heatPowerJs` w `obraz.js`). */
export function gazHeatPower(T) {
  const t = Math.max(0, Math.min(1.5, T));
  const s = Math.max(0, Math.min(1, (t - 0.12) / 0.24));
  return (Math.pow(t, 3.5) * 0.97 + 0.03) * s * s * (3 - 2 * s);
}

// ---------------------------------------------------------------------------
// MAŁY KROK CPU (testy fizyki na małej siatce): te same wzory i kolejność co kernele GPU. Pominięte (są tylko na GPU):
// wzmacnianie wirów, mieszanie ośrodka, cewki jako strefa porowata, dociąganie prędkości przy okapach i dzwonie ssawy.

/**
 * Pole gazu na CPU: siatka `nx × ny × nz` na domenie `GAZ` (komórka = `GAZ.size / nx`). `step(inp)` — jeden krok
 * z wejścia w układzie `GAZ_IN`; `stats()` — masy, środek masy, energia; `removed` — masa zabrana w strefach
 * wentylacji i przez zanik awaryjny [t]; `puff` — kłąb wstawiony wprost w pole. Do testów: nie optymalizowane.
 */
export function createGazCpu({ nx = 16, ny = 17, nz = 16, jacobi = 21, decay = GAZ_FIZ.decay, maccormack = true } = {}) {
  const F = GAZ_FIZ;
  const h = GAZ.size / nx;
  const N = nx * ny * nz;
  const topY = GAZ.y0 + (ny - 1) * h;
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const vel = [new Float32Array(N * 3), new Float32Array(N * 3)];      // A, B
  const den = [new Float32Array(N * 3), new Float32Array(N * 3), new Float32Array(N * 3)];   // dym, opar, T
  const vol = new Float32Array(N);
  const solid = new Uint8Array(N);
  const prs = [new Float32Array(N), new Float32Array(N)];
  const rhs = new Float32Array(N);
  const sv = new Float64Array(3);
  const sw = new Float64Array(3);
  const sc = new Float64Array(3);
  const removed = { hood: 0, ring: 0, decay: 0, solid: 0, wash: 0, bell: 0 };
  const zones = gazZoneCells({ nx, ny, nz, cell: h });
  const cellVol = h * h * h / 1e6;                  // [10⁶ j.³]
  const X = (i) => GAZ.x0 + (i + 0.5) * h;
  const Y = (j) => GAZ.y0 + (j + 0.5) * h;
  const Z = (k) => GAZ.z0 + (k + 0.5) * h;
  const clampI = (v, n) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
  const smp = new Float64Array(4);
  /** Próbka trójliniowa pola o `c` składowych w punkcie komory → `smp`; zwraca udział komórek stałych. */
  function sample(f, c, x, y, z) {
    const gx = (x - GAZ.x0) / h - 0.5;
    const gy = (y - GAZ.y0) / h - 0.5;
    const gz = (z - GAZ.z0) / h - 0.5;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const k0 = Math.floor(gz);
    const fx = gx - i0;
    const fy = gy - j0;
    const fz = gz - k0;
    smp[0] = smp[1] = smp[2] = 0;
    let ws = 0;
    for (let q = 0; q < 8; q++) {
      const a = q & 1;
      const b = (q >> 1) & 1;
      const d = q >> 2;
      const w = (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (d ? fz : 1 - fz);
      const id = idx(clampI(i0 + a, nx), clampI(j0 + b, ny), clampI(k0 + d, nz));
      if (solid[id]) ws += w;
      for (let m = 0; m < c; m++) smp[m] += w * f[id * c + m];
    }
    return ws;
  }
  function step(inp) {
    const dt = inp[GAZ_IN.dt] > 0 ? inp[GAZ_IN.dt] : 1 / 60;
    const pole = inp[GAZ_IN.pole];
    const grav = inp[GAZ_IN.grav];
    const vA = vel[0];
    const vB = vel[1];
    const dA = den[0];
    const dB = den[1];
    const dC = den[2];
    // 1. prędkość: bryły, adwekcja, siły
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      const s = gazSolidCpu(X(i), Y(j), Z(k), inp, sv, topY);
      solid[id] = s;
      if (s) { vB[id * 3] = sv[0]; vB[id * 3 + 1] = sv[1]; vB[id * 3 + 2] = sv[2]; }
    }
    const ringU = -inp[GAZ_IN.qRing] / (2 * Math.PI * GAZ.wallR * 2 * gazRingHalf(h));
    const kq = 1 - Math.exp(-F.ventFlush * dt);
    const kS = 1 - Math.exp(-F.swirlRate * pole * dt);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      if (solid[id]) continue;
      const x = X(i);
      const y = Y(j);
      const z = Z(k);
      const v0x = vA[id * 3];
      const v0y = vA[id * 3 + 1];
      const v0z = vA[id * 3 + 2];
      sample(vA, 3, x - 0.5 * dt * v0x, y - 0.5 * dt * v0y, z - 0.5 * dt * v0z);
      const mx = smp[0];
      const my = smp[1];
      const mz = smp[2];
      const ws = sample(vA, 3, x - dt * mx, y - dt * my, z - dt * mz);
      let vx = v0x;
      let vy = v0y;
      let vz = v0z;
      if (ws < 0.5) { const q = 1 / Math.max(1 - ws, 0.5); vx = smp[0] * q; vy = smp[1] * q; vz = smp[2] * q; }
      // wir pola
      gazSwirlCpu(x, z, sw);
      const vth = vx * sw[0] + vz * sw[1];
      vx += sw[0] * (sw[2] - vth) * kS;
      vz += sw[1] * (sw[2] - vth) * kS;
      // wypór
      vy += dt * gazBuoyancyCpu(dA[id * 3 + 2], dA[id * 3], grav);
      // obmywanie bryły nawiewem (tylko tryb 0 g)
      {
        const ww = gazWashCpu(x, y, z, inp, sv) * (1 - Math.exp(-F.washRate * dt)) * Math.max(0, Math.min(1, inp[GAZ_IN.wentyl]));
        if (ww > 0) { vx += (sv[0] - vx) * ww; vy += (sv[1] - vy) * ww; vz += (sv[2] - vz) * ww; }
      }
      // pierścień górny: prędkość nawiewu / ssania w pasie
      if (gazRingZoneCpu(x, y, z, h)) {
        const rho = Math.sqrt(x * x + z * z) || 1;
        vx += (ringU * x / rho - vx) * kq;
        vz += (ringU * z / rho - vz) * kq;
        vy += (0 - vy) * kq;
      }
      // źródła: narzucenie prędkości wypływu
      for (let q = 0; q < GAZ_SLOTS; q++) {
        const o = GAZ_IN.src + q * GAZ_STRIDE;
        const sp = inp[o + GAZ_SRC.speed];
        if (!(sp > 0) || !(inp[o + GAZ_SRC.radius] > 0)) continue;
        const r = gazSourceCenterCpu(inp, o, h, sc);
        const dx = x - sc[0];
        const dy = y - sc[1];
        const dz = z - sc[2];
        // plama wydłużona wzdłuż wypływu (lustro kernela prędkości)
        const st = gazSourceStretch(inp[o + GAZ_SRC.kind]);
        const al = dx * inp[o + GAZ_SRC.dx] + dy * inp[o + GAZ_SRC.dy] + dz * inp[o + GAZ_SRC.dz];
        const d2 = dx * dx + dy * dy + dz * dz - al * al + al * al / (st * st);
        if (d2 >= r * r) continue;
        const w = F.impulse * (1 - d2 / (r * r)) * (1 - d2 / (r * r));
        const spk = sp * (GAZ_SRC_SPEED[inp[o + GAZ_SRC.kind] | 0] || 1);
        vx += (inp[o + GAZ_SRC.dx] * spk - vx) * w;
        vy += (inp[o + GAZ_SRC.dy] * spk - vy) * w;
        vz += (inp[o + GAZ_SRC.dz] * spk - vz) * w;
      }
      // opór i sufit
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let kd = 1 / (1 + dt * (F.drag + F.dragQ * sp));
      if (sp * kd > F.vMax) kd = F.vMax / sp;
      vB[id * 3] = vx * kd;
      vB[id * 3 + 1] = vy * kd;
      vB[id * 3 + 2] = vz * kd;
    }
    // 2. skalary w przód: półlagranżowsko, dym z dryfem odśrodkowym
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      if (solid[id]) {
        removed.solid += (dA[id * 3] + dA[id * 3 + 1]) * cellVol;
        dB[id * 3] = dB[id * 3 + 1] = dB[id * 3 + 2] = 0;
        continue;
      }
      const x = X(i);
      const y = Y(j);
      const z = Z(k);
      const v0x = vA[id * 3];
      const v0y = vA[id * 3 + 1];
      const v0z = vA[id * 3 + 2];
      sample(vA, 3, x - 0.5 * dt * v0x, y - 0.5 * dt * v0y, z - 0.5 * dt * v0z);
      const mx = smp[0];
      const my = smp[1];
      const mz = smp[2];
      const ws = sample(dA, 3, x - dt * mx, y - dt * my, z - dt * mz);
      const q = 1 / Math.max(1 - ws, 0.5);
      dB[id * 3 + 1] = smp[1] * q;
      dB[id * 3 + 2] = smp[2] * q;
      gazSwirlCpu(x, z, sw);
      const rho = Math.sqrt(x * x + z * z) || 1;
      const ud = gazDriftCpu(mx * sw[0] + mz * sw[1], rho, F.tauDym);
      const wsD = sample(dA, 3, x - dt * (mx + ud * x / rho), y - dt * my, z - dt * (mz + ud * z / rho));
      dB[id * 3] = smp[0] / Math.max(1 - wsD, 0.5);
    }
    // 3. korekta MacCormacka z obcięciem, źródła, stygnięcie, zanik, strefy wentylacji
    let emit = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      vol[id] = 0;
      if (solid[id]) { dC[id * 3] = dC[id * 3 + 1] = dC[id * 3 + 2] = 0; continue; }
      const x = X(i);
      const y = Y(j);
      const z = Z(k);
      let a = dB[id * 3];
      let b = dB[id * 3 + 1];
      let T = dB[id * 3 + 2];
      if (maccormack) {
        const v0x = vA[id * 3];
        const v0y = vA[id * 3 + 1];
        const v0z = vA[id * 3 + 2];
        sample(vA, 3, x + 0.5 * dt * v0x, y + 0.5 * dt * v0y, z + 0.5 * dt * v0z);
        const ws = sample(dB, 3, x + dt * smp[0], y + dt * smp[1], z + dt * smp[2]);
        if (ws < 0.01) {
          const ca = a + 0.5 * (dA[id * 3] - smp[0]);
          const cb = b + 0.5 * (dA[id * 3 + 1] - smp[1]);
          const cT = T + 0.5 * (dA[id * 3 + 2] - smp[2]);
          // obcięcie do zakresu sąsiadów punktu wstecznego (bez nowych ekstremów)
          sample(vA, 3, x - 0.5 * dt * v0x, y - 0.5 * dt * v0y, z - 0.5 * dt * v0z);
          const i0 = Math.floor((x - dt * smp[0] - GAZ.x0) / h - 0.5);
          const j0 = Math.floor((y - dt * smp[1] - GAZ.y0) / h - 0.5);
          const k0 = Math.floor((z - dt * smp[2] - GAZ.z0) / h - 0.5);
          let lo0 = Infinity;
          let hi0 = -Infinity;
          let lo1 = Infinity;
          let hi1 = -Infinity;
          let lo2 = Infinity;
          let hi2 = -Infinity;
          for (let qq = 0; qq < 8; qq++) {
            const n = idx(clampI(i0 + (qq & 1), nx), clampI(j0 + ((qq >> 1) & 1), ny), clampI(k0 + (qq >> 2), nz));
            const p0 = dA[n * 3];
            const p1 = dA[n * 3 + 1];
            const p2 = dA[n * 3 + 2];
            if (p0 < lo0) lo0 = p0;
            if (p0 > hi0) hi0 = p0;
            if (p1 < lo1) lo1 = p1;
            if (p1 > hi1) hi1 = p1;
            if (p2 < lo2) lo2 = p2;
            if (p2 > hi2) hi2 = p2;
          }
          a = Math.min(hi0, Math.max(lo0, ca));
          b = Math.min(hi1, Math.max(lo1, cb));
          T = Math.min(hi2, Math.max(lo2, cT));
        }
      }
      // źródła (plama unormowana do masy rekordu)
      let srcA = 0;
      let srcB = 0;
      for (let q = 0; q < GAZ_SLOTS; q++) {
        const o = GAZ_IN.src + q * GAZ_STRIDE;
        const td = inp[o + GAZ_SRC.dym];
        const to = inp[o + GAZ_SRC.opar];
        if (!(td + to > 0)) continue;
        const r = gazSourceCenterCpu(inp, o, h, sc);
        const dx = x - sc[0];
        const dy = y - sc[1];
        const dz = z - sc[2];
        const sh = gazSourceStreakCpu(dx, dy, dz, inp[o + GAZ_SRC.dx], inp[o + GAZ_SRC.dy], inp[o + GAZ_SRC.dz], r, gazSourceStretch(inp[o + GAZ_SRC.kind])) * 1e6;
        if (!(sh > 0)) continue;
        const add = (td + to) * sh;
        T += (inp[o + GAZ_SRC.temp] - T) * (add / (add + a + b + srcA + srcB + 0.004));
        srcA += td * sh;
        srcB += to * sh;
        vol[id] += (td + to) * F.volPerTon * sh / dt;       // [1/s]
        emit += add * cellVol;
      }
      // zachowanie masy: adwekcja półlagranżowska nie rozrzedza gazu w polu rozbieżnym (źródła objętości, niedomknięty
      // rzut) — gęstość mnożona przez 1 / (1 + dt · div v) z prędkości, która niosła gaz
      {
        const xp = idx(clampI(i + 1, nx), j, k);
        const xm = idx(clampI(i - 1, nx), j, k);
        const yp = idx(i, clampI(j + 1, ny), k);
        const ym = idx(i, clampI(j - 1, ny), k);
        const zp = idx(i, j, clampI(k + 1, nz));
        const zm = idx(i, j, clampI(k - 1, nz));
        const dv = 0.5 * (vA[xp * 3] - vA[xm * 3] + vA[yp * 3 + 1] - vA[ym * 3 + 1] + vA[zp * 3 + 2] - vA[zm * 3 + 2]) / h;
        // (tylko rozrzedzanie: w polu zbieżnym — przy upustach i ścianach — gęstości nie zagęszczamy, tam gaz wychodzi)
        const thin = 1 / (1 + Math.max(0, Math.min(1, dv * dt)));
        a = a * thin + srcA;
        b = b * thin + srcB;
      }
      // stygnięcie, zanik awaryjny
      const rho = Math.sqrt(x * x + z * z);
      T *= Math.exp(-dt / (rho > GAZ.wallR - F.wallBand ? F.coolWall : F.coolTau));
      // kąpiel grzeje gaz przy powierzchni bryły
      T = Math.max(T, gazBodyHeatCpu(x, y, z, inp));
      const kz = Math.exp(-decay * dt);
      removed.decay += (a + b) * (1 - kz) * cellVol;
      a *= kz;
      b *= kz;
      // obmywanie bryły: czysty nawiew rozcieńcza gaz w strefie nad górną połową bryły (tryb 0 g)
      {
        const ww = gazWashCpu(x, y, z, inp, sv) * Math.max(0, Math.min(1, inp[GAZ_IN.wentyl]));
        if (ww > 0) { const kw = Math.exp(-F.washClear * ww * dt); removed.wash += (a + b) * (1 - kw) * cellVol; a *= kw; b *= kw; }
      }
      // dzwon ssawy: lokalny upust oparów
      if (inp[GAZ_IN.bellOn] > 0) {
        const bx = x - inp[GAZ_IN.bellX];
        const by = y - inp[GAZ_IN.bellY];
        if (bx * bx + by * by + z * z < F.bellR * F.bellR) { const kb = Math.exp(-F.bellFlush * inp[GAZ_IN.bellOn] * dt); removed.bell += (a + b) * (1 - kb) * cellVol; a *= kb; b *= kb; }
      }
      // strefy wentylacji: gaz wychodzi (ssanie) albo jest czysty (nawiew)
      const rz = gazRingZoneCpu(x, y, z, h);
      const hz = rz ? -1 : gazHoodZoneCpu(x, y, z, h);
      if (hz >= 0 || rz) {
        // drożność okapów przy ssaniu (żaluzje przymknięte przed zrzutem; 0 — wejście bez pola: drożne)
        const hk = !rz && inp[GAZ_IN.qHood] < 0 && inp[GAZ_IN.hood] > 0 ? Math.min(1, inp[GAZ_IN.hood]) : 1;
        const active = Math.min(1, Math.abs(rz ? inp[GAZ_IN.qRing] : inp[GAZ_IN.qHood]) / (0.25 * F.q0)) * hk;
        const kf = Math.exp(-F.ventFlush * active * dt);
        if (rz) removed.ring += (a + b) * (1 - kf) * cellVol; else removed.hood += (a + b) * (1 - kf) * cellVol;
        a *= kf;
        b *= kf;
        T *= kf;
      }
      dC[id * 3] = a;
      dC[id * 3 + 1] = b;
      dC[id * 3 + 2] = T;
    }
    // 4. dywergencja z celem (× komórka): źródła objętości i strefy wentylacji; sąsiad stały oddaje prędkość bryły
    const ringS = zones.ring > 0 ? inp[GAZ_IN.qRing] / (zones.ring * h * h * h) : 0;
    const hoodS = zones.hood > 0 ? inp[GAZ_IN.qHood] / (zones.hood * h * h * h) : 0;
    const pA = prs[0];
    const pB = prs[1];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      if (solid[id]) { rhs[id] = 0; pA[id] = 0; continue; }
      const xp = idx(clampI(i + 1, nx), j, k);
      const xm = idx(clampI(i - 1, nx), j, k);
      const yp = idx(i, clampI(j + 1, ny), k);
      const ym = idx(i, clampI(j - 1, ny), k);
      const zp = idx(i, j, clampI(k + 1, nz));
      const zm = idx(i, j, clampI(k - 1, nz));
      const div = 0.5 * (vB[xp * 3] - vB[xm * 3] + vB[yp * 3 + 1] - vB[ym * 3 + 1] + vB[zp * 3 + 2] - vB[zm * 3 + 2]);
      let s = vol[id];
      if (gazRingZoneCpu(X(i), Y(j), Z(k), h)) s += ringS;
      else if (gazHoodZoneCpu(X(i), Y(j), Z(k), h) >= 0) s += hoodS;
      rhs[id] = div - s * h;
      pA[id] = pB[id];                 // rozgrzanie poprzednim krokiem
    }
    // 5. Jacobi (Neumann przy komórkach stałych, miękki rzut)
    let src = pA;
    let dst = pB;
    for (let it = 0; it < jacobi; it++) {
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const id = idx(i, j, k);
        if (solid[id]) { dst[id] = 0; continue; }
        const c = src[id];
        const nb = (n) => (solid[n] ? c : src[n]);
        const sum = nb(idx(clampI(i + 1, nx), j, k)) + nb(idx(clampI(i - 1, nx), j, k)) + nb(idx(i, clampI(j + 1, ny), k))
          + nb(idx(i, clampI(j - 1, ny), k)) + nb(idx(i, j, clampI(k + 1, nz))) + nb(idx(i, j, clampI(k - 1, nz)));
        dst[id] = (sum - rhs[id]) / (6 + F.soft);
      }
      const t = src;
      src = dst;
      dst = t;
    }
    if (src !== pB) pB.set(src);
    // 6. rzut: v −= ∇p; komórka stała — prędkość bryły; bez wnikania w ściany
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      if (solid[id]) { vA[id * 3] = vB[id * 3]; vA[id * 3 + 1] = vB[id * 3 + 1]; vA[id * 3 + 2] = vB[id * 3 + 2]; continue; }
      const c = pB[id];
      const xp = idx(clampI(i + 1, nx), j, k);
      const xm = idx(clampI(i - 1, nx), j, k);
      const yp = idx(i, clampI(j + 1, ny), k);
      const ym = idx(i, clampI(j - 1, ny), k);
      const zp = idx(i, j, clampI(k + 1, nz));
      const zm = idx(i, j, clampI(k - 1, nz));
      const nb = (n) => (solid[n] ? c : pB[n]);
      let vx = vB[id * 3] - 0.5 * (nb(xp) - nb(xm));
      let vy = vB[id * 3 + 1] - 0.5 * (nb(yp) - nb(ym));
      let vz = vB[id * 3 + 2] - 0.5 * (nb(zp) - nb(zm));
      if (solid[xp] && vx > vB[xp * 3]) vx = vB[xp * 3];
      if (solid[xm] && vx < vB[xm * 3]) vx = vB[xm * 3];
      if (solid[yp] && vy > vB[yp * 3 + 1]) vy = vB[yp * 3 + 1];
      if (solid[ym] && vy < vB[ym * 3 + 1]) vy = vB[ym * 3 + 1];
      if (solid[zp] && vz > vB[zp * 3 + 2]) vz = vB[zp * 3 + 2];
      if (solid[zm] && vz < vB[zm * 3 + 2]) vz = vB[zm * 3 + 2];
      vA[id * 3] = vx;
      vA[id * 3 + 1] = vy;
      vA[id * 3 + 2] = vz;
    }
    dA.set(dC);
    return emit;
  }
  /** Masy [t], środek masy gazu (dym + opar), średnia T ważona masą, energia ruchu na komórkę; `nan` — wartości nieskończone. */
  function stats() {
    const dA = den[0];
    let m = 0;
    let md = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let nan = 0;
    let tm = 0;
    let e = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = idx(i, j, k);
      const a = dA[id * 3];
      const b = dA[id * 3 + 1];
      const w = (a + b) * cellVol;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(dA[id * 3 + 2])) nan++;
      const vx = vel[0][id * 3];
      const vy = vel[0][id * 3 + 1];
      const vz = vel[0][id * 3 + 2];
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) nan++;
      e += vx * vx + vy * vy + vz * vz;
      m += w;
      md += a * cellVol;
      cx += w * X(i);
      cy += w * Y(j);
      cz += w * Z(k);
      tm += w * dA[id * 3 + 2];
    }
    const q = m > 0 ? 1 / m : 0;
    return { mass: m, dym: md, opar: m - md, cx: cx * q, cy: cy * q, cz: cz * q, temp: tm * q, nan, energy: e / N };
  }
  /** Kłąb wstawiony wprost w pole (testy): kula o promieniu r, gęstości [t / 10⁶ j.³] i temperatura. */
  function puff(x, y, z, r, dym, opar, T) {
    const dA = den[0];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const dx = X(i) - x;
      const dy = Y(j) - y;
      const dz = Z(k) - z;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        const id = idx(i, j, k);
        dA[id * 3] = dym;
        dA[id * 3 + 1] = opar;
        dA[id * 3 + 2] = T;
      }
    }
  }
  return { nx, ny, nz, cell: h, vel, den, solid, prs, removed, zones, step, stats, puff, idx, X, Y, Z };
}
