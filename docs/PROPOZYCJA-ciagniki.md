# Ciągniki kosmiczne: propozycja

Stan: demo i moduły gotowe (`dema/ciagniki.html`), do gry nic nie jest wpięte. Reguła obszaru: `.claude/rules/ciagniki.md`.

Słowa użytkownika: „dorobić ciągniki kosmiczne ciągające 1-2-3-4 lub 5 kontenerów — małe ciężarówki; akurat jak drony rozładowują duże statki, to nie wiedziałem, co zrobić z towarem. Jak to co — załadować na ciężarówki i transportować po ringu, do Ziemi itp.”; „lepiej robić takie małe ciągniki à la truck simulator — pasuje to do gry”.

## 1. Rozmiar: moduł 2 × 2 zamiast pojedynczego kontenera

Kontener gry ma 16 × 8 j. Przy zoomie 0,1 to 1,6 × 0,8 px, więc pojedynczego kontenera na naczepie nie widać, a kamera autostrady będzie tam spędzać sporo czasu.

| wariant | naczepa [j.] | ciągnik + 1 / + 5 naczep [j.] | przy zoomie 0,1 [px] | szerokość przy 0,1 [px] |
|---|---|---|---|---|
| kontener 1 × 1 (`?skala=kontener`) | 18 × 9 | 33 / 136 (ciężki) | 3,3 / 13,6 | 0,9 |
| **moduł 2 × 2 (domyślny)** | 36 × 18 | 66 / 272 (ciężki) | 6,6 / 27 | 1,8 (z dolnym progiem obrazu 2,4) |

Dla odniesienia, sylwetki w grze: prom 63 × 29 j., kuter policji 162 × 77 j., kontenerowiec ~300 × 88 j., ciężki frachtowiec 1620 × 590 j. Lekki ciągnik z jedną naczepą jest więc długości promu, a pełny pociąg z 5 naczepami to 1,7 kutra przy jednej czwartej jego szerokości: nadal mały, jak prosił użytkownik.

Dlaczego akurat 2 × 2, a nie np. 2 × 1 wzdłuż:

- 2 × 2 to dokładnie chwyt płaski drona L roju przeładunkowego (reguła `przeladunek-portow`), więc dron kładzie na naczepie jedną warstwę, którą i tak niesie.
- 2 × 1 (32 × 8 j.) wydłuża zestaw, a szerokość zostaje 0,8 px przy zoomie 0,1: kreska bez koloru.
- Kolor kontenera czyta się z szerokości, nie z długości.

Zrzuty do porównania: `node scripts/webgpu/ciagniki-demo.mjs --tylko zoomy,kontener` (`zoom-*.png` kontra `kontener-zoom-*.png`).

Ładowność w rachunku ruchu (kontener na obrazku jest widokiem liczby, jak w `cargoContainers.js`): `TRUCK_TRAILER_TONNES` = 30 t na naczepę. Dwie naczepy to klasa `van` (60 t), pięć naczep to 150 t i 20 slotów, czyli mniej więcej kontenerowiec (`hauler` 160 t, 18 slotów).

## 2. Jak powstał obraz

Sprawdzone dwie drogi:

1. **Kreator kadłubów + eksport:** próbny ciągnik w kompozytorze (zrzut w `.tmp/ciagniki/kreator/`). Wychodzi mały okręt: płyty Terra Novy i kratownica, bez zaokrąglonej kabiny i szyb. Nie ma też barwy na instancję, więc każda linia oznaczałaby osobny wypiek.
2. **Własny malarz pól odległości** (`scripts/ciagniki-sprite.mjs`, wybrany): warstwy kształtów dają mapę wysokości, z niej normalne, wnęki, kontur i brud. Część ma maski farby i akcentu, więc nowa linia przewozowa to wpis w tabeli, bez nowego PNG. Atlas ma ~0,9 MB. Każda część ma też zwykłe płótno PNG z alfą, gotowe jako sprite kadłuba ruchu.

Wygląd w grze różni się od sprite'ów AI: czystsze kształty, mniej zabrudzeń. Malarz dokłada kontur i brud, żeby zestawy nie odstawały przy frachtowcach (zrzut `skala`); ocena należy do użytkownika (decyzja D1).

## 3. Odbiór towaru od dronów przy stanowiskach

Dziś (reguła `przeladunek-portow`, E12): rój przenosi warstwy między ładownią a stołami przy burcie, a taśmociąg wzdłuż placu wiezie je do portalu w grzbiecie zatoki. Portal to koniec obrazu: towar znika w zatoce.

Propozycja: portal zostaje, a ciężarówka jest **następnym ogniwem za nim**, po stronie ringu:

```
ładownia → rój → stół → taśmociąg → portal zatoki → (wnętrze) → rampa za grzbietem → naczepa → pas ringu
```

Dwa warianty obrazu:

- **A. Rampa za portalem (rekomendacja).** Za grzbietem zatoki, w pasie ringu, stoi rampa z 2–4 miejscami. Ciągnik cofa naczepami pod rampę (kinematyka to obsługuje, ogranicznik pilnuje scyzoryka), moduł zjeżdża z taśmy na ramę, zestaw odjeżdża po zebraniu 1–5 naczep. Nie koliduje to ze stołami ani gniazdami dronów. Obraz roju i slotów zostaje bez zmian, nowe są tylko rampa i taśma do niej.
- **B. Plac przy stołach.** Ciężarówki podjeżdżają na plac przy burcie, a drony kładą warstwy wprost na naczepach. Efektowniejsze, ale plac jest ciasny: stoły i gniazda zajmują pole, gniazda sięgają pasa (`nestLaneMargin`), a plan roju trzeba by uczyć ruchomych celów. Drogo i ryzykownie dla roju (`SwarmSim`, wieża portu).

Kontrakt ten sam co E12: **sam obraz**. Świat ruchu liczy tony, a rampa i naczepy tylko pokazują ubywanie ładunku z postępem postoju (`actors.cargo`).

## 4. Wpięcie w ruch v2

1. **Kadłuby na końcu `TRAFFIC_HULLS`:** `truck_light`, `truck_standard`, `truck_heavy` (indeksy `TRAFFIC_HULL_IDS` starszych bez zmian), `png` i `main` z danych (płótna `assets/ships/trucks/tractor_*.png`). Ciągnik jako kadłub ruchu ma pełny zestaw tabel z reguły `ruch-banka` („Kadłuby ruchu = pełne kadłuby gry”). Tu trzeba decyzji: 33–50 j. to 2–3 komórki siatki belek 15 j.
2. **Klasa kursu:** `freighter-truck` w `TRAFFIC_UNIT_HULLS` oraz w `VAN_CLASSES` z ładownością z liczby naczep (30–150 t) i prędkością z jednej tabeli `driveModes.js` (cruise ~175 j./s w demie jest tylko obrazem; rekord kursu liczy czas własnym trybem). Kurs: stacja przy ringu ↔ Ziemia, krótkie odcinki w studni planety.
3. **Bańka:** encja bańki niesie pozę czoła, a naczepy liczy gra (kinematyka jest lekka, bez alokacji; poza interpolowana). Nowe pole bufora `TRAILERS` i rodzina ładunku z manifestu encji (`truckCargoForResource`). Blok migawki `traffic` dostaje liczbę naczep albo osobny blok z pozami (decyzja D5).
4. **Obraz:** partia `SpaceTrucks3D` w workerze renderu obok `ShipProxyBatch3D` (rozgrzewka `Core3D.warmup`, faza `loading`, `WARIANT_INSTANCJI`). `update` dostaje listę z bloku migawki. Moduł renderu nie zna gry (test importów).
5. **Trafienia:** statek ruchu ma obrys `LENGTH × WIDTH` i `damageTrafficActor`. Dla zestawu są dwie drogi (D4): obrys czoła i naczepy jako osobne prostokąty albo jeden prostokąt pociągu (zły na łukach).
6. **Ścieżki:** `routeAround` i router ringu bez zmian. Zestaw potrzebuje łuków o R ≥ `truckMinTurnRadius` (~78 j. przy 5 naczepach). Ścieżki bańki mają R znacznie większe.
7. **Kontenery-łup:** zniszczona naczepa wyrzuca paczkę z manifestu (`spillTrafficCargo`), reszta zestawu dalej jedzie, jeśli zniszczony był ogon.

## 5. Decyzje dla użytkownika

| # | decyzja | rekomendacja | dlaczego |
|---|---|---|---|
| D1 | Wygląd: czy styl malarza pasuje? | tak, z poprawkami po obejrzeniu dema | czytelna sylwetka, malowanie bez nowych PNG; jest czyściej niż frachtowce z AI |
| D2 | Rozmiar naczepy | moduł 2 × 2 (32 × 16 j.) | przy zoomie 0,1 widać kolor i liczbę naczep; to chwyt drona L; `?skala=kontener` do porównania |
| D3 | Odbiór towaru | A: rampa za portalem | rój i stoły bez zmian, mniejsze ryzyko |
| D4 | Trafienia i kolizje | osobne prostokąty czoła i naczep, zniszczona naczepa odpada | truck simulator: urwana naczepa to ciekawa scena; koszt mały |
| D5 | Awans do NPC | bez awansu na belkach, zestaw zostaje partią; wybuch i wrak z małej puli | ciągnik to 2–4 komórki siatki 15 j. wzdłuż, naczepa 2 × 1: za mało na kratery i cięcie. Silnik belek ma przeguby tylko „ciało ↔ stały punkt świata” (`addJoint`), więc zestaw i tak prowadziłaby kinematyka, jak pociąg megafrachtowca |
| D6 | Liczba naczep | lekki do 2, szosowy do 4, ciężki do 5 (`trailersMax`) | zróżnicowana sylwetka; limit tylko w danych, kinematyka przyjmie każdą liczbę |
| D7 | Tempo | ciężarówki jeżdżą dziś w demie 140–210 j./s (hipercruise nie) | zgodne z klasami `van` / `hauler` przy przelocie; w hipercruisie pociąg wyglądałby jak kreska, do ustalenia przy autostradzie |
| D8 | Linie przewozowe | siedem fikcyjnych, bez logo; z frakcjami powiązać później | na razie sam kolor, nazwy można zmienić bez PNG |

## 6. Użycie w innym demie

```js
import { SpaceTrucks3D } from '../src/3d/spaceTrucks3D.js';
import { createTruckTrain, placeTruckTrain, stepTruckTrain } from '../src/game/spaceTruckTrain.js';

const trucks = new SpaceTrucks3D({ scene, rigs: 64 });       // goły WebGPURenderer albo Core3D.scene
await trucks.ready;                                          // atlas
const train = placeTruckTrain(createTruckTrain('heavy', 5), x, y, kat);
const rig = trucks.add(train, { livery: 2, trailers: [{ cargo: 'standard' }, { cargo: 'tank' }, { cargo: 'hopper', load: 'ice' }, { cargo: 'hazmat' }, { cargo: null }] });

// krok 60 Hz (czoło rusza właściciel):
stepTruckTrain(train, nowyX, nowyY, nowyKat, 1 / 60);
// klatka:
rig.throttle = 0.7; rig.brake = false;
trucks.update({ x: cam.x, y: cam.y, ppu: cam.zoom, viewW: W, viewH: H, time: sekundy, alpha, sun: { x: sunX, y: sunY } });
```

Układ wejścia: współrzędne gry (y w dół obrazka), kąt jak w grze. Rozgrzewka: Core3D — `Core3D.warmup.now(trucks.warmupMeshes(), { name: 'ciągniki', variant: WARIANT_INSTANCJI })`; goły renderer — pętla z `instanceCount = 2` i `renderer.compileAsync` (`initBarePipe` w `dema/ciagniki.js`). Bez Core3D HDR i bloomu nie ma: emitery przycinają się do bieli, jeśli scena nie ma własnego postu.
