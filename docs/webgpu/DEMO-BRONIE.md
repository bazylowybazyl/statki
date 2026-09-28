# Demo WebGPU: działa, obrona punktowa i lasery

`dema/bronie-webgpu.html` (+ `dema/bronie-webgpu.js`, moduły w `dema/bronie-webgpu/`). Atlas strzela
do pirackiego okrętu (przy broniach obrony punktowej — do dronów-celów). Wszystko na `WebGPURenderer` + TSL;
gra i `Core3D` bez zmian. Start: `npm run dev` → `http://localhost:5173/dema/bronie-webgpu.html`.

Zakres (decyzja użytkownika 2026-09-27): działa Capital / L / M / S, obrona punktowa i lasery — **27 broni**
z `MASTER_WEAPONS`. Rakiety, torpedy i rakieta specjalna — osobne zadanie.

| grupa | bronie |
|---|---|
| Capital / specjalne | Yamato, Hexlance, Mjolnir (`siege_railgun`), Valkyrie, Goliath, Ion Plasma Gatling |
| L | Armata, Tempest L, Helios Lance, Autokanon L |
| M | Tempest Mk I, Tempest Mk II, Helios, Vulcan, Autokanon, wiązka ciągła, wiązka pulsacyjna |
| S | Tempest S, Helios S, Gatling S |
| obrona punktowa | CIWS Mk I / Mk II, Helios PD, Flak S / M / L / „Perun” |

Statystyki strzału (prędkość, kadencja, rozrzut, zasięg, salwy flak, promienie rażenia i zapalniki) są z
`MASTER_WEAPONS`, odrzut i wstrząs z `FX_PROFILE` (`src/vfx/turret2D.js`), gniazda z `ATLAS_EDITOR_DEFAULTS`,
wieżyczki z atlasów gry (`assets/weapons/*-atlas-*.png`), skala wieżyczki = `SCALE_BY_SIZE × CATEGORY_TRIM`.

## Moduły

| Plik | Co robi |
|---|---|
| `gpuFx.js` | silnik cząstek GPU: paczki z CPU rozwijane w kernelu `spawn` (wyszukiwanie binarne paczki po indeksie wątku, losowanie hash PCG), pule-pierścienie, kernele `update` (iskry, dym, odłamki — kolizja z polem odległości kadłubów), `light` (dym i odłamki czytają siatkę świateł), materiały TSL wszystkich pul |
| `recipes.js` | receptury rodzin broni: wylot, pocisk, lot, trafienie, rzaz, wylot przestrzeliny, ładowanie, wiązki, pęknięcie flak, ogień w wyrwie |
| `gunnery.js` | sterowanie ogniem: gniazda (jedno / para / wszystkie), celowanie wieżyczek, wzorce strzału (lufa po lufie, obie lufy, salwa Yamato, ładowanie, wiązka ciągła, impulsy, salwy flak z zapalnikiem), trafienia, przebicia, zegar opóźnionych zdarzeń |
| `projectiles.js` | pociski: symulacja CPU z podkrokami 240 Hz (trafienia w sylwetkę z pola odległości, przebicia z rzazem i wylotem, drony, rykoszety) + render 8 stylów w jednym draw callu |
| `trails.js` | smugi w świecie — port `SlugTrail` (`src/3d/slugTrail3D.js`) z tabelą stylów: wszystkie bronie w jednym draw callu |
| `beams.js` | wiązki: ciągła (płynąca plazma, pakiety energii), puls (front biegnie do celu), laser PD |
| `hull.js` | kadłub ze sprite'a gry oświetlany siatką świateł + mapa uszkodzeń (compute): żar stygnący z bieli w czerwień, osmalenie, przestrzeliny z rozżarzonym brzegiem, poświata jonowa; pole odległości (GPU dla iskier, CPU dla trafień) |
| `turrets.js` | wieżyczki z atlasów gry jako oświetlane kwady; `LitQuadBatch` (też drony) |
| `fxLights.js`, `lightGrid.js` | światła efektów (błyski, trafienia, żar, pociski, wiązki) → siatka świateł; `lightGrid.js` i `surfaceLighting.js` to kopie z dema asteroid (commit 9859d07) — tamto demo jest rozwijane równolegle i jego API się zmienia |
| `drones.js` | cele obrony punktowej (myśliwiec gry, krzywe Lissajous, wyprzedzenie) |
| `arsenal.js`, `noise.js`, `sky.js` | katalog broni, kafelkowa tekstura szumu (dym, ogień, zniekształcenie), tło |

Pule GPU (jeden draw call każda): **ADD** (rdzeń błysku, gwiazda, krzyż anamorficzny, jęzor, kula ognia
z szumu, opar — ruch analityczny, bez kernela aktualizacji), **SPARK** (smugi o stałej szerokości w px,
stygnięcie barwy, odbicie od burt), **SMOKE** (mieszanie premultiplied, turbulencja z pola szumu, światło
per cząstka + żar świeżego dymu), **DEBRIS** (odłamki, łuski, płatki sabotu), **DIST** (drganie powietrza,
fale uderzeniowe), **ARC** (łuki elektryczne). Klatka: ~25 draw calli, 6–10 dispatchy compute.

Post: pass sceny (MSAA 4, HalfFloat) + pass zniekształceń → próbkowanie sceny z przesunięciem i lekką
aberracją → bloom (`bloomConfig.js`) → ACES gry → sRGB.

## Decyzje

- **Paczki zamiast cząstek z CPU.** Receptura z gry (`for … coneDir … spawn`) to jedna paczka z zakresami;
  wystrzał Hexlance'a = ~40 paczek, kilka tysięcy cząstek, zero alokacji po stronie cząstek. Pojemności:
  iskry 2¹⁸, blask 2¹⁷, dym 2¹⁵, odłamki 2¹⁴.
- **Przeniesione 1:1 w liczbach:** armata i Yamato (`fireCannon`, `muzzleFx3D.js`), Hexlance
  (`railgunFx3D.js`: charge / fire / impact / kerf), smuga pocisków (`slugTrail3D.js`), trafienie Yamato
  (`effects3d/yamato.js`, w skali ekranu gry). To, co w grze wycięto dla kosztu draw calli, wraca:
  płatki sabotu Hexlance'a jako bryły, światła błysków (siatka świateł zamiast „rozlania” — kwadu na poszyciu).
- **Tempest Ion od nowa** (w grze: `fireIon`, S = skala wieżyczki 0,76 — mało i płasko): 30 ms sekwencji
  cewek wzdłuż lufy przed strzałem, strumień jonów z diamentami uderzeniowymi, łuki z wylotu i po lufie,
  ogon wyrzutu (gasnący strumień, rozgrzana lufa, dogasające łuki), igła z helisą łuków w locie, ślad
  jonizacji, przy trafieniu łuki EMP po kadłubie (końce na poszyciu) i poświata jonowa na mapie uszkodzeń.
- **Nowe receptury** dla reszty: Vulcan / Gatling (migotliwy błysk, łuski, rykoszety), autokanony i Goliath
  (hamulec wylotowy, łuski, pociski odłamkowe z dymną smugą), Helios (bolt plazmy, rozbryzg stopionego metalu),
  plazmowy gatling (globy z ogonem, łuki po kadłubie), Valkyrie (magenta z danych gry, ładowanie, igła ze
  stożkiem Macha, przebicie), Mjolnir (3 s ładowania, kanał plazmy, przebicie na wylot), wiązki (cięcie burty
  ze stopionym rowem), flak (kula odłamków, czarny kłąb z ognistym jądrem, obrażenia dronów w kuli rażenia).
- **Pasma HDR jak w grze:** ponad progiem bloomu tylko cienkie jądra i krótkie błyski, ciała efektów
  0,3–1,3. Fale uderzeniowe = sama refrakcja (bez świecących okręgów). Brak `pow()` z możliwie ujemną
  podstawą (kwadraty jako `x·x`) — NaN w HalfFloat rozlałby bloom.
- **Własne kopie siatki świateł i modelu oświetlenia** (`lightGrid.js`, `surfaceLighting.js`): demo asteroid
  jest przebudowywane w innych sesjach (cienie reflektorów, profile świateł), a import wprost psułby to demo.
- **Rany na kadłubie** to mapa w uv sprite'a (demo). W grze kadłuby są na silniku belek i mają własny żar
  skóry (`HULL_BODY_CONFIG.heatGlowPeak`) — przy porcie wzorem jest stygnięcie i brzeg rany, nie sama mapa.
- **Kinowy pokaz** (domyślnie przy starcie): 27 broni po kolei, kamera całość → wylot → cel, naprawa celu
  przy zmianie broni (przełącznik).

## Port do gry (zadanie 17 — zrobione; mechanika z dema — zadanie 18)

Efekty wszystkich 27 broni są w grze w `src/3d/weapons/` (fasada `WeaponFx`, opis w `agents.md` § „Efekty broni”).
Z dema weszły: silnik cząstek (`gpuFx.js`), receptury (`recipes.js`), render pocisków (`projectiles.js`), smugi
(`trails.js`) i wiązki (`beams.js`). **Nie weszły:** symulacja pocisków dema (240 Hz, trafienia w pole odległości,
przebicia, rykoszety — lot i trafienia liczy gra), `gunnery.js` (wzorce strzału — strzela gra), `hull.js` (mapa
ran — zadanie 18-C przez haki `ctx.stamp`), `turrets.js` (wieżyczki zostają 2D), `drones.js`, `sky.js`,
kopie `lightGrid.js` / `fxLights.js` / `noise.js` (w grze wspólne z `src/3d/fx/`, zadanie 12).

- **Precyzja:** pule trzymają pozycje względem początku przy kamerze (`FxPoolOrigin`, `src/3d/fx/gpuPoolOrigin.js`)
  z kernelem przesunięcia żywych danych przy odjeździe kamery; czas względem epoki (`timeFx`, `timeSim`,
  `timeRender`). Pociski i wiązki: dane lokalne co klatkę, siatka na początku pul.
- **Nośnik:** paczka niesie nośnik (prędkość w osiach sceny, `t0` względem epoki gry, zegar — `writeCarrierPacket`),
  rysunek dodaje `v · (T − t0)` (`fxCarrierOffset`) — efekt jedzie z kadłubem także w pauzie i przy interpolacji
  gracza. Wylot — kadłub strzelca (rekord `Turret2D`), trafienie — trafiony kadłub, lot i smuga — `ivx/ivy` pocisku.
- **Losowość:** `fxRandom` (mulberry32) zamiast `Math.random` — receptury nie przesuwają sekwencji losowań gry;
  harness sieje oba strumienie (`H.reseed`).
- **Zero obiektów na strzał:** opcje-obiekty dema (`{ cone, v, life, … }`, 0,6–1,5 KB na bogaty wylot) zastąpił
  budowniczy paczki z krótkimi metodami (`E(pool, rodzaj, n, P, D).speed(a, b)…emit()`), zdarzenia opóźnione dema
  (domknięcia) — rodzaj + liczby (`AFTER`, `runAfter`). Zostaje pakowanie liczb double w niewklejonych wywołaniach
  (~0,1–0,3 KB na bogatą serię; strażnik w `tests/weaponRecipes.test.mjs`).
- **Warstwy / Core3D:** pule to siatki passa ortho (warstwa 0), DIST na warstwie zniekształceń 10 (`FX_DISTORT_LAYER`,
  flaga aktywności `Core3D.setDistortLayerActive`), światła błysków do siatki świateł (`Core3D.fx.lights`), kernele
  compute w kroku `Core3D.addFxStep` (spawn / update / warm).
- **Budżety gry** (bitwa ≫ demo): LOD wylotu po rozmiarze wieżyczki na ekranie (tani błysk poniżej 9 px), 48 pełnych
  wylotów i trafień na klatkę, bramki trafień w `index.html` (kadr, rozmiar, cooldown komórki), impulsy w
  pierścieniu (1024), wiązki ciągłe (56). Iskry receptur zastąpiły `SparkSystem3D.burst` przy trafieniu pocisku.
- **Laser PD i flak** przeszły z kanwy 2D do 3D (receptury `laserPD`, `flak`); kanwa nie rysuje już wiązek, błysków
  wylotu ani trafień wiązek. Hexlance (`superweapon.js`) i warsztat rdzeni (`coreFx3D.js`: wybuch wtórny, kula,
  strumień) wołają receptury wprost.
- **Galeria w grze:** `node scripts/webgpu/zrzuty.mjs --backend webgpu --sceny galeria-broni,galeria-armata,…`
  (sesja `galeria`: przegląd 15 rodzin naraz + ujęcie każdej rodziny + Hexlance), obok dema:
  `node scripts/webgpu/bronie-demo.mjs --tryb zrzuty --bronie <te same bronie>`.
- **Czeka na 18:** przebicia (`kerf`, `exit`, `stuck` — Hexlance ma je już z gry), ładowanie Mjolnira i Valkyrie
  (`WeaponFx.charge`, `createChargeState`), rykoszety (`ctx.ricochet` — dziś kosmetyczne, nigdy w `bullets`), mapa
  ran (`ctx.stamp`), wstrząs z danych broni zamiast `FX_PROFILE` (18-D).

## Znalezione przy okazji w grze (nie ruszane)

(Zadanie 17: punkty o starych modułach — czarny tani błysk, brak tekstur trafienia railguna, Valkyrie cyjanem,
zaszyte barwy wiązek, brak efektu 3D trafień wiązek, pomarańczowe iskry przy trafieniu — zniknęły z modułami.)

Z przeglądu kodu przed demem (agenci, niesprawdzone w biegu gry):
- Tani błysk wylotowy (`weapon3DSystem.js`, `spawnMuzzleFlash`) ma `vertexColors: true`, a kwad nie ma
  atrybutu `color` — błysk najpewniej rysuje się na czarno; dostaje go większość broni.
- `railgunExplosion.js` wczytuje `assets/tex/flash01.png` i `smoke04.png`, których nie ma w repo — trafienie
  railguna to w praktyce 2 iskry.
- Valkyrie (`#ff00ff`) rysuje się na cyjan (styl Tempesta); błysk `beam_pulse` jest cyjanowy przy czerwonej
  wiązce; barwy wiązek są zaszyte (vfxColor ignorowany); trafienia wiązek nie mają efektu 3D.
- `chargeTime` i `requiresStationary` Mjolnira oraz `burstCount` Hexlance'a nie są czytane; pola `recoil`,
  `shake`, `impactScale` z `weapons.js` też nie (odrzut idzie z `FX_PROFILE`).
- Wszystkie iskry `SparkSystem3D` są pomarańczowe (jedna globalna barwa).

## three r183 pod WebGPU — ustalenia z dema

- Domyślne 8 buforów storage na etap: stan cząstek puli trzymam w JEDNYM buforze z krokiem (`i · stride + k`),
  paczki w drugim — kernel `spawn` używa 2 buforów, materiał 1.
- `attributeArray` zapisywany z CPU (`value.array` + `addUpdateRange`) jest czytelny w compute tej samej
  klatki; `renderer.compute(node, n)` z dynamicznym `n` = rozmiar dispatchu (licznik paczek w uniformie).
- `texture(...).sample(uv)` na klonie czyta `value` bazy — podmiana `mapNode.value` przełącza atlas wieżyczki
  bez przebudowy materiału.
- `pass().getTextureNode().sample(screenUV - przesunięcie)` wystarcza do zniekształcenia z aberracją;
  `screenSize` daje rozmiar celu w px.
- `YamatoSprite2D` ma getter `ready`, pozostałe moduły sprite'ów `isReady(id)`.
- Ostrzeżenie `WebGPUTimestampQueryPool … Maximum number of queries exceeded` to `warnOnce` przy
  nielimitowanym FPS (headless) — przy odświeżaniu monitora nie występuje.

## Sterowanie

LPM (przytrzymaj) — ogień w punkt kursora; kółko — zoom; PPM/ŚPM + przeciągnięcie — kamera swobodna;
Tab / Shift+Tab — następna / poprzednia broń; G — pokaz; F — ogień auto; T — zwolnienie ×0,2; P / spacja —
pauza; M — gniazda (para / jedno / wszystkie); R — naprawa celu; 1–4 — kamery (całość, wylot, cel, za
pociskiem); Z — całość; B / V / L — bloom / zniekształcenie / światła efektów; H — ukryj panele.
Adres: `?bron=railgun_mk1&kam=muzzle&tempo=0.3&gniazda=one&pokaz=0`.
Konsola: `window.__demo` (`select`, `setCam`, `setTime`, `fire`, `mounts`, `showcase`, `stats`).
