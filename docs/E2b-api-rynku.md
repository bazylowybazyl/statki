# E2b — API rynku: jeden model handlu (2026-10-22)

Zadanie z `docs/PLAN-ekonomia-rynki.md` § 3.1 („Jeden model handlu”), wiersz E2b w § 4. Stan i zasady: reguła
`.claude/rules/ruch-v2.md`, § „API rynku”.

## Co powstało

- `src/game/traffic/marketStock.js` — `takeStock`, `putStock`, `moveStock`: jedyne reguły zmiany magazynu stacji
  (poza księgowością przewoźników w `shipmentOrders.js`). Moduł bez importów, bo te same funkcje liczą kopię rynku
  w moście gry (`TrafficBridge.stockDelta`).
- `src/game/traffic/marketBook.js` — księga rynku dyspozytora (`director.book`), otwierana raz na tick
  (`openMarket`):
  - rezerwacje towaru w drodze;
  - oferty sprzedaży i zamówienia skupu;
  - notowania `resourcePrice` z towarem w drodze;
  - popyt konsumentów spoza receptur (`declareDemand`).
- Na API przeszli: planista dyspozytora, kupcy (`buyCargo` / `sellCargo`), stocznie (zgłoszenie popytu, zużycie
  podzespołów), wojna (amunicja), złomiarze, paser piratów, urobek wypraw, handel gracza w workerze
  (`applyStockDelta`) i kopia rynku w moście.
- Terminal gracza (`index.html`, `getTradeOffer`): ta sama oferta co dla NPC — stacja sprzedaje tylko zapas ponad
  rezerwę na własne potrzeby (`offerFloor`), przyjmuje do pojemności i płaci za to, co weszło.
- `scripts/bramka-bilansu.mjs --dyrektor '{json}'` — opcje dyspozytora do A/B bez zmiany kodu.

Refaktor (faza A) nie zmienia zachowania: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczne z bazą
liczba w liczbę.

## A/B: oferta sprzedaży planisty (`DIRECTOR_DEFAULTS.sellOffers`)

`'surplus'` — dzisiejsza nadwyżka ponad 70% magazynu. `'reservation'` — cena rezerwacji producenta jak u kupców
(`sellOfferTo` = `sellDownToFill` wobec skupu odbiorcy). Bramka, 3 ziarna (7 / 11 / 23), 240 min, presja ×1,
magazyny ×4, ×60, przebiegi po kolei na obciążonej maszynie (tick tylko orientacyjnie).

| wariant | dostawy | przechwyty (z ładunkiem) | głód > 30 min | najdłuższy głód | kolejka na redzie (najgorszy port) | szczyt kursów | tick |
|---|---|---|---|---|---|---|---|
| A `surplus` (= baza) | 19,6–20,3 tys. | 15,5–16,3% | 0 | 14,4–14,7 min | Ceres 3,2–3,3 / Oberon 2,7 | 1377–1504 | 41–74 ms |
| B `reservation`, marża 0 | 39,7–41,4 tys. | 13,4–13,8% | 0 | 0,1–11,3 min | Wenus 104–1008, Saturn 14–27, Uran 10–17 | 2187–3787 | 86–128 ms |
| B `reservation`, marża 12% | 36,9–37,5 tys. | 12,9–13,3% | 0 | 0,6–2,2 min | Wenus 36–306, Uran 10–14, Saturn 10–13 | 1833–2174 | 91–123 ms |

Wniosek: jeden model ceny dla planisty prawie znosi głód (dawna miara 1% magazynu: 17–27 min zamiast 40–43 min,
0 pozycji zamiast 9–10), ale podwaja przepływ, a porty bez ringu (Wenus, Saturn, Uran, Westa) go nie przyjmują.
Domyślnie zostaje `'surplus'`. Przełączenie na `'reservation'` czeka na przepustowość portów (E4: kolejki
i tick) albo na limit oferty po stronie portu nadania (np. sprzedaż nie szybciej, niż port wydaje statki).
