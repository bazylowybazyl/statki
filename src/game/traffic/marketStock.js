/**
 * ZAPAS RYNKU — jedyne reguły zmiany magazynu stacji w ruchu v2 (API rynku, `marketBook.js`).
 *
 * Osobny moduł bez importów, bo te same reguły stosuje most gry do swojej kopii rynku
 * (`TrafficBridge.stockDelta` → kopia od razu, worker po swojej stronie) — a most nie może
 * ciągnąć za sobą dyspozytora ani gospodarki. Jedna funkcja po obu stronach = kopia i świat
 * liczą handel gracza tak samo.
 */

/** Stan magazynu (sztuki świata ruchu). */
export function stockOf(econ, resourceId) {
  return Number(econ?.resources?.[resourceId]) || 0;
}

/**
 * Zdejmuje z magazynu do `units` sztuk — nie poniżej zera. Zwraca, ile zeszło.
 * Bierze tyle, ile jest: wołający, który musi mieć całość (kupiec, stocznia), sprawdza
 * zapas przed transakcją.
 */
export function takeStock(econ, resourceId, units) {
  if (!econ?.resources) return 0;
  const stan = Math.max(0, Number(econ.resources[resourceId]) || 0);
  const wziete = Math.min(stan, Math.max(0, Number(units) || 0));
  if (wziete > 0) econ.resources[resourceId] = stan - wziete;
  return wziete;
}

/**
 * Dokłada do magazynu do pojemności (pojemność ≤ 0 albo brak = bez limitu). Zwraca, ile
 * weszło — nadmiar ponad magazyn przepada u wołającego (kupiec dostaje zapłatę tylko za to,
 * co weszło; urobek z pasa i łup po prostu się nie mieszczą).
 */
export function putStock(econ, resourceId, units) {
  if (!econ?.resources) return 0;
  const amount = Number(units) || 0;
  if (!(amount > 0)) return 0;
  const stan = Number(econ.resources[resourceId]) || 0;
  const cap = Number(econ.capacity?.[resourceId]) || 0;
  const next = cap > 0 ? Math.min(cap, stan + amount) : stan + amount;
  econ.resources[resourceId] = next;
  return next - stan;
}

/** Zmiana zapasu o `delta` (dodatnia — przyjęcie, ujemna — wydanie). Zwraca faktyczną zmianę. */
export function moveStock(econ, resourceId, delta) {
  const d = Number(delta) || 0;
  return d > 0 ? putStock(econ, resourceId, d) : (d < 0 ? -takeStock(econ, resourceId, -d) : 0);
}
