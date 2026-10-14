// Części modelu broni z weapons3D.js (budowniczy w kodzie) → OBJ dla Blendera: punkt odniesienia A/B w podglądzie
// scripts/blender/<broń>.py --render (lewa połowa zestawień). Materiały OBJ = nazwy wpisów palety (SHIP3D_MAT),
// normalne płaskie jak w grze, oś Z w górę (import w Blenderze: forward Y, up Z).
//
//   node scripts/blender/stary-model-obj.mjs [--rodzina yamato] [--out .tmp/blender/ref]
//
// Wypisuje też trójkąty rodziny scalonej jak w partii wież gry (turretBatch3D.js: pierścień + obudowa + n kopii lufy).
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWeapon3D } from '../../src/3d/ships3d/weapons/weapons3D.js';
import { SHIP3D_MAT } from '../../src/3d/ships3d/meshBuilder3D.js';
import { buildTurretFamilyArrays } from '../../src/3d/ships3d/turretBatch3D.js';

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const family = arg('--rodzina', 'yamato');
const out = resolve(arg('--out', '.tmp/blender/ref'));
mkdirSync(out, { recursive: true });
const NAMES = Object.fromEntries(Object.entries(SHIP3D_MAT).map(([k, v]) => [v, k]));

const fa = buildTurretFamilyArrays(family);
console.log(`${family}: rodzina scalona ${fa.index.length / 3} trójkątów, ${fa.vertexCount} wierzchołków`);
const model = buildWeapon3D(family);
console.log('układ:', JSON.stringify({ trunnion: model.trunnion, barrels: model.barrels, barrelShift: model.barrelShift, muzzleX: model.muzzleX, pitch: model.pitch }));

for (const part of ['ring', 'housing', 'barrel', 'spin']) {
  if (!model.parts[part]) continue;
  const d = model.parts[part].build();
  const lines = [`# ${family} ${part} (weapons3D.js)`, `o old_${part}`];
  for (let i = 0; i < d.vertexCount; i++) lines.push(`v ${d.position[i * 3]} ${d.position[i * 3 + 1]} ${d.position[i * 3 + 2]}`);
  for (let i = 0; i < d.vertexCount; i++) lines.push(`vn ${d.normal[i * 3]} ${d.normal[i * 3 + 1]} ${d.normal[i * 3 + 2]}`);
  const byMat = new Map();
  for (let t = 0; t < d.index.length; t += 3) {
    const m = d.mat[d.index[t]];
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push([d.index[t], d.index[t + 1], d.index[t + 2]]);
  }
  for (const [m, tris] of byMat) {
    lines.push(`usemtl ${NAMES[m]}`);
    for (const [a, b, c] of tris) lines.push(`f ${a + 1}//${a + 1} ${b + 1}//${b + 1} ${c + 1}//${c + 1}`);
  }
  writeFileSync(`${out}/old_${part}.obj`, lines.join('\n') + '\n');
  console.log(`${part}: ${d.triangleCount} trójkątów → ${out}/old_${part}.obj`);
}
