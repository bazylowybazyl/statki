// src/game/gasObstacleInput.js
//
// PRZESZKODY GAZU WYBUCHÓW — WEJŚCIE KLATKI po stronie gry (czyste funkcje: bez three, DOM i Core3D; testy node).
// Etap C planu wybuchów (F2 docs/AUDYT-wybuchy-gaz-2026-10-08.md, decyzja użytkownika 2026-10-08 § 10 pkt 3: statyka
// i kadłuby). Szew gra ↔ render jak pył hal K-7 (src/game/hallDustInput.js): gra pakuje Float64Array o STAŁYM układzie
// (GAS_OBST_IN), reżyser wybuchów (src/3d/explosions/explosionFx.js → src/3d/gas/gasGrid.js) czyta tylko tę tablicę.
//
//   STATYKA (budowle w płaszczyźnie gry): pudła — ściany i bryły hal K-7 przy kamerze (k7SolidList: te same co kolizje
//     i pył hal) i bryły trafień suchego doku piratów (shipyardLayout.placeDryDock().hitShapes) bez kawałków, których
//     nie ma na miejscu; kawałek RUSZONY (ciało silnika belek z ranami, wyrwami — taran bramy) — obrys jego ciał
//     (maska z żywych węzłów, src/game/hullFootprint.js). Blok statyki przepisywany tylko przy zmianie (wersja rośnie
//     — reżyser rastruje domeny od nowa); obrysy ruszonych kawałków co STATIC_FOOT_EVERY s.
//   KADŁUBY (okręty, wraki): tylko te, które przecinają domeny gazu (prostokąty od reżysera — `domainRects`), rekord
//     z kotwicą, osiami, prędkością, ω, maską obrysu i kluczem rodu (hull.dmgKey — gospodarz domeny nie jest przeszkodą
//     swojego gazu). Bez domen gazu — nic (koszt 0).
//
// Współrzędne: świat gry (double, y w dół). Reżyser przelicza na scenę (x, −y).
import { hullFootprint, hullFootprintPeek } from './hullFootprint.js';
import { hallToGameAffine, gameToHall } from './hallDustInput.js';
import { hallDustDomain, hallDomainDistance } from '../3d/gasField/hallDustLayout.js';
import { createK7Layout, k7SolidList } from '../3d/haloRing/haloPortK7Layout.js';
import { GAS_HULL_MASK, GAS_HULL_REC, GAS_OBST_IN } from '../3d/gas/gasObstacleLayout.js';

// Układ tablicy mieszka we wspólnym, czystym module (czyta go reżyser wybuchów).
export { GAS_OBST_IN };
export const GAS_OBST_MASK = GAS_HULL_MASK;
export const GAS_OBST_HULL = GAS_HULL_REC;
const MAX_BOXES = GAS_OBST_IN.maxBoxes;
const MAX_FOOTS = GAS_OBST_IN.maxFoots;
const MAX_HULLS = GAS_OBST_IN.maxHulls;
const BOX = GAS_OBST_IN.boxStride;

/** Hale K-7 dalej od kamery niż pół przekątnej kadru + ten zapas [j.] — bez brył w statyce. */
export const GAS_OBST_HALL_REACH = 3000;
/** Hala K-7 bliżej domeny gazu niż pół przekątnej domeny + ten zapas [j.] — w statyce (także poza kadrem). */
export const GAS_OBST_HALL_DOMAIN_REACH = 500;
/** Najwięcej hal K-7 w statyce naraz. */
const MAX_HALLS = 4;
/** Odstęp przebudowy obrysów ruszonych kawałków budowli [s czasu gry] (rany zmieniają obrys co trafienie). */
export const STATIC_FOOT_EVERY = 0.25;
/** Wstępne odrzucenie kadłuba daleko od domen [j.] (większe niż zasięg największego kadłuba gry). */
const HULL_COARSE = 6000;
/**
 * Budżet przebudów obrysu kadłubów na klatkę [ms]: masowa śmierć okrętów daje kilkanaście świeżych wraków naraz (obrys każdego
 * ~0,1–0,5 ms — w bitwie 12 zgonów naraz szczyt 5,5 ms w klatce). Ponad budżet — stary obrys tego samego ciała albo kadłub
 * w następnej klatce.
 */
export const GAS_OBST_REBUILD_MS = 0.3;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createGasObstacleInput() {
  return new Float64Array(GAS_OBST_IN.size);
}

const LAYOUT = createK7Layout();
const K7_SOLIDS = k7SolidList(LAYOUT);
const HALL_DOMAIN = hallDustDomain(LAYOUT);

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

// Skrót liczb (FNV-1a na 32 bitach; liczby całkowite, wersje i klucze) — podpis statyki klatki.
function mix(h, v) {
  h ^= (v | 0);
  h = Math.imul(h, 16777619) >>> 0;
  h ^= ((v / 4294967296) | 0);
  return Math.imul(h, 16777619) >>> 0;
}

/** Pudło statyki (świat gry) do tablicy — `n` = indeks; zwraca n + 1 (poza pojemnością — n). */
export function putGasObstacleBox(out, n, cx, cy, ux, uy, hw, hd) {
  if (n >= MAX_BOXES) return n;
  const o = GAS_OBST_IN.boxBase + n * BOX;
  out[o] = cx; out[o + 1] = cy; out[o + 2] = ux; out[o + 3] = uy; out[o + 4] = hw; out[o + 5] = hd;
  return n + 1;
}

/** Pudło z czworokąta (boxPoly: rogi kolejno; hitShapes suchego doku) — świat gry. */
export function putGasObstacleQuad(out, n, pts) {
  if (!pts || pts.length < 4) return n;
  const p0 = pts[0], p1 = pts[1], p3 = pts[3];
  const ax = p1.x - p0.x, ay = p1.y - p0.y, bx = p3.x - p0.x, by = p3.y - p0.y;
  const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
  if (!(la > 1e-6) || !(lb > 1e-6)) return n;
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) * 0.25, cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) * 0.25;
  return putGasObstacleBox(out, n, cx, cy, ax / la, ay / la, la * 0.5, lb * 0.5);
}

const _uid = new WeakMap();
let _nextUid = 1;

/**
 * Rekord kadłuba (świat gry) od `o`: kotwica i osie układu kadłuba (jak HullBodies.nodeWorld: θ = −(angle + rot),
 * oś X → (c, −s), oś Y → (−s, −c)), róg maski i bok teksla, prędkość, ω, zasięg, klucz rodu, uid i wersja maski,
 * słowa maski. Zwraca false bez obrysu.
 */
export function writeGasObstacleHull(out, o, e, fpIn = null) {
  const H = GAS_OBST_HULL;
  const fp = fpIn || hullFootprint(e, GAS_OBST_MASK.w, GAS_OBST_MASK.h);
  if (!fp || !fp.cells) return false;
  const px = num(e.pos ? e.pos.x : e.x, NaN), py = num(e.pos ? e.pos.y : e.y, NaN);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const th = -(num(e.angle) + fp.rot);
  const c = Math.cos(th), s = Math.sin(th);
  out[o + H.ax] = px; out[o + H.ay] = py;
  out[o + H.ex] = c; out[o + H.ey] = -s;
  out[o + H.fx] = -s; out[o + H.fy] = -c;
  out[o + H.x0] = fp.x0; out[o + H.y0] = fp.y0; out[o + H.tx] = fp.tx; out[o + H.ty] = fp.ty;
  out[o + H.vx] = num(e.vel ? e.vel.x : e.vx); out[o + H.vy] = num(e.vel ? e.vel.y : e.vy);
  out[o + H.w] = num(e.angVel);
  out[o + H.reach] = fp.reach;
  const hull = e.beamHull;
  out[o + H.key] = num(hull && hull.dmgKey);
  let uid = _uid.get(fp);
  if (!uid) { uid = _nextUid++; _uid.set(fp, uid); }
  out[o + H.uid] = uid;
  out[o + H.ver] = fp.version;
  out[o + 17] = 0;
  const words = fp.words;
  for (let k = 0; k < GAS_OBST_MASK.words; k++) out[o + H.mask + k] = words[k];
  return true;
}

// --- statyka -------------------------------------------------------------------------------------------------------

const _aff = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };
const _h = { x: 0, z: 0 };
const _halls = [];   // { key, p0x, p0y, ax, ay, bx, by } — hale w zasięgu tej klatki (pula)
for (let i = 0; i < MAX_HALLS; i++) _halls.push({ key: 0, p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 });
let _hallN = 0;

// Hala w statyce: przy kamerze gracza 1 (kadr + zapas) ALBO przy żywej domenie gazu (prostokąty domen — kamera odjechała
// albo hala gracza 2: inaczej hala obok żywego obłoku wypadała ze statyki, nowy raster był bez ścian i gaz przez nie
// przechodził; przegląd etapu C pkt 12).
function collectHalls(rings, camX, camY, reach, D, nd) {
  _hallN = 0;
  if (!rings) return;
  const camOk = Number.isFinite(camX) && Number.isFinite(camY);
  for (let ri = 0; ri < rings.length; ri++) {
    const col = rings[ri] && rings[ri].collider;
    const halls = col && col.registry && col.registry.halls;
    if (!halls || !col.place) continue;
    for (let k = 0; k < halls.length && _hallN < MAX_HALLS; k++) {
      const owner = halls[k];
      if (!owner || !owner.frame) continue;
      hallToGameAffine(col.place, owner.frame, _aff);
      let near = false;
      if (camOk) {
        gameToHall(_aff, camX, camY, _h);
        near = hallDomainDistance(HALL_DOMAIN, _h.x, _h.z) <= reach;
      }
      for (let d = 0; !near && D && d < nd; d++) {
        const b = d * 4;
        const w = D[b + 2] - D[b], h = D[b + 3] - D[b + 1];
        gameToHall(_aff, (D[b] + D[b + 2]) * 0.5, (D[b + 1] + D[b + 3]) * 0.5, _h);
        near = hallDomainDistance(HALL_DOMAIN, _h.x, _h.z) <= 0.5 * Math.sqrt(w * w + h * h) + GAS_OBST_HALL_DOMAIN_REACH;
      }
      if (!near) continue;
      const H = _halls[_hallN++];
      H.key = (ri + 1) * 16 + (num(owner.index, k) + 1);
      H.p0x = _aff.p0x; H.p0y = _aff.p0y; H.ax = _aff.ax; H.ay = _aff.ay; H.bx = _aff.bx; H.by = _aff.by;
    }
  }
}

// Bryły hali (układ hali x, z; pudło: w wzdłuż kąta, d w poprzek — jak rasterizeHallCells) → pudła świata gry.
function putHallBoxes(out, n, H) {
  for (const s of K7_SOLIDS) {
    const ca = Math.cos(s.angle || 0), sa = Math.sin(s.angle || 0);
    const cx = H.p0x + s.x * H.ax + s.z * H.bx, cy = H.p0y + s.x * H.ay + s.z * H.by;
    let ux = ca * H.ax + sa * H.bx, uy = ca * H.ay + sa * H.by;
    const l = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= l; uy /= l;
    n = putGasObstacleBox(out, n, cx, cy, ux, uy, s.w * 0.5, s.d * 0.5);
  }
  return n;
}

/**
 * Stan statyki trzymany między klatkami (podpis, wersja, czas ostatniej przebudowy obrysów).
 */
export function createGasObstacleState() {
  // deferred — kadłuby bez obrysu, które czekają na budżet, rebuildMs — czas przebudów w klatce, firstBuilds / rebuilds —
  // pierwsze obrysy / przebudowy w klatce, rot — rotacja początku przebudów.
  return { sig: -1, ver: 0, footAt: -1e9, footSig: -1, time: 0, deferred: 0, rebuildMs: 0, firstBuilds: 0, rebuilds: 0, rot: 0 };
}

/**
 * Wejście klatki. `o`:
 *   dt [s] — czas gry (obrysy ruszonych kawałków co STATIC_FOOT_EVERY s), camX / camY / viewHalf — kadr (hale K-7 przy
 *   kamerze), rings — HaloRingGame.entries (kolider: registry.halls, place),
 *   dock — suchy dok: { shapes: [{ chunk, pts }] (hitShapes), status(chunk) → 0 brak / 1 bryła / 2 obrys ciał,
 *          feet(chunk, cb(entity)) — ciała ruszonego kawałka } albo null,
 *   domains (Float64Array prostokątów x0, y0, x1, y1 świata gry — ExplosionFx.domainRects), nDomains,
 *   hulls — listy kandydatów (encje albo tablice encji: gracz, P2, NPC widoczni we mgle, wraki), skip(e) → true =
 *   pomiń (wraki-odłamy budowli, encje ukryte).
 * `state` — createGasObstacleState().
 */
export function packGasObstacleFrame(out, state, o = {}) {
  const I = GAS_OBST_IN;
  out[I.serial] = (out[I.serial] + 1) % 1e9;
  state.time += Math.max(0, num(o.dt));
  // --- statyka: podpis (hale w zasięgu, stan kawałków doku), przebudowa tylko przy zmianie
  collectHalls(o.rings, num(o.camX, NaN), num(o.camY, NaN), Math.max(0, num(o.viewHalf)) + GAS_OBST_HALL_REACH,
    o.domains, Math.max(0, o.nDomains | 0));
  let sig = 2166136261;
  for (let i = 0; i < _hallN; i++) sig = mix(sig, _halls[i].key);
  // dodatkowe pudła (dema, harness — ściana próbna): { version, boxes: [{ cx, cy, ux, uy, hw, hd }] }
  const extra = o.extra && Array.isArray(o.extra.boxes) && o.extra.boxes.length ? o.extra : null;
  if (extra) sig = mix(mix(sig, 104729), num(extra.version));
  const dock = o.dock;
  const shapes = dock && dock.shapes;
  let footSig = 2166136261;
  let feet = 0;
  if (shapes) {
    sig = mix(sig, 7919);
    for (let i = 0; i < shapes.length; i++) {
      const st = dock.status(shapes[i].chunk);
      sig = mix(sig, st);
      if (st === 2) feet++;
    }
  }
  const footDue = feet > 0 && state.time - state.footAt >= STATIC_FOOT_EVERY;
  if (footDue) {
    // obrysy ruszonych kawałków: wersje masek ciał (rany, wyrwy, odpadłe wyspy)
    _foot.sig = 2166136261;
    _seen.clear();
    for (let i = 0; i < shapes.length; i++) {
      const ch = shapes[i].chunk;
      if (_seen.has(ch) || dock.status(ch) !== 2) continue;
      _seen.add(ch);
      dock.feet(ch, footSigOf);
    }
    footSig = _foot.sig;
  }
  if (sig !== state.sig || (footDue && footSig !== state.footSig)) {
    let nb = 0;
    for (let i = 0; i < _hallN; i++) nb = putHallBoxes(out, nb, _halls[i]);
    if (extra) for (const b of extra.boxes) nb = putGasObstacleBox(out, nb, num(b.cx), num(b.cy), num(b.ux, 1), num(b.uy), num(b.hw), num(b.hd));
    _foot.out = out;
    _foot.n = 0;
    if (shapes) {
      _seen.clear();
      for (let i = 0; i < shapes.length; i++) {
        const sh = shapes[i];
        const st = dock.status(sh.chunk);
        if (st === 1) nb = putGasObstacleQuad(out, nb, sh.pts);
        else if (st === 2 && !_seen.has(sh.chunk)) {
          // ruszony kawałek: obrysy jego ciał (główne i wyspy) zamiast brył (raz na kawałek)
          _seen.add(sh.chunk);
          dock.feet(sh.chunk, footPut);
        }
      }
    }
    _foot.out = null;
    out[I.boxes] = nb;
    out[I.foots] = _foot.n;
    state.sig = sig;
    if (footDue) state.footSig = footSig;
    state.ver = (state.ver + 1) % 1e9;
    out[I.statVer] = state.ver + 1;
  }
  if (footDue) { state.footAt = state.time; state.footSig = footSig; }
  // --- kadłuby przy domenach gazu
  out[I.hulls] = 0;
  out[I.dropped] = 0;
  state.deferred = 0;
  state.rebuildMs = 0;
  state.firstBuilds = 0;
  state.rebuilds = 0;
  const nd = Math.max(0, o.nDomains | 0);
  const D = o.domains;
  if (!nd || !D) return out;
  const C = _hc;
  C.out = out; C.D = D; C.nd = nd; C.n = 0; C.dropped = 0;
  C.skip = typeof o.skip === 'function' ? o.skip : null;
  // 1. Kandydaci: wstępny test odległości od domen z zasięgiem obrysu z pamięci (albo z wymiarów encji) — bez liczenia
  //    obrysu. Kolejność naturalna list (gracz, P2, NPC, wraki) = kolejność zapisu.
  _candN = 0;
  _candLost = 0;
  const lists = o.hulls || [];
  for (let l = 0; l < lists.length; l++) {
    const L = lists[l];
    if (!L) continue;
    if (Array.isArray(L)) { for (let i = 0; i < L.length; i++) considerHull(L[i]); }
    else considerHull(L);
  }
  // 2. Przebudowy obrysów w budżecie klatki (czas i opcjonalnie liczba): NAJPIERW kadłuby bez obrysu (świeży wrak, nowy
  //    okręt przy domenie) od najbliższego domenie, potem reszta od rotowanego początku — ostrzeliwane okręty z przodu
  //    list nie zjadają budżetu co klatkę (przegląd etapu C, pkt 3: nowy wrak na końcu listy czekał w nieskończoność).
  const budget = o.rebuildMs ?? GAS_OBST_REBUILD_MS;
  const maxRebuilds = o.rebuildMax ?? Infinity;
  let spent = 0, built = 0, nNew = 0;
  for (let i = 0; i < _candN; i++) {
    // jedno wywołanie obrysu na kandydata w klatce: tu tylko podgląd pamięci, obrys z etapu przebudów idzie do zapisu (_candFp)
    _candFp[i] = null;
    _candNew[i] = hullFootprintPeek(_candE[i], GAS_OBST_MASK.w, GAS_OBST_MASK.h) ? 0 : 1;
    if (_candNew[i]) {
      // wstawianie w kolejności odległości (lista krótka)
      let k = nNew++;
      while (k > 0 && _candD[_order[k - 1]] > _candD[i]) { _order[k] = _order[k - 1]; k--; }
      _order[k] = i;
    }
  }
  for (let k = 0; k < nNew; k++) {
    const i = _order[k];
    if (spent >= budget || built >= maxRebuilds) { state.deferred++; _candNew[i] = 2; continue; }
    const t0 = nowMs();
    const fp = hullFootprint(_candE[i], GAS_OBST_MASK.w, GAS_OBST_MASK.h, true);
    const dt = nowMs() - t0;
    spent += dt;
    _candFp[i] = fp;
    if (fp) { built++; state.firstBuilds++; }
  }
  const rot = (state.rot = ((state.rot | 0) + 1) % 1e9);
  for (let k = 0; k < _candN && spent < budget && built < maxRebuilds; k++) {
    const i = (rot + k) % _candN;
    if (_candNew[i]) continue;
    const e = _candE[i];
    const v0 = hullFootprintPeek(e, GAS_OBST_MASK.w, GAS_OBST_MASK.h);
    const ver0 = v0 ? v0.version : -1;
    const t0 = nowMs();
    const fp = hullFootprint(e, GAS_OBST_MASK.w, GAS_OBST_MASK.h, true);
    const dt = nowMs() - t0;
    _candFp[i] = fp;
    if (fp && fp.version !== ver0) { spent += dt; built++; state.rebuilds++; }
  }
  // 3. Zapis w kolejności naturalnej: limit kadłubów PRZED obrysem, obrys z pamięci (aktualny albo stary tego samego ciała),
  //    dokładny test zasięgu z obrysu.
  for (let i = 0; i < _candN; i++) {
    if (C.n >= MAX_HULLS) C.dropped++;
    else if (_candNew[i] !== 2) writeHull(_candE[i], _candFp[i] || hullFootprint(_candE[i], GAS_OBST_MASK.w, GAS_OBST_MASK.h, false));
    _candE[i] = null;   // bez trzymania encji ani obrysów między klatkami
    _candFp[i] = null;
  }
  out[I.hulls] = C.n;
  out[I.dropped] = C.dropped + _candLost;
  state.rebuildMs = spent;
  C.out = null; C.D = null; C.skip = null;
  return out;
}

// Kontekst klatki (bez domknięć w klatce): obrysy statyki i kadłuby przy domenach.
const _seen = new Set();
const _foot = { out: null, n: 0, sig: 0 };
function footSigOf(e) {
  const fp = hullFootprint(e, GAS_OBST_MASK.w, GAS_OBST_MASK.h);
  _foot.sig = mix(mix(_foot.sig, fp ? fp.version : 0), fp ? (_uid.get(fp) || 0) : 0);
}
function footPut(e) {
  if (_foot.n < MAX_FOOTS && writeGasObstacleHull(_foot.out, GAS_OBST_IN.footBase + _foot.n * GAS_OBST_HULL.stride, e)) _foot.n++;
}
const _hc = { out: null, D: null, nd: 0, n: 0, dropped: 0, skip: null };
// Kandydaci klatki (pula, bez alokacji): encja, odległość do najbliższej domeny (wstępna), bez obrysu w pamięci, kolejność.
const MAX_CAND = 512;
const _candE = new Array(MAX_CAND).fill(null);
const _candD = new Float64Array(MAX_CAND);
const _candNew = new Uint8Array(MAX_CAND);   // 0 — z obrysem w pamięci, 1 — bez (pierwszy obrys), 2 — bez, czeka na budżet
const _candFp = new Array(MAX_CAND).fill(null);
const _order = new Int32Array(MAX_CAND);
let _candN = 0;
let _candLost = 0;

// Zasięg kadłuba do wstępnego testu: obrys z pamięci (z zapasem — ciało mogło urosnąć) albo pół przekątnej / promień encji;
// encja bez wymiarów — HULL_COARSE.
function reachEstimate(e) {
  const fp = hullFootprintPeek(e, GAS_OBST_MASK.w, GAS_OBST_MASK.h);
  if (fp) return fp.reach * 1.1 + 40;
  const w = num(e.w), h = num(e.h), r = num(e.radius);
  const rr = Math.max(r, 0.5 * Math.sqrt(w * w + h * h));
  return rr > 0 ? rr * 1.3 + 60 : HULL_COARSE;
}

// Odległość punktu (px, py) od najbliższego prostokąta domeny (0 w środku).
function domainDistance(D, nd, px, py) {
  let best = Infinity;
  for (let k = 0; k < nd; k++) {
    const b = k * 4;
    const dx = Math.max(D[b] - px, 0, px - D[b + 2]), dy = Math.max(D[b + 1] - py, 0, py - D[b + 3]);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

function considerHull(e) {
  const C = _hc;
  if (!e || e.dead || e.destroyed || e.isWorldPiece) return;
  if (C.skip && C.skip(e)) return;
  const px = num(e.pos ? e.pos.x : e.x, NaN), py = num(e.pos ? e.pos.y : e.y, NaN);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const d = domainDistance(C.D, C.nd, px, py);
  if (!(d < reachEstimate(e))) return;
  if (_candN >= MAX_CAND) { _candLost++; return; }
  _candE[_candN] = e;
  _candD[_candN] = d;
  _candN++;
}

function writeHull(e, fp) {
  const C = _hc;
  if (!fp || !fp.cells) return;
  const px = num(e.pos ? e.pos.x : e.x, NaN), py = num(e.pos ? e.pos.y : e.y, NaN);
  if (!(domainDistance(C.D, C.nd, px, py) < fp.reach)) return;
  if (writeGasObstacleHull(C.out, GAS_OBST_IN.hullBase + C.n * GAS_OBST_HULL.stride, e, fp)) C.n++;
}
