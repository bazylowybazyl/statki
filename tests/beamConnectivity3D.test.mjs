import test from 'node:test';
import assert from 'node:assert/strict';
import { beamConnectivityScratch, findBeamBridges, markOriginalBeamBridges } from '../src/game/beamConnectivity3D.js';

function graph(count, edges) {
  const nodes = Array.from({ length: count }, () => ({ active: true, beams: [] }));
  const beams = edges.map(([a, b], index) => {
    nodes[a].beams.push(index); nodes[b].beams.push(index);
    return { a, b, broken: false };
  });
  return { nodes, beams };
}

test('po utracie usztywnienia wykrywa ostatnie połączenie pomiędzy sekcjami', () => {
  const { nodes, beams } = graph(6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [1, 3], [2, 4]]);
  markOriginalBeamBridges(nodes, beams);
  assert.ok(beams.every(b => !b.restBridge));
  const scratch = beamConnectivityScratch(nodes.length, beams.length);
  beams[7].broken = true;
  assert.deepEqual([...findBeamBridges(nodes, beams, scratch)], [0, 0, 0, 0, 0, 0, 1, 0]);
  beams[6].broken = true;
  assert.ok(findBeamBridges(nodes, beams, scratch).every(v => !v), 'osobne sekcje nadal mają usztywnienie');
  assert.equal(beamConnectivityScratch(3, 3, scratch), scratch, 'bufory muszą być używane ponownie');
});

test('rozróżnia pierwotną pojedynczą podporę, równoległe belki i nieaktywne węzły', () => {
  const { nodes, beams } = graph(5, [[0, 1], [0, 1], [1, 2], [2, 3], [3, 4], [4, 2]]);
  markOriginalBeamBridges(nodes, beams);
  assert.deepEqual(beams.map(b => b.restBridge), [false, false, true, false, false, false]);
  nodes[3].active = false;
  const bridges = findBeamBridges(nodes, beams, beamConnectivityScratch(5, 6));
  assert.deepEqual([...bridges], [0, 0, 1, 0, 0, 1]);
});

test('długa konstrukcja nie przepełnia stosu wywołań', () => {
  const count = 20000;
  const { nodes, beams } = graph(count, Array.from({ length: count - 1 }, (_, i) => [i, i + 1]));
  const bridges = findBeamBridges(nodes, beams, beamConnectivityScratch(count, count - 1));
  assert.ok(bridges.every(v => v === 1));
});
