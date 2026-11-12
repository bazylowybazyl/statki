// src/3d/czujniki/czujniki3D.js — obraz czujników w grze: CZUJKA na PPM (struna w stronę myszki + błona 360°),
// GRANICE WYKRYCIA (tafla dwóch poziomów: szara — ich kontakt, czerwona — ich wzrok) i KONTAKTY (obłok szarych X-ów).
//
// Wejście: Float64Array `CZUJNIKI_IN` (czujnikiLayout.js) — widok policzony na stronie gry (`src/ui/czujkaView.js`)
// w ŚWIECIE. Tryb off: `Czujniki3D.submit(tablica)` w render() strony; worker: blok migawki `czujniki`
// (`src/render/blocks/czujnikiBlock.js`). Krok `Core3D.fx` „czujniki” rzutuje wejście kamerą renderu (Core3D.activeCam1,
// z obrotem kadru) na piksele bufora i pisze bloki shaderów (`namiarTSL.js`, `granicaTSL.js`, `kontaktyTSL.js`).
// Kwady pełnoekranowe leżą na warstwie NAKŁADKI (FX_OVERLAY_LAYER → Core3D.overlayTarget): „uber” kładzie ją PO mgle
// wojny (kontakt leży pod mgłą — wróg, którego nie widać, ale czujniki go mają), bez bloomu. Refrakcja impulsu błony
// i tafli — warstwa DIST. Rozgrywki nie zmienia (zasada żelazna 1).
import * as THREE from 'three/webgpu';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER, FX_OVERLAY_LAYER } from '../fx/fxFrame.js';
import { cameraRoll, rollToScreen } from '../viewRoll.js';
import {
  createNamiarBlock, createNamiarMeshes, NAMIAR_HDR, NAMIAR_MARK_BASE, NAMIAR_MARK_VEC, NAMIAR_MARKS
} from './namiarTSL.js';
import { createGranicaMeshes } from './granicaTSL.js';
import { createContactBlock, createContactMesh, KONTAKT_HDR, KONTAKT_MAX, KONTAKT_NOISE_TILE, wrap01 } from './kontaktyTSL.js';
import { CZUJNIKI_IN, CZUJNIKI_MAX, GRANICA_REC, KONTAKT_REC, ringInView } from './czujnikiLayout.js';

const I = CZUJNIKI_IN;
const G = GRANICA_REC;
const K = KONTAKT_REC;

/** Strojenie obrazu (px CSS — mnożone przez pxScale bufora). Wartości z dema (`dema/kontakty-czujnikow/namiarDemo.js`). */
export const CZUJNIKI_TUNE = {
  enabled: true,
  // A/B części obrazu (konsola: Czujka.render.tune / w workerze RenderWorkerHost.dev): granice, kontakty, refrakcja
  granice: true,
  kontakty: true,
  dist: true,
  strHalf: 0.52,          // pół kąta struny [rad]
  winNear: 3000,          // okno granicy wokół okrętu [j.]: pełne do 3 km, zero od 12 km
  winFar: 12000,
  waveLen: 34, waveV: 26, // przybój (nieużywany w tafli; nagłówek bloku)
  blonaBase: 8, blonaSig: 26, blonaHull: 0.72,  // promień błony: ½ długości × 0,72 × zoom + 8 + 26 × ślad
  strunaGap: 50,          // struna poza błoną z wybrzuszeniami (ślad 1,6) o tyle px
  minShipPx: 10           // najmniejszy promień mojego okrętu na ekranie [px CSS] (błona przy oddaleniu)
};

const _rs = { x: 0, y: 0 };

const _sp = { x: 0, y: 0 };
const _c = { x: 0, y: 0 };

class CzujnikiSystem {
  constructor() {
    this.input = new Float64Array(I.size);
    this.input[I.serial] = -1;
    this.tune = CZUJNIKI_TUNE;
    this.ready = false;
    this.parts = null;
    this.step = null;
    this.stats = { active: false, struna: false, granice: 0, graniceDist: false, kontakty: 0, cpuMs: 0 };
    this._granDist = false;
    // widok tej klatki (bez alokacji w kroku)
    this._view = { cam: null, pxs: 1, zoom: 1, zoomBuf: 1, bw: 1, bh: 1, roll: 0, time: 0 };
  }

  _ensure() {
    if (this.ready) return true;
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.fx) return false;
    const strBlock = createNamiarBlock();
    const blnBlock = createNamiarBlock();
    const grnBlock = createNamiarBlock();
    const konBlock = createContactBlock();
    const struna = createNamiarMeshes('struna', strBlock, FX_DISTORT_LAYER);
    const blona = createNamiarMeshes('blona', blnBlock, FX_DISTORT_LAYER);
    const tafla = createGranicaMeshes('tafla', grnBlock, FX_DISTORT_LAYER, null);
    const kontakt = createContactMesh('iksy', konBlock);
    // kontakt: premultiplied „over” z alfą pokrycia (cel nakładki startuje od 0; uber: scena × (1 − a) + rgb)
    const km = kontakt.material;
    km.blendSrcAlpha = THREE.OneFactor;
    km.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    const overlay = [kontakt, struna.mesh, blona.mesh, tafla.mesh];
    for (const m of overlay) {
      m.layers.set(FX_OVERLAY_LAYER);
      m.visible = false;
      m.name = `Czujniki:${m.name}`;
    }
    const dists = [blona.dist, tafla.dist].filter(Boolean);
    for (const m of dists) m.visible = false;
    this.parts = { strBlock, blnBlock, grnBlock, konBlock, struna, blona, tafla, kontakt, overlay, dists };
    for (const m of overlay) Core3D.scene.add(m);
    for (const m of dists) Core3D.scene.add(m);
    this.step = Core3D.addFxStep({ name: 'czujniki', update: (ctx) => this._update(ctx) });
    this.ready = true;
    return true;
  }

  /** Wejście klatki od gry (układ CZUJNIKI_IN); null — nic nie rysuj. */
  submit(f64) {
    if (!f64) { this.input[I.active] = 0; return; }
    if (f64 !== this.input) this.input.set(f64.subarray ? f64.subarray(0, I.size) : f64);
    this._ensure();
  }

  /** Kwady nakładki (rozgrzewka na warstwie NAKŁADKI) i warstwy DIST. */
  warmupOverlay() { return this._ensure() ? this.parts.overlay.slice() : []; }
  warmupDist() { return this._ensure() ? this.parts.dists.slice() : []; }

  _hide() {
    const p = this.parts;
    for (const m of p.overlay) m.visible = false;
    for (const m of p.dists) m.visible = false;
  }

  _update(ctx) {
    const p = this.parts;
    const st = this.stats;
    const IN = this.input;
    const cam = Core3D.activeCam1;
    const free = typeof Core3D.isFreePerspectiveCamera === 'function' && Core3D.isFreePerspectiveCamera();
    if (!this.tune.enabled || !cam || free || IN[I.active] < 0.5) {
      this._hide();
      st.active = false;
      return;
    }
    const t0 = performance.now();
    const pxs = Core3D.pxScale || 1;
    const zoomBuf = Core3D.viewZoom(cam);
    const zoom = zoomBuf / pxs;
    const bw = Core3D.composerTarget?.width || 1;
    const bh = Core3D.composerTarget?.height || 1;
    const roll = cameraRoll(cam);
    const view = this._view;
    view.cam = cam; view.pxs = pxs; view.zoom = zoom; view.zoomBuf = zoomBuf; view.bw = bw; view.bh = bh; view.roll = roll;
    view.time = (Number(ctx?.time) || IN[I.time]) % 600;
    st.active = true;
    let any = false;
    // czujka (PPM)
    const T = this.tune;
    const strOn = IN[I.strunaOn] > 0.5 && IN[I.vis] > 0.001;
    p.struna.mesh.visible = strOn;
    p.blona.mesh.visible = strOn;
    if (p.blona.dist) p.blona.dist.visible = strOn && T.dist;
    st.struna = strOn;
    if (strOn) {
      this._packStruna(p.strBlock.array, view);
      this._packBlona(p.blnBlock.array, view);
      any = true;
    }
    // granice
    // tylko koła, których linia przecina kadr (shader liczy każdy znacznik dla każdego piksela); refrakcja (DIST) tylko,
    // gdy linia biegnie przy okręcie albo trwa przejście — inaczej cały pass warstwy DIST szedł co klatkę na darmo
    const nIn = T.granice && IN[I.granicaOn] > 0.5 ? Math.min(CZUJNIKI_MAX.granica, IN[I.nGrn] | 0) : 0;
    const nG = nIn > 0 ? this._packGranica(p.grnBlock.array, view, nIn) : 0;
    const granDist = nG > 0 && this._granDist;
    p.tafla.mesh.visible = nG > 0;
    if (p.tafla.dist) p.tafla.dist.visible = granDist && T.dist;
    st.granice = nG;
    st.graniceDist = granDist;
    if (nG > 0) any = true;
    // kontakty
    const nK = T.kontakty ? Math.min(CZUJNIKI_MAX.kontakty, KONTAKT_MAX, IN[I.nKon] | 0) : 0;
    const nKon = nK > 0 ? this._packKontakty(p.konBlock.array, view, nK) : 0;
    p.kontakt.visible = nKon > 0;
    st.kontakty = nKon;
    if (nKon > 0) any = true;
    if (any) Core3D.setOverlayLayerActive(true);
    if (T.dist && (strOn || granDist)) Core3D.setDistortLayerActive(true);
    st.cpuMs = performance.now() - t0;
  }

  // świat → px bufora (y od góry) w kadrze tego renderu, z obrotem kadru
  _toBuf(x, y, v, out) {
    rollToScreen(x - (Number(v.cam.x) || 0), y - (Number(v.cam.y) || 0), v.roll, _rs);
    out.x = v.bw * 0.5 + _rs.x * v.zoomBuf;
    out.y = v.bh * 0.5 + _rs.y * v.zoomBuf;
    return out;
  }

  _shipR(v) {
    const T = this.tune;
    return Math.max(T.minShipPx, (this.input[I.shipLen] || 3000) * 0.5 * v.zoom);
  }

  _blonaR(v, sig) {
    const T = this.tune;
    return this._shipR(v) * T.blonaHull + T.blonaBase + T.blonaSig * sig;
  }

  _packStruna(A, v) {
    const IN = this.input;
    const T = this.tune;
    const n = Math.min(NAMIAR_MARKS, CZUJNIKI_MAX.struna, IN[I.nStr] | 0);
    for (let i = 0; i < n; i++) {
      const s = I.strBase + I.strStride * i;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * i;
      A[o].set(IN[s], IN[s + 1], IN[s + 2], IN[s + 3]);
      A[o + 1].set(IN[s + 4], IN[s + 5], IN[s + 6], IN[s + 7]);
      A[o + 2].set(0, 0, 0, 0);
      A[o + 3].set(0, 0, 0, 0);
      A[o + 4].set(0, 0, 0, 0);
    }
    const sp = this._toBuf(IN[I.px], IN[I.py], v, _sp);
    const a = NAMIAR_HDR;
    const rs = this._blonaR(v, 1.6) + T.strunaGap;
    A[a].set(sp.x, sp.y, rs * v.pxs, IN[I.phi] - v.roll);
    A[a + 1].set(T.strHalf, IN[I.amp] * v.pxs, IN[I.tau], IN[I.vis]);
    A[a + 2].set(IN[I.det], 0, n, IN[I.harm]);
    A[a + 3].set(0.37, 0, 0, 0);
    A[0].set(n, v.time, v.pxs, 1);
    A[1].set(v.bw, v.bh, 0, 0);
  }

  _packBlona(A, v) {
    const IN = this.input;
    const n = Math.min(NAMIAR_MARKS, CZUJNIKI_MAX.blona, IN[I.nBln] | 0);
    for (let i = 0; i < n; i++) {
      const s = I.blnBase + I.blnStride * i;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * i;
      A[o].set(IN[s] - v.roll, IN[s + 1], IN[s + 2], IN[s + 3]);
      A[o + 1].set(IN[s + 4], IN[s + 5], 0, 0);
      A[o + 2].set(0, 0, 0, 0);
      A[o + 3].set(0, 0, 0, 0);
      A[o + 4].set(0, 0, 0, 0);
    }
    const sp = this._toBuf(IN[I.px], IN[I.py], v, _sp);
    const a = NAMIAR_HDR;
    A[a].set(sp.x, sp.y, this._blonaR(v, IN[I.sig]) * v.pxs, IN[I.sig]);
    A[a + 1].set(0, n, 0.21, IN[I.vis]);
    A[a + 2].set(IN[I.onAge], 0, 0, 0);
    A[0].set(n, v.time, v.pxs, 1);
    A[1].set(v.bw, v.bh, 0, 0);
  }

  // Pakuje granice, których linia (szara albo czerwona, z pasem shadera) przecina kadr; zwraca ich liczbę, `_granDist` —
  // czy któraś potrzebuje refrakcji (linia przy okręcie w oknie granicy albo przejście w toku).
  _packGranica(A, v, n) {
    const IN = this.input;
    const T = this.tune;
    const z = v.zoomBuf;
    const c = _c;
    const band = 110 * v.pxs;                         // pas liczenia shadera (95 px) z zapasem
    const shipX = IN[I.px], shipY = IN[I.py];
    const distNear = T.winFar + band / Math.max(1e-6, z);
    let m = 0;
    this._granDist = false;
    for (let i = 0; i < n; i++) {
      const s = I.grnBase + I.grnStride * i;
      this._toBuf(IN[s + G.cx], IN[s + G.cy], v, c);
      const gray = IN[s + G.gray], red = IN[s + G.redA];
      const ev = IN[s + G.ageC] >= 0 || IN[s + G.ageV] >= 0;
      const bandG = band + Math.abs(IN[s + G.rate]) * z * 0.22;
      const seeG = (gray > 0.001 || ev) && ringInView(c.x, c.y, IN[s + G.R] * z, bandG, v.bw, v.bh);
      const seeR = (red > 0.001 || ev) && ringInView(c.x, c.y, IN[s + G.Rv] * z, band, v.bw, v.bh);
      if (!seeG && !seeR) continue;
      // refrakcja: linia w oknie przy okręcie (odległość okrętu od linii < okno + pas) albo przejście
      const dx = shipX - IN[s + G.cx], dy = shipY - IN[s + G.cy];
      const dS = Math.sqrt(dx * dx + dy * dy);
      if (ev || (seeR && red > 0.001 && Math.abs(dS - IN[s + G.Rv]) < distNear)
        || (seeG && gray > 0.001 && Math.abs(dS - IN[s + G.R]) < distNear + IN[s + G.winShift])) this._granDist = true;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * m;
      m++;
      A[o].set(c.x, c.y, IN[s + G.R] * z, IN[s + G.redA]);
      A[o + 1].set(IN[s + G.ageC], IN[s + G.dirC], IN[s + G.angC] - v.roll, IN[s + G.RcX] * z);
      A[o + 2].set(IN[s + G.est], IN[s + G.rate] * z, IN[s + G.nearAng] - v.roll, IN[s + G.Rv] * z);
      A[o + 3].set(IN[s + G.ageV], IN[s + G.dirV], IN[s + G.angV] - v.roll, IN[s + G.gray]);
      A[o + 4].set(IN[s + G.knownA], IN[s + G.knownV], IN[s + G.grayA], IN[s + G.winShift] * z);
    }
    const sp = this._toBuf(IN[I.px], IN[I.py], v, c);
    const a = NAMIAR_HDR;
    A[a].set(sp.x, sp.y, this._shipR(v) * v.pxs, 1);
    A[a + 1].set(T.winNear * z, T.winFar * z, T.waveLen * v.pxs, T.waveV * v.pxs);
    A[a + 2].set(0, 0, 0, 0);
    A[a + 3].set(0, 0, 0, 0);
    A[0].set(m, v.time, v.pxs, 1);
    A[1].set(v.bw, v.bh, v.zoomBuf, v.roll);   // tafla liczy wzory w świecie (zoom bufora, obrót kadru)
    return m;
  }

  // Kontakty względem środka kadru w osiach sceny (y w górę), po obrocie kadru; poza kadrem (z zapasem) — pominięte.
  _packKontakty(A, v, n) {
    const IN = this.input;
    const cx = Number(v.cam.x) || 0, cy = Number(v.cam.y) || 0;
    const halfW = v.bw * 0.5 / v.zoomBuf, halfH = v.bh * 0.5 / v.zoomBuf;
    let m = 0;
    for (let i = 0; i < n && m < KONTAKT_MAX; i++) {
      const s = I.konBase + I.konStride * i;
      const alpha = IN[s + K.alpha];
      if (!(alpha > 0.002)) continue;
      const R = Math.max(IN[s + K.R], IN[s + K.minPx] / Math.max(1e-6, v.zoom)) * IN[s + K.Rk];
      const reach = R * 3 + IN[s + K.err] * 2;
      rollToScreen(IN[s + K.x] - cx, IN[s + K.y] - cy, v.roll, _rs);
      if (Math.abs(_rs.x) > halfW + reach || Math.abs(_rs.y) > halfH + reach) continue;
      A[KONTAKT_HDR + 2 * m].set(_rs.x, -_rs.y, R, IN[s + K.err]);
      A[KONTAKT_HDR + 2 * m + 1].set(IN[s + K.cls], IN[s + K.mass], IN[s + K.seed], alpha);
      m++;
    }
    A[0].set(m, v.time, v.zoomBuf, v.pxs);
    A[1].set(v.bw, v.bh, wrap01(cx / KONTAKT_NOISE_TILE), wrap01(-cy / KONTAKT_NOISE_TILE));
    // obserwator (wiązka radaru w ECHU) — w obłoku X-ów bez znaczenia; daleko, wiązka wyłączona
    A[2].set(-1e6, 0, 2.4, 0);
    A[3].set(0, 0, 0, 0);
    return m;
  }
}

export const Czujniki = new CzujnikiSystem();

// Rozgrzewka: kwady powstają na ekranie ładowania (Core3D gotowy) — warstwa NAKŁADKI (własny cel) i DIST.
Core3D.warmup.add({ name: 'czujniki: nakładka', objects: () => Czujniki.warmupOverlay(), layer: FX_OVERLAY_LAYER, phase: 'loading' });
Core3D.warmup.add({ name: 'czujniki: refrakcja (DIST)', objects: () => Czujniki.warmupDist(), layer: FX_DISTORT_LAYER, phase: 'loading' });
