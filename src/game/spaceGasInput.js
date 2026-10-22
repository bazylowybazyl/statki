// src/game/spaceGasInput.js
//
// GAZ W OTWARTEJ PRZESTRZENI — strona GRY (port dema dema/gazy-transport-webgpu.html, docs/PLAN-gazy-kosmos.md GK-2,
// scena pasa GK-5). Gra co klatkę pakuje WEJŚCIE (Float64Array o układzie SPACE_GAS_IN) i oddaje je renderowi
// (src/3d/spaceGas/spaceGas.js — tryb off: wprost, worker: blok migawki `spaceGas`). Czysty moduł: bez three, DOM
// i `window`; pole pasa podaje wołający (świat pasa gry — `beltWorld.field`).
//
// Zawartość:
//   • KOTWICA sceny (pas — Słońce) w double: wszystko inne względem niej — render liczy pole w małych liczbach;
//   • okno pola przy kamerze (N komórek — preset grafiki) i kadr;
//   • OBWIEDNIA gazu pasa: siatka G × G wokół okna (z zapasem na dopływ przez brzeg) z `field.sampleMacro` — ten sam
//     wzór co płaty mgły pasa (src/3d/asteroids/fog.js), więc gaz leży tam, gdzie mgła, i rzednie w wyrwach (E3:
//     `hole`, a źródła gazu pola — `gas` — dochodzą same, gdy pole je poda); siatka zakotwiczona w świecie, przy
//     ruchu kamery przesuwana — próbkowane tylko nowe wiersze / kolumny (próbka pola to 2–6 µs);
//   • ODGAZOWANIE lodowych skał pola (prośba użytkownika 2026-10-22: „niektóre asteroidy produkują gazy”): skały gry
//     z lodem w oknie, struga od Słońca z wylotu po stronie dziennej, każda z własną fazą wydajności.
// Rozgrywka (D7, później): ta sama obwiednia × szum na CPU (spaceGasNoise.js — lustra) — bez odczytu z GPU.

import {
  SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_MAX_BLASTS, SPACE_GAS_MAX_BOLTS, SPACE_GAS_RASTER, SPACE_GAS_IN
} from '../3d/spaceGas/spaceGasLayout.js';

export { SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_MAX_BLASTS, SPACE_GAS_MAX_BOLTS, SPACE_GAS_RASTER, SPACE_GAS_IN };
const RS = SPACE_GAS_RASTER;

const G = SPACE_GAS_ENV_RES;
const JET = SPACE_GAS_IN.jetStride;

/** Strojenie wejścia (konsola: window.SpaceGasInputTune w ?dev). */
export const SPACE_GAS_INPUT_TUNE = {
  enabled: true,
  envMargin: 1.3,     // siatka obwiedni = okno × margines (dopływ przez brzeg)
  minEnv: 0.004,      // obwiednia poniżej — gazu nie ma (krok nie liczy)
  maxViewHalf: 90000, // dalej (oddalenie) — gaz się nie liczy (obraz gaśnie w renderze wcześniej)
  wind: 30,           // wiatr wzdłuż orbity [j/s] (pas: w kierunku ruchu orbitalnego, prostopadle do Słońca)
  windOut: -8,        // składowa od Słońca [j/s] (odgazowanie płynie na zewnątrz)
  jets: true,
  jetMinR: 140,       // najmniejsza skała odgazowująca [j.]
  jetSearch: 0.5,     // skały w oknie × ułamek (środek okna) — struga daleko poza kadrem nic nie da
  bolts: true         // pociski wloką gaz (A/B)
};

// Typy skał z lodem (asteroidRockKinds.js — nazwy; indeksy podaje wołający przez `iceTypes`).
export const SPACE_GAS_ICY_TYPES = Object.freeze(['ice', 'carbon_ice', 'primitive']);

/** Stan pakowania (siatka obwiedni — dwa bufory na zmianę, wersja, strugi). */
export function createSpaceGasInputState() {
  return {
    env: new Float32Array(G * G * 2),
    envB: new Float32Array(G * G * 2),
    ix0: NaN, iy0: NaN, cell: 0, holeVer: -1, ver: 0, anchorX: NaN, anchorY: NaN, max: 0,
    samples: 0,   // próbek pola w ostatniej klatce (koszt CPU)
    jetSeen: 0,
    // wybuchy w polu: x, y (świat gry), rozmiar, wiek, życie; `blastSeen` — ile wybuchów z pierścienia gry już przyjęto
    blasts: new Float64Array(SPACE_GAS_MAX_BLASTS * 5),
    nBlasts: 0,
    blastSeen: -1,
    // raster przekroju olbrzymów (z = 0): bajt na teksel, róg na siatce tekseli względem kotwicy
    raster: new Uint8Array(RS * RS),
    rasterB: new Uint8Array(RS * RS),
    rx0: NaN, ry0: NaN, rTexel: 0, rReady: -1, rVer: 0, rOn: 0,
    rasterSamples: 0
  };
}

function sampleEnv(field, wx, wy, out, o) {
  const m = field.sampleMacro(wx, wy);
  const w = m.weight > 0 ? m.weight : 0;
  // płaty mgły pasa (fog.js) × wyrwy (E3: `hole`) + źródła gazu pola (`gas`) — pola mogą jeszcze nie istnieć
  const hole = m.hole === undefined ? 1 : m.hole;
  const gas = m.gas > 0 ? m.gas : 0;
  out[o] = w * (0.22 + 0.78 * Math.min(1, m.cluster * 1.15)) * hole + gas;
  out[o + 1] = m.ice || 0;
}

/**
 * Pakuje wejście klatki.
 * @param {Float64Array} out SPACE_GAS_IN.size
 * @param {object} st createSpaceGasInputState()
 * @param {object} o dt, camX, camY, halfW, halfH (pół kadru [j.]), field (pole pasa gry: sampleMacro,
 *   rectTouchesBelt, holeVersion, forEachRockInRect), sunX, sunY (Słońce — kotwica), windowCells, cell,
 *   iceTypes (zbiór indeksów typów skał z lodem), time (zegar wydajności strug), enabled, blasts (wybuchy gry —
 *   src/game/explosionEvents.js: `recent`, `count`), bullets (pociski gry: x, y, vx, vy), giants (olbrzymy pasa —
 *   beltWorld.giants: entries z `giant.ready`, `sampleWorld`, `halfX / halfY`)
 */
export function packSpaceGasFrame(out, st, o) {
  const I = SPACE_GAS_IN;
  const T = SPACE_GAS_INPUT_TUNE;
  out[I.serial] = (out[I.serial] + 1) % 1e9;
  out[I.dt] = o.dt > 0 ? o.dt : 0;
  out[I.jets] = 0;
  st.samples = 0;
  const field = o.field;
  const cells = o.windowCells | 0 || 256;
  const cell = o.cell || 64;
  const halfWin = cells * cell * 0.5;
  const viewHalf = Math.max(o.halfW || 0, o.halfH || 0);
  let on = !!(T.enabled && o.enabled !== false && field && viewHalf < T.maxViewHalf);
  if (on) {
    const r = Math.max(halfWin, viewHalf) * T.envMargin;
    on = field.rectTouchesBelt(o.camX - r, o.camY - r, o.camX + r, o.camY + r);
  }
  out[I.scene] = on ? SPACE_GAS_SCENE.belt : SPACE_GAS_SCENE.none;
  stepBlasts(st, o.blasts, out[I.dt]);
  out[I.blasts] = 0;
  out[I.bolts] = 0;
  out[I.rasterOn] = 0;
  if (!on) { out[I.active] = 0; return out; }

  const ax = o.sunX || 0, ay = o.sunY || 0;
  if (ax !== st.anchorX || ay !== st.anchorY) { st.anchorX = ax; st.anchorY = ay; st.ix0 = NaN; }
  const cx = o.camX - ax, cy = o.camY - ay;
  out[I.anchorX] = ax; out[I.anchorY] = ay;
  out[I.camX] = cx; out[I.camY] = cy;
  out[I.halfW] = o.halfW; out[I.halfH] = o.halfH;
  out[I.windowCells] = cells;
  out[I.cell] = cell;
  // kierunek ku Słońcu (kotwica) z punktu kamery; wiatr: wzdłuż orbity + od Słońca
  const rl = Math.sqrt(cx * cx + cy * cy) || 1;
  const sx = -cx / rl, sy = -cy / rl;
  out[I.sunX] = sx; out[I.sunY] = sy;
  out[I.windX] = -sy * T.wind - sx * T.windOut;
  out[I.windY] = sx * T.wind - sy * T.windOut;

  // siatka obwiedni: zakotwiczona w świecie (względem kotwicy), przesuwana o całe próbki
  const envCell = Math.max(64, Math.ceil(halfWin * 2 * T.envMargin / (G - 1) / 64) * 64);
  const ix0 = Math.floor(cx / envCell) - (G >> 1);
  const iy0 = Math.floor(cy / envCell) - (G >> 1);
  const hv = field.holeVersion | 0;
  if (envCell !== st.cell || hv !== st.holeVer || !(ix0 === st.ix0 && iy0 === st.iy0)) {
    const full = envCell !== st.cell || hv !== st.holeVer || !Number.isFinite(st.ix0);
    const src = st.env, dst = st.envB;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const d = (j * G + i) * 2;
        const si = i + ix0 - st.ix0, sj = j + iy0 - st.iy0;
        if (!full && si >= 0 && si < G && sj >= 0 && sj < G) {
          const s = (sj * G + si) * 2;
          dst[d] = src[s]; dst[d + 1] = src[s + 1];
        } else {
          sampleEnv(field, ax + (ix0 + i + 0.5) * envCell, ay + (iy0 + j + 0.5) * envCell, dst, d);
          st.samples++;
        }
      }
    }
    st.env = dst; st.envB = src;
    st.ix0 = ix0; st.iy0 = iy0; st.cell = envCell; st.holeVer = hv;
    st.ver++;
    let mx = 0;
    for (let k = 0; k < G * G; k++) if (dst[k * 2] > mx) mx = dst[k * 2];
    st.max = mx;
  }
  out[I.envVer] = st.ver;
  out[I.envX0] = (st.ix0 + 0.5) * envCell;
  out[I.envY0] = (st.iy0 + 0.5) * envCell;
  out[I.envCell] = envCell;
  out[I.envMax] = st.max;
  out.set(st.env, I.envBase);
  const active = st.max > T.minEnv;
  out[I.active] = active ? 1 : 0;
  if (!active) return out;
  packBlasts(out, st, ax, ay, o.camX, o.camY, halfWin + 2000);

  // odgazowanie lodowych skał gry w środku okna (od Słońca, wylot po stronie dziennej)
  if (T.jets && o.iceTypes && typeof field.forEachRockInRect === 'function') {
    const h = halfWin * T.jetSearch;
    let n = 0;
    const t = o.time || 0;
    field.forEachRockInRect(0, o.camX - h, o.camY - h, o.camX + h, o.camY + h, T.jetMinR * 2, (rock) => {
      if (n >= SPACE_GAS_MAX_JETS || !o.iceTypes.has(rock.type)) return;
      const b = I.jetBase + n * JET;
      out[b] = rock.x - ax; out[b + 1] = rock.y - ay;
      out[b + 2] = -sx; out[b + 3] = -sy;
      out[b + 4] = rock.r;
      // wydajność: własna faza i tempo z ziarna skały (deterministyczne, bez losowań gry)
      const s = rock.seed || 0;
      out[b + 5] = 0.55 + 0.45 * Math.sin(t * (0.3 + (s * 0.173) % 0.4) + s * 17.0);
      n++;
    });
    out[I.jets] = n;
    st.jetSeen = n;
  }
  packBolts(out, o.bullets, o.camX, o.camY, halfWin, ax, ay);
  packRaster(out, st, o.giants, ax, ay, cx, cy, cells * cell);
  return out;
}

// Wybuchy z pierścienia gry (src/game/explosionEvents.js — `recent`, `count`): przyjęte raz, potem starzone czasem gry;
// życie jak w demie (wybuch okrętu 1,2 s) × √(rozmiar / 280 — Atlas). Liczone także poza gazem (stary wybuch nie wraca
// przy wejściu w pas).
function stepBlasts(st, ev, dt) {
  const B = st.blasts;
  let n = st.nBlasts;
  for (let i = n - 1; i >= 0; i--) {
    const o = i * 5;
    B[o + 3] += dt;
    if (B[o + 3] > B[o + 4]) {
      const last = (n - 1) * 5;
      for (let k = 0; k < 5; k++) B[o + k] = B[last + k];
      n--;
    }
  }
  if (ev && ev.recent) {
    const cap = ev.recent.length / 3;
    if (st.blastSeen < 0) st.blastSeen = ev.count;   // pierwsza klatka: wcześniejsze wybuchy pomijamy
    const from = Math.max(st.blastSeen, ev.count - cap);
    for (let c = from; c < ev.count; c++) {
      const r = (c % cap) * 3;
      let o = n * 5;
      if (n >= SPACE_GAS_MAX_BLASTS) {
        // pełna lista — miejsce najstarszego
        let oldest = 0;
        for (let i = 1; i < n; i++) if (B[i * 5 + 3] > B[oldest * 5 + 3]) oldest = i;
        o = oldest * 5;
      } else n++;
      const size = ev.recent[r + 2] > 0 ? ev.recent[r + 2] : 300;
      B[o] = ev.recent[r]; B[o + 1] = ev.recent[r + 1]; B[o + 2] = size; B[o + 3] = 0;
      B[o + 4] = 1.2 * Math.sqrt(Math.min(4, Math.max(0.25, size / 280)));
    }
    st.blastSeen = ev.count;
  }
  st.nBlasts = n;
}

function packBlasts(out, st, ax, ay, camX, camY, reach) {
  const I = SPACE_GAS_IN, B = st.blasts;
  let n = 0;
  for (let i = 0; i < st.nBlasts; i++) {
    const s = i * 5;
    if (Math.abs(B[s] - camX) > reach || Math.abs(B[s + 1] - camY) > reach) continue;
    const o = I.blastBase + n * I.blastStride;
    out[o] = B[s] - ax; out[o + 1] = B[s + 1] - ay; out[o + 2] = B[s + 2]; out[o + 3] = B[s + 3]; out[o + 4] = B[s + 4];
    n++;
  }
  out[I.blasts] = n;
}

// Pociski gry (`bullets`: x, y, vx, vy) w oknie pola — za każdym gaz wleczony jak za strzałem dema.
function packBolts(out, bullets, camX, camY, half, ax, ay) {
  const I = SPACE_GAS_IN;
  let n = 0;
  if (bullets && SPACE_GAS_INPUT_TUNE.bolts) {
    for (let i = 0; i < bullets.length && n < SPACE_GAS_MAX_BOLTS; i++) {
      const b = bullets[i];
      if (!b || b.dead || Math.abs(b.x - camX) > half || Math.abs(b.y - camY) > half) continue;
      const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (!(v > 50)) continue;
      const o = I.boltBase + n * I.boltStride;
      out[o] = b.x - ax; out[o + 1] = b.y - ay; out[o + 2] = b.vx / v; out[o + 3] = b.vy / v; out[o + 4] = v;
      n++;
    }
  }
  out[I.bolts] = n;
}

// Raster przekroju olbrzymów pasa (z = 0) na okno pola: teksel = okno / 128, róg na siatce tekseli (przy ruchu kamery
// przesuwany — próbkowane tylko nowe teksle i tylko w pudłach gotowych olbrzymów); zmiana zestawu gotowych olbrzymów —
// od nowa. Komórki stałe pola gazu i zasłona strug (gaz nie przechodzi przez skałę).
function packRaster(out, st, giants, ax, ay, cx, cy, side) {
  const I = SPACE_GAS_IN;
  st.rasterSamples = 0;
  const list = giants && giants.entries;
  let ready = 0, touch = false;
  const texel = side / RS;
  const half = side * 0.5 + texel;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.giant || !e.giant.ready) continue;
      ready++;
      if (Math.abs(e.x - ax - cx) < half + e.halfX && Math.abs(e.y - ay - cy) < half + e.halfY) touch = true;
    }
  }
  if (!touch) {
    if (st.rOn) { st.rOn = 0; st.rVer++; }
    st.rx0 = NaN;
    out[I.rasterOn] = 0;
    out[I.rasterVer] = st.rVer;
    return;
  }
  const rx = Math.floor(cx / texel) - (RS >> 1), ry = Math.floor(cy / texel) - (RS >> 1);
  if (rx !== st.rx0 || ry !== st.ry0 || texel !== st.rTexel || ready !== st.rReady) {
    const full = texel !== st.rTexel || ready !== st.rReady || !Number.isFinite(st.rx0);
    const src = st.raster, dst = st.rasterB;
    dst.fill(0);
    let any = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const g = e.giant;
      if (!g || !g.ready) continue;
      const band = (g.band || 0) + texel;
      const i0 = Math.max(0, Math.floor((e.x - ax - e.halfX - band) / texel) - rx);
      const i1 = Math.min(RS - 1, Math.floor((e.x - ax + e.halfX + band) / texel) - rx);
      const j0 = Math.max(0, Math.floor((e.y - ay - e.halfY - band) / texel) - ry);
      const j1 = Math.min(RS - 1, Math.floor((e.y - ay + e.halfY + band) / texel) - ry);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          const si = k + rx - st.rx0, sj = j + ry - st.ry0;
          let v;
          if (!full && si >= 0 && si < RS && sj >= 0 && sj < RS) v = src[sj * RS + si];
          else {
            v = g.sampleWorld(ax + (rx + k + 0.5) * texel, ay + (ry + j + 0.5) * texel, 0) < 0 ? 1 : 0;
            st.rasterSamples++;
          }
          if (v) { dst[j * RS + k] = 1; any = 1; }
        }
      }
    }
    st.raster = dst; st.rasterB = src;
    st.rx0 = rx; st.ry0 = ry; st.rTexel = texel; st.rReady = ready; st.rOn = any;
    st.rVer++;
  }
  out[I.rasterOn] = st.rOn;
  out[I.rasterX0] = st.rx0 * texel;
  out[I.rasterY0] = st.ry0 * texel;
  out[I.rasterTexel] = texel;
  out[I.rasterVer] = st.rVer;
  if (st.rOn) {
    const R = st.raster, base = I.rasterBase;
    for (let w = 0; w < I.rasterWords; w++) {
      let word = 0;
      const b0 = w * 32;
      for (let b = 0; b < 32; b++) if (R[b0 + b]) word |= (1 << b);
      out[base + w] = word >>> 0;
    }
  }
}
