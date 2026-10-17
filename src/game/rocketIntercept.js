// Obrona punktowa kontra rakiety (2026-10-12): czy pocisk CIWS trafił rakietę w tym kroku fizyki.
//
// Pocisk (~2000 j/s) i rakieta (~2500 j/s) przy 60 Hz mijają się o ~75 j. na krok, a promień trafienia
// to kilka jednostek — sam punkt końcowy kroku trafiał przypadkiem. Test idzie po ODCINKU kroku w układzie
// rakiety (ruch względny): pocisk od (bx0, by0) do (b.x, b.y), rakieta od (rb.x − rb.vx·span) do rb.x.
// Rakieta: pocisk z `bullets` (rakieta / torpeda kanwy) albo zastępnik rakiety 3D (rocketSystem3D.syncThreats).
// Czyste, bez alokacji — woła je pętla pocisków (index.html, „CIWS INTERCEPT RAKIET”).

/**
 * @param {{ x: number, y: number, r?: number }} b pocisk CIWS po kroku
 * @param {number} bx0 @param {number} by0 pozycja pocisku na początku kroku (b.px / b.py)
 * @param {{ x: number, y: number, vx?: number, vy?: number, r?: number }} rb rakieta po kroku
 * @param {number} span czas lotu pocisku w tym kroku [s] (projectileStepSpan)
 * @param {number} reach wstępne odrzucenie [j.] — rakieta dalej w x albo y od końca pocisku to pudło
 */
export function ciwsShotHitsRocket(b, bx0, by0, rb, span, reach) {
  const ex = b.x - rb.x;
  const ey = b.y - rb.y;
  if (ex > reach || ex < -reach || ey > reach || ey < -reach) return false;
  const hitR = (b.r || 2) + (rb.r || 5);
  // Odcinek pocisku w układzie rakiety: początek − (rakieta − v·span), koniec − rakieta.
  const sx = bx0 - rb.x + (Number(rb.vx) || 0) * span;
  const sy = by0 - rb.y + (Number(rb.vy) || 0) * span;
  const segX = ex - sx;
  const segY = ey - sy;
  const segL2 = segX * segX + segY * segY;
  let u = segL2 > 1e-9 ? -(sx * segX + sy * segY) / segL2 : 1;
  u = u < 0 ? 0 : (u > 1 ? 1 : u);
  const cx = sx + segX * u;
  const cy = sy + segY * u;
  return cx * cx + cy * cy <= hitR * hitR;
}

/** Wstępne odrzucenie dla pocisku: droga względna w kroku (pocisk + najszybsza rakieta ~6000 j/s) + zapas. */
export function ciwsRocketReach(b, span) {
  return (Math.abs(b.vx) + Math.abs(b.vy) + 6000) * span + 24;
}

// SIATKA RAKIET (etap 0 audytu fizyki, docs/AUDYT-fizyka-worker-2026-10-17.md § 6 D): każdy pocisk CIWS przeglądał
// CAŁY bufor rakiet strony przeciwnej (w bitwie setki pocisków PD × setki rakiet na krok). Siatka kubełków budowana
// raz na krok (po ciwsStep) z pozycji rakiet w tej chwili; zapytanie oddaje indeksy bufora ROSNĄCO — pętla testuje je
// w tej samej kolejności co pełny przegląd, więc pierwsze trafienie (i wynik kroku) jest bit w bit to samo. Rakieta
// kanwy (pocisk z `bullets`) przesuwa się jeszcze w pętli pocisków tego kroku — pudło zapytania poszerza `slack`
// (największa prędkość rakiety × dt z zapasem). Bez alokacji po rozgrzaniu.
const GRID_BITS = 10;   // 1024 kubełki (hasz komórki)

export class RocketThreatGrid {
  constructor(cell = 256) {
    this.cell = cell;
    this.inv = 1 / cell;
    this.head = new Int32Array(1 << GRID_BITS).fill(-1);
    this.next = new Int32Array(256);
    this.cx = new Int32Array(256);
    this.cy = new Int32Array(256);
    this.n = 0;
    this.slack = 0;
    this.out = [];
    this._used = [];   // kubełki zajęte w tym kroku (czyszczenie bez fill całości)
    this._qh = new Int32Array(64);   // kubełki odwiedzone w jednym zapytaniu
  }

  static _hash(cx, cy) {
    return (Math.imul(cx, 0x9e3779b1) ^ Math.imul(cy, 0x85ebca6b)) >>> (32 - GRID_BITS);
  }

  /** Siatka z bufora rakiet `list` (zastępniki 3D i pociski kanwy); `dt` — krok fizyki (ruch rakiet kanwy w pętli). */
  build(list, dt) {
    const head = this.head, used = this._used;
    for (let i = 0; i < used.length; i++) head[used[i]] = -1;
    used.length = 0;
    const n = list.length;
    if (this.next.length < n) {
      let cap = this.next.length;
      while (cap < n) cap *= 2;
      this.next = new Int32Array(cap); this.cx = new Int32Array(cap); this.cy = new Int32Array(cap);
    }
    let vmax = 0;
    for (let i = 0; i < n; i++) {
      const rb = list[i];
      const cx = Math.floor(rb.x * this.inv), cy = Math.floor(rb.y * this.inv);
      this.cx[i] = cx; this.cy[i] = cy;
      const h = RocketThreatGrid._hash(cx, cy);
      if (head[h] < 0) used.push(h);
      this.next[i] = head[h];
      head[h] = i;
      const vx = Math.abs(Number(rb.vx) || 0), vy = Math.abs(Number(rb.vy) || 0);
      const v = vx > vy ? vx : vy;
      if (v > vmax) vmax = v;
    }
    this.n = n;
    this.slack = vmax * dt * 1.5 + 8;
  }

  /** Indeksy rakiet (rosnąco), których pozycja z chwili budowy leży w pudle (x, y) ± (reach + slack). */
  query(x, y, reach) {
    const out = this.out;
    out.length = 0;
    if (this.n === 0) return out;
    const r = reach + this.slack, inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
    const head = this.head, next = this.next, ccx = this.cx, ccy = this.cy;
    let hashes = 0;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const h = RocketThreatGrid._hash(gx, gy);
        // ten sam kubełek z dwóch komórek pudła (kolizja haszu) — raz
        let seen = false;
        for (let k = 0; k < hashes; k++) if (this._qh[k] === h) { seen = true; break; }
        if (seen) continue;
        if (hashes < 64) this._qh[hashes++] = h;
        for (let i = head[h]; i >= 0; i = next[i]) {
          if (ccx[i] >= x0 && ccx[i] <= x1 && ccy[i] >= y0 && ccy[i] <= y1) out.push(i);
        }
      }
    }
    if (out.length > 1) out.sort(ascending);
    return out;
  }
}
function ascending(a, b) { return a - b; }
