# Dzielnice ringu Ziemi — prototypy (demo, niewpięte w grę)

Port i stocznia (`dema/stocznia-ringu.html`) to pierwszy kompleks na ringu. Reszta ringu dostaje **dzielnice** —
osobne kompleksy o tym samym przekroju: ściana ringu | rząd przy ringu | **droga 2 600 j. nad kratownicą** | rząd
zewnętrzny — plus to, co dzielnica dostawi dalej w przestrzeń. Każda dzielnica to wtyczka w osobnym katalogu;
jedna strona dema pokazuje CAŁY RING (`/dema/ring-dzielnica.html` — port ze stocznią w środku, dzielnice obok siebie
na jednym łuku) albo dowolną dzielnicę osobno (`?d=<id>`; `?d=huta,fabryki` — wybrane obok siebie).

Decyzje użytkownika (2026-11-13), wspólne dla wszystkich dzielnic:

- wszystko **bez szpar**: budowle dociśnięte do siebie i do ringu, do wnętrza wchodzi się z drogi;
- **cały proces ma być widoczny i fizyczny** — od surowca po gotowy wyrób: materiał przypływa, leży w kopcu, jedzie,
  topi się, zmienia kształt i wyjeżdża; dzielnica to łańcuch produkcji z materiałem w ruchu, nie rzędy hal
  (wzorzec: `huta/` — układ, `proces.js` z bilansem materiału, rysunek przez tworzywo);
- między budynkami po ringu jeżdżą **kosmiczne ciężarówki** i wożą części (pobocze drogi), jeżdżą też **pociągi**
  (kratownica pod drogą służy do transportu — to nie przypadek);
- budynki **eksportowo-importowe** mogą mieć **połączenie z zewnątrz** (doki od strony przestrzeni);
- gracz po zadokowaniu ma mieć dostęp do usług ringu: to, co kupi albo sprzeda, przywiozą albo zabiorą ciężarówki;
- najpierw **układ** (prototyp z brył zestawu portowego), wygląd w Blenderze dopiero po akceptacji układu;
- ekonomia Ziemi (ruch v2, `src/game/stationEconomy.js`): Ziemia nic nie wydobywa, ma role huta, elektronika,
  stocznia (podzespoły kadłuba i napędy), zakłady systemowe, zbrojownia; nie ma rafinerii, przetopu złomu,
  amunicjowni ani zakładu lotniczego — dzielnica nie dokłada ról, których Ziemia nie ma.

## Pliki

| Plik | Co |
|---|---|
| `dema/ring-dzielnica.html`, `dema/ring-dzielnica.js` | gospodarz: Core3D, ściana ringu, droga, Atlas, kamera, panel, API `window.__dzielnica` |
| `dema/ring-dzielnice/kit/uklad.js` | układ: `createDistrict`, `RING_V`, `ringScale`, `sector`, `districtLocate`, funkcje łuku |
| `dema/ring-dzielnice/kit/sceny.js` | bryły: narzędzia `arcTools` / `xzTools`, korpusy, doki, wieże, nadproża, droga, zatoki, przystanki |
| `dema/ring-dzielnice/kit/tworzywo.js`, `tworzywo3d.js` | TWORZYWO: bryły ruchome procesu (ruda, kopce, żar, wyroby, pojazdy) — rejestrator i partia w gospodarzu |
| `dema/ring-dzielnice/kit/zlozenie.js` | złożenie dzielnic na jednym łuku: kolejność `RING_ORDER`, `chainOffsets`, `composeRing` |
| `dema/ring-dzielnice/port/index.js` | port ze stocznią (`dema/stocznia-ringu`) opakowany jako dzielnica |
| `dema/ring-dzielnice/przyklad/index.js` | najmniejsza działająca wtyczka — wzór |
| `tests/helpers/ringDzielnica.mjs` | wspólne testy układu dzielnicy |
| `dema/ring-dzielnice/<id>/…`, `tests/ringDzielnica<Id>.test.mjs` | TWOJA dzielnica — jedyne pliki, które tworzysz i zmieniasz |

Zestaw wspólny (`kit/`, gospodarz, pomocnik testów, pliki portu `dema/stocznia-ringu/*`) zmienia tylko prowadzący.
Brakuje ci narzędzia albo coś w zestawie nie działa — napisz do prowadzącego, nie poprawiaj na własną rękę.

## Kontrakt wtyczki

`dema/ring-dzielnice/<id>/index.js` eksportuje domyślnie:

```js
export default {
  id: 'huta', name: 'Huta', sub: 'jedno zdanie — co to za dzielnica',
  build({ style }) {            // style = resolvePortBuildingStyle('earth')
    return {
      layout,                   // wynik createDistrict(...).finish(extra)
      buildings: [{ name, scene }],   // sceny PortRecorder (sceneOf); BEZ ściany ringu i drogi — te daje gospodarz
      hulls(berth) {},          // opcjonalnie: id kadłuba | null (puste) | undefined (dobór domyślny)
      views: [                  // opcjonalnie, najwyżej 6 (klawisze 3–8)
        { name, sub, caption, at: [s, v], zoom },               // kadr swobodny
        { name, sub, caption, at: [s, v], heading, zoom },      // teleport Atlasa
        { name, sub, caption, frame: [[x, z], …] }              // kadr obejmujący punkty lokalne
      ],
      lintelSkip: [[s0, s1]],   // opcjonalnie: gdzie nie stawiać bramownic nad drogą
      init(api) {},             // po zbudowaniu budowli: api.buildings[i] = PortBuilding3D w kolejności `buildings`
      step(dt, api) {},         // symulacja (dt × tempo z panelu)
      frame(api) {},            // co klatkę: api.proxy(id, hullId, x, z, kurs, { opacity, vx, vz, throttle })
      drones(api) {},           // co klatkę: wypełnij api.droneRec (pola api.CARGO_DRONE), potem api.drone({ x, z, angle })
      hud(api) {},              // wiersz tekstu do HUD-u
      stats(api) {},            // liczby do window.__dzielnica.stats().district
      note: 'tekst pod tabelą w panelu'
    };
  }
};
```

Wtyczka zawsze pracuje we WŁASNYM układzie (środek dzielnicy s = 0); w złożeniu gospodarz obraca dzielnicę wokół środka
ringu i sam przelicza pozy z `api.proxy` / `api.drone` oraz widoki. `api`: `layout`, `style`, `buildings`, `building(name)`, `time`, `state`, `hash(n)`, `yardPoint(s, v)`, `THREE`,
`YardHull` (kadłub w budowie w ramce `{ at(wzdłuż, w poprzek) }`), `hullBuildFront`, `trafficHullRenderSize`,
`occupied` (zbiór id zajętych stanowisk), `tworzywo` — rejestrator brył ruchomych procesu (`kit/tworzywo.js`): we
`frame(api)` zapisz co klatkę `api.tworzywo.box / cyl / roll / cone('bg' | 'fg', x, y, z, …, barwa [r, g, b], żar, tryb)`
w układzie dzielnicy (y — wysokość K-7; 'fg' — nad statkami); żar 0…1 to żar ciała (1 = ciekły metal), tryb 0 mat,
1 metal, 2 lampa. Tym rysuje się wszystko, co zmienia położenie, wielkość, barwę albo żar. Grupy ruchome budowli: `api.buildings[i].uniforms.uGroup.value[g]`
(Matrix4 w układzie lokalnym; `elements[15] = 0` chowa grupę; najwyżej 63 grupy na budowlę, `f.group = g` przy nagrywaniu),
lampy stanu: `f.fx(1.45, PB_FX.status, 0, kanał)` + `building._setChan(kanał, 0…1)` (16 kanałów na budowlę).

## Układ (`kit/uklad.js`)

- Współrzędne łuku: `s` — długość wzdłuż ringu na promieniu R0 = 43 752 (środek dzielnicy s = 0, zakres ±`sHalf`,
  najwyżej ±9 000), `v` — odległość promieniowa od krawędzi ścian ringu. `yardPoint(s, v)` → `[x, z]` lokalne;
  `yardTangent(s)` — kurs wzdłuż +s, `yardRadial(s)` — kurs w przestrzeń (+v). Długości wzdłuż łuku rosną z promieniem
  × `ringScale(v)`.
- Przekrój `RING_V`: rząd przy ringu v 0…1 000, droga 1 000…3 600 (oś 2 300, pasy statków ±650, pobocza ciężarówek
  ±1 190), rząd zewnętrzny 3 600…6 300. Rząd zewnętrzny może być głębszy albo płytszy; dalej w przestrzeń wolno
  wystawać do v = 14 000 (wyżej biegnie pierścień autostrady).
- `const D = createDistrict({ id, sHalf })`, potem:
  - `D.arcBar({ zone, bar, a, b, v0, v1, row, open, tags, face })` — belka wzdłuż łuku z dokami (`row`: 's', 'm', 'l',
    'carrier', 'capital', 'drydock', 'hangar'; `open` +1 = doki otwarte ku +v, −1 ku −v);
  - `D.block({ zone, bar, a, b, v0, v1, face })` — pełny blok; `D.radialBar(…)` — ściana promieniowa z dokami;
  - `D.addSolid(nazwa, tag, zone, punkty)` — dowolna wypukła bryła (wtedy korpus rysujesz sam);
  - `D.megaAt(zone, s, vLica, tags)` — pas MEGA od strony przestrzeni (połączenie z zewnątrz);
  - `D.truckBay({ s, side, len, goods, dir, label })` — zatoka ciężarówek na poboczu (side +1 lico rzędu
    zewnętrznego, −1 lico rzędu przy ringu); `D.railStop({ s, side, len, goods, dir, label })` — przystanek kolei;
    `goods` = id towaru z `src/data/resources.js`; rysuje je gospodarz;
  - `D.opening(s0, s1)` — zamierzony otwór w rzędzie zewnętrznym; `D.finish(extra)` — układ.
- Zasada kolizji: bryła obrazu w płaszczyźnie lotu (y od ~40 do ~250) MUSI mieć wielokąt w `solids`; bryła nad
  korytarzem lotu idzie do zestawu `fg` (spód y ≥ 400) i nie koliduje; pod płaszczyzną (y < 40) — bez kolizji.

## Bryły (`kit/sceny.js`)

`const { f, plates, labels, lamps, T } = newScene()` → nagrywasz → `return sceneOf(f, plates, labels, lamps, rig)`.
Gotowe: `bodies(T, f, layout, [strefy])` (korpusy belek z licami), `pitDetail` / `pitDetailRad` (doki), `megaDetail`,
`spire`, `controlBlock`, `lintel`, `chaseRow`, `greebles`; w układzie lokalnym z kierunkiem: `xzTools`, `faceTrim`,
`outerTrim`, `pitDetailXZ`, `greebleXZ`, `spireXZ`, `lintelXZ`, `stations` + `truss` (kratownica wzdłuż łamanej).
Materiały `PB_MAT`: steel, dark, pale, yellow, orange, teal, floor, rail, black, hose, copper, glass, paint,
paintCold, cyan, warm, white, red, green, status, deckPad. Efekty `PB_FX`: steady, blink, chase, status.
Wysokości `YARD_H`: keel −170, floor 18, deck 250 (wierzch rzędów), over 400 (spód brył FG), spineTop −330.
Wzory większych kompozycji: `dema/stocznia-ringu/scene.js` (rzędy, wjazd, suchy dok) i `sceneTri.js` (stocznia).

## Jak sprawdzać

- Test: `tests/ringDzielnica<Id>.test.mjs` woła `registerDistrictTests(test, assert, layout)` z
  `tests/helpers/ringDzielnica.mjs` (bryły wypukłe, rzędy bez szpar, pola doków poza bryłami, Atlas przejeżdża oba
  pasy i obraca się na drodze, zatoki i przystanki poza wylotami doków, dzielnica w swoim wycinku ringu) i dokłada
  własne przypadki. Uruchomienie: `node --test tests/ringDzielnica<Id>.test.mjs`.
- Bryły w Node (bez przeglądarki): zbuduj wtyczkę i policz instancje oraz NaN (wzór: `przyklad`).
- Przeglądarka: serwer prowadzącego już działa — `http://localhost:5199/dema/ring-dzielnica.html?d=<id>`
  (otwórz samym adresem; nie startuj własnego serwera na tym porcie). API `window.__dzielnica`: `ready`, `errors`,
  `views()`, `view(i)`, `center(s, v, zoom)`, `centerXZ`, `teleport`, `cine`, `simulate(s)`, `renderFrames(n)`,
  `speed(k)`, `stats()`, `snapshot()`. Przy ukrytym panelu przeglądarki klatki idą rzadko: przed zrzutem
  `renderFrames(3)` i ~2 s przerwy; `?shot=1` chowa panel.
