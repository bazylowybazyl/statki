// Elektrownia „KOREK” — WINDY KOSMICZNE DO RINGU PLANETARNEGO (decyzja użytkownika 2026-10-22: „winda ma być do ringu
// planetarnego”). Ziemia obraca się wokół osi ringu (earthSpin.js), ring gry jest równikowy i stoi względem gruntu, więc
// liny są STAŁE w układzie Ziemi. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js), części z rodzajem
// powierzchni (PART): bryły — materiał metalu, liny i pion energii — materiał przepływu; kabiny jadą na GPU (dodatek
// `extras`, earthBitePlantClimbers.tsl.js).
//   • KOTWICE-STACJE na placach korony obudowy (azymuty L.elevators, oś wieży w rimAngle + anchorPad + elevTowerOff):
//     dwustopniowy podest (sześciokąt) na skraju placu, hala przyłącza nakrywająca koniec wiązki rur obudowy
//     (liningTerminalPoint — rury wchodzą w czoło hali), budynki obsługi z oknami, lądowisko ze światłami; WIEŻA
//     KRATOWNICOWA o wygiętych nogach (4 nogi, rygle, krzyżulce, szprychy do pionu, pokłady serwisowe z gondolami okien,
//     czerwone światła przeszkodowe), w osi PION ENERGII (przewód od hali przez bramę u stóp do doku); na szczycie DOK:
//     pokład z pierścieniem cewki, bęben z masztem stroboskopu i ośmiokątne RAMIONA lin (wrota kabin, kołnierz, cewka).
//   • LINY: szczyt wieży → najbliższy punkt WEWNĘTRZNEJ KRAWĘDZI RINGU (ringPointObject w układzie obiektu kuli). Linia
//     wpadająca w promień, odbiornik albo promień przekaźnikowy (kotwice w południku gryzu — 90° i 270°) rozchodzi się
//     w WIDEŁKI: dwie wiązki do punktów ringu obróconych o ±Δ wokół osi obrotu (najmniejsze Δ z zapasem
//     elevClearHub / elevClearRelay; z kamery gry widełki północnej kotwicy obramowują promień); wózki na szynie
//     rozsunięte co najmniej o elevRailSep. Wiązka: dwie liny pasów (w = ±1; kabiny jadą PO ZEWNĘTRZNEJ stronie liny),
//     między nimi przewód energii (PIPE — impulsy ku ringowi, z daleka linia barwy energii w wachlarzu), ramki rozporowe
//     co elevSpread ze światłami prowadzącymi (błysk biegnie od kotwicy do ringu).
//   • SZYNA RINGU — płaszcz obracający się z Ziemią: pełny okrąg w płaszczyźnie równika osi obrotu, tuż wewnątrz
//     krawędzi ringu (oś szyny w ringInnerR − elevRailInset), przekrój skrzynkowy z fazami, na wierzchu krótkie ciepłe
//     lampy (odróżniają się od nieruchomych chłodnych kresek ringu), od planety przerywane chłodne listwy, obejmy co 1/256
//     obwodu, rzadkie światła — w grze szyna z lampami sunie wzdłuż nieruchomego ringu z dobą Ziemi.
//   • WÓZKI na szynie w punktach zaczepu lin (jak wagon na torze): wózki jezdne obejmujące szynę, ośmiokątny kadłub
//     z pasem okien i jasnym obrysem grzbietu, dok kabin skierowany ku kotwicy (wrota, kołnierz, pierścień cewki), światła.
// Wszystko ELEV leży w walcu < ringInnerR − 0,002 od osi obrotu (z kamery gry nic nie wchodzi na ring).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  DEG, PART, finalizePart, surfacePoint, plantZ0, hubHeight, rimAngle, cylinderBetween, plantFrameMatrix,
  objectToFrameMatrix, ringPointObject, segmentClearsSphere
} from './earthBitePlantFrame.js';
import { earthSpinAxis } from './earthSpin.js';
import { createClimbers, CLIMBER_MAX } from './earthBitePlantClimbers.tsl.js';

/** Wymiary wind (R Ziemi). Azymuty (`elevators`), odsunięcie kotwic (`anchorPad`), ring (`ringInnerR`) — w PLANT_LAYOUT. */
export const ELEV_DEFAULTS = Object.freeze({
  elevTowerOff: 0.0045,   // oś wieży za rimAngle + anchorPad (plac obudowy kończy się na + 0,0115, hala przyłącza przed wieżą)
  elevTowerH: 0.034,      // wysokość pokładu doku nad gruntem (wyżej, jeśli lina nie omija kuli z zapasem 1,004)
  elevTowerBase: 0.0041,  // pół-bok podstawy wieży (osie nóg)
  elevTowerTop: 0.0016,   // pół-bok szczytu wieży
  elevTowerLevels: 10,    // poziomy rygli (panele krzyżulców między nimi)
  elevTowerFlare: 1.6,    // wygięcie nóg (pół-bok ∝ (1 − wysokość)^flare — rozłożona stopa jak w wieży Eiffla)
  elevLaneW: 0.0020,      // odsunięcie lin pasów od osi wiązki
  elevTetherR: 0.0005,    // promień liny pasa (środkowa — 0,6 ×)
  elevSpread: 0.025,      // odstęp ramek rozporowych wzdłuż liny
  elevRailInset: 0.0045,  // szyna ringu: oś w ringInnerR − inset (zewnętrzna ściana szyny ~0,003 R przed ścianą ringu)
  elevRailSeg: 1024,      // próbki obwodu szyny (≥ 1024)
  elevRailSep: 2.2,       // najmniejszy odstęp wózków na szynie [°]
  elevClearHub: 0.015,    // zapas liny od odbiornika (ponad pierścień i radiatory) [R]
  elevClearRelay: 0.05,   // zapas liny od promienia przekaźnikowego [R]
  elevCabins: 6,          // kabiny na wiązkę (razem ≤ CLIMBER_MAX)
  elevCabinTrip: 40       // docelowy czas przejazdu [s] (prędkość z długości, w granicach 0,006–0,015 R/s)
});

/** Doki i kabiny (R Ziemi) — wspólne dla brył CPU i kabin na GPU (earthBitePlantClimbers.tsl.js). */
export const ELEV_DOCK = Object.freeze({
  headLen: 0.0095,   // ramię doku na szczycie wieży: czoło (początek lin) od osi wieży wzdłuż liny
  headW: 0.0064,     // pół-szerokość ramion doków (w poprzek pasów; przekrój ośmiokątny)
  headH: 0.0022,     // pół-grubość ramion doków
  headLift: 0.0023,  // oś ramion nad pokładem doku (środek bębna)
  drumR: 0.0040,     // bęben doku na pokładzie (ramiona wychodzą z niego)
  houseLen: 0.0075,  // dok wózka: od czoła (koniec lin) do środka kadłuba wózka
  portIn: 0.005,     // środek kadłuba wózka od osi szyny ku planecie
  cabR: 0.0012,      // promień kabiny
  cabGap: 0.0002,    // luz kabiny od liny
  dockIn: 0.0028     // środek kabiny w doku: za czołem doku (kabina schowana)
});

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ── Geometria pomocnicza ───────────────────────────────────────────────────────────────────────────────────────────

/** Najmniejsza odległość odcinków P1Q1 i P2Q2 (punkty najbliższe — klasyczne rozwiązanie z obcięciem do [0, 1]). */
function segSegDist(P1, Q1, P2, Q2) {
  const d1 = V3().subVectors(Q1, P1), d2 = V3().subVectors(Q2, P2), r = V3().subVectors(P1, P2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), bb = d1.dot(d2);
  const den = a * e - bb * bb;
  let s = den > 1e-14 ? Math.min(1, Math.max(0, (bb * f - c * e) / den)) : 0;
  let t = (bb * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (bb - c) / a)); }
  return P1.clone().addScaledVector(d1, s).distanceTo(P2.clone().addScaledVector(d2, t));
}

/** Indeks 0…n−1 dla geometrii bez indeksu (scalanie wymaga jednolitości). */
function indexed(g) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}

/** Normalne płaskie (graniastosłupy z twardymi krawędziami). */
function flat(g) {
  const f = g.toNonIndexed();
  g.dispose();
  f.computeVertexNormals();
  return indexed(f);
}

/** Pudełko [x0, x1] × [y0, y1] × [z0, z1] w bazie m. */
function box(m, x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g.applyMatrix4(m);
}

/** Graniastosłup / stożek ścięty n-kątny wzdłuż Y bazy m (y0 → y1, promień R0 → R1), obrót wokół osi `rot`. */
function prism(m, n, R0, y0, y1, { rot = 0, R1 = R0, open = false, cx = 0, cz = 0, hard = true } = {}) {
  const g = new THREE.CylinderGeometry(R1, R0, y1 - y0, n, 1, open);
  g.rotateY(rot);
  g.translate(cx, (y0 + y1) / 2, cz);
  g.applyMatrix4(m);
  return hard ? flat(g) : g;
}

/** Pręt (walec n-boczny) P → Q, r → r1. */
const rod = (P, Q, r, n = 4, r1 = r) => cylinderBetween(P, Q, r, n, true, r1);

/** Zbiornik części: geometrie jednego rodzaju i parametrów scalane w jedną część (mniej części do scalenia). */
class Sink {
  constructor() { this.groups = new Map(); }
  add(g, kind, seed = 0, z = 0, w = 0) {
    const key = `${kind}|${seed}|${z}|${w}`;
    let grp = this.groups.get(key);
    if (!grp) this.groups.set(key, grp = { kind, seed, z, w, list: [] });
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    grp.list.push(indexed(g));
    return g;
  }
  parts() {
    const out = [];
    for (const { kind, seed, z, w, list } of this.groups.values()) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const x of list) x.dispose();
      out.push(finalizePart(g, kind, seed, z, w));
    }
    this.groups.clear();
    return out;
  }
}

/** Siatka z wierzchołków i trójkątów (pas szyny). */
class Acc {
  constructor() { this.p = []; this.n = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(P, N) { this.p.push(P.x, P.y, P.z); this.n.push(N.x, N.y, N.z); return this.count - 1; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.count * 2), 2));
    g.setIndex(this.i);
    return g;
  }
}

/** Ziarno 0…1 z indeksu (złota proporcja — powtarzalne, bez generatora). */
const seedOf = (k, salt = 0) => ((k * 0.618034 + salt * 0.381966) % 1 + 1) % 1;

/** Zmienia aPart.y (ziarno) per wierzchołek: `seedAt(i)` — np. faza błysku świateł w łańcuchu. */
function patchSeeds(g, seedAt) {
  const a = g.attributes.aPart;
  for (let i = 0; i < a.count; i++) a.setY(i, seedAt(i));
  return g;
}

// ── Układ: kotwice, wiązki lin, wózki, szyna ───────────────────────────────────────────────────────────────────────

/**
 * Układ wind (liczony raz na budowę): kotwice (rama: baza, szczyt, wysokość wieży), wiązki lin (obiekt kuli i rama: S —
 * czoło głowicy, E — czoło doku wózka, kierunek d, boki U / V, długość), wózki (punkt na osi szyny, kierunek promieniowy
 * i styczny) i szyna (środek, oś, baza płaszczyzny, promień) — w ramie elektrowni.
 */
export function elevatorLayout(L, b) {
  const D = ELEV_DOCK;
  const z0 = plantZ0(b);
  const M = plantFrameMatrix(b);
  const Mi = objectToFrameMatrix(b);
  const axO = earthSpinAxis();
  const toO = (v) => v.clone().applyMatrix4(M);
  const toF = (v) => v.clone().applyMatrix4(Mi);
  const dirF = (v) => v.clone().transformDirection(Mi);
  // strefy zakazane lin: oś promienia (wylot → odbiornik) z pierścieniem i radiatorami odbiornika, promień przekaźnikowy
  const hubO = toO(V3(0, hubHeight(L, b), 0));
  const beamO = toO(V3(0, L.apertureH, 0));
  const relayO = ringPointObject(hubO, axO, L.ringInnerR, V3());
  const keepHub = L.hubRing + (L.hubRadLen ?? 0.032) + L.elevClearHub;
  const clearance = (P, Q) => Math.min(segSegDist(P, Q, beamO, hubO) - keepHub, segSegDist(P, Q, hubO, relayO) - L.elevClearRelay);
  // płaszczyzna ringu: e1, e2 = oś × e1 (kąt θ rośnie zgodnie z obrotem wokół osi)
  const e1 = V3(1, 0, 0).addScaledVector(axO, -axO.x);
  if (e1.lengthSq() < 1e-6) e1.set(0, 0, 1).addScaledVector(axO, -axO.z);
  e1.normalize();
  const e2 = V3().crossVectors(axO, e1);
  const ringAngle = (P) => Math.atan2(P.dot(e2), P.dot(e1));
  const rRail = L.ringInnerR - L.elevRailInset;

  const anchors = [];
  const targets = [];
  L.elevators.forEach((az, i) => {
    const phi = az * DEG;
    const th = rimAngle(phi, b) + L.anchorPad + L.elevTowerOff;
    const X = V3(Math.cos(th) * Math.cos(phi), -Math.sin(th), -Math.cos(th) * Math.sin(phi));
    const Y = V3(Math.sin(th) * Math.cos(phi), Math.cos(th), -Math.sin(th) * Math.sin(phi));
    const Z = V3(Math.sin(phi), 0, Math.cos(phi));
    const base = surfacePoint(th, phi, 1, z0);
    // wieża: elevTowerH, wyżej tylko wtedy, gdy lina do ringu nie omija kuli z zapasem
    let H = L.elevTowerH;
    const topAt = (h) => toO(base.clone().addScaledVector(Y, h + D.headLift));
    while (H < 0.09 && !segmentClearsSphere(topAt(H), ringPointObject(topAt(H), axO, rRail, V3()), 1.004)) H += 0.002;
    const topO = topAt(H);
    const q0 = ringPointObject(topO, axO, L.ringInnerR, V3());
    // widełki: lina przez promień / odbiornik / przekaźnik → dwie wiązki obrócone o ±Δ (najmniejsze z zapasem)
    let deltas = [0];
    if (clearance(topO, q0) < 0) {
      for (let dd = 0.25; dd <= 30; dd += 0.25) {
        const a = dd * DEG;
        const ok = [a, -a].every((s) => clearance(topO, q0.clone().applyAxisAngle(axO, s)) >= 0);
        if (ok) { deltas = [-a, a]; break; }
      }
    }
    const anchor = { i, az, phi, th, H, basis: new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(base), base, X, Y, Z, topO, bundles: [] };
    anchors.push(anchor);
    for (const dl of deltas) targets.push({ anchor, theta: ringAngle(q0) + dl, split: deltas.length > 1 });
  });
  // wózki rozsunięte na szynie: odstęp ≥ elevRailSep (relaksacja par sąsiednich po obwodzie)
  const sep = L.elevRailSep * DEG;
  const order = targets.slice().sort((p, q) => p.theta - q.theta);
  for (let it = 0; it < 64; it++) {
    let moved = false;
    for (let k = 0; k < order.length; k++) {
      const A = order[k], B = order[(k + 1) % order.length];
      let gap = B.theta - A.theta;
      if (k === order.length - 1) gap += TAU;
      if (order.length > 1 && gap < sep) {
        const push = (sep - gap) * 0.5 + 1e-6;
        A.theta -= push;
        B.theta += push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const bundles = targets.map((t, k) => {
    const { anchor } = t;
    const radO = e1.clone().multiplyScalar(Math.cos(t.theta)).addScaledVector(e2, Math.sin(t.theta));
    const railO = radO.clone().multiplyScalar(rRail);
    const portO = railO.clone().addScaledVector(radO, -D.portIn);
    const d = V3().subVectors(portO, anchor.topO).normalize();
    const S = anchor.topO.clone().addScaledVector(d, D.headLen);
    const E = portO.clone().addScaledVector(d, -D.houseLen);
    let U = V3().crossVectors(d, axO);
    if (U.lengthSq() < 1e-8) U = V3().crossVectors(d, e1);
    U.normalize();
    const Vv = V3().crossVectors(U, d);
    const tanO = V3().crossVectors(axO, radO);
    const bundle = {
      k, anchor, split: t.split, theta: t.theta, len: S.distanceTo(E), seed: seedOf(k, 3),
      clearsEarth: segmentClearsSphere(S, E, 1.004),
      obj: { S, E, d, U, V: Vv, top: anchor.topO, rail: railO, rad: radO, tan: tanO },
      // rama elektrowni
      S: toF(S), E: toF(E), d: dirF(d), U: dirF(U), V: dirF(Vv), top: toF(anchor.topO), rail: toF(railO), port: toF(portO),
      rad: dirF(radO), tan: dirF(tanO)
    };
    anchor.bundles.push(bundle);
    return bundle;
  });
  const rail = { center: toF(V3()), axis: dirF(axO), e1: dirF(e1), e2: dirF(e2), r: rRail, axO, e1O: e1, e2O: e2 };
  return { anchors, bundles, rail };
}

// ── Kotwica-stacja i wieża ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Kotwica w bazie wieży (x — od brzegu na zewnątrz, y — pion, z — wzdłuż brzegu; początek: oś wieży na gruncie).
 * Plac obudowy (pokład h 0,0034) kończy się w x = anchorPad + elevTowerOff − liningPlazaOut przed wieżą.
 */
function buildAnchor(L, A, sink, flow) {
  const D = ELEV_DOCK;
  const m = A.basis;
  const seed = seedOf(A.i, 1);
  const P = (x, y, z) => V3(x, y, z).applyMatrix4(m);
  const off = L.anchorPad + L.elevTowerOff;     // odległość osi wieży od brzegu
  const sx = (s) => s - off;                     // współrzędna x z odległości od brzegu
  const H = A.H;
  const bh = L.elevTowerBase, th = L.elevTowerTop;
  const y0 = 0.0058;                              // wierzch podestu (stopy nóg)
  const H0 = H - 0.0012;                          // spód pokładu doku
  // pół-bok wieży: nogi wygięte (rozłożona stopa, smukły trzon)
  const half = (y) => th + (bh - th) * Math.pow(Math.max(0, 1 - (y - y0) / (H0 - y0)), L.elevTowerFlare);

  // PODEST: dwa sześciokąty (dolny wchodzi w stok placu), listwa ciepła na krawędzi górnego
  sink.add(prism(m, 6, 0.0086, -0.003, 0.0042, { rot: Math.PI / 2 }), PART.HULL, seed);
  sink.add(prism(m, 6, 0.0070, 0.0042, y0, { rot: Math.PI / 2 }), PART.HULL, seedOf(A.i, 2));
  sink.add(prism(m, 6, 0.00706, y0 - 0.0005, y0 - 0.0001, { rot: Math.PI / 2, open: true }), PART.STRIP, seed, 0.3, 0);
  // HALA PRZYŁĄCZA nad końcem wiązki rur obudowy (skrzynia przyłącza s 0,0091–0,0119 w środku hali; rury wchodzą w czoło)
  const hx0 = sx(0.0082), hx1 = sx(0.0128);
  sink.add(box(m, hx0, hx1, 0.0026, 0.0106, -0.0088, 0.0088), PART.HULL, seed);
  sink.add(box(m, hx0 - 0.0001, hx1 + 0.0001, 0.0064, 0.0086, -0.0089, 0.0089), PART.WINDOW, seed, 0.55);
  sink.add(box(m, hx0 - 0.0002, hx0 + 0.0003, 0.0106, 0.0109, -0.0080, 0.0080), PART.STRIP, seed, 0.4, 1);
  // transformatory na dachu hali (cewki) i podstawy
  for (const z of [-0.0046, 0.0046]) {
    const cx = (hx0 + hx1) / 2;
    sink.add(prism(m, 12, 0.0012, 0.0106, 0.0110, { cx, cz: z, hard: false }), PART.STRUCT, seed);
    sink.add(prism(m, 12, 0.0010, 0.0110, 0.0126, { cx, cz: z, hard: false }), PART.COIL, seed, (A.i / 6 + (z > 0 ? 0.5 : 0)) % 1, 0.6);
  }
  // BUDYNKI OBSŁUGI po bokach wieży (poza obrysem nóg)
  for (const sg of [-1, 1]) {
    const z0 = sg * 0.0052, z1 = sg * 0.0072;
    sink.add(box(m, -0.0021, 0.0011, 0.0040, 0.0084, Math.min(z0, z1), Math.max(z0, z1)), PART.HULL, seed);
    sink.add(box(m, -0.0022, 0.0012, 0.0052, 0.0076, Math.min(z0, z1) - 0.0001, Math.max(z0, z1) + 0.0001), PART.WINDOW, seed, 0.6);
    sink.add(box(m, -0.0004, 0.0002, 0.0084, 0.0089, sg * 0.0062 - 0.0003, sg * 0.0062 + 0.0003), PART.BEACON, seedOf(A.i * 2 + sg, 5), 0.4, 0);
  }
  // LĄDOWISKO na zewnątrz: niska płyta na kładce, ciepły pierścień, światła wokół
  const px = 0.0118;
  sink.add(box(m, 0.0060, 0.0092, -0.0015, 0.0014, -0.0018, 0.0018), PART.HULL, seed);
  sink.add(prism(m, 12, 0.0034, -0.0015, 0.0010, { cx: px, R1: 0.0036, hard: false }), PART.HULL, seedOf(A.i, 4));
  sink.add(prism(m, 12, 0.0036, 0.0010, 0.0016, { cx: px, hard: false }), PART.HULL, seedOf(A.i, 4));
  sink.add(prism(m, 24, 0.00365, 0.0012, 0.0015, { cx: px, open: true, hard: false }), PART.STRIP, seed, 0.3, 0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6;
    const x = px + Math.cos(a) * 0.0030, z = Math.sin(a) * 0.0030;
    sink.add(box(m, x - 0.0002, x + 0.0002, 0.0016, 0.0020, z - 0.0002, z + 0.0002), PART.BEACON, seedOf(k, A.i), 0.8, 1);
  }

  // WIEŻA: nogi wygięte (odcinki między poziomami), rygle, krzyżulce, szprychy do pionu, pokłady serwisowe
  const C4 = [[1, 1], [-1, 1], [-1, -1], [1, -1]];   // narożniki; ściana (1, 2) — od otworu (−x): w dolnym panelu brama rur
  const corner = (k, y) => P(C4[k][0] * half(y), y, C4[k][1] * half(y));
  // poziomy: pierwszy nad bramą rur, panele maleją ku górze (ciąg geometryczny)
  const n = Math.max(3, L.elevTowerLevels | 0);
  const yA = 0.0135, yB = H - 0.0042;
  const ratio = 0.88;
  const unit = (yB - yA) * (1 - ratio) / (1 - ratio ** (n - 1));
  const lv = [yA];
  for (let j = 0; j < n - 1; j++) lv.push(lv[j] + unit * ratio ** j);
  const legY = [y0, ...lv, H0];
  const legR = (y) => 0.0006 + (0.00034 - 0.0006) * (y - y0) / (H0 - y0);
  for (let k = 0; k < 4; k++) {
    sink.add(box(m, C4[k][0] * bh - 0.0008, C4[k][0] * bh + 0.0008, y0 - 0.0002, y0 + 0.0006, C4[k][1] * bh - 0.0008, C4[k][1] * bh + 0.0008), PART.STRUCT, seed);
    for (let j = 0; j < legY.length - 1; j++) {
      sink.add(rod(corner(k, legY[j]), corner(k, legY[j + 1]), legR(legY[j]), 6, legR(legY[j + 1])), PART.STRUCT, seed);
    }
  }
  const panels = legY.slice(0, -1).map((y, j) => [y, legY[j + 1]]).slice(0, -1);
  panels.forEach(([ya, yb], j) => {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      if (j === 0 && k === 1) continue;          // brama rur od strony otworu
      sink.add(rod(corner(k, ya), corner(k2, yb), 0.00015), PART.STRUCT, seed);
      sink.add(rod(corner(k2, ya), corner(k, yb), 0.00015), PART.STRUCT, seed);
    }
  });
  lv.forEach((y, j) => {
    for (let k = 0; k < 4; k++) {
      sink.add(rod(corner(k, y), corner((k + 1) % 4, y), 0.0002), PART.STRUCT, seed);
      // szprychy do pionu (z góry: krzyż w każdym poziomie)
      sink.add(rod(P(C4[k][0] * 0.0007, y, C4[k][1] * 0.0007), corner(k, y), 0.00013), PART.STRUCT, seed);
    }
    sink.add(prism(m, 8, 0.0011, y - 0.00025, y + 0.00025, { rot: Math.PI / 8 }), PART.STRUCT, seed);
    // światła przeszkodowe na co trzecim poziomie (czerwone, na zewnątrz nóg)
    if (j % 3 === 1) {
      for (let k = 0; k < 4; k++) {
        const h = half(y) + 0.0006;
        const x = C4[k][0] * h, z = C4[k][1] * h;
        sink.add(box(m, x - 0.00025, x + 0.00025, y - 0.00025, y + 0.00025, z - 0.00025, z + 0.00025), PART.BEACON, seedOf(j * 4 + k, A.i), 0.5, 0);
      }
    }
  });
  // pokłady serwisowe z gondolą okien (dwa poziomy)
  for (const j of [Math.round(n * 0.3), Math.round(n * 0.65)]) {
    const y = lv[Math.min(j, lv.length - 1)];
    const h = half(y);
    sink.add(box(m, -h, h, y - 0.00025, y + 0.00035, -h, h), PART.HULL, seedOf(A.i, j));
    sink.add(prism(m, 8, h * 0.86, y - 0.0018, y - 0.00025, { rot: Math.PI / 8 }), PART.WINDOW, seedOf(A.i, j), 0.65);
    sink.add(prism(m, 8, h * 0.55, y - 0.0023, y - 0.0018, { rot: Math.PI / 8, R1: h * 0.86 }), PART.HULL, seedOf(A.i, j));
  }
  // PION ENERGII: przewód od tyłu hali przez bramę do osi, w górę do doku (impulsy ku dokowi)
  const feedY = 0.0075;
  const path = [P(hx1 - 0.0004, feedY, 0), P(0, feedY, 0), P(0, H0 + 0.0002, 0)];
  flow.push(pipeAlong(path, [0.0005, 0.0007], seed));
  sink.add(box(m, -0.0011, 0.0011, feedY - 0.0011, feedY + 0.0011, -0.0011, 0.0011), PART.STRUCT, seed);

  // DOK na szczycie: pokład z pierścieniem cewki, wsporniki, światła, BĘBEN z ramionami lin (widełki — dwa ramiona)
  sink.add(prism(m, 8, 0.0050, H0, H, { rot: Math.PI / 8 }), PART.HULL, seedOf(A.i, 7));
  sink.add(prism(m, 32, 0.0052, H0 + 0.0003, H0 + 0.0009, { open: true, hard: false }), PART.COIL, seed, A.i / L.elevators.length, 1.0);
  for (let k = 0; k < 4; k++) {
    sink.add(rod(corner(k, H - 0.0075), P(C4[k][0] * 0.0032, H0, C4[k][1] * 0.0032), 0.00018), PART.STRUCT, seed);
    const a = (k / 4) * TAU + Math.PI / 4;
    const x = Math.cos(a) * 0.0045, z = Math.sin(a) * 0.0045;
    sink.add(box(m, x - 0.00025, x + 0.00025, H, H + 0.0005, z - 0.00025, z + 0.00025), PART.BEACON, seedOf(k, A.i + 9), 0.5, 0);
  }
  const top = 2 * D.headLift;
  sink.add(prism(m, 8, D.drumR, H, H + top, { rot: Math.PI / 8 }), PART.HULL, seedOf(A.i, 8));
  sink.add(prism(m, 8, D.drumR * 1.04, H + top * 0.42, H + top * 0.58, { rot: Math.PI / 8 }), PART.WINDOW, seedOf(A.i, 8), 0.7);
  sink.add(prism(m, 8, D.drumR * 0.72, H + top, H + top + 0.0006, { rot: Math.PI / 8, R1: D.drumR * 0.6 }), PART.STRUCT, seed);
  // biały stroboskop na maszcie bębna
  sink.add(box(m, -0.00015, 0.00015, H + top + 0.0006, H + top + 0.0026, -0.00015, 0.00015), PART.STRUCT, seed);
  sink.add(box(m, -0.0004, 0.0004, H + top + 0.0026, H + top + 0.0034, -0.0004, 0.0004), PART.BEACON, seedOf(A.i, 11), 1.1, 1);
  for (const B of A.bundles) buildArm(B, B.top, 0.0012, D.headLen, sink, seed, true);
}

/** Ośmiokątny graniastosłup wzdłuż Y bazy m (płaskie ściany w ±x / ±z), pół-szerokość w, pół-grubość h, y0 → y1. */
function octBar(m, w, h, y0, y1, open = false) {
  const k = 1 / Math.cos(Math.PI / 8);
  const g = new THREE.CylinderGeometry(1, 1, y1 - y0, 8, 1, open);
  g.rotateY(Math.PI / 8);
  g.scale(w * k, 1, h * k);
  g.translate(0, (y0 + y1) / 2, 0);
  g.applyMatrix4(m);
  return flat(g);
}

/**
 * Ramię doku liny (na bębnie wieży albo dok wózka) w bazie (U, d, V) z początkiem O: ośmiokątna bryła od y0 do y1
 * wzdłuż d, czoło (wrota GLASS, kołnierz STRUCT, pierścień cewki, czerwone światła) w y1 (`front`) albo w y0. Kabina
 * w doku jest schowana w ramieniu (tam przechodzi z pasa na pas).
 */
function buildArm(B, O, y0, y1, sink, seed, front) {
  const D = ELEV_DOCK;
  const m = new THREE.Matrix4().makeBasis(B.U, B.d, B.V).setPosition(O);
  const w = D.headW, h = D.headH;
  const f = front ? y1 : y0, s = front ? 1 : -1;
  const span = (a, c) => [Math.min(a, c), Math.max(a, c)];
  sink.add(octBar(m, w, h, y0, y1), PART.HULL, seed);
  // wrota (ciemne szkło) w czole, kołnierz (szerszy pierścień), pierścień cewki za kołnierzem
  const [g0, g1] = span(f, f + s * 0.0001);
  sink.add(octBar(m, w * 0.82, h * 0.7, g0, g1), PART.GLASS, seed);
  const [k0, k1] = span(f - s * 0.0005, f + s * 0.00005);
  sink.add(octBar(m, w + 0.0004, h + 0.0004, k0, k1, true), PART.STRUCT, seed);
  const [c0, c1] = span(f - s * 0.0014, f - s * 0.0009);
  sink.add(octBar(m, w + 0.0002, h + 0.0002, c0, c1, true), PART.COIL, seed, B.seed, 0.7);
  // listwa chłodna na grzbiecie i czerwone światła przy czole
  const [l0, l1] = span(f - s * 0.0018, f - s * (Math.abs(y1 - y0) - 0.0008));
  sink.add(box(m, -w * 0.5, w * 0.5, l0, l1, h, h + 0.0002), PART.STRIP, seed, 0.4, 1);
  for (const sg of [-1, 1]) {
    const x = sg * (w * 0.62), y = f - s * 0.0025;
    sink.add(box(m, x - 0.00025, x + 0.00025, y - 0.00025, y + 0.00025, h - 0.0001, h + 0.0004), PART.BEACON, (B.seed + (sg > 0 ? 0.5 : 0)) % 1, 0.45, 0);
  }
}

/** Przewód PIPE wzdłuż łamanej (uv.y — droga od początku 0…1, z — długość), promienie odcinków `radii` (ostatni powtarzany). */
function pipeAlong(path, radii, seed) {
  const lens = path.slice(1).map((Q, k) => Q.distanceTo(path[k]));
  const total = lens.reduce((s, x) => s + x, 0);
  let acc = 0;
  const segs = lens.map((len, k) => {
    const g = cylinderBetween(path[k], path[k + 1], radii[Math.min(k, radii.length - 1)], 10);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (acc + uv.getY(i) * len) / total);
    acc += len;
    return g;
  });
  const g = mergeGeometries(segs, false);
  for (const x of segs) x.dispose();
  return finalizePart(g, PART.PIPE, seed, total, 1);
}

// ── Liny ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Wiązka: liny pasów ±1 i przewód energii między nimi (przepływ), ramki rozporowe z obejmą i światłem prowadzącym (metal). */
function buildBundle(L, B, sink, flow, beacons) {
  const w = L.elevLaneW, r = L.elevTetherR;
  const { S, E, d, U, V, len } = B;
  for (const [off, lane] of [[w, 1], [-w, -1]]) {
    const g = cylinderBetween(S.clone().addScaledVector(U, off), E.clone().addScaledVector(U, off), r, 10);
    flow.push(finalizePart(g, PART.TETHER, B.seed, len, lane));
  }
  // lina środkowa — przewód energii do ringu (impulsy od kotwicy ku szynie; z daleka linia barwy energii w wachlarzu)
  flow.push(finalizePart(cylinderBetween(S, E, r * 0.7, 10), PART.PIPE, B.seed, len, 1));
  // ramki co elevSpread (z dala od doków), błysk świateł biegnie od kotwicy do ringu
  const end = 0.012;
  const count = Math.max(1, Math.round((len - 2 * end) / L.elevSpread));
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const a = end + (k + 0.5) * (len - 2 * end) / count;
    const C = S.clone().addScaledVector(d, a);
    m.makeBasis(U, d, V).setPosition(C);
    sink.add(rod(C.clone().addScaledVector(U, -w), C.clone().addScaledVector(U, w), 0.00022, 4), PART.STRUCT, B.seed);
    sink.add(box(m, -0.0004, 0.0004, -0.0005, 0.0005, -0.0004, 0.0004), PART.STRUCT, B.seed);
    const red = k % 4 === 3;
    beacons[red ? 0 : 1].push({ g: box(m, -0.00022, 0.00022, -0.00022, 0.00022, 0.0004, 0.00085), seed: ((-k * 0.5 * 0.11) % 1 + 1) % 1 / 7.7 });
  }
}

// ── Szyna ringu i wózki ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Szyna: przekrój (ρ — od osi obrotu na zewnątrz, z — wzdłuż osi) z fazami górnych krawędzi; pas środkowy wierzchu —
 * lampy (2 / 8 okresu), pas ściany od planety — przerywane listwy (5 / 8), obejmy co 4 próbki, światła co 16.
 */
function buildRail(L, rail, sink, metal) {
  const N = Math.max(1024, L.elevRailSeg | 0);
  const { center, axis, e1, e2, r } = rail;
  const hr = 0.0015, hz = 0.0020, ch = 0.0004, bw = 0.0006, bz = 0.0005;
  // wielokąt przekroju przeciwnie do wskazówek zegara w (ρ, z); pasy listew: krawędzie 4 (wierzch) i 8 (od planety)
  const prof = [[-hr, -hz], [hr, -hz], [hr, hz - ch], [hr - ch, hz], [bw, hz], [-bw, hz], [-hr + ch, hz], [-hr, hz - ch], [-hr, bz], [-hr, -bz]];
  const bands = new Set([4, 8]);
  const cs = new Float64Array(N + 1), sn = new Float64Array(N + 1);
  for (let j = 0; j <= N; j++) { cs[j] = Math.cos((j / N) * TAU); sn[j] = Math.sin((j / N) * TAU); }
  const radial = (j, out) => out.copy(e1).multiplyScalar(cs[j]).addScaledVector(e2, sn[j]);
  const hull = new Acc(), strip = new Acc();
  const c = V3(), Pt = V3(), Nn = V3();
  const emit = (acc, k, j0, j1) => {
    const [p0, p1] = [prof[k], prof[(k + 1) % prof.length]];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const nr = (p1[1] - p0[1]) / len, nz = -(p1[0] - p0[0]) / len;
    const base = acc.count;
    for (let j = j0; j <= j1; j++) {
      radial(j, c);
      Nn.copy(c).multiplyScalar(nr).addScaledVector(axis, nz);
      for (const p of [p0, p1]) acc.vert(Pt.copy(center).addScaledVector(c, r + p[0]).addScaledVector(axis, p[1]), Nn);
    }
    for (let j = 0; j < j1 - j0; j++) {
      const a = base + j * 2, bq = a + 1, cq = a + 2, dq = a + 3;
      acc.i.push(a, cq, bq, bq, cq, dq);
    }
  };
  // pas wierzchu: krótkie jasne lampy (2 z 8 próbek, ciepłe — odróżniają się od nieruchomych chłodnych kresek ringu;
  // z kamery gry kropki sunące z dobą), pas od planety: długie przygaszone listwy chłodne (5 z 8, pół okresu dalej)
  const lamps = new Acc();
  const dashed = (k, acc, len, shift) => {
    let j = 0;
    for (let p = -shift; p < N; p += 8) {
      const a = Math.max(0, p), e = Math.min(N, p + len);
      if (e <= a) continue;
      if (a > j) emit(hull, k, j, a);
      emit(acc, k, a, e);
      j = e;
    }
    if (j < N) emit(hull, k, j, N);
  };
  for (let k = 0; k < prof.length; k++) {
    if (!bands.has(k)) emit(hull, k, 0, N);
    else if (k === 4) dashed(k, lamps, 2, 0);
    else dashed(k, strip, 5, 4);
  }
  metal.push(finalizePart(hull.geometry(), PART.HULL, 0.731));
  metal.push(finalizePart(strip.geometry(), PART.STRIP, 0.731, 0.3, 1));
  metal.push(finalizePart(lamps.geometry(), PART.STRIP, 0.731, 0.7, 0));
  // obejmy (stal) co 4 próbki i światła co 16 (na zmianę czerwone / białe; faza z położenia)
  const m = new THREE.Matrix4();
  const tng = V3();
  const lights = [[], []];
  for (let j = 0; j < N; j += 4) {
    radial(j, c);
    tng.crossVectors(axis, c);
    m.makeBasis(tng, c, axis).setPosition(Pt.copy(center).addScaledVector(c, r));
    sink.add(box(m, -0.0005, 0.0005, -hr - 0.0003, hr + 0.0003, -hz - 0.0003, hz + 0.0003), PART.STRUCT, 0.413);
    if (j % 16 === 8) {
      radial(j, c);
      lights[(j / 16) % 2 < 1 ? 0 : 1].push({ g: box(m, -0.0003, 0.0003, 0.0006, 0.0012, hz, hz + 0.0005), seed: (j / N * 13) % 1 });
    }
  }
  return lights;
}

/**
 * Wózek na szynie w punkcie zaczepu wiązki (jak wagon na torze): dwa wózki jezdne obejmujące szynę, kadłub
 * (ośmiokątny, wzdłuż szyny) od strony planety z pasem okien i jasnym obrysem grzbietu, światła, dok kabin ku kotwicy.
 */
function buildCarriage(B, rail, sink) {
  const D = ELEV_DOCK;
  const seed = B.seed;
  // baza wózka: x — wzdłuż szyny, y — ku planecie, z — wzdłuż osi obrotu (początek na osi szyny)
  const m = new THREE.Matrix4().makeBasis(B.tan, B.rad.clone().negate(), rail.axis).setPosition(B.rail);
  // kadłub: ośmiokąt wzdłuż szyny — baza (promień, styczna, oś), środek cy ku planecie
  const cy = D.portIn + 0.0008;
  const mb = new THREE.Matrix4().makeBasis(B.rad, B.tan, rail.axis).setPosition(B.rail.clone().addScaledVector(B.rad, -cy));
  const hw = 0.0035, hh = 0.0034, hl = 0.0080;
  sink.add(octBar(mb, hw, hh, -hl, hl), PART.HULL, seed);
  sink.add(octBar(mb, hw * 0.8, hh * 0.8, -hl - 0.0006, hl + 0.0006), PART.STRUCT, seed);
  sink.add(octBar(mb, hw + 0.00006, hh + 0.00006, -hl * 0.72, hl * 0.72), PART.WINDOW, seed, 0.65);
  // wózki jezdne obejmujące szynę (wchodzą w kadłub)
  for (const x of [-0.0064, 0.0064]) {
    sink.add(box(m, x - 0.0016, x + 0.0016, -0.0026, 0.0030, -0.0032, 0.0032), PART.STRUCT, seed);
    sink.add(box(m, x - 0.00025, x + 0.00025, -0.0010, -0.0004, 0.0032, 0.0037), PART.BEACON, (seed + x * 31 + 1) % 1, 0.6, 0);
  }
  // obrys grzbietu (z kamery gry jasna ramka wagonu) i biały błysk
  for (const sg of [-1, 1]) {
    const y = cy + sg * hw * 0.62;
    sink.add(box(m, -hl * 0.9, hl * 0.9, y - 0.0002, y + 0.0002, hh - 0.0001, hh + 0.00012), PART.STRIP, seed, 0.45, 1);
  }
  sink.add(box(m, -0.0004, 0.0004, cy - 0.0004, cy + 0.0004, hh, hh + 0.0007), PART.BEACON, (seed + 0.3) % 1, 1.0, 1);
  // dok kabin: od wnętrza kadłuba ku kotwicy (czoło = koniec lin)
  buildArm(B, B.E, 0, D.houseLen, sink, seed, false);
}

// ── Złożenie ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Windy: { metal: części, flow: części } w ramie elektrowni. */
export function buildElevators(L, b) {
  const layout = elevatorLayout(L, b);
  const metal = [];
  const flow = [];
  const sink = new Sink();
  const beacons = [[], []];   // światła prowadzące: czerwone, białe (ziarno = faza łańcucha)
  for (const A of layout.anchors) buildAnchor(L, A, sink, flow);
  for (const B of layout.bundles) {
    buildBundle(L, B, sink, flow, beacons);
    buildCarriage(B, layout.rail, sink);
  }
  const railLights = buildRail(L, layout.rail, sink, metal);
  // łańcuchy świateł: jedna część na barwę, ziarno (faza błysku) per wierzchołek
  const chain = (list, z, w) => {
    if (!list.length) return;
    const seeds = [];
    for (const { g, seed } of list) for (let i = 0; i < g.attributes.position.count; i++) seeds.push(seed);
    const g = mergeGeometries(list.map((x) => x.g), false);
    for (const x of list) x.g.dispose();
    metal.push(patchSeeds(finalizePart(g, PART.BEACON, 0, z, w), (i) => seeds[i]));
  };
  chain(beacons[0], 0.5, 0);
  chain(beacons[1], 0.5, 1);
  chain(railLights[0], 0.6, 0);
  chain(railLights[1], 0.6, 1);
  metal.push(...sink.parts());
  return { metal, flow };
}

/**
 * Kabiny (dodatek na GPU): rekordy instancji w układzie OBIEKTU kuli — S, E (czoła doków), U (bok — pas +1), odsunięcie
 * pasa, schowanie w doku, faza, okres [s], ziarno. Okres = 4096 / n (zegar elektrowni zawija się bez skoku kabin).
 */
export function climberInstances(L, b) {
  const D = ELEV_DOCK;
  const { bundles } = elevatorLayout(L, b);
  const per = Math.max(1, Math.min(L.elevCabins | 0, Math.floor(CLIMBER_MAX / Math.max(1, bundles.length))));
  const lane = L.elevLaneW + L.elevTetherR + D.cabGap + D.cabR;
  const out = [];
  for (const B of bundles) {
    const len = B.len;
    const v = Math.min(0.015, Math.max(0.006, len / L.elevCabinTrip));
    // cykl: jazda w górę 0,4, postój 0,1, w dół 0,4, postój 0,1 (kabiny co 1/per okresu — nigdy dwie w jednym doku)
    const want = (len + 2 * D.dockIn) / v / 0.4;
    const period = 4096 / Math.max(1, Math.round(4096 / want));
    for (let k = 0; k < per; k++) {
      out.push({
        S: B.obj.S, E: B.obj.E, U: B.obj.U, lane, dockIn: D.dockIn,
        phase: (k / per + B.seed * 0.37) % 1, period, seed: seedOf(B.k * 7 + k, 2)
      });
    }
  }
  return out;
}

/** Dodatki elektrowni (kontrakt w nagłówku earthBitePlant.js): kabiny wind na GPU. */
export const extras = [(uniforms) => createClimbers(uniforms, climberInstances)];
