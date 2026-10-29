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
- PRAWO TEMPA (`SKY_SCROLL`, uwaga użytkownika 2026-10-27 „za słabo płynie tło”): obraz nieba płynie z prędkością DROGI
  NIEBA vN — prędkość statku liniowo do kolana `knee` 5 tys. j/s (cała walka i dopalacz), wyżej knee · (1 + ln(v / knee))
  (hipercruise 20 / 40 tys. → 11,9 / 15,4 tys., warp 100 / 175 / 250 tys. → 20,0 / 22,8 / 24,6 tys.; bez sufitu, ciągła
  i gładka), wygładzonej w czasie klatek (`smoothTau` 0,15 s, czas z `RenderWorld.frameClock`): tempo [px bufora/s] =
  vN_wygł · p_ef · zoom, p_ef = min(p, `bgCap` · camZ / (camZ + `bgDepth`)) · mnożnik (`skyParallax`; p = 0,1, camZ = f /
  zoom). SUFIT GŁĘBI: niebo leży za planetami bez ringu (z = −50 000) — jego paralaksa ≤ 0,75 × paralaksy ich tarczy
  (strażnik w teście czyta `visualZ` z `planet3d.assets.js`); przy 16:9 w zoomie bojowym i w kadrze skoku nie działa, przy
  32:9 w walce daje p_ef 0,056 (kątowo jak 16:9), po przybliżeniu (16:9 od ×1,04 zoomu domyślnego) tempo w px przestaje
  rosnąć z zoomem. Liczby (1080p 16:9; 1440p — × 1,33 px, te same °/s): walka 507 j/s 10,8 px/s (0,36 °/s), dopalacz
  24 px/s, hipercruise Mk I / III 140 / 181 px/s (4,7 / 6,0 °/s), warp Mk I / II / III 234 / 267 / 288 px/s (7,8 / 8,9 /
  9,6 °/s); 32:9 1440p: walka 16 px/s (0,40 °/s), warp Mk II 681 px/s (17,1 °/s); skok Ziemia → Jowisz obraca niebo
  o ~150° / ~110° / ~90° (Mk I / II / III; 32:9 Mk II ~207°), przelot nad planetą i hamowanie wyjścia widać jako
  zwolnienie nieba. KLATKA BEZ DROGI (pauza i `worldFrozen` — gra woła render z dt > 0 przy stojącej pozie) nie obraca
  nieba i nie rusza vN_wygł (`skyScrollMove`: `!(d > 0) && !hold`) — niebo i mid stoją razem ze światem; cięcie (teleport)
  biegnie wygładzoną prędkością. STRAŻ W0 (`w0Guard` 3,5): vN_wygł ≤ 3,5 · min(v ze stanu, 14 tys.) / mnożnik mid — przy
  twardym hamowaniu (koniec rampy wyjścia) niebo i mid nie wyprzedzają warstwy speed; poza tym tempo zmienia się płynnie;
  przez nią `?nieboTempo` > 1 działa najwyżej ×3,5 w walce i ×2,15 w warpie Mk II. A/B: `?nieboTempo=stare` — dawne prawo
  dokładnie (min(v, 14 tys.) · 0,03 · zoom, bez wygładzenia, próg kątowy drobnych gwiazd, smuga 0,22 · stretchPx, dawna
  warstwa mid), `?nieboTempo=<liczba>` — mnożnik nowego tempa (0,05–10; mnoży też sufit głębi — niebo może wtedy
  wyprzedzić planety), `?nieboSufit=0` — nowe prawo bez sufitu głębi (`SKY_SCROLL_BEZ_SUFITU`); adres strony jak
  `?niebo` — czyta go `SkySphere.applyTempo` na stronie i w workerze (off ≡ worker, test w `tests/skySphere.test.mjs`).
- HIERARCHIA WARSTW (DECYZJE-2 W0): planety tła > niebo, niebo < mid < speed we wszystkich trybach lotu i przejściach,
  liczone z drogą STATKU (kamera = statek). Tryb sfery ZWIJA warstwę deep GameStars (uniform `hideDeep`), a warstwę MID
  niesie DROGĄ NIEBA (uniformy `midSphere`, `cameraOffsetMid` materiału gwiazd; `StarSystem.starCamMid` —
  `advanceStarCameraMid`: ruch kamery względem okrętu prowadzącego + `scroll.driveX / driveY` nieba × `midMul`)
  z paralaksą przesuniętą na `STAR_MID_SPHERE` 0,13–0,26 (`starParallax.js`): najwolniejsza mid ≥ 1,26 × niebo (1,3 ×
  skala ekranowa warstw GameStars camZ / (camZ + 250)), w walce 14–27 px/s przy 507 j/s (dawniej 5,9–19,5; świat 108 px/s).
  Speed zostaje na kamerze (sufit 14 tys. j/s w skoku; sufit kroku z przyrostu zegara stron — `starClockDt`, worker pomija
  strony): mid ≤ 0,89 × speed. Pilnuje `tests/skyScroll.test.mjs` (stan ustalony z `skyLayerSpeeds(…, f)`: tryby × ekrany ×
  mnożnik i zoom do 3,2; sufit głębi; przejścia klatka po klatce — skok, przelot, rampa wyjścia, hipercruise) i kontrola
  `W0-niebo` symulatora `warp-soczewka-sym.mjs`. WYJĄTKI (do decyzji użytkownika, liczby: `WYPIEK-NIEBA.md` § „Niebo-sfera —
  prawo tempa 2026-10-27”): (1) RUCH KAMERY WZGLĘDEM STATKU (kadr przylotu, przybliżenie przy wyjściu, powrót zoomu po
  przylocie) dostaje mid, a niebo nie — gdy kamera cofa się względem statku, niebo wyprzedza najwolniejszą mid (S10 / S11
  ×1,9 przez ~0,4–0,5 s przy 110–170 px/s, S8 ×3,4 przez 6 s przy ~25 px/s; kontrola informacyjna `W0-niebo-kamera`);
  dawne prawo miało ten sam kształt poniżej progu widoczności; (2) CIAŁA SOCZEWKI w warpie — większość płynie wolniej
  niż niebo (mediana 22 px/s przy niebie 267–282 px/s, `WARP-SOCZEWKA.md`); (3) gwiazdy mid (z = −250, przed planetami)
  chowa maska tarczy planety, choć płyną szybciej niż ona. Skał pasa w skoku nie ma (usunięte 2026-10-27, reguła
  `pas-asteroid`) — w warpie między mid a speed nie leży żadna warstwa. Zmiana p, kolana, wygładzenia, sufitu głębi albo warstw GameStars
  = przegląd tych tabel (`skyLayerSpeeds`) i tabeli w `WYPIEK-NIEBA.md`. `?nieboTempo` > 1 przyspiesza mid razem z niebem
  (`skyMidDriveMul`).
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
  (zanik, wygładzenie, sufit kroku kamery gwiazd `StarSystem` — `starClockDt`) — z tego samego czasu. Fregata zwiadu:
  `__cameraLead.v` = prędkość fregaty, póki waga kamery w > 0 (także w przejeździe powrotnym — straż W0 mnoży ją wagą).
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
  (`skyStarFieldDir`, σ_eff ≈ 0,58 px bufora); NIOSĄ ruch tła (mgławica jest gładka), więc gasną dopiero, gdy obraz nieba
  przesuwa się o `fadeFromPx` 6 → `fadeToPx` 12 PX BUFORA NA RYSOWANĄ KLATKĘ (~10 σ — rzadkie punkty skaczące co
  klatkę), okres klatki = średnia krocząca po klatkach (`frameAlpha` 1/32, próbka w 1/480–1/15 s — zacięcie nie gasi;
  worker — zegar stron), udział wygładzony (`fadeTau` 0,35 s, `stepSkyFineGain`). Skutek: walka zawsze pełna (sufit
  głębi trzyma tempo w px przy zbliżeniu), 144 i 240 Hz — pełne w każdym trybie i kadrze, 60 Hz — pełne przy 16:9 1080p,
  przy 4K w warpie Mk II 0,52, przy 32:9 1440p w warpie Mk I / II 0,27 / 0,03 (10–11 px/kl.). Próg 1,5 → 3,5 px/kl.
  gasiłby je w warpie przy 60 i 144 Hz, a przy 32:9 także przy 240 Hz — tam, gdzie tło ma płynąć; próg kątowy (dawne
  prawo) gasiłby je już w hipercruisie. Jasne (siatki 3–4) — kwady instancjonowane z katalogu z haszu
  (`buildSkyStarCatalog` — ten sam hasz i komórki co GPU, więc kamery 3D z siatkami 3–4 na piksel mają te same gwiazdy),
  w skoku i hipercruisie smuga wzdłuż KURSU na ekranie (`WARP_STARS.heading` — jeden wektor, nie wachlarz) o długości
  RUCHU NIEBA W EKSPOZYCJI 0,05 s × `WARP_STARS.stretch` (uniform `streakLen`, `skyStarStreakPx`; najwyżej 48 px CSS,
  NAJMNIEJ dawna smuga 0,22 · stretchPx ≈ 16 px — w ładowaniu skoku statek stoi, a smuga rośnie ze `stretch`:
  „zapowiedź” skoku; 1080p: 16 px, 1440p warp Mk II 18 px, 32:9 1440p 18 / 34 px) i front wyjścia; światło dokładane
  jak na pikselu: acesGryInv((gładkie + gwiazda) · jasność) − acesGryInv(gładkie · jasność).
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
