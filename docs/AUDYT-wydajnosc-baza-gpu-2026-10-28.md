# Wydajność: niszczenie bazy piratów, upadek odłamów, wyjście z warpa (2026-10-28)

Zgłoszenie użytkownika: kampania działa dobrze, dopóki nie zacznie niszczyć budowli piratów. Już pierwsze obrażenia
habitatu dają klatkowanie, a chwila, gdy wszystko wybucha i odłamy spadają na planetoidę, to „katastrofa wydajnościowa”.
Potrafi się „ogarnąć” po chwili i zależy od zoomu. Potem przy wyrwaniu z warpa (zasadzka misji 2 w pasie) też potrafi
mocno spaść, a „karta się poci”. Sprzęt: Ryzen 7800X3D, RTX 5080 16 GB, monitor 5120 × 1440 @ 240 Hz (7,4 Mpx — 5× więcej
pikseli niż harness 1600 × 900, którym mierzono dotąd bazę i wybuchy).

Gałąź: `claude/perf-baza-gpu` (od main 00a42543). Stan tego dokumentu: analiza kodu i poprawki zrobione BEZ GPU
(użytkownik grał w tym czasie na komputerze); pomiar w § 5 czeka na wolną maszynę.

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

## 5. Pomiar (do zrobienia przy wolnej maszynie)

Po kolei, nie równolegle; przed każdym przebiegiem `nvidia-smi` (zajętość ≤ ~10%, pamięć innych procesów) — raport zapisuje
stan maszyny i próbki co 0,5 s.

1. Main (eksport 00a42543 + narzędzia z gałęzi) i gałąź, oba z `--query grafika=wysoka` (jak gracz z presetem Wysoka —
   na main worker i tak liczył „Wysoką”): `node scripts/webgpu/gpu-baza-gra.mjs --rozmiar 5120x1440 --slad 3 --abWorker …`
   — okna: przed, ostrzał (pierwsze trafienia), upadek, nad gruzem; w każdym obrazy / s, CPU workera, GPU render / compute
   wg etykiet, kolejka GPU, wysyłki, nowe zasoby, pamięć, zajętość CrGpuMain.
2. Gałąź bez `grafika=` (dobór automatyczny przy 7,4 Mpx → Średnia, teraz działa w workerze).
3. A/B w pauzie nad gruzem: `drawGas`, skala 0,85, bloom, smugi cieni (koszt renderu), a compute gazu z etykiet sondy
   w oknach upadku (w pauzie gaz stoi).
4. Zasadzka: `node scripts/webgpu/gpu-zasadzka-gra.mjs --rozmiar 5120x1440 --slad 3` na main i gałęzi.
5. Jeśli kolejka GPU ≫ suma znaczników: przebieg z obciążoną pamięcią karty (balast) — rozstrzyga pkt 2.3.
