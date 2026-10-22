# Etap 2 — klasy okrętów z mostka i rdzenia: propozycja do decyzji (2026-10-21)

Część planu `docs/PLAN-KREATOR-STOCZNIA.md` (punkt 5 wizji użytkownika: „mostek decyduje o klasie — maksymalna
powierzchnia i liczba gniazd; rdzeń też musi wpływać na kadłub; ulepszanie mostka i rdzenia = awans klasy i większy
okręt”). Liczby z pomiaru obecnej floty Terra Novy.

**PRZYJĘTA przez użytkownika 2026-10-21 z rekomendacjami**: krążownik jako klasa III, lotniskowiec jako rola w klasie V,
Atlas poza drabiną (unikat fabularny klasy VI), miękki limit mocy rdzenia, twarde limity mostka, liczby z tabel.

## Pomiar floty (2026-10-21)

Powierzchnia — kadłuby z klocków w kreatorze (zgodne z alfą sprite'ów co do 1–4%); Atlas i piraci — alfa sprite'a.
Gniazda — edytor gniazd gry (`SHIP_EDITOR_DEFAULTS`), a gdy kadłub go nie ma — `SHIPS[…].spec`. „Ciężkie” = główne +
specjalne + hangary + wbudowane; „lekkie” = pomocnicze + rakietowe.

| Okręt | Długość [j.] | Powierzchnia [j²] | Gniazda (ciężkie) | MAIN / SIDE | Masa | Prędkość maks. | Cena rynkowa |
|---|---|---|---|---|---|---|---|
| Custos (fregata) | 151 | 6 400 | 10 (6) | 2 / 2 | 10 000 | 1 400 | 4 200 |
| Hasta (niszczyciel) | 243 | 18 400 | 20 (12) | 4 / 4 | 25 000 | 1 000 | 8 200 |
| Bellator (pancernik) | 612 | 165 300 | 27 (15) | 4 / 4 | 50 000 | 650 | 14 500 |
| Citadella (lotniskowiec) | 1 055 | 352 100 | 40 (23) | 6 / 4 | 100 000 | 480 | 26 000 |
| Colossus (superkapitał) | 1 535 | 721 600 | 56 (24) | 7 / 13 | 200 000 | 380 | 48 000 |
| Atlas (gracz) | 1 700 | 671 300 | 45 (29) | 5 / 8 | 200 000 | 500 | start |
| piraci: fregata / niszczyciel / pancernik / superkapitał | — | 5 900 / 28 900 / 153 100 / 477 900 | po 19 | — | — | — | 3 600 / 6 800 / 11 800 / — |

Spostrzeżenia: między niszczycielem a pancernikiem powierzchnia rośnie ×9 (reszta drabiny ×2–3); lotniskowiec to rola
(hangary), a nie rozmiar; Atlas ma powierzchnię i gniazda superkapitału. Broń ma w danych pole `energyCost`
(`src/data/weapons.js`, 2–18 dla zwykłej broni, 12–120 dla specjalnej, 200 Hexlance, 400 promień śmierci), którego gra
dziś nigdzie nie egzekwuje — gotowy pobór mocy dla rdzenia.

## Zasady

1. **Klasa okrętu = poziom mostka (I–VI).** Mostek wyznacza twarde limity: powierzchnię kadłuba, liczbę gniazd
   (w tym ciężkich) i największy rozmiar broni (S / M / L / Capital — dziś `WEAPON_TIER_BY_HULL`). Edytor nie pozwoli
   ich przekroczyć.
2. **Rdzeń = moc [MW].** Moc pokrywa: utrzymanie kadłuba (rośnie z powierzchnią — tak rdzeń wpływa na kadłub), broń
   (`energyCost`), hangary, tarczę. Zapas mocy idzie w napęd: przyspieszenie klasy × 0,7 (bez zapasu) … × 1,2 (zapas
   ≥ 40%). Przy niedoborze urządzenia ponad moc są wyłączone według priorytetu gracza, a w kreatorze ich kable są
   „martwe” (szare) — sieć systemów pokazuje bilans mocy.
3. **Awans.** Ulepszony mostek podnosi limity, więc w stoczni gracz dokłada klocki (płaci za powierzchnię) i gniazda.
   Ulepszony rdzeń daje moc: więcej broni naraz i szybszy okręt. Rdzeń najwyżej o poziom ponad mostek (komora rdzenia
   musi się zmieścić). Większy kadłub na starym rdzeniu jest wolniejszy i ma mniej broni pod prądem — sensowny awans
   wymaga obu ulepszeń.

## Klasy — mostek

Limity z zapasem: wzór TN zajmuje 60–85% limitu, żeby było co rozbudowywać.

| Klasa (mostek) | Wzór | Limit powierzchni [j²] | Limit gniazd (ciężkich) | Broń do | Wzór w limicie |
|---|---|---|---|---|---|
| I Fregata | Custos | 10 000 | 12 (7) | S | 64% pow., 10 gniazd |
| II Niszczyciel | Hasta | 32 000 | 22 (13) | M | 57% pow., 20 gniazd |
| III Krążownik | — (nowa klasa, bez kadłuba TN) | 90 000 | 26 (15) | M | — |
| IV Pancernik | Bellator | 200 000 | 38 (22) | L | 83% pow., 31 gniazd |
| V Kapitał | Citadella (rola: lotniskowiec) | 420 000 | 44 (26) | L | 84% pow., 40 gniazd |
| VI Superkapitał | Colossus, Atlas | 900 000 | 60 (32) | Capital | 80% / 75% pow., 56 / 45 gniazd |

Piraci mieszczą się w tych samych klasach (fregata I, niszczyciel II, pancernik IV, superkapitał VI).

## Rdzeń — moc

Pobór wzoru = utrzymanie (0,07 · powierzchnia^0,6 MW: Custos 13, Hasta 25, Bellator 95, Citadella 149, Colossus 229,
Atlas 219) + broń w typowym uzbrojeniu klasy (mediany `energyCost` rozmiaru: główna S 4 / M 7,5 / L 14, pomocnicza
3 / 4 / 8, specjalna 12 / 22 / 40, hangar 5, Hexlance 200). Moc poziomu = pobór wzoru / 0,8 — wzór na swoim rdzeniu ma
~20% zapasu na napęd. To punkt startowy: przy wdrożeniu kalibracja na prawdziwych domyślnych uzbrojeniach NPC.

| Rdzeń | Moc [MW] | Wzór | Pobór wzoru (utrzymanie + broń) |
|---|---|---|---|
| R1 | 65 | Custos | 13 + 39 = 52 |
| R2 | 180 | Hasta | 25 + 118 = 143 |
| R3 | 280 | (krążownik) | — |
| R4 | 450 | Bellator | 95 + 266 = 361 |
| R5 | 700 | Citadella | 149 + 411 = 560 |
| R6 | 1 500 | Colossus (Atlas: 219 + 792 = 1 011) | 229 + 948 = 1 177 (promień śmierci NPC — ponad, +400) |

## Do decyzji (z rekomendacją)

1. **Krążownik (klasa III)** — nowa klasa między niszczycielem a pancernikiem (dziś skok ×9 powierzchni). Rekomendacja:
   tak; pierwszy kadłub tej klasy może powstać w kreatorze.
2. **Lotniskowiec** — rola w klasie V „Kapitał” (dużo gniazd-hangarów), nie osobna klasa. Rekomendacja: tak.
3. **Atlas** — ma rozmiar superkapitału. Rekomendacja: unikat fabularny klasy VI poza drabiną (ulepszany rdzeniem
   i modułami); drabinę przechodzą okręty budowane przez gracza w stoczni. Alternatywa: Atlas startuje z uszkodzonym
   mostkiem niższej klasy i fabuła go odbudowuje.
4. **Moc rdzenia** — miękki limit (urządzenia ponad moc wyłączone według priorytetu, zapas w napęd) czy twardy (nie da
   się zamontować ponad moc). Rekomendacja: miękki.
5. **Limity mostka** — twarde w edytorze. Rekomendacja: tak.
6. **Liczby** — limity z tabel (wzór w 57–85% limitu) czy ciaśniej / luźniej.
7. **Sieć w rozgrywce** (przecięty kabel = urządzenie bez prądu) — osobna decyzja na później.

## Co trzeba zrobić po decyzjach

- Dane: tabela klas mostka i poziomów rdzenia (`src/data/`), pobór mocy z `energyCost`, utrzymanie z powierzchni.
- Kreator: typ gniazda w module wieży (main / aux / missile / special / hangar), panel klasy (powierzchnia, gniazda,
  bilans mocy), blokada ponad limity, „martwe” kable przy niedoborze mocy.
- Gra (gdy kreator wejdzie do gry, etap 3): bilans mocy na okręcie, priorytety urządzeń, napęd z zapasu mocy.

## Wdrożenie w kreatorze (2026-10-21, sesja `klasy-mostek-rdzen`)

Opis stanu: `docs/KREATOR-KADLUBA.md` § „Klasy okrętów”. Różnice wobec propozycji:

- **Gniazda TN** — edytor gniazd gry trzyma Custosa, Hastę i Bellatora pod kluczami `frigate`, `destroyer`, `battleship`
  (pomiar wyżej szukał `terran_*` i wziął `SHIPS[…].spec`). Gra ma 4 / 8 / 31 / 35 / 56 gniazd (Custos 5 markerów, w tym
  duplikat; Citadella 40, w tym 5 duplikatów). Bellator zajmuje 31 gniazd, więc limit klasy IV podniesiony z 32 (18) do 38 (22) — decyzja użytkownika 2026-10-21;
  pozostałe limity bez zmian.
- **Moc rdzeni** skalibrowana na prawdziwym domyślnym uzbrojeniu NPC z tarczą (0,5 · utrzymanie): R1–R6 = 45 / 100 /
  185 / 330 / 450 / 1 150 MW (propozycja 65 / 180 / 280 / 450 / 700 / 1 500). Wzór na swoim rdzeniu ma 18–24% zapasu.
- Rakiety (bez `energyCost`) — 2 MW na wyrzutnię; tarcza w kolejce mocy jak broń (domyślnie pierwsza).
