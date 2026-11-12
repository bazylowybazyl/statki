// Elektrownia „KOREK” — OBUDOWA DZIURY: infrastruktura na ścianach i brzegu gryzu. Geometria CPU w ramie elektrowni
// (earthBitePlantFrame.js), części z rodzajem powierzchni (PART): bryły — materiał metalu, przewody — materiał przepływu
// (impulsy wzdłuż uv.y).
// Z kamery gry (znad bieguna obrotu, ~10° nad płaszczyzną elektrowni, od północy) widać od frontu FASADĘ POŁUDNIOWEJ
// korony i górny pas południowej ściany, a północną koronę od zewnątrz — tam idzie detal i światło („fasada bohatera”).
//   • KORONA BRZEGU — wał wzdłuż nieregularnego brzegu (brzeg próbkowany gęsto + dokładne ostrza zębów): pochyły FARTUCH
//     wyrasta z okładziny ściany, nad nim FASADA w trzech kondygnacjach pasów okien (wnęki, płyciny, pilastry co 1°, co
//     piąty cięższy), ciężki GZYMS z podwójną cienką listwą chłodną (z gry — pierścień brzegu), parapet z cienką listwą
//     na krawędzi (z góry), pokład z posterunkami co 15°, zewnętrzny stok z przyporami co 2°; w azymutach wind pokład
//     rozlewa się w PLAC pod kotwicę (brama wiązki na parapecie, przyłącze przewodów, światła narożne).
//   • OKŁADZINA górnego pasa ściany — czarne tarasy od fartucha fasady do GALERII-PASA (najwyższa galeria), uskoki
//     z ciepłymi listwami: wcięcie w obrysie czyta się jak wyłożona megastruktura.
//   • EMITERY POLA SIŁOWEGO (otwór trzyma pole) — maszty co 7,5° na koronie: KRATOWNICOWE PYLONY (trzy pasy, krzyżulce,
//     dwie kondygnacje z ciepłym pasem świateł, w osi chłodna szyna energii, odciąg), głowica — CEWKA toroidalna
//     z uzwojeniem i mała okrągła soczewka z gradientem (bez wzoru); na łuku południowym (w kadrze gry nad gzymsem, na
//     tle kosmosu) CIĘCIWY POLA między głowicami — ciągłe, bardzo słabe łuki energii wygięte ku górze, jaśniejsze przy
//     głowicach, gasnące ku środkowi, z falą jasności obiegającą koronę (najniższy poziom hierarchii jasności).
//   • ŚCIANY — hierarchia: PRZYPORY GŁÓWNE w pół drogi między przewodami (stopniowany przekrój z kołnierzem w skale,
//     przewód energii na czole, światła; u góry filar fasady, u dołu but na pierścieniu stopy i stopa na pasie osłon),
//     cieńsze ŻEBRA WTÓRNE od galerii-pasa do pierścienia stopy (obejma na pierścieniu), trzy GALERIE skrzynkowe
//     (pas okien we wnęce, listwa, moduły: kapsuły okien, żaluzje; pod spodem FARTUCH skośnie w skałę), dyspozytornie na
//     skrzyżowaniach z przyporami; wzdłuż przypór PASY OKŁADZINY z kolumnami okien (środkowy i dolny pas ściany).
//   • PRZEWODY od STOPY ŚCIANY (wallFootPoint — tam kończą się przewody korka na mostach): pierścień wokół stopy,
//     rozdzielnie, wiązki główne w górę ścian (od galerii-pasa w KANALE FASADY — ciemna skrzynia ze szczeliną energii)
//     i przez koronę do kotwic wind (windy idą do RINGU planetarnego), boczne do PODSTACJI (tarasowe budynki we wnęce
//     między policzkami, węzły galerii); obejmy co ~0,02 R; OSŁONY CIEPLNE pod pierścieniem: ciemne płyty na żarzącym
//     się podkładzie (świecące szwy), bez odcinków w bryle korka (kontrakt z CORK: `footBandOk`, rozdzielnie stopy).
//   • BRAMA PROMIENIA w osi promienia w kadrze gry (południowa ściana, 270°: południk gryzu zawiera kierunek kamery gry,
//     więc to, co w nim stoi, rzutuje się na promień) — zamiast przewodu bocznego z podstacją: dwa smukłe pylony (±7,5°)
//     od stopy po wieże nad krawędzią spięte cienkim nadprożem, przewody energii w rynnach, głowice emiterów na wieżach.
//     Z gry — portal szerszy niż pierścienie zamknięcia promienia (bez „beczki”), przez który promień wychodzi z otworu.
// WŁASNE UV CZĘŚCI (kontrakt aPart.z < 0): części przeciągane po obwodzie (korona, okładzina, galerie, fartuchy, osłony)
// i po ścianie (przypory, pylony, kanały, żebra), pręty i stal skrzynek — wzór idzie po części, nie po rzucie pudełkowym.
// Przekrój południka φ: ρ — odległość od osi gryzu, y — wysokość nad dnem; ściana pod kątem ψ (od dna) z dokładnym β(φ, ψ)
// (płaty, zęby). Azymut φ ramy = azymut kuli gryzu (x = ρ cos φ, z = −ρ sin φ).
// AGENT: azymuty przewodów, przypór i żeber liczą się z L.elevators (wallLayout) — obrót wind przenosi całą obudowę.
import * as THREE from 'three/webgpu';
import { EARTH_BITE } from '../data/earthBite.js';
import { earthBiteRadius, earthBiteRimAngle, earthBiteRimPsi } from './earthBiteShape.js';
import { DEG, PART, finalizePart, plantZ0, plantRng, cylinderBetween } from './earthBitePlantFrame.js';

/** Wymiary obudowy (R Ziemi; kąty za krawędzią — rad od C, jak `anchorPad`). */
export const LINING_DEFAULTS = Object.freeze({
  // korona: fasada (zejście po ścianie pod krawędź — trzy kondygnacje okien, ≥ 0,025), odsunięcie fasady od ściany,
  // parapet i pokład nad gruntem, koniec stoku za krawędzią, próbki obwodu, krok pilastrów fasady [°]
  liningCrownDrop: 0.026, liningCrownLift: 0.0050, liningCrownTop: 0.0044, liningCrownDeck: 0.0034, liningCrownOut: 0.0102,
  liningCrownSamples: 576, liningPilasterStep: 1,
  // okładzina górnego pasa ściany (od fartucha fasady do galerii-pasa): grubość tarasów od dołu
  liningClad: [0.0040, 0.0027, 0.0014],
  // place pod kotwicami wind: półszerokość [R] i koniec pokładu za krawędzią
  liningPlazaW: 0.011, liningPlazaOut: 0.0115,
  // emitery pola: liczba masztów, wysięgnik, pochylenie nad otwór [°]
  liningMasts: 48, liningMastLen: 0.016, liningMastTilt: 32,
  // galerie: wysokości (najwyższa — pas pod okładziną), wysięg od ściany, wysokość skrzyni (pas × 1,2)
  liningGalleries: [0.10, 0.18, 0.27], liningGalleryD: 0.011, liningGalleryH: 0.015,
  // pas okładziny wzdłuż przypór głównych (półszerokość [R]) i fartuch pod galeriami (zejście po ścianie pod spód [R])
  liningPanelBand: 0.032, liningApron: 0.012,
  // przewody: promień rury głównej, azymuty bocznych (null — w pół drogi między windami), podstacje: wysokości (na
  // przemian; galerie przechodzą przez nie) i skala
  liningConduitR: 0.0016, liningSideConduits: null, liningSubstationH: [0.186, 0.106], liningSubstationScale: 1.25,
  // BRAMA PROMIENIA na osi promienia w kadrze gry (południk gryzu z kierunkiem kamery gry — południowa ściana; null — bez
  // bramy; przy placu windy w osi brama nie powstaje): azymut [°], półrozstaw pylonów [°] (pylony w osiach żeber wtórnych;
  // w rzucie gry wewnętrzne lica wież ~0,05 R od osi — poza pierścieniami zamknięcia promienia, r ≤ 0,041 z pasem
  // pola, ≤ 0,046 ze skrzydłami), wysokość wież nad krawędzią [R] (nadproże między pierścieniami 0,422 i 0,48)
  liningGateAz: 270, liningGateHalf: 7.5, liningGateTower: 0.024,
  // cięciwy pola między głowicami masztów: tylko na łuku, gdzie w kadrze gry leżą nad gzymsem na tle kosmosu (sin φ
  // poniżej progu — południowa korona); po stronie północnej biegłyby w poprzek fasady bohatera. Ciągły łuk: jasność
  // przy głowicach (listwa), ułamek tej jasności w środku cięciwy, wygięcie ku górze (× długość), promień rurki [R]
  liningChordSin: -0.2, liningChordGlow: 0.085, liningChordMid: 0.1, liningChordBow: 0.045, liningChordR: 0.00028
});

const BITE = EARTH_BITE;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const norm360 = (a) => ((a % 360) + 360) % 360;
/** Odległość kątowa azymutów (0…π). */
const angDist = (a, c) => Math.abs((((a - c) % TAU) + TAU + Math.PI) % TAU - Math.PI);

/** Punkt (albo kierunek) płaszczyzny południka φ (ρ, y) w ramie elektrowni. */
const at3 = (rho, y, phi, out = new THREE.Vector3()) => out.set(rho * Math.cos(phi), y, -rho * Math.sin(phi));

// ── Ściana i brzeg w przekroju południka ───────────────────────────────────────────────────────────────────────────

/** Ściana w południku φ: [ρ, y] punktu pod kątem ψ, uniesionego o `lift` ku C (nad ścianę, w otwór). */
function wallRY(phi, psi, lift, b) {
  const be = earthBiteRadius(phi, psi, BITE, b) - lift;
  return [be * Math.sin(psi), b - be * Math.cos(psi)];
}

/**
 * ψ ściany na wysokości h (te same punkty co `bowlPsiAtHeight` / `wallFootPoint`, do 1e-12): Newton po y(ψ) = b − β cos ψ
 * z przedziałem bisekcji jako bezpiecznikiem (β z płatami i zębami — pochodna przybliżona β sin ψ).
 */
function psiAtHeight(phi, h, b) {
  let lo = 0, hi = earthBiteRimPsi(phi, BITE, b);
  let psi = Math.min(hi, Math.max(0, Math.acos(Math.min(1, Math.max(-1, (b - h) / b)))));
  for (let i = 0; i < 40; i++) {
    const be = earthBiteRadius(phi, psi, BITE, b);
    const f = b - be * Math.cos(psi) - h;
    if (Math.abs(f) < 1e-13) break;
    if (f < 0) lo = psi; else hi = psi;
    let next = psi - f / Math.max(be * Math.sin(psi), 1e-6);
    if (!(next > lo && next < hi)) next = (lo + hi) * 0.5;
    psi = next;
  }
  return psi;
}

const wallRhoAt = (phi, h, b) => wallRY(phi, psiAtHeight(phi, h, b), 0, b)[0];

/** Wysokość ściany w odległości ρ od osi (ρ = β sin ψ rośnie z ψ). */
function wallYAtRho(phi, rho, b) {
  let lo = 0, hi = earthBiteRimPsi(phi, BITE, b);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) * 0.5;
    if (earthBiteRadius(phi, mid, BITE, b) * Math.sin(mid) < rho) lo = mid; else hi = mid;
  }
  return wallRY(phi, (lo + hi) * 0.5, 0, b)[1];
}

/**
 * Krawędź brzegu w południku φ: punkt E (ρ, y), kierunki — po ścianie w górę (tw), od ściany w otwór (nw), po gruncie na
 * zewnątrz (ts), pion gruntu (ns). `w(c, a)` — punkt c pod krawędzią po ścianie (c < 0 — przedłużenie ściany nad
 * krawędź), uniesiony o a; `s(s, h)` — punkt s za krawędzią (kąt od C po kuli; s < 0 — nad otworem), h nad gruntem.
 */
function rimAt(phi, b) {
  const z0 = plantZ0(b);
  const th = earthBiteRimAngle(phi, BITE, b);
  const psR = earthBiteRimPsi(phi, BITE, b);
  const beR = earthBiteRadius(phi, psR, BITE, b);
  const E = [Math.sin(th), Math.cos(th) - z0];
  const tw = [Math.cos(psR), Math.sin(psR)], nw = [-Math.sin(psR), Math.cos(psR)];
  const ts = [Math.cos(th), -Math.sin(th)], ns = [Math.sin(th), Math.cos(th)];
  return {
    th, psR, beR, E, tw, nw, ts, ns,
    w: (c, a) => (c >= 0 ? wallRY(phi, psR - c / beR, a, b) : [E[0] - c * tw[0] + a * nw[0], E[1] - c * tw[1] + a * nw[1]]),
    s: (s, h) => (s >= 0 ? [(1 + h) * Math.sin(th + s), (1 + h) * Math.cos(th + s) - z0] : [E[0] + s * ts[0] + h * ns[0], E[1] + s * ts[1] + h * ns[1]])
  };
}

/** Azymuty ostrzy zębów brzegu (załamania β): φ + warp · sin(φ + faza) = 2πk / n. */
function toothCusps() {
  const out = [];
  const ph = BITE.teethPhase * DEG, wv = BITE.teethWarp;
  for (let k = 0; k < BITE.teeth; k++) {
    const target = (TAU * k) / BITE.teeth;
    let p = target;
    for (let i = 0; i < 30; i++) p -= (p + wv * Math.sin(p + ph) - target) / (1 + wv * Math.cos(p + ph));
    out.push(((p % TAU) + TAU) % TAU);
  }
  return out;
}

/** Próbki obwodu: n równych + ostrza zębów + gęste okna [środek, półszerokość, krok]; domknięte (ostatnia = pierwsza + 2π). */
function azSamples(n, dense = []) {
  const s = [];
  for (let i = 0; i < n; i++) s.push((i / n) * TAU);
  for (const [c, half, step] of dense) for (let a = c - half; a <= c + half; a += step) s.push(((a % TAU) + TAU) % TAU);
  s.push(...toothCusps());
  s.sort((x, y) => x - y);
  const out = [];
  for (const a of s) if (!out.length || a - out[out.length - 1] > 2e-5) out.push(a);
  if (TAU - out[out.length - 1] < 2e-5) out.pop();
  out.push(out[0] + TAU);
  return out;
}

/** Pierścień azymutów w pół drogi między kolejnymi z listy [°]. */
function midRing(list) {
  const s = [...list].map(norm360).sort((x, y) => x - y);
  return s.map((a, i) => norm360((a + (i + 1 < s.length ? s[i + 1] : s[0] + 360)) / 2));
}

const angDistDeg = (a, c) => angDist(a * DEG, c * DEG) / DEG;

/**
 * Układ ścian [rad]: przewody główne (azymuty wind) i boczne (do podstacji), przypory główne w pół drogi między
 * przewodami, żebra wtórne w pół drogi między przewodami a przyporami. BRAMA PROMIENIA (`liningGateAz`) zastępuje przewód
 * boczny w swojej osi (bez podstacji — z kamery gry wszystko w tym południku leży na promieniu); przypory i żebra liczą się
 * z pełnego pierścienia przewodów, więc zostają symetryczne wokół osi bramy. `sideH` — wysokość podstacji przewodu
 * bocznego (na przemian w pełnym pierścieniu — brama nie przestawia sąsiadów).
 */
function wallLayout(L) {
  const main = L.elevators.map(norm360);
  const sideAll = (Array.isArray(L.liningSideConduits) ? L.liningSideConduits : midRing(main)).map(norm360);
  const cond = [...main, ...sideAll];
  const prim = midRing(cond);
  const sec = midRing([...cond, ...prim]);
  const gAz = L.liningGateAz == null ? null : norm360(L.liningGateAz);
  const gate = gAz !== null && !main.some((a) => angDistDeg(a, gAz) < 10);
  const side = [], sideH = [];
  sideAll.forEach((a, i) => {
    if (gate && angDistDeg(a, gAz) < 5) return;
    side.push(a);
    sideH.push(L.liningSubstationH[i % L.liningSubstationH.length]);
  });
  const r = (l) => l.map((a) => a * DEG);
  const pyl = gate ? [gAz - L.liningGateHalf, gAz + L.liningGateHalf] : [];
  // żebro wtórne w osi pylonu bramy ustępuje pylonowi
  const secK = sec.filter((a) => !pyl.some((p) => angDistDeg(a, p) < 2));
  return {
    main: r(main), side: r(side), sideH, cond: r(cond), prim: r(prim), sec: r(secK),
    gateAz: gate ? gAz * DEG : null, gate: r(pyl)
  };
}

/** Galeria-pas (najwyższa — pod okładziną) i wysokość skrzyni galerii. */
const beltY = (L) => Math.max(...L.liningGalleries);
const galleryH = (L, yc) => L.liningGalleryH * (yc === beltY(L) ? 1.2 : 1);

// ── Bazy lokalne (macierze prawoskrętne) ───────────────────────────────────────────────────────────────────────────

/** Walcowa w φ: X = od osi (ρ), Y = w górę (y), Z = X × Y; lokalne (ρ, y, z) = współrzędne ramy w południku φ. */
const cylBasis = (phi) => new THREE.Matrix4().makeBasis(
  new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi)));

/** Na ścianie (φ, ψ): X — poziomo wzdłuż obwodu, Y — od ściany w otwór, Z — po ścianie w górę. */
function wallBasis(phi, psi, b) {
  const [r, y] = wallRY(phi, psi, 0, b);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(-Math.sin(phi), 0, -Math.cos(phi)),
    at3(-Math.sin(psi), Math.cos(psi), phi), at3(Math.cos(psi), Math.sin(psi), phi)).setPosition(at3(r, y, phi));
}

/** Na krawędzi brzegu (rimAt): X — po gruncie na zewnątrz (s), Y — pion gruntu (h), Z = X × Y (wzdłuż obwodu). */
const rimBasis = (R, phi) => new THREE.Matrix4().makeBasis(at3(R.ts[0], R.ts[1], phi), at3(R.ns[0], R.ns[1], phi),
  new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi))).setPosition(at3(R.E[0], R.E[1], phi));

// ── Budowa części ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * WŁASNE UV CZĘŚCI (kontrakt aPart.z < 0 — PART w earthBitePlantFrame.js): przy kadłubie, stali, oknach, listwach i żarze
 * wzór idzie po uv części w [R] (uv.x wzdłuż, uv.y w poprzek profilu), |z| to parametr rodzaju. z = 0 (wartość domyślna
 * rodzaju) → domyślna wartość jawnie: okna 0,5, listwa 1, żar ~0; kadłub i stal parametru nie czytają.
 */
const OWN_UV_Z = { [PART.HULL]: 1, [PART.STRUCT]: 1, [PART.WINDOW]: 0.5, [PART.STRIP]: 1, [PART.HOT]: 1e-6 };
const ownZ = (kind, z) => (kind in OWN_UV_Z ? -(z > 0 ? z : OWN_UV_Z[kind]) : z);

/**
 * Pas siatki z rzędów punktów (rzędy wzdłuż przeciągnięcia, w rzędzie — punkty przekroju; Vector3). uv: u — droga wzdłuż
 * rzędów [R] (albo `uRows` — wspólna droga rzędów wszystkich ścian części), v — droga w przekroju [R]. Trójkąty
 * zwrócone ku `out` (kierunek na zewnątrz środkowego czworokąta).
 * Własne uv (z < 0) — `own`: 'all' (części przeciągane po obwodzie: u poziomo, jak „ściana” wzoru kadłuba), 'wall'
 * (przeciągane po ścianie — przypory, pylony, kanały: stal i listwy u wzdłuż części, a KADŁUB z osiami zamienionymi —
 * u w poprzek, v wzdłuż — bo wzór kadłuba stawia żebra usztywnień w stałym u: żebra biegną wzdłuż przypory jak pionowe
 * żebrowanie sąsiedniej okładziny, szwy w poprzek; bez ukośnych linii rzutu pudełkowego na bokach i fazach), 'none'
 * (rzut pudełkowy — np. okna przeciągane po ścianie: kondygnacje poziomo).
 */
function gridPart(rows, out, kind, seed, z = 0, w = 0, own = 'all', uRows = null) {
  const n = rows.length, m = rows[0].length;
  const swap = own === 'wall' && kind === PART.HULL;
  const pos = new Float32Array(n * m * 3), uvs = new Float32Array(n * m * 2);
  const km = m >> 1;
  let u = 0;
  for (let j = 0; j < n; j++) {
    if (uRows) u = uRows[j]; else if (j) u += rows[j][km].distanceTo(rows[j - 1][km]);
    let v = 0;
    for (let k = 0; k < m; k++) {
      const p = rows[j][k];
      if (k) v += p.distanceTo(rows[j][k - 1]);
      const i = j * m + k;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      uvs[i * 2] = swap ? v : u; uvs[i * 2 + 1] = swap ? u : v;
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let k = 0; k < m - 1; k++) {
      const a = j * m + k, bb = a + m, c = a + 1, d = bb + 1;
      idx.push(a, c, bb, bb, c, d);
    }
  }
  const jm = (n - 1) >> 1, kq = (m - 2) >> 1;
  const A = rows[jm][kq];
  const nrm = new THREE.Vector3().subVectors(rows[jm][kq + 1], A).cross(new THREE.Vector3().subVectors(rows[jm + 1][kq], A));
  if (nrm.dot(out) < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const box = own === 'none';
  return finalizePart(g, kind, seed, box ? z : ownZ(kind, z), w);
}

/**
 * Pręt P → Q (walec `seg`-boczny, otwarty) z WŁASNYM uv w [R]: u — droga wzdłuż pręta od `u0`, v — po obwodzie (stal:
 * szczotkowanie wzdłuż pręta, listwa: rurki świetlne wzdłuż — bez skręconych pasów rzutu pudełkowego).
 */
function rodPart(P, Q, r, seg, kind, seed, z = 0, w = 0, u0 = 0, r1 = r) {
  const g = cylinderBetween(P, Q, r, seg, true, r1);
  const len = P.distanceTo(Q), circ = TAU * Math.max(r, r1);
  const uvA = g.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, u0 + uvA.getY(i) * len, uvA.getX(i) * circ);
  return finalizePart(g, kind, seed, ownZ(kind, z), w);
}

/**
 * Przeciągnięcie po azymucie tylko tam, gdzie `ok(φ)` — osobne odcinki (otwarte końce), zamknięte, gdy `ok` wszędzie.
 * Zwraca końce odcinków [[φ, kierunek ±1 — na zewnątrz odcinka], …] (zaślepki).
 */
function sweepRuns(parts, phis, ok, prof, segs, seed) {
  const n = phis.length - 1;                       // phis domknięte: ostatnia = pierwsza + 2π
  const f = phis.slice(0, n).map(ok);
  if (f.every(Boolean)) { sweepAz(parts, phis, prof, segs, seed); return []; }
  const ends = [];
  let s = f.findIndex((v, i) => !v && f[(i + 1) % n]);
  if (s < 0) return ends;
  for (let k = 0; k < n;) {
    const run = [];
    let i = (s + 1 + k) % n;
    while (f[i] && run.length < n) {
      run.push(phis[i] + (i <= s ? TAU : 0));
      k++;
      i = (s + 1 + k) % n;
    }
    k++;
    if (run.length >= 2) {
      sweepAz(parts, run, prof, segs, seed);
      ends.push([run[0], -1], [run[run.length - 1], 1]);
    }
  }
  return ends;
}

/**
 * Bryła przeciągnięta po azymucie: `prof(φ)` → przekrój [[ρ, y], …] (bryła po PRAWEJ stronie kierunku przekroju),
 * `segs` — odcinki [i0, i1, rodzaj, z, w] (osobne pasy — ostre krawędzie między nimi). Własne uv: u — droga środka
 * przekroju po obwodzie, wspólna dla wszystkich pasów (szwy paneli przechodzą przez naroża przekroju w jednym azymucie).
 */
function sweepAz(parts, phis, prof, segs, seed) {
  const P = phis.map((phi) => prof(phi));
  const jm = phis.length >> 1;
  const uRows = [0];
  let prev = null;
  phis.forEach((phi, j) => {
    let rr = 0, yy = 0;
    for (const q of P[j]) { rr += q[0]; yy += q[1]; }
    const c = at3(rr / P[j].length, yy / P[j].length, phi);
    if (prev) uRows.push(uRows[j - 1] + c.distanceTo(prev));
    prev = c;
  });
  for (const [i0, i1, kind, z = 0, w = 0] of segs) {
    const rows = phis.map((phi, j) => {
      const r = [];
      for (let i = i0; i <= i1; i++) r.push(at3(P[j][i][0], P[j][i][1], phi));
      return r;
    });
    const a = P[jm][i0], c = P[jm][i1];
    parts.push(gridPart(rows, at3(a[1] - c[1], c[0] - a[0], phis[jm]), kind, seed, z, w, 'all', uRows));
  }
}

/**
 * Bryła przeciągnięta po ścianie w południku φ (żebro, przypora): rzędy w kątach `psis`, przekrój `sec(f)` → [[x, l], …]
 * (x — wzdłuż obwodu [R], l — nad ścianą; obieg od lewej strony w górę, przez czoło, w dół prawej — bryła po prawej),
 * f — 0 u dołu … 1 u góry; `faces` — [k, rodzaj, z, w] ściana między punktami k i k + 1 (osobne pasy); `own` — jak
 * w gridPart (u — po ścianie w górę, v — w przekroju; kadłub — zamienione).
 */
function wallSweep(metal, phi, psis, sec, faces, seed, b, own = 'wall') {
  const n = psis.length;
  const S = psis.map((_, j) => sec(n > 1 ? j / (n - 1) : 0));
  const rows = psis.map((psi, j) => {
    const rho = Math.max(wallRY(phi, psi, 0, b)[0], 0.05);
    return S[j].map(([x, l]) => {
      const ph = phi + x / rho;
      const q = wallRY(ph, psi, l, b);
      return at3(q[0], q[1], ph);
    });
  });
  // droga wzdłuż części po ŚCIANIE (bez uniesienia) — ta sama dla wszystkich ścian przekroju: linie stałego u (szwy,
  // rzędy świateł) przechodzą przez boki, fazy i czoło przypory w jednym miejscu, bez schodków
  const uRows = [0];
  for (let j = 1; j < n; j++) {
    const a = wallRY(phi, psis[j - 1], 0, b), c = wallRY(phi, psis[j], 0, b);
    uRows.push(uRows[j - 1] + Math.hypot(c[0] - a[0], c[1] - a[1]));
  }
  const jm = (n - 1) >> 1, psm = psis[jm];
  const tx = new THREE.Vector3(-Math.sin(phi), 0, -Math.cos(phi));
  const nl = at3(-Math.sin(psm), Math.cos(psm), phi);
  for (const [k, kind, z = 0, w = 0] of faces) {
    const dx = S[jm][k + 1][0] - S[jm][k][0], dl = S[jm][k + 1][1] - S[jm][k][1];
    const out = tx.clone().multiplyScalar(-dl).addScaledVector(nl, dx);
    metal.push(gridPart(rows.map((r) => [r[k], r[k + 1]]), out, kind, seed, z, w, own, uRows));
  }
}

/**
 * Prostopadłościan [x0, x1] × [y0, y1] × [z0, z1] w bazie `m`; `slope` > 0 — obniżenie krawędzi górnej przy x1 (klin),
 * < 0 — podniesienie krawędzi dolnej przy x0 (wspornik trójkątny). STAL — własne uv w [R]: na każdej ścianie u wzdłuż
 * dłuższej krawędzi bryły (szczotkowanie wzdłuż żebra, obejmy, belki — bez ukośnego kreskowania rzutu pudełkowego na
 * częściach skośnych względem ramy); reszta rodzajów — rzut pudełkowy (części współpłaszczyznowe zgodne).
 */
function boxPart(m, x0, x1, y0, y1, z0, z1, kind, seed, z = 0, w = 0, slope = 0) {
  const ext = [x1 - x0, y1 - y0, z1 - z0];
  const g = new THREE.BoxGeometry(ext[0], ext[1], ext[2]);
  if (slope) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (slope > 0 && p.getX(i) > 0 && p.getY(i) > 0) p.setY(i, p.getY(i) - slope);
      if (slope < 0 && p.getX(i) < 0 && p.getY(i) < 0) p.setY(i, p.getY(i) - slope);
    }
    g.computeVertexNormals();
  }
  const own = kind === PART.STRUCT;
  if (own) {
    const p = g.attributes.position, nr = g.attributes.normal, uvA = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const n = [Math.abs(nr.getX(i)), Math.abs(nr.getY(i)), Math.abs(nr.getZ(i))];
      const a = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
      let [ku, kv] = [[1, 2], [0, 2], [0, 1]][a];
      if (ext[kv] > ext[ku]) [ku, kv] = [kv, ku];
      const q = [p.getX(i), p.getY(i), p.getZ(i)];
      uvA.setXY(i, q[ku] + ext[ku] / 2, q[kv] + ext[kv] / 2);
    }
  }
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.applyMatrix4(m);
  const part = finalizePart(g, kind, seed, own ? ownZ(kind, z) : z, w);
  // ŚWIATŁO POZYCYJNE (runda 5): oprawa ze stali na pięciu ścianach, soczewka tylko na ścianie +y bazy (na koronie — w górę,
  // na ścianie — w otwór); pudełko ze świecącym środkiem każdej ściany czytało się za dnia jak kostka do gry
  if (kind === PART.BEACON) {
    const a = part.attributes.aPart;
    for (let i = 0; i < a.count; i++) if ((i >> 2) !== 2) a.setX(i, PART.STRUCT);
  }
  return part;
}

/** Walec o osi Y bazy `m` (podstawa w (x, y0, z), wysokość h). */
function cylPart(m, x, y0, z, r, h, seg, kind, seed, zp = 0, w = 0, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, false);
  g.translate(x, y0 + h / 2, z);
  g.applyMatrix4(m);
  return finalizePart(g, kind, seed, zp, w);
}

/** Rura wzdłuż punktów (Vector3): przepływ, uv.y — droga od źródła 0…1, z — długość [R], w — kierunek impulsów. */
function pipePart(pts, r, seed, closed = false, w = 1) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(len / 0.0025)), r, 8, closed);
  const uvA = g.attributes.uv;
  for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getY(k), uvA.getX(k));
  return finalizePart(g, PART.PIPE, seed, len, w);
}

// ── Przewody: węzły drogi w południku, wiązki z obejmami ───────────────────────────────────────────────────────────

/**
 * Węzeł drogi przewodu → { p, base } ([ρ, y] w południku φ): 'w' — ściana (ψ, lift), 'c' — fasada korony (c, a),
 * 's' — nad gruntem za krawędzią (s, h). `base` — ten sam punkt bez uniesienia (podstawa obejmy).
 */
function evalNode(nd, phi, b) {
  if (nd.k === 'w') return { p: wallRY(phi, nd.psi, nd.lift, b), base: wallRY(phi, nd.psi, 0, b) };
  const R = rimAt(phi, b);
  if (nd.k === 'c') return { p: R.w(nd.c, nd.a), base: R.w(nd.c, 0) };
  return { p: R.s(nd.s, nd.h), base: R.s(nd.s, 0) };
}

/**
 * Wiązka rur wzdłuż węzłów (środek w azymucie phi0, rury przesunięte wzdłuż obwodu o `offs` [R]) z obejmami STRUCT co
 * `every` [R] (obejma od podstawy w ścianie / koronie do wierzchu rur; węzły z `band: false` — bez obejm).
 */
function bundle(metal, flow, nodes, phi0, offs, r, b, seed, every = 0.02) {
  const C = nodes.map((nd) => evalNode(nd, phi0, b));
  offs.forEach((o, k) => {
    const pts = nodes.map((nd, i) => {
      const ph = phi0 + o / Math.max(C[i].p[0], 0.05);
      const e = evalNode(nd, ph, b);
      return at3(e.p[0], e.p[1], ph);
    });
    flow.push(pipePart(pts, r, (seed + k * 0.17) % 1));
  });
  const cp = C.map((e) => at3(e.p[0], e.p[1], phi0));
  const cb = C.map((e) => at3(e.base[0], e.base[1], phi0));
  const cum = [0];
  for (let i = 1; i < cp.length; i++) cum.push(cum[i - 1] + cp[i].distanceTo(cp[i - 1]));
  const total = cum[cum.length - 1];
  const half = (Math.max(...offs) - Math.min(...offs)) / 2 + r + 0.0008;
  const P = new THREE.Vector3(), Bs = new THREE.Vector3(), Y = new THREE.Vector3(), T = new THREE.Vector3(), X = new THREE.Vector3();
  let i = 0;
  for (let s = every * 0.5; s < total - every * 0.25; s += every) {
    while (cum[i + 1] < s) i++;
    if (nodes[i].band === false || nodes[i + 1].band === false) continue;
    const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
    P.lerpVectors(cp[i], cp[i + 1], t);
    Bs.lerpVectors(cb[i], cb[i + 1], t);
    const lift = P.distanceTo(Bs);
    Y.subVectors(P, Bs).normalize();
    T.subVectors(cp[i + 1], cp[i]).normalize();
    X.crossVectors(Y, T).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)).setPosition(P);
    // spód głębiej w ścianie: pod skrajną rurą ściana bywa bliżej o spadek płatów / zębów w poprzek wiązki
    metal.push(boxPart(m, -half, half, -lift - 0.0018, r + 0.0006, -0.0006, 0.0006, PART.STRUCT, (seed + s) % 1));
  }
}

// ── Korona brzegu ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Udział placu kotwicy w azymucie phi (1 — pełny plac, 0 — zwykła korona). */
function plazaAt(L, b, phi) {
  let f = 0;
  const sinTh = Math.sin(earthBiteRimAngle(phi, BITE, b));
  for (const az of L.elevators) {
    const dt = angDist(phi, az * DEG) * sinTh;
    f = Math.max(f, 1 - smooth(L.liningPlazaW, L.liningPlazaW + 0.007, dt));
  }
  return f;
}

/** Fasada: kondygnacje okien [c dolne, c górne] (po ścianie pod krawędzią), od dołu; wnęka okien. */
const STOREYS = [[0.0230, 0.0185], [0.0155, 0.0110], [0.0080, 0.0035]];
const RECESS = 0.0006;

/**
 * Przekrój korony w południku φ (od ściany: fartuch z okładziny, fasada w trzech kondygnacjach, gzyms z podwójną
 * listwą, parapet, pokład, stok w grunt).
 */
function crownProfile(L, b, phi) {
  const R = rimAt(phi, b);
  const D = L.liningCrownDrop, a = L.liningCrownLift, top = L.liningCrownTop, deck = L.liningCrownDeck;
  const k = a + 0.0038;                         // czoło gzymsu
  const sEnd = lerp(L.liningCrownOut - 0.0042, L.liningPlazaOut, plazaAt(L, b, phi));
  const P = [
    R.w(D + 0.0125, -0.0015),                   // 0 w okładzinie
    R.w(D + 0.0120, L.liningClad[2] + 0.0002),  // 1 stopa fartucha (na górnym tarasie okładziny)
    R.w(D + 0.0012, a - 0.0010),                // 2 fartuch — pochyły cokół
    R.w(D, a),                                  // 3 fazka
    R.w(STOREYS[0][0], a)                       // 4 pas cokołu fasady
  ];
  for (const [c0, c1] of STOREYS) P.push(R.w(c0, a - RECESS), R.w(c1, a - RECESS), R.w(c1, a));   // wnęka okien, nadproże
  // płyciny między kondygnacjami są odcinkami między nadprożem a parapetem następnej (punkty 7–8, 10–11)
  P.splice(8, 0, R.w(STOREYS[1][0], a));
  P.splice(12, 0, R.w(STOREYS[2][0], a));
  const g0 = R.w(0.0028, k - 0.0004);           // podsufitka gzymsu
  P.push(g0, R.w(0.0016, k), R.w(0.0009, k), R.w(-0.0003, k), R.w(-0.0010, k), R.w(-0.0028, k), R.w(-0.0036, k - 0.0010));
  const p23 = R.s(-0.0040, top);
  const p22 = P[P.length - 1];
  P.push([lerp(p22[0], p23[0], 0.24), lerp(p22[1], p23[1], 0.24)], p23, R.s(0.0002, top), R.s(0.0007, deck), R.s(sEnd, deck),
    R.s(sEnd + 0.0006, deck - 0.0006), R.s(sEnd + 0.0042, -0.0012));
  return P;
}

function buildCrown(L, b, lay, metal) {
  const dense = L.elevators.map((az) => [az * DEG, 0.042, 0.0036]);
  const phis = azSamples(L.liningCrownSamples, dense);
  const H = PART.HULL, W = PART.WINDOW, S = PART.STRIP;
  // punkty: 0–4 fartuch i cokół, 5–6 okna I, 7–8 płycina, 9–10 okna II, 11–12 płycina, 13–14 okna III, 15 nadproże,
  // 16–22 gzyms (17–18 i 19–20 listwy), 23–26 parapet i pokład, 27–28 listwa na krawędzi pokładu (z gry — zewnętrzny
  // pierścień północnej korony), 28–29 stok
  sweepAz(metal, phis, (phi) => crownProfile(L, b, phi), [
    [0, 1, PART.STRUCT], [1, 2, PART.STRUCT], [2, 3, H], [3, 4, H],
    [4, 5, H], [5, 6, W, 0.85], [6, 7, H], [7, 8, H],
    [8, 9, H], [9, 10, W, 0.8], [10, 11, H], [11, 12, H],
    [12, 13, H], [13, 14, W, 0.85], [14, 15, H],
    [15, 16, H], [16, 17, H], [17, 18, S, 0.4, 1], [18, 19, H], [19, 20, S, 0.4, 1], [20, 21, H], [21, 22, H],
    [22, 23, H], [23, 24, H], [24, 25, H], [25, 26, H], [26, 27, H], [27, 28, S, 0.3, 1], [28, 29, H]
  ], 0.11);
  const a = L.liningCrownLift, D = L.liningCrownDrop;
  // przypory stoku co 2° (poza placami): klin od pokładu w grunt
  for (let i = 0; i < 180; i++) {
    const phi = (i * 2 + 1) * DEG;
    if (plazaAt(L, b, phi) > 0.001) continue;
    const R = rimAt(phi, b);
    const s0 = L.liningCrownOut - 0.0049;
    metal.push(boxPart(rimBasis(R, phi), s0, L.liningCrownOut + 0.0006, -0.0014, L.liningCrownDeck + 0.0006, -0.0009, 0.0009,
      PART.HULL, (i * 0.618) % 1, 0, 0, 0.0034));
  }
  // pilastry fasady w kondygnacjach okien: CIĘŻKIE co 5° (w azymutach podzielnych przez 5°, więc symetrycznie wokół osi
  // bramy i placów), LEKKIE w module 5° wg wzoru modułu (runda 5 — pilastry co 1° cięły pasy okien równo jak perforacja
  // taśmy filmowej): jeden w środku, dwa, cztery albo żaden — przęsła 1–5°; wzór z ziarna odległości modułu od osi bramy
  // (lustro wokół 270°). Przy przyporach głównych — filary (buildButtress), przy pylonach bramy — pylony
  const step = L.liningPilasterStep * 5;
  const LIGHT = [[0.5], [0.3, 0.7], [0.2, 0.4, 0.6, 0.8], [], [0.5], [0.3, 0.7]];
  const m0 = Math.round(L.liningGateAz / step);
  const cTop = STOREYS[2][1], cm = (D + cTop) / 2, hz = (D - cTop) / 2;
  for (let i = 0, n = Math.round(360 / step); i < n; i++) {
    const key = i >= m0 ? i - m0 : m0 - 1 - i;
    const pat = LIGHT[plantRng(9100 + key).next() * LIGHT.length | 0];
    for (const f of [0, ...pat]) {
      const deg = (i + f) * step;
      const phi = deg * DEG;
      if (plazaAt(L, b, phi) > 0.001 || [...lay.prim, ...lay.gate].some((p) => angDist(phi, p) < 0.9 * DEG)) continue;
      const R = rimAt(phi, b);
      const heavy = f === 0;
      const hw = heavy ? 0.0011 : 0.0006;
      metal.push(boxPart(wallBasis(phi, R.psR - cm / R.beR, b), -hw, hw, a - 0.0012, a + (heavy ? 0.0013 : 0.0007), -hz, hz,
        PART.HULL, (deg * 0.618) % 1));
    }
  }
  // posterunki na pokładzie co 15° (nad żebrami): blok z oknami ku otworowi i światłem
  const deck = L.liningCrownDeck;
  for (let i = 0; i < 24; i++) {
    const phi = (i * 15 + 7.5) * DEG;
    if (plazaAt(L, b, phi) > 0.001) continue;
    const m = rimBasis(rimAt(phi, b), phi);
    const seed = (i * 0.377 + 0.1) % 1;
    metal.push(boxPart(m, 0.0012, 0.0052, deck - 0.0005, deck + 0.0030, -0.0038, 0.0038, PART.HULL, seed));
    metal.push(boxPart(m, 0.0020, 0.0046, deck + 0.0030, deck + 0.0044, -0.0024, 0.0016, PART.HULL, seed));
    metal.push(boxPart(m, 0.0009, 0.0013, deck + 0.0010, deck + 0.0022, -0.0033, 0.0033, PART.WINDOW, seed, 0.85));
    metal.push(boxPart(m, 0.0034, 0.0042, deck + 0.0044, deck + 0.0052, 0.0006, 0.0014, PART.BEACON, seed, 0.35, i % 3 ? 0 : 1));
  }
}

/**
 * Okładzina górnego pasa ściany: od galerii-pasa (spód w jej skrzyni) do fartucha fasady, trzy tarasy coraz cieńsze ku
 * górze; uskoki (półki zwrócone w górę) z ciepłą listwą.
 */
/** Zakres okładziny w południku φ: ψ spodu (w galerii-pasie) i ψ wierzchu (pod fartuchem fasady). */
function cladRange(L, b, phi) {
  const R = rimAt(phi, b);
  const yB = beltY(L) + galleryH(L, beltY(L)) / 2 - 0.002;
  return [psiAtHeight(phi, yB, b), R.psR - (L.liningCrownDrop + 0.0116) / R.beR, R];
}

function buildCladding(L, b, lay, metal) {
  const phis = azSamples(L.liningCrownSamples);
  const [l0, l1, l2] = L.liningClad;
  const prof = (phi) => {
    const [psiB, psiT] = cladRange(L, b, phi);
    // uskoki fazowane (~0,0013 R po ścianie) — z gry czytelna kreska, nie migocząca krawędź
    const dt = Math.min(0.08, 0.0013 / Math.max((psiT - psiB) * b, 1e-4));
    const at = (t, lift) => wallRY(phi, lerp(psiB, psiT, t), lift, b);
    return [at(0, -0.0015), at(0, l0), at(0.17, l0), at(0.34, l0), at(0.34 + dt, l1), at(0.5, l1), at(0.66, l1),
      at(0.66 + dt, l2), at(0.83, l2), at(1, l2)];
  };
  const H = PART.HULL;
  sweepAz(metal, phis, prof, [[0, 1, H], [1, 3, H], [3, 4, PART.STRIP, 0.3, 0], [4, 6, H], [6, 7, PART.STRIP, 0.3, 0],
    [7, 9, H]], 0.47);
  // listwy pionowe w osiach cięższych pilastrów fasady (co 5°), poza przyporami i wiązkami przewodów
  const step = L.liningPilasterStep * 5;
  for (let i = 0, n = Math.round(360 / step); i < n; i++) {
    const phi = i * step * DEG;
    if (plazaAt(L, b, phi) > 0.001 || [...lay.prim, ...lay.gate].some((p) => angDist(phi, p) < 1.2 * DEG)) continue;
    const [psiB, psiT] = cladRange(L, b, phi);
    const hl = l0 + 0.0008;
    wallSweep(metal, phi, psiRows(psiB, psiT, b, 0.012), () => [[-0.0009, -0.002], [-0.0009, hl], [0.0009, hl], [0.0009, -0.002]],
      [[0, H], [1, H], [2, H]], (i * 0.37) % 1, b);
  }
}

/** Plac pod kotwicą windy: przyłącze przewodów (skrzynia z listwą) i światła narożne. */
function buildPlaza(L, b, phi, metal, seed) {
  const R = rimAt(phi, b);
  const m = rimBasis(R, phi);
  const deck = L.liningCrownDeck;
  const s1 = L.liningPlazaOut;
  metal.push(boxPart(m, s1 - 0.0024, s1 + 0.0004, deck - 0.0004, deck + 0.0056, -0.0078, 0.0078, PART.HULL, seed));
  metal.push(boxPart(m, s1 - 0.0027, s1 - 0.0022, deck + 0.0040, deck + 0.0050, -0.0072, 0.0072, PART.STRIP, seed, 0.4, 1));
  for (const zc of [-L.liningPlazaW + 0.0012, L.liningPlazaW - 0.0012]) {
    for (const sc of [0.0030, s1 - 0.0010]) {
      metal.push(boxPart(m, sc - 0.0005, sc + 0.0005, deck - 0.0002, deck + 0.0009, zc - 0.0005, zc + 0.0005, PART.BEACON, (seed + sc * 97) % 1, 0.6, sc > 0.005 ? 0 : 1));
    }
  }
  // przejście wiązki przez parapet: siodło pod rurami i brama (słupy, nadproże ze światłami)
  const top = L.liningCrownTop;
  metal.push(boxPart(m, -0.0040, 0.0004, top - 0.0006, top + 0.0013, -0.0064, 0.0064, PART.HULL, seed));
  for (const sg of [-1, 1]) {
    metal.push(boxPart(m, -0.0021, -0.0009, top + 0.0013, top + 0.0062, sg > 0 ? 0.0058 : -0.0068, sg > 0 ? 0.0068 : -0.0058, PART.STRUCT, seed));
    metal.push(boxPart(m, -0.0019, -0.0011, top + 0.0064, top + 0.0072, sg * 0.0063 - 0.0004, sg * 0.0063 + 0.0004, PART.BEACON, (seed + sg * 0.3 + 1) % 1, 0.5, 0));
  }
  metal.push(boxPart(m, -0.0021, -0.0009, top + 0.0054, top + 0.0064, -0.0068, 0.0068, PART.STRUCT, seed));
}

/**
 * Maszt emitera pola — KRATOWNICOWY PYLON (skala megabudowli, nie barierki): cokół na parapecie, trzy pasy zbieżne ku
 * głowicy, pochylone nad otwór, krzyżulce na każdej ścianie (zygzak), dwie KONDYGNACJE — kołnierz z ciepłym pasem świateł,
 * w osi chłodna SZYNA ENERGII do głowicy (fala biegnie ku głowicy; z gry — kreska do głowicy na tle kosmosu), odciąg do
 * pokładu, światło pozycyjne na górnej kondygnacji (co drugi maszt). Głowica — cewka (emitterHead).
 */
function buildMast(L, b, phi, k, n, rng, metal) {
  const m = rimBasis(rimAt(phi, b), phi);
  const seed = k / n;
  const P = (s, h, z = 0) => new THREE.Vector3(s, h, z).applyMatrix4(m);
  const St = PART.STRUCT;
  // cokół: dwa stopnie na parapecie i pokładzie
  metal.push(boxPart(m, -0.0016, 0.0048, 0.0016, 0.0060, -0.0028, 0.0028, PART.HULL, seed));
  metal.push(boxPart(m, -0.0010, 0.0038, 0.0060, 0.0074, -0.0022, 0.0022, PART.HULL, seed));
  const tilt = (L.liningMastTilt + rng.range(-2.5, 2.5)) * DEG;
  const len = L.liningMastLen * rng.range(0.94, 1.06);
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  const s0 = 0.0014, h0 = 0.0074;
  // oś (s, h) = (−sin, cos) · t · len; przekrój — trójkąt: e wzdłuż (cos, sin) w płaszczyźnie południka, z — po obwodzie;
  // pas 0 od strony otworu, pasy 1 i 2 z tyłu (symetrycznie po obwodzie)
  const rr = (t) => lerp(0.0024, 0.0011, t);
  const loc = (t, e = 0, z = 0) => [s0 - st * len * t + ct * e, h0 + ct * len * t + st * e, z];
  const pt = (t, e = 0, z = 0) => P(...loc(t, e, z));
  const leg = (j, t) => {
    const a = Math.PI + (j * TAU) / 3, r = rr(t);
    return pt(t, Math.cos(a) * r, Math.sin(a) * r);
  };
  for (let j = 0; j < 3; j++) metal.push(rodPart(leg(j, 0), leg(j, 1), 0.0003, 3, St, seed));
  const lv = [0, 1 / 3, 2 / 3, 1];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const [a, c] = i % 2 ? [leg(j1, lv[i]), leg(j, lv[i + 1])] : [leg(j, lv[i]), leg(j1, lv[i + 1])];
      metal.push(rodPart(a, c, 0.00016, 3, St, (seed + i * 0.1) % 1));
    }
  }
  // kondygnacje: kołnierz (sześciobok) i ciepły pas świateł pod nim (rurka listwy biegnie dookoła — u po obwodzie)
  const ax = pt(1).sub(pt(0)).normalize();
  for (const t of [1 / 3, 2 / 3]) {
    const r = rr(t) + 0.00025, c = pt(t);
    metal.push(finalizePart(cylinderBetween(c.clone().addScaledVector(ax, -0.00025), c.clone().addScaledVector(ax, 0.00025), r, 6, false),
      PART.HULL, seed));
    const g = cylinderBetween(c.clone().addScaledVector(ax, -0.0009), c.clone().addScaledVector(ax, -0.00025), r - 0.0001, 6, true);
    const uvA = g.attributes.uv, circ = TAU * r;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * circ, uvA.getY(i) * 0.0007);
    metal.push(finalizePart(g, PART.STRIP, seed, ownZ(PART.STRIP, 0.45), 0));
  }
  // szyna energii w osi, odciąg (od pokładu za cokołem do tylnej ściany kratownicy)
  metal.push(rodPart(pt(0.03), pt(0.93), 0.00028, 4, PART.STRIP, seed, 0.35, 1));
  metal.push(rodPart(P(0.0062, L.liningCrownDeck - 0.0006), pt(0.62, rr(0.62) * 0.5), 0.00035, 3, St, seed));
  if (k % 2 === 0) {
    const [bs, bh] = loc(2 / 3, -rr(2 / 3) - 0.0006);
    metal.push(boxPart(m, bs - 0.0005, bs + 0.0005, bh - 0.0005, bh + 0.0005, -0.0005, 0.0005, PART.BEACON, seed, 0.45,
      (k >> 1) % 3 === 0 ? 1 : 0));
  }
  return emitterHead(metal, pt(1), ax, 1, seed, 0.5);
}

/**
 * Głowica emitera pola na końcu ramienia T (kierunek dir), skala k — CEWKA: obudowa rozszerzona ku czołu, wokół niej
 * pierścień toroidalny z uzwojeniem (listwa chłodna po własnym uv: u — wokół rurki, v — po obwodzie pierścienia, więc
 * rurki świetlne to zwoje; z daleka równa cyjanowa obręcz), na czole mała okrągła SOCZEWKA (kopułka listwy chłodnej
 * o stałym uv — bez wzoru i bez glifu; jasność z per wierzchołek: jasny środek, ciemniejszy brzeg). Zwraca środek
 * pierścienia (końce cięciw pola).
 */
function emitterHead(metal, T, dir, k, seed, ring) {
  const T0 = T.clone().addScaledVector(dir, -0.0026 * k), T1 = T.clone().addScaledVector(dir, 0.0002 * k);
  metal.push(finalizePart(cylinderBetween(T0, T1, 0.0011 * k, 8, false, 0.0017 * k), PART.HULL, seed));
  const ax = new THREE.Vector3(0, 1, 0).cross(dir);
  if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0);
  ax.normalize();
  const ay = new THREE.Vector3().crossVectors(dir, ax);
  const C = T.clone().addScaledVector(dir, -0.0011 * k);
  const R0 = 0.0024 * k, r0 = 0.0006 * k;
  const torus = new THREE.TorusGeometry(R0, r0, 5, 14);
  const tuv = torus.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getY(i) * TAU * r0, tuv.getX(i) * TAU * R0);
  torus.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, dir).setPosition(C));
  metal.push(finalizePart(torus, PART.STRIP, seed, ownZ(PART.STRIP, ring), 1));
  // soczewka: czapa kuli (57°) wystająca ~0,45 promienia przed czoło obudowy; uv stałe — środek rurki listwy (v), środek
  // segmentu (u po przesunięciu wg ziarna, jak w materiale), więc bez rurek i podziałów — sama jasność z
  const rl = 0.0008 * k, cap = 1.0;
  const dome = new THREE.SphereGeometry(rl, 10, 3, 0, TAU, 0, cap);
  const p = dome.attributes.position, duv = dome.attributes.uv;
  const zs = new Float32Array(p.count);
  const off = (((seed * 3.71) % 1) * 0.0293) % 0.0025;
  for (let i = 0; i < p.count; i++) {
    zs[i] = -lerp(0.3, 1.1, smooth(Math.cos(cap), 1, p.getY(i) / rl));
    duv.setXY(i, 0.00125 - off, 0.00035);
  }
  dome.applyMatrix4(new THREE.Matrix4().makeBasis(ax, dir, ay.clone().negate()).setPosition(T1.clone().addScaledVector(dir, -rl * 0.55)));
  metal.push(finalizePart(dome, PART.STRIP, seed, (i) => zs[i], 1));
  return C;
}

/**
 * Cięciwa pola między głowicami A i B (skale ka, kb), j — numer cięciwy na łuku: CIĄGŁY, bardzo słaby ŁUK energii
 * (nie linia pomocnicza z kresek) — cienka rurka listwy chłodnej od obręczy głowicy do obręczy sąsiedniej, wygięta ku
 * górze (parabola, `liningChordBow` × długość) i zwężona ku środkowi; jasność z per wierzchołek: przy głowicach
 * `liningChordGlow`, ku środkowi gaśnie do × `liningChordMid` (pole wychodzi z emiterów). Droga u całej cięciwy mieści
 * się w JEDNYM segmencie listwy (środek segmentu po przesunięciu wg ziarna — jak soczewka głowicy), więc materiał nie
 * rysuje na niej poprzecznych szwów (z bliska znów byłyby kreski); fala przepływu listwy chłodnej (sin u, okres 0,012)
 * daje wtedy „oddech” całej cięciwy, a numer segmentu rośnie o 1 z każdą cięciwą (faza +0,21) — grzbiety fali obiegają
 * koronę jak wędrujące impulsy pola. Najniższy poziom hierarchii kadru gry (promień > liny wind > korona i maszty >
 * cięciwy).
 */
function fieldChord(metal, A, B, ka, kb, seed, j, L) {
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length();
  d.divideScalar(len);
  // początek i koniec na obręczy cewki głowicy (promień obręczy 0,0024 k, rurka 0,0006 k) — łuk z niej wyrasta
  const t0 = 0.0027 * ka, t1 = len - 0.0027 * kb;
  if (t1 - t0 < 0.006) return;
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y);
  if (up.lengthSq() < 1e-8) up.set(1, 0, 0);
  up.normalize();
  const span = t1 - t0, bow = L.liningChordBow * span;
  const N = Math.max(10, Math.ceil(span / 0.003)), S = 6;
  const r0 = L.liningChordR, circ = TAU * r0;
  // droga u: środek segmentu listwy nr j + 12 (materiał dodaje przesunięcie ziarna off ≤ 0,0293 < 12 segmentów —
  // u zostaje dodatnie), ±0,0005 wzdłuż cięciwy
  const off = ((Math.fround(seed) * 3.71) % 1) * 0.0293;
  const uc = 0.00125 + 0.0025 * (j + 12) - off;
  const pos = new Float32Array((N + 1) * (S + 1) * 3), nrm = new Float32Array(pos.length);
  const uvs = new Float32Array((N + 1) * (S + 1) * 2), zs = new Float32Array((N + 1) * (S + 1));
  const P = new THREE.Vector3(), T = new THREE.Vector3(), nu = new THREE.Vector3(), ns = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N, f = Math.abs(2 * t - 1);
    // parabola ku górze: punkt i styczna
    P.copy(A).addScaledVector(d, t0 + span * t).addScaledVector(up, bow * 4 * t * (1 - t));
    T.copy(d).multiplyScalar(span).addScaledVector(up, bow * 4 * (1 - 2 * t)).normalize();
    nu.copy(up).addScaledVector(T, -up.dot(T)).normalize();
    ns.crossVectors(T, nu);
    const r = r0 * lerp(0.6, 1, f);
    const zi = -L.liningChordGlow * lerp(L.liningChordMid, 1, f * f);
    for (let k = 0; k <= S; k++) {
      const a = (k / S) * TAU, c = Math.cos(a), s = Math.sin(a);
      const v = i * (S + 1) + k;
      const nx = nu.x * c + ns.x * s, ny = nu.y * c + ns.y * s, nz = nu.z * c + ns.z * s;
      pos[v * 3] = P.x + nx * r; pos[v * 3 + 1] = P.y + ny * r; pos[v * 3 + 2] = P.z + nz * r;
      nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;
      uvs[v * 2] = uc + (t - 0.5) * 0.001;
      uvs[v * 2 + 1] = (k / S) * circ;
      zs[v] = zi;
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < S; k++) {
      const a = i * (S + 1) + k, b = a + S + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);   // na zewnątrz: (pierścień + 1) × (wzdłuż) = +promieniowy
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  metal.push(finalizePart(g, PART.STRIP, seed, (i) => zs[i], 1));
}

// ── Brama promienia ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * BRAMA PROMIENIA na osi promienia w kadrze gry (południk gryzu z kierunkiem kamery gry — południowa ściana): dwa SMUKŁE
 * PYLONY w azymutach gateAz ± half (osie żeber wtórnych) od pierścienia stopy (but, stopa na pasie osłon) po ścianie
 * i przed fasadą nad krawędź, gdzie przechodzą w WIEŻE (podstawa w pokładzie korony, trzon, gzyms, taras z głowicą
 * emitera pola — większą niż na masztach); wieże spina cienkie NADPROŻE z jedną chłodną listwą i czterema cewkami przy
 * wieżach (środek wolny — tam promień). Na czole pylonów RYNNA z przewodem energii (impulsy w górę, od pierścienia stopy
 * do głowic), po bokach czoła światła parami (te same ziarna po obu stronach — błyskają razem), galerie dochodzą do
 * pylonów przyczółkami. Z kamery gry pylony biegną równolegle do promienia po obu jego stronach, szerzej niż pierścienie
 * zamknięcia (żaden pierścień nie rzutuje się w pylon — bez „beczki”), a wieże z nadprożem stoją na dalszej krawędzi
 * wcięcia: promień ze stosem pierścieni wychodzi z otworu przez portal. Zwraca [[azymut, środek głowicy], …].
 */
function buildGate(L, b, lay, metal, flow) {
  if (lay.gateAz === null) return [];
  const H = PART.HULL, St = PART.STRUCT;
  const Ht = L.liningGateTower;
  const cw = 0.0011, cd = 0.0010, rp = 0.0007;      // rynna na czole: półszerokość, głębokość; promień przewodu
  const dim = (f) => ({
    wf: lerp(0.0085, 0.0070, f), wb: lerp(0.0066, 0.0054, f), wt: lerp(0.0044, 0.0036, f),
    l1: lerp(0.0045, 0.0038, f), hl: lerp(0.0120, 0.0100, f)
  });
  const seedL = 0.731;                               // światła: wspólne ziarno obu pylonów
  const heads = [];
  const lintel = [];
  lay.gate.forEach((phi, gi) => {
    const sg = gi ? 1 : -1;                          // strona osi: −1 — mniejszy azymut
    const seed = 0.71 + gi * 0.07;
    const R = rimAt(phi, b);
    const psiF = footPsi(L, b, phi);
    const psiBot = psiF + 0.0058 / b, psiTop = R.psR;
    const sec = (f) => {
      const { wf, wb, wt, l1, hl } = dim(f);
      return [[-wf, -0.003], [-wf, 0.0008], [-wb, 0.0010], [-wb, l1], [-wt, hl], [-cw, hl], [-cw, hl - cd], [cw, hl - cd],
        [cw, hl], [wt, hl], [wb, l1], [wb, 0.0010], [wf, 0.0008], [wf, -0.003]];
    };
    wallSweep(metal, phi, psiRows(psiBot, psiTop, b, 0.006), sec, [[0, St], [1, St], [2, H], [3, H], [4, H], [5, H],
      [6, PART.STRIP, 0.3, 1], [7, H], [8, H], [9, H], [10, H], [11, St], [12, St]], seed, b);
    footShoe(L, b, phi, 0.0100, dim(0).hl - 0.0010, true, seed, metal);
    // cienka chłodna listwa na zewnętrznym narożu czoła (od osi bramy): z gry — linia obrysu bramy wzdłuż promienia
    const edge = (f) => {
      const { wt, hl } = dim(f), x0 = sg * (wt - 0.0006), x1 = sg * (wt + 0.0001);
      return sg > 0 ? [[x0, hl - 0.0002], [x0, hl + 0.0003], [x1, hl + 0.0003], [x1, hl - 0.0002]]
        : [[x1, hl - 0.0002], [x1, hl + 0.0003], [x0, hl + 0.0003], [x0, hl - 0.0002]];
    };
    wallSweep(metal, phi, psiRows(psiBot + 0.004 / b, psiTop, b, 0.012), edge, [[0, PART.STRIP, 0.3, 1], [1, PART.STRIP, 0.3, 1],
      [2, PART.STRIP, 0.3, 1]], seed, b);
    // wieża nad krawędzią: baza ściany w krawędzi (Z — po ścianie w górę, przedłużenie nad krawędź; Y — w otwór)
    const m = wallBasis(phi, R.psR, b);
    const { wb, wt, hl } = dim(1);
    const yf = hl - cd;
    metal.push(boxPart(m, sg > 0 ? wt - 0.0006 : -wt - 0.0001, sg > 0 ? wt + 0.0001 : -wt + 0.0006, hl - 0.0002, hl + 0.0003,
      -0.0060, Ht - 0.0002, PART.STRIP, seed, 0.3, 1));
    metal.push(boxPart(m, -wb - 0.0010, wb + 0.0010, -0.0130, yf - 0.0026, -0.0150, 0.0090, H, seed));       // podstawa
    metal.push(boxPart(m, -wt, wt, -0.0110, yf, -0.0060, Ht, H, seed));                                       // trzon
    for (const s of [-1, 1]) {                                                                                  // ościeża rynny
      metal.push(boxPart(m, s > 0 ? cw : -wt, s > 0 ? wt : -cw, yf - 0.0002, hl, -0.0060, Ht - 0.0014, H, seed));
    }
    metal.push(boxPart(m, -wt - 0.0010, wt + 0.0010, -0.0120, hl + 0.0008, Ht, Ht + 0.0020, H, seed));       // gzyms
    metal.push(boxPart(m, -wt - 0.0012, wt + 0.0012, hl + 0.0001, hl + 0.0008, Ht + 0.0004, Ht + 0.0010, PART.STRIP, seed, 0.35, 1));
    metal.push(boxPart(m, -wt + 0.0008, wt - 0.0008, -0.0094, hl - 0.0014, Ht + 0.0020, Ht + 0.0036, St, seed)); // taras
    // światła: czerwone parami na narożach gzymsu (białe w osi bramy), wzdłuż czoła co ~0,03 R
    metal.push(boxPart(m, sg * (wt + 0.0005) - 0.0005, sg * (wt + 0.0005) + 0.0005, hl - 0.0004, hl + 0.0006, Ht + 0.0020, Ht + 0.0030, PART.BEACON, seedL, 0.35, 0));
    metal.push(boxPart(m, -sg * (wt + 0.0005) - 0.0005, -sg * (wt + 0.0005) + 0.0005, hl - 0.0004, hl + 0.0006, Ht + 0.0020, Ht + 0.0030, PART.BEACON, seedL + 0.5, 0.35, 1));
    const nL = Math.floor(((psiTop - psiBot) * b) / 0.03);
    for (let i = 1; i < nL; i++) {
      const psi = lerp(psiBot, psiTop, i / nL);
      const d = dim(i / nL);
      const mw = wallBasis(phi, psi, b);
      for (const s of [-1, 1]) {
        const x = s * (d.wt - 0.0014);
        metal.push(boxPart(mw, x - 0.0004, x + 0.0004, d.hl - 0.0002, d.hl + 0.0006, -0.0004, 0.0004, PART.BEACON,
          (seedL + i * 0.13 + (s === sg ? 0.5 : 0)) % 1, 0.4, i % 3 === 0 ? 1 : 0));
      }
    }
    // przewód energii w rynnie: od pierścienia stopy po ścianie, przez krawędź po czole wieży do tarasu
    const pts = psiRows(psiF + 0.002 / b, psiTop - 0.001 / b, b, 0.01).map((psi) => {
      const f = clamp01((psi - psiBot) / (psiTop - psiBot));
      const q = wallRY(phi, psi, dim(f).hl - cd + rp + 0.0001, b);
      return at3(q[0], q[1], phi);
    });
    for (const c of [0.006, 0.012, 0.018, Ht - 0.0020]) pts.push(new THREE.Vector3(0, yf + rp + 0.0001, c).applyMatrix4(m));
    flow.push(pipePart(pts, rp, (0.37 + gi * 0.5) % 1, false, 1));
    // przyczółki galerii po bokach pylonu (obejmują pylon na wysokości galerii)
    for (const yc of L.liningGalleries) {
      const pr = galleryProfile(L, b, phi, yc);
      const Hg = galleryH(L, yc), m2 = cylBasis(phi);
      const wg = dim(clamp01((psiAtHeight(phi, yc, b) - psiBot) / (psiTop - psiBot))).wf;
      for (const s of [-1, 1]) {
        const z0 = s > 0 ? wg - 0.0010 : -wg - 0.0030, z1 = s > 0 ? wg + 0.0030 : -wg + 0.0010;
        metal.push(boxPart(m2, pr[2][0] - 0.0010, pr[0][0], yc - Hg / 2 - 0.0018, yc + Hg / 2 + 0.0018, z0, z1, H, seed));
      }
    }
    // głowica emitera na tarasie: krótkie ramię pochylone nad otwór, głowica 1,6 × masztowej (pierścień jaśniejszy)
    const F = new THREE.Vector3(0, (yf - 0.0094) / 2, Ht + 0.0034).applyMatrix4(m);
    const up = at3(Math.cos(R.psR), Math.sin(R.psR), phi), inw = at3(-Math.sin(R.psR), Math.cos(R.psR), phi);
    const dir = up.clone().multiplyScalar(Math.cos(40 * DEG)).addScaledVector(inw, Math.sin(40 * DEG)).normalize();
    const T = F.clone().addScaledVector(dir, 0.0100);
    metal.push(rodPart(F, T, 0.0018, 6, PART.STRUCT, seed, 0, 0, 0, 0.0012));
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(-Math.sin(phi), 0, -Math.cos(phi)).multiplyScalar(s * 0.0020);
      metal.push(rodPart(F.clone().add(off), T.clone().addScaledVector(dir, -0.002).addScaledVector(off, 0.5),
        0.0003, 4, PART.STRIP, seed, 0.35, 1));
    }
    heads.push([phi, emitterHead(metal, T, dir, 1.6, seed, 0.7), 1.6]);
    lintel.push(new THREE.Vector3(0, (yf - 0.0090) / 2, Ht - 0.0030).applyMatrix4(m));
  });
  // NADPROŻE między wieżami (pod gzymsami): smukła belka, na czole jedna cienka chłodna listwa i po dwie cewki przy
  // każdej wieży (środek — tam promień — wolny)
  const [A, B] = lintel;
  const X = new THREE.Vector3().subVectors(B, A);
  const len = X.length();
  X.normalize();
  const Rg = rimAt(lay.gateAz, b);
  const Y = at3(Math.cos(Rg.psR), Math.sin(Rg.psR), lay.gateAz);
  Y.addScaledVector(X, -Y.dot(X)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);           // ku skale (od otworu)
  const ml = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(A);
  const dz = (dim(1).hl - cd + 0.0090) / 2;                  // pół-głębokość belki
  metal.push(boxPart(ml, 0, len, -0.0017, 0.0017, -dz, dz, H, 0.77));
  metal.push(boxPart(ml, 0.003, len - 0.003, -0.00022, 0.00022, -dz - 0.0003, -dz + 0.0002, PART.STRIP, 0.77, 0.35, 1));
  for (let i = 0; i < 4; i++) {
    const t = i < 2 ? 0.07 + i * 0.07 : 0.93 - (3 - i) * 0.07;
    metal.push(boxPart(ml, len * (t - 0.025), len * (t + 0.025), -0.0011, 0.0011, -dz - 0.0005, -dz + 0.0002, PART.COIL, 0.77,
      i < 2 ? i / 4 : (3 - i) / 4, 0.3));
  }
  return heads;
}

// ── Ściany: przypory, żebra, galerie ───────────────────────────────────────────────────────────────────────────────

/** Kąty ψ rzędów od psiBot do psiTop co ~`step` [R] po ścianie. */
function psiRows(psiBot, psiTop, b, step) {
  const n = Math.max(2, Math.ceil(((psiTop - psiBot) * b) / step));
  const out = [];
  for (let j = 0; j <= n; j++) out.push(lerp(psiBot, psiTop, j / n));
  return out;
}

/** ψ stopy ściany (pierścień przewodów) i krok ψ na długość d po ścianie przy stopie. */
const footPsi = (L, b, phi) => psiAtHeight(phi, L.footH, b);

/**
 * But na pierścieniu stopy (obejmuje dwie rury pierścienia — po ścianie −0,0055 … +0,0068 od stopy) i opcjonalnie stopa
 * na pasie osłon cieplnych (od dołu pierścienia do dołu osłon).
 */
function footShoe(L, b, phi, hw, hl, toe, seed, metal) {
  const psiF = footPsi(L, b, phi);
  const be = earthBiteRadius(phi, psiF, BITE, b);
  metal.push(boxPart(wallBasis(phi, psiF, b), -hw, hw, -0.0020, hl, -0.0055, 0.0068, PART.HULL, seed));
  // obejma: listwa stali w poprzek buta (nad rurami)
  metal.push(boxPart(wallBasis(phi, psiF, b), -hw - 0.0004, hw + 0.0004, hl - 0.0012, hl + 0.0005, -0.0012, 0.0012, PART.STRUCT, seed));
  if (!toe || !footBandOk(L, b, phi)) return;
  const p0 = psiAtHeight(phi, L.footH - 0.0036, b), p1 = psiAtHeight(phi, L.footH - 0.0160, b);
  const pm = (p0 + p1) / 2, span = (p0 - p1) * be;
  metal.push(boxPart(wallBasis(phi, pm, b), -hw + 0.0012, hw - 0.0012, -0.0020, 0.0060, -span / 2, span / 2 + 0.0004, PART.HULL, seed, 0, 0));
}

/**
 * Przypora główna: stopniowany przekrój (kołnierz wpuszczony w skałę, korpus, fazy, czoło), szersza i głębsza u dołu;
 * od fartucha fasady (u góry — filar przez kondygnacje okien do gzymsu) do pierścienia stopy (but i stopa na pasie osłon).
 * Na czole przewód energii (impulsy w górę, ku koronie) i światła pozycyjne po bokach.
 */
function buildButtress(L, b, phi, seed, metal, flow) {
  const R = rimAt(phi, b);
  const D = L.liningCrownDrop, a = L.liningCrownLift;
  const psiF = footPsi(L, b, phi);
  const psiBot = psiF + 0.0058 / b;
  const psiTop = R.psR - (D + 0.004) / R.beR;
  const psis = psiRows(psiBot, psiTop, b, 0.0065);
  const dim = (f) => ({
    wf: lerp(0.0130, 0.0100, f), wb: lerp(0.0100, 0.0076, f), wt: lerp(0.0050, 0.0038, f),
    l1: lerp(0.0050, 0.0042, f), hl: lerp(0.0110, 0.0086, f)
  });
  const sec = (f) => {
    const { wf, wb, wt, l1, hl } = dim(f);
    return [[-wf, -0.003], [-wf, 0.0008], [-wb, 0.0010], [-wb, l1], [-wt, hl], [wt, hl], [wb, l1], [wb, 0.0010], [wf, 0.0008], [wf, -0.003]];
  };
  const H = PART.HULL, St = PART.STRUCT;
  wallSweep(metal, phi, psis, sec, [[0, St], [1, St], [2, H], [3, H], [4, H], [5, H], [6, H], [7, St], [8, St]], seed, b);
  // PAS OKŁADZINY wzdłuż przypory (środkowy i dolny pas ściany to nie krata na gołej skale): czarne panele po obu stronach
  // od galerii-pasa do buta, fazowane krawędzie, próg u dołu; w przęsłach między galeriami po obu stronach przypory
  // kolumny okien („fasady” wpuszczone w okładzinę — kondygnacje poziomo, rzut pudełkowy)
  const Wb = L.liningPanelBand;
  const psiPA = psiF + 0.012 / b, psiPB = psiAtHeight(phi, beltY(L) - galleryH(L, beltY(L)) / 2 + 0.002, b);
  wallSweep(metal, phi, psiRows(psiPA, psiPB, b, 0.016), () => [[-Wb, -0.003], [-Wb, 0.0006], [-Wb + 0.0010, 0.0014],
    [Wb - 0.0010, 0.0014], [Wb, 0.0006], [Wb, -0.003]], [[0, St], [1, H], [2, H], [3, H], [4, St]], (seed + 0.31) % 1, b);
  metal.push(boxPart(wallBasis(phi, psiPA, b), -Wb - 0.0004, Wb + 0.0004, -0.0010, 0.0020, -0.0010, 0.0006, St, seed));
  const spans = [L.footH + 0.012, ...L.liningGalleries.flatMap((yc) => [yc - galleryH(L, yc) / 2, yc + galleryH(L, yc) / 2])];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const y0 = spans[i] + 0.006, y1 = Math.min(spans[i + 1], beltY(L)) - 0.006;
    if (y1 - y0 < 0.02) continue;
    const ym = (y0 + y1) / 2, hh = (y1 - y0) * 0.32;
    const pw = psiRows(psiAtHeight(phi, ym - hh, b), psiAtHeight(phi, ym + hh, b), b, 0.008);
    for (const s of [-1, 1]) {
      const xa = s * 0.0150, xb = s * (Wb - 0.0030);
      const [x0, x1] = s > 0 ? [xa, xb] : [xb, xa];
      wallSweep(metal, phi, pw, () => [[x0, 0.0016], [x1, 0.0016]], [[0, PART.WINDOW, 0.6]], (seed + i * 0.17 + s) % 1, b, 'none');
    }
  }
  // filar fasady: od fartucha przez kondygnacje okien do podsufitki gzymsu
  const cA = D + 0.0045, cB = 0.0010, cm = (cA + cB) / 2;
  const mP = wallBasis(phi, R.psR - cm / R.beR, b);
  metal.push(boxPart(mP, -0.0050, 0.0050, a - 0.0020, a + 0.0040, -(cA - cB) / 2, (cA - cB) / 2, H, seed));
  metal.push(boxPart(mP, -0.0030, 0.0030, a + 0.0040, a + 0.0047, -(cA - cB) / 2, (cA - cB) / 2 - 0.0012, St, seed));
  // przewód energii na czole: od buta do filara
  const rp = 0.0008;
  const pts = psiRows(psiF + 0.002 / b, psiTop - 0.002 / b, b, 0.01).map((psi) => {
    const f = clamp01((psi - psiBot) / (psiTop - psiBot));
    const q = wallRY(phi, psi, dim(f).hl + rp + 0.00015, b);
    return at3(q[0], q[1], phi);
  });
  flow.push(pipePart(pts, rp, (seed * 3.7) % 1, false, 1));
  // światła po bokach czoła co ~0,03 R (co trzecie białe)
  const nL = Math.floor(((psiTop - psiBot) * b) / 0.03);
  for (let i = 1; i < nL; i++) {
    const psi = lerp(psiBot, psiTop, i / nL);
    const { wt, hl } = dim(i / nL);
    const m = wallBasis(phi, psi, b);
    for (const sg of [-1, 1]) {
      metal.push(boxPart(m, sg * (wt - 0.0009) - 0.0004, sg * (wt - 0.0009) + 0.0004, hl - 0.0002, hl + 0.0006, -0.0004, 0.0004,
        PART.BEACON, (seed + i * 0.13 + (sg > 0 ? 0.5 : 0)) % 1, 0.4, i % 3 === 0 ? 1 : 0));
    }
  }
  footShoe(L, b, phi, 0.0140, 0.0110, true, seed, metal);
}

/** Żebro wtórne: od spodu galerii-pasa do pierścienia stopy (kołnierz w skale, fazy, czoło); u dołu obejma na pierścieniu. */
function buildRib(L, b, phi, seed, metal) {
  const psiF = footPsi(L, b, phi);
  const psiBot = psiF + 0.0058 / b;
  const yB = beltY(L) - galleryH(L, beltY(L)) / 2 + 0.003;
  const psis = psiRows(psiBot, psiAtHeight(phi, yB, b), b, 0.01);
  const sec = (f) => {
    const wf = lerp(0.0026, 0.0020, f), wb = lerp(0.0017, 0.0013, f), wt = lerp(0.0009, 0.0007, f), hl = lerp(0.0024, 0.0019, f);
    return [[-wf, -0.003], [-wf, 0.0006], [-wb, 0.0008], [-wt, hl], [wt, hl], [wb, 0.0008], [wf, 0.0006], [wf, -0.003]];
  };
  const St = PART.STRUCT;
  wallSweep(metal, phi, psis, sec, [[0, St], [1, St], [2, St], [3, St], [4, St], [5, St], [6, St]], seed, b);
  footShoe(L, b, phi, 0.0034, 0.0056, false, seed, metal);
}

/** Przekrój galerii na wysokości yc w południku φ (od tyłu w ścianie: spód, czoło z wnęką okien i listwą, pokład). */
function galleryProfile(L, b, phi, yc) {
  const H = galleryH(L, yc), yb = yc - H / 2, yt = yc + H / 2;
  const back = wallRhoAt(phi, yt, b) + 0.0015;
  const f = wallRhoAt(phi, yc, b) - L.liningGalleryD;
  return [[back, yb], [f + 0.0016, yb], [f, yb + 0.0016], [f, yb + 0.0050], [f + 0.0005, yb + 0.0052], [f + 0.0005, yb + 0.0100],
    [f, yb + 0.0102], [f, yt - 0.0028], [f, yt - 0.0021], [f, yt - 0.0016], [f + 0.0016, yt], [back, yt]];
}

function buildGalleries(L, b, lay, metal) {
  const phis = azSamples(448), phisA = azSamples(224);
  const H = PART.HULL;
  L.liningGalleries.forEach((yc, gi) => {
    const seed = 0.3 + gi * 0.21;
    sweepAz(metal, phis, (phi) => galleryProfile(L, b, phi, yc), [
      [0, 1, H], [1, 2, H], [2, 3, H], [3, 4, H], [4, 5, PART.WINDOW, 0.85], [5, 6, H], [6, 7, H],
      [7, 8, PART.STRIP, 0.35, 1], [8, 9, H], [9, 10, H], [10, 11, H]
    ], seed);
    const Hg = galleryH(L, yc), yb = yc - Hg / 2, yt = yc + Hg / 2;
    // węzły na skrzyżowaniach z żebrami wtórnymi
    for (const phi of lay.sec) {
      const pr = galleryProfile(L, b, phi, yc);
      metal.push(boxPart(cylBasis(phi), pr[2][0] - 0.0012, pr[0][0] + 0.001, yb - 0.0018, yt + 0.0018, -0.0034, 0.0034, H, (seed + phi) % 1));
    }
    // dyspozytornie na skrzyżowaniach z przyporami głównymi: blok z oknami ku osi, nadbudówka, światło
    lay.prim.forEach((phi, i) => {
      const pr = galleryProfile(L, b, phi, yc);
      const f = pr[2][0], m = cylBasis(phi);
      const sdp = (seed + i * 0.083) % 1;
      metal.push(boxPart(m, f - 0.0014, pr[0][0], yb - 0.0024, yt + 0.0024, -0.0092, 0.0092, H, sdp));
      metal.push(boxPart(m, f + 0.0010, f + 0.0078, yt + 0.0024, yt + 0.0062, -0.0062, 0.0062, H, sdp));
      metal.push(boxPart(m, f + 0.0007, f + 0.0012, yt + 0.0034, yt + 0.0054, -0.0056, 0.0056, PART.WINDOW, sdp, 0.85));
      metal.push(boxPart(m, f + 0.0030, f + 0.0068, yt + 0.0062, yt + 0.0078, -0.0034, 0.0022, H, sdp));
      metal.push(boxPart(m, f + 0.0040, f + 0.0048, yt + 0.0078, yt + 0.0086, 0.0010, 0.0018, PART.BEACON, sdp, 0.3, (i + gi) % 2));
    });
    // moduły na czole co 3,75° (poza węzłami i przewodami): kapsuły okien wysunięte z czoła albo żaluzje
    const rng = plantRng(0x6a11 + gi * 7);
    const near = (phi, list, arc, rho) => list.some((a) => angDist(phi, a) * rho < arc);
    for (let i = 0; i < 96; i++) {
      const phi = ((i + 0.5) / 96) * TAU;
      const type = rng.next();
      const rho = wallRhoAt(phi, yc, b);
      if (near(phi, lay.sec, 0.009, rho) || near(phi, lay.prim, 0.014, rho) || near(phi, lay.main, 0.012, rho)
        || near(phi, lay.side, 0.042, rho) || near(phi, lay.gate, 0.014, rho)) continue;
      const pr = galleryProfile(L, b, phi, yc);
      const f = pr[2][0], m = cylBasis(phi), sd = (seed + i * 0.031) % 1;
      if (type < 0.45) {
        const hw = 0.0036 + 0.0016 * rng.next();
        metal.push(boxPart(m, f - 0.0024, f + 0.0010, yb + 0.0034, yb + 0.0118, -hw, hw, H, sd));
        metal.push(boxPart(m, f - 0.0026, f - 0.0020, yb + 0.0058, yb + 0.0094, -hw + 0.0008, hw - 0.0008, PART.WINDOW, sd, 0.85));
      } else if (type < 0.75) {
        for (let s = -2; s <= 2; s++) {
          metal.push(boxPart(m, f - 0.0012, f + 0.0006, yb + 0.0020, yb + 0.0048, s * 0.0011 - 0.00025, s * 0.0011 + 0.00025, PART.STRUCT, sd));
        }
      }
    }
    // FARTUCH pod galerią: czarna blacha od spodu czoła skośnie w skałę (galeria to masywny pas na ścianie, nie obręcz na
    // wspornikach; z gry — ciemny pas pod linią okien), przerwy przy przewodach głównych i podstacjach, końce — słupki
    const Ha = L.liningApron;
    const okA = (phi) => {
      const rho = wallRhoAt(phi, yc, b);
      return !near(phi, lay.side, 0.045, rho) && !near(phi, lay.main, 0.010, rho);
    };
    const apron = (phi) => {
      const pr = galleryProfile(L, b, phi, yc);
      const W = wallRY(phi, psiAtHeight(phi, yb - Ha, b), -0.0015, b);
      const A = [pr[1][0] + 0.0003, yb + 0.0003];
      return [W, [lerp(W[0], A[0], 0.6) - 0.0008, lerp(W[1], A[1], 0.6)], A];
    };
    const ends = sweepRuns(metal, phisA, okA, apron, [[0, 1, H], [1, 2, H]], (seed + 0.5) % 1);
    for (const [phi] of ends) {
      const pr = galleryProfile(L, b, phi, yc);
      metal.push(boxPart(cylBasis(phi), pr[1][0] - 0.0004, wallRhoAt(phi, yb, b) + 0.001, yb - Ha, yb + 0.0006, -0.0008, 0.0008,
        PART.STRUCT, seed));
    }
  });
}

// ── Stopa ściany: pierścień przewodów, rozdzielnie, osłony cieplne ─────────────────────────────────────────────────

function buildFoot(L, b, lay, metal, flow) {
  const phis = azSamples(540);
  const r = L.liningConduitR * 0.85;
  const lift = r + 0.0013;
  const dpsi = 0.0018 / b;
  // dwie rury pierścienia (wzdłuż ściany ±0,0018 R od stopy)
  for (const [k, sgn] of [[0, -1], [1, 1]]) {
    const pts = phis.slice(0, -1).map((phi) => {
      const q = wallRY(phi, psiAtHeight(phi, L.footH, b) + sgn * dpsi, lift, b);
      return at3(q[0], q[1], phi);
    });
    flow.push(pipePart(pts, r, 0.55 + k * 0.1, true));
  }
  // obejmy pierścienia w pół drogi między butami żeber, przypór i rozdzielniami (buty pylonów bramy — zamiast obejm)
  const stops = [...lay.cond, ...lay.prim, ...lay.sec, ...lay.gate];
  for (const phi of midRing(stops.map((a) => a / DEG)).map((a) => a * DEG)) {
    const psi = psiAtHeight(phi, L.footH, b);
    const rho = wallRY(phi, psi, 0, b)[0];
    if (stops.some((a) => angDist(phi, a) * rho < 0.008)) continue;
    const i = Math.round(phi * 100);
    metal.push(boxPart(wallBasis(phi, psi, b), -0.0006, 0.0006, -0.0010, lift + r + 0.0006, -0.0018 - r - 0.0008, 0.0018 + r + 0.0008, PART.STRUCT, (i * 0.37) % 1));
  }
  // osłona cieplna pod pierścieniem: dwa pasy ciemnych płyt, między nimi żarzący się rowek (szew), dolna krawędź
  // nagrzana od jeziora; niskie masywne żebra co 3,75° dzielą płyty
  // W strefach korka (dolna krawędź pasa w bryle korka — ~70–103° i ~275–318°) pas i żebra pomija; końce odcinków
  // zamykają żebra-zaślepki (kontrakt z CORK: pas h footH − 0,0155 … footH − 0,0038, `footBandOk`)
  const h0 = L.footH - 0.0038, h1 = L.footH - 0.0155;
  const g = 0.0010 / b;
  const ends = sweepRuns(metal, phis, (phi) => footBandOk(L, b, phi), (phi) => {
    const p0 = psiAtHeight(phi, h0, b), p1 = psiAtHeight(phi, h1, b), pm = (p0 + p1) / 2;
    return [wallRY(phi, p1 - 0.001, -0.001, b), wallRY(phi, p1, 0.0036, b), wallRY(phi, pm - g, 0.0032, b), wallRY(phi, pm - g, 0.0021, b),
      wallRY(phi, pm + g, 0.0021, b), wallRY(phi, pm + g, 0.0029, b), wallRY(phi, p0, 0.0024, b), wallRY(phi, p0 + 0.0012, -0.001, b)];
  }, [[0, 1, PART.HOT, 0.55], [1, 2, PART.HULL], [2, 3, PART.HOT, 0.62], [3, 4, PART.HOT, 0.7], [4, 5, PART.HOT, 0.62],
    [5, 6, PART.HULL], [6, 7, PART.HULL]], 0.62);
  const rib = (phi, seed, x0 = -0.0012, x1 = 0.0012) => {
    const pa = psiAtHeight(phi, h1, b), pc = psiAtHeight(phi, h0, b), pm = (pa + pc) / 2;
    const span = (pc - pa) * earthBiteRadius(phi, pm, BITE, b);
    metal.push(boxPart(wallBasis(phi, pm, b), x0, x1, -0.0010, 0.0037, -span / 2 - 0.0003, span / 2 + 0.0003, PART.STRUCT, seed));
  };
  for (let i = 0; i < 96; i++) {
    const phi = ((i + 0.5) / 96) * TAU;
    if (footBandOk(L, b, phi)) rib(phi, (i * 0.13) % 1);
  }
  // zaślepka: żebro na końcu odcinka, wysunięte poza koniec pasa (X bazy ściany — rosnący azymut)
  for (const [phi, dir] of ends) rib(phi, 0.41, dir > 0 ? -0.0008 : -0.0016, dir > 0 ? 0.0016 : 0.0008);
}

/** Pas osłon cieplnych stopy w azymucie φ poza korkiem: dolna krawędź pasa dalej od osi niż corkR + 0,006 (CORK). */
function footBandOk(L, b, phi) {
  return wallRhoAt(phi, L.footH - 0.0155, b) >= L.corkR + 0.006;
}

/**
 * Rozdzielnia przy stopie ściany (koniec mostu korka): główna — skrzynia, przesunięta nadbudówka, jeden transformator
 * z cewką z boku i pas wentylacji (żaluzje) we wnęce; boczna — mniejsza ze światłem i żaluzjami.
 */
function buildJunction(L, b, phi, main, seed, metal) {
  const psi = psiAtHeight(phi, L.footH, b);
  const m = wallBasis(phi, psi, b);
  if (main) {
    metal.push(boxPart(m, -0.0095, 0.0095, -0.0030, 0.0068, -0.0080, 0.0080, PART.HULL, seed));
    metal.push(boxPart(m, -0.0080, 0.0022, 0.0068, 0.0092, -0.0058, 0.0040, PART.HULL, seed));
    metal.push(boxPart(m, -0.0097, 0.0097, 0.0040, 0.0047, -0.0082, 0.0082, PART.STRIP, seed, 0.35, 1));
    // pas wentylacji na dachu: wnęka i żaluzje
    metal.push(boxPart(m, -0.0074, 0.0016, 0.0090, 0.0094, -0.0050, -0.0030, PART.STRUCT, seed));
    for (let s = 0; s < 6; s++) {
      const x = -0.0068 + s * 0.0015;
      metal.push(boxPart(m, x - 0.0003, x + 0.0003, 0.0092, 0.0099, -0.0049, -0.0031, PART.STRUCT, seed));
    }
    // transformator z boku: kadłub i cewka
    metal.push(cylPart(m, 0.0058, 0.0064, -0.0026, 0.0024, 0.0040, 16, PART.HULL, seed));
    metal.push(cylPart(m, 0.0058, 0.0090, -0.0026, 0.0028, 0.0009, 18, PART.COIL, seed, seed, 0.45));
    metal.push(boxPart(m, 0.0050, 0.0062, 0.0068, 0.0086, 0.0034, 0.0062, PART.HULL, seed));
    metal.push(boxPart(m, 0.0054, 0.0058, 0.0086, 0.0094, 0.0046, 0.0050, PART.BEACON, seed, 0.5, 0));
  } else {
    metal.push(boxPart(m, -0.0062, 0.0062, -0.0030, 0.0056, -0.0056, 0.0056, PART.HULL, seed));
    metal.push(boxPart(m, -0.0064, 0.0064, 0.0034, 0.0040, -0.0058, 0.0058, PART.STRIP, seed, 0.3, 1));
    for (let s = 0; s < 4; s++) {
      const x = -0.0044 + s * 0.0013;
      metal.push(boxPart(m, x - 0.0003, x + 0.0003, 0.0054, 0.0061, -0.0030, 0.0010, PART.STRUCT, seed));
    }
    metal.push(boxPart(m, 0.0030, 0.0040, 0.0056, 0.0066, 0.0030, 0.0040, PART.BEACON, seed, 0.5, 0));
  }
}

// ── Podstacje na ścianach ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Podstacja: tarasowy budynek we wnęce ściany na wysokości ya (trzy kondygnacje schodzące ku osi; tył głęboko w skale,
 * spód do ściany pod czołem; galeria przechodzi przez środkową kondygnację), POLICZKI wnęki po bokach i nadproże,
 * okna na czołach, transformatory z cewkami na dolnym tarasie, radiatory, maszt ze światłem.
 */
function buildSubstation(L, b, phi, ya, seed, metal) {
  const rng = plantRng(Math.floor(seed * 1e6) + 17);
  const s = L.liningSubstationScale;
  const m = cylBasis(phi);
  const rhoA = wallRhoAt(phi, ya, b);
  const across = (hw) => [-1, -0.5, 0, 0.5, 1].map((t) => phi + (t * hw) / rhoA);
  const backAt = (y, hw) => Math.max(...across(hw).map((ph) => wallRhoAt(ph, y, b))) + 0.006;
  const floorAt = (rho, hw) => Math.min(...across(hw).map((ph) => wallYAtRho(ph, rho, b))) - 0.003;
  const k = rng.range(0.92, 1.08);
  const tiers = [
    { top: ya + 0.019 * k * s, front: rhoA - 0.009 * s, hw: 0.016 * s },
    { top: ya + 0.009 * k * s, front: rhoA - 0.017 * s, hw: 0.0215 * s },
    { top: ya - 0.001 * s, front: rhoA - 0.0245 * k * s, hw: 0.018 * s }
  ];
  const sd = (i) => (seed + i * 0.1) % 1;
  tiers.forEach((t, i) => {
    t.floor = floorAt(t.front, t.hw);
    metal.push(boxPart(m, t.front, backAt(t.top, t.hw), t.floor, t.top, -t.hw, t.hw, PART.HULL, sd(i)));
    // gzyms dachu i pilastry naroży
    metal.push(boxPart(m, t.front - 0.0006, t.front + 0.0024, t.top - 0.0009, t.top + 0.0004, -t.hw - 0.0006, t.hw + 0.0006, PART.HULL, sd(i)));
    for (const z of [-t.hw, t.hw]) {
      metal.push(boxPart(m, t.front - 0.0007, t.front + 0.0020, t.floor, t.top - 0.0009, z - 0.0011, z + 0.0011, PART.STRUCT, sd(i)));
    }
  });
  // RAMA WNĘKI na ścianie wokół budynku: boczne pasy i nadproże przylegające do skały (z dala — portal, z którego
  // budynek wychodzi), światła w narożach nadproża
  const t0 = tiers[0], t1 = tiers[1];
  const hwN = t1.hw + 0.0030, fw = 0.0065;
  const yLo = Math.min(...tiers.map((t) => t.floor)) - 0.004, yHi = t0.top + 0.0105;
  const psiLo = psiAtHeight(phi, Math.max(yLo, L.footH + 0.01), b), psiHi = psiAtHeight(phi, yHi, b);
  const H = PART.HULL;
  for (const [x0, x1] of [[-hwN - fw, -hwN], [hwN, hwN + fw]]) {
    wallSweep(metal, phi, psiRows(psiLo, psiHi, b, 0.006), () => [[x0, -0.003], [x0, 0.0045], [x1, 0.0045], [x1, -0.003]],
      [[0, H], [1, H], [2, H]], sd(6), b);
  }
  const psiH0 = psiAtHeight(phi, yHi - 0.0085, b);
  const nh = 9, hPhis = [];
  for (let i = 0; i <= nh; i++) hPhis.push(phi + ((i / nh) * 2 - 1) * (hwN + fw) / rhoA);
  sweepAz(metal, hPhis, (ph) => [wallRY(ph, psiH0, -0.003, b), wallRY(ph, psiH0, 0.0068, b), wallRY(ph, psiHi, 0.0050, b),
    wallRY(ph, psiHi, -0.003, b)], [[0, 1, H], [1, 2, H], [2, 3, H]], sd(7));
  for (const x of [-hwN - fw * 0.5, hwN + fw * 0.5]) {
    const m2 = wallBasis(phi + x / rhoA, psiHi, b);
    metal.push(boxPart(m2, -0.0007, 0.0007, 0.0048, 0.0060, -0.0016, -0.0004, PART.BEACON, (seed + x + 1) % 1, 0.4, 0));
  }
  // okna na widocznych częściach czół (pasy, między nimi pilastry co ~0,008 R)
  const win = (t, y0, y1, z) => {
    if (y1 - y0 < 0.0015) return;
    metal.push(boxPart(m, t.front - 0.0003, t.front + 0.0002, y0, y1, -t.hw + 0.0016, t.hw - 0.0016, PART.WINDOW, seed, z));
    for (let zz = -t.hw + 0.008; zz < t.hw - 0.004; zz += 0.008) {
      metal.push(boxPart(m, t.front - 0.0006, t.front + 0.0004, y0 - 0.0004, y1 + 0.0004, zz - 0.0004, zz + 0.0004, PART.STRUCT, seed));
    }
  };
  win(tiers[0], tiers[1].top + 0.0016, tiers[0].top - 0.0022, 0.85);
  win(tiers[1], tiers[2].top + 0.0014, tiers[1].top - 0.0020, 0.8);
  win(tiers[2], ya - 0.0125 * s, ya - 0.0040 * s, 0.85);
  win(tiers[2], Math.max(ya - 0.0240 * s, tiers[2].floor + 0.004), ya - 0.0165 * s, 0.6);
  // transformatory na dolnym tarasie: kadłub, cewka, izolator (listwa)
  const xT = (tiers[2].front + tiers[1].front) / 2;
  for (const z of [-0.0108, -0.0036, 0.0036, 0.0108]) {
    metal.push(cylPart(m, xT, tiers[2].top - 0.0006, z * s, 0.0026 * s, 0.0060 * s, 16, PART.HULL, seed));
    metal.push(cylPart(m, xT, tiers[2].top + 0.0018 * s, z * s, 0.0031 * s, 0.0011 * s, 20, PART.COIL, seed, (seed + z * 40 + 1) % 1, 0.45));
    metal.push(cylPart(m, xT, tiers[2].top + 0.0054 * s, z * s, 0.0008 * s, 0.0022 * s, 8, PART.STRIP, seed, 0.4, 1));
  }
  // radiatory na środkowym tarasie
  for (let i = -5; i <= 5; i++) {
    const z = i * 0.0034 * s;
    metal.push(boxPart(m, tiers[1].front + 0.0018, tiers[0].front - 0.0014, tiers[1].top - 0.0006, tiers[1].top + 0.0045 * s, z - 0.0003, z + 0.0003, PART.STRUCT, seed));
  }
  // nadbudówka na górnym tarasie (pod nadprożem wnęki), maszt ze światłem na dachu środkowego, światła narożne
  metal.push(boxPart(m, t0.front + 0.0030, backAt(t0.top + 0.006, 0.006), t0.top - 0.0006, t0.top + 0.0055, -0.0060, 0.0030, PART.HULL, sd(5)));
  metal.push(boxPart(m, t0.front + 0.0027, t0.front + 0.0032, t0.top + 0.0018, t0.top + 0.0040, -0.0055, 0.0025, PART.WINDOW, seed, 0.85));
  const xM = t1.front + 0.0025, zM = t1.hw - 0.0045;
  metal.push(cylPart(m, xM, t1.top - 0.0006, zM, 0.0006, 0.0200, 6, PART.STRUCT, seed, 0, 0, 0.0003));
  metal.push(boxPart(m, xM - 0.0007, xM + 0.0007, t1.top + 0.0192, t1.top + 0.0206, zM - 0.0007, zM + 0.0007, PART.BEACON, seed, 0.6, 0));
  for (const z of [-t1.hw + 0.0012, t1.hw - 0.0012]) {
    metal.push(boxPart(m, t1.front + 0.0004, t1.front + 0.0016, t1.top + 0.0004, t1.top + 0.0016, z - 0.0006, z + 0.0006, PART.BEACON, (seed + z + 1) % 1, 0.4, 1));
  }
}

// ── Złożenie ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Węzły przewodu głównego w azymucie phi: od stopy w górę ściany (nad okładziną — wyżej), przed fartuchem odchodzi od
 * ściany, przed fasadą i gzymsem, przez parapet na plac.
 */
function mainConduitNodes(L, b, phi) {
  const R = rimAt(phi, b);
  const r = L.liningConduitR;
  const D = L.liningCrownDrop, a = L.liningCrownLift;
  const liftLo = r + 0.0013, liftHi = L.liningClad[0] + r + 0.0007;
  const aP = a + 0.0038 + r + 0.0010;            // przed gzymsem
  const top = L.liningCrownTop, deck = L.liningCrownDeck;
  const yClad = beltY(L) - 0.004;
  const psi0 = psiAtHeight(phi, L.footH, b), psi1 = R.psR - (D + 0.017) / R.beR;
  const n = Math.ceil(((psi1 - psi0) * R.beR) / 0.004);
  const nodes = [];
  for (let i = 0; i <= n; i++) {
    const psi = lerp(psi0, psi1, i / n);
    const y = wallRY(phi, psi, 0, b)[1];
    nodes.push({ k: 'w', psi, lift: y > yClad ? liftHi : liftLo, band: y > ductBottomY(L) - 0.002 ? false : undefined });
  }
  // od galerii-pasa przez okładzinę i fasadę po gzyms wiązka biegnie w KANALE FASADY (buildDuct) — tam bez obejm
  nodes.push({ k: 'c', c: D + 0.010, a: lerp(liftHi, aP, 0.45), band: false }, { k: 'c', c: D + 0.004, a: aP, band: false });
  for (const c of [D - 0.006, 0.012, 0.004, -0.0040]) nodes.push({ k: 'c', c, a: aP, band: false });
  nodes.push({ k: 'c', c: -0.0065, a: aP, band: false });
  nodes.push({ k: 's', s: -0.0085, h: top + 0.0032, band: false }, { k: 's', s: -0.0045, h: top + 0.0034, band: false },
    { k: 's', s: 0.0005, h: top + 0.0030, band: false }, { k: 's', s: 0.0025, h: deck + 0.0030 },
    { k: 's', s: 0.0050, h: deck + 0.0026 }, { k: 's', s: 0.0080, h: deck + 0.0026 }, { k: 's', s: L.liningPlazaOut - 0.0008, h: deck + 0.0026 });
  return nodes;
}

/** Spód kanału fasady: tuż nad pokładem galerii-pasa (wyżej — okładzina i fasada, pas bohatera w kadrze gry). */
const ductBottomY = (L) => beltY(L) + galleryH(L, beltY(L)) / 2 + 0.0005;

/**
 * KANAŁ FASADY wiązki głównej: od pokładu galerii-pasa przez okładzinę, fartuch i fasadę po gzyms rury biegną w zamkniętej
 * skrzyni (czarna, fazowane naroża, czoło 1,1 promienia rury nad rurami — skrzynia idzie za nimi przez odskok przed
 * fartuchem; w czole wąska szczelina z chłodną listwą — z daleka ciemny pas z płynącą falą energii zamiast trzech
 * błyszczących rur w poprzek górnego pasa ściany), obejmy co ~0,016 R, kołnierze na końcach (rury wchodzą z galerii,
 * wychodzą górą przed gzyms i przez parapet na plac). Niżej, na skale, wiązka zostaje odkryta (impulsy energii).
 */
function buildDuct(L, b, phi, seed, metal) {
  const R = rimAt(phi, b);
  const D = L.liningCrownDrop, r = L.liningConduitR;
  const liftHi = L.liningClad[0] + r + 0.0007, aP = L.liningCrownLift + 0.0038 + r + 0.0010, aJ = lerp(liftHi, aP, 0.45);
  const hw = 3.25 * r + 0.0009, ch = 0.0007, sw = 0.0006;
  const psiA = psiAtHeight(phi, ductBottomY(L), b), psiB = R.psR - 0.0004 / R.beR;
  // wysokość osi rur nad ścianą wg c (droga pod krawędzią) — jak węzły mainConduitNodes
  const c1 = D + 0.017, c2 = D + 0.010, c3 = D + 0.004;
  const pipeLift = (c) => (c >= c1 ? liftHi : c >= c2 ? lerp(aJ, liftHi, (c - c2) / (c1 - c2)) : c >= c3 ? lerp(aP, aJ, (c - c3) / (c2 - c3)) : aP);
  const front = (psi) => pipeLift((R.psR - psi) * R.beR) + r + 0.0011;
  const H = PART.HULL;
  wallSweep(metal, phi, psiRows(psiA, psiB, b, 0.004), (f) => {
    const lf = front(lerp(psiA, psiB, f));
    return [[-hw, 0.0010], [-hw, lf - ch], [-hw + ch, lf], [-sw, lf], [-sw, lf - 0.0004], [sw, lf - 0.0004], [sw, lf], [hw - ch, lf],
      [hw, lf - ch], [hw, 0.0010]];
  }, [[0, H], [1, H], [2, H], [3, H], [4, PART.STRIP, 0.3, 1], [5, H], [6, H], [7, H], [8, H]], seed, b);
  const n = Math.max(2, Math.round(((psiB - psiA) * R.beR) / 0.016));
  for (let i = 1; i < n; i++) {
    const psi = lerp(psiA, psiB, i / n);
    metal.push(boxPart(wallBasis(phi, psi, b), -hw - 0.0004, hw + 0.0004, 0.0008, front(psi) + 0.0003, -0.0005, 0.0005,
      PART.STRUCT, (seed + i * 0.1) % 1));
  }
  metal.push(boxPart(wallBasis(phi, psiA, b), -hw - 0.0006, hw + 0.0006, 0.0008, front(psiA) + 0.0006, -0.0010, 0.0006, H, seed));
  metal.push(boxPart(wallBasis(phi, psiB, b), -hw - 0.0006, hw + 0.0006, 0.0008, front(psiB) + 0.0006, -0.0006, 0.0010, H, seed));
}

/** Węzły przewodu bocznego: od stopy w górę ściany do spodu podstacji na wysokości ya. */
function sideConduitNodes(L, b, phi, ya) {
  const lift = L.liningConduitR * 0.8 + 0.0012;
  const psi0 = psiAtHeight(phi, L.footH, b), psi1 = psiAtHeight(phi, ya - 0.012 * L.liningSubstationScale, b);
  const n = Math.ceil(((psi1 - psi0) * b) / 0.004);
  const nodes = [];
  for (let i = 0; i <= n; i++) nodes.push({ k: 'w', psi: lerp(psi0, psi1, i / n), lift });
  return nodes;
}

/** Punkt końca przewodów głównych na placu kotwicy (przyłącze) — rama elektrowni; dla wind (ELEV). */
export function liningTerminalPoint(L, b, phi, out = new THREE.Vector3()) {
  const q = rimAt(phi, b).s(L.liningPlazaOut - 0.001, L.liningCrownDeck + 0.0026);
  return at3(q[0], q[1], phi, out);
}

/** Obudowa: { metal: części, flow: części } w ramie elektrowni. */
export function buildLining(L, b) {
  const metal = [];
  const flow = [];
  const rng = plantRng(0x4c1e);
  const lay = wallLayout(L);
  buildCrown(L, b, lay, metal);
  buildCladding(L, b, lay, metal);
  L.elevators.forEach((az, i) => buildPlaza(L, b, az * DEG, metal, (i + 0.5) / L.elevators.length));
  // brama promienia (jej głowice zastępują maszty przy osi — maszty bliżej niż 5° od pylonu ustępują), maszty emiterów;
  // między sąsiednimi głowicami (nie nad placami, tylko na łuku południowym) ciągły łuk cięciwy pola
  const heads = buildGate(L, b, lay, metal, flow);
  for (let k = 0; k < L.liningMasts; k++) {
    const phi = ((k + 0.5) / L.liningMasts) * TAU;
    if (lay.gateAz !== null && angDist(phi, lay.gateAz) < (L.liningGateHalf + 5) * DEG) continue;
    heads.push([phi, plazaAt(L, b, phi) > 0.001 ? null : buildMast(L, b, phi, k, L.liningMasts, rng, metal), 1]);
  }
  heads.sort((p, q) => p[0] - q[0]);
  const gap = (TAU / L.liningMasts) * 1.6;
  let chordN = 0;
  heads.forEach(([pa, h, ka], k) => {
    const [pb, nx, kb] = heads[(k + 1) % heads.length];
    if (!h || !nx || angDist(pa, pb) >= gap) return;
    if (Math.sin(pa) + Math.sin(pb) > 2 * L.liningChordSin) return;
    fieldChord(metal, h, nx, ka, kb, k / heads.length, chordN++, L);
  });
  lay.prim.forEach((phi, i) => buildButtress(L, b, phi, (i * 0.618 + 0.05) % 1, metal, flow));
  lay.sec.forEach((phi, i) => buildRib(L, b, phi, (i * 0.618) % 1, metal));
  buildGalleries(L, b, lay, metal);
  buildFoot(L, b, lay, metal, flow);
  const r = L.liningConduitR;
  lay.main.forEach((phi, i) => {
    buildJunction(L, b, phi, true, (i + 0.25) / lay.main.length, metal);
    bundle(metal, flow, mainConduitNodes(L, b, phi), phi, [-2.25 * r, 0, 2.25 * r], r, b, (i * 0.31) % 1);
    buildDuct(L, b, phi, (i * 0.31 + 0.13) % 1, metal);
  });
  lay.side.forEach((phi, i) => {
    const ya = lay.sideH[i];
    const rs = r * 0.8;
    buildJunction(L, b, phi, false, (i + 0.75) / lay.side.length, metal);
    bundle(metal, flow, sideConduitNodes(L, b, phi, ya), phi, [-1.2 * rs, 1.2 * rs], rs, b, (i * 0.43 + 0.2) % 1);
    buildSubstation(L, b, phi, ya, (i + 0.5) / lay.side.length, metal);
  });
  return { metal, flow };
}
