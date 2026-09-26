# Sprite'y statków — prompty do generatora (Z11)

Zadanie Z11 z `docs/PLAN-ruch-v2-w-grze.md` (§ 5). PNG generuje użytkownik i kładzie je w tym
katalogu pod nazwą z linii „Output”. Każdy `*.prompt.md`: tytuł, Output, notatki, akapit promptu po
angielsku — kopiować cały akapit od „Use case:” (najdłuższy ma 3 349 znaków, mieści się w limicie
4000). Obrazy wymienione w notatkach jako referencje dołączać do generatora.

## Konwencje (wszystkie sprite'y)

- PNG z prawdziwą alfą (nie namalowana szachownica), rzut ściśle z góry, ortograficzny; dziób w +X
  (w prawo), dysze w −X.
- Bez wieżyczek i luf: gniazda to puste okrągłe podstawy z zaślepkami (wieżyczki rysuje gra,
  `src/vfx/turret2D.js`). Bez płomieni, poświaty, tła, cienia rzucanego, napisów, cyfr i logo.
- Płótno 1774 × 887 (2:1) dla wszystkich nowych — cywilne jak dotąd, okręty w przedziale
  1700–1950 px. Sylwetka zajmuje 90% szerokości (~5% marginesu przy dziobie i rufie), wysokość wynika
  z proporcji. Puste pokłady mają płótno oryginału. Generator dawał dotąd ~1,57 Mpx przy zadanych
  proporcjach (1774 × 887, 1942 × 809, 1672 × 941); inne płótno dopełnić albo przyciąć
  przezroczystością do 2:1, nigdy nie rozciągać.
- Skala: gra rozciąga DŁUŻSZY bok PŁÓTNA do `length × 0,6` profilu (`getHullRenderSize`,
  `src/data/ships.js`). Piksele nie mają znaczenia, liczą się proporcje, a przezroczysty margines
  zmniejsza statek.
- Kotwica statku = środek płótna (wokół niego gra obraca kadłub), więc kadłub jest wyśrodkowany;
  asymetryczna Unia Pasa trzyma masę w środku.
- Kadłub na belkach (`src/game/hullBodies.js`) powstaje z alfy na siatce 15 j. świata, a komórka
  pokryta w mniej niż 20% (`minCoverage`, `src/game/beamSprite2D.js`) nie istnieje ani w kolizjach,
  ani w renderze skóry kadłuba. Komórka w px płótna 1774: kuter 148, fregata 139, Corvus 123,
  ratownik 111, łowca 101, niszczyciel 92, krążownik 43, nosiciel 25, ciężki frachtowiec 15. Stąd
  w promptach zwarta, spójna sylwetka bez cienkich anten i kolców; wysięgniki, chwytaki i odsłonięte
  kręgosłupy są grube, bo przerwa w bryle rozcina kadłub.
- Styl: okręty frakcji jak okręty gry (Terra Nova, piraci — realistyczny malowany hard-surface;
  referencją jest kadłub Terra Novy tej klasy, tylko dla jakości renderu). Role cywilne jak zestaw
  `assets/*.png` (grafit + jasna szarość, ciemne kontury, bursztynowe lampki). Corvus jak Atlas.
- Każdy kadłub bojowy ma namalowany wyraźny blok dowodzenia wolny od gniazd — na nim stanie model 3D
  mostka.

## Lista

Obwiednia = `length × 0,6` × `2 × radius × 0,6` (gabaryt stanowiska w porcie). „≈ w grze” = sylwetka
przy 90% szerokości płótna.

| # | prompt → PNG | co | profil L × R → obwiednia | sylwetka · % płótna (szer. × wys.) | ≈ w grze (j.) | prio |
|---|---|---|---|---|---|---|
| 1 | `heavy_freighter` | ciężki frachtowiec (dziś zastępczo `long_haul_freighter.png`) | 3000 × 550 → 1800 × 660 | 2,75 : 1 · 90 × 65 | 1620 × 590 | P2 |
| 2 | `corvus` | Corvus, fregata rakietowa gracza (dziś sprite Custosa) | 360 × 130 → 216 × 156 | 2,2 : 1 · 90 × 82 | 194 × 88 | P2 |
| 3 | `police_cutter` | kuter policji / celników | 300 × 110* → 180 × 132 | 2,1 : 1 · 90 × 86 | 162 × 77 | P3 |
| 4 | `bounty_hunter` | łowca nagród | 440 × 150* → 264 × 180 | 3,0 : 1 · 90 × 60 | 238 × 79 | P3 |
| 5 | `rescue_ship` | statek ratunkowy | 400 × 150* → 240 × 180 | 2,2 : 1 · 90 × 82 | 216 × 98 | P3 |
| 6 | `mars_frigate` | Stocznie Marsjańskie — fregata | 320 × 120 → 192 × 144 | 2,2 : 1 · 90 × 82 | 173 × 79 | P1 |
| 7 | `mars_destroyer` | Stocznie Marsjańskie — niszczyciel | 480 × 170 → 288 × 204 | 2,0 : 1 · 90 × 90 | 259 × 130 | P1 |
| 8 | `mars_cruiser` | Stocznie Marsjańskie — krążownik | 1040 × 220 → 624 × 264 | 2,4 : 1 · 90 × 75 | 562 × 234 | P2 |
| 9 | `mars_carrier` | Stocznie Marsjańskie — nosiciel | 1800 × 320 → 1080 × 384 | 2,8 : 1 · 90 × 64 | 972 × 347 | P3 |
| 10 | `inner_frigate` | Konsorcjum Wewnętrzne — fregata | 320 × 120 → 192 × 144 | 2,4 : 1 · 90 × 75 | 173 × 72 | P1 |
| 11 | `inner_destroyer` | Konsorcjum Wewnętrzne — niszczyciel | 480 × 170 → 288 × 204 | 2,2 : 1 · 90 × 82 | 259 × 118 | P1 |
| 12 | `inner_cruiser` | Konsorcjum Wewnętrzne — krążownik | 1040 × 220 → 624 × 264 | 2,5 : 1 · 90 × 72 | 562 × 225 | P2 |
| 13 | `inner_carrier` | Konsorcjum Wewnętrzne — nosiciel | 1800 × 320 → 1080 × 384 | 2,9 : 1 · 90 × 62 | 972 × 335 | P3 |
| 14 | `belt_frigate` | Unia Pasa — fregata | 320 × 120 → 192 × 144 | 2,2 : 1 · 90 × 82 | 173 × 79 | P1 |
| 15 | `belt_destroyer` | Unia Pasa — niszczyciel | 480 × 170 → 288 × 204 | 2,0 : 1 · 90 × 90 | 259 × 130 | P1 |
| 16 | `belt_cruiser` | Unia Pasa — krążownik | 1040 × 220 → 624 × 264 | 2,4 : 1 · 90 × 75 | 562 × 234 | P2 |
| 17 | `belt_carrier` | Unia Pasa — nosiciel | 1800 × 320 → 1080 × 384 | 2,8 : 1 · 90 × 64 | 972 × 347 | P3 |
| 18 | `outer_frigate` | Konsorcjum Zewnętrzne — fregata | 320 × 120 → 192 × 144 | 2,8 : 1 · 90 × 64 | 173 × 62 | P1 |
| 19 | `outer_destroyer` | Konsorcjum Zewnętrzne — niszczyciel | 480 × 170 → 288 × 204 | 2,6 : 1 · 90 × 69 | 259 × 100 | P1 |
| 20 | `outer_cruiser` | Konsorcjum Zewnętrzne — krążownik | 1040 × 220 → 624 × 264 | 3,0 : 1 · 90 × 60 | 562 × 187 | P2 |
| 21 | `outer_carrier` | Konsorcjum Zewnętrzne — nosiciel | 1800 × 320 → 1080 × 384 | 3,2 : 1 · 90 × 56 | 972 × 304 | P3 |
| 22 | `inter_station_shuttle_empty` | pusty pokład promu (edycja) | 200 × 80 → 120 × 96 | jak oryginał | jak oryginał | P1 |
| 23 | `container_ship_empty` | pusty pokład kontenerowca (edycja) | 520 × 180 → 312 × 216 | jak oryginał | jak oryginał | P1 |
| 24 | `long_haul_freighter_empty` | pusty pokład frachtowca dalekiego zasięgu (edycja) | 900 × 260 → 540 × 312 | jak oryginał | jak oryginał | P1 |
| 25 | `heavy_freighter_empty` | pusty pokład ciężkiego frachtowca (edycja #1) | 3000 × 550 → 1800 × 660 | jak #1 | jak #1 | P2 |
| 26 | `megafreighter_empty` | pusty pokład megafrachtowca (edycja) | 4600 × 760 → 2760 × 912 | jak oryginał | jak oryginał | P2 |
| 27 | `megafreighterwagon_empty` | pusty pokład wagonu megafrachtowca (edycja, płótno 1672 × 941) | stały prostokąt 2760 × 1554 | jak oryginał | jak oryginał | P2 |

\* Profile nowych ról — liczby ze zlecenia; w `HULL_RENDER_PROFILES` jeszcze ich nie ma.

## Priorytety

- **P1 — najpierw.** Puste pokłady trzech najczęstszych frachtowców (#22–24): to tanie edycje,
  a klasy S/M/L to ~90% cumowań (plan § 2, Jowisz: S 18%, M 51%, L 21%). Bez nich Z5/Z14 nie pokażą
  kontenerów. Do tego fregaty i niszczyciele czterech frakcji (#6, 7, 10, 11, 14, 15, 18, 19) — 84%
  budowanych kadłubów (`FLEET_DOCTRINE`, `src/game/traffic/shipyards.js`).
- **P2.** Ciężki frachtowiec (#1) i zaraz po nim jego pusty pokład (#25), puste pokłady
  megafrachtowca i wagonu (#26–27), Corvus (#2 — kadłub gracza w sprzedaży, dziś na cudzym
  sprite'cie), krążowniki (#8, 12, 16, 20 — 13% kadłubów).
- **P3.** Nowe role, których jeszcze nie ma w kodzie (#3–5), i nosiciele (#9, 13, 17, 21 — 3%
  kadłubów).

## Puste pokłady (#22–27)

- To edycja oryginału (dołączyć go), najlepiej inpainting z maską tylko na ładowni. Płótno, obrys,
  położenie i skala muszą zostać identyczne: z PNG liczone są obrys kolizji portu i położenie dysz
  (`src/3d/haloRing/haloPortHulls.js`), kadłub na belkach powstaje z alfy, a wagon stoi w stałym
  prostokącie składu (`src/game/megafreighterTrain.js`). Jeśli generator przesunie obrys, przenieść
  z wyniku na oryginał tylko wnętrze ładowni.
- Pokład: ciemnografitowa podłoga z siatką płyt, bursztynowe obrysy slotów, zamki kontenerowe
  w narożnikach, prowadnice. Jasne kontenery 3D mają na nim kontrast.
- Siatka slotów dla Z5 (`src/data/cargoContainers.js`, plan § 3.4):

| sprite | płótno | ładownia po edycji | sloty | plan § 3.4 |
|---|---|---|---|---|
| prom | 1774 × 887 | górny i dolny rząd po 4; środkowy rząd → kil bez slotów | 8 | van 8 |
| kontenerowiec | 1774 × 887 | 3 × 6, miejsca domalowanych kontenerów | 18 | hauler 18 |
| frachtowiec dalekiego zasięgu | 1774 × 887 | 2 × 7 zatok, każda dzielona wzdłuż statku na 2 sloty | 28 | bulk 28 |
| ciężki frachtowiec | 1774 × 887 | 3 × 8 zatok, każda na 2 sloty | 24 zatoki / 48 slotów | heavy 14 — z zastępczego sprite'a, do aktualizacji w Z5 |
| megafrachtowiec | 1774 × 887 | 2 × 10 zatok, każda na 2 sloty; środkowy rząd → kil bez slotów | 20 / 40 | mega ~20 |
| wagon megafrachtowca | 1672 × 941 | 2 × 8 zatok, każda na 2 sloty | 16 / 32 | — |

- Poza Z11: lokomotywa `assets/megafreighterfront.png` (3 rzędy × 11 modułów) i moduł ogonowy
  `assets/megafrieghterback.png` (2 × 8) też mają domalowany ładunek. Jeśli skład megafrachtowca ma
  wozić kontenery 3D, potrzebne są analogiczne edycje.

## Pole sylwetki = HP i masa (okręty frakcji)

Kadłub na belkach bierze HP węzłów i masę zderzeń z pola sylwetki (`hexPerNode`, `massPerArea`
w `hullBodies.js`), więc proporcje to też balans. Pole rodzin szacowane przy wypełnieniu ramki
0,6–0,75, jak u obecnych kadłubów.

| klasa | Terra Nova dziś (sylwetka w grze, pole) | rodziny (proporcje → sylwetka) | pole względem Terra Novy |
|---|---|---|---|
| fregata | Custos 152 × 66, 6,4 tys. j.² | 2,2–2,8 : 1 → 173 × 62–79 | ~1,0–1,3× |
| niszczyciel | Hasta 246 × 138, 18,9 tys. j.² | 2,0–2,6 : 1 → 259 × 100–130 | ~0,8–1,1× |
| krążownik | Bellator 623 × 385, 174 tys. j.² | 2,4–3,0 : 1 → 562 × 187–234 | ~0,4–0,55× |
| nosiciel | Citadella 1072 × 434, 354 tys. j.² | 2,8–3,2 : 1 → 972 × 304–347 | ~0,6–0,7× |

**Do decyzji:** krążowniki i nosiciele frakcji mieszczą się w obwiedniach profilu (624 × 264,
1080 × 384), więc wychodzą słabsze od Bellatora i Citadelli, które te obwiednie przekraczają
(Bellator ma 1,6 : 1 i zero marginesu). Równie twarde okręty frakcji to albo szersza sylwetka (poza
obwiednią stanowiska — `fit` w porcie liczy się z profilu), albo korekta HP w danych.

## Gniazda

Liczby wg `spec` odpowiednika Terra Novy (`src/data/ships.js`):

| kadłub | główne | specjalne | rakietowe | aux | hangary | dysze MAIN w promptach |
|---|---|---|---|---|---|---|
| fregata frakcji | 4 | 1 | 2 | 2 | 1 | 2 (Pas: 2 różne + pomocnicza; KZ: 1 duża + 2 małe) |
| niszczyciel frakcji | 10 | 1 | 4 | 4 | 1 | Mars 4, KW 3, Pas 3, KZ 3 |
| krążownik frakcji | 12 | 1 | 6 | 6 | 2 | 4 |
| nosiciel frakcji | 8 | 1 | 4 | 8 | 4 | Mars 6, KW 4, Pas 6, KZ 4 |
| Corvus | 2 | 1 | 12 komór | 4 | 2 | 2 |
| łowca nagród | 3 | — | — | — | — | 2 |
| kuter policji | 1 | — | — | 1 | — | 2 |

- Główne to średnie okrągłe podstawy z zaślepką, aux — małe, specjalne — większe (~1,5×), rakietowe
  — płaskie prostokątne łoża z zamkniętą pokrywą (Corvus: komory VLS), hangary — prostokątne wrota.
  Średnica głównej w promptach: fregata 1/16 długości, niszczyciel 1/20, krążownik 1/28,
  nosiciel 1/36.
- Gniazda kutra policji to propozycja (zlecenie ich nie podawało) — do usunięcia z promptu, jeśli
  kuter ma być nieuzbrojony.
- Domyślne układy edytora Terra Novy mają inne liczby niż `spec` (Custos 3 główne + 2 aux, Hasta
  4 + 4, Bellator 13 głównych + 4 rakietowe + 14 aux). Nadmiarowa podstawa z zaślepką czyta się jak
  zaślepione gniazdo, więc nie przeszkadza.
- Generatory słabo liczą: po wygenerowaniu policzyć podstawy, a braki albo nadmiar poprawić edycją
  (inpainting).

## Po wygenerowaniu

### Okręty bojowe — 16 kadłubów frakcji, Corvus, kuter policji, łowca nagród

1. **Rejestracja kadłuba:** `HULL_RENDER_PROFILES` (`src/data/ships.js`; frakcje z profilem
   odpowiednika Terra Novy, nowe role z liczbami z listy), `HULL_SPRITE_PATHS_BY_ID`
   i `getNpcHullRenderProfileId` (`index.html`), `WEAPON_TIER_BY_HULL` (bez wpisu wieżyczki dostają
   rozmiar Capital), rejestr kadłubów ruchu (Z4, `src/data/trafficHulls.js`).
2. **Mostek** — od razu, dla każdego kadłuba bojowego: `docs/BRIEF-mostek-nowego-kadluba.md`
   (strefa w `BRIDGE_LAYOUT_PROPOSALS` na namalowanym bloku dowodzenia, model w
   `src/3d/bridge3DShapes.js`, paleta w `src/3d/bridge3D.js`). Corvus: nowa strefa zamiast aliasu
   `corvus → frigate` (`src/game/shipBridgeRuntime.js`).
3. **Dysze MAIN** — wpis w `ENGINE_FX_DEFAULTS` (`src/data/engineFx.js`: `mainNozzle` = średnica
   wylotu w px PNG, palety frakcji); pilnuje `tests/engineFx.test.mjs`.
4. **Gniazda w edytorze** — `SHIP_DEFS` (`src/ui/hardpointEditor.js`) i domyślne
   w `SHIP_EDITOR_DEFAULTS.ships` (`src/data/hardpointEditorDefaults.js`): markery na namalowanych
   podstawach, tam też dysze MAIN/SIDE i światła pozycyjne.

### Cywilne — ciężki frachtowiec, statek ratunkowy, puste pokłady: bez mostka

- Rejestracja jak wyżej (bez `WEAPON_TIER_BY_HULL`); dysze bez wpisu w `ENGINE_FX_DEFAULTS` biorą
  `ENGINE_FX_FALLBACK`.
- Ciężki frachtowiec: podmiana zastępczego sprite'a w `src/3d/haloRing/haloPortHulls.js` — nowy
  obrys kolizji z alfy i położenie dysz (4, nie 3).
- Puste pokłady mają geometrię oryginału — tylko nowa ścieżka obrazu; wybór pusty / pełny należy
  do Z5/Z14.
