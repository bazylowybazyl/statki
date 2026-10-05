/**
 * worldChannels — broń przeciw CIAŁOM ŚWIATA w grze (docs/PLAN-zniszczenia-swiata-3d.md § 3, F1): zniszczenie
 * PRZEZ SOLVER silnika belek, jak w demie F0 (beamPhysicalWeapons3D.js — „jest ten feel”, ocena 2026-10-05).
 * Broń nie kasuje węzłów i nie przesuwa ich pozycji — oddaje konstrukcji:
 *  - PĘD — „orka”: węzły na torze pocisku po kolei, z każdym zderzenie niesprężyste z węzłem i jego NIECKĄ
 *    (pierścienie sąsiadów po całych belkach); pocisk traci dokładnie tyle pędu, ile oddał (hamuje, utyka,
 *    przechodzi na wylot). Rdzeń leci z pociskiem i rwie belki, niecka się wgniata — dziurę robi solver.
 *  - CIŚNIENIE — front fali biegnący od punktu wybuchu: węzeł dostaje prędkość od środka (∝ 1/d²), gdy front
 *    przez niego przechodzi.
 *  - CIEPŁO — wiązka grzeje węzły (`temp`), ciepło płynie po belkach, gorące belki słabną (próg zerwania
 *    i sztywność × f(T) od WARTOŚCI WYJŚCIOWYCH ciała — materiał ciała zostaje), powyżej topnienia węzeł
 *    odparowuje (kropla w stronę strzelca, odrzut sąsiadów).
 * Różnice wobec dema: pociski są pociskami GRY (moduł liczy tylko oddanie pędu i hamowanie), kandydaci z SIATKI
 * KOMÓREK ciała (wiersze wzdłuż toru — jak sweepLocal2D), nie z przeglądu wszystkich węzłów, płasko (z = 0),
 * a strojenie w KOMÓRKACH (prędkości w komórkach/s, promienie w komórkach, masy w masach węzła) — demo
 * (komórka 2,7 j., pocisk ~150 komórek/s) przenosi się na grę (komórka 15 j., pociski 150–800 komórek/s) bez
 * przeliczania liczb. Układ: silnik (X = x gry, Y = −y gry).
 * Bez dymu, ognia i wybuchów (decyzja użytkownika 2026-10-05) — tylko fizyka; obraz trafień dają efekty broni gry.
 * Bez three i DOM (testy w node).
 */

import { activateNode } from './beamActiveRegion3D.js';

/** Strojenie kanałów (komórki, komórki/s, masy węzła). */
export function createWorldChannelTuning() {
  return {
    // --- orka (pęd) ---
    dishRings: 2,             // pierścienie sąsiadów po belkach, które jadą z trafionym węzłem
    dishWeight: 0.4,          // udział pierwszego pierścienia (dalej liniowo w dół)
    // Niecka maleje z prędkością uderzenia (fala naprężeń wolniejsza od pocisku — szybki pocisk wybija korek,
    // wolny wgniata szerzej): udział × min(1, dishSpeed / prędkość względna). Demo: 90 j/s przy komórce 2,7 j.
    dishSpeedCells: 33,
    lateral: 0.35,            // rozchylenie niecki od osi toru (płatki brzegu otworu)
    stopSpeedCells: 3.7,      // komórki/s względem węzła — poniżej pocisk utyka
    anchorMassMul: 20,        // kotwica w rdzeniu zderzenia waży jak fundament
    nodeReachCells: 0.55,     // promień węzła dla toru pocisku
    impactHeat: 0.0009,       // ciepło ze straty energii zderzenia (na jednostkę energii / masę węzła) — żar trafienia
    impactHeatCap: 0.9,       // sufit ciepła z uderzenia (topi dopiero wiązka)
    // --- ciśnienie (fala) ---
    blastTime: 0.16,          // s — tyle front idzie do brzegu fali
    blastKickCells: 193,      // komórki/s prędkości węzła komórkę od środka (∝ 1/d²) przy mocy 1
    blastKickMaxCells: 296,
    blastForward: 0.3,        // domieszka kierunku lotu do kopnięcia promieniowego
    blastHeat: 0.9,
    // --- ciepło ---
    conduct: 0.8,             // przewodzenie po belkach [1/s]
    cool: 0.25,               // stygnięcie [1/s]
    soften: 0.6,              // od tej temperatury belki tracą wytrzymałość…
    melt: 2.0,                // …a tu węzeł odparowuje (ablacja)
    beamRadiusCells: 1.1,     // sigma plamy wiązki
    ablateSpeedCells: 13,     // komórki/s kropli w stronę strzelca
    ablateRecoilCells: 2.2    // komórki/s odrzutu sąsiadów w głąb
  };
}

const MAX_CAND = 4096;
const BLAST_CAP = 48;

function hash01(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-9, e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pocisk w kanale pędu (wejście i wynik orki): prędkość w UKŁADZIE SILNIKA (vx, vy — j/s), masa (j. masy
 * silnika), promień (j.), opcjonalnie dishSpeed (j/s — 0 = z strojenia × komórka ciała) i dishRings (−1 = strojenie).
 * Orka zmienia vx, vy (hamowanie) i ustawia stopped.
 */
export function createWorldShell() {
  return { vx: 0, vy: 0, mass: 0, radius: 0, dishSpeed: 0, dishRings: -1, stopped: false };
}

export class WorldChannels {
  /** @param {object} engine DestructorBeams3D (gra: HullBodies.engine) */
  constructor(engine, tune = null) {
    this.D = engine;
    this.tune = createWorldChannelTuning();
    if (tune) Object.assign(this.tune, tune);
    this.hot = new Set();
    this.blasts = Array.from({ length: BLAST_CAP }, () => ({
      active: false, x: 0, y: 0, fx: 0, fy: 0, radius: 0, kick: 0, age: 0, frontR: 0, owner: null }));
    // bufory orki (bez alokacji w kroku)
    this._candT = new Float64Array(MAX_CAND);
    this._candI = new Int32Array(MAX_CAND);
    this._candP = new Float64Array(MAX_CAND);
    this._stamp = new Int32Array(1024);
    this._gen = 0;
    this._dishI = new Int32Array(512);
    this._dishW = new Float64Array(512);
    this._dishR = new Int32Array(512);
    this._dishCount = 0;
    this._w = { x: 0, y: 0 };
    // wynik ostatniej orki
    this.result = { hit: false, stopped: false, stopT: 1, entryT: 1, node: -1, impulse: 0, energy: 0, x: 0, y: 0 };
    this.stats = { plows: 0, hits: 0, impulse: 0, blasts: 0, ablated: 0 };
  }

  // ------------------------------------------------------------------ PĘD: ORKA

  /**
   * Odcinek toru pocisku (x0, y0) → (x1, y1) w świecie SILNIKA przez ciało `body`: zderzenia z węzłami w kolejności
   * wejścia. Zmienia prędkość pocisku `p` (createWorldShell). Wynik w `this.result`: hit, stopped, stopT (ułamek
   * odcinka, na którym pocisk utknął; 1 = przeszedł), entryT (pierwsze zderzenie), node, impulse, energy
   * (oddana konstrukcji — obrażenia rozgrywki), x, y (punkt pierwszego zderzenia, świat silnika).
   */
  plowSegment(body, p, x0, y0, x1, y1) {
    const r = this.result;
    r.hit = false; r.stopped = false; r.stopT = 1; r.entryT = 1; r.node = -1; r.impulse = 0; r.energy = 0;
    r.x = x0; r.y = y0;
    if (!body || body.dead || body.activeNodes <= 0 || p.stopped) return r;
    const D = this.D, t = this.tune;
    const m = D._refreshRot(body);
    const s = body.nodeStore, cs = body.cellSize;
    // odcinek w układzie ciała (płasko: obrót wokół z)
    const rx0 = x0 - body.pos.x, ry0 = y0 - body.pos.y;
    const lx0 = m[0] * rx0 + m[3] * ry0, ly0 = m[1] * rx0 + m[4] * ry0;
    const rx1 = x1 - body.pos.x, ry1 = y1 - body.pos.y;
    const lx1 = m[0] * rx1 + m[3] * ry1, ly1 = m[1] * rx1 + m[4] * ry1;
    const dxl = lx1 - lx0, dyl = ly1 - ly0;
    const len = Math.sqrt(dxl * dxl + dyl * dyl);
    if (!(len > 1e-9)) return r;
    const ldx = dxl / len, ldy = dyl / len;
    const dwx = (x1 - x0) / len, dwy = (y1 - y0) / len;   // kierunek w świecie silnika
    const nodeR = t.nodeReachCells * cs;
    const reach = (Number(p.radius) || 0) + nodeR;
    const n = this._gatherCapsule(body, lx0, ly0, ldx, ldy, len, reach);
    if (n === 0) return r;
    if (this._stamp.length < s.count) this._stamp = new Int32Array(Math.max(s.count, this._stamp.length * 2));
    let gen = (this._gen + 1) | 0; if (gen <= 0) { this._stamp.fill(0); gen = 1; }
    this._gen = gen;
    const stamp = this._stamp, X = s.x, Y = s.y, active = s.active;
    const local = !!D.config.localSolver;
    const free = !body.static && !body.anchored;
    const stopSpeed = t.stopSpeedCells * cs;
    const dishSpeed = p.dishSpeed > 0 ? p.dishSpeed : t.dishSpeedCells * cs;
    const rings = p.dishRings >= 0 ? p.dishRings : t.dishRings;
    const wz = body.angVel.z || 0;
    let hot = false;
    this.stats.plows++;
    for (let k = 0; k < n; k++) {
      const i = this._candI[k];
      if (!active[i] || stamp[i] === gen) continue;
      // prędkość węzła w świecie: ruch sztywny ciała + własny węzła (lokalny → świat)
      const nx = X[i], ny = Y[i];
      const wxp = m[0] * nx + m[1] * ny, wyp = m[3] * nx + m[4] * ny;
      const nvx = body.vel.x - wz * wyp + m[0] * s.vx[i] + m[1] * s.vy[i];
      const nvy = body.vel.y + wz * wxp + m[3] * s.vx[i] + m[4] * s.vy[i];
      const ux = p.vx - nvx, uy = p.vy - nvy;
      // węzeł, który już jedzie z pociskiem (rdzeń z poprzedniego kroku), nie hamuje go drugi raz
      if (ux * dwx + uy * dwy <= 0) continue;
      const un2 = ux * ux + uy * uy;
      const tk = this._candT[k];
      if (!r.hit) { r.entryT = Math.max(0, tk / len); r.node = i; r.x = x0 + dwx * Math.max(0, tk); r.y = y0 + dwy * Math.max(0, tk); }
      if (un2 < stopSpeed * stopSpeed) {
        p.stopped = true;
        r.stopped = true;
        r.hit = true;
        r.stopT = Math.max(0, Math.min(1, (tk - (Number(p.radius) || 0)) / len));
        break;
      }
      const un = Math.sqrt(un2);
      const dishScale = Math.min(1, dishSpeed / un);
      const meff = this._gatherDish(body, i, gen, dishScale, rings);
      const perp = this._candP[k];
      const pr = Number(p.radius) || 0;
      const coupling = perp <= pr ? 1 : Math.max(0.3, 1 - 0.7 * (perp - pr) / nodeR);
      const mu = p.mass * meff / (p.mass + meff) * coupling;
      const jx = mu * ux, jy = mu * uy;
      p.vx -= jx / p.mass; p.vy -= jy / p.mass;
      // węzły: Δv = w · J / m_eff w układzie ciała + rozchylenie od osi toru (wewnętrzne — bez pędu netto)
      const ax = jx / meff, ay = jy / meff;
      const lax = m[0] * ax + m[3] * ay, lay = m[1] * ax + m[4] * ay;
      const aLen = Math.sqrt(lax * lax + lay * lay);
      const count = this._dishCount, dishI = this._dishI, dishW = this._dishW;
      const lateral = t.lateral > 0 && count > 1;
      let mlx = 0, mly = 0;
      if (lateral) {
        let sm = 0;
        for (let q = 1; q < count; q++) {
          const d = dishI[q];
          if (s.invMass[d] <= 0) continue;
          this._lateralOf(X[d] - lx0, Y[d] - ly0, ldx, ldy, t.lateral * dishW[q] * aLen);
          const md = s.mass[d];
          mlx += this._w.x * md; mly += this._w.y * md; sm += md;
        }
        if (sm > 0) { mlx /= sm; mly /= sm; }
      }
      for (let q = 0; q < count; q++) {
        const d = dishI[q];
        if (s.invMass[d] <= 0) continue;
        const w = dishW[q];
        s.vx[d] += lax * w; s.vy[d] += lay * w;
        if (q > 0 && lateral) {
          this._lateralOf(X[d] - lx0, Y[d] - ly0, ldx, ldy, t.lateral * w * aLen);
          s.vx[d] += this._w.x - mlx; s.vy[d] += this._w.y - mly;
        }
        if (local) activateNode(body, d);
      }
      // obrót ciała swobodnego: impuls w punkcie trafienia (ruch liniowy przejmie solver ze średniej węzłów)
      if (free) this._angularImpulse(body, wxp, wyp, jx, jy);
      // strata energii zderzenia grzeje rdzeń (żar trafienia)
      const loss = 0.5 * mu * un2;
      if (t.impactHeat > 0 && s.temp) {
        const T = s.temp[i] + loss * t.impactHeat / Math.max(1e-6, s.mass[i]);
        s.temp[i] = Math.min(t.melt * t.impactHeatCap * 0.5, T);
        hot = true;
      }
      r.hit = true;
      const J = Math.sqrt(jx * jx + jy * jy);
      r.impulse += J;
      r.energy += loss;
      this.stats.impulse += J;
    }
    if (r.hit) {
      this.stats.hits++;
      D.wake(body, D.config.wakeHoldFrames);
      body.meshDirty = true;
      if (hot) this.hot.add(body);
    }
    return r;
  }

  // Węzły w kapsule toru (układ ciała): wiersze siatki wzdłuż odcinka, posortowane po drodze t (wstawianie).
  _gatherCapsule(body, lx0, ly0, ldx, ldy, len, reach) {
    const D = this.D;
    const index = D._latticeIndex(body);
    const s = body.nodeStore, X = s.x, Y = s.y, active = s.active, cells = index.cells;
    const cs = body.cellSize, lm = body.latticeMin, d = body.dims;
    const pad = reach + (body._maxDisp || 0) + cs;
    const lx1 = lx0 + ldx * len, ly1 = ly0 + ldy * len;
    const mm = body._boundsMinMax;
    if (mm && (Math.max(lx0, lx1) < mm[0] - pad || Math.min(lx0, lx1) > mm[3] + pad ||
        Math.max(ly0, ly1) < mm[1] - pad || Math.min(ly0, ly1) > mm[4] + pad)) return 0;
    const row0 = Math.max(0, Math.floor((Math.min(ly0, ly1) - pad - lm.y) / cs - 0.5));
    const row1 = Math.min(d.y - 1, Math.ceil((Math.max(ly0, ly1) + pad - lm.y) / cs - 0.5));
    const reach2 = reach * reach;
    const dy = ly1 - ly0, dx = lx1 - lx0;
    let n = 0;
    for (let iy = row0; iy <= row1; iy++) {
      const cy = lm.y + (iy + 0.5) * cs;
      let tLo = 0, tHi = 1;
      if (Math.abs(dy) > 1e-12) {
        let ta = (cy - pad - ly0) / dy, tb = (cy + pad - ly0) / dy;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > tLo) tLo = ta;
        if (tb < tHi) tHi = tb;
        if (tLo > tHi) continue;
      } else if (Math.abs(ly0 - cy) > pad) continue;
      const xa = lx0 + dx * tLo, xb = lx0 + dx * tHi;
      const col0 = Math.max(0, Math.floor((Math.min(xa, xb) - pad - lm.x) / cs - 0.5));
      const col1 = Math.min(d.x - 1, Math.ceil((Math.max(xa, xb) + pad - lm.x) / cs - 0.5));
      const rowBase = iy * d.x;
      for (let ix = col0; ix <= col1; ix++) {
        const i = cells[rowBase + ix];
        if (i < 0 || !active[i]) continue;
        const ex = X[i] - lx0, ey = Y[i] - ly0;
        const tt = ex * ldx + ey * ldy;
        if (tt < -reach || tt > len + reach) continue;
        const perp2 = ex * ex + ey * ey - tt * tt;
        if (perp2 > reach2) continue;
        if (n >= MAX_CAND) return n;
        let at = n++;
        while (at > 0 && this._candT[at - 1] > tt) {
          this._candT[at] = this._candT[at - 1]; this._candI[at] = this._candI[at - 1]; this._candP[at] = this._candP[at - 1]; at--;
        }
        this._candT[at] = tt; this._candI[at] = i; this._candP[at] = Math.sqrt(Math.max(0, perp2));
      }
    }
    return n;
  }

  // Rdzeń + pierścienie sąsiadów po całych belkach (BFS). Masa efektywna zderzenia: rdzeń + Σ w · m (kotwice nie
  // jadą — rdzeń-kotwica waży jak fundament).
  _gatherDish(body, core, gen, scale, ringCount) {
    const s = body.nodeStore, e = body.beamStore, t = this.tune;
    const adjStart = s.adjStart, adj = s.adj, ea = e.a, eb = e.b, broken = e.broken, active = s.active;
    const stamp = this._stamp, rings = Math.max(0, ringCount | 0), w0 = t.dishWeight * scale;
    let dishI = this._dishI, dishW = this._dishW, ring = this._dishR;
    let count = 1, head = 0;
    dishI[0] = core; dishW[0] = 1; ring[0] = 0; stamp[core] = gen;
    let meff = s.invMass[core] > 0 ? s.mass[core] : s.mass[core] * t.anchorMassMul;
    while (head < count) {
      const cur = dishI[head], rc = ring[head]; head++;
      if (rc >= rings) continue;
      const w = w0 * (1 - rc / Math.max(1, rings));
      if (!(w > 0)) continue;
      for (let q = adjStart[cur]; q < adjStart[cur + 1]; q++) {
        const bi = adj[q];
        if (broken[bi]) continue;
        const o = ea[bi] === cur ? eb[bi] : ea[bi];
        if (!active[o] || stamp[o] === gen) continue;
        stamp[o] = gen;
        if (count === dishI.length) {
          const grow = count * 2;
          const ni = new Int32Array(grow); ni.set(dishI); dishI = this._dishI = ni;
          const nw = new Float64Array(grow); nw.set(dishW); dishW = this._dishW = nw;
          const nr = new Int32Array(grow); nr.set(ring); ring = this._dishR = nr;
        }
        dishI[count] = o; dishW[count] = w; ring[count] = rc + 1; count++;
        if (s.invMass[o] > 0) meff += w * s.mass[o];
      }
    }
    this._dishCount = count;
    return meff;
  }

  _lateralOf(ex, ey, dx, dy, len) {
    const along = ex * dx + ey * dy;
    const qx = ex - dx * along, qy = ey - dy * along;
    const ql = Math.sqrt(qx * qx + qy * qy);
    const k = ql > 1e-6 ? len / ql : 0;
    this._w.x = qx * k; this._w.y = qy * k;
  }

  // Δω = I⁻¹ (r × J) — płasko tylko składowa z.
  _angularImpulse(body, rx, ry, jx, jy) {
    const I = body.invInertiaLocal;
    if (!I) return;
    const tz = rx * jy - ry * jx;
    const scale = 1 / Math.max(1e-6, body.rammingMassMult || 1);
    body.angVel.z += I[8] * tz * scale;
  }

  // ------------------------------------------------------------------ CIŚNIENIE

  /**
   * Wybuch w punkcie (świat silnika): front fali biegnie do `radius` [j.] w `blastTime`; moc — mnożnik kopnięcia
   * (1 ≈ rakieta dema). (fx, fy) — kierunek lotu (domieszka do kopnięcia), owner — ciało pominięte.
   * @returns {boolean} false — pula frontów pełna
   */
  detonate(x, y, radius, power = 1, fx = 0, fy = 0, owner = null) {
    let b = null;
    for (const q of this.blasts) if (!q.active) { b = q; break; }
    if (!b) return false;
    b.active = true; b.x = x; b.y = y; b.radius = Math.max(1, radius); b.kick = Math.max(0, power);
    const fl = Math.sqrt(fx * fx + fy * fy);
    b.fx = fl > 1e-9 ? fx / fl : 0; b.fy = fl > 1e-9 ? fy / fl : 0;
    b.age = 0; b.frontR = 0; b.owner = owner;
    this.stats.blasts++;
    return true;
  }

  /**
   * Front ciśnienia OD RAZU (cały promień, bez biegu frontu) na jednym ciele (świat silnika) — rozpad z rozgrywki:
   * odpadający kawałek dostaje swoje kopnięcie, zanim stanie się wrakiem (fale z detonate() widzą tylko ciała
   * budowli z kroku). Zwraca, czy coś dostało.
   */
  kick(body, x, y, radius, power = 1, fx = 0, fy = 0) {
    if (!body || body.dead || body.static || body.activeNodes <= 0) return false;
    const b = this._kickBlast || (this._kickBlast = { active: false, x: 0, y: 0, fx: 0, fy: 0, radius: 0, kick: 0, age: 0, frontR: 0, owner: null });
    b.x = x; b.y = y; b.radius = Math.max(1, radius); b.kick = Math.max(0, power);
    const fl = Math.sqrt(fx * fx + fy * fy);
    b.fx = fl > 1e-9 ? fx / fl : 0; b.fy = fl > 1e-9 ? fy / fl : 0;
    this._blastBody(body, b, 0, b.radius);
    return true;
  }

  /** Krok frontów fal (raz na krok fizyki, przed krokiem silnika) dla ciał `bodies`. */
  stepBlasts(dt, bodies) {
    if (!(dt > 0)) return;
    const t = this.tune;
    for (const b of this.blasts) {
      if (!b.active) continue;
      const prevR = b.frontR;
      b.age += dt;
      const R = b.radius * Math.min(1, b.age / Math.max(1e-4, t.blastTime));
      b.frontR = R;
      for (let n = 0; n < bodies.length; n++) {
        const B = bodies[n];
        if (!B || B.dead || B.static || B === b.owner || B.activeNodes <= 0) continue;
        const ex = B.pos.x - b.x, ey = B.pos.y - b.y;
        const reach = B.radius + R + B.cellSize;
        if (ex * ex + ey * ey > reach * reach) continue;
        this._blastBody(B, b, prevR, R);
      }
      if (b.age >= t.blastTime) { b.active = false; b.owner = null; }
    }
  }

  _blastBody(B, blast, prevR, R) {
    const D = this.D, t = this.tune;
    const m = D._refreshRot(B), s = B.nodeStore, cs = B.cellSize;
    const rx = blast.x - B.pos.x, ry = blast.y - B.pos.y;
    const lx = m[0] * rx + m[3] * ry, ly = m[1] * rx + m[4] * ry;
    const fx = m[0] * blast.fx + m[3] * blast.fy, fy = m[1] * blast.fx + m[4] * blast.fy;
    const local = !!D.config.localSolver, free = !B.anchored && !B.static;
    const d0 = cs * 0.8, kickAt1 = t.blastKickCells * cs * blast.kick * cs * cs, kickMax = t.blastKickMaxCells * cs;
    // okno komórek wokół frontu
    const index = D._latticeIndex(B), cells = index.cells, lm = B.latticeMin, dims = B.dims;
    const pad = R + (B._maxDisp || 0) + cs;
    const x0 = Math.max(0, Math.floor((lx - pad - lm.x) / cs - 0.5)), x1 = Math.min(dims.x - 1, Math.ceil((lx + pad - lm.x) / cs - 0.5));
    const y0 = Math.max(0, Math.floor((ly - pad - lm.y) / cs - 0.5)), y1 = Math.min(dims.y - 1, Math.ceil((ly + pad - lm.y) / cs - 0.5));
    let tz = 0, any = false, hot = false;
    const R2 = R * R, P2 = prevR > 0 ? prevR * prevR : -1;
    for (let iy = y0; iy <= y1; iy++) {
      const rowBase = iy * dims.x;
      for (let ix = x0; ix <= x1; ix++) {
        const i = cells[rowBase + ix];
        if (i < 0 || !s.active[i]) continue;
        const qx = s.x[i] - lx, qy = s.y[i] - ly;
        const d2 = qx * qx + qy * qy;
        if (d2 > R2 || d2 <= P2) continue;
        const d = Math.sqrt(d2);
        const kick = Math.min(kickMax, kickAt1 / Math.max(d0 * d0, d2));
        if (s.invMass[i] > 0) {
          let ux = d > 1e-6 ? qx / d : fx, uy = d > 1e-6 ? qy / d : fy;
          ux += fx * t.blastForward; uy += fy * t.blastForward;
          const ul = Math.sqrt(ux * ux + uy * uy) || 1;
          const vx = ux / ul * kick, vy = uy / ul * kick;
          s.vx[i] += vx; s.vy[i] += vy;
          if (free) {
            const wx = m[0] * s.x[i] + m[1] * s.y[i], wy = m[3] * s.x[i] + m[4] * s.y[i];
            const jx = (m[0] * vx + m[1] * vy) * s.mass[i], jy = (m[3] * vx + m[4] * vy) * s.mass[i];
            tz += wx * jy - wy * jx;
          }
          if (local) activateNode(B, i);
        }
        if (t.blastHeat > 0 && s.temp) {
          const T = t.blastHeat * kick / kickMax;
          if (T > s.temp[i]) { s.temp[i] = T; hot = true; }
        }
        any = true;
      }
    }
    if (!any) return;
    if (free && B.invInertiaLocal) B.angVel.z += B.invInertiaLocal[8] * tz / Math.max(1e-6, B.rammingMassMult || 1);
    D.wake(B, D.config.wakeHoldFrames);
    B.meshDirty = true;
    if (hot) this.hot.add(B);
  }

  // ------------------------------------------------------------------ CIEPŁO

  /**
   * Plama ciepła wiązki wokół punktu (świat silnika) na ciele: `power` — temperatura/s w osi, przez `dt`;
   * (dirX, dirY) — kierunek wiązki (ablacja leci pod prąd). Zwraca, czy plama trafiła żywy węzeł.
   */
  heat(body, x, y, power, dt, dirX = 0, dirY = 0) {
    if (!body || body.dead || body.activeNodes <= 0 || !(power > 0) || !(dt > 0)) return false;
    const D = this.D, t = this.tune;
    const s = body.nodeStore;
    if (!s.temp) return false;
    const m = D._refreshRot(body), cs = body.cellSize;
    const rx = x - body.pos.x, ry = y - body.pos.y;
    const lx = m[0] * rx + m[3] * ry, ly = m[1] * rx + m[4] * ry;
    const sigma = Math.max(1e-6, t.beamRadiusCells * cs), reach = 3 * sigma, inv = 1 / (2 * sigma * sigma);
    const index = D._latticeIndex(body), cells = index.cells, lm = body.latticeMin, dims = body.dims;
    const pad = reach + (body._maxDisp || 0) + cs;
    const x0 = Math.max(0, Math.floor((lx - pad - lm.x) / cs - 0.5)), x1 = Math.min(dims.x - 1, Math.ceil((lx + pad - lm.x) / cs - 0.5));
    const y0 = Math.max(0, Math.floor((ly - pad - lm.y) / cs - 0.5)), y1 = Math.min(dims.y - 1, Math.ceil((ly + pad - lm.y) / cs - 0.5));
    const q = power * dt;
    let any = false;
    for (let iy = y0; iy <= y1; iy++) {
      const rowBase = iy * dims.x;
      for (let ix = x0; ix <= x1; ix++) {
        const i = cells[rowBase + ix];
        if (i < 0 || !s.active[i]) continue;
        const qx = s.x[i] - lx, qy = s.y[i] - ly;
        const d2 = qx * qx + qy * qy;
        if (d2 > reach * reach) continue;
        s.temp[i] += q * Math.exp(-d2 * inv);
        any = true;
      }
    }
    if (any) {
      const dl = Math.sqrt(dirX * dirX + dirY * dirY);
      if (dl > 1e-9) {
        // kierunek ablacji: w stronę strzelca (układ ciała)
        body._heatDirX = -(m[0] * dirX + m[3] * dirY) / dl;
        body._heatDirY = -(m[1] * dirX + m[4] * dirY) / dl;
      }
      this.hot.add(body);
    }
    return any;
  }

  /** Przewodzenie, stygnięcie, osłabienie belek i ablacja — tylko ciała z ciepłem (raz na krok fizyki). */
  stepThermal(dt) {
    if (!(dt > 0) || this.hot.size === 0) return;
    const D = this.D, t = this.tune;
    const coolK = Math.exp(-t.cool * dt);
    const cond = Math.min(0.03, t.conduct * dt * 0.1);
    for (const B of this.hot) {
      if (!B || B.dead) { this.hot.delete(B); continue; }
      const s = B.nodeStore, e = B.beamStore, T = s.temp, active = s.active;
      if (!T) { this.hot.delete(B); continue; }
      // wartości wyjściowe belek (materiał ciała) — raz na magazyn belek
      if (!B._brkBase || B._brkBaseStore !== e) {
        B._brkBase = Float64Array.from(e.brk);
        B._stiffBase = Float64Array.from(e.stiffness);
        B._brkBaseStore = e;
      }
      const brkBase = B._brkBase, stiffBase = B._stiffBase;
      const adjStart = s.adjStart, adj = s.adj, ea = e.a, eb = e.b, broken = e.broken, brk = e.brk, stiffness = e.stiffness;
      const local = !!D.config.localSolver;
      let maxT = 0, changed = false;
      for (let i = 0; i < s.count; i++) {
        if (!active[i] || !(T[i] > 0)) continue;
        if (cond > 0) {
          for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
            const bi = adj[q];
            if (broken[bi]) continue;
            const o = ea[bi] === i ? eb[bi] : ea[bi];
            if (!active[o] || T[o] >= T[i]) continue;
            const flow = (T[i] - T[o]) * cond;
            T[i] -= flow; T[o] += flow;
          }
        }
        T[i] *= coolK;
        if (T[i] < 0.004) T[i] = 0;
        for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
          const bi = adj[q];
          if (broken[bi]) continue;
          const soft = smooth01(t.soften, t.melt, Math.max(T[ea[bi]], T[eb[bi]]));
          brk[bi] = brkBase[bi] * (1 - 0.85 * soft);
          stiffness[bi] = stiffBase[bi] * (1 - 0.6 * soft);
        }
        if (T[i] >= t.melt && s.invMass[i] > 0) {
          this._ablate(B, i);
          changed = true;
          continue;
        }
        // żar do rysowania (skóra czyta heat 0–1)
        if (s.heat) s.heat[i] = Math.max(s.heat[i] || 0, Math.min(1, T[i] / t.melt));
        if (T[i] > maxT) maxT = T[i];
        if (local && T[i] > t.soften) activateNode(B, i);
      }
      if (changed) { D.wake(B, D.config.wakeHoldFrames); B.meshDirty = true; }
      if (maxT > 0.6 * t.soften) D.wake(B, 2);
      if (!(maxT > 0)) this.hot.delete(B);
    }
  }

  _ablate(B, i) {
    const D = this.D, t = this.tune, s = B.nodeStore, cs = B.cellSize;
    const hx = B._heatDirX || 0, hy = B._heatDirY || 0;
    const r1 = hash01(i, B.id) - 0.5, r2 = hash01(i + 7, B.id) - 0.5;
    const sp = t.ablateSpeedCells * cs;
    s.vx[i] = hx * sp + r1 * sp * 0.6; s.vy[i] = hy * sp + r2 * sp * 0.6;
    const adjStart = s.adjStart, adj = s.adj, e = B.beamStore, rec = t.ablateRecoilCells * cs;
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (e.broken[bi]) continue;
      const o = e.a[bi] === i ? e.b[bi] : e.a[bi];
      if (!s.active[o] || s.invMass[o] <= 0) continue;
      s.vx[o] -= hx * rec; s.vy[o] -= hy * rec;
    }
    s.temp[i] = 0;
    D.destroyNode(B, i);
    this.stats.ablated++;
  }

  /** Krok kanałów zależnych od czasu: fale i ciepło (raz na krok fizyki, przed krokiem silnika). */
  step(dt, bodies) {
    this.stepBlasts(dt, bodies);
    this.stepThermal(dt);
  }

  reset() {
    for (const b of this.blasts) { b.active = false; b.owner = null; }
    this.hot.clear();
  }
}
