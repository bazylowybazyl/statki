// HUTA — wytop: WYPOSAŻENIE KOMORY (siatki własne + materiał TSL). Wszystko, co ma świecić żarem kuli albo się rusza:
// ściany i dno studni, zatoka taśmy, pierścień bramy 0 g, ODBIERALNIK żużla (koryto granulatora z lejem zsypowym
// i rurociągiem po ścianie), gniazdo i tuleja wysięgnika SSAWY, radiatory, lampy robocze, LEJ odbiorczy — CAŁE DNO
// komory (stożek od ściany do gardzieli, bez płaskiej posadzki), nieruchome listwy dawnych linii „okien”, światła
// pierścienia bramy 0 g oraz MASZYNERIA GRZEWCZA: segmenty cewek na wysięgnikach teleskopowych — część STAŁA,
// budowana raz; segmenty jadą w shaderze bez przepisywania siatki: po promieniu (atrybut `aM.xy` × dosunięcie
// `U.mach.x`) i pionową prowadnicą ku równikowi (`aM.z` × zjazd `U.mach.z`), a cała klatka idzie za środkiem bryły
// (`U.cage`): segmenty stoją na stałej szerokości kątowej bryły, w stałym odstępie od jej powierzchni.
// Część RUCHOMA (przepisywana co klatkę ze stanu symulacji): SSAWA żużla (człony teleskopu wysięgnika, głowica z kolanem,
// wahliwa szyja z dzwonem, siłowniki, rurociąg) i żaluzje dna odbieralnika.
//
// `Budowniczy` jest czysty (tablice typowane, bez three) — test w Node sprawdza bryły bez NaN. Materiał liczy światło
// w układzie komory (`wspolneTSL.js`): słońce z cieniem obrzeża studni i bryły w środku, niebo z otwartej góry, światło
// kuli / rozżarzonej kupy / metalu w leju (barwa metalu, moc z temperatury), żar własny (cewki przy grzaniu, radiatory
// z opóźnieniem, wylot odbieralnika, wzierniki rurociągu żużla, ściany i gardziel leja), lampy. Światło robocze komory
// (fazy bez żaru) bierze się z WYŚWIETLACZA GRAWITACJI (`wyswietlacz.js` — osobna bryła i materiał): jego barwa
// i jasność (`U.dcol`) kładą się na ścianach, leju i maszynerii. Jasność powierzchni nieświecących trzymana pod
// progiem poświaty.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, atan, attribute, cameraProjectionMatrix, clamp, dot, exp, float, floor, fract, length, max, min, mix, mod, modelViewMatrix,
  normalize, pow, reflect, sign, sin, smoothstep, sqrt, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { KOMORA, gasPipeRoute, pathSample } from './geometria.js';
import { STAN } from './komora.js';
import { LUMA, ballLight, hash21, skyLight, sunVis } from './wspolneTSL.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const FUN = KOMORA.funnel;
const DSP = KOMORA.display;
/** Lej: promienie szwów obwodowych wykładziny (granice pasów płyt) i długość tworzącej na jednostkę promienia. */
const FUN_R1 = 190;
const FUN_R2 = 340;
const FUN_SLANT = Math.sqrt(1 + ((FUN.rimY - FUN.throatY) / (FUN.rimR - FUN.throatR)) ** 2);

/** Rodzaje powierzchni (atrybut `aK.x`). */
export const RODZAJ = Object.freeze({
  farba: 0, cewka: 1, radiator: 2, lampa: 3,
  wylot: 4,                     // wnętrze wylotu odbieralnika (żar spadających granulek)
  okno: 5, sciana: 6, dno: 7, stal: 8,
  zar: 9,                       // wziernik rurociągu żużla i wnętrze dzwonu ssawy (świeci, gdy płynie żużel)
  gardziel: 10,
  grawLinia: 11,                // listwa dawnej linii okien (nieruchoma, przygaszona) albo światło pierścienia bramy 0 g
                                // (parametr: azymut + 10 × numer linii; linia 3 — pierścień bramy)
  lej: 13                       // stożek leja — całe dno (żar ścian z poziomu metalu)
});

/**
 * Rejestrator trójkątów: pozycja, normalna, barwa, (rodzaj, parametr), ruch (wektor w planie × dosunięcie maszynerii
 * + waga zjazdu pionową prowadnicą — `move`). Bez three; zapis kursorem, bez alokacji.
 */
export class Budowniczy {
  constructor(cap) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.nor = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.aux = new Float32Array(cap * 2);
    this.mov = new Float32Array(cap * 3);
    this.mx = 0;
    this.mz = 0;
    this.my = 0;
    this.n = 0;
    this.r = 0.5; this.g = 0.5; this.b = 0.5;
    this.kind = 0;
    this.par = 0;
    this.over = 0;
  }
  reset() { this.n = 0; }
  paint(r, g, b, kind = 0, par = 0) { this.r = r; this.g = g; this.b = b; this.kind = kind; this.par = par; return this; }
  /**
   * Kolejne wierzchołki jadą z maszynerią: przesunięcie w planie = −(wx, wz) × dosunięcie (0, 0 — stoją), w pionie
   * = −wy × zjazd prowadnicą (wy = +1 segment górny — zjeżdża w dół, −1 dolny — w górę; 0 — wysięgnik, nie zjeżdża).
   */
  move(wx = 0, wz = 0, wy = 0) { this.mx = wx; this.mz = wz; this.my = wy; return this; }
  v(x, y, z, nx, ny, nz) {
    if (this.n >= this.cap) { this.over++; return; }
    const i = this.n++;
    const a = i * 3;
    this.pos[a] = x; this.pos[a + 1] = y; this.pos[a + 2] = z;
    this.nor[a] = nx; this.nor[a + 1] = ny; this.nor[a + 2] = nz;
    this.col[a] = this.r; this.col[a + 1] = this.g; this.col[a + 2] = this.b;
    this.aux[i * 2] = this.kind; this.aux[i * 2 + 1] = this.par;
    this.mov[i * 3] = this.mx; this.mov[i * 3 + 1] = this.mz; this.mov[i * 3 + 2] = this.my;
  }
  /** Czworokąt a-b-c-d (dwa trójkąty), normalna płaska. */
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.v(ax, ay, az, nx, ny, nz); this.v(bx, by, bz, nx, ny, nz); this.v(cx, cy, cz, nx, ny, nz);
    this.v(ax, ay, az, nx, ny, nz); this.v(cx, cy, cz, nx, ny, nz); this.v(dx, dy, dz, nx, ny, nz);
  }
  /** Pudło: środek i trzy półosie (wektory). */
  box(cx, cy, cz, ux, uy, uz, vx, vy, vz, wx, wy, wz) {
    for (let s = -1; s <= 1; s += 2) {
      // ściany ±u, ±v, ±w
      this._face(cx + ux * s, cy + uy * s, cz + uz * s, vx, vy, vz, wx, wy, wz, s);
      this._face(cx + vx * s, cy + vy * s, cz + vz * s, wx, wy, wz, ux, uy, uz, s);
      this._face(cx + wx * s, cy + wy * s, cz + wz * s, ux, uy, uz, vx, vy, vz, s);
    }
  }
  _face(cx, cy, cz, ax, ay, az, bx, by, bz, s) {
    if (s > 0) this.quad(cx - ax - bx, cy - ay - by, cz - az - bz, cx + ax - bx, cy + ay - by, cz + az - bz, cx + ax + bx, cy + ay + by, cz + az + bz, cx - ax + bx, cy - ay + by, cz - az + bz);
    else this.quad(cx - ax - bx, cy - ay - by, cz - az - bz, cx - ax + bx, cy - ay + by, cz - az + bz, cx + ax + bx, cy + ay + by, cz + az + bz, cx + ax - bx, cy + ay - by, cz + az - bz);
  }
  /** Pudło osiowe: środek i połówki wymiarów. */
  abox(cx, cy, cz, hx, hy, hz) { this.box(cx, cy, cz, hx, 0, 0, 0, hy, 0, 0, 0, hz); }
  /** Belka o przekroju w × h między punktami (oś „góry” pomocnicza: y, a dla belki pionowej x). */
  beam(ax, ay, az, bx, by, bz, w, h) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return;
    dx /= len; dy /= len; dz /= len;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; }
    // bok = d × u, góra = bok × d
    let sx = dy * uz - dz * uy;
    let sy = dz * ux - dx * uz;
    let sz = dx * uy - dy * ux;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = sy * dz - sz * dy;
    const ty = sz * dx - sx * dz;
    const tz = sx * dy - sy * dx;
    const hl = len / 2;
    this.box((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, dx * hl, dy * hl, dz * hl, sx * w / 2, sy * w / 2, sz * w / 2, tx * h / 2, ty * h / 2, tz * h / 2);
  }
  /** Rura (stożek ścięty) między punktami: promienie r0, r1; normalne gładkie; `caps` — denka. */
  tube(ax, ay, az, bx, by, bz, r0, r1, sides = 12, caps = false) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return;
    dx /= len; dy /= len; dz /= len;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.95) { ux = 1; uy = 0; }
    let sx = dy * uz - dz * uy;
    let sy = dz * ux - dx * uz;
    let sz = dx * uy - dy * ux;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = sy * dz - sz * dy;
    const ty = sz * dx - sx * dz;
    const tz = sx * dy - sy * dx;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const n0x = sx * c0 + tx * s0;
      const n0y = sy * c0 + ty * s0;
      const n0z = sz * c0 + tz * s0;
      const n1x = sx * c1 + tx * s1;
      const n1y = sy * c1 + ty * s1;
      const n1z = sz * c1 + tz * s1;
      this.v(ax + n0x * r0, ay + n0y * r0, az + n0z * r0, n0x, n0y, n0z);
      this.v(ax + n1x * r0, ay + n1y * r0, az + n1z * r0, n1x, n1y, n1z);
      this.v(bx + n1x * r1, by + n1y * r1, bz + n1z * r1, n1x, n1y, n1z);
      this.v(ax + n0x * r0, ay + n0y * r0, az + n0z * r0, n0x, n0y, n0z);
      this.v(bx + n1x * r1, by + n1y * r1, bz + n1z * r1, n1x, n1y, n1z);
      this.v(bx + n0x * r1, by + n0y * r1, bz + n0z * r1, n0x, n0y, n0z);
      if (caps) {
        this.v(ax, ay, az, -dx, -dy, -dz); this.v(ax + n1x * r0, ay + n1y * r0, az + n1z * r0, -dx, -dy, -dz); this.v(ax + n0x * r0, ay + n0y * r0, az + n0z * r0, -dx, -dy, -dz);
        this.v(bx, by, bz, dx, dy, dz); this.v(bx + n0x * r1, by + n0y * r1, bz + n0z * r1, dx, dy, dz); this.v(bx + n1x * r1, by + n1y * r1, bz + n1z * r1, dx, dy, dz);
      }
    }
  }
  /**
   * Torus: środek c, oś jednostkowa (ax, ay, az), promień R, rurka r. `par` wierzchołka = kąt po obwodzie (0…2π) —
   * materiał cewki prowadzi po nim impuls. `u0…u1` — łuk zamiast pełnego pierścienia (końce zaślepione).
   */
  torus(cx, cy, cz, ax, ay, az, R, r, segU = 64, segV = 10, u0 = 0, u1 = TAU) {
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(ay) > 0.95) { ux = 1; uy = 0; }
    let sx = ay * uz - az * uy;
    let sy = az * ux - ax * uz;
    let sz = ax * uy - ay * ux;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = ay * sz - az * sy;
    const ty = az * sx - ax * sz;
    const tz = ax * sy - ay * sx;
    const keep = this.par;
    const P = (u, v) => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      // kierunek promienia głównego
      const ex = sx * cu + tx * su;
      const ey = sy * cu + ty * su;
      const ez = sz * cu + tz * su;
      const nx = ex * cv + ax * sv;
      const ny = ey * cv + ay * sv;
      const nz = ez * cv + az * sv;
      this.par = u;
      this.v(cx + ex * R + nx * r, cy + ey * R + ny * r, cz + ez * R + nz * r, nx, ny, nz);
    };
    for (let i = 0; i < segU; i++) {
      const ua = u0 + (i / segU) * (u1 - u0);
      const ub = u0 + ((i + 1) / segU) * (u1 - u0);
      for (let j = 0; j < segV; j++) {
        const v0 = (j / segV) * TAU;
        const v1 = ((j + 1) / segV) * TAU;
        P(ua, v0); P(ub, v0); P(ub, v1);
        P(ua, v0); P(ub, v1); P(ua, v1);
      }
    }
    if (u1 - u0 < TAU - 1e-6) {
      // zaślepki końców łuku
      for (const [u, sgn] of [[u0, -1], [u1, 1]]) {
        const cu = Math.cos(u);
        const su = Math.sin(u);
        const ex = sx * cu + tx * su;
        const ey = sy * cu + ty * su;
        const ez = sz * cu + tz * su;
        // styczna do okręgu głównego w punkcie u
        const qx = (tx * cu - sx * su) * sgn;
        const qy = (ty * cu - sy * su) * sgn;
        const qz = (tz * cu - sz * su) * sgn;
        this.par = u;
        this.disc(cx + ex * R, cy + ey * R, cz + ez * R, qx, qy, qz, r, segV);
      }
    }
    this.par = keep;
  }
  /** Krążek (denko) o środku c, normalnej jednostkowej n i promieniu r. */
  disc(cx, cy, cz, nx, ny, nz, r, sides = 20) {
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(ny) > 0.95) { ux = 1; uy = 0; }
    let sx = ny * uz - nz * uy;
    let sy = nz * ux - nx * uz;
    let sz = nx * uy - ny * ux;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = ny * sz - nz * sy;
    const ty = nz * sx - nx * sz;
    const tz = nx * sy - ny * sx;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      this.v(cx, cy, cz, nx, ny, nz);
      this.v(cx + (sx * Math.cos(a0) + tx * Math.sin(a0)) * r, cy + (sy * Math.cos(a0) + ty * Math.sin(a0)) * r, cz + (sz * Math.cos(a0) + tz * Math.sin(a0)) * r, nx, ny, nz);
      this.v(cx + (sx * Math.cos(a1) + tx * Math.sin(a1)) * r, cy + (sy * Math.cos(a1) + ty * Math.sin(a1)) * r, cz + (sz * Math.cos(a1) + tz * Math.sin(a1)) * r, nx, ny, nz);
    }
  }
}

// barwy liniowe (albedo; światło dokłada materiał). Komora jest CIEMNA — im bliżej żaru, tym ciemniej i brudniej
// (wzory stylu strefy huty), żeby głównym światłem i akcentem barwnym była kula.
const STEEL = [0.1, 0.105, 0.115];
const DARK = [0.045, 0.047, 0.052];
const PALE = [0.2, 0.2, 0.2];
const YELLOW = [0.5, 0.33, 0.04];
const COPPER = [0.3, 0.135, 0.06];
const LINING = [0.085, 0.082, 0.082];
const HOSE = [0.03, 0.045, 0.06];
const LAMP_WARM = [1.0, 0.72, 0.42];

/** Azymuty lamp roboczych ścian [rad] (te same odbija kula — `KOMORA.strips`). */
export function wallStripAngles() {
  return KOMORA.strips.map((s) => s.a);
}

/** Pierścień śrub: `n` łbów na okręgu o promieniu R wokół osi jednostkowej (ax, ay, az) w punkcie c. */
function boltRing(B, cx, cy, cz, ax, ay, az, R, n, size = 3) {
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(ay) > 0.95) { ux = 1; uy = 0; }
  let sx = ay * uz - az * uy;
  let sy = az * ux - ax * uz;
  let sz = ax * uy - ay * ux;
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const tx = ay * sz - az * sy;
  const ty = az * sx - ax * sz;
  const tz = ax * sy - ay * sx;
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = cx + (sx * c + tx * s) * R;
    const py = cy + (sy * c + ty * s) * R;
    const pz = cz + (sz * c + tz * s) * R;
    B.tube(px - ax * size * 0.3, py - ay * size * 0.3, pz - az * size * 0.3, px + ax * size, py + ay * size, pz + az * size, size, size, 6, true);
  }
}

/**
 * Maszyneria grzewcza. Segment cewki = łuk trzech zwojów miedzianej rury (krzywizna `arcR`) z płytą nośną, obejmami
 * i króćcami chłodzenia, na PIONOWEJ PROWADNICY głowicy poziomego wysięgnika teleskopowego (tuleja w ścianie + trzy
 * człony). Siatka jest budowana w położeniu ODSUNIĘTYM (`rOut`, wysokość ±`padY`); wierzchołki dostają wektor ruchu:
 * segment i głowica jadą po promieniu w całości (waga 1), człony teleskopu — 1, 2/3, 1/3, tuleja stoi; segment z listwą
 * prowadnicy, osłoną i przewodami zjeżdża do tego w pionie ku równikowi (waga pionowa ±1), głowica nie. Shader
 * przesuwa je o `waga × dosunięcie` i `waga pionowa × zjazd` — segment stoi na stałej szerokości kątowej bryły.
 */
function buildHeaters(B, ri) {
  const M = KOMORA.mach;
  const k = M.thick;
  const half = M.arcHalf * DEG;
  const tiers = [[M.upper, 1], [M.lower, -1]];
  for (const [list, sy] of tiers) {
    for (const deg of list) {
      const a = deg * DEG;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const y = sy * M.padY;
      const r0 = M.rOut;
      // środek krzywizny łuku: na osi wysięgnika, `arcR` za środkiem segmentu
      const ccx = ca * (r0 - M.arcR);
      const ccz = sa * (r0 - M.arcR);
      // największy zjazd prowadnicą: najmniejsza bryła w klatce to mała kula po stopieniu kupy
      const travel = M.padY - (38 * Math.cbrt(80) + M.gap + M.reach) * Math.sin(M.lat * DEG) + M.slide;
      B.move(ca, sa, sy);
      // trzy zwoje (parametr torusa u: kierunek (−sin u, −cos u) → azymut φ = 270° − u)
      const u0 = 1.5 * Math.PI - (a + half);
      const u1 = 1.5 * Math.PI - (a - half);
      B.paint(...COPPER, RODZAJ.cewka, 0);
      for (const dy of [-9.5 * k, 0, 9.5 * k]) B.torus(ccx, y + dy, ccz, 0, 1, 0, M.arcR + (dy === 0 ? 2.5 * k : 0), 5.2 * k, 28, 8, u0, u1);
      // płyta nośna za zwojami (odcinki łuku), obejmy ze śrubami, króćce na końcach
      const seg = 8;
      for (let q = 0; q < seg; q++) {
        const f0 = a - half + (2 * half * q) / seg;
        const f1 = a - half + (2 * half * (q + 1)) / seg;
        const fm = (f0 + f1) / 2;
        const cm = Math.cos(fm);
        const sm = Math.sin(fm);
        const hl = M.arcR * (f1 - f0) / 2 + 1.5;
        B.paint(0.06, 0.063, 0.07, RODZAJ.stal);
        B.box(ccx + cm * (M.arcR + 13 * k), y, ccz + sm * (M.arcR + 13 * k), cm * 4 * k, 0, sm * 4 * k, 0, 19 * k, 0, -sm * hl, 0, cm * hl);
        if (q % 2 === 0) {
          const fc = f0 + (f1 - f0) * 0.5;
          const cc = Math.cos(fc);
          const sc = Math.sin(fc);
          B.paint(...DARK, RODZAJ.stal);
          B.box(ccx + cc * M.arcR, y, ccz + sc * M.arcR, -sc * 4 * k, 0, cc * 4 * k, 0, KOMORA.coilTube + 4.5 * k, 0, cc * 9.5 * k, 0, sc * 9.5 * k);
          B.paint(...PALE, RODZAJ.stal);
          B.tube(ccx + cc * (M.arcR - 9 * k), y + 8 * k, ccz + sc * (M.arcR - 9 * k), ccx + cc * (M.arcR - 13 * k), y + 8 * k, ccz + sc * (M.arcR - 13 * k), 2.6 * k, 2.6 * k, 6, true);
          B.tube(ccx + cc * (M.arcR - 9 * k), y - 8 * k, ccz + sc * (M.arcR - 9 * k), ccx + cc * (M.arcR - 13 * k), y - 8 * k, ccz + sc * (M.arcR - 13 * k), 2.6 * k, 2.6 * k, 6, true);
        }
      }
      for (const f of [a - half, a + half]) {
        const cf = Math.cos(f);
        const sf = Math.sin(f);
        B.paint(...DARK, RODZAJ.stal);
        B.box(ccx + cf * M.arcR, y, ccz + sf * M.arcR, -sf * 5 * k, 0, cf * 5 * k, 0, KOMORA.coilTube + 6 * k, 0, cf * 11 * k, 0, sf * 11 * k);
        // przewód chłodzenia od końca łuku do głowicy
        B.paint(...HOSE, RODZAJ.stal);
        // (do górnego końca listwy prowadnicy — jedzie z segmentem)
        B.tube(ccx + cf * (M.arcR + 10 * k), y + sy * 6 * k, ccz + sf * (M.arcR + 10 * k), ca * (r0 + 21 * k), y + sy * (travel + 14 * k), sa * (r0 + 21 * k), 3.6 * k, 3.6 * k, 8);
      }
      // listwa PROWADNICY PIONOWEJ na grzbiecie płyty nośnej (jedzie z segmentem: przy małej bryle segment zjeżdża nią
      // ku równikowi, listwa przechodzi przez głowicę) i osłona termiczna pod nią od strony żaru
      const railLo = -22 * k;
      const railHi = travel + 22 * k;
      B.paint(...PALE, RODZAJ.stal);
      B.box(ca * (r0 + 20 * k), y + sy * (railLo + railHi) / 2, sa * (r0 + 20 * k), ca * 3 * k, 0, sa * 3 * k, 0, (railHi - railLo) / 2, 0, -sa * 9 * k, 0, ca * 9 * k);
      B.paint(...DARK, RODZAJ.stal);
      B.box(ca * (r0 + 20 * k), y + sy * (railHi + 2 * k), sa * (r0 + 20 * k), ca * 4.5 * k, 0, sa * 4.5 * k, 0, 2.5 * k, 0, -sa * 11 * k, 0, ca * 11 * k);
      B.paint(0.04, 0.04, 0.043, RODZAJ.stal);
      B.box(ca * (r0 + 18.5 * k), y - sy * 31 * k, sa * (r0 + 18.5 * k), ca * 1.6 * k, 0, sa * 1.6 * k, 0, 8 * k, 0, -sa * 30 * k, 0, ca * 30 * k);
      // głowica wysięgnika (nie zjeżdża): korpus z pasem ostrzegawczym, prowadniki listwy
      B.move(ca, sa, 0);
      B.paint(...STEEL, RODZAJ.stal);
      B.box(ca * (r0 + 38 * k), y, sa * (r0 + 38 * k), ca * 15 * k, 0, sa * 15 * k, 0, 17 * k, 0, -sa * 24 * k, 0, ca * 24 * k);
      B.paint(...YELLOW, RODZAJ.farba);
      B.box(ca * (r0 + 49 * k), y + sy * 17.6 * k, sa * (r0 + 49 * k), ca * 3 * k, 0, sa * 3 * k, 0, 1, 0, -sa * 24 * k, 0, ca * 24 * k);
      B.paint(...DARK, RODZAJ.stal);
      for (const side of [-1, 1]) B.box(ca * (r0 + 20.5 * k) - sa * side * 12.5 * k, y, sa * (r0 + 20.5 * k) + ca * side * 12.5 * k, ca * 4 * k, 0, sa * 4 * k, 0, 15 * k, 0, -sa * 3 * k, 0, ca * 3 * k);
      // teleskop: trzy człony (od głowicy) i tuleja w ścianie; każdy z kołnierzem na końcu od strony osi
      const stages = [[r0 + 36, r0 + 134, 14 * k, 12 * k, 1, PALE], [r0 + 40, r0 + 138, 20 * k, 17 * k, 2 / 3, STEEL], [r0 + 44, r0 + 140, 26 * k, 23 * k, 1 / 3, [0.14, 0.14, 0.145]], [r0 + 46, ri, 34 * k, 30 * k, 0, STEEL]];
      for (const [ra, rb, w, h, wgt, col] of stages) {
        B.move(ca * wgt, sa * wgt, 0);
        B.paint(...col, RODZAJ.stal);
        B.beam(ca * ra, y, sa * ra, ca * rb, y, sa * rb, w, h);
        B.paint(...DARK, RODZAJ.stal);
        B.beam(ca * ra, y, sa * ra, ca * (ra + 7), y, sa * (ra + 7), w + 5, h + 5);
      }
      // stopa w ścianie ze śrubami i zastrzał
      B.move(0, 0);
      B.paint(...DARK, RODZAJ.stal);
      B.box(ca * (ri - 4), y, sa * (ri - 4), ca * 4, 0, sa * 4, 0, 36 * k, 0, -sa * 36 * k, 0, ca * 36 * k);
      B.paint(...PALE, RODZAJ.stal);
      for (const [du, dv] of [[-27 * k, -27 * k], [27 * k, -27 * k], [-27 * k, 27 * k], [27 * k, 27 * k]]) {
        const px = ca * (ri - 9) - sa * du;
        const pz = sa * (ri - 9) + ca * du;
        B.tube(px, y + dv, pz, px - ca * 3.5, y + dv, pz - sa * 3.5, 3, 3, 6, true);
      }
      B.paint(...STEEL, RODZAJ.stal);
      B.beam(ca * (ri - 4), y - sy * 62 * k, sa * (ri - 4), ca * (r0 + 66), y - sy * 16 * k, sa * (r0 + 66), 8 * k, 8 * k);
    }
  }
  B.move(0, 0);
}

/**
 * LEJ odbiorczy = CAŁE DNO komory: gładki stożek obrotowy od ściany studni do gardzieli (normalne do wnętrza komory),
 * gardziel z rurą do odlewni. Płaskiej posadzki nie ma. Parametr wierzchołka gardzieli: 0 — ściana, 1 — dno rury (tam
 * żar jest najjaśniejszy). Szwy wykładziny (promieniste, w trzech pasach) rysuje materiał.
 */
function buildFunnel(B) {
  const F = KOMORA.funnel;
  const n = 160;
  const m = (F.rimR - F.throatR) / (F.rimY - F.throatY);
  const nl = Math.sqrt(1 + m * m);
  B.paint(0.07, 0.066, 0.064, RODZAJ.lej, 0);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU;
    const a1 = ((k + 1) / n) * TAU;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    // normalna stożka skierowana do wnętrza i w górę
    const n0x = -c0 / nl; const n0z = -s0 / nl; const ny = m / nl;
    const n1x = -c1 / nl; const n1z = -s1 / nl;
    B.v(c0 * F.rimR, F.rimY, s0 * F.rimR, n0x, ny, n0z);
    B.v(c1 * F.rimR, F.rimY, s1 * F.rimR, n1x, ny, n1z);
    B.v(c1 * F.throatR, F.throatY, s1 * F.throatR, n1x, ny, n1z);
    B.v(c0 * F.rimR, F.rimY, s0 * F.rimR, n0x, ny, n0z);
    B.v(c1 * F.throatR, F.throatY, s1 * F.throatR, n1x, ny, n1z);
    B.v(c0 * F.throatR, F.throatY, s0 * F.throatR, n0x, ny, n0z);
  }
  // gardziel: rura w dół (wnętrze świeci, gdy płynie nią metal) i pierścień wargi
  B.paint(0.03, 0.028, 0.028, RODZAJ.gardziel, 0);
  B.tube(0, F.throatY, 0, 0, F.pipeY, 0, F.throatR, F.throatR - 5, 48);
  B.paint(0.03, 0.028, 0.028, RODZAJ.gardziel, 1);
  B.disc(0, F.pipeY, 0, 0, 1, 0, F.throatR - 5, 48);
  B.paint(...DARK, RODZAJ.stal);
  B.torus(0, F.throatY + 2, 0, 0, 1, 0, F.throatR + 3, 3.6, 64, 6);
}

/**
 * Dawne linie „okien” po obwodzie ścian (po dwa okna na bok 32-kąta) — teraz NIERUCHOME, przygaszone listwy (rodzaj
 * `grawLinia`, parametr = azymut + 10 × numer linii). Sygnalizację grawitacji niesie wyświetlacz (`wyswietlacz.js`).
 */
function buildTrims(B, ri) {
  const K = KOMORA;
  const n = K.sides;
  const tanH = Math.tan(Math.PI / n / 2);
  // okna zasłonięte przez osprzęt górnej linii: gniazdo ssawy, drzwi, drabina
  const blockedTop = [[-8, 8], [285.5, 294.5], [319.5, 324.5]];
  K.grav.lines.forEach((y, li) => {
    for (let k = 0; k < n * 2; k++) {
      const f = k >> 1;
      const am = ((f + 0.5) / n) * TAU;
      const side = k & 1 ? 1 : -1;
      const az = am + side * Math.atan(tanH);
      const deg = az / DEG;
      if (li === 0) {
        if (K.bay.sides.includes(f)) continue;
        if (blockedTop.some(([d0, d1]) => (deg > d0 && deg < d1) || (deg - 360 > d0 && deg - 360 < d1))) continue;
      }
      const c = Math.cos(am);
      const s2 = Math.sin(am);
      const off = side * ri * tanH;
      const cx = c * ri - s2 * off;
      const cz = s2 * ri + c * off;
      // rama okna i szyba (szyba ledwie świeci)
      B.paint(...DARK, RODZAJ.stal);
      B.box(cx - c * 1.6, y, cz - s2 * 1.6, c * 1.6, 0, s2 * 1.6, 0, 12, 0, -s2 * 21.5, 0, c * 21.5);
      B.paint(0.2, 0.9, 1.0, RODZAJ.grawLinia, az + 10 * li);
      B.box(cx - c * 3.5, y, cz - s2 * 3.5, c * 0.6, 0, s2 * 0.6, 0, 8.5, 0, -s2 * 18, 0, c * 18);
    }
  });
}

const SLAG_PIPE = [0.07, 0.064, 0.058];
const CERAMIC = [0.06, 0.05, 0.045];
const SLIT = [0.03, 0.028, 0.03];
const AMBER = [1.0, 0.66, 0.2];
/** Wysokość osi rurociągu żużla pod wysięgnikiem ssawy. */
const lineY = () => KOMORA.ssawa.boomY - KOMORA.ssawa.kneeDrop;

/**
 * Gniazdo ssawy na ścianie (azymut 0): płyta ze śrubami, obudowa napędu z żaluzjami i silnikiem, stała TULEJA
 * teleskopu wysięgnika (człony ruchome rysuje część ruchoma) z zastrzałem, stały odcinek rurociągu żużla pod tuleją.
 */
function buildSuctionSocket(B, ri) {
  const SS = KOMORA.ssawa;
  const y = SS.boomY;
  const xw = ri - 2;
  // płyta gniazda i śruby
  B.paint(...DARK, RODZAJ.stal);
  B.abox(xw - 4, y - 6, 0, 4, 44, 50);
  B.paint(...PALE, RODZAJ.stal);
  for (const [dy, dz] of [[-44, -42], [-44, 42], [30, -42], [30, 42], [-8, -44], [-8, 44], [-44, 0], [30, 0]]) B.tube(xw - 8, y + dy, dz, xw - 12, y + dy, dz, 3.2, 3.2, 6, true);
  // obudowa napędu: korpus, pokrywa z pasem ostrzegawczym, żaluzje chłodzenia, silnik z boku
  B.paint(...STEEL, RODZAJ.stal);
  B.abox(xw - 30, y + 2, 0, 22, 19, 30);
  B.paint(...YELLOW, RODZAJ.farba);
  B.abox(xw - 30, y + 22.5, 0, 22, 1.5, 30);
  for (let k = 0; k < 7; k++) {
    if (k % 2 === 0) B.paint(0.02, 0.02, 0.022, RODZAJ.farba); else B.paint(...YELLOW, RODZAJ.farba);
    B.abox(xw - 49 + k * 6.3, y + 24.3, 0, 3.1, 0.4, 30);
  }
  B.paint(...DARK, RODZAJ.stal);
  for (const sz of [-30.8, 30.8]) for (let k = 0; k < 4; k++) B.abox(xw - 30, y - 9 + k * 7, sz, 15, 1.4, 0.8);
  B.paint(0.07, 0.073, 0.08, RODZAJ.stal);
  B.tube(xw - 34, y + 4, 31, xw - 34, y + 4, 52, 11, 11, 14, true);
  B.paint(...DARK, RODZAJ.stal);
  B.tube(xw - 34, y + 4, 52, xw - 34, y + 4, 56, 7, 7, 10, true);
  // tuleja teleskopu wysięgnika (stała): skrzynka z kołnierzem na wylocie, listwa prowadząca na grzbiecie
  const x0 = SS.parkX + 18;
  B.paint(...STEEL, RODZAJ.stal);
  B.abox((x0 + xw - 8) / 2, y, 0, (xw - 8 - x0) / 2, 12, 14);
  B.paint(...DARK, RODZAJ.stal);
  B.abox(x0 + 3, y, 0, 3, 14.5, 16.5);
  B.abox((x0 + xw - 52) / 2, y + 13.2, 0, (xw - 52 - x0) / 2, 1.2, 3.5);
  // zastrzał tulei do ściany (od spodu) i ucha
  B.paint(0.075, 0.078, 0.086, RODZAJ.stal);
  for (const sz of [-11, 11]) B.beam(x0 + 22, y - 12, sz, xw - 6, y - 46, sz, 5, 7);
  // rurociąg żużla: stały odcinek pod tuleją (obejmy, wziernik), kolano w stronę odbieralnika
  const ly = lineY();
  B.paint(...SLAG_PIPE, RODZAJ.stal);
  B.tube(x0 + 4, ly, 0, xw - 22, ly, 0, 8, 8, 14);
  B.paint(...DARK, RODZAJ.stal);
  for (const x of [x0 + 8, xw - 30]) {
    B.torus(x, ly, 0, 1, 0, 0, 9.4, 1.8, 16, 6);
    B.abox(x, (ly + y - 12) / 2 + 4, 0, 2.2, (y - 12 - ly) / 2 - 3, 2.2);
  }
  B.paint(...SLIT, RODZAJ.zar, 1);
  B.abox((x0 + xw) / 2 - 10, ly + 7.4, 5, 16, 1, 2.2);
  B.abox((x0 + xw) / 2 - 10, ly + 7.4, -5, 16, 1, 2.2);
}

/**
 * Odbieralnik żużla (granulator): rurociąg po ścianie od gniazda ssawy do wylotu nad korytem, koryto na łuku ściany
 * (ściana wewnętrzna pochylona, obrzeże z pasem ostrzegawczym i lampkami własnej płyty grawitacji), pod nim lej
 * zsypowy z kanałem w ścianę, wsporniki. Żaluzje dna koryta rysuje część ruchoma.
 */
function buildReceiver(B, ri) {
  const T = KOMORA.tray;
  const ly = lineY();
  const rp = ri - 17;
  // --- rurociąg po ścianie: z osi wysięgnika łukiem w górę ekranu do wylotu ---
  const a0 = 2.2 * DEG;
  const a1 = T.spoutAz;
  const aEnd = a1 - 20 / rp;                          // łuk po ścianie kończy się przed kolanem (promień kolana 20 j.)
  const segs = 16;
  const py = (u) => ly + (T.pipeY - ly) * Math.min(1, u * 3);
  B.paint(...SLAG_PIPE, RODZAJ.stal);
  B.tube(ri - 24, ly, 0, Math.cos(a0) * rp, py(0), Math.sin(a0) * rp, 8, 8, 12);
  for (let k = 0; k < segs; k++) {
    const u0 = k / segs;
    const u1 = (k + 1) / segs;
    const b0 = a0 + (aEnd - a0) * u0;
    const b1 = a0 + (aEnd - a0) * u1;
    const p0 = [Math.cos(b0) * rp, py(u0), Math.sin(b0) * rp];
    const p1 = [Math.cos(b1) * rp, py(u1), Math.sin(b1) * rp];
    B.paint(...SLAG_PIPE, RODZAJ.stal);
    B.tube(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 8, 8, 12);
    if (k % 3 === 1) {
      // kołnierz i wspornik do ściany
      const dl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) || 1;
      B.paint(...DARK, RODZAJ.stal);
      B.torus(p0[0], p0[1], p0[2], (p1[0] - p0[0]) / dl, (p1[1] - p0[1]) / dl, (p1[2] - p0[2]) / dl, 9.6, 2, 16, 6);
      B.box(Math.cos(b0) * (rp + 9), p0[1], Math.sin(b0) * (rp + 9), Math.cos(b0) * 9, 0, Math.sin(b0) * 9, 0, 3, 0, -Math.sin(b0) * 3, 0, Math.cos(b0) * 3);
    } else if (k >= 3) {
      // wziernik na grzbiecie rury (widać z góry, że żużel płynie)
      const bm = (b0 + b1) / 2;
      const ym = (p0[1] + p1[1]) / 2 + 7.5;
      const hl = rp * (b1 - b0) * 0.36;
      B.paint(...SLIT, RODZAJ.zar, 1);
      B.box(Math.cos(bm) * rp, ym, Math.sin(bm) * rp, -Math.sin(bm) * hl, 0, Math.cos(bm) * hl, 0, 1, 0, Math.cos(bm) * 2.6, 0, Math.sin(bm) * 2.6);
    }
  }
  // kolano ku środkowi koryta i głowica granulująca (wylot w dół)
  const ca = Math.cos(a1);
  const sa = Math.sin(a1);
  const sx = ca * T.spoutR;
  const sz = sa * T.spoutR;
  // (rura po ścianie → kolano w poziomie ku środkowi koryta → kolano w dół: ćwiartki torusa, bez sterczących denek)
  B.paint(...SLAG_PIPE, RODZAJ.stal);
  {
    const er = 20;                                    // promień kolan
    const tx = -sa;                                   // styczna do ściany (kierunek rury po ścianie)
    const tz = ca;
    // kolano 1: z kierunku stycznego w promieniowy (ku osi komory); środek łuku cofnięty po stycznej i ku osi
    const c1x = ca * (rp - er) - tx * er;
    const c1z = sa * (rp - er) - tz * er;
    for (let k = 0; k < 6; k++) {
      const u0 = (k / 6) * Math.PI / 2;
      const u1 = ((k + 1) / 6) * Math.PI / 2;
      const p = (u) => [c1x + ca * er * Math.cos(u) + tx * er * Math.sin(u), c1z + sa * er * Math.cos(u) + tz * er * Math.sin(u)];
      const [x0, z0] = p(u0);
      const [x1, z1] = p(u1);
      B.tube(x0, T.pipeY, z0, x1, T.pipeY, z1, 8, 8, 12);
    }
    // odcinek prosty ku środkowi koryta i kolano 2 w dół
    B.tube(c1x + tx * er, T.pipeY, c1z + tz * er, ca * (T.spoutR + er), T.pipeY, sa * (T.spoutR + er), 8, 8, 12);
    for (let k = 0; k < 6; k++) {
      const u0 = (k / 6) * Math.PI / 2;
      const u1 = ((k + 1) / 6) * Math.PI / 2;
      const p = (u) => [T.spoutR + er - er * Math.sin(u), T.pipeY - er + er * Math.cos(u)];
      const [r0, y0] = p(u0);
      const [r1, y1] = p(u1);
      B.tube(ca * r0, y0, sa * r0, ca * r1, y1, sa * r1, 8, k === 5 ? 9.5 : 8, 12);
    }
  }
  B.tube(sx, T.pipeY - 20, sz, sx, T.spoutY + 12, sz, 9.5, 9.5, 14);
  B.paint(...CERAMIC, RODZAJ.stal);
  B.tube(sx, T.spoutY + 12, sz, sx, T.spoutY, sz, 9.5, 15, 16);
  B.paint(...DARK, RODZAJ.stal);
  B.torus(sx, T.spoutY, sz, 0, 1, 0, 15, 2.2, 20, 6);
  B.torus(sx, T.spoutY + 12, sz, 0, 1, 0, 10.6, 1.8, 16, 6);
  B.paint(...PALE, RODZAJ.stal);
  boltRing(B, sx, T.spoutY + 13.5, sz, 0, 1, 0, 13.5, 8, 2);
  B.paint(1.0, 0.3, 0.05, RODZAJ.wylot);
  B.disc(sx, T.spoutY + 5, sz, 0, -1, 0, 12, 14);
  // wspornik głowicy do ściany
  B.paint(0.075, 0.078, 0.086, RODZAJ.stal);
  B.beam(sx + ca * 8, T.spoutY + 16, sz + sa * 8, ca * ri, T.spoutY - 14, sa * ri, 4, 5);
  // --- koryto: ściana wewnętrzna pochylona, ściany czołowe, wykładzina przy ścianie studni ---
  const n = 24;
  const rB = T.rIn + 9;             // dół ściany wewnętrznej
  const rT = T.rIn - 3;             // góra (odchylona ku kuli)
  const yB = T.floorY - 4;
  for (let k = 0; k < n; k++) {
    const b0 = T.az0 + (T.az1 - T.az0) * k / n;
    const b1 = T.az0 + (T.az1 - T.az0) * (k + 1) / n;
    const c0 = Math.cos(b0);
    const s0 = Math.sin(b0);
    const c1 = Math.cos(b1);
    const s1 = Math.sin(b1);
    // ściana wewnętrzna: lico od strony kuli (osmalone) i od strony granulek (wykładzina)
    B.paint(0.085, 0.088, 0.096, RODZAJ.stal);
    B.quad(c0 * (rB - 4), yB, s0 * (rB - 4), c1 * (rB - 4), yB, s1 * (rB - 4), c1 * (rT - 4), T.rimY, s1 * (rT - 4), c0 * (rT - 4), T.rimY, s0 * (rT - 4));
    B.paint(...CERAMIC, RODZAJ.stal);
    B.quad(c0 * rB, yB, s0 * rB, c0 * rT, T.rimY, s0 * rT, c1 * rT, T.rimY, s1 * rT, c1 * rB, yB, s1 * rB);
    // obrzeże: pas żółto-czarny
    if (k % 2 === 0) B.paint(...YELLOW, RODZAJ.farba); else B.paint(0.02, 0.02, 0.022, RODZAJ.farba);
    B.quad(c0 * (rT - 4.6), T.rimY, s0 * (rT - 4.6), c1 * (rT - 4.6), T.rimY, s1 * (rT - 4.6), c1 * (rT + 0.6), T.rimY, s1 * (rT + 0.6), c0 * (rT + 0.6), T.rimY, s0 * (rT + 0.6));
    B.quad(c0 * (rT - 4.6), T.rimY - 5, s0 * (rT - 4.6), c1 * (rT - 4.6), T.rimY - 5, s1 * (rT - 4.6), c1 * (rT - 4.6), T.rimY, s1 * (rT - 4.6), c0 * (rT - 4.6), T.rimY, s0 * (rT - 4.6));
    // wykładzina przy ścianie studni i rama dna
    B.paint(...CERAMIC, RODZAJ.stal);
    B.quad(c0 * (T.rOut + 1), yB, s0 * (T.rOut + 1), c1 * (T.rOut + 1), yB, s1 * (T.rOut + 1), c1 * (T.rOut + 1), T.rimY + 8, s1 * (T.rOut + 1), c0 * (T.rOut + 1), T.rimY + 8, s0 * (T.rOut + 1));
    B.paint(...DARK, RODZAJ.stal);
    B.quad(c0 * (rB - 4), yB, s0 * (rB - 4), c1 * (rB - 4), yB, s1 * (rB - 4), c1 * (rB + 5), yB, s1 * (rB + 5), c0 * (rB + 5), yB, s0 * (rB + 5));
    // żebra usztywniające ściany wewnętrznej (od strony kuli), co drugi odcinek
    if (k % 2 === 1) {
      B.paint(0.06, 0.062, 0.068, RODZAJ.stal);
      B.beam(c0 * (rB - 5.5), yB, s0 * (rB - 5.5), c0 * (rT - 5.5), T.rimY - 6, s0 * (rT - 5.5), 3, 3.5);
    }
  }
  // lampki własnej płyty grawitacji koryta (bursztyn — ten sam znak co światło grawitacji w dnie komory)
  for (let k = 0; k < 12; k++) {
    const b = T.az0 + (T.az1 - T.az0) * (k + 0.5) / 12;
    B.paint(...AMBER, RODZAJ.lampa, 1.1);
    B.box(Math.cos(b) * (rT - 2), T.rimY + 1.6, Math.sin(b) * (rT - 2), Math.cos(b) * 2.2, 0, Math.sin(b) * 2.2, 0, 1.4, 0, -Math.sin(b) * 5, 0, Math.cos(b) * 5);
  }
  // ściany czołowe (promieniowe) z poręczą
  for (const [b, sgn] of [[T.az0, -1], [T.az1, 1]]) {
    const c = Math.cos(b);
    const s2 = Math.sin(b);
    const rm = (rT - 4 + T.rOut + 1) / 2;
    const hl = (T.rOut + 1 - rT + 4) / 2;
    B.paint(0.085, 0.088, 0.096, RODZAJ.stal);
    B.box(c * rm - s2 * sgn * 2, (yB + T.rimY) / 2, s2 * rm + c * sgn * 2, c * hl, 0, s2 * hl, 0, (T.rimY - yB) / 2, 0, -s2 * 2, 0, c * 2);
    B.paint(...YELLOW, RODZAJ.farba);
    B.tube(c * (rT - 4) - s2 * sgn * 2, T.rimY + 2, s2 * (rT - 4) + c * sgn * 2, c * (T.rOut + 1) - s2 * sgn * 2, T.rimY + 2, s2 * (T.rOut + 1) + c * sgn * 2, 2, 2, 8, true);
  }
  // --- lej zsypowy pod korytem i kanał w ścianę ---
  const yH = T.floorY - 70;
  const am = T.spoutAz;
  const ha = 4.5 * DEG;
  const rMid = (T.rIn + T.rOut) / 2 + 12;
  const corners = [[T.az0, rB - 4], [T.az1, rB - 4], [T.az1, T.rOut + 1], [T.az0, T.rOut + 1]];
  const low = [[am - ha, rMid - 20], [am + ha, rMid - 20], [am + ha, rMid + 20], [am - ha, rMid + 20]];
  B.paint(0.07, 0.072, 0.08, RODZAJ.stal);
  for (let k = 0; k < 4; k++) {
    const [aA, rA] = corners[k];
    const [aB, rBB] = corners[(k + 1) % 4];
    const [aC, rC] = low[(k + 1) % 4];
    const [aD, rD] = low[k];
    B.quad(Math.cos(aA) * rA, yB, Math.sin(aA) * rA, Math.cos(aB) * rBB, yB, Math.sin(aB) * rBB, Math.cos(aC) * rC, yH, Math.sin(aC) * rC, Math.cos(aD) * rD, yH, Math.sin(aD) * rD);
  }
  // szwy leja (kątowniki na krawędziach) i kanał
  B.paint(...DARK, RODZAJ.stal);
  for (let k = 0; k < 4; k++) {
    const [aA, rA] = corners[k];
    const [aD, rD] = low[k];
    B.beam(Math.cos(aA) * rA, yB, Math.sin(aA) * rA, Math.cos(aD) * rD, yH, Math.sin(aD) * rD, 3, 3);
  }
  const cm = Math.cos(am);
  const sm = Math.sin(am);
  B.paint(...SLAG_PIPE, RODZAJ.stal);
  B.tube(cm * rMid, yH + 2, sm * rMid, cm * rMid, yH - 14, sm * rMid, 19, 15, 14);
  B.tube(cm * rMid, yH - 14, sm * rMid, cm * ri, yH - 34, sm * ri, 15, 15, 14);
  B.paint(...DARK, RODZAJ.stal);
  B.torus(cm * rMid, yH - 14, sm * rMid, 0, 1, 0, 16.5, 2.2, 18, 6);
  B.tube(cm * (ri - 7), yH - 32.4, sm * (ri - 7), cm * ri, yH - 34, sm * ri, 20, 20, 16, true);
  // wsporniki koryta do ściany
  B.paint(0.075, 0.078, 0.086, RODZAJ.stal);
  for (const u of [0.04, 0.5, 0.96]) {
    const b = T.az0 + (T.az1 - T.az0) * u;
    if (u === 0.5) continue;
    B.beam(Math.cos(b) * (rB - 2), yB - 2, Math.sin(b) * (rB - 2), Math.cos(b) * ri, yB - 82, Math.sin(b) * ri, 6, 7);
  }
}

/** Część STAŁA komory. Zwraca liczbę wierzchołków. */
// --- ODCIĄG GAZU I TLEN (runda 5) ----------------------------------------------------------------------------------
const HOOD_STEEL = [0.085, 0.088, 0.096];
const HOOD_DARK = [0.05, 0.051, 0.056];
const PIPE_STEEL = [0.15, 0.158, 0.172];
const TANK_PAINT = [0.3, 0.308, 0.322];
const OXY_BAND = [0.035, 0.08, 0.2];

/**
 * Siodło zbiornika leżącego wzdłuż x: obejma po bokach i spodzie walca (od 62° od grzbietu w dół — grzbiet z listwą
 * napełnienia zostaje odkryty), szerokość 2 × `hw`, grubość `th`; denka obejmy na krawędziach.
 */
function saddleBand(B, xs, yc, zc, r, hw, th) {
  const n = 40;
  const t0 = 62 * DEG;
  const t1 = TAU - 62 * DEG;
  const R1 = r + th;
  for (let k = 0; k < n; k++) {
    const a0 = t0 + (t1 - t0) * k / n;
    const a1 = t0 + (t1 - t0) * (k + 1) / n;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    // (kąt od grzbietu: y = cos, z = sin)
    B.v(xs - hw, yc + c0 * R1, zc + s0 * R1, 0, c0, s0); B.v(xs + hw, yc + c0 * R1, zc + s0 * R1, 0, c0, s0); B.v(xs + hw, yc + c1 * R1, zc + s1 * R1, 0, c1, s1);
    B.v(xs - hw, yc + c0 * R1, zc + s0 * R1, 0, c0, s0); B.v(xs + hw, yc + c1 * R1, zc + s1 * R1, 0, c1, s1); B.v(xs - hw, yc + c1 * R1, zc + s1 * R1, 0, c1, s1);
    for (const sx of [-1, 1]) {
      const x = xs + sx * hw;
      B.v(x, yc + c0 * r, zc + s0 * r, sx, 0, 0); B.v(x, yc + c0 * R1, zc + s0 * R1, sx, 0, 0); B.v(x, yc + c1 * R1, zc + s1 * R1, sx, 0, 0);
      B.v(x, yc + c0 * r, zc + s0 * r, sx, 0, 0); B.v(x, yc + c1 * R1, zc + s1 * R1, sx, 0, 0); B.v(x, yc + c1 * r, zc + s1 * r, sx, 0, 0);
    }
  }
}

/** Bok `k` 32-kąta studni ma szczelinę pierścienia górnego (nie: zatoka taśmy, drzwi obsługi). */
function slotted(k) {
  const K = KOMORA;
  const kk = ((k % K.sides) + K.sides) % K.sides;
  return !K.bay.sides.includes(kk) && !K.gaz.ring.skip.includes(kk);
}

/**
 * Bryła obrotowa wokół osi y: łamana przekroju `prof` [[promień, y], …] (krawędzie `skip` pominięte) na łuku a0…a1
 * w `segs` odcinkach; normalne gładkie — w wierzchołkach przekroju średnie normalnych sąsiednich krawędzi (bez
 * pominiętych), na zewnątrz łamanej przy obiegu „od góry ściany przez wlot w dół” (dy, −dr).
 */
function sweepY(B, prof, a0, a1, segs, paintFor, skip = -1) {
  const n = prof.length;
  const en = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = prof[i + 1][0] - prof[i][0];
    const dy = prof[i + 1][1] - prof[i][1];
    const l = Math.hypot(dr, dy) || 1;
    en.push([dy / l, -dr / l]);
  }
  const vn = prof.map((_, i) => {
    let r = 0;
    let y = 0;
    if (i > 0 && i - 1 !== skip) { r += en[i - 1][0]; y += en[i - 1][1]; }
    if (i < n - 1 && i !== skip) { r += en[i][0]; y += en[i][1]; }
    const l = Math.hypot(r, y) || 1;
    return [r / l, y / l];
  });
  for (let i = 0; i < n - 1; i++) {
    if (i === skip) continue;
    paintFor(i);
    const [ra, ya] = prof[i];
    const [rb, yb] = prof[i + 1];
    const [na, nya] = vn[i];
    const [nb, nyb] = vn[i + 1];
    for (let j = 0; j < segs; j++) {
      const b0 = a0 + (a1 - a0) * j / segs;
      const b1 = a0 + (a1 - a0) * (j + 1) / segs;
      const c0 = Math.cos(b0);
      const s0 = Math.sin(b0);
      const c1 = Math.cos(b1);
      const s1 = Math.sin(b1);
      const A = () => B.v(c0 * ra, ya, s0 * ra, c0 * na, nya, s0 * na);
      const Bq = () => B.v(c1 * ra, ya, s1 * ra, c1 * na, nya, s1 * na);
      const C = () => B.v(c1 * rb, yb, s1 * rb, c1 * nb, nyb, s1 * nb);
      const Dq = () => B.v(c0 * rb, yb, s0 * rb, c0 * nb, nyb, s0 * nb);
      A(); Bq(); C(); A(); C(); Dq();
    }
  }
}

/**
 * Dennica (czasza elipsoidalna) o osi (ax, ay, az) w punkcie c: promień r, głębokość `depth`; normalne gładkie.
 */
function dome(B, cx, cy, cz, ax, ay, az, r, depth, sides = 40, rings = 8) {
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(ay) > 0.95) { ux = 1; uy = 0; }
  let sx = ay * uz - az * uy;
  let sy = az * ux - ax * uz;
  let sz = ax * uy - ay * ux;
  const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const tx = ay * sz - az * sy;
  const ty = az * sx - ax * sz;
  const tz = ax * sy - ay * sx;
  const P = (th, ph) => {
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    const ex = sx * ct + tx * st;
    const ey = sy * ct + ty * st;
    const ez = sz * ct + tz * st;
    let nx = ex * cp / r + ax * sp / depth;
    let ny = ey * cp / r + ay * sp / depth;
    let nz = ez * cp / r + az * sp / depth;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    B.v(cx + ex * r * cp + ax * depth * sp, cy + ey * r * cp + ay * depth * sp, cz + ez * r * cp + az * depth * sp, nx, ny, nz);
  };
  for (let i = 0; i < rings; i++) {
    const p0 = (i / rings) * Math.PI / 2;
    const p1 = ((i + 1) / rings) * Math.PI / 2;
    for (let k = 0; k < sides; k++) {
      const t0 = (k / sides) * TAU;
      const t1 = ((k + 1) / sides) * TAU;
      P(t0, p0); P(t1, p0); P(t1, p1);
      P(t0, p0); P(t1, p1); P(t0, p1);
    }
  }
}

/**
 * PIERŚCIEŃ GÓRNY odciągu: ciągła szczelina w ścianie studni pod obrzeżem (wnęka za licem, kratka z żeber) z cienkimi
 * kołnierzami nad i pod szczeliną. Bez własnych świateł — znakiem jest sam gaz. Boki bez szczeliny (zatoka taśmy,
 * drzwi obsługi) zamyka ścianka wnęki.
 */
function buildUpperRing(B, R) {
  const K = KOMORA;
  const G = K.gaz.ring;
  const n = K.sides;
  const deep = (R + G.depth) / R;
  const ri = R * Math.cos(Math.PI / n);
  const ribs = Math.round(360 / n / G.ribDeg);
  for (let k = 0; k < n; k++) {
    if (!slotted(k)) continue;
    const a0 = (k / n) * TAU;
    const a1 = ((k + 1) / n) * TAU;
    const x0 = Math.cos(a0) * R;
    const z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;
    // wnęka: tył, strop, spód (ciemne)
    B.paint(...SLIT, RODZAJ.farba);
    B.quad(x1 * deep, G.y0, z1 * deep, x0 * deep, G.y0, z0 * deep, x0 * deep, G.y1, z0 * deep, x1 * deep, G.y1, z1 * deep);
    B.quad(x0, G.y1, z0, x1, G.y1, z1, x1 * deep, G.y1, z1 * deep, x0 * deep, G.y1, z0 * deep);
    B.quad(x1, G.y0, z1, x0, G.y0, z0, x0 * deep, G.y0, z0 * deep, x1 * deep, G.y0, z1 * deep);
    if (!slotted(k - 1)) B.quad(x0, G.y0, z0, x0 * deep, G.y0, z0 * deep, x0 * deep, G.y1, z0 * deep, x0, G.y1, z0);
    if (!slotted(k + 1)) B.quad(x1, G.y0, z1, x1, G.y1, z1, x1 * deep, G.y1, z1 * deep, x1 * deep, G.y0, z1 * deep);
    // kratka: żebra w poprzek szczeliny
    const am = ((k + 0.5) / n) * TAU;
    const cm = Math.cos(am);
    const sm = Math.sin(am);
    const L = 2 * R * Math.sin(Math.PI / n);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    for (let i = 0; i < ribs; i++) {
      const f = ((i + 0.5) / ribs - 0.5) * L;
      const cx = cm * (ri + G.depth * 0.45) - sm * f;
      const cz = sm * (ri + G.depth * 0.45) + cm * f;
      B.box(cx, (G.y0 + G.y1) / 2, cz, cm * G.depth * 0.45, 0, sm * G.depth * 0.45, 0, (G.y1 - G.y0) / 2, 0, -sm * 1.3, 0, cm * 1.3);
    }
    // kołnierze nad i pod szczeliną (wysunięte z lica)
    B.paint(...HOOD_STEEL, RODZAJ.stal);
    for (const yc of [G.y0 - G.lipH / 2, G.y1 + G.lipH / 2]) {
      B.box(cm * (ri - G.lip / 2), yc, sm * (ri - G.lip / 2), cm * G.lip / 2, 0, sm * G.lip / 2, 0, G.lipH / 2, 0, -sm * (L / 2 + 0.6), 0, cm * (L / 2 + 0.6));
    }
  }
}

/**
 * OKAPY DOLNE odciągu: cztery łukowe okapy na ścianie studni (przekrój `KOMORA.gaz.hoods.profile` obrotowo po łuku).
 * Wlot patrzy w górę i ku osi; za nim ciemne gardło (kreska światła — pas wskaźników `odciag.js`); żaluzje wlotu są
 * w części ruchomej (`buildHoodLouvers`). Dach z żebrami, warga z pasem ostrzegawczym (czytelna z kamery z góry).
 */
function buildHoods(B) {
  const H = KOMORA.gaz.hoods;
  const pr = H.profile;
  const mouth = H.mouth[0];
  const [tr, ty] = H.throat;
  const segs = 30;
  for (const azd of H.az) {
    const a0 = (azd - H.half) * DEG;
    const a1 = (azd + H.half) * DEG;
    sweepY(B, pr, a0, a1, segs, (i) => {
      if (i < mouth) B.paint(...HOOD_STEEL, RODZAJ.stal);
      else if (i === mouth + 1) B.paint(...YELLOW, RODZAJ.farba);
      else B.paint(...HOOD_DARK, RODZAJ.stal);
    }, mouth);
    // gardło za wlotem: od krawędzi dachu w dół do gardła i od gardła do wargi
    sweepY(B, [pr[mouth], [tr, ty], pr[mouth + 1]], a0, a1, segs, () => B.paint(...SLIT, RODZAJ.farba));
    // zaślepki boczne: wachlarz z gardła po przekroju (wnęka wlotu zostaje otwarta), domknięty po ścianie
    B.paint(...HOOD_DARK, RODZAJ.stal);
    for (const [a, sg] of [[a0, -1], [a1, 1]]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = -s * sg;
      const nz = c * sg;
      const ring = pr.slice(mouth + 1).concat(pr.slice(0, mouth + 1));
      for (let i = 0; i < ring.length - 1; i++) {
        const [r0, y0] = ring[i];
        const [r1, y1] = ring[i + 1];
        B.v(c * tr, ty, s * tr, nx, 0, nz); B.v(c * r0, y0, s * r0, nx, 0, nz); B.v(c * r1, y1, s * r1, nx, 0, nz);
      }
    }
    // żebra dachu i listwy mocowania do ściany
    B.paint(...HOOD_DARK, RODZAJ.stal);
    for (let q = 1; q < 4; q++) {
      const a = a0 + (a1 - a0) * q / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      B.beam(c * (pr[0][0] - 1), pr[0][1] + 2.2, s * (pr[0][0] - 1), c * (pr[mouth][0] + 3), pr[mouth][1] + 2.2, s * (pr[mouth][0] + 3), 2.6, 2.4);
    }
    sweepY(B, [[516, pr[0][1] + 4], [511, pr[0][1] + 4], [511, pr[0][1] - 1]], a0 - 0.6 * DEG, a1 + 0.6 * DEG, segs, () => B.paint(...HOOD_DARK, RODZAJ.stal));
    sweepY(B, [[511, pr[pr.length - 1][1] + 1], [511, pr[pr.length - 1][1] - 4], [516, pr[pr.length - 1][1] - 4]], a0 - 0.6 * DEG, a1 + 0.6 * DEG, segs, () => B.paint(...HOOD_DARK, RODZAJ.stal));
  }
}

/**
 * Żaluzje we wlotach okapów (część RUCHOMA): `slats` płytek wzdłuż łuku; otwarcie `STAN.hood` obraca je od położenia
 * w płaszczyźnie wlotu (zamknięte) ku gardłu (otwarte, 72°).
 */
function buildHoodLouvers(B, S) {
  const H = KOMORA.gaz.hoods;
  const pr = H.profile;
  const m0r = pr[H.mouth[0]][0];
  const m0y = pr[H.mouth[0]][1];
  const m1r = pr[H.mouth[0] + 1][0];
  const m1y = pr[H.mouth[0] + 1][1];
  let dr = m1r - m0r;
  let dy = m1y - m0y;
  const len = Math.hypot(dr, dy);
  dr /= len; dy /= len;
  // normalna wlotu (na zewnątrz okapu: w górę i ku osi)
  const mr = dy;
  const my = -dr;
  const open = Math.max(0, Math.min(1, S[STAN.hood]));
  const phi = open * 72 * DEG;
  const sr = dr * Math.cos(phi) - mr * Math.sin(phi);
  const sy = dy * Math.cos(phi) - my * Math.sin(phi);
  const w = len / H.slats * 0.5 * 0.98;
  const segs = 16;
  B.paint(0.11, 0.112, 0.12, RODZAJ.stal);
  for (let h = 0; h < H.az.length; h++) {
    const a0 = (H.az[h] - H.half + 0.7) * DEG;
    const a1 = (H.az[h] + H.half - 0.7) * DEG;
    for (let i = 0; i < H.slats; i++) {
      const f = (i + 0.5) / H.slats * len;
      const cr = m0r + dr * f - mr * 3.5;
      const cy = m0y + dy * f - my * 3.5;
      const ar = cr - sr * w;
      const ay = cy - sy * w;
      const br = cr + sr * w;
      const by = cy + sy * w;
      const nr = sy;
      const ny = -sr;
      for (let j = 0; j < segs; j++) {
        const b0 = a0 + (a1 - a0) * j / segs;
        const b1 = a0 + (a1 - a0) * (j + 1) / segs;
        const c0 = Math.cos(b0);
        const s0 = Math.sin(b0);
        const c1 = Math.cos(b1);
        const s1 = Math.sin(b1);
        B.v(c0 * ar, ay, s0 * ar, c0 * nr, ny, s0 * nr);
        B.v(c1 * ar, ay, s1 * ar, c1 * nr, ny, s1 * nr);
        B.v(c1 * br, by, s1 * br, c1 * nr, ny, s1 * nr);
        B.v(c0 * ar, ay, s0 * ar, c0 * nr, ny, s0 * nr);
        B.v(c1 * br, by, s1 * br, c1 * nr, ny, s1 * nr);
        B.v(c0 * br, by, s0 * br, c0 * nr, ny, s0 * nr);
      }
    }
  }
}

/**
 * RURA ZBIORCZA i ZBIORNIKI TLENU na pokładzie: rura wychodzi z pokładu łukiem przy obrzeżu studni (kołnierz, płyta),
 * biegnie prosto (obejmy na podporach, kołnierze) do rozdzielacza (rura poprzeczna z dennicami), z niego trzy
 * odgałęzienia z zaworami (pokrętło) do leżących zbiorników (walec z dennicami elipsoidalnymi, spoiny obwodowe, pas
 * barwy tlenu, siodła na pokładzie, króćce z kołnierzami, prowadnice listwy napełnienia na grzbiecie) i wyloty do
 * sieci ringu, które schodzą łukiem w pokład przy jego krawędzi. Dolna część zbiorników leży w kołysce pokładu.
 */
/**
 * Rura (przekrój kołowy r) zamieciona wzdłuż drogi `filletPath` od `s0` do `s1`: na odcinkach dwa pierścienie, na
 * łukach co `arcStep` rad; rama bez skrętu (przeniesienie równoległe), normalne gładkie. `paintAt(s)` — opcjonalna
 * zmiana farby przed pierścieniem.
 */
export function sweepTube(B, path, r, sides = 24, s0 = 0, s1 = path.len, arcStep = 0.12) {
  const ss = [s0];
  for (const p of path.pieces) {
    const a = p.s0;
    const b = p.s0 + p.len;
    if (b <= s0 || a >= s1) continue;
    if (a > s0) ss.push(a);
    if (p.type === 'arc') {
      const n = Math.max(2, Math.ceil(p.ang / arcStep));
      for (let i = 1; i < n; i++) { const s = a + (p.len * i) / n; if (s > s0 && s < s1) ss.push(s); }
    }
  }
  ss.push(s1);
  const q = new Float64Array(6);
  let nx = 0; let ny = 0; let nz = 0;
  const ring = [];
  for (let i = 0; i < ss.length; i++) {
    pathSample(path, ss[i], q);
    const tx = q[3]; const ty = q[4]; const tz = q[5];
    if (i === 0) {
      // normalna startowa: dowolna prostopadła do stycznej
      if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; }
    }
    const d = nx * tx + ny * ty + nz * tz;
    nx -= tx * d; ny -= ty * d; nz -= tz * d;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;
    ring.push([q[0], q[1], q[2], nx, ny, nz, bx, by, bz]);
  }
  for (let i = 0; i + 1 < ring.length; i++) {
    const A = ring[i];
    const C = ring[i + 1];
    if (Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]) < 1e-6) continue;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * TAU;
      const a1 = ((k + 1) / sides) * TAU;
      const P = (R, a) => {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ex = R[3] * c + R[6] * s;
        const ey = R[4] * c + R[7] * s;
        const ez = R[5] * c + R[8] * s;
        B.v(R[0] + ex * r, R[1] + ey * r, R[2] + ez * r, ex, ey, ez);
      };
      P(A, a0); P(A, a1); P(C, a1);
      P(A, a0); P(C, a1); P(C, a0);
    }
  }
}

/**
 * Rura zbiorcza tlenu, rozdzielacz, odgałęzienia z zaworami i zbiorniki (runda 6: rura schodzi z kołnierza naczynia
 * pionem do hali, zbiorniki stoją na pokładzie hali — wygląd bez zmian, tylko miejsce). Rysuje to `formowanie/otoczenie.js`
 * (materiał zewnętrzny: słońce hali, cień naczynia) — nie siatka komory.
 */
export function buildOxygenPlant(B) {
  const K = KOMORA;
  const P = K.gaz.pipe;
  const T = K.gaz.tanks;
  const route = gasPipeRoute(0);
  const main = route.main;
  const deck = K.hallY;
  const yd = route.deck;
  const vz = route.vertical[1];
  const rb = Math.round(P.r * 0.75);
  const st = main.pieces[0].type === 'arc' ? main.pieces[0].s : main.pieces[0].a;
  // wyjście z wierzchu kołnierza naczynia: płyta, kołnierz
  B.paint(...HOOD_DARK, RODZAJ.stal);
  B.disc(st[0], K.deckY + 0.7, st[2], 0, 1, 0, P.r + 12, 32);
  B.torus(st[0], K.deckY + 2.4, st[2], 0, 1, 0, P.r + 2.6, 2.3, 32, 6);
  // rura główna od kołnierza do rozdzielacza (łuki gładkie)
  B.paint(...PIPE_STEEL, RODZAJ.stal);
  sweepTube(B, main, P.r, 24, 0, main.len - P.rh + 2);
  // kołnierze rury: za łukiem wyjścia, na początku i końcu pionu, przed rozdzielaczem
  const q = new Float64Array(6);
  const collar = (s) => {
    pathSample(main, s, q);
    B.tube(q[0] - q[3] * 2.5, q[1] - q[4] * 2.5, q[2] - q[5] * 2.5, q[0] + q[3] * 2.5, q[1] + q[4] * 2.5, q[2] + q[5] * 2.5, P.r + 3.2, P.r + 3.2, 24, true);
  };
  B.paint(...HOOD_DARK, RODZAJ.stal);
  const arcs = main.pieces.filter((p) => p.type === 'arc');
  collar(arcs[0].s0 + arcs[0].len + 6);
  collar(arcs[1].s0 - 6);
  collar(arcs[1].s0 + arcs[1].len + 6);
  collar(arcs[2].s0 - 6);
  collar(main.len - P.rh - 6);
  // obejmy na podporach pokładu hali (odcinek po pokładzie, x od końca łuku do rozdzielacza)
  const xa = arcs[2].e[0];
  for (let x = xa + P.shoe * 0.5; x < P.x - 40; x += P.shoe) {
    B.paint(...HOOD_DARK, RODZAJ.stal);
    B.torus(x, yd, vz, 1, 0, 0, P.r + 1.1, 1.6, 24, 5);
    B.abox(x, deck + 1.6, vz, 7, 1.6, P.r + 6);
    B.abox(x, deck + 3.5, vz + P.r + 3, 2.2, 3.5, 2.2);
    B.abox(x, deck + 3.5, vz - P.r - 3, 2.2, 3.5, 2.2);
  }
  // rozdzielacz: rura wzdłuż z z dennicami, siodła
  B.paint(...PIPE_STEEL, RODZAJ.stal);
  B.tube(P.x, yd, P.z0, P.x, yd, P.z1, P.rh, P.rh, 28);
  dome(B, P.x, yd, P.z1, 0, 0, 1, P.rh, P.rh * 0.55, 28, 6);
  dome(B, P.x, yd, P.z0, 0, 0, -1, P.rh, P.rh * 0.55, 28, 6);
  B.paint(...HOOD_DARK, RODZAJ.stal);
  for (const z of [P.z0 + 26, P.z1 - 26]) {
    B.torus(P.x, yd, z, 0, 0, 1, P.rh + 1.1, 1.7, 28, 5);
    B.abox(P.x, deck + 1.6, z, P.rh + 7, 1.6, 7);
  }
  B.torus(P.x - P.rh - 0.5, yd, vz, 1, 0, 0, P.r + 2, 2.2, 24, 5);
  // odgałęzienia z zaworami
  const xv = (P.x + P.rh + T.x0) / 2;
  for (const zk of T.z) {
    B.paint(...PIPE_STEEL, RODZAJ.stal);
    B.tube(P.x + P.rh * 0.6, yd, zk, T.x0 - 6, yd, zk, rb, rb, 20);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    B.tube(xv - 7, yd, zk, xv + 7, yd, zk, rb + 4, rb + 4, 20, true);
    B.tube(xv, yd + rb + 3, zk, xv, yd + rb + 13, zk, 2.6, 2.6, 10);
    B.paint(...YELLOW, RODZAJ.farba);
    B.torus(xv, yd + rb + 14, zk, 0, 1, 0, 8, 1.4, 28, 6);
    B.beam(xv - 8, yd + rb + 14, zk, xv + 8, yd + rb + 14, zk, 1.6, 1.2);
    B.beam(xv, yd + rb + 14, zk - 8, xv, yd + rb + 14, zk + 8, 1.2, 1.6);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    B.torus(P.x + P.rh + 2, yd, zk, 1, 0, 0, rb + 1.5, 1.8, 20, 5);
  }
  // zbiorniki
  const xb0 = T.x0 + T.head;
  const xb1 = T.x1 - T.head;
  for (const zk of T.z) {
    B.paint(...TANK_PAINT, RODZAJ.farba);
    B.tube(xb0, T.y, zk, xb1, T.y, zk, T.r, T.r, 56);
    dome(B, xb0, T.y, zk, -1, 0, 0, T.r, T.head, 56, 10);
    dome(B, xb1, T.y, zk, 1, 0, 0, T.r, T.head, 56, 10);
    // pas barwy tlenu przy dennicy od strony rozdzielacza i spoiny obwodowe
    B.paint(...OXY_BAND, RODZAJ.farba);
    B.tube(xb0 + 6, T.y, zk, xb0 + 18, T.y, zk, T.r + 0.35, T.r + 0.35, 56);
    B.paint(...HOOD_STEEL, RODZAJ.stal);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    for (const x of [xb0, xb1]) B.torus(x, T.y, zk, 1, 0, 0, T.r + 0.2, 0.9, 72, 4);
    // siodła: obejma wokół walca i płyta na pokładzie
    B.paint(...HOOD_DARK, RODZAJ.stal);
    for (const xs of T.saddles) {
      saddleBand(B, xs, T.y, zk, T.r, 6, 2.4);
      B.abox(xs, deck + 2, zk, 10, 2, T.r + 5);
    }
    // prowadnice listwy napełnienia na grzbiecie (dwie listwy wzdłuż i zaślepki)
    {
      const xs = T.x0 + T.head + 8;
      const xe = T.x1 - T.head - 8;
      const len = (xe - xs) / 2;
      for (const sd of [-1, 1]) {
        const t = sd * (T.strip / 2 + 0.03);
        const cy = T.y + Math.cos(t) * (T.r + 1.2);
        const cz = zk + Math.sin(t) * (T.r + 1.2);
        B.box((xs + xe) / 2, cy, cz, len + 3, 0, 0, 0, Math.cos(t) * 1.2, Math.sin(t) * 1.2, 0, -Math.sin(t) * 1.4, Math.cos(t) * 1.4);
      }
      for (const x of [xs - 2.5, xe + 2.5]) B.box(x, T.y + T.r + 1.2, zk, 1.6, 0, 0, 0, 1.4, 0, 0, 0, T.r * (T.strip / 2 + 0.05) + 1.4);
    }
    // króciec wlotu z kołnierzem
    B.paint(...PIPE_STEEL, RODZAJ.stal);
    B.tube(T.x0 - 6, T.y, zk, T.x0 + 8, T.y, zk, rb + 2, rb + 2, 20);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    B.tube(T.x0 - 7.5, T.y, zk, T.x0 - 3.5, T.y, zk, rb + 5, rb + 5, 20, true);
    // wylot do sieci ringu: króciec, rura, łuk w pokład, kołnierz na pokładzie
    const ob = T.y - deck;
    const xo = T.outX - ob;
    B.paint(...PIPE_STEEL, RODZAJ.stal);
    B.tube(T.x1 - 8, T.y, zk, xo, T.y, zk, 9, 9, 18);
    B.torus(xo, deck, zk, 0, 0, -1, ob, 9, 12, 18, 0, -Math.PI / 2);
    B.paint(...HOOD_DARK, RODZAJ.stal);
    B.tube(T.x1 + 1, T.y, zk, T.x1 + 5, T.y, zk, 12.5, 12.5, 18, true);
    B.disc(T.outX, deck + 0.7, zk, 0, 1, 0, 18, 24);
    B.torus(T.outX, deck + 2.2, zk, 0, 1, 0, 11.5, 2, 20, 5);
  }
}

export function buildChamberStatic(B) {
  const K = KOMORA;
  // ściany 2 j. przed licem płyt pokładu zestawu (te same wielokąty — bez migotania głębi przy obrzeżu)
  const R = K.pitR - 2;
  const n = K.sides;
  const y0 = K.funnel.rimY - 10;                    // ściana schodzi tuż pod obrzeże leja (stożek ją przecina)
  const y1 = K.deckY;
  const s = R / K.pitR;
  const bay = { ...K.bay, z0: K.bay.z0 + 2, z1: K.bay.z1 - 2, x0: K.bay.x0 + 2, xa: K.bay.xa * s, xb: K.bay.xb * s };
  const ang = (k) => (k / n) * TAU;
  const ri = R * Math.cos(Math.PI / n);           // lico 32-kąta w połowie boku
  // --- ściany studni (lico do środka) i dno ------------------------------------
  for (let k = 0; k < n; k++) {
    const a0 = ang(k);
    const a1 = ang(k + 1);
    const x0 = Math.cos(a0) * R;
    const z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;
    const top = bay.sides.includes(k) ? bay.floorY : y1;
    B.paint(...LINING, RODZAJ.sciana);
    if (slotted(k)) {
      // PIERŚCIEŃ GÓRNY odciągu: szczelina w ścianie pod obrzeżem (bryły szczeliny i kołnierzy — `buildUpperRing`)
      const G = K.gaz.ring;
      B.quad(x1, y0, z1, x0, y0, z0, x0, G.y0, z0, x1, G.y0, z1);
      B.quad(x1, G.y1, z1, x0, G.y1, z0, x0, top, z0, x1, top, z1);
    } else B.quad(x1, y0, z1, x0, y0, z0, x0, top, z0, x1, top, z1);
  }
  buildUpperRing(B, R);
  // --- zatoka taśmy: dno, boki, ściana czołowa z portalem ----------------------
  B.paint(0.075, 0.075, 0.08, RODZAJ.dno);
  B.quad(bay.x0, bay.floorY, bay.z0, bay.xa, bay.floorY, bay.z0, bay.xb, bay.floorY, bay.z1, bay.x0, bay.floorY, bay.z1);
  B.paint(...LINING, RODZAJ.sciana);
  B.quad(bay.x0, bay.floorY, bay.z0, bay.x0, y1, bay.z0, bay.xa, y1, bay.z0, bay.xa, bay.floorY, bay.z0);
  B.quad(bay.xb, bay.floorY, bay.z1, bay.xb, y1, bay.z1, bay.x0, y1, bay.z1, bay.x0, bay.floorY, bay.z1);
  B.quad(bay.x0, bay.floorY, bay.z1, bay.x0, y1, bay.z1, bay.x0, y1, bay.z0, bay.x0, bay.floorY, bay.z0);
  // portal tunelu taśmy w ścianie czołowej
  const beltY = K.belt.pts[0][1];
  const bz = K.belt.pts[0][2];
  B.paint(0.012, 0.013, 0.016, RODZAJ.farba);
  B.abox(bay.x0 + 3, beltY + 22, bz, 3, 46, 86);
  B.paint(...YELLOW, RODZAJ.farba);
  B.abox(bay.x0 + 7, beltY + 74, bz, 7, 6, 96);
  B.abox(bay.x0 + 7, beltY + 22, bz - 92, 7, 58, 6);
  B.abox(bay.x0 + 7, beltY + 22, bz + 92, 7, 58, 6);
  // kozły pod taśmą w zatoce (co 150 j. wzdłuż x; taśma biegnie łagodnym łukiem — kozły szerokie)
  B.paint(...DARK, RODZAJ.stal);
  for (let x = bay.x0 + 110; x < bay.xa - 40; x += 150) {
    const zc = x < -1080 ? 196 : x > -800 ? 260 : 196 + (260 - 196) * ((x + 1080) / 280);
    B.abox(x, (bay.floorY + beltY - 18) / 2, zc - 58, 7, (beltY - 18 - bay.floorY) / 2, 7);
    B.abox(x, (bay.floorY + beltY - 18) / 2, zc + 58, 7, (beltY - 18 - bay.floorY) / 2, 7);
    B.abox(x, beltY - 22, zc, 9, 4, 72);
  }
  // --- wysięgnik taśmy w studni: dwa dźwigary i poprzeczki, zastrzały do ściany ---
  const bx0 = bay.xb - 10;
  const bx1 = K.belt.pts[K.belt.pts.length - 1][0] + 6;
  const zb = K.belt.pts[K.belt.pts.length - 1][2];
  B.paint(...STEEL, RODZAJ.stal);
  for (const sd of [-1, 1]) {
    B.beam(bx0 - 70, beltY - 30, zb + sd * 62, bx1, beltY - 30, zb + sd * 62, 12, 22);
    B.beam(bx0 - 60, beltY - 170, zb + sd * 62, bx1 - 40, beltY - 40, zb + sd * 62, 10, 10);
  }
  B.paint(...DARK, RODZAJ.stal);
  for (let x = bx0 - 40; x < bx1; x += 46) B.abox(x, beltY - 30, zb, 4, 6, 62);
  // czoło wysięgnika: osłona bębna i OSŁONA TERMICZNA pod końcem taśmy (płyta zwrócona ku kuli)
  B.paint(...YELLOW, RODZAJ.farba);
  B.abox(bx1 + 4, beltY - 12, zb - 70, 10, 16, 5);
  B.abox(bx1 + 4, beltY - 12, zb + 70, 10, 16, 5);
  B.paint(...DARK, RODZAJ.stal);
  B.box(bx1 + 18, beltY - 46, zb, 1.35, -0.65, 0, 0, 0, 78, 13, 27, 0);
  // --- pierścień granicy 0 g (w poprzek taśmy) ----------------------------------
  const gx = K.belt.boundaryX;
  const gy = K.belt.ringY;
  B.paint(...PALE, RODZAJ.stal);
  B.torus(gx, gy, zb, 1, 0, 0, K.belt.ringR, 5.5, 48, 8);
  B.paint(...YELLOW, RODZAJ.farba);
  B.torus(gx - 9, gy, zb, 1, 0, 0, K.belt.ringR + 5, 3.2, 48, 6);
  B.torus(gx + 9, gy, zb, 1, 0, 0, K.belt.ringR + 5, 3.2, 48, 6);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU + 0.196;
    const cy = gy + Math.sin(a) * (K.belt.ringR + 1);
    const cz = zb + Math.cos(a) * (K.belt.ringR + 1);
    B.paint(0.2, 0.9, 1.0, RODZAJ.grawLinia, (k / 16) * TAU + 30);
    B.box(gx, cy, cz, 7, 0, 0, 0, Math.sin(a) * 4.5, Math.cos(a) * 4.5, 0, Math.cos(a) * 7, -Math.sin(a) * 7);
  }
  B.paint(...STEEL, RODZAJ.stal);
  for (const sd of [-1, 1]) B.beam(gx, gy - 74, zb + sd * 74, gx, beltY - 30, zb + sd * 62, 9, 9);
  // --- maszyneria grzewcza: segmenty cewek na wysięgnikach teleskopowych --------------------------------------
  buildHeaters(B, ri);
  // --- ssawa żużla: gniazdo i tuleja wysięgnika; odbieralnik z rurociągiem po ścianie ---------------------------
  buildSuctionSocket(B, ri);
  buildReceiver(B, ri);
  // --- lampy robocze ścian: nieregularne listwy (część zgaszona) -----------------
  for (const st of K.strips) {
    // (listwa za korytem odbieralnika byłaby zasłonięta — zostaje tylko jako odbicie w kuli)
    if (st.a > K.tray.az0 - 0.04 && st.a < K.tray.az1 + 0.04) continue;
    const c = Math.cos(st.a);
    const s2 = Math.sin(st.a);
    if (st.gain > 0) {
      B.paint(...LAMP_WARM, RODZAJ.lampa, 0.95 * st.gain);
      B.box(c * (ri - 4), st.y, s2 * (ri - 4), c * 2, 0, s2 * 2, 0, st.half, 0, -s2 * 3.6, 0, c * 3.6);
    }
    // oprawa: korpus z daszkiem (zgaszona lampa to sama oprawa)
    B.paint(...DARK, RODZAJ.stal);
    B.box(c * (ri - 1.5), st.y, s2 * (ri - 1.5), c * 2, 0, s2 * 2, 0, st.half + 6, 0, -s2 * 8, 0, c * 8);
    B.box(c * (ri - 6), st.y + st.half + 5, s2 * (ri - 6), c * 7, 0, s2 * 7, 0, 1.5, 0, -s2 * 9, 0, c * 9);
  }
  // --- pomost obsługi z barierką (skala): łuk przy ścianie, drzwi i drabina na pokład ---
  const py = K.deckY - 74;
  const a0 = 212 * DEG;
  const a1 = 328 * DEG;
  const segs = 20;
  const rIn = ri - 46;
  for (let k = 0; k < segs; k++) {
    const u0 = a0 + (a1 - a0) * k / segs;
    const u1 = a0 + (a1 - a0) * (k + 1) / segs;
    const c0 = Math.cos(u0);
    const s0 = Math.sin(u0);
    const c1 = Math.cos(u1);
    const s1 = Math.sin(u1);
    // podest (krata) i belka czołowa
    B.paint(0.06, 0.062, 0.068, RODZAJ.stal);
    B.quad(c0 * rIn, py, s0 * rIn, c1 * rIn, py, s1 * rIn, c1 * ri, py, s1 * ri, c0 * ri, py, s0 * ri);
    B.quad(c0 * rIn, py - 5, s0 * rIn, c0 * ri, py - 5, s0 * ri, c1 * ri, py - 5, s1 * ri, c1 * rIn, py - 5, s1 * rIn);
    B.paint(...YELLOW, RODZAJ.farba);
    B.quad(c0 * rIn, py - 5, s0 * rIn, c1 * rIn, py - 5, s1 * rIn, c1 * rIn, py + 3, s1 * rIn, c0 * rIn, py + 3, s0 * rIn);
    // poręcze
    B.paint(...YELLOW, RODZAJ.farba);
    B.tube(c0 * (rIn + 1), py + 26, s0 * (rIn + 1), c1 * (rIn + 1), py + 26, s1 * (rIn + 1), 1.5, 1.5, 6);
    B.tube(c0 * (rIn + 1), py + 14, s0 * (rIn + 1), c1 * (rIn + 1), py + 14, s1 * (rIn + 1), 1.1, 1.1, 6);
    // słupek i wspornik pod podestem (co drugi odcinek)
    B.tube(c0 * (rIn + 1), py, s0 * (rIn + 1), c0 * (rIn + 1), py + 26, s0 * (rIn + 1), 1.4, 1.4, 6);
    if (k % 2 === 0) {
      B.paint(...DARK, RODZAJ.stal);
      B.beam(c0 * (rIn + 4), py - 5, s0 * (rIn + 4), c0 * ri, py - 40, s0 * ri, 4, 4);
    }
  }
  {
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    B.paint(...YELLOW, RODZAJ.farba);
    B.tube(c1 * (rIn + 1), py, s1 * (rIn + 1), c1 * (rIn + 1), py + 26, s1 * (rIn + 1), 1.4, 1.4, 6);
    // drzwi obsługi w ścianie (środek pomostu) i drabina na pokład przy końcu
    const ad = 290 * DEG;
    const cd = Math.cos(ad);
    const sd = Math.sin(ad);
    B.paint(...DARK, RODZAJ.stal);
    B.box(cd * (ri - 2), py + 30, sd * (ri - 2), cd * 2, 0, sd * 2, 0, 30, 0, -sd * 17, 0, cd * 17);
    B.paint(...YELLOW, RODZAJ.farba);
    B.box(cd * (ri - 3), py + 62, sd * (ri - 3), cd * 2.5, 0, sd * 2.5, 0, 3, 0, -sd * 21, 0, cd * 21);
    B.paint(0.2, 0.9, 1.0, RODZAJ.lampa, 0.9);
    B.box(cd * (ri - 5), py + 68, sd * (ri - 5), cd * 1.5, 0, sd * 1.5, 0, 1.6, 0, -sd * 9, 0, cd * 9);
    const al = 322 * DEG;
    const cl = Math.cos(al);
    const sl2 = Math.sin(al);
    B.paint(...YELLOW, RODZAJ.farba);
    for (const side of [-1, 1]) B.tube(cl * (ri - 5) - sl2 * side * 7, py, sl2 * (ri - 5) + cl * side * 7, cl * (ri - 5) - sl2 * side * 7, y1 + 4, sl2 * (ri - 5) + cl * side * 7, 1.3, 1.3, 6);
    for (let y = py + 8; y < y1; y += 8) B.tube(cl * (ri - 5) - sl2 * 7, y, sl2 * (ri - 5) + cl * 7, cl * (ri - 5) + sl2 * 7, y, sl2 * (ri - 5) - cl * 7, 0.9, 0.9, 5);
  }
  // --- lej odbiorczy (całe dno) i nieruchome listwy dawnych linii okien ---------------------------------------------
  buildFunnel(B);
  buildTrims(B, ri);
  // --- odciąg gazu: okapy dolne na ścianie (rura zbiorcza i zbiorniki tlenu stoją od rundy 6 w hali — siatka
  // otoczenia `formowanie/otoczenie.js`, `buildOxygenPlant`) ---------------------------------------------------------
  buildHoods(B);
  // --- radiatory na pokładzie: żebra (wysokość nad pokładem ściskana × 0,42 jak w zestawie portowym) ---
  for (const [x0, z0, x1, z1] of K.radiators) {
    const alongX = x1 - x0 > z1 - z0;
    const m = Math.floor((alongX ? z1 - z0 : x1 - x0) / 22);
    for (let k = 0; k < m; k++) {
      const t = (k + 0.5) / m;
      B.paint(0.11, 0.1, 0.1, RODZAJ.radiator, t);
      if (alongX) B.abox((x0 + x1) / 2, y1 + 8, z0 + (z1 - z0) * t, (x1 - x0) / 2 - 10, 7, 3.2);
      else B.abox(x0 + (x1 - x0) * t, y1 + 8, (z0 + z1) / 2, 3.2, 7, (z1 - z0) / 2 - 10);
    }
  }
  return B.n;
}

/**
 * Część RUCHOMA ze stanu `S` (tablica `STAN`, już wymieszana prev → cur): ssawa żużla i żaluzje dna odbieralnika.
 * Ssawa: dwa człony teleskopu wysięgnika wysuwające się z tulei w ścianie, głowica z kolanem, wahliwa teleskopowa
 * szyja z dzwonem (ceramiczny lej z kołnierzem i osłoną termiczną), siłowniki wahania, rurociąg żużla pod wysięgnikiem.
 */
export function buildChamberDynamic(B, S) {
  B.reset();
  B.move(0, 0);
  const K = KOMORA;
  const SS = K.ssawa;
  const T = K.tray;
  const y = SS.boomY;
  const hx = S[STAN.headX];
  const kx = hx;
  const ky = y - SS.kneeDrop;
  const mx = S[STAN.mouthX];
  const my = S[STAN.mouthY];
  const ext = SS.parkX - hx;
  const xLim = SS.wallX - 14;
  // --- człony teleskopu wysięgnika (wchodzą jeden w drugi i w tuleję przy ścianie) ---
  const x2 = SS.parkX + 22 - ext / 2;
  const x3 = hx - 6;
  const e2 = Math.min(x2 + 130, xLim);
  const e3 = Math.min(x3 + 166, xLim);
  B.paint(0.085, 0.088, 0.096, RODZAJ.stal);
  B.abox((x2 + e2) / 2, y, 0, (e2 - x2) / 2, 9.5, 11.5);
  B.paint(...PALE, RODZAJ.stal);
  B.abox((x3 + e3) / 2, y, 0, (e3 - x3) / 2, 7.5, 9);
  B.paint(...DARK, RODZAJ.stal);
  B.abox(x2 + 2.5, y, 0, 2.5, 11.5, 13.5);
  // listwa zębata na grzbiecie członu wewnętrznego
  B.abox((x3 + e3) / 2, y + 8.4, 0, (e3 - x3) / 2, 0.9, 2.6);
  // --- rurociąg żużla pod wysięgnikiem (teleskop jak wysięgnik), wieszak przy głowicy ---
  const pLim = SS.wallX - 30;
  B.paint(...SLAG_PIPE, RODZAJ.stal);
  B.tube(x2 + 4, ky, 0, Math.min(x2 + 134, pLim), ky, 0, 6.8, 6.8, 12);
  B.paint(0.095, 0.09, 0.085, RODZAJ.stal);
  B.tube(hx + 6, ky, 0, Math.min(hx + 172, pLim), ky, 0, 5.6, 5.6, 12);
  B.paint(...DARK, RODZAJ.stal);
  B.abox(hx + 24, (ky + y - 7.5) / 2 + 2.5, 0, 1.6, (y - 7.5 - ky) / 2 - 2.5, 1.6);
  B.torus(hx + 24, ky, 0, 1, 0, 0, 6.8, 1.4, 12, 6);
  if (ext > 70) {
    B.paint(...SLIT, RODZAJ.zar, 1);
    B.abox(hx + 62, ky + 5.2, 0, 16, 0.9, 2.2);
    if (ext > 140) B.abox(hx + 118, ky + 5.2, 0, 16, 0.9, 2.2);
  }
  // --- głowica: korpus na końcu wysięgnika, policzki z pasem ostrzegawczym, kolano (oś wahania szyi) ---
  B.paint(0.085, 0.088, 0.096, RODZAJ.stal);
  B.abox(hx + 2, y - 2, 0, 15, 15, 13.5);
  B.paint(...DARK, RODZAJ.stal);
  B.abox(hx + 2, y + 14.2, 0, 11, 1.4, 9);
  for (const sz of [-14.2, 14.2]) {
    // policzki: płyta schodząca do osi kolana
    B.paint(0.07, 0.073, 0.08, RODZAJ.stal);
    B.box(hx + 1, (y + ky) / 2 - 4, sz, 13, 0, 0, 0, (y - ky) / 2 + 10, 0, 0, 0, 1.6);
    for (let k = 0; k < 5; k++) {
      if (k % 2 === 0) B.paint(...YELLOW, RODZAJ.farba); else B.paint(0.02, 0.02, 0.022, RODZAJ.farba);
      B.abox(hx - 9.6 + k * 5.3, y + 8, sz * 1.13, 2.65, 2.2, 0.4);
    }
    B.paint(...PALE, RODZAJ.stal);
    for (const [bx2, by2] of [[-9, -6], [11, -6], [-9, 4], [11, 4]]) B.tube(hx + bx2, y + by2 - 6, sz * 1.1, hx + bx2, y + by2 - 6, sz * 1.19, 1.3, 1.3, 6, true);
  }
  B.paint(...DARK, RODZAJ.stal);
  B.tube(kx, ky, -18.5, kx, ky, 18.5, 10.5, 10.5, 16, true);
  B.paint(...PALE, RODZAJ.stal);
  B.tube(kx, ky, 18.5, kx, ky, 21, 4, 4, 8, true);
  B.tube(kx, ky, -21, kx, ky, -18.5, 4, 4, 8, true);
  // przewody na grzbiecie głowicy
  B.paint(...HOSE, RODZAJ.stal);
  B.tube(hx + 12, y + 15.5, 4, hx + 44, y + 11, 4, 2.2, 2.2, 6);
  B.tube(hx + 12, y + 15.5, -4, hx + 44, y + 11, -4, 2.2, 2.2, 6);
  // --- szyja: tuleja przy kolanie, rura wysuwna z wziernikami, dzwon ---
  let dx = mx - kx;
  let dy = my - ky;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len; dy /= len;
  // normalna szyi w płaszczyźnie (w górę)
  const nx = dy;
  const ny = -dx;
  const bell = SS.bell;                               // długość dzwonu
  const sl = Math.max(14, Math.min(len - bell - 4, 46));
  B.paint(...STEEL, RODZAJ.stal);
  B.tube(kx + dx * 6, ky + dy * 6, 0, kx + dx * sl, ky + dy * sl, 0, SS.pipeR + 3.2, SS.pipeR + 3.2, 16);
  B.paint(...DARK, RODZAJ.stal);
  B.tube(kx + dx * (sl - 5), ky + dy * (sl - 5), 0, kx + dx * sl, ky + dy * sl, 0, SS.pipeR + 5, SS.pipeR + 5, 16, true);
  const e0 = sl - 3;
  const e1 = len - bell + 2;
  if (e1 > e0) {
    B.paint(...SLAG_PIPE, RODZAJ.stal);
    B.tube(kx + dx * e0, ky + dy * e0, 0, kx + dx * e1, ky + dy * e1, 0, SS.pipeR, SS.pipeR, 14);
    // wzierniki: szczeliny na grzbiecie i bokach rury (świecą, gdy płynie żużel)
    const wl = (e1 - e0 - 8) / 2;
    if (wl > 3) {
      const wc = (e0 + e1) / 2;
      B.paint(...SLIT, RODZAJ.zar, 1);
      B.box(kx + dx * wc + nx * (SS.pipeR - 0.2), ky + dy * wc + ny * (SS.pipeR - 0.2), 0, dx * wl, dy * wl, 0, nx * 0.9, ny * 0.9, 0, 0, 0, 2.4);
      for (const sz of [-1, 1]) B.box(kx + dx * wc, ky + dy * wc, sz * (SS.pipeR - 0.2), dx * wl, dy * wl, 0, nx * 2.2, ny * 2.2, 0, 0, 0, 0.9);
    }
  }
  // dzwon: lej ceramiczny, warga, kołnierz ze śrubami, osłona termiczna i żebra
  const bx = mx - dx * bell;
  const by = my - dy * bell;
  B.paint(...CERAMIC, RODZAJ.stal);
  B.tube(bx, by, 0, mx - dx * 12, my - dy * 12, 0, SS.pipeR + 1.5, SS.mouthR - 4, 24);
  B.tube(mx - dx * 12, my - dy * 12, 0, mx, my, 0, SS.mouthR - 4, SS.mouthR, 24);
  B.paint(...DARK, RODZAJ.stal);
  B.torus(mx, my, 0, dx, dy, 0, SS.mouthR, 2.3, 24, 6);
  B.torus(bx, by, 0, dx, dy, 0, SS.pipeR + 3.2, 2.4, 18, 6);
  // wężownica chłodzenia na leju (dwa zwoje miedzianej rurki) i przewód chłodziwa wzdłuż szyi
  B.paint(...COPPER, RODZAJ.stal);
  for (const [back, rr] of [[bell * 0.66, SS.pipeR + 7.6], [bell * 0.42, SS.mouthR - 5.4]]) B.torus(mx - dx * back, my - dy * back, 0, dx, dy, 0, rr, 2, 24, 6);
  B.paint(...HOSE, RODZAJ.stal);
  B.tube(mx - dx * bell * 0.66 + nx * (SS.pipeR + 9), my - dy * bell * 0.66 + ny * (SS.pipeR + 9), 3, kx + dx * (sl + 2) + nx * (SS.pipeR + 4.4), ky + dy * (sl + 2) + ny * (SS.pipeR + 4.4), 3, 1.8, 1.8, 6);
  B.paint(...PALE, RODZAJ.stal);
  boltRing(B, bx - dx * 1.6, by - dy * 1.6, 0, -dx, -dy, 0, SS.pipeR + 6.2, 8, 1.9);
  // osłona termiczna: tarcza za dzwonem (od strony szyi), trzy żebra do wargi
  B.paint(0.04, 0.04, 0.043, RODZAJ.stal);
  B.tube(bx - dx * 4.5, by - dy * 4.5, 0, bx - dx * 2.6, by - dy * 2.6, 0, SS.mouthR + 8, SS.mouthR + 8, 24, true);
  B.paint(0.06, 0.062, 0.068, RODZAJ.stal);
  for (let k = 0; k < 3; k++) {
    const a2 = k * TAU / 3 + 0.5;
    const ox = nx * Math.cos(a2);
    const oy = ny * Math.cos(a2);
    const oz = Math.sin(a2);
    B.beam(bx - dx * 2 + ox * (SS.pipeR + 5), by - dy * 2 + oy * (SS.pipeR + 5), oz * (SS.pipeR + 5), mx - dx * 3 + ox * (SS.mouthR + 0.5), my - dy * 3 + oy * (SS.mouthR + 0.5), oz * (SS.mouthR + 0.5), 2.2, 3);
  }
  // wnętrze dzwonu: żar ściąganego żużla
  B.paint(1.0, 0.3, 0.05, RODZAJ.zar, 1);
  B.disc(mx - dx * 13, my - dy * 13, 0, dx, dy, 0, SS.mouthR - 5.5, 20);
  // --- siłowniki wahania szyi: od grzbietu głowicy do obejmy na tulei ---
  for (const sz of [-18, 18]) {
    const ax = hx + 13;
    const ay = y + 4;
    const tx = kx + dx * (sl - 9) + nx * 6;
    const ty = ky + dy * (sl - 9) + ny * 6;
    const cxm = ax + (tx - ax) * 0.56;
    const cym = ay + (ty - ay) * 0.56;
    B.paint(...DARK, RODZAJ.stal);
    B.tube(ax, ay, sz, cxm, cym, sz, 3.4, 3.4, 8, true);
    B.paint(...PALE, RODZAJ.stal);
    B.tube(cxm, cym, sz, tx, ty, sz, 1.9, 1.9, 6);
    B.paint(...DARK, RODZAJ.stal);
    B.tube(tx, ty, sz - 1.6, tx, ty, sz + 1.6, 3.2, 3.2, 8, true);
  }
  // --- żaluzje dna odbieralnika: lamele promieniowe, przy zsypie obracają się wokół swoich osi ---
  const dump = S[STAN.trayDump];
  let open = dump * 5;
  open = open >= 1 ? 1 : open * open * (3 - 2 * open);
  let shut = (dump - 0.84) / 0.16;
  shut = shut <= 0 ? 0 : shut >= 1 ? 1 : shut * shut * (3 - 2 * shut);
  const phi = open * (1 - shut) * 76 * DEG;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const NL = 16;
  const r0 = T.rIn + 7;
  const r1 = T.rOut + 1;
  const rm = (r0 + r1) / 2;
  const hw = rm * (T.az1 - T.az0) / NL / 2 - 0.8;
  for (let k = 0; k < NL; k++) {
    const b = T.az0 + (T.az1 - T.az0) * (k + 0.5) / NL;
    const c = Math.cos(b);
    const s2 = Math.sin(b);
    B.paint(k % 2 ? 0.05 : 0.058, k % 2 ? 0.052 : 0.06, k % 2 ? 0.058 : 0.066, RODZAJ.stal);
    B.box(c * rm, T.floorY - 2, s2 * rm, c * (r1 - r0) / 2, 0, s2 * (r1 - r0) / 2, -s2 * hw * cp, -hw * sp, c * hw * cp, -s2 * sp * 1.3, cp * 1.3, c * sp * 1.3);
  }
  // --- żaluzje we wlotach okapów odciągu (otwarcie `STAN.hood`) ---
  buildHoodLouvers(B, S);
  return B.n;
}

/** Materiał wyposażenia (jeden graf; siatka stała i ruchoma mają te same atrybuty). */
export function createEquipmentMaterial(U) {
  const vP = varyingProperty('vec3', 'vWyP');
  const vN = varyingProperty('vec3', 'vWyN');
  const vC = varyingProperty('vec3', 'vWyC');
  const vK = varyingProperty('vec2', 'vWyK');
  const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
  const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
  const vertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    // maszyneria: segmenty cewek i człony wysięgników jadą ku osi komory (wektor ruchu × dosunięcie); klatka idzie
    // za środkiem bryły: każdy wysięgnik o rzut przesunięcia `U.cage` na swój kierunek, segmenty prowadnicą także
    // w pionie (zjazd ku równikowi `U.mach.z` + przesunięcie klatki w pionie)
    const mv = attribute('aM', 'vec3');
    const dirL = float(0.0).toVar();
    dirL.assign(max(length(mv.xy), 1e-4));
    const push = float(0.0).toVar();
    push.assign(U.mach.x.sub(dot(mv.xy, U.cage.xz).div(dirL)));
    const p = vec3(0.0).toVar();
    p.assign(vec3(p0.x.sub(mv.x.mul(push)), p0.y.sub(mv.z.mul(U.mach.z)).add(abs(mv.z).mul(U.cage.y)), p0.z.sub(mv.y.mul(push))));
    vP.assign(p);
    vN.assign(attribute('aN', 'vec3'));
    vC.assign(attribute('aC', 'vec3'));
    vK.assign(attribute('aK', 'vec2'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = V3(vP);
    const V = V3(normalize(U.cam.sub(P)));
    const N0 = V3(normalize(vN));
    const N = V3(N0.mul(sign(dot(N0, V).add(1e-5))));
    const kind = F1(floor(vK.x.add(0.5)));
    const par = vK.y;
    const time = U.ball.w;
    const is = (k) => F1(float(1.0).sub(min(abs(kind.sub(k)), 1.0)));
    const isCoil = is(1.0);
    const isRad = is(2.0);
    const isLamp = is(3.0);
    const isCatch = is(4.0);                                              // wnętrze wylotu odbieralnika
    const isWall = is(6.0);
    const isFloor = is(7.0);
    const isHot = is(9.0);
    const isThroat = is(10.0);
    const isSign = is(11.0);
    const isFunnel = is(13.0);
    const isSteel = F1(is(8.0).add(isCoil).add(isHot));
    // --- ściany: wymurówka. Na wysokości kuli (|y| < 250) pas z mniejszych kształtek kładzionych na mijankę, wyżej
    // i niżej duże płyty stalowe; wzór bez pochodnych: szew ma stałą szerokość w jednostkach -------------------------
    const phi = atan(P.z, P.x);
    const belt = F1(float(1.0).sub(smoothstep(242.0, 250.0, abs(P.y))).mul(isWall));
    const rowB = floor(P.y.div(47.5));
    const wuB = vec2(phi.mul(64.0 / TAU).add(mod(rowB, 2.0).mul(0.5)), P.y.div(47.5));
    const wuP = vec2(phi.mul(32.0 / TAU), P.y.div(150.0));
    const wuF = vec2(P.x.div(130.0), P.z.div(130.0));
    // lej (całe dno): wykładzina ogniotrwała z PROMIENISTYMI szwami w trzech pasach — 8 płyt przy gardzieli, 16
    // w środku, 32 przy ścianie (szwy zewnętrznego pasa trafiają w naroża 32-kąta studni); pasy dzielą dwa szwy obwodowe
    const rho = length(vec2(P.x, P.z));
    const z1 = step(FUN_R1, rho);
    const z2 = step(FUN_R2, rho);
    const nSeg = F1(float(8.0).add(z1.mul(8.0)).add(z2.mul(16.0)));
    const zr0 = mix(mix(float(FUN.throatR), float(FUN_R1), z1), float(FUN_R2), z2);
    const zr1 = mix(mix(float(FUN_R1), float(FUN_R2), z1), float(FUN.rimR), z2);
    const wuL = vec2(phi.mul(nSeg.div(TAU)), z1.add(z2).add(clamp(rho.sub(zr0).div(zr1.sub(zr0)), 0.0, 0.9999)));
    const wu = vec2(0.0).toVar();
    wu.assign(mix(mix(mix(wuF, wuP, isWall), wuB, belt), wuL, isFunnel));
    const cellId = floor(wu);
    const cf = fract(wu);
    const su = mix(mix(mix(float(130.0), float(102.0), isWall), float(51.0), belt), rho.mul(TAU).div(nSeg), isFunnel);
    const sv2 = mix(mix(mix(float(130.0), float(150.0), isWall), float(47.5), belt), zr1.sub(zr0).mul(FUN_SLANT), isFunnel);
    const edge = min(min(cf.x, float(1.0).sub(cf.x)).mul(su), min(cf.y, float(1.0).sub(cf.y)).mul(sv2));
    // (szwy wykładziny leja szersze: z kamery z góry lej leży głęboko, wąski szew by zniknął)
    const seam = F1(float(1.0).sub(smoothstep(mix(float(0.9), float(2.2), isFunnel), mix(float(2.8), float(6.5), isFunnel), edge)));
    const hsh = F1(hash21(cellId.add(vec2(3.0, 17.0))));
    const tint = mix(hsh.mul(0.4).add(0.8), hsh.mul(0.75).add(0.42), isFunnel);
    const wallish = F1(max(max(isWall, isFloor), isFunnel));
    // osmalenie i przebarwienie cieplne: najmocniej na wysokości kuli, zacieki sadzy w dół, plama pod kulą na dnie
    const heatBand = F1(exp(P.y.div(300.0).mul(P.y.div(300.0)).negate()).mul(isWall).add(exp(rho.div(400.0).mul(rho.div(400.0)).negate()).mul(max(isFloor, isFunnel))));
    const streakN = hash21(vec2(floor(phi.mul(170.0)), 7.0)).mul(0.6).add(hash21(vec2(floor(phi.mul(61.0)), 3.0)).mul(0.4));
    // zacieki: na ścianie w dół, na stożku promieniście ku gardzieli (ślady spływu metalu)
    // (smugi o miękkich brzegach: szum wartości po kącie, zamknięty na pełnym obwodzie — twarde, równe prążki czytały
    // się na jasno oświetlonym stożku przy czole masy jak plisa)
    const angNoise = (n, seed) => {
      const x = phi.mul(n / TAU).add(n / 2);
      const i = floor(x);
      const t = fract(x);
      const u = t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
      return mix(hash21(vec2(mod(i, n), seed)), hash21(vec2(mod(i.add(1.0), n), seed)), u);
    };
    const funStreak = F1(angNoise(210, 11.0).mul(0.6).add(angNoise(74, 5.0).mul(0.4)).mul(float(1.0).sub(smoothstep(160.0, 520.0, rho)).mul(0.5).add(0.15)).mul(isFunnel));
    const soot = F1(clamp(heatBand.mul(0.55).add(streakN.mul(float(1.0).sub(smoothstep(-260.0, 300.0, P.y))).mul(0.5).mul(isWall)).add(funStreak), 0.0, 0.85));
    const panel = mix(float(1.0), tint.mul(float(1.0).sub(seam.mul(mix(float(0.6), float(0.8), isFunnel)))), wallish);
    const albedo = V3(vC.mul(panel).mul(float(1.0).sub(soot.mul(0.6).mul(wallish))).add(vec3(0.05, 0.022, 0.008).mul(heatBand.mul(hsh).mul(wallish))));
    // --- światło -----------------------------------------------------------------
    const sv = F1(sunVis(U, P));
    const ndl = max(dot(N, U.sunDir), 0.0);
    const bl = V3(ballLight(U, P, N));
    // ŚWIATŁO ROBOCZE komory (fazy bez żaru: pusta, zbieranie, docisk) bierze się z WYŚWIETLACZA GRAWITACJI: pas
    // ekranów na środku wysokości ściany świeci swoją barwą (`U.dcol`: chłodna przy 0 g, ciepła przy grawitacji) — na
    // ścianach najjaśniej przy pasie, w leju od góry (słabnie ku osi), na maszynerii od boków. Gaśnie płynnie, gdy
    // rośnie żar bryły (`U.work.x`).
    const dy = F1(P.y.sub(DSP.y));
    const lineGlow = F1(exp(abs(dy).div(-170.0)).mul(1.05).add(exp(abs(dy).div(-60.0)).mul(0.5)));
    const floorGlow = exp(float(KOMORA.pitR).sub(min(rho, float(KOMORA.pitR))).div(-300.0)).mul(0.85).add(0.34);
    const workAmt = F1(mix(mix(float(0.62).sub(N.y.mul(0.2)), lineGlow.mul(0.85).add(0.16), isWall), floorGlow, max(isFloor, isFunnel)));
    const work = V3(U.dcol.mul(workAmt.mul(U.work.x).mul(step(P.y, float(KOMORA.deckY - 2)))));
    // żar strugi żużla na dzwonie i końcu szyi ssawy
    const Pm = V3(U.thr1.xyz.sub(P));
    const dm2 = F1(dot(Pm, Pm));
    const mouthL = V3(vec3(1.0, 0.3, 0.05).mul(U.work.y.mul(3.2).div(dm2.div(34.0 * 34.0).add(1.0)).mul(clamp(dot(N, Pm.div(sqrt(max(dm2, 1.0)))).add(0.55), 0.0, 1.0))));
    // ŚWIATŁO ODBITE: ściany studni oświetlone bryłą oddają część jej światła — tyły segmentów cewek, wysięgniki
    // i ssawa odwrócone od kuli nie są jednolicie czarne; do tego słaba poświata wyświetlacza, także przy żarze
    const Pbl = V3(P.sub(U.off));
    const facing = clamp(dot(N, Pbl.div(sqrt(max(dot(Pbl, Pbl), 1.0))).negate()).add(0.32).div(1.32), 0.0, 1.0);
    const srcR = max(U.heap.z, 1.0);
    const inPitB = step(P.y, float(KOMORA.deckY - 2)).mul(float(1.0).sub(max(max(isWall, isFloor), isFunnel)));
    const bounce = V3(U.light.xyz.mul(U.light.w.mul(U.t3.z).mul(srcR.mul(srcR).div(KOMORA.pitR * KOMORA.pitR)).mul(1.0).mul(float(1.0).sub(facing.mul(0.85))))
      .add(U.dcol.mul(0.3)).mul(inPitB).mul(N.y.mul(0.25).add(0.75)));
    const lightv = V3(U.sunColor.mul(ndl.mul(sv)).add(skyLight(U, P, N)).add(bl).add(work).add(mouthL).add(bounce));
    // połysk stali w świetle kuli (duże źródło: szeroki) i słońca
    const r = reflect(V.negate(), N);
    const Pb = V3(P.sub(U.off));
    const toBall = normalize(Pb.negate());
    const specB = pow(max(dot(r, toBall), 0.0), 5.0).mul(0.7);
    const specS = pow(max(dot(r, U.sunDir), 0.0), 40.0).mul(sv).mul(0.5);
    const gloss = isSteel.mul(0.75).add(isCoil.mul(0.5)).add(0.1);
    const lit = V3(albedo.mul(lightv).mul(float(1.0).sub(max(isLamp, isSign)))
      .add(U.light.xyz.mul(U.light.w).mul(U.t3.z).mul(specB.mul(gloss)).mul(clamp(dot(N, toBall).add(0.4), 0.0, 1.0)).mul(U.heap.z.mul(U.heap.z).div(max(dot(Pb, Pb), 1.0)).mul(3.0).min(1.0)).mul(mix(vec3(1.0), vC.mul(3.0), isCoil)))
      .add(U.sunColor.mul(specS.mul(gloss))));
    // pod progiem poświaty: jasność ograniczona z zachowaniem barwy
    const lum = dot(lit, LUMA);
    // (kompresja miękka, nie twardy limit: blisko kuli zostają gradienty i barwa, płaszczyzny nie zlewają się w jedną plamę)
    lit.mulAssign(float(1.0).div(lum.mul(1.5).add(1.0)));
    // --- żar własny i lampy ---------------------------------------------------------
    // CEWKA jest chłodzona — nie świeci żarem. Pracę pokazują: impuls biegnący po zwojach (chłodny, niebieskawy —
    // kontrast do kuli), ciemnowiśniowy żar tylko przy obejmach i rzadkie, krótkie wyładowania przy obejmach.
    const cg = U.glow.x;
    const ringId = floor(P.y.div(170.0).add(0.5)).add(floor(phi.mul(4.0 / TAU)).mul(3.0));
    const m = float(38.0);                                                  // obejm na pełny obwód (co 9,5° łuku)
    const uc = par.mul(m.div(TAU));                                         // współrzędna w obejmach
    const dClamp = abs(fract(uc).sub(0.5)).div(m).mul(TAU);                 // kąt do najbliższej obejmy [rad]
    const run = fract(par.mul(3.0 / TAU).sub(time.mul(0.55)).add(ringId.mul(0.37)));
    const pulse = exp(run.sub(0.5).div(0.03).mul(run.sub(0.5).div(0.03)).negate());
    const tick = floor(time.mul(11.0));
    const arcOn = step(0.972, hash21(vec2(floor(uc).add(ringId.mul(31.0)), tick))).mul(step(0.3, cg));
    const coilE = V3(vec3(0.3, 0.62, 1.0).mul(pulse.mul(cg).mul(0.85))
      .add(vec3(1.0, 0.06, 0.004).mul(exp(dClamp.div(0.05).mul(dClamp.div(0.05)).negate()).mul(cg.mul(cg)).mul(0.1)))
      .add(vec3(0.55, 0.8, 1.0).mul(exp(dClamp.div(0.022).mul(dClamp.div(0.022)).negate()).mul(arcOn).mul(1.9)))
      .mul(U.t4.y));
    const rg = clamp(U.glow.y.mul(1.5).sub(par.mul(0.5)), 0.0, 1.0);
    const radE = vec3(1.0, 0.03, 0.003).mul(rg.mul(rg).mul(0.15)).mul(N0.y.mul(0.4).add(0.6));
    const lampE = vC.mul(par).mul(U.t4.z);
    const catchE = vec3(1.0, 0.22, 0.03).mul(U.glow.z.mul(1.6).add(0.03));
    // wzierniki rurociągu żużla i wnętrze dzwonu ssawy: żar płynącego żużla (smugi biegną wzdłuż rury)
    const hotAmt = U.port.z;
    const flowS = hash21(vec2(floor(P.x.mul(0.21).add(P.z.mul(0.17)).sub(time.mul(7.0))), 3.0)).mul(0.45).add(0.55);
    const hotE = vec3(1.0, 0.24, 0.035).mul(hotAmt.mul(hotAmt).mul(1.25).mul(flowS));
    // gardziel leja: żar metalu płynącego rurą (dno rury najjaśniejsze, na ścianach płynące smugi)
    const flow = hash21(vec2(floor(phi.mul(9.0)), floor(P.y.div(26.0).add(time.mul(9.0))))).mul(0.5).add(0.5);
    // (stygnąca gardziel schodzi w ciemną czerwień i gaśnie szybko — nie zostaje pomarańczowym krążkiem w dnie)
    const tw = U.fun.w;
    const throatCol = mix(vec3(1.0, 0.04, 0.004), U.light.xyz, smoothstep(0.5, 0.92, tw));
    const throatE = throatCol.mul(tw.mul(tw).mul(tw).mul(mix(flow.mul(1.5), float(2.6), step(0.5, par))));
    // ściany leja: mokry od metalu pas nad lustrem żarzy się najmocniej tuż nad nim i stygnie; smugi spływu
    const above = F1(P.y.sub(U.fun.x));
    // (pas tuż POD nominalnym poziomem też jest mokry: fale lustra odsłaniają stożek — bez tego wokół jeziora szła ciemna kreska)
    const wet = F1(smoothstep(-26.0, -8.0, above).mul(step(P.y, U.fun.y.add(6.0))));
    const streak = angNoise(130, 5.0).mul(0.3).add(angNoise(46, 9.0).mul(0.25)).add(0.45);
    // MOKRA WYKŁADZINA: wszystko, czego masa dotknęła (do najwyższego zwilżonego miejsca), żarzy się ciemną wiśnią —
    // także cienki film, którego materiał masy nie rysuje jako cieczy; płyty wykładziny rozdzielone ciemniejszymi
    // szwami. Jasny pas tuż nad lustrem dochodzi dopiero, gdy jezioro leży na poziomie spoczynkowym (`U.mass2.w`):
    // przy rozlewaniu i fałdzie poziom nominalny nie jest brzegiem masy — pas stałby w powietrzu przed jej czołem.
    const settle = U.mass2.w;
    const nearLake = F1(exp(max(above, 0.0).div(-70.0)).mul(0.8).mul(settle));
    const funGlow = F1(U.fun.z.mul(wet).mul(nearLake.add(mix(float(0.34), float(0.2), settle))).mul(streak).mul(float(1.0).sub(seam.mul(0.55))));
    const funE = vec3(1.0, 0.1, 0.012).mul(funGlow.mul(0.5)).add(U.light.xyz.mul(funGlow.mul(funGlow).mul(exp(max(above, 0.0).div(-22.0))).mul(1.3).mul(settle)));
    // LISTWY dawnych linii okien: nieruchome, przygaszone (sygnał grawitacji niesie tylko wyświetlacz). PIERŚCIEŃ
    // BRAMY 0 g przy taśmie (linia 3) mówi językiem wyświetlacza: przy 0 g dwa światła krążą po pierścieniu (głowa
    // + ogon), razem z szewronami stają, a przy grawitacji światła spływają po obu bokach pierścienia w dół, w barwie
    // ciepłej. Parametr: azymut + 10 × linia.
    const line = floor(par.div(10.0).add(0.01));
    const turns = par.sub(line.mul(10.0)).div(TAU);
    const isRing = step(2.5, line);
    const uu = fract(turns.add(U.grav.x.mul(2.0)).mul(float(KOMORA.grav.ringLights)));
    const gRun = U.grav.y;
    const comet = exp(uu.mul(mix(float(30.0), float(5.5), gRun)).negate());
    const down = U.grav.z;
    const hN = sin(turns.mul(TAU).add(0.196));                              // wysokość światła na pierścieniu −1…1
    const fall = exp(fract(hN.mul(0.8).add(U.disp.z)).mul(-3.4));
    const ringCol = mix(vec3(0.16, 0.86, 1.0), vec3(1.0, 0.62, 0.16), down);
    const ringE = ringCol.mul(mix(comet.mul(gRun.mul(1.9).add(1.2)).add(gRun.mul(0.07).add(0.04)), fall.mul(2.2).add(0.1), down));
    const signE = mix(vec3(0.16, 0.86, 1.0).mul(0.055), ringE, isRing);
    // wymurówka przy kuli nagrzewa się i ledwie żarzy (z opóźnieniem radiatorów)
    const liningE = vec3(1.0, 0.045, 0.004).mul(heatBand.mul(U.glow.y).mul(hsh.mul(0.6).add(0.4)).mul(float(1.0).sub(seam)).mul(0.03).mul(wallish));
    const outc = vec3(0.0).toVar();
    outc.assign(lit.mul(float(1.0).sub(isCatch.mul(0.92)).sub(isHot.mul(hotAmt.mul(0.7).add(0.25))))
      .add(coilE.mul(isCoil)).add(radE.mul(isRad)).add(lampE.mul(isLamp)).add(catchE.mul(isCatch))
      .add(hotE.mul(isHot)).add(throatE.mul(isThroat)).add(funE.mul(isFunnel)).add(signE.mul(isSign)).add(liningE));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();
  const mat = new NodeMaterial();
  mat.name = 'WytopWyposazenie';
  mat.vertexNode = vertex;
  mat.fragmentNode = fragment;
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.lights = false;
  mat.toneMapped = false;
  return mat;
}

/** Siatka three z rejestratora: `dynamic` — atrybuty przepisywane co klatkę (stała pojemność). */
export function meshFromBuilder(B, material, name, dynamic = false) {
  const g = new THREE.BufferGeometry();
  const count = dynamic ? B.cap : B.n;
  const mk = (arr, size) => {
    const a = new THREE.BufferAttribute(dynamic ? arr : arr.slice(0, count * size), size);
    return a;
  };
  g.setAttribute('position', mk(B.pos, 3));
  g.setAttribute('aN', mk(B.nor, 3));
  g.setAttribute('aC', mk(B.col, 3));
  g.setAttribute('aK', mk(B.aux, 2));
  g.setAttribute('aM', mk(B.mov, 3));
  g.setDrawRange(0, B.n);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2200);
  const mesh = new THREE.Mesh(g, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}
