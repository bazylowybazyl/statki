# Audyt: rysowanie w trybie worker — duże bitwy (2026-10-17)

Zgłoszenie: render w workerze jest trybem domyślnym (7b8fd277), ale „potrafi skakać nawet na mocnym sprzęcie przy
dużej bitwie” — sprawdzić, czy wszystko jest dobrze wpięte i czy jest jeszcze pole do optymalizacji. Zrzut PerfHUD
użytkownika: „159”, klatka p50 / p95 3,2 / 11,4 ms, fizyka 2,96 ms na klatkę (6,82 ms na krok @ 60 Hz), rysowanie
3,06 ms (U hex 2,07), 145 NPC, 46 wraków, 552 pociski, „GPU (klatka): brak znaczników”, draw calle „--”.

Równolegle sesja „Audyt wydajności fizyki” zbadała wątek gry: `docs/AUDYT-fizyka-worker-2026-10-17.md` (pomiary
uzgadniane START / KONIEC). Ten dokument dotyczy obrazu: strona ↔ worker, kompozycja, moduły w workerze.

## 1. Odpowiedź w skrócie

1. **Monitor tej maszyny chodzi w 240 Hz (4,17 ms).** Przy tym budżecie „skakanie” ma trzy niezależne źródła:
   - **(a) kadłuby NPC i wraki bez interpolacji** — fizyka 60 Hz, obraz 240 Hz: kadłub obcego okrętu (z wieżami,
     dyszami, mostkiem, tarczą) stał 3–4 klatki i skakał o v/60, a kamera (za interpolowanym graczem) jechała płynnie.
     Cała flota „drga” na ekranie. Interpolację miał tylko gracz (`getInterpolatedRenderPose`, `bridgeRenderPose`)
     i myśliwce na kanwie. Dotyczy też trybu `off`; nasiliło się, gdy krok fizyki spadł ze 120 do 60 Hz (2026-10-11).
   - **(b) nierówny wiek obrazu 3D** — bitmapa workera była składana od razu po przyjściu, więc wchodziła na ekran
     raz 2, raz 3–4 klatki po swojej treści (zależnie od tego, czy zdążyła przed vsynciem). W bitwie **42–61% klatek
     pokazywało treść 3D o 0 albo 2 klatki dalej zamiast o 1** — judder całego obrazu (tło jedzie z kamerą).
   - **(c) wątek gry chybia vsync w klatkach z krokiem fizyki** (krok co 4. klatkę, 4–10 ms) — to temat audytu fizyki
     (§ 1 tamtego dokumentu); kompozycja B2cr wiąże obraz 3D z wątkiem gry, więc chybiona klatka strony = chybiony
     obraz.
2. **Błędy wpięcia znalezione i naprawione** (szczegóły § 4):
   - **zamarzanie obrazu w dużej bitwie** (331 okrętów — znalazła sesja fizyki): ciało znikające z list na klatkę
     dostawało slot z nową generacją, pakujący nie wysyłał topologii drugi raz → lustro ciała bez węzłów → wyjątek
     mostków 3D w KAŻDEJ klatce workera, a `renderPage` nie miał osłony — obraz stał do końca gry. Ten sam błąd robił
     wraki **niewidocznymi** w trybie worker (skóra bez węzłów);
   - **pominięta strona gubiła listę zmienionych węzłów skóry** (stare czworokąty kadłuba po trafieniach — znana
     notatka `AGENT: RW-40`);
   - PerfHUD w trybie worker: „fps” = 1000 / średni czas wywołania pętli (przy vsync i klatkach 1,5 / 10 ms na
     przemian pokazuje więcej niż prawdziwy rytm), bez żadnej informacji o workerze;
   - cztery strażniki testów nieaktualne po wdrożeniu workera (trzy sprzed tego audytu).
3. **Po poprawkach (okno 240 Hz, bitwa 166 okrętów, § 5):** klatki ze skokiem treści 3D **42–61% → 5–10%**, drgania
   ekranowe kadłubów NPC **0,33–0,81 px/kl → 0,02–0,16 px/kl** (p95 1–2,4 → 0,04–0,3), bitwa 331 okrętów bez
   zamarzania, pierścień nakładek bez przepełnień. Cena: obraz 3D ma STAŁY wiek ~4 klatek przy 240 Hz (~17 ms od
   treści do ekranu); w lekkiej bitwie to +1–2 klatki (4–8 ms) względem dawnego „2 albo 3”, w ciężkiej — tyle samo
   co dawna średnia, tylko bez skoków. A/B: `?rwPacing=0`, `?npcLerp=0`.
4. **Pole do optymalizacji** (ranking § 7): największe — fizyka poza wątkiem gry albo rozłożona na klatki (audyt
   fizyki); po stronie obrazu — klatka workera (2,6–4,3 ms przy 240 Hz, w bitwie 331 okrętów do 6,6 ms) wyznacza wiek
   obrazu i sufit kl/s; „render przed fizyką” w pętli zdjąłby klatkę opóźnienia; tryb pół-odświeżania (120 Hz),
   gdy worker nie nadąża za 240 Hz.

## 2. Metoda

- **`scripts/webgpu/rytm-bitwy.mjs`** (nowe): prawdziwe okno Chrome z vsync (jak gra u gracza, nie headless), gra
  swobodna, bitwa jak `profil-bitwy-flot.mjs` (`--sklad 50,20,10,3` = 166 okrętów, seed 7), reżyser kadru jak u gracza
  (zoom efektywny 0,135). Dziennik KLATKA PO KLATCE bez zmian w grze (opakowania w stronie i w workerze przez
  `RenderWorkerHost.dev({ eval })`): znacznik rAF (vsync), czas wywołania pętli, kroki i czas fizyki, pakowanie migawki,
  wysłana strona k, k pokazywane w tej klatce, złożenia; w workerze odbiór wiadomości, `Core3D.renderSingle`, wysyłka
  bitmapy (czas epoki — wspólna oś). Metryki: okres rAF w vsyncach, **wiek obrazu** (vsync pokazania − znacznik klatki
  treści), **skoki treści** (|Δtreści − Δekranu| ≥ 0,5 klatki), **drgania ekranowe NPC** (druga różnica położenia na
  ekranie 16 okrętów najbliżej kamery, w pozie, którą rysuje obraz), droga strony k (wysyłka → worker → złożenie),
  długie klatki (LoAF). `--analiza katalog` — ponowna analiza zapisanego dziennika.
- Profil CPU strony i workera: `scripts/profil-bitwy-flot.mjs --query renderWorker=1 --workerProf 1` (headless).
- Maszyna: RTX 5080, Ryzen 7 7800X3D, monitor 240 Hz; `nvidia-smi` 1%, CPU 6% przed pomiarami; pomiary po kolei
  z sesją fizyki. Bitwa jest chaotyczna — ta sama konfiguracja potrafi różnić się ciężarem między przebiegami (B1 ↔ B2),
  porównania na kilku przebiegach.

## 3. Stan wyjściowy (main 7b8fd277, okno 240 Hz, bitwa 166 okrętów, faza > 15 s)

| | wartość |
|---|---|
| klatki strony | 229 / 240 na sekundę; 3,9% okresów rAF ≥ 2 vsynce |
| wywołanie pętli | p50 1,6 / p95 4,9 / p99 6,3 ms; z krokiem fizyki (26% klatek) śr. 4,1 ms (fizyka 2,3), bez — 1,5 ms |
| pakowanie migawki | 0,54 ms śr. (p95 0,77) |
| klatka workera (odbiór → bitmapa) | 3,1 ms śr. (p95 4,3), w tym `renderSingle` 1,5 |
| wysyłka strony od vsync | p50 0,32 / p90 1,12 klatki (klatki z krokiem fizyki wysyłają późno) |
| bitmapa gotowa od vsync | p50 1,33 klatki; przed 1 klatką 28%, przed 2 — 87,5% |
| wiek obrazu na ekranie | 2 klatki 28%, 3 — 55%, 4 — 13%, 5+ — 4% |
| skoki treści 3D | **44,5%** klatek (20,7% powtórzeń, 21,7% przeskoków) |

Spokój (przed bitwą): 240 kl/s, wywołanie 0,5 ms, klatka workera 1 ms, wiek obrazu zawsze 2, 0 skoków — sam
mechanizm B2cr działa poprawnie; psuje go zmienność chwili, w której bitmapa wraca (wysyłka po fizyce + 3 ms workera
≈ granica vsynca 4,17 ms).

## 4. Przyczyny i poprawki

### 4.1 Zamarzanie obrazu w dużej bitwie, niewidoczne wraki (P0)
- **Przyczyna:** `RenderSlots` (mark & sweep co klatkę) zwalnia slot ciała, którego w klatce nie ma w żadnej liście
  — np. okręt zginął, a wrak z TYM SAMYM ciałem powstaje krok później (detonacja rdzenia idzie w następnym kroku; przy
  240 Hz i fizyce 60 Hz to kilka klatek). Ciało wraca z nową generacją (często ten sam numer slotu). Pakujący
  (`snapshotPack.js`) pamiętał magazyn ciała po samym numerze slotu: ten sam magazyn = brak nowej topologii. Worker
  tworzy dla nowej generacji NOWE lustro ciała i czeka na topologię, której nikt nie wyśle — lustro bez `nodeStore`:
  skóra się nie rysuje (wrak niewidoczny), a `Bridge3D` / `BridgeFx3D` wołały `_latticeIndex(null)` → TypeError
  w każdej klatce; `renderPage` bez osłony nie wysyłał bitmapy — obraz stał do końca gry (bitwa 331 okrętów: od ~18 s).
- **Poprawki:** pakujący pamięta generację slotu ciała (`_bodyGenSeen`) — nowa generacja = pamięć slotu od zera
  (topologia, węzły, spoczynek, HP); `bridgeBeamHull` i `refreshHullMountSet` traktują ciało bez magazynu jak „jeszcze
  nie gotowe”; `renderPage` osłania każdy moduł osobno (`modFail` — moduł z błędem pominięty w tej klatce, pierwsze 3
  błędy modułu do konsoli strony, licznik `st.modErrors`), render i wysyłka bitmapy idą zawsze; czytelnik rozkazów
  pomija rekord, którego dekoder rzuci (`RenderCommandReader.errors`, `onError`). Sprawdzone: bitwa 331 okrętów
  (headless, 45 s) — złożenia rosną do końca, wraki są, konsola bez błędów (także przebieg sesji fizyki).
- Test: `tests/snapshotPack.test.mjs` „ciało znów w migawce po przerwie…”.

### 4.2 Kadłuby NPC i wraki w pozie kroku 60 Hz (P1, „skakanie” floty)
- **Przyczyna:** interpolacja między krokami fizyki tylko dla gracza; NPC i wraki szły do migawki z `x / y / angle` po
  ostatnim kroku. Przy 240 Hz: 3 klatki stoją, czwarta skacze o v/60 (500 j/s → 8,3 j. ≈ 3,7 px przy zoomie 0,45;
  dopalacz 1500 j/s ≈ 11 px), przy płynnej kamerze.
- **Poprawka:** `src/game/renderPoses.js` (czysty, WeakMap po bycie — pola gry nietknięte): przy zmianie numeru kroku
  fizyki poza z poprzedniej klatki renderu staje się „poprzednią”, poza renderu = lerp(poprzednia, bieżąca,
  1 − (1 − α) / k); ruch bez kroku (tunel warpa, sceny) i skok > 6000 j. — bez interpolacji. W trybach z migawką
  (worker, inline): pakujący zapisuje pozę interpolowaną do ENT (`f.poseOf = _snapPoseLerp`, holownik pod graczem ma
  pierwszeństwo), a wieże (`Turret2D.syncFrame`), wygląd maskowania i nakładki 2D NPC biorą tę samą pozę
  (`bridgeRenderPose`, pętla `drawNPCPretty`). Tryb `off` bez zmian (kadłuby rysuje tam `hexShips3D` z pozy kroku).
  A/B: `?npcLerp=0`. Test: `tests/renderPoses.test.mjs`.

### 4.3 Nierówny wiek obrazu 3D (P1, judder całego obrazu)
- **Przyczyna:** bitmapa wchodziła na ekran z najbliższym commitem strony po przyjściu. Chwila przyjścia = wysyłka
  strony (po fizyce: 0,3 albo 1,1 klatki od vsync) + wiadomość + klatka workera (~0,75 klatki) — rozkład okrakiem na
  granicy 1 i 2 klatek, więc wiek przeskakiwał 2 ↔ 3 ↔ 4.
- **Poprawka:** `src/render/framePacer.js` (czysty) + `renderWorkerHost.js`: bitmapy czekają w kolejce, a na
  POCZĄTKU każdej klatki strony (`rwHost.present()` — pierwsza linia `loop()`, przed fizyką) składana jest najnowsza
  bitmapa strony wysłanej `age − 1` klatek wcześniej (albo starszej); starsze odrzucane. `age` dobierany sam z
  „potrzebnego wieku” przychodzących bitmap: w górę, gdy w 64 przyjściach > 3 spóźnienia, w dół po 1200 przyjściach
  (~5 s), gdy niższy wiek spóźniłby się ≤ 6 razy. W spokoju `age` = 2 (bez dodatkowego opóźnienia). Bez taktów pętli
  (tło menu, klatka zero, harness narzędzi `window.__harness`, karta w tle — `present` dawniej niż 100 ms czasu
  rzeczywistego) — złożenie od razu jak dawniej; kolejka bez taktów składa się sama po 80 ms. Pierścień nakładek:
  6 kanw, nietykalne są też kanwy klatek z bitmapą w kolejce (`OverlayRing.acquire(…, queued)`). A/B: `?rwPacing=0`.
  Testy: `tests/framePacer.test.mjs` (symulacja: 240 Hz, fizyka 60 Hz, worker ~3 ms — bez kolejki 16% skoków,
  z kolejką < 2%), `tests/overlayRing.test.mjs`.
- Narzędzia z barierą „złożono ostatnią stronę”: `zrzuty.mjs` (harness — pacing wyłączony), `fabula-gra.mjs`
  (bariera uwzględnia `pacer.age`).

### 4.4 Pominięta strona gubiła listę brudu skóry (P2)
- **Przyczyna:** worker bierze NAJNOWSZĄ stronę (w bitwie ~2% stron pominiętych), a pakujący zerował flagi brudu gry
  przy pakowaniu — lista zmienionych węzłów z pominiętej strony nie docierała, czworokąty skóry zostawały stare
  (wgniecenia, dziury, martwe węzły widoczne do następnej zmiany sąsiada).
- **Poprawka:** w trybie worker `frame.consumeDirty = 'odbior'`: lista narasta i każda strona niesie całość, aż
  worker ODBIERZE stronę, która ją niosła (`lastConsumed`); wtedy pierwsze wysłane wpisy zdejmowane
  (`retireBodyDirty`), dopisane później zostają; `dirtyAll` i `meshDirty` — flaga na każdej stronie do odbioru.
  Inline bez zmian (render odbiera każdą stronę). Test: `tests/snapshotPack.test.mjs` „worker (consumeDirty: odbior)…”.

### 4.5 PerfHUD w trybie worker
- Nagłówek = prawdziwe klatki na sekundę (wywołania pętli / s — `display.fpsReal`); dawna wartość (1000 / średni czas
  wywołania, `display.fps` — tę czytają narzędzia) w podpisie: „X ms wątku gry na klatkę (wystarczy na N kl/s)”.
  Z liczb zrzutu użytkownika: „159” oznaczało ~138 prawdziwych klatek przy rytmie 4 / 12 ms (audyt fizyki § 4.5).
- Nowy wiersz „Obraz 3D (worker)”: złożenia / s, wiek obrazu (`pacer.age`), CPU i GPU klatki workera z RET; żółty,
  gdy obraz 3D < 90% klatek strony. Wiersze „GPU (klatka)”, „Draw calls”, „Obiekty sceny” w trybie worker dalej
  opisują Core3D STRONY (bez urządzenia) — do przeniesienia na RET (§ 7, pkt 8).

### 4.6 Strażniki testów nieaktualne po wdrożeniu workera
`webgpuFundament` (start bez WebGPU — `rwHost?.failed`), `shaderPrewarm` (tarcze: strona tylko w `off`, worker
w `gamePrewarm`), `pirateBaseWorld` (zdarzenia obrazu bazy do workera), `coldWreckView` (poza do migawki —
holownik, potem interpolacja). Pierwsze trzy padały na main przed audytem.

## 5. Wyniki po poprawkach (okno 240 Hz, bitwa 166 okrętów)

Stare = ten sam kod z `?rwPacing=0&npcLerp=0` (poprawki P0 / P2 aktywne). A1 — pierwsza wersja pacera, A2 — strojenie
histerezy i reguła pierścienia, A3 — wersja końcowa. Bitwy różnią się ciężarem (B2 — najcięższa: fizyka 3,0 ms / krok,
worker 4,3 ms p50).

| faza > 15 s | stare B1 | stare B2 | A1 | A2 | A3 |
|---|---|---|---|---|---|
| klatki strony / s | 239 | 195 | 219 | 231 | 233 |
| skoki treści 3D | 42% | 62% | 20% | 10% | **8,4%** |
| powtórzenia / przeskoki | 1256 / 1244 | 1173 / 1344 | 208 / 545 | 139 / 285 | 120 / 232 |
| drgania NPC śr. / p95 [px/kl] | 0,33 / 0,97 | 0,36 / 1,12 | 0,05 / 0,33 | 0,07 / 0,23 | **0,02 / 0,04** |
| wiek obrazu śr. [klatki] | 2,7 | 4,3 | 4,4 | 4,5 | 4,0 |
| wysyłka → złożenie p50 [ms] | 3,3 | 9,0 | 11,5 | 11,5 | ~11,6 |
| klatka workera p50 / p95 [ms] | 2,8 / 3,8 | 4,3 / 6,0 | 3,1 / 4,8 | 3,3 / 4,7 | 2,8 / 4,2 |
| pierścień: przepełnienia / bez nakładki | 0 / 0 | 0 / 0 | 65 / 13 | 3 / 2 | **0 / 0** |

Faza 0–15 s: skoki 44–50% → 5–8%, drgania NPC 0,55–0,81 → 0,10–0,22 px (p95 1,8–2,4 → 0,08–0,31).
Pacer w A3: wiek 4 (rozkład złożeń: 2 — 11% (spokój), 3 — 21%, 4 — 57%, 5 — 11%), 12 zmian wieku w ~70 s (każda to
jedna klatka powtórzona albo przeskoczona).

## 6. Koszt klatki: strona i worker (profil CPU, headless, bitwa 166 okrętów, ~250 kl/s)

- **Strona — `render()` 1,7 ms/kl** (+ fizyka 0,7 ms/kl przy 1,4 ms/krok w tej fazie): pakowanie migawki 0,58 + 0,07
  (`_packEntity` 0,20 własnego czasu na ~170 encji, `_packBody` 0,10, dysze 0,04, poziom B 0,02), znaczniki krawędzi
  0,19, `Turret2D.syncFrame` 0,18, kopia kanwy gry do pierścienia (`commitOverlay` → `drawImage` całej kanwy) 0,12,
  celownik 0,07, radar 0,07, podpisy planet 0,04; „(program)” 0,55 ms/kl (natywne: kanwa, styl, commit).
  Zrzut użytkownika (U hex 2,07) to cięższa bitwa — pakowanie rośnie z liczbą zmienionych ciał.
- **Worker — `renderPage` ~3,2 ms/kl:** `renderSingle` 1,5 (three: `renderObject` 0,67, przezroczyste 0,43, klatka
  efektów compute 0,37, wiązania 0,20, `writeBuffer` 0,21), `updateHexShips3D` 1,03 (dysze `EngineVfxSystem.update`
  0,56 — w tym `mainExhaust3D.flush` 0,18, `updateEffects` 0,34), lustra (`RenderMirror.apply`) 0,24, modele 3D 0,09.
  W bitwie 331 okrętów klatka workera 3,4–6,6 ms → obraz 3D 150–178 kl/s przy 240 Hz.

## 7. Pole do optymalizacji — ranking

| # | co | zysk | koszt / ryzyko |
|---|---|---|---|
| 1 | **Fizyka poza wątkiem gry** albo praca decyzyjna rozłożona na klatki bez kroku (audyt fizyki § 6) | znika ~60 chybionych klatek / s w walce przy 240 Hz; u użytkownika (krok 6,8 ms) jedyna droga do równego rytmu | duży (worker symulacji) / średni (rozłożenie) |
| 2 | **Render przed fizyką** w `loop()` (fizyka „na zapas” na koniec klatki, do przewidywanego następnego vsync) | wysyłka strony zawsze ~0,1 klatki po vsync → pacer o 1 klatkę niżej (−4 ms przy 240 Hz) | średni: zmienia semantykę interpolacji i chwilę wejścia; razem z pkt 1 |
| 3 | ~~**Klatka workera**~~ — ZROBIONE 2026-10-17 (§ 7.1): p50 2,89 → 2,32 ms w oknie 240 Hz | wiek obrazu śr. 3,78 → 3,46, skoki 9,8 → 2,3% | — |
| 4 | **Tryb pół-odświeżania**: gdy worker nie nadąża za monitorem (bitwa 331: 150–178 kl/s przy 240 Hz), pacer składa co drugi vsync (120 Hz równo) | kroki treści 1 / 2 na przemian → równe 120 kl/s | mały (rozszerzenie pacera) |
| 5 | Nakładki 2D rysowane wprost do kanwy pierścienia (bez `drawImage` całej kanwy gry co klatkę) | −0,1 ms wątku gry, mniej pracy procesu GPU | średni: `ctx` gry używany w wielu miejscach |
| 6 | Pakowanie migawki: pola rzadko zmienne poza poziomem A (flagi, napisy), `Turret2D.syncFrame` | −0,2–0,4 ms wątku gry w dużej bitwie | mały–średni |
| 7 | Interpolacja w trybie `off` (hexShips3D, mostki, modele — `poseOf` z `renderPoses`) | `off` / zapas bez drgań NPC | mały, `off` to dziś tryb zapasowy |
| 8 | PerfHUD: draw calle, GPU, obiekty sceny workera z RET (dziś strona bez urządzenia → „--” / dane strony) | widoczność kosztów workera dla gracza | mały |
| 9 | ~~**GPU przy 5120 × 1440 (Ultra)**~~ — ZROBIONE 2026-10-17 (§ 7.2): passy pełnoekranowe z pętlami po listach | bitwa 192,7 → 216,4 kl/s, wiek 6,43 → 4,51 | — |
| 10 | **Proces GPU** (`CrGpuMain` 96% przy 5120 × 1440): mniej zgłoszeń `Queue::Submit` na klatkę (~22: każdy `renderer.render` / `compute`), mniej pracy rastra kanwy 2D (nakładki, pierścień kanw B2cr w pełnej rozdzielczości) | dziś trzyma rytm w bitwie przy 5120 × 1440 | średni–duży: łączenie zgłoszeń zmienia kolejność `writeBuffer` ↔ passy (three r183) |

### 7.1 Stan pkt 3 — klatka workera (2026-10-17, sesja „Klatka workera renderu pod 240 Hz”)

Cel: p50 klatki workera ≤ 2,3 ms przy 166 okrętach, wiek obrazu 4 → 3 przy 240 Hz. Poprawki (każda bez zmiany obrazu
poza zaznaczonym):

1. **Struga MAIN na GPU** (`src/3d/mainExhaust3D.js`): pula strug to pierścień slotów, rekord strugi (długość /
   szerokość na początku i końcu życia, narodziny, życie, alfa, ziarno, paleta, gradient, właściciel) pisany RAZ przy
   narodzinach (3 atrybuty vec4, wysyłka tylko nowych rekordów — `zbierzZakresy`), wiek, długość, szerokość i alfę
   liczy shader z zegara strug (zawinięty co 256 s; co 32 s martwe sloty dostają zerowe wymiary), położenie i kierunek
   — z bufora storage właścicieli (dysz; wiersz zwolnionej dyszy stoi w miejscu, aż jej strugi dogasną). Dawniej CPU
   co klatkę przeliczał i wysyłał wszystkie ~3,8 tys. strug (pętla `flush` 0,2 ms + ~200 KB `writeBuffer`): `flush`
   0,246 → 0,004 ms/kl, rysunek strug spadł z czołówki kosztów rysunków (0,079 → ~0,02 ms). Pula ma 16 384 sloty —
   dawny sufit 4096 żywych strug odrzucał strugi w największych bitwach, teraz nie (jedyna zmiana obrazu: więcej strug
   przy > 4096 żywych). Rozgrzewka: wpis rejestru `struga MAIN` z licznikiem instancji ≥ 2 — sam `prewarmPass` z
   licznikiem 0 nie trafiał w klucz rysunku (`pipeline sync … MainExhaustJets` w każdym starcie workera — zniknęło).
   Lustro CPU shadera: `MainExhaust3D.jetAt` (test `mainExhaustLod`).
2. **Bufor z przeplotem wysyłany raz na wersję** (`Core3D._dedupeInterleavedUploads`): three r183 pilnuje wersji
   osobno dla każdego atrybutu, więc zmieniony InterleavedBuffer szedł `writeBuffer`-em raz NA ATRYBUT (partia wież: 4×
   rekordy wszystkich wież co klatkę — wieże Tempesta 0,08–0,12 ms na rysunek). Powtórka tej samej wersji pominięta
   (DynamicDrawUsage bez zmian). A/B: `Core3D.interleavedDedupe = false`, licznik `attributeUploadStats.skipped`.
3. **Mapa cienia słońca tylko z rzucającymi** (`passShadowScan`): sam ODBIORCA cienia w passie (partie wież i trzymacze
   z `receiveShadow`) uznawał mapę za potrzebną — w bitwie bez rzucających w kadrze cienia mapa i łapacz rysowały się
   2× na klatkę (~0,07–0,1 ms CPU). Bez rzucających odbiorcom wystarcza PUSTA mapa (raz odświeżona, gdy poprzednia
   miała rzucających). A/B: `Core3D.shadowReceiverSkip = false`. Test `renderPerfGates`.
4. Drobne: baza instancji mostka 3D liczy pozę kadłuba raz na rekord zamiast 3× (`beamLatticePose` /
   `beamLatticeToWorldPosed`, `_frameRecord` 0,12 → 0,04 ms), emitery reflektorów bez trzech obiektów pośrednich na
   lampę na klatkę i bez napisów `road${i}` / `nav${i}` w klatce (`shipLightRuntime.js`).
5. Przy okazji (zgłoszenie użytkownika): **tarcza w trybie TARCZE niewidoczna w trybie worker** — `shield.show` to
   w grze flaga, a pakujący migawki (`raw`) przepuszczał tylko liczby → w workerze `undefined`. Pakowana jako 1 / 0
   (`snapshotPack.js`, test `renderMirror`); w grze: pula tarcz workera po TARCZE `alive 0` → slot gracza `show: 1`.

Sprawdzone i odrzucone: aktualizacja macierzy sceny z pominięciem ukrytych gałęzi (−0,1 ms, ale ukryte trzymacze
rozgrzewki zostają z nieaktualną macierzą świata → inny wyznacznik w kluczu pipeline'u, pułapka 37 → kompilacje
w klatce); pas asteroid w tej bitwie liczy się słusznie (bitwa w populacji NEA); dym rakiet zeruje pulę sam.

Pomiary (RTX 5080, Ryzen 7 7800X3D, `nvidia-smi` 0–1% przed każdym przebiegiem, po kolei z sesją fizyki):

| | baza (543809f5) | poprawki |
|---|---|---|
| headless, `profil-bitwy-flot --sklad 50,20,10,3 --zoom 0.45 --seed 7`, CAŁA klatka workera (lustra → bitmapa), ABAB | p50 2,78 / 2,89, p95 4,81 / 4,13 ms | p50 **2,29 / 2,32**, p95 3,29 / 3,30 ms |
| okno 240 Hz `rytm-bitwy --czas 40`, bitwa > 15 s: klatka workera p50 / p95 | 2,89 / 4,13 ms | **2,32 / 3,18 ms** |
| — wiek obrazu na ekranie śr. (rozkład 3 / 4 / ≥ 5) | 3,78 (42% / 44% / 15%) | **3,46** (61% / 37% / 2%) |
| — skoki treści 3D (powtórzenia / przeskoki) | 9,8% (90 / 279) | **2,3%** (57 / 55) |
| — klatki strony / s | 229,9 | 238,2 |
| bitwa 0–15 s: wiek śr., skoki | 4,36, 4,7% | 4,30, 4,2% |

Obraz: `zrzuty.mjs --sceny bitwa,bitwa-blisko,warp,warp-ladowanie --uuid osobne` (baza `--root` z 543809f5) — 0% pikseli
> 2/255, maks. różnica 1–2/255 (strugi MAIN w kadrze bitwy i warpu); kompilacje pipeline'ów w klatkach workera: baza
1–2 (`MainExhaustJets`, `RocketBody`), poprawki 0. A/B przełączników w tej samej bitwie (`--wkAb`, kanapki 4 s):
pkt 2 + 3 razem −0,13 ms mediany. W pierwszych 15 s
wiek obrazu zostaje ~4 — tam bitmapa spóźnia się przez stronę (klatki z krokiem fizyki wysyłają późno: wywołanie
z krokiem p50 3,4 ms), czyli pkt 1–2 rankingu. Profil workera po poprawkach (headless, pod profilerem): `renderPage`
2,54 ms/kl — `renderSingle` 1,27 (three `render` passów sceny 0,53, klatka efektów 0,33, macierze 0,09, post 0,08),
`updateHexShips3D` 0,68 (dysze `EngineVfxSystem` 0,31), lustra 0,22, modele 0,08.

Narzędzie: `profil-bitwy-flot.mjs --wkAb 'wyrA|wyrB' [--wkAbOkres 4]` — przełączniki w workerze co okno, czasy całej
klatki workera z pierścienia `globalThis.__rwFrameTimes` (render.worker.js), wynik na wariant i kanapki;
`--wkZdarzenia 't@wyrażenie|…'` — kod w workerze w zadanych chwilach (`plik:ścieżka` — kod z pliku, także w
`--zdarzenia` i `--wkAb`).

### 7.2 GPU przy 5120 × 1440, Ultra (2026-10-17, ta sama sesja)

Zgłoszenie użytkownika: RTX 5080 + Ryzen 7 7800X3D, monitor 5120 × 1440 przy 240 Hz, Ultra ze skalą renderu
100% — w dużej bitwie spadki do 80–126 kl/s, w misji 1 do 100–120 kl/s, pełny ekran (F11) zabiera ~100 kl/s.
Przy 7,4 Mpx bufora klatka GPU workera dochodziła do 8,6 ms (budżet 4,17 ms), a passy pełnoekranowe liczyły na
KAŻDYM pikselu pętle po całych listach. Pomiar per pass: znaczniki czasu three z etykietą passa (haki
`inspector.beginRender / beginCompute`), bitwa 166 okrętów, `profil-bitwy-flot --szer 5120 --wys 1440 --query
"renderWorker=1&grafika=ultra"` + `Core3D.setRenderScale(1)`. Poprawki (każda za przełącznikiem A/B Core3D):

1. **Maska słońca — pudła cieni** (`core3d.js` `shadowShaftsMaskNode`, `hullShadowSdf.js`): na CPU pudło cienia
   każdego kadłuba (prostokąt SDF przesunięty od słońca o zasięg cienia, z zapasem na kierunek do słońca w kadrze —
   `hullShadowAabb`) i każdej tarczy ze smugą (`shaftDiscAabb` — lustro warunków pętli tarcz); shader pomija
   kadłub / tarczę poza pudłem przed odczytami. Ta sama klatka i uniformy (rysunki maski do celu roboczego, 20 tarcz,
   24 kadłuby): **1,03 → 0,37 ms** na rysunek (bez pudeł tarcz 0,49, bez pudeł kadłubów 1,00); obraz bit w bit
   (0 różnych pikseli przy 0,76–1,1 mln pikseli w cieniu). A/B: `shadowHullAabb` / `shadowDiscAabb = false`.
2. **Pamięć nieba** (`planet3d.assets.js` — `skyCacheHook`, `planet3d.assets.tsl.js`): mgławica z gwiazdami
   proceduralnymi (`skyStarField` na piksel) liczona raz do celu HalfFloat i czytana z niego, dopóki kadr nie
   przesunie się o ≥ 0,25 px względem pamięci (test na rogach kadru) i nie zmieni się tekstura; zgięcie tła warpa
   i rulon — na piksel jak dawniej. Pass tła **1,47–1,78 → 0,19–0,3 ms** (+ przeliczenie pamięci w 0,5–14% klatek
   bitwy); maks. różnica 0,0029 liniowo, 0 pikseli > 1/255. A/B: `skyCacheEnabled = false`.
3. **Pamięć szumu mgły wojny** (`fog/fogOfWarPost.js` — `FogNoiseCache`): 16 oktaw szumu kafelkowego (chmury,
   zawirowanie, welon, smugi) kernel compute liczy RAZ na 4 × 4 px (rgba16float, kratka w pikselach bufora,
   zaokrąglenie do najbliższej przy zapisie f16), w tym samym passie compute co bloom (bez osobnego zgłoszenia do
   kolejki); teksele głęboko w kręgu wzroku bez szumu (zapas Lipschitza — piksel z mgłą nigdy ich nie czyta);
   „uber” czyta dwuliniowo (wagi dokładne: środki pikseli na 1/8 teksela). Kamery 3D, rulon i zoom < 0,03 px
   bufora / j. — szum na piksel. Koszt mgły **0,37–0,51 → ~0,1–0,2 ms** (w tym kernel 0,06–0,08 ms); maks. różnica
   1/255 na ~2% pikseli (mgła na 23% kadru), 0 pikseli ≥ 2/255. A/B: `fogNoiseCache = false`.
4. **Kafle gorącego powietrza** (`tsl/postGry.js` — `heatHazeTileMask`, `Core3D._updatePostUniforms`): pętla po
   ≤ 24 źródłach szła na każdym pikselu, a w bitwie źródła to dysze ~4 px (0,16% ekranu) — sam przegląd 0,3–0,4 ms
   (źródła przesunięte poza ekran kosztowały tyle samo). CPU zaznacza bity źródeł w kaflach 32 × 32 px (lustro
   warunków pętli: stożek dyszy, koło izotropowe), „uber” czyta słowo kafla i pomija źródła bez bitu. Post
   **0,82–1,01 → 0,42–0,51 ms**, obraz bit w bit. A/B: `heatHazeTiles = false`.

| okno 240 Hz `rytm-bitwy`, 5120 × 1440, Ultra, skala 1, bitwa 166 okrętów > 15 s | stare ścieżki (przełączniki) | nowe |
|---|---|---|
| klatki strony / s | 192,7 | **216,4** |
| wiek obrazu śr. | 6,43 | **4,51** |
| skoki treści 3D | 43,6% | **18,5%** |
| klatka workera p50 / p95 | 4,45 / 6,38 ms | **3,27 / 4,76 ms** |
| złożeń / s | 177 | **212** |
| bitwa 0–15 s: kl/s, wiek, skoki | 196,4, 6,54, 45,7% | 213,1, 5,20, 12,9% |

Czas GPU passów w bitwie po poprawkach (przy 5120 × 1440): świat ortho 0,75 ms, maska słońca 0,37–0,7 (zależy od
kadłubów w kadrze), post 0,42–0,51, bloom 0,33, światło objętościowe pasa 0,28–0,42, tło 0,19–0,3 — razem
render ~2,2–2,8 + compute ~0,7–0,9 ms. **Nadal trzyma proces GPU**: `CrGpuMain` 96% zajęty (`--watki`), z tego
`Queue::Submit` 30% (~1,26 ms na klatkę przy ~22 zgłoszeniach: każdy `renderer.render` / `renderer.compute` three
r183 to osobne zgłoszenie), dekodowanie poleceń WebGPU workera 23%, raster kanwy 2D strony 25%
(`DoRasterCHROMIUM` + flush — nakładki i składanie pierścienia kanw w pełnej rozdzielczości), kompozytor ~5%
(ranking pkt 10). Worker 79%, strona 68%.

Sprawdzone i odrzucone: maska słońca w połowie rozdzielczości (ciemna obwódka na brzegach kadłubów — piksel na
własnym kadłubie pomija samocień tylko w pełnej rozdzielczości); mniej kroków marszu SDF kadłubów (zmiana
półcienia). Narzędzia: `rytm-bitwy --wkStart 'plik:…'` (A/B przełączników w workerze przed bitwą), `--watki N`
i `--watkiKat 'gpu,gpu.dawn,…'` (zajętość wątków, surowy ślad), `profil-bitwy-flot --szer / --wys` i czasy GPU
w oknach A/B (`globalThis.__rwGpuTimes`).

## 8. Decyzje i to, czego nie zrobiono

- **Opóźnienie za płynność:** pacer trzyma wiek obrazu ~4 klatek przy 240 Hz w bitwie (~17 ms od treści do ekranu,
  celownik na kanwie razem z obrazem). W spokoju wiek 2 — bez zmian. Jeśli opóźnienie przeszkadza (celowanie),
  `?rwPacing=0` przywraca dawne zachowanie; ewentualny przełącznik w Opcjach — do decyzji.
- Interpolacja NPC tylko z migawką (worker, inline); `off` bez zmian (pkt 7).
- Niezmierzone w prawdziwym Electronie (te same reguły — `electron/main.js` bez flag limitu klatek, rAF z vsync).
- Nie mierzono przy 144 Hz: przy 6,94 ms na klatkę bitmapa częściej zdąża w 1 klatkę — pacer sam zejdzie do 2–3.

## 9. Pliki i narzędzia

- Nowe: `src/game/renderPoses.js`, `src/render/framePacer.js`, `scripts/webgpu/rytm-bitwy.mjs`; testy
  `tests/renderPoses.test.mjs`, `tests/framePacer.test.mjs`.
- Zmienione: `index.html` (`rwHost.present()` na początku `loop()`, `renderPoses.frame` w `render()`,
  `bridgeRenderPose` / `_snapPoseLerp` / nakładki NPC, `consumeDirty: 'odbior'`), `src/render/renderWorkerHost.js`
  (kolejka i składanie z pacerem, pierścień 6 kanw), `src/render/overlayRing.js` (`acquire(…, queued)`),
  `src/render/snapshotPack.js` (generacja slotu ciała, brud do potwierdzenia odbioru), `src/render/render.worker.js`
  (osłona modułów), `src/render/renderCommands.js` (błąd rekordu pominięty), `src/game/shipBridgeBeams.js`,
  `src/game/hullMounts.js` (ciało bez magazynu), `src/ui/perfHud.js` (prawdziwe kl/s, wiersz workera),
  `scripts/webgpu/fabula-gra.mjs` (bariera z `pacer.age`); strażniki `coldWreckView`, `pirateBaseWorld`,
  `webgpuFundament`, `shaderPrewarm`.
- Pomiar: `node scripts/webgpu/rytm-bitwy.mjs [--sklad 50,20,10,3] [--zoom 0.45] [--czas 40] [--query renderWorker=1]
  [--slad 0] [--out katalog]`; A/B: `--query "renderWorker=1&rwPacing=0&npcLerp=0"`; analiza zapisu: `--analiza katalog`.
  Okno wychodzi na ekran (vsync wymaga widocznego okna). Wyniki tego audytu: `.tmp/rytm/` (poza gitem).
