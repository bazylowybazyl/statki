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
| `scripts/webgpu/tarcza-pekniecie.mjs` | kadry pęknięcia na prawdziwym GPU (headless Chrome, `?test=1`), `--przed` = pliki dema z HEAD (A/B) |

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
- **Pęknięcie** (`SHATTER` w `heksy.js`, przestrojone 2026-10-05 — dawny rozpad całej siatki
  pełnymi płytkami z prędkością 220–1500 j./s przez 1,25 s wyglądał jak wybuch okrętu): czoło
  od ostatniego trafienia przechodzi przez tarczę w ~0,62 s (1300–4500 j./s; spowolnione na
  prośbę użytkownika z 0,4 s). Szwy przed czołem
  świecą barwą pęknięcia, jasno na **rysach** — wspólna krawędź dwóch płytek losuje raz (rysa
  ciągła przez szew obu płytek), szwy promieniste od punktu pęknięcia pękają chętniej. Płytki
  za czołem odpadają z losowym opóźnieniem: ~92% to pył (same linie rys, gasną w 0,09–0,2 s),
  ~8% — przy punkcie pęknięcia ~2× więcej — to odłamki: 70% płytki, odrzut od punktu pęknięcia
  260 j./s · e^(−d/240), dalej dryf ~60 j./s, opór 1,8/s, stygną do czerwieni i maleją w
  0,5–1,1 s. Jeden błysk w punkcie pęknięcia i słabe przygaśnięcie czaszy, 240 iskier (było
  1400) i 10 trzasków iskier za czołem. Strojenie: suwaki „pęknięcie: siła” i „pęknięcie:
  odłamki”, reszta z konsoli — `__demo.SHATTER` (działa od następnego pęknięcia, B). Stan
  `off` (0,28 s po pęknięciu) nie zeruje przyczepionych płytek, dopóki czoło nie przejdzie —
  inaczej rysy przed czołem gasły w połowie przebiegu. Po
  rozruchu płytki odrastają za czołem (widoczne tylko z „rozruch i gaszenie widoczne”).
  Kadry sekwencji: `node scripts/webgpu/tarcza-pekniecie.mjs [--przed] [--zoom 1700 --look 150,0]
  [--klasa main --traf 700,300]`.

## W grze (2026-10-05)

Tarcza z dema zastąpiła w grze dawną kopułę z łatami trafień i wstęgi iskier (`shield3D.tsl.js`,
`shieldImpactFx.js` — usunięte razem z narzędziami parzystości). Kod: `src/3d/shield/shieldLattice.js`
(siatka płytek z obrysu na CPU, pamięć po kształcie, obrys koła dla tarcz bez kadłuba),
`src/3d/shield/shieldPool.js` (pula na GPU), `src/3d/shield3D.js` (klej: sloty, trafienia, pęknięcie,
światła, krok efektów). Różnice względem dema:

- **Pula slotów** zamiast zasobów na tarczę: 12 slotów × 4096 płytek w jednym zestawie buforów, jedna
  pula 32 tys. iskier (ślizg po czaszy slotu z jego binów obrysu). Slot dostaje tarcza, która oberwała
  albo pęka (albo się włącza / gasi) i ma na ekranie ≥ 9 px promienia; zwalnia go spokój (4,5 s po trafieniu), koniec pęknięcia,
  zgaszenie albo zejście z ekranu. Pełna pula — wypiera najmniej ważną tarczę (promień na ekranie /
  czas od trafienia, z zapasem ×1,5), najwyżej 3 nowe sloty na klatkę. Bez slotu trafienie daje tylko
  światło. Siatki nowych klas kadłubów budują się w wolnych chwilach (3–8 ms) zaraz po pojawieniu się okrętu.
- **Pole dema liczone na siatce płytek**: fala h (laplasjan heksagonalny, brzeg i dziury h = 0) i energia
  E (dyfuzja po sąsiadach — także przez dziury, stygnięcie) w podkrokach ciała miękkiego — bez osobnej
  siatki kartezjańskiej i tekstury pola. Rozpływ energii skalowany rozmiarem tarczy (× (maxR / 900)², jak
  promień trafień): przy stałym D = 1000 j²/s na mniejszych kadłubach łata rozlewała się, zanim ostrzał ją
  przegrzał (pancernik piratów: maks. E 0,54 przy progu 1,4).
- **PRZEBICIE (mechanika, decyzja użytkownika 2026-10-05: „spoko mechanika”)**: B płytki rośnie, gdy
  E > próg (1/0,7 s), maleje poniżej 0,6 progu (1/2,5 s); płytka odpada przy B ponad własny próg (0,45–0,7),
  wraca przy B < 0,25. Stan w buforze fali (`w` = ±(1 + B), znak = przyczepiona). Mapa dziur: kernel
  pakuje bit na płytkę (B > 0,5), odczyt 6 KB co 0,1 s → `encja.__shieldBreach` + `isShieldBreachedAt(encja,
  x, y)` (punkt rzutowany na obrys w kierunku trafienia, płytki 1 i 2 odstępy w głąb). Pociski (pętla
  kandydatów w `index.html`): w dziurze tarcza nie zatrzymuje, pocisk do końca lotu pomija tę tarczę
  (`b.shieldPassed` — wewnątrz pola test okręgu dawał t = 0 i tarcza łapała go od środka), trafia kadłub
  z `bypassShield`. Wiązki (`resolveBeamWorldHit` → `out.breach`) i rakiety (`rocketSystem3D._onHit`) — to
  samo. Tylko tarcze w slocie (na ekranie) — poza ekranem pole się nie liczy, więc nie pęka od ostrzału.
  Seria 45 trafień działem (80 obr.) w jeden punkt obrysu pancernika piratów w ~1,5 s → dziura 9 płytek;
  4 pociski przez dziurę: kadłub −112, tarcza bez zmian; z drugiej strony: tarcza −112; dziura zamyka się
  ~2,5 s po ostrzale.
- **Klatka**: `updateShields3D(PAUSED ? 0 : frameDt, …)` w `render()` zbiera trafienia (po id z
  `shield.impacts`, obrażenia z pola `damage`) i stany; krok `Core3D.fx` „tarcze” liczy jedno
  `renderer.compute(lista)` (zdarzenia → podkroki 1/480 s → stany → wygląd) + iskry. Rysunek: jedna
  siatka płytek i iskry w passie tarcz (warstwa 7), płytki drugi raz w warstwie DIST (załamanie tła
  zamiast `viewportTexture`), trzeci raz jako miękkie plamy POŚWIATY NA PANCERZU (mnożenie obrazu w passie
  tarcz przed płytkami: `dst · (1 + src)`, src ∝ E/próg + stres + |h| w barwie tarczy → biel → pomarańcz —
  odpowiednik poświaty kadłuba z dema bez tekstury pola w materiale kadłuba). Pozycje lokalne tarczy,
  poza slotu względem początku przy kamerze.
- **Rozruch i gaszenie WIDOCZNE** (decyzja użytkownika 2026-10-05; `ShieldTuning.fronts`): tarcza na
  ekranie bierze slot na czas czoła, siatka odrasta za czołem (szwy), czoło pcha falę (+1300 / −1700 j./s²).
- **Światła**: błyski trafień i pęknięcia → `Core3D.fx.lights.flash` (z nośnikiem — jadą z okrętem),
  rozgrzane miejsca → `point` co klatkę; kadłuby czytają je z siatki świateł.
- **Strojenie** z konsoli gry: `ShieldTuning` (fala, żar, iskry, światła, załamanie, `breach`, `hullGlow`,
  `fronts`, `minPx`, `shatter` — te same pola co `SHATTER` dema); stan puli: `getShieldPoolStats()`,
  pole slotu z GPU: `await probeShieldSlot(slot)` (maks. E, B, |h|, płytki przyczepione / oderwane).
- **Sprawdzanie**: `node --test tests/shieldPool.test.mjs` (siatka, WGSL kerneli i materiałów w limitach
  wiązań, strażnik ścieżki pocisków przez dziurę), w grze `node scripts/webgpu/tarcze-gra.mjs [--zoom 1.1]
  [--duza]` — trafienia każdej klasy, przebicie (seria w punkt obrysu + prawdziwe pociski przez dziurę i z
  drugiej strony), rozruch, pęknięcie w kilku chwilach, bitwa; kompilacje w klatce od pierwszego trafienia
  (oczekiwane: zero).
  Pomiar 2026-10-05 (RTX 5080, 1920 × 1080, bitwa 22 okrętów, 10 tarcz w slotach): GPU klatki 0,75 ms,
  compute 0,12 ms, CPU renderu ~1 ms, 0 błędów walidacji.

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
