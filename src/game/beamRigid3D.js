/**
 * beamRigid3D — KLASTRY SZTYWNE w silniku belek (docs/PLAN-zawalenia-budowli-3d.md § 3.3, § 3.5, etap E2).
 *
 * Oderwana masa zawalenia (blok ≥ 2 grafu nośnego, kawałek H-C, bębna, później H-T po minięciu dysku — decyzje D0, D6)
 * nie jest bryłą belek, tylko CIAŁEM SZTYWNYM 6DoF w tym samym silniku i tym samym kroku co kadłuby i bryły:
 *  - ciało z flagą `rigid: true` w liście `bodies` silnika (HullBodies.step) — `integrate` z tą samą grawitacją,
 *    studnią skały (gravityWell + vmax), tłumieniem i przegubami (`addJoint` — zawias ciało–świat) co bryły 3D;
 *  - kształt = PUNKTY STYKU (kule) bloków w układzie ciała (początek = środek masy), masa i tensor z bloków
 *    (prostopadłościany, twierdzenie Steinera); klaster nie ma węzłów ani belek — się nie gniecie i nie pęka
 *    (pękanie klastra po wiązaniach prefraktury to graf E1 / E7: nowe klastry z bloków starego);
 *  - pary: klaster × klaster (także z jednej budowli), klaster × bryła belek (wieża H-T — punkty kontra siatka węzłów
 *    bryły), klaster × ciało płaskie (słup węzła — przekrój klastra w płaszczyźnie gry to przeszkoda i TARAN, D5),
 *    klaster × teren (normalna RAZ na ciało — dźwignia 3), klaster × pole płyty (beamPlateField3D.js);
 *  - sen i zamrożenie (koszt 0 w spoczynku), budżet aktywnych klastrów (plan § 3.4 — 160).
 *
 * BIT W BIT dla statków i dzisiejszych brył: silnik rozdziela klastry WYŁĄCZNIE w `update()` (destructorBeams3D.js):
 * `_broadphase` pomija ciała rigid (pary belek i ich kolejność bez zmian), ten moduł liczy się po pętli par belek,
 * `_terrainPass` pomija rigid, a `collideBodies` / `_collideMixed` / `_collideTerrain` są nietknięte. Bez klastrów
 * w kroku żadna funkcja tego modułu się nie wykonuje. Bez losowań (zasada 9), bez alokacji w kroku (zasada 7 —
 * bufory rosną tylko ponad największy dotąd rozmiar), stałe „na krok” przez ticksAt120 (zasada 8).
 *
 * PRAWO STYKU (dźwignia 2: bez normalnej z okna materiału i koszy frontu, których klaster nie potrzebuje, bo się nie
 * gniecie). Klaster × klaster i klaster × teren: IMPULSY SEKWENCYJNE na styk kula–kula / kula–teren (rc.pairPasses
 * przejść w parze na iterację kolizji silnika, impuls normalny skumulowany ≥ 0, tarcie Coulomba skumulowane ≤ μ ·
 * impuls), restytucja rc.restitution, łagodna korekta przenikania (rc.separation), tłumienie kołysania przy wolnym styku
 * — stos leży i zasypia (jeden impuls zbiorczy w środku styku nie gasił obrotu przy kilku normalnych naraz). Klaster ×
 * CIAŁO BELEK: jeden impuls zbiorczy do granicy plastyczności frontu wg pancerza i masy węzła ciała belek (prawo v2);
 * ponad granicą — granica i zgniot nadmiaru W CIELE BELEK (`_crushNodeV2`, pion słupa — `_crushColumn`, przeciążone
 * belki pękają w kroku), pęd nadany zgniatanym węzłom wraca hamowaniem klastra.
 *
 * SEN: ruch NETTO pozy w kroku (nie prędkość — ciało w stosie ma prędkość resztkową grawitacji trzymaną korektą) poniżej
 * sleepSpeed przez sleepTicks120 kroków 1/120 s, w styku. Śpiący nie jest całkowany ani nie czyta terenu; w parze jest
 * podporą; budzi go styk albo sąsiad szybszy niż wakeSpeed, PCHANIE w bok ponad tarcie podparcia (notePush) i UTRATA
 * PODPORY (supportLost: partner styku z ostatniego kroku na jawie martwy / nieobecny / ruszył / stracił węzły, komórki
 * płyty pod nim cieńsze, teren zdjęty — zamrożony wtedy odmarza); z gry także wakeRigidAround.
 *
 * Hak grafu (E1): `D.onRigidContact(ciało, blok, jx, jy, jz, x, y, z)` — impuls styku oddany ciału klastra (świat
 * silnika) w bloku najgłębszego punktu (numer bloku W GRAFIE — `id` bloku z buildClusterDesc, rg.blockId; nie indeks
 * w opisie), raz na parę i krok (pierwsza iteracja). Hak gry: `D.onRigidPair(R, B, info)`
 * — styk klastra z ciałem belek (info jak _contactInfo; normalna B → R).
 */

import { ticksAt120 } from './stepDecay.js';

/** Strojenie klastrów (D.rigidConfig; gra — HullBodies.init). Jednostki fizyczne: j., j/s, s. */
export function createRigidConfig() {
  return {
    // Siatka par klastrów: bok = broadCellMul × średni promień klastra kroku (plan § 3.5 p. 1: 2–4 × promień), nie
    // 64 komórki ciał belek (960 j. — w stosie r 1,4 km prawie każda para dzieliła komórkę: 12 tys. par przy 200).
    broadCellMul: 2.5,
    broadCellMin: 60,
    // tarcie klastra (ciało bez własnego — opts.friction); para bierze większe z dwóch, teren — większe z terenem
    friction: 0.6,
    // Styk klastra: restytucja (gruz betonu nie odbija się), korekta przenikania (ułamek na 1/60 s — łagodniej niż 0,9
    // ciał belek: pełna korekta głębokości najgłębszego punktu wypychała stos w górę i kołysała go bez końca), tłumienie
    // obrotu przy wolnym styku [1/s] (zbliżanie < restSpeed j/s) — leżący stos uspokaja się i zasypia.
    restitution: 0,
    separation: 0.5,
    restSpeed: 40,
    restDamp: 3,
    // przejścia impulsów sekwencyjnych w parze klaster × klaster (na iterację kolizji silnika — razem 2 × tyle)
    pairPasses: 2,
    // SEN: klaster w styku wolniejszy niż sleepSpeed [j/s] (także |ω| · promień) przez sleepTicks120 kroków 1/120 s
    // zasypia: bez całkowania, terenu i par z innymi śpiącymi (koszt ≈ 0 — zostaje wpis w siatce par).
    sleepSpeed: 5,
    sleepTicks120: 60,
    // Śpiący klaster w parze jest nieruchomą podporą; budzi go styk szybszy niż wakeSpeed [j/s] albo sąsiad (nakładanie
    // obrysów) szybszy niż wakeSpeed, utrata podpory (supportPeriod120 — co tyle kroków 1/120 s sprawdza grubość płyty
    // pod sobą także bez zmiany wersji pola) albo PCHANIE: impuls w bok (względem własnej grawitacji) ponad tarcie
    // podparcia, zebrany w serii kolejnych kroków, większy niż masa × pushWakeDv [j/s] — wolno pchany gruz rusza
    // (dawniej śpiący był dla statku pchającego < wakeSpeed ścianą o masie ∞).
    wakeSpeed: 30,
    pushWakeDv: 2,
    supportPeriod120: 30,
    // BUDŻET aktywnych (plan § 3.4: ≤ 160): nadmiar — klastry wolniejsze niż budgetSleepSpeed [j/s] — zasypia od
    // najlżejszego (potem mniejsze id); szybsze nad budżetem liczy perf.overBudget (gra: gruz obrazu — E4 / E7).
    maxActive: 160,
    budgetSleepSpeed: 40,
    // Teren: płaszczyzna styczna w punkcie pod środkiem ciała (normalna raz na ciało); punkt dalej nad nią niż
    // terrainMargin × promień ciała + ½ promienia punktu + terrainSlope × jego odległość w bok od środka — bez odczytu
    // terenu (dźwignia 3). terrainSlope = największa ZMIANA nachylenia rzeźby względem płaszczyzny stycznej (1 ≈ garb
    // 45° na płaskim; teren może podać własne `reliefSlope`) — bez tego członu punkt nad garbem / zboczem krateru nigdy
    // nie schodził pod płaszczyznę i wchodził w skałę (recenzja E2: 15–100 j. pod długim klastrem).
    terrainMargin: 0.1,
    terrainSlope: 1,
    // Teren: przejścia impulsów sekwencyjnych na iterację kolizji (długi klaster ma kilkanaście styków na dźwigniach do
    // 600 j. — 2 przejścia zostawiały kołysanie), tłumienie spoczynku T.restAngDamp pełne od terrainRestCount styków
    // i tłumienie TOCZENIA rollDamp [1/s] (składowa obrotu w poprzek normalnej przy ≥ 2 stykach: kule punktów
    // zaokrąglają krawędzie bloków, a toczenie po zaokrągleniu nie traci energii). Leżący blok 1200 × 120 × 80 zasypia
    // w ~2 s (dawniej wcale — recenzja E2, zgł. 5).
    terrainPasses: 4,
    terrainRestCount: 8,
    rollDamp: 3,
    // CCD punktów (R11): punkt, który w kroku przeszedł przez materiał ciała belek (wejście i wyjście w jednym kroku),
    // dostaje styk wstecz z normalną przeciw ruchowi; próbki co ½ zasięgu styku, najwyżej ccdMaxSamples.
    ccd: true,
    ccdMaxSamples: 16
  };
}

/**
 * Liczniki ostatniego kroku (D.rigidPerf). Czasy (ms, rrMs, …) tylko przy timing = true (narzędzia, np.
 * scripts/klastry-sym.mjs) — w grze performance.now() i zapis liczb zmiennoprzecinkowych w liczniki kosztowały
 * (alokacja na krok); czas klastrów jest i tak w D.perf.lastCollisionMs.
 */
export const RIGID_PERF = {
  timing: false,
  ms: 0,              // cały moduł w kroku (obie iteracje, sen)
  bodies: 0, awake: 0, sleeping: 0, frozen: 0,
  broadCell: 0,
  pairs: 0,           // pary klaster × klaster z siatki (krok)
  narrow: 0,          // pary po teście obrysów (obie iteracje) — mianownik µs na parę
  rrMs: 0,            // czas par klaster × klaster (obie iteracje)
  prepMs: 0,          // przygotowanie kroku: lista, obroty punktów, siatka par, pary
  afterMs: 0,         // sen i budżet
  contacts: 0,
  beamPairs: 0, beamNarrow: 0, beamEval: 0, beamMs: 0, crushes: 0, ccdHits: 0,   // beamEval — wywołania pary (obie iteracje)
  terrainBodies: 0, terrainReads: 0, terrainMs: 0,
  overBudget: 0
};

const nowMs = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now());

// ============================ OPIS KLASTRA ============================

function quatRot(q, x, y, z, out) {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  out[0] = x + q.w * tx + (q.y * tz - q.z * ty);
  out[1] = y + q.w * ty + (q.z * tx - q.x * tz);
  out[2] = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

function invert3(m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-30)) return [a > 0 ? 1 / a : 0, 0, 0, 0, e > 0 ? 1 / e : 0, 0, 0, 0, i > 0 ? 1 / i : 0];
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/**
 * Opis klastra z PROSTOPADŁOŚCIANÓW bloków (układ klastra — np. budowli): `boxes` = [{ x, y, z (środek), hx, hy, hz
 * (półosie), mass, id (numer bloku w grafie), q (opcjonalny obrót bloku) }]. Punkty styku leżą na siatce powierzchni
 * bloku cofniętej o promień (kule nie wystają poza bryłę), odstęp ≤ opts.spacing [j.] (domyślnie 50), promień =
 * opts.radiusMul × odstęp (0,6 — R11: przy 0,6 punkt węzła 15 j. kadłuba o promieniu styku 8,25 nie przejdzie między
 * czterema punktami oczka do 60 j.), ale nie więcej niż max(najmniejsza półoś, ½ środkowej) (najwyżej najcieńszy wymiar
 * ma jedną warstwę punktów, środkowy — ≥ 2 rzędy: bez wałka z kul, który się toczy), najwyżej opts.maxPoints na blok
 * (32 — plan § 3.1; ponad to odstęp rośnie).
 * Zwraca { blockCount, blockMass, blockBox (środek xyz + półosie xyz, układ klastra), blockId, pointCount,
 * points (x, y, z, r), pointBlock }.
 */
export function buildClusterDesc(boxes, opts = {}) {
  const spacing0 = Number(opts.spacing) > 0 ? Number(opts.spacing) : 50;
  const radiusMul = Number(opts.radiusMul) > 0 ? Number(opts.radiusMul) : 0.6;
  const maxPoints = Math.max(1, Number(opts.maxPoints) | 0 || 32);
  const nb = boxes.length;
  const blockMass = new Float64Array(nb), blockBox = new Float64Array(nb * 6), blockId = new Int32Array(nb);
  const px = [], py = [], pz = [], pr = [], pb = [];
  const tmp = new Float64Array(3);
  for (let bi = 0; bi < nb; bi++) {
    const bx = boxes[bi];
    const hx = Math.max(1e-3, +bx.hx), hy = Math.max(1e-3, +bx.hy), hz = Math.max(1e-3, +bx.hz);
    blockMass[bi] = Math.max(1e-6, +bx.mass || 0);
    blockBox[bi * 6] = +bx.x || 0; blockBox[bi * 6 + 1] = +bx.y || 0; blockBox[bi * 6 + 2] = +bx.z || 0;
    blockBox[bi * 6 + 3] = hx; blockBox[bi * 6 + 4] = hy; blockBox[bi * 6 + 5] = hz;
    blockId[bi] = Number.isFinite(bx.id) ? bx.id | 0 : bi;
    // Sufit promienia punktu: ≤ max(najmniejsza półoś, ½ środkowej). Przy sufitcie punktów odstęp rośnie, a dawny promień
    // 0,6 × odstęp przerastał DWA wymiary — dwie osie zwijały się do jednego rzędu i długi blok (leżący segment
    // wieżowca, D14) stawał się wałkiem z kul, który toczył się po terenie i nie zasypiał (recenzja E2, zgł. 5). Teraz
    // co najwyżej najcieńsza oś ma jedną warstwę (płyta), środkowa — ≥ 2 rzędy (podstawa, na której blok leży). Cienka
    // płyta (półoś < ½ środkowej) ma kule grubsze niż ona (wystają w jej grubości — R11: oczko punktów bez przelotu
    // węzła 15 j.); blok z kulami w bryle zaczyna od odstępu promień / radiusMul, sufit punktów może go podnieść.
    const hmid = hx + hy + hz - Math.min(hx, hy, hz) - Math.max(hx, hy, hz);
    const rCap = Math.max(Math.min(hx, hy, hz), 0.5 * hmid);
    let s = Math.min(spacing0, rCap / radiusMul);
    for (let tries = 0; tries < 64; tries++) {
      const r = Math.min(radiusMul * s, rCap);
      const ex = Math.min(r, hx), ey = Math.min(r, hy), ez = Math.min(r, hz);
      const na = hx - ex > 1e-6 ? Math.max(2, Math.ceil((2 * (hx - ex)) / s) + 1) : 1;
      const nbb = hy - ey > 1e-6 ? Math.max(2, Math.ceil((2 * (hy - ey)) / s) + 1) : 1;
      const nc = hz - ez > 1e-6 ? Math.max(2, Math.ceil((2 * (hz - ez)) / s) + 1) : 1;
      const interior = (na > 2 ? na - 2 : 0) * (nbb > 2 ? nbb - 2 : 0) * (nc > 2 ? nc - 2 : 0);
      const thin = na === 1 || nbb === 1 || nc === 1;
      const count = na * nbb * nc - (thin ? 0 : interior);
      if (count > maxPoints && tries < 63) { s *= 1.1; continue; }
      for (let k = 0; k < nc; k++) for (let j = 0; j < nbb; j++) for (let i = 0; i < na; i++) {
        const surf = thin || i === 0 || j === 0 || k === 0 || i === na - 1 || j === nbb - 1 || k === nc - 1;
        if (!surf) continue;
        const lx = na === 1 ? 0 : -hx + ex + (2 * (hx - ex)) * i / (na - 1);
        const ly = nbb === 1 ? 0 : -hy + ey + (2 * (hy - ey)) * j / (nbb - 1);
        const lz = nc === 1 ? 0 : -hz + ez + (2 * (hz - ez)) * k / (nc - 1);
        if (bx.q) quatRot(bx.q, lx, ly, lz, tmp); else { tmp[0] = lx; tmp[1] = ly; tmp[2] = lz; }
        px.push(blockBox[bi * 6] + tmp[0]); py.push(blockBox[bi * 6 + 1] + tmp[1]); pz.push(blockBox[bi * 6 + 2] + tmp[2]);
        pr.push(Math.max(1e-3, r));
        pb.push(bi);
      }
      break;
    }
  }
  const n = px.length;
  const points = new Float64Array(n * 4), pointBlock = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    points[k * 4] = px[k]; points[k * 4 + 1] = py[k]; points[k * 4 + 2] = pz[k]; points[k * 4 + 3] = pr[k];
    pointBlock[k] = pb[k];
  }
  const boxQuat = boxes.map((b) => b.q || null);
  return { blockCount: nb, blockMass, blockBox, blockId, blockQuat: boxQuat, pointCount: n, points, pointBlock };
}

/**
 * Masa, środek masy i tensor bezwładności klastra z bloków (prostopadłościany jednorodne + Steiner), układ klastra.
 * Zwraca { mass, com: [x, y, z], inertia: [9] }.
 */
export function clusterMassProperties(desc) {
  const nb = desc.blockCount, bm = desc.blockMass, bb = desc.blockBox;
  let M = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < nb; i++) { const m = bm[i]; M += m; cx += m * bb[i * 6]; cy += m * bb[i * 6 + 1]; cz += m * bb[i * 6 + 2]; }
  if (!(M > 0)) M = 1;
  cx /= M; cy /= M; cz /= M;
  const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const R = new Float64Array(9);
  for (let i = 0; i < nb; i++) {
    const m = bm[i], hx = bb[i * 6 + 3], hy = bb[i * 6 + 4], hz = bb[i * 6 + 5];
    // tensor bloku w jego osiach
    const a = m * (hy * hy + hz * hz) / 3, b = m * (hx * hx + hz * hz) / 3, c = m * (hx * hx + hy * hy) / 3;
    const q = desc.blockQuat ? desc.blockQuat[i] : null;
    if (q) {
      // R diag(a, b, c) Rᵀ
      const x = q.x, y = q.y, z = q.z, w = q.w;
      R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
      R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
      R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
      for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
        I[r * 3 + s] += R[r * 3] * a * R[s * 3] + R[r * 3 + 1] * b * R[s * 3 + 1] + R[r * 3 + 2] * c * R[s * 3 + 2];
      }
    } else { I[0] += a; I[4] += b; I[8] += c; }
    const dx = bb[i * 6] - cx, dy = bb[i * 6 + 1] - cy, dz = bb[i * 6 + 2] - cz;
    I[0] += m * (dy * dy + dz * dz); I[4] += m * (dx * dx + dz * dz); I[8] += m * (dx * dx + dy * dy);
    I[1] -= m * dx * dy; I[3] -= m * dx * dy; I[2] -= m * dx * dz; I[6] -= m * dx * dz; I[5] -= m * dy * dz; I[7] -= m * dy * dz;
  }
  return { mass: M, com: [cx, cy, cz], inertia: I };
}

// Wektory i kwaternion pozy klastra: WŁASNE klasy (osobne mapy V8, pola zawsze liczbami zmiennoprzecinkowymi). Literały
// { x, y, z } dzielą mapę z każdym takim literałem w programie — gdy gdziekolwiek trafi tam nie-liczba, reprezentacja
// pól staje się ogólna i KAŻDY zapis prędkości alokuje liczbę (pomiar 2026-11-04: 58 KB / 60 kroków w zestawie testów
// wobec 0 w osobnym procesie).
class RigidVec3 {
  constructor(x, y, z) { this.x = x + 0.5 - 0.5; this.y = y + 0.5 - 0.5; this.z = z + 0.5 - 0.5; }
}
class RigidQuat {
  constructor(x, y, z, w) { this.x = x + 0.5 - 0.5; this.y = y + 0.5 - 0.5; this.z = z + 0.5 - 0.5; this.w = w + 0.5 - 0.5; }
}

/**
 * Ciało klastra (wołane przez D.createRigidBody). opts: position (środek MASY w świecie silnika — albo origin: początek
 * układu klastra, wtedy środek masy = origin + R·com), quaternion, velocity, angularVelocity, gravity, gravityWell,
 * friction, collisionArmor, name. Pola ciała jak createBody tam, gdzie czyta je wspólny kod silnika (integrate,
 * przeguby, _applyImpulse, sen); nodeStore / beamStore — null.
 */
export function createRigidBody(D, desc, opts, id) {
  const rc = D.rigidConfig || createRigidConfig();
  const mp = clusterMassProperties(desc);
  const n = desc.pointCount | 0;
  const lx = new Float64Array(n), ly = new Float64Array(n), lz = new Float64Array(n), r = new Float64Array(n);
  const blk = new Int32Array(n);
  let rad = 0, maxR = 0, minR = Infinity;
  for (let k = 0; k < n; k++) {
    lx[k] = desc.points[k * 4] - mp.com[0];
    ly[k] = desc.points[k * 4 + 1] - mp.com[1];
    lz[k] = desc.points[k * 4 + 2] - mp.com[2];
    r[k] = desc.points[k * 4 + 3];
    blk[k] = desc.pointBlock[k];
    const d = Math.sqrt(lx[k] * lx[k] + ly[k] * ly[k] + lz[k] * lz[k]) + r[k];
    if (d > rad) rad = d;
    if (r[k] > maxR) maxR = r[k];
    if (r[k] < minR) minR = r[k];
  }
  const q0 = opts.quaternion || { x: 0, y: 0, z: 0, w: 1 };
  const ql = Math.sqrt(q0.x * q0.x + q0.y * q0.y + q0.z * q0.z + q0.w * q0.w) || 1;
  const quat = new RigidQuat(q0.x / ql, q0.y / ql, q0.z / ql, q0.w / ql);
  let px = 0, py = 0, pz = 0;
  if (opts.origin) {
    const t = quatRot(quat, mp.com[0], mp.com[1], mp.com[2], new Float64Array(3));
    px = (+opts.origin.x || 0) + t[0]; py = (+opts.origin.y || 0) + t[1]; pz = (+opts.origin.z || 0) + t[2];
  } else if (opts.position) {
    px = +opts.position.x || 0; py = +opts.position.y || 0; pz = +opts.position.z || 0;
  }
  const v = opts.velocity || null, w = opts.angularVelocity || null;
  const bb = desc.blockBox, nb = desc.blockCount;
  const blockBox = new Float64Array(nb * 6);
  for (let i = 0; i < nb; i++) {
    blockBox[i * 6] = bb[i * 6] - mp.com[0]; blockBox[i * 6 + 1] = bb[i * 6 + 1] - mp.com[1]; blockBox[i * 6 + 2] = bb[i * 6 + 2] - mp.com[2];
    blockBox[i * 6 + 3] = bb[i * 6 + 3]; blockBox[i * 6 + 4] = bb[i * 6 + 4]; blockBox[i * 6 + 5] = bb[i * 6 + 5];
  }
  const cs = Math.max(1, 2 * (Number.isFinite(minR) ? minR : 1));
  const body = {
    id,
    name: opts.name || `klaster${id}`,
    pos: new RigidVec3(px, py, pz),
    vel: new RigidVec3(v ? +v.x || 0 : 0, v ? +v.y || 0 : 0, v ? +v.z || 0 : 0),
    quat,
    angVel: new RigidVec3(w ? +w.x || 0 : 0, w ? +w.y || 0 : 0, w ? +w.z || 0 : 0),
    mass: mp.mass,
    invMass: 1 / mp.mass,
    static: false,
    anchored: false,
    planar: false,
    rigid: true,
    gravity: opts.gravity ? { x: +opts.gravity.x || 0, y: +opts.gravity.y || 0, z: +opts.gravity.z || 0 } : null,
    gravityWell: opts.gravityWell || null,
    _terrTick: -1,
    colZ0: 0,
    colZ1: 0,
    joints: null,
    friction: Number.isFinite(opts.friction) ? opts.friction : rc.friction,
    nodeDamping: null,
    activeThreshold: null,
    invInertiaLocal: invert3(mp.inertia),
    inertiaLocal: mp.inertia,
    radius: rad,
    config: D.config,
    nodeStore: null,
    beamStore: null,
    cellSize: cs,              // „komórka” klastra = średnica najmniejszego punktu (zapasy siatek par)
    activeNodes: n,            // punkty styku (lustro encji: zmiana = rewizja)
    liveBeams: 0,
    dead: false,
    isWreck: false,
    noSplit: true,
    rammingMassMult: 1,
    collisionArmor: Number.isFinite(opts.collisionArmor) && opts.collisionArmor > 0 ? opts.collisionArmor : 1,
    meshDirty: false,
    structureDirty: false,
    isSleeping: false,
    sleepFrames: 0,            // kroki spokoju w styku (sen)
    wakeHold: 0,
    noCollide: false,          // gra (HullBodies.step): encja bez kolizji — bez par

    _rot: new Float64Array(9),
    _rotTick: -1,
    _geomVer: 0,
    entity: null,
    hull: null,
    // punkty styku i bloki (SoA, układ ciała); ox/oy/oz — punkty obrócone do świata (bez przesunięcia), ważne dla
    // rotTick (obrót ciała zmienia tylko integrate — w kroku kolizji stały); min/max — obrys obróconych punktów
    rg: {
      n, lx, ly, lz, r, blk, maxR,
      ox: new Float64Array(n), oy: new Float64Array(n), oz: new Float64Array(n),
      Iw: new Float64Array(9),
      rotTick: -1,
      // teren: promień pod punktami z pierwszej iteracji (druga bez odczytów) i normalna pod środkiem ciała
      tr: new Float64Array(n), trOk: new Uint8Array(n), trTick: -1, trT: null, tf: Float64Array.of(0, 0, 0, 1),
      // obrys obróconych punktów (min xyz, max xyz) — tablica: zapis liczb zmiennoprzecinkowych w pola tego dużego
      // obiektu alokował w każdym kroku (pomiar 2026-11-04)
      box: new Float64Array(6),
      blockCount: nb, blockMass: Float64Array.from(desc.blockMass), blockBox,
      blockId: Int32Array.from(desc.blockId),
      touch: 0,                // styk w tym kroku (warunek snu — swobodny lot nie zasypia)
      // PODPORY z ostatniego kroku na jawie (śpiący / zamrożony budzi się, gdy któraś zniknie — recenzja E2, zgł. 4/12):
      // do 4 partnerów styku (ciało albo teren — supK 0 / 1) z liczbą żywych węzłów ciała przy styku (supN), pole płyty
      // (supF) z prostokątem komórek styku i sumą ich grubości: pf = [iu0, iu1, iv0, iv1, suma, wersja pola]
      sup: [null, null, null, null], supK: new Int32Array(4), supN: new Int32Array(4), nSup: 0,
      supF: null, pf: new Int32Array(6),
      // pchanie śpiącego przez ciało na jawie: pw = [nadmiar impulsu w bok ponad tarcie podparcia (seria kroków), krok]
      pw: new Float64Array(2),
      pushed: 0,               // styk ze swobodnym ciałem belek w tym kroku (budżet aktywnych go nie usypia)
      // poza z końca poprzedniego kroku (sen: ruch NETTO — ciało w stosie trzymane korektą przenikania ma prędkość
      // resztkową, ale stoi)
      lp: Float64Array.of(px, py, pz, quat.x, quat.y, quat.z, quat.w)
    }
  };
  return body;
}

// ============================ STAN KROKU (bez alokacji) ============================

const RS = {
  list: [],                         // klastry kroku w kolejności listy bodies (pierwsze RS.n; reszta — null)
  n: 0,
  beams: new Int32Array(64), nBeams: 0,
  // siatka par (hasz komórek jak _broadphase silnika)
  head: new Int32Array(4096), next: new Int32Array(1024), owner: new Int32Array(1024), entries: 0,
  range: new Int32Array(64 * 6),
  big: new Int32Array(64), nBig: 0,
  seen: new Int32Array(64), seenMark: 0,
  // pary klaster × klaster (indeksy w list) i klaster × ciało belek (indeks klastra, indeks w bodies)
  rrA: new Int32Array(256), rrB: new Int32Array(256), nRR: 0, rrQA: new Int32Array(256), rrQB: new Int32Array(256),
  rbR: new Int32Array(64), rbB: new Int32Array(64), nRB: 0, rbQR: new Int32Array(64), rbQB: new Int32Array(64),
  // punkty w obszarze nakładania
  la: new Int32Array(256), lb: new Int32Array(256),
  // styki klaster × ciało belek
  cN: new Int32Array(512), cD: new Float64Array(512), cK: new Int32Array(512), nC: 0,
  nodeSeen: new Int32Array(0), nodeGen: 0,
  // budżet
  cand: new Int32Array(64),
  // krok i obrys ciała belek do considerRB: pola (liczby zmiennoprzecinkowe przekazane jako argumenty funkcji
  // niewklejonej V8 pakuje w obiekty — alokacja na wywołanie), nie argumenty
  f: new Float64Array(10)         // [dt, bx0, bx1, by0, by1, bz0, bz1, penMax, bok siatki par, 1 / bok]
};

function growI32(a, n) { const b = new Int32Array(Math.max(n, a.length * 2)); b.set(a); return b; }

// Obrót punktów klastra do świata (bez przesunięcia) i ich obrys — raz na krok dla ciała obudzonego.
function refreshRigidPose(D, b) {
  const g = b.rg;
  if (g.rotTick === D._tick || (b.isSleeping && g.rotTick >= 0)) return;
  const m = D._refreshRot(b);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
  const lx = g.lx, ly = g.ly, lz = g.lz, r = g.r, ox = g.ox, oy = g.oy, oz = g.oz;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < g.n; k++) {
    const x = lx[k], y = ly[k], z = lz[k], rr = r[k];
    const X = m0 * x + m1 * y + m2 * z, Y = m3 * x + m4 * y + m5 * z, Z = m6 * x + m7 * y + m8 * z;
    ox[k] = X; oy[k] = Y; oz[k] = Z;
    if (X - rr < x0) x0 = X - rr; if (X + rr > x1) x1 = X + rr;
    if (Y - rr < y0) y0 = Y - rr; if (Y + rr > y1) y1 = Y + rr;
    if (Z - rr < z0) z0 = Z - rr; if (Z + rr > z1) z1 = Z + rr;
  }
  if (x0 === Infinity) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
  const bx = g.box;
  bx[0] = x0; bx[1] = y0; bx[2] = z0; bx[3] = x1; bx[4] = y1; bx[5] = z1;
  // I⁻¹ w świecie: R · I⁻¹ · Rᵀ (skala taranu jak applyInvInertia silnika)
  const I = b.invInertiaLocal, Iw = g.Iw, sc = 1 / Math.max(1e-6, b.rammingMassMult);
  for (let i = 0; i < 3; i++) {
    const r0 = m[i * 3], r1 = m[i * 3 + 1], r2 = m[i * 3 + 2];
    const t0 = r0 * I[0] + r1 * I[3] + r2 * I[6], t1 = r0 * I[1] + r1 * I[4] + r2 * I[7], t2 = r0 * I[2] + r1 * I[5] + r2 * I[8];
    for (let j = 0; j < 3; j++) Iw[i * 3 + j] = (t0 * m[j * 3] + t1 * m[j * 3 + 1] + t2 * m[j * 3 + 2]) * sc;
  }
  g.rotTick = D._tick;
}

// Śpiący (nie zamrożony) klaster się budzi: znów całkowany, liczy pary i teren.
function wakeRigid(b) {
  b.isSleeping = false;
  b.sleepFrames = 0;
  const lp = b.rg.lp;
  lp[0] = b.pos.x; lp[1] = b.pos.y; lp[2] = b.pos.z; lp[3] = b.quat.x; lp[4] = b.quat.y; lp[5] = b.quat.z; lp[6] = b.quat.w;
}

const bodySpeed = (b) => Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z) +
  Math.sqrt(b.angVel.x * b.angVel.x + b.angVel.y * b.angVel.y + b.angVel.z * b.angVel.z) * b.radius;

// ============================ PODPORY I PCHANIE ŚPIĄCEGO ============================

// Partner styku klastra na jawie (ciało — kind 0, teren — 1) do listy podpór (bez powtórzeń, najwyżej 4).
function noteSupport(g, p, kind) {
  const n = g.nSup;
  for (let i = 0; i < n; i++) if (g.sup[i] === p) return;
  if (n >= 4) return;
  g.sup[n] = p; g.supK[n] = kind; g.supN[n] = kind === 0 ? (p.activeNodes | 0) : 0;
  g.nSup = n + 1;
}

// Przyspieszenie grawitacji ciała (studnia — wzór integrate, albo wektor) → out [gx, gy, gz].
function gravityInto(b, out) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  const gw = b.gravityWell;
  if (gw !== null && gw !== undefined) {
    const gx = gw.x - b.pos.x, gy = gw.y - b.pos.y, gz = gw.z - b.pos.z;
    const d2 = gx * gx + gy * gy + gz * gz;
    if (d2 > 1e-6) {
      const a = (gw.r0 > 0 ? gw.g * (gw.r0 * gw.r0) / d2 : gw.g) / Math.sqrt(d2);
      out[0] = gx * a; out[1] = gy * a; out[2] = gz * a;
    }
  } else if (b.gravity) { out[0] = b.gravity.x; out[1] = b.gravity.y; out[2] = b.gravity.z; }
}

// Impuls na ŚPIĄCY klaster S od ciała na jawie (PUSH[0..2], świat): część w bok (względem grawitacji S) ponad tarcie
// podparcia μ · (ciężar · dt + docisk) zbiera się w serii kolejnych kroków; ponad masa × pushWakeDv — S się budzi.
// Leżący stos (normalne pionowe, tarcie ≤ μ · docisk) nie budzi podpory; statek pchający gruz w bok — budzi (zgł. 3).
const PUSH = new Float64Array(3);
const GV = new Float64Array(3);
function notePush(D, S) {
  const g = S.rg, pw = g.pw;
  gravityInto(S, GV);
  const jx = PUSH[0], jy = PUSH[1], jz = PUSH[2];
  const gl = Math.sqrt(GV[0] * GV[0] + GV[1] * GV[1] + GV[2] * GV[2]);
  let lat = 0, press = 0;
  if (gl > 1e-9) {
    const ux = GV[0] / gl, uy = GV[1] / gl, uz = GV[2] / gl;
    const jg = jx * ux + jy * uy + jz * uz;
    const lx = jx - jg * ux, ly = jy - jg * uy, lz = jz - jg * uz;
    lat = Math.sqrt(lx * lx + ly * ly + lz * lz);
    press = jg > 0 ? jg : 0;
  } else lat = Math.sqrt(jx * jx + jy * jy + jz * jz);
  const mu = typeof S.friction === 'number' ? S.friction : D.config.friction;
  const excess = lat - mu * (S.mass * gl * RS.f[0] + press);
  if (!(excess > 0)) return;
  if (pw[1] < D._tick - 1) pw[0] = 0;
  pw[0] += excess; pw[1] = D._tick;
  if (pw[0] > S.mass * D.rigidConfig.pushWakeDv) { wakeRigid(S); pw[0] = 0; }
}

/**
 * Czy podpora śpiącego / zamrożonego klastra zniknęła (1 / 0): partner martwy albo nieobecny w kroku (encja zwolniona —
 * update odświeża obrót każdego ciała kroku: _rotTick), ciało belek straciło węzły od styku, ruszyło (szybciej niż
 * 2 × sleepSpeed — klaster: wakeSpeed), teren zdjęty, komórki płyty pod nim cieńsze (sprawdzane przy zmianie wersji
 * pola i co supportPeriod120 kroków — także edycja grubości z zewnątrz bez wersji).
 */
function supportLost(D, b) {
  const g = b.rg, rc = D.rigidConfig;
  for (let i = 0; i < g.nSup; i++) {
    const p = g.sup[i];
    if (g.supK[i] === 1) { if (D.terrains.indexOf(p) < 0) return 1; continue; }
    if (p.dead || p._rotTick !== D._tick || p.activeNodes < g.supN[i]) return 1;
    if (p.static || p.anchored) continue;
    if (p.rigid === true && p.isSleeping) continue;
    const lim = p.rigid === true ? rc.wakeSpeed : 2 * rc.sleepSpeed;
    if (p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z > lim * lim) return 1;
  }
  const F = g.supF;
  if (F !== null) {
    if (D.plateFields.indexOf(F) < 0) return 1;
    const pf = g.pf;
    if (F.version !== pf[5] || (D._tick + b.id) % ticksAt120(rc.supportPeriod120, RS.f[0]) === 0) {
      let sum = 0;
      const nu = F.nu, thick = F.thick;
      for (let iv = pf[2]; iv <= pf[3]; iv++) for (let iu = pf[0]; iu <= pf[1]; iu++) sum += thick[iu + iv * nu];
      if (sum < pf[4]) return 1;
      pf[5] = F.version;
    }
  }
  return 0;
}

/**
 * Styk klastra na jawie z polem płyty (beamPlateField3D): komórki styku (F._cells, F._nCells) jako podpora — prostokąt
 * i suma grubości (supportLost).
 */
export function noteRigidPlateSupport(b, F) {
  const g = b.rg, pf = g.pf, nu = F.nu, cells = F._cells;
  let iu0 = 1 << 30, iu1 = -1, iv0 = 1 << 30, iv1 = -1;
  for (let q = 0; q < F._nCells; q++) {
    const c = cells[q], iu = c % nu, iv = (c - iu) / nu;
    if (iu < iu0) iu0 = iu; if (iu > iu1) iu1 = iu;
    if (iv < iv0) iv0 = iv; if (iv > iv1) iv1 = iv;
  }
  if (iu1 < 0) return;
  let sum = 0;
  for (let iv = iv0; iv <= iv1; iv++) for (let iu = iu0; iu <= iu1; iu++) sum += F.thick[iu + iv * nu];
  g.supF = F;
  pf[0] = iu0; pf[1] = iu1; pf[2] = iv0; pf[3] = iv1; pf[4] = sum; pf[5] = F.version;
}

// ============================ RUCHLIWOŚĆ I IMPULSY ============================
//
// I⁻¹ w świecie klastra (rg.Iw = R · I⁻¹ · Rᵀ / rammingMassMult) liczony raz na krok w refreshRigidPose — obrót ciała
// zmienia tylko integrate, więc w kroku kolizji jest stały. Ruchliwości i impulsy są liczone W MIEJSCU (zmienne lokalne
// prędkości, zapis raz na końcu) — funkcja pomocnicza biorąca i zwracająca liczby zmiennoprzecinkowe pakowała je w V8
// (alokacja na każde wywołanie, gdy nie została wklejona).

// ============================ SIATKA PAR ============================

function gridInsert(i, x0, x1, y0, y1, z0, z1) {
  const head = RS.head, mask = head.length - 1;
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (RS.entries === RS.next.length) { RS.next = growI32(RS.next, RS.entries * 2); RS.owner = growI32(RS.owner, RS.entries * 2); }
    const bucket = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    RS.owner[RS.entries] = i;
    RS.next[RS.entries] = head[bucket];
    head[bucket] = RS.entries++;
  }
}

function nextSeenMark() {
  let mark = (RS.seenMark + 1) | 0;
  if (mark <= 0) { RS.seen.fill(0); mark = 1; }
  RS.seenMark = mark;
  return mark;
}

function pushRR(a, b) {
  if (RS.nRR === RS.rrA.length) {
    RS.rrA = growI32(RS.rrA, RS.nRR * 2); RS.rrB = growI32(RS.rrB, RS.nRR * 2);
    RS.rrQA = growI32(RS.rrQA, RS.nRR * 2); RS.rrQB = growI32(RS.rrQB, RS.nRR * 2);
  }
  RS.rrA[RS.nRR] = a; RS.rrB[RS.nRR] = b; RS.nRR++;
}

function pushRB(r, b) {
  if (RS.nRB === RS.rbR.length) {
    RS.rbR = growI32(RS.rbR, RS.nRB * 2); RS.rbB = growI32(RS.rbB, RS.nRB * 2);
    RS.rbQR = growI32(RS.rbQR, RS.nRB * 2); RS.rbQB = growI32(RS.rbQB, RS.nRB * 2);
  }
  RS.rbR[RS.nRB] = r; RS.rbB[RS.nRB] = b; RS.nRB++;
}

// Klaster „nieruchomy” w parze: zamrożony albo śpiący (budzi go dopiero styk szybszy niż wakeSpeed).
const fixedRigid = (b) => b.anchored || b.isSleeping;

// Tarcie ciała (null / brak = tarcie konfiguracji silnika) jako liczba — `??` z null w argumencie Math.max wyłączał
// liczbowe Math.max optymalizatora (wywołanie ogólne i pakowanie wyniku).
function frictionOf(b, cfg) {
  const f = b.friction;
  return typeof f === 'number' ? f : cfg.friction;
}

/**
 * Lista klastrów kroku, obroty punktów, siatka par (bok 2–4 × promień), pary klaster × klaster i klaster × ciało
 * belek. Raz na krok (pierwsza iteracja kolizji).
 */
function prepareStep(D, bodies) {
  const dt = RS.f[0];
  const rc = D.rigidConfig;
  const list = RS.list;
  let n = 0;
  RS.nBeams = 0;
  let sumR = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b || b.dead) continue;
    if (b.rigid === true) {
      if (b.activeNodes <= 0) continue;
      if (n === list.length) list.push(b); else list[n] = b;
      n++;
      sumR += b.radius;
      refreshRigidPose(D, b);
      if (!fixedRigid(b)) {
        // podpory od nowa w każdym kroku na jawie (śpiący trzyma listę z ostatniego — supportLost)
        const g = b.rg;
        for (let s = 0; s < g.nSup; s++) g.sup[s] = null;
        g.nSup = 0; g.supF = null; g.pushed = 0;
      }
    } else if (b.activeNodes > 0) {
      if (RS.nBeams === RS.beams.length) RS.beams = growI32(RS.beams, RS.nBeams * 2);
      RS.beams[RS.nBeams++] = i;
    }
  }
  for (let i = n; i < RS.n; i++) list[i] = null;   // bez odwołań do ciał spoza kroku
  RS.n = n;
  RS.nRR = 0; RS.nRB = 0;
  if (n === 0) return 0;
  if (RS.seen.length < n) { RS.seen = new Int32Array(Math.max(n, RS.seen.length * 2)); RS.seenMark = 0; }
  if (RS.range.length < n * 6) RS.range = new Int32Array(Math.max(n * 6, RS.range.length * 2));
  const cell = Math.max(rc.broadCellMin, rc.broadCellMul * (sumR / n));
  RS.f[8] = cell; RS.f[9] = 1 / cell;
  // tablica kubełków ~2 × wpisy (rośnie tylko ponad największy dotąd stos)
  let need = 4096; while (need < n * 16) need <<= 1;
  if (RS.head.length < need) RS.head = new Int32Array(need);
  RS.head.fill(-1);
  RS.entries = 0; RS.nBig = 0;
  const inv = RS.f[9], range = RS.range;
  for (let i = 0; i < n; i++) {
    const b = list[i], g = b.rg, o = i * 6;
    const pad = fixedRigid(b) ? 0 : bodySpeed(b) * dt * 2;
    const x0 = Math.floor((b.pos.x + g.box[0] - pad) * inv), x1 = Math.floor((b.pos.x + g.box[3] + pad) * inv);
    const y0 = Math.floor((b.pos.y + g.box[1] - pad) * inv), y1 = Math.floor((b.pos.y + g.box[4] + pad) * inv);
    const z0 = Math.floor((b.pos.z + g.box[2] - pad) * inv), z1 = Math.floor((b.pos.z + g.box[5] + pad) * inv);
    range[o] = x0; range[o + 1] = x1; range[o + 2] = y0; range[o + 3] = y1; range[o + 4] = z0; range[o + 5] = z1;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) {
      if (RS.nBig === RS.big.length) RS.big = growI32(RS.big, RS.nBig * 2);
      RS.big[RS.nBig++] = i;
      range[o] = 1; range[o + 1] = 0;
      continue;
    }
    gridInsert(i, x0, x1, y0, y1, z0, z1);
  }
  // pary klaster × klaster: wspólna komórka → test obrysów (z zapasem drogi w kroku); obie nieruchome — bez pary
  const head = RS.head, mask = head.length - 1, next = RS.next, owner = RS.owner, seen = RS.seen;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (range[o] > range[o + 1]) continue;
    const mark = nextSeenMark();
    const A = list[i];
    for (let z = range[o + 4]; z <= range[o + 5]; z++) for (let y = range[o + 2]; y <= range[o + 3]; y++) for (let x = range[o]; x <= range[o + 1]; x++) {
      const bucket = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      for (let en = head[bucket]; en >= 0; en = next[en]) {
        const j = owner[en];
        if (j <= i || seen[j] === mark) continue;
        seen[j] = mark;
        considerRR(D, list, i, j);
      }
    }
  }
  for (let q = 0; q < RS.nBig; q++) {
    const i = RS.big[q];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      // para dwóch dużych — raz (mniejszy indeks pierwszy); duży × zwykły — zawsze stąd (zwykły nie widzi dużego w siatce)
      if (RS.range[j * 6] > RS.range[j * 6 + 1] && j < i) continue;
      if (i < j) considerRR(D, list, i, j); else considerRR(D, list, j, i);
    }
  }
  // pary klaster × ciało belek: obrys ciała belek → komórki siatki klastrów
  for (let q = 0; q < RS.nBeams; q++) {
    const bi = RS.beams[q];
    const B = bodies[bi];
    const fixedB = B.static || B.anchored;
    const w = worldBounds(D, B);
    const pad = fixedB ? 0 : Math.sqrt(B.vel.x * B.vel.x + B.vel.y * B.vel.y + B.vel.z * B.vel.z) * dt * 2;
    const bx0 = w[0] - pad, bx1 = w[1] + pad, by0 = w[2] - pad, by1 = w[3] + pad, bz0 = w[4] - pad, bz1 = w[5] + pad;
    const F = RS.f;
    F[1] = bx0; F[2] = bx1; F[3] = by0; F[4] = by1; F[5] = bz0; F[6] = bz1;
    const x0 = Math.floor(bx0 * inv), x1 = Math.floor(bx1 * inv);
    const y0 = Math.floor(by0 * inv), y1 = Math.floor(by1 * inv);
    const z0 = Math.floor(bz0 * inv), z1 = Math.floor(bz1 * inv);
    const mark = nextSeenMark();
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (cells > 512 || !(cells > 0)) {
      for (let r = 0; r < n; r++) considerRB(D, list, r, B, bi, fixedB);
    } else {
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const bucket = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
        for (let en = head[bucket]; en >= 0; en = next[en]) {
          const r = owner[en];
          if (seen[r] === mark) continue;
          seen[r] = mark;
          considerRB(D, list, r, B, bi, fixedB);
        }
      }
      for (let k = 0; k < RS.nBig; k++) {
        const r = RS.big[k];
        if (seen[r] === mark) continue;
        seen[r] = mark;
        considerRB(D, list, r, B, bi, fixedB);
      }
    }
  }
  return n;
}

function considerRR(D, list, i, j) {
  const dt = RS.f[0], wakeSpeed = D.rigidConfig.wakeSpeed;
  const A = list[i], B = list[j];
  const fa = fixedRigid(A), fb = fixedRigid(B);
  if ((fa && fb) || A.noCollide === true || B.noCollide === true) return;
  const ga = A.rg, gb = B.rg;
  const pa = fa ? 0 : bodySpeed(A) * dt * 2, pb = fb ? 0 : bodySpeed(B) * dt * 2;
  const pad = pa + pb;
  if (A.pos.x + ga.box[0] - pad > B.pos.x + gb.box[3] || B.pos.x + gb.box[0] - pad > A.pos.x + ga.box[3]) return;
  if (A.pos.y + ga.box[1] - pad > B.pos.y + gb.box[4] || B.pos.y + gb.box[1] - pad > A.pos.y + ga.box[4]) return;
  if (A.pos.z + ga.box[2] - pad > B.pos.z + gb.box[5] || B.pos.z + gb.box[2] - pad > A.pos.z + ga.box[5]) return;
  // sąsiad szybszy niż wakeSpeed budzi śpiącego (podpora może odjechać spod niego)
  if (fa && !A.anchored && !fb && bodySpeed(B) > wakeSpeed) wakeRigid(A);
  else if (fb && !B.anchored && !fa && bodySpeed(A) > wakeSpeed) wakeRigid(B);
  pushRR(i, j);
}

// Obrys ciała belek w świecie [x0, x1, y0, y1, z0, z1] z promieniem węzła (ciało płaskie — słup colZ0..colZ1).
const _wb = new Float64Array(6);
function worldBounds(D, B) {
  const cfg = D.config;
  const nodeR = B.cellSize * (cfg.nodeRadius / cfg.cellSize);
  const lb = B._localBounds, m = B._rot;
  if (!lb) { _wb[0] = _wb[2] = _wb[4] = Infinity; _wb[1] = _wb[3] = _wb[5] = -Infinity; return _wb; }
  for (let i = 0; i < 3; i++) {
    const r = i * 3;
    let c = m[r] * lb[0] + m[r + 1] * lb[1] + m[r + 2] * lb[2];
    let h = Math.abs(m[r]) * lb[3] + Math.abs(m[r + 1]) * lb[4] + Math.abs(m[r + 2]) * lb[5] + nodeR;
    if (i === 2 && B.planar) { const z0 = +B.colZ0 || 0, z1 = +B.colZ1 || 0; c += (z0 + z1) * 0.5; h += (z1 - z0) * 0.5; }
    const p = i === 0 ? B.pos.x : i === 1 ? B.pos.y : B.pos.z;
    _wb[i * 2] = p + c - h; _wb[i * 2 + 1] = p + c + h;
  }
  return _wb;
}

function considerRB(D, list, r, B, bi, fixedB) {
  const F = RS.f, dt = F[0], x0 = F[1], x1 = F[2], y0 = F[3], y1 = F[4], z0 = F[5], z1 = F[6];
  const R = list[r];
  const fr = fixedRigid(R);
  if (fr && fixedB) return;
  const g = R.rg;
  const pad = fr ? 0 : bodySpeed(R) * dt * 2;
  if (R.pos.x + g.box[0] - pad > x1 || R.pos.x + g.box[3] + pad < x0) return;
  if (R.pos.y + g.box[1] - pad > y1 || R.pos.y + g.box[4] + pad < y0) return;
  if (R.pos.z + g.box[2] - pad > z1 || R.pos.z + g.box[5] + pad < z0) return;
  if (D.rigidPairFilter !== null && !D.rigidPairFilter(R, B)) return;
  pushRB(r, bi);
}

// ============================ KLASTER × KLASTER ============================

// Styki pary (punkt świata, normalna B → A, głębokość; ramiona i masy efektywne liczone przy rozwiązaniu) — bufor
// wspólny, rośnie tylko ponad największą dotąd parę.
const CC = {
  n: 0,
  px: new Float64Array(64), py: new Float64Array(64), pz: new Float64Array(64),
  nx: new Float64Array(64), ny: new Float64Array(64), nz: new Float64Array(64),
  pen: new Float64Array(64), kn: new Float64Array(64), lam: new Float64Array(64), lamT: new Float64Array(64),
  rax: new Float64Array(64), ray: new Float64Array(64), raz: new Float64Array(64),
  rbx: new Float64Array(64), rby: new Float64Array(64), rbz: new Float64Array(64),
  wax: new Float64Array(64), way: new Float64Array(64), waz: new Float64Array(64),
  wbx: new Float64Array(64), wby: new Float64Array(64), wbz: new Float64Array(64)
};
const ZERO9 = new Float64Array(9);
const CC_KEYS = ['px', 'py', 'pz', 'nx', 'ny', 'nz', 'pen', 'kn', 'lam', 'lamT', 'rax', 'ray', 'raz', 'rbx', 'rby', 'rbz',
  'wax', 'way', 'waz', 'wbx', 'wby', 'wbz'];

function growCC() {
  const n2 = CC.px.length * 2;
  for (const k of CC_KEYS) {
    const a = new Float64Array(n2); a.set(CC[k]); CC[k] = a;
  }
}

const _hook = { blkA: -1, blkB: -1 };

/** Styk dwóch klastrów; zwraca liczbę par kul w styku. */
function collideRR(D, A, B, doDamage) {
  const ga = A.rg, gb = B.rg;
  const ax = A.pos.x, ay = A.pos.y, az = A.pos.z, bx = B.pos.x, by = B.pos.y, bz = B.pos.z;
  // obszar nakładania obrysów (kule punktów są w obrysach)
  const ox0 = Math.max(ax + ga.box[0], bx + gb.box[0]), ox1 = Math.min(ax + ga.box[3], bx + gb.box[3]);
  if (ox0 > ox1) return 0;
  const oy0 = Math.max(ay + ga.box[1], by + gb.box[1]), oy1 = Math.min(ay + ga.box[4], by + gb.box[4]);
  if (oy0 > oy1) return 0;
  const oz0 = Math.max(az + ga.box[2], bz + gb.box[2]), oz1 = Math.min(az + ga.box[5], bz + gb.box[5]);
  if (oz0 > oz1) return 0;
  RIGID_PERF.narrow++;
  // punkty obu ciał, których kule sięgają obszaru (zwykle kilka z 32)
  let la = RS.la, lb = RS.lb;
  if (la.length < ga.n) la = RS.la = new Int32Array(Math.max(ga.n, la.length * 2));
  if (lb.length < gb.n) lb = RS.lb = new Int32Array(Math.max(gb.n, lb.length * 2));
  let nA = 0, nB = 0;
  const aox = ga.ox, aoy = ga.oy, aoz = ga.oz, ar = ga.r;
  for (let k = 0; k < ga.n; k++) {
    const x = aox[k] + ax, y = aoy[k] + ay, z = aoz[k] + az, r = ar[k];
    if (x + r < ox0 || x - r > ox1 || y + r < oy0 || y - r > oy1 || z + r < oz0 || z - r > oz1) continue;
    la[nA++] = k;
  }
  if (nA === 0) return 0;
  const box = gb.ox, boy = gb.oy, boz = gb.oz, br = gb.r;
  for (let k = 0; k < gb.n; k++) {
    const x = box[k] + bx, y = boy[k] + by, z = boz[k] + bz, r = br[k];
    if (x + r < ox0 || x - r > ox1 || y + r < oy0 || y - r > oy1 || z + r < oz0 || z - r > oz1) continue;
    lb[nB++] = k;
  }
  if (nB === 0) return 0;
  let count = 0, penMax = 0, deepA = -1, deepB = -1;
  for (let p = 0; p < nA; p++) {
    const ka = la[p];
    const xa = aox[ka] + ax, ya = aoy[ka] + ay, za = aoz[ka] + az, ra = ar[ka];
    for (let q = 0; q < nB; q++) {
      const kb = lb[q];
      const dx = xa - (box[kb] + bx), dy = ya - (boy[kb] + by), dz = za - (boz[kb] + bz);
      const rr = ra + br[kb];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const pen = rr - d;
      if (count === CC.px.length) growCC();
      // punkt styku: na odcinku środków, w środku przenikania
      const t = d > 1e-9 ? (ra - pen * 0.5) / d : 0;
      CC.px[count] = xa - dx * t; CC.py[count] = ya - dy * t; CC.pz[count] = za - dz * t;
      if (d > 1e-9) { CC.nx[count] = dx / d; CC.ny[count] = dy / d; CC.nz[count] = dz / d; }
      else {
        // środki kul się pokrywają: od środka B do środka A
        let ex = ax - bx, ey = ay - by, ez = az - bz; const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el > 1e-9) { ex /= el; ey /= el; ez /= el; } else { ex = 0; ey = 0; ez = 1; }
        CC.nx[count] = ex; CC.ny[count] = ey; CC.nz[count] = ez;
      }
      CC.pen[count] = pen;
      if (pen > penMax) { penMax = pen; deepA = ka; deepB = kb; }
      count++;
    }
  }
  if (count === 0) return 0;
  CC.n = count;
  _hook.blkA = deepA >= 0 ? ga.blockId[ga.blk[deepA]] : -1;
  _hook.blkB = deepB >= 0 ? gb.blockId[gb.blk[deepB]] : -1;
  RS.f[7] = penMax;
  resolveRigidPair(D, A, B, doDamage);
  return count;
}

/**
 * Styki pary klastrów (bufor CC, normalne B → A) — IMPULSY SEKWENCYJNE na styk (rc.pairPasses przejść w parze,
 * impuls normalny skumulowany ≥ 0, tarcie Coulomba skumulowane ≤ μ · impuls normalny): klocek na klocku dostaje
 * podparcie w każdym narożniku, więc stos się nie kołysze (jeden impuls zbiorczy w środku styku nie gasił obrotu przy
 * kilku normalnych naraz). Restytucja rc.restitution, korekta przenikania wzdłuż średniej normalnej (rc.separation).
 * Śpiący klaster jest podporą, chyba że zbliżanie przekracza wakeSpeed (wtedy się budzi).
 * Prędkości obu ciał w zmiennych lokalnych przez całe przejścia (zapis raz na końcu), I⁻¹ w świecie z rg.Iw, człony
 * obrotowe normalnej (I⁻¹ (r × n)) policzone raz na styk — bez wywołań z liczbami w gorącej pętli (V8 pakowałby
 * każdą liczbę zmiennoprzecinkową przekazaną do funkcji niewklejonej — alokacja na impuls).
 */
function resolveRigidPair(D, A, B, doDamage) {
  const dt = RS.f[0], penMax = RS.f[7];
  const cfg = D.config, rc = D.rigidConfig;
  const n = CC.n;
  const pAx = A.pos.x, pAy = A.pos.y, pAz = A.pos.z, pBx = B.pos.x, pBy = B.pos.y, pBz = B.pos.z;
  let avx = A.vel.x, avy = A.vel.y, avz = A.vel.z, awx = A.angVel.x, awy = A.angVel.y, awz = A.angVel.z;
  let bvx = B.vel.x, bvy = B.vel.y, bvz = B.vel.z, bwx = B.angVel.x, bwy = B.angVel.y, bwz = B.angVel.z;
  const PX = CC.px, PY = CC.py, PZ = CC.pz, NX = CC.nx, NY = CC.ny, NZ = CC.nz;
  // średnia normalna (ważona głębokością) i największe zbliżanie — budzenie, korekta, tłumienie spoczynku
  let mx = 0, my = 0, mz = 0, vmin = 0;
  for (let c = 0; c < n; c++) {
    const nx = NX[c], ny = NY[c], nz = NZ[c], w = CC.pen[c];
    mx += nx * w; my += ny * w; mz += nz * w;
    const rAx = PX[c] - pAx, rAy = PY[c] - pAy, rAz = PZ[c] - pAz;
    const rBx = PX[c] - pBx, rBy = PY[c] - pBy, rBz = PZ[c] - pBz;
    const vn = (avx + awy * rAz - awz * rAy - bvx - (bwy * rBz - bwz * rBy)) * nx +
      (avy + awz * rAx - awx * rAz - bvy - (bwz * rBx - bwx * rBz)) * ny +
      (avz + awx * rAy - awy * rAx - bvz - (bwx * rBy - bwy * rBx)) * nz;
    if (vn < vmin) vmin = vn;
  }
  const ml = Math.sqrt(mx * mx + my * my + mz * mz);
  if (ml > 1e-9) { mx /= ml; my /= ml; mz /= ml; } else { mx = NX[0]; my = NY[0]; mz = NZ[0]; }
  let fa = fixedRigid(A), fb = fixedRigid(B);
  if (-vmin > rc.wakeSpeed) {
    if (fa && !A.anchored) { wakeRigid(A); fa = false; }
    if (fb && !B.anchored) { wakeRigid(B); fb = false; }
  }
  A.rg.touch = 1; B.rg.touch = 1;
  RIGID_PERF.contacts += n;
  if (fa && fb) return;
  if (!fa) noteSupport(A.rg, B, 0);
  if (!fb) noteSupport(B.rg, A, 0);
  const invA = fa ? 0 : 1 / Math.max(1e-9, A.mass * A.rammingMassMult);
  const invB = fb ? 0 : 1 / Math.max(1e-9, B.mass * B.rammingMassMult);
  const IA = fa ? ZERO9 : A.rg.Iw, IB = fb ? ZERO9 : B.rg.Iw;
  const a0 = IA[0], a1 = IA[1], a2 = IA[2], a3 = IA[3], a4 = IA[4], a5 = IA[5], a6 = IA[6], a7 = IA[7], a8 = IA[8];
  const b0 = IB[0], b1 = IB[1], b2 = IB[2], b3 = IB[3], b4 = IB[4], b5 = IB[5], b6 = IB[6], b7 = IB[7], b8 = IB[8];
  const fA = frictionOf(A, cfg), fB = frictionOf(B, cfg);
  const mu = fA > fB ? fA : fB;
  const e = rc.restitution;
  const RAX = CC.rax, RAY = CC.ray, RAZ = CC.raz, RBX = CC.rbx, RBY = CC.rby, RBZ = CC.rbz;
  const WAX = CC.wax, WAY = CC.way, WAZ = CC.waz, WBX = CC.wbx, WBY = CC.wby, WBZ = CC.wbz;
  const KN = CC.kn, LAM = CC.lam, LAMT = CC.lamT;
  for (let c = 0; c < n; c++) {
    const nx = NX[c], ny = NY[c], nz = NZ[c];
    const rAx = PX[c] - pAx, rAy = PY[c] - pAy, rAz = PZ[c] - pAz;
    const rBx = PX[c] - pBx, rBy = PY[c] - pBy, rBz = PZ[c] - pBz;
    RAX[c] = rAx; RAY[c] = rAy; RAZ[c] = rAz; RBX[c] = rBx; RBY[c] = rBy; RBZ[c] = rBz;
    // I⁻¹ (r × n) obu ciał
    const cax = rAy * nz - rAz * ny, cay = rAz * nx - rAx * nz, caz = rAx * ny - rAy * nx;
    const cbx = rBy * nz - rBz * ny, cby = rBz * nx - rBx * nz, cbz = rBx * ny - rBy * nx;
    const wax = a0 * cax + a1 * cay + a2 * caz, way = a3 * cax + a4 * cay + a5 * caz, waz = a6 * cax + a7 * cay + a8 * caz;
    const wbx = b0 * cbx + b1 * cby + b2 * cbz, wby = b3 * cbx + b4 * cby + b5 * cbz, wbz = b6 * cbx + b7 * cby + b8 * cbz;
    WAX[c] = wax; WAY[c] = way; WAZ[c] = waz; WBX[c] = wbx; WBY[c] = wby; WBZ[c] = wbz;
    KN[c] = invA + invB + (cax * wax + cay * way + caz * waz) + (cbx * wbx + cby * wby + cbz * wbz);
    LAM[c] = 0; LAMT[c] = 0;
  }
  let Jx = 0, Jy = 0, Jz = 0;
  const passes = Math.max(1, rc.pairPasses | 0);
  for (let pass = 0; pass < passes; pass++) {
    const bounce = pass === 0 ? 1 + e : 1;
    for (let c = 0; c < n; c++) {
      const kn = KN[c];
      if (!(kn > 1e-12)) continue;
      const nx = NX[c], ny = NY[c], nz = NZ[c];
      const rAx = RAX[c], rAy = RAY[c], rAz = RAZ[c], rBx = RBX[c], rBy = RBY[c], rBz = RBZ[c];
      let dvx = avx + (awy * rAz - awz * rAy) - (bvx + (bwy * rBz - bwz * rBy));
      let dvy = avy + (awz * rAx - awx * rAz) - (bvy + (bwz * rBx - bwx * rBz));
      let dvz = avz + (awx * rAy - awy * rAx) - (bvz + (bwx * rBy - bwy * rBx));
      const vn = dvx * nx + dvy * ny + dvz * nz;
      const old = LAM[c];
      let lam = old - (vn * bounce) / kn;
      if (lam < 0) lam = 0;
      const dl = lam - old;
      LAM[c] = lam;
      if (dl !== 0) {
        avx += nx * dl * invA; avy += ny * dl * invA; avz += nz * dl * invA;
        awx += WAX[c] * dl; awy += WAY[c] * dl; awz += WAZ[c] * dl;
        bvx -= nx * dl * invB; bvy -= ny * dl * invB; bvz -= nz * dl * invB;
        bwx -= WBX[c] * dl; bwy -= WBY[c] * dl; bwz -= WBZ[c] * dl;
        Jx += nx * dl; Jy += ny * dl; Jz += nz * dl;
        // prędkość względna w styku po impulsie normalnym
        dvx = avx + (awy * rAz - awz * rAy) - (bvx + (bwy * rBz - bwz * rBy));
        dvy = avy + (awz * rAx - awx * rAz) - (bvy + (bwz * rBx - bwx * rBz));
        dvz = avz + (awx * rAy - awy * rAx) - (bvz + (bwx * rBy - bwy * rBx));
      }
      // tarcie: w kierunku poślizgu, skumulowane ≤ μ · impuls normalny
      const avail = mu * lam - LAMT[c];
      if (!(avail > 0)) continue;
      const vn2 = dvx * nx + dvy * ny + dvz * nz;
      let tx = dvx - nx * vn2, ty = dvy - ny * vn2, tz = dvz - nz * vn2;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (!(tl > 1e-6)) continue;
      tx /= tl; ty /= tl; tz /= tl;
      const cax = rAy * tz - rAz * ty, cay = rAz * tx - rAx * tz, caz = rAx * ty - rAy * tx;
      const cbx = rBy * tz - rBz * ty, cby = rBz * tx - rBx * tz, cbz = rBx * ty - rBy * tx;
      const tax = a0 * cax + a1 * cay + a2 * caz, tay = a3 * cax + a4 * cay + a5 * caz, taz = a6 * cax + a7 * cay + a8 * caz;
      const tbx = b0 * cbx + b1 * cby + b2 * cbz, tby = b3 * cbx + b4 * cby + b5 * cbz, tbz = b6 * cbx + b7 * cby + b8 * cbz;
      const kt = invA + invB + (cax * tax + cay * tay + caz * taz) + (cbx * tbx + cby * tby + cbz * tbz);
      if (!(kt > 1e-12)) continue;
      let jt = tl / kt;
      if (jt > avail) jt = avail;
      LAMT[c] += jt;
      avx -= tx * jt * invA; avy -= ty * jt * invA; avz -= tz * jt * invA;
      awx -= tax * jt; awy -= tay * jt; awz -= taz * jt;
      bvx += tx * jt * invB; bvy += ty * jt * invB; bvz += tz * jt * invB;
      bwx += tbx * jt; bwy += tby * jt; bwz += tbz * jt;
      Jx -= tx * jt; Jy -= ty * jt; Jz -= tz * jt;
    }
  }
  // leżący stos: wolny styk (osiadanie) tłumi obrót obu ciał — rozłożone podparcie gasi kołysanie
  if (doDamage && -vmin < rc.restSpeed && rc.restDamp > 0 && n >= 2) {
    const k = Math.exp(-rc.restDamp * dt * Math.min(1, n / 8));
    if (!fa) { awx *= k; awy *= k; awz *= k; }
    if (!fb) { bwx *= k; bwy *= k; bwz *= k; }
  }
  if (!fa) { A.vel.x = avx; A.vel.y = avy; A.vel.z = avz; A.angVel.x = awx; A.angVel.y = awy; A.angVel.z = awz; }
  if (!fb) { B.vel.x = bvx; B.vel.y = bvy; B.vel.z = bvz; B.angVel.x = bwx; B.angVel.y = bwy; B.angVel.z = bwz; }
  // śpiący (nie zamrożony) pchany przez klaster na jawie — impuls, który go „trzymał” (J na A, −J na B)
  if (doDamage && fb && !B.anchored) { PUSH[0] = -Jx; PUSH[1] = -Jy; PUSH[2] = -Jz; notePush(D, B); }
  else if (doDamage && fa && !A.anchored) { PUSH[0] = Jx; PUSH[1] = Jy; PUSH[2] = Jz; notePush(D, A); }
  // korekta przenikania wzdłuż średniej normalnej (najgłębszy styk; łagodnie — rc.separation na 1/60 s)
  const slop = cfg.separationSlop;
  if (penMax > slop) {
    const separation = 1 - Math.pow(1 - rc.separation, dt * 60);
    const corr = (penMax - slop) * separation / (invA + invB);
    A.pos.x += mx * corr * invA; A.pos.y += my * corr * invA; A.pos.z += mz * corr * invA;
    B.pos.x -= mx * corr * invB; B.pos.y -= my * corr * invB; B.pos.z -= mz * corr * invB;
  }
  D._touchGeometry(A); D._touchGeometry(B);
  if (doDamage && D.onRigidContact !== null && (Jx !== 0 || Jy !== 0 || Jz !== 0)) {
    let hx = 0, hy = 0, hz = 0;
    for (let c = 0; c < n; c++) { hx += PX[c]; hy += PY[c]; hz += PZ[c]; }
    hx /= n; hy /= n; hz /= n;
    D.onRigidContact(A, _hook.blkA, Jx, Jy, Jz, hx, hy, hz);
    D.onRigidContact(B, _hook.blkB, -Jx, -Jy, -Jz, hx, hy, hz);
  }
}

// ============================ KLASTER × CIAŁO BELEK ============================

// Ciało belek pary (ustawiane raz na parę — pętle punktów czytają stąd, bez długich list argumentów).
const PB = {
  B: null, planar: false, heads: null, map: null, i0: 0, j0: 0, k0: 0, gnx: 0, gny: 0, gnz: 0, cs: 1, nodeR: 1,
  X: null, Y: null, Z: null, next: null, surface: null, active: null,
  colZ0: 0, colZ1: 0, zLo: 0, zHi: 0, kz0: 0, kz1: 0, up: true,
  minX: 0, maxX: 0, minY: 0, maxY: 0,
  gen: 0, seen: null,
  // punkt zapytania (układ ciała belek) i zasięg: q = [x, y, z, zasięg] — tablica, nie argumenty ani pola obiektu
  // (bez pakowania liczb zmiennoprzecinkowych)
  q: new Float64Array(4)
};
// suma styków punktu (lokalnie w układzie ciała belek)
// [liczba, nx, ny, nz, hx, hy, hz, największa głębokość, punkt najgłębszy] — tablica (bez pakowania liczb)
const ACC = new Float64Array(9);
// styk pary klaster × ciało belek do rozwiązania: [hx, hy, hz, nx, ny, nz, głębokość]; I⁻¹ w świecie ciała belek
const HB = new Float64Array(7);
const IWB = new Float64Array(9);

function hashKey(i, j, k) {
  return ((i + 512) | 0) | (((j + 512) | 0) << 10) | (((k + 512) | 0) << 20);
}

function bucketAt(i, j, k) {
  if (PB.map !== null) {
    const h = PB.map.get(hashKey(i, j, k));
    return h === undefined ? -1 : h;
  }
  const ci = i - PB.i0, cj = j - PB.j0, ck = k - PB.k0;
  if (ci < 0 || cj < 0 || ck < 0 || ci >= PB.gnx || cj >= PB.gny || ck >= PB.gnz) return -1;
  return PB.heads[ci + PB.gnx * (cj + PB.gny * ck)];
}

/**
 * Węzły ciała belek w zasięgu kuli punktu (q — układ ciała belek, `reach` = promień punktu + promień węzła). record —
 * dopisz styki (każdy węzeł raz na parę), inaczej tylko sprawdź, czy jest jakikolwiek. Ciało płaskie: słup węzła
 * (colZ0..colZ1) jak para mieszana silnika — nad / pod słupem kapsuła, w jego wysokości wyjście w bok (węzeł brzegu)
 * albo pionowe (pod prąd ruchu w pionie, głębokość przycięta do zasięgu). Normalne B → klaster.
 */
function pointContacts(k, record) {
  const Q = PB.q, qx = Q[0], qy = Q[1], qz = Q[2], reach = Q[3];
  const cs = PB.cs, X = PB.X, Y = PB.Y, Z = PB.Z, next = PB.next;
  const r2 = reach * reach;
  const i0 = Math.floor((qx - reach) / cs), i1 = Math.floor((qx + reach) / cs);
  const j0 = Math.floor((qy - reach) / cs), j1 = Math.floor((qy + reach) / cs);
  let kz0 = 0, kz1 = 0;
  const planar = PB.planar;
  if (planar) { kz0 = PB.kz0; kz1 = PB.kz1; } else { kz0 = Math.floor((qz - reach) / cs); kz1 = Math.floor((qz + reach) / cs); }
  // Kubełki: gęsta siatka — zakres przycięty do siatki i indeks wprost (bez wywołania na kubełek), kubełek dalej od
  // punktu niż zasięg (pudło komórki) pominięty — kula zasięgu ~1,2 komórki dotyka 27–64 kubełków, w zasięgu jest
  // połowa (recenzja E2, zgł. 10: para klaster × bryła 13 tys. węzłów ~10 µs).
  const dense = PB.map === null;
  const heads = PB.heads, gi0 = PB.i0, gj0 = PB.j0, gk0 = PB.k0, gnx = PB.gnx, gny = PB.gny;
  let ia = i0, ib = i1, ja = j0, jb = j1;
  if (dense) {
    if (ia < gi0) ia = gi0; if (ib > gi0 + gnx - 1) ib = gi0 + gnx - 1;
    if (ja < gj0) ja = gj0; if (jb > gj0 + gny - 1) jb = gj0 + gny - 1;
    if (kz0 < gk0) kz0 = gk0; if (kz1 > gk0 + PB.gnz - 1) kz1 = gk0 + PB.gnz - 1;
  }
  let found = 0;
  for (let kk = kz0; kk <= kz1; kk++) {
    let dz2 = 0;
    if (!planar) {
      const zl = kk * cs, dz = qz < zl ? zl - qz : (qz > zl + cs ? qz - zl - cs : 0);
      dz2 = dz * dz;
      if (dz2 >= r2) continue;
    }
    for (let j = ja; j <= jb; j++) {
      const yl = j * cs, dy0 = qy < yl ? yl - qy : (qy > yl + cs ? qy - yl - cs : 0);
      const dyz = dz2 + dy0 * dy0;
      if (dyz >= r2) continue;
      for (let i = ia; i <= ib; i++) {
        const xl = i * cs, dx0 = qx < xl ? xl - qx : (qx > xl + cs ? qx - xl - cs : 0);
        if (dyz + dx0 * dx0 >= r2) continue;
        const h0 = dense ? heads[(i - gi0) + gnx * ((j - gj0) + gny * (kk - gk0))] : bucketAt(i, j, kk);
          for (let h = h0; h >= 0; h = next[h]) {
            const dx = qx - X[h], dy = qy - Y[h];
            let pen = 0, lnx = 0, lny = 0, lnz = 0;
            if (PB.planar) {
              const zLoN = Z[h] + PB.colZ0, zHiN = Z[h] + PB.colZ1;
              const dxy2 = dx * dx + dy * dy;
              if (dxy2 >= r2) continue;
              if (qz > zHiN || qz < zLoN) {
                const dz = qz > zHiN ? qz - zHiN : qz - zLoN;
                const d2 = dxy2 + dz * dz;
                if (d2 >= r2) continue;
                const d = Math.sqrt(d2);
                pen = reach - d;
                if (d > 1e-9) { lnx = dx / d; lny = dy / d; lnz = dz / d; } else { lnx = 0; lny = 0; lnz = qz > zHiN ? 1 : -1; }
              } else {
                const dXY = Math.sqrt(dxy2);
                const ph = reach - dXY;
                const pv = PB.up ? zHiN - qz + reach : qz - zLoN + reach;
                if (PB.surface[h] && ph < pv && dXY > 1e-9) { pen = ph; lnx = dx / dXY; lny = dy / dXY; lnz = 0; }
                else { pen = pv < reach ? pv : reach; lnx = 0; lny = 0; lnz = PB.up ? 1 : -1; }
              }
            } else {
              const dz = qz - Z[h];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= r2) continue;
              const d = Math.sqrt(d2);
              pen = reach - d;
              if (d > 1e-9) { lnx = dx / d; lny = dy / d; lnz = dz / d; } else { lnx = 0; lny = 0; lnz = 1; }
            }
            if (!(pen > 0)) continue;
            if (!record) return 1;
            if (PB.seen[h] === PB.gen) continue;   // węzeł już w styku z innym punktem tej pary
            PB.seen[h] = PB.gen;
            if (RS.nC === RS.cN.length) {
              const n2 = RS.nC * 2;
              RS.cN = growI32(RS.cN, n2); RS.cK = growI32(RS.cK, n2);
              const d = new Float64Array(n2); d.set(RS.cD); RS.cD = d;
            }
            RS.cN[RS.nC] = h; RS.cD[RS.nC] = pen; RS.cK[RS.nC] = k; RS.nC++;
            ACC[1] += lnx * pen; ACC[2] += lny * pen; ACC[3] += lnz * pen;
            // punkt styku (lokalnie): środek między kulą punktu a węzłem
            ACC[4] += (qx + X[h]) * 0.5; ACC[5] += (qy + Y[h]) * 0.5; ACC[6] += (qz + (PB.planar ? Math.max(Z[h] + PB.colZ0, Math.min(Z[h] + PB.colZ1, qz)) : Z[h])) * 0.5;
            if (pen > ACC[7]) { ACC[7] = pen; ACC[8] = k; }
            ACC[0]++;
            found++;
          }
      }
    }
  }
  return found;
}

const _jB = { x: 0, y: 0, z: 0 };

/** Styk klastra R z ciałem belek B (płaskim albo 3D); zwraca liczbę styków. */
function collideRB(D, R, B, doDamage) {
  const dt = RS.f[0];
  const cfg = D.config, rc = D.rigidConfig;
  const mB = D._refreshRot(B);
  const grid = D._refreshHash(B);
  if (!(grid.minX <= grid.maxX)) return 0;
  const g = R.rg;
  const cs = B.cellSize;
  const nodeR = cs * (cfg.nodeRadius / cfg.cellSize);
  PB.B = B; PB.planar = !!B.planar; PB.heads = grid.heads; PB.map = grid.map;
  PB.i0 = grid.i0; PB.j0 = grid.j0; PB.k0 = grid.k0; PB.gnx = grid.nx; PB.gny = grid.ny; PB.gnz = grid.nz;
  PB.cs = cs; PB.nodeR = nodeR;
  const s = B.nodeStore;
  PB.X = s.x; PB.Y = s.y; PB.Z = s.z; PB.next = s.hashNext; PB.surface = s.surface; PB.active = s.active;
  PB.colZ0 = PB.planar ? (B.colZ0 || 0) : 0; PB.colZ1 = PB.planar ? (B.colZ1 || 0) : 0;
  PB.zLo = grid.minZ + PB.colZ0; PB.zHi = grid.maxZ + PB.colZ1;
  PB.kz0 = Math.floor(grid.minZ / cs); PB.kz1 = Math.floor(grid.maxZ / cs);
  if (RS.nodeSeen.length < s.count) { RS.nodeSeen = new Int32Array(Math.max(s.count, RS.nodeSeen.length * 2)); RS.nodeGen = 0; }
  let gen = (RS.nodeGen + 1) | 0; if (gen <= 0) { RS.nodeSeen.fill(0); gen = 1; }
  RS.nodeGen = gen; PB.gen = gen; PB.seen = RS.nodeSeen;
  // ruch względny (środek klastra względem ciała belek) w układzie B: pion słupa i CCD
  const m0 = mB[0], m1 = mB[1], m2 = mB[2], m3 = mB[3], m4 = mB[4], m5 = mB[5], m6 = mB[6], m7 = mB[7], m8 = mB[8];
  const wvx = R.vel.x - B.vel.x, wvy = R.vel.y - B.vel.y, wvz = R.vel.z - B.vel.z;
  const lvx = m0 * wvx + m3 * wvy + m6 * wvz, lvy = m1 * wvx + m4 * wvy + m7 * wvz, lvz = m2 * wvx + m5 * wvy + m8 * wvz;
  PB.up = lvz <= 0;
  const travel = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz) * dt;
  RS.nC = 0;
  ACC.fill(0); ACC[8] = -1;
  const rx0 = R.pos.x - B.pos.x, ry0 = R.pos.y - B.pos.y, rz0 = R.pos.z - B.pos.z;
  const bminX = grid.minX, bmaxX = grid.maxX, bminY = grid.minY, bmaxY = grid.maxY;
  const bminZ = PB.planar ? PB.zLo : grid.minZ, bmaxZ = PB.planar ? PB.zHi : grid.maxZ;
  // WCZESNE WYJŚCIE (recenzja E2, zgł. 10): obrys klastra w układzie B (obrys punktów z promieniami + promień węzła +
  // droga w kroku — CCD) bez ŻADNEGO węzła w kubełkach siatki B → para bez styku za kilkaset kubełków, zamiast zapytań
  // 32 punktów po ~30 kubełków (klaster przy wieży 13 tys. węzłów: ~10 µs na parę, 70% par bez styku).
  {
    const bx = g.box;
    const cwx = rx0 + (bx[0] + bx[3]) * 0.5, cwy = ry0 + (bx[1] + bx[4]) * 0.5, cwz = rz0 + (bx[2] + bx[5]) * 0.5;
    const hwx = (bx[3] - bx[0]) * 0.5, hwy = (bx[4] - bx[1]) * 0.5, hwz = (bx[5] - bx[2]) * 0.5;
    const lcx = m0 * cwx + m3 * cwy + m6 * cwz, lcy = m1 * cwx + m4 * cwy + m7 * cwz, lcz = m2 * cwx + m5 * cwy + m8 * cwz;
    const pad = nodeR + travel;
    const lhx = Math.abs(m0) * hwx + Math.abs(m3) * hwy + Math.abs(m6) * hwz + pad;
    const lhy = Math.abs(m1) * hwx + Math.abs(m4) * hwy + Math.abs(m7) * hwz + pad;
    const lhz = Math.abs(m2) * hwx + Math.abs(m5) * hwy + Math.abs(m8) * hwz + pad;
    if (lcx - lhx > bmaxX || lcx + lhx < bminX || lcy - lhy > bmaxY || lcy + lhy < bminY || lcz - lhz > bmaxZ || lcz + lhz < bminZ) return 0;
    let ia = Math.floor((lcx - lhx) / cs), ib = Math.floor((lcx + lhx) / cs);
    let ja = Math.floor((lcy - lhy) / cs), jb = Math.floor((lcy + lhy) / cs);
    let ka = PB.planar ? PB.kz0 : Math.floor((lcz - lhz) / cs), kb = PB.planar ? PB.kz1 : Math.floor((lcz + lhz) / cs);
    const dense = PB.map === null;
    if (dense) {
      if (ia < PB.i0) ia = PB.i0; if (ib > PB.i0 + PB.gnx - 1) ib = PB.i0 + PB.gnx - 1;
      if (ja < PB.j0) ja = PB.j0; if (jb > PB.j0 + PB.gny - 1) jb = PB.j0 + PB.gny - 1;
      if (ka < PB.k0) ka = PB.k0; if (kb > PB.k0 + PB.gnz - 1) kb = PB.k0 + PB.gnz - 1;
    }
    if ((ib - ia + 1) * (jb - ja + 1) * (kb - ka + 1) <= 4096) {
      let any = false;
      const heads = PB.heads, gi0 = PB.i0, gj0 = PB.j0, gk0 = PB.k0, gnx = PB.gnx, gny = PB.gny;
      scan: for (let kk = ka; kk <= kb; kk++) for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const h = dense ? heads[(i - gi0) + gnx * ((j - gj0) + gny * (kk - gk0))] : bucketAt(i, j, kk);
        if (h >= 0) { any = true; break scan; }
      }
      if (!any) return 0;
    }
  }
  let ccdHit = 0, ccdPen = 0;
  for (let k = 0; k < g.n; k++) {
    const wx = g.ox[k] + rx0, wy = g.oy[k] + ry0, wz = g.oz[k] + rz0;
    const qx = m0 * wx + m3 * wy + m6 * wz, qy = m1 * wx + m4 * wy + m7 * wz, qz = m2 * wx + m5 * wy + m8 * wz;
    const reach = g.r[k] + nodeR;
    const out = qx < bminX - reach || qx > bmaxX + reach || qy < bminY - reach || qy > bmaxY + reach || qz < bminZ - reach || qz > bmaxZ + reach;
    const Q = PB.q;
    Q[0] = qx; Q[1] = qy; Q[2] = qz; Q[3] = reach;
    if (!out && pointContacts(k, true) > 0) continue;
    // CCD (R11): punkt bez styku na końcu kroku, ale przeszedł przez materiał w tym kroku (wszedł i wyszedł) —
    // styk wstecz z normalną przeciw ruchowi względnemu, głębokość = droga od wejścia
    if (!rc.ccd || !(travel > 0.5 * reach)) continue;
    const sx = qx - lvx * dt, sy = qy - lvy * dt, sz = qz - lvz * dt;
    if (Math.max(qx, sx) < bminX - reach || Math.min(qx, sx) > bmaxX + reach || Math.max(qy, sy) < bminY - reach ||
        Math.min(qy, sy) > bmaxY + reach || Math.max(qz, sz) < bminZ - reach || Math.min(qz, sz) > bmaxZ + reach) continue;
    Q[0] = sx; Q[1] = sy; Q[2] = sz;
    if (pointContacts(k, false) > 0) continue;       // start w styku — to wyjście, nie przelot
    const K = Math.min(rc.ccdMaxSamples, Math.max(2, Math.ceil(travel / (0.5 * reach))));
    for (let t = 1; t < K; t++) {
      const f = t / K;                                  // czas od startu kroku
      const cx = sx + lvx * dt * f, cy = sy + lvy * dt * f, cz = sz + lvz * dt * f;
      Q[0] = cx; Q[1] = cy; Q[2] = cz;
      if (pointContacts(k, false) > 0) {
        const pen = travel * (1 - f) + reach * 0.5;
        if (pen > ccdPen) ccdPen = pen;
        ccdHit++;
        // styk w miejscu wejścia (zapis węzłów do zgniotu), normalna niżej — przeciw ruchowi
        pointContacts(k, true);
        break;
      }
    }
  }
  const count = ACC[0] | 0;          // liczba całkowita (Smi): liczba z Float64Array przekazana dalej byłaby pakowana
  if (count === 0) return 0;
  RIGID_PERF.beamNarrow++;
  // normalna i punkt styku → świat
  let lnx = ACC[1], lny = ACC[2], lnz = ACC[3];
  if (ccdHit > 0) {
    // przelot: normalna przeciw ruchowi względnemu (lokalnie), głębokość — droga od wejścia
    const vl = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz) || 1;
    lnx = -lvx / vl; lny = -lvy / vl; lnz = -lvz / vl;
    if (ccdPen > ACC[7]) ACC[7] = ccdPen;
    RIGID_PERF.ccdHits += ccdHit;
  }
  let nX = m0 * lnx + m1 * lny + m2 * lnz, nY = m3 * lnx + m4 * lny + m5 * lnz, nZ = m6 * lnx + m7 * lny + m8 * lnz;
  let nl = Math.sqrt(nX * nX + nY * nY + nZ * nZ);
  if (!(nl > 1e-9)) {
    nX = R.pos.x - B.pos.x; nY = R.pos.y - B.pos.y; nZ = R.pos.z - B.pos.z; nl = Math.sqrt(nX * nX + nY * nY + nZ * nZ);
    if (!(nl > 1e-9)) { nX = 0; nY = 0; nZ = 1; nl = 1; }
  }
  nX /= nl; nY /= nl; nZ /= nl;
  const lhx = ACC[4] / count, lhy = ACC[5] / count, lhz = ACC[6] / count;
  const hx = B.pos.x + m0 * lhx + m1 * lhy + m2 * lhz, hy = B.pos.y + m3 * lhx + m4 * lhy + m5 * lhz, hz = B.pos.z + m6 * lhx + m7 * lhy + m8 * lhz;
  const deepK = ACC[8] | 0;
  HB[0] = hx; HB[1] = hy; HB[2] = hz; HB[3] = nX; HB[4] = nY; HB[5] = nZ; HB[6] = ACC[7];
  resolveRigidBeam(D, R, B, doDamage, count, deepK >= 0 ? g.blockId[g.blk[deepK]] : -1);
  return count;
}

/**
 * Prawo styku klaster × ciało belek (normalna B → R; styk w HB: punkt, normalna, głębokość): impuls do granicy
 * plastyczności frontu (pancerz i masa węzła ciała belek, kotwice × pinYieldMul — jak v2), ponad nią granica i zgniot
 * nadmiaru w ciele belek; klaster się nie gniecie (D0), a pęd nadany zgniatanym węzłom wraca jako hamowanie klastra
 * (bilans pędu). Ciało płaskie odpowiada tylko w XY i obrotem wokół z (jak para mieszana silnika). Ruchliwości
 * i impulsy liczone w miejscu (I⁻¹ w świecie obu ciał raz na wywołanie) — bez wywołań z liczbami zmiennoprzecinkowymi.
 */
function resolveRigidBeam(D, R, B, doDamage, count, blk) {
  const dt = RS.f[0];
  const cfg = D.config, rc = D.rigidConfig;
  const hx = HB[0], hy = HB[1], hz = HB[2], nX = HB[3], nY = HB[4], nZ = HB[5], penMax = HB[6];
  const planar = !!B.planar;
  const rRx = hx - R.pos.x, rRy = hy - R.pos.y, rRz = hz - R.pos.z;
  const rBx = hx - B.pos.x, rBy = hy - B.pos.y, rBz = hz - B.pos.z;
  let rvx = R.vel.x, rvy = R.vel.y, rvz = R.vel.z, rwx = R.angVel.x, rwy = R.angVel.y, rwz = R.angVel.z;
  const dvx = rvx + (rwy * rRz - rwz * rRy) - (B.vel.x + (B.angVel.y * rBz - B.angVel.z * rBy));
  const dvy = rvy + (rwz * rRx - rwx * rRz) - (B.vel.y + (B.angVel.z * rBx - B.angVel.x * rBz));
  const dvz = rvz + (rwx * rRy - rwy * rRx) - (B.vel.z + (B.angVel.x * rBy - B.angVel.y * rBx));
  const vn = dvx * nX + dvy * nY + dvz * nZ;
  const approach = vn < 0 ? -vn : 0;
  let fr = fixedRigid(R);
  if (fr && !R.anchored && approach > rc.wakeSpeed) { wakeRigid(R); fr = false; }
  R.rg.touch = 1;
  RIGID_PERF.contacts += count;
  const fixedB = B.static || B.anchored;
  if (!fr) noteSupport(R.rg, B, 0);
  if (!fixedB) R.rg.pushed = 1;
  const invR = fr ? 0 : 1 / Math.max(1e-9, R.mass * R.rammingMassMult);
  const invB = fixedB ? 0 : 1 / Math.max(1, B.mass * B.rammingMassMult);
  if (invR + invB <= 0) return;
  // I⁻¹ w świecie: klaster z rg.Iw, ciało belek 3D — R I⁻¹ Rᵀ / taran (jak applyInvInertia), płaskie — tylko Izz
  const IR = fr ? ZERO9 : R.rg.Iw;
  const IB = IWB;
  let izzB = 0;
  if (fixedB) IB.fill(0);
  else if (planar) izzB = B.invInertiaLocal[8] / Math.max(1e-6, B.rammingMassMult);
  else {
    const m = B._rot, I = B.invInertiaLocal, sc = 1 / Math.max(1e-6, B.rammingMassMult);
    for (let i = 0; i < 3; i++) {
      const r0 = m[i * 3], r1 = m[i * 3 + 1], r2 = m[i * 3 + 2];
      const t0 = r0 * I[0] + r1 * I[3] + r2 * I[6], t1 = r0 * I[1] + r1 * I[4] + r2 * I[7], t2 = r0 * I[2] + r1 * I[5] + r2 * I[8];
      for (let j = 0; j < 3; j++) IB[i * 3 + j] = (t0 * m[j * 3] + t1 * m[j * 3 + 1] + t2 * m[j * 3 + 2]) * sc;
    }
  }
  const h = nX * nX + nY * nY;
  // ruchliwości wzdłuż n i człony obrotowe impulsu normalnego
  const cRx = rRy * nZ - rRz * nY, cRy = rRz * nX - rRx * nZ, cRz = rRx * nY - rRy * nX;
  const wRx = IR[0] * cRx + IR[1] * cRy + IR[2] * cRz, wRy = IR[3] * cRx + IR[4] * cRy + IR[5] * cRz, wRz = IR[6] * cRx + IR[7] * cRy + IR[8] * cRz;
  let mobB = 0, wBx = 0, wBy = 0, wBz = 0, tzB = 0;
  if (planar) { tzB = rBx * nY - rBy * nX; mobB = invB * h + izzB * tzB * tzB; }
  else {
    const cBx = rBy * nZ - rBz * nY, cBy = rBz * nX - rBx * nZ, cBz = rBx * nY - rBy * nX;
    wBx = IB[0] * cBx + IB[1] * cBy + IB[2] * cBz; wBy = IB[3] * cBx + IB[4] * cBy + IB[5] * cBz; wBz = IB[6] * cBx + IB[7] * cBy + IB[8] * cBz;
    mobB = invB + wBx * cBx + wBy * cBy + wBz * cBz;
  }
  const denom = invR + (wRx * cRx + wRy * cRy + wRz * cRz) + mobB;
  let impulse = 0, jt = 0, tx = 0, ty = 0, tz = 0, crushing = false, closingAfter = 0;
  // impuls na ciało belek: J = −(n · j) (normalny) — zapis w miejscu
  let bvx = B.vel.x, bvy = B.vel.y, bvz = B.vel.z, bwx = B.angVel.x, bwy = B.angVel.y, bwz = B.angVel.z;
  if (vn < 0 && Number.isFinite(denom) && denom > 1e-12) {
    const jReq = (-(1 + cfg.restitution) * vn) / denom;
    // front: styki z kotwicami ciała zakotwiczonego ważą pinYieldMul (spaw z resztą budowli)
    const sB = B.nodeStore, pinMul = Math.max(1, Number(cfg.pinYieldMul) || 1);
    let front = 0;
    for (let c = 0; c < RS.nC; c++) front += B.anchored && sB.invMass[RS.cN[c]] === 0 ? pinMul : 1;
    const nodeMass = B.mass / Math.max(1, B.activeNodes);
    const jYield = cfg.crushStrength * B.collisionArmor * nodeMass / Math.max(1e-6, B.cellSize) * front * dt;
    let j = 0;
    // klaster jest bryłą 3D: wolne zbliżanie (ciężar, osiadanie) — sprężyście (crushRestSpeed3D), jak pary 3D silnika
    if (!(cfg.crushStrength > 0) || jReq <= jYield || approach < cfg.crushRestSpeed3D) j = jReq;
    else { crushing = true; j = doDamage ? jYield : 0; closingAfter = Math.max(0, -(vn + j * denom)); }
    impulse = j;
    if (j > 0) {
      rvx += nX * j * invR; rvy += nY * j * invR; rvz += nZ * j * invR;
      rwx += wRx * j; rwy += wRy * j; rwz += wRz * j;
      if (planar) { bvx -= nX * j * invB; bvy -= nY * j * invB; bwz -= izzB * tzB * j; }
      else { bvx -= nX * j * invB; bvy -= nY * j * invB; bvz -= nZ * j * invB; bwx -= wBx * j; bwy -= wBy * j; bwz -= wBz * j; }
      tx = dvx - nX * vn; ty = dvy - nY * vn; tz = dvz - nZ * vn;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-6) {
        tx /= tl; ty /= tl; tz /= tl;
        const ht = tx * tx + ty * ty;
        jt = -tl / Math.max(1e-12, invR + invB * (planar ? ht : 1));
        const fR = frictionOf(R, cfg), fB = frictionOf(B, cfg);
        const maxF = j * (fR > fB ? fR : fB);
        if (jt < -maxF) jt = -maxF;
        // tarcie: J = t · jt na klaster, −t · jt na ciało belek
        const qx = rRy * tz - rRz * ty, qy = rRz * tx - rRx * tz, qz = rRx * ty - rRy * tx;
        rvx += tx * jt * invR; rvy += ty * jt * invR; rvz += tz * jt * invR;
        rwx += (IR[0] * qx + IR[1] * qy + IR[2] * qz) * jt; rwy += (IR[3] * qx + IR[4] * qy + IR[5] * qz) * jt; rwz += (IR[6] * qx + IR[7] * qy + IR[8] * qz) * jt;
        if (invB > 0) {
          if (planar) { bvx -= tx * jt * invB; bvy -= ty * jt * invB; bwz -= izzB * (rBx * ty - rBy * tx) * jt; }
          else {
            const ux = rBy * tz - rBz * ty, uy = rBz * tx - rBx * tz, uz = rBx * ty - rBy * tx;
            bvx -= tx * jt * invB; bvy -= ty * jt * invB; bvz -= tz * jt * invB;
            bwx -= (IB[0] * ux + IB[1] * uy + IB[2] * uz) * jt; bwy -= (IB[3] * ux + IB[4] * uy + IB[5] * uz) * jt; bwz -= (IB[6] * ux + IB[7] * uy + IB[8] * uz) * jt;
          }
        }
      }
    }
  }
  if (!fr) { R.vel.x = rvx; R.vel.y = rvy; R.vel.z = rvz; R.angVel.x = rwx; R.angVel.y = rwy; R.angVel.z = rwz; }
  if (invB > 0) { B.vel.x = bvx; B.vel.y = bvy; B.vel.z = bvz; B.angVel.x = bwx; B.angVel.y = bwy; B.angVel.z = bwz; }
  // śpiący klaster pchany przez ciało belek na jawie (statek, bryła): impuls, który go trzymał — może go obudzić
  if (doDamage && fr && !R.anchored && invB > 0 && (impulse > 0 || jt < 0)) {
    PUSH[0] = nX * impulse + tx * jt; PUSH[1] = nY * impulse + ty * jt; PUSH[2] = nZ * impulse + tz * jt;
    notePush(D, R);
  }
  // --- zgniot nadmiaru w ciele belek (taran klastra) — rzadkie zdarzenie: tu wywołania silnika ---
  if (doDamage && crushing) {
    RIGID_PERF.crushes++;
    const sB = B.nodeStore, mB = B._rot;
    const lnB = D._lnB, ldB = D._ldB;
    // normalna R → B w układzie B (węzły B ustępują wzdłuż −n)
    lnB.x = -(mB[0] * nX + mB[3] * nY + mB[6] * nZ); lnB.y = -(mB[1] * nX + mB[4] * nY + mB[7] * nZ); lnB.z = -(mB[2] * nX + mB[5] * nY + mB[8] * nZ);
    let vert = 0;
    if (planar) { vert = Math.abs(lnB.z); lnB.z = 0; }
    const csB = B.cellSize;
    const maxD = Math.max(0, cfg.crushMaxCells) * csB;
    const stamp = D._nextContactStamp();
    if (D._crushedB.length < RS.nC) { D._crushedA = new Int32Array(RS.nC * 2); D._crushedB = new Int32Array(RS.nC * 2); }
    const list = D._crushedB;
    let cnt = 0, push = 0;
    const local = !!cfg.localSolver;
    const level = cfg.heatGain > 0 ? Math.min(1, approach / Math.max(1e-6, cfg.heatSpeed)) * cfg.heatGain : 0;
    const heatNow = level > 0.02 ? D.clock() : 0;
    const heat = level * cfg.heatContact;
    if (heatNow > 0 && (level >= (B._woundHeat || 0) || heatNow - (B._woundHeatAt || 0) > cfg.heatWoundWindow)) { B._woundHeat = level; B._woundHeatAt = heatNow; }
    const lhx = mB[0] * rBx + mB[3] * rBy + mB[6] * rBz, lhy = mB[1] * rBx + mB[4] * rBy + mB[7] * rBz, lhz = mB[2] * rBx + mB[5] * rBy + mB[8] * rBz;
    for (let c = 0; c < RS.nC; c++) {
      const nb = RS.cN[c];
      if (!sB.active[nb] || !(sB.invMass[nb] > 0 || B.anchored)) continue;
      const depth = Math.min(maxD, Math.max(RS.cD[c], approach * dt * cfg.crushTravelMul));
      // wyboczenie od środka styku, w poprzek normalnej (układ B)
      const ox = sB.x[nb] - lhx, oy = sB.y[nb] - lhy, oz = planar ? 0 : sB.z[nb] - lhz;
      const along = ox * lnB.x + oy * lnB.y + oz * lnB.z;
      let qx = ox - along * lnB.x, qy = oy - along * lnB.y, qz = oz - along * lnB.z;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const buckle = cfg.crushBuckling * ql / (ql + csB);
      if (ql > 1e-6) { qx /= ql; qy /= ql; qz /= ql; }
      ldB.x = qx; ldB.y = qy; ldB.z = planar ? 0 : qz;
      if (D._crushNodeV2(B, nb, lnB, ldB, buckle, depth, closingAfter, stamp, approach * dt)) {
        push += D._crushMomentum;
        list[cnt++] = nb;
        if (heatNow > 0) D._heatCrushed(B, nb, heat, heatNow, local);
      }
      if (vert > 0.05) D._crushColumn(B, nb, depth * vert);
    }
    // pęd zgniatanych węzłów wraca hamowaniem klastra (nie więcej niż zatrzymanie zbliżania)
    if (push > 0 && denom > 0 && !fr) {
      const jPush = Math.min(push, closingAfter / Math.max(1e-12, denom));
      impulse += jPush;
      R.vel.x += nX * jPush * invR; R.vel.y += nY * jPush * invR; R.vel.z += nZ * jPush * invR;
      R.angVel.x += wRx * jPush; R.angVel.y += wRy * jPush; R.angVel.z += wRz * jPush;
    }
    if (cnt > 0) D._breakOverloaded(B, list, cnt);
    B.meshDirty = true;
    if (!B.static) B._hashTick = -1;
    D.wake(B, cfg.wakeHoldFrames);
  }
  // --- korekta przenikania (ciało płaskie rozchodzi się tylko w XY) ---
  const slop = cfg.separationSlop;
  const wR = invR, wB = invB * (planar ? h : 1);
  if (penMax > slop && wR + wB > 0 && vn < cfg.contactRestSpeed) {
    const transfer = crushing ? Math.max(0, Math.min(1, cfg.crushTransfer)) : 0;
    const separation = 1 - Math.pow(1 - cfg.separationPercent, dt * 60);
    const corr = (penMax - slop) / (wR + wB) * separation * (1 - transfer);
    if (invR > 0) { R.pos.x += nX * corr * invR; R.pos.y += nY * corr * invR; R.pos.z += nZ * corr * invR; }
    // ciało belek nieruchome — bez zapisu: pola pozy ciał silnika to ogólne pola obiektu (zapis liczby = alokacja)
    if (invB > 0) { B.pos.x -= nX * corr * invB; B.pos.y -= nY * corr * invB; if (!planar) B.pos.z -= nZ * corr * invB; }
  }
  D._touchGeometry(R); D._touchGeometry(B);
  if (doDamage) {
    if (D.onRigidContact !== null && (impulse > 0 || jt < 0)) {
      D.onRigidContact(R, blk, nX * impulse + tx * jt, nY * impulse + ty * jt, nZ * impulse + tz * jt, hx, hy, hz);
    }
    if (D.onRigidPair !== null) {
      const info = D._contactInfo;
      const speed = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
      info.count = count; info.x = hx; info.y = hy; info.z = hz; info.nx = nX; info.ny = nY; info.nz = nZ;
      info.relSpeed = speed; info.approach = approach; info.slide = Math.sqrt(Math.max(0, speed * speed - vn * vn));
      info.penetration = penMax; info.crushing = crushing; info.impulse = impulse; info.doDamage = doDamage;
      D.onRigidPair(R, B, info);
    }
  }
}


// ============================ KLASTER × TEREN ============================

const _tn = { x: 0, y: 0, z: 1 };

/**
 * Styk klastra z terenem gwiaździstym (addTerrain): NORMALNA RAZ NA CIAŁO (odczyt promienia i normalnej pod środkiem
 * ciała — dźwignia 3: dawniej 4 odczyty na każdy węzeł w styku), punkty dalej nad płaszczyzną styczną niż zapas
 * (rc.terrainMargin × promień ciała + ½ promienia punktu) — bez odczytu; reszta — jeden odczyt promienia w kierunku
 * punktu (głębokość), w drugiej iteracji z pamięci pierwszej (pozy różnią się o korektę przenikania). Impulsy
 * sekwencyjne na punkt jak w parze klastrów (teren i klaster się nie gniotą), korekta przenikania, tłumienie kołysania
 * leżącego ciała (T.restAngDamp), hak T.onContact (zbiorczo: środek styku, suma impulsów).
 */
function collideTerrainRigid(D, R, T, doDamage) {
  const dt = RS.f[0];
  const cfg = D.config, rc = D.rigidConfig;
  const g = R.rg;
  const cx = T.cx, cy = T.cy, cz = T.cz;
  const pdx = R.pos.x - cx, pdy = R.pos.y - cy, pdz = R.pos.z - cz;
  const dist2 = pdx * pdx + pdy * pdy + pdz * pdz;
  const reach = T.rMax + R.radius;
  if (dist2 > reach * reach) return 0;
  const dist = Math.sqrt(dist2);
  if (!(dist > 1e-6)) return 0;
  const ux = pdx / dist, uy = pdy / dist, uz = pdz / dist;
  // pamięć pierwszej iteracji jest JEDNA na ciało — ważna tylko dla terenu, który ją zapisał (drugi teren w zasięgu
  // czytałby promienie pierwszego: przenikanie ~R₁ − R₂ i wyrzut ciała — recenzja E2, zgł. 1)
  const cached = !doDamage && g.trTick === D._tick && g.trT === T;
  let r0 = 0, nx = 0, ny = 0, nz = 1;
  const tf = g.tf;
  if (cached) { r0 = tf[0]; nx = tf[1]; ny = tf[2]; nz = tf[3]; }
  else {
    r0 = T.radius(ux, uy, uz);
    RIGID_PERF.terrainReads++;
  }
  // płaszczyzna styczna pod środkiem: zapas na rzeźbę terenu pod obrysem ciała
  const margin = rc.terrainMargin * R.radius + 0.5 * g.maxR;
  const slope = typeof T.reliefSlope === 'number' ? T.reliefSlope : rc.terrainSlope;
  if (dist - R.radius > r0 + margin + slope * R.radius) return 0;
  if (!cached) {
    if (typeof T.normal === 'function') { T.normal(ux, uy, uz, r0, _tn); nx = _tn.x; ny = _tn.y; nz = _tn.z; RIGID_PERF.terrainReads += 4; }
    else { nx = ux; ny = uy; nz = uz; }
    g.trTick = D._tick; g.trT = T; tf[0] = r0; tf[1] = nx; tf[2] = ny; tf[3] = nz;
  }
  const P0x = cx + ux * r0, P0y = cy + uy * r0, P0z = cz + uz * r0;
  const lim = T.rMax;
  const tr = g.tr, trOk = g.trOk;
  let count = 0, penMax = 0, deepK = -1;
  for (let k = 0; k < g.n; k++) {
    const px = R.pos.x + g.ox[k], py = R.pos.y + g.oy[k], pz = R.pos.z + g.oz[k], pr = g.r[k];
    let rr = 0;
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (cached) {
      if (!trOk[k]) continue;
      rr = tr[k];
    } else {
      trOk[k] = 0;
      const hpl = (px - P0x) * nx + (py - P0y) * ny + (pz - P0z) * nz - pr;
      if (hpl > margin) {
        // rzeźba pod obrysem (garb, zbocze krateru) może wystawać nad płaszczyznę styczną pod środkiem o ≤ nachylenie ×
        // odległość w bok — punkt wyżej niż to na pewno nie dotyka (recenzja E2, zgł. 2: długi klaster nad garbem
        // wchodził w teren na 15–100 j., bo punkt nad płaszczyzną nigdy nie schodził pod nią)
        const ox = g.ox[k], oy = g.oy[k], oz = g.oz[k];
        const on = ox * nx + oy * ny + oz * nz;
        const lat2 = ox * ox + oy * oy + oz * oz - on * on;
        if (hpl > margin + slope * Math.sqrt(lat2 > 0 ? lat2 : 0)) continue;
      }
      if (d - pr > lim || !(d > 1e-6)) continue;
      rr = T.radius(dx / d, dy / d, dz / d);
      RIGID_PERF.terrainReads++;
      tr[k] = rr; trOk[k] = 1;
    }
    const pen = rr + pr - d;
    if (pen <= 0) continue;
    if (count === CC.px.length) growCC();
    const f = rr / d;
    CC.px[count] = cx + dx * f; CC.py[count] = cy + dy * f; CC.pz[count] = cz + dz * f;
    CC.pen[count] = pen;
    if (pen > penMax) { penMax = pen; deepK = k; }
    count++;
  }
  if (count === 0) return 0;
  R._terrTick = D._tick;
  g.touch = 1;
  if (!R.anchored) noteSupport(g, T, 1);
  RIGID_PERF.contacts += count;
  D._touchGeometry(R);
  const fixed = R.anchored;
  const inv = fixed ? 0 : 1 / Math.max(1e-9, R.mass * R.rammingMassMult);
  const fR = frictionOf(R, cfg), fT = typeof T.friction === 'number' ? T.friction : 0;
  const mu = fR > fT ? fR : fT;
  const e = rc.restitution;
  // środek styku i prędkość w nim (hak, tłumienie spoczynku)
  let hx = 0, hy = 0, hz = 0;
  for (let c = 0; c < count; c++) { hx += CC.px[c]; hy += CC.py[c]; hz += CC.pz[c]; }
  hx /= count; hy /= count; hz /= count;
  const r0x = hx - R.pos.x, r0y = hy - R.pos.y, r0z = hz - R.pos.z;
  const v0x = R.vel.x + (R.angVel.y * r0z - R.angVel.z * r0y);
  const v0y = R.vel.y + (R.angVel.z * r0x - R.angVel.x * r0z);
  const v0z = R.vel.z + (R.angVel.x * r0y - R.angVel.y * r0x);
  const vn0 = v0x * nx + v0y * ny + v0z * nz;
  const approach = Math.max(0, -vn0);
  const speed = Math.sqrt(v0x * v0x + v0y * v0y + v0z * v0z);
  let Jx = 0, Jy = 0, Jz = 0, Jn = 0;
  if (!fixed) {
    // prędkości ciała w zmiennych lokalnych (zapis raz na końcu), I⁻¹ w świecie z rg.Iw — bez wywołań z liczbami
    let vx = R.vel.x, vy = R.vel.y, vz = R.vel.z, wx = R.angVel.x, wy = R.angVel.y, wz = R.angVel.z;
    const I = g.Iw;
    const i0 = I[0], i1 = I[1], i2 = I[2], i3 = I[3], i4 = I[4], i5 = I[5], i6 = I[6], i7 = I[7], i8 = I[8];
    const PX = CC.px, PY = CC.py, PZ = CC.pz, RAX = CC.rax, RAY = CC.ray, RAZ = CC.raz;
    const WAX = CC.wax, WAY = CC.way, WAZ = CC.waz, KN = CC.kn, LAM = CC.lam, LAMT = CC.lamT;
    const px0 = R.pos.x, py0 = R.pos.y, pz0 = R.pos.z;
    for (let c = 0; c < count; c++) {
      const rx = PX[c] - px0, ry = PY[c] - py0, rz = PZ[c] - pz0;
      RAX[c] = rx; RAY[c] = ry; RAZ[c] = rz;
      const cx2 = ry * nz - rz * ny, cy2 = rz * nx - rx * nz, cz2 = rx * ny - ry * nx;
      const w0 = i0 * cx2 + i1 * cy2 + i2 * cz2, w1 = i3 * cx2 + i4 * cy2 + i5 * cz2, w2 = i6 * cx2 + i7 * cy2 + i8 * cz2;
      WAX[c] = w0; WAY[c] = w1; WAZ[c] = w2;
      KN[c] = inv + cx2 * w0 + cy2 * w1 + cz2 * w2;
      LAM[c] = 0; LAMT[c] = 0;
    }
    const passes = Math.max(1, rc.terrainPasses | 0);
    for (let pass = 0; pass < passes; pass++) {
      const bounce = pass === 0 ? 1 + e : 1;
      for (let c = 0; c < count; c++) {
        const kn = KN[c];
        if (!(kn > 1e-12)) continue;
        const rx = RAX[c], ry = RAY[c], rz = RAZ[c];
        let ux2 = vx + (wy * rz - wz * ry), uy2 = vy + (wz * rx - wx * rz), uz2 = vz + (wx * ry - wy * rx);
        const vn = ux2 * nx + uy2 * ny + uz2 * nz;
        const old = LAM[c];
        let lam = old - (vn * bounce) / kn;
        if (lam < 0) lam = 0;
        const dl = lam - old;
        LAM[c] = lam;
        if (dl !== 0) {
          vx += nx * dl * inv; vy += ny * dl * inv; vz += nz * dl * inv;
          wx += WAX[c] * dl; wy += WAY[c] * dl; wz += WAZ[c] * dl;
          Jx += nx * dl; Jy += ny * dl; Jz += nz * dl; Jn += dl;
          ux2 = vx + (wy * rz - wz * ry); uy2 = vy + (wz * rx - wx * rz); uz2 = vz + (wx * ry - wy * rx);
        }
        const avail = mu * lam - LAMT[c];
        if (!(avail > 0)) continue;
        const vn2 = ux2 * nx + uy2 * ny + uz2 * nz;
        let tx = ux2 - nx * vn2, ty = uy2 - ny * vn2, tz = uz2 - nz * vn2;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (!(tl > 1e-6)) continue;
        tx /= tl; ty /= tl; tz /= tl;
        const cx2 = ry * tz - rz * ty, cy2 = rz * tx - rx * tz, cz2 = rx * ty - ry * tx;
        const t0 = i0 * cx2 + i1 * cy2 + i2 * cz2, t1 = i3 * cx2 + i4 * cy2 + i5 * cz2, t2 = i6 * cx2 + i7 * cy2 + i8 * cz2;
        const kt = inv + cx2 * t0 + cy2 * t1 + cz2 * t2;
        if (!(kt > 1e-12)) continue;
        let jt = tl / kt;
        if (jt > avail) jt = avail;
        LAMT[c] += jt;
        vx -= tx * jt * inv; vy -= ty * jt * inv; vz -= tz * jt * inv;
        wx -= t0 * jt; wy -= t1 * jt; wz -= t2 * jt;
        Jx -= tx * jt; Jy -= ty * jt; Jz -= tz * jt;
      }
    }
    if (doDamage && approach < rc.restSpeed && T.restAngDamp > 0 && count >= 3) {
      const k = Math.exp(-T.restAngDamp * dt * Math.min(1, count / rc.terrainRestCount));
      wx *= k; wy *= k; wz *= k;
    }
    if (doDamage && rc.rollDamp > 0 && count >= 2) {
      const k = 1 - Math.exp(-rc.rollDamp * dt);
      const wn = wx * nx + wy * ny + wz * nz;
      wx -= (wx - wn * nx) * k; wy -= (wy - wn * ny) * k; wz -= (wz - wn * nz) * k;
    }
    R.vel.x = vx; R.vel.y = vy; R.vel.z = vz; R.angVel.x = wx; R.angVel.y = wy; R.angVel.z = wz;
    const slop = cfg.separationSlop;
    if (penMax > slop) {
      const separation = 1 - Math.pow(1 - rc.separation, dt * 60);
      const corr = (penMax - slop) * separation;
      R.pos.x += nx * corr; R.pos.y += ny * corr; R.pos.z += nz * corr;
    }
  }
  if (doDamage && D.onRigidContact !== null && Jn > 0) {
    D.onRigidContact(R, deepK >= 0 ? g.blockId[g.blk[deepK]] : -1, Jx, Jy, Jz, hx, hy, hz);
  }
  if (typeof T.onContact === 'function') {
    const info = D._contactInfo;
    info.count = count; info.x = hx; info.y = hy; info.z = hz; info.nx = nx; info.ny = ny; info.nz = nz;
    info.relSpeed = speed; info.approach = approach; info.slide = Math.sqrt(Math.max(0, speed * speed - vn0 * vn0));
    info.penetration = penMax; info.crushing = false; info.impulse = Jn; info.doDamage = doDamage;
    T.onContact(R, info);
  }
  return count;
}

// ============================ PRZEBIEG ITERACJI ============================

/**
 * Klastry w iteracji kolizji `it` (update silnika, po parach ciał belek, przed ich terenem): w pierwszej — przygotowanie
 * kroku (lista, obroty punktów, siatka par), potem pary klaster × klaster, klaster × ciało belek i teren. Druga
 * iteracja pomija pary bez styku, których ciała się od tamtej chwili nie ruszyły (_geomVer — jak silnik).
 */
export function rigidCollide(D, bodies, dt, it) {
  const P = RIGID_PERF;
  const timing = P.timing === true;
  const t0 = timing ? nowMs() : 0;
  const doDamage = it === 0;
  RS.f[0] = dt;
  if (it === 0) {
    if (timing) P.ms = 0;
    P.narrow = 0; P.contacts = 0; P.beamNarrow = 0; P.beamEval = 0; P.crushes = 0; P.ccdHits = 0; P.terrainReads = 0;
    if (timing) { P.rrMs = 0; P.beamMs = 0; P.terrainMs = 0; }
    P.terrainBodies = 0;
    const tp = timing ? nowMs() : 0;
    prepareStep(D, bodies);
    if (timing) { P.prepMs = nowMs() - tp; P.broadCell = RS.f[8]; }
    P.pairs = RS.nRR; P.beamPairs = RS.nRB;
  }
  const list = RS.list, nList = RS.n;
  if (nList === 0) { if (timing) P.ms += nowMs() - t0; return; }
  // klaster × klaster
  const t1 = timing ? nowMs() : 0;
  const rrA = RS.rrA, rrB = RS.rrB, qa = RS.rrQA, qb = RS.rrQB;
  for (let p = 0; p < RS.nRR; p++) {
    const A = list[rrA[p]], B = list[rrB[p]];
    if (it === 0) qa[p] = -1;
    else if (qa[p] === A._geomVer && qb[p] === B._geomVer) continue;
    if (A.dead || B.dead) continue;
    if (fixedRigid(A) && fixedRigid(B)) continue;
    if (collideRR(D, A, B, doDamage) === 0) { qa[p] = A._geomVer; qb[p] = B._geomVer; } else qa[p] = -1;
  }
  const t2 = timing ? nowMs() : 0;
  if (timing) P.rrMs += t2 - t1;
  // klaster × ciało belek
  const rbR = RS.rbR, rbB = RS.rbB, qr = RS.rbQR, qbb = RS.rbQB;
  for (let p = 0; p < RS.nRB; p++) {
    const R = list[rbR[p]], B = bodies[rbB[p]];
    if (it === 0) qr[p] = -1;
    else if (qr[p] === R._geomVer && qbb[p] === B._geomVer) continue;
    if (R.dead || !B || B.dead || B.activeNodes <= 0) continue;
    if (fixedRigid(R) && (B.static || B.anchored)) continue;
    P.beamEval++;
    if (collideRB(D, R, B, doDamage) === 0) { qr[p] = R._geomVer; qbb[p] = B._geomVer; } else qr[p] = -1;
  }
  const t3 = timing ? nowMs() : 0;
  if (timing) P.beamMs += t3 - t2;
  // teren (normalna raz na ciało); druga iteracja — tylko ciała w styku z pierwszej
  const terrains = D.terrains;
  if (terrains.length > 0) {
    for (let i = 0; i < nList; i++) {
      const R = list[i];
      if (R.dead || R.anchored || R.isSleeping) continue;
      if (!doDamage && R._terrTick !== D._tick) continue;
      if (doDamage) P.terrainBodies++;
      for (let t = 0; t < terrains.length; t++) collideTerrainRigid(D, R, terrains[t], doDamage);
    }
  }
  if (timing) {
    const t4 = nowMs();
    P.terrainMs += t4 - t3;
    P.ms += t4 - t0;
  }
}

/**
 * Koniec kroku: sen klastrów (styk + spokój przez sleepTicks120 kroków 1/120 s), budżet aktywnych (plan § 3.4),
 * liczniki. Wołane z update silnika, gdy w kroku były klastry.
 */
export function rigidAfterStep(D, dt) {
  const rc = D.rigidConfig, P = RIGID_PERF;
  const timing = P.timing === true;
  const t0 = timing ? nowMs() : 0;
  const list = RS.list, n = RS.n;
  const need = ticksAt120(rc.sleepTicks120, dt);
  if (RS.cand.length < n) RS.cand = new Int32Array(Math.max(n, RS.cand.length * 2));
  const cand = RS.cand;
  const budgetLim = rc.budgetSleepSpeed;
  let awake = 0, sleeping = 0, frozen = 0, nc = 0;
  for (let i = 0; i < n; i++) {
    const b = list[i];
    if (b.dead) continue;
    // podpora zniknęła (ciało martwe / zwolnione / ruszyło, komórki płyty zjedzone, teren zdjęty) — śpiący się budzi,
    // zamrożony odmarza (recenzja E2, zgł. 4/12: dawniej wisiał w powietrzu bez końca); całkowany od następnego kroku
    if ((b.anchored || b.isSleeping) && b.rg.nSup + (b.rg.supF !== null ? 1 : 0) > 0 && supportLost(D, b) === 1) {
      if (b.anchored) unfreezeRigid(b); else wakeRigid(b);
      const g = b.rg;
      for (let s = 0; s < g.nSup; s++) g.sup[s] = null;
      g.nSup = 0; g.supF = null;
      g.pushed = 1;            // ten krok bez budżetu (inaczej nadmiar uśpiłby go z powrotem w powietrzu)
    }
    if (b.anchored) { frozen++; continue; }
    if (b.isSleeping) { sleeping++; b.rg.touch = 0; continue; }
    const g = b.rg;
    // ruch NETTO w kroku (przesunięcie i obrót pozy), nie prędkość: ciało w stosie trzymane korektą przenikania ma
    // prędkość resztkową (grawitacja × dt), a stoi
    const lp = g.lp;
    const dx = b.pos.x - lp[0], dy = b.pos.y - lp[1], dz = b.pos.z - lp[2];
    const q = b.quat;
    const dot = Math.abs(q.x * lp[3] + q.y * lp[4] + q.z * lp[5] + q.w * lp[6]);
    const ang = 2 * Math.acos(dot > 1 ? 1 : dot);
    lp[0] = b.pos.x; lp[1] = b.pos.y; lp[2] = b.pos.z; lp[3] = q.x; lp[4] = q.y; lp[5] = q.z; lp[6] = q.w;
    const inv = 1 / dt;
    const v2 = (dx * dx + dy * dy + dz * dz) * inv * inv;
    const w2 = ang * ang * inv * inv;
    const lim = rc.sleepSpeed;
    const touch = g.touch;
    g.touch = 0;
    if (touch && v2 < lim * lim && w2 * b.radius * b.radius < lim * lim && b.joints === null) {
      if (++b.sleepFrames >= need) {
        b.isSleeping = true;
        b.vel.x = 0; b.vel.y = 0; b.vel.z = 0;
        b.angVel.x = 0; b.angVel.y = 0; b.angVel.z = 0;
        sleeping++;
        continue;
      }
    } else b.sleepFrames = 0;
    awake++;
    // kandydat budżetu: podparty (styk w tym kroku) i wolny — nie zawiśnie w powietrzu
    // (bez styku ze swobodnym ciałem belek w tym kroku — statek pchający gruz zatrzymałby się na uśpionym)
    if (touch && g.pushed === 0 && Math.sqrt(v2) + Math.sqrt(w2) * b.radius < budgetLim) cand[nc++] = i;
  }
  // budżet aktywnych: nadmiar wolnych podpartych zasypia od najlżejszego (potem mniejsze id) — deterministycznie
  P.overBudget = 0;
  if (awake > rc.maxActive) {
    let excess = awake - rc.maxActive;
    while (excess > 0 && nc > 0) {
      let best = 0;
      for (let c = 1; c < nc; c++) {
        const a = list[cand[c]], bb = list[cand[best]];
        if (a.mass < bb.mass || (a.mass === bb.mass && a.id < bb.id)) best = c;
      }
      const b = list[cand[best]];
      b.isSleeping = true;
      b.vel.x = 0; b.vel.y = 0; b.vel.z = 0; b.angVel.x = 0; b.angVel.y = 0; b.angVel.z = 0;
      cand[best] = cand[--nc];
      excess--; awake--; sleeping++;
    }
    P.overBudget = Math.max(0, awake - rc.maxActive);
  }
  P.bodies = n; P.awake = awake; P.sleeping = sleeping; P.frozen = frozen;
  if (timing) {
    P.afterMs = nowMs() - t0;
    P.ms += P.afterMs;
  }
}

/**
 * ZAMROŻENIE klastra (freezeBody silnika dla ciała rigid): nieruchoma podpora (masa ∞, bez całkowania, terenu i snu),
 * przeguby zdjęte. Koszt kroku 0 (zostaje wpis w siatce par dla ciał w ruchu). Zwraca liczbę punktów.
 */
export function freezeRigid(b) {
  if (!b || b.dead) return 0;
  b.anchored = true;
  b.invMass = 0;
  b.isSleeping = true;
  b.sleepFrames = 0;
  b.joints = null;
  b.vel.x = 0; b.vel.y = 0; b.vel.z = 0;
  b.angVel.x = 0; b.angVel.y = 0; b.angVel.z = 0;
  return b.rg.n;
}

/** Odmrożenie / obudzenie klastra (gra: wstrząs, nowe uderzenie, utrata podpory). */
export function unfreezeRigid(b) {
  if (!b || b.dead) return;
  if (b.anchored) { b.anchored = false; b.invMass = 1 / Math.max(1e-9, b.mass); }
  wakeRigid(b);
}

/**
 * Scena rozgrzewki JIT ścieżek klastrów (D.warmUpRigid — stan silnika zapisuje i przywraca wołający): stos klastrów
 * na terenie (pary, sen, budżet), klaster w zakotwiczoną płytę płaską (taran, zgniot, CCD) i w bryłę 3D, przejście przez
 * pole płyty. Pierwsze zawalenie w grze nie idzie w interpreterze (pomiar: krok 0 stosu 200 klastrów 8,8 ms na zimno).
 * `buildBeamStructure` — z beamBody3D (bez cyklu importów).
 */
export function rigidWarmUpScene(D, buildBeamStructure, steps = 72) {
  const slab = (nx, ny, nz, cs) => {
    const cells = [];
    for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const edge = ix === 0 || iy === 0 || iz === 0 || ix === nx - 1 || iy === ny - 1 || iz === nz - 1;
      cells.push({ ix, iy, iz, x: (ix + 0.5) * cs, y: (iy + 0.5) * cs, z: (iz + 0.5) * cs, surface: edge, depth: edge ? 1 : 2, coverage: 1, r: 0.5, g: 0.5, b: 0.5 });
    }
    return buildBeamStructure({ cells, nx, ny, nz, cellSize: cs, origin: { x: 0, y: 0, z: 0 } },
      { frameAxes: [0, 1, 0], frameToOppositeWall: true, maxFrameSpan: 10, bulkheadEvery: 0 });
  };
  const desc = buildClusterDesc([{ x: 0, y: 0, z: 0, hx: 100, hy: 100, hz: 50, mass: 1.4e5, id: 0 },
    { x: 0, y: 0, z: 110, hx: 60, hy: 60, hz: 60, mass: 8e4, id: 1 }], { spacing: 50 });
  // bufory na sufit klastrów PRZED krokami — kod rozgrzewa się na tablicach, które zostaną (wymiana tablic po rozgrzewce
  // gubiła informację o typach i pierwszy krok zawalenia szedł w interpreterze — recenzja E2, zgł. 14)
  rigidReserve(256);
  const RT = 20000;
  D.terrains.length = 0;
  D.terrains.push({ cx: 0, cy: 0, cz: -RT, R: RT, rMax: RT + 30, friction: 0.6, armorMul: 3, restAngDamp: 2, onContact: null,
    radius(ux, uy, uz) { return RT + 20 * ux * uy; },
    normal(ux, uy, uz, r, out) { out.x = ux; out.y = uy; out.z = uz; return out; } });
  D.plateFields.length = 0;
  D.addPlateField({ origin: { x: 3000, y: -500, z: 300 }, cell: 45, nu: 24, nv: 24, thickness: 90, capacity: 1e3, massPerCell: 100 });
  const bodies = [], free = [];
  // stos: kolumny nachodzących na siebie klastrów (start w przenikaniu — jak spawn zawalenia: wiele styków na parę)
  for (let i = 0; i < 16; i++) {
    const b = D.createRigidBody(desc, { position: { x: (i % 3) * 90, y: (i % 2) * 70, z: 140 + (i >> 1) * 160 },
      quaternion: { x: 0.1 * (i % 3), y: 0.05 * i, z: 0, w: 1 }, gravity: { x: 0, y: 0, z: -400 } });
    bodies.push(b); free.push(b);
  }
  const wall = D.createBody(slab(24, 4, 1, 15), { planar: true, anchored: true, position: { x: 1500, y: 0, z: 0 },
    massMultiplier: 1, collisionArmor: 2 });
  for (let i = 0; i < wall.nodeStore.count; i += 3) wall.nodeStore.invMass[i] = 0;
  wall.colZ0 = -70; wall.colZ1 = 70;
  bodies.push(wall);
  const solid = D.createBody(slab(6, 6, 6, 30), { planar: false, position: { x: 1500, y: 900, z: 0 }, massMultiplier: 1 });
  bodies.push(solid);
  const ram = D.createRigidBody(desc, { position: { x: 1660, y: 400, z: 0 }, velocity: { x: 0, y: -1500, z: 0 } });
  const ram2 = D.createRigidBody(desc, { position: { x: 1590, y: 1300, z: 0 }, velocity: { x: 0, y: -900, z: 0 } });
  const drop = D.createRigidBody(desc, { position: { x: 3500, y: 0, z: 700 }, velocity: { x: 0, y: 0, z: -900 } });
  bodies.push(ram, ram2, drop); free.push(ram, ram2, drop, solid);
  const dt = 1 / 60;
  for (let k = 0; k < steps; k++) {
    D.integrate(dt, free);
    D.update(dt, bodies);
  }
  // ścieżki snu, podpór i pchania: połowa stosu śpi (jak po rigidAfterStep), dolny klaster ginie (utrata podpory), taran
  // pcha śpiących, zamrożenie i odmrożenie
  for (let i = 0; i < 16; i += 2) {
    const b = bodies[i];
    b.isSleeping = true; b.vel.x = 0; b.vel.y = 0; b.vel.z = 0; b.angVel.x = 0; b.angVel.y = 0; b.angVel.z = 0;
  }
  bodies[0].dead = true;
  const push = D.createRigidBody(desc, { position: { x: -300, y: 0, z: 120 }, velocity: { x: 20, y: 0, z: 0 } });
  bodies.push(push); free.push(push);
  freezeRigid(bodies[1]);
  for (let k = 0; k < 24; k++) {
    D.integrate(dt, free);
    D.update(dt, bodies);
  }
  unfreezeRigid(bodies[1]);
  for (let k = 0; k < 6; k++) {
    D.integrate(dt, free);
    D.update(dt, bodies);
  }
  D.terrains.length = 0;
  D.plateFields.length = 0;
  for (let i = 0; i < RS.list.length; i++) RS.list[i] = null;
  RS.n = 0;
}

/**
 * Bufory kroku na `n` klastrów z góry (HullBodies.warmUpClusters przez warmUpRigid — sufit maxClusters): pierwsze zawalenie nie
 * rozpędza tablic w kroku (pomiar recenzji E2: krok 0 stosu 200 klastrów w zimnym procesie 5,2 ms, z tego wzrost
 * buforów i siatki par ~1,9 ms przy 40 parach).
 */
export function rigidReserve(n) {
  const k = Math.max(64, n | 0);
  const growTo = (a, len) => (a.length >= len ? a : new Int32Array(len));
  RS.seen = growTo(RS.seen, k); RS.range = growTo(RS.range, k * 6); RS.cand = growTo(RS.cand, k);
  RS.next = growTo(RS.next, k * 64); RS.owner = growTo(RS.owner, k * 64);
  RS.big = growTo(RS.big, k);
  let need = 4096; while (need < k * 16) need <<= 1;
  RS.head = growTo(RS.head, need);
  RS.rrA = growTo(RS.rrA, k * 16); RS.rrB = growTo(RS.rrB, k * 16); RS.rrQA = growTo(RS.rrQA, k * 16); RS.rrQB = growTo(RS.rrQB, k * 16);
  RS.rbR = growTo(RS.rbR, k * 4); RS.rbB = growTo(RS.rbB, k * 4); RS.rbQR = growTo(RS.rbQR, k * 4); RS.rbQB = growTo(RS.rbQB, k * 4);
  RS.la = growTo(RS.la, 256); RS.lb = growTo(RS.lb, 256);
  RS.cN = growTo(RS.cN, 2048); RS.cK = growTo(RS.cK, 2048);
  if (RS.cD.length < 2048) RS.cD = new Float64Array(2048);
  while (CC.px.length < 1024) growCC();
  while (RS.list.length < k) RS.list.push(null);
}

/** Budzi śpiące (nie zamrożone) klastry z obrysem w kuli (x, y, z, r) — np. po zniknięciu podpory. Zwraca liczbę. */
export function wakeRigidAround(bodies, x, y, z, r) {
  let woke = 0;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b || b.dead || b.rigid !== true || b.anchored || !b.isSleeping) continue;
    const dx = b.pos.x - x, dy = b.pos.y - y, dz = b.pos.z - z, rr = r + b.radius;
    if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
    wakeRigid(b);
    woke++;
  }
  return woke;
}
