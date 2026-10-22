// Elektrownia „KOREK” — KOREK: czarna megabudowla zatykająca jądro na dnie gryzu (stoi w jeziorze płaszcza), z kraterem
// wylotu promienia pośrodku. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js: y — wysokość nad dnem gryzu),
// części z rodzajem powierzchni (PART) — materiał metalu i przepływu (earthBitePlant.tsl.js).
//
// Bryła (od zewnątrz; z góry: koncentryczne pierścienie + 6 mostów = „koło w jeziorze ognia”). Sektory i szprychy liczą
// się od azymutów mostów (L.elevators), więc obrót układu wind obraca cały korek razem z nimi:
//   • MASYW — wielokąt 72 ścian: spódnica w lawie, ŚCIANA WARSTWOWA (pasy radiatorów ze stali żebrowanej, półka,
//     wnęki okien różnej wysokości, cienkie listwy), kołnierz z wnęką okien, pokład górny, uskoki z oknami, taras
//     środkowy, ziggurat akceleratora (3 stopnie + warga krateru), lej i gardziel wylotu;
//   • 36 PRZĘSEŁ między stalowymi PILASTRAMI (wspornik pod kołnierzem, zastrzał w lawę); w przęsłach wymienniki: grube
//     przegrody z kołnierzem i kolektor rur z nogami w lawie (żar tylko w wąskim pasie przy lawie), skrzynie
//     wentylatorów (wnęki z łopatkami, żar w piaście) i kolektory rur;
//     między mostami na przemian 3 KANAŁY wlotu lawy i 3 WYLOTY; 6 BRAM mostów;
//   • MOSTY nad lawą (azymuty wind) od bramy do STOPY ŚCIANY (`wallFootPoint`): stalowy dźwigar skrzynkowy z galerią
//     okien, pod nim kratownica z podwieszoną galerią rur na filarach V (gdzie płytko — nasyp), przewody energii na
//     pokładzie (PIPE: uv.y 0 korek → 1 stopa), przyczółek i pylony. Dźwigar kończy się na CZOLE ROZDZIELNI obudowy
//     przy stopie (`footContact`); gdzie ściana podchodzi pod korek (~300°), brama cofa się przed rozdzielnię;
//   • gdzie przed ścianą korka leży już PAS OSŁON stopy ściany (obudowa; ~75–105° i ~280–315°) — bez wymienników, kanał
//     wlotu skraca się do wrót śluzy, wylot — do obudowy nad pasem (`bandH`);
//   • GROBLE energii w azymutach mostów: od zigguratu po tarasach do bram (2 przewody PIPE) — 6 szprych koła;
//   • pokład górny: 12 MASZYNOWNI wzdłuż obwodu (po dwie w sektorze: hala pod jednym dachem ze świetlikiem,
//     przybudówka sterowni, od placu niższa HALA TURBIN z parą KOMINÓW), pierścień estakady rur z odgałęzieniami do
//     hal, szyna zbiorcza (PIPE), rozdzielnie przy groblach, 3 ARKOLOGIE (wieże z gęstymi rzędami okien — skala setek
//     kilometrów) i 3 BATERIE ZBIORNIKÓW pod suwnicą w środkach sektorów;
//   • taras środkowy: 6 chłodni (powłoka ze stali żebrowanej, żebra, wieńce, korona świateł), przy każdej bateria
//     zbiorników pod suwnicą i blok transformatorów spięte z nią mostami rurowymi, od osi POMPOWNIA, pierścień
//     estakady rur, CIĘŻKIE PYLONY KOLEKTORÓW (po jednym przy grobli) wokół akceleratora;
//   • skala: żadnych rekwizytów w skali ludzkiej (kiwony, lądowiska, kratowe maszty radiowe, drobne cysterny — przy
//     korku o promieniu 830 km czytały się jak zabawki); pionowe akcenty to pełne pylony z kondygnacjami świateł;
//   • akcelerator: 4 pierścienie COIL z obejmami i 6 smukłych emiterów-zębów (pancerne segmenty, jarzma, cyjanowa
//     ściana ku osi) nad wylotem — w stałych azymutach (corkToothAz + k · 60°).
// Konwencja świateł: listwy STRIP cienkie (≤ 0,0006 R, z 0,3–0,5 — pod progiem bloomu), koncentryczne pierścienie
// czytelne z wielu cienkich linii; okna WINDOW we wnękach z ciemną ramą, z ≈ 0,86–0,9 (ciągłe pasy); żar HOT ≤ 0,55
// tylko przy lawie. Rozrzut z ziarnem (`plantRng`). Wierzchołki zbierają akumulatory per rodzaj (i kubełek ziarna), więc
// korek oddaje kilkadziesiąt części zamiast setek.
import * as THREE from 'three/webgpu';
import { DEG, PART, finalizePart, bowlPoint, bowlPsiAtHeight, plantZ0, rimPsi, wallFootPoint, plantRng } from './earthBitePlantFrame.js';

/** Wymiary korka (R Ziemi). corkR, corkTopH, apertureH, apertureR — w PLANT_LAYOUT (wspólne z promieniem i obudową). */
export const CORK_DEFAULTS = Object.freeze({
  // tarasy ku wylotowi: środkowy, wewnętrzny, krater
  corkMidR: 0.098, corkMidH: 0.059,
  corkInnerR: 0.046, corkInnerH: 0.065,
  corkCraterR: 0.024,
  // chłodnie na tarasie środkowym (po jednej w środku sektora między mostami): pierścień, promień podstawy, wysokość
  corkTowers: 6, corkTowerRing: 0.073, corkTowerR: 0.0122, corkTowerH: 0.036,
  // przęsła ściany (pilastry); maszynownie pokładu górnego — po dwie w sektorze między mostami
  corkSpans: 36,
  // arkologie na pokładzie górnym (wysokość bez anteny), szczyt bram kolektorów nad groblami (r ≥ 0,048 — pod
  // pierścieniami zamknięcia promienia od y 0,13)
  corkArcoH: 0.05, corkCollectorH: 0.104,
  // emitery-zęby nad wylotem: wysokość, odległość czubka od osi, azymut pierwszego [°] (co 60°)
  corkToothH: 0.101, corkToothTipR: 0.0155, corkToothAz: 0,
  // mosty nad lawą: szerokość pokładu, promień przewodu energii, ziarno rozrzutu
  corkBridgeW: 0.0115, corkPipeR: 0.0009, corkSeed: 7
});

const V3 = THREE.Vector3;
const UP = Object.freeze(new V3(0, 1, 0));
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
/** Różnica kątów zawinięta do (−π, π]. */
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const nearAz = (az, list, tol) => list.some((a) => Math.abs(angDiff(az, a)) < tol);
/** Kierunek na zewnątrz w azymucie phi (rama: x = cos, z = −sin) i styczna (rosnące phi). */
const dirAz = (phi, out = new V3()) => out.set(Math.cos(phi), 0, -Math.sin(phi));
const tanAz = (phi, out = new V3()) => out.set(-Math.sin(phi), 0, -Math.cos(phi));
const polar = (rho, phi, y, out = new V3()) => out.set(rho * Math.cos(phi), y, -rho * Math.sin(phi));
/** Prostokąt [u, w] (środek cu, cw; półwymiary hu, hw). */
const rect = (cu, cw, hu, hw) => [[cu - hu, cw - hw], [cu + hu, cw - hw], [cu + hu, cw + hw], [cu - hu, cw + hw]];

// ── Akumulatory wierzchołków ────────────────────────────────────────────────────────────────────────────────────────
/** Wierzchołki jednego rodzaju powierzchni (i kubełka ziarna): pozycja, normalna, uv, z / w per wierzchołek, indeks. */
class Acc {
  constructor(kind, seed) {
    this.kind = kind;
    this.seed = seed;
    this.n = 0;
    this.cap = 0;
    this.ni = 0;
    this.idx = new Uint32Array(3072);
    this._grow(1024);
  }

  /** Bufory rosną dwukrotnie (bez tysięcy push na tablicach JS). */
  _grow(cap) {
    const g = (old, k) => {
      const t = new Float32Array(cap * k);
      if (old) t.set(old.subarray(0, this.n * k));
      return t;
    };
    this.pos = g(this.pos, 3);
    this.nrm = g(this.nrm, 3);
    this.uv = g(this.uv, 2);
    this.pz = g(this.pz, 1);
    this.pw = g(this.pw, 1);
    this.cap = cap;
  }

  get count() { return this.n; }

  vert(p, n, u, v, z, w) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.nrm[i * 3] = n.x; this.nrm[i * 3 + 1] = n.y; this.nrm[i * 3 + 2] = n.z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.pz[i] = z;
    this.pw[i] = w;
    return i;
  }

  tri(a, b, c) {
    if (this.ni + 3 > this.idx.length) {
      const t = new Uint32Array(this.idx.length * 2);
      t.set(this.idx);
      this.idx = t;
    }
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  build() {
    const n = this.n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    const { pz, pw } = this;
    return finalizePart(g, this.kind, this.seed, (i) => pz[i], (i) => pw[i]);
  }
}

/** Zbiór akumulatorów: rodzaj × kubełek ziarna (8 kubełków — odmiana części bez setek siatek). */
class Mesher {
  constructor() { this.map = new Map(); }

  acc(kind, seed = 0) {
    const s = Math.min(7, Math.floor(clamp01(seed) * 8));
    const key = kind * 8 + s;
    let a = this.map.get(key);
    if (!a) this.map.set(key, (a = new Acc(kind, (s + 0.5) / 8)));
    return a;
  }

  /** Części metalu (rodzaje 0–7) i przepływu (8–9). */
  parts() {
    const metal = [];
    const flow = [];
    for (const a of this.map.values()) {
      if (!a.count) continue;
      (a.kind >= PART.PIPE ? flow : metal).push(a.build());
    }
    return { metal, flow };
  }
}

const val = (f, p) => (typeof f === 'function' ? f(p) : f);
const _e1 = new V3();
const _e2 = new V3();
const _n = new V3();

/** Czworokąt a-b-c-d (płaski cień); `hint` — strona zewnętrzna (kolejność odwracana, gdy normalna patrzy w drugą stronę). */
function quad(A, a, b, c, d, hint, z = 0, w = 0) {
  if (!A) return;
  _n.crossVectors(_e1.subVectors(c, a), _e2.subVectors(d, b));
  if (_n.lengthSq() < 1e-26) return;
  _n.normalize();
  if (hint && _n.dot(hint) < 0) { const t = b; b = d; d = t; _n.negate(); }
  const i0 = A.vert(a, _n, 0, 0, val(z, a), val(w, a));
  const i1 = A.vert(b, _n, 1, 0, val(z, b), val(w, b));
  const i2 = A.vert(c, _n, 1, 1, val(z, c), val(w, c));
  const i3 = A.vert(d, _n, 0, 1, val(z, d), val(w, d));
  A.tri(i0, i1, i2);
  A.tri(i0, i2, i3);
}

function triangle(A, a, b, c, hint, z = 0, w = 0) {
  if (!A) return;
  _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a));
  if (_n.lengthSq() < 1e-26) return;
  _n.normalize();
  if (hint && _n.dot(hint) < 0) { const t = b; b = c; c = t; _n.negate(); }
  const i0 = A.vert(a, _n, 0, 0, val(z, a), val(w, a));
  const i1 = A.vert(b, _n, 1, 0, val(z, b), val(w, b));
  const i2 = A.vert(c, _n, 0, 1, val(z, c), val(w, c));
  A.tri(i0, i1, i2);
}

/** Rama lokalna: początek o, osie U (bok), V (góra), W (przód); `at(u, v, w)` → punkt ramy elektrowni. */
function frame(o, U, V, W) {
  return {
    o, U, V, W,
    at(u, v, w, out = new V3()) { return out.copy(o).addScaledVector(U, u).addScaledVector(V, v).addScaledVector(W, w); },
    dir(u, v, w, out = new V3()) { return out.set(0, 0, 0).addScaledVector(U, u).addScaledVector(V, v).addScaledVector(W, w); }
  };
}

/** Rama promienista w azymucie phi: U — styczna, V — pion, W — na zewnątrz; początek (rho, y). */
const radialFrame = (phi, rho, y) => frame(polar(rho, phi, y), tanAz(phi), UP.clone(), dirAz(phi));

/**
 * Graniastosłup: wielokąt `poly` ([u, w] w ramie F, wypukły albo gwiaździsty względem środka) wyciągnięty wzdłuż V przez
 * wiersze `rows` ({ v, s: skala | [su, sw], o: [ou, ow], side }) — zwężenia, fazy i WNĘKI (dwa wiersze na tej samej
 * wysokości z inną skalą = półka / nadproże). `row.side` (Acc, null albo (krawędź, nu, nw, wiersz) → Acc) — rodzaj
 * pasa ścian od tego wiersza do następnego; `acc` — Acc albo { side, top, bottom } (side może być funkcją).
 * z / w: liczba albo funkcja punktu.
 */
function prism(F, poly, rows, acc, z = 0, w = 0) {
  const side = acc instanceof Acc ? acc : acc.side;
  const top = acc instanceof Acc ? acc : acc.top;
  const bottom = acc instanceof Acc ? acc : acc.bottom;
  const n = poly.length;
  let cu = 0, cw = 0;
  for (const [u, ww] of poly) { cu += u / n; cw += ww / n; }
  const ring = rows.map((r) => {
    const s = r.s ?? 1;
    const su = Array.isArray(s) ? s[0] : s, sw = Array.isArray(s) ? s[1] : s;
    const ou = r.o?.[0] ?? 0, ow = r.o?.[1] ?? 0;
    return poly.map(([u, ww]) => F.at(cu + (u - cu) * su + ou, r.v, cw + (ww - cw) * sw + ow));
  });
  const out = new V3(), hint = new V3(), m0 = new V3(), m1 = new V3();
  for (let k = 0; k < n; k++) {
    const [u0, w0] = poly[k], [u1, w1] = poly[(k + 1) % n];
    // normalna krawędzi na zewnątrz (od środka wielokąta)
    let nu = w1 - w0, nw = -(u1 - u0);
    if (nu * ((u0 + u1) / 2 - cu) + nw * ((w0 + w1) / 2 - cw) < 0) { nu = -nu; nw = -nw; }
    F.dir(nu, 0, nw, out).normalize();
    for (let r = 0; r + 1 < rows.length; r++) {
      let A = rows[r].side !== undefined ? rows[r].side : side;
      if (typeof A === 'function') A = A(k, nu, nw, r);
      if (!A) continue;
      // strona: normalna profilu (Δv, −Δd) — ściana na zewnątrz, półka wnęki w górę, nadproże w dół
      m0.addVectors(ring[r][k], ring[r][(k + 1) % n]);
      m1.addVectors(ring[r + 1][k], ring[r + 1][(k + 1) % n]).sub(m0);
      const dv = m1.dot(F.V), dd = m1.dot(out);
      hint.copy(out).multiplyScalar(dv).addScaledVector(F.V, -dd);
      if (hint.lengthSq() < 1e-24) hint.copy(out);
      quad(A, ring[r][k], ring[r][(k + 1) % n], ring[r + 1][(k + 1) % n], ring[r + 1][k], hint, z, w);
    }
  }
  const cap = (pts, A, h) => {
    if (!A) return;
    // czworokąt — jedna ściana (4 wierzchołki zamiast wachlarza 12)
    if (n === 4) { quad(A, pts[0], pts[1], pts[2], pts[3], h, z, w); return; }
    const c = new V3();
    for (const p of pts) c.addScaledVector(p, 1 / n);
    for (let k = 0; k < n; k++) triangle(A, c, pts[k], pts[(k + 1) % n], h, z, w);
  };
  cap(ring[ring.length - 1], top, F.V);
  cap(ring[0], bottom, F.V.clone().negate());
}

/** Prostopadłościan w ramie F: środek (cu, cw), wysokość v0…v1, półwymiary hu, hw; `chamfer` — faza górnych krawędzi. */
function box(F, cu, cw, hu, hw, v0, v1, acc, z = 0, w = 0, chamfer = 0) {
  const rows = chamfer > 0
    ? [{ v: v0 }, { v: v1 - chamfer }, { v: v1, s: [Math.max(0.05, 1 - chamfer / hu), Math.max(0.05, 1 - chamfer / hw)] }]
    : [{ v: v0 }, { v: v1 }];
  prism(F, rect(cu, cw, hu, hw), rows, acc, z, w);
}

/**
 * Światło pozycyjne do `box` (runda 5): OPRAWA ze stali (boki i spód) i SOCZEWKA tylko na wierzchu (BEACON, uv 0…1 —
 * środek świeci); pudełko BEACON ze świecącym środkiem każdej ściany czytało się za dnia jak kostka do gry.
 */
const lampAcc = (M, seed) => ({ side: M.acc(PART.STRUCT, 0.58), top: M.acc(PART.BEACON, seed), bottom: M.acc(PART.STRUCT, 0.58) });

/**
 * Blok sterowni (dyspozytornie bram, rozdzielnie): kadłub z JEDNYM ciągłym pasem okien we wnęce (głębokość 0,00022 R)
 * w środkowej części wysokości i fazowanym dachem — nie „biurowiec” z oknami na całych ścianach.
 */
function bandBlock(F, cu, cw, hu, hw, y0, y1, hull, win) {
  const h = y1 - y0, d = 0.00022, ch = 0.0004;
  const sIn = [(hu - d) / hu, (hw - d) / hw];
  const b0 = y0 + h * 0.34, b1 = y0 + h * 0.64;
  prism(F, rect(cu, cw, hu, hw), [
    { v: y0, side: hull }, { v: b0, side: hull }, { v: b0, s: sIn, side: win }, { v: b1, s: sIn, side: hull },
    { v: b1, side: hull }, { v: y1 - ch, side: hull }, { v: y1, s: [1 - ch / hu, 1 - ch / hw] }
  ], { side: hull, top: hull, bottom: null }, 0.88);
}

/** Wielokąt foremny (n wierzchołków, półosie ru, rw) — przekrój filarów i stóp. */
function ngon(n, ru, rw, rot = Math.PI / n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * TAU;
    out.push([Math.cos(a) * ru, Math.sin(a) * rw]);
  }
  return out;
}

const val2 = (f, r, y) => (typeof f === 'function' ? f(r, y) : (f ?? 0));

const AXIS_X = Object.freeze(new V3(1, 0, 0));

/**
 * Bryła obrotowa wokół osi (domyślnie pion przez (cx, cy, cz)): profil [r, y] (y — wzdłuż osi; bryła po LEWEJ przy
 * marszu — wtedy normalne na zewnątrz), `segs[i]` — atrybuty odcinka i → i + 1: { acc, smooth, z, w } (z / w: liczba
 * albo (r, y) → wartość). Odcinki płaskie (smooth: false) — ściany wielokąta o `n` bokach, gładkie — normalne obracane
 * z profilem. `axis` / `e1` — własna oś (jednostkowa) i kierunek kąta 0 (⟂ osi): wentylatory na ścianie korka.
 */
function lathe(profile, segs, n, { cx = 0, cy = 0, cz = 0, theta0 = 0, axis = UP, e1 = AXIS_X } = {}) {
  const cs = [], sn = [], csM = [], snM = [];
  for (let j = 0; j <= n; j++) {
    const t = theta0 + (j / n) * TAU;
    cs.push(Math.cos(t)); sn.push(Math.sin(t));
    const tm = theta0 + ((j + 0.5) / n) * TAU;
    csM.push(Math.cos(tm)); snM.push(Math.sin(tm));
  }
  // baza (e1, e2 = oś × e1, oś) — przy osi pionowej e2 = −Z: ten sam obieg co dawniej (normalne na zewnątrz)
  const e2 = new V3().crossVectors(axis, e1);
  const P = (r, y, j, out) => out.set(cx, cy, cz).addScaledVector(e1, r * cs[j]).addScaledVector(e2, r * sn[j]).addScaledVector(axis, y);
  const nrm = (nr, ny, c0, s0, out) => out.copy(e1).multiplyScalar(nr * c0).addScaledVector(e2, nr * s0).addScaledVector(axis, ny);
  const a = new V3(), b = new V3(), c = new V3(), d = new V3(), nn = new V3();
  let vAcc = 0;
  // ostatni pierścień gładkiego odcinka: następny gładki odcinek tego samego rodzaju (ciągłe z / w, załamanie < ~35°)
  // dzieli go — normalne uśrednione (wieże, lej), bez podwójnych rzędów wierzchołków
  let prev = null;
  for (let i = 0; i + 1 < profile.length; i++) {
    const s = segs[i];
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    const len = Math.sqrt((r1 - r0) ** 2 + (y1 - y0) ** 2);
    if (!s?.acc || len < 1e-9) { vAcc += len; prev = null; continue; }
    const A = s.acc;
    const nr = (y1 - y0) / len, ny = -(r1 - r0) / len;
    const z0 = val2(s.z, r0, y0), z1 = val2(s.z, r1, y1);
    const w0 = val2(s.w, r0, y0), w1 = val2(s.w, r1, y1);
    const v0 = vAcc * 40, v1 = (vAcc + len) * 40;
    if (s.smooth) {
      let ringA;
      if (prev && prev.A === A && prev.z === z0 && prev.w === w0 && prev.nr * nr + prev.ny * ny > 0.82) {
        ringA = prev.ring;
        let ar = prev.nr + nr, ay = prev.ny + ny;
        const al = Math.sqrt(ar * ar + ay * ay);
        ar /= al; ay /= al;
        for (let j = 0; j <= n; j++) {
          nrm(ar, ay, cs[j], sn[j], nn);
          const q = (ringA + j) * 3;
          A.nrm[q] = nn.x; A.nrm[q + 1] = nn.y; A.nrm[q + 2] = nn.z;
        }
      } else {
        ringA = A.count;
        for (let j = 0; j <= n; j++) A.vert(P(r0, y0, j, a), nrm(nr, ny, cs[j], sn[j], nn), j / n, v0, z0, w0);
      }
      const ringD = A.count;
      for (let j = 0; j <= n; j++) A.vert(P(r1, y1, j, d), nrm(nr, ny, cs[j], sn[j], nn), j / n, v1, z1, w1);
      for (let j = 0; j < n; j++) {
        const ia = ringA + j, ib = ia + 1, id = ringD + j, ic = id + 1;
        A.tri(ia, ib, ic);
        A.tri(ia, ic, id);
      }
      prev = { A, ring: ringD, z: z1, w: w1, nr, ny };
    } else {
      prev = null;
      for (let j = 0; j < n; j++) {
        nrm(nr, ny, csM[j], snM[j], nn);
        const i0 = A.vert(P(r0, y0, j, a), nn, j / n, v0, z0, w0);
        const i1 = A.vert(P(r0, y0, j + 1, b), nn, (j + 1) / n, v0, z0, w0);
        const i2 = A.vert(P(r1, y1, j + 1, c), nn, (j + 1) / n, v1, z1, w1);
        const i3 = A.vert(P(r1, y1, j, d), nn, j / n, v1, z1, w1);
        A.tri(i0, i1, i2);
        A.tri(i0, i2, i3);
      }
    }
    vAcc += len;
  }
}

/** Torus wokół pionu (środek przekroju r0, y0; promień rury rt) — gładki, siatka (n + 1) × (m + 1) wspólnych wierzchołków. */
function torus(A, r0, y0, rt, n, m = 10, { cx = 0, cy = 0, cz = 0 } = {}, z = 0, w = 0) {
  const base = A.count;
  const p = new V3(), nn = new V3();
  for (let j = 0; j <= n; j++) {
    const t = (j / n) * TAU, ct = Math.cos(t), st = Math.sin(t);
    for (let k = 0; k <= m; k++) {
      const s = (k / m) * TAU, cs = Math.cos(s), ss = Math.sin(s);
      const r = r0 + cs * rt, y = y0 + ss * rt;
      nn.set(cs * ct, ss, -cs * st);
      A.vert(p.set(cx + r * ct, cy + y, cz - r * st), nn, j / n, k / m, val2(z, r, y), val2(w, r, y));
    }
  }
  // obieg jak w `lathe` (profil przeciwnie do wskazówek zegara w (r, y) — normalne na zewnątrz rury)
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < m; k++) {
      const ia = base + j * (m + 1) + k, id = ia + 1, ib = ia + m + 1, ic = ib + 1;
      A.tri(ia, ib, ic);
      A.tri(ia, ic, id);
    }
  }
}

/**
 * Belka po ścieżce (prostokątny przekrój): punkty `pts`, w każdym półszerokość hw (wzdłuż S) i półwysokość hh (wzdłuż N,
 * N ⟂ T od wektora `up`). `accOf(ściana)` → Acc ('top' +N, 'bottom' −N, 'side', 'cap'), z — liczba, tablica per punkt
 * albo funkcja (ściana, i) → wartość.
 */
function sweep(pts, hw, hh, up, accOf, z = 0, w = 0, caps = true) {
  const m = pts.length;
  const T = [], N = [], S = [];
  for (let i = 0; i < m; i++) {
    const t = new V3().subVectors(pts[Math.min(m - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    const u = (Array.isArray(up) ? up[i] : up);
    const nv = u.clone().addScaledVector(t, -u.dot(t)).normalize();
    T.push(t); N.push(nv); S.push(new V3().crossVectors(t, nv).normalize());
  }
  const H = (i) => (Array.isArray(hw) ? hw[i] : hw);
  const Hh = (i) => (Array.isArray(hh) ? hh[i] : hh);
  const corner = (i, sa, na) => pts[i].clone().addScaledVector(S[i], sa * H(i)).addScaledVector(N[i], na * Hh(i));
  const C = [];
  for (let i = 0; i < m; i++) C.push([corner(i, 1, 1), corner(i, -1, 1), corner(i, -1, -1), corner(i, 1, -1)]);
  const faces = [['top', 0, 1, (i) => N[i]], ['side', 1, 2, (i) => S[i].clone().negate()], ['bottom', 2, 3, (i) => N[i].clone().negate()], ['side', 3, 0, (i) => S[i]]];
  for (const [name, k0, k1, hf] of faces) {
    const A = accOf(name);
    if (!A) continue;
    const zf = (i) => (typeof z === 'function' ? z(name, i) : (Array.isArray(z) ? z[i] : z));
    const wf = (i) => (typeof w === 'function' ? w(name, i) : w);
    for (let i = 0; i + 1 < m; i++) {
      const h = hf(i).add(hf(i + 1)).normalize();
      // z / w per punkt ścieżki (oba wierzchołki przekroju i mają tę samą wartość)
      const zi = zf(i), zj = zf(i + 1), wi = wf(i), wj = wf(i + 1);
      const a = C[i][k0], b = C[i][k1], c = C[i + 1][k1], d = C[i + 1][k0];
      const zz = (p) => (p === a || p === b ? zi : zj);
      const ww = (p) => (p === a || p === b ? wi : wj);
      quad(A, a, b, c, d, h, zz, ww);
    }
  }
  if (caps) {
    const A = accOf('cap');
    if (A) {
      const zf = (i) => (typeof z === 'function' ? z('cap', i) : (Array.isArray(z) ? z[i] : z));
      quad(A, C[0][0], C[0][1], C[0][2], C[0][3], T[0].clone().negate(), zf(0), 0);
      quad(A, C[m - 1][0], C[m - 1][1], C[m - 1][2], C[m - 1][3], T[m - 1], zf(m - 1), 0);
    }
  }
}

/** Walec P → Q (gładki płaszcz, opcjonalne denka), promienie r0 (P) i r1 (Q). */
function cylinder(A, P, Q, r0, r1, n, caps = true, z = 0, w = 0) {
  const ax = new V3().subVectors(Q, P);
  const len = ax.length();
  if (len < 1e-9) return;
  ax.divideScalar(len);
  const e1 = new V3(1, 0, 0);
  if (Math.abs(ax.x) > 0.9) e1.set(0, 0, 1);
  const e2 = new V3().crossVectors(ax, e1).normalize();
  e1.crossVectors(e2, ax).normalize();
  const base = A.count;
  const p = new V3(), nn = new V3();
  for (let j = 0; j <= n; j++) {
    const t = (j / n) * TAU;
    nn.copy(e1).multiplyScalar(Math.cos(t)).addScaledVector(e2, Math.sin(t));
    A.vert(p.copy(P).addScaledVector(nn, r0), nn, j / n, 0, val(z, P), val(w, P));
    A.vert(p.copy(Q).addScaledVector(nn, r1), nn, j / n, 1, val(z, Q), val(w, Q));
  }
  // kolejność: zewnętrzna normalna (sprawdzona na pierwszym czworokącie)
  const a0 = new V3().copy(P).addScaledVector(e1, r0);
  const t1 = (1 / n) * TAU;
  const b0 = new V3().copy(P).addScaledVector(e1, r0 * Math.cos(t1)).addScaledVector(e2, r0 * Math.sin(t1));
  const d0 = new V3().copy(Q).addScaledVector(e1, r1);
  const flip = new V3().crossVectors(b0.sub(a0), d0.sub(a0)).dot(e1) < 0;
  for (let j = 0; j < n; j++) {
    const ia = base + j * 2, id = ia + 1, ib = ia + 2, ic = ia + 3;
    if (flip) { A.tri(ia, ic, ib); A.tri(ia, id, ic); } else { A.tri(ia, ib, ic); A.tri(ia, ic, id); }
  }
  if (caps) {
    const ring = (C, r) => { const out = []; for (let j = 0; j < n; j++) { const t = (j / n) * TAU; out.push(C.clone().addScaledVector(e1, r * Math.cos(t)).addScaledVector(e2, r * Math.sin(t))); } return out; };
    const rq = ring(Q, r1), rp = ring(P, r0);
    for (let j = 0; j < n; j++) {
      triangle(A, Q, rq[j], rq[(j + 1) % n], ax, z, w);
      triangle(A, P, rp[j], rp[(j + 1) % n], ax.clone().negate(), z, w);
    }
  }
}

/** Pręt kratownicy P → Q (cienki graniastosłup bez denek). */
const beam = (A, P, Q, r, n = 4) => cylinder(A, P, Q, r, r, n, false);

/**
 * Blok łukowy — budynek wzdłuż obwodu (pokład korka): pierścień ρ ∈ [r0, r1], azymut ∈ [a0, a1] (rad, a0 < a1),
 * wiersze `rows` ({ v, d, side }) jak w `prism`: d — wcięcie wszystkich ścian [R] (ujemne — gzyms wysunięty), dwa wiersze
 * na tej samej wysokości z innym d = półka / nadproże. Ściany: 'out' (łuk zewnętrzny), 'in' (łuk ku osi), 'end' (czoła
 * promieniste); `side` — Acc, null albo (ściana) → Acc | null; `acc` — Acc albo { side, top }. Dach płaski (bez dna).
 * Łuki z `nA` odcinków (cięciwy — ugięcie < 0,0001 R przy 20° i ρ 0,12).
 */
function arcBlock(r0, r1, a0, a1, rows, acc, nA = 8, z = 0, w = 0) {
  const side = acc instanceof Acc ? acc : acc.side;
  const top = acc instanceof Acc ? acc : acc.top;
  const rm = (r0 + r1) / 2;
  const ring = rows.map((row) => {
    const d = row.d ?? 0;
    const ri = r0 + d, ro = r1 - d, da = d / rm;
    const O = [], I = [];
    for (let j = 0; j <= nA; j++) {
      const a = lerp(a0 + da, a1 - da, j / nA);
      O.push(polar(ro, a, row.v));
      I.push(polar(ri, a, row.v));
    }
    return { O, I };
  });
  const hint = new V3(), m = new V3(), out = new V3();
  // strona pasa z profilu (jak w prism): ściana na zewnątrz, półka w górę, nadproże w dół
  const face = (A, a, b, c, d, n) => {
    m.addVectors(c, d).sub(a).sub(b);
    const dv = m.y, dd = m.dot(n);
    hint.copy(n).multiplyScalar(dv).addScaledVector(UP, -dd);
    if (hint.lengthSq() < 1e-24) hint.copy(n);
    quad(A, a, b, c, d, hint, z, w);
  };
  for (let r = 0; r + 1 < rows.length; r++) {
    const sd = rows[r].side !== undefined ? rows[r].side : side;
    const pick = (f) => (typeof sd === 'function' ? sd(f) : sd);
    const lo = ring[r], hi = ring[r + 1];
    const Ao = pick('out'), Ai = pick('in'), Ae = pick('end');
    for (let j = 0; j < nA; j++) {
      const am = lerp(a0, a1, (j + 0.5) / nA);
      if (Ao) face(Ao, lo.O[j], lo.O[j + 1], hi.O[j + 1], hi.O[j], dirAz(am, out));
      if (Ai) face(Ai, lo.I[j], lo.I[j + 1], hi.I[j + 1], hi.I[j], dirAz(am, out).negate());
    }
    if (Ae) {
      face(Ae, lo.I[0], lo.O[0], hi.O[0], hi.I[0], tanAz(a0, out).negate());
      face(Ae, lo.I[nA], lo.O[nA], hi.O[nA], hi.I[nA], tanAz(a1, out));
    }
  }
  if (top) {
    const t = ring[ring.length - 1];
    for (let j = 0; j < nA; j++) quad(top, t.I[j], t.O[j], t.O[j + 1], t.I[j + 1], UP, z, w);
  }
}

// ── Lawa pod korkiem ────────────────────────────────────────────────────────────────────────────────────────────────
const _bp = new V3();
/** Wysokość dna / ściany gryzu (powierzchni lawy) w azymucie phi, w odległości rho od osi (bisekcja po ψ). */
function lavaHeight(phi, rho, b, z0) {
  let lo = 0, hi = rimPsi(phi, b);
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5;
    bowlPoint(phi, mid, 0, b, z0, _bp);
    if (Math.sqrt(_bp.x * _bp.x + _bp.z * _bp.z) < rho) lo = mid; else hi = mid;
  }
  return bowlPoint(phi, (lo + hi) * 0.5, 0, b, z0, _bp).y;
}

/** Odległość od osi punktu ściany gryzu na wysokości h (azymut phi). */
function wallRhoAt(phi, h, b, z0) {
  bowlPoint(phi, bowlPsiAtHeight(phi, h, b), 0, b, z0, _bp);
  return Math.sqrt(_bp.x * _bp.x + _bp.z * _bp.z);
}

/**
 * Dolna krawędź PASA OSŁON CIEPLNYCH stopy ściany (obudowa, LINING `buildFoot`: na ścianie od footH − 0,0155 do
 * footH − 0,0038, grubość ~0,0036) z zapasem. Gdzie ściana gryzu sięga tej wysokości tuż przy korku (azymuty ~75–105°
 * i ~280–315°), przed ścianą korka nie ma jeziora: wymienniki, kanały wlotu i rury wylotu tam nie wchodzą.
 */
const bandH = (L) => L.footH - 0.0175;

/** Linia lawy na boku korka w azymucie phi: pierwszy punkt profilu boku (łamana `side`) nad lawą → { r, y }. */
function waterline(side, phi, b, z0) {
  const at = (t) => {
    const k = Math.min(side.length - 2, Math.floor(t));
    const f = t - k;
    return [lerp(side[k][0], side[k + 1][0], f), lerp(side[k][1], side[k + 1][1], f)];
  };
  const below = (t) => { const [r, y] = at(t); return y < lavaHeight(phi, r, b, z0); };
  let lo = 0, hi = side.length - 1;
  if (!below(lo)) return { r: side[0][0], y: side[0][1] };
  if (below(hi)) { const [r, y] = at(hi); return { r, y }; }
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    if (below(mid)) lo = mid; else hi = mid;
  }
  const [r, y] = at((lo + hi) * 0.5);
  return { r, y };
}

// ── Korek ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Korek: { metal: części, flow: części } w ramie elektrowni. */
export function buildCork(L, b) {
  const M = new Mesher();
  const z0 = plantZ0(b);
  const rng = plantRng(L.corkSeed * 7919 + 13);
  const ctx = { L, b, z0, M, rng, geo: corkProfile(L) };
  // azymuty mostów (wind); sektory między nimi (środki: wloty / wyloty, chłodnie, arkologie) liczone od mostów
  ctx.bridgeAz = L.elevators.map((a) => a * DEG);
  const nB = Math.max(1, ctx.bridgeAz.length);
  ctx.az0 = ctx.bridgeAz[0] ?? 0;
  ctx.sectorAz = ctx.bridgeAz.map((a) => a + Math.PI / nB);
  // styk mostów ze stopą ściany (czoło rozdzielni obudowy) i czoło bram — liczone raz, wspólne dla bram i mostów
  ctx.deckTop = L.footH - L.corkPipeR - 0.0003;
  ctx.contact = ctx.bridgeAz.map((az) => footContact(L, b, az, ctx.deckTop));
  buildMassif(ctx);
  buildSpans(ctx);
  ctx.bridgeAz.forEach((az, i) => buildBridge(ctx, az, i));
  buildTopDeck(ctx);
  ctx.bridgeAz.forEach((az, i) => buildCauseway(ctx, az, i));
  buildMidTerrace(ctx);
  buildAccelerator(ctx);
  return M.parts();
}

/**
 * Profil masywu [r, y] i odcinki z rodzajami; `side` — łamana boku (spódnica → kołnierz) do szukania linii lawy.
 * Ściana z warstw (od lawy): cokół, pas radiatorów, półka, wnęka okien, listwa, pas radiatorów, wnęki okien — każda
 * wnęka cofnięta o 0,0009 R (ciemna rama: półka i nadproże), listwy wpuszczone o 0,0003 R i wysokie 0,0004 R.
 */
function corkProfile(L) {
  const R = L.corkR, T = L.corkTopH, Mr = L.corkMidR, Mh = L.corkMidH, Ir = L.corkInnerR, Ih = L.corkInnerH;
  const Cr = L.corkCraterR, Ah = L.apertureH, Ar = L.apertureR;
  const P = [];
  const S = [];
  const add = (r, y, seg) => { P.push([r, y]); S.push(seg); };
  // wnęka od (r, y0): półka w głąb o d, pas `seg` do y1, nadproże na zewnątrz; dalej od (r, y1) odcinek `next`
  const recess = (r, y0, y1, d, seg, next) => { add(r, y0, 'hull'); add(r - d, y0, seg); add(r - d, y1, 'hull'); add(r, y1, next); };
  const Rw = R + 0.0022;
  add(R + 0.022, -0.030, 'hull');
  add(R + 0.006, 0.010, 'hull');
  add(R + 0.0030, 0.012, 'hull');
  add(R + 0.0030, 0.014, 'hull');
  add(Rw, 0.014, 'radiator');
  add(Rw, 0.024, 'hull');
  add(R + 0.0036, 0.024, 'hull');
  add(R + 0.0036, 0.0252, 'hull');
  add(Rw, 0.0252, 'hull');
  recess(Rw, 0.0258, 0.0296, 0.0009, 'window', 'hull');
  recess(Rw, 0.0306, 0.0310, 0.0003, 'stripW', 'radiator');
  recess(Rw, 0.0336, 0.0346, 0.0009, 'window', 'hull');
  recess(Rw, 0.0362, 0.0382, 0.0009, 'window', 'hull');
  // kołnierz: skos od spodu, lico z wnęką okien i chłodną listwą, fazy ku pokładowi
  add(Rw, 0.0390, 'hull');
  add(R + 0.0048, 0.0405, 'hull');
  recess(R + 0.0048, 0.0416, 0.0434, 0.0008, 'window', 'hull');
  recess(R + 0.0048, 0.0448, 0.0452, 0.0003, 'stripC', 'hull');
  add(R + 0.0048, T - 0.0068, 'hull');
  add(R + 0.0030, T - 0.0053, 'hull');
  add(R + 0.0018, T - 0.0041, 'hull');
  add(R + 0.0010, T - 0.0033, 'hull');
  add(R - 0.0010, T - 0.0013, 'hull');
  // pokład górny → uskok (wnęka okien, ciepła listwa) → taras środkowy → uskok (chłodna listwa) → taras wewnętrzny
  add(R - 0.0020, T, 'deck');
  add(Mr + 0.0008, T, 'hull');
  add(Mr, T + 0.0008, 'hull');
  recess(Mr, T + 0.0012, T + 0.0040, 0.0005, 'windowR', 'hull');
  recess(Mr, Mh - 0.0010, Mh - 0.0006, 0.0002, 'stripW', 'hull');
  add(Mr - 0.0006, Mh, 'deck');
  add(Ir + 0.0008, Mh, 'hull');
  add(Ir, Mh + 0.0008, 'hull');
  recess(Ir, Mh + 0.0012, Mh + 0.0040, 0.0005, 'windowR', 'hull');
  recess(Ir, Ih - 0.0010, Ih - 0.0006, 0.0002, 'stripC', 'hull');
  add(Ir - 0.0006, Ih, 'hull');
  // ziggurat akceleratora: 4 skosy po 0,0015 R, 3 stopnie, warga krateru (apertureH)
  const r0 = Ir - 0.0035, rise = 0.0015, steps = 3;
  const tread = (r0 - Cr - rise * 4) / steps;
  const dh = (Ah - Ih) / 4;
  const treads = [];
  add(r0, Ih, 'hull');
  let r = r0, y = Ih;
  for (let k = 0; k < steps; k++) {
    r -= rise; y += dh;
    add(r, y, 'deck');
    treads.push({ r: r - tread * 0.5, y, w: tread });
    r -= tread;
    add(r, y, 'hull');
  }
  // warga krateru i lej do gardzieli (gładko)
  add(Cr, Ah, 'deck');
  treads.push({ r: Cr - 0.002, y: Ah, w: 0.004 });
  add(Cr - 0.004, Ah, 'smooth');
  add(Ar + 0.0013, Ah - 0.0014, 'smooth');
  add(Ar + 0.0001, Ah - 0.0045, 'smooth');
  add(Ar, Ah - 0.017, 'smooth');
  add(Ar - 0.0003, -0.005, null);
  const side = [[R + 0.022, -0.030], [R + 0.006, 0.010], [R + 0.003, 0.012], [R + 0.003, 0.014], [Rw, 0.014], [Rw, 0.0405]];
  return { P, S, treads, side };
}

function buildMassif(ctx) {
  const { M, geo } = ctx;
  const hull = M.acc(PART.HULL, 0.1);
  const deck = M.acc(PART.HULL, 0.3);
  const segs = geo.S.map((s) => {
    switch (s) {
      case 'window': return { acc: M.acc(PART.WINDOW, 0.2), z: 0.88 };
      case 'windowR': return { acc: M.acc(PART.WINDOW, 0.35), z: 0.86 };
      case 'radiator': return { acc: M.acc(PART.STRUCT, 0.15) };
      // cienkie listwy: ciepłe (taras środkowy, ściana) i chłodne (kołnierz, taras wewnętrzny) — pierścienie z daleka
      case 'stripW': return { acc: M.acc(PART.STRIP, 0.7), z: 0.4, w: 0 };
      case 'stripC': return { acc: M.acc(PART.STRIP, 0.8), z: 0.4, w: 1 };
      case 'deck': return { acc: deck };
      case 'smooth': return { acc: hull, smooth: true };
      case 'hull': return { acc: hull };
      default: return null;
    }
  });
  lathe(geo.P, segs, 72);
}

// ── Przęsła ściany: pilastry, wymienniki, kanały wlotu, bramy mostów ────────────────────────────────────────────────
function buildSpans(ctx) {
  const { L, b, z0, geo, rng } = ctx;
  const n = L.corkSpans;
  const step = TAU / n;
  const tol = 0.6 * Math.PI / n;
  // pilastry na krawędziach przęseł (co 360° / n, przesunięte o pół przęsła względem mostów)
  for (let i = 0; i < n; i++) buildPilaster(ctx, ctx.az0 + (i + 0.5) * step, i);
  for (let i = 0; i < n; i++) {
    const az = ctx.az0 + i * step;
    const kG = ctx.bridgeAz.findIndex((a) => Math.abs(angDiff(az, a)) < tol);
    if (kG >= 0) { buildGate(ctx, az, i, ctx.contact[kG]); continue; }
    const wl = waterline(geo.side, az, b, z0);
    const k = ctx.sectorAz.findIndex((a) => Math.abs(angDiff(az, a)) < tol);
    // w środkach sektorów na przemian: kanał wlotu lawy i wylot zużytego medium; reszta przęseł — wymienniki (nie tam,
    // gdzie przed ścianą korka leży już pas osłon stopy ściany — obudowa)
    if (k >= 0) (k % 2 ? buildOutlet : buildIntake)(ctx, az, wl, i);
    else if (lavaHeight(az, wl.r + 0.004, b, z0) < bandH(L)) buildExchanger(ctx, az, wl, i, rng);
  }
}

/**
 * Pilaster: stalowa kolumna skrzynkowa od lawy pod kołnierz (lico — płyty, boki — stal żebrowana), wspornik pod
 * kołnierzem, zastrzał w lawę; co trzeci — czerwone światło pozycyjne (pierścień błysków z daleka).
 */
function buildPilaster(ctx, az, i) {
  const { L, M, b, z0, geo } = ctx;
  const R = L.corkR, T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const wl = waterline(geo.side, az, b, z0);
  const hull = M.acc(PART.HULL, 0.45);
  const st = M.acc(PART.STRUCT, 0.45);
  const faces = (k, nu) => (Math.abs(nu) > 1e-6 ? st : hull);
  box(F, 0, R + 0.0038, 0.0012, 0.0026, wl.y - 0.008, T - 0.0072, { side: faces, top: hull, bottom: null }, 0, 0, 0.0005);
  box(F, 0, R + 0.0046, 0.0016, 0.0024, T - 0.0150, T - 0.0118, hull, 0, 0, 0.0006);
  const yS = wl.y + 0.0035;
  const hS = lavaHeight(az, R + 0.016, b, z0);
  if (yS < T - 0.017 && hS < yS - 0.004) beam(st, F.at(0, yS, R + 0.0060), F.at(0, hS - 0.003, R + 0.016), 0.0008, 6);
  if (i % 3 === 1) box(F, 0, R + 0.0052, 0.0006, 0.0006, T - 0.0072, T - 0.0060, lampAcc(M, (i * 0.137) % 1), 0.4, 0);
}

/**
 * Przęsło wymienników: dwie GRUBE PRZEGRODY z kołnierzem na linii lawy (żar tylko w wąskim pasie przy lawie, wyżej stal)
 * niosą KOLEKTOR RUR — dwa poziome przewody przez całe przęsło z nogami zanurzonymi w lawie (żarzące się obejmy na linii
 * lawy) i pionami do skrzyni; nad nimi skrzynia z trzema wentylatorami (wnęka z łopatkami, żar tylko w piaście), wyżej
 * dwa kolektory rur przez całe przęsło — tylko tam, gdzie pod kołnierzem jest miejsce (z boków, gdzie lawa stoi wysoko,
 * zostają same przegrody i kolektor).
 */
function buildExchanger(ctx, az, wl, i, rng) {
  const { L, M, b, z0 } = ctx;
  const n = L.corkSpans;
  const R = L.corkR;
  const span = (TAU / n) * (R + 0.004);
  const F = radialFrame(az, 0, 0);
  const seed = (i * 0.31) % 1;
  const hot = M.acc(PART.HOT, seed);
  const st = M.acc(PART.STRUCT, seed);
  const hull = M.acc(PART.HULL, (i * 0.17) % 1);
  const hW = wl.y;
  const ceil = 0.0388;                      // pod skosem kołnierza
  const usable = span - 0.0034;
  const finTop = Math.min(hW + 0.0085, ceil);
  // przegrody: żar od lawy (lustro w połowie widocznej długości — dno gryzu wznosi się ku ścianie) do 0,0004 nad nią,
  // kołnierz tuż nad linią lawy, skośny wierzch ku ścianie
  const wIn = wl.r - 0.004, wOut = wl.r + 0.0068 + rng.range(-0.0004, 0.0004);
  const hM = lavaHeight(az, (wl.r + wOut) / 2, b, z0);
  const heat = (p) => 0.48 * clamp01(1 - (p.y - hM + 0.0004) / 0.0011);
  for (const s of [-1, 1]) {
    const u = s * usable * 0.3;
    prism(F, rect(u, (wIn + wOut) / 2, 0.0009, (wOut - wIn) / 2),
      [{ v: hM - 0.007, side: hot }, { v: hM - 0.0004, side: hot }, { v: hM + 0.0004, side: st }, { v: finTop, o: [0, -0.003] }],
      { side: st, top: st, bottom: null }, heat);
    box(F, u, (wl.r + wOut) / 2 + 0.0003, 0.0016, (wOut - wl.r) / 2 + 0.0006, hM + 0.0004, hM + 0.0014, st, 0, 0, 0.0002);
  }
  // kolektor: przewód główny na kołnierzach (nogi w lawę z żarzącymi się obejmami) i drugi wyżej (piony do skrzyni)
  const wH = wl.r + 0.0032, yH = hM + 0.0024;
  const wH2 = wl.r + 0.0016, yH2 = Math.min(hM + 0.0048, finTop - 0.0009);
  const hL = lavaHeight(az, wH + 0.0002, b, z0);
  cylinder(st, F.at(-usable / 2 - 0.0004, yH, wH), F.at(usable / 2 + 0.0004, yH, wH), 0.0010, 0.0010, 10, false);
  if (yH2 > yH + 0.0016) cylinder(st, F.at(-usable / 2 - 0.0004, yH2, wH2), F.at(usable / 2 + 0.0004, yH2, wH2), 0.0007, 0.0007, 8, false);
  for (const f of [-0.45, -0.15, 0.15, 0.45]) {
    const u = f * usable;
    cylinder(st, F.at(u, yH, wH), F.at(u, hL - 0.004, wH + 0.0004), 0.0005, 0.0005, 6, false);
    cylinder(hot, F.at(u, hL - 0.0006, wH + 0.0002), F.at(u, hL + 0.0005, wH + 0.0001), 0.0008, 0.0008, 8, false, 0.42);
  }
  if (finTop + 0.0045 > ceil) return;
  // piony z kolektora do skrzyni
  if (yH2 > yH + 0.0016) for (const f of [-0.15, 0.15]) cylinder(st, F.at(f * usable, yH2, wH2), F.at(f * usable, finTop + 0.0004, Math.min(wH2, R + 0.005)), 0.00045, 0.00045, 6, false);
  // skrzynia wentylatorów (lico w linii pilastrów) z trzema wentylatorami
  const hy0 = finTop, hy1 = finTop + 0.0045;
  box(F, 0, R + 0.0037, usable / 2, 0.0025, hy0, hy1, hull, 0, 0, 0.0004);
  const fy = (hy0 + hy1) / 2;
  for (let k = -1; k <= 1; k++) wallFan(M, F, k * usable * 0.31, fy, R + 0.0062, 0.0016, seed, hull, st, hot, (k + 1) * 0.37 + i * 0.61);
  // kolektory rur nad skrzynią (wchodzą w pilastry — z daleka ciągłe poziome linie)
  if (hy1 + 0.0036 > ceil) return;
  for (const dy of [0.0011, 0.0027]) cylinder(st, F.at(-span / 2, hy1 + dy, R + 0.0044), F.at(span / 2, hy1 + dy, R + 0.0044), 0.0007, 0.0007, 8, false);
}

/**
 * Wentylator wymiennika na licu skrzyni (oś wzdłuż F.W, lico na `wFace`): obręcz wysunięta przed lico (wnęka głębokości
 * 0,0006 R), ciemna przegroda w dnie wnęki, 6 skośnych łopatek promienistych i piasta z żarem (HOT) — bez krzyża.
 */
function wallFan(M, F, u, fy, wFace, fr, seed, hull, st, hot, rot) {
  const C = F.at(u, fy, wFace);
  const ri = fr - 0.0001, rh = fr * 0.3;
  lathe([[fr + 0.0002, -0.0001], [fr + 0.0002, 0.0007], [ri, 0.0007], [ri, 0.0001], [rh, 0.0001], [rh, 0.00035], [0, 0.00035]],
    [{ acc: hull, smooth: true }, { acc: hull, smooth: true }, { acc: hull, smooth: true }, { acc: st, smooth: true },
      { acc: st, smooth: true }, { acc: hot, smooth: true, z: 0.42 }], 8, { cx: C.x, cy: C.y, cz: C.z, axis: F.W, e1: F.U });
  // łopatki: krawędź natarcia wyżej (0,0006 przed dnem), spływu niżej — skręt widać w świetle bocznym
  const P = (r, t, h) => C.clone().addScaledVector(F.U, r * Math.cos(t)).addScaledVector(F.V, r * Math.sin(t)).addScaledVector(F.W, h);
  const r0 = fr * 0.33, r1 = ri - 0.0001;
  for (let k = 0; k < 6; k++) {
    const t = rot + (k / 6) * TAU;
    quad(st, P(r0, t, 0.0006), P(r1, t, 0.0006), P(r1, t + 0.42, 0.00016), P(r0, t + 0.9, 0.00016), F.W);
  }
}

/**
 * Kanał wlotu lawy: koryto na podporach — wynurza się z jeziora (głowica pomp) i wznosi do śluzy w ścianie korka;
 * w korycie płynie żar (HOT), ścianki i głowica — stal, wrota śluzy z cienką listwą.
 */
function buildIntake(ctx, az, wl, i) {
  const { L, M, b, z0 } = ctx;
  const F = radialFrame(az, 0, 0);
  const st = M.acc(PART.STRUCT, (i * 0.21) % 1);
  const hull = M.acc(PART.HULL, 0.62);
  const hot = M.acc(PART.HOT, 0.9);
  const half = 0.0052, wallT = 0.0016;
  const w0 = wl.r - 0.002;
  // koryto kończy się przed pasem osłon stopy ściany; gdy jeziora przed korkiem prawie nie ma — same wrota śluzy
  const len = Math.min(0.032, wallRhoAt(az, bandH(L), b, z0) - 0.005 - w0);
  if (len < 0.014) {
    box(F, 0, wl.r + 0.0022, half + wallT + 0.0016, 0.0024, wl.y - 0.004, wl.y + 0.0155, hull, 0, 0, 0.0008);
    box(F, 0, wl.r + 0.0047, half - 0.0003, 0.0002, wl.y + 0.0110, wl.y + 0.0115, M.acc(PART.STRIP, 0.3), 0.4, 0);
    return;
  }
  const w1 = w0 + len;
  const lava1 = lavaHeight(az, w1, b, z0);
  // dno koryta: od lustra lawy przy głowicy (−0,001) do +0,005 nad linią lawy przy ścianie
  const fA = wl.y + 0.005, fB = lava1 - 0.001;
  const nS = 12;
  const S = [];
  for (let k = 0; k <= nS; k++) {
    const t = k / nS;
    const w = lerp(w0, w1, t);
    S.push({ w, f: lerp(fA, fB, t), h: lavaHeight(az, w, b, z0) });
  }
  for (let k = 0; k < nS; k++) {
    const a = S[k], c = S[k + 1];
    // ścianki koryta (od lawy do korony 0,0035 nad dnem)
    for (const s of [-1, 1]) {
      const u0 = s * half, u1 = s * (half + wallT);
      const pa = (u, v, w) => F.at(u, v, w);
      const lo = Math.min(a.h, c.h) - 0.003;
      quad(st, pa(u1, a.f + 0.0035, a.w), pa(u1, c.f + 0.0035, c.w), pa(u1, lo, c.w), pa(u1, lo, a.w), F.U.clone().multiplyScalar(s));
      quad(st, pa(u0, a.f + 0.0035, a.w), pa(u0, c.f + 0.0035, c.w), pa(u0, c.f, c.w), pa(u0, a.f, a.w), F.U.clone().multiplyScalar(-s));
      quad(hull, pa(u0, a.f + 0.0035, a.w), pa(u1, a.f + 0.0035, a.w), pa(u1, c.f + 0.0035, c.w), pa(u0, c.f + 0.0035, c.w), UP);
    }
    // żar w korycie (jaśniej przy głowicy — świeża lawa)
    const za = 0.4 + 0.12 * (k / nS), zc = 0.4 + 0.12 * ((k + 1) / nS);
    const p0 = F.at(-half, a.f, a.w), p1 = F.at(half, a.f, a.w), p2 = F.at(half, c.f, c.w), p3 = F.at(-half, c.f, c.w);
    quad(hot, p0, p1, p2, p3, UP, (p) => (p === p0 || p === p1 ? za : zc));
  }
  // podpory koryta nad lawą
  for (const t of [0.3, 0.62]) {
    const w = lerp(w0, w1, t), f = lerp(fA, fB, t), h = lavaHeight(az, w, b, z0);
    if (f - h > 0.002) box(F, 0, w, half + wallT + 0.0006, 0.0011, h - 0.004, f, st);
  }
  // głowica pomp na końcu (wynurza się z lawy) i wrota śluzy przy ścianie
  box(F, 0, w1 - 0.002, half + wallT + 0.0012, 0.0032, lava1 - 0.006, fB + 0.0062, hull, 0, 0, 0.0007);
  box(F, 0, w1 - 0.002, half + wallT + 0.0006, 0.00025, fB + 0.0064, fB + 0.0069, M.acc(PART.STRIP, 0.3), 0.35, 0);
  box(F, 0, wl.r + 0.0022, half + wallT + 0.0016, 0.0024, wl.y - 0.004, fA + 0.0105, hull, 0, 0, 0.0008);
  box(F, 0, wl.r + 0.0047, half - 0.0003, 0.0002, fA + 0.0060, fA + 0.0065, M.acc(PART.STRIP, 0.3), 0.4, 0);
}

/**
 * Wylot zużytego medium: dwie grube rury z obudowy przy ścianie, zgięte w dół do jeziora (u wejścia w lawę —
 * żarzący się pierścień rozbryzgu), podpory na lawie.
 */
function buildOutlet(ctx, az, wl, i) {
  const { L, M, b, z0 } = ctx;
  const F = radialFrame(az, 0, 0);
  const st = M.acc(PART.STRUCT, (i * 0.23 + 0.4) % 1);
  const hull = M.acc(PART.HULL, 0.58);
  const y0 = wl.y + 0.0095;
  // rury schodzą do jeziora przed pasem osłon stopy ściany; gdy jeziora przed korkiem prawie nie ma — sama obudowa
  // (podniesiona nad pas osłon)
  const wIn = Math.min(wl.r + 0.021, wallRhoAt(az, bandH(L), b, z0) - 0.007);
  if (wIn - wl.r > 0.013) buildOutletPipes(ctx, F, az, wl, wIn, y0, st, hull);
  const hB = lavaHeight(az, wl.r + 0.0046, b, z0);
  const base = hB >= bandH(L) ? Math.max(wl.y + 0.003, hB + 0.0042) : wl.y + 0.003;
  // obudowa wylotu przy ścianie z cienką ciepłą listwą
  box(F, 0, wl.r + 0.002, 0.0066, 0.0026, base, Math.max(base + 0.006, wl.y + 0.0145), hull, 0, 0, 0.0008);
  const yS = Math.max(base + 0.0049, wl.y + 0.0129);
  box(F, 0, wl.r + 0.0047, 0.0058, 0.0002, yS, yS + 0.0005, M.acc(PART.STRIP, 0.35), 0.4, 0);
}

/** Rury wylotu: z obudowy przy ścianie, zgięte w dół do jeziora (w odległości wIn od osi), pierścień rozbryzgu, podpory. */
function buildOutletPipes(ctx, F, az, wl, wIn, y0, st, hull) {
  const { M, b, z0 } = ctx;
  const hot = M.acc(PART.HOT, 0.85);
  const hIn = lavaHeight(az, wIn, b, z0);
  for (const u of [-0.0034, 0.0034]) {
    const pts = [
      F.at(u, y0, wl.r - 0.001), F.at(u, y0, wl.r + 0.007), F.at(u, lerp(y0, hIn, 0.45), lerp(wl.r + 0.007, wIn - 0.0012, 0.59)),
      F.at(u, hIn + 0.002, wIn - 0.0012), F.at(u, hIn - 0.006, wIn + 0.0006)
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    appendGeometry(st, new THREE.TubeGeometry(curve, 40, 0.0019, 12, false), 0, 0);
    // obręcze wzdłuż rury
    for (const t of [0.18, 0.42, 0.66]) {
      const p = curve.getPointAt(t), d = curve.getTangentAt(t);
      cylinder(hull, p.clone().addScaledVector(d, -0.0004), p.clone().addScaledVector(d, 0.0004), 0.0023, 0.0023, 12, true);
    }
    // pierścień rozbryzgu na lustrze lawy wokół wejścia rury (żar ≤ 0,55)
    const c = F.at(u, 0, wIn);
    const hC = lavaHeight(az, wIn, b, z0);
    lathe([[0.0046, hC + 0.0005], [0.0021, hC + 0.0009]], [{ acc: hot, z: (r) => lerp(0.25, 0.55, clamp01((0.0046 - r) / 0.0025)) }], 24, { cx: c.x, cz: c.z });
    // podpora pod kolanem rury
    const pS = curve.getPointAt(0.3);
    const hS = lavaHeight(az, wl.r + 0.009, b, z0);
    if (pS.y - hS > 0.003) {
      const Fs = frame(new V3(pS.x, 0, pS.z), F.U, UP.clone(), F.W);
      box(Fs, 0, 0, 0.0014, 0.0012, hS - 0.004, pS.y - 0.0019, st);
    }
  }
}

/**
 * Brama mostu w przęśle: blok na ścianie korka z portalem (mosty wchodzą w jej czoło), dyspozytornia i antena. Czoło
 * bramy — `C.gate` (footContact): gdzie ściana gryzu podchodzi pod korek, brama cofa się przed rozdzielnię stopy, a
 * skośnych przypór (sięgają 0,008 R przed czoło) nie ma.
 */
function buildGate(ctx, az, i, C) {
  const { L, M, b, z0, geo } = ctx;
  const F = radialFrame(az, 0, 0);
  const R = L.corkR, T = L.corkTopH;
  const wl = waterline(geo.side, az, b, z0);
  const hull = M.acc(PART.HULL, 0.75);
  const half = 0.0092;
  const r1 = C.gate;
  // bryła bramy: od lawy do nad pokład, fazowana
  prism(F, rect(0, (R - 0.002 + r1) / 2, half, (r1 - R + 0.002) / 2),
    [{ v: wl.y - 0.008 }, { v: T + 0.0006 }, { v: T + 0.0018, s: [0.88, 0.86] }], hull);
  // skośne przypory bramy ku lawie (tylko gdy przed bramą jest jezioro)
  if (C.deck - r1 > 0.014) {
    for (const s of [-1, 1]) {
      prism(F, rect(s * half, r1 + 0.002, 0.0015, 0.006),
        [{ v: wl.y - 0.010 }, { v: wl.y + 0.004 }, { v: T - 0.004, o: [0, -0.011] }], M.acc(PART.STRUCT, 0.75));
    }
  }
  // portal: rama chłodnej listwy wokół wejścia przewodów, ciemne szkło w środku
  const deckTop = ctx.deckTop;
  const hw = L.corkBridgeW / 2;
  box(F, 0, r1 + 0.0002, hw + 0.0008, 0.0003, deckTop - 0.0005, deckTop + 0.0058, M.acc(PART.STRIP, 0.2), 0.4, 1);
  box(F, 0, r1 + 0.0004, hw - 0.0006, 0.0003, deckTop + 0.0006, deckTop + 0.0050, M.acc(PART.GLASS, 0.2));
  // pas okien we wnęce: ciągły (z 0,9), parapet i nadproże wysunięte
  const yW0 = T - 0.0046, yW1 = T - 0.0024;
  box(F, 0, r1 + 0.00005, half * 0.8, 0.00015, yW0, yW1, M.acc(PART.WINDOW, 0.4), 0.9);
  for (const [v0, v1] of [[yW0 - 0.0005, yW0], [yW1, yW1 + 0.0005]]) box(F, 0, r1 + 0.00035, half * 0.84, 0.00035, v0, v1, hull);
  // dyspozytornia na bramie i ciężki pylon z kondygnacjami świateł
  // (na wierzchu bramy: przy krótkiej bramie dyspozytornia cofa się nad pokład, pylon stoi obok niej)
  const top = T + 0.0018;
  const wD = Math.min(R + 0.0055, (R - 0.002 + r1) / 2);
  bandBlock(F, 0, wD, 0.0044, 0.0032, top, top + 0.0040, hull, M.acc(PART.WINDOW, 0.9));
  heavyPylon(M, F, -0.0068, Math.min(R + 0.0098, r1 - 0.0015), top, 0.0125, 0.0011, 0.0005, 4, (i * 0.29 + 0.1) % 1, { spire: 0.0035 });
}

// ── Pylony ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * CIĘŻKI PYLON (bramy mostów, kolektory akceleratora, iglice arkologii): pełny trzon z ciemnej stali o przekroju
 * kwadratowym od (cu, cw) w ramie F na wysokości y0 (półszerokość b0) do (cu1, cw1) na y0 + h (b1), w `tiers`
 * kondygnacjach — każda zbiega się lekko ku górze i kończy GZYMSEM (wysunięty pierścień); pod gzymsem cienka listwa
 * świateł (pod progiem bloomu: z daleka rytm poziomych kresek — kondygnacje świateł; `cool` 0 ciepła / 1 chłodna),
 * następna kondygnacja cofnięta uskokiem. Czerwone światła pozycyjne na dwóch narożach gzymsu co drugiej kondygnacji
 * i na ostatniej, `spire` — iglica z białym światłem. Kratownice przy korku o promieniu 830 km czytały się jak maszty
 * radiowe — pylon ma masę budowli.
 */
function heavyPylon(M, F, cu, cw, y0, h, b0, b1, tiers, seed, { cu1 = cu, cw1 = cw, spire = 0, cool = 0 } = {}) {
  const hull = M.acc(PART.HULL, seed);
  const strip = M.acc(PART.STRIP, seed);
  const n = Math.max(1, tiers);
  const lb = Math.max(0.0002, b0 * 0.16);
  let tu = cu, tw = cw, tv = y0, tb = b0;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const au = lerp(cu, cu1, t0), aw = lerp(cw, cw1, t0);
    const bu = lerp(cu, cu1, t1), bw = lerp(cw, cw1, t1);
    const va = y0 + h * t0, vb = y0 + h * t1;
    // uskok: kondygnacja zaczyna się węższa o 6% od trzonu poprzedniej (pierwsza — pełna)
    const ba = lerp(b0, b1, t0) * (i ? 0.94 : 1), bt = lerp(b0, b1, t1);
    const g = Math.min(0.0003, (vb - va) * 0.07);
    const e = Math.min(0.00022, bt * 0.22);
    const o = [bu - au, bw - aw];
    const sT = bt / ba, sC = (bt + e) / ba;
    prism(F, rect(au, aw, ba, ba), [{ v: va }, { v: vb - 2 * g, s: sT, o }, { v: vb - 2 * g, s: sC, o }, { v: vb, s: sC, o }],
      { side: hull, top: hull, bottom: null });
    // listwa świateł pod gzymsem (sama ściana — denka schowane w trzonie i gzymsie)
    box(F, bu, bw, bt + 0.00003, bt + 0.00003, vb - 3 * g, vb - 2 * g, { side: strip, top: null, bottom: null }, 0.38, cool);
    if (i % 2 === 1 || i === n - 1) {
      const c = (bt + e) * 0.8, k = (i >> 1) % 2 ? 1 : -1;
      for (const s of [-1, 1]) {
        box(F, bu + s * c, bw + s * k * c, lb, lb, vb, vb + 1.6 * lb, lampAcc(M, (seed * 5.3 + i * 0.11 + (s > 0 ? 0.07 : 0)) % 1), 0.45, 0);
      }
    }
    tu = bu; tw = bw; tv = vb; tb = bt;
  }
  if (spire > 0) {
    const sb = Math.max(0.00012, tb * 0.3);
    prism(F, rect(tu, tw, sb, sb), [{ v: tv }, { v: tv + spire, s: 0.45 }], { side: hull, top: hull, bottom: null });
    box(F, tu, tw, lb, lb, tv + spire, tv + spire + 2 * lb, lampAcc(M, (seed * 3.1) % 1), 0.7, 1);
  }
}

/**
 * Para KOMINÓW na wspólnym cokole (hale turbin): smukłe walce ze stali żebrowanej zbiegające się ku górze
 * (r → 0,78 r), wieniec w ~0,45 wysokości, korona z cienką ciepłą listwą (pod progiem bloomu), w przelocie żar spalin
 * (HOT rośnie w głąb), czerwone światło na koronie. Pary w ramie F wzdłuż W (cw ± 1,45 r).
 */
function stackPair(ctx, F, cu, cw, y0, h, r, seed) {
  const { M } = ctx;
  const hull = M.acc(PART.HULL, seed), hot = M.acc(PART.HOT, seed), st = M.acc(PART.STRUCT, seed);
  const strip = M.acc(PART.STRIP, 0.5);
  const yP = y0 + 0.0009;
  box(F, cu, cw, r * 1.55, r * 3.05, y0, yP, hull, 0, 0, 0.00015);
  const H = y0 + h - yP;
  const rr = (y) => lerp(r, r * 0.78, clamp01((y - yP) / H));
  const yr = yP + H * 0.45, yc = yP + H, e = 0.00016, dq = 0.0024;
  const prof = [
    [r * 1.22, yP], [r * 1.22, yP + 0.0008], [rr(yP + 0.0008), yP + 0.0008],
    [rr(yr), yr], [rr(yr) + e, yr], [rr(yr) + e, yr + 0.0005], [rr(yr + 0.0005), yr + 0.0005],
    [rr(yc - 0.0009), yc - 0.0009], [rr(yc) + e, yc - 0.0009], [rr(yc) + e, yc - 0.0005], [rr(yc) + e, yc],
    [rr(yc) - 0.0002, yc], [rr(yc) - 0.0002, yc - dq], [0, yc - dq]
  ];
  const sh = { acc: hull, smooth: true }, ss = { acc: st, smooth: true };
  const heat = (q, y) => 0.12 + 0.3 * clamp01((yc - y) / dq);
  // trzon — stal żebrowana (jak chłodnie), kołnierz, wieniec i korona — kadłub
  const segs = [sh, sh, ss, sh, sh, sh, ss, sh, { acc: strip, z: 0.4, w: 0, smooth: true }, sh, sh,
    { acc: hot, z: heat, smooth: true }, { acc: hot, z: 0.42, smooth: true }];
  for (const s of [-1, 1]) {
    const c = F.at(cu, 0, cw + s * r * 1.45);
    lathe(prof, segs, 8, { cx: c.x, cz: c.z });
    const p = F.at(cu, 0, cw + s * r * 1.45 + s * (rr(yc) + e));
    box(frame(p, F.U, F.V, F.W), 0, 0, 0.00022, 0.00022, yc, yc + 0.0004, lampAcc(M, (seed * 7.3 + (s > 0 ? 0.5 : 0)) % 1), 0.5, 0);
  }
}

/**
 * Hala wzdłuż obwodu (hala turbin, pompownia): pierścień ρ r0…r1, azymut a0…a1, od y do y + h — cokół, wnęka pasa
 * okien, gładka ściana, gzyms; pilastry na licu zewnętrznym dzielą chłodną listwę pod gzymsem na przęsła (z daleka
 * przerywane łuki pierścieni), żebra dachu w poprzek (rytm). `hideIn` — ściana ku osi schowana (dobudówka hali).
 */
function hallBlock(ctx, r0, r1, a0, a1, y, h, seed, hideIn = false) {
  const { M } = ctx;
  const hull = M.acc(PART.HULL, seed), win = M.acc(PART.WINDOW, seed), st = M.acc(PART.STRUCT, seed);
  const sd = (A) => (f) => (hideIn && f === 'in' ? null : A);
  const yt = y + h;
  arcBlock(r0, r1, a0, a1, [
    { v: y, side: sd(hull) }, { v: y + 0.0006, side: sd(hull) }, { v: y + 0.0006, d: 0.00025, side: sd(win) },
    { v: y + 0.0013, d: 0.00025, side: sd(hull) }, { v: y + 0.0013, side: sd(hull) }, { v: yt - 0.0003, side: sd(hull) },
    { v: yt - 0.0003, d: -0.00015, side: sd(hull) }, { v: yt, d: -0.00015 }
  ], { side: sd(hull), top: hull }, 8, 0.88);
  const rm = (r0 + r1) / 2;
  arcBlock(r1 - 0.0001, r1 + 0.00004, a0 + 0.0003 / r1, a1 - 0.0003 / r1, [{ v: yt - 0.0009 }, { v: yt - 0.0006 }],
    { side: (f) => (f === 'out' ? M.acc(PART.STRIP, seed) : null), top: null }, 8, 0.35, 1);
  const nP = Math.max(2, Math.round(((a1 - a0) * r1) / 0.0046));
  for (let k = 0; k <= nP; k++) {
    box(radialFrame(lerp(a0 + 0.00035 / r1, a1 - 0.00035 / r1, k / nP), 0, 0), 0, r1 + 0.00016, 0.00032, 0.00018, y, yt - 0.0003, { side: hull, top: hull, bottom: null });
  }
  const nR = Math.max(2, Math.round(((a1 - a0) * rm) / 0.004));
  for (let k = 1; k < nR; k++) {
    box(radialFrame(lerp(a0, a1, k / nR), 0, 0), 0, rm, 0.0002, (r1 - r0) / 2 - 0.0003, yt, yt + 0.00035, { side: st, top: st, bottom: null });
  }
}

// ── Mosty nad lawą ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Styk mostu ze STOPĄ ŚCIANY w azymucie phi. Przy stopie stoi ROZDZIELNIA obudowy (LINING `buildJunction`: skrzynia
 * ±0,0095 R wzdłuż obwodu, ±0,008 R po ścianie od stopy, do ~0,0092 R od ściany z nadbudówką) — most kończy się na jej
 * CZOLE (płaszczyzna 0,0088 R w dół ściany od stopy, z zapasem). Wynik (ρ od osi): `deck` — czoło na wysokości pokładu
 * (tu dźwigar wchodzi w rozdzielnię), `top` — górna krawędź czoła (pylony mostu stoją przed nią), `gate` — czoło bramy
 * korka (R + 0,0125, a gdzie ściana podchodzi pod sam korek — azymuty 280–310° — cofnięte przed rozdzielnię).
 */
function footContact(L, b, phi, deckY) {
  const z0 = plantZ0(b);
  const foot = wallFootPoint(L, b, phi);
  const rf = Math.sqrt(foot.x * foot.x + foot.z * foot.z);
  // kierunek „po ścianie w górę” w (ρ, y) z punktów ściany ±0,001 R wokół stopy; normalna ściany — w otwór
  const p0 = bowlPoint(phi, bowlPsiAtHeight(phi, L.footH - 0.001, b), 0, b, z0, new V3());
  const p1 = bowlPoint(phi, bowlPsiAtHeight(phi, L.footH + 0.001, b), 0, b, z0, new V3());
  let dr = Math.sqrt(p1.x * p1.x + p1.z * p1.z) - Math.sqrt(p0.x * p0.x + p0.z * p0.z), dy = p1.y - p0.y;
  const dl = Math.sqrt(dr * dr + dy * dy) || 1;
  dr /= dl; dy /= dl;
  const nr = -dy;
  const Z = -0.0088, Y = 0.0098;
  const deck = rf + (Z - (deckY - foot.y) * dy) / Math.max(0.2, dr);
  const top = rf + dr * Z + nr * Y;
  const gate = Math.max(L.corkR + 0.006, Math.min(L.corkR + 0.0125, top - 0.0004));
  return { foot, rf, deck, top, gate };
}

/**
 * Most w azymucie phi: od czoła bramy do STOPY ŚCIANY (`wallFootPoint`) — STALOWY DŹWIGAR SKRZYNKOWY (wierzch kadłub,
 * w boku wnęka galerii okien, skośny spód ze stali; spód lekko żarzy się tylko tuż nad lawą), pod nim KRATOWNICA
 * (Warren) z podwieszoną galerią dwóch rur, filary V na stopach w lawie (żar tylko w wąskim pasie przy lawie); gdzie
 * prześwit mały — nasyp pod dźwigarem. Na pokładzie wiązka 3 przewodów energii (PIPE: uv.y 0 korek → 1 stopa), na
 * końcu blok kotwiący na ścianie z pylonami.
 */
function buildBridge(ctx, phi, idx) {
  const { L, M, b, z0 } = ctx;
  const C = ctx.contact[idx];
  const foot = C.foot, rf = C.rf;
  const F = radialFrame(phi, 0, 0);
  const R = L.corkR;
  const r0 = C.gate;                   // czoło bramy
  const hw = L.corkBridgeW / 2;
  const deckTop = ctx.deckTop;
  const gBot = deckTop - 0.0044;       // spód dźwigara
  const hd = hw - 0.0013;              // spód dźwigara węższy (skos)
  const end = Math.max(r0 + 0.002, C.deck + 0.0006);   // dźwigar wchodzi w czoło rozdzielni stopy (obudowa)
  const len = end - r0;
  // pylony przed górną krawędzią czoła rozdzielni; przyczółek pod końcem dźwigara (pod pylonami, w głąb ściany)
  const wPy = C.top - 0.0010 - 0.0032;
  const pylons = wPy - 0.0032 > r0 + 0.004;
  const anchorW = Math.max(r0 + 0.0008, Math.min(end - 0.009, wPy - 0.0040));
  // lawa pod mostem (próbki co ~0,003 R)
  const lW = rf + 0.006 - r0;
  const nL = Math.max(4, Math.ceil(lW / 0.003));
  const lava = [];
  for (let k = 0; k <= nL; k++) lava.push(lavaHeight(phi, r0 + (lW * k) / nL, b, z0));
  const lavaAt = (w) => {
    const t = clamp01((w - r0) / lW) * nL;
    const k = Math.min(nL - 1, Math.floor(t));
    return lerp(lava[k], lava[k + 1], t - k);
  };
  const seed = (idx * 0.173 + 0.05) % 1;
  const hull = M.acc(PART.HULL, seed);
  const st = M.acc(PART.STRUCT, seed);
  const hot = M.acc(PART.HOT, seed);
  const win = M.acc(PART.WINDOW, seed);
  // DŹWIGAR: przekrój (u, v) przeciwnie do wskazówek zegara, rodzaj odcinka od punktu do następnego
  const t = deckTop;
  const sec = [
    [hw, t, hull], [-hw, t, hull], [-hw, t - 0.0011, hull], [-hw + 0.0003, t - 0.0011, win], [-hw + 0.0003, t - 0.0021, hull],
    [-hw, t - 0.0021, hull], [-hw, t - 0.0025, st], [-hd, gBot, 'bottom'], [hd, gBot, st], [hw, t - 0.0025, hull],
    [hw, t - 0.0021, hull], [hw - 0.0003, t - 0.0021, win], [hw - 0.0003, t - 0.0011, hull], [hw, t - 0.0011, hull]
  ];
  const nD = Math.max(2, Math.ceil(len / 0.004));
  const ws = [];
  for (let k = 0; k <= nD; k++) ws.push(r0 + (len * k) / nD);
  const underHeat = (w) => 0.28 * clamp01(1 - (gBot - lavaAt(w)) / 0.012);
  const hint = new V3();
  for (let e = 0; e < sec.length; e++) {
    const [ua, va, kind] = sec[e], [ub, vb] = sec[(e + 1) % sec.length];
    // normalna na zewnątrz przekroju (obieg przeciwny do wskazówek zegara): (Δv, −Δu)
    hint.set(0, 0, 0).addScaledVector(F.U, vb - va).addScaledVector(F.V, ua - ub);
    for (let j = 0; j < nD; j++) {
      const wa = ws[j], wb = ws[j + 1];
      let A = kind, z = kind === win ? 0.88 : 0;
      if (kind === 'bottom') {
        const za = underHeat(wa), zb = underHeat(wb);
        A = za + zb > 0.02 ? hot : st;
        z = (p) => underHeat(F.W.dot(p) >= (wa + wb) / 2 ? wb : wa);
      }
      quad(A, F.at(ua, va, wa), F.at(ub, vb, wa), F.at(ub, vb, wb), F.at(ua, va, wb), hint, z);
    }
  }
  // attyki z cienką ciepłą listwą
  for (const s of [-1, 1]) {
    box(F, s * (hw - 0.0005), (r0 + end) / 2, 0.0005, len / 2, deckTop, deckTop + 0.0010, st);
    box(F, s * (hw - 0.00002), (r0 + end) / 2, 0.00012, len / 2, deckTop + 0.0005, deckTop + 0.0008, M.acc(PART.STRIP, 0.1), 0.35, 0);
  }
  // prześwit pod dźwigarem w stacjach: KRATOWNICA na najdłuższym odcinku z prześwitem ≥ głębokość + 0,004 R (przy
  // stopie ściana gryzu wznosi się ku pokładowi), poza nim — PRZYCZÓŁKI (bloki od lawy pod dźwigar)
  const cl = ws.map((w) => gBot - lavaAt(w));
  const dT = 0.0065;
  let ja = 0, jb = -1;
  for (let j = 0, s0 = -1; j <= nD + 1; j++) {
    const ok = j <= nD && cl[j] >= dT + 0.004;
    if (ok && s0 < 0) s0 = j;
    if (!ok && s0 >= 0) { if (j - 1 - s0 > jb - ja) { ja = s0; jb = j - 1; } s0 = -1; }
  }
  const truss = jb > ja && ws[jb] - ws[ja] > 0.02;
  const wa = truss ? ws[ja] : end, wb = truss ? ws[jb] : end;
  const abut = (w0, w1) => {
    if (w1 - w0 < 0.001) return;
    let lo = Infinity;
    for (let q = 0; q <= 8; q++) lo = Math.min(lo, lavaAt(lerp(w0, w1, q / 8)));
    prism(F, rect(0, (w0 + w1) / 2, hd + 0.0004, (w1 - w0) / 2), [{ v: lo - 0.006, s: [1.4, 1] }, { v: gBot - 0.0012 }, { v: gBot + 0.0004 }],
      { side: hull, top: null, bottom: null });
  };
  abut(r0, wa);
  abut(wb, end);
  if (truss) {
    const tl = wb - wa;
    const yC = gBot - dT;
    const nP = Math.max(2, Math.round(tl / 0.007));
    const pl = tl / nP;
    const uT = hd - 0.0002;
    for (const s of [-1, 1]) {
      beam(st, F.at(s * uT, yC, wa), F.at(s * uT, yC, wb), 0.00045);
      for (let k = 0; k <= nP; k++) {
        const w = wa + pl * k;
        beam(st, F.at(s * uT, gBot, w), F.at(s * uT, yC, w), 0.0003);
        if (k < nP) beam(st, F.at(s * uT, k % 2 ? yC : gBot, w), F.at(s * uT, k % 2 ? gBot : yC, w + pl), 0.0003);
      }
    }
    // stężenia dolne (X) co drugie pole
    for (let k = 0; k < nP; k += 2) {
      const w0 = wa + pl * k, w1 = wa + pl * (k + 1);
      beam(st, F.at(-uT, yC, w0), F.at(uT, yC, w1), 0.00022);
      beam(st, F.at(uT, yC, w0), F.at(-uT, yC, w1), 0.00022);
    }
    // galeria rur: dwie rury na wieszakach pod dźwigarem
    const yP = gBot - dT * 0.5;
    for (const s of [-1, 1]) {
      cylinder(st, F.at(s * 0.0018, yP, wa), F.at(s * 0.0018, yP, wb), 0.00085, 0.00085, 10, false);
      for (let k = 1; k < nP; k += 2) beam(st, F.at(s * 0.0018, gBot, wa + pl * k), F.at(s * 0.0018, yP + 0.0008, wa + pl * k), 0.00015);
    }
    // filary V: stopa w lawie (żar tylko przy lawie), cztery nogi do pasa dolnego kratownicy
    const nPier = tl > 0.075 ? 2 : tl > 0.035 ? 1 : 0;
    for (let k = 1; k <= nPier; k++) {
      const wp = wa + (tl * k) / (nPier + 1);
      const hL = lavaAt(wp);
      if (yC - hL < 0.009) continue;
      const heat = (p) => 0.5 * clamp01(1 - (p.y - hL) / 0.0035);
      prism(F, ngon(8, 0.0026, 0.0026).map(([u, w]) => [u, w + wp]),
        [{ v: hL - 0.007, side: hot }, { v: hL, side: hot }, { v: hL + 0.0017, side: hot }, { v: hL + 0.0035, side: hull }, { v: hL + 0.0045, s: 0.8 }],
        { side: hot, top: hull, bottom: null }, heat);
      const sp = Math.min(0.012, (yC - hL) * 0.55, pl * 1.5);
      for (const s of [-1, 1]) {
        for (const d of [-1, 1]) cylinder(st, F.at(s * 0.0011, hL + 0.004, wp + d * 0.0011), F.at(s * uT, yC, wp + d * sp), 0.0007, 0.0005, 6, false);
      }
    }
  }
  // przyczółek pod końcem dźwigara (dalsza część — pod rozdzielnią stopy i w ścianie) i pylony ze światłami — przed
  // czołem rozdzielni (gdzie ściana podchodzi pod korek, pylonów nie ma: brama, przyczółek i rozdzielnia stoją w rzędzie)
  const wA = C.deck + 0.006;
  const hk = Math.min(lavaAt(anchorW), gBot - 0.004);
  const anchor = M.acc(PART.HULL, (seed + 0.5) % 1);
  prism(F, rect(0, (anchorW + wA) / 2, hw + 0.0028, (wA - anchorW) / 2),
    [{ v: hk - 0.008 }, { v: deckTop - 0.0010 }, { v: deckTop - 0.0002, s: [0.94, 0.93] }], anchor);
  if (pylons) {
    for (const s of [-1, 1]) {
      box(F, s * (hw + 0.0012), wPy, 0.0014, 0.0032, deckTop - 0.0002, deckTop + 0.0075, anchor, 0, 0, 0.0005);
      box(F, s * (hw + 0.0012), wPy, 0.0006, 0.0006, deckTop + 0.0075, deckTop + 0.0087, lampAcc(M, (seed * 3 + (s > 0 ? 0.3 : 0.7)) % 1), 0.6, 0);
    }
  }
  // wiązka przewodów: z bramy po pokładzie w czoło rozdzielni, dalej (w jej wnętrzu) do stopy ściany
  const pr = L.corkPipeR;
  const yp = deckTop + pr;
  const wIn = C.deck - 0.001;
  for (const o of [-0.0034, 0, 0.0034]) {
    const pts = [F.at(o, yp, R + 0.002)];
    let last = R + 0.002;
    for (const w of [r0 + 0.004, (r0 + C.deck) / 2, C.deck - 0.010]) {
      if (w > last + 0.002 && w < wIn - 0.003) { pts.push(F.at(o, yp, w)); last = w; }
    }
    if (wIn > last + 0.001) pts.push(F.at(o * 0.55, yp, wIn));
    pts.push(F.at(o * 0.12, lerp(yp, foot.y, 0.6), rf - 0.003));
    pts.push(foot.clone().addScaledVector(F.U, o * 0.05));
    pipe(M, pts, pr * (o === 0 ? 1.1 : 0.85), (idx * 0.37 + (o + 0.004) * 60) % 1);
  }
}

/** Przewód energii (PIPE) po punktach: uv.y 0 → 1 wzdłuż, z — długość drogi, w = +1 (impulsy od korka). */
function pipe(M, pts, r, seed) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const tube = new THREE.TubeGeometry(curve, Math.max(16, Math.ceil(len / 0.0018)), r, 8, false);
  appendGeometry(M.acc(PART.PIPE, seed), tube, len, 1, true);
}

/** Dopisuje geometrię three (pozycje, normalne, uv) do akumulatora; `swapUv` — uv.y = droga (TubeGeometry ma ją w u). */
function appendGeometry(A, g, z, w, swapUv = false) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const base = A.count;
  const p = new V3(), n = new V3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const u = uv.getX(i), v = uv.getY(i);
    A.vert(p, n, swapUv ? 0.25 : u, swapUv ? u : v, val(z, p), val(w, p));
  }
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) A.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
  else for (let i = 0; i < pos.count; i += 3) A.tri(base + i, base + i + 1, base + i + 2);
  g.dispose();
}

// ── Pokład górny: maszynownie, estakada, szyna zbiorcza, rozdzielnie, arkologie, lądowiska ──────────────────────────
/**
 * Pokład górny w każdym sektorze między mostami: rozdzielnia przy moście, DWIE MASZYNOWNIE (kompleksy turbin pod jednym
 * dachem wzdłuż obwodu, `buildMachineHall`), w środku sektora arkologia albo bateria zbiorników pod suwnicą
 * (`tankBattery`); od strony osi pierścień ESTAKADY
 * RUR nad drogą obwodową (odgałęzienia do maszynowni), na krawędzi szyna zbiorcza.
 */
function buildTopDeck(ctx) {
  const { L, M } = ctx;
  const T = L.corkTopH, R = L.corkR, Mr = L.corkMidR;
  const rc = (R - 0.002 + Mr + 0.0015) / 2 - 0.0015;   // środek pasa zabudowy (arkologie, lądowiska, rozdzielnie)
  const nB = ctx.bridgeAz.length;
  const sec = TAU / nB;
  // maszynownie: po dwie w sektorze, ±(¼ sektora − 5°) — luz do rozdzielni i podium arkologii
  const half = Math.max(2 * DEG, sec / 4 - 5 * DEG);
  ctx.bridgeAz.forEach((a, s) => {
    for (const k of [0, 1]) buildMachineHall(ctx, a + sec * (k ? 0.75 : 0.25), half, s * 2 + k);
  });
  buildPipeRack(ctx, Mr + 0.0038, T, { portals: 48, seed: 0.44, segs: 96 });
  // szyna zbiorcza: pierścień przewodu na krawędzi pokładu (impulsy wokół; długość — wielokrotność odstępu impulsów)
  const rb = R - 0.0032;
  const ring = new THREE.TorusGeometry(rb, 0.00085, 8, 288);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, T + 0.00095, 0);
  {
    const A = M.acc(PART.PIPE, 0.55);
    const pos = ring.attributes.position, nor = ring.attributes.normal;
    const base = A.count;
    const p = new V3(), n = new V3();
    const lenQ = Math.round((TAU * rb) / 0.03) * 0.03;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      // droga wzdłuż pierścienia z azymutu (ciągła na szwie: z jest wielokrotnością odstępu)
      let a = Math.atan2(-p.z, p.x) / TAU;
      if (a < 0) a += 1;
      A.vert(p, n, 0.25, a, lenQ, 1);
    }
    const idx = ring.index;
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
      // trójkąty na szwie azymutu dostają uv z drugiej strony — bez skoku (u → u + 1)
      const ua = A.uv[(base + ia) * 2 + 1], ub = A.uv[(base + ib) * 2 + 1], uc = A.uv[(base + ic) * 2 + 1];
      if (Math.max(ua, ub, uc) - Math.min(ua, ub, uc) > 0.5) {
        const fix = (j) => { const k = (base + j) * 2 + 1; return A.uv[k] < 0.5 ? A.vert(new V3(A.pos[(base + j) * 3], A.pos[(base + j) * 3 + 1], A.pos[(base + j) * 3 + 2]), new V3(A.nrm[(base + j) * 3], A.nrm[(base + j) * 3 + 1], A.nrm[(base + j) * 3 + 2]), 0.25, A.uv[k] + 1, lenQ, 1) : base + j; };
        A.tri(fix(ia), fix(ib), fix(ic));
      } else A.tri(base + ia, base + ib, base + ic);
    }
    ring.dispose();
  }
  // wsporniki szyny co 7,5°
  const st = M.acc(PART.STRUCT, 0.35);
  for (let k = 0; k < 48; k++) box(radialFrame((k / 48) * TAU, 0, 0), 0, rb, 0.0004, 0.0012, T, T + 0.0006, st);
  // przy mostach rozdzielnie; w środkach sektorów co drugi arkologia, reszta — baterie zbiorników pod suwnicą
  ctx.bridgeAz.forEach((a, s) => {
    buildSwitchyard(ctx, a, rc, s);
    if (s % 2 === 0) buildArcology(ctx, a + sec / 2, rc, s);
    else tankBattery(ctx, radialFrame(a + sec / 2, 0, 0), 0, rc + 0.001, 0.0072, 0.0085, T, (s * 0.17 + 0.61) % 1, s % 4 === 1 ? 1 : -1);
  });
  // droga obwodowa pokładu: cienka ciepła listwa (pod progiem bloomu) — pod estakadą
  stripRing(M, Mr + 0.0045, T, 0.00022, 0.35, 0, 144);
}

/** Pierścień listwy płasko na pokładzie (promień r, wysokość y, półszerokość hw). */
function stripRing(M, r, y, hw, z, w, n) {
  lathe([[r + hw, y + 0.00012], [r - hw, y + 0.00012]], [{ acc: M.acc(PART.STRIP, 0.15), z, w }], n);
}

/**
 * MASZYNOWNIA — kompleks turbin wzdłuż obwodu pokładu (azymut ac ± half), od osi ku krawędzi:
 *   • przybudówka sterowni (niska, jeden ciągły pas okien ku osi), odgałęzienia estakady rur nad nią do hali;
 *   • HALA GŁÓWNA pod jednym dużym dachem: cokół, pas okien przy cokole dzielony pilastrami na wnęki, gładka ściana,
 *     gzyms; na dachu świetlik z ciemnego szkła (cienkie chłodne listwy u podstawy — z góry łuki pierścieni) i bloki
 *     wentylacji;
 *   • HALA TURBIN na zewnątrz (`hallBlock`): niższa dobudówka na całej długości (cokół, pas okien, pilastry, chłodna
 *     listwa pod gzymsem, żebra dachu), na jednym końcu (na przemian) PARA KOMINÓW na cokole (`stackPair`).
 * Wymiary od krawędzi pokładu (R) i od uskoku tarasu (Mr) — w luzie do szyny zbiorczej (R − 0,0032 ± 0,0012).
 */
function buildMachineHall(ctx, ac, half, i) {
  const { L, M } = ctx;
  const T = L.corkTopH, R = L.corkR, Mr = L.corkMidR;
  const rng = plantRng(L.corkSeed * 131 + i * 977 + 3);
  const seed = (i * 0.0833 + 0.04) % 1;
  const hull = M.acc(PART.HULL, seed);
  const win = M.acc(PART.WINDOW, seed);
  const st = M.acc(PART.STRUCT, seed);
  const a0 = ac - half, a1 = ac + half;
  const rIn = Mr + 0.0084, rOut = R - 0.013;
  const hTop = T + 0.0056 + rng.range(-0.0003, 0.0003);
  // przybudówka sterowni (ściana ku hali schowana w hali)
  const aI = 0.6 * DEG;
  arcBlock(Mr + 0.0064, rIn + 0.0002, a0 + aI, a1 - aI, [
    { v: T, side: hull }, { v: T + 0.0010, side: hull }, { v: T + 0.0010, d: 0.00025, side: (f) => (f === 'out' ? null : win) },
    { v: T + 0.0019, d: 0.00025, side: hull }, { v: T + 0.0019, side: hull }, { v: T + 0.0029, d: 0 }, { v: T + 0.0031, d: 0.0003 }
  ], { side: (f) => (f === 'out' ? null : hull), top: hull }, 8, 0.88);
  // hala główna: pas okien tylko na zewnątrz i na czołach (od osi zasłania go przybudówka)
  const low = (A) => (f) => (f === 'in' ? null : A);
  arcBlock(rIn, rOut, a0, a1, [
    { v: T, side: low(hull) }, { v: T + 0.0008, side: low(hull) }, { v: T + 0.0008, d: 0.0003, side: low(win) },
    { v: T + 0.0018, d: 0.0003, side: low(hull) }, { v: T + 0.0018, side: hull }, { v: hTop - 0.0004, side: hull },
    { v: hTop - 0.0004, d: -0.0002, side: hull }, { v: hTop, d: -0.0002 }
  ], hull, 8, 0.88);
  // pilastry na ścianie od placu (dzielą pas okien na wnęki)
  const nP = Math.max(3, Math.round((2 * half * rOut) / 0.0046));
  for (let k = 0; k <= nP; k++) {
    const F = radialFrame(lerp(a0 + 0.4 * DEG, a1 - 0.4 * DEG, k / nP), 0, 0);
    box(F, 0, rOut + 0.00016, 0.00032, 0.00018, T, hTop - 0.0004, hull);
  }
  // świetlik: ciemne szkło na długich bokach, okap; u podstawy cienkie chłodne listwy (z góry — łuki pierścieni)
  const m0 = rIn + 0.0036, m1 = rOut - 0.0036, aM = 1.1 * DEG;
  arcBlock(m0, m1, a0 + aM, a1 - aM, [
    { v: hTop - 0.0001, side: hull }, { v: hTop + 0.0002, side: (f) => (f === 'end' ? hull : M.acc(PART.GLASS, seed)) },
    { v: hTop + 0.0009, side: hull }, { v: hTop + 0.0009, d: -0.00025, side: hull }, { v: hTop + 0.0011, d: -0.00025 }
  ], hull, 8);
  const strip = M.acc(PART.STRIP, 0.4);
  for (const r of [m0 - 0.0005, m1 + 0.0005]) {
    arcBlock(r - 0.00008, r + 0.00008, a0 + aM, a1 - aM, [{ v: hTop - 0.0001 }, { v: hTop + 0.00012 }], { side: (f) => (f === 'end' ? null : strip), top: strip }, 8, 0.35, 1);
  }
  // bloki wentylacji na dachu (między świetlikiem a okapem, od strony placu)
  for (const f of [-0.62, 0.05, 0.6]) {
    const F = radialFrame(ac + f * half + rng.range(-0.6, 0.6) * DEG, 0, 0);
    box(F, 0, (m1 + rOut) / 2, 0.0011 + rng.range(0, 0.0004), 0.0007, hTop, hTop + 0.0006, hull, 0, 0, 0.00015);
  }
  // HALA TURBIN od placu (dawny otwarty plac generatorów pod suwnicą czytał się z bliska jak pole kiwonów): niższa
  // dobudówka na całej długości hali (ściana ku osi schowana w hali głównej), na jednym końcu para kominów na cokole
  const rA = R - 0.0058;
  const hA = 0.0036 + rng.range(-0.0002, 0.0002);
  const e0 = a0 + 0.5 * DEG, e1 = a1 - 0.5 * DEG;
  hallBlock(ctx, rOut - 0.0003, rA, e0, e1, T, hA, seed, true);
  const aS = i % 2 ? e1 - 2.2 * DEG : e0 + 2.2 * DEG;
  stackPair(ctx, radialFrame(aS, 0, 0), 0, (rOut + rA) / 2, T + hA, 0.0092 + rng.range(-0.0005, 0.0005), 0.0011, seed);
  // odgałęzienia estakady (wspólny pierścień od osi) nad przybudówką do ściany hali
  const yE = T + 0.0046;
  for (const f of [-0.5, 0.5]) {
    const Fb = radialFrame(ac + f * half, 0, 0);
    for (const o of [-0.0005, 0.0005]) cylinder(st, Fb.at(o, yE, Mr + 0.0038), Fb.at(o, yE, rIn + 0.0003), 0.00036, 0.00036, 6, false);
    box(Fb, 0, Mr + 0.0074, 0.0009, 0.00018, T + 0.0031, yE - 0.0003, st);
  }
}

/** Rozdzielnia nad bramą mostu: dwa rzędy izolatorów z akcentami COIL po bokach grobli przewodów, budynek łączy. */
function buildSwitchyard(ctx, az, rc, i) {
  const { L, M } = ctx;
  const T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const hull = M.acc(PART.HULL, 0.66);
  for (const u of [-0.0064, 0.0064]) {
    for (let k = 0; k < 4; k++) {
      const w = rc - 0.0085 + k * 0.0042;
      box(F, u, w, 0.0013, 0.0013, T, T + 0.0018, hull, 0, 0, 0.0003);
      box(F, u, w, 0.0003, 0.0003, T + 0.0018, T + 0.0040, M.acc(PART.STRUCT, 0.66));
      box(F, u, w, 0.0009, 0.0002, T + 0.0040, T + 0.0044, M.acc(PART.COIL, 0.66), (k * 0.25 + (u > 0 ? 0.12 : 0)) % 1, 0.3);
    }
  }
  bandBlock(F, 0.0062, rc + 0.0088, 0.0019, 0.0026, T, T + 0.0036, hull, M.acc(PART.WINDOW, 0.66));
}

/**
 * Arkologia: wieża z gęstymi rzędami okien (rytm kondygnacji okien MAT ~0,0005 R → setki pięter: skala setek km) na
 * podium, trzy trzony z uskokami (narożne pilastry, pasy kondygnacji technicznych co 0,0048 R, gzymsy, cienkie
 * listwy na uskokach), korona i antena z piętrami świateł.
 */
function buildArcology(ctx, az, rc, k) {
  const { L, M, rng } = ctx;
  const T = L.corkTopH;
  const F = radialFrame(az, 0, 0);
  const seed = (k * 0.29 + 0.13) % 1;
  const hull = M.acc(PART.HULL, seed);
  const win = M.acc(PART.WINDOW, seed);
  const H = L.corkArcoH * (1 + rng.range(-0.07, 0.07));
  const cw = rc + 0.001;
  const y0 = T + 0.0032;
  // podium z pasem okien we wnęce
  const pu = 0.0068, pw = 0.0094, dP = 0.0003;
  prism(F, rect(0, cw, pu, pw), [
    { v: T, side: hull }, { v: T + 0.0010, side: hull }, { v: T + 0.0010, s: [1 - dP / pu, 1 - dP / pw], side: win },
    { v: T + 0.0022, s: [1 - dP / pu, 1 - dP / pw], side: hull }, { v: T + 0.0022, side: hull }, { v: y0 - 0.0003, side: hull },
    { v: y0, s: [1 - 0.0003 / pu, 1 - 0.0003 / pw] }
  ], { side: hull, top: hull, bottom: null }, 0.88);
  const shafts = [
    { y1: y0 + H * 0.40, hu: 0.0054, hw: 0.0074 },
    { y1: y0 + H * 0.70, hu: 0.0044, hw: 0.0060 },
    { y1: y0 + H * 0.88, hu: 0.0034, hw: 0.0046 }
  ];
  let y = y0;
  shafts.forEach((s, j) => {
    box(F, 0, cw, s.hu, s.hw, y, s.y1, { side: win, top: hull, bottom: null }, 0.9);
    for (const su of [-1, 1]) for (const sw of [-1, 1]) box(F, su * s.hu, cw + sw * s.hw, 0.00045, 0.00045, y, s.y1 + 0.0004, hull, 0, 0, 0.00015);
    for (let v = y + 0.0048; v < s.y1 - 0.0016; v += 0.0048) box(F, 0, cw, s.hu + 0.0002, s.hw + 0.0002, v - 0.00035, v + 0.00035, hull);
    box(F, 0, cw, s.hu + 0.00025, s.hw + 0.00025, s.y1 - 0.0004, s.y1 + 0.0002, hull, 0, 0, 0.0001);
    const nx = shafts[j + 1];
    if (nx) box(F, 0, cw, nx.hu + 0.0003, nx.hw + 0.0003, s.y1 + 0.0002, s.y1 + 0.0005, M.acc(PART.STRIP, seed), 0.4, j % 2);
    y = s.y1;
  });
  // korona: ścięty ostrosłup, czerwone światła na narożach, pełna iglica z kondygnacjami świateł i białym światłem
  const top = y0 + H;
  prism(F, rect(0, cw, 0.0030, 0.0040), [{ v: y + 0.0002 }, { v: y + (top - y) * 0.6, s: 0.72 }, { v: top, s: 0.32 }], hull);
  for (const su of [-1, 1]) for (const sw of [-1, 1]) box(F, su * 0.0030, cw + sw * 0.0040, 0.0003, 0.0003, y + 0.0002, y + 0.0008, lampAcc(M, (seed + su * 0.13 + sw * 0.07 + 1) % 1), 0.45, 0);
  heavyPylon(M, F, 0, cw, top - 0.0004, 0.0065, 0.00068, 0.00032, 3, seed, { spire: 0.004 });
}

/**
 * Grobla energii (azymuty mostów): od podstawy zigguratu przez taras środkowy i pokład górny do bramy mostu — niski
 * nasyp z dwoma przewodami (PIPE: uv.y 0 akcelerator → 1 brama), schodzi uskokami tarasów. Z góry: 6 szprych koła.
 */
function buildCauseway(ctx, phi, idx) {
  const { L, M } = ctx;
  const F = radialFrame(phi, 0, 0);
  const R = L.corkR, T = L.corkTopH, Mr = L.corkMidR, Mh = L.corkMidH, Ir = L.corkInnerR, Ih = L.corkInnerH;
  const hull = M.acc(PART.HULL, 0.71);
  const hc = 0.0031, hh = 0.0011;
  // nasyp na każdym tarasie (ze ścięciem krawędzi) i port wyjścia z zigguratu
  box(F, 0, (Ir - 0.0042 + Ir) / 2, hc, 0.0021, Ih, Ih + hh, hull, 0, 0, 0.0003);
  box(F, 0, (Ir + Mr) / 2, hc, (Mr - Ir) / 2 - 0.0016, Mh, Mh + hh, hull, 0, 0, 0.0003);
  box(F, 0, (Mr + R - 0.003) / 2, hc, (R - 0.003 - Mr) / 2 - 0.0016, T, T + hh, hull, 0, 0, 0.0003);
  box(F, 0, Ir - 0.0047, hc + 0.0006, 0.0012, Ih, Ih + 0.0032, hull, 0, 0, 0.0004);
  // cienkie chłodne listwy wzdłuż nasypu (pod progiem) — szprychy czytelne z daleka
  for (const s of [-1, 1]) {
    box(F, s * (hc + 0.00015), (Ir + Mr) / 2, 0.00015, (Mr - Ir) / 2 - 0.002, Mh, Mh + 0.0004, M.acc(PART.STRIP, 0.71), 0.35, 1);
    box(F, s * (hc + 0.00015), (Mr + R - 0.003) / 2, 0.00015, (R - 0.003 - Mr) / 2 - 0.002, T, T + 0.0004, M.acc(PART.STRIP, 0.71), 0.35, 1);
  }
  // przewody: port → stopnie tarasów → dyspozytornia bramy
  const pr = 0.0006;
  const lift = hh + pr;
  for (const o of [-0.0014, 0.0014]) {
    const pts = [
      F.at(o, Ih + lift, Ir - 0.0045), F.at(o, Ih + lift, Ir - 0.0006), F.at(o, Mh + lift + 0.0016, Ir + 0.0022),
      F.at(o, Mh + lift, Ir + 0.006), F.at(o, Mh + lift, (Ir + Mr) / 2), F.at(o, Mh + lift, Mr - 0.0045),
      F.at(o, Mh + lift - 0.0006, Mr - 0.0004), F.at(o, T + lift + 0.0012, Mr + 0.0026), F.at(o, T + lift, Mr + 0.007),
      F.at(o, T + lift, (Mr + R) / 2), F.at(o, T + lift, R - 0.006), F.at(o, T + lift + 0.0016, R + 0.0002), F.at(o, T + 0.0028, R + 0.003)
    ];
    pipe(M, pts, pr, (idx * 0.19 + (o > 0 ? 0.5 : 0)) % 1);
  }
}

// ── Maszyny: baterie zbiorników, stopniowe bloki, estakady rur ─────────────────────────────────────────────────────
/**
 * BATERIA ZBIORNIKÓW w prostokącie (cu ± hu, cw ± hw) ramy F na wysokości y — sylwetka elewatora / rafinerii w skali
 * kilometrów (farmy drobnych zbiorników z kopułami, a potem bateria pod suwnicą bramową czytały się przy korku 830 km
 * jak cysterny i dźwig): taca z grubym obwałowaniem, ciasny szyk wysokich walców jednej wysokości (powłoka ze stali
 * żebrowanej jak chłodnie, żebro w połowie, wieniec dachowy — na części cienka ciepła listwa — płaski dach), nad
 * każdym rzędem GALERIA przenośnika z pasem okien, a na końcu `side` (±1 wzdłuż W) WIEŻA ZAŁADOWCZA na dachach
 * zbiorników z pasem okien i czerwonymi światłami na narożach.
 */
function tankBattery(ctx, F, cu, cw, hu, hw, y, seed, side = 1) {
  const { M } = ctx;
  const rng = plantRng(Math.floor(seed * 1e6) + 5);
  const hull = M.acc(PART.HULL, seed);
  const st = M.acc(PART.STRUCT, seed);
  const strip = M.acc(PART.STRIP, seed);
  const win = M.acc(PART.WINDOW, seed);
  // taca: obwałowanie z fazą
  const bw = 0.00035, bh = 0.0008;
  for (const s of [-1, 1]) {
    box(F, cu + s * hu, cw, bw, hw + bw, y, y + bh, hull, 0, 0, 0.00012);
    box(F, cu, cw + s * hw, hu - bw, bw, y, y + bh, hull, 0, 0, 0.00012);
  }
  const nU = Math.max(2, Math.round((2 * hu) / 0.006)), nW = Math.max(2, Math.round((2 * hw) / 0.006));
  const pu = (2 * hu) / nU, pw = (2 * hw) / nW;
  const r = Math.min(pu, pw) * 0.5 - 0.00014;
  const ht = rng.range(0.0050, 0.0056);
  const yt = y + ht, yb = y + ht * 0.5, e = 0.00015;
  const prof = [
    [r, y], [r, yb - 0.00025], [r + e, yb - 0.00025], [r + e, yb + 0.00025], [r, yb + 0.00025],
    [r, yt - 0.0005], [r + e, yt - 0.0005], [r + e, yt], [r * 0.82, yt], [0, yt + r * 0.05]
  ];
  const sh = { acc: hull, smooth: true }, ss = { acc: st, smooth: true };
  for (let iu = 0; iu < nU; iu++) {
    const u = cu - hu + pu * (iu + 0.5);
    for (let iw = 0; iw < nW; iw++) {
      const w = cw - hw + pw * (iw + 0.5);
      const c = F.at(u, 0, w);
      const crown = (iu + iw) % 3 === 0 ? { acc: strip, z: 0.32, w: 0, smooth: true } : sh;
      lathe(prof, [ss, sh, sh, sh, ss, sh, crown, sh, sh], 10, { cx: c.x, cz: c.z });
    }
    // galeria przenośnika nad rzędem (od wieży załadowczej przez całą długość)
    bandBlock(F, u, cw, 0.0007, hw - 0.0004, yt + 0.00005, yt + 0.0014, hull, win);
  }
  // wieża załadowcza na końcu baterii (na dachach skrajnego rzędu), spina galerie
  const wH = cw + side * (hw - pw * 0.5);
  const yH = yt + 0.0014 + rng.range(0.0018, 0.0024);
  bandBlock(F, cu, wH, hu - 0.0006, 0.0014, yt + 0.00005, yH, hull, win);
  for (const s of [-1, 1]) {
    box(F, cu + s * (hu - 0.0011), wH + s * side * 0.0009, 0.00022, 0.00022, yH - 0.0002, yH + 0.0002, lampAcc(M, (seed * 5.1 + (s > 0 ? 0.5 : 0)) % 1), 0.55, 0);
  }
}

/**
 * Most rurowy: dwie rury od A do B (rama elektrowni, poziomo) na wysokości yp, piony z pokładu (y) przy A, portal
 * w połowie — spina maszyny tarasu w kompleks.
 */
function pipeBridge(M, A, B, y, yp, seed) {
  const st = M.acc(PART.STRUCT, seed);
  const d = new V3(B.x - A.x, 0, B.z - A.z).normalize();
  const s = new V3(-d.z, 0, d.x);
  const at = (P, o, h) => new V3(P.x, h, P.z).addScaledVector(s, o);
  for (const o of [-0.0006, 0.0006]) {
    cylinder(st, at(A, o, y), at(A, o, yp), 0.00035, 0.00035, 6, false);
    cylinder(st, at(A, o, yp), at(B, o, yp), 0.00035, 0.00035, 6, false);
  }
  const m = new V3((A.x + B.x) / 2, 0, (A.z + B.z) / 2);
  for (const o of [-0.0012, 0.0012]) beam(st, at(m, o, y), at(m, o, yp - 0.0004), 0.00018);
  box(frame(m, s, UP.clone(), d), 0, 0, 0.0014, 0.0002, yp - 0.0007, yp - 0.0003, st);
}

/**
 * Stopniowy blok w prostokącie (cu ± hu, cw ± hw): 3 kondygnacje z uskokami po 0,0012 R, w dolnych `winTiers`
 * wnęka pasa okien (ciągły pas), na uskokach cienkie listwy; na dachu wentylatory z żarem albo (`coils`) izolatory
 * z akcentami COIL (blok transformatorów), światło pozycyjne na narożu.
 */
function steppedBlock(ctx, F, cu, cw, hu, hw, y, seed, coils = false, winTiers = 3) {
  const { M } = ctx;
  const rng = plantRng(Math.floor(seed * 1e6) + 9);
  const hull = M.acc(PART.HULL, seed);
  const win = M.acc(PART.WINDOW, seed);
  const st = M.acc(PART.STRUCT, seed);
  let su = hu, sw = hw, v = y;
  const hs = [0.0034, 0.0027, 0.0021];
  for (let t = 0; t < 3; t++) {
    const h = hs[t] * rng.range(0.9, 1.1);
    const d = 0.00022, ch = 0.00025;
    const sIn = [(su - d) / su, (sw - d) / sw];
    const b0 = v + h * 0.3, b1 = b0 + Math.min(0.0011, h * 0.38);
    prism(F, rect(cu, cw, su, sw), t < winTiers ? [
      { v, side: hull }, { v: b0, side: hull }, { v: b0, s: sIn, side: win }, { v: b1, s: sIn, side: hull },
      { v: b1, side: hull }, { v: v + h - ch, side: hull }, { v: v + h, s: [1 - ch / su, 1 - ch / sw] }
    ] : [{ v, side: hull }, { v: v + h - ch, side: hull }, { v: v + h, s: [1 - ch / su, 1 - ch / sw] }],
    { side: hull, top: hull, bottom: null }, 0.88);
    const nu = su - 0.0012, nw = sw - 0.0012;
    if (t < 2) box(F, cu, cw, nu + 0.0002, nw + 0.0002, v + h, v + h + 0.00025, M.acc(PART.STRIP, seed), 0.34, t % 2);
    v += h; su = nu; sw = nw;
  }
  if (coils) {
    for (let k = -1; k <= 1; k++) {
      box(F, cu + k * su * 0.55, cw, 0.0003, sw * 0.7, v, v + 0.0012, st);
      box(F, cu + k * su * 0.55, cw, 0.00045, sw * 0.62, v + 0.0012, v + 0.0015, M.acc(PART.COIL, seed), rng.next(), 0.14);
    }
  } else {
    const hot = M.acc(PART.HOT, seed);
    for (const k of [-1, 1]) {
      const c = F.at(cu + k * su * 0.45, 0, cw);
      const fr = Math.min(su, sw) * 0.36;
      lathe([[fr, v], [fr, v + 0.0005], [fr * 0.86, v + 0.0005], [fr * 0.86, v + 0.0003], [0, v + 0.0003]],
        [{ acc: hull }, { acc: hull }, { acc: hull }, { acc: hot, z: 0.3 }, null], 16, { cx: c.x, cz: c.z });
    }
  }
  box(F, cu + su * 0.8, cw + sw * 0.8, 0.0003, 0.0003, v, v + 0.0007, lampAcc(M, seed), 0.6, rng.chance(0.25) ? 1 : 0);
}

/**
 * Estakada rur: pierścień portali (`portals` na obwód, bez portali nad groblami — tam rury przechodzą przęsłem) i trzech
 * rur procesowych na promieniu rr (taras środkowy; pokład górny — nad drogą obwodową, z odgałęzieniami do maszynowni).
 */
function buildPipeRack(ctx, rr, y, { portals = 60, seed = 0.52, segs = 112 } = {}) {
  const { M } = ctx;
  const st = M.acc(PART.STRUCT, seed);
  const hP = 0.0042;
  const nP = portals;
  for (let k = 0; k < nP; k++) {
    const a = ctx.az0 + ((k + 0.5) / nP) * TAU;
    if (ctx.bridgeAz.some((q) => Math.abs(angDiff(a, q)) * rr < 0.0065)) continue;
    const F = radialFrame(a, 0, 0);
    for (const s of [-1, 1]) beam(st, F.at(0, y, rr + s * 0.0017), F.at(0, y + hP, rr + s * 0.0017), 0.00022);
    box(F, 0, rr, 0.00025, 0.0021, y + hP - 0.0004, y + hP, st);
    if (k % 6 === 3) box(F, 0, rr + 0.0019, 0.00028, 0.00028, y + hP, y + hP + 0.0005, lampAcc(M, (k * 0.07) % 1), 0.5, 0);
  }
  [-0.0011, 0, 0.0011].forEach((o, j) => torus(M.acc(PART.STRUCT, (seed + j * 0.12) % 1), rr + o, y + hP + 0.00042, 0.00042, segs, 6));
}

// ── Taras środkowy: chłodnie, maszyny, estakada, anteny, bramy kolektorów ──────────────────────────────────────────
function buildMidTerrace(ctx) {
  const { L, M, rng } = ctx;
  const y = L.corkMidH;
  // chłodnie: w środkach sektorów (między groblami)
  for (let i = 0; i < L.corkTowers; i++) {
    const az = ctx.az0 + ((i + 0.5) / L.corkTowers) * TAU;
    buildTower(ctx, polar(L.corkTowerRing, az, y), i, rng);
  }
  // między chłodnią a groblami: bateria zbiorników pod suwnicą (przed środkiem sektora) i blok transformatorów (za
  // nim), oba spięte z chłodnią mostami rurowymi (jeden kompleks); przed chłodnią (od strony osi) — POMPOWNIA wzdłuż
  // obwodu z mostem rurowym do chłodni (dawna kratownicowa antena czytała się jak maszt radiowy)
  const off = 19 * DEG;
  const wM = 0.0735, hu = 0.0056;
  ctx.sectorAz.forEach((c, s) => {
    const Ft = radialFrame(c - off, 0, 0), Fs = radialFrame(c + off, 0, 0);
    tankBattery(ctx, Ft, 0, wM, hu, 0.0102, y, (s * 0.19 + 0.11) % 1, 1);
    steppedBlock(ctx, Fs, 0, wM, hu, 0.0098, y, (s * 0.23 + 0.47) % 1, true, 1);
    const Ct = polar(L.corkTowerRing, c, y);
    for (const A of [Ft.at(hu + 0.0006, y, wM - 0.0024), Fs.at(-hu - 0.0006, y, wM - 0.0024)]) {
      const d = new V3(Ct.x - A.x, 0, Ct.z - A.z).normalize();
      pipeBridge(M, A, Ct.clone().addScaledVector(d, -(L.corkTowerR - 0.0006)), y, y + 0.0052, (s * 0.29 + 0.07) % 1);
    }
    const sp = (s * 0.31 + 0.2) % 1;
    const pr1 = 0.0566;
    hallBlock(ctx, 0.0501, pr1, c - 4.6 * DEG, c + 4.6 * DEG, y, 0.0031 + rng.range(-0.0002, 0.0002), sp);
    pipeBridge(M, polar(pr1 + 0.0009, c, y), polar(L.corkTowerRing - L.corkTowerR + 0.0006, c, y), y, y + 0.0042, sp);
  });
  ctx.bridgeAz.forEach((az, i) => buildCollector(ctx, az, i));
  buildPipeRack(ctx, 0.0905, y);
  // drogi obwodowe tarasu (cienkie listwy: ciepła przy osi, chłodna na skraju)
  stripRing(M, L.corkInnerR + 0.003, y, 0.00022, 0.35, 0, 96);
  stripRing(M, L.corkMidR - 0.003, y, 0.00022, 0.35, 1, 144);
}

/**
 * Chłodnia hiperboloidalna w języku megastruktury: powłoka ze stali żebrowanej (w środku żar rosnący ku dnu), 12 żeber
 * zewnętrznych, 2 wieńce, korona z cienką ciepłą listwą i czerwonymi światłami, nogi V, stopa-taca z basenem żaru.
 * Bez ścian współpłaszczyznowych (powłoka kończy się pod koroną, basen nad tacą).
 */
function buildTower(ctx, c, i, rng) {
  const { L, M } = ctx;
  const H = L.corkTowerH * (1 + rng.range(-0.06, 0.06));
  const r0 = L.corkTowerR, rt = r0 * 0.68, ht = 0.74 * H;
  const cc = ht / Math.sqrt((r0 / rt) ** 2 - 1);
  const rOut = (h) => rt * Math.sqrt(1 + ((h - ht) / cc) ** 2);
  const th = 0.0007, hb = 0.0034;
  const seed = (i * 0.137 + 0.06) % 1;
  const st = M.acc(PART.STRUCT, seed);
  const hull = M.acc(PART.HULL, seed);
  const hot = M.acc(PART.HOT, seed);
  const opts = { cx: c.x, cy: c.y, cz: c.z };
  const n = 10, N = 32;
  const hTop = H - 0.0012;
  const hAt = (k) => hb + ((hTop - hb) * k) / n;
  const prof = [], segs = [];
  for (let k = 0; k <= n; k++) { prof.push([rOut(hAt(k)), hAt(k)]); segs.push({ acc: st, smooth: true }); }
  segs[n] = { acc: hull };
  const heat = (r, yy) => 0.04 + 0.26 * clamp01(1 - (yy - hb) / (hTop - hb));
  for (let k = n; k >= 0; k--) { prof.push([rOut(hAt(k)) - th, hAt(k)]); segs.push(k > 0 ? { acc: hot, smooth: true, z: heat } : null); }
  lathe(prof, segs, N, opts);
  // korona: wieniec obejmujący krawędź powłoki, cienka ciepła listwa, czerwone światła
  const rC = rOut(H);
  lathe([[rC + 0.0007, H - 0.0022], [rC + 0.0007, H - 0.0010], [rC + 0.0007, H - 0.0006], [rC + 0.0007, H + 0.0002],
    [rC - th - 0.0003, H + 0.0002], [rC - th - 0.0003, H - 0.0016], [rC + 0.0007, H - 0.0022]],
  [{ acc: hull, smooth: true }, { acc: M.acc(PART.STRIP, 0.5), z: 0.42, w: 0, smooth: true }, { acc: hull, smooth: true }, { acc: hull },
    { acc: hull, smooth: true }, { acc: hull }, null], N, opts);
  for (let k = 0; k < 4; k++) {
    const a = ((k + 0.25) / 4) * TAU;
    const p = new V3(c.x + Math.cos(a) * (rC + 0.0002), 0, c.z - Math.sin(a) * (rC + 0.0002));
    box(frame(p, tanAz(a), UP.clone(), dirAz(a)), 0, 0, 0.0003, 0.0003, c.y + H + 0.0002, c.y + H + 0.0008, lampAcc(M, (seed + k * 0.25) % 1), 0.4, 0);
  }
  // wieńce na powłoce
  for (const f of [0.3, 0.6]) {
    const h = f * H, rr = rOut(h);
    lathe([[rr - 0.0002, h - 0.0005], [rr + 0.0008, h - 0.0004], [rr + 0.0008, h + 0.0004], [rr - 0.0002, h + 0.0005]],
      [{ acc: hull }, { acc: hull, smooth: true }, { acc: hull }, null], N, opts);
  }
  // żebra zewnętrzne wzdłuż profilu
  const nR = 8;
  for (let k = 0; k < nR; k++) {
    const a = ((k + 0.5) / nR) * TAU;
    const dir = dirAz(a);
    const pts = [];
    for (let j = 0; j <= 6; j++) {
      const h = hb + 0.0004 + ((H - 0.0024 - hb - 0.0004) * j) / 6;
      pts.push(new V3(c.x, c.y + h, c.z).addScaledVector(dir, rOut(h) + 0.0002));
    }
    sweep(pts, 0.00026, 0.00034, dir, () => hull, 0, 0, true);
  }
  // nogi V pod powłoką
  const nl = 12;
  for (let k = 0; k < nl; k++) {
    const a = (k / nl) * TAU;
    const top = new V3(c.x + Math.cos(a) * (rOut(hb) - th * 0.5), c.y + hb, c.z - Math.sin(a) * (rOut(hb) - th * 0.5));
    for (const s of [-1, 1]) {
      const a2 = a + s * (Math.PI / nl);
      beam(st, new V3(c.x + Math.cos(a2) * r0, c.y + 0.0005, c.z - Math.sin(a2) * r0), top, 0.0003);
    }
  }
  // stopa-taca: obrzeże i basen żaru (0,0003 nad pokładem)
  lathe([[r0 + 0.0012, 0], [r0 + 0.0012, 0.0006], [r0 - 0.0016, 0.0006], [r0 - 0.0016, 0.0003], [0, 0.0003]],
    [{ acc: hull, smooth: true }, { acc: hull }, { acc: hull, smooth: true }, { acc: hot, z: 0.3, smooth: true }, null], N, opts);
}

/**
 * Pylon kolektora przy grobli akceleratora (jeden na groblę, zawsze po tej samej stronie — symetria 6-krotna): pełny
 * ciężki pylon z kondygnacjami chłodnych świateł (`heavyPylon`, lekko pochylony ku grobli), na szczycie głowica
 * z tarczą kolektora COIL zwróconą ku osi i iglica z białym światłem — pionowe akcenty wokół akceleratora. Szczyt
 * ~corkCollectorH, r ≥ 0,049 — pod pierścieniami zamknięcia promienia.
 */
function buildCollector(ctx, phi, i) {
  const { L, M } = ctx;
  const F = radialFrame(phi, 0, 0);
  const y0 = L.corkMidH, top = L.corkCollectorH;
  const wc = 0.0515;
  const seed = (i * 0.11 + 0.33) % 1;
  const hull = M.acc(PART.HULL, seed);
  const hM = top - y0 - 0.0042;
  const u0 = 0.0068, u1 = 0.0054;
  box(F, u0, wc, 0.0022, 0.0022, y0, y0 + 0.0012, hull, 0, 0, 0.0003);
  heavyPylon(M, F, u0, wc, y0 + 0.0012, hM, 0.0015, 0.0007, 6, seed, { cu1: u1, cool: 1 });
  const yh = y0 + 0.0012 + hM;
  box(F, u1, wc, 0.0011, 0.0013, yh - 0.0004, yh + 0.0024, hull, 0, 0, 0.0002);
  cylinder(M.acc(PART.COIL, seed), F.at(u1, yh + 0.0010, wc - 0.0013), F.at(u1, yh + 0.0010, wc - 0.0018), 0.0009, 0.0009, 14, true, (i * 0.17) % 1, 0.55);
  heavyPylon(M, F, u1, wc, yh + 0.0024, 0.0016, 0.00045, 0.0003, 1, seed, { spire: 0.002 });
}

// ── Akcelerator: pierścienie COIL na stopniach zigguratu, obejmy, emitery-zęby ─────────────────────────────────────
function buildAccelerator(ctx) {
  const { L, M, geo } = ctx;
  const hull = M.acc(PART.HULL, 0.97);
  const rt = 0.00095;
  geo.treads.forEach((t, k) => {
    // pierścień: rura COIL (faza rośnie ku górze — impuls wędruje do wylotu), obudowa pod spodem
    torus(M.acc(PART.COIL, 0.1 + k * 0.2), t.r, t.y + rt * 1.05, rt, 96, 8, {}, k * 0.18, 0.26 + k * 0.03);
    lathe([[t.r + rt * 1.4, t.y], [t.r + rt * 1.4, t.y + rt * 0.7], [t.r - rt * 1.4, t.y + rt * 0.7], [t.r - rt * 1.4, t.y]],
      [{ acc: hull }, { acc: hull }, { acc: hull }], 72);
    // obejmy co 15° (przesunięte per pierścień — rytm schodkowy)
    const nC = 24;
    for (let j = 0; j < nC; j++) {
      const az = ((j + k * 0.25) / nC) * TAU;
      const F = radialFrame(az, 0, 0);
      prism(F, [[-0.00055, t.r - rt * 1.55], [0.00055, t.r - rt * 1.55], [0.00055, t.r + rt * 1.55], [-0.00055, t.r + rt * 1.55]],
        [{ v: t.y }, { v: t.y + rt * 2.2 }, { v: t.y + rt * 2.6, s: [1, 0.7] }], hull);
    }
  });
  for (let i = 0; i < 6; i++) buildTooth(ctx, (L.corkToothAz + i * 60) * DEG, i);
}

/**
 * Emiter-ząb nad wylotem: cokół na wardze krateru, smukły rdzeń z ciemnej stali wygięty ku osi (ściana ku osi — pas
 * COIL, impuls w górę), pancerne segmenty bez ściany ku osi (cyjanowy pas w kanale między burtami), jarzma na stykach
 * segmentów, czubek COIL.
 */
function buildTooth(ctx, az, i) {
  const { L, M } = ctx;
  const Cr = L.corkCraterR, Ah = L.apertureH;
  const F = radialFrame(az, 0, 0);
  const toAxis = F.W.clone().negate();
  const hull = M.acc(PART.HULL, 0.97);
  const st = M.acc(PART.STRUCT, 0.97);
  prism(F, rect(0, Cr + 0.0023, 0.0024, 0.0027), [{ v: Ah - 0.0025 }, { v: Ah + 0.0020 }, { v: Ah + 0.0028, s: [0.8, 0.8] }], hull);
  const P0 = new V3(0, Ah + 0.0024, Cr + 0.0023), P1 = new V3(0, lerp(Ah, L.corkToothH, 0.62), Cr + 0.0042);
  const P2 = new V3(0, L.corkToothH, L.corkToothTipR);
  const m = 24;
  const pts = [], hw = [], hh = [], zs = [];
  for (let j = 0; j <= m; j++) {
    const t = j / m, s = 1 - t;
    const q = new V3().addScaledVector(P0, s * s).addScaledVector(P1, 2 * s * t).addScaledVector(P2, t * t);
    pts.push(F.at(0, q.y, q.z));
    hw.push(lerp(0.0016, 0.00055, t));
    hh.push(lerp(0.0012, 0.00045, t));
    zs.push(t * 0.85);
  }
  const coil = M.acc(PART.COIL, 0.4 + i * 0.09);
  sweep(pts, hw, hh, toAxis, (f) => (f === 'top' ? coil : st), (f, j) => (f === 'top' ? zs[j] : 0), (f) => (f === 'top' ? 0.45 : 0));
  // pancerne segmenty (burty, grzbiet, denka)
  for (let s = 0; s < 6; s++) {
    const j0 = 1 + s * 4, j1 = Math.min(m - 1, j0 + 3);
    const range = (a) => a.slice(j0, j1 + 1);
    sweep(range(pts), range(hw).map((x) => x * 1.2 + 0.00012), range(hh).map((x) => x * 1.16 + 0.0001), toAxis, (f) => (f === 'top' ? null : hull), 0, 0, true);
  }
  // jarzma na stykach segmentów (pełny obwód)
  for (const j of [8, 16]) {
    const d = new V3().subVectors(pts[j + 1], pts[j - 1]).normalize();
    sweep([pts[j].clone().addScaledVector(d, -0.0005), pts[j].clone().addScaledVector(d, 0.0005)], hw[j] * 1.45 + 0.0002, hh[j] * 1.4 + 0.0002, toAxis, () => hull, 0, 0, true);
  }
  // czubek: kostka COIL na końcu
  const tip = pts[m].clone().addScaledVector(new V3().subVectors(pts[m], pts[m - 1]).normalize(), 0.0006);
  box(frame(tip, F.U, UP.clone(), F.W), 0, 0, 0.0008, 0.0008, -0.0008, 0.0008, M.acc(PART.COIL, 0.95), 0.9, 1.2);
}
