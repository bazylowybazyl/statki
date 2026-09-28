// src/game/asteroidGiants.js
//
// Olbrzymie asteroidy (bez typu rudy): bryły na tysiące–dziesiątki tysięcy
// jednostek z SZCZELINAMI (kaniony otwarte od góry, z nawisami — można się
// w nich schować), TUNELAMI (małe dla myśliwców, duże dla kapitałowców,
// ogromne), JASKINIAMI mieszczącymi flotę (z filarami i złożami) i przelotami
// na wylot. Takiej bryły nie da się opisać promieniem od środka (gwiaździście)
// jak zwykłych skał — opisuje ją POLE ODLEGŁOŚCI (SDF) w siatce wokseli:
// d < 0 w skale, d > 0 w próżni (także w tunelach).
//
// Układ olbrzyma: x, y jak w grze (y w dół), z do kamery; środek w (0, 0, 0).
// Płaszczyzna gry to z = 0 — tunele i kaniony przecinają ją z zapasem, więc
// przekrój z = 0 jest mapą przejść (kolizje 2D, przyszłe AI).
//
// Siatka: Uint8, wąskie pasmo ±BAND_VOXELS wokseli wokół powierzchni
// (wartość 128 = powierzchnia). Liczona najpierw zgrubnie (co 4 woksele),
// dokładnie tylko w komórkach przy powierzchni. Ta sama tablica idzie do GPU
// (tekstura 3D R8, raymarching w src/3d/asteroids/giants.js) i zostaje na CPU (kolizje,
// test „czy nad statkiem jest strop” dla przekroju widoku).
//
// Moduł bez three i DOM-u (worker: asteroidGiantWorker.js, testy:
// tests/asteroidGiants.test.mjs).

export const BAND_VOXELS = 6;

// ---------------------------------------------------------------------------
// Losowość i szum (deterministyczne)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_N = 64;
const NOISE_MASK = NOISE_N - 1;

/** Szum wartości 3D z tablicy 64³ (okresowy) — szybszy od haszowania. */
export class ValueNoise3 {
  constructor(seed) {
    const rng = mulberry32(seed ^ 0x3D5EED);
    this.t = new Float32Array(NOISE_N * NOISE_N * NOISE_N);
    for (let i = 0; i < this.t.length; i++) this.t[i] = rng();
  }

  noise(x, y, z) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    let tx = x - fx; let ty = y - fy; let tz = z - fz;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
    const x0 = fx & NOISE_MASK; const x1 = (x0 + 1) & NOISE_MASK;
    const y0 = (fy & NOISE_MASK) * NOISE_N; const y1 = (((fy + 1) & NOISE_MASK)) * NOISE_N;
    const z0 = (fz & NOISE_MASK) * NOISE_N * NOISE_N; const z1 = ((fz + 1) & NOISE_MASK) * NOISE_N * NOISE_N;
    const t = this.t;
    const a = t[z0 + y0 + x0]; const b = t[z0 + y0 + x1];
    const c = t[z0 + y1 + x0]; const d = t[z0 + y1 + x1];
    const e = t[z1 + y0 + x0]; const f = t[z1 + y0 + x1];
    const g = t[z1 + y1 + x0]; const h = t[z1 + y1 + x1];
    const ab = a + (b - a) * tx; const cd = c + (d - c) * tx;
    const ef = e + (f - e) * tx; const gh = g + (h - g) * tx;
    const lo = ab + (cd - ab) * ty; const hi = ef + (gh - ef) * ty;
    return lo + (hi - lo) * tz;
  }

  /** fbm [0, 1] (oktawy ×2,03, przesunięte). */
  fbm(x, y, z, oct) {
    let s = 0; let a = 0.5; let n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * this.noise(x, y, z);
      n += a;
      a *= 0.5;
      x = x * 2.03 + 17.3; y = y * 2.03 - 9.1; z = z * 2.03 + 5.7;
    }
    return s / n;
  }
}

function smin(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/**
 * „Poduszka”: elipsa w płaszczyźnie × płyta |z| < rz, brzeg zaokrąglony
 * promieniem `round` (jak zaokrąglony walec). Gruba aż do brzegu — tunel
 * o wysokości ~1/3 grubości ma strop prawie na całej długości (elipsoida
 * przy brzegu robiła się cienka i duży tunel przebijał ją na wylot w pionie).
 */
function sdPill(px, py, pz, rx, ry, rz, round) {
  // Math.sqrt zamiast Math.hypot: hypot w V8 jest wielokrotnie wolniejszy (gorąca ścieżka).
  const ux = px / rx; const uy = py / ry;
  const vx = ux / rx; const vy = uy / ry;
  const k0 = Math.sqrt(ux * ux + uy * uy);
  const k1 = Math.sqrt(vx * vx + vy * vy);
  const d2 = (k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry)) + round;
  const dz = Math.abs(pz) - rz + round;
  const ox = d2 > 0 ? d2 : 0;
  const oz = dz > 0 ? dz : 0;
  return Math.min(Math.max(d2, dz), 0) + Math.sqrt(ox * ox + oz * oz) - round;
}

/** SDF elipsoidy (przybliżenie Quíleza — dokładne przy powierzchni). */
function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const ux = px / rx; const uy = py / ry; const uz = pz / rz;
  const vx = ux / rx; const vy = uy / ry; const vz = uz / rz;
  const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const k1 = Math.sqrt(vx * vx + vy * vy + vz * vz);
  return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

// ---------------------------------------------------------------------------
// Plany olbrzymów

/**
 * Presety. size = połowy wymiarów bryły [j.], voxel = krok siatki [j.].
 * Szerokości tuneli [j.]: mały (myśliwce, korwety) ~800, duży (Atlas
 * 1800 × 806) ~1800–2400, ogromny 3500+.
 */
export const GIANT_PRESETS = Object.freeze({
  crevasse: Object.freeze({ id: 'crevasse', label: 'Szczelina', half: [9000, 6200, 3600], voxel: 64, desc: 'kanion z nawisami przez pół bryły, boczne szczeliny, komora na końcu' }),
  warren: Object.freeze({ id: 'warren', label: 'Labirynt', half: [15500, 12000, 4800], voxel: 96, desc: 'sieć tuneli trzech szerokości (myśliwce / kapitałowce / ogromne), komory na skrzyżowaniach' }),
  hollow: Object.freeze({ id: 'hollow', label: 'Pustka', half: [24500, 21500, 8200], voxel: 150, desc: 'wydrążona bryła: jaskinia na flotę z filarami i złożami kryształów, cztery wloty' }),
  spindle: Object.freeze({ id: 'spindle', label: 'Wrzeciono', half: [31000, 7600, 4800], voxel: 110, desc: 'wydłużona bryła z tunelem na wylot (60 tys. j.) i bocznymi odnogami' }),
  arch: Object.freeze({ id: 'arch', label: 'Łuk', half: [11500, 9500, 4600], voxel: 80, desc: 'podkowa z ogromnym przelotem pod łukiem i rysami' })
});

export const GIANT_PRESET_IDS = Object.freeze(Object.keys(GIANT_PRESETS));

/** Promień bryły (bez tuneli) w płaszczyźnie z = 0 w kierunku kąta — marsz od środka. */
function bodyRadiusAt(plan, noise, ang, maxR) {
  const cx = Math.cos(ang);
  const cy = Math.sin(ang);
  let lo = 0;
  let hi = maxR;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) * 0.5;
    if (bodySdf(plan, noise, cx * mid, cy * mid, 0) < 0) lo = mid; else hi = mid;
  }
  return lo;
}

function meander(rng, a, b, opts) {
  // Polilinia a → b z bocznym wężykiem (w płaszczyźnie) i lekkim falowaniem z.
  const pts = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(2, Math.ceil(len / (opts.step || 1800)));
  const amp = opts.wiggle ?? 0.12;
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;
  const f1 = 1 + rng() * 1.5;
  const f2 = 2.5 + rng() * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(Math.PI * t);
    const off = (Math.sin(t * Math.PI * f1 + ph1) * 0.7 + Math.sin(t * Math.PI * f2 + ph2) * 0.3) * amp * len * env;
    const r = a.r + (b.r - a.r) * t;
    const rv = r * (0.85 + 0.3 * rng());
    pts.push({
      x: a.x + dx * t + nx * off,
      y: a.y + dy * t + ny * off,
      z: (opts.z ?? 0) + Math.sin(t * Math.PI * 2 + ph2) * r * (opts.zWave ?? 0.12) * env,
      r: rv
    });
  }
  return pts;
}

/**
 * Plan bryły: części (płaty, pustki) i trasy — deterministyczny z (preset, seed).
 * Współrzędne względem środka olbrzyma.
 */
export function buildGiantPlan(presetId, seed = 1) {
  const preset = GIANT_PRESETS[presetId];
  if (!preset) throw new Error(`Nieznany olbrzym: ${presetId}`);
  const rng = mulberry32((seed * 0x9E3779B1) ^ presetId.length * 0x85EBCA6B);
  const [hx, hy, hz] = preset.half;
  const plan = {
    id: presetId, seed, label: preset.label, half: [hx, hy, hz], voxel: preset.voxel,
    // Garby miękkie tylko w dużej skali (małe amplitudy — dawniej „kluski”),
    // rzeźba z grzbietów (szum grzbietowy: ostre krawędzie) i ścięć płaszczyznami.
    lobes: [], craters: [], facets: [], facetK: Math.min(hx, hy) * 0.012,
    lumps: { a1: Math.min(hx, hy, hz) * 0.09, l1: Math.max(hx, hy) * 0.42, a2: Math.min(hx, hy, hz) * 0.04, l2: Math.max(hx, hy) * 0.1, a3: preset.voxel * 1.4, l3: preset.voxel * 10 },
    tunnels: [], caverns: [], canyons: [], deposits: [], routes: [], entrances: [], noiseSeed: (seed * 7919 + presetId.charCodeAt(0)) >>> 0
  };
  // Bryła: płaty (elipsoidy) — rozmiary z marginesem na garby (wszystko w pudle).
  const m = 0.78;
  if (presetId === 'spindle') {
    // Trzy płaty różnej grubości, lekko wygięte — odłam, nie wałek.
    const sizes = [0.3, 0.4, 0.3];
    const bend = (rng() - 0.5) * hy * 0.5;
    let x0 = -hx * 0.95;
    sizes.forEach((sz, i) => {
      const rx = hx * sz * 1.05;
      const cx = x0 + rx;
      x0 += rx * 1.8;
      plan.lobes.push({ x: cx, y: (i === 1 ? bend : -bend * 0.4) + (rng() - 0.5) * hy * 0.12, z: 0, rx, ry: hy * (0.55 + rng() * 0.2) * m, rz: hz * (0.64 + rng() * 0.12) * m, pill: true });
    });
  } else if (presetId === 'arch') {
    // Podkowa: trzy płaty w łuk (otwarcie na +y).
    plan.lobes.push({ x: -hx * 0.5, y: hy * 0.08, z: 0, rx: hx * 0.42 * m, ry: hy * 0.78 * m, rz: hz * 0.8 * m, pill: true });
    plan.lobes.push({ x: hx * 0.5, y: hy * 0.1, z: 0, rx: hx * 0.42 * m, ry: hy * 0.76 * m, rz: hz * 0.78 * m, pill: true });
    plan.lobes.push({ x: 0, y: -hy * 0.45, z: 0, rx: hx * 0.62 * m, ry: hy * 0.42 * m, rz: hz * 0.84 * m, pill: true });
  } else {
    plan.lobes.push({ x: 0, y: 0, z: 0, rx: hx * m, ry: hy * m, rz: hz * 0.9 * m, pill: true });
    const extra = presetId === 'hollow' ? 3 : 2;
    for (let i = 0; i < extra; i++) {
      const a = rng() * Math.PI * 2;
      plan.lobes.push({
        x: Math.cos(a) * hx * 0.38, y: Math.sin(a) * hy * 0.38, z: (rng() - 0.5) * hz * 0.2,
        rx: hx * (0.4 + rng() * 0.12), ry: hy * (0.4 + rng() * 0.12), rz: hz * (0.62 + rng() * 0.12)
      });
    }
  }
  plan.lobeK = Math.min(hx, hy) * 0.35;
  {
    // Zasięg bryły w osiach (do głębokości ścięć).
    let ex = 0; let ey = 0; let ez = 0;
    for (const L of plan.lobes) {
      ex = Math.max(ex, Math.abs(L.x) + L.rx);
      ey = Math.max(ey, Math.abs(L.y) + L.ry);
      ez = Math.max(ez, Math.abs(L.z) + L.rz);
    }
    const nF = presetId === 'spindle' ? 10 : (presetId === 'arch' ? 7 : 8);
    for (let i = 0; i < nF; i++) {
      // Głównie boczne (tną sylwetkę widzianą z góry), część skośnych z góry.
      const a = (i / nF) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const top = i % 3 === 2;
      const nz = (top ? 0.55 + rng() * 0.3 : (rng() - 0.5) * 0.5) * (rng() < 0.5 ? 1 : -1);
      const h = Math.sqrt(Math.max(0, 1 - nz * nz));
      const nx = Math.cos(a) * h;
      const ny = Math.sin(a) * h;
      const support = Math.sqrt((ex * nx) ** 2 + (ey * ny) ** 2 + (ez * nz) ** 2);
      const w = support * (top ? 0.86 + rng() * 0.08 : 0.74 + rng() * 0.16);
      plan.facets.push({ nx, ny, nz, w });
    }
    if (presetId === 'spindle') {
      // Dłuto na końcach: dwie skośne ściany na każdym czubku.
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const n = [sx * 0.82, sy * 0.45, (rng() - 0.5) * 0.35];
          const l = Math.hypot(...n);
          const [nx, ny, nz] = n.map((v) => v / l);
          plan.facets.push({ nx, ny, nz, w: Math.sqrt((ex * nx) ** 2 + (ey * ny) ** 2 + (ez * nz) ** 2) * (0.8 + rng() * 0.08) });
        }
      }
    }
  }
  // Wierzch bryły (głównego płata) — stropy jaskiń trzymamy poniżej z zapasem na garby.
  const bodyTop = plan.lobes[0].rz;
  const cavern = (x, y, rx, ry, rz, floorDepth) => {
    const rzc = Math.min(rz, (bodyTop * 0.6 + floorDepth) / 2);
    return { x, y, z: rzc - floorDepth, rx, ry, rz: rzc, pillars: [] };
  };
  // Kratery na wierzchu (widać je z góry).
  // Kratery: główna cecha planetoidy widzianej z daleka — kilkadziesiąt,
  // rozkład potęgowy (kilka dużych, dużo małych), świeże z jasnym wyrzutem.
  const nCr = 38 + Math.floor(rng() * 20);
  for (let i = 0; i < nCr; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.9;
    // Najmniejszy krater ≥ 3,5 woksela (mniejsze rozpadały się na siatce w kropki).
    const R = Math.max(preset.voxel * 3.5, Math.min(hx, hy) * (0.012 + 0.15 * Math.pow(rng(), 3.2)));
    plan.craters.push({ x: Math.cos(a) * hx * rr, y: Math.sin(a) * hy * rr, r: R, depth: R * (0.2 + rng() * 0.12), fresh: rng() });
  }
  plan.craters.sort((p, q) => q.r - p.r);
  const grooveMinW = preset.voxel * 4;
  // Bruzdy: rodziny równoległych rowków (jak na Fobosie) w części wierzchu.
  plan.grooves = [];
  const nG = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nG; i++) {
    const a = rng() * Math.PI;
    const ca = rng() * Math.PI * 2;
    plan.grooves.push({
      nx: Math.cos(a), ny: Math.sin(a),
      spacing: Math.min(hx, hy) * (0.075 + rng() * 0.05),
      width: 0,
      depth: plan.voxel * (1.4 + rng() * 1.0),
      cx: Math.cos(ca) * hx * 0.35, cy: Math.sin(ca) * hy * 0.35,
      reach: Math.min(hx, hy) * (0.45 + rng() * 0.3)
    });
    // Rowek szeroki na ≥ 4 woksele (węższy aliasował na siatce w rzędy kropek).
    const gr = plan.grooves[plan.grooves.length - 1];
    gr.width = Math.min(0.45, Math.max(0.22, grooveMinW / gr.spacing));
  }
  const noise = new ValueNoise3(plan.noiseSeed);
  const edgeAt = (ang) => bodyRadiusAt(plan, noise, ang, Math.hypot(hx, hy));
  const perim = (ang, extra = 0) => {
    const r = edgeAt(ang) + extra;
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  };

  if (presetId === 'crevasse') {
    // Główny kanion od zachodu w głąb, komora na końcu, dwie boczne szczeliny.
    const a0 = Math.PI + (rng() - 0.5) * 0.5;
    const start = perim(a0, 2500);
    const end = { x: hx * (0.25 + rng() * 0.15), y: (rng() - 0.5) * hy * 0.3 };
    const pts = meander(rng, { ...start, r: 1500 }, { ...end, r: 1100 }, { step: 1200, wiggle: 0.14 });
    plan.canyons.push({ pts, floor: -hz * 0.3, overhang: 0.5, top: hz });
    // Komory i jaskinie: płytkie dno (~1,2–1,5 tys. j. pod płaszczyzną gry — w zasięgu
    // świateł statku), wysoki strop (i tak zasłania go przekrój).
    plan.caverns.push(cavern(end.x, end.y, 2800, 2400, 2000, 1300));
    plan.entrances.push({ x: start.x, y: start.y, w: 3000 });
    for (let k = 0; k < 2; k++) {
      const mid = pts[Math.floor(pts.length * (0.3 + 0.35 * k))];
      const side = k === 0 ? 1 : -1;
      const bEnd = { x: mid.x + (rng() * 0.4 + 0.2) * hx * 0.5, y: mid.y + side * hy * (0.35 + rng() * 0.2), r: 380 };
      plan.canyons.push({ pts: meander(rng, { x: mid.x, y: mid.y, r: 650 }, bEnd, { step: 900, wiggle: 0.2 }), floor: -hz * 0.25, overhang: 0.35, top: hz });
    }
    // Krótki tunel pod stropem: z komory na drugą stronę (ukryty przelot).
    const exitA = -Math.PI * 0.15 + rng() * 0.3;
    const exit = perim(exitA, 2200);
    plan.tunnels.push({ pts: meander(rng, { x: end.x, y: end.y, r: 950 }, { ...exit, r: 1000 }, { step: 1500, wiggle: 0.1 }), vr: 0.75 });
    plan.routes.push({ label: 'kanion', pts: [...pts.map((p) => [p.x, p.y]), ...plan.tunnels[0].pts.map((p) => [p.x, p.y])] });
  } else if (presetId === 'warren') {
    // Węzły: wloty na obwodzie + komory w środku; krawędzie: drzewo + pętle.
    const WIDTH = [{ r: 420, label: 'mały' }, { r: 950, label: 'duży' }, { r: 1750, label: 'ogromny' }];
    const inner = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng() * 0.6;
      const rr = 0.18 + rng() * 0.32;
      inner.push({ x: Math.cos(a) * hx * rr, y: Math.sin(a) * hy * rr, r: 2200 + rng() * 1200 });
    }
    for (const n of inner) plan.caverns.push(cavern(n.x, n.y, n.r, n.r * (0.8 + rng() * 0.3), Math.min(n.r * 0.7, hz * 0.45), 1200));
    const outer = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      outer.push({ ...perim(a, 2200), a });
    }
    const edges = [];
    // Każdy wlot do najbliższej komory; komory w pierścień + jedna cięciwa.
    for (const o of outer) {
      let best = 0;
      for (let i = 1; i < inner.length; i++) if (Math.hypot(inner[i].x - o.x, inner[i].y - o.y) < Math.hypot(inner[best].x - o.x, inner[best].y - o.y)) best = i;
      edges.push([o, inner[best]]);
    }
    for (let i = 0; i < inner.length; i++) edges.push([inner[i], inner[(i + 1) % inner.length]]);
    edges.push([inner[0], inner[2]]);
    edges.forEach(([a, b], k) => {
      const w = WIDTH[k % 3 === 0 ? 2 : (k % 3 === 1 ? 1 : 0)];
      const ra = w.r * (0.9 + rng() * 0.2);
      const pts = meander(rng, { x: a.x, y: a.y, r: ra }, { x: b.x, y: b.y, r: ra * (0.85 + rng() * 0.3) }, { step: 1400, wiggle: 0.16 });
      // Duże tunele niższe (spłaszczony przekrój) — strop zostaje grubszy.
      plan.tunnels.push({ pts, vr: w.r > 1400 ? 0.6 : 0.72, width: w.label });
    });
    for (const o of outer) plan.entrances.push({ x: o.x, y: o.y, w: 2000 });
    // Trasa pokazowa: wlot 0 → komora → pierścień → wlot 3.
    const r0 = plan.tunnels[0].pts;
    plan.routes.push({ label: 'labirynt', pts: [...r0.map((p) => [p.x, p.y])] });
  } else if (presetId === 'hollow') {
    // Jaskinia na flotę: elipsoida z filarami, cztery wloty różnych szerokości.
    const cav = cavern(0, 0, hx * 0.52, hy * 0.5, hz * 0.36, 1500);
    plan.caverns.push(cav);
    const mouths = [{ r: 2800 }, { r: 1250 }, { r: 1150 }, { r: 520 }];
    mouths.forEach((mw, i) => {
      const a = (i / mouths.length) * Math.PI * 2 + 0.4 + (rng() - 0.5) * 0.6;
      const out = perim(a, 2600);
      const inn = { x: Math.cos(a) * cav.rx * 0.8, y: Math.sin(a) * cav.ry * 0.8 };
      plan.tunnels.push({ pts: meander(rng, { ...out, r: mw.r }, { ...inn, r: mw.r * 1.1 }, { step: 1800, wiggle: 0.08 }), vr: mw.r > 1400 ? 0.55 : 0.72 });
      plan.entrances.push({ x: out.x, y: out.y, w: mw.r * 2 });
    });
    // Filary: w jaskini, ale nie na drodze wlotów (tunel kończy się w 0,8 promienia).
    for (let tries = 0; tries < 40 && cav.pillars.length < 6; tries++) {
      const a = rng() * Math.PI * 2;
      const rr = 0.3 + rng() * 0.45;
      const p = { x: Math.cos(a) * cav.rx * rr, y: Math.sin(a) * cav.ry * rr, r: 900 + rng() * 1100 };
      const clear = plan.tunnels.every((t) => t.pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > q.r + p.r + 1500))
        && cav.pillars.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > o.r + p.r + 2500);
      if (clear) cav.pillars.push(p);
    }
    // Złoża: świecące kryształy na ścianach jaskini.
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2;
      // Przy dnie (widać je z góry przez przekrój) i nisko na ścianach.
      const zz = -cav.rz * (0.55 + rng() * 0.4);
      const k = Math.sqrt(Math.max(0.05, 1 - (zz / cav.rz) ** 2));
      const rr = rng() < 0.5 ? 0.97 : 0.3 + rng() * 0.6;
      plan.deposits.push({ x: Math.cos(a) * cav.rx * k * rr, y: Math.sin(a) * cav.ry * k * rr, z: cav.z + zz, r: 700 + rng() * 800, hue: rng() < 0.65 ? 0 : 1 });
    }
    const t0 = plan.tunnels[0].pts;
    plan.routes.push({ label: 'wlot', pts: [...t0.map((p) => [p.x, p.y]), [0, 0]] });
  } else if (presetId === 'spindle') {
    // Tunel na wylot wzdłuż osi + trzy boczne odnogi.
    const a = perim(Math.PI + (rng() - 0.5) * 0.2, 2600);
    const b = perim((rng() - 0.5) * 0.2, 2600);
    const main = meander(rng, { ...a, r: 1150 }, { ...b, r: 1150 }, { step: 2200, wiggle: 0.035, zWave: 0.1 });
    for (const p of main) p.r = 950 + rng() * 450;
    plan.tunnels.push({ pts: main, vr: 0.62 });
    plan.entrances.push({ x: a.x, y: a.y, w: 2400 }, { x: b.x, y: b.y, w: 2400 });
    for (let k = 0; k < 3; k++) {
      const p = main[Math.floor(main.length * (0.25 + 0.25 * k))];
      const side = k % 2 === 0 ? 1 : -1;
      const out = perim(side > 0 ? Math.PI / 2 + (rng() - 0.5) * 0.4 : -Math.PI / 2 + (rng() - 0.5) * 0.4, 2000);
      const ex = { x: p.x + (out.x - p.x) * 0.15, y: out.y };
      plan.tunnels.push({ pts: meander(rng, { x: p.x, y: p.y, r: 700 }, { ...ex, r: 600 }, { step: 1200, wiggle: 0.15 }), vr: 0.72 });
    }
    plan.caverns.push(cavern(main[Math.floor(main.length / 2)].x, main[Math.floor(main.length / 2)].y, 3600, 2600, 1900, 1200));
    plan.routes.push({ label: 'na wylot', pts: main.map((p) => [p.x, p.y]) });
  } else if (presetId === 'arch') {
    // Ogromny przelot pod łukiem (przez środek podkowy) i dwie rysy.
    const a = perim(-Math.PI / 2 + (rng() - 0.5) * 0.2, 3500);
    const b = { x: (rng() - 0.5) * hx * 0.2, y: hy * 0.9 };
    const pts = meander(rng, { ...a, r: 3000 }, { ...b, r: 3300 }, { step: 2500, wiggle: 0.05 });
    plan.tunnels.push({ pts, vr: 0.7 });
    plan.entrances.push({ x: a.x, y: a.y, w: 6000 });
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const s = perim(side < 0 ? Math.PI * 0.95 : Math.PI * 0.05, 1500);
      const e = { x: side * hx * 0.25, y: -hy * 0.15 };
      plan.canyons.push({ pts: meander(rng, { ...s, r: 600 }, { ...e, r: 350 }, { step: 900, wiggle: 0.18 }), floor: -hz * 0.25, overhang: 0.3, top: hz });
    }
    plan.routes.push({ label: 'pod łukiem', pts: pts.map((p) => [p.x, p.y]) });
  }
  // Przedłużenie tras poza bryłę (start i koniec w próżni) — autopilot dema.
  for (const route of plan.routes) {
    const p = route.pts;
    if (p.length >= 2) {
      const [x0, y0] = p[0]; const [x1, y1] = p[1];
      const l0 = Math.hypot(x0 - x1, y0 - y1) || 1;
      p.unshift([x0 + (x0 - x1) / l0 * 6000, y0 + (y0 - y1) / l0 * 6000]);
    }
  }
  plan.segmentGrid = buildSegmentGrid(plan);
  return plan;
}

// ---------------------------------------------------------------------------
// SDF

function bodySdf(plan, noise, x, y, z) {
  let d = Infinity;
  for (const L of plan.lobes) {
    const e = L.pill
      ? sdPill(x - L.x, y - L.y, z - L.z, L.rx, L.ry, L.rz, L.rz * 0.8)
      : sdEllipsoid(x - L.x, y - L.y, z - L.z, L.rx, L.ry, L.rz);
    d = d === Infinity ? e : smin(d, e, plan.lobeK);
  }
  const lm = plan.lumps;
  // Garby: duża skala, małe amplitudy (bryła nieregularna, nie „kluska”).
  d += (noise.fbm(x / lm.l1, y / lm.l1, z / lm.l1, 3) - 0.5) * 2 * lm.a1;
  d += (noise.fbm(x / lm.l2 + 31.7, y / lm.l2 - 12.2, z / lm.l2 + 5.1, 2) - 0.5) * 2 * lm.a2;
  // Ścięcia płaszczyznami pęknięć: płaskie ściany z ostrymi krawędziami.
  for (let i = 0; i < plan.facets.length; i++) {
    const f = plan.facets[i];
    d = smax(d, x * f.nx + y * f.ny + z * f.nz - f.w, plan.facetK);
  }
  // Drobne garby (zwykły szum — grzbietowy dawał sieć „robaków” jak gąbka).
  d += (noise.noise(x / lm.l3 + 3.3, y / lm.l3 - 8.1, z / lm.l3 + 2.2) - 0.5) * 2 * lm.a3;
  // Bruzdy na wierzchu: równoległe rowki w części bryły.
  if (z > 0 && plan.grooves) {
    for (let i = 0; i < plan.grooves.length; i++) {
      const gr = plan.grooves[i];
      const ex = x - gr.cx;
      const ey = y - gr.cy;
      const m = Math.exp(-(ex * ex + ey * ey) / (gr.reach * gr.reach));
      if (m < 0.05) continue;
      // Rowki poszarpane (przesunięcie szumem) i przerywane wzdłuż (łańcuchy).
      const t = (x * gr.nx + y * gr.ny) / gr.spacing + (noise.noise(x / 2200 + 9.1, y / 2200 - 4.4, 0.5) - 0.5) * 0.8;
      const along = noise.noise((y * gr.nx - x * gr.ny) / (gr.spacing * 1.6) + 2.7, t * 0.37, 7.9);
      if (along < 0.45) continue;
      const f = Math.abs(t - Math.floor(t) - 0.5) * 2;
      const u = Math.min(1, f / gr.width);
      // Gładki profil (cos): bez ostrych krawędzi, które siatka zamienia w schodki.
      d += gr.depth * 0.5 * (1 + Math.cos(Math.PI * u)) * m * Math.min(1, (along - 0.45) * 5);
    }
  }
  // Kratery na wierzchu: misa z ostrym wałem (tylko w obrysie krateru, nad płaszczyzną).
  if (z > 0) {
    for (let i = 0; i < plan.craters.length; i++) {
      const c = plan.craters[i];
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx > c.r * 1.4 || dx < -c.r * 1.4 || dy > c.r * 1.4 || dy < -c.r * 1.4) continue;
      const zc = plan.half[2] * 0.9 + c.r - c.depth;
      const dz = z - zc;
      const r2 = dx * dx + dy * dy;
      const dc = Math.sqrt(r2 + dz * dz) - c.r;
      d = smax(d, -dc, c.r * 0.07);
      const rho = Math.sqrt(r2) / c.r - 1.02;
      if (rho < 0.4 && rho > -0.4) d -= c.depth * 0.22 * Math.exp(-rho * rho / 0.02);
    }
  }
  return d;
}

function segDist3(px, py, pz, a, b, vr) {
  // Odległość do odcinka w przestrzeni ze ściśniętym z (przekrój eliptyczny).
  const ax = a.x; const ay = a.y; const az = a.z / vr;
  const bx = b.x - ax; const by = b.y - ay; const bz = b.z / vr - az;
  const qx = px - ax; const qy = py - ay; const qz = pz / vr - az;
  const ll = bx * bx + by * by + bz * bz;
  let t = ll > 0 ? (qx * bx + qy * by + qz * bz) / ll : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = qx - bx * t; const dy = qy - by * t; const dz = qz - bz * t;
  _seg.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  _seg.t = t;
  return _seg;
}
const _seg = { d: 0, t: 0 };

function segDist2(px, py, a, b) {
  const bx = b.x - a.x; const by = b.y - a.y;
  const qx = px - a.x; const qy = py - a.y;
  const ll = bx * bx + by * by;
  let t = ll > 0 ? (qx * bx + qy * by) / ll : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = qx - bx * t; const dy = qy - by * t;
  _seg.d = Math.sqrt(dx * dx + dy * dy);
  _seg.t = t;
  return _seg;
}

// Siatka kubełków odcinków (tunele, kaniony) — przy każdym wokselu tylko bliskie.
// Kubełek skaluje się z wokselem (drobny woksel = gęste kaniony = mniejsze kubełki).
function segCellOf(plan) {
  return Math.max(1024, Math.min(4096, plan.voxel * 24));
}

function buildSegmentGrid(plan) {
  const [hx, hy] = plan.half;
  const SEG_CELL = segCellOf(plan);
  const nx = Math.ceil((hx * 2 + SEG_CELL * 2) / SEG_CELL);
  const ny = Math.ceil((hy * 2 + SEG_CELL * 2) / SEG_CELL);
  const cells = Array.from({ length: nx * ny }, () => []);
  const add = (kind, owner, i, a, b, reach) => {
    const x0 = Math.floor((Math.min(a.x, b.x) - reach + hx + SEG_CELL) / SEG_CELL);
    const x1 = Math.floor((Math.max(a.x, b.x) + reach + hx + SEG_CELL) / SEG_CELL);
    const y0 = Math.floor((Math.min(a.y, b.y) - reach + hy + SEG_CELL) / SEG_CELL);
    const y1 = Math.floor((Math.max(a.y, b.y) + reach + hy + SEG_CELL) / SEG_CELL);
    for (let cy = Math.max(0, y0); cy <= Math.min(ny - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(nx - 1, x1); cx++) cells[cy * nx + cx].push({ kind, owner, i });
    }
  };
  // Zasięg: promień × 1,6 + pasmo zapisu (dalej wartość i tak jest obcięta).
  const bandW = BAND_VOXELS * plan.voxel * 2;
  plan.tunnels.forEach((t, ti) => {
    for (let i = 0; i + 1 < t.pts.length; i++) add(0, ti, i, t.pts[i], t.pts[i + 1], Math.max(t.pts[i].r, t.pts[i + 1].r) * 1.6 + bandW);
  });
  plan.canyons.forEach((c, ci) => {
    for (let i = 0; i + 1 < c.pts.length; i++) add(1, ci, i, c.pts[i], c.pts[i + 1], Math.max(c.pts[i].r, c.pts[i + 1].r) * 1.6 + bandW);
  });
  return { nx, ny, cells, cell: SEG_CELL };
}

/** Pustki (tunele, jaskinie, kaniony): d < 0 w próżni. */
function voidSdf(plan, noise, x, y, z) {
  let d = Infinity;
  const g = plan.segmentGrid;
  const [hx, hy] = plan.half;
  const SEG_CELL = g.cell;
  const cx = Math.floor((x + hx + SEG_CELL) / SEG_CELL);
  const cy = Math.floor((y + hy + SEG_CELL) / SEG_CELL);
  if (cx >= 0 && cy >= 0 && cx < g.nx && cy < g.ny) {
    const list = g.cells[cy * g.nx + cx];
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (e.kind === 0) {
        const t = plan.tunnels[e.owner];
        const a = t.pts[e.i]; const b = t.pts[e.i + 1];
        const s = segDist3(x, y, z, a, b, t.vr);
        const r = a.r + (b.r - a.r) * s.t;
        const dt = (s.d - r) * t.vr;
        if (dt < d) d = dt;
      } else {
        const c = plan.canyons[e.owner];
        const a = c.pts[e.i]; const b = c.pts[e.i + 1];
        const s = segDist2(x, y, a, b);
        const w = a.r + (b.r - a.r) * s.t;
        // Nawis: kanion węższy ku górze (osłania dno od kamery).
        const wz = w * (1 - c.overhang * Math.min(1, Math.max(0, z / c.top)));
        const dc = Math.max(s.d - wz, c.floor - z);
        if (dc < d) d = dc;
      }
    }
  }
  for (const cav of plan.caverns) {
    let dc = sdEllipsoid(x - cav.x, y - cav.y, z - cav.z, cav.rx, cav.ry, cav.rz);
    for (const p of cav.pillars) {
      // Filar: pionowy, rozszerzony przy dnie i stropie (zrasta się ze ścianą).
      const zz = (z - cav.z) / cav.rz;
      const pr = p.r * (1 + 0.9 * zz * zz);
      const px = x - p.x;
      const py = y - p.y;
      const dp = Math.sqrt(px * px + py * py) - pr;
      dc = smax(dc, -dp, p.r * 0.35);
    }
    // smin z Infinity daje NaN ((∞ − b) · 0) — pierwsza pustka wprost.
    d = d === Infinity ? dc : smin(d, dc, 900);
  }
  if (d === Infinity) return d;
  // Poszarpane ściany pustek.
  d += (noise.fbm(x / 520 + 7.7, y / 520 - 3.3, z / 520 + 1.9, 2) - 0.5) * 2 * Math.min(420, plan.voxel * 3);
  return d;
}

/** Pole odległości olbrzyma [j.] w punkcie (x, y, z) względem środka: < 0 = skała. */
export function giantSdf(plan, noise, x, y, z) {
  const b = bodySdf(plan, noise, x, y, z);
  if (b > BAND_VOXELS * plan.voxel * 3) return b;
  const v = voidSdf(plan, noise, x, y, z);
  if (v === Infinity) return b;
  return smax(b, -v, plan.voxel * 2.5);
}

// ---------------------------------------------------------------------------
// Siatka wokseli

/** Wymiary siatki: pudło = połowy × 2 + zapas na garby i wyloty. */
export function giantGridDims(plan) {
  const v = plan.voxel;
  const pad = v * (BAND_VOXELS + 2);
  const ext = [plan.half[0] + pad, plan.half[1] + pad, plan.half[2] + pad];
  return { nx: Math.ceil(ext[0] * 2 / v) + 1, ny: Math.ceil(ext[1] * 2 / v) + 1, nz: Math.ceil(ext[2] * 2 / v) + 1, ext };
}

/**
 * Wypełnia siatkę (Uint8, 128 = powierzchnia, ±BAND_VOXELS wokseli na zakres)
 * dla plastrów z ∈ [z0, z1). Zgrubnie co 4 woksele; dokładnie tylko komórki
 * przy powierzchni. `kOffset` = indeks pierwszego plastra w `grid` (worker
 * liczy tylko swój kawałek). Zwraca liczbę dokładnych obliczeń.
 */
export function fillGiantGrid(plan, grid, dims, z0 = 0, z1 = dims.nz, kOffset = 0) {
  const noise = new ValueNoise3(plan.noiseSeed);
  const { nx, ny, nz, ext } = dims;
  const v = plan.voxel;
  const band = BAND_VOXELS * v;
  const C = 4;
  const scale = 127 / band;
  const enc = (d) => {
    const q = Math.round(128 + d * scale);
    return q < 1 ? 1 : (q > 255 ? 255 : q);
  };
  const X = (i) => -ext[0] + i * v;
  const Y = (j) => -ext[1] + j * v;
  const Z = (k) => -ext[2] + k * v;
  let exact = 0;
  // Margines zgrubnej decyzji: przekątna komórki × 1,5 (garby łamią Lipschitza) + pasmo.
  const margin = C * v * Math.sqrt(3) * 1.5 + band;
  const ccx = Math.ceil((nx - 1) / C) + 1;
  const ccy = Math.ceil((ny - 1) / C) + 1;
  const cz0 = Math.floor(z0 / C);
  const cz1 = Math.max(cz0 + 1, Math.ceil((z1 - 1) / C));
  const coarse = new Float32Array(ccx * ccy * (cz1 - cz0 + 1));
  for (let kz = cz0; kz <= cz1; kz++) {
    const z = Z(Math.min(nz - 1, kz * C));
    for (let ky = 0; ky < ccy; ky++) {
      const y = Y(Math.min(ny - 1, ky * C));
      for (let kx = 0; kx < ccx; kx++) {
        coarse[((kz - cz0) * ccy + ky) * ccx + kx] = giantSdf(plan, noise, X(Math.min(nx - 1, kx * C)), y, z);
      }
    }
  }
  const cAt = (kx, ky, kz) => coarse[((kz - cz0) * ccy + ky) * ccx + kx];
  for (let kz = cz0; kz < cz1; kz++) {
    for (let ky = 0; ky < ccy - 1; ky++) {
      for (let kx = 0; kx < ccx - 1; kx++) {
        let mn = Infinity; let mx = -Infinity;
        for (let c = 0; c < 8; c++) {
          const val = cAt(kx + (c & 1), ky + ((c >> 1) & 1), kz + ((c >> 2) & 1));
          if (val < mn) mn = val;
          if (val > mx) mx = val;
        }
        // Ostatnia komórka w każdej osi sięga do końca siatki (inaczej przy
        // (n − 1) podzielnym przez C gubiła ostatnią kolumnę / plaster).
        const i0 = kx * C; const j0 = ky * C; const k0 = Math.max(z0, kz * C);
        const i1 = kx === ccx - 2 ? nx : Math.min(nx, i0 + C);
        const j1 = ky === ccy - 2 ? ny : Math.min(ny, j0 + C);
        const k1 = kz === cz1 - 1 ? z1 : Math.min(z1, kz * C + C);
        if (mn > margin || mx < -margin) {
          const q = mn > margin ? 255 : 1;
          for (let k = k0; k < k1; k++) {
            for (let j = j0; j < j1; j++) grid.fill(q, ((k - kOffset) * ny + j) * nx + i0, ((k - kOffset) * ny + j) * nx + i1);
          }
          continue;
        }
        for (let k = k0; k < k1; k++) {
          const z = Z(k);
          for (let j = j0; j < j1; j++) {
            const y = Y(j);
            const row = ((k - kOffset) * ny + j) * nx;
            for (let i = i0; i < i1; i++) grid[row + i] = enc(giantSdf(plan, noise, X(i), y, z));
          }
        }
        exact += (k1 - k0) * (j1 - j0) * (i1 - i0);
      }
    }
  }
  return exact;
}

// ---------------------------------------------------------------------------
// Zapytania (CPU)

/**
 * Olbrzym w świecie gry: plan + siatka. x, y = środek w świecie.
 */
export class GiantRock {
  constructor(plan, x, y, grid = null) {
    this.plan = plan;
    this.x = x;
    this.y = y;
    this.dims = giantGridDims(plan);
    this.grid = grid || new Uint8Array(this.dims.nx * this.dims.ny * this.dims.nz);
    this.ready = !!grid;
    this.band = BAND_VOXELS * plan.voxel;
    // Promień obrysu (do szybkiego odrzucania).
    this.radius = Math.hypot(plan.half[0], plan.half[1]) + plan.voxel * 4;
  }

  /** SDF w punkcie lokalnym (trilinearnie z siatki); poza pudłem = pasmo. */
  sampleLocal(x, y, z) {
    const { nx, ny, nz, ext } = this.dims;
    const v = this.plan.voxel;
    const fx = (x + ext[0]) / v; const fy = (y + ext[1]) / v; const fz = (z + ext[2]) / v;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return this.band;
    const i = Math.min(nx - 2, Math.floor(fx)); const j = Math.min(ny - 2, Math.floor(fy)); const k = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - i; const ty = fy - j; const tz = fz - k;
    const g = this.grid;
    const o = (k * ny + j) * nx + i;
    const sx = 1; const sy = nx; const sz = nx * ny;
    const c00 = g[o] + (g[o + sx] - g[o]) * tx;
    const c10 = g[o + sy] + (g[o + sy + sx] - g[o + sy]) * tx;
    const c01 = g[o + sz] + (g[o + sz + sx] - g[o + sz]) * tx;
    const c11 = g[o + sz + sy] + (g[o + sz + sy + sx] - g[o + sz + sy]) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    return (c0 + (c1 - c0) * tz - 128) * this.band / 127;
  }

  /** SDF w punkcie świata gry na płaszczyźnie z. */
  sampleWorld(wx, wy, z = 0) {
    return this.sampleLocal(wx - this.x, wy - this.y, z);
  }

  /**
   * Kolizja koła (świat gry, płaszczyzna z = 0): { depth, nx, ny } albo null.
   * depth > 0 = wbicie; normalna w stronę próżni.
   */
  collideCircle(wx, wy, r, out = { depth: 0, nx: 0, ny: 0 }) {
    if (!this.ready) return null;
    const lx = wx - this.x; const ly = wy - this.y;
    if (Math.abs(lx) > this.plan.half[0] + r + this.band || Math.abs(ly) > this.plan.half[1] + r + this.band) return null;
    const d = this.sampleLocal(lx, ly, 0);
    if (d >= r) return null;
    const e = this.plan.voxel;
    const gx = this.sampleLocal(lx + e, ly, 0) - this.sampleLocal(lx - e, ly, 0);
    const gy = this.sampleLocal(lx, ly + e, 0) - this.sampleLocal(lx, ly - e, 0);
    const gl = Math.hypot(gx, gy) || 1;
    out.depth = r - d;
    out.nx = gx / gl;
    out.ny = gy / gl;
    return out;
  }

  /** Czy nad punktem (świat gry) jest skała między zFrom a zTo (strop nad tunelem). */
  solidAbove(wx, wy, zFrom = 250, zTo = null) {
    if (!this.ready) return false;
    const lx = wx - this.x; const ly = wy - this.y;
    if (Math.abs(lx) > this.plan.half[0] + this.band || Math.abs(ly) > this.plan.half[1] + this.band) return false;
    const top = zTo ?? this.plan.half[2] + this.band;
    const step = this.plan.voxel * 2;
    for (let z = zFrom; z <= top; z += step) if (this.sampleLocal(lx, ly, z) < 0) return true;
    return false;
  }

  /** Czy punkt świata gry leży w obrysie olbrzyma (pudło, z zapasem). */
  containsWorld(wx, wy, pad = 0) {
    return Math.abs(wx - this.x) < this.plan.half[0] + pad && Math.abs(wy - this.y) < this.plan.half[1] + pad;
  }
}

/** Plan + siatka w jednym wywołaniu (demo bez workera, testy). */
export function generateGiant(presetId, seed, x = 0, y = 0) {
  const plan = buildGiantPlan(presetId, seed);
  const giant = new GiantRock(plan, x, y);
  fillGiantGrid(plan, giant.grid, giant.dims);
  giant.ready = true;
  return giant;
}
