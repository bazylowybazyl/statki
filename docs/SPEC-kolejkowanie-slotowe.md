# Kolejkowanie slotowe z rozproszonym pochłanianiem opóźnienia

Algorytm kolejkowania dla ruchu **bez pasów**. Zastępuje fizyczną kolejkę przed
stacją/bramą rozkładem jazdy i regulacją prędkości w drodze.

Powstał jako wniosek z prototypu pasowego (`ruch-kosmiczny.html`) — patrz
[opis](ruch-kosmiczny-opis.md), sekcje o pierścieniach i wlotach.

---

## Skąd pomysł

Kolejka to porządek **w czasie**, nie w przestrzeni. Na drodze jedno pokrywa się
z drugim: jesteś za mną fizycznie, bo przyjechałeś później. W kosmosie nic tego
nie wymusza — można rozdzielić te dwie rzeczy.

Dokładnie tak działa kontrola ruchu lotniczego: samolot nie stoi w kolejce na
prostej do lądowania, tylko dostaje **wyliczony czas przylotu** i pochłania
opóźnienie po drodze, zwalniając. Zatrzymanie się i czekanie to ostateczność.

To jest też odpowiedź na zarzut, że przy locie swobodnym traci się sterowalną
przepustowość: **rozkład jazdy stanowisk JEST przepustowością**, zadaną wprost.

---

## Dane

```js
berth = { cls, angle, freeAt }        // freeAt = czas symulacji, gdy się zwolni
ship  = { dest, cls, cta, berth, vCruise, hold, waited }
```

`cta` — controlled time of arrival, przydzielony czas wejścia na stanowisko.

---

## 1. Zgłoszenie (raz na kurs, gdy ETA spadnie poniżej horyzontu)

```js
const D      = dist(ship, station);
const tEarly = now + D / vMax;          // najwcześniej jak się da
const tLate  = now + D / vMin;          // najpóźniej bez zatrzymywania się

let best = null;
for (const b of station.berthsFitting(ship.cls)) {
  const t    = Math.max(b.freeAt, tEarly);
  const cost = (t - tEarly)                       // opóźnienie
             + CLASS_WASTE * (b.cls - ship.cls)   // best-fit
             - ship.bid;                          // opłacony priorytet
  if (!best || cost < best.cost) best = { b, t, cost };
}
ship.cta = best.t;
ship.berth = best.b;
```

Horyzont zgłoszenia: tyle, ile wynosi typowy kurs międzystacyjny podzielony przez
2–3. Za duży → rezerwacje blokują stanowiska dla bliższych statków. Za mały →
nie ma czym pochłonąć opóźnienia.

## 2. Pochłanianie opóźnienia

```js
if (ship.cta <= tLate) {
  ship.vCruise = D / (ship.cta - now);   // po prostu leć wolniej
  ship.hold    = 0;
} else {
  ship.vCruise = vMin;                   // wolniej się nie da
  ship.hold    = ship.cta - tLate;       // resztę wystoisz przy stacji
}
```

**To jest sedno.** Opóźnienie pochłania się tam, gdzie nic nie kosztuje —
w otwartej przestrzeni, zwalniając. Nie tam, gdzie kosztuje najwięcej — pod
samą bramą, w tłoku.

## 3. Zatwierdzenie

```js
best.b.freeAt = ship.cta + serviceTime(ship) + turnaround;
```

## 4. Przeplanowanie (co ~30 s symulacji albo na zdarzenie)

- `tEarly > cta` → nie zdążę, zwolnij slot i zgłoś się od nowa
- `tEarly << cta` i zwolnił się wcześniejszy → spróbuj poprawić
- kraksa / awaria → slot wraca do puli automatycznie

## 5. Zamiana slotów — ta ciekawa część

Pierwszy-zgłoszony-pierwszy-obsłużony jest głupi, gdy statki mają różne ETA.
Duży wolny frachtowiec z daleka blokuje slot, na który zdążyłby van tuż obok.

Co kilka sekund, per stacja, po statkach trzymających sloty:

```js
w = (cta - tEarly) + ALPHA * waited;     // opóźnienie + to, co już wyczekał

for (const [i, j] of nearbyPairs(slots, 8))       // okno 8 najbliższych slotów
  if (w(i) + w(j) > wAfterSwap(i, j)) swap(i, j);
```

Człon `ALPHA * waited` jest **konieczny** — bez niego minimalizacja sumy opóźnień
głodzi duże i wolne statki, bo zawsze opłaca się wpuścić szybszego. Z nim czas
oczekiwania rośnie monotonicznie, więc każdy kiedyś wygrywa. Ta sama zasada, która
w prototypie pasowym zapewniała brak zagłodzenia przy stanowiskach.

Koszt: `O(k²)` przy `k = 8`, raz na kilka sekund, na stację. Nic.

## 6. Sloty za pieniądze

`ship.bid` w funkcji kosztu to gotowy hak ekonomiczny: statek (albo gracz) płaci
za wcześniejszy slot. Cena rynkowa wynika z tego, ile slotów jest zajętych —
czyli **przy dużej flocie transport tanieje sam z siebie**, bo sloty są wolne.
Dokładnie ten mechanizm, o który chodziło.

## 7. Podejście z dowolnej strony

To jest premia, której nie da się mieć przy pasach. Skoro przyloty są rozdzielone
**w czasie** per stanowisko, a stanowiska są rozłożone **po kątach**, to dwa statki
nigdy nie potrzebują tej samej przestrzeni. Lot prosto do swojego stanowiska
z dowolnego kierunku jest bezpieczny z konstrukcji.

Lokalne unikanie potrzebne dopiero w promieniu `FINAL_RADIUS` (ok. 2× promień
pierścienia stanowisk) — i tylko tam warto płacić za wyszukiwanie sąsiadów.

---

## Jak to wygląda na ekranie

| obciążenie portu | obraz |
|---|---|
| poniżej przepustowości | statki wchodzą pełną prędkością, **zero kolejki**, stanowiska ciągle zajęte |
| powyżej | zwalniają daleko — szeroki, powolny strumień dolotowy zamiast sznurka |
| mocno powyżej | resztkowy hold przy stacji: wolno dryfująca chmara, „reda" |

## Pokrętło, które jest decyzją projektową, nie optymalizacją

```js
absorbFraction ∈ [0, 1]   // ile opóźnienia wolno pochłonąć w drodze
```

- `1.0` — niewidoczne i wydajne, port pracuje jak szwajcarski zegarek
- `0.0` — wszyscy przylatują na pełnej i stoją fizycznie (dzisiejsze zachowanie)
- pomiędzy — **wybierasz, jak soczyste są cele dla piratów**

Bo kolejka pod bramą to jedyne miejsce, gdzie konwój jest wolny i spętany —
patrz model podróży. Tym suwakiem decydujesz, ile tego chcesz.

---

## To samo dla bram warp i boosterów

Identyczny mechanizm, tylko zamiast stanowisk jest jeden „zasób" o stałym
interwale obsługi `1/rate`. Statek dostaje slot tranzytowy i tak dobiera prędkość,
żeby dolecieć na czas. W lotnictwie to się nazywa CTOT i działa od dekad.

Efekt: brama jest **zawsze zajęta, nigdy zatłoczona** — chyba że świadomie
zmniejszysz `absorbFraction`.

---

## Znane pułapki

**Kaskada spóźnień.** Jeśli statki systematycznie nie wyrabiają się z CTA
(przeszkody, kraksy), sloty się piętrzą. Zabezpieczenie: bufor między slotami
(5–10% czasu obsługi) plus przeplanowanie z punktu 4.

**Rezerwacja z za daleka.** Zbyt duży horyzont zgłoszenia = stanowisko stoi puste,
bo czeka na kogoś z drugiego końca układu. To był realny błąd w prototypie
pasowym: rezerwacja z 14 000 j. blokowała stanowisko na cały czas dolotu i
przepustowość doku spadła kilkukrotnie. Horyzont trzymać krótko, resztę załatwia
zamiana slotów.

**Statek gracza.** Nie stosuje się do CTA. Traktować jako obiekt, wobec którego
wszyscy inni ustępują w pełni, i nie liczyć na jego slot.

---

## Koszt

Jedno przejście po ~30 stanowiskach raz na kurs, plus `O(64)` na zamiany co kilka
sekund na stację. W praktyce **zero** w porównaniu z utrzymywaniem fizycznej
kolejki co klatkę.

Dla porównania, zmierzone w prototypie pasowym: warstwa potoku 0,058 µs/statek/
podkrok, separacja przez siatkę ~0,5 µs/agenta, pełny pipeline lotu z gry
1–2 µs/statek/krok.

---

## Jak to wiąże się z resztą pomysłów

- **Parking dla statków bez zlecenia** — statek bez zlecenia po prostu nie ma CTA.
  Leci do wolumenu parkingowego. Zlecenie przychodzi → zgłasza się po slot.
- **Floty i eskorty** — `requestBlock(n)`: rezerwacja n kolejnych slotów, żeby
  konwój zadokował razem. Naturalne rozszerzenie funkcji kosztu.
- **Ramiona rozładunkowe, roboty, taśmy** — to wszystko wchodzi w `serviceTime()`.
  Lepszy sprzęt = krótsza obsługa = więcej slotów = tańszy transport.
