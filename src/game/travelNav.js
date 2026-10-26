// src/game/travelNav.js
//
// TRAVEL TO — jeden rozkaz podróży do punktu (mapa CIC, menu PPM, skaner; decyzja usera
// 2026-10-03: zamiast „cruise” i „warp to” — jedno „travel to”, a napęd dobiera podróż).
// Dziś napęd dalekiego zasięgu to warp „Nurt”: kurs ustawia się PRZED skokiem (rulon — oś stoi od
// ładowania), więc trasa to ODCINKI po prostej: ustaw dziób → ładowanie → skok → wyjście (rampa
// przylotu, warpDrive.js: WARP_EXIT) w końcu odcinka → następny odcinek. Studnie grawitacji
// (planety) warp omija objazdem; cel w studni — warp do jej brzegu, resztę napędem.
// AGENT: hipercruise (biegi I–II, docs/BRIEF-warp.md) ma przejąć odcinki „napędem” (dziś
// approach autopilota) i krótkie skoki — ten sam cel i ta sama trasa, inny napęd w `kind`.
//
// Czysta logika (bez DOM, three, gry): planowanie odcinka; automat rozkazu żyje w index.html
// (blok „TRAVEL TO”), bo steruje automatem warpa i autopilotem gracza.

/** Strojenie podróży. */
export const TRAVEL_TUNE = Object.freeze({
  arriveRadius: 3200,     // [j.] cel osiągnięty
  alignTolerance: 1.5 * Math.PI / 180,   // dziób na kursie — można ładować skok
  alignSpin: 0.03,        // [rad/s] … i prawie nie obraca się
  wellMargin: 1100,       // [j.] wyjście przed brzegiem studni grawitacji (warp nie wchodzi w studnię)
  minWarp: 40000,         // [j.] odcinek krótszy — napędem (PRZELOT); dłuższy warpem (wyjście liczy się z bieżącej prędkości)
  minFuel: 5              // [s paliwa warpa] ładowanie dopiero z takim zapasem
});

/**
 * Pierwszy punkt wejścia odcinka a → b w okrąg (studnię) albo null (odcinek go nie przecina,
 * albo `a` leży w środku). circle = { x, y, r }.
 */
export function segmentCircleEntry(a, b, circle) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - circle.x;
  const fy = a.y - circle.y;
  const A = dx * dx + dy * dy;
  if (!(A > 1e-9)) return null;
  const C = fx * fx + fy * fy - circle.r * circle.r;
  if (C <= 0) return null;   // start w środku
  const B = 2 * (fx * dx + fy * dy);
  const D = B * B - 4 * A * C;
  if (D < 0) return null;
  const t = (-B - Math.sqrt(D)) / (2 * A);
  if (t < 0 || t > 1) return null;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

/** Studnia zawierająca punkt (pierwsza z listy) albo null. */
export function wellAt(p, wells) {
  if (!Array.isArray(wells)) return null;
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i];
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    if (dx * dx + dy * dy < w.r * w.r) return w;
  }
  return null;
}

/**
 * Następny odcinek podróży z `pos` do `target`.
 *   waypoints — trasa planisty objazdów (ostatni = cel; omija studnie poza startem i celem),
 *   wells     — studnie grawitacji { x, y, r } (r = promień studni bez zapasu),
 *   minWarp   — najkrótszy odcinek warpem [j.], warpOk — warp dostępny (kadłub, paliwo, opcje).
 * Wynik: null (cel osiągnięty) albo { x, y, kind: 'warp' | 'drive', final } — `final`: koniec
 * odcinka to cel (po nim podróż się kończy).
 */
export function planTravelLeg(pos, target, waypoints, wells, { minWarp = 60000, warpOk = true, tune = TRAVEL_TUNE } = {}) {
  const tdx = target.x - pos.x;
  const tdy = target.y - pos.y;
  if (tdx * tdx + tdy * tdy <= tune.arriveRadius * tune.arriveRadius) return null;
  // Dolot lokalny nie zamienia się w skok do dalekiego punktu objazdu. Cel przy
  // brzegu studni (K-7) mógł dostawać taki punkt, mimo że był tuż przed okrętem.
  if (tdx * tdx + tdy * tdy < minWarp * minWarp) {
    return { x: target.x, y: target.y, kind: 'drive', final: true };
  }
  const startWell = wellAt(pos, wells);
  const targetWell = wellAt(target, wells);
  // Powrót do portu: po wejściu do studni celu kończy się część warpowa podróży.
  // Wylot ze studni do celu poza nią nadal może używać warpa.
  if (startWell && targetWell === startWell) {
    return { x: target.x, y: target.y, kind: 'drive', final: true };
  }
  // Pierwszy punkt trasy dalej niż promień przylotu — planista objazdów liczy punkty z geometrii
  // studni, więc po dolocie do punktu objazdu zwraca go znowu (pętla bez ruchu).
  let end = target;
  if (Array.isArray(waypoints)) {
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      const dx = w.x - pos.x;
      const dy = w.y - pos.y;
      if (dx * dx + dy * dy > tune.arriveRadius * tune.arriveRadius) { end = w; break; }
    }
  }
  const final = end === target || (Math.abs(end.x - target.x) < 1 && Math.abs(end.y - target.y) < 1);
  // Warp nie wchodzi w studnię grawitacji (hamowanie grawitacyjne). Studnie po drodze omija planista
  // trasy (waypoints); cel w CUDZEJ studni — warp do jej brzegu (z zapasem), reszta napędem.
  if (final && targetWell && targetWell !== startWell) {
    const hit = warpOk ? segmentCircleEntry(pos, end, { x: targetWell.x, y: targetWell.y, r: targetWell.r + tune.wellMargin }) : null;
    if (hit) {
      const hx = hit.x - pos.x;
      const hy = hit.y - pos.y;
      if (hx * hx + hy * hy >= minWarp * minWarp) return { x: hit.x, y: hit.y, kind: 'warp', final: false };
    }
    // Przy brzegu (albo blisko) — napędem prosto do celu.
    return { x: target.x, y: target.y, kind: 'drive', final: true };
  }
  const ex = end.x - pos.x;
  const ey = end.y - pos.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  const kind = warpOk && len >= minWarp ? 'warp' : 'drive';
  return { x: end.x, y: end.y, kind, final };
}

/**
 * HIPERCRUISE ODCINKA 'drive' (DECYZJE-2 T4, błąd z etapu W): automat wychodzi `stopMargin` przed punktem (droga hamowania
 * lotu zwykłego z prędkości wyjścia + pół promienia przylotu — index.html: playerHypercruiseStopMargin), więc odcinek
 * krótszy niż `minLeg + stopMargin` kończył hipercruise po 2 klatkach lotu, a TRAVEL TO startował go znowu co ~1 s
 * (wstrząs kopu na cykl). Start tylko, gdy odcinek jest co najmniej tak długi; krótszy — sam autopilot bojowy.
 */
export function travelHypercruiseLegOk(dist, minLeg, stopMargin) {
  const d = Number(dist);
  return Number.isFinite(d) && d >= Math.max(0, Number(minLeg) || 0) + Math.max(0, Number(stopMargin) || 0);
}

/**
 * PUNKT PODRÓŻY do ciała ze studnią (CIC i stożek warpa — DECYZJE-2 T1): brzeg studni + zapas po stronie `from`
 * (statku). Bez promienia studni — środek ciała. Wynik: { x, y }.
 */
export function travelApproachPoint(body, from, wellR, margin = TRAVEL_TUNE.wellMargin * 2) {
  const bx = Number(body?.x) || 0;
  const by = Number(body?.y) || 0;
  const R = Math.max(0, Number(wellR) || 0);
  if (!(R > 0)) return { x: bx, y: by };
  let dx = (Number(from?.x) || 0) - bx;
  let dy = (Number(from?.y) || 0) - by;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 1e-6) { dx /= d; dy /= d; } else { dx = 1; dy = 0; }
  const k = R + Math.max(0, Number(margin) || 0);
  return { x: bx + dx * k, y: by + dy * k };
}

/**
 * PRZYCIĄGANIE TRAVEL TO do celu (mapa CIC — DECYZJE-2 T1): najbliższy cel z `candidates` ({ x, y, snapR?, label, … }),
 * którego środek albo tarcza (snapR — promień ciała w płaszczyźnie gry, j. świata; nie studnia — stacja przy planecie
 * ma wygrać z planetą) leży w `radius` [j.] od punktu kliknięcia; brak — null (punkt w próżni zostaje „punktem”).
 * Odległość mierzona od brzegu tarczy (klik na tarczy = 0).
 */
export function snapTravelTarget(x, y, candidates, radius) {
  if (!Array.isArray(candidates) || !(radius >= 0)) return null;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - Math.max(0, Number(c.snapR) || 0));
    if (d <= radius && d < bestD) { bestD = d; best = c; }
  }
  return best;
}
