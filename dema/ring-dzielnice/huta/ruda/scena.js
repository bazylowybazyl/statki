// HUTA — fizyczna ruda: BRYŁY STAŁE STANOWISKA (dane instancji zestawu budowli portowych, bez three).
//
// Trzy budowle w układzie stanowiska (x od osi toru, z jak w dzielnicy huty, y = wysokość K-7):
//   • `buildOreYardScene`  — zasiek z murami, nabrzeże, stacja dmuchawy z cyklonem, kanał zrzutowy w klatce i wylot
//     z klapą (grupa ruchoma), zasuwy w dnie (grupy), koryto taśmy pod kratą, pochylnia do galerii pieca;
//   • `buildOrePierScene`  — pirs z rurą ssącą (odcinki oszklone = klatki z obręczy, w których widać ziarna);
//   • `buildOreVacScene`   — odkurzacz (zestaw FG, nad statkiem): suwnica, wózek, wąż teleskopowy, dzwon-klatka
//     i zrębnica ładowni jadąca ze statkiem (grupy ruchome; macierze ustawia strona ze stanu symulacji).
// Geometria z `geometria.js` (te same liczby co symulacja). To tło dla ziaren — ruda, podkład stosu i taśma są
// w `obraz.js`.
import { PB_FX, PB_MAT, PB_MAX_GROUPS, k7HeightToZ, newScene, sceneOf, xzTools } from '../../kit/sceny.js';

const M = PB_MAT;
const FLOOR = 18;               // nabrzeże
const KEEL = -230;              // spód korpusów
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const addLamp = (lamps, x, z, y, kind = 1) => { if (lamps.length < 8) lamps.push([x, k7HeightToZ(y), z, kind]); };
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const HOSE_R = 13;              // wąż ssawy w rysunku (cieńszy niż gardziel z kołnierzem — z góry widać klatkę dzwonu i ziarna w niej)

// STREFA ŁADOWNI: ładownia sięga od 50 j. pod pokładem (dno) do 50 j. nad nim (zrębnica), a zestaw portowy ściska
// wysokości nad pokładem × 0,42 — lej pod dzwonem byłby spłaszczony. Ziarna ładowni (`obraz.js`), zrębnica i dzwon
// rysują się więc 1:1 względem pokładu. `holdZone(f, base, fn)`: bryły zapisane w `fn` dostają wysokość y − base bez ścisku
// (rejestrator zestawu ma tylko tryby „ścisk nad 116” i „× 0,42” — tu podmieniane są jego trzy przeliczniki wysokości
// na czas zapisu; zestaw wspólny bez zmian).
function holdZone(f, base, fn) {
  const y0 = f._y;
  const v0 = f._vs;
  const r0 = f._range;
  f._y = (y) => y - base;
  f._vs = () => 1;
  f._range = (y, h) => [y - base, Math.max(0.5, h)];
  try { fn(); } finally { f._y = y0; f._vs = v0; f._range = r0; }
}
const DECK = 116;
const BELL_FLAT = 180;          // do tej wysokości krawędzi dzwon jedzie 1:1 (praca nad ładunkiem), wyżej — dojazd do postoju
const BELL_SLOPE = 0.09;
/** Wysokość krawędzi dzwonu w scenie [j. nad pokładem] dla wysokości `y` z symulacji (strefa ładowni 1:1, postój pod wysięgnikiem). */
export const bellSceneZ = (y) => (y <= BELL_FLAT ? y - DECK : BELL_FLAT - DECK + (y - BELL_FLAT) * BELL_SLOPE);

/** Rura między punktami a i b ([x, y, z] w wysokościach K-7; całość nad albo całość pod y = 116). */
function tube(f, a, b, r, mat) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return;
  const rz = Math.acos(clamp1(dy / len));
  const ry = Math.atan2(dz / len, -dx / len);
  f.cyl((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, r, len, mat, [0, ry, rz]);
}
/** Obręcz o osi `d` (jednostkowej) w punkcie c. */
function hoop(f, c, d, r, mat) {
  f.ring(c[0], c[1], c[2], r, 0, mat, [Math.atan2(-d[1], d[2]), Math.asin(clamp1(d[0])), 0]);
}
/**
 * Odcinek oszklony rury (klatka): ramy prostokątne z belek co `step` i cztery podłużnice w narożach — ziarna jadą
 * w środku na widoku. a, b — końce osi ([x, y, z]). Ramy są z belek, nie z obręczy: torus zestawu portowego jest nad
 * pokładem ściskany w pionie i z góry wyglądał jak pofalowana deska; belka ma czysty zarys przy każdym zbliżeniu.
 */
function cage(f, a, b, r, { step = 40, ring = M.yellow, bar = M.rail, trough = true } = {}) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) return;
  const d = [dx / len, dy / len, dz / len];
  let n1 = [-d[2], 0, d[0]];
  const nl = Math.hypot(n1[0], n1[2]);
  n1 = nl < 1e-3 ? [1, 0, 0] : [n1[0] / nl, 0, n1[2] / nl];
  const n2 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]];
  const R = r + 1;
  const corner = (c, s1, s2) => [c[0] + (n1[0] * s1 + n2[0] * s2) * R, c[1] + (n1[1] * s1 + n2[1] * s2) * R, c[2] + (n1[2] * s1 + n2[2] * s2) * R];
  const n = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const c = [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
    const w = k === 0 || k === n ? 4.5 : 3;
    const q = [corner(c, -1, -1), corner(c, 1, -1), corner(c, 1, 1), corner(c, -1, 1)];
    for (let e = 0; e < 4; e++) f.beam(q[e], q[(e + 1) % 4], w, ring);
  }
  for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) f.beam(corner(a, s1, s2), corner(b, s1, s2), 2.6, bar);
  // koryto: ciemna blacha na spodzie klatki (n2 wskazuje w dół) — ziarna jadą NAD blachą, nie wiszą między prętami
  // (z listew o przekroju kwadratowym: belka zestawu ma przekrój obracany razem z kierunkiem, szeroka blacha stawałaby na sztorc)
  if (trough) {
    const slats = 7;
    const sw = (2 * R - 3) / slats;
    for (let k = 0; k < slats; k++) {
      const o = (k - (slats - 1) / 2) * sw;
      const lo = (c) => [c[0] + n2[0] * (R - 0.4) + n1[0] * o, c[1] + n2[1] * (R - 0.4) + n1[1] * o, c[2] + n2[2] * (R - 0.4) + n1[2] * o];
      f.beam(lo(a), lo(b), sw + 0.3, M.dark);
    }
  }
}
/** Pierścień poziomy z odcinków belek (torus zestawu bywa spłaszczany i z góry rysował się zdegenerowanym krążkiem). */
function hoopBeams(f, cx, y, cz, r, w, mat, n = 16) {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    f.beam([cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], w, mat);
  }
}
/** Mur z koroną z jasnych płyt. */
function wall(Q, a, b, { top = 150, t = 60, base = KEEL, mat = M.steel, cap = M.pale } = {}) {
  Q.seg(a, b, (base + top - 8) / 2, top - 8 - base, t, mat, 1.0);
  Q.seg(a, b, top - 4, 8, t + 8, cap, 1.0);
}

// ---------------------------------------------------------------------------

/**
 * Zasiek i nabrzeże. `rig`: gates — grupy pięciu zasuw (przesunięcie po z = otwarcie × `gateTravel`), flap — grupa
 * klapy wylotu (obrót wokół osi pionowej w `spout`), chan — kanały lamp (0: dmuchawa pracuje, 1: taśma jedzie,
 * 2: zasuwy otwarte).
 */
export function buildOreYardScene(geo, style) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const B = geo.bunker;
  const G = geo.gates;
  const Bt = geo.belt;
  const S = geo.spout;
  const q0 = B.z1 + B.wallT;          // 11 050 — lico muru od nabrzeża
  const q1 = geo.quayZ;               // 11 450 — krawędź nabrzeża
  const n0 = B.z0 - B.wallT;          // 10 000 — lico muru od części gorącej
  const X = 1010;                     // połowa szerokości platformy stanowiska
  const NZ = 9660;                    // koniec platformy od strony pieca
  let group = 0;

  // --- platforma: wanna pod dnem zasieku, nabrzeże, pobocza, pas od strony pieca
  Q.plate(rect(-B.x1 - B.wallT, n0, B.x1 + B.wallT, q0), KEEL, 22, M.dark);
  Q.plate(rect(-X, q0, X, q1), KEEL, FLOOR - KEEL, M.floor);
  Q.plate(rect(-X, NZ, -B.x1 - B.wallT, q0), KEEL, FLOOR - KEEL, M.floor);
  Q.plate(rect(B.x1 + B.wallT, NZ, X, q0), KEEL, FLOOR - KEEL, M.floor);
  Q.plate(rect(-B.x1 - B.wallT, NZ, B.x1 + B.wallT, n0), KEEL, FLOOR - KEEL, M.floor);
  // krawężniki platformy
  for (const x of [-X + 8, X - 8]) Q.seg([x, NZ], [x, q1], FLOOR + 5, 10, 16, M.rail);
  Q.seg([-X, NZ + 8], [X, NZ + 8], FLOOR + 5, 10, 16, M.rail);

  // --- mury zasieku: korona 150, wnętrze do dna; przypory od środka, bloki naroży, znaki poziomu
  const WT = { top: B.wallTop, t: B.wallT };
  wall(Q, [B.x0 - B.wallT, n0 + 30], [B.x1 + B.wallT, n0 + 30], WT);
  wall(Q, [B.x0 - B.wallT, q0 - 30], [B.x1 + B.wallT, q0 - 30], WT);
  wall(Q, [B.x0 - 30, B.z0], [B.x0 - 30, B.z1], WT);
  wall(Q, [B.x1 + 30, B.z0], [B.x1 + 30, B.z1], WT);
  for (const [x, z] of [[B.x0 - 30, n0 + 30], [B.x1 + 30, n0 + 30], [B.x0 - 30, q0 - 30], [B.x1 + 30, q0 - 30]]) {
    Q.box([x, z], (FLOOR + 166) / 2, 96, 166 - FLOOR, 96, M.teal);
    Q.box([x, z], 169, 76, 6, 76, M.rail);
  }
  for (let x = B.x0 + 142; x < B.x1 - 60; x += 142) {
    for (const [z, s] of [[B.z0, 1], [B.z1, -1]]) Q.box([x, z + s * 5], (B.floorEdge + 136) / 2, 16, 136 - B.floorEdge, 10, M.rail);
  }
  for (let z = B.z0 + 133; z < B.z1 - 60; z += 133) {
    for (const [x, s] of [[B.x0, 1], [B.x1, -1]]) Q.box([x + s * 5, z], (B.floorEdge + 136) / 2, 10, 136 - B.floorEdge, 16, M.rail);
  }
  // znaki poziomu zasypu na murach (żółta kreska = pełny zasiek, biała = połowa)
  for (const [y, mat] of [[95, M.yellow], [-10, M.pale]]) {
    Q.seg([B.x0 + 30, B.z0 + 1.5], [B.x1 - 30, B.z0 + 1.5], y, 5, 3, mat);
    Q.seg([B.x0 + 30, B.z1 - 1.5], [B.x1 - 30, B.z1 - 1.5], y, 5, 3, mat);
    Q.seg([B.x0 + 1.5, B.z0 + 30], [B.x0 + 1.5, B.z1 - 30], y, 5, 3, mat);
    Q.seg([B.x1 - 1.5, B.z0 + 30], [B.x1 - 1.5, B.z1 - 30], y, 5, 3, mat);
  }
  // pomost obsługi na koronie muru od nabrzeża, poręcz od strony zasieku
  Q.seg([B.x0, q0 - 6], [B.x1, q0 - 6], B.wallTop + 2, 4, 44, M.dark);
  Q.seg([B.x0, B.z1 + 3], [B.x1, B.z1 + 3], B.wallTop + 22, 4, 4, M.yellow);
  for (let x = B.x0 + 20; x <= B.x1; x += 71) Q.box([x, B.z1 + 3], B.wallTop + 12, 4, 20, 4, M.yellow);

  // --- zasuwy w dnie pod osią kopca: rama, czarny otwór, zasuwa (grupa — przesuwa się po z)
  const gates = [];
  const gy = B.floorGate;
  for (let k = 0; k < G.count; k++) {
    const x = G.xs[k];
    Q.box([x, G.z], gy - 9, G.half * 2 + 8, 16, G.half * 2 + 8, M.black);
    for (const s of [-1, 1]) {
      Q.box([x + s * (G.half + 3), G.z], gy + 1.2, 6, 3, G.half * 2 + 12, M.yellow);
      Q.box([x, G.z + s * (G.half + 3)], gy + 1.2, G.half * 2 + 12, 3, 6, M.yellow);
    }
    group++;
    f.group = group;
    Q.box([x, G.z], gy - 0.4, G.half * 2, 2, G.half * 2, M.steel);
    for (const o of [-9, 9]) Q.box([x + o, G.z], gy + 0.8, 3, 1.2, G.half * 2 - 4, M.rail);
    f.group = 0;
    gates.push(group);
  }

  // --- koryto taśmy zbiorczej pod kratą (ostatnie 270 j. przed przesypem) i szyb pochylni
  const tro = Bt.sections.find((s) => s.name === 'koryto');
  const bz = Bt.pts[0][2];
  const tx0 = Bt.pts[0][0] - tro.s1;
  const tx1 = Bt.pts[0][0] - tro.s0;
  const by = Bt.pts[0][1];
  for (const s of [-1, 1]) Q.seg([tx0 - 30, bz + s * 35], [tx1 + 4, bz + s * 35], (by - 22 + B.floorEdge) / 2, B.floorEdge - by + 22, 10, M.dark);
  Q.box([tx1 + 2, bz], (by - 22 + B.floorEdge) / 2, 6, B.floorEdge - by + 22, 70, M.dark);
  Q.seg([tx0 - 30, bz], [tx1 + 4, bz], by - 16, 12, 70, M.black);
  // rolki pod taśmą (widać je między progami) i krata nad korytem
  for (let x = tx0 + 14; x < tx1; x += 28) Q.box([x, bz], by - 5, 5, 5, 62, M.rail);
  for (const s of [-1, 1]) Q.seg([tx0 + 30, bz + s * 31], [tx1 + 2, bz + s * 31], B.floorEdge + 1.5, 3, 5, M.yellow);
  for (let x = tx0 + 44; x < tx1; x += 17) Q.box([x, bz], B.floorEdge + 0.8, 2.6, 2.6, 62, M.rail);
  // szyb pochylni: ściany, krawężnik
  const inc = Bt.sections.find((s) => s.name === 'pochylnia');
  const cosI = Math.cos(Bt.incline);
  const sinI = Math.sin(Bt.incline);
  const bx = Bt.pts[1][0];
  const zPit = bz - (inc.s0 - Bt.len0) * cosI;
  for (const s of [-1, 1]) Q.seg([bx + s * 35, zPit - 8], [bx + s * 35, bz + 34], (by - 22 + B.floorEdge) / 2, B.floorEdge - by + 22, 10, M.dark);
  Q.box([bx, bz + 37], (by - 22 + B.floorEdge) / 2, 80, B.floorEdge - by + 22, 8, M.dark);
  Q.seg([bx, zPit - 8], [bx, bz + 34], by - 16, 12, 70, M.black);
  for (const s of [-1, 1]) Q.seg([bx + s * 38, zPit - 10], [bx + s * 38, bz + 40], B.floorEdge + 2.5, 5, 6, M.yellow);
  Q.box([bx, bz + 40], B.floorEdge + 2.5, 82, 5, 6, M.yellow);

  // --- pochylnia do galerii pieca: podłużnice, łoże, kozły, poręcz; załamanie skali wysokości na y = 116
  const a = Bt.pts[1];
  const b = Bt.pts[2];
  const at = (t) => [a[0], a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const t116 = (116 - a[1]) / (b[1] - a[1]);
  const tEnd = 1 + 24 / Bt.len1;
  const spans = [[-24 / Bt.len1, t116], [t116, tEnd]];
  for (const [u0, u1] of spans) {
    const p = at(u0);
    const q = at(u1);
    for (const s of [-1, 1]) {
      Q.beam([p[0] + s * 35, p[2]], p[1] + 4, [q[0] + s * 35, q[2]], q[1] + 4, 9, M.yellow);
      Q.beam([p[0] + s * 37, p[2]], p[1] + 30, [q[0] + s * 37, q[2]], q[1] + 30, 3, M.rail);
    }
    f.beam([p[0], p[1] - 9, p[2]], [q[0], q[1] - 9, q[2]], 62, M.dark, 8);
  }
  // słupki poręczy i rolki pod taśmą co 50 j. wzdłuż pochylni
  for (let d = 20; d < Bt.len1; d += 50) {
    const p = at(d / Bt.len1);
    if (p[1] < B.floorEdge + 6) continue;
    for (const s of [-1, 1]) f.beam([p[0] + s * 37, p[1] + 4, p[2]], [p[0] + s * 37 - 0, p[1] + 30, p[2] - 0], 3, M.rail);
    f.beam([p[0] - 31, p[1] - 4, p[2]], [p[0] + 31, p[1] - 4, p[2]], 5, M.rail);
  }
  // kozły: w zasieku z dna, na murze, za murem z nabrzeża
  for (const d of [220, 370, 520, 690]) {
    const p = at(d / Bt.len1);
    const base = p[2] > B.z0 ? B.floorEdge : p[2] > n0 ? B.wallTop : FLOOR;
    for (const s of [-1, 1]) {
      Q.beam([p[0] + s * 62, p[2] + 26], base, [p[0] + s * 33, p[2]], p[1] - 10, 9, M.yellow);
      Q.beam([p[0] + s * 62, p[2] - 26], base, [p[0] + s * 33, p[2]], p[1] - 10, 9, M.yellow);
    }
    Q.box([p[0], p[2]], base + 3, 150, 6, 70, M.dark);
  }
  // galeria pieca: wieża, kosz przyjmujący, zabudowany przenośnik dalej ku piecowi
  const gz = b[2];
  // wieża kończy się 30 j. przed końcem taśmy od strony zasieku — pochylnia przechodzi NAD jej dachem, nie przez niego
  Q.box([bx, gz - 47.5], (FLOOR + 262) / 2, 210, 262 - FLOOR, 155, M.steel);
  Q.box([bx, gz - 50], 266, 228, 8, 168, M.rail);
  Q.box([bx, gz - 47.5], 150, 214, 26, 159, M.glass);
  // kosz przyjmujący pod końcem taśmy i OKAP PRZESYPU nad nim: taśma z ziarnami wjeżdża pod okap (otwarty od strony
  // zasieku), ziarna spadają do kosza w jego wnętrzu — koniec taśmy i znikanie ziaren są zasłonięte z każdej strony
  // (kosz stoi ZA końcem taśmy i poniżej niego — taśma nie wchodzi w jego bryłę)
  Q.box([bx, gz - 24], 283, 100, 26, 40, M.dark);
  Q.box([bx, gz - 38], 306, 96, 72, 12, M.black);
  for (const s of [-1, 1]) Q.box([bx + s * 54, gz + 4], 306, 8, 74, 98, M.yellow);
  Q.box([bx, gz + 2], 346, 124, 7, 104, M.steel);
  Q.box([bx, gz + 2], 351, 100, 4, 84, M.pale);
  Q.box([bx, gz + 53], 340, 124, 12, 6, M.yellow);
  Q.seg([bx, gz - 60], [bx, NZ], 300, 64, 84, M.pale);
  Q.seg([bx, gz - 60], [bx, NZ], 334, 6, 92, M.rail);
  for (let z = gz - 90; z > NZ + 20; z -= 44) Q.box([bx, z], 300, 86, 22, 14, M.glass);
  // lampa ostrzegawcza galerii: świecąca kostka na słupku (lampa-krążek zestawu rysowała się tu ziarnistą płytką —
  // także na wolno stojącym słupku, więc to wygląd krążka w trybie błysku, nie nakładające się ściany)
  Q.cyl([bx - 76, gz + 56], 274, 3, 20, M.rail);
  f.fx(1.0, PB_FX.blink, 0.3, 0.5);
  Q.box([bx - 76, gz + 56], 288, 10, 6, 10, M.red);
  f.nofx();
  Q.cyl([bx + 76, gz + 56], 274, 3, 20, M.rail);
  f.fx(0.9, PB_FX.status, 0, 1);
  Q.box([bx + 76, gz + 56], 288, 10, 6, 10, M.status);
  f.nofx();
  // napisy biegną wzdłuż −z stanowiska: w obróconym kadrze z góry (statek z lewej, piec z prawej) czytają się poziomo
  Q.label('DO PIECA', [bx + 330, NZ + 150], 250, 80, style.labels.berthLead, 'GALERIA WSADU', FLOOR + 3, 'bg', 0, -1);

  // --- stacja dmuchawy: budynek, cyklon, wentylator, komin; rura z pirsu do cyklonu
  const P = geo.pipe.fixed;             // 0 wylot, 1 kolano, 2 króciec, 3 cyklon, 4 koniec rury pirsu
  const blx = geo.blower.x;
  const blz = geo.blower.z;
  Q.box([blx + 14, blz + 22], (FLOOR + 168) / 2, 250, 168 - FLOOR, 214, M.steel);
  Q.box([blx + 14, blz + 22], 172, 262, 8, 226, M.rail);
  Q.box([blx + 14, blz + 131], 96, 150, 44, 6, M.glass);
  Q.cyl([blx, blz], 250, 62, 156, M.pale);
  Q.cyl([blx, blz], 334, 68, 12, M.rail);
  Q.cyl([blx, blz], 346, 26, 16, M.dark);
  for (const y of [200, 290]) Q.cyl([blx, blz], y, 64.5, 6, M.rail);
  f.cyl(blx + 96, 216, blz + 60, 44, 96, M.dark, [0, 0, Math.PI / 2]);
  f.cyl(blx + 150, 216, blz + 60, 30, 14, M.yellow, [0, 0, Math.PI / 2]);
  Q.box([blx + 96, blz + 60], 190, 110, 36, 70, M.steel);
  Q.cyl([blx + 104, blz - 44], 290, 15, 240, M.dark);
  Q.cyl([blx + 104, blz - 44], 412, 18, 8, M.rail);
  Q.lamp([blx + 104, blz - 44], 420, 10, M.red, 1.2, PB_FX.blink, 0.1, 0.5);
  f.fx(0.9, PB_FX.status, 0, 0);
  Q.box([blx - 96, blz + 124], 180, 12, 6, 12, M.status);
  f.nofx();
  // kołnierze na stykach rury z cyklonem i z budynkiem dmuchawy
  Q.cyl([blx, blz], 300, 71, 5, M.yellow);
  f.cyl(P[3][0], P[3][1] - 6, P[3][2] + 60, geo.pipe.r + 5, 8, M.rail, [Math.PI / 2, 0, 0]);
  f.cyl(P[4][0], P[4][1], P[4][2] + 10, geo.pipe.r + 4, 6, M.rail, [Math.PI / 2, 0, 0]);
  tube(f, P[4], [P[3][0], P[3][1] - 4, P[3][2] + 56], geo.pipe.r, M.hose);
  hoop(f, [P[4][0], P[4][1], P[4][2] - 6], [0, 0, 1], geo.pipe.r + 3, M.yellow);
  // króciec cyklon → kanał
  tube(f, [P[3][0] - 30, P[3][1] - 10, P[3][2] - 44], P[2], geo.pipe.r, M.hose);
  hoop(f, P[2], [0.34, 0.26, 0.9], geo.pipe.r + 3, M.yellow);

  // --- kanał zrzutowy w klatce (ziarna na widoku) i wylot z klapą nad zasiekiem
  cage(f, P[2], P[1], geo.pipe.r, { step: 38 });
  // podpory kanału: kozioł na nabrzeżu i dwa słupy na murze
  const mid = [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2, (P[1][2] + P[2][2]) / 2];
  const tw = (P[2][2] - (q0 - 30)) / (P[2][2] - P[1][2]);                 // kanał nad osią muru od nabrzeża
  const cw = [P[2][0] + (P[1][0] - P[2][0]) * tw, P[2][1] + (P[1][1] - P[2][1]) * tw, q0 - 30];
  for (const s of [-1, 1]) {
    Q.beam([mid[0] + s * 74, mid[2] + 10], FLOOR, [mid[0] + s * 30, mid[2]], mid[1] - 30, 10, M.yellow);
    Q.box([cw[0] + s * 44, cw[2]], (B.wallTop + cw[1] - 36) / 2, 10, cw[1] - 36 - B.wallTop, 10, M.yellow);
    Q.box([cw[0] + s * 44, cw[2]], B.wallTop + 2, 22, 4, 22, M.dark);
  }
  Q.box([mid[0], mid[2]], mid[1] - 34, 84, 8, 20, M.yellow);
  Q.box([cw[0], cw[2]], cw[1] - 38, 104, 8, 16, M.yellow);
  // wylot: krótka dysza od kolana i kołnierz
  tube(f, P[1], [S.x, S.y, S.z], geo.pipe.r + 3, M.yellow);
  hoop(f, P[1], [0.38, 0.38, 0.84], geo.pipe.r + 6, M.rail);
  hoop(f, [S.x, S.y, S.z], [-0.38, -0.38, -0.84], geo.pipe.r + 5, M.dark);
  Q.lamp([S.x + 40, S.z + 34], S.y + 44, 9, M.warm, 1.1, PB_FX.blink, 0.6, 0.7);
  // klapa wylotu (grupa — obrót wokół osi pionowej wylotu): blacha kierująca strugę i dwa policzki
  group++;
  const flap = group;
  f.group = flap;
  const jx = S.target.x - S.x;
  const jz = S.target.z - S.z;
  const jl = Math.hypot(jx, jz);
  const ux = jx / jl;
  const uz = jz / jl;
  Q.box([S.x + ux * 36, S.z + uz * 36], S.y - 46, 66, 5, 60, M.steel, ux, uz);
  Q.box([S.x + ux * 70, S.z + uz * 70], S.y - 40, 6, 16, 60, M.rail, ux, uz);
  for (const s of [-1, 1]) {
    Q.box([S.x + ux * 36 - uz * s * 31, S.z + uz * 36 + ux * s * 31], S.y - 30, 66, 34, 5, M.steel, ux, uz);
    // ramiona zawieszenia: od osi obrotu na kołnierzu wylotu do policzków klapy
    Q.beam([S.x - uz * s * 34, S.z + ux * s * 34], S.y + 6, [S.x + ux * 10 - uz * s * 32, S.z + uz * 10 + ux * s * 32], S.y - 16, 5, M.rail);
    Q.beam([S.x - uz * s * 34, S.z + ux * s * 34], S.y + 6, [S.x + ux * 62 - uz * s * 32, S.z + uz * 62 + ux * s * 32], S.y - 16, 4, M.rail);
    Q.box([S.x - uz * s * 34, S.z + ux * s * 34], S.y + 6, 9, 9, 9, M.dark);
  }
  f.group = 0;

  // --- nabrzeże: odbojnice, pachoły, światła krawędzi, budka sterowni, rurociąg, napisy
  for (let x = -X + 70; x < X; x += 210) Q.box([x, q1 - 8], FLOOR - 30, 150, 80, 16, M.black);
  for (let x = -X + 130; x < X; x += 470) Q.cyl([x, q1 - 60], FLOOR + 16, 20, 32, M.yellow);
  for (let k = 0; k <= 30; k++) Q.lamp([-X + 60 + ((2 * X - 120) * k) / 30, q1 - 28], FLOOR + 5, 12, M.warm, 1.15, PB_FX.chase, ((k / 30) * 4) % 1, 0.6);
  Q.box([-810, q0 + 150], (FLOOR + 110) / 2, 200, 110 - FLOOR, 130, M.steel);
  Q.box([-810, q0 + 150], 114, 216, 8, 146, M.rail);
  Q.box([-810, q0 + 216], 78, 160, 30, 6, M.glass);
  Q.cyl([-880, q0 + 110], 190, 4, 150, M.rail);
  Q.lamp([-880, q0 + 110], 268, 12, M.red, 1.6, PB_FX.blink, 0.45, 0.6);
  Q.pipe([-690, q0 + 60], [blx - 130, q0 + 60], FLOOR + 22, 14, M.copper);
  for (let x = -640; x < blx - 150; x += 120) Q.box([x, q0 + 60], FLOOR + 10, 14, 22, 40, M.rail);
  Q.label('ZASIEK RUDY', [-560, q0 + 210], 330, 150, style.labels.hub, 'ODKURZACZ · KOPIEC Z ZIAREN', FLOOR + 3, 'bg', 0, -1);
  Q.label('TOR 1', [840, q0 + 250], 240, 90, style.labels.berthLead, 'PIRS RUDY', FLOOR + 3, 'bg', 0, -1);
  addLamp(lamps, S.target.x, S.target.z, 340, 2);
  addLamp(lamps, blx - 160, blz + 60, 300, 1);
  addLamp(lamps, bx + 60, gz + 80, 380, 1);
  addLamp(lamps, -810, q0 + 240, 260, 1);

  if (group + 1 > PB_MAX_GROUPS) throw new Error(`ruda, zasiek: ${group} grup`);
  return sceneOf(f, plates, labels, lamps, { gates, gateTravel: G.half * 2 + 2, flap, spout: [S.x, S.y, S.z] });
}

// ---------------------------------------------------------------------------

/** Pirs: korpus, tory suwnicy, rura ssąca z odcinkami oszklonymi (klatki), odbojnice od strony statku, światła. */
export function buildOrePierScene(geo) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const P = geo.pier;
  const px = (P.x0 + P.x1) / 2;
  const top = P.top;
  Q.plate(rect(P.x0, P.z0 - 20, P.x1, P.z1), KEEL, top - KEEL, M.dark);
  Q.box([px, (P.z0 + P.z1) / 2], top + 2, P.x1 - P.x0 - 16, 4, P.z1 - P.z0 - 20, M.steel);
  for (const o of [-1, 1]) Q.box([px + o * 60, (P.z0 + P.z1) / 2], top + 8, 9, 10, P.z1 - P.z0 - 60, M.rail);
  for (let z = P.z0 + 60; z < P.z1; z += 190) Q.box([P.x0 - 5, z], 70, 12, 96, 90, M.black);
  // rura ssąca wzdłuż pirsu: odcinki pełne i klatki w oknach rury (te same liczby co `geo.pipe.windows`)
  const y = geo.pipe.pierY;
  const zA = geo.pipe.fixed[4][2];
  const zB = P.z1 - 120;
  const wins = geo.pipe.windows.filter((w) => w.seg === 4).map((w) => [zA + w.from, zA + w.to]).sort((a, b) => a[0] - b[0]);
  let z = zA;
  for (const [w0, w1] of wins) {
    if (w0 > z) Q.pipe([px, z], [px, w0], y, geo.pipe.r, M.hose);
    cage(f, [px, y, w0], [px, y, w1], geo.pipe.r, { step: 40 });
    z = w1;
  }
  if (zB > z) Q.pipe([px, z], [px, zB], y, geo.pipe.r, M.hose);
  Q.cyl([px, zB], y, geo.pipe.r + 4, 20, M.rail);
  for (let zz = P.z0 + 90; zz < P.z1 - 150; zz += 160) {
    if (wins.some(([w0, w1]) => zz > w0 - 12 && zz < w1 + 12)) continue;
    Q.box([px, zz], (top + y - 20) / 2 + 6, 84, y - 26 - top, 18, M.rail);
  }
  Q.lamp([px, P.z1 - 40], top + 30, 22, M.red, 1.8, PB_FX.blink, 0.13, 0.5);
  for (let k = 0; k < 8; k++) Q.lamp([P.x0 - 4, P.z0 + 150 + k * 250], top - 20, 12, M.cyan, 1.2, PB_FX.chase, 1 - k / 8, 0.7);
  for (let zz = P.z0 + 200; zz < P.z1; zz += 400) Q.cyl([P.x1 - 14, zz], top + 14, 9, 24, M.yellow);
  addLamp(lamps, px, P.z0 + 500, 330, 1);
  addLamp(lamps, px, P.z0 + 1300, 330, 1);
  return sceneOf(f, plates, labels, lamps, {});
}

// ---------------------------------------------------------------------------

/**
 * Odkurzacz (zestaw FG). `rig`: gantry — suwnica (przesunięcie z), trolley — wózek (przesunięcie x i z), boomPipe —
 * rura wysuwna po wysięgniku (walec jednostkowy wzdłuż +x: przesunięcie · skala długości), hose — wąż
 * teleskopowy (walec jednostkowy od góry: przesunięcie · skala długości), bell — dzwon (przesunięcie x, y, z),
 * ship — zrębnica ładowni (przesunięcie z ze statkiem). Położenia odniesienia: `ref`.
 */
export function buildOreVacScene(geo) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const P = geo.pier;
  const px = geo.gantry.x;
  const gz = geo.gantry.park;
  const yb = geo.gantry.boomY - 16;        // spód dźwigarów wysięgnika
  const x0 = geo.gantry.boomX0;
  const x1 = geo.gantry.boomX1;
  const tx = geo.trolley.park;
  const Bl = geo.bell;
  f.set = 'fg';
  let group = 0;

  // --- suwnica bramowa na pirsie z wysięgnikiem nad ładownię
  group++;
  const gantry = group;
  f.group = gantry;
  for (const o of [-1, 1]) {
    for (const e of [-90, 90]) Q.box([px + o * 60, gz + e], (P.top + yb) / 2, 22, yb - P.top, 26, M.yellow);
    // zastrzały nóg
    Q.beam([px + o * 60, gz - 90], P.top + 30, [px + o * 60, gz + 90], yb - 40, 8, M.yellow);
    Q.box([px + o * 60, gz], P.top + 12, 30, 24, 230, M.dark);
  }
  for (const e of [-90, 90]) Q.box([px, gz + e], yb - 8, 150, 20, 30, M.yellow);
  // dźwigary wysięgnika rozstawione szeroko (dzwon wisi między nimi na widoku z góry), poprzeczki, krzyżulce
  const GW = 74;                              // dźwigary ±74 j. od osi dzwonu: lej (promień ~62 j.) widać z góry między nimi
  for (const e of [-GW, GW]) Q.box([(x0 + x1) / 2, gz + e], yb + 16, x1 - x0, 32, 14, M.yellow);
  for (let x = x0 + 30; x < x1; x += 120) {
    Q.box([x, gz], yb + 30, x > px - 100 ? 10 : 5, x > px - 100 ? 8 : 5, GW * 2 + 8, M.yellow);
    if (x + 120 < x1 && x > px - 100) Q.beam([x, gz - GW], yb + 34, [x + 120, gz + GW], yb + 34, 5, M.rail);
  }
  for (const e of [-GW, GW]) Q.box([x0 + 4, gz + e], yb + 16, 14, 36, 20, M.dark);
  Q.box([x0 + 4, gz], yb + 32, 10, 6, GW * 2, M.yellow);
  // maszynownia nad pirsem, kabina operatora od strony ładowni
  Q.box([px + 6, gz], yb + 66, 176, 68, 200, M.steel);
  Q.box([px + 6, gz], yb + 104, 150, 10, 176, M.pale);
  Q.box([px - 96, gz + 78], yb - 26, 52, 44, 50, M.steel);
  Q.box([px - 124, gz + 78], yb - 24, 6, 26, 42, M.glass);
  // odciągi wysięgnika z masztu (po dźwigarach, nie nad osią rury)
  Q.box([px, gz], yb + 132, 22, 62, 22, M.yellow);
  for (const e of [-GW, GW]) {
    Q.beam([px, gz + e * 0.4], yb + 160, [x0 + 30, gz + e], yb + 36, 6, M.rail);
    Q.beam([px, gz + e * 0.4], yb + 160, [x1 - 10, gz + e], yb + 36, 6, M.rail);
  }
  // rura na suwnicy: pion przy nodze (z rury pirsu) i poziom po wysięgniku z oknem-klatką 60…300 j. od pionu;
  // dalej do wózka rura wysuwna (grupa `boomPipe`) — nad dzwonem nic nie zasłania widoku z góry
  const by = geo.gantry.boomY;
  const pr = geo.pipe.boomR;              // rura stała na wysięgniku; rura wysuwna (`slideR`) wchodzi w nią
  tube(f, [px, geo.pipe.pierY, gz], [px, by, gz], geo.pipe.legR, M.hose);
  for (const yy of [geo.pipe.pierY + 14, (geo.pipe.pierY + by) / 2, by - 30]) hoop(f, [px, yy, gz], [0, 1, 0], geo.pipe.legR + 3, M.yellow);
  const win = geo.pipe.windows.find((w) => w.seg === 6);
  Q.pipe([px, gz], [px - win.from, gz], by, pr, M.hose);
  // okno wysięgnika: klatka o boku ponad światło rury wysuwnej (ziarna jadą w świetle `geo.pipe.light[6]`)
  cage(f, [px - win.from, by, gz], [px - win.to, by, gz], geo.pipe.slideR + 1, { step: 40 });
  // redukcja za oknem: ziarna z klatki wchodzą w gruby kołnierz, dalej do wózka biegnie cienka rura wysuwna
  Q.pipe([px - win.to, gz], [px - win.to - 22, gz], by, pr, M.rail);
  Q.lamp([x0 + 2, gz], yb + 40, 10, M.red, 1.1, PB_FX.blink, 0.31, 0.5);
  Q.lamp([px + 6, gz - 96], yb + 114, 9, M.white, 0.9, PB_FX.blink, 0.6, 1.3);
  // listwy robocze pod dźwigarami: wąskie, ciepłe, poniżej progu przepalenia
  f.fx(0.55, PB_FX.steady);
  for (let x = x0 + 90; x < px - 80; x += 180) for (const e of [-GW, GW]) Q.box([x, gz + e], yb - 2, 14, 2, 5, M.warm);
  f.nofx();

  // --- rura wysuwna po wysięgniku: walec jednostkowy wzdłuż +x od początku układu grupy (skala długości w macierzy)
  group++;
  const boomPipe = group;
  f.group = boomPipe;
  // rura wysuwna rysowana cienko (17 j.): ziaren w niej nie widać, a z góry nie zasłania ładowni przy dzwonie
  f.cyl(0.5, by, gz, 17, 1, M.hose, [0, 0, Math.PI / 2]);
  f.group = 0;

  // --- wózek ssawy: dwa wózki jezdne na dźwigarach, jarzmo i kolano rury — lekki, żeby nie zasłaniać dzwonu
  group++;
  const trolley = group;
  f.group = trolley;
  for (const e of [-GW, GW]) {
    Q.box([tx, gz + e], yb + 38, 84, 12, 18, M.dark);
    for (const o of [-30, 30]) Q.box([tx + o, gz + e], yb + 33, 16, 8, 20, M.rail);
  }
  for (const o of [-34, 34]) Q.box([tx + o, gz], yb + 47, 8, 8, GW * 2 + 14, M.yellow);
  Q.cyl([tx, gz], by - 2, HOSE_R + 4, 40, M.yellow);
  Q.cyl([tx, gz], by + 20, HOSE_R + 1, 6, M.rail);
  f.fx(0.6, PB_FX.steady);
  for (const e of [-GW, GW]) Q.box([tx + 46, gz + e], yb + 26, 6, 3, 6, M.warm);
  f.nofx();
  Q.lamp([tx - 44, gz + GW], yb + 48, 5, M.warm, 1.0, PB_FX.blink, 0.2, 1.1);

  // --- wąż teleskopowy: walec jednostkowy wiszący w dół z początku układu grupy (skala długości w macierzy)
  group++;
  const hose = group;
  f.group = hose;
  f.mode = 'lin';
  f.cyl(0, -0.5, 0, HOSE_R, 1, M.rail);
  for (const t of [0.12, 0.3, 0.48, 0.66, 0.84]) f.cyl(0, -t, 0, HOSE_R + 2.5, 0.022, M.yellow);
  f.mode = 'abs';

  // --- dzwon: klatka (obręcz dolna, żebra, kołnierz gardzieli) — ziarna wciągane do środka zostają na widoku.
  // Strefa ładowni: wysokości 1:1, krawędź dzwonu na wysokości 0 układu grupy (strona ustawia ją przez `bellSceneZ`).
  group++;
  const bell = group;
  f.group = bell;
  const ty = Bl.throatH;
  holdZone(f, 0, () => {
    hoopBeams(f, tx, 0.5, gz, Bl.r + 1, 4.2, M.yellow);
    hoopBeams(f, tx, 5.5, gz, Bl.r - 1.5, 2.6, M.dark);
    hoopBeams(f, tx, ty * 0.55, gz, (Bl.r + Bl.throatR + 4) / 2 + 2, 2.6, M.rail, 12);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      f.beam([tx + Math.cos(a) * (Bl.r + 1), 1, gz + Math.sin(a) * (Bl.r + 1)], [tx + Math.cos(a) * (Bl.throatR + 4), ty + 3, gz + Math.sin(a) * (Bl.throatR + 4)], 3.2, k % 2 ? M.rail : M.yellow);
    }
    Q.cyl([tx, gz], ty + 9, Bl.throatR + 5, 12, M.steel);
    Q.cyl([tx, gz], ty + 16, Bl.throatR + 7, 3, M.yellow);
    Q.cyl([tx, gz], ty + 26, HOSE_R + 3, 18, M.yellow);
    f.fx(0.6, PB_FX.steady);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      Q.box([tx + Math.cos(a) * (Bl.r + 4.5), gz + Math.sin(a) * (Bl.r + 4.5)], 4, 2.4, 1.8, 2.4, M.warm);
    }
    f.nofx();
  });

  // --- zrębnica ładowni (jedzie ze statkiem): rama wokół ładowni, żółta krawędź, narożniki
  group++;
  const ship = group;
  f.group = ship;
  const Hd = geo.hold;
  const hy = (Hd.floorY + Hd.coamingY) / 2;
  const hh = Hd.coamingY - Hd.floorY + 2;
  const cx = (Hd.x0 + Hd.x1) / 2;
  const cz = (Hd.z0 + Hd.z1) / 2;
  const W = Hd.x1 - Hd.x0;
  const D = Hd.z1 - Hd.z0;
  // strefa ładowni: ściany od dna (50 j. pod pokładem) do korony zrębnicy (50 j. nad nim) w skali 1:1 — tak samo rysują
  // się ziarna ładowni. Część pod pokładem widać tylko od środka (wykładzina ładowni: `obraz.js`); z zewnątrz zasłania
  // ją pokład (znaczek głębi w `obraz.js`).
  const dh = Hd.coamingY - DECK;
  holdZone(f, DECK, () => {
    for (const s of [-1, 1]) {
      Q.box([cx + s * (W / 2 + 6), cz], hy, 12, hh, D + 24, M.floor);
      Q.box([cx, cz + s * (D / 2 + 6)], hy, W + 24, hh, 12, M.floor);
      Q.box([cx + s * (W / 2 + 6), cz], Hd.coamingY + 2, 15, 3, D + 30, M.yellow);
      Q.box([cx, cz + s * (D / 2 + 6)], Hd.coamingY + 2, W + 30, 3, 15, M.yellow);
      for (const e of [-1, 1]) Q.box([cx + s * (W / 2 + 11), cz + e * (D / 2 + 11)], hy + 3, 22, hh + 6, 22, M.dark);
      // wręgi zrębnicy od zewnątrz (co 78 j.), nad pokładem
      for (let z = cz - D / 2 + 39; z < cz + D / 2; z += 78) Q.box([cx + s * (W / 2 + 13), z], DECK + dh / 2 - 1, 4, dh - 4, 8, M.rail);
      for (let x = cx - W / 2 + 42; x < cx + W / 2; x += 84) Q.box([x, cz + s * (D / 2 + 13)], DECK + dh / 2 - 1, 8, dh - 4, 4, M.rail);
    }
    // prowadnice pokryw luku na pokładzie (pokrywy zdjęte na czas rozładunku)
    for (const s of [-1, 1]) Q.box([cx + s * (W / 2 + 26), cz], DECK + 3, 8, 5, D + 60, M.rail);
    f.fx(0.8, PB_FX.steady);
    for (const s of [-1, 1]) for (const e of [-1, 1]) Q.box([cx + s * (W / 2 + 11), cz + e * (D / 2 + 11)], Hd.coamingY + 8, 8, 4, 8, s * e > 0 ? M.green : M.red);
    f.nofx();
  });
  f.group = 0;
  f.set = 'bg';

  if (group + 1 > PB_MAX_GROUPS) throw new Error(`ruda, odkurzacz: ${group} grup`);
  return sceneOf(f, plates, labels, lamps, {
    gantry, trolley, boomPipe, hose, bell, ship,
    // hoseEnd — koniec węża nad krawędzią dzwonu [j. sceny, strefa ładowni 1:1]
    ref: { gantryZ: gz, trolleyX: tx, hoseTop: by - 20, hoseEnd: Bl.throatH + 30, pipeEndX: px - win.to }
  });
}
