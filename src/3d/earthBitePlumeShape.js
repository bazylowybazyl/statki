// Słup konwekcyjny nad wielkim gryzem Ziemi — część CPU, bez three: wygląd (nastawy), wielkości pochodne z gryzu,
// bryła-pośrednik marszu promienia, wypiek szumu 3D i losowanie piorunów (fxRandom).
//
// Lore: odsłonięty płaszcz (~2 500 K) wypromieniowuje ~4·10¹⁸ W, więc nad otworem stoi wieczny słup konwekcyjny:
// pył i popiół wznoszą się z jeziora na dnie, wychodzą z otworu i rozlewają kowadłem w górnej atmosferze (z wiatrem),
// w kolumnie biją pioruny, od spodu słup świeci żarem dna. To OBRAZ (zasada żelazna 1).
//
// Układ: obiekt kuli Ziemi (R = 1, earthBiteShape.js). Oś słupa A = C (środek gryzu na powierzchni), z = x · A —
// wysokość wzdłuż osi od środka Ziemi: dno gryzu 1 − β ≈ 0,54, płaszczyzna brzegu otworu 1 − β²/2 ≈ 0,894, dawna
// powierzchnia w C — 1. Wiatr W (styczny w C, azymut w ramie gryzu: 0 — wschód, 90 — północ), w poprzek Bn = A × W.
// Kowadło: cienka powłoka nad kulą (wysokość h = |x| − 1), zasięg w kątach wzdłuż wiatru (u) i w poprzek (v).
import { earthBiteFrame } from './earthBiteShape.js';
import { EARTH_BITE } from '../data/earthBite.js';
import { FxRandom } from '../render/fxRandomCore.js';

const DEG = Math.PI / 180;

/**
 * Wygląd słupa (wartości domyślne; demo stroi kopię na żywo). Długości w R Ziemi, kąty w radianach, gęstości optyczne
 * na R drogi, czasy w sekundach zegara obrazu (doba Ziemi w grze ≈ 314 s).
 */
export const PLUME_DEFAULTS = Object.freeze({
  // kolumna: z dna (zBot) do szczytu (zTop); od zDome wierzch to poziomica szumu (kłęby); promień u dna / na brzegu
  // otworu / u szczytu; przechył z wiatrem u szczytu
  zBot: 0.565, zTop: 1.09, zDome: 0.99,
  rBot: 0.1, rRim: 0.16, rTop: 0.21,
  lean: 0.04,
  // kowadło: podstawa i szczyt nad kulą (u nasady), zasięg z wiatrem i pod wiatr, półszerokość u nasady, rozszerzanie
  hLo: 0.04, hHi: 0.075,
  lenDown: 0.75, lenUp: 0.3, halfWidth: 0.3, spread: 0.35,
  // wiatr górnej atmosfery (azymut w ramie gryzu: 0 — wschód, 90 — północ): ku południowemu zachodowi — przy obu
  // krawędziach tarczy kowadło wychodzi w bok, nie wzdłuż osi kamery
  windAzDeg: 240,
  // gęstości optyczne [1/R]: kolumna nad otworem, kolumna w głębi (gorący, rzadszy gaz), kowadło; erozja szumem
  sigmaCol: 60, sigmaLow: 9, sigmaAnvil: 35, erosion: 0.6,
  // światło: słońce, żar dna od spodu, niebo (zapylone), gorący gaz przy jeziorze
  sun: 1.2, glow: 1.6, ambient: 0.18, emit: 1.2,
  // ruch: wznoszenie [R/s], wypływ kowadła [rad/s], wir wokół osi [rad/s]; skala szumu [kafli na R]
  rise: 0.004, outflow: 0.006, swirl: 0.02, noiseScale: 3.2,
  // pioruny: błysków na sekundę, jasność szczytowa (HDR), promień poświaty [R]
  flashRate: 2.5, flashGain: 1.6, flashRadius: 0.022,
  timeScale: 1
});

/**
 * Warianty do A/B (decyzja użytkownika): `parasol` — szeroka kolumna i kowadło parasolem (domyślny), `smukly` —
 * wąska kolumna i warkocz z wiatrem (otwór gryzu widać wokół kolumny).
 */
export const PLUME_PRESETS = Object.freeze({
  parasol: Object.freeze({}),
  smukly: Object.freeze({ rBot: 0.07, rRim: 0.09, rTop: 0.115, lenDown: 0.6, lenUp: 0.08, halfWidth: 0.12, spread: 0.5, sigmaAnvil: 30 })
});

/** Kopia nastaw do strojenia (demo, harness). */
export function createPlumeLook(over = {}, preset = 'parasol') {
  return { ...PLUME_DEFAULTS, ...(PLUME_PRESETS[preset] || {}), ...over };
}

/**
 * Wielkości pochodne z gryzu i nastaw: oś A, wiatr W, w poprzek Bn (układ obiektu kuli), płaszczyzna brzegu zRim,
 * promień otworu aRim, dno zLake. b — promień bazowy gryzu (R).
 */
export function plumeFrame(look, b = EARTH_BITE.radiusR, bite = EARTH_BITE) {
  const { C, E, N } = earthBiteFrame(bite);
  const az = look.windAzDeg * DEG;
  const W = [Math.cos(az) * E[0] + Math.sin(az) * N[0], Math.cos(az) * E[1] + Math.sin(az) * N[1], Math.cos(az) * E[2] + Math.sin(az) * N[2]];
  const Bn = [C[1] * W[2] - C[2] * W[1], C[2] * W[0] - C[0] * W[2], C[0] * W[1] - C[1] * W[0]];
  return { A: C, E, N, W, Bn, zRim: 1 - b * b / 2, aRim: b * Math.sqrt(Math.max(0, 1 - b * b / 4)), zLake: 1 - b, b };
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const lin = (a, ka, b, kb) => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/**
 * Obwiednia słupa na kuli: kierunek środka czaszy D i jej promień kątowy (rad) — obejmuje kolumnę z przechyłem i ślad
 * kowadła (z zapasem `pad`). Kowadło sięga z wiatrem dalej niż pod wiatr, więc środek leży z wiatrem od C.
 */
export function plumeEnvelope(look, frame, pad = 0.04, erode = 1.32) {
  const { A, W, Bn } = frame;
  const pts = [];
  // ślad kowadła: brzeg elipsy (u, v) — u ∈ [−lenUp, lenDown], półszerokość rośnie z wiatrem
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    // erozja szumem wypycha brzeg kowadła do ~1,3 elipsy śladu
    const u = (Math.cos(a) >= 0 ? Math.cos(a) * look.lenDown : Math.cos(a) * look.lenUp) * erode;
    const v = Math.sin(a) * (look.halfWidth + look.spread * Math.max(u, 0)) * erode;
    const d = norm(lin(lin(A, Math.cos(u), W, Math.sin(u)), 1, Bn, Math.sin(v)));
    pts.push(d);
  }
  // kolumna: szczyt z przechyłem i promieniem
  const top = lin(A, look.zTop, W, look.lean);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(norm(lin(lin(top, 1, W, Math.cos(a) * look.rTop), 1, Bn, Math.sin(a) * look.rTop)));
  }
  const uMid = (look.lenDown - look.lenUp) / 2;
  const D = norm(lin(A, Math.cos(uMid), W, Math.sin(uMid)));
  let theta = 0;
  for (const p of pts) theta = Math.max(theta, angleBetween(D, p));
  return { D, theta: Math.min(theta + pad, 1.45) };
}

/**
 * Bryła-pośrednik marszu: wycinek kuli (stożek o wierzchołku w środku Ziemi, osi D i promieniu kątowym theta, między
 * rMin a rTop) — wypukła tam, gdzie widać (wewnętrzna czasza leży pod gruntem). Trójkąty zwrócone na zewnątrz
 * (ściany przednie = wejście promienia). Zwraca { position, index }.
 */
export function buildPlumeProxy(D, theta, rTop, { rMin = 0.5, rings = 20, segments = 96 } = {}) {
  const T1 = norm(Math.abs(D[1]) < 0.9 ? [D[2], 0, -D[0]] : [0, -D[2], D[1]]);
  const T2 = [D[1] * T1[2] - D[2] * T1[1], D[2] * T1[0] - D[0] * T1[2], D[0] * T1[1] - D[1] * T1[0]];
  const pos = [];
  const at = (r, th, ph) => {
    const s = Math.sin(th), c = Math.cos(th);
    const d = [c * D[0] + s * (Math.cos(ph) * T1[0] + Math.sin(ph) * T2[0]),
      c * D[1] + s * (Math.cos(ph) * T1[1] + Math.sin(ph) * T2[1]),
      c * D[2] + s * (Math.cos(ph) * T1[2] + Math.sin(ph) * T2[2])];
    pos.push(d[0] * r, d[1] * r, d[2] * r);
    return pos.length / 3 - 1;
  };
  // fasety czaszy leżą pod sferą rTop (cięciwy) — zapas, żeby obejmowały kulę rTop
  const rCap = rTop / Math.cos(Math.PI / segments);
  const grid = (r0, r1, th0, th1, nr) => {
    const rows = [];
    for (let i = 0; i <= nr; i++) {
      const f = i / nr;
      const row = [];
      for (let j = 0; j <= segments; j++) row.push(at(r0 + (r1 - r0) * f, th0 + (th1 - th0) * f, (j / segments) * Math.PI * 2));
      rows.push(row);
    }
    return rows;
  };
  const tris = [];
  const quads = (rows) => {
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = rows[i][j], b = rows[i + 1][j], c = rows[i + 1][j + 1], d = rows[i][j + 1];
        tris.push([a, b, c], [a, c, d]);
      }
    }
  };
  quads(grid(rCap, rCap, 0, theta, rings));              // czasza zewnętrzna
  quads(grid(rCap, rMin, theta, theta, 4));              // bok stożka
  quads(grid(rMin, rMin, theta, 0, 4));                  // czasza wewnętrzna (pod gruntem)
  // nawinięcie: normalna ściany od wnętrza bryły na zewnątrz (bryła wypukła poza czaszą wewnętrzną — tam od środka D)
  const inner = [D[0] * (rMin + rTop) * 0.5, D[1] * (rMin + rTop) * 0.5, D[2] * (rMin + rTop) * 0.5];
  const index = [];
  const P = (k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  for (const [a, b, c] of tris) {
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-20) continue;
    const m = [(pa[0] + pb[0] + pc[0]) / 3 - inner[0], (pa[1] + pb[1] + pc[1]) / 3 - inner[1], (pa[2] + pb[2] + pc[2]) / 3 - inner[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  }
  return { position: new Float32Array(pos), index: new Uint32Array(index) };
}

// ── Szum 3D (kafel powtarzalny, RGBA8): R/G/B — szum gradientowy o okresach 4/8/16 komórek kafla, A — kłęby (odwrotny
// Worley, okres 6). Wypiek raz (stałe ziarno, osobny generator — nie zużywa strumienia `fxRandom`).
export const PLUME_NOISE_SIZE = 64;

function gradientNoise(n, period, rng, out, channel) {
  const P = period;
  const g = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P; i++) {
    // kierunek losowy na sferze
    const z = rng.next() * 2 - 1, a = rng.next() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    g[i * 3] = s * Math.cos(a); g[i * 3 + 1] = s * Math.sin(a); g[i * 3 + 2] = z;
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const k = P / n;
  for (let z = 0; z < n; z++) {
    const sz = (z + 0.5) * k, iz = Math.floor(sz), fz = sz - iz, wz = fade(fz);
    for (let y = 0; y < n; y++) {
      const sy = (y + 0.5) * k, iy = Math.floor(sy), fy = sy - iy, wy = fade(fy);
      for (let x = 0; x < n; x++) {
        const sx = (x + 0.5) * k, ix = Math.floor(sx), fx = sx - ix, wx = fade(fx);
        let acc = 0;
        for (let c = 0; c < 8; c++) {
          const ox = c & 1, oy = (c >> 1) & 1, oz = c >> 2;
          const gi = (((iz + oz) % P) * P * P + ((iy + oy) % P) * P + ((ix + ox) % P)) * 3;
          const d = g[gi] * (fx - ox) + g[gi + 1] * (fy - oy) + g[gi + 2] * (fz - oz);
          acc += d * (ox ? wx : 1 - wx) * (oy ? wy : 1 - wy) * (oz ? wz : 1 - wz);
        }
        const v = Math.max(0, Math.min(1, 0.5 + acc * 1.1));
        out[((z * n + y) * n + x) * 4 + channel] = Math.round(v * 255);
      }
    }
  }
}

function worleyNoise(n, period, rng, out, channel) {
  const P = period;
  const f = new Float32Array(P * P * P * 3);
  for (let i = 0; i < f.length; i++) f[i] = rng.next();
  const k = P / n;
  for (let z = 0; z < n; z++) {
    const sz = (z + 0.5) * k, iz = Math.floor(sz);
    for (let y = 0; y < n; y++) {
      const sy = (y + 0.5) * k, iy = Math.floor(sy);
      for (let x = 0; x < n; x++) {
        const sx = (x + 0.5) * k, ix = Math.floor(sx);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const cx = ix + dx, cy = iy + dy, cz = iz + dz;
              const fi = ((((cz % P) + P) % P) * P * P + (((cy % P) + P) % P) * P + (((cx % P) + P) % P)) * 3;
              const px = cx + f[fi] - sx, py = cy + f[fi + 1] - sy, pz = cz + f[fi + 2] - sz;
              const d = px * px + py * py + pz * pz;
              if (d < best) best = d;
            }
          }
        }
        const v = 1 - Math.min(1, Math.sqrt(best) / 0.9);
        out[((z * n + y) * n + x) * 4 + channel] = Math.round(v * 255);
      }
    }
  }
}

/** Wypiek kafla szumu (Uint8Array n³ × 4). */
export function bakePlumeNoise(n = PLUME_NOISE_SIZE, seed = 0x51ab7e) {
  const rng = new FxRandom(seed);
  const out = new Uint8Array(n * n * n * 4);
  gradientNoise(n, 4, rng, out, 0);
  gradientNoise(n, 8, rng, out, 1);
  gradientNoise(n, 16, rng, out, 2);
  worleyNoise(n, 6, rng, out, 3);
  return out;
}

// ── Pioruny ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const PLUME_FLASH_SLOTS = 4;

/**
 * Losowanie błysków (proces Poissona, `rng` — fxRandom modułu renderu). Błysk: punkt w kolumnie (częściej) albo
 * w kowadle przy kolumnie, 1–4 wyładowania (impulsy ~40 ms) w ~0,1–0,5 s, poświata o promieniu flashRadius × 0,7–1,4.
 * `out` — Float32Array(4 × sloty): x, y, z (układ obiektu kuli), jasność; `outR` — promienie.
 */
export class PlumeLightning {
  constructor(rng) {
    this.rng = rng;
    this.slots = Array.from({ length: PLUME_FLASH_SLOTS }, () => ({ live: false, t0: 0, end: 0, pos: [0, 0, 0], peak: 0, rad: 0.03, n: 0, at: new Float32Array(4) }));
    this.time = 0;
  }

  /** Punkt błysku (kolumna z przechyłem albo kowadło przy kolumnie). */
  _place(look, frame, out) {
    const r = this.rng;
    const { A, W, Bn, zRim } = frame;
    if (r.next() < 0.72) {
      const z = zRim - 0.04 + r.next() * (look.zTop - 0.012 - zRim + 0.04);
      const s = Math.max(0, Math.min(1, (z - look.zBot) / (look.zTop - look.zBot)));
      const rad = (look.rRim + (look.rTop - look.rRim) * Math.max(0, (z - zRim) / (look.zTop - zRim))) * 0.62 * Math.sqrt(r.next());
      const a = r.next() * Math.PI * 2;
      const lean = s * s * look.lean;
      for (let k = 0; k < 3; k++) out[k] = A[k] * z + W[k] * (lean + Math.cos(a) * rad) + Bn[k] * Math.sin(a) * rad;
    } else {
      const u = r.next() * look.lenDown * 0.4;
      const v = (r.next() * 2 - 1) * (look.halfWidth + look.spread * u) * 0.5;
      const h = 1 + look.hLo + (look.hHi - look.hLo) * (0.25 + 0.5 * r.next());
      const d = norm(lin(lin(A, Math.cos(u), W, Math.sin(u)), 1, Bn, Math.sin(v)));
      for (let k = 0; k < 3; k++) out[k] = d[k] * h;
    }
    return out;
  }

  /** Nowy błysk w wolnym slocie (albo w najstarszym). Zwraca slot. */
  spawn(look, frame, time = this.time) {
    let s = this.slots.find((x) => !x.live);
    if (!s) s = this.slots.reduce((a, b) => (a.t0 <= b.t0 ? a : b));
    const r = this.rng;
    s.live = true;
    s.t0 = time;
    s.n = 1 + Math.floor(r.next() * r.next() * 4);
    for (let i = 0; i < 4; i++) s.at[i] = i < s.n ? (i === 0 ? 0 : s.at[i - 1] + 0.04 + r.next() * 0.12) : 1e9;
    s.end = time + s.at[s.n - 1] + 0.25;
    s.peak = look.flashGain * (0.45 + 0.55 * r.next());
    s.rad = look.flashRadius * (0.7 + 0.7 * r.next());
    this._place(look, frame, s.pos);
    return s;
  }

  /** Krok zegara obrazu; wypełnia out / outR (jasność 0 w wolnych slotach). */
  step(dt, look, frame, out, outR) {
    this.time += dt;
    const rate = Math.max(0, look.flashRate);
    if (dt > 0 && rate > 0 && this.rng.next() < 1 - Math.exp(-rate * dt)) this.spawn(look, frame);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      let e = 0;
      if (s.live) {
        const age = this.time - s.t0;
        if (this.time >= s.end) s.live = false;
        else {
          // impulsy wyładowań: szybki narost, zanik ~35 ms; między impulsami poświata kanału
          for (let k = 0; k < s.n; k++) {
            const a = age - s.at[k];
            if (a >= 0) e = Math.max(e, Math.exp(-a / 0.035) * (k === 0 ? 1 : 0.75));
          }
        }
      }
      out[i * 4] = s.pos[0]; out[i * 4 + 1] = s.pos[1]; out[i * 4 + 2] = s.pos[2];
      out[i * 4 + 3] = e * s.peak;
      outR[i] = s.rad;
    }
  }
}
