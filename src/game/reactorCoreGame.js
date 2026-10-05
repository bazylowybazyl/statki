// src/game/reactorCoreGame.js
//
// KLEJ RDZENIA REAKTORA W GRZE — rdzeń na kadłubie belkowym (src/game/reactorCore.js) i wybuch
// WebGPU (src/3d/reactorBlast/) wpięte w index.html. Wzorzec: świat dema
// (dema/rdzen-webgpu/swiat.js), kroki integracji: docs/webgpu/DEMO-RDZEN.md § 7.
// Zastępuje dawny losowy „krytyczny wybuch reaktora” (tryTriggerCriticalReactorBlow +
// reactorblow.js) przy śmierci okrętu.
//
// Przebieg:
//   • montaż: `attach(encja, hullId)` po HullBodies.createHull — markery z tabeli
//     (src/data/reactorCores.js), z edytora (gdy niosą `r`) albo z automatu (najgłębsze miejsce
//     kadłuba przy środku masy);
//   • krok fizyki (`step(dt, encje)`, po HullBodies.step): strumienie, kule plazmy, wybuchy wtórne,
//     stany rdzeni (stopienie po zniszczeniu komory), zdarzenia;
//   • śmierć z puli HP: `hostKilled(encja)` — rdzeń KRYTYCZNY / w STOPIENIU detonuje (kolejka
//     do najbliższego kroku), inaczej czysty wrak; gracz (`force`) — detonacja zawsze;
//   • detonacja: gra oznacza gospodarza martwym (`env.beforeHostDetonate`), kadłub → wrak z
//     pęknięciami (`applyReactorDetonation`), fala na sąsiadów (`applyReactorBlast`, pula HP
//     przez `env.hullDamage`), obraz (`fx.detonation`), strumień / kula, wtórne,
//     `env.afterHostDetonate` (ładunek, zwolnienie ciała).
// Moduł bez DOM i three — obraz podaje wołający (`env.fx()` → ReactorBlastFx).

import * as RC from './reactorCore.js';
import { REACTOR_CORE_MARKERS, reactorColorFor } from '../data/reactorCores.js';

const PENDING_CAP = 32;

function isFighterLike(e) {
  if (!e) return true;
  if (e.fighter) return true;
  const t = String(e.type || '').toLowerCase();
  return t === 'fighter' || t === 'interceptor' || t === 'drone' || t === 'ally_fighter' || t === 'carrier_fighter';
}

function editorMarkersWithRadius(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const m of list) if (!(Number(m?.r) > 0)) return null;
  return list;
}

/**
 * Komora z automatu dla kadłuba bez markera: komórka siatki najgłębiej pod powierzchnią
 * (odległość od pustej komórki / brzegu), z karą za odległość od środka masy. Wynik w
 * przestrzeni PNG sprite'a (jak marker edytora). null — kadłub za mały.
 */
export function autoReactorMarker(entity, pngWidth, pngHeight) {
  const hull = RC.reactorHull(entity);
  if (!hull) return null;
  const body = hull.body, s = body.nodeStore, cs = body.cellSize, lm = body.latticeMin;
  const dx = body.dims.x | 0, dy = body.dims.y | 0;
  if (dx <= 0 || dy <= 0 || body.activeNodes < 24) return null;
  const n = dx * dy;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let comX = 0, comY = 0, cnt = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ix = s.ix[i], iy = s.iy[i];
    if (ix < 0 || iy < 0 || ix >= dx || iy >= dy) continue;
    dist[ix + iy * dx] = 0x3fffffff;
    comX += s.ox[i]; comY += s.oy[i]; cnt++;
  }
  if (cnt < 24) return null;
  comX /= cnt; comY /= cnt;
  // BFS od komórek pustych sąsiadujących z kadłubem i od brzegu siatki.
  let head = 0, tail = 0;
  for (let y = 0; y < dy; y++) {
    for (let x = 0; x < dx; x++) {
      const k = x + y * dx;
      if (dist[k] < 0) continue;
      const edge = x === 0 || y === 0 || x === dx - 1 || y === dy - 1
        || dist[k - 1] < 0 || dist[k + 1] < 0 || dist[k - dx] < 0 || dist[k + dx] < 0;
      if (edge) { dist[k] = 1; queue[tail++] = k; }
    }
  }
  while (head < tail) {
    const k = queue[head++];
    const d = dist[k] + 1;
    const x = k % dx, y = (k / dx) | 0;
    if (x > 0 && dist[k - 1] > d) { dist[k - 1] = d; queue[tail++] = k - 1; }
    if (x < dx - 1 && dist[k + 1] > d) { dist[k + 1] = d; queue[tail++] = k + 1; }
    if (y > 0 && dist[k - dx] > d) { dist[k - dx] = d; queue[tail++] = k - dx; }
    if (y < dy - 1 && dist[k + dx] > d) { dist[k + dx] = d; queue[tail++] = k + dx; }
  }
  let best = -1, bestScore = -Infinity, bestDepth = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const ix = s.ix[i], iy = s.iy[i];
    if (ix < 0 || iy < 0 || ix >= dx || iy >= dy) continue;
    const depth = dist[ix + iy * dx] * cs;
    const ex = s.ox[i] - comX, ey = s.oy[i] - comY;
    const score = depth - 0.45 * Math.sqrt(ex * ex + ey * ey);
    if (score > bestScore) { bestScore = score; best = i; bestDepth = depth; }
  }
  if (best < 0) return null;
  const lx = s.ox[best], ly = s.oy[best];
  const sxScale = hull.srcWidth / pngWidth, syScale = hull.srcHeight / pngHeight;
  const uniform = (sxScale + syScale) * 0.5;
  const R = Math.max(1.6 * cs, Math.min(4 * cs, bestDepth * 0.55));
  return {
    id: 'auto',
    x: (lx - lm.x - hull.anchorDX) / hull.scale / sxScale,
    y: -(ly - lm.y - hull.anchorDY) / hull.scale / syScale,
    r: R / (uniform * hull.scale)
  };
}

export class ReactorCoreGame {
  /**
   * @param {object} env
   *   wrecks()                   — window.wrecks gry
   *   fx()                       — ReactorBlastFx albo null (obraz)
   *   hullDamage(e, dmg)         — pula HP (fala detonacji, kula plazmy)
   *   beforeHostDetonate(host)   — gospodarz ginie (zanim kadłub stanie się wrakiem)
   *   afterHostDetonate(host)    — po rozpadzie (ładunek, zwolnienie ciała)
   *   isPlayer(e)                — gracz (kadłub zostaje na encji — convert: false)
   *   onShake(x, y, power)       — wstrząs kamery od detonacji
   *   onState(ev)                — zmiana stanu rdzenia (komunikaty HUD)
   *   impact(e, x, y, dmg, vx, vy, craterR) — wybuch wtórny (HullBodies.impact)
   */
  constructor(env = {}) {
    this.env = env;
    this.time = 0;
    this.enabled = true;
    this.jets = [];
    this.orbs = [];
    this.secondaries = [];
    this.events = [];
    this.pending = [];          // zdarzenia detonacji spoza kroku (śmierć z puli HP)
    this.detonations = 0;
    this._list = [];
    this._cores = [];
    this._ctx = { time: 0, entities: this._list, events: this.events, hooks: null };
    this._hooks = {
      hullDamage: (e, dmg) => { if (e && !e.isWreck && dmg > 0) env.hullDamage?.(e, dmg); },
      melt: (e, orb, killed) => this.env.fx?.()?.melt?.(e, orb, killed),
      jetCut: (e, x, y, ddx, ddy, depth, jet) => this.env.fx?.()?.jetCut?.(e, x, y, ddx, ddy, depth, jet)
    };
    this._ctx.hooks = this._hooks;
  }

  /**
   * Rdzeń na świeżym kadłubie belkowym. `hullId` — profil renderu (klucz tabeli markerów),
   * `editorCores` — `cores[]` z edytora (biorą górę, gdy każdy niesie promień `r`).
   */
  attach(entity, hullId = null, { editorCores = null } = {}) {
    if (!this.enabled || !entity || isFighterLike(entity)) return null;
    const hull = RC.reactorHull(entity);
    if (!hull) return null;
    const img = hull.visualImage;
    const pngW = Number(img?.naturalWidth || img?.width) || hull.srcWidth;
    const pngH = Number(img?.naturalHeight || img?.height) || hull.srcHeight;
    let markers = editorMarkersWithRadius(editorCores)
      || (hullId && REACTOR_CORE_MARKERS[hullId]) || null;
    if (!markers) {
      const m = autoReactorMarker(entity, pngW, pngH);
      markers = m ? [m] : null;
    }
    if (!markers) return null;
    entity.__reactorHullId = hullId || null;
    const cores = RC.attachReactorCores(entity, markers, { pngWidth: pngW, pngHeight: pngH, color: reactorColorFor(entity) });
    // Komora poza kadłubem (marker z innego sprite'a) — zastępczo komora z automatu.
    if (cores.length && cores.every((c) => c.invalid)) {
      const m = autoReactorMarker(entity, pngW, pngH);
      if (m) return RC.attachReactorCores(entity, [m], { pngWidth: pngW, pngHeight: pngH, color: reactorColorFor(entity) });
    }
    return cores;
  }

  /**
   * Gospodarz ginie z puli HP. true = detonacja w kolejce (gra NIE robi wraku ani nie zwalnia
   * ciała — zrobi to detonacja w najbliższym kroku). `force` — detonacja bez względu na stan
   * rdzenia (gracz).
   */
  hostKilled(entity, { force = false } = {}) {
    if (!this.enabled || !Array.isArray(entity?.reactorCores) || !RC.reactorHull(entity)) return false;
    const before = this.pending.length;
    if (this.pending.length >= PENDING_CAP) return false;
    RC.notifyReactorHostKilled(entity, this.time, 'attrition', this.pending);
    if (force && !this.pending.some((ev, k) => k >= before && ev.type === 'detonate')) {
      const core = entity.reactorCores.find((c) => c && !c.invalid && c.host === entity && c.state !== RC.CORE_STATE.DETONATED);
      if (core) RC.detonateReactorNow(core, this.time, this.pending);
    }
    for (let k = before; k < this.pending.length; k++) {
      if (this.pending[k].type === 'detonate') return true;
    }
    return false;
  }

  /**
   * Dev / skrypty misji: stopienie rdzenia encji teraz (`sec` — odliczanie, `variant` — wariant
   * detonacji: shatter / halves / thirds / hole / jet / orb). Zdarzenia idą w najbliższym kroku.
   */
  forceMeltdown(entity, sec = null, variant = null) {
    const core = entity?.reactorCores?.find((c) => c && !c.invalid && c.host === entity && c.state !== RC.CORE_STATE.DETONATED);
    if (!core) return false;
    RC.forceReactorMeltdown(core, this.time, 'forced', this.pending, {
      remaining: Number.isFinite(sec) ? sec : undefined,
      variant
    });
    return true;
  }

  /** Encje z żywym kadłubem belkowym (lista współdzielona). */
  _entities(list) {
    const L = this._list;
    L.length = 0;
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && RC.reactorHull(e)) L.push(e);
      }
    }
    return L;
  }

  /** Krok fizyki (po HullBodies.step): zagrożenia, rdzenie, zdarzenia. */
  step(dt, list) {
    if (!this.enabled) return;
    this.time += dt;
    const ctx = this._ctx;
    ctx.time = this.time;
    const entities = this._entities(list);
    const events = this.events;
    events.length = 0;
    for (let i = this.jets.length - 1; i >= 0; i--) {
      if (!RC.stepReactorJet(this.jets[i], dt, entities, ctx)) this.jets.splice(i, 1);
    }
    if (this.orbs.length) {
      RC.stepReactorOrbs(this.orbs, dt, entities, ctx);
      for (let i = this.orbs.length - 1; i >= 0; i--) if (this.orbs[i].detonated) this.orbs.splice(i, 1);
    }
    for (let i = this.secondaries.length - 1; i >= 0; i--) {
      const s = this.secondaries[i];
      if (this.time < s.at) continue;
      this.secondaries.splice(i, 1);
      this._secondary(s, entities);
    }
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (Array.isArray(e.reactorCores) && e.reactorCores.length) RC.updateReactorCores(e, dt, ctx);
    }
    if (this.pending.length) {
      for (let k = 0; k < this.pending.length; k++) events.push(this.pending[k]);
      this.pending.length = 0;
    }
    // Zdarzenia z detonacji (łańcuch przez hullDamage → hostKilled) trafiają do `pending`
    // i idą w następnym kroku — bez rekurencji wybuchów w jednym wywołaniu.
    for (let k = 0; k < events.length; k++) this._event(events[k], entities);
    events.length = 0;
  }

  _event(ev, entities) {
    if (ev.type === 'state') this.env.onState?.(ev);
    else if (ev.type === 'detonate') this._detonate(ev, entities);
    else if (ev.type === 'orbDetonate') {
      const hits = RC.applyReactorBlast(ev.blast, ev.x, ev.y, entities, null, { time: this.time, hooks: this._hooks, sourceKey: ev.orb?.lineage });
      this.env.fx?.()?.orbBurst?.(ev, hits.slice());
      this.env.onShake?.(ev.x, ev.y, 0.8);
    }
  }

  _detonate(ev, entities) {
    const core = ev.core;
    const host = ev.host;
    if (!core || !host) return;
    const isPlayer = this.env.isPlayer?.(host) === true;
    if (!RC.reactorHull(host)) {
      // Ciało zwolnione przed detonacją z kolejki — tylko domknięcie śmierci.
      if (!isPlayer) this.env.afterHostDetonate?.(host);
      return;
    }
    this.env.beforeHostDetonate?.(host);
    const hostVx = host.vx || 0, hostVy = host.vy || 0;
    const res = RC.applyReactorDetonation(core, ev.variant, ev.blast, {
      wrecks: this.env.wrecks?.() || null,
      convert: !isPlayer
    });
    if (!isPlayer) {
      host.vx = hostVx; host.vy = hostVy;
    }
    const all = this._entities(entities);
    const hits = RC.applyReactorBlast(ev.blast, ev.x, ev.y, all, res.wreck, {
      time: this.time, hooks: this._hooks, sourceKey: core.lineage, sourceRadius: host.radius
    }).slice();
    this.detonations++;
    // ciała świata (budowle w bańce gracza): front ciśnienia przez solver — gra (env.onDetonate)
    this.env.onDetonate?.(ev, res);
    const fx = this.env.fx?.();
    fx?.detonation?.(ev, res, hits);
    if (res.variant === 'jet') {
      const jet = RC.createReactorJet(core, res, ev.blast);
      if (jet) { this.jets.push(jet); fx?.addJet?.(jet); }
    } else if (res.variant === 'orb') {
      const orb = RC.createReactorOrb(core, res, ev.blast);
      if (orb) { this.orbs.push(orb); fx?.addOrb?.(orb); }
    }
    const sec = RC.planReactorSecondaries(core, res, {});
    for (const s of sec) this.secondaries.push({ ...s, at: this.time + s.delay });
    this.env.onShake?.(ev.x, ev.y, 1);
    if (!isPlayer) this.env.afterHostDetonate?.(host);
  }

  _secondary(s, entities) {
    const loc = RC.locateReactorCell(s.lineage, s.ix, s.iy, entities, {});
    if (!loc) return;
    const e = loc.entity;
    const a = Math.random() * Math.PI * 2;
    this.env.impact?.(e, loc.x, loc.y, s.damage, Math.cos(a) * 900, Math.sin(a) * 900, s.radius * 0.8);
    this.env.fx?.()?.secondary?.(loc.x, loc.y, e, s.size);
  }

  /** Wszystkie rdzenie (okręty i wraki — odcięte, wraki reaktora po wyrzucie). */
  cores(lists) {
    const out = this._cores;
    out.length = 0;
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l];
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) {
        const cs = list[i]?.reactorCores;
        if (!Array.isArray(cs)) continue;
        for (let k = 0; k < cs.length; k++) {
          const c = cs[k];
          // Zdetonowane też: model reaktora dopala wrak reaktora po wyrzucie / kuli.
          if (c && !c.invalid) out.push(c);
        }
      }
    }
    return out;
  }

  /** Najgorszy rdzeń w stopieniu wśród `cores` (baner HUD). */
  worstMeltdown(cores) {
    let worst = null;
    for (let i = 0; i < cores.length; i++) {
      const c = cores[i];
      if (c.state !== RC.CORE_STATE.MELTDOWN) continue;
      if (!worst || c.meltdownRemaining < worst.meltdownRemaining) worst = c;
    }
    return worst;
  }

  clear() {
    this.jets.length = 0;
    this.orbs.length = 0;
    this.secondaries.length = 0;
    this.pending.length = 0;
    this.env.fx?.()?.clear?.();
  }
}

export function createReactorCoreGame(env) {
  return new ReactorCoreGame(env);
}
