# Demo WebGPU: tarcza nowej generacji (dema/tarcza-webgpu.html)

Samodzielne demo na `WebGPURenderer` + TSL pod Vite (`npm run dev`, strona
`/dema/tarcza-webgpu.html`). Nie dotyka gry ani `Core3D`; z kodu gry importuje tylko
`shieldSystem.js` (stany, czasy, obrys, trafienia). Wygląd i wydajność ocenia się
na prawdziwym GPU; w kontenerze działa sprawdzanie poprawności (SwiftShader, §8).

## Pliki

| Plik | Co robi |
|---|---|
| `dema/tarcza-webgpu.js` | renderer, kamera, pętla (`?test=1` + `__demo.step`), wejście, panel, `window.__demo` |
| `dema/tarcza-webgpu/tarcza.js` | most `shieldSystem.js` ↔ render: encja, trafienia (`registerShieldImpact`), faza „niewidzialnego pola”, zdarzenia pola, światła trafień, wiązka, iskry z pancerza |
| `dema/tarcza-webgpu/pole.js` | stan pola w compute: siatka kartezjańska, fala (h, v), energia E, przebicie B, obwiednia fali W, tekstura rgba16f, mapa przebić 64×64 dla CPU |
| `dema/tarcza-webgpu/heksy.js` | nowy wygląd (tryb A): tarcza jako siatka płytek-heksów — ciało miękkie w compute jak stary destruktor GPU, żar, stres, odrywanie przy przebiciu, rozpad przy pęknięciu |
| `dema/tarcza-webgpu/czasza.js` | geometria czaszy z profilu (384 × 24), materiał „jak dziś w grze” (port `HULL_SHIELD_FRAGMENT`, tryb B), uniformy wyglądu (załamanie, poświata) |
| `dema/tarcza-webgpu/iskry.js` | iskry w compute ślizgające się po czaszy (pula 64 tys.) |
| `dema/tarcza-webgpu/bronie.js` | PD, laser, torpeda, wiązka, salwy, ogień wrogów, kolizje w płaszczyźnie gry |
| `dema/tarcza-webgpu/zderzenie.js` | tarcza w tarczę (K) |
| `dema/tarcza-webgpu/kadlub.js`, `wrogowie.js`, `tlo.js`, `wspolne.js` | Atlas ze sprite'a (heksy z alfy co 12 px, normalna z luminancji), okręty z brył, niebo, światła i szumy |
| `scripts/tarcza-webgpu-dym.mjs` | skrypt sprawdzający (Playwright + SwiftShader, zrzuty do `.tmp/tarcza/`) |

## Wygląd: heksy jak w starym destruktorze GPU

Tarcza jest przezroczysta — w spoczynku płytki mają zerową wielkość (brak fragmentów),
widać ją tylko tam, gdzie coś uderzyło. Wzór: `src/game/destructorGpuSoftBody.js`
(compute na surowym WebGPU, sprzed portu) i shader heksów z `src/3d/hexShips3D.js`
sprzed portu (commit `8c719de`: `stressGlow`, `heatRamp`, `DESTRUCTOR_CONFIG.heat*`).

- **Siatka:** trójkątna w płaszczyźnie kadłuba, odstęp `clamp(0,026·maxR, 8, 40)` j.
  × suwak; płytka to komórka Woronoja (heks ostrym wierzchołkiem w górę) podniesiona
  do płaszczyzny stycznej czaszy — z góry płytki kładą się dokładnie na siatkę.
- **Ciało miękkie** (jak shader destruktora): sprężyny do 6 sąsiadów od siatki
  spoczynkowej, ściskanie 3,2× twardsze od rozciągania, wybrzuszenie przy mocnym
  ściśnięciu, przenoszenie prędkości wzdłuż/w poprzek wiązania, siła / √sąsiadów.
  Prędkość fali w siatce ≈ prędkość fali pola (k = (c / 0,642·d)²), podkroki z CFL.
- **Plastyczność:** przesunięcie ponad 10% komórki zostaje jako wgniecenie (spoczynek
  płytki przesuwa się za nią), wgniecenie goi się ~1 s (gorąca płytka ~3× wolniej) —
  bez tego krater znikał po 0,1 s.
- **Żar:** zdarzenie pola grzeje płytki (gauss w promieniu zdarzenia; krater sięga
  1,4× dalej), stygnięcie 0,5 × „stygnięcie”, wyrównywanie z sąsiadami; jasność 0,26h + 0,74h⁴
  (jak żar kadłuba), rampa: głęboki błękit → barwa tarczy → błękitna biel → biel.
  Energia pola blisko progu barwi płytki na pomarańcz (przeciążenie).
- **Stres:** obwiednia naprężenia wiązań i przesunięcia — świecą szwy płytek. Martwa
  strefa (30%), żeby drobne drgania daleko od trafienia nie zapalały całej tarczy.
- **Przebicie:** płytka odpada, gdy B pola nad jej środkiem przekroczy własny próg
  (0,45–0,7) — leci jako odłamek; wraca, gdy B < 0,25 i tarcza jest aktywna.
- **Pęknięcie:** cała siatka rozrywa się falą od ostatniego trafienia (3600 j./s),
  tuż przed oderwaniem szwy świecą barwą pęknięcia; po rozruchu płytki odrastają za
  czołem (widoczne tylko z „rozruch i gaszenie widoczne”).

## Ustalenia

- **Klatka lokalna 3D tarczy:** x wzdłuż kadłuba, y = −y gry, z w górę; grupa w świecie
  na (x, −y), obrót −kąt (jak Core3D). Siatka pola, czasza i kwad kadłuba są w tej samej
  klatce; `?debug=pole` pokazuje izolinie t siatki i czaszy oraz znacznik w dziobie
  w trzech miejscach (kadłub, czasza, pole) — muszą być współśrodkowe.
- **Tekstura pola** (StorageTexture): wiersz j = v j/H, bez odwracania v (§9.5).
- **Fala:** h = 0 poza obrysem i w przebiciu (odbicie od obu), podkroki stałe ≤ 1/240 s
  i z warunku CFL (Courant 0,5), parami (ping-pong A→B→A), do 32 na klatkę.
- **Energia:** dyfuzja jako rozmycie gaussowskie σ² = 2·D·dt (dokładne, stabilne przy każdej
  siatce), brzeg bez przepływu, stygnięcie exp(−dt/τ).
- **Załamanie:** jeden bazowy `viewportTexture()` i próbki przez `.sample(uv)` — klony dzielą
  teksturę bazowego węzła, więc kopia bufora ramki jest jedna na render. Każde osobne
  `viewportSharedTexture()` kopiuje obraz od nowa (klucz aktualizacji = węzeł).
- **Mieszanie czaszy:** `rgb + tło·(1 − a)` (CustomBlending One / OneMinusSrcAlpha) —
  a = 0 to czysta emisja, a > 0 zastępuje tło obrazem załamanym. Nie `premultipliedAlpha`
  (materiał sam mnożyłby rgb przez a).
- **WGSL:** żadnego `smoothstep` z odwróconymi krawędziami (dla stałych Tint odrzuca shader) —
  `1 − smoothstep(b, a, x)`; nazwy funkcji `setLayout` tylko ASCII (nazwa z „ó” wywraca
  budowanie: „Function is not a WGSL code”).
- **Limit buforów storage:** domyślnie 8 na etap shadera (`maxStorageBuffersPerShaderStage`);
  dziewiąty bufor w przebiegu compute unieważnia układ grup wiązań i cały przebieg.
  Dane do rysunku (poza, wygląd) służą więc też jako stan lotu odłamka.
- **`hash` z TSL** bierze `seed.toUint()` — część ułamkowa ziarna przepada; losowość
  z ziaren w [0, 1) przez `hash12(vec2)` z `wspolne.js`.
- **Klatki bez pętli animacji:** `pass` i `BloomNode` odświeżają się raz na klatkę węzłów
  (`NodeFrame.frameId`), którą liczy pętla `setAnimationLoop`. Pod `?test=1` pętla rAF
  zostaje, ale klatka dema idzie tylko z `__demo.step(n)`.
