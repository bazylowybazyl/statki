// Iterative bridge search over beam adjacency, with reusable numeric buffers.
// Run at import and on topology changes, never per solver iteration.
export function beamConnectivityScratch(nodes, beams, previous = null) {
  if (previous && previous.order.length >= nodes && previous.bridges.length >= beams) return previous;
  return { order: new Int32Array(nodes), low: new Int32Array(nodes), parent: new Int32Array(nodes),
    cursor: new Int32Array(nodes), stack: new Int32Array(nodes), bridges: new Uint8Array(beams) };
}

export function findBeamBridges(nodes, beams, scratch) {
  const { order, low, parent, cursor, stack, bridges } = scratch;
  order.fill(0); parent.fill(-1); cursor.fill(0); bridges.fill(0);
  let time = 0;
  for (let root = 0; root < nodes.length; root++) {
    if (!nodes[root].active || order[root]) continue;
    let top = 0;
    stack[0] = root; order[root] = low[root] = ++time;
    while (top >= 0) {
      const node = stack[top], adjacent = nodes[node].beams;
      if (cursor[node] < adjacent.length) {
        const edge = adjacent[cursor[node]++], beam = beams[edge];
        if (!beam || beam.broken || edge === parent[node]) continue;
        const other = beam.a === node ? beam.b : beam.a;
        if (!nodes[other].active) continue;
        if (!order[other]) {
          parent[other] = edge; order[other] = low[other] = ++time;
          stack[++top] = other;
        } else low[node] = Math.min(low[node], order[other]);
      } else {
        top--;
        const edge = parent[node];
        if (edge < 0) continue;
        const beam = beams[edge], other = beam.a === node ? beam.b : beam.a;
        if (low[node] > order[other]) bridges[edge] = 1;
        low[other] = Math.min(low[other], low[node]);
      }
    }
  }
  return bridges;
}

export function markOriginalBeamBridges(nodes, beams) {
  const scratch = beamConnectivityScratch(nodes.length, beams.length);
  const bridges = findBeamBridges(nodes, beams, scratch);
  for (let i = 0; i < beams.length; i++) beams[i].restBridge = bridges[i] === 1;
}
