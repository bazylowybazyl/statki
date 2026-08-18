# Ekonomia i logistyka — specyfikacja

Stan na 2026-08-11. Dokument scala decyzje projektowe rozproszone po rozmowach
oraz **zweryfikowane w kodzie** fakty, które mają wpływ na wdrożenie.

Rozdziały 1–4 opisują to, co **działa i jest przetestowane** (`npm test`, 173 asercje).
Rozdziały 5–10 to projekt **zatwierdzony, ale niewdrożony**.
Rozdział 11 to pułapki, na których już się przejechaliśmy.

---

## 0. Stan systemów

| System | Plik | Stan |
|---|---|---|
| Model surowców | `src/data/resources.js` | ✅ działa, testowany |
| Frakcje i reputacja | `src/data/factions.js` | ✅ działa, testowany |
| Produkcja stacji | `src/game/stationEconomy.js` | ✅ działa, **skalibrowany** |
| Łup z wraków | `src/game/salvage.js` | ✅ działa, testowany |
| Inwentarz broni | `src/game/weaponInventory.js` | ✅ działa |
| Planowanie tras | `src/game/cargoFleet.js` | ✅ logika dobra |
| **Transport fizyczny** | `index.html` `updateCargoFleet` | ⛔ **WYŁĄCZONY, do przepisania** |
| Dok | — | ⬜ niewdrożony |
| Model podróży (3 napędy) | — | ⬜ niewdrożony |

Transport jest wyłączony flagą `CARGO_DISPATCH_ENABLED = false`. Powód w rozdziale 11.

---

## 1. Surowce

28 surowców w trzech poziomach, 17 receptur. `resources.js` jest **jedynym
źródłem prawdy** — nowe surowce, receptury i wydobycie dodaje się wyłącznie tam.

```
T0 SUROWIEC (11)   7 z asteroid + 3 gazy z olbrzymów + złom z wraków
T1 RAFINAT  (11)   stal, przewody, chipy, stop tytanu, optyka, H₂/O₂,
                   pręty paliwowe, polimer, chłodziwo, paliwo fuzyjne
T2 KOMPONENT (6)   płyta kadłuba, awionika, rdzeń reaktora, silnik,
                   podstawa uzbrojenia, podtrzymywanie życia
```

Każdy surowiec ma **masę** (ładownia liczy się masą, nie sztukami) i **wartość
bazową** (kotwica dla cen lokalnych).

Poziom nie jest ścisłym poziomem DAG-u: `hull_plate` to komponent bazowy, z którego
powstają `thruster` i `weapon_mount`. To celowe — fabryka płyt jest wąskim gardłem
wartym skalowania.

### Surowce spoza przemysłu

Dwa surowce nie powstają na żadnej stacji. Ich niedobór to **treść, nie usterka**:

- **`uranium_ore`** — wyłącznie z pasa Kuipera (za Neptunem). Bez wydobycia w polu
  nie ma prętów paliwowych, a bez nich rdzeni reaktorów.
- **`scrap`** — wyłącznie z wraków przywiezionych przez gracza. Jedyna receptura
  o wsadzie w 100% zależnym od gracza (`recycle_scrap` na Marsie).

---

## 2. Frakcje

| Frakcja | Teren | Rola |
|---|---|---|
| **Terra Nova** | Merkury, Wenus, Ziemia, Mars | rdzeń przemysłowy |
| **Unia Pasa** | brak stacji *(patrz otwarte decyzje)* | górnicy |
| **Konsorcjum Zewnętrzne** | Jowisz, Saturn, Uran | gazy, paliwo, uran |
| **Piraci** | stacja misyjna | wrodzy wszystkim |

`factionId === null` to **stan, nie błąd**: opuszczona stacja, bezpański wrak.
Neptun startuje jako opuszczony.

Reputacja gracza per frakcja, progi: wrogi → nieprzychylny → neutralny → życzliwy
→ sojusznik. Wpływa na ceny, dostęp do doków i to, czy patrole strzelają.
Rozlewa się: sojusznik poszkodowanego traci połowę, jego wróg zyskuje ćwiartkę.

**`.friendly` jest WYLICZANY z frakcji**, nie ustawiany ręcznie — `syncEntityFactionFlags`
przepisuje wrogość frakcyjną na stary boolean, którego używa ~70 miejsc w kodzie.

---

## 3. Produkcja stacji

Każda stacja wydobywa (`PLANET_YIELD`), przetwarza (`STATION_INDUSTRY`) i zużywa
(`STATION_UPKEEP`). Silnik chodzi dla **wszystkich stacji naraz** — świat działa,
gdy gracz na niego nie patrzy.

> ⚠️ **Liczby w `PLANET_YIELD` i `STATION_INDUSTRY` są skalibrowane symulacją.**
> Zmiana któregokolwiek udziału albo wagi może zagłodzić łańcuch produkcji.
> Po każdej zmianie `npm test` — sekcja 12 liczy bilans podaży do popytu
> analitycznie i pokazuje, czego brakuje i o ile procent.

Żadna stacja nie jest samowystarczalna — to jest wymuszone testem. Ziemia nic nie
wydobywa (żyje z przerobu, wrażliwa na blokadę), Mars to stocznia w stałym głodzie,
olbrzymy gazowe importują stal na remonty.

**Ceny są lokalne:**

```
cena = wartość bazowa × niedobór × profil frakcji × reputacja
       (0.6 przy pełnym magazynie → 1.8 przy pustym)
```

To ten mnożnik niedoboru tworzy trasy handlowe. Nie ma osobnej „tabeli handlu" —
trasy są konsekwencją tego, co się nie bilansuje.

---

## 4. Łup z wraków

Broń zapamiętuje **komórkę kadłuba** (`c,r`), do której była przykręcona, więc
odlatuje z tym fragmentem, który odstrzelisz — nie losowym.

Dwie ścieżki: **cięcie w polu** (szybkie, złom + 40% komponentów, broń przepada)
i **holowanie do doku** (pełny łup z bronią w całości).

Zestrzelona jednostka zostawia we wraku **to, co faktycznie wiozła** —
`entity._extraSalvage` dokładane do manifestu. To jest sens piractwa: łup nie jest
tabelką dropu, tylko czyimś ładunkiem.

---

## 5. Model podróży *(zatwierdzony, niewdrożony)*

| | koszt | prędkość | uwagi |
|---|---|---|---|
| **konwencjonalny** | najtańszy | ~800 j./s | obecny warp gracza, spowolniony |
| **warp** | drogie paliwo fuzyjne | ~20 000 j./s | **NIETYKALNY**, przelot przez wszystko |
| **brama** | opłata, **tańsza od warpa** | skok natychmiastowy | ale dolot do bramy i od bramy |

Orientacyjnie: Ziemia↔Mars ~7 min konwencjonalnie, ~17 s warpem.
Ziemia↔Jowisz ~35 min konwencjonalnie, ~90 s warpem.

**Brama jest tańsza, NIE szybsza.** Od drzwi do drzwi bywa wolniejsza od warpa, bo
dolot do bramy i od bramy to lot konwencjonalny. Fazy `toGate → warping → toStation`
w kodzie już odpowiadają temu schematowi.

Nie da się wejść w cudzy warp. Podążanie za konwojem = znajomość punktu wyjścia
i czekanie tam. **Warp disruptory** — później; dopóki ich nie ma, cenny ładunek
jest nietykalny i to jest spójne.

**Do dorobienia:** „boostery" / ekspresówki skracające najdłuższe trasy konwencjonalne.

### Gdzie żyje piractwo

Skoro w warpie nie da się nikogo tknąć, przechwyt jest możliwy tylko tutaj:

```
napęd konwencjonalny — CAŁA TRASA        ← główny teren
ładowanie warpa                           ← okno na przerwanie
wyjście z warpa (punkt znany z góry)      ← zasadzka
brama (kolejka + opłata)                  ← chokepoint, ale strzeżony
```

Ekonomia **sama selekcjonuje łupy**: masówka (ruda, stal, lód) jest ciężka i tania
za tonę → leci konwencjonalnie → bezbronna. Komponenty są lekkie i drogie → warp →
nietykalne. Piraci polują na masówkę; wolumen czyni to opłacalnym.

---

## 6. Logistyka rekordowa *(zatwierdzony, niewdrożony)*

**Decyzja wynikowa z modelu podróży:** 35 minut oczekiwania na dostawę jest
akceptowalne, bo to ekonomia w tle — gracz tego nie ogląda. Skoro nie ogląda,
przesyłka nie może być symulowanym statkiem przez 35 minut.

```
  ZLECENIA (Order)     rekord: skąd, dokąd, co, ETA, właściciel
  ────────────────     setki, zero renderu, zero fizyki
         ▲ ▼  materializacja tylko w pobliżu gracza
  AKTORZY              pełny NPC: fizyka, AI, broń, kadłub heksowy
                       dziesiątki
```

**Niezmiennik:** każda partia ma dokładnie jednego właściciela fizycznego — dok,
statek, wrak albo stację. Przejścia atomowe:
`reserved → atDock → inTransit → delivered` albo `inTransit → wreck`.

Wynika z tego mechanika: **gracz jako klient sieci logistycznej** — zamawia
transport, płaci, dostaje ETA, robi co innego.

---

## 7. Dok *(zaprojektowany, niewdrożony)*

**Dok to fizyczna twarz istniejącego węzła stacji, nie nowy byt ekonomiczny.**
Stacja pozostaje źródłem prawdy dla magazynu, cen, frakcji i grafu warp.
Dok odpowiada za fizyczny dostęp, kolejki i **bufor tranzytowy**.

Bez tej dyscypliny zdublują się: graf warpa, magazyn, ceny i reputacja — i powstanie
darmowy arbitraż na dystansie stu jednostek.

**Komponenty wspólne przy różnym wyglądzie:**
- lądowiska klas **S / M / L / capital** (dok może mieć dowolny podzbiór)
- **berth** dla megafrachtowca — opcjonalny, osobny komponent (mieści tylko przód składu)
- magazyn tranzytowy
- stan techniczny

**Klasa capital jest wymagana od pierwszego etapu** — Atlas ma ~1800×600 j.,
a największe gniazdo w prototypie (`L`) to 1400×560. Nie mieści się.

**Stan techniczny powinien wynikać z dostaw stali**, analogicznie do zużycia
bytowego stacji — odcięty dok sam się degraduje. Lepsze niż wpisana liczba.

**Właściciel:** dok startowy to Terra Nova, ale **dok przy Jowiszu musi należeć
do Konsorcjum** — inaczej po zdradzie (reputacja Terra Nova leci na łeb) gracz
nie ma gdzie wylądować.

Prototyp do wykorzystania: `gigantyczny_dok_kosmiczny_3d.html` — ma `flightDeck.bays`
z typami i flagą `occupied`, alokację berthów, suwnice, tryb obronny, dziennik ruchu.
Brakuje mu ładunku, klasy capital, prawdziwej kolejki i integracji z `Core3D`.

---

## 8. Autostrady przez pas *(zaprojektowany)*

Przejście przez pas asteroid to **jedyne miejsce w układzie, gdzie omijanie
przeszkód ma znaczenie** — reszta trasy to pustka.

Autostrada = **oczyszczony korytarz**, nie ściana. Ktoś przemiótł odcinek i postawił
boje. Nikt nie zabrania lecieć na dziko:

| | autostrada | poza nią |
|---|---|---|
| prędkość | pełna | wolno, ciągłe uniki |
| skały | rzadkie, ale są | gęsto |
| piraci | **czekają tu** | nie opłaca im się |
| patrole | pilnują odcinków | brak |

**Kontrakt eskortowy obejmuje ODCINEK, nie trasę.** „Osłoń przejście przez Pas
Główny" — 3–5 minut realnego zagrożenia zamiast 40 minut lotu. Autostrada jest
przez to jednostką strukturalną całej rozgrywki eskortowo-pirackiej.

---

## 9. Pathfinding *(zaprojektowany)*

To są **dwa różne problemy** i mylenie ich jest kosztowne:

```
TRASA GLOBALNA                    OMIJANIE LOKALNE
graf ~20 węzłów                   promień kilku tysięcy jednostek
A* raz, mikrosekundy              co klatkę, tylko bliskie obiekty
gracz tego NIE widzi              GRACZ WIDZI TYLKO TO
```

Globalny pathfinding po 12 mln jednostek z 500 tys. asteroid jest zbędny — kosmos
jest pusty, a przeszkody skupione w znanych pierścieniach.

Omijanie lokalne jest tanie, bo infrastruktura istnieje:
`field.queryRadius(cx, cy, r)` i `forEachInRadius` nad hashem przestrzennym
zbudowanym dla 500 tys. asteroid.

---

## 10. Kontenery, konwoje, tłum *(zaprojektowany)*

**Kontener jest WIDOKIEM liczby, nie źródłem prawdy.** Ekonomia zostaje numeryczna
(jest skalibrowana); kontenery to `ceil(stock / rozmiar)` instancjonowanych brył
w magazynie. Realnym obiektem stają się dopiero na konwoju i **rozsypane po
zestrzeleniu** — wtedy da się je pozbierać, co spina się z salvage.

**Konwój zamiast pojedynczego frachtowca:** manifest rozbity na kilka statków
w szyku. Zestrzelisz jeden — tracisz jego część, reszta ucieka.

**Tłum jako potok, nie encje.** Wzorzec już jest w projekcie —
`src/3d/ringCityTraffic.js`: `Float32Array` na pozycję/prędkość + `InstancedMesh`,
320 pojazdów bez jednej encji. Pole asteroid ciągnie ten sam wzorzec przy setkach
tysięcy obiektów.

**Kolejka = zarezerwowany zakres `t` na pasie**, nie tablica referencji.
Statek zwalnia, gdy zbliża się do zajętego wycinka przed sobą:

```
speed[i] = min(cruise, k * (t[i-1] - t[i] - minGap))
```

Korek przy bramie wyłania się sam, jak w prawdziwym ruchu.

---

## 11. Zweryfikowane pułapki w kodzie

Wszystkie potwierdzone przez odczyt źródła.

**Skala świata.** `1 AU ≈ 42 250 jednostek`, nie 3000. `BASE_AU = 3000` to tylko
podłoga. Ziemia↔Mars to 340 tys. – 2,45 mln j. Sensor pasywny 18 000 j. to 0,43 AU,
więc **stacje są poza zasięgiem wzajemnej widoczności**.

**Despawn zjada ładunek.** `npcStep` (index.html:21660) kasuje każdego NPC bez
`mission` dalej niż `NPC_DESPAWN_RADIUS = 20 000` od gracza. Van ginął w tej samej
klatce, w której powstawał — już po tym, jak `loadShipment` zdjął towar z magazynu.
**To był czynny wyciek surowca, nie powolny transport.** Naprawione zwrotem do
nadawcy + wyłączeniem wysyłki; docelowo rozwiązuje to model rekordowy.

**Brak warpa inner↔outer.** `initWarpRoutes` (index.html:9078) pomija pary z różnych
sfer, a `pickNextStation` kieruje ruch cywilny między sferami w 35% przypadków →
`phase = 'direct'` → lot po prostej przez miliony jednostek. Ekonomia tego wymaga
(stal dla olbrzymów gazowych).

**Pociski pomijają `isCollidable === false`** (index.html:21284). Typy `freighter-*`
mają tę flagę, więc były **nietykalne**. Naprawione nadpisaniem flagi dla vanów.

**Chmary myśliwców agregują TYLKO prezentację** (`fighterClouds.js`) — każdy
myśliwiec pozostaje pełnym NPC z AI i fizyką. Nie liczyć 100 myśliwców jako jednej
jednostki symulacji.

**Warp gracza nie jest nietykalny** — obecny `idle → charging → active` z `warp.fuel`
to raczej napęd konwencjonalny z kosztem. Prawdziwy warp wymaga flagi nietykalności
(pominięcie w pętli pocisków, sensorach, celowaniu), przelotu przez kolizje
i **walidacji punktu wyjścia** — inaczej można wyjść wewnątrz asteroidy albo stacji.

**Klasa błędu, którą trzeba testować:** receptura istnieje w `resources.js`, ale
żaden profil przemysłowy jej nie wykonuje. Tak zniknęła rafinacja uranu i przetop
złomu. Test `stationEconomy` sekcja 12 pilnuje tego wprost.

---

## 12. Otwarte decyzje

1. **Unia Pasa nie ma bazy** (`homeStations: []`). Potrzebuje stacji w pasie,
   nosiciela albo korzystania z cudzej infrastruktury.
2. **Topologia połączeń** inner ↔ outer ↔ Kuiper — gdzie stoją bramy, którędy
   biegną autostrady.
3. **Gęstość tłumu** i gdzie: wokół stacji, na autostradach, w całym układzie.
4. **Czy tłum to te same statki co logistyka**, czy anonimowe tło plus wyróżnione
   konwoje ze zleceniem. Rekomendacja: to drugie.
5. **Budżety jednostek** — do wzięcia z PerfHUD, nie z sufitu.
6. **Zakres poddania się / abordażu** — dziś jedyna pętla to walka → wrak → salvage.
7. **Czy oddokowanie całego doku** (z prototypu) jest mechaniką, czy sceną fabularną.
8. **Brak systemu zapisu** — projekt od początku powinien używać serializowalnych
   DTO i stabilnych ID, bez referencji do obiektów stacji/NPC.

---

## 13. Kolejność wdrożenia

Każdy etap ma dawać coś grywalnego.

| Etap | Rezultat |
|---|---|
| **0. Jeden kontroler tranzytu** | Usunięcie podwójnego ruchu, pełna ścieżka warp bez fallbacku po prostej, warp inner↔outer. Pierwszy transport Ziemia→Mars naprawdę dociera. |
| **1. Zlecenia jako rekordy** | `Order` z ETA, materializacja przy graczu, dematerializacja zamiast `dead`. Ładunek przestaje zależeć od obecności gracza. |
| **2. Dok minimalny** | Lądowiska S/M/L/**capital**, kolejka, dokowanie gracza i NPC. Dwa presety wizualne, bez cargo. |
| **3. Minimalna pętla cargo** | Gracz zrzuca surowiec, widzi kontener i vana odwożącego go do stacji. **To jest cel: „zrzuć → zobacz, jak odlatuje".** |
| **4. Trzy napędy** | Konwencjonalny, warp nietykalny, bramy z opłatą. Walidacja punktu wyjścia. |
| **5. Autostrady i konwoje** | Korytarze przez pas, omijanie lokalne, konwoje z podzielonym manifestem. |
| **6. Piraci i eskorty** | Polowanie na masówkę, kontrakty na odcinek, zasadzki przy bramach i wyjściach z warpa. |
| **7. Tłum** | Potok na `Float32Array` + `InstancedMesh`, kolejki emergentne. |
| **8. Fabuła** | Start na doku, zdrada, preset rubieży. |

### Co testować w `npm test`

Zachowanie masy przy dostawie, zniszczeniu i przepełnieniu. Brak dwóch właścicieli
jednej partii. Każda trasa ma pełną ścieżkę (nigdy `direct` międzyplanetarnie).
Materializacja → dematerializacja nie zmienia stanu zlecenia. Każda receptura
ma wykonawcę. Bilans podaży do popytu.

Render, dokowanie i ruch suwnic ocenia się w grze.
