// Świat dema rdzenia na belkach: kadłuby ze sprite'ów gry (HullBodies — jak index.html:
// sprite → kanwa w rozmiarze renderu → createHull), rdzenie (src/game/reactorCore.js), krok
// fizyki 120 Hz (ruch encji → pociski → silnik belek → zagrożenia → rdzenie) i zdarzenia
// rdzeni → rozpad, fala na sąsiadów, strumień, kula, wybuchy wtórne → reżyser obrazu.
import { HullBodies } from '../../src/game/hullBodies.js';
import { getHullRenderSize } from '../../src/data/ships.js';
import { prewarmHexShipVisual } from '../../src/3d/hexShips3D.js';
import { SimClock } from '../../src/game/simClock.js';
import { stepDecay120 } from '../../src/game/stepDecay.js';
import * as RC from '../../src/game/reactorCore.js';
import { HULLS, REACTOR_COLORS } from '../rdzen-hulls-data.js';
import atlasUrl from '../../assets/capital_ship_rect_v1.png';
import bellatorUrl from '../../src/assets/ships/terranbattleship.png';
import skullUrl from '../../src/assets/ships/piratebattleship.png';

const SPRITE_URLS = { atlas: atlasUrl, battleship: bellatorUrl, pirate_battleship: skullUrl };
const assets = new Map();

export async function loadHullAssets() {
  await Promise.all(Object.keys(SPRITE_URLS).map(async (id) => {
    if (assets.has(id)) return;
    const def = HULLS[id];
    const img = new Image();
    img.src = SPRITE_URLS[id];
    await img.decode();
    const size = getHullRenderSize(def.renderProfile, img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    assets.set(id, { img, canvas, size });
    prewarmHexShipVisual(img);
  }));
  return assets;
}

export function reactorColorFor(entity) {
  return REACTOR_COLORS[entity?.faction] || REACTOR_COLORS.terran;
}

/**
 * Okręt z kadłubem belkowym i rdzeniem (NPC jak w grze; Atlas jako NPC — widok zewnętrzny).
 * o: { x, y, angle, label, markers, meltdownSec, vx, vy, angVel }
 */
export function createShip(hullId, o = {}) {
  const a = assets.get(hullId);
  if (!a) throw new Error(`Brak sprite'a ${hullId}`);
  const def = HULLS[hullId];
  const e = {
    x: Number(o.x) || 0, y: Number(o.y) || 0, vx: Number(o.vx) || 0, vy: Number(o.vy) || 0,
    angle: Number(o.angle) || 0, angVel: Number(o.angVel) || 0,
    mass: def.mass, hp: def.hull, maxHp: def.hull, type: def.npcType, shipFrame: def.renderProfile,
    isPirate: def.pirate === true, faction: def.faction, __hullId: hullId, __label: o.label || def.label,
    visual: { spriteScale: 1 }
  };
  HullBodies.createHull(e, a.canvas, { visualImage: a.img });
  if (!e.beamHull) throw new Error(`createHull bez kadłuba: ${hullId}`);
  const markers = (o.markers || def.cores).map((m) => (o.meltdownSec ? { ...m, meltdownSec: o.meltdownSec } : m));
  RC.attachReactorCores(e, markers, {
    pngWidth: a.img.naturalWidth, pngHeight: a.img.naturalHeight, color: reactorColorFor(e)
  });
  e.__spawn = { x: e.x, y: e.y, angle: e.angle };
  return e;
}

/**
 * Świat: okręty (żywe kadłuby z rdzeniami), wraki (window.wrecks — hullBodies dopisuje tam odłamy),
 * zagrożenia (strumienie, kule, wybuchy wtórne), zegar symulacji, zdarzenia.
 */
export class World {
  constructor({ fx = null, onLog = null, onDetonated = null } = {}) {
    this.fx = fx;
    this.onLog = onLog;
    this.onDetonated = onDetonated;
    this.ships = [];
    if (!Array.isArray(window.wrecks)) window.wrecks = [];
    this.wrecks = window.wrecks;
    this.time = 0;
    this.jets = [];
    this.orbs = [];
    this.secondaries = [];
    this.events = [];
    this.detonations = 0;
    this.variantOverride = null;
    this.exitAim = null;         // { x, y } — kierunek wyrzutu na punkt (sceny strumienia / kuli)
    this.forceSecondaries = null; // null = losowo, liczba = tyle
    this._list = [];
    this._hooks = {
      hullDamage: (e, dmg) => { if (e && Number.isFinite(e.hp)) e.hp = Math.max(0, e.hp - dmg); },
      melt: (e, orb, killed) => this.fx?.melt?.(e, orb, killed),
      jetCut: (e, x, y, dx, dy, depth, jet) => this.fx?.jetCut?.(e, x, y, dx, dy, depth, jet)
    };
  }

  log(text, cls = '') { this.onLog?.(text, cls); }

  /** Wszystkie encje z kadłubem (okręty + wraki) — tablica współdzielona. */
  entities() {
    const L = this._list;
    L.length = 0;
    for (const s of this.ships) if (RC.reactorHull(s)) L.push(s);
    for (const w of this.wrecks) if (w && !w.dead && RC.reactorHull(w)) L.push(w);
    return L;
  }

  /** Wszystkie rdzenie (na okrętach i wrakach — odcięte, wraki reaktora po wyrzucie). */
  cores(out = []) {
    out.length = 0;
    for (const s of this.ships) if (Array.isArray(s.reactorCores)) for (const c of s.reactorCores) out.push(c);
    for (const w of this.wrecks) if (w && Array.isArray(w.reactorCores)) for (const c of w.reactorCores) out.push(c);
    return out;
  }

  clear() {
    for (const s of this.ships) HullBodies.release(s);
    for (const w of this.wrecks) HullBodies.release(w);
    this.ships.length = 0;
    this.wrecks.length = 0;
    this.jets.length = 0;
    this.orbs.length = 0;
    this.secondaries.length = 0;
    this.fx?.clear?.();
  }

  add(hullId, o) {
    const e = createShip(hullId, o);
    this.ships.push(e);
    return e;
  }

  /** Krok fizyki (120 Hz): ruch, pociski (wołający), silnik belek, zagrożenia, rdzenie, zdarzenia. */
  step(dt, bullets = null) {
    this.time += dt;
    const list = this.entities();
    for (const e of list) {
      if (e.isWreck) {
        const f = stepDecay120(e.friction ?? 0.9986, dt);
        e.vx *= f; e.vy *= f;
        e.angVel = (e.angVel || 0) * f;
      }
      e.x += (e.vx || 0) * dt;
      e.y += (e.vy || 0) * dt;
      e.angle += (e.angVel || 0) * dt;
    }
    SimClock.advance(dt);
    if (bullets) bullets.step(dt, list);
    HullBodies.step(dt, list);
    const events = this.events;
    events.length = 0;
    const ctx = { time: this.time, entities: this.entities(), events, hooks: this._hooks };
    // zagrożenia po detonacjach
    for (let i = this.jets.length - 1; i >= 0; i--) {
      if (!RC.stepReactorJet(this.jets[i], dt, ctx.entities, ctx)) this.jets.splice(i, 1);
    }
    if (this.orbs.length) {
      RC.stepReactorOrbs(this.orbs, dt, ctx.entities, ctx);
      for (let i = this.orbs.length - 1; i >= 0; i--) if (this.orbs[i].detonated) this.orbs.splice(i, 1);
    }
    for (let i = this.secondaries.length - 1; i >= 0; i--) {
      const s = this.secondaries[i];
      if (this.time < s.at) continue;
      this.secondaries.splice(i, 1);
      this._secondary(s, ctx.entities);
    }
    // rdzenie (okręty i wraki: odcięty rdzeń stopi się i wybuchnie na odłamie)
    const all = ctx.entities;
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (Array.isArray(e.reactorCores) && e.reactorCores.length) RC.updateReactorCores(e, dt, ctx);
    }
    if (events.length) this._process(events, ctx);
    // wraki bez kadłuba (okruchy, zwolnione) — z listy
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (!w || w.dead || !HullBodies.hasHull(w)) this.wrecks.splice(i, 1);
    }
  }

  _ctx() {
    return { time: this.time, entities: this.entities(), events: [], hooks: this._hooks };
  }

  /** Wymuszone stopienie rdzenia: `sec` — odliczanie (także ponad profil klasy), wariant. */
  forceMeltdown(core, sec, variant = null) {
    if (!core || core.invalid || core.state === RC.CORE_STATE.DETONATED) return;
    if (sec > 0 && core.state !== RC.CORE_STATE.MELTDOWN) core.meltdownSec = sec;
    const ctx = this._ctx();
    RC.forceReactorMeltdown(core, this.time, 'forced', ctx.events, { remaining: sec, variant });
    this._process(ctx.events, ctx);
  }

  /** Detonacja od razu (przycisk D). */
  detonateNow(core, variant = null) {
    if (!core || core.invalid || core.state === RC.CORE_STATE.DETONATED) return;
    const ctx = this._ctx();
    RC.detonateReactorNow(core, this.time, ctx.events, variant);
    this._process(ctx.events, ctx);
  }

  _process(events, ctx) {
    for (let k = 0; k < events.length; k++) {
      const ev = events[k];
      if (ev.type === 'state') {
        if (ev.to === RC.CORE_STATE.MELTDOWN) this.log(`${ev.host?.__label || 'kadłub'}: STOPIENIE (${ev.cause}${ev.chainDepth ? `, ogniwo ${ev.chainDepth}` : ''}) — ${ev.duration.toFixed(1)} s`, 'bad');
        else if (ev.to !== RC.CORE_STATE.DETONATED) this.log(`${ev.host?.__label || 'kadłub'}: ${RC.CORE_STATE_LABEL[ev.to]}`, ev.to === RC.CORE_STATE.CRITICAL ? 'warn' : '');
      } else if (ev.type === 'severed') {
        this.log(`${ev.from?.__label || 'kadłub'}: rdzeń odcięty z odłamem — stopienie ×0,5`, 'warn');
      } else if (ev.type === 'detonate') {
        this._detonate(ev, ctx);
      } else if (ev.type === 'orbDetonate') {
        const hits = RC.applyReactorBlast(ev.blast, ev.x, ev.y, ctx.entities, null, { time: this.time, hooks: this._hooks, sourceKey: ev.orb?.lineage });
        this.fx?.orbBurst?.(ev, hits.slice());
        this.log('Kula plazmy wybuchła', 'bad');
      }
    }
  }

  _detonate(ev, ctx) {
    const core = ev.core;
    const host = ev.host;
    const variant = this.variantOverride && RC.CORE_DETONATION_VARIANTS[this.variantOverride] ? this.variantOverride : ev.variant;
    if (variant !== ev.variant) {
      ev.variant = variant;
      ev.blast = RC.applyVariantToBlast(RC.computeCoreBlast(core), variant);
    }
    let exitDir = null;
    if (this.exitAim && (variant === 'jet' || variant === 'orb')) {
      const dx = this.exitAim.x - ev.x, dy = this.exitAim.y - ev.y;
      const l = Math.hypot(dx, dy) || 1;
      exitDir = { x: dx / l, y: dy / l };
    }
    const hostVx = host.vx || 0, hostVy = host.vy || 0;
    const res = RC.applyReactorDetonation(core, variant, ev.blast, { wrecks: this.wrecks, exitDir });
    // statek oddał kadłub wrakowi — z listy okrętów
    const idx = this.ships.indexOf(host);
    if (idx >= 0) this.ships.splice(idx, 1);
    host.dead = true;
    host.vx = hostVx; host.vy = hostVy;
    const entities = this.entities();
    const hits = RC.applyReactorBlast(ev.blast, ev.x, ev.y, entities, res.wreck, {
      time: this.time, hooks: this._hooks, sourceKey: core.lineage, sourceRadius: host.radius
    }).slice();
    this.detonations++;
    this.fx?.detonation?.(ev, res, hits);
    if (variant === 'jet') {
      const jet = RC.createReactorJet(core, res, ev.blast);
      this.jets.push(jet);
      this.fx?.addJet?.(jet);
    } else if (variant === 'orb') {
      const orb = RC.createReactorOrb(core, res, ev.blast);
      this.orbs.push(orb);
      this.fx?.addOrb?.(orb);
    }
    const sec = RC.planReactorSecondaries(core, res, this.forceSecondaries != null ? { count: this.forceSecondaries } : {});
    for (const s of sec) this.secondaries.push({ ...s, at: this.time + s.delay });
    const label = RC.CORE_DETONATION_VARIANTS[variant]?.label || variant;
    this.log(`DETONACJA ${host.__label || ''} — ${label.toUpperCase()}: odłamów ${res.fragments.length}, trafionych ${hits.length}${sec.length ? `, wtórnych ${sec.length}` : ''}`, 'bad');
    this.onDetonated?.(ev, res, hits);
  }

  _secondary(s, entities) {
    const loc = RC.locateReactorCell(s.lineage, s.ix, s.iy, entities, {});
    if (!loc) return;
    const e = loc.entity;
    const a = Math.random() * Math.PI * 2;
    HullBodies.impact(e, loc.x, loc.y, s.damage, { x: Math.cos(a) * 900, y: Math.sin(a) * 900 }, { craterRadius: s.radius * 0.8 });
    this.fx?.secondary?.(loc.x, loc.y, e, s.size);
  }
}
