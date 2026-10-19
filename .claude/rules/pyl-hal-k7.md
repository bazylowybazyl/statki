---
paths:
  - "src/3d/gasField/**"
  - "src/game/hallDustInput.js"
  - "src/game/hullFootprint.js"
  - "src/3d/haloRing/haloPortK7Lights.js"
---

# Pył i para w halach K-7: pole gazu 2D, źródła gazu, światła i pola siłowe hali

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pył i para w halach K-7, światła hali — gazy, etap 1 (2026-10-07; `src/3d/gasField/`, `src/game/hallDustInput.js`, plan `docs/PLAN-gazy.md`)

- Prośba użytkownika: okręt odpala silnik rufą do ściany, pył uderza w ścianę i ma to dobrze wyglądać. POLE GAZU 2D na GPU
  (`gasField2D.js`: nieściśliwy płyn z rzutem ciśnienia Jacobi i MASKĄ PRZESZKÓD, MacCormack, pole pozycji spoczynkowych —
  faktura jedzie z pyłem; pył w powietrzu i pył ZALEGAJĄCY na pokładzie: podrywa go szybki przepływ, opada w spokojnym).
  Domena = układ hali (`hallDustLayout.js`: ściany z bramami i bryły pokładu z `k7SolidList` — te same co kolizje, więcej
  kurzu przy ścianach, próżnia za bramą G-01, komórka 28 j., 400 × 336). Jedna symulacja na grę — hala przy kamerze
  (wszystkie 12 hal K-7 ma ten sam układ; zmiana hali = czyszczenie stanu).

- MODEL STRUMIENIA I BILANS PYŁU (2026-10-12, po audycie `docs/AUDYT-pyl-hali-2026-10-12.md` § 6; zgłoszenia użytkownika:
  „wypchane raz, potem nie leci”, „tunel za wąski w stosunku do 5 dysz MAIN”): strumień MAIN = JEDEN stożek na okręt
  z PROFILEM PŁASKIM na szerokość gromady dysz (`exp(−jetFlat·(x/w)⁴)`, w = `EngineFrame.spread` × `jetWidth`; źródła
  gazu hali zostają przy Gaussie — `jetD.z` = 0) i ŹRÓDŁEM OBJĘTOŚCI: wydatek gazu [komórki²/s] = `jetFlow` × moc ×
  Σ r² dysz / h² (Atlas: 5 dysz = 5× jedna), rozłożony od wylotu do `jetSourceLen`, na komórkę przez całkę profilu
  (`jetSourceIntegralCpu` — suma celu po komórkach = wydatek); adwekcja zapisuje go w `velB.z`, a rzut usuwa div − cel
  (`divNode`) — strumień ROZPYCHA zapylone powietrze, a nie zasysa go z boków. Pył i parę rozrzedzają gaz z dysz
  (`velB.z`) i spaliny w całym stożku (`jetClean` × profil → `velB.w`) — rdzeń strumienia to czysty tunel. Stożek
  ZASŁANIAJĄ przeszkody (marsz po kanale A rastru od komórki do wylotu, `jetD.w`; za ścianą tylną i za zbiornikami
  paliwa nie ma strumienia). Czwarta tablica strumieni `jetD` (`sim.jetsD`, 4 liczby: wydatek, zasięg źródła, profil,
  zasłanianie) — zera = dawny strumień. BILANS PYŁU: opadanie wszędzie w hali (`settleMin` przy szybkim przepływie,
  nigdy 0; nie ponad sufit pokładu 1 — nadmiar zostaje w powietrzu), zanik w hali śladowy (`decay` 0,002), bez
  odrastania (`regrow` 0), szybki tylko w próżni za bramą; próbki pyłu w adwekcji i MacCormacku ważone udziałem gazu
  (ściany nie zjadają pyłu). ZAPIS RGBA16F: zapis f32 → f16 do tekstury storage na RTX / D3D12 OBCINA ku zeru
  (zmierzone; inne GPU mogą zaokrąglać do najbliższej) — drobne przyrosty opadania ginęły, a ubytki traciły cały
  odstęp liczby (pył znikał, przepływ gasł); pył, pokład, para i prędkość zapisują się z ZAOKRĄGLENIEM STOCHASTYCZNYM
  (`_sround`, lustro `sroundCpu`; tryb sprzętu — `probeHalfRounding` raz na urządzeniu, `sim.halfRounding`,
  `U.roundBias`; wspólny moduł `src/3d/tsl/zapisF16.js` — też gaz 3D wybuchów). Nowe pole zmieniane drobnymi
  przyrostami w teksturze połówkowej — przez `sroundF16` (`zapisF16.js`). Tłumienie: opór
  0,2/s + kwadratowy szybkiego frontu poza stożkami (`dragQuad`, `dragFrontLo/Hi`), dyfuzja pyłu i pary (`dustDiff`
  + `eddyDiff`·|ω|, Neumann przy ścianach), turbulencja także w czystym gazie przy ścinaniu (`turbShear`), MIĘKKI RZUT
  (`soft` 0,01: Jacobi rozwiązuje (∇² − soft)·p = div − cel — gaz pod ciśnieniem „ucieka w pion” jak w hali 720 j.
  wysokości; 0 — dawny nieściśliwy). Podrywanie `liftLo` 150 / `liftHi` 650 j/s. Lustra CPU: `jetProfileCpu`,
  `jetSourceAlongCpu`, `jetVisibleCpu` (zmiana kernela = zmiana lustra, testy w `tests/hallDust.test.mjs`). A/B fizyki:
  `node scripts/webgpu/hala-pyl-audyt.mjs [--out …] [--tune jetFlow=300,sim.soft=0] [--krotko 1]` (bilans, profile
  w poprzek osi dysz, wiry, obrazy pól z GPU) + `node scripts/webgpu/hala-pyl-porownaj.mjs A/raport.json B/raport.json`.

- SZEW GRA ↔ RENDER (uzgodniony 2026-10-07 z sesją „Rendering w workerze”): gra w `render()` (obok
  `asteroidBelt.prepareFrame`) pakuje wejście klatki `packHallDustFrame` (Float64Array o stałym układzie `HALL_DUST_IN`:
  numer klatki, dt czasu gry — 0 w pauzie i scenach fabuły, hala → gra w double z `HaloRingCollider`, 16 slotów okrętów w
  układzie hali) → `HallDust.submit(tablica)`; krok `Core3D.addFxStep` czyta TYLKO tę tablicę i dysze MAIN z `EngineFrame`.
  W `src/3d/gasField` zero `window`, DOM i `requestIdleCallback` (strażnik w teście) — przeniesienie renderu do workera =
  przekazanie tablicy. Następne moduły gazów idą tym wzorem; rozgrywka gazu (chowanie się, zbieranie) — stan
  rozstrzygający po stronie gry na CPU, GPU tylko obraz.

- KADŁUBY W GAZIE = OBRYS OKRĘTU, nie pudło (zgłoszenie użytkownika 2026-10-07: „statek powinien rozcinać dym w takim
  kształcie, w jakim jest statek, a nie w prostokącie”): `hullFootprint(encja)` (`src/game/hullFootprint.js`, czysty) =
  maska 64 × 32 bity z ŻYWYCH węzłów siatki belek w układzie ciała względem kotwicy (rany, wyrwy i odcięte części zmieniają
  obrys; przebudowa ~0,05 ms tylko przy zmianie ciała; bez belek — fazowany prostokąt z `w` / `h`). Rekord okrętu
  `HALL_DUST_SHIP` (kotwica, osie kadłuba i prędkości w układzie hali, ω, róg i teksel maski, słowa maski) → krok efektów
  rozpakowuje zmienione maski do tekstury R8 (pas na slot) → kernel adwekcji: komórka pod maską (próbka liniowa, próg 0,5)
  jest stała z prędkością ciała + ω × r. Lustro CPU testu kernela: `hallBodySolidCpu` (`hallDustLayout.js`) — zmiana
  w kernelu = zmiana w lustrze. W grze: `node scripts/webgpu/hala-obrys-gra.mjs` (przelot ukosem przez kurz, odczyt
  komórek stałych z GPU → `obrys-mapa.png`, GPU ↔ lustro CPU, pipeline'y w klatce — 0).

- ZAPŁON SILNIKÓW w hali (2026-10-09, § „Odpalanie i gaszenie silników MAIN”): strumień dyszy w polu ma moc max(`EngineFrame.power`,
  `engineSmokeFlow`) — 0,45 w dymie zapłonu (narasta 0,2 s), do 0,32 przy gaszeniu: zimny gaz z dysz podrywa kurz, zanim
  zapali się struga (sama prędkość, bez pary — bez podwójnej mgły z dymem 3D). Ściana tylna hali jest przeszkodą gazu 3D
  wybuchów (§ „Wybuchy WebGPU”). `HallDust.interiorLightAt(x, y)` (0 poza domeną aktywnej hali, wewnątrz poziom lamp
  dzień / noc) daje otoczenie domen gazu 3D pod dachem hali (reżyser wybuchów: `__explosions.interiorLight`).

- POLA SIŁOWE BRAM (2026-10-13, prośba użytkownika: „pola siłowe, o które rozbije się dym z hali” — wylot Atlasem pcha
  dym, ciąg w bramę zawija go jak przy ścianie): zasłona w otworze każdej bramy (G-01, G-02, G-03), od pokładu do
  nadproża — JEDNO źródło `k7ForceFieldList` (`haloPortK7Layout.js`, pudło jak `k7SolidList` + oś bramy i normalna na
  zewnątrz). To NIE kolizja (statki i pociski przelatują), tylko przeszkoda GAZU: komórki rastru pyłu hali (R; kurz
  pokładu G liczony dalej od murów, odległość A z polami — strumień dysz zza pola nie wchodzi), pudła przeszkód gazu
  wybuchów (`gasObstacleInput.js` — dym zapłonu i wybuchów też się o nie rozbija). Kadłub w polu zostaje stały z prędkością
  ciała (maska obrysu ma pierwszeństwo). Bez pól pył wydmuchany za bramę ginął w próżni — z polami zostaje w hali
  (bilans zamknięty). Obraz (`gasFieldLayer.js`, `look.field*`): zasłona świeci słabo sama
  i rozbłyskuje tam, gdzie gaz napiera (gęstość i prędkość gazu 1,5 komórki przed licem): wąski blask addytywny
  w warstwie tylnej + cyjanowe światło pola na gazie; kadłub przebijający zasłonę — światła pola w siatce wzdłuż
  przecięcia (`hallBodyFieldSpan`, `HALL_DUST_TUNE.fieldLight*`). A/B na żywo: `HallDustTune.forceFields = false` (rastr
  przebudowuje się sam). Gaz hali 3D (`src/3d/hallGas*`, dema) pól jeszcze nie zna — przy wpięciu do gry: przeszkoda
  z `k7ForceFieldList`. W grze: `node scripts/webgpu/hala-pole-gra.mjs [--sceny A,B,C]` (A — ciąg w bramę z polem
  i bez, B — okręt w bramie pod nadprożem, C — wylot; pipeline'y w klatce — 0).

- Obraz (`gasFieldLayer.js`): dwie siatki w passie ortho — pod kadłubami (renderOrder 1, kolejka nieprzezroczysta) i
  ułamek NAD nimi (`front` 0,25, renderOrder 26); światło: wnętrze hali (lampy — także po nocnej stronie planety),
  słońce przez maskę cienia, światła siatki `Core3D.fx.grid` z kolanem (dysze, błyski); zanik przy oddaleniu.
  Rozgrzewka: wpis `pył hal K-7` (siatki) + `warm` kroku (kernele compute); pipeline'y w klatce gry — 0. Koszt (RTX klasy
  Blackwell): symulacja ~0,2–0,3 ms GPU na podkrok 1/60 s (2026-10-12: 0,17 ms z modelem strumienia i bilansem pyłu),
  warstwy ~0,04 ms; po 25 s bez dysz i ruchu kadłubów usypia (w praktyce nie — źródła gazu hali trzymają ją obudzoną).

- Narzędzia: `node scripts/webgpu/hala-pyl-gra.mjs [--zoom 0.32] [--trzymaj 1]` (Atlas na C-01 rufą do ściany, ciąg,
  seria zrzutów w pauzie, A/B bez pyłu, koszt GPU, pipeline'y w klatce), testy `tests/hallDust.test.mjs`; konsola:
  `HallDust.stats`, `HallDustTune` (strumienie, usypianie), wygląd `HallDust.layer.look` + `syncLook()`, fizyka
  `HallDust.sim.tune` + `syncTune()`.

- ŹRÓDŁA GAZU i ŚWIATŁA HALI (2026-10-07, prośby użytkownika: „coś powinno ten gaz produkować i powinien być trochę
  widoczny … przewody paliwowe — powoli, przy odpięciu mocniej”, „światła, które fajnie oświetlą gaz”, „czerwone /
  zielone / niebieskie mrygające militarne”, „dodaj snopy światła”):
  - PARA paliwa = drugi składnik pola (`den.z`: nie opada, rozpływa się — `vaporDecay`, w próżni szybciej). Źródła
    (`hallGasSources.js`, czyste) to rekordy w tej samej tablicy strumieni co dysze (`jetC.y` para, `.z` pył — wstrzykiwane
    w stożku; ostatnie `HALL_GAS_MAX` miejsc): złączki przewodów paliwowych TAM, GDZIE NIESIE JE RAMIĘ (`k7FuelCouplerAt`;
    sączenie, przeciek przy przepływie, KONTROLOWANY UPUST z pozy `vent`, BUCH pary dookoła złączki przy ryglowaniu
    i odryglowaniu — § „Obsługa paliwowa stanowisk K-7”, para przy zwijaniu), bębny na słupkach paliwowych i zawory
    magazynów przy ścianie tylnej (harmonogram `k7VentEnvelope`), dwa nawiewy wentylacji. Pozy
    obsługi stanowisk = STAN GRY w rejestrze kolidera (`collider.registry.halls[k].poses`: fabuła — `deps.k7HallPoses`,
    automat obsługi stanowisk — niżej); `HaloRingGame` podaje je hali (`opts.poses`), a `packHallDustFrame` do bloku
    `service` wejścia. Nie ustawiaj póz wprost w `HaloPortK7.setServicePoses` (hala czyta rejestr co klatkę).
  - AUTOMAT OBSŁUGI STANOWISK (gra swobodna, 2026-10-07; `src/game/k7BerthService.js`, czysty; krok w
    `HaloRingGame._portVisuals` przed halami, czas gry `opts.gameDt` — 0 w pauzie i scenach): statek gracza (mieści się na
    stanowisku i ma ≥ `minLength`) stoi na polu `capture` stanowiska capital dowolnej hali K-7 (< 25 j/s, kurs stanowiska
    albo odwrotny ±12°) 2 s → podpięcie (`K7_SERVICE_DOCK`: zamki pola → ramiona SCARA nad wlewy → złączki na wlewy →
    rygle → przepływ); rusza (> 45 j/s albo zjazd z pola z zapasem 80 j.) → AWARYJNE ODPIĘCIE (`K7_SERVICE_RELEASE`:
    przepływ, krótki upust, rygle szybko — buch pary, złączki w górę, ramiona się składają, zamki od razu). Sekwencje są
    wspólne z fabułą, `K7Docking` i automatem portu (`haloPortK7Layout.js`). Tylko obraz i gaz (sterowanie bez zmian), lampki
    stanowiska z automatu (`syncK7BerthLamps`: postój — zarezerwowane, obsługa — zajęte). WŁAŚCICIEL POZY = pole `owner`:
    fabuła pisze `'story'` (`StoryGame._applyHallState`; oddaje na końcu odcumowania i w `_reset`), automat `'auto'` / null;
    poza z innym niepustym właścicielem jest CUDZA — automat jej nie dotyka, a po oddaniu statek musi najpierw zjechać z
    pola (`armed` — po ODDOKUJ przewody nie wracają), niezwinięta poza zwija się. Nowy pisarz póz (dokowanie gracza, ruch
    v2, skrypt) ustawia własny `owner` — inaczej automat zeruje pozę wolnego stanowiska. Strojenie `window.K7ServiceTune`
    (`dwell`, `settleSpeed`, `releaseSpeed` …), testy `tests/k7BerthService.test.mjs`, w grze
    `hala-swiatla-gra.mjs --automat`.
  - OPRZYRZĄDOWANIE (`src/3d/haloRing/haloPortK7Lights.js`, czyste, JEDNO źródło): lampy, reflektory (oprawy na
    ścianach), SOCZEWKI migające (`K7_BEACON`: czerwone przeszkodowe na ościeżnicach, obrotnicach ramion paliwowych i ścianach — wspólny
    takt; zielone / czerwone narożniki stanowisk — przełącza `setBerthLamps`; niebieskie stroboskopy podejścia biegnące
    ku stanowiskom; niebieskie krawędzie dróg kołowania; białe błyski wieży i boi; pomarańczowe koguty zaworów w fazie
    upustu) i harmonogram zaworów. Soczewki to walce K-7 z kodem migania w instancji (`iC.yzw` = rodzaj, faza, okres),
    miganie liczy shader hali (`k7BeaconLevelTSL`) — LUSTRO CPU `k7BeaconLevel` (stałe pilnuje `tests/hallLights.test.mjs`;
    zmiana wzoru = obie strony). Zegar migania `HaloRingGame.clock` (czas ściany, zawinięty) idzie do hali
    (`uHallLights.w`) i wejścia pyłu — soczewka i jej światło w gazie w tej samej fazie. Lampy i reflektory świecą też
    na pokładzie (pętle `k7Lamp` 16 / `k7Spot` 10 w shaderze hali).
  - SIATKA ŚWIATEŁ: krok `lights` pyłu hal dokłada lampy, reflektory i soczewki AKTYWNEJ hali do `Core3D.fx.grid`
    (świat gry w double; poziom lamp dzień / noc z `uHallLights.x`) — oświetlają pył, parę i kadłuby w hali.
  - SNOPY: w warstwie tylnej mgiełka hali widoczna tylko w świetle siatki (rozpraszanie `L1.w` zbierane na trzech
    wysokościach: warstwa, +90, +180 — pionowy promień kamery przez objętość hali), addytywnie, z kolanem; lampy dookólne
    prawie bez rozpraszania (`lampScatter`), więc snopy dają reflektory, koguty i dysze. Strojenie `HallDust.layer.look`
    (`haze`, `hazeKnee`, `hazeGrain`, `vapor*`, `lightKnee`), źródła `HallDustTune.gas`, światła `HallDustTune.lampGain /
    spotGain / beaconGain / hallLights`.
  - Koszt (RTX): hala z gazem, źródłami, światłami i snopami +0,24 ms GPU na klatkę; z aktywnymi źródłami symulacja hali
    przy kamerze nie usypia. Narzędzie: `node scripts/webgpu/hala-swiatla-gra.mjs [--noc] [--kampania | --automat] [--diag]`
    (dok z podpiętymi przewodami, odcumowanie sekwencją fabuły, ciąg w ścianę, cała hala, A/B bez świateł hali i bez
    źródeł, koszt, pipeline'y w klatce — 0; `--kampania`: klik ODDOKUJ; `--automat`: Atlas parkuje na C-01, automat
    podpina, S — odlot i awaryjne odpięcie, zapis klatka po klatce), testy `tests/hallLights.test.mjs`.
