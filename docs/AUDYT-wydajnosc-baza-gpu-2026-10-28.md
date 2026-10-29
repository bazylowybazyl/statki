# Wydajność: niszczenie bazy piratów, upadek odłamów, wyjście z warpa (2026-10-28)

Zgłoszenie użytkownika: kampania działa dobrze, dopóki nie zacznie niszczyć budowli piratów. Już pierwsze obrażenia
habitatu dają klatkowanie, a chwila, gdy wszystko wybucha i odłamy spadają na planetoidę, to „katastrofa wydajnościowa”.
Potrafi się „ogarnąć” po chwili i zależy od zoomu. Potem przy wyrwaniu z warpa (zasadzka misji 2 w pasie) też potrafi
mocno spaść, a „karta się poci”. Sprzęt: Ryzen 7800X3D, RTX 5080 16 GB, monitor 5120 × 1440 @ 240 Hz (7,4 Mpx — 5× więcej
pikseli niż harness 1600 × 900, którym mierzono dotąd bazę i wybuchy).

Gałąź: `claude/perf-baza-gpu` (od main 00a42543). Analiza kodu i poprawki § 3 zrobione bez GPU (użytkownik grał w tym
czasie na komputerze); pomiar main ↔ gałąź w widocznym oknie — § 5; drugie zgłoszenie z oglądania pomiaru (efekty
klatkują przy 240 kl/s) i jego poprawka — § 6; co zostaje — § 7.

## 1. Co mówi zrzut PerfHUD

W złej chwili: nagłówek 12 kl/s (pętla strony), „3,9 ms wątku gry na klatkę (wystarczy na 260 kl/s)”, „Obraz 3D (worker)
10 kl/s · wiek 5 · CPU 5,5 · GPU 9,0 ms”, fizyka 1,0 ms, rysowanie strony 2,2 ms. Wątek gry jest prawie bezczynny, a strona
i worker spadają RAZEM do 10–12 kl/s. Klatka zamkniętej pętli (strona → worker → kompozytor Chrome) trwa ~100 ms, z czego
liczby w HUD tłumaczą ~15 ms. Brakujący czas jest poza tym, co HUD pokazywał:

- „GPU 9,0” to suma znaczników passów RENDER jednej próbkowanej klatki (co 4. klatka). Compute — bloom (`BloomGryCompute`),
  symulacja gazu wybuchów i wyrw, pamięć mgły, kroki `Core3D.fx` — ma osobne `gpuComputeMs`, którego worker nie wpisywał do
  kanału zwrotnego (`RET_F64.GPU_COMPUTE_MS`), a wiersz nie czytał. Poza znacznikami w ogóle: wysyłki (`writeBuffer` /
  `writeTexture`), generowanie mipmap, kopie, prezentacja, kompilacje pipeline'ów i stronicowanie pamięci karty.
- „10 kl/s” to złożenia bitmap na stronie (najwyżej tyle, ile klatek strony), nie rendery workera.
- „CPU 5,5” liczy się od chwili PO lustrach, rozkazach i odbiorze wiadomości — bez nich i bez GC.
- Strona nie czeka na workera (publikuje co klatkę), więc jej 12 kl/s przy 4,8 ms pracy znaczy, że rAF strony dławi proces
  GPU Chrome / karta: kompozytor czeka na token ukończenia pracy GPU workera.
- Wiek 5 framePacera przy 12 kl/s to ~415 ms opóźnienia obrazu, a obniżał się dopiero po 1200 przyjściach (~100 s).

## 2. Przyczyny z analizy kodu (ranking przed pomiarem)

Analiza: 6 czytelników kodu (worker, gaz, odłamy 3D, habitat, warp, koszt przy 5120 × 1440), synteza i dwie niezależne
weryfikacje (koszt, wyzwalacz). Pewność dotyczy MECHANIZMU; wielkość rozstrzyga pomiar.

1. **Gaz wybuchów — compute niewidoczny w HUD, przy 1440 px prawie zawsze atlas „fine”** (pewny mechanizm, koszt ~9–18 ms na
   klatkę przy 10 kl/s). Wybór atlasu idzie po promieniu kuli w px bufora (`fineMinPx` 60): przy wysokości 1440 px wybuch
   progu habitatu (520 → R 676) trafia do „fine” przy kadrze ≤ 16 km wysokości (przy 900 px — ≤ 10 km). Domena „fine” to
   128² × 48 komórek × 46 kerneli (41 iteracji Jacobiego) na podkrok — ~5,3× domeny podstawowej. Przy < 20 kl/s gaz liczy
   3 podkroki na klatkę (dt z `SimClock.sim`, sufit 3) — koszt na klatkę ×3 (na sekundę nie rośnie). Pierwszy próg habitatu
   (1/8 punktów) odpala naraz rozpad Voronoi kawałka, wybuch 520 w „fine”, wyrwę `break` z domeną gazu i zapłon — stąd
   „wystarczy, że habitat dostanie damage”. HP 0: łańcuch rur od H (86 zdarzeń w 9,5 s) i upadek nasycają 18 domen.
   „Ogarnia się” — domeny wygasają (3–30 s), atlas „fine” zwalnia się po 20 s; „zależy od zoomu” — zoom przenosi domeny do
   „fine”, a marsz brył rośnie z px² (budżet marszu 40 mln próbek strojony przy 1,44 Mpx).
2. **Worker ignorował preset grafiki** (pewny błąd). `applyGraphicsSettings` ustawiał tylko moduły STRONY; worker dostawał
   skalę i MSAA przy starcie, więc zawsze liczył gaz i efekty „Wysokie” (`fineGas` także przy Średniej, którą dobór
   automatyczny daje ekranom > 5,2 MP), bloom pełny i smugi cieni domyślne. Rozdzielczość dynamiczna w trybie worker nie
   działała wcale (strona bez urządzenia nie dostaje próbek, skala nie dochodziła do workera).
3. **Pamięć karty przy 5120 × 1440** (hipoteza do pomiaru, jedyny znaleziony mechanizm rzędu brakujących ~70 ms). Cele
   Core3D ~1 GB (scena i pre-pass halo po 413 MB: HalfFloat × MSAA 4 + rozwiązanie + głębia), kanwy Chrome ~0,3 GB, atlasy
   gazu do 326 MB (leniwe — „fine” 126 MB alokuje się przy pierwszym dużym wybuchu habitatu i zwalnia po 20 s), skóry bazy
   do 176 MB. Przy innym programie trzymającym dużo VRAM (np. klient LoL, notowane 9–10 GB) świeże alokacje mogą trafić do
   pamięci współdzielonej — Jacobi „fine” przez PCIe to dziesiątki ms na podkrok (por. „partia skór z kopiami: GPU 3 → 11 ms
   przy zajętym VRAM”, `docs/AUDYT-baza-po-upadku-2026-10-27.md` § 5).
4. **Odłamy w workerze rysowały pełną skórę kawałka na stałe** (pewny błąd, ~1–4 ms GPU nad gruzem). Pakujący wysyła węzły
   ciała tylko w pudle rozgrzania; lustro odłamu spoza pudła ma puste `active` → podzbiór null → odłam wypadał z kolejki
   z pełną geometrią, a pole skóry z samymi martwymi komórkami odrzucało KAŻDY fragment (koszt bez obrazu, ∝ pikselom).
   Poprawka była tylko na niescalonej gałęzi partii skór (055eee4e).
5. **Skok gracza zwalniał gruz bazy** (pewny błąd, jednorazowy koszt przy wyjściu z warpa PRZY bazie). Rekord soczewki bazy
   dostaje kotwicę w KAŻDYM skoku, dostawca miejsc jest wtedy „ukryty”, a po 600 klatkach workera (2,5 s przy 240 Hz)
   egzemplarze i skóry straconych kawałków były zwalniane — po wyjściu wszystko naraz: pilne wypieki (35 kawałków ×
   40–210 ms w workerach skór), ~250 egzemplarzy, wysyłka do ~176 MB geometrii, podzbiory od nowa (do tego czasu pełne skóry).
6. **Wyrwanie z warpa w pasie (zasadzka)**: gaz przestrzeni po skoku startuje od zera z rozgrzaniem ×4 (do 8 podkroków ×
   36 kerneli na klatkę przez 3 s), pas wczytuje warstwy od pustych, ośrodek „Nurtu” (1 mln drobin) budzony przylotami
   piratów liczy do 16 kroków na klatkę przy niskim FPS, wybuchy przylotów — gaz jak wyżej. Każde z osobna kilka ms; do
   rozstrzygnięcia pomiarem (`gpu-zasadzka-gra.mjs`).
7. Mniejsze: przestoje CPU workera przy progach (rekord na każdy utracony węzeł, alokacje podzbiorów — pojedyncze klatki,
   nie stałe 10 kl/s), stałe tło przy 5120 × 1440 ~3–6 ms GPU (7–13 rozwiązań MSAA na klatkę, maska słońca, uber, bloom).

## 3. Poprawki (gałąź `claude/perf-baza-gpu`)

- **PerfHUD** (f3b1279d): wiersz workera „GPU render+compute · kolejka X ms”; kolejka = od końca zgłoszeń klatki workera do
  `onSubmittedWorkDone` (co 8. klatkę, `RET_F64.GPU_QUEUE_MS`) — łapie KAŻDĄ pracę karty, także bez znaczników; > 50 ms —
  wiersz na czerwono.
- **Ciała świata w workerze** (4494ee4f): odłam bez stanu węzłów lustra schowany (`noNodes`) i czeka na węzły
  (`MirrorBody.nodesReceived`, `_subsetWait` — jak 055eee4e, bez partii); ukryty dostawca (soczewka skoku, mgła) utrzymuje
  egzemplarze do 60 s czasu rzeczywistego (`HIDDEN_KEEP_MS`). A/B: `__worldSkinOptions.noNodesHide / hiddenKeep = false`.
- **Opcje grafiki w workerze** (fa8e37a2): `gfxRenderRecord` → `RenderWorkerHost.setGfx` → `applyGfx` w workerze (Core3D:
  skala, bloom, gorące powietrze, smugi cieni; `EXPLOSION_TUNE`, `WeaponFx`, `WarpNurt`, `SIDE_JET_TUNE`, lakier, oświetlenie
  kadłubów, pas); rozdzielczość dynamiczna w trybie worker czyta próbki z kanału zwrotnego i wysyła skalę.
- **Stały wiek obrazu** (eeeefccb): okno obniżania wieku także w czasie (5 s) — przy 12 kl/s wiek schodzi po ~5 s, nie ~100 s.
- **Narzędzia** (bdd4c793, 08720416): `scripts/webgpu/sondaGpuWorkera.mjs` (sonda GPU workera: wysyłki i nowe zasoby na klatkę,
  pamięć gry, dispatche, rysunki, pipeline'y sync / async, opóźnienie kolejki, czas GPU ze znaczników rozbity na passy Core3D,
  kroki `Core3D.fx` i rendery modułów; ślad Chrome — zajętość CrGpuMain; nvidia-smi), `gpu-baza-gra.mjs` (ostrzał habitatu
  bronią gry, upadek, gruz, A/B w pauzie `--abWorker`) i `gpu-zasadzka-gra.mjs` (warp, wyrwanie, walka) — domyślnie 5120 × 1440,
  tryb worker.

Gazu (pkt 2.1) nie zmieniałem przed pomiarem: progi atlasu i sufit podkroków to zmiana obrazu (decyzja użytkownika „fine od
60 px”), a koszt na sekundę przy niskim FPS nie rośnie. Kandydaci po pomiarze: próg „fine” względem wysokości bufora,
podkroki gazu pod obciążeniem z dylatacją czasu gazu, budżet marszu na Mpx, atlas „fine” bez cyklu zwolnij / alokuj.

## 4. Testy

`node --test tests/worldBodies3D.test.mjs tests/mirrorBody.test.mjs tests/graphicsQuality.test.mjs tests/framePacer.test.mjs
tests/renderBuffers.test.mjs tests/szewRenderu.test.mjs tests/dynamicResolution.test.mjs` — zielone (nowe: odłam bez węzłów
czeka i jest schowany, 700 klatek ukrycia bez zwolnienia i bez ponownych podzbiorów + A/B dawnego zwolnienia, `nodesReceived`,
rekord obrazu z każdego presetu i klej strony / workera, okno wieku w czasie).

## 5. Pomiar — wyniki (5120 × 1440, widoczne okno z vsync 240 Hz, `--query grafika=wysoka`)

Przebiegi PO KOLEI, przy ciszy innych sesji: A2 — main 00a42543 z narzędziami z gałęzi (`.tmp/gpu-baza-A2-walka`), B2 —
gałąź z partią skór, poprawkami z § 3 i zegarami z § 6 (`.tmp/gpu-baza-B2-walka`). Polecenie (oba):
`node scripts/webgpu/gpu-baza-gra.mjs --okno 1 --rozmiar 5120x1440 --zoom 0.035 --zoomGruz 0.035 --slad 3 --walka 30
--profil 1 [--rytm 1] --query grafika=wysoka` — oddalony kadr (cały gruz), ostrzał habitatu, upadek do osiadania, walka
z 14 piratami nad gruzem (Atlas strzela sam). Liczby: obraz = złożenia bitmap workera / s, strona = klatki pętli gry / s.

| Okno | A2 obraz / strona | B2 obraz / strona | CPU workera p50 A2 → B2 | GPU render + compute A2 → B2 | rysunki A2 → B2 |
|---|---|---|---|---|---|
| ostrzał, pierwsze trafienia | 115 / 134 | 200 / 203 | 2,7 → 2,2 ms | 5,0 + 3,7 → 2,6 + 1,7 ms (domeny gazu 10 → 3) | 112 → 103 |
| upadek (najgorsze okno) | 49 / 55 | 114 / 125 | 7,1 → 3,7 ms | — | 338 → 281 |
| upadek (średnio, 8–9 okien) | 136 / 156 | 179 / 188 | 4,6 → 3,0 ms | 3,4 + 2,4 → 2,7 + 2,0 ms | 253 → 224 |
| nad gruzem | 219 / 195 | 236 / 239 | 4,0 → 2,5 ms | 2,2 + 0,4 → 1,4 + 0,6 ms | 346 → 293 |
| walka (10 okien) | 210 / 238 | 235 / 237 | 4,4 → 2,7 ms | 12,1 + 2,2 → 1,5 + 0,7 ms | 332 → 110 |

- Upadek: w A2 hamował worker (rysunki skór odłamów, ~330 na klatkę; profil CPU workera: `renderObject` three 34% czasu
  przebiegu, 53% czasu pracy), w B2 — w najcięższych sekundach karta (GPU 98–99%, 14–16 domen gazu, kolejka GPU ~38 ms),
  przy lądowaniu gruzu strona (upadek-6: CPU workera 3,7 ms, GPU 54%, strona 114 kl/s; w A2 strona 55).
- Wysyłki bez etykiety w upadku A2 (1–1,9 MB na klatkę, ~62 wywołania) to pole skóry odłamów (`writeHullSkinField`,
  `hullSkin3D.js`): obracający się odłam zmienia przesunięcia WSZYSTKICH węzłów względem siatki spoczynkowej (próg 0,02 j.),
  więc ~31 KB na odłam co klatkę, do osiadania. Zostaje (koszt przejściowy) — kandydat: ruch sztywny odłamu w macierzy
  egzemplarza, w polu tylko odkształcenie.
- Walka: B2 była lżejsza niż A2 (1–13 pocisków w powietrzu wobec 2–307), więc różnica obrazu i GPU w walce to tylko
  częściowo poprawki (rysunki 332 → 110 — partia skór, odłamy bez węzłów lustra schowane zamiast rysowania pełnej skóry
  kawałka); w A2 GPU walki szło w `pass:bg` 2,2–6,9 ms, `maskaSlonca` 1,2–3,7 ms, `pass:ortho` 0,8–3,4 ms.
- Ocena użytkownika B2 (oglądał przebieg): „nie było już tego skakania” (§ 6).

## 6. Klatkowanie efektów przy 240 kl/s — zegary (zgłoszenie po A2)

Zgłoszenie (oglądając walkę A2): „niby płynnie — poruszanie statkiem, 240 kl/s w PerfHUD — ale wszystko, co związane
z efektami cząsteczkowymi, uderzenia w tarcze, pociski, strzały, klatkowało; jakby rozsynchronizowane albo pokazywało się
co kawałek”. Przyczyna — obraz jednej klatki workera składał się z rzeczy na RÓŻNYCH zegarach:

1. **Zegar efektów** (`Core3D.fx` — cząstki, błyski, dym, iskry; bank `Fx3D` i migawka pocisków w `WeaponFx.sync`; odłamki
   `HullDebris3D`): w workerze `fxNowMs` = `performance.now()` strony w chwili pakowania migawki — PO fizyce, a
   `WeaponFx.sync` / kadłuby brały `performance.now()` workera w chwili rysowania. Przy 240 Hz krok fizyki 60 Hz trafia co 4.
   klatkę: ta klatka „trwała” dla efektów o czas kroku (2–4 ms w walce) dłużej, następna krócej. Kadłuby idą zegarem gry
   z interpolacją (`SimClock.render`, z `dt` z rAF) — równo.
2. **Pociski i efekty NPC** (`CLOCK_SIM`): od 2026-10-17 kadłuby NPC i wraków stoją w obrazie w pozie interpolowanej między
   krokami (`renderPoses`, czas `SimClock.render`), a ich pociski (rysowane w pozie kroku) i efekty niesione kadłubem
   (`pos + v · (sim − t0)`) — na zegarze kroku: 3 klatki stały, w czwartej skok o v/60, przed kadłubem.

Poprawka:
- zegar klatki efektów = znacznik rAF klatki strony: `index.html` — `window.__frameNowMs = now` w `loop`, `HEAD.WALL` migawki
  = ten znacznik (`f.wall = lastTime`); `Core3D.frameNowMs()` (`fxNowMs` z migawki → `RenderWorld.frameNowMs` → poza pętlą
  `performance.now()`) czytają `Core3D.fx`, `WeaponFx.sync`, `updateHexShips3D` (odłamki, światła pozycyjne, czas materiałów
  kadłubów) i wyrzut odłamków (`spawnHullDebris`, wyrwy bazy). Pod harnessem znacznik rAF i `performance.now()` to ten sam
  czas wirtualny — zrzuty narzędzi bez zmian;
- zegar obrazu bytu: `isRenderClockEntity` (`src/game/carrierVelocity.js`) — gracz, P2 i NPC / wraki w pozie renderu (hak
  `setRenderPosedEntity` ← `npcRenderPosed` w `index.html`, ten sam warunek co `bridgeRenderPose`; off i `?npcLerp=0` —
  jak dawniej); używa go `writeCarrier` (wyloty, trafienia). Zegar pocisku `projectileClockOf`: przy pozach renderu KAŻDY
  pocisk na zegarze renderu (`fireWeaponCore`, `aiSpawnBullet`, zapasowy strzał NPC, platformy, torpedy) — także z
  nieruchomego strzelca (okręt piratów w stanowisku, platforma), którego poza renderu nie jest „żywa”. Rozgrywka pyta dalej `isInterpolatedEntity` (zapalnik rakiet: gracz rusza się w kroku przed nimi);
- `WeaponFx.sync`: pocisk na zegarze renderu przed chwilą wystrzału (`bornSim` > czas renderu — NPC strzela z pozy PO
  kroku) jedzie tylko z lufą (`ivx / ivy`); bez tego cofał się za wylot o prędkość pocisku × opóźnienie renderu.

Pomiar w tym samym przebiegu B2 (sonda `--rytm 1`: przyrost zegara treści między złożonymi stronami wobec odstępu złożeń;
odsetek złożeń z rozjazdem > 1 ms; stary zegar efektów = `performance.now()` strony tuż po fizyce):

| Okna B2 | kadłuby = nowy zegar efektów | stary zegar efektów wobec kadłubów | pociski NPC na zegarze kroku |
|---|---|---|---|
| spokój przed ostrzałem | 5% | 13% (śr. 1,0 ms, p95 6,2 ms) | 99,9% |
| ostrzał habitatu | 21–26% | 72–75% (śr. 3,2–4,4 ms, p95 do 17 ms) | 99% |
| upadek | 0,4–56% | do 87% (śr. do 6,6 ms) | 88–100% |
| walka nad gruzem | 0–7% | 3–34% | 100% |

Rozjazd kadłubów (i nowego zegara efektów) to przeskoki stron i nierówny takt klatek strony przy stałym wieku obrazu
(upadek: ~150 kl/s na monitorze 240 Hz — klatki po 1 i 2 odświeżenia); efekty i pociski nie odjeżdżają już od kadłubów.
Testy: `tests/zegarKlatkiEfektow.test.mjs` (kolejność źródeł zegara, strażnik `index.html` i modułów),
`tests/carrierVelocity.test.mjs` (nośnik NPC w pozie renderu, pozycje pocisków w `WeaponFx.sync`).

## 7. Co zostaje

- Efekty po stronie renderu z zegarem kroku na sztywno przy nośniku NPC: gaz i żar wybuchów (`explosionFx.js`), wybuch
  reaktora, iskry mostków, iskry trafień rakiet w NPC (`rockets/effects.js` — `isPlayerEntity(hit) ? CLOCK_RENDER :
  CLOCK_SIM`). Nośnik to wolny kadłub (100–600 j/s → ≤ 10 j. na krok): przy zoomie 0,035 poniżej piksela, przy 0,3 do ~3 px.
  Poprawka: flaga „NPC w pozie renderu” w HEAD migawki → `RenderWorld` → wybór zegara w tych modułach.
- Upadek przy 5120 × 1440: karta w najcięższych sekundach (gaz 14–16 domen) — kandydaci z § 3 (próg „fine” względem
  wysokości bufora, sufit podkroków pod obciążeniem); pole skóry odłamów (wyżej; profil CPU workera w upadku B2:
  `writeHullSkinField` 9,8% pracy workera — pierwsza pozycja po partii skór, `renderObject` three 34% pracy wobec 53% w A2,
  worker zajęty 55% czasu wobec 65%; ZROBIONE 2026-10-29 — § 8); nierówny takt poniżej odświeżania.
- Zasadzka (wyrwanie z warpa): pierwszy pomiar (`gpu-zasadzka-gra.mjs --okno 1 --zoom 0.035`, `.tmp/gpu-zasadzka-B`)
  NIE trafił w zasadzkę — skok dev `?story=ambush` zostawia Atlasa w hali K-7 (użytkownik widział go tam przez ~60 s),
  faza `ambush` kończy się od razu jako „w domu” (`api.dock.nearHall`), misja przechodzi do `return` i dokuje
  (`dockReturn`). Zmierzone wyjście z warpa PRZY ZIEMI (powrót): ~143 kl/s obrazu przez kurs, skok i ~2 s po wyjściu
  (CPU workera 6–7 ms, wysyłki 1–1,4 MB na klatkę, `pass:bg` do 9 ms, ring planety 2,2 ms — świat w soczewce skoku),
  potem 230–240. Do zrobienia: naprawić skok dev (teleport fazy `ambush` nie wynosi Atlasa na kurs przez pas) i zmierzyć
  prawdziwe wyrwanie; u gracza w kampanii w świecie jest też gruz bazy z misji 1 (skóry odłamów przy soczewce — § 3,
  `HIDDEN_KEEP_MS`).

## 8. Pole skóry odłamów (2026-10-29, gałąź `claude/pole-skory-sztywne-622ed0`)

Kandydat z § 5 / § 7: `writeHullSkinField` (`src/3d/ships3d/hullSkin3D.js`) — pierwsza pozycja CPU workera w upadku po
partii skór i wysyłki bez etykiety 1–1,9 MB na klatkę.

**Hipoteza z § 5 („obracający się odłam zmienia przesunięcia wszystkich węzłów”) nie trzyma się pomiaru.** Sonda w Node na
prawdziwej sekwencji upadku — `node scripts/pole-skory-upadek-sym.mjs --tryb upadek --warianty stoi --dt 60 --hp0 2
--czas 25` (`destrukcja-taran-sym.mjs` z opakowanym `HullBodies.step`): po każdym kroku, dla każdego ciała świata, komórki zmienione o > 0,02 j. (próg
`writeHullSkinField`), zakres lo..hi slotu i to samo po odjęciu ruchu sztywnego dopasowanego metodą Horna (środki komórek →
węzły). Węzły są w UKŁADZIE CIAŁA, a ruch sztywny odłamu (obrót, dryf, spadanie) żyje w pozie ciała (`pos` / `quat`, kąt
encji). Dopasowany obrót węzłów w układzie ciała to 0,04–0,1° w locie (5–30° dopiero w zgniocie po lądowaniu), a po jego
odjęciu zmienionych komórek jest 2–4× WIĘCEJ — dopasowanie rozkłada zgniot na wszystkie węzły. Kierunek odrzucony.

| okno sondy (s po HP 0) | budzone ciała / węzły | zmienione komórki na krok | zakres lo..hi na krok |
|---|---|---|---|
| lot (3–8) | 4–13 / 13–30 tys. | 500–1400 | 19–49 tys. (0,3–0,8 MB) |
| lądowanie (17–21) | 7–42 / 13–35 tys. | 5–10 tys. | 62–155 tys. (1–2,4 MB) |
| osiadanie (22–24) | 6–30 / 9–26 tys. | 0,5–3 tys. | 23–97 tys. (0,4–1,5 MB) |

Prawdziwy koszt: (1) zmienia się 2–4% komórek budzonych ciał, rozrzuconych po całym slocie — zakres lo..hi wysyła 10–40×
więcej niż trzeba, a rozbicie na zakresy nie pomaga (model 2,5 µs na `writeBuffer` — `docs/webgpu/WYDAJNOSC.md` — i 0,1 µs/KB:
przy scalaniu przerw ≤ 256 komórek 2–3× mniej bajtów, ale 4–5× więcej wywołań, ten sam czas); (2) przegląd węzłów idzie
w KAŻDEJ klatce workera (do 240 kl/s), a węzły zmienia krok gry (60 Hz).

**Poprawka** (c7210dcb, bez zmiany obrazu): (1) lustro ciała dostaje numer stanu węzłów (`MirrorBody.nodesSeq` — strona
z węzłami, nowa topologia); bez nowej strony, przy tym samym magazynie, `latticeMin` i komórce przegląd nic by nie zapisał
— `writeHullSkinField` go pomija (ciała gry w trybie `off` — przegląd zawsze); (2) wysyłka ROZRZUTEM — indeksy zmienionych
komórek na liście (bez powtórzeń), krok `Core3D.fx` „pole skóry 3D (rozrzut)” raz na klatkę kopiuje ich bieżące wartości
z kopii CPU do małego bufora (indeks 4 B + wartość 16 B) i kernel compute przepisuje je do pola; bez kroku i przy
przepełnieniu (65 536 komórek na klatkę) — zakres jak dawniej. A/B: `__worldSkinOptions.fieldScatter / fieldSkip`, adres
`?poleRozrzut=0&polePomin=0` (dawna ścieżka w tym samym kodzie). Testy: `tests/hullSkinField.test.mjs`.

**Pomiar w grze** — `node scripts/webgpu/gpu-baza-gra.mjs --okno 1 --rozmiar 5120x1440 --zoom 0.035 --zoomGruz 0.035
--profil 1 --query "grafika=wysoka[&poleRozrzut=0&polePomin=0]"`, przebiegi PO KOLEI (A = dawna ścieżka przełącznikami,
B = nowa; `.tmp/gpu-baza-pole-A`, `-B`; pierwsze podejście A nie wystartowało fazy `shipyard` — jednorazowo, sonda tego nie
odtworzyła). Upadek (10 okien po 2 s, ~3260 klatek workera w każdym przebiegu):

| miara (cały upadek) | A (zakres, przegląd co klatkę) | B (rozrzut, pominięcie) |
|---|---|---|
| wysyłki pola skóry | 706,7 MB | 37,1 MB (−95%) |
| wszystkie wysyłki workera | 1323,7 MB | 716,7 MB (−46%) |
| przeglądy ciał (pominięte) | 26 096 (0) | 5 601 (16 770) |
| zapisane komórki | 2,04 mln | 2,01 mln |
| profil CPU workera: `writeHullSkinField` (+ `scatterFlush`) | 954 ms — 6,2% pracy | 393 + 60 ms — 3,2% pracy |
| profil CPU workera: `writeBuffer` / praca workera | 927 ms / 15,5 s | 726 ms / 14,2 s |

| okno (A → B; fazy się przesuwają — najcięższe lądowanie: A upadek-5…7, B upadek-4…5) | pole KB / klatkę | CPU workera p50 | obraz / strona kl/s |
|---|---|---|---|
| ostrzał 1–3 | 4–9 → 0–1 | 2,3–2,5 → 1,8–1,9 ms | 179–181 → 180–181 |
| upadek-2 (wybuchy) | 244 → 0 | 3,39 → 2,64 ms | 158 / 173 → 149 / 162 (B: 16 domen gazu, GPU 95%) |
| lądowanie, najcięższe | 470–815 → 46–48 | 3,1–4,3 → 2,95–3,1 ms | 110–146 / 123–155 → 109–117 / 116–127 |
| osiadanie (A upadek-8, B upadek-6…8) | 189 → 5–10 | 2,75 → 2,5–2,7 ms | 181 / 182 → 179–181 / 180–183 |

- Ślad Chrome w upadku-2: worker zajęty 70% → 47% czasu (proces GPU 57% w obu — w B gaz 16 domen, karta 95%).
- Najcięższe okna lądowania w obu przebiegach ogranicza STRONA (fizyka lądowania gruzu: strona 116–155 kl/s, obraz idzie
  za nią) — pole skóry zdjęło koszt z workera i z procesu GPU, ale kl/s w tych oknach zależy od kroku gry.
- Obraz bez zmian: bufor pola odczytany z GPU w pauzie (w locie — po upadek-3, i po osiadaniu) = kopia CPU bit w bit
  w OBU przebiegach (8,39 mln liczb, 0 różnic; A = dawne zakresy, więc kopia CPU to stan dawnej ścieżki); test w Node —
  1500 klatek: pole lustra z pominięciem = pole ciała gry przeglądanego w każdej klatce, emulacja GPU (zakresy jak three +
  kernel) = CPU, mutacje kodu łapane.
- Zostaje: koszt kroku gry przy lądowaniu gruzu (strona), gaz wybuchów (karta, § 7).
