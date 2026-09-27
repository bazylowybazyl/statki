# Demo WebGPU: gęste pole asteroid, fizyczny pył, setki świateł

`dema/asteroidy-webgpu.html` (+ `dema/asteroidy-webgpu.js`, moduły w `dema/asteroidy-webgpu/`).
Scena „5 · Gęste pole (Main Belt)” z `dema/asteroidy.html` na `WebGPURenderer` + TSL. Gra,
`Core3D` i demo WebGL bez zmian. Start: `npm run dev` → `/dema/asteroidy-webgpu.html`.

## Moduły

| Plik | Co robi |
|---|---|
| `world.js` | słońce, mapa układu, `AsteroidBeltField`, miejsce sceny 5 (kopie `findSpot` / `freeSpotNear` z dema WebGL, wykluczenie obrysu olbrzyma pola), `FieldSunOcclusion` (prefetch sektorów wokół sceny) |
| `rockBank.js` | bank 40 kształtów: parametry CPU (kopia z `rockShapes3D.js`), pieczenie w TSL do tablic tekstur (PROC → odczyt promienia → NORMAL / MASK), siatki LOD |
| `rockNoise.js` | objętość szumu 64³ skał — compute do `Storage3DTexture` |
| `rockMaterial.js` | `RockNodeMaterial` (programy powierzchni typów z `rockMaterial3D.js`), `RockShadowMaterial` (mapa cienia reflektora) |
| `surfaceLighting.js` | `LightingModel` skał i kadłubów (Lambert z zawinięciem + Lommel–Seeliger, Blinn–Phong, jednostki jak w grze) |
| `rockLayers.js` | port `rockLayer3D.js` (komórki z budżetem, LOD per skała), wspólny lokalny początek sceny |
| `lights.js` | pula świateł → siatka komórek w świecie (sumy prefiksowe na CPU) → bufory storage; `GridLighting` / `GridLightsNode` dla three; światła statku (port `FieldLights.addShip`) |
| `spotShadows.js` | mapa `1/odległość` z reflektorów dalekich każdego statku (skały gry, warstwa 1, `overrideMaterial`) |
| `dust.js` | fizyczny pył: bufory storage (2²¹ drobin), krok compute 1/120 s, oświetlenie w compute, render instancjami |
| `fog.js` | płaty mgły z `beltDust3D.js` w TSL (szum 2D z compute) |
| `dynamics.js` | wybuchy, pociski, światło dysz, świecące skały, flary |
| `ship.js` | kadłub jako kwad z tekstury (normalna z luminancji), dysze, lampy pozycyjne, SDF sylwetki dla pyłu |
| `glowSprites.js`, `sky.js`, `sunMap.js`, `tslCommon.js` | duszki blasku, tło, mapa transmitancji słońca, wspólne funkcje TSL (ACES gry) |

## Decyzje

- **Dwa passy jak w Core3D.** Skały gry, kadłuby, płytka mgła i pył w passie gry (kamera ortho —
  skała rysuje się dokładnie w miejscu kolizji), tło (skały RUBBLE / MID / DEEP, głęboka mgła,
  niebo) w passie tła (kamera persp. dopasowana skalą w z = 0). Składanie `gra + tło · (1 − alfa)`,
  bloom (`BloomNode`, wartości z `bloomConfig.js`), ACES w wersji gry (inna krzywa niż three),
  wyjście sRGB.
- **Własny system świateł zamiast `TiledLighting` z r183.** `TiledLightsNode` trzyma 8 świateł na
  kafel 32 px (`_tileLightCount = 8`; dalsze giną w kolejności indeksów — widać kafle), promień
  rzutu światła to `distance / z` bez ogniskowej kamery (przy fov 35° za mały → obcięte brzegi),
  a pył w compute nie ma piksela ekranu. Tu: siatka 64 × 40 komórek w płaszczyźnie XY wokół kamery,
  lista komórki bez limitu (sumy prefiksowe na CPU, ≤ 1024 świateł — ułamek ms). Ten sam bufor
  czytają materiały (przez `Lighting` three → `lightingModel.direct()`, wzór z `TiledLightsNode`),
  pył (compute) i mgła (wierzchołki). Tłumienie jak światła pola gry.
- **Wysokości (decyzja użytkownika 2026-09-27: „mgła za nisko, pył za wysoko”).** Pył tylko pod
  płaszczyzną (z od −700 do 0, odbicie od dna i od płaszczyzny) — statki lecą nad nim i orzą jego
  wierzch. Mgła: dwa płytkie płaty (200 i 600 j.) w passie gry z testem głębi ze skałami gry,
  głębsze płaty (1300–20 500 j.) w tle.
- **Pył = mgiełka + drobiny.** 75% drobin to miękkie, słabe plamki (gęstość ośrodka — zagęszczenia
  fali i strugi są jaśniejsze, smugi reflektorów widać jako objętość), jasność normalizowana liczbą
  drobin (suwak zmienia rozdzielczość, nie ilość pyłu); reszta to iskrzące drobiny, słabe w słońcu.
  Pierwsza wersja (same drobiny, 40% nad płaszczyzną) dawała szum na cały kadr.
- **Kadłub nie łapie własnych lamp** (flaga właściciela w świetle; tylko światło dookoła zostaje) —
  własne czerwone lampy przepalały eskortę na różowo. W grze własne lampy liczy shader kadłuba.
- **Precyzja.** Lokalny początek sceny przy kamerze (double na CPU, przeskok po 20 tys. j.): skały
  przepisywane, pył przesuwany compute, faza dryfu pyłu i szumu mgły liczona na CPU;
  `renderer.highPrecision = true`.

## three r183 pod WebGPU — ustalenia z dema

- `new RenderTarget(w, h, { depth: N })` + `renderer.setRenderTarget(rt, warstwa)` renderuje do
  warstwy tablicy; mipmapy generują się dla wszystkich warstw. Pamięć mipmap alokuje pierwsze użycie
  celu — `renderer.initRenderTarget(rt)` przy `generateMipmaps = true`, potem flaga tylko przy
  ostatniej warstwie (jak w WebGL).
- `readRenderTargetPixelsAsync` zwraca wiersze **wyrównane do 256 B** (padding w wyniku) — przy
  szerokości 48 × RGBA8 dane się przesuwają.
- `Storage3DTexture` / `StorageTexture` + `textureStore` w compute działają (bez mipmap).
- Compute nie sprawdza zakresu `instanceIndex` — każdy kernel zaczyna się od `Return()` poza
  licznikiem; `renderer.compute(node, n)` ustawia rozmiar dispatchu dynamicznie.
- `varyingProperty(...).assign()` w `positionNode` przenosi dane instancji do fragmentów.
- Własny `LightingModel` + nadpisane `setupDiffuseColor` / `setupNormal` / `setupLighting` /
  `setupOutput` w `NodeMaterial` — cały program powierzchni gry mieści się w TSL. `builder.material`
  jest dostępny w `LightsNode.setupLights` (np. pomijanie świateł właściciela).
- `positionViewDirection` dla kamery ortho = (0, 0, 1), jak `isOrthographic` w GLSL.
- `resolveTimestampsAsync('render' | 'compute')` zwraca czas ostatniej klatki (zapytania z wielu
  klatek się kumulują — trzeba rozwiązywać regularnie, pula ma 2048 zapytań).
- Domyślne limity urządzenia: 8 buforów storage na etap i 16 zmiennych między etapami — demo
  prosi o więcej (`requiredLimits`), jeśli adapter ma (RTX 5080: 16 / 28).
- `overrideMaterial` + warstwy kamery wystarczą do mapy cienia z instancjonowanych skał.

## Uproszczenia względem sceny 5 (WebGL) i braki

- Kadłuby to kwady z tekstury: bez heksów / belek, lakieru, własnych lamp w shaderze kadłuba,
  cieni kadłubów (SDF) i odblasku.
- Bez minerałów na skałach (kryształy, odłamki lodu, tabliczki uranu), burz i piorunów, olbrzymów.
- Smugi reflektorów tylko z pyłu i mgły (bez osobnych kwadów smug z `fieldLights3D.js`).
- Pył zderza się ze skałami jako kulami (średni promień), z kadłubem jak z płytą ±110 j.;
  cień reflektorów rzucają tylko skały gry w kadrze.
- Zoom dema 0,5–3,2 (pudło pyłu pokrywa kadr przy 0,5).
- Pomiary wydajności i porównanie z WebGL — po stronie użytkownika (panel: FPS, CPU, GPU
  render / compute, drobiny, światła, draw calle; `?particles=…&lights=…&zoom=…`).
