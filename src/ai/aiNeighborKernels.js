// Jądra sąsiedztwa AI (2026-10-07, docs/AUDYT-wydajnosc-bitwa-2026-10-07.md § 5.2) — czyste
// funkcje bez window i DOM.
//
// Unik zderzeń między okrętami (najbliższe zbliżenie, CPA): gdy tor sąsiada względem nas
// przetnie się bliżej niż suma promieni + zapas w ciągu horyzontu, schodzimy w bok już teraz —
// tym mocniej, im bliżej chwili zbliżenia i im głębiej. Lżejszy ustępuje bardziej. Separacja
// z index.html odpycha dopiero przy nakładaniu się stref (lekką fregatę słabo: siła × masa^−¼),
// a ogranicznik przeszkód widzi tylko POZYCJE — dwie fregaty lecące na skos przecinały sobie
// drogę i obijały się. Gracza pomijamy: unik przed nim liczy applySeparationForces.
//
// Dwie drogi o tej samej arytmetyce (wynik bit w bit ten sam dla tych samych danych):
//  - trafficAvoidanceSnapshot — na migawce siatki AI (src/ai/aiSpatialGrid.js), tablice typowane;
//  - trafficAvoidanceObjects — po obiektach z wyniku zapytania (atrapy siatki w testach).
// Moduł nie importuje siatki: jej import ustawia window.queryAIGrid, a testy podstawiają tam
// atrapy przed importem capitalAI.js.

// Flagi slotu migawki (S.flags).
export const AI_SNAP_FIGHTER = 1;
export const AI_SNAP_CAPITAL = 2;

export const AVOID_HORIZON = 2.5;
export const AVOID_PAD = 140;
export const AVOID_MAX_ACCEL = 900;
export const AVOID_RANGE_MAX = 6000;

/** Promień zapytania uniku: horyzont × (własna prędkość + zapas na prędkość sąsiada). */
export function trafficAvoidanceRange(myR, sp) {
  return Math.min(AVOID_RANGE_MAX, myR + 600 + (sp + 1500) * AVOID_HORIZON);
}

/** Unik po obiektach `buf[0..n)` (wynik queryAIGrid albo atrapy). */
export function trafficAvoidanceObjects(npc, ship, buf, n, out) {
  const vx = Number(npc.vx) || 0;
  const vy = Number(npc.vy) || 0;
  const myR = Number(npc.radius) || 60;
  const myMass = Math.max(1, Number(npc.mass) || 1);
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < n; i++) {
    const o = buf[i];
    if (!o || o === npc || o === ship || o.dead || o.fighter) continue;
    const rx = (Number(o.x) || 0) - npc.x;
    const ry = (Number(o.y) || 0) - npc.y;
    const rvx = (Number(o.vx) || 0) - vx;
    const rvy = (Number(o.vy) || 0) - vy;
    const vv = rvx * rvx + rvy * rvy;
    if (vv < 900) continue; // < 30 j/s względem siebie — to robota separacji
    const t = -(rx * rvx + ry * rvy) / vv;
    if (t <= 0 || t > AVOID_HORIZON) continue;
    const cx = rx + rvx * t;
    const cy = ry + rvy * t;
    const d = Math.sqrt(cx * cx + cy * cy);
    const safe = myR + (Number(o.radius) || 60) + AVOID_PAD;
    if (d >= safe) continue;
    // W bok od miejsca, w którym będzie sąsiad. Czołowo (d ≈ 0) — reguła prawej
    // ręki względem prędkości względnej: obaj schodzą w przeciwne strony.
    let ux;
    let uy;
    if (d > 1) {
      ux = -cx / d;
      uy = -cy / d;
    } else {
      const L = Math.sqrt(vv);
      ux = -rvy / L;
      uy = rvx / L;
    }
    const tt = Math.max(0.35, t);
    const oMass = Math.max(1, Number(o.mass) || myMass);
    const a = ((2 * (safe - d)) / (tt * tt)) * (2 * oMass / (oMass + myMass));
    ax += ux * a;
    ay += uy * a;
  }
  return clampAvoidance(ax, ay, out);
}

/**
 * Unik na migawce S (aiNeighborSnapshot po S.syncTick()): ci sami kandydaci w tej samej kolejności
 * co queryAIGrid(npc.x, npc.y, zasięg) i ta sama arytmetyka co trafficAvoidanceObjects. Pola
 * sąsiadów z tablic (kinematyka z bieżącego kroku fizyki), pola własne — z obiektu.
 */
export function trafficAvoidanceSnapshot(npc, ship, S, out) {
  const vx = Number(npc.vx) || 0;
  const vy = Number(npc.vy) || 0;
  const myR = Number(npc.radius) || 60;
  const myMass = Math.max(1, Number(npc.mass) || 1);
  const sp = Math.sqrt(vx * vx + vy * vy);
  const nx = npc.x;
  const ny = npc.y;
  const nRanges = S.selectRanges(nx, ny, trafficAvoidanceRange(myR, sp));
  const ranges = S.ranges;
  const refs = S.refs;
  const X = S.x;
  const Y = S.y;
  const VX = S.vx;
  const VY = S.vy;
  const R = S.r;
  const M = S.m;
  const F = S.flags;
  const D = S.dead;
  const dedup = S.hasAliases;
  let ax = 0;
  let ay = 0;
  for (let r = 0; r < nRanges; r++) {
    const end = ranges[2 * r + 1];
    for (let o = ranges[2 * r]; o < end; o++) {
      if (dedup && S.seen(o)) continue;
      const e = refs[o];
      if (e === npc || e === ship || D[o] !== 0 || (F[o] & AI_SNAP_FIGHTER) !== 0) continue;
      const rx = (X[o] || 0) - nx;
      const ry = (Y[o] || 0) - ny;
      const rvx = (VX[o] || 0) - vx;
      const rvy = (VY[o] || 0) - vy;
      const vv = rvx * rvx + rvy * rvy;
      if (vv < 900) continue;
      const t = -(rx * rvx + ry * rvy) / vv;
      if (t <= 0 || t > AVOID_HORIZON) continue;
      const cx = rx + rvx * t;
      const cy = ry + rvy * t;
      const d = Math.sqrt(cx * cx + cy * cy);
      const safe = myR + (R[o] || 60) + AVOID_PAD;
      if (d >= safe) continue;
      let ux;
      let uy;
      if (d > 1) {
        ux = -cx / d;
        uy = -cy / d;
      } else {
        const L = Math.sqrt(vv);
        ux = -rvy / L;
        uy = rvx / L;
      }
      const tt = Math.max(0.35, t);
      const oMass = Math.max(1, M[o] || myMass);
      const a = ((2 * (safe - d)) / (tt * tt)) * (2 * oMass / (oMass + myMass));
      ax += ux * a;
      ay += uy * a;
    }
  }
  return clampAvoidance(ax, ay, out);
}

function clampAvoidance(ax, ay, out) {
  const mag = Math.sqrt(ax * ax + ay * ay);
  if (mag > AVOID_MAX_ACCEL) {
    ax *= AVOID_MAX_ACCEL / mag;
    ay *= AVOID_MAX_ACCEL / mag;
  }
  out.ax = ax;
  out.ay = ay;
  return out;
}
