// HUTA — symulacja procesu (czysta: bez three i DOM; ziarno → ten sam przebieg). Materiał jest fizyczny: to, co statek
// przywiózł, przechodzi kolejno przez rurę odkurzacza, lot bryłek do zasieku, kopiec, przenośnik, piec, kadź, odlewnię,
// klatki walcownicze, zwijarkę, regał placu i naczepę ciężarówki. Nic się nie rodzi ani nie znika — `audit()` liczy
// bilans rudy i metalu każdego toru (test: tests/ringDzielnicaHuta.test.mjs).
//
// Jednostki: tony umowne. Wytop = 60 t metalu (2 kęsiska po 30 t), receptury jak w ekonomii gry (uklad.js).
import { loopAhead, makePath } from './sciezki.js';

export const TUNE = Object.freeze({
  heat: 60, slab: 30, ingotBatch: 30, ingotCap: 60,
  bunkerCap: 900, shipLoad: 360, shipArrive: 12, shipLeave: 11, shipReach: 5200, shipGap: 40,
  vacRate: 6.5, pipeDelay: 1.5, chunkMass: 0.3, gravity: 520, gantrySpeed: 200, trolleySpeed: 260,
  feedRate: 9, feedParcel: 1.5, feedSpeed: 280,
  meltTime: 30, tapTime: 6, pourRate: 9, callAhead: 15,
  ladles: 3, ladleSpeed: 520, ladleAcc: 650, ladleGap: 300,
  castTime: 3.2, lineSpeed: 300, lineGap: 130,
  yardSpeed: 180, yardGap: 140,
  truckCap: 3, truckRoad: 520, truckYard: 300, truckAcc: 300, truckGap: 560, truckEvery: 5, truckWait: 30,
  craneX: 800, craneZ: 520, craneGrab: 0.6,
  kilnSpeed: 55, kilnGap: 160, kilnPress: 26, plate: 3, kilnBatch: 4,
  coolTau: 24
});

/** Stożki kopca dla zapasu `stock` (środkowy, potem dwa boczne): [{ x, z, r, h }] w układzie dzielnicy. */
export function moundCones(lane, stock, out = [{}, {}, {}]) {
  const f = Math.max(0, Math.min(1, stock / TUNE.bunkerCap));
  const rc = 430 * Math.cbrt(Math.min(1, f / 0.5));
  const rs = 380 * Math.cbrt(Math.max(0, Math.min(1, (f - 0.2) / 0.8)));
  const m = lane.mound;
  out[0].x = m.x; out[0].z = m.z; out[0].r = rc; out[0].h = rc * 0.52;
  out[1].x = m.x - 430; out[1].z = m.z + 30; out[1].r = rs; out[1].h = rs * 0.5;
  out[2].x = m.x + 430; out[2].z = m.z - 20; out[2].r = rs * 0.94; out[2].h = rs * 0.47;
  return out;
}
/** Wysokość kopca nad dnem zasieku w punkcie (x, z). */
export function moundHeightAt(cones, x, z) {
  let h = 0;
  for (const c of cones) {
    if (!(c.r > 1)) continue;
    const d = Math.sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z));
    const q = c.h * (1 - d / c.r);
    if (q > h) h = q;
  }
  return h;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeIn = (k) => k * k;
const EPS = 1e-7;

/**
 * @param {object} H   `layout.huta` z buildHutaLayout()
 * @param {object} o   seed — ziarno; prewarm — sekundy symulacji przed chwilą zero (zakład od razu w biegu)
 */
export function createHutaProcess(H, { seed = 7, prewarm = 90 } = {}) {
  const T = TUNE;
  const rnd = mulberry32(seed);
  const lanes = H.lanes;
  const N = lanes.length;
  const zeros = () => new Array(N).fill(0);
  const ore = { initial: zeros(), delivered: zeros(), used: zeros() };
  const metal = { initial: zeros(), made: zeros(), shipped: zeros(), usedIngots: 0 };
  const P = { time: 0, ore, metal, TUNE: T };
  let nextId = 1;

  // ------------------------------------------------------------------ zasieki, statki, odkurzacze, bryłki
  const stock = [470, 430, 380, 420, 300];
  for (let i = 0; i < N; i++) ore.initial[i] = stock[i];
  const CELLS = lanes[0].cells.length;
  const shipStart = [88, 150, 45, 215, 280];
  const ships = lanes.map((L, i) => ({ lane: i, state: 'away', t: 0, off: T.shipReach, timer: shipStart[i], cells: new Float64Array(CELLS), trips: 0 }));
  const vacs = lanes.map((L) => ({ gz: L.gantry.park, tx: 280, cell: 0, headY: 0, sucking: false, pipe: [], spoutAcc: 0, flow: 0 }));
  const chunks = [];
  const cones = lanes.map(() => [{}, {}, {}]);
  const pipeMass = (v) => { let m = v.spoutAcc; for (const q of v.pipe) m += q.m; return m; };
  const airMass = (i) => { let m = 0; for (const c of chunks) if (c.lane === i) m += c.m; return m; };

  function stepShip(i, dt) {
    const s = ships[i];
    const L = lanes[i];
    const v = vacs[i];
    if (s.state === 'away') {
      s.timer -= dt;
      if (s.timer <= 0 && T.bunkerCap - stock[i] >= T.shipLoad + 20) { s.state = 'approach'; s.t = 0; s.cells.fill(T.shipLoad / CELLS); s.trips++; }
    } else if (s.state === 'approach') {
      s.t += dt;
      const k = Math.min(1, s.t / T.shipArrive);
      s.off = T.shipReach * (1 - easeOut(k));
      if (k >= 1) { s.state = 'dock'; s.off = 0; v.cell = 0; }
    } else if (s.state === 'depart') {
      s.t += dt;
      const k = Math.min(1, s.t / T.shipLeave);
      s.off = T.shipReach * easeIn(k);
      if (k >= 1) { s.state = 'away'; s.timer = T.shipGap; }
    }
    // odkurzacz: suwnica po pirsie (z), wózek ssawy po wysięgniku (x); nad polem ładowni ssawa schodzi i ciągnie
    const work = s.state === 'dock' && v.cell < CELLS;
    const tz = work ? L.cells[v.cell].z : L.gantry.park;
    const tx = work ? L.cells[v.cell].x - L.x : 280;
    const dz = tz - v.gz;
    const dx = tx - v.tx;
    const mz = T.gantrySpeed * dt;
    const mx = T.trolleySpeed * dt;
    v.gz += Math.abs(dz) <= mz ? dz : Math.sign(dz) * mz;
    v.tx += Math.abs(dx) <= mx ? dx : Math.sign(dx) * mx;
    const over = work && Math.abs(tz - v.gz) < 3 && Math.abs(tx - v.tx) < 3;
    v.headY = Math.max(0, Math.min(1, v.headY + (work ? 2.5 : -2) * dt));
    v.sucking = false;
    let out = 0;
    if (over && v.headY >= 0.95) {
      const m = Math.min(T.vacRate * dt, s.cells[v.cell]);
      s.cells[v.cell] -= m;
      ore.delivered[i] += m;
      v.pipe.push({ t: T.pipeDelay, m });
      v.sucking = true;
      if (s.cells[v.cell] <= EPS) v.cell++;
    }
    // rura: po opóźnieniu ruda wylatuje z wylotu nad zasiekiem jako bryłki
    while (v.pipe.length && v.pipe[0].t <= dt) { v.spoutAcc += v.pipe[0].m; out += v.pipe[0].m; v.pipe.shift(); }
    for (const q of v.pipe) q.t -= dt;
    while (v.spoutAcc >= T.chunkMass - EPS) { v.spoutAcc -= T.chunkMass; spawnChunk(i, T.chunkMass); }
    if (v.spoutAcc > EPS && !v.pipe.length && !v.sucking) { spawnChunk(i, v.spoutAcc); v.spoutAcc = 0; }
    v.flow += (out / Math.max(dt, 1e-6) - v.flow) * Math.min(1, dt * 6);
    if (s.state === 'dock' && v.cell >= CELLS && !v.pipe.length && Math.abs(v.gz - L.gantry.park) < 3 && v.headY <= 0.01) { s.state = 'depart'; s.t = 0; }
  }
  function spawnChunk(i, m) {
    const L = lanes[i];
    const sp = L.spout;
    const tx = L.mound.x + (rnd() - 0.5) * 260;
    const tz = L.mound.z + (rnd() - 0.5) * 240;
    const tf = 0.78 + 0.25 * rnd();
    chunks.push({ lane: i, m, x: sp.x, y: sp.y, z: sp.z, vx: (tx - sp.x) / tf, vy: 70 + 70 * rnd(), vz: (tz - sp.z) / tf, age: 0, rot: rnd() * 6.283, size: 15 + 13 * rnd() });
  }
  function stepChunks(dt) {
    for (let i = 0; i < N; i++) moundCones(lanes[i], stock[i], cones[i]);
    for (let k = 0; k < chunks.length;) {
      const c = chunks[k];
      c.age += dt;
      c.vy -= T.gravity * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      const B = lanes[c.lane].bunker;
      const inside = c.x > B.x0 + 20 && c.x < B.x1 - 20 && c.z > B.z0 + 20 && c.z < B.z1 - 20;
      const ground = B.floor + moundHeightAt(cones[c.lane], c.x, c.z);
      if ((c.vy < 0 && c.y <= ground + c.size * 0.3) || !inside || c.age > 5) {
        stock[c.lane] += c.m;                     // bryłka dosypuje kopiec
        chunks[k] = chunks[chunks.length - 1];
        chunks.pop();
      } else k++;
    }
  }

  // ------------------------------------------------------------------ przenośniki (paczki rudy albo wlewki jadą ścieżką)
  function conveyor(path, take, give, { rate = T.feedRate, parcel = T.feedParcel, speed = T.feedSpeed } = {}) {
    return { path, take, give, rate, parcel, speed, items: [], want: 0, acc: 0, transit: 0 };
  }
  function stepConveyor(c, dt) {
    if (c.want > EPS) {
      c.acc += c.rate * dt;
      while (c.acc >= c.parcel && c.want > EPS) {
        const got = c.take(Math.min(c.parcel, c.want));
        if (!(got > EPS)) { c.acc = c.parcel; break; }
        c.items.push({ d: 0, m: got });
        c.want -= got; c.transit += got; c.acc -= c.parcel;
      }
    } else c.acc = 0;
    for (const it of c.items) it.d += c.speed * dt;
    while (c.items.length && c.items[0].d >= c.path.length) { const it = c.items.shift(); c.transit -= it.m; c.give(it.m); }
  }
  const takeStock = (i) => (m) => { const g = Math.min(m, stock[i]); stock[i] -= g; return g; };

  // ------------------------------------------------------------------ piece
  let ingotStock = 0;
  const furnaces = lanes.slice(0, 4).map((L, i) => ({ lane: i, state: 'idle', t: 0, got: 0, gotIngots: 0, melt: 0, melt0: T.heat, ladle: null, heats: 0 }));
  const feeds = furnaces.map((f) => conveyor(lanes[f.lane].feed, takeStock(f.lane), (m) => { f.got += m; }));
  const ingotFeed = conveyor(H.ingotFeed, (m) => { const g = Math.min(m, ingotStock); ingotStock -= g; return g; }, (m) => { furnaces[3].gotIngots += m; }, { rate: 5, parcel: 3, speed: 200 });
  function stepFurnace(f, dt) {
    const L = lanes[f.lane];
    const feed = feeds[f.lane];
    const needIng = L.ingots || 0;
    if (f.state === 'idle') {
      if (stock[f.lane] + feed.transit + f.got >= L.need * 0.3) f.state = 'charge';
    }
    if (f.state === 'charge') {
      feed.want = Math.max(0, L.need - f.got - feed.transit);
      if (needIng) ingotFeed.want = Math.max(0, needIng - f.gotIngots - ingotFeed.transit);
      if (f.got >= L.need - 1e-6 && f.gotIngots >= needIng - 1e-6) { f.state = 'melt'; f.t = 0; }
    } else if (f.state === 'melt') {
      f.t += dt;
      if (f.t >= T.meltTime) {
        ore.used[f.lane] += f.got; f.got = 0;
        if (needIng) { metal.usedIngots += f.gotIngots; f.gotIngots = 0; }
        f.melt = T.heat;
        metal.made[f.lane] += T.heat;
        // glin: część wytopu idzie na wlewki do stopu tytanu
        if (f.lane === 2 && ingotStock + ingotFeed.transit + furnaces[3].gotIngots <= T.ingotCap - T.ingotBatch + 1e-6) { ingotStock += T.ingotBatch; f.melt -= T.ingotBatch; }
        f.melt0 = f.melt;
        f.state = 'ready';
        f.heats++;
      }
    } else if (f.state === 'tap') {
      const m = Math.min((f.melt0 / T.tapTime) * dt, f.melt);
      f.melt -= m;
      f.ladle.melt += m;
      if (f.melt <= EPS) { f.melt = 0; f.state = 'idle'; f.ladle.state = 'toCast'; f.ladle.arrived = false; f.ladle = null; }
    }
  }
  /** Poziom i żar kąpieli do rysunku: { level 0…1, heat 0…1 }. */
  P.furnaceLook = (f, out = {}) => {
    const L = lanes[f.lane];
    if (f.state === 'charge' || f.state === 'idle') { out.level = 0.12 + 0.6 * Math.min(1, f.got / L.need); out.heat = 0.14 + 0.1 * Math.min(1, f.got / L.need); }
    else if (f.state === 'melt') { const k = Math.min(1, f.t / T.meltTime); out.level = 0.72; out.heat = 0.24 + 0.76 * k * k * (3 - 2 * k); }
    else if (f.state === 'ready') { out.level = 0.72; out.heat = 1; }
    else { out.level = 0.12 + 0.6 * (f.melt / T.heat); out.heat = 1; }
    return out;
  };

  // ------------------------------------------------------------------ kadzie na pętli (jazda w jedną stronę)
  const loop = H.loop;
  const LD = H.loopD;
  const LP = loop.length;
  const ladles = [];
  for (let k = 0; k < T.ladles; k++) ladles.push({ id: k, d: (LD.park - k * (T.ladleGap + 30) + LP) % LP, v: 0, state: 'park', lane: -1, metalLane: -1, melt: 0, arrived: k === 0 });
  const caster = { lane: -1, buffer: 0, emerging: null, pouring: null, cast: 0 };
  function ladleTarget(l) {
    if (l.state === 'park') return LD.park;
    if (l.state === 'toTap') return LD.taps[l.lane];
    if (l.state === 'toCast') return LD.cast;
    return -1;
  }
  function dispatchLadles() {
    for (const f of furnaces) {
      if (f.ladle) continue;
      const soon = f.state === 'ready' || (f.state === 'melt' && T.meltTime - f.t <= T.callAhead);
      if (!soon) continue;
      let best = null;
      let bd = Infinity;
      for (const l of ladles) {
        if (l.state !== 'park') continue;
        const d = loopAhead(l.d, LD.taps[f.lane], LP);
        if (d < bd) { bd = d; best = l; }
      }
      if (!best) continue;
      best.state = 'toTap'; best.lane = f.lane; best.arrived = false;
      f.ladle = best;
    }
  }
  function stepLadle(l, dt) {
    const target = ladleTarget(l);
    if (target >= 0 && !l.arrived) {
      const ahead = loopAhead(l.d, target, LP);
      let free = ahead;
      for (const o of ladles) {
        if (o === l) continue;
        const g = loopAhead(l.d, o.d, LP) - T.ladleGap;
        if (g < free) free = g;
      }
      if (free < 0) free = 0;
      const want = Math.min(T.ladleSpeed, Math.sqrt(2 * T.ladleAcc * free));
      l.v = l.v < want ? Math.min(want, l.v + T.ladleAcc * dt) : want;
      const move = Math.min(l.v * dt, free);
      l.d = (l.d + move) % LP;
      if (ahead - move <= 0.5) { l.d = target; l.v = 0; l.arrived = true; }
    } else l.v = 0;
    if (l.state === 'toTap' && l.arrived) {
      const f = furnaces[l.lane];
      if (f.state === 'ready') { f.state = 'tap'; l.state = 'fill'; l.metalLane = l.lane; }
    } else if (l.state === 'toCast' && l.arrived) {
      if (caster.lane < 0 && !caster.pouring && !caster.emerging && caster.buffer < EPS) { caster.lane = l.metalLane; caster.pouring = l; l.state = 'pour'; }
    } else if (l.state === 'pour') {
      const m = Math.min(T.pourRate * dt, l.melt);
      l.melt -= m;
      caster.buffer += m;
      if (l.melt <= EPS) { l.melt = 0; l.state = 'park'; l.lane = -1; l.metalLane = -1; l.arrived = false; caster.pouring = null; }
    }
  }

  // ------------------------------------------------------------------ odlewnia i linia walcownicza
  const LN = H.line;
  const line = [];           // kęsiska / pasma: czoło `u` (droga od wyjścia z odlewni), `stage` — ile klatek za sobą
  const stations = { coiler: null, stacker: null };
  /** Koniec pasma (u): w klatce część przed klatką jest jeszcze gruba i krótsza. */
  function tailOf(e) {
    if (e.stage < 3) {
      const us = LN.stands[e.stage];
      if (e.u > us) return us - LN.lens[e.stage] * (1 - (e.u - us) / LN.lens[e.stage + 1]);
    }
    return e.u - LN.lens[e.stage];
  }
  const stopOf = (e) => (lanes[e.lane].product === 'pack' ? LN.stacker : LN.coiler);
  function stepCaster(dt) {
    const c = caster;
    if (!c.emerging && c.buffer >= T.slab - 1e-6 && (!line.length || tailOf(line[line.length - 1]) >= T.lineGap + 10)) { c.emerging = { lane: c.lane, t: 0 }; c.buffer -= T.slab; }
    if (c.emerging) {
      c.emerging.t += dt;
      if (c.emerging.t >= T.castTime) { line.push({ id: nextId++, lane: c.emerging.lane, mass: T.slab, u: LN.lens[0], stage: 0, heat: 0.92 }); c.emerging = null; c.cast++; }
    }
    if (c.lane >= 0 && !c.pouring && !c.emerging && c.buffer < EPS) { c.buffer = 0; c.lane = -1; }
  }
  function stepLine(dt) {
    for (let i = 0; i < line.length; i++) {
      const e = line[i];
      let lim = Infinity;
      if (i > 0) lim = tailOf(line[i - 1]) - T.lineGap;
      const stop = stopOf(e);
      const st = stop === LN.coiler ? 'coiler' : 'stacker';
      if (stations[st]) lim = Math.min(lim, stop - 20);
      const nu = Math.min(e.u + T.lineSpeed * dt, lim);
      if (nu > e.u) e.u = nu;
      while (e.stage < 3 && e.u - LN.stands[e.stage] >= LN.lens[e.stage + 1]) e.stage++;
      const mid = e.u - LN.lens[e.stage] * 0.5;
      if (e.stage === 0 && mid > LN.reheat[0] && mid < LN.reheat[1]) e.heat = Math.min(1, e.heat + dt * 0.9);
      else e.heat *= Math.exp(-dt / (e.stage < 3 ? 80 : 30));
      if (e.stage === 3 && e.u - LN.lens[3] >= stop) {
        // całe pasmo nawinięte (krąg) albo pocięte i ułożone (pakiet blach)
        const kind = lanes[e.lane].product;
        stations[st] = { id: nextId++, lane: e.lane, kind, mass: e.mass, heat: e.heat * 0.9, x: LN.x0 + stop, z: LN.z, yaw: 0, state: 'station', lift: 0 };
        line.splice(i, 1);
        i--;
      }
    }
  }

  // ------------------------------------------------------------------ plac wyrobów: samotoki, regały, suwnice, ciężarówki
  const racks = H.racks.map((R, r) => ({ ...R, index: r, top: 0, items: new Array(R.slots.length).fill(null) }));
  const yardLines = { west: [], east: [], kiln: [] };
  const lineOfRack = (r) => (r === 4 ? 'kiln' : r === 3 ? 'east' : 'west');
  const items = [];          // wszystkie wyroby poza naczepami: stacja, samotok, regał, hak suwnicy
  function enterYard(item) {
    const R = racks[item.lane];
    const name = lineOfRack(item.lane);
    const list = yardLines[name];
    if (R.top >= R.slots.length) return false;
    if (list.length && list[list.length - 1].d < T.yardGap + 10) return false;
    const slot = R.slots[R.top];
    const Y = H.yardLines[name];
    item.slot = R.top++;
    item.route = makePath([...Y.entry, [slot.x, Y.z], [slot.x, slot.z]]);
    item.d = 0;
    item.state = 'conv';
    list.push(item);
    items.push(item);
    return true;
  }
  const _pos = {};
  function stepYardLine(list, dt) {
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      let lim = it.route.length;
      if (k > 0) lim = Math.min(lim, list[k - 1].d - T.yardGap);
      const nd = Math.min(it.d + T.yardSpeed * dt, lim);
      if (nd > it.d) it.d = nd;
      it.route.at(it.d, _pos);
      it.x = _pos.x; it.z = _pos.z;
      if (it.d >= it.route.length - 0.01) {
        it.state = 'rack';
        racks[it.lane].items[it.slot] = it;
        it.route = null;
        list.splice(k, 1);
        k--;
      }
    }
  }
  const rackReady = (R) => { let n = 0; for (let k = 0; k < R.top; k++) if (R.items[k] && R.items[k].state === 'rack') n++; return n; };
  function addRackItem(r, heat = 0) {
    const R = racks[r];
    const L = lanes[r];
    const slot = R.slots[R.top];
    const mass = L.product === 'plate' ? T.plate : T.slab;
    const it = { id: nextId++, lane: r, kind: L.product, mass, heat, x: slot.x, z: slot.z, yaw: 0, state: 'rack', slot: R.top, lift: 0 };
    R.items[R.top++] = it;
    items.push(it);
    metal.initial[r] += mass;
  }
  [10, 6, 5, 6, 7].forEach((n, r) => { for (let k = 0; k < n; k++) addRackItem(r); });

  // Ciężarówki: jedna trasa na regał (z zatoką przy regale). Odstępy liczone po postępie `prog` na trasie głównej;
  // ciężarówka w zatoce nie blokuje pasa, a wyjeżdża z zatoki dopiero, gdy pas obok jest wolny.
  const TR = H.truck;
  const trucks = [];
  const truckFor = new Array(racks.length).fill(null);       // ciężarówka w drodze do regału albo pod suwnicą
  let truckClock = 0;
  let trucksOut = 0;
  const _tp = {};
  const CAB = 215;                                            // kabina przed środkiem naczepy
  /** Miejsce ładunku j na naczepie (0 = pierwsze za kabiną) w układzie dzielnicy. */
  P.truckSlot = (t, j, out = {}) => { TR.routes[t.rack].at(t.d - 105 - 110 * j, _tp); out.x = _tp.x; out.z = _tp.z; out.h = _tp.h; return out; };
  function placeTruck(t) {
    TR.routes[t.rack].at(t.d, _tp);
    t.x = _tp.x; t.z = _tp.z; t.h = _tp.h;
    t.prog = TR.main.nearest(t.x, t.z);
    t.inBay = Math.abs(t.z - TR.laneZ) > 50 && Math.abs(t.z - TR.bayZ) < 90;
  }
  function stepTrucks(dt) {
    truckClock += dt;
    if (truckClock >= T.truckEvery && !trucks.some((t) => t.d < 800)) {
      // regał z największym zapasem, do którego nikt nie jedzie (następna rusza, gdy poprzednia kończy załadunek)
      let best = -1;
      let bn = T.truckCap - 1;
      for (const R of racks) {
        const cur = truckFor[R.index];
        if (cur && !(cur.state === 'load' && cur.load.length >= T.truckCap - 1)) continue;
        const n = rackReady(R) - (cur ? T.truckCap - cur.load.length : 0);
        if (n > bn) { bn = n; best = R.index; }
      }
      if (best >= 0) {
        const t = { id: nextId++, d: 0, v: T.truckRoad * 0.8, rack: best, state: 'in', load: [], pending: 0, t: 0, paint: trucksOut + trucks.length, x: 0, z: 0, h: 0, prog: 0, inBay: false };
        placeTruck(t);
        trucks.push(t);
        truckFor[best] = t;
        truckClock = 0;
      }
    }
    for (let k = 0; k < trucks.length; k++) {
      const t = trucks[k];
      const route = TR.routes[t.rack];
      const target = t.state === 'out' ? route.length : TR.stops[t.rack] + CAB;
      let free = t.state === 'load' ? 0 : target - t.d;
      for (const o of trucks) {
        if (o === t) continue;
        if (t.inBay && t.state === 'out') {
          // wyjazd z zatoki: czekaj, aż pas obok będzie pusty
          if (!o.inBay && o.prog > t.prog - 850 && o.prog < t.prog + 640) free = 0;
          continue;
        }
        if (o.inBay && o.rack !== t.rack) continue;
        if (o.prog > t.prog) free = Math.min(free, o.prog - t.prog - T.truckGap);
      }
      if (free < 0) free = 0;
      const vmax = t.prog > TR.yard0 - 250 && t.prog < TR.yard1 + 150 ? T.truckYard : T.truckRoad;
      const want = Math.min(vmax, Math.sqrt(2 * T.truckAcc * free));
      t.v = t.v < want ? Math.min(want, t.v + T.truckAcc * dt) : Math.max(want, t.v - T.truckAcc * 2.2 * dt);
      t.d += Math.min(t.v * dt, free);
      if (t.state === 'in' && target - t.d <= 0.5) { t.d = target; t.v = 0; t.state = 'load'; t.t = 0; }
      else if (t.state === 'load') {
        t.t += dt;
        if (!t.pending && (t.load.length >= T.truckCap || (t.t > T.truckWait && t.load.length >= 1))) { t.state = 'out'; if (truckFor[t.rack] === t) truckFor[t.rack] = null; }
      } else if (t.state === 'out' && t.d >= route.length - 0.5) {
        for (const it of t.load) metal.shipped[it.lane] += it.mass;
        trucks.splice(k, 1);
        trucksOut++;
        k--;
        continue;
      }
      placeTruck(t);
      // ładunek jedzie z naczepą
      for (let j = 0; j < t.load.length; j++) { const it = t.load[j]; P.truckSlot(t, j, _tp); it.x = _tp.x; it.z = _tp.z; it.yaw = _tp.h; }
    }
  }

  const cranes = H.cranes.map((C) => ({ ...C, x: C.home, z: (C.z0 + C.z1) / 2, state: 'idle', item: null, truck: null, j: 0, t: 0, hook: 0, moves: 0 }));
  function craneGo(c, x, z, dt) {
    x = Math.max(c.x0, Math.min(c.x1, x));
    z = Math.max(c.z0 + 60, Math.min(c.z1 - 60, z));
    const dx = x - c.x;
    const dz = z - c.z;
    const mx = T.craneX * dt;
    const mz = T.craneZ * dt;
    c.x += Math.abs(dx) <= mx ? dx : Math.sign(dx) * mx;
    c.z += Math.abs(dz) <= mz ? dz : Math.sign(dz) * mz;
    return Math.abs(x - c.x) < 0.5 && Math.abs(z - c.z) < 0.5;
  }
  function stepCrane(c, dt) {
    if (c.state === 'idle') {
      for (const r of c.racks) {
        const t = trucks.find((q) => q.rack === r && q.state === 'load');
        const R = racks[r];
        if (!t || t.load.length + t.pending >= T.truckCap || R.top < 1) continue;
        const it = R.items[R.top - 1];
        if (!it || it.state !== 'rack') continue;
        R.items[--R.top] = null;
        it.state = 'reserved';
        c.item = it; c.truck = t; c.j = t.load.length + t.pending; t.pending++;
        c.state = 'toPick';
        break;
      }
      if (c.state === 'idle') { craneGo(c, c.home, (c.z0 + c.z1) / 2, dt); c.hook = Math.max(0, c.hook - dt * 2.5); }
    }
    if (c.state === 'toPick') {
      c.hook = Math.max(0, c.hook - dt * 2.5);
      if (craneGo(c, c.item.x, c.item.z, dt)) { c.state = 'grab'; c.t = 0; }
    } else if (c.state === 'grab') {
      c.t += dt;
      c.hook = Math.min(1, c.t / (T.craneGrab * 0.5));
      if (c.t >= T.craneGrab) { c.item.state = 'hook'; c.state = 'toDrop'; }
    } else if (c.state === 'toDrop') {
      c.hook = Math.max(0, c.hook - dt * 2.5);
      const s = P.truckSlot(c.truck, c.j, _tp);
      const at = craneGo(c, s.x, s.z, dt);
      c.item.x = c.x; c.item.z = c.z; c.item.yaw = s.h; c.item.lift = 1 - c.hook;
      if (at) { c.state = 'drop'; c.t = 0; }
    } else if (c.state === 'drop') {
      c.t += dt;
      c.hook = Math.min(1, c.t / (T.craneGrab * 0.5));
      c.item.lift = 1 - c.hook;
      if (c.t >= T.craneGrab) {
        const it = c.item;
        it.state = 'truck'; it.lift = 0;
        items.splice(items.indexOf(it), 1);
        c.truck.load.push(it);
        c.truck.pending--;
        c.item = null; c.truck = null; c.state = 'idle'; c.moves++;
      }
    }
  }

  // ------------------------------------------------------------------ ceramika: mieszalnia, prasa, piec tunelowy
  const KL = lanes[4].kiln;
  const kiln = { mixAlu: 0, mixC: 0, plates: [], t: T.kilnPress, length: KL.z0 - KL.z1, pressed: 0, out: null };
  const crossFeed = conveyor(H.cross, takeStock(2), (m) => { kiln.mixAlu += m; });
  const carbonFeed = conveyor(lanes[4].feed, takeStock(4), (m) => { kiln.mixC += m; });
  function stepKiln(dt) {
    const L = lanes[4];
    if (kiln.mixAlu + crossFeed.transit + crossFeed.want < L.needAlu) crossFeed.want += L.needAlu * T.kilnBatch;
    if (kiln.mixC + carbonFeed.transit + carbonFeed.want < L.need) carbonFeed.want += L.need * T.kilnBatch;
    kiln.t += dt;
    const last = kiln.plates[kiln.plates.length - 1];
    if (kiln.t >= T.kilnPress && kiln.mixAlu >= L.needAlu - 1e-6 && kiln.mixC >= L.need - 1e-6 && (!last || last.u >= T.kilnGap)) {
      kiln.mixAlu -= L.needAlu; kiln.mixC -= L.need;
      ore.used[2] += L.needAlu; ore.used[4] += L.need;
      metal.made[4] += T.plate;
      kiln.plates.push({ id: nextId++, u: 0, heat: 0.05 });
      kiln.t = 0;
      kiln.pressed++;
    }
    for (let k = 0; k < kiln.plates.length; k++) {
      const p = kiln.plates[k];
      let lim = kiln.length;
      if (k > 0) lim = Math.min(lim, kiln.plates[k - 1].u - T.kilnGap);
      if (kiln.out) lim = Math.min(lim, kiln.length - T.kilnGap);
      const nu = Math.min(p.u + T.kilnSpeed * dt, lim);
      if (nu > p.u) p.u = nu;
      const q = p.u / kiln.length;
      p.heat = q < 0.3 ? 0.05 + 0.95 * (q / 0.3) : q < 0.68 ? 1 : Math.max(0.3, 1 - (q - 0.68) / 0.32 * 0.7);
    }
    if (!kiln.out && kiln.plates.length && kiln.plates[0].u >= kiln.length - 0.01) {
      const p = kiln.plates.shift();
      kiln.out = { id: p.id, lane: 4, kind: 'plate', mass: T.plate, heat: p.heat, x: KL.x, z: KL.z1, yaw: 0, state: 'station', lift: 0 };
    }
    if (kiln.out && enterYard(kiln.out)) kiln.out = null;
  }

  // ------------------------------------------------------------------ krok
  function stepOnce(dt) {
    P.time += dt;
    for (let i = 0; i < N; i++) stepShip(i, dt);
    stepChunks(dt);
    for (const c of feeds) stepConveyor(c, dt);
    stepConveyor(ingotFeed, dt);
    stepConveyor(crossFeed, dt);
    stepConveyor(carbonFeed, dt);
    for (const f of furnaces) stepFurnace(f, dt);
    dispatchLadles();
    for (const l of ladles) stepLadle(l, dt);
    stepCaster(dt);
    stepLine(dt);
    for (const key of ['coiler', 'stacker']) if (stations[key] && enterYard(stations[key])) stations[key] = null;
    stepYardLine(yardLines.west, dt);
    stepYardLine(yardLines.east, dt);
    stepYardLine(yardLines.kiln, dt);
    stepKiln(dt);
    stepTrucks(dt);
    for (const c of cranes) stepCrane(c, dt);
    const k = Math.exp(-dt / T.coolTau);
    for (const it of items) it.heat *= k;
    for (const key of ['coiler', 'stacker']) if (stations[key]) stations[key].heat *= k;
    for (const t of trucks) for (const it of t.load) it.heat *= k;
  }
  /** Krok symulacji; długi krok dzielony na kawałki ≤ 1/30 s (grawitacja bryłek i automaty stanów). */
  P.step = (dt) => {
    let left = Math.min(dt, 2);
    while (left > 1e-9) { const h = Math.min(left, 1 / 30); stepOnce(h); left -= h; }
  };

  /** Bilans materiału: dla każdego toru różnica „weszło − (jest + wyszło)”; ma być 0. */
  P.audit = () => {
    const oreErr = zeros();
    const metalErr = zeros();
    for (let i = 0; i < N; i++) {
      let have = stock[i] + pipeMass(vacs[i]) + airMass(i);
      if (i < 4) have += feeds[i].transit + furnaces[i].got;
      if (i === 2) have += crossFeed.transit + kiln.mixAlu;
      if (i === 4) have += carbonFeed.transit + kiln.mixC;
      oreErr[i] = ore.initial[i] + ore.delivered[i] - have - ore.used[i];
      let m = 0;
      if (i < 4) m += furnaces[i].melt;
      for (const l of ladles) if (l.metalLane === i) m += l.melt;
      if (caster.lane === i) m += caster.buffer;
      if (caster.emerging && caster.emerging.lane === i) m += T.slab;
      for (const e of line) if (e.lane === i) m += e.mass;
      for (const it of items) if (it.lane === i) m += it.mass;
      for (const key of ['coiler', 'stacker']) if (stations[key] && stations[key].lane === i) m += stations[key].mass;
      for (const t of trucks) for (const it of t.load) if (it.lane === i) m += it.mass;
      if (i === 2) m += ingotStock + ingotFeed.transit + furnaces[3].gotIngots + metal.usedIngots;
      if (i === 4) { m += kiln.plates.length * T.plate; if (kiln.out) m += T.plate; }
      metalErr[i] = metal.initial[i] + metal.made[i] - m - metal.shipped[i];
    }
    return { oreErr, metalErr };
  };
  P.stats = () => ({
    time: P.time, stock: stock.map((s) => Math.round(s)), ships: ships.map((s) => s.state), trips: ships.map((s) => s.trips),
    furnaces: furnaces.map((f) => f.state), heats: furnaces.map((f) => f.heats), ladles: ladles.map((l) => l.state),
    cast: caster.cast, line: line.length, racks: racks.map((R) => rackReady(R)), trucks: trucks.length, trucksOut,
    plates: kiln.pressed, shipped: metal.shipped.map((m) => Math.round(m)), chunks: chunks.length, ingots: ingotStock, craneMoves: cranes.map((c) => c.moves)
  });

  Object.assign(P, {
    lanes, stock, ships, vacs, chunks, cones, feeds, ingotFeed, crossFeed, carbonFeed, furnaces, ladles, caster, line, stations,
    racks, yardLines, items, trucks, cranes, kiln, tailOf, stopOf,
    get ingotStock() { return ingotStock; }
  });
  if (prewarm > 0) { P.step(0); for (let t = 0; t < prewarm; t += 1 / 30) stepOnce(1 / 30); P.time = 0; }
  return P;
}
