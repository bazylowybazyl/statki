# Wypiekacz nieba (tło kosmosu) — `src/3d/skybake/`

Stan: 2026-10-06. Kroki 1–3 zrobione: pętla oceny, styl „galaktyka” (w grze — § „W grze”: `nebula.webp`, jasność wg
strefy) i styl „mgławica” (mgławica objętościowa, § „Krok 3” — kandydat wypieczony, tło gry NIE podmienione).

## Po co

- Tło gry (`public/assets/nebula.png`, 5120 × 3200) to **cudza grafika** — w prawym dolnym rogu (~4560, 2580 px) podpis
  „Starkiteckt Designs”. Do gry na sprzedaż: licencja albo wymiana.
- Obrazy z sieci i z AI odpadają (prawa; proponowany plan „zero AI w kadrze”; ujawnianie AI na Steamie). Własny generator
  = własna treść.
- Decyzja (2026-10-06): generator jako **WYPIEKACZ** — tło liczone raz (narzędzie albo ekran ładowania), nie shader co
  klatkę. Wcześniejszy generator czasu rzeczywistego (`dema/tlo-kosmosu-webgpu.html`, 5 warstw 2D fbm) dawał „marmurkowy
  dym” — jedna skala zawijasów na cały kadr, bo co klatkę nie stać go na więcej.

## Jak gra pokazuje tło (zmierzone sondą w grze, `scripts/webgpu/niebo-gra.mjs`)

- `NebulaSystem` (`src/3d/planet3d.assets.js`): płaszczyzna 800 000 × 500 000 j. na z = −150 000, pass tła (warstwa 1),
  kamera perspektywy 35° (`core3d.js` `syncCamera`), paralaksa 0,02 względem Słońca.
- **Kadr gry = ~620 wierszy tekstury** (zoom 0,45, 1080p: 1103 × 621 tekseli) → powiększenie **1,74× przy 1080p, ~3,5×
  przy 4K**. Zoom prawie nie zmienia kadru (0,2 → 640 wierszy, 0,9 → 613).
- Lot Słońce → pas Kuipera przesuwa kadr o ~1/5 ekranu. W zwykłej grze widać **~10–20% pliku — środek**. Różnorodność tła
  = przełączanie per region, nie większy obraz.
- Menu (`menuBackdrop3D`, płat mgławicy, wzmocnienie 1,15): środek ~44 % × 42 % tekstury. Kamery 3D (`sky3D.js`): cała
  tekstura w rzucie stereograficznym, brzegi wygaszone. **Kompozycja: najważniejsze w środku.**
- Tło dostaje cień statku od słońca (`sunShaftBackdrop` w `createNebulaMaterial`). Na starym, ciemnym tle prawie
  niewidoczny; na jasnym tle (Droga Mleczna) to wyraźny ciemny pas od kadłuba — decyzja wyglądu (zostawić / osłabić na tle).

## Barwa: tekstura ↔ ekran (`skyGameColor.js`)

Gra: PNG (sRGB, dekodowany sprzętowo) → bloom gry (próg 0,9) → `acesGry` (bez ekspozycji) → `linearDoSrgb`.
`acesGry` miażdży głębokie czernie (0,01 → 0,004) i rozjaśnia półtony. Wypiek opisuje **obraz wyświetlany** (liniowo, `Dl`)
i zapisuje teksturę po **odwróceniu acesGry** — w grze wychodzi to, co na podglądzie.

- `Dl ≤ acesGry(1) ≈ 0,80` (biel). Tekstura > 0,9 dostaje bloom ≈ obraz > 0,78 — gaz trzymaj niżej, wyżej tylko gwiazdy.
- Eksport 8 bit z ditheringiem trójkątnym. PNG z ziarnem gwiazd ~35 MB, **WebP q0,92 ~4,3 MB**, JPEG ~4,6 MB (zmiana
  formatu = zmiana ścieżki w `NebulaSystem.init` + dema `warp-webgpu/sky.js`, `halo_ring_demo_env.js`).

## Pliki

| plik | co |
|---|---|
| `src/3d/skybake/skyBaker.js` | `SkyBaker`: passy stylu (QuadMesh → cele HalfFloat), „tekstura” (odwrotność ACES), eksport (sRGB8 + dither), `exportBlob(png/webp/jpeg)` |
| `src/3d/skybake/skyBakeNoise.js` | `skyHash` (u32, lustro `skyHashCpu`), `skyNoise`, `skyFbm`, `skyRidged`, `skyBillow` — płaskie funkcje z `setLayout` |
| `src/3d/skybake/skyGameColor.js` | `acesGryInv`, `srgbEncode` (TSL) + lustra CPU |
| `src/3d/skybake/skyBakeStars.js` | pole gwiazd WSPÓLNE stylów (`starFieldNode`: 4 siatki, rozkład potęgowy, barwa z temperatury, profil całkowany po tekselu; styl podaje `sampleAt(sp)` → gęstość, ciepło, przepuszczalność pyłu) |
| `src/3d/skybake/styleGalaktyka.js` | styl „galaktyka”: pola → gwiazdy → obraz, nastawy `gra` / `jasna` / `nasycona` / `naturalna` / `fioletowa` |
| `src/3d/skybake/styleMglawica.js` | styl „mgławica” (krok 3): zasięg → atlas światła → objętość (marsz w pasach) → gwiazdy → obraz, nastawy `gra` / `kolorowa` / `rozeta` / `filary` / `pylowa` / `fiolet` |
| `dema/niebo-webgpu.html` + `.js` | wypiekacz z panelem (lista stylów, suwaki, barwy, ziarno, pełna / ½ rozdzielczość — domyślnie pełna, piksele ekranu `devicePixelRatio`, eksport), podgląd postem gry; widoki GRA / MENU / CAŁOŚĆ / POLA (pola wg stylu — `style.debug`) / A/B 1:1 (§ „Kafle”); kadr GRA: przeciąganie, kółko — lupa, dwuklik — środek; `?styl=mglawica`, `?widok=ab`, `?lupa=2` |
| `scripts/webgpu/niebo-ab.mjs` | A/B rozdzielczości: ten sam kadr z tekstury, z kafla 1:1 i z kafla + oktawy przy lupach 1 / 2 / 4, arkusz wycinków bez skalowania i przegląd całości (`.tmp/niebo/ab/`) |
| `scripts/webgpu/niebo-arkusz.mjs` | pętla oceny: `--styl galaktyka|mglawica`, warianty (`gra:1` albo `mglawica/rozeta:3`) → widoki → arkusz obok referencji (`.tmp/niebo/ref/`, poza repo; domyślnie 1, 2, 3, 8 dla galaktyki, 4, 6, 7, 9 dla mgławicy), czasy passów, `--eksport preset:ziarno --format webp --jakosc 1`, `--pola` |
| `scripts/webgpu/niebo-gra.mjs` | prawdziwa gra z kandydatem podstawionym za `assets/nebula.png` (CDP Fetch, bez zmian w grze): menu, lot przy zoomach, kamera 3D, sonda kadru |
| `tests/skyBake.test.mjs` | lustra CPU, nastawy w zakresach, WGSL passów w Node (≤ 12 buforów uniformów) |

Uruchomienie: `npm run dev` → `/dema/niebo-webgpu.html` (Vite, three z `node_modules`), panel H. Pętla:
`node scripts/webgpu/niebo-arkusz.mjs --warianty gra:1,gra:7,nasycona:1 --res 1 --nazwa it07` → `.tmp/niebo/it07.png`;
mgławica: `node scripts/webgpu/niebo-arkusz.mjs --styl mglawica --warianty gra:3,rozeta:1 --res 0.5 --nazwa m21`.
W grze: `node scripts/webgpu/niebo-gra.mjs --tekstura .tmp/niebo/nebula-gra-1.webp --nazwa c` (bez `--tekstura` — obecne tło).

## Styl = passy pełnoekranowe

```js
{ name, passes: [{ name, type?, size?, strips?, sync?, node(ctx) → vec4 }], apply(params, seed, baker), params, colors, defaults, presets, debug? }
```

- `ctx.sky()` — współrzędne nieba: (piksel − środek) / wysokość, x ∈ ±0,8, y ∈ ±0,5, **y w dół** (wiersz 0 PNG = góra
  ekranu gry). `ctx.px` — piksel celu (`screenCoordinate`, środki +0,5). `ctx.load(nazwa, ivec2)` — odczyt celu
  wcześniejszego passu bez filtrowania; `ctx.sample(nazwa, uv)` — próbka dwuliniowa z poziomu 0 (atlas objętości
  światła; w pętli marszu tylko z jawnym poziomem — `textureSample` w rozbieżnej gałęzi to błąd WGSL). `ctx.size` —
  uniform rozmiaru WYPIEKU (pass z własnym `size` liczy swój piksel sam).
- Pass może mieć `size` (ułamek rozmiaru wypieku — cel pomocniczy, np. atlas ½), `strips` (liczba poziomych pasów:
  osobne zgłoszenia do kolejki GPU z `autoClear = false` i czekaniem na GPU między pasami — Windows resetuje GPU, gdy
  jedno zadanie trwa > ~2 s) i `sync` (poczekaj na GPU po passie). `baker.passMs` — czas każdego passu z ostatniego
  wypieku (panel i arkusz go pokazują). `style.debug = { pass, view(f) → vec3 }` — widok „pola” w demie.
- **Ostatni pass zwraca obraz wyświetlany `Dl` (liniowo, ≤ 0,8)**; resztę robi `SkyBaker`.
- Parametry to uniformy (zmiana suwaka = nowy wypiek bez przebudowy grafu, ~20–80 ms przy 5120 × 3200 na RTX 5080);
  ziarno przesuwa szumy (`o1…o8`) i losuje obiekty na CPU (`skyHashCpu`).
- Pułapki (AGENTS.md): funkcja z `setLayout` nie woła innej z layoutem (35) — szum wklejony; `Loop` zagnieżdżone z jawnymi,
  unikalnymi nazwami liczników (`gy${i}`); uniformy do funkcji z layoutem tylko parametrami (1); ≤ 12 buforów uniformów na
  etap (każdy `uniformArray` to osobny); ≤ 8 buforów storage w compute (gdy styl użyje compute).

### Galaktyka (krok 2)

- **pola** (L, τ, ρ, ciepło): profil pasa (rdzeń + poświata + ogon), zgrubienie, obłoki gwiazd (anizotropowy fbm z
  zawinięciem), grudkowatość; pył: pasmo przy płaszczyźnie z meandrami, szczeliny, grudki, włókna (grzbietowy multifraktal),
  prześwity, porowatość, odnogi; gęstość gwiazd ρ (pas, gromady).
- **gwiazdy**: 4 siatki komórek (ziarno 1,4 teksela → jasne 64 teksele z halo), rozkład jasności potęgowy, barwa z
  „temperatury”, gwiazdy tła gasną za pyłem z poczerwienieniem (`gwiazdyPyl` — średnia głębokość), profil Gaussa całkowany
  po tekselu (bez migotania podpikselowego).
- **obraz**: pas × przepuszczalność pyłu (część poświaty przed pyłem), brązowy blask pyłu, obłoki H II, mgiełka, gwiazdy →
  wywołanie jak w astrofotografii (ekspozycja → asinh po luminancji, barwy zostają → nasycenie → czerń, uniesienie cieni →
  ramię do bieli).
- Wnioski z pętli (2026-10-06): pas „jak zdjęcie” wymaga, żeby **ziarno gwiazd niosło większość światła** pasa (gładka
  poświata daje beżową plamę); pył z ostrymi progami wygląda jak wycinanka — miękkie progi + porowatość; poczerwienienie na
  całej szerokości pasa daje sepię — pył skupiony przy płaszczyźnie, gwiazdy neutralne. Nastawa `gra` jest ~40 % ciemniejsza
  od zdjęć: na jasnym tle kadłuby słabo się odcinały (zrzuty `niebo-gra.mjs`, A/B z obecnym tłem).

## W grze (2026-10-06, decyzje użytkownika)

- **Tło gry = `public/assets/nebula.webp`** — galaktyka, nastawa `gra`, ziarno 1, **BEZ GWIAZD** (`gwiazdy = 0`), WebP
  **bezstratny** (jakość 1 → blok VP8L, 9,8 MB); cudze `nebula.png` usunięte (zostaje w historii gita). Ścieżka w
  `NebulaSystem.init` (`planet3d.assets.js`) i w demach `warp-webgpu/sky.js`, `halo_ring_demo_env.js`.
  Eksport do gry: `niebo-arkusz.mjs --set gwiazdy=0 --eksport gra:1 --format webp --jakosc 1` i podmiana pliku.
- **Gwiazdy rysuje gra w rozdzielczości ekranu** (`src/3d/skyStars.tsl.js`, zgłoszenie „tło rozlane, nieostre, niskiej
  jakości”): gwiazdy wypieczone w tekselach wychodziły przy powiększeniu 1,7–3,5× miękkimi plamkami, a stratny WebP robił
  na gładkich ciemnych gradientach bloki barwy (4:2:0). Teraz tekstura niesie same gładkie warstwy, a gwiazdy liczy
  materiał: komórki w TEKSELACH tekstury (przyklejone do nieba: paralaksa, zgięcie warpa, rulon), profil Gaussa w PIKSELACH
  ekranu całkowany po pikselu, gęstość z jasności gładkiej tekstury (pas gęsto, pył rzadko), barwa z temperatury i odcienia
  miejsca, jasne gwiazdy łapią bloom gry. Te same gwiazdy w płacie mgławicy menu (`menuBackdrop3D.tsl.js`; teksele na
  piksel z pochodnych przed gałęziami). Kamery 3D (`sky3D`) — gładki pas + własne warstwy gwiazd nieba. Koszt w 4K na
  RTX 5080 niemierzalny (1,72 vs 1,78 ms klatki). Strojenie `SKY_STARS_TUNE`; test `tests/skyStars.test.mjs`.
  **Styl wypieku do gry eksportuj bez gwiazd** — inaczej wrócą rozlane plamki (dotyczy też stylu „mgławica”).
- **Cień statku na tle zostaje** (`sunShaftBackdrop` — „zostaw”).
- **Jasność wg strefy gry** (`src/game/skyRegion.js`, „w pasie asteroid ciemniejsza, pusta przestrzeń jaśniejsza”):
  przestrzeń międzyplanetarna × 1,3, pas asteroid × 0,55, Słońce × 0,9, orbity i studnie planet × 1. Mnożnik OBRAZU
  wyświetlanego: `createNebulaMaterial` liczy `acesGryInv(acesGry(tekstura) · jasność)` (uniform `brightness`), kamery 3D —
  wzmocnienie mgławicy w `sky3D` (przybliżenie). Strefa z `zoneState` (index.html → `window.setSkyZone`, przed
  `updatePlanets3D`), dojście płynne (stała 1,5 s). Menu bez zmian. Test: `tests/skyRegion.test.mjs`; w grze
  `niebo-gra.mjs` (kadr w pasie, sonda jasności).

## Otwarte

1. Gładkie warstwy (pył, poświata) są nadal powiększane 1,7–3,5× — miękkie, ale bez bloków. Gdyby brzegi pyłu raziły:
   drobny detal proceduralny w materiale (szum na brzegach pasm) albo wypiek przy ładowaniu w rozdzielczości ekranu.
   Kafle w gęstości ekranu — zmierzone, § „Kafle wysokiej rozdzielczości”.
2. Niebo per region także w WYGLĄDZIE (paleta, styl, przenikanie dwóch tekstur — logika regionów jest w
   `tlo-kosmosu-webgpu.html`); dziś strefy zmieniają tylko jasność.

## Kafle wysokiej rozdzielczości — A/B (2026-10-06)

Pytanie użytkownika: zamiast jednego obrazu 5120 × 3200 piec kawałki (kadr gry × 1,5) w wysokiej rozdzielczości i je
łączyć. Gra widzi z tekstury tylko środek (cały świat: ~2640 × 2160 tekseli, do pasa Kuipera ~1640 × 1160), więc kafle
wystarczyłyby tam; gęstość 1:1 z ekranem = 1,74× tekstury w 1080p, 3,5× w 4K.

- **Wypiekacz umie kafel** (`skyBaker.js`): cel = kafel, `size` = PEŁNE niebo w gęstości kafla, `origin` = początek
  kafla (`setRegion`); `ctx.px` / `ctx.sky` to piksel pełnego nieba (passy ½ — przeliczone), `ctx.loadAt(cel, piksel
  nieba, przesunięcie)` czyta cel poprzedniego passu w pikselu nieba. Passy `shared` stylu (atlas światła mgławicy —
  dziedzina = całe niebo) kafel POŻYCZA od wypiekacza bazowego (`shared`), przebudowa sama, gdy bazowy zmieni cele
  (`version`). `extraOctaves` → `U.dodOkt` stylu: kłęby, erozja, pył, żyły (mgławica), pył, grudki, włókna, odnogi
  (galaktyka). Sąsiednie kafle to ta sama funkcja nieba; brzegi: zasięg mgławicy czyta sąsiedztwo 3 × 3 obcięte do kafla
  (do łączenia kafli — zapas kilku tekseli), dither i drganie marszu z piksela nieba. Wypiek bazowy bez zmian (origin 0,
  `dodOkt` 0 — te same odczyty co dawniej). Test: `tests/skyBake.test.mjs` (kafel).
- **Widok A/B 1:1** w demie (klawisze 1–4: tekstura / kafel 1:1 / kafel + oktawy / podział): kafel = kanwa, gęstość
  dobrana tak, że piksel kafla trafia w piksel ekranu; lupa ×2 na ekranie 1080 = gra w 4K. Koszt kafla 1920 × 1080:
  mgławica ~0,3 s (pierwszy ~0,6–0,9 s — kompilacja), galaktyka ~5 ms.
- **Wynik** (`niebo-ab.mjs`, wycinki bez skalowania, `.tmp/niebo/ab/`): **mgławica** — kafel 1:1 nie daje widocznie
  ostrzejszego obrazu ani w 4K: treść jest gładka z natury (całka po promieniu uśrednia detal kłębów), a 2× więcej
  energii w laplasjanie kafla to głównie ziarno drgania marszu; dodatkowe oktawy ZMIENIAJĄ średnie kształty (remap progu
  i normalizacja sumy oktaw — wariant nie jest „to samo + drobniej”, przy przejściu tekstura → kafel byłby przeskok).
  **Galaktyka** — w 4K kafel 1:1 daje nieco ostrzejsze brzegi pyłu, widoczny zysk przynoszą dopiero dodatkowe oktawy
  (drobne smugi we włóknach; laplasjan 0,37 → 0,38 → 0,44). Wniosek: o ostrości tła decyduje dziś częstotliwość
  TREŚCI (najwyższa oktawa stylu), nie rozdzielczość tekstury — kafle opłacą się dopiero ze stylem, który ma detal w
  skali ekranu 4K (oktawy o stałej normalizacji, ostrzejsze brzegi), i wtedy z mapą kafli w materiale tła.

## Krok 3 — mgławica objętościowa (2026-10-06, zrobione; `src/3d/skybake/styleMglawica.js`)

Drugi styl wypiekacza w duchu referencji 4, 6, 7, 9 i dawnego tła Starkiteckt: rzeźbione kłęby oświetlone od środka,
jasne limby od strony gwiazd, ciemny pył z przodu o ostrej krawędzi, świecące jądra, barwne obrzeża; kompozycja pod grę
(masa główna przy środku tekstury, reszta czarna; gaz pod progiem bloomu). Referencje w `.tmp/niebo/ref/` — tylko do
oglądania, nie do repo. Pętla: `niebo-arkusz.mjs --styl mglawica` (iteracje m01–m20 w `.tmp/niebo/`), zrzuty z gry
`niebo-gra.mjs --tekstura .tmp/niebo/nebula-mglawica-gra-3.webp` (`.tmp/niebo/gra/m20-*.png`).

### Objętość

- Płyta z ∈ ±`grubosc` w jednostkach nieba, promień ortogonalnie wzdłuż −z (kamera z +z). Gęstość zgrubna (`coarse`):
  OBWIEDNIA MAS (gaussy elips: masa główna z nastaw + `masyLiczba` losowych wokół, z ziarna) MNOŻY fbm 3D PRZED
  progiem (`smoothstep(prog, prog + miekkosc, kształt · obwiednia^0,3)`) — obwiednia tylko ogranicza zasięg, krawędź masy
  zostaje ostra (obwiednia × próg dawała gaussowską mgłę); zawinięcie domeny (3 × szum 3D), ŻYŁY (grzbiety drugiego fbm
  dodane do kształtu), SPŁASZCZENIE wzdłuż z (`plaskosc`: szum próbkowany ze ściśniętą osią z — struktury wydłużone
  wzdłuż promienia wychodzą ostre w rzucie; izotropowy szum w rzucie ortogonalnym uśredniał się po z w miękkie plamy).
  Pył: osobna kolumna (obwiednia bez z, szerszy zasięg `pylZasieg`) skupiona przy zadanym z (`pylPrzod`: 0 tył … 1 przód),
  grzbiety (`pylZyly`) o szerokości zmiennej w dużej skali, ostra krawędź (`pylMiekk`).
- Detal (`detail`): kłęby `|szum|` 5 oktaw (`klebyCz`, `klebyDetal`) albo włókna (1 − |szum|, udział `wlokna`) i erozja
  jako REMAP (Schneider: dolny próg masy rośnie tam, gdzie detal jest niski — detal rzeźbi masę wszędzie, brzegi
  strzępiaste, wnętrze kłębiaste) + drobna erozja cienkich resztek (3 oktawy `erozjaCz`); odejmowanie erozji od masy
  dawało wycinankę (ostre łaty).
- Światło: 1–8 gwiazd-lamp (`gwiazdLiczba`; pierwsza przy masie głównej najjaśniejsza, z z `lampyPrzod`: 0 — w płycie,
  1 — przed nią). SAMOCIEŃ dwiema drogami: daleki — ATLAS OBJĘTOŚCI ŚWIATŁA (passy `swiatlo1` / `swiatlo2`, ½
  rozdzielczości, 8 × 8 kafli = 64 przekroje z, RGBA = przepuszczalność z woksela do gwiazd 0–3 / 4–7, `cienKroki`
  zgrubnych kroków po gęstości bez detalu × `SHADOW_DETAIL_MEAN`), bliski — `cienBliski` próbek ku gwieździe na gęstości
  Z DETALEM (3 oktawy kłębów, bez drobnej erozji; cień bliski na gęstości zgrubnej spłaszczał kłęby w szare plamy —
  relief ginął). Faza HG dwupłatowa (`faza` przedni + stały wsteczny −0,35: kłęby oświetlone od przodu też świecą),
  rozpraszanie wielokrotne √T · `wielokrotne`, otoczenie. Emisja ∝ ρ² (rekombinacja — jasne węzły w gęstym gazie) z
  FRONTEM JONIZACJI ionK² / (1 + ionK²) (strefa Strömgrena; łagodne k / (1 + k) różowiło cały gaz), Hα wszędzie, O III
  tylko przy silnej jonizacji. Całka front-to-back zachowująca energię, `Break` przy T < 0,004.
- Passy: `zasieg` (½, 48 próbek zgrubnych: odcinek t ∈ [0, 1] z gęstością > 0 i maksima — marsz główny czyta sąsiedztwo
  3 × 3 i puste piksele nic nie liczą), `swiatlo1` / `swiatlo2` (½, atlas), `objetosc` (pełna, 8 PASÓW po ~100 ms,
  `kroki` = 96 z drganiem startu; wyjście: radiancja × `RADIANCE_GAIN`, przepuszczalność T), `gwiazdy` (pole wspólne
  `skyBakeStars.js`; gwiazdy tła gasną za płytą z poczerwienieniem T^poczerwienienie; DOMYŚLNIE 0 — gra rysuje gwiazdy w
  rozdzielczości ekranu, § „W grze”), `obraz` (tło + mgiełka 2D skupiona przy mgławicy, objętość, gwiazdy, lampy: jądro
  Gaussa, halo potęgowe, kolce — za pyłem z przedniej ściany atlasu, w jednostkach pola gwiazd `LAMP_GAIN`; wywołanie jak
  w galaktyce: ekspozycja → asinh → nasycenie → czerń, cienie → ramię).
- Czas (RTX 5080): pełny wypiek 5120 × 3200 ≈ 1,0 s (marsz 0,8 s w 8 pasach, atlas 80 ms, zasięg 50 ms) — każdy pas
  pod limitem 2 s na zgłoszenie; ½ ≈ 0,3–0,5 s (panel na żywo). Eksport bezstratny WebP 9,5 MB.

### Wnioski z pętli (m01–m20)

- „Oświetlenie od środka” jak w dawnym tle = lampy W PŁYCIE (`lampyPrzod` 0,15) + gaz gęsty optycznie (`gestosc` 60) +
  spłaszczenie 0,8: światło przebija cienkie limby, grube kłęby są ciemne. Lampy przed płytą (0,7) dają płaski, równo
  oświetlony płat; gaz rzadki (2–3) — przezroczystą, jednolitą mgłę bez reliefu.
- Jednostki jasności: objętość i lampy liczone w jednostkach pola gwiazd (`RADIANCE_GAIN` 4, `LAMP_GAIN` 2000,
  `HAZE_GAIN` 12), ekspozycja ~0,025 jak w galaktyce — ten sam `SKY_DISPLAY_MAX`, gaz pod progiem bloomu.
- W grze (m15–m17): wypieczone pole gwiazd dwoiło obraz z gwiazdami gry (`skyStars.tsl.js`) i szarzyło kadr (średnia
  jasność pustego nieba w kadrze 40/255 wobec 8/255 ze starym tłem) — nastawa `gra` ma `gwiazdy` 0, tło i uniesienie
  cieni ~4× ciemniejsze niż domyślne galaktyki (`barwaTla` 0,0008–0,002, `uniesienie` 0,0004–0,0014). Kadłub Atlasa
  odcina się od tła na wszystkich zoomach (`m20-lot-z*.png`), w pasie asteroid tło przyciemnia strefa (`m20-pas-z0.45.png`),
  kamery 3D widzą masę w środku sfery (`m20-kamera3d.png`). Cień statku na tle (`sunShaftBackdrop`) na niebieskim gazie
  widoczny jak w galaktyce.
- Nastawy: `gra` (pod rozgrywkę — błękit i cyjan na limbach, magenta w jądrach, dużo czerni), `kolorowa` (prośba
  użytkownika 2026-10-06 „bardziej kolorowa”: lampy w czterech barwach PALETY — `lampyPaleta`, `paleta1…4` — gaz wokół
  każdej świeci inną barwą; odcień emisji per masa z tej samej palety — `masyBarwy`, `U.masyC`; trzy pasma emisji:
  O III przy gwiazdach, Hα dalej, pasmo ZEWNĘTRZNE `barwaZewn` × `emisjaZewn` przy słabej jonizacji; albedo gazu
  neutralne, nasycenie 1,75), `rozeta` (ref. 7: róż + turkus na turkusowej mgiełce), `filary` (ref. 9: złoto), `pylowa`
  (ref. 6: brązowy pył, zimne lampy, kolce), `fiolet` (ref. 4). Referencyjne to warianty barw i światła na TEJ SAMEJ geometrii (masa główna + satelity) — bez odwzorowania
  kompozycji referencji (obręcz rozety, filary); kompozycja per nastawa to robota na później.
- Kandydat do gry: `node scripts/webgpu/niebo-arkusz.mjs --styl mglawica --warianty gra:3 --res 1 --eksport gra:3 --format webp --jakosc 1`
  → `.tmp/niebo/nebula-mglawica-gra-3.webp`; w grze `node scripts/webgpu/niebo-gra.mjs --tekstura .tmp/niebo/nebula-mglawica-gra-3.webp --nazwa m20`.
  **Tło gry (`public/assets/nebula.webp`) NIE podmienione** — decyzja użytkownika (galaktyka czy mgławica, albo per region).

### Otwarte

1. Wybór tła: galaktyka (dziś w grze) czy mgławica `gra` — ocena użytkownika na zrzutach `.tmp/niebo/gra/m20-*.png`;
   docelowo per region (§ „Otwarte” wyżej, pkt 2).
2. Kompozycja referencyjnych nastaw (obręcz rozety, filary ref. 9) — dziś jedna geometria mas dla wszystkich nastaw.
3. Faza wsteczna stała (−0,35) i udział 0,35 — ewentualnie suwak.
