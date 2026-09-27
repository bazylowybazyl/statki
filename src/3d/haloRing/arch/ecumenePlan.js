// ECUMENE (Mars) — plan ringu z dema dema/orbital_ring_demo.html, czysta
// matematyka (testy node). Ląd 1:1 z dema w skali ×3 (decyzja użytkownika
// 2026-09-27: „dokładnie jak w demach”): 12 dzielnic (id = indeks dzielnicy
// w demie), pola wody i typy dzielnic, wysokość terenu, kopuły, zabudowa,
// przemysł, lasy, parki, mosty, powłoka z żebrami, radiatory i tablice.
//
// Skala: długości dema × S (= 3); długość dzielnicy wzdłuż ringu = obwód/12
// (Mars: 18,4 tys. j. zamiast 3 × 4 241 — ×1,44), więc położenia liczone
// w demie jako ułamek LENGTH biorą ułamek dzielnicy, a rozmiary, siatka
// katastralna i częstotliwości szumu skalują się tylko o S — dłuższa dzielnica
// ma więcej kwartałów i drzew, nie większe.
//
// Współrzędne dzielnicy: s ∈ [0, LEN) od początku sektora (rośnie z θ),
// z w poprzek (−W/2 … W/2, płaszczyzna gry z = 0 na środku), h nad podłogą.
// Ring: habitat na zewnątrz — góra = od planety (archFrame.js).
//
// Port (miejsca haloPortSites): płyty doków i tranzytów płaskie i puste
// (typ 9), nad płytą w pasie kompleksu („osłona”, jak w Halo) tylko niska
// zabudowa — w kamerze gry to, co leży nad płaszczyzną, zasłaniałoby dok.
import { HALO_PORT, haloPortSites } from '../haloRingConfig.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ArchBatch, archBeamMatrix, archHex, archMatrix, archPoint, archRng, clamp, mix, modp, smooth } from './archFrame.js';

export const ECU_S = 3;
const S = ECU_S;
export const ECU_DEMO_LENGTH = 8100 * Math.PI / 6;   // dzielnica dema (R · 2π / 12)
export const ECU_DEMO_W = 2100;

// Dzielnice dema (id): nazwa w demie, podtytuł (tablice sektorów).
export const ECU_DISTRICTS = Object.freeze([
  ['HELIX', 'METROPOLITAN CORE'], ['VESPER', 'CENTRAL PARK'], ['SYLVA', 'BOREAL RESERVE'], ['MERIDIAN', 'RESIDENTIAL TERRACES'],
  ['EDEN', 'BIOSPHERE ARCADE'], ['DEMETER', 'AGRICULTURAL BELT'], ['HEPHAESTUS', 'HEAVY INDUSTRY'], ['KEPLER', 'ORBITAL FREEPORT'],
  ['AXIOM', 'TECHNOLOGY DISTRICT'], ['PELAGIC', 'INLAND SEA'], ['DAEDALUS', 'SHIPYARDS'], ['AURELIA', 'LANDSCAPE CITY']
]);

// Kopuły dema: s = dzielnica, u = ułamek długości, z, r, typ (0–5).
export const ECU_DOME_PLANS = Object.freeze([
  { s: 1, u: 0.19, z: 440, r: 170, type: 3 }, { s: 4, u: 0.16, z: -360, r: 240, type: 0 }, { s: 4, u: 0.39, z: 300, r: 360, type: 1 },
  { s: 4, u: 0.63, z: -360, r: 290, type: 2 }, { s: 4, u: 0.86, z: 300, r: 235, type: 4 }, { s: 4, u: 0.16, z: 450, r: 130, type: 3 },
  { s: 4, u: 0.63, z: 490, r: 135, type: 5 }, { s: 5, u: 0.70, z: -540, r: 185, type: 2 }, { s: 9, u: 0.16, z: 710, r: 170, type: 5 },
  { s: 11, u: 0.35, z: 340, r: 255, type: 0 }, { s: 11, u: 0.78, z: -470, r: 190, type: 4 }, { s: 8, u: 0.82, z: 490, r: 160, type: 2 }
]);

// Paleta typów terenu dema (sRGB 0–255): 0 miasto, 1 park, 2 las, 3 woda,
// 4 pola, 5 przemysł, 6 ulica, 7 pas techniczny/plac, 8 plaża; 9 płyta portu.
export const ECU_TYPE_PALETTE = Object.freeze([
  [76, 85, 87], [65, 84, 51], [42, 64, 43], [24, 62, 68], [90, 104, 56], [63, 70, 76], [35, 43, 47], [91, 97, 98], [166, 158, 117], [104, 110, 112]
]);

// ---- szum dema (wartościowy, hasz całkowity z ziarnem) --------------------
function makeNoise(seed) {
  const hash2 = (x, y) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    return mix(mix(hash2(ix, iy), hash2(ix + 1, iy), fx), mix(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy);
  };
  return { hash2, noise };
}

const ellipseField = (s, z, cx, cz, rx, rz) => (Math.hypot((s - cx) / rx, (z - cz) / rz) - 1) * Math.min(rx, rz);

// Plan ECUMENE dla układu ringu (layout: createHaloRingLayout z profilem Marsa).
export function createEcumenePlan(layout, seed = layout.seed) {
  const R = layout.radii.floorMid;
  const W = layout.floor.spanZ;              // 6 300 = 3 × 2 100
  const HW = W * 0.5;
  const sectors = layout.sectors;
  const N = sectors.length;
  const span = layout.sectorSpan;
  const LEN = span * R;
  const stretch = LEN / (S * ECU_DEMO_LENGTH);
  const { hash2, noise } = makeNoise(seed | 0);

  // ---- port: płyty i osłona (kąt środka, pół-rozpiętość łuku, zakres z) ----
  const sites = haloPortSites(R).map((st) => ({ ...st, halfS: st.halfS }));
  // kąt sektora p → [θ0, θ0 + span); s = (θ − θ0) · R
  const theta0 = (p) => sectors[p].startAngle;
  const wrapD = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  // Klasa portu w punkcie: 2 = płyta (pusto, płasko), 1 = osłona nad płytą
  // (niska zabudowa), 0 = zwykła dzielnica. margin — zapas [j.].
  function portClass(theta, z, margin = 0) {
    let cls = 0;
    for (let i = 0; i < sites.length; i++) {
      const st = sites[i];
      const ds = Math.abs(wrapD(theta - st.theta)) * R;
      if (ds > st.halfS + 900 + margin) continue;
      if (ds < st.halfS + margin && z > st.zMin - 150 - margin && z < st.zMax + 250 + margin) return 2;
      if (ds < st.halfS + 600 + margin && z >= st.zMax + 250) cls = 1;
    }
    return cls;
  }

  // ---- pola dema (skalowane) ------------------------------------------------
  function waterField(s, z, k) {
    let d = 1e5;
    if (k === 1) d = ellipseField(s, z, LEN * 0.54, 30 * S, 720 * S, 265 * S) + Math.sin(s * 0.007 / S) * 12 * S;
    if (k === 2) {
      d = ellipseField(s, z, LEN * 0.52, -30 * S, 1570 * S, 655 * S) + Math.sin(s * 0.009 / S + z * 0.007 / S) * 23 * S;
      d = Math.max(d, -ellipseField(s, z, LEN * 0.58, 100 * S, 230 * S, 155 * S));
    }
    if (k === 3) d = Math.abs(z - 130 * S * Math.sin(s * 0.0028 / S)) - 32 * S;
    if (k === 5) d = Math.abs(z - 130 * S * Math.sin(s * 0.0021 / S)) - 68 * S;
    if (k === 6) d = Math.abs(z + 490 * S) - 46 * S;
    if (k === 8) d = Math.abs(z - 200 * S * Math.sin(s * 0.0009 / S)) - 45 * S;
    if (k === 9) {
      d = ellipseField(s, z, LEN * 0.51, 0, LEN * 0.47, 745 * S) + Math.sin(s * 0.006 / S + z * 0.009 / S) * 17 * S;
      d = Math.max(d, -ellipseField(s, z, LEN * 0.57, 10 * S, 340 * S, 210 * S), -ellipseField(s, z, LEN * 0.31, -220 * S, 150 * S, 95 * S));
    }
    if (k === 11) d = Math.min(ellipseField(s, z, LEN * 0.59, 0, 620 * S, 250 * S), Math.abs(z - 210 * S * Math.sin(s * 0.0018 / S)) - 40 * S);
    return d;
  }
  // Kopuły dema: miejsce z planu, a gdy wpada na port (płyty zatok, tranzyt —
  // w demie port był jeden, tu 4 kompleksy i 4 tranzyty) — najbliższe wolne
  // wzdłuż tej samej dzielnicy, a gdy port kryje całą dzielnicę — za płytami
  // (z poniżej pasa płyt; nad nimi jest osłona z niską zabudową).
  const domeSpots = [];
  const padLo = Math.min(...sites.map((st) => st.zMin)) - 150;
  for (let index = 0; index < ECU_DOME_PLANS.length; index++) {
    const d = ECU_DOME_PLANS[index];
    const p = sectors.findIndex((sec) => sec.district === d.s);
    if (p < 0) continue;
    const r = d.r * S;
    const lo = (r + 90 * S) / LEN;
    const free = (u, z) => u >= lo && u <= 1 - lo && portClass(theta0(p) + u * LEN / R, z, r) === 0 &&
      domeSpots.every((o) => o.s !== d.s || Math.hypot((u - o.u) * LEN, z - o.z * S) > r + o.r * S + 60 * S);
    const zBehind = padLo - r - 30 * S;
    const zs = zBehind - r > -HW + 60 * S ? [d.z * S, zBehind] : [d.z * S];
    let spot = null;
    for (const z of zs) {
      for (let step = 0; step <= 45 && !spot; step++) {
        for (const sign of step ? [1, -1] : [1]) {
          const u = d.u + sign * step * 0.02;
          if (free(u, z)) { spot = { u, z }; break; }
        }
      }
      if (spot) break;
    }
    if (spot) domeSpots.push({ ...d, u: spot.u, z: spot.z / S, index, moved: spot.u !== d.u || spot.z !== d.z * S });
  }
  const domesOf = (k) => domeSpots.filter((d) => d.s === k);
  function reserved(s, z, k, margin = 12 * S) {
    for (const d of domeSpots) if (d.s === k && Math.hypot(s - d.u * LEN, z - d.z * S) < d.r * S + margin) return true;
    return false;
  }
  function districtType(s, z, k) {
    const water = waterField(s, z, k);
    if (water < 0) return 3;
    if (Math.abs(z) > HW - 38 * S) return 7;
    if (Math.abs(Math.abs(z) - 850 * S) < 19 * S) return 6;
    if (water < 28 * S && (k === 1 || k === 2 || k === 9 || k === 11)) return 8;
    let t = 0;
    if (k === 1) t = ellipseField(s, z, LEN * 0.51, 0, 1600 * S, 670 * S) < 0 ? 1 : 0;
    if (k === 2) t = ellipseField(s, z, LEN * 0.1, 610 * S, 400 * S, 140 * S) < 0 || ellipseField(s, z, LEN * 0.9, -610 * S, 340 * S, 160 * S) < 0 ? 0 : 2;
    if (k === 3) t = Math.abs(z - 130 * S * Math.sin(s * 0.0028 / S)) < 115 * S ? 1 : 0;
    if (k === 4) t = 1;
    if (k === 5) t = 4;
    if (k === 6 || k === 7 || k === 10) t = 5;
    if (k === 8) t = Math.abs(z - 200 * S * Math.sin(s * 0.0009 / S)) < 110 * S ? 1 : 0;
    if (k === 9) t = 2;
    if (k === 11) t = Math.sin(s * 0.0028 / S) + Math.cos(z * 0.009 / S) > 0.65 ? 0 : 2;
    if (k === 0 && ellipseField(s, z, LEN * 0.48, -30 * S, 330 * S, 230 * S) < 0) t = 7;
    if (t === 0 || t === 5) {
      if (modp(s, 76 * S) < 12 * S || modp(z + 850 * S, 88 * S) < 12 * S) t = 6;
    }
    return t;
  }
  function terrainHeight(s, z, k) {
    const d = waterField(s, z, k);
    const t = districtType(s, z, k);
    let height;
    if (d < 0) height = 3 * S + Math.max(-120 * S, d) * 0.22;
    else if (t === 0 || t === 5 || t === 6 || t === 7 || t === 4) height = 0.5 * S;
    else {
      const shore = smooth(clamp(d / (110 * S), 0, 1));
      const hill = (noise((s / S + k * ECU_DEMO_LENGTH) / 270, z / S / 250) * 0.65 + noise(s / S / 90, z / S / 115) * 0.35) * (t === 2 ? 65 : 16) * S;
      height = 3 * S + shore * (4 * S + hill);
    }
    const shoulder = 1 - smooth(clamp((Math.abs(Math.abs(z) - 850 * S) - 15 * S) / (60 * S), 0, 1));
    height = mix(height, 0.5 * S, shoulder);
    for (const dome of domesOf(k)) {
      const dist = Math.hypot(s - dome.u * LEN, z - dome.z * S);
      const weight = 1 - smooth(clamp((dist - dome.r * S) / (50 * S), 0, 1));
      height = mix(height, 4 * S, weight);
    }
    return mix(0.5 * S, height, smooth(clamp(Math.min(s, LEN - s) / (90 * S), 0, 1)));
  }

  // Punkt ringu (θ, z) → dzielnica (pozycja, id, s lokalne).
  function locate(theta) {
    const rel = modp(theta - layout.sectorStart, Math.PI * 2);
    const p = Math.min(N - 1, Math.floor(rel / span));
    return { p, k: sectors[p].district, s: (rel - p * span) * R };
  }
  // Wysokość terenu (kolizje, rozstawianie): woda = lustro wody (3,6 S), płyty
  // portu płaskie (PORT_PAD_H), osłona nad płytą niska.
  function heightAt(theta, z) {
    const L = locate(theta);
    const pc = portClass(theta, z);
    if (pc === 2) return PORT_PAD_H;
    let h = terrainHeight(L.s, z, L.k);
    if (waterField(L.s, z, L.k) < 0) h = 3.6 * S;
    if (pc === 1) h = Math.min(h, 20 * S);
    return h;
  }

  return {
    layout, R, W, HW, N, span, LEN, stretch, seed,
    sectors, sites, hash2, noise,
    waterField, districtType, terrainHeight, reserved, portClass, locate, heightAt, theta0,
    domesOf, domeSpots
  };
}

// ---- rozstawienie brył (instancje) ------------------------------------------
// Batche na dzielnicę: budynki (skrzynki), walce (rury, kominy), korony
// i pnie drzew; konstrukcja wspólna dla ringu. Barwy dema (sRGB → liniowe).
const PAL_CITY = [0x68757c, 0x8a9496, 0xa5a9a1, 0x526771, 0x787e7b, 0x526069, 0x978c79].map(archHex);
const PAL_TREES = [0x29442f, 0x39513a, 0x455b36, 0x576442, 0x354c42, 0x667044].map(archHex);
const C = (hex) => archHex(hex);
const COOL = [0.38 * 0.55, 1.6 * 0.55, 2.3 * 0.55];      // assets.cool w paśmie HDR (≈ 1,27)
const WARM = [2.6 * 0.5, 1.65 * 0.5, 0.65 * 0.5];        // assets.glow
const RED = [3.8 * 0.36, 0.12 * 0.36, 0.035 * 0.36];     // assets.red

export function buildEcumeneInstances(plan) {
  const { layout, R, LEN, HW, sectors, stretch } = plan;
  const m = new Array(16);
  // drzewo = jedna bryła (korona + pień, archTreeGeometry): skala x/z = 2 ×
  // promień korony dema, y = wysokość drzewa
  const per = sectors.map(() => ({
    box: new ArchBatch('EcuCity'),
    cyl: new ArchBatch('EcuPipes'),
    tree: new ArchBatch('EcuTrees')
  }));
  const stats = { buildings: 0, trees: 0 };
  const angleOf = (p, s) => plan.theta0(p) + s / R;
  // skrzynka dema: Batch.add(a, z, h, sx, sy, sz, color, yaw) — podstawa na h
  const add = (batch, a, z, h, sx, sy, sz, color, kind = 0, p1 = 0.2, yaw = 0, seed = -1) => {
    archMatrix(R, a, z, h, sx, sy, sz, yaw, m);
    const sd = seed >= 0 ? seed : Math.abs(Math.sin(a * 7919.3 + z * 0.0131 + h * 0.07)) % 1;
    batch.push16(m, color, kind, sd, p1, 0);
  };

  for (let p = 0; p < sectors.length; p++) {
    const k = sectors[p].district;
    const B = per[p];
    // ---- miasto (createCityDistricts) ----
    const r = archRng((plan.seed ^ Math.imul(k + 1, 8837)) >>> 0);
    for (let s = 38 * S; s < LEN; s += 76 * S) {
      for (let z = -806 * S; z < 820 * S; z += 88 * S) {
        const type = plan.districtType(s, z, k);
        if (type !== 0 || plan.reserved(s, z, k, 30 * S) || r() < 0.08) continue;
        if ((k === 0 || k === 8) && Math.hypot(s - LEN * (k === 0 ? 0.31 : 0.39), z - (k === 0 ? 330 : -410) * S) < 118 * S) continue;
        const a = angleOf(p, s);
        const pc = plan.portClass(a, z, 60);
        const h0 = plan.terrainHeight(s, z, k);
        const w = (24 + r() * 26) * S;
        const d = (25 + r() * 32) * S;
        let h = (12 + Math.pow(r(), 1.5) * 100) * S;
        if (k === 0 || k === 8) {
          const cluster = Math.pow(0.5 + 0.5 * Math.sin(s * 0.0026 / S + z * 0.004 / S), 2);
          h = (22 + r() * 100 + Math.pow(r(), 1.4) * cluster * 380) * S;
        }
        if (k === 3) h = (14 + r() * 64) * S;
        if (k === 11) h = (10 + r() * 25) * S;
        const color = PAL_CITY[(r() * PAL_CITY.length) | 0];
        const sd = r();
        if (pc === 2 || (pc === 1 && h > 40 * S)) continue;
        add(B.box, a, z, h0, w, h, d, color, 1, 0, 0, sd);
        stats.buildings++;
        if (h > 145 * S) {
          add(B.box, a, z, h0 + h, w * 0.69, h * 0.21, d * 0.68, color, 1, 0, 0, sd);
          add(B.box, a, z, h0 + h * 1.21, w * 0.44, h * 0.12, d * 0.42, color, 1, 0, 0, sd);
          add(B.box, a, z, h0 + h * 1.33, w * 0.47, 1.1 * S, d * 0.46, WARM, 2, 1, 0);
          if (r() > 0.5) add(B.box, a, z, h0 + h * 1.33, 2.4 * S, (16 + r() * 22) * S, 2.4 * S, C(0xb9c6c6), 4);
        } else if (r() > 0.33) {
          add(B.box, a, z, h0 + h, w * 0.36, (3 + r() * 7) * S, d * 0.4, C(0x74868b), 4);
        }
        if (k === 3 && r() > 0.35) {
          add(B.box, a + 29 * S / R, z + 18 * S, h0, 16 * S, (12 + r() * 22) * S, 22 * S, C(0xa4a08e), 1, 0, 0, r());
          stats.buildings++;
        }
      }
    }
    // supertall (dzielnice 0 i 8)
    if (k === 0 || k === 8) {
      const s = LEN * (k === 0 ? 0.31 : 0.39);
      const a = angleOf(p, s);
      const z = (k === 0 ? 330 : -410) * S;
      if (plan.portClass(a, z, 300) === 0) {
        for (let i = 0; i < 6; i++) {
          const width = (120 - i * 13) * S;
          add(B.box, a, z, i * 105 * S, width, 110 * S, width * 0.73, C(0x779098), 1, 0, 0, 0.3 + i * 0.07);
          add(B.box, a, z + width * 0.37, i * 105 * S, 6 * S, 110 * S, 5 * S, C(0xbab093), 0, 0.6);
        }
        add(B.box, a, z, 630 * S, 8 * S, 115 * S, 8 * S, C(0xc3c9c3), 0, 0.5);
        add(B.box, a, z, 740 * S, 6 * S, 12 * S, 6 * S, COOL, 2, 1.2);
      }
    }
    // ---- przemysł (createIndustrialDistricts) ----
    if (k === 5 || k === 6 || k === 7 || k === 10) {
      const ri = archRng((plan.seed + k * 5743) >>> 0);
      for (let s = 115 * S; s < LEN - 100 * S; s += 170 * S) {
        for (let z = -710 * S; z < 800 * S; z += 185 * S) {
          if (plan.waterField(s, z, k) < 80 * S || plan.reserved(s, z, k, 35 * S)) continue;
          const a = angleOf(p, s);
          // zapas: szklarnie i hale mają do ~180 j. od środka + pasy na nich
          const pc = plan.portClass(a, z, 260);
          if (pc === 2) continue;
          if (k === 5) {
            if (Math.abs(z) < 300 * S) continue;
            add(B.box, a, z, 0.5 * S, 118 * S, 14 * S, 86 * S, C(0x92a99a), 4);
            for (let j = 0; j < 6; j++) add(B.box, a + (j - 2.5) * 17 * S / R, z, 14.5 * S, 10 * S, 4 * S, 80 * S, C(0x829da0), 0, 0.5);
          } else {
            const h = (15 + ri() * 45) * S;
            if (pc === 1 && h > 30 * S) continue;
            add(B.box, a, z, 0.5 * S, (92 + ri() * 25) * S, h, (110 + ri() * 22) * S, ri() > 0.5 ? C(0x859095) : C(0x9b9180), 4);
            for (let j = 0; j < 3; j++) add(B.box, a + (j - 1) * 26 * S / R, z, h + 1 * S, 15 * S, 5 * S, 80 * S, C(0x3c4c54), 4);
            if (ri() > 0.45) {
              add(B.cyl, a + 55 * S / R, z + 45 * S, 1 * S, 18 * S, (35 + ri() * 50) * S, 18 * S, C(0xb0b7b2), 0, 0.3);
              add(B.cyl, a + 55 * S / R, z - 15 * S, 1 * S, 18 * S, (35 + ri() * 50) * S, 18 * S, C(0x8b9999), 0, 0.3);
            }
            if (k === 6 && ri() > 0.62 && pc === 0) {
              add(B.cyl, a - 43 * S / R, z, 1 * S, 6 * S, (125 + ri() * 70) * S, 6 * S, C(0x9c9d94), 0, 0.3);
              add(B.box, a - 43 * S / R, z, 130 * S, 7 * S, 4 * S, 7 * S, COOL, 2, 1.1);
            }
            if (k === 7 || k === 10) {
              for (let n = 0; n < 6; n++) {
                const row = n % 3;
                const col = (n / 3) | 0;
                add(B.box, a + (row - 1) * 24 * S / R, z + col * 28 * S - 25 * S, h + 2 * S, 17 * S, (10 + 10 * (n % 2)) * S, 24 * S,
                  [C(0x687e85), C(0x997652), C(0x82918c)][n % 3], 0, 0.2);
              }
            }
          }
          stats.buildings++;
        }
      }
    }
    // ---- lasy (createForests): gęstość dema na j.², dłuższa dzielnica = więcej ----
    {
      const rf = archRng((plan.seed ^ Math.imul(k + 7, 17239)) >>> 0);
      const samples = Math.round(11000 * stretch);
      for (let i = 0; i < samples; i++) {
        const s = rf() * LEN;
        const z = (rf() - 0.5) * (plan.W - 160 * S);
        const type = plan.districtType(s, z, k);
        const acceptance = type === 2 ? 0.94 : type === 1 ? 0.47 : type === 0 ? 0.015 : type === 4 ? 0.017 : 0;
        if (rf() > acceptance || plan.reserved(s, z, k, 15 * S)) continue;
        const a = angleOf(p, s);
        if (plan.portClass(a, z, 20) === 2) continue;
        const base = plan.terrainHeight(s, z, k);
        const height = (13 + rf() * 28) * S;
        const width = ((type === 2 ? 10 : 5) + rf() * (type === 2 ? 10 : 7)) * S;
        const col = PAL_TREES[(rf() * PAL_TREES.length) | 0];
        const depth = width * (0.75 + rf() * 0.45);
        add(B.tree, a, z, base, width * 2, height, depth * 2, col, 0, 0.05, rf() * Math.PI * 2);
        rf(); rf();
        stats.trees++;
      }
    }
    // ---- parki i mosty (createParks) ----
    if (k === 1 || k === 2 || k === 4 || k === 9 || k === 11) {
      const rp = archRng((plan.seed + k * 5549) >>> 0);
      const tries = Math.round(45 * stretch);
      for (let i = 0; i < tries; i++) {
        const s = rp() * LEN;
        const z = (rp() - 0.5) * 1500 * S;
        const t = plan.districtType(s, z, k);
        if ((t !== 1 && t !== 2) || plan.reserved(s, z, k, 30 * S)) continue;
        const a = angleOf(p, s);
        if (plan.portClass(a, z, 60) === 2) continue;
        const h = plan.terrainHeight(s, z, k);
        add(B.box, a, z, h, 25 * S, 2 * S, 21 * S, C(0xb0a68c), 0);
        for (const dx of [-9, 9]) for (const dz of [-7, 7]) add(B.box, a + dx * S / R, z + dz * S, h, 1.1 * S, 12 * S, 1.1 * S, C(0xa6b5b0), 0, 0.3);
        add(B.box, a, z, h + 12 * S, 29 * S, 2 * S, 25 * S, C(0xbab5a3), 0);
      }
      if (k === 1 || k === 2 || k === 9 || k === 11) {
        const s = LEN * 0.49;
        const a = angleOf(p, s);
        for (let z = -690 * S; z < 690 * S; z += 70 * S) {
          if (plan.waterField(s, z, k) > 80 * S || plan.portClass(a, z, 40) === 2) continue;
          add(B.box, a, z, 34 * S, 32 * S, 5 * S, 73 * S, C(0xa9a590), 0);
          for (const dx of [-17, 17]) add(B.box, a + dx * S / R, z, 39 * S, 1.4 * S, 4 * S, 73 * S, C(0xc4c6b2), 0, 0.3);
          if (Math.abs(z) % (210 * S) < 75 * S) add(B.box, a, z, -15 * S, 9 * S, 49 * S, 9 * S, C(0x627879), 0);
        }
      }
    }
  }
  return { per, stats };
}

// Kopuły (createBiodomes): środek, promień, wysokość, typ + drzewa wnętrza
// (do batchy dzielnic), wejścia, lampki.
export function buildEcumeneDomes(plan, per, lights) {
  const { R, LEN } = plan;
  const m = new Array(16);
  const domes = [];
  for (const d of plan.domeSpots) {
    const index = d.index;
    const p = plan.sectors.findIndex((sec) => sec.district === d.s);
    const r = archRng((plan.seed + index * 8719) >>> 0);
    const s = d.u * LEN;
    const a = plan.theta0(p) + s / R;
    const z = d.z * S;
    const rr = d.r * S;
    const base = plan.terrainHeight(s, z, d.s) + 12 * S;
    const vertical = d.type === 5 ? 0.7 : d.type === 1 ? 1.08 : 0.89;
    const DOME_TYPES = ['FOREST', 'TROPICAL', 'BOTANICAL', 'RECREATION', 'WILDERNESS', 'AQUATIC'];
    domes.push({ index, district: d.s, sector: p, theta: a, z, sLocal: s, r: rr, base, vertical, type: d.type,
      // pola jak haloRingDomes (presety dema): s = łuk na floorMid, t = w poprzek
      // od dolnej ściany, wysokość podłogi i kopuły, nazwa
      s: a * R, t: z - plan.layout.z.botIn, floorH: base, h: rr * vertical,
      name: `${plan.sectors[p].name} / ${DOME_TYPES[d.type]}` });
    const B = per[p];
    // drzewa wnętrza (480 prób na kopułę)
    for (let i = 0; i < 480; i++) {
      const x = (r() - 0.5) * 1.8;
      const zz = (r() - 0.5) * 1.8;
      const dist = Math.hypot(x, zz);
      if (dist > 0.89 || Math.abs(dist - 0.545) < 0.034) continue;
      if (Math.hypot((x - 0.15) / (d.type === 5 ? 0.73 : 0.40), (zz + 0.08) / (d.type === 5 ? 0.60 : 0.32)) < 1) continue;
      const available = Math.sqrt(Math.max(0, 1 - dist * dist)) * rr * vertical;
      const height = Math.min(available * 0.63, (16 + r() * (d.type === 1 ? 66 : 38)) * S);
      const width = height * 0.23;
      const ang = a + x * rr / R;
      const hh = base + 1 * S - (x * rr) ** 2 / (2 * R);
      archMatrix(R, ang, z + zz * rr, hh, width * 2, height * 1.04, width * 2, r() * Math.PI * 2, m);
      B.tree.push16(m, [0x355b3b, 0x496641, 0x5a7140, 0x3b6750].map(archHex)[i % 4], 0, 0, 0.05, 0);
    }
    // wejścia i lampki obwodu
    archMatrix(R, a, z + rr * 1.02, base - 10 * S, 60 * S, 29 * S, 115 * S, 0, m);
    B.box.push16(m, archHex(0xb2bfb9), 4, 0.4, 0, 0);
    archMatrix(R, a, z - rr * 1.02, base - 10 * S, 44 * S, 22 * S, 94 * S, 0, m);
    B.box.push16(m, archHex(0xa6b5b0), 4, 0.6, 0, 0);
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const pt = archPoint(R, a + Math.cos(t) * rr * 0.96 / R, z + Math.sin(t) * rr * 0.96, base + 6 * S, {});
      lights.add(pt.x, pt.y, pt.z, COOL, 5 * S, 0.05);
    }
  }
  return domes;
}

// Konstrukcja (createRingStructure): żebra, belki, słupki ze złotymi
// głowicami, czerwone światła, stępka, radiatory. BG = do płaszczyzny gry
// i strona planety, FG = strona +z (nad statkami). Żebra pod podłogą omijają
// tranzyty i płyty portu na z ≈ 0.
export function buildEcumeneStructure(plan) {
  const { layout, R, W, HW } = plan;
  const m = new Array(16);
  const bg = new ArchBatch('EcuStructure');
  const fg = new ArchBatch('EcuStructureFG');
  const zTop = layout.z.topIn;
  const pick = (z) => (z > zTop - 1 ? fg : bg);
  const add = (a, z, h, sx, sy, sz, color, kind = 4, p1 = 0.3, yaw = 0) => {
    archMatrix(R, a, z, h, sx, sy, sz, yaw, m);
    pick(z).push16(m, color, kind, Math.abs(Math.sin(a * 977 + z)), p1, 0);
  };
  const beam = (a0, z0, h0, a1, z1, h1, w, color) => {
    const p0 = archPoint(R, a0, z0, h0, {});
    const p1 = archPoint(R, a1, z1, h1, {});
    archBeamMatrix(p0, p1, w, m);
    pick((z0 + z1) * 0.5).push16(m, color, 0, 0, 0.3, 0);
  };
  // liczba żeber: gęstość dema (384 na obwód 3 · 2π · 8 100), wielokrotność 12
  const N = Math.max(12, Math.round(384 * layout.circumference / (S * 2 * Math.PI * 8100) / 12) * 12);
  const dA = (Math.PI * 2) / N;
  const transitClear = (a) => plan.portClass(a, 0, 40) === 2;
  for (let i = 0; i < N; i++) {
    const a = plan.layout.sectorStart + i * dA;
    const major = i % 12 === 0;
    if (!transitClear(a)) add(a, 0, -535 * S, (major ? 58 : 17) * S, 48 * S, W + 120 * S, major ? C(0xb9c0bd) : C(0x677984));
    if (i % 32 === 0 && plan.portClass(a, 0, 400) === 0) add(a, 0, 0.4 * S, 16 * S, 7 * S, W, C(0x768991));
    for (const side of [-1, 1]) {
      add(a, side * 1100 * S, -450 * S, (major ? 52 : 18) * S, 505 * S, (major ? 80 : 34) * S, C(0x82949b));
      add(a, side * 1090 * S, -275 * S, 87 * S, 108 * S, 40 * S, C(0x516570));
      if (i % 3 === 0) {
        const next = a + 3 * dA;
        beam(a, side * 1168 * S, -420 * S, next, side * 1168 * S, -35 * S, 10 * S, C(0x83979e));
        beam(a, side * 1168 * S, -35 * S, next, side * 1168 * S, -420 * S, 10 * S, C(0x667c88));
      }
      if (i % 6 === 0) add(a, side * 1133 * S, 64 * S, 6 * S, 8 * S, 6 * S, RED, 2, 1);
      if (i % 4 === 0 && plan.portClass(a, side * 960 * S, 60) !== 2) {
        add(a, side * 960 * S, 0, 18 * S, 102 * S, 24 * S, C(0x819295));
        add(a, side * 960 * S, 99 * S, 35 * S, 5 * S, 25 * S, C(0xb2a27d), 0, 0.7);
      }
    }
    if (i % 4 === 0 && !transitClear(a)) {
      add(a, 0, -555 * S, 90 * S, 22 * S, 670 * S, C(0x647782));
      add(a, 350 * S, -577 * S, 48 * S, 25 * S, 215 * S, C(0x929d9c));
    }
  }
  // radiatory (createRadiators): 48 na obwód dema → ta sama gęstość
  const NR = Math.max(12, Math.round(48 * layout.circumference / (S * 2 * Math.PI * 8100)));
  for (let i = 0; i < NR; i++) {
    for (const side of [-1, 1]) {
      const a = plan.layout.sectorStart + (i + 0.3) / NR * Math.PI * 2;
      const z = side * 1550 * S;
      add(a, z, -580 * S, 210 * S, 12 * S, 770 * S, C(0x637488), 5, 0.12);
      for (let j = -4; j <= 4; j++) add(a + j * 24 * S / R, z, -567 * S, 2 * S, 3 * S, 766 * S, C(0x8897a2), 0, 0.3);
      add(a, z + side * 375 * S, -567 * S, 215 * S, 4 * S, 9 * S, C(0x999e93), 0, 0.3);
      beam(a, side * 1070 * S, -310 * S, a, side * 1710 * S, -580 * S, 15 * S, C(0x6c7e86));
    }
  }
  return { bg, fg, ribs: N, radiators: NR };
}

// Rury wzdłuż ringu (ringTube dema): promień (h), z, grubość, barwa, emisja.
export const ECU_TUBES = Object.freeze([
  { h: 106, z: 960, r: 9, color: 0x202b34 }, { h: 116, z: 960, r: 2.0, color: 0xb9c6c8 },
  { h: -115, z: 1160, r: 12, color: 0xb19a70 }, { h: -345, z: 1160, r: 10, color: 0x202b34 },
  { h: 58, z: 1066, r: 1.8, color: null }
]);

// Powłoka (createRingShell): profil (h, z) dema × S, od lewej krawędzi (−z)
// przez spód do prawej (+z). Dodany próg od podłogi do krawędzi (w demie
// szczelina 54 j. między brzegiem podłogi a krawędzią).
export const ECU_SHELL_PROFILE = Object.freeze([
  [0, -1050], [54, -1050], [-45, -1120], [-345, -1120], [-470, -970], [-490, 970], [-345, 1120], [-45, 1120], [54, 1050], [0, 1050]
]);
