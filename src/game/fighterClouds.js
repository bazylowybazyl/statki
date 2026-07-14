// === FIGHTER CLOUD SYSTEM ===
// Zamiast rysować 100 osobnych ringów / linii dla 100 myśliwców, agregujemy
// myśliwce w "chmary" (clusters) i pokazujemy JEDEN marker z licznikiem.
// Gdy chmara friendly i enemy zwierają się w dogfight -> jeden marker bitwy
// z zielonym (friendly) i czerwonym (enemy) licznikiem + animacja rolki.
//
// Ten moduł jest CZYSTY (bez canvasu) i testowalny. Renderowanie żyje w index.html.

export function isFighterUnit(u) {
  if (!u || u.dead || u.destroyed || u.removed) return false;
  return !!(u.fighter || u.type === 'fighter' || u.type === 'interceptor');
}

export function fighterPoint(u) {
  const x = Number(u?.pos?.x ?? u?.x) || 0;
  const y = Number(u?.pos?.y ?? u?.y) || 0;
  return { x, y };
}

// --- Klasteryzacja single-linkage z siatką przestrzenną (O(n)) ---
// points: [{ x, y, ... }]. Zwraca tablicę tablic (oryginalnych obiektów).
export function clusterByProximity(points, linkDist = 700) {
  const list = Array.isArray(points) ? points.filter((p) => p) : [];
  const n = list.length;
  if (n === 0) return [];
  const cell = Math.max(1, Number(linkDist) || 700);
  const linkSq = cell * cell;

  const grid = new Map();
  const keyOf = (gx, gy) => `${gx}|${gy}`;
  const cellOf = (p) => [Math.floor(p.x / cell), Math.floor(p.y / cell)];
  for (let i = 0; i < n; i++) {
    const [gx, gy] = cellOf(list[i]);
    const key = keyOf(gx, gy);
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(i);
  }

  const visited = new Uint8Array(n);
  const clusters = [];
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    queue.length = 0;
    queue.push(i);
    const members = [];
    while (queue.length) {
      const idx = queue.pop();
      const p = list[idx];
      members.push(p);
      const [gx, gy] = cellOf(p);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(keyOf(gx + dx, gy + dy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (visited[j]) continue;
            const q = list[j];
            const ddx = q.x - p.x;
            const ddy = q.y - p.y;
            if (ddx * ddx + ddy * ddy <= linkSq) {
              visited[j] = 1;
              queue.push(j);
            }
          }
        }
      }
    }
    clusters.push(members);
  }
  return clusters;
}

function centroidOf(members) {
  let sx = 0;
  let sy = 0;
  for (const m of members) { sx += m.x; sy += m.y; }
  const inv = members.length ? 1 / members.length : 0;
  return { x: sx * inv, y: sy * inv };
}

function cloudRadius(members, cx, cy, { minRadius, radiusPad, maxRadius }) {
  let maxSq = 0;
  for (const m of members) {
    const ddx = m.x - cx;
    const ddy = m.y - cy;
    const d = ddx * ddx + ddy * ddy;
    if (d > maxSq) maxSq = d;
  }
  const r = Math.sqrt(maxSq) + radiusPad;
  return Math.max(minRadius, Math.min(maxRadius, r));
}

function aggregateCommand(members) {
  let sx = 0;
  let sy = 0;
  let count = 0;
  let type = null;
  let hasEntity = false;
  for (const m of members) {
    const cmd = m.cmd;
    if (!cmd) continue;
    sx += cmd.x;
    sy += cmd.y;
    count++;
    if (!type) type = cmd.type || 'move';
    if (cmd.hasEntity) hasEntity = true;
  }
  if (!count) return null;
  return { x: sx / count, y: sy / count, type: type || 'move', hasEntity, share: count / members.length };
}

// descriptors: [{ x, y, team:'friendly'|'enemy', selected:bool, cmd:{x,y,type,hasEntity}|null, ref }]
export function computeFighterClouds(descriptors, opts = {}) {
  const {
    linkDist = 700,
    minRadius = 150,
    radiusPad = 95,
    maxRadius = 8000
  } = opts;

  const friendly = [];
  const enemy = [];
  for (const d of (descriptors || [])) {
    if (!d) continue;
    (d.team === 'enemy' ? enemy : friendly).push(d);
  }

  const clouds = [];
  for (const [team, list] of [['friendly', friendly], ['enemy', enemy]]) {
    for (const members of clusterByProximity(list, linkDist)) {
      const { x: cx, y: cy } = centroidOf(members);
      let selectedCount = 0;
      for (const m of members) if (m.selected) selectedCount++;
      clouds.push({
        team,
        members,
        count: members.length,
        selectedCount,
        selected: selectedCount > 0,
        cx,
        cy,
        radius: cloudRadius(members, cx, cy, { minRadius, radiusPad, maxRadius }),
        cmd: aggregateCommand(members)
      });
    }
  }
  return { clouds };
}

// --- Wykrywanie starć (dogfight) między chmarami friendly i enemy ---
// Zwraca listę bitew (spójne składowe grafu dwudzielnego zwarcia).
export function computeBattles(clouds, opts = {}) {
  const { engageDist = 1200 } = opts;
  const list = Array.isArray(clouds) ? clouds : [];
  const friendly = list.filter((c) => c.team === 'friendly');
  const enemy = list.filter((c) => c.team === 'enemy');

  // union-find po indeksach [0..friendly+enemy)
  const total = friendly.length + enemy.length;
  const parent = new Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const engaged = new Set();
  for (let i = 0; i < friendly.length; i++) {
    const f = friendly[i];
    for (let j = 0; j < enemy.length; j++) {
      const e = enemy[j];
      const dx = f.cx - e.cx;
      const dy = f.cy - e.cy;
      const reach = f.radius + e.radius + engageDist;
      if (dx * dx + dy * dy <= reach * reach) {
        union(i, friendly.length + j);
        engaged.add(f);
        engaged.add(e);
      }
    }
  }

  const groups = new Map();
  const pushGroup = (root, cloud) => {
    let g = groups.get(root);
    if (!g) { g = []; groups.set(root, g); }
    g.push(cloud);
  };
  for (let i = 0; i < friendly.length; i++) if (engaged.has(friendly[i])) pushGroup(find(i), friendly[i]);
  for (let j = 0; j < enemy.length; j++) if (engaged.has(enemy[j])) pushGroup(find(friendly.length + j), enemy[j]);

  const battles = [];
  const cloudToBattle = new Map();
  for (const g of groups.values()) {
    const fClouds = g.filter((c) => c.team === 'friendly');
    const eClouds = g.filter((c) => c.team === 'enemy');
    if (!fClouds.length || !eClouds.length) continue;
    const battle = makeBattle(fClouds, eClouds);
    battles.push(battle);
    for (const c of g) cloudToBattle.set(c, battle);
  }
  return { battles, cloudToBattle, engaged };
}

function weightedCentroid(clouds) {
  let sx = 0;
  let sy = 0;
  let w = 0;
  for (const c of clouds) {
    sx += c.cx * c.count;
    sy += c.cy * c.count;
    w += c.count;
  }
  const inv = w ? 1 / w : 0;
  return { x: sx * inv, y: sy * inv, weight: w };
}

function makeBattle(fClouds, eClouds) {
  const fc = weightedCentroid(fClouds);
  const ec = weightedCentroid(eClouds);
  const friendlyCount = fc.weight;
  const enemyCount = ec.weight;
  const cx = (fc.x * friendlyCount + ec.x * enemyCount) / Math.max(1, friendlyCount + enemyCount);
  const cy = (fc.y * friendlyCount + ec.y * enemyCount) / Math.max(1, friendlyCount + enemyCount);
  const separation = Math.hypot(fc.x - ec.x, fc.y - ec.y);
  let radius = 0;
  for (const c of [...fClouds, ...eClouds]) {
    radius = Math.max(radius, Math.hypot(c.cx - cx, c.cy - cy) + c.radius);
  }
  let selected = false;
  for (const c of fClouds) if (c.selected) { selected = true; break; }
  return {
    friendlyClouds: fClouds,
    enemyClouds: eClouds,
    friendlyCount,
    enemyCount,
    friendlyCentroid: { x: fc.x, y: fc.y },
    enemyCentroid: { x: ec.x, y: ec.y },
    centroid: { x: cx, y: cy },
    separation,
    radius,
    selected
  };
}

// =================== ROLKA (slot-machine odometer) ===================
// Stan to tylko wygładzana liczba float; renderer liczy pozycje cyfr.

export function createRoll(value = 0) {
  const v = Math.max(0, Number(value) || 0);
  return { display: v, target: v };
}

export function stepRoll(state, target, dt, tau = 0.13) {
  if (!state) return createRoll(target);
  const tgt = Math.max(0, Number(target) || 0);
  state.target = tgt;
  const diff = tgt - state.display;
  if (Math.abs(diff) < 0.02) {
    state.display = tgt;
  } else {
    const k = 1 - Math.exp(-Math.max(0, Number(dt) || 0) / Math.max(0.001, tau));
    state.display += diff * k;
  }
  return state;
}

// Zwraca układ kolumn cyfr dla płynnego "spadania" (roll w dół).
// display: float; target: docelowa liczba (dla stabilnej liczby cyfr).
export function rollingCells(display, target = 0) {
  const d = Math.max(0, Number(display) || 0);
  const lo = Math.floor(d);
  const hi = lo + 1;
  const frac = d - lo;
  const top = Math.max(1, Math.floor(Math.max(Math.ceil(d), Number(target) || 0)));
  const digitCount = String(top).length;
  const cells = [];
  for (let i = 0; i < digitCount; i++) {
    const pow = Math.pow(10, digitCount - 1 - i);
    const loDigit = Math.floor(lo / pow) % 10;
    const hiDigit = Math.floor(hi / pow) % 10;
    cells.push({
      loDigit: ((loDigit % 10) + 10) % 10,
      hiDigit: ((hiDigit % 10) + 10) % 10,
      rolling: loDigit !== hiDigit
    });
  }
  return { digitCount, frac, cells };
}
