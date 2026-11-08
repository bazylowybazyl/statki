/**
 * KOMPUTER HANDLOWY — „kto ile płaci” w układzie strony (E23a, docs/PROPOZYCJA-ekonomia-ukladow.md § 9).
 *
 * Moduł czysty (bez DOM, three i gry): dla towaru i ilości lista rynków, które go skupią (`side = 'buy'`) albo
 * sprzedadzą (`side = 'sell'`), liczona z KOPII rynku z mostu ruchu v2 (`TrafficBridge.market`, tabela stacji
 * `tables.stations`) — ta sama kopia, z której terminal stacji bierze ofertę portu. Cena: `resourcePrice` z reputacją
 * gracza i zaokrągleniem jak `getTradeOffer` w `index.html` (komputer i terminal po przylocie pokazują to samo);
 * ilość: oferta portu `buy` / `sell` z bufora (`MARKET_FIELD.BUY` / `SELL`, `portOfferFromQuote` w workerze):
 * skup −1 = „nie skupuje”, 0 = „ma dość”.
 *
 * Kolejność: zysk z uwzględnieniem drogi — zarobek na transakcji (cena − średnia cena zakupu partii w ładowni,
 * razy ilość, którą port przyjmie) na minutę lotu z dokowaniem (`TRADE_PARTNER_TUNE.dockSeconds`). Rynek bliski
 * i trochę tańszy wygrywa z dalekim i trochę droższym. Rynki ze stratą idą za zyskownymi, wrogie doki (reputacja,
 * `canDock`) na koniec listy.
 *
 * Droga: odległość prosta od gracza i czas lotu napędami gracza z jednej tabeli napędów (`src/data/driveModes.js`):
 * hipercruise profilem trapezowym z rozruchem albo warp (narzut wejścia i wyjścia) — krótszy z dwóch.
 * To szacunek: strefy przy planetach i omijanie ringów wydłużają lot, więc interfejs pisze „ok.”.
 *
 * Pomija: kryjówki (`kind === 'hideout'` — paser, nie rynek; § 9.2), rynki ukryte mgłą wojny (`filters.hidden`,
 * w grze `SensorSystem.hides`), stację, przy której gracz stoi (`filters.excludeId` — terminal), i rynki bez kopii.
 * Kontrakty obsady (towar `workforce`) liczą się tą samą drogą — to oferty tej samej księgi rynku (§ 9.6).
 */

import { RESOURCES } from '../data/resources.js';
import { resolveStanding, canDockWithFaction, normalizeFaction } from '../data/factions.js';
import {
  hypercruiseSpec, trapezoidSeconds, warpDriveSpeed, WARP_DRIVE, HYPERCRUISE_TUNE, playerHullDrives
} from '../data/driveModes.js';
import { resourcePrice } from './stationEconomy.js';

export const TRADE_PARTNER_TUNE = Object.freeze({
  /** Ile wierszy zwraca zapytanie bez `filters.limit` (karty pokazują 3–5). */
  limit: 5,
  /** Podejście, dokowanie i przeładunek doliczane do każdego lotu [s] — rynek „tuż obok” nie dzieli przez zero. */
  dockSeconds: 60,
  /** Pozycja gracza w kluczu pamięci zapytań: kubełek [j.] (ruch o mniej nie przelicza odległości). */
  positionBucket: 25000,
  /** Ile różnych zapytań most trzyma do następnego bufora rynku. */
  cacheSize: 64
});

/** Napędy gracza bez podanych w filtrach: Atlas (hipercruise Mk I, warp Mk II). */
const DEFAULT_DRIVES = (() => {
  const ids = playerHullDrives('atlas', 'supercapital');
  return Object.freeze({
    hypercruise: hypercruiseSpec(ids.hypercruise, 'supercapital'),
    warpSpeed: warpDriveSpeed(ids.warp)
  });
})();

/**
 * Napędy gracza do rachunku czasu: `{ hypercruise: hypercruiseSpec(...) | null, warpSpeed: j/s | 0 }`.
 * `engineId` / `warpId` jak w grze (`playerHypercruiseEngineId` / `playerWarpDriveId`), `flightClass` kadłuba.
 */
export function playerTravelDrives(engineId, warpId, flightClass = 'supercapital') {
  return {
    hypercruise: engineId ? hypercruiseSpec(engineId, flightClass) : null,
    warpSpeed: warpId ? warpDriveSpeed(warpId) : 0
  };
}

/**
 * Czas lotu na odległość `distance` [j.] napędami `drives`: `{ seconds, mode }`, mode 'hypercruise' | 'warp' |
 * 'combat' (bez obu napędów — limit bojowy ~500 j/s). Bez dokowania.
 */
export function travelEstimate(distance, drives = DEFAULT_DRIVES, out = { seconds: 0, mode: 'hypercruise' }) {
  const d = Math.max(0, Number(distance) || 0);
  let best = Infinity;
  let mode = 'combat';
  const hc = drives?.hypercruise || null;
  if (hc) {
    const t = d < HYPERCRUISE_TUNE.minLeg ? d / 507 : trapezoidSeconds(d, hc.vmax, hc.accel, hc.decel, hc.spool);
    if (t < best) { best = t; mode = 'hypercruise'; }
  }
  const warpSpeed = Number(drives?.warpSpeed) || 0;
  if (warpSpeed > 0 && d >= HYPERCRUISE_TUNE.shortLeg) {
    const t = WARP_DRIVE.chargeTime + WARP_DRIVE.overheadSeconds + d / warpSpeed;
    if (t < best) { best = t; mode = 'warp'; }
  }
  if (!Number.isFinite(best)) best = d / 507;
  out.seconds = best;
  out.mode = mode;
  return out;
}

const _travel = { seconds: 0, mode: 'hypercruise' };
const _pos = { x: 0, y: 0 };

/** Nazwa rynku z tabeli workera bywa id („saturn”) — w kartach wielką literą jak w CIC. */
function displayName(name) {
  const text = String(name || '?');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Kolejność: najpierw doki otwarte, potem zyskowne przed stratnymi, w grupie — wynik malejąco, potem cena. */
function compareRows(a, b, side) {
  if (a.canDock !== b.canDock) return a.canDock ? -1 : 1;
  const ap = a.profit > 0;
  const bp = b.profit > 0;
  if (ap !== bp) return ap ? -1 : 1;
  if (b.score !== a.score) return b.score - a.score;
  if (a.price !== b.price) return side === 'sell' ? a.price - b.price : b.price - a.price;
  return a.seconds - b.seconds;
}

/**
 * Lista partnerów handlu dla towaru. `view`: `{ stations: [{ id, name, factionId, x, y, kind, derelict }…],
 * market: Map(stationId → kopia { resources, capacity, duress, buy, sell }), ready }` — kształt `TrafficBridge`
 * (`ready: false` — żaden bufor rynku jeszcze nie przyszedł, kopie są zerami).
 *
 * `filters`:
 *   amount      ile gracz ma do sprzedania / chce kupić (0 — bez limitu: ilość z oferty portu)
 *   costBasis   średnia cena zakupu partii (CR/szt.; skup) albo cena odniesienia (sprzedaż; domyślnie wartość towaru)
 *   from        { x, y } — gracz; bez niego odległość 0
 *   reputation  PLAYER.reputation (cena z reputacją, stosunki, `canDock`)
 *   hidden      (stacja z tabeli) => true — rynek ukryty mgłą wojny
 *   positionOf  (stationId, out) => out | null — bieżąca pozycja rynku (domyślnie x, y z tabeli)
 *   excludeId   stacja pominięta (terminal: port, przy którym gracz stoi)
 *   drives      napędy gracza (`playerTravelDrives`)
 *   limit       ile wierszy (domyślnie TRADE_PARTNER_TUNE.limit)
 *
 * Wynik: `{ resourceId, side, rows, skipped: { full, notBuying, hidden, hostile, hideout }, considered, pending }`.
 * `pending` — kopia rynku jeszcze pusta (most przed pierwszym buforem): interfejs pisze „liczę…”.
 */
export function findTradePartners(view, resourceId, side = 'buy', filters = {}) {
  const key = String(resourceId || '');
  const selling = side === 'sell';
  const result = {
    resourceId: key,
    side: selling ? 'sell' : 'buy',
    rows: [],
    skipped: { full: 0, notBuying: 0, hidden: 0, hostile: 0, hideout: 0 },
    considered: 0,
    pending: false
  };
  const def = RESOURCES[key];
  if (!def) return result;
  const stations = Array.isArray(view?.stations) ? view.stations : [];
  const market = view?.market;
  if (!stations.length || !market || !market.size || view.ready === false) { result.pending = true; return result; }

  const amount = Math.max(0, finite(filters.amount));
  const fallbackRef = Math.max(0, finite(def.value));
  const basis = filters.costBasis == null ? (selling ? fallbackRef : 0) : Math.max(0, finite(filters.costBasis));
  const fromX = finite(filters.from?.x, NaN);
  const fromY = finite(filters.from?.y, NaN);
  const hasFrom = Number.isFinite(fromX) && Number.isFinite(fromY);
  const reputation = filters.reputation || null;
  const hidden = typeof filters.hidden === 'function' ? filters.hidden : null;
  const positionOf = typeof filters.positionOf === 'function' ? filters.positionOf : null;
  const excludeId = filters.excludeId == null ? null : String(filters.excludeId);
  const drives = filters.drives || DEFAULT_DRIVES;
  const limit = Math.max(1, Math.floor(finite(filters.limit, TRADE_PARTNER_TUNE.limit)));
  let anyMirror = false;

  for (const entry of stations) {
    if (!entry || entry.id == null) continue;
    const id = String(entry.id);
    if (excludeId !== null && id === excludeId) continue;
    const econ = market.get(id);
    if (!econ) continue;
    anyMirror = true;
    if (entry.kind === 'hideout') { result.skipped.hideout++; continue; }
    if (hidden && hidden(entry)) { result.skipped.hidden++; continue; }
    const offerRaw = Number(selling ? econ.sell?.[key] : econ.buy?.[key]);
    if (!(offerRaw > 0)) {
      if (!selling && offerRaw < 0) result.skipped.notBuying++;
      else result.skipped.full++;
      continue;
    }
    const offer = Math.floor(offerRaw);
    if (offer <= 0) { result.skipped.full++; continue; }
    const quote = resourcePrice(entry, econ, key, { reputation });
    if (!quote) continue;
    result.considered++;
    // Zaokrąglenie jak oferta terminalu (`getTradeOffer`): komputer i terminal po przylocie mówią to samo.
    const price = Math.max(1, Math.round(finite(selling ? quote.ask : quote.bid)));
    const take = amount > 0 ? Math.min(amount, offer) : offer;
    let dist = 0;
    if (hasFrom) {
      let px = finite(entry.x);
      let py = finite(entry.y);
      if (positionOf) {
        const p = positionOf(id, _pos);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { px = p.x; py = p.y; }
      }
      const dx = px - fromX;
      const dy = py - fromY;
      dist = Math.sqrt(dx * dx + dy * dy);
    }
    travelEstimate(dist, drives, _travel);
    const seconds = _travel.seconds;
    const perUnit = selling ? basis - price : price - basis;
    const profit = perUnit * take;
    // Zysk na minutę lotu z dokowaniem; strata — bez dzielenia (bliska strata nie może wyjść „lepiej” od dalekiej).
    const score = profit > 0 ? profit / ((seconds + TRADE_PARTNER_TUNE.dockSeconds) / 60) : profit;
    const factionId = normalizeFaction(entry.factionId) || null;
    const standing = factionId ? resolveStanding(reputation?.[factionId]) : null;
    const canDock = factionId ? canDockWithFaction(factionId, reputation) : true;
    if (!canDock) result.skipped.hostile++;
    result.rows.push({
      stationId: id,
      name: displayName(entry.name || id),
      factionId,
      standing: standing ? { id: standing.id, label: standing.label, color: standing.color } : null,
      canDock,
      kind: entry.kind || null,
      price,
      offer,
      take,
      perUnit,
      profit,
      score,
      distance: dist,
      seconds,
      mode: _travel.mode
    });
  }
  if (!anyMirror) { result.pending = true; return result; }
  result.rows.sort((a, b) => compareRows(a, b, result.side));
  if (result.rows.length > limit) result.rows.length = limit;
  return result;
}

// ============================================================
// Podpisy do kart (wspólne: tablet, terminal, CIC)
// ============================================================

/** „1,4 mln km” nie ma sensu w j. gry — „840 tys. j.”, „1,2 mln j.”, „12 km” (1 j. = 1 m). */
export function formatTradeDistance(units) {
  const d = Math.max(0, finite(units));
  if (d >= 1e6) return `${(d / 1e6).toFixed(1).replace('.', ',')} mln j.`;
  if (d >= 1e4) return `${Math.round(d / 1e3)} tys. j.`;
  if (d >= 1e3) return `${(d / 1e3).toFixed(1).replace('.', ',')} tys. j.`;
  return `${Math.round(d)} j.`;
}

/** Czas lotu: „45 s”, „3 min”, „1 h 20 min”. */
export function formatTradeSeconds(seconds) {
  const s = Math.max(0, finite(seconds));
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Skrót trybu lotu do wiersza: „HC”, „warp”, „bojowy”. */
export function formatTradeMode(mode) {
  return mode === 'warp' ? 'warp' : mode === 'hypercruise' ? 'HC' : 'bojowy';
}

/** Kwota ze znakiem: „+12 400 CR”, „−800 CR”. */
export function formatTradeProfit(cr) {
  const v = Math.round(finite(cr));
  const abs = Math.abs(v).toLocaleString('pl-PL');
  return v > 0 ? `+${abs} CR` : v < 0 ? `−${abs} CR` : '0 CR';
}

/** Wiersz tekstu do panelu (CIC, testy): „Mars · 72 CR × 400 · 1,2 mln j. · ok. 2 min HC”. */
export function describeTradePartnerRow(row) {
  if (!row) return '';
  return `${row.name} · ${row.price} CR × ${Math.round(row.take).toLocaleString('pl-PL')} · `
    + `${formatTradeDistance(row.distance)} · ok. ${formatTradeSeconds(row.seconds)} ${formatTradeMode(row.mode)}`;
}
