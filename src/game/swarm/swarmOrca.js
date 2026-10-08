/**
 * ORCA DLA PROSTOKĄTÓW — lustro CPU unikania w kernelu kSteer (src/3d/swarm/swarmSim.js; demo
 * dema/roj-webgpu.html, opis docs/webgpu/DEMO-ROJ.md). Czyste funkcje: bez three, bez stanu.
 *
 * ORCA (van den Berg, Guy, Lin, Manocha — „Reciprocal n-Body Collision Avoidance”, biblioteka
 * RVO2): każdy sąsiad daje PÓŁPŁASZCZYZNĘ dozwolonych prędkości poziomych, dron bierze prędkość
 * najbliższą zamierzonej spełniającą wszystkie (program liniowy 2D, linearProgram2 / 3 z RVO2).
 * Zamiast kół — prostokąty obrysów z kursem (kontener z góry 2 : 1, koło opisane podwajałoby
 * odstępy w portach): przeszkoda prędkości to stożek z początku styczny do sumy Minkowskiego M
 * obu prostokątów (wokół położenia sąsiada względem drona), ucięty horyzontem τ łamaną przez
 * wierzchołek M najbliższy początkowi (2 odcinki zamiast pełnego łańcucha bliskiej strony M —
 * łamana leży w M, więc odcięcie jest śmielsze przy samym τ: najwcześniejsze wejście w nakładanie
 * w 5000 losowych parach przy prędkościach z linii — 0,795 τ; linie liczą się od nowa co krok,
 * więc skuteczny horyzont ≥ 0,8 τ). Styczne: wierzchołki podparcia M (4 kroki — każdy krok obraca
 * promień ku styczności, łańcuch bliskiej strony ma najwyżej 4 wierzchołki).
 *
 * LINIA: { px, py } — punkt, { dx, dy } — kierunek; dozwolona strona: det(d, p − v) ≤ 0 (lewa
 * strona kierunku, jak w RVO2). Punkt = v + udział · u (u — najkrótsza zmiana prędkości
 * względnej na brzeg przeszkody), udział = część unikania tego drona (RVO2: ½).
 */

/** Najwięcej półpłaszczyzn na drona (najbliżsi sąsiedzi; dalszych zastępują bliżsi). */
export const SWARM_ORCA_LINES = 16;

const det = (ax, ay, bx, by) => ax * by - ay * bx;
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Linia ORCA pary prostokątów albo null (brak ograniczenia).
 * @param {{ x, y, vx, vy, yaw, hx, hy }} me — dron (półosie obrysu hx — wzdłuż kursu, hy — w poprzek)
 * @param {{ x, y, vx, vy, yaw, hx, hy }} nb — sąsiad
 * @param {{ margin: number, tau: number, share: number, esc: number }} o — zapas między obrysami,
 *   horyzont [s] (koniec nakładania pasów w pionie albo τ), udział, czas wyjścia z nakładania
 * @returns {{ px, py, dx, dy, kind: 'vo' | 'kolizja' } | null}
 */
export function swarmOrcaRectLine(me, nb, o, out = {}) {
  const mh = o.margin * 0.5;
  const ax = me.hx + mh;
  const ay = me.hy + mh;
  const bx = nb.hx + mh;
  const by = nb.hy + mh;
  const uix = Math.cos(me.yaw); const uiy = Math.sin(me.yaw);
  const vix = -uiy; const viy = uix;
  const ujx = Math.cos(nb.yaw); const ujy = Math.sin(nb.yaw);
  const vjx = -ujy; const vjy = ujx;
  const cx = nb.x - me.x;
  const cy = nb.y - me.y;
  const rvx = me.vx - nb.vx;
  const rvy = me.vy - nb.vy;
  // SAT obrysów z zapasem (4 osie).
  const dij = (px, py, qx, qy) => Math.abs(px * qx + py * qy);
  const Q0 = ax + bx * dij(ujx, ujy, uix, uiy) + by * dij(vjx, vjy, uix, uiy);
  const Q1 = ay + bx * dij(ujx, ujy, vix, viy) + by * dij(vjx, vjy, vix, viy);
  const Q2 = bx + ax * dij(uix, uiy, ujx, ujy) + ay * dij(vix, viy, ujx, ujy);
  const Q3 = by + ax * dij(uix, uiy, vjx, vjy) + ay * dij(vix, viy, vjx, vjy);
  const g0 = dij(cx, cy, uix, uiy) - Q0;
  const g1 = dij(cx, cy, vix, viy) - Q1;
  const g2 = dij(cx, cy, ujx, ujy) - Q2;
  const g3 = dij(cx, cy, vjx, vjy) - Q3;
  const gI = Math.max(Math.max(g0, g1), Math.max(g2, g3));
  const share = o.share;
  if (gI < 0) {
    // Nakładanie (z zapasem): wyjście wzdłuż osi najmniejszego nakładania w czasie esc.
    let ex = uix; let ey = uiy;
    if (g0 >= Math.max(g1, g2, g3)) { ex = uix; ey = uiy; } else if (g1 >= Math.max(g2, g3)) { ex = vix; ey = viy; } else if (g2 >= g3) { ex = ujx; ey = ujy; } else { ex = vjx; ey = vjy; }
    const s = cx * ex + cy * ey > 0 ? -1 : 1;
    const nx = ex * s; const ny = ey * s;
    const need = -gI / o.esc;
    const k = Math.max(need - (rvx * nx + rvy * ny), 0);
    out.px = me.vx + nx * k * share;
    out.py = me.vy + ny * k * share;
    out.dx = ny; out.dy = -nx;
    out.kind = 'kolizja';
    return out;
  }
  // Wierzchołek podparcia M w kierunku n.
  const supp = (nx, ny, res) => {
    const a = sgn(nx * uix + ny * uiy) * ax;
    const b = sgn(nx * vix + ny * viy) * ay;
    const c = sgn(nx * ujx + ny * ujy) * bx;
    const d = sgn(nx * vjx + ny * vjy) * by;
    res[0] = cx + uix * a + vix * b + ujx * c + vjx * d;
    res[1] = cy + uiy * a + viy * b + ujy * c + vjy * d;
    return res;
  };
  const qL = [cx, cy];
  const qR = [cx, cy];
  for (let k = 0; k < 4; k++) {
    supp(-qL[1], qL[0], qL);
    supp(qR[1], -qR[0], qR);
  }
  const qN = supp(-cx, -cy, [0, 0]);
  const invT = 1 / Math.min(Math.max(o.tau, 0.3), o.tauMax ?? o.tau);
  const aLx = qL[0] * invT; const aLy = qL[1] * invT;
  const aRx = qR[0] * invT; const aRy = qR[1] * invT;
  const aNx = qN[0] * invT; const aNy = qN[1] * invT;
  const lL = Math.hypot(qL[0], qL[1]) || 1;
  const lR = Math.hypot(qR[0], qR[1]) || 1;
  const dLx = qL[0] / lL; const dLy = qL[1] / lL;
  const dRx = qR[0] / lR; const dRy = qR[1] / lR;
  let bestD = 1e9; let bx0 = 0; let by0 = 0; let bnx = 0; let bny = 0;
  const tryPt = (px, py, nx, ny) => {
    const d = Math.hypot(rvx - px, rvy - py);
    if (d < bestD) { bestD = d; bx0 = px; by0 = py; bnx = nx; bny = ny; }
  };
  const sL = Math.max(rvx * dLx + rvy * dLy, Math.hypot(aLx, aLy));
  tryPt(dLx * sL, dLy * sL, -dLy, dLx);
  const sR = Math.max(rvx * dRx + rvy * dRy, Math.hypot(aRx, aRy));
  tryPt(dRx * sR, dRy * sR, dRy, -dRx);
  const seg = (ax0, ay0, bx1, by1) => {
    const ex = bx1 - ax0; const ey = by1 - ay0;
    const ee = ex * ex + ey * ey;
    if (!(ee > 1e-8)) return;
    const t = Math.min(Math.max(((rvx - ax0) * ex + (rvy - ay0) * ey) / ee, 0), 1);
    const l = Math.sqrt(ee);
    tryPt(ax0 + ex * t, ay0 + ey * t, -ey / l, ex / l);
  };
  seg(aRx, aRy, aNx, aNy);
  seg(aNx, aNy, aLx, aLy);
  const inside = det(dRx, dRy, rvx, rvy) >= 0 && det(rvx, rvy, dLx, dLy) >= 0
    && det(aNx - aRx, aNy - aRy, rvx - aRx, rvy - aRy) <= 0 && det(aLx - aNx, aLy - aNy, rvx - aNx, rvy - aNy) <= 0;
  let nx = bnx; let ny = bny;
  if (!inside && bestD >= 1e-4) { nx = (rvx - bx0) / bestD; ny = (rvy - by0) / bestD; }
  out.px = me.vx + (bx0 - rvx) * share;
  out.py = me.vy + (by0 - rvy) * share;
  out.dx = ny; out.dy = -nx;
  out.kind = 'vo';
  out.inside = inside;
  return out;
}

/** Czy prędkość (vx, vy) łamie linię (dodatnia wartość — o ile). */
export function swarmOrcaViolation(L, k, vx, vy) {
  const o = k * 4;
  return det(L[o + 2], L[o + 3], L[o] - vx, L[o + 1] - vy);
}

// RVO2 linearProgram1: najlepszy punkt na linii `no` przy liniach 0 … no − 1.
function lp1(L, no, radius, ox, oy, dirOpt, res) {
  const o = no * 4;
  const px = L[o]; const py = L[o + 1]; const dx = L[o + 2]; const dy = L[o + 3];
  const dotP = px * dx + py * dy;
  const disc = dotP * dotP + radius * radius - (px * px + py * py);
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  let tL = -dotP - sq;
  let tR = -dotP + sq;
  for (let k = 0; k < no; k++) {
    const q = k * 4;
    const den = det(dx, dy, L[q + 2], L[q + 3]);
    const num = det(L[q + 2], L[q + 3], px - L[q], py - L[q + 1]);
    if (Math.abs(den) <= 1e-5) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den >= 0) tR = Math.min(tR, t); else tL = Math.max(tL, t);
    if (tL > tR) return false;
  }
  if (dirOpt) {
    const t = ox * dx + oy * dy > 0 ? tR : tL;
    res[0] = px + dx * t; res[1] = py + dy * t;
  } else {
    const t = Math.min(Math.max(dx * (ox - px) + dy * (oy - py), tL), tR);
    res[0] = px + dx * t; res[1] = py + dy * t;
  }
  return true;
}

// RVO2 linearProgram2: zwraca numer linii, przy której zabrakło rozwiązania (n — sukces).
function lp2(L, n, radius, ox, oy, dirOpt, res) {
  if (dirOpt) { res[0] = ox * radius; res[1] = oy * radius; } else if (ox * ox + oy * oy > radius * radius) {
    const l = Math.hypot(ox, oy);
    res[0] = ox / l * radius; res[1] = oy / l * radius;
  } else { res[0] = ox; res[1] = oy; }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (det(L[o + 2], L[o + 3], L[o] - res[0], L[o + 1] - res[1]) > 0) {
      const kx = res[0]; const ky = res[1];
      if (!lp1(L, i, radius, ox, oy, dirOpt, res)) { res[0] = kx; res[1] = ky; return i; }
    }
  }
  return n;
}

// RVO2 linearProgram3: najmniejsze największe naruszenie linii miękkich; twarde [0, nHard)
// (sąsiad, któremu dron ustępuje w całości) bez zmian — jak linie przeszkód RVO2.
function lp3(L, n, nHard, begin, radius, res, P) {
  let distance = 0;
  for (let i = begin; i < n; i++) {
    const o = i * 4;
    if (det(L[o + 2], L[o + 3], L[o] - res[0], L[o + 1] - res[1]) > distance) {
      let np = 0;
      for (let h = 0; h < nHard; h++) { for (let c = 0; c < 4; c++) P[np * 4 + c] = L[h * 4 + c]; np++; }
      for (let j = nHard; j < i; j++) {
        const q = j * 4;
        const dd = det(L[o + 2], L[o + 3], L[q + 2], L[q + 3]);
        let ptx; let pty;
        if (Math.abs(dd) <= 1e-5) {
          if (L[o + 2] * L[q + 2] + L[o + 3] * L[q + 3] > 0) continue;
          ptx = 0.5 * (L[o] + L[q]); pty = 0.5 * (L[o + 1] + L[q + 1]);
        } else {
          const t = det(L[q + 2], L[q + 3], L[o] - L[q], L[o + 1] - L[q + 1]) / dd;
          ptx = L[o] + L[o + 2] * t; pty = L[o + 1] + L[o + 3] * t;
        }
        let ddx = L[q + 2] - L[o + 2]; let ddy = L[q + 3] - L[o + 3];
        const l = Math.hypot(ddx, ddy) || 1;
        ddx /= l; ddy /= l;
        const w = np * 4;
        P[w] = ptx; P[w + 1] = pty; P[w + 2] = ddx; P[w + 3] = ddy;
        np++;
      }
      const kx = res[0]; const ky = res[1];
      if (lp2(P, np, radius, -L[o + 3], L[o + 2], true, res) < np) { res[0] = kx; res[1] = ky; }
      distance = det(L[o + 2], L[o + 3], L[o] - res[0], L[o + 1] - res[1]);
    }
  }
}

/**
 * Prędkość ORCA: najbliższa (ox, oy) w kole radius po dobrej stronie n linii (L — 4 liczby na
 * linię: px, py, dx, dy; pierwsze nHard — twarde); tłok — najmniejsze największe naruszenie
 * linii miękkich (RVO2 linearProgram3).
 * @returns {{ x: number, y: number, dense: boolean }}
 */
export function swarmOrcaSolve(L, n, radius, ox, oy, out = {}, nHard = 0) {
  const res = [0, 0];
  const fail = lp2(L, n, radius, ox, oy, false, res);
  out.dense = fail < n;
  if (out.dense) {
    // Twarde wzajemnie sprzeczne — wszystkie miękkie (jak w kernelu).
    const probe = [0, 0];
    const nH = nHard > 0 && lp2(L, nHard, radius, ox, oy, false, probe) < nHard ? 0 : nHard;
    lp3(L, n, nH, fail, radius, res, new Float64Array(4 * Math.max(1, n)));
  }
  out.x = res[0];
  out.y = res[1];
  return out;
}

/** Przerwa SAT dwóch prostokątów z kursem (ujemna — nakładają się). */
export function swarmRectGap(a, b) {
  const ux = Math.cos(a.yaw); const uy = Math.sin(a.yaw);
  const wx = Math.cos(b.yaw); const wy = Math.sin(b.yaw);
  const axes = [[ux, uy], [-uy, ux], [wx, wy], [-wy, wx]];
  const dx = b.x - a.x; const dy = b.y - a.y;
  let g = -Infinity;
  for (const [nx, ny] of axes) {
    const ra = a.hx * Math.abs(ux * nx + uy * ny) + a.hy * Math.abs(-uy * nx + ux * ny);
    const rb = b.hx * Math.abs(wx * nx + wy * ny) + b.hy * Math.abs(-wy * nx + wx * ny);
    g = Math.max(g, Math.abs(dx * nx + dy * ny) - ra - rb);
  }
  return g;
}
