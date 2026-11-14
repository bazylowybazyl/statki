// src/game/hullDesign/hullDesignTowers.js
//
// KREATOR KADŁUBÓW — GENERATOR WIEŻOWCÓW miasta na grzbiecie okrętu (temat 3; czysty: bez three i DOM; niewpięty).
// Opis i decyzje: docs/OPIS-miasto-3d.md. Masyw (gdzie stoją budynki, jak wysokie) liczy hullDesignCity.js, obraz —
// src/3d/hullCity3D/. Test: tests/hullDesignTowers.test.mjs.
//
// Jeden BUDYNEK = stos BRYŁ z gramatyki rodziny (cokół, płyty z uskokami, trzon, tarasy, skrzydła, łącznik, korona,
// maszty, detal dachu), sterowanej klasą wielkości (rzut i wysokość) i ziarnem. Bryła to graniastosłup ośmiokątny osiowy:
//   { x, y, hw, hh, z0, z1, ch, bat, mat, tone } — środek i pół-wymiary rzutu podstawy [j.], podłoga i wierzch [j.],
//   faza narożników 45° (styl Terra Novy), POCHYLENIE ścian (wcięcie wierzchu względem podstawy, każda ściana tyle samo
//   — skos jest widoczny z kamery ortho prosto z góry), materiał (HD_TOWER_MAT), ton (mnożnik jasności).
// Bryły budynku nie wychodzą poza jego rzut (masyw sprawdza tylko rzuty) i nie przenikają się w poziomie (płyta wyżej
// stoi na płycie niżej). Wymiary w j. świata (1 j. ≈ 1 m, piętro ~4 j.).
//
// ŚWIATŁA: tylko na ŚCIANACH — rzędy okien wzdłuż pięter (rzadkie, w grupach), szczeliny między płytami (wnęka nad
// tarasem — rząd przy stopie wyższej płyty), podstawa ściany w kanionie, lampy przy wierzchu masztu (na boku masztu).
// Nigdy na dachu: światło leży tuż przed płaszczyzną ściany (z jej normalną), w pasie wysokości ściany poniżej górnej
// krawędzi. Rekord: { x, y, z, nx, ny, nz (normalna — kierunek świecenia; 0, 0, 0 — we wszystkie strony), k (rodzaj
// HD_TOWER_LIGHT), s (rozmiar [j.]), i (jasność 0–1), c (barwa: 0 niebieska, 1 biała, 2 ciepła, 3 czerwona) }.
// Okno na pionowej ścianie świeci w bok — z góry go nie widać (obraz gasi je z kątem patrzenia); szczelina i podstawa
// mają normalną z odchyleniem ku górze, więc świecą też z góry.
//
// SYMETRIA: budynek na osi okrętu (`sym: true`, y = 0) wychodzi w lustrze y (wszystkie wybory po stronie ±y te same).
// Budynki burt masyw generuje dla y < 0 i odbija (`mirrorTower`).

/** Materiały brył (obraz: src/3d/hullCity3D/hullCity3D.tsl.js). */
export const HD_TOWER_MAT = Object.freeze({ podium: 0, wall: 1, plate: 2, recess: 3, roof: 4, mast: 5, crown: 6, hall: 7 });

/** Rodzaje świateł. */
export const HD_TOWER_LIGHT = Object.freeze({ window: 0, seam: 1, base: 2, beacon: 3 });

/**
 * Rodziny budynków (spójne stylem: fazowane narożniki 45°, ciemne płyty, uskoki):
 *  slab    — PŁYTA-BLOK: szeroka niska bryła z 1–3 płyt na uskokach, szczeliny między płytami, maszyny na dachu;
 *  stepped — WIEŻA Z USKOKAMI: cokół, trzon, 2–3 uskoki zwężające się ku górze, korona, maszt;
 *  twin    — BLIŹNIACZE WIEŻE na końcach dłuższego boku cokołu, łącznik (jeden albo dwa) między nimi;
 *  wedge   — KLIN: tarasy schodzące ku jednej stronie (ku ścianie rowu albo wzdłuż osi), pochylone fronty;
 *  hall    — HALA: długa niska bryła z mocno pochylonymi bokami (dach dwuspadowy z dwóch płyt), szczelina przy okapie;
 *  spire   — IGLICA: smukły ośmiokątny trzon z tarasami, kołnierz korony, długi maszt (dominanta).
 */
export const HD_TOWER_FAMILIES = Object.freeze(['slab', 'stepped', 'twin', 'wedge', 'hall', 'spire']);

/** Strojenie (j. świata). */
export const HD_TOWER_TUNE = Object.freeze({
  floorH: 4,          // wysokość piętra
  lightOff: 0.45,     // światło przed płaszczyzną ściany
  topEdge: 1.4,       // bez świateł tuż pod górną krawędzią ściany (parapet dachu)
  minSide: 1.5,       // najmniejsza pół-szerokość bryły
  minH: 1.2,          // najniższa bryła
  windowFill: 0.16,   // udział zapalonych okien (× gęstość świateł)
  seamFill: 0.55,     // udział zapalonych miejsc w szczelinach
  baseFill: 0.32,     // udział zapalonych lamp u podstawy
  maxLights: 900      // na budynek
});

// ── POMOCNIKI ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hasz całkowity → [0, 1). */
export function towerHash(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Generator liczb z ziarna (mulberry32). */
function rng(seed) {
  let s = (seed | 0) ^ 0x6d2b79f5;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.chance = (p) => next() < p;
  return next;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
/** Zaokrąglenie w lustrze względem c (Math.round(−2,5) ≠ −Math.round(2,5)). */
const r2s = (v, c) => { const d = v - c; return c + Math.sign(d) * (Math.round(Math.abs(d) * 100) / 100); };

/**
 * Klasa wielkości budynku z rzutu i wysokości: 0 — mały (krótszy bok < 24 j. albo wysokość < 16), 1 — średni,
 * 2 — duży (krótszy bok ≥ 60 albo wysokość ≥ 70), 3 — wielki (≥ 120 / ≥ 140).
 */
export function towerSizeClass(hw, hh, H) {
  const s = 2 * Math.min(hw, hh);
  if (s >= 120 || H >= 140) return 3;
  if (s >= 60 || H >= 70) return 2;
  if (s >= 24 && H >= 16) return 1;
  return 0;
}

/** Pół-wymiar rzutu bryły na wysokości z (ściany pochylone: wcięcie liniowe od podłogi do wierzchu). */
export function boxHalfAt(b, z) {
  const t = b.z1 > b.z0 ? clamp((z - b.z0) / (b.z1 - b.z0), 0, 1) : 0;
  const d = b.bat * t;
  return { hw: b.hw - d, hh: b.hh - d, ch: Math.max(0, b.ch - d * (2 - Math.SQRT2)) };
}

/** Czy punkt leży wewnątrz bryły (z luzem `pad` — dodatni = bryła powiększona). */
export function pointInBox(b, x, y, z, pad = 0) {
  if (z < b.z0 - pad || z > b.z1 + pad) return false;
  const q = boxHalfAt(b, z);
  const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y);
  const hw = q.hw + pad, hh = q.hh + pad;
  if (ax > hw || ay > hh) return false;
  if (q.ch > 0 && ax + ay > hw + hh - q.ch * 1.0 + pad * (Math.SQRT2 - 1)) return false;
  return true;
}

// ── BUDOWNICZY ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stan budowy jednego budynku: bryły i światła w układzie okrętu, z przycięciem do rzutu budynku.
 * Lokalny układ rodziny: u — wzdłuż dłuższego boku, v — w poprzek (oś `axis`: 'x' — u = x, 'y' — u = y).
 */
function builder(spec) {
  const T = HD_TOWER_TUNE;
  const boxes = [];
  const lights = [];
  const axisX = spec.axis === 'x';
  const L = axisX ? spec.hw : spec.hh;           // pół-długość (u)
  const W = axisX ? spec.hh : spec.hw;           // pół-szerokość (v)
  const sym = !!spec.sym;
  const lightK = spec.lights ?? 1;
  const tone0 = spec.tone ?? 1;
  const seed = spec.seed | 0;
  const toWorld = (u, v) => (axisX ? [spec.x + u, spec.y + v] : [spec.x + v, spec.y + u]);
  const half = (hu, hv) => (axisX ? [hu, hv] : [hv, hu]);

  /** Bryła w układzie lokalnym (środek u, v, pół-wymiary hu, hv). Zwraca rekord albo null (za mała). */
  function box(u, v, hu, hv, z0, z1, o = {}) {
    // przycięcie do rzutu budynku
    const u0 = Math.max(-L, u - hu), u1 = Math.min(L, u + hu);
    const v0 = Math.max(-W, v - hv), v1 = Math.min(W, v + hv);
    hu = (u1 - u0) / 2; hv = (v1 - v0) / 2; u = (u0 + u1) / 2; v = (v0 + v1) / 2;
    const minSide = o.minSide ?? T.minSide;
    if (hu < minSide || hv < minSide || z1 - z0 < (o.minH ?? T.minH)) return null;
    const [x, y] = toWorld(u, v);
    const [hw, hh] = half(hu, hv);
    const mn = Math.min(hw, hh);
    const ch = clamp(o.ch ?? 0, 0, mn * 0.7);
    // pochylenie: nie więcej niż pozwala wierzch (zostaje ≥ minSide)
    const bat = clamp(o.bat ?? 0, 0, Math.max(0, mn - minSide));
    const b = {
      x: r2(x), y: sym ? (Math.abs(y - spec.y) < 0.02 ? spec.y : r2s(y, spec.y)) : r2(y), hw: r2(hw), hh: r2(hh), z0: r2(z0), z1: r2(z1),
      ch: r2(ch), bat: r2(bat), mat: o.mat ?? HD_TOWER_MAT.wall, tone: r2(clamp((o.tone ?? 1) * tone0, 0.5, 1.6))
    };
    boxes.push(b);
    return b;
  }
  /** Bryła i — w budynku `sym` poza osią — jej odbicie w y (świat). Zwraca pierwszą. */
  function boxSym(u, v, hu, hv, z0, z1, o = {}) {
    const b = box(u, v, hu, hv, z0, z1, o);
    if (b && sym && Math.abs(b.y - spec.y) > 0.01) boxes.push({ ...b, y: r2(2 * spec.y - b.y) });
    return b;
  }
  /** Klucz bryły do hasza świateł: z położenia (w `sym` — od osi), nie z kolejności — lustro ma te same okna. */
  const boxKey = (b) => Math.floor(towerHash(Math.round(b.x * 4), Math.round((sym ? Math.abs(b.y - spec.y) : b.y) * 4), Math.round(b.z0 * 4)) * 1e6);

  // Światło przed ścianą bryły b: strona (sx, sy) ∈ {(±1, 0), (0, ±1)}, położenie wzdłuż ściany `a` (od środka ściany),
  // wysokość z. Normalna: pochylenie ściany + `up` (składowa ku górze dla szczelin i podstawy).
  function wallLight(b, sx, sy, a, z, k, o = {}) {
    const q = boxHalfAt(b, z);
    const H = Math.max(1e-3, b.z1 - b.z0);
    let nx = sx * H, ny = sy * H, nz = b.bat;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const up = o.up ?? 0;
    let lx = nx * (1 - up), ly = ny * (1 - up), lz = nz * (1 - up) + up;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const off = T.lightOff + (o.off ?? 0);
    const px = sx !== 0 ? b.x + sx * q.hw + nx * off : b.x + a + nx * off;
    const py = sy !== 0 ? b.y + sy * q.hh + ny * off : b.y + a + ny * off;
    lights.push({
      x: r2(px), y: sym ? r2s(py, spec.y) : r2(py), z: r2(z + nz * off), nx: r2(lx), ny: sym ? r2s(ly, 0) : r2(ly), nz: r2(lz),
      k, s: r2(o.s ?? 1), i: r2(clamp(o.i ?? 1, 0, 1)), c: o.c ?? 0
    });
  }
  /** Klucz strony do hasza — w budynku `sym` ściany ±y dzielą klucz (lustro). */
  const sideKey = (sx, sy) => (sx !== 0 ? (sx > 0 ? 1 : 2) : (sym ? 3 : (sy > 0 ? 3 : 4)));
  /**
   * Indeks miejsca c z n + 1 wzdłuż ściany do hasza: w `sym` na ścianach ±x (wzdłuż y) liczony w lustrze — bryła na osi
   * od środka ściany, bryła z pary od strony osi — te same okna po obu stronach (całkowite, bez błędów zaokrągleń).
   */
  const alongKey = (b, sx, c, n) => {
    if (!sym || sx === 0) return c + 4096;
    if (Math.abs(b.y - spec.y) < 0.01) return Math.abs(2 * c - n);
    return b.y < spec.y ? c + 8192 : n - c + 8192;
  };
  // Ściany do świateł: tylko osiowe (fazy zostają ciemne — narożnik bez okien czyta się jako krawędź).
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /** Rzędy okien na ścianach bryły: piętra co `rows` pięter, grupy zapalonych okien (hasz piętra i grupy). */
  function windows(b, o = {}) {
    if (lightK <= 0) return;
    const fill = (o.fill ?? T.windowFill) * lightK;
    const pitch = o.pitch ?? 4.2;
    const step = T.floorH * (o.rows ?? 1);
    const bi = boxKey(b);
    for (const [sx, sy] of SIDES) {
      if (o.skip && o.skip(sx, sy)) continue;
      const sk = sideKey(sx, sy);
      for (let z = b.z0 + T.floorH * 0.7, f = 0; z < b.z1 - T.topEdge; z += step, f++) {
        const q = boxHalfAt(b, z);
        const len = (sx !== 0 ? q.hh : q.hw) - q.ch - 1.2;
        if (len < pitch * 0.5) continue;
        const n = Math.floor(len * 2 / pitch);
        for (let c = 0; c <= n; c++) {
          const a = (c + 0.5 - (n + 1) / 2) * (2 * len / (n + 1));   // w lustrze dokładnie (połówki)
          const ak = alongKey(b, sx, c, n);
          const grp = Math.floor(ak / 6);
          const hg = towerHash(seed + bi * 131, f * 7 + sk, grp);
          if (hg > fill * 2.2) continue;                              // grupa zgaszona
          if (towerHash(seed + bi * 131 + 7, f * 7 + sk, ak) > 0.62) continue;
          const tone = towerHash(seed, bi, f * 13 + grp);
          wallLight(b, sx, sy, a, z, HD_TOWER_LIGHT.window, { s: 0.9, i: 0.45 + 0.55 * tone, c: tone > 0.93 ? 2 : tone > 0.7 ? 1 : 0 });
        }
      }
    }
  }
  /** Rząd świateł na wysokości z wzdłuż ścian bryły (szczelina albo podstawa). */
  function lightRow(b, z, k, o = {}) {
    if (lightK <= 0) return;
    const fill = clamp((o.fill ?? T.seamFill) * lightK, 0, 1);
    const pitch = o.pitch ?? 3.2;
    const bi = boxKey(b);
    if (z <= b.z0 || z >= b.z1 - 0.3) return;
    for (const [sx, sy] of SIDES) {
      if (o.skip && o.skip(sx, sy)) continue;
      const sk = sideKey(sx, sy);
      const q = boxHalfAt(b, z);
      const len = (sx !== 0 ? q.hh : q.hw) - q.ch - 0.8;
      if (len < pitch * 0.5) continue;
      const n = Math.floor(len * 2 / pitch);
      for (let c = 0; c <= n; c++) {
        const a = (c + 0.5 - (n + 1) / 2) * (2 * len / (n + 1));   // w lustrze dokładnie (połówki)
        const key = alongKey(b, sx, c, n);
        const hg = towerHash(seed + bi * 59 + k * 977, sk, Math.floor(key / 5));
        if (hg > fill * 1.5) continue;
        if (towerHash(seed + bi * 59 + 3, sk * 31 + k, key) > 0.75) continue;
        wallLight(b, sx, sy, a, z, k, { up: o.up ?? 0.55, s: o.s ?? 1.1, i: o.i ?? 0.8, c: o.c ?? 0 });
      }
    }
  }
  /** Maszyny na dachu bryły: małe bryły w obrysie wierzchu (w `sym` w lustrze). */
  function roofKit(b, r, n) {
    if (!b) return;
    const q = boxHalfAt(b, b.z1);
    const m = 2.2;
    const lu = (axisX ? q.hw : q.hh) - q.ch * 0.5 - m, lv = (axisX ? q.hh : q.hw) - q.ch * 0.5 - m;
    if (lu < 3 || lv < 3) return;
    const bu = axisX ? b.x - spec.x : b.y - spec.y, bv = axisX ? b.y - spec.y : b.x - spec.x;
    for (let i = 0; i < n; i++) {
      const hu = clamp(r.range(1.2, 0.3 * lu), 1.2, 7), hv = clamp(r.range(1.2, 0.3 * lv), 1.2, 7);
      let u = bu + r.range(-lu + hu, lu - hu);
      let v = bv + r.range(-lv + hv, lv - hv);
      const h = r.range(1.4, 4.5);
      const o = { mat: HD_TOWER_MAT.roof, ch: Math.min(hu, hv) * r.range(0, 0.4), tone: r.range(0.9, 1.15), minH: 1 };
      // w `sym` bryła przecinająca oś staje na osi (inaczej para nachodziłaby na siebie)
      if (sym) {
        const wy = toWorld(u, v)[1];
        const hy = axisX ? hv : hu;
        if (Math.abs(wy - spec.y) < hy + 0.5) { if (axisX) v = 0; else u = 0; }
      }
      boxSym(u, v, hu, hv, b.z1, b.z1 + h, o);
    }
  }
  /** Maszt na dachu bryły z lampą przy wierzchu (na boku masztu). */
  function mast(b, u, v, h, w = 0.7) {
    if (!b) return null;
    const n0 = boxes.length;
    const m = boxSym(u, v, w, w, b.z1, b.z1 + h, { mat: HD_TOWER_MAT.mast, minH: 2, minSide: 0.4 });
    if (m && lightK > 0) {
      for (let i = n0; i < boxes.length; i++) {
        wallLight(boxes[i], 1, 0, 0, boxes[i].z1 - 0.6, HD_TOWER_LIGHT.beacon, { s: 0.8, i: 0.7, c: 3, up: 0.3 });
        wallLight(boxes[i], -1, 0, 0, boxes[i].z1 - 0.6, HD_TOWER_LIGHT.beacon, { s: 0.8, i: 0.7, c: 3, up: 0.3 });
      }
    }
    return m;
  }
  /** Lokalne położenie (u, v) środka bryły. */
  const local = (b) => (axisX ? [b.x - spec.x, b.y - spec.y] : [b.y - spec.y, b.x - spec.x]);
  const halfLocal = (b) => (axisX ? [b.hw, b.hh] : [b.hh, b.hw]);

  return { boxes, lights, spec, L, W, sym, seed, box, boxSym, wallLight, windows, lightRow, roofKit, mast, local, halfLocal };
}

// ── RODZINY ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Uskoki: wcięcia na czterech stronach (u+, u−, v+, v−) w ułamkach wymiaru; w `sym` przy osi u = x strony v równe. */
function setbacks(r, B, lo, hi, keep = -1) {
  const s = [r.range(lo, hi), r.range(lo, hi), r.range(lo, hi), r.range(lo, hi)];
  if (r.chance(0.35)) s[r.int(0, 3)] = 0;                       // jedna strona w licu (płyta z frontem do kanionu)
  if (keep >= 0) s[keep] = 0;
  if (B.sym && B.spec.axis === 'x') { s[3] = s[2]; }
  if (B.sym && B.spec.axis !== 'x') { s[1] = s[0]; }
  return s;
}

/** Następne piętro z uskokami s względem bryły b (lokalnie): zwraca [u, v, hu, hv]. */
function inset(B, b, s) {
  const [u, v] = B.local(b);
  const [hu, hv] = B.halfLocal(b);
  const du1 = s[0] * hu, du0 = s[1] * hu, dv1 = s[2] * hv, dv0 = s[3] * hv;
  return [u + (du0 - du1) / 2, v + (dv0 - dv1) / 2, hu - (du0 + du1) / 2, hv - (dv0 + dv1) / 2];
}

const tnCh = (hu, hv, k) => Math.min(hu, hv) * k;

function famSlab(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  const cls = towerSizeClass(spec.hw, spec.hh, H);
  const nP = H < 14 ? 1 : H < 34 ? 2 : (cls >= 2 && r.chance(0.6) ? 3 : 2);
  const fr = nP === 1 ? [1] : nP === 2 ? [r.range(0.5, 0.66), 1] : [r.range(0.36, 0.46), r.range(0.68, 0.8), 1];
  let u = 0, v = 0, hu = L, hv = W, zb = z0, prev = null;
  for (let p = 0; p < nP; p++) {
    const zt = z0 + H * fr[p];
    const mat = p === 0 ? HD_TOWER_MAT.podium : HD_TOWER_MAT.plate;
    const hgt = zt - zb;
    const b = B.box(u, v, hu, hv, zb, zt, { mat, ch: tnCh(hu, hv, r.range(0.06, 0.16)), bat: Math.min(2.2, hgt * r.range(0.02, 0.07)), tone: r.range(0.92, 1.08) });
    if (!b) break;
    B.windows(b, { rows: p === 0 ? 2 : 1, fill: HD_TOWER_TUNE.windowFill * (p === 0 ? 0.7 : 1) });
    if (p === 0) B.lightRow(b, b.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5.5, up: 0.6, i: 0.7 });
    prev = b;
    if (p === nP - 1) break;
    // szczelina: wnęka nad płytą (wcięta), potem następna płyta z uskokami
    const s = setbacks(r, B, 0.04, cls >= 2 ? 0.2 : 0.14);
    [u, v, hu, hv] = inset(B, b, s);
    const rg = 1.2 + r.range(0, 1);
    const rh = r.range(1.6, 2.8);
    const rec = B.box(u, v, hu - rg, hv - rg, zt, zt + rh, { mat: HD_TOWER_MAT.recess, ch: tnCh(hu, hv, 0.1), minH: 1 });
    if (rec) B.lightRow(rec, zt + rh * 0.5, HD_TOWER_LIGHT.seam, { fill: HD_TOWER_TUNE.seamFill, pitch: 2.8, up: 0.35, s: 1.0, i: 0.85 });
    zb = zt + rh;
  }
  if (prev) {
    B.roofKit(prev, r, cls + r.int(1, 3));
    if (cls >= 2 && r.chance(0.5)) {
      const [pu, pv] = B.local(prev);
      const mu = pu + r.range(-0.4, 0.4) * L * 0.5;
      B.mast(prev, B.sym && spec.axis !== 'x' ? 0 : mu, B.sym && spec.axis === 'x' ? 0 : pv, r.range(6, 14));
    }
  }
}

function famStepped(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  const hp = H * r.range(0.1, 0.2);
  const pod = B.box(0, 0, L, W, z0, z0 + hp, { mat: HD_TOWER_MAT.podium, ch: tnCh(L, W, 0.12), bat: Math.min(1.5, hp * 0.05) });
  if (!pod) return;
  B.windows(pod, { rows: 2, fill: 0.08 });
  B.lightRow(pod, pod.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5.5, up: 0.6, i: 0.7 });
  // trzon: wcięty z cokołu, przesunięty wzdłuż u (nie w `sym` w poprzek)
  const k = r.range(0.58, 0.8);
  let hu = L * k, hv = W * Math.min(0.92, k + r.range(-0.08, 0.1));
  let u = B.sym && spec.axis !== 'x' ? 0 : r.range(-1, 1) * (L - hu) * 0.6;
  let v = B.sym && spec.axis === 'x' ? 0 : r.range(-1, 1) * (W - hv) * 0.5;
  const nSeg = H > 90 ? 4 : H > 45 ? 3 : 2;
  const ends = [];
  for (let i = 0; i < nSeg; i++) ends.push(z0 + hp + (H * 0.94 - hp) * Math.pow((i + 1) / nSeg, r.range(0.8, 1.1)));
  let zb = z0 + hp + r.range(1.5, 2.5);
  // szczelina nad cokołem
  const g = B.box(u, v, hu - 1.4, hv - 1.4, z0 + hp, zb, { mat: HD_TOWER_MAT.recess, ch: tnCh(hu, hv, 0.2), minH: 1 });
  if (g) B.lightRow(g, (g.z0 + g.z1) / 2, HD_TOWER_LIGHT.seam, { pitch: 2.6, up: 0.4 });
  let last = null;
  for (let i = 0; i < nSeg; i++) {
    const zt = ends[i];
    const b = B.box(u, v, hu, hv, zb, zt, { mat: HD_TOWER_MAT.wall, ch: tnCh(hu, hv, 0.16 + 0.08 * i), bat: Math.min(1.8, (zt - zb) * 0.03), tone: r.range(0.95, 1.08) });
    if (!b) break;
    B.windows(b, { rows: 1, fill: HD_TOWER_TUNE.windowFill * 1.1 });
    // szczelina u stopy segmentu nad uskokiem (taras pod nią — świeci też z góry)
    if (i > 0) B.lightRow(b, b.z0 + 0.9, HD_TOWER_LIGHT.seam, { fill: 0.35, pitch: 3.4, up: 0.5 });
    last = b;
    if (i === nSeg - 1) break;
    const sh = r.range(0.72, 0.86);
    const nhu = hu * sh, nhv = hv * Math.min(0.95, sh + r.range(-0.05, 0.08));
    u += B.sym && spec.axis !== 'x' ? 0 : r.range(-1, 1) * (hu - nhu) * 0.5;
    if (!(B.sym && spec.axis === 'x')) v += r.range(-1, 1) * (hv - nhv) * 0.4;
    hu = nhu; hv = nhv;
    zb = zt;
  }
  if (!last) return;
  // korona: węższa, z fazą, potem maszt
  const [lu, lv] = B.local(last);
  const [lhu, lhv] = B.halfLocal(last);
  const crown = B.box(lu, lv, lhu * 0.62, lhv * 0.62, last.z1, z0 + H, { mat: HD_TOWER_MAT.crown, ch: tnCh(lhu, lhv, 0.3), bat: 0.8 });
  if (crown) {
    B.lightRow(crown, crown.z0 + (crown.z1 - crown.z0) * 0.45, HD_TOWER_LIGHT.seam, { fill: 0.45, pitch: 2.4, up: 0.2, i: 0.9 });
    B.mast(crown, lu, lv, H * r.range(0.08, 0.16), 0.8);
  } else B.roofKit(last, r, 2);
}

function famTwin(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  const hp = H * r.range(0.08, 0.16);
  const pod = B.box(0, 0, L, W, z0, z0 + hp, { mat: HD_TOWER_MAT.podium, ch: tnCh(L, W, 0.1), bat: Math.min(1.5, hp * 0.05) });
  if (!pod) return;
  B.windows(pod, { rows: 2, fill: 0.08 });
  B.lightRow(pod, pod.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5.5, up: 0.6, i: 0.7 });
  const tl = L * r.range(0.28, 0.36), tw = W * r.range(0.62, 0.86);
  const c = L - tl - r.range(0, 0.06) * L;
  const hA = H, hB = H * (B.sym && spec.axis !== 'x' ? 1 : r.range(0.74, 0.98));
  const towers = [];
  for (const [sgn, hT] of [[1, hA], [-1, hB]]) {
    const zt = z0 + hT * 0.84;
    const t = B.box(sgn * c, 0, tl, tw, z0 + hp, zt, { mat: HD_TOWER_MAT.wall, ch: tnCh(tl, tw, 0.22), bat: Math.min(1.5, hT * 0.012) });
    if (!t) continue;
    B.windows(t, { fill: HD_TOWER_TUNE.windowFill * 1.2 });
    const top = B.box(sgn * c, 0, tl * 0.72, tw * 0.72, zt, z0 + hT, { mat: HD_TOWER_MAT.crown, ch: tnCh(tl, tw, 0.3), bat: 0.6 });
    if (top) {
      B.lightRow(t, zt - 1.2, HD_TOWER_LIGHT.seam, { fill: 0.4, pitch: 3, up: 0.5 });
      B.mast(top, sgn * c, 0, hT * r.range(0.06, 0.12));
    }
    towers.push(t);
  }
  if (towers.length < 2) return;
  // łącznik (jeden albo dwa) między wewnętrznymi ścianami wież
  const gapU = c - tl;
  const nb = H > 80 && r.chance(0.55) ? 2 : 1;
  for (let i = 0; i < nb; i++) {
    const zb = z0 + Math.min(hA, hB) * (nb === 1 ? r.range(0.5, 0.68) : (i === 0 ? 0.42 : 0.66));
    const bh = r.range(3, 5.5);
    const bw = tw * r.range(0.3, 0.46);
    const br = B.box(0, 0, gapU + 0.5, bw, zb, zb + bh, { mat: HD_TOWER_MAT.crown, ch: tnCh(gapU, bw, 0.2), minH: 2 });
    if (br) B.lightRow(br, zb + bh * 0.5, HD_TOWER_LIGHT.window, { fill: 0.5, pitch: 2.5, up: 0, s: 0.8, i: 0.7, skip: (sx, sy) => (B.spec.axis === 'x' ? sx !== 0 : sy !== 0) });
  }
  B.roofKit(pod, r, 2);
}

function famWedge(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  // kierunek schodzenia: `face` w układzie świata (sx, sy); w `sym` — w obie strony v (grzbiet)
  const face = spec.face || [0, -1];
  const along = spec.axis === 'x' ? (face[0] !== 0 ? 'u' : 'v') : (face[1] !== 0 ? 'u' : 'v');
  const sgn = along === 'u' ? Math.sign(spec.axis === 'x' ? face[0] : face[1]) || 1 : Math.sign(spec.axis === 'x' ? face[1] : face[0]) || 1;
  const both = B.sym && ((spec.axis === 'x' && along === 'v') || (spec.axis !== 'x' && along === 'u'));
  const n = clamp(Math.round(H / r.range(7, 12)), 2, 6);
  const D = along === 'u' ? L : W;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const zt = z0 + H * (i + 1) / n;
    const zb = i === 0 ? z0 : prev ? prev.z1 : z0 + H * i / n;
    // stopień i: od tylnej krawędzi do frontu cofającego się z wysokością
    const depth = D * (1 - i / n * r.range(0.88, 0.96));
    let cu = 0, cv = 0, hu = L, hv = W;
    if (both) {
      // grzbiet: schodzi w obie strony v (lustro) — stopień i węższy o i / n
      if (along === 'u') hu = L * (1 - i / n * 0.9); else hv = W * (1 - i / n * 0.9);
    } else if (along === 'u') { hu = depth; cu = -sgn * (L - depth); } else { hv = depth; cv = -sgn * (W - depth); }
    const hgt = zt - zb;
    const b = B.box(cu, cv, hu, hv, zb, zt, { mat: i === 0 ? HD_TOWER_MAT.podium : HD_TOWER_MAT.plate, ch: tnCh(hu, hv, 0.08), bat: Math.min(hgt * r.range(0.35, 0.6), 6), tone: r.range(0.94, 1.06) });
    if (!b) break;
    if (i === 0) B.lightRow(b, b.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5.5, up: 0.6, i: 0.7 });
    // światła przy stopie frontu (skos widać z góry)
    B.lightRow(b, b.z0 + hgt * 0.35, HD_TOWER_LIGHT.seam, { fill: 0.42, pitch: 3, up: 0.25, s: 1, i: 0.8 });
    prev = b;
  }
  if (prev) B.roofKit(prev, r, 1 + r.int(0, 2));
}

function famHall(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  const h1 = H * r.range(0.45, 0.6);
  const base = B.box(0, 0, L, W, z0, z0 + h1, { mat: HD_TOWER_MAT.hall, ch: tnCh(L, W, 0.06), bat: Math.min(h1 * 0.18, 3) });
  if (!base) return;
  B.lightRow(base, base.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5, up: 0.6, i: 0.7 });
  B.windows(base, { rows: 2, fill: 0.06 });
  // okap: szczelina z rzędem świateł, dach z mocno pochylonymi bokami (dwuspad z wierzchem-kalenicą)
  const q = boxHalfAt(base, base.z1);
  const [qu, qv] = B.spec.axis === 'x' ? [q.hw, q.hh] : [q.hh, q.hw];
  const eave = B.box(0, 0, qu - 1.2, qv - 1.2, base.z1, base.z1 + 1.6, { mat: HD_TOWER_MAT.recess, ch: tnCh(qu, qv, 0.06), minH: 1 });
  if (eave) B.lightRow(eave, eave.z0 + 0.8, HD_TOWER_LIGHT.seam, { fill: 0.6, pitch: 2.6, up: 0.4 });
  const zr = base.z1 + 1.6;
  const roof = B.box(0, 0, qu - 0.6, qv - 0.6, zr, z0 + H, { mat: HD_TOWER_MAT.hall, ch: tnCh(qu, qv, 0.05), bat: Math.max(0, Math.min(qv, qu) - 2.2) * r.range(0.82, 0.96), tone: 0.92 });
  if (roof) {
    // wywietrzniki na kalenicy
    const nv = Math.max(1, Math.floor(qu / 18));
    for (let i = 0; i < nv; i++) {
      const u = -qu + (i + 0.5) * (2 * qu / nv);
      B.box(u, 0, 2.2, 1.4, roof.z1, roof.z1 + r.range(1.5, 3), { mat: HD_TOWER_MAT.roof, minH: 1 });
    }
  }
}

function famSpire(B, r) {
  const { spec, L, W } = B;
  const H = spec.H, z0 = spec.z0 ?? 0;
  const m = Math.min(L, W);
  let zb = z0;
  if (m > 14) {
    const hp = H * r.range(0.06, 0.12);
    const pod = B.box(0, 0, L, W, z0, z0 + hp, { mat: HD_TOWER_MAT.podium, ch: tnCh(L, W, 0.25), bat: 1 });
    if (pod) {
      B.lightRow(pod, pod.z0 + 0.9, HD_TOWER_LIGHT.base, { fill: HD_TOWER_TUNE.baseFill, pitch: 5, up: 0.6, i: 0.7 });
      zb = pod.z1;
    }
  }
  let s = m * r.range(0.4, 0.6);
  const n = clamp(Math.round(H / 38), 3, 5);
  let last = null;
  for (let i = 0; i < n; i++) {
    const zt = z0 + H * (0.25 + 0.6 * (i + 1) / n);
    const b = B.box(0, 0, s, s, zb, zt, { mat: HD_TOWER_MAT.wall, ch: s * 0.42, bat: Math.min(1.2, (zt - zb) * 0.02) });
    if (!b) break;
    B.windows(b, { fill: HD_TOWER_TUNE.windowFill * 1.3, pitch: 3.6 });
    if (i < n - 1) B.lightRow(b, zt - 1.1, HD_TOWER_LIGHT.seam, { fill: 0.5, pitch: 2.4, up: 0.5 });
    last = b;
    zb = zt;
    s *= r.range(0.74, 0.86);
  }
  if (!last) return;
  // kołnierz korony (szerszy niski pierścień) i maszt
  const col = B.box(0, 0, s * 1.5, s * 1.5, last.z1, last.z1 + Math.max(2.5, H * 0.03), { mat: HD_TOWER_MAT.crown, ch: s * 0.6, minH: 1.5 });
  if (col) B.lightRow(col, col.z0 + (col.z1 - col.z0) * 0.5, HD_TOWER_LIGHT.seam, { fill: 0.7, pitch: 2.2, up: 0.3, i: 1 });
  const top = B.box(0, 0, s * 0.8, s * 0.8, (col || last).z1, z0 + H, { mat: HD_TOWER_MAT.wall, ch: s * 0.35, bat: 0.4 });
  B.mast(top || col || last, 0, 0, H * r.range(0.12, 0.2), 0.9);
}

const FAMILY_FN = { slab: famSlab, stepped: famStepped, twin: famTwin, wedge: famWedge, hall: famHall, spire: famSpire };

/**
 * Budynek z opisu. `spec`: { x, y, hw, hh (rzut [j.]), H (wysokość nad z0 [j.]), z0 (podłoga, domyślnie 0),
 * family (HD_TOWER_FAMILIES; domyślnie z klasy i ziarna), seed, axis ('x' | 'y'; domyślnie dłuższy bok), sym (lustro y,
 * wymaga y = 0 przy wpisaniu w masyw), face ([sx, sy] — kierunek schodzenia klina), lights (gęstość świateł, 1),
 * tone (ton budynku) }.
 * Zwraca { family, cls, boxes, lights, top } — top: najwyższy wierzch [j.].
 */
export function buildTower(spec) {
  const s = { ...spec };
  if (!s.axis) s.axis = s.hw >= s.hh ? 'x' : 'y';
  if (!(s.H > 0) || !(s.hw > 0) || !(s.hh > 0)) return { family: s.family || 'slab', cls: 0, boxes: [], lights: [], top: s.z0 ?? 0 };
  const cls = towerSizeClass(s.hw, s.hh, s.H);
  const r = rng(Math.imul((s.seed | 0) + 0x3c6ef372, 0x9e3779b1) ^ 0x51ed27);
  let fam = s.family;
  if (!fam || !FAMILY_FN[fam]) {
    const aspect = Math.max(s.hw, s.hh) / Math.min(s.hw, s.hh);
    const slim = s.H / (2 * Math.min(s.hw, s.hh));
    fam = slim > 2.2 ? r.pick(['spire', 'stepped']) : aspect > 1.8 && s.H > 30 ? r.pick(['twin', 'slab', 'hall']) : s.H < 16 ? r.pick(['slab', 'hall', 'wedge']) : r.pick(['slab', 'stepped', 'wedge']);
  }
  // rodziny wymagające proporcji: bliźniaki — dłuższy bok ≥ 1,5 krótszego
  if (fam === 'twin' && Math.max(s.hw, s.hh) < 1.5 * Math.min(s.hw, s.hh)) fam = 'stepped';
  const B = builder(s);
  FAMILY_FN[fam](B, r);
  // światła wewnątrz innej bryły budynku (zasłonięte łącznikiem, płytą obok) — precz; limit na budynek
  let out = [];
  for (const l of B.lights) {
    let hid = false;
    for (const b of B.boxes) if (pointInBox(b, l.x, l.y, l.z, 0.05)) { hid = true; break; }
    if (!hid) out.push(l);
  }
  // ponad limit: przerzedzenie haszem miejsca (w budynku `sym` od osi — lustro zostaje), nie ucięcie końca listy
  if (out.length > HD_TOWER_TUNE.maxLights) {
    const keep = HD_TOWER_TUNE.maxLights / out.length;
    out = out.filter((l) => towerHash(Math.round(l.x * 8), Math.round((s.sym ? Math.abs(l.y - s.y) : l.y) * 8), Math.round(l.z * 8) + (s.seed | 0)) < keep);
  }
  let top = s.z0 ?? 0;
  for (const b of B.boxes) top = Math.max(top, b.z1);
  return { family: fam, cls, boxes: B.boxes, lights: out, top };
}

/** Odbicie budynku w osi y okrętu (budynki burty y > 0 z wygenerowanych dla y < 0). Nowe obiekty. */
export function mirrorTower(t) {
  return {
    family: t.family, cls: t.cls, top: t.top,
    boxes: t.boxes.map((b) => ({ ...b, y: -b.y })),
    lights: t.lights.map((l) => ({ ...l, y: -l.y, ny: -l.ny }))
  };
}
