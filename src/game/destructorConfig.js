// Strojenie heksowego destruktora i żar heksa — DANE bez silnika.
//
// Od etapu 8 portu silnika belek (docs/PORT-silnik-belek.md) gra nie ładuje destructor.js:
// wszystkie kadłuby w grze są na belkach (hullBodies.js). Heksy zostały w demach (mostki,
// rdzeń, asteroidy) — one ładują destructor.js, który re-eksportuje stąd te same nazwy.
// Ten moduł czytają też renderer heksów (hexShips3D.js), mostki 3D (bridge3D.js) i panel
// strojenia — bez wciągania silnika, solvera GPU ani areny heksów do grafu gry.

// Skala odniesienia obrażeń kontaktu (destructor.js dzieli przez nią contactDamageScale).
export const DEFAULT_CONTACT_DAMAGE_SCALE = 0.18;

export const DESTRUCTOR_CONFIG = {
  gridDivisions: 5, //
  packedHexArena: 1,
  edgeCollision: 1,
  shardMass: 10.0, //
  visualRotationOffset: 0, //
  shardHP: 80, //
  inflictedDamageMult: 1.0, //
  maxDeform: 100.0,            // Max deformacja (px)
  tearThreshold: 34.0, //
  yieldPoint: 22.0, //
  deformMul: 0.45, //
  bendingRadius: 24.0, //
  softBodyTension: 0.14,       // Propagacja k
  gpuPropagationDamping: 0.96, //
  recoverSpeed: 1.0, //
  repairRate: 100, //
  visualLerpSpeed: 14.0, //
  elasticSleepFrames: 30,      // Klatki ciszy zanim grid zasypia (brak symulacji)
  elasticSleepThreshold: 0.15, //
  elasticSleepVelocityThreshold: 0.03, //
  elasticSleepSnapThreshold: 0.04, //
  elasticWakeFrames: 20,       // Force-awake po uderzeniu (zapobiega przedwczesnemu zasypianiu)
  // === MODEL ZDERZEŃ ===
  // Impuls z restytucji, deformacja i uszkodzenia warstwy kontaktowej.
  // Przy przewadze masy kadłub ustępuje płynnie ze wzrostem prędkości;
  // nie przełączamy trybu kolizji na sztywnym progu masy lub prędkości.
  restitution: 0.05,                  // sprężystość odbicia (0 = zderzenie idealnie plastyczne)
  frictionCoeff: 0.5,                 // µ — sufit impulsu stycznego względem normalnego
  tangentImpulseScale: 0.8,           // ile impulsu stycznego faktycznie trafia w ciała
  separationPercent: 0.9,             // ułamek korekty penetracji (pełna przy ścianie/głębokim zanurzeniu)
  crushMinSpeed: 12.0,                // podłoga WYDAJNOŚCIOWA: poniżej tej prędkości zbliżania
  //                                     wgniecenie byłoby subpikselowe — pomijamy pętlę kontaktów
  crushImpulseScale: 0.25,            // prędkość zbliżania → energia zgniotu
  //                                     (przy 0.25 pasmo 0-230 u/s rozdziela się na
  //                                     realne głębokości; wyżej materiał jest wysycony)
  crushDeformScale: 1.0,              // energia zgniotu → deformacja heksów
  contactDamageScale: DEFAULT_CONTACT_DAMAGE_SCALE, // deformacja → obrażenia heksa
  ramYieldSpeed: 80.0,               // skala płynnego ustępowania lżejszego kadłuba (u/s)
  contactDamageCapFrac: 1.5,          // BEZPIECZNIK obrażeń heksa na tick (× jego HP).
  //                                     Nie jest regulatorem siły: przy 0.25 prędkość
  //                                     przestawała mieć znaczenie dla zniszczeń, bo
  //                                     sufit wiązał zawsze. Ma ciąć tylko wystrzały
  //                                     numeryczne — resztę robi energia uderzenia.
  // Ile kontaktow tworzy PELNA plame styku. Przy taranie 400-1500 u/s i kroku
  // 1/120 kadluby zanurzaja sie w siebie o mniej niz jeden heks, wiec narrowphase
  // znajduje 1 kontakt (budzet to 24-32, to NIE jest limit). Caly impuls dziala
  // wtedy w jednym punkcie poza srodkiem masy i zamienia sie w moment obrotowy.
  // Pomiar: fregata (10k) rozkrecana do 5.65 rad/s, pancernik (50k) do 1.44 —
  // stosunek 3.9x, zgodny z modelem (16.8x odwrotnej bezwladnosci / 5x mniejszy
  // impuls). Lekki kadlub koziolkuje i stacza sie z dziobu, zanim zdazy sie
  // zemlec. Jeden kontakt to artefakt dyskretyzacji, nie fizyka — prawdziwy
  // taran dziobem ma szeroki styk. Tlumimy wiec czlon KATOWY proporcjonalnie do
  // jakosci probki; przy szerokim styku nic sie nie zmienia.
  contactPatchFullCount: 4,

  // Nadmiar obrazen ponad sufit heksa nie moze znikac. Bez tego jeden kontakt to
  // zawsze DOKLADNIE jeden zniszczony heks i taran przy 1500 u/s robi to samo co
  // przy 500 — predkosc przestaje cokolwiek znaczyc. Nadmiar idzie w promieniste
  // rozejscie sie uszkodzen (ta sama sciezka co pociski), wiec szybszy taran
  // wybija SZERSZA dziure, a nie glebsza w tej samej komorce.
  ramOverkillMinDamage: 25.0,
  ramOverkillRadiusScale: 1.6,
  ramOverkillMaxRadius: 180.0,

  shearK: 0.06, //

  // Próg "szybkiej pary" — WYŁĄCZNIE wydajność: powyżej niego druga iteracja kolizji
  // jest pomijana, a budżet kontaktów przechodzi w tryb otarcia. Nie zmienia fizyki.
  fastPairSpeedThreshold: 200.0,

  collisionDeformScale: 1.15, //
  collisionSearchRadius: 5, //
  // Sufit dryfu (px siatki), który pokrywają okna sond trafień: probeImpact,
  // sweepImpact i raymarch wiązki (findBeamHexShard). Sondy szukają heksów po
  // komórkach POCZĄTKOWYCH, a wgnieciony heks stoi o `_maxHexDrift` dalej —
  // bez zapasu był „duchem”: pocisk i wiązka przelatywały przez wgniecenie.
  // 120 ≈ maxDeform × collisionDeformScale (dalej heks jest już urwany), więc
  // sufit tnie tylko koszt przy dryfie patologicznym. 0 = dawne okna bez zapasu.
  probeDriftCap: 120,
  collisionIterations: 2, //
  // Przebiegi poprawkowe (2.+) tylko dla par z ciałem ruszonym przez kontakt.
  // Wynik identyczny z pełnym przebiegiem; 0 = pełny przebieg (do porównań).
  collisionRefineMovedOnly: 1,
  // Sprężystość CPU tylko po liście heksów w ruchu (simulateElasticity).
  // Wynik identyczny z pełną iteracją; 0 = każdy heks co klatkę (do porównań).
  elasticActiveList: 1,
  broadphaseCellSize: 1200, //
  // Zapas w KOMORKACH doliczany do zmierzonego dryfu heksow przy wyborze searchR.
  // null = mechanizm WYLACZONY (searchR jak dotad). Liczba wlacza adaptacyjny
  // sufit: nietkniety kadlub schodzi z dysku 49-81 komorek na ~13.
  searchRDriftMargin: null,
  broadphaseMaxCandidates: 128, //

  splitForceThreshold: 50, //
  splitDamageThreshold: 200, //
  splitCheckInterval: 12, //
  splitMaxPerTick: 1, //
  splitTimeBudgetMs: 1.2, //
  splitDeferTicks: 8, //
  splitDeferSpeedThreshold: 140, //

  gpuSoftBody: 1, //
  // Kroki solvera sprężyn GPU na sekundę CZASU GRY (DestructorGpuSoftBody.tick).
  // Kernel całkuje prędkość na iterację bez dt, więc dispatch co klatkę renderu
  // wgniatał przy 144 FPS 2,4× szybciej niż przy 60. Poniżej tej częstotliwości
  // klatek: krok na klatkę jak dawniej. 0 = zawsze dispatch co klatkę.
  gpuSoftBodyHz: 60,
  gpuSoftBodyMinShards: 64, //
  gpuSoftBodyCrashShardThreshold: 1200, //
  gpuSoftBodyCrashIters: 1, //

  wreckSplitLinearResponse: 0.23, //
  wreckSplitOutwardKick: 0.010, //
  wreckSplitAngularResponse: 0.030, //
  wreckSplitMinAngularKick: 0.012, //
  fractureImpactMemory: 0.6,           // seconds; retain the cut direction until the budgeted split check
  wreckSplitImpactResponse: 0.16,      // fraction of local crush speed released at a fracture
  wreckSplitMaxAngularKick: 0.35,      // rad/s; heavy pieces peel away without spinning like confetti
  wreckSplitMaxFragments: 8,          // additional islands become pooled chips, not more physics bodies

  // === WARSTWA PREZENTACJI ZDERZEŃ (CollisionFX) ===
  // Nic tutaj nie wchodzi w model zderzeń: te liczby decydują wyłącznie o tym,
  // KIEDY leci zdarzenie i JAK MOCNO żarzy się blacha. Zerowanie któregokolwiek
  // gasi efekt, nie zmienia fizyki.
  //
  // Zderzenie ma mieć moment. Strumień identycznych ticków 120 Hz nie niesie
  // informacji "właśnie uderzyło" — stąd osobne zdarzenie pierwszego zetknięcia,
  // z progiem prędkości i cooldownem na parę.
  impactMinSpeed: 40.0,        // u/s; poniżej tego zbliżania zetknięcie to
  //                              dosunięcie się burtą, nie uderzenie
  impactCooldown: 1.5,         // s czasu SYMULACJI; odbicie i powrót w tym oknie
  //                              to wciąż to samo zderzenie, nie drugie uderzenie
  collisionFxDebug: 0,         // 1 = console.debug przy każdym onImpact

  // Iskry lecą z K punktów rozłożonych po szwie zamiast z jednego snopu w
  // centroidzie. Budżet iskier jest ten sam — dzielony, nie mnożony.
  seamSparkPoints: 6,          // 0/1 = dawny pojedynczy snop

  // === KANAŁ HEAT ===
  // Rozżarzenie heksa żyje NIEZALEŻNIE od deformacji: strefa zgniotu stygnie
  // przez kilka sekund także po tym, jak siatka zaśnie i po wypaleniu
  // plastycznym (aStress jest wtedy zerowy). Zanik liczy shader z (heat,
  // heatStamp) — CPU nie chodzi po shardach ani razu więcej niż dotąd.
  //
  // GDZIE ma świecić: na KADŁUBIE, na brzegu rany i na powierzchni tarcia.
  // Pierwsza wersja grzała tylko heksy z bufora kontaktów — a te przy taranie
  // giną w tym samym ticku i odlatują. Pomiar (taran w róg, 60 ticków): odłamki
  // średnio 0.97, brzeg rany 0.41, dziób taranującego 0. Świeciły odłamki,
  // a ocalała krawędź wyrwy była ledwie pomarańczowa. Stąd dwa źródła niżej:
  // żar brzegu rany (przy każdym zniszczonym heksie) i żar styku (tarcie).
  heatGain: 0.9,               // ułamek HP zdjęty w ticku → przyrost żaru (0-1)
  heatDecay: 0.35,             // 1/s; biały ~1 s, pomarańcz do ~2.3 s, wiśnia do ~5 s
  // Jasność BIAŁEGO żaru w HDR. Próg bloomu gry to 0.9 (bloomConfig.js), ACES
  // odbarwia do bieli powyżej ~1.5, przepalony biały rdzeń leży w 8-12. Reszta rampy
  // spada ~h^4 (Stefan-Boltzmann), więc stygnący metal schodzi POD próg i zostaje
  // nasyconym pomarańczem/wiśnią zamiast szarej poświaty. Dawny `heatTint` (1.6)
  // dawał szczyt ledwie nad progiem — stąd "pomarańczowy obwód" zamiast żaru.
  heatGlowPeak: 9.0,           // 0 = kanał wyłączony

  // ŻAR BRZEGU RANY. Kiedy heks ginie, jego OCALALI sąsiedzi stają się nową
  // krawędzią wyrwy — to ona ma świecić, nie odlatujący kawałek. Pierścień 1
  // dostaje pełną wartość, pierścień 2 ułamek (strefa wpływu ciepła).
  woundHeat: 1.0,              // żar brzegu przy zniszczeniu w zderzeniu (0-1)
  woundHeatSpeed: 150.0,       // u/s zbliżania, przy której brzeg jest biały;
  //                              wolniejszy zgniot zostawia brzeg pomarańczowy
  woundHeatInherit: 0.85,      // ile własnego żaru ginący heks oddaje brzegowi —
  //                              tym żar idzie za frontem zgniotu i za rozdarciem
  //                              GPU, które zaczyna się w gorącej strefie
  woundHeatRing2: 0.55,        // pierścień 2 względem pierścienia 1

  // ŻAR STYKU (tarcie i zgniot powierzchni). Liczony z prędkości względnej
  // w punkcie styku, symetrycznie dla OBU kadłubów — dziób taranującego też
  // się rozgrzewa. Działa także wtedy, gdy zbliżanie jest poniżej crushMinSpeed
  // (czyste otarcie), bo to właśnie tarcie ma grzać.
  contactHeatRate: 3.0,        // żar/s przy contactHeatSpeed
  contactHeatSpeed: 120.0,     // u/s; poniżej tempo spada z KWADRATEM prędkości,
  //                              więc powolne dosunięcie burtą nie świeci

  // Odłamki świecą w paśmie BARWY (bez białego szczytu) — mają być tłem dla
  // żaru na kadłubie, nie głównym aktorem.
  debrisHeatGlow: 1.2,
  debrisHeatFloor: 0.25,       // metal urwany ROZCIĄGANIEM (GPU tear) nie ma
  //                              historii zgniotu — ma się żarzyć słabo, ale nie wcale
  heatFromProjectiles: 0,      // 1 = trafienia pociskami też grzeją blachę
};

// Dryf heksów (px siatki), który okna sond trafień muszą pokryć: zmierzony
// `_maxHexDrift` przycięty sufitem probeDriftCap. Brak pomiaru = 0 (dawne okna).
export function getHexProbeDrift(grid) {
  const drift = Number(grid?._maxHexDrift);
  if (!(drift > 0)) return 0;
  const cap = Number(DESTRUCTOR_CONFIG.probeDriftCap);
  if (!(cap > 0)) return 0;
  return drift < cap ? drift : cap;
}

// === ŻAR HEKSA (kanał heat) ===
// Dwa pola na shardzie: `heat` (szczyt, 0-1) i `heatStamp` (sekundy). Zanik
// liczy SHADER z tej pary, nie CPU — inaczej każde rozżarzenie kosztowałoby
// pętlę po wszystkich shardach wszystkich encji co klatkę, a żar ma trwać
// dokładnie wtedy, gdy siatka już śpi i nic jej nie odwiedza.
//
// Baza czasu musi być TA SAMA co w rendererze: hexShips3D zapisuje
// uTime = state.lastTime * 0.001, gdzie lastTime to performance.now().
export function shardHeatNow(shard, nowSec) {
  const peak = Number(shard?.heat) || 0;
  if (peak <= 0) return 0;
  const age = nowSec - (Number(shard.heatStamp) || 0);
  if (age <= 0) return peak;
  return peak * Math.exp(-age * (Number(DESTRUCTOR_CONFIG.heatDecay) || 0.45));
}

// Dokładanie żaru startuje od WARTOŚCI PO ZANIKU, nie od zapamiętanego szczytu —
// inaczej długie tarcie trzymałoby heks w białym żarze bez końca.
export function addShardHeat(shard, amount, nowSec) {
  if (!shard || !(amount > 0)) return;
  const next = shardHeatNow(shard, nowSec) + amount;
  shard.heat = next > 1 ? 1 : next;
  shard.heatStamp = nowSec;
}
