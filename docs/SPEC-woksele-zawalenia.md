# Specyfikacja dema GPU: budowle z wiązanych wokseli (kratownica jawna)

> **Kopia specyfikacji dema.** Kopia robocza do końca dema to `.tmp/woksele-proto/SPEC-demo-gpu.md` w worktree dema; ten plik zostanie z nią zsynchronizowany na końcu dema, więc do tej chwili może być starszy. Wskazane niżej dowody i prototypy (`proby4/`, `spec-proby/`, `krytyk-*/`, `wspolne/`, logi, kadry) leżą lokalnie w `.tmp/woksele-proto/`, wyniki pakietów dema w `.tmp/woksele-demo/`; `.tmp/` nie idzie do repo. Kod dema: `dema/woksele-zawalenia/`, `scripts/woksele-sym.mjs`, `tests/wokseleBudowa.test.mjs`, `tests/helpers/wokseleBiegi.mjs`.

Stan: 2026-11-05, po uwagach czterech krytyków i po pakietach P0 (§ 1.6), P1 (§ 1.7) i P2 (§ 1.8). Kod odniesienia: `proby4/model-spec4.mjs` (generowany: `A-kratownica-jawna/model.mjs` → `lataj.mjs` → `model-spec.mjs` → `lataj2.mjs` → `model-spec2.mjs` → `lataj3.mjs` → `spec-proby/model-spec3.mjs` → `proby4/lataj4.mjs`). **Numery linii w § 2 dotyczą `spec-proby/model-spec3.mjs`**: wersja 4 to te same linie plus łamanie granic przez falę (przed 889), ziarna dachu (przy 571) i `nKomStale` (przy 722). Parametry: `proby4/parametry-spec4.json`. Sceny grawitacyjne i metryki: `spec-proby/scenyG.mjs`. Reguły obrazu: `proby4/obraz4.mjs` + `rys4.mjs`, opcje końcowe w `proby4/bieg-fin11.sh`. Dziennik prób: `spec-proby/PROBY-rano.md`, próby grawitacji: § 10, próby po krytykach: § 1.5.

Ścieżki względne liczą się od `.tmp/woksele-proto/`, wyniki pakietów dema (`.tmp/woksele-demo/`) mają ścieżki pełne. Liczby są oznaczone: **zm.** (zmierzone w Node, z podaniem logu) albo **szac.** (szacunek). Kernele fizyki działają na GPU od P1 (§ 1.7), obrazu na GPU jeszcze nie ma: wszystkie kadry pochodzą z programowego rasteryzatora w Node.

## 0. W skrócie

- Fizyka: 15–21 tys. węzłów, dx = 20, 8 podkroków na klatkę 60 Hz, 2 dispatche na podkrok plus lista kontaktów co 4 podkroki. Atomiki są tylko w `kWstaw` (dodawanie do licznika komórki), `kLista` i `kZerujPo` czytają i piszą ten sam bufor przez zwykłe węzły, § 2.2.
- Obraz: węzeł to jeden blok, dopóki jest cały, a po uszkodzeniu L = 5 nierównych odłamków z tablicy wzorów (podział k-d) z szumem wierzchołków, do tego pręty, drobny gruz i pył. Beton i ciemna blacha zamiast jednej barwy, ton kawałka od ziarna.
- Pięć mechanizmów fizyki ponad model A: ziarna materiału, fala rozluźnienia, która **łamie granice ziaren nad frontem**, plastyczne zginanie bez stanu, waga dysku od szkody, kruszenie dysku od kontaktu. Dają płyty, słupy i ściany w hałdzie, górę kruszoną jeszcze przed frontem i dach, który nie ląduje jako taca. Kosztem odporności na największy strzał (§ 1.2).
- Grawitacja jest właściwością miejsca, nie modelu (§ 10). Ten sam kod i ten sam materiał: przy g = 400 wieża się miażdży, w próżni przepołowiona wieża rozlatuje się na dwie całe połowy, które się obracają. Fala milczy bez ramy odniesienia, więc w próżni nic z tych zmian nie działa.
- **Na GPU działa fizyka ze zdarzeniami (P1, § 1.7, P2, § 1.8).** Jeden podkrok zgadza się z migawkami Node, W1 stoi, zm. fizyka 0,29–0,44 ms/krok, a pełne S1, S2, S3, S4 i S4 przy g = 400 od budowy przechodzą progi § 8. Z4 nie jest zmierzone.

Kadry odniesienia: `proby4/fin11/S1_arkusz.png`, `S2_arkusz.png`, `S3_arkusz.png`, `S4_arkusz.png`, `S4g_arkusz.png`, strzał: `proby4/fin11k/S1_arkusz.png`.

## 1. Model i uczciwy stan

### 1.1 Dlaczego ten model

Model A: jawna kratownica z kalibracją. Trzech sędziów wybrało go warunkowo (`wyniki-porownania.md`). Powody, które się utrzymały:

1. Prototyp jest tym samym algorytmem, który pójdzie na GPU: gather czyta stan sprzed przebiegu i pisze tylko do siebie, nie ma kolorowania grafu.
2. Stanie budynku wynika z konstrukcji (sprężenie martwe), a nie ze strojenia.
3. Najmniej dispatchy z trzech modeli (22 na klatkę wobec 40–115).

Warunki sędziów i ich stan:

| Warunek | Stan |
|---|---|
| Wyjść ze stanu „na włosku” (jedna kolumna kładła wieżę) | SPEŁNIONY, zm.: kolumna stoi, narożnik stoi, r = 60: 32 z 32 |
| Usunąć chwianie do pionu | SPEŁNIONY, zm.: przechył po kolumnie 0,3° (było 8,8°), lepkość spoczynkowa |
| Fizyka gruba + drobny obraz | SPEŁNIONY inaczej, niż planowano: odłamki zamiast k³ |
| Słabsze połączenia strop–kolumna | Niepotrzebne w tej postaci: to robi granica ziaren (słup i strop to zawsze różne ziarna) |
| Hala i dysk jako sceny obowiązkowe | Dysk tak; hala ma REGRESJĘ, patrz 1.4 |

### 1.2 Warunki zaliczenia (na kadrach Node, parametry końcowe)

| | Stan | Dowód |
|---|---|---|
| Z1 / W2 podcięta wieża miażdży się, nie przewraca | DZIAŁA NA KADRACH NODE dla wybranego ziarna | `proby4/fin11/S1_arkusz.png`, `S2_arkusz.png`. Zm. `proby4/log-R7.txt`: S1 dach 1295, 1047, 582, 217, 174 przy t = 3…7, przechył spójny 4,2°. S2 z frontem: 1216, 1029, 545, 234, 175, 2,8°. **Rozrzut ziaren S1 (1, 3, 5, 7, 9, 21): 10,1 / 8,2 / 5,9 / 4,2 / 7,5 / 5,3°, mediana 6,7°** (przed zmianą fali 15,0 / 8,2 / – / 3,1 / – / 10,9°). S2: 2,8 / 0,9 / 1,4 / 1,8° (ziarna 7, 21, 5, 9). Demo używa ziarna 7, budowa musi być identyczna bajtowo (§ 9). Inne ziarno to widocznie większy przechył: 10° przy ziarnie 1 |
| Z2 / W3 przebicie, otwór | DZIAŁA | `proby4/fin11/S3_arkusz.png`. Zm. `.tmp/woksele-demo/migawki/linie-S3*.txt` (te same kawałki i zerwania co `proby4/log-f11c.txt`, z którego są kadry): v = 0,87 swobodnej, otwór 2,62 przekroju; poza środkiem 2,77; ośmiokąt 2,05; ziarno 21: 2,22. Wszystko przy gProj = 400, sprężeniu 0,5%, rytmie 4. **Poprawione w P0:** wcześniejsze 0,90; 2,33; 2,45; 1,60; 2,02 z `log-R7.txt`, `log-R21.txt` są przy gProj = 260, § 1.6 |
| Z3 / W4 drobny gruz, reszta dysku stoi | DZIAŁA Z GÓRY, SŁABO Z BOKU | Zm. masa dysku w kawałkach 1 / 2–7 / 8–63 / 64–511 / 512+: 616 / 173 / 88 / 0 / 16 505, ruszone 26,5% (`.tmp/woksele-demo/migawki/linie-S3.txt`, gProj = 400; przy gProj = 260 z `log-R7.txt`: 609 / 71 / 19 / 64 / 16 619, 19%). Z góry (`proby4/D2/S3_arkusz.png`, `fin11/kadry/S3_gora_t3.00.png`) 3–4 ramiona pęknięć z pasem kruszenia szerokości około 100–150 j., otwór zaokrąglony. Z kamery Kino otwór jest nadal blady, bo pod nim jest jasne tło. Gruz na pokładzie (emisja § 4.5) niesprawdzony. Zgiętych płatów prawie nie ma |
| Z4 czas klatki | NIE ZROBIONE | Dopiero na GPU, § 6, § 8 |
| Z5 wieżowiec w próżni, przepołowiony | DZIAŁA NA KADRACH NODE | `proby4/fin11/S4_arkusz.png`, § 10.6. Zm. `proby4/logG4-Z5.txt`: góra +37,5 j./s, 4,8°/s; dół −34,1 j./s, 3,3°/s; pęd 0; poza strefą cięcia oderwane 0,23% i 0,02%, największe kawałki 92,6% i 99,5%. Ten sam kod i materiał przy g = 400 z gruntem: miażdży się, `fin11/S4g_arkusz.png`, `logG4-g.txt`. Różnica między scenami to wyłącznie miejsce, gałęzi „jeśli próżnia” w materiale nie ma |
| W1 stanie | DZIAŁA | Zm. 60 s: maks. przemieszczenie w ostatnich sekundach 0,0106 j. (`krytyk-wiernosc/log-BzS.txt`), 0 zerwań, nasycenie po około 30 s. `log-Rst.txt` po zmianie fali: też 0 zerwań. W próżni przed cięciem 0,0000 j. Tylko Node, drżenia na GPU nikt nie widział |
| W5 kruszony beton, nie bryły | W DUŻEJ CZĘŚCI, TYLKO KADRY | Patrz wady a)–n). Nikt nie widział tego w ruchu |

Odporność, zm. na kodzie końcowym (`log6-W3.txt`, `log6-m60*.txt`, `log6-m90*.txt`, `log5-mk60g*.txt`):

| Próba | Przedtem | Teraz |
|---|---|---|
| Krater r = 60, J = 300, rdzeń 0,4 r usunięty, reszta rozerwana (§ 2.8), 32 miejsca | 30 stoi, 2 wali się (bez kopu) | **32 stoi**, opad ≤ 1,4 j. (`proby4/wyniki-mapa5.txt`). Wariant z powłoką S = 0,4 z poprzedniej wersji specyfikacji kładł wieżę przy (190, 0, 300) (`krytyk-wiernosc/wyniki-mapa.txt`), więc powłoki nie ma |
| Krater r = 90, J = 600, rP = 240, jw., 32 miejsca | 20 stoi, 12 wali się | **16 stoi, 16 wali się**: z = 1000: 8/8, z = 650: 4/8, z = 300 i 150: po 2/8. Bez kopu i bez łamania przez falę było 23 stoi. To koszt fali: największy strzał nisko zwykle kładzie wieżę |
| Krater r = 60, J = 300, rP = 160, jw., próżnia, 32 miejsca | nie liczone | Zm. P0 (`.tmp/woksele-demo/mapa/proznia-r60.txt`, 10 s): całość zostaje. Największy kawałek 99,7–99,9%, oderwane 12–42 węzły, czyli sama rozerwana kula, główny kawałek v ≤ 0,01 j./s, obrót 0,00°/s, \|P\|/N 0,000, odłamki do 40 j./s |
| Krater r = 90, J = 600, rP = 240, jw., próżnia, 32 miejsca | nie liczone | Zm. P0 (`.tmp/woksele-demo/mapa/proznia-r90.txt`, 10 s): żadne miejsce nie rozrywa wieży. Największy kawałek 98,5–99,7%, oderwane 52–226 węzłów, główny kawałek v ≤ 0,40 j./s, obrót ≤ 0,08°/s, \|P\|/N ≤ 0,005, odłamki do 348 j./s. Strzał w próżni wyrywa kawałek i nie rusza całości, decyzja w § 12 bez zmian |
| Kolumna, narożnik | stoi | stoi, 1309, 1310 j., przechył ≤ 0,3° (`log-Qo.txt`) |
| Kolumna + 2 kratery r = 60 kolejno (bez kopu) | nie liczone | stoi, 1308 j., 0,5° (`log-Qo.txt`) |
| 3 kratery r = 50 w różnych miejscach | stoi | nie powtórzone na kodzie końcowym |

### 1.3 Wady a)–n): co usuwa fizyka, co obraz

| Wada | FIZYKA | OBRAZ | Stan na kadrach |
|---|---|---|---|
| a) jednolity żwir, chmura równych kostek | Ziarna materiału (§ 2.3): masa w kawałkach [13702, 379, 70, 425, 0] → [1730, 1495, 8642, 1588, 748] (S1) | Odłamki nierówne, szum wierzchołków, normalna ściany, ton kawałka od ziarna | **ŻWIR USUNIĘTY, ZOSTAJĄ PŁYTKI.** Z bardzo bliska (`fin11/kadry/S1_bardzo_t7.00.png`) kawałki składają się z widocznych płytek, a na małych węzłach zostaje przekątny załam, gdy normalna idzie z pochodnych: stąd § 4.2. Na kamerach Kino i Bliska wada nie czyta się |
| b) dach jako płaska taca | Fala łamie granice ziaren, dach ma ziarna 4 × 4 | Nic | **USUNIĘTE NA KADRACH NODE.** Zm. największy kawałek dachu S1 przy t = 4,5 / 5 / 5,5: ziarno 7: 59 / 8 / 8%, ziarno 21: 99 / 10 / 9%, ziarno 1: 84 / 42 / 8% (`proby4/log-P11.txt`, `P12`, `P13`). Przed zmianą: 100% do t = 5,5. Bez ziaren dachu albo przy wolniejszej fali taca wraca (`proby4/P6`, `P8`) |
| c) góra regularna nad frontem | Jw. | Pył kontaktowy | **USUNIĘTE NA KADRACH NODE.** Zm. S1 t = 4,5: płyty nad frontem 39, 54, 41, 46, 59% największego kawałka; przedtem 100, 100, 100, 100. Na kadrach `fin11/S1_arkusz.png` góra rozsypuje się przed frontem. To reguła konstytutywna, nie wynik mechaniki, opis niżej. Cena: opad szybszy o około 0,5 s |
| d) ostry otwór, ruch tylko po liniach, mora | Ziarna dysku 4×4, kruszenie 0,6, waga od szkody, kruszenie od kontaktu, rozlew 0,82 | Blok zamiast k³, szum jasności ciągły w fragmencie, `Sv` dysku od S | **OBRYS I PĘKNIĘCIA NA KADRACH Z GÓRY DOBRE, MORA NIE.** Płytki i kropki z jasności węzła zostały w kadrach Node, lek w § 4.2 nietestowany. **ZGIĘTE PŁATY NIE** |
| e) brak pyłu, a potem duch wieży | Nic | Emisja przy co najmniej 5 kontaktach, prędkość promieniowa, chmura przy gruncie, § 4.6 | **POPRAWA.** Kratka kłaczków zniknęła (`proby4/fin11/S1_arkusz.png`), przy gruncie pył się rozlewa, ale nad hałdą stoi wąski słup. Na zbliżeniu t = 7 pył wypłukuje kadr (`M2/kadry/S1_bardzo_t7.00.png`): stąd sufit i wygaszanie przy kamerze w § 4.6. Wszystko bez ruchu |
| f) próżnia: przekrój gładki po stropie, konfetti pojedynczych węzłów (`obraz3/v1`) | Cięcie nierówne, wiązania wewnątrz ziaren przeżywają rozerwanie | Nic | **USUNIĘTE** (`fin11/S4_arkusz.png`) |
| g) próżnia: gładkie klocki T i L (`obraz3/v2/kadry/S4_blisko_t8.00.png`) | Nic | `Sv ≥ 0,75` dla rozerwanego węzła w ocalałym ziarnie | **USUNIĘTE** |
| h) kropkowanie i kreski na dużych ścianach | Nic | Kropkowanie to cień: 2048 teksli na 7000 j. (`krytyk-oczy/nocien` go nie ma). Kreski to szczeliny między blokami o różnej ramie: geometria, przejdą na GPU | **NIE USUNIĘTE.** Cień: zakres § 4.3. Szczeliny: zakładka § 4.2, wiersz w § 7 |
| i) tektura i styropian | Nic | Beton i ciemna blacha, mieszanie ku pyłowi tylko 0,15·d, ton kawałka od ziarna | **USUNIĘTE NA KADRACH NODE** (zm. S1 blisko t = 6: nasycenie 5,1 → 7,4%, mediana jasności 144 → 134, ciemne 10,1 → 10,5%, `proby4/miary4.py`; kadr `fin11/kadry/S1_blisko_t6.00.png`). Metaliczności rasteryzator nie zna. Budynek jest pusty w środku: stropy, słupy, szyb, fasada. Przegród i kabli demo nie ma, § 4.2 |
| j) strzał: czysty kęs | Rdzeń 0,4 r znika, reszta kuli zostaje rozerwana i spada | Odłamki z S = 1, pył, błysk | **USUNIĘTE NA KADRACH NODE** (`fin11k/S1_arkusz.png`, `log-M2k.txt`: 33 pojedyncze, 3 w małych kawałkach). Mapa § 1.2 z tą regułą |
| k) cięcie piłą w S2 | Front 0,3 s od środka, 20% węzłów rozrywane | Pył, błysk przy zdarzeniu, § 4.8 | **FIZYKA USUNIĘTA** (`fin11/kadry/S2_ciecie_t2.10.png`), przyczyny obrazem nie sprawdzono: błysku rasteryzator nie ma. Przy 70% rozerwanych gruz klinuje szczelinę: dach 350 przy t = 9, przechył 27° (`log-Q7.txt`): stąd 20% |
| l) pocisk jak klocek w piance, bez wyrzutu | Nic | Emisja gruzu z brzegu otworu, § 4.5 | **NIE USUNIĘTE**, niesprawdzone |
| m) jasne wnętrze otworu, czarny spód dysku | Nic | Ciemne tło pod dyskiem, doświetlenie od dołu, § 4.3 | **NIE USUNIĘTE.** Otwór czyta się na kamerze Bliska (`fin11/S3_arkusz.png`), na Kino jest mały i jasny |
| n) schodkowy wieniec dysku | Nic | Dociągnięcie wierzchołków wieńca do promienia R, § 4.2 | **NIE USUNIĘTE**, niesprawdzone |

**Skąd fala łamie i dlaczego to uczciwie opisana reguła.** Blok w prawie swobodnym spadku nie ma czym się kruszyć: obciążenie każdego piętra to ułamek statycznego, a piętra mają zapas 2,2 (Bažant, wymagany, żeby jedna kolumna nie kładła wieży). Sama fala osłabiająca (poprzednia wersja) nie zmieniała nic, bo małe siły nie dochodziły nawet do osłabionego progu. Dlatego wiązanie na granicy ziaren pęka, gdy `max(A_i, A_j)` przekroczy próg z hasha pary (§ 2.5). Zdarzenie jest symetryczne, zachowuje pęd i nie daje kopu. Nie wynika z równań ruchu: to reguła, która mówi „front ściskania i drgania luzują złącza powyżej”. Działa tylko przy węzłach w ruchu ponad 60 j./s względem ramy, więc nie rusza stojącej wieży ani budynku w próżni (zm. mapa r = 60: 32/32, S4 bez zmian). Pękanie samo podsyca falę (węzeł po utracie wiązań zostaje jej źródłem), stąd prędkość reguluje `fala.tempo`, a nie próg (`proby4/log-pP1.txt`, `P4`, `P5`: progi 0,25–0,45 dają to samo).

### 1.4 Porażki i niewiadome

- **Hala: regresja.** Zm. `log3-P2.txt`: hala bez podpór z 40% rzutu stała (dach 189 j.), teraz siada przy t = 5–7 (dach 89 j.). Najpewniej przez słabsze stropy (eMin 0,0007), czego nie izolowałem. Po zmianie fali nie powtórzone. Hali nie ma w demie, ale przy wpinaniu innych budowli strojenie trzeba powtórzyć.
- Kop fasady (70 j./s) i ziarna dysku 5×5 ze wzmocnieniem ×6 odrzucone na kadrach (`PROBY-rano.md`). Podcięcie wyżej (20–28% h) nic nie dało.
- Parametry dalej strojone na tych scenach przy dx = 20. Innego dx z ziarnami nie liczyłem.
- W S2 potrafi zostać stojąca iglica rdzenia przy t = 7 (`obraz2/g1`, słabiej w `obraz3/fin10`). Wygląda wiarygodnie, ale to przypadek, nie decyzja.
- Grawitacja: kotwice puszczają na gruncie, przechylone pole, kula i walec jako grunt: § 10.7, R15, R16. Przewrócenie przy połowie g projektowego przestało występować po zmianie fali (R17 zamknięte), ale próg, poniżej którego budynek przestaje się miażdżyć, przesunął się z około 0,6 g na około 0,1–0,25 g projektowego: § 10.5.
- Rasteryzator Node to nie shader: inne cienie, SSAO zamiast GTAO, bez metalu, bez bloomu, bez ruchu. Oceny dotyczą geometrii, rozkładu kawałków i proporcji jasności, nie finalnego wyglądu.

### 1.5 Próby po krytykach

Tylko Node, `proby4/`, parametry startowe `parametry-spec3.json`. Fizyka: `proba4.mjs`, `probaG4.mjs`, `mapa5.mjs`; kadry: `obraz4.mjs`. Bez nowych parametrów `model-spec4` liczy to samo co `model-spec3`, a przebieg czyszczenia z § 2.8 daje bit w bit Node (`krytyk-wiernosc/zdrowie2.mjs`, powtórzone: `proby4/log-zdrowie2.txt`, pozycje różne 0).

| Próba | Zmiana | Wynik zm. | Ocena |
|---|---|---|---|
| P1, P2 | Fala łamie granice: próg 0,25 + 0,5·hash (P2: 0,15 + 0,35), tempo 15 | Płyty 13% przy t = 4,5, dach 13% | Taca i kanapka znikają, ale cała góra staje się luźnym słupem przed t = 4,5: za dużo |
| P6, P7 | Zakres 1,5 i 3: łamie się tylko część granic | Dach 100% do t = 4,5 / 5 | Taca wraca: ODRZUCONE |
| P8 | Tempo 7, zakres 1 | Dach 91% przy t = 5 | Taca wraca: ODRZUCONE |
| P9 | Jak P1, bez granic słupów i rdzenia | Dach 14% przy t = 5, kawałki podobne | Bez przewagi, odrzucone, by nie mnożyć warunków |
| P10 | Tempo 9, zakres 0,5 | Dach 81 / 13% przy t = 4,5 / 5 | Dobrze, ale dach łamie się dość późno |
| **P11** | P10 + ziarna dachu 4 × 4 | Dach 59 / 8%; S1 dach 1047, 582, 217 | **WYBRANE.** Piętra czytelne przy t = 4, potem krusząca się góra |
| D1, D2 | Dysk: kontaktSzok 0,5 / 1,0, rozlew 0,7 / 0,82 | D2: 3–4 ramiona, pas kruszenia, otwór 2,33 przy gProj = 260, przy 400: 2,62 (§ 1.6) | **D2 WYBRANE.** Bez tego przy P11 otwór spadał do 1,59, bo pocisk kruszy się wcześniej |
| F0–F3 | S2 z frontem: rozerwane 70 / 20 / 0 / 40%, tau 0,4 / 0,3 / 0,3 / 0,25 | 70%: klinuje, 27°, dach 350. 20%: 2,8°, dach 157. 0%: 0,8°. 40%: 1,2°, dach 165 | **20%, 0,3 s**: w szczelinie zostaje gruz, wieża się nie klinuje |
| K60, K90 | Krater: rdzeń 0,4 r, reszta rozerwana | § 1.2 | Mapa policzona na P11 (dysk nie ma tam znaczenia) |
| M1–M4, fin11 | Barwy, normalna ściany, `zlom` 0,7 / 0,5, ton od ziarna, pył kontaktowy, chmura przy gruncie, dziedziczenie 0,6 | § 1.3 | `zlom` 0,7: płytki na wszystkim; 0,5: lepiej. Ton per odłamek: mozaika. Ton per ziarno: czytelne kawałki |
| K65 | nKom = 65 536 dla S3 | Metryki identyczne z 131 072 (`log-K65.txt`, przy gProj = 260). Poza środkiem już nie, § 1.6 | § 2.7 |

**Błąd rasteryzatora Node, naprawiony w `rys4.mjs`.** `Rys2` czyścił bufor głębi raz na klatkę, nie na kamerę, więc każdy następny kadr nosił resztki poprzedniego. Przy kolejności od dalekiej do bliskiej zostawały tylko resztki w tle, a przy kamerze z góry przed boczną powstawało „blade koło” pod dyskiem i jasne wnętrze otworu. Kadry `obraz3/*` i kadry krytyków mają ten błąd, ocen płynących tylko z tła nie należy im wierzyć. Odniesieniem jest wyłącznie `proby4/fin11`. Wzór wady znaleziony dopiero na kadrach kontrolnych z dodaną kamerą (`proby4/T0`, `T1`).

Niskie g i inne ziarna po zmianie: § 1.2, § 10.5. Krytyk oczu proponował też dmuchy pyłu z okien nad frontem. Nie sprawdzałem ich, bo góra kruszy się już fizycznie, a emisja wysoko to dokładnie to, co robi ducha wieży: odłożone do oceny ruchu.

### 1.6 Domknięcie P0: wzorzec CPU i poprawki specyfikacji

Kod: `dema/woksele-zawalenia/{scena,budowa,wzorzec-cpu,metryki}.js`, `scripts/woksele-sym.mjs`, `tests/wokseleBudowa.test.mjs`. Wszystko niżej tylko Node. Liczby z 2026-11-05, wyniki w `.tmp/woksele-demo/`.

- **Zgodność, zm. `zgodnosc-P0.txt`.** Budowa S1, S3, S4 bajt w bajt z `model-spec4` (29 tablic, skróty SHA-256 w teście). Przebiegi S1, S2, S3 (trzy warianty, przy gProj = 400 i przy 260), S4, S4 przy g = 400, swobodny spadek: po każdej klatce bajty pos, vel, acc, L, D, F0, S, A, etykiety, masek i liczniki równe `model-spec4` w tym samym procesie (11 przebiegów, `zgodnosc-bit/`). Logi: 74 z 74 linii identycznych po wycięciu czasu ściany: `log-R7.txt`, `logG4-Z5.txt`, `logG4-g.txt`, `logG4-sw.txt`, `log-Qo.txt`, `log-Rst.txt`, sześć wierszy `wyniki-mapa5.txt`, kawałki `log-f11c.txt`. Tabela § 8 w Node: `migawki/tabela-8.txt`, wszystkie wiersze z progiem zaliczone.
- **Błąd w specyfikacji, poprawiony: S3 w `log-R7.txt` nie jest przy gProj = 400.** § 1.2 twierdził „wszystko przy gProj = 400”, ale `proba4.mjs` bez `G_NAD` liczy gProj = g = 260, czyli K = 19 500. Dowód: `model-spec4` przy gProj = 400 daje zerw 44 074, przy 260 zerw 43 870 jak log (`spr-s3-warianty.mjs`). Kadry `fin11` są przy 400 (`bieg-fin11.sh`, `log-f11c.txt`). Decyzja z § 10.3 zostaje: S3 dema ma gProj = 400. Poprawione wiersze: § 1.2 Z2 i Z3, § 6.2 R3, § 8 S3, wartości wzorcowe zm. przy 400. Progi § 8 bez zmian, wynik mieści się w nich. Zadania `S3R7`, `S3pozaR7`, `S3osmR7` w `woksele-sym.mjs` odtwarzają stary log, nie demo.
- **`nKom`.** `log-R7.txt` liczono z 131 072 komórkami (n ponad 16 384). Przy 65 536 S3 z obrotem 30° wychodzi bit w bit tak samo (zm. `.tmp/woksele-demo/spr-nkom.mjs`, 300 klatek, gProj 400 i 260; odrzucone wstawienia 187 kontra 112, ale w komórkach bez kontaktu), a S3 poza środkiem przy gProj = 260 inaczej: zerw 44 638 kontra 44 806, otwór ten sam 2,45, kawałki dysku 624 / 111 / 74 / 0 / 16 573 kontra 616 / 129 / 64 / 0 / 16 573. Kolizje tablicy przesuwają układ chaotyczny. Wariantu poza środkiem w demie nie ma, 65 536 zostaje (§ 2.2).
- **Chwila zdarzenia.** Wzorzec, jak `proba4.mjs`, wykonuje w klatce f czasy z (f/60 − 1e−9, (f + 1)/60 − 1e−9]. `obraz4.mjs` bierze (t, t + dt], więc węzły S1 z czasem równo 4 s idą klatkę wcześniej i `fin11` to inny bieg niż `log-R7.txt` (zerw 104 156 kontra 104 422, kawałki bez istotnej różnicy). S2 i S4: bez znaczenia. Na GPU to się mieści w progach § 8, a dokładny przypadek t = 4 w f32 i tak nie jest gwarantowany.
- **Etykieta bez kotwic.** Node zostawia wtedy 60 000 z budowy i jej nie liczy, wzór w § 2.5 da 0 przy `uCap = 0`. Nic jej wtedy nie czyta. `porownajPodkrok` pokazuje różnicę etykiet, ale nie wlicza jej do zaliczenia. Porównuj etykiety tylko w scenach z `capEtyk > 0`.
- **Migawki, zm. `migawki/`.** S1 t = 3,5 i t = 5, S2 t = 3, S3 t = 0,43 (f = 26, pierwsze uderzenie), t = 0,8 i t = 2,95, S4 t = 3: `.json` z nagłówkiem + `.bin`, wczytanie `rozpakujMigawke`, porównanie `porownajPodkrok`. „przed” to stan przed zdarzeniami klatki, „po” to jeden przebieg kLista + kF. Odczyt z pliku daje ten sam wynik bit w bit (`kontrolaPliku` w nagłówku).
- **Mutacje na kodzie końcowym, zm. nagłówki migawek (`mutacje`), progi § 8.** Każda wykryta co najmniej w jednej migawce S1, S2: bez `falaPeka` S1 t = 3,5: 32 maski, S2 t = 3: 55, S3 t = 0,8: 8, **przy S1 t = 5 nic, bo wtedy granice już pękły**; bez fali A różne 490–5308; bez pary |Δa| p99 597–1264; bez lepkości p99 52–222; `zlomB` 0: maski 17–150, ale w S2 t = 3 nic; wypiek 90°: L 28, 16, przy S1 t = 5 nic; bez szkody od kontaktu tylko S1 t = 5 (S w 2 węzłach), S3 t = 0,43 (S w 22 węzłach, 8 z nich na dysku, różnica do 0,95) i S3 t = 2,95 (S w 6 węzłach, wszystkie w wieży: 5 strop, 1 rdzeń; `popr-P0/log-s3-skan-dysk.txt`, `log-s3-kontakt.txt`); bez szoku S w 26–65; bez rozlewu S w 16–380; bez kruszenia L w 94–5080. Test GPU musi więc przejść wszystkie migawki, a nie jedną.
- **Sekwencja S1, zm. `sekwencja-S1/`.** 30 klatek od t = 5, co 1/60 s, kamera Bliska, 960 × 720, `obraz4.mjs` + `rys4.mjs`, opcje z `bieg-fin11.sh`. Rasteryzator nie ma limitu wzrostu `dObraz` z § 4.1, więc to przypadek bez leku. Zm. `sekwencja-S1/log.txt` przy t = 5–5,5 na klatkę: skok d ponad 0,15 w 139 węzłach (szczyt 220), przejście w „sam” 34 (przedtem 92 i 16,5, `krytyk-oczy/log-t7.txt`, przed zmianą fali). Średnia różnica jasności między kolejnymi klatkami 8,7–11,8 na 255, maks. do mediany 1,19 (`roznice.json`): w całym kadrze żadna klatka nie odstaje. Oceny oczami agenta bez kontekstu jeszcze nie ma.
- **Sprawdzian P0 i strażnicy wzorca, zm. `.tmp/woksele-demo/popr-P0/`.** Niezależny sprawdzian (`.tmp/woksele-demo/spr-P0/`) pokazał, że `node --test` nie pilnował fizyki wzorca: z 33 mutacji przechodziło 26, w tym połowa grawitacji i krok 1,5 h, bo test porównywał dwa `WzorzecCpu` ze sobą, a zgodność z logami była tylko w `--zgodnosc`, które wymaga `.tmp/`. Teraz `tests/wokseleBudowa.test.mjs` trzyma stałe policzone z `model-spec4` (`.tmp/woksele-demo/skroty-biegi-spec4.mjs`): skróty SHA-256 12 pól stanu i 10 liczników po 10 krótkich biegach ze świeżej budowy (`tests/helpers/wokseleBiegi.mjs`: S1 i S4 po 60 klatek od f = 120, S2 40 od f = 120, S3 60 od f = 0, S4 w polu obrotu, w polu punktu, z rampą `skalaG` i na gruncie bez kotwic oraz S1 z `odkotwicz` w obu gałęziach, po 12 klatek) i wszystkie liście `PARAMETRY` (z `parametry-spec4.json`, cztery liście z domyślnych w kodzie modelu: `nKom`, `kontaktSzokV`, `fala.prog`, `fala.oslab`). Wszystkie biegi wyszły w porcie bit w bit za pierwszym razem, wzorzec się nie zmienił. Całe biegi z `log-R7.txt` dalej porównuje tylko `--zgodnosc` (74 z 74 linii, `popr-P0/log-zgodnosc.txt`), `node --test` pilnuje ich przez krótkie biegi, stąd poprawiony wiersz P0 w § 12. Czas: biegi w 3 wątkach, 14,2 s ściany i 41,5 s procesora przy obciążeniu 23% (`popr-P0/log-test-cpu-wynik.txt`); przy maszynie zajętej przez inne sesje do około 5 minut (`popr-P0/log-mutacje-czesc2a.txt`), więc limit awaryjny to 20 minut.
- **Mutacje testu, zm. `popr-P0/log-mutacje-koniec.txt`.** 68 mutacji w kopiach bez `.tmp/`: wywraca 66, bazowa przechodzi. Lista sprawdzianu (33) cała złapana; parametry P1–P9 wywracają też same biegi, nie tylko porównanie stałych (`popr-P0/log-mutacje-czesc1.txt`). Nowe: każde pole migawki z osobna, NaN, `liczEtyk`, obca budowa, gałęzie kF (lepkość, grunt, szkoda od kontaktu, szok, rozlew, kruszenie, zginanie, wypiek, waga, fala, para, tarcie), `skalaG`, odśrodkowa, punkt, rytm listy, wiązanie wyłączające kontakt, `rozerwij`, `usun`. **Niezłapane 2: `rozcHard` i `sciskHard`.** Nie działają na parametrach końcowych, bo mięknięcie D ≥ 1 zrywa wcześniej (pokrycie i skan: `spr-P0/log-pokrycie.txt`, `log-skan-S1.txt`, `log-skan-S3.txt`). Błąd GPU w tych dwóch gałęziach nie zmieni wyniku, dopóki parametry są te same: w P1 nie szukać wykrycia tych mutacji. Limit `vMax` = 4000 nie działa w krótkich biegach testu, więc pilnuje go osobny mały test kI; poza nimi zm. v w wybranych chwilach do około 900 j./s (`spr-P0/log-S1.txt`, `log-S2.txt`, `log-S3.txt`), swobodny spadek S4 2610 j./s przy t = 6 (`popr-P0/log-s3-kontakt.txt`).
- **`porownajPodkrok` a NaN, zm. `popr-P0/log-spr-migawek.txt`.** Dawniej `NaN > prog` to fałsz, więc cała tablica `acc` = NaN dawała `zaliczony: true`. NaN liczy się teraz jak nieskończoność, nowy licznik `nan`, NaN oblewa także w F0, choć same różnice F0 dalej są poza zaliczeniem (§ 8). Na migawkach z pliku: `acc`, S, A, L, D, F0 = NaN oblewają w każdej z siedmiu. Etykieta: opcja `liczEtyk` wlicza ją do zaliczenia, domyślnie wyłączona, § 8 bez zmian. Zm. S1 t = 3,5, wszystkie etykiety 0: 13 948 różnych, z opcją `false`, bez niej `true`. Czy test GPU ma ją włączać w scenach z `capEtyk > 0`, rozstrzyga P1. Błąd etykiety bez tej opcji wyjdzie dopiero w progach chaotycznych.
- **Migawka a budowa i dalszy bieg, zm. `popr-P0/log-spr-migawek.txt`.** Nagłówek ma `budowa`: n, gProj, `capEtyk`, `nKom`, K i skrót FNV-1a po Ft, L, F0, masce (`budowaMigawki`, bez `node:crypto`, więc też na stronie). `wgraj` rzuca błąd przy innej budowie albo braku opisu; test GPU woła `sprawdzBudowe` z nagłówka. Zm. S3 przy gProj 400 w budowie przy 260 (to samo n i ziarno): „gProj = 400, a scena ma 260”. Test porównuje klon po `wgraj` + kLista + kF z tym samym przebiegiem na oryginale, a nie klon z klonem, w każdym z 10 biegów, więc brak dowolnego pola na liście wywraca go (`M1`, `M2`, `M6`–`M12`). Pola A i etykieta tylko na żywych węzłach: martwy zostaje przy wartości z bufora, który akurat jest z przodu.
- **Otwarte z wiersza P0: ocena sekwencji S1 przez agenta bez kontekstu.** Pliki są w `sekwencja-S1/` (30 klatek, arkusz), oceny dalej nie ma. Pakiet poprawek nie mógł jej wykonać, bo agent z tym kontekstem nie jest już agentem bez kontekstu. Do zlecenia przed startem P1, pytanie o migotanie, wynik tutaj.

### 1.7 Domknięcie P1: solver na GPU

Kod: `dema/woksele-zawalenia/{solver,glowny,testGpu,wzorzecF32}.js`, `dema/woksele-zawalenia.html`, `scripts/webgpu/woksele-demo.mjs`, `tests/wokseleWgsl.test.mjs`. Liczby z 2026-11-05, RTX 5080 (Blackwell, D3D12, sterownik 32.0.16.1714), headless Chrome z `--enable-webgpu-developer-features`, w tle, bez procesów obcych. Logi: `.tmp/woksele-demo/P1/log-koniec.txt`, `podkrok.txt`, `mutacje.txt`, `W1.json`, `raport.json`, `.tmp/woksele-demo/G1.txt`.

- **Karta, zm. `P1/log-sonda-karty.txt`.** Chrome na Windows ignoruje `powerPreference`: `high-performance` i `low-power` dają ten sam adapter, domyślnie NVIDIA. `--force_low_power_gpu` daje naprawdę AMD Radeon (rdna-2). Harness czyta `device.adapterInfo` urządzenia renderera zaraz po `init`, zapisuje przy każdym wyniku i odmawia: `P1/log-proba-amd.txt`, kod 4 na AMD. Czekanie na grę w toku sprawdzone atrapą procesu `G1R-Win64-Shipping`: `P1/log-proba-gra.txt`.
- **Test jednego podkroku, zm. `P1/podkrok.txt`, 7 migawek × 3 przebiegi.** Maski 0 różnic, S, A, D 0 różnych, NaN 0, asymetrii masek 0 w każdym z 21 przebiegów. Względem Node f64 |Δa| maks. 2,92 (S1 t = 3,5), 1,00 (S1 t = 5), 1,54, 1,59, 2,18 (S3), 3,69 (S4). Wynik f64 zalicza wprost 18 z 21. Zostały 3 przebiegi S2 t = 3: jedno wiązanie, patrz niżej. Względem Node w f32 zalicza 21 z 21, |Δa| maks. 0,25. Etykieta: `liczEtyk` włączone w scenach z `capEtyk > 0` (S1, S2, S3), 0 różnych; to domyka pytanie z § 1.6. S4 ma 14 942 różnych etykiet (60 000 w Node, 0 na GPU), bez skutku i poza zaliczeniem, § 1.6.
- **Błąd w specyfikacji, poprawiony: migawka w f64 nie jest osiągalna dla żadnego kernela f32.** § 8 opierał progi na próbie f32 kontra f64 tylko przy S1 (`krytyk-wiernosc/krok1.mjs`). W S2 t = 3 wiązanie 4744–4762 ma w f64 |ft|/lim = 1,0000023 (5505,508 przy limicie 5505,495), więc Node robi wypiek. W f32 `r` wychodzi 28,3768349 zamiast 28,3768357, siła 5505,484 i wypieku nie ma. Skutek: L i F0 w 2 wpisach, |Δa| 22,27 w 2 węzłach. Nie wynika to z portu: `wzorzecF32.js` (każde działanie przez `Math.fround`, kolejność kernela, bez GPU) daje względem f64 te same 2 wpisy i te same 22,27. Tego się nie usunie bez arytmetyki podwójnej precyzji w kernelu, a fizycznie nic nie znaczy. Progi § 8 bez zmian, doszedł wzorzec rozstrzygający, § 8. Każda inna różnica dalej oblewa.
- **Błąd three r183, nowa pułapka.** `UniformsGroup.updateVector4` porównuje `a[offset + 4]` zamiast `a[offset + 3]`, więc zmiana samego `w` przepada, gdy następne pole bufora równa się nowemu `w`. `uniform(new Vector4())` ma domyślnie w = 1, a `set(0, 0, 0, 0)` nie dochodziło do GPU: każdy węzeł dostawał odśrodkową i Coriolisa przy ω = 1 oraz siłę 1 ku zeru, |Δa| do 756. Maski, S, A, L, D były zgodne, więc złapało to tylko porównanie przyspieszeń. Stąd § 10.4 bez uniformów vec4. Do reguły `webgpu-tsl` przy P8, § 9.
- **Słowo sąsiada.** Bity 24–31 to teraz klasa + 1, § 2.2. Klasa 0 (strop) dawała denormal f32, a sąsiad jedzie przez odczyt f32 i `bitcast`. Zapobiegawczo, bez pomiaru, czy sterownik by to spłaszczył.
- **Mutacje, zm. `P1/mutacje.txt`.** 10 mutacji z § 8 na GPU przez uniformy i dane, ten sam kernel: każda wykryta we wszystkich migawkach, w których wykrywa ją Node. Liczby różnic jak w nagłówkach migawek, np. bez fali A 5308 / 5308, bez `falaPeka` maski 32 / 32 i 55 / 55, bez pary |Δa| p99 597 / 597. Dodatkowo „wykryte tylko na GPU” 2 razy: to ta sama para wpisów S2 t = 3 przy mutacjach, które w S2 t = 3 nic nie zmieniają w Node.
- **Źródła grawitacji, zm. `P1/log-koniec.txt`.** Gałęzie [G], których migawki P0 nie ruszają: obrót, punkt, rampa skali 0,5 na gruncie z kotwicami. Stan z `WzorzecCpu` liczonego na stronie, ten sam jeden podkrok, te same progi: maski, S, A, L, D 0 różnych, |Δa| maks. 3,33 / 2,99 / 0,30. Kernel nie zna tu innej ścieżki niż S4, różnią się tylko uniformy.
- **W1, zm. `P1/W1.json`.** 60 s, 3600 kroków w 1,6 s ściany: przemieszczenie przy końcu 0,0108 j. (Node f32 z § 8 też 0,0108), 0 zerwań, 0 NaN, asymetrie 0, maks. D i S równe 0. R5 w tej części zamknięte.
- **kI, zm. `P1/log-koniec.txt`.** |v| = 5000 przycięte do 4000,00, droga 5,000 j. na podkrok, kotwica i martwy węzeł stoją. Limit z § 1.6 jest więc pilnowany osobno.
- **Pipeline'y.** Dziennik po rozgrzewce 10 wpisów (5 kerneli i 5 budów), po wszystkich przebiegach na tej samej stronie 0 nowych.
- **Punkt G1, zm. `.tmp/woksele-demo/G1.txt`.** ms/krok (8 podkroków, lista co 4, 22 dispatche w jednym passie), średnia z 60 kroków:

  | Stan | Fizyka, lista | kF / kI / kLista (`?profil=1`, tylko proporcje) | Kontakty |
  |---|---|---|---|
  | S3 cały | 0,354 | 0,192 / 0,030 / 0,206 | 8856 |
  | S3 t = 0,8 | 0,359 | 0,199 / 0,029 / 0,206 | 12 700 |
  | S3 t = 2,95 | 0,414 | 0,207 / 0,027 / 0,225 | 32 862 |
  | S1 cały | 0,293 | 0,164 / 0,025 / 0,145 | 0 |
  | S1 t = 3,5 | 0,391 | 0,212 / 0,025 / 0,189 | 54 856 |
  | S1 t = 5 | 0,437 | 0,220 / 0,025 / 0,216 | 92 106 |

  Warunek porażki 1 nie zachodzi: S3 najwyżej 0,414 wobec progu 8 ms. To około 5–10 razy poniżej szacunku z § 6.1, a kontrola ścianą to potwierdza: W1 liczy 0,446 ms/krok razem z kodowaniem, kolejką i odczytami. Lista nie jest problemem, a R6 w części „kF przy 15 tys.” zamknięte: kF 0,11–0,38 ns na wizytę wiązania. Kroki idą bez zdarzeń. Nie zmierzone: `kObraz`, rysunek, pył, cała klatka, więc Z4 dalej otwarte, a kolejne pakiety mogą to przesunąć tylko o swoje kernele.
- **kWstaw to wyścig.** Przy przepełnionej komórce GPU odrzuca inne wstawienia niż Node. Zm. S2 t = 3: 6 odrzuconych w Node, lista różna w 1–7 węzłach, S3 t = 0,8: 2 odrzucone, różna w 5–7 (w `P1/log-bieg2.txt` też 13), a siła bez zmian w tych przebiegach, bo odrzucone węzły nie były w styku. Inny przebieg albo sterownik może odrzucić węzeł w styku i wtedy |Δa| przejdzie próg, wiersz „odrzucone wstawienia” w § 8 sprawdzi to w P2.
- **Niezrobione w P1, zgodnie z § 12.** Zdarzenia, licznik `wLicz`, `grupaTab`, obraz, `budowa.worker.js` (na razie budowa na stronie), `kZerujPelne` (reset i tak wgrywa bufor z CPU). `tests/wokseleWgsl.test.mjs` nie sprawdza `round`, bo żaden kernel P1 go nie wymaga: wiersz o `kWybuchSuma` przyjdzie w P2. Kolejność gałęzi kF pilnuje test GPU, nie test WGSL (zm. `P1/log-mutacje-testu.txt`: 14 z 15 mutacji solvera łapie test WGSL, a przestawienia gałęzi nie).

### 1.8 Domknięcie P2: zdarzenia i pęd na GPU

Kod: `solver.js` (kCzas, kCzysc, kCzyscS, kZerujCel, kCel, kKraterCel, kKrater, kZerujWybuch, kWybuchSuma, kWybuchMoment, kWybuch, `ustawPlan`, `strzel`), `scena.js` (`planGpu`), `testGpu.js`. Liczby z 2026-11-05, RTX 5080, stan z budowy, nie z migawki. Tabela: `.tmp/woksele-demo/P2/tabela-P2.txt`, `P2/dodatki/tabela-P2.txt`, dziennik: `P2/log-koncowy.txt`. Polecenie: `node scripts/webgpu/woksele-demo.mjs --testy sceny,strzal,kratery`. Całość liczy się w minutę.

| Wielkość | Node | GPU | Próg § 8 |
|---|---|---|---|
| S1 dach, t = 3…7 | 1295, 1047, 582, 217, 174 | 1295, 1047, 601, 222, 181 | ± 80 |
| S1 przechył spójny | 4,2° | 4,3° (inne biegi tej samej sceny: 4,3 i 4,6°) | ≤ 8° |
| S1 masa 8–63, pojedyncze | 58%, 12% | 56,2%, 11,6% | ≥ 45%, ≤ 20% |
| S2 dach, t = 3…6, przechył | 1216, 1029, 545, 234, 2,8° | 1217, 1029, 564, 250, 2,5° | ± 80, ± 130, ≤ 8° |
| S3 v / swobodna, otwór | 0,87, 2,62 | 0,87, 2,61 (inne biegi: 2,60 i 2,67) | ≥ 0,8, 1,2–4 |
| S3 poza środkiem, ośmiokąt: otwór | 2,77, 2,05 | 2,77, 2,06 | 1,2–4 |
| S4 v góry, dołu | +37,5, −34,1 | +37,5, −34,2 | § 8 |
| S4 obrót góry, dołu | 4,8, 3,3°/s | 4,8, 3,3°/s | 2–7°/s |
| S4 największe kawałki | 92,6%, 99,5% | 92,6%, 99,5% | ≥ 85% |
| S4 \|P\|/N, \|L\| do połowy | 0,0000, 0,2% | 0,0001 j./s, 0,21% | ≤ 0,05, ≤ 2% |
| S4 przy g = 400 (S6): masa 8–63, przechył góry t = 5,5 | 53,6%, 10,6° | 53,7%, 10,0° | ≥ 40%, ≤ 14° |
| Równoważność, mediana | 0,25 j. | 0,21 j. | ≤ 2 j. |
| Krater w próżni r = 60, 90: największy kawałek | 99,7–99,9%, 98,5–99,7% | 99,8%, 99,2% | |
| Krater r = 60 przy g = 400, 6 miejsc; kolumna; narożnik: dach | stoi, 1309–1310 | 1307–1310; 1309; 1310 | ≥ 1290 |
| Rampa g 400 → 0, v_max | 0,07 j./s | 0,05 j./s | ≤ 1 |

Wszystkie wiersze tabeli § 8 zaliczone, także W1 (0,0108 j., 0 zerwań, NaN i asymetrii 0 we wszystkich scenach), a odrzucone wstawienia tylko z próbki co 15 klatek. **Warunek porażki 2 nie zachodzi**, poprawek fizyki nie było: wynik wyszedł za pierwszym biegiem. Ściana S3 bez odczytów: 192 ms na 300 kroków, 0,64 ms/krok z kolejką (drugi bieg przy pracy innej sesji na tym samym GPU: 1,44), więc zdarzenia nic nie zepsuły. Pipeline'y po rozgrzewce: 32 wpisy, nowe 0, synchroniczne 0.

- **Strzał, zm. `P2/strzal.json`.** Pudło: nic się nie zmienia, slot zgaszony. Trafienie: pierwsza klatka v 14,4 j./s przy miejscu trafienia, daleko 0,000. Po 5 s największy kawałek 99,6%, reszta budynku stoi, |P|/N 0,0000, co zgadza się z decyzją § 12 o strzale w próżni. Strzał w czasie planu pchnięć S4: v przy trafieniu 88 j./s wobec 21 j./s bez strzału, |P|/N 0,0035.
- **Wiele kraterów, zm. `P2/kratery/raport.json`.** Plan na wzór sceny z szwami: nosiciel, S = 3 przez bit pasa, bez korekcji momentu, martwy nosiciel, 5 rzędów na klatkę, usuwanie kotwic w kuli. Wzorcem `WzorzecCpu` z logiką zdarzeń z `proby5/final/scena5.mjs`, 14 klatek: 0 różnych żywych, 0 różnych masek w próżni i przy g = 400, |Δv| p99 0,053 i 0,066 j./s. Nowa scena wchodzi przez dane `kratery`, `bitPas`, bez nowych buforów. Różnica wobec Node, celowa: dwa kratery w tej samej klatce, gdy nosiciel drugiego ginie w pierwszym: Node pomija drugi, GPU go wykonuje.
- **Poprawki sprawdzianu P1.** F0 w `zaliczony` z regułą f32. `krokZWzorcem`: 8 kroków, 0 masek na S1 t = 3,5, S3 t = 2,95, S4 t = 3, lista różna tylko na granicy zasięgu (poza nią 0). Bez progu S2 t = 3: 2 maski po 8 krokach, ta sama para przy progu f32 co w § 1.7. S = 24, § 2.7: podkrok 6 migawek, lista 0 różnic, 5 zalicza wprost, 1 przez regułę f32.
- **Czego brakuje.** Licznik odrzuconych wstawień w `wLicz`: tabela liczy z pozycji co 15 klatek (S1–S4 0; S4 przy g = 400: 3, czyli maks. 23 w komórce to nie jest twardy sufit). `kPrzyczyna`, emisja pyłu, głowice pierścieni: P4. `?profil=1` woła kernele z pominięciem `krok`, więc bez zdarzeń: P6 (`zdarzeniaKlatki`, `nastawKlatke`). `scripts/woksele-sym.mjs` przy S = 24: `--zgodnosc` i migawki wymagają `parametry({ slotyKomorki: 16 })`, jeśli mają zgadzać się z logami `proby4`; dziś liczą przy 24, a pliki w `.tmp/woksele-demo/migawki/` są z S = 16.

### 1.9 Domknięcie P3: obraz bez pyłu i strona na żywo

Kod: `dema/woksele-zawalenia/{obraz,pokaz,scenyPokazu,budowa.worker}.js`, `dema/woksele-zawalenia.html`, `tests/wokseleObrazWgsl.test.mjs`, opcje `--zrzut`, `--chwile`, `--kam`, `--rozmiar`, `--pomiar`, `--interakcje`, `--base` w `scripts/webgpu/woksele-demo.mjs`. Zrzuty: `.tmp/woksele-demo/P3/`. Tryby `?test=1` i `?profil=1` bez obrazu, jak w P1 (zm. `P3/log3.txt`: W1 i pipeline'y bez zmian).

**Wzorcem był film, nie ten rozdział.** S1 Bliska t = 3,5 wychodzi prawie kropka w kropkę jak `film/klatki/S1_blisko/k00210.jpg`. Różnice wobec § 4 z powodu filmu:
- `MeshLambertNodeMaterial` zamiast Standard z metalem: wzór `rys4.mjs` to Lambert plus półkula, a bez mapy otoczenia metal jest czarny. Słońce (1,05; 1; 0,92) · π, półkula (0,35; 0,375; 0,425) · π i (0,07; 0,075; 0,085) · π, ekspozycja 1,25, ACES Narkowicza, gamma 2,2.
- **Okluzja domyślnie jak w filmie, nie GTAO:** 16 próbek w dwóch promieniach, 14 j. w px, okno głębi 2–60 j., obiekt z głębi około 720 wierszy (najwyżej 2560 szerokości). GTAO działa pod `?ao=gtao`, z rozgrzewką, ale szczeliny wychodzą jaśniejsze (`P3/gtao_S1_t5.00.png` kontra `c_S1_t5.00.png`). Decyzja należy do oceny użytkownika.
- W cieniu sloty bloków i wszystkie odłamki, bez prętów (spec: tylko slot 1), bo film rzuca cień każdą bryłą. Koszt niewidoczny w pomiarze niżej.
- Pręt ciemniejszy niż w spec: barwa (0,2; 0,15; 0,12) na Zbliżeniu świeci łososiowo.
- Rysy z izolinii szumu odrzucone: robaki na całym pokładzie (`P3/f_S3_t3.00.png`). Zostały plamy i drobne ziarno w fragmencie z pozycji początkowej.

Dodane poza filmem: wieniec dysku dociągnięty do promienia z normalną promieniową, normalna bloku z osi w płaszczyźnie ściany (znika kratka na nienaruszonym pokładzie), wieniec w barwie pokładu (ciemna kotwica rysowała zygzak), kawałki z brzegu otworu dysku z płaszczyzną pokładu w `kGruz`, 4% zakładki na dysku. Budowa scen w wątku roboczym, sceny budują się w tle po starcie.

**Liczby, zm.:** RTX 5080, headless, 5120 × 1440, MSAA 4, S1 i S3 przy t = 4,5. Pętla zamknięta bez rAF: rysunek 3,5–3,7 ms, a samo czekanie `onSubmittedWorkDone` ma podłogę około 3 ms, więc klatka mieści się poniżej 4 ms; to górna granica, nie czas GPU. Znaczniki czasu dają 0,0075 ms na `kObraz` + `kGruz` i 1,0–1,3 ms na rysunek, ale nie są pewne: pula three przy kilku kontekstach zostawia wpis ostatniego, dokładny pomiar to P6. W pętli rAF bez VSync 460–550 kl/s i 60,2 / 59,8 kroku/s; kolejka GPU rośnie wtedy do około 430 ms opóźnienia, więc liczba klatek na sekundę nic nie mówi o koszcie i liczyć trzeba tylko w takcie. Pipeline'y: 18 synchronicznych przed pierwszą klatką, wszystkie compute (three nie ma ich wersji w tle), rysunków 0; po przejściu sześciu scen, resetach, zmianie rozmiaru okna nowych wpisów 0. Hałda przy t = 8 między dwiema klatkami: 1,16% pikseli zmienia się o ponad 8/255, film 0,91%. Interakcje przez CDP (`P3/log-koniec.txt`): orbita, przybliżenie, przesuw, spacja, R, P, tempo, scena, zmiana okna zaliczone.

**Czego nie ma:** pyłu i przyczyny (P4). Strzału myszą, klawiszy scen, kamer na panelu i przełącznika Miejsce (P5). Punktu K1: wiersze § 7 nie przeszły przez agenta bez kontekstu, a ruch oceniony jest tylko liczbą wyżej, oczami nikt go nie widział. Gwiazd w próżni i ciemnej płyty pod dyskiem nie ma, bo nie ma ich w filmie. Przejście na „sam” bez kurczenia przez 0,15 s: rama przechodzi ciągle, ale podmiana kształtu jest skokowa. Prawdziwe okno Chrome nie było uruchamiane, tylko headless.

### 1.10 Domknięcie zszycia P2 i P3: pokaz ze zdarzeniami

Strona `dema/woksele-zawalenia.html` liczy i rysuje sceny ze zdarzeniami solvera. Panel ma 12 scen: S1, S2, S3, S4 próżnia, S4 przy g = 400, Krater, Odporność, Kolumna, Narożnik, Krater r = 90 w próżni, S3 poza środkiem, S3 ośmiokąt. Przejście wszystkich przycisków z resetem i żywą pętlą rAF: 0 nowych wpisów w dzienniku pipeline'ów, 0 synchronicznych po rozgrzewce. Zrzuty 1920 × 1080: `.tmp/woksele-demo/pokaz1/`, narzędzie `woksele-demo.mjs --zrzut 1 --plan "S1:0,3,5,6;…" --przyciski 1`.

Koszt całej klatki (zdarzenia, krok, obraz, rysunek), S1 przy t = 4,75–5,5, 5120 × 1440, MSAA 4, RTX 5080, trzy biegi: GPU 1,44–1,47 ms ze znaczników (compute 0,43–0,45, rysunek 1,01), ściana 2,3–3,8 ms na klatkę z CPU i kolejką. Tylko orientacja: krok w każdej klatce, znaczniki niepewne jak w § 1.9, dokładny pomiar to P6.

**Czego nie ma:** tego, co w § 1.9. Start strony to S1, a § 5.2 mówi o scenie 2: decyzja należy do P5. S3 poza środkiem nie ma gruzu na pokładzie, bo otwór w obrazie jest liczony od środka dysku.

### 1.11 Domknięcie S5: pochylona wieża na GPU

Kod: § 5.5. Trzy przyciski przed starymi scenami, start strony to S5, ziarno 21, `?ziarno=7`. Budowa bajt w bajt z `scena5.mjs` (ziarna 21 i 7, wszystkie tablice i plan, `tests/wokseleS5.test.mjs`), S1, S3, S4 bez zmian bajtowych. W solverze doszło tylko `puscKotwiceF` (`uKotwice = 0` po zdarzeniach klatki), bez nowych kerneli i buforów.

**Wszystkie progi K1–K6 zaliczone za pierwszym biegiem na ziarnach 21 i 7, S5 i S5 próżnia, bez strojenia planu.** Kopy jednoklatkowe w f32 nie przesunęły progów (obawa z propozycji). Tabela: § 8, zapis: `.tmp/woksele-demo/S5/S5-liczby.txt`. Zrzuty S5 i S5 próżnia przy t = 1, 2, 4, 6, 8, 12 oraz S5 planeta przy t = 6, 10: `.tmp/woksele-demo/S5/zrzuty/`. Obok klatek filmu przy t = 2 i t = 8 (S5 i próżnia) ten sam układ kawałków, widać gładszy wieniec. Ruchu nikt jeszcze nie ocenił. Przejście 15 przycisków z resetem i żywą pętlą, interakcje: 0 nowych pipeline'ów, 0 synchronicznych po rozgrzewce.

Koszt, tylko orientacja: S5 planeta od t = 6, 1920 × 1080, znaczniki GPU 1,64 ms (compute 0,44, rysunek 1,20), ściana 3,5 ms. Bieg szedł w czasie startu meczu użytkownika, a znaczniki są niepewne jak w § 1.9.

**Czego nie ma:** pomiaru parametrów znanej słabości (§ 5.5). Pierwsza klatka strony czeka na CG wieży S5, około 8 s w Node przy zajętej maszynie; to raz na stronę, S5 próżnia i planeta biorą statykę z pamięci. Kamer `blisko` i `gora` nie ma na panelu (P5). Wzorca CPU S5 w teście zgodności nie ma: zgodność to bajty budowy i liczby K1–K6.

## 2. Algorytm do TSL compute

### 2.1 Stałe i wzory przy danym dx

`skala = 20/dx`. Demo używa dx = 20, wzory zostają na później.

| Symbol | Wzór | dx = 20 | Linia `model-spec3.mjs` |
|---|---|---|---|
| Podkroki | `round(8·skala)` | 8 | 163 |
| h | `1/60/podkroki` | 1/480 s | 166 |
| K | `(c/dx)²/3·sM`, c = 6000, `sM = gProj/400` (§ 10.5) | 30 000 przy gProj = 400 | 165 |
| Tłumienie wiązania cB | `2·0,1·√K` | 34,6 | 167 |
| Zginanie kB | `0,1·K` | 3000 | 169 |
| Kontakt kC, cC, cT | `0,8K`; `2·0,35·√(kC/2)`; `cT = cC` | 24 000; 76,7; 76,7 | 170–172 |
| Skala czasu ruchu | `sFr = √(gAkt/400)`: mnoży lepL, lepV, gruzPara, gruzV, fala.v, fala.tempo | 1 przy g = 400, 0 przy g = 0 | 158 |
| Tempo fali na podkrok | `tempoH = min(1, tempo·h)` z `h` po skali (Node liczy z `p.podkroki`, przy dx ≠ 20 poprawić na `this.h`, inaczej fala biegnie za szybko) | 9/480 | 110 |
| Długości mięknięcia | `iT = 1/(dT·dx·skala)`, `iC = 1/(dC·dx·skala)` | stałe w jednostkach gry | 540–541 |
| Próg zginania | `bMax² = (zlom·dx·sM/skala)²` | zlom 0,25: 5 j.; dysk 0,12: 2,4 j. | 211 |
| Rozlew | `rozlew^(1/skala)` | bez zmian | 207 |
| Stabilność | `h·√(12K) = 1,25 < 2` | zapas skromny, podkroków nie wolno zmniejszać | |

Parametry bez klas: `c 6000, podkroki 8, zeta 0,1, beta 0,1, zlomGiecia 0,25, zlomB 2,5, kKontakt 0,8, rKontakt 0,9, rJitter 0,1, zetaKontakt 0,35, mu 0,9, cTarcie 1, muGrunt 0,7, skorKontakt 0,5, M = 32, S = 24 (§ 2.7), vMax 4000, rozcHard 0,5, sciskHard 0,45, szokTempo 1,5, szokWsp 0,5, zapasMin 2,2, zapasDyskPrez 1,25, obwodSlabszy 0,35, dyskRosnieZR 0, dyskSprezenie 0,005, rytmListy 4, kotwicaWzmocnienie 3, kotwicaZasieg 6, plama {4, 0,5}, katWypieku 12°, gruzPara 27 (1/s na kontakt), gruzV 30, lepL 10, lepV 25, lepKotwica, falaRama, froude, froudeProj, kontaktSzokV 120, wagaS 1,5, wagaProg 0,4, fala {v 60, tempo 9, aMax 0,6, prog 0,5, oslab 0,999}, falaPeka {prog 0,25, zakres 0,5}, ziarno 7`. Wyłączone gałęzie, których NIE przenosić: `odprysk`, `sfGrad`, `alfaWezla`, `bK`, `zetaT`, `zetaB`, `slabeZlacze`, `fala.kop`, `sprezenieMartwe = false`, stare zakleszczenie `gruzLambda` (−λ·v, zastąpione parą).

Klasy (nie wszystkie pola są w JSON: reszta to `DOMYSLNE`, linie 28–79):

| Klasa | SF | eMin | rozc | dT | dC | rozrzut | krusz | rozlew | szok | kontaktSzok | kLin | inne |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 strop | 2,8 | 0,0007 | 0,6 | 0,05 | 0,1 | 0,25 | 0,8 | 0,5 | 0,5 | 0,5 | 1 | |
| 1 kolumna | 2,8 | 0,002 | 0,8 | 0,15 | 0,1 | 0,2 | 1,0 | 0,6 | 1,0 | 0,5 | 1 | |
| 2 fasada | 2,8 | 0,001 | 0,8 | 0,15 | 0,1 | 0,3 | 0,8 | 0,5 | 0,5 | 0,5 | 0,02 | |
| 3 rdzeń | 2,8 | 0,002 | 0,6 | 0,08 | 0,1 | 0,25 | 0,8 | 0,5 | 0,5 | 0,5 | 0,5 | |
| 4 dysk | 1 | 0,03 | 1 | 0,05 | 0,1 | 0,35 | 1,2 | 0,82 | 3,0 | 1,0 | 1 | zlom 0,12 |
| 5 kotwica | 1 | 0,2 | 1 | 0,3 | 0,3 | 0 | 0 | 0 | 0,5 | 0 | 1 | |

Ziarna: `strop [7,7,99], dach (dwie najwyższe warstwy stropu) [4,4,99], kolumna [99,99,6], fasada [3,3,6], rdzen [6,6,6], dysk [4,4,99]` (bok komórki Voronoi w węzłach na osiach ijk; przy dx ≠ 20 pomnożyć przez skalę, bo liczą się w węzłach), `wewn 6, granica 0,7, kruszWewn 0, zlomWewn 3, waga 0,5`; dla dysku `wewn 1,5, granica 1, kruszWewn 0,6`.

### 2.2 Bufory

Wszystko w lokalnym układzie budowli (środek podstawy w zerze, z w górę). `MAX = 26 000` węzłów. Liczność sceny to `uN`, używana tylko w warunku wejścia i przy przesunięciu `n + i`. Kernele `.compute(MAX)`, przy zmianie sceny `kernel.setCount(n)` **liczbą**, nie węzłem: `WebGPUBackend.js:1416` obsługuje tylko liczbę, tablicę i atrybut pośredni, `.compute(uN)` dałoby `dispatchWorkgroups` z obiektem. Tworzenie jak w `src/3d/swarm/swarmSim.js`: `instancedArray(count, typ).setName('stała')`.

**Układ scalony, co najwyżej 8 buforów storage na etap** (zm. przez budowę WGSL, `spec-proby/tsl-kernele.mjs --scal --widoki`: kF 7, kLista 7, kObraz 8, kKrater 6, wierzchołek 4). Domyślny limit to 8, RTX 5080 ma 16, a repo trzyma normę ≤ 8 (`tests/swarmTsl`, `hullDamageMap`). Test w `tests/`: liczba `var<storage` w WGSL każdego kernela i materiału ≤ 8. `requiredLimits` nie jest potrzebne.

| Bufor | Typ, rozmiar | Zawartość | Pisze | Czyta |
|---|---|---|---|---|
| `wWez` | vec4 × 3n | [3i]: xyz, w = promień kontaktu rk (**w < 0 = węzeł martwy**); [3i+1]: prędkość; [3i+2]: przyspieszenie | I, kKrater, kCzas, reset; F tylko [3i+2] | F, I, kLista, kObraz, kWybuch*, wierzchołek |
| `wStan` | vec4 × 4n | [i]: S, A, etyk, 0; [n+i]: to samo, nowe; [2n+2i]: bMax², rozlewW, szokW, iN0; [2n+2i+1]: kUd, aLos, jasność koloru, flagi (`u32(x)`: bit 0 stoi, 1 nośny przez kotwicę, 2–4 kind, 5–10 m0 = sześć bitów początkowych osiowych, 11–15 grupa budowli) | F [n+i], I kopia do [i], budowa | F, I, kObraz, wierzchołek |
| `wMaska` | u32 × 2n | [i]: bity 0–17 żywe wiązania; [n+i]: nowe | F, I, kCzysc, kCzas | F, I, kLista, kObraz, wierzchołek |
| `wWiaz` | vec4 × 36n | [36i+2d]: L, D, F0, R0 (własne kopie); [36i+2d+1]: Ft, Fc, sąsiad jako bity f32 (`floatBitsToUint`: 0–23 sąsiad, 24–31 klasa + 1, żeby słowo nigdy nie było denormalem, § 1.7), wolne | F, budowa | F, kObraz (tylko d < 6) |
| `wLista` | u32 × 33n | [33i]: liczba kontaktów, potem do 32 sąsiadów | kLista | F, kObraz (licznik, § 4.3 dopiero przy okluzji z kontaktów) |
| `wIjk` | u32 × n | i 10 bitów, j 10, k 10, grupa 2 | budowa | kLista |
| `wKomLicz` | u32 × nKom | licznik komórki; **trzy węzły na jednym atrybucie**: atomowy w `kWstaw`, `toReadOnly()` w `kLista`, zwykły w `kZerujPo` (wzór `hullDamageMap.tsl.js:105–106`, zm. budowa: atomic 0 poza `kWstaw`) | kZerujPo, kWstaw | kLista |
| `wKomSloty` | u32 × 24·nKom | węzły komórki, § 2.7 | kWstaw | kLista |
| `wTab` | vec4 × 57 | 18 × (n0(d), 0); 12 × (iT, iC, krusz, 0); 27 × LUT kierunku (−1 albo d) | budowa | F, kLista |
| `wCzasU` | f32 × n | klatka zdarzenia: ±(f + 0,5), plus usunięcie, minus rozerwanie; bit 16 flagi w `wStan`: rozerwanie zostawia ziarna (§ 2.8); **1e30 = brak** (literał `Infinity` daje w WGSL `Infinity.0`, zm. `spec-proby/tsl-proby2.mjs`) | budowa, kCzas | kCzas |
| `uKrater` | uniformArray vec4 × 3·4 | do 4 kraterów na klatkę: c.xyz + r²; rdzeń², rS², slot `wBlastK`, nosiciel (≥ 0 węzeł, −1 punkt z rzędu, −2 strzał); usuwa stojące, 0, 0, 0 | CPU | kKraterCel, kKrater |
| `uBlast` | uniformArray vec4 × 2·24 | do 24 pchnięć w klatce, zbite od zera (`uBlastN`): c.xyz + rP; Jk, slot `wBlastK` (−1: środek z rzędu), dz, 0. Uniform, więc bez kasowania cudzych danych | CPU | kWybuchSuma |
| `wBlastK` | vec4 × 32 | środki policzone na GPU, pierścień: c.xyz, w > 0 ważny (martwy nosiciel albo pudło gasi slot) | kKraterCel | kKrater, kWybuchSuma |
| `wRamaWzory` | vec4 × (3n + 2·6·64·L) | [3i]: F0.xyz + d, F1.xyz + φ, F2.xyz + bity emisji (0–5), ao (6–11), dObraz (12–21). Potem wzory: środek.xyz + hX; hY, hZ, objętość, 0 | kObraz, budowa | wierzchołek, kObraz |
| `wCzastki` | vec4 × 2·(CAP_G + CAP_P) | gruz i pył, pierścienie, § 4.5–4.6 | kObraz, kKrater, kCzas, kGruz, kPyl | wierzchołek |
| `wLicz` | atomic u32 × 20 | [0, 1] głowice pierścieni, [2] cel strzału; [3..5] suma kopów, [6] liczba trafionych, [7..9] suma pozycji, [10..12] moment, [13..18] tensor, [19] największe \|q\| zbioru | kObraz, kCel, kWybuch*, kZerujWybuch | jw. |
| `grupaTab` | vec4 × 8 | grupa budowli: bit uśpienia, K, skala F0, cap. W demie jeden wpis, § 6.3 | CPU | w grze: F, I, kLista, kObraz |

`toReadOnly()` na wszystkim, co kernel tylko czyta: `wTab`, `wIjk`, `wKomSloty` (w kLista), a w kObraz i wierzchołku także `wWez`, `wStan`, `wMaska`. Bez tego WGSL dostaje `read_write` (zm. `tsl-wgsl/kF.wgsl`).

`nKom = 65 536` przy każdej scenie (zm. S3: metryki identyczne z 131 072, `proby4/log-K65.txt`, S3 poza środkiem nie, § 1.6; S2: 32 768 też bez pominiętych wstawień, kandydaci +6–12%, `krytyk-gpu/komorki.mjs`). Pamięć: 21 MB węzły przy MAX, 2,1 MB siatki, pule 2,6 MB, razem **szac. 26 MB**, plus cele renderu: 4 × 7,37 Mpx × 12 B = 354 MB przy 5120 × 1440 z MSAA 4, cień 4096² 67 MB (rachunek). Kopie CPU: `oddajKopieCpu` (`tsl/kopiaCpu.js`) na `wWez`, `wLista`, `wKomSloty`, `wCzastki`, `wRamaWzory`.

Uniformy źródła i ramy (bez nowych pipeline'ów przy zmianie sceny) są w § 10.4.

Różnice wobec Node, celowe:
- R0 w czwartym polu `wWiaz` (CPU: osobna tablica). Długość mięknięcia i klasa z `wTab`, więc nie ma tablic `iT`, `iC`, `klasaW` per wiązanie.
- Podwójne bufory przez przesunięcie `n` i kopię w I, bez wymiany wiązań (dwa pipeline'y i osobne bind groupy na kierunek nie są warte tej kopii).
- `aktywny[]` zastąpione przez `wWez[3i].w < 0`: bez dodatkowego odczytu, bo pozycję sąsiada i tak się czyta.
- `m0` to sześć bitów flag zamiast osobnej tablicy (Node: `maska0Os` w `obraz4.mjs`).

### 2.3 Budowa (CPU, wątek roboczy, raz na scenę)

Pliki: `dema/woksele-zawalenia/budowa.js` (bez three i DOM, testowalny w Node) wołany z `budowa.worker.js`. Zm. czas: 2,3 s dla wieży bez obciążenia PC, 3,3 s przy obciążeniu, S3 1,3–2,6 s; to prawie w całości CG (`msInit`, `*_podsumowanie.json`). 1770 iteracji wieży, 5157 pocisku. Kroki:

1. Geometria: port `wspolne/scena.mjs` (`wieza`, `dysk`, `polacz`, `obroc`).
2. Sąsiedzi: 18 kierunków, pary (d, d^1) przeciwne, pierwsze 6 osiowe, tylko w grupie. Linie 233–267. `iN0 = 1/popcnt(maska)`.
3. Statyka PROJEKTU: CG bez macierzy z preconditionerem Jacobiego, Float64, `tol 1e-8`, `reg 1e-9·K` (przy 1e-6 wieża powoli siada). Ładunek = `gProj·kierunek` (scena, domyślnie 400 w dół), dolna warstwa zamrożona zawsze, także dla budynku bez kotwic: to podpora PROJEKTOWA, nie rzeczywista. `kLin` kieruje drogę obciążenia. Linie 272–356. Wynik: `f0 = kl·n0·(u_j − u_i)`. Ładunek zerowy zwraca zera (w starym kodzie 0/0 = NaN, § 10.2).
4. Sprężenie to reakcja na obciążenie RZECZYWISTE: wieża z kotwicami: `F0 = f0·gAkt/gProj` (ten sam kierunek: statyka liniowa, bez drugiego CG; inny kształt pola, np. punkt albo przechył: drugi CG z polem rzeczywistym), `L = R0`, dolna warstwa `stoi`. Wieża bez kotwic (spadająca albo w próżni): `F0 = 0`, `f0` tylko do wytrzymałości. Linie 358–405.
5. Dysk: `bezG`, kotwice `stoi`, etykieta BFS od kotwic, `cap = ceil(1,5·max) + 8` (przy dx = 20: 31 → 55). Linie 403–433. Ta sama etykieta dla wieży z kotwicami (BFS od dolnej warstwy, linie 434–454), `cap` wspólny; bez kotwic wszystkie węzły zaczynają od `cap`, czyli lepkość spoczynkowa nigdy nie działa.
6. Ziarna: Voronoi ważony na komórkach ijk (`_ziarna`, linie 560–586), przy budowie, więc obrót budynku nic nie zmienia. Hash `(a, b, c, kind·17 + grupa·131 + ziarno)`. Płyta dachu: dwie najwyższe warstwy stropu dostają skalę `dach`.
7. Wytrzymałości, każda para raz, kopie na obu końcach (linie 479–547), **losowanie w tej samej kolejności co w Node** (linie 202, 460–491, 579, 708), bo o przechyle wieży decyduje budowa, nie wyścig na GPU (zm. `krytyk-wiernosc/log-T1…T3`: ziarno 7 w f32 i z losową kolejnością siatki: 3,8–4,9°; inne ziarna: 8–15°). Test: budowa bajt w bajt z `model-spec4`, § 9.
   `baza = max(|f0|, eMin·K·dx·(kl ≤ 3 ? sM : 1))`; `s = (1 ± rozrzut)·pl`; `pl = 1 + 0,5·(2·szum − 1)`, szum wartości, plama 4·dx·skala; `fc = SF·baza·s·mZ`; `ft = fc·rozc`; `mZ = wewn` w ziarnie, inaczej `granica`; `ft ≥ zapasMin·f0` dla f0 > 0, `fc ≥ zapasMin·(−f0)` dla f0 < 0. Klasa pary: linia 82.
8. Dysk (linie 507–535): sprężenie pokładów (warstwa górna i dolna, wiązania poziome): `L = R0·(1 − 0,005)`, `ft ≥ 1,25·K·R0·0,005`; `rs = 1 + 3·exp(−et/(6·skala))`; wiązania obwodowe słabsze o 0,35 (`an`). **Uwaga: `obwodSlabszy` zna środek dysku (sędzia-fizyk). Przy uderzeniu poza środkiem zm. otwór 2,60: akceptowalne.**
9. `bMax²` węzła ×9, gdy wszyscy osiowi sąsiedzi w tym samym ziarnie (linie 548–555).
10. `rk = 0,5·dx·0,9·(1 ± 0,1)`, zasięg listy `2·rMax + 10 = 29,8` przy dx = 20 (linie 705–734).
11. Pakowanie do tablic z § 2.2 i przekazanie do strony (transfer). Cache w pamięci per scena: reset i powrót na scenę bez nowego liczenia, po pierwszej scenie w tle liczą się pozostałe.

Przesunięcia ponad 15 tys. węzłów albo budynek większy niż 1500 j.: CG 3–5 s, wtedy dopiero rozważyć wypiek do pliku. **Nie dzielić CG na GPU w tej wersji.**

### 2.4 Kolejność dispatchy

Listy `renderer.compute` zbudowane raz, bez alokacji w kodzie dema (three alokuje deskryptor pass i encoder na wywołanie, `WebGPUBackend.js:1346–1360`, więc najwyżej 3 listy na krok poza trybem `?profil=1`):

```
LZd  kCzas, [kZerujCel, kCel: strzał], [kKraterCel, kKrater: krater], kCzysc, kCzyscS  zdarzenia, § 2.8
LWb  kZerujWybuch, kWybuchSuma, [kWybuchMoment: zerujL], kWybuch                       tylko w klatkach z aktywnym pchnięciem
LF   s = 0: kWstaw, kLista, kZerujPo, kF, kI
     s = 1..3: kF, kI
     s = 4: kWstaw, kLista, kZerujPo, kF, kI
     s = 5..7: kF, kI
LO   kObraz, kGruz, kPyl, kPrzyczyna                                                  obraz, raz na krok fizyki
```

Razem 22 dispatche fizyki plus 3–5 zdarzeń, 4 pchnięcia w jego klatkach, 4 obrazu. Stały rytm listy co 4 podkroki zamiast adaptacyjnego wyzwalacza (linia 816). Sprawdzone: `log4-R1.txt`, `R2`, `R3`: **dysk przesuwa próg sprężenia**: 0,7% z rytmem 4 daje otwór 3,72 (bez rytmu 1,84). Końcowe sprężenie to 0,5% (R3).

`kZerujPo` idzie PO `kLista`: zeruje komórki z tych samych pozycji, bo `kI` jeszcze ich nie ruszył. To 29 884 zapisów na klatkę zamiast 262 144 (rachunek, `krytyk-gpu/koszt.mjs`). Pełne zerowanie kernelem tylko przy resecie.

Bariery między dispatchami zapewnia WebGPU. Atomiki: `kWstaw` (add), `kObraz`, `kKrater`, `kCzas` (add na głowicach), `kCel` (min), `kWybuch*` (add sum). `kLista` i `kZerujPo` bez atomików. Zm. na klatkę w poprzednim układzie: 787 tys.–1,12 mln `atomicLoad`, koszt nieznany (`spec-proby/tsl-liczniki.mjs`).

Grupa robocza 64. `compute(count)` wysyła `ceil(count/64)` grup, więc **każdy kernel po węzłach zaczyna się od `If(instanceIndex.greaterThanEqual(uN), () => Return())`**. Wyjątek: pełne zerowanie siatki przy resecie ma własny licznik nKom i tej osłony nie ma (inaczej liczniki rosną do 16 i komórka odrzuca wszystko).

### 2.5 Kernel F (per węzeł i)

Czyta wyłącznie stan sprzed przebiegu, pisze tylko swoje: `wWiaz[36i+2d]`, `wWez[3i+2]`, `wStan[n+i]`, `wMaska[n+i]`. Numery linii: `model-spec3.mjs`. Uniformy `u*`: § 10.4. Z grawitacją wiążą się wyłącznie wiersze oznaczone [G], sam materiał (siły wiązań, zginanie, kontakt normalny, szkoda) jej nie zna. Rozerwania i śmierci sąsiadów nie ma w tym kernelu: robi je `kCzysc`, § 2.8.

```
823 wejście
852 martwy (wWez[3i].w < 0): wMaska[n+i] = 0, wStan[n+i].S = 1, koniec
    stoi = bit flagi · uKotwice
    mI = wMaska[i]; mNowa = mI; eMin = 65535; szI = S[i]; szSas = 0; aSas = 0; svx..sn = 0

dla d = 0..17, jeśli bit d w mI:                                   (linie 869–960)
    w2 = wWiaz[36i+2d+1]; nb = floatBitsToUint(w2.z); j = nb & 0xFFFFFF; kl = (nb >> 24) − 1
    pj = wWez[3j]
    dX = pj.xyz − xi; r = max(długość, 1e−4); n = dX / r           (GPU: r ≥ 1e−4, CPU bez ochrony)
    Lb = L; f = K·(r − Lb); dmg = D; kap = 1 − dmg; f0b = F0·uSkF0  [G: sprężenie jedzie z grawitacją, § 10.5]
    szJ = S[j]; szSas = max(szSas, szJ); aSas = max(aSas, A[j])
    FALA ŁAMIE [G przez ramę: A = 0 bez ramy]: jeśli kl < 4 (granica ziaren wieży): aB = max(A[i], A[j]); jeśli aB > 0,25:
        hB = hash(min(i,j), max(i,j)); jeśli aB > 0,25 + 0,5·(hB % 1024)/1023: wyczyść bit d, następne   (te same dane na obu końcach: zerwanie symetryczne, wzór `lataj4.mjs`)
889 kr = krusz[kl]: jeśli kr > 0: kap *= max(0,03; 1 − kr·max(szI, szJ))
894 JEŚLI f0b ≠ 0 (sprężenie martwe):
        cosA = n·n0(d); ft = f + f0b; limS = (ft > 0 ? Ft : Fc)·kap
        JEŚLI cosA < cos(12°) ALBO |ft| > limS ALBO (uCap > 0 i max(etyk[i], etyk[j]) ≥ uCap, po oderwaniu od kotwicy [G]): wypiek: Lb −= f0b/K; L = Lb; F0 = 0; f = K(r − Lb); idź do 918
        W PRZECIWNYM RAZIE: w = vj − vi; sv += w; sn++; vn = w·n
              a += (f + cB·vn)·n + f0b·n0(d); eMin = min(eMin, etyk[j]); następne
918 JEŚLI f > 0:
        lim = Ft·kap
        JEŚLI f > lim: nad = (f − lim)/K; Lb += nad; D += nad·iT; L = Lb; f = lim; jeśli D ≥ 1: wyczyść bit, następne
935     jeśli r > R0·1,5: wyczyść bit, następne
936 W PRZECIWNYM RAZIE (ściskanie):
        lim = Fc·kap
        JEŚLI −f > lim: nad = (−f − lim)/K; Lb −= nad; D += nad·iC; L = Lb; f = −lim; jeśli D ≥ 1: wyczyść bit, następne
948     jeśli r < R0·0,45: wyczyść bit, następne
950 w = vj − vi; sv += w; sn++; vn = w·n; a += (f + cB·vn)·n; eMin = min(eMin, etyk[j])

962 ZGINANIE, d = 0..5, jeśli bit d w mI:    (5-punktowo, pęd zachowany; energia zależy tylko od |b|, więc obrót bryły nic nie zmienia, moment pędu też zachowany)
    j = nbr(i,d)
    i jako KONIEC: jeśli bit d w wMaska[j]:
        jj = nbr(j,d); b = xi + x_jj − 2 x_j; b2 = |b|²
974     jeśli bMax2[j] < b2 ≤ bMax2[j]·6,25: a −= kB·√(bMax2[j]/b2)·b       (plastycznie, nasycone)
        w przeciwnym razie jeśli b2 > bMax2[j]: wyczyść bit d (jeśli jest)   (zerwanie)
        w przeciwnym razie: a −= kB·b
    i jako ŚRODEK, raz na oś (d parzyste), jeśli bit d^1 w mI:
        k = nbr(i,d^1); b = x_j + x_k − 2 xi; b2 = |b|²
992     jeśli bMax2[i] < b2 ≤ bMax2[i]·6,25: a += 2·kB·√(bMax2[i]/b2)·b
        w przeciwnym razie jeśli b2 > bMax2[i]: wyczyść bity d i d^1
        w przeciwnym razie: a += 2·kB·b

1011 wMaska[n+i] = mNowa
1021 SZKODA: wl = 1 − popcnt(mI)·iN0; roz = rozlewW·szSas; sN = max(wl, roz, szI)
    szok: jeśli szokW > 0 i sn > 0: dv = |sv|/sn/uSzokProg; jeśli dv > 1: sN = max(sN, min(0,95; szokW·(dv − 1)))    (prędkości WZGLĘDNE, w próżni bez zmian)
1036 FALA, jeśli NIE bezG: a = A[i]; jeśli |v|² > uFalaV2 [G: 1e30 bez ramy]: cel = szI > 0,5 ? 1 : aSas·0,999; jeśli cel > a: a += (cel − a)·uFalaTempoH
    A' = a; sN = max(sN, a·aLos·0,6)
    wStan[n+i].S = sN; wStan[n+i].A = A'
1049 jeśli stoi: wStan[n+i].etyk = 0; koniec                          (kotwica, fundament: tylko własne kopie stanu)

1051 KONTAKTY, c = 0..liczba−1:
    j = wLista[33i+1+c]; pj = wWez[3j]; jeśli pj.w < 0: następne
    dX = pj.xyz − xi; sm = ri + pj.w; r2 = |dX|²; jeśli r2 ≥ sm² lub r2 < 1e−8: następne
    r = √r2; n = dX/r; w = vj − vi; vn = w·n; Fn = kC·(sm − r) − cC·vn; jeśli Fn ≤ 0: następne
    dotyka++; udar = max(udar, −vn); a −= Fn·n
    jeśli |w|² < uGruzV2: a += uGruzP·w                                [zakleszczenie PARY: względem partnera, pęd zachowany]
    t = w − vn·n; vt = |t|; jeśli vt > 1e−3: a += min(0,9·Fn, cT·vt)/vt · t

1087 jeśli kUd > 0 i udar > uKontaktV: S' = max(S', min(0,95; kUd·(udar/uKontaktV − 1)))
1093 ETYKIETA: e = (eMin = 65535) ? uCap : min(eMin + 1, uCap); etyk' = e    (dla wszystkich węzłów, nie tylko dysku)
    GRAWITACJA [G]: gi = gNaWezle(xi, vi)                               (§ 10.4: stały wektor + punkt + obrót, współczynniki z uniformów, bez gałęzi po scenie)
    jeśli bezG: jeśli e ≥ uCap: a += gi
        w przeciwnym razie jeśli szI > 0,4: a += gi·min(1; (szI − 0,4)·1,5)
    w przeciwnym razie: a += gi
1109 GRUNT [G]: jeśli zi < uGruntZ + dx/2 (bez gruntu uGruntZ = −1e30): gl = zG − zi; Fn = kC·gl − cC·vzi;
        jeśli Fn > 0: az += Fn; jeśli |v|² < uGruzV2: a −= uGruzP·v
                      vt = |v.xy|; jeśli vt > 1e−3: a.xy −= min(0,7·Fn, cT·vt)/vt · v.xy
1130 LEPKOŚĆ SPOCZYNKOWA [G]: jeśli etyk[i] < uCap i |v|² < uLepV2: a −= uLepL·v    (tylko z żywą drogą do kotwicy; etykieta sprzed przebiegu, jak w kodzie)
1139 wWez[3i+2].xyz = a
```

Starego członu zakleszczenia (linie 1134–1137, `−λ·v` przy trzech kontaktach) nie przenosić. Kolejność członów lepkości i tarcia nie ma znaczenia dla wyniku. Kolejność sprawdzeń przy wiązaniu ma znaczenie: nie zmieniać.

Symetria zerwań: oba końce wiązania liczą to samo z tych samych danych, stąd kopie stanu bez cudzych zapisów. Sterownik może przestawić iloczyny (zmierzone w repo, pamięć „Kernel GPU na fazy a bit w bit”), a linie zginania liczą wyrażenia w innej kolejności dla końca i środka. Zabezpieczenia: w czytaniu F dla osi `d < 6` bit sąsiada jest już pod ręką, więc wiązanie osiowe żyje tylko przy obu bitach; dla diagonalnych test odczytem w `?test=1` (§ 8). Rezerwa przy rozjeździe: połowa tabeli, właściciel liczy, drugi koniec czyta.

### 2.6 Kernel I (per węzeł)

```
1159 jeśli i martwy albo stoi: tylko kopia stanu
    v = v + a·h; jeśli |v|² > 4000²: v *= 4000/|v|                    (obcięcie, w tych przebiegach nie działa)
    x += v·h
    wStan[i] = wStan[n+i]; wMaska[i] = wMaska[n+i]                    (także dla stojących)
```

`sumaRuchu` z CPU odpada przy stałym rytmie listy.

### 2.7 Lista kontaktów

Linie 752–811. Trzy kernele:

- `kZerujPo` (n): dla żywego `a,b,c = floor(x·iKom)`, `h` jak w `kWstaw`, zapis 0 zwykłym węzłem. Pełne zerowanie (nKom wywołań, bez osłony `uN`) tylko przy resecie.
- `kWstaw` (n): dla żywego: `a,b,c = floor(x·iKom)`; `h = (a·73856093 ^ b·19349663 ^ c·83492791) & (nKom−1)`; `q = atomicAdd(wKomLicz[h], 1)`; jeśli `q < S`: `wKomSloty[h·S+q] = i`. Mnożenia na `i32` / `u32` z zawijaniem (`bitcast` z ujemnych). Zm.: maks. 23 w komórce. **S = 24, jedno miejsce: `PARAMETRY.slotyKomorki`, GPU i wzorzec Node.** To kolejność na atomiku jest wyścigiem: przy S = 16 GPU odrzuca inne wstawienia niż Node (117–135 odrzuconych na miliony, zm.) i rozjeżdża się z Node ponad poziom zaokrągleń, a od S = 20 zgadza się z Node (zm. `.tmp/woksele-demo/spr-P1/wyscig-sloty.txt`). Wzorzec `model-spec4` liczył przy 16: skróty bit w bit dostają `slotyKomorki: 16` jawnie (`tests/helpers/wokseleBiegi.mjs`), a wynik „po” w teście jednego podkroku liczy się na stronie przy S = 24 z migawki „przed”, § 8. Pamięć +2,1 MB.
- `kLista` (n): dla żywego, 27 komórek; `ile = min(wKomLicz[h].toVar(), 16)` (`toReadOnly`, nie atomik), kandydat j ≠ i, **najpierw** `|Δx|² < zasięg²`, potem `floor(x_j·iKom)` równe (a+da, b+db, c+dc) (zm. odrzuca około 80% kandydatów przed trzema floor), jeśli ta sama grupa i `ijk` różnią się najwyżej o 1 i `lut[...] ≥ 0` i bit żywy w `wMaska[i]`: pomiń; jeśli `l < 32`: zapis. Zm. maks. 27 kontaktów na węzeł, 0 przepełnień, do 100 tys. par w gruzie. Kandydaci 1,86–2,7 mln na klatkę, więc kLista nie jest pomijalna wobec kF (stosunek L/F zm. 0,41 stoi, 0,93–0,95 hałda, `krytyk-gpu/koszt-S2.json`).

Martwe węzły nie wchodzą do siatki. Węzeł, który umarł, wypada z wiązań w `kCzysc`, a z kontaktów przez `pj.w < 0`.

### 2.8 Zdarzenia

Usuwanie węzłów na GPU, bez CPU w pętli. Cudzych zapisów nie ma, a pseudokod F nie zna zdarzeń: w klatce zdarzenia idą osobne przebiegi. Oznaczenia w polu S: **2 = rozerwany, traci wszystkie wiązania; 3 = rozerwany, zostawia wiązania wewnątrz ziarna**.

- `kCzas` (n): `t = wCzasU[i]`; dla `0 < t ≤ uT`: usunięcie: `wWez[3i].w = −1`, prędkość 0, `S = 1`, zapis jak w `usun`. Dla `−uT ≤ t < 0`: rozerwanie: węzeł żyje i niesie pęd, `S = 2` albo `3` wg bitu 16 flagi. `wCzasU[i] = 1e30` po wykonaniu. Emisja przyczyny: § 4.8. To scenariusz S1, S2, S4. Jeden `uT` na klatkę: `uT = f + 1`, czas w klatkach, a nie w sekundach, bo przy t = 14 s sekundy f32 gubią przydział do klatki. Dispatch tylko w klatkach z planu (tablica policzona raz w `ustawPlan`), bez CPU po węzłach w kroku.
- Plan sceny: `solver.ustawPlan(planGpu(plan))`, potem `solver.krok`. Dane: `czasy` (węzły do `wCzasU`), `pchniecia` (środek z budowy, własne t0, tau, rP, J), `kratery` (posortowane po f, środek z węzła-nosiciela, punktu albo promienia strzału, własne r, rdzeń, rS, J, tau, rP, dz), `zerujL`, `bitPas` (bit 17: reszta kuli krateru rozrywa węzeł przez S = 3). CPU pisze raz na klatkę najwyżej rzędy `uKrater` i `uBlast`. Wiele eksplozji o różnych czasach wchodzi bez nowych buforów: ponad 4 na klatkę czeka do następnej, ponad 24 pchnięcia naraz przepadają i liczy to `solver.liczniki`.
- Strzał myszą w tej samej liście, bez czyszczenia sum:
  - `kZerujCel`, `kCel` (n): dla żywego `t = (x − o)·dir`, `d² = |x − o|² − t²`; jeśli `d² < (0,7·dx)²` i `t > 0`: `atomicMin(wLicz[2], u32(t·8))`.
  - `kKraterCel` (4 wywołania, tylko `uKraterN`): środek rzędu do `wBlastK[slot]`. Strzał: `c = o + dir·T/8`, brak trafienia gasi slot. Nosiciel: pozycja węzła, martwy gasi slot. Osobny kernel przed `kKrater`, bo nosiciel leży w swojej kuli i ginie w `kKrater`, więc jego `w < 0` nie może być czytane w tym samym przebiegu.
  - `kKrater` (n): po rzędach z żywym slotem: `|x − c| < rdzeń`: usunięcie jak w `kCzas`. `rdzeń ≤ |x − c| < rS`: rozerwanie `S = 2`, węzeł zostaje gruzem (`krytyk-oczy/krater2`, `fin11k`). Dalej do `r`: `S = 3`, tylko z bitem 17. Strzał: rdzeń 0,4 r, rS = r. **Bez powłoki w S**: powłoka 0,4 kładła wieżę (`krytyk-wiernosc/wyniki-mapa.txt`). Obraz brzegu: bit obrazu w `wRamaWzory`. CPU pisze rząd `uBlast` ze slotem przez `tau`. Emisja pyłu: 3 cząstki na usunięty węzeł (P4).
- `kCzysc` (n, tylko w klatce zdarzenia): dla żywego i dla każdego bitu d w `wMaska[i]`: wyczyść, gdy `wWez[3j].w < 0` albo `S[j] = 2` albo `S[i] = 2` albo (`S[j] = 3` lub `S[i] = 3`) i `kl < 6`. Zapis do `wMaska[n+i]`, kopia do `[i]` w następnym dispatchu razem z S.
- `kCzyscS` (n): `wMaska[i] = wMaska[n+i]`, `S = min(S, 1)`. Zm.: `krytyk-wiernosc/zdrowie2.mjs`, S4 t = 4 i S2 t = 3: bit w bit z Node, pozycje różne 0, także przy powtórzeniu (`proby4/log-zdrowie2.txt`). Poprzednia wersja ze znacznikiem S = 2 wewnątrz F dawała inny wynik: 37% więcej poszarpanych węzłów przy S4, a progi § 8 tego nie widziały.
- Pchnięcie, w klatkach z aktywnym slotem (Node: `pchniecia`, linia 651, wynik w § 10.6). Kop rozłożony na `tau`: `Jk = J/(tau·60)` na klatkę, bo natychmiastowy rozrywa to, co miał pchać. Przed sumami `kZerujWybuch` zeruje `wLicz[3..19]` (nie przez zapis z CPU, który skasowałby głowice):
  - `kWybuchSuma` (n): dla żywego i nie `stoi`: `dv = Σ_b Jk_b·(1 − r/rP_b)·r̂` po `uBlastN` rzędach, trafiony przy `r < rP` któregoś. Stały przecinek z **zaokrągleniem**: `q = i32(round(dv·64))`, `atomicAdd(wLicz[3..5], u32(q))`, liczba trafionych, `round(x)` do sumy pozycji, `atomicMax(wLicz[19], |dv|·64)`. `q` zostaje w `wWez[3i+2]` (w = 1: trafiony), więc kolejne kernele nie liczą `dv` drugi raz, a `kF` nadpisze to pole przed `kI`.
  - `kWybuchMoment` (n): ten sam zbiór, względem środka s: `L = Σ (x − s) × (q/64 − P/m)`, zapis `round(L·16)`, tensor `round(r²/16)`. Zm. zapasy w i32 (`krytyk-wiernosc/log-Fx4.txt`, m = 7197): dv × 64 533 712, pozycja 5 026 335, L × 16 2 080 070, tensor 22,7 mln.
  - `kWybuch` (n): `ω = I⁻¹·L`; `v += q/64 − P/m − ω × (x − s)`, **to samo q**, nie surowe dv. Dla `m < 64`: `ω = 0`. Osłona `|det| > 1e−3·(tr I / 3)³`, wynik `|ω × (x − s)|` obcięty do największego `|dv|` zbioru (zm. bez tego: 5 węzłów w linii 10 303 j./s, `krytyk-wiernosc/tensor.mjs`).
  - Zm. S4: |P|/N obcinanie 0,1221 j./s, round 0,0007, round z dv po kwantyzacji 0,0001 (`log-Fx1`, `Fx3`, `Fx4`).
  - Kop działa też przy g > 0, tym samym kodem.

Reset sceny: `attr.array.set(wypiek)`, `attr.needsUpdate = true` na buforach dynamicznych i stałych; koszt jednorazowy, kilkanaście MB. Bez nowych pipeline'ów.

### 2.9 Pułapki f32

- Pozycje są już we float32 w prototypie (`Float32Array`), ale arytmetyka JS jest w double. Na GPU `r` liczone z pozycji o ulp 1,2·10⁻⁴ przy z = 1300: błąd siły `K·ulp` około 1% g (szacunek sędziego). Trzymać układ lokalny budowli, nigdy współrzędne świata.
- Suma sił: największe `F0` to zm. 86 000 (`maxF0`, S1), `F0·ulp ≈ 0,005` przy g = 400: pomijalne.
- `x += v·h` przy małej prędkości jest martwą strefą (`v·h < ulp/2`). To pomaga stać; pełzania nie będzie.
- D: `nad·iT` przy małym `nad` nie ginie, D ≤ 1. Żadnych tekstur połówkowych, wszystko f32 (obcinanie f16 ku zeru, pamięć „f16 obcina ku zeru”).
- Daleko od zera, zm. w § 10.6: układ lokalny budowli nie może odjechać w nieskończoność, a w próżni pozycje rosną bez ograniczeń. Wzór gry: kernel przesunięcia (`FxPoolOrigin`), offset w `mesh.position`. W demie 14 s lotu nie wymaga przesunięcia.
- `uGruntZ`: bez gruntu −1e30, `uFalaV2 = 1e30` bez ramy, `wCzasU` 1e30 po wykonaniu: nigdzie `Infinity` (`toFloat(Infinity)` daje nieprawidłowy WGSL, a odczyt inf z bufora nie jest gwarantowany).
- `r` z dolnym ograniczeniem 1e−4, `vt > 1e−3`, `r2 < 1e−8` jak w kodzie. NaN w jednym węźle rozlewa się przez sąsiadów na całą budowlę: kernel kontrolny w `?test=1` liczy węzły z NaN (ma być 0).
- `cos(12°)` i `n0` to stałe z `wTab`, liczone w double, a nie w f32 na GPU.
- Etykieta jako f32: wartości < 65 535 są dokładne.
- `aLos = q²`, `q` z PRNG przy budowie. Nie wyliczać na GPU.
- `countOneBits` z `three/tsl` (BitcountNode) działa w WGSL natywnie. `popcnt` tylko bity 0–17.

### 2.10 Szkielet TSL

```js
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, Continue, Return, instanceIndex, instancedArray, uniform, uint, int, float, vec2, vec3, vec4,
  countOneBits, floatBitsToUint, storage, sqrt, max, min, floor, round, atomicAdd, atomicLoad, atomicMin } from 'three/tsl';

const wWez = instancedArray(3 * MAX, 'vec4').setName('wokWez');
const wStan = instancedArray(4 * MAX, 'vec4').setName('wokStan');
const wMaska = instancedArray(2 * MAX, 'uint').setName('wokMaska');
const wWiaz = instancedArray(36 * MAX, 'vec4').setName('wokWiaz');
const wKomAttr = new THREE.StorageInstancedBufferAttribute(new Uint32Array(N_KOM), 1);
const wKomLiczA = storage(wKomAttr, 'uint', N_KOM).setName('wokKomLicz').toAtomic();   // tylko kWstaw
const wKomLiczR = storage(wKomAttr, 'uint', N_KOM).setName('wokKomLicz').toReadOnly(); // kLista
const uN = uniform(0, 'uint');

const kF = Fn(() => {   // sąsiad: floatBitsToUint(wWiaz.element(36*i+2*d+1).z), nie osobny bufor
  const i = instanceIndex;
  If(i.greaterThanEqual(uN), () => { Return(); });
  const pi = wWez.element(i.mul(3)).toVar();          // odczyt raz, zawsze przez zmienną
  const mI = wMaska.element(i).toVar();
  const mNowa = mI.toVar();
  const ax = vec3(0).toVar();                         // zmienna z typem ze STAŁEJ (pułapka 40)
  Loop({ start: uint(0), end: uint(18), type: 'uint', condition: '<', name: 'd' }, ({ d }) => {
    const bit = uint(1).shiftLeft(d).toVar();
    If(mI.bitAnd(bit).equal(uint(0)), () => { Continue(); });
    const ox = uint(18).mul(i).add(d).toVar();                // numer wiązania; rekordy po dwa vec4
    const nb = floatBitsToUint(wWiaz.element(ox.mul(2).add(1)).z).toVar();
    const j = nb.bitAnd(uint(0xffffff)).toVar();
    const kl = nb.shiftRight(uint(24)).sub(uint(1)).toVar();
    // ... wg § 2.5
  });
  // ...
})().compute(MAX).setName('wokF');
```

Zasady pisania tego kodu:

- Każdy odczyt z bufora, którego się używa więcej niż raz, przez `.toVar()`. TSL inaczej wkleja wyrażenie w każde użycie (koszt) albo buduje je w złej gałęzi (pułapka 39: `select` poza `Fn`).
- Wartość `atomicLoad` użyta jako koniec `Loop`: `.toVar()`, inaczej pętla ma 0 obiegów bez błędu (komentarz w `swarmSim.js:1009`).
- `Loop` z `Continue`, nie `countTrailingZeros` w pętli `while`. Stałe 18 obiegów z gałęzią; prostsze w TSL, a różnicę sprawdza pomiar.
- Kernele w jednym module, `.setName` na każdym buforze i kernelu: stały WGSL, wspólna kompilacja.
- Nazwy buforów z TSL wchodzą w WGSL. WGSL buduje się w Node bez GPU (`renderer.backend.createNodeBuilder`): test czyta wygenerowany kod (zasada z AGENTS).

### 2.11 Lista kontrolna przenoszenia gałęzi

Odhaczyć przy pisaniu kernela F. Każda pozycja to linia `model-spec3.mjs`: 852 martwy, przed 889 fala łamie granice (`lataj4.mjs`), 889 krusz, 894–917 sprężenie i wypiek (`f0b` ze skalą), 918–935 rozciąganie, 936–948 ściskanie, 950–960 tłumienie, 962–1009 zginanie (dwie gałęzie plastyczne 974 i 992; `cBg` nie przenosić), 1011 maska, 1021–1035 szkoda i szok, 1036–1046 fala (bez dysku; próg `falaV2` z ramy, linia 838), 1049 stoi, 1051–1085 kontakty z parą zakleszczenia, 1087 impakt, 1093–1106 grawitacja, etykieta dla wszystkich i waga od szkody, 1109–1121 grunt, 1130 lepkość z warunkiem etykiety, 1159 I. Budowa: 272 CG z ładunkiem i zerem, 358 kalibracja projekt / rzeczywistość, 434 etykieta wieży, 457–545 wytrzymałości, 548–556 zginanie w ziarnach, 560 ziarna z dachem, 705 kontakty. Scena: 119 źródło, 593 pole w węźle, 616 skala w biegu, 620 odkotwiczenie, 628 rozerwanie, 651 pchnięcie.

## 3. Geometria

Wszystko przy dx = 20. Port `wspolne/scena.mjs` 1:1; zm. liczby:

| Budowla | Wymiary | Węzły | Uwagi |
|---|---|---|---|
| Wieża | 380 × 420 × 1340, 19 × 21 × 67 komórek, 13 kondygnacji | 14 942 (strop 8040, kolumna 4280, fasada 1014, rdzeń 1608) | H = 1340 (nie 1400): równy podział na piętra, inaczej attyka |
| Wieża-pocisk | 220 × 220 × 840, kolumny co 4, dół 2, góra 2 | 3240 | obrót 30° wokół z i 2° wokół (1,1,0), v = 300 w dół, 150 j. nad pokładem, g = 260 |
| Dysk | R = 900, grubość 80, dwa pokłady 20, żebra co 20° i co 150 j., wieniec 40, kotwica 30 | 17 382 (15 766 + 1616) | pole gruntu z = −1500 |
| Scena S3 razem | | 20 622 | |

Grunt: płaszczyzna z = 0 (wieże), z = −1500 (S3, ciemna, § 4.3), brak w próżni. Wieża z kotwicami ma dolną warstwę nieruchomą, w próżni nie ma nieruchomych węzłów (dolna warstwa zostaje tylko podporą PROJEKTU, § 2.3). W S3 kotwica dysku nieruchoma: dysk jest przypięty do czegoś wielkiego także w próżni. S4 to ta sama wieża co S1, S2, wszystkie 14 942 węzły, nikogo się nie usuwa.

Habitat i skała z gry w tym demie nie występują: wieża-pocisk stoi za habitat, a dysk za dysk mieszkalny. Prawdziwy kształt habitatu dopiero po ocenie.

Obraz, zm. liczba rysowanych brył (`log3-fin1.txt`): nienaruszona wieża 12 810, S1 16 tys. (t = 3), 44 tys. (t = 5), 56 tys. (t = 6), S2 do 59 tys., S3 27–38 tys. Slotów instancji 7n: 105 tys. dla wieży, 144 tys. dla S3.

## 4. Obraz

Bez k³. Jeden rysunek, jeden materiał, `InstancedBufferGeometry` (bez `InstancedMesh`: pułapka 24), geometria sześcianu **24 wierzchołki z indeksem**, żeby ściana miała własną normalną. Układ id: `id < n` to slot 0 (blok) węzła `id`; `id ≥ n`: `i = (id − n) / 6`, `s = 1 + (id − n) % 6`: 1–5 odłamki, 6 pręt. `instanceCount = n`, dopóki scena nie miała zdarzenia, potem `7n`: stojąca wieża to 119 536 wywołań wierzchołka zamiast 836 752, bez nowego rysunku i pipeline'u. Slot nieaktywny: **zapadnięcie 8 rogów do punktu x**, nie `vec4(2, 2, 2, 1)`, bo materiał ma `positionNode` w układzie lokalnym, a `vertexNode` nie zadziała z `normalFlat` i cieniem (zm. `spec-proby/tsl-proby3.mjs`).

### 4.1 Kernel `kObraz` (raz na krok fizyki)

Dla żywego węzła, wynik w `wRamaWzory[3i..3i+2]`:

```
axL = 1 − popcnt(m & 63)/popcnt(m0 & 63); lost = 1 − popcnt(m)·iN0;  Sv = max(0,8·lost; axL; k·S; S > 0,99 ? 0,75 : 0; axL > 0 ? 0,5 : 0)     (k = 0,35, dysk 0,9)
d_cel = smoothstep(0,3; 0,95; Sv); dObraz += min(d_cel − dObraz; 4/60) na krok, do góry; w dół nie wraca     (`obraz4.mjs`, limit wzrostu nietestowany)
F: kolumny z żywych wiązań osiowych: Fa = (x_jp − x_jm)/((bp + bm)·dx), długość obcięta do [0,55; 1,25]
   brak jednej osi: iloczyn wektorowy dwóch pozostałych
   jedna oś znana: dopełnienie prostopadłe
   brak wszystkich osi (samotny): F_nowe = F_stare·R(oś z hasza, Δφ), Δφ = |v|·dt/(0,9·dx), potem ortogonalizacja
```

Odczyt `F_stare` jest bezkosztowy i usuwa przeskok orientacji w chwili utraty ostatniego wiązania. **Prototyp Node robił to prościej (obrót z hasza, bez ciągłości): w ruchu niesprawdzone.** Kąt rośnie tylko, gdy węzeł się rusza, więc hałda stoi. Zm. S1 przy 60 Hz, t = 5–5,5 (`krytyk-oczy/log-t7.txt`): na klatkę 92 węzły ze skokiem d ponad 0,15, 16,5 przechodzi w „sam” z podmianą kształtu. Dlatego limit wzrostu `dObraz`, stały rozrzut jasności od początku i kurczenie zamiast podmiany (przejście na „sam” przez 0,15 s). Sekwencja 30 klatek w Node: § 1.6, bez limitu wzrostu, bez oceny oczami.

### 4.2 Wierzchołek

`x = poz + v·τ` (ekstrapolacja do klatki renderu, `τ ∈ [0, 1/60)`). Nie używać `positionWorld`, `mesh.position` przy zerze w demie. Corner = ±1 z geometrii. **Najpierw odczyt `d`, maski i flag, reszta w gałęzi aktywnego slotu** (szac. 5,9–8 mln odczytów storage na przebieg przy czytaniu wszystkiego, czyli rząd fizyki; 6 z 7 slotów zwykle nic nie rysuje).

**Slot 0, blok**: widoczny, gdy `d ≤ 0,001` i `(m & 63) ≠ 63`. Wnętrze bryły (wszystkie 6 osiowych żywe) znika samo, więc przerys jest mały. `P = x + F·corner·0,51·dx`. 2% zakładki zamyka dziury w rogach, ale cztery rogi dalej zostawiają kropki (`krytyk-oczy/crop/S3_dal.png`): na dysku 4% zakładki albo cienka płyta pod pokładem, do wyboru na P3. Wieniec dysku: wierzchołki bloków dociągnięte do promienia R, schodki co 20 j. widać od pierwszej klatki.

**Sloty 1–5, odłamki**: widoczne, gdy `d > 0,001`. Wzór `pt = hash(i) % 64` per kind, liść `l`: środek `c`, półosie `h` z `wRamaWzory`. Wzory z k-d: 4 cięcia, ułamek 0,3–0,7, oś z wagą `waga(kind, oś)·h²` (krępe, nie płytki; wagi strop 0,25/0,25/0,5, kolumna 0,45/0,45/0,1, fasada 0,45/0,3/0,25, rdzeń po równo, dysk jak strop). Budowa przy starcie, `obraz2.mjs:42–68`.

```
sam = węzeł bez wiązań osiowych; typ = hash(i) % 10
jeśli sam:   typ < 4  → tylko slot 1, półosie (0,32–0,52)·(0,72–1,22), środek w x (bryła)
             typ < 8  → tylko sloty 1, 2
             reszta   → wszystkie, rozj = 1,7
nie sam:     rozj = 1 + 0,18·d², kąt = d²·(0,12 + 0,4·u)
sam:         rozj = 1 + 0,3·d, kąt = d·(0,12 + 0,55·u)
O = c·dx·rozj + 0,08·d·dx·szum(hash)      (środek w komórce)
R = obrót wokół osi z hasza o kąt
P = x + F·(O + R·(h·corner·dx·(1 − 0,1·d) + jit))
jit = 0,4·d·(szum rogu z hasza id + numeru rogu)·h·dx
```

`jit` łamie ściany. **Normalna ściany w wierzchołku z przekątnych**, nie `normalFlat` (który daje każdemu trójkątowi inną normalną, a przekątna jest wszędzie ta sama: to „złożona kartka”, zm. `krytyk-oczy/zlom`): `n = (rog2 − rog0) × (rog3 − rog1)`, w shaderze rogi liczone ze wspólnej funkcji. Bez `DoubleSide`. Sześć wywołań funkcji rogu na wierzchołek to koszt do sprawdzenia na P3; rezerwa: `normalFlat` poza `If`, pułapka 29.

**Slot 6, pręt**: dla kolumny, stropu, rdzenia i dysku, gdy `hash % 3 == 0`, `d > 0,3` i węzeł ma choć jedno wiązanie osiowe: `P = x + F·(e·corner_e·rl + b·corner·0,07·dx)`, `rl = dx·(0,7…1,6)·(0,6 + 0,4·d)`, oś kolumny z, stropu x albo y, pochylenie `0,5·d·u`, kolor ciemna rdza `(0,2; 0,15; 0,12)`.

**Fragment.** Kolor z bufora, nie z klasy obrazu: beton strop `(0,20; 0,19; 0,17)`, kolumna `(0,17; 0,162; 0,148)`, rdzeń `(0,14; 0,135; 0,125)`, dysk `(0,17; 0,165; 0,15)`, kotwica `(0,09; 0,09; 0,085)`, fasada **ciemna blacha** `(0,105; 0,108; 0,112)` z `metalness 0,5` (rasteryzator metalu nie zna: tylko GPU). Jasność: szum wolnozmienny **liczony w fragmencie z ciągłej pozycji początkowej** (varying), nie na węzeł, bo inaczej mozaika co 20 j. na dysku i dachu (`krytyk-oczy/crop/S3_przod.png`; nietestowane). Rysy i plamy betonu w fragmencie z pozycji początkowej: **warunek pokazu** (nietestowane, P3). Ton kawałka od ziarna: `tonZ = 0,7 + 0,55·hash(ziarno)`, mieszany `1 + (tonZ − 1)·min(1, 3·lost)`, żeby całe powierzchnie nie miały łat Voronoi, a odłamek `· (0,94 + 0,12·u)·(1 − 0,14·d)`, ciemniej na przełomie. Przy tonie na odłamek zamiast na ziarno wychodzi mozaika (`M2/kadry/S1_blisko_t5.00.png` kontra `fin11`). Mieszanie ku barwie pyłu najwyżej `0,15·d`; dawne `0,65·d` to tektura. Pył to cząstka, nie albedo.

Czego w środku nie ma: przegród, mebli, kabli. Budynek jest pusty, a w hałdzie są tylko beton, stal fasady i pręty. Dopisuję to wprost, bo krytyk słusznie zauważył, że ogranicza to rozmaitość. Dodanie przegród to większa decyzja o scenie, do oceny po pierwszym pokazie.

Materiał: `MeshStandardNodeMaterial`, `roughness 0,95`, `metalness` z bufora, `positionNode`, `colorNode`, `normalNode`, `map = null` (pułapka 17), `frustumCulled = false`. Pręt `metalness 0,3`. **`castShadowPositionNode`** (osobny graf, `Renderer.js:3200–3206`): w cieniu tylko bloki i slot 1, gruz bez cienia, w rozgrzewce też.

### 4.3 Oświetlenie i cień

Oś z w górę, `camera.up = (0,0,1)`. Słońce `(0,55; −0,45; 0,7)`, DirectionalLight z cieniem 4096², ortho ±1700 (wieże), ±2300 (S3), `normalBias` z dema D20 (2,0, `dema/zawalenia-budowli/obraz.js:347–350`). Otoczenie: HemisphereLight, chłodne z góry, ciemne z dołu; natężenia i ekspozycja dobrane tak, żeby przy S1 Bliska t = 6 p5, p50 i udział ciemnych były w granicach ±15% od kadru odniesienia `fin11` (`proby4/miary4.py`, liczby w § 7). ACES, sRGB. Grunt: ciemna płyta z siatką 100/500 j. jak w D20. **S3**: pod dyskiem ciemna płyta prawie bez światła, żeby wnętrze otworu było ciemne, i słabe doświetlenie od dołu, bo pocisk po przejściu jest inaczej czarną plamą (`fin11/S3_arkusz.png`). **MSAA 4** jak w grze (`antialias`, cel HalfFloat): odłamki mają na Kino 2–11 px, pręt 2,1 px, a znana przyczyna mrugania z daleka to właśnie cienkie bryły. Koszt w § 6.1.

Próżnia: `HemisphereLight.intensity` obcięte do 0,3 (światła nie wyłączać: zasada 4), ciemne tło z gwiazdami zamiast płyty gruntu (płyta zostaje w scenie, `intensity` i przezroczystość, żeby nie zmieniać pipeline'u). Cień: ortho rośnie z rozrzutem połówek, ±3500 w scenie S4; to 0,6 px cienia na j., do kadru wystarczy.

**Okluzja: GTAO od początku** (`GTAONode`, `three/examples/jsm/tsl/display/GTAONode.js`), tylko w demie, w tym samym post. Kadry odniesienia stoją na SSAO (`rys3.mjs:200–219`: 16 próbek, promień do 24 px, siła 0,6). Zm. S1 Bliska t = 6, p5 / p50 / ciemne: z SSAO 54 / 144 / 10,1%; bez 77 / 161 / 3,3%; AO z licznika kontaktów 70 / 153 / 5,0% i mozaika płytek (`krytyk-oczy/miary.py`). Licznik kontaktów odzyskuje około 25% różnicy, więc zostaje tylko dodatkiem. W grze dla GTAO nie ma miejsca bez decyzji o poście: patrz § 6.3.

### 4.4 Przerys i koszt

Bryły są małe i prawie nieprzezroczyste wzajemnie, przerys ≈ 2–3 warstwy w hałdzie. Wywołania wierzchołka (rachunek): stan cały 119 536 na przebieg, po zdarzeniu `7n × 8 = 836 752` (wieża), 1 154 832 (S3), plus gruz 40 000 × 8, razy dwa z cieniem: 2,3–3 mln. Widoczne bryły, zm.: 12 810 z 104 594 slotów w stanie całym, maks. 57 813, S3 maks. 33 319 ze 144 354 (`log6-oS12.txt`, `oS3`). Odrzucanie niewidocznych przez listę pośrednią (`setIndirect`, wzór `src/3d/worldSkinBatch.js`) dopiero, gdy pomiar pokaże, że vertex boli.

### 4.5 Drobny gruz

Pula pierścieniowa w `wCzastki`, `CAP_G = 40 000`, rekord: pozycja + rozmiar, prędkość + spin. Emisja w `kObraz`: gdy `Sv` przekracza 0,5, a slot najmniejszego odłamka (`objętość < 0,1`) ma los `(hash & 1023)/1023 < 0,05·(Sv − 0,5)` na krok: `q = atomicAdd(wLicz[0], 1) % CAP`, slot gaśnie. **Brzeg otworu dysku**: węzeł dysku przy pierwszej utracie wiązania (bit emisji) emituje 1–3 rekordy w górę i na zewnątrz, 40–120 j./s; `kGruz` zna **płaszczyznę pokładu** z uniformu sceny, więc taki gruz leży na pokładzie poza kołem o promieniu otworu z uniformu, reszta leci przez otwór. Cel: pas gruzu szerszy niż pas kruszenia. `kGruz`: balistyka z tym samym polem `gNaWezle` (§ 10.4), grunt z tłumieniem 0,75 (bez gruntu nic), bez kontaktu z hałdą, po spoczynku trzymać w miejscu (pula nadpisze). Spoczynek tylko względem ramy: w próżni gruz leci dalej. Na GPU rysowane tym samym materiałem w osobnym rysunku `InstancedBufferGeometry` z rozmiarem z rekordu.

**W prototypie to były wolne odłamki węzła. Emisja do puli, brzeg otworu i płaszczyzna pokładu są niesprawdzone.**

### 4.6 Pył

Pula w `wCzastki`, `CAP_P = 16 000`, rekord: pozycja + wiek, prędkość + promień. **Emisja przy kontakcie, nie z każdego węzła**: pierwszy raz, gdy `lost > 0,5` (bit w `wRamaWzory`) i węzeł ma co najmniej 5 kontaktów, z losem 1/3 (dysk 1/12): jedna cząstka, `v = 0,6·v_węzła + 90·u·r̂ + szum 30`, gdzie `r̂` to kierunek od osi budowli, `v_z ≈ szum 6`. Bez warunku kontaktu pył wisi tam, gdzie odpadła fasada: duch wieży (`krytyk-oczy/pyl`, `pyl2`, `fin10`). Strzał: 3 cząstki na usunięty węzeł, § 4.8. `kPyl`: `v *= 0,985` na krok, `v_z += 3,5·dt`, wiek. **Chmura przy gruncie**: cząstka poniżej 170 j. nad gruntem przyspiesza na zewnątrz 70·(1 − wiek/7) j./s², `v_z ≤ 3`, promień rośnie o 16 j./s (`obraz4.mjs`, `pylGrunt`; kadry `fin11/kadry/S1_cala_t7.00.png`). Opór i wypór to skutek POWIETRZA, nie grawitacji: osobny uniform `uPowietrze` (planetoida ma g, a nie ma powietrza). Bez powietrza: `v` dziedziczone w 100%, szum ±30, bez oporu, wyporu i warunku kontaktu, `r = r0/2 + 9·√wiek`, prawie niewidoczna mgiełka. Promień `r = r0 + 38·√wiek`, `r0 = 16–34`, alfa `0,0525·min(1, 4·wiek)·max(0, 1 − wiek/6)`, kolor `(0,62; 0,58; 0,52)·0,42` (`obraz4.mjs`, `pylA` 0,7).

**LOD i sufit** (budżet § 6.1, `krytyk-gpu/koszt-S2.json`): kwad ponad około 150 px rzutu rysowany co czwarty, alfa ×4, płynne przejście; sufit promienia w px; cząstka bliżej kamery niż 3 promienie gaśnie płynnie, bo na Zbliżeniu po t = 6 pył wypłukuje kadr. Tryb niski: połowa puli, alfa ×2. Wszystko nietestowane.

Rysunek: kwady z billboardem (bez `gl_PointSize`, zasada repo), `transparent`, `forceSinglePass` nie dotyczy (FrontSide), `depthWrite = false`, test głębi, mieszanie zwykłe bez sortowania. **Bez miękkich cząstek w pierwszej wersji**: przy alfie 0,05 cięcie o bryłę jest prawie niewidoczne na kadrach Node, które jednak miały miękkość. Jeśli na GPU widać ostre cięcia: `viewportDepthTexture`. W repo nikt tego dziś nie używa, więc to będzie nowe ryzyko.

Rozerwany węzeł wewnątrz ocalałego ziarna (S = 1 przy żywych wiązaniach) dostaje `Sv ≥ 0,75`, więc brzeg kawałka jest poszarpany (`obraz3gen.mjs`, `svRozerw`). Bez tego kawałki to gładkie klocki w kształcie T i L jak w tetrisie (`obraz3/v2/kadry/S4_blisko_t8.00.png`), z tym poprawne (`obraz3/v3/kadry/S4_blisko_t8.00.png`). Pręty tylko dla węzłów z wiązaniami: samotny sześcian z zapałką w środku wygląda źle (`obraz3/v1/kadry/S4_bardzo_t4.00.png`).

Znane wady pyłu z kadrów `fin11`: nad hałdą stoi wąski słup, zamiast kłębić się szerzej, a pojedyncze kłaczki wyżej zostają (emisja przy kontakcie zdarza się teraz także wysoko, bo tam też pękają płyty). Dziedziczenie 0,6 pomogło, ale nie zlikwidowało. Dmuchy z okien nad frontem nie wchodzą, § 1.5.

### 4.7 Kamery i W5

Kamery to ścieżki klatek kluczowych na scenę, nie stałe ustawienia, bo stała Bliska S2 kończy się poniżej cięcia, a Kino S4 pod lot do t = 14 daje cięcie na 110 px z 960 (`krytyk-oczy/panorama`). `fov 32°`. Domyślne przy 5120 × 1440 (32:9 pokazuje dziś akcję w 10–20% szerokości): Kino odjeżdża wraz z rozrzutem.

| Scena | Kino (az, el, cel, odl) | Bliska | Zbliżenie |
|---|---|---|---|
| S1, S6 | 32, 8, (0,0,620), 3300 | 35, 12, (0,0,300), 1800 → cel na froncie | 28, 16, (60,−80,110), 900 |
| S2 | jw. | 32, 6, (0,0,871), 1300 do t = 3, potem jak S1 | jw. |
| S3 | 35, 22, (0,0,−250), 3400 | 30, 32, (0,0,−20), 2200 | 22, 18, (40,−60,−40), 950 |
| S4 | 32, 8, (0,0,650), od 3000 odjazd do 6200 przy t = 4–10 | 35, 12, (0,0,670), 3000 | 28, 16, (60,−80,670), 1100 |
| wszystkie | „Z góry jak w grze”: el 89 (przy 90 rasteryzator się degeneruje) | orbita myszą | |

Arkusze `fin11` są z tych ustawień (S4 Kino przy stałej odl 6200), więc zrzuty GPU wchodzą obok siebie. Rozmiary brył na zbliżeniu: 3–14 j. przy 900 j. odległości.

### 4.8 Przyczyna (uzupełnienie § 4)

Budynek nie może pękać sam z siebie, a S2 ani S4 nie miały dotąd obrazu zdarzenia. W `kCzas` i `kKrater`, co N-ty węzeł (hash, stała sceny), trzy rekordy:
- `wBlysk`: pierścień 64 rekordy (pozycja, chwila, moc), rysowane jako kwady w tym samym rysunku co pył, addytywnie, HDR > 1, 0,15 s. Bloomu demo nie ma, § 9; jeśli błysk bez niego jest płaski, kopia posta D20 jest dopiero decyzją na K2.
- 1–3 rekordy gruzu z prędkością od środka zdarzenia.
- Cząstki pyłu: z powietrzem jak w § 4.6, bez powietrza widoczniejszy, krótki rozbłysk zamiast pyłu, bo mgiełka w próżni nic nie tłumaczy.

Koszt: `kPrzyczyna` przesuwa i wygasza pierścień, tylko 64 elementy, szac. poniżej 0,05 ms. Rasteryzator błysku nie ma: **cała ta sekcja jest niesprawdzona** i dostaje wiersze w § 7.

## 5. Sceny, interakcje, panel, pliki

### 5.1 Pliki

| Plik | Zawartość |
|---|---|
| `dema/woksele-zawalenia.html` | kanwa i panel, wzór stylu z `dema/zawalenia-budowli.html` |
| `dema/woksele-zawalenia/scena.js` | port `wspolne/scena.mjs` i planu S4 ze `spec-proby/scenyG.mjs`, bez three, do testów w Node |
| `dema/woksele-zawalenia/budowa.js`, `budowa.worker.js` | § 2.3 |
| `dema/woksele-zawalenia/solver.js` | `createWokseleSolver({ maxNodes })`: bufory i kernele, `wczytaj(wypiek)`, `krok(renderer)`, `strzal(o, dir, r)`, `kernele` do rozgrzewki. **Żadnych celów renderu, kanw ani DOM.** Bierze `renderer` z parametru |
| `dema/woksele-zawalenia/obraz.js` | geometria instancji, materiał, kernele `kObraz`, `kGruz`, cele, okluzja, wyjście |
| `dema/woksele-zawalenia/pokaz.js`, `scenyPokazu.js` | strona na żywo: pętla, kamera orbitalna, panel; plany scen wspólne ze stroną i wątkiem budowy |
| `dema/woksele-zawalenia/pyl.js` | pula, kernel, materiał |
| `dema/woksele-zawalenia/glowny.js` | WebGPURenderer, `window.__HARNESS_RENDERER__ = renderer` (bez tego dziennik pipeline'ów harnessu jest pusty i „0 synchronicznych” to fałszywe zero; wzór `dema/zawalenia-budowli/obraz.js:321`), owinięcie `backend.updateTimeStampUID` (§ 8), kamera, pętla, panel, `window.__wok` |
| `dema/index.html` | wpis w grupie „Zniszczenia, mostki, rdzenie” obok `zawalenia-budowli.html` |

Przeniesienie do gry później: `Core3D.addFxStep({ name: 'woksele', update(ctx) { for (; lokalnyTick < ctx.physTick; lokalnyTick++) solver.krok(ctx.renderer); }, warm(ctx) { ... } })`: kroki Core3D.fx idą raz na klatkę renderu, także przy 240 Hz, więc jeden krok na `update` to 4 × tempo u użytkownika (AGENTS: numer kroku z licznika całkowitego; wniosek z odczytu kodu, w grze nieuruchomione). Pozycje zostają w lokalnym układzie budowli, a duży offset idzie w `mesh.position` (hak przekrojowy: float32 świata). Obraz: warstwa passa gry. Demo ma własny WebGPURenderer, jak inne dema. **Dzisiejszy budżet dema jest 6–12× nad zapisanym limitem gry (GPU +1 ms, `docs/PLAN-zawalenia-budowli-3d.md:91`): decyzja użytkownika po pomiarze, § 6.3.**

### 5.2 Sceny (efekt od razu po wejściu, bez kliknięcia)

Po wejściu rusza scena 2, z najlepszym zaliczonym kadrem: co nie widać od razu, użytkownik czyta jako „nie ma” (pamięć). Ekran ładowania tylko na czas CG i pipeline'ów (szac. 3–5 s), bez nakładek po starcie. Stanie przed zdarzeniem skrócone do 1 s przez start zegara sceny z `uT = 1` (stojąca wieża się nie rusza, W1, więc nie trzeba liczyć pustych kroków).

| # | Nazwa | Co się dzieje | Dane |
|---|---|---|---|
| 1 | Wieża podcięta | Stoi 1 s, ostrzał z +x w 10–18% wysokości (front 2–4 s) | `S1`, błyski i pył przy usuwanych węzłach, § 4.8 |
| 2 | Własny ciężar | t = 2 s: ładunek w kondygnacji na 65% h: front od środka 0,3 s, 80% węzłów znika, 20% zostaje gruzem | `S2` z `s2front`, błysk i pył, § 4.8 |
| 3 | Przebicie dysku | Pocisk spada przez dysk | `S3` z obrotem 30° |
| 4 | Odporność | t = 2: znika kolumna; t = 5: krater r = 60; t = 8: drugi krater r = 60; wieża stoi. Mysz dalej działa: największy strzał nisko zwykle ją kładzie, § 1.2 | `kol1` i `mapa5.mjs`, miejsca z 32/32 |
| 5 | Próżnia | Ta sama wieża w pustce, bez gruntu i kotwic, 1 s stoi. t = 2: nierówny front cięcia od +x (około 1 s) i 12 pchnięć w tym miejscu. Góra i dół rozlatują się w przeciwne strony i obracają, zostają w większości całe | `scenyG.mjs` S4, opcje `s4-opcje-koniec.txt` |
| 6 | To samo przy g = 400 | Ten sam plan cięcia i pchnięć, ten sam materiał, grunt i kotwice: miażdży się. Zm. góra przy t = 5 / 5,5 / 6: największy kawałek 48 / 29 / 14%, kąt 7,2 / 10,6 / 16,3° (`proby4/logG4-g.txt`): do t = 5,5 widać przechylony blok na kuli gruzu, to najsłabszy kadr, patrz § 7 | jw., `g: 400, grunt, kotwice` |

Klawisze `1`–`6`, `R` reset sceny, `G` grawitacja w biegu (§ 5.4). Scena nie zapętla się sama. Kolejność na panelu i klawisze bez zmian, tylko start od 2.

Sceny S5 (§ 5.5): pierwsze na panelu, **domyślny start strony to „S5 pochylona wieża”, ziarno 21 jak w filmie** (`?ziarno=7` zmienia ziarno wszystkich trzech). Słowa użytkownika: wieża „pochyla się, dużą częścią przebija i dysk niszczy na kawałki”; dysk pod habitatem „też jest budowlą, ma się niszczyć, walić, spadać na planetę lub przy braku grawitacji dryfować”; „może losowe eksplozje, żeby rozwalić na kawałki”.

| Przycisk | Miejsce | Przebieg (Node, § 8) |
|---|---|---|
| S5 pochylona wieża | g = 260, grunt z = −2500, 8 wsporników (kotwice) | Styk t = 0,55 pod kątem 25,7°, rozcięcie, wieża na gruncie t ≈ 3,7–3,9. Wsporniki padają t ≈ 2,6–4,7, dysk zaczyna spadać około t = 5, płyty rozrywają kolejne eksplozje w locie do t ≈ 6–7, lądowanie i kruszenie t ≈ 9–10 |
| S5 próżnia | g = 0, bez gruntu, `uKotwice = 0` | Ta sama budowa, ten sam plan, ten sam materiał (te same Ft, Fc, klasy co do bitu poza kotwicami, które nie stoją). Płyty rozjeżdżają się i obracają, całość jedzie ze środkiem masy, kamera też |
| S5 planeta | źródło punktowe `{ punkt: { c: [0, 0, −14000], g: 260, r0: 14000 } }`, grunt z = −2500 | Wszystkie kotwice puszczają (`uKotwice = 0`) po ostatniej kuli wspornika. Dysk spada na „planetę”. To przypadek z misji piratów |

### 5.3 Interakcje

LPM strzał (krater i pchnięcie J = 300, tau = 0,3, rP = 160, § 2.8, także w próżni; bez pchnięcia w próżni nic by się nie ruszyło), prawy przycisk orbita, rolka zoom, `Spacja` pauza, `.` krok. Tempo przez licznik kroków: 1×, ½×, ¼× (bez zmiany dt fizyki). Zegar stały: 1/60 s na krok, najwyżej 2 kroki na klatkę, **a gdy ostatnia klatka przekroczyła próg (szac. 14 ms), 1 krok**, reszta przepada (spowolnienie zamiast spirali: drugi krok przy S3 to szac. 16,6 ms). Krok liczony z całkowitego licznika, nie z sumy.

### 5.4 Panel

Prawa krawędź, chowany `H`, bez debugów na obrazie. Zawartość: nazwy sześciu scen z jednym zdaniem, reset, tempo (3 przyciski), kamery (Kino, Bliska, Zbliżenie, Z góry), pył wł./wył., rozmiar strzału (r = 40, 60, 90), **Miejsce: Próżnia / g = 400** (reset sceny, działa na scenach 1, 2, 5, 6: próżnia = bez gruntu i kotwic. Na scenach 1 i 2 w próżni idzie plan S4 na ich wysokości, 14% i 65% h, zm. `logG-U14.txt`, `U65`, a w przypadku g = 400 ich własny plan bez pchnięć. Budowy nie liczy się od nowa: zmieniają się uniformy z § 10.4 i `uKotwice`, bufory wracają jak przy każdym resecie), **G: grawitacja w biegu** (rampa `skG` przez 3 s, § 10.5, przy stojącej wieży bez ruchu, w czasie zawalenia z odbiciem do 15 j./s), jedna linia na dole: `fizyka x,x ms/krok · obraz x,x ms · kPyl x,x ms · klatka x,x ms` (rysunek pyłu nie ma osobnego znacznika, § 8). Bez suwaków. Trzecie źródło (planetoida g = 40, punkt) jako przycisk tylko, jeśli starczy czasu: kod i dane je znają, § 10.4.

### 5.5 Scena S5: dane budowy i plan eksplozji

Kod: `scena.js` (`S5`, `S5_OPCJE`, `S5_NAKLADKA`), `budowa.js` (`wypieczSzwy`, `zbudujPlan`), `scenyPokazu.js`, `pokaz.js` (przyciski, kamery). Wzorzec: `proby5/final/scena5.mjs`, bajt w bajt, ta sama kolejność PRNG, strażnik `tests/wokseleS5.test.mjs` (ziarna 21 i 7: wszystkie tablice wypieku i plan).

**Geometria.** Wieża 300 × 300 × 1100 (6600 węzłów), obrót 25° wokół z, pochylenie 18° w kierunku 25°, ω = 14°/s, v = 300 j./s w dół + 90 j./s w stronę pochylenia, najniższy róg 200 j. nad pokładem, 300 j. przed środkiem dysku wzdłuż pochylenia, 130 j. w bok. `gProjDir` wzdłuż osi wieży, `gProj` 400. Dysk R = 900, grubość 80, 17 382 węzły. Razem 23 982, MAX 26 000 z § 2.2.

**Kotwice.** 8 łuków po 130 j. (około 300 węzłów), reszta obwodu to zwykły wieniec. Próżnia to ta sama budowa z `uKotwice = 0` (§ 10.4), a nie przebudowa bez kotwic: wytrzymałości zależą od etykiety odległości od kotwicy.

**Sekcje.** 17 komórek Voronoi z punktów Mitchella (5 kandydatów) i wagą addytywną do 70 j., na współrzędnych zakrzywionych szumem trzech skal (330, 95, 30 j.; 110, 40, 12 j.). Podsekcje: 2–4 w sekcji, Voronoi na własnym zakrzywieniu (190, 47 j.; 70, 18 j.).

**Wypiek po `zbuduj`, przed pierwszym krokiem.** PRNG losowany dla każdego wiązania przed jakimkolwiek `continue`:

| Wiązanie | Ft, Fc | Klasa | Zerwane przy budowie |
|---|---|---|---|
| szew między sekcjami | × 0,15 / × 0,25 | 4 | 50% |
| szew w wieńcu (r > R − 45), 85% par sekcji | jw. | 4 | 100% |
| szew mocny (40% par podsekcji, najwyżej 2 na sekcję) | × 1,2 | 4 | 0 |
| pod-szew | × 0,12 × wnętrze | 4 | 50% |
| wnętrze sekcji | × {2,4; 2,8; 3,2} losowo na sekcję | 10 | 0 |
| pas 0–1 skoku przy szwie i pod-szwie | jw. | z modelu (ziarna 4 × 4) | 0 |
| pas ±120 j. wzdłuż toru wieży, 1200 j. | × 0,7 | 4 | 0 |

`iN0` i bity początkowe `m0` we flagach przeliczone po cięciu, więc cięcie budowlane nie liczy się jako szkoda. Bit `pas` na węzeł (`BIT_PAS`): ma choć jedno wiązanie klasy < 6. Klasa dysku tej sceny inna niż w S3: `rozlew` 0,7, `zlom` 0,25, `szok` 0,05, `kontaktSzok` 0,05, `dyskSprezenie` 0 (`S5_NAKLADKA`, budowa przez `parametry`), S3 zachowuje swoje. `dT`, `dC` i reszta parametrów bez zmian, więc solver zostaje na `PARAMETRY`.

**Plan: 38 eksplozji policzonych przy budowie**, ten sam w każdym miejscu. Każda to krater (§ 1.8): węzeł-nosiciel, promień r, ułamek rdzenia, ułamek strefy S = 2, pchnięcie (rP, J, tau, przesunięcie środka dz). Kula rozrywa S = 3 tylko węzły z bitem `pas`, węzeł stojący w kuli idzie do usunięcia.

| Rodzaj | Ile | r (j.) | rdzeń / S = 2 | rP (j.) | J (j./s) | tau | Czas |
|---|---|---|---|---|---|---|---|
| wspornik | 8 | 104 (cały łuk kotwicy na całej wysokości) | 0,2 / – | 306–374 | 168–252 | 0,3 s | 1,5 + d / 320 ± 0,4 + 0,2 |
| główna | 9 | 55–70 | 0,2 / 0,4 | 306–374 | 168–252 | 1 klatka | 3 najbliższe toru jak wyżej bez 0,2; 6 pozostałych + 2,4 s |
| mała | 18 | 32–45 | 0,2 / – | 220 | 90 | 1 klatka | główna + 0,05–0,28 s, wzdłuż szwu po obu stronach kuli głównej |
| wieża | 3 | 215–235 | 0,07 / 0,25 | 300 | 80 | 0,3 s | styk + 1,5–3 s, nosiciel przy osi w ułamkach wysokości 0,25 / 0,5 / 0,75 ± 0,08 |

d to odległość od śladu wieży (odcinek 1100 j.). Pozycje z chciwego pokrycia szwów (promień 240 j.) poza torem wieży. Najwyżej 4 starty na klatkę, kopy bez korekcji momentu (`zerujL: false`). Dwa akty, bo kop przed oderwaniem sekcji idzie w kotwicę i nic nie rozdziela, a po oderwaniu sekcje spadają razem (swobodny spadek nie obciąża): płyty rozdziela dopiero eksplozja w locie.

**Znana słabość, czeka na ocenę użytkownika, nie ruszana.** Przy g z boku do około t = 8 widać głównie jedną spękaną płytę, bo swobodny spadek nie rozdziela kawałków: po wiązaniach największy kawałek ma przy t = 7 już 0,118 dysku (ziarno 21), a płyty lecą jeszcze razem. Zmieniają to (z budowy planu, bez pomiaru; próba: `--testy s5 --ziarna 21 --miejsca g --opcje '{"grupyOpozn":1.2}'`, wiersz „przebieg” ma medianę prędkości po masie): `grupyOpozn` (2,4 s, drugi akt eksplozji: później = sekcje dłużej trzymają się razem), `J` i `Jmala` (210, 90: rozjazd płyt w locie, kosztem K4 i pyłu), `rPabs` (340: zasięg kopu), `tauSzew` (1 klatka), `kotwicaOpozn` i `vFront` (kolejność padania wsporników, więc czy dysk spada całością, czy po kawałku).

**Kamery.** Pole widzenia 32. S5 i S5 planeta: az 32, el 15, cel (0, 0, −650), odl 7200, cień środek (0, 0, −900). S5 próżnia: az 32, el 20, cel = środek masy, odl 7600; kamera i cień jadą stałą prędkością ze środkiem masy z chwili t = 0, orbita użytkownika zostaje. Dalsze kamery filmu: `blisko` (32, 30, (0, 0, −200), 3500), `gora` (20, 89, (0, 0, 0), 4400); w próżni `blisko` (32, 24, (0, 0, 100), 5400), `gora` (20, 89, (0, 0, 0), 7200).

## 6. Ryzyka i budżet

### 6.1 Budżet czasu, RTX 5080, 5120 × 1440

Fizyka zmierzona na GPU w P1, zm. 0,29–0,44 ms/krok, około 5–10 razy poniżej tabeli (§ 1.7, `.tmp/woksele-demo/G1.txt`); reszta tabeli nadal bez pomiaru. Szacunki zostają, żeby było widać, jak się rozminęły. Jednostki zm. w Node (`krytyk-gpu/koszt.mjs`, `koszt-S2.json`, `log-Rst.txt`): 65–68 ms na klatkę przy wieży, hałda 62 ms, S3 około 79 ms. Liczniki na klatkę: stoi 1,47 mln wizyt wiązań, 0,56 mln linii osiowych, 1,86 mln kandydatów listy; hałda 0,63 mln wizyt wiązań, 0,77 mln wpisów listy, 2,7 mln kandydatów. Kotwica 60× z `FIZYKA-BELEK-GPU.md:84–87` dotyczy 386 tys. węzłów dopracowanego GS na rekordzie 16 B; przy 24,6 tys. jest tam 48–80×, przy 6,2 tys. 7–11×. Górna granica fizyki jest więc nieznana do pierwszego pomiaru, a kryterium to **ns na wizytę wiązania i ns na kandydata**, nie ms.

| Część | Szac. | Próg „stop i analiza” |
|---|---|---|
| Fizyka F + I, wieża, na krok | 0,8–2 ms | > 4 ms |
| Lista kontaktów, wieża, stan cały | 0,3–0,8 ms | |
| Lista kontaktów, hałda | 0,6–1,5 ms (L/F zm. 0,93) | > 2 ms |
| Fizyka razem, S3, na krok | 2–4 ms | > 6 ms |
| `kObraz`, `kGruz`, `kPyl`, `kPrzyczyna` | 0,3–0,6 ms | > 1,5 ms |
| `kWybuch*`, tylko w klatkach pchnięcia, 16 slotów | 0,1–0,3 ms | > 1 ms |
| Rysunek brył, MSAA 4, cień 4096², GTAO | 3–6 ms | > 8 ms |
| Pył, Kino (zm. P0, reguła kontaktowa § 4.6: S1 90,6 Mpx po głębi przy t = 9,5, S2 82,5 przy t = 9, S3 14,8; szac. 50–100 Gpx/s; dawniej S2 40 Mpx przy starej regule) | 0,8–1,8 ms | > 3 ms |
| Pył, Bliska bez LOD (zm. P0: S1 299 Mpx po głębi przy t = 9,5, S2 256 przy t = 9, S3 13) | szac. 2,6–6 ms, z MSAA ×2–4 | Z LOD > 4 ms |
| Pył, Zbliżenie bez LOD (zm. P0: S1 1035 Mpx po głębi przy t = 9,5, S2 832 przy t = 10, S3 47, największy kwad 3,3–4,7 Mpx; dawniej S2 271 Mpx) | szac. 8–21 ms, z MSAA ×2–4: bez LOD się nie mieści, R20 | Z LOD > 4 ms |
| Klatka z 1 krokiem | 7–13 ms | > 16 ms |
| Klatka z 2 krokami, S3 | do 17 ms (rachunek) | wtedy 1 krok, § 5.3 |

Liczby pyłu: `node scripts/woksele-sym.mjs --koszt-pylu S1|S2|S3`, wynik `.tmp/woksele-demo/koszt-pylu-*.json`, 5120 × 1440, pula 16 000, emisja S1 2981, S2 3049, S3 1020 cząstek, bez LOD i sufitu. Pamięć: § 2.2. Czas CPU: 26–32 dispatchy three r183, szac. 0,3–0,5 ms. Pomiar: § 8.

Dźwignie, gdy za drogo, w tej kolejności: cień 2048 co drugą klatkę bez gruzu, `setIndirect` dla brył, MSAA wył. przy Zbliżeniu, pył LOD i połowa puli, skala rozdzielczości 0,75, L = 2. Fizyka nie ma trybu niskiego: podkroków nie wolno zmniejszać (`h·ω = 1,25` przy granicy 2), rytm listy przesuwa wynik dysku (§ 2.4), innego dx nie liczono. Ratunkiem fizyki jest spowolnienie. `?jakosc=niska` składa te dźwignie (bez fizyki), każdą pozycję A/B na kadrach § 7. Pliki i układ: `wWiaz` po dwa vec4 zamiast trzech osobnych buforów (`FIZYKA-BELEK-GPU.md:162–165, 273`: seria poprawek układu dała 10,7 → 3,4 ms/krok w solverze belek); pilot R6 rozstrzyga, czy sklejać też pozycję z prędkością. Kolejność Mortona dla dysku: § 11.

### 6.2 Ryzyka

| # | Ryzyko | Jak sprawdzić |
|---|---|---|
| R1 | Użytkownik uzna S1 albo S2 za suche albo „za bardzo sypkie”: po zmianie fali góra nie jest już regularna, ale może wyglądać jak luźny słup. Ziarna: 4,2–10,1° przechyłu | Pierwsze oglądanie w ruchu, K3. Tempo fali ma jedną dźwignię bez dotykania materiału: 15 szybciej, 9 obecnie, 7 taca wraca |
| R2 | Ruch jest gorszy niż kadry: drżenie płyt, teleporty odłamków, wibrujący gruz | Krótkie sekwencje PNG co 1/60 s z `__wok`, oglądane klatka po klatce, § 7 |
| R3 | Dysk jest ostry na sprężeniu (końcowo 0,5% → 2,62 przy kontaktSzok 1,0 i gProj = 400, § 1.6; 2,33 przy gProj = 260). Do S3 doszła jeszcze jedna zależność: bez `kontaktSzok` otwór spadał do 1,59, bo pocisk kruszy się wcześniej. Zm. bez rytmu: 0,5% → otwór 1,51; 0,7% → 1,84; 0,85% → 4,52; 1% → 12,4. Z rytmem 4: 0,6% → 1,81; 0,7% → 3,72. Po lepkości z kotwicą (§ 10): 0,6% → 4,05, 0,5% → 1,74; po gProj = 400: 0,5% → 2,41. Każda zmiana modelu przesuwa ten próg, więc f32 na GPU też może | Test zgodności S3 przy 0,4, 0,5, 0,6%. Rezerwa: 0,4% (niesprawdzona) |
| R4 | Stały rytm listy na końcowych parametrach zmieni wynik | ZAMKNIĘTE: sprawdzone w Node (§ 2.4), końcowe parametry mają rytm 4 |
| R5 | f32 na GPU zmieni W1 albo wysadzi symetrię kopii | Odczyt `wWez`, `wMaska` w `?test=1`, W1 przez 60 s. Zm. P1: W1 0,0108 j., 0 zerwań, 0 asymetrii, § 1.7. Dalszy bieg z rozjazdem dopiero w progach chaotycznych, P2 |
| R6 | Kod rozbieżny (18 bitów, sieć) jest droższy niż płaski solver belek, na którym oparto kotwicę 60× | ZAMKNIĘTE dla fizyki: zm. kF przy 15 tys. 0,16–0,22 ms/krok, § 1.7 |
| R7 | Płaski obraz bez SSAO | § 4.3 |
| R8 | Plastyczne zginanie bez stanu zawraca: płyta odgina się z powrotem, bo nie ma trwałego ugięcia. Na kadrach niewidoczne, w ruchu może wyglądać jak guma | Kadr co 1/60 s. Rezerwa: bit przegubu w masce (bity 18–23 są wolne) |
| R9 | Fala łamie granice i jest regułą, nie wynikiem mechaniki (§ 1.3). Strzał r = 90 przy J = 600 nisko zwykle kładzie wieżę (16/32), bo wystarczy ruch ponad 60 j./s wokół. Na małym strzale nie (32/32) | Mapa `mapa5.mjs` po każdej zmianie fali. Dźwignia: próg prędkości `fala.v` |
| R10 | Budynek w innej skali albo kształcie | Hala już zawodzi, § 1.4 |
| R11 | Pipeline'y rozgrzewki i `compute` przed pierwszym użyciem | `harness-strona.js`, ma być 0 synchronicznych |
| R12 | Zbiór trafiony kopem i suma stałoprzecinkowa: dryf całości na GPU | `\|P\|/N` w `?test=1` ≤ 0,05 j./s, § 8. Zm. przy zaokrągleniu 0,0001. W Node 0,02 j./s bywa bez korekcji momentu: asymetria list przy przepełnionej komórce (`przKom`) |
| R13 | Sprężystość w próżni: połowy po cięciu dzwonią, wiązania stropów słabną powoli (`diag-pelz.mjs`: 320 zerwań w 10 s lotu, bez widocznych skutków). Niskich częstości nic nie tłumi, a tłumienie linii zginania nie pomogło (`zetaB` 0,1 prawie bez zmian, 0,3 niestabilne) | Sekwencja 30 klatek po t = 8: czy fasada się rusza |
| R14 | Rampa grawitacji w czasie zawalenia: ściśnięta sprężyście hałda odbija: 0,5 s rampy daje +58 j./s, 3 s +14 j./s (`logG-R4b.txt`, `logG-R4c.txt`) | Rampa 3 s; przebieg `G` w czasie zawalenia obejrzeć w ruchu |
| R15 | Kotwice puszczają na gruncie: wieża się wali sama (`logG-K2b.txt`), bo stopy kolumn wchodzą w grunt. Poza demem. Do gry potrzebna ściana podporowa albo rozłożenie reakcji | Nie wchodzi w demo: dolna warstwa na gruncie zawsze `stoi` |
| R17 | ZAMKNIĘTE po zmianie fali. Przy 200 / 400 S1 kończy się przechyłem spójnym 3,6° i dachem 154 (`proby4/log-Rg200.txt`), przedtem 36°. Zostaje: nie wiadomo, czy to mechanika, czy skutek reguły | § 10.5 |
| R16 | Budynek nie stoi w polu innym niż projektowe: g = 400 przechylone o 11° kładzie wieżę bez strzału w 2 s (`log5-N11.txt`). Zgodne z fizyką, nie zapasem. Plan gry mówi o 11° odchylenia studni skały | Budowla bazy zostaje na −z habitatu, jak w planie § 3.2 |
| R18 | Przy budowie innej niż Node bajt w bajt S1 wygląda jak inne ziarno | Test budowy, § 9. Wybór ziarna 7 jest opisany w § 1.2 |
| R19 | Lista zgodności przechodzi przy brakującej gałęzi | Test jednego podkroku, § 8. Progi ±80 j. przepuszczają brak fali i plastycznego zginania |
| R20 | Pył przy regule kontaktowej jest droższy, niż zakładał budżet: zm. P0 Zbliżenie 832–1035 Mpx po głębi zamiast 271, Kino 83–91 zamiast 40. Cząstki leżą nisko, rosną w chmurze przy gruncie, a kamera stoi przy nich. Sam rachunek: rysowanie co czwartego dużego kwadu daje około 260 Mpx, czyli szac. 2,6–5,2 ms bez MSAA, na granicy progu 4 ms | P4 i pomiar A/B w P6, § 8. Dźwignie: § 6.1 (połowa puli, MSAA wył. przy Zbliżeniu), sufit promienia w px |

### 6.3 Kilka budowli, usypianie, gra

Demo ma jedną wieżę (S3: wieżę i dysk). Budżet razy 4 wieże to 4,8–12 ms samej fizyki, a sędzia wskazywał 40–60 tys. aktywnych węzłów. Stojąca wieża kosztuje tyle co walenie (zm. 65 kontra 62 ms), więc bez usypiania nie ma miejsca na więcej. Projekt, bez kodu w demie poza danymi: grupa budowli w bitach 11–15 flag i tablica `grupaTab`. Uśpiona grupa: wczesne wyjście w kF, kI, kLista, kObraz po odczycie flagi (szac. poniżej 0,05 ms na wieżę), `kWstaw` działa, żeby aktywni ją widzieli. Budzenie: `kCzas`, `kKrater` i `kLista`, gdy kandydat z uśpionej grupy wchodzi w zasięg, bit w storage czytany w następnym podkroku. Decyzja o uśpieniu: rzadki odczyt `max|v|` na CPU; **tylko w scenie z ramą**, bo węzeł w ruchu jednostajnym to nie spoczynek, a w próżni uśpienie zatrzymałoby lot. Node usypiania nie ma. Oddzielne `dispatchSize` per kernel nie istnieją w jednej liście: `Renderer.compute` podaje ten sam każdemu kernelowi, więc wybór idzie przez uniformy i osłony, nie przez liczniki. Próba z dwiema wieżami: poza demem, § 11.

## 7. Lista kontrolna wyglądu

Zrzuty na kamerach z § 4.7, chwile jak w arkuszach, 1600 × 900, a wiersze Kino także 5120 × 1440. **Oceniający to osobny agent bez kontekstu prac:** dostaje kadry i słowa użytkownika („sucho”, „plastikowa wydmuszka”, „kupa kształtów”, „wszystko jest sztywne”) i odpowiada, czy pasują. Autor kerneli nie ocenia. **Odrzucenie = co najmniej jedno „nie” w wierszu [!].** Odniesienie: `proby4/fin11/*_arkusz.png`, liczby: `proby4/miary4.py`. Na obecnym `fin11` lista daje „nie” w wierszach: pręt S3 t = 1,5–2 (brak wyrzutu), pas gruzu na pokładzie, S3 wnętrze otworu, wszystkie wiersze błysku, a nieoceniona jest cała kolumna ruchu.

| Kadr | Wiersz |
|---|---|
| S1 Kino t = 0, 1 | [!] Budynek ma beton i ciemną fasadę, a nie jedną barwę. [!] t = 0 i t = 1 identyczne, bez drżenia |
| S1 Kino t = 3,5–4,5 | [!] Przechył bloku ≤ 8°, liczony tak jak spójny w § 8, dopóki górny kawałek ma ≥ 30% piętra. Góra nie stoi jako nietknięty blok |
| S1 Bliska t = 4,5–5 | [!] Co najmniej 2 z 4 płyt nad frontem mają największy kawałek < 80% (metryka `taca`) i widać to na kadrze jako pęknięcia, nie mozaikę |
| S1 Bliska t = 5–6 | [!] Dach: największy kawałek ≤ 50% co najmniej 0,3 s przed dotknięciem hałdy; taca w jednym kawałku to odrzucenie |
| S1 Zbliżenie t = 7 | [!] Co najmniej 3 kawałki wyraźnie większe od reszty (płyta, kikut, ściana). [!] Brak jednakowego załamu na odłamkach i gładkich ścian złomu. [!] Plan budynku nie czyta się z barw. Czy widać pręty? Pył nie wypłukuje kadru: widać bryły |
| S1 Bliska t = 6 | [!] Beton i blacha, nie tektura ani styropian: co najmniej dwa materiały. [!] p5, p50 i udział ciemnych ±15% od `fin11` (p5 49, p50 134, ciemne 10,5%, nasycenie 7,4%, liczby z SSAO: po P3 poprawić odniesienie) |
| S2 Bliska t = 2,0–2,3 | [!] Równa szczelina bez gruzu to odrzucenie. [!] Widać przyczynę: błysk i pył w chwili zdarzenia |
| S2 Kino t = 3–4 | [!] Kruszenie w kilku strefach naraz. Nie wsiąkanie w żwir |
| S2 Bliska t = 4,5 | [!] Bez zasłaniającej chmury równych kostek. Duże bryły i małe obok siebie |
| S2 Zbliżenie t = 6–7 | Jak S1 Zbliżenie t = 7 |
| S3 Kino t = 2–3 | [!] Pocisk przechodzi, nie staje. Pod dyskiem najpierw budynek, potem gruz, oba widoczne (bez czarnej plamy) |
| S3 Z góry t = 3 | [!] Co najmniej 3 pęknięcia. [!] Pas gruzu wokół otworu szeroki na co najmniej 0,5 przekroju, gruz leży na pokładzie. [!] Otwór nieregularny, nie prostokąt |
| S3 Bliska t = 1,5–2 | [!] Pocisk wchodzi z wyrzutem gruzu i pyłu, nie jak klocek w piankę |
| S3 Bliska t = 2,5–5 | [!] Wnętrze otworu ciemne. [!] Reszta dysku stoi: brak płatów większych niż 3× przekrój wypadających w dół (skarga nr 3). Zgięte płaty: odnotować (dziś nie ma) |
| S3 Zbliżenie t = 3 | [!] Brzeg to pokruszony materiał, nie sztanca. [!] Nienaruszony pokład bez kratki, kropek i łat Voronoi. [!] Wieniec bez schodków |
| Odporność | [!] Po kolumnie i dwóch kraterach r = 60 wieża stoi, chwianie ≤ 1° |
| Strzał, Bliska | [!] Po 0,3 s w wyrwie i pod nią co najmniej 20 odłamków; czysta dziura to odrzucenie. [!] Błysk, pył. Kop zgodny z kierunkiem strzału |
| S4 Kino t = 1 | [!] Budynek wisi w pustce, bez gruntu i cienia na gruncie, nieruchomo |
| S4 Kino t = 2,0–2,5, kamera na cięciu | [!] Równa szczelina bez gruzu to odrzucenie. [!] Widać przyczynę. Front nierówny, góra unosi się od +x jak otwierana książka |
| S4 Kino t = 5–8 | [!] Góra i dół oddalają się w przeciwne strony. [!] Obie się obracają. [!] Poza strefą cięcia stropy i fasada bez wyrw. [!] Czyta się jako przepołowiony budynek, nie zawalenie. [!] Akcja zajmuje co najmniej 1/4 wysokości na 32:9 |
| S4 Bliska t = 6–8 | Kikuty słupów i wyrwane płyty, nie gładka sztanca. Kawałki poszarpane, nie klocki T i L |
| S4 Kino t = 14 | [!] Dwie rozpoznawalne połowy i rzadka chmura, która leci dalej, nikt nie staje |
| S6 Kino t = 3–7 | [!] Ten sam plan zdarzeń co S4, wieża się miażdży, żadna połowa nie odlatuje. [!] Przechył bloku ≤ 12°, dopóki największy kawałek góry ≥ 30% (zm. 10,6° przy 29%, `logG4-g.txt`, margines mały). Obok S4 przy tej samej kamerze: widać, że różni się tylko miejsce |
| Z góry, S1, S2, S4 | [!] t = 4–5: dach pęknięty, odłamki spod dachu, kurz z krawędzi. Biały kwadrat z frędzlami to odrzucenie. Jeśli nie przejdzie: kamera wypada z panelu |
| Pył, wszystkie | [!] Biała ściana na kadrze: odrzucenie. [!] Na t = 4–6 w miejscu dawnej wieży nie wisi pył o jej obrysie. [!] Przy t = 6–7 pył rozlewa się po gruncie. Ostre cięcia pyłu o bryły? |
| Ruch S4, sekwencje 30 klatek, t = 8 | [!] Połowy lecą gładko, obrót równy. Fasada dzwoni widocznie (R13)? |
| Ruch S1, S2, sekwencje 30 klatek przy t = 4 i 5 | [!] Drżenie gruzu w spoczynku. [!] Teleporty odłamków przy utracie wiązania. [!] Migotanie drobnych brył na Kino. Płyty jak guma (R8)? Gruz pełznie po 3 s od spoczynku? |

## 8. Harness w tle

### Krok 0: przed pisaniem kerneli (Node, sprawdza R4)

Zrobione: rytm co 4 podkroki to parametr końcowy (`log4-R1.txt`, `R2`, `R3`, § 2.4). P0 domknięte, § 1.6.

### Narzędzie

`scripts/webgpu/woksele-demo.mjs`, wzór `scripts/webgpu/zawalenia-demo.mjs`: `parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo` z `wspolne.mjs`, `gryUzytkownika, obceProcesy` z `sondaGpuWorkera.mjs`, `harness-strona.js` wstrzyknięty przez CDP. Chrome headless, więc okno nie wychodzi na wierzch (`startChrome` domyślnie `--headless=new`). Gra w toku (League of Legends, czyli sam mecz, RuneScape, Dragonwilds, RSDragon, osclient, G1R-Win64-Shipping): harness czeka co 30 s, najwyżej 30 min, potem kod 3, i sprawdza przed każdą sceną. Własny test, bo `gryUzytkownika()` łapie sam otwarty klient League i nie łapie Gothic 1 Remake. Karta: `device.adapterInfo` przy każdym wyniku, na AMD albo rasteryzatorze odmowa, kod 4. A/B po kolei, nigdy dwa harnessy naraz. Wyjście: `.tmp/woksele-demo/`.

API strony w `?test=1`: `window.__wok = { gotowe, ustawScene(id), krok(n), kamera(nazwa), pyl(wl), strzel(o, dir, r), wgraj(stan), odczyt() → { poz, mask, stan }, czasy() → { fizyka, lista, obraz, klatka, pylAB }, ziarnoBudowy() }`. Zegar ręczny: kroki tylko przez `krok(n)`, bez czekania na rAF przy zatrzymanym zegarze (AGENTS). Test dziennika: po rozgrzewce dziennik pipeline'ów nie jest pusty, a synchronicznych 0.

Flagi: `--sceny 1,2,3,4,5,6 --chwile ... --kamery cala,blisko,bardzo --rozmiar 1600x900 --pomiar 5120x1440 --sekwencja 30`. Zrzut: `screenshotPng`. Arkusz jak w Node.

### Pomiar czasu klatki (Z4)

Goły `WebGPURenderer` gubi czasy: tablica nie ma `isComputeNode` ani `id`, więc każda lista dostaje uid `r:0:undefined:f0` (`Backend.js:449`), pula nadpisuje wpis (`WebGPUTimestampQueryPool.js:66`) i zostaje ostatnia lista. Core3D łata to u siebie (`_uniqueComputeListTimestamps`, `core3d.js:1353–1372`), a demo ma własny renderer. Pomiar:

1. `glowny.js` przed pierwszym compute owija `backend.updateTimeStampUID` jak Core3D i czyta czasy po uid z `pool.timestamps` (lista → kubełek), czyszcząc mapę po wyniku (three sam jej nie czyści). `zegarGpuKlatki.js` tu nie pomaga: to rozliczenie z haka Core3D, liczy też klatki bez compute.
2. Fizyka jako **ms na KROK**, nie na klatkę. Przy zatrzymanej pętli: `krok(1)`, jeden render, czekanie na wynik. Pętla rAF bez limitu nadpisuje querySet (`FIZYKA-BELEK-GPU.md:339`).
3. Flaga `--enable-webgpu-developer-features` w harnessie: bez niej znaczniki są kwantowane do 100 µs. `scripts/webgpu/wspolne.mjs` jej nie ma, dodaje ją tylko `woksele-demo.mjs`.
4. `?profil=1`: każdy kernel przez `renderer.compute(kX)`, wynik **tylko do proporcji**: R6 czyta z tego czas kF i kLista (profil zawyża drobne kernele).
5. Pył: rysunek brył i pyłu to jeden pass, więc jeden znacznik. Pył jako różnica A/B wł./wył. na tej samej zatrzymanej klatce; napis w panelu dotyczy wyłącznie `kPyl`.
6. `--pomiar 5120x1440` i `--pomiar 11,5Mpx` (preset Ultra użytkownika, `docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md:381`), A/B MSAA, S1 i S2 do t = 10, bo szczyt Zbliżenia pyłu jest przy t = 9–10, kamery Kino i Zbliżenie. Fazy: stan cały, zawalenie, spoczynek.
7. Osobno rytm: headless z taktem, **bez** `--disable-frame-rate-limit`, średnia, p95, maks., obok `nvidia-smi`. Klatki z krokiem i bez na zmianę mogą trzymać albo gubić 8,33 ms przy 120 Hz. Przy obcym obciążeniu oznaczyć `obce`.
8. Test: dwie listy o znanym stosunku pracy dają dwa niezerowe czasy.

### Test zgodności GPU z Node

Referencja: `dema/woksele-zawalenia/wzorzec-cpu.js` (kopia `proby4/model-spec4.mjs` bez gałęzi wyłączonych), `scripts/woksele-sym.mjs` liczy te same sceny w Node i zapisuje migawki oraz metryki. GPU: `__wok.odczyt()` w tych samych chwilach (`getArrayBufferAsync` tylko w teście, `?test=1`), metryki na CPU z tego samego kodu (`metryki.js`: `ObserwatorSceny`, `analizaPolowek`, `taca`, `porownajPodkrok`). Wyniki Node: `.tmp/woksele-demo/migawki/` (`metryki-*.json`, `linie-*.txt`, `tabela-8.txt`), opis migawek: § 1.6.

**Krok obowiązkowy przed progami: jeden podkrok z migawki.** `__wok.wgraj(stan)` z migawki Node (S1 t = 3,5 i t = 5, S3 po kontakcie, S4 t = 3, S2 t = 3), jeden przebieg kLista + kF i porównanie węzeł po węźle: maski 0 różnic, S, A, L, D do 1e−3, |Δa| do 5, NaN w żadnym polu (§ 1.6). Zm. f32 kontra f64: |Δa| maks. 2,94 (t = 3,5), 1,51 (t = 5), maski różne 0, S, A, L, D różne 0, a każda mutacja wykryta: fala A różne 10 762, para |Δa| p99 281, lepkość p99 132, zlomB 42 maski, wypiek 90° F0 w 10 wiązaniach, kontakt S w 2 węzłach, szok S w 26, rozlew S w 5406, kruszenie L w 5036 (`krytyk-wiernosc/krok1.mjs`; czego sterownik doda przez FMA, nie sprawdzone). Progi chaotyczne niżej przepuszczają brak fali, `zlomB`, `kontaktSzok` i pary (zm. `krytyk-wiernosc/log-M*.txt`), więc są ostatnią kontrolą, a nie dowodem wierności. Ten sam test dla `falaPeka`: maski z mutacją wyłączenia muszą się różnić (zm. na kodzie końcowym przy S1 t = 3,5, S2 t = 3, S3 t = 0,8; przy S1 t = 5 nie, § 1.6).

**Zaokrąglenie przy progu, poprawka P1 (§ 1.7).** Liczby progów bez zmian, ale wynik f64 nie jest osiągalny dla żadnego kernela f32, gdy siła leży o ułamek ulp od progu. Dlatego harness liczy trzy porównania tymi samymi progami: GPU − Node f64, GPU − Node f32 (`wzorzecF32.js`: każde działanie przez `Math.fround`, kolejność kernela) i Node f32 − f64. Różnica względem f64 nie oblewa wyłącznie wtedy, gdy spełnione są naraz: GPU − Node f32 zalicza, Node f32 − f64 nie zalicza, a każde wiązanie z różnicą L lub D ma w Node f32 tę samą wartość co na GPU. Każda inna różnica oblewa, a liczba przebiegów zaliczonych wprost względem f64 zostaje w wyniku. Reguła obejmuje też F0 (do 1, siła), bo od P2 F0 wchodzi do zaliczenia. Lista kontaktów bez przepełnionej komórki ma być identyczna.

**Poprawka P2 (§ 1.8).** Wynik „po” liczy `WzorzecCpu` na stronie przy S = 24 z migawki „przed”: migawki P0 policzono przy S = 16, a stan „przed” to tylko punkt na trajektorii. `krokZWzorcem`: 8 całych kroków z migawek S1 t = 3,5, S3 t = 2,95, S4 t = 3: 0 różnych masek, a lista różna tylko na granicy zasięgu (pozycje f32 i f64 różnią się już o `dxMax`) albo przy przepełnionej komórce.

Progi chaotyczne, z obserwowanego rozrzutu (ziarno 7 / 21, `proby4/log-R7.txt`, `log-R21.txt`, `log-Q21.txt`, `logG4-*.txt`; wiersze S3 przy gProj = 400 z `.tmp/woksele-demo/migawki/linie-S3.txt`, `linie-S3z21.txt`, § 1.6):

| Metryka | Node, ziarno 7 / 21 | Próg GPU |
|---|---|---|
| W1: przemieszczenie przy końcu 60 s | 0,0106 j., f32: 0,0108 j. | ≤ 0,5 j., 0 zerwań |
| Dach S1, t = 3, 4, 5, 6, 7 | 1295, 1047, 582, 217, 174 / 1300, 1072, 630, 218, 176 | ±80 j. |
| Dach S2 z frontem, t = 3, 4, 5, 6 | 1216, 1029, 545, 234 / 1215, 1044, 666, 318 | ±130 j. przy t = 5, 6, inaczej ±80 |
| Przechył spójny S1, S2 | 4,2°, 2,8° / 5,3°, 0,9° | ≤ 8°, tylko przy budowie identycznej bajtowo |
| Płyty S1 przy t = 5: największy kawałek dachu | 8% / 10% (ziarno 1: 42%) | ≤ 50% |
| Płyty S1 przy t = 4,5: płyty nad frontem < 80% | 4 z 4 (`log-P11.txt`) | ≥ 2 z 4 |
| Masa w kawałkach 8–63, S1 | 58% / 54% | ≥ 45% |
| Masa w pojedynczych, S1 | 12% / 11% | ≤ 20% |
| S3 v / swobodna | 0,87 / 0,88 | ≥ 0,8 |
| S3 otwór / przekrój | 2,62 / 2,22 | 1,2–4 |
| Kolumna, narożnik: dach przy t = 14 | 1309–1310 | ≥ 1290 |
| Krater r = 60, rdzeń i rozerwanie, 6 miejsc z mapy | stoi | stoi |
| S4: dryf przed cięciem | 0,0000 j. | ≤ 0,01 j. |
| S4: prędkość góry, dołu wzdłuż z | +37,5, −34,1 / +35,8, −29,5 (inne cięcie: +33,8, −31,8) | góra +28…+45, dół −25…−42 |
| S4: obrót góry, dołu | 4,8, 3,3°/s / 4,9, 2,9 (3,7, 4,7) | 2–7°/s, obie > 0 |
| S4: suma pędu \|P\|/N po cięciu | ≤ 0,02 j./s (stały przecinek z zaokrągleniem 0,0001, `log-Fx4.txt`) | ≤ 0,05 j./s |
| S4: suma momentu pędu do momentu jednej połowy | 0,2% (bez korekcji 12–40%) | ≤ 2% |
| S4: największy kawałek połowy | góra 89–94%, dół 97–99,5% | ≥ 85% |
| S4: węzły z S > 1,001 po przebiegu czyszczenia | 0 | 0 |
| S4: oderwane poza strefą cięcia (±120 j.) | ≤ 0,23% | ≤ 2% |
| S4 przy g = 400: masa w 8–63, największy kawałek połowy przy t = 9; przechył góry przy t = 5,5 | 54%; 1%, 16%; 10,6° (`logG4-g.txt`) | ≥ 40%; ≤ 30%; ≤ 14° |
| Równoważność: swobodny spadek g = 400 względem próżni | te same prędkości co do 0,1 j./s, największe kawałki 92,6% i 99,5% (`logG4-sw.txt`), mediana odchyłki węzła 0,25 j. (`log7-G8c.txt`) | ≤ 2 j. (S4 przy `g: 400`, bez gruntu i kotwic, odjąć spadek) |
| Rampa g 400 → 0, stojąca wieża, koniec v_max | 0,07 j./s | ≤ 1 j./s |
| NaN, symetria masek | 0 / 0 | 0 |
| Odrzucone wstawienia do komórki (z pozycji co 15 klatek, licznika w `wLicz` nie ma) | zm. S2 142, S4 778 przy S = 16 (`tabela-8.txt`) | ≤ 3 × Node. Przepełnienia listy M = 32: zm. 0, M = 20: 283 bez skutku, więc wiersza nie ma |

Rozjazd w kierunku „sztywniej” albo „sucho” to błąd portu, nie wariant: szukać w kolejności gałęzi § 2.11. Kolejny krok portu nie startuje, dopóki ten test nie przechodzi. Test równoważności łapie każdą pozostałą zależność od prędkości bezwzględnej.

### Tabela S5 (K1–K6)

Progi: K1 kąt ≥ 20° przy styku i oś otworu ≥ 1,5. K2 przy g, t = 12: największy ≤ 20% dysku, 64+ ≥ 40%, drobnica 1–7 ≤ 35%, resztka na kotwicach ≤ 3%. K3 ≥ 90% dysku 500 j. pod płaszczyzną, wieża na gruncie przed pierwszym dużym kawałkiem. K4 w próżni: ΔP/N ≤ 0,5 j./s, mediana po masie 5–80 j./s, największy ≤ 35%, brak 8+ ponad 400 j./s. K5 0 NaN. K6 najwyżej 40 eksplozji, 4 na klatkę. GPU: `node scripts/webgpu/woksele-demo.mjs --testy s5 --ziarna 21,7`.

Node (`bieg.mjs` + `ocena.mjs`, parametry domyślne `scena5.mjs`):

| Ziarno | Styk: kąt / oś otworu przy przejściu szczytu / t = 3,6 | K2 t = 12: największy / 64+ / 1–7 | K3: wieża / 64+ / 512+ (udział wieży na gruncie) | K4 t ≥ 10: ΔP/N / środek masy / mediana po masie / bez wag / po węzłach / maks 8+ / największy | Próżnia: czystość / liczba 64+ / odcinek wieży |
|---|---|---|---|---|---|
| 1 | 25,7° / 2,28 / 1,89 | 0,041 / 0,576 / 0,308 | 3,72 / 3,93 / 4,17 (0,272) | 0,036 / 2,9 / 63,3 / 90,9 / 79,6 / 234,1 / 0,134 | 0,843 / 32 / 0,18 |
| 7 | 25,7° / 2,00 / 2,37 | 0,052 / 0,68 / 0,25 | 3,75 / 4,03 / 4,77 (0,957) | 0,074 / 2,55 / 66,2 / 77,6 / 67,1 / 316,2 / 0,135 | 0,85 / 33 / 0,20 |
| 21 | 25,7° / 1,86 / 2,46 | 0,048 / 0,631 / 0,275 | 3,87 / 3,93 / 4,03 (0,13) | 0,082 / 2,36 / 77,2 / 99,6 / 88,3 / 286,3 / 0,114 | 0,793 / 33 / 0,22 |
| 42 | 25,7° / 2,22 / 2,33 | 0,038 / 0,649 / 0,263 | 3,67 / 4,3 / 4,3 (0,377) | 0,116 / 1,98 / 64,9 / 86,1 / 74,9 / 264 / 0,171 | 0,759 / 28 / 0,18 |
| 3 | 25,7° / 2,17 / 2,59 | 0,042 / 0,637 / 0,279 | 3,68 / 3,9 / 7,33 (0,992) | 0,069 / 2,42 / 70,3 / 99,1 / 74 / 342,5 / 0,138 | 0,827 / 30 / 0,24 |

GPU (RTX 5080, ten sam plan i te same bajty budowy, kolumny jak wyżej, K4 do t = 14):

| Ziarno | Styk: kąt / oś otworu przy przejściu szczytu / t = 3,6 | K2 t = 12: największy / 64+ / 1–7 | K3: wieża / 64+ / 512+ (udział wieży na gruncie) | K4 t ≥ 10: ΔP/N / środek masy / mediana po masie / bez wag / po węzłach / maks 8+ / największy | Próżnia: czystość / liczba 64+ / odcinek wieży |
|---|---|---|---|---|---|
| 7 | 25,7° / 1,98 / 2,37 | 0,051 / 0,669 / 0,254 | 3,75 / 4,03 / 4,77 (0,956) | 0,077 / 2,53 / 67,8 / 80,4 / 68,2 / 312,9 / 0,135 | 0,858 / 35 / 0,20 |
| 21 | 25,7° / 1,86 / 2,48 | 0,049 / 0,64 / 0,283 | 3,83 / 3,9 / 4 (0,104) | 0,079 / 2,38 / 74,4 / 116,1 / 86,1 / 288,1 / 0,114 | 0,801 / 33 / 0,22 |

GPU: 0 NaN, 0 asymetrii masek, 0 błędów GPU. K6: 38 eksplozji, 2 na klatkę, 3 pchnięcia równocześnie, 0 pominiętych. S5 planeta na GPU (ziarna 7, 21): największy 0,05 / 0,048, 64+ 0,649 / 0,59, 1–7 0,283 / 0,311, kotwice puszczają w klatce 280 / 273.

Node: 0 NaN, 0 błędów maski, 0 błędów L. Kontrola w próżni bez styku i bez eksplozji, ziarno 7, 6 s: 0 zerwanych wiązań. S5 planeta w Node (ziarna 7, 1, 21): największy 0,05 / 0,041 / 0,048, 64+ 0,661 / 0,537 / 0,589, 1–7 0,267 / 0,346 / 0,316. Zapasy, które chaos może przesunąć: drobnica 1–7 przy g do 0,308, mediana K4 po masie do 77,2, `64+` w próżni 28 przy celu 28 na ziarnie 42.

### Kolejność pracy nad demem

Pakiety, punkty oceny i warunek porażki: § 12.

## 9. Reguły repo do spełnienia

- **TSL bez GLSL** (zasada 3, `tests/graBezGlsl.test.mjs`). Bez `wgslFn`, wszystko wyraża się w TSL.
- **Graf raz** (zasada 4): jeden materiał brył, jeden pyłu; wartości w storage. Bez `defines`, bez `needsUpdate` na materiale w biegu.
- **Zero pipeline'ów w klatce** (zasada 5): przed pierwszą klatką `await renderer.computeAsync(k, [0, 1, 1])` dla każdego kernela (puste dispatche, wzór rejestru rozgrzewki `Core3D.warmup`), `compileAsync` na siatkach, pass cienia z `castShadowPositionNode` (pułapka 20: zwykłe `compileAsync` go nie rozgrzewa), MSAA i GTAO w tym samym kluczu. `window.__HARNESS_RENDERER__`, inaczej harness nic nie widzi. Ma być 0, a dziennik niepusty.
- **Moduły solvera bez `window` i DOM** (zasada 6), w tym `kObraz`. Szew w demie nie obowiązuje, ale port ma wejść bez przeróbek.
- **Bez alokacji w pętli** (zasada 7): lista kerneli, uniformy, bufory raz; `krok` bez nowych tablic i domknięć. `Math.sqrt`, nie `Math.hypot`, w kodzie JS pętli. Dotyczy kodu dema: `renderer.compute` alokuje sam, więc najwyżej 3 listy na krok poza `?profil=1`.
- **Krok 60 Hz, stałe przez `stepDecay120`, `ticksAt120`** (zasada 8): demo ma własny krok, wartości z § 2 są na podkrok h i na sekundę. `fala.tempo`, `lepL`, `gruzPara` są na sekundę, ale przy dx ≠ 20 `tempoH` w Node trzeba poprawić, § 2.1. Numer kroku z licznika całkowitego.
- **`fxRandom` zamiast `Math.random`** (zasada 9, `tests/wizualiaFxRandom.test.mjs`): obraz i pył używają haszy po stronie GPU; budowa własnego PRNG z ziarnem (`wspolne/prng.mjs`, mulberry32).
- **Bez `public/`** (zasada 10). Vite bez zmian, dema jak inne.
- **Pułapki three r183** (`.claude/rules/webgpu-tsl.md`), dotyczące tego dema:
  - najwyżej 8 buforów wierzchołków (`maxVertexBuffers`): tu tylko pozycja sześcianu, reszta w storage;
  - (17) `map = null` przy `castShadow` na gołym materiale; (20) pass cienia w rozgrzewce;
  - (24) `InstancedBufferGeometry` zamiast `InstancedMesh` (uuid w kluczu);
  - (25) `setName` na każdym buforze i `uniformArray`, inaczej każdy egzemplarz to inny WGSL;
  - (29) pochodne w gałęzi: `normalFlat` tylko poza `If`;
  - (39) `select` zagnieżdżone poza `Fn`: pozycję wierzchołka liczyć w `Fn`, węzły wspólne przez zmienne;
  - (40) `.toVar()` o typie ze stałej (`vec3(0).toVar()` + `assign`) przy wielokrotnym użyciu;
  - (42) dotyczy atrybutów `instancedBufferAttribute` ze zwykłym `BufferAttribute`: tu bez atrybutów instancji, dane w storage, więc pułapka odpada, dopóki nikt ich nie doda;
  - nowa, zm. P1: `UniformsGroup.updateVector4` porównuje `a[offset + 4]` zamiast `a[offset + 3]`, a `new Vector4()` ma w = 1: bez uniformów vec4 (§ 1.7, § 10.4). Do reguły `webgpu-tsl` przy P8;
  - pułapka uuid (`src/3d/tsl/uuidWezlow.js`): import zaraz po `three/webgpu`, gdy harness resetuje ziarno;
  - `pow` z ujemną podstawą to NaN: nie używać, potęgi przez mnożenie;
  - `discard` nie kończy wykonania: nieistotne, tu nie ma ciężkich pętli w fragmencie;
  - `vertexNode` / `positionNode`: wzór `dema/zawalenia-budowli/obraz.js`.
- **Testy**: `node --test "tests/*.test.mjs"`; nowe testy w `tests/` bez mierzenia ściany: budowa **bajt w bajt** z `proby4/model-spec4.mjs` (Ft, Fc, L, R0, F0, klasa, etykieta, bMax², aLos, rk, flagi, sąsiedzi) dla S1, S3, S4, losowanie w tej samej kolejności; gProj = 0 daje zera bez NaN, bez kotwic F0 = 0 i brak `stoi`, S4 od razu: suma pędu zbioru kopu 0; WGSL kerneli z `createNodeBuilder`: ≤ 8 `var<storage`, atomiki tylko w `kWstaw`, `wLicz`, brak literału `Infinity`, `read` na buforach tylko czytanych, `round` w kWybuchSuma; `kCzysc` bit w bit z Node.
- **Reguła obszaru**: po demie dopisać stan do `.claude/rules/zawalenia-budowli.md` albo nową regułę `woksele-zawalen` + wiersz w indeksie `AGENTS.md`. Pułapki odkryte przy tym porcie: `webgpu-tsl`. Bloomu ani posta poza GTAO i kopią z D20 demo nie dodaje; to nie narusza zasady 2, bo demo jest osobne, jak inne dema.
- **Commity**: etapami, po etapie, nic z `.tmp/` do repo. Skrypt prób, który ma zostać narzędziem, przenieść do `scripts/`.

## 10. Grawitacja i jej brak

Wymaganie użytkownika, ma pierwszeństwo: „pomietaj tez o źrodle grawitacji - jak jej nie ma to musisz to uwzglednic w obliczeniach i zrobic inaczej - przyklad wiezowca - rozpolowiony w pol gora poleci w jedna strone druga w inna, nie bedzie sie zawalac pod wlasnym ciezarem”. Stąd Z5, § 1.2.

Kod: `spec-proby/lataj3.mjs` → `model-spec3.mjs`. Bez nowych parametrów i pól sceny liczy bit w bit to samo co `model-spec2.mjs` (zm. S1, 3 s: różnica pozycji 0). Sceny i metryki `scenyG.mjs`, próby `probaG.mjs`, `proba3.mjs`, kratery `mapa3.mjs`, `mapa4.mjs`, kadry `obraz3.mjs`. Logi: `logG-*.txt`, `log5-*.txt`, `log6-*.txt`, zbiorczo `wynikiG.txt`, `wyniki3.txt`.

### 10.1 Co gra ma w poszczególnych miejscach

| Miejsce | Co mówi repo | Źródło w modelu |
|---|---|---|
| Habitat bazy piratów: wieża, szyja, dysk | `PIRATE_BASE_SOLID.gravity = 400`, −z świata, „umowna” (`src/game/story/pirateBaseBodies.js:25`). Plan § 3.2: budowle bazy biorą −z habitatu | stały wektor (0, 0, −400), gProj 400 |
| Upadek wieży przez dysk, odłamy pod habitatem | `PIRATE_FALL_TUNE`: 260 do przejścia, 600 po przejściu, sufit 2500, `gravityR0 0`, czyli stała siła ku środkowi skały (`pirateBaseFall.js:32`) | punkt, g 260 / 600, r0 = 0; gProj zostaje 400 |
| Stojące budowle na planetoidzie Hidalgo | Giną scenariuszem, nie fizyką (reguła `baza-piratow`, PLANETOIDA POD BAZĄ). Siły przy powierzchni repo nie podaje | OTWARTE, w próbach g = 40 to założenie, nie liczba z gry |
| Stacje | „Stacje nie mają grawitacji, więc tylko się rozpadają” (plan, Zakres) | brak |
| Ring „Halo” | Reguła `ring-halo` nie mówi o obrocie ani ciążeniu | OTWARTE. Obrót jest w danych (§ 10.4), ale nieprzetestowany |
| Hala K-7 | „Grawitacja ku pokładowi” tylko dla przewodów (reguła `k7-obsluga`). Hala nie ma fizyki budowli | OTWARTE |
| Budynki Marsa | Poza kolizją gry (D19) | OTWARTE |

Stary kod zawaleń zna to samo w innej postaci: `structureGraph.js` ma wektor i `g`, „jednorodna grawitacja znika” w wyspie swobodnej, a kalibracja archetypu skaluje limity z g (`zawalenia-budowli`, D12 / D10c). W demie wymagane: brak i stały kierunek.

### 10.2 Co zakładało g > 0, grunt albo prędkość bezwzględną

Każda pozycja sprawdzona w kodzie i w próbie. Scena S4: § 10.6.

| Założenie | Gdzie w `model-spec2` | Próba, wynik zm. | Rozwiązanie |
|---|---|---|---|
| Statyka liczy się dla aktualnego g | `_rozwiazStatyke`, `r = −g` | `dowod-g0.mjs`: przy g = 0 mamy 0/0: 181 048 z 183 748 wiązań ma NaN w Ft i Fc, 20 000 iteracji. NaN nie daje błędu: `f > lim` jest zawsze fałszem, wiązania stają się niezniszczalne | Ładunek jako pole sceny, zerowy ładunek zwraca zera |
| Wytrzymałość z aktualnego obciążenia | `baza = max(\|f0\|, eMin·K·dx)` | `logG-G6.txt`: gProj = 0, S4: góra rozpada się na więcej, największy kawałek 78% wobec 93%, oderwane poza cięciem 11% wobec 0,2%, utrata wiązań 28% wobec 8%. Kruchy, jak przewidywano, ale nie katastrofa | Obciążenie projektowe osobno, § 10.3 |
| Sprężenie zawsze, gdy nie ma `vel0` | `swobodna = !!vel0`, `F0 = f0` | Sprężenie to reakcja podpór, bez podpór nie ma czego równoważyć. `logG-K1b.txt`: F0 = 0 przy puszczeniu kotwic: swobodny spadek, 0 zerwań | Kotwice to pole sceny, F0 z obciążenia rzeczywistego |
| Nieruchoma dolna warstwa | `nieruchomy` przy `ijk.z = 0` | Bez kotwic S4 dryf przed cięciem 0,0000 j. | Podpora projektu osobno od kotwic |
| Lepkość hamuje prędkość bezwzględną | `\|v\| < 25: a −= 10·v` | **Główny winowajca.** `logG-A0.txt`: S4 z samym podziałem projektu: połowy stają do t = 3 (v = 0,0), P = 3176 zamiast 0. `log5-LG40.txt`: przy g = 40 góra schodzi stałą prędkością 4 j./s przez 16 s, czyli g/lepL, nigdy nie przekracza progu | Lepkość tylko z żywą drogą do kotwicy, współczynniki × √(g/400). Po zmianie: `logG-A1.txt` v = +22,5 i −21,2, P = 0 |
| Zakleszczenie hamuje prędkość bezwzględną | `dotyka ≥ 3, \|v\| < 30: a −= 80·v` | W S4 prawie nieaktywne (`logG-A1` i `A2` mają te same prędkości), bo w locie kontaktów jest mało. Błąd zasady, ujawni się przy kupie gruzu w ruchu | Symetryczny dashpot pary w kontakcie, grunt jako partner w spoczynku. S1, S2 bez istotnej zmiany, hałda niższa o około 25 j. |
| Usypianie | W modelu CPU nie ma, jest dźwignia w § 6.1 | Nie liczone | Zapis w § 6.1: tylko przy ramie |
| Fala rozluźnienia od `\|v\| > 60` | `fala.v` | Mniej groźne, niż myślałem. Przy połowach 120 j./s `logG-FA0.txt` (bez warunku) i `FA1` (z warunkiem) mają 66% i 65% największego kawałka. `FA2`, swobodny spadek: strata 7,6% wobec 7,2%. Bez obciążenia szkoda fali nic nie niszczy | Warunek ramy jest teraz konieczny: fala łamie granice ziaren (§ 1.3), a w próżni ma milczeć. `uFalaV2 = 1e30` bez ramy, zm. S4 po zmianie bez różnicy (`proby4/logG4-Z5.txt`) |
| Grunt | `zi < gruntZ + dx/2` | `−Infinity` działa w Node, GPU: −1e30. Bez gruntu lot bez końca | Pole sceny. Rasteryzator: `rys3.mjs` |
| Etykieta i waga dysku | `bezG` | Przy g = 0 obie gałęzie znikają same. `log7-S3p.txt`: S3 w próżni, kotwica dysku zostaje, pocisk 300 j./s: po przejściu 156 j./s, otwór 2,63, pocisk w większości cały (2936 z 3240), dysk stoi. Kadrów nie oglądałem | Bez zmian; flaga to dziś „nośny przez kotwicę”, a fala używa jej jako „dysk” |
| Sprężenie pokładów dysku | `L = R0·(1 − s)` | Nie zależy od g, trzyma się kotwic. Dysk bez kotwic: nie liczone | Bez zmian, OTWARTE poza demem |
| Siatka i lista kontaktów | Mieszanie bez ograniczeń domeny | `logG-Z5L.txt`: maks. 14 kontaktów, 0 przepełnień listy, maks. 26 w komórce (16 slotów), 450–1950 pominiętych wstawień na bieg. Lista zależy od ruchu względnego, dryf jej nie psuje. Pominięte wstawienie daje asymetrię kontaktu, stąd \|P\|/N do 0,02 j./s | Bez zmian |
| f32 daleko od środka | Pozycje f32 | `logG-F20`, `F60`: 20 tys. i 60 tys. j. bez różnicy. `F200`: 200 tys. j.: utrata wiązań poza cięciem 20% wobec 8%, oderwane 1,5%. Arytmetyka w Node jest double, więc GPU może się zepsuć wcześniej | Przesunięcie początku układu w grze, demo tego nie potrzebuje, § 2.9 |
| Źródło rozdzielenia połówek | Brak | `logG-G9b.txt`: cięcie bez impulsu: Ek = 0, v = 0,00 do końca, połowy wiszą obok siebie. Tak ma być, ale nic się nie dzieje | Pchnięcie, § 2.8, § 10.6 |
| Pył, gruz obrazu | Wypór 3,5, opór 0,985, dziedziczenie 25%, −g, odbicie od gruntu | Kadry `obraz3/v1`, `fin10` | Pole z kernela fizyki, osobno `uPowietrze`, § 4.5, § 4.6 |
| Kąt toczenia, sufit `vMax` | `\|v\|·dt`, `\|v\| ≤ 4000` | Kąt: tylko wygląd, w locie stałe wirowanie, dobrze. Sufit: przy g = 400 swobodny spadek dochodzi do 4000 po 10 s, wtedy równoważność padnie. Gra ma 2500 w studni: nie liczone | Bez zmian, OTWARTE poza demem |
| Obroty: zginanie, wypiek | Energia od `\|b\|`, `cos(12°)` tylko przy F0 ≠ 0 | S4: połowa obraca się o 55° w 14 s, reszta dopasowania sztywnego 0,2 j. | Bez zmian |

### 10.3 Model: projekt, rzeczywistość, rama

- **Obciążenie projektowe (materiał)**: `gProj`, kierunek, podpora projektu (dolna warstwa). Daje wyłącznie wytrzymałości. To parametr budynku, nie miejsca. We wszystkich scenach dema gProj = 400, także w S3 (dawniej 260, zm. `log6-X*.txt`: pocisk spójniejszy, otwór 2,41).
- **Obciążenie rzeczywiste (miejsce)**: pole `gNaWezle`, § 10.4. Daje przyspieszenie węzłów i sprężenie `F0`, gdy są kotwice. Bez kotwic `F0 = 0`.
- **Rama odniesienia**: istnieje, gdy w scenie jest coś nieruchomego (grunt albo kotwice). Bez niej prędkość bezwzględna nic nie znaczy, więc lepkość i fala milczą. To jedyny warunek typu „próżnia” i nie dotyczy materiału: wynika wprost z tego, że „stoi” nie ma bez układu odniesienia. Lepkość nawet tego warunku nie potrzebuje: działa przez etykietę, drogę po żywych wiązaniach do kotwicy.
- **Etykieta dla całej budowli**, nie tylko dysku. Koszt: te same odczyty `wStan[j]`, które F i tak robi. Oderwanie wykrywa się z opóźnieniem do `cap` podkroków (wieża: 109, czyli 0,23 s).
- **Wypiek po oderwaniu**: wiązanie bez drogi do kotwicy przenosi F0 do L. Siła jest ciągła, a blok w locie przestaje zależeć od skali grawitacji.
- **Skale**: `sFr = √(gAkt/400)` dla tego, co kinematyczne (lepkość, zakleszczenie, fala). `sM = gProj/400` dla materiału (K, eMin, próg zginania, progi prędkości × √sM), § 10.5. Obie równe 1 przy g = gProj = 400, więc Z1 się nie zmienia. Przy g = 0 `sFr = 0` i te człony znikają bez gałęzi.

Równoważność jest testem na całość: jednorodne pole bez podpór nie daje naprężeń, więc swobodny spadek przy g = 400 musi wyglądać jak próżnia. Zm. (`log7-G8a.txt`, `log7-G8c.txt`): po odjęciu spadku przy t = 6 te same prędkości (+37,7, −34,3) i obroty (4,8, 3,3–3,4°/s), największe kawałki 92,7% i 99,5%, mediana odchyłki węzła 0,25 j., p99 20 j., maks. 263 j. (lecące kawałki, układ jest chaotyczny). Każda zależność od prędkości bezwzględnej to psuje.

### 10.4 Dane: opis miejsca, uniformy, pole w węźle

Opis sceny w `budowa.js`:

```js
zrodlo: { stala: [0, 0, -400] } | { punkt: { c: [x, y, z], g: 40, r0: 3000 } } | { obrot: { p, os, om } } | {}
projekt: { g: 400, kierunek: [0, 0, -1] },   // wytrzymałości; podpora: dolna warstwa
grunt: { z: 0 } | null,
kotwice: 'dolna warstwa' | 'kotwica dysku' | null,
powietrze: 1 | 0,
```

Kolejne źródło to nowy człon w `gNaWezle` i uniform, bez dotykania kerneli. Zmiana miejsca to zmiana uniformów, bez nowych pipeline'ów (zasada 4). Inny kształt pola przy kotwicach wymaga drugiego CG w budowie (zm. punkt, `log5-PK.txt`: stoi, 0,018 j. przed zdarzeniem).

```js
const gNaWezle = Fn(([x, v]) => {
  const g = uGStala.toVar();                               // brak: 0
  If(uGPunktG.greaterThan(0), () => {                      // r0 > 0: g·(r0/r)², r0 = 0: stała, jak gravityWell w grze
    const e = uGPunktC.sub(x).toVar();
    const r2 = dot(e, e).add(1e-6).toVar();
    const a = select(uGPunktR0.greaterThan(0), uGPunktG.mul(uGPunktR0).mul(uGPunktR0).div(r2), uGPunktG).toVar();
    g.addAssign(e.mul(a.div(sqrt(r2))));
  });
  If(uGObrotOm.notEqual(0), () => { /* odśrodkowa + Coriolis, model-spec3 _gWezla */ });
  return g.mul(uSkG);
});
```

| Uniform | Znaczenie | Brak źródła, bez kotwic | Stały 400, grunt, kotwice |
|---|---|---|---|
| `uGStala` vec3 | stały wektor | 0 | (0, 0, −400) |
| `uGPunktC` vec3, `uGPunktG`, `uGPunktR0` | środek, siła, r0. Osobno, bez vec4: błąd three, § 1.7 | G = 0 | G = 0 |
| `uGObrotP` vec3, `uGObrotOm`, `uGOs` vec3 | punkt osi, ω, oś. Obrót jest w Node, ale nietestowany | ω = 0 | ω = 0 |
| `uSkG` | skala siły w biegu, § 10.5 | 1 | 1 |
| `uSkF0` | skala sprężenia, razem z `uSkG`; 0 bez kotwic | 0 | 1 |
| `uKotwice` | `stoi = bit flagi · uKotwice`: ta sama budowa z kotwicami i bez | 0 | 1 |
| `uGruntZ` | płaszczyzna gruntu | −1e30 | 0 |
| `uCap` | sufit etykiety; 0: nikt nie ma drogi do kotwicy | 0 | 109 |
| `uLepL`, `uLepV2` | `lepL·sFr`, `(lepV·sFr)²` | 0, 0 | 10, 625 |
| `uGruzP`, `uGruzV2` | `gruzPara·sFr`, `(gruzV·sFr)²` | 0, 0 | 27, 900 |
| `uFalaV2`, `uFalaTempoH` | `(fala.v·sFr)²`, `tempoH·sFr`; bez ramy 1e30 | 1e30, 0 | 3600, 0,01875 |
| `uSzokProg`, `uKontaktV` | `szokTempo·dx·√sM`, `kontaktSzokV·√sM` | 30, 120 | 30, 120 |
| `uK`, `uCB`, `uKB`, `uKC`, `uCC`, `uCT` | z `K·sM`, per scena | jak obok przy gProj = 400 | 30 000, 34,6, 3000, 24 000, 76,7, 76,7 |
| `uPowietrze` | pył: opór, wypór, dziedziczenie, promień; tylko obraz | 0 | 1 |

Próg ściskania, wytrzymałości, kruszenie, ziarna: bez zmian i bez uniformów źródła. Dla przypadku 0/400 i 400/400 cały kod materiału dostaje te same liczby.

### 10.5 Budynek a inne g

Zm. na kodzie końcowym: `log7-*.txt`, punkt i przechylenie: `log5-PK*.txt`, `log5-N11.txt`, przeciążenie: `log5-G7.txt`.

| g rzeczywiste / projektowe | Co się dzieje | Liczby, kadr |
|---|---|---|
| 400 / 400 | Z1, miażdży się | S2 z frontem: dach 1216, 1029, 545, 234, 175, koniec 157; S1: 1295, 1047, 582, 217, 174, koniec 157 (`proby4/log-R7.txt`) |
| 260 / 400 (wieża w upadku w grze) | Miażdży się do końca, o 1 s dłużej | S2: 362 przy t = 6, 166 przy t = 12, spójny 2,6°; S1: 409, 153, 3,0° (`log-Rg260.txt`) |
| 200 / 400 | **Miażdży się do końca, bez przewrotki** (przedtem S2 stawało po 3 piętrach, S1 36°) | S2: 160, 2,4°; S1: 154, 3,6° (`log-Rg200.txt`) |
| 100 / 400 | Miażdży się do końca, około 3 s dłużej (przedtem stawało, 70°) | S2: 173, 2,3°; S1: 174, 4,0° (`log-Rg100.txt`) |
| 40 / 400 | S2: góra siada o jedno piętro, dach 1252, stoi. S1: stoi, pełznie 0,14°/s (1,9° po 15 s) | `log-Rg40p.txt`. Budynek ma dziesięciokrotny zapas |
| 40 / 40 | Miażdży się jak przy 400, w czasie × 3,16. S2 przy t = 20: 179, spójny 2,5°; S1: 171, 2,8° | `log-Rg40.txt`. Uwaga: gruntu i mapowania czasu po zmianie fali nie porównywałem, kadrów nie oglądałem |
| punkt 40, r0 3000 / 40 | Przed zmianą fali: stoi, po usunięciu kondygnacji miażdży się wolniej: 299 przy t = 25. Nie powtórzone | Grunt płaski, kula nie ma kodu |
| 400 / 40 | Przed zmianą fali: wali się sama w 1–3 s, bez strzału. Nie powtórzone | Sam pył i drobne |
| 0 / 400 | Z5 | § 10.6 |
| 0 / 0 | Kruchy, patrz § 10.2. Budynek w kosmosie też ma obciążenie projektowe (manewry, ciśnienie), więc w grze gProj > 0 | `logG-G6.txt` |
| 400 przechylone o 11° / 400 pion | Kładzie się sam w 2 s, bo nie był liczony na siły poziome | R16 |
| 400, bez gruntu i kotwic / 400 | Swobodny spadek, bez naprężeń. Równa się próżni | § 10.3 |

Podobieństwo Froude'a dla budynku na własne g wymaga skalowania **wszystkiego**, także K: `sM = gProj/400` dla K, eMin, progu zginania, a √sM dla progów prędkości. Bez K (samo eMin i progi) tłumienie wiązań jest za silne względem wytrzymałości: S2 kładzie się 83° i nie kończy w 25 s (pierwsza wersja `log5-G5.txt`, nadpisana; wynik zapisany tutaj). Budynek na niskie g jest wtedy po prostu lekką, miękką konstrukcją. **Uczciwie: granica „miażdży się” / „stoi” przesunęła się z około 0,6 g na około 0,1–0,25 g projektowego i to zasługa reguły fali, nie mechaniki.** Mechanika sama (Bažant przy zapasie 2,2) dawała próg wyższy. Gracz zobaczy: budynek zaprojektowany na 400 przy 100 się miażdży, przy 40 stoi z odpadającą fasadą. Który wariant dla planetoidy: decyzja po kadrach.

Zmiana w biegu (`skalaG`, siła i F0 razem, `logG-R*.txt`):
- 400 → 0 i 0 → 400 przy stojącej wieży, rampa 1 s: bez ruchu, v_max 0,07 i 0,04 j./s.
- 400 → 0, potem cięcie z impulsem, kotwice zostają: góra +39,9 j./s, 3,9°/s, dół stoi. To samo bez przełączania (`logG-Z5k.txt`).
- 400 → 0 w czasie zawalenia: ściśnięta sprężyście konstrukcja odbija. Rampa 0,5 s: góra +58 j./s (artefakt, `R4b`). Rampa 3 s: +14 j./s (`R4c`). W panelu 3 s, R14.
- Kotwice puszczają bez gruntu: `F0` znika, swobodny spadek, 0 zerwań (`logG-K1b.txt`). Pierwsza wersja wypiekała F0 w L: fala wydłużenia do 14% przy podstawie (86 000 / K / dx), 26 tys. zerwań, odrzucone.
- **Kotwice puszczają na gruncie: nie działa**, wieża wali się sama (`logG-K2b.txt`, R15). Poza demem.

### 10.6 Scena S4: próby Z5

Ta sama wieża co S1, S2. Bez gruntu i kotwic, gProj = 400. Plan (`spec-proby/scenyG.mjs`, `s4-opcje-koniec.txt`): powierzchnia cięcia w połowie wysokości z szumem ±90 j., grubość 30–55 j.; front od +x, 400 j./s; węzły w pasie rozerwane, wiązania wewnątrz ziaren przeżywają. Pchnięcia: siatka 4 × 3 od strony +x (x = 190, 130, 70, 10; y = −140, 0, 140), J = 120, tau = 0,8 s, rP = 320. Asymetria siatki daje obrót, ta sama zasada co otwierana książka. Te same zdarzenia przy g = 400, grunt, kotwice: `log7-Z5g.txt`. Wynik powtarzalny: `logG-Z5L.txt` i `log7-Z5f.txt` są identyczne.

| Wielkość, koniec t = 14 | Ziarno 7, cięcie 3 (`logG-Z5L.txt`) | Inne cięcie (`Z5z`, bez korekcji momentu) | Ziarno 21 (`Z5m`, jw.) |
|---|---|---|---|
| Góra, v_z; obrót; kąt | +37,5; 4,8°/s; 55° | +33,8; 3,7°/s; 43° | +35,8; 4,9°/s; 56° |
| Dół, v_z; obrót; kąt | −34,1; 3,3°/s; 38° | −31,8; 4,7°/s; 54° | −29,5; 2,9°/s; 33° |
| Największy kawałek połowy (góra, dół) | 92,6%, 99,5% | 94,2%, 97,3% | 89,4%, 99,4% |
| Oderwane poza strefą ±120 j. | 0,23%, 0% | 0,15%, 0,11% | 0%, 0,05% |
| Poza strefą: choć jedno wiązanie mniej | 8,3%, 3,5% | 10,4%, 6,2% | 6,5%, 3,3% |
| Zerwania razem | 2074 | 2952 | 2102 |
| Masa w kawałkach 1 / 2–7 / 8–63 / 64–511 / 512+ | 28 / 148 / 381 / 0 / 14 385 | 34 / 174 / 312 / 0 / 14 422 | 25 / 126 / 270 / 151 / 14 370 |
| Dryf przed cięciem | 0,0000 j. | 0,0000 j. | 0,0000 j. |
| \|P\| suma | < 1 (\|P\|/N < 0,0001 j./s) | < 1 | 24 |
| \|L\| do momentu jednej połowy (2,8·10⁷) | 0,2% | 40% bez korekcji | 12% bez korekcji |

Cięcie w innym miejscu (`logG-U65.txt`, `U14`): 65% h: góra (lżejsza) +44,5 j./s, 8,8°/s, dół −20,6; 14% h: dolny kawałek −142 j./s, 26°/s, reszta +26. Oderwane poza strefą ≤ 0,62%. Lżejsza część leci szybciej: pęd działa. Z kotwicami i bez grawitacji (`logG-Z5k.txt`): góra +39,9 j./s, dół stoi.

Przy g = 400, te same zdarzenia: wieża się miażdży, góra nigdzie nie odlatuje, koniec: 2186 / 1576 / 8015 / 1976 / 1189, 99 776 zerwań (`proby4/log-f11e.txt`, kadry `fin11/S4g_arkusz.png`, § 5.2 scena 6: do t = 5,5 widać przechylony blok na kuli gruzu). W próżni 2068 zerwań, 48 razy mniej. Różnica to wyłącznie miejsce: `gNaWezle`, grunt, kotwice. Fala nie działa w próżni, bo `uFalaV2 = 1e30` bez ramy: zm. S4 przy parametrach końcowych bez zmian wobec tabeli wyżej (`logG4-Z5.txt`: +37,5, −34,1 j./s, 4,8, 3,3°/s, 92,6%, 99,5%, zerwania 2068).

**Pęd i moment pędu.** Pchnięcie z odjętą średnią zbioru zachowuje pęd co do zaokrąglenia. Moment zachowuje się tylko z osobną korekcją, jeśli kopy z 12 slotów idą jednym zbiorem: tabela. Wersja „każdy slot osobno” bez korekcji dała 1% (`logG-D2.txt`), ale to 24 dispatche na klatkę zamiast 3. Tarcie w kontakcie nie jest siłą centralną i psuje moment o ułamek procenta, w S4 kontaktów jest mało.

**Dlaczego kop trwa.** Natychmiastowy kop do 100 j./s to odkształcenie Δv/c = 1,7%, trzy razy ponad granice ziaren (szac.). Rozłożony na tau to przyspieszenie około 1–2 g, czyli to, na co budynek jest liczony. Zm.:

| J, tau, front | v połowy | Obrót | Największy (góra) | Poza strefą: strata, oderwane | Log |
|---|---|---|---|---|---|
| 60, 0,25 s, 1000 j./s | 27 | 2,2 | 97,7% | 16%, 0,8% | `logG-B1.txt` |
| 60, 0,5 s, 500 j./s | 20 | 2,7 | 98,3% | 3%, 0% | `B2` |
| 120, 0,5 s, 500 j./s | 42 | 5,2 | 97,6% | 18%, 0,6% | `C1` |
| **120, 0,8 s, 400 j./s** | 44 | 5,3 | 98,2% | 6,5%, 0,1% | `C2`, wybrane; cięcie równe jak w wierszach wyżej, nierówne: tabela nad tą |
| 160, 1 s, 5 × 3 pchnięć, rP 380 | 138 | 8,0 | 96,9% | 19%, 1% | `C3` |
| 350, 1 s, cięcie nierówne | 120 | 0,9 (góra), 8,6 (dół) | 65% | 51%, 23% | `logG-FA1.txt`: **za mocno, góra się rozpada** |

Bez impulsu połowy wiszą nieruchomo obok siebie (`logG-G9b.txt`). Fizycznie poprawne, więc strzał w demie zawsze niesie pchnięcie. Przy tym kraterze w próżni całość się nie rusza: suma kopu jest zerowa, wyrzucony materiał nie jest symulowany. Jeśli użytkownik chce, żeby strzał odpychał cały budynek, to świadome odstępstwo od zachowania pędu (albo jawny pęd pocisku): § 12, decyzje.

**Ocena kadrów wobec Z5, obejrzane** (`proby4/fin11/S4_arkusz.png`, wersja z barwami; wcześniej `obraz3/fin10`, `v2`, `v3`):

- Połowy całe: tak. Górna i dolna część to czytelne fragmenty budynku z oknami i stropami do końca, przy t = 14 też.
- Lecą w różne strony: tak, wzdłuż osi, odstęp rośnie równo, nikt nie hamuje.
- Obracają się: tak, widać przy t = 8 (około 20–25° od pionu), przy t = 14 góra 55°, dół 38°, każda w swoim tempie.
- Wygląda na przepołowiony budynek w kosmosie, nie na zawalenie: tak. Kikuty słupów i wyrwane płyty na przekroju, rzadka chmura kawałków, która rozlatuje się dalej, brak pyłu zasłaniającego.
- Słabsze: chmura kawałków jest dość równomierna i oddala się szybko (najszybsze 350 j./s), więc przy t = 14 kadr jest pusty. Przy kamerze zbliżenia płyty lecą na kamerę i zasłaniają kadr t = 5–6. Ścieg na dużych ścianach przy obrocie, § 1.3 h). Rysa wzdłuż stropu w połowie górnej części (`v1`, `v2`): słabe stropy pękają od drgań (R13). Nikt nie widział tego w ruchu.

### 10.7 Czego nie sprawdziłem, co nie działa

- **Nic z tego nie było na GPU.** Wszystkie liczby to Node, kadry z rasteryzatora.
- Kula jako grunt dla źródła punktowego i walec dla pierścienia: nie ma kodu, grunt to płaszczyzna z = const. Obrót (odśrodkowa, Coriolis) jest w `_gWezla`, nie uruchomiony ani razu.
- Sufit prędkości źródła (`gravityVmax` w grze) nie jest częścią pola.
- Kotwice puszczają na gruncie: wali się (R15). Przechylone pole: wali się (R16). Dysk bez kotwic: nie liczony.
- Przy małej grawitacji budynek na 400 stoi przy 40, miażdży się od 100 (§ 10.5). „Miażdżenie” z Z1 przy planetoidzie wymaga więc albo budynku projektowanego na małe g, albo g ≥ 100: decyzja użytkownika po obejrzeniu.
- Długi lot: drgania połówek ledwo gasną, `diag-pelz.mjs`: 320 zerwań stropów w 10 s, 0 oderwanych węzłów, R13. Tłumienie linii zginania `zetaB` odrzucone: 0,1 nic nie daje, 0,3 wysadza układ.
- Strzał myszą w połowę, która już leci: nie liczone. Zderzenie dwóch połówek ze sobą: nie liczone.
- Kod `kWybuch*` jest opisany na podstawie `pchniecia` w Node, stały przecinek sprawdzony w f32 w Node (`log-Fx*.txt`), nie na GPU: R12.
- Krater z rozerwaniem w próżni, r = 60 i r = 90: zm. P0 w § 1.2. Całość się nie rusza, tak jak przy dawnej regule (`log5-mk*.txt`). Kadrów nie oglądałem.

## 11. Odrzucone uwagi

Uwagi krytyków przyjęte są wpisane w rozdziały wyżej. Tu to, czego nie przyjąłem albo przyjąłem tylko w części, z powodem.

| Uwaga | Krytyk | Decyzja i powód |
|---|---|---|
| Blok S4 przy g = 400: „zmienić plan sceny 6” (oczy) | oczy | **Odrzucone.** Użytkownik chce tej samej sceny, a inny plan przy grawitacji przeczy porównaniu. Zm. po zmianie fali przechył przy 29% góry 10,6°, przedtem 15,6° przy 48%. Zostaje najsłabszym kadrem z wierszem [!] |
| „Odstępy między płytami różnią się o 30%” w wierszu S1 t = 4,5–5 | oczy | **Odrzucone.** Po zmianie fali płyt w regularnych odstępach przy t = 5 już nie ma, a odstępu nie policzy się z kadru bez metryki; zostaje próg pękniętych płyt |
| Przegrody i kable w geometrii obrazu | oczy | **Odrzucone na pierwszą wersję**, a druga część uwagi przyjęta: § 4.2 opisuje, czego w środku nie ma. Kadry `fin11` nie wymagają tego do odróżnienia materiałów |
| Dobór rozkładu wielkości odłamków w Node przed portem | oczy | **W części.** Zamiast tego ton kawałka od ziarna i `zlom` 0,5, co zmierzone daje czytelne kawałki. L = 5 zostaje, oglądamy na K1 |
| „Fasada dmucha pyłem z okien” jako lekarstwo na c) | oczy (cytowane z § 4.6) | **Wycofane.** Góra kruszy się fizycznie, a emisja wysoko robi ducha |
| Każdy wiersz listy także na 5120 × 1440 | oczy | **W części.** Tylko wiersze Kino: bliskie kamery przy 32:9 pokazują to samo z pustymi bokami, a koszt harnessu rośnie liniowo |
| Dwie wieże, jedna uśpiona, w § 8 | koszt | **Poza demem.** Demo nie ma sceny z dwiema wieżami i Z1–Z5 tego nie wymagają. Dane są gotowe, § 6.3, próba wraca przy decyzji o grze |
| Ośmiokąt zamiast kwadu pyłu (−17% pola) | koszt | **Odrzucone na teraz.** Nowa geometria dla 17% przy LOD, który tnie więcej. Zostaje na liście dźwigni |
| Morton dla dysku | koszt | **Odłożone.** Sam krytyk ma tu tylko symulację LRU, a inna kolejność węzłów psuje test budowy bajt w bajt i wszystkie migawki. Dopisane jako A/B, gdyby S3 przekroczyło próg, z mapą permutacji w teście |
| Usunąć wiersz przepełnień list (wierność) | wierność | **W części.** Wiersz zmieniony na licznik odrzuconych wstawień, jak krytyk proponował w drugim zdaniu |
| „Rezerwa: `zlom` 0,7 po utracie osiowego” | oczy | **Zmienione na 0,5.** Przy 0,7 każda płyta to cegły (`M1/S1_arkusz.png`), a przy 0,5 mniej. Do dalszej oceny na K1 |
| Kamera domyślna: „Kino S3 odl około 3000” | oczy | **Zmienione na 3400**, bo przy 3000 pod dyskiem wychodzi poza kadr gruz przy gruncie; odległość dostroi K1 |
| Limit 12 buforów jako drugi wariant | tsl, koszt | **Odrzucone**, wybrany układ scalony, bo mieści się w normie repo |

Żadna uwaga wagi „blokuje” nie okazała się błędna. Krytyk oczu miał rację co do bladego wnętrza otworu, ale część wrażenia to błąd rasteryzatora z czyszczeniem głębi (§ 1.5): jego kadry z kamerą z góry przed boczną go mają.

## 12. Plan budowy

Od najbardziej ryzykownego. Każdy pakiet kończy się commitem, a bez zaliczonego warunku następny nie startuje. Wszystko bez oczu użytkownika, poza punktem końcowym.

| Pakiet | Pliki | Co ma działać na końcu | Jak sprawdzić bez użytkownika | Blokuje |
|---|---|---|---|---|
| **P0 Node: domknięcie** | `dema/woksele-zawalenia/{scena,budowa,wzorzec-cpu,metryki}.js`, `scripts/woksele-sym.mjs`, `tests/wokseleBudowa.test.mjs`, `tests/helpers/wokseleBiegi.mjs` | Port `model-spec4` bez gałęzi wyłączonych, budowa z tą samą kolejnością losowania, migawki do testu jednego podkroku, 30 klatek S1 t = 5 w PNG. Powtórzone r = 60 i 90 w próżni, nowy koszt pyłu (`krytyk-gpu/koszt.mjs`) przy regule kontaktowej | `node --test`: budowa bajt w bajt, stan po krótkich biegach bit w bit z `model-spec4`. Całe wyniki z `proby4/log-R7.txt` z dokładnością do bitu: `woksele-sym.mjs --zgodnosc`, wymaga `.tmp/`. Sekwencję ocenia agent bez kontekstu, odpowiedź o migotaniu | Wszystko |
| **P1 Solver sam** | `dema/woksele-zawalenia/solver.js`, `dema/woksele-zawalenia.html` (pusta strona), `glowny.js` (renderer, uid znaczników), `scripts/webgpu/woksele-demo.mjs`, `tests/wokseleWgsl.test.mjs` | Bufory § 2.2, kF, kI, kWstaw, kLista, kZerujPo, wczytanie z Node. Bez obrazu, bez zdarzeń. Odczyt przez `__wok.odczyt()` | WGSL w Node: ≤ 8 storage, `read`, atomiki, `round`. W Chrome: test jednego podkroku z migawek S1, S2, S3, S4; W1 60 s; pipeline'y 0; `?profil=1` daje **pierwszy czas kF i kLista**: R6 | P2. **Punkt G1: warunek porażki 1** |
| **P2 Zdarzenia i pęd** | `solver.js`: kCzas, kCzysc, kCzyscS, kCel, kKrater, kWybuch*, kZerujWybuch | Pełne S1, S2, S3, S4, S6 bez obrazu | Tabela § 8, S4 |P|/N, moment, równoważność, `strzel` w próżni: ruch zaczyna się przy trafionym, strzał w czasie planu pchnięć daje kop | P3. **Warunek porażki 2** |
| **P3 Obraz bez pyłu** | `obraz.js`: kObraz, kGruz, materiał, `castShadowPositionNode`, GTAO, MSAA, światła § 4.3 | Bryły, ton, rysy, pręty, kamery. Zrzuty obok `fin11` | Harness `--sceny 1,2,3,5 --kamery …`, p5, p50, ciemne wg § 7 | **K1**: agent ocenia wiersze bez pyłu. Nie zaliczone: tylko poprawki obrazu, fizyki nie ruszać, chyba że wiersz mówi o fizyce |
| **P4 Pył, gruz, przyczyna** | `pyl.js`, `kPrzyczyna`, LOD, sufit, przy kamerze | Pełny obraz | Wiersze pyłu i przyczyny. Bloom tylko, jeśli K2 odrzuci błysk | **K2**: wiersze [!] pyłu, S2 t = 2,0–2,3, S3 t = 1,5–2, strzał |
| **P5 Sceny i panel** | `glowny.js`, `scena.js`: sześć scen, przełącznik **Miejsce: Próżnia / g = 400** (uniformy § 10.4), `G`, kamery, klawisze, tempo, wpis w `dema/index.html` | Start od sceny 2, próżnia i g = 400 przez reset bez nowych pipeline'ów, strzał myszą | Harness: scena po scenie, `pipeline` 0 po przełączeniu, wynik Z5 po przełączeniu taki sam jak na wejściu | **K3**: pełna lista § 7 z sekwencjami ruchu, w tym kadry Z5 |
| **P6 Pomiary** | `scripts/webgpu/woksele-demo.mjs --pomiar`, `?jakosc=niska` | Z4: fizyka na krok, listy, A/B pyłu, MSAA, 7,37 i 11,5 Mpx, rytm przy takcie, w ciszy innych sesji | Liczby wobec § 6.1, wpis do § 6.1 z oznaczeniem zm. Test dwóch list | P7. **Warunek porażki 3** |
| **P7 Poprawki po K3** | jw. | Lista bez „nie” w [!] albo zapisana jawnie niemożliwa | Ta sama lista, ten sam agent, nowy kontekst | P8 |
| **P8 Pokaz użytkownikowi** | Reguła obszaru, wpis w planie, zrzuty | Demo, krótka lista, co zostało nierozwiązane, liczby Z4 | Tylko ocena użytkownika | — |

**Stan:** P0 zrobione 2026-11-05, poprawki po sprawdzianie tego samego dnia, § 1.6; z wiersza P0 została tylko ocena sekwencji przez agenta bez kontekstu. P1 zrobione 2026-11-05, § 1.7: punkt G1 przeszedł (S3 najwyżej 0,414 ms/krok wobec progu 8 ms). P2 zrobione 2026-11-05, § 1.8: warunek porażki 2 nie zachodzi. P3 zrobione 2026-11-05, § 1.9, bez punktu K1: strona na żywo, wzorcem film.

**Punkty oceny:** K1 po P3, K2 po P4, K3 po P5. Żaden kadr nie idzie do użytkownika przed K3.

**Warunek porażki**, kiedy uczciwie powiedzieć użytkownikowi, że ten model nie daje rady:

1. **Koszt (G1 + P6):** kF + kI + kLista dla S3 powyżej 8 ms/krok na RTX 5080 po wymianie układu danych i z listą co 4. To około 3 razy ponad szacunek. Podkroków nie zmniejszymy, więc demo przy 60 Hz nie mieści się w 16 ms. Wyjście: wolniejsze tempo jako sposób pokazu, jawnie nazwane, a nie „działa”.
2. **Wierność (P2):** test jednego podkroku przechodzi, a chaotyczne progi Z1 albo Z5 na GPU wielokrotnie nie, np. przechył S1 ponad 15° przy zgodnej budowie, |P|/N ponad 0,5 j./s, otwór ponad 6 przekrojów. Znaczy to, że f32 albo sterownik przesuwa układ na inną stronę progu (R3, R5), a strojenie miałoby iść pod konkretny sprzęt. Trzy iteracje poprawek i koniec.
3. **Wygląd (K3 + P8):** użytkownik po obejrzeniu w ruchu mówi o S1 i S2 to samo co o demie D20: „sucho”, „klocki”, a lista jest zaliczona. Wtedy problem leży w rozdzielczości dx = 20 i jest granicą tego modelu: 15–21 tys. węzłów to tyle, ile da się uczciwie policzyć. Kolejny krok to obniżenie dx, a to 8 × węzłów i 2 × podkroków, czyli co najmniej 16 × kosztu na GPU. Bez nowego budżetu to koniec, a nie „jeszcze trochę strojenia”.
4. **Droga do gry:** nawet po zaliczeniu dema budżet gry to +1 ms przy nasyconym Ultra. Jeśli pomiar P6 wyjdzie jak szacunek, 6–12 ms na scenę z jedną wieżą, a usypianie nic nie ratuje w czasie walenia. To nie porażka dema, ale trzeba to powiedzieć wprost razem z wynikiem.

**Decyzje, które mogą wymagać użytkownika** (reszta jest techniczna):
- Budżet gry: czy zawalenie jednej budowli może kosztować kilka ms przez kilka sekund. Bez tego demo zostaje demem.
- Strzał w próżni: czy ma odpychać cały budynek (jawny pęd pocisku), czy zachowywać pęd bez ruchu całości. Dziś całość stoi, a odlatuje tylko to, co pękło.
- Planetoida: budynek projektowany na małe g, czy na 400 i wtedy przy g = 40 stoi z odpadającą fasadą, § 10.5.
- Fala łamiąca to reguła, nie mechanika: jeśli przy oglądaniu spodoba się mniej regularny, ale wolniejszy upadek, dźwignia to `fala.tempo`; decyzja tylko po pokazie.
- Czy pokazać ziarno inne niż 7 (przechył do 10°) jako prawdę o rozrzucie. Dziś demo ma ziarno 7, § 1.2.
