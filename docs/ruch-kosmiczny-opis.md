# Demo ruchu kosmicznego — opis

Plik: [`ruch-kosmiczny.html`](../ruch-kosmiczny.html) — jeden plik, zero zależności, canvas 2D.

**Mapa jest teraz zaciągnięta 1:1 z gry** — patrz „Aktualizacja 4" niżej.
Wcześniejsze pomiary w tym dokumencie robione były na mapie zastępczej
(3 stacje, trasa 700 000 j.) i takie zostają, bo dotyczą strojenia modelu ruchu,
a nie geometrii.

---

# Aktualizacja 2 — jezdnia wielopasmowa, wyprzedzanie, kraksy

Trzy zgłoszone problemy: marnowana szerokość pasa, krążenie statków na wlotach,
oraz „hamują, robi się mini korek, ci z tyłu hamują-jadą-hamują". Wszystkie trzy
miały jedną przyczynę: **pas miał 1440 j. szerokości, a ruch jechał po nim jednym
sznurkiem.** Stąd i niewykorzystana przestrzeń, i jedno miejsce wjazdu, i fale —
bo wolnego capitala nie dało się wyprzedzić.

### Co doszło

**Podpasy.** Każdy pas ma teraz `nsub` (domyślnie 3) niezależnych, posortowanych
tablic na tej samej geometrii, o osiach `−600 / 0 / +600`. Poprzednik dalej jest
pod `i-1`, więc nic nie kosztuje wyszukiwania sąsiadów.

**Wyprzedzanie (MOBIL).** Statek, którego przyspieszenie spadło poniżej progu,
sprawdza sąsiedni podpas: wyszukiwanie binarne po pozycji daje przyszłego
poprzednika i następcę, warunek bezpieczeństwa sprawdza obie luki, a zysk to
różnica przyspieszeń. Duże klasy ciążą do podpasu wewnętrznego, reszta dostaje
słabą premię „trzymaj się wewnętrznego", więc zewnętrzny zostaje wolny do
wyprzedzania. Zmiany są odkładane do końca przebiegu i dopiero wtedy wstawiane —
nie miesza się w tablicy, po której się właśnie iteruje.

**Histereza jest obowiązkowa.** Bez niej statek wyjeżdżał wyprzedzić, natychmiast
dostawał premię „trzymaj się wewnętrznego", wracał i cykl się powtarzał: licznik
pokazywał **358 zmian pasa na sekundę** przy 2000 statkach. To nie wyprzedzanie,
to drganie. Karencja 6 sekund symulacji zbiła to do **~68/s**.

**Antycypacja drugiego poprzednika.** Reagowanie tylko na pierwszego to klasyczna
niestabilność łańcucha — każdy hamuje dopiero po tym, jak zahamował ten przed nim.
Drugi człon hamowania IDM, ważony suwakiem `antic`, każe patrzeć o jeden statek
dalej.

**Wtapianie z rampy.** Statek z doku szuka luki na pierwszych 9000 j. **każdego**
podpasu, zamiast czekać na miejsce na `s=0`. Liczba okazji rośnie z jednej do
(podpasy × długość rampy / odstęp) — to jest to, co zdjęło krążenie na wlotach.

**Kraksy i wraki.** Model podążania jest bezkolizyjny z konstrukcji, więc
zderzenie nie może być skutkiem złego sterowania — musi być zdarzeniem. Trzy
źródła: wjechanie w przeszkodę, której nie dało się ominąć; najechanie na
poprzednika po zbyt brawurowej zmianie podpasu (suwak `daring`); awaria napędu
(suwak `failRate`). Kraksa wymaga energii — wtoczenie się w korku nie liczy się
jako zderzenie, inaczej każdy dopychający się statek produkowałby wrak. Pęd dzieli
się między kadłuby, a **wrak zostaje na jezdni jako przeszkoda**, więc kraksa
produkuje prawdziwy korek, który rozładowuje się dopiero po jej rozejściu się.

### Zmierzone efekty — otwarta trasa, z dala od bram i doków

| konfiguracja | śr. prędkość | wahanie | % wolnych |
|---|---|---|---|
| 3 podpasy + antycypacja 0,55 | **829** | **0,8** | **0** |
| 3 podpasy, antycypacja WYŁ | 836 | 1,2 | 0 |
| 3 podpasy, wyprzedzanie WYŁ | 828 | 1,8 | 0 |
| 1 podpas (stan sprzed) | 692 | **9,5** | 2,6 |

Falowanie spadło **12-krotnie**, a średnia prędkość wzrosła o 20%. Ciekawe jest,
że same podpasy robią większość roboty (wahanie 9,5 → 1,8), bo gęstość na podpas
spada trzykrotnie — czyli poniżej progu niestabilności. Antycypacja i wyprzedzanie
dokładają resztę (1,8 → 0,8).

Krążący agenci przy wylotach: **z ~250 do ~40**. Kraksy: **0–2 na minutę**
(przy 92 w pierwszej minucie zanim doszły dwie poprawki niżej).

### Stan ustalony po 20 minutach symulacji, 2000 statków

Jezdnia 869–896 statków przy 818 j./s i **0% wolnych**; kolejki pulsują tam, gdzie
powinny: boostery 0–9, bramy warp 0–11, doki 15–39 / 1–7 / 0–1; agentów 112–128;
zmian pasa 66–72/s; **0,95 ms na klatkę**.

### Pułapka, o którą się potknąłem — i którą trzeba pamiętać przy portowaniu

**Przepustowości bram są związane z liczbą podpasów.** Po potrojeniu pojemności
jezdni stare wartości (0,40 / 0,35 szt./s) dławiły całą sieć: przy 5000 statków na
otwartej trasie było ich nadal tylko 648, a reszta stała w kolejkach do bram.
Trzeba było je podnieść do 0,62 / 0,62, bo swobodny przepływ wzrósł do
~0,69 zamknięcia trasy na sekundę. **Zmiana `nsub` wymaga przestrojenia bram
i doków** — inaczej wąskie gardło przeskakuje w niekontrolowane miejsce.

Drugie: dwa błędy dawały 92 kraksy w pierwszej minucie. (1) Ściana bramy i progu
doku to wirtualny lider na `leadS = L.len`, więc każdy statek stojący w kolejce
miał `gapL = 0` i „rozbijał się o bramę" — kraksa musi wymagać, żeby liderem był
prawdziwy statek. (2) Podłoga `vcap = 25` sprawiała, że statek wgryzał się we
wrak zamiast przed nim stanąć; po jej usunięciu IDM zatrzymuje go i tworzy kolejkę.

### Czego ta zmiana kosztowała

Przy 2000 statkach i 3 podpasach **jezdnia przestała się korkować sama z siebie** —
zjawiska z kryterium 3 briefu (fale stop-and-go na otwartej trasie) przy domyślnych
ustawieniach już nie występują, bo pojemność drogi się potroiła. Wracają po
ustawieniu `podpasy = 1`, po podniesieniu `czasu reakcji T`, albo po zdławieniu
bram. To jest świadomy kompromis: user chciał płynnego ruchu, brief chciał fal.
Oba stany są na suwakach.

Nie udało się też pokazać korka **od przeszkody** przy domyślnej gęstości —
po potrojeniu pojemności odcinek jest za rzadki (ok. 50 statków na 35% pasa), więc
głaz produkuje kraksy i wraki, ale nie zator. Potrzeba do tego `podpasy = 1`
albo mocno podniesionej populacji.

---

# Aktualizacja 3 — booster faktycznie przyspiesza, kadłuby prostokątne

Zgłoszenie: przed bramą boostera stoi kolejka, a sam booster świeci pustkami;
statki powinny wjeżdżać od razu i być rozpędzane.

Za obrazkiem stały **trzy niezależne błędy**, z czego jeden poważny.

**1. Booster nie przyspieszał NIC.** Ograniczenie „wolniejszy pas przed sobą"
(zjazd z boostera z powrotem do 800 j./s) stosowałem bezwarunkowo na całej
długości odcinka. Przy `v = 801` dawało to już ujemne przyspieszenie, więc
prędkość była przyszpilona do limitu wyjazdowego od samego wjazdu. Pomiar:
`vSrednia` w boosterze wynosiła **766–803** przy mnożniku 3× i prędkości
docelowej 2400. Poprawka: hamować dopiero gdy trzeba, czyli gdy wymagane
opóźnienie `(v² − v_lim²)/2·ds` przekroczy 70% dostępnego. Po zmianie:
`vMax 2076–2453`, `vSrednia 1296–1863` (średnia niższa, bo na krótkim, 45 km
boosterze sam rozbieg i hamowanie zjadają większość odcinka — to już fizyka,
nie błąd).

**2. Booster miał limit TEMPA zamiast limitu MIEJSCA.** 0,62 szt./s przy
prędkości 2400 daje odstęp 4 km — odcinek z definicji wygląda na pusty, a przed
nim rośnie kolejka. Nikt nie ma powodu czekać przed wolnym boosterem. Teraz
wjazd jest wpuszczany do wypełnienia pojemności odcinka, liczonej z jego
własnej długości (`boostAllowed`), bo boostery mają 45 i 77 km — sztywna liczba
dławiłaby krótki i puszczała długi. Suwak to teraz `zapełnienie boostera`,
1.0 = wjazd bez czekania. Pomiar po zmianie: **stojących przed bramą 0 na każdej
z sześciu tras**, kolejki boosterów 0.

**3. Przy przejściu granicy statek dostawał „najlepszy" podpas po drugiej
stronie**, a nie ten, którym jechał — skok w bok o 1200 j. na samej bramie.
Stąd wrażenie „czekają, żeby wjechać na lewy pas". Teraz podpas jest utrzymywany
przez granicę i zmieniany tylko wtedy, gdy w docelowym nie ma miejsca.

### Kadłuby prostokątne

Trójkąty zastąpione prostokątami, bo taki jest kształt większości statków w grze.
Obrys renderu i obrys fizyki to **ta sama liczba** — `CLS_HW` wywodzi się wprost
z szerokości kadłuba:

| klasa | van | S | M | L | capital |
|---|---|---|---|---|---|
| dł. × szer. | 40×16 | 80×28 | 150×52 | 280×96 | 520×168 |

Szerokość wchodzi realnie w trzy miejsca: luz boczny przy omijaniu przeszkód,
test zderzenia z przeszkodą, oraz **okno potrzebne do zmiany podpasu** — kadłub
przechodzi bokiem, więc przez chwilę zajmuje oba podpasy i szerszy potrzebuje
większej luki wzdłuż pasa. Rozstaw podpasów (360 j. przy pięciu) z zapasem mieści
najszerszy kadłub.

### Stan po poprawkach, 2000 statków

Boostery przelotowe (kolejka 0, prędkość do 2450), bramy warp pulsują 0–40,
dok w Merkurym pulsuje 14→90→14 (to teraz główne wąskie gardło sieci i zachowuje
się poprawnie — rośnie i opada), jezdnia 900–940 statków przy 812 j./s i zero
wolnych. **2000 statków: 5,1 ms/klatkę na całej mapie, 1,4 ms w zoomie na dok;
5000 statków: 5,1 ms.**

---

## 8.1 Model ruchu

**IDM (Intelligent Driver Model)** po skalarze `s` wzdłuż pasa:

```
acc = a·(1 − (v/v₀)⁴) − a·(s*/luka)²
s*  = s₀ + max(0, v·T + v·Δv/(2√(a·b)))
```

`v₀` = prędkość przelotowa × mnożnik pasa × odchyłka klasy (`1 + dev·rozrzut`).
Poprzednik to `ord[k−1]` — brak wyprzedzania w pasie, więc kolejność sama się trzyma.

Na to nakładają się trzy ograniczenia, każde brane jako `min(acc, …)`:

| ograniczenie | wzór |
|---|---|
| wolniejszy pas przed sobą (zjazd z boostera) | `(v_lim² − v²) / (2·ds)` |
| czapka prędkości od przeszkody | `vcap = ds_dostępne / (dq / prędkość_boczna)`, potem ten sam wzór hamowania |
| szum o zerowej średniej | `± a · jitter` — zarzewie fal stop-and-go |

**Reprezentacja pasa.** Łamana 17 punktów, per-segment wyliczone z góry
`px, py, dx, dy, ux, uy, slen, cum, ang`. Pozycja statku to para `(s, q)`:
`s` po długości, `q` — odsunięcie boczne od osi. Konwersja `(s,q) → (x,y)` idzie
przez indeks segmentu cache'owany na statku, który tylko rośnie → O(1).

`q` dąży do celu z ograniczoną prędkością boczną. Cel to albo trwałe, per-statek
przesunięcie (rozkłada ruch na szerokość pasa i **dzieli strumień na dwie strony**
przeszkody stojącej na osi), albo odsunięcie wymuszone przeszkodą.

---

## 8.2 Potok kontra agent

Granica: **wszystko na trasie to potok.** Agentem statek zostaje tylko w dwóch
sytuacjach:

1. ostatnie ~3–15 tys. jednostek przed stanowiskiem — dolot, manewr, postój, odlot,
2. objazd przeszkody szerszej niż pas.

**Przejścia:**

- *potok → agent (dok):* alokator bierze pierwszych 10 statków każdego pasa
  dolotowego w promieniu 5000 j. od progu, sortuje malejąco po czasie oczekiwania,
  przydziela best-fit. Po przydziale ustawia `sState = AGENT`; najbliższy przebieg
  pasa wykompaktowuje go z tablicy — **żadnej chirurgii na tablicy w miejscu**.
- *potok → agent (objazd):* gdy wymagane odsunięcie przekracza 2,4 × półszerokość
  pasa i budżet agentów pozwala.
- *agent → potok:* `laneAppend` na `s=0` (wylot) wymaga luki w ogonie;
  `laneInsertMid` (powrót z objazdu) robi wyszukiwanie binarne + `copyWithin`,
  a po 22 s wciska się siłą.

**Ilu agentów naraz.** Zmierzone przy 2000 statkach: **71–154** w stanie ustalonym,
do ~330 w rozruchu. Górne ograniczenie to stanowiska (79) + dolot w tranzycie +
oczekujący na wylot + budżet objazdów (240).

Najważniejsza rzecz, którą wykryły pomiary: **buforem musi być stanowisko, nie
niebo.** Statek odchodzi od stanowiska dopiero wtedy, gdy w pasie wylotowym jest
luka (limit czasu 40 s tylko na wypadek zakleszczenia całej sieci). Przy krótkim
limicie do orbitalnego bufora oczekiwania wyciekało ~0,75 statku/s bez ograniczenia
— zmierzone 591 agentów i dalej rosło.

---

## 8.3 Kolejkowanie i parkowanie

**Stanowiska.** 5 klas, każdy dok ma własny podzbiór przez maskę. Merkury nie ma
ani jednego stanowiska capital — i statki tej klasy nigdy tam nie lecą, bo
`pickRoute` filtruje cele po `station.maxCls`.

**Przydział.** Kandydaci → sortowanie malejąco po czasie oczekiwania → best-fit
(najmniejsza klasa stanowiska, która pomieści statek).

**Brak zagłodzenia** wychodzi z samej kolejności: czas oczekiwania rośnie
monotonicznie, więc każdy czekający kiedyś jest tym najdłużej czekającym i wybiera
pierwszy. Best-fit dodatkowo nie pozwala vanowi zająć stanowiska capital, gdy
mniejsze są wolne.

**Blokada czoła kolejki** (capital na czele, za nim vany, które by się zmieściły)
rozwiązana tym, że kandydatami jest pierwsza dziesiątka, nie tylko lider. Statek
wyłuskany ze środka wychodzi bokiem.

**Zawory przeciw zakleszczeniu** — wszystkie trzy pokazane w HUD jako „zawrócone":
klasa nieobsługiwana w doku docelowym → natychmiastowe zawrócenie; oczekiwanie
> 110 s → zawrócenie; odejście od stanowiska po 40 s nawet bez luki.

**Oczekiwanie jest realne.** Lider pasa terminalnego widzi zatrzymanego wirtualnego
lidera na `s = L.len`, więc kolejka fizycznie stoi na pasie, a IDM propaguje ją
wstecz. Statek rusza dopiero na sygnał przydziału — nie „na oko".

**Manewr wejścia:** punkt odgięcia (w przód *i* w bok) → pierścień dolotowy R=1500
→ punkt podejścia (promień stanowiska + 230) → stanowisko.
**Manewr wyjścia:** punkt podejścia → pierścień odlotowy R=2050 pod kątem
stanowiska + 0,55 rad → wlot pasa. Inne promienie dla dolotu i odlotu = brak
konfliktów czołowych.

Dwa błędy z tego miejsca warto zapamiętać, bo oba wyglądały jak problem
przepustowości doku:

- **Separacja zabijała dokowanie.** Sąsiednie stanowiska w pierścieniu są ~90 j.
  od siebie, a promień separacji miał 340 j. Statki odpychały się od własnych
  stanowisk i nigdy nie domykały manewru — wszystkie stanowiska zarezerwowane,
  ani jedno zajęte. Separacja działa teraz tylko między agentami w swobodnym
  locie; zaparkowane i korytarz końcowego podejścia są z niej wyłączone
  (korytarz jest promieniowy, więc kolizji tam z definicji nie ma).
- **Czysto boczny punkt odgięcia to zawrót ciaśniejszy niż promień skrętu.**
  Agent krążył wokół waypointu zamiast go minąć — dolot trwał 25 s zamiast 10.
  Punkt odgięcia idzie teraz w przód i w bok, a promień akceptacji punktu rośnie
  z czasem lotu, co gwarantuje zbieżność.

---

## 8.4 Boostery i bramy

**Decyzja, która niesie całą architekturę: booster i brama warp nie są obiektami
leżącymi na pasie — są granicami między pasami.** Trasa to łańcuch pasów. Brama
warp to nieciągłość geometryczna na granicy; booster to pas z mnożnikiem `vmul=3`.

Gdyby brama teleportowała w środku pasa, przenosiłaby statek przed wszystkich
między wlotem a wylotem i psuła sortowanie — O(n) przy każdym przeskoku. Jako
granica: zdjęcie z głowy jednego pasa, doklejenie na ogon drugiego, O(1).

**Ograniczona przepustowość = wiadro żetonów** na wejściu pasa strzeżonego
(pojemność 2, dolewanie = suwak szt./s). O żeton prosi tylko lider pasa
poprzedzającego i tylko w promieniu `max(2500, 3v)` od granicy. Bez żetonu lider
widzi zatrzymanego wirtualnego lidera na końcu pasa → IDM buduje prawdziwą kolejkę.

**Skąd kondensacja.** Nie z mnożnika prędkości, a z limitu tempa: za bramą
przepływ równa się tempu wpuszczania, więc odstęp `v/tempo` jest większy niż
odstęp wynikający z popytu przed bramą. Stąd zagęszczenie przed i rozrzedzenie za.

**Dlaczego kolejki pulsują, a nie rosną.** Popyt jest elastyczny — dłuższa kolejka
spowalnia obieg, więc popyt sam opada do przepustowości bramy. Zmierzone przez
35 minut czasu symulacji: kolejka warpa wypłaszcza się na **92–104** i oscyluje,
kolejki boosterów chodzą w zakresie **0–72**.

Przekroczenie granicy używa wirtualnego lidera „po drugiej stronie"
(`leadS = L.len + next.s[ogon]`), żeby swobodny ruch nie hamował na każdym szwie
między pasami.

---

## 8.5 Omijanie przeszkód

**Metoda: odsunięcie boczne wewnątrz potoku + czapka prędkości z czasu manewru.**
Nie promocja do agenta — ta jest tylko dla przeszkód szerszych niż pas. Przy 2000
statkach O(1) na statek jest jedyną opcją, która nie wysadza licznika agentów.

Przeszkody rzutowane na każdy pas raz, przy zmianie (najbliższy punkt łamanej →
`s, q, r`). Strona omijania z znaku `(q − q_przeszkody)` — lepka, a w połączeniu
z trwałym przesunięciem per statek **dzieli strumień na obie strony**.

`OBS_LOOK = 6000` to parametr, który decyduje, czy omijanie jest darmowe.
Przy oknie 14 000 j. statki odginały się **bez żadnej straty prędkości**
(zmierzone: 711 → 637 j./s, zero korka) — geometrycznie poprawne, ale bezzębne.
Przy 6000 manewr jest dość ostry, żeby być realnym gardłem.

Promocja do agenta dopiero gdy wymagane odsunięcie > 2,4 × półszerokość pasa.
Zmierzone: `r=900` → 0 agentów objazdu (czyste omijanie w pasie),
`r=2600` → 8–12 agentów objazdu.

**Co się dzieje z korkiem — pomiary:**

| scenariusz | przed | z przeszkodą | po usunięciu |
|---|---|---|---|
| przeszkoda jako jedyna przyczyna, pas obciążony | v 647, wolnych 0, odchylenie 445 | v 602–630, wolnych 4–15, korek przed 7–16 (pulsuje), odchylenie 1726 | **v 653, wolnych 0, odchylenie 445, korek 0** |
| przeszkoda w środku istniejącego korka | v 422, wolnych 80 | v 388, wolnych 96, odchylenie 1680 | odchylenie 446 — wkład przeszkody znika |
| przeszkoda na wlocie do doku | czoło 738 j./s, 5/35 stanowisk, 2,5 dok./s | czoło 457 j./s, 19/35 stanowisk, 3,45 dok./s | czoło 749 j./s |

**Czy potok wraca do stanu sprzed: tak**, gdy przeszkoda była jedyną przyczyną —
odchylenie, liczba wolnych statków i korek wracają dokładnie do wartości bazowych.
Gdy przeszkoda wpadnie w korek utrzymywany przez zdławioną bramę, znika jej wkład,
a kolejka bramy zostaje — bo to nie jej korek. Dok z przeszkodą na wlocie **nie
przestaje pracować**, agenci ją opływają.

---

## 8.6 Struktury danych i wydajność

**Układ tablic.** 13 tablic typowanych × 24 000 (`Int32Array` / `Float32Array` /
`Uint8Array`): `sLane, sPos, sVel, sQ, sBias, sCls, sState, sSeg, sX, sY, sHdg,
sVX, sVY, sWait, sAg`. Zero obiektów na statek w warstwie potoku. Wolne slajdy
na stosie `freeList`.

**Na pas:** `order` typu `Int32Array`, posortowana malejąco po `s` (indeks 0 =
lider). Jeden przebieg w przód na podkrok robi IDM **i kompaktowanie w miejscu** —
usunięty statek po prostu nie jest przepisywany. Dopisanie na ogon O(1); wstawienie
w środek tylko przy powrocie z objazdu (`copyWithin`).

**Render:** 16 kubełków prędkości (albo 5 klas), współrzędne wpychane do tablic
`Float32Array` per kubełek, potem **jeden `beginPath`/`fill` na kubełek**.
Trójkąty powyżej zoomu 0,0085, prostokąty 1–3 px poniżej. Odcięcie po AABB widoku.

**Zmierzone** (Windows 11, Chromium; syntetyczny sterownik klatek z wymuszonym
`getImageData`, bo podglądowa karta rysuje na żądanie i realnego rAF nie dało się
zmierzyć — na docelowej maszynie wiarygodny jest licznik na ekranie):

| konfiguracja | ms/klatkę | sim | render |
|---|---|---|---|
| 2000, cała mapa | 2,3–2,8 | 0,26–0,64 | 0,31–0,59 |
| 2000, zoom na dok | 1,06 | 0,58 | 0,10 |
| 5000, cała mapa | 3,54 | 1,39 | 0,55 |
| 7642, cała mapa | 5,09 | 2,20 | 0,72 |

Budżet 60 fps to 16,7 ms, więc przy 2000 statkach zapas jest około sześciokrotny.

**Najdroższy jest przebieg IDM** i skaluje się liniowo (0,26 → 2,20 ms przy
2000 → 7642). Potem rysowanie statków (0,158 ms przy 2000). `updateHUD` 0,072 ms,
`drawWorld` 0,02 ms, diagram 0,012 ms.

**Następne wąskie gardło to nie symulacja.** Kolejno: (1) składanie ścieżek
canvas2d przy dużym oddaleniu i dziesiątkach tysięcy statków, (2) separacja agentów
O(n²) per stacja — nieszkodliwa przy setce, ale nie przy tysiącu, (3) dopiero potem
same tablice pasów.

---

## 8.7 Co się nie udało

1. **Nie zmierzyłem realnego 60 fps na ekranie**, tylko pracę na klatkę. Karta
   podglądu rysuje na żądanie (22 klatki w 14,7 s realnych). Licznik jest w demie
   i to jego trzeba odczytać na docelowej maszynie.
2. **5000 statków mieści się, ale tylko jako jeden wielki korek.** Pojemność sieci
   przy równowadze swobodnego ruchu to ~2600 miejsc (odczyt „wysycenie" w HUD).
   Przy 5000 statkach 3537 z nich jest poniżej 35% prędkości przelotowej.
   „2000 statków przy 60 fps" jest uczciwe. „5000 statków w żywym ruchu" nie —
   to 5000 statków w zatorze.
3. **Omijanie przeszkody w swobodnym ruchu nic nie kosztuje.** Fizycznie poprawne,
   ale oznacza, że zjawisko „przeszkoda → korek" widać tylko na obciążonym pasie
   albo przy małej prędkości bocznej. Nie znalazłem ustawienia, w którym omijanie
   jest jednocześnie wizualnie łagodne i mocnym gardłem.
4. **Kolejka do doku przy domyślnych ustawieniach jest krótka** (0–30), bo bramy
   dławią sieć wcześniej niż doki. Długą kolejkę do doku widać po przycisku
   „Zapchaj doki" (obsługa 34 s → kolejki 50/71/9).
5. **Brak zmiany pasa i wyprzedzania.** Wolny capital jest ruchomą blokadą na swoim
   pasie. Realistyczne, ale przez to rozrzutu prędkości klas nie można podnieść
   wysoko bez trwałego zakorkowania pasa.
6. **Powrót z objazdu po 22 s wciska się siłą**, jeśli luka się nie pojawi. IDM
   rozwiązuje chwilowe nałożenie w ciągu sekundy, ale to oszustwo.
7. **Przyspieszenie czasu było konieczne** (domyślnie ×15). Nie ma go na liście
   suwaków w briefie, ale bez niego przelot 700 000 j. trwa 15 minut.

---

## 8.8 Co przenieść do gry

**Gotowe:**

- **Trasa jako łańcuch pasów, bramy jako granice.** To ten element daje 2000
  pojazdów za darmo i odwzorowuje się wprost na `getWarpRoute` i fazy
  `toGate / warping / toStation`.
- **IDM z wiadrem żetonów na bramie.** Parametry do przeniesienia: `s₀=220`,
  `T=0,78`, `a=120`, `b=140` przy prędkości przelotowej 800.
- **`a = 120` — najmniej oczywista liczba w całym demie.** Odruch podpowiada
  wartość kilkukrotnie mniejszą; przy `a=26` rozbieg `v²/2a` to 12,3 km, statek
  wjeżdżający na pas pełzał przez pół trasy i **dławił wlot do 0,25 pojazdu/s**
  przy popycie 2,5/s. Reguła: rozbieg musi być mały wobec odległości stacja–brama.
- **Alokator stanowisk:** best-fit + kolejność malejąco po czasie oczekiwania +
  maski klas per dok. Odporny na zagłodzenie bez dodatkowej księgowości.
  Zawory zawracania są potrzebne, nie są ozdobą.
- **„Buforem jest stanowisko, nie niebo."** Trzymanie statku przy stanowisku do
  pojawienia się luki w pasie wylotowym to jednocześnie to, co ogranicza liczbę
  agentów i to, co przenosi zator z doku wstecz do kolejki dolotowej.
- **Obsługa przeszkód jako odsunięcie boczne + czapka prędkości z czasu manewru.**
  Dość tanie na pola asteroid w grze.
- **Obcięcie `dt` z obu stron.** Ujemny krok czasu (cofnięty zegar, zaległy
  callback) policzy symulację wstecz i rozsypie pozycje na pasach — u mnie dawało
  to `s = −122 000 000` i `v = 163 000`. Jednolinijkowe zabezpieczenie.

**Tylko rusztowanie demo:**

- 3 stacje, geometria tras z łukiem, sztywne ułamki długości dla boostera i warpa.
- Przyspieszenie czasu, diagram czas↔pozycja, cały panel suwaków, przyciski
  scenariuszy.
- Geometria manewru dokowania (pierścienie 1500/2050, stanowiska na koncentrycznych
  łukach) to placeholder — w grze są prawdziwe modele doków. Przenosi się
  **struktura**: odgięcie → pierścień dolotowy → korytarz promieniowy → stanowisko,
  z separacją wyłączoną w korytarzu i różnymi promieniami dolotu i odlotu.
- Klasy statków, długości i odchyłki prędkości — w grze jest `ships.js`.

**Liczby do wyliczenia od nowa, nie do skopiowania:** przepustowości bram
(tu 0,40 i 0,35 szt./s) i liczby stanowisk. Zostały dostrojone do popytu tej
sieci — ~0,43 zamknięcia trasy na sekundę — i będą błędne przy innej populacji
albo innej mapie. Narzędziem do ich wyliczenia jest odczyt „wysycenie sieci pasów"
w HUD.

---

## Sterowanie

LPM-przeciągnij = pan · kółko = zoom · WASD/QE · spacja = pauza · H = ukryj panele ·
0 = cała mapa · 1/2/3 = stacje · **PPM (lub Shift+LPM) = postaw przeszkodę** ·
LPM na przeszkodzie = usuń.

Przyciski `↯ w korku` i `↯ na wlocie do doku` stawiają przeszkodę w trudnym
miejscu i przenoszą tam kamerę. `Zdław bramy` / `Zapchaj doki` / `Stress 5000`
wchodzą w scenariusze skrajne.

---

# Aktualizacja 4 — mapa 1:1 z gry

Geometria nie jest już wymyślona. Wszystko poniżej jest odczytane ze źródeł gry,
nie oszacowane.

### Skala

`index.html:8352-8414` liczy AU jako:

```
AU = max(BASE_AU 3000, minAuForNoOverlap, WORLD_TARGET_DIAMETER / (outerRadiusAU × 2))
outerRadiusAU = max(orbita Neptuna 120, krawędź pasa Kuipera 140) + margines 2 = 142
AU = 12 000 000 / 284 = 42 253,52
```

`BASE_AU = 3000` to tylko podłoga i **nigdy nie jest wartością obowiązującą** —
człon `minAuForWorldTarget` jest 14× większy. Demo liczy tę samą formułę, więc
przy zmianie `WORLD_TARGET_DIAMETER` albo zasięgu Kuipera w grze wystarczy
zmienić te dwie stałe.

### Stacje

Z `makeSolarPlanets()` (orbity), `factions.js:homeStations` (właściciele) oraz
`STATION_INDUSTRY` w `stationEconomy.js` (wagi przemysłowe → wielkość doku).
Stacja stoi w pozycji planety, promień 120 j. (`index.html:9006`).

| stacja | orbita | odl. od Słońca | frakcja | waga | stanowisk |
|---|---|---|---|---|---|
| MERKURY | 8,00 AU | 0,34 M j. | Terra Nova | 0,8 | 16 |
| WENUS | 15,00 AU | 0,63 M j. | Terra Nova | 1,1 | 22 |
| ZIEMIA | 25,00 AU | 1,06 M j. | Terra Nova | 2,2 | 43 |
| MARS | 33,00 AU | 1,39 M j. | Terra Nova | 1,6 | 32 |
| JOWISZ | 50,20 AU | 2,12 M j. | Konsorcjum | 1,3 | 26 |
| SATURN | 80,58 AU | 3,40 M j. | Konsorcjum | 1,1 | 22 |
| URAN | 100,20 AU | 4,23 M j. | Konsorcjum | 0,9 | 18 |
| NEPTUN | 120,00 AU | 5,07 M j. | — | 0 | **0 (opuszczona)** |

Neptun nie ma frakcji, więc nie ma stanowisk — i mechanizm „dok bez tej klasy"
sam z siebie wyklucza go jako cel. Nie trzeba było nic dopisywać.

**Kąty orbitalne gra losuje przy każdym starcie** (`index.html:8445 angle: rand()`),
więc odległości między stacjami zmieniają się z sesji na sesję. Demo robi to samo,
ale z ziarna — przycisk `↻ Przelosuj pozycje planet` pokazuje inny układ, a ziarno
idzie do toastu, żeby dało się wrócić.

### Sieć tras

42 trasy kierunkowe (wszystkie pary siedmiu czynnych stacji), 162 pasy.
Per model podróży z gry masówka lata **konwencjonalnie**, więc to jest właśnie
ruch, który tu symulujemy; boostery odpowiadają planowanym „ekspresówkom".
Booster ma teraz długość bezwzględną (12% trasy, ograniczone do 30–300 tys. j.) —
ułamek dawałby na trasie do Urana odcinek 600 tys. j., a na Merkury→Wenus kilka
tysięcy. Brama warp tylko na trasach dłuższych niż 1,5 mln j.

### Co ta skala robi z demem

| | mapa zastępcza | mapa gry 1:1 |
|---|---|---|
| trasa najkrótsza | 414 k j. | **330 k j.** (6,9 min) |
| trasa mediana | 500 k j. | **2,46 M j.** (51 min) |
| trasa najdłuższa | 700 k j. | **5,29 M j.** (110 min) |
| Ziemia↔Mars (to ziarno) | — | **1,89 M j.** (39,4 min) |
| pojemność sieci przy swobodnym ruchu | 2 600 statków | **215 700 statków** |

To jest najważniejszy wniosek z importu: **mapa gry jest tak duża, że 2000 statków
jest na niej niewidoczne** — jeden statek na 38 tys. jednostek. Domyślna populacja
podniesiona do 8000 (3,7% nasycenia), suwak do 40 000 (18%). Żeby uzyskać gęstość
z mapy zastępczej, trzeba by ~150 000 statków.

Uwaga o `Ziemia↔Mars`: model podróży w grze mówi „~7 min", co odpowiada
340 tys. j., czyli ustawieniu planet w jednej linii od Słońca. Przy losowych
kątach mediana wychodzi znacznie gorsza — przy tym ziarnie 39 minut. To nie jest
błąd, tylko konsekwencja losowania orbit.

### Wydajność na mapie 1:1

Przy 8000 statków i skali czasu ×40 (10 podkroków na klatkę): **7,8–11 ms na
klatkę, z czego symulacja 8,7 ms** — to ona jest teraz kosztem dominującym, nie
render. Zejście na skalę ×15 zbija symulację do ~3,5 ms. 20 000 statków przy ×15
to 11,4 ms.

Render wymagał dwóch poprawek pod 162 pasy: pasy rysują się jedną ścieżką na styl
zamiast jednego `stroke()` na pas, i są odcinane prostokątem otaczającym.
Pojemność tablic pasa liczy się teraz z odstępu ruchu, nie z gęstości zatoru na
całej długości — inaczej 162 pasy po kilka milionów jednostek zjadałyby ~50 MB.

---

# Aktualizacja 5 — rampy zamiast teleportacji

Zgłoszenie: przy wyjściach z dróg statki nienaturalnie się materializują, a przy
wjazdach nienaturalnie znikają.

### Pomiar

Wykrywacz nieciągłości pozycji (skok większy niż `v·dt·2,5`), z licznikiem
pokoleń — bez niego recykling slotów statków fałszuje wynik, bo porównuje się
pozycje dwóch różnych statków w tym samym indeksie tablicy.

| źródło | przed | po |
|---|---|---|
| `laneMerge` — wtapianie z rampy | **545 skoków, do 10 471 j.** | — usunięte |
| rampa wjazdowa | — | **0** |
| zmiana podpasu / powrót z objazdu | 13, do 1 850 930 j. | **0** |
| warp (zamierzony) | 503 | 54 |
| inne | 0 | **0** |

Oba objawy miały jedną przyczynę: `laneMerge`, którą dodałem w Aktualizacji 2,
żeby zlikwidować krążenie na wlotach. Naprawiła objaw oszustwem — statek zawisał
przy wlocie, znajdował lukę nawet 10 km dalej i **teleportował się w nią**.
Z jednej strony znikał, z drugiej materializował się w środku potoku.

Sprawdzone i **niewinne**: powstawanie nowych statków (0,13/s), usuwanie (0),
zawracanie z doku (0,24/s). Licznik 36 641 zawróconych, który początkowo
wyglądał groźnie, był sumą ze wszystkich przebiegów testowych, nie tempem.

### Co doszło

**Pas rozbiegowy.** Pierwszy pas każdej trasy ma dodatkowy podpas istniejący
tylko przez 9000 j., odsunięty o jeden krok poza jezdnię. Statek z doku wjeżdża
na niego **w miejscu, w którym faktycznie jest** (rzut pozycji na pas, nie
`s = 0`), rozpędza się i wtapia normalną zmianą podpasu — czyli z ograniczoną
prędkością boczną i sprawdzeniem obu luk. Kto nie zdąży, staje na końcu rampy:
kolejka do wtopienia jest teraz widoczna, a nie ukryta w teleportacji.

**Pas zjazdowy.** Ostatni pas trasy ma podpas na ostatnich 6000 j. przed progiem
doku. Przydział stanowiska nie zabiera już statku z potoku od razu — zostawia
znacznik, statek zjeżdża na rampę normalną zmianą pasa, **mija stojącą kolejkę
po własnym podpasie** i opuszcza potok dopiero na progu. Wcześniej wyrywał się
bokiem ze środka sznurka.

**Statki rodzą się przy stanowisku.** `spawnTick` stawia nowy statek na wolnym
stanowisku w trybie oczekiwania na odlot; dalej idzie normalną procedurą.
Wcześniej pojawiał się na `s = 0` pasa wylotowego, czyli dokładnie tam, gdzie
droga wychodzi ze stacji. `despawnTick` nie wyrywa już statku z ogona pasa
(kasowało go tuż przy wjeździe) — nadmiar znika wyłącznie po obsłudze w doku,
a duże zmiany populacji i tak idą przez pełny zasiew.

### Trzy pułapki po drodze

1. **Cel agenta musiał przenieść się na oś rampy.** Dopóki celował w oś pasa,
   dolatywał 1200 j. obok rampy i skok wracał (755 zdarzeń po ~2700 j.).
2. **Punkt oczekiwania orbitował szybciej, niż statek potrafił lecieć** —
   po obniżeniu prędkości ostatniego odcinka do 190 j./s przy orbicie o prędkości
   stycznej 180 agenci gonili cel bez końca: 534 krążących. Cel zostaje teraz
   nieruchomo na rampie, dopóki statek do niej nie dotrze; orbita włącza się
   dopiero poniżej 700 j.
3. **Celowanie w próg rampy zamiast w jej głąb.** Rzut pozycji ucinał się na
   `s = 0` i zostawał skok ~410 j. Cel przesunięty na `s = 350` zbił to do zera.

### Stan po zmianach — 8000 statków, mapa 1:1, skala ×40

Jezdnia 5705–6766 statków przy 832–836 j./s i zero wolnych; agentów 136–240;
kolejki do doków pulsują 0–56; 3,9–5,5 dokowań/s; **8,7 ms na klatkę**
(symulacja 8,3 ms — to ona dominuje, nie render). Zero NaN-ów, zero naruszeń
sortowania tablic podpasów.

---

# Aktualizacja 6 — topologia kręgosłupa i tranzyt bez dokowania

Zgłoszenie: przy stacjach pasy się przecinają (w widoku z góry statki na siebie
nachodzą) i statki sztucznie stoją w kolejce NA drodze, zamiast — jak byłoby
naprawdę — zjechać i czekać wokół stacji.

### Skala problemu — pomiar przed zmianą

201 przecięć pasów: 10 bliżej niż 5 tys. j. od stacji, 35 w paśmie 5–20 tys.,
31 w 20–100 tys. i **125 w otwartym kosmosie**. Każda czynna stacja miała
**12 pasów** zbiegających się w jeden punkt (6 do + 6 od), bo każda para stacji
dostawała własną drogę.

### Kręgosłup

Stacja łączy się teraz tylko z **sąsiadami po orbicie**:
`MERKURY — WENUS — ZIEMIA — MARS — JOWISZ — SATURN — URAN` (Neptun opuszczony).

| | przed | po |
|---|---|---|
| trasy kierunkowe | 42 | **12** |
| pasy | 162 | **44** |
| pasów na stację | 12 | **4** (2 na końcach łańcucha) |
| przecięcia pasów | 201 | **26** |
| …z tego przy stacjach (<20 tys. j.) | 45 | **2** |
| pojemność sieci | 215 700 | 40 500 |
| wysycenie przy 8000 statków | 3,7% | **20%** |

Ruch jest gęstszy nie dlatego, że statków przybyło, tylko dlatego, że te same
statki jadą po mniejszej liczbie dróg. To jest ta sama zasada, którą planuje
model podróży gry: konwój spętany geometrią to jedyne miejsce, gdzie da się go
przechwycić.

### Tranzyt bez dokowania

Sam kręgosłup od razu ujawnił drugi problem: skoro statek dokuje na każdym
przeskoku, stacje w środku łańcucha obsługują cały ruch przelotowy. Zmierzone
kolejki do doków: **Wenus 601, Jowisz 558, Saturn 985** i rosnące.

Statek ma teraz **cel końcowy** (losowany wagą przemysłową stacji, więc Ziemia
ciąga najwięcej ruchu) i jedzie do niego etapami. Na stacji pośredniej **nie
prosi o stanowisko** — mija ją i wchodzi na następny etap. Alokator w ogóle nie
widzi statków tranzytowych.

Kolejki do doków po zmianie: **0–5**.

### Dwie rzeczy, które trzeba było przy okazji poszerzyć

1. **Rampa wjazdowa musiała stać się dwupasmowa.** Jednopasmowa wpuszcza ~1
   szt./s (tyle zajmuje statkowi opuszczenie progu), a ruch tranzytowy potrzebuje
   kilku — agenci `OUT` rośli 243 → 428 bez końca. Po poszerzeniu oscylują 160–220.
2. **Przepustowość bram warp znów była związana z topologią.** 12 tras zamiast 42
   to ~3,5× więcej ruchu na trasę; stare 0,62 szt./s dało **1484 statki
   w kolejkach do bram**. Po podniesieniu do 2,2 — zero. To już trzeci raz, kiedy
   zmiana struktury sieci wymaga przestrojenia bram; przy portowaniu do gry
   przepustowości trzeba wyliczać z popytu, nie kopiować.

### Stan po zmianach — 8000 statków, mapa 1:1

Jezdnia ~5100 statków przy 799 j./s i zero wolnych; agentów 190–250; kolejki do
doków 0–5; kolejki do bram 0; **14,7 ms na klatkę przy skali czasu ×40**
(symulacja 4,6 ms). Zero NaN-ów, zero naruszeń sortowania.

### Czego jeszcze NIE zrobiono

**Pierścieni oczekiwania przy stacjach.** Ruch tranzytowy przechodzi dziś przez
warstwę agentów (160–220 statków krążących wokół stacji), co daje z grubsza
zachowanie, o które chodziło — statki zbierają się wokół stacji zamiast stać
w sznurku na drodze — ale nie jest to struktura, tylko chmura. Docelowo pierścień
powinien być **zapętlonym pasem** w warstwie potoku: wtedy tranzyt w ogóle nie
staje się agentem, a oczekiwanie na stanowisko jest prawdziwą, mierzalną kolejką
krążącą wokół stacji. To jest następny krok.

---

# Aktualizacja 7 — kadłuby 1:1 z gry i sprite'y

### Skalowanie — odczytane, nie zgadnięte

`ships.js:308 getHullRenderSize()`:

```
world length = HULL_RENDER_PROFILES[id].length × HULL_RENDER_WORLD_SCALE (0.6)
world radius = profile.radius × 0.6
sprite dopasowany DŁUŻSZYM bokiem do tej długości
```

Demo liczy to samo. 16 kadłubów z `HULL_RENDER_PROFILES`, wymiary w jednostkach
świata:

| kadłub | dł. × szer. | klasa stanowiska | udział w ruchu |
|---|---|---|---|
| inter_station_shuttle | 120 × 96 | van | 40% |
| container_ship | 312 × 216 | S | 20% |
| long_haul_freighter | 540 × 312 | M | 13% |
| terran_frigate / pirate_frigate | 192 × 144 | van | 6% / 3% |
| corvus | 216 × 156 | S | 5% |
| terran_destroyer | 288 × 204 | S | 3,5% |
| pirate_destroyer | 360 × 204 | S | 2% |
| terran_battleship | 624 × 264 | M | 2% |
| pirate_battleship | 720 × 264 | M | 0,8% |
| terran_carrier | 1080 × 384 | L | 1,2% |
| terran/pirate_capital | 1200 × 600 | capital | 0,5% |
| terran_supercapital | 1560 × 600 | capital | 0,5% |
| megafreighter | 2760 × 912 | capital | 1% |
| atlas | 1800 × 600 | capital | — (gracz) |

Klasa stanowiska wynika z długości kadłuba, nie jest już osobnym bytem.
**Wymiary wchodzą w fizykę**: odstęp w potoku, luz przy omijaniu przeszkód, okno
przy zmianie podpasu i test zderzenia liczą się z rzeczywistego kadłuba, nie
z klasy. Średnia długość statku w ruchu wzrosła z 85 do **292 j.**, więc
pojemność sieci spadła o ~25%.

### Sprite'y

14 z 16 kadłubów ma sprite (`assets/*.png` i `src/assets/ships/*.png`, te same
pliki co gra). Rysowane przy bliskim zoomie, gdy widocznych jest < 600 statków —
jeden `drawImage` na statek. Dalej zostaje wsadowy prostokąt, bo 8000
`drawImage` nie zmieściłoby się w klatce. HUD pokazuje, ile się wczytało.

**Sprite'y wymagają otwarcia pliku Z DYSKU.** W podglądzie strona ładuje się jako
`data:` URL i ścieżki względne się nie rozwiązują — wtedy licznik pokazuje 0/14,
a statki rysują się prostokątami (fallback działa poprawnie).

### Odpowiedź na „a co jak ktoś z Ziemi chce polecieć na Jowisza?"

To już działa. Statek ma **cel końcowy** i jedzie po kręgosłupie etapami:
Ziemia → Mars → Jowisz. Na Marsie **nie dokuje** — mija stację i wchodzi na
następny etap. Alokator stanowisk w ogóle nie widzi statków tranzytowych.

### ZNANY, NIENAPRAWIONY PROBLEM

Ruch tranzytowy przechodzi dziś przez **warstwę agentów**: statek mijający stację
zjeżdża z pasa, leci wokół stacji i wtapia się w pas wylotowy przez rampę.
Wtapianie idzie pojedynczo, więc przepustowość rampy (~5,5 szt./s w całej sieci)
jest niższa od popytu (~6,1 szt./s). Efekt: **liczba agentów rośnie ~24/min** —
zmierzone 245 → 893 w ciągu 31 minut symulacji. Statki nie giną (licznik potoku
spada odpowiednio), wydajność się trzyma, ale to nie jest stan ustalony.

Próbowałem to obejść trzy razy (dwupasmowa rampa, celowanie w wolną lukę,
celowanie tuż za ogon kolejki). Każde podejście poprawiało tempo, żadne nie
zamknęło bilansu — bo problem jest **strukturalny**: tranzyt w ogóle nie powinien
opuszczać warstwy potoku. To jest dokładnie ten argument, dla którego pierścień
przy stacji musi być **zapętlonym pasem**, a nie strefą agentów: wtedy statek
przelotowy jedzie pas → pierścień → pas i nigdy nie wtapia się przez rampę.

---

# Aktualizacja 8 — pierścienie jako droga, nie agenci

Pierścień przy stacji jest **zapętlonym pasem w warstwie potoku**. Ruch przelotowy
nigdy nie schodzi z potoku: pas dolotowy → pierścień → pas wylotowy.

### Co to naprawiło

Regresja z Aktualizacji 6/7 — tranzyt szedł przez warstwę agentów i wtapiał się
przez rampę pojedynczo, więc **liczba agentów rosła ~24/min (245 → 893 w 31 min)**.

| | przed | po |
|---|---|---|
| agenci | 245 → 893, rosnące | **82–160, stabilne** |
| tranzyt przez agentów | 4,6 szt./s | **0** |
| statków na pierścieniach | — | 437–472 |
| kraksy | 3/min | 11–18/min (patrz niżej) |

### Jak jest zbudowany

**Zapętlony pas.** `L.loop` — `s` zawija się na `len`, a liderem czoła jest ogon
o jedno okrążenie dalej (`leadS = sPos[ogon] + len`). Zawinięty statek trafia na
koniec tablicy, więc sortowanie malejące po `s` zostaje nienaruszone. Zmierzone:
zero naruszeń sortowania, zero NaN-ów.

**Wejścia i wyjścia stycznie.** Pas trasy nie kończy się już „gdzieś przy stacji",
tylko **spiralą styczną do pierścienia**: `r(t) = R + (R_OUT−R)·t²`, więc przy
`t=0` pochodna promienia znika i kierunek jest czysto styczny. Bez tego kurs
skakałby na samym wjeździe.

**Zjazdy.** Każdy statek na pierścieniu ma pozycję zjazdu: tranzyt — kąt swojej
trasy wylotowej, dokujący — kąt przydzielonego stanowiska. Na `RING_EXIT_LEAD`
przed zjazdem przechodzi na właściwy skraj obwodnicy (na zewnątrz na trasę,
do środka na stanowisko). Jak nie zdąży wejść w pas wylotowy, **robi kolejne
okrążenie** — to jest naturalny hold, nie błąd.

**Przydział stanowiska liczony po obwodzie.** `bestFitAhead` wybiera z wolnych
stanowisk mieszczących klasę to, do którego jest najbliżej po pierścieniu.
Bez tego statek z przydziałem dokrążał nawet całe okrążenie (209 s) i to było
główne opóźnienie doku.

### Skala kompleksu stacji — ODSTĘPSTWO OD 1:1

Gra ma `r = 120` (`index.html:9006`), ale megafrachtowiec jest **2760 j. długi** —
statek byłby 23× większy od promienia stacji, przy której cumuje. To jest
niespójność w samej grze. W demie kompleks jest przeskalowany, żeby kadłuby
fizycznie się mieściły:

| | wartość |
|---|---|
| rdzeń stacji | 1400 (gra: 120) |
| pierścienie stanowisk | 3000 / 4200 / 5600 / 7200 / 9000 |
| pierścień dolotowy agentów | 12 000 |
| **pierścień-obwodnica (potok)** | **20 000**, obwód 125 600, okrążenie 209 s |
| spirala przechodzi w prostą | 55 000 |

**Odległości międzyplanetarne zostają 1:1.** Przeskalowany jest tylko kompleks
dokowy.

### Kaskada kraks na pierścieniu — znaleziona i zdławiona

Po włączeniu pierścieni kraksy skoczyły do **~180/min** przy oczekiwanych 3/min
z awarii. Pomiar źródeł: wszystkie to wjechanie w przeszkodę, wszystkie na
pierścieniu, 43 wraki naraz. Przyczyna: pierścień jest **zamknięty i gęsty**, więc
jeden wrak zbiera ofiary w kółko, a każda ofiara to kolejny wrak.

Poprawka: wrak w strefie stacji jest ściągany przez holowniki w 6 s zamiast 45.
Po zmianie **11–18 kraks/min, 1–13 wraków**. Zjawisko dalej istnieje (to nadal
kaskada, tylko krótka), ale nie ucieka.

### Stan i co zostaje słabe

8000 statków, mapa 1:1: jezdnia 3820–3953 przy ~790 j./s, pierścienie 437–461,
agenci 82–125, **14,5 ms na klatkę przy ×40** (symulacja 4,1 ms), zero NaN-ów
i zero błędów sortowania.

**Przepustowość doków jest niska: 0,42 dokowań/s przy 179 stanowiskach** (zajętych
4–10). Statki z przydziałem muszą dokrążyć do kąta stanowiska, a okrążenie trwa
209 s — `bestFitAhead` skrócił to, ale nie usunął. Do rozważenia: więcej zjazdów
z pierścienia niż jeden na stanowisko, albo krótszy pierścień przy mniejszych
stacjach.

**Nie zrobione:** statek gracza, loty bezpośrednie „na skróty".

---

# Aktualizacja 9 — korek przed pierścieniami

Zgłoszenie: statki stoją, nic nie jedzie, brak płynnego wjazdu na ronda.

Cztery niezależne przyczyny, znalezione po kolei pomiarem.

### 1. Fantomowy lider na wjeździe (główna)

Dla pasa wpadającego na pierścień lider był brany jako `NS.order[NS.count-1]` —
statek o **najmniejszym `s` na całym okręgu**, czyli losowy punkt na obwodzie
125 600 j. Jeśli akurat stał blisko `s = 0`, nadlatujące statki widziały
przeszkodę „tuż za końcem pasa" i hamowały do zera.

Teraz liderem jest statek tuż przed punktem wjazdu, a odległość liczona
**po obwodzie** (z zawinięciem).

### 2. Wjazd był punktowy

Wtopienie było dozwolone tylko na `ringEntryS` — statek musiał trafić na lukę
dokładnie tam i dokładnie wtedy. Teraz wolno się wtapiać na całym odcinku
zbliżenia: pozycja świata → kąt → `s` na pierścieniu, więc przejście jest ciągłe.

### 3. Cały ruch okrężny jechał pasem włączania

Skrajny podpas obwodnicy jest tym, na który trzeba się wcisnąć. Jeśli jedzie po
nim także ruch przelotowy, nie ma gdzie. Teraz statek z dala od swojego zjazdu
schodzi do środkowego podpasu, a skrajny zostaje dla włączających się —
dokładnie jak na autostradzie.

### 4. Pas włączania istniał tylko na papierze

Pomiar: `wZasiegu: 0` — **żaden** statek nie był w promieniu wtopienia. Spirala
schodziła na promień obwodnicy dopiero na ostatnich ~2 km, więc 6,6 km przed
końcem pasa statek był jeszcze 4700 j. za daleko. Deklarowane „16 km pasa
włączania" nie istniało.

Dojazd do stacji to teraz **łuk biegnący równolegle do obwodnicy** (26 000 j.,
promień `RING_R + 1600`) plus spirala. Statek ma cały łuk na znalezienie luki.

### Efekt

| | przed | po |
|---|---|---|
| stojących przed pierścieniami | **1352** | **63–176** |
| statków w strefie wlotu | 1712 | 201–305 |
| ich prędkość | 87–128 | **330–559** |
| statków na pierścieniach | 254–296 | **658–782** |
| rozkład po podpasach | wszystko na skrajnym | 221 / 270 / 167 |
| dokowań/s | 0,42 | 0,78–2,17 |
| na trasach | 3874 | 4767–5077 |

### Co zostaje otwarte

**Klatka 17,1 ms przy ×40** (symulacja 8,4 ms) — minimalnie ponad budżet 60 fps.
W potoku jest teraz o ~1200 statków więcej niż przed poprawkami, a przy ×40
wychodzi 10 podkroków na klatkę. Zejście na ×15 albo 6000 statków mieści się
z zapasem.

**Kraksy ~130/min** (przy 3/min z awarii). Ruch przy stacjach zagęścił się, a łuki
włączania biegną tuż przy obwodnicy — wraki zbierają więcej ofiar niż wcześniej.
Skrócenie życia wraku przy stacji (6 s) już działa, ale najwyraźniej za słabo.

---

# Aktualizacja 10 — wyloty z pierścienia rozciągnięte

Zgłoszenie: agenci fiksują się na punktach wjazdu/wyjazdu rond.

Trafna diagnoza. Wjazd miał już łuk włączania (Aktualizacja 9), ale **obie
pozostałe strony były punktowe**:

1. **Statki startujące z doku w ogóle nie korzystały z pierścienia** — leciały
   jako agenci prosto do jednego punktu rampy na trasę. Wszyscy z całej stacji
   celowali w to samo miejsce.
2. **Zjazd z pierścienia na trasę też był jednym punktem** (`s = 0` pasa
   wylotowego).

### Poprawki

**Zjazd na trasę jest łukiem.** Pierwsze 26 km pasa wylotowego biegnie wzdłuż
obwodnicy, więc statek przekłada się na nie na całej tej długości: kąt na
pierścieniu → pozycja na pasie, a `q` liczone z rzeczywistego promienia, więc
przejście jest ciągłe.

**Odlot z doku idzie przez obwodnicę.** Statek wtapia się w wewnętrzny podpas
pierścienia, a potem jedzie jak każdy inny. Nie ma osobnej ścieżki „agent leci do
rampy".

**Wejście tuż przed własnym zjazdem, z rozrzutem.** Pierwsza wersja wpuszczała
statek przy kącie jego stanowiska — wtedy musiał objechać pół obwodu i pierścienie
puchły (1391 → 1646). Teraz wchodzi `0,12–0,62 rad` przed swoim zjazdem, a rozrzut
jest liczony z indeksu statku: **2,4–12 km łuku**, więc nie ma ani punktu do
obsadzenia, ani zbędnego okrążania.

### Stan

| | przed A9 | po A10 |
|---|---|---|
| stojących przed pierścieniami | 1352 | **152–354** |
| prędkość w strefie wlotu | 87–128 | **269–432** |
| na pierścieniach | 254–296 | 1302–1443 (**stabilne**) |
| agenci | — | 152–220, stabilne |
| na trasach | 3874 | 4396–4583 przy ~805 j./s |
| klatka | 17,1 ms | **11,8 ms** |

### Nadal otwarte

**Kolejka przed wlotem pełznie** (158 → 354 w ciągu 8 minut). Wąskim gardłem jest
teraz sam pierścień: ~200 statków na stację przy pojemności swobodnej ~470.
Kandydaci na kolejny krok: szerszy pierścień (4 podpasy), szybsza obwodnica, albo
drugi pierścień zewnętrzny wyłącznie dla tranzytu.

**Kraksy ~130/min** — bez zmian, nadal do dociśnięcia.
