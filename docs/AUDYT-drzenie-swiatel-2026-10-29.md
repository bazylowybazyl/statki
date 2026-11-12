# Drżenie świateł statków w polu asteroid (2026-10-29)

Zgłoszenie użytkownika (5120 × 1440 @ 240 Hz, RTX 5080, render w workerze, preset Ultra): „drżące światła statków —
snopy front i pomocnicze drżą”. Objaw jest tylko w polu asteroid: jedyną drogą reflektorów statków do siatki świateł gry
(`Core3D.fx.grid`) jest `AsteroidBelt._addShipLights` → `lightGrid.addShipLights` — reflektory dalekie („snopy front”),
reflektory otoczenia z obrysu (rufa i burty — „pomocnicze”), światło dookoła i poświata grup lamp pozycyjnych. Siatkę
czyta wszystko w polu: smugi ośrodka (`VolumeLight`), mapy cienia reflektorów, skały, gaz przestrzeni i jego pył, pył
kosmiczny, głębokie płaty mgły i kadłuby.

Gałąź `claude/perf-baza-gpu` (main 9444fa8d), bez commita. Zgłoszenia gazu (zoom, oddalenie) — reguła `gaz-przestrzeni`,
`docs/PLAN-gazy-kosmos.md` § 6; pomiar w grze po poprawkach świateł i gazu oraz wybór domyślnych — § 6 niżej (2026-10-30).

## 1. Przyczyny

1. **Poza świateł ≠ poza kadłuba.** Światła gracza w pasie stały w pozie KOŃCA KROKU FIZYKI (encja: w workerze lustro
   `rm.player` — pakowacz pisze pozę renderu do ENT tylko NPC i wrakom; w trybie `off` — `ship` gry), a kadłub, model,
   mostek, tarcze, billboardy lamp, lampy kadłuba i dysze gracza rysują się w pozie RENDERU (interpolacja między krokami —
   `RenderWorld.playerPose`). Przy 240 Hz obrazu i 60 Hz fizyki (α = 0,25 / 0,5 / 0,75 / 0) światła wyprzedzały kadłub
   o (1 − α) · v / 60 i wracały co krok: piła wszystkich świateł gracza wobec kadłuba, na obrocie też oś za kadłubem.
2. **Kierunki reflektorów przez round2.** `buildRoadLightWorldEmitters` zaokrąglał kierunek do 0,01 na składową (po
   skali sprite'a i po obrocie do świata), `worldDirToEntitySpriteDir` (światła zewnętrzne w przestrzeni sprite'a celu) —
   tak samo. Przy obrocie okrętu oś stała, a potem skakała o 0,3–0,8° (12–38 skoków/s przy 0,1–0,3 rad/s; 30 px smugi
   5 km od lampy przy zoomie 0,45). Wszystkie statki z lampami `road` / `flood`, oba tryby renderu.
3. **Siatka kolumn ośrodka i mapy pola względem początku pola.** Lepki `Core3D.fx.origin` przeskakuje o całkowitą liczbę
   jednostek po 20 tys. j. drogi kamery; kolumna 2^(j/8) j. i teksel mapy (2^k / 48) go nie dzielą, więc siatka
   przeskakiwała w świecie o (przeskok mod kolumna) — smugi, cienie skał w smudze i włókna jednym szarpnięciem, w
   hipercruisie w pasie 1–1,6 razy na sekundę.
4. (desynchronizacja, nie drżenie) Poświata lamp pozycyjnych w pyle szła zegarem skał (suma dt, w pauzie stoi), billboardy
   i lampy kadłuba — zegarem klatki efektów (`Core3D.frameNowMs`).

## 2. Poprawki (A/B na żywo, bez nowych materiałów i pipeline'ów, bez alokacji w klatce)

| Poprawka | Kod | A/B (worker: `st.belt`, strona: `window.__asteroidBelt`) |
|---|---|---|
| A. światła gracza w pozie renderu | `addShipLights(…, { pose })` (gettery `getPosition` / `getAngle` emiterów i grup lamp), `beltShipRenderPose`, `AsteroidBelt._addShipLights`; wiązka ściągająca platformy — `_shipRenderPoint` | `belt.lightsRenderPose = false` |
| B. osie reflektorów bez zaokrąglenia | `SHIP_LIGHT_DIR_TUNE.exact` (`shipLightRuntime.js`: `normalizeVec2`, normalizacja po skali sprite'a; składowe < 1e-12 → 0) | `belt.lightDirTune.exact = false` |
| C. siatki pasa w układzie sceny | `VOLUME_LIGHT_TUNE.worldAnchor` (`VolumeLight.update`), `FIELD_MAP_TUNE.worldAnchor` (`FieldMap._build`) | `belt.volume.tune.worldAnchor = false`, `belt.fieldMap.tune.worldAnchor = false` |
| poświata lamp na zegarze klatki | `opts.time = Core3D.frameNowMs() · 0,001` | `belt.navClock = 'belt'` |

Obraz w bezruchu: A — bez zmian (poza renderu = poza kroku); B — oś statyczna przesunięta najwyżej o 0,37° (średnio
0,14°) na prawdziwy kurs; C — ta sama kolumna, filtr i szum, inna tylko faza siatki (resampling ośrodka o ułamek
kolumny — nie bit w bit wobec dawnej fazy); poświata — ta sama, inna faza, w pauzie pulsuje jak lampy.

## 3. Pomiary

Node (bez GPU, prawdziwe moduły; testy niżej):

- 240 Hz obrazu / 60 Hz fizyki, Atlas, zoom 0,45: rozpiętość świateł gracza wobec kadłuba 600 / 1500 / 3000 j/s —
  0,011 j. (zaokrąglenie pozycji emiterów do 0,01 j.) zamiast 7,5 / 18,8 / 37,5 j. (3,4 / 8,4 / 16,9 px); zakręt 0,3 rad/s —
  oś wobec kadłuba 2e-6° zamiast 0,215°.
- Obrót 0,1 i 0,3 rad/s: oś każdego reflektora zmienia się co klatkę o ω · dt (odchyłka < 1e-9 rad), bez stania i skoków
  (dawniej 38 skoków/s, do 0,8°, błąd wobec kursu do 0,37°).
- Siatka kolumn przy 3000 j/s przez 30 s (4 przeskoki początku) i 24 tys. j/s: 0 przeskoków w świecie (dawniej 11,7 j. =
  5,3 px na przeskok); mapa pola po przeskoku: te same punkty świata, te same wartości tekseli.

Gra (headless z taktem monitora `--takt 1`, Ultra: MSAA 4, skala renderu 1,25 → bufor 6400 × 1800, worker; zoom 0,341;
`node scripts/webgpu/gpu-pas-gra.mjs --takt 1 --query "grafika=ultra&renderWorker=1" --drzenie <katalog> --drzenieCzesci
swiatla --okna brak --kolko 0 --ab 0 --rytm 0 --slad 0`; pliki gazu innej sesji w trakcie pracy podmienione na HEAD przez
`HULLFALL_AB_DIR`; bez obcych harnessów, LoL wyłączony; 0 pipeline'ów synchronicznych w workerze w obu przebiegach):

| Scenariusz | Poza fizyki − renderu | Reflektor daleki wzdłuż kadłuba (rozpiętość) — baza → po | Uwagi |
|---|---|---|---|
| prosto 592 j/s | 2,55 px | 2,55 → 0,003 px | wszystkie 12 świateł gracza ≤ 0,004 px |
| prosto 1392 j/s | 6,00 px | 5,99 → 0,004 px | korelacja z pozą fizyki 1,0 → −0,06 |
| prosto 2991 j/s | 12,87 px | 12,88 → 0,004 px | przeskok początku: siatka kolumn 0,385 kolumny (4,59 px) → 0 |
| obrót D, 533 j/s, ω 0,314 | — | oś stała na 521 / 692 stronach, skoki do 0,81° → 0 / 680 | oś − kadłub: rozrzut 0,91° → 0 |

Wariant „dawne” na tej samej gałęzi (`--drzenieWk` z czterema przełącznikami A/B) odtwarza bazę: piła 12,9 px przy
2991 j/s (korelacja 1), przeskok siatki kolumn 0,274 kolumny (3,26 px), oś stała na 514 / 681 stronach, skoki do 0,81°.
Siatka świateł: 0 zgubionych, najwyżej 11–12 świateł w komórce (przepełnienie `ITEM_CAP` nie występuje).

Narzędzie: `kolumnyStat` (`scripts/webgpu/drzenieSondy.mjs`) liczy fazę siatki kolumn w świecie z rogu siatki (początek +
róg lokalny) — dawniej z samego początku (prawda tylko dla siatki względem początku).

## 4. Testy

`tests/pasSwiatlaStatkow.test.mjs` (pętla 240 / 60 Hz na prawdziwym `_addShipLights`, poza tylko gracza, poświata,
wiązka ściągająca), `tests/fxLightGrid.test.mjs` (`opts.pose` = encja w tej pozie bit w bit), `tests/shipLightRuntime.test.mjs`
(oś przy obrocie, światło zewnętrzne), `tests/beltVolumeLight.test.mjs` (siatka kolumn przy przeskokach `FxPoolOrigin`),
`tests/pasMapaPola.test.mjs` (mapa pola po przeskoku). Każdy sprawdza też przełącznik A/B (dawny objaw wraca); mutacje
poprawek (osie przez round2, pominięta poza, siatki względem początku, poświata na zegarze skał) — testy padają.

## 5. Zostaje do decyzji użytkownika (zmieniają wygląd)

- **Własne światła pola na własnym kadłubie** — kadłub czyta siatkę z `uGridOwner` = 0, więc reflektory otoczenia, poświata
  lamp i bliskie pole reflektorów dalekich gracza oświetlają jego kadłub (~25% powierzchni Atlasa powyżej ćwierci światła
  dookoła, szczyt ~5×). Po poprawce A plamy jadą sztywno z kadłubem. Wycięcie (numer właściciela pasa w `uGridOwner`
  kadłuba) zmienia wygląd.
- **Mapy cienia reflektorów** (`spotShadows.js`: kafel 512² pary dalekiej, 256² reflektorów otoczenia, bez stabilizacji
  tekseli) — pasy cienia skał w smudze pełzają do teksela przy ruchu lampy (płynnie, po poprawkach A i B bez skoków).
  Ostrzejsze (kafle 1024², atlas 4096 × 2048, ~16 MB) albo miękkie PCF — za przełącznikiem.
- **Głębokie płaty mgły** (`fog.js`) rozpraszają światła siatki per wierzchołek na kracie ≥ 512 j. — ślad dolnej krawędzi
  reflektora dalekiego może pływać; słabe (alfa 0,11–0,22), nie mierzone na GPU.

Obok (nie to zgłoszenie): `EngineVfxSystem.update` bierze dt z `performance.now()` (`engineVfxSystem.js`) — zegar animacji
pióropuszy dysz poza zegarem klatki efektów.

## 6. Pomiar w grze po poprawkach świateł i gazu, wybór domyślnych (2026-10-30)

Drzewo po przeglądzie poprawek (światła — § 2; gaz przy zoomie i oddaleniu — reguła `gaz-przestrzeni`, PLAN gazów § 6).
Siedem przebiegów `scripts/webgpu/gpu-pas-gra.mjs` PO KOLEI (jeden Chrome naraz), headless, render w workerze,
5120 × 1440, ~42 min pracy karty. Przed każdym — kontrola meczu League of Legends (był tylko launcher; strażnik meczu
narzędzia się nie włączył), w oknach pomiaru bez obcych harnessów i `node --test` (żadne okno `obce`), karta na starcie
4–10%. Wyniki: `.tmp/drzenie-dzien/<przebieg>` (raport.json, drzenie.json, PNG); podsumowania i skrypty analizy obrazu —
poza repo (scratchpad sesji). W chwili pomiaru domyślne były: 4 próbki na teksel (`mapTaps` 4), B-spline wł., mapy
w proporcjach kadru (1086 × 306), zanik drobin pyłu [0,4; 1,2] px — pozostałe ustawienia mierzone jako warianty
w przebiegu albo osobnym przebiegiem (`?gazMapa=`).

| Przebieg | Preset, rytm | Mapa gazu | Części |
|---|---|---|---|
| `r1-po` | Ultra, takt monitora (`--takt 1`) | 1086 × 306 | światła (z wariantem „dawne”), zoom (rampy na żywo, pasma w pauzie), oddalenie, kadry map |
| `r1b-po` | Ultra, takt | 1086 × 306 | rampy na żywo przez progi próbek (warianty T…C…, dawne), oddalenie 8 km od miejsca „pole” (`--dalekoPrzesun 0,8000` — w miejscu „pole” jest dziś wyrwa z olbrzymem) |
| `rU-ultra` | Ultra, bez taktu | 1086 × 306 | koszt przy oddaleniu (`--abLotStaly`: próbki × B-spline, DW), pasma, jasność pyłu (MSAA 4 i bez MSAA) |
| `rW-wysoka` | Wysoka, bez taktu | 1086 × 306 | koszt (DW), jasność pyłu przy skali 1,0 |
| `rS-stara` | Ultra, takt | 768 × 432 (`?gazMapa=stara`) | zoom, oddalenie, kadry map, kalibracja zaniku pyłu (skala 1,25 i 1,0, `--jasnoscFade`) |
| `rZ-szeroka` | Ultra, takt | 1536 × 432 (`?gazMapa=szeroka`) | zoom, oddalenie, kadry map |
| `rS2-stara-taps` | Ultra, takt | 768 × 432 | rampy i oddalenie z jedną próbką (T1C1 / T1C0) |

### 6.1 Światła statków (`r1-po`, zoom 0,341, Ultra)

Geometria (położenie i oś świateł wobec narysowanego kadłuba, każda strona):

| Scenariusz | Reflektor daleki wzdłuż osi (rozpiętość) | Uwagi |
|---|---|---|
| prosto 592 j/s | 0,003 px (baza 2,55, „dawne” w przebiegu 2,56) | wszystkie 12 świateł gracza ≤ 0,004 px; korelacja z piłą fizyka − render −0,01 (baza i dawne 1,0) |
| prosto 1391 j/s | 0,003 px (baza 5,99) | korelacja −0,03 |
| prosto 2991 j/s | 0,003 px (baza 12,88, dawne 12,89) | korelacja −0,05 |
| obrót ω 0,314 rad/s | oś nigdy nie stoi: 0 / 630 stron (baza 521 / 692, dawne 483 / 645) | rozrzut oś − kadłub 0° (dawne 0,91°); zmiana osi na stronę = zmiana kursu kadłuba (średnio 0,143°; 0,6° = strona z 2–3 krokami taktu) |

Siatka świateł: 0 zgubionych, najwyżej 12 w komórce.

Obraz (24 kolejne strony na scenariusz, wycinki przeliczone na układ świata): średnie |ΔL| [poziomy 8 bit] na takt rAF
w obszarach snop przed dziobem / stożki reflektorów otoczenia z lewej / z prawej, osobno strony z krokiem fizyki i bez:

| Scenariusz | Dawne: z krokiem / bez kroku | Nowe: z krokiem / bez kroku |
|---|---|---|
| prosto 3000 j/s | 3,68 / 9,33 / 6,65 wobec 0,43 / 0,51 / 0,63 (26–37% pikseli snopu > 4 na stronach z krokiem: światło stoi, co 4. strona skok) | 1,42 / 3,01 / 1,95 wobec 0,97 / 1,94 / 1,44 (stosunek 0,64–0,74 — ruch rozłożony na każdą stronę) |
| obrót 600 j/s | snop 4,34 wobec 0,90 (0,21), otoczenie 2,80 wobec 0,85 | snop 2,57 wobec 1,66 (0,64), otoczenie 1,65 wobec 1,15 |

Przy 600 j/s prosto dawna piła 2,5 px jest w tej scenie poniżej szumu miary obrazu (nowe i dawne wyglądają tak samo).
Wykresy: `r1-po/obraz-swiatla/slupki-swiat-*.png`, odchylenie w czasie w układzie kadłuba: `odch-*.png`.

### 6.2 Gaz przy zoomie (`r1-po`, `r1b-po`, „sam gaz”)

Rampy na żywo (48 kolejnych stron), % pikseli > 4/255 przez stopień map w wycinkach lewy / środek / prawy, nowe wobec
wariantu „dawne” w tym samym przebiegu:

| Zdarzenie | Nowe | Dawne | Baza (przed poprawkami) |
|---|---|---|---|
| stopień map przy 0,1125 | 0,34 / 0,01 / 0 | 55,6 / 14,5 / 28,8 | 50,8 / 12,6 / 46,1 |
| stopień przy 0,0563 | 0,005 / 0 / 0 | 19,4 / 17,7 / 0,6 | 20–22 |
| próg 1 → 2 próbek (0,0796) | ≤ 0,08 | 38,4 / 13,0 / 25,3 | — |
| próg 2 → 4 próbek (0,0365) | 0,002 / 0 / 0 | 16,6 / 26,9 / 0 | — |
| stopień przy 0,0398 | 0,011 / 0 / 0 | 9,3 / 24,8 / 0 | — |
| krok siatki obwiedni przy 0,039 | ≤ 0,045 | — | — |

Pary bez zdarzenia: mediana 0–0,017%. 24 ząbki kółka: 87 stopni map (3,63 na ząbek; baza 2,21 — osie mapy 1086 × 306
przeskakują na różnych stronach, każdy stopień niewidoczny), 54 stopnie kolumn ośrodka, 8 kroków obwiedni; rampa 4 s —
96 stopni map. Pasma w pauzie (pasmo 0,0398, środek): 32,9% / 38,3% → 0,001% / 1,0%; lewy wycinek 9,8% / 20,3% → 0,08% /
7,7%. W pauzie wycinki pola dalekiego dryfują też bez zdarzeń (mediana 0,3–9%, w starym i nowym kodzie, znika przy
ukrytych warstwach gazu, na żywo jej nie ma — przyczyna otwarta; dotyczy tylko zoomu w pauzie) — wnioski z ramp na żywo.

### 6.3 Gaz przy oddaleniu (`r1b-po`, lot 600 j/s z ciągiem, 40 stron; wycinek A — wnętrze okna, C — tylny brzeg)

rms [poziomy] / % > 4 / izolowane igły na Mpx:

| Zoom | Nowe | Dawny sam pył (`dustMinPx` 0) | Wszystko dawne |
|---|---|---|---|
| 0,1 | A 0,25 / 0,007% / 0; C 0,24 / 0,001% / 0 | A 0,41 / 0,16% / 309; C 0,63 / 0,57% / 674 | A 0,40 / 0,12% / 213 |
| 0,0667 | A 0,26 / 0% / 0; C 0,25 / 0,002% / 0 | A 0,68 / 0,63% / 1084; C 0,86 / 1,06% / 1735 | baza: A 0,44% / 691; C 1,4% / 1884 |
| 0,035 | 0,24 / 0% / 0 | jak nowe (z MSAA pył przy minZoom i tak niewidoczny) | 0,32 / 0,23% (poprawki map i macierzy) |
| 0,341 | 0,64 / 0,001% / 0 | — | bez zmian |

W locie 3,4–4,0 przesunięć okna na sekundę, 0 stopni map, kolumn i obwiedni. Pył w kadrze przy 0,0667: geometrycznie
1,5 tys. drobin < 0,5 px, 46,8 tys. 0,5–1 px, 7,8 tys. 1–2 px — po poprawce wszystkie rysowane 2,5 px, energia 0,60
geometrycznej; przy 0,035 — 39,9 tys. < 0,5 px, 11,2 tys. 0,5–1 px, 23,9 tys. całkiem zgaszonych (energia 0,033). Drobin
rysowanych poniżej piksela: 0.

### 6.4 Rozmiar map (`rS-stara`, `r1-po`, `rZ-szeroka`)

| | 768 × 432 (bazowa) | 1086 × 306 (proporcje) | 1536 × 432 (szeroka) |
|---|---|---|---|
| teksel przy zoomie 0,341 / 0,0667 / 0,035 [px bufora] | 9,65 × 4,83 / 9,79 × 4,89 / 9,42 × 4,71 | 6,83 / 6,92 / 6,66 | 4,83 / 4,89 / 4,71 |
| teksel [j.] | 22,6 × 11,3 / 117 × 59 / 215 × 108 | 16 / 83 / 152 (pion przy 0,341 o 41% grubszy niż bazowa) | 11,3 / 59 / 108 |
| stopnie map na 24 ząbki kółka | 53 | 87 | 53 |
| skok na stopniu na żywo, lewy wycinek, % > 4 (0,1125 / 0,056) | 0,64 / 0,009 | 0,34 / 0,005 | 0,76 / 0,032 |
| lot przy oddaleniu (A rms, % > 4) | 0,23–0,26, ≤ 0,007% | to samo | to samo |
| compute map (kGas + kLight) przy 0,341 | 0,13–0,19 ms | 0,10–0,17 ms | 0,24–0,26 ms |
| compute map przy 0,035 (domyślne próbki) | 0,65–0,77 ms (4 próbki) | 0,72–0,80 ms (4) | 0,68–0,76 ms (2) |
| ms / obraz, postój 0,341 / 0,035 (osobne przebiegi, szum ±0,3) | 7,15 / 7,65 | 7,49 / 7,97 | 7,28 / 7,87 |

Bufor Ultra 6400 × 1800. A/B gazu wył. w przebiegu (0,341 / 0,035): −0,49 / −0,27, −0,41 / −0,25, −0,53 / −0,21 ms.
Mapa bazowa z jedną próbką (`rS2-stara-taps`): skoki na żywo 0,16–0,18%, lot przy oddaleniu ≤ 0,001%. Kadry w pauzie:
`.tmp/drzenie-dzien/mapy-porownanie/mapy-{pole,dalekie}-z{0.3413,0.0667,0.0350}-srodek-stara-aktualna-szeroka.png`
(kadry „dalekie” są tą samą treścią tylko w `rS` i `rZ`). Teksel zaniku faktury liczył się wtedy z rozmiaru mapy:
przy 0,035 205,7 j. (bazowa) wobec 145,5 (proporcje) — stąd inna faktura przy oddaleniu na mapie z kadru (przegląd;
poprawione niżej).

### 6.5 Próbki na teksel × B-spline — koszt przy oddaleniu (`rU-ultra`, lot ze stałą prędkością 600 j/s z ciągiem)

- compute map przy 0,035: 4 próbki 0,66 ms (średnia 7 okien bazy), 2 — 0,36, 1 — 0,17–0,18; przy 0,0667: 2 próbki
  (4 bierze dopiero teksel > 150 j.) 0,37, 1 — 0,16–0,27. B-spline wył. oszczędza 0,06–0,15 ms passu ortho przy 0,035
  (działa tylko poniżej zoomu ~0,13–0,18).
- ms / obraz przy 0,035 (pojedyncze okna, ±0,15): baza (T4C1) 8,67; T2C1 8,40; T1C1 8,32; T4C0 8,61; T2C0 8,45;
  T1C0 8,53; wszystkie poprawki wył. (DW) 8,34. Przy 0,0667 okna przelotu wahają się 9,2–10,1 ms z treścią kadru —
  miarą są znaczniki compute.
- Drżenie: rampy na żywo przez próg 1 → 2 próbek (0,0796) — ≤ 0,08% dla każdego ustawienia; przez próg 2 → 4 (0,0365) —
  baza 0,002%, T1C1 0%, T1C0 0,014% (dawne 16,6–26,9%). Lot przy 0,0667 i 0,035 — każde ustawienie ≤ 0,035% > 4,
  ≤ 1,5 igły / Mpx. W pauzie 4 próbki robią własny skok na progu 2 → 4 (lewy wycinek 12,7%, środek 3,4% wobec 0,17 /
  0,07% z jedną próbką); na żywo 0,002%.

### 6.6 Jasność pyłu — kalibracja zaniku drobin < 1 px

Energia pyłu = suma luminancji liniowej bufora sceny HDR z pyłem minus bez pyłu, nowy wzór wobec dawnego (`dustMinPx` 0),
dwie serie i kontrola, poza okrętem:

| | Ultra 0,0667 | Ultra 0,05 | Wysoka 0,0667 | Wysoka 0,05 |
|---|---|---|---|---|
| [0,4; 1,2] px (było domyślne) | 0,98 | 0,74 | 0,81 | 0,64 |
| [0,25; 1,2] | 1,09 | 1,05 | 1,06 | 1,23 |
| [0,15; 1,1] | 1,25 | 1,41 | 1,37 | 1,92 |
| [0,3; 1,2] (interpolacja) | ~1,05 | ~0,95 | ~0,97 | ~1,03 |

MSAA 4: Ultra (skala 1,25) 0,0667 → 0,98–1,01, 0,05 → 0,74–0,77; Wysoka natywnie (`rW`) 0,0667 → 0,83, emulowana
w `rS` (skala 1,0) 0,81–0,82 / 0,64–0,68. Przy 0,035 energia pyłu ≈ 0 w obu wzorach i skalach (dawny raster z MSAA
i tak gubił pył poniżej piksela). Bez MSAA (`Core3D.setMsaaEnabled(false)` w biegu): Ultra 0,98 / 0,95 (0,0667 /
0,035), Wysoka 1,00 / 0,97 — zgodnie z wyborem zaniku tylko z MSAA. Zanik zmienia tylko jasność — migotanie bez zmian.

### 6.7 Koszt i pipeline'y

| Okno (headless bez taktu, worker) | 2026-10-29 po | 2026-10-30 | Zmiana |
|---|---|---|---|
| Wysoka postój 0,341 | 6,51 ms / obraz | 6,41 | −0,09 |
| Wysoka przelot 0,0667 | 6,77 | 7,17 | +0,40 |
| Ultra postój 0,0667 | 8,91 | 8,99 | +0,07 |

+0,40 to w większości nie poprawki drżenia: A/B wszystkich poprawek wył. (DW) w tym samym przebiegu — Wysoka 0,0667
−0,22 / −0,05 ms (poprawki ~0,14 ms); HEAD bez poprawek miał w tym oknie 7,13 ms 2026-10-29 (22:27); scena inna (wyrwa
z olbrzymem w miejscu „pole”) i drzewo po scaleniu main z 18:47. Koszt poprawek: ~0,1–0,2 ms przy 0,0667 i ~0,3 ms przy
0,035 — głównie 4 próbki na teksel; Ultra lot DW: −0,32 ms (0,035), −0,18 ms (0,0667).

Pipeline'y: render tworzone w oknach — 0 / 0 we wszystkich oknach siedmiu przebiegów; render kompilowane synchronicznie
w klatkach workera (cała sesja) — 0 w `r1`, `r1b`, `rS`, `rZ`, `rS2` (w `rU` i `rW` 0 przed celowym przełączeniem MSAA
w biegu, 18 po nim — narzędzie). Compute tworzone w oknach — 0; nowy licznik sesji — dokładnie 1 pipeline compute po
starcie w każdym przebiegu: `GiantView.bake` (`giants.js`, krok `asteroidBelt`) przy pierwszym olbrzymie w kadrze (sprzed
tych zmian; poprawione niżej). Zmieniony WGSL `kGas` / `kLight` (także 1536 × 432) kompiluje się tylko w rozgrzewce.

### 6.8 Wnioski i domyślne (2026-10-30)

Drżenie przy zoomie i oddaleniu usuwa odświeżanie macierzy warstw i pyłu w kroku (`matrixSync`) i najmniejszy bok drobiny
(`dustMinPx`) — od rozmiaru mapy i liczby próbek nie zależy (stopnie map na żywo ≤ 0,8% dla każdej mapy, wobec 13–56%
dawniej; lot przy oddaleniu ≤ 0,007%). Światła statków — bez piły wobec kadłuba i bez stania osi. Zmiany w kodzie:

- mapa bazowa 768 × 432 domyślnie (`SPACE_GAS_TUNE.mapAspect` false): koszt jak mapy z kadru, teksel pionowy przy
  domyślnym zoomie 11,3 j. zamiast 16 j. (wygląd przy zbliżeniu, który użytkownik uznał za dobry), ~40% mniej stopni
  drabiny (53 wobec 87 na 24 ząbki); mapy w proporcjach kadru — A/B `?gazMapa=proporcje`, szeroka 1536 × 432 (teksel kwadratowy 4,8 px, compute map
  +0,07–0,15 ms przy domyślnym zoomie, ~+0,15 ms przy oddaleniu z jedną próbką) — `?gazMapa=szeroka`, opcja jakości;
- jedna próbka na teksel (`mapTaps` 1): −0,48 ms compute przy największym oddaleniu i ~−0,2 ms przy 0,0667 wobec 4,
  drżenie bez zmian (bez własnego skoku 4 próbek na progu 2 → 4 w pauzie);
- B-spline zostaje wł. (`layerCubic`): 0,06–0,15 ms passu ortho tylko przy oddaleniu, najmniejsze skoki (T1C1 0% wobec
  T1C0 0,014% przy 0,0365), bez schodków teksla — ale filtr przybliżający: gaz przy oddaleniu miękkszy o ~½ teksla
  (lustro CPU kadru w pauzie: RMS 0,55 / 0,80 / 1,17 / 1,59 poziomu przy zoomie 0,1 / 0,0667 / 0,05 / 0,035) — DO
  DECYZJI UŻYTKOWNIKA (A/B `SpaceGas.tune.layerCubic = false`);
- zanik drobin pyłu [0,3; 1,2] px (`dustFadePx`) — energia pyłu jak dawniej ±5% (interpolacja; do potwierdzenia
  przebiegiem `--drzenieCzesci jasnosc --jasnoscSkale 1.25,1 --jasnoscFade "0.3,1.2"`), `dustMinPx` 2,5 bez zmian
  (igły przy oddaleniu 674–1735 / Mpx → 0);
- przegląd: teksel zaniku faktury z mapy bazowej (`SpaceGasMaps` `lodW / lodH`) przy każdym rozmiarze mapy i w połowie
  podzielonego ekranu — mapa z kadru przesuwała zanik (lod przy minZoom 0,819 → 0,392, w podzielonym ekranie w drugą
  stronę); w lustrze CPU (`scripts/gazZoomSonda.mjs`) sam ten przesuw zmieniał kadr przy oddaleniu o RMS 1,3–3,5 poziomu;
- przegląd: kernele pola (N²) i pyłu (liczba drobin) bez strażnika liczby wątków — bok okna w górę do wielokrotności 8
  (`spaceGasWindowCells`, też w grze), drobiny w górę do 64 (`spaceGasKernelCount`), z ostrzeżeniem;
- pieczenie światła olbrzymów pasa — jeden kernel dla wszystkich olbrzymów (`GiantBakeKernel`), rozgrzany pustym
  dispatchem w `AsteroidBelt._prewarmCompute` (dawniej kernel na olbrzyma: wymiary w stałych WGSL — pipeline compute
  w klatce gry przy pierwszym widoku każdego olbrzyma). Materiał olbrzyma bez zmian (WGSL w Node ten sam).

Testy (Node): `tests/spaceGas.test.mjs` (domyślne, zanik faktury z mapy bazowej dla trzech map i podzielonego ekranu,
wątki kerneli, narzędzie: „nowe” = domyślne), `tests/pasOlbrzymPieczenie.test.mjs` (jeden węzeł compute dla olbrzymów
o różnych wymiarach, wiązania za podmianą tekstur, pusty dispatch w rozgrzewce pasa; sprawdzone mutacją — bez wywołania
rozgrzewki w `_prewarmCompute` albo bez `referenceNode` węzła zapisu odpowiedni test pada).
Po tych zmianach kodu NIE było przebiegu GPU — do potwierdzenia jednym przebiegiem: 0 pipeline'ów compute po starcie
(pieczenie olbrzyma), domyślna mapa z poprawką zaniku (kadry `--drzenieCzesci mapa`), jasność pyłu z [0,3; 1,2].

Do decyzji użytkownika (zmieniają wygląd): `lodMean` (średnie kanałów wygaszonej faktury — domyślnie wył.: przy
oddaleniu siarka −13%, lód +25%, wyrzut −30%), `layerCubic` (wyżej), mapa szeroka jako opcja jakości, oraz z § 5:
własne światła na własnym kadłubie, mapy cienia reflektorów, głębokie płaty mgły.
