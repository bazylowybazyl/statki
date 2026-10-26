---
paths:
  - "src/3d/skybake/**"
  - "src/3d/sky*.js"
  - "src/game/skyRegion.js"
  - "dema/niebo-webgpu.html"
  - "dema/niebo-webgpu.js"
  - "scripts/webgpu/niebo-*.mjs"
---

# Wypiekacz nieba i tło kosmosu

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/skybake/`** — WYPIEKACZ NIEBA (tło kosmosu liczone raz, nie co klatkę): `SkyBaker` (passy pełnoekranowe, cele pomocnicze `size`, ciężkie passy w pasach `strips`) + style: „galaktyka” (pas Drogi Mlecznej) i „mgławica” (2026-10-06, krok 3: prawdziwa objętość 3D — marsz promienia przez płytę w 8 pasach, samocień z atlasu objętości światła + cień bliski z detalem, HG, emisja Hα / O III z frontem jonizacji, ciemny pył z przodu; nastawa `gra` = lampy w płycie, gaz gęsty, bez gwiazd; `kolorowa` = lampy i masy w barwach palety `paleta1…4` + trzecie pasmo emisji `barwaZewn` — kandydaci w `.tmp/niebo/`), pole gwiazd wspólne (`skyBakeStars.js`), tekstura zapisywana po odwróceniu ACES gry (w grze wygląda jak na podglądzie). Narzędzie `dema/niebo-webgpu.html`, pętla `scripts/webgpu/niebo-arkusz.mjs`, test w grze `niebo-gra.mjs`. Kafle (wycinek nieba w dowolnej gęstości: `SkyBaker.setRegion`, atlas pożyczony od wypiekacza bazowego — `shared`, `extraOctaves`) i widok A/B 1:1 w demie (`scripts/webgpu/niebo-ab.mjs`) — 2026-10-06 zmierzone: przy obecnych stylach kafle w gęstości ekranu prawie nic nie dają (treść gładsza niż piksel 4K). Gwiazdy tła rysuje gra w rozdzielczości ekranu (`src/3d/skyStars.tsl.js`; gwiazdy wypieczone w tekselach przy powiększeniu 1,7–3,5× wychodziły rozlane) — **styl wypieku do gry eksportuj bez gwiazd**. Jasność tła wg strefy gry (`src/game/skyRegion.js`: pas asteroid ciemniej, pusta przestrzeń jaśniej — mnożnik obrazu wyświetlanego, `window.setSkyZone` przed `updatePlanets3D`). Opis, geometria kadru i pomiary: `docs/webgpu/WYPIEK-NIEBA.md`.

## Niebo-sfera — tło gry (DECYZJE-2 N1–N3, domyślne od 2026-10-26)

- TŁO GRY = SFERA W NIESKOŃCZONOŚCI (`src/3d/sky3D.js`: `SkySphere`; materiały `src/3d/skySphere.tsl.js`; obrót
  `src/3d/skyScroll.js` — moduł czysty): tekstura equirect `public/assets/sky-equirect.webp` (6144 × 3072, WebP bezstratny,
  wartości tekstury po odwróceniu ACES jak `nebula.webp`, bez gwiazd) obracana z DROGI STATKU, nie kamery. A/B dawnej
  płaszczyzny z paralaksą 0,02: `?niebo=plaska` (adres strony — działa też w workerze renderu); `nebula.webp` zostaje dla
  tła menu (menu bez zmian — przejście na equirect to osobna decyzja).
- PRAWO TEMPA = prawo warstw GameStars: obraz nieba płynie na ekranie z tempem min(v, 14 tys.) · p · zoom (p = 0,03,
  `SKY_SCROLL`), czyli niebo to warstwa deep na sferze — tryb sfery ZWIJA warstwę deep GameStars (uniform `hideDeep`
  materiału gwiazd), mid (0,055+) i speed zostają. HIERARCHIA WARSTW (DECYZJE-2 W0): niebo < mid < skały w warpie < speed
  we wszystkich trybach lotu — niebo < mid < speed pilnuje `tests/skyScroll.test.mjs` (skały: tabela pasa w warpie,
  reguła `pas-asteroid`); zmiana p, sufitu albo warstw GameStars = przegląd
  tej tabeli (`skyLayerSpeeds`) i tabeli w `WYPIEK-NIEBA.md`. Liczby: walka 3–7 px/s, hipercruise i warp ~49 px/s.
- Obrót: kwaternion świat ← niebo z drogi OKRĘTU PROWADZONEGO PRZEZ KAMERĘ — statek gracza (`RenderWorld.playerPose`,
  bez niej encja), przy sterach fregaty zwiadu fregata (`RenderWorld.cameraLead` { x, y, v, w }: strona —
  `window.__cameraLead` w bloku ZWIAD `index.html`, worker — `HEAD.LEAD_*`); każdy okręt ma tropiciel drogi z cięciem
  (`skyTrackStep`: teleport, odrodzenie), drogi miesza waga przejazdu kamery w. Oś z × ruch w osiach sceny; orientacja
  startowa `SKY_START` (kadr dawnej płaszczyzny), bez zapisu (nowa gra = przeładowanie strony). Stan liczy moduł renderu
  z wejść RenderWorld — tryb off i worker liczą to samo (test determinizmu w `tests/skySphere.test.mjs`, przekazanie
  wejść — `workerPlayerPose.test.mjs`, `snapshotPack.test.mjs`); nowe wejście obrotu = getter `RenderWorld` (+ pole
  migawki dla workera), nie `window`. Nowy tryb, w którym kamera prowadzi inny okręt niż statek gracza → `cameraLead`.
  CZAS KROKU = przyrost `RenderWorld.frameClock` (worker: `HEAD.T_FRAME`; off: dt klatki) — worker pomija strony, a dt
  jednej strony przy drodze kilku dawał fałszywe cięcia i przycięty sufitem obrót; nowy stan nieba całkowany w czasie
  (zanik, wygładzenie) — z tego samego czasu.
- PODZIELONY EKRAN: gracz 2 ma własny stan (`scroll2`: droga `RenderWorld.player2Ship`, zoom i obrót kadru
  `RenderWorld.camera2`); `SkySphere.cacheHook` (hak passa tła) ustawia widok przed każdym `renderSingle` — kamera gracza 2
  to wtedy `Core3D.activeCam1`; pamięć nieba w podziale wyłączona.
- KAMERA Z GÓRY: czworokąt pełnoekranowy w passie tła, RZUT RÓWNOODLEGŁY wokół środka kadru (tempo i smugi równe w całym
  kadrze, także 32:9), macierz widok → niebo z obrotem kadru (`cam.roll`). Soczewka bańki (`skyBend.js`) przesuwa piksel
  przed wyznaczeniem kierunku. Bez rulonu: `rulonBend = false`, bez `rulonInverse` (rulon nie jest używany w grze).
  PAMIĘĆ NIEBA jak dawniej (cel HalfFloat, przeliczenie przy ruchu obrazu ≥ 0,25 px na brzegu kadru, A/B
  `Core3D.skyCacheEnabled`), ale niebo płynące ≥ 0,25 px NA KLATKĘ (warp, hipercruise, obrót kadru — `frameAngle`) rysuje
  się wprost (`cacheStats.fast`): pamięć przeliczałaby się co klatkę; nowy wkład do nieba liczony na piksel → warunek
  unieważnienia w `SkySphere.cacheHook`. Equirect (~75 MB GPU) wgrywa kolejka `Core3D.queueTextureUpload` w wolnej chwili.
- GWIAZDY: drobne (siatki 1–2) na piksel w przestrzeni kierunków — ściany sześcianu RÓWNOKĄTNE z poprawką kąta bryłowego
  (`skyStarFieldDir`); gasną przy szybkim niebie — próg w PRĘDKOŚCI KĄTOWEJ (`fadeFromDeg` 2 → `fadeToDeg` 4 °/s = 60 →
  120 px CSS/s przy 1080p), nie w px (tempo w px rośnie z wysokością okna — próg w px gasił je w warpie na 4K), udział
  wygładzony (`fadeTau`, `stepSkyFineGain`); jasne (siatki 3–4) — kwady instancjonowane z katalogu z haszu
  (`buildSkyStarCatalog` — ten sam hasz i komórki co GPU, więc kamery 3D z siatkami 3–4 na piksel mają te same gwiazdy),
  w skoku smuga wzdłuż KURSU na ekranie (`WARP_STARS.heading` — jeden wektor, nie wachlarz; długość warstwy deep) i front
  wyjścia; światło dokładane jak na pikselu: acesGryInv((gładkie + gwiazda) · jasność) − acesGryInv(gładkie · jasność).
- KAMERY 3D: sfera `Sky3D` z tą samą treścią i orientacją (`worldMat`); w trybie płaskim dawna sfera z mgławicą w rzucie
  stereograficznym.
- Rozgrzewka: `niebo-sfera: kamera z góry`, `niebo-sfera: jasne gwiazdy`, `niebo-sfera: pamięć nieba` (faza
  `'loading'`); nowy materiał nieba → wpis tutaj (pamięć nieba rusza dopiero z gotowym pipeline'em zapisu).
- WYPIEK SFERY: `SkyBaker({ sphere: true })` (`ctx.dir()`, `ctx.lonLat()`, gęstość jak płaszczyzna: 977,8 tekseli / rad,
  jednostka nieba = 3,27 rad), styl galaktyki z `{ sphere, patches }` — pas na wielkim kole, szumy pasa WALCOWE (bez szwu
  na 2π), izotropowe z kierunku, łaty mgławic (wypiekacze płaskie stylu „mgławica”, pass „laty”, złożenie „ekranem”).
  Nowy szum w stylu galaktyki → przez `N2` / `R2` / `ISO` stylu (płaszczyzna i sfera z jednego kodu), nie wprost `skyFbm`
  z punktu nieba (szew na 2π, ściśnięcie przy biegunach). Eksport: `node scripts/webgpu/niebo-sfera.mjs --zapisz 1`
  (nastawy `SFERA_DEFAULTS` w demie, pas z `srodekX = srodekY = 0`), w grze `node scripts/webgpu/niebo-gra.mjs
  --query niebo=sfera [--klip 1]`. Opis, liczby, koszt GPU: `docs/webgpu/WYPIEK-NIEBA.md` § „Niebo-sfera”.
