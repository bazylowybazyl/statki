# Warp gracza „podniesiony świat” — soczewka świata (2026-10-25/26)

Stan po etapach 1–3 gałęzi `claude/warp-soczewka-swiata`: etap 1 — worker (e39ff36c) i mapa (ebc4e00d), etap 2 —
integracja w grze (ad343e4d), etap 3 — reszta świata w soczewce i HUD (3A) oraz sprzątanie „raz a porządnie” (3B,
ten dokument). Reguła obszaru (stan i zasady w skrócie): `.claude/rules/warp.md`, kamera — `.claude/rules/kamera.md`,
szew workera — `.claude/rules/render-worker.md`.

## Cel użytkownika

Prośba z 2026-10-25 (dosłownie):

> „próbowałem różnych metod warp, jednak ciężko mi osiągnąć feel przyspieszania do warp, wychodzenia z warp, dobrych
> efektów przechodzenia nad planetami/rzeczami z gry. Kiedy w webgl był prototyp »soczewka« świata, gdzie podnosiliśmy
> cały świat, wtedy było widać wszystkie planety i się je powiększało/pomniejszało — był to trochę prymitywny efekt,
> ale najlepiej oddawał to, co chcę osiągnąć — że w warpie ustawiasz planetę daleko, jest mała, i jak mijasz, to
> ogromna, potem znowu mała, i inne elementy gry też takie powinny być. Odpicuj efekt warp i zrób go raz a porządnie.”

Prototyp, o którym mowa, to „kropla” z 2026-09-26 (commit 96854205, `src/3d/warpWorldLens.js` w tamtej wersji): świat
ściśnięty wokół statku, wielkość ~1/d. Wcześniejsza uwaga (2026-10-23): „przelot nad planetami ma wyglądać podobnie
do dotarcia do celu: planeta z daleka, powiększa się powoli, pod statkiem duża, potem ucieka za statek”.

Odpowiedź: JEDEN warp gracza. Widowiskiem jest ŚWIAT W SOCZEWCE — każde ciało (planety, księżyce, małe ciała,
słońce) i rzeczy przypięte do nich są w kadrze skoku, z daleka małe, w trawersie ogromne, za rufą maleją; do tego smugi
gwiazd, kop kamery i przylot jako jedno zdarzenie. Rozgrywka (fizyka skoku, rampa, ślizg, zwolnienie przy ciałach)
bez zmian — 3D to tylko obraz.

## Mapa C „perspektywa drogi” (`src/3d/warp/worldLens.js`)

Osie EKRANU (kadr obrócony kursem w górę), ciało względem statku: `a` — wzdłuż kursu (+ przed dziobem), `l` — w bok.
Drogi od kotwicy do krawędzi kadru: przed dziobem `e_f`, za rufą `e_b`, w bok `e_s` [px].

```
W   = w_s · e_s                       pas boczny
S_b = W / √(l² + B²)                  skala w trawersie [px/j.] — każde ciało, nawet 2 mln j. z boku, ma pas w kadrze
E   = h_f · e_f   (a ≥ 0)             punkt zbiegu przed dziobem
    = h_b · e_b   (a < 0)             punkt zbiegu za rufą (h_b > 1 — poza kadrem)
A   = E / S_b,   |a|ε = √(a² + ε²) − ε,   ε = eps · A,   κ = A / (A + |a|ε)
q   = S_b · κ;   obraz = P0 + q · (dx, dy);   promień = q · r
przejście β:  q_β = flat^(1−β) · S_b^β · A / (A + β · |a|ε)      (β → 0 — dokładnie prawdziwy obraz)
```

Parametry (`WORLD_LENS_DEFAULTS`): `hf` 0,8, `hb` 1,25, `ws` 0,8, `B` 45 tys. j. (symulator: kontrole przechodzą dla
40–52 tys., od 55 tys. Mars 75 tys. j. w trawersie < 250 px przy 1080p), `eps` 0,5. Wszystko w px skaluje się
z rozdzielczością (1440p × 1,333).

Rysunek słowny (kadr 1920 × 1080, kurs w górę, statek ~⅓ wysokości pod środkiem):

- Daleki cel i ciała przed dziobem siedzą przy PUNKCIE ZBIEGU — 0,8 drogi od statku do górnej krawędzi — jako kropki
  (≥ 2 px planety i słońce; słońce × 5). Zbliżając się, schodzą z punktu zbiegu po prostych ku statkowi i rosną
  (wielkość z daleka ≈ r · E / a).
- W TRAWERSIE ciało jest największe (Mars mijany 75 tys. j. z boku: ~263 px promienia przy 1080p), leży w pasie
  bocznym `w_s · e_s` od statku — namiar prawdziwy (obraz na kierunku ciała), mijanie po właściwej stronie.
- Za rufą ciało odpływa ku punktowi zbiegu ZA KADREM (1,25 drogi do dolnej krawędzi) — wyjeżdża dolną krawędzią
  malejąc, nie parkuje.
- Tarcza nigdy nie zachodzi na kadłub (`q · (d − r) > 0` i kieszeń kadłuba z ringiem `rExt`, odstęp `edgeGap` 24 px).
- Ciała za celem w stożku ±30° wokół kursu zanurzają się (promień → 0 płynnie), żeby nie siedziały na tarczy celu.

KOTWICA P0 (M3): `P0(β) = statek + (P0_nom − statek) · β`, P0_nom — nominalne miejsce statku w kadrze (sprężyna riga
BEZ kopu i BEZ wysunięcia: `cameraRig.nominalX / Y`). Przy β = 1 świat soczewki stoi w kadrze jak gwiazdy, a statek
wyrywa się względem niego przy kopie. Planety tła (z = −50 000): kotwica × (flat / zoom)^(1−β).

Tryby przejścia ciała (P2), ustalane RAZ na przejście: RUCH (rodzina q_β — cel, ciało z prawdziwym obrazem w kadrze
albo bliskim) albo WYNURZENIE / ZANURZENIE w miejscu obrazu soczewki (promień × smoothstep(0,1; 0,8; β), położenie
× (1 + 0,06 · (1 − β))). Ciało nie wjeżdża pod statek i nie przelatuje przez kadr.

Rozstawienie w świecie: `lensImageToWorld` (jedna czysta funkcja: płaszczyzna gry 1 / zoom, tło (camZ − z) / focal,
obrót kadru) — planety, księżyce, małe ciała i słońce (`planet3d.assets.js`: `newLensBody(id, kind)`).

## Oś faz (`src/render/warpLensPhase.js`, zegar GRY)

| faza | czas | soczewka (β) | obraz i kamera |
|---|---|---|---|
| ŁADOWANIE | `warp.chargeTime` 0,8 s | 0 → 0,9 · smoothstep(postęp) — „świat wstaje”: planeta startu odpada pod rufę, reszta wchodzi w kadr | smugi gwiazd 0,32 · ładowanie², oddalenie × 0,55, drżenie w 2. połowie, cień kadłuba gaśnie |
| KOP | 0,45 s | 0,9 → 1 easeOut³ | smugi gwiazd z 0,32 przestrzał × 1,4 w 0,12 s (bez ząbka), fala w punkcie skoku, błysk za rufą, kop kamery (statek wyrywa się ~96 px), zoom −10%, wstrząs 18 / 0,3 (gra) |
| LOT | do wyjścia | 1 | smugi gwiazd, świat w soczewce; przy mijanym ciele statek zwalnia do ~15% (fizyka), przepływ widoczny z nim |
| WYJŚCIE — zwolnienie | `ramp.slow` 0,7 s | front smug gwiazd od dziobu ku rufie (+18 → −18 tys. j.); ciało zanurza się / wraca 0,3 s po przejściu frontu | smugi gasną frontem, wstrząs 8 / 0,4; cel trzymany (niżej) |
| WYJŚCIE — wlot | `ramp.coast` 0,45 s | jak wyżej | statek leci z prędkością wlotu; z celem bez wysunięcia (K1) |
| PRZYLOT = hamowanie | chwila `ramp.tBrake` | cel rośnie z hamowaniem | jedno zdarzenie: błysk, blask, fala 0,5 L, żar τ 0,45 s, wstrząs 22 / 0,3, zoom +10% |
| ŚLIZG | do prędkości bojowej (~5 s) | wiek wyjścia trwa do zatrzymania + 14 s (`WARP_LENS_EXIT_SPAN`) | rampa hamuje do vEnd = 3 × prędkość bojowa, potem ślizg; kadr przylotu trzyma do zatrzymania + 1 s, powrót do zoomu gracza smoothstep 2 s |

Przerwane ładowanie: β opada w 0,3 s. Wyjście bez rampy (hamowanie grawitacyjne, teleport): wirtualna rampa od tej
klatki, ten sam front. Wyjście w trakcie kopu: β wyjścia = β z chwili wyjścia, tryby z wejścia zostają. Hipercruise:
β = 0 (bez soczewki — gra obok statku czytelna).

Strona gry liczy oś raz na klatkę renderu: `stepPlayerWarpLensPhase()` (`index.html`) → `stepWarpLensPhase(track, s,
warp, SimClock.render)`. Rekord `s` idzie do klatki „Nurtu” (`o.lensPhase`, tryb off) i do migawki (worker) —
`warpLensBeta(s)` daje to samo β w obu trybach.

## Cel i kadr przylotu

- Cel (`warp.targetBody`, planeta przy końcu odcinka TRAVEL TO) jest w soczewce od kopu jak każde ciało — z daleka
  kropka w punkcie zbiegu („ustawiasz planetę daleko, jest mała”).
- Skala celu `q_T` = miękkie maksimum w logarytmie (szer. 0,15) z `q` mapy i podglądu kadru przylotu `z_v` —
  `warpArrivalScale` z `src/render/warpArrivalFrame.js`, TA SAMA funkcja i stałe co kamera (`arrivalDist` riga):
  `z_kam = fill · edge / (d − k · (ce − (1 − fill) · edge))`, `fill` 0,75, k = głębokość / ogniskowa (cel na tle
  z perspektywą i paralaksą; płaszczyzna gry — k = 0), miękkie minimum z kadrem skoku `zoomRef`. Bliski brzeg zbiega do
  krawędzi kadru przylotu, tarcza rośnie RAZEM z hamowaniem.
- Przy wyjściu β celu = 1, dopóki kamera nie zbiegnie z podglądem (|ln(skala prawdziwego obrazu / q_T)| < 0,05 przez
  0,05 s) albo do zatrzymania + 0,3 s (najwyżej 8 s po rampie); potem puszczenie smoothstep 0,6 s na prawdziwy obraz.
  Od zatrzymania q_T nie mniejsze niż prawdziwy obraz (podłoga w 1 s). Cięcie (teleport) — od razu.
- Księżyce celu jadą skalą celu. Cel bez obrotu przelotu (`lensFaceQuat`).
- Sterownik trzyma soczewkę, póki `WARP_WORLD_LENS.targetHold` > 0.

## Kamera K1 (`src/game/cameraRig.js`, `src/game/cameraZoom.js` — reguła `kamera`)

- Kadr przylotu przy wyjściu Z CELEM: sprężyna logarytmu zoomu goni zoom, przy którym bliski brzeg PRAWDZIWEGO obrazu
  celu leży na 0,75 drogi do krawędzi przed dziobem (kamera tylko się odsuwa — miękkie minimum z kadrem skoku).
- Podłoga zoomu tylko przy zatrzaśniętym kadrze przylotu: 0,07 · zoomRef (`rig.warpZoomFloor` → `camera.zoomImpulseMin`
  → `cameraZoomFloor`; wyjątek od limitu kadłuba 0,035 — kadr przylotu do Marsa przy 1080p ~0,019, Atlas wtedy mały).
- Bez wysunięcia statku przy wyjściu z celem (`WARP_EXIT.ahead` × 0), wyprzedzenie zostaje. Swobodny skok — wysunięcie
  0,4 pół kadru i dogonienie w 1,3 s jak dawniej.
- Trzymanie kadru przylotu do końca ślizgu + 1 s, powrót do zoomu gracza smoothstep 2 s. Nowe ładowanie przy
  zatrzaśniętym kadrze — zejście do kadru skoku smoothstep 0,8 s.
- Obrót kadru kursem w górę od ładowania do chwili po zatrzymaniu (`stepCameraRigRoll`, `warpJumpRollOmega` 5/s).
- Hipercruise kolejnego odcinka TRAVEL TO przejmuje kamerę dopiero po powrocie kadru przylotu (`playerWarpArrivalLive()` w `index.html`).

## Ośrodek wyłączony (DECYZJE O1)

Ośrodek drobin (1 mln, turkus i pomarańcz) i soczewka bańki na mgławicy w skoku GRACZA są domyślnie wyłączone
(`player.js: warpMediumOn`) — turkusowe czoło leżało przed dziobem, w strefie punktu zbiegu, i rysowało się po
planetach. A/B: `?warpOsrodek=1` (działa też w workerze), w testach i demie `setWarpMedium(true | false | null)`.
Przyloty i odloty NPC (nić zwiastuna, bańki) i hipercruise (`?hcOsrodek=1`) bez zmian. Koszt `?warpOsrodek=1`
niezmierzony (otwarte).

## Jeden warp (sprzątanie S1)

Style skoku `'rulon'`, `'akcent'`, `'soczewka'` usunięte z `player.js`, z rigu kamery (środek lejka) i z dema.
`warpDrive.js` trzyma API zgodne dla dawnych importów (`warpStyle` → 'ped', `warpRulonEnabled` → false,
`setWarpStyle` → null). Usunięty martwy kod: szczeliny, szwy i smugi sylwetki (`addRift` / `addSeam` / `addSeamLens` /
`addSmear`, `RiftSprites`, `SmearPool` i ich rozgrzewka), implozja i soczewka bańki jako fale, `gearPulse` / `gearT`,
`WARP_FLOW.gear1`, `frame.shake`, `frame.busy`, `RULON_BOX`. Bez zmiany WGSL materiałów gry: bloki szczelin w kernelu
ośrodka i w mgławicy zostają (liczniki 0), hak rulonu zostaje (decyzja C2 — niżej).

## Worker (domyślny tryb gracza)

Migawka (`src/render/snapshotLayout.js`, `SNAPSHOT_LAYOUT_VERSION` 3, WORLD, Float64, pole nieobecne = NaN), lustro
czystym modułem `src/render/warpWorldMirror.js` (`applyWarpWorld`, bez alokacji):

- stan i lot: `WARP_STATE`, `WARP_CHARGE`, `WARP_CHARGE_TIME`, `WARP_GEAR` (martwy — do usunięcia przy następnej zmianie
  układu), `WARP_FLYBY`, `WARP_CRUISE`, `WARP_SPEED`, `WARP_ENTRY`, kurs `WARP_DIR_X / Y`;
- ciała: `WARP_TARGET_BODY`, `WARP_ORIGIN_BODY` — indeks na liście `planets ++ smallBodies` (−1 — brak);
- zegary: `WARP_KICK_SIM` (SimClock.sim kopu), `WARP_FX_CLOCK`;
- rampa wyjścia: `WARP_EXIT_ACTIVE`, `WARP_EXIT_AGE`, `_T0`, `_SLOW`, `_COAST`, `_BRAKE`, `_TSLOW`, `_TBRAKE`, `_THALT`,
  `_V0`, `_VARR`, `_VEND`, `_DIST`, `_DIR_X / Y`, `_HULL`;
- ślizg: `WARP_SLIDE_ACTIVE`, `_SPEED`, `_VMIN`, `_DECEL`, `_DIR_X / Y`; hamowanie grawitacyjne `WARP_ABRUPT`;
- kotwica kadru: `WARP_ANCHOR_SX / SY` (= −`cameraRig.nominalX / Y`, px CSS, osie ekranu; NaN poza kamerą statku);
- oś β: `WARP_LENS_*` (`WARP_LENS_FIELDS`: charge, kickAge, exitAge, exitSlow, exitHalt, exitBeta, abortAge, abortBeta,
  zoomRef, zoomJump, arrivalFill, …) + `WARP_LENS_STATE`, `WARP_LENS_HYPER`, `WARP_LENS_ARRIVING`.

Wstrząsy kopu, wyjścia i hamowania zgłasza GRA (`src/game/warpShakes.js` — te same chwile i wartości w obu trybach),
plazma WARP i dopalacza gracza działa w workerze, księżyce stoją w węzłach gry (`src/3d/moonOrbit.js`). Parzystość
β off ≡ worker: `tests/warpWorkerMirror.test.mjs`.

## Reszta świata w soczewce — rejestr kotwic (etap 3A, DECYZJE E1–E4)

„Inne elementy gry też takie powinny być” — w skoku jedzie z soczewką wszystko, co gracz widzi w świecie, a nie tylko
ciała. Trzy drogi, wszystkie przez wspólną soczewkę gry `WARP_LENS_SHARED` (`worldLens.js`, jedna na wątek renderu):

1. **Rzecz PRZYPIĘTA do ciała** (ring „Halo”, stacje przy planetach i małych ciałach, doki portów bez ringu) —
   kotwica ciała w rejestrze `WARP_LENS_ANCHORS[id]`. Pisze ją `planet3d.assets.js` po rozstawieniu ciał
   (`writeLensAnchor`: x, y — punkt płaszczyzny gry pod obrazem środka ciała, przy β → 0 prawdziwy środek także dla
   ciał tła z paralaksą; k — promień obrazu / prawdziwy; rx, ry — prawdziwy środek; px, real, vis, q / turned). Klucz:
   id planety, `mapId` księżyca ('luna', 'io'…), id małego ciała; słońce kotwicy nie ma. Obraz rzeczy:
   `p' = (x, y) + k · (p − (rx, ry))` (`lensAnchorPoint`); budowla z ramką — `root.matrix` = `lensPivotElements` · ramka
   (skala dodatnia — ten sam pipeline). Stacja bierze kotwicę `station.planet.id`, dok — id portu (księżyc bez bryły:
   planeta-rodzic z `SYSTEM_MAP_MOON_BY_ID`; w workerze kod ciała w bloku migawki `ANCHOR`). `WARP_RING_LENS` to ten sam
   rejestr (nazwa zgodności). Stacje i doki zgłaszają zasięg (`reach` → `b.attachR`): ciało z rzeczą przypiętą w kadrze
   wchodzi w soczewkę RUCHEM, więc dok startu nie przeskakuje w klatce wynurzenia (za to ciało może wjechać w kadr
   szybciej niż próg P4 — test „start z doku Ceres”: dok ≤ 11 px/klatkę, ciało 50–114 px/klatkę).
2. **Obiekt z WŁASNYM miejscem** (komety `comet:<id>`, olbrzymy pasa `giant:<id>`, planetoida Hidalgo z bazą piratów
   `hidalgo`, dok bez ciała — kryjówka, stacja gracza — `dock:<n>`) — rekord dodatkowy `warpLensExtraBody(klucz)`
   + `setWarpLensExtra(…)` co klatkę, także poza skokiem. Rekord idzie w tym samym przebiegu `WarpWorldLens.update` co
   ciała (tryby przejścia, front wyjścia, stożek za celem, kropki), z jedną klatką zwłoki położenia; kotwica pod kluczem
   rekordu. Olbrzym nie ma bryły w soczewce — elipsa `smudge` w partii kropek (impostor bez SDF), prawdziwy widok
   schowany od progu 0,02. Kometa: arkusz i jądro × k z ≤ −400. Hidalgo, osada z windą i bryła bazy: macierz soczewki
   wokół środka skały; kawałki bazy w bańce gracza i światła masztów gasną na czas soczewki. Obiekt znikający na stałe
   zwalnia rekord (`dropWarpLensExtra` — rejestry nie rosną przy długiej sesji).
3. **PUNKTY — floty, NPC, wraki (gorące i zimne)** — kropki. Strona gry raz na klatkę renderu (`prepareWarpLensDots`,
   `stampWarpLensDots` w `index.html`) stawia `__lensDot`, gdy udział soczewki PUNKTU ≥ `WARP_LENS_DOT_SWAP` (0,02):
   `warpLensDotFor` → `warpLensPointBeta` (`src/render/warpLensPhase.js`, jednostki świata — ta sama funkcja daje
   `out.beta` w `mapPoint` renderu, więc decyzja i obraz się nie rozjeżdżają między px CSS a px bufora). Encja z kropką
   jest ukryta jak we mgle (predykat ukrycia kadłubów, `fogSeenInto`, migawka: `FOG_HIDDEN` + `ENT_FLAG.LENS_DOT`) —
   skóra, dysze, lampy, wieże, mostki, modele 3D, tarcze, rdzenie, nakładki 2D. Kropkę rysuje `HexBodyLensBatch`
   (`hexBodyImpostorBatch.js`: ten sam materiał co smugi dalekich wraków, jeden rysunek, z = −640 pod kadłubami) na
   pozycji `WARP_LENS_SHARED.mapPoint(x, y, out, r)`: kadłub × skala obrazu, najmniej ~2 px widocznej plamki, barwa =
   średnia sprite'a, krycie × `out.alpha` × widoczność maskowania. Mgła wojny wygrywa (ukryta encja nie ma kropki),
   gracz i drugi gracz zawsze normalnie. Zimne wraki decyduje render (`pushColdWreckLensDots`: smuga z migawki), ich
   dodatki (mostki, modele, rdzenie) chowa ta sama decyzja per wrak (`withColdNearWrecks` → pakowanie pomija je
   w `COLD_NEAR`). Statki ruchu v2 (proxy bańki) od progu kropki wypadają z listy obrazu (`lensHideTrafficProxies`),
   kropek nie mają.
   - W WYJŚCIU punkt wraca na prawdziwe miejsce w 0,3 s (`submerge`) od chwili, gdy front smug gwiazd minie jego
     PRAWDZIWE miejsce (`warpExitFrontCross` — odwrotność frontu, bez stanu). Prawdziwe miejsce w kadrze — kropka
     dojeżdża widoczna (67 / 39 / 60 px/klatkę przy zoomie 0,12 / 0,04 / 0,3) i oddaje miejsce skórze; poza kadrem
     (brzeg kadłuba dalej niż `pointEdgeSoft` 96 px) — stoi w obrazie soczewki, póki gaśnie, potem jedzie niewidoczna.

**Warstwy (E3):** nic z soczewki nie rysuje się na statku. Bryły w perspektywie (stacje, doki, Hidalgo i baza, ring)
w skoku przechodzą do passa TŁA (warstwa 1 — ta sama kamera perspektywy co FG, rysowany przed passem gry; rzut się nie
zmienia, więc wysokie części nie skaczą), płaskie (komety, kropki) leżą na z ≤ `WARP_LENS_UNDER_Z` (−400) w passie gry.
Po skoku wracają na FG.

**HUD (E4):** znaczniki świata na kanwie (kontakty, podpisy planet, nakładki NPC, rozkazy, cele fabuły, HUD mgły) gasną
z alfą 1 − `warpLensHudBeta` (`_hudLensAlpha` w `index.html`), przy alfie ≤ 0,01 nie rysują się wcale; rysunki
z absolutną alfą (liny holownicze, zaznaczenie z paskami życia, ikony infrastruktury) są chowane od progu kropki
(`warpLensHudWorld()`). HUD kursu warpa zostaje — namiar w mapie C jest prawdziwy.

Gdzie co jest: reguła `warp` („REJESTR KOTWIC SOCZEWKI”) i reguły obszarów `stacje`, `doki-portow`, `komety`,
`pas-asteroid`, `baza-piratow`, `kadluby-belki` (floty, NPC, wraki), `radar-cic` (znaczniki). Test:
`tests/warpLensAnchors.test.mjs` (punkty, doki, zwalnianie rekordów, start z doku Ceres), przypadek migawki
w `tests/snapshotPack.test.mjs`.

## Symulator i weryfikacja

`node scripts/webgpu/warp-soczewka-sym.mjs` — symulator dowodowy bez przeglądarki: prawdziwe moduły gry i renderu
w Node (fizyka skoku, rampa, ślizg, kamera gry z K1, oś β jak w grze, `WarpWorldLens` na rekordach jak
`planet3d.assets.js`), krok 60 Hz. Scenariusze: S1 Ziemia → Jowisz z Marsem w trawersie, S2 Ziemia → Mars,
S3 swobodny skok obok Jowisza, S4 Jowisz → Saturn (cel na tle), S5 przerwane ładowanie, S6 Ziemia → Mars z Jowiszem
w stożku za celem. Opcje: `--scen S1,S4`, `--res 1080,1440`, `--B 45000`, `--tory gl|wszystkie|nie`, `--md plik.md`,
`--json plik.json`, `--origin-ruch` (A/B planety startu „ruchem”). Kod wyjścia ≠ 0, gdy kontrola nie przejdzie
(progi P4: ruch środka ≤ 60 px/klatkę, promień ≤ 50 px/klatkę, 0 mignięć; kryteria C1–C5; stożek C6).

Wyniki etapu 2 (1080p): Mars w trawersie 263 px, cel rośnie przy wyjściu × 3,97, puszczenie celu przez zbieżność kamery
(1,0 px/klatkę), Saturn jako cel na tle × 3,82, największy skok w wyjściu 38,9 px/klatkę, najmniejszy odstęp tarczy od
kadłuba 87 px, 0 mignięć. W grze (worker, Ziemia → Mars): 0 klatek z NaN, 0 pipeline'ów synchronicznych, cel w kadrze
w każdej klatce od pierwszego pojawienia.

Wyniki etapu 3 (kontrola całości, 2026-10-26): symulator bez zmian względem etapu 2 (te same liczby). W grze (worker,
`warp-ped-gra`, dwa przebiegi z losową trasą do Marsa — przelot obok Jowisza, potem obok Merkurego): 0 klatek z NaN,
0 błędów strony (poza 404 favicon) i workera, cel w kadrze w każdej klatce od pierwszego pojawienia, komety w kadrze
soczewki. Pierwszy przebieg złapał 1 pipeline synchroniczny `CometNucleus_hale-bopp` — w workerze komety nie miały
wpisu rozgrzewki (luka sprzed etapu, odsłonięta, bo kometa wjeżdża teraz w kadr skoku z daleka); po dopisaniu wpisu
w `setComets` (`render.worker.js`) drugi przebieg — 0 pipeline'ów synchronicznych z kometami w kadrze.

Testy: `warpWorldLens`, `warpLensMapC`, `warpLensPrzejscia`, `warpWorkerMirror`, `warpNurt`, `cameraRig`,
`hypercruiseLook` (odcisk O3 — hipercruise bez zmian). W grze: `node scripts/webgpu/warp-ped-gra.mjs
[--query renderWorker=1]` (losuje trasę; w trybie worker mierzy tylko cel). Demo: `/dema/warp-ped.html`
(te same moduły; `scripts/webgpu/warp-ped-demo.mjs [--osrodek 0,1]`).

## Decyzje podjęte przez orkiestratora za użytkownika

Użytkownik nie był pytany w trakcie (DECYZJE.md, 2026-10-25) — każdą z tych rzeczy da się cofnąć:

1. **Ośrodek drobin w warpie gracza wyłączony** (O1) — A/B `?warpOsrodek=1`.
2. **Jeden styl skoku** (S1) — style rulon / akcent / soczewka usunięte; hak rulonu w materiałach zostaje do decyzji C2.
3. **Atlas mały przy przylocie** — kadr przylotu odsuwa kamerę, aż brzeg celu zmieści się w kadrze; podłoga zoomu
   0,07 · zoomRef schodzi poniżej limitu kadłuba (przy Marsie ~0,019 przy 1080p — Atlas ~30 px).
4. **Planeta startu bez ruchu** (`originMove: false`) — ciało startu przechodzi w soczewkę regułą ogólną (wynurzenie
   w miejscu), nie „ruchem” rodziny q_β: przy ruchu Ziemia skakała 100 px/klatkę w ładowaniu (ponad próg P4). A/B:
   symulator `--origin-ruch`.
5. **Luna (i księżyce Jowisza) nieruchome w węźle gry** (W2) — faza Luny nie jest już losowa (`Math.random` w module
   renderu łamało zasadę 9); obraz = pozycja węzła gry, tak samo w obu trybach. Wyjątek: Io (obraz 86 tys. j., węzeł
   60 tys.).
6. **B = 45 tys. j.** (DECYZJE: 40 tys.) — środek przedziału, w którym przechodzą kontrole symulatora.
7. **Hipercruise kolejnego odcinka TRAVEL TO czeka na koniec kadru przylotu** (dodatek do K1) — inaczej zoom skakał
   0,035 → 0,16 w kilku klatkach.
8. **Porty bez ringu** (Luna, Ceres, Westa, Wenus): ciało startu jest w soczewce od ładowania (M6), bramka zostaje tylko
   dla ringu „Halo”.

## Do sprawdzenia w grze (jutro, użytkownik)

Tryb domyślny (worker); wybrane trasy powtórzyć z `?renderWorker=0`.

1. **Ziemia → Jowisz (TRAVEL TO)**, najlepiej z Marsem blisko kursu.
   - Ładowanie: świat „wstaje” — Ziemia odpływa pod rufę i maleje, dalsze planety pojawiają się jako kropki, bez
     przeskoku przez kadr.
   - Kop: smugi gwiazd strzelają bez cofnięcia w pierwszej klatce, statek wyrywa się do przodu.
   - Lot: Jowisz to kropka w punkcie zbiegu nad dziobem i POWOLI rośnie; Mars w trawersie duży (kilkaset px), potem
     ucieka pod rufę i wyjeżdża dolną krawędzią malejąc; słońce widoczne jako jasna kropka; nic nie zachodzi na kadłub.
   - Wyjście: rzeczywistość prostuje się przed dziobem (front smug), ciała zanurzają się z frontem, bez „trzasku”.
   - Przylot: Jowisz rośnie RAZEM z hamowaniem, przejście w prawdziwy obraz bez skoku i bez mignięcia; ring Jowisza
     jedzie z planetą i nie rysuje się na statku; jeden błysk + fala (bez drugiego „wybuchu”); Atlas mały w kadrze
     przylotu; ślizg z pędem, potem kamera wraca do zoomu gracza (2 s).
2. **Ziemia → Mars (krótki skok)**: cel od kropki do kadru przylotu bez skoku; Luna przy starcie nie skacze.
3. **Jowisz → Saturn**: cel NA TLE (planeta pod płaszczyzną gry) — rośnie i puszcza bez zmalenia po przylocie;
   pierścień Saturna.
4. **Swobodny skok (CapsLock) w bok obok Jowisza** i wyjście klawiszem: bez celu, wysunięcie statku i powrót kamery
   jak dawniej; Jowisz mijany duży.
5. **Przerwane ładowanie** (CapsLock dwa razy): świat opada w ~0,3 s bez przeskoku.
6. **Start z portu bez ringu** (Luna, Ceres, Westa, Wenus): ciało startu jedzie w soczewce od ładowania. Patrz:
   dok i stacja jadą z ciałem (maleją i odpływają pod rufę), leżą POD statkiem (pass tła), bez skoku wysokich części
   bryły przy przełączeniu warstwy; statki ruchu v2 zacumowane przy doku znikają z obrazu (nie zostają w powietrzu);
   ciało startu może wjechać w kadr szybko (ruch wymuszony dokiem — znane, test D8).
7. **Hipercruise** (krótki odcinek TRAVEL TO, < 40 tys. j.): wygląd jak przed zmianą (smugi, fale, żar, bez soczewki);
   kamera po przylocie przechodzi w hipercruise kolejnego odcinka bez skoku zoomu.
8. **Przylot NPC** (wezwanie wsparcia, piraci): nić zwiastuna, błysk, fala — jak dawniej (usunięte szczeliny nie były
   używane).
9. **HUD**: znaczniki kontaktów i podpisy planet gasną w skoku i wracają frontem przy wyjściu (3A); HUD kursu warpa
   zostaje.
10. **A/B ośrodka**: ta sama trasa z `?warpOsrodek=1` — dawny ośrodek drobin w skoku; porównać czytelność i płynność.
11. **Skok przy flocie** (własne skrzydło albo NPC obok statku, potem przylot do miejsca z flotą — np. scena „Wojna”
    albo wezwanie wsparcia przed skokiem): na początku ładowania okręty zamieniają się w kropki (próg 0,02 — skóra →
    płaska elipsa bez przenikania; oceń, czy razi), kropki jadą z soczewką pod statkiem; przy wyjściu kropki z miejscem
    w kadrze dojeżdżają na nie i oddają miejsce skórze, kropki z miejscem poza kadrem gasną w miejscu (bez przelotu przez
    kadr). Wróg z maskowaniem nie świeci kropką.
12. **Pole wraków / zimne wraki** (po bitwie, skok z pola): wraki jako smugi w soczewce, po skoku skóra i mostki
    wracają bez mignięcia.
13. **Przelot obok Ceres i pasa** (TRAVEL TO przez pas): stolica Unii przy Ceres (~14 px) jedzie z obrazem Ceres;
    olbrzymy pasa jako elipsy, bez podwójnego obrazu w ładowaniu; komety (arkusz i jądro razem, w soczewce mniejsze
    i ciemniejsze); misja 1 / Hidalgo — skała, osada i baza jadą razem (kawałki bazy w bańce i światła masztów gasną na
    czas skoku).
14. **Port K-7 z ringiem** (Ziemia / Mars): ring zostaje prawdziwy, póki jest w kadrze, a NPC przy nim robią się
    kropkami i odpływają mapą punktu (znane — D3); oceń, czy widać rozjazd.
15. **HUD w skoku**: liny holownicze, zaznaczenie z paskami życia i ikony infrastruktury znikają od początku ładowania
    i wracają po wyjściu; znaczniki kontaktów gasną płynnie.
16. **Wydajność** (PerfHUD `P`): liczba rysunków w skoku z dokiem startu i stacją Ceres w kadrze, brak przycięć przy
    przejściu stacji i doków na pass tła (pipeline'y synchroniczne — narzędzie `warp-ped-gra` niżej).

## Otwarte sprawy

- **Pętla hipercruise'u w TRAVEL TO** (błąd rozgrywki sprzed etapu): odcinek o długości między `minLeg` (6 km)
  a `minLeg + stopMargin` startuje hipercruise co ~1 s (`travelTryHypercruise`, `hcRetryAt`), a hipercruise wychodzi
  po 2 klatkach. Propozycja: nie startować hipercruise'u przy `d < minLeg + stopMargin` — osobne zadanie.
- **Io**: obraz na 86 tys. j., węzeł gry i port ruchu v2 na 60 tys. (węzeł leży pod ringiem Jowisza).
- **Przekazanie kamery hipercruise'owi po przylocie**: po powrocie kadru przylotu hipercruise od razu oddala kadr
  (0,178 → 0,098 w ~0,5 s), a soczewka zeruje się przy hipercruisie odcinka od razu — warto przekazać kamerę wprost.
- **Koszt `?warpOsrodek=1`** i koszt klatki w kadrze przylotu (podłoga 0,07 · zoomRef, Mars z halami K-7 i ruchem v2)
  — niezmierzone (`scripts/webgpu/koszt-klatki.mjs`).
- **Hak rulonu (C2)**: zostaje w etapie wierzchołków każdego materiału; usunięcie = przebudowa WGSL wszystkich
  materiałów (lista w `.claude/rules/warp.md`, „HAK RULONU”; projekt D § 6). Razem z nim: bloki szczelin w ośrodku
  i mgławicy, martwe uniformy gwiazd (`warpFactor`, `moveDir`, `exitWhip*`) i mgławicy, opcjonalnie `DISTORT.BUBBLE`.
- Martwe pola gry w `index.html` (`warp.gear`, `lastDir`, `warpBrakeTimer`, `turnRate`, `orientTolerance`) i słowo
  migawki `WARP_GEAR` — do usunięcia przy najbliższej zmianie tych plików. Tamże resztki stylu rulonu w kamerze
  (`updateCameraWarpKick`): pole wejścia `rulon` (`_cameraWarpInput`, start `rulon: true`), zapis
  `w.rulon = … warpRulonEnabled(location.search)` (zawsze false — rig pole ignoruje), import `warpRulonEnabled`
  i nieaktualny komentarz „`?warp=akcent|soczewka`; rulon tylko z `?warp=rulon`”. Usuwając je, usuń też import
  i atrapę `warpRulonEnabled` w `tests/cameraRig.test.mjs`; API zgodne w `warpDrive.js` może wtedy zniknąć.
- Wstrząs zwracany przez `warpArrivalFxState` / `warpDepartureFxState` (`arrivals.js`) jest nieczytany (wstrząsy
  przylotów zgłasza gra) — notatka `AGENT:` w pliku, usunąć przy C2.
- `scripts/webgpu/warp-ped-gra.mjs` losuje trasę w każdym przebiegu i w trybie worker nie mierzy mijanego ciała.
- **Reszta świata (3A) — do oceny w grze:**
  - Zamiana skóra → kropka przy udziale 0,02 bez przenikania: przenikanie wymaga alfy per obiekt w grafie partii skór
    (dziś `lodOpacity: float(1)`), czyli zmiany WGSL kadłubów, i dałoby szwy nakładających się kafli węzłów.
  - Dwie mapy przy statku: punkty (NPC, wraki) nie znają bramki ringu ani trzymania celu — przy porcie K-7 z zamkniętą
    bramką ring stoi prawdziwy, a NPC odpływają mapą punktu; przy przylocie NPC portu celu wracają na prawdziwe miejsca,
    gdy cel jest jeszcze trzymany w soczewce; NPC przy doku jadą mapą punktu, a dok skalą ciała. Propozycja: render
    przypina punkty w zasięgu zakotwiczonego ciała (dok `keepR`, ring `rExt`, cel trzymany) do jego kotwicy
    (`lensAnchorPoint`); strona gry potrzebuje wtedy stanu bramki i trzymania celu do decyzji kropki.
  - Bazy piratów: odłamy kawałków straconych znikają na czas soczewki, kawałki ruszone wracają do statyki bez śladów
    ran (poprawka — macierz soczewki w `worldBodies3D`).
  - Testy stacji, komet, olbrzymów i Hidalgo to regexy na źródle (zachowanie sprawdzają testy punktów, doków,
    zwalniania rekordów, startu z doku i migawki).
  - Liczba rysunków brył GLB stacji w soczewce i koszt przełączenia stacji / doków na pass tła — niezmierzone.
  - Mijane porty dochodzą do listy obrazu dopiero w 90 tys. j. od kamery (mała budowla pojawia się przy przelocie
    blisko portu).
- Demo „Nurt” (`dema/warp-webgpu.html`) wycofane — ciała idą przez bezstanową mapę C bez trzymania celu.

## Słowniczek kodów decyzji

Kod, testy i reguły etapu powołują się na kody z dokumentu decyzji orkiestratora („DECYZJE”, 2026-10-25) i na
projekty panelu („projekt A–D § …”). Tych plików nie ma w repo — co weszło do kodu, opisuje ten dokument; kody:

| kod | znaczenie |
|---|---|
| M1, M2 | mapa C „perspektywa drogi” i jej parametry (wzory i `WORLD_LENS_DEFAULTS` — § „Mapa C”) |
| M3 | kotwica P0 = nominalne miejsce statku w kadrze (sprężyna riga bez kopu i wysunięcia), tło × (flat / zoom)^(1−β); do workera skalarami migawki |
| M4 | ciała za celem w stożku ±30° zanurzają się (nie są wycinane na stałe) |
| M5 | każde ciało w soczewce: planety, księżyce, małe ciała, słońce (`sunBoost` 5, kropki ≥ 2 px, poniżej 1,5 px nie rysować) |
| M6 | planeta startu w soczewce („świat wstaje”); bramka ringu „Halo” zostaje |
| P1 | oś β z zegara gry: ładowanie 0,9 · smoothstep, kop 0,9 → 1, lot 1 — czysta funkcja, ta sama w off i w workerze |
| P2 | tryb przejścia ciała ustalany raz na przejście: RUCH albo WYNURZENIE / ZANURZENIE w miejscu |
| P3 | wyjście: ciała zanurzają się / wracają frontem smug gwiazd (od dziobu ku rufie) |
| P4 | progi ciągłości przy 60 Hz: środek ≤ 60 px/klatkę, promień ≤ 50 px/klatkę, 0 mignięć |
| T1 | cel w soczewce od kopu; skala = miękkie maksimum z podglądem kadru przylotu (ta sama funkcja co kamera) |
| T2 | trzymanie celu przy wyjściu do zbieżności kamery (albo zatrzymania + zapas), potem puszczenie 0,6 s; cięcie od razu |
| K1 | kadr przylotu: podłoga zoomu 0,07 · zoomRef tylko przy `warpArrOn`, bez wysunięcia statku przy wyjściu z celem, trzymanie do końca ślizgu + 1 s, powrót 2 s |
| O1 | ośrodek drobin i soczewka bańki w warpie gracza wyłączone, A/B `?warpOsrodek=1` |
| O2 | co zostaje z obrazu: smugi gwiazd (bez ząbka w klatce kopu), fale, błysk kopu, przylot jako jedno zdarzenie, wstrząsy z gry, żar, obrót kadru, kop kamery, smugi skał pasa |
| O3 | hipercruise bez zmian — odcisk w `tests/hypercruiseLook.test.mjs` |
| W1 | warp gracza w workerze: pełna rampa, ślizg, kurs, cel i start w migawce, wstrząsy z gry, plazma w workerze, test parzystości off ≡ worker |
| W2 | księżyce deterministyczne, w węzłach gry (bez `Math.random` w module renderu) |
| E1–E4 | reszta świata (etap 3A): rejestr kotwic soczewki, floty i wraki jako kropki, warstwy (nic z soczewki na statku), HUD gaszony z β |
| S1 | sprzątanie „jeden warp” (= krok C1). Uwaga: S1–S6 w symulatorze to SCENARIUSZE (§ „Symulator i weryfikacja”) |
| C1, C2 (sprzątanie) | projekt D § 6: C1 — bez zmiany WGSL materiałów gry (zrobione, § „Jeden warp”); C2 — hak rulonu i reszta, zmienia WGSL każdego materiału (osobna decyzja, § „Otwarte sprawy”) |
| C1–C6 (kryteria) | INNE znaczenie: kryteria oceny z briefu panelu — C1 widać świat, C2 dynamika wielkości (Mars w trawersie ≥ 250 px przy 1080p, dalekie ≤ ~20 px), C3 ruch bez parkowania, C4 tarcza nie zachodzi na kadłub, C5 ciągłość przejść, C6 rozszerzalność; w symulatorze wiersze `C1-…`–`C5-…`, a `C6-stożek` to kontrola M4 |
| projekt A–D | projekty panelu: A — kamera podniesiona z rybim okiem (nie wybrany), B — „kropla 2.0” (przejścia i cel: § 4.3, § 4.4), C — „perspektywa drogi” (mapa), D — oś faz, worker i sprzątanie (§ 2 oś czasu, § 4 worker, § 5 interfejs mapy, § 6 sprzątanie) |

## Historia (skrót)

- 2025-12 – 2026-01: stara soczewka WebGL (`warpBlackHole.js`); zasada „nigdy nie próbkować gotowej klatki z maską
  wokół statku” (jajko wokół kadłuba).
- 2026-09-25/26: „kropla” (świat ściśnięty wokół statku, wielkość ~1/d) — wtedy user: Ziemia za rufą „stoi w miejscu”,
  Jowisz i Mars „widoczne od razu”; wersja w prawdziwych odległościach — „podoba mi się”; siatka wyrzucona.
- 2026-09-27 – 10-03: warp „Nurt” (ośrodek drobin, kop, wyjście jak Star Wars, przyloty NPC tunelem), rulon (zwinięcie
  świata w walec, hak w każdym materiale) — `docs/webgpu/DEMO-WARP.md`.
- 2026-10-07 – 10-19: soczewka świata jednej skali S z nominalnej prędkości, cel przy krawędzi kadru, przelot z daleka
  z punktem zbiegu przed dziobem, bramka ringu, cel bez obrotu przelotu; 10-19 user: „przekombinowałem z zawijanym
  efektem warp” — demo „Pęd” i style skoku (`docs/webgpu/DEMO-WARP-PED.md`).
- 2026-10-23: „Pęd” w grze (styl domyślny, wyjście z pędem i ślizgiem, kamera skoku z obrotem kadru).
- 2026-10-25/26: „podniesiony świat” — mapa C, oś β z zegara gry, worker, K1, ośrodek wyłączony, jeden warp
  (ten dokument). Projekty panelu A–D, sędziowie i DECYZJE zostały poza repo (notatki sesji orkiestratora) — kody
  w § „Słowniczek kodów decyzji”.
