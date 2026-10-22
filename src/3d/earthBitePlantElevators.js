// Elektrownia „KOREK” — WINDY KOSMICZNE DO RINGU PLANETARNEGO (decyzja użytkownika 2026-10-22: „winda ma być do ringu
// planetarnego”). Ziemia obraca się wokół osi ringu (earthSpin.js), ring gry jest równikowy i stoi względem gruntu, więc
// liny są STAŁE w układzie Ziemi. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js), części z rodzajem
// powierzchni (PART): bryły — materiał metalu, liny i przewody — materiał przepływu; kabiny i linie energii wiązek jadą
// na GPU (dodatki `extras`, earthBitePlantClimbers.tsl.js).
//   • KOTWICE-STACJE na placach korony obudowy (azymuty L.elevators = 0, 60, …, 300 — bez południka gryzu; oś wieży
//     w rimAngle + anchorPad + elevTowerOff): dwustopniowy podest (sześciokąt) na skraju placu, hala przyłącza nakrywająca
//     koniec wiązki rur obudowy (liningTerminalPoint — rury wchodzą w czoło hali), budynki obsługi z oknami, lądowisko.
//     WIEŻA = MEGASTRUKTURA (~200 km): PANCERNY RDZEŃ (ośmiobok zwężany ku górze, własne uv — panele i pasy okien
//     kondygnacji), cztery PŁETWY-PRZYPORY u stopy (po przekątnych) przechodzące w pilastry do głowicy, dwa kołnierze
//     ze światłami przeszkodowymi; PION ENERGII — przewód na licu rdzenia od strony hali (z daleka linia energii, dodatek
//     GPU); GŁOWICA DOKU: kielich rozszerzający się z rdzenia, pokład z jasnym pierścieniem cewki i oknami sterowni,
//     bęben z masztem stroboskopu i ośmiokątne RAMIONA lin (wrota kabin, kołnierz, cewka) — lina wychodzi z czoła ramienia.
//   • LINY: czoło ramienia głowicy → najbliższy punkt WEWNĘTRZNEJ KRAWĘDZI RINGU (ringPointObject w układzie obiektu
//     kuli); przy azymutach 0, 60, …, 300 wszystkie liny omijają promień, odbiornik i przekaźnik (gdyby nie — widełki ±Δ
//     wokół osi obrotu, elevClearHub / elevClearRelay). Wiązka: dwie liny pasów (w = ±1; kabiny jadą PO ZEWNĘTRZNEJ
//     stronie liny), między nimi przewód energii (PIPE — impulsy ku ringowi; z daleka LINIA ENERGII z pakietami rysowana
//     na GPU z szerokością ≥ 1,6 px — w kadrze gry liny są drugie w hierarchii jasności po promieniu), ramki rozporowe
//     co elevSpread z BIAŁYMI światłami prowadzącymi (czerwone światła pozycyjne tylko na bryłach kotwic i doków —
//     czerwień na cyjanowej linii zlewała się z daleka w różowe paciorki). Z daleka kabiny jadą po osi wiązki (LOD
//     rozstawu pasów w earthBitePlantClimbers.tsl.js) — na linii energii, nie obok niej.
//   • SZYNA RINGU — płaszcz obracający się z Ziemią: pełny okrąg w płaszczyźnie równika osi obrotu, tuż wewnątrz
//     krawędzi ringu (oś szyny w ringInnerR − elevRailInset), przekrój skrzynkowy z fazami, na wierzchu krótkie ciepłe
//     lampy (przy wózkach gęściej i jaśniej — widać, gdzie lina dochodzi do ringu), od planety przerywane chłodne listwy,
//     obejmy co 1/256 obwodu, rzadkie światła.
//   • WÓZKI na szynie w punktach zaczepu lin (jak wagon na torze): wózki jezdne obejmujące szynę, ośmiokątny kadłub
//     z pasem okien i JASNYM OBRYSEM na grzbiecie (z kamery gry ramka wagonu), długi dok kabin ku kotwicy, światła.
//   • TERMINAL PRZEKAŹNIKA: na szynie w punkcie, w którym kończy się promień przekaźnikowy (ringPointObject(środek
//     odbiornika, oś obrotu, ringInnerR)) — większy wózek z pylonem i CZASZĄ odbiorczą zwróconą ku odbiornikowi (środek
//     czaszy na linii promienia, elevTermDish przed punktem ringu; pierścienie cewki, róg odbiorczy w ognisku), odbieraki
//     prądu do ściany ringu.
// Wszystko ELEV leży w walcu < ringInnerR od osi obrotu (z kamery gry nic nie wchodzi na ring).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  DEG, PART, finalizePart, surfacePoint, plantZ0, hubHeight, rimAngle, cylinderBetween, plantFrameMatrix,
  objectToFrameMatrix, ringPointObject, segmentClearsSphere
} from './earthBitePlantFrame.js';
import { earthSpinAxis } from './earthSpin.js';
import { createClimbers, createTetherGlow, CLIMBER_MAX } from './earthBitePlantClimbers.tsl.js';

/** Wymiary wind (R Ziemi). Azymuty (`elevators`), odsunięcie kotwic (`anchorPad`), ring (`ringInnerR`) — w PLANT_LAYOUT. */
export const ELEV_DEFAULTS = Object.freeze({
  elevTowerOff: 0.0045,   // oś wieży za rimAngle + anchorPad (plac obudowy kończy się na + 0,0115, hala przyłącza przed wieżą)
  elevTowerH: 0.034,      // wysokość pokładu doku nad gruntem (wyżej, jeśli lina nie omija kuli z zapasem 1,004)
  elevTowerBase: 0.0042,  // apotema rdzenia wieży u stopy
  elevTowerTop: 0.0024,   // apotema rdzenia pod głowicą
  elevTowerFin: 0.0072,   // zasięg płetw-przypór u stopy (od osi, po przekątnej)
  elevTowerFinH: 0.016,   // wysokość płetw nad gruntem (wyżej — pilastry do głowicy)
  elevLaneW: 0.0020,      // odsunięcie lin pasów od osi wiązki
  elevTetherR: 0.0005,    // promień liny pasa (środkowa — 0,7 ×)
  elevSpread: 0.025,      // odstęp ramek rozporowych wzdłuż liny
  elevRailInset: 0.0045,  // szyna ringu: oś w ringInnerR − inset (zewnętrzna ściana szyny ~0,003 R przed ścianą ringu)
  elevRailSeg: 1024,      // próbki obwodu szyny (≥ 1024)
  elevRailSep: 2.2,       // najmniejszy odstęp wózków na szynie [°]
  elevRailNear: 12,       // lampy szyny gęściej i jaśniej w ±tylu próbkach od wózka
  elevClearHub: 0.015,    // zapas liny od odbiornika (ponad pierścień i radiatory) [R]
  elevClearRelay: 0.05,   // zapas liny od promienia przekaźnikowego [R]
  elevCabins: 6,          // kabiny na wiązkę (razem ≤ CLIMBER_MAX)
  elevCabinTrip: 40,      // docelowy czas przejazdu [s] (prędkość z długości, w granicach 0,006–0,015 R/s)
  elevTermDish: 0.019,    // terminal przekaźnika: środek czaszy na linii promienia, tyle przed punktem ringu [R] (nad osią szyny)
  elevTermDishR: 0.0038   // promień czaszy terminala
});

/** Doki i kabiny (R Ziemi) — wspólne dla brył CPU i kabin na GPU (earthBitePlantClimbers.tsl.js). */
export const ELEV_DOCK = Object.freeze({
  headLen: 0.0095,   // ramię doku na szczycie wieży: czoło (początek lin) od osi wieży wzdłuż liny
  headW: 0.0064,     // pół-szerokość ramion doków (w poprzek pasów; przekrój ośmiokątny)
  headH: 0.0022,     // pół-grubość ramion doków
  headLift: 0.0023,  // oś ramion nad pokładem doku (środek bębna)
  drumR: 0.0040,     // bęben doku na pokładzie (ramiona wychodzą z niego)
  houseLen: 0.0110,  // dok wózka: od czoła (koniec lin) do środka kadłuba wózka
  portIn: 0.005,     // środek kadłuba wózka od osi szyny ku planecie
  cabR: 0.0012,      // promień kabiny
  cabGap: 0.0002,    // luz kabiny od liny
  dockIn: 0.0028     // środek kabiny w doku: za czołem doku (kabina schowana)
});

/** Linia energii wiązki (dodatek GPU): promień przewodu środkowego, ramki ze światłami (koniec, odstęp). */
const PIPE_R = 0.00035;
const FRAME_END = 0.012;

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

/**
 * Graniastosłup / stożek ścięty n-kątny wzdłuż Y bazy m (y0 → y1, promień R0 → R1), obrót wokół osi `rot`. `uv` = [obwód,
 * wysokość] [R] — własne uv części (uv.x wokół, uv.y wzdłuż; kontrakt: aPart.z < 0).
 */
function prism(m, n, R0, y0, y1, { rot = 0, R1 = R0, open = false, cx = 0, cz = 0, hard = true, uv = null } = {}) {
  const g = new THREE.CylinderGeometry(R1, R0, y1 - y0, n, 1, open);
  if (uv) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]);
  }
  g.rotateY(rot);
  g.translate(cx, (y0 + y1) / 2, cz);
  g.applyMatrix4(m);
  return hard ? flat(g) : g;
}

/** Pręt (walec n-boczny) P → Q, r → r1. */
const rod = (P, Q, r, n = 4, r1 = r) => cylinderBetween(P, Q, r, n, true, r1);

/**
 * Płyta: wypukły wielokąt `pts` [[x, y], …] (przeciwnie do wskazówek zegara) w płaszczyźnie xy bazy m, wyciągnięty
 * wzdłuż z o ±h (płetwy, wsporniki). Normalne płaskie.
 */
function slab(m, pts, h) {
  const p = [], idx = [];
  const n = pts.length;
  for (const z of [-h, h]) for (const [x, y] of pts) p.push(x, y, z);
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i + 1, i);              // przód (−z)
    idx.push(n, n + i, n + i + 1);      // tył (+z)
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.setIndex(idx);
  g.applyMatrix4(m);
  return flat(g);
}

/** Odwraca strony trójkątów (powierzchnia widoczna od środka — wnętrze czaszy). */
function flipFaces(g) {
  const ix = g.index;
  for (let i = 0; i < ix.count; i += 3) {
    const a = ix.getX(i + 1);
    ix.setX(i + 1, ix.getX(i + 2));
    ix.setX(i + 2, a);
  }
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
  return g;
}

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

// ── Układ: kotwice, wiązki lin, wózki, szyna, terminal przekaźnika ─────────────────────────────────────────────────

/**
 * Kształt wieży w bazie kotwicy (x — od brzegu na zewnątrz, y — pion, z — wzdłuż brzegu; początek: oś wieży na gruncie):
 * stopa rdzenia y0, spód głowicy Hc, spód pokładu doku H0, apotema rdzenia a(y), PION ENERGII (łamana: hala → lico
 * rdzenia od strony hali → w kielich głowicy).
 */
function towerShape(L, H) {
  const off = L.anchorPad + L.elevTowerOff;
  const y0 = 0.0058;                // wierzch podestu
  const H0 = H - 0.0012;            // spód pokładu doku
  const Hc = H0 - 0.0045;           // spód kielicha głowicy (koniec zwężanego rdzenia)
  const aB = L.elevTowerBase, aT = L.elevTowerTop;
  const a = (y) => aB + (aT - aB) * Math.min(1, Math.max(0, (y - y0) / (Hc - y0)));
  const hx0 = 0.0082 - off, hx1 = 0.0128 - off;   // hala przyłącza (od brzegu: 0,0082–0,0128)
  const feedY = 0.0075;
  const so = 0.0007;                // odsunięcie pionu od lica rdzenia
  const riser = [V3(hx1 - 0.0004, feedY, 0), V3(-(a(feedY) + so), feedY, 0), V3(-(aT + so), Hc + 0.0012, 0)];
  return { off, y0, H0, Hc, aB, aT, a, hx0, hx1, feedY, so, riser };
}

/**
 * Układ wind (liczony raz na budowę): kotwice (rama: baza, szczyt, wysokość wieży, pion energii), wiązki lin (obiekt kuli
 * i rama: S — czoło głowicy, E — czoło doku wózka, kierunek d, boki U / V, długość), wózki (punkt na osi szyny, kierunek
 * promieniowy i styczny), szyna (środek, oś, baza płaszczyzny, promień) i terminal przekaźnika (punkt ringu T, środek
 * czaszy, kierunek ku odbiornikowi) — w ramie elektrowni.
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
  const radialAt = (th) => e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
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
    // widełki (zapas na inne azymuty): lina przez promień / odbiornik / przekaźnik → dwie wiązki obrócone o ±Δ
    let deltas = [0];
    if (clearance(topO, q0) < 0) {
      for (let dd = 0.25; dd <= 30; dd += 0.25) {
        const a = dd * DEG;
        const ok = [a, -a].every((s) => clearance(topO, q0.clone().applyAxisAngle(axO, s)) >= 0);
        if (ok) { deltas = [-a, a]; break; }
      }
    }
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(base);
    const shape = towerShape(L, H);
    const riserO = shape.riser.map((p) => toO(p.clone().applyMatrix4(basis)));
    const anchor = { i, az, phi, th, H, basis, base, X, Y, Z, topO, shape, riserO, bundles: [] };
    anchors.push(anchor);
    for (const dl of deltas) targets.push({ anchor, theta: ringAngle(q0) + dl, split: deltas.length > 1 });
  });
  // terminal przekaźnika: stały punkt szyny (koniec promienia przekaźnikowego)
  const termTheta = ringAngle(relayO);
  // wózki rozsunięte na szynie: odstęp ≥ elevRailSep (relaksacja par sąsiednich po obwodzie; terminal stoi)
  const sep = L.elevRailSep * DEG;
  const order = [...targets, { fixed: true, theta: termTheta }].sort((p, q) => p.theta - q.theta);
  for (let it = 0; it < 64; it++) {
    let moved = false;
    for (let k = 0; k < order.length; k++) {
      const A = order[k], B = order[(k + 1) % order.length];
      let gap = B.theta - A.theta;
      if (k === order.length - 1) gap += TAU;
      if (order.length > 1 && gap < sep) {
        const push = sep - gap + 1e-6;
        const wa = A.fixed ? 0 : B.fixed ? 1 : 0.5;
        A.theta -= push * wa;
        B.theta += push * (1 - wa);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const bundles = targets.map((t, k) => {
    const { anchor } = t;
    const radO = radialAt(t.theta);
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
  // terminal: czasza na linii promienia przekaźnikowego, elevTermDish przed punktem ringu, zwrócona ku odbiornikowi
  const tRad = radialAt(termTheta);
  const tTan = V3().crossVectors(axO, tRad);
  const nO = V3().subVectors(hubO, relayO).normalize();
  const dishO = relayO.clone().addScaledVector(nO, L.elevTermDish);
  const terminal = {
    theta: termTheta, seed: 0.577,
    obj: { T: relayO.clone(), H: hubO.clone(), n: nO, dish: dishO, rail: tRad.clone().multiplyScalar(rRail), rad: tRad, tan: tTan },
    T: toF(relayO), H: toF(hubO), n: dirF(nO), dish: toF(dishO), rail: toF(tRad.clone().multiplyScalar(rRail)),
    rad: dirF(tRad), tan: dirF(tTan)
  };
  const rail = { center: toF(V3()), axis: dirF(axO), e1: dirF(e1), e2: dirF(e2), r: rRail, axO, e1O: e1, e2O: e2 };
  return { anchors, bundles, rail, terminal };
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
  const { y0, H0, Hc, aB, aT, a, hx0, hx1, so, riser } = A.shape;
  const H = A.H;
  const kc = 1 / Math.cos(Math.PI / 8);   // apotema → promień opisany ośmiokąta
  const perim = (ap) => 16 * ap * Math.tan(Math.PI / 8);
  const rot8 = Math.PI / 8;

  // PODEST: dwa sześciokąty (dolny wchodzi w stok placu), listwa ciepła na krawędzi górnego
  sink.add(prism(m, 6, 0.0092, -0.003, 0.0042, { rot: Math.PI / 2 }), PART.HULL, seed);
  sink.add(prism(m, 6, 0.0080, 0.0042, y0, { rot: Math.PI / 2 }), PART.HULL, seedOf(A.i, 2));
  sink.add(prism(m, 6, 0.00806, y0 - 0.0005, y0 - 0.0001, { rot: Math.PI / 2, open: true }), PART.STRIP, seed, 0.3, 0);
  // HALA PRZYŁĄCZA nad końcem wiązki rur obudowy (skrzynia przyłącza s 0,0091–0,0119 w środku hali; rury wchodzą w czoło)
  sink.add(box(m, hx0, hx1, 0.0026, 0.0106, -0.0088, 0.0088), PART.HULL, seed);
  sink.add(box(m, hx0 - 0.0001, hx1 + 0.0001, 0.0064, 0.0086, -0.0089, 0.0089), PART.WINDOW, seed, 0.55);
  sink.add(box(m, hx0 - 0.0002, hx0 + 0.0003, 0.0106, 0.0109, -0.0080, 0.0080), PART.STRIP, seed, 0.4, 1);
  // transformatory na dachu hali (cewki) i podstawy
  for (const z of [-0.0046, 0.0046]) {
    const cx = (hx0 + hx1) / 2;
    sink.add(prism(m, 12, 0.0012, 0.0106, 0.0110, { cx, cz: z, hard: false }), PART.STRUCT, seed);
    sink.add(prism(m, 12, 0.0010, 0.0110, 0.0126, { cx, cz: z, hard: false }), PART.COIL, seed, (A.i / 6 + (z > 0 ? 0.5 : 0)) % 1, 0.6);
  }
  // BUDYNKI OBSŁUGI po bokach wieży (między płetwami)
  for (const sg of [-1, 1]) {
    const z0 = sg * 0.0050, z1 = sg * 0.0070;
    sink.add(box(m, -0.0021, 0.0011, 0.0040, 0.0084, Math.min(z0, z1), Math.max(z0, z1)), PART.HULL, seed);
    sink.add(box(m, -0.0022, 0.0012, 0.0052, 0.0076, Math.min(z0, z1) - 0.0001, Math.max(z0, z1) + 0.0001), PART.WINDOW, seed, 0.6);
    sink.add(box(m, -0.0004, 0.0002, 0.0084, 0.0089, sg * 0.0060 - 0.0003, sg * 0.0060 + 0.0003), PART.BEACON, seedOf(A.i * 2 + sg, 5), 0.4, 0);
  }
  // LĄDOWISKO na zewnątrz: niska płyta na kładce, ciepły pierścień, światła wokół
  const px = 0.0118;
  sink.add(box(m, 0.0060, 0.0092, -0.0015, 0.0014, -0.0018, 0.0018), PART.HULL, seed);
  sink.add(prism(m, 12, 0.0034, -0.0015, 0.0010, { cx: px, R1: 0.0036, hard: false }), PART.HULL, seedOf(A.i, 4));
  sink.add(prism(m, 12, 0.0036, 0.0010, 0.0016, { cx: px, hard: false }), PART.HULL, seedOf(A.i, 4));
  sink.add(prism(m, 24, 0.00365, 0.0012, 0.0015, { cx: px, open: true, hard: false }), PART.STRIP, seed, 0.3, 0);
  for (let k = 0; k < 6; k++) {
    const an = (k / 6) * TAU + Math.PI / 6;
    const x = px + Math.cos(an) * 0.0030, z = Math.sin(an) * 0.0030;
    sink.add(box(m, x - 0.0002, x + 0.0002, 0.0016, 0.0020, z - 0.0002, z + 0.0002), PART.BEACON, seedOf(k, A.i), 0.8, 1);
  }

  // WIEŻA — PANCERNY RDZEŃ: ośmiobok zwężany od stopy do kielicha głowicy, własne uv (panele w poprzek i wzdłuż wieży)
  const coreH = Hc - (y0 - 0.0004);
  sink.add(prism(m, 8, aB * kc, y0 - 0.0004, Hc, { rot: rot8, R1: aT * kc, uv: [perim((aB + aT) / 2), coreH] }), PART.HULL, seedOf(A.i, 6), -1);
  // pasy okien kondygnacji (WINDOW z własnym uv: z = −gęstość) — dwa nisko między płetwami, trzy nad płetwami
  const fH = L.elevTowerFinH;
  const bands = [y0 + 0.0026, y0 + 0.0062, fH + 0.0014, fH + 0.0048, fH + 0.0082].filter((y) => y + 0.0021 < Hc - 0.0008);
  bands.forEach((yb, j) => {
    const y1 = yb + 0.0021;
    sink.add(prism(m, 8, a(yb) * kc + 0.00008, yb, y1, { rot: rot8, R1: a(y1) * kc + 0.00008, open: true, uv: [perim(a(yb)), 0.0021] }),
      PART.WINDOW, seedOf(A.i * 5 + j, 8), -0.8);
  });
  // PŁETWY-PRZYPORY po przekątnych (płyty: stopa na podeście, skos do rdzenia), dalej PILASTRY do kielicha
  const fin = L.elevTowerFin;
  for (let k = 0; k < 4; k++) {
    const an = Math.PI / 4 + k * Math.PI / 2;
    const mf = m.clone().multiply(new THREE.Matrix4().makeRotationY(-an));
    const pts = [[a(y0) * 0.8, y0 - 0.0006], [fin, y0 - 0.0006], [fin, y0 + 0.0016], [a(fH) + 0.0005, fH], [a(fH) * 0.8, fH]];
    sink.add(slab(mf, pts, 0.00055), PART.HULL, seedOf(A.i * 4 + k, 9));
    sink.add(box(mf, fin - 0.0004, fin + 0.0002, y0 - 0.0002, y0 + 0.0004, -0.0007, 0.0007), PART.STRUCT, seed);
    const c = Math.cos(an), s = Math.sin(an);
    const at = (y, e) => P(c * (a(y) + e), y, s * (a(y) + e));
    sink.add(rod(at(fH - 0.001, 0.0002), at(Hc + 0.0006, 0.00025), 0.00045, 4), PART.STRUCT, seed);
  }
  // KOŁNIERZE z czerwonymi światłami przeszkodowymi (po przekątnych, przy pilastrach)
  for (const yc of [fH + 0.0003, Hc - 0.0012]) {
    sink.add(prism(m, 8, a(yc) * kc + 0.00035, yc - 0.00035, yc + 0.00035, { rot: rot8 }), PART.STRUCT, seed);
    for (let k = 0; k < 4; k++) {
      const an = Math.PI / 4 + k * Math.PI / 2;
      const r = a(yc) + 0.0009;
      const x = Math.cos(an) * r, z = Math.sin(an) * r;
      sink.add(box(m, x - 0.0003, x + 0.0003, yc - 0.0003, yc + 0.0003, z - 0.0003, z + 0.0003), PART.BEACON, seedOf(k, A.i * 3 + (yc > 0.02 ? 1 : 0)), 0.5, 0);
    }
  }
  // PION ENERGII na licu od strony hali (przepływ; z daleka — linia energii, dodatek GPU) i obejmy co ~0,005
  flow.push(pipeAlong(riser.map((p) => p.clone().applyMatrix4(m)), [0.0005, 0.0007], seed));
  sink.add(box(m, -0.0011 - a(A.shape.feedY), -a(A.shape.feedY) + 0.0002, A.shape.feedY - 0.0011, A.shape.feedY + 0.0011, -0.0011, 0.0011), PART.STRUCT, seed);
  for (const yk of [0.012, 0.018, 0.024]) {
    if (yk > Hc - 0.001) continue;
    sink.add(box(m, -(a(yk) + so + 0.0009), -a(yk) + 0.0001, yk - 0.0003, yk + 0.0003, -0.0009, 0.0009), PART.STRUCT, seed);
  }

  // GŁOWICA DOKU: kielich z rdzenia, pas okien sterowni, pokład z jasnym pierścieniem cewki, światła, bęben z ramionami
  const deckA = 0.0054;
  const capA = (y) => aT + (deckA * 0.96 - aT) * (y - Hc) / (H0 - Hc);
  sink.add(prism(m, 8, aT * kc, Hc, H0, { rot: rot8, R1: capA(H0) * kc, uv: [perim((aT + deckA) / 2), H0 - Hc] }), PART.HULL, seedOf(A.i, 7), -1);
  const wy0 = H0 - 0.0019, wy1 = H0 - 0.0006;
  sink.add(prism(m, 8, capA(wy0) * kc + 0.00008, wy0, wy1, { rot: rot8, R1: capA(wy1) * kc + 0.00008, open: true, uv: [perim(capA(wy1)), wy1 - wy0] }),
    PART.WINDOW, seedOf(A.i, 12), -0.9);
  sink.add(prism(m, 8, deckA * kc, H0, H, { rot: rot8 }), PART.HULL, seedOf(A.i, 7));
  sink.add(prism(m, 32, deckA * kc + 0.0003, H0 + 0.0002, H0 + 0.0010, { open: true, hard: false }), PART.COIL, seed, A.i / L.elevators.length, 1.4);
  sink.add(prism(m, 8, deckA * kc + 0.00004, H - 0.00018, H - 0.00002, { rot: rot8, open: true }), PART.STRIP, seed, 0.9, 1);
  for (let k = 0; k < 4; k++) {
    const an = (k / 4) * TAU + Math.PI / 4;
    const x = Math.cos(an) * 0.0050, z = Math.sin(an) * 0.0050;
    sink.add(box(m, x - 0.0003, x + 0.0003, H, H + 0.0006, z - 0.0003, z + 0.0003), PART.BEACON, seedOf(k, A.i + 9), 0.5, 1);
  }
  const top = 2 * D.headLift;
  sink.add(prism(m, 8, D.drumR, H, H + top, { rot: rot8 }), PART.HULL, seedOf(A.i, 8));
  sink.add(prism(m, 8, D.drumR * 1.04, H + top * 0.42, H + top * 0.58, { rot: rot8 }), PART.WINDOW, seedOf(A.i, 8), 0.7);
  sink.add(prism(m, 8, D.drumR * 0.72, H + top, H + top + 0.0006, { rot: rot8, R1: D.drumR * 0.6 }), PART.STRUCT, seed);
  // biały stroboskop na maszcie bębna
  sink.add(box(m, -0.00015, 0.00015, H + top + 0.0006, H + top + 0.0026, -0.00015, 0.00015), PART.STRUCT, seed);
  sink.add(box(m, -0.0004, 0.0004, H + top + 0.0026, H + top + 0.0034, -0.0004, 0.0004), PART.BEACON, seedOf(A.i, 11), 1.1, 1);
  for (const B of A.bundles) buildArm(B, B.top, 0.0012, D.headLen, sink, seed, true);
}

/**
 * Ośmiokątny graniastosłup wzdłuż Y bazy m (płaskie ściany w ±x / ±z), pół-szerokość w, pół-grubość h, y0 → y1. `ownUv` —
 * uv w R (wokół, wzdłuż) dla części z własnym uv (aPart.z < 0: panele wzdłuż bryły, nie ukośnie z rzutu pudełkowego).
 */
function octBar(m, w, h, y0, y1, open = false, ownUv = false) {
  const k = 1 / Math.cos(Math.PI / 8);
  const g = new THREE.CylinderGeometry(1, 1, y1 - y0, 8, 1, open);
  if (ownUv) {
    const a = g.attributes.uv, per = 8 * Math.tan(Math.PI / 8) * 2 * (w + h), len = Math.abs(y1 - y0);
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getY(i) * len, a.getX(i) * per);
  }
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
  sink.add(octBar(m, w, h, y0, y1, false, true), PART.HULL, seed, -1);
  // wrota (ciemne szkło) w czole, kołnierz (szerszy pierścień), pierścień cewki za kołnierzem
  const [g0, g1] = span(f, f + s * 0.0001);
  sink.add(octBar(m, w * 0.82, h * 0.7, g0, g1), PART.GLASS, seed);
  // jasna ramka czoła wokół wrót (z kamery gry lina wchodzi w świecący prostokąt doku)
  const [r0, r1] = span(f, f + s * 0.00006);
  sink.add(octBar(m, w * 0.95, h * 0.92, r0, r1), PART.STRIP, seed, 1.4, 1);
  const [k0, k1] = span(f - s * 0.0005, f + s * 0.00005);
  sink.add(octBar(m, w + 0.0004, h + 0.0004, k0, k1, true), PART.STRUCT, seed);
  const [c0, c1] = span(f - s * 0.0014, f - s * 0.0009);
  sink.add(octBar(m, w + 0.0002, h + 0.0002, c0, c1, true), PART.COIL, seed, B.seed, 0.9);
  // listwa chłodna na grzbiecie i czerwone światła przy czole
  const [l0, l1] = span(f - s * 0.0018, f - s * (Math.abs(y1 - y0) - 0.0008));
  sink.add(box(m, -w * 0.5, w * 0.5, l0, l1, h, h + 0.0002), PART.STRIP, seed, 0.6, 1);
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

/** Odstęp ramek rozporowych wiązki (ich światła — też w linii energii na GPU). */
function frameStep(L, len) {
  const count = Math.max(1, Math.round((len - 2 * FRAME_END) / L.elevSpread));
  return { count, step: (len - 2 * FRAME_END) / count };
}

/** Wiązka: liny pasów ±1 i przewód energii między nimi (przepływ), ramki rozporowe z obejmą i światłem prowadzącym (metal). */
function buildBundle(L, B, sink, flow, beacons) {
  const w = L.elevLaneW, r = L.elevTetherR;
  const { S, E, d, U, V, len } = B;
  for (const [off, lane] of [[w, 1], [-w, -1]]) {
    const g = cylinderBetween(S.clone().addScaledVector(U, off), E.clone().addScaledVector(U, off), r, 10);
    flow.push(finalizePart(g, PART.TETHER, B.seed, len, lane));
  }
  // lina środkowa — przewód energii do ringu (impulsy od kotwicy ku szynie; z daleka linia energii — dodatek GPU)
  flow.push(finalizePart(cylinderBetween(S, E, PIPE_R, 10), PART.PIPE, B.seed, len, 1));
  // ramki co elevSpread (z dala od doków), błysk świateł biegnie od kotwicy do ringu
  const { count, step } = frameStep(L, len);
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const a = FRAME_END + (k + 0.5) * step;
    const C = S.clone().addScaledVector(d, a);
    m.makeBasis(U, d, V).setPosition(C);
    sink.add(rod(C.clone().addScaledVector(U, -w), C.clone().addScaledVector(U, w), 0.00022, 4), PART.STRUCT, B.seed);
    sink.add(box(m, -0.0004, 0.0004, -0.0005, 0.0005, -0.0004, 0.0004), PART.STRUCT, B.seed);
    // światła prowadzące ramek BIAŁE (czerwień na cyjanowej linii zlewała się w różowe paciorki; czerwone — tylko na
    // bryłach kotwic i doków)
    beacons.push({ g: box(m, -0.00022, 0.00022, -0.00022, 0.00022, 0.0004, 0.00085), seed: ((-k * 0.5 * 0.11) % 1 + 1) % 1 / 7.7 });
  }
}

// ── Szyna ringu i wózki ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Szyna: przekrój (ρ — od osi obrotu na zewnątrz, z — wzdłuż osi) z fazami górnych krawędzi; pas środkowy wierzchu —
 * lampy (2 / 8 okresu; w ±elevRailNear próbkach od wózka 2 / 4 i jaśniej), pas ściany od planety — przerywane listwy
 * (5 / 8), obejmy co 4 próbki, światła co 16. `stops` — kąty wózków i terminala [rad].
 */
function buildRail(L, rail, stops, sink, metal) {
  const N = Math.max(1024, L.elevRailSeg | 0);
  const { center, axis, e1, e2, r } = rail;
  const hr = 0.0015, hz = 0.0020, ch = 0.0004, bw = 0.0006, bz = 0.0005;
  // wielokąt przekroju przeciwnie do wskazówek zegara w (ρ, z); pasy listew: krawędzie 4 (wierzch) i 8 (od planety)
  const prof = [[-hr, -hz], [hr, -hz], [hr, hz - ch], [hr - ch, hz], [bw, hz], [-bw, hz], [-hr + ch, hz], [-hr, hz - ch], [-hr, bz], [-hr, -bz]];
  const cs = new Float64Array(N + 1), sn = new Float64Array(N + 1);
  for (let j = 0; j <= N; j++) { cs[j] = Math.cos((j / N) * TAU); sn[j] = Math.sin((j / N) * TAU); }
  const radial = (j, out) => out.copy(e1).multiplyScalar(cs[j]).addScaledVector(e2, sn[j]);
  const hull = new Acc(), strip = new Acc(), lamps = new Acc(), lampsNear = new Acc();
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
  // próbki przy wózkach (lampy gęściej)
  const near = new Uint8Array(N);
  for (const th of stops) {
    const jc = Math.round(((th / TAU) % 1 + 1) % 1 * N);
    for (let dj = -L.elevRailNear; dj <= L.elevRailNear; dj++) near[((jc + dj) % N + N) % N] = 1;
  }
  // przebiegi jednego rodzaju (ściana k, odcinki j → j + 1 wg `pick(j)`)
  const runs = (k, pick) => {
    let j0 = 0, cur = pick(0);
    for (let j = 1; j <= N; j++) {
      const nx = j < N ? pick(j) : null;
      if (nx !== cur) { emit(cur, k, j0, j); j0 = j; cur = nx; }
    }
  };
  for (let k = 0; k < prof.length; k++) {
    // wierzch: ciepłe lampy (z kamery gry kropki sunące z dobą; odróżniają się od nieruchomych chłodnych kresek ringu)
    if (k === 4) runs(k, (j) => (near[j] ? (j % 4 < 2 ? lampsNear : hull) : (j % 8 < 2 ? lamps : hull)));
    // ściana od planety: długie przygaszone listwy chłodne (5 z 8, pół okresu dalej)
    else if (k === 8) runs(k, (j) => ((j + 4) % 8 < 5 ? strip : hull));
    else emit(hull, k, 0, N);
  }
  metal.push(finalizePart(hull.geometry(), PART.HULL, 0.731));
  metal.push(finalizePart(strip.geometry(), PART.STRIP, 0.731, 0.3, 1));
  metal.push(finalizePart(lamps.geometry(), PART.STRIP, 0.731, 0.7, 0));
  if (lampsNear.count) metal.push(finalizePart(lampsNear.geometry(), PART.STRIP, 0.731, 1.3, 0));
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
      lights[(j / 16) % 2 < 1 ? 0 : 1].push({ g: box(m, -0.0003, 0.0003, 0.0006, 0.0012, hz, hz + 0.0005), seed: (j / N * 13) % 1 });
    }
  }
  return lights;
}

/**
 * Kadłub wózka na szynie (jak wagon na torze) w punkcie `C` ({ rail, rad, tan }): dwa wózki jezdne obejmujące szynę,
 * ośmiokątny kadłub (wzdłuż szyny) od strony planety z pasem okien, JASNY OBRYS na płaskim grzbiecie (z kamery gry
 * ramka wagonu, czytelna od ~0,0004 R/px), światła. Zwraca bazę m (x — wzdłuż szyny, y — ku planecie, z — oś obrotu)
 * i wymiary.
 */
function carriageBody(C, rail, sink, seed, { hl = 0.0080, hw = 0.0035, hh = 0.0034, glow = 1.3 } = {}) {
  const D = ELEV_DOCK;
  const m = new THREE.Matrix4().makeBasis(C.tan, C.rad.clone().negate(), rail.axis).setPosition(C.rail);
  const cy = D.portIn + 0.0008;
  const mb = new THREE.Matrix4().makeBasis(C.rad, C.tan, rail.axis).setPosition(C.rail.clone().addScaledVector(C.rad, -cy));
  sink.add(octBar(mb, hw, hh, -hl, hl, false, true), PART.HULL, seed, -1);
  sink.add(octBar(mb, hw * 0.8, hh * 0.8, -hl - 0.0006, hl + 0.0006), PART.STRUCT, seed);
  sink.add(octBar(mb, hw + 0.00006, hh + 0.00006, -hl * 0.72, hl * 0.72, false, true), PART.WINDOW, seed, -0.65);
  // wózki jezdne obejmujące szynę (wchodzą w kadłub)
  const bx = hl * 0.8;
  for (const x of [-bx, bx]) {
    sink.add(box(m, x - 0.0016, x + 0.0016, -0.0026, 0.0030, -0.0032, 0.0032), PART.STRUCT, seed);
    sink.add(box(m, x - 0.00025, x + 0.00025, -0.0010, -0.0004, 0.0032, 0.0037), PART.BEACON, (seed + x * 31 + 1) % 1, 0.6, 0);
  }
  // OBRYS na płaskim grzbiecie (ściana z = hh ośmioboku: |y − cy| ≤ 0,41 hw): dwie długie i dwie krótkie listwy chłodne
  const z0 = hh + 0.00008, z1 = hh + 0.00022;
  const ey = hw * 0.34, ex = hl * 0.94, t = 0.00026;
  for (const sg of [-1, 1]) {
    sink.add(box(m, -ex, ex, cy + sg * ey - t, cy + sg * ey + t, z0, z1), PART.STRIP, seed, glow, 1);
    sink.add(box(m, sg * ex - t, sg * ex + t, cy - ey, cy + ey, z0, z1), PART.STRIP, seed, glow, 1);
  }
  sink.add(box(m, -0.0004, 0.0004, cy - 0.0004, cy + 0.0004, z1, z1 + 0.0006), PART.BEACON, (seed + 0.3) % 1, 1.0, 1);
  return { m, cy, hl, hw, hh };
}

/** Wózek w punkcie zaczepu wiązki: kadłub (carriageBody) i długi dok kabin ku kotwicy (czoło = koniec lin). */
function buildCarriage(B, rail, sink) {
  carriageBody(B, rail, sink, B.seed);
  buildArm(B, B.E, 0, ELEV_DOCK.houseLen, sink, B.seed, false);
}

/**
 * TERMINAL PRZEKAŹNIKA: większy wózek w punkcie szyny, w którym kończy się promień przekaźnikowy, pylon i CZASZA odbiorcza
 * zwrócona ku odbiornikowi (środek na linii promienia, elevTermDish przed punktem ringu T): wnętrze ciemne szkło,
 * pierścienie cewki (brzeg i środek — z kamery gry cyjanowa tarcza na końcu promienia), róg odbiorczy w ognisku,
 * odbieraki prądu nad szyną do ściany ringu.
 */
function buildTerminal(L, Tm, rail, sink) {
  const seed = Tm.seed;
  const { m, cy, hl, hw, hh } = carriageBody(Tm, rail, sink, seed, { hl: 0.0115, hw: 0.0042, hh: 0.0040, glow: 1.5 });
  // czasza: baza prawoskrętna (styczna szyny, n, styczna × n) w środku czaszy — odbicie odwróciłoby strony trójkątów
  const n = Tm.n.clone();
  const t1 = Tm.tan.clone().addScaledVector(n, -Tm.tan.dot(n)).normalize();
  const t2 = V3().crossVectors(t1, n);
  const md = new THREE.Matrix4().makeBasis(t1, n, t2).setPosition(Tm.dish);
  const rD = L.elevTermDishR, dep = 0.0011;
  // wnętrze (stożek wklęsły, widoczny od przodu) — ciemne szkło; skorupa od tyłu i denko — kadłub
  const inner = new THREE.CylinderGeometry(rD, 0.0007, dep, 32, 1, true);
  inner.translate(0, -dep / 2, 0);
  sink.add(flipFaces(inner.applyMatrix4(md)), PART.GLASS, seed);
  sink.add(prism(md, 32, rD * 1.04, -dep * 1.7, 0.00004, { R1: rD * 1.04, open: true, hard: false }), PART.HULL, seed);
  sink.add(prism(md, 16, rD * 1.04, -dep * 1.9, -dep * 1.7, { R1: rD * 1.04 }), PART.HULL, seed);
  // pierścienie cewki na czole (brzeg i środek) i róg odbiorczy w ognisku
  const ring = (r0, r1, y) => {
    const g = new THREE.RingGeometry(r0, r1, 40, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g.applyMatrix4(md);
  };
  sink.add(ring(rD * 0.9, rD * 1.08, 0.00008), PART.COIL, seed, 0.0, 1.6);
  sink.add(ring(rD * 0.64, rD * 0.7, -dep * 0.28 + 0.00005), PART.COIL, seed, 0.33, 1.1);
  sink.add(ring(rD * 0.4, rD * 0.47, -dep * 0.52 + 0.00005), PART.COIL, seed, 0.66, 1.3);
  const F = Tm.dish.clone().addScaledVector(n, -dep * 0.75);
  sink.add(rod(F, Tm.dish.clone().addScaledVector(n, 0.0016), 0.0006, 8, 0.00035), PART.COIL, seed, 0.25, 2.0);
  // pylon: od grzbietu kadłuba do denka czaszy (ośmiokąt wzdłuż osi obrotu), dwa zastrzały do brzegu czaszy
  const top = V3(0, cy, hh).applyMatrix4(m);
  const back = Tm.dish.clone().addScaledVector(n, -dep * 1.9);
  const mp = new THREE.Matrix4().makeBasis(t1, V3().subVectors(back, top).normalize(), V3().crossVectors(t1, V3().subVectors(back, top).normalize()).normalize()).setPosition(top);
  sink.add(octBar(mp, 0.0011, 0.0011, -0.0002, top.distanceTo(back) + 0.0003), PART.HULL, seed);
  for (const sg of [-1, 1]) {
    const foot = V3(sg * hl * 0.7, cy, hh).applyMatrix4(m);
    const rim = Tm.dish.clone().addScaledVector(t1, sg * rD * 0.85).addScaledVector(n, -dep * 1.6);
    sink.add(rod(foot, rim, 0.00032, 6), PART.STRUCT, seed);
  }
  // odbieraki prądu: od grzbietu kadłuba nad szyną do ściany ringu (cewki — energia idzie w ring)
  for (const x of [-hl * 0.45, 0, hl * 0.45]) {
    sink.add(box(m, x - 0.00035, x + 0.00035, -L.elevRailInset + 0.00025, cy - hw * 0.3, hh * 0.55, hh * 0.55 + 0.0006), PART.COIL, seed, 0.15, 1.1);
  }
  // światła pozycyjne na narożach kadłuba
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = sx * hl * 0.98, y = cy + sy * hw * 0.5;
    sink.add(box(m, x - 0.0003, x + 0.0003, y - 0.0003, y + 0.0003, hh, hh + 0.0005), PART.BEACON, seedOf(sx + 2 * sy + 3, 13), 0.7, sy > 0 ? 1 : 0);
  }
}

// ── Złożenie ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Windy: { metal: części, flow: części } w ramie elektrowni. */
export function buildElevators(L, b) {
  const layout = elevatorLayout(L, b);
  const metal = [];
  const flow = [];
  const sink = new Sink();
  const beacons = [];         // światła prowadzące ramek (białe; ziarno = faza łańcucha)
  for (const A of layout.anchors) buildAnchor(L, A, sink, flow);
  for (const B of layout.bundles) {
    buildBundle(L, B, sink, flow, beacons);
    buildCarriage(B, layout.rail, sink);
  }
  buildTerminal(L, layout.terminal, layout.rail, sink);
  const stops = [...layout.bundles.map((B) => B.theta), layout.terminal.theta];
  const railLights = buildRail(L, layout.rail, stops, sink, metal);
  // łańcuchy świateł: jedna część na barwę, ziarno (faza błysku) per wierzchołek
  const chain = (list, z, w) => {
    if (!list.length) return;
    const seeds = [];
    for (const { g, seed } of list) for (let i = 0; i < g.attributes.position.count; i++) seeds.push(seed);
    const g = mergeGeometries(list.map((x) => x.g), false);
    for (const x of list) x.g.dispose();
    metal.push(patchSeeds(finalizePart(g, PART.BEACON, 0, z, w), (i) => seeds[i]));
  };
  chain(beacons, 0.5, 1);
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

/**
 * Linie energii (dodatek na GPU): przewód środkowy każdej wiązki (S → E, pakiety; bez świateł pozycyjnych) i pion energii
 * każdej wieży (lico rdzenia → kielich głowicy) — rekordy w układzie OBIEKTU kuli: S, E, bok U, promień przewodu,
 * przesunięcie drogi s0 (zgodność pakietów z przewodem PIPE), ziarno, odstęp i koniec ramek (0 — bez świateł).
 */
export function tetherGlowInstances(L, b) {
  const { bundles, anchors } = elevatorLayout(L, b);
  const out = [];
  for (const B of bundles) {
    const { step } = frameStep(L, B.len);
    out.push({ S: B.obj.S, E: B.obj.E, U: B.obj.U, r: PIPE_R, s0: 0, seed: B.seed, step, end: FRAME_END });
  }
  for (const A of anchors) {
    const [h, f, t] = A.riserO;
    const d = V3().subVectors(t, f).normalize();
    let U = V3().crossVectors(d, V3().subVectors(f, h));
    if (U.lengthSq() < 1e-12) U = V3(0, 1, 0).cross(d);
    out.push({ S: f, E: t, U: U.normalize(), r: 0.0007, s0: h.distanceTo(f), seed: seedOf(A.i, 4), step: 0, end: 0 });
  }
  return out;
}

/** Dodatki elektrowni (kontrakt w nagłówku earthBitePlant.js): kabiny wind i linie energii wiązek na GPU. */
export const extras = [
  (uniforms) => createClimbers(uniforms, climberInstances),
  (uniforms) => createTetherGlow(uniforms, tetherGlowInstances)
];
