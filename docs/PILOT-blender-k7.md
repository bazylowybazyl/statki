# Pilot: hala K-7 z Blendera — 2026-10-13

Pytanie użytkownika: czy ring orbitalny wyszedłby lepiej w Blenderze? Odpowiedź (przyjęta): ringu jako całości NIE —
teren, miasto, atmosfera, chmury i okna nocą to zasługa shaderów, a budynki mają przy zoomie gry kilka pikseli.
Blender opłaca się dla elementów oglądanych z bliska — przede wszystkim HALI K-7 (start kampanii w doku C-01,
dokowanie, obsługa paliwowa). Pilot: elementy hali zrobione skryptami w Blenderze, wpięte w grę ZA PRZEŁĄCZNIKIEM
(domyślnie stara hala), porównanie obrazu i kosztu. **2026-10-13: hala z Blendera DOMYŚLNA (decyzja użytkownika).** Wzór jakości: ring Ziemi (przemysłowy, wojskowy port).

## Przełącznik

- gra i demo: domyślnie hala z Blendera; `?k7=stara` (albo `0` / `old` / `false`) — stara hala; `window.__K7_GLB =
  true | false` przed wczytaniem strony bierze górę nad adresem (do 2026-10-13: domyślnie stara, `?k7=blender`);
- demo `dema/dok-k7-webgpu.html` — pole „Hala z Blendera (A/B)” (przeładowanie z przełącznikiem), w HUD-zie:
  `hala z Blendera, LOD0 (… tr.)`;
- na żywo (konsola, gra z przełącznikiem / demo): `K7GlbTune.forceLod = 0 | 1 | -1`, `K7GlbTune.lod0Ppu`,
  `K7GlbLook.ao.value`, `.aoDirect.value`, `.plate.value` (w grze: `import('/src/3d/haloRing/haloPortK7.js')` →
  `K7_GLB_LOOK`).
- Kolizje BEZ zmian (te same bryły kolizji, `buildK7Collision`). Brak pliku / błąd wczytania → stara hala + ostrzeżenie.

## Inwentarz hali (stara, Ziemia — `node scripts/blender/k7/k7-inwentarz.mjs`)

Hala = 6 403 instancje (prostopadłościan 12 tr., walec 64, torus 288) w zestawach bg / fg / roof, płyty pokładu
i dachu, 68 napisów, 8 przewodów (lina) — **~239 tys. trójkątów i 12 draw calli na halę** (4 hale na ring).
Rozmiar brył na ekranie (zoom gry = piksele na jednostkę, kamera z góry): słupek paliwowy 150 j. → 33 px przy 0,22,
75 px przy 0,5, 300 px przy 2; człon ramienia 300 j. → 66 / 150 / 600 px; zbiornik 470 × 104 j.; nadproże G-01
6 335 × 174 j. (FG, nad przelatującym okrętem); zamek pola 64 × 210 j. W menu i na końcu intro hala to dach
(zamknięty) z daleka — elementów wnętrza nie widać.

Zastąpione sekcje (1 247 instancji, ~92 tys. tr. starej hali):

| sekcja | instancje | tr. | element modelu (miejsca) |
|---|---|---|---|
| fuel-base | 192 | 8 256 | `fuel-base-W` / `fuel-base-E` (po 4) — cokół, kolumna, szafka, pion paliwa, bęben z przewodem, prowadnica, obrotnica |
| fuel-link1 / link2 / rod / coupler | 184 | 11 616 | człony SCARA, wysięgnik, złączka (po 8) — grupy ruchome |
| clamps | 160 | 1 920 | `clamp-pad` (32) — listwa `status` świeci emisją grupy |
| fuel-tanks / pumps / headers / rack / vents | 576 | 61 768 | zbiornik (8), pompa (4), kolektory (1), rurociąg W / E (po 4), upust (4) |
| wall-pipes / spots | 75 | 7 628 | rury na ścianie tylnej (1), reflektor (8) |
| gate-jamb / gate-lintel | 60 | 720 | ościeżnica (6), nadproże G-01 (1) i G-02 / G-03 (2) |

Nie zastąpione (decyzja pilota): pokład i płyty, napisy, przewody (lina z fizyką), soczewki świateł (miganie
z instancji), dach (styl per ring), ściany, pylony, zatoki, wyposażenie grzebieni bocznych.

## Jak powstały modele

- **Wymiary z gry:** `node scripts/blender/k7/k7-dane.mjs` → `scripts/blender/k7/k7-dane.json`: stałe
  `haloPortK7Layout.js` (K7_FUEL_STATION, K7_FUEL_FARM, K7_HEIGHTS, K7_ABOVE_SCALE, K7_GATE_LINTEL, bramy, ściany)
  i BRYŁY REFERENCYJNE każdego elementu — rejestrator `haloPortK7Build.js` nagrywa miejsca elementów
  (`Recorder.place`: kotwica, kurs, grupa ruchoma, tryb wysokości) i surowe wywołania brył (`capture`), eksport
  przenosi je do układu elementu. Skrypt Blendera buduje z tych liczb — zero przepisanych wymiarów; hasz danych
  trafia do GLB (ekstrasy sceny), test pilnuje zgodności z bieżącym eksportem.
- **Blender 5.0.1 w tle**, `scripts/blender/k7/k7_hala.py` (+ `k7_wspolne.py`; ogólne bryły z `scripts/blender/bryly.py`
  — tylko import): bmesh, fazy (Bevel) na bryłach, ostre krawędzie z kąta na częściach bez fazy (toczenia),
  normalne ważone (Weighted Normal), wycięcia (Boolean EXACT: otwory tarcz bębna, kieszenie członów), części
  typowe (śruby, kołnierze, zasuwy z pokrętłami, obejmy, pasy ostrzegawcze, kraty pomostów, drabiny, łańcuch
  kablowy, zębaty wieniec obrotnicy), AO z Cycles (OptiX) w kolor wierzchołków z podłogą pokładu jako zasłaniaczem,
  LOD1 (`--lod 1`: bez faz, śrub i krat, mniej segmentów, pasy ostrzegawcze jednolite). Eksport: `assets/k7/k7_hala.glb`
  i `k7_hala_lod1.glb` (nie `public/`), węzeł na element i zestaw (`<element>|bg`, `<element>|fg`), materiały =
  klucze K7_MAT (paleta i „ubiór” — z ringu: Ziemia / ECUMENE Mars / Fable Jowisz dzielą halę), AO w `COLOR_0`.
  Budowa obu poziomów ~5 s, wypiek AO ~0,4–0,9 s na element.
- Podgląd A/B Cycles (stara bryła z brył referencyjnych obok modelu): `… k7_hala.py -- --render .tmp/blender/k7/p2
  [--gra]` (`--gra` — wysokości nad płaszczyzną lotu ×0,42 jak w grze).

Trójkąty elementów (LOD0 / LOD1): słupek W / E 13 608 / 1 772, człon 1 3 084 / 276, człon 2 3 608 / 388, wysięgnik
636 / 260, złączka 1 664 / 472, zamek pola 852 / 392, zbiornik 7 876 / 1 232, pompa 3 620 / 628, kolektory 10 840 /
3 464, rurociąg 4 876 / 1 368, upust 3 012 / 432, rury ściany 4 920 / 1 992, reflektor 448 / 168, ościeżnica 1 420 /
448, nadproże G-01 7 912 / 2 324, G-02 / G-03 3 644 / 1 024.

## Wpięcie w grę (`src/3d/haloRing/haloPortK7Glb.js`)

- Hala z przełącznikiem nagrywa scenę bez sekcji z modelu (`buildK7Scene(…, { skipTags: K7_GLB_TAGS })`),
  a miejsca elementów dostają geometrię z pliku: JEDNA scalona geometria na zestaw (bg / fg) i poziom (LOD0 / LOD1),
  wspólna dla wszystkich hal K-7 wszystkich ringów (ten sam układ `createK7Layout`). Scalanie (~30–90 ms CPU) idzie
  w tle po wczytaniu pliku porcjami (`prebuildK7GlbBuffers`, najdłuższa przerwa pętli zdarzeń ~18 ms) — budowa hali
  bierze gotowe bufory. Ring Ziemi czeka na plik (`await k7GlbWhenReady()` przed budową hal), ringi-archetypy —
  krokami generatora (`k7GlbSettled`).
- Wierzchołek: pozycja w hubie PO odwzorowaniu wysokości jak bryły starej hali (`k7HeightToZ` — 1:1 pod płaszczyzną
  lotu, ×0,42 nad nią; wysięgnik i złączka liniowo ×0,42), normalna po tym samym odwzorowaniu, `aK7` = unorm8 ×4
  (kod materiału, AO, grupa ruchoma, waga płyt). 3 bufory wierzchołków, bez instancji (nie `InstancedMesh`).
- Render: graf K-7 `glb` w `k7Graphs(u)` — ten sam model światła co bryły hali (paleta i emisja ringu, lampy i
  reflektory hali `k7Lamp` / `k7Spot`, słońce i cień ringu, światło planety, płyty proceduralne słabiej — model ma
  własny detal), grupy ruchome macierzami `k7Groups` (człony ramion, wysięgniki, złączki; zamki — emisja listwy),
  AO: pełne w świetle pośrednim, 35% w słońcu. `k7Shade` bez parametru `glb` buduje graf jak dawniej (WGSL starej
  hali bez zmian). Zestawy: bg — warstwa tła hali, fg — warstwa FG (nadproża, bębny, ramiona, reflektory, rury na
  ścianie). Rozgrzewka: siatki w poddrzewie hali (hak `prewarm` ringu) — pipeline'y synchroniczne w klatkach: 0.
- LOD: `updateGlbLod(camLocal, pixelAngle)` z `cullHalls` (index.js, archRing.js) — LOD0 od 0,3 px na jednostkę
  hali (≈ zoom gry 0,3 z góry), histereza ±10%.

## Wyniki A/B

Narzędzia: gra — `node scripts/webgpu/k7-blender-gra.mjs` (harness ze stałą klatką, ten sam świat w obu
wariantach; kadry, koszt, pipeline'y), demo — `node scripts/webgpu/dok-k7-demo.mjs [--query k7=stara]`.
Zestawienia (całe kadry w połowie rozdzielczości + wycinek 1:1): `.tmp/blender/k7/gra/ab-*.png` (dok 0,22 / 0,5 / 1 / 2,
odłączanie 1–6, zbiorniki, brama G-01 i koniec nadproża, cała hala 0,12, noc, kamery 3D, Mars, Jowisz, menu),
`.tmp/blender/k7/demo-ab/ab-*.png` (demo: stanowisko, zbliżenie, hala, zbiorniki, kamera 3D ramienia i stanowiska),
podglądy Cycles `.tmp/blender/k7/p2/ab-*.png`.

Koszt (RTX 5080, 1600 × 900, harness, ta sama klatka; mediana `Core3D.gpuFrameMs`, „koszt hal” = z halami − bez hal):

| | stara hala | hala z Blendera |
|---|---|---|
| draw calle hali / klatki (dok, zoom 0,5) | 12 / 34 | 12 / 34 |
| trójkąty klatki: dok 0,5 (LOD0) / dok 0,22 (LOD1) / hala 0,12 (LOD1) | 469 tys. / 1,267 mln / 1,872 mln | 757 tys. / 1,252 mln / 1,857 mln |
| GPU hal: dok 0,5 (LOD0) | 0,18 ms | 0,23 ms (+0,05) |
| GPU hal: cała hala 0,12 (LOD1) | 0,148 ms | 0,155 ms (+0,007) |
| CPU `Core3D.render` (dok 0,5) | 1,74 ms | 1,68 ms (szum) |
| pipeline'y synchroniczne w klatkach / błędy konsoli | 0 / 0 | 0 / 0 |

Pamięć: pliki 5,3 MB (LOD0) + 1,5 MB (LOD1); geometria na GPU ~21 MB (LOD0: 573 tys. wierzchołków, 380 tys. tr.)
+ ~5 MB (LOD1: 150 tys. w., 77 tys. tr.) — RAZ na sesję (wspólna dla 12 hal trzech ringów); parsowanie obu plików
~110 ms (w menu, w tle ringu).

Obraz wg zoomu:

- **0,22 (domyślny kadr gry, LOD1):** różnica mała — ramiona z kieszeniami i paskami ostrzegawczymi, zamki pola
  z krawędzią ostrzegawczą, zbiorniki z dennicami; kadr czyta się podobnie (LOD1 ma mniej trójkątów niż stare bryły).
- **0,5:** wyraźnie lepiej — słupki (wieniec obrotnicy, bęben z nawiniętym przewodem, kraty, stacja zaworów),
  człony z kieszeniami i łańcuchem kablowym, zbiorniki ciśnieniowe (dennice, pomost z barierką, właz), pompy.
- **1–2:** dużo lepiej — maszyny portowe zamiast klocków (stara obrotnica to płaski krążek, nowa: wieniec zębaty,
  śruby, silnik zębnika; stary bęben to czarny walec, nowy: zwoje przewodu, tarcze z otworami, układacz).
- **Kamery 3D gry (K) i demo 3D:** największa różnica (bryła, AO w szczelinach, drabiny, szafki).
- **Noc:** lampy i reflektory hali świecą na modelu jak na starych bryłach.
- **Menu i intro:** bez różnicy (hala z daleka, dach zamknięty).
- **Mars, Jowisz:** ta sama hala w paletach ringów (ECUMENE, Fable) — działa bez zmian.

## Rekomendacja

**Tak — włączyć hale z Blendera domyślnie** (po obejrzeniu A/B przez użytkownika): przy domyślnym zoomie bez straty
(LOD1 lżejszy od starych brył), z bliska i w kamerach 3D wyraźnie lepiej, koszt +0,05 ms GPU przy zbliżeniu,
+26 MB pamięci GPU raz na sesję, draw calle bez zmian. Gdyby wybrać część: najwięcej daje słupek paliwowy z ramieniem
(start kampanii, ODDOKUJ), potem zbiorniki i zamki pola; nadproża i rury na ścianie — mało (z góry płaskie).

Dalej (osobne zadania, jeśli użytkownik zechce): dach K-7 (moduły HVAC, wentylatory, belki) dla intro — dziś styl
dachu per ring (trzy warianty); pylony doku; wyposażenie grzebieni bocznych (168 torusów rur to dziś 48 tys. tr.);
mniejszy plik (normalne i AO upakowane, wspólne części elementów); opcja w menu Grafika (pytanie do użytkownika —
nie dodana).

## Pliki

- Blender: `scripts/blender/k7/k7_hala.py`, `k7_wspolne.py`, `k7-dane.mjs` (+ wygenerowane `k7-dane.json`),
  `k7-inwentarz.mjs`; modele `assets/k7/k7_hala.glb`, `k7_hala_lod1.glb`.
- Gra: `src/3d/haloRing/haloPortK7Glb.js` (nowy), `haloPortK7.js` (graf `glb`, siatki, LOD), `haloPortK7Build.js`
  (sekcje `K7_TAGS`, `Recorder.place` / `skip` / `capture` / `stats`), `index.js` i `arch/archRing.js` (czekanie na plik,
  LOD w `cullHalls`); demo `dema/dok-k7-webgpu.js` (przełącznik, LOD, HUD).
- Narzędzia i testy: `scripts/webgpu/k7-blender-gra.mjs` (A/B w grze), `scripts/webgpu/dok-k7-demo.mjs --query`,
  `tests/haloPortK7Glb.test.mjs` (przełącznik, format, hasz wymiarów, budżet trójkątów, części na miejscach starych
  brył, osie obrotu członów, sekcje i FG nad bramami, wysokości, siatki / LOD / WGSL w Node).
- Ponowny wypiek po zmianie wymiarów hali (test `wymiary z gry` pada):
  `node scripts/blender/k7/k7-dane.mjs`, potem
  `"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python scripts/blender/k7/k7_hala.py`
  i to samo z `-- --lod 1`.
