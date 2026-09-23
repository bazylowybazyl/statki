// Scratch buffers keep the repeated Gauss–Seidel projection numeric and contiguous.
// Float64 preserves JS-number precision and the original constraint order.
export function beamSolverScratch(body) {
  const nc = body.nodes.length, bc = body.beams.length;
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
  if (scratch.mountNodes === body.nodes && scratch.mountBeams === body.beams &&
      scratch.mountLive === body.liveBeams && scratch.mountActive === body.activeNodes &&
      scratch.mountRatio === cfg.mountMinSupportRatio) return;
  const support = scratch.localSupport, failed = scratch.mountFailed;
  support.fill(0); failed.fill(0);
  for (const beam of body.beams) if (!beam.broken && beam.type < 2 && body.nodes[beam.a].active && body.nodes[beam.b].active) {
    support[beam.a]++; support[beam.b]++;
  }
  for (let i = 0; i < body.nodes.length; i++) {
    const base = body.nodes[i].localBeamCount || 0;
    // A reinforcement cannot hang on an attachment patch that has been torn
    // out. Originally sparse mounts remain valid until physically overstressed.
    failed[i] = base >= 4 && support[i] < base * (cfg.mountMinSupportRatio ?? 0.3) ? 1 : 0;
  }
  scratch.mountNodes = body.nodes; scratch.mountBeams = body.beams;
  scratch.mountLive = body.liveBeams; scratch.mountActive = body.activeNodes;
  scratch.mountRatio = cfg.mountMinSupportRatio;
}

export function prepareBeamConstraints(s, beams, cfg, dt, plasticRate, stepScaleSq) {
  const p = s.positions, w = s.weights, active = s.active;
  const breakOn = (cfg.breakEnabled | 0) === 1;
  const stiffMul = cfg.globalStiffnessMul, breakMul = cfg.globalBreakMul;
  let count = 0, broken = 0;
  s.deformed = false;
  // Damage is measured before ANY projection, using the same beam order.
  for (const beam of beams) {
    if (beam.broken || !active[beam.a] || !active[beam.b]) continue;
    if (breakOn && beam.type >= 2 && (s.mountFailed[beam.a] || s.mountFailed[beam.b])) {
      beam.broken = true; broken++; continue;
    }
    const ia = beam.a * 3, ib = beam.b * 3;
    const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const C = len - beam.rest, strain = C / beam.rest, absStrain = Math.abs(strain);
    beam.strain = strain;
    if (breakOn) {
      const limit = beam.break * breakMul;
      if (absStrain > beam.deform) beam.fatigue = (beam.fatigue || 0) +
        (absStrain - beam.deform) / limit * cfg.plasticFatigue * dt * 60;
      if (Math.max(absStrain, Math.abs(len - beam.restBase) / beam.restBase) > limit || beam.fatigue >= 1) {
        beam.broken = true;
        broken++;
        continue;
      }
    }
    if (absStrain > beam.deform) {
      const over = C - Math.sign(C) * beam.deform * beam.rest;
      beam.rest = Math.max(beam.restBase * (1 - cfg.maxRestDrift),
        Math.min(beam.restBase * (1 + cfg.maxRestDrift), beam.rest + over * plasticRate));
      s.deformed = true;
    }
    const wsum = w[beam.a] + w[beam.b];
    if (wsum <= 0) continue;
    const stiffness = Math.min(1, beam.stiffness * stiffMul);
    const k = stiffness / (stiffness + (1 - stiffness) / stepScaleSq);
    s.a[count] = beam.a; s.b[count] = beam.b;
    s.rest[count] = beam.rest; s.factor[count++] = k / wsum;
  }
  s.count = count;
  return broken;
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
