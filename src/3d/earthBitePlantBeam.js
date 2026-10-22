// Elektrownia „KOREK” — PROMIEŃ ENERGII: główny z krateru korka do czaszy odbiornika (siatki w układzie obiektu kuli,
// dzieci grupy elektrowni) i przekaźnikowy z odbiornika do wewnętrznej krawędzi ringu (siatki w układzie gospodarza —
// grupa elektrowni po `attachRing`; ustawia je `placeRelay`), rozbłyski na końcach, kula ładowania magazynu i POLE
// pierścieni zamknięcia (linie strumienia między pierścieniem a promieniem), a w ramie elektrowni SPRZĘT: pierścienie
// zamknięcia unoszące się wokół promienia (`buildBeamHardware` — części metalu, scala orkiestrator).
// Materiał: earthBitePlantBeam.tsl.js (siatki to osłony, jasność analityczna z odległości od osi — opis tam).
//
// Warstwy i rysunki: główny — rdzeń z otoczką, włóknami i pakietami (wąska osłona, od gardzieli wylotu), szeroka poświata
// (od krawędzi krateru), rozbłyski i pole (wylot na wardze krateru, uderzenie pod czaszą — półkula, która nie wychodzi
// ponad czaszę, kula ładowania w sferze armilarnej nadajnika, walce pola w pierścieniach) — 3 rysunki; przekaźnik —
// promień (wszystkie warstwy w jednej osłonie) i trafienie w ring — 2 rysunki (źródłem przekazu jest kula ładowania).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PART, finalizePart, hubHeight, plantRng } from './earthBitePlantFrame.js';
import { createPlantBeamMaterial, BEAM_KIND, BEAM_LAYER } from './earthBitePlantBeam.tsl.js';
// wylot dyszy nadajnika (lufa odbiornika ku ringowi) — tu zaczyna się widoczny promień przekaźnikowy
import { HUB_RELAY_MUZZLE } from './earthBitePlantOrbital.js';

/** Wymiary promienia i pierścieni zamknięcia (R Ziemi; h — wysokość nad dnem gryzu). */
export const BEAM_DEFAULTS = Object.freeze({
  beamGain: 1.0,        // jasność (HDR)
  beamCore: 0.0012,     // promień rozżarzonego rdzenia (≤ 1/3 otoczki — widoczna szerokość to cyjan otoczki)
  beamSheath: 0.0035,   // promień cyjanowej otoczki (włókna biegną w 0,68 tego promienia)
  beamGlow: 0.016,      // promień szerokiej poświaty (= osłona; zero na brzegu)
  beamMouthR: 0.03,     // rozbłysk wylotu: tarcza z falami od krawędzi gardzieli po wargę krateru (osłona nieco większa)
  beamImpactR: 0.0195,  // rozbłysk uderzenia: półkula pod czaszą odbiornika (≤ promień czaszy hubDishR)
  beamOrbR: 0.0042,     // kula ładowania magazynu (osłona) w sferze armilarnej nadajnika (cewki r 0,0039, gimbal 0,0049)
  beamOrbLift: 0,       // wysokość kuli ładowania nad środkiem odbiornika [R]
  // pierścienie zamknięcia: od wysokości From do To, promień wewnętrzny R0 (dół) → R1 (góra)
  beamRings: 7, beamRingFrom: 0.13, beamRingTo: 0.48, beamRingR0: 0.03, beamRingR1: 0.024,
  beamFieldH: 0.02,     // pół wysokości pola pierścienia (linie strumienia od otoczki do wargi pierścienia)
  relayScale: 0.65,     // przekaźnikowy cieńszy od głównego
  relayGain: 0.6        // i słabszy (hierarchia: główny > przekaźnik)
});

// ── Osłony promienia i rozbłysków ──────────────────────────────────────────────────────────────────────────────────

/** Stałe atrybuty materiału promienia na całej siatce (aBeamA, aBeamB, aBeamR, aBeamP — opis w earthBitePlantBeam.tsl.js). */
function tagBeam(g, A, B, R, P = [0, 1, 0, 0]) {
  const n = g.attributes.position.count;
  for (const [name, v] of [['aBeamA', A], ['aBeamB', B], ['aBeamR', R], ['aBeamP', P]]) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set(v, i * 4);
    g.setAttribute(name, new THREE.BufferAttribute(a, 4));
  }
  return g;
}

/**
 * Osłona odcinka osi y0 → y1 w ramie (walec z dnami; `ext` — wydłużenie na obu końcach, domyślnie promień osłony).
 * `kind` — rodzaj w aBeamA.w (promień albo pole pierścienia).
 */
function beamShell(y0, y1, R, matrix, fade, P, kind = BEAM_KIND.BEAM, ext = R[2], seg = 24) {
  const rp = R[2];
  const g = new THREE.CylinderGeometry(rp, rp, y1 - y0 + 2 * ext, seg, 1, false);
  g.translate(0, (y0 + y1) * 0.5, 0);
  g.applyMatrix4(matrix);
  const a = new THREE.Vector3(0, y0, 0).applyMatrix4(matrix);
  const b = new THREE.Vector3(0, y1, 0).applyMatrix4(matrix);
  return tagBeam(g, [a.x, a.y, a.z, kind], [b.x, b.y, b.z, 0], [R[0], R[1], rp, fade], P);
}

/**
 * Osłona rozbłysku: kula wokół środka y (rama), oś tarczy wzdłuż Y ramy. R: rdzeń, halo, osłona, tarcza. `capY` — osłona
 * tylko poniżej tej wysokości (czasza sferyczna otwarta ku górze: rozbłysk pod czaszą odbiornika nie rysuje się na jej
 * grzbiecie), `P` — aBeamP (x: promień startu fal tarczy).
 */
function flareShell(kind, y, R, matrix, relay = 0, { capY = null, P } = {}) {
  let g;
  if (capY !== null && capY - y < R[2] && capY - y > -R[2]) {
    // θ od +Y: y = r·cos θ; od płaszczyzny cięcia w dół do bieguna
    const th0 = Math.acos(Math.max(-1, Math.min(1, (capY - y) / R[2])));
    g = new THREE.SphereGeometry(R[2], 24, 10, 0, Math.PI * 2, th0, Math.PI - th0);
  } else {
    g = new THREE.SphereGeometry(R[2], 20, 12);
  }
  g.translate(0, y, 0);
  g.applyMatrix4(matrix);
  const c = new THREE.Vector3(0, y, 0).applyMatrix4(matrix);
  const up = new THREE.Vector3(0, y + 1, 0).applyMatrix4(matrix);
  return tagBeam(g, [c.x, c.y, c.z, kind], [up.x, up.y, up.z, relay], R, P);
}

/**
 * Wysokości końców głównego promienia (rama): z głębi szybu gardzieli (szyb korka sięga dna; patrząc w krater widać,
 * że promień wychodzi z głębi, a nie zaczyna się w powietrzu tuż pod wargą) → ognisko czaszy odbiornika.
 */
export function beamSpan(L, b) {
  return { y0: L.apertureH - 0.04, y1: hubHeight(L, b) - 0.01 };
}

/** Wysokość i promień wewnętrzny pierścienia zamknięcia i (rama). */
function ringAt(L, i, n) {
  const f = n > 1 ? i / (n - 1) : 0;
  return { h: L.beamRingFrom + (L.beamRingTo - L.beamRingFrom) * f, ri: L.beamRingR0 + (L.beamRingR1 - L.beamRingR0) * f };
}

// ── Pierścienie zamknięcia (sprzęt w ramie, materiał metalu) ──────────────────────────────────────────────────────

/**
 * Pierścień (albo łuk a0…a1) z profilu (r, y) obracanego wokół osi Y ramy: każdy odcinek profilu to osobny pas z płaską
 * normalną (ostre krawędzie). Profil CCW (r w prawo, y w górę) — normalna odcinka (dy, −dr) na zewnątrz bryły. uv: x —
 * azymut 0…1, y — droga po profilu. Łuk wypukłego profilu dostaje denka na końcach (`caps`).
 */
function latheBands(profile, seg, h, from = 0, to = profile.length, a0 = 0, a1 = Math.PI * 2, caps = false) {
  const pos = [], nor = [], uv = [], idx = [];
  const at = (V, a) => [V[0] * Math.cos(a), V[1] + h, -V[0] * Math.sin(a)];
  for (let k = from; k < to; k++) {
    const P = profile[k], Q = profile[(k + 1) % profile.length];
    let nr = Q[1] - P[1], ny = -(Q[0] - P[0]);
    const nl = Math.sqrt(nr * nr + ny * ny) || 1;
    nr /= nl; ny /= nl;
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg), ca = Math.cos(a), sa = Math.sin(a);
      for (const [j, V] of [[0, P], [1, Q]]) {
        pos.push(...at(V, a));
        nor.push(nr * ca, ny, -nr * sa);
        uv.push(i / seg, (k + j) / profile.length);
      }
    }
    for (let i = 0; i < seg; i++) {
      const p0 = base + i * 2, q0 = p0 + 1, p1 = p0 + 2, q1 = p0 + 3;
      idx.push(p0, p1, q0, q0, p1, q1);
    }
  }
  if (caps) {
    // denka: wachlarz wypukłego profilu, normalna wzdłuż stycznej łuku (początek — wstecz, koniec — naprzód)
    for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
      const tn = [-Math.sin(a) * sgn, 0, -Math.cos(a) * sgn];
      const base = pos.length / 3;
      for (const V of profile) { pos.push(...at(V, a)); nor.push(...tn); uv.push(0, 0); }
      for (let k = 1; k < profile.length - 1; k++) {
        const A = at(profile[0], a), B = at(profile[k], a), C = at(profile[k + 1], a);
        const cx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
        const cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        const cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (cx * tn[0] + cy * tn[1] + cz * tn[2] >= 0) idx.push(base, base + k, base + k + 1);
        else idx.push(base, base + k + 1, base + k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Prostopadłościan na pierścieniu: radialnie od r0 do r1, wysokość hy wokół y, szerokość w, w azymucie a (rama). */
function ringBox(r0, r1, y, hy, w, a) {
  const g = new THREE.BoxGeometry(r1 - r0, hy, w);
  g.translate((r0 + r1) * 0.5, y, 0);
  g.rotateY(a);
  return g;
}

/** Wypukły ośmiokąt (prostokąt r0…r1 × y0…y1 ze ściętymi rogami c), CCW. */
const octagon = (r0, r1, y0, y1, c) => [
  [r0 + c, y0], [r1 - c, y0], [r1, y0 + c], [r1, y1 - c], [r1 - c, y1], [r0 + c, y1], [r0, y1 - c], [r0, y0 + c]
];

/** Faza mignięcia światła pozycyjnego (aPart.y) tak, by pierścień i (od dołu) błyskał Δ s po pierścieniu i − 1. */
function chaseSeed(i, f, dt) {
  // materiał: błysk przy fract(t · f + ziarno · 7,7) = 0 → ziarno · 7,7 ≡ −i · Δ · f (mod 1)
  const ph = (((0.35 - i * dt * f) % 1) + 1) % 1;
  return ph / 7.7;
}

/**
 * Pierścień zamknięcia na wysokości h: korpus o przekroju „C” otwartym ku promieniowi, w kanale uzwojenie (COIL na
 * tylnej ścianie, słabszy na suficie i podłodze kanału — cyjanowa poświata pola od środka „C”; impuls z fazą rosnącą
 * z wysokością — fala biegnie w górę stosu) przedzielone przekładkami, wśród nich 6 jasnych STABILIZATORÓW (cewki
 * wysunięte ku promieniowi); na zewnątrz pancerz z 6 łuków (w szczelinach węzły), dwa płaskie skrzydła radiatorów,
 * listwa na wierzchu. Światła pozycyjne w STAŁYCH azymutach (nie z obrotem pierścienia): dwa białe od północy (ku
 * kamerze gry; ±42° od osi promienia na ekranie) błyskają po kolei od dołu stosu w górę — kierunek przepływu energii —
 * i czerwone od południa. Obrót korpusu każdego pierścienia z ziarna — stos nie jest identyczny.
 */
function confinementRing(metal, h, ri, i, n, rng) {
  const W = ri * 0.3;               // szerokość korpusu (radialnie)
  const T = 0.0038 - 0.0006 * (i / Math.max(1, n - 1));   // wysokość korpusu
  const ro = ri + W, ch = T * 0.18, tl = T * 0.28, dc = W * 0.45;
  const seed = (k) => ((i * 97 + k * 13) % 101) / 101;
  // przekrój CCW: spód, zewnątrz, wierzch, przednia warga górna, kanał (sufit, uzwojenie, podłoga), warga dolna
  const prof = [
    [ri + ch, -T / 2], [ro - ch, -T / 2], [ro, -T / 2 + ch], [ro, T / 2 - ch], [ro - ch, T / 2], [ri + ch, T / 2],
    [ri, T / 2 - ch], [ri, T / 2 - tl], [ri + dc, T / 2 - tl], [ri + dc, -T / 2 + tl], [ri, -T / 2 + tl], [ri, -T / 2 + ch]
  ];
  const SEG = 72;   // 5° na odcinek — strzałka cięciwy ~0,5 px przy kadrze „pierscien-zamkniecia”
  const phase = n > 1 ? i / (n - 1) : 0;
  // korpus bez kanału (odcinki 7 → 10: sufit, tylna ściana, podłoga — cewka)
  metal.push(finalizePart(latheBands(prof, SEG, h, 0, 7), PART.HULL, seed(1)));
  metal.push(finalizePart(latheBands(prof, SEG, h, 10, 12), PART.HULL, seed(2)));
  metal.push(finalizePart(latheBands(prof, SEG, h, 8, 9), PART.COIL, seed(3), phase, 0.34));
  metal.push(finalizePart(mergeGeometries([latheBands(prof, SEG, h, 7, 8), latheBands(prof, SEG, h, 9, 10)]), PART.COIL, seed(10), phase, 0.14));
  // przekładki uzwojenia: od ściany kanału do wargi (rytm: kreskowany cyjanowy okrąg wokół promienia); co czwarta —
  // stabilizator: cewka wysunięta poza wargę ku promieniowi (z daleka 6 jasnych punktów na wewnętrznym obwodzie)
  const rot = rng() * Math.PI * 2;
  const sep = [], stab = [];
  const NS = 24;
  for (let k = 0; k < NS; k++) {
    const a = rot + (k / NS) * Math.PI * 2;
    if (k % 4 === 2) stab.push(ringBox(ri - 0.0007, ri + dc + 0.0002, h, T - 2 * tl + 0.0004, 0.0011, a));
    else sep.push(ringBox(ri + 0.0003, ri + dc + 0.0002, h, T - 2 * tl + 0.0002, 0.0007, a));
  }
  metal.push(finalizePart(mergeGeometries(sep), PART.STRUCT, seed(4)));
  metal.push(finalizePart(mergeGeometries(stab), PART.COIL, seed(11), phase, 0.9));
  // listwa na wierzchu (chłodna, pod progiem bloomu)
  const rs = ri + ch + (W - 2 * ch) * 0.3;
  const strip = [[rs, T / 2], [rs + 0.0007, T / 2], [rs + 0.0007, T / 2 + 0.00025], [rs, T / 2 + 0.00025]];
  metal.push(finalizePart(latheBands(strip, SEG, h, 1, 3), PART.STRIP, seed(5), 0.22, 1));
  // pancerz: 6 łuków wyższych od korpusu, w szczelinach węzły
  const NA = 6, step = (Math.PI * 2) / NA, span = step * 0.8;
  const armor = octagon(ro - 0.0003, ro + 0.0018, -T * 0.6, T * 0.6, 0.0005);
  // pas pola na czole pancerza: płytki kanał z uzwojeniem w połowie wysokości (z kadru gry, prawie z profilu, bliższa
  // połowa pierścienia świeci czołem, dalsza — kanałem „C” od strony promienia: cały pierścień to cyjanowa elipsa wokół
  // węzła promienia); wysoki na ~1 px przy średnim zoomie gry — cieńszy rwałby się w rastrze
  const bh = 0.00055;
  const band = [[ro + 0.0017, -bh], [ro + 0.00195, -bh], [ro + 0.00195, bh], [ro + 0.0017, bh]];
  const arcs = [], nodes = [], wings = [], bands = [];
  for (let k = 0; k < NA; k++) {
    const a = rot + k * step;
    arcs.push(latheBands(armor, 12, h, 0, armor.length, a - span / 2, a + span / 2, true));
    bands.push(latheBands(band, 12, h, 0, 3, a - span * 0.47, a + span * 0.47, true));
    const g = a + step / 2;
    const gw = (step - span) * ro * 0.62;
    nodes.push(ringBox(ro - 0.0002, ro + 0.0013, h, T * 0.78, gw, g));
  }
  // światła pozycyjne na cokołach (stałe azymuty: 90° — północ, ku kamerze gry): białe 90 ± 42° błyskają falą w górę
  // stosu (0,5 Hz, 0,12 s między pierścieniami), czerwone od południa (270°) wolno
  const yTop = h + T * 0.6;
  const marks = [];
  for (const [az, white] of [[90 + 42, 1], [90 - 42, 1], [270, 0]]) {
    const a = az * Math.PI / 180;
    // cokół wystaje przed pas pola (bez walki głębi z jego czołem)
    nodes.push(ringBox(ro - 0.0002, ro + 0.0023, h + T * 0.05, T * 1.3, 0.0014, a));
    // stałe znaczniki na czołach białych cokołów (między błyskami pozycja węzła dalej czytelna z kadru gry)
    if (white) marks.push(ringBox(ro + 0.0023, ro + 0.00255, h + T * 0.05, 0.0009, 0.001, a));
    const lamp = new THREE.SphereGeometry(0.0007, 8, 5);
    lamp.translate(ro + 0.0008, yTop + 0.0006, 0);
    lamp.rotateY(a);
    metal.push(white
      ? finalizePart(lamp, PART.BEACON, chaseSeed(i, 0.5, 0.12), 0.5, 1)
      : finalizePart(lamp, PART.BEACON, seed(8), 0.35, 0));
  }
  // dwa płaskie skrzydła radiatorów naprzeciw siebie (z góry — krótkie belki w poprzek okręgu)
  for (const s of [0, Math.PI]) {
    const a = rot + s + step * 0.25;
    wings.push(ringBox(ro + 0.0016, ro + 0.0068, h, 0.00035, 0.0046 * (ro / 0.04), a));
    wings.push(ringBox(ro + 0.0016, ro + 0.0027, h, T * 0.5, 0.0014, a));
  }
  metal.push(finalizePart(mergeGeometries(marks), PART.STRIP, seed(12), 0.45, 1));
  metal.push(finalizePart(mergeGeometries(arcs), PART.HULL, seed(6)));
  metal.push(finalizePart(mergeGeometries(bands), PART.COIL, seed(13), phase, 0.32));
  metal.push(finalizePart(mergeGeometries(nodes), PART.STRUCT, seed(7)));
  metal.push(finalizePart(mergeGeometries(wings), PART.STRUCT, seed(9)));
}

/**
 * Sprzęt promienia w ramie elektrowni: pierścienie zamknięcia unoszące się wokół promienia (z góry — koncentryczne
 * okręgi wokół jego punktu, promienie maleją z wysokością). { metal, flow } — jak komponenty brył.
 */
export function buildBeamHardware(L) {
  const metal = [];
  const R = plantRng(0x5b3a7);
  const rng = () => R.next();
  const n = Math.max(0, Math.round(L.beamRings));
  for (let i = 0; i < n; i++) {
    const { h, ri } = ringAt(L, i, n);
    confinementRing(metal, h, ri, i, n, rng);
  }
  return { metal, flow: [] };
}

// ── Siatki promienia ─────────────────────────────────────────────────────────────────────────────────────────────

const _rd = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _ry = new THREE.Vector3(0, 1, 0);

export class PlantBeam {
  /** @param {object} uniforms wspólne uniformy elektrowni (EarthBitePlant.uniforms) */
  constructor(uniforms) {
    this.uniforms = uniforms;
    const layer = (k) => createPlantBeamMaterial({ ...uniforms, uPlantLayer: { value: k } });
    this.coreMaterial = layer(BEAM_LAYER.INNER);
    this.glowMaterial = layer(BEAM_LAYER.GLOW);
    this.flareMaterial = layer(BEAM_LAYER.FLARE);
    const mesh = (name, mat) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.name = name;
      // promień po chmurach i poświacie limbu (przezroczyste tej samej kuli)
      m.renderOrder = 9;
      return m;
    };
    this.core = mesh('EarthBitePlantBeam', this.coreMaterial);
    this.glow = mesh('EarthBitePlantBeamGlow', this.glowMaterial);
    this.flares = mesh('EarthBitePlantBeamFlares', this.flareMaterial);
    /** Siatki w układzie obiektu kuli (orkiestrator dokłada je do grupy elektrowni). */
    this.frameMeshes = [this.core, this.glow, this.flares];
    this.relay = null;
    this.look = null;
    this._relayH = new THREE.Vector3();
    this._relayT = new THREE.Vector3(0, 1, 0);
  }

  /** Przebudowa osłon (rama elektrowni; `matrix` — rama → obiekt kuli). */
  applyLook(L, b, matrix) {
    this.look = L;
    const u = this.uniforms;
    const { y0, y1 } = beamSpan(L, b);
    const hHub = hubHeight(L, b);
    u.uPlantBeam.value.set(L.beamGain, L.apertureH - 0.012, hHub, L.beamCore);
    u.uPlantBeamLen.value = y1 - y0;
    const set = (mesh, geo) => { mesh.geometry.dispose(); geo.computeBoundingSphere(); mesh.geometry = geo; };
    const rIn = Math.max(L.beamSheath * 1.7, 0.005);
    // przewężenia otoczki przy pierścieniach zamknięcia: droga pierwszego od początku odcinka, krok, liczba
    const nR = Math.max(0, Math.round(L.beamRings));
    const ringStep = nR > 1 ? (L.beamRingTo - L.beamRingFrom) / (nR - 1) : 1;
    const pinch = (ys) => [L.beamRingFrom - ys, ringStep, nR, nR > 0 ? 1 : 0];
    set(this.core, beamShell(y0, y1, [L.beamCore, L.beamSheath, rIn], matrix, 0.012, pinch(y0)));
    // poświata od gardzieli (ściany krateru chowają ją z boku; z góry, w głąb krateru, halo trwa aż do gardzieli —
    // początek nad wargą dawał z wnętrza krateru „klocek” światła)
    const yg = y0 + 0.003;
    set(this.glow, beamShell(yg, y1, [L.beamCore, L.beamSheath, L.beamGlow], matrix, 0.012, pinch(yg)));
    const K = BEAM_KIND;
    // wylot: tarcza fal na wardze krateru (od krawędzi gardzieli po wargę i pierwszy stopień), nie na dnie gardzieli
    const lipR = L.corkCraterR ?? 0.024;
    const rdM = Math.max(L.beamMouthR, lipR * 1.1);
    // uderzenie: środek w ognisku (koniec promienia), osłona tylko pod płaszczyzną obrzeża czaszy (odbiornik: wierzchołek
    // czaszy 0,008 pod środkiem, obrzeże głębiej o hubDishDepth, pod nim dzwon fartucha) — rozbłysk nie wychodzi na
    // grzbiet czaszy ani na środek odbiornika z profilu; widać go od spodu, przez wylot dzwonu
    const rimY = hHub - 0.008 - (L.hubDishDepth ?? 0.005);
    const rI = Math.min(L.beamImpactR, (L.hubDishR ?? 0.0205) - 0.0008);
    const yI = Math.min(y1, rimY + 0.0015);
    const flares = [
      flareShell(K.MOUTH, L.apertureH + 0.0006, [0.003, rdM * 0.62, rdM * 1.04, rdM], matrix, 0, { P: [L.apertureR, 0, 0, 0] }),
      flareShell(K.IMPACT, yI, [0.0032, rI * 0.72, rI, rI * 0.95], matrix, 0, { capY: rimY - 0.0003 }),
      // kula ładowania w sferze armilarnej nadajnika (osłona nie wychodzi za cewki i gimbal)
      flareShell(K.ORB, hHub + L.beamOrbLift, [L.beamOrbR * 0.66, L.beamOrbR * 0.9, L.beamOrbR, L.beamOrbR * 0.5], matrix)
    ];
    // pole pierścieni: walec w otworze każdego pierścienia (osłona wewnątrz wargi), linie od otoczki do wargi
    const wF = L.beamFieldH;
    if (wF > 0) {
      for (let i = 0; i < nR; i++) {
        const { h, ri } = ringAt(L, i, nR);
        flares.push(beamShell(h - wF, h + wF, [ri * 0.95, L.beamSheath, ri * 0.97], matrix, wF, undefined, K.FIELD, 0, 32));
      }
    }
    set(this.flares, mergeGeometries(flares));
    if (this.relay) this._buildRelay();
  }

  _buildRelay() {
    const L = this.look;
    const r = this.relay;
    const k = L.relayScale;
    const rp = L.beamGlow * k;
    // walec o długości 1 wzdłuż lokalnego Y (0 — odbiornik, 1 — ring); skala siatki (j, długość, j). Rdzeń cieńszy
    // względem otoczki niż w głównym (przewaga cyjanu), jasność × relayGain (B.w)
    const g = new THREE.CylinderGeometry(rp, rp, 1, 24, 1, false);
    g.translate(0, 0.5, 0);
    r.beam.geometry.dispose();
    r.beam.geometry = tagBeam(g, [0, 0, 0, 0], [0, 1, 0, L.relayGain], [L.beamCore * k * 0.75, L.beamSheath * k, rp, 0.004]);
    const rh = L.beamImpactR * 0.6;
    const f = new THREE.SphereGeometry(rh, 20, 12);
    r.flare.geometry.dispose();
    r.flare.geometry = tagBeam(f, [0, 0, 0, BEAM_KIND.RELAY_HIT], [0, 1, 0, L.relayGain], [0.0018, rh * 0.7, rh, rh * 0.7]);
  }

  /**
   * Promień przekaźnikowy odbiornik → ring (promień i trafienie w ring): siatki w układzie gospodarza.
   */
  createRelay() {
    if (this.relay) return this.relay;
    const mat = createPlantBeamMaterial({ ...this.uniforms, uPlantLayer: { value: BEAM_LAYER.RELAY } });
    const beam = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    beam.name = 'EarthBitePlantRelay';
    const flare = new THREE.Mesh(new THREE.BufferGeometry(), this.flareMaterial);
    flare.name = 'EarthBitePlantRelayHit';
    beam.renderOrder = 9;
    flare.renderOrder = 9;
    const group = new THREE.Group();
    group.name = 'EarthBitePlantRelay';
    group.visible = false;
    group.add(beam, flare);
    this.relay = { group, beam, flare, material: mat };
    this._buildRelay();
    return this.relay;
  }

  /**
   * Ustawia promień przekaźnikowy od H do T (układ gospodarza; `unit` — jednostki gospodarza na R Ziemi). Bez widoczności
   * promień gaśnie płynnie (cofa się do odbiornika z `uPlantState.x`) i chowa się dopiero przy przekazie ≈ 0.
   */
  placeRelay(H, T, visible = true, unit = 1) {
    const r = this.relay;
    if (!r) return;
    if (H && T) { this._relayH.copy(H); this._relayT.copy(T); }
    const show = !!visible || this.uniforms.uPlantState.value.x > 0.004;
    r.group.visible = show;
    if (!show) return;
    const d = _rd.subVectors(this._relayT, this._relayH);
    const len = d.length();
    _rq.setFromUnitVectors(_ry, d.divideScalar(Math.max(len, 1e-9)));
    // widoczny promień od wylotu dyszy nadajnika (energia z kuli ładowania idzie lufą)
    const m0 = Math.min(HUB_RELAY_MUZZLE * unit, len * 0.5);
    r.beam.position.copy(this._relayH).addScaledVector(d, m0);
    r.beam.quaternion.copy(_rq);
    r.beam.scale.set(unit, Math.max(len - m0, 1e-6), unit);
    // trafienie tuż przed krawędzią ringu (połowa kuli nie chowa się w jego bryle)
    r.flare.position.copy(this._relayT).addScaledVector(d, -this.look.beamImpactR * 0.3 * unit);
    r.flare.quaternion.copy(_rq);
    r.flare.scale.setScalar(unit);
  }

  /** Siatki do rozgrzewki (rama i przekaźnik). */
  warmupMeshes() {
    const out = [...this.frameMeshes];
    if (this.relay) out.push(this.relay.beam, this.relay.flare);
    return out;
  }

  dispose() {
    for (const m of this.warmupMeshes()) m.geometry.dispose();
    for (const m of [this.coreMaterial, this.glowMaterial, this.flareMaterial, this.relay?.material]) m?.dispose();
    this.relay?.group.parent?.remove(this.relay.group);
  }
}
