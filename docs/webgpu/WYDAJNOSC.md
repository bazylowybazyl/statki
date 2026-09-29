# Wydajność i precyzja portu WebGPU (zadanie 23)

Stan z 2026-09-28, gałąź `webgpu/23` (od `be4c5e4`). Pomiary: Windows 11, Ryzen 7 7800X3D, RTX 5080 (sterownik
32.0.16.1088), Chrome 153 headless, 1920 × 1080, bez vsync (`--disable-gpu-vsync --disable-frame-rate-limit`),
three 0.183.2. Baza = tag `webgl-baseline` (worktree `statki-wt/tag13`, ten sam harness — skrypty skopiowane
bez commitu). **A/B zawsze naprzemiennie** (tag, main, tag, main…), mediany; bezwzględne liczby między seriami się
różnią (inne sesje obciążały maszynę do ~12:20 — tag w serii „po bloomie” ma 198 FPS zamiast 134–146), więc
porównanie = stosunek w obrębie serii. Surowe dane: `.tmp/webgpu/zadania/23/` (głównego repo).

## Podsumowanie

| | przed zadaniem 23 | po zadaniu 23 | baza WebGL |
|---|---:|---:|---:|
| **duża bitwa** (148 okrętów, `profil-bitwy.mjs`) — FPS main / tag | 79 / 146 (**54%**) | 167 / 198 (**84%**) | — |
| Core3D.render CPU (bitwa) | 4,02 ms | 1,47 ms | 0,79 ms (+ overlay efektów) |
| draw calle (bitwa) | 117 | 49 | 85 |
| sceny bez ognia — CPU Core3D.render | +0,6…1,0 ms nad bazą | +0,15…0,40 ms nad bazą | 0,23–0,42 ms |
| sceny bez ognia — GPU klatki | 2–4 × taniej niż baza | 2–5 × taniej | 0,48–1,99 ms |
| drżenie efektów (nowe pule) | nie mierzone (narzędzie na starych modułach) | ≤ 0,008 px RMS poza smugami z1,8 (0,018) i dymem rakiet 7 mln z2 (0,029) | stare moduły 0–0,008 |
| obraz | — | harness 191 zrzutów ≤ 2/255 po każdej poprawce (poza znanym szumem `planeta-cien`) | — |

Co zjadało CPU: three r183 na WebGPU liczy każdy rysunek (~15–25 µs: przegląd wszystkich wiązań grupy „object”,
węzły per obiekt, atrybuty) i każdy `renderer.render()` (~40 µs: lista, kontekst, klucze, pass, zgłoszenie) 3–5 ×
drożej niż WebGL. Bitwa miała ~145 rysunków skór kadłubów, bloom — 12 renderów na klatkę, ~300 wywołań
`writeBuffer` na klatkę. Poprawki (każda z harnessem: obraz bez zmian):

| commit | poprawka | zysk |
|---|---|---|
| a957d4e | wysyłka zmienionych zakresów zamiast `DynamicDrawUsage` (pełny bufor przy każdym renderze) | ~1,2 MB/klatkę mniej w bitwie 48 okrętów |
| c214909 | znaczniki czasu GPU co 4. klatkę | koszt passów z `timestampWrites` |
| 9265ee0 | dach ringu przy pełnym zaniku bez rysunku | GPU: pełne cieniowanie pod `discard` |
| 33f9196 | kopie CPU buforów liczonych tylko na GPU oddane | ~140 MB RAM (dym, mgławica, pule efektów, ośrodek warpa) |
| 2b49fd1 | dane per kadłub w buforze storage slotu (`HullObjectStore`) | rysunek skóry 23 → 19 µs |
| f2bcc2a | partie skór kadłubów — jeden rysunek na zestaw tekstur (`hullSkinBatch.js`) | ~145 rysunków → 5–8 |
| 64841cc | klucz świateł three z pamięci (`tsl/kluczSwiatel.js`) | ~10 µs na każdy `render()` |
| 64841cc | mapa cienia i łapacz pomijane bez rzucających w kadrze cienia | −0,2 ms, −2 passy w bitwie |
| 6b2e42a | jeden `writeBuffer` na bufor uniformów zamiast na uniform | 295 → 213 zapisów/klatkę |
| 6b2e42a | ruch i światło pul efektów broni w jednym passie compute | do 4 zgłoszeń mniej |
| 56eadc6 | bloom: 12 kerneli w JEDNYM passie compute zamiast 12 renderów (cele bit w bit) | ~0,5 → 0,03 ms CPU; hud 1,33 → 0,71 ms |
| c9eaf2e | spawn wszystkich pul efektów broni i krok z emisją dymu rakiet — po jednym passie compute | wywołania compute na klatkę −2…5 |

## 1. Metoda i narzędzia

- `scripts/profil-bitwy.mjs --side 74 --warm 40 --prof 6 --zoom 0.1 --wrecks 59 --seed 12345` — duża bitwa
  (148 okrętów), 3 × tag ↔ main naprzemiennie (`bitwa-ab.sh` w scratchpadzie sesji; wyniki `bitwa-ab/<seria>/`),
  próbki PerfHUD po profilu + profil CDP (`.cpuprofile`, analiza: `scripts/webgpu/profil-analiza.mjs`).
- `scripts/webgpu/zrzuty.mjs --sceny hud,ring-z02,k7-hala,kalibracja,slonce --wydajnosc` — sceny bez ognia (czas
  stoi, 60 klatek) i bitwa harnessu 48 okrętów w czasie rzeczywistym, 3 × naprzemiennie (`ab-sceny/r1`, `r2`).
- `scripts/webgpu/koszt-klatki.mjs` — A/B w jednej stronie (`--ab`), fazy renderu obiektu (`--fazy`: µs na rysunek wg
  materiału), spis rysunków (`--spis`), zapisy do kolejki GPU (`--zapisy`: writeBuffer / writeTexture wg źródła),
  graf sceny (`--graf`).
- `scripts/webgpu/sprawdz-wysylki.mjs` (stan buforów GPU = CPU), `scripts/webgpu/bloom-parzystosc.mjs` (bloom compute
  vs BloomNode bit w bit), `scripts/webgpu/drzenie-gra.mjs` (drżenie w grze), `scripts/webgpu/pamiec.mjs` (pamięć GPU
  w cyklach), `scripts/webgpu/bez-webgpu.mjs` (gra bez WebGPU), `scripts/webgpu/profil-klatek.mjs`.
- Obraz po każdej poprawce: pełny harness (`zrzuty.mjs --backend webgpu --uuid osobne --baza <poprzedni przebieg>`),
  191 zrzutów; próg: ≤ 2/255 (poza `planeta-cien` — obrót stacji Wenus zależy od liczby klatek ładowania, szum
  0,24–0,52% pikseli na ramionach stacji w każdym przebiegu).

## 2. Duża bitwa (148 okrętów)

Mediany 9 próbek na stronę (3 przebiegi × 3), `profil-bitwy.mjs`:

| seria (main) | FPS tag | FPS main | main / tag | klatka tag / main [ms] | Core3D tag / main [ms] | rysunki main | ortho main [ms] | bloom main [ms] | efekty GPU main [ms] |
|---|---:|---:|---:|---|---|---:|---:|---:|---:|
| przed (be4c5e4 + narzędzia) | 146 | 79 | 54% | 6,84 / 12,68 | 0,95 / 4,02 | 117 | 1,78 | 0,45 | 0,65 |
| partie skór (f2bcc2a) | 141 | 90 | 64% | 7,11 / 11,12 | 1,06 / 3,25 | 76 | 1,28 | 0,49 | 0,64 |
| klucz, cień, uniformy (6b2e42a) | 134 | 99 | 74% | 7,46 / 10,06 | 1,05 / 2,85 | 77 | 1,08 | 0,36 | 0,56 |
| bloom compute (56eadc6) | 198 | 167 | **84%** | 5,04 / 5,98 | 0,79 / 1,47 | 49 | 0,63 | 0,03 | 0,34 |

- **Fizyka bez regresji na krok** (profil CDP: tag 2,6–3,4 ms/krok, main 2,9 ms/krok). Na klatkę main liczył więcej, bo
  dłuższa klatka = więcej kroków 120 Hz — każda 1 ms renderu mniej to ~1,6 ms klatki mniej.
- Tag ma dodatkowo overlay efektów (osobny renderer WebGL, ~0,3–0,6 ms poza Core3D.render); w main efekty broni
  i rakiet (nowe, z dem) liczą się w Core3D (kolumna „efekty GPU”).
- Zostało (main − tag, seria ostatnia): ~0,7 ms CPU Core3D. Pass ortho ~40 rysunków po ~15 µs (tarcze 5–12 ×
  ~20 µs — kandydat do partii jak skóry; pule efektów, rakiety, dysze SIDE — osobne materiały), klatka efektów GPU
  0,3–0,5 ms (spawn pul i krok z emisją dymu rakiet scalone już po tej serii — c9eaf2e, wywołania compute −2…5
  na klatkę; seria nie była powtórzona).

Hotspoty przed poprawkami (profil CDP main, ms/klatkę): passy sceny 2,54 (skóry kadłubów ~145 × 23 µs), post
z bloomem 0,57 (12 renderów po ~45 µs: klucz świateł three ~10 µs, submit ~8, begin ~7), writeBuffer 0,77 (~300
wywołań — three r183 zapisuje każdy zmieniony uniform osobno), klatka efektów GPU 0,73, mapa cienia + 2 łapacze
0,2 (w bitwie bez rzucających), MainExhaustJets 0,11 (~170 KB instancji na klatkę).

## 3. Sceny bez ognia (koszt samego portu)

Mediany 3 przebiegów na stronę, 60 klatek przy stojącym czasie (`zrzuty.mjs --sceny … `), CPU = Core3D.render,
GPU = `gpuFrameMs` (znaczniki czasu):

| scena | CPU tag | CPU main przed bloomem compute (r1) | CPU main (r2) | GPU tag | GPU main (r2) | rysunki tag / main |
|---|---:|---:|---:|---:|---:|---|
| hud | 0,415 | 1,245 (tag 0,58) | 0,675 | 0,551 | 0,198 | 41 / 24 |
| ring-z02 | 0,41 | 1,54 (tag 0,51) | 0,805 | 0,613 | 0,256 | 45 / 29 |
| k7-hala | 0,385 | 1,365 (tag 0,53) | 0,70 | 1,989 | 1,268 | 52 / 36 |
| slonce | 0,23 | 0,86 (tag 0,29) | 0,375 | 0,755 | 0,156 | 22 / 6 |
| kalibracja | 0,315 | 1,09 (tag 0,44) | 0,525 | 0,479 | 0,161 | 32 / 16 |

- CPU: main +0,15…0,40 ms nad bazą (było +0,6…1,0) — reszta to stały koszt renderów three (5–7 passów sceny,
  maska słońca, „uber” po ~20–40 µs) i rysunków (~15 µs). **Kryterium „CPU nie gorsze niż baza o więcej niż szum”
  nie jest spełnione dosłownie** (0,2–0,4 ms przy klatce 2,7–3,7 ms), GPU jest 1,5–5 × szybsze.
- Bitwa harnessu (48 okrętów, czas rzeczywisty, `--wydajnosc`): r2 — tag 366 FPS (klatka 2,78 ms, Core3D 0,58),
  main 271 FPS (klatka 3,72, Core3D 1,49 z klatką efektów 0,31, GPU 0,65 vs 0,90).

## 4. Koszty stałe three r183 na WebGPU (co zostaje i dlaczego)

`koszt-klatki.mjs --fazy` (µs CPU na rysunek, bitwa): skóra kadłuba w partii ~30–40 µs (1 rysunek na ~20 kadłubów),
tarcza ~20 µs, pass bloomu (przed 56eadc6) ~22 µs + ~20 µs samego `render()`. Po stronie three: `RenderObjects.get`
(klucz dynamiczny), `Bindings._update` przegląda KAŻDE wiązanie grupy „object” przy każdym rysunku (tekstury,
samplery, bufory storage), `NodeManager.updateForRender` (węzły OBJECT), `Geometries.updateForRender` (wersje
atrybutów). WebGL w bazie: ~7 µs na rysunek. Wnioski do `agents.md` (Wydajność): dane per obiekt w buforze storage
ze slotem, partie, compute zamiast serii przebiegów pełnoekranowych, zakresy wysyłki zamiast `DynamicDrawUsage`.

## 5. Drżenie

`scripts/webgpu/drzenie-gra.mjs --klatki 16` (nowe narzędzie — `dema/precyzja-drzenie.js` stoi na demie mostków bez pul
efektów z zadań 12–22): gra z harnessem, czas stoi, bitwa jak scena `bitwa` + salwa rakiet, 180 klatek walki; kamera
co klatkę o DOKŁADNIE 1 px po przekątnej, moduł wył./wł. w każdej klatce, Lucas–Kanade, drżenie = reszty po dryfie.
Odczyt samej warstwy 3D (celownik HUD przy kursorze stoi na ekranie i zasłaniał efekt — udawał 0,26 px), tło i planety
schowane (gwiazdy i mgławica z paralaksą pod addytywnym efektem po ACES udawały do 1,4 px), bloom / promienie /
gorące powietrze / zniekształcenia wyłączone. Kontrola metody (`--staly`, kamera stoi): ≤ 0,005 px.

Drżenie RMS / maks [px] (surowe: `.tmp/webgpu/zadania/23/drzenie/`):

| moduł | 0,12 mln z1,8 | 7 mln z1,8 | 7 mln z0,9 | 7 mln z2 | 9,9 mln z1,8 | baza (stary moduł, z1,8 przy 0 / 7 mln) |
|---|---|---|---|---|---|---|
| pociski (`wfxProjectiles`) | 0,002 / 0,004 | 0,002 / 0,004 | 0,001 / 0,001 | 0 / 0 | 0,002 / 0,004 | bullets 0,001 / 0 |
| smugi (`wfxTrails`) | 0,018 / 0,035 | 0,019 / 0,035 | 0,003 / 0,005 | 0 / 0 | 0,007 / 0,015 | trails 0,008 / 0 |
| błyski ADD (`wfxAdd`) | 0,002 / 0,003 | 0,001 / 0,003 | 0 / 0,001 | 0 / 0 | 0,002 / 0,003 | muzzle 0,001 / 0 |
| iskry i łuki broni | 0,002 / 0,003 | 0,002 / 0,003 | 0 / 0,001 | 0 / 0 | 0,001 / 0,002 | — |
| dym broni | 0,001 / 0,002 | 0,001 / 0,002 | 0 / 0,001 | 0 / 0 | 0,001 / 0,002 | — |
| odłamki broni | 0,002 / 0,004 | 0,002 / 0,004 | 0,003 / 0,006 | 0 / 0 | 0,002 / 0,004 | — |
| dym rakiet | 0,001 / 0,002 | 0,001 / 0,001 | 0 / 0 | **0,029 / 0,056** | 0,001 / 0,002 | — |
| rakiety (ciała, płomienie, blask, kule ognia, łuki) | 0,007 / 0,013 | 0,007 / 0,012 | 0,001 / 0,001 | 0 / 0 | 0,012 / 0,025 | — |
| Fx3D | 0,003 / 0,005 | 0,003 / 0,005 | 0 / 0 | 0 / 0 | 0,004 / 0,006 | fx 0,001 / 0 |
| dysze MAIN + SIDE | 0,001 / 0,001 | 0,001 / 0,001 | 0 / 0 | 0 / 0 | 0,001 / 0,001 | exhaust: brak |
| światła pozycyjne | 0,002 / 0,003 | 0,002 / 0,003 | 0,002 / 0,004 | 0,002 / 0,004 | 0,001 / 0,002 | lights 0,003 / 0,003 |

- Wynik przy 0,12 mln i przy 7 mln jest (prawie) identyczny — przesunięcie świata o 7 mln j. nie dokłada błędu
  (początek przy kamerze, macierz model-widok w double). Zoom 2 przy 7 mln (krok kamery 0,5 j. trafia w siatkę float32):
  dokładne zera.
- **Smugi 0,018 px przy z1,8** — tak samo przy 0,12 mln jak przy 7 mln, więc nie precyzja float32: cienkie linie
  (szerokość ~1 px, włókna z szumu) przy kroku kamery niewspółmiernym z siatką — próg 0,01 przekroczony o ułamek
  setnej piksela (baza starych smug: 0,008). **Dym rakiet 0,029 px tylko przy 7 mln z2**: samocień z mapy gęstości
  rozpiętej nad KADREM (`rocketFx`: prostokąt z kamery, siatka 480 × 270 przesuwa się z kamerą — cieniowanie „pływa”
  o ułamek teksla). Propozycja (nie wdrożona — zmienia wygląd dymu, efekt < 0,06 px): prostokąt mapy przyciągnięty do
  siatki jej teksli w świecie. Wiązki i iskry tarcia: brak zawartości w chwili pomiaru (scena bez broni wiązkowej,
  iskry wygasły) — pozycje obu liczy ten sam początek pul co pozostałe.

## 6. Start i przestoje kompilacji

Harness (`zrzuty.mjs`, 18 sesji, dziennik klatek i pipeline'ów strony — `harness-strona.js`), przebieg po 56eadc6:

| chwila (od nawigacji) | typowo |
|---|---|
| urządzenie WebGPU (`gpuReady`) | 3,7–4,2 s |
| pierwsza klatka tła menu | 8,7–12,1 s |
| menu gotowe (mapy ringu Ziemi) | +50–70 ms po pierwszej klatce |
| pierwsza klatka gry (po kliknięciu) | 12,0–13,4 s |

- **Start menu:** 17–20 klatek > 50 ms, maks 0,9–1,25 s — kompilacja ringu, Ziemi i nieba tła menu (domena zadania 11;
  12 pipeline'ów compute bloomu powstaje synchronicznie w pierwszej klatce menu, poza zasięgiem rozgrzewki).
- **Start gry (`startGra`):** 1–3 klatki > 50 ms, maks 200–330 ms — pierwsza klatka gry (wypiek stacji w kadrze ~115 ms,
  wysyłki, środowisko lakieru, SDF) za zasłoną wejścia. Przed zadaniem 23: Mars 528 ms, Jowisz 690 ms (synchroniczna
  budowa ringów-archetypów) → ~200 ms (budowa krokami w klatkach, ad2aae4).
- **Sceny po rozgrzewce — przestoje > 50 ms:** `kop-ladowanie` 213, `warp-ladowanie` 209, `kopwyl-ladowanie` 192,
  `reaktor-ladowanie` 143, `galeria-rakiet` 120 (3 klatki), `pas-pole` 82, `bitwa` 74, `wydobycie-skala` 74 ms. Przed
  zadaniem 23 także `wydobycie-skala` 469 ms (budowa ringu Marsa w polu) i `stacja-rozpad` ~84 ms (rozgrzewka cienia
  rozpadu po jednym trzymaczu — df97a11). **Kryterium „zero > 100 ms po rozgrzewce” nie jest spełnione w 5 scenach.**
- Diagnoza (`przestoj.mjs` w scratchpadzie sesji: dziennik `createShaderModule` / pipeline'ów / dużych buforów /
  `copyExternalImageToTexture` / dispatchy / `mapAsync` per klatka, `.tmp/webgpu/zadania/23/przestoje/`): przestoje
  „ładowania” NIE są przy skoku ani wybuchu — przychodzą ~15 klatek po teleporcie sceny w pobliże stacji, przy CPU
  2–3 ms (okres klatki 150–220 ms, bez wysyłek, alokacji i dużych dispatchy w tej klatce). W klatce teleportu: pierwsza
  stacja modelu w kadrze — 4 tekstury 1024² i dwa asynchroniczne pipeline'y MeshStandardMaterial (fragment 22,5 KB WGSL,
  trzymacze rozgrzewki rozpadu i pierwszy rysunek stacji) — proces GPU kompiluje je (D3D12) i wstrzymuje prezentację.
  Dawny przestój „wgrywanie geometrii hull:beam 170 ms przy wejściu w skok” zniknął (skóry w partiach, wysyłki
  zakresami) — sceny skoku (`warp-skok`, `kop-skok-*`) bez klatek > 50 ms.
- **Propozycja (do zadania 24 albo decyzji):** szablony GLB stacji i ich rozgrzewka rozpadu (`Destruction3D.prebake` na
  szablonie — wypiek i klucze materiałów są współdzielone przez klony) na ekranie ładowania (`Core3D.warmup`), zanim
  gracz doleci do stacji; w grze dziś: jedno ~0,2 s szarpnięcie przy pierwszej stacji każdego modelu.
- **Zadanie 25a (2026-09-28, gałąź `webgpu/25a`) — zrobione:** szablony GLB stacji (`prepareStations3D`: pass FG, pass
  mapy cienia, wypiek i rozgrzewka rozpadu, bryły), stacja piracka (bryła gotowa z ekranu ładowania, stałe światła
  latarni), rozpad (rejestr; pass cienia w tle — `Core3D.prewarmShadowPass`) i smugi dalekich kadłubów na ekranie
  ładowania. Harness (17 sesji): pierwsze klatki gry 0 pipeline'ów synchronicznie i 0 budów NodeBuildera w każdej sesji
  (było 2–8 / 2–23); sceny razem 34 → 3 pipeline'y sync i 98 → 4 budowy (zostają materiały tworzone przez sam harness
  w `kalibracja`); pojawienie się stacji pirackiej 24–27 / 27–32 → 0, jej rozpad 6–15 / 18–23 → 0. Obraz: 166 ze 190
  scen bit w bit (≤ 2/255), reszta ≤ 10/255 na ≤ 0,04% pikseli — te same piksele daje świeży przebieg `main` (szum
  przebiegu bazowego), `planeta-cien` w znanym paśmie szumu. Ekran ładowania dłuższy o ~0,9 s (mediana, A/B na przemian
  `start-gry.mjs --root-b`: 6,78 s vs 5,91 s od kliku do pierwszej klatki), pierwsza klatka gry 285 → 182 ms.
- **Przestój „~15 klatek po teleporcie” to NIE kompilacja** (poprawka diagnozy wyżej): po 25a w jego klatce nie powstaje
  żaden pipeline, budowa, tekstura ani bufor (dziennik wywołań WebGPU per klatka w `harness-strona.js` — pola `gpu` /
  `gpuPrzed` przestoju: tylko zwykłe `writeBuffer` / `submit`, CPU klatki 2–3 ms), a przestój 200–270 ms zostaje —
  w pierwszej scenie sesji po starcie gry (`warp-`, `kop-`, `kopwyl-`, `reaktor-ladowanie`, `galeria-broni`,
  `galeria-rakiet`, `stacja-piracka`), jest też na `main` (w każdym przebiegu w części tych scen). Ślad Chrome (CDP tracing)
  pokazuje czekanie kanwy 2D na GPU (`SharedContextRateLimiter`) w trybie zegara wirtualnego harnessu. W prawdziwym
  czasie (teleport jak w scenach po 4 s gry, `main` i 25a): 0 klatek > 50 ms; pierwsze 300 klatek gry — te same 2 klatki
  > 50 ms (pierwsza klatka) co na `main`.

## 7. Pamięć

`scripts/webgpu/pamiec.mjs --cykle 3 --bok 20 --sekundy 8`: hak na `GPUDevice.createBuffer / createTexture` (rozmiar z
formatu, mipów i próbek; `destroy` odejmuje), `renderer.info.memory`, sterta JS. Cykl: bitwa 40 okrętów 8 s →
zniszczenie wszystkich → odlot 120 tys. j. (wraki za progiem despawnu wracają do puli — droga gry):

| etap | bufory GPU | tekstury GPU | three: geometrie / tekstury | sterta JS |
|---|---:|---:|---|---:|
| menu | 157 MB (1030) | 2167 MB (68) | 125 / 72 | 319 MB |
| gra po starcie | 237 MB (1807) | 2432 MB (107) | 269 / 111 | 463 MB |
| cykl 1: bitwa / po sprzątaniu | 240 / 241 MB | 2521 / 2542 MB | 286 / 131 → 295 / 135 | 532 / 559 MB |
| cykl 2: bitwa / po sprzątaniu | 241,5 / 241,5 MB | 2590 / 2590 MB | 301 / 144 | 534 / 553 MB |
| cykl 3: bitwa / po sprzątaniu | 241,5 / 242,1 MB | 2590 / 2590 MB | 301 / 144 | 554 / 582 MB |

- **Liczniki nie rosną z cyklu na cykl** od cyklu 2 (geometrie 301, tekstury 144, tekstury GPU 2590 MB) — przyrost
  cyklu 1–2 to tekstury typów kadłubów i ich lakier trzymane do końca sesji z założenia (`prewarmHexShipVisual`: jeden
  egzemplarz na typ). Liczba buforów GPU rośnie o ~80–120 na cykl przy ~0 MB (małe bufory uniformów obiektów renderu
  — do obserwacji w długiej sesji).
- **Tekstury 8K:** 8 × 8192 × 4096 RGBA8 z pełnymi mipami = 8 × 170,7 MB = **1,37 GB** (planety), 5120 × 3200 83 MB,
  mapa cienia 4096² + głębia 128 MB, bufor sceny HalfFloat MSAA ×4 63 MB. Tekstur 16K brak. Cała pula tekstur
  ~2,6 GB VRAM. Porównania z bazą WebGL nie ma (hak jest WebGPU-owy); tekstury i formaty te same (RGBA8 bez kompresji)
  — kompresja BC7 zmniejszyłaby 8K ~4 × (osobne zadanie: potok zasobów).

## 8. Pełne uploady tekstur

`koszt-klatki.mjs --scena bitwa-duza --zapisy 240` (148 okrętów, 243 klatki): **jedno** `writeTexture` (256 × 256,
17 KB) na 243 klatki — pomijalne. Mostki (dane obrażeń w teksturze, `Texture.updateRanges` ignorowane = pełny upload,
PLAN §10 p. 4) są nieaktywne na kadłubach belkowych do etapu 4 portu belek — ryzyko wróci z nimi (wtedy dane
obrażeń w buforze storage zamiast tekstury). Zapisy buforów w bitwie po poprawkach: 187 wywołań, 520 KB na klatkę
(przed: ~390 wywołań; największe: instancje MainExhaustJets ~170 KB — zmieniają się co klatkę, skóry kadłubów
w zakresach ~64 KB, slot kadłubów 44 KB, światła pozycyjne 32 KB).

## 9. Kanwa bez kopii (`#webgl-layer` → `#c`)

`koszt-klatki.mjs --ab kopia` (6 rund naprzemiennie, B = bez `drawImage` kanwy 3D — tylko pomiar):

| scena | CPU wywołania `drawImage` | odstęp klatek z kopią / bez | 
|---|---:|---|
| hud (czas stoi) | 0,014 ms | 1,33 / 1,32 ms |
| duża bitwa (148 okrętów) | 0,014 ms | 5,88 / 5,76 ms |

Kopia kosztuje ≤ 0,1 ms na klatkę przy 1080p (wywołanie 14 µs, reszta po stronie GPU/kompozytora — w granicy szumu
okien). **Rekomendacja: zostawić kopię.** Wariant „kanwa WebGPU pod kanwą 2D” zyska do ~0,1 ms (przy 4K ~4 × więcej
pikseli — sprawdzić tam, jeśli GPU stanie się wąskim gardłem), a wymaga zmian w składaniu (przezroczystość HUD,
wycinki podzielonego ekranu, zrzuty harnessu i narzędzia czytające `#c`). Decyzja użytkownika — bez zmiany.

## 10. Tylko WebGPU

`scripts/webgpu/bez-webgpu.mjs` (zadanie 23, eb5078e): trzy warianty — Chrome bez flag WebGPU, strona bez
`navigator.gpu`, `requestAdapter()` = null. We wszystkich: `Core3D.ready === false`, renderer nie powstaje, menu
pokazuje „Gra wymaga przeglądarki z WebGPU”, gra nie startuje na zapasie WebGL2 (zrzuty w
`.tmp/webgpu/zadania/23/bez-webgpu/`).

## 11. Lista „→ 23” z POSTEP.md — stan

| punkt | stan |
|---|---|
| bloom = 12 osobnych `render()` (02) | **zrobione** — 12 kerneli w jednym passie compute, cele bit w bit (56eadc6) |
| wgrywanie geometrii `hull:beam` 170 ms przy wejściu w skok (13, 12-B) | **zniknęło** — skóry w partiach, wysyłka zakresów (a957d4e, f2bcc2a); sceny skoku bez klatek > 50 ms |
| `discard` nie przerywa shadera: górna ściana ringu i chmury (08) | ściana — **zrobione** (9265ee0: przy pełnym zaniku bez rysunku); chmury — bez zmian (koszt tylko GPU, a GPU klatki WebGPU jest 1,5–5 × niższe niż baza) |
| jedna mapa cienia ze wszystkimi warstwami (16) | **zrobione** — mapa per pass z warstwami passa (`PassShadowNode`), pomijana bez rzucających (64841cc) |
| brama znaczników czasu liczy miejsce raz na klatkę rAF (04, 15) | **zrobione** (c214909 + brama na granicy klatki) |
| błędy startu sesji harnessu (13) | **zrobione** (harness zapisuje dziennik startu sesji) |
| żar krawędzi w demie rdzenia 1–3% ciemniejszy (15) | bez zmian — tylko demo, nie gra |
| resztkowe różnice krawędzi ringu (09) | bez zmian — FXC scala `mad` w wierzchołkach, pochodne na czwórkach pikseli (przyjęte w 09) |
| pule efektów broni po zawinięciu rysują całą pojemność; 11 wywołań compute na klatkę; pass zniekształceń przegląda scenę (17) | compute: ruch i światło pul — 1 pass (6b2e42a), spawn wszystkich pul — 1 pass, krok i emisja dymu rakiet — 1 pass (tu); pełna pojemność po zawinięciu — koszt tylko GPU (bez zmian); pass zniekształceń — ~20–40 µs, tylko przy aktywnej warstwie DIST (bez zmian) |
| wizualia z `Math.random` gry → `fxRandom`, nowa baza (17) | **zrobione** (4a30904, 4e39423); nowa baza: `.tmp/webgpu/zadania/23/baza-main/` |
| pass maski słońca +1 draw call; cel refrakcji 16 MB (03) | informacyjne — maska to jeden render (~40 µs CPU) |
| iskry MAIN na dopalaczu 0,067% vs tag (12-B) | przyjęte (linie 1 px: Dawn vs ANGLE) |
| kolano bloomu dla broni, rakiet, żaru ran (22, 18-C, 17, 19) | **rozstrzygnięte w zadaniu 25b** (użytkownik 2026-09-28: „do poziomu dem”): bloom gry = bloom dem (bez ×3), efekty z dem 1:1, kolana usunięte (PLAN §3). Dawniej: decyzja użytkownika — A/B obrazów w `.tmp/webgpu/zadania/23/kolano/webgpu/porownanie-z-baza/` (`*-obok.png`: baza-main bez kolana ↔ z kolanem `warpBloomKnee` na wyjściu pul broni, pocisków, smug, wiązek, kul ognia, płomieni, blasku, łuków i iskier rakiet oraz żaru ran; wariant tymczasowy, bez commitu). Różnice: `galeria-mjolnir` 69% pikseli > 8/255, `galeria-rakiet-supernowa` 36%, `galeria-broni` 28%, `galeria-laser-pd` 22%, `bitwa` 1,2% — poświata wraca w pobliże dem |
| pas asteroid: mapy cienia w jednym atlasie, koszt passów przy dalekim zoomie; obrót stacji Wenus a ładowanie (21) | atlas — bez zmian (pas poza bitwą, sceny pasa w harnessie 1,9–2,5 ms CPU); obrót stacji — znany szum `planeta-cien` |
| pierwsza klatka w gęstym polu ~400 ms = budowa ringu Marsa (21b) | **zrobione** — budowa krokami w klatkach (ad2aae4): `wydobycie-skala` 469 → 74 ms |
| `LightGrid.add` ponad limit wklejania V8; kopie CPU dymu i mgławicy 71 MB (19) | kopie — **zrobione** (33f9196, ~140 MB razem z pulami broni i ośrodkiem warpa); `LightGrid.add` — bez zmian (w bitwie 0,01–0,05 ms/klatkę na wszystkie światła efektów) |
| z-fighting brył tranzytów i zatok archetypów, krawędzie napisów K-7 (10) | bez zmian (migocze też w bazie — poprawka geometrią; napisy — do sprawdzenia mipmap atlasu) |

## 12. Co zostało

- **Duża bitwa, ~0,7 ms CPU nad bazą:** tarcze (rysunek na tarczę, 5–12 × ~20 µs — kandydat do partii jak skóry: bufor
  slotu z trafieniami + geometria profilu instancjonowana per model kadłuba), pozostałe ~30 rysunków passu ortho
  (osobne materiały pul, rakiet, dysz SIDE), stały koszt 5–7 renderów sceny na klatkę.
- **Przestoje > 100 ms po rozgrzewce** w harnessie (~15 klatek po starcie pierwszej sceny sesji, 200–270 ms) — po
  zadaniu 25a bez kompilacji (§ 6): czekanie kanwy 2D na GPU w zegarze wirtualnym, w prawdziwym czasie brak.
- **Ekran ładowania +0,9 s** (zadanie 25a: kompilacje stacji, stacji pirackiej i rozpadu przeniesione z gry; CPU rejestru
  ~0,8 s, z tego rozpad stacji ~0,5 s — 55 budów po 15–80 ms). Kandydat do rozgrzewki już w menu: szablony stacji
  i rozpad (wczytane przy starcie strony) — w menu każda budowa to szarpnięcie tła, więc tylko z budżetem klatki.
- Drżenie: dym rakiet przy 7 mln z2 0,029 px (mapa gęstości nad kadrem — propozycja w § 5), smugi przy z1,8 0,018 px.
- Liczba buforów GPU rośnie o ~80–120 na cykl bitwy (≈ 0 MB) — do obserwacji w długiej sesji.
- VRAM tekstur ~2,6 GB (8 × 8K planet 1,37 GB) — kompresja BC7 to osobne zadanie.
- Kanwa bez kopii — zmierzone ≤ 0,1 ms, rekomendacja: zostawić kopię (decyzja użytkownika).
