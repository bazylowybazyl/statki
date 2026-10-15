// Lina windy kosmicznej bazy piratów (misja 1) — ruch kabin i spadek po zerwaniu. Czysta (bez Three i DOM).
//
// Cała lina: węzły w układzie bazy (x, h, z — pirateRockLayout.js), górny przypięty do głowicy kotwicy pod dyskiem
// mieszkalnym, dolny do wieży stacji dolnej na szczycie skały. Kabiny jeżdżą po linie (parametr s: 0 — góra, 1 — dół).
// Zerwanie (rozpad habitatu): lina pęka POD GŁOWICĄ — głowica (węzeł 0, ciężka) spada osobno ku skale razem z
// rozpadem habitatu, a wolna lina pod naciągiem ODSKAKUJE ku stacji dolnej (górny koniec najszybciej), wybrzusza się,
// spada ku środkowi skały (grawitacja `spec.gravity`, Verlet + więzy długości, podkrok 1/120 s) i kładzie się na kuli
// wokół osady (tarcie); kabiny jadą z węzłami, przy których były. Uderzenie głowicy, kabin i pierwsze uderzenie każdego odcinka → zdarzenia (wybuchy,
// kurz — pirateRockSite3D.js). Dolny koniec puszcza, gdy zawali się stacja dolna (releaseBottom). Lina w spoczynku
// zasypia (zero pracy).

export const TETHER_TUNE = Object.freeze({
  substep: 1 / 120,
  iterations: 14,
  damping: 0.05,          // [1/s] tłumienie ruchu (numeryczne — w próżni oporu nie ma)
  friction: 0.55,         // ułamek prędkości stycznej zabierany przy styku z powierzchnią
  impactSpeed: 140,       // [j/s] prędkość ku powierzchni, od której styk jest uderzeniem
  headInvMass: 0.12,      // głowica kotwicy (ciężka)
  climberInvMass: 0.35,   // węzeł z kabiną
  recoil: 2400,           // [j/s] odskok górnego końca ku stacji dolnej przy zerwaniu (lina pod naciągiem; liniowo do 0 na dole)
  recoilWobble: 0.55,      // boczne zaburzenie odskoku (ułamek) — lina się wybrzusza i zwija zamiast ściskać po prostej
  sleepSpeed: 1.5,        // [j/s]
  sleepTime: 1.5,         // [s]
  climberPeriod: 46,      // [s] pełny kurs kabiny góra–dół–góra
  climberDwell: 0.12      // ułamek kursu na postój na końcach
});

/** Położenie kabiny k na nienaruszonej linie (0 — góra, 1 — dół) w czasie t [s]. */
export function climberParam(k, t, count = 2, tune = TETHER_TUNE) {
  const ph = ((t / tune.climberPeriod) + k / Math.max(1, count)) % 1;
  // trapez: postój na górze, zjazd, postój na dole, wjazd
  const d = tune.climberDwell;
  const run = 0.5 - d;
  if (ph < d) return 0;
  if (ph < d + run) { const u = (ph - d) / run; return u * u * (3 - 2 * u); }
  if (ph < 0.5 + d) return 1;
  const u = (ph - 0.5 - d) / run;
  return 1 - u * u * (3 - 2 * u);
}

/** Nowa symulacja liny z układu skały. */
export function createTetherSim(layout, tune = TETHER_TUNE) {
  const T = { ...TETHER_TUNE, ...tune };
  const N = layout.tether.segments;
  const n = N + 1;
  const pos = new Float64Array(layout.tether.nodes);
  const prev = new Float64Array(layout.tether.nodes);
  const invMass = new Float64Array(n).fill(1);
  const hit = new Uint8Array(n);
  return {
    tune: T, N, n, pos, prev, invMass, hit,
    segLen: layout.tether.segLen,
    C: layout.center, R: layout.R + layout.spec.cableR, g: layout.spec.gravity,
    snapped: false, bottomFree: false, sleeping: true, still: 0, time: 0, acc: 0,
    // kabiny: s na linie w chwili zerwania i węzeł, do którego się przyczepiły (−1 — przed zerwaniem)
    climberS: new Float64Array(layout.spec.climbers),
    climberNode: new Int32Array(layout.spec.climbers).fill(-1),
    climberHit: new Uint8Array(layout.spec.climbers),
    headHit: 0
  };
}

/** Przywraca nienaruszoną linę (nowa gra). */
export function resetTetherSim(sim, layout) {
  sim.pos.set(layout.tether.nodes);
  sim.prev.set(layout.tether.nodes);
  sim.invMass.fill(1);
  sim.hit.fill(0);
  sim.snapped = false;
  sim.bottomFree = false;
  sim.sleeping = true;
  sim.still = 0;
  sim.time = 0;
  sim.acc = 0;
  sim.climberNode.fill(-1);
  sim.climberHit.fill(0);
  sim.headHit = 0;
}

/**
 * Zerwanie: górny koniec puszcza. climberS — położenia kabin (0..1) w chwili zerwania (kabina wiesza się na
 * najbliższym węźle, który robi się cięższy).
 */
export function snapTether(sim, climberS = null) {
  if (sim.snapped) return false;
  const T = sim.tune;
  sim.snapped = true;
  sim.sleeping = false;
  sim.still = 0;
  sim.invMass[0] = T.headInvMass;
  for (let k = 0; k < sim.climberS.length; k++) {
    const s = climberS ? Math.max(0, Math.min(1, Number(climberS[k]) || 0)) : 0.5;
    sim.climberS[k] = s;
    // kabina na samym dole stoi w stacji (zostaje z nią); inaczej najbliższy węzeł 1 … N − 1
    const i = Math.round(s * sim.N);
    const node = Math.max(1, Math.min(sim.N - 1, i));
    sim.climberNode[k] = s >= 0.995 ? -1 : node;
    if (sim.climberNode[k] > 0) sim.invMass[node] = Math.min(sim.invMass[node], T.climberInvMass);
  }
  // ODSKOK: lina pęka pod głowicą — węzły 1 … N − 1 lecą ku stacji dolnej (węzeł 1 najszybciej, liniowo do 0 na dole),
  // z bocznym zaburzeniem (deterministycznym), żeby lina wybrzuszała się i zwijała, a nie ściskała po prostej.
  // Głowica spada sama (bez odskoku). Z góry: lina „ucieka” spod dysku w dół ku osadzie.
  const p = sim.pos;
  const N = sim.N;
  const bx = p[N * 3], bh = p[N * 3 + 1], bz = p[N * 3 + 2];
  const L = Math.hypot(p[0] - bx, p[1] - bh, p[2] - bz) || 1;
  const ux = (bx - p[0]) / L, uh = (bh - p[1]) / L, uz = (bz - p[2]) / L;
  // oś boczna: prostopadła do liny i do pionu
  let sx = uz, sz = -ux;
  const sl = Math.hypot(sx, sz) || 1;
  sx /= sl; sz /= sl;
  for (let i = 1; i < N; i++) {
    const f = 1 - (i - 1) / (N - 1);
    const v = T.recoil * f;
    const w = T.recoilWobble * T.recoil * f * Math.sin(i * 2.399 + 0.7);
    const o = i * 3;
    sim.prev[o] = p[o] - (ux * v + sx * w) * T.substep;
    sim.prev[o + 1] = p[o + 1] - uh * v * T.substep;
    sim.prev[o + 2] = p[o + 2] - (uz * v + sz * w) * T.substep;
  }
  return true;
}

/** Dolny koniec puszcza (zawaliła się stacja dolna). */
export function releaseTetherBottom(sim) {
  if (sim.bottomFree) return false;
  sim.bottomFree = true;
  sim.sleeping = false;
  sim.still = 0;
  return true;
}

/**
 * Krok symulacji (czas gry; w pauzie dt = 0). onImpact(kind, node, x, h, z, speed) — kind: 'head' | 'climber' | 'cable'
 * (klimber: dodatkowo indeks kabiny jako 7. argument). Zwraca liczbę podkroków.
 */
export function stepTetherSim(sim, dt, onImpact = null) {
  if (!sim.snapped || sim.sleeping || !(dt > 0)) return 0;
  const T = sim.tune;
  const h = T.substep;
  // podkrok stały, niezależny od klatki (akumulator; nadmiar ponad 16 podkroków — pauza, przycięcie — przepada)
  sim.acc += dt;
  let steps = Math.floor(sim.acc / h);
  if (steps > 16) { steps = 16; sim.acc = 0; } else sim.acc -= steps * h;
  if (steps <= 0) return 0;
  const P = sim.pos;
  const Q = sim.prev;
  const W = sim.invMass;
  const n = sim.n;
  const cx = sim.C[0], ch = sim.C[1], cz = sim.C[2];
  const R = sim.R;
  const g = sim.g;
  const keep = Math.exp(-T.damping * h);
  const L = sim.segLen;
  let maxV = 0;
  for (let s = 0; s < steps; s++) {
    // Verlet + grawitacja ku środkowi skały
    for (let i = 0; i < n; i++) {
      if (W[i] === 0 || (i === n - 1 && !sim.bottomFree)) continue;
      const o = i * 3;
      const dx = cx - P[o], dh = ch - P[o + 1], dz = cz - P[o + 2];
      const d = Math.sqrt(dx * dx + dh * dh + dz * dz) || 1;
      const ax = (dx / d) * g * h * h;
      const ah = (dh / d) * g * h * h;
      const az = (dz / d) * g * h * h;
      const vx = (P[o] - Q[o]) * keep;
      const vh = (P[o + 1] - Q[o + 1]) * keep;
      const vz = (P[o + 2] - Q[o + 2]) * keep;
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      P[o] += vx + ax;
      P[o + 1] += vh + ah;
      P[o + 2] += vz + az;
    }
    // więzy długości (dolny koniec przypięty do stacji, dopóki stoi; głowica po zerwaniu wolna — bez odcinka 0)
    for (let it = 0; it < T.iterations; it++) {
      for (let i = 1; i < n - 1; i++) {
        const a = i * 3;
        const b = a + 3;
        const wa = W[i];
        const wb = (i + 1 === n - 1 && !sim.bottomFree) ? 0 : W[i + 1];
        const ws = wa + wb;
        if (ws <= 0) continue;
        const dx = P[b] - P[a], dh = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dh * dh + dz * dz) || 1e-9;
        const k = (d - L) / (d * ws);
        P[a] += dx * k * wa; P[a + 1] += dh * k * wa; P[a + 2] += dz * k * wa;
        P[b] -= dx * k * wb; P[b + 1] -= dh * k * wb; P[b + 2] -= dz * k * wb;
      }
    }
    // powierzchnia skały: wypchnięcie, tarcie, uderzenia
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const dx = P[o] - cx, dh = P[o + 1] - ch, dz = P[o + 2] - cz;
      const d = Math.sqrt(dx * dx + dh * dh + dz * dz) || 1;
      if (d >= R) continue;
      const nx = dx / d, nh = dh / d, nz = dz / d;
      let vx = (P[o] - Q[o]) / h, vh = (P[o + 1] - Q[o + 1]) / h, vz = (P[o + 2] - Q[o + 2]) / h;
      const vn = vx * nx + vh * nh + vz * nz;
      if (vn < -T.impactSpeed && !sim.hit[i]) {
        sim.hit[i] = 1;
        if (onImpact) {
          if (i === 0) { sim.headHit = 1; onImpact('head', i, P[o], P[o + 1], P[o + 2], -vn, -1); }
          else {
            let k = -1;
            for (let c = 0; c < sim.climberNode.length; c++) if (sim.climberNode[c] === i && !sim.climberHit[c]) { k = c; sim.climberHit[c] = 1; }
            onImpact(k >= 0 ? 'climber' : 'cable', i, P[o], P[o + 1], P[o + 2], -vn, k);
          }
        }
      }
      P[o] = cx + nx * R; P[o + 1] = ch + nh * R; P[o + 2] = cz + nz * R;
      // prędkość: bez składowej ku powierzchni, tarcie stycznej
      if (vn < 0) { vx -= vn * nx; vh -= vn * nh; vz -= vn * nz; }
      const f = 1 - T.friction;
      vx *= f; vh *= f; vz *= f;
      Q[o] = P[o] - vx * h; Q[o + 1] = P[o + 1] - vh * h; Q[o + 2] = P[o + 2] - vz * h;
    }
    if (s === steps - 1) {
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const v = Math.sqrt((P[o] - Q[o]) ** 2 + (P[o + 1] - Q[o + 1]) ** 2 + (P[o + 2] - Q[o + 2]) ** 2) / h;
        if (v > maxV) maxV = v;
      }
    }
  }
  sim.time += steps * h;
  if (maxV < T.sleepSpeed) {
    sim.still += steps * h;
    if (sim.still >= T.sleepTime) sim.sleeping = true;
  } else sim.still = 0;
  return steps;
}

/** Punkt na linie dla parametru s (0..1) — interpolacja węzłów. out = { x, h, z, i (odcinek) }. */
export function tetherPointAt(sim, s, out = {}) {
  const f = Math.max(0, Math.min(1, s)) * sim.N;
  const i = Math.min(sim.N - 1, Math.floor(f));
  const t = f - i;
  const a = i * 3;
  const b = a + 3;
  const P = sim.pos;
  out.x = P[a] + (P[b] - P[a]) * t;
  out.h = P[a + 1] + (P[b + 1] - P[a + 1]) * t;
  out.z = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
  out.i = i;
  return out;
}
