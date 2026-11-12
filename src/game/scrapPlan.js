/**
 * KOMPUTER ZŁOMIARSKI — plan cięcia wraku (reguła `zlomowanie`).
 *
 * Wejście: żywe komórki kadłuba (pary ix, iy siatki belek — tożsamość węzła, ta sama we wraku i w każdym odłamie).
 * Wyjście: oś wraku i linie cięć W POPRZEK osi, które dzielą go na sekcje długości ~`sectionCells`. Plan jest listą
 * linii we współrzędnych SIATKI — nie zmieniają się, gdy cięcie przebuduje ciało wraku, więc ta sama lista służy
 * do końca pracy (złomiarz NPC bierze ją stąd; linie malowane przez gracza będą tą samą strukturą).
 *
 * Układ planu: punkt siatki P(s, t) = środek + oś · s + poprzeczna · t; `s` rośnie od bliskiego końca (ten, od którego
 * zaczyna się cięcie) do dalekiego. Czysty moduł: bez three, DOM, `window` i losowości.
 */

export const SCRAP_PLAN_DEFAULTS = Object.freeze({
  /** Długość sekcji [komórki]. */
  sectionCells: 8,
  /** Wrak krótszy niż tyle sekcji idzie w całości (bez cięcia). */
  wholeBelow: 1.45,
  /** Linia wystaje poza poszycie o tyle komórek z każdej strony (głowica zaczyna poza kadłubem). */
  marginCells: 1.25,
  /** Komórki bliżej linii niż tyle [komórki wzdłuż osi] wyznaczają jej rozpiętość w poprzek. */
  spanBand: 1.0,
  /** Oś bliżej osi siatki niż tyle [rad] — przyciągana do niej (kadłub ze sprite'a leży w osiach siatki). */
  snapAngle: 0.44,
  /** Linię wolno przesunąć od równego podziału o tyle sekcji (omijanie stref modułów). */
  nudge: 0.35
});

/**
 * Plan cięcia. `cells` — płaska tablica [ix, iy, ix, iy, …], `count` — liczba par.
 * `opts`: nastawy `SCRAP_PLAN_DEFAULTS` + `keepOut` — strefy, przez które linia nie idzie (moduły do wymontowania:
 * zbiornik, rdzeń, gniazda): [{ x, y, r }] w komórkach siatki.
 * Zwraca { count, cx, cy, ax, ay, tx, ty, s0, s1, t0, t1, tMid, lines: [{ s, t0, t1 }], sections } albo null (brak komórek).
 */
export function planScrapCuts(cells, count, opts = null) {
  const n = count | 0;
  if (!(n > 0)) return null;
  const O = opts ? { ...SCRAP_PLAN_DEFAULTS, ...opts } : SCRAP_PLAN_DEFAULTS;
  // 1. Środek i oś główna (kowariancja komórek).
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += cells[i * 2]; cy += cells[i * 2 + 1]; }
  cx /= n; cy /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = cells[i * 2] - cx, dy = cells[i * 2 + 1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Przyciąganie do osi siatki (0 albo π/2): cięcia idą wtedy wzdłuż rzędów węzłów — czysty rzaz.
  const snap = O.snapAngle;
  const a0 = Math.abs(ang);
  if (a0 < snap) ang = 0;
  else if (Math.abs(a0 - Math.PI / 2) < snap) ang = Math.PI / 2;
  let ax = Math.cos(ang), ay = Math.sin(ang);
  if (Math.abs(ax) < 1e-9) ax = 0;
  if (Math.abs(ay) < 1e-9) ay = 0;
  const tx = -ay, ty = ax;
  // 2. Zakres wzdłuż osi i w poprzek.
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = cells[i * 2] - cx, dy = cells[i * 2 + 1] - cy;
    const s = dx * ax + dy * ay, t = dx * tx + dy * ty;
    if (s < s0) s0 = s;
    if (s > s1) s1 = s;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  const plan = {
    count: n, cx, cy, ax, ay, tx, ty,
    s0: s0 - 0.5, s1: s1 + 0.5, t0: t0 - 0.5, t1: t1 + 0.5, tMid: (t0 + t1) * 0.5,
    lines: [], sections: 1
  };
  // 3. Linie: równy podział długości na sekcje, każda linia z rozpiętością przekroju w swoim miejscu.
  const len = plan.s1 - plan.s0;
  const sec = Math.max(2, Number(O.sectionCells) || 0);
  if (len < sec * O.wholeBelow) return plan;
  const parts = Math.max(2, Math.round(len / sec));
  const step = len / parts;
  const keep = Array.isArray(O.keepOut) ? O.keepOut : null;
  for (let k = 1; k < parts; k++) {
    let s = plan.s0 + k * step;
    if (keep) s = nudgeClear(s, keep, plan, step * O.nudge);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = cells[i * 2] - cx, dy = cells[i * 2 + 1] - cy;
      if (Math.abs(dx * ax + dy * ay - s) > O.spanBand) continue;
      const t = dx * tx + dy * ty;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (!(hi >= lo)) continue;   // przerwa w kadłubie — nie ma czego ciąć
    plan.lines.push({ s, t0: lo - 0.5 - O.marginCells, t1: hi + 0.5 + O.marginCells });
  }
  plan.sections = plan.lines.length + 1;
  return plan;
}

/** Przesunięcie linii poza strefy modułów (najbliższy wolny brzeg, najwyżej o `max`). */
function nudgeClear(s, keep, plan, max) {
  let out = s;
  for (const z of keep) {
    if (!z) continue;
    const zs = (z.x - plan.cx) * plan.ax + (z.y - plan.cy) * plan.ay;
    const r = (Number(z.r) || 0) + 1;
    if (Math.abs(out - zs) >= r) continue;
    const moved = out < zs ? zs - r : zs + r;
    if (Math.abs(moved - s) <= max) out = moved;
  }
  return out;
}

/**
 * Odwraca plan: bliski koniec staje się dalekim (złomiarz podszedł z drugiej strony). Oś i poprzeczna zmieniają
 * zwrot (układ zostaje prawoskrętny), linie — kolejność. W miejscu; zwraca `plan`.
 */
export function flipScrapPlan(plan) {
  if (!plan) return plan;
  plan.ax = -plan.ax; plan.ay = -plan.ay;
  plan.tx = -plan.tx; plan.ty = -plan.ty;
  const s0 = plan.s0, t0 = plan.t0;
  plan.s0 = -plan.s1; plan.s1 = -s0;
  plan.t0 = -plan.t1; plan.t1 = -t0;
  plan.tMid = -plan.tMid;
  for (const l of plan.lines) {
    const lo = l.t0;
    l.s = -l.s; l.t0 = -l.t1; l.t1 = -lo;
  }
  plan.lines.reverse();
  return plan;
}

/** Punkt planu (s, t) we współrzędnych siatki (komórki; środek komórki = liczba całkowita). */
export function scrapPlanPoint(plan, s, t, out) {
  out.x = plan.cx + plan.ax * s + plan.tx * t;
  out.y = plan.cy + plan.ay * s + plan.ty * t;
  return out;
}

/**
 * Zakres komórek wzdłuż osi planu: { count, s0, s1 } (brzegi komórek) — do rozdzielenia odłamów po cięciu na sekcje
 * (całe przed linią) i resztę wraku. `out` wielokrotnego użytku.
 */
export function scrapAxisExtent(plan, cells, count, out) {
  let lo = Infinity, hi = -Infinity;
  const n = count | 0;
  for (let i = 0; i < n; i++) {
    const s = (cells[i * 2] - plan.cx) * plan.ax + (cells[i * 2 + 1] - plan.cy) * plan.ay;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  out.count = n;
  out.s0 = n ? lo - 0.5 : 0;
  out.s1 = n ? hi + 0.5 : 0;
  return out;
}
