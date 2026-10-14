// scripts/blender/k7/k7-inwentarz.mjs
//
// INWENTARZ HALI K-7 (pilot „hala K-7 z Blendera”, docs/PILOT-blender-k7.md): co składa się na halę
// (haloPortK7Build.js — instancje prostopadłościan / walec / torus w zestawach bg / fg / roof, płyty, napisy,
// przewody), ile to trójkątów i draw calli, jak duże są bryły każdej sekcji na ekranie przy zoomach gry z góry
// (zoom = piksele na jednostkę świata; kamera gry z góry, ortho).
//
//   node scripts/blender/k7/k7-inwentarz.mjs [--out .tmp/blender/k7/inwentarz.json]
//
// Sekcje = K7_TAGS (Recorder.tag w haloPortK7Build.js). Trójkąty siatek bazowych jak w haloPortK7.js:
// BoxGeometry 12, CylinderGeometry(1, 1, 1, 16, 1) 64, TorusGeometry(1, 0,13, 6, 24) 288.
import fs from 'node:fs';
import path from 'node:path';
import { buildK7Scene, K7_TAGS, K7_INSTANCE_STRIDE } from '../../../src/3d/haloRing/haloPortK7Build.js';
import { createK7Layout, k7Frame } from '../../../src/3d/haloRing/haloPortK7Layout.js';
import { createHaloRingLayout } from '../../../src/3d/haloRing/haloRingLayout.js';
import { resolveHaloProfile } from '../../../src/3d/haloRing/haloRingProfiles.js';
import { K7_HOSE_NODES } from '../../../src/3d/haloRing/haloPortK7Fuel.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', '.tmp/blender/k7/inwentarz.json');

const TRIS = { box: 12, cyl: 64, torus: 288 };
const ZOOMS = [0.22, 0.5, 1, 2];

function sceneFor(planet, extra = {}) {
  const ring = createHaloRingLayout({ profile: planet });
  const f = k7Frame(ring);
  const style = resolveHaloProfile(planet).port;
  return buildK7Scene(createK7Layout(), { floorZ: f.floorZ, rimZ: f.rimZ, floorR: f.floorR, style, ...extra });
}

// rozmiar bryły w poziomie (rzut z góry): największy wymiar po obrocie kwaternionem
function footprint(data, i, kind) {
  const sx = data[i + 4], sy = data[i + 5], sz = data[i + 6];
  const q = [data[i + 8], data[i + 9], data[i + 10], data[i + 11]];
  const rot = (v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const e = kind === 'box' ? 0.5 : 1;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const a of [-e, e]) for (const b of [-0.5, 0.5]) for (const c of [-e, e]) {
    const v = rot([a * sx, b * sy, c * sz]);
    x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]);
  }
  return { long: Math.max(x1 - x0, z1 - z0), short: Math.min(x1 - x0, z1 - z0) };
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function plateTris(plates) {
  let t = 0;
  for (const p of plates) { const n = p.points.length; t += 2 * (n - 2) + 2 * n; }
  return t;
}

const report = { date: new Date().toISOString(), planets: {} };
for (const planet of ['earth', 'mars', 'jupiter']) {
  const stats = {};
  const s = sceneFor(planet, { stats });
  let inst = 0, tris = 0;
  const meshes = [];
  for (const [set, kinds] of Object.entries(s.sets)) for (const [kind, data] of Object.entries(kinds)) {
    const n = data.length / K7_INSTANCE_STRIDE;
    if (!n) continue;
    meshes.push(`${set}_${kind}`);
    inst += n;
    tris += n * TRIS[kind];
  }
  const bgPlates = s.plates.filter((p) => p.set !== 'roof');
  const roofPlates = s.plates.filter((p) => p.set === 'roof');
  const hoseTris = s.fuel.length * 72 * 10 * 2;
  const drawCalls = meshes.length + 2 + (s.labels.length ? 1 : 0) + 1;
  const sections = {};
  for (const tag of K7_TAGS) {
    // dane tylko tej sekcji: pomiń wszystkie inne
    const only = sceneFor(planet, { skipTags: K7_TAGS.filter((t) => t !== tag) });
    const sec = { instances: 0, tris: 0, sets: {}, longMedian: 0, longMax: 0, shortMedian: 0 };
    const longs = [];
    const shorts = [];
    for (const [set, kinds] of Object.entries(only.sets)) for (const [kind, data] of Object.entries(kinds)) {
      const n = data.length / K7_INSTANCE_STRIDE;
      if (!n) continue;
      sec.instances += n;
      sec.tris += n * TRIS[kind];
      sec.sets[`${set}/${kind}`] = n;
      for (let i = 0; i < data.length; i += K7_INSTANCE_STRIDE) {
        const fp = footprint(data, i, kind);
        longs.push(fp.long);
        shorts.push(fp.short);
      }
    }
    if (!sec.instances) continue;
    sec.longMedian = Math.round(median(longs));
    sec.longMax = Math.round(Math.max(...longs));
    sec.shortMedian = Math.round(median(shorts));
    sec.px = Object.fromEntries(ZOOMS.map((z) => [z, { medianLong: +(sec.longMedian * z).toFixed(1), maxLong: +(sec.longMax * z).toFixed(1), medianShort: +(sec.shortMedian * z).toFixed(1) }]));
    sections[tag] = sec;
  }
  report.planets[planet] = {
    instances: inst,
    instanceTris: tris,
    plateTris: { bg: plateTris(bgPlates), roof: plateTris(roofPlates) },
    labels: s.labels.length,
    labelTris: s.labels.length * 2,
    hoseTris,
    hoseNodes: K7_HOSE_NODES,
    totalTris: tris + plateTris(s.plates) + s.labels.length * 2 + hoseTris,
    meshes,
    drawCalls,
    groups: s.groups.length,
    fuelStations: s.fuel.length,
    sections
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

// tabela na konsolę (Ziemia; Mars i Jowisz różnią się dachem i ścianami z zewnątrz)
for (const [planet, r] of Object.entries(report.planets)) {
  console.log(`\n== ${planet}: instancje ${r.instances}, trójkąty instancji ${r.instanceTris}, płyty ${r.plateTris.bg}+${r.plateTris.roof}, napisy ${r.labels}, przewody ${r.hoseTris}, RAZEM ${r.totalTris}; draw calle hali ${r.drawCalls} (${r.meshes.join(' ')} + płyty bg, dach, napisy, przewody)`);
  if (planet !== 'earth') {
    for (const tag of ['roof', 'outer-walls']) {
      const sec = r.sections[tag];
      if (sec) console.log(`   ${tag}: ${sec.instances} instancji, ${sec.tris} tr.`);
    }
    continue;
  }
  console.log('sekcja'.padEnd(18), 'inst'.padStart(5), 'tr.'.padStart(7), 'dł. med/max [j.]'.padStart(18), 'px@0.22'.padStart(9), 'px@0.5'.padStart(8), 'px@1'.padStart(8), 'px@2'.padStart(8), '  zestawy');
  for (const [tag, sec] of Object.entries(r.sections)) {
    const p = (z) => `${sec.px[z].medianLong}`;
    console.log(tag.padEnd(18), String(sec.instances).padStart(5), String(sec.tris).padStart(7),
      `${sec.longMedian}/${sec.longMax}`.padStart(18), p(0.22).padStart(9), p(0.5).padStart(8), p(1).padStart(8), p(2).padStart(8), '  ' + JSON.stringify(sec.sets));
  }
}
console.log('\nzapis:', OUT);
