# Scanner Overview Targeting UI Design

## Cel

Zastapic obecne etykiety celow zbierane przy dole ekranu czytelnym UI skanera inspirowanym EVE Online: lista kontaktow, wybor celu kliknieciem, panel szczegolow oraz bezposrednie zaznaczanie obiektow w swiecie gry. System ma obslugiwac statki, wrogow, stacje i asteroidy jako kontakty skanera, bez przenoszenia gameplayu z warstwy 2D do Three.js.

## Zakres

- Dodac persistent/zwijalny panel `Overview / Scanner` z lista kontaktow.
- Dodac panel `Selected Object` z danymi wybranego celu.
- Dodac opcje ukladu `Fixed` albo `Floating`.
- Umozliwic wybor celu przez klik w wiersz listy oraz klik bezposrednio w obiekt w swiecie.
- Dodac asteroidy do targetingu i skanu z danymi: typ, rozmiar, masa, HP, twardosc, surowiec, yield, pas, predkosc i spin.
- Utrzymac obecne skroty: `X` dla skanera, `T` dla lock/cycle, LPM/PPM/F dla broni.

Poza zakresem tej zmiany:

- Nie przepisujemy CIC ani mapy systemu.
- Nie zmieniamy fizyki, kolizji ani destrukcji asteroid.
- Nie dodajemy frameworka, bundlera ani nowego renderera WebGL.

## Kierunek UI

UI sklada sie z dwoch powierzchni DOM:

1. `Overview / Scanner`
   - tabela kontaktow z kolumnami: typ, nazwa, dystans, rozmiar/klasa;
   - filtry: All, Hostile, Asteroid, Station, Friendly;
   - sortowanie domyslne po dystansie;
   - klik w wiersz wybiera kontakt;
   - podwojny klik lub przycisk blokuje cel;
   - prawy klik otwiera akcje kontekstowe.

2. `Selected Object`
   - szczegoly aktualnie wybranego kontaktu;
   - akcje: Lock, Scan, Approach, Orbit, Jump, a dla asteroid opcjonalnie Mine;
   - dla statkow pokazuje klase, HP, shield, bronie i ladownie, zgodnie z obecnym deep-scan;
   - dla asteroid pokazuje dane materialowe i fizyczne.

Centrum ekranu i dolny srodek pozostaja wolne dla celowania, lotu i HUD broni.

## Tryby Ukladu

`Fixed` jest domyslny:

- overview przypiety do prawej krawedzi;
- selected object przypiety do lewego dolnego obszaru;
- stabilny uklad dla myszy i klawiatury;
- panele mozna zwijac.

`Floating`:

- te same panele staja sie przeciagalne;
- pozycja i rozmiar zapisywane lokalnie;
- mozna przypiac panel ponownie do krawedzi;
- `Esc` zwija aktywne panele, ale nie kasuje lockow.

Preferencja ukladu powinna byc zapisana w `localStorage`, razem z pozycjami paneli floating. Brak zapisu oznacza fallback do `Fixed`.

## Model Kontaktow

Wprowadzamy wspolny model adaptera kontaktu, bez zmieniania oryginalnych encji:

- statki NPC i player-allies nadal uzywaja `x`, `y`, `radius`, `hp`, `shield`, `weapons`;
- stacje uzywaja istniejacych pol `x`, `y`, `r/baseR`;
- asteroidy uzywaja `worldX`, `worldY`, `scale`, `hp`, `hpMax`, `mass`, `hardness`, `type`, `size`, `resource`, `yield`, `beltId`, `vx`, `vy`, `spin`;
- helpery typu `getTargetX`, `getTargetY`, `getTargetRadius`, `isAsteroidTarget`, `isLockableTarget` ukrywaja roznice w ksztalcie danych.

Asteroida nie powinna udawac hostile NPC. Dla locka i broni jest `lockable`, ale dla AI i relacji frakcji pozostaje neutralnym obiektem zasobowym.

## Skaner I Targeting

`refreshScannerContacts()` zostaje rozszerzone:

- NPC/stacje/platformy zostaja jak obecnie;
- asteroidy sa pobierane przez `window.asteroidField.queryRadius(ship.pos.x, ship.pos.y, SCANNER_ACTIVE_RANGE)`;
- liczba asteroid w overview jest ograniczana przez sortowanie po dystansie i limit wyswietlania, zeby nie renderowac setek pozycji w DOM;
- kontakty maja `type`, `tone`, `distance`, `target` i opcjonalne `sortGroup`.

`T`:

- jesli overview jest aktywny i ma wybrany wiersz, lockuje/cykluje ten kontakt;
- jesli nie ma wyboru, wybiera najblizszy lockable kontakt wedlug filtrow;
- wrogowie moga miec priorytet w trybie combat, ale asteroidy musza byc dostepne, gdy filtr Asteroid jest wlaczony albo nie ma wrogow.

Klik w swiecie:

- klik w NPC/platforme/stacje uzywa obecnego pickingu;
- klik w asteroide uzywa spatial query/raycast z `asteroidField`;
- wybrany obiekt aktualizuje `Selected Object` i podswietla wiersz w overview;
- lock target marker 2D rysuje sie tak samo dla statkow i asteroid, korzystajac z helperow pozycji/promienia.

## Integracja Z Bronia

Locked asteroid moze byc przekazana do `fireWeaponCore`, `leadTarget` i rakiet tak samo jak inne targety, ale przez helper pozycji, bo asteroidy maja `worldX/worldY`.

Kolizje pociskow z asteroidami nadal rozstrzyga istniejacy `asteroidField.raycast()` i `applyDamageAt()`. Zmiana UI nie ingeruje w damage, split, debris ani lazy hex promotion.

## Komponenty I Pliki

Planowana implementacja:

- `src/ui/scannerOverviewUI.js` - nowy komponent DOM listy kontaktow i panelu szczegolow;
- `index.html` - integracja z `scannerContacts`, lock state, pickingiem i update loop;
- `src/ui/radarTargetingUI.js` - ograniczyc albo zastapic dolne etykiety trybem legacy/wycofanym;
- `src/3d/asteroidField3D.js` - ewentualny lekki helper pick/query, bez nowego renderera;
- testy jednostkowe dla helperow targetingu i danych asteroid.

## Zachowanie Mobilne I Split-Screen

Na malych viewportach overview przechodzi w zwijalny drawer przy krawedzi. Split-screen domyslnie ukrywa overview albo pokazuje tylko kompaktowy wybrany cel, zeby nie zakrywac dwoch viewportow.

## Testy

Testy powinny objac:

- helpery pozycji/promienia dla NPC, stacji i asteroid;
- walidacje lockable asteroid bez oznaczania ich jako hostile;
- budowanie danych panelu szczegolow dla asteroid;
- filtrowanie/sortowanie kontaktow;
- zachowanie `T` przy kontaktach wrogich i asteroidach.

Manualna weryfikacja w grze:

- `X` pokazuje liste kontaktow;
- klik w wiersz wybiera cel;
- klik w asteroide w swiecie wybiera ten sam cel;
- `T` lockuje/cykluje;
- bron trafia asteroide przez istniejacy raycast;
- panele nie zaslaniaja dolnego celowania i HUD broni.

## Ryzyka

- Zbyt wiele asteroid moze obciazyc DOM, dlatego lista musi miec limit i filtrowanie.
- Trzeba pilnowac `worldX/worldY` asteroid, zeby nie pomylic osi z 3D.
- `isHostileNpc` nie moze stac sie ogolnym warunkiem locka, bo asteroidy sa neutralne.
- Floating UI moze konfliktowac z inputem gry, wiec przeciaganie panelu musi blokowac input tylko na czas interakcji z DOM.
