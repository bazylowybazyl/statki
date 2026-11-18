// HUTA — wytop: KOMORA (czysta symulacja, bez three i DOM; testy: tests/hutaWytop.test.mjs).
//
// CYKL v2 (uwaga użytkownika nr 3 w SPEC): rozruch z kupy rudy, wytop w kuli, zrzut grawitacyjny do leja. Jeden obieg:
//   PUSTA        komora pusta, generator 0 g pracuje (zegar `spin` idzie — światło krąży po liniach na ścianach),
//                maszyneria grzewcza odsunięta pod ściany; taśma podwozi wsad do bramy 0 g
//   ZBIERANIE    sama ruda: ziarna tracą ciężar na bramie, płyną w wirze pola do środka i PRZYLEGAJĄ do kupy przy
//                pierwszym styku, po czym zsuwają się po sąsiadach w głąb, póki się nie zaklinują — rośnie zimna,
//                ZWARTA, pełna od środka KUPA ZIAREN (soczewka; ciało sztywne: obraca się wolno, kołysze pod naporem
//                strugi); 1/3 wsadu
//   DOCISK       segmenty cewek dosuwają się do kupy, pole ją ściska (skala kupy maleje)
//   TOPIENIE     cewki grzeją: żar idzie od stref pod cewkami i od środka, w środku rośnie CIEKŁE JĄDRO (kula) —
//                wchłania ziarna od najbliższych środka; kupa zapada się na jądro, aż zostaje mała gorąca kula
//   DOKARMIANIE  reszta wsadu (2/3) wtapia się w kulę ziarno po ziarnie (fale, błyski, krople); w miejscach wtopień
//                zostają DROBINY ŻUŻLA — dryfują z powierzchnią i zlewają się w wyspy; cewki odsuwają się z promieniem kuli
//   RAFINACJA    kula wiruje szybciej: wyspy spływają na GÓRNY biegun w jedną czapę; ssawa zjeżdża nad czapę i ściąga
//                ją lepką nitką do odbieralnika (granulki) — aż kula jest CZYSTA; grzanie do temperatury zrzutu
//   ODSUW        cewki odjeżdżają pod ściany (kulę trzyma jeszcze pole 0 g) — dopiero przy czystej kuli
//   ZRZUT        WYŚWIETLACZ GRAWITACJI (pas ekranów na ścianie): szewrony biegnące po obwodzie STAJĄ, obracają się
//                grotem w dół i zaczynają płynąć w dół — dopiero wtedy `grav` = 1 i po `dropDelay` kula SPADA do leja
//                (całe dno komory): w locie wydłuża się w osi spadku i drga; od zetknięcia ze stożkiem jest JEDNĄ
//                MASĄ cieczy w polu grubości na stożku leja (`masa.js`: płytka woda z lepkością na siatce biegunowej):
//                kula cała staje się polem z pędem opadania, masa rozpłaszcza się, jej brzeg wjeżdża fałdą po
//                ścianach, cofa się, środek odbija garbem, masa przelewa się i uspokaja; żadnych osobnych brył —
//                tylko drobne krople z czoła fałdy i z garbu (wracają do masy). Potem gardziel się otwiera: przez
//                cały spływ ZASYSA (obrót pola przy gardzieli — `vortex`, wgłębienie `dimple` z pola, głębsze przy
//                płytszym jeziorze); lej stygnie; grawitacja wyłączona, szewrony stają, obracają się z powrotem
//                i ruszają po obwodzie → PUSTA
//
// MASY (runda 5: trzy strumienie — ruda = metal + żużel + GAZ) — liczby całkowite w JEDNOSTKACH po 1/1536 t (ziarno
// rudy 1/128 t = 12 jednostek; podział ziarna `metale.js`: `split` = [metal, żużel, gaz], stal 8 / 2 / 2, miedź 8 / 3 / 1).
// ŻUŻEL liczy się w PORCJACH: porcja = żużel jednego ziarna (`split[1]` jednostek). Wyspy, nitka, granulki i liczniki
// żużla trzymają porcje, a wygląd i ruch wysp liczą z masy-EKWIWALENTU porcje / `SLAG_EQ_PER_TON` [t] — tej samej co
// przed rundą 5, gdy żużel był 1/3 rudy (kąt wysp i czapy, ssawa, granulki, promień kuli bez zmian). Kula ma objętość
// metalu + `SLAG_VOL` jednostek na porcję (żużel jest lżejszy od metalu: stal 2 jednostki masy na 4 objętości).
// Bilans dokładny w jednostkach:
//   12 · podane = metal kuli + split[1] · żużel (wyspy na kuli + nitka i rurociąg + granulki w odbieralniku + wywiezione)
//                + krople + metal w leju (pole masy) + metal oddany gardzielą + 12 · (taśma + lot + kupa)
//                + gaz (kąpiel + komora + rura + zbiorniki + oddany do sieci) − zaliczka gazu kupy
// Zaliczka: dym i wyrzuty z grzanej kupy wychodzą z ziaren, zanim jądro je wchłonie — ziarno w kupie liczy się dalej
// po 12, a wydany przed czasem gaz jest zaliczką (`gasAdvance`) spłacaną przy wchłonięciu ziarna.
// `audit()` liczy bilans z samych puli (nie z liczników) i zwraca 0.
//
// STYK pod późniejsze wpięcie: `feed(n, cechy)` — ziarna z końca taśmy poprzedniego elementu wchodzą na taśmę komory
// (w demie podaje je wbudowany podajnik: `feeder: true`); `acceptsFeed` — czy taśma komory jedzie (brama 0 g otwarta);
// `onReady` — zdarzenie gotowości do zrzutu (raz na obieg; przy `auto: false` komora czeka na `tap()`); `counters`
// (`delivered` — metal oddany gardzielą), `view` (tablice typowane).
// Losowość: mulberry32 z ziarna — dwa przebiegi z jednego ziarna są identyczne (`hash()`).
//
// KROK NIE ALOKUJE: żadna liczba zmiennoprzecinkowa nie przechodzi przez argument ani wynik funkcji wewnętrznej
// (wywołanie, którego kompilator nie wkleił, pakuje ją na stercie) — idą przez tablice `X` (stan wewnętrzny, w tym
// długość podkroku) i `D` (brudnopis: kierunek, punkt, siła).
import { GRAIN, traitFromHash } from '../ruda/rudy.js';
import { KOMORA, VORTEX, createMeltTrack } from './geometria.js';
import { BALL, HMAX, MODES, kickModesInto, modeEnergyInto, stepModesInto, surfaceOffsetInto } from './kula.js';
import { MASA, MASA_CELLS, MASA_STRIDE, MP, createFunnelField } from './masa.js';
import { metalOf } from './metale.js';
import { GAZ_PROCES, GAZ_RODZAJ, GAZ_RODZAJE, GAZ_REC, GAZ_SLOT, GAZ_SLOTS, GAZ_STRIDE } from './gaz.js';

export const UNITS_PER_TON = 1536;
export const GRAIN_UNITS = 12;
/** Porcji żużla (porcja = żużel jednego ziarna) na tonę-ekwiwalent wyglądu i ruchu wysp (dawne 1/384 t). */
export const SLAG_EQ_PER_TON = 384;
/** Objętość porcji żużla w kuli [jednostki objętości metalu]: metal ziarna + żużel ziarna = 8 + 4 = 12. */
export const SLAG_VOL = UNITS_PER_TON / SLAG_EQ_PER_TON;
const SUB = 1 / 120;
/** Wzmocnienie pobudzenia modów pędem ziaren: przy wsadzie niskie mody (l = 2) kołyszą bryłą o 4–6 % promienia. */
const KICK_GAIN = 1;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const R30 = 1 / 1073741824;

export const PHASE = Object.freeze({ EMPTY: 0, GATHER: 1, PRESS: 2, MELT: 3, FEED: 4, REFINE: 5, CLEAR: 6, DROP: 7 });
export const PHASE_NAMES = Object.freeze(['pusta', 'zbieranie', 'docisk', 'topienie', 'dokarmianie', 'rafinacja', 'odsuw', 'zrzut']);

/** Liczby procesu (wspólne dla wszystkich metali). */
export const PROCES = Object.freeze({
  chargeTons: 360,              // wsad obiegu [t rudy] (46 080 ziaren — ładownia jednego statku z elementu „ruda”)
  heapTons: 120,                // kupa rozruchowa: 1/3 wsadu
  heapFeedTime: 14,             // podawanie kupy na taśmę [s] (ok. 1 100 ziaren/s)
  feedTime: 24,                 // podawanie reszty wsadu [s] (1 280 ziaren/s — gruba struga, dwie–trzy warstwy na taśmie)
  emptyMin: 1.2,                // pusta komora: najkrócej [s] (potem brama 0 g przepuszcza ziarna)
  // kupa: styk ziaren w odległości `heapStick` (środek–środek), układanie `heapSettle` kroków ku środkowi, ziarna
  // nie bliżej niż `heapMin` × styk; pole obraca kupę z prędkością `heapOmega` (struga ją rozkręca: do `heapOmegaMax`)
  heapStick: 10.2, heapMin: 0.97, heapSettle: 46, heapLat0: -0.62, heapLat1: 0.58, heapOmega: 0.3, heapOmegaMax: 0.9,
  // obrys, w którym pole trzyma kupę: spłaszczona elipsoida (półosie w planie i w pionie przy pełnej kupie), rośnie
  // z liczbą ziaren; `heapLump` — nierówności obrysu (inne w każdym obiegu). Ziarno przylega tylko w obrysie.
  // (obrys na gęstość ok. 0,74 ziarna na 1000 j.³: ziarna zsuwają się w głąb i klinują — upakowanie 0,8–0,9 w jądrze)
  heapA: 206, heapB: 124, heapLump: 0.17, heapTight: 0.2,
  pressTime: 3.4, pressScale: 0.92,
  meltTime: 11, meltPre: 0.16, // topienie [s]; ułamek czasu na sam żar (zanim ruszy jądro)
  gateLead: 2.4,                // brama otwiera się tyle sekund przed końcem topienia (lot do kuli trwa dłużej)
  feedLead: 7.6,                // reszta wsadu wchodzi na taśmę tyle sekund przed końcem topienia
  refineMin: 4,                 // najkrótsza rafinacja [s]
  // żużel na kuli: wtopienie bliżej niż `slagJoin` [cięciwa] od brzegu wyspy zasila ją (dalej — nowa drobina; przy
  // topieniu kupy, pod ziarnami — `slagJoinMelt`: jądro wynurza się z kilkunastoma wyspami, nie z setką kropek);
  // promień rysowany dochodzi do promienia z masy w `slagRadTau`; kożuch stygnie w `slagCool` do `slagHeatFloor`;
  // (świeża drobina ma żar `slagHeatNew`); dryf ku biegunowi [rad/s]: `slagDrift0` (przy topieniu kupy, gdy pole miesza
  // jądro — `slagDriftMelt`) + `slagDrift1` × (ω / ω rafinacji)²; prądy powierzchni `slagWander`;
  // stykające się wyspy zbliżają się (`slagAttract` × promień lżejszej, zasięg `slagReach` × suma promieni ponad
  // styk) i lżejsza przelewa się w cięższą (`slagDrain` [1/s])
  slagJoin: 0.13, slagJoinMelt: 0.45, slagRadTau: 0.16, slagCool: 3.2, slagHeatFloor: 0.2, slagHeatNew: 0.9,
  slagDrift0: 0.021, slagDriftMelt: 0.3, slagDrift1: 0.3, slagWander: 0.07, slagAttract: 2.2, slagReach: 0.45, slagDrain: 3.0,
  // ssawa: rusza, gdy czapa zebrała `suckCapShare` żużla albo po `suckWait` s rafinacji; dojazd, powrót [s];
  // ściąganie `suckRate` [t/s]; strefa bieguna `suckZone` [cięciwa]; przy ściąganiu wyspy płyną ku biegunowi szybciej
  // o `suckPull` [rad/s]; nitka wyciąga się w `threadForm` s i rwie w `threadSnap` s
  suckWait: 5.5, suckCapShare: 0.75, suckApproach: 2.0, suckRetract: 1.8, suckRate: 14.4, suckZone: 0.5, suckPull: 0.5,
  threadForm: 0.5, threadSnap: 0.3,
  // odbieralnik: droga żużla nitką i rurociągiem [s], granulka [porcje] (stal 1/8 t) i jej promień, grawitacja koryta, stygnięcie
  // granulek [s], zsyp koryta w następnym obiegu: po `trayDumpAt` s zbierania, przez `trayDumpTime` s
  slagTransit: 2.2, granuleUnits: 96, granuleR: 6.8, trayGravity: 420, trayCool: 2.6, trayDumpAt: 4, trayDumpTime: 2.6, trayStep: 3.5,
  clearTime: 2.6,               // odsuw maszynerii [s]
  // zrzut: gdy szewrony wyświetlacza płyną już w dół (grawitacja włączona), kula wisi jeszcze `dropDelay`, potem
  // spada z przyspieszeniem `gravity`; pole puszcza ją nierówno — znos w planie do `dropDrift` [j./s] (kierunek
  // i wielkość z ziarna losowości: masa uderza niesymetrycznie i przelewa się z boku na bok). Od zetknięcia masa
  // żyje w polu grubości (`masa.js`). Gardziel otwiera się `drainDelay` po zetknięciu (masa zdążyła odbić garbem
  // w środku) i dochodzi do pełnego spływu `drainRate` [t/s] w `drainRamp`; resztki cienkiej warstwy ściekają co
  // najmniej `drainMin` [t/s]. Ciecz GĘSTNIEJE, stygnąc na wykładzinie: opór pola rośnie (`masa.js`: `dragLate`)
  // między `thickFrom` a `thickTo` s po zetknięciu — pierwsze odbicie (fałda, garb) jest żywe, potem masa szybko
  // się uspokaja
  dropDelay: 0.4, gravity: 520, dropDrift: 60, drainDelay: 2.7, drainRamp: 0.9, drainRate: 36, drainMin: 8, dropTail: 0.8,
  thickFrom: 1.6, thickTo: 3.4,
  // w locie kula wydłuża się w osi spadku o `fallStretch` (z drganiem `fallWobble` o częstości `fallHz`)
  fallStretch: 0.115, fallWobble: 0.03, fallHz: 1.7,
  // drobny rozprysk (nie więcej niż w wersji sprzed rundy 4): krople z czoła fałdy wjeżdżającej po ścianie (między
  // `crownFrom` a `crownTo` s po zetknięciu, tylko tam, gdzie czoło pędzi szybciej niż `crownSpeed`), kilka z garbu
  // odbicia w środku (gdy rośnie i stoi `jetRise` j. nad poziomem jeziora); iskry z obwodu styku
  crownDrops: 62, crownFrom: 0.1, crownTo: 0.42, crownSpeed: 110, jetDrops: 10, jetRise: 18, impactSparks: 90,
  prefeedAfter: 1.4,            // następna kupa wchodzi na taśmę tyle sekund po uderzeniu
  kick: 0.25,                   // sprzężenie pędu wtapianego ziarna z modami drgań (strojone niżej: KICK_GAIN)
  omegaIdle: 0.25, omegaRefine: 0.9,
  // kula rodzi się gorąca (jądro w grzanej kupie); wsad NIE studzi całej kuli do ciemnej wiśni: ziarno dochodzi do
  // kuli rozgrzane polem, cewki grzeją także przy dokarmianiu; chłód wsadu widać LOKALNIE (`STAN.chill`)
  tempMelt: 1.02, tempTap: 1.0, tempSet: 1.04, tempGrain: 0.44, heatCharge: 0.6,
  // kołysanie w polu (pęd strugi przesuwa kupę i kulę, pole ściąga je z powrotem)
  swayOmega: 2.6, swayGamma: 0.85, swayKick: 4, swayMax: 14,
  // pole: prędkość dośrodkowa ziaren `flowIn` + `flowInVar` · u [j./s], wir `flowSwirl` + `flowSwirlVar` · u [j./s]
  // na promieniu `flowRef` (bliżej osi szybciej: (flowRef / ρ)^0,35)
  // przy dużej kuli dośrodkowa maleje tak, żeby spirala od bramy 0 g do powierzchni trwała ok. `flowTime` s
  flowIn: 96, flowInVar: 26, flowSwirl: 250, flowSwirlVar: 46, flowRef: 400, flowTime: 2.5
});

/** Indeksy `view.stan` (Float64Array). */
export const STAN = Object.freeze({
  time: 0, phase: 1, phaseT: 2, cycle: 3, temp: 4, radius: 5, omega: 6, rot: 7, heat: 8, coilGlow: 9, radGlow: 10,
  feedLeft: 11, meltRate: 12,
  // ssawa żużla: stan (0 postój, 1 dojazd, 2 ściąganie, 3 powrót), czas w stanie, przepływ nitką [t/s], wózek (x kolana
  // szyi), wylot dzwonu (x, y w płaszczyźnie z = 0), narysowany odcinek nitki [thrLo, thrHi] drogi korzeń → dzwon
  suck: 13, suckT: 14, suckFlow: 15, headX: 16, mouthX: 17, mouthY: 18, thrLo: 19, thrHi: 20,
  mach: 21,                     // promień pierścienia segmentów cewek (rOut — odsunięte)
  gate: 22,                     // brama 0 g przepuszcza ziarna (0 / 1)
  capMass: 23,                  // żużel w strefie bieguna [porcje]
  beltTravel: 24, beltRun: 25, ready: 26,
  trayGlow: 27,                 // żar wylotu odbieralnika 0…1
  cycleTime: 28, cycleStart: 29, quadPhase: 30, boundaryFlux: 31, sucks: 32, energy: 33, waiting: 34,
  throat: 35,                   // żar gardzieli leja 0…1
  coneK: 36,                    // stożek wyciągany z czapy pod nitką 0…1
  tonsBall: 37,
  // przesunięcie środka kupy / kuli (kołysanie w polu; przy zrzucie — spadek), chłód strefy wsadu 0…1
  offX: 38, offY: 39, offZ: 40, chill: 41,
  grav: 42,                     // grawitacja w komorze włączona (0 / 1) — generator 0 g stoi
  pipeGlow: 43,                 // żużel płynie rurociągiem 0…1
  spin: 44,                     // zegar generatora 0 g [s] — idzie z obiegiem szewronów (staje razem z nimi)
  dspTurn: 45,                  // WYŚWIETLACZ: obrót szewronów 0…1 (0 — grot po obwodzie, 1 — grot w dół)
  heapN: 46, heapScale: 47, heapRot: 48, heapR: 49, heapOm: 50, heapHeat: 51, lodgeRate: 52,
  // zrzut: prędkość spadku, wydłużenie bryły w locie (pion, poziom), wlanie kuli w pole masy 0…1, poziom metalu
  // w leju z jego masy (lustro w spoczynku), najwyżej zwilżone miejsce ściany leja [y], żar ścian leja 0…1, czas od
  // zetknięcia (−1 — przed), czas od zwolnienia kuli (−1 — przed)
  fallV: 53, squash: 54, wide: 55, pool: 56, level: 57, levelMax: 58, funHeat: 59, impactT: 60, fallT: 61,
  tail: 71,                     // zrzut: zwężenie góry spadającej kuli („ogon”) 0…1
  dspSpeed: 62,                 // WYŚWIETLACZ: prędkość obiegu szewronów 0…1 (1 — generator 0 g pracuje)
  slagOn: 63,                   // żużel na kuli [t ekwiwalentu: porcje / `SLAG_EQ_PER_TON` — ta sama liczba dla każdego metalu]
  capAlpha: 64,                 // promień kątowy czapy [rad] (wyspa, pod którą leży biegun)
  clean: 65,                    // kula czysta 0…1 (po ściągnięciu żużla, do końca obiegu)
  trayDump: 66,                 // zsyp odbieralnika 0…1 (żaluzje dna otwarte)
  rootY: 67, apexY: 68,         // korzeń nitki (wierzch metalu na biegunie) i wierzchołek stożka czapy [y komory]
  islands: 69, trayN: 70,       // wysp żużla na kuli, granulek w korycie
  // WYŚWIETLACZ GRAWITACJI: tryb (`DSP`), czas w trybie [s], faza obiegu [komórki, narasta], faza spływu w dół
  // [komórki, narasta], prędkość spływu 0…1
  dsp: 72, dspT: 73, dspU: 74, dspV: 75, dspFlow: 76,
  // ZASYSANIE: siła wiru nad gardzielą 0…1 (obrót pola masy przy gardzieli), kąt skręcenia powierzchni [rad,
  // narasta], wgłębienie wiru [j.] (lustro w pierścieniu wokół gardzieli − lustro nad gardzielą, z pola)
  vortex: 77, twist: 78, dimple: 79,
  // MASA W LEJU (pole grubości, `masa.js`): fałda na ścianie studni — najwyższy punkt lustra przy ścianie [y],
  // lustro nad gardzielą [y], promień lustra w spoczynku [j.], kołysanie — prędkość średniokwadratowa cieczy [j./s],
  // najwyższy punkt lustra [y], największy promień zwilżony [j.], komórki z prześwitem pod nawisem kuli [szt.]
  foldY: 80, humpY: 81, lakeR: 82, slosh: 83, massTop: 84, frontR: 85, ballCols: 86,
  // MASZYNERIA: wysokość osi segmentów cewek nad / pod równikiem [j.] (`mach` — promień pierścienia w planie),
  // środek klatki cewek (idzie za kołysaniem bryły w polu) [88…90]
  machY: 87, cageX: 88, cageY: 89, cageZ: 90,
  // GAZ KOMORY (runda 5, `gaz.js`): wentylacja (+1 — tryb 0 g: okapy dolne ssą, pierścień górny nawiewa; −1 — tryb
  // grawitacji: pierścień górny ssie, okapy dmuchają; rampa `ventRamp` razem z `grav`), przepływ gazu z komory do
  // rury zbiorczej [t/s, wygładzony], gaz w komorze i w kąpieli [t], napełnienie zbiorników tlenu 0…1 [95…97],
  // opróżniany zbiornik (numer + postęp 0…1; −1 — żaden), napełniany zbiornik (numer), otwarcie żaluzji okapów 0…1,
  // faza impulsów światła w rurze [j. drogi, narasta tylko, gdy w rurze jest gaz], gaz w rurze [t], tlen oddany do
  // sieci ringu [t], tempo wydawania gazu do komory przez źródła [t/s, wygładzone], przepływ przez okapy [t/s]
  wentyl: 91, gasFlow: 92, gasAirT: 93, gasBathT: 94, tank0: 95, tank1: 96, tank2: 97, tankDrain: 98, tankFill: 99,
  hood: 100, pipeU: 101, ductT: 102, gasOutT: 103, gasEmit: 104, ductFlow: 105,
  // CYKL ODCIĄGU w dokarmianiu (runda 6, `GAZ_PROCES.pulse*`): siła ciągu (mnożnik odciągu 0 g, wygładzony; 1 — poza
  // cyklem), czas w cyklu [s] (−1 — poza cyklem)
  draw: 106, pulseT: 107
});
export const STAN_N = 112;
/** Tryby wyświetlacza grawitacji (`STAN.dsp`). */
export const DSP = Object.freeze({ RUN: 0, STOP: 1, HOLD: 2, TURN: 3, DOWN: 4, SETTLE: 5, BACK: 6 });
export const DSP_NAMES = Object.freeze(['obieg', 'hamowanie', 'postój', 'obrót w dół', 'w dół', 'wyhamowanie spływu', 'obrót powrotny']);

/**
 * Indeksy `counters` (Float64Array; liczby całkowite). Metal i gaz w jednostkach po 1/1536 t, żużel w PORCJACH (żużel
 * jednego ziarna = `split[1]` jednostek), ziarna w sztukach.
 */
export const LICZNIK = Object.freeze({
  fed: 0, belt: 1, flight: 2, metal: 3,
  // żużel [porcje]: nitka i rurociąg, wyspy na kuli, wywieziony z odbieralnika, granulki w odbieralniku
  slagThread: 4, slagFloes: 5, slagOut: 6, slagCatcher: 7, delivered: 8, drops: 9,
  melts: 10, cycles: 11, ready: 12, sucks: 13, sparks: 14, flashes: 15, ripples: 16, granules: 17, dropsMade: 18, floesMade: 19,
  heap: 20, funnel: 21, lodged: 22, absorbed: 23, impacts: 24,
  merges: 25,                   // zlania wysp (lżejsza przelała się w cięższą do zera)
  // GAZ [jednostki]: rozpuszczony w kąpieli, w komorze, w rurze zbiorczej, w zbiornikach tlenu, oddany do sieci ringu,
  // zaliczka (gaz wydany z ziaren kupy przed ich wchłonięciem); zdarzenia: bąble, wyrzuty z kupy
  gasBath: 26, gasAir: 27, gasDuct: 28, gasTank: 29, gasOut: 30, gasAdvance: 31, bubbles: 32, bursts: 33
});
export const LICZNIK_N = 34;

export const POOL = Object.freeze({ belt: 12288, flight: 12288, heap: 16384, floes: 96, granules: 640, drops: 320, sparks: 1536, flashes: 64, ripples: 32 });
/**
 * Rekord ziarna obrazu: cur xyz, prev xyz, kąt obrotu, cechy, żar, rodzaj (0 taśma, 1 lot, 2 kupa), ziarno osi,
 * głębokość w kupie 0…1 (0 — na wierzchu; poza kupą 0).
 */
export const GRAIN_STRIDE = 12;
/** Rekord wyspy żużla: kierunek xyz, promień kątowy rysowany | numer wyspy, żar kożucha 0…1, masa [t], wiek [s]. */
export const FLOE_STRIDE = 8;
/** Rekord granulki żużla: cur xyz, promień | prev xyz, żar 0…1 | numer, w locie (0 / 1), 0, 0. */
export const GRANULE_STRIDE = 12;
/** Rekord kropli / iskry: cur xyz, promień albo życie 0…1 | prev xyz, wiek kropli [s] albo 1. */
export const PART_STRIDE = 8;
/** Rekord zmarszczki / błysku: kierunek albo punkt xyz, czas narodzin | siła, 0, 0, 0. */
export const EVENT_STRIDE = 8;
/** Hasz 32-bitowy ze znakiem (mała liczba całkowita — bez alokacji). */
function hash32(n) {
  let t = (n + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) | 0;
}

// indeksy tablicy X (stan wewnętrzny zmiennoprzecinkowy)
const XH = 0;          // długość podkroku
const XFEED = 1;
const XSUCK = 2;       // ułamek jednostki ściąganej nitką
const XDRAIN = 3;      // ułamek jednostki spływu gardzielą
const XROW = 4;        // droga taśmy na początku bieżącego rzędu ziaren
const XGRAN = 5;       // żużel u wylotu odbieralnika, jeszcze nie w granulce [jedn.]
const XDUMP = 6;       // postęp zsypu koryta 0…1
const XFLOWT = 7;      // czas ciągłego ściągania [s] (rozbieg przepływu)
const XMX = 8;         // dzwon ssawy: pozycja robocza z bezwładnością napędu [8, 9]
const XMY = 9;
const XJOIN = 10;      // odstęp od brzegu wyspy [cięciwa], w którym wtopienie ją zasila (ustawia wołający `slagAtD`)
const XOV = 11;        // prędkość przesunięcia środka kupy / kuli [11, 12, 13]
const XFROM = 14;      // promień maszynerii na początku ruchu (docisk, odsuw)
const XS = 15;         // brudnopis gładkiego kroku
const XIDLE = 16;      // czas bez ziaren na taśmie i w locie [s] (podajnik zewnętrzny)
const XRATE = 17;      // tempo podajnika [ziaren/s]
const XHI = 18;        // moment bezwładności kupy: Σ r² ziaren
const XEMPTY = 19;     // czas od opróżnienia leja [s]
const XRIMP = 20;      // promień kuli w chwili uderzenia w lej
const XYC = 21;        // wysokość środka kuli w chwili zetknięcia z lejem
const XLODGE = 22;     // ziarna przyłączone do kupy w bieżącym podkroku
const XLODGE0 = 24;    // … w podkroku poprzednim
const XENV = 23;       // największy promień lokalny ziarna kupy
const XDT = 25;        // długość całego kroku (żar kupy liczony raz na krok)
const XENA = 28;       // półoś obrysu pola kupy w planie
const XENI = 29;
const XV0 = 32;        // zrzut: prędkość środka kuli w chwili zetknięcia z lejem [j./s]
const XVBX = 33;       // … znos kuli w planie [j./s] (33, 39)
const XM0 = 34;        // … metal kuli w chwili zetknięcia [jedn.]
const XCRN = 36;       // … krople z czoła fałdy: próby dotąd [szt.]
const XMOVED = 37;     // … metal przelany dotąd z kuli do leja [jedn.]
const XJET = 38;       // … krople z garbu odbicia już wyrzucone [szt.]
const XVBZ = 39;
const XMY0 = 40;       // wysokość osi segmentów cewek na początku ruchu (docisk, odsuw)
const XGT = 41;        // … czas od włączenia grawitacji [s]
const XDS0 = 42;       // wyświetlacz: prędkość obiegu na początku hamowania
const XSV0 = 43;       // … faza spływu na początku wyhamowania, faza docelowa (całkowita), czas wyhamowania [s]
const XSV1 = 44;
const XST = 45;
// gaz komory
const XG60 = 46;       // ułamek jednostki gazu wtopień idącej od razu do komory
const XGE0 = 47;       // dym kupy: wydanie planowane dotąd [jedn.]
const XGE1 = 48;       // wyrzuty z kupy: planowane dotąd [jedn.]
const XGS1 = 49;       // … porcje wyrzutów już rozpoczęte [jedn.]
const XGP0 = 50;       // postęp żaru kupy (największy dotąd) 0…1
const XGN0 = 51;       // ziaren w kupie na początku docisku
const XGBUB = 52;      // kąpiel: jednostki gotowe do wyjścia bąblem
const XGNEXT = 53;     // … wielkość następnego bąbla [jedn.], strefa (0 pas, 1 górna półkula, 2 dolna)
const XGZONE = 54;
const XGRES = 55;      // rezerwa kąpieli na opary ssawy, jeszcze niewydana [jedn.]
const XGSU = 56;       // … ułamek oparów ssawy
const XGIMP0 = 57;     // kłąb uderzenia: kąpiel w chwili zetknięcia [jedn.], wydane dotąd, obrót odcinków linii styku [rad]
const XGIMPA = 58;
const XGIMPR = 59;
const XGOUT = 60;      // ułamek jednostki odciągu (komora → rura)
const XGDRN = 61;      // ułamek jednostki opróżniania zbiornika
const XGDI = 62;       // numer ostatniego przedziału kolejki rury
const XGPH = 63;       // faza z poprzedniego kroku gazu
const XGEM = 64;       // jednostki wydane przez źródła w bieżącym podkroku
const XGOUTN = 65;     // … i odciągnięte z komory w bieżącym podkroku
const XGARR = 66;      // … i dostarczone rurą do zbiorników w bieżącym podkroku
const X_N = 72;
// indeksy brudnopisu D
const DN = 0;          // kierunek jednostkowy [0…2]
const DOFF = 3;        // wynik: odchylenie powierzchni
const DK = 4;          // siła impulsu modów / prędkość normalna
const DP = 5;          // punkt [5…7]
const DAMP = 8;        // siła zmarszczki / wielkość błysku
const DTH = 9;         // kąt południka
const DZ = 10;         // przesunięcie po z
const DAL = 11;        // wynik: promień kątowy wyspy żużla
const DW = 12;         // wynik: nadgarstek [12, 13]
const DL = 16;         // punkt w układzie kupy [16…18]
const DQ = 19;         // wynik: odległość do najbliższego ziarna kupy
const DT = 20;         // promień szukania sąsiada w kupie

// kupa: siatka sąsiedztwa (komórka = odległość styku), mapa obrysu po kierunkach (do głębokości ziarna w kupie)
const HG = 36;                    // połowa siatki [komórek]
const HN = HG * 2;
const HK = 4;                     // miejsc w komórce
const ENV_LAT = 12;
const ENV_LON = 24;
const SORT_BINS = 4096;

/**
 * @param {object} [o]
 * @param {number} [o.seed]     ziarno losowości
 * @param {number|string} [o.metal]  metal (tabela `METALE`) — zmienia tylko barwy i rudę; liczby procesu wspólne
 * @param {boolean} [o.auto]    true — po rafinacji komora sama zaczyna zrzut; false — czeka na `tap()`
 * @param {boolean} [o.feeder]  true — wbudowany podajnik wsadu (demo); false — ziarna przychodzą przez `feed()`
 * @param {boolean} [o.prewarm] true — rozbieg: strona startuje z cyklem w toku (kupa rudy w 2/3 usypana, struga płynie)
 * @param {object} [o.masa]     nadpisane liczby pola masy w leju (`masa.js`: `MASA`) — tylko do prób strojenia
 */
export function createMeltChamber({ seed = 7, metal = 0, auto = true, feeder = true, prewarm = false, masa = null } = {}) {
  const M = metalOf(metal);
  // podział ziarna [metal, żużel, gaz] w jednostkach (suma `GRAIN_UNITS`)
  const MU = M.split[0];
  const SLAG_U = M.split[1];
  const GU = M.split[2];
  if (MU + SLAG_U + GU !== GRAIN_UNITS) throw new Error(`wytop: podział ziarna ${M.id} nie sumuje się do ${GRAIN_UNITS}`);
  const { track, sBoundary } = createMeltTrack();
  const B = KOMORA.belt;
  /** Promień (w planie), na którym ziarna przekraczają granicę 0 g: koniec taśmy na płaszczyźnie `boundaryX`. */
  const GATE_RHO = Math.hypot(B.boundaryX, B.pts[B.pts.length - 1][2]);
  const SS = KOMORA.ssawa;
  const SLAG = KOMORA.slag;
  const TRAY = KOMORA.tray;
  const MACH = KOMORA.mach;
  const FUN = KOMORA.funnel;
  const chargeGrains = PROCES.chargeTons * GRAIN.perTon;
  const heapGrains = PROCES.heapTons * GRAIN.perTon;
  const heapFeedRate = heapGrains / PROCES.heapFeedTime;
  const mainFeedRate = (chargeGrains - heapGrains) / PROCES.feedTime;
  const suckUnitRate = PROCES.suckRate * SLAG_EQ_PER_TON;        // [porcje/s]
  const drainUnitRate = PROCES.drainRate * UNITS_PER_TON;
  // odbieralnik: siatka kopczyka (łuk × promień), pole pod wylotem, wylot w komorze
  const TA = TRAY.cellsA;
  const TR = TRAY.cellsR;
  const TRAY_PAD = 8;
  const TRAY_DA = (TRAY.az1 - TRAY.az0) / TA;
  const TRAY_DR = (TRAY.rOut - TRAY.rIn - 2 * TRAY_PAD) / TR;
  const SPOUT_A = Math.min(TA - 1, Math.max(0, Math.floor((TRAY.spoutAz - TRAY.az0) / TRAY_DA)));
  const SPOUT_R = Math.min(TR - 1, Math.max(0, Math.floor((TRAY.spoutR - TRAY.rIn - TRAY_PAD) / TRAY_DR)));
  const SPOUT_X = Math.cos(TRAY.spoutAz) * TRAY.spoutR;
  const SPOUT_Z = Math.sin(TRAY.spoutAz) * TRAY.spoutR;
  const HC = PROCES.heapStick;
  const HMIN = HC * PROCES.heapMin;
  const HSET = PROCES.heapSettle | 0;
  /** Metryka spłaszczonego obrysu kupy: (półoś w planie / półoś w pionie)². */
  const HFY = (PROCES.heapA / PROCES.heapB) * (PROCES.heapA / PROCES.heapB);
  const HSY = PROCES.heapA / PROCES.heapB;
  /** Nachylenie stożka leja: przyrost promienia na jednostkę wysokości. */
  const FSL = (FUN.rimR - FUN.throatR) / (FUN.rimY - FUN.throatY);
  /** Objętość kuli na jednostkę masy [j.³] (z prawa promienia `kula.js`). */
  const VOL_UNIT = 4 / 3 * Math.PI * BALL.rPerCbrtTon * BALL.rPerCbrtTon * BALL.rPerCbrtTon / UNITS_PER_TON;
  /** Normalna stożka leja (do wnętrza komory): składowa promieniowa (ku osi — ujemna) i pionowa. */
  const FNL = Math.sqrt(1 + FSL * FSL);
  const FNR = -1 / FNL;
  const FNY = FSL / FNL;
  const DSPK = KOMORA.display;
  // maszyneria: segmenty stoją na stałej SZEROKOŚCI KĄTOWEJ względem środka bryły (nad i pod równikiem)
  const MCOS = Math.cos(MACH.lat * DEG);
  const MSIN = Math.sin(MACH.lat * DEG);
  // kierunki segmentów cewek (do grzania kupy): jednostkowe
  const padDirs = new Float64Array((MACH.upper.length + MACH.lower.length) * 3);
  {
    let w = 0;
    for (const [list, sy] of [[MACH.upper, 1], [MACH.lower, -1]]) {
      for (const deg of list) {
        const a = deg * DEG;
        padDirs[w++] = Math.cos(a) * MCOS; padDirs[w++] = sy * MSIN; padDirs[w++] = Math.sin(a) * MCOS;
      }
    }
  }
  const NPAD = padDirs.length / 3;

  // --- losowość: mulberry32, stan w tablicy typowanej; wynik — liczba całkowita 30-bitowa -----------------------
  const rs = new Uint32Array(2);
  rs[0] = seed >>> 0;
  rs[1] = (Math.imul(seed | 0, 0x9E3779B1) ^ 0x5BD1E995) >>> 0;
  function rnd30() {
    rs[0] += 0x6D2B79F5;
    let t = rs[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 2) | 0;
  }
  /**
   * Osobny strumień losowości GAZU: źródła gazu nie zmieniają przebiegu reszty symulacji (ziarna, żużel, krople,
   * iskry i masa w leju idą tak samo jak bez gazu).
   */
  function rndG30() {
    rs[1] += 0x6D2B79F5;
    let t = rs[1];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 2) | 0;
  }

  // --- stan ---------------------------------------------------------------
  const S = new Float64Array(STAN_N);
  const Sprev = new Float64Array(STAN_N);
  const Cn = new Float64Array(LICZNIK_N);
  const X = new Float64Array(X_N);
  const D = new Float64Array(32);
  const DI = new Int32Array(2);
  const par = new Float64Array(4);
  const modeA = new Float64Array(MODES);
  const modeV = new Float64Array(MODES);
  const modeEq = new Float64Array(MODES);
  const modesOut = new Float32Array(MODES * 2);       // amplitudy teraz | amplitudy z początku kroku

  // taśma: kolejka (pierścień) — wszystkie ziarna jadą z tą samą prędkością, pierwsze weszło = pierwsze schodzi
  const NB = POOL.belt;
  const bS0 = new Float64Array(NB);                   // droga taśmy w chwili wejścia ziarna
  const bLat = new Float32Array(NB);
  const bH = new Float32Array(NB);
  const bTrait = new Uint8Array(NB);
  const bAng = new Float32Array(NB);
  const bHash = new Int32Array(NB);
  const bPos = new Float32Array(NB * 3);
  const bPrev = new Float32Array(NB * 3);
  const bFresh = new Uint8Array(NB);
  let bHead = 0;
  let nBelt = 0;
  let rowSlot = 0;
  let rowSeq = 0;

  // lot w 0 g
  const NF = POOL.flight;
  const fP = new Float32Array(NF * 3);
  const fPrev = new Float32Array(NF * 3);
  const fV = new Float32Array(NF * 3);
  const fHeat = new Float32Array(NF);
  const fAng = new Float32Array(NF);
  const fSpin = new Float32Array(NF);
  const fTrait = new Uint8Array(NF);
  const fHash = new Int32Array(NF);
  let nFlight = 0;

  // kupa ziaren: ciało sztywne (obrót wokół pionu `heapRot`, środek = przesunięcie pola, skala docisku `heapScale`).
  // Współrzędne ziaren LOKALNE; żywe ziarna to [hHead, nHeap) — przy topieniu tablice są posortowane po promieniu
  // i jądro wchłania je od czoła.
  const NH = POOL.heap;
  const hP = new Float32Array(NH * 3);
  const hW = new Float32Array(NH * 3);                // położenie w komorze (bieżące i poprzednie — dla obrazu)
  const hWp = new Float32Array(NH * 3);
  const hOff = new Float32Array(NH * 3);              // obraz: reszta drogi układania (ziarno dosuwa się na miejsce płynnie)
  const hR = new Float32Array(NH);
  const hHeat = new Float32Array(NH);
  const hAng = new Float32Array(NH);
  const hTrait = new Uint8Array(NH);
  const hHash = new Int32Array(NH);
  const hFresh = new Uint8Array(NH);
  const hGrid = new Int16Array(HN * HN * HN * HK);
  const hEnv = new Float32Array(ENV_LAT * ENV_LON);
  // brudnopisy sortowania (bez alokacji w kroku)
  const sCount = new Int32Array(SORT_BINS + 1);
  const sOrder = new Int32Array(NH);
  const tF3 = new Float32Array(NH * 3);
  const tF1 = new Float32Array(NH);
  const tI = new Int32Array(NH);
  const hBin = new Uint8Array(NH);                    // przedział mapy obrysu ziarna
  const lump = new Float64Array(20);                  // nierówności obrysu: kierunek xyz, siła (× 5)
  let nHeap = 0;
  let hHead = 0;
  let heapTotal = 0;                // ziaren w kupie na początku topienia
  let heapSorted = false;

  // wyspy żużla na kuli (drobiny, wyspy, czapa — jedna pula)
  const NK = POOL.floes;
  const kDir = new Float64Array(NK * 3);
  const kMass = new Int32Array(NK);
  const kRad = new Float64Array(NK);                  // promień kątowy RYSOWANY (dochodzi do promienia z masy)
  const kCh = new Float64Array(NK);                   // … jako cięciwa
  const kHeat = new Float64Array(NK);
  const kAge = new Float64Array(NK);
  const kAcc = new Float64Array(NK);                  // ułamek jednostki przelewanej w cięższą wyspę
  const kId = new Int32Array(NK);
  let nFloes = 0;
  let floeSeq = 0;
  let capI = -1;                    // czapa: najcięższa wyspa, pod którą leży biegun (−1 — brak)

  // nitka i rurociąg żużla: kolejka paczek w drodze do odbieralnika
  const NT = 512;
  const tUnits = new Int32Array(NT);
  const tBorn = new Float64Array(NT);
  let tHead = 0;
  let nThread = 0;

  // granulki żużla w odbieralniku (lot balistyczny z wylotu na swoje miejsce kopczyka, potem spoczynek)
  const NG = POOL.granules;
  const gP = new Float32Array(NG * 3);
  const gPrev = new Float32Array(NG * 3);
  const gP0 = new Float32Array(NG * 3);
  const gV0 = new Float32Array(NG * 3);
  const gTo = new Float32Array(NG * 3);
  const gT0 = new Float64Array(NG);
  const gTf = new Float32Array(NG);
  const gRad = new Float32Array(NG);
  const gMass = new Int32Array(NG);
  const gHeat = new Float32Array(NG);
  const gCol = new Uint8Array(NG);
  const gFly = new Uint8Array(NG);
  const gId = new Int32Array(NG);
  const trayH = new Float32Array(TA * TR);            // wysokość kopczyka w polu koryta [j.]
  let nGran = 0;
  let nFly = 0;
  let granSeq = 0;

  // krople (z masą) i iskry (bez masy)
  const ND = POOL.drops;
  const dP = new Float32Array(ND * 3);
  const dPrev = new Float32Array(ND * 3);
  const dV = new Float32Array(ND * 3);
  const dMass = new Int32Array(ND);
  const dAge = new Float32Array(ND);
  let nDrops = 0;
  const NQ = POOL.sparks;
  const qP = new Float32Array(NQ * 3);
  const qPrev = new Float32Array(NQ * 3);
  const qV = new Float32Array(NQ * 3);
  const qLife = new Float32Array(NQ);
  const qLife0 = new Float32Array(NQ);
  let nSparks = 0;

  // GAZ KOMORY: rekordy źródeł (stałe sloty), stan wyrzutów z kupy, kolejka rury zbiorczej, zbiorniki tlenu
  const GP = GAZ_PROCES;
  const GD = new Float64Array(16);                    // brudnopis rekordu: punkt [0…2], prędkość [3…5], T, promień, dym, rodzaj
  const gasRec = new Float32Array(GAZ_SLOTS * GAZ_STRIDE);
  const gasBusy = new Float64Array(GAZ_SLOTS);        // slot zajęty do chwili [s czasu symulacji]
  const NBURST = GAZ_SLOT.burstN;
  const burstRem = new Int32Array(NBURST);            // wyrzut z kupy: jednostki jeszcze do wypuszczenia
  const burstLeft = new Float64Array(NBURST);         // … czas wypływu, który został [s]
  const burstDir = new Float64Array(NBURST * 3);      // … kierunek w układzie kupy (obraca się z nią)
  const burstSpd = new Float64Array(NBURST);
  const heapAcc = new Float64Array(GAZ_SLOT.heapN);   // dym kupy: ułamek jednostki na punkt
  const heapW = new Float64Array(GAZ_SLOT.heapN);     // … waga punktu (bliskość segmentu cewki)
  const heapDir = new Float64Array(GAZ_SLOT.heapN * 3);
  for (let k = 0; k < GAZ_SLOT.heapN; k++) {
    // sześć punktów na powierzchni kupy w układzie kupy: co 60° w azymucie, na przemian nad i pod równikiem
    const a = (k / GAZ_SLOT.heapN) * TAU + 0.52;
    const lat = (k & 1 ? -1 : 1) * 28 * DEG;
    heapDir[k * 3] = Math.cos(a) * Math.cos(lat); heapDir[k * 3 + 1] = Math.sin(lat); heapDir[k * 3 + 2] = Math.sin(a) * Math.cos(lat);
  }
  const DUCT_N = GP.ductBuckets;
  const DUCT_DT = GP.ductDelay / DUCT_N;
  const ductRing = new Int32Array(DUCT_N);            // gaz w przedziałach rury (przedział = `DUCT_DT` s drogi)
  const NTANK = GP.tanks;
  const TANK_CAP = GP.tankTons * UNITS_PER_TON;
  const tank = new Int32Array(NTANK);
  const tankFull = new Uint8Array(NTANK);             // zbiornik pełny — czeka na opróżnienie albo jest opróżniany
  /** Gaz obiegu z receptury (wsad × gaz ziarna) [jedn.] — podstawa rezerw kąpieli. */
  const cycleGas = chargeGrains * GU;

  // MASA W LEJU: pole grubości cieczy na stożku leja (`masa.js`) — od zetknięcia kuli z lejem do końca spływu
  const field = createFunnelField(modeA, masa);
  const MCFG = masa ? { ...MASA, ...masa } : MASA;
  const FP = field.P;
  const FNA = field.na;
  /** Siła wiru 1 = średnia prędkość obwodowa cieczy przy wardze gardzieli równa prędkości nadawanej przez łopatki. */
  const VK_REF = field.rc[0] * field.rc[0] / (MCFG.swirlV * field.r0);

  // --- widok dla obrazu (tablice typowane; zapis na końcu kroku) -----------
  const view = {
    metal: M,
    stan: S,
    stanPrev: Sprev,
    counters: Cn,
    mody: modesOut,
    ziarna: new Float32Array((NB + NF + NH) * GRAIN_STRIDE),
    nZiarna: 0,
    nTasma: 0,
    nLot: 0,
    nKupa: 0,
    kry: new Float32Array(NK * FLOE_STRIDE),
    nKry: 0,
    granulki: new Float32Array(NG * GRANULE_STRIDE),
    nGranulki: 0,
    krople: new Float32Array(ND * PART_STRIDE),
    nKrople: 0,
    iskry: new Float32Array(NQ * PART_STRIDE),
    nIskry: 0,
    // masa w leju: rekord `MASA_STRIDE` na komórkę pola (grubość rysowana, ostygnięcie) — teraz i z początku kroku
    masa: new Float32Array(MASA_CELLS * MASA_STRIDE),
    masaPrev: new Float32Array(MASA_CELLS * MASA_STRIDE),
    masaOn: 0,
    blyski: new Float32Array(POOL.flashes * EVENT_STRIDE),
    zmarszczki: new Float32Array(POOL.ripples * EVENT_STRIDE),
    // GAZ: rekordy źródeł (`gaz.js`: `GAZ_REC`, sloty `GAZ_SLOT`; jednostki narastają do `takeGas`) i gaz w rurze
    // zbiorczej po przedziałach drogi [t]: [0] — wlot przy studni, [ductBuckets − 1] — przed separatorem
    gaz: gasRec,
    gazRura: new Float32Array(GAZ_PROCES.ductBuckets)
  };
  for (let i = 0; i < POOL.flashes; i++) view.blyski[i * EVENT_STRIDE + 3] = -100;
  for (let i = 0; i < POOL.ripples; i++) view.zmarszczki[i * EVENT_STRIDE + 3] = -100;
  let flashHead = 0;
  let rippleHead = 0;

  const _inp = new Float64Array(3);
  let meltsStep = 0;
  let meltSeq = 0;
  let grainSeq = 0;
  let tint = 0;
  let prefed = false;               // kupa następnego obiegu już podawana (od uderzenia kuli w lej)
  let mainFed = false;              // reszta wsadu tego obiegu już podawana (od końca topienia)
  let impacted = false;             // kula uderzyła w lej (zrzut)
  let released = false;             // kula zwolniona (spada)
  let absorbSeq = 0;
  let api = null;

  /** Kula w jednostkach OBJĘTOŚCI metalu (żużel lżejszy: `SLAG_VOL` na porcję) — promień, mieszanie temperatur, pęd. */
  const ballUnits = () => Cn[LICZNIK.metal] + SLAG_VOL * Cn[LICZNIK.slagFloes];

  /** Promień kuli z masy. Po uderzeniu w lej (zrzut) zostaje promień z chwili uderzenia — obraz rysuje nim kałużę. */
  function setRadius() {
    const t = (Cn[LICZNIK.metal] + SLAG_VOL * Cn[LICZNIK.slagFloes]) / UNITS_PER_TON;
    S[STAN.tonsBall] = t;
    if (impacted) return;
    S[STAN.radius] = t > 0 ? BALL.rPerCbrtTon * Math.cbrt(t) : 0;
  }

  /** Promień kątowy wyspy żużla o masie `units` [porcje] na kuli o bieżącym promieniu → D[DAL] (`geometria.slagAngle` z tonami-ekwiwalentem). */
  function alphaOf(units) {
    if (units <= 0) { D[DAL] = 0; return; }
    const R = S[STAN.radius] > 60 ? S[STAN.radius] : 60;
    const a = SLAG.angle * Math.pow(units / SLAG_EQ_PER_TON, SLAG.power) * (SLAG.refR / R);
    D[DAL] = a > SLAG.maxAngle ? SLAG.maxAngle : a;
  }

  /** Zmarszczka w kierunku D[0…2] o sile D[DAMP]. */
  function rippleD() {
    const o = rippleHead * EVENT_STRIDE;
    const R = view.zmarszczki;
    R[o] = D[DN]; R[o + 1] = D[DN + 1]; R[o + 2] = D[DN + 2]; R[o + 3] = S[STAN.time]; R[o + 4] = D[DAMP];
    rippleHead = (rippleHead + 1) % POOL.ripples;
    Cn[LICZNIK.ripples]++;
  }
  /** Błysk w punkcie D[5…7] o wielkości D[DAMP]. */
  function flashD() {
    const o = flashHead * EVENT_STRIDE;
    const F = view.blyski;
    F[o] = D[DP]; F[o + 1] = D[DP + 1]; F[o + 2] = D[DP + 2]; F[o + 3] = S[STAN.time]; F[o + 4] = D[DAMP];
    flashHead = (flashHead + 1) % POOL.flashes;
    Cn[LICZNIK.flashes]++;
  }

  // --- taśma ---------------------------------------------------------------
  const LANES = 17;
  const LANE_W = 6.2;
  const ROW = 6.4;
  /**
   * `n` ziaren wchodzi na początek taśmy komory (z końca taśmy poprzedniego elementu). `traits` — bajty cech
   * (format `ruda/rudy.js`), bez nich cechy z haszu. Zwraca liczbę przyjętych (pula taśmy ma 12 288 miejsc).
   */
  function feed(n, traits = null) {
    let taken = 0;
    const travel = S[STAN.beltTravel];
    for (let k = 0; k < n; k++) {
      if (nBelt >= NB) break;
      if (travel - X[XROW] >= ROW) { X[XROW] = travel; rowSlot = 0; rowSeq++; }
      const i = (bHead + nBelt) % NB;
      const hs = hash32(seed * 7919 + grainSeq++);
      // rząd: najpierw warstwa dolna (17 torów w kolejności z numeru rzędu), potem górna na szwach torów
      const slot = rowSlot++;
      const layer = Math.min(2, (slot / LANES) | 0);
      const lane = (slot * 7 + rowSeq * 5) % LANES;
      const lat = (lane - (LANES - 1) / 2 + (layer & 1 ? 0.5 : 0)) * LANE_W + (((hs >>> 20) & 255) / 255 - 0.5) * 1.6;
      bS0[i] = travel - (((hs >>> 12) & 255) / 255) * 1.2 - (slot % 3) * 2.0;
      bLat[i] = Math.max(-51, Math.min(51, lat));
      bH[i] = GRAIN.r + layer * GRAIN.layer + (((hs >>> 28) & 15) / 15) * 0.5;
      bTrait[i] = traits ? traits[k] : traitFromHash(hs, tint);
      bAng[i] = ((hs >>> 3) & 1023) / 1023 * TAU;
      bHash[i] = hs;
      bFresh[i] = 1;
      nBelt++;
      taken++;
    }
    Cn[LICZNIK.fed] += taken;
    Cn[LICZNIK.belt] = nBelt;
    return taken;
  }

  /** Ziarno z czoła taśmy przekracza granicę 0 g: staje się ciałem w polu cewek. */
  function release() {
    const i = bHead;
    bHead = (bHead + 1) % NB;
    nBelt--;
    if (nFlight >= NF) {
      // pula lotu pełna (nie zdarza się przy wsadzie z receptury): ziarno wtapia się od razu — bilans zostaje
      Cn[LICZNIK.metal] += MU; Cn[LICZNIK.melts]++;
      D[DN] = 0.872; D[DN + 1] = -0.07; D[DN + 2] = -0.484;
      X[XJOIN] = PROCES.slagJoin;
      slagAtD();
      gasMeltD();
      return;
    }
    const j = nFlight++;
    _inp[0] = S[STAN.beltTravel] - bS0[i]; _inp[1] = bLat[i]; _inp[2] = bH[i];
    track.pointFrom(_inp, fP, j * 3);
    fPrev[j * 3] = bFresh[i] ? fP[j * 3] : bPos[i * 3];
    fPrev[j * 3 + 1] = bFresh[i] ? fP[j * 3 + 1] : bPos[i * 3 + 1];
    fPrev[j * 3 + 2] = bFresh[i] ? fP[j * 3 + 2] : bPos[i * 3 + 2];
    const hs = bHash[i];
    fV[j * 3] = B.speed; fV[j * 3 + 1] = 0; fV[j * 3 + 2] = 0;
    fHeat[j] = 0;
    fAng[j] = bAng[i];
    fSpin[j] = (((hs >>> 9) & 255) / 255 - 0.5) * 7;
    fTrait[j] = bTrait[i];
    fHash[j] = hs;
  }

  // --- wtopienie ziarna ----------------------------------------------------
  /** Iskra z punktu D[5…7] w kierunku normalnej D[0…2]. */
  function sparkD() {
    if (nSparks >= NQ) return;
    const i = nSparks++;
    const a = i * 3;
    const nx = D[DN];
    const ny = D[DN + 1];
    const nz = D[DN + 2];
    const u1 = rnd30() * R30;
    const u2 = rnd30() * R30;
    const u3 = rnd30() * R30;
    // wektor styczny losowy
    let tx = ny * (u2 - 0.5) - nz * (u3 - 0.5);
    let ty = nz * (u1 - 0.5) - nx * (u2 - 0.5);
    let tz = nx * (u3 - 0.5) - ny * (u1 - 0.5);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const vo = 200 + 350 * u1;
    const vt = 80 + 215 * u2;
    qP[a] = D[DP]; qP[a + 1] = D[DP + 1]; qP[a + 2] = D[DP + 2];
    qPrev[a] = qP[a]; qPrev[a + 1] = qP[a + 1]; qPrev[a + 2] = qP[a + 2];
    qV[a] = nx * vo + tx * vt; qV[a + 1] = ny * vo + ty * vt; qV[a + 2] = nz * vo + tz * vt;
    qLife0[i] = 0.28 + 0.55 * u3 * u3;
    qLife[i] = qLife0[i];
    Cn[LICZNIK.sparks]++;
  }

  /** Kropla metalu odrywa się w punkcie D[5…7] (normalna D[0…2]); masa wyjęta z kuli wraca przy powrocie kropli. */
  function dropD(hs) {
    if (nDrops >= ND) return;
    const units = 4 * (2 + (((hs >>> 4) & 1023) % 6));       // 1/192–1/48 t
    if (Cn[LICZNIK.metal] - units < UNITS_PER_TON) return;
    const i = nDrops++;
    const a = i * 3;
    const nx = D[DN];
    const ny = D[DN + 1];
    const nz = D[DN + 2];
    const u1 = rnd30() * R30;
    const u2 = rnd30() * R30;
    let tx = ny * 0.6 - nz * (u2 - 0.5);
    let ty = nz * (u1 - 0.5) - nx * 0.6;
    let tz = nx * (u2 - 0.5) - ny * (u1 - 0.5);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const vo = 190 + 150 * u1;
    const vt = 40 + 90 * u2;
    dP[a] = D[DP] + nx * 4; dP[a + 1] = D[DP + 1] + ny * 4; dP[a + 2] = D[DP + 2] + nz * 4;
    dPrev[a] = dP[a]; dPrev[a + 1] = dP[a + 1]; dPrev[a + 2] = dP[a + 2];
    dV[a] = nx * vo + tx * vt; dV[a + 1] = ny * vo + ty * vt; dV[a + 2] = nz * vo + tz * vt;
    dMass[i] = units;
    dAge[i] = 0;
    Cn[LICZNIK.metal] -= units;
    Cn[LICZNIK.drops] += units;
    Cn[LICZNIK.dropsMade]++;
  }

  /** Usunięcie ziarna `j` z puli lotu (zamiana z ostatnim). */
  function dropFlight(j) {
    const l = --nFlight;
    if (j !== l) {
      const a = j * 3;
      const b = l * 3;
      fP[a] = fP[b]; fP[a + 1] = fP[b + 1]; fP[a + 2] = fP[b + 2];
      fPrev[a] = fPrev[b]; fPrev[a + 1] = fPrev[b + 1]; fPrev[a + 2] = fPrev[b + 2];
      fV[a] = fV[b]; fV[a + 1] = fV[b + 1]; fV[a + 2] = fV[b + 2];
      fHeat[j] = fHeat[l]; fAng[j] = fAng[l]; fSpin[j] = fSpin[l]; fTrait[j] = fTrait[l]; fHash[j] = fHash[l];
    }
  }

  /** Ziarno `j` wtapia się: normalna D[0…2], prędkość normalna D[DK], punkt styku D[5…7]. */
  function meltD(j) {
    let mu = Cn[LICZNIK.metal] + SLAG_VOL * Cn[LICZNIK.slagFloes];
    if (mu < UNITS_PER_TON) mu = UNITS_PER_TON;
    const vn = D[DK];
    const hs = fHash[j];
    // temperatura: mieszanie mas (ziarno wnosi chłód i ciepło topnienia)
    const tg = PROCES.tempGrain + 0.12 * fHeat[j];
    S[STAN.temp] = (S[STAN.temp] * mu + tg * GRAIN_UNITS) / (mu + GRAIN_UNITS);
    // pęd ziarna przesuwa kulę w polu (wraca sprężyną pola — `stepBody`)
    const kv = PROCES.swayKick * (GRAIN_UNITS / mu) * (vn > 260 ? 260 : vn < 20 ? 20 : vn);
    X[XOV] -= D[DN] * kv; X[XOV + 1] -= D[DN + 1] * kv; X[XOV + 2] -= D[DN + 2] * kv;
    Cn[LICZNIK.metal] += MU;
    X[XJOIN] = PROCES.slagJoin;
    slagAtD();                                         // żużel ziarna zostaje drobiną w miejscu wtopienia
    gasMeltD();                                        // gaz ziarna: część od razu do komory, reszta do kąpieli
    Cn[LICZNIK.melts]++;
    meltsStep++;
    // pęd ziarna pobudza mody (uderzenie wgniata powierzchnię: znak ujemny)
    if (S[STAN.radius] > 20) {
      D[DK] = -PROCES.kick * KICK_GAIN * (GRAIN_UNITS / mu) * (vn > 260 ? 260 : vn < 20 ? 20 : vn) / S[STAN.radius];
      kickModesInto(modeV, D);
    }
    const q = meltSeq++;
    if (q % 60 === 0) { D[DAMP] = 0.6 + 0.4 * (((hs >>> 5) & 255) / 255); rippleD(); }
    if (q % 8 === 0) { D[DAMP] = 7 + 7 * (((hs >>> 13) & 255) / 255); flashD(); }
    if (q % 4 === 0) sparkD();
    if (q % 52 === 0) dropD(hs);
    dropFlight(j);
  }

  // --- kupa ziaren ------------------------------------------------------------
  /** Najbliższe ziarno kupy w promieniu D[DT] (≤ komórka siatki) od punktu lokalnego D[DL…] → DI[0] (−1 — brak), odległość D[DQ]. */
  function nearQ() {
    const lx = D[DL];
    const ly = D[DL + 1];
    const lz = D[DL + 2];
    const cx = (Math.floor(lx / HC) | 0) + HG;
    const cy = (Math.floor(ly / HC) | 0) + HG;
    const cz = (Math.floor(lz / HC) | 0) + HG;
    let best = -1;
    let bd = D[DT] * D[DT];
    if (cx >= 1 && cy >= 1 && cz >= 1 && cx <= HN - 2 && cy <= HN - 2 && cz <= HN - 2) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const o = (((cz + dz) * HN + cy + dy) * HN + cx + dx) * HK;
            for (let k = 0; k < HK; k++) {
              const id = hGrid[o + k];
              if (id === 0) break;
              const a = (id - 1) * 3;
              const ex = hP[a] - lx;
              const ey = hP[a + 1] - ly;
              const ez = hP[a + 2] - lz;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 < bd) { bd = d2; best = id - 1; }
            }
          }
        }
      }
    }
    DI[0] = best;
    D[DQ] = Math.sqrt(bd);
  }

  /**
   * Mapa obrysu kupy liczy w METRYCE SPŁASZCZONEGO OBRYSU (y × `HSY`): bryła jest soczewką, w tej metryce — kulą,
   * więc „kierunek od środka” dzieli jej powierzchnię równo i głębokość ziarna pod powierzchnią wychodzi poprawnie
   * także na płaskim wierzchu i spodzie. `hMet(i)` — promień ziarna w tej metryce.
   */
  function hMet(i) {
    const b = i * 3;
    return Math.sqrt(hP[b] * hP[b] + HFY * hP[b + 1] * hP[b + 1] + hP[b + 2] * hP[b + 2]);
  }
  /** Przedział mapy obrysu dla ziarna kupy `i` (kierunek od środka kupy w metryce obrysu). */
  function envBin(i) {
    const b = i * 3;
    const rm = hMet(i);
    const r = rm > 1e-3 ? rm : 1e-3;
    let la = ((HSY * hP[b + 1] / r * 0.5 + 0.5) * ENV_LAT) | 0;
    if (la < 0) la = 0; else if (la >= ENV_LAT) la = ENV_LAT - 1;
    let lo = ((Math.atan2(hP[b + 2], hP[b]) / TAU + 0.5) * ENV_LON) | 0;
    if (lo < 0) lo = 0; else if (lo >= ENV_LON) lo = ENV_LON - 1;
    return la * ENV_LON + lo;
  }

  /**
   * Ziarno lotu `j` przylega do kupy: punkt lokalny D[DL…], sąsiad DI[0] w odległości D[DQ] (−1 — zarodek kupy).
   * Zostaje tam, gdzie doleciało; lekko się układa: toczy się po sąsiedzie ku środkowi, póki nie oprze się o następne.
   */
  function lodge(j) {
    if (nHeap >= NH) return;                // pula kupy pełna: ziarno krąży przy kupie do początku topienia
    const a3 = j * 3;
    let lx = D[DL];
    let ly = D[DL + 1];
    let lz = D[DL + 2];
    const nb = DI[0];
    if (nb >= 0) {
      const want = HC;
      let d = D[DQ];
      if (d > HC) {
        // DOSUNIĘCIE: ziarno dolatuje do najbliższego sąsiada na styk
        const b = nb * 3;
        const k = want / d;
        lx = hP[b] + (lx - hP[b]) * k; ly = hP[b + 1] + (ly - hP[b + 1]) * k; lz = hP[b + 2] + (lz - hP[b + 2]) * k;
        D[DL] = lx; D[DL + 1] = ly; D[DL + 2] = lz; D[DT] = HC;
        nearQ();
        d = D[DQ];
      }
      // STYK: ziarno zatrzymuje się w odległości styku od sąsiada, którego dotknęło (twarde bryłki — nie wchodzą w siebie).
      // Ziarna w locie nie zderzają się ze sobą, więc dwa mogą dolecieć w to samo miejsce: ziarno, które weszłoby
      // w innego sąsiada, odsuwa się od niego; gdy miejsca nie ma, zostaje w locie wypchnięte na zewnątrz kupy
      for (let q = 0; q < 4 && DI[0] >= 0 && d < HMIN; q++) {
        const b = DI[0] * 3;
        let ex = lx - hP[b];
        let ey = ly - hP[b + 1];
        let ez = lz - hP[b + 2];
        if (d < 0.05) { ex = lx; ey = ly; ez = lz; d = Math.sqrt(ex * ex + ey * ey + ez * ez); if (d < 0.05) { ex = 0; ey = 1; ez = 0; d = 1; } }
        const k = want / d;
        lx = hP[b] + ex * k; ly = hP[b + 1] + ey * k; lz = hP[b + 2] + ez * k;
        D[DL] = lx; D[DL + 1] = ly; D[DL + 2] = lz; D[DT] = HC;
        nearQ();
        d = D[DQ];
      }
      if (DI[0] >= 0 && d < HMIN) {
        const sc = S[STAN.heapScale];
        const ex = fP[a3] - S[STAN.offX];
        const ey = fP[a3 + 1] - S[STAN.offY];
        const ez = fP[a3 + 2] - S[STAN.offZ];
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        const k = el > 0.05 ? HC * 0.6 * sc / el : 0;
        fP[a3] += ex * k; fP[a3 + 1] += (el > 0.05 ? ey * k : HC * 0.6); fP[a3 + 2] += ez * k;
        // … i w bok (losowo w planie): wraca w inne miejsce powierzchni, nie w ten sam zaklinowany punkt
        const an = rnd30() * R30 * TAU;
        fP[a3] += Math.cos(an) * HC * 0.9; fP[a3 + 2] += Math.sin(an) * HC * 0.9;
        return;
      }
      // UKŁADANIE: ziarno zsuwa się po sąsiadach w głąb bryły (ku środkowi w metryce spłaszczonego obrysu — mocniej
      // ku płaszczyźnie równika), póki nie zaklinuje się między ziarnami: kupa jest pełna od środka, bez pustego jądra
      for (let q = 0; q < HSET; q++) {
        if (lx * lx + ly * ly + lz * lz < HC * HC) break;
        const r2 = lx * lx + HFY * ly * ly + lz * lz;
        const st = HC * 0.3 / Math.sqrt(lx * lx + HFY * HFY * ly * ly + lz * lz);
        const sty = st * HFY < 1 ? st * HFY : 1;
        let tx = lx * (1 - st);
        let ty = ly * (1 - sty);
        let tz = lz * (1 - st);
        D[DL] = tx; D[DL + 1] = ty; D[DL + 2] = tz; D[DT] = HC;
        nearQ();
        if (DI[0] >= 0 && D[DQ] < HMIN) {
          d = D[DQ];
          if (d < 1e-3) break;
          const k = want / d;
          const b = DI[0] * 3;
          tx = hP[b] + (tx - hP[b]) * k; ty = hP[b + 1] + (ty - hP[b + 1]) * k; tz = hP[b + 2] + (tz - hP[b + 2]) * k;
          D[DL] = tx; D[DL + 1] = ty; D[DL + 2] = tz;
          nearQ();
          if (DI[0] >= 0 && D[DQ] < HMIN) break;
        }
        if (tx * tx + HFY * ty * ty + tz * tz >= r2 - 0.02 * HC * HC) break;      // nie zbliżyło się do środka
        lx = tx; ly = ty; lz = tz;
      }
    }
    if (nb >= 0) {
      // miejsce po ułożeniu musi leżeć w obrysie pola (z małym zapasem na odsunięcie od sąsiada)
      D[DL] = lx; D[DL + 1] = ly; D[DL + 2] = lz;
      envQ();
      if (D[DQ] > 1.1 + X[XENI]) return;
    }
    const i = nHeap++;
    const b = i * 3;
    hP[b] = lx; hP[b + 1] = ly; hP[b + 2] = lz;
    const r = Math.sqrt(lx * lx + ly * ly + lz * lz);
    hR[i] = r;
    hHeat[i] = 0;
    hAng[i] = fAng[j];
    hTrait[i] = fTrait[j];
    hHash[i] = fHash[j];
    hFresh[i] = 1;
    hW[b] = fP[a3]; hW[b + 1] = fP[a3 + 1]; hW[b + 2] = fP[a3 + 2];
    {
      // obraz: ziarno dosuwa się z miejsca, w którym dotknęło kupy, na miejsce po ułożeniu (zanik w `writeView`)
      const sc = S[STAN.heapScale];
      const c = Math.cos(S[STAN.heapRot]);
      const sn = Math.sin(S[STAN.heapRot]);
      hOff[b] = fP[a3] - (S[STAN.offX] + (c * lx - sn * lz) * sc);
      hOff[b + 1] = fP[a3 + 1] - (S[STAN.offY] + ly * sc);
      hOff[b + 2] = fP[a3 + 2] - (S[STAN.offZ] + (sn * lx + c * lz) * sc);
    }
    hWp[b] = fPrev[a3]; hWp[b + 1] = fPrev[a3 + 1]; hWp[b + 2] = fPrev[a3 + 2];
    // siatka sąsiedztwa
    const cx = (Math.floor(lx / HC) | 0) + HG;
    const cy = (Math.floor(ly / HC) | 0) + HG;
    const cz = (Math.floor(lz / HC) | 0) + HG;
    if (cx >= 0 && cy >= 0 && cz >= 0 && cx < HN && cy < HN && cz < HN) {
      const o = ((cz * HN + cy) * HN + cx) * HK;
      for (let k = 0; k < HK; k++) if (hGrid[o + k] === 0) { hGrid[o + k] = i + 1; break; }
    }
    const eb = envBin(i);
    hBin[i] = eb;
    const rm = hMet(i);
    if (rm > hEnv[eb]) hEnv[eb] = rm;
    if (r > X[XENV]) X[XENV] = r;
    X[XHI] += r * r;
    // pęd ziarna rozkręca kupę (moment wokół pionu) i przesuwa ją w polu
    const bx = fP[a3] - S[STAN.offX];
    const bz = fP[a3 + 2] - S[STAN.offZ];
    S[STAN.heapOm] += 0.4 * (bz * fV[a3] - bx * fV[a3 + 2]) / (3000 + X[XHI]);
    const kv = 0.5 / (nHeap + 60);
    X[XOV] += fV[a3] * kv; X[XOV + 1] += fV[a3 + 1] * kv; X[XOV + 2] += fV[a3 + 2] * kv;
    Cn[LICZNIK.lodged]++;
    Cn[LICZNIK.heap] = nHeap - hHead;
    X[XLODGE]++;
    envGrow();
    dropFlight(j);
  }

  /** Półoś obrysu pola w planie dla bieżącej liczby ziaren kupy → X[XENA] (objętość obrysu ∝ liczba ziaren). */
  function envGrow() {
    // (na początku obrys ciaśniejszy o `heapTight`: pierwsze ziarna upakowują środek gęściej — bez tego szybka struga
    // rozbudowywała brzeg, a środek zostawał rzadszy; do pełnej kupy obrys dochodzi do rozmiaru nominalnego)
    const f = (nHeap + 10) / (heapGrains + 10);
    X[XENA] = PROCES.heapA * Math.cbrt(f) * (1 - PROCES.heapTight * (f < 1 ? 1 - f : 0));
  }

  /**
   * Punkt lokalny D[DL…] względem obrysu pola → D[DQ] (≤ 1 — w obrysie). Obrys: elipsoida spłaszczona w pionie
   * z nierównościami (pięć garbów i wklęśnięć o kierunkach z losowania obiegu; obracają się razem z kupą).
   */
  function envQ() {
    const A1 = X[XENA] > 1 ? X[XENA] : 1;
    const ux = D[DL] / A1;
    const uy = D[DL + 1] / (A1 * PROCES.heapB / PROCES.heapA);
    const uz = D[DL + 2] / A1;
    const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (l < 1e-6) { D[DQ] = 0; return; }
    let g = 1;
    for (let k = 0; k < 5; k++) {
      const d = (ux * lump[k * 4] + uy * lump[k * 4 + 1] + uz * lump[k * 4 + 2]) / l;
      g += lump[k * 4 + 3] * (d * d - 0.3333);
    }
    D[DQ] = l / (g > 0.5 ? g : 0.5);
  }

  /** Nierówności obrysu na nowy obieg (z losowania symulacji). */
  function lumpRoll() {
    for (let k = 0; k < 5; k++) {
      const x = rnd30() * R30 * 2 - 1;
      const y = (rnd30() * R30 * 2 - 1) * 0.7;
      const z = rnd30() * R30 * 2 - 1;
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      lump[k * 4] = x / l; lump[k * 4 + 1] = y / l; lump[k * 4 + 2] = z / l;
      lump[k * 4 + 3] = (rnd30() * R30 * 2 - 0.9) * PROCES.heapLump;
    }
  }

  /** Mapa obrysu i największy promień kupy od nowa (po przesunięciu środka albo sortowaniu). */
  function heapEnvelope() {
    hEnv.fill(0);
    let env = 0;
    let inertia = 0;
    for (let i = hHead; i < nHeap; i++) {
      const b = i * 3;
      const r = Math.sqrt(hP[b] * hP[b] + hP[b + 1] * hP[b + 1] + hP[b + 2] * hP[b + 2]);
      hR[i] = r;
      const eb = envBin(i);
      hBin[i] = eb;
      const rm = hMet(i);
      if (rm > hEnv[eb]) hEnv[eb] = rm;
      if (r > env) env = r;
      inertia += r * r;
    }
    X[XENV] = env;
    X[XHI] = inertia;
  }

  /**
   * Początek topienia: środek kupy przechodzi w jej środek masy (tam urośnie jądro), ziarna są sortowane po odległości
   * od środka — jądro wchłania je od najbliższych. Sortowanie przez zliczanie, w brudnopisach (bez alokacji).
   */
  function heapPrepareMelt() {
    hOff.fill(0);
    const n = nHeap;
    heapTotal = n;
    hHead = 0;
    heapSorted = true;
    if (n === 0) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) { cx += hP[i * 3]; cy += hP[i * 3 + 1]; cz += hP[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) { hP[i * 3] -= cx; hP[i * 3 + 1] -= cy; hP[i * 3 + 2] -= cz; }
    // przesunięcie pola o ten sam wektor w komorze: obraz bez skoku, sprężyna pola dociąga kupę do osi
    const sc = S[STAN.heapScale];
    const c = Math.cos(S[STAN.heapRot]);
    const s = Math.sin(S[STAN.heapRot]);
    S[STAN.offX] += (c * cx - s * cz) * sc;
    S[STAN.offY] += cy * sc;
    S[STAN.offZ] += (s * cx + c * cz) * sc;
    heapEnvelope();
    const env = X[XENV] + 1e-3;
    sCount.fill(0);
    for (let i = 0; i < n; i++) {
      let q = (hR[i] / env * SORT_BINS) | 0;
      if (q >= SORT_BINS) q = SORT_BINS - 1;
      sCount[q + 1]++;
    }
    for (let q = 0; q < SORT_BINS; q++) sCount[q + 1] += sCount[q];
    for (let i = 0; i < n; i++) {
      let q = (hR[i] / env * SORT_BINS) | 0;
      if (q >= SORT_BINS) q = SORT_BINS - 1;
      sOrder[sCount[q]++] = i;
    }
    // przestawienie tablic według kolejności
    for (let k = 0; k < n; k++) { const i = sOrder[k] * 3; tF3[k * 3] = hP[i]; tF3[k * 3 + 1] = hP[i + 1]; tF3[k * 3 + 2] = hP[i + 2]; }
    for (let k = 0; k < n * 3; k++) hP[k] = tF3[k];
    for (let k = 0; k < n; k++) { const i = sOrder[k] * 3; tF3[k * 3] = hW[i]; tF3[k * 3 + 1] = hW[i + 1]; tF3[k * 3 + 2] = hW[i + 2]; }
    for (let k = 0; k < n * 3; k++) hW[k] = tF3[k];
    for (let k = 0; k < n; k++) { const i = sOrder[k] * 3; tF3[k * 3] = hWp[i]; tF3[k * 3 + 1] = hWp[i + 1]; tF3[k * 3 + 2] = hWp[i + 2]; }
    for (let k = 0; k < n * 3; k++) hWp[k] = tF3[k];
    for (let k = 0; k < n; k++) tF1[k] = hHeat[sOrder[k]];
    for (let k = 0; k < n; k++) hHeat[k] = tF1[k];
    for (let k = 0; k < n; k++) tF1[k] = hAng[sOrder[k]];
    for (let k = 0; k < n; k++) hAng[k] = tF1[k];
    for (let k = 0; k < n; k++) tI[k] = hHash[sOrder[k]];
    for (let k = 0; k < n; k++) hHash[k] = tI[k];
    for (let k = 0; k < n; k++) tI[k] = hTrait[sOrder[k]];
    for (let k = 0; k < n; k++) hTrait[k] = tI[k];
    for (let k = 0; k < n; k++) hFresh[k] = 0;
    heapEnvelope();
  }

  /** Kupa znika (wszystko wchłonięte przez jądro albo nowy obieg). */
  function heapReset() {
    lumpRoll();
    nHeap = 0;
    hHead = 0;
    heapTotal = 0;
    heapSorted = false;
    hGrid.fill(0);
    hEnv.fill(0);
    X[XENV] = 0;
    X[XHI] = 0;
    X[XENI] = 0;
    envGrow();
    S[STAN.heapScale] = 1;
    S[STAN.heapR] = 0;
    S[STAN.heapN] = 0;
    S[STAN.heapHeat] = 0;
    S[STAN.heapOm] = 0;
    Cn[LICZNIK.heap] = 0;
  }

  /**
   * Jądro wchłania ziarno z czoła kupy (najbliższe środka): metal, porcja żużla (drobina w kierunku ziarna) i gaz —
   * najpierw spłata zaliczki (dym i wyrzuty kupy wydane przed czasem), reszta rozpuszcza się w kąpieli.
   */
  function absorb() {
    const i = hHead++;
    if (Cn[LICZNIK.metal] + Cn[LICZNIK.slagFloes] === 0) S[STAN.temp] = PROCES.tempMelt;
    Cn[LICZNIK.metal] += MU;
    {
      const adv = Cn[LICZNIK.gasAdvance];
      const repay = adv < GU ? adv : GU;
      Cn[LICZNIK.gasAdvance] = adv - repay;
      Cn[LICZNIK.gasBath] += GU - repay;
    }
    Cn[LICZNIK.absorbed]++;
    Cn[LICZNIK.heap] = nHeap - hHead;
    const q = absorbSeq++;
    const b = i * 3;
    {
      const ex = hW[b] - S[STAN.offX];
      const ey = hW[b + 1] - S[STAN.offY];
      const ez = hW[b + 2] - S[STAN.offZ];
      const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (el > 1e-3) { D[DN] = ex / el; D[DN + 1] = ey / el; D[DN + 2] = ez / el; } else { D[DN] = 0; D[DN + 1] = 1; D[DN + 2] = 0; }
      X[XJOIN] = PROCES.slagJoinMelt;
      slagAtD();
    }
    // zdarzenia tylko dla ziaren na wierzchu kupy (jądro przebija się przez nią): błysk, iskra, fala, kropla
    if (hEnv[hBin[i]] - hMet(i) < 2.2 * HC && S[STAN.radius] > 30) {
      D[DP] = hW[b]; D[DP + 1] = hW[b + 1]; D[DP + 2] = hW[b + 2];
      const hs = hHash[i];
      if (q % 10 === 0) { D[DAMP] = 6 + 7 * (((hs >>> 13) & 255) / 255); flashD(); }
      if (q % 5 === 0) sparkD();
      if (q % 50 === 0) { D[DAMP] = 0.5 + 0.4 * (((hs >>> 5) & 255) / 255); rippleD(); }
      if (q % 110 === 0) dropD(hs);
      if (q % 2 === 0) { D[DK] = -0.0005; kickModesInto(modeV, D); }
    }
  }

  /** Żar ziaren kupy (raz na krok): strefy pod segmentami cewek grzeją się pierwsze, od środka grzeje jądro. */
  function stepHeapHeat() {
    const dt = X[XDT];
    const n = nHeap - hHead;
    if (n <= 0) { S[STAN.heapHeat] = 0; return; }
    const p = S[STAN.phase];
    const cg = S[STAN.coilGlow];
    if (!(p === PHASE.MELT || (p === PHASE.PRESS && cg > 0.02))) return;
    const env = X[XENV] > 1 ? X[XENV] : 1;
    const sc = S[STAN.heapScale];
    const R = S[STAN.radius];
    const c = Math.cos(S[STAN.heapRot]);
    const s = Math.sin(S[STAN.heapRot]);
    let sum = 0;
    for (let i = hHead; i < nHeap; i++) {
      const b = i * 3;
      const r = hR[i] > 1e-3 ? hR[i] : 1e-3;
      const wx = (c * hP[b] - s * hP[b + 2]) / r;
      const wy = hP[b + 1] / r;
      const wz = (s * hP[b] + c * hP[b + 2]) / r;
      let pw = 0;
      for (let k = 0; k < NPAD; k++) {
        const d = wx * padDirs[k * 3] + wy * padDirs[k * 3 + 1] + wz * padDirs[k * 3 + 2];
        if (d > pw) pw = d;
      }
      pw = (pw - 0.55) / 0.4;
      pw = pw <= 0 ? 0 : pw >= 1 ? 1 : pw * pw * (3 - 2 * pw);
      const rel = r / env;
      let hh = hHeat[i] + dt * cg * (0.022 + rel * rel * (0.03 + 0.2 * pw));
      if (R > 1) {
        const g = (r * sc - R) / 30;
        const ch = g <= 0 ? 0.97 : 0.97 * Math.exp(-g);
        if (ch > hh) hh = ch;
      }
      if (hh > 1) hh = 1;
      hHeat[i] = hh;
      sum += hh;
    }
    S[STAN.heapHeat] = sum / n;
  }

  /** Obrót kupy: pole trzyma ją w wolnym wirze, struga ją rozkręca. */
  function stepHeapBody() {
    const h = X[XH];
    S[STAN.lodgeRate] += (X[XLODGE] / h - S[STAN.lodgeRate]) * (1 - Math.exp(-h / 0.3));
    X[XLODGE0] = X[XLODGE];
    X[XLODGE] = 0;
    if (nHeap - hHead <= 0) return;
    // koniec strugi, a ostatnie ziarna krążą bez miejsca w obrysie: pole poszerza obrys, aż wszystkie przylgną
    if (nFlight > 0 && nBelt === 0 && S[STAN.feedLeft] <= 0 && S[STAN.phase] !== PHASE.MELT) { if (X[XENI] < 0.24) X[XENI] += 0.2 * h; } else X[XENI] = 0;
    let om = S[STAN.heapOm];
    om += (PROCES.heapOmega - om) * (1 - Math.exp(-h / 1.6));
    if (om > PROCES.heapOmegaMax) om = PROCES.heapOmegaMax; else if (om < -PROCES.heapOmegaMax) om = -PROCES.heapOmegaMax;
    S[STAN.heapOm] = om;
    // dodatnia prędkość kątowa wokół +y = obrót zgodny z wirem pola (przeciwnie do wskazówek na ekranie)
    let th = S[STAN.heapRot] - om * h;
    if (th < -TAU) th += TAU; else if (th > TAU) th -= TAU;
    S[STAN.heapRot] = th;
    S[STAN.heapN] = nHeap - hHead;
  }

  // --- lot ziaren w polu -----------------------------------------------------
  function stepFlight() {
    const h = X[XH];
    const p = S[STAN.phase];
    const R = S[STAN.radius];
    const hasBall = R > 1 && !impacted;
    // tryb kupy: kuli nie ma — ziarna przylegają do kupy (pierwsze zarodkuje ją w środku pola)
    const heapMode = !hasBall && (p === PHASE.EMPTY || p === PHASE.GATHER || p === PHASE.PRESS);
    const Rh = S[STAN.heapR];
    const Rf = R > Rh ? R : Rh;                       // promień bryły w środku pola
    const T = S[STAN.temp];
    const lim = Rf * (1 + BALL.limit) + GRAIN.r + 1;
    const lim2 = lim * lim;
    const ox = S[STAN.offX];
    const oy = S[STAN.offY];
    const oz = S[STAN.offZ];
    const kRelax = 1 - Math.exp(-h / 0.35);
    const wall = KOMORA.fieldWall;
    const ceil = KOMORA.fieldCeil;
    const hard = KOMORA.fieldHard;
    const hc = ceil + 30;
    const sc = S[STAN.heapScale];
    const hcos = Math.cos(S[STAN.heapRot]);
    const hsin = Math.sin(S[STAN.heapRot]);
    const reach = (X[XENA] * 1.5 + HC) * sc;
    const reach2 = reach * reach;
    // półoś pionowa obrysu pola przy bieżącej kupie (wysokości dojścia ziaren)
    const heapTop = (X[XENA] > 14 ? X[XENA] : 14) * (PROCES.heapB / PROCES.heapA) * 0.94 * sc;
    // DUŻA KULA: od bramy 0 g do powierzchni jest bliżej — pole ciągnie ziarna ku kuli wolniej (czas spirali zostaje
    // ok. `flowTime` s, jak przy małej kuli), struga owija kulę rozgrzewającą się wstęgą, zamiast wpadać w nią za bramą
    let vinBall = 1;
    if (hasBall) {
      vinBall = (GATE_RHO - Rf - 50) / (PROCES.flowTime * PROCES.flowIn);
      vinBall = vinBall > 1 ? 1 : vinBall < 0.4 ? 0.4 : vinBall;
    }
    for (let j = nFlight - 1; j >= 0; j--) {
      const a = j * 3;
      let px = fP[a];
      let py = fP[a + 1];
      let pz = fP[a + 2];
      const hs = fHash[j];
      const rho = Math.sqrt(px * px + pz * pz) || 1e-6;
      // pole: wir wokół osi pionowej (przeciwnie do wskazówek na ekranie), dośrodkowe ku bryle, tor ziarna na swojej
      // szerokości
      const u1 = (hs & 1023) / 1023;
      const u2 = ((hs >>> 10) & 1023) / 1023;
      const u3 = ((hs >>> 20) & 1023) / 1023;
      // szerokość toru. Kula: −23°…+13° (struga schodzi lekko pod równik — z góry tarcza kuli zostaje czysta).
      // Kupa: ziarna dochodzą z szerokiego pasa wokół płaszczyzny wiru (sin φ równomiernie w `heapLat0…heapLat1`) —
      // bryła spłaszczona jak wirujący stos gruzu, nie cienki placek.
      let tanLat;
      // KUPA: ziarno ma własną WYSOKOŚĆ dojścia w obrysie pola (cały przekrój obrysu, także nad i pod środkiem) —
      // tor po stożku ku środkowi zostawiałby puste leje na biegunach bryły (z góry: dziura w środku kupy)
      // (mediana trzech losowań: gęstość ∝ 1 − s² — tyle ziaren na wysokość, ile mieści przekrój elipsoidy)
      let yT = 0;
      if (heapMode) {
        const m3 = u1 > u2 ? (u2 > u3 ? u2 : u1 > u3 ? u3 : u1) : (u1 > u3 ? u1 : u2 > u3 ? u3 : u2);
        yT = (2 * m3 - 1) * heapTop;
        // ziarno, które doszło do osi pola nad albo pod kupą i nie znalazło styku, osiada wzdłuż osi na jej biegun
        if (rho < 22) yT *= 0.2;
        tanLat = 0;
      } else tanLat = Math.tan((u1 * 36 - 23) * DEG);
      const vin = (PROCES.flowIn + PROCES.flowInVar * u2) * vinBall;
      let vt = (PROCES.flowSwirl + PROCES.flowSwirlVar * u3) * Math.min(1.5, Math.pow(PROCES.flowRef / Math.max(rho, 150), 0.35));
      if (heapMode) {
        // bez kuli wir przy osi obraca się jak ciało sztywne (prędkość ∝ promień) — inaczej ziarna krążyłyby wokół
        // pustego środka i nigdy do niego nie doszły; do kupy dolatują łagodnie
        const cap = 1.25 * rho + 20;
        if (vt > cap) vt = cap;
      }
      const tx = pz / rho;
      const tz = -px / rho;
      const rx = -px / rho;
      const rz = -pz / rho;
      // tor rozchodzi się na swoją szerokość dopiero przy bryle (przy granicy 0 g struga jest zwarta)
      // (w trybie kupy ziarno dochodzi na swoją wysokość wcześniej — także pod kupę, inaczej spód bryły zostaje rzadki)
      let near = (rho - Rf - (heapMode ? 110 : 0)) / (heapMode ? 300 : 230);
      near = near >= 1 ? 0 : near <= 0 ? 1 : 1 - near * near * (3 - 2 * near);
      let vy = ((heapMode ? yT : rho * tanLat) * near + (1 - near) * 44 - py) / 0.6;
      if (vy > 120) vy = 120; else if (vy < -120) vy = -120;
      // prędkość goni pole z opóźnieniem 0,35 s — na łuku daje to znos na zewnątrz v²·τ / ρ; pole dokłada go do środka
      // KUPA: przy osi pole prowadzi ziarno ciasno (krótsze opóźnienie prędkości) i wolniej ku środkowi. Przy stałym
      // opóźnieniu 0,35 s ziarno niosło moment pędu z zewnątrz i na promieniu ok. 50 j. stawało na barierze odśrodkowej
      // (τ · v dośrodkowa ≈ promień) — kupa rosła jako pierścień wokół pustego środka.
      let tau = 0.35;
      let kRel = kRelax;
      let vinK = 1;
      if (heapMode && rho < 270) {
        const e = rho <= 110 ? 0 : (rho - 110) / 160;
        tau = 0.07 + 0.28 * e * e * (3 - 2 * e);
        kRel = h / tau; if (kRel > 1) kRel = 1;
        if (rho < 127) vinK = rho < 25 ? 0.2 : rho / 127;
      }
      let vc = vin * vinK + vt * vt * tau / Math.max(rho, 60);
      // obrys pola (przyleganie tylko w obrysie)
      let qEnv = 2;
      if (heapMode && nHeap > 0) {
        const lbx = px - ox;
        const lbz = pz - oz;
        D[DL] = (hcos * lbx + hsin * lbz) / sc; D[DL + 1] = (py - oy) / sc; D[DL + 2] = (-hsin * lbx + hcos * lbz) / sc;
        envQ();
        qEnv = D[DQ];
      }
      let gx = tx * vt + rx * vc;
      let gz = tz * vt + rz * vc;
      // miękka ściana pola i pułap
      if (rho > wall) { const k = (rho - wall) * 9; gx += rx * k; gz += rz * k; }
      if (py > ceil) vy -= (py - ceil) * 9; else if (py < -ceil) vy -= (py + ceil) * 9;
      let vx = fV[a] + (gx - fV[a]) * kRel;
      let vyy = fV[a + 1] + (vy - fV[a + 1]) * kRelax;
      let vz = fV[a + 2] + (gz - fV[a + 2]) * kRel;
      px += vx * h;
      py += vyy * h;
      pz += vz * h;
      // twarda granica komory (ziarno nie ucieka): promień w planie i wysokość
      const r2 = px * px + pz * pz;
      if (r2 > hard * hard) {
        const k = hard / Math.sqrt(r2);
        px *= k; pz *= k;
        const vr = (vx * px + vz * pz) / (hard * hard);
        if (vr > 0) { vx -= vr * px; vz -= vr * pz; }
      }
      if (py > hc) { py = hc; if (vyy > 0) vyy = 0; } else if (py < -hc) { py = -hc; if (vyy < 0) vyy = 0; }
      fP[a] = px; fP[a + 1] = py; fP[a + 2] = pz;
      fV[a] = vx; fV[a + 1] = vyy; fV[a + 2] = vz;
      fAng[j] += fSpin[j] * h;
      // położenie względem środka bryły (kupa i kula kołyszą się w polu)
      const bx = px - ox;
      const by = py - oy;
      const bz = pz - oz;
      const d2 = bx * bx + by * by + bz * bz;
      if (heapMode) {
        if (nHeap === 0) {
          // zarodek kupy: pierwsze ziarno, które dotrze w pobliże środka pola, zostaje w nim uwięzione
          if (d2 < 2500) { D[DL] = 0; D[DL + 1] = 0; D[DL + 2] = 0; DI[0] = -1; lodge(j); }
        } else if (d2 < reach2) {
          // ziarno przylega, gdy dotknie ziarna kupy W OBRYSIE pola; poza obrysem płynie dalej ku środkowi
          D[DL] = (hcos * bx + hsin * bz) / sc; D[DL + 1] = by / sc; D[DL + 2] = (-hsin * bx + hcos * bz) / sc;
          if (nHeap < 3 && d2 < 144) {
            // węzeł pola: pierwsze ziarna więzną w samym środku także bez styku (zarodek kupy rośnie od razu)
            D[DT] = HC;
            nearQ();
            if (DI[0] < 0) { DI[0] = -2; lodge(j); } else if (D[DQ] >= HMIN) lodge(j);
            continue;
          }
          if (qEnv <= 1 + X[XENI]) {
            // sąsiad w zasięgu 1,5 styku: ziarno dosuwa się do niego na styk (`lodge`)
            D[DT] = 1.5 * HC;
            nearQ();
            if (DI[0] >= 0) lodge(j);
          }
        }
        continue;
      }
      if (!hasBall) continue;
      const dd = Math.sqrt(d2) || 1e-6;
      const q = R / (dd > R ? dd : R);
      // nagrzewanie: pole cewek (słabe, wszędzie) i żar kuli — narasta na ostatnich 30–40 % spirali (q > 0,6)
      const heat = fHeat[j] + h * (0.03 + 1.9 * q * q * q * (0.4 + 0.6 * T));
      fHeat[j] = heat > 1 ? 1 : heat;
      if (d2 < lim2) {
        D[DN] = bx / dd; D[DN + 1] = by / dd; D[DN + 2] = bz / dd;
        surfaceOffsetInto(modeA, D);
        // przy topieniu kula siedzi jeszcze w kupie: ziarno, które doleciało za wcześnie, wtapia się na jej obrysie
        const edge = R * (1 + D[DOFF]) + GRAIN.r;
        if (dd <= (edge > Rh ? edge : Rh)) {
          D[DK] = -(vx * D[DN] + vyy * D[DN + 1] + vz * D[DN + 2]);
          D[DP] = px; D[DP + 1] = py; D[DP + 2] = pz;
          meltD(j);
        }
      }
    }
    Cn[LICZNIK.flight] = nFlight;
  }

  // --- krople i iskry ------------------------------------------------------
  /** Usunięcie kropli `i` (zamiana z ostatnią). */
  function dropDrop(i) {
    const l = --nDrops;
    if (i !== l) {
      const a = i * 3;
      const b = l * 3;
      dP[a] = dP[b]; dP[a + 1] = dP[b + 1]; dP[a + 2] = dP[b + 2];
      dPrev[a] = dPrev[b]; dPrev[a + 1] = dPrev[b + 1]; dPrev[a + 2] = dPrev[b + 2];
      dV[a] = dV[b]; dV[a + 1] = dV[b + 1]; dV[a + 2] = dV[b + 2];
      dMass[i] = dMass[l]; dAge[i] = dAge[l];
    }
  }
  function dropSpark(i) {
    const l = --nSparks;
    if (i !== l) {
      const a = i * 3;
      const b = l * 3;
      qP[a] = qP[b]; qP[a + 1] = qP[b + 1]; qP[a + 2] = qP[b + 2];
      qPrev[a] = qPrev[b]; qPrev[a + 1] = qPrev[b + 1]; qPrev[a + 2] = qPrev[b + 2];
      qV[a] = qV[b]; qV[a + 1] = qV[b + 1]; qV[a + 2] = qV[b + 2];
      qLife[i] = qLife[l]; qLife0[i] = qLife0[l];
    }
  }

  function stepParticles() {
    const h = X[XH];
    const R = S[STAN.radius];
    if (S[STAN.grav]) {
      // grawitacja włączona: krople i iskry lecą balistycznie; kropla ląduje w metalu w leju, na stożku albo na dnie
      // (spływa do leja) — jej masa wraca do metalu w leju (przed uderzeniem kuli: do kuli, jeśli ją dogoni)
      const g = PROCES.gravity;
      const pool = Cn[LICZNIK.funnel] > 0;
      for (let i = nDrops - 1; i >= 0; i--) {
        if (dAge[i] < 0) { dAge[i] += h; continue; }          // kropla czeka na swoją chwilę
        const a = i * 3;
        const vy = dV[a + 1] - g * h;
        const px = dP[a] + dV[a] * h;
        const py = dP[a + 1] + vy * h;
        const pz = dP[a + 2] + dV[a + 2] * h;
        dP[a] = px; dP[a + 1] = py; dP[a + 2] = pz;
        dV[a + 1] = vy;
        dAge[i] += h;
        let rr = Math.sqrt(px * px + pz * pz);
        if (rr > KOMORA.pitR - 14) {
          // ściana studni: kropla zostaje przy niej i spada
          const kw = (KOMORA.pitR - 14) / rr;
          dP[a] = px * kw; dP[a + 2] = pz * kw;
          dV[a] *= 0.2; dV[a + 2] *= 0.2;
          rr = KOMORA.pitR - 14;
        }
        const cone = FUN.throatY + (rr - FUN.throatR) / FSL;      // wysokość stożka leja na tym promieniu (całe dno)
        let ground = cone > FUN.throatY ? cone : FUN.throatY - 40;
        if (pool && dAge[i] > 0.06) {
          // lustro masy pod kroplą (komórka pola)
          let c = field.center;
          if (rr > field.r0) {
            let j = ((rr - field.r0) / field.dr) | 0;
            if (j >= field.nr) j = field.nr - 1;
            let az = Math.atan2(pz, px);
            if (az < 0) az += TAU;
            let k = (az / field.dth) | 0;
            if (k >= FNA) k = FNA - 1;
            c = j * FNA + k;
          }
          if (field.h[c] > 1) ground = field.zb[c] + field.h[c] - 2;
        }
        if (vy < 0 && (py <= ground + 2 || dAge[i] > 5)) {
          if (impacted) Cn[LICZNIK.funnel] += dMass[i]; else Cn[LICZNIK.metal] += dMass[i];
          Cn[LICZNIK.drops] -= dMass[i];
          dropDrop(i);
        }
      }
      const kq = Math.exp(-0.5 * h);
      for (let i = nSparks - 1; i >= 0; i--) {
        const a = i * 3;
        const vx = qV[a] * kq;
        const vy = (qV[a + 1] - g * 0.8 * h) * kq;
        const vz = qV[a + 2] * kq;
        qP[a] += vx * h; qP[a + 1] += vy * h; qP[a + 2] += vz * h;
        qV[a] = vx; qV[a + 1] = vy; qV[a + 2] = vz;
        qLife[i] -= h;
        if (qLife[i] <= 0 || qP[a + 1] < FUN.throatY + (Math.sqrt(qP[a] * qP[a] + qP[a + 2] * qP[a + 2]) - FUN.throatR) / FSL - 4) dropSpark(i);
      }
      return;
    }
    const kd = Math.exp(-0.9 * h);
    for (let i = nDrops - 1; i >= 0; i--) {
      const a = i * 3;
      let px = dP[a];
      let py = dP[a + 1];
      let pz = dP[a + 2];
      const dd = Math.sqrt(px * px + py * py + pz * pz) || 1e-6;
      // napięcie powierzchniowe i pole ściągają kroplę z powrotem
      const pull = (420 + 2.2 * (dd > R ? dd - R : 0)) * h / dd;
      const vx = (dV[a] - px * pull) * kd;
      const vy = (dV[a + 1] - py * pull) * kd;
      const vz = (dV[a + 2] - pz * pull) * kd;
      px += vx * h; py += vy * h; pz += vz * h;
      dP[a] = px; dP[a + 1] = py; dP[a + 2] = pz;
      dV[a] = vx; dV[a + 1] = vy; dV[a + 2] = vz;
      dAge[i] += h;
      if (dAge[i] <= 0.12) continue;
      const bx = px - S[STAN.offX];
      const by = py - S[STAN.offY];
      const bz = pz - S[STAN.offZ];
      const d2 = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-6;
      D[DN] = bx / d2; D[DN + 1] = by / d2; D[DN + 2] = bz / d2;
      surfaceOffsetInto(modeA, D);
      if (d2 <= R * (1 + D[DOFF]) + 2 || dAge[i] > 4) {
        // kropla wraca do kuli
        Cn[LICZNIK.metal] += dMass[i];
        Cn[LICZNIK.drops] -= dMass[i];
        D[DAMP] = 0.5;
        rippleD();
        if (R > 20) { D[DK] = -0.012; kickModesInto(modeV, D); }
        dropDrop(i);
      }
    }
    const kq = Math.exp(-1.6 * h);
    const inner = R * R * 0.94;
    for (let i = nSparks - 1; i >= 0; i--) {
      const a = i * 3;
      let px = qP[a];
      let py = qP[a + 1];
      let pz = qP[a + 2];
      const dd = Math.sqrt(px * px + py * py + pz * pz) || 1e-6;
      const pull = 520 * h / dd;
      const vx = (qV[a] - px * pull) * kq;
      const vy = (qV[a + 1] - py * pull) * kq;
      const vz = (qV[a + 2] - pz * pull) * kq;
      px += vx * h; py += vy * h; pz += vz * h;
      qP[a] = px; qP[a + 1] = py; qP[a + 2] = pz;
      qV[a] = vx; qV[a + 1] = vy; qV[a + 2] = vz;
      qLife[i] -= h;
      if (qLife[i] <= 0 || px * px + py * py + pz * pz < inner) dropSpark(i);
    }
  }

  // --- żużel: wyspy na powierzchni kuli ---------------------------------------------------------------------------
  // JEDEN system (uwaga użytkownika nr 4 w SPEC): żużel powstaje tylko tam, gdzie wtapia się ziarno — jako drobina
  // w miejscu wtopienia. Wyspa = soczewka gęstej cieczy na metalu: kierunek na sferze (układ komory), masa
  // w jednostkach całkowitych, promień RYSOWANY `kRad` (dochodzi do promienia z masy ze stałą czasu — wyspa rośnie od
  // zera i maleje do zera, nic nie wyskakuje ani nie znika skokiem), żar kożucha (stygnie). Wyspy niesie obrót kuli,
  // prądy powierzchni je mieszają, wirowanie spycha ku GÓRNEMU biegunowi. Stykające się wyspy przyciągają się
  // i lżejsza PRZELEWA SIĘ w cięższą: masa przechodzi stopniowo, środki zbliżają się odwrotnie do mas — w obrazie
  // dwie plamy zlewają się szyjką w jedną. Usunięcie wyspy z puli dopiero przy masie 0 i promieniu rysowanym ~0.
  function removeFloe(i) {
    const l = --nFloes;
    if (i !== l) {
      kDir[i * 3] = kDir[l * 3]; kDir[i * 3 + 1] = kDir[l * 3 + 1]; kDir[i * 3 + 2] = kDir[l * 3 + 2];
      kMass[i] = kMass[l]; kRad[i] = kRad[l]; kCh[i] = kCh[l]; kHeat[i] = kHeat[l]; kAge[i] = kAge[l]; kAcc[i] = kAcc[l]; kId[i] = kId[l];
    }
  }

  /**
   * Jednostka żużla z wtopionego ziarna w kierunku D[0…2] (od środka kuli): zasila wyspę, przy której brzegu wypadła,
   * albo zarodkuje nową drobinę w miejscu wtopienia. Nie zmienia D[0…2].
   */
  function slagAtD() {
    const x = D[DN];
    const y = D[DN + 1];
    const z = D[DN + 2];
    Cn[LICZNIK.slagFloes] += 1;
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < nFloes; i++) {
      if (kMass[i] === 0) continue;
      const a = i * 3;
      const dx = kDir[a] - x;
      const dy = kDir[a + 1] - y;
      const dz = kDir[a + 2] - z;
      const gap = Math.sqrt(dx * dx + dy * dy + dz * dz) - kCh[i];
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best >= 0 && (bestGap < X[XJOIN] || nFloes >= NK)) {
      const m = kMass[best];
      kHeat[best] = (kHeat[best] * m + PROCES.slagHeatNew) / (m + 1);
      kMass[best] = m + 1;
      return;
    }
    let i = nFloes;
    if (i >= NK) {
      // pula pełna samych gasnących wysp (nie zdarza się): drobina zajmuje miejsce najmniejszej z nich
      i = 0;
      for (let k = 1; k < NK; k++) if (kRad[k] < kRad[i]) i = k;
    } else nFloes++;
    const a = i * 3;
    kDir[a] = x; kDir[a + 1] = y; kDir[a + 2] = z;
    kMass[i] = 1;
    kRad[i] = 0;
    kCh[i] = 0;
    kHeat[i] = PROCES.slagHeatNew;
    kAge[i] = 0;
    kAcc[i] = 0;
    kId[i] = ++floeSeq;
    Cn[LICZNIK.floesMade]++;
  }

  function stepSlag() {
    const h = X[XH];
    capI = -1;
    if (nFloes === 0) { S[STAN.capMass] = 0; S[STAN.capAlpha] = 0; S[STAN.slagOn] = 0; S[STAN.islands] = 0; return; }
    const om = S[STAN.omega];
    const w = om / PROCES.omegaRefine;
    const pulling = S[STAN.suck] === 2 ? 1 : 0;
    const up = ((S[STAN.phase] === PHASE.MELT ? PROCES.slagDriftMelt : PROCES.slagDrift0) + PROCES.slagDrift1 * w * w + PROCES.suckPull * pulling) * h;
    const rot = -om * h;                               // wyspy płyną z powierzchnią (wzór konwekcji obraca się tak samo)
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const kr = 1 - Math.exp(-h / PROCES.slagRadTau);
    const kc = 1 - Math.exp(-h / PROCES.slagCool);
    const t = S[STAN.time];
    // prądy powierzchni: trzy wiry o osiach stałych w układzie kuli (kula obrócona o `rot`)
    const ca = Math.cos(S[STAN.rot]);
    const sa = Math.sin(S[STAN.rot]);
    const wg = PROCES.slagWander * h;
    const p0 = t * 0.31;
    const p1 = t * 0.23 + 1.7;
    const p2 = t * 0.17 + 4.1;
    const zone = PROCES.suckZone;
    for (let i = 0; i < nFloes; i++) {
      const a = i * 3;
      kAge[i] += h;
      kHeat[i] += (PROCES.slagHeatFloor - kHeat[i]) * kc;
      alphaOf(kMass[i]);
      kRad[i] += (D[DAL] - kRad[i]) * kr;
      // obrót z kulą
      let x = kDir[a] * cr - kDir[a + 2] * sr;
      let y = kDir[a + 1];
      let z = kDir[a] * sr + kDir[a + 2] * cr;
      // dryf ku górnemu biegunowi po południku: prędkość ∝ sin(kąta od osi) — na dolnej półkuli nie mniej niż 0,3
      const s2 = 1 - y * y;
      const sn = s2 > 0 ? Math.sqrt(s2) : 0;
      let k = up;
      if (y < 0 && sn < 0.3) k = sn > 1e-4 ? up * 0.3 / sn : 0;
      if (sn > 1e-4) { x -= y * x * k; z -= y * z * k; y += s2 * k; } else if (y < 0) x += up * 0.3;
      // przy ściąganiu: wyspy w strefie bieguna płyną prosto pod dzwon
      const dp = Math.sqrt(x * x + (1 - y) * (1 - y) + z * z);
      if (pulling && dp < zone && dp > 1e-5) {
        let q = 0.25 * h / dp;
        if (q > 1) q = 1;
        const yq = (1 - y) * q;
        x -= x * q; z -= z * q; y += yq;
      }
      // prądy (słabną przy biegunie i dla ciężkich wysp)
      let wk = dp / 0.6;
      if (wk > 1) wk = 1;
      wk *= wg / (1 + kMass[i] * (1 / (3 * SLAG_EQ_PER_TON)));
      if (wk > 0) {
        const qx = x * ca - z * sa;
        const qz = x * sa + z * ca;
        const f0 = Math.sin(3 * qz + p0) * wk;
        const f1 = Math.sin(3 * (0.6 * qx + 0.8 * y) + p1) * wk;
        const f2 = Math.sin(3 * (0.7071 * y - 0.7071 * qx) + p2) * wk;
        // (1, 0, 0) × q · f0 + (0, 0, 1) × q · f1 + (0,577; 0,577; 0,577) × q · f2
        const vx = -y * f1 + 0.5774 * (qz - y) * f2;
        const vy = -qz * f0 + qx * f1 + 0.5774 * (qx - qz) * f2;
        const vz = y * f0 + 0.5774 * (y - qx) * f2;
        x += vx * ca + vz * sa;
        y += vy;
        z += -vx * sa + vz * ca;
      }
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      kDir[a] = x / l; kDir[a + 1] = y / l; kDir[a + 2] = z / l;
      kCh[i] = 2 * Math.sin(kRad[i] * 0.5);
    }
    // pary: przyciąganie przy styku i przelewanie lżejszej wyspy w cięższą
    const reachK = 1 + PROCES.slagReach;
    for (let i = 0; i < nFloes; i++) {
      if (kMass[i] === 0) continue;
      const a = i * 3;
      for (let j = i + 1; j < nFloes; j++) {
        if (kMass[j] === 0) continue;
        const b = j * 3;
        const dx = kDir[b] - kDir[a];
        const dy = kDir[b + 1] - kDir[a + 1];
        const dz = kDir[b + 2] - kDir[a + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const sum = kCh[i] + kCh[j];
        const reach = sum * reachK + 0.012;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const light = kMass[i] < kMass[j] ? i : j;
        const heavy = light === i ? j : i;
        const ml = kMass[light];
        const mh = kMass[heavy];
        const gap = d - sum;
        let pull = 1 - gap / (reach - sum);
        if (pull > 1.5) pull = 1.5;
        let close = PROCES.slagAttract * (kCh[light] + 0.012) * pull * h;
        if (close > d * 0.5) close = d * 0.5;
        if (d > 1e-6) {
          const sgn = light === i ? 1 : -1;
          const cl = close * mh / (ml + mh) * sgn / d;
          const chv = close * ml / (ml + mh) * sgn / d;
          const la = light * 3;
          const ha = heavy * 3;
          let x = kDir[la] + dx * cl;
          let y = kDir[la + 1] + dy * cl;
          let z = kDir[la + 2] + dz * cl;
          let l = Math.sqrt(x * x + y * y + z * z) || 1;
          kDir[la] = x / l; kDir[la + 1] = y / l; kDir[la + 2] = z / l;
          x = kDir[ha] - dx * chv;
          y = kDir[ha + 1] - dy * chv;
          z = kDir[ha + 2] - dz * chv;
          l = Math.sqrt(x * x + y * y + z * z) || 1;
          kDir[ha] = x / l; kDir[ha + 1] = y / l; kDir[ha + 2] = z / l;
        }
        if (gap < 0) {
          let frac = -gap / (2 * kCh[light] + 1e-6);
          if (frac > 1) frac = 1;
          kAcc[light] += PROCES.slagDrain * (0.2 + frac) * (ml > 24 ? ml : 24) * h;
          let n = Math.floor(kAcc[light]);
          if (n > 0) {
            if (n >= ml) { n = ml; kAcc[light] = 0; } else kAcc[light] -= n;
            kHeat[heavy] = (kHeat[heavy] * mh + kHeat[light] * n) / (mh + n);
            kMass[light] = ml - n;
            kMass[heavy] = mh + n;
            if (kMass[light] === 0) Cn[LICZNIK.merges]++;
          }
        }
        if (kMass[i] === 0) break;
      }
    }
    // gasnące wyspy (masa 0) znikają z puli, gdy promień rysowany spadł do zera; czapa = najcięższa wyspa, pod którą
    // leży biegun; masa strefy bieguna
    for (let i = nFloes - 1; i >= 0; i--) if (kMass[i] === 0 && kRad[i] < 0.003) removeFloe(i);
    let cap = 0;
    let capBest = 0;
    for (let i = 0; i < nFloes; i++) {
      const m = kMass[i];
      if (m === 0) continue;
      const a = i * 3;
      const dp = Math.sqrt(kDir[a] * kDir[a] + (1 - kDir[a + 1]) * (1 - kDir[a + 1]) + kDir[a + 2] * kDir[a + 2]);
      if (dp < zone) cap += m;
      if (dp < kCh[i] + 0.03 && m > capBest) { capBest = m; capI = i; }
    }
    S[STAN.capMass] = cap;
    S[STAN.capAlpha] = capI >= 0 ? kRad[capI] : 0;
    S[STAN.slagOn] = Cn[LICZNIK.slagFloes] / SLAG_EQ_PER_TON;
    S[STAN.islands] = nFloes;
  }

  // --- ssawa żużla: dojazd, nitka, powrót ---------------------------------------------------------------------------
  // Wózek jedzie po wysięgniku nad kulę, szyja opuszcza dzwon obok wierzchołka czapy. Z czapy podnosi się stożek
  // i wyciąga w NITKĘ gęstej cieczy (odcinek [thrLo, thrHi] drogi korzeń → dzwon); nitką płynie masa czapy — czapa
  // kurczy się, aż na kuli nie ma żużla; wtedy nitka rwie się od korzenia i ssawa odjeżdża. Żużel jedzie rurociągiem
  // (`slagTransit`) do odbieralnika.
  /** Pozycja robocza dzwonu → D[DW], D[DW + 1]; korzeń nitki i wierzchołek stożka → S[rootY], S[apexY]. */
  function headWorkD() {
    D[DN] = 0; D[DN + 1] = 1; D[DN + 2] = 0;
    surfaceOffsetInto(modeA, D);
    const R = S[STAN.radius];
    const top = S[STAN.offY] + R * (1 + D[DOFF]);
    // soczewka czapy na biegunie (ten sam wzór co w shaderze kuli): głębokość pola wyspy pod biegunem
    let dome = 0;
    if (capI >= 0) {
      const a = capI * 3;
      const r = kCh[capI];
      const d2 = kDir[a] * kDir[a] + (1 - kDir[a + 1]) * (1 - kDir[a + 1]) + kDir[a + 2] * kDir[a + 2];
      const depth = r > 1e-4 ? (r * r - d2) / (2 * r) : 0;
      if (depth > 0) dome = SLAG.lift * R * (1 - Math.exp(-depth / SLAG.liftDepth));
    }
    S[STAN.rootY] = top - 4;
    S[STAN.apexY] = top + dome + SS.coneH * S[STAN.coneK];
    let my = top + dome + SS.coneH + SS.threadDy;
    const lim = SS.boomY - SS.kneeDrop - 2;
    if (my > lim) my = lim;
    D[DW] = S[STAN.offX] + SS.threadDx;
    D[DW + 1] = my;
  }
  /** Paczka `n` jednostek żużla wchodzi w nitkę (kolejka drogi do odbieralnika). */
  function threadPush(n) {
    const t = S[STAN.time];
    if (nThread > 0) {
      const l = (tHead + nThread - 1) % NT;
      if (t - tBorn[l] < 1 / 60 || nThread >= NT) { tUnits[l] += n; return; }
    }
    const i = (tHead + nThread) % NT;
    tUnits[i] = n;
    tBorn[i] = t;
    nThread++;
  }
  /** Zerwana nitka znika w dzwonie (od korzenia). */
  function threadSnap() {
    if (S[STAN.thrHi] > 0) {
      S[STAN.thrLo] += X[XH] / PROCES.threadSnap;
      if (S[STAN.thrLo] >= S[STAN.thrHi]) { S[STAN.thrLo] = 0; S[STAN.thrHi] = 0; }
    }
  }

  function stepSuck() {
    const h = X[XH];
    const st = S[STAN.suck];
    const kneeY = SS.boomY - SS.kneeDrop;
    let flow = 0;
    let cone = 0;
    if (st === 0) {
      S[STAN.headX] = SS.parkX;
      S[STAN.mouthX] = SS.parkX - SS.neckPark;
      S[STAN.mouthY] = kneeY - 1;
      S[STAN.rootY] = 0;
      S[STAN.apexY] = 0;
      // start: czapa zebrała większość żużla albo minął czas zbierania
      if (S[STAN.phase] === PHASE.REFINE && S[STAN.radius] > 1 && Cn[LICZNIK.slagFloes] > 0
        && (S[STAN.capMass] >= PROCES.suckCapShare * Cn[LICZNIK.slagFloes] || S[STAN.phaseT] >= PROCES.suckWait)) {
        S[STAN.suck] = 1;
        S[STAN.suckT] = 0;
      }
    } else {
      S[STAN.suckT] += h;
      const t = S[STAN.suckT];
      headWorkD();
      if (st === 1 || st === 3) {
        // dojazd: wózek po wysięgniku, potem szyja opuszcza dzwon; powrót — odwrotnie
        let u = st === 1 ? t / PROCES.suckApproach : 1 - t / PROCES.suckRetract;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        X[XS] = u / 0.62; sm3(); const ka = X[XS];
        X[XS] = (u - 0.5) / 0.5; sm3(); const kb = X[XS];
        const hx = SS.parkX + (SS.workX - SS.parkX) * ka;
        const rx = hx - SS.neckPark;
        const ry = kneeY - 1;
        if (st === 1) { X[XMX] = D[DW]; X[XMY] = D[DW + 1]; }
        S[STAN.headX] = hx;
        S[STAN.mouthX] = rx + (X[XMX] - rx) * kb;
        S[STAN.mouthY] = ry + (X[XMY] - ry) * kb;
        if (st === 1 && t >= PROCES.suckApproach) { S[STAN.suck] = 2; S[STAN.suckT] = 0; X[XFLOWT] = 0; X[XSUCK] = 0; }
        if (st === 3) {
          threadSnap();
          if (t >= PROCES.suckRetract) {
            S[STAN.suck] = 0; S[STAN.suckT] = 0; S[STAN.thrLo] = 0; S[STAN.thrHi] = 0;
            Cn[LICZNIK.sucks]++;
            S[STAN.sucks] = Cn[LICZNIK.sucks];
          }
        }
      } else {
        // ściąganie: dzwon trzyma się wierzchołka czapy (z bezwładnością napędu)
        const km = 1 - Math.exp(-h / 0.22);
        X[XMX] += (D[DW] - X[XMX]) * km;
        X[XMY] += (D[DW + 1] - X[XMY]) * km;
        S[STAN.headX] = SS.workX;
        S[STAN.mouthX] = X[XMX];
        S[STAN.mouthY] = X[XMY];
        if (Cn[LICZNIK.slagFloes] === 0) {
          // kula CZYSTA: nitka się rwie, po powierzchni schodzi od bieguna fala
          S[STAN.suck] = 3;
          S[STAN.suckT] = 0;
          D[DN] = 0; D[DN + 1] = 1; D[DN + 2] = 0;
          D[DAMP] = 1.1;
          rippleD();
          D[DK] = 0.012;
          kickModesInto(modeV, D);
        } else if (capI >= 0) {
          if (S[STAN.thrLo] > 0) threadSnap();         // zerwana nitka najpierw znika w dzwonie, potem podnosi się nowa
          else {
            cone = 1;
            S[STAN.thrHi] += h / PROCES.threadForm;
            if (S[STAN.thrHi] >= 1) {
              S[STAN.thrHi] = 1;
              X[XFLOWT] += h;
              const ramp = X[XFLOWT] < 0.5 ? X[XFLOWT] / 0.5 : 1;
              X[XSUCK] += suckUnitRate * ramp * h;
              let n = Math.floor(X[XSUCK]);
              if (n > 0) {
                X[XSUCK] -= n;
                if (n > kMass[capI]) n = kMass[capI];
                kMass[capI] -= n;
                Cn[LICZNIK.slagFloes] -= n;
                Cn[LICZNIK.slagThread] += n;
                threadPush(n);
                flow = n / h;
                gasSuck(n);
              }
            }
          }
        } else {
          // pod dzwonem nie ma żużla (reszta wysp dopływa): nitka rwie się
          X[XFLOWT] = 0;
          X[XSUCK] = 0;
          threadSnap();
        }
      }
    }
    S[STAN.suckFlow] += (flow / SLAG_EQ_PER_TON - S[STAN.suckFlow]) * (1 - Math.exp(-h / 0.12));
    S[STAN.coneK] += (cone - S[STAN.coneK]) * (1 - Math.exp(-h / (cone ? 0.2 : 0.1)));
    // kula czysta: po ściągnięciu żużla, do końca obiegu
    const p = S[STAN.phase];
    const clean = (p === PHASE.REFINE || p === PHASE.CLEAR || p === PHASE.DROP) && Cn[LICZNIK.slagFloes] === 0 && nFloes === 0 && S[STAN.radius] > 1 ? 1 : 0;
    S[STAN.clean] += (clean - S[STAN.clean]) * (1 - Math.exp(-h / 0.35));
  }

  // --- droga żużla do odbieralnika i granulki ----------------------------------------------------------------------
  /**
   * Granulka o masie `units` wypada z wylotu: pole lądowania pod wylotem (z rozrzutem), staczanie po kopczyku do
   * niższego sąsiada, lot balistyczny w polu grawitacji koryta prosto na swoje miejsce (miejsce zajęte od razu).
   */
  function spawnGranule(units) {
    Cn[LICZNIK.slagThread] -= units;
    if (nGran >= NG) { Cn[LICZNIK.slagOut] += units; return; }     // koryto pełne (nie zdarza się): prosto do kanału
    Cn[LICZNIK.slagCatcher] += units;
    Cn[LICZNIK.granules]++;
    const rad = PROCES.granuleR * Math.cbrt(units / PROCES.granuleUnits);
    let ia = SPOUT_A + (rnd30() % 5) - 2;
    let ir = SPOUT_R + (rnd30() % 3) - 1;
    ia = ia < 0 ? 0 : ia >= TA ? TA - 1 : ia;
    ir = ir < 0 ? 0 : ir >= TR ? TR - 1 : ir;
    // (kąt usypu: granulka stacza się, póki sąsiad leży niżej o `trayStep`; wzdłuż koryta toczy się także po równym,
    // gdy pole o dwa dalej leży niżej — przy 120 t żużla kopczyk rozkłada się po całym korycie i zostaje pod jego
    // obrzeżem, daleko od wylotu)
    for (let k = 0; k < 20; k++) {
      let bi = -1;
      const h0 = trayH[ia * TR + ir];
      let bh = h0 - PROCES.trayStep;
      if (ia > 0 && trayH[(ia - 1) * TR + ir] < bh) { bh = trayH[(ia - 1) * TR + ir]; bi = 0; }
      if (ia < TA - 1 && trayH[(ia + 1) * TR + ir] < bh) { bh = trayH[(ia + 1) * TR + ir]; bi = 1; }
      if (ir > 0 && trayH[ia * TR + ir - 1] < bh) { bh = trayH[ia * TR + ir - 1]; bi = 2; }
      if (ir < TR - 1 && trayH[ia * TR + ir + 1] < bh) { bh = trayH[ia * TR + ir + 1]; bi = 3; }
      if (bi < 0) {
        if (ia > 1 && trayH[(ia - 1) * TR + ir] <= h0 && trayH[(ia - 2) * TR + ir] < bh) { bh = trayH[(ia - 2) * TR + ir]; bi = 0; }
        if (ia < TA - 2 && trayH[(ia + 1) * TR + ir] <= h0 && trayH[(ia + 2) * TR + ir] < bh) bi = 1;
      }
      if (bi < 0) break;
      if (bi === 0) ia--; else if (bi === 1) ia++; else if (bi === 2) ir--; else ir++;
    }
    const cell = ia * TR + ir;
    const i = nGran++;
    const a = i * 3;
    const u1 = rnd30() * R30;
    const u2 = rnd30() * R30;
    const az = TRAY.az0 + (ia + 0.5 + (u1 - 0.5) * 0.6) * TRAY_DA;
    const rr = TRAY.rIn + TRAY_PAD + (ir + 0.5 + (u2 - 0.5) * 0.6) * TRAY_DR;
    const tx = Math.cos(az) * rr;
    const ty = TRAY.floorY + trayH[cell] + rad * 0.85;
    const tz = Math.sin(az) * rr;
    trayH[cell] += rad * 1.45;
    const x0 = SPOUT_X + (u1 - 0.5) * 8;
    const y0 = TRAY.spoutY - 4;
    const z0 = SPOUT_Z + (u2 - 0.5) * 8;
    const g = PROCES.trayGravity;
    const v0 = 34;
    const drop = y0 - ty > 4 ? y0 - ty : 4;
    const tf = (-v0 + Math.sqrt(v0 * v0 + 2 * g * drop)) / g;
    gP0[a] = x0; gP0[a + 1] = y0; gP0[a + 2] = z0;
    gV0[a] = (tx - x0) / tf; gV0[a + 1] = -v0; gV0[a + 2] = (tz - z0) / tf;
    gTo[a] = tx; gTo[a + 1] = ty; gTo[a + 2] = tz;
    gP[a] = x0; gP[a + 1] = y0; gP[a + 2] = z0;
    gPrev[a] = x0; gPrev[a + 1] = y0; gPrev[a + 2] = z0;
    gT0[i] = S[STAN.time];
    gTf[i] = tf;
    gRad[i] = rad;
    gMass[i] = units;
    gHeat[i] = 1;
    gCol[i] = ia;
    gFly[i] = 1;
    gId[i] = ++granSeq;
    nFly++;
    const glow = S[STAN.trayGlow] + 0.35;
    S[STAN.trayGlow] = glow > 1 ? 1 : glow;
  }

  function stepTray() {
    const h = X[XH];
    const t = S[STAN.time];
    // paczki żużla, które przejechały nitkę i rurociąg, wypadają z wylotu jako granulki
    while (nThread > 0 && t - tBorn[tHead] >= PROCES.slagTransit) {
      X[XGRAN] += tUnits[tHead];
      tHead = (tHead + 1) % NT;
      nThread--;
    }
    while (X[XGRAN] >= PROCES.granuleUnits) { X[XGRAN] -= PROCES.granuleUnits; spawnGranule(PROCES.granuleUnits); }
    if (X[XGRAN] > 0 && nThread === 0 && S[STAN.suck] !== 2) { const n = X[XGRAN]; X[XGRAN] = 0; spawnGranule(n); }
    S[STAN.pipeGlow] += ((nThread > 0 ? 1 : 0) - S[STAN.pipeGlow]) * (1 - Math.exp(-h / (nThread > 0 ? 0.3 : 1.2)));
    S[STAN.trayGlow] *= Math.exp(-h / 0.8);
    if (nGran === 0) { S[STAN.trayDump] = 0; S[STAN.trayN] = 0; return; }
    // zsyp: przed następnym ściąganiem żaluzje dna otwierają się i ostygłe granulki zsuwają się do kanału
    if (X[XDUMP] > 0 || (S[STAN.phase] === PHASE.GATHER && S[STAN.phaseT] >= PROCES.trayDumpAt && nFly === 0 && S[STAN.suck] === 0)) X[XDUMP] += h / PROCES.trayDumpTime;
    const dump = X[XDUMP];
    const kh = Math.exp(-h / PROCES.trayCool);
    const g = PROCES.trayGravity;
    for (let i = 0; i < nGran; i++) {
      const a = i * 3;
      gHeat[i] *= kh;
      if (gFly[i]) {
        const q = t - gT0[i];
        if (q >= gTf[i]) {
          gP[a] = gTo[a]; gP[a + 1] = gTo[a + 1]; gP[a + 2] = gTo[a + 2];
          gFly[i] = 0;
          nFly--;
        } else {
          gP[a] = gP0[a] + gV0[a] * q;
          gP[a + 1] = gP0[a + 1] + gV0[a + 1] * q - 0.5 * g * q * q;
          gP[a + 2] = gP0[a + 2] + gV0[a + 2] * q;
        }
      } else if (dump > 0) {
        let u = (dump - 0.4 * gCol[i] / TA) / 0.6;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        gP[a + 1] = gTo[a + 1] - u * u * (gTo[a + 1] - TRAY.floorY + 2 * gRad[i] + 30);
      }
    }
    if (dump >= 1) {
      // wszystko zsunęło się pod dno: granulki wywiezione
      let out = 0;
      for (let i = 0; i < nGran; i++) out += gMass[i];
      Cn[LICZNIK.slagCatcher] -= out;
      Cn[LICZNIK.slagOut] += out;
      nGran = 0;
      nFly = 0;
      trayH.fill(0);
      X[XDUMP] = 0;
    }
    S[STAN.trayDump] = X[XDUMP];
    S[STAN.trayN] = nGran;
  }

  /** Gładki krok 0…1 z X[15] → X[15] (bez liczb zmiennoprzecinkowych w argumentach). */
  function sm3() {
    const t = X[XS];
    X[XS] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  }

  // --- GAZ KOMORY (runda 5; stałe i tabela rodzajów: `gaz.js`) ----------------------------------------------------
  // Droga jednostek: ziarno (gaz `split[2]`) → kupa: dym i wyrzuty wydane przed czasem (zaliczka spłacana przy
  // wchłonięciu) albo kąpiel → wtopienie: część od razu do komory (rekord WTOPIENIE), reszta do kąpieli → kąpiel: bąble
  // (ponad rezerwy), opary ssawy (rezerwa), kłąb uderzenia (cała reszta) → komora (`gasAir`) → odciąg (prawo pierwszego
  // rzędu, czas pobytu zależny od wentylacji) → rura zbiorcza (kolejka `ductDelay` s) → zbiorniki tlenu → sieć ringu.
  // Funkcje nie przyjmują i nie zwracają liczb zmiennoprzecinkowych (krok bez alokacji): rekord idzie przez brudnopis GD.

  /**
   * `units` jednostek do rekordu `slot`: punkt GD[0…2], prędkość (wektor) GD[3…5], temperatura GD[6], promień plamy
   * GD[7], udział `dym` GD[8], rodzaj GD[9]. Rekord, którego jednostek odbiorca jeszcze nie zabrał, uśrednia punkt,
   * prędkość i cechy wagą jednostek. Jednostki wchodzą do komory.
   */
  function gasPut(slot, units) {
    if (units <= 0) return;
    const o = slot * GAZ_STRIDE;
    const Rr = gasRec;
    const u0 = Rr[o + 3];
    let px = GD[0];
    let py = GD[1];
    let pz = GD[2];
    let vx = GD[3];
    let vy = GD[4];
    let vz = GD[5];
    let tt = GD[6];
    let rad = GD[7];
    let dym = GD[8];
    if (u0 > 0) {
      const w1 = units / (u0 + units);
      const w0 = 1 - w1;
      const sp = Rr[o + 7];
      px = Rr[o] * w0 + px * w1; py = Rr[o + 1] * w0 + py * w1; pz = Rr[o + 2] * w0 + pz * w1;
      vx = Rr[o + 4] * sp * w0 + vx * w1; vy = Rr[o + 5] * sp * w0 + vy * w1; vz = Rr[o + 6] * sp * w0 + vz * w1;
      tt = Rr[o + 9] * w0 + tt * w1; rad = Rr[o + 10] * w0 + rad * w1; dym = Rr[o + 11] * w0 + dym * w1;
    }
    let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp < 1e-6) { vx = 0; vy = 1; vz = 0; sp = 1e-6; }
    Rr[o] = px; Rr[o + 1] = py; Rr[o + 2] = pz; Rr[o + 3] = u0 + units;
    Rr[o + 4] = vx / sp; Rr[o + 5] = vy / sp; Rr[o + 6] = vz / sp; Rr[o + 7] = sp;
    Rr[o + 8] = GD[9]; Rr[o + 9] = tt; Rr[o + 10] = rad; Rr[o + 11] = dym;
    Cn[LICZNIK.gasAir] += units;
    X[XGEM] += units;
  }

  /**
   * Gaz wtapianego ziarna (normalna kuli D[0…2]): `airShare` od razu do komory — rekord sektora pasa kuli (8 sektorów
   * po azymucie), wypływ po normalnej 60–90 j./s + prędkość powierzchni wirującej kuli; reszta rozpuszcza się w kąpieli.
   * Nie zmienia D[0…2] (zmienia D[DOFF]).
   */
  function gasMeltD() {
    if (GU <= 0) return;
    X[XG60] += GP.airShare * GU;
    const a = Math.floor(X[XG60]);
    X[XG60] -= a;
    Cn[LICZNIK.gasBath] += GU - a;
    if (a <= 0) return;
    const nx = D[DN];
    const ny = D[DN + 1];
    const nz = D[DN + 2];
    let az = Math.atan2(nz, nx);
    if (az < 0) az += TAU;
    let k = Math.floor(az / TAU * GAZ_SLOT.meltN);
    if (k >= GAZ_SLOT.meltN) k = GAZ_SLOT.meltN - 1;
    const R = S[STAN.radius] > 1 ? S[STAN.radius] : 1;
    surfaceOffsetInto(modeA, D);
    const rr = R * (1 + D[DOFF] + SLAG.lift) + 3;
    GD[0] = S[STAN.offX] + nx * rr; GD[1] = S[STAN.offY] + ny * rr; GD[2] = S[STAN.offZ] + nz * rr;
    const vn = 60 + 30 * (rndG30() * R30);
    const w = S[STAN.omega] * R;                       // powierzchnia wirującej kuli: ω · R · (n.z, 0, −n.x)
    GD[3] = nx * vn + nz * w; GD[4] = ny * vn; GD[5] = nz * vn - nx * w;
    GD[6] = 0.8; GD[7] = 45; GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.WTOPIENIE].dym; GD[9] = GAZ_RODZAJ.WTOPIENIE;
    gasPut(GAZ_SLOT.melt + k, a);
    // punkt rekordu = średni KIERUNEK wtopień sektora na powierzchni (średnia punktów łuku leżałaby pod nią)
    const o = (GAZ_SLOT.melt + k) * GAZ_STRIDE;
    const dx = gasRec[o] - S[STAN.offX];
    const dy = gasRec[o + 1] - S[STAN.offY];
    const dz = gasRec[o + 2] - S[STAN.offZ];
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    gasRec[o] = S[STAN.offX] + dx / dl * rr; gasRec[o + 1] = S[STAN.offY] + dy / dl * rr; gasRec[o + 2] = S[STAN.offZ] + dz / dl * rr;
  }

  /**
   * Punkt na obrysie kupy w kierunku lokalnym GD[10…12] (układ kupy — obraca się z nią) → punkt GD[0…2] 4 j. nad
   * obrysem, prędkość GD[3…5] = normalna obrysu × GD[13]. Obrys: elipsoida (półoś w planie `heapR`, w pionie
   * × heapB / heapA); przy topieniu nie mniej niż powierzchnia jądra.
   */
  function gasHeapPoint() {
    const c = Math.cos(S[STAN.heapRot]);
    const s = Math.sin(S[STAN.heapRot]);
    const lx = GD[10];
    const ly = GD[11];
    const lz = GD[12];
    const wx = c * lx - s * lz;
    const wy = ly;
    const wz = s * lx + c * lz;
    const A = S[STAN.heapR] > 20 ? S[STAN.heapR] : 20;
    const Bv = A * PROCES.heapB / PROCES.heapA;
    const q = Math.sqrt((wx / A) * (wx / A) + (wy / Bv) * (wy / Bv) + (wz / A) * (wz / A)) || 1;
    let t = 1 / q;
    const R = S[STAN.radius];
    if (R > 1 && t < R * 1.06) t = R * 1.06;
    let nx = wx / (A * A);
    let ny = wy / (Bv * Bv);
    let nz = wz / (A * A);
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    GD[0] = S[STAN.offX] + wx * t + nx * 4; GD[1] = S[STAN.offY] + wy * t + ny * 4; GD[2] = S[STAN.offZ] + wz * t + nz * 4;
    GD[3] = nx * GD[13]; GD[4] = ny * GD[13]; GD[5] = nz * GD[13];
  }

  /** Opary przy ściąganiu żużla: `n` porcji żużla weszło w nitkę — rezerwa kąpieli wychodzi proporcjonalnie u nasady nitki. */
  function gasSuck(n) {
    if (GU <= 0) return;
    X[XGSU] += GP.suckShare * cycleGas * n / chargeGrains;
    let e = Math.floor(X[XGSU]);
    if (e <= 0) return;
    X[XGSU] -= e;
    if (e > X[XGRES]) e = X[XGRES];
    if (e > Cn[LICZNIK.gasBath]) e = Cn[LICZNIK.gasBath];
    if (e <= 0) return;
    X[XGRES] -= e;
    Cn[LICZNIK.gasBath] -= e;
    const R = S[STAN.radius];
    // nad wierzchołkiem stożka wyciąganego z czapy pod nitką (nie niżej niż powierzchnia kuli z soczewką żużla)
    const top = S[STAN.offY] + R * (1 + SLAG.lift);
    GD[0] = S[STAN.offX]; GD[1] = (S[STAN.apexY] > top ? S[STAN.apexY] : top) + 4; GD[2] = S[STAN.offZ];
    GD[3] = 0; GD[4] = 40; GD[5] = 0;
    GD[6] = 0.7; GD[7] = 30; GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.SSAWA].dym; GD[9] = GAZ_RODZAJ.SSAWA;
    gasPut(GAZ_SLOT.suck, e);
  }

  /** Wolny slot w zakresie [`from`, `from + n`) (zajętość z czasu), −1 — brak. */
  function gasFreeSlot(from, n) {
    const t = S[STAN.time];
    for (let k = 0; k < n; k++) if (gasBusy[from + k] <= t) return from + k;
    return -1;
  }

  /** Losowanie następnego bąbla: strefa (0 pas równika, 1 górna półkula poza czapą — tylko małe, 2 dolna) i wielkość. */
  function gasNextBubble() {
    const u = rndG30() * R30;
    const z = u < GP.bubbleZones[0] ? 0 : u < GP.bubbleZones[1] ? 1 : 2;
    const v = rndG30() * R30;
    const tons = z === 1 ? GP.bubbleTopT * (0.5 + 0.5 * v) : GP.bubbleT[0] + (GP.bubbleT[1] - GP.bubbleT[0]) * v * v;
    X[XGZONE] = z;
    X[XGNEXT] = Math.max(1, Math.round(tons * UNITS_PER_TON));
  }

  /** Bąbel kąpieli pęka w slocie `slot`: punkt na powierzchni kuli w swojej strefie, strumień po normalnej. */
  function gasBubble(slot) {
    const n = X[XGNEXT];
    const R = S[STAN.radius];
    const sb = Math.sin(GP.bandLat * DEG);
    let z = X[XGZONE];
    // ODSUW (przed zrzutem): kąpiel dogazowuje pasem równika — gejzery ku ścianom, lekko w dół (gorąca mgiełka przy
    // ścianach pod pasem wyświetlacza, w strugach ku przymkniętym okapom)
    const ph = S[STAN.phase];
    const clearing = ph === PHASE.CLEAR || ph === PHASE.DROP;
    if (clearing) z = 0;
    // górna półkula poza czapą żużla: szerokość od pasa do brzegu czapy (bez miejsca — pas)
    const top = Math.sin(Math.PI / 2 - S[STAN.capAlpha] - 0.12);
    if (z === 1 && top < sb + 0.05) z = 0;
    const u = rndG30() * R30;
    const sl = z === 0 ? -sb + 2 * sb * u : z === 1 ? sb + (top - sb) * u : -1 + (1 - sb) * u;
    const cl = Math.sqrt(1 - sl * sl);
    const az = rndG30() * R30 * TAU;
    D[DN] = cl * Math.cos(az); D[DN + 1] = sl; D[DN + 2] = cl * Math.sin(az);
    surfaceOffsetInto(modeA, D);
    const rr = R * (1 + D[DOFF] + (z === 1 ? 0 : SLAG.lift)) + 3;
    GD[0] = S[STAN.offX] + D[DN] * rr; GD[1] = S[STAN.offY] + D[DN + 1] * rr; GD[2] = S[STAN.offZ] + D[DN + 2] * rr;
    const sp = 150 + 70 * (rndG30() * R30);
    if (clearing) {
      // kierunek: pozioma składowa normalnej i lekko w dół (jednostkowy)
      const hx = D[DN];
      const hz = D[DN + 2];
      const hl = Math.sqrt(hx * hx + hz * hz) || 1;
      const k = Math.sqrt(1 - 0.3 * 0.3) / hl;
      GD[3] = hx * k * sp; GD[4] = -0.3 * sp; GD[5] = hz * k * sp;
    } else {
      GD[3] = D[DN] * sp; GD[4] = D[DN + 1] * sp; GD[5] = D[DN + 2] * sp;
    }
    GD[6] = 0.95; GD[7] = 18 + 22 * Math.sqrt(n / (GP.bubbleT[1] * UNITS_PER_TON)); GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.BABEL].dym; GD[9] = GAZ_RODZAJ.BABEL;
    Cn[LICZNIK.gasBath] -= n;
    gasPut(slot, n);
    gasBusy[slot] = S[STAN.time] + GP.bubbleBusy;
    // „kąpiel się gotuje”: pękający bąbel zostawia zmarszczkę na powierzchni kuli (siła 0,3 zmarszczki ziarna, większy
    // bąbel — mocniejsza). Tylko obraz: wpis w puli zmarszczek, bez licznika i bez modów — gaz nie zmienia przebiegu
    // reszty symulacji (mody kuli wchodzą w zderzenia ziaren)
    {
      const o = rippleHead * EVENT_STRIDE;
      const Rp = view.zmarszczki;
      Rp[o] = D[DN]; Rp[o + 1] = D[DN + 1]; Rp[o + 2] = D[DN + 2]; Rp[o + 3] = S[STAN.time];
      Rp[o + 4] = 0.3 * (0.6 + 0.4 * Math.sqrt(n / (GP.bubbleT[1] * UNITS_PER_TON)));
      rippleHead = (rippleHead + 1) % POOL.ripples;
    }
    Cn[LICZNIK.bubbles]++;
    X[XGBUB] -= n;
    gasNextBubble();
  }

  /** Gaz z rury dociera do separatora: tlen do napełnianego zbiornika (pełny — następny); bez miejsca czeka w rurze. */
  function gasArrive(a) {
    Cn[LICZNIK.gasDuct] -= a;
    let rest = a;
    for (let guard = 0; rest > 0 && guard <= NTANK; guard++) {
      let f = S[STAN.tankFill] | 0;
      if (tankFull[f]) {
        let nf = -1;
        for (let k = 1; k <= NTANK; k++) { const q = (f + k) % NTANK; if (!tankFull[q]) { nf = q; break; } }
        if (nf < 0) break;
        f = nf;
        S[STAN.tankFill] = f;
      }
      const room = TANK_CAP - tank[f];
      const put = rest < room ? rest : room;
      tank[f] += put;
      rest -= put;
      if (tank[f] >= TANK_CAP) tankFull[f] = 1;
    }
    Cn[LICZNIK.gasTank] += a - rest;
    X[XGARR] += a - rest;
    if (rest > 0) {
      // wszystkie zbiorniki pełne (nie zdarza się przy oddawaniu w 4 s): gaz wraca na początek kolejki rury
      Cn[LICZNIK.gasDuct] += rest;
      ductRing[X[XGDI] % DUCT_N] += rest;
    }
  }

  /** Wejście w fazę: docisk — nowa kupa (budżet dymu i wyrzutów), dokarmianie — rezerwa kąpieli na opary ssawy. */
  function gasPhaseEnter(p) {
    if (p === PHASE.PRESS) {
      X[XGN0] = nHeap - hHead;
      X[XGE0] = 0; X[XGE1] = 0; X[XGS1] = 0; X[XGP0] = 0;
      for (let k = 0; k < GAZ_SLOT.heapN; k++) heapAcc[k] = 0;
    } else if (p === PHASE.FEED) {
      X[XGRES] = Math.round(GP.suckShare * cycleGas);
      X[XGSU] = 0;
      X[XGBUB] = 0;
    }
  }

  /** Krok gazu (koniec podkroku): źródła kupy, bąble, kłąb uderzenia, wentylacja i odciąg, rura, zbiorniki, wskaźniki. */
  function stepGas() {
    const h = X[XH];
    const p = S[STAN.phase];
    const time = S[STAN.time];
    if (p !== X[XGPH]) { gasPhaseEnter(p); X[XGPH] = p; }
    const heapN = nHeap - hHead;
    // --- DYM KUPY (docisk, topienie): tempo z przyrostu żaru kupy; więcej tam, gdzie kupa leży pod segmentem cewki ---
    if ((p === PHASE.PRESS || p === PHASE.MELT) && heapN > 0 && GU > 0) {
      let pr = S[STAN.heapHeat] / GP.heapHeatFull;
      if (pr > 1) pr = 1;
      if (pr > X[XGP0]) X[XGP0] = pr;
      const d = GP.heapSmoke * GU * X[XGN0] * X[XGP0] - X[XGE0];
      const c = Math.cos(S[STAN.heapRot]);
      const s = Math.sin(S[STAN.heapRot]);
      if (d > 0) {
        X[XGE0] += d;
        // waga punktu: 0,3 + bliskość segmentu cewki (punkty obracają się z kupą pod nieruchomymi segmentami)
        let sw = 0;
        for (let k = 0; k < GAZ_SLOT.heapN; k++) {
          const lx = heapDir[k * 3];
          const lz = heapDir[k * 3 + 2];
          const wx = c * lx - s * lz;
          const wy = heapDir[k * 3 + 1];
          const wz = s * lx + c * lz;
          let pw = 0;
          for (let q = 0; q < NPAD; q++) {
            const dd = wx * padDirs[q * 3] + wy * padDirs[q * 3 + 1] + wz * padDirs[q * 3 + 2];
            if (dd > pw) pw = dd;
          }
          pw = (pw - 0.55) / 0.4;
          pw = pw <= 0 ? 0 : pw >= 1 ? 1 : pw * pw * (3 - 2 * pw);
          heapW[k] = 0.3 + pw;
          sw += heapW[k];
        }
        for (let k = 0; k < GAZ_SLOT.heapN; k++) heapAcc[k] += d * heapW[k] / sw;
      }
      const heat = S[STAN.heapHeat];
      for (let k = 0; k < GAZ_SLOT.heapN; k++) {
        let e = Math.floor(heapAcc[k]);
        if (e <= 0) continue;
        heapAcc[k] -= e;
        const cap = GU * heapN - Cn[LICZNIK.gasAdvance];
        if (e > cap) e = cap;
        if (e <= 0) continue;
        GD[10] = heapDir[k * 3]; GD[11] = heapDir[k * 3 + 1]; GD[12] = heapDir[k * 3 + 2];
        GD[13] = 30 + 15 * (heat > 1 ? 1 : heat);
        gasHeapPoint();
        GD[6] = 0.35 + 0.2 * (heat > 1 ? 1 : heat); GD[7] = 40; GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.DYM_KUPY].dym; GD[9] = GAZ_RODZAJ.DYM_KUPY;
        Cn[LICZNIK.gasAdvance] += e;
        gasPut(GAZ_SLOT.heap + k, e);
      }
    }
    // --- WYRZUTY Z KUPY (topienie): porcje `burstT` w tempie wchłaniania kupy; każda wypływa przez `burstTime` ---
    if (p === PHASE.MELT && heapN > 0 && GU > 0) {
      let u = (S[STAN.phaseT] / PROCES.meltTime - PROCES.meltPre) / (1 - PROCES.meltPre);
      u = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
      const tgt = GP.heapBurst * GU * X[XGN0] * u;
      if (tgt > X[XGE1]) X[XGE1] = tgt;
      const portion = Math.round(GP.burstT * UNITS_PER_TON);
      if (X[XGE1] - X[XGS1] >= portion) {
        const slot = gasFreeSlot(GAZ_SLOT.burst, NBURST);
        if (slot >= 0) {
          const k = slot - GAZ_SLOT.burst;
          burstRem[k] = portion;
          burstLeft[k] = GP.burstTime;
          // kierunek w układzie kupy: przewaga pasa równika
          const sl = (2 * (rndG30() * R30) - 1) * 0.55;
          const cl = Math.sqrt(1 - sl * sl);
          const az = rndG30() * R30 * TAU;
          burstDir[k * 3] = cl * Math.cos(az); burstDir[k * 3 + 1] = sl; burstDir[k * 3 + 2] = cl * Math.sin(az);
          burstSpd[k] = 120 + 60 * (rndG30() * R30);
          gasBusy[slot] = time + GP.burstTime + 0.05;
          X[XGS1] += portion;
          Cn[LICZNIK.bursts]++;
        }
      }
    }
    for (let k = 0; k < NBURST; k++) {
      if (burstRem[k] <= 0) continue;
      if (heapN <= 0 || p !== PHASE.MELT) { burstRem[k] = 0; continue; }     // kupa wchłonięta: reszta gazu została w ziarnach
      let e = burstLeft[k] <= h ? burstRem[k] : Math.round(burstRem[k] * h / burstLeft[k]);
      const cap = GU * heapN - Cn[LICZNIK.gasAdvance];
      if (e > cap) { e = cap > 0 ? cap : 0; burstRem[k] = e; }
      burstRem[k] -= e;
      burstLeft[k] -= h;
      if (burstLeft[k] <= 0) burstRem[k] = 0;
      if (e <= 0) continue;
      GD[10] = burstDir[k * 3]; GD[11] = burstDir[k * 3 + 1]; GD[12] = burstDir[k * 3 + 2]; GD[13] = burstSpd[k];
      gasHeapPoint();
      GD[6] = 0.75; GD[7] = 30; GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.WYRZUT].dym; GD[9] = GAZ_RODZAJ.WYRZUT;
      Cn[LICZNIK.gasAdvance] += e;
      gasPut(GAZ_SLOT.burst + k, e);
    }
    // --- BĄBLE (dokarmianie, rafinacja): kąpiel oddaje gaz ponad rezerwy z czasem `bathTau` ---
    // ODSUW (i zrzut do włączenia grawitacji): kąpiel oddaje rezerwę `clearShare` szybciej (`clearTau`) — gorąca mgiełka
    // oparów zbiera się przy przymkniętych okapach w pierścieniu przy ścianie; po włączeniu grawitacji to ona idzie
    // w górę po ścianach (drugi, fizyczny znak grawitacji obok wyświetlacza — SPEC wpis 7)
    const clearing = p === PHASE.CLEAR || (p === PHASE.DROP && !S[STAN.grav] && !(S[STAN.impactT] >= 0));
    if ((p === PHASE.FEED || p === PHASE.REFINE || clearing) && S[STAN.radius] > 1 && GU > 0) {
      const free = Cn[LICZNIK.gasBath] - X[XGRES] - (GP.impactShare + (clearing ? 0 : GP.clearShare)) * cycleGas;
      if (free > 0) X[XGBUB] += free * h / (clearing ? GP.clearTau : GP.bathTau);
      if (X[XGNEXT] <= 0) gasNextBubble();
      if (X[XGBUB] >= X[XGNEXT] && Cn[LICZNIK.gasBath] >= X[XGNEXT]) {
        const slot = gasFreeSlot(GAZ_SLOT.bubble, GAZ_SLOT.bubbleN);
        if (slot >= 0) gasBubble(slot);
      }
    } else X[XGBUB] = 0;
    // --- KŁĄB UDERZENIA (zrzut): cała kąpiel w `impactTime` s z linii styku masy ze stożkiem, po stożku w górę ---
    if (impacted && X[XGIMP0] > 0) {
      const f = S[STAN.impactT] >= GP.impactTime ? 1 : S[STAN.impactT] / GP.impactTime;
      let e = f >= 1 ? Cn[LICZNIK.gasBath] : Math.floor(X[XGIMP0] * f - X[XGIMPA]);
      if (e > Cn[LICZNIK.gasBath]) e = Cn[LICZNIK.gasBath];
      if (e > 0) {
        X[XGIMPA] += e;
        Cn[LICZNIK.gasBath] -= e;
        let r = S[STAN.frontR] > S[STAN.lakeR] ? S[STAN.frontR] : S[STAN.lakeR];
        r = r < FUN.throatR + 30 ? FUN.throatR + 30 : r > FUN.rimR - 20 ? FUN.rimR - 20 : r;
        const y = FUN.throatY + (r - FUN.throatR) / FSL + 6;
        const NI = GAZ_SLOT.impactN;
        const base = Math.floor(e / NI);
        const extra = e - base * NI;
        const sp = 300 + 80 * (rndG30() * R30);
        for (let j = 0; j < NI; j++) {
          const ej = base + (j < extra ? 1 : 0);
          if (ej <= 0) continue;
          const a = X[XGIMPR] + j * TAU / NI;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          GD[0] = ca * r; GD[1] = y; GD[2] = sa * r;
          GD[3] = ca * FSL / FNL * sp; GD[4] = sp / FNL; GD[5] = sa * FSL / FNL * sp;
          GD[6] = 0.9; GD[7] = 60; GD[8] = GAZ_RODZAJE[GAZ_RODZAJ.UDERZENIE].dym; GD[9] = GAZ_RODZAJ.UDERZENIE;
          gasPut(GAZ_SLOT.impact + j, ej);
        }
      }
      if (f >= 1 && Cn[LICZNIK.gasBath] === 0) X[XGIMP0] = 0;
    }
    // --- WENTYLACJA I ODCIĄG ---
    {
      const want = S[STAN.grav] ? -1 : 1;
      const dw = 2 * h / GP.ventRamp;
      let w = S[STAN.wentyl];
      w += want - w > dw ? dw : want - w < -dw ? -dw : want - w;
      S[STAN.wentyl] = w;
      // CYKL ODCIĄGU w dokarmianiu (runda 6): narastanie (odciąg dławiony do `pulseIdle`) → ciąg (× `pulseDraw`),
      // okres `pulsePeriod` od początku dokarmiania; siła ciągu wygładzona `pulseTau` (wentylatory się rozpędzają)
      let dw0 = 1;
      if (p === PHASE.FEED && !S[STAN.grav]) {
        S[STAN.pulseT] = S[STAN.pulseT] < 0 ? 0 : S[STAN.pulseT] + h;
        dw0 = S[STAN.pulseT] % GP.pulsePeriod < GP.pulseHold ? GP.pulseIdle : GP.pulseDraw;
      } else S[STAN.pulseT] = -1;
      S[STAN.draw] += (dw0 - S[STAN.draw]) * (1 - Math.exp(-h / GP.pulseTau));
      const pulsing = S[STAN.pulseT] >= 0 || Math.abs(S[STAN.draw] - 1) > 1e-3;
      const air = Cn[LICZNIK.gasAir];
      if (air > 0) {
        // przymknięte żaluzje okapów (poniżej `hoodMin`) dławią odciąg 0 g proporcjonalnie; w cyklu odciągu dławi
        // i przyspiesza go sama siła ciągu (żaluzje idą razem z nią)
        const hk = pulsing ? S[STAN.draw] : S[STAN.hood] >= GP.hoodMin ? 1 : S[STAN.hood] / GP.hoodMin;
        const inv = (1 + w) * 0.5 / GP.airTau0 * hk + (1 - w) * 0.5 / GP.airTauG;
        X[XGOUT] += air * (1 - Math.exp(-h * inv));
        let n = Math.floor(X[XGOUT]);
        if (n > air) n = air;
        if (n > 0) {
          X[XGOUT] -= n;
          Cn[LICZNIK.gasAir] -= n;
          Cn[LICZNIK.gasDuct] += n;
          X[XGOUTN] = n;
        }
      } else X[XGOUT] = 0;
    }
    // --- RURA ZBIORCZA: kolejka przedziałów (gaz jedzie `ductDelay` s od studni do separatora) ---
    {
      const idx = Math.floor(time / DUCT_DT);
      while (X[XGDI] < idx) {
        X[XGDI]++;
        const sl = X[XGDI] % DUCT_N;
        const a = ductRing[sl];
        if (a > 0) { ductRing[sl] = 0; gasArrive(a); }
      }
      if (X[XGOUTN] > 0) ductRing[X[XGDI] % DUCT_N] += X[XGOUTN];
    }
    // --- ZBIORNIKI: pełny oddaje tlen do sieci ringu w `tankDrain` s (jeden naraz, w kolejności napełnienia) ---
    {
      if (S[STAN.tankDrain] < 0) {
        const f = S[STAN.tankFill] | 0;
        for (let k = 1; k <= NTANK; k++) {
          const q = (f + k) % NTANK;
          if (tankFull[q]) { S[STAN.tankDrain] = q; X[XGDRN] = 0; break; }
        }
      }
      if (S[STAN.tankDrain] >= 0) {
        const k = Math.floor(S[STAN.tankDrain]);
        X[XGDRN] += TANK_CAP * h / GP.tankDrain;
        let n = Math.floor(X[XGDRN]);
        if (n > tank[k]) n = tank[k];
        X[XGDRN] -= n;
        tank[k] -= n;
        Cn[LICZNIK.gasTank] -= n;
        Cn[LICZNIK.gasOut] += n;
        if (tank[k] === 0) { tankFull[k] = 0; S[STAN.tankDrain] = -1; X[XGDRN] = 0; }
        else S[STAN.tankDrain] = k + 0.999 * (1 - tank[k] / TANK_CAP);
      }
      S[STAN.tank0] = tank[0] / TANK_CAP;
      S[STAN.tank1] = NTANK > 1 ? tank[1] / TANK_CAP : 0;
      S[STAN.tank2] = NTANK > 2 ? tank[2] / TANK_CAP : 0;
    }
    // --- liczby wskaźników ---
    const kf = 1 - Math.exp(-h / GP.flowTau);
    S[STAN.gasFlow] += (X[XGOUTN] / h / UNITS_PER_TON - S[STAN.gasFlow]) * kf;
    S[STAN.ductFlow] += (X[XGARR] / h / UNITS_PER_TON - S[STAN.ductFlow]) * kf;
    S[STAN.gasEmit] += (X[XGEM] / h / UNITS_PER_TON - S[STAN.gasEmit]) * kf;
    S[STAN.gasAirT] = Cn[LICZNIK.gasAir] / UNITS_PER_TON;
    S[STAN.gasBathT] = Cn[LICZNIK.gasBath] / UNITS_PER_TON;
    S[STAN.ductT] = Cn[LICZNIK.gasDuct] / UNITS_PER_TON;
    S[STAN.gasOutT] = Cn[LICZNIK.gasOut] / UNITS_PER_TON;
    {
      // przed zrzutem (odsuw, zrzut do włączenia grawitacji) żaluzje przymknięte do `hoodHold`: gaz zostaje przy ścianach
      const hold = p === PHASE.CLEAR || (p === PHASE.DROP && !S[STAN.grav] && !(S[STAN.impactT] >= 0));
      let hw = S[STAN.grav] ? 1 : hold ? GP.hoodHold : GP.hoodMin + (1 - GP.hoodMin) * (S[STAN.gasAirT] / GP.hoodFull);
      // cykl odciągu: w narastaniu żaluzje przymknięte do `pulseHood`, w ciągu otwarte w pełni
      if (S[STAN.pulseT] >= 0) hw = S[STAN.pulseT] % GP.pulsePeriod < GP.pulseHold ? GP.pulseHood : 1;
      if (hw > 1) hw = 1;
      S[STAN.hood] += (hw - S[STAN.hood]) * (1 - Math.exp(-h / GP.hoodTau));
    }
    // impulsy w rurze jadą z gazem (przedział rury na `DUCT_DT` s); bez gazu w rurze stoją
    {
      const fill = S[STAN.ductT] / 0.05;
      S[STAN.pipeU] += (h / DUCT_DT) * (fill > 1 ? 1 : fill);
      if (S[STAN.pipeU] > 1e6) S[STAN.pipeU] -= 1e6;
    }
    X[XGEM] = 0; X[XGOUTN] = 0; X[XGARR] = 0;
  }

  /**
   * Rekordy źródeł gazu dla odbiorcy (pole gazu): kopiuje `view.gaz` do `out` (≥ 32 × 12) i zeruje jednostki
   * rekordów — kilka kroków symulacji między krokami pola nie gubi gazu. Zwraca liczbę zabranych jednostek.
   */
  function takeGas(out) {
    const n = GAZ_SLOTS * GAZ_STRIDE;
    let sum = 0;
    for (let i = 0; i < n; i++) out[i] = gasRec[i];
    for (let s = 0; s < GAZ_SLOTS; s++) { sum += gasRec[s * GAZ_STRIDE + 3]; gasRec[s * GAZ_STRIDE + 3] = 0; }
    return sum | 0;
  }

  // --- fazy obiegu ---------------------------------------------------------
  function setPhase(p) {
    S[STAN.phase] = p;
    S[STAN.phaseT] = 0;
  }
  /** Partia wsadu wchodzi na taśmę: 0 — kupa rozruchowa (rzadsza struga), 1 — reszta wsadu. */
  function startFeed(kind) {
    if (!feeder) return;
    S[STAN.feedLeft] += kind === 0 ? heapGrains : chargeGrains - heapGrains;
    X[XRATE] = kind === 0 ? heapFeedRate : mainFeedRate;
    if (kind === 0) tint = ((Cn[LICZNIK.cycles] + 1) % 5) - 2;
  }
  /**
   * Brama 0 g przepuszcza ziarna: nigdy przy grawitacji ani gdy wyświetlacz nie pokazuje obiegu (generator 0 g
   * jeszcze nie pracuje); przy docisku, odsuwie i rafinacji zamknięta.
   */
  function gateOpen() {
    if (S[STAN.grav] || S[STAN.dsp] !== DSP.RUN) return 0;
    const p = S[STAN.phase];
    if (p === PHASE.GATHER || p === PHASE.FEED) return 1;
    if (p === PHASE.EMPTY) return S[STAN.phaseT] >= PROCES.emptyMin ? 1 : 0;
    if (p === PHASE.MELT) return S[STAN.phaseT] >= PROCES.meltTime - PROCES.gateLead ? 1 : 0;
    return 0;
  }
  /**
   * Położenie segmentów cewek dla bryły o promieniu X[XS] → D[DW] (promień pierścienia w planie), D[DW + 1] (wysokość
   * osi segmentu nad / pod równikiem). Oś segmentu leży na promieniu wychodzącym ze ŚRODKA bryły pod stałym kątem
   * `lat` do równika, w odległości promień + `gap` + `reach` — najbliższy bryle element segmentu jest zawsze `gap`
   * od jej powierzchni, przy każdym promieniu (segment nie „łapie” małej kuli od góry). Ponad zasięg prowadnicy
   * (`padY`) segment zostaje na jej końcu i odsuwa się po promieniu.
   */
  function machTarget() {
    const d = X[XS] + MACH.gap + MACH.reach;
    let r = d * MCOS;
    let y = d * MSIN;
    if (y > MACH.padY) { y = MACH.padY; r = Math.sqrt(d * d - y * y); }
    if (r < MACH.rMin) r = MACH.rMin; else if (r > MACH.rOut) r = MACH.rOut;
    D[DW] = r;
    D[DW + 1] = y;
  }
  /** Maszyneria jedzie za promieniem bryły (kupa przy topieniu, kula przy dokarmianiu i rafinacji). */
  function followMach() {
    const h = X[XH];
    X[XS] = S[STAN.radius] > S[STAN.heapR] ? S[STAN.radius] : S[STAN.heapR];
    machTarget();
    let dv = D[DW] - S[STAN.mach];
    let lim = 70 * h;
    S[STAN.mach] += dv > lim ? lim : dv < -lim ? -lim : dv;
    dv = D[DW + 1] - S[STAN.machY];
    lim = 48 * h;
    S[STAN.machY] += dv > lim ? lim : dv < -lim ? -lim : dv;
  }
  /** Poziom metalu w leju z jego masy → S[level] (stożek ścięty: (r0 + k·h)³ = r0³ + 3·k·V / π). */
  function levelD() {
    const vol = Cn[LICZNIK.funnel] * VOL_UNIT;
    const r0 = FUN.throatR;
    S[STAN.level] = FUN.throatY + (Math.cbrt(r0 * r0 * r0 + 3 * FSL * vol / Math.PI) - r0) / FSL;
  }

  /**
   * Kula dotyka stożka leja: od tej chwili jest JEDNĄ MASĄ w polu grubości (`masa.js`). Bryła kuli (z wydłużeniem
   * i falowaniem z lotu) zostaje rozpisana na słupy nad komórkami pola i cała staje się polem (pęd opadania →
   * rozpływ); pod nawisem kuli zostaje prześwit, który zamyka się z prędkością opadania. Tu także iskry z obwodu styku.
   */
  function impact() {
    impacted = true;
    S[STAN.impactT] = 0;
    Cn[LICZNIK.impacts]++;
    // kłąb uderzenia: cała reszta gazu kąpieli wychodzi z linii styku masy ze stożkiem w `impactTime` s
    X[XGIMP0] = Cn[LICZNIK.gasBath];
    X[XGIMPA] = 0;
    X[XGIMPR] = rndG30() * R30 * TAU;
    const Ri = S[STAN.radius];
    X[XRIMP] = Ri;
    X[XV0] = -S[STAN.fallV];
    X[XM0] = Cn[LICZNIK.metal];
    X[XMOVED] = 0;
    X[XCRN] = 0;
    X[XJET] = 0;
    X[XDRAIN] = 0;
    X[XEMPTY] = 0;
    field.reset();
    FP[MP.g] = PROCES.gravity;
    FP[MP.bx] = S[STAN.offX]; FP[MP.by] = S[STAN.offY]; FP[MP.bz] = S[STAN.offZ];
    FP[MP.vbx] = X[XVBX]; FP[MP.vbz] = X[XVBZ];
    FP[MP.vFall] = -S[STAN.fallV];
    FP[MP.R] = Ri; FP[MP.sy] = S[STAN.squash]; FP[MP.sxz] = S[STAN.wide]; FP[MP.tail] = S[STAN.tail];
    FP[MP.ballVol] = X[XM0] * VOL_UNIT;
    field.loadBall();
    view.masaOn = 1;
    // cały metal kuli jest od tej chwili masą w leju (polem grubości)
    Cn[LICZNIK.funnel] += Cn[LICZNIK.metal];
    Cn[LICZNIK.metal] = 0;
    X[XMOVED] = X[XM0];
    S[STAN.ballCols] = field.ballLeft;
    S[STAN.humpY] = FUN.throatY;
    for (let i = 0; i < MODES; i++) modeV[i] = 0;
    levelD();
    S[STAN.lakeR] = FUN.throatR + (S[STAN.level] - FUN.throatY) * FSL;
    // skręcenie powierzchni liczy się od tego zrzutu (kąt z poprzedniego obiegu skręcałby wzór masy w spiralę już od
    // zetknięcia, zanim gardziel zacznie ciągnąć)
    S[STAN.twist] = 0;
    S[STAN.levelMax] = FUN.throatY;
    S[STAN.foldY] = FUN.rimY;
    // iskry: krótki snop z obwodu styku kuli ze stożkiem
    const yc = S[STAN.offY];
    const ox = S[STAN.offX];
    const oz = S[STAN.offZ];
    for (let k = 0; k < PROCES.impactSparks; k++) {
      const ang = rnd30() * R30 * TAU;
      const rr = Ri * (0.86 + 0.2 * rnd30() * R30);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      D[DN] = ca * 0.55; D[DN + 1] = 0.83; D[DN + 2] = sa * 0.55;
      D[DP] = ox + ca * rr; D[DP + 1] = yc - Ri * 0.42; D[DP + 2] = oz + sa * rr;
      sparkD();
      if (nSparks > 0) {
        const i = nSparks - 1;
        qV[i * 3] *= 1.3; qV[i * 3 + 1] *= 1.5; qV[i * 3 + 2] *= 1.3;
        qLife0[i] = 0.3 + 0.5 * rnd30() * R30;
        qLife[i] = qLife0[i];
      }
    }
    D[DP] = ox; D[DP + 1] = yc - Ri * 0.5; D[DP + 2] = oz; D[DAMP] = 46;
    flashD();
  }

  /**
   * Kropla odrywa się od masy w leju (drobny rozprysk — masa zostaje jedną bryłą): `jet` = 0 — z czoła fałdy
   * wjeżdżającej po ścianie (wycinek pola wybrany złotym podziałem; tylko gdy czoło pędzi), 1 — z garbu odbicia nad
   * gardzielą. Bierze masę z metalu w leju (gdy jej brak — nie powstaje) i wraca do niego.
   */
  function crownDrop(jet) {
    if (nDrops >= ND) return;
    const units1 = 4 * (8 + (rnd30() % 34));
    const u1 = rnd30() * R30;
    const u2 = rnd30() * R30;
    const u3 = rnd30() * R30;
    if (Cn[LICZNIK.funnel] - units1 < UNITS_PER_TON) return;
    let c;
    let ang;
    let rr;
    let y;
    let up;
    let out;
    if (jet) {
      c = field.center;
      ang = u1 * TAU;
      rr = 36 * u2;
      y = S[STAN.humpY] + 3;
      up = 120 + 130 * u3;
      out = 30 + 50 * u2;
    } else {
      const fr = X[XCRN] * 0.618034;
      const k = Math.floor((fr - Math.floor(fr)) * FNA);
      c = field.frontCell(k);
      if (c < 0) return;
      const vr = FP[MP.got];
      if (vr < PROCES.crownSpeed) return;
      rr = field.rc[(c / FNA) | 0] + 6;
      ang = (k + 0.1 + 0.8 * u1) * field.dth;
      y = field.zb[c] + field.h[c] + 2;
      // z rozpędu czoła: w górę nad fałdę i trochę dalej po ścianie
      out = vr * (0.12 + 0.25 * u2);
      up = vr / FSL * (0.8 + 0.5 * u3) + 60 + 90 * u3;
    }
    FP[MP.want] = units1 * VOL_UNIT;
    field.takeAt(c);
    const i = nDrops++;
    const a = i * 3;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const tw = (u2 - 0.5) * 50;
    dP[a] = ca * rr; dP[a + 1] = y; dP[a + 2] = sa * rr;
    dPrev[a] = dP[a]; dPrev[a + 1] = dP[a + 1]; dPrev[a + 2] = dP[a + 2];
    dV[a] = ca * out - sa * tw; dV[a + 1] = up; dV[a + 2] = sa * out + ca * tw;
    dMass[i] = units1;
    dAge[i] = 0;
    Cn[LICZNIK.funnel] -= units1;
    Cn[LICZNIK.drops] += units1;
    Cn[LICZNIK.dropsMade]++;
  }

  /** Koniec zrzutu: lej pusty — pole masy i stan zrzutu wyzerowane. */
  function dropReset() {
    field.reset();
    view.masaOn = 0;
    impacted = false;
    released = false;
    S[STAN.impactT] = -1;
    S[STAN.fallT] = -1;
    S[STAN.fallV] = 0;
    S[STAN.pool] = 0;
    S[STAN.squash] = 1;
    S[STAN.wide] = 1;
    S[STAN.tail] = 0;
    S[STAN.vortex] = 0;
    S[STAN.dimple] = 0;
    S[STAN.lakeR] = FUN.throatR;
    S[STAN.foldY] = FUN.rimY;
    S[STAN.humpY] = FUN.throatY;
    S[STAN.massTop] = FUN.throatY;
    S[STAN.slosh] = 0;
    S[STAN.frontR] = 0;
    S[STAN.ballCols] = 0;
    S[STAN.offX] = 0; S[STAN.offY] = 0; S[STAN.offZ] = 0;
    X[XOV] = 0; X[XOV + 1] = 0; X[XOV + 2] = 0;
    for (let i = 0; i < MODES; i++) { modeA[i] = 0; modeV[i] = 0; }
  }

  /**
   * Zrzut: gdy szewrony wyświetlacza płyną w dół (grawitacja włączona), kula wisi jeszcze chwilę, spada (ze znosem),
   * dotyka leja i od tej chwili jest jedną masą w polu grubości: wlewa się, rozpływa, wjeżdża fałdą po ścianach,
   * wraca, odbija garbem, uspokaja się; gardziel otwiera się i masa spływa (gardziel zasysa: obrót pola i wgłębienie).
   */
  function stepDrop() {
    const h = X[XH];
    if (!released) {
      if (!S[STAN.grav]) return;                       // wyświetlacz jeszcze nie pokazuje „w dół”: kula wisi w polu 0 g
      X[XGT] += h;
      if (X[XGT] >= PROCES.dropDelay) {
        released = true;
        S[STAN.fallT] = 0;
        S[STAN.fallV] = 0;
        // pole puszcza kulę: bryła wydłuża się w osi spadku i drga (mod l = 2 wokół osi pionowej; słabiej inne)
        modeV[2] += 0.2; modeV[8] -= 0.03; modeV[4] += 0.06; modeV[0] -= 0.05;
        const R = S[STAN.radius];
        X[XYC] = FUN.throatY + (R * FNL - FUN.throatR) / FSL;
        // … i puszcza ją nierówno: znos w planie (kierunek i wielkość z ziarna) — uderzenie niesymetryczne
        const ang = rnd30() * R30 * TAU;
        const sp = PROCES.dropDrift * (0.7 + 0.3 * rnd30() * R30);
        X[XVBX] = Math.cos(ang) * sp;
        X[XVBZ] = Math.sin(ang) * sp;
      }
      return;
    }
    const g = PROCES.gravity;
    if (!impacted) {
      S[STAN.fallT] += h;
      const ft = S[STAN.fallT];
      S[STAN.fallV] -= g * h;
      S[STAN.offY] += S[STAN.fallV] * h;
      S[STAN.offX] += X[XVBX] * h;
      S[STAN.offZ] += X[XVBZ] * h;
      // wydłużenie w osi spadku (objętość zachowana: bryła chudnie w poziomie), góra zwęża się w „ogon”
      const on = 1 - Math.exp(-ft / 0.16);
      const sq = 1 + PROCES.fallStretch * on + PROCES.fallWobble * Math.sin(TAU * PROCES.fallHz * ft) * (1 - Math.exp(-ft / 0.1));
      S[STAN.squash] = sq;
      S[STAN.wide] = 1 / Math.sqrt(sq);
      S[STAN.tail] = 1 - Math.exp(-ft / 0.3);
      // zetknięcie: wydłużona bryła dotyka stożka wcześniej niż kula, a zniesiona z osi — wyżej (bliżej ściany stożka)
      const dax = Math.sqrt(S[STAN.offX] * S[STAN.offX] + S[STAN.offZ] * S[STAN.offZ]);
      const yc = X[XYC] + S[STAN.radius] * (sq - 1) * 0.7 + dax / FSL;
      if (S[STAN.offY] <= yc) { S[STAN.offY] = yc; impact(); }
      return;
    }
    S[STAN.impactT] += h;
    const ti = S[STAN.impactT];
    // nawis kuli (komórki z prześwitem) opada dalej z prędkością spadku — źródło światła idzie za nim
    if (field.ballLeft > 0) {
      S[STAN.fallV] -= g * h;
      S[STAN.offY] += S[STAN.fallV] * h;
      S[STAN.offX] += X[XVBX] * h;
      S[STAN.offZ] += X[XVBZ] * h;
    }
    // gardziel: otwiera się po `drainDelay`, pełny spływ po `drainRamp`
    let dk = (ti - PROCES.drainDelay) / PROCES.drainRamp;
    dk = dk <= 0 ? 0 : dk >= 1 ? 1 : dk * dk * (3 - 2 * dk);
    const draining = dk > 0 && Cn[LICZNIK.funnel] > 0;
    // --- pole masy: kilka kroków na podkrok
    FP[MP.dt] = h / MCFG.steps;
    FP[MP.bx] = S[STAN.offX]; FP[MP.by] = S[STAN.offY]; FP[MP.bz] = S[STAN.offZ];
    FP[MP.vFall] = -S[STAN.fallV];
    FP[MP.swirl] = draining ? dk : 0;
    {
      let q = (ti - PROCES.thickFrom) / (PROCES.thickTo - PROCES.thickFrom);
      q = q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q);
      FP[MP.thick] = q;
    }
    for (let k = 0; k < MCFG.steps; k++) field.step();
    // drobny rozprysk: krople z czoła fałdy, gdy ta pędzi po ścianie; kilka z garbu odbicia, gdy rośnie nad gardzielą
    if (X[XCRN] < PROCES.crownDrops && ti >= PROCES.crownFrom) {
      const due = Math.floor(PROCES.crownDrops * (ti - PROCES.crownFrom) / (PROCES.crownTo - PROCES.crownFrom));
      let guard = 4;
      while (X[XCRN] < due && X[XCRN] < PROCES.crownDrops && guard-- > 0) { crownDrop(0); X[XCRN]++; }
    }
    if (X[XJET] < PROCES.jetDrops && field.ballLeft === 0 && ti > 1 && FP[MP.mid] > S[STAN.level] + PROCES.jetRise && FP[MP.mid] > S[STAN.humpY] && (rnd30() & 3) === 0) { crownDrop(1); X[XJET]++; }
    // spływ gardzielą do odlewni: gardziel bierze z pola tyle, ile do niej dopływa (do pełnej wydajności); resztki
    // cienkiej warstwy ściekają co najmniej `drainMin`
    if (draining) {
      FP[MP.want] = drainUnitRate * dk * h * VOL_UNIT;
      field.drain();
      let got = FP[MP.got] / VOL_UNIT;
      const least = PROCES.drainMin * UNITS_PER_TON * dk * h;
      if (got < least) got = least;
      X[XDRAIN] += got;
      let du = Math.floor(X[XDRAIN]);
      if (du > Cn[LICZNIK.funnel]) du = Cn[LICZNIK.funnel];
      if (du > 0) {
        X[XDRAIN] -= du;
        Cn[LICZNIK.funnel] -= du;
        Cn[LICZNIK.delivered] += du;
      }
    }
    // pole normalizowane do masy autorytatywnej (całkowite jednostki); pomiary pola → stan
    FP[MP.target] = Cn[LICZNIK.funnel] * VOL_UNIT;
    field.normalize();
    levelD();
    const level = S[STAN.level];
    S[STAN.lakeR] = FUN.throatR + (level - FUN.throatY) * FSL;
    S[STAN.foldY] = FP[MP.edge];
    S[STAN.humpY] = FP[MP.mid];
    S[STAN.massTop] = FP[MP.top];
    S[STAN.slosh] = FP[MP.ke];
    S[STAN.frontR] = FP[MP.front];
    S[STAN.ballCols] = field.ballLeft;
    S[STAN.pool] = X[XM0] > 0 ? X[XMOVED] / X[XM0] : 1;
    if (FP[MP.wet] > S[STAN.levelMax]) S[STAN.levelMax] = FP[MP.wet];
    // ZASYSANIE: gardziel ciągnie metal przez cały spływ — siła wiru z obrotu pola przy gardzieli, kąt skręcenia
    // powierzchni narasta z jego prędkością kątową, wgłębienie = lustro wokół gardzieli − lustro nad nią
    {
      let vk = draining ? FP[MP.omega] * VK_REF : 0;
      vk = vk < 0 ? 0 : vk > 1 ? 1 : vk;
      if (draining && vk < dk * VORTEX.floor) vk = dk * VORTEX.floor;
      S[STAN.vortex] = draining || S[STAN.vortex] > 1e-4 ? S[STAN.vortex] + (vk - S[STAN.vortex]) * (1 - Math.exp(-h / 0.12)) : 0;
      S[STAN.twist] += (draining ? FP[MP.omega] : 0) * h;
      let dm = draining ? FP[MP.ring] - FP[MP.mid] : 0;
      dm = dm < 0 ? 0 : dm > VORTEX.dimpleMax ? VORTEX.dimpleMax : dm;
      S[STAN.dimple] += (dm - S[STAN.dimple]) * (1 - Math.exp(-h / 0.15));
    }
    // źródło światła komory: środek masy w leju (po wlaniu kuli idzie za lustrem)
    if (field.ballLeft === 0) {
      const kq = 1 - Math.exp(-h / 0.25);
      S[STAN.offY] += (level - 45 - S[STAN.offY]) * kq;
      S[STAN.offX] -= S[STAN.offX] * kq;
      S[STAN.offZ] -= S[STAN.offZ] * kq;
    }
    // kupa następnego obiegu wchodzi na taśmę (czoło stanie przed bramą 0 g i poczeka na wyłączenie grawitacji)
    if (!prefed && ti >= PROCES.prefeedAfter) { startFeed(0); prefed = true; }
    if (Cn[LICZNIK.funnel] === 0 && Cn[LICZNIK.metal] === 0 && nDrops === 0) {
      X[XEMPTY] += h;
      if (X[XEMPTY] >= PROCES.dropTail) {
        // lej pusty: grawitacja wyłączona, szewrony wyhamowują spływ, obracają się z powrotem i ruszają po obwodzie
        // (wtedy brama 0 g znów przepuszcza ziarna); komora pusta — nowy obieg
        S[STAN.grav] = 0;
        S[STAN.dsp] = DSP.SETTLE;
        S[STAN.dspT] = 0;
        X[XSV0] = S[STAN.dspV];
        X[XSV1] = Math.ceil(S[STAN.dspV] + 0.3);
        X[XST] = 2 * (X[XSV1] - X[XSV0]) / (DSPK.flow * (S[STAN.dspFlow] > 0.2 ? S[STAN.dspFlow] : 0.2));
        dropReset();
        setRadius();
        S[STAN.ready] = 0;
        Cn[LICZNIK.cycles]++;
        S[STAN.cycle] = Cn[LICZNIK.cycles];
        S[STAN.cycleTime] = S[STAN.time] - S[STAN.cycleStart];
        S[STAN.cycleStart] = S[STAN.time];
        if (!prefed) startFeed(0);
        prefed = false;
        setPhase(PHASE.EMPTY);
      }
    } else X[XEMPTY] = 0;
  }

  /**
   * WYŚWIETLACZ GRAWITACJI (jedyny sygnał grawitacji w komorze). Tryby (`DSP`):
   *   obieg        generator 0 g pracuje — szewrony biegną po obwodzie (prędkość rozpędza się do pełnej)
   *   hamowanie    szewrony STAJĄ (prędkość gaśnie gładko), potem krótki postój
   *   obrót w dół  każdy szewron obraca się w miejscu grotem w dół
   *   w dół        GRAWITACJA WŁĄCZONA (`grav` = 1): szewrony płyną w dół; po `dropDelay` kula spada
   *   wyhamowanie  po zrzucie: spływ zwalnia tak, by szewron stanął w środku komórki; obrót powrotny; obieg
   * Fazy `dspU` i `dspV` narastają (obraz bierze część ułamkową). Zegar `spin` idzie z obiegiem — pierścień bramy 0 g
   * przy taśmie mówi tym samym językiem.
   */
  function stepDisplay() {
    const h = X[XH];
    const md = S[STAN.dsp];
    S[STAN.dspT] += h;
    const t = S[STAN.dspT];
    if (md === DSP.RUN) {
      const v = S[STAN.dspSpeed] + h / DSPK.ramp;
      S[STAN.dspSpeed] = v > 1 ? 1 : v;
    } else if (md === DSP.STOP) {
      X[XS] = 1 - t / DSPK.stop; sm3();
      S[STAN.dspSpeed] = X[XS] * X[XDS0];
      if (t >= DSPK.stop) { S[STAN.dspSpeed] = 0; S[STAN.dsp] = DSP.HOLD; S[STAN.dspT] = 0; }
    } else if (md === DSP.HOLD) {
      if (t >= DSPK.hold) { S[STAN.dsp] = DSP.TURN; S[STAN.dspT] = 0; }
    } else if (md === DSP.TURN) {
      X[XS] = t / DSPK.turn; sm3();
      S[STAN.dspTurn] = X[XS];
      if (t >= DSPK.turn) {
        // grot w dół: generator grawitacji włączony, szewrony ruszają w dół
        S[STAN.dspTurn] = 1;
        S[STAN.dsp] = DSP.DOWN;
        S[STAN.dspT] = 0;
        S[STAN.dspFlow] = 0;
        S[STAN.grav] = 1;
        X[XGT] = 0;
      }
    } else if (md === DSP.DOWN) {
      const v = S[STAN.dspFlow] + h / DSPK.ramp;
      S[STAN.dspFlow] = v > 1 ? 1 : v;
      S[STAN.dspV] += S[STAN.dspFlow] * DSPK.flow * h;
    } else if (md === DSP.SETTLE) {
      // ruch jednostajnie opóźniony od prędkości spływu do zera: szewron staje dokładnie w środku komórki
      const T = X[XST];
      const q = t >= T ? 1 : t / T;
      S[STAN.dspV] = X[XSV0] + (X[XSV1] - X[XSV0]) * q * (2 - q);
      S[STAN.dspFlow] = (1 - q) * (S[STAN.dspFlow] > 0 ? 1 : 0) * S[STAN.dspFlow];
      if (t >= T) { S[STAN.dspV] = X[XSV1]; S[STAN.dspFlow] = 0; S[STAN.dsp] = DSP.BACK; S[STAN.dspT] = 0; }
    } else {
      X[XS] = 1 - t / DSPK.turn; sm3();
      S[STAN.dspTurn] = X[XS];
      if (t >= DSPK.turn) { S[STAN.dspTurn] = 0; S[STAN.dsp] = DSP.RUN; S[STAN.dspT] = 0; S[STAN.dspSpeed] = 0; }
    }
    S[STAN.dspU] += S[STAN.dspSpeed] * DSPK.speed * DSPK.cells * h;
    S[STAN.spin] += S[STAN.dspSpeed] * h;
  }

  function stepPhase() {
    const h = X[XH];
    const p = S[STAN.phase];
    S[STAN.phaseT] += h;
    const t = S[STAN.phaseT];
    const idle = nBelt === 0 && nFlight === 0;
    X[XIDLE] = idle ? X[XIDLE] + h : 0;
    if (p === PHASE.EMPTY) {
      if (nFlight > 0 || nHeap > 0) setPhase(PHASE.GATHER);
    } else if (p === PHASE.GATHER) {
      S[STAN.heapR] = X[XENV];
      // kupa gotowa: cała partia rozruchowa przyległa (podajnik zewnętrzny: 1/3 wsadu albo 3 s bez ziaren)
      const full = nHeap >= NH || (!feeder && nHeap >= heapGrains);
      const done = feeder ? S[STAN.feedLeft] <= 0 && idle : idle && X[XIDLE] >= 3;
      if (nHeap > 0 && (full || done)) { X[XFROM] = S[STAN.mach]; X[XMY0] = S[STAN.machY]; setPhase(PHASE.PRESS); }
    } else if (p === PHASE.PRESS) {
      // segmenty cewek dosuwają się do kupy; w drugiej połowie pole ją ściska
      X[XS] = (t - PROCES.pressTime * 0.5) / (PROCES.pressTime * 0.5); sm3();
      S[STAN.heapScale] = 1 + (PROCES.pressScale - 1) * X[XS];
      S[STAN.heapR] = X[XENV] * S[STAN.heapScale];
      X[XS] = S[STAN.heapR]; machTarget();
      X[XS] = t / (PROCES.pressTime * 0.82); sm3();
      S[STAN.mach] = X[XFROM] + (D[DW] - X[XFROM]) * X[XS];
      S[STAN.machY] = X[XMY0] + (D[DW + 1] - X[XMY0]) * X[XS];
      if ((t >= PROCES.pressTime && nFlight === 0) || t >= PROCES.pressTime + 5) {
        heapPrepareMelt();
        S[STAN.heapR] = X[XENV] * S[STAN.heapScale];
        mainFed = false;
        setPhase(PHASE.MELT);
      }
    } else if (p === PHASE.MELT) {
      // jądro wchłania ziarna od najbliższych środka według krzywej: najpierw sam żar, potem coraz szybciej, na końcu
      // wolno (ostatnie wyspy ziaren na kuli)
      let u = (t / PROCES.meltTime - PROCES.meltPre) / (1 - PROCES.meltPre);
      u = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
      let target = Math.floor(u * heapTotal + 1e-9);
      if (t >= PROCES.meltTime || target > nHeap) target = nHeap;
      while (hHead < target) absorb();
      setRadius();
      if (hHead < nHeap) {
        // kupa zapada się na jądro: najbliższe z pozostałych ziaren leży na powierzchni cieczy, dalsze tworzą skorupę
        // ziaren nad nią; skala tylko maleje (ciecz zajmuje mniej miejsca niż ziarna, które wchłonęła — skorupa osiada),
        // pod koniec ostatnie ziarna leżą na gotowej kuli
        const r0 = hR[hHead] > 6 ? hR[hHead] : 6;
        let lo = (S[STAN.radius] + 2) / r0;
        if (lo < 0.45) lo = 0.45;
        let sc = S[STAN.heapScale];
        if (S[STAN.radius] > 1 && sc > lo) { sc -= 0.3 * h; if (sc < lo) sc = lo; }
        S[STAN.heapScale] = sc;
        S[STAN.heapR] = hR[nHeap - 1] * sc;
        S[STAN.heapN] = nHeap - hHead;
      }
      followMach();
      if (feeder && !mainFed && t >= PROCES.meltTime - PROCES.feedLead) { startFeed(1); mainFed = true; }
      if (hHead >= nHeap && t >= PROCES.meltTime) { heapReset(); setPhase(PHASE.FEED); }
    } else if (p === PHASE.FEED || p === PHASE.REFINE) {
      followMach();
      if (p === PHASE.FEED) {
        const done = feeder ? S[STAN.feedLeft] <= 0 && idle && t > 2 : idle && X[XIDLE] >= 3;
        if (done) setPhase(PHASE.REFINE);
      } else {
        // kula CZYSTA (żadnej wyspy żużla, także gasnącej), ssawa odjechała, krople wróciły — dopiero wtedy odsuw i zrzut
        const clean = Cn[LICZNIK.slagFloes] === 0 && nFloes === 0 && nDrops === 0 && S[STAN.suck] === 0;
        if (clean && t >= PROCES.refineMin && S[STAN.temp] >= PROCES.tempTap) {
          if (!S[STAN.ready]) {
            S[STAN.ready] = 1;
            Cn[LICZNIK.ready]++;
            if (api.onReady) api.onReady(Cn[LICZNIK.metal] / UNITS_PER_TON);
          }
          if (auto || S[STAN.waiting] === 2) { S[STAN.waiting] = 0; X[XFROM] = S[STAN.mach]; X[XMY0] = S[STAN.machY]; setPhase(PHASE.CLEAR); } else S[STAN.waiting] = 1;
        }
      }
    } else if (p === PHASE.CLEAR) {
      // maszyneria odjeżdża pod ściany; kulę trzyma jeszcze pole 0 g
      X[XS] = t / (PROCES.clearTime * 0.86); sm3();
      S[STAN.mach] = X[XFROM] + (MACH.rOut - X[XFROM]) * X[XS];
      S[STAN.machY] = X[XMY0] + (MACH.padY - X[XMY0]) * X[XS];
      if (t >= PROCES.clearTime) {
        // generator 0 g staje: szewrony wyświetlacza hamują, obracają się grotem w dół i ruszają w dół — dopiero
        // wtedy włącza się grawitacja (`stepDisplay`) i kula spada
        S[STAN.mach] = MACH.rOut;
        S[STAN.machY] = MACH.padY;
        S[STAN.dsp] = DSP.STOP;
        S[STAN.dspT] = 0;
        X[XDS0] = S[STAN.dspSpeed];
        X[XGT] = 0;
        released = false;
        impacted = false;
        prefed = false;
        S[STAN.fallT] = -1;
        S[STAN.impactT] = -1;
        setPhase(PHASE.DROP);
      }
    } else stepDrop();
  }

  // --- temperatura, obrót, mody, sygnalizacja -------------------------------
  function stepBody() {
    const h = X[XH];
    const p = S[STAN.phase];
    const T = S[STAN.temp];
    const R = S[STAN.radius];
    const hasBall = R > 1;
    const falling = p === PHASE.DROP && released;
    // grzanie cewek: docisk — rozruch pod koniec; topienie — pełna moc; dokarmianie — moc podtrzymania; rafinacja —
    // termostat; odsuw i zrzut — wyłączone
    let want = 0;
    if (p === PHASE.PRESS) { X[XS] = (S[STAN.phaseT] - PROCES.pressTime * 0.55) / (PROCES.pressTime * 0.45); sm3(); want = 0.5 * X[XS]; }
    else if (p === PHASE.MELT) want = 1;
    else if (p === PHASE.FEED) want = PROCES.heatCharge;
    else if (p === PHASE.REFINE) { want = (PROCES.tempSet - T) * 9; want = want < 0.04 ? 0.04 : want > 1 ? 1 : want; }
    S[STAN.heat] += (want - S[STAN.heat]) * (1 - Math.exp(-h / 0.5));
    const heat = S[STAN.heat];
    if (hasBall) {
      // (dokarmianie trwa 3 × dłużej niż przed rundą 4, a ziarna chłodzą kulę w tym samym stosunku mas: moc podtrzymania
      // niższa o tyle samo — kula przy wsadzie ciemnieje jak dawniej, rafinacja grzeje ją do temperatury zrzutu)
      let dT = 0.05 * heat * (p === PHASE.FEED ? 0.31 : 1);
      if (p === PHASE.MELT) dT += (PROCES.tempMelt - T) * 0.8;
      // (masa w leju stygnie wolniej niż przed rundą 4: spływ zaczyna się po odbiciu i trwa dłużej — gruba masa zostaje
      // pomarańczowa do końca spływu; ciemnieje cienka warstwa na ścianach leja — `masa.js`: ostygnięcie)
      else if (p === PHASE.DROP) dT -= impacted ? 0.011 : 0.01;
      else if (T > 0.3) dT -= (T - 0.3) * 0.006;
      S[STAN.temp] = T + dT * h;
    }
    S[STAN.coilGlow] += (heat - S[STAN.coilGlow]) * (1 - Math.exp(-h / 0.7));
    S[STAN.radGlow] += (S[STAN.coilGlow] - S[STAN.radGlow]) * (1 - Math.exp(-h / 4));
    // lej: gardziel żarzy się, gdy płynie nią metal, i długo stygnie; ściany stożka stygną szybciej
    const pouring = impacted && Cn[LICZNIK.funnel] > 0 ? 1 : 0;
    S[STAN.throat] += (pouring - S[STAN.throat]) * (1 - Math.exp(-h / (pouring ? 0.25 : 2.4)));
    S[STAN.funHeat] += (pouring - S[STAN.funHeat]) * (1 - Math.exp(-h / (pouring ? 0.2 : 3.2)));
    // chłód strefy wsadu: narasta z tempem wtopień, po wsadzie rozchodzi się w kilka sekund
    const chillWant = S[STAN.meltRate] > 700 ? 1 : S[STAN.meltRate] / 700;
    S[STAN.chill] += (chillWant - S[STAN.chill]) * (1 - Math.exp(-h / (chillWant > S[STAN.chill] ? 0.7 : 3.2)));
    // kołysanie kupy / kuli w polu: sprężyna ku osi komory (przy spadku pole nie działa)
    if (!falling) {
      const w2s = PROCES.swayOmega * PROCES.swayOmega;
      const ks = Math.exp(-PROCES.swayGamma * 2 * h);
      X[XOV] = (X[XOV] - S[STAN.offX] * w2s * h) * ks;
      X[XOV + 1] = (X[XOV + 1] - S[STAN.offY] * w2s * h) * ks;
      X[XOV + 2] = (X[XOV + 2] - S[STAN.offZ] * w2s * h) * ks;
      S[STAN.offX] += X[XOV] * h;
      S[STAN.offY] += X[XOV + 1] * h;
      S[STAN.offZ] += X[XOV + 2] * h;
      // ograniczenie tylko przy kuli (kupa po przesunięciu środka masy wraca do osi sprężyną z większego wychylenia)
      const cap = hasBall && p !== PHASE.MELT ? PROCES.swayMax : 80;
      const o2 = S[STAN.offX] * S[STAN.offX] + S[STAN.offY] * S[STAN.offY] + S[STAN.offZ] * S[STAN.offZ];
      if (o2 > cap * cap) {
        const k = cap / Math.sqrt(o2);
        S[STAN.offX] *= k; S[STAN.offY] *= k; S[STAN.offZ] *= k;
      }
    }
    // KLATKA CEWEK współśrodkowa z bryłą: gdy segmenty trzymają kupę albo kulę (docisk … rafinacja), środek klatki
    // idzie za kołysaniem bryły w polu (każdy wysięgnik dosuwa się o rzut przesunięcia na swój kierunek, prowadnice
    // segmentów — o przesunięcie w pionie); przy odsuwie i zrzucie wraca na oś komory
    {
      const hold = p === PHASE.PRESS || p === PHASE.MELT || p === PHASE.FEED || p === PHASE.REFINE;
      const kc = 1 - Math.exp(-h / (hold ? 0.18 : 0.4));
      S[STAN.cageX] += ((hold ? S[STAN.offX] : 0) - S[STAN.cageX]) * kc;
      S[STAN.cageY] += ((hold ? S[STAN.offY] : 0) - S[STAN.cageY]) * kc;
      S[STAN.cageZ] += ((hold ? S[STAN.offZ] : 0) - S[STAN.cageZ]) * kc;
    }
    // obrót kuli
    const wantOm = p === PHASE.REFINE ? PROCES.omegaRefine : PROCES.omegaIdle;
    S[STAN.omega] += (wantOm - S[STAN.omega]) * (1 - Math.exp(-h / 1.5));
    S[STAN.rot] += S[STAN.omega] * h;
    if (S[STAN.rot] > 4096 * TAU) S[STAN.rot] -= 4096 * TAU;
    // mody drgań kuli. Równowagi: spłaszczenie od wirowania, „oddech” pola grzania, wirujące ściśnięcie pola (elipsa
    // równika) — tylko gdy pole trzyma kulę; w spadku kula drga swobodnie wokół kształtu kulistego; w leju drgania gasną
    setRadius();
    if (!hasBall) {
      for (let i = 0; i < MODES; i++) { modeA[i] = 0; modeV[i] = 0; modeEq[i] = 0; }
      return;
    }
    for (let i = 0; i < MODES; i++) modeEq[i] = 0;
    if (impacted) {
      const k = Math.exp(-h / 0.12);
      for (let i = 0; i < MODES; i++) { modeA[i] *= k; modeV[i] = 0; }
      return;
    }
    if (!falling) {
      const ow = S[STAN.omega] / PROCES.omegaRefine;
      const rr = R / 281;
      const flat = 0.009 * ow * ow * rr * rr * rr;
      const pump = 0.01 * heat * Math.sin(TAU * 0.3 * S[STAN.time]);
      S[STAN.quadPhase] += (0.5 + 0.5 * heat) * h;
      const quad = 0.014 * (0.4 + 0.6 * heat);
      modeEq[2] = -flat + pump;
      modeEq[4] = quad * Math.cos(2 * S[STAN.quadPhase]);
      modeEq[0] = quad * Math.sin(2 * S[STAN.quadPhase]);
    }
    par[0] = R > 24 ? R : 24;
    par[1] = h;
    stepModesInto(modeA, modeV, modeEq, par);
  }

  function substep() {
    const h = X[XH];
    S[STAN.time] += h;
    stepPhase();
    stepDisplay();
    // taśma i brama 0 g: taśma jedzie, póki czoło wsadu nie stanie przed zamkniętą bramą (grawitacja, docisk,
    // topienie, rafinacja) — wtedy czeka razem z podajnikiem
    const gate = gateOpen();
    S[STAN.gate] = gate;
    const headAt = nBelt > 0 && S[STAN.beltTravel] - bS0[bHead] >= sBoundary - 0.25;
    const running = (S[STAN.feedLeft] > 0 || nBelt > 0) && (gate === 1 || !headAt);
    S[STAN.beltRun] = running ? 1 : 0;
    if (running) S[STAN.beltTravel] += B.speed * h;
    // podajnik wsadu (strumień nierówny: taśma niesie gęstsze i rzadsze odcinki)
    if (running && S[STAN.feedLeft] > 0) {
      X[XFEED] += X[XRATE] * h * (1 + 0.32 * Math.sin(S[STAN.time] * 3.7) + 0.16 * Math.sin(S[STAN.time] * 9.1 + 1.3));
      let n = Math.floor(X[XFEED]);
      if (n > S[STAN.feedLeft]) n = S[STAN.feedLeft];
      if (n > 0) {
        X[XFEED] -= n;
        const got = feed(n);
        S[STAN.feedLeft] -= got;
        if (got < n) X[XFEED] = 0;
      }
    }
    // czoło taśmy: brama 0 g
    let crossed = 0;
    if (gate === 1) {
      const travel = S[STAN.beltTravel];
      while (nBelt > 0 && travel - bS0[bHead] >= sBoundary) { release(); crossed++; }
    }
    Cn[LICZNIK.belt] = nBelt;
    S[STAN.boundaryFlux] += (crossed / h - S[STAN.boundaryFlux]) * (1 - Math.exp(-h / 0.25));
    meltsStep = 0;
    stepFlight();
    S[STAN.meltRate] += (meltsStep / h - S[STAN.meltRate]) * (1 - Math.exp(-h / 0.3));
    stepParticles();
    // krople, które w tym podkroku wróciły do masy w leju: pole znów równe masie autorytatywnej
    if (impacted && Cn[LICZNIK.funnel] * VOL_UNIT !== FP[MP.vol]) { FP[MP.target] = Cn[LICZNIK.funnel] * VOL_UNIT; field.normalize(); }
    stepSlag();
    stepSuck();
    stepTray();
    stepBody();
    stepHeapBody();
    stepGas();
  }

  function writeView() {
    // ziarna: taśma (kolejka od czoła), lot, kupa
    const G = view.ziarna;
    const travel = S[STAN.beltTravel];
    let w = 0;
    for (let k = 0; k < nBelt; k++) {
      const i = (bHead + k) % NB;
      const a = i * 3;
      if (bFresh[i]) {
        _inp[0] = travel - bS0[i]; _inp[1] = bLat[i]; _inp[2] = bH[i];
        track.pointFrom(_inp, bPos, a);
        bPrev[a] = bPos[a]; bPrev[a + 1] = bPos[a + 1]; bPrev[a + 2] = bPos[a + 2];
        bFresh[i] = 0;
      } else {
        bPrev[a] = bPos[a]; bPrev[a + 1] = bPos[a + 1]; bPrev[a + 2] = bPos[a + 2];
        _inp[0] = travel - bS0[i]; _inp[1] = bLat[i]; _inp[2] = bH[i];
        track.pointFrom(_inp, bPos, a);
      }
      G[w] = bPos[a]; G[w + 1] = bPos[a + 1]; G[w + 2] = bPos[a + 2];
      G[w + 3] = bPrev[a]; G[w + 4] = bPrev[a + 1]; G[w + 5] = bPrev[a + 2];
      G[w + 6] = bAng[i]; G[w + 7] = bTrait[i]; G[w + 8] = 0; G[w + 9] = 0; G[w + 10] = (bHash[i] & 1023) / 1023; G[w + 11] = 0;
      w += GRAIN_STRIDE;
    }
    view.nTasma = nBelt;
    for (let j = 0; j < nFlight; j++) {
      const a = j * 3;
      G[w] = fP[a]; G[w + 1] = fP[a + 1]; G[w + 2] = fP[a + 2];
      G[w + 3] = fPrev[a]; G[w + 4] = fPrev[a + 1]; G[w + 5] = fPrev[a + 2];
      G[w + 6] = fAng[j]; G[w + 7] = fTrait[j]; G[w + 8] = fHeat[j]; G[w + 9] = 1; G[w + 10] = (fHash[j] & 1023) / 1023; G[w + 11] = 0;
      w += GRAIN_STRIDE;
    }
    view.nLot = nFlight;
    // kupa: ciało sztywne — położenie w komorze = środek pola + obrót wokół pionu (skala docisku · lokalne)
    {
      const sc = S[STAN.heapScale];
      const c = Math.cos(S[STAN.heapRot]);
      const s = Math.sin(S[STAN.heapRot]);
      const ox = S[STAN.offX];
      const oy = S[STAN.offY];
      const oz = S[STAN.offZ];
      const dk = 1 / (2.6 * HC);
      const kOff = Math.exp(-X[XDT] / 0.07);
      for (let i = hHead; i < nHeap; i++) {
        const b = i * 3;
        const x = hP[b] * sc;
        const z = hP[b + 2] * sc;
        const wx = ox + c * x - s * z + hOff[b];
        const wy = oy + hP[b + 1] * sc + hOff[b + 1];
        const wz = oz + s * x + c * z + hOff[b + 2];
        if (hOff[b] !== 0 || hOff[b + 1] !== 0 || hOff[b + 2] !== 0) {
          if (hOff[b] * hOff[b] + hOff[b + 1] * hOff[b + 1] + hOff[b + 2] * hOff[b + 2] < 0.01) { hOff[b] = 0; hOff[b + 1] = 0; hOff[b + 2] = 0; } else { hOff[b] *= kOff; hOff[b + 1] *= kOff; hOff[b + 2] *= kOff; }
        }
        if (hFresh[i]) hFresh[i] = 0;
        else { hWp[b] = hW[b]; hWp[b + 1] = hW[b + 1]; hWp[b + 2] = hW[b + 2]; }
        hW[b] = wx; hW[b + 1] = wy; hW[b + 2] = wz;
        let depth = (hEnv[hBin[i]] - hMet(i)) * dk;
        depth = depth <= 0 ? 0 : depth >= 1 ? 1 : depth;
        G[w] = wx; G[w + 1] = wy; G[w + 2] = wz;
        G[w + 3] = hWp[b]; G[w + 4] = hWp[b + 1]; G[w + 5] = hWp[b + 2];
        G[w + 6] = hAng[i]; G[w + 7] = hTrait[i]; G[w + 8] = hHeat[i]; G[w + 9] = 2; G[w + 10] = (hHash[i] & 1023) / 1023; G[w + 11] = depth;
        w += GRAIN_STRIDE;
      }
    }
    view.nKupa = nHeap - hHead;
    view.nZiarna = nBelt + nFlight + nHeap - hHead;
    // wyspy żużla: promień RYSOWANY (ciągły), nie promień z masy
    const K = view.kry;
    for (let i = 0; i < nFloes; i++) {
      const o = i * FLOE_STRIDE;
      K[o] = kDir[i * 3]; K[o + 1] = kDir[i * 3 + 1]; K[o + 2] = kDir[i * 3 + 2]; K[o + 3] = kRad[i];
      K[o + 4] = kId[i]; K[o + 5] = kHeat[i]; K[o + 6] = kMass[i] / SLAG_EQ_PER_TON; K[o + 7] = kAge[i];
    }
    for (let i = nFloes; i < view.nKry; i++) K[i * FLOE_STRIDE + 3] = 0;
    view.nKry = nFloes;
    // granulki żużla w odbieralniku
    const P = view.granulki;
    for (let i = 0; i < nGran; i++) {
      const o = i * GRANULE_STRIDE;
      const a = i * 3;
      P[o] = gP[a]; P[o + 1] = gP[a + 1]; P[o + 2] = gP[a + 2]; P[o + 3] = gRad[i];
      P[o + 4] = gPrev[a]; P[o + 5] = gPrev[a + 1]; P[o + 6] = gPrev[a + 2]; P[o + 7] = gHeat[i];
      P[o + 8] = gId[i]; P[o + 9] = gFly[i]; P[o + 10] = 0; P[o + 11] = 0;
    }
    view.nGranulki = nGran;
    // krople: promień z masy (kropla korony przed swoją chwilą — ujemny wiek — ma promień 0)
    const Dr = view.krople;
    for (let i = 0; i < nDrops; i++) {
      const o = i * PART_STRIDE;
      const a = i * 3;
      Dr[o] = dP[a]; Dr[o + 1] = dP[a + 1]; Dr[o + 2] = dP[a + 2]; Dr[o + 3] = dAge[i] < 0 ? 0 : 1.2 + 1.15 * Math.cbrt(dMass[i] * 0.25);
      Dr[o + 4] = dPrev[a]; Dr[o + 5] = dPrev[a + 1]; Dr[o + 6] = dPrev[a + 2]; Dr[o + 7] = dAge[i];
    }
    view.nKrople = nDrops;
    const Q = view.iskry;
    for (let i = 0; i < nSparks; i++) {
      const o = i * PART_STRIDE;
      const a = i * 3;
      Q[o] = qP[a]; Q[o + 1] = qP[a + 1]; Q[o + 2] = qP[a + 2]; Q[o + 3] = qLife[i] / qLife0[i];
      Q[o + 4] = qPrev[a]; Q[o + 5] = qPrev[a + 1]; Q[o + 6] = qPrev[a + 2]; Q[o + 7] = 1;
    }
    view.nIskry = nSparks;
    // masa w leju: grubość rysowana komórek pola (z prześwitem pod nawisem kuli) i ostygnięcie
    if (view.masaOn) field.writeView(view.masa);
    // gaz w rurze zbiorczej po przedziałach drogi: [0] — wlot przy studni (najmłodszy), dalej ku separatorowi
    {
      const G = view.gazRura;
      const last = X[XGDI];
      for (let j = 0; j < DUCT_N; j++) {
        let sl = (last - j) % DUCT_N;
        if (sl < 0) sl += DUCT_N;
        G[j] = ductRing[sl] / UNITS_PER_TON;
      }
    }
    for (let i = 0; i < MODES; i++) modesOut[i] = modeA[i];
    par[0] = S[STAN.radius] > 24 ? S[STAN.radius] : 24;
    modeEnergyInto(modeA, modeV, modeEq, par);
    S[STAN.energy] = par[2];
  }

  /** Krok symulacji o `dt` sekund (długi krok dzielony na podkroki ≤ 1/120 s). */
  function step(dt) {
    if (!(dt > 0)) return;
    Sprev.set(S);
    for (let i = 0; i < MODES; i++) modesOut[MODES + i] = modeA[i];
    for (let i = nFlight * 3 - 1; i >= 0; i--) fPrev[i] = fP[i];
    for (let i = nDrops * 3 - 1; i >= 0; i--) dPrev[i] = dP[i];
    if (view.masaOn) view.masaPrev.set(view.masa);
    for (let i = nSparks * 3 - 1; i >= 0; i--) qPrev[i] = qP[i];
    for (let i = nGran * 3 - 1; i >= 0; i--) gPrev[i] = gP[i];
    const n = Math.max(1, Math.ceil(dt / SUB - 1e-9));
    X[XH] = dt / n;
    X[XDT] = dt;
    for (let k = 0; k < n; k++) substep();
    stepHeapHeat();
    writeView();
  }

  /**
   * Bilans mas policzony z PULI (nie z liczników): 12 · podane − wszystko, co jest i co wyszło (metal, żużel, gaz). Ma być 0.
   * Zwraca też niezgodność liczników z pulami (`mismatch`, ma być 0).
   */
  function audit() {
    let floes = 0;
    for (let i = 0; i < nFloes; i++) floes += kMass[i];
    let thread = X[XGRAN];
    for (let k = 0; k < nThread; k++) thread += tUnits[(tHead + k) % NT];
    let gran = 0;
    for (let i = 0; i < nGran; i++) gran += gMass[i];
    let drops = 0;
    for (let i = 0; i < nDrops; i++) drops += dMass[i];
    const heap = nHeap - hHead;
    let duct = 0;
    for (let k = 0; k < DUCT_N; k++) duct += ductRing[k];
    let tanks = 0;
    for (let k = 0; k < NTANK; k++) tanks += tank[k];
    const gas = Cn[LICZNIK.gasBath] + Cn[LICZNIK.gasAir] + duct + tanks + Cn[LICZNIK.gasOut] - Cn[LICZNIK.gasAdvance];
    const have = Cn[LICZNIK.metal] + SLAG_U * (floes + thread + gran + Cn[LICZNIK.slagOut]) + Cn[LICZNIK.funnel] + Cn[LICZNIK.delivered] + drops
      + GRAIN_UNITS * (nBelt + nFlight + heap) + gas;
    const balance = GRAIN_UNITS * Cn[LICZNIK.fed] - have;
    const mismatch = Math.abs(floes - Cn[LICZNIK.slagFloes]) + Math.abs(thread - Cn[LICZNIK.slagThread]) + Math.abs(gran - Cn[LICZNIK.slagCatcher]) + Math.abs(drops - Cn[LICZNIK.drops])
      + Math.abs(nBelt - Cn[LICZNIK.belt]) + Math.abs(nFlight - Cn[LICZNIK.flight]) + Math.abs(heap - Cn[LICZNIK.heap])
      + Math.abs(duct - Cn[LICZNIK.gasDuct]) + Math.abs(tanks - Cn[LICZNIK.gasTank])
      + (Cn[LICZNIK.gasBath] < 0 || Cn[LICZNIK.gasAir] < 0 || Cn[LICZNIK.gasAdvance] < 0 ? 1 : 0);
    return { balance, mismatch };
  }

  /**
   * Skrót stanu (FNV-1a po bitach tablic) — dwa przebiegi z jednego ziarna dają ten sam. `gas = false` — bez gazu
   * (pola stanu od `STAN.wentyl`, liczniki od `gasBath`, tablice i losowość gazu): ten skrót jest wspólny dla metali
   * (metal zmienia tylko gaz, masę żużla i barwy — przebieg procesu jest ten sam).
   */
  function hash(gas = true) {
    let hsh = 0x811c9dc5;
    const eat = (buf, n) => {
      const u = new Uint32Array(buf.buffer, buf.byteOffset, Math.floor(n * buf.BYTES_PER_ELEMENT / 4));
      for (let i = 0; i < u.length; i++) { hsh ^= u[i]; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
    };
    eat(S, gas ? STAN_N : STAN.wentyl); eat(X, gas ? X_N : XG60); eat(Cn, gas ? LICZNIK_N : LICZNIK.gasBath); eat(modeA, MODES); eat(modeV, MODES);
    if (gas) { eat(gasRec, GAZ_SLOTS * GAZ_STRIDE); eat(ductRing, DUCT_N); eat(tank, NTANK); eat(burstRem, NBURST); eat(rs, 2); }
    if (impacted) { eat(field.h, MASA_CELLS); eat(field.ur, field.ur.length); eat(field.ut, field.ut.length); }
    eat(fP, nFlight * 3); eat(fV, nFlight * 3); eat(hP, nHeap * 3); eat(hHeat, nHeap);
    eat(kDir, nFloes * 3); eat(kMass, nFloes); eat(kRad, nFloes); eat(gP, nGran * 3); eat(gMass, nGran); eat(dP, nDrops * 3);
    return hsh >>> 0;
  }

  /** Zgoda na zrzut (tryb `auto: false`): po zdarzeniu gotowości maszyneria odjeżdża i komora zrzuca kulę. */
  function tap() {
    if (S[STAN.waiting] === 1) S[STAN.waiting] = 2;
  }

  // --- stan początkowy: pusta komora, generator 0 g pracuje, pierwsza kupa wchodzi na taśmę -----------------------
  S[STAN.omega] = PROCES.omegaIdle;
  S[STAN.mach] = MACH.rOut;
  S[STAN.machY] = MACH.padY;
  S[STAN.heapScale] = 1;
  S[STAN.squash] = 1;
  S[STAN.wide] = 1;
  S[STAN.impactT] = -1;
  S[STAN.fallT] = -1;
  S[STAN.level] = FUN.throatY;
  S[STAN.levelMax] = FUN.throatY;
  S[STAN.dspSpeed] = 1;
  S[STAN.dsp] = DSP.RUN;
  S[STAN.lakeR] = FUN.throatR;
  S[STAN.foldY] = FUN.rimY;
  S[STAN.humpY] = FUN.throatY;
  S[STAN.massTop] = FUN.throatY;
  S[STAN.headX] = SS.parkX;
  S[STAN.mouthX] = SS.parkX - SS.neckPark;
  S[STAN.mouthY] = SS.boomY - SS.kneeDrop - 1;
  S[STAN.phase] = PHASE.EMPTY;
  // gaz: wentylacja w trybie 0 g, żaluzje okapów przymknięte, żaden zbiornik nie jest opróżniany
  S[STAN.wentyl] = 1;
  S[STAN.hood] = GAZ_PROCES.hoodMin;
  S[STAN.draw] = 1;
  S[STAN.pulseT] = -1;
  S[STAN.tankDrain] = -1;
  X[XGPH] = PHASE.EMPTY;
  gasNextBubble();
  setRadius();
  lumpRoll();
  envGrow();
  startFeed(0);
  writeView();
  Sprev.set(S);

  // literał z getterami (Object.assign skopiowałby ich wartości z chwili budowy)
  api = {
    onReady: null,
    metal: M, view, counters: Cn, track, sBoundary,
    feed, step, tap, audit, hash, takeGas,
    /** Podział ziarna [metal, żużel, gaz] w jednostkach i gaz obiegu z receptury [jedn.]. */
    split: M.split, cycleGas,
    /** Zbiorniki tlenu: zawartość [jedn.] i pojemność (do testów i panelu). */
    tanks: tank, tankCap: TANK_CAP,
    modes: { a: modeA, v: modeV, eq: modeEq },
    get time() { return S[STAN.time]; },
    get phase() { return S[STAN.phase]; },
    get radius() { return S[STAN.radius]; },
    /** Taśma komory jedzie (brama 0 g otwarta albo czoło wsadu jeszcze do niej nie dojechało) — wolno podawać ziarna. */
    get acceptsFeed() { return !(nBelt > 0 && S[STAN.beltTravel] - bS0[bHead] >= sBoundary - 0.25 && gateOpen() === 0); },
    /** Największe zagłębienie środka ziarna w locie pod powierzchnię kuli [j.] (test: ziarno nie siedzi w kuli). */
    flightPenetration() {
      let m = -Infinity;
      const R = S[STAN.radius];
      if (!(R > 1) || impacted) return m;
      for (let j = 0; j < nFlight; j++) {
        const a = j * 3;
        const bx = fP[a] - S[STAN.offX];
        const by = fP[a + 1] - S[STAN.offY];
        const bz = fP[a + 2] - S[STAN.offZ];
        const d = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-6;
        D[DN] = bx / d; D[DN + 1] = by / d; D[DN + 2] = bz / d;
        surfaceOffsetInto(modeA, D);
        const q = R * (1 + D[DOFF]) - d;
        if (q > m) m = q;
      }
      return m;
    },
    /** Największy promień w planie i największa |wysokość| ziarna w locie (test: nic nie ucieka z komory). */
    flightExtent() {
      let r = 0;
      let y = 0;
      for (let j = 0; j < nFlight; j++) {
        const q = Math.sqrt(fP[j * 3] * fP[j * 3] + fP[j * 3 + 2] * fP[j * 3 + 2]);
        if (q > r) r = q;
        if (Math.abs(fP[j * 3 + 1]) > y) y = Math.abs(fP[j * 3 + 1]);
      }
      return { r, y };
    },
    /**
     * Kupa ziaren (test i liczniki): liczba, promień średniokwadratowy i największy [j., po skali docisku], półosie
     * obrysu (x, y, z), najmniejsza odległość dwóch ziaren (lokalna), udział ziaren ze stykiem (sąsiad bliżej niż
     * 1,05 × odległość styku) i wysokość środka masy w komorze.
     */
    heapStats() {
      const n = nHeap - hHead;
      const sc = S[STAN.heapScale];
      let s2 = 0;
      let max = 0;
      let ex = 0;
      let ey = 0;
      let ez = 0;
      let minGap = Infinity;
      let touching = 0;
      let cy = 0;
      for (let i = hHead; i < nHeap; i++) {
        const b = i * 3;
        const r2 = hP[b] * hP[b] + hP[b + 1] * hP[b + 1] + hP[b + 2] * hP[b + 2];
        s2 += r2;
        if (r2 > max) max = r2;
        ex = Math.max(ex, Math.abs(hP[b])); ey = Math.max(ey, Math.abs(hP[b + 1])); ez = Math.max(ez, Math.abs(hP[b + 2]));
        cy += hW[b + 1];
        let near = Infinity;
        for (let j = hHead; j < nHeap; j++) {
          if (j === i) continue;
          const q = j * 3;
          const dx = hP[q] - hP[b];
          if (dx > 1.06 * HC || dx < -1.06 * HC) continue;
          const dy = hP[q + 1] - hP[b + 1];
          const dz = hP[q + 2] - hP[b + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < near) near = d2;
        }
        near = Math.sqrt(near);
        if (near < minGap) minGap = near;
        if (near <= 1.05 * HC) touching++;
      }
      return {
        n, rms: n ? Math.sqrt(s2 / n) * sc : 0, max: Math.sqrt(max) * sc, ext: [ex * sc, ey * sc, ez * sc], minGap,
        touching: n ? touching / n : 0, centerY: n ? cy / n : 0, scale: sc, sorted: heapSorted
      };
    },
    /**
     * Żużel na kuli (test i liczniki): liczba wysp żywych i gasnących, podział masy na drobiny (< 0,25 t), wyspy
     * i czapę [t], największy promień rysowany [rad], masa w strefie bieguna [t], liczba zlań od początku.
     */
    slagStats() {
      let alive = 0;
      let dying = 0;
      let specks = 0;
      let speckT = 0;
      let islandT = 0;
      let maxRad = 0;
      for (let i = 0; i < nFloes; i++) {
        if (kMass[i] === 0) { dying++; continue; }
        alive++;
        if (kRad[i] > maxRad) maxRad = kRad[i];
        if (i === capI) continue;
        if (kMass[i] < SLAG_EQ_PER_TON / 4) { specks++; speckT += kMass[i]; } else islandT += kMass[i];
      }
      return {
        alive, dying, specks, speckTons: speckT / SLAG_EQ_PER_TON, islandTons: islandT / SLAG_EQ_PER_TON,
        capTons: capI >= 0 ? kMass[capI] / SLAG_EQ_PER_TON : 0, zoneTons: S[STAN.capMass] / SLAG_EQ_PER_TON, maxRad, merges: Cn[LICZNIK.merges],
        thread: nThread, granules: nGran, flying: nFly
      };
    },
    /** Pole masy w leju (`masa.js`): tablice i pomiary — do testów i liczników dema. */
    field,
    /**
     * Najmniejszy odstęp [j.] między segmentami cewek a powierzchnią bryły w bieżącym stanie, osobno dla górnego
     * i dolnego pierścienia: `{ upper, lower }`. Powierzchnia kuli z modami drgań i największym uniesieniem żużla
     * (`SLAG.lift`), kupa — jej obrys; segment — punkty najbliższych bryle elementów (zwoje, obejmy, króćce) wzdłuż
     * łuku. Bez bryły w polu (pusta komora, zrzut) zwraca nieskończoność.
     */
    coilGap() {
      const R = S[STAN.radius];
      const body = R > 1 ? R : S[STAN.heapN] > 0 ? S[STAN.heapR] : 0;
      const res = { upper: Infinity, lower: Infinity };
      if (!(body > 0) || released) return res;
      const lift = R > 1 ? SLAG.lift : 0;
      const half = MACH.arcHalf * DEG;
      for (const [list, sy, key] of [[MACH.upper, 1, 'upper'], [MACH.lower, -1, 'lower']]) {
        for (const deg of list) {
          const a = deg * DEG;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          // oś segmentu: pierścień + rzut środka klatki na kierunek wysięgnika; wysokość + środek klatki
          const r0 = S[STAN.mach] + S[STAN.cageX] * ca + S[STAN.cageZ] * sa;
          const y0 = sy * S[STAN.machY] + S[STAN.cageY];
          const ccx = ca * (r0 - MACH.arcR);
          const ccz = sa * (r0 - MACH.arcR);
          for (let q = -4; q <= 4; q++) {
            const f = a + half * q / 4;
            const cf = Math.cos(f);
            const sf = Math.sin(f);
            for (const [dr, dy] of MACH.profile) {
              const px = ccx + cf * (MACH.arcR - dr) - S[STAN.offX];
              const py = y0 - sy * dy - S[STAN.offY];
              const pz = ccz + sf * (MACH.arcR - dr) - S[STAN.offZ];
              const d = Math.sqrt(px * px + py * py + pz * pz) || 1e-6;
              let surf = body;
              if (R > 1) {
                D[DN] = px / d; D[DN + 1] = py / d; D[DN + 2] = pz / d;
                surfaceOffsetInto(modeA, D);
                surf = R * (1 + D[DOFF] + lift);
              }
              if (d - surf < res[key]) res[key] = d - surf;
            }
          }
        }
      }
      return res;
    },
    /** Masy [t] (rzeczywiste: żużel = porcje × `split[1]`; kupa i ziarna z gazem i żużlem). */
    tons() {
      const t = (u) => u / UNITS_PER_TON;
      const z = (porcje) => porcje * SLAG_U / UNITS_PER_TON;
      return {
        kula: t(Cn[LICZNIK.metal]) + z(Cn[LICZNIK.slagFloes]), metal: t(Cn[LICZNIK.metal]), zuzelNaKuli: z(Cn[LICZNIK.slagFloes]), czapa: z(capI >= 0 ? kMass[capI] : 0),
        nitka: z(Cn[LICZNIK.slagThread]), odbieralnik: z(Cn[LICZNIK.slagCatcher]), wywiezione: z(Cn[LICZNIK.slagOut]),
        lej: t(Cn[LICZNIK.funnel]), oddane: t(Cn[LICZNIK.delivered]),
        krople: t(Cn[LICZNIK.drops]), tasma: t(nBelt * GRAIN_UNITS), lot: t(nFlight * GRAIN_UNITS), kupa: t((nHeap - hHead) * GRAIN_UNITS),
        gazKapiel: t(Cn[LICZNIK.gasBath]), gazKomora: t(Cn[LICZNIK.gasAir]), gazRura: t(Cn[LICZNIK.gasDuct]),
        tlenZbiorniki: t(Cn[LICZNIK.gasTank]), tlenOddany: t(Cn[LICZNIK.gasOut]), gazZaliczka: t(Cn[LICZNIK.gasAdvance]),
        podane: Cn[LICZNIK.fed] / GRAIN.perTon
      };
    },
    /** Gaz komory (panel, testy): pule [t], wentylacja, przepływy [t/s], zbiorniki 0…1, zdarzenia. */
    gasStats() {
      return {
        kapiel: Cn[LICZNIK.gasBath] / UNITS_PER_TON, komora: Cn[LICZNIK.gasAir] / UNITS_PER_TON, rura: Cn[LICZNIK.gasDuct] / UNITS_PER_TON,
        zbiorniki: Cn[LICZNIK.gasTank] / UNITS_PER_TON, oddany: Cn[LICZNIK.gasOut] / UNITS_PER_TON, zaliczka: Cn[LICZNIK.gasAdvance] / UNITS_PER_TON,
        wentyl: S[STAN.wentyl], przeplyw: S[STAN.gasFlow], doZbiornikow: S[STAN.ductFlow], zrodla: S[STAN.gasEmit], okapy: S[STAN.hood],
        napelnienie: [S[STAN.tank0], S[STAN.tank1], S[STAN.tank2]], napelniany: S[STAN.tankFill], oprozniany: S[STAN.tankDrain],
        babli: Cn[LICZNIK.bubbles], wyrzutow: Cn[LICZNIK.bursts], rezerwaSsawy: X[XGRES] / UNITS_PER_TON,
        ciag: S[STAN.draw], cyklOdciagu: S[STAN.pulseT]
      };
    }
  };

  if (prewarm) {
    // rozbieg: strona startuje z cyklem w toku — kupa rudy w 2/3 usypana, struga ziaren płynie; za kilka sekund
    // docisk i topienie (przy wejściu od razu coś się dzieje, bez pustej komory)
    let guard = 0;
    while (!(S[STAN.phase] === PHASE.GATHER && nHeap >= heapGrains * 0.62) && guard++ < 60 * 60) step(1 / 60);
  }
  return api;
}

export { HMAX };
