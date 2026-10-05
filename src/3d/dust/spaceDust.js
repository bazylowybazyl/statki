// src/3d/dust/spaceDust.js
//
// PYŁ KOSMICZNY — logika bez three (testy w Node: tests/spaceDust.test.mjs). Obraz: spaceDust3D.js.
//
// Po co (zgłoszenie użytkownika 2026-10-05: „nie czuć, że statek leci, zwłaszcza przy przybliżeniu”):
// w otwartej przestrzeni jedynym punktem odniesienia były gwiazdy i mgławica — mgławica stoi (paralaksa
// 0,02), a gwiazdy leżą w płaszczyźnie gry, więc przy zoomie 0,45 na ekranie zostaje ~1 „szybka” gwiazda.
// Kadr nie pokazywał nic zakotwiczonego w świecie. Pył to drobiny w kilku WARSTWACH GŁĘBI:
//   • paralaksa p — przesuw drobiny na ekranie = −p × ruch kamery × zoom (1 = płaszczyzna gry, < 1 głębiej,
//     > 1 bliżej kamery); skala wzoru na ekranie też × p (jak w perspektywie),
//   • smuga — drobina rozmyta wzdłuż swojej prędkości na ekranie (migawka `shutter`), w ruchu jaśniejsza,
//   • OKTAWY ZOOMU — gęstość na ekranie stała przy każdym zoomie: warstwa to dwa wzory (sloty parzystości
//     oktawy) o rozmiarze kontenera C0 · 2^k; przy zbliżeniu wzór rozjeżdża się razem ze światem, a między
//     drobinami pojawiają się drobiny drobniejszej oktawy (wagi z log2 — kapelusz, suma 1). Oktawa k zawsze
//     w slocie k & 1, więc wzór nie przeskakuje: slot zmienia oktawę (k → k ± 2) przy wadze 0,
//   • POŚWIATA DYSZ (2026-10-05, druga prośba): stożek światła za dyszami MAIN każdego okrętu (EngineFrame —
//     src/3d/engineFrame.js) rozświetla drobiny barwą palety silnika; moc = ciąg strugi (dopalacz jaśniej),
//   • KAMERY 3D (K): osobny wzór w SZEŚCIANIE wokół kamery perspektywy (oktawy z odległości kamery od celu),
//     prawdziwa paralaksa, smuga z ruchu kamery rzutowana na ekran.
//
// Precyzja (agents.md: świat 5–10 mln j.): położenie kamery w kontenerze (fract(kamera / C)) liczy CPU
// w double, shader dostaje tylko ułamek i rozmiar kontenera; stożki dysz — względem kamery.
//
// Układ: SCENA (x w prawo, y w GÓRĘ = −y świata gry); piksele ekranu od środka kadru, y w górę (klip).

import { FxRandom } from '../fx/fxRandom.js';
import { MAIN_EXHAUST_PALETTES } from '../../data/engineFx.js';

/** Nagłówek tablicy uniformów (vec4): widok, smugi, siatka świateł, barwa i widoczność, liczba stożków dysz. */
export const DUST_HEADER_VEC4 = 5;
/** vec4 na slot: (przesunięcie wzoru x, y, kontener [px], waga oktawy), (prędkość [px/s] x, y, —, z światła). */
export const DUST_SLOT_VEC4 = 2;
/** Liczby na drobinę w buforze instancji: (baza x, y, ranga, slot), (promień [px], jasność, miękkość, faza). */
export const DUST_INSTANCE_STRIDE = 8;
/** Ziarno wzoru drobin (własny strumień FxRandom — nie zużywa losowań gry ani wspólnego fxRandom). */
export const DUST_SEED = 0x5d05e7;
/** Najwięcej stożków poświaty dysz naraz (okrętów najbliżej kamery). */
export const DUST_PLUME_CAP = 16;
/** vec4 na stożek: (początek x, y względem kamery, kierunek x, y), (długość, szerokość, moc, poszerzenie), (barwa). */
export const DUST_PLUME_VEC4 = 3;

/**
 * Strojenie (na żywo: window.SpaceDustTune; zmiana warstw → SpaceDust3D.rebuild()).
 * Jasności w HDR gry (próg bloomu ~0,9): drobiny zostają POD progiem — szara drobina, nie gwiazda.
 */
export const SPACE_DUST_TUNE = {
  enabled: true,
  // p — paralaksa; count — drobin w slocie (oktawie); size — promień plamki [px] (min, max); bright — jasność
  // (min, max); soft — miękkość (0 ostra drobina, 1 rozmyta „poza ostrością”); z — wysokość punktu w siatce
  // świateł [j. sceny] (głębsze dalej od błysków); pass — 'ortho' (pod kadłubami) | 'fg' (nad wszystkim).
  layers: [
    { p: 0.36, count: 208, size: [0.5, 0.85], bright: [0.3, 0.7], soft: 0, z: -520, pass: 'ortho' },
    { p: 0.6, count: 232, size: [0.55, 0.95], bright: [0.4, 0.85], soft: 0, z: -220, pass: 'ortho' },
    { p: 1.0, count: 256, size: [0.6, 1.1], bright: [0.5, 1.0], soft: 0, z: 0, pass: 'ortho' },
    { p: 1.45, count: 160, size: [0.75, 1.35], bright: [0.45, 0.9], soft: 0.3, z: 60, pass: 'ortho' },
    { p: 2.3, count: 32, size: [1.8, 3.0], bright: [0.18, 0.38], soft: 1, z: 160, pass: 'fg' }
  ],
  C0: 1000,              // kontener oktawy 0 [j. świata]; oktawa k = C0 · 2^k
  octavePx: 2.0,         // kontener oktawy u szczytu wagi = octavePx × dłuższy bok kadru (≥ 2: wzór się nie powtarza w kadrze)
  rankBand: 0.15,        // miękkość pojawiania się drobin przy zmianie wagi oktawy
  shutter: 0.045,        // „migawka” smugi [s]: długość = prędkość na ekranie × shutter
  streakMaxPx: 120,      // najdłuższa smuga [px]
  restAlpha: 0.4,        // widoczność drobiny w spoczynku (ruch → 1)
  speedPx: [25, 450],    // prędkość na ekranie [px/s], w której drobina przechodzi z restAlpha do 1 (rampa ^0,6)
  color: [0.9, 0.93, 1.0],
  intensity: 0.55,       // jasność HDR rdzenia najjaśniejszej drobiny
  zoomFade: [0.05, 0.085], // zoom: poniżej pierwszego pył znika (widok strategiczny)
  speedFade: [5000, 11000], // prędkość kamery [j/s]: powyżej warp — pył gaśnie (warp ma ośrodek „Nurt”)
  lightGain: 0.8,        // światło efektów (siatka: błyski luf, trafienia, wybuchy) rozproszone na drobinach
  velTau: 0.07,          // wygładzenie prędkości kamery do smug [s]
  cutScreens: 2.5,       // skok kamery dłuższy niż tyle kadrów na klatkę = cięcie (teleport) — bez smug
  // Poświata dysz MAIN na pyle: stożek za gromadą dysz. Szerokość u wylotu = rozrzut dysz + 2 R (× width),
  // długość = (rozrzut + 4 R) × length × (0,55 + 0,45 · moc), na końcu szerszy × widen; jasność = gain × moc ×
  // barwa światła palety (MAIN_EXHAUST_PALETTES[].light).
  plume: { gain: 2.0, length: 8, width: 1.0, widen: 2.2, minPower: 0.03 },
  // Kamery 3D (K): wzór w sześcianie wokół kamery. count — drobin w slocie; size — promień [px] w odległości
  // odniesienia (refDepth × kontener); kontener oktawy u szczytu = boxMul × odległość kamery od celu; near / far —
  // zanik przy kamerze i przy brzegu sześcianu (× kontener, brzeg = 0,5).
  free3d: {
    count: 2400, size: [0.5, 1.1], bright: [0.35, 1.0], C0: 1000, boxMul: 2.4,
    near: [0.012, 0.045], far: [0.3, 0.47], refDepth: 0.2, sizeMax: 3.0, nearClip: 2
  }
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * Najwięcej warstw — rozmiar tablicy uniformów jest w WGSL, więc stały (strojenie warstw na żywo nie
 * przebudowuje materiału; warstwy ponad limit są pomijane).
 */
export const DUST_MAX_LAYERS = 6;

/** Liczba slotów (2 na warstwę: oktawy parzyste i nieparzyste). */
export function dustSlotCount() {
  return DUST_MAX_LAYERS * 2;
}

/** Początek stożków dysz w tablicy uniformów (indeks vec4). */
export function dustPlumeBase() {
  return DUST_HEADER_VEC4 + dustSlotCount() * DUST_SLOT_VEC4;
}

/** Długość tablicy uniformów (vec4). */
export function dustUniformCount() {
  return dustPlumeBase() + DUST_PLUME_CAP * DUST_PLUME_VEC4;
}

/**
 * Bufor instancji drobin passa ('ortho' | 'fg'): DUST_INSTANCE_STRIDE liczb na drobinę. Każda warstwa
 * daje dwa sloty (parzystość oktawy) po `count` drobin o WŁASNYCH położeniach (oktawy nie są skalowaną
 * kopią siebie). Ranga — kolejność pojawiania się przy wzroście wagi (niezależna od położenia).
 * @returns {{ data: Float32Array, count: number }}
 */
export function buildDustInstances(tune = SPACE_DUST_TUNE, pass = 'ortho', seed = DUST_SEED) {
  const rng = new FxRandom(seed);
  let total = 0;
  tune.layers.forEach((L, li) => {
    if ((L.pass || 'ortho') === pass && li < DUST_MAX_LAYERS) total += 2 * Math.max(0, L.count | 0);
  });
  const data = new Float32Array(Math.max(1, total) * DUST_INSTANCE_STRIDE);
  let o = 0;
  tune.layers.forEach((L, li) => {
    const n = Math.max(0, L.count | 0);
    if ((L.pass || 'ortho') !== pass || li >= DUST_MAX_LAYERS) return;
    // Strumień per warstwa: zmiana liczby drobin jednej warstwy nie przestawia pozostałych.
    rng.seed((seed ^ Math.imul(li + 1, 0x9e3779b1)) >>> 0);
    for (let parity = 0; parity < 2; parity++) {
      for (let i = 0; i < n; i++) {
        const bx = rng.next();
        const by = rng.next();
        const rank = rng.next();
        const sz = rng.next();
        const br = rng.next();
        const ph = rng.next();
        data[o] = bx;
        data[o + 1] = by;
        data[o + 2] = rank;
        data[o + 3] = li * 2 + parity;
        // Więcej drobnych niż dużych, jasność z ciężarem ku ciemniejszym.
        data[o + 4] = L.size[0] + (L.size[1] - L.size[0]) * sz * sz;
        data[o + 5] = L.bright[0] + (L.bright[1] - L.bright[0]) * Math.pow(br, 1.5);
        data[o + 6] = clamp01(Number(L.soft) || 0);
        data[o + 7] = ph;
        o += DUST_INSTANCE_STRIDE;
      }
    }
  });
  return { data, count: total };
}

/** Widoczność pyłu: zoom (widok strategiczny bez pyłu) × prędkość kamery (warp ma własny ośrodek). */
export function dustVisibility(tune, zoom, speed) {
  const zf = tune.zoomFade;
  const sf = tune.speedFade;
  return smooth(zf[0], zf[1], finiteOr(zoom, 0)) * (1 - smooth(sf[0], sf[1], finiteOr(speed, 0)));
}

/**
 * Oktawy warstwy: x = log2(kontener docelowy / (zoomPx · p · C0)); oktawa k0 = ⌊x⌋ z wagą 1 − t,
 * k0 + 1 z wagą t (t = x − k0). Kontener oktawy na ekranie: ∈ (D/2, 2D], waga 1 przy D.
 */
export function dustOctaves(tune, p, zoomPx, viewMaxPx, out = { k0: 0, t: 0 }) {
  const D = Math.max(1, tune.octavePx * viewMaxPx);
  const scale = Math.max(1e-9, zoomPx * p);
  const x = Math.log2(D / (scale * tune.C0));
  const k0 = Math.floor(x);
  out.k0 = k0;
  out.t = x - k0;
  return out;
}

const _oct = { k0: 0, t: 0 };

/**
 * Uniformy jednego renderu (widoku): `out` = Float32Array(dustUniformCount × 4). Stożki dysz pisze osobno
 * writeDustPlumes (przed albo po) — tu tylko ich liczba z `view.plumes`.
 * view = { camX, camY — kamera passa w SCENIE (double), zoomPx — px celu na j. świata, halfW, halfH — pół kadru
 *          [px], velX, velY — prędkość kamery w scenie [j/s] (wygładzona), gridX, gridY — kamera względem
 *          początku siatki świateł (double na CPU), time [s], vis — widoczność 0..1, plumes — liczba stożków }
 */
export function writeDustUniforms(tune, view, out) {
  const halfW = Math.max(1, finiteOr(view.halfW, 1));
  const halfH = Math.max(1, finiteOr(view.halfH, 1));
  const zoomPx = Math.max(1e-9, finiteOr(view.zoomPx, 1));
  const vx = finiteOr(view.velX, 0);
  const vy = finiteOr(view.velY, 0);
  const camX = finiteOr(view.camX, 0);
  const camY = finiteOr(view.camY, 0);
  const I = Math.max(0, Number(tune.intensity) || 0);
  const c = tune.color;
  // G0..G4
  out[0] = halfW; out[1] = halfH; out[2] = finiteOr(view.time, 0) % 3600; out[3] = Math.max(0, tune.shutter);
  out[4] = Math.max(0, tune.streakMaxPx); out[5] = clamp01(tune.restAlpha); out[6] = tune.speedPx[0]; out[7] = Math.max(tune.speedPx[0] + 1e-3, tune.speedPx[1]);
  out[8] = finiteOr(view.gridX, 0); out[9] = finiteOr(view.gridY, 0); out[10] = zoomPx; out[11] = Math.max(0, Number(tune.lightGain) || 0);
  out[12] = c[0] * I; out[13] = c[1] * I; out[14] = c[2] * I; out[15] = tune.enabled === false ? 0 : clamp01(finiteOr(view.vis, 0));
  out[16] = Math.max(0, Math.min(DUST_PLUME_CAP, finiteOr(view.plumes, 0) | 0)); out[17] = 0; out[18] = 0; out[19] = 0;
  const viewMax = 2 * Math.max(halfW, halfH);
  const base = DUST_HEADER_VEC4 * 4;
  for (let li = 0; li < DUST_MAX_LAYERS; li++) {
    const L = tune.layers[li];
    if (!L) {
      // slot bez warstwy: waga 0 (shader nie rysuje)
      out.fill(0, base + li * 2 * DUST_SLOT_VEC4 * 4, base + (li + 1) * 2 * DUST_SLOT_VEC4 * 4);
      continue;
    }
    const p = Math.max(1e-3, Number(L.p) || 1);
    const scale = zoomPx * p;
    dustOctaves(tune, p, zoomPx, viewMax, _oct);
    for (let j = 0; j < 2; j++) {
      const k = _oct.k0 + j;
      const w = j === 0 ? 1 - _oct.t : _oct.t;
      const s = li * 2 + (k & 1);
      const C = tune.C0 * Math.pow(2, k);
      const ox = camX / C;
      const oy = camY / C;
      const o = base + s * DUST_SLOT_VEC4 * 4;
      out[o] = ox - Math.floor(ox);
      out[o + 1] = oy - Math.floor(oy);
      out[o + 2] = C * scale;
      out[o + 3] = w;
      out[o + 4] = -vx * scale;
      out[o + 5] = -vy * scale;
      out[o + 6] = 0;
      out[o + 7] = Number(L.z) || 0;
    }
  }
  return out;
}

const _pickScore = new Float32Array(DUST_PLUME_CAP);
const _pickIdx = new Int16Array(DUST_PLUME_CAP);

/**
 * Stożki poświaty dysz MAIN dla widoku: okręty z listy EngineFrame (src/3d/engineFrame.js), w zasięgu `reach`
 * [j.] od kamery (camX, camY — scena, double), najwyżej DUST_PLUME_CAP — najjaśniejsze i najbliższe. Zapis od
 * vec4 `baseVec4` tablicy `out`, pozycje WZGLĘDEM kamery. Zwraca liczbę stożków.
 */
export function writeDustPlumes(tune, frame, camX, camY, reach, out, baseVec4 = dustPlumeBase()) {
  const P = tune.plume;
  if (!frame || !P || !(frame.count > 0) || !(P.gain > 0)) return 0;
  let n = 0;
  for (let k = 0; k < frame.count; k++) {
    const power = frame.power[k];
    if (!(power >= P.minPower)) continue;
    const R = frame.radius[k];
    const spread = frame.spread[k];
    const W0 = (spread + 2 * R) * P.width;
    const L = (spread + 4 * R) * P.length * (0.55 + 0.45 * Math.min(power, 1.5));
    if (!(W0 > 0 && L > 0)) continue;
    const rx = frame.x[k] - camX;
    const ry = frame.y[k] - camY;
    // środek stożka w zasięgu widoku
    const cx = rx + frame.dirX[k] * L * 0.5;
    const cy = ry + frame.dirY[k] * L * 0.5;
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d > reach + L * 0.5 + W0 * P.widen) continue;
    const score = Math.min(power, 1.5) * (W0 + L * 0.25) / (1 + d / Math.max(1, reach));
    // ranking: najgorszy z zajętych miejsc ustępuje lepszemu
    let slot = n;
    if (n >= DUST_PLUME_CAP) {
      let worst = 0;
      for (let i = 1; i < n; i++) if (_pickScore[i] < _pickScore[worst]) worst = i;
      if (_pickScore[worst] >= score) continue;
      slot = worst;
    } else n++;
    _pickScore[slot] = score;
    _pickIdx[slot] = k;
  }
  for (let i = 0; i < n; i++) {
    const k = _pickIdx[i];
    const power = Math.min(frame.power[k], 1.5);
    const R = frame.radius[k];
    const spread = frame.spread[k];
    const pal = MAIN_EXHAUST_PALETTES[frame.palette[k]] || MAIN_EXHAUST_PALETTES[0];
    const light = pal.light || pal.spark || [0.5, 0.7, 1.0];
    const o = (baseVec4 + i * DUST_PLUME_VEC4) * 4;
    out[o] = frame.x[k] - camX;
    out[o + 1] = frame.y[k] - camY;
    out[o + 2] = frame.dirX[k];
    out[o + 3] = frame.dirY[k];
    out[o + 4] = (spread + 4 * R) * P.length * (0.55 + 0.45 * power);
    out[o + 5] = (spread + 2 * R) * P.width;
    out[o + 6] = P.gain * power;
    out[o + 7] = Math.max(1, P.widen);
    out[o + 8] = light[0];
    out[o + 9] = light[1];
    out[o + 10] = light[2];
    out[o + 11] = 0;
  }
  return n;
}

/**
 * Lustro CPU światła stożków w punkcie (px, py — scena względem kamery, z — wysokość drobiny): suma barwa × moc
 * × zanik (shader: plumeLight w spaceDust3D.js). `out` = [r, g, b].
 */
export function dustPlumeLightCpu(u, baseVec4, count, px, py, z, out = [0, 0, 0]) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (let i = 0; i < count; i++) {
    const o = (baseVec4 + i * DUST_PLUME_VEC4) * 4;
    const rx = px - u[o];
    const ry = py - u[o + 1];
    const along = rx * u[o + 2] + ry * u[o + 3];
    const qx = rx - u[o + 2] * along;
    const qy = ry - u[o + 3] * along;
    const L = Math.max(1, u[o + 4]);
    const W = Math.max(1, u[o + 5]);
    const t = clamp01(along / L);
    const w = W * (1 + (u[o + 7] - 1) * t);
    const cross = (qx * qx + qy * qy) / (w * w);
    const start = smooth(-W * 0.8, W * 0.2, along);
    const end = (1 - t) * (1 - t);
    const zf = Math.exp(-(z * z) / (4 * W * W));
    const f = Math.exp(-cross * 1.6) * start * end * zf * u[o + 6];
    out[0] += u[o + 8] * f;
    out[1] += u[o + 9] * f;
    out[2] += u[o + 10] * f;
  }
  return out;
}

/**
 * Lustro CPU położenia drobiny (shader: spaceDust3D.js) — testy i narzędzia.
 * Zwraca { x, y } [px od środka kadru, y w górę] i `fade` (waga oktawy po randze).
 */
export function dustMotePx(uniforms, inst, i, tune = SPACE_DUST_TUNE, out = { x: 0, y: 0, fade: 0 }) {
  const a = i * DUST_INSTANCE_STRIDE;
  const s = inst[a + 3];
  const o = (DUST_HEADER_VEC4 + s * DUST_SLOT_VEC4) * 4;
  const fx = inst[a] - uniforms[o] + 0.5;
  const fy = inst[a + 1] - uniforms[o + 1] + 0.5;
  out.x = (fx - Math.floor(fx) - 0.5) * uniforms[o + 2];
  out.y = (fy - Math.floor(fy) - 0.5) * uniforms[o + 2];
  const band = Math.max(1e-3, tune.rankBand);
  out.fade = clamp01((uniforms[o + 3] * (1 + band) - inst[a + 2]) / band);
  return out;
}

// ── Kamery 3D (K) ────────────────────────────────────────────────────────────────────────────────────────

/** Nagłówek tablicy 3D (vec4): widok, smugi, siatka, barwa, prędkość kamery, stożki / przycinanie. */
export const DUST3D_HEADER_VEC4 = 6;
/** vec4 na slot 3D: (przesunięcie wzoru xyz, kontener), (waga, zanik przy kamerze 0..1, zanik daleko 0), (zanik daleko 1, odległość odniesienia, —, —). */
export const DUST3D_SLOT_VEC4 = 3;
export const DUST3D_SLOTS = 2;

/** Początek stożków dysz w tablicy 3D (indeks vec4). */
export function dust3DPlumeBase() {
  return DUST3D_HEADER_VEC4 + DUST3D_SLOTS * DUST3D_SLOT_VEC4;
}

/** Długość tablicy uniformów 3D (vec4). */
export function dust3DUniformCount() {
  return dust3DPlumeBase() + DUST_PLUME_CAP * DUST_PLUME_VEC4;
}

/**
 * Drobiny 3D: (baza x, y, z w [0, 1), ranga), (promień [px], jasność, faza, slot) — dwa sloty po `count`.
 * @returns {{ data: Float32Array, count: number }}
 */
export function buildDust3DInstances(tune = SPACE_DUST_TUNE, seed = DUST_SEED ^ 0x3d3d3d) {
  const T = tune.free3d;
  const n = Math.max(0, T.count | 0);
  const rng = new FxRandom(seed);
  const data = new Float32Array(Math.max(1, 2 * n) * DUST_INSTANCE_STRIDE);
  let o = 0;
  for (let slot = 0; slot < DUST3D_SLOTS; slot++) {
    for (let i = 0; i < n; i++) {
      data[o] = rng.next();
      data[o + 1] = rng.next();
      data[o + 2] = rng.next();
      data[o + 3] = rng.next();
      const sz = rng.next();
      data[o + 4] = T.size[0] + (T.size[1] - T.size[0]) * sz * sz;
      data[o + 5] = T.bright[0] + (T.bright[1] - T.bright[0]) * Math.pow(rng.next(), 1.5);
      data[o + 6] = rng.next();
      data[o + 7] = slot;
      o += DUST_INSTANCE_STRIDE;
    }
  }
  return { data, count: 2 * n };
}

/**
 * Uniformy kamery 3D: `out` = Float32Array(dust3DUniformCount × 4). Stożki — writeDustPlumes(…, dust3DPlumeBase()).
 * view = { camX, camY, camZ — kamera w scenie (double), dist — odległość kamery od celu [j.], halfW, halfH [px],
 *          velX, velY, velZ — prędkość kamery w scenie [j/s], gridX, gridY, gridZ — kamera względem początku
 *          siatki świateł, time, vis, plumes }
 */
export function writeDust3DUniforms(tune, view, out) {
  const T = tune.free3d;
  const I = Math.max(0, Number(tune.intensity) || 0);
  const c = tune.color;
  out[0] = Math.max(1, finiteOr(view.halfW, 1)); out[1] = Math.max(1, finiteOr(view.halfH, 1));
  out[2] = finiteOr(view.time, 0) % 3600; out[3] = Math.max(0, tune.shutter);
  out[4] = Math.max(0, tune.streakMaxPx); out[5] = clamp01(tune.restAlpha); out[6] = tune.speedPx[0]; out[7] = Math.max(tune.speedPx[0] + 1e-3, tune.speedPx[1]);
  out[8] = finiteOr(view.gridX, 0); out[9] = finiteOr(view.gridY, 0); out[10] = finiteOr(view.gridZ, 0); out[11] = Math.max(0, Number(tune.lightGain) || 0);
  out[12] = c[0] * I; out[13] = c[1] * I; out[14] = c[2] * I; out[15] = tune.enabled === false ? 0 : clamp01(finiteOr(view.vis, 0));
  out[16] = finiteOr(view.velX, 0); out[17] = finiteOr(view.velY, 0); out[18] = finiteOr(view.velZ, 0); out[19] = finiteOr(view.camZ, 0);
  out[20] = Math.max(0, Math.min(DUST_PLUME_CAP, finiteOr(view.plumes, 0) | 0)); out[21] = Math.max(0.01, Number(T.nearClip) || 2);
  out[22] = Math.max(0.5, Number(T.sizeMax) || 3); out[23] = 0;
  const dist = Math.max(1, finiteOr(view.dist, 8000));
  const x = Math.log2(Math.max(1, T.boxMul * dist) / Math.max(1, T.C0));
  const k0 = Math.floor(x);
  const t = x - k0;
  const camX = finiteOr(view.camX, 0);
  const camY = finiteOr(view.camY, 0);
  const camZ = finiteOr(view.camZ, 0);
  for (let j = 0; j < 2; j++) {
    const k = k0 + j;
    const w = j === 0 ? 1 - t : t;
    const s = k & 1;
    const C = T.C0 * Math.pow(2, k);
    const o = (DUST3D_HEADER_VEC4 + s * DUST3D_SLOT_VEC4) * 4;
    const ox = camX / C;
    const oy = camY / C;
    const oz = camZ / C;
    out[o] = ox - Math.floor(ox);
    out[o + 1] = oy - Math.floor(oy);
    out[o + 2] = oz - Math.floor(oz);
    out[o + 3] = C;
    out[o + 4] = w;
    out[o + 5] = C * T.near[0];
    out[o + 6] = C * T.near[1];
    out[o + 7] = C * T.far[0];
    out[o + 8] = C * T.far[1];
    out[o + 9] = C * T.refDepth;
    out[o + 10] = 0;
    out[o + 11] = 0;
  }
  return out;
}

/**
 * Lustro CPU drobiny 3D: położenie WZGLĘDEM kamery (scena) i zanik (oktawa × odległość od kamery).
 */
export function dust3DMoteRel(u, inst, i, tune = SPACE_DUST_TUNE, out = { x: 0, y: 0, z: 0, fade: 0 }) {
  const a = i * DUST_INSTANCE_STRIDE;
  const s = inst[a + 7];
  const o = (DUST3D_HEADER_VEC4 + s * DUST3D_SLOT_VEC4) * 4;
  const C = u[o + 3];
  const fx = inst[a] - u[o] + 0.5;
  const fy = inst[a + 1] - u[o + 1] + 0.5;
  const fz = inst[a + 2] - u[o + 2] + 0.5;
  out.x = (fx - Math.floor(fx) - 0.5) * C;
  out.y = (fy - Math.floor(fy) - 0.5) * C;
  out.z = (fz - Math.floor(fz) - 0.5) * C;
  const band = Math.max(1e-3, tune.rankBand);
  const d = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  out.fade = clamp01((u[o + 4] * (1 + band) - inst[a + 3]) / band) * smooth(u[o + 5], u[o + 6], d) * (1 - smooth(u[o + 7], u[o + 8], d));
  return out;
}

/**
 * Prędkość kamery do smug — jedna na widok (podzielony ekran: dwa). Kamera z góry: świat gry (y w dół),
 * step(); kamera 3D: scena (x, y, z), step3(). Skok dłuższy niż `cut` na klatkę (teleport, zmiana trybu
 * kamery) to CIĘCIE: prędkość zerowana, bez smug.
 */
export class DustViewTracker {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.has = false;
  }

  reset() {
    this.has = false;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }

  /** x, y — kamera gry (świat), zoom, dt [s], viewW — szerokość kadru [px]. */
  step(x, y, zoom, dt, tune = SPACE_DUST_TUNE, viewW = 1920) {
    const cut = Math.max(1, tune.cutScreens) * Math.max(1, viewW) / Math.max(1e-4, Number(zoom) || 1);
    return this.step3(x, y, 0, dt, tune, cut);
  }

  /** x, y, z — położenie kamery, dt [s], cut — najdłuższy ruch na klatkę bez cięcia [j.]. */
  step3(x, y, z, dt, tune = SPACE_DUST_TUNE, cut = Infinity) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return this;
    if (!this.has) {
      this.x = x; this.y = y; this.z = z; this.has = true;
      return this;
    }
    const dx = x - this.x;
    const dy = y - this.y;
    const dz = z - this.z;
    this.x = x;
    this.y = y;
    this.z = z;
    if (!(dt > 0)) return this;
    const h = Math.min(0.25, Math.max(1e-3, dt));
    if (dx * dx + dy * dy + dz * dz > cut * cut) {
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      return this;
    }
    const a = 1 - Math.exp(-h / Math.max(1e-3, tune.velTau));
    this.vx += (dx / h - this.vx) * a;
    this.vy += (dy / h - this.vy) * a;
    this.vz += (dz / h - this.vz) * a;
    return this;
  }

  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }
}
