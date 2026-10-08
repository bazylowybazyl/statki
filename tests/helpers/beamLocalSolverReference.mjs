// Wzorzec bit w bit solvera lokalnego silnika belek sprzed optymalizacji 2026-10-07 (scalone przebiegi obszaru,
// kernele 2D płaskiego ciała, pamięć wag więzów): dawne DestructorBeams3D._solveLocal, prepareBeamConstraints
// i projectBeamConstraints skopiowane bez zmian. Test podstawia referenceSolveLocal jako D._solveLocal
// (wołane z this = D) i porównuje stan kroku po kroku z bieżącym kodem (tests/beamLocalSolverExact.test.mjs).
import { activeRegion, activateNode, markSkinDirty } from '../../src/game/beamActiveRegion3D.js';
import { beamSolverScratch } from '../../src/game/beamConstraintSolver3D.js';
import { extendBeamBounds } from '../../src/game/beamBounds3D.js';

function matVec(m, x, y, z, o) {
  o.x = m[0] * x + m[1] * y + m[2] * z;
  o.y = m[3] * x + m[4] * y + m[5] * z;
  o.z = m[6] * x + m[7] * y + m[8] * z;
  return o;
}

export function referencePrepareBeamConstraints(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq) {
  const p = s.positions, w = s.weights, active = s.active;
  const ea = beams.a, eb = beams.b, broken = beams.broken, type = beams.type;
  const restArr = beams.rest, restBase = beams.restBase, deform = beams.deform, brk = beams.brk;
  const strainArr = beams.strain, fatigue = beams.fatigue, stiffnessArr = beams.stiffness;
  const breakOn = (cfg.breakEnabled | 0) === 1;
  const stiffMul = cfg.globalStiffnessMul, breakMul = cfg.globalBreakMul;
  const total = list ? listCount : beams.count;
  let count = 0, brokenNow = 0;
  s.deformed = false;
  // Damage is measured before ANY projection, using the same beam order.
  for (let k = 0; k < total; k++) {
    const e = list ? list[k] : k;
    const a = ea[e], b = eb[e];
    if (broken[e] || !active[a] || !active[b]) continue;
    if (breakOn && type[e] >= 2 && (s.mountFailed[a] || s.mountFailed[b])) {
      broken[e] = 1; brokenNow++; continue;
    }
    const ia = a * 3, ib = b * 3;
    const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rest = restArr[e];
    const C = len - rest, strain = C / rest, absStrain = Math.abs(strain);
    strainArr[e] = strain;
    if (breakOn) {
      const limit = brk[e] * breakMul;
      if (absStrain > deform[e]) fatigue[e] = (fatigue[e] || 0) +
        (absStrain - deform[e]) / limit * cfg.plasticFatigue * dt * 60;
      if (Math.max(absStrain, Math.abs(len - restBase[e]) / restBase[e]) > limit || fatigue[e] >= 1) {
        broken[e] = 1;
        brokenNow++;
        continue;
      }
    }
    if (absStrain > deform[e]) {
      const over = C - Math.sign(C) * deform[e] * rest;
      restArr[e] = Math.max(restBase[e] * (1 - cfg.maxRestDrift),
        Math.min(restBase[e] * (1 + cfg.maxRestDrift), rest + over * plasticRate));
      s.deformed = true;
    }
    const wsum = w[a] + w[b];
    if (wsum <= 0) continue;
    const stiffness = Math.min(1, stiffnessArr[e] * stiffMul);
    const kk = stiffness / (stiffness + (1 - stiffness) / stepScaleSq);
    s.a[count] = a; s.b[count] = b;
    s.rest[count] = restArr[e]; s.factor[count++] = kk / wsum;
  }
  s.count = count;
  return brokenNow;
}

export function referenceProjectBeamConstraints(s, count, iterations) {
  const p = s.positions, w = s.weights, a = s.a, b = s.b, rest = s.rest, factor = s.factor;
  let solved = 0;
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < count; j++) {
      const na = a[j], nb = b[j], ia = na * 3, ib = nb * 3;
      const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      const corr = ((len - rest[j]) / len) * factor[j];
      const cx = dx * corr, cy = dy * corr, cz = dz * corr;
      const wa = w[na], wb = w[nb];
      p[ia] += cx * wa; p[ia + 1] += cy * wa; p[ia + 2] += cz * wa;
      p[ib] -= cx * wb; p[ib + 1] -= cy * wb; p[ib + 2] -= cz * wb;
      solved++;
    }
  }
  return solved;
}

export function referenceSolveLocal(body, dt, iterations, damp, plasticRate, stepScaleSq) {
  this._localSolved = 0;
  const cfg = this.config;
  const region = activeRegion(body);
  const list = region.list;
  if (list.length === 0) {
    body.isSleeping = true;
    body.wakeHold = 0;
    return 0;
  }
  body.isSleeping = false;
  const s = body.nodeStore, e = body.beamStore;
  const x = s.x, y = s.y, z = s.z, px = s.px, py = s.py, pz = s.pz;
  const vx = s.vx, vy = s.vy, vz = s.vz, ox = s.ox, oy = s.oy, oz = s.oz;
  const mass = s.mass, invMass = s.invMass, active = s.active;
  const act = s.act, quiet = s.quiet, skinDirty = s.skinDirty;
  const solveStamp = s.solveStamp, outerStamp = s.outerStamp;
  const adjStart = s.adjStart, adj = s.adj;
  const ea = e.a, eb = e.b, broken = e.broken, beamStamp = e.stamp;
  const scratch = beamSolverScratch(body);
  const P = scratch.positions, W = scratch.weights, solverActive = scratch.active;
  let stamp = (this._regionStamp + 1) | 0;
  if (stamp <= 0) stamp = 1;
  this._regionStamp = stamp;

  // 1) A ∪ F: aktywne węzły i ich sąsiedzi przez całe belki.
  const solve = region.solve;
  let sCount = 0;
  for (let r = 0; r < list.length; r++) {
    const i = list[r];
    if (!active[i] || solveStamp[i] === stamp) continue;
    solveStamp[i] = stamp;
    solve[sCount++] = i;
  }
  const aCount = sCount;
  for (let k = 0; k < aCount; k++) {
    const i = solve[k];
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (broken[bi]) continue;
      const o = ea[bi] === i ? eb[bi] : ea[bi];
      if (!active[o] || solveStamp[o] === stamp) continue;
      solveStamp[o] = stamp;
      solve[sCount++] = o;
    }
  }

  // Sąsiad z poprzedniego kroku, który wypadł z obliczeń, zamraża resztkowe napięcie
  // belek do nieliczonych węzłów. Po powrocie do obszaru to napięcie strzelało skokiem
  // prędkości i znów budziło okolicę (obszar nigdy nie zasypiał). Jego stan to stan
  // równowagi — przyjmujemy go jako spoczynkowy.
  for (let k = 0; k < region.frontierCount; k++) {
    const i = region.frontier[k];
    if (!active[i] || solveStamp[i] === stamp) continue;
    this._bakeRest(body, i, stamp);
  }

  // 2) Belki kroku i pierścień O (drugi koniec poza A ∪ F — nieruchomy).
  const constraints = region.constraints;
  let cCount = 0;
  const outer = region.outer;
  let oCount = 0;
  for (let k = 0; k < sCount; k++) {
    const i = solve[k];
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (broken[bi] || beamStamp[bi] === stamp) continue;
      beamStamp[bi] = stamp;
      const o = ea[bi] === i ? eb[bi] : ea[bi];
      if (!active[o]) continue;
      constraints[cCount++] = bi;
      if (solveStamp[o] !== stamp && outerStamp[o] !== stamp) {
        outerStamp[o] = stamp;
        outer[oCount++] = o;
      }
    }
  }
  region.constraintCount = cCount;

  // 3) Predykcja A ∪ F z prędkości; pierścień w bieżącym miejscu, z wagą 0.
  for (let k = 0; k < sCount; k++) {
    const i = solve[k], j = i * 3;
    px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
    P[j] = x[i] + vx[i] * dt;
    P[j + 1] = y[i] + vy[i] * dt;
    P[j + 2] = z[i] + vz[i] * dt;
    W[i] = invMass[i];
    solverActive[i] = 1;
  }
  for (let k = 0; k < oCount; k++) {
    const i = outer[k], j = i * 3;
    P[j] = x[i]; P[j + 1] = y[i]; P[j + 2] = z[i];
    W[i] = 0;
    solverActive[i] = 1;
  }
  // Mocowania wręgów i grodzi tylko dla węzłów kroku i tylko po zmianie struktury —
  // pełne refreshBeamMounts przeliczało wszystkie belki kadłuba po każdym zerwaniu.
  // Zerwanie i śmierć węzła aktywują dotknięte węzły, więc trafiają do tego obszaru.
  if (cfg.breakEnabled && (region.mountLive !== body.liveBeams || region.mountActive !== body.activeNodes)) {
    this._refreshMountsLocal(body, scratch, solve, sCount);
    this._refreshMountsLocal(body, scratch, outer, oCount);
    region.mountLive = body.liveBeams;
    region.mountActive = body.activeNodes;
  }

  // 4) Odkształcenie i zerwania mierzone na belkach kroku, potem rzutowanie.
  const brokenNow = referencePrepareBeamConstraints(scratch, e, constraints, cCount, cfg, dt, plasticRate, stepScaleSq);
  if (scratch.deformed) {
    body.meshDirty = true;
    // Plastyczność zmienia cieniowanie także węzłów pierścienia (ich belki do obszaru).
    for (let k = 0; k < oCount; k++) markSkinDirty(body, outer[k]);
  }
  if (brokenNow) {
    body.liveBeams = Math.max(0, body.liveBeams - brokenNow);
    body.structureDirty = true;
    body.meshDirty = true;
    if (!body.noSplit && !this.splitQueue.includes(body)) this.splitQueue.push(body);
    // Brzeg rany zderzenia: belki zerwane tuż po styku rozżarzają oba końce do poziomu zderzenia.
    const woundNow = body._woundHeat > 0 ? this.clock() : 0;
    const wound = woundNow > 0 && woundNow - body._woundHeatAt <= cfg.heatWoundWindow ? body._woundHeat : 0;
    // Koniec zerwanej belki na pierścieniu traci oparcie — też rusza.
    for (let c = 0; c < cCount; c++) {
      const bi = constraints[c];
      if (!broken[bi]) continue;
      activateNode(body, ea[bi]);
      activateNode(body, eb[bi]);
      if (wound > 0.02) {
        this._heatWound(body, ea[bi], wound, woundNow);
        this._heatWound(body, eb[bi], wound, woundNow);
      }
    }
  }
  this._localSolved = referenceProjectBeamConstraints(scratch, scratch.count, iterations);

  // 5) Zapis A ∪ F, impuls więzów J (reakcja pierścienia = −J), aktywność.
  const planar = !!cfg.planar;
  const invDt = 1 / dt;
  const threshold = cfg.activeMotionThreshold;
  const mm = body._boundsMinMax;
  let jx = 0, jy = 0, jz = 0;       // impuls więzów na A ∪ F
  let qx = 0, qy = 0, qz = 0;       // pęd uspokojonych węzłów oddawany ciału
  let drift = 0;
  for (let k = 0; k < sCount; k++) {
    const i = solve[k], j = i * 3;
    const nx = P[j], ny = P[j + 1], nz = planar ? oz[i] : P[j + 2];
    const wx = (nx - px[i]) * invDt, wy = (ny - py[i]) * invDt, wz = (nz - pz[i]) * invDt;
    const m = mass[i];
    jx += m * (wx - vx[i]); jy += m * (wy - vy[i]); jz += m * (wz - vz[i]);
    // Tłumienie to tarcie wewnętrzne: pęd, który zabiera węzłom, przejmuje kadłub.
    // Pełny solver ma prędkości węzłów o zerowej średniej, więc tam tłumienie pędu nie
    // zmienia; tu bez tego samo wgniecenie (pchnięcie pozycji) rozpędzało statek.
    const lost = m * (1 - damp);
    qx += lost * wx; qy += lost * wy; qz += lost * wz;
    drift += m * (Math.abs(nx - px[i]) + Math.abs(ny - py[i]) + Math.abs(nz - pz[i]));
    x[i] = nx; y[i] = ny; z[i] = nz;
    vx[i] = wx * damp; vy[i] = wy * damp; vz[i] = wz * damp;
    if (!skinDirty[i]) { skinDirty[i] = 1; region.dirty[region.dirtyCount++] = i; }
    const disp = Math.max(Math.abs(nx - ox[i]), Math.abs(ny - oy[i]), Math.abs(nz - oz[i]));
    if (disp > body._maxDisp) body._maxDisp = disp;
    // Obrys tylko rośnie (extendBeamBounds); dokładny wraca przy wyrównaniu środka.
    if (nx < mm[0] || nx > mm[3] || ny < mm[1] || ny > mm[4] || nz < mm[2] || nz > mm[5] ||
        nx * nx + ny * ny + nz * nz > body._boundsR2) extendBeamBounds(body, nx, ny, nz);
    if (Math.abs(vx[i]) + Math.abs(vy[i]) + Math.abs(vz[i]) > threshold) activateNode(body, i);
    else if (act[i]) quiet[i]++;
    else {
      // Sąsiad, który się nie rozpędził: węzły poza obszarem spoczywają w układzie ciała.
      qx += m * vx[i]; qy += m * vy[i]; qz += m * vz[i];
      vx[i] = 0; vy[i] = 0; vz[i] = 0;
    }
  }
  let fCount = 0;
  for (let k = 0; k < sCount; k++) {
    const i = solve[k];
    if (!act[i]) region.frontier[fCount++] = i;
  }
  region.frontierCount = fCount;

  // 6) Wyrzuć z obszaru węzły martwe i uspokojone (ich resztkowy pęd → ciało).
  const settle = Math.max(1, cfg.activeSettleFrames | 0);
  let write = 0;
  for (let r = 0; r < list.length; r++) {
    const i = list[r];
    if (!active[i] || !act[i]) { act[i] = 0; continue; }
    if (quiet[i] >= settle) {
      const m = mass[i];
      qx += m * vx[i]; qy += m * vy[i]; qz += m * vz[i];
      vx[i] = 0; vy[i] = 0; vz[i] = 0;
      act[i] = 0; quiet[i] = 0;
      // Jak wyżej: belki do węzłów, których nikt już nie liczy, przyjmują obecną długość.
      this._bakeRest(body, i, -1);
      continue;
    }
    list[write++] = i;
  }
  list.length = write;

  // 7) Pęd do ciała sztywnego: reakcja pierścienia i pęd uspokojonych węzłów.
  // Ciało zakotwiczone go nie przyjmuje (masa ∞ — reakcję bierze świat przez kotwice).
  const M = body.mass;
  if (M > 0 && !body.anchored) {
    const w = matVec(this._refreshRot(body), (qx - jx) / M, (qy - jy) / M, (qz - jz) / M, this._s2);
    body.vel.x += w.x; body.vel.y += w.y;
    if (!planar) body.vel.z += w.z;
  }
  region.drift += drift;
  // Środek masy wyrównujemy leniwie (O(N)): po uspokojeniu albo gdy lokalny ruch
  // przesunął już sporo masy — nie w każdym kroku jak pełny solver.
  if (write === 0 || region.drift > 0.25 * body.cellSize * M) this._recentre(body);
  body._hashTick = -1;
  body.meshDirty = true;
  if (write === 0) { body.isSleeping = true; body.wakeHold = 0; }
  return brokenNow;
}
