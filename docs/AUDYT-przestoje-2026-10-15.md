# Audyt przestojów klatek (2026-10-15)

Zadanie: „optymalizacja wydajności” — największe przestoje klatek i koszt klatki w typowych scenach, bez zmiany
rozgrywki. Tropy z pomiarów sesji „Trafienia brył 3D”: wypiek skór kawałków budowli w klatce, `Bridge3D.update`
102 ms w jednej klatce rozpadu habitatu, klatki 90–150 ms przy Supernowej, fizyka szyi habitatu, fronty fal na ciałach
płaskich, duże bitwy.

## 1. Odpowiedź w skrócie

1. **Największy przestój — wypiek skóry kawałka budowli W KLATCE** (40–220 ms na kawałek, w rozpadzie habitatu po
   kilka–kilkanaście takich klatek; także przy progach punktów, przy Mjolnirze i Supernowej w bazę). Wypiek przeszedł do
   workera i NIGDY nie idzie w klatce; do czasu skóry rysuje się statyka (kawałek stracony — statyka trzymana do skóry
   odłamów). Skóra ma indeks (2,2× mniej pamięci i wysyłki na GPU), rdzeń wypieku jest 1,7× szybszy, a trójkąty i
   atrybuty — bit w bit jak dawniej. Wynik (mediana z 2 przebiegów, A/B w tym samym drzewie): rozpad habitatu —
   najdłuższa klatka 218–326 → 93 ms, klatek > 100 ms 5–6 → 0, > 50 ms 20–30 → 12–18; wieża po osiadaniu 85–225 → 15–23
   ms; Supernowa nad dyskiem 90–129 → 43–53 ms; Mjolnir w leżącą wieżę 29–72 → 23–31 ms; przechył wieży: klatek
   > 50 ms 9–24 → 1–4.
2. **`Bridge3D.update` 102 ms** — artefakt profilera (przerwa w próbkowaniu przypisana ostatniej funkcji), nie praca
   mostków; w pomiarach ≤ 3 ms w rozpadzie.
3. **GPU nie jest wąskim gardłem** w żadnej z tych scen (≤ 3,5 ms na klatkę przy Supernowej i rozpadzie, RTX 5080).
4. **Fizyka szyi i rozpadu** zostaje głównym kosztem po naprawie (klatki 40–70 ms: 2–4 kroki fizyki × 10–14 ms). Bez
   zmiany wyniku: kandydaci styku z siatki węzłów dużego ciała (bryła 3D w parze mieszanej) — kolizje szyi −15–20%
   w fazie uderzenia, −60% po osiadaniu; front fali na ciele płaskim tylko po pierścieniu frontu (30 wybuchów:
   0,55 → 0,36 ms na krok). Ślady `destrukcja-taran-sym.mjs` identyczne. Dalej — do decyzji (§ 6).
5. **Duża bitwa**: bez regresji; skok na STARCIE bitwy (do 110–140 ms) to koszt pierwszego okrętu każdego nowego typu
   kadłuba (tekstura, lakier, mapa powierzchni, cień SDF) — do decyzji (§ 6).

## 2. Metoda

- Prawdziwa gra: Vite + headless Chrome z WebGPU (RTX 5080, D3D12), 1600 × 900, bez limitu klatek, przez CDP.
  Pomiary tylko przy ciszy innych sesji (START / KONIEC do sesji nadrzędnej).
- **`scripts/webgpu/przestoje-gra.mjs`** (nowe) — rejestr KAŻDEJ klatki: odstęp rAF (start następnej klatki − start
  tej), CPU wszystkich wywołań rAF klatki, próbki zegara GPU (`Core3D.gpuFrameMs`, znaczniki co klatkę w oknie), czasy
  opakowanych podsystemów (`HullBodies.step`, `WorldBodies.step`, `Bridge3D.update`, `Core3D.renderSingle`), najdłuższy
  krok wypieku skór w wątku głównym, długie zadania (`longtask`), pipeline'y synchroniczne. Sceny:
  - `final` — misja 1 (`?story=shipyard`): Atlas 4,5 km od habitatu; okna „spokój”, „progi” (punkty habitatu do 36%
    jednym ciosem — progi łamią kawałki), „rozpad” (śmierć habitatu: implozja, reakcja w rurach), „po”;
  - `szyja` — szarża F + W w szyb habitatu (zerwanie szyi, przechył i uderzenie wieży 3D), potem ostrzał leżącej wieży
    (Yamato, Mjolnir) i Supernowa nad dyskiem;
  - `bitwa` — gra swobodna, 30 / 12 / 6 / 2 okrętów na stronę (piraci kontra Terra Nova), okna „start” (15 s od
    pojawienia się flot) i „bitwa”.
  `--profil 1` — profil CPU każdego okna i rozbicie najdłuższych klatek na funkcje; `--diag 1` — metody `Bridge3D`
  w klatkach > 4 ms.
- **A/B w tym samym drzewie** (obok niezacommitowanej pracy innych sesji): `vite.config.js` — zmienna
  `HULLFALL_AB_DIR=<katalog>` podmienia pliki drzewa plikami z katalogu (te same ścieżki względne); `przestoje-gra.mjs
  --ab <katalog oryginałów> --przebiegi n` puszcza na przemian A (oryginały plików zmienionych w optymalizacji) i B
  (drzewo robocze) w kolejności ABBA, tabela = mediany przebiegów wariantu.
- Fizyka bez przeglądarki: `scripts/destrukcja-taran-sym.mjs` (tryby domyślne i `--tryb szyja --pary 1`) — ślad (stan
  ciał, węzły, kontakty, położenia) przed / po bez pól czasu ma być IDENTYCZNY; profile CPU symulacji (`node
  --cpu-prof`) z oknem najcięższej fazy.

## 3. Poprawki (bez zmiany rozgrywki)

1. **Wypiek skóry kawałka budowli nigdy w klatce** (`src/3d/worldBodies3D.js`, `src/3d/portBuildings/portBuildingSkin3D.js`,
   nowe `portBuildingSkinBake.js` i `portBuildingSkinWorker.js`). Dawniej kawałek ruszony (próg punktów, rozpad, taran),
   którego skóra nie zdążyła się upiec w tle (z wyprzedzeniem tylko ≤ 3 km od gracza), piekł się W KLATCE pierwszego
   dotknięcia: 40–210 ms na kawałek, w rozpadzie habitatu po kilka–kilkanaście takich klatek. Teraz:
   - rdzeń wypieku bez three (ten sam kod w wątku głównym i w workerze), pula 2 workerów; zadanie kawałka ruszonego jest
     PILNE (przed wypiekami z wyprzedzeniem), wynik przychodzi zwykle po 10–90 ms;
   - do wyniku kawałek ruszony na miejscu rysuje statyka (jak przed wypiekiem w tle), a kawałek STRACONY (rozpadł się,
     odłamy czekają na skórę) ma statykę TRZYMANĄ na miejscu (`setHold` dostawcy miejsca → `PirateBase3D.setChunkHold`,
     najwyżej 1,5 s) — odłamy pojawiają się w klatce, w której znika statyka (bez „mrugnięcia” pustym miejscem); stan gry
     kawałka (`isChunkGone`, światła masztów, przeszkody gazu, bryły trafień) bez zmian;
   - bez workerów (Node, testy) — kroki w wątku głównym: pilne w budżecie 6 ms/klatkę, reszta w `requestIdleCallback`.
2. **Skóra z indeksem** — wierzchołek puli wspólny dla trójkątów podziału (dawniej każdy trójkąt miał własne 3 kopie
   wierzchołków): cała baza piratów 389 → 176 MB atrybutów, pomost NP 69 → 28 MB wysyłanych na GPU w klatce pojawienia
   się skóry; rdzeń 1,7× szybszy (Node, cała baza 982 → 593 ms). Trójkąty i atrybuty ich wierzchołków bit w bit jak
   dawny wypiek (`tests/portBuildingSkinBake.test.mjs` — wzorzec dawnego kodu `tests/helpers/portBuildingSkinReference.mjs`,
   kawałki płaskie i bryła 3D), sfera ograniczająca tym samym algorytmem co `computeBoundingSphere` three (dawniej
   `computeBoundingSphere` sam kosztował do 19 ms w klatce).
3. **Podzbiory trójkątów odłamów w krokach** (`fragmentSkinSubsetSteps`, 8192 trójkąty na krok, budżet 3 ms/klatkę) —
   dawniej jedno wywołanie dla dużego kawałka trwało ~6 ms niezależnie od budżetu.
4. **Macierz budowli raz na klatkę** w `syncWorldBodies3D` — dawniej `updateMatrixWorld` całego drzewa budowli dla
   KAŻDEGO odłamu (rozpad: setki odłamów, ~118 ms na 11 s okna).
5. **Kandydaci styku z siatki węzłów dużego ciała iterowanego** (`src/game/destructorBeams3D.js`,
   `_contactCandidatesGrid`): bryła 3D w parze mieszanej jest iterowana ZAWSZE (wieża habitatu 13 tys. węzłów skanowana
   raz na każdą parę z ciałem płaskim — 27% czasu najcięższej fazy szyi); przy ciele ≥ 2048 węzłów i obszarze
   o mniej niż ¼ tylu kubełkach — kubełki siatki tego ciała (ta sama `_refreshHash`), test obszaru jak w skanie,
   sortowanie do kolejności skanu. Zbiór i kolejność kandydatów jak skan (testy `tests/beamNarrowphase.test.mjs`:
   80 losowych układów + pary mieszane), ślady `destrukcja-taran-sym.mjs` (tryby domyślne i szyja) identyczne.
6. **Front fali na ciele płaskim tylko po pierścieniu frontu** (`src/game/worldChannels.js`, `_blastBody`): komórki,
   których węzeł na pewno leży wewnątrz poprzedniego promienia (odchylenie od środka komórki ≤ √2 · (`_maxDisp` +
   1,5 komórki)), są pomijane — test odległości i tak by je odrzucił. Kopnięcia, ciepło, aktywacja węzłów i obrót bit
   w bit jak pełne koło (`tests/worldBlastRing.test.mjs`, wzorzec `tests/helpers/worldBlastReference.mjs`; test wykrywa
   różnicę przy celowo zaniżonym `_maxDisp`). 30 wybuchów R 2 km na ciele 4,6 tys. węzłów: 0,55 → 0,36 ms na krok.

## 4. Wyniki A/B

Mediana z 2 przebiegów na wariant (ABBA; dla 2 przebiegów — mniejsza wartość), 1600 × 900; „przed” = pliki sprzed
optymalizacji podmienione przez `HULLFALL_AB_DIR`, „po” = drzewo robocze (bez pierścienia frontu fali — ten dołożony
po pomiarze, zmierzony w Node). dt — odstęp rAF klatki [ms], CPU — wszystkie wywołania rAF klatki, wypiek — najdłuższy
krok wypieku skóry w wątku głównym w klatce.

| okno | wariant | klatki | dt p50 | dt p95 | dt p99 | dt max | > 33 ms | > 50 ms | > 100 ms | CPU max | fizyka max | wypiek max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| finał: spokój | przed | 1068 | 2,5 | 3,5 | 4,2 | 13,2 | 0 | 0 | 0 | 4,6 | 0,4 | 10,3 |
| | po | 1090 | 2,6 | 3,4 | 4,0 | 4,8 | 0 | 0 | 0 | 4,2 | 0,3 | 0 |
| finał: progi (habitat do 36%) | przed | 1333 | 3,4 | 6,9 | 10,9 | 121,6 | 2 | 2 | 1 | 95 | 26,8 | 33 |
| | po | 1440 | 3,7 | 5,9 | 8,1 | 91,3 | 2 | 1 | 0 | 66,3 | 15,3 | 0 |
| finał: rozpad habitatu (10 s) | przed | 858 | 6,7 | 46,5 | 77,8 | 218,4 | 61 | 20 | 5 | 231,7 | 56,1 | 159,4 |
| | po | 1097 | 6,3 | 31,7 | 61,9 | 92,7 | 53 | 12 | 0 | 66,8 | 46,7 | 0 |
| finał: po rozpadzie | przed | 725 | 5,1 | 7,5 | 9,0 | 16,4 | 0 | 0 | 0 | 15,5 | 2,4 | 0 |
| | po | 796 | 4,7 | 6,9 | 8,1 | 17,0 | 0 | 0 | 0 | 9,1 | 1,2 | 0 |
| szyja: szarża | przed | 232 | 4,3 | 15,6 | 36,6 | 59,4 | 3 | 2 | 0 | 60,1 | 10,6 | 36,5 |
| | po | 253 | 4,2 | 12,9 | 23,0 | 28,5 | 0 | 0 | 0 | 26,2 | 8,0 | 0 |
| szyja: przechył i uderzenie | przed | 965 | 4,5 | 31,4 | 47,1 | 92,9 | 47 | 9 | 0 | 76,2 | 44,3 | 33,8 |
| | po | 1478 | 3,9 | 26,5 | 45,8 | 62,5 | 22 | 1 | 0 | 49,7 | 39,6 | 0 |
| szyja: wieża leży | przed | 783 | 4,1 | 7,7 | 10,2 | 84,9 | 1 | 1 | 0 | 12,2 | 5,8 | 78,8 |
| | po | 1036 | 3,7 | 6,1 | 8,8 | 15,3 | 0 | 0 | 0 | 14,3 | 8,3 | 0 |
| ostrzał wieży: Yamato | przed | 859 | 4,8 | 10,2 | 16,4 | 30,5 | 0 | 0 | 0 | 24,9 | 10,4 | 0 |
| | po | 980 | 4,7 | 8,8 | 14,7 | 25,6 | 0 | 0 | 0 | 22,7 | 9,7 | 0 |
| ostrzał wieży: Mjolnir | przed | 410 | 5,3 | 12,4 | 16,8 | 29,1 | 0 | 0 | 0 | 48,1 | 12,4 | 0 |
| | po | 783 | 5,0 | 10,8 | 17,6 | 22,8 | 0 | 0 | 0 | 21,9 | 11,8 | 0 |
| Supernowa nad dyskiem | przed | 865 | 6,8 | 13,8 | 31,0 | 89,8 | 6 | 3 | 0 | 94,8 | 7,2 | 53,6 |
| | po | 949 | 5,9 | 12,6 | 22,0 | 43,1 | 3 | 0 | 0 | 35,3 | 4,8 | 0 |
| bitwa 2 × 50: spokój | przed | 1672 | 2,3 | 2,8 | 3,2 | 4,1 | 0 | 0 | 0 | 3,5 | 0,1 | 0 |
| | po | 1688 | 2,3 | 2,7 | 3,1 | 3,8 | 0 | 0 | 0 | 3,0 | 0 | 0 |
| bitwa: start (15 s) | przed | 1926 | 6,4 | 11,8 | 22,2 | 109,1 | 12 | 8 | 3 | 110,2 | 4,0 | 0 |
| | po | 2068 | 5,9 | 10,8 | 16,9 | 108,8 | 12 | 8 | 3 | 105,4 | 3,2 | 0 |
| bitwa (15–30 s) | przed | 1838 | 7,4 | 11,7 | 14,5 | 24,3 | 0 | 0 | 0 | 25,9 | 1,0 | 0 |
| | po | 1705 | 7,3 | 13,0 | 15,3 | 27,8 | 0 | 0 | 0 | 23,5 | 1,5 | 0 |

Przebiegi osobno (dt max / klatek > 50 ms / > 100 ms; kolejność A B B A): rozpad habitatu 326/30/6, 93/18/0, 93/12/0,
218/20/5; wieża leży 225/1/1, 15/0/0, 23/0/0, 85/1/0; Supernowa 90/4/0, 53/1/0, 43/0/0, 129/3/3; przechył 93/24/0,
63/4/0, 63/1/0, 93/9/0; szarża 59/2/0, 29/0/0, 53/1/0, 63/2/0; Mjolnir 72/2/0, 23/0/0, 31/0/0, 29/0/0; progi 125/2/1,
91/1/0, 94/1/0, 122/2/1. W przebiegu 4 (A) przez ~15 s działała równolegle symulacja Node (ta sama maszyna) — A wypada
gorzej także w przebiegu 1, bez niej. Czas GPU klatki (znaczniki co klatkę) we wszystkich oknach obu wariantów ≤ 3,5 ms;
pipeline'y synchroniczne — 0 w każdym przebiegu (także skóra z indeksem), błędy konsoli — tylko brak `favicon.ico`.
Bitwa (dt max start / bitwa, A B B A): 109/36, 109/28, 125/30, 140/24 — różnice w granicach rozrzutu przebiegów
(fizyka p95 0,4–0,7 ms w obu).

Fizyka bez przeglądarki (`destrukcja-taran-sym.mjs --tryb szyja`, 60 Hz, 3000 j/s, średnia kroku po zerwaniu):
4,78 → 4,13 ms (kolizje 2,89 → 2,18 ms), po osiadaniu 1,66 → 0,67 ms; faza uderzenia 9–14 → 8,7–13,1 ms (kolizje
5,3–7,4 → 4,4–6,2 ms). 120 Hz: kolizje 0,94 → 0,73 ms, po osiadaniu 0,46 → 0,16 ms.

## 5. Hipotezy sprawdzone i odrzucone

- **`Bridge3D.update` 102 ms w jednej klatce rozpadu** (profil `.tmp/baza-ostrzal-wiezy2/supernowa.cpuprofile`) —
  artefakt profilera: jedna próbka z odstępem 102 ms (wątek nie był próbkowany — najpewniej wywłaszczenie procesu przy
  obciążonej maszynie), przypisany funkcji z ostatniej próbki; `positionTicks` tej funkcji to ~30 tików, nie ~500.
  W pomiarach tej sesji `Bridge3D.update` w rozpadzie habitatu ≤ 3 ms; w jednej bitwie jedna klatka 29 ms (nie powtórzyła
  się w trzech kolejnych bitwach z diagnostyką metod — `--diag 1`).
- **Klatki 90–150 ms przy Supernowej po stronie GPU** — czas GPU klatki ≤ 3 ms w każdym oknie (znaczniki co klatkę,
  RTX 5080, 1600 × 900); ówczesne klatki to wypiek skór w klatce (tu naprawiony) i obciążenie maszyny.
- **Synchroniczne dekodowanie PNG kadłubów przy pierwszym okręcie typu** (`img.decode()` po wczytaniu) — A/B startu
  bitwy bez zmiany (maks. 109 vs 109 ms), zmiana cofnięta.
- **Fronty fal na ciałach płaskich jako przyczyna przestojów** (`worldChannels._blastBody` — okno pełnego koła promienia
  frontu) — w zmierzonych scenach poniżej progu profilu (koszt rośnie z polem koła, więc zawężony mimo to — § 3 pkt 6).

## 6. Do decyzji użytkownika

1. **Pierwszy okręt nowego typu kadłuba** (start bitwy, wezwania nowych typów w grze swobodnej): ~70 ms pracy wątku
   głównego na typ, rozłożone na kilka klatek — wysyłka tekstury sprite'a w renderze (`copyExternalImageToTexture`
   18–25 ms), mapa powierzchni (`createImageBitmap` ze skalowaniem w wątku głównym, ~19 ms), lakier (`HullLacquer`
   ~10–13 ms na obraz), cień SDF (~9 ms), kratownica (~5 ms). Start bitwy 2 × 50 okrętów 7 typów: 8 klatek > 50 ms,
   3 > 100 ms (do 140 ms). Propozycja: wstępny wypiek wyglądu WSZYSTKICH 12 typów kadłubów NPC na ekranie ładowania
   (`prewarmHexShipVisual` + wypiek lakieru i SDF od razu, wysyłka tekstur przez `renderer.initTexture`) — koszt:
   ~0,3–0,5 s ładowania i ~100 MB pamięci GPU (sprite'y 2–22 MB każdy). Alternatywa bez pamięci: lakier i mapa
   powierzchni w workerze (inne próbkowanie obrazu — drobna różnica wyglądu map pomocniczych).
2. **Fizyka szyi habitatu i rozpadu** — po naprawie wypieku zostają klatki 40–70 ms (2–4 kroki fizyki × 10–14 ms:
   solver lokalny ~50%, zderzenia ~45%). Dalsze zmiany bez zmiany wyniku są drobne; większe: solver lokalny na GPU
   (demo z 2026-10-11, integracja czeka na decyzję), rzadsze zderzenia odłamów różnych kawałków w rozpadzie (zmiana
   rozgrywki), mniej węzłów wieży (komórka 45 → większa — zmiana zachowania).
3. **Gęstość skóry ciał świata** — pomost NP to 252 tys. trójkątów (podział do 3 komórek), cała baza 1,4 mln
   trójkątów (176 MB po zmianie na indeks). `skinEdgeCells` per rodzaj to pokrętło jakość ↔ pamięć i czas wypieku
   (zmiana wyglądu ugięć).

## 7. Dopisek 2026-10-17: duża bitwa i pierwszy wybuch rdzenia (oba tryby renderu)

Pomiar: `przestoje-gra.mjs --sceny bitwa --sklad 50,20,10,3 --seed 7` (off) i `profil-bitwy-flot.mjs … --query
renderWorker=1 --workerProf 1` (nowa flaga: profil CPU i konsola workera renderu), A/B przez `HULLFALL_AB_DIR`.

1. **Off — długie zadania poza rAF** (klatki 115–190 ms przy CPU rAF 3–35 ms): kolejka `Core3D.warmup` w trakcie gry
   budowała materiały MODELI 3D okrętów — każdy model miał własne grafy (4 materiały × 2 kamery, NodeBuilder ~110 ms
   każdy, ~0,9 s na typ kadłuba; wpis „modele 3D floty” w fazie `after` i `warmup.now` przy nowym typie). Poprawka:
   jeden graf na wariant, model = klon na wspólnych węzłach (`sharedModelMaterial`). Okno „spokój” (po starcie gry):
   długie zadania 4–5 → 0, najdłuższa klatka 121–146 → 5,5 ms; start bitwy: klatki > 100 ms 4–10 → 0, najdłuższa
   162–186 → 92 ms (zostaje koszt pierwszego okrętu typu — § 6 pkt 5); ekran ładowania `flush()` 1,8 s.
2. **Worker — przestoje 330–550 ms w bitwie i ~0,7 s przy 1. wybuchu rdzenia**: pierwsza domena atlasu „coarse” /
   podstawowego gazu wybuchów budowała bryły `WybuchCoarseBack/Front`, `WybuchBack/Front` W KLATCE (NodeBuilder
   130–370 ms na bryłę + pipeline synchroniczny) — rozgrzewka z `warm` kroku fx nie trafiała w klucz workera.
   Poprawka: bryły gazu, żar, błyski, łby odłamów (`explosionFx.js`) i pule wybuchu rdzenia (`reactorBlastFx.js`) w
   rejestrze ekranu ładowania (`WARIANT_INSTANCJI`). Bitwa: najgorsze opóźnienie stron 516 / 431 → 12,6 ms, najniższe
   kl/s obrazu 57 → 171; wymuszona detonacja rdzenia pancernika: 669 ms / 17,5 kl/s → 1,1 ms / 267 kl/s.
3. **Zostaje** (drobne, worker): pipeline'y synchroniczne `MainExhaustJets`, `RocketBodies` (pierwsze sekundy gry),
   `spaceDust`, `hullSkinBatch` (klatka 0), kompilacje „rozpad stacji” 25–48 ms po `flush()` w workerze; w obu
   trybach koszt pierwszego okrętu każdego typu (`createHull` → `getImageData` 30–50 ms, cień SDF, mapa powierzchni).
