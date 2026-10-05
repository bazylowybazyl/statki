// src/3d/engineFrame.js
//
// DYSZE MAIN TEJ KLATKI, zebrane per okręt (2026-10-05). Pisze EngineVfxSystem (engineVfxSystem.js — te same
// pozycje, kierunki i moc, co struga MAIN), czytają efekty, które idą za silnikami — dziś poświata dysz na pyle
// kosmicznym (src/3d/dust/spaceDust.js: writeDustPlumes). Tylko okręty, których dysze się rysują (kadr
// z zapasem, bez ukrytych we mgle wojny); moc × widoczność maskowania — ukryty okręt nie świeci.
//
// Układ SCENY (x w prawo, y w GÓRĘ = −y świata gry), pozycje w double (świat 5–10 mln j.). Bez three i DOM.

export const ENGINE_FRAME_CAP = 256;
const NOZZLE_CAP = 32;

export const EngineFrame = {
  /** Okrętów w tej klatce. */
  count: 0,
  /** Numer klatki (rośnie przy begin) — czytający poznaje, czy lista jest świeża. */
  serial: 0,
  entity: new Array(ENGINE_FRAME_CAP).fill(null),
  // środek gromady dysz (ważony mocą), kierunek wydechu (jednostkowy), prędkość okrętu [j/s] — scena
  x: new Float64Array(ENGINE_FRAME_CAP),
  y: new Float64Array(ENGINE_FRAME_CAP),
  dirX: new Float32Array(ENGINE_FRAME_CAP),
  dirY: new Float32Array(ENGINE_FRAME_CAP),
  vx: new Float32Array(ENGINE_FRAME_CAP),
  vy: new Float32Array(ENGINE_FRAME_CAP),
  /** Średnia moc dysz (ciąg 0..1, dopalacz do 1,5) × widoczność maskowania. */
  power: new Float32Array(ENGINE_FRAME_CAP),
  /** Promień dyszy równoważnej (√Σ r²) [j.]. */
  radius: new Float32Array(ENGINE_FRAME_CAP),
  /** Pół szerokości gromady dysz w poprzek wydechu (z promieniem dyszy) [j.]. */
  spread: new Float32Array(ENGINE_FRAME_CAP),
  /** Liczba dysz MAIN. */
  nozzles: new Uint8Array(ENGINE_FRAME_CAP),
  /** Indeks palety MAIN (MAIN_EXHAUST_PALETTES). */
  palette: new Uint8Array(ENGINE_FRAME_CAP),
  player: new Uint8Array(ENGINE_FRAME_CAP),

  // bieżący okręt (beginShip … endShip)
  _e: null,
  _n: 0,
  _vx: 0,
  _vy: 0,
  _pl: 0,
  _nx: new Float64Array(NOZZLE_CAP),
  _ny: new Float64Array(NOZZLE_CAP),
  _ndx: new Float32Array(NOZZLE_CAP),
  _ndy: new Float32Array(NOZZLE_CAP),
  _nr: new Float32Array(NOZZLE_CAP),
  _np: new Float32Array(NOZZLE_CAP),
  _pal: 0,

  /** Początek klatki (EngineVfxSystem.update). */
  begin() {
    // bez trzymania martwych okrętów do następnej klatki
    for (let i = 0; i < this.count; i++) this.entity[i] = null;
    this.count = 0;
    this.serial++;
    this._e = null;
    this._n = 0;
  },

  /** Okręt: prędkość w SCENIE [j/s] (y w górę), czy gracz. */
  beginShip(entity, vx, vy, isPlayer = false) {
    this._e = entity || null;
    this._n = 0;
    this._vx = Number.isFinite(vx) ? vx : 0;
    this._vy = Number.isFinite(vy) ? vy : 0;
    this._pl = isPlayer ? 1 : 0;
    this._pal = 0;
  },

  /** Dysza MAIN: wylot i kierunek wydechu (scena), promień [j.], moc (z maskowaniem), paleta. */
  nozzle(x, y, dirX, dirY, radius, power, palette = 0) {
    if (!this._e || this._n >= NOZZLE_CAP) return;
    if (!(Number.isFinite(x) && Number.isFinite(y))) return;
    const i = this._n++;
    this._nx[i] = x;
    this._ny[i] = y;
    this._ndx[i] = Number.isFinite(dirX) ? dirX : 0;
    this._ndy[i] = Number.isFinite(dirY) ? dirY : -1;
    this._nr[i] = radius > 0 ? radius : 0;
    this._np[i] = power > 0 ? power : 0;
    if (i === 0) this._pal = palette | 0;
  },

  /** Koniec okrętu: środek gromady, kierunek, rozrzut — jeden wpis listy. */
  endShip() {
    const n = this._n;
    const e = this._e;
    this._e = null;
    this._n = 0;
    if (!e || n === 0 || this.count >= ENGINE_FRAME_CAP) return -1;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sdx = 0;
    let sdy = 0;
    let sp = 0;
    let sr2 = 0;
    for (let i = 0; i < n; i++) {
      // waga z mocą, z małym zapasem — zgaszona dysza wciąż należy do gromady
      const w = this._np[i] + 0.05;
      sw += w;
      sx += this._nx[i] * w;
      sy += this._ny[i] * w;
      sdx += this._ndx[i] * w;
      sdy += this._ndy[i] * w;
      sp += this._np[i];
      sr2 += this._nr[i] * this._nr[i];
    }
    const cx = sx / sw;
    const cy = sy / sw;
    let dl = Math.sqrt(sdx * sdx + sdy * sdy);
    let dx = 0;
    let dy = -1;
    if (dl > 1e-6) { dx = sdx / dl; dy = sdy / dl; }
    let spread = 0;
    for (let i = 0; i < n; i++) {
      // odległość w poprzek wydechu od osi gromady + promień dyszy
      const px = this._nx[i] - cx;
      const py = this._ny[i] - cy;
      const across = Math.abs(px * dy - py * dx) + this._nr[i];
      if (across > spread) spread = across;
    }
    const k = this.count++;
    this.entity[k] = e;
    this.x[k] = cx;
    this.y[k] = cy;
    this.dirX[k] = dx;
    this.dirY[k] = dy;
    this.vx[k] = this._vx;
    this.vy[k] = this._vy;
    this.power[k] = sp / n;
    this.radius[k] = Math.sqrt(sr2);
    this.spread[k] = spread;
    this.nozzles[k] = Math.min(255, n);
    this.palette[k] = this._pal;
    this.player[k] = this._pl;
    return k;
  },

  /** Indeks okrętu w tej klatce albo −1. */
  indexOf(entity) {
    for (let i = 0; i < this.count; i++) if (this.entity[i] === entity) return i;
    return -1;
  }
};

// diagnostyka z konsoli / narzędzi (scripts/webgpu/pyl-gra.mjs)
if (typeof window !== 'undefined') window.EngineFrame = EngineFrame;
