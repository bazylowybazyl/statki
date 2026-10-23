// DOKI PORTÓW BEZ RINGU (E14) — geometria trzech rodzajów budowli w układzie LOKALNYM doku. Czysta matematyka (bez
// Three i DOM): ten sam moduł liczy stanowiska i ścieżki w workerze ruchu (`dockLayout.js`, `portPaths.js`), kolizje
// w grze (`src/game/portDockWorld.js`) i model 3D (`src/3d/portDocks3D.js`, scena `portDockScene.js`).
//
// Układ lokalny = układ gry obrócony o kąt doku: punkt (u, v) → gra (x, y) = środek + R(kąt)·(u, v), kurs lokalny h →
// kurs w grze kąt + h (jak `toWorld` w dockLayout.js). Oś +u patrzy na węzeł portu (planeta, stacja): z tej strony
// przylatuje większość ruchu, więc szczelina koła i ramię 0 krzyża są od strony węzła.
//
// Rodzaje (dane i przydział: src/data/portDocks.js):
//   cross  cztery ramiona; stanowiska po obu stronach ramion (grzebienie jak w hali K-7: brama → aleja wzdłuż ramienia
//          → skręt → pole), największe (capital, MEGA) na czubkach ramion (wejście osią ramienia jak pas K-7);
//   round  obręcz; stanowiska na zewnętrznym obwodzie, dziobem do obręczy, wejście promieniowe (jak pomost);
//   wheel  koło z wlotem (płaski Coriolis): szczelina z czterema pasami — każda połowa koła ma swój wlot (zewnętrzny)
//          i wylot (bliżej osi), połowy się nie spotykają; w środku ruch okrężny — wlot po pierścieniu A (dalej od
//          piasty), wylot po pierścieniu B (bliżej), stanowiska na wewnętrznej ścianie dziobem do ściany. Obraca się
//          tylko piasta (obraz); kolizje stoją.
//
// Ścieżka stanowiska to punkty [u, v, rola] (DOCK_PATH_ROLE): `inbound` od punktu czekania (WAIT) do pola STOP,
// `outbound` od pierwszego ruchu po odłączeniu do punktu za dyskiem zapasu (`keepR`). Rola mówi `portPaths.js`, jaki
// sufit prędkości i flagi dostaje punkt — moduł nie importuje logiki ruchu. `funnel` — punkt za dyskiem zapasu na
// osi podejścia (trasa z przestrzeni kończy się w nim, dalej prosto do WAIT), `null`, gdy WAIT leży poza dyskiem.
// Kolizje: wypukłe wielokąty `solids` (lita konstrukcja w płaszczyźnie gry). Dysk zapasu `keepR` obejmuje bryły
// i statki na stanowiskach — trasy z przestrzeni go objeżdżają (`materializedFlight.js`), a punkty dyspozytora
// (kolejka, punkty manewrowe) w nim leżące są z niego wypychane.
import { BERTH_CLASSES, BERTH_MIXES, PORT_DOCK_KIND } from '../../data/portDocks.js';

const TAU = Math.PI * 2;

/** Rola punktu ścieżki doku (mapa na sufit prędkości i flagi: `portPaths.js`, `MODEL_ROLE`). */
export const DOCK_PATH_ROLE = Object.freeze({ WAIT: 0, GATE: 1, LANE: 2, CORNER: 3, BERTH: 4, REVERSE: 5, EXIT: 6, RING: 7 });
const R = DOCK_PATH_ROLE;

/** Wymiary rodzajów [j. świata]. */
export const PORT_DOCK_GEOMETRY = Object.freeze({
  cross: Object.freeze({
    armHalf: 180,        // pół szerokości ramienia (pomost)
    noseGap: 30,         // krawędź ramienia → dziób statku grzebienia
    hubHalf: 760,        // pół boku piasty
    aisleMargin: 150,    // zapas alei ponad obrót największego statku grzebienia przy skręcie
    firstGap: 250,       // pierwsze stanowisko grzebienia za aleją sąsiedniego ramienia
    armTail: 220,        // ramię za ostatnim stanowiskiem
    tipGap: 60,          // szczelina między czubkiem ramienia a dziobem statku na czubku
    gateBeyond: 260,     // brama grzebienia za końcem ramienia
    waitBeyond: 820,     // punkt czekania za bramą
    sideClear: 220,      // odbicie wychodzącego w bok ponad pół szerokości obu kadłubów
    pitch: 1.25          // odstęp stanowisk wzdłuż ramienia × szerokość pola
  }),
  round: Object.freeze({
    rimHalf: 170,        // pół grubości obręczy
    padGap: 50,          // obręcz → dziób statku
    fill: 0.92,          // ułamek obwodu zajęty przez pola (reszta — odstępy)
    minRim: 2600,
    hubFrac: 0.26,       // promień piasty / promień obręczy
    spokes: 6,
    spokeHalf: 120,
    sideClear: 220,
    pitch: 1.25
  }),
  wheel: Object.freeze({
    wall: 800,           // grubość obręczy koła
    noseGap: 60,         // ściana → dziób statku
    laneOff: 2100,       // odległość pasów wlotu od osi szczeliny
    outOff: 700,         // odległość pasów wylotu od osi szczeliny (wylot połowy po jej stronie osi)
    laneBeam: 1000,      // największa szerokość kadłuba na pasie (MEGA)
    laneClear: 150,      // pas → kadłub na stanowisku obok szczeliny
    slotMargin: 400,     // pas → ściana szczeliny
    ringMargin: 300,     // pierścień A pod obrotem największego kadłuba przy skręcie w stanowisko
    laneGap: 1400,       // pierścień A → pierścień B (wylot)
    hubClear: 500,       // pierścień B → piasta (ponad pół szerokości kadłuba)
    sep: 100,            // odstęp sąsiednich kadłubów w poprzek (najwęższe miejsce klina)
    gateBeyond: 150,     // brama za zewnętrzną krawędzią obręczy
    waitBeyond: 900,     // punkt czekania za bramą
    arcStep: 5 * Math.PI / 180,
    wallSegment: 1400    // długość segmentu obręczy w kolizjach
  }),
  /** Dysk zapasu = najdalszy punkt brył i pól + to. */
  keepMargin: 400,
  /** Lejek / wyjście: tyle za dyskiem zapasu. */
  funnelOut: 300
});

const CAPTURE_OF = Object.freeze({ capital: 'capital', mega: 'mega' });

function rot(u, v, a, out) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[0] = u * c - v * s;
  out[1] = u * s + v * c;
  return out;
}

const _r = [0, 0];

/** Skład portu: [[klasa…] na dok]. */
function mixOf(spec) {
  const base = Array.isArray(spec.mix) ? spec.mix : (BERTH_MIXES[spec.mix] || BERTH_MIXES.default);
  const repeats = Math.max(1, Math.floor(Number(spec.repeats) || 1));
  const dockCount = Math.max(1, Math.floor(Number(spec.dockCount) || 2));
  const one = [];
  for (let r = 0; r < repeats; r++) for (const c of base) one.push(c);
  return Array.from({ length: dockCount }, () => one.slice());
}

/** Stanowisko w układzie lokalnym (przed ścieżkami). */
function makeBerth(dock, index, clsId) {
  const cls = BERTH_CLASSES[clsId] || BERTH_CLASSES.m;
  return {
    dock, index, cls: cls.id, rank: cls.rank,
    padLength: cls.length, padWidth: cls.width,
    u: 0, v: 0, heading: 0,
    inbound: null, outbound: null, funnel: null,
    gate: [0, 0], out: [1, 0], side: [0, 1],
    corridor: '', corridorOut: null,
    capture: CAPTURE_OF[cls.id] || 'other'
  };
}

/** Ścieżka w buforze [u, v, rola] × n z listy trójek. */
function pathOf(points) {
  const out = new Float64Array(points.length * 3);
  points.forEach((p, i) => { out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; });
  return out;
}

/** Najmniejsze t ≥ 0, przy którym |p + d·t| ≥ r (d jednostkowy); 0, gdy p już poza. */
function exitAlong(px, py, dx, dy, r) {
  const b = px * dx + py * dy;
  const c = px * px + py * py - r * r;
  if (c >= 0) return 0;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Prostokąt (środek, kierunek osi, pół długości wzdłuż, pół szerokości) → wielokąt [[u, v] × 4]. */
function rectPoly(cu, cv, ax, ay, hl, hw) {
  const nx = -ay;
  const ny = ax;
  return [
    [cu + ax * hl + nx * hw, cv + ay * hl + ny * hw],
    [cu - ax * hl + nx * hw, cv - ay * hl + ny * hw],
    [cu - ax * hl - nx * hw, cv - ay * hl - ny * hw],
    [cu + ax * hl - nx * hw, cv + ay * hl - ny * hw]
  ];
}

/** Wielokąt foremny (n kątów) o promieniu r wokół (cu, cv). */
function ngon(cu, cv, r, n, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
  }
  return pts;
}

/** Prostokąt pola stanowiska (pole klasy, nie kadłub) jako wielokąt — do testów nakładania i dysku zapasu. */
export function berthPadPolygon(b) {
  const ax = Math.cos(b.heading);
  const ay = Math.sin(b.heading);
  return rectPoly(b.u, b.v, ax, ay, b.padLength / 2, b.padWidth / 2);
}

/** Promień obrotu kadłuba w miejscu (pół przekątnej pola + zapas) — wycofany statek obraca się o 180°. */
function turnRadius(b) {
  return Math.hypot(b.padLength, b.padWidth) / 2 + 80;
}

function angleGap(a, b) {
  const d = Math.abs(a - b) % TAU;
  return Math.min(d, TAU - d);
}

/**
 * Sąsiedzi stanowisk na obwodzie (kolejność kąta `theta`): `prev`, `next`. Wycofany statek obraca się dopiero tam,
 * gdzie jego koło obrotu nie zahacza pól sąsiadów (`roundBack`, `wheelBack`).
 */
function linkNeighbours(berths) {
  const ring = berths.slice().sort((a, b) => a.theta - b.theta);
  ring.forEach((b, i) => {
    b.prev = ring[(i - 1 + ring.length) % ring.length];
    b.next = ring[(i + 1) % ring.length];
  });
}

/** Okrąg: promień środka wycofanego statku (na zewnątrz od obręczy), przy którym obrót nie zahacza sąsiadów. */
function roundBack(b, rim, padGap) {
  const h = turnRadius(b);
  let rho = b.rc + b.padLength * 0.6 + 200;
  for (let it = 0; it < 400; it++, rho += 50) {
    let ok = true;
    for (const n of [b.prev, b.next]) {
      if (!n || n === b) continue;
      const d = angleGap(n.theta, b.theta);
      if (rho - h > rim + padGap + n.padLength) continue;
      const rLow = Math.max(rho - h, rim + padGap);
      if (rLow * Math.sin(d) - (n.padWidth / 2) * Math.cos(d) >= h) continue;
      ok = false;
    }
    if (ok) break;
  }
  return rho;
}

/** Koło: promień środka wycofanego statku (do środka koła) jak `roundBack`; najgłębiej pierścień wlotu A. */
function wheelBack(b, top, rA) {
  const h = turnRadius(b);
  let rho = top - b.padLength * 1.1 - 200;
  for (; rho > rA; rho -= 50) {
    let ok = true;
    for (const n of [b.prev, b.next]) {
      if (!n || n === b) continue;
      const d = angleGap(n.theta, b.theta);
      const tail = top - n.padLength;
      if (rho + h < tail) continue;
      const rLow = Math.max(rho - h, tail);
      if (rLow * Math.sin(d) - (n.padWidth / 2) * Math.cos(d) >= h) continue;
      ok = false;
    }
    if (ok) return rho;
  }
  return Math.max(rho, rA);
}

// ============================================================
// Krzyż
// ============================================================

function buildCross(docks) {
  const G = PORT_DOCK_GEOMETRY.cross;
  const dockCount = docks.length;
  const armDock = (k) => (dockCount === 1 ? 0 : dockCount === 2 ? (k < 2 ? 0 : 1) : k % dockCount);
  const berths = [];
  const tips = new Map();     // ramię → stanowisko na czubku
  const sides = new Map();    // 'k|s' → [stanowiska]
  docks.forEach((mix, d) => {
    const list = mix.map((c, i) => makeBerth(d, i, c));
    berths.push(...list);
    const arms = [0, 1, 2, 3].filter((k) => armDock(k) === d);
    // Czubki: największe (capital, MEGA) — po jednym na ramię doku, największe na pierwsze ramię.
    const big = list.filter((b) => b.rank >= 3).sort((a, b) => b.rank - a.rank || a.index - b.index);
    const onTip = new Set();
    arms.forEach((k, j) => { if (big[j]) { tips.set(k, big[j]); onTip.add(big[j]); } });
    // Reszta po bokach ramion doku, po kolei: (ramię, +1), (ramię, −1), (następne ramię, +1)…
    const keys = [];
    for (const k of arms) for (const s of [1, -1]) keys.push(`${k}|${s}`);
    let j = 0;
    for (const b of list) {
      if (onTip.has(b)) continue;
      const key = keys[j++ % keys.length];
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push(b);
    }
  });

  let Lside = BERTH_CLASSES.s.length;
  let Wside = BERTH_CLASSES.s.width;
  for (const list of sides.values()) {
    for (const b of list) { Lside = Math.max(Lside, b.padLength); Wside = Math.max(Wside, b.padWidth); }
  }
  const hw = G.armHalf;
  // Aleja grzebienia: pola + obrót największego statku boku przy skręcie (pół przekątnej) + zapas.
  const yA = hw + G.noseGap + Lside + Math.hypot(Lside, Wside) / 2 + G.aisleMargin;
  // Pierwsze pole za aleją grzebienia sąsiedniego ramienia (ta sama ćwiartka) — aleje i pola się nie krzyżują.
  const E0 = Math.max(yA + Wside / 2 + G.firstGap, G.hubHalf + 200);
  let sideLen = 0;
  for (const list of sides.values()) {
    let cursor = E0;
    for (const b of list) {
      const slot = b.padWidth * G.pitch;
      b.along = cursor + slot / 2;
      cursor += slot;
    }
    sideLen = Math.max(sideLen, cursor - E0);
  }
  const armLen = E0 + sideLen + G.armTail;
  const gateU = armLen + G.gateBeyond;
  const waitU = gateU + G.waitBeyond;
  const sideOff = Wside + G.sideClear;

  // Pozy w układzie ramienia → doku.
  for (const [key, list] of sides) {
    const [k, s] = key.split('|').map(Number);
    const a = (k * Math.PI) / 2;
    for (const b of list) {
      rot(b.along, s * (hw + G.noseGap + b.padLength / 2), a, _r);
      b.u = _r[0]; b.v = _r[1];
      b.heading = a + (s > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.arm = k; b.armSide = s;
    }
  }
  for (const [k, b] of tips) {
    const a = (k * Math.PI) / 2;
    b.along = armLen + G.tipGap + b.padLength / 2;
    rot(b.along, 0, a, _r);
    b.u = _r[0]; b.v = _r[1];
    b.heading = a + Math.PI;
    b.arm = k; b.armSide = 0;
  }

  const solids = [];
  solids.push({ tag: 'hub', points: rectPoly(0, 0, 1, 0, G.hubHalf, G.hubHalf) });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const u0 = G.hubHalf - 40;
    const mid = (u0 + armLen) / 2;
    solids.push({ tag: `arm${k}`, points: rectPoly(mid * c, mid * s, c, s, (armLen - u0) / 2, hw) });
  }

  const keepR = keepRadius(berths, solids);
  const F = keepR + PORT_DOCK_GEOMETRY.funnelOut;

  // Ścieżki w układzie ramienia, obrócone do doku.
  for (const b of berths) {
    const a = (b.arm * Math.PI) / 2;
    const pts = (list) => list.map(([u, v, role]) => { rot(u, v, a, _r); return [_r[0], _r[1], role]; });
    if (b.armSide === 0) {
      // Czubek: osią ramienia z zewnątrz, dziobem do czubka (jak pas K-7 / pomost).
      const reach = b.padLength * 1.2 + 300;
      const waitA = b.along + reach;
      const back = b.along + b.padLength * 0.6 + 200;
      const exitA = Math.max(waitA, back + 400);
      const side = b.padWidth + G.sideClear;
      b.inbound = pathOf(pts([[waitA, 0, R.WAIT], [b.along, 0, R.BERTH]]));
      const tail = exitAlong(exitA, side, 1, 0, F);
      b.outbound = pathOf(pts([[back, 0, R.REVERSE], [exitA, side, R.EXIT], [exitA + tail + 200, side, R.EXIT]]));
      const fun = exitAlong(waitA, 0, 1, 0, F);
      b.funnel = fun > 0 ? pts([[waitA + fun, 0, 0]])[0].slice(0, 2) : null;
      b.gate = pts([[b.along + b.padLength / 2, 0, 0]])[0].slice(0, 2);
      rot(1, 0, a, _r); b.out = [_r[0], _r[1]];
      rot(0, 1, a, _r); b.side = [_r[0], _r[1]];
      b.corridor = `tip${b.arm}`;
    } else {
      const s = b.armSide;
      const y = s * yA;
      const yb = s * (hw + G.noseGap + b.padLength / 2);
      b.inbound = pathOf(pts([[waitU, y, R.WAIT], [gateU, y, R.GATE], [b.along, y, R.CORNER], [b.along, yb, R.BERTH]]));
      const ye = y + s * sideOff;
      const tail = exitAlong(waitU, ye, 1, 0, F);
      b.outbound = pathOf(pts([[b.along, y, R.REVERSE], [gateU, y, R.LANE], [waitU, ye, R.EXIT], [waitU + tail + 200, ye, R.EXIT]]));
      const fun = exitAlong(waitU, y, 1, 0, F);
      b.funnel = fun > 0 ? pts([[waitU + fun, y, 0]])[0].slice(0, 2) : null;
      b.gate = pts([[gateU, y, 0]])[0].slice(0, 2);
      rot(1, 0, a, _r); b.out = [_r[0], _r[1]];
      rot(0, s, a, _r); b.side = [_r[0], _r[1]];
      b.corridor = `comb${b.arm}|${s}`;
    }
    b.corridorOut = b.corridor;
  }

  return {
    berths, solids, keepR,
    model: { hubHalf: G.hubHalf, armHalf: hw, armLen, aisle: yA, firstPad: E0, gateU, waitU }
  };
}

// ============================================================
// Okrąg
// ============================================================

function buildRound(docks) {
  const G = PORT_DOCK_GEOMETRY.round;
  const berths = [];
  docks.forEach((mix, d) => mix.forEach((c, i) => berths.push(makeBerth(d, i, c))));
  const slots = berths.map((b) => b.padWidth * G.pitch);
  const total = slots.reduce((s, x) => s + x, 0);
  const rim = Math.max(G.minRim, total / (TAU * G.fill));
  const D = docks.length;
  const sector = TAU / D;
  let k = 0;
  for (let d = 0; d < D; d++) {
    const list = berths.filter((b) => b.dock === d);
    const sum = list.reduce((s, b) => s + b.padWidth * G.pitch, 0) / rim;
    const extra = Math.max(0, sector - sum) / Math.max(1, list.length);
    let cursor = d * sector;
    for (const b of list) {
      const w = (b.padWidth * G.pitch) / rim + extra;
      b.theta = cursor + w / 2;
      cursor += w;
      k++;
    }
  }
  let Lmax = 0;
  for (const b of berths) {
    const rc = rim + G.padGap + b.padLength / 2;
    b.u = Math.cos(b.theta) * rc;
    b.v = Math.sin(b.theta) * rc;
    b.heading = b.theta + Math.PI;
    b.rc = rc;
    Lmax = Math.max(Lmax, b.padLength);
  }

  const solids = [];
  const r0 = rim - 2 * G.rimHalf;
  const n = Math.max(24, Math.min(120, Math.ceil((TAU * rim) / 1100)));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 1) / n) * TAU;
    solids.push({
      tag: 'rim',
      points: [[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0) * rim, Math.sin(a0) * rim],
        [Math.cos(a1) * rim, Math.sin(a1) * rim], [Math.cos(a1) * r0, Math.sin(a1) * r0]]
    });
  }
  const hubR = rim * G.hubFrac;
  solids.push({ tag: 'hub', points: ngon(0, 0, hubR, 12) });
  for (let i = 0; i < G.spokes; i++) {
    const a = (i / G.spokes) * TAU + Math.PI / G.spokes;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const u0 = hubR * 0.9;
    const u1 = r0 + 20;
    const mid = (u0 + u1) / 2;
    solids.push({ tag: 'spoke', points: rectPoly(mid * c, mid * s, c, s, (u1 - u0) / 2, G.spokeHalf) });
  }

  const keepR = keepRadius(berths, solids);
  const F = keepR + PORT_DOCK_GEOMETRY.funnelOut;
  // Sąsiedzi po obwodzie (kolejność kąta): wychodzący odbija w bok ku KRÓTSZEMU sąsiadowi — jego pole kończy się
  // bliżej obręczy niż punkt wyjścia, a dłuższy (capital, MEGA obok L) wystaje w poprzek drogi.
  linkNeighbours(berths);
  for (const b of berths) b.sideSign = b.next.padLength <= b.prev.padLength ? 1 : -1;
  for (const b of berths) {
    const c = Math.cos(b.theta);
    const s = Math.sin(b.theta);
    const at = (r, side = 0, role = 0) => [c * r - s * side * b.sideSign, s * r + c * side * b.sideSign, role];
    const reach = b.padLength * 1.2 + 300;
    const waitR = b.rc + reach;
    const back = roundBack(b, rim, G.padGap);
    const exitR = Math.max(waitR, back + 400);
    const side = b.padWidth + G.sideClear;
    b.inbound = pathOf([at(waitR, 0, R.WAIT), at(b.rc, 0, R.BERTH)]);
    const tail = exitAlong(exitR, side, 1, 0, F);
    b.outbound = pathOf([at(back, 0, R.REVERSE), at(exitR, side, R.EXIT), at(exitR + tail + 200, side, R.EXIT)]);
    const fun = exitAlong(waitR, 0, 1, 0, F);
    b.funnel = fun > 0 ? at(waitR + fun).slice(0, 2) : null;
    b.gate = at(b.rc + b.padLength / 2).slice(0, 2);
    b.out = [c, s];
    b.side = [-s * b.sideSign, c * b.sideSign];
    b.corridor = `pad${b.dock}|${b.index}`;
    b.corridorOut = b.corridor;
  }
  return { berths, solids, keepR, model: { rim, rimInner: r0, hubR, spokes: G.spokes, spokeHalf: G.spokeHalf, padGap: G.padGap } };
}

// ============================================================
// Koło z wlotem
// ============================================================

function buildWheel(docks) {
  const G = PORT_DOCK_GEOMETRY.wheel;
  const berths = [];
  docks.forEach((mix, d) => mix.forEach((c, i) => berths.push(makeBerth(d, i, c))));
  // Połowy koła: dok 0 — przeciwnie do wskazówek (v > 0), dok 1 — zgodnie; jeden dok — na przemian.
  const halves = [[], []];
  berths.forEach((b, j) => {
    const h = docks.length === 1 ? j % 2 : b.dock % 2;
    b.half = h === 0 ? 1 : -1;
    halves[h].push(b);
  });
  // Od szczeliny małe, dalej duże: na granicy klas klin zwęża się najmniej.
  for (const list of halves) list.sort((a, b) => a.rank - b.rank || a.dock - b.dock || a.index - b.index);
  let Lmax = 0;
  for (const b of berths) Lmax = Math.max(Lmax, b.padLength);
  const slotHalf = G.laneOff + G.laneBeam / 2 + G.slotMargin;
  const ringA = (Rin) => Rin - G.noseGap - Lmax - Math.max(G.laneBeam / 2, Lmax / 2) - G.ringMargin;
  const sepAngle = (a, b, Rin, rA) => ((a.padWidth + b.padWidth) / 2 + G.sep)
    / Math.max(rA, Rin - G.noseGap - Math.max(a.padLength, b.padLength));
  const firstAngle = (b, Rin, rA) => {
    const r1 = Rin - G.noseGap - b.padLength;
    const r2 = Rin - G.noseGap;
    const lane = G.laneOff + G.laneBeam / 2 + G.laneClear;
    const join = Math.asin(Math.min(1, G.laneOff / rA)) + 2 * Math.PI / 180;
    for (let t = join; t < Math.PI / 2; t += 0.002) {
      const c = Math.cos(t);
      const s = Math.sin(t);
      if (r1 * s - (b.padWidth / 2) * c < lane) continue;
      if (r2 * s - (b.padWidth / 2) * c < slotHalf + 100) continue;
      return t;
    }
    return Math.PI / 2;
  };
  const layoutHalves = (Rin) => {
    const rA = ringA(Rin);
    if (rA < 2500) return null;
    const out = [];
    for (let h = 0; h < 2; h++) {
      const list = halves[h];
      const thetas = [];
      if (!list.length) { out.push({ thetas, end: 0 }); continue; }
      let t = firstAngle(list[0], Rin, rA);
      thetas.push(t);
      for (let i = 1; i < list.length; i++) {
        t += sepAngle(list[i - 1], list[i], Rin, rA);
        thetas.push(t);
      }
      const other = halves[1 - h];
      const last = list[list.length - 1];
      const end = t + sepAngle(last, other.length ? other[other.length - 1] : last, Rin, rA) / 2;
      out.push({ thetas, end });
    }
    return out.every((o) => o.end <= Math.PI) ? out : null;
  };
  let Rin = 6000;
  let fit = null;
  for (; Rin < 60000; Rin += 100) {
    fit = layoutHalves(Rin);
    if (fit) break;
  }
  const rA = ringA(Rin);
  const rB = rA - G.laneGap;
  // Piasta pod pierścieniem B: kadłub wjeżdżający na pierścień promieniowo ma przed sobą pół długości.
  const hubR = rB - Math.max(G.laneBeam, Lmax) / 2 - G.hubClear;
  const Rout = Rin + G.wall;
  // Rozłożenie zapasu kąta: pierwsze stanowisko przy szczelinie zostaje, reszta rozsuwa się równo do π.
  for (let h = 0; h < 2; h++) {
    const list = halves[h];
    const { thetas, end } = fit[h];
    const slack = Math.max(0, Math.PI - end);
    const step = list.length > 1 ? slack / (list.length - 0.5) : 0;
    list.forEach((b, i) => {
      b.theta = (thetas[i] + step * i) * b.half;
      const rc = Rin - G.noseGap - b.padLength / 2;
      b.u = Math.cos(b.theta) * rc;
      b.v = Math.sin(b.theta) * rc;
      b.heading = b.theta;
      b.rc = rc;
    });
  }

  const solids = [];
  // Obręcz z szczeliną |v| < slotHalf po stronie +u: segmenty-czworokąty od krawędzi szczeliny do π (i lustrzanie).
  const aIn = Math.asin(slotHalf / Rin);
  const aOut = Math.asin(slotHalf / Rout);
  const span = Math.PI - aIn;
  const nSeg = Math.max(12, Math.ceil((span * Rin) / G.wallSegment));
  for (const h of [1, -1]) {
    for (let i = 0; i < nSeg; i++) {
      const t0 = i / nSeg;
      const t1 = (i + 1) / nSeg;
      const i0 = aIn + span * t0;
      const i1 = aIn + span * t1;
      const o0 = i === 0 ? aOut : aIn + span * t0;
      const o1 = aIn + span * t1;
      const pts = [
        [Math.cos(i0) * Rin, h * Math.sin(i0) * Rin], [Math.cos(o0) * Rout, h * Math.sin(o0) * Rout],
        [Math.cos(o1) * Rout, h * Math.sin(o1) * Rout], [Math.cos(i1) * Rin, h * Math.sin(i1) * Rin]
      ];
      solids.push({ tag: i === 0 ? 'slot' : 'wall', points: h > 0 ? pts : pts.reverse() });
    }
  }
  solids.push({ tag: 'hub', points: ngon(0, 0, hubR, 16) });

  const keepR = keepRadius(berths, solids);
  const gateU = Rout + G.gateBeyond;
  const waitU = gateU + G.waitBeyond;
  const slotIn = Rin - 200;
  const step = G.arcStep;
  const polar = (r, t, role) => [Math.cos(t) * r, Math.sin(t) * r, role];
  const arc = (list, r, t0, t1, role) => {
    const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / step));
    for (let k = 1; k < n; k++) list.push(polar(r, t0 + (t1 - t0) * (k / n), role));
  };
  linkNeighbours(berths);
  for (const b of berths) {
    const h = b.half;
    const laneV = h * G.laneOff;
    const join = h * Math.asin(G.laneOff / rA);
    const inbound = [
      [waitU, laneV, R.WAIT], [gateU, laneV, R.GATE], [slotIn, laneV, R.LANE],
      [Math.sqrt(rA * rA - G.laneOff * G.laneOff), laneV, R.LANE]
    ];
    arc(inbound, rA, join, b.theta, R.RING);
    inbound.push(polar(rA, b.theta, R.CORNER), polar(b.rc, b.theta, R.BERTH));
    b.inbound = pathOf(inbound);
    const back = wheelBack(b, Rin - G.noseGap, rA);
    const outV = h * G.outOff;
    const outJoin = h * Math.asin(G.outOff / rB);
    const outbound = [polar(back, b.theta, R.REVERSE), polar(rB, b.theta, R.LANE)];
    arc(outbound, rB, b.theta, outJoin, R.RING);
    outbound.push([Math.sqrt(rB * rB - G.outOff * G.outOff), outV, R.LANE], [slotIn, outV, R.LANE], [gateU, outV, R.LANE],
      [keepR + PORT_DOCK_GEOMETRY.funnelOut + 300, outV, R.EXIT]);
    b.outbound = pathOf(outbound);
    b.funnel = null;
    b.gate = [gateU, laneV];
    b.out = [1, 0];
    b.side = [0, h];
    b.corridor = `in${h > 0 ? 1 : 2}`;
    b.corridorOut = `out${h > 0 ? 1 : 2}`;
  }
  return {
    berths, solids, keepR,
    model: { Rin, Rout, wall: G.wall, slotHalf, ringA: rA, ringB: rB, hubR, gateU, waitU, laneOff: G.laneOff, outOff: G.outOff }
  };
}

// ============================================================
// Wspólne
// ============================================================

function keepRadius(berths, solids) {
  let r = 0;
  for (const b of berths) for (const [u, v] of berthPadPolygon(b)) r = Math.max(r, Math.hypot(u, v));
  for (const s of solids) for (const [u, v] of s.points) r = Math.max(r, Math.hypot(u, v));
  return r + PORT_DOCK_GEOMETRY.keepMargin;
}

const CACHE = new Map();

/**
 * Geometria doku w układzie lokalnym. `spec`: `{ kind, mix ('default' | 'megadock' | 'hangar' albo lista klas),
 * repeats, dockCount }`. Wynik (zamrożony, wspólny dla tych samych danych): `berths` w kolejności id
 * (`dok<d+1>:b<i>`), `solids`, `keepR`, `model` (wymiary do obrazu). Stanowisko: `dock`, `index`, `cls`, `rank`,
 * `padLength`, `padWidth`, `u`, `v`, `heading`, `inbound` / `outbound` ([u, v, rola] × n), `funnel`, `gate`, `out`,
 * `side`, `corridor`, `corridorOut`, `capture`.
 */
export function buildPortDockGeometry(spec = {}) {
  const kind = spec.kind || PORT_DOCK_KIND.CROSS;
  const mixKey = Array.isArray(spec.mix) ? spec.mix.join(',') : String(spec.mix || 'default');
  const key = `${kind}|${mixKey}|${Math.max(1, Math.floor(Number(spec.repeats) || 1))}|${Math.max(1, Math.floor(Number(spec.dockCount) || 2))}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const docks = mixOf(spec);
  const built = kind === PORT_DOCK_KIND.ROUND ? buildRound(docks)
    : kind === PORT_DOCK_KIND.WHEEL ? buildWheel(docks)
      : buildCross(docks);
  // Kolejność id: dok, potem indeks w składzie.
  built.berths.sort((a, b) => a.dock - b.dock || a.index - b.index);
  const geometry = Object.freeze({ kind, key, ...built });
  CACHE.set(key, geometry);
  return geometry;
}

/** Punkt lokalny → gra. `frame`: `{ x, y, angle }` (środek doku i kąt osi +u w grze). */
export function dockLocalToGame(frame, u, v, out = {}) {
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  out.x = frame.x + u * c - v * s;
  out.y = frame.y + u * s + v * c;
  return out;
}

/** Punkt gry → lokalny. */
export function dockGameToLocal(frame, x, y, out = {}) {
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  const dx = x - frame.x;
  const dy = y - frame.y;
  out.u = dx * c + dy * s;
  out.v = -dx * s + dy * c;
  return out;
}

/**
 * Wielokąty kolizji doku w układzie gry: `{ tag, points: [{ x, y }], minX, maxX, minY, maxY }`. Ramka jak
 * w `dockLocalToGame`. Liczone raz na dok (statyczne).
 */
export function portDockSolidsInGame(geometry, frame) {
  const tmp = {};
  return geometry.solids.map((s) => {
    const points = s.points.map(([u, v]) => { dockLocalToGame(frame, u, v, tmp); return { x: tmp.x, y: tmp.y }; });
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { tag: s.tag, points, minX, maxX, minY, maxY };
  });
}
