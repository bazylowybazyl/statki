// Surface topology is prepared once per imported asset, shared by every copy.
// Runtime work is proportional to physical patches and only runs on a tear.
const pairKey = (a, b, count) => Math.min(a, b) * count + Math.max(a, b);
const EMPTY_INDICES = new Uint32Array(0);
const cellAt = (uv, v, d) => Math.min(d.x - 1, Math.floor(uv[v * 3] * d.x))
  + Math.min(d.y - 1, Math.floor(uv[v * 3 + 1] * d.y)) * d.x
  + Math.min(d.z - 1, Math.floor(uv[v * 3 + 2] * d.z)) * d.x * d.y;

// Long source polygons cannot follow a local dent or split. Subdivide only
// those edges, preserving UV seams, normals, materials and shared attributes.
function subdivideSurface(skin) {
  const batches = new Map(), cs = skin.cellSize, origin = skin.latticeMin, d = skin.dims;
  for (const part of skin.parts) {
    let batch = batches.get(part.positions);
    if (!batch) { batch = []; batches.set(part.positions, batch); }
    batch.push(part);
  }
  for (const parts of batches.values()) {
    const source = parts[0], limitSq = (cs * 1.25) ** 2;
    let p = source.positions, n = source.normals, uv = source.uvs, cells = source.cellUV;
    const midpoints = new Map();
    const edgeSq = (a, b) => (p[a * 3] - p[b * 3]) ** 2 + (p[a * 3 + 1] - p[b * 3 + 1]) ** 2 + (p[a * 3 + 2] - p[b * 3 + 2]) ** 2;
    const midpoint = (a, b) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (midpoints.has(key)) return midpoints.get(key);
      if (!Array.isArray(p)) { p = Array.from(p); n = Array.from(n); uv = Array.from(uv); cells = Array.from(cells); }
      const v = p.length / 3;
      const x = (p[a * 3] + p[b * 3]) * 0.5, y = (p[a * 3 + 1] + p[b * 3 + 1]) * 0.5, z = (p[a * 3 + 2] + p[b * 3 + 2]) * 0.5;
      p.push(x, y, z);
      const nx = n[a * 3] + n[b * 3], ny = n[a * 3 + 1] + n[b * 3 + 1], nz = n[a * 3 + 2] + n[b * 3 + 2];
      const length = Math.hypot(nx, ny, nz) || 1;
      n.push(nx / length, ny / length, nz / length);
      uv.push((uv[a * 2] + uv[b * 2]) * 0.5, (uv[a * 2 + 1] + uv[b * 2 + 1]) * 0.5);
      const ix = Math.floor((x - origin.x) / cs), iy = Math.floor((y - origin.y) / cs), iz = Math.floor((z - origin.z) / cs);
      let best = -1, distance = Infinity;
      for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        if (cx < 0 || cy < 0 || cz < 0 || cx >= d.x || cy >= d.y || cz >= d.z) continue;
        const cell = cx + cy * d.x + cz * d.x * d.y;
        const dist = (cx + 0.5 - (x - origin.x) / cs) ** 2 + (cy + 0.5 - (y - origin.y) / cs) ** 2 + (cz + 0.5 - (z - origin.z) / cs) ** 2;
        if (skin.occupancy[cell] && dist < distance) { best = cell; distance = dist; }
      }
      if (best < 0) best = cellAt(cells, a, d);
      cells.push((best % d.x + 0.5) / d.x, (Math.floor(best / d.x) % d.y + 0.5) / d.y, (Math.floor(best / (d.x * d.y)) + 0.5) / d.z);
      midpoints.set(key, v);
      return v;
    };
    for (const part of parts) {
      const indices = [];
      const split = (a, b, c, depth) => {
        const ab = edgeSq(a, b), bc = edgeSq(b, c), ca = edgeSq(c, a);
        if (depth >= 14 || Math.max(ab, bc, ca) <= limitSq) { indices.push(a, b, c); return; }
        if (ab >= bc && ab >= ca) { const m = midpoint(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
        else if (bc >= ca) { const m = midpoint(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
        else { const m = midpoint(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
      };
      for (let i = 0; i < part.indices.length; i += 3) split(part.indices[i], part.indices[i + 1], part.indices[i + 2], 0);
      part.indices = new Uint32Array(indices);
    }
    if (Array.isArray(p)) {
      p = new Float32Array(p); n = new Float32Array(n); uv = new Float32Array(uv); cells = new Float32Array(cells);
      for (const part of parts) { part.positions = p; part.normals = n; part.uvs = uv; part.cellUV = cells; }
    }
  }
  skin.triangleCount = skin.parts.reduce((sum, part) => sum + part.indices.length / 3, 0);
  skin.vertexCount = [...new Set(skin.parts.map(p => p.positions))].reduce((sum, p) => sum + p.length / 3, 0);
}

export function prepareSkinSurface(skin) {
  if (skin._surface || !skin.supportEdges) return skin._surface;
  subdivideSurface(skin);
  skin._nodeCount = skin.occupancy.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const total = skin.occupancy.length, restEdges = new Map();
  for (let i = 0; i < skin.supportEdges.length; i += 2) restEdges.set(pairKey(skin.supportEdges[i], skin.supportEdges[i + 1], total), i / 2);
  skin._surfaceEdges = restEdges;
  skin._surface = skin.parts.map(part => {
    const groups = [], lookup = new Map(), triangles = part.indices, triGroups = new Uint32Array(triangles.length / 3);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = cellAt(part.cellUV, triangles[i], skin.dims), b = cellAt(part.cellUV, triangles[i + 1], skin.dims), c = cellAt(part.cellUV, triangles[i + 2], skin.dims);
      const anchors = [...new Set([a, b, c])].sort((x, y) => x - y), key = anchors.join(':');
      let id = lookup.get(key);
      if (id === undefined) {
        id = groups.length; lookup.set(key, id);
        const edges = [];
        for (let j = 0; j < anchors.length; j++) for (let k = j + 1; k < anchors.length; k++) {
          const pair = pairKey(anchors[j], anchors[k], total);
          if (restEdges.has(pair)) edges.push(restEdges.get(pair));
        }
        groups.push({ anchors, edges, indices: [] });
      }
      groups[id].indices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
      triGroups[i / 3] = id;
    }
    // Weld only for edge adjacency: preserve all original shading / UV seams.
    const weld = new Uint32Array(part.positions.length / 3), positions = new Map();
    const quant = 1e5 / skin.cellSize;
    let welded = 0;
    for (const vertex of triangles) {
      if (weld[vertex]) continue;
      const p = vertex * 3, key = `${Math.round(part.positions[p] * quant)},${Math.round(part.positions[p + 1] * quant)},${Math.round(part.positions[p + 2] * quant)}`;
      let id = positions.get(key);
      if (id === undefined) { id = ++welded; positions.set(key, id); }
      weld[vertex] = id;
    }
    const pending = new Map(), boundaries = [];
    for (let i = 0; i < triangles.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = triangles[i + e], b = triangles[i + (e + 1) % 3], group = triGroups[i / 3];
      const key = pairKey(weld[a], weld[b], welded + 1), other = pending.get(key);
      if (other) {
        if (other[2] !== group) boundaries.push(other[0], other[1], other[2], group);
        pending.delete(key);
      } else pending.set(key, [a, b, group]);
    }
    // Existing open edges are left intact: only newly torn edges get rims.
    for (const group of groups) group.indices = new Uint32Array(group.indices);
    return { groups, boundaries: new Uint32Array(boundaries) };
  });
  return skin._surface;
}

export function createSurfaceState(skin) {
  return { nodes: null, beams: null, activeNodes: -1, liveBeams: -1,
    alive: new Uint8Array(skin.occupancy.length), edges: new Uint8Array(skin.supportEdges.length / 2),
    links: new Uint8Array(skin.occupancy.length * 4),
    parts: skin._surface.map(p => ({ visible: new Uint8Array(p.groups.length), indices: EMPTY_INDICES, count: 0 })) };
}

export function updateSurfaceState(body, state) {
  if (state.nodes === body.nodes && state.beams === body.beams && state.activeNodes === body.activeNodes && state.liveBeams === body.liveBeams) return false;
  const d = body.skin.dims, total = state.alive.length;
  const cell = n => n.ix + n.iy * d.x + n.iz * d.x * d.y;
  state.alive.fill(0); state.links.fill(0); state.edges.fill(0);
  let edgeCount = 0;
  for (const n of body.nodes) if (n.active) state.alive[cell(n)] = 1;
  for (const beam of body.beams) {
    const a = body.nodes[beam.a], b = body.nodes[beam.b];
    if (beam.broken || !a.active || !b.active) continue;
    const ca = cell(a), cb = cell(b);
    const edge = body.skin._surfaceEdges.get(pairKey(ca, cb, total));
    if (edge !== undefined) { state.edges[edge] = 1; edgeCount++; }
    const dx = b.ix - a.ix, dy = b.iy - a.iy, dz = b.iz - a.iz;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dz) > 1) continue;
    const bit = dx + 1 + (dy + 1) * 3 + (dz + 1) * 9, reverse = 26 - bit;
    state.links[ca * 4 + (bit >> 3)] |= 1 << (bit & 7);
    state.links[cb * 4 + (reverse >> 3)] |= 1 << (reverse & 7);
  }
  const intact = body.activeNodes === body.skin._nodeCount && edgeCount === body.skin.supportEdges.length / 2;
  for (let pi = 0; pi < state.parts.length; pi++) {
    const part = state.parts[pi], source = body.skin.parts[pi], patches = body.skin._surface[pi].groups;
    part.count = 0;
    if (intact) { part.visible.fill(1); part.count = source.indices.length; continue; }
    for (let g = 0; g < patches.length; g++) {
      const group = patches[g];
      let visible = true;
      for (const anchor of group.anchors) if (!state.alive[anchor]) { visible = false; break; }
      if (visible) for (const edge of group.edges) if (!state.edges[edge]) { visible = false; break; }
      part.visible[g] = visible ? 1 : 0;
      if (visible) part.count += group.indices.length;
    }
    // A small wreck gets only its own indices, not a full copy of the GLB.
    // Capacity grows only on repair; ordinary deformation keeps the buffers.
    if (part.indices.length < part.count) part.indices = new Uint32Array(Math.min(source.indices.length, Math.max(part.count, part.indices.length * 2)));
    let cursor = 0;
    for (let g = 0; g < patches.length; g++) if (part.visible[g]) {
      part.indices.set(patches[g].indices, cursor); cursor += patches[g].indices.length;
    }
  }
  state.intact = intact;
  state.nodes = body.nodes; state.beams = body.beams;
  state.activeNodes = body.activeNodes; state.liveBeams = body.liveBeams;
  return true;
}

// Six vertices per newly exposed edge, with inset applied after skin binding.
export function writeTearRims(skin, state, out) {
  let count = 0;
  for (let pi = 0; pi < state.parts.length; pi++) {
    const edges = skin._surface[pi].boundaries, visible = state.parts[pi].visible;
    for (let e = 0; e < edges.length; e += 4) if (visible[edges[e + 2]] !== visible[edges[e + 3]]) count += 6;
  }
  if (count > out.capacity) {
    out.capacity = 2 ** Math.ceil(Math.log2(Math.max(64, count)));
    for (const key of ['positions', 'normals', 'cells', 'insets']) out[key] = new Float32Array(out.capacity * 3);
    out.grew = true;
  } else out.grew = false;
  let cursor = 0;
  const thickness = skin.cellSize * 0.08;
  for (let pi = 0; pi < state.parts.length; pi++) {
    const source = skin.parts[pi], edges = skin._surface[pi].boundaries, visible = state.parts[pi].visible;
    for (let e = 0; e < edges.length; e += 4) {
      if (visible[edges[e + 2]] === visible[edges[e + 3]]) continue;
      const a = edges[e], b = edges[e + 1];
      for (let v = 0; v < 6; v++) {
        const vertex = (v === 0 || v === 3 || v === 5 ? a : b) * 3;
        const inset = v === 2 || v === 4 || v === 5 ? -thickness : 0;
        for (let axis = 0; axis < 3; axis++) {
          out.positions[cursor] = source.positions[vertex + axis];
          out.normals[cursor] = source.normals[vertex + axis];
          out.cells[cursor] = source.cellUV[vertex + axis];
          out.insets[cursor] = source.normals[vertex + axis] * inset;
          cursor++;
        }
      }
    }
  }
  out.count = count;
  return out;
}
