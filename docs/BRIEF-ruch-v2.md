# BRIEF — ruch kosmiczny v2 (świeży start)

Dokument dla instancji zaczynającej z czystym kontekstem. Poprzednia zbudowała
prototyp pasowy `ruch-kosmiczny.html`, znalazła jego granice i zmierzyła je.
**Nie zaczynasz od zera — zaczynasz od wniosków.**

Kopie zapasowe prototypu pasowego są zrobione. Nie trzeba go ratować.

---

## 1. Po co to jest

Gra (`index.html` + `src/`) to kosmiczna gra akcji z ekonomią międzyplanetarną.
Ruch handlowy ma być **żywy i sprawczy**, nie dekoracyjny: statki naprawdę wożą
towar między stacjami, naprawdę można je przechwycić, i naprawdę mogą nie dolecieć.

**Zadanie:** zaprojektować i zbudować warstwę ruchu, która to unosi.

---

## 2. Ustalenia projektowe (podjęte, nie do przedyskutowania od nowa)

### 2.1 Bez autostrad

W próżni nic nie ogranicza ruchu, więc **nie ma pasów w otwartej przestrzeni**.
Statki lecą swobodnie, wybierają własne trasy. Korytarze powstają same, z popytu —
bo wszyscy jadą mniej więcej tą samą prostą.

Korytarz rysuje się tylko tam, gdzie **coś go fizycznie wymusza** — czyli w pasie
asteroid. To jest jedyne uzasadnione miejsce na „autostradę", i akurat to jest
chokepoint dla piractwa.

### 2.2 Zagęszczenie tylko w węzłach

Ruch koncentruje się wyłącznie tam, gdzie musi:
- **bramy warp** (opłacone, ograniczona przepustowość)
- **boostery / ekspresówki** (rozłożone na często uczęszczanych trasach)
- **stacje tankowania** (nowy typ węzła — paliwo wymusza postoje)
- **doki stacji**

### 2.3 Czego gracz naprawdę widzi

Gracz widzi **to, co wokół niego** — dokładnie tyle co w grze. Nie ma widoku
całego układu statek-po-statku jako mechaniki.

Opcjonalna zdolność do kupienia: **komputer handlowy** — pokazuje ścieżki handlowe,
ich natężenie i przepływ. To jest **agregat z warstwy rekordów**, nie renderowanie
tysięcy statków. Kosztuje zero, bo te dane i tak istnieją.

### 2.4 Dlaczego transport nie dolatuje

Kolejność ważności:
1. zestrzelony przez pirata
2. zestrzelony przez wrogą frakcję
3. brak paliwa (stąd tankowanie po drodze)

**Zator NIE jest projektowanym trybem awarii.** Może opóźniać, nie ma głodzić.
Poprzednia instancja zbudowała cały system wokół zatorów — to był błąd odczytu.

### 2.5 Mini-symulacja zdarzeń

Coś się rozwala → leci holownik. Ktoś ginie → leci policja albo karetka.
**Workforce (ludzie) jest zasobem** — karetka go ratuje. To jest warstwa
zdarzeniowa: rzadka, lokalna, zasługuje na pełną symulację.

### 2.6 Gracz lata flotą

Docelowo gracz ma paliwo i lata z flotą: tankowce, frachtowce zbierające cargo.
Do tego floty NPC — kilka frachtowców chronionych okrętami, łowcy nagród w grupach.

---

## 3. Architektura — trzy warstwy

### Warstwa 1: REKORDY (wszystkie statki, zawsze)

Statek to rekord: pozycja, cel, ETA, ładunek, paliwo, frakcja. Postęp liczony
analitycznie, nie krok po kroku. **To jest warstwa autorytatywna dla ekonomii.**

- koszt: pomijalny, dziesiątki tysięcy rekordów to nic
- przechwycenie, walka, brak paliwa = zdarzenia rozstrzygane na rekordach
- komputer handlowy czyta agregaty stąd

Zgodne z ustaleniem z [[travel-model]]: *„logistyka MUSI być rekordowa, nie
encyjna"*.

### Warstwa 2: WĘZŁY (bramy, boostery, tankowania, doki)

Tam, gdzie przepustowość jest ograniczona, rekord wchodzi w **kolejkowanie
slotowe** — patrz [SPEC-kolejkowanie-slotowe.md](SPEC-kolejkowanie-slotowe.md).
Rozkład jazdy zamiast fizycznej kolejki; opóźnienie pochłaniane zwalnianiem
w drodze, nie staniem pod bramą.

Suwak `absorbFraction` decyduje, ile kolejki jest widoczne — czyli jak soczyste
są cele dla piratów. To jest decyzja projektowa, nie optymalizacja.

### Warstwa 3: BAŃKA (wokół gracza)

Rekord w promieniu gracza **materializuje się** w prawdziwy byt: lot swobodny,
unikanie, model dysz z gry, kadłub hex jeśli trzeba. Poza bańką — z powrotem
w rekord, z zachowaniem postępu.

- unikanie w stylu ORCA **tylko** w gęstych strefach bańki
- pełne ciała (hex, destruktor) **tylko** dla konwojów misyjnych i tego, co gracz
  zaatakuje — reszta lekka
- zdarzenia (holownik, karetka) materializują się, jeśli gracz jest blisko;
  daleko rozstrzygają się abstrakcyjnie

**To jest jedyna warstwa, która kosztuje.** I jest ograniczona promieniem, nie
liczbą statków w układzie.

---

## 4. Zmierzone liczby (nie szacuj ponownie)

Wszystko zmierzone w tej sesji, na maszynie użytkownika.

### Koszt na statek

| co | koszt |
|---|---|
| warstwa potoku (skalar na pasie, poprzednik `i-1`) | **0,058 µs**/statek/podkrok |
| sterowanie z separacją przez siatkę | **~0,5 µs**/agenta (rośnie z gęstością) |
| pipeline lotu z gry, van (1 dysza) | **1,01 µs**/statek/krok |
| ten sam, fregata (2+2 dysze) | 1,93 µs |
| ten sam, capital (6+4) | 3,46 µs |
| ten sam, supercapital (12+8) | 5,56 µs |
| mózg NPC z gry (z pamięci projektu) | ~3,5 µs/statek |

Pipeline lotu skaluje się liniowo z liczbą statków (1,91 → 2,12 µs przy 500 → 4000),
więc nie ma ukrytego n².

### Skala świata — 1:1 z gry

```
AU = WORLD_TARGET_DIAMETER 12e6 / ((Kuiper 140 + margines 2) × 2) = 42 253,52
```
`BASE_AU = 3000` w `index.html` to **tylko podłoga** i nigdy nie jest wartością
obowiązującą — człon `minAuForWorldTarget` jest 14× większy.

Stacje = planety (`makeSolarPlanets`), stacja stoi w pozycji planety, `r = 120`
(`index.html:9006`). Orbity: Merkury 8, Wenus 15, Ziemia 25, Mars 33, Jowisz 50,2,
Saturn 80,58, Uran 100,2, Neptun 120 AU. **Neptun bez frakcji = opuszczony.**
Kąty orbitalne gra losuje przy każdym starcie (`index.html:8445`).

Dystanse: sąsiedzi po orbicie 0,33–2,3 mln j. Mediana wszystkich par 2,46 mln j.
= **51 min lotu konwencjonalnego**. Deklarowane „Ziemia↔Mars ~7 min" zachodzi
tylko przy planetach w jednej linii.

### Kadłuby 1:1

`world length = HULL_RENDER_PROFILES[id].length × HULL_RENDER_WORLD_SCALE (0.6)`
(`ships.js:308`). Sprite dopasowany dłuższym bokiem.

Przykłady: shuttle 120×96, container_ship 312×216, long_haul_freighter 540×312,
terran_carrier 1080×384, megafreighter 2760×912, atlas 1800×600.

**Uwaga:** stacja ma w grze promień 120, a megafrachtowiec 2760 j. długości.
Statek jest 23× dłuższy niż promień stacji, przy której cumuje. To niespójność
w samej grze — kompleks dokowy trzeba przeskalować, odległości międzyplanetarne
zostawić 1:1.

### Wydajność całości

Prototyp pasowy, 8000 statków, mapa 1:1: **8–17 ms/klatkę** przy skali czasu ×40
(10 podkroków). Symulacja dominowała nad renderem. **To jest ta liczba, której
nie wolno powtórzyć** — gra już siedzi na ~20 ms na jednym rdzeniu.

---

## 5. Pułapki — czego NIE powtarzać

Każda z nich kosztowała diagnozę. To jest najcenniejsza część dokumentu.

### Fizyka i model ruchu

1. **`dt` obcinać z OBU stron.** `Math.min(0.05, dt)` przepuszcza wartość ujemną
   (cofnięty zegar, zaległy callback) i cała symulacja liczy się wstecz —
   zaobserwowane `s = −122 000 000`, `v = 163 000`.

2. **Przyspieszenie musi być duże wobec prędkości przelotowej.** Rozbieg to
   `v²/2a`. Przy `a=26` i `v₀=800` to 12,3 km — statek wjeżdżający na trasę
   pełznie przez pół drogi. Wyglądało jak brak przepustowości doku, było doborem
   stałej. `a=120` → 2,7 km.

3. **Ograniczenie prędkości „wolniejszy odcinek przed sobą" stosować dopiero gdy
   trzeba.** Zastosowane bezwarunkowo na całej długości przyszpila prędkość do
   limitu wyjazdowego od razu — booster z mnożnikiem 3× nie przyspieszał NIC
   (zmierzone 766–803 zamiast 2400). Hamować, gdy wymagane opóźnienie
   `(v² − v_lim²)/2·ds` przekroczy ~70% dostępnego.

4. **Limit MIEJSCA, nie TEMPA.** Booster z limitem tempa stoi pusty, a przed nim
   rośnie kolejka — nikt nie ma powodu czekać przed wolnym odcinkiem.

### Manewry i agenci

5. **Separacja zabija dokowanie, gdy odstęp stanowisk < promień separacji.**
   Stanowiska ~90 j. od siebie, separacja 340 j. → wszystkie stanowiska
   zarezerwowane, ani jedno zajęte. Wyłączyć separację dla zaparkowanych
   i dla promieniowego korytarza końcowego podejścia.

6. **Punkt odgięcia musi iść w PRZÓD i w bok.** Czysto boczny to zawrót ciaśniejszy
   niż promień skrętu — agent krąży wokół waypointu zamiast go minąć.

7. **Punkt oczekiwania nie może orbitować szybciej, niż statek potrafi lecieć.**
   Orbita o prędkości stycznej 180 przy statku 190 j./s = 534 agentów goniących
   cel bez końca.

8. **Buforem jest stanowisko, nie niebo.** Statek odchodzi od doku dopiero, gdy
   jest gdzie. Krótki limit czasu = wyciek ~0,75 statku/s do nieograniczonego
   bufora orbitalnego (zmierzone 591 agentów i rosło).

9. **Rezerwacja z za daleka marnuje przepustowość.** Rezerwacja stanowiska
   14 000 j. przed dokiem blokowała je na cały czas dolotu — przepustowość spadła
   kilkukrotnie. W modelu slotowym: krótki horyzont zgłoszenia + zamiana slotów.

### Struktura sieci

10. **Przepustowości bram są związane z topologią. Wyliczać, nigdy nie kopiować.**
    Trzy razy w tej sesji zmiana struktury (podpasy, kręgosłup, pierścienie)
    wymagała przestrojenia bram. Raz dało to 1484 statki w kolejkach.

11. **Wjazd/zjazd musi być ŁUKIEM, nie punktem.** Punktowy wjazd wymaga trafienia
    na lukę dokładnie tam i wtedy. Zmierzone: 1352 statki stojące przed
    pierścieniami. Po zamianie na łuk włączania — 63–176.

12. **Sprawdzaj, czy strefa wtapiania fizycznie istnieje.** Zadeklarowałem „16 km
    pasa włączania", a pomiar pokazał `wZasiegu: 0` — geometria schodziła na
    promień obwodnicy dopiero na ostatnich 2 km.

13. **Ruch przelotowy musi schodzić z pasa włączania.** Jeśli jedzie po nim także
    ruch okrężny, nowi nie mają się gdzie wcisnąć.

14. **Zamknięta pętla + wrak = kaskada.** Wrak na obwodnicy zbiera ofiary w kółko:
    ~180 kraks/min zamiast 3. Wraki w strefie stacji muszą znikać szybko
    (holowniki — i to się ładnie łączy z mini-symulacją zdarzeń z 2.5).

### Zachowanie zbiorowe

15. **Zmiana pasa MUSI mieć histerezę.** Bez karencji: 358 zmian/s przy 2000
    statkach — drganie, nie wyprzedzanie.

16. **ORCA nie kolejkuje.** To jej najlepiej udokumentowana słabość. Agenci przy
    wąskim przejściu tworzą napierający łuk, nie linię. Świetna do przecinających
    się strumieni (booster), bezużyteczna do kolejki przy bramie.

17. **ORCA nie ma bezwładności.** Zwraca prędkość i gwarantuje brak kolizji tylko
    jeśli agent osiągnie ją natychmiast. Statek z masą nie potrafi — gwarancja
    znika, trzeba nadrobić marginesem promienia.

---

## 6. Kolejność prac

1. **Warstwa rekordów + ekonomia.** Statki jako rekordy z ETA, przechwycenia,
   paliwo. Bez grafiki. Sprawdzić, czy ekonomia się domyka.
2. **Kolejkowanie slotowe** w węzłach — spec gotowy.
3. **Bańka materializacji** — rekord ⇄ byt, z zachowaniem postępu.
4. **Lot swobodny w bańce** + unikanie w gęstych strefach.
5. **Komputer handlowy** — wizualizacja agregatów (praktycznie darmowa).
6. **Zdarzenia** — holownik, karetka, policja.
7. **Floty i eskorty** — `requestBlock(n)` w kolejkowaniu, formacje w bańce.

Punkty 1–3 są fundamentem. 4–7 da się robić równolegle.

---

## 7. Otwarte — do rozstrzygnięcia pomiarem, nie dyskusją

- **Budżet na klatkę.** Gra siedzi na ~20 ms jednordzeniowo. Realny budżet dla
  ruchu to prawdopodobnie 2–4 ms. **Zmierzyć przed projektowaniem.**
- **Liczba statków.** Przy warstwie rekordów to przestaje być pytanie
  o wydajność, a staje się pytaniem o ekonomię — ile kursów potrzeba, żeby
  domknąć bilans surowców. Wyliczyć ze `stationEconomy.js`, nie zgadywać.
- **Worker.** Gra jest w 100% jednowątkowa i CPU-bound. Wyniesienie ruchu do
  Web Workera to darmowa wydajność. Wzorzec z Crowd.lab: `Float32Array`
  transferowalny, stride 5 `[prędkość, x, y, kurs, dystans do celu]`.
- **Przeplot aktualizacji** (trik z Cities: Skylines): nie liczyć wszystkiego
  w każdej klatce. Największy niewykorzystany zapas.

---

## 8. Zasady pracy

- **Polski** w kodzie (komentarze), UI i rozmowie.
- **Użytkownik testuje gameplay sam.** Twoja rola: `npm run build`, `npm test`,
  oraz **pomiar liczbowy** zamiast oceny na oko. Ta sesja pokazała, że praktycznie
  każda diagnoza „na oko" była błędna, a każda zmierzona — trafna.
- **Mierz, zanim zaczniesz naprawiać.** Cztery razy w tej sesji „oczywista
  przyczyna" okazała się czymś innym: brak przepustowości doku był doborem stałej
  przyspieszenia, korek przed pierścieniem był fantomowym liderem, kaskada kraks
  była zamkniętą pętlą.
- Prototyp: strona HTML z suwakami obok modułu w `src/`. Suwaki są sednem —
  bez nich nie da się tego wystroić.
- `docs/` — tam leżą: [opis prototypu pasowego](ruch-kosmiczny-opis.md) z pełną
  historią pomiarów, [spec kolejkowania](SPEC-kolejkowanie-slotowe.md),
  [spec ekonomii](SPEC-ekonomia-i-logistyka.md).

---

## 9. Czego prototyp pasowy nauczył — jednym zdaniem

Zbudowaliśmy poprawny model ruchu drogowego i przez kilka iteracji naprawialiśmy
**problemy węzłów drogowych** — fantomowe lidery, punktowe wjazdy, pasy włączania,
kolejność na rondzie. Ani jeden z nich nie jest problemem ruchu kosmicznego.

Kiedy większość pracy idzie na obsługę artefaktów własnej abstrakcji, abstrakcja
jest źle dobrana. Dlatego v2 nie ma pasów.
