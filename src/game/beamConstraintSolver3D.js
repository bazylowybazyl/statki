// Scratch buffers keep the repeated Gauss–Seidel projection numeric and contiguous.
// Float64 preserves JS-number precision and the original constraint order.
export function beamSolverScratch(body) {
  const nc = body.nodeStore.count, bc = body.beamStore.count;
  let s = body._solverScratch;
  if (!s || s.weights.length < nc || s.rest.length < bc) {
    s = body._solverScratch = {
      positions: new Float64Array(nc * 3), weights: new Float64Array(nc), active: new Uint8Array(nc),
      localSupport: new Uint16Array(nc), mountFailed: new Uint8Array(nc),
      a: new Uint32Array(bc), b: new Uint32Array(bc),
      rest: new Float64Array(bc), factor: new Float64Array(bc)
    };
  }
  return s;
}

export function refreshBeamMounts(body, scratch, cfg) {
  const nodes = body.nodeStore, beams = body.beamStore;
  if (scratch.mountNodes === nodes && scratch.mountBeams === beams &&
      scratch.mountLive === body.liveBeams && scratch.mountActive === body.activeNodes &&
      scratch.mountRatio === cfg.mountMinSupportRatio) return;
  const support = scratch.localSupport, failed = scratch.mountFailed;
  const active = nodes.active, a = beams.a, b = beams.b, broken = beams.broken, type = beams.type;
  support.fill(0); failed.fill(0);
  for (let e = 0; e < beams.count; e++) {
    if (!broken[e] && type[e] < 2 && active[a[e]] && active[b[e]]) { support[a[e]]++; support[b[e]]++; }
  }
  const ratio = cfg.mountMinSupportRatio ?? 0.3, base = nodes.localBeamCount;
  for (let i = 0; i < nodes.count; i++) {
    // A reinforcement cannot hang on an attachment patch that has been torn
    // out. Originally sparse mounts remain valid until physically overstressed.
    failed[i] = base[i] >= 4 && support[i] < base[i] * ratio ? 1 : 0;
  }
  scratch.mountNodes = nodes; scratch.mountBeams = beams;
  scratch.mountLive = body.liveBeams; scratch.mountActive = body.activeNodes;
  scratch.mountRatio = cfg.mountMinSupportRatio;
}

/**
 * Pomiar belek przed rzutowaniem: zmęczenie, zerwania, plastyczność, wagi więzów.
 * `list` = indeksy belek kroku (solver lokalny) albo null = wszystkie belki magazynu.
 */
export function prepareBeamConstraints(s, beams, list, listCount, cfg, dt, plasticRate, stepScaleSq) {
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

export function projectBeamConstraints(s, count, iterations) {
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
