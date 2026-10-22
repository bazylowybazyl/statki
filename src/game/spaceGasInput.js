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

import { SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_IN } from '../3d/spaceGas/spaceGasLayout.js';

export { SPACE_GAS_SCENE, SPACE_GAS_ENV_RES, SPACE_GAS_MAX_JETS, SPACE_GAS_IN };

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
  jetSearch: 0.5      // skały w oknie × ułamek (środek okna) — struga daleko poza kadrem nic nie da
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
    jetSeen: 0
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
 *   iceTypes (zbiór indeksów typów skał z lodem), time (zegar wydajności strug), enabled
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
  return out;
}
