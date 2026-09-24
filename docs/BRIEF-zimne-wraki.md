# BRIEF: Zimne wraki i pole wraków (warstwa „tło” + jawne wybudzanie)

> Prompt dla agenta wykonawczego. Jest samodzielny: nie zakłada znajomości wcześniejszych rozmów.
> Numery linii są orientacyjne (index.html jest edytowany równolegle przez inne sesje) — zawsze
> szukaj po nazwie funkcji, nie po numerze.

## 0. Zasady pracy

1. Najpierw przeczytaj `AGENTS.md` (zasady repo: brak nowych rendererów WebGL poza `Core3D`, brak
   alokacji per klatka/krok tam, gdzie są bufory, gameplay liczony w 2D, stałe „na krok” tylko przez
   `stepDecay120`/`ticksAt120` z `src/game/stepDecay.js`, UTF-8, TODO z prefiksem `AGENT:`).
2. Nie uruchamiaj podglądu gry ani serwera dev — użytkownik testuje gameplay sam. Twoja weryfikacja
   to `npm test` (przed i po) oraz `npm run build`. `node --check` nie łapie błędów ESM.
3. Zmiany małe i izolowane. Przed dużą edycją `index.html` sprawdź `git status`/`git diff`, bo plik
   bywa edytowany przez drugą sesję w tym samym drzewie. Nie cofaj cudzych zmian.
4. Zanim zaczniesz kodować, wypisz plan w punktach z listą plików i funkcji, które ruszysz. Na końcu
   raport: co zrobione, co zweryfikowane testem, co pominięte i dlaczego.
5. Nie zmieniaj reguł gameplayu wraków (złom, odzysk broni, holowanie, cięcie) — zmieniasz tylko to,
   KIEDY wrak ma pełną fizykę.

## 1. Cel

Po bitwie 174 okrętów zostaje ~426 wraków. Każdy z nich, nawet uśpiony i rysowany jako jedna smuga
w jednym draw callu, jest co krok fizyki lub co klatkę odwiedzany przez sześć systemów: pętlę wraków
w `physicsStep`, siatkę pocisków, pętlę budzenia w przygotowaniu list destruktora, listę encji 3D
w `updateHexShips3D`, budżet areny heksów i graf sceny three.js (ukryte meshe). Efekt: po walce
klatka ma 8,9 ms (112 fps) przy GPU 1,15 ms i 61 draw callach, a fizyka 3,5 ms przy zerze pocisków.

Wraki są elementem gry (źródło złomu, odzysk broni i kadłubów, holowanie), więc muszą zostać.
Ale nie mogą mieć pełnej fizyki jak żywy okręt. Wprowadzamy trzeci stan: **zimny** („tło”).
Zimny wrak nie jest w ŻADNEJ z powyższych list. Koszt po bitwie ma skalować się z liczbą wraków,
na których ktoś aktualnie pracuje, a nie z liczbą wszystkich.

Docelowo (etap 2) pole zimnych wraków to obiekt świata w stylu pola szczątków ze Starsectora,
tyle że gracz nie zbiera itemów, lecz podlatuje, wybiera wrak i holownikiem „wyciąga” go z powrotem
do pełnej fizyki.

## 2. Model trzech stanów

| Stan | Gdzie jest | Fizyka | Rysowanie |
|---|---|---|---|
| gorący | `wrecks`, `_activeWrecksBuffer`, destruktor, siatka pocisków, `renderEntities` | pełna | hex mesh / płyta pancerza / smuga wg LOD |
| śpiący (istnieje dziś: `_wreckSleeping`) | `wrecks`, `_sleepingWrecksBuffer`, siatka pocisków, pętla budzenia, `renderEntities` | zamrożony ruch, budzony kontaktem i pociskiem | jak wyżej |
| **zimny (nowy)** | **tylko `coldWrecks`** | brak: duch dla okrętów i pocisków | smuga z batcha impostorów, lekko przyciemniona |

Zimny wrak:
- **nie ma `hexGrid`** — heksy wracają do areny (`releaseHexGridArena` z `src/game/hexArenaBridge.js`,
  `disposeHexBody` z `src/game/destructor.js`), a stan siatki żyje w zwartym zrzucie (p. 3);
- **nie ma meshy w scenie** — przy zamrożeniu `invalidateHexShipEntity3D(entity)` (`src/3d/hexShips3D.js`,
  już importowane w `index.html`, używane w `releaseNpcHexBody`);
- **nie jest w `wrecks`** — osobna tablica `coldWrecks` (i `window.coldWrecks` dla modułów). To nie
  może być flaga na obiekcie w `wrecks`, bo pętla wraków usuwa wszystko, co nie ma heksów
  (`hasHexesLeft`), a wiele ścieżek zakłada obecność `hexGrid`;
- **jest tym samym obiektem JS** co przed zamrożeniem (zachowuje `_cargoManifest`, manifest złomu
  z `src/game/salvage.js`, `_wreckAge`, sprawcę, historię). Wymieniamy tylko `hexGrid` i listy;
- **stoi w miejscu**: przy zamrożeniu `vx = vy = angVel = 0`. Żadnego dryfu per wrak (pole rozjechałoby
  się o dziesiątki kilometrów na godzinę sesji). Ewentualny wspólny, wolny dryf klastra to etap 2.

## 3. Rekord zimnego wraku (zrzut)

Zrzut powstaje **przed** zwolnieniem areny. Uwaga: przy `DESTRUCTOR_CONFIG.packedHexArena = 1` część
pól shardów może być widokami do SharedArrayBuffer areny (sprawdź `src/game/hexArenaBridge.js`,
które pola są w SAB) — po `releaseHexGridArena` ta pamięć jest ponownie przydzielana, więc kopiuj,
nie referencuj.

Minimalny zrzut (`wreck._coldSnapshot`):
- klucz szablonu: obraz źródłowy (`grid.visualImage` / `grid.armorImage`), `srcWidth`, `srcHeight`,
  `gridDivisions`, próg alfa — dokładnie to, co `getHexBodyTemplate` w `destructor.js` używa jako klucz;
- `cols`, `rows`, `pivot`, `isFragment`, `disableSolidArmorLod`, skala (`visual.spriteScale*`), `angle`, `x`, `y`,
  `radius`, `rawRadius`, `baseStructuralCount`, `activeStructuralCount`, `_maxHexDrift`;
- maska żywych komórek po indeksie komórki szablonu (`Uint8Array` po `cells` szablonu albo po
  `c + ro * cols`), dla żywych: `hp` (Float32 lub kwantyzacja do Uint8 z `maxHp`), `_bakedOffX/Y`
  (Float32; plastyczne przesunięcie kształtu) — `deformation`/`targetDeformation` można pominąć
  (sprężystość po zamrożeniu i tak wygasa);
- dane do rysowania smugi: kolor (`computeAverageBodyColor` z `src/3d/hexBodyImpostorBatch.js`) oraz
  ekstent aktywnych heksów (`halfW`, `halfH`, `cx`, `cy` — dziś liczy je prywatna `getGridActiveExtent`
  w `hexShips3D.js`; wyeksportuj ją albo policz to samo przy zamrażaniu);
- streszczenie dla UI (etap 2, ale policz od razu, bo jest tanie przy zamrażaniu): klasa kadłuba,
  procent żywych heksów, liczba ocalałych hardpointów, czy jest ładunek/złom.

Zrzut ma być serializowalny do JSON (typed arrays → zwykłe tablice lub base64 w przyszłości):
zapis świata jeszcze nie istnieje („Wczytaj grę” = „Wkrótce dostępne”), więc tylko zostaw
`// AGENT: zrzut zimnego wraku do zapisu świata` w miejscu, gdzie zapis powstanie.

Odzysk broni: `src/game/weaponInventory.js` pamięta broń „po komórce kadłuba”. Sprawdź, czy trzyma
referencję do obiektu sharda, czy indeks komórki. Jeśli referencję — przy zamrażaniu zamień na
indeks komórki i przy odmrażaniu podepnij nowe shardy. Test musi to pokrywać.

## 4. Przejścia

### 4.1 Zamrażanie (freeze) — automatyczne, konserwatywne

Kandydatem jest wrak, który spełnia WSZYSTKIE warunki:
1. `_wreckSleeping` nieprzerwanie od `COLD_AFTER_SEC` (start: 20 s; liczone w sekundach, nie tickach);
2. nie jest `salvageState.towed` ani `salvageState.cutting` (`salvageState` w `index.html`, funkcje
   `startWreckTow`, `startFieldSalvage`, `stopFieldSalvage`, `releaseWreckTow`), nie ma aktywnych
   zaczepów w `TowSystem` (`src/game/towSystem.js`; dodaj tani `isAttached(body)` jeśli nie ma),
   nie jest `lockedTarget`/`lockedTarget2`, celem rozkazu RTS, wrakiem w locie transferu ładunku
   (`parentEntity._cargoWreck`) ani celem najechanym kursorem;
3. w promieniu `COLD_CLEAR_RADIUS` (start: 2 500 j.) nie ma żadnego obudzonego ciała (żywe okręty,
   gorące wraki, gracz) — sprawdzaj z listy `dynamicDestructibles`, która i tak jest budowana raz na
   klatkę, i tylko dla kandydatów, nie dla wszystkich wraków co krok;
4. od ostatniego trafienia/kontaktu minęło ≥ `COLD_AFTER_SEC` (dopisz `_lastImpactMs` w `applyImpact`
   i w `collideEntities` dla wraków; nie polegaj na globalnym „są pociski”);
5. wrak jest poza kadrem albo już na poziomie smugi (promień na ekranie < `HEX_LOD_IMPOSTOR_PX`
   z `hexShips3D.js`) — żeby nie było przeskoku obrazu z heksów na smugę;
6. może mieć ładunek i złom — zimny to nie recykling; `recycleWreck` (destruktor) odmawia przy ładunku
   i tak ma zostać.

Skan kandydatów nie częściej niż co 0,5 s (jak `enforceWreckHexBudget`), z budżetem
`COLD_FREEZE_PER_FRAME` (start: 4), żeby zamrażanie setek wraków po bitwie rozłożyło się na klatki.

Sekwencja zamrożenia: zrzut → `TowSystem.detachBody(w, 'wreck-cold')` (asekuracyjnie) →
`invalidateHexShipEntity3D(w)` → `disposeHexBody(w)`/`releaseHexGridArena(w)` → `w.hexGrid = null`,
`w.isCollidable = false`, `w.isCold = true`, prędkości na zero → usunięcie z `wrecks` (swap-pop albo
splice w pętli malejącej) → `coldWrecks.push(w)`.

### 4.2 Wybudzanie (thaw) — WYŁĄCZNIE jawne

Nowe API w `index.html` (i `window.thawWreck` dla modułów): `thawWreck(w, reason)`:
odtworzenie `hexGrid` z szablonu i zrzutu → `wrecks.push(w)` → usunięcie z `coldWrecks` →
`isCollidable = true`, `isCold = false`, `DestructorSystem.wakeWreck(w)`, `wakeHexEntity` →
meshe powstają leniwie w `updateHexShips3D` (`createEntityMesh`).

Odtworzenie siatki: dodaj w `destructor.js` wariant `initHexBodyFromSnapshot(entity, image, snapshot)`
obok `initHexBody` (ten sam `getHexBodyTemplate`, te same `HexShard`, ten sam sposób wpięcia w arenę),
z nałożeniem maski żywych, `hp`, `_bakedOffX/Y` (a więc i `gridX/gridY = template + baked`),
`activeStructuralCount`, `baseStructuralCount`, `_maxHexDrift`, `pivot`, `isFragment`. Sąsiedzi
(`neighbors`) tak jak w `initHexBody`. Fragmenty dziedziczą `srcWidth/srcHeight` rodzica, bo
próbkują jego teksturę — zrzut musi to zachować.

Kto woła `thawWreck`: `startWreckTow`, `startFieldSalvage`, rozkaz RTS na wrak
(`pickWreckTargetAtWorld` + ścieżka wykonania rozkazu), transfer ładunku do wraku, konsola dev.
**Żadnego automatycznego budzenia na zbliżenie** — to odtworzyłoby dzisiejszą pętlę budzenia.
Budżet: maksymalnie 1 odmrożenie na klatkę (pancernik to kilka ms `initHexBody`); kolejkuj resztę.

### 4.3 Usuwanie zimnych

`enforceWreckHexBudget` liczy odtąd tylko gorące/śpiące (zimne nie mają heksów). Dodaj osobny limit
`MAX_COLD_WRECKS` (start: 1 500) z wyrzucaniem najdalszego od gracza; nigdy wraka z ładunkiem
(jak dziś w budżecie). Usunięcie zimnego = `DestructorSystem.recycleWreck(w)` (sprawdź, że
`releaseHexGridArena` toleruje `hexGrid = null`) i zdjęcie z `coldWrecks`. Reguła „50 km od gracza”
z pętli wraków dla zimnych NIE obowiązuje — pole ma przetrwać odlot gracza.

## 5. Rysowanie zimnych

Osobny, tani przebieg w `updateHexShips3D` (albo tuż przed nim w `render()` w `index.html`):
dla zimnych wraków w pudle kamery `HexBodyImpostorBatch.push(...)` z zapisanych ekstentów i koloru,
z `opacity` ~0,7 (sygnał „tło”). Bez alokacji per wrak per klatkę: dziś `push(p)` bierze obiekt —
użyj jednego obiektu-scratch albo dodaj `pushRaw(x, y, rot, halfW, halfH, r, g, b, opacity)`.
Sprawdź pojemność batcha (`MAX_IMPOSTORS` w `hexBodyImpostorBatch.js`) względem liczby zimnych
w kadrze; przy przekroczeniu cull po odległości, nie wyjątek.

Zimne wraki NIE są: okluderami cieni (`HullShadowSdf`), źródłami ani odbiorcami świateł
(`buildRoadLightWorldEmitters`, `buildPositionLightWorldSprites`), rekordami `Turret2D.sync`,
celami wiązek w `fireWeaponCore` (skan `window.wrecks`), kandydatami siatki pocisków.

Szybkie pudło kadru dla zimnych: cull po `x/y` i `radius` na `_hexCullInfo` (to samo, co robi
`isEntityInCull`), pętla po `coldWrecks` jest O(zimne), ale każda iteracja to kilka porównań.

## 6. Lista miejsc, które dziś dotykają wraków — i co z nimi zrobić

Szukaj po nazwie funkcji; numery linii są tylko wskazówką.

| Miejsce | Dziś | Zmiana |
|---|---|---|
| `physicsStep` → pętla wraków (`_activeWrecksBuffer`/`_sleepingWrecksBuffer`, ~20819) | integracja, sen, despawn 0 heksów / 50 km | zimne nie są w `wrecks`, więc nic; tu (co 0,5 s) skan kandydatów do zamrożenia |
| `enforceWreckHexBudget` (~19971) | budżet heksów 80% areny | licz tylko `wrecks`; osobny `MAX_COLD_WRECKS` |
| budowa `SpatialGrid` pocisków w `bulletsAndCollisionsStep` (~18665) | wstawia wszystkie `wrecks` | bez zmian (zimne poza listą) |
| przygotowanie list destruktora w `physicsStep` (`buildDynamicDestructibles`, pętla budzenia) | O(śpiące × aktywne) | bez zmian w tym briefie (zimne poza listą); pętla budzenia zostaje dla śpiących |
| `renderEntities` w `render()` (~22281: `for (const w of wrecks)`) | pcha wraki do 3D | zimne pomijane; osobny przebieg smug (p. 5) |
| `createWreckage`/`spawnWreckEntity` (push do `window.wrecks`, ~7905) | nowy wrak gorący | bez zmian |
| ścieżka usuwania wraku (`wreck.dead = true` + splice z `window.wrecks`, ~12328) | | obsłuż też `coldWrecks` |
| `pickWreckTargetAtWorld` (~14998) i pętla hover po `window.wrecks` (~20234) | cele rozkazów/kursora | uwzględnij `coldWrecks` z oznaczeniem „zimny”, tak żeby rozkaz/holowanie mogły wywołać `thawWreck` |
| `fireWeaponCore`, gałąź beam (`wreckList = window.wrecks`) | cele wiązek | bez zmian (zimne = duch) |
| `setPerfHudWorldSource` (~1306) + `src/ui/perfHud.js` (`npcCount` i sąsiedzi) | liczniki | dodaj wiersz „Wraki gorące / zimne” |
| `DestructorSystem.collideEntities` (`wakeWreck(A)`, `wakeWreck(B)` na starcie) | każdy kontakt budzi wrak | budź tylko przy prędkości względnej ≥ `WRECK_WAKE_REL_SPEED` albo gdy kontakt faktycznie przesunął ciało; inaczej wrak pod zaparkowanym okrętem nigdy nie zaśnie i nigdy nie zmarznie |
| `npcStep`: martwy NPC z `mission = true` (`applyCallInIdentity`) | `if (npc.dead) continue` na zawsze | po utworzeniu wraku usuń martwy okręt z `npcs` (sprawdź `SupportWing.units`, `SQUADS`, listy floty) — osobny, mały commit |

## 7. Pułapki (każda ma być jawnie obsłużona albo opisana w raporcie)

1. **`hasHexesLeft` w pętli wraków** kasuje wrak bez `hexGrid` — dlatego zimne są poza `wrecks`.
2. **Referencje**: holowanie, cięcie, lock gracza, hover, rozkazy RTS, `_cargoWreck`, `TowSystem`
   (`collisionExclusions`, rekordy zaczepów), `DestructorSystem._hullContactPairs` (WeakMap, OK),
   `state.entityMeshes` w hexShips3D (musi zostać wyczyszczone przez `invalidateHexShipEntity3D`),
   `HullShadowSdf`/lakier (sprawdź `disposeMeshData`, że zwalnia referencje do siatki).
3. **SAB areny**: kopiuj pola shardów przed `releaseHexGridArena`.
4. **Pula wraków** (`_wreckPool`, `_inPool`): zimny wrak nie jest w puli i nie może być z niej wydany.
5. **Fragmenty**: `srcWidth/srcHeight` rodzica, `isFragment`, `disableSolidArmorLod`.
6. **Przeskok obrazu**: zamrażać tylko poza kadrem lub na poziomie smugi; odmrożenie tworzy mesh
   w następnej klatce, to akceptowalne.
7. **Skoki klatki**: budżety zamrażania (4/klatkę) i odmrażania (1/klatkę).
8. **Stałe czasowe** w sekundach z `dt`, nie w tickach (działa przy `?physHz=60`).
9. **Zero alokacji** w przebiegu rysowania zimnych i w skanie kandydatów (bufory/scratch).
10. **Ładunek i złom** zostają na obiekcie; `clearSalvage` wołać tylko przy recyklingu, nigdy przy
    zamrażaniu.
11. **Kontakt spoczynkowy** (p. 6, `collideEntities`) — bez tej poprawki wraki pod stojącą flotą nigdy
    nie zasną, więc nigdy nie zmarzną; zmierz to w teście: dwa ciała w spoczynku stykające się
    nie mogą podbijać `_wreckSleepTimer` z powrotem do zera.
12. **Dwie sesje w jednym drzewie**: edytuj `index.html` punktowo, po nazwach funkcji.

## 8. Etap 2 (tylko jeśli etap 1 jest zielony i zmieści się w zakresie)

- Rekordy pól: klastrowanie zimnych wraków przy zamrażaniu (promień 3 000 j., union-find), rekord
  `{ id, x, y, radius, count, summary }` odświeżany przy zmianach.
- Marker pola na mapie sektora i w CIC (`src/ui/cicDisplay.js`, `src/ui/contactMarkers.js`) ze
  streszczeniem ze zrzutów; lista wraków w polu po zbliżeniu (skaner).
- Komenda „wyciągnij” = istniejący rozkaz RTS na wrak + `thawWreck` + `startWreckTow`.
- Szabrownicy NPC i wspólny dryf klastra — poza zakresem tego briefu.

## 9. Kryteria akceptacji i testy

Nowy test `tests/coldWrecks.test.mjs` (wzoruj się na istniejących testach destruktora, które budują
ciała heksowe w node, np. `tests/destructorCollisionRefine*.mjs`):
1. zrzut → odtworzenie: maska żywych, `hp`, `_bakedOffX/Y`, `gridX/gridY`, `activeStructuralCount`,
   `pivot`, `isFragment`, pozycja, kąt, `_cargoManifest`, manifest złomu, powiązania broni z komórkami
   — identyczne przed i po;
2. warunki zamrożenia: wrak holowany/cięty/namierzony/najechany, wrak z obudzonym ciałem w promieniu,
   wrak trafiony niedawno — NIGDY nie marznie; wrak spełniający warunki — marznie w budżecie na klatkę;
3. po zamrożeniu: nie ma go w `wrecks`, `hexGrid === null`, `isCollidable === false`, brak wpisu
   w `state.entityMeshes` (przez `invalidateHexShipEntity3D`), arena zwolniona (`getHexArenaStats`);
4. `thawWreck`: wraca do `wrecks`, `hexGrid` odtworzony, `isCollidable === true`, obudzony;
5. limit `MAX_COLD_WRECKS`: wyrzuca najdalszego, nigdy z ładunkiem;
6. kontakt spoczynkowy nie zeruje timera snu wraku (p. 7.11).

`npm test` zielony (pre-existing failures: `tests/solarSystem.test.mjs`, `tests/shadowShaftsQuality.test.mjs`
— nie Twoje, nie naprawiaj), `npm run build` przechodzi.

Kryterium dla użytkownika (on to sprawdzi sam w grze): po bitwie z kilkuset wrakami PerfHUD
pokazuje „Wraki zimne N”, `Fizyka` ≤ ~1,5 ms i `Rysowanie` ≤ ~1,5 ms przy 49 żywych okrętach;
holowanie zimnego wraku odmraża go; żaden wrak nie znika inaczej niż przez dotychczasowe reguły.

## 10. Raport końcowy

Wypisz: (a) pliki i funkcje zmienione, (b) które pułapki z p. 7 są obsłużone kodem, które testem,
a które tylko opisane, (c) co zostało poza zakresem, (d) jak użytkownik ma to sprawdzić w grze
(kroki, co obserwować w PerfHUD), (e) dopisz sekcję „Zimne wraki” w
`docs/AUDYT-wydajnosc-bitwa-2026-09-24.md` (2–5 zdań, stan wdrożenia).
