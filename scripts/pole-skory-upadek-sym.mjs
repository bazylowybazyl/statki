// SONDA POLA SKÓRY w Node na prawdziwej sekwencji upadku bazy piratów (2026-10-29, docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md
// § 8): uruchamia scripts/destrukcja-taran-sym.mjs (--tryb upadek) z opakowanym HullBodies.step i po każdym kroku, dla
// każdego ciała świata, liczy to, co zrobiłby writeHullSkinField (src/3d/ships3d/hullSkin3D.js): komórki zmienione o
// > 0,02 j. względem ostatniego zapisu, zakres lo..hi slotu, zakresy po scaleniu przerw (posortowane indeksy, model
// kosztu 2,5 µs na writeBuffer + 0,1 µs/KB) i to samo po odjęciu ruchu sztywnego dopasowanego metodą Horna (środki
// komórek → węzły w układzie ciała). Raz na sekundę symulacji — wiersz [skóra] i wiersz zakresów.
//
//   node scripts/pole-skory-upadek-sym.mjs --tryb upadek --warianty stoi --dt 60 --hp0 2 --czas 25
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import(pathToFileURL(repo + '/src/game/hullBodies.js').href);

const TH = 0.02;
const per = new Map();   // body → { last, lastR, box }
let acc = null;
const GAPS = [0, 16, 64, 256, 1024, 4096];
const LIS = new Int32Array(1 << 20);
const resetAcc = () => { acc = { steps: 0, awake: 0, nodesAwake: 0, raw: 0, rawRange: 0, rig: 0, rigRange: 0, rigMax: 0, angSum: 0, angN: 0, tDisp: 0, bodies: 0, kinds: {},
  nonMono: 0, gapR: GAPS.map(() => 0), gapC: GAPS.map(() => 0), bodiesWrote: 0 }; };
const runLo = new Float64Array(GAPS.length), runHi = new Float64Array(GAPS.length);
resetAcc();

// największy wektor własny symetrycznej 4×4 (Jacobi)
function maxEig4(N) {
  const a = N.map((r) => r.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

function probe(hull) {
  const body = hull.body;
  if (!body || body.dead || !hull.world) return;
  const s = body.nodeStore, lm = body.latticeMin, cs = body.cellSize;
  let P = per.get(body);
  if (!P || P.storeCount !== s.count) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      if (s.ix[i] < x0) x0 = s.ix[i]; if (s.ix[i] > x1) x1 = s.ix[i];
      if (s.iy[i] < y0) y0 = s.iy[i]; if (s.iy[i] > y1) y1 = s.iy[i];
      if (s.iz[i] < z0) z0 = s.iz[i]; if (s.iz[i] > z1) z1 = s.iz[i];
    }
    P = { storeCount: s.count, last: new Float64Array(s.count * 4).fill(-1e9), lastR: new Float64Array(s.count * 4).fill(-1e9),
      box: { x0, y0, z0, dx: x1 - x0 + 1, dy: y1 - y0 + 1 } };
    per.set(body, P);
  }
  acc.bodies++;
  if (body.isSleeping) return;
  acc.awake++;
  // ruch sztywny: Horn (źródło = środki komórek, cel = węzły)
  let n = 0, cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    n++;
    cx += lm.x + (s.ix[i] + 0.5) * cs; cy += lm.y + (s.iy[i] + 0.5) * cs; cz += lm.z + (s.iz[i] + 0.5) * cs;
    px += s.x[i]; py += s.y[i]; pz += s.z[i];
  }
  if (!n) return;
  acc.nodesAwake += n;
  cx /= n; cy /= n; cz /= n; px /= n; py /= n; pz /= n;
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ax = lm.x + (s.ix[i] + 0.5) * cs - cx, ay = lm.y + (s.iy[i] + 0.5) * cs - cy, az = lm.z + (s.iz[i] + 0.5) * cs - cz;
    const bx = s.x[i] - px, by = s.y[i] - py, bz = s.z[i] - pz;
    Sxx += ax * bx; Sxy += ax * by; Sxz += ax * bz;
    Syx += ay * bx; Syy += ay * by; Syz += ay * bz;
    Szx += az * bx; Szy += az * by; Szz += az * bz;
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]
  ];
  const [qw, qx, qy, qz] = maxEig4(N);
  const R = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)
  ];
  const ang = 2 * Math.acos(Math.min(1, Math.abs(qw)));
  acc.angSum += ang; acc.angN++;
  const tx = px - (R[0] * cx + R[1] * cy + R[2] * cz), ty = py - (R[3] * cx + R[4] * cy + R[5] * cz), tz = pz - (R[6] * cx + R[7] * cy + R[8] * cz);
  acc.tDisp += Math.sqrt(tx * tx + ty * ty + tz * tz);
  const { box } = P;
  let lo = Infinity, hi = -1, loR = Infinity, hiR = -1, raw = 0, rig = 0, prevLi = -1;
  runLo.fill(-1); runHi.fill(-1);
  for (let i = 0; i < s.count; i++) {
    const li = (s.ix[i] - box.x0) + (s.iy[i] - box.y0) * box.dx + (s.iz[i] - box.z0) * box.dx * box.dy;
    const o = i * 4;
    let dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0, st = 0;
    if (s.active[i]) {
      const Cx = lm.x + (s.ix[i] + 0.5) * cs, Cy = lm.y + (s.iy[i] + 0.5) * cs, Cz = lm.z + (s.iz[i] + 0.5) * cs;
      dx = s.x[i] - Cx; dy = s.y[i] - Cy; dz = s.z[i] - Cz;
      rx = s.x[i] - (R[0] * Cx + R[1] * Cy + R[2] * Cz + tx);
      ry = s.y[i] - (R[3] * Cx + R[4] * Cy + R[5] * Cz + ty);
      rz = s.z[i] - (R[6] * Cx + R[7] * Cy + R[8] * Cz + tz);
      st = 1;
    }
    const L = P.last, LR = P.lastR;
    if (!(Math.abs(L[o] - dx) < TH && Math.abs(L[o + 1] - dy) < TH && Math.abs(L[o + 2] - dz) < TH && L[o + 3] === st)) {
      L[o] = dx; L[o + 1] = dy; L[o + 2] = dz; L[o + 3] = st; raw++;
      if (li < lo) lo = li; if (li > hi) hi = li;
      if (li < prevLi) acc.nonMono++;
      prevLi = li;
      LIS[raw - 1] = li;
    }
    if (!(Math.abs(LR[o] - rx) < TH && Math.abs(LR[o + 1] - ry) < TH && Math.abs(LR[o + 2] - rz) < TH && LR[o + 3] === st)) {
      LR[o] = rx; LR[o + 1] = ry; LR[o + 2] = rz; LR[o + 3] = st; rig++;
      if (li < loR) loR = li; if (li > hiR) hiR = li;
      const m = Math.max(Math.abs(rx), Math.abs(ry), Math.abs(rz));
      if (m > acc.rigMax) acc.rigMax = m;
    }
  }
  if (raw > 0) {
    const L2 = LIS.subarray(0, raw).sort();
    for (let g = 0; g < GAPS.length; g++) {
      let a = L2[0], b = L2[0];
      for (let k = 1; k < raw; k++) {
        const li = L2[k];
        if (li <= b + GAPS[g] + 1) { b = li; continue; }
        acc.gapR[g]++; acc.gapC[g] += b - a + 1; a = b = li;
      }
      acc.gapR[g]++; acc.gapC[g] += b - a + 1;
    }
  }
  if (raw > 0) acc.bodiesWrote++;
  acc.raw += raw; acc.rig += rig;
  if (hi >= lo) acc.rawRange += hi - lo + 1;
  if (hiR >= loR) acc.rigRange += hiR - loR + 1;
  const k = (body.planar ? 'P' : '3D');
  const kk = acc.kinds[k] || (acc.kinds[k] = { awake: 0, raw: 0, rig: 0 });
  kk.awake++; kk.raw += raw; kk.rig += rig;
}

const origStep = HullBodies.step.bind(HullBodies);
let stepN = 0;
const firstStepNoted = { t: -1 };
HullBodies.step = function (dt, ents) {
  origStep(dt, ents);
  const hs = HullBodies._hulls;
  for (let k = 0; k < hs.length; k++) probe(hs[k]);
  acc.steps++;
  stepN++;
  if (stepN % 60 === 0) {
    const st = acc.steps || 1;
    if (acc.awake > 0) {
      console.log(`[skóra] t=${(stepN / 60).toFixed(0)}s ciała ${(acc.bodies / st).toFixed(0)} budzone ${(acc.awake / st).toFixed(1)} węzły ${(acc.nodesAwake / st).toFixed(0)} | ` +
        `surowe: komórki ${(acc.raw / st).toFixed(0)}/krok, zakres ${(acc.rawRange / st).toFixed(0)} (${(acc.rawRange / st * 16 / 1024).toFixed(0)} KB) | ` +
        `po ruchu sztywnym: ${(acc.rig / st).toFixed(0)}/krok, zakres ${(acc.rigRange / st).toFixed(0)} (${(acc.rigRange / st * 16 / 1024).toFixed(0)} KB), maks. reszta ${acc.rigMax.toFixed(2)} | ` +
        `kąt śr. ${(acc.angN ? acc.angSum / acc.angN * 180 / Math.PI : 0).toFixed(2)}°, |t| śr. ${(acc.angN ? acc.tDisp / acc.angN : 0).toFixed(2)} | ` +
        Object.entries(acc.kinds).map(([k, v]) => `${k}: bud ${(v.awake / st).toFixed(1)} sur ${(v.raw / st).toFixed(0)} szt ${(v.rig / st).toFixed(0)}`).join(', '));
      console.log(`         zakresy (ciała z zapisem ${(acc.bodiesWrote / st).toFixed(1)}, niemonotoniczne ${acc.nonMono}): ` +
        GAPS.map((g, k) => `≤${g}: ${(acc.gapR[k] / st).toFixed(0)} zakr. ${(acc.gapC[k] / st * 16 / 1024).toFixed(0)} KB ~${((acc.gapR[k] / st) * 2.5 + (acc.gapC[k] / st * 16 / 1024) * 0.1).toFixed(0)}µs`).join(' | ') + ` | dziś: ${(acc.bodiesWrote / st).toFixed(0)} zakr. ${(acc.rawRange / st * 16 / 1024).toFixed(0)} KB ~${((acc.bodiesWrote / st) * 2.5 + (acc.rawRange / st * 16 / 1024) * 0.1).toFixed(0)}µs`);
    }
    resetAcc();
  }
};

process.argv = [process.argv[0], repo + '/scripts/destrukcja-taran-sym.mjs', ...process.argv.slice(2)];
await import(pathToFileURL(repo + '/scripts/destrukcja-taran-sym.mjs').href);
