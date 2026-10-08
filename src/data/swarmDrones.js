/**
 * DRONY PRZEŁADUNKOWE ROJU — klasy S / M / L / Capital (demo dema/roj-webgpu.html, opis
 * docs/webgpu/DEMO-ROJ.md). Czyste dane i geometria: bez three, bez DOM, bez stanu.
 *
 * Decyzje użytkownika:
 *   2026-10-05 — drony Z5 są „clumsy”, za duże i wyglądają jak drony z wirnikami (w kosmosie
 *     wirników nie ma). Nowy model: kadłub z silnikami jonowymi na rufie i blokami RCS (bez
 *     okrągłych gondoli w narożach), RAMIONA, które chwytają kontenery za narożniki.
 *   2026-10-06 — KONTENER JEDNEGO WYMIARU (standard 16 × 8 × 8 j., CARGO_CONTAINER z cargoBays.js),
 *     bez megakontenerów; kontenery leżą NA PŁASKO (dron niesie jedną warstwę, nic pod hakiem nie
 *     stoi piętrami): S chwyta 1, M 2, L 4, Capital 8. Większe drony mają ramiona WYSUWANE
 *     (teleskop), żeby Capital zabezpieczył 8 kontenerów naraz.
 *
 * CHWYT KLASY (pack) = nx × ny kontenerów standardowych w jednej warstwie, dłuższym bokiem wzdłuż
 * drona: S 1 × 1 (16 × 8), M 1 × 2 (16 × 16,25 — burta w burtę), L 2 × 2 (32,25 × 16,25),
 * C 4 × 2 (64,75 × 16,25). Chwyty się zagnieżdżają (C = 2 L = 4 M = 8 S): dron mniejszej klasy
 * bierze część warstwy z kolumny większej (plac C obsłuży każda klasa), a kolumnę obsługuje każda
 * klasa, której chwyt dzieli jej obrys bez reszty (swarmPackTiles).
 *
 * RAMIONA: każdy kontener trzymany za dwa gniazda narożne na swojej ZEWNĘTRZNEJ dłuższej krawędzi
 * (w chwycie płaskim każdy kontener ma taką krawędź na burcie chwytu); na styku dwóch kontenerów —
 * jedno ramię z chwytakiem PODWÓJNYM (zamki w obu sąsiednich gniazdach, jak środkowe zamki spreadera
 * twin-lift). Na burtę nx + 1 ramion: S i M — 4, L — 6, Capital — 10.
 *
 * UKŁAD DRONA (lokalny): x = dziób, y = lewa burta, z w górę; początek = HAK = środek wierzchu
 * niesionej warstwy (podstawa kontenerów = hak − H). Kadłub wisi nad hakiem (spód w z = gap).
 * Barki stoją na wysięgnikach nad linią gniazd (|y| bark ≈ |y| gniazda), więc ramię pracuje w
 * pionowej płaszczyźnie wzdłuż burty — łokieć nie wystaje w bok poza obrys chwytu.
 *
 * RAMIĘ: bark S, ramię l1, łokieć, przedramię = TULEJA (sleeve) + dwa człony TELESKOPU (wysuw rośnie
 * z rozłożeniem e: smoothstep(extA, extB, e)), nadgarstek W, chwytak (szczęki w dół, długość
 * clawLen; podwójny — belka o rozstawie twin). Poza „chwyt” (e = 1): nadgarstek nad gniazdem, IK
 * dwóch odcinków (l1, l2Grip) w pionowej płaszczyźnie przez bark i cel, łokieć w górę; poza
 * „złożone” (e = 0): teleskop schowany, ramię uniesione, przedramię w dół. Pośrednie pozy — kąty
 * mieszane liniowo; lustro CPU shadera: swarmArmPose (kąty chwytu liczone RAZ — tablica klas GPU).
 */

import { CARGO_CONTAINER } from './cargoBays.js';

export const SWARM_CLASS_IDS = Object.freeze(['S', 'M', 'L', 'C']);
/** Najwięcej ramion w klasie (Capital: 5 na burtę). */
export const SWARM_MAX_ARMS = 10;
/** Najwięcej kontenerów w chwycie (Capital: 4 × 2). */
export const SWARM_MAX_PACK = 8;
/** Najwięcej silników głównych w klasie (Capital: 4). */
export const SWARM_MAX_ENGINES = 4;

/** Pół grubości ramienia z obudową (× grubość belki) — obrys ramienia w poprzek. */
export const SWARM_ARM_REACH = 0.6;
/** Szczęki chwytaka od osi słupka (× grubość belki) — obrys chwytaka w poprzek. */
export const SWARM_JAW_REACH = 0.71;

/** Gniazdo narożne kontenera standardowego: wcięcie od krótszego (a) i dłuższego (b) boku [j.]. */
export const SWARM_CASTING = Object.freeze({ a: 0.7, b: 0.6 });

/** Rozstaw kontenerów w warstwie (bok + szczelina) [j.] — siatka komórek kolumn i chwytów. */
export const SWARM_CELL_PITCH = Object.freeze({ a: CARGO_CONTAINER.L + CARGO_CONTAINER.gap, b: CARGO_CONTAINER.W + CARGO_CONTAINER.gap });

/** Chwyt (nx × ny kontenerów w warstwie) i parametry klas. Liczby lotu w j. świata i sekundach. */
const CLASS_DEFS = {
  S: {
    label: 'S', name: 'Drony S — 1 kontener',
    pack: { nx: 1, ny: 1 },
    body: { L: 9.4, W: 4.6, H: 2.4, gap: 1.6 },
    engines: 2, armBeam: 0.42, clawLen: 0.95, tele: false,
    flight: { vMax: 230, accel: 200, vVert: 80, accelVert: 150, yawRate: 2.4, yawAccel: 6.0 },
    priority: 1
  },
  M: {
    label: 'M', name: 'Drony M — 2 kontenery burta w burtę',
    pack: { nx: 1, ny: 2 },
    body: { L: 10.6, W: 6.4, H: 3.0, gap: 1.7 },
    engines: 2, armBeam: 0.5, clawLen: 1.05, tele: true,
    flight: { vMax: 200, accel: 150, vVert: 70, accelVert: 115, yawRate: 2.0, yawAccel: 4.5 },
    priority: 2
  },
  L: {
    label: 'L', name: 'Drony L — 4 kontenery (2 × 2)',
    pack: { nx: 2, ny: 2 },
    body: { L: 18.4, W: 9.0, H: 4.6, gap: 2.4 },
    engines: 2, armBeam: 0.85, clawLen: 1.7, tele: true,
    flight: { vMax: 165, accel: 95, vVert: 55, accelVert: 80, yawRate: 1.4, yawAccel: 2.5 },
    priority: 4
  },
  C: {
    label: 'Capital', name: 'Drony Capital — 8 kontenerów (4 × 2)',
    pack: { nx: 4, ny: 2 },
    body: { L: 35, W: 13, H: 8.0, gap: 3.6 },
    engines: 4, armBeam: 1.2, clawLen: 2.8, tele: true,
    flight: { vMax: 115, accel: 50, vVert: 38, accelVert: 45, yawRate: 0.8, yawAccel: 1.2 },
    priority: 9
  }
};

/** Niesiony ładunek spowalnia: prędkość × 0,85, przyspieszenie × 0,75. */
export const SWARM_LOADED_SPEED = 0.85;
export const SWARM_LOADED_ACCEL = 0.75;

/** Strojenie ramion: poza złożona, zapas długości w chwycie, wysięgnik barku, teleskop. */
export const SWARM_ARM_TUNE = Object.freeze({
  foldTheta1: 0.95,   // ramię uniesione [rad]
  foldFore: -1.45,    // przedramię w dół [rad]
  foldSide: 0,        // azymut złożenia: wzdłuż burty ku swojemu końcowi (nie na zewnątrz — pusty dron
                      // mieści się w obrysie swojej warstwy: sąsiednie szyby kolumn są 1 j. obok)
  slack: 1.12,        // l1 + l2 w chwycie = 1,12 × odległość bark → cel (łokieć zgięty, nie tyka)
  upper: 0.36,        // ramię l1 ramion teleskopowych: × najdłuższy zasięg klasy
  sleeve: 0.30,       // tuleja przedramienia ramion teleskopowych: × najdłuższy zasięg klasy
  extA: 0.35,         // wysuw teleskopu od rozłożenia e = extA …
  extB: 0.95,         // … do extB
  outrigger: 0.3      // wysięgnik barku poza burtę kadłuba: najwyżej × szerokość kadłuba
});

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Wymiary chwytu nx × ny (jedna warstwa kontenerów standardowych) [j.]. */
export function swarmPackSize(nx, ny, out = {}) {
  const C = CARGO_CONTAINER;
  out.nx = nx; out.ny = ny;
  out.L = nx * C.L + (nx - 1) * C.gap;
  out.W = ny * C.W + (ny - 1) * C.gap;
  out.H = C.H;
  out.count = nx * ny;
  return out;
}

/**
 * Środek kontenera k chwytu (px = k mod nx, py = ⌊k / nx⌋) względem haka w układzie drona [j.] —
 * lustro shadera (kIntegrate / RELEASE w swarmSim.js). Komórka kolumny: ten sam wzór z (cnx, cny).
 */
export function swarmPackSlotOffset(nx, ny, k, out = {}) {
  const px = k % nx;
  const py = Math.floor(k / nx);
  out.a = (px - (nx - 1) / 2) * SWARM_CELL_PITCH.a;
  out.b = (py - (ny - 1) / 2) * SWARM_CELL_PITCH.b;
  return out;
}

/**
 * Ramiona klasy (lewa burta, potem prawa; na burcie od rufy): bark na wysięgniku nad linią gniazd,
 * cel = nadgarstek nad gniazdem (narożnik) albo nad stykiem dwóch kontenerów (chwytak podwójny).
 * Długości: ramiona teleskopowe — l1 i tuleja klasy, wysuw do l2Grip; krótkie — l1 + l2 = slack × r.
 */
function armRigFor(def, pack) {
  const A = SWARM_ARM_TUNE;
  const C = CARGO_CONTAINER;
  const CA = SWARM_CASTING;
  const b = def.body;
  const nx = def.pack.nx;
  const halfL = pack.L / 2;
  const yEdge = pack.W / 2 - CA.b;
  const wz = def.clawLen + 0.15;
  const sz = b.gap + 0.45 * b.H;
  // Bark nad linią gniazd, ale razem z grubością ramienia w obrysie warstwy (pusty dron w szybie
  // kolumny obok pracującego — szczelina 1 j.); wysięgnik najwyżej outrigger × szerokość kadłuba.
  const sy = Math.max(0.5 * b.W, Math.min(yEdge, pack.W / 2 - SWARM_ARM_REACH * def.armBeam, 0.5 * b.W + A.outrigger * b.W));
  const n = nx + 1;
  // Cele na burcie (od rufy): narożnik, styki, narożnik.
  const gx = [];
  for (let k = 0; k <= nx; k++) gx.push(k === 0 ? -(halfL - CA.a) : k === nx ? halfL - CA.a : (k - nx / 2) * SWARM_CELL_PITCH.a);
  // Barki rozstawione wzdłuż burty (dwa — przy końcach kadłuba).
  const sx = [];
  if (n === 2) sx.push(-0.31 * b.L, 0.31 * b.L);
  else for (let k = 0; k < n; k++) sx.push(-0.4 * b.L + 0.8 * b.L * k / (n - 1));
  const twinSpan = C.gap + 2 * CA.a;
  // Najdłuższy zasięg klasy → długości odcinków ramion teleskopowych.
  let needMax = 0;
  for (let k = 0; k < n; k++) needMax = Math.max(needMax, A.slack * Math.hypot(gx[k] - sx[k], yEdge - sy, wz - sz));
  const segA = A.upper * needMax;
  const segB = A.sleeve * needMax;
  const arms = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < n; k++) {
      const S = [sx[k], side * sy, sz];
      const W = [gx[k], side * yEdge, wz];
      const r = Math.hypot(W[0] - S[0], W[1] - S[1], W[2] - S[2]);
      const need = A.slack * r;
      let l1; let sleeve; let l2Grip;
      if (def.tele && need > segA + segB) {
        l1 = segA; sleeve = segB; l2Grip = need - segA;
      } else {
        l1 = 0.53 * need; sleeve = 0.47 * need; l2Grip = sleeve;
      }
      const endSign = Math.abs(gx[k]) < 1e-6 ? 0 : Math.sign(gx[k]);
      const arm = {
        index: arms.length, side, end: endSign, slot: k,
        shoulder: Object.freeze(S), grip: Object.freeze(W),
        l1, sleeve, l2Grip, ext: l2Grip - sleeve,
        twin: k > 0 && k < nx ? twinSpan : 0,
        extA: A.extA, extB: A.extB,
        foldPhi: Math.atan2(side * A.foldSide, endSign),
        foldTheta1: A.foldTheta1,
        foldFore: A.foldFore
      };
      // Kąty chwytu (IK raz; lustro w tablicy klas GPU).
      const g = armIk(arm);
      arm.gripPhi = g.phi;
      arm.gripTheta1 = g.theta1;
      arm.gripFore = g.fore;
      arms.push(Object.freeze(arm));
    }
  }
  return Object.freeze(arms);
}

/**
 * IK chwytu: płaszczyzna pionowa przez bark i cel, łokieć nad linią bark → cel; azymut odwinięty
 * najkrótszym łukiem od azymutu złożenia (kąty mieszane liniowo w shaderze).
 */
function armIk(arm) {
  const S = arm.shoulder;
  const G = arm.grip;
  const gdx = G[0] - S[0];
  const gdy = G[1] - S[1];
  const dh = Math.hypot(gdx, gdy);
  const dv = G[2] - S[2];
  const l1 = arm.l1;
  const l2 = arm.l2Grip;
  const r = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, Math.hypot(dh, dv)));
  const alpha = Math.atan2(dv, dh);
  const cosB = (l1 * l1 + r * r - l2 * l2) / (2 * l1 * r);
  const beta = Math.acos(Math.max(-1, Math.min(1, cosB)));
  // Cel pionowo pod barkiem: płaszczyzna wzdłuż kadłuba (ku końcowi ramienia albo ku dziobowi).
  const phiG = dh > 1e-6 ? Math.atan2(gdy, gdx) : (arm.end < 0 ? Math.PI : 0);
  const th1 = alpha + beta;
  const eh = l1 * Math.cos(th1);
  const ez = l1 * Math.sin(th1);
  const fore = Math.atan2(dv - ez, dh - eh);
  let dphi = phiG - arm.foldPhi;
  dphi -= Math.PI * 2 * Math.round(dphi / (Math.PI * 2));
  return { phi: arm.foldPhi + dphi, theta1: th1, fore };
}

/** Światła klasy w układzie drona: [x, y, z, promień] (lustro tablicy shadera świateł). */
function lightPointsFor(def) {
  const b = def.body;
  const top = b.gap + b.H;
  const r = Math.max(0.3, 0.07 * b.W);
  const pts = {
    navLeft: [0.34 * b.L, 0.52 * b.W, b.gap + 0.62 * b.H, r],
    navRight: [0.34 * b.L, -0.52 * b.W, b.gap + 0.62 * b.H, r],
    strobe: [-0.44 * b.L, 0, top + 0.18 * b.H, r * 0.9],
    status: [0.02 * b.L, 0, top + 0.16 * b.H, r * 1.15],
    engines: [],
    rcs: [
      [0.36 * b.L, 0.52 * b.W, b.gap + 0.5 * b.H, r * 1.6],
      [-0.36 * b.L, 0.52 * b.W, b.gap + 0.5 * b.H, r * 1.6],
      [0.36 * b.L, -0.52 * b.W, b.gap + 0.5 * b.H, r * 1.6],
      [-0.36 * b.L, -0.52 * b.W, b.gap + 0.5 * b.H, r * 1.6]
    ]
  };
  const ys = def.engines === 4 ? [0.36, 0.12, -0.12, -0.36] : [0.24, -0.24];
  for (const y of ys) pts.engines.push([-0.5 * b.L - 0.12 * b.H, y * b.W, b.gap + 0.46 * b.H, r * 1.4]);
  return pts;
}

/** Zasięg drona do unikania (względem haka): promień poziomy i pas pionowy, pusty / z ładunkiem. */
function extentsFor(def, payload, arms) {
  const b = def.body;
  let reach = Math.hypot(b.L / 2, b.W / 2);
  let zLo = b.gap;
  let zHi = b.gap + b.H;
  let reachGrip = 0;
  let zHiGrip = b.gap + b.H + 0.12 * b.H;
  for (const a of arms) {
    // Złożone ramiona (lustro swarmArmPose przy e = 0).
    const p = swarmArmPose(a, 0, {});
    reach = Math.max(reach, Math.hypot(p.elbow[0], p.elbow[1]), Math.hypot(p.wrist[0], p.wrist[1]));
    zHi = Math.max(zHi, p.elbow[2] + def.armBeam);
    zLo = Math.min(zLo, p.wrist[2] - def.clawLen);
    // Chwyt: łokcie (teleskop wysunięty) — w obrysie chwytu, ale wyżej niż kadłub bywa.
    const g = swarmArmPose(a, 1, {});
    reachGrip = Math.max(reachGrip, Math.hypot(g.elbow[0], g.elbow[1]));
    zHiGrip = Math.max(zHiGrip, g.elbow[2] + def.armBeam);
  }
  const loadedReach = Math.hypot(payload.L / 2, payload.W / 2);
  return Object.freeze({
    empty: Object.freeze({ rh: reach + 0.6, zLo: zLo - 0.3, zHi: zHi + 0.3 }),
    loaded: Object.freeze({ rh: Math.max(reach, loadedReach, reachGrip) + 0.6, zLo: -payload.H - 0.3, zHi: zHiGrip + 0.3 })
  });
}

function buildClass(id, index) {
  const def = CLASS_DEFS[id];
  const pk = swarmPackSize(def.pack.nx, def.pack.ny, {});
  const payload = Object.freeze({ L: pk.L, W: pk.W, H: pk.H, nx: pk.nx, ny: pk.ny, count: pk.count });
  const arms = armRigFor(def, payload);
  return Object.freeze({
    id, index, label: def.label, name: def.name,
    pack: Object.freeze({ ...def.pack }),
    payload,
    body: Object.freeze({ ...def.body }),
    armCount: arms.length, engineCount: def.engines, armBeam: def.armBeam, clawLen: def.clawLen, tele: def.tele,
    arms,
    flight: Object.freeze({ ...def.flight }),
    priority: def.priority,
    extents: extentsFor(def, payload, arms),
    lights: Object.freeze(lightPointsFor(def)),
    /** Kontenery w pełnym chwycie (masa = Σ mas kontenerów niesionych). */
    volume: pk.count,
    padRadius: Math.hypot(def.body.L / 2, def.body.W / 2) + 0.18 * def.body.L
  });
}

export const SWARM_DRONE_CLASSES = Object.freeze(Object.fromEntries(SWARM_CLASS_IDS.map((id, i) => [id, buildClass(id, i)])));
export const SWARM_DRONE_CLASS_LIST = Object.freeze(SWARM_CLASS_IDS.map((id) => SWARM_DRONE_CLASSES[id]));

/** Klasa drona po id albo indeksie (null, gdy nie ma). */
export function swarmDroneClass(idOrIndex) {
  if (typeof idOrIndex === 'number') return SWARM_DRONE_CLASS_LIST[idOrIndex] || null;
  return SWARM_DRONE_CLASSES[String(idOrIndex || '')] || null;
}

/** Czy chwyt klasy dzieli obrys kolumny cnx × cny (komórki) bez reszty — klasa może tam pracować. */
export function swarmPackTiles(classIdOrCls, cnx, cny) {
  const c = typeof classIdOrCls === 'object' ? classIdOrCls : swarmDroneClass(classIdOrCls);
  return !!c && cnx >= c.pack.nx && cny >= c.pack.ny && cnx % c.pack.nx === 0 && cny % c.pack.ny === 0;
}

/**
 * Klasa kolumny o obrysie cnx × cny kontenerów (slot ładowni, pole placu): NAJWIĘKSZA klasa,
 * której chwyt dzieli obrys bez reszty (Atlas 2 × 2 → L, wagon 4 × 4 → Capital, ładownie
 * 1 × 2 → M, 1 × 1 → S). Mniejsze klasy też tam pracują (część warstwy).
 */
export function swarmClassForFootprint(cnx, cny) {
  for (let k = SWARM_DRONE_CLASS_LIST.length - 1; k >= 0; k--) {
    const c = SWARM_DRONE_CLASS_LIST[k];
    if (swarmPackTiles(c, cnx, cny)) return c.id;
  }
  return 'S';
}

// ============================================================
// Masa ładunku
// ============================================================

/** Tony kontenera standardowego przy gęstości 1 (CARGO_TONNES_DEFAULT z cargoBays.js). */
export const SWARM_TONNES_PER_STANDARD = 2;

/** Gęstość względna ładunku wg kategorii surowca (resources.js) — masa do wyważenia statku. */
export const SWARM_CARGO_DENSITY = Object.freeze({
  ore: 2.6, metal: 2.3, salvage: 1.7, volatile: 0.95, gas: 0.7, chemical: 1.15, electronic: 0.55,
  component: 0.9, weapon: 1.1, ordnance: 1.5, fuel: 1.35
});

/** Masa kontenera standardowego [t] z ładunkiem danej kategorii (gęstość × t/kontener). */
export function swarmContainerMass(category) {
  const d = SWARM_CARGO_DENSITY[String(category || '')] ?? 1;
  return SWARM_TONNES_PER_STANDARD * d;
}

// ============================================================
// Ramię — lustro CPU shadera (swarmDrones.tsl.js)
// ============================================================

/**
 * Poza ramienia dla rozłożenia e ∈ [0, 1] (0 złożone, 1 chwyt): bark, łokieć, nadgarstek,
 * kąty (azymut phi, wzniesienie ramienia theta1, wzniesienie przedramienia fore), długość
 * przedramienia l2 i wysuw teleskopu ext. Ta sama arytmetyka co w shaderze (kąty chwytu z IK
 * liczonego raz, kąty mieszane liniowo, wysuw smoothstep(extA, extB, e)) — przy e = 1 nadgarstek
 * leży dokładnie w celu chwytu.
 */
export function swarmArmPose(arm, e, out = {}) {
  const S = arm.shoulder;
  const t = e <= 0 ? 0 : e >= 1 ? 1 : e;
  const phi = arm.foldPhi + (arm.gripPhi - arm.foldPhi) * t;
  const th1 = arm.foldTheta1 + (arm.gripTheta1 - arm.foldTheta1) * t;
  const fore = arm.foldFore + (arm.gripFore - arm.foldFore) * t;
  const l2 = arm.sleeve + (arm.l2Grip - arm.sleeve) * smoothstep(arm.extA, arm.extB, t);
  const ch = Math.cos(phi);
  const sh = Math.sin(phi);
  const E = [S[0] + ch * arm.l1 * Math.cos(th1), S[1] + sh * arm.l1 * Math.cos(th1), S[2] + arm.l1 * Math.sin(th1)];
  const W = [E[0] + ch * l2 * Math.cos(fore), E[1] + sh * l2 * Math.cos(fore), E[2] + l2 * Math.sin(fore)];
  out.phi = phi;
  out.theta1 = th1;
  out.fore = fore;
  out.l2 = l2;
  out.ext = l2 - arm.sleeve;
  out.shoulder = S;
  out.elbow = E;
  out.wrist = W;
  return out;
}

/** Wymiary chwytu klasy (L × W × H) — skrót do danych klasy. */
export function swarmPayload(classId) {
  return swarmDroneClass(classId)?.payload || Object.freeze({ L: CARGO_CONTAINER.L, W: CARGO_CONTAINER.W, H: CARGO_CONTAINER.H, nx: 1, ny: 1, count: 1 });
}
