import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDestructorHull as hull } from '../tests/helpers/destructorHull.mjs';
// Optional argument: alternate destructor module in the same source tree.
// Run sequentially against a baseline and current code to avoid CPU contention.
// This measures narrowphase only, including index rebuilds, without damage/GPU.
const moduleUrl = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2])).href
  : new URL('../src/game/destructor.js', import.meta.url).href;
const { DestructorSystem: D, disposeHexBody } = await import(moduleUrl);
for (const mode of ['surface', 'deep', 'deformed', 'miss']) {
  const a = hull({ width: 1280, height: 360, mass: 800000 });
  const b = hull({ width: 640, height: 180, mass: 50000 });
  if (mode === 'deformed') {
    for (const q of a.hexGrid.shards) q.deformation.x = q.targetDeformation.x = 60;
    a.hexGrid._maxHexDrift = 69;
  }
  const offset = mode === 'surface' ? 955 : mode === 'miss' ? 2000 : 40;
  const run = count => {
    let contacts = 0;
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      a.x = a.y = b.y = 0; b.x = offset;
      a.vx = 400; a.vy = b.vx = b.vy = a.angVel = b.angVel = 0;
      if (mode === 'deformed') a.hexGrid.meshRevision++;
      D._frameContacts = 0;
      D.collideEntities(a, b, 1 / 120, false);
      contacts += D._frameContacts;
    }
    return { ms: (performance.now() - start) / count, contacts: contacts / count };
  };
  run(300);
  const samples = Array.from({ length: 5 }, () => run(1000)).sort((a, b) => a.ms - b.ms);
  console.log(JSON.stringify({ mode, shards: a.hexGrid.shards.length + b.hexGrid.shards.length,
    msPerPair: +samples[2].ms.toFixed(4), contacts: samples[2].contacts,
    indexAllocated: !!a.hexGrid._contactSpatialIndex }));
  disposeHexBody(a); disposeHexBody(b);
}
