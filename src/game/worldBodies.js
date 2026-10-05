/**
 * worldBodies — CIAŁA ŚWIATA w grze (docs/PLAN-zniszczenia-swiata-3d.md F1/F2): budowle jako PŁASKIE,
 * ZAKOTWICZONE ciała silnika belek — te same co kadłuby okrętów (HullBodies), więc taran to zwykłe zderzenie
 * (zgniot dzielony pancerzem, belki gną się i pękają, wyspy bez kotwicy odpadają z pędem węzłów), a broń niszczy
 * przez solver (worldChannels.js: pęd — orka, ciśnienie — front fali, ciepło — wiązki). Decyzje użytkownika:
 * F0 „jest ten feel”, stacje w grze ZAKOTWICZONE, obrażenia liczy warstwa 2D (ciała płaskie, bryła 3D jedzie po
 * kratownicy — worldBodies3D.js), w grze BEZ dymu, ognia i wybuchów (2026-10-05).
 *
 * Budowla = MIEJSCE (site) z listą KAWAŁKÓW (piece). Kawałek opisuje gospodarz (np. suchy dok —
 * src/game/story/pirateDryDockBodies.js):
 *   { id, kind, weight, bounds: { x0, y0, x1, y1 } (świat gry — bańka), material: { density, armor },
 *     build() → { image (RGBA), upp (j. na piksel), x, y (środek obrazu w grze), angle (kurs osi x obrazu) } | null,
 *     pins(sx, sy) → bool — kotwica (układ obrazu od środka: x w prawo, y w GÓRĘ obrazu, j. świata),
 *     pinGridCells (opcjonalnie) — rzadka siatka fundamentów co tyle komórek kratownicy,
 *     available() (opcjonalnie) → false = kawałka nie ma na miejscu (nie budować ciała),
 *     skinEdgeCells (render — podział skóry, worldBodies3D.js) }
 * Każda spójna składowa kratownicy dostaje kotwice (anchorComponents): w 3D trzyma się budowli poza płaszczyzną.
 * Kawałek w BAŃCE gracza staje się ciałem (budowa w budżecie czasu na krok), nietknięty i daleko — wraca do
 * statyki. Encja kawałka: `isWorldPiece`, `worldPiece` (rekord), stoi (pędu nie ma; ciało zakotwiczone).
 * Wyspa po rozpadzie, która trzyma się kotwicy — kolejna encja budowli tego kawałka (HullBodies.onWorldIsland);
 * wyspa bez kotwicy i ciało, które straci ostatnią kotwicę — WRAK (lista wraków gry całkuje jego ruch),
 * `worldDebris`, z bryłą kawałka (hull.world).
 * Gospodarz dostaje haki miejsca: onLive(piece, live) — kawałek stał się ciałem / wrócił do statyki,
 * onLost(piece) — z kawałka nie zostało nic w miejscu (wszystko odpadło albo zginęło).
 * Bez three i DOM.
 */

import { HullBodies } from './hullBodies.js';
import { WorldChannels, createWorldShell } from './worldChannels.js';

export const WORLD_BODY_TUNE = {
  cellSize: 15,              // j. — komórka ciała świata (jak kadłub w skali 1)
  rasterUpp: 5,              // j. na piksel rastra (3 piksele na komórkę)
  bubbleRadius: 7000,        // kawałki bliżej gracza (obwiednia) stają się ciałami
  releaseRadius: 11000,      // dalej nietknięty kawałek wraca do statyki
  buildBudgetMs: 6,          // czas budowy ciał na krok (co najmniej jedno)
  massPerArea: 2.4,          // domyślna gęstość konstrukcji (kadłub: 1,19)
  armor: 2,                  // domyślny pancerz zderzeń (Atlas 16 — hullArmor.js)
  hexPerNode: 4,             // HP węzła jak kadłub o komórce 15 j. (4 dawne heksy)
  touchDisp: 1.5,            // j. — przesunięcie węzła, od którego kawałek jest „ruszony” (nie wraca do statyki)
  // --- broń gry → kanał pędu ---
  shellNodesPerDamage: 1 / 30,   // masa pocisku w masach węzła na obrażenie (armata 150 → 5 węzłów ≈ działo dema)
  shellMinNodes: 0.05,
  shellRadiusCells: 0.35,
  // Prędkość ORKI (komórki/s): pociski gry lecą 150–800 komórek/s, demo F0 (ocena „jest ten feel”) stroiło
  // kanał na pociskach ~150 komórek/s — szybszy pocisk tej samej masy wybijał węzły z 4–16× energią (railgun
  // 24 obr. niszczył ~19 węzłów trzonu, armata 150 obr. — żadnego). Orka liczy się przy prędkości dema, masa
  // z obrażeń; prawdziwy pocisk traci ten sam UŁAMEK prędkości.
  shellPlowSpeedCells: 150,
  // Hexlance: pręt dema (2400 przy węźle 8,5 = 282 masy węzła — ocena 2026-10-05: „zdecydowanie większa masa”),
  // szeroka niecka (dema: niecka 500 j/s przy pręcie 320 j/s — pełna): niszczy „jak taran”. Prędkość orki jak
  // pręt dema (320 j/s przy komórce 2,7 j. ≈ 118 komórek/s; gra: 800 komórek/s).
  lanceNodes: 282,
  lanceRadiusCells: 1.8,
  lanceDishRings: 3,
  lanceDishFactor: 1.56,
  lancePlowSpeedCells: 118,
  // --- wybuchy (rakiety, torpedy) → kanał ciśnienia ---
  blastPowerPerDamage: 1 / 450,
  blastPowerMax: 6,
  // --- wiązki → kanał ciepła ---
  heatPerDamage: 0.12          // temperatura/s w osi na obrażenie/s wiązki
};

const T = WORLD_BODY_TUNE;
const _shell = createWorldShell();
const _hit = { entity: null, piece: null, x: 0, y: 0, stopped: false, stopT: 1, energy: 0, first: false };

// Kotwice uzupełniające (budowa ciała): siatka fundamentów co `grid` komórek (INDEKSY kratownicy — współrzędne
// świata z tolerancją pół komórki trafiały tylko część linii) i co najmniej kilka kotwic w KAŻDEJ spójnej składowej
// kratownicy. Raster kawałka to rzut brył przecinających płaszczyznę: części, które w 3D trzymają się reszty budowli
// bryłami pod / nad płaszczyzną, w kratownicy bywają osobnymi składowymi (pas nabrzeża trzonu, 49 × 4 węzły) — bez
// kotwicy odpadały przy PIERWSZYM trafieniu w dowolne miejsce ciała (silnik dzieli wyspy dopiero po zerwaniu belki).
// Zwraca liczbę dodanych kotwic. Alokacje tylko przy budowie ciała.
function anchorComponents(body, grid) {
  const s = body.nodeStore, e = body.beamStore;
  const n = s.count;
  let added = 0;
  const pin = (i) => { s.invMass[i] = 0; s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0; added++; };
  if (grid > 0) {
    for (let i = 0; i < n; i++) {
      if (s.active[i] && s.invMass[i] > 0 && s.ix[i] % grid === 0 && s.iy[i] % grid === 0) pin(i);
    }
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  const adjStart = s.adjStart, adj = s.adj, ea = e.a, eb = e.b, broken = e.broken;
  const sub = 4;   // oczko kotwic składowej bez kotwicy (komórki)
  for (let i0 = 0; i0 < n; i0++) {
    if (!s.active[i0] || seen[i0]) continue;
    let top = 0, m = 0, hasPin = false, cx = 0, cy = 0;
    stack[top++] = i0; seen[i0] = 1;
    while (top > 0) {
      const i = stack[--top];
      members[m++] = i;
      if (s.invMass[i] === 0) hasPin = true;
      cx += s.ox[i]; cy += s.oy[i];
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const bi = adj[q];
        if (broken[bi]) continue;
        const o = ea[bi] === i ? eb[bi] : ea[bi];
        if (!s.active[o] || seen[o]) continue;
        seen[o] = 1;
        stack[top++] = o;
      }
    }
    if (hasPin) continue;
    let any = false;
    for (let k = 0; k < m; k++) {
      const i = members[k];
      if (s.ix[i] % sub === 0 && s.iy[i] % sub === 0) { pin(i); any = true; }
    }
    if (any) continue;
    cx /= m; cy /= m;
    let best = members[0], bd = Infinity;
    for (let k = 0; k < m; k++) {
      const i = members[k];
      const d = (s.ox[i] - cx) ** 2 + (s.oy[i] - cy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    pin(best);
  }
  return added;
}

function boundsDist2(b, x, y) {
  const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
  const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
  return dx * dx + dy * dy;
}

function segBoundsHit(b, x0, y0, x1, y1, pad) {
  const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad;
  const minY = Math.min(y0, y1) - pad, maxY = Math.max(y0, y1) + pad;
  return !(maxX < b.x0 || minX > b.x1 || maxY < b.y0 || minY > b.y1);
}

export class WorldBodies {
  constructor() {
    this.sites = [];
    this.channels = null;
    this._entities = [];
    this._bodies = [];
    this._queue = [];
    this._order = [];
    this._orderD = [];
    this.focus = [];
    this.stats = { live: 0, built: 0, released: 0, buildMs: 0, islands: 0, debris: 0, hits: 0, stops: 0, stepMs: 0, stepPeakMs: 0 };
    this._installed = false;
  }

  _install() {
    if (this._installed) return;
    this._installed = true;
    HullBodies.init();
    this.channels = new WorldChannels(HullBodies.engine);
    const prev = HullBodies.onWorldIsland;
    HullBodies.onWorldIsland = (island, parent) => {
      const piece = parent?.worldPiece || island.beamHull?.world || null;
      if (piece) this._addIsland(piece, island);
      if (typeof prev === 'function') prev(island, parent);
    };
  }

  /** Nowe miejsce (budowla). Kawałki zaczynają jako statyka. */
  addSite(site) {
    this._install();
    if (!site || !Array.isArray(site.pieces)) return null;
    this.removeSite(site.id);
    for (const p of site.pieces) {
      p.site = site;
      p.state = 'static';
      p.entity = null;
      p.islands = [];
      p.baseNodes = 0;
      p.touched = false;
      p.lost = false;
      p.queued = false;
    }
    this.sites.push(site);
    return site;
  }

  removeSite(id) {
    const i = this.sites.findIndex((s) => s.id === id);
    if (i < 0) return;
    const site = this.sites[i];
    for (const p of site.pieces) this._releasePiece(p, true);
    this.sites.splice(i, 1);
  }

  site(id) { return this.sites.find((s) => s.id === id) || null; }

  /** Kawałek z encji budowli albo jej odłamu. */
  pieceOf(entity) {
    return entity?.worldPiece || entity?.beamHull?.world || null;
  }

  // ------------------------------------------------------------------ BAŃKA

  /**
   * Krok (fizyka, PRZED HullBodies.step): bańka wokół punktów `focus` ([{ x, y }] — gracz, P2), budowa ciał
   * w budżecie, kotwice i wraki, kanały broni zależne od czasu (fale, ciepło).
   */
  step(dt, focus) {
    if (!this.sites.length) return;
    const tStep0 = nowMs();
    this._install();
    this.focus = focus;
    const R2 = T.bubbleRadius * T.bubbleRadius, F2 = T.releaseRadius * T.releaseRadius;
    for (const site of this.sites) {
      if (site.disabled) continue;
      for (const p of site.pieces) {
        if (p.lost) continue;
        let d2 = Infinity;
        for (let k = 0; k < focus.length; k++) {
          const f = focus[k];
          if (!f) continue;
          const dd = boundsDist2(p.bounds, f.x, f.y);
          if (dd < d2) d2 = dd;
        }
        if (p.state === 'static') {
          if (d2 <= R2 && !p.queued && (typeof p.available !== 'function' || p.available())) { p.queued = true; this._queue.push(p); }
        } else if (p.state === 'live' && !p.touched && d2 > F2) {
          this._releasePiece(p, false);
        }
      }
    }
    // budowa w budżecie czasu (co najmniej jedno ciało na krok)
    if (this._queue.length) {
      const t0 = nowMs();
      let n = 0;
      while (this._queue.length && (n === 0 || nowMs() - t0 < T.buildBudgetMs)) {
        const p = this._queue.shift();
        p.queued = false;
        if (p.state !== 'static' || p.lost || p.site.disabled) continue;
        if (typeof p.available === 'function' && !p.available()) continue;
        this._buildPiece(p);
        n++;
      }
      this.stats.buildMs = nowMs() - t0;
    }
    // stan żywych kawałków: ruszony, utrata kotwic (ciało → wrak), nic nie zostało
    for (const site of this.sites) {
      for (const p of site.pieces) {
        if (p.state !== 'live') continue;
        this._checkPiece(p);
      }
    }
    this._collectBodies();
    this.channels.step(dt, this._bodies);
    // czas kroku (bez kroku silnika — ten liczy HullBodies.step): wykładnicza średnia i szczyt od ostatniego odczytu
    const ms = nowMs() - tStep0;
    this.stats.stepMs = this.stats.stepMs * 0.95 + ms * 0.05;
    if (ms > this.stats.stepPeakMs) this.stats.stepPeakMs = ms;
  }

  _buildPiece(p) {
    let spec = null;
    try { spec = p.build(); } catch (err) { console.warn('[WorldBodies] raster kawałka', p.id, err); }
    if (!spec || !spec.image) { p.lost = true; return; }
    const upp = Number(spec.upp) > 0 ? spec.upp : T.rasterUpp;
    const entity = {
      id: `${p.site.id}:${p.id}`,
      name: p.label || p.id,
      type: 'worldPiece',
      x: spec.x, y: spec.y, vx: 0, vy: 0, angle: spec.angle || 0, angVel: 0,
      radius: 0, mass: 0,
      isWorldPiece: true,
      worldPiece: p,
      static: true,
      isCollidable: true,
      owner: p.site.owner || p.site,
      visual: { spriteScale: upp, spriteScaleX: upp, spriteScaleY: upp, spriteRotation: 0 },
      beamHull: null
    };
    const mat = p.material || {};
    const hull = HullBodies.createHull(entity, spec.image, {
      cellPx: T.cellSize / upp,
      anchored: true,
      pins: typeof p.pins === 'function' ? p.pins : null,
      massPerArea: mat.density || T.massPerArea,
      collisionArmor: mat.armor || T.armor,
      hexPerNode: T.hexPerNode,
      world: p
    });
    if (!hull) { p.lost = true; return; }
    const extraPins = anchorComponents(hull.body, p.pinGridCells | 0);
    if (Number.isFinite(hull.pins)) hull.pins += extraPins;
    p.entity = entity;
    p.image = spec.image;
    p.upp = upp;
    p.baseNodes = hull.body.activeNodes;
    p.islands.length = 0;
    p.touched = false;
    p.state = 'live';
    this.stats.built++;
    // Bez kotwic (kawałek wisi w próżni) — ciało od razu swobodne (pierwszy krok silnika je puści).
    if (typeof p.site.onLive === 'function') p.site.onLive(p, true);
  }

  _releasePiece(p, removing) {
    if (p.state !== 'live') { p.state = removing ? 'static' : p.state; return; }
    for (const e of [p.entity, ...p.islands]) {
      if (!e) continue;
      HullBodies.release(e);
      e.dead = true;
    }
    p.entity = null;
    p.islands.length = 0;
    p.state = 'static';
    this.stats.released++;
    if (typeof p.site.onLive === 'function') p.site.onLive(p, false);
  }

  _addIsland(piece, island) {
    island.worldPiece = piece;
    island.isWorldPiece = true;
    island.static = true;
    island.owner = piece.site?.owner || island.owner;
    piece.islands.push(island);
    piece.touched = true;
    this.stats.islands++;
  }

  // Ruszony kawałek nie wraca do statyki; ciało bez kotwic → wrak (lista wraków gry je prowadzi); bez niczego
  // na miejscu — stracony.
  _checkPiece(p) {
    const list = this._check || (this._check = []);
    list.length = 0;
    if (p.entity) list.push(p.entity);
    for (const e of p.islands) list.push(e);
    let alive = 0;
    let write = 0;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const hull = e?.beamHull;
      const body = hull?.entity === e ? hull.body : null;
      if (!body || body.dead || body.activeNodes <= 0) {
        if (e) e.dead = true;
        continue;
      }
      if (!p.touched && (hull.revision > 0 || (body._maxDisp || 0) > T.touchDisp)) p.touched = true;
      if (!body.anchored) {
        // ostatnia kotwica puściła: cała wyspa leci z pędem węzłów jako wrak z bryłą kawałka
        const wreck = HullBodies.convertToWreck(e);
        if (wreck) { wreck.worldDebris = true; this.stats.debris++; }
        e.dead = true;
        p.touched = true;
        continue;
      }
      alive += body.activeNodes;
      list[write++] = e;
    }
    // przepisz listę (encja główna = pierwsza żywa, reszta wyspy)
    p.entity = write > 0 ? list[0] : null;
    p.islands.length = 0;
    for (let k = 1; k < write; k++) p.islands.push(list[k]);
    p.alive = alive;
    if (write === 0 && !p.lost) {
      p.lost = true;
      p.state = 'lost';
      if (typeof p.site.onLost === 'function') p.site.onLost(p);
    }
  }

  _collectBodies() {
    const out = this._bodies;
    out.length = 0;
    this._entities.length = 0;
    for (const site of this.sites) {
      for (const p of site.pieces) {
        if (p.state !== 'live') continue;
        if (p.entity) this._pushEntity(p.entity);
        for (const e of p.islands) this._pushEntity(e);
      }
    }
    this.stats.live = this._entities.length;
  }

  _pushEntity(e) {
    const hull = e.beamHull;
    if (!hull || hull.entity !== e || hull.body.dead) return;
    this._entities.push(e);
    this._bodies.push(hull.body);
  }

  /** Żywe encje budowli (do listy kroku HullBodies — kolizje z okrętami). */
  entities() { return this._entities; }

  /** `base` + encje budowli w jednej (wielokrotnej) tablicy — wejście HullBodies.step. */
  withEntities(base) {
    if (!this._entities.length) return base;
    const out = this._merged || (this._merged = []);
    out.length = 0;
    for (let i = 0; i < base.length; i++) out.push(base[i]);
    for (let i = 0; i < this._entities.length; i++) out.push(this._entities[i]);
    return out;
  }

  // ------------------------------------------------------------------ BROŃ

  /**
   * Odcinek pocisku GRY (x0, y0) → (x1, y1) przez żywe kawałki miejsca `siteId` (albo wszystkie): orka.
   * `mass` (masa węzłów) i `radius` (j.) pocisku, `vx, vy` — prędkość w GRZE (j/s); dishSpeed (j/s, 0 = strojenie;
   * w skali orki). vCap (j/s, 0 = bez) — prędkość orki: szybszy pocisk orze z prędkością vCap, a wynikowa prędkość
   * wraca w skali pocisku (ten sam ułamek straty).
   * Zwraca wynik (wspólny obiekt) albo null, gdy tor nie dotknął ciała. W wyniku: x, y (pierwsze zderzenie, gra),
   * stopped, stopT (ułamek odcinka), vx, vy (prędkość po orce, gra), energy (oddana konstrukcji), entity, piece.
   */
  plowSegment(siteId, x0, y0, x1, y1, mass, radius, vx, vy, dishSpeed = 0, dishRings = -1, vCap = 0) {
    if (!this.channels || !this._entities.length) return null;
    const ents = this._entities;
    // kolejność wejścia: odległość środka obwiedni od początku toru (kawałki są małe wobec toru pocisku)
    const order = this._order, ordD = this._orderD;
    order.length = 0; ordD.length = 0;
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const p = e.worldPiece;
      if (!p || (siteId && p.site.id !== siteId)) continue;
      const hull = e.beamHull;
      const pad = (hull?.radius || 0) + radius;
      const ex = e.x - x0, ey = e.y - y0;
      const sx = x1 - x0, sy = y1 - y0;
      const sl2 = sx * sx + sy * sy;
      const tp = sl2 > 0 ? Math.max(0, Math.min(1, (ex * sx + ey * sy) / sl2)) : 0;
      const cx = x0 + sx * tp - e.x, cy = y0 + sy * tp - e.y;
      if (cx * cx + cy * cy > pad * pad) continue;
      let at = order.length;
      const dd = tp;
      order.push(e); ordD.push(dd);
      while (at > 0 && ordD[at - 1] > dd) { order[at] = order[at - 1]; ordD[at] = ordD[at - 1]; at--; }
      order[at] = e; ordD[at] = dd;
    }
    if (!order.length) return null;
    const ch = this.channels;
    const p = _shell;
    const v = Math.sqrt(vx * vx + vy * vy);
    const scale = vCap > 0 && v > vCap ? vCap / v : 1;
    p.vx = vx * scale; p.vy = -vy * scale; p.mass = mass; p.radius = radius; p.stopped = false;
    p.dishSpeed = dishSpeed; p.dishRings = dishRings;
    const out = _hit;
    out.entity = null; out.piece = null; out.stopped = false; out.stopT = 1; out.energy = 0; out.first = false;
    // świat silnika: y odwrócone
    let sx0 = x0, sy0 = -y0;
    const sx1 = x1, sy1 = -y1;
    let tBase = 0;
    for (let k = 0; k < order.length; k++) {
      const e = order[k];
      const body = e.beamHull.body;
      const r = ch.plowSegment(body, p, sx0, sy0, sx1, sy1);
      if (!r.hit) continue;
      out.energy += r.energy;
      if (!out.entity) {
        out.entity = e; out.piece = e.worldPiece;
        const segT = tBase + (1 - tBase) * r.entryT;
        out.x = x0 + (x1 - x0) * segT; out.y = y0 + (y1 - y0) * segT;
      }
      if (r.stopped) {
        out.stopped = true;
        out.stopT = tBase + (1 - tBase) * r.stopT;
        break;
      }
    }
    if (!out.entity) return null;
    this.stats.hits++;
    if (out.stopped) this.stats.stops++;
    out.vx = p.vx / scale; out.vy = -p.vy / scale;
    return out;
  }

  /**
   * Pocisk gry (bullets) na odcinku kroku przez kawałki miejsca: masa z obrażeń, promień z komórki ciała.
   * Zmienia prędkość pocisku (hamowanie); zwraca wynik plowSegment albo null.
   */
  hitBullet(siteId, b, x0, y0, x1, y1) {
    const dmg = Math.max(0, Number(b.damage) || 0);
    const nodeMass = this.refNodeMass();
    const mass = Math.max(T.shellMinNodes, dmg * T.shellNodesPerDamage) * nodeMass;
    const radius = T.shellRadiusCells * T.cellSize + Math.max(0, Number(b.r) || 0) * 0.25;
    const res = this.plowSegment(siteId, x0, y0, x1, y1, mass, radius, Number(b.vx) || 0, Number(b.vy) || 0, 0, -1,
      T.shellPlowSpeedCells * T.cellSize);
    if (!res) return null;
    b.vx = res.vx; b.vy = res.vy;
    return res;
  }

  /** Hexlance (superweapon.js) na odcinku kroku: pręt o masie dema, szeroka niecka. Zmienia prędkość pocisku. */
  plowLance(siteId, proj, x0, y0, x1, y1) {
    const nodeMass = this.refNodeMass();
    const v = Math.sqrt((Number(proj.vx) || 0) ** 2 + (Number(proj.vy) || 0) ** 2);
    const vCap = T.lancePlowSpeedCells * T.cellSize;
    const res = this.plowSegment(siteId, x0, y0, x1, y1, T.lanceNodes * nodeMass, T.lanceRadiusCells * T.cellSize,
      Number(proj.vx) || 0, Number(proj.vy) || 0, Math.max(1, Math.min(v, vCap) * T.lanceDishFactor), T.lanceDishRings, vCap);
    if (!res) return null;
    proj.vx = res.vx; proj.vy = res.vy;
    return res;
  }

  /** Masa węzła ciała świata przy domyślnej gęstości (odniesienie mas pocisków). */
  refNodeMass() {
    return T.massPerArea * T.cellSize * T.cellSize;
  }

  /**
   * Wybuch (gra): front fali przez kawałki w promieniu. power — mnożnik (1 ≈ rakieta dema), (dirX, dirY) —
   * kierunek lotu głowicy (domieszka). Zwraca właścicieli budowli w zasięgu (wspólna tablica — obrażenia
   * rozgrywki raz na budowlę liczy wołający).
   */
  detonate(x, y, radius, power = 1, dirX = 0, dirY = 0) {
    const owners = this._owners || (this._owners = []);
    owners.length = 0;
    if (!this.channels || !this._entities.length || !(radius > 0)) return owners;
    const R2 = radius * radius;
    const ents = this._entities;
    let any = false;
    for (let k = 0; k < ents.length; k++) {
      const p = ents[k].worldPiece;
      if (!p || boundsDist2(p.bounds, x, y) > R2) continue;
      any = true;
      const o = p.site.owner;
      if (o && owners.indexOf(o) < 0) owners.push(o);
    }
    if (any) this.channels.detonate(x, -y, radius, Math.min(T.blastPowerMax, Math.max(0, power)), dirX, -dirY, null);
    return owners;
  }

  /** Wybuch z obrażeń broni (rakieta, torpeda): moc = obrażenia × blastPowerPerDamage. */
  detonateDamage(x, y, radius, damage, dirX = 0, dirY = 0) {
    return this.detonate(x, y, radius, (Number(damage) || 0) * T.blastPowerPerDamage, dirX, dirY);
  }

  /**
   * Promień (gra) przez żywe kawałki miejsca `siteId` (albo wszystkie): pierwszy żywy węzeł na odcinku
   * (x0, y0) → (x1, y1) — wiązki. Zwraca { t (ułamek odcinka), x, y, entity, piece } (wspólny obiekt) albo null.
   */
  raySite(siteId, x0, y0, x1, y1, radius = 0) {
    if (!this._entities.length) return null;
    const out = this._ray || (this._ray = { t: 1, x: 0, y: 0, entity: null, piece: null });
    let best = null, bestT = Infinity;
    const ents = this._entities;
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const p = e.worldPiece;
      if (!p || (siteId && p.site.id !== siteId)) continue;
      if (!segBoundsHit(p.bounds, x0, y0, x1, y1, (e.beamHull?.body?._maxDisp || 0) + T.cellSize + radius)) continue;
      const r = HullBodies.sweep(e, x0, y0, x1, y1, radius);
      if (r && r.t < bestT) { bestT = r.t; best = e; out.x = r.worldX; out.y = r.worldY; }
    }
    if (!best) return null;
    out.t = bestT; out.entity = best; out.piece = best.worldPiece;
    return out;
  }

  /**
   * Strzał wiązki (gra) w ciało budowli `entity` w punkcie (x, y): plama ciepła o energii z obrażeń strzału
   * (`damage` × heatPerDamage — temperatura w osi), (dirX, dirY) — kierunek wiązki (ablacja leci pod prąd).
   */
  heatAt(entity, x, y, damage, dirX = 0, dirY = 0) {
    const body = entity?.beamHull?.entity === entity ? entity.beamHull.body : null;
    if (!this.channels || !body || body.dead) return false;
    const ok = this.channels.heat(body, x, -y, Math.max(0, Number(damage) || 0) * T.heatPerDamage, 1, dirX, -dirY);
    if (ok && entity.worldPiece) entity.worldPiece.touched = true;
    return ok;
  }

  /** Wiązka ciągła (moc na sekundę przez `dt`) — pierwszy żywy węzeł odcinka dostaje plamę ciepła. */
  heatBeam(siteId, x0, y0, x1, y1, damagePerSec, dt) {
    const r = this.raySite(siteId, x0, y0, x1, y1, 0);
    if (!r || !this.channels) return null;
    this.channels.heat(r.entity.beamHull.body, r.x, -r.y, Math.max(0, damagePerSec) * T.heatPerDamage, dt, x1 - x0, -(y1 - y0));
    return r;
  }

  /** Czy kawałek jest teraz ciałem. */
  isLive(piece) { return piece?.state === 'live'; }

  /** Kawałek miejsca po id (albo null). */
  piece(siteId, pieceId) {
    const site = this.site(siteId);
    if (!site) return null;
    for (const p of site.pieces) if (p.id === pieceId) return p;
    return null;
  }

  /**
   * Kawałek ODPADA (próg punktów budowli — rozpad z rozgrywki): kotwice puszczają, w miejscu trafienia (x, y gry)
   * front ciśnienia rwie belki (power — 1 ≈ rakieta dema), a cała reszta dostaje dryf `speed` [j/s] w kierunku
   * (outX, outY) gry (od budowli — inaczej kawałek wpada w resztę doku). Ciało staje się swobodne; wrakiem
   * (lista wraków gry) robi je najbliższy krok (_checkPiece).
   */
  breakPiece(piece, x, y, { power = 1.2, radius = 0, speed = 70, outX = 0, outY = 0 } = {}) {
    if (!piece || piece.state !== 'live' || !this.channels) return false;
    const D = HullBodies.engine;
    const R = radius > 0 ? radius : T.cellSize * 8;
    this.releaseAnchors(piece, 1);
    const ol = Math.sqrt(outX * outX + outY * outY);
    const ux = ol > 1e-9 ? outX / ol : 0, uy = ol > 1e-9 ? outY / ol : 0;
    for (const e of [piece.entity, ...piece.islands]) {
      const body = e?.beamHull?.entity === e ? e.beamHull.body : null;
      if (!body || body.dead || body.anchored) continue;
      this.channels.kick(body, x, -y, R, power, ux, -uy);
      if (speed > 0 && ol > 1e-9) {
        // dryf całości (układ ciała; świat silnika: y odwrócone)
        const m = D._refreshRot(body), s = body.nodeStore;
        const wx = ux * speed, wy = -uy * speed;
        const lvx = m[0] * wx + m[3] * wy, lvy = m[1] * wx + m[4] * wy;
        for (let i = 0; i < s.count; i++) {
          if (!s.active[i] || !(s.invMass[i] > 0)) continue;
          s.vx[i] += lvx; s.vy[i] += lvy;
        }
      }
      D.wake(body, D.config.wakeHoldFrames);
    }
    piece.touched = true;
    return true;
  }

  /** Zrywa kotwice kawałka (próg obrażeń, łańcuch rozpadu budowli): bez kotwic całość odpada jako wrak. */
  releaseAnchors(piece, fraction = 1) {
    if (!piece || piece.state !== 'live') return 0;
    let n = 0;
    const D = HullBodies.engine;
    for (const e of [piece.entity, ...piece.islands]) {
      const body = e?.beamHull?.body;
      if (!body || body.dead) continue;
      const s = body.nodeStore;
      let left = 0;
      for (let i = 0; i < s.count; i++) {
        if (!s.active[i] || s.invMass[i] > 0) continue;
        if (fraction < 1 && ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) > fraction) { left++; continue; }
        s.invMass[i] = 1 / Math.max(1e-6, s.mass[i]);
        n++;
      }
      // bez kotwic ciało staje się swobodne od razu (podział wysp silnik sprawdza tylko po zerwaniach)
      if (left === 0 && body.anchored && typeof D._releaseAnchor === 'function') D._releaseAnchor(body, true);
      D.wake(body, D.config.wakeHoldFrames);
    }
    piece.touched = true;
    return n;
  }

  reset() {
    for (const site of this.sites.slice()) this.removeSite(site.id);
    this._queue.length = 0;
    this.channels?.reset();
  }
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

export const worldBodies = new WorldBodies();
if (typeof window !== 'undefined') window.WorldBodies = worldBodies;
