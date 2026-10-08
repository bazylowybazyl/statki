# RW-02 — prototyp kompozycji renderu w workerze: pomiar i rekomendacja D1 (2026-10-08)

> Zadanie RW-02 z `docs/PLAN-render-worker.md` (§ 3.8 kompozycja, § 3.9 ryzyka, § 4 etap 0): rozstrzygnąć kompozycję
> (decyzja D1: A czy B2) i pokazać na liczbach różnicę z workerem i bez, zanim zapadnie decyzja o przenosinach.
> Pliki (nowe; gry nie dotyka): `dema/render-worker-proto.html`, `dema/render-worker-proto.js`,
> `dema/render-worker-proto.worker.js`, `scripts/webgpu/render-worker-proto.mjs`. Surowe wyniki: `.tmp/rw02/`
> (poza gitem). Maszyna użytkownika: Ryzen 7 7800X3D, RTX 5080, ekran 5120 × 1440 przy 240 Hz.

## 0. W skrócie

- **Wszystko, czego potrzebuje worker, działa** — w headless Chrome 154 i w Electronie 44.5.1 z repo (Chromium 152,
  schemat `app://`, COOP/COEP): WebGPU i `requestAnimationFrame` w dedykowanym workerze (z kanwą w DOM i bez),
  `transferToImageBitmap` z kanwy WebGPU (0,01 ms CPU), `transferFromImageBitmap` na wątku głównym (0,01 ms),
  `SharedArrayBuffer` + `Atomics` (bufor potrójny z § 3.2 planu — 0 rozdartych stron w ~360 oknach pomiaru). Jeden
  `WebGPURenderer` three r183 rysuje na dwie kanwy przez `CanvasTarget`.
- **Z workerem 1,45–2,8 × więcej klatek obrazu** niż dziś przy tych samych S i D (Electron 1,5–2,4 ×; średnio
  w headless: 1080p 57 → 109–121 kl/s, 4K 57 → 89–109 kl/s). Ogranicza worker (D + ~1 ms renderu), wątek główny ma zapas.
- **Koszt wątku głównego:** A ~0,9 ms nakładek na klatkę (Electron 0,64 ms). B2 „z podręcznika” (warstwa nakładek jako
  `OffscreenCanvas` → `transferToImageBitmap`) **+0,5–0,8 ms** — cel 0,2 ms nie spełniony. **B2 na zwykłych kanwach 2D
  w DOM (B2cr): +0,01–0,11 ms, składanie 0,01 ms** — spełniony; w Electronie zadań wątku głównego nawet mniej niż w A.
- **Rozjazd w A:** śr. ~5 px, p95 ~12–13 px, maks. ~38 px przy 1080p; śr. ~10–11 px, p95 ~28 px, maks. 75–90 px przy 4K;
  83–100% par na zrzutach ekranu z różnych klatek. **B2 z warstwą klatki k (B2, B2p, B2cr, B2cp): 0 px, 0 par różnych
  na 1392 zrzutach.**
- **Cena B2:** opóźnienie migawka → obraz +1–2 ms w Electronie (headless 1080p +1,5–4 ms, 4K do +5 ms) — bitmapa czeka,
  aż wątek główny skończy kroki fizyki; p95 odstępu klatek o 1,5–3 ms większe niż w A przy 1080p.
- **Pierścień kanw wymaga reguły** (§ 4): „po kolei” gubi pary; reguła ochrony z 4 ostatnio odebranymi klatkami w `RET`
  i 5 kanwami — 0 zgubionych. Bez limitu klatek (harness) i przy GPU zajętym (4K) nakładek nie może być więcej niż
  klatek 3D — przeciwciśnienie (B2cp) trzyma wtedy 109–191 kl/s, bez niego 65 kl/s i p99 75 ms.
- **Rekomendacja D1: B2 w odmianie B2cr**, z przeciwciśnieniem / „późną publikacją” tam, gdzie wątek główny może
  rysować szybciej, niż worker renderuje (§ 7). Para „3D i 2D z jednej klatki” zostaje, nakładek nie trzeba przenosić.
- **Prawdziwy `Core3D` wstaje w workerze** z samymi podkładkami z zadania (import, init, `ready`, post z bloomem, 60
  klatek, `warmup.flush`, import 21 modułów renderu gry). Pęka: kanwy tekstur przez `document` (wpis rozgrzewki „dysze
  SIDE” — i zostawia pulę w połowie) i `TextureLoader` (`<img>`); podkładka „kanwa = `OffscreenCanvas`” i
  `ImageBitmapLoader` je omijają (§ 8).

## 1. Co działa — możliwości przeglądarki

| sprawdzane | headless Chrome 154.0.8037.58 | Electron 44.5.1 (Chromium 152.0.7977.130), `app://`, COOP/COEP |
|---|---|---|
| WebGPU (`navigator.gpu`, adapter, urządzenie) w dedykowanym workerze | tak (NVIDIA, Blackwell) | tak |
| `OffscreenCanvas` z kontekstem `webgpu`: z `transferControlToOffscreen()` (kanwa w DOM) i samodzielny (`new OffscreenCanvas`) | tak / tak | tak / tak |
| `requestAnimationFrame` w workerze — z kanwą-placeholderem w DOM i bez żadnej | tak / tak | tak / tak |
| `transferToImageBitmap()` z kanwy WebGPU (kontekst three, post na kanwę) | tak, ~0,01 ms CPU | tak, ~0,01 ms CPU |
| `ImageBitmapRenderingContext.transferFromImageBitmap` na wątku głównym | tak, ~0,01 ms | tak, ~0,01 ms |
| `crossOriginIsolated`, `SharedArrayBuffer`, `Atomics` (strona i worker) | tak (nagłówki Vite) | tak (nagłówki `handleAppRequest` z `electron/main.js`) |
| worker modułowy z `new URL(…, import.meta.url)` | tak (Vite dev) | tak (`vite build`, `worker.format = 'es'`) |
| worker z `blob:` pod COEP (zegar pętli) | tak | tak |
| three r183: jeden `WebGPURenderer` (jedno urządzenie) rysuje na dwie kanwy — `CanvasTarget` + `setCanvasTarget` | tak | tak |
| CDP: sesje workerów przez `Target.setAutoAttach` z `flatten: true`, `Runtime.evaluate` w workerze | tak | tak |

Electron uruchamiał skrypt z KOPIĄ `electron/main.js` (tekst pliku z podmienionymi czterema miejscami: katalog `dist` →
build dema, katalog danych → profil tymczasowy zamiast `Dokumenty\HULLFALL`, bez migracji zapisów, adres strony dema;
do tego okno bez fokusu i `disable-features=CalculateNativeWinOcclusion`, żeby zasłonięte okno nie traciło klatek).
Schemat `app://` z tymi samymi uprawnieniami i ten sam `handleAppRequest` z nagłówkami COOP / COEP / CORP — bez zmian.
Plik `electron/main.js` w repo nietknięty; skrypt sprawdza, że podmieniane fragmenty istnieją (inaczej przerywa).

## 2. Prototyp

`dema/render-worker-proto.html` (otwierać przez Vite: `npm run dev` → `/dema/render-worker-proto.html`; panel w prawym
dolnym rogu: wariant, S, D). Trzy pliki:

- **`render-worker-proto.worker.js`** — scena i układ migawki (`Proto3D`, `SNAP`, `RET`) oraz skrypt workera. Scena
  o koszcie zbliżonym do gry: 600 kadłubów (4 obrysy, wytłoczone, `MeshStandardNodeMaterial` z emisją dysz i okien HDR)
  w 64 partiach `InstancedMesh`, 600 płomieni dysz (8 partii, addytywne HDR), 3000 pocisków i 2400 odłamków liczonych
  w wierzchołkach, 40 tarcz, tło z szumem; passy jak `Core3D._runScenePass` (tło → świat → efekty → tarcze → FG) do celu
  HalfFloat MSAA 4 (`composerTarget`), **bloom gry `BloomGryCompute`** (`src/3d/tsl/bloomCompute.js` — wzięty wprost,
  bez DOM, 12 kerneli w jednym `compute`), „uber” z `acesGry` i `linearDoSrgb` (`src/3d/tsl/kolorGry.js`) i
  `hdrBezpieczny` (`postGry.js`). 87 rysunków, 5 passów, ~1 ms CPU renderu; obciążenie GPU strojone pętlą szumu tła
  (`gpu=40` → ~1,5 ms GPU przy 1080p, jak gra w bitwie 166 okrętów: 1,6 ms — `docs/AUDYT-wydajnosc-bitwa-2026-10-07.md`).
  Numer klatki migawki w lewym górnym rogu obrazu 3D: kod paskowy 24 bity (wiersz 0–11 px) i cyfry siedmiosegmentowe —
  rysuje je „uber” po tonowaniu.
- **`render-worker-proto.js`** — wątek główny: pętla jak `loop()` gry (krok 120 Hz × S ms zajętego CPU, klatka obcięta
  do 33 ms, ≤ 10 kroków), kamera po krzywej Lissajous za flotą (do ~1500 j/s przy zoomie 0,21 — ~5 px na klatkę przy
  60 Hz) ze wstrząsem w px ekranu (16 px × H/1080, 11–12 Hz, serie co 1,7 s, jak `cameraRig.js`), migawka w
  `SharedArrayBuffer` (bufor potrójny na `Atomics.exchange` z § 3.2 + blok „węzłów” 40 000 liczb jak NODES gry, suma
  kontrolna wykrywa rozdarte strony — w żadnym pomiarze nie było ani jednej), nakładka 2D (~1650 wieżyczek z atlasu 64
  kątów w gniazdach kadłubów 3D, klamry zaznaczenia, HUD, numer klatki nakładki — kod paskowy w wierszu 14–25 px
  i napis). Historia kamer i 16 statków-sond po numerze klatki → rozjazd w px dowolnej pary (k nakładki, k obrazu 3D).
- **Warianty** (przełączane w biegu, bez przeładowania — ten sam stan GPU i tło dla wszystkich):
  - **0** — jak dziś: scena na wątku głównym (urządzenie strony), `drawImage` kanwy WebGPU na kanwę 2D i nakładki w tym
    samym zadaniu, D też na wątku głównym, bez migawki;
  - **A** — kanwa workera w DOM (`transferControlToOffscreen`) pod przezroczystą kanwą 2D z nakładkami bieżącej migawki;
  - **B1** — `transferToImageBitmap` → `postMessage`; przy przyjściu `transferFromImageBitmap` i nakładki z BIEŻĄCEGO
    stanu;
  - **B2** — warstwa nakładek klatki k rysowana zaraz po migawce k do `OffscreenCanvas` 2D →
    `transferToImageBitmap` (pierścień 12 po k); przy przyjściu klatki k dwa `transferFromImageBitmap` w jednym zadaniu;
  - **B2p** (dodatkowy) — B2 z przeciwciśnieniem: nowa migawka (i warstwa) dopiero, gdy worker odebrał poprzednią;
  - **B2c** (dodatkowy) — B2 bez bitmap nakładek: pierścień 6 zwykłych kanw 2D w DOM (ukrytych), nakładka k rysowana
    wprost do wolnej kanwy, przy przyjściu klatki k — `transferFromImageBitmap` obrazu 3D i przełączenie
    `style.visibility` dwóch kanw;
  - **B2cr** (dodatkowy, po pierwszej siatce) — B2c z regułą ochrony kanw (§ 4): 5 kanw, bez zgubionych par;
  - **B2cp** (dodatkowy) — B2cr z przeciwciśnieniem B2p (nakładka raz na klatkę 3D), 5 kanw;
  - **B3** — nakładka k jako `ImageBitmap` do workera (wysłana przed publikacją migawki k), złożenie na GPU w „uber”
    (`copyExternalImageToTexture` przez `THREE.Texture` z `ImageBitmap`), kanwa workera w DOM.
- **Takt** (`petla=zegar`, domyślnie): sloty co 1000 / 240 ms na wspólnym zegarze — jak vsync ekranu użytkownika
  (240 Hz): praca zaczyna się na granicy slotu, spóźniona klatka zaraz po zwolnieniu wątku, zaległe takty się zlewają.
  Takty wątku głównego przysyła mały worker zegara (rAF w workerze), worker renderu ma te same granice slotów (najwyżej
  jedna klatka na slot). `petla=raf` — `requestAnimationFrame` jak gra (Electron: prawdziwy vsync, worker bez slotów).
  Dlaczego nie rAF / `setTimeout` w headless — § 6.

**Pomiar** (`scripts/webgpu/render-worker-proto.mjs`, pomocniki `wspolne.mjs`): jedna strona na rozdzielczość, siatka
S ∈ {2,5; 3,5; 4,5} ms × D ∈ {4; 8; 12} ms, w każdej komórce wszystkie warianty NA PRZEMIAN (kolejność odwracana co
komórkę), 2 powtórzenia (druga siatka — B2cr i B2cp z A jako odniesieniem — 1 powtórzenie); na wariant: rozgrzewka
1,2 s, okno 3 s (podsumowanie liczy strona z dzienników obu wątków), czas zadań wątku głównego z CDP
(`Performance.getMetrics`), potem 12 zrzutów rogu ekranu (`Page.captureScreenshot` z wycinkiem 160 × 28 px) → odczyt
obu kodów paskowych → para NA EKRANIE (k nakładki, k obrazu 3D) i jej rozjazd w px.
Czasy po obu stronach: `performance.timeOrigin + performance.now()` (od wspólnej bazy). Kontrola tła przed każdą
komórką (obce bezgłowe Chrome / Electron z portem debugowania, skrypty `node scripts/…` / `.tmp/…`): przy obcym
procesie skrypt czeka (w pomiarach z tabel tło było czyste; w biegu próbnym skrypt dwa razy przeczekał cudzy
headless Chrome).

Definicje:
- **obraz 3D [kl/s]** — nowe klatki 3D na ekranie: 0 — klatki wątku głównego; A, B3 — klatki workera (koniec zadania rAF
  = przekazanie do kompozytora); B* — złożenia na wątku głównym;
- **koszt wątku głównego** — JS poza fizyką (pakowanie, nakładki, warstwa B2, w 0 także D + render + kopia) na klatkę
  wątku głównego, z dziennika; oraz czas WSZYSTKICH zadań wątku z CDP minus fizyka (łapie też pracę przeglądarki:
  commit, przesłanie rysunków kanw, obsługę wiadomości), na sekundę i na klatkę obrazu 3D;
- **opóźnienie** — od publikacji migawki k do: „gotowa” (worker skończył render / bitmapę), „złożona” (A, B3: koniec
  zadania rAF workera; B*: koniec składania; 0: koniec klatki wątku głównego);
- **rozjazd** — |pozycja na ekranie statku-sondy wg (kamera, poza) migawki nakładki − to samo wg migawki obrazu 3D|,
  średnio po 16 sondach (i maks.), dla każdej pary pokazanej: A — przy każdej nakładce (z ostatnią klatką workera)
  i przy każdej klatce workera (z ostatnią nakładką); B1, B2* — przy składaniu; B3 — w workerze; 0 — zero z definicji.
  Do tego pary odczytane ze zrzutów ekranu;
- **odstępy** — między kolejnymi klatkami obrazu 3D (jak wyżej), p50 / p95 / p99.

## 3. Wyniki — headless Chrome, takt 240 Hz

Maszyna: Ryzen 7 7800X3D (8 rdzeni / 16 wątków), RTX 5080, Windows 11; Chrome 154 headless z flagami harnessu
(`--disable-gpu-vsync --disable-frame-rate-limit`, ANGLE d3d11), takt 240 Hz z workera zegara (§ 2). Ekran użytkownika:
5120 × 1440 przy 240 Hz — 7,4 Mpx, bliżej „4K” (8,3 Mpx) niż 1080p (2,1 Mpx). Siatka S × D × 7 wariantów, 2 powtórzenia
na przemian (wartości = średnie okien po 3 s; pary ze zrzutów — razem). Pełna tabela z wszystkimi kolumnami na komórkę:
`.tmp/rw02/siatka-zegar240/tabele.md` (poza gitem).

Jak czytać kl/s: wariant 0 to dzisiejsza gra w miniaturze — wątek główny płaci fizykę (120 · S ms/s) i całą klatkę
(D + render ~1 ms + nakładki + kopia), więc kl/s ≈ (1000 − 120·S) / (D + ~2,5) z kwantyzacją do slotów 4,17 ms
(np. S = 3,5, D = 8: 580 / ~10,7 → 51 kl/s zmierzone). W wariantach z workerem obraz ogranicza worker
(D + ~1 ms → przy D = 8 ~110 kl/s, przy D = 12 ~75 kl/s), a wątek główny (fizyka + ~1 ms nakładek) robi 180–240 kl/s.

Tabele (`--tabele`, średnie okien; „B2*” w kolumnie zysku = najlepszy z B2, B2p, B2c):

#### 1920×1080 — obraz 3D [kl/s] (wątek główny [kl/s] w nawiasie dla wariantów z workerem)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2p | B2c | B3 | zysk najlepszego B2* / 0 |
|---|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 100 | 150 (210) | 173 (231) | 171 (226) | 178 (236) | 176 (232) | 179 (217) | 1,78× |
| 2,5 | 8 | 62 | 104 (206) | 109 (240) | 106 (232) | 108 (239) | 108 (235) | 100 (185) | 1,73× |
| 2,5 | 12 | 45 | 73 (206) | 75 (239) | 74 (229) | 74 (240) | 74 (226) | 71 (187) | 1,64× |
| 3,5 | 4 | 80 | 156 (195) | 174 (232) | 171 (220) | 180 (232) | 170 (218) | 166 (198) | 2,23× |
| 3,5 | 8 | 51 | 102 (189) | 108 (239) | 105 (231) | 108 (238) | 108 (231) | 101 (184) | 2,11× |
| 3,5 | 12 | 37 | 73 (193) | 75 (240) | 74 (221) | 75 (237) | 75 (228) | 71 (163) | 2,02× |
| 4,5 | 4 | 64 | 153 (184) | 164 (213) | 177 (196) | 175 (207) | 178 (210) | 131 (167) | 2,79× |
| 4,5 | 8 | 41 | 104 (174) | 109 (232) | 107 (187) | 109 (221) | 108 (212) | 106 (186) | 2,68× |
| 4,5 | 12 | 30 | 73 (171) | 76 (238) | 74 (202) | 75 (233) | 75 (201) | 74 (170) | 2,50× |

#### 1920×1080 — koszt wątku głównego (średnio po komórkach S × D)

| wariant | JS poza fizyką [ms / klatkę wątku gł.] | zadania wątku gł. poza fizyką [ms/s] (CDP) | to samo na klatkę obrazu 3D [ms] | składanie przy przyjściu klatki [ms] | bitmapa warstwy nakładek [ms] |
|---|---|---|---|---|---|
| 0 | 10,14 | 536 | 10,54 | – (p95 –) | 0,000 (p95 0,000) |
| A | 0,92 | 197 | 1,96 | – (p95 –) | 0,000 (p95 0,000) |
| B1 | 0,03 | 133 | 1,14 | 0,907 (p95 1,169) | 0,000 (p95 0,000) |
| B2 | 1,69 | 387 | 3,70 | 0,012 (p95 0,021) | 0,736 (p95 0,927) |
| B2p | 0,90 | 226 | 1,89 | 0,008 (p95 0,016) | 0,746 (p95 0,929) |
| B2c | 0,96 | 237 | 2,22 | 0,009 (p95 0,016) | 0,000 (p95 0,000) |
| B3 | 1,63 | 312 | 3,08 | – (p95 –) | 0,707 (p95 0,905) |

#### 1920×1080 — koszt workera na klatkę (średnio po komórkach; D odjęte)

| wariant | praca 3D bez D [ms] | w tym render (passy, bloom, post) [ms] | transferToImageBitmap śr. / p95 [ms] | postMessage bitmapy [ms] | GPU (znaczniki) [ms] | rysunki |
|---|---|---|---|---|---|---|
| 0 (wątek gł.) | 1,13 + kopia 0,022 | 1,13 | – | – | 1,45 | 87 |
| A | 1,02 | 0,96 | 0,000 / 0,000 | 0,000 | 1,46 | 87 |
| B1 | 1,02 | 0,94 | 0,009 / 0,013 | 0,013 | 1,46 | 87 |
| B2 | 1,10 | 1,02 | 0,009 / 0,014 | 0,012 | 1,46 | 87 |
| B2p | 1,04 | 0,96 | 0,009 / 0,014 | 0,012 | 1,45 | 87 |
| B2c | 1,01 | 0,93 | 0,008 / 0,014 | 0,011 | 1,46 | 87 |
| B3 | 1,04 | 0,98 | 0,000 / 0,000 | 0,000 | 1,47 | 87 |

#### 1920×1080 — opóźnienie: migawka k opublikowana → klatka k złożona, śr. / p95 [ms] (gotowa — w nawiasie)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2p | B2c | B3 |
|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 6,0 / 6,3 (5,0) | 6,9 / 10,3 (6,9) | 7,9 / 11,1 (6,5) | 8,7 / 14,2 (7,1) | 8,8 / 12,5 (7,5) | 8,4 / 12,6 (7,0) | 7,4 / 10,1 (7,4) |
| 2,5 | 8 | 10,1 / 10,5 (9,1) | 11,9 / 16,1 (11,9) | 13,6 / 16,8 (12,1) | 13,7 / 18,2 (12,0) | 16,7 / 19,8 (15,4) | 13,4 / 17,5 (11,8) | 13,0 / 17,9 (13,0) |
| 2,5 | 12 | 14,2 / 14,6 (13,2) | 16,4 / 20,7 (16,4) | 17,4 / 20,4 (16,1) | 18,0 / 22,6 (16,2) | 24,6 / 27,6 (23,7) | 18,0 / 22,4 (16,0) | 16,0 / 25,0 (16,0) |
| 3,5 | 4 | 6,1 / 6,5 (5,1) | 7,1 / 10,6 (7,1) | 8,7 / 11,5 (6,6) | 9,7 / 15,6 (6,8) | 9,7 / 15,0 (7,1) | 9,8 / 15,8 (7,1) | 7,1 / 9,9 (7,1) |
| 3,5 | 8 | 10,1 / 10,5 (9,1) | 12,1 / 16,8 (12,1) | 13,6 / 17,1 (12,0) | 15,1 / 19,9 (12,4) | 17,2 / 21,8 (15,3) | 14,4 / 18,2 (11,9) | 12,9 / 17,8 (12,9) |
| 3,5 | 12 | 14,3 / 14,9 (13,3) | 17,0 / 21,6 (17,0) | 18,4 / 21,6 (16,7) | 19,1 / 25,2 (16,3) | 24,2 / 28,5 (22,7) | 19,0 / 24,4 (16,3) | 17,2 / 25,0 (17,2) |
| 4,5 | 4 | 6,1 / 6,5 (5,1) | 6,7 / 10,1 (6,7) | 9,9 / 15,2 (6,6) | 10,6 / 17,2 (6,4) | 10,5 / 17,0 (6,8) | 10,6 / 16,8 (6,7) | 7,3 / 10,3 (7,3) |
| 4,5 | 8 | 10,1 / 10,6 (9,1) | 12,2 / 16,6 (12,2) | 14,8 / 18,0 (12,3) | 16,7 / 22,0 (12,5) | 17,3 / 22,8 (14,6) | 16,2 / 21,4 (12,4) | 13,2 / 17,1 (13,2) |
| 4,5 | 12 | 14,2 / 14,7 (13,2) | 16,8 / 21,5 (16,8) | 19,2 / 24,1 (17,0) | 21,0 / 26,9 (16,6) | 24,7 / 29,5 (22,4) | 20,0 / 25,9 (16,3) | 17,5 / 23,7 (17,5) |

#### 1920×1080 — rozjazd znacznika 2D względem obiektu 3D tej samej encji [px]

| wariant | z dziennika: śr. / p95 / maks. | D = 4: śr. / p95 | D = 8: śr. / p95 | D = 12: śr. / p95 | pary różne na zrzutach ekranu | rozjazd par ze zrzutów śr. / maks. |
|---|---|---|---|---|---|---|
| 0 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| A | 4,9 / 12,4 / 37,2 | 2,7 / 7,8 | 5,0 / 12,7 | 7,0 / 16,6 | 197/216 (91%) | 5,2 / 30,8 |
| B1 | 4,3 / 10,8 / 27,7 | 2,9 / 7,1 | 4,5 / 11,2 | 5,7 / 13,9 | 216/216 (100%) | 4,7 / 30,9 |
| B2 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| B2p | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| B2c | 0,2 / 1,2 / 37,5 | 0,0 / 0,0 | 0,1 / 0,1 | 0,6 / 3,7 | 9/216 (4%) | 0,4 / 27,8 |
| B3 | 0,1 / 0,0 / 23,6 | 0,1 / 0,0 | 0,1 / 0,0 | 0,2 / 0,1 | 8/216 (4%) | 0,1 / 11,7 |

#### 1920×1080 — odstępy między klatkami obrazu 3D, p50 / p95 / p99 [ms]

| przypadek | 0 | A | B1 | B2 | B2p | B2c | B3 |
|---|---|---|---|---|---|---|---|
| worker wolniejszy (S = 2,5, D = 12) | 22,7 / 23,4 / 23,6 | 13,4 / 15,1 / 16,8 | 13,3 / 15,5 / 15,9 | 14,2 / 17,9 / 19,3 | 13,3 / 17,4 / 17,9 | 13,9 / 18,1 / 20,0 | 13,3 / 17,8 / 20,4 |
| wątek gł. wolniejszy (S = 4,5, D = 4) | 16,2 / 16,8 / 17,1 | 6,2 / 9,9 / 13,2 | 6,3 / 11,1 / 14,1 | 4,1 / 14,0 / 14,9 | 6,2 / 13,8 / 17,6 | 6,4 / 11,6 / 14,2 | 6,6 / 12,4 / 19,8 |
| S = 3,5, D = 8 | 18,4 / 22,2 / 22,8 | 9,3 / 13,0 / 13,8 | 9,2 / 12,6 / 13,8 | 9,1 / 15,6 / 17,4 | 9,2 / 14,5 / 15,4 | 8,6 / 14,6 / 15,8 | 9,3 / 15,4 / 17,7 |
| wszystkie komórki (średnia) | 20,0 / 21,8 / 22,1 | 9,5 / 12,3 / 14,3 | 9,4 / 12,8 / 14,2 | 9,4 / 15,7 / 18,4 | 9,6 / 15,0 / 16,9 | 9,6 / 14,9 / 17,7 | 9,4 / 13,2 / 17,3 |

#### 3840×2160 — obraz 3D [kl/s] (wątek główny [kl/s] w nawiasie dla wariantów z workerem)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2p | B2c | B3 | zysk najlepszego B2* / 0 |
|---|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 99 | 112 (126) | 124 (166) | 136 (174) | 144 (187) | 137 (178) | 134 (136) | 1,45× |
| 2,5 | 8 | 63 | 93 (162) | 102 (212) | 89 (188) | 106 (238) | 94 (207) | 98 (167) | 1,69× |
| 2,5 | 12 | 46 | 72 (176) | 74 (228) | 71 (209) | 75 (239) | 73 (219) | 65 (149) | 1,64× |
| 3,5 | 4 | 81 | 105 (117) | 106 (135) | 140 (167) | 141 (166) | 146 (172) | 116 (147) | 1,80× |
| 3,5 | 8 | 51 | 89 (147) | 100 (208) | 94 (189) | 106 (232) | 99 (200) | 97 (153) | 2,07× |
| 3,5 | 12 | 38 | 71 (155) | 73 (222) | 71 (192) | 75 (235) | 72 (205) | 70 (139) | 1,99× |
| 4,5 | 4 | 64 | 101 (111) | 126 (136) | 135 (144) | 137 (153) | 141 (149) | 111 (142) | 2,18× |
| 4,5 | 8 | 40 | 85 (134) | 92 (184) | 96 (181) | 106 (212) | 99 (192) | 100 (154) | 2,68× |
| 4,5 | 12 | 30 | 70 (140) | 75 (226) | 73 (196) | 75 (228) | 74 (196) | 72 (135) | 2,50× |

#### 3840×2160 — koszt wątku głównego (średnio po komórkach S × D)

| wariant | JS poza fizyką [ms / klatkę wątku gł.] | zadania wątku gł. poza fizyką [ms/s] (CDP) | to samo na klatkę obrazu 3D [ms] | składanie przy przyjściu klatki [ms] | bitmapa warstwy nakładek [ms] |
|---|---|---|---|---|---|
| 0 | 10,10 | 534 | 10,49 | – (p95 –) | 0,000 (p95 0,000) |
| A | 0,94 | 149 | 1,75 | – (p95 –) | 0,000 (p95 0,000) |
| B1 | 0,03 | 109 | 1,14 | 0,925 (p95 1,165) | 0,000 (p95 0,000) |
| B2 | 1,77 | 344 | 3,75 | 0,012 (p95 0,020) | 0,779 (p95 0,971) |
| B2p | 0,95 | 204 | 1,90 | 0,009 (p95 0,016) | 0,766 (p95 0,939) |
| B2c | 0,98 | 207 | 2,18 | 0,010 (p95 0,016) | 0,000 (p95 0,000) |
| B3 | 1,66 | 253 | 2,80 | – (p95 –) | 0,731 (p95 0,949) |

#### 3840×2160 — koszt workera na klatkę (średnio po komórkach; D odjęte)

| wariant | praca 3D bez D [ms] | w tym render (passy, bloom, post) [ms] | transferToImageBitmap śr. / p95 [ms] | postMessage bitmapy [ms] | GPU (znaczniki) [ms] | rysunki |
|---|---|---|---|---|---|---|
| 0 (wątek gł.) | 1,08 + kopia 0,021 | 1,08 | – | – | 5,87 | 87 |
| A | 1,00 | 0,94 | 0,000 / 0,000 | 0,000 | 6,03 | 87 |
| B1 | 0,99 | 0,91 | 0,011 / 0,014 | 0,013 | 6,02 | 87 |
| B2 | 1,03 | 0,95 | 0,014 / 0,040 | 0,015 | 6,29 | 87 |
| B2p | 0,98 | 0,90 | 0,011 / 0,014 | 0,013 | 6,11 | 87 |
| B2c | 1,02 | 0,94 | 0,013 / 0,027 | 0,014 | 6,11 | 87 |
| B3 | 1,02 | 0,96 | 0,000 / 0,000 | 0,000 | 6,55 | 87 |

#### 3840×2160 — opóźnienie: migawka k opublikowana → klatka k złożona, śr. / p95 [ms] (gotowa — w nawiasie)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2p | B2c | B3 |
|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 6,0 / 6,3 (5,0) | 7,8 / 11,7 (7,8) | 10,2 / 22,7 (6,3) | 10,3 / 23,0 (8,2) | 10,1 / 21,8 (8,5) | 10,1 / 21,1 (8,2) | 8,4 / 11,8 (8,4) |
| 2,5 | 8 | 10,0 / 10,4 (9,0) | 11,8 / 17,3 (11,8) | 14,1 / 18,7 (11,9) | 15,0 / 26,6 (13,5) | 16,7 / 19,5 (15,6) | 14,1 / 23,3 (12,9) | 13,6 / 19,2 (13,6) |
| 2,5 | 12 | 14,1 / 14,4 (13,1) | 16,9 / 23,5 (16,9) | 17,5 / 21,9 (15,9) | 18,9 / 26,7 (17,4) | 24,2 / 27,2 (23,3) | 18,4 / 26,2 (16,9) | 17,9 / 27,4 (17,9) |
| 3,5 | 4 | 6,1 / 6,3 (5,0) | 6,9 / 11,1 (6,9) | 12,9 / 34,9 (6,5) | 10,9 / 23,8 (7,9) | 11,3 / 24,5 (8,1) | 10,9 / 22,3 (7,7) | 8,1 / 13,2 (8,1) |
| 3,5 | 8 | 10,1 / 10,5 (9,1) | 12,1 / 17,0 (12,1) | 14,8 / 20,6 (12,1) | 15,6 / 26,9 (13,0) | 16,7 / 21,6 (15,1) | 15,0 / 24,0 (12,4) | 13,2 / 17,8 (13,2) |
| 3,5 | 12 | 14,1 / 14,5 (13,1) | 17,1 / 23,3 (17,1) | 19,0 / 25,8 (16,8) | 19,8 / 28,5 (17,1) | 24,3 / 27,8 (22,7) | 19,6 / 27,2 (16,9) | 18,8 / 25,7 (18,8) |
| 4,5 | 4 | 6,0 / 6,3 (5,1) | 6,8 / 10,5 (6,8) | 13,3 / 29,8 (6,3) | 12,3 / 22,6 (7,0) | 12,6 / 24,4 (7,4) | 12,1 / 22,1 (7,0) | 8,1 / 11,5 (8,1) |
| 4,5 | 8 | 10,2 / 10,6 (9,2) | 12,4 / 16,7 (12,4) | 16,5 / 32,8 (12,2) | 16,6 / 26,2 (12,5) | 17,8 / 24,8 (14,7) | 16,1 / 25,4 (12,3) | 13,3 / 17,3 (13,3) |
| 4,5 | 12 | 14,2 / 14,7 (13,2) | 16,6 / 21,5 (16,6) | 19,7 / 26,2 (17,1) | 20,3 / 29,0 (16,6) | 24,4 / 28,5 (22,1) | 20,4 / 26,9 (16,2) | 18,3 / 24,5 (18,3) |

#### 3840×2160 — rozjazd znacznika 2D względem obiektu 3D tej samej encji [px]

| wariant | z dziennika: śr. / p95 / maks. | D = 4: śr. / p95 | D = 8: śr. / p95 | D = 12: śr. / p95 | pary różne na zrzutach ekranu | rozjazd par ze zrzutów śr. / maks. |
|---|---|---|---|---|---|---|
| 0 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| A | 10,3 / 27,9 / 74,9 | 6,1 / 20,5 | 10,7 / 28,8 | 14,0 / 34,4 | 179/216 (83%) | 9,5 / 48,7 |
| B1 | 10,1 / 24,0 / 65,9 | 8,3 / 21,3 | 9,9 / 23,1 | 12,3 / 27,5 | 216/216 (100%) | 11,7 / 70,6 |
| B2 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| B2p | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/216 (0%) | 0,0 / 0,0 |
| B2c | 0,4 / 2,3 / 45,5 | 0,0 / 0,0 | 0,1 / 0,0 | 1,1 / 6,9 | 9/216 (4%) | 0,4 / 21,5 |
| B3 | 0,2 / 0,3 / 60,3 | 0,1 / 0,0 | 0,2 / 0,0 | 0,4 / 0,8 | 5/216 (2%) | 0,3 / 34,0 |

#### 3840×2160 — odstępy między klatkami obrazu 3D, p50 / p95 / p99 [ms]

| przypadek | 0 | A | B1 | B2 | B2p | B2c | B3 |
|---|---|---|---|---|---|---|---|
| worker wolniejszy (S = 2,5, D = 12) | 22,6 / 23,2 / 23,5 | 13,3 / 16,3 / 19,8 | 13,2 / 16,3 / 19,3 | 13,9 / 20,9 / 24,3 | 13,1 / 17,1 / 18,0 | 13,9 / 18,5 / 21,3 | 13,7 / 24,7 / 30,2 |
| wątek gł. wolniejszy (S = 4,5, D = 4) | 16,1 / 16,5 / 16,7 | 7,2 / 31,4 / 46,0 | 6,5 / 22,6 / 34,8 | 6,5 / 20,9 / 35,5 | 6,5 / 21,5 / 34,4 | 6,5 / 19,9 / 27,9 | 8,7 / 14,5 / 21,9 |
| S = 3,5, D = 8 | 18,4 / 22,2 / 22,6 | 9,5 / 19,6 / 30,8 | 9,2 / 15,5 / 18,6 | 8,7 / 22,7 / 28,2 | 9,0 / 15,2 / 17,0 | 9,0 / 20,0 / 24,6 | 9,3 / 17,2 / 21,6 |
| wszystkie komórki (średnia) | 19,8 / 21,9 / 22,2 | 9,9 / 21,6 / 29,0 | 9,5 / 20,2 / 27,4 | 9,6 / 22,6 / 29,6 | 9,6 / 18,4 / 22,9 | 9,5 / 20,6 / 26,6 | 10,3 / 16,4 / 21,8 |

### 3.1 Co z tego wynika

**Kryterium 1 — kl/s i czas klatki, 0 ↔ worker.** Przy każdym (S, D) worker daje 1,45–2,8 × więcej klatek obrazu niż
dziś (średnio po siatce: 1080p 57 → 110–120 kl/s, 4K 57 → 89–107 kl/s). Zysk rośnie z S, bo w wariancie 0 fizyka
(~430 ms/s przy S = 3,5) i cała klatka dzielą jeden wątek, a z workerem wątek główny ma tylko fizykę i ~1 ms nakładek.
Model z § 1 planu się zgadza: 0 ≈ (1000 − 120·S) / (D + ~2,5 ms), worker ≈ 1000 / (D + ~1 ms) z kwantyzacją do
slotów 4,17 ms. Ograniczeniem z workerem jest sam worker (przy D = 12 wszystkie warianty ~73–76 kl/s) — wątek główny
ma zapas (170–240 kl/s). **A jest najwolniejszym wariantem z workerem**: −7% przy 1080p i −15% przy 4K wobec B2c
(średnie po siatce), przy D = 4 do −28% (4K: 101–112 vs 137–146 kl/s) — rAF workera z kanwą-placeholderem idzie
w rytmie kompozytora, a przy 4K kompozytor i proces GPU są zajęte (niżej).

**Kryterium 2 — koszt wątku głównego.** Nakładki kosztują we wszystkich wariantach to samo (~0,9 ms JS na klatkę wątku
głównego — 1650 wieżyczek z atlasu, klamry, HUD). Różnice:
- **B2 z bitmapami nakładek: +0,74–0,78 ms na klatkę** samego `transferToImageBitmap` warstwy `OffscreenCanvas` 2D
  (p95 ~0,93–0,97 ms; tyle samo przy 1080p i 4K), razem z resztą +190–200 ms/s zadań wątku głównego wobec A. Cel
  „≤ 0,2 ms dodatkowo” — **nie**. To samo płaci B3 (bitmapa nakładki do workera) i B2p (tylko rzadziej).
- **B2c (zwykłe kanwy 2D w DOM): +0,04 ms JS na klatkę** wobec A, +40–60 ms/s zadań wątku (CDP — łapie też commit
  i przesłanie rysunków kanw), +0,25–0,4 ms na klatkę obrazu 3D. Składanie przy przyjściu klatki (dwa przełączenia
  `visibility` + `transferFromImageBitmap`): **0,009–0,010 ms** (p95 0,016). Cel — **tak**.
- B1 (nakładki dopiero przy przyjściu bitmapy): ~0,9 ms składania = całe rysowanie nakładek w zadaniu wiadomości.

**Kryterium 3 — koszt workera.** `transferToImageBitmap` z kanwy WebGPU: **0,009 ms** przy 1080p, 0,011–0,014 ms przy
4K (p95 0,014–0,040), `postMessage` bitmapy z przekazaniem: 0,012–0,015 ms. Czas GPU (znaczniki three) bez różnicy
między A i B (1080p 1,46 ms, 4K 6,0–6,3 ms). Zwykła prezentacja (A) nie ma kosztu CPU w workerze, ale ma koszt
w klatkach (wyżej): przy 4K A traci 15% klatek względem B.

**Kryterium 4 — opóźnienie** (publikacja migawki k → klatka k złożona). A: render workera + ~0; B2 / B2c: **+1,5–4,1 ms
przy 1080p i +1,5–5,3 ms przy 4K** względem A — bitmapa czeka w kolejce wiadomości, aż wątek główny skończy zadanie
(kroki fizyki), więc kara rośnie z S (S = 2,5: +1,5–2,4; S = 4,5: +3,3–5,3 ms). B2p: +5–8 ms przy D = 8–12 (migawka czeka
na odbiór całą klatkę workera). Wariant 0 ma najmniejsze opóźnienie od migawki (wszystko w jednym zadaniu), ale
przy 2× rzadszych klatkach — od zdarzenia do ekranu dziś też czeka się na następną klatkę (20 ms przy 50 kl/s).

**Kryterium 5 — rozjazd znacznika 2D względem obiektu 3D tej samej encji.** A: **śr. 4,9 px, p95 12,4 px, maks.
37 px przy 1080p; śr. 10,3 px, p95 27,9 px, maks. 75 px przy 4K**; rośnie z D (dłuższa klatka workera = starsza para:
1080p D = 4 / 8 / 12 → p95 7,8 / 12,7 / 16,6 px). Na zrzutach ekranu 83–91% par w A pochodzi z RÓŻNYCH klatek (kod
paskowy obrazu 3D ≠ kod nakładki), rozjazd par ze zrzutów — średnio 5 / 9,5 px, maks. 31 / 49 px. B1 tak samo
(100% par różnych). **B2, B2p: 0 px, 0 par różnych na 216 zrzutach przy każdej rozdzielczości.** B2c: 4% par
zgubionych przez za mały pierścień „po kolei” (6 kanw; 406 klatek bez pary w 36 oknach) — naprawia reguła ochrony
(§ 4). B3: 2–4% par różnych (bitmapa nakładki przychodzi do workera po migawce — worker bierze wtedy poprzednią).

**Kryterium 6 — równość klatek.** Przy 1080p A ma najrówniejsze klatki (p95 odstępu 12,3 ms przy p50 9,5 ms), B2 /
B2c +2,5–3,5 ms na p95 (14,9–15,7 ms) — składanie czeka na wątek główny. „Worker wolniejszy od wątku głównego”
(S = 2,5, D = 12): wszystkie z workerem 13–14 ms p50 i 15–18 ms p95 (wobec 22,7 / 23,4 ms w 0). „Wątek główny
wolniejszy” (S = 4,5, D = 4): A p95 9,9 ms, B2c 11,6, B2 14,0. **Przy 4K kolejność się odwraca**: GPU sceny 6 ms
na klatkę plus rasteryzacja pełnoekranowej kanwy 2D przy KAŻDEJ klatce wątku głównego zapycha proces GPU — A ma
p95 21,6 ms i p99 29 ms średnio (S = 4,5, D = 4: 31 / 46 ms), B2c 20,6 / 26,6, B2p 18,4 / 22,9, B3 16,4 / 21,8.
Najlepiej wypadają warianty, które rasteryzują nakładkę raz na klatkę 3D (B2p, B3) — stąd wariant B2cp w § 4.

## 4. Pierścień kanw B2: reguła ochrony (B2cr) i przeciwciśnienie (B2cp)

Pierwsza siatka pokazała, że B2 na zwykłych kanwach (B2c) ma koszt A, ale pierścień „po kolei” z 6 kanw gubi pary:
wątek główny publikuje ~3× częściej, niż worker składa, i nadpisuje kanwę, na którą klatka jeszcze czeka (406
klatek bez pary w 36 oknach). Reguła — w trzech podejściach:

1. chronić tylko kanwę pokazaną i klatkę „odebraną” (`RET.lastConsumed`) — **za mało**: worker zdążył wziąć następną
   migawkę, a bitmapa poprzedniej czeka jeszcze w kolejce wiadomości wątku głównego (61 zgubionych w jednym oknie);
2. chronić cały przedział (ostatnio złożona, odebrana] — **za dużo**: worker pomija migawki (bierze najnowszą), więc
   chronione były klatki, których nigdy nie wyrenderuje, i pierścień się zapychał (156–193 przydziały bez wolnej kanwy);
3. **działa (B2cr):** worker zapisuje w `RET` 4 ostatnio odebrane numery klatek (pierścień w SAB); nietykalne są:
   kanwa pokazana, kanwy klatek z tej listy jeszcze nie złożone (bitmapa w drodze) i kanwa ostatnio opublikowanej
   migawki (worker może ją właśnie brać). Nowa nakładka idzie do najstarszej z pozostałych. Przy 5 kanwach: **0
   zgubionych par w 36 oknach** (1080p i 4K, cała siatka S × D), najwięcej 4 kanwy chronione naraz.

B2cp = B2cr + przeciwciśnienie B2p (nowa migawka i nakładka dopiero, gdy worker odebrał poprzednią): nakładka
rasteryzuje się raz na klatkę 3D zamiast przy każdej klatce wątku głównego. Też 5 kanw (przy 4 — 6 zgubionych klatek
przy S = 4,5, D = 4, wszystkie 4 chronione).

Druga siatka (A jako odniesienie w tym samym przebiegu, 1 powtórzenie, średnie po 9 komórkach):

| | 1080p A | 1080p B2cr | 1080p B2cp | 4K A | 4K B2cr | 4K B2cp |
|---|---|---|---|---|---|---|
| obraz 3D [kl/s] | 109 | 120 | 121 | 100 | 105 | 109 |
| JS wątku gł. poza fizyką [ms/kl] | 0,89 | 0,95 | 0,51 | 0,87 | 0,98 | 0,51 |
| zadania wątku gł. poza fizyką [ms/s] (CDP) | 215 | 238 | 141 | 187 | 207 | 126 |
| składanie [ms] (p95) | – | 0,010 (0,015) | 0,011 (0,018) | – | 0,011 (0,018) | 0,011 (0,016) |
| opóźnienie złożona [ms] | 12,0 | 14,4 | 16,9 | 12,4 | 15,4 | 17,6 |
| rozjazd śr. / p95 / maks. [px] | 5,2 / 12,7 / 36,5 | 0 / 0 / 0 | 0 / 0 / 0 | 11,2 / 27,5 / 90,2 | 0 / 0 / 0 | 0 / 0 / 0 |
| pary różne na zrzutach | 96/108 | 0/108 | 0/108 | 94/108 | 0/108 | 0/108 |
| odstępy p50 / p95 / p99 [ms] | 9,7 / 12,6 / 13,6 | 9,7 / 14,2 / 17,5 | 9,6 / 14,2 / 15,7 | 10,4 / 14,3 / 15,8 | 9,5 / 19,5 / 24,8 | 9,5 / 17,0 / 20,3 |
| przerwa workera między klatkami śr. / p95 [ms] | 1,22 / 3,63 | 0,40 / 1,71 | 0,35 / 1,50 | 1,93 / 5,35 | 1,30 / 5,94 | 0,91 / 4,09 |

- **B2cr = koszt A** (+0,06–0,11 ms JS na klatkę, +20 ms/s zadań wątku), para dokładna, opóźnienie +2,4–3,0 ms.
- **B2cp jest najtańszy dla wątku głównego** (nakładka ~raz na klatkę 3D: 0,51 ms/kl, −33% zadań wątku względem A)
  i najrówniejszy z B przy 4K, ale ma największe opóźnienie (+5 ms średnio, +6–8 ms przy D = 12 — migawka czeka na
  odbiór całą klatkę workera).
- „Przerwa workera” (koniec klatki → start następnej) potwierdza mechanizm niższych kl/s w A: rAF workera z kanwą
  w DOM czeka dłużej na następną ramkę kompozytora (1,2 vs 0,4 ms przy 1080p).
- **Zmienność A przy 4K między przebiegami:** w pierwszej siatce A przy 4K miał p95 odstępu 21,6 ms i 89 kl/s,
  w drugiej 14,3 ms i 100 kl/s (przy czystym tle w obu, ten sam kod A). B2cr / B2c trzymały 19,5–20,6 ms w obu.
  Nie rozstrzygnąłem przyczyny (w pierwszej siatce A sąsiadował z wariantami trzymającymi więcej pamięci GPU —
  pierścień 12 bitmap 4K w B2, kanwa WebGPU wariantu 0); przy 4K wnioski o równości klatek A traktować ostrożnie.
- **Bez limitu klatek** (headless bez taktu 240 Hz, jak `profil-bitwy-flot.mjs`; S = 3,5, D = 4 / 8, 1080p): wątek
  główny w A i B2cr kręci się ~350–380 kl/s i rysuje tyle nakładek. A: 131 / 101 kl/s obrazu, B2cr: 161 / **65 kl/s
  z p99 odstępu 75 ms** (rysunek do ukrytych kanw zapycha proces GPU), B2cp: **191 / 109 kl/s**, p95 8,6 / 13,8 ms.
  Przeciwciśnienie nie jest więc tylko optymalizacją: bez limitu klatek (harness) B2 bez niego się sypie.

## 5. Electron 44 z repo — 1080p, prawdziwy vsync 240 Hz

Okno 1920 × 1080 (treść), DPR 1, `petla=raf` — pętla wątku głównego na `requestAnimationFrame` jak gra, worker bez
slotów (jego rAF idzie z odświeżaniem ekranu). S ∈ {2,5; 4,5} × D ∈ {4; 12}, 7 wariantów na przemian, okna po 3 s,
8 zrzutów rogu na wariant. 4K w Electronie nie mierzone (ekran użytkownika ma 1440 px wysokości).

Wnioski — te same co w headless, z mniejszą karą B2:
- worker 1,5–2,4 × więcej klatek obrazu niż dziś (0: 118 / 50 / 77 / 32 kl/s → B2cr 179 / 78 / 164 / 78);
- **B2cr: koszt wątku głównego jak A** (0,65 vs 0,64 ms JS na klatkę), a zadań wątku poza fizyką mniej: 185 vs
  290 ms/s (prawdopodobnie commit widocznej kanwy 2D przy każdej klatce wątku głównego w A; w B2cr widoczna kanwa
  zmienia się tylko przy złożeniu); B2 z bitmapami +0,6 ms;
- opóźnienie B2cr względem A **+1,0–2,0 ms**; B2cp +7 ms przy D = 12;
- rozjazd A: śr. 4,8 px, p95 12,8 px, maks. 38,7 px, **32 / 32 pary na zrzutach z różnych klatek**; B2, B2cr, B2cp:
  0 px, 0 / 32;
- odstępy: A p95 10,7 ms (średnio), B2cr 13,0, B2cp 12,6, B3 10,8; przy „wątek gł. wolniejszy” A 8,2, B2cr 11,4,
  B2cp 8,6.

#### 1920×1080 — obraz 3D [kl/s] (wątek główny [kl/s] w nawiasie dla wariantów z workerem)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2cr | B2cp | B3 | zysk najlepszego B2* / 0 |
|---|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 118 | 158 (240) | 178 (240) | 180 (240) | 179 (240) | 156 (240) | 160 (240) | 1,53× |
| 2,5 | 12 | 50 | 77 (240) | 79 (240) | 78 (240) | 78 (240) | 78 (239) | 77 (237) | 1,58× |
| 4,5 | 4 | 77 | 157 (239) | 125 (240) | 174 (233) | 164 (238) | 166 (240) | 146 (232) | 2,27× |
| 4,5 | 12 | 32 | 77 (239) | 77 (240) | 78 (239) | 78 (239) | 79 (240) | 77 (231) | 2,44× |

#### 1920×1080 — koszt wątku głównego (średnio po komórkach S × D)

| wariant | JS poza fizyką [ms / klatkę wątku gł.] | zadania wątku gł. poza fizyką [ms/s] (CDP) | to samo na klatkę obrazu 3D [ms] | składanie przy przyjściu klatki [ms] | bitmapa warstwy nakładek [ms] |
|---|---|---|---|---|---|
| 0 | 9,30 | 573 | 9,97 | – (p95 –) | 0,000 (p95 0,000) |
| A | 0,64 | 290 | 2,80 | – (p95 –) | 0,000 (p95 0,000) |
| B1 | 0,03 | 94 | 0,85 | 0,592 (p95 0,866) | 0,000 (p95 0,000) |
| B2 | 1,24 | 319 | 2,94 | 0,010 (p95 0,015) | 0,540 (p95 0,804) |
| B2cr | 0,65 | 185 | 1,70 | 0,007 (p95 0,011) | 0,000 (p95 0,000) |
| B2cp | 0,32 | 101 | 0,87 | 0,007 (p95 0,011) | 0,000 (p95 0,000) |
| B3 | 1,21 | 300 | 2,92 | – (p95 –) | 0,530 (p95 0,761) |

#### 1920×1080 — koszt workera na klatkę (średnio po komórkach; D odjęte)

| wariant | praca 3D bez D [ms] | w tym render (passy, bloom, post) [ms] | transferToImageBitmap śr. / p95 [ms] | postMessage bitmapy [ms] | GPU (znaczniki) [ms] | rysunki |
|---|---|---|---|---|---|---|
| 0 (wątek gł.) | 0,70 + kopia 0,016 | 0,70 | – | – | 1,47 | 87 |
| A | 0,73 | 0,69 | 0,000 / 0,000 | 0,000 | 1,41 | 87 |
| B1 | 0,72 | 0,66 | 0,006 / 0,010 | 0,010 | 1,46 | 87 |
| B2 | 0,72 | 0,66 | 0,006 / 0,010 | 0,009 | 1,43 | 87 |
| B2cr | 0,73 | 0,67 | 0,006 / 0,010 | 0,009 | 1,44 | 87 |
| B2cp | 0,69 | 0,63 | 0,006 / 0,010 | 0,009 | 1,42 | 87 |
| B3 | 0,75 | 0,70 | 0,000 / 0,000 | 0,000 | 1,45 | 87 |

#### 1920×1080 — opóźnienie: migawka k opublikowana → klatka k złożona, śr. / p95 [ms] (gotowa — w nawiasie)

| S [ms] | D [ms] | 0 | A | B1 | B2 | B2cr | B2cp | B3 |
|---|---|---|---|---|---|---|---|---|
| 2,5 | 4 | 5,3 / 5,7 (4,7) | 7,6 / 9,8 (7,6) | 8,7 / 10,3 (7,1) | 9,0 / 10,2 (7,2) | 9,0 / 10,2 (7,2) | 9,4 / 9,7 (7,3) | 7,1 / 9,0 (7,1) |
| 2,5 | 12 | 13,3 / 13,7 (12,7) | 15,6 / 19,1 (15,6) | 16,5 / 19,7 (15,5) | 16,4 / 19,0 (15,5) | 16,6 / 19,1 (15,7) | 23,2 / 26,2 (22,5) | 15,2 / 19,8 (15,2) |
| 4,5 | 4 | 5,3 / 5,6 (4,7) | 8,0 / 11,7 (8,0) | 8,4 / 9,4 (6,1) | 9,1 / 10,9 (6,7) | 9,9 / 15,5 (6,7) | 9,4 / 10,1 (7,1) | 7,6 / 11,5 (7,6) |
| 4,5 | 12 | 13,4 / 13,9 (12,8) | 15,8 / 19,4 (15,8) | 18,6 / 24,7 (16,8) | 17,9 / 24,2 (15,7) | 17,8 / 19,6 (15,7) | 23,0 / 26,7 (21,2) | 16,5 / 21,4 (16,5) |

#### 1920×1080 — rozjazd znacznika 2D względem obiektu 3D tej samej encji [px]

| wariant | z dziennika: śr. / p95 / maks. | D = 4: śr. / p95 | D = 12: śr. / p95 | pary różne na zrzutach ekranu | rozjazd par ze zrzutów śr. / maks. |
|---|---|---|---|---|---|
| 0 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/32 (0%) | 0,0 / 0,0 |
| A | 4,8 / 12,8 / 38,7 | 2,8 / 8,2 | 6,9 / 17,3 | 32/32 (100%) | 5,4 / 16,0 |
| B1 | 4,3 / 10,1 / 25,3 | 2,7 / 6,8 | 6,0 / 13,4 | 32/32 (100%) | 3,4 / 14,3 |
| B2 | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/32 (0%) | 0,0 / 0,0 |
| B2cr | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/32 (0%) | 0,0 / 0,0 |
| B2cp | 0,0 / 0,0 / 0,0 | 0,0 / 0,0 | 0,0 / 0,0 | 0/32 (0%) | 0,0 / 0,0 |
| B3 | 0,1 / 0,6 / 18,0 | 0,2 / 1,2 | 0,0 / 0,0 | 0/32 (0%) | 0,0 / 0,0 |

#### 1920×1080 — odstępy między klatkami obrazu 3D, p50 / p95 / p99 [ms]

| przypadek | 0 | A | B1 | B2 | B2cr | B2cp | B3 |
|---|---|---|---|---|---|---|---|
| worker wolniejszy (S = 2,5, D = 12) | 19,2 / 22,0 / 22,4 | 12,8 / 13,4 / 14,0 | 12,7 / 14,6 / 15,3 | 12,9 / 15,3 / 16,6 | 13,0 / 15,4 / 16,5 | 12,7 / 15,9 / 16,3 | 12,8 / 13,3 / 13,9 |
| wątek gł. wolniejszy (S = 4,5, D = 4) | 14,8 / 15,3 / 16,4 | 7,2 / 8,2 / 8,5 | 8,3 / 8,8 / 9,0 | 7,1 / 10,4 / 10,9 | 6,2 / 11,4 / 12,1 | 8,1 / 8,6 / 9,1 | 7,6 / 8,4 / 8,6 |
| wszystkie komórki (średnia) | 18,6 / 19,8 / 20,8 | 10,0 / 10,7 / 11,2 | 10,0 / 12,1 / 12,5 | 10,2 / 12,7 / 13,5 | 9,9 / 13,0 / 13,7 | 10,8 / 12,6 / 13,0 | 10,0 / 10,8 / 11,2 |

## 6. Pułapki pomiaru w headless Chrome (dla RW-44 i każdego harnessu workera)

1. **rAF wątku głównego bez zmian na ekranie przychodzi co ~20 ms** (`--disable-frame-rate-limit`): pętla, która
   w danej klatce nic nie rysuje w DOM (B2 rysuje do `OffscreenCanvas`, emulacja limitu przez pomijanie klatek), dostaje
   rAF co ~20 ms — B2 wychodził 80 kl/s zamiast 200+. Dlatego takt pomiaru idzie z workera zegara.
2. **`setTimeout` trafia w takt 15,6 ms zegara Windows** — przestoje pętli 16 / 32 / 48 / 62 ms (wielokrotności 15,6),
   przy bezczynnym wątku. Nie używać `setTimeout` do taktowania.
3. **Bez limitu klatek wątek główny zalewa proces GPU nakładkami.** Pętla na rAF bez limitu rysuje nakładkę 500+ razy na
   sekundę; rasteryzacja kanwy 2D (1650 `drawImage`) idzie przez ten sam proces GPU co komendy WebGPU workera —
   worker w A spadał do ~96 kl/s (bez wieżyczek w nakładce: 549 kl/s, ta sama scena na wątku głównym: 346 kl/s).
   Przy takcie 240 Hz efekt znika w A, ale nie w B2cr (§ 4: 65 kl/s, p99 75 ms bez limitu). Wniosek do gry: nakładki
   (i każda praca rysunkowa wątku głównego) MUSZĄ mieć limit klatek albo przeciwciśnienie (vsync w Electronie daje
   limit; harness headless — nie).
4. **Cudzy pomiar w tle zmienia wynik A najbardziej** — w pierwszych przebiegach (przed kontrolą tła) A tracił czas
   symulacji (91 kroków fizyki na sekundę zamiast 120, migawki starsze o 16 ms przy odbiorze), potem przy czystej
   maszynie ani razu. Prawdopodobnie cudzy Chrome z WebGPU w tym samym czasie (skrypt później dwa razy go złapał).
5. Zrzut CDP z wycinkiem (`clip`) widzi to, co kompozytor złożył z warstw w chwili zrzutu — działa także z kanwą workera
   (A, B3): to jedyny sposób zobaczenia par A „z zewnątrz”.
6. `renderer.info.frame` three w workerze rośnie z rAF workera (`Animation`) — znaczniki czasu GPU (`trackTimestamp`)
   trzeba rozwiązywać po próbkowanej klatce (`resolveTimestampsAsync('render' | 'compute')`), co 16. klatkę, jedno
   rozwiązanie w locie. `onSubmittedWorkDone` jako miara GPU w workerze kłamie: obietnica czeka na wolny wątek workera
   (zajęty przez D) — 10–15 ms przy GPU ~1,5 ms.

## 7. Rekomendacja D1: B2 w odmianie B2cr (z przeciwciśnieniem B2cp tam, gdzie GPU jest zajęte), nie A

| kryterium (§ 3.8) | A — kanwa workera w DOM | B2cr — bitmapa 3D + pierścień 5 kanw 2D z regułą ochrony |
|---|---|---|
| 1. koszt wątku głównego | ~0,9 ms JS nakładek na klatkę (Electron 0,64) | **+0,01–0,11 ms JS na klatkę, składanie 0,007–0,011 ms** (cel ≤ 0,2 ms — spełniony); w Electronie zadań wątku mniej niż w A (185 vs 290 ms/s). B2 z bitmapami nakładek: +0,6–0,8 ms — nie |
| 2. koszt workera | prezentacja bez kosztu CPU, ale rAF workera z kanwą w DOM czeka na kompozytor: −7…−9% klatek przy 1080p, −5…−15% przy 4K | `transferToImageBitmap` 0,006–0,014 ms + `postMessage` 0,01 ms; GPU bez zmian |
| 3. opóźnienie (migawka → złożenie) | najmniejsze | **+1,0–2,0 ms w Electronie, +1,5–4 ms headless 1080p, do +5,3 ms przy 4K** (bitmapa czeka na koniec kroków fizyki — rośnie z S) |
| 4. rozjazd 2D ↔ 3D | **śr. ~5 px, p95 ~12–13 px, maks. ~37–39 px przy 1080p; śr. ~10–11 px, p95 ~28 px, maks. 75–90 px przy 4K**; 83–100% par na zrzutach z różnych klatek | **0 px, 0 par różnych** na 496 zrzutach B2cr / B2cp (1392 ze wszystkimi odmianami B2 z warstwą klatki k: B2, B2p, B2cr, B2cp) |
| 5. równość klatek | najrówniejsza przy 1080p (p95 10,7 ms Electron, 12,3–12,6 headless); przy 4K zmienna między przebiegami (p95 14–22 ms) | p95 +1,5–3 ms przy 1080p (13,0 Electron, 14,2–14,9 headless); przy 4K 19,5–20,6 ms (B2cp 17,0–18,4) |
| 6. kl/s | ogranicza worker (D + ~1 ms) | jak A albo nieco więcej |
| 7. zakres przeróbek nakładek | wieżyczki 2D (domyślny tryb broni) i myśliwce do workera (D5, D6), pierścień kamer dla ramek; i tak zostaje rozjazd tego, czego nie da się przenieść (skan X, cele, zaznaczenie RTS — ruch encji, nie tylko kamery) | nakładki rysowane jak dziś, tylko do kanwy z pierścienia; rysunki zależne od kursora przy składaniu; stan nakładek z klatki k (i tak potrzebne — RW-26, RW-21) |

Uzasadnienie z liczb:

1. **Rozjazd A jest za duży, żeby go zostawić.** Wieżyczka 2D ma przy domyślnym zoomie 5–20 px; w A zjeżdża z kadłuba
   średnio o ~5 px, w 5% klatek o ≥ 12–13 px, w szczycie wstrząsu o ~38 px (przy 4K dwa razy tyle), a 9 na 10 klatek
   na ekranie składa się z warstw różnych migawek. A = przeniesienie wieżyczek i myśliwców do workera i pierścień kamer
   dla ramek — dokładnie ta praca, której B2 nie wymaga.
2. **B2 spełnia kryterium kosztu tylko bez bitmap nakładek.** `OffscreenCanvas` 2D → `transferToImageBitmap` kosztuje
   wątek główny 0,5–0,8 ms na klatkę, więc B2 „z podręcznika” z § 3.8 przekracza cel 3–4×. Zwykłe kanwy 2D w DOM
   rysowane wprost, z przełączaniem `style.visibility` w tym samym zadaniu co `transferFromImageBitmap`, dają parę
   klatka ↔ nakładki tak samo dokładnie za ~+0,05 ms — pod warunkiem reguły pierścienia (§ 4).
3. **Cena B2: kilka milisekund opóźnienia i trochę mniej równe klatki.** Klatka z workera czeka na wolny wątek główny.
   W Electronie przy 240 Hz to +1–2 ms (< pół klatki ekranu). Do zmniejszenia w grze (osobno, nie warunek D1): oddanie
   wątku między krokami fizyki (krok jako osobne zadanie albo `scheduler.yield()`), żeby wiadomość z bitmapą weszła
   wcześniej.
4. **Zysk z workera jest ten sam w A i B2.** Liczba klatek obrazu zależy od kosztu workera (D + render), nie od
   kompozycji; A bywa nawet wolniejszy (rAF z kanwą-placeholderem).

**Jak zbudować B2 w grze (RW-42 / RW-43):**
- **reguła pierścienia (B2cr):** worker zapisuje w `RET` ostatnio odebrane numery klatek (pierścień 4 × Int32);
  nietykalne: kanwa pokazana, kanwy odebranych a jeszcze nie złożonych klatek, kanwa ostatnio opublikowanej migawki;
  nowa nakładka do najstarszej z pozostałych. **5 kanw na widok** (najwięcej 4 chronione naraz w całej siatce):
  5 × 8 MB przy 1080p, 5 × 33 MB przy 4K (+ zasoby kanw w procesie GPU);
- **nie rysować więcej nakładek, niż worker zrobi klatek**: bez limitu klatek (harness headless) B2cr się sypie
  (p99 odstępu 75 ms), a przy 4K każda zbędna nakładka zabiera GPU klatkom 3D. Na start limit vsync (Electron) +
  przeciwciśnienie B2cp dla harnessu; lepiej — „późna publikacja”: migawka i nakładka tuż przed spodziewanym odbiorem
  przez worker (z czasu jego klatki), co łączy jedną nakładkę na klatkę 3D (B2cp) z małym opóźnieniem (B2cr);
- składanie w obsłudze wiadomości z bitmapą: `transferFromImageBitmap` + przełączenie dwóch kanw — 0,01 ms;
- rysunki zależne od kursora (celownik, koło trybów, menu PPM, prostokąt zaznaczenia) — na osobnej kanwie, rysowane
  przy składaniu z bieżącą myszą (§ 3.8 B2 p. 2);
- podzielony ekran: dwa pierścienie albo jedna bitmapa z obu widoków (worker renderuje oba w jednej klatce).

## 8. Prawdziwy Core3D w workerze — co wstaje, co pęka

Próba: `dema/render-worker-proto.html?core3d=1` (skrypt: `--core3d 1`), w workerze tylko podkładki z zadania —
`globalThis.window = globalThis`, `innerWidth` / `innerHeight` / `devicePixelRatio` z wiadomości, `requestIdleCallback`
→ `setTimeout`, kanwa (`OffscreenCanvas` z `transferControlToOffscreen`) podana w `Core3D.init`. Headless Chrome 154,
1080p.

| krok | wynik |
|---|---|
| `import('src/3d/core3d.js')` (cały graf: post, bloom compute, siatka świateł, rozgrzewka, rulon, mgła, maska słońca) | **tak**, 0,27–0,30 s |
| `Core3D.init(offscreenCanvas)` — scena, kamery, cele | **tak**, 3 ms |
| `Core3D.ready` — adapter, urządzenie, `RenderPipeline` z bloomem, rozgrzewka postu | **tak**, ~0,3 s |
| `syncCamera` + `renderSingle` (pudełko + świecący prostokąt HDR) | **tak** — obraz z bloomem na kanwie workera, 6 rysunków, pierwsza klatka 0,2 s (kompilacje) |
| 60 klatek w rAF workera | **tak**, 0,74 ms CPU na klatkę (p50), GPU 0,28 ms |
| `Core3D.warmup.flush()` | **tak**, 0,36–0,48 s, 19 wpisów; jeden wpis z ostrzeżeniem („dysze SIDE”, niżej) |
| import 21 modułów renderu gry (`hexShips3D`, `planet3d.assets`, `stations3D`, `world3d`, `haloRingGame`, `asteroidBelt`, `weaponFx`, `rockets/effects`, `rocketSystem3D`, `shield3D`, `explosionFx`, `warpNurt`, `spaceDust3D`, `shipModels3DGame`, `bridge3D`, `menuBackdrop3D`, `destruction3D`, `pirateDryDockGame`, `worldBodies3D`, `reactor3D`, `hallDust`) | **wszystkie się ładują** (10–570 ms każdy); render dalej działa |

Co pęka:
1. **Wpis rozgrzewki „dysze SIDE”** (`engineExhaustBatch.js` → `makeGlowTexture` / `makeRingTexture` /
   `makeFlareTexture` z `Engineeffects.js`): `document is not defined` — kanwa 2D przez `document.createElement('canvas')`.
   Do tego **pula zostaje w połowie zbudowana**: `ensureBuilt()` ustawia `flame` przed teksturami, więc po błędzie
   kolejne wywołania biorą ją za gotową i padają na `glow.mesh` (null). Z podkładką
   `document.createElement('canvas') → new OffscreenCanvas(…)` OD STARTU (`?dok=1`, poza listą z zadania) wpis
   przechodzi, a `flush()` kończy się bez błędów — `THREE.CanvasTexture` przyjmuje `OffscreenCanvas`.
2. **`THREE.TextureLoader`** (tekstury planet, stacji, GLB, sprite'y): `document.createElementNS('img')` — w workerze
   nie ma `<img>`. Zamiennik działa: `THREE.ImageBitmapLoader` (uwaga § 3.9 planu: ignoruje `flipY`) oraz `fetch →
   createImageBitmap → OffscreenCanvas 2D → getImageData` (piksele sprite'a — kratownica belek, mapa powierzchni)
   — 50 ms dla sprite'a Atlasa.
3. Nieuruchomione w próbie (tylko import, bez biegu z danymi gry): kanwy tekstur w `fxParticles3D.js`,
   `hexBodyImpostorBatch.js`, `hullLacquer.js`, `hullShadowSdf.js`, `hullSurface.js` (część ma już gałąź
   `OffscreenCanvas`), `planet3d.assets.js` (kanwa + `TextureLoader`), atlasy napisów ringu i budowli
   (`arch/fable.js`, `arch/ecumene.js`, `haloPortK7.js`, `portBuildings3D.js`), `stations3D.js` (GLB), `menuBackdrop3D.js`
   (`document`, rAF) — § 2.9 planu. Z p. 1 wynika, że podkładka „kanwa = `OffscreenCanvas`” załatwi większość z nich bez
   zmian w modułach, a ładowanie obrazów trzeba przepiąć na `ImageBitmapLoader` / `createImageBitmap` (RW-35).
4. **Ciche zmiany zachowania pod `window = globalThis`:** odczyty `window.SUN`, `window.camera2`, `window.splitScreenMode`,
   `window.DevVFX`, `window.__weapon3dCameraShake`… dają `undefined` — Core3D bierze wtedy domyślne (bez słońca w masce,
   bez podzielonego ekranu). Nic nie rzuca wyjątku, ale obraz będzie inny, dopóki te wartości nie przyjdą migawką
   (RW-12 `RenderWorld`). Zapisy `window.__rendererInfo`, `window.__zamiennikStats` lądują w workerze (harness i PerfHUD
   ich nie zobaczą — most konsoli, RW-36).

Wniosek: **rdzeń renderu nie jest przeszkodą** — Core3D z postem, bloomem compute, rozgrzewką i rAF działa w workerze
od ręki. Przeszkodą są (zgodnie z § 2) dane gry i rozgrywka w modułach 3D oraz ładowanie zasobów przez DOM.

## 9. Odtworzenie

Siatka w headless Chrome (1080p i 4K, 2 powtórzenia ~2 h; wyniki w `.tmp/rw02/<katalog>/wyniki.json`, tabele
`tabele.md` i `raport-tabele.md`):

```bash
node scripts/webgpu/render-worker-proto.mjs --rozdz 1080,4k --powtorzenia 2 --warianty 0,A,B1,B2,B2p,B2c,B3 --out .tmp/rw02/siatka
```

Druga siatka (pierścień z regułą i przeciwciśnieniem):

```bash
node scripts/webgpu/render-worker-proto.mjs --rozdz 1080,4k --warianty A,B2cr,B2cp,B3 --out .tmp/rw02/siatka-b2cr
```

Bez limitu klatek (jak harness bitwy):

```bash
node scripts/webgpu/render-worker-proto.mjs --rozdz 1080 --hz 0 --S 3.5 --D 4,8 --warianty 0,A,B2cr,B2cp --out .tmp/rw02/bez-limitu
```

Electron 44 z repo (build dema przez Vite do katalogu tymczasowego, kopia `electron/main.js`, prawdziwy vsync; okno
pojawia się bez fokusu):

```bash
node scripts/webgpu/render-worker-proto.mjs --electron 1 --rozdz 1080 --petla raf --S 2.5,4.5 --D 4,12 --warianty 0,A,B1,B2,B2cr,B2cp,B3 --out .tmp/rw02/electron
```

Same tabele z istniejących wyników:

```bash
node scripts/webgpu/render-worker-proto.mjs --tabele .tmp/rw02/siatka/wyniki.json
```

Próba prawdziwego Core3D w workerze (z `--dok 1` — dodatkowo podkładka `document.createElement('canvas')` od startu):

```bash
node scripts/webgpu/render-worker-proto.mjs --core3d 1
```

Demo w przeglądarce: `npm run dev` → `/dema/render-worker-proto.html` (parametry: `wariant`, `S`, `D`, `hz`, `petla`,
`gpu`, `partie`, `n`, `wezly`, `kanwy`, `kanwyR`, `kanwyP`; `?core3d=1` — próba Core3D).
