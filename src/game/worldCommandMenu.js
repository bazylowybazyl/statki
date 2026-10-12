// Etykiety po polsku, jak reszta HUD kokpitu (menu rysuje src/ui/commandOverlay.js).
const NORMAL_TARGET_ACTIONS = [
  ['attack', 'ATAK'],
  ['ram', 'TARAN'],
  ['approach', 'PODEJDŹ'],
  ['orbit', 'ORBITA'],
  // TRAVEL TO (2026-10-03): dawne SKOK i PRZELOT — jeden rozkaz podróży (src/game/travelNav.js).
  ['travel', 'TRAVEL TO'],
  ['scan', 'SKAN'],
  // Dron zwiadowczy (mgła wojny, 2026-10-04) — też na celu (2026-10-05): PPM obok dużej stacji (suchy dok
  // piratów) łapał stację i menu bez drona.
  ['drone', 'DRON ZWIADU']
];

// Pusta przestrzeń: bez ataku i taranu.
const NORMAL_EMPTY_ACTIONS = NORMAL_TARGET_ACTIONS.filter(([action]) => action !== 'attack' && action !== 'ram');

// Wraki dostają własne wejścia na górze listy — to jedyne cele, na których
// odzysk łupu w ogóle ma sens.
const WRECK_ACTIONS = [
  ['salvage', 'ODZYSK'],
  ['tow', 'HOL']
];

const RTS_ACTIONS = [
  ['approach', 'PODEJDŹ'],
  ['orbit', 'ORBITA'],
  ['attack', 'ATAK'],
  ['ram', 'TARAN'],
  ['hold', 'STÓJ'],
  ['scan', 'SKAN']
];

const ORBIT_RANGE_PRESETS = [1000, 3000, 5000, 10000, 15000];

function menuItem([action, label]) {
  return { action, label };
}

function pointFrom(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0
  };
}

function entityPoint(entity) {
  if (!entity) return null;
  return pointFrom(entity.pos || entity);
}

function commandTargetPoint(command) {
  if (!command) return null;
  const ent = command.targetEntity;
  if (ent && !ent.dead && !ent.destroyed && !ent.removed) return entityPoint(ent);
  return entityPoint(command.target);
}

function unitSortKey(unit, index) {
  const id = unit?.id ?? unit?.uid ?? unit?.name;
  return id == null ? `~${index}` : String(id);
}

function unitRadius(unit) {
  return Math.max(8, Number(unit?.radius) || Number(unit?.r) || 20);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// Zimny wrak (src/game/coldWrecks.js) leży w polu jako „tło” — hol go
// wyciąga: odmrożenie (thawWreck) i zaczep liny w jednej akcji.
function wreckActionItems(targetEntity) {
  return WRECK_ACTIONS.map(([action, label]) => ({
    action,
    label: targetEntity?.isCold && action === 'tow' ? 'WYCIĄGNIJ (HOL)' : label
  }));
}

export function buildNormalCommandMenuItems({ targetEntity = null } = {}) {
  const base = (targetEntity ? NORMAL_TARGET_ACTIONS : NORMAL_EMPTY_ACTIONS).map(menuItem);
  if (targetEntity?.isWreck) return [...wreckActionItems(targetEntity), ...base];
  return base;
}

// Akcje wraku na KOŃCU listy RTS — pierwsza pozycja (MOVE) prowadzi
// przeciąganie PPM i musi zostać na miejscu. Wykonuje je statek gracza.
export function buildRtsCommandMenuItems({ selectedCount = 0, targetEntity = null } = {}) {
  const formation = Number(selectedCount) > 1;
  const items = [
    { action: formation ? 'move-formation' : 'move', label: formation ? 'RUCH W SZYKU' : 'RUCH' },
    ...RTS_ACTIONS.map(menuItem)
  ];
  if (targetEntity?.isWreck) items.push(...wreckActionItems(targetEntity));
  return items;
}

export function buildOrbitRangeMenuItems({ currentRange = null } = {}) {
  const current = Math.max(80, Math.round(Number(currentRange) || 0));
  const currentLabel = current > 80 ? `OBECNY DYSTANS ${current}` : 'OBECNY DYSTANS';
  return [
    {
      action: 'orbit-range-current',
      label: currentLabel,
      orbitRangeMode: 'current',
      orbitRadius: current
    },
    ...ORBIT_RANGE_PRESETS.map((radius) => ({
      action: `orbit-range-${radius}`,
      label: String(radius),
      orbitRangeMode: 'preset',
      orbitRadius: radius
    })),
    {
      action: 'orbit-range-custom',
      label: 'WŁASNY…',
      orbitRangeMode: 'custom',
      orbitRadius: null
    }
  ];
}

export function resolveOrbitRadiusForUnit({
  unit = null,
  targetPoint = null,
  requestedRadius = null,
  fallbackRadius = 900,
  minRadius = 80
} = {}) {
  const minimum = Math.max(80, Number(minRadius) || 80);
  if (requestedRadius === 'current') {
    const unitPoint = entityPoint(unit);
    const target = entityPoint(targetPoint);
    if (unitPoint && target) {
      const dist = Math.hypot(unitPoint.x - target.x, unitPoint.y - target.y);
      if (Number.isFinite(dist) && dist > 1e-3) return Math.max(minimum, Math.round(dist));
    }
  }
  const numeric = Number(requestedRadius);
  if (Number.isFinite(numeric) && numeric > 0) return Math.max(minimum, Math.round(numeric));
  return Math.max(minimum, Math.round(Number(fallbackRadius) || 900));
}

export function createApproachCommand({ point, targetEntity = null, arrival = 280 } = {}) {
  return {
    type: 'approach',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival
  };
}

export function createRamCommand({ point, targetEntity = null, arrival = null, ramImpulse = 3400 } = {}) {
  const targetRadius = targetEntity ? unitRadius(targetEntity) : 120;
  const hitArrival = Math.max(180, targetRadius + 260);
  return {
    type: 'ram',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival: arrival != null && Number.isFinite(Number(arrival)) ? Number(arrival) : hitArrival,
    ramImpulse: Math.max(1600, Number(ramImpulse) || 3400)
  };
}

export function createOrbitCommand({
  point,
  targetEntity = null,
  arrival = 120,
  orbitRadius = 900,
  orbitDir = 1
} = {}) {
  return {
    type: 'orbit',
    target: targetEntity ? entityPoint(targetEntity) : pointFrom(point),
    targetEntity: targetEntity || null,
    arrival,
    orbitRadius: Math.max(80, Math.round(Number(orbitRadius) || 900)),
    orbitDir: (Number(orbitDir) || 1) >= 0 ? 1 : -1
  };
}

export function createMoveCommand({ point, arrival = 90, faceAngle = null } = {}) {
  const command = {
    type: 'move',
    target: pointFrom(point),
    arrival
  };
  if (Number.isFinite(faceAngle)) command.faceAngle = faceAngle;
  return command;
}

// Szyk rozkazu ruchu z przeciągnięciem kursu (worldCommandMenu.placement w index.html — podgląd ducha
// drawRtsPlacementGhosts i rozkaz issueMoveOrder liczą go tą funkcją): krata ⌈√n⌉ kolumn w poprzek zwrotu
// faceAngle (ostatni rząd, niepełny, od strony zwrotu), środek w punkcie. Odstęp kraty —
// rtsFormationGridSpacing (niżej, te same progi co szyk PPM). Miejsca wg pozycji okrętów (2026-10-08;
// dawniej wg id — tory dojazdu krzyżowały się w kracie, a okręt przecinający ją w poprzek między
// stojącymi utykał i kończył rozkaz przed punktem): krata dzieli się na linie w poprzek nadlotu
// (rzędy albo kolumny — wg osi bliższej kierunkowi od środka grupy do punktu); najdalsze linie dostają
// okręty najbardziej wysunięte w stronę punktu, w linii miejsca wg rzutu pozycji wzdłuż linii.
export function computeFormationTargets(units, anchor, faceAngle = 0, { tune = RTS_FORMATION_TUNE } = {}) {
  const list = Array.from(units || []);
  const targets = new Map();
  if (!list.length) return targets;

  const center = pointFrom(anchor);
  const angle = Number.isFinite(faceAngle) ? faceAngle : 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const n = list.length;
  const maxRadius = list.reduce((max, unit) => Math.max(max, unitRadius(unit)), 0);
  const spacing = rtsFormationGridSpacing(maxRadius, n, tune);
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  // Miejsca kraty: przesunięcie w bok i wzdłuż zwrotu względem punktu (w krokach pół odstępu — całkowite
  // klucze linii).
  const slots = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = row === rows - 1 ? n - row * cols : cols;
    const side2 = 2 * col - (itemsInRow - 1);
    const fwd2 = 2 * row - (rows - 1);
    slots.push({ side: side2 * spacing / 2, fwd: fwd2 * spacing / 2, side2, fwd2 });
  }

  let meanSide = 0;
  let meanFwd = 0;
  const items = list.map((unit, index) => {
    const p = unitPos(unit);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const side = dx * sideX + dy * sideY;
    const fwd = dx * forwardX + dy * forwardY;
    meanSide += side;
    meanFwd += fwd;
    return { unit, index, key: unitSortKey(unit, index), side, fwd };
  });
  // Grupa przed punktem (wzdłuż osi) leci w jej ujemną stronę; bez wyraźnego kierunku — jak od tyłu.
  const crossRows = Math.abs(meanFwd) >= Math.abs(meanSide);
  const lineAxis = crossRows ? 'fwd' : 'side';
  const alongAxis = crossRows ? 'side' : 'fwd';
  const lineKey = crossRows ? 'fwd2' : 'side2';
  const travel = (crossRows ? meanFwd : meanSide) > 0 ? -1 : 1;

  const lines = new Map();
  for (const slot of slots) {
    const k = slot[lineKey];
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(slot);
  }
  const order = [...lines.keys()].sort((a, b) => travel * (b - a));
  const byAlong = (a, b) => (a[alongAxis] - b[alongAxis]) || ((a.key ?? '').localeCompare(b.key ?? '')) || ((a.index ?? 0) - (b.index ?? 0));
  items.sort((a, b) => travel * (b[lineAxis] - a[lineAxis]) || a.key.localeCompare(b.key) || a.index - b.index);

  let next = 0;
  for (const k of order) {
    const line = lines.get(k).sort(byAlong);
    const group = items.slice(next, next + line.length).sort(byAlong);
    next += line.length;
    for (let j = 0; j < line.length; j++) {
      const slot = line[j];
      targets.set(group[j].unit, {
        x: center.x + sideX * slot.side + forwardX * slot.fwd,
        y: center.y + sideY * slot.side + forwardY * slot.fwd,
        faceAngle: angle
      });
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Szyk domyślnego rozkazu ruchu RTS (PPM bez przeciągania — formationTargets w index.html):
// rząd na klasę w poprzek kierunku „do wroga” albo kursu gracza (2026-10-08).
// Dawne odstępy (150 / 200 / 230 j.) kładły punkty w strefach bezpieczeństwa sąsiadów, a rozkazy
// omijają przeszkody (npcCommandPilot.js) — grupa stawała rozlana przed punktami. Teraz:
//  - odstęp pary z promieni (rtsFormationGap): większy z dwóch progów — strefa przeszkody
//    ogranicznika (capitalAI.js considerObstacle: suma promieni + 150 j.) i odstęp separacji
//    sojuszników (index.html applySeparationForces: max(suma promieni, tarcze ≈ 1,06 × suma)
//    + 0,6 × suma ≈ 1,66 × suma promieni) — plus zapas;
//  - rzędy od strony NADLOTU grupy od najwolniejszych: fregaty stają najdalej wzdłuż przelotu,
//    pancerniki najbliżej. Leci ku wrogowi — lekkie z przodu, wycofuje się — ciężkie od strony wroga.
//    Odwrotnie (pancerniki przed fregatami) pancerniki dojeżdżały ostatnie do stojącego rzędu fregat —
//    ściany stref przeszkody — i kończyły rozkaz 1,5–2 km przed punktem;
//  - rzędy, przez które przejeżdżają dalsze, są PRZEJEZDNE (rtsFormationPassGap, rtsFormationRowDepth):
//    klasy nie przyjeżdżają w kolejności prędkości (fregata zatrzymana w tłoku dojeżdża po niszczycielach);
//  - do każdego punktu da się dojechać objazdem stojącego sąsiada (rtsFormationDetourGap) — także
//    wzdłuż własnego rzędu, gdy okręt zepchnięty w drodze w bok dojeżdża 1–2 miejsca obok;
//  - w rzędzie miejsca wg rzutu pozycji na oś rzędu — tory dojazdu się nie krzyżują;
//  - środek głębokości szyku w punkcie rozkazu.
// Klasa nie dzieli się na kilka rzędów: bliższy musiałby być przejezdny dla dalszego (~2 × szerszy
// odstęp), więc szyk wyszedłby szerszy i głębszy niż jeden rząd.
// ---------------------------------------------------------------------------
export const RTS_FORMATION_TUNE = {
  obstaclePad: 150,
  sepK: 1.7,
  detourK: 1.15,
  pad: 60
};

// Klasy rzędów od strony nadlotu (najwolniejsze pierwsze). Gracz — w rzędzie niszczycieli (jak dawniej).
const RTS_ROW_ORDER = ['battleship', 'other', 'destroyer', 'frigate', 'fighter'];

export function rtsFormationClass(unit, player = null) {
  if (player && unit === player) return 'destroyer';
  if (unit?.fighter || unit?.type === 'fighter') return 'fighter';
  if (unit?.type && String(unit.type).includes('frigate')) return 'frigate';
  if (unit?.type === 'destroyer') return 'destroyer';
  if (unit?.type === 'battleship' || unit?.isCapitalShip) return 'battleship';
  return 'other';
}

// Odległość środków dwóch sąsiednich miejsc szyku: poza strefą przeszkody i odstępem separacji.
export function rtsFormationGap(ra, rb, tune = RTS_FORMATION_TUNE) {
  const sum = Math.max(0, Number(ra) || 0) + Math.max(0, Number(rb) || 0);
  return Math.max(sum + tune.obstaclePad, tune.sepK * sum) + tune.pad;
}

// Odstęp w rzędzie, przez który przejedzie okręt o promieniu `rPass` z dalszego rzędu: pomiędzy dwoma
// stojącymi mieści się jego objazd (styczna do strefy przeszkody × detourK — capitalAI.js
// computeObstacleDetour) i odstęp separacji od obu. Rząd okrętów w strefach przeszkody to ściana:
// kto dojeżdża później (fregaty zatrzymane w tłoku, wolniejsze klasy), stawał przed nią.
export function rtsFormationPassGap(rRow, rPass, tune = RTS_FORMATION_TUNE) {
  const sum = Math.max(0, Number(rRow) || 0) + Math.max(0, Number(rPass) || 0);
  return 2 * Math.max(tune.detourK * (sum + tune.obstaclePad), tune.sepK * sum) + tune.pad;
}

// Odstęp od stojącego okrętu (promień rObstacle), przy którym okręt (rShip) dojedzie do swojego punktu
// obok niego z DOWOLNEGO kierunku. Ogranicznik pilota (capitalAI.js considerObstacle) zatrzymuje okręt
// na granicy strefy c (suma promieni + 150 j.) przeszkody, która leży przed nim na kursie w odległości
// ≤ c od toru; objazd rusza (capitalCommandSteer), gdy punkt leży za strefą o więcej niż promień
// przybycia a (r + 25 j., jak issueMoveOrder, z luzem pilota). Najgorzej jest skosem: przeszkoda w
// odległości c od toru — punkt musi być dalej niż √(c² + (c + a)²). Dotyczy rzędu za rzędem i
// sąsiadów w rzędzie: okręt zepchnięty w drodze w bok (objazd, pole wraków, gracz) dojeżdża skosem albo
// wzdłuż rzędu obok sąsiada, który już stoi w swoim punkcie.
export function rtsFormationDetourGap(rObstacle, rShip, tune = RTS_FORMATION_TUNE) {
  const a = Math.max(0, Number(rObstacle) || 0);
  const b = Math.max(0, Number(rShip) || 0);
  const zone = a + b + tune.obstaclePad;
  const arrival = b + 25 + Math.min(24, 0.1 * (b + 25));
  return Math.sqrt(zone * zone + (zone + arrival) * (zone + arrival)) + tune.pad;
}

// Głębokość między rzędami: odstęp pary i objazd stojącego okrętu sąsiedniego rzędu w obie strony
// (dalszy dojeżdża przez bliższy, a okręt bliższego zepchnięty za swój rząd wraca obok dalszego).
export function rtsFormationRowDepth(rNear, rFar, tune = RTS_FORMATION_TUNE) {
  return Math.max(
    rtsFormationGap(rNear, rFar, tune),
    rtsFormationDetourGap(rNear, rFar, tune),
    rtsFormationDetourGap(rFar, rNear, tune)
  );
}

// Odstęp sąsiadów w rzędzie: para, objazd sąsiada i — gdy przez rząd przejeżdżają dalsze
// (rPass > 0) — przejazd.
export function rtsFormationRowSpacing(rRow, rPass = 0, tune = RTS_FORMATION_TUNE) {
  const spacing = Math.max(rtsFormationGap(rRow, rRow, tune), rtsFormationDetourGap(rRow, rRow, tune));
  return rPass > 0 ? Math.max(spacing, rtsFormationPassGap(rRow, rPass, tune)) : spacing;
}

// Odstęp kraty szyku z przeciągnięciem (computeFormationTargets) dla `count` okrętów o największym
// promieniu `r` — jeden w obu osiach, jak dawne max(80, 3 × r), które kładło punkty w strefach
// sąsiadów (same fregaty 267 j. przy strefie przeszkody 328 j., pancerniki 990 j. przy separacji
// 1094 j.): z omijaniem przeszkód w rozkazach grupa jednej klasy stawała rozlana przed punktami.
// Para poza strefą i separacją, dojazd objazdem stojącego sąsiada; od 4 okrętów (krata ≥ 2 × 2)
// dojeżdżający przejeżdżają między stojącymi w obu osiach — kierunek nadlotu względem zwrotu kraty
// wybiera gracz, a róg kraty 2 × 2 osiąga się też przejazdem między dwoma sąsiadami.
// Terra Nova: fregaty co ~810 j. (do 3 w rzędzie ~620), niszczyciele ~1090, pancerniki ~2300.
export function rtsFormationGridSpacing(r, count, tune = RTS_FORMATION_TUNE) {
  return rtsFormationRowSpacing(r, count > 3 ? r : 0, tune);
}

function unitPos(unit) {
  return {
    x: Number(unit?.x ?? unit?.pos?.x) || 0,
    y: Number(unit?.y ?? unit?.pos?.y) || 0
  };
}

// units — okręty grupy (pozycja: x / y albo pos), anchor — punkt rozkazu, faceAngle — kierunek „do
// wroga” / kurs gracza (rzędy w poprzek niego), player — encja gracza (jeśli w grupie). Zwraca Map
// okręt → { x, y }.
export function computeRtsClassRowTargets(units, anchor, faceAngle = 0, { player = null, tune = RTS_FORMATION_TUNE } = {}) {
  const list = Array.from(units || []).filter(Boolean);
  const targets = new Map();
  if (!list.length) return targets;
  const center = pointFrom(anchor);
  const angle = Number.isFinite(faceAngle) ? faceAngle : 0;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const rx = -fy;
  const ry = fx;

  const items = list.map((unit, index) => {
    const p = unitPos(unit);
    return {
      unit,
      index,
      key: unitSortKey(unit, index),
      cls: rtsFormationClass(unit, player),
      r: unitRadius(unit),
      side: (p.x - center.x) * rx + (p.y - center.y) * ry
    };
  });
  // Strona nadlotu: grupa przed punktem (wzdłuż fwd) leci w −fwd, więc rzędy układamy od +fwd.
  let meanFwd = 0;
  for (const unit of list) {
    const p = unitPos(unit);
    meanFwd += (p.x - center.x) * fx + (p.y - center.y) * fy;
  }
  const dir = meanFwd > 0 ? -1 : 1;

  const rows = [];
  for (const cls of RTS_ROW_ORDER) {
    const row = items.filter((it) => it.cls === cls);
    if (!row.length) continue;
    row.sort((a, b) => (a.side - b.side) || a.key.localeCompare(b.key) || a.index - b.index);
    rows.push({ r: row.reduce((max, it) => Math.max(max, it.r), 0), row });
  }

  // Największy promień w rzędach dalej od strony nadlotu (kto może przejeżdżać przez rząd i).
  const laterR = new Array(rows.length).fill(0);
  for (let i = rows.length - 2; i >= 0; i--) laterR[i] = Math.max(laterR[i + 1], rows[i + 1].r);
  const depths = new Array(rows.length);
  let depth = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) depth += rtsFormationRowDepth(rows[i - 1].r, rows[i].r, tune);
    depths[i] = depth;
  }
  const mid = depth / 2;
  for (let i = 0; i < rows.length; i++) {
    const { r, row } = rows[i];
    const spacing = rtsFormationRowSpacing(r, laterR[i], tune);
    const d = dir * (depths[i] - mid);
    const half = (row.length - 1) / 2;
    for (let j = 0; j < row.length; j++) {
      const s = (j - half) * spacing;
      targets.set(row[j].unit, {
        x: center.x + fx * d + rx * s,
        y: center.y + fy * d + ry * s
      });
    }
  }
  return targets;
}

export function computeRtsCameraPanDelta(keys = {}, { speed = 1200, zoom = 1, dt = 0 } = {}) {
  const right = (keys.d || keys.arrowright) ? 1 : 0;
  const left = (keys.a || keys.arrowleft) ? 1 : 0;
  const down = (keys.s || keys.arrowdown) ? 1 : 0;
  const up = (keys.w || keys.arrowup) ? 1 : 0;
  const x = right - left;
  const y = down - up;
  if (!x && !y) return { x: 0, y: 0 };
  const len = Math.hypot(x, y) || 1;
  const distance = (Number(speed) || 0) * (Number(dt) || 0) / Math.max(0.0001, Number(zoom) || 1);
  return {
    x: (x / len) * distance,
    y: (y / len) * distance
  };
}

export function computeCommandMenuOpenAnimation({ elapsed = 0, duration = 0.24 } = {}) {
  const t = clamp01((Number(elapsed) || 0) / Math.max(0.0001, Number(duration) || 0.24));
  return {
    alpha: smoothstep01(t),
    scaleY: 0.02 + 0.98 * smoothstep01(t),
    reveal: t
  };
}

export function computeAttackAutopilotState({
  distance = 0,
  weaponRanges = [],
  targetRadius = 0,
  minOrbitRadius = 420
} = {}) {
  const ranges = Array.from(weaponRanges || [])
    .map((range) => Number(range) || 0)
    .filter((range) => range > 0);
  const maxWeaponRange = ranges.length ? Math.max(...ranges) : 0;
  if (maxWeaponRange <= 0) {
    return {
      hasWeaponRange: false,
      inWeaponRange: false,
      commandType: null,
      maxWeaponRange: 0,
      approachArrival: 0,
      orbitRadius: 0
    };
  }

  const radius = Math.max(0, Number(targetRadius) || 0);
  const inWeaponRange = (Number(distance) || 0) <= maxWeaponRange;
  const approachArrival = Math.max(radius + 120, maxWeaponRange * 0.86);
  const orbitRadius = Math.min(
    maxWeaponRange * 0.92,
    Math.max(radius + 260, maxWeaponRange * 0.72, Number(minOrbitRadius) || 420)
  );
  return {
    hasWeaponRange: true,
    inWeaponRange,
    commandType: inWeaponRange ? 'orbit' : 'approach',
    maxWeaponRange,
    approachArrival,
    orbitRadius
  };
}

export function computeApproachPathLine(command, from) {
  if (!command || (command.type !== 'approach' && command.type !== 'ram')) return null;
  const target = commandTargetPoint(command);
  if (!target) return null;
  return {
    start: pointFrom(from),
    end: target,
    arrival: Math.max(0, Number(command.arrival) || 0)
  };
}

export function computeCommandVisual(command, from, unit = null) {
  if (!command) return null;
  const type = String(command.type || '').toLowerCase();
  if (!['move', 'attack-move', 'approach', 'ram', 'orbit'].includes(type)) return null;

  const target = commandTargetPoint(command);
  if (!target) return null;

  const start = pointFrom(from);
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const dist = Math.hypot(dx, dy);
  const arrival = Math.max(0, Number(command.arrival) || 0);
  const unitAngle = Number.isFinite(Number(unit?.angle)) ? Number(unit.angle) : 0;
  const faceAngle = Number.isFinite(Number(command.faceAngle))
    ? Number(command.faceAngle)
    : (dist > 1e-6 ? Math.atan2(dy, dx) : unitAngle);

  if (type === 'orbit') {
    const radius = Math.max(80, Number(command.orbitRadius) || 900);
    const orbitDir = (Number(command.orbitDir) || 1) >= 0 ? 1 : -1;
    const radialX = dist > 1e-6 ? (start.x - target.x) / dist : 1;
    const radialY = dist > 1e-6 ? (start.y - target.y) / dist : 0;
    const point = {
      x: target.x + radialX * radius,
      y: target.y + radialY * radius
    };
    const tangentX = -radialY * orbitDir;
    const tangentY = radialX * orbitDir;
    const arrowLen = Math.max(120, Math.min(420, radius * 0.24));
    const arrow = {
      start: {
        x: point.x - tangentX * arrowLen * 0.5,
        y: point.y - tangentY * arrowLen * 0.5
      },
      end: {
        x: point.x + tangentX * arrowLen * 0.5,
        y: point.y + tangentY * arrowLen * 0.5
      }
    };
    return {
      type,
      target,
      path: { start, end: point },
      arrow,
      orbit: {
        center: target,
        radius,
        dir: orbitDir,
        point,
        arrow
      }
    };
  }

  // Ghost (sylwetka statku w miejscu docelowym) TYLKO dla czystego ruchu do
  // punktu. Rozkaz ATTACK to 'attack-move' z targetEntity — wtedy ghost ląduje
  // NA sprite'cie wroga i go zasłania, więc go pomijamy. Approach/ram/orbit też
  // celują w jednostkę, więc bez ghosta.
  const showGhost = (type === 'move' || type === 'attack-move') && !command.targetEntity;
  return {
    type,
    target,
    arrival,
    path: { start, end: target },
    arrow: dist > 1e-6 ? { start, end: target } : null,
    ghost: showGhost
      ? {
        pos: target,
        angle: faceAngle,
        arrival
      }
      : null
  };
}

export function hitTestCommandMenu(menu, x, y) {
  if (!menu || !Array.isArray(menu.items)) return null;
  const width = Number(menu.width) || 0;
  const itemHeight = Number(menu.itemHeight) || 0;
  const mx = Number(menu.x) || 0;
  const my = Number(menu.y) || 0;
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || width <= 0 || itemHeight <= 0) return null;
  if (px < mx || px > mx + width || py < my || py >= my + itemHeight * menu.items.length) return null;
  const index = Math.floor((py - my) / itemHeight);
  return menu.items[index] || null;
}
