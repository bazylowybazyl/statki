# BRIEF: mostek dla nowego kadłuba

> Dla agenta, który wprowadza do gry nowy statek (nowy sprite kadłuba) albo
> podmienia sprite istniejącego. **Każdy okręt bojowy dostaje mostek**: strefę
> heksów (zniszczenie = utrata dowodzenia → hulk → wrak) i model 3D nadbudówki
> stojący dokładnie na tej strefie. Mechanika: `docs/PORT-mostki.md` §0–§4,
> model: §8, lista gotowych kadłubów: §8.2. Czas pracy: ~1–2 h na kadłub.

## 0. Kiedy

- Nowy kadłub = rejestracja sprite'a (3 miejsca: `HULL_RENDER_PROFILES`
  w `src/data/ships.js`, `HULL_SPRITE_PATHS_BY_ID` i
  `getNpcHullRenderProfileId` w `index.html`) → od razu mostek wg tego briefu.
- Podmiana sprite'a (inny rozmiar PNG) wywala test
  `every hull with bridge zones has a known sprite of the recorded size`
  w `tests/shipBridge.test.mjs` — przesuń strefę, sprawdź model i paletę.
- Mostki mają dziś (2026-09-25): Atlas (rufowy + zapasowy), Terra Nova
  (Custos, Hasta, Bellator, Citadella, Colossus), piraci (fregata, niszczyciel,
  Iron Skull), lokomotywa megafrachtowca. **Bez mostków**: frachtowce cywilne,
  wagony i moduł ogonowy megafrachtowca, myśliwce — nie było zlecenia; zanim
  dodasz, zapytaj usera.

## 1. Klucz kadłuba

Klucz mostka = **klucz edytora hardpointów** (`SHIP_DEFS` w
`src/ui/hardpointEditor.js`, `SHIP_EDITOR_DEFAULTS.ships`) — ten sam sprite,
te same współrzędne PNG. Gra dochodzi do niego tak:

- NPC: `resolveBridgeHullKey` (`src/game/shipBridgeRuntime.js`) — lustro
  `getEditorShipIdForNpc` w `npcHardpointRuntime.js`. Nowy typ NPC → dopisz
  w obu miejscach.
- Gracz: `attachEntityBridges(ship, { key: activeHullId })` →
  `normalizeBridgeHullKey`. Id kadłuba gracza inne niż klucz edytora
  (`carrier` → `terran_carrier`, `corvus` na sprite'cie Custosa) → wpis
  w `BRIDGE_HULL_ALIASES`.
- Kadłub z kilku encji (skład megafrachtowca): mostek ma tylko moduł
  dowodzący — pozostałe moduły zwracają `null`.

Test `bridge hull keys: …` w `tests/shipBridge.test.mjs` — dopisz przypadki.

## 2. Strefa (`BRIDGE_LAYOUT_PROPOSALS`, `src/game/shipBridge.js`)

Przestrzeń PNG: środek obrazka = (0, 0), +X = dziób, +Y = w dół obrazka.

1. **Na namalowanej nadbudówce** — model ją zastępuje (inaczej obok modelu
   zostaje namalowana wieża). Szukaj bloku dowodzenia: wieża, kopuła, właz
   z oknem; u Terran zwykle rufowa połowa, u piratów najeżona kopuła albo
   bunkier z czaszką, u cywilnych sterówka za dziobem.
2. **Zapas od hardpointów, silników i rdzeni**: `bridgeZoneMargin(render/PNG,
   klasa)` — korpus wieżyczki 2D rysowanej nad modelem (S 6, M 10, L/Capital
   14 px renderu; klasa z `WEAPON_TIER_BY_HULL`). Pilnuje tego test
   `proposed zones clear every hardpoint…`.
3. Jak mierzyć: sprite z nałożonymi hardpointami, silnikami, kołami zapasu
   i siatką co 10 px PNG (kilka linijek PIL albo kanwy; opis metody
   i pułapek w `docs/PORT-mostki.md` §8.13 — zgrubna siatka myli o 20–50 px)
   albo edytor stref w demie (`/dema/mostki-demo.html`, klawisz `E`,
   „Eksport JSON” daje gotowy wpis).
4. Jedna strefa na okręt (`role: 'primary'`); mostek zapasowy tylko przy
   wielkich okrętach (Atlas) i drugiej, rozłącznej nadbudówce.
5. `windowColor`: Terra `#e4f3ff`, piraci `#ff9a4a`, Atlas `#d6ecff`,
   cywilni `#ffe0b0`.
6. Test: sprite do `BRIDGE_HULL_SPRITES` w `tests/shipBridge.test.mjs`
   (ścieżka, rozmiar PNG, profil renderu).

Liczba heksów: promień heksa to zawsze 5 px renderu. Mała fregata (192 px)
ma w strefie ~10 heksów — OK; mniej niż ~6 to już jeden strzał.

## 3. Model 3D (`src/3d/bridge3DShapes.js`)

1. Wpis w `KIND_DEFS`:
   `['nazwa', { label, hull: '<klucz>', zone: 'mostek', png: [W, H], profile: '<profil renderu>', capacity }]`.
   Rozmiar projektowy liczy się sam: strefa × skala render/PNG.
2. Builder `function buildNazwa(B, W, H, P)` + wpis w `BUILDERS`.
   `P.x(px)`, `P.y(py)`, `P.len(d)` — położenia cech czytane **wprost ze
   sprite'a w px PNG** (P przelicza je na przestrzeń modelu: środek strefy,
   +Y w górę sceny, jednostki = px renderu).
3. Klocki: `block` (korpus o pochyłych ścianach `slope` + faza `chamfer` +
   dach), `octPoly`, `rectPoly`, `boxRot`, `dome` (`ry` — elipsa),
   `cylinder`, `tube` (rura, stożek, kolec), `windowRow`, `beacon`, `strip`.
   Gotowe zestawy: `buildTerranCommand` (wieża z koroną okien + hala + kopuła
   + maszt — Custos, Hasta), piraci: `spikedDome`, `grille`, `crookedMast`.
4. Zasady (pilnują testy w `tests/bridge3D.test.mjs`):
   - kamera patrzy z góry, a słońce pada prawie poziomo — wysokość czyta się
     przez światło i cień, więc bryły mają skosy, a **okna stoją na fazach**
     (normalna n.z > 0,5 → odsunięcie fazy ≥ 0,58 × jej wysokości; na
     stromych ścianach z góry są niewidoczne);
   - model mieści się w strefie (kolce piratów mogą wystawać — `SPIKE_SLACK`);
   - wysokość 0,15–1× krótszego boku strefy; ≥ 12 okien, ≥ 1 lampa;
     < 3200 trójkątów; 4–48 modułów (`B.begin` / `B.end` — pod przyszły
     silnik destrukcji 3D);
   - **bez przenoszenia rysunku sprite'a na dachy** (prześwituje jak „duch”)
     — tylko proceduralne panele, brud, nity;
   - świecą tylko emitery (okna, lampy, listwy); powierzchnię shader miękko
     ścina poniżej progu bloomu.
5. `resolveBridgeModelKind` znajduje rodzaj po kluczu kadłuba sam; kilka
   rodzajów na kadłub — po id strefy, roli (`backup`) i proporcjach.
6. Bardzo duży mostek: tekstura obrażeń mieści 4 wiersze po 768 komórek
   (`BRIDGE3D_DAMAGE_LIMITS`); lokomotywa ma ~2300 — więcej = podnieś
   `DAMAGE_MAX_ROWS` w `bridge3D.js`.

## 4. Paleta (`BRIDGE3D_KIND_STYLE`, `src/3d/bridge3D.js`)

8 barw (kolejność `BRIDGE3D_MAT`: farba, panel, ciemny metal, akcent, szyba,
rama okien, jasny detal, brud) z **próbki strefy na sprite'cie**: percentyle
jasności pikseli strefy — farba ≈ p75–p92, panel ≈ p50, ciemny ≈ p5–p25,
jasny detal powyżej p92, akcent = najbardziej nasycone (rdza, pomarańcz),
brud ciemniejszy i cieplejszy od panelu. Parametry stylu jak u frakcji:
Terra (`bellator`, `custos`…), piraci (`rivets 1`, `rust 0,4` — wyżej modele
robią się rude), cywilni (`megafreighter`). Nowa lampa → kolor w `EMIT_COLOR_HEX`.

## 5. Demo i sprawdzenie (sam, bez proszenia usera)

1. `dema/mostki-hulls.js` — wpis w `HULLS` + `HULL_ORDER` (PNG, rozmiar,
   profil, typ NPC); `dema/mostki-sim.js` — `HULL_POOLS`; przycisk
   w `dema/mostki-demo.html`.
2. `dema/mostki3d-shots.js` — wpis w `HULLS` (zoom zbliżenia i całego
   kadłuba; `killDirect` dla wielkich stref).
3. Uruchom:
   ```
   node --test tests/bridge3D.test.mjs tests/shipBridge.test.mjs
   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-shots.js --only <id>,free3d --out .tmp/mostki3d/<id>
   ```
   Obejrzyj: zbliżenie (czy model przykrywa namalowaną nadbudówkę i czyta się
   jak ta sama bryła), cały kadłub (skala, cień), uszkodzony (wyrwy po
   heksach), hulk i wrak (okna gasną falą, model zostaje zgaszony na wraku),
   wolną kamerę (wysokość). Pasma HDR okien: wiersz `OKNA` w logu.
4. `npm test` i build Vite. Opcjonalnie drżenie przy współrzędnych gry:
   `dema/mostki3d-drzenie.js`.

## 6. Gra

Nic więcej: `attachEntityBridges` biegnie dla każdego NPC po `initHexBody`
(`drawNPCPretty`) i dla gracza przy zmianie kadłuba, `Bridge3D.update`
podpina model sam (≤ 24 rekordy na klatkę). Sprawdzenie w samej grze:
`dema/mostki3d-gra.js` (headless Chrome).

## 7. Pułapki

- Sprite powiększany ×1,65 (lokomotywa) albo zmniejszany ×0,08 (Custos) —
  zawsze licz przez skalę render/PNG (`getHullRenderSize`), nigdy „na oko”.
- Id kadłuba gracza ≠ klucz edytora (`carrier`, `supercapital`, `corvus`).
- `type.includes('frigate')` nie łapie `freighter`.
- Model w świecie przy 5–10 mln j.: żadnych bezwzględnych pozycji
  w danych instancji (`docs/PORT-mostki.md` §8.12).
- Pliki gry (`index.html`, `destructor.js`) zmieniaj minimalnie — mostek
  nowego kadłuba zwykle ich w ogóle nie wymaga.
