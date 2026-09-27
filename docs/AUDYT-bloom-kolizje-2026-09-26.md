# Audyt bloomu i jasności zderzeń (2026-09-26)

Zgłoszenie: (1) bloom silników jest za mocny, (2) zderzenia są za jasne — iskry i bloom/HDR
zasłaniają to, co robi silnik fizyczny (zgniot, rozdarcia blachy, odłamki). Kod czytany
na stanie drzewa z 2026-09-26 (`9f50a9a`), three r183.

Skrót: oba objawy mają konkretne źródła w emiterach, a nie w samym ustawieniu bloomu.

- **Silniki — dysze SIDE** (`engineExhaustBatch.js`): każda dysza boczna ma w spoczynku biały
  „pilot” o jasności `ENGINE_HDR` = 2,4, czyli ponad progiem bloomu. Atlas ma 8 dysz bocznych —
  nawet stojący okręt świecił 8 białymi plamami z poświatą. Przy manewrze barwa rośnie
  × (1 + 1,5 · ciąg): do HDR 6, a w pasmach „diamentów” do ~11. Strugi MAIN zostają bez zmian
  (zgłoszenie dotyczyło SIDE; liczby MAIN niżej dla porządku).
- **Zderzenia**: iskry tarcia liczyły budżet z **impulsu** (masa × prędkość). Przy masach kadłubów
  na belkach (10⁵–10⁶) budżet nasycał się przy każdym dotyku: taran 300 j./s sypał **~6 400
  iskier/s**, każda z białą głową HDR 4, pod bloomem overlaya, który dokłada ~14× energii
  prawie wszystkiego (próg 0,15), a overlay kładzie się na klatkę trybem `screen`. Do tego żar
  brzegu rany w HDR 9.

## 1. Co naprawdę dokłada bloom

Są dwa bloomy: Core3D (scena gry) i overlay3D (osobny `WebGLRenderer`: wybuchy broni, iskry
trafień i tarcia, rakiety), składany na kanwę przez CSS `mix-blend-mode: screen`.

`UnrealBloomPass` (three r183):

- filtr jasności przepuszcza **cały teksel**, gdy jego luminancja przekroczy próg
  (`smoothstep(próg, próg + 0,01, L)`), nie nadmiar ponad próg — piksel 0,89 nie świeci wcale,
  0,91 świeci całym sobą;
- składanie: `3,0 · siła · Σ lerpBloomFactor(fᵢ) · rozmycieᵢ`, a Σ `lerpBloomFactor` = 3,0 dla
  każdego `radius` (radius tylko przesuwa wagę między mipami). Jądra rozmycia sumują się do ~0,995
  na przebieg (kaskada mipów gubi ~3–5%), więc **bloom dokłada ~9 × siła × energia pikseli ponad
  progiem**:

| Pass | siła / radius / próg | Dokładana energia | Uwagi |
|---|---|---|---|
| Core3D | 0,85 / 0,4 / 0,9 | **~7,5×** | emitery HDR > 1 |
| overlay3D | 1,6 / 0,5 / 0,15 | **~14×** | próg 0,15 = praktycznie wszystko świeci |

Mipy (1080p, rozmycie narasta kaskadowo): σ ≈ 4, 14, 40, 104, 257 px. Przy radius 0,4 wagi to
0,68 / 0,64 / 0,60 / 0,56 / 0,52 — ponad jedna trzecia energii poświaty ląduje w dwóch
najszerszych mipach (σ ≥ 100 px), stąd „mgła” wokół jasnych źródeł.

Tonemapping (uberPass, ACES Narkowicza bez ekspozycji): 0,5 → 0,62, 1 → 0,80, 2 → 0,92,
4 → 0,97. Powyżej ~2 wszystko jest już prawie białe — dalsze HDR zasila tylko bloom.

## 2. Silniki

### 2.1 Dysze boczne SIDE (`src/3d/engineExhaustBatch.js`) — zgłoszony problem

Shader płomienia: barwa = mix(brzeg, rdzeń) (+ „diamenty” do 0,9 · rdzeń przy ciągu ≥ 0,2),
całość × (1 + 1,5 · ciąg); rdzeń = `ENGINE_HDR` (biały), brzeg = barwa z kelwinów × `bloomGain`
gracza (1,1) × `ENGINE_HDR`. Alfa = max(struga, poświata rdzenia), a poświata rdzenia (`glowAlpha`)
jest pełna także przy ciągu 0 — to biały „pilot” na każdej dyszy. Dysze rysują się pod kadłubem
(z = −5, test głębi), więc widać to, co wystaje poza burtę, i poświatę bloomu, która na burtę
nachodzi. Stany (szczyt barwy × alfa ≈ 1):

| Stan dyszy | ciąg | `ENGINE_HDR` 2,4 (przed) | `ENGINE_HDR` 0,6 (po) |
|---|---|---|---|
| spoczynek — pilot | 0 | **2,4 (bloom)** | 0,6 (pod progiem 0,9) |
| lot bez manewru (`moveGlow` · 0,55) | ≤ 0,26 | 2,9–3,4 (bloom) | 0,6–0,84 (pod progiem) |
| pełny manewr | 1 | 6,0; diamenty do ~11 | 1,5; diamenty do ~2,9 |

Reguła po zmianie: dysza boczna świeci w bloomie tylko wtedy, gdy faktycznie odpala (obrót,
strafe), a nie przez cały czas.

Atlas ma 8 dysz SIDE (4 przy rufie, 4 przy dziobie), więc przed zmianą stojący Atlas miał
8 białych źródeł bloomu na obrysie.

### 2.2 Struga MAIN (`src/3d/mainExhaust3D.js`) — bez zmian

Dla porządku (model numeryczny shadera, paleta „wodor”): przy pełnym ciągu rdzeń strugi sięga
HDR ≈ 5 (~5 nakładających się kwadów rdzenia, palety 1:1 z dema), a poświata niesie ~4,5× tyle
energii co sama struga; przy pół ciągu HDR ≈ 2,2. To świadomy wygląd — zgłoszenie dotyczyło SIDE,
więc MAIN zostaje 1:1. Gdyby kiedyś był za mocny: mnożnik barwy w `JET_FRAG` (np. 0,5 dawałby
rdzeń ~2,5 i poświatę ~3× słabszą) zamiast ruszania palet.

### 2.3 WARP (`src/3d/warpPlume3D.js`)

Osobne pasma HDR (rdzeń 8–12) — to efekt skoku, celowo spektakularny. Bez zmian.

## 3. Zderzenia

### 3.1 Iskry tarcia — główny winowajca

Droga: `destructorBeams3D` → `hullBodies.onContact` → `CollisionFX.onGrind` → `collisionSparks.js`
→ `SparkSystem3D.grindingSeam` (scena overlaya). Zdarzenie leci z każdego kroku fizyki, w którym
para się styka (~95 wywołań/s na parę przy 120 Hz, czasem dwa na krok).

Dawny budżet: `min(120, 5 + 0,15 · (bounceForce + 3 · |poślizg|))` iskier **na wywołanie**, energia
wyrzutu `min(bounceForce + …, 650)`. `bounceForce` to impuls normalny — przy masach zderzeń
kadłubów (Atlas ≈ 800 tys.) 10⁵–3·10⁶, więc każdy styk z niezerowym impulsem dawał 120 iskier
i maksymalną energię. Pomiar na prawdziwym silniku belek (sekunda styku, `HullBodies.step`
120 Hz, kadłuby-płyty 1200×360 i 600×200 px):

| Scenariusz | Iskry/s przed | Iskry/s po (z snopem uderzenia) |
|---|---|---|
| taran 900 j./s (lekki w ciężki) | 10 187 | 349 |
| taran 300 j./s | 6 430 | 173 |
| taran 60 j./s | 2 152 | 11 |
| dosunięcie 15 j./s | 240 | 0 |
| pchanie 3 j./s | 60 | 0 |

Każda iskra: głowa biała, `boost` 4,0 (HDR 4), blending addytywny bez testu głębi, w overlayu
z bloomem ~14× i progiem 0,15, a potem `screen` na całą klatkę. Kilka tysięcy żywych iskier
(życie średnio ~0,37 s) = biała plama na całym zgniocie, pod którą nie widać deformacji.

### 3.2 Żar kadłuba (`hexShips3D.js`, skóra belek)

Szczyt żaru skóry belek brał `DESTRUCTOR_CONFIG.heatGlowPeak` = 9 (strojone pod heksy).
Jasność = szczyt × (0,26h + 0,74h⁴), h = poziom żaru:

| h | gdzie | szczyt 9 (przed) | szczyt 2,5 (po) |
|---|---|---|---|
| 1,0 | świeży brzeg rany (taran ≥ 150 j./s) | 9,0 | 2,5 |
| 0,75 | brzeg po ~0,8 s stygnięcia | 3,86 | 1,07 |
| 0,55 | pierścień brzegu (`heatSpread`) | 1,90 | 0,53 |
| 0,35 | cała zgniatana powierzchnia (`heatContact`) | **0,92 — na progu bloomu** | 0,26 |
| 0,2 | stygnąca blacha | 0,48 | 0,13 |

Na belkach żar powstaje wyłącznie w zderzeniach, więc cały zgniot stał na progu bloomu (0,9),
a brzeg rany świecił bielą z poświatą ×~7,5.

### 3.3 Odłamki (`hullDebris3D.js`)

Oświetlone płyty i kształtowniki bez żaru — w porządku, to właśnie ma być widać.

### 3.4 Reflektory dziobowe Atlasa (bez zmian)

Atlas ma na dziobie dwie białe lampy `road` (`power` 3, `radius` 14; `shipLights3D.js`: rdzeń
× `coreGain` 6,5 ≈ HDR 19). Świecą zawsze, a przy taranie dziobem siedzą dokładnie na styku,
więc część jasnego punktu w miejscu zderzenia to one, nie zderzenie. Lampy wzmocniono świadomie
(2026-09-26, „żeby mocniej świeciły”), więc zostają.

### 3.5 Zdarzenie `impact`

Nie miało żadnego subskrybenta — chwila zderzenia nie miała własnego akcentu (zakrywał ją
potok iskier tarcia).

### 3.6 Co zostało na styku po poprawce iskier — diagnostyka

Te same zrzuty taranu (wycinek styku 360×240 px, średnia luminancja sRGB) z wyłączonym po kolei
jednym źródłem, przy żarze 4,5 (etap pośredni):

| Klatka po styku | wszystko | bez iskier | bez żaru |
|---|---|---|---|
| +10 | 77,1 | 72,7 | 43,5 |
| +50 | 73,2 | 75,1 | 41,9 |
| +90 | 59,1 | 63,7 | 38,7 |

Przed zderzeniem ten wycinek ma ~35 (tło + reflektory dziobowe). Po poprawce budżetu iskry
nie dokładają już nic mierzalnego, a ~80% nadmiarowej jasności styku to żar brzegów rany —
stąd drugi krok: szczyt żaru 4,5 → 2,5.


## 4. Zmiany

| Co | Gdzie | Przed | Po |
|---|---|---|---|
| HDR dysz bocznych SIDE | `ENGINE_HDR` (`engineExhaustBatch.js`) | 2,4 | **0,6**: pilot i sam lot pod progiem bloomu, pełny manewr 1,5 (diamenty ~2,9) |
| Budżet iskier tarcia | `collisionSparks.js`, `COLLISION_SPARKS_TUNE` | do 120 na wywołanie, z impulsu | **tempo** do 420/s na parę z prędkości styku (8 → 260 j./s), w czasie symulacji pary (niezależne od `PHYS_HZ` i liczby wywołań na krok) |
| Snop uderzenia | `collisionSparks.js`, zdarzenie `impact` | brak | do 56 iskier jednorazowo (od prędkości zbliżania, sufit 400 j./s) |
| Jasność iskry tarcia | atrybut `iGain` w `sparkSystem3D.js`, `emit(..., gain)` | 1 | **0,5** (iskry trafień zostają na 1) |
| Kształt snopu tarcia | `grindingBurst` / `grindingSeam` | energia i kierunek z impulsu | z prędkości styku (zbliżanie vs poślizg); budżet podaje subskrybent; losowe przesunięcie podziału na punkty szwu |
| Szczyt żaru skóry belek | `HULL_BODY_CONFIG.heatGlowPeak` (`hullBodies.js`) | 9 (z destruktora) | **2,5**; `DESTRUCTOR_CONFIG.heatGlowPeak` zostaje heksom (asteroidy) |

Nie zmieniły się: model zderzeń i to, co iskrzy; ustawienia obu bloomów; tonemapping; strugi MAIN
i WARP; broń i jej iskry trafień; odłamki.

## 5. Weryfikacja

- Nowe testy `tests/collisionSparks.test.mjs`: tempo rośnie z prędkością i ma sufit; sekunda styku
  daje ~tempo niezależnie od liczby wywołań na krok i od `PHYS_HZ` (60/120/240); impuls nie
  steruje iskrami (pchanie 3 j./s ciężkim kadłubem = 0 iskier); przerwa w styku nie nadrabia
  budżetu; taran 300 j./s na `HullBodies` mieści się w tempie + snopie uderzenia; atrybut `iGain`.
- `tests/collisionFx.test.mjs` — testy szwu na nowym kontrakcie (budżet podawany jawnie);
  `tests/renderBugfixGuards.test.mjs` — dysza SIDE w spoczynku i w samym locie pod progiem bloomu
  (z domyślnym `bloomGain` gracza), przy pełnym manewrze wyraźnie nad nim.
- Pełny zestaw `node --test tests/*.test.mjs`: 1227 testów, 1218 zaliczonych, 2 TODO i te same
  7 porażek co przed zmianami (uderzenia asteroid, radar HUD ×2, skaner, mapa AU, koło celowania,
  ścieżki strzału P1 — niezwiązane). `hullShadowSdf` „warstwy…” potrafi wypaść z budżetu czasu
  pieczenia, gdy CPU mieli Chromium w tle; sam przechodzi.
- Zrzuty A/B z prawdziwej gry: headless Chromium (SwiftShader), 960×540, wirtualny zegar
  Playwright (1 klatka = 1/60 s gry niezależnie od szybkości renderu; adaptacja jakości overlaya
  widzi czas renderu 0, więc jego bloom jest włączony jak na GPU), ten sam kadr w pustej
  przestrzeni, tarcze wyłączone (tarcza-obrys włączała się niedeterministycznie i zalewała kadłuby
  niebieskim). „Przed” = drzewo z `9f50a9a`, „po” = te zmiany. Średnia luminancja sRGB:

  | Kadr | przed | po |
  |---|---|---|
  | Atlas w spoczynku (całość) | 32,3 | 32,2 |
  | pełny ciąg MAIN (całość) | 44,5 | 42,3 |
  | obrót w miejscu — dysze SIDE (całość) | 89,5 | 52,2 |
  | obrót — wycinek dziobu / rufy | 131,8 / 115,1 | 76,1 / 75,1 |
  | taran 380 j./s: wycinek styku przed kontaktem | 35,1 | 35,0 |
  | taran: wycinek styku +10 / +50 / +90 klatek | 89,9 / 101,0 / 81,3 | 60,3 / 63,1 / 53,3 |
  | taran: cały kadr +50 klatek | 41,4 | 29,2 |

  Nadmiar jasności styku ponad stan sprzed kontaktu spadł z ~46–66 do ~18–28. Na zrzutach „przed”
  cały zgniot zakrywa biała kula z ciepłą mgłą na pół kadru; „po” widać zgniecione płyty dziobu
  pancernika i odłamki, a jasny punkt na styku to głównie reflektory dziobowe Atlasa (§3.4)
  i świeży brzeg rany. Dysze SIDE przy obrocie: zamiast białych plam zalewających narożniki
  kadłuba — dwa czytelne płomienie z małą poświatą.

## 6. Czego nie ruszałem i co dalej

- **Bloom Core3D (0,85 / 0,4 / 0,9)** — wspólny dla broni, świateł, planet i miasta ringu. Przyczyną
  były emitery, więc poprawka jest u nich. Jeśli nadal za dużo „mgły”: radius 0,4 → 0,2 przesuwa
  wagę z szerokich mipów (mip 4: 0,52 → 0,36) bez zmiany całkowitej energii.
- **Bloom overlaya (1,6 / 0,5 / 0,15 = ~14× prawie wszystkiego)** — najmocniejszy bloom w grze;
  wybuchy broni są pod niego strojone. Kandydat na osobny przegląd, jeśli wybuchy też będą za jasne.
- Filtr jasności „zero-jedynkowy” (cały teksel ponad progiem) — miękkie kolano (sam nadmiar ponad
  progiem) byłoby fizyczniejsze, ale zmienia wygląd całej gry.
- `SparkSystem3D.setColor` przestawia barwę **wszystkich** żywych iskier (uniform) — stara osobliwość.
- Gałki strojenia: `ENGINE_HDR` (SIDE), `COLLISION_SPARKS_TUNE`, `HULL_BODY_CONFIG.heatGlowPeak`.
