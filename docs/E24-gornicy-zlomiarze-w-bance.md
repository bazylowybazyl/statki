# E24 — górnicy i złomiarze NPC w bańce gracza (2026-11-08)

Zadanie od orkiestratora ekonomii: górnicy i złomiarze NPC w bańce mają być widać w pracy, a złomiarze mają sprzątać
wraki, które widać w grze. Stan i zasady — reguła `ruch-banka`, § „Praca w bańce: górnicy i złomiarze (E24)”; wraki —
reguła `wraki`. Tu rozpoznanie, decyzje i pomiary.

## Rozpoznanie (przed kodem)

- Postój górnika przy polu (etap `EXTRACT` wyprawy `MINE`, punkt z `planExpedition`) i złomiarza przy wraku (`SERVICE`
  kursu `TUG`, pozycja wraku z rejestru) trafiał do bańki przez `planDwell` (`materializedFlight.js`): encja leciała do
  punktu i stała w fazie `station`. Bufor `actors` nie niósł rodzaju kursu ani powodu postoju — gra widziała tylko „stoi”.
- Pomiar (`SEED=7`, ×60, 2 h, kąty domyślne świata, skrypt jednorazowy w `.tmp/zlom/rekon.mjs`): 59 wypraw MINE, żadna
  ≤ 100 tys. j. od portu, 9 w 124–147 tys. (Ceres, Fobos); bańka żyła tylko ≤ 180 tys. od portu albo w studni planety, więc
  większości górników nie dało się zobaczyć nigdy. TUG: 48 kursów, wszystkie ≤ 2 tys. j. od węzła portu — wraki bitew
  kampanii (`emitWrecks`) leżą przy węźle stacji celu ±2000 j., przy ringach to środek planety (złomiarz staje w lejku).
- Złomiarze brali tylko `war.wrecks` (bitwy kampanii, kampanie rozbite w drodze, straty garnizonu z gry); `director.wrecks`
  (zestrzelone frachtowce) to dziennik ładunku. `assessWreck`: hol wygrywa zawsze z cięciem.
- Wraki gry: hak `HullBodies.onWreckSpawned` widzi każdy nowy (śmierć statku i odłamy), usuwanie `removeWreckFromWorld`,
  cięcie gracza `cutOuterNode`, hol gracza `TowSystem` (lina rysuje się sama na kanwie 2D).

## Decyzje (wariant domyślny wysłany orkiestratorowi)

1. Protokół: `actors.works` / `unworked` (tylko zmiany), `wreck-report` / `wreck-gone` (gra → worker), `salvage-taken`
   (worker → gra) — `SALVAGE_MSG` na końcu `trafficProtocol.js`.
2. Bańka żyje także przy miejscach pracy (`WORK_SITE_RANGE` 120 tys. j.). Bez gracza symulacja identyczna.
3. Wrak gry → wpis na początku `war.wrecks` z manifestem z ułamka kadłuba; odłam i cywil — sam złom (cięcie, gdy się
   opłaca); okręt garnizonu wiąże się ze stratą zapasu (bez drugiego wraku); rezerwa 2 holowników stacji tylko dla wraków
   gry; gracz zabrał wrak — złomiarz wraca pusty.
4. Obraz: górnik — `MiningView` pasa (te same partie dronów i wiązek), złomiarz — palniki, iskry, odłamki, wiązka przy
   linie (`trafficWork3D.js`).
5. Wraki wojen w tle — bez obrazu; propozycja na później: zimny wrak z szablonu klasy przy wejściu w bańkę.

## Pomiary

- Symulacja `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po kroku 1 — identyczna (poza czasem ticku).
- Wyniki w grze, koszt klatki i bramka bilansu — sekcja niżej (uzupełnia przebieg `zlomiarze-gra.mjs`).
