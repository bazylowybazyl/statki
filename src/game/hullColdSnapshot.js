/**
 * hullColdSnapshot — MIGAWKA ciała wraku na belkach dla zimnych wraków (src/game/coldWrecks.js, etap 3 portu
 * silnika belek: docs/PORT-silnik-belek.md, docs/BRIEF-zimne-wraki.md § „Belki”).
 *
 * Zimny wrak nie trzyma ciała silnika (magazyny węzłów i belek ~650 B na węzeł). Zostaje migawka względem
 * SZABLONU kadłuba — konstrukcji z obrazu (HullBodies.structureFor), z której powstało ciało rodu: każdy węzeł wraku
 * to komórka siatki (ix, iy, iz) = węzeł szablonu, każda belka między żywymi węzłami = belka szablonu (rozpad i
 * zagęszczenie kopiują belki szablonu, także zerwane). Ze szablonu bierzemy stałe (spoczynek, masa, kolor, sztywność,
 * granice plastyczności, typy belek), w migawce zostaje to, co zmieniła gra:
 *   węzły (rosnąco po indeksie szablonu) — przesunięcie od spoczynku (F32: wgniecenia, ruch wtórny solvera), HP i maks.
 *     HP (F64: pancerz mostka i komory reaktora zmienia maks. HP), próg oparcia (żywe belki przy rozpadzie), łaty
 *     dronów, temperatura broni cieplnej, masa / odwrotność masy, gdy różne od szablonu (węzły ożywione odrostem);
 *   belki (rosnąco po indeksie szablonu) — długość plastyczna (F32 względem bazowej), zerwanie, zmęczenie;
 *   ciało — latticeMin (układ: kotwica wraku = środek masy), masa, tensor, pancerz zderzeń.
 * ~40–80 B na węzeł zamiast ~650 B. Chwilowe pola solvera (prędkości węzłów, znaczniki, obszar aktywny, żar —
 * po ~20 s snu zgasł) się nie zapisują: odtworzone ciało stoi i śpi, jak zasypiający wrak.
 *
 * Zapis SPRAWDZA zgodność ze szablonem (stałe węzłów i belek, pozycje spoczynkowe, komplet belek) — inaczej null
 * i wrak nie marznie (nic się nie zgubi po cichu). Odtworzenie składa ciało przez silnik
 * (DestructorBeams3D.createRestoredBody — ten sam układ pól co wrak z rozpadu).
 *
 * Moduł bez DOM i three; pamięć robocza (mapy szablon → magazyn) w tablicach modułu, zerowana po użyciu.
 */

import { BeamNodeStore, BeamLinkStore, buildAdjacency } from './beamStore3D.js';

export const COLD_BEAM_KIND = 'beam';
export const COLD_BEAM_SNAPSHOT_VERSION = 1;
// Pozycja spoczynkowa węzła wraku vs szablon + przesunięcie latticeMin: przesunięcia układu (rozpad, środek masy)
// zaokrąglają ox i latticeMin osobno — różnica rzędu 1e-9 j.; większa = inna siatka.
const REST_TOL = 1e-4;

let _toStore = new Int32Array(0);    // węzeł szablonu → indeks w magazynie wraku (−1)
let _toLocal = new Int32Array(0);    // węzeł szablonu → indeks w migawce / ciele odtworzonym (−1)
let _beamList = new Int32Array(0);   // belki szablonu między żywymi węzłami (rosnąco)
let _usedBeam = new Uint8Array(0);   // belka magazynu wraku już dopasowana (przy zapisie)
let _mark = new Uint8Array(0);       // wpis magazynu w migawce: 1 — żywy, 2 — martwy sąsiad żywego

function ensureMinusOne(arr, n) {
  if (arr.length >= n) return arr;
  const next = new Int32Array(Math.max(n, arr.length * 2));
  next.fill(-1);
  return next;
}

function scratchMaps(templateCount) {
  _toStore = ensureMinusOne(_toStore, templateCount);
  _toLocal = ensureMinusOne(_toLocal, templateCount);
}

function ensureBeamList(n) {
  if (_beamList.length < n) _beamList = new Int32Array(Math.max(n, _beamList.length * 2, 1024));
  return _beamList;
}

/**
 * Belki szablonu, których oba końce są w zbiorze (`toLocal[t] ≥ 0`), w kolejności indeksów szablonu — z list
 * sąsiedztwa żywych węzłów (każda belka raz, od końca `a`), potem sortowanie. Zwraca liczbę w _beamList.
 */
function collectTemplateBeams(ts, te, tpl, n, toLocal) {
  let deg = 0;
  for (let j = 0; j < n; j++) deg += ts.adjStart[tpl[j] + 1] - ts.adjStart[tpl[j]];
  const list = ensureBeamList(deg);
  const adj = ts.adj, adjStart = ts.adjStart, ta = te.a, tb = te.b;
  let m = 0;
  for (let j = 0; j < n; j++) {
    const t = tpl[j];
    for (let q = adjStart[t]; q < adjStart[t + 1]; q++) {
      const b = adj[q];
      if (ta[b] !== t || toLocal[tb[b]] < 0) continue;
      list[m++] = b;
    }
  }
  list.subarray(0, m).sort();
  return m;
}

/**
 * Migawka ciała wraku. `template` = { structure, cells } — konstrukcja z obrazu rodu i indeks komórka (ix + iy·dx +
 * iz·dx·dy) → węzeł szablonu. null = ciało nie leży na szablonie (inna siatka, belka spoza szablonu, zmienione
 * stałe) — takiego wraku nie zamrażamy.
 */
export function captureBeamColdSnapshot(hull, template) {
  const body = hull?.body;
  const T = template?.structure, cells = template?.cells;
  if (!body || body.dead || body.activeNodes <= 0 || !T || !cells) return null;
  const s = body.nodeStore, e = body.beamStore, ts = T.nodeStore, te = T.beamStore;
  const d = body.dims, td = T.dims;
  if (!d || !td || d.x !== td.x || d.y !== td.y || d.z !== td.z) return null;
  const dimX = d.x, dimXY = d.x * d.y, cellCount = d.x * d.y * d.z;

  // Węzły migawki: żywe + MARTWE wpisy magazynu sąsiadujące z żywymi belką poszycia (|Δix|, |Δiy| ≤ 1). Skóra
  // (beamHullSkin.js) rysuje rozdarty, ciemniejszy brzeg narożnika przy martwym sąsiedzie, którego wpis jest
  // w magazynie (wrak z całego kadłuba, rozpad w miejscu) — bez takich wpisów (zagęszczony odłam) brzeg jest gładki.
  // Dalsze martwe wpisy nic nie zmieniają (ani w fizyce, ani w obrazie) — przepadają.
  if (_mark.length < s.count) _mark = new Uint8Array(Math.max(s.count, _mark.length * 2));
  const mark = _mark;
  let n = 0;
  for (let i = 0; i < s.count; i++) if (s.active[i]) { mark[i] = 1; n++; }
  if (n === 0) return null;
  const adj = s.adj, adjStart = s.adjStart, ea = e.a, eb = e.b, sx = s.ix, sy = s.iy;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const bi = adj[q];
      const m = ea[bi] === i ? eb[bi] : ea[bi];
      if (mark[m] || Math.abs(sx[m] - sx[i]) > 1 || Math.abs(sy[m] - sy[i]) > 1) continue;
      mark[m] = 2;
      n++;
    }
  }
  scratchMaps(ts.count);
  const toStore = _toStore, toLocal = _toLocal;
  const tpl = new Int32Array(n);
  let ok = true, k = 0;
  for (let i = 0; i < s.count && ok; i++) {
    if (!mark[i]) continue;
    const ix = s.ix[i], iy = s.iy[i], iz = s.iz[i];
    const c = ix + iy * dimX + iz * dimXY;
    const t = (ix >= 0 && iy >= 0 && iz >= 0 && ix < d.x && iy < d.y && iz < d.z && c < cellCount) ? cells[c] : -1;
    // Dwa wpisy w jednej komórce (albo komórka spoza szablonu) — nie ta siatka.
    if (t < 0 || toStore[t] >= 0) { ok = false; break; }
    toStore[t] = i;
    tpl[k++] = t;
  }
  if (!ok) {
    mark.fill(0, 0, s.count);
    for (let j = 0; j < k; j++) toStore[tpl[j]] = -1;
    return null;
  }
  tpl.sort();
  for (let j = 0; j < n; j++) toLocal[tpl[j]] = j;
  const snap = captureWithMaps(hull, body, T, s, e, ts, te, tpl, n, toStore, toLocal, mark);
  mark.fill(0, 0, s.count);
  for (let j = 0; j < n; j++) { toStore[tpl[j]] = -1; toLocal[tpl[j]] = -1; }
  return snap;
}

function captureWithMaps(hull, body, T, s, e, ts, te, tpl, n, toStore, toLocal, inSnapshot) {
  let massMul = Number(hull.massMul);
  if (!(massMul > 0)) {
    const t0 = tpl[0];
    massMul = ts.mass[t0] > 0 ? s.mass[toStore[t0]] / ts.mass[t0] : 1;
  }
  const lm = body.latticeMin, tlm = T.latticeMin;
  const offX = lm.x - tlm.x, offY = lm.y - tlm.y, offZ = lm.z - tlm.z;

  // ---- węzły ----
  const dx = new Float32Array(n), dy = new Float32Array(n);
  const hp = new Float64Array(n), maxHp = new Float64Array(n);
  const support = new Uint16Array(n);
  let dz = null, patch = null, temp = null, mass = null, invMass = null, dead = null;
  let live = 0;
  for (let j = 0; j < n; j++) {
    const t = tpl[j], i = toStore[t];
    if (s.active[i]) live++;
    else { if (!dead) dead = new Uint8Array(n); dead[j] = 1; }
    if (s.coverage[i] !== ts.coverage[t] || s.r[i] !== ts.r[t] || s.g[i] !== ts.g[t] || s.b[i] !== ts.b[t] ||
        s.depth[i] !== ts.depth[t] || s.localBeamCount[i] !== ts.localBeamCount[t] ||
        s.platingCount[i] !== ts.platingCount[t] || s.surface[i] !== ts.surface[t]) return null;
    if (Math.abs(s.ox[i] - (ts.ox[t] + offX)) > REST_TOL || Math.abs(s.oy[i] - (ts.oy[t] + offY)) > REST_TOL ||
        Math.abs(s.oz[i] - (ts.oz[t] + offZ)) > REST_TOL) return null;
    if (!(s.beamCount[i] >= 0 && s.beamCount[i] <= 0xffff)) return null;
    dx[j] = s.x[i] - s.ox[i];
    dy[j] = s.y[i] - s.oy[i];
    const z = s.z[i] - s.oz[i];
    if (z !== 0) { if (!dz) dz = new Float32Array(n); dz[j] = z; }
    hp[j] = s.hp[i];
    maxHp[j] = s.maxHp[i];
    support[j] = s.beamCount[i];
    if (s.patch[i] !== 0) { if (!patch) patch = new Uint8Array(n); patch[j] = s.patch[i]; }
    if (s.temp[i] !== 0) { if (!temp) temp = new Float32Array(n); temp[j] = s.temp[i]; }
    // Masa poza szablonem (węzeł ożywiony odrostem: 1 / m zamiast odwrotności szablonu) — dokładnie, w osobnych tablicach.
    if (s.mass[i] !== ts.mass[t] * massMul) {
      if (!mass) { mass = new Float64Array(n); for (let q = 0; q < j; q++) mass[q] = ts.mass[tpl[q]] * massMul; }
    }
    if (mass) mass[j] = s.mass[i];
    if (s.invMass[i] !== ts.invMass[t] / massMul) {
      if (!invMass) { invMass = new Float64Array(n); for (let q = 0; q < j; q++) invMass[q] = ts.invMass[tpl[q]] / massMul; }
    }
    if (invMass) invMass[j] = s.invMass[i];
  }

  // ---- belki: szablon w kolejności indeksów; każda dopasowana do belki magazynu wraku (te same końce i typ) ----
  const m = collectTemplateBeams(ts, te, tpl, n, toLocal);
  const list = _beamList;
  if (_usedBeam.length < e.count) _usedBeam = new Uint8Array(Math.max(e.count, _usedBeam.length * 2));
  const used = _usedBeam;
  const restDelta = new Float32Array(m);
  const broken = new Uint8Array(m);
  let fatigue = null;
  const ea = e.a, eb = e.b, adj = s.adj, adjStart = s.adjStart;
  let matched = 0, ok = true;
  for (let q = 0; q < m && ok; q++) {
    const b = list[q];
    const ia = toStore[te.a[b]], ib = toStore[te.b[b]];
    let bi = -1;
    for (let p = adjStart[ia]; p < adjStart[ia + 1]; p++) {
      const c = adj[p];
      if (used[c] || ea[c] !== ia || eb[c] !== ib || e.type[c] !== te.type[b] || e.restBase[c] !== te.restBase[b]) continue;
      bi = c;
      break;
    }
    // `strain` belki to ostatni pomiar solvera (chwilowy, liczony od nowa przy każdym rzucie) — nie zapisujemy.
    if (bi < 0 || e.stiffness[bi] !== te.stiffness[b] || e.deform[bi] !== te.deform[b] || e.brk[bi] !== te.brk[b] ||
        e.restBridge[bi] !== te.restBridge[b]) { ok = false; break; }
    used[bi] = 1;
    matched++;
    restDelta[q] = e.rest[bi] - te.restBase[b];
    broken[q] = e.broken[bi];
    const f = e.fatigue[bi];
    if (f !== 0) { if (!fatigue) fatigue = new Float32Array(m); fatigue[q] = f; }
  }
  // Komplet: każda belka magazynu między węzłami migawki ma swoją belkę szablonu (i odwrotnie).
  let inSet = 0;
  for (let c = 0; c < e.count; c++) {
    if (used[c]) { used[c] = 0; inSet++; continue; }
    if (ok && inSnapshot[ea[c]] && inSnapshot[eb[c]]) ok = false;
  }
  if (!ok || matched !== m || inSet !== m) return null;

  const inv = body.invInertiaLocal;
  // AGENT: zrzut zimnego wraku do zapisu świata — tablice typowane (base64) + id obrazu kadłuba rodu zamiast
  // rekordu `hull` (obraz, skala i komórka wyznaczają szablon: HullBodies.structureFor); dziś zapisu świata nie ma.
  return {
    kind: COLD_BEAM_KIND,
    version: COLD_BEAM_SNAPSHOT_VERSION,
    hull: null,                       // rekord kadłuba — dopisuje HullBodies.captureColdSnapshot
    nodeCount: n,
    beamCount: m,
    tpl,
    dx, dy, dz,
    hp, maxHp,
    support,
    patch, temp, mass, invMass,
    dead,                             // 1 — martwy wpis (sąsiad żywego, brzeg rozdarcia skóry); null — same żywe
    massMul,
    restDelta, broken, fatigue,
    name: body.name,
    latticeMin: { x: lm.x, y: lm.y, z: lm.z },
    skinLatticeMin: { x: body.skinLatticeMin.x, y: body.skinLatticeMin.y, z: body.skinLatticeMin.z },
    bodyMass: body.mass,
    invInertiaLocal: Array.from(inv),
    collisionArmor: body.collisionArmor,
    liveNodes: live,
    // Rysowanie (smuga) i streszczenie dla UI dopisuje gra (coldWrecks / hexShips3D).
    impostor: null,
    color: null,
    summary: null
  };
}

/** Szacunek pamięci migawki [B] (tablice typowane). */
export function beamColdSnapshotBytes(snap) {
  if (!snap || snap.kind !== COLD_BEAM_KIND) return 0;
  let bytes = 0;
  for (const key of ['tpl', 'dx', 'dy', 'dz', 'hp', 'maxHp', 'support', 'patch', 'temp', 'mass', 'invMass', 'dead',
    'restDelta', 'broken', 'fatigue']) {
    const a = snap[key];
    if (a && a.byteLength) bytes += a.byteLength;
  }
  return bytes;
}

/**
 * Ciało wraku z migawki (stoi i śpi). `engine` = DestructorBeams3D (createRestoredBody). null — migawka nie pasuje
 * do szablonu (inna liczba belek).
 */
export function restoreBeamColdBody(snap, template, engine) {
  const T = template?.structure;
  if (!snap || snap.kind !== COLD_BEAM_KIND || !T || !engine) return null;
  const ts = T.nodeStore, te = T.beamStore;
  const n = snap.nodeCount, tpl = snap.tpl;
  scratchMaps(ts.count);
  const toLocal = _toLocal;
  for (let j = 0; j < n; j++) {
    const t = tpl[j];
    if (!(t >= 0 && t < ts.count)) {
      for (let q = 0; q < j; q++) toLocal[tpl[q]] = -1;
      return null;
    }
    toLocal[t] = j;
  }
  const body = restoreWithMap(snap, T, ts, te, tpl, n, toLocal, engine);
  for (let j = 0; j < n; j++) toLocal[tpl[j]] = -1;
  return body;
}

function restoreWithMap(snap, T, ts, te, tpl, n, toLocal, engine) {
  const m = collectTemplateBeams(ts, te, tpl, n, toLocal);
  if (m !== snap.beamCount) return null;
  const list = _beamList;
  const lm = snap.latticeMin, tlm = T.latticeMin;
  const offX = lm.x - tlm.x, offY = lm.y - tlm.y, offZ = lm.z - tlm.z;
  const massMul = snap.massMul;
  const ns = new BeamNodeStore(n);
  let maxDisp = 0;
  for (let j = 0; j < n; j++) {
    const t = tpl[j];
    const ox = ts.ox[t] + offX, oy = ts.oy[t] + offY, oz = ts.oz[t] + offZ;
    const ddx = snap.dx[j], ddy = snap.dy[j], ddz = snap.dz ? snap.dz[j] : 0;
    ns.ox[j] = ox; ns.oy[j] = oy; ns.oz[j] = oz;
    const x = ox + ddx, y = oy + ddy, z = oz + ddz;
    ns.x[j] = x; ns.y[j] = y; ns.z[j] = z;
    ns.px[j] = x; ns.py[j] = y; ns.pz[j] = z;
    ns.mass[j] = snap.mass ? snap.mass[j] : ts.mass[t] * massMul;
    ns.invMass[j] = snap.invMass ? snap.invMass[j] : ts.invMass[t] / massMul;
    ns.hp[j] = snap.hp[j];
    ns.maxHp[j] = snap.maxHp[j];
    ns.coverage[j] = ts.coverage[t];
    ns.r[j] = ts.r[t]; ns.g[j] = ts.g[t]; ns.b[j] = ts.b[t];
    if (snap.temp) ns.temp[j] = snap.temp[j];
    ns.ix[j] = ts.ix[t]; ns.iy[j] = ts.iy[t]; ns.iz[j] = ts.iz[t];
    ns.depth[j] = ts.depth[t];
    ns.beamCount[j] = snap.support[j];
    ns.localBeamCount[j] = ts.localBeamCount[t];
    ns.platingCount[j] = ts.platingCount[t];
    const alive = !(snap.dead && snap.dead[j]);
    ns.active[j] = alive ? 1 : 0;
    ns.surface[j] = ts.surface[t];
    if (snap.patch) ns.patch[j] = snap.patch[j];
    if (!alive) continue;
    const disp = Math.max(Math.abs(ddx), Math.abs(ddy), Math.abs(ddz));
    if (disp > maxDisp) maxDisp = disp;
  }
  const bs = new BeamLinkStore(m);
  let liveBeams = 0;
  for (let q = 0; q < m; q++) {
    const b = list[q];
    bs.a[q] = toLocal[te.a[b]];
    bs.b[q] = toLocal[te.b[b]];
    const base = te.restBase[b];
    bs.restBase[q] = base;
    bs.rest[q] = base + snap.restDelta[q];
    bs.stiffness[q] = te.stiffness[b];
    bs.deform[q] = te.deform[b];
    bs.brk[q] = te.brk[b];
    bs.fatigue[q] = snap.fatigue ? snap.fatigue[q] : 0;
    bs.type[q] = te.type[b];
    bs.broken[q] = snap.broken[q];
    bs.restBridge[q] = te.restBridge[b];
    if (!bs.broken[q]) liveBeams++;
  }
  buildAdjacency(ns, bs);
  return engine.createRestoredBody(ns, bs, {
    name: snap.name,
    mass: snap.bodyMass,
    invInertiaLocal: snap.invInertiaLocal,
    cellSize: T.cellSize,
    dims: T.dims,
    latticeMin: snap.latticeMin,
    skinLatticeMin: snap.skinLatticeMin,
    skin: T.skin || null,
    spriteSkin: T.spriteSkin || null,
    liveBeams,
    activeNodes: snap.liveNodes,
    collisionArmor: snap.collisionArmor,
    maxDisp
  });
}
