// DWORZEC PROMÓW — elementy brył (dane instancji PortRecorder, bez three).
//
// To, czego zestaw portowy nie ma, bo port jest przemysłowy: budynki pasażerskie — biurowce i rotundy z pasami okien,
// kopuła rotundy ze szkieletem i szybami, szklane nawy i galerie, rękawy pasażerskie, budynki zaplecza ze świetlikami.
// Okna: jedna świecąca opaska na piętro (bryła odrobinę szersza od trzonu) przecięta ciemnymi żebrami — z jednej
// instancji robi się rząd okien na czterech ścianach. Jasności trzymane nisko (GAIN), żeby bloom nie zalał kadru.
import { PB_FX, PB_MAT, YARD_H, pbHash1, pbPlate } from '../kit/sceny.js';
import { ringScale, yardPhi, yardPoint } from '../kit/uklad.js';

const M = PB_MAT;
const H = YARD_H;
const TAU = Math.PI * 2;
export const hash = pbHash1;

/** Wzmocnienia świateł dzielnicy (emisja materiału × wzmocnienie; próg bloomu ~0,9). */
export const GAIN = Object.freeze({ warm: 0.6, cold: 0.5, white: 0.4, lawn: 0.1, tree: 0.2, strip: 0.85, lamp: 0.95 });

const rotOf = (dx, dz) => Math.atan2(-dz, dx);

/** Kwaternion z bazy ortonormalnej (kolumny: oś X, Y, Z bryły w układzie budowli). */
function quatFromBasis(ex, ey, ez) {
  const m00 = ex[0]; const m10 = ex[1]; const m20 = ex[2];
  const m01 = ey[0]; const m11 = ey[1]; const m21 = ey[2];
  const m02 = ez[0]; const m12 = ez[1]; const m22 = ez[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

/**
 * Płyta pochylona (szyba dachu, połać): prostokąt od a do b ([x, y K-7, z] — środki krótszych krawędzi), szerokość
 * `wid` poziomo w poprzek, grubość `th`. W odróżnieniu od `f.beam` nie skręca się wokół własnej osi.
 */
export function slab(f, a, b, wid, th, mat) {
  const ay = f._y(a[1]);
  const by = f._y(b[1]);
  let lx = b[0] - a[0];
  let ly = by - ay;
  let lz = b[2] - a[2];
  const len = Math.hypot(lx, ly, lz);
  if (len < 0.5) return;
  lx /= len; ly /= len; lz /= len;
  let tx = -lz;
  let tz = lx;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
  const n = [-tz * ly, tz * lx - tx * lz, tx * ly];
  f._push('box', (a[0] + b[0]) / 2, (ay + by) / 2, (a[2] + b[2]) / 2, 1, wid, len, th, mat, quatFromBasis([tx, 0, tz], [lx, ly, lz], n));
}

/** Pierścień z odcinków (wielokąt foremny) wokół (x, z) na wysokości y. */
export function hoop(f, x, z, r, y, h, wid, mat, n = 24, phase = 0.5) {
  const seg = 2 * r * Math.sin(Math.PI / n) * 1.02;
  for (let i = 0; i < n; i++) {
    const a = ((i + phase) / n) * TAU;
    f.box(x + Math.cos(a) * r * Math.cos(Math.PI / n), y, z + Math.sin(a) * r * Math.cos(Math.PI / n), seg, h, wid, mat, rotOf(-Math.sin(a), Math.cos(a)));
  }
}

/** Drzewo widziane z góry: korona (świecąca słabo zieleń — czyta się jako liście pod szkłem i na tarasach). */
export function tree(f, x, z, y, r, seed) {
  const k = hash(seed + 0.7);
  f.fx(GAIN.tree * (0.75 + 0.5 * k), PB_FX.steady);
  if (k < 0.3) f.cone(x, y + r * 1.5, z, r, r * 3, M.green);
  else f.cyl(x, y + r * 0.8, z, r, r * 1.6, M.green);
  f.nofx();
}

/** Trawnik / rabata: płaska bryła słabej zieleni. */
export function lawn(f, x, z, y, len, wid, rot = 0, k = 1) {
  f.fx(GAIN.lawn * k, PB_FX.steady);
  f.box(x, y, z, len, 5, wid, M.green, rot);
  f.nofx();
}

/** Latarnia placu: słupek i ciepłe światło. */
export function lampPost(f, x, z, y, mat = M.warm, gain = GAIN.lamp) {
  f.cyl(x, y + 22, z, 3, 44, M.rail);
  f.fx(gain, PB_FX.steady);
  f.box(x, y + 46, z, 12, 5, 12, mat);
  f.nofx();
}

// ---------------------------------------------------------------------------
// Wieże i bloki (ustawione wzdłuż łuku: `w` wzdłuż s, `d` promieniowo; wysokości K-7 nad `y0`)

const WIN = [
  { mat: M.warm, gain: GAIN.warm },
  { mat: M.cyan, gain: GAIN.cold },
  { mat: M.white, gain: GAIN.white }
];

/** Dobór barwy okien wieży: ciepłe / zimne / białe (na zmianę między wieżami, z domieszką w obrębie wieży). */
function windowTone(seed) {
  const k = hash(seed + 3.1);
  return k < 0.5 ? 0 : k < 0.8 ? 1 : 2;
}

/** Jedna kondygnacja-bryła wieży: trzon, opaski okien co piętro, żebra, attyka. Zwraca wysokość wierzchu. */
function tierBox(T, f, s, v, w, d, y0, h, seed, o) {
  const sw = ringScale(v);
  const body = o.body;
  const fin = body === M.dark ? M.rail : M.dark;
  T.box(s, v, y0 + h / 2, w, h, d, body);
  const pitch = o.pitch || Math.max(62, h / 15);            // wysokie bryły: rzadsze, wyższe opaski (budżet instancji)
  const bandH = pitch * 0.34;
  const n = Math.max(1, Math.floor((h - 26) / pitch));
  const tone = windowTone(seed);
  for (let i = 0; i < n; i++) {
    const k = hash(seed + i * 1.37 + 0.5);
    if (k < (o.dark ?? 0.2)) continue;                      // piętro bez światła
    const win = WIN[k > 0.86 ? (tone + 1) % 3 : tone];
    f.fx(win.gain * (0.8 + 0.4 * hash(seed + i * 2.3)), PB_FX.steady);
    T.box(s, v, y0 + pitch * 0.5 + i * pitch, w + 5, bandH, d + 5, win.mat);
    f.nofx();
  }
  // żebra pionowe przez całą bryłę (wystają z obu ścian): tną opaski na okna
  const ns = Math.max(1, Math.round(w / 66) - 1);
  for (let i = 0; i < ns; i++) T.box(s + ((w * (i + 1)) / (ns + 1) - w / 2) / sw, v, y0 + h / 2, 7, h - 8, d + 13, fin);
  const nv = Math.max(1, Math.round(d / 66) - 1);
  for (let i = 0; i < nv; i++) T.box(s, v + (d * (i + 1)) / (nv + 1) - d / 2, y0 + h / 2, w + 13, h - 8, 7, fin);
  T.box(s, v, y0 + h + 5, w + 9, 10, d + 9, M.rail);        // attyka
  return y0 + h + 10;
}

/** Wyposażenie dachu (taras): ogród, basen, świetlik, lądowisko, maszynownia. */
function roofKit(T, f, s, v, w, d, y, seed, tall, green = true) {
  const sw = ringScale(v);
  const P = (ds, dv) => yardPoint(s + ds / sw, v + dv);
  const pick = hash(seed + 7.7);
  let kind = pick < 0.2 ? 0 : pick < 0.3 ? 1 : pick < 0.58 ? 2 : pick < 0.7 ? 3 : 4;
  if (!green && kind < 2) kind = 2;
  if (kind === 0 && w > 150) {
    // ogród na dachu: rabata po jednej stronie, kilka drzew, reszta dachu ze stali
    const [x, z] = P(-w * 0.14, 0);
    lawn(f, x, z, y + 3, w * 0.5, d * 0.62, yardPhi(s), 1.1);
    const n = Math.max(2, Math.round(w / 110));
    for (let i = 0; i < n; i++) {
      const p = P(-w * 0.14 + w * 0.2 * (hash(seed + i * 3.3) * 2 - 1), d * 0.24 * (hash(seed + i * 5.1) * 2 - 1));
      tree(f, p[0], p[1], y + 4, 13 + 9 * hash(seed + i), seed + i);
    }
    T.box(s + (w * 0.3) / sw, v, y + 9, w * 0.2, 14, d * 0.4, M.glass);
  } else if (kind === 1 && w > 170) {
    T.box(s, v, y + 4, w * 0.5, 6, d * 0.34, M.teal);
    T.box(s, v, y + 2, w * 0.62, 3, d * 0.46, M.steel);
    T.lamp(s + (w * 0.36) / sw, v, y + 6, 10, M.white, GAIN.white + 0.2);
  } else if (kind === 2) {
    // świetliki: szkło nad ciepłym światłem (z góry czyta się jak okna w dachu)
    const n = w > 240 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const ds = ((i + 0.5) / n - 0.5) * w * 0.8;
      f.fx(GAIN.warm * (0.8 + 0.4 * hash(seed + i)), PB_FX.steady);
      T.box(s + ds / sw, v, y + 3, (w * 0.62) / n, 4, d * 0.62, hash(seed + i * 2.2) < 0.75 ? M.warm : M.cyan);
      f.nofx();
      T.box(s + ds / sw, v, y + 9, (w * 0.5) / n, 12, d * 0.5, M.glass);
    }
  } else if (kind === 3 && w > 200 && d > 200) {
    const [x, z] = P(0, 0);
    hoop(f, x, z, Math.min(w, d) * 0.3, y + 3, 3, 9, M.yellow, 12);
    T.lamp(s, v, y + 5, 12, M.green, 1.0, PB_FX.blink, hash(seed), 0.6);
  } else {
    T.box(s - (w * 0.18) / sw, v, y + 11, w * 0.3, 20, d * 0.42, M.dark);
    T.box(s + (w * 0.2) / sw, v + d * 0.12, y + 8, w * 0.24, 14, d * 0.3, M.steel);
    T.pipe(s - (w * 0.3) / sw, v - d * 0.3, s + (w * 0.3) / sw, v - d * 0.3, y + 6, 5, M.copper);
  }
  if (tall) {
    T.cyl(s + (w * 0.32) / sw, v + d * 0.32, y + 60, 4, 120, M.rail);
    T.lamp(s + (w * 0.32) / sw, v + d * 0.32, y + 124, 12, M.red, 1.5, PB_FX.blink, hash(seed + 0.3), 0.5);
  }
}

/**
 * Biurowiec: 1–3 schodkowe kondygnacje-bryły z pasami okien; `green: false` — bez zieleni na dachu i uskokach.
 * `h` — wysokość nad `y0` (K-7; na ekranie × 0,42). Opcje: `y0`, `tiers`, `body`, `shift` (uskok ku +v / −v).
 */
export function tower(T, f, s, v, w, d, h, seed, o = {}) {
  const y0 = o.y0 ?? H.deck;
  const sw = ringScale(v);
  const tiers = o.tiers ?? (h > 1500 ? (hash(seed + 2.2) < 0.55 ? 3 : 2) : h > 700 ? (hash(seed + 2.2) < 0.6 ? 2 : 1) : 1);
  const body = o.body ?? (hash(seed + 1.1) < 0.6 ? M.steel : M.dark);
  const split = tiers === 3 ? [0.44, 0.33, 0.23] : tiers === 2 ? [0.62, 0.38] : [1];
  let y = y0;
  let cw = w;
  let cd = d;
  let cs = s;
  let cv = v;
  const dir = o.shift ?? (hash(seed + 4.4) < 0.5 ? -1 : 1);
  for (let i = 0; i < tiers; i++) {
    const th = h * split[i];
    const top = tierBox(T, f, cs, cv, cw, cd, y, th, seed + i * 11.3, { body: i % 2 ? (body === M.steel ? M.dark : M.steel) : body, pitch: o.pitch, dark: o.dark });
    if (i === tiers - 1) {
      roofKit(T, f, cs, cv, cw, cd, top, seed + 9.9, h > 1700, o.green !== false);
      break;
    }
    // uskok: wyższa bryła węższa i przesunięta — odsłonięty pas dachu to taras z zielenią i listwą światła
    const nw = cw * (0.62 + 0.14 * hash(seed + i * 3.7));
    const nd = cd * (0.66 + 0.14 * hash(seed + i * 4.9));
    const ds = ((cw - nw) / 2 - 6) * (hash(seed + i * 6.1) < 0.5 ? -1 : 1);
    const dv = ((cd - nd) / 2 - 6) * dir;
    const ws = cw - nw - 6;                                 // odsłonięty pas wzdłuż s (po stronie przeciwnej do uskoku)
    const wv = cd - nd - 6;                                 // odsłonięty pas wzdłuż v
    if (ws > 56 && o.green !== false) {
      const p = yardPoint(cs - (Math.sign(ds || 1) * (cw / 2 - ws / 2)) / sw, cv);
      lawn(f, p[0], p[1], top + 3, ws - 22, cd * 0.74, yardPhi(cs));
    }
    if (wv > 46 && o.green !== false) {
      const tv = cv - Math.sign(dv || 1) * (cd / 2 - wv / 2);
      const p = yardPoint(cs + ds / sw, tv);
      lawn(f, p[0], p[1], top + 3, nw * 0.8, wv - 18, yardPhi(cs), 0.9);
      for (let k = 0; k < 2; k++) {
        const q = yardPoint(cs + (ds + nw * 0.3 * (k ? 1 : -1)) / sw, tv);
        tree(f, q[0], q[1], top + 4, Math.min(wv * 0.3, 12 + 6 * hash(seed + k)), seed + k * 2.1);
      }
    }
    f.fx(GAIN.strip * 0.8, PB_FX.steady);
    T.box(cs, cv, top + 2, cw + 3, 3, cd + 3, hash(seed + i) < 0.5 ? M.warm : M.cyan);
    f.nofx();
    T.box(cs, cv, top + 3, cw - 9, 4, cd - 9, M.steel);       // posadzka tarasu: świeci tylko wąska krawędź
    y = top;
    cs += ds / sw;
    cv += dv;
    cw = nw;
    cd = nd;
  }
}

/** Wieża okrągła (rotunda): walec z opaskami okien i żebrami, kopułka albo taras. */
export function roundTower(f, x, z, r, h, seed, o = {}) {
  const y0 = o.y0 ?? H.deck;
  const body = o.body ?? M.steel;
  f.cyl(x, y0 + h / 2, z, r, h, body);
  const pitch = Math.max(62, h / 18);
  const n = Math.max(1, Math.floor((h - 26) / pitch));
  const tone = windowTone(seed);
  for (let i = 0; i < n; i++) {
    const k = hash(seed + i * 1.9);
    if (k < 0.18) continue;
    const win = WIN[k > 0.88 ? (tone + 1) % 3 : tone];
    f.fx(win.gain * (0.8 + 0.4 * hash(seed + i * 2.3)), PB_FX.steady);
    f.cyl(x, y0 + pitch * 0.5 + i * pitch, z, r + 3, pitch * 0.34, win.mat);
    f.nofx();
  }
  for (let i = 0; i < 4; i++) f.box(x, y0 + h / 2, z, 2 * r + 14, h - 8, 7, body === M.dark ? M.rail : M.dark, (i * Math.PI) / 4);
  f.cyl(x, y0 + h + 5, z, r + 6, 10, M.rail);
  if (o.cap !== false) {
    f.cyl(x, y0 + h + 22, z, r * 0.66, 24, M.glass);
    f.fx(GAIN.warm, PB_FX.steady);
    f.cyl(x, y0 + h + 12, z, r * 0.72, 4, M.warm);
    f.nofx();
    f.cyl(x, y0 + h + 40, z, r * 0.4, 12, M.steel);
  }
  if (h > 1500) {
    f.cyl(x, y0 + h + 110, z, 4, 130, M.rail);
    f.fx(1.5, PB_FX.blink, hash(seed + 0.3), 0.5);
    f.box(x, y0 + h + 178, z, 12, 6, 12, M.red);
    f.nofx();
  }
}

// ---------------------------------------------------------------------------
// Kopuły i galerie

/**
 * Kopuła: szkielet (południki i równoleżniki z belek) i szyby na części pól — przez puste pola widać park.
 * `rise` — wysokość K-7 nad `y0`. `glass`: ułamek przeszklonych pól (0…1), górny pierścień zawsze przeszklony.
 */
export function dome(f, x, z, R, y0, rise, o = {}) {
  const nm = o.meridians ?? 16;
  const nr = o.rings ?? 4;
  const frame = o.frame ?? M.rail;
  const bw = o.beam ?? Math.max(6, R * 0.012);
  const seed = o.seed ?? 0;
  const glassK = o.glass ?? 0.5;
  const ring = (k) => { const a = (k / nr) * (Math.PI / 2) * 0.9; return [R * Math.cos(a), y0 + rise * Math.sin(a) / Math.sin((Math.PI / 2) * 0.9)]; };
  const pt = (k, m) => { const [r, y] = ring(k); const a = (m / nm) * TAU; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; };
  for (let k = 0; k <= nr; k++) {
    for (let m = 0; m < nm; m++) f.beam(pt(k, m), pt(k, m + 1), bw * (k === 0 ? 1.8 : 1), frame);
  }
  for (let m = 0; m < nm; m++) for (let k = 0; k < nr; k++) f.beam(pt(k, m), pt(k + 1, m), bw, frame);
  const cm = Math.cos(Math.PI / nm);
  for (let k = 0; k < nr; k++) {
    const [r0, ya] = ring(k);
    const [r1, yb] = ring(k + 1);
    for (let m = 0; m < nm; m++) {
      const lit = k === nr - 1 || (glassK >= 1 ? true : glassK <= 0 ? false : ((m + k) % 2 === 0) === (glassK >= 0.5) || hash(seed + m * 3.1 + k * 7.7) < glassK - 0.5);
      if (!lit) continue;
      const a = ((m + 0.5) / nm) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      slab(f, [x + ca * r0 * cm, ya, z + sa * r0 * cm], [x + ca * r1 * cm, yb, z + sa * r1 * cm], Math.sin(Math.PI / nm) * (r0 + r1) * 0.96, 3, M.glass);
    }
  }
  // zwornik: pierścień, latarnia
  const [rt, yt] = ring(nr);
  f.cyl(x, yt + 8, z, rt * 1.04, 14, M.steel);
  f.cyl(x, yt + 22, z, rt * 0.7, 18, M.glass);
  f.fx(GAIN.white + 0.1, PB_FX.steady);
  f.cyl(x, yt + 34, z, rt * 0.16, 6, M.white);
  f.nofx();
  return { ring, pt };
}

/**
 * Galeria szklana (pasaż z zielenią): prosta nawa od p0 do p1 (układ lokalny), szerokość `wd`, okap `eave`,
 * kalenica `ridge` (K-7 nad `y0`). Co drugie przęsło przeszklone — przez pozostałe widać rabaty.
 */
export function gallery(f, p0, p1, wd, y0, o = {}) {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  if (len < 40) return;
  const u = [dx / len, dz / len];
  const n = [-u[1], u[0]];
  const rot = rotOf(u[0], u[1]);
  const eave = o.eave ?? 40;
  const ridge = o.ridge ?? 110;
  const bays = Math.max(2, Math.round(len / (o.bay ?? 130)));
  const seed = o.seed ?? 0;
  const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const at = (t, off) => [p0[0] + dx * t + n[0] * off, p0[1] + dz * t + n[1] * off];
  for (const side of [-1, 1]) f.box(mid[0] + n[0] * side * wd / 2, y0 + eave / 2, mid[1] + n[1] * side * wd / 2, len, eave, 8, M.steel, rot);
  if (o.green !== false) lawn(f, mid[0], mid[1], y0 + 3, len - 16, wd * 0.56, rot, 1.05);
  f.box(mid[0], y0 + ridge + 3, mid[1], len, 7, 10, M.rail, rot);
  // przekrój: dwuspad albo łuk z trzech połaci na stronę (hala)
  const prof = o.profile === 'arch'
    ? [[-0.5, eave], [-0.34, eave + (ridge - eave) * 0.62], [-0.15, eave + (ridge - eave) * 0.93], [0, ridge], [0.15, eave + (ridge - eave) * 0.93], [0.34, eave + (ridge - eave) * 0.62], [0.5, eave]]
    : [[-0.5, eave], [0, ridge], [0.5, eave]];
  const ribW = o.rib ?? (o.profile === 'arch' ? 9 : 6);
  for (let i = 0; i <= bays; i++) {
    for (let k = 0; k + 1 < prof.length; k++) {
      const a = at(i / bays, prof[k][0] * wd);
      const b = at(i / bays, prof[k + 1][0] * wd);
      f.beam([a[0], y0 + prof[k][1], a[1]], [b[0], y0 + prof[k + 1][1], b[1]], ribW, M.rail);
    }
  }
  const bayLen = len / bays;
  for (let i = 0; i < bays; i++) {
    const ph = i + (o.phase || 0);
    const glazed = o.glass === 'all' ? true : o.open ? ph % o.open !== o.open - 1 : ph % 2 === 0;
    const t = (i + 0.5) / bays;
    if (glazed) {
      for (let k = 0; k + 1 < prof.length; k++) {
        const a = at(t, prof[k][0] * wd * 0.985);
        const b = at(t, prof[k + 1][0] * wd * 0.985);
        slab(f, [a[0], y0 + prof[k][1] + 1, a[1]], [b[0], y0 + prof[k + 1][1] + 1, b[1]], bayLen * 0.9, 3, M.glass);
      }
    } else if (o.green !== false) {
      const c = at(t, wd * 0.16 * (hash(seed + i) * 2 - 1));
      tree(f, c[0], c[1], y0 + 4, Math.min(wd * 0.16, 16 + 8 * hash(seed + i * 1.7)), seed + i * 3.1);
    }
    if (i % 3 === 1) {
      const c = at(t, 0);
      f.fx(GAIN.warm + 0.15, PB_FX.steady);
      f.box(c[0], y0 + ridge - 6, c[1], 14, 5, 14, M.warm, rot);
      f.nofx();
    }
  }
}

/** Galeria wzdłuż łuku (s0…s1 na stałym v): odcinki proste po ~480 j. */
export function arcGallery(f, s0, s1, v, wd, y0, o = {}) {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 480));
  for (let i = 0; i < n; i++) {
    gallery(f, yardPoint(s0 + ((s1 - s0) * i) / n, v), yardPoint(s0 + ((s1 - s0) * (i + 1)) / n, v), wd, y0, { ...o, seed: (o.seed || 0) + i * 17, phase: i });
  }
}

/**
 * Rękaw pasażerski: przeszklony tunel od p0 (hala / galeria) do p1 (krawędź doku) na podporach, z ciepłą listwą
 * i głowicą przy doku.
 */
export function sleeve(f, p0, p1, y, o = {}) {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  if (len < 20) return;
  const rot = rotOf(dx, dz);
  const wid = o.wid ?? 54;
  const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  f.box(mid[0], y + 8, mid[1], len, 16, wid + 16, M.steel, rot);
  f.box(mid[0], y + 36, mid[1], len, 40, wid, M.glass, rot);
  f.box(mid[0], y + 58, mid[1], len, 5, 8, M.rail, rot);
  f.fx(GAIN.warm + 0.1, PB_FX.steady);
  f.box(mid[0], y + 18, mid[1], len * 0.94, 5, wid + 20, M.warm, rot);
  f.nofx();
  const n = Math.max(2, Math.round(len / 150));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    f.box(p0[0] + dx * t, y + 30, p0[1] + dz * t, 10, 62, wid + 10, M.rail, rot);
  }
  f.box(p1[0], y + 32, p1[1], 46, 64, wid + 34, M.steel, rot);
  f.box(p1[0], y + 66, p1[1], 50, 5, wid + 38, M.yellow, rot);
}

/** Budynek zaplecza (bagaż, odprawa, służby): korpus z pasem okien, dach ze świetlikami i maszynownią. */
export function annex(T, f, s, v, w, d, h, seed, y0) {
  const sw = ringScale(v);
  T.box(s, v, y0 + h / 2, w, h, d, M.steel);
  f.fx(GAIN.warm * (0.8 + 0.3 * hash(seed)), PB_FX.steady);
  T.box(s, v, y0 + h * 0.55, w + 5, Math.min(26, h * 0.16), d + 5, hash(seed + 1.7) < 0.7 ? M.warm : M.cyan);
  f.nofx();
  const nf = Math.max(2, Math.round(w / 90));
  for (let i = 1; i < nf; i++) T.box(s + ((w * i) / nf - w / 2) / sw, v, y0 + h / 2, 7, h - 8, d + 12, M.dark);
  T.box(s, v, y0 + h + 4, w + 8, 8, d + 8, M.rail);
  // świetliki w dwóch rzędach i maszynownia na końcu
  const n = Math.max(2, Math.round((w * 0.7) / 120));
  for (let i = 0; i < n; i++) {
    for (const dv of [-0.22, 0.22]) {
      const ss = s + ((w * 0.7 * (i + 0.5)) / n - w * 0.44) / sw;
      f.fx(GAIN.warm * (0.7 + 0.5 * hash(seed + i * 2.1 + dv)), PB_FX.steady);
      T.box(ss, v + d * dv, y0 + h + 10, (w * 0.5) / n, 4, d * 0.3, M.warm);
      f.nofx();
      T.box(ss, v + d * dv, y0 + h + 15, (w * 0.42) / n, 10, d * 0.24, M.glass);
    }
  }
  T.box(s + (w * 0.38) / sw, v, y0 + h + 22, w * 0.14, 28, d * 0.6, M.dark);
  T.pipe(s + (w * 0.38) / sw, v - d * 0.36, s + (w * 0.38) / sw, v + d * 0.36, y0 + h + 42, 7, M.copper);
}

/** Wierzch i korpus dowolnego wielokąta (platformy kopuł, apsyda): bryła od stępki do `deck`, płyta wierzchu. */
export function podium(plates, points, deck, top = M.steel) {
  pbPlate(plates, points, H.keel, deck - H.keel, M.dark, 'bg');
  let cx = 0;
  let cz = 0;
  for (const p of points) { cx += p[0]; cz += p[1]; }
  cx /= points.length;
  cz /= points.length;
  const inset = points.map((p) => {
    const l = Math.hypot(p[0] - cx, p[1] - cz) || 1;
    return [p[0] - ((p[0] - cx) / l) * 12, p[1] - ((p[1] - cz) / l) * 12];
  });
  pbPlate(plates, inset, deck, 6, top, 'bg');
}

/**
 * Korpusy kawałków stref (jak `bodies` zestawu, ale wierzchy tylko ze stali i szyn — uwaga użytkownika z portu;
 * `deckOf(piece)` — poziom wierzchu, `strip` — barwa listwy na licu od drogi).
 */
export function bodiesSteel(T, f, layout, zones, { strip = M.cyan, deckOf = () => H.deck, stripGain = 0.95 } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    const deck = deckOf(p);
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, deck - H.keel, M.dark);
    const k = hash(Math.round(p.s0 * 0.61 + p.v0 * 0.17) + 2.2);
    const d = 9 / ringScale(p.v0);
    T.sec(p.s0 + d, p.s1 - d, p.v0 + 9, p.v1 - 9, deck, 6, k < 0.3 ? M.rail : M.steel);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      T.run(p.s0, p.s1, v - sign * 9, deck + 9, 16, 16, M.rail, 500);
      f.fx(stripGain, PB_FX.steady);
      T.run(p.s0 + 8, p.s1 - 8, v + sign * 3, H.wallLight, 5, 6, strip, 500, 1.0);
      f.nofx();
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
    }
  }
}

/**
 * Okna w licu od drogi (ściana rzędu widziana z pasa ruchu): dwa rzędy małych świecących brył na wysokości kadłuba
 * i pod koroną — ciepłe i zimne na zmianę, część zgaszona.
 */
export function faceWindows(T, f, s0, s1, v, sign, seed, rows = [150, 205]) {
  const sw = ringScale(v);
  const n = Math.max(2, Math.round(((s1 - s0) * sw) / 46));
  for (const [r, y] of rows.entries()) {
    for (let i = 0; i < n; i++) {
      const k = hash(seed + i * 1.71 + r * 9.3);
      if (k < 0.34) continue;
      const win = WIN[k > 0.8 ? 1 : k > 0.72 ? 2 : 0];
      f.fx(win.gain * (0.75 + 0.4 * hash(seed + i * 0.37 + r)), PB_FX.steady);
      T.box(s0 + ((s1 - s0) * (i + 0.5)) / n, v + sign * 2, y, 26, 16, 5, win.mat);
      f.nofx();
    }
  }
}

export { M as MAT, H as HGT, rotOf };
