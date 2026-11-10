// src/3d/planetGen/planetGenDrainage.js
//
// SPŁYW WODY PO PLANECIE (czysty JS, bez three i GPU). Z mapy wysokości całej planety (siatka długość / szerokość,
// wiersz 0 = biegun S — jak cele wypieku) liczy DRZEWO RZEK: każda komórka lądu dostaje odbiorcę (sąsiada, do którego
// spływa), a każda ścieżka kończy się w morzu. Rzeki z linii zera szumu tego nie dają (pętle, przecięcia, brak ujść).
//
// METODA: zalewanie z kolejką priorytetową (priority-flood, Barnes 2014) w wersji z kubełkami poziomów — O(n).
// Zaczyna od komórek lądu przy morzu i wchodzi w głąb lądu po rosnącym poziomie „zalania”; komórka dostaje za
// odbiorcę tę, z której została odkryta (najniższy już zalany sąsiad). Zagłębienia bez odpływu wypełniają się do
// progu przelewu, więc woda zawsze znajduje drogę do morza. Potem przepływ: opad komórki (waga cos φ — pole komórki)
// sumowany w dół drzewa w kolejności odwrotnej do zalewania.
//
// ZAGŁĘBIENIA I PŁASKIE: zalewanie wchodzi do zagłębienia przez próg przelewu i samo rozchodziłoby się w nim równo
// we wszystkie strony (drzewo = promienie od progu: „grzebienie” i gwiazdy równoległych strumieni). Dlatego komórka
// poniżej poziomu zalania dostaje poziom „zalanie + koszt”: koszt mały w głębokich miejscach, duży na płyciznach,
// z drobnym rozrzutem z haszu. Zalewanie idzie wtedy najpierw dnem zagłębienia (rzeka biegnie jego osią, jak
// przez jezioro), a boki dołączają dopływami; w płaskim terenie rozrzut łamie równe fronty.
//
// BŁĄDZENIE: na równym stoku (nizina opadająca ku morzu) spływ po samej wysokości daje proste, równoległe rzeki
// w ośmiu kierunkach siatki. Do wysokości TRASOWANIA (nie do rzeźby) dochodzi więc drobny szum w trzech skalach
// (`wander` [km]): na nizinie rzeki błądzą i łączą się w drzewa, w górach (spadki setek metrów na komórkę) nic
// nie zmienia.
//
// BEZ PRZECIĘĆ: połączenie po przekątnej jest pomijane, gdy druga przekątna tego samego kwadratu 2 × 2 już niesie
// połączenie (komórka zostaje wtedy odkryta chwilę później z boku) — odcinki drzewa nie krzyżują się, także po
// przesunięciu węzłów o ≤ DRAIN_JITTER komórki (rysunek w grafie pola: planetGenSolid.tsl.js, `riverField`).
//
// WYNIK dla grafu pola — tekstura RGBA8 (odczyt textureLoad, bez filtrowania):
//   R — kierunek do odbiorcy: kod · DRAIN_CODE_STEP, kod = 1 + (dx + 1) + 3 · (dy + 1); 0 = morze / brak,
//   G — przepływ komórki: log2(1 + przepływ) · DRAIN_FLOW_K (przepływ w komórkach równikowych o opadzie 1),
//   B — przepływ odbiorcy (to samo kodowanie; szerokość rzeki rośnie wzdłuż odcinka bez drugiego odczytu),
//   A — głębokość wypełnionego zagłębienia [m / 2] (0 = komórka spływa bez wypełniania).

/** Największe przesunięcie węzła drzewa od środka komórki [komórki] — przy większym odcinki mogłyby się skrzyżować. */
export const DRAIN_JITTER = 0.22;
export const DRAIN_CODE_STEP = 25;
export const DRAIN_FLOW_K = 12;

// koszt wejścia do komórki poniżej poziomu zalania [poziomy]: 1 + FILL_COST / (1 + głębokość / FILL_DEPTH) + hasz 0…7
const DRAIN_RHO = 0.5;       // waga „ulubionego kierunku” w wyborze spływu (0 — zawsze najstromszy z ośmiu)
const FILL_COST = 24;
const FILL_DEPTH = 16;
const DX = [1, 0, -1, 0, 1, -1, -1, 1];     // najpierw boki (0–3), potem przekątne (4–7)
const DY = [0, 1, 0, -1, 1, 1, -1, -1];

export const drainFlowEncode = (flow) => Math.min(255, Math.round(Math.log2(1 + flow) * DRAIN_FLOW_K));
export const drainFlowDecode = (g) => Math.pow(2, g / DRAIN_FLOW_K) - 1;

/**
 * @param {Float32Array} height  wysokość [km] W × H (≤ 0 = morze), wiersz 0 = biegun S
 * @param {Float32Array|null} rain  opad 0…~1,5 na komórkę (null = 1)
 * @param {number} W
 * @param {number} H
 * @returns {{ width, height, data: Uint8Array, stats: { land, seeds, maxFlow, filled, ms } }}
 */
export function computeDrainage(height, rain, W, H, { levels = 65536, wander = 0.06, seed = 1, now = () => performance.now() } = {}) {
  const t0 = now();
  const N = W * H;
  // poziomy całkowite z wysokości lądu (+ szum błądzenia)
  let hMax = 0;
  let land = 0;
  for (let i = 0; i < N; i++) { const h = height[i]; if (h > 0) { land++; if (h > hMax) hMax = h; } }
  const data = new Uint8Array(N * 4);
  if (!land || !(hMax > 0)) return { width: W, height: H, data, stats: { land: 0, seeds: 0, maxFlow: 0, filled: 0, ms: now() - t0 } };
  hMax += wander;
  const kL = (levels - 1) / hMax;
  const lvl = new Uint16Array(N);
  const noise = wander > 0 ? wanderNoise(height, W, H, seed) : null;
  for (let i = 0; i < N; i++) {
    const h = height[i];
    lvl[i] = h > 0 ? Math.min(levels - 1, Math.max(0, Math.floor((noise ? h + noise[i] * wander : h) * kL))) : 0;
  }
  const isLand = (i) => height[i] > 0;
  const rcv = new Int32Array(N).fill(-1);
  const state = new Uint8Array(N);          // 0 — nieodkryta, 1 — w kolejce, 2 — zalana
  const next = new Int32Array(N);
  const head = new Int32Array(levels).fill(-1);
  const tail = new Int32Array(levels).fill(-1);
  const popLvl = new Uint16Array(N);
  const order = new Int32Array(land);
  let nOrder = 0;
  const push = (c, L) => {
    next[c] = -1;
    if (tail[L] < 0) head[L] = c; else next[tail[L]] = c;
    tail[L] = c;
    state[c] = 1;
  };
  // ziarna: ląd przy morzu (najpierw sąsiad z boku, potem po przekątnej)
  let seeds = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (!isLand(c)) continue;
      for (let k = 0; k < 8; k++) {
        const ny = y + DY[k];
        if (ny < 0 || ny >= H) continue;
        let nx = x + DX[k];
        if (nx < 0) nx += W; else if (nx >= W) nx -= W;
        const n = ny * W + nx;
        if (!isLand(n)) { rcv[c] = n; push(c, lvl[c]); seeds++; break; }
      }
    }
  }
  if (!seeds) {
    // planeta bez morza: ujściem jest najniższa komórka
    let lo = 0;
    for (let i = 1; i < N; i++) if (height[i] < height[lo]) lo = i;
    push(lo, lvl[lo]);
    seeds = 1;
  }
  let filled = 0;
  for (let L = 0; L < levels; L++) {
    let c;
    while ((c = head[L]) >= 0) {
      head[L] = next[c];
      if (head[L] < 0) tail[L] = -1;
      state[c] = 2;
      popLvl[c] = L;
      if (L > lvl[c]) filled++;
      order[nOrder++] = c;
      const y = (c / W) | 0;
      const x = c - y * W;
      for (let k = 0; k < 8; k++) {
        const ny = y + DY[k];
        if (ny < 0 || ny >= H) continue;
        let nx = x + DX[k];
        if (nx < 0) nx += W; else if (nx >= W) nx -= W;
        const n = ny * W + nx;
        if (state[n] !== 0 || !isLand(n)) continue;
        if (k >= 4) {
          // przekątna c → n: druga przekątna kwadratu to (x, ny) ↔ (nx, y)
          const a = ny * W + x;
          const b = y * W + nx;
          if (rcv[a] === b || rcv[b] === a) continue;
        }
        rcv[n] = c;
        let nl = lvl[n];
        if (nl <= L) {
          nl = L + 1 + ((FILL_COST / (1 + (L - nl) / FILL_DEPTH)) | 0) + ((Math.imul(n, 0x9E3779B1) >>> 13) & 7);
          if (nl >= levels) nl = levels - 1;
        }
        push(n, nl);
      }
    }
  }
  // KIERUNKI: zalewanie daje kolejność (każda komórka ma sąsiada zalanego wcześniej — drogę do morza), ale
  // „odbiorca = odkrywca” na równym stoku wybiera wciąż ten sam z ośmiu kierunków siatki: proste, równoległe rzeki.
  // Odbiorca jest więc wybierany na nowo spośród sąsiadów zalanych WCZEŚNIEJ (bez pętli): największy spadek poziomu
  // zalania × waga kierunku (± DRAIN_RHO). Waga to zgodność z polem „ulubionego kierunku”, które zmienia się
  // płynnie co kilka komórek (krata wartości): przy podobnych spadkach w dwóch kierunkach rzeka trzyma jeden przez
  // dłuższy odcinek, potem skręca — błądzi wokół prawdziwego kierunku stoku i zlewa się z innymi w drzewo (idea
  // Rho8, Fairfield i Leymarie 1991; wybór losowany osobno w każdej komórce dawał zygzak co komórkę, z daleka
  // widoczny jako ząbkowana linia). Przekątne z tą samą regułą bez przecięć; gdy przekątna odpada, zawsze zostaje
  // sąsiad z boku zalany wcześniej.
  const rank = new Int32Array(N).fill(-1);
  for (let i = 0; i < nOrder; i++) rank[order[i]] = i;
  const TH = 8;                                   // oczko kraty pola kierunku [komórki]
  const tw = Math.max(1, Math.round(W / TH));
  const th = Math.ceil(H / TH) + 1;
  const theta = new Float32Array(tw * th);
  for (let i = 0; i < theta.length; i++) {
    let hsh = Math.imul(i + 1 + seed, 0x9E3779B1);
    hsh = Math.imul(hsh ^ (hsh >>> 15), 0x85EBCA6B);
    theta[i] = (((hsh >>> 9) & 0xFFFF) / 65535) * 4 * Math.PI;
  }
  const rc2 = new Int32Array(N).fill(-1);
  for (let i = 0; i < nOrder; i++) {
    const c = order[i];
    const y = (c / W) | 0;
    const x = c - y * W;
    const lc = popLvl[c];
    let best = -1;
    let bestS = -1;
    // ulubiony kierunek w tej komórce (dwuliniowo z kraty, okresowo w długości)
    const gx = x / TH;
    const gy = y / TH;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const xa = x0 % tw;
    const xb = (x0 + 1) % tw;
    const th0 = (theta[y0 * tw + xa] * (1 - tx) + theta[y0 * tw + xb] * tx) * (1 - ty)
      + (theta[(y0 + 1) * tw + xa] * (1 - tx) + theta[(y0 + 1) * tw + xb] * tx) * ty;
    const fx = Math.cos(th0);
    const fy = Math.sin(th0);
    for (let k = 0; k < 8; k++) {
      const ny = y + DY[k];
      if (ny < 0 || ny >= H) continue;
      let nx = x + DX[k];
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      const n = ny * W + nx;
      let drop;
      if (isLand(n)) {
        if (rank[n] < 0 || rank[n] >= i) continue;
        drop = lc - popLvl[n];
      } else drop = lc + 8;
      if (k >= 4) {
        const a = ny * W + x;
        const b = y * W + nx;
        if (rc2[a] === b || rc2[b] === a) continue;
      }
      const diag = k >= 4 ? 0.7071 : 1;
      const s = (drop + 1) * diag * (1 + DRAIN_RHO * (DX[k] * fx + DY[k] * fy) * diag);
      if (s > bestS) { bestS = s; best = n; }
    }
    rc2[c] = best >= 0 ? best : rcv[c];
  }
  rcv.set(rc2);
  // przepływ: opad × pole komórki, sumowany w dół drzewa (od ostatnio zalanych)
  const flow = new Float32Array(N);
  const cosRow = new Float32Array(H);
  for (let y = 0; y < H; y++) cosRow[y] = Math.cos(((y + 0.5) / H - 0.5) * Math.PI);
  for (let i = 0; i < nOrder; i++) { const c = order[i]; flow[c] = (rain ? Math.max(0, rain[c]) : 1) * cosRow[(c / W) | 0]; }
  let maxFlow = 0;
  for (let i = nOrder - 1; i >= 0; i--) {
    const c = order[i];
    const r = rcv[c];
    if (flow[c] > maxFlow) maxFlow = flow[c];
    if (r >= 0 && isLand(r)) flow[r] += flow[c];
  }
  const mPerLvl = hMax * 1000 / (levels - 1);
  for (let i = 0; i < nOrder; i++) {
    const c = order[i];
    const r = rcv[c];
    const o = c * 4;
    if (r >= 0) {
      const y = (c / W) | 0;
      const x = c - y * W;
      const ry = (r / W) | 0;
      let dx = r - ry * W - x;
      if (dx > 1) dx -= W; else if (dx < -1) dx += W;
      data[o] = (1 + (dx + 1) + 3 * (ry - y + 1)) * DRAIN_CODE_STEP;
    }
    const g = drainFlowEncode(flow[c]);
    data[o + 1] = g;
    data[o + 2] = r >= 0 && isLand(r) ? drainFlowEncode(flow[r]) : g;
    data[o + 3] = Math.min(255, Math.round((popLvl[c] - lvl[c]) * mPerLvl / 2));
  }
  return { width: W, height: H, data, stats: { land, seeds, maxFlow, filled, ms: now() - t0 } };
}

// Szum błądzenia −1…1 na lądzie: biały z haszu komórki + trzy kraty wartości (4, 16 i 64 komórki, okresowe w długości).
function wanderNoise(height, W, H, seed) {
  const out = new Float32Array(W * H);
  const hash = (x, y, s) => {
    let h = Math.imul(x, 0x27D4EB2D) ^ Math.imul(y, 0x165667B1) ^ Math.imul(s + seed, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
    h ^= h >>> 13;
    return ((h >>> 8) & 0xFFFF) / 32767.5 - 1;
  };
  const grids = [4, 16, 64].map((s, k) => {
    const gw = Math.max(1, Math.round(W / s));
    const gh = Math.ceil(H / s) + 1;
    const g = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = hash(x, y, 101 + k * 37);
    return { s, gw, g };
  });
  const wts = [0.22, 0.22, 0.26, 0.3];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!(height[i] > 0)) continue;
      let v = hash(x, y, 7) * wts[0];
      for (let k = 0; k < grids.length; k++) {
        const { s, gw, g } = grids[k];
        const fx = x / s;
        const fy = y / s;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        let tx = fx - x0;
        let ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const xa = x0 % gw;
        const xb = (x0 + 1) % gw;
        const r0 = y0 * gw;
        const r1 = r0 + gw;
        v += ((g[r0 + xa] * (1 - tx) + g[r0 + xb] * tx) * (1 - ty) + (g[r1 + xa] * (1 - tx) + g[r1 + xb] * tx) * ty) * wts[k + 1];
      }
      out[i] = v;
    }
  }
  return out;
}

/** Odbiorca komórki (x, y) z danych tekstury: { x, y } albo null (morze / brak). */
export function drainReceiver(drain, x, y) {
  const code = Math.round(drain.data[(y * drain.width + x) * 4] / DRAIN_CODE_STEP);
  if (!code) return null;
  const k = code - 1;
  const rx = (x + (k % 3) - 1 + drain.width) % drain.width;
  return { x: rx, y: y + Math.floor(k / 3) - 1 };
}

/**
 * Ujścia rzek do morza (dla gry: miejsca pod miasta, porty): komórki lądu o przepływie ≥ `minFlow`, których odbiorcą
 * jest morze, od największej. Wynik: [{ x, y, u, v, flow }] (u, v — środek komórki na mapie planety).
 */
export function riverMouths(drain, minFlow = 60, cap = 64) {
  const { width: W, height: H, data } = drain;
  const out = [];
  const gMin = drainFlowEncode(minFlow);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (data[o + 1] < gMin || !data[o]) continue;
      const r = drainReceiver(drain, x, y);
      if (!r || data[(r.y * W + r.x) * 4] || data[(r.y * W + r.x) * 4 + 1]) continue;   // odbiorca to ląd
      out.push({ x, y, u: (x + 0.5) / W, v: (y + 0.5) / H, flow: drainFlowDecode(data[o + 1]) });
    }
  }
  out.sort((a, b) => b.flow - a.flow);
  return out.slice(0, cap);
}
