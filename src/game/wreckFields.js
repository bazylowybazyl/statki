/**
 * Pola zimnych wraków — rekordy dla UI (CIC), liczone z listy coldWrecks.
 *
 * Pole to grupa zimnych wraków połączonych łańcuchowo: dwa wraki bliżej niż
 * `linkRadius` należą do jednego pola (union-find). Kubełki o boku linkRadius
 * ograniczają sąsiadów do 3×3 kubełków, więc przy 1500 zimnych to O(n), nie O(n²).
 * Przebudowa tylko wtedy, gdy zbiór zimnych się zmienił (coldWreckSystem.version),
 * nie częściej niż co kilkaset ms — rekordy są dla UI, nie dla fizyki.
 *
 * Rekord: { id, x, y, radius, count, members, summary }. `id` jest stabilne,
 * dopóki w polu zostaje jego najstarszy wrak (klucz nadawany przy pierwszym
 * klastrowaniu). Streszczenie składa się ze streszczeń zrzutów
 * (buildColdWreckSummary w coldWrecks.js).
 */

export const WRECK_FIELD_CONFIG = Object.freeze({
  // Wraki bliżej niż tyle [j.] są w jednym polu.
  linkRadius: 3000,
  // Najmniejszy promień rekordu (pojedynczy wrak też jest „polem”).
  minRadius: 600
});

let _fieldKeyCounter = 0;

function wreckKey(w) {
  if (!w._coldFieldKey) w._coldFieldKey = ++_fieldKeyCounter;
  return w._coldFieldKey;
}

function worldRadius(w) {
  const r = Number(w?.radius) || 0;
  const v = w?.visual;
  const sx = Math.abs(Number(v?.spriteScaleX ?? v?.spriteScale) || 1);
  const sy = Math.abs(Number(v?.spriteScaleY ?? v?.spriteScale) || 1);
  return r * (sx > sy ? sx : sy);
}

function find(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/**
 * @param {object[]} coldWrecks
 * @param {object[]} [out]  tablica wynikowa (czyszczona i wypełniana)
 * @param {{linkRadius?:number,minRadius?:number}} [config]
 * @returns {object[]} rekordy pól, od największego
 */
export function buildWreckFields(coldWrecks, out = [], config = WRECK_FIELD_CONFIG) {
  out.length = 0;
  const list = Array.isArray(coldWrecks) ? coldWrecks.filter(w => w && !w.dead) : [];
  const n = list.length;
  if (n === 0) return out;
  const link = Math.max(1, Number(config?.linkRadius) || WRECK_FIELD_CONFIG.linkRadius);
  const minRadius = Math.max(0, Number(config?.minRadius) || 0);
  const linkSq = link * link;

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const buckets = new Map();
  const cellX = new Int32Array(n);
  const cellY = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor((Number(list[i].x) || 0) / link);
    const cy = Math.floor((Number(list[i].y) || 0) / link);
    cellX[i] = cx;
    cellY[i] = cy;
    const key = cx + ',' + cy;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(i);
  }
  for (let i = 0; i < n; i++) {
    const xi = Number(list[i].x) || 0;
    const yi = Number(list[i].y) || 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get((cellX[i] + dx) + ',' + (cellY[i] + dy));
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const j = bucket[b];
          if (j <= i) continue;
          const ex = (Number(list[j].x) || 0) - xi;
          const ey = (Number(list[j].y) || 0) - yi;
          if (ex * ex + ey * ey > linkSq) continue;
          const ri = find(parent, i);
          const rj = find(parent, j);
          if (ri !== rj) parent[rj] = ri;
        }
      }
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(parent, i);
    let group = byRoot.get(root);
    if (!group) byRoot.set(root, (group = []));
    group.push(list[i]);
  }

  for (const members of byRoot.values()) {
    let sx = 0;
    let sy = 0;
    let minKey = Infinity;
    const summary = { weapons: 0, cargoWrecks: 0, scrapWrecks: 0, liveHexes: 0, classes: {} };
    for (const w of members) {
      sx += Number(w.x) || 0;
      sy += Number(w.y) || 0;
      const key = wreckKey(w);
      if (key < minKey) minKey = key;
      const s = w._coldSnapshot?.summary;
      if (!s) continue;
      summary.weapons += s.weapons || 0;
      summary.liveHexes += s.liveHexes || 0;
      if (s.hasCargo) summary.cargoWrecks++;
      if (s.hasScrap) summary.scrapWrecks++;
      const cls = s.hullClass || 'wrak';
      summary.classes[cls] = (summary.classes[cls] || 0) + 1;
    }
    const x = sx / members.length;
    const y = sy / members.length;
    let radius = minRadius;
    for (const w of members) {
      const r = Math.hypot((Number(w.x) || 0) - x, (Number(w.y) || 0) - y) + worldRadius(w);
      if (r > radius) radius = r;
    }
    const field = { id: 'pole-' + minKey, x, y, radius, count: members.length, members, summary };
    for (const w of members) w._coldFieldId = field.id;
    out.push(field);
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/** Pole, w którego zasięgu (promień + `reach`) jest punkt — najbliższe środkiem. */
export function findWreckFieldNear(fields, x, y, reach = 0) {
  let best = null;
  let bestDistSq = Infinity;
  for (const f of fields || []) {
    const dx = f.x - x;
    const dy = f.y - y;
    const distSq = dx * dx + dy * dy;
    const lim = f.radius + reach;
    if (distSq > lim * lim || distSq >= bestDistSq) continue;
    best = f;
    bestDistSq = distSq;
  }
  return best;
}
