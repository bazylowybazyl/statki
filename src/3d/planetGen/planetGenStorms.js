// src/3d/planetGen/planetGenStorms.js
//
// BURZE planet generatora: układy burzowe z ZIARNA planety (gdzie i jak duże) oraz BŁYSKI PIORUNÓW jako funkcja
// (ziarno, czas) — bez stanu: ta sama chwila daje te same błyski w każdej sesji, a harness z ręcznym zegarem dostaje
// powtarzalny obraz. Burza to jawny układ (kierunek, promień), nie skutek szumu: program wie, gdzie jest (kadr dema,
// później strefa rozgrywki, dźwięk grzmotu), a bryła chmur (planetGenCloudVolume.tsl.js) dostaje go w uniformach —
// w tarczy burzy chmura jest lita, wysoka (wieże z kowadłem) i ciemniejsza, a błyski świecą WEWNĄTRZ chmury.
// Moduł czysty (bez three, bez Math.random — zasada żelazna 9).
import { rngFor, mix32 } from './planetGenRng.js';

/** Najwięcej układów burzowych na planecie (tyle uniformów ma bryła chmur i cień na gruncie). */
export const STORM_MAX = 4;
/** Najwięcej błysków naraz (uniformy bryły chmur). */
export const FLASH_MAX = 6;
/** Okno losowania błysku [s] i liczba niezależnych strumieni błysków na burzę. */
export const FLASH_SLOT = 0.4;
export const FLASH_STREAMS = 2;
/** Najdłuższy błysk [s] (kilka wyładowań po sobie). */
export const FLASH_LENGTH = 0.45;

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * Układy burzowe planety z ziarna: [{ dir — kierunek środka w układzie kuli chmur (jednostkowy), radius — promień
 * tarczy [rad] (0,075–0,14 = ~400–800 km przy planecie 5500 km), rate — aktywność błysków 0…1 }]. Planety z chmurami ziemskimi: 2–4 burze, dwie trzecie w tropikach
 * (strefa zbieżności), reszta w średnich szerokościach (fronty); pokład (toksyczna): 1–3; pył — bez burz.
 */
export function planetStorms(spec) {
  const c = spec && spec.clouds;
  if (!c || c.style === 2) return [];
  const rng = rngFor(spec.seed, `${spec.type}:burze`);
  const n = c.style === 1 ? rng.int(1, 3) : rng.int(2, STORM_MAX);
  const out = [];
  for (let i = 0; i < n; i++) {
    const tropic = rng.chance(0.65);
    const lat = (tropic ? rng.range(2, 22) : rng.range(34, 56)) * (rng.chance(0.5) ? 1 : -1) * Math.PI / 180;
    const lon = rng.range(0, 2 * Math.PI);
    out.push({
      dir: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)],
      radius: round(rng.range(0.075, 0.14), 4),
      rate: round(rng.range(0.6, 1), 3)
    });
  }
  return out;
}

/** Obrót kierunku wokół osi planety (Y) o kąt `a` — jak `rotY` grafu chmur: (0, 0, 1) → (sin a, 0, cos a). */
export function rotateY(dir, a, out = [0, 0, 0]) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = dir[0] * c + dir[2] * s;
  const z = dir[2] * c - dir[0] * s;
  out[0] = x; out[1] = dir[1]; out[2] = z;
  return out;
}

/**
 * Błyski piorunów w chwili `time` [s]. Każda burza ma FLASH_STREAMS niezależnych strumieni; w każdym oknie
 * FLASH_SLOT strumień losuje (haszem ziarna, burzy, strumienia i numeru okna), czy jest błysk, kiedy się zaczyna,
 * ile ma wyładowań (1–3, każde gaśnie w ~30 ms), jak jest mocny i gdzie leży (w tarczy burzy, w środku chmury).
 * `storms` — jak z `planetStorms` (kierunki w chwili `time`: wiatr przenosi burzę, przesuwa je wołający).
 * Wynik w `out` (Float32Array, FLASH_MAX · 4): x, y, z — miejsce w układzie kuli chmur (promień = `base` +
 * `thick` · wysokość), w — jasność (0 — brak; pojedyncze wyładowanie ≤ 1, nakładające się do ~1,6). Zwraca liczbę
 * błysków; przy nadmiarze zostają najjaśniejsze.
 */
export function stormFlashes(storms, time, { seed = 0, base = 1.003, thick = 0.014, out = new Float32Array(FLASH_MAX * 4) } = {}) {
  out.fill(0);
  let n = 0;
  if (!storms || !storms.length || !(time >= 0)) return 0;
  const slot = Math.floor(time / FLASH_SLOT);
  for (let s = 0; s < storms.length && s < STORM_MAX; s++) {
    const st = storms[s];
    if (!(st.radius > 0)) continue;
    for (let m = 0; m < FLASH_STREAMS; m++) {
      // okno bieżące i poprzednie (błysk trwa dłużej niż reszta okna po jego początku)
      for (let k = slot; k >= slot - 1 && k >= 0; k--) {
        let h = mix32(mix32(seed >>> 0, s * 16 + m + 1), k + 1);
        const r = () => { h = mix32(h, 0x9e3779b9); return (h >>> 8) / 16777216; };
        if (r() > 0.42 * (st.rate ?? 1)) continue;
        const age = time - (k + r() * 0.7) * FLASH_SLOT;
        const strokes = 1 + Math.floor(r() * 3);
        const gap = 0.055 + r() * 0.05;
        const power = 0.55 + 0.45 * r();
        const phi = 2 * Math.PI * r();
        const rho = st.radius * 0.75 * Math.sqrt(r());
        const hN = 0.3 + 0.3 * r();
        if (age < 0 || age > FLASH_LENGTH) continue;
        let I = 0;
        for (let j = 0; j < strokes; j++) {
          const a = age - j * gap;
          if (a >= 0) I += Math.exp(-a / 0.032) * (j === 0 ? 1 : 0.62);
        }
        I *= power;
        if (I < 0.02) continue;
        // baza styczna w środku burzy
        const d = st.dir;
        let ex = d[2]; let ey = 0; let ez = -d[0];            // Y × d
        let el = Math.sqrt(ex * ex + ez * ez);
        if (el < 1e-4) { ex = 1; ez = 0; el = 1; }
        ex /= el; ez /= el;
        const nx = d[1] * ez - d[2] * ey; const ny = d[2] * ex - d[0] * ez; const nz = d[0] * ey - d[1] * ex;   // d × e
        const cr = Math.cos(rho); const sr = Math.sin(rho); const cp = Math.cos(phi); const sp = Math.sin(phi);
        let px = d[0] * cr + (ex * cp + nx * sp) * sr;
        let py = d[1] * cr + (ey * cp + ny * sp) * sr;
        let pz = d[2] * cr + (ez * cp + nz * sp) * sr;
        const R = (base + thick * hN) / Math.sqrt(px * px + py * py + pz * pz);
        px *= R; py *= R; pz *= R;
        // miejsce w tablicy: wolne albo najsłabszy błysk
        let at = n;
        if (n >= FLASH_MAX) {
          at = 0;
          for (let i = 1; i < FLASH_MAX; i++) if (out[i * 4 + 3] < out[at * 4 + 3]) at = i;
          if (out[at * 4 + 3] >= I) continue;
        } else n++;
        out[at * 4] = px; out[at * 4 + 1] = py; out[at * 4 + 2] = pz; out[at * 4 + 3] = I;
      }
    }
  }
  return n;
}
