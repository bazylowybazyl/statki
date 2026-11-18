---
paths:
  - "src/data/cargo*.js"
---

# Transport ładunku: standard (kontener → moduł → sekcja), nośniki, sprzęg i gniazdo

> Reguła obszaru. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Propozycja, liczby i decyzje czekające na użytkownika: `docs/PROPOZYCJA-standard-ladunku.md`. Ciągniki z naczepami: reguła `ciagniki`; przeładunek w portach i drony: `przeladunek-portow`; dzielnice ringu i styk z produkcją: `dzielnice-ringu`; ekonomia i klasy ładowni: `ruch-v2`.

## Stan

- STANDARYZACJA ODŁOŻONA (decyzja użytkownika, 2026-11-16 wieczorem): „standaryzacja musi pójść później — to w trakcie budowy fabryk i stoczni wyjdą rozmiary transportowanych surowców, a nie na odwrót. Nie wiem, jaki nam wyjdzie zawijas stali czy jaki nam wyjdzie gaz przy rafineriach. Wszystko ułożymy naturalnie po kolei i później.” Wymiary i tony w `cargoStandard.js`, na planszy i w dokumencie są ROBOCZE: nie ustalać ich, nie budować na nich dalej i nie zmieniać na ich podstawie istniejących danych ani dem. Liczby mają wyniknąć z prawdziwych wyrobów zakładów (pierwszy: krąg stali z huty — rozmiary poda sesja produkcji).
- MATERIAŁ WSTĘPNY (2026-11-16): **do gry nic nie jest wpięte i żadna istniejąca liczba nie jest zmieniona**. Kierunek użytkownik nazwał „fajnym” i ten zostaje (jeden standard ładunku, statki dostają sprzęg albo gniazdo na sekcję, kopacz z kruszarką); liczby standardu, ciągnik sekcyjny, sztywne zestawy i zakres ciężarówek to propozycje sesji transportu, nie decyzje.
- Podział pracy (decyzja użytkownika 2026-11-16): transport (standard ładunku, naczepy, sekcje, ciężarówki, ruch między dzielnicami) prowadzi osobna sesja; produkcja (huta, fabryki) — sesja prowadząca dzielnice. Plików huty i zestawu wspólnego dzielnic sesja transportu nie zmienia; styk (pakowanie wyrobu, stanowisko rudy) uzgadnia się między sesjami.
- Pliki: `src/data/cargoStandard.js` (dane, czyste), `tests/cargoStandard.test.mjs`, plansza `dema/standard-ladunku.html` / `.js`, zrzuty `scripts/webgpu/standard-ladunku-demo.mjs`.
- AGENT: po pierwszym commicie dopisz do `paths` globy `dema/standard-ladunku.*`, `tests/cargoStandard.test.mjs`, `scripts/webgpu/standard-ladunku-demo.mjs` (glob bez śledzonego pliku nie przechodzi `tests/agentsMd.test.mjs`).

## Poprzeczka (słowa użytkownika, 2026-11-16)

- „Wszystko robimy od nowa — production ready”, „oceniamy i staramy się robić AAA”, „cokolwiek nie robimy, chcemy mieć dopieszczony output — powoli, ale dokładnie”.
- Praca elementami: jeden element naraz, własne demo, prawdziwa symulacja zamiast udawania ruchu skalowaniem brył, każdy zrzut obejrzany przed pokazaniem, ocena użytkownika PRZED następnym elementem. Szerokiej, płytkiej całości nie oddawać.
- Tymczasowy wygląd tylko jawnie i z zaplanowaną turą; ruch, fizyka i czytelność z kamery gry docelowe od razu. Kod według zasad żelaznych, żeby wpięcie nie oznaczało pisania od nowa.
- Żaru i plazmy gry (strugi silników) nie brać za wzór wyglądu — użytkownik: „słabo wygląda i z chęcią zobaczyłbym nowe”; technikę wolno.
- Rundy „budowa → niezależny krytyk obrazu → poprawki” to praca wieloagentowa (ok. 10 punktów tygodniowego limitu na rundę) — proponować z kosztem, decyduje użytkownik.
- Ocena dema ciągników względem tej poprzeczki (co zostaje, co od nowa) i kolejność elementów: `docs/PROPOZYCJA-standard-ladunku.md` § 4.

## Słowa użytkownika (2026-11-16)

- „Materiał będzie pakowany na ciężarówki — trzeba ustandaryzować naczepy — do rozwożenia po ringu i pobliskich baz, np. Księżyc, jeśli trzeba.”
- „Ustandaryzować rozmiary ładowni i robić z nich à la naczepy do ciągania przez większe trucki, czyli de facto zamienić frachtowce na ciągnik + kosmiczną naczepę.”
- „Co ze statkami? W sumie nic. Kopaczom da się ustandaryzowaną naczepę, np. w środek budowy — kopacz też będzie mógł ciągać, odpinać. Podepnie sobie naczepę i np. kruszarkę.”
- Niezdecydowane: „myślę, czy ciężarówki wysyłać na eksport, czy tylko większe statki”.

## Standard (liczby robocze — do przeliczenia po wyrobach zakładów)

- Drabina: kontener gry 16 × 8 j. (7,5 t) → moduł 2 × 2 kontenery (32,25 × 16,25 j., 30 t — ładunek naczepy) → sekcja 2 × 2 moduły (64,75 × 32,75 j., 16 kontenerów, 120 t). Każdy stopień to 2 × 2 poprzedniego.
- Sekcja w ramie 68 × 36 j. ze sprzęgami na osi; rozstaw 72 j. na sprzęgu sztywnym (zestaw statku — jedna bryła), 80 j. na dyszlu (zestaw drogowy — przegub jest obrazem). Gniazdo w kadłubie 72 × 40 j., kadłub co najmniej 56 j. szerokości.
- Odmiany nośnika na każdym stopniu: skrzynia, zbiornik, zasobnik (rodziny kontenerów gry) i platforma (nowa: kręgi, belki, płyty). Sekcja narzędziowa (kruszarka) ma obrys, sprzęg i gniazdo sekcji ładunkowej.
- Liczby pasują do tego, co jest: naczepa 30 t, prom `van` 60 t = 2 moduły, wyprawa górnicza 120 t = sekcja, statek z dema rudy 360 t = 3 sekcje, `heavy` 900 t = 7 sekcji + 2 moduły, `mega` 2400 t = 20 sekcji. `hauler` (160 t) i `bulk` (380 t) zostawiają resztę mniejszą niż kontener — ruchu v2 standard nie zmienia.

## Zasady

- Tona jest liczbą rachunku ruchu v2, kontener jej widokiem: nośnik zmienia wygląd i sposób przeładunku, nie tony.
- Liczby standardu bierz z `cargoStandard.js`, nie przepisuj ich do modułów; moduł standardu nie zmienia `cargoBays.js`, `cargoContainers.js` ani `spaceTrucks.js` — zgodności pilnuje test (kontener gry, moduł i tony naczepy, chwyty dronów S / L / Capital, klasy `VAN_CLASSES`, `miningYieldUnits`). Zmiana jednej z tych liczb w grze = świadoma zmiana standardu i testu.
- Nowy towar dostaje nośnik z `cargoCarrierFor` (rodzina z `containerFamilyOf` + lista platformy `CARGO_FLAT_GOODS`); ludzie nie są ładunkiem (promy).
- Sztuka jadąca na platformie mieści się w `cargoMaxPiece(stopień)` (15 × 7, 31 × 15, 63 × 31 j.).
- Plansza `standard-ladunku` to rysunek wymiarów na kanwie 2D (bez three i shaderów), liczby czyta z danych; bryły proponowane (sekcja, kruszarka, ciągnik sekcyjny, platforma) są rysunkiem roboczym, nie wyglądem docelowym. Podpisy mają progi powiększenia i nie mogą na siebie nachodzić — nowy podpis sprawdź na kadrze całości i w oknie 16 : 9.

## Otwarte

- Rozmiary i tony: czekają na wyroby zakładów (decyzja wyżej). Skala huty (ok. 6 × większa niż kontener gry: ciężarówka 431 j., krąg 120 j., ładownia 468 × 252 j. na 360 t) i tony na kontener w starych danych (2 t w demie ładowni, kreatorze i dronach) rozstrzygną się razem z nimi.
- Ocena dema ciągników względem poprzeczki (wygląd od nowa?) — decyduje użytkownik.
- Praca niezależna od rozmiarów ładunku (zestaw w ruchu: masa, sprzęg, manewry, nowa struga) — zaproponowana użytkownikowi, czeka na jego decyzję.
- Ruch między dzielnicami, pociągi, odczepianie sekcji w przestrzeni, dalekie zestawy — nie zaczynać bez polecenia użytkownika.

## Jak sprawdzić

- `node --test tests/cargoStandard.test.mjs`.
- Zrzuty: `node scripts/webgpu/standard-ladunku-demo.mjs --out .tmp/standard-ladunku [--panel 1]` (własny Vite 5461, kadr całości 3200 × 1056 i kadry stref; `raport.json`: podpisy, wymiary, błędy konsoli — ma być 0). Strona: `/dema/standard-ladunku.html` (`?shot=1` — bez paska widoków), API `window.__standard` (`ready`, `errors`, `views()`, `view(i)`, `rects()`, `stats()`).
