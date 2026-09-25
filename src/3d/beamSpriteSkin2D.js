// Skóra kadłuba 2D ze sprite'a: jeden czworokąt na węzeł (komórkę siatki).
//
// Narożnik czworokąta = narożnik komórki w spoczynku + średnie przemieszczenie
// węzłów, które dzielą ten narożnik I wciąż są połączone z węzłem całą belką.
// W nietkniętej płycie sąsiednie komórki liczą narożnik z tego samego zbioru
// węzłów, więc skóra jest ciągła; zerwana belka rozdziela zbiory i szew się
// otwiera. To ta sama zasada co FFD skóry GLB (tekstura linków w beamShips3D),
// tylko na CPU — komórek kadłuba 2D jest kilka tysięcy. Moduł nie importuje three.

// Kolejność narożników czworokąta: (−,−), (+,−), (+,+), (−,+) — trójkąty 0-1-2, 0-2-3.
export const SPRITE_CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);

const dirIndex = (dx, dy) => (dx + 1) + (dy + 1) * 3;

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Stałe dane skóry dla bieżących magazynów ciała: belka do każdego z 8
 * sąsiadów siatki (albo −1, gdy sąsiada w kadłubie nigdy nie było), UV
 * narożników i indeksy trójkątów. Liczyć ponownie po rozpadzie (nowy body.nodeStore).
 */
export function buildSpriteSkinTopology(body) {
  const s = body.nodeStore, e = body.beamStore, count = s.count;
  const ix = s.ix, iy = s.iy, ea = e.a, eb = e.b;
  const links = new Int32Array(count * 9).fill(-1);
  for (let bi = 0; bi < e.count; bi++) {
    const a = ea[bi], b = eb[bi];
    const dx = ix[b] - ix[a], dy = iy[b] - iy[a];
    if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
    links[a * 9 + dirIndex(dx, dy)] = bi;
    links[b * 9 + dirIndex(-dx, -dy)] = bi;
  }

  const skin = body.spriteSkin;
  const pitch = skin.pixelPitch, W = skin.width, H = skin.height, ny = skin.ny;
  const uvs = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) {
      // Narożnik siatki (cx, cy), cy w górę; tekstura z flipY: v = 1 to górny wiersz obrazu.
      const cx = ix[i] + (SPRITE_CORNERS[k][0] > 0 ? 1 : 0);
      const cy = iy[i] + (SPRITE_CORNERS[k][1] > 0 ? 1 : 0);
      uvs[i * 8 + k * 2] = cx * pitch / W;
      uvs[i * 8 + k * 2 + 1] = 1 - (ny - cy) * pitch / H;
    }
  }

  const indices = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const v = i * 4, o = i * 6;
    indices[o] = v; indices[o + 1] = v + 1; indices[o + 2] = v + 2;
    indices[o + 3] = v; indices[o + 4] = v + 2; indices[o + 5] = v + 3;
  }
  return { store: s, beamStore: e, count, links, uvs, indices, stamps: new Uint32Array(count), stamp: 0 };
}

// Trwałe odkształcenie belek węzła → ciemniejsza blacha w wgnieceniu i na zagięciu.
function nodeDent(s, e, i) {
  const adj = s.adj, broken = e.broken, rest = e.rest, restBase = e.restBase;
  let damage = 0;
  for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
    const bi = adj[q];
    if (broken[bi]) continue;
    const plastic = Math.abs(rest[bi] - restBase[bi]) / restBase[bi];
    if (plastic > damage) damage = plastic;
  }
  return smoothstep(0.02, 0.22, damage);
}

// Czworokąt węzła i (układ lokalny ciała). Martwy węzeł = czworokąt zwinięty do punktu.
function writeQuad(i, topo, half, positions, colors) {
  const s = topo.store, e = topo.beamStore, links = topo.links;
  const x = s.x, y = s.y, ox = s.ox, oy = s.oy, active = s.active;
  const ea = e.a, eb = e.b, broken = e.broken;
  const base = i * 12;
  if (!active[i]) {
    for (let k = 0; k < 12; k += 3) {
      positions[base + k] = ox[i]; positions[base + k + 1] = oy[i]; positions[base + k + 2] = s.oz[i];
      colors[base + k] = 0; colors[base + k + 1] = 0; colors[base + k + 2] = 0;
    }
    return 0;
  }
  const dxn = x[i] - ox[i], dyn = y[i] - oy[i];
  const dent = nodeDent(s, e, i);
  for (let k = 0; k < 4; k++) {
    const sx = SPRITE_CORNERS[k][0], sy = SPRITE_CORNERS[k][1];
    let sumX = dxn, sumY = dyn, weight = 1, torn = 0;
    // Trzy komórki dzielące narożnik: (sx, 0), (0, sy), (sx, sy).
    for (let c = 0; c < 3; c++) {
      const bi = links[i * 9 + dirIndex(c === 1 ? 0 : sx, c === 0 ? 0 : sy)];
      if (bi < 0) continue;
      const m = ea[bi] === i ? eb[bi] : ea[bi];
      if (broken[bi] || !active[m]) { torn++; continue; }
      sumX += x[m] - ox[m]; sumY += y[m] - oy[m]; weight++;
    }
    const o = base + k * 3;
    positions[o] = ox[i] + sx * half + sumX / weight;
    positions[o + 1] = oy[i] + sy * half + sumY / weight;
    positions[o + 2] = s.z[i];
    // Brzeg rozdarcia ciemnieje — widać, gdzie szew puścił.
    const shade = Math.max(0.2, 1 - 0.42 * dent - (torn ? 0.3 : 0));
    colors[o] = shade; colors[o + 1] = shade; colors[o + 2] = shade;
  }
  return 1;
}

/** Cała skóra. Zwraca liczbę widocznych czworokątów. */
export function writeSpriteSkinGeometry(body, topo, positions, colors) {
  const half = body.cellSize * 0.5;
  let visible = 0;
  for (let i = 0; i < topo.count; i++) visible += writeQuad(i, topo, half, positions, colors);
  return visible;
}

/**
 * Tylko czworokąty zmienionych węzłów i ich 8 sąsiadów (narożniki są wspólne).
 * Zwraca zakres zmienionych czworokątów w `out` ({ min, max }, max < min = nic).
 */
export function writeSpriteSkinQuads(body, topo, positions, colors, list, count, out) {
  const half = body.cellSize * 0.5, links = topo.links, stamps = topo.stamps;
  const ea = topo.beamStore.a, eb = topo.beamStore.b;
  let stamp = (topo.stamp + 1) >>> 0;
  if (stamp === 0) { stamps.fill(0); stamp = 1; }
  topo.stamp = stamp;
  let min = topo.count, max = -1;
  for (let k = 0; k < count; k++) {
    const i = list[k];
    for (let d = 0; d < 9; d++) {
      let j = i;
      if (d !== 4) {
        const bi = links[i * 9 + d];
        if (bi < 0) continue;
        j = ea[bi] === i ? eb[bi] : ea[bi];
      }
      if (stamps[j] === stamp) continue;
      stamps[j] = stamp;
      writeQuad(j, topo, half, positions, colors);
      if (j < min) min = j;
      if (j > max) max = j;
    }
  }
  out.min = min;
  out.max = max;
  return out;
}
