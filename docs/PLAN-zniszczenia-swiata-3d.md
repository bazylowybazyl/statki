# Plan: niszczalny świat 3D i fizyczne bronie (2026-10-04)

Stan: plan przyjęty — decyzje użytkownika w § 8; F0 zrobione i ocenione 2026-10-05 (§ 11); **F1 + F2 (suchy dok piratów
w grze, płasko, bez dymu i wybuchów) wdrożone 2026-10-05 — czekają na ocenę w grze** (§ 11a). Podstawa: przegląd dema `destruktor3d.html`
(silnik `src/game/destructorBeams3D.js`, bronie dema `src/game/beamWeapons3D.js`), kadłubów gry
(`docs/PORT-silnik-belek.md`), świata 3D (baza piratów, stacje, ring, K-7), stoczni Z7 i fizyki skał.

Cele użytkownika: zniszczalne (1) baza piratów, (2) stocznia, (3) ring i jego elementy — miasto, budynki,
(4) dok K-7 („walnę rozpędzonym Atlasem w ścianę — ściana ma pęknąć”), (5) ostrzał bronią ma niszczyć świat 3D,
(6) asteroidy — inna fizyka (kruche, cięcie). Ocena dema: **statek × stacja — dobrze; broń × stacja — źle,
„dzieje się natychmiast”, bez feelu niszczenia**. Pomysł: Hexlance jako wystrzeliwane ciało fizyczne, które niszczy
świat jak statek stację (i na odwrót). Pytanie: co wtedy z resztą broni.

---

## 1. Diagnoza: dlaczego taran działa, a broń nie

Taran to jedyna droga, w której zniszczenie robi **solver przez wiele kroków**: pęd ograniczony granicą
plastyczności zgniotu, nadmiar prędkości gniecie dalej, belki gną się plastycznie i pękają z przeciążenia, odłamy
niosą pęd (`collideBodies`, `_crushNode`, `prepareBeamConstraints`). Każda broń — w demie i w grze — solver omija:

| Droga | Jak powstaje zniszczenie | Czas | Pęd dla celu |
|---|---|---|---|
| Taran (demo, gra) | kontakt → zgniot → belki pękają z przeciążenia → wyspy = wraki | dziesiątki–setki kroków | tak |
| Laser dema | `applyImpact` bez `impulseTime`: węzły przesunięte (teleport pozycji), HP w promieniu, kasowanie węzłów, zerwanie belek w promieniu | 1 krok | nie |
| Rakieta dema | fala 0,22 s jako prędkości węzłów (`impulseTime` 0,12) + HP w promieniu | ~26 kroków | częściowo |
| Gra: działa, wiązki | `HullBodies.impact` = krater (budżet HP / `killRadius`), węzły przesuwane teleportem | 1 krok | nie — trafiony okręt nie dostaje pędu |
| Gra: Hexlance | `cutSegment` kasuje pas 35 j. w każdej klatce lotu, potem sztuczny impuls (masa rzazu × 260 j/s); liczony w pętli RENDERU | klatki lotu | sztuczny |
| Gra: rakiety, flak, fala reaktora | HP w promieniu + jeden krater / jedno uderzenie | 1 krok | nie / sztuczny |
| Świat: baza piratów, stacje | pula HP + udawany rozpad (`Destruction3D`: wygaszenie bryły, odłamki paneli); brak kolizji ze statkami | — | — |
| Świat: ring, K-7 | pociski giną na płycie (`pointInSlab`), przez ściany K-7 przelatują; wiązki i Hexlance przechodzą przez cały ring; taran w ścianę = wypchnięcie i wyzerowanie prędkości | — | — |
| Skały pola | fizyka kruchych skał (`asteroidMining.js`) tylko dla narzędzi kopalni; pociski i kadłuby jej nie dotykają | — | — |

Wniosek: feel taranu bierze się z tego, że **pęd przechodzi przez solver**. Broń ma robić to samo.

## 2. Zasada i miara sukcesu

- **Broń nie kasuje węzłów i nie przesuwa ich pozycji.** Zmienia PRĘDKOŚĆ węzłów (pęd, ciśnienie) albo
  WYTRZYMAŁOŚĆ belek (ciepło). Dziury, pęknięcia i odpadające sekcje robi solver. Wyjątki jawne i małe: rdzeń
  odparowania (Supernowa, reaktor) i ablacja ciepłem (stopniowa).
- **Pęd jest zachowany:** co pocisk oddał konstrukcji, to stracił (zwalnia w materiale, utyka, przechodzi na wylot).
- **Miara** (lekcja z odrzuconego „pancerza”, 2026-09-27 — liczyłem węzły, a cel stał w miejscu): ruch celu
  (Δv, Δω, ugięcie), CZAS narastania zniszczeń (kroki od trafienia do ostatniej zerwanej belki), odłamy z pędem.
  Przebieg pokazany sekwencją klatek, zanim cokolwiek uznamy za gotowe.

## 3. Bronie: trzy kanały fizyki („co z broniami”)

Odpowiedź: **każdy pocisk staje się ciałem fizycznym — różnią się tylko rozdzielczością.** Hexlance to pręt z kilku
węzłów, pocisk działa to ciało jednowęzłowe; wybuch i wiązka to pola, które działają na węzły w czasie.

### 3.1 Pęd — pocisk jest ciałem

- **Pręt** (Hexlance, ciężkie raile, Yamato, korpus torpedy): zwykłe ciało w silniku belek — kilka ciężkich węzłów
  w linii, sztywne belki, wysoki `collisionArmor` (twardszy od blachy, więc gnie się cel, nie pręt). Kontakt z
  konstrukcją idzie **tym samym prawem co taran** (`crushStrength`): pręt wbija się jak dziób Atlasa, oddaje pęd,
  zwalnia, może utknąć, wygiąć się na grodzi, przejść na wylot. Przy 12 000 j/s krok 120 Hz to 100 j. drogi —
  pręt liczy kontakty w podkrokach (CCD); iteruje się po jego kilku węzłach w hashu celu, więc podkroki są tanie.
- **Punkt** (armaty, działka, Vulcan, Gatling, CIWS): „orka” bez belek — odcinek lotu w kroku, węzły na drodze w
  kolejności, z każdym zderzenie niesprężyste (węzeł dostaje prędkość wzdłuż toru i w bok od osi, pocisk traci tyle
  pędu). Węzły rozpędzone do setek–tysięcy j/s rozciągają belki ponad próg — solver je rwie w następnym kroku, okolica
  dostaje część pędu i się wgniata, po drugiej stronie wylatuje odprysk. Rykoszet: z kąta i pędu (hasz pocisku, bez
  `Math.random`), zostaje.
- Obrażenia rozgrywki (pula HP stacji, cele misji) liczone z energii oddanej konstrukcji, nie z promienia.

### 3.2 Ciśnienie — wybuchy

Rakiety, torpedy, Supernowa, pociski HE, flak, rdzeń reaktora. Fala w CZASIE (0,1–0,4 s) jako prędkości węzłów — jest
w demie (`updateBlasts`, `impulseTime`, test „bez natychmiastowego rozdarcia” w `tests/beamWeapons3D.test.mjs`).
Do dodania: front fali biegnie od środka (węzły dostają kopnięcie, gdy front przez nie przechodzi), bez kasowania
węzłów z HP w promieniu, odłamki głowicy jako kilka pocisków punktowych. Później: wybuch w zamkniętym przedziale (grodzie
już wyznaczają przedziały) trzyma ciśnienie dłużej i wypycha ściany na zewnątrz — „puchnięcie” jak w BeamNG.

### 3.3 Ciepło — wiązki, lasery, plazma

Wiązka grzeje węzły (pole `heat` jest w magazynie — dziś tylko do rysowania). Gorący węzeł osłabia swoje belki
(sztywność i próg zerwania × f(T)); konstrukcja pod własnym napięciem siada i rozchodzi się tam, gdzie grzano. Powyżej
progu topnienia węzeł odparowuje (świecąca kropla z małą prędkością, odrzut ablacji). Laser tnie w czasie (sekundy),
nie w klatce.

### 3.4 Broń → kanał

| Broń | Kanał | Rozdzielczość |
|---|---|---|
| Hexlance | pęd | pręt (propozycja użytkownika) |
| Valkyrie, Kolec, Oszczep, Mjolnir (raile z ładowaniem) | pęd | pręt lub punkt; dziś `penDepth` / rów kraterów → zastępuje orka |
| Yamato | pęd + ciśnienie | pręt |
| Armata, ciężkie działka, Goliath | pęd + małe ciśnienie (HE) | punkt |
| Vulcan, Gatling, CIWS, Tempest Ion | pęd | punkt (tani) |
| Helios, lasery wiązkowe, PD laser, plazma | ciepło | pole na węzłach |
| Rakiety (manewrująca, szybka, Rój, Grad, Hydra) | ciśnienie + pęd korpusu | pole + punkt |
| Torpedy | pęd korpusu + ciśnienie | pręt + pole |
| Supernowa | ciśnienie + ciepło | pole, rdzeń odparowania |
| Flak, rdzeń reaktora | ciśnienie | pole |

### 3.5 Hexlance — pręt

- Ładowanie 1,2 s jak dziś, wystrzał z dziobu: pręt ~120–160 j., ~8 węzłów, masa = budżet przebicia (ile materiału
  przeora), 12 000 j/s (do strojenia — wolniej = widać lot).
- **Odrzut:** pęd pręta wraca na Atlasa (dziś `recoil` 0). Pełny byłby ogromny — część jako „kop” w feel, do strojenia.
- **W pętli FIZYKI 120 Hz.** Dziś `updateSuperweapon` i `rocketSystem3D.update` biegną w pętli renderu
  (`frame` ≤ 0,033 s) — limity impulsów zależą od FPS.
- Przeciw okrętom ten sam pręt zamiast `cutSegment` — z A/B wobec dzisiejszego rzazu z pędem (§ 8, decyzja 1).
- Misja 1 („Cicha stocznia”): budynek stoczni to stacja piratów — pręt rozrywa ją fizycznie zamiast zdjąć 6000 HP.

### 3.6 Koszt (szacunki do pomiaru w F0)

Pręty — kilka na sekundę, kontakty po kilku węzłach w podkrokach. Punkty — okno siatki wokół toru (jak dzisiejszy
`sweep`) i kilkanaście węzłów; dziś ostrzał floty z kraterami to ~0,65 ms/krok. Fale i ciepło — węzły w promieniu przez
kilkadziesiąt kroków (jak `updateBlasts`). Solver lokalny liczy tylko obudzony obszar.

---

## 4. Świat: ciała 3D obok płaskich statków

### 4.1 Mieszane ciała w jednym silniku

Statki zostają **płaskie** (bez zmian, złote stany bit w bit). Obiekty świata są **pełnymi ciałami 3D** w tym samym
silniku: `planar` przechodzi z konfiguracji systemu na flagę ciała (kontakty już liczą odstęp z `cellSize` każdego
ciała). Styk statku ze światem leży w paśmie płaszczyzny gry, a odpowiedź świata jest trójwymiarowa: wgniecenie nad i
pod płaszczyzną, pęknięcia, odłamy lecące w 3D. Odłam poza płaszczyzną nie dotyka statków, ale zderza się ze światem
(kawał ściany K-7 spada na zatokę, segment pierścienia stacji uderza w rdzeń).

### 4.2 Zakotwiczone, ale niszczalne

Dziś `static` = nieruchome I niezniszczalne (pomija całkowanie, solver, `applyImpact`, zgniot, rozpady). Potrzebny
tryb `anchored`: ciało jako całość stoi (masa ∞), węzły się gną; **węzły-kotwice** (spawy z resztą świata — płyta
ringu, przypory, fundament) mają masę ∞ w solverze i w zgniocie (rzutowanie PBD już szanuje `invMass = 0` węzła,
zgniot jeszcze nie). Belki do kotwic da się zerwać. Rozpad: wyspa z kotwicą zostaje, reszta to swobodny odłam z pędem
węzłów. Ciała swobodne (baza piratów, stacje, odłamy) mają skończoną masę — taran Atlasa je pcha i obraca.

### 4.3 Leniwe kawałki, bańka wokół gracza, zimne ciała

Świat jest za duży na ciała w całości (hala K-7 10 440 j., obwód ringu 265 tys. j., baza piratów 8 700 j.). Statyczny
render zostaje; budowla = lista kawałków opisanych bryłami CPU. Kawałki w promieniu gracza budują się w tle (szablon raz
na kształt, klon na kawałek, budżet na klatkę jak przejęcia skał) i ŚPIĄ jako ciała — śpiące ciało solvera lokalnego
nic nie kosztuje. Statyczny odpowiednik chowa maska, ciało rysuje skóra. Uszkodzony kawałek po uśpieniu zostaje
„zimny” (stan węzłów i zerwanych belek zapisany), daleki — zwalniany i odtwarzany przy powrocie. Pomysł jak bańka ruchu
v2 i zimne wraki.

### 4.4 Rozdzielczość i materiały

Komórka świata grubsza niż statków (15 j.): ściana K-7 (88 j. grubości) ~22 j. = 4 warstwy, baza piratów
60–150 j. — do pomiaru. Trafienia mniejsze od komórki zostawiają ślad na mapie ran (osmalenie, dziurki), dziurę robi
dopiero suma albo ciężka broń. Materiał per ciało (dziś presety belek są wspólne): blacha statku, stal konstrukcji
(sztywniej, ciężej), beton / regolit (krucho, bez plastyczności), szkło kopuł (kruche odłamki).

---

## 5. Cele

### 5.1 Baza piratów — pierwsza (pilot całej ścieżki)

- Fakty: bryła proceduralna `src/space/pirateStation/pirateStationFactory.js` (105 siatek), ×25 → rdzeń r 1 125 /
  wys. 4 125, pierścień habitatu R 3 375 / rura 450 (przecina płaszczyznę gry), obręcz R 4 350; obwiednia
  8 700 × 8 700 × 7 613. Encja 2D: koło trafień 1 320 (≪ bryła), HP 10 000 + tarcza 9 000; w misji 1 =
  „budynek stoczni” (16 000 HP). Brak kolizji ze statkami.
- Plan: trójkąty fabryki → wokselizacja → ciało 3D (moduły fabryki: rdzeń, pierścień, szprychy, doki, maszt — grupy
  `cargo_dock`, `comms_tower`, `habitat_ring`, `bridge` już są nazwane); skóra FFD na oryginalnych siatkach; trafienia,
  taran i Hexlance przez kanały § 3; kolizja statek–stacja (AI NPC musi ją omijać); HP stacji z konstrukcji (jak sufit
  HP kadłubów) + tarcza jako bramka; finał — rdzeń reaktora stacji, ciśnienie od środka. Kilka stacji naraz.
- Naprawia przy okazji: singleton `attachPirateStation3D` (druga stacja w grze nie ma bryły), rozpad z presetem
  cywilnym, koło trafień ≪ bryła.
- **2026-10-05: budynek misji 1 to już SUCHY DOK PIRATÓW** (szkic użytkownika; AGENTS.md § „Suchy dok piratów”), nie
  stacja: trzon 5,7 km + zamknięty parking z 10 okrętami burta w burtę (cienkie bramy taranowe, ogrodzenie, reflektory)
  + hala jak K-7. Pod tę ścieżkę jest gotowe: 39 kawałków = grup renderu (`layout.chunks` z kotwicami — sąsiedztwo),
  statyczny odpowiednik chowa `hideChunk` (grupa ukryta w shaderze), bryły kawałka z danych sceny
  (`pirateDryDockChunks.js`) → trójkąty (cel „suchy dok” w `destruktor3d.html`, koniec parkingu z bramą G-W ~2,4 tys.
  węzłów) i RZUT Z GÓRY jako sprite płaskiej kratownicy (`dryDockPlanarSolids` → `dryDockTopRaster` →
  `buildSpriteBeamStructure`, cel w `destruktor2d.html`, zakotwiczony — Atlas 800 j/s na torze gnie i rwie cienką bramę,
  trzon i ogrodzenie trzymają kotwice). Bryły trafień w grze (`hitShapes`), progi punktów odrywające kawałki pod
  trafieniem i TARAN BRAM uproszczony (`stepDryDockRam`: prostokąt kadłuba × bryły bram → kawałek wylatuje) — do
  zastąpienia kanałami § 3 i zderzeniem z ciałem bramy.

### 5.2 K-7 — taran w ścianę

- Fakty: ściany 88 j. grubości, z −116…+195; tył 10 440, boki 5 750, skośne 2 458, przód 6 400 (brama 6 180);
  przypory co ~390 j. (54 na halę); bryły w `hall.instances` (CPU, 16 liczb na instancję). Kolizja = SAT tylko dla
  gracza (NPC zderzają się tylko z płytą); taran = wypchnięcie i wyzerowanie prędkości; pociski przez ściany przelatują.
- Plan: kawałek = przęsło między przyporami (~390 × 311 × 88), kotwice = przypory, podłoga, dach. Przęsło w bańce gracza
  jest ciałem; styk przez węzły zamiast SAT (`K7CollisionWorld.off` — dziś ignorowany przez `_walls`). Wolny dolot
  (< ~150 j/s) bez zmian (dokowanie bezpieczne). Strojenie: Atlas 500 j/s (bojowo) — wgniecenie, 1 500 (PRZELOT) —
  pęknięcie, 3 000 (szarża) — przebicie i przęsło wyrwane do środka hali. Zatoki i tunele (720 brył SAT na ring) —
  ten sam mechanizm.

### 5.3 Ring: płyta, miasto, budynki

- Fakty: teren, ściany, dach i kadłub ringu to profil liczony w shaderze (bez obiektów CPU). Budynki i drzewa miasta
  Ziemi powstają w shaderze z map (brak listy CPU; bliźniaki JS są tylko dla dachu i zestawu przemysłowego).
  Megabudowle (9) i kopuły (12) mają plan CPU, ale leżą na z −1 070…−1 630 — celowo poza płaszczyzną. Mars i Jowisz:
  budynki z planu CPU z macierzami (łatwiej). Płaszczyzna gry przecina miasto Ziemi tylko wzdłuż jednej linii.
- Plan: (a) budowle portowe w płaszczyźnie — § 5.2; (b) płyta ringu: na początek niezniszczalna, trafienia zostawiają
  ślady (mapa ran w uv ringu) i odpryski; (c) miasto Ziemi: bliźniak JS reguł shadera dla działek + maska zniszczonych
  działek czytana przez shader + kawałki-ciała budynków w miejscu zniszczenia; (d) Mars / Jowisz z planów CPU.
- Decyzja 2 (§ 8): **miasto później** — (c) i (d) bez terminu; teraz tylko (a) i (b).

### 5.4 Stocznia Z7 (dziś tylko demo)

- Fakty: `buildShipyardScene` — 2 392–2 719 brył (pudła, walce) w tablicach CPU, płaszczyzna gry na y = 116 K-7;
  kotwica: dwa filary 360 × 440 przy ringu; trzon 900 j., pochylnie 1 300 × 1 900, piasta r 1 500, dźwigi w grupach
  ruchomych; `shipyardSolidList` = 20–29 brył SAT; materiał ma już tryb `show` (chowanie części przez clip space).
- Plan: przy wpięciu w ring od razu jako kawałki zakotwiczone, z grup semantycznych układu (galeria, trzon, pochylnie,
  piasta, dźwigi), a nie z dekoracji `scene.sets`.

### 5.5 Asteroidy — inna fizyka

- Fakty: `asteroidMining.js` — siatka komórek (`fill`, `ore`, wiązania, rdzeń), laser `dig`, piła `slice`, ładunek
  `detonate` (Voronoi, kruchość), odłamy jako ciała i okruchy; odłamy zderzają się tylko ze sobą, bez momentu siły.
  Pociski i kadłuby nie dotykają skał (skały pola leżą pod płaszczyzną — decyzja zadania 21); `AsteroidMining.raycast`
  istnieje, nieużywany przez broń.
- Plan: te same trzy kanały, inny materiał: pęd → krater kruchy (strefa zmiażdżenia → żwir, pęknięcia promieniste wg
  kruchości, pęd i obrót bryły), ciśnienie → `detonate` z równoważnikiem ładunku, ciepło → `dig`, Hexlance → `slice`
  wzdłuż toru + rozepchnięcie połówek. Do dorobienia moment siły w zderzeniach i odłamy × kadłuby.
- Decyzja 3 (§ 8): strzał w skałę pod kursorem schodzi do niej; skałę wciągniętą do płaszczyzny (np. holownikami
  wysłanymi przez gracza — mechanika do zaprojektowania, zalążek: wiązka ściągająca `T` kopalni) obsługuje nowa
  warstwa kolizyjna „skały w płaszczyźnie”: skała = ciało skalne w z = 0, zderza się z kadłubami (pęd i obrót obu
  stron, kruche pęknięcie skały z energii styku) i zatrzymuje każdy pocisk przelatujący nad nią. AI omija takie skały.

### 5.6 Okręty (opcja)

Te same kanały na kadłubach statków. Zmienia balans (kratery 25c ustawiał użytkownik), więc najpierw A/B — § 8, decyzja 1.

---

## 6. Render

- **Skóra FFD ciał 3D w TSL.** Demo ma GLSL (`beamShips3D.js` — 4 × `ShaderMaterial`, `beamDebris3D.js`, tekstura 3D
  przesunięć przepisywana z CPU). W grze: przemieszczenia węzłów w buforze storage ze slotem na ciało (zakresy wysyłki —
  three r183 wysyła `Data3DTexture` tylko w całości), `positionNode` = spoczynek + trójliniowe przemieszczenie 8 komórek
  bramkowane żywymi belkami, discard w martwych komórkach, brzegi wyrw i odsłonięte wręgi, ścianki przekroju w dziurach
  (wzór `syncCutWalls`). Graf raz na rodzaj, wartości per ciało (AGENTS.md § „Render: WebGPU + TSL”).
- **Maski statyki:** K-7 — instancja przęsła przeniesiona do grupy „ukryte” (macierz zerowa w pakowaniu `k7Groups`);
  stocznia — `show`; baza piratów — cała bryła na skórze ciała; miasto — maska działek w mapie.
- **Odłamy i efekty:** pula `hullDebris3D` (TSL, 8 192), iskry `SparkSystem3D`, dym z puli rakiet, żar brzegu rany,
  mapa ran (osmalenie). Każdy nowy materiał / obiekt w `Core3D.warmup`. Pozycje względem początku przy kamerze
  (świat 5–10 mln j.).

---

## 7. Etapy

| Etap | Co | Sprawdzenie |
|---|---|---|
| **F0** ✅ | Feel w demie `destruktor3d.html` (gra nietknięta): pręt Hexlance, orka punktowa, front fali, ciepło; przełącznik A/B „stare trafienia ↔ fizyczne”; stacja swobodna i zakotwiczona | sekwencje klatek A/B, Δv/Δω stacji, czas narastania zniszczeń, zachowanie pędu (testy); **ocena użytkownika** — § 11 |
| **G** ✅ demo | Wybuchy i dym: gaz na siatce 3D (compute WebGPU, jak Niagara Fluids) podpięty pod zniszczenia w demie WebGPU destruktora; klej gry gotowy, ale wypięty — w grze silnik zniszczeń bez dymu, ognia i wybuchów (decyzja 2026-10-05) — § 12 | zrzuty `wybuchy-demo.mjs`, `destruktor3d-gaz.mjs`, `dym-gra.mjs --ab`, sondy pól, testy; **ocena użytkownika** |
| **F1** | Silnik: `planar` per ciało, `anchored` + kotwice, materiały per ciało, pręt z podkrokami, API kanałów; Hexlance i rakiety w pętli fizyki | złote stany statków bit w bit, testy kanałów, pomiar |
| **F2** | Baza piratów w grze: ciało 3D z fabryki, skóra TSL, kolizja ze statkami, pręt Hexlance, misja 1, kilka stacji | dym gry, zrzuty, rozgrzewka (0 pipeline'ów synchronicznych), koszt kroku |
| **F3** | K-7: przęsła, taran, pociski w ścianach, NPC i ściany | `ring-kolizje-gra`, zrzuty taranu 500 / 1 500 / 3 000 j/s |
| **F4** | Wszystkie bronie gry na kanałach przeciw światu; A/B na okrętach | bitwa (`profil-bitwy.mjs`), balans |
| **F5** | Asteroidy: strzał w skałę pod kursorem, warstwa „skały w płaszczyźnie” (kolizje z kadłubami i pociskami), wciąganie skał do płaszczyzny, broń → silnik skał | `wydobycie-gra.mjs`, `asteroidy-gra.mjs` |
| **F6** | Stocznia przy jej wpięciu w ring | — |
| **F7** | (odłożone — decyzja 2) Miasto i budowle ringów (bliźniak JS + maska) | parzystość bliźniaka z shaderem |
| **F8** | Gdy zabraknie CPU: fizyka belek na GPU (`dema/destruktor2d-webgpu.html`, wariant a) | `bench-belki-gpu.mjs` |

---

## 8. Decyzje użytkownika (2026-10-04)

1. **Zakres nowej fizyki broni: świat najpierw, okręty po A/B.** Okręty zostają na kraterach 25c, dopóki użytkownik
   nie porówna w demie obu wariantów.
2. **Ring: miasto później.** Na razie budowle portowe w płaszczyźnie (K-7, zatoki, tunele); miasto i budynki ringu
   odłożone (F7 bez terminu).
3. **Asteroidy: oba.** (a) Strzał w skałę pod kursorem schodzi do niej (asteroidy są wyjątkiem od płaskiej walki).
   (b) Skały da się WYCIĄGNĄĆ spod warstwy gry — np. gracz wysyła statki, które wciągają odległą asteroidę do
   płaszczyzny — więc potrzebna jest warstwa kolizyjna „skały w płaszczyźnie”: skała wciągnięta do gry zderza się
   z kadłubami (taran) i łapie każdy strzał jak przeszkoda.
4. **Trwałość: odbudowa po czasie.** Zniszczenia portów i ringu zostają, ekipy odbudowują je poza kadrem po kilku
   minutach (stan „zimnego” kawałka wraca do szablonu).
5. (w F0, na żywo) prędkość pręta Hexlance i siła odrzutu Atlasa.

## 9. Ryzyka i pułapki

- Kasowanie węzłów bez fizyki (odrzucony pancerz, 2026-09-27) — zasada § 2 i testy „żadnego `destroyNode` z broni
  w kroku trafienia”.
- Złote stany statków: każda zmiana silnika za flagą ciała / nową ścieżką; `tests/beam*.test.mjs`.
- Podział zgniotu wg MAS (dzisiejsze prawo) — pręt lżejszy od stacji gniótłby się sam; twardość przez `collisionArmor`
  i materiał, nie przez masę.
- Duże ciała: przebudowa przy rozpadzie i przeszukiwanie wysp — mierzyć na bazie piratów (V8: SoA, pola jawnie, bez
  alokacji w pętlach).
- Nowe kolizje (stacje, ściany K-7) bez omijania przez AI = NPC rozbijające się o stacje.
- Rozgrywka: zniszczalny port domowy (K-7) — misje, dokowanie, ekonomia stacji.

## 10. Znalezione przy przeglądzie (poza tym planem)

- Torpedy, rakiety boczne i armata zapisują `explodeRadius` na pocisku, ale nikt go nie czyta — bez rozprysku
  (torpedy mają w danych 200 / 350).
- `attachPirateStation3D` to singleton (`dettachPirateStation3D` nigdzie niewołane); rozpad stacji piratów z presetem
  cywilnym; koło trafień stacji ≪ bryła (piraci 1 320 vs ~4 350, stacja planety 264 vs ~2 450).
- `K7CollisionWorld.off` ignorowany przez `HaloRingCollider._walls`; NPC nie zderzają się ze ścianami K-7.
- Hexlance i rakiety 3D liczone w pętli renderu, nie fizyki.

---

## 11. F0 — wynik (2026-10-05, gra nietknięta)

### Co powstało
- **Silnik** (`src/game/destructorBeams3D.js`, wszystko za flagą — statki bit w bit, 129 testów belek i złote stany bez
  zmian): ciało `anchored` (stoi, gnie się, pęka; `createBody(…, { anchored: true })`), kotwice `pinBeamNodes(ciało, test)`
  (węzły z `invMass` 0 — solver, zgniot i trafienia ich nie ruszają, belki do nich pękają), rozpad: wyspa z kotwicą zostaje
  zakotwiczona (też osobne zakotwiczone wyspy), bez kotwicy — swobodny wrak z pędem węzłów; ciało, które straci ostatnią
  kotwicę, odpada. Zgniot pary z ciałem zakotwiczonym dzielony PANCERZEM (materiałem), nie masą. Pole węzła `temp`
  (`beamStore3D.js`, przeżywa rozpad i zagęszczenie) dla broni cieplnej. `createCrashBodies(…, { anchored })`.
- **Bronie** (`src/game/beamPhysicalWeapons3D.js`, bez three): `PhysicalWeapons3D` — działo (orka punktowa), rakieta (front
  fali), wiązka (ciepło: przewodzenie, osłabienie belek z presetu typu, ablacja), Hexlance (pręt = ciało silnika z szablonu,
  CCD orką grotu, pairFilter dla szybkiego pręta, wbicie przypięte do WĘZŁA gospodarza — jedzie z odłamem, który go
  zabrał). Tryb `legacy` = dawne trafienia (krater / teleport, fala dema, rzaz gry z kasowaniem pasa, wiązka-kratery) do A/B.
  Niecka maleje z prędkością uderzenia (`dishSpeed`: szybki pocisk wybija korek, wolny wgniata), pręt ma szeroką nieckę
  (`lanceDishSpeed`, `lanceDishRings`) — niszczy „jak taran”. Pęd zachowany (test), żaden węzeł nie ginie w kroku trafienia (test).
- **Demo** `destruktor3d.html`: `1`–`4` broń (działo / rakieta / wiązka / Hexlance) pod LPM, PPM rakiety, `M` — fizyczne ↔
  stare, „Cel”: stacja swobodna / stacja zakotwiczona (kotwice na spodzie) / ściana K-7 (przęsło z kotwicami na obwodzie),
  panel „FIZYKA BRONI (F0)” (masy, prędkości, niecka, odrzut, miękkość grotu, fala, moc wiązki), telemetria: pęd oddany,
  Δv / Δω celu, NARASTANIE ZNISZCZEŃ (od pierwszego trafienia serii do ostatniej zerwanej belki), zerwania od trafienia.
  Obraz (`src/3d/beamPhysicalWeaponsVisual3D.js`, WebGL dema): smugi pocisków, front fali, wiązka, żar węzłów, smuga pręta.
- **Narzędzie** `node scripts/destruktor3d-bronie.mjs [--bronie lance,cannon,rocket,beam,ram] [--cele station,wall,anchored]
  [--tryby fiz,stare] [--statek %] [--v prędkość] [--out katalog]` — klatki od pierwszego trafienia + `raport.json` + arkusze.
  Testy: `tests/beamPhysicalWeapons3D.test.mjs` (9).

### Liczby (1,6 s po pierwszym trafieniu, domyślne strojenie, `raport.json`)

| Cel / broń | Fizyczne: zerwania / odłamy / Δv celu | Stare: zerwania / skasowane węzły / Δv | Przebieg |
|---|---|---|---|
| stacja / Hexlance | 296 / 3 / 12,3 j/s, Δω 0,074 — pręt wbity | 292 / 33 / 0,8 | fiz.: 13 → 104 → 271 → 296 w 0,8 s; stare: wszystko do 0,15 s |
| stacja / działo (seria 0,6 s) | 42 / 0 / 10,6 | 70 / 6 / 0 | fiz. wybija korki i PCHA lekką stację demo |
| stacja / rakieta | 232 / 0 / 2,8, Δω 0,037 | 279 / 32 / 0,07 | fiz.: front 0,16 s, sekcja rozerwana z wręgami |
| stacja / wiązka (1,6 s) | 73 / 7 stopionych | 64 / 6 | fiz.: 0,15 s żar bez zerwań, potem topnienie i krople |
| ściana K-7 / Hexlance | 395 / 2 | 424 / 40 | fiz.: niecka z żarem, wybity kawałek, pręt w otworze |
| ściana K-7 / taran, statek 60% stacji | 200 j/s: 2 353, ściana tylko wgnieciona; **400 j/s: 6 749, wyrwa — 130 węzłów ściany w 16 odłamach** | — | próg prędkości przebicia działa (strojenie w F3) |

Arkusze: `.tmp/zniszczenia-f0/` (poza gitem). Stacja demo waży tylko ~3× myśliwiec, więc fizyczne bronie mocno ją pchają —
w grze cele świata są o rzędy wielkości cięższe albo zakotwiczone (cel „stacja zakotwiczona” pokazuje same rany).

### Ocena użytkownika (2026-10-05)
- **„Jest ten feel, o który chodziło.”**
- **Hexlance: zdecydowanie większa masa** (domyślnie 2400 zamiast 600 — `lanceMass`).
- **Stacje w grze zakotwiczone — koniecznie** (tryb `anchored` + kotwice).
- **W grze obrażenia liczy warstwa 2D** — ciała świata będą PŁASKIE (jak kadłuby statków, `planar`), a bryły 3D (stacja
  piratów, ściany K-7) jadą po ich kratownicy skórą FFD na całej wysokości (wzór „Statki 3D”: `hullSkin3D.js`). To zmienia
  § 4.1 (ciała 3D obok płaskich statków) — F1 = kanały broni i kotwice w trybie płaskim, bez mieszanych ciał 3D.
- **Zniszczenia są „suche” — potrzebne wybuchy i dym**: dym jak Niagara Fluids (symulacja gazu na siatce w compute
  WebGPU) i efektowne wybuchy budowli 3D; iskry trafień w grze już są, wybuchów budowli i dymu nie ma (§ 12).

### Do oceny użytkownika i dalej
- Feel w demie: domyślne strojenie (§ 3) to propozycja — suwaki panelu F0 zmieniają je na żywo; odpowiedzi wpisać tu.
- Decyzja 5 (§ 8): prędkość pręta i odrzut Atlasa — w demie suwaki „Hexlance: prędkość / masa”, „Odrzut strzelca”.
- F1: `planar` per ciało (statki płaskie obok ciał 3D), materiały per ciało, kanały w pętli fizyki gry; demo 2D ze sprite'ami
  (`destruktor2d.html`) jako drugie stanowisko A/B (prawdziwy Atlas w ścianę).

## 11a. F1 + F2 — w grze (2026-10-05; prośba użytkownika: „pełna destrukcja — niszczenie ścian itp., bez dymu, ognia i wybuchów”)

Opis architektury: AGENTS.md § „Ciała świata”. Pliki: `src/game/worldBodies.js` (bańka, budowa ciał, kotwice, wejścia broni),
`src/game/worldChannels.js` (orka, front ciśnienia, ciepło), `src/game/story/pirateDryDockBodies.js` (raster, kotwice,
materiały kawałków doku), `src/3d/worldBodies3D.js` + `src/3d/portBuildings/portBuildingSkin3D.js` + wariant „skin” w
`portBuildings3D.tsl.js` (skóra), wpięcie w `index.html`, `superweapon.js`, `rocketSystem3D.js`, `reactorCoreGame.js`.

Co wyszło przy wdrożeniu (pomiary w Node: `tests/worldBodies.test.mjs`, w grze: `scripts/webgpu/zniszczenia-gra.mjs`):
- **Raster tylko z brył przecinających płaszczyznę (±4 j.)** — pas ±25 dema brał rękawy trapów trzonu (pod płaszczyzną,
  sięgają w tor taranu); Atlas na torze bramy miażdżył je razem z pokładem trzonu.
- **Kotwice w każdej spójnej składowej kratownicy + rzadkie fundamenty (trzon, złącza: co 8 komórek)** — rzut brył rozpada
  się na składowe (w 3D trzymają się budowli poza płaszczyzną); bez tego pas nabrzeża trzonu (196 węzłów) odpadał przy
  pierwszym trafieniu w dowolne miejsce ciała, a chybione pociski wież Atlasa odrywały płyty po 200–300 węzłów.
- **Orka przy prędkości dema** (pociski 150 komórek/s, pręt 118) — pociski gry lecą 150–800 komórek/s; railgun 24 obr.
  niszczył ~19 węzłów trzonu na strzał, armata 150 obr. — żadnego. Masa z obrażeń, pocisk traci ten sam ułamek prędkości.
- **Pancerz pary z ciałem zakotwiczonym = mniejszy** — z pancerzem Atlasa (16) cienka brama zatrzymywała go w miejscu.
- **Skóra = statyka bez różnicy** (A/B na zrzutach): komórka poza slotem pola to NIGDY, nie ZNIKŁA — inaczej kolce,
  balustrady i lampy wystające poza raster znikały; maska liczy udział żywych wśród liczących się rogów.
- **Koszt**: rastry i szablony kratownic na ekranie ładowania (~0,3 s CPU) — budowa 36 ciał w bańce łącznie ~30 ms, krok
  ≤ 6 ms (bez tego 15–45 ms na kawałek); skóra pieczona w tle (`requestIdleCallback`) dla kawałków ≤ 3 km od gracza,
  podział wg rodzaju (bramy co 2 komórki, ściany 4, trzon 6 — co 2 komórki cały dok to ~440 MB geometrii); w grze 0
  pipeline'ów synchronicznych.

Otwarte: ocena feelu w grze (strojenie `WORLD_BODY_TUNE`: masy pocisków, prędkości orki, ciepło wiązek), K-7 (F3), stacje,
ring; rany na skórze z orki (osmalenie w miejscu trafienia — dziś tylko z kraterów `HullBodies.impact`).

**Rozpad na odłamy (2026-10-07, ocena użytkownika po grze: „przy finalnym niszczeniu dach i podłoga odlatują w jednym
kawałku”, „dużo elementów odpada jako duże kawałki, brakuje debris jak u statków”, „dach znika jak w K-7 — w pirackim
nie powinien”, „stare wybuchy do usunięcia”):**
- `worldBodies.breakPiece` = `HullBodies.shatter` z opcjami budowli: rdzeń w odłamki (`hullDebris3D`), **pęknięcia
  Voronoi** (komórki z ziaren w żywych węzłach — odłamy podobnej wielkości z poszarpanym brzegiem; rzazy promieniste i
  cięciwy przez całe ciało dawały długie paski), gruz ze szwów, drobnica < 40 węzłów cała w odłamki (każdy odłam to rysunek
  skóry). Także kawałek statyczny (ciało powstaje na miejscu, ~1 ms) — dawniej odpadał animacją bryły w jednym kawałku.
- **Dach = kawałek-duch**: raster wszystkich brył pasa z góry, komórka 45 j. (przy 15 j. pas dachu to ~22 tys. węzłów),
  ciało tylko w rozpadzie, bez kolizji i broni. Dach nie zanika w grze (`roofFade = 0`); skóra bierze zestaw `roof`.
- **Koszt w łańcuchu (Node, wszystkie 39 kawałków)**: rozpad ~2 ms na kawałek (dach ~2–9 ms), odłamki ~7 tys. (pula 8192,
  życie 8 s); styki odłamów jednego kawałka wyłączone (rodzą się na styk wzdłuż szwów — ~⅓ kroku: 4,1 → 2,8 ms w pierwszej
  sekundzie, potem 0,8 → 0,5 ms). Przed finałem (≤ 3/8 punktów, łańcuch) `setAllLive`: cały dok ciałami w budżecie kroku,
  skóry wypieczone w tle (~8 s) — finał nie piecze w klatce.
- **Render odłamów**: odłam rysował całą geometrię skóry kawałka (odrzut w shaderze) — po łańcuchu 3,35 mln trójkątów;
  podzbiór trójkątów na odłam (indeks na wspólnych atrybutach, budżet 3 ms/klatkę) — 0,47 mln. W grze (`zniszczenia-gra.mjs
  --final`, RTX 5080, 1600 × 900): łańcuch p50 3,1 ms / p95 5,8 ms / max 23 ms, 0 klatek > 33 ms, 0 pipeline'ów
  synchronicznych; ~130 odłamów (23 z dachu).
- Stare wybuchy (`reactorblow.js`) wyłączone — zaczep `window.makeReactorBlow` czeka na wybuchy WebGPU (§ 12, osobna sesja).

---

## 12. Wybuchy i dym — gaz na siatce 3D (2026-10-05; dema, klej gry wypięty)

Prośba użytkownika po ocenie F0: zniszczenia wyglądają „sucho” — dym jak w Niagara Fluids i efektowne wybuchy budowli
z mocy WebGPU (iskry trafień gra już ma, wybuchów budowli i dymu nie). Zrobione jako moduł gotowy pod Core3D, pokazany
w dwóch demach WebGPU.

### Co powstało (`src/3d/gas/`)
- **`gasGrid.js` — symulacja (compute, TSL).** Domeny (przegródki) N³ komórek w jednym atlasie `Storage3DTexture`
  (N × N × N·S, RGBA16F); wątki = N³ · aktywne domeny. Dane w UKŁADZIE KOMÓREK domeny (prędkość w komórkach/s), więc
  przesunięcie początku sceny (float32 przy 5–10 mln j.) to tylko uniform pozycji; domena może jechać z nośnikiem (wrak).
  Krok (domyślnie ≤ 1/60 s, co najmniej jeden na klatkę z ruchem — przy 144 Hz stały krok gubił źródła): wiry → adwekcja
  RK2 prędkości (+ narzucona prędkość źródeł, przeszkody — kule z prędkością, wzmacnianie wirów, wypór, unoszenie od środka
  wybuchu, turbulencja 2 oktawy, opór) i surowa skalarów → REAKCJA: skalary z korekcją MacCormacka (obcięta do 8 sąsiadów),
  źródła-kapsuły z brzegiem i paliwem zaburzonym szumem, SPALANIE (zapłon od temperatury → ciepło, sadza, tempo do
  rozprężania), stygnięcie Newtona szybsze w rzadkim gazie + promieniste T⁴, zanik dymu i paliwa, kulisty poszarpany brzeg
  domeny → dywergencja z celem rozprężania → Jacobi K (nieparzyste, rozgrzane, p = 0 poza domeną — otwarty brzeg) → rzut.
  Raz na klatkę objętość światła: przepuszczalność ku słońcu (samocień) i blask ognia rozproszony w dymie. Sonda
  `probe(renderer, slot)` (profile pól i maksima — strojenie na liczbach, nie na oko).
- **`gasVolume.js` — obraz.** Marsz promienia w połowie rozdzielczości (RTT), obcięty głębią sceny, domeny od najbliższej.
  Emisja wg Kirchhoffa (σ_pochłaniania · B(T) — gorący gęsty kłąb świeci jak ciało czarne, stygnąc ciemnieje w sadzę) +
  czysty płomień frontu spalania; rozpraszanie: słońce z samocieniem × faza Henyeya–Greensteina + wielokrotne (T^¼) +
  otoczenie + blask ognia. Detal poniżej rozdzielczości siatki: przesunięcie odczytu polem wirowym (domain warp,
  „kalafior”) i szum erozji — oba niesione prędkością gazu (mapa przepływu 3D w dwóch fazach). Wygaszenie gęstości tuż
  przed kamerą (kamera w dymie = mgła, nie ściana).
- **`gasExplosions.js` — reżyser (CPU).** `building` (rdzeń + 4–7 kłębów z opóźnieniami → nieregularna kula ognia,
  płonące odłamki ze smugami ognia i dymu — „pająk”, wybuchy wtórne, dogasające ogniska), `blast`, `blaze`, prymitywy
  `puff` / `trail` / `fire`; obraz poza gazem przez haki `onFlash` / `onLight` / `onSparks` / `onShock` / `onDebris`.
- **`gasEmbers.js`** — iskry i żar na GPU porywane polem prędkości gazu (rozmycie ruchu, barwa z temperatury), łby odłamków
  (bez porwania), błyski (gasną, gdy kamera jest w ich zasięgu).
- **`gasSceneFx.js`** — klej dem: światła ognia (stały zestaw PointLight), fala uderzeniowa jako SAMA refrakcja, post
  (scena → gaz → złożenie → bloom jak gra → ACES gry). **`destructionGasFx.js`** — zdarzenia zniszczeń → efekty: działo
  (mały wybuch / iskry w serii), rakieta (wybuch budowli), Hexlance (wybuch wejścia + ognisko w otworze), wiązka (ogień
  i krople metalu), taran (iskry tarcia, pył i dym zgniotu, czasem zapłon), odłam (płonący kawałek — ognisko przypięte do
  węzła wraku, domena jedzie z nim), wybuch reaktora `reactor(ciało)` = kula ognia + `PhysicalWeapons3D.detonate()` (nowe
  API: front ciśnienia przez solver bez pocisku).
- **Renderer ciał belkowych w TSL** (`src/3d/beamShips3D.webgpu.js`, `beamDebris3D.webgpu.js`, `beamHotGlow.webgpu.js`) —
  port demowego GLSL: skóra FFD z JEDNYM grafem na wszystkie części i odłamy (pole, połączenia i mapa — tekstury per
  obiekt), oświetlona światłami sceny (ogień wybuchów oświetla stację).
- **Dema:** `dema/wybuchy-webgpu.html` (stacja z gry, LPM — wybuch pod kursorem, 1–5 rodzaje, P — pokaz, suwaki fizyki
  i obrazu) i `destruktor3d-webgpu.html` — generowany z `destruktor3d.html` (`python scripts/destruktor3d-webgpu-gen.py`;
  oryginał WebGL bez zmian), wszystko jak w F0 + wybuchy i dym, `J` — wybuch reaktora celu, `G` — gaz A/B.
- **Narzędzia:** `node scripts/webgpu/wybuchy-demo.mjs [--sceny …] [--klatki …] [--perf] [--look k=v] [--tune k=v]`,
  `node scripts/webgpu/destruktor3d-gaz.mjs [--proby lance,rocket,cannon,beam,ram,reactor] [--cel …] [--oko x,y,z]`.
  Testy: `tests/gasGrid.test.mjs` (8: domeny, pakowanie do komórek niezależne od położenia świata, lista kerneli, cykl
  życia, reżyser, WGSL kerneli i obrazu w Node).

### Koszt (RTX 5080, 1280 × 720, pomiar z synchronizacją kolejki — znaczniki czasu headless są kwantowane)
- Symulacja: ~0,7 ms na domenę 64³ (4 domeny — 2,9 ms na klatkę). Obraz: ~0,6 ms (marsz w ½ rozdzielczości).
- Pamięć: 11 × N³ · S × 8 B (64³ × 6 domen = 138 MB; z polem pozycji spoczynkowych).

### Lekcje strojenia (sondy pól + A/B na zrzutach)
- **Rozprężanie** 0,5 na jednostkę spalonego paliwa (∫ ≈ 1,5 → spaliny ~5× objętości). 9 mieszało całą domenę w 0,3 s,
  1,4 wypełniało ją sześcianem ognia.
- **Moc ognia ∝ T² z progiem**, nie T⁴ (T⁴ gasiło pomarańczową kulę, zostawał biały rdzeń); barwy ciała czarnego
  nasycone w liniowym — ACES i sRGB wyciągają zieleń jasnej pomarańczy w pastel.
- **Kirchhoff** (emisja ∝ σ pochłaniania): bez tego gęsta sadza zasłaniała ogień — blada, różowa wata.
- **MacCormack + domain warp** = ostre kłęby; sama adwekcja semi-Lagrange'a rozmywa detal w gładkie kule.
- **IGN jako przesunięcie startu marszu dawał regularny wzór „wafla”** (A/B: wzór zostawał bez detalu i bez warpu) —
  biały szum z haszu + rozmycie 4 próbek przy powiększaniu.
- **Szybkie źródło** (płonący odłamek) mija komórkę w ułamku kroku — tempa paliwa i dymu ~3× wyższe niż kul ognia.
- **Domena**: kulisty brzeg z szumem (nasycona domena nie zdradza sześcianu); front kuli ognia hamuje (opór 0,9, wyrzut
  3,8 R/s) — przy 6 R/s kula w 0,5 s dobijała do brzegu domeny i robiła się z niej gładka „gwiazda”.
- **Dym „szedł i cofał się” (zgłoszenie użytkownika po pierwszej wersji):** detal i przesunięcie odczytu były przesuwane
  prędkością gazu w DWÓCH FAZACH mapy przepływu (okres 0,7 s) — każda faza wracała do startu, więc kłęby jechały i cofały
  się w kółko; na pojedynczych klatkach niewidoczne. Pomiar (`wybuchy-demo.mjs --ruch`, środek krycia gazu z odczytu RTT
  co 1/30 s): 9 zawrotek na 3 s i droga 4,5× większa od przesunięcia; przy zamrożonej symulacji obraz ruszał się sam.
  Naprawa: symulacja niesie POLE POZYCJI SPOCZYNKOWYCH (`rest`, adwekcja jak skalary, powrót do tożsamości 0,05/s), obraz
  czyta detal z niego — energia drgań 5× mniejsza, zamrożona symulacja = obraz nieruchomy. Każda zmiana detalu → `--ruch`.
- **Dym ma się rozejść i zniknąć** (użytkownik): zanik 0,16/s (połowa po ~4 s; było 0,045 — wisiał gęsty ponad 15 s)
  i powolne rozprężanie zimnego dymu w próżni (`disperse` w dywergencji) — obłok rośnie, rzednie i znika.

### Klej gry dla dymu i ognia — gotowy, WYPIĘTY (2026-10-05)
Prośbę „wdroż do gry, ale na razie bez wybuchów” odczytałem najpierw jako „dym i ogień bez kul ognia” i wpiąłem gaz do
gry. Użytkownik sprostował: chodziło o **silnik zniszczeń w grze (niszczenie ścian itd.) BEZ dymu, ognia i wybuchów**.
Gaz jest więc wypięty z `index.html` (import, `createGasSmokeGame`, haki śmierci okrętu, rdzenia i stacji); klej niżej
czeka na dopracowane wybuchy — wtedy wraca razem z nimi. Opis kleju (stan z chwili wypięcia):
- **`src/3d/gas/gasSmokeGame.js`** (`createGasSmokeGame(Core3D)` w index.html, `window.GasSmoke`): krok
  `Core3D.addFxStep` „dym (gaz 3D)” (update: początek sceny → domeny, ogniska za encjami, reżyser, `grid.simulate`, bryły;
  lights: ogniska w siatce świateł; warm: puste dispatche + pipeline'y brył w passie ortho). Zegar `SimClock.sim` (pauza =
  dym stoi). Płaskie domeny 48 × 48 × 24 (`GasGrid` z `NZ` — gra z góry; wątki = N²·NZ), 4 naraz, priorytet stacja >
  okręt > kurz, dokładanie do żywej domeny o podobnym nośniku. Bez wyporu (kosmos z góry), zanik 0,16/s.
- **Obraz w passie ortho** (`GasVolume.createMeshes`): pudło domeny (instancja) liczy promień z przestrzeni widoku,
  płaszczyzna gry dzieli marsz na dwie warstwy — część za nią rysuje się PRZED kadłubami (kolejka nieprzezroczysta,
  kadłub ją zasłania), część przed nią PO kadłubach z gęstością × `look.frontDensity` (gra 0,35). Pozycje względem
  `Core3D.fx.origin`, człon słońca × maska cienia słońca, `rulonBend = false`.
- **Zdarzenia z warstwy 2D:** `shipWrecked(npc, wrak)` — śmierć z puli HP (`applyDamageToNPC`, bez myśliwców),
  `shipDetonated(ev, res, host)` — detonacja rdzenia (`ReactorGame`, nowy hak `env.onDetonate`), `stationDestroyed` /
  `stationHit` — zniszczenie stacji / oderwany fragment (`Destruction3D.detachChunk`), kurz taranu z `CollisionFX`
  `impact` (od 120 j/s zbliżenia, nośnik = prędkość styku). Ogniska: na kadłubie wzdłuż osi okrętu albo na rdzeniu
  stacji, jadą z encją (pozycja i obrót), płomień bije NA ZEWNĄTRZ w płaszczyźnie gry (z góry jęzor obok kadłuba, nie
  słup na kamerę), gasną ze zniknięciem wraku. Płomień ≥ ~1,6 komórki domeny (mniejszy był świecącą kulką).
- **A/B w grze (`dym-gra.mjs --ab` — ten sam kadr bez dymu):** gęstość dema i obłok w płaszczyźnie chowały wrak w całości,
  a obłok stacji zakrywał planetę za nią → obłok kłębi się POD płaszczyzną (środki kłębów i domeny −0,3 R; kadłub na
  wierzchu, nad nim strzępy), gęstość 0,4 i przód × 0,35. Stacja Wenus ma ramiona do ~2200 j. (rdzeń ~830 j.), a rozpad
  zabiera je w pierwszej klatce — ogniska na obwodzie całej bryły wisiały w pustce; teraz na rdzeniu (≤ 0,45 R), obłok
  na miarę całej bryły.
- Wyłącznik: `Core3D.perfToggles.gasSmoke = false`; strojenie `GAS_SMOKE_TUNE` (próg kurzu, czasy ognisk, mnożnik dymu
  okrętów, światło), obraz `GasSmoke.volume.look`, fizyka `GasSmoke.grid.tune`.
- Testy: `tests/gasGrid.test.mjs` (9 — m.in. płaska domena: atlas, wątki, pakowanie, bryły i ich WGSL),
  `tests/gasSmokeGame.test.mjs` (4 — atrapa Core3D: obłok pod płaszczyzną z nośnikiem wraku, ogniska jadą z wrakiem,
  zabranie domeny gasi jej ogniska — pokolenie domeny i tożsamość emitera z puli, kurz od progu, pauza, wyłącznik);
  prawdziwa gra: `node scripts/webgpu/dym-gra.mjs [--przypadki wrak,reaktor,stacja,kurz] [--klatki …] [--ab] [--mgla]
  [--3d] [--diag]` (`--diag` — siatki bryły stacji i kadr przed zniszczeniem).

### Wybuchy w grze (2026-10-07) — `src/3d/explosions/`
Użytkownik o starych wybuchach (`src/effects3d/reactorblow.js`, port overlaya WebGL): „tragiczne, do usunięcia”; o gazie z dema:
„wybuchy WebGPU z zaawansowanymi efektami — mamy zalążek w demie z dymem, ale niedopracowane”, a w trakcie prac: „gaz się
nie rozchodzi, zawisa w miejscu, jest rozmyty, nie wychodzi bezpośrednio z miejsc wybuchu — rozwalamy rury, to z rur
powinien lecieć gaz”. Stary moduł usunięty (z `reactorblow.tsl.js`, `particlePool.js`, `reactorProfiles/`), w jego miejsce
reżyser `ExplosionFx` (krok `Core3D.addFxStep` „wybuchy”, fabryka `window.makeReactorBlow`) — opis w AGENTS.md § „Wybuchy WebGPU”.
- **Co w module gazu:** `GasExplosions.jet` (strumień: kapsuła od otworu, narzucona prędkość wzdłuż kierunku, rozchylenie,
  narastanie i wygaszanie), opór zależny od prędkości (`dragQuad`), emisja całkowana po odcinku marszu (`gasVolume.js`),
  ciągły próg pomijania próbek, spłaszczony wyrzut żaru i rozrzut startu (`gasEmbers.burst(…, flat, r0)`, `fadeIn`), błyski
  w tablicach typowanych z wyglądem do strojenia (`GasFlashes.look`), `fire(…, { keep })`, domyślny `rng` = fxRandom.
- **Lekcje (A/B na zrzutach demo i gry):**
  - Wielka tarcza w pierwszych 0,05–0,2 s to NIE błysk ani gaz, tylko ~1600 iskier żaru startujących w jednym punkcie
    (bloom sumy) — żar startuje w całej kuli ognia i narasta 0,12 s, jest go ~3× mniej.
  - „Słoje” i „ziarno” w ogniu: kamera z góry, wszystkie promienie próbkują te same płaszczyzny z, a front ognia jest
    cieńszy niż krok — bez przesunięcia startu marszu poziomice, z nim piasek. Lek: średnia emisji na odcinku (temperatura
    liniowo, 4 podpróbki, bez nowych odczytów tekstur). Drugie źródło słojów i marmuru: detal czytany z pola pozycji
    spoczynkowych rozciągniętego rozprężaniem wybuchu (przy powrocie 0,05/s) — `restRelax` 1,5/s, mocniejsze wiry
    (`vorticity` 3,5); bez warpu detal znika i gaz jest rozmyty (siatka ~15–20 px na komórkę przy bliskim zoomie).
  - „Wisi w miejscu”: stały opór 0,9/s zatrzymywał wolny dym (wykładniczo). Opór = 0,2 + 0,03·|v| [1/s, v w komórkach/s]:
    front i strumienie hamują, obłok dalej odpływa i rzednie; strumienie gazu z punktu wybuchu robią kierunek.
  - Domena płaska 96 × 96 × 36 (bok 5,4 R kuli ognia): 64 × 64 × 32 było wyraźnie bardziej rozmyte, a koszt i tak mały.
  - Znikanie obłoku: decyduje koniec życia DOMENY (`until`, potem wygaszanie 1,6 s z dodatkowym zanikiem), nie sam
    `smokeDecay` — `fire(…, { keep: 2,5 })` dogasających ognisk trzymał domenę do ~5 s, a obłok do ~6,7 s. Dziś
    `domainLife` 3 s + `keep` 1 s: gęsty dym do ~3 s, rzednie, do ~4,5 s znika (zrzuty `wybuchy-gra.mjs`, kadry 2,8 / 3,6 / 4,5 s).
  - Dach i maszty doku są w passie FG (po ortho) — przednia część gazu, żar i błyski muszą iść do FG, inaczej dach chowa
    wybuch nad nim.
  - Harness gry: przełączenie zegara wirtualnego z `real` na `frozen` bez `clock.t = realNow()` cofało czas o kilka minut
    — akumulator fizyki ujemny, łańcuch misji i zegar wybuchów stały (wyglądało jak „wybuch poza kadrem”).
- **Koszt** (RTX 5080, 1600 × 900, łańcuch doku: 13 wybuchów w 3,4 s + wtórne, 6 domen): klatka śr. 2,64 → 3,5 ms (+0,85 ms,
  p95 +0,9 ms; same cząstki +0,65 ms), CPU kroku śr. 0,07–0,09 ms, skoki do ~1,3 ms (pojedyncze wywołanie fabryki do ~3 ms —
  pierwsze wywołanie / GC); pomiar przy innych sesjach na tej samej maszynie — powtarzać. 0 pipeline'ów synchronicznych
  w klatkach wybuchów (próg, łańcuch, stacja, pustka). Pamięć atlasu: 11 tekstur × 96² · 36 · 6 × 8 B ≈ 175 MB.
- **Narzędzia:** demo `dema/wybuchy-webgpu.html` (Core3D), `node scripts/webgpu/wybuchy-demo.mjs [--przypadki …]
  [--look k=v] [--gaz k=v] [--ab warstwa] [--koszt]`, gra `node scripts/webgpu/wybuchy-gra.mjs [--sceny prog,lancuch,
  stacja,pustka] [--ab warstwa] [--koszt]`, testy `tests/explosions.test.mjs`.

### Dalej
- **Ocena wybuchów przez użytkownika** (zrzuty z gry i dema, 2026-10-07) — w tym fala z refrakcją: dawna decyzja
  (2026-09-24) „falę ma tylko supernowa” vs rakiety gry, które falę mają przy każdym wybuchu; dziś wybuchy mają subtelną
  falę (przełącznik `EXPLOSION_TUNE.shock`).
- Dym z luf armat na gazie (prośba użytkownika, „temat poboczny”), pył od silników w halach K-7 (`src/3d/gasField/`, osobny etap).
- Budowle (shader `portBuildings3D`) nie czytają siatki świateł — wybuch oświetla kadłuby obok, ale nie bryły doku.
- Dym i ogniska wraków (`gasSmokeGame.js`) dalej wypięte — decyzja użytkownika.
- Zdarzenia: kratery broni (`HullBodies.onImpact` — dym z dziury), odłamy (`onWreck` — płonące kawałki).
