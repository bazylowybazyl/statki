// src/ui/radar/radarFeed.js
//
// Zbieracz wejścia radaru (~10 Hz): co radar MOŻE widzieć w tej chwili, z metadanymi śladów. Gra podaje
// `env` (index.html, blok „RADAR”) — ten moduł nie zna globali gry. Zasady jak w reszcie HUD-u:
//  - mgła wojny: byt ukryty (`env.hides`) nie trafia na radar (duchy i sygnatury masy osobno);
//  - maskowany byt (`env.cloaked`) nie istnieje dla czujników;
//  - pozycje w rekordach to tylko zapas — tracker czyta ŻYWE pozycje z encji wg `src` co klatkę tarczy.
// Wynik `feed.contacts` (zgodny ze starym radarModel.contacts) karmi listy kokpitu (overview, wyniki skanu).
// Stałe dane bytu (typ, klasa, nazwa, wymiary i obraz kadłuba) — z pamięci per byt (`metaOf`), odświeżane co
// META_REFRESH zebrań, rozłożone w czasie; w dużej bitwie dawniej liczone dla każdego okrętu co 100 ms.

import { RADAR_TUNE, radarClassCode } from './radarConfig.js';
import { RADAR_SRC } from './radarTracker.js';

const FIGHTER_RE = /fighter|interceptor|bomber/;
// Co tyle zebrań (~1,6 s przy 10 Hz) dane bytu liczone od nowa (nazwa, wymiary kadłuba po budowie ciała).
const META_REFRESH = 16;

function finite(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function makeRec() {
  return {
    key: null, src: 0, kind: 'ship', aff: 'unknown', x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    length: 0, width: 0, capital: false, cls: '', name: '', idKnown: false, continuous: false,
    locked: false, selected: false, objective: false, sprite: null, spriteRot: 0, gen: undefined
  };
}

function makeContact() {
  return { entity: null, type: '', friendly: false, hostile: false, isAsteroid: false, isStation: false, dx: 0, dy: 0, distance: 0, locked: false };
}

export function createRadarFeed(tune = RADAR_TUNE) {
  const pool = [];
  const contactPool = [];
  const masses = [];
  const massPool = [];
  const objectives = [];
  const objPool = [];
  const weapons = [];
  const lockSet = new Set();
  const storySet = new Set();
  const metas = new WeakMap();
  let metaSeq = 0;
  const feed = {
    own: { x: 0, y: 0, vx: 0, vy: 0, heading: 0, angle: 0, length: 0, width: 0, sprite: null, spriteRot: 0 },
    targets: pool,
    count: 0,
    range: 20000,
    paintRange: 25000,
    pingSerial: null,
    pingSpeed: 60000,
    pingRange: 90000,
    paused: false,
    world: { features: null, rings: null, stations: null, belt: null },
    overlay: { weapons, nav: null, objectives, masses, ghosts: null, vision: 0 },
    counts: { hostile: 0, friendly: 0, neutral: 0, missiles: 0, total: 0 },
    contacts: [],
    stamp: 0
  };
  let contactCount = 0;

  function rec(i) {
    let r = pool[i];
    if (!r) { r = makeRec(); pool[i] = r; }
    r.gen = undefined;
    r.sprite = null;
    r.spriteRot = 0;
    r.locked = r.selected = r.objective = r.continuous = r.idKnown = r.capital = false;
    r.name = '';
    r.cls = '';
    return r;
  }

  // Dane bytu, które nie zmieniają się co klatkę. Przeliczane po zmianie typu, strony, wraku, kadłuba albo co
  // META_REFRESH zebrań (pierwszy termin rozłożony numerem bytu — bez skoku przy flocie z jednego wezwania).
  function metaOf(e, env, withHull) {
    let m = metas.get(e);
    const typeRaw = e.type || e.shipFrame || '';
    const wreck = !!e.isWreck;
    const friendly = !!e.friendly;
    const hull = e.beamHull || e.hexGrid || null;
    if (m && m.typeRaw === typeRaw && m.wreck === wreck && m.friendly === friendly && m.hull === hull
      && feed.stamp - m.stamp < META_REFRESH) return m;
    if (!m) {
      m = { stamp: 0, typeRaw: '', type: '', wreck: false, friendly: false, hull: null, fighter: false, cls: '', name: '',
        length: 0, width: 0, sprite: null, spriteRot: 0 };
      metas.set(e, m);
      m.stamp = feed.stamp - (metaSeq++ % META_REFRESH);
    } else {
      m.stamp = feed.stamp;
    }
    m.typeRaw = typeRaw;
    m.wreck = wreck;
    m.friendly = friendly;
    m.hull = hull;
    const type = String(typeRaw).toLowerCase();
    m.type = type;
    m.fighter = !e.isCapitalShip && (e.fighter === true || FIGHTER_RE.test(type));
    m.cls = radarClassCode(e.callInTemplateKey || type, e);
    m.name = env.nameOf ? env.nameOf(e) : '';
    if (withHull && env.hullMetrics && (!m.fighter || wreck)) {
      const hm = env.hullMetrics(e);
      m.length = finite(hm?.worldW);
      m.width = finite(hm?.worldH);
      m.sprite = env.spriteOf ? env.spriteOf(e) : null;
      m.spriteRot = env.spriteRotOf ? finite(env.spriteRotOf(e)) : 0;
    } else {
      m.length = m.width = Math.max(20, finite(e.radius, 20) * 2);
      m.sprite = null;
      m.spriteRot = 0;
    }
    return m;
  }

  function contact(entity, type, friendly, hostile, dx, dy, dist, locked, isStation) {
    let c = contactPool[contactCount];
    if (!c) { c = makeContact(); contactPool[contactCount] = c; }
    contactCount++;
    c.entity = entity; c.type = type; c.friendly = friendly; c.hostile = hostile; c.isAsteroid = false;
    c.isStation = isStation; c.dx = dx; c.dy = dy; c.distance = dist; c.locked = locked;
    return c;
  }

  return {
    feed,
    /** Pełne zebranie (gra woła ~10 Hz). */
    collect(env) {
      feed.stamp++;
      const ship = env.ship;
      const own = feed.own;
      const ox = finite(ship?.pos?.x);
      const oy = finite(ship?.pos?.y);
      own.x = ox; own.y = oy;
      own.vx = finite(ship?.vel?.x);
      own.vy = finite(ship?.vel?.y);
      own.heading = own.angle = finite(ship?.angle);
      if (ship && env.hullMetrics) {
        const m = env.hullMetrics(ship);
        own.length = finite(m?.worldW);
        own.width = finite(m?.worldH);
      }
      own.sprite = ship && env.spriteOf ? env.spriteOf(ship) : null;
      own.spriteRot = ship && env.spriteRotOf ? finite(env.spriteRotOf(ship)) : 0;

      const range = Math.max(1000, finite(env.range, 20000));
      feed.range = range;
      const paintRange = range * 1.25;
      feed.paintRange = paintRange;
      feed.pingSerial = env.pingSerial ?? null;
      feed.pingSpeed = finite(env.pingSpeed, 60000);
      feed.pingRange = finite(env.pingRange, 90000);
      feed.paused = !!env.paused;
      feed.world.features = env.features || null;
      feed.world.rings = env.rings || null;
      feed.world.stations = env.stations || null;
      feed.world.belt = env.belt || null;

      lockSet.clear();
      const locked = env.lockedTargets;
      if (Array.isArray(locked)) for (let i = 0; i < locked.length; i++) if (locked[i]) lockSet.add(locked[i]);
      const selected = env.selectedTarget || null;
      const story = env.storyTargets;
      storySet.clear();
      if (story && story.size) for (const mark of story.values()) if (mark?.entity) storySet.add(mark.entity);

      let n = 0;
      contactCount = 0;
      const counts = feed.counts;
      counts.hostile = counts.friendly = counts.neutral = counts.missiles = counts.total = 0;
      const prSq = paintRange * paintRange;
      const rangeSq = range * range;

      const hides = env.hides || (() => false);
      const cloaked = env.cloaked || (() => false);
      const isHostile = env.isHostile || ((e) => !e?.friendly);

      // ---- okręty (NPC) ----
      const npcs = env.npcs;
      if (Array.isArray(npcs)) {
        for (let i = 0; i < npcs.length && n < tune.maxTracks; i++) {
          const e = npcs[i];
          if (!e || e.dead || e.destroyed || e.warpedOut || e.removed) continue;
          if (e.__warpReturn && e.isCollidable === false) continue;
          const ex = finite(e.x, NaN);
          const ey = finite(e.y, NaN);
          if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
          const dx = ex - ox;
          const dy = ey - oy;
          const d2 = dx * dx + dy * dy;
          const isLocked = lockSet.has(e);
          const isSel = selected === e;
          const isObj = storySet.has(e);
          if (d2 > prSq && !isLocked && !isSel && !isObj) continue;
          if (!e.friendly && (hides(e) || cloaked(e))) continue;
          const meta = metaOf(e, env, true);
          const type = meta.type;
          const r = rec(n++);
          r.key = e;
          r.src = RADAR_SRC.XY;
          r.x = ex; r.y = ey; r.vx = finite(e.vx); r.vy = finite(e.vy); r.angle = finite(e.angle);
          r.kind = e.isWreck ? 'wreck' : meta.fighter ? 'fighter' : (type.includes('drone') ? 'drone' : 'ship');
          const friendly = !!e.friendly;
          const hostile = !friendly && isHostile(e);
          r.aff = friendly ? 'friendly' : hostile ? 'hostile' : 'neutral';
          r.capital = !!e.isCapitalShip;
          r.cls = meta.cls;
          r.name = meta.name;
          r.idKnown = friendly;
          r.continuous = friendly;
          r.locked = isLocked;
          r.selected = isSel;
          r.objective = isObj;
          r.length = meta.length;
          r.width = meta.width;
          r.sprite = meta.sprite;
          r.spriteRot = meta.spriteRot;
          if (d2 <= rangeSq && r.kind !== 'wreck') {
            counts.total++;
            if (hostile) counts.hostile++;
            else if (friendly) counts.friendly++;
            else counts.neutral++;
            contact(e, type || 'ship', friendly, hostile, dx, dy, Math.sqrt(d2), isLocked, false);
          }
        }
      }

      // ---- gracz 2 (podzielony ekran) i drony zwiadu: sojusznicy z łącza danych ----
      const p2 = env.player2;
      if (p2 && p2 !== ship && !p2.destroyed && n < tune.maxTracks) {
        const r = rec(n++);
        r.key = p2; r.src = RADAR_SRC.POS; r.kind = 'ship'; r.aff = 'friendly';
        r.x = finite(p2.pos?.x); r.y = finite(p2.pos?.y); r.vx = finite(p2.vel?.x); r.vy = finite(p2.vel?.y);
        r.angle = finite(p2.angle); r.capital = true; r.cls = 'SC'; r.name = 'GRACZ 2'; r.idKnown = r.continuous = true;
        if (env.hullMetrics) { const m = env.hullMetrics(p2); r.length = finite(m?.worldW); r.width = finite(m?.worldH); }
      }
      const drones = env.drones;
      if (Array.isArray(drones)) {
        for (let i = 0; i < drones.length && n < tune.maxTracks; i++) {
          const d = drones[i];
          if (!d || d.dead) continue;
          const pos = d.pos || d;
          const dx = finite(pos.x) - ox;
          const dy = finite(pos.y) - oy;
          if (dx * dx + dy * dy > prSq) continue;
          const r = rec(n++);
          r.key = d; r.src = d.pos ? RADAR_SRC.POS : RADAR_SRC.XY; r.kind = 'drone'; r.aff = 'friendly';
          r.x = finite(pos.x); r.y = finite(pos.y); r.vx = finite(d.vel?.x ?? d.vx); r.vy = finite(d.vel?.y ?? d.vy);
          r.angle = finite(d.angle); r.cls = 'DR'; r.name = 'DRON ZWIADU'; r.idKnown = r.continuous = true;
          r.length = r.width = 40;
        }
      }

      // ---- stacje i budowle (symbol stacji; obrys rysuje podkład terenu) ----
      const stations = env.stations;
      if (Array.isArray(stations)) {
        for (let i = 0; i < stations.length && n < tune.maxTracks; i++) {
          const st = stations[i];
          if (!st || st._destroyed3D || st.destroyed || st.dead) continue;
          const sx = finite(st.x, NaN);
          const sy = finite(st.y, NaN);
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
          const dx = sx - ox;
          const dy = sy - oy;
          const d2 = dx * dx + dy * dy;
          const isLocked = lockSet.has(st);
          const isSel = selected === st;
          const isObj = storySet.has(st);
          if (d2 > prSq && !isLocked && !isSel && !isObj) continue;
          if (hides(st)) continue;
          const hostile = !!st.isPirate || (st.friendly === false && isHostile(st));
          const r = rec(n++);
          r.key = st; r.src = RADAR_SRC.XY; r.kind = 'station';
          r.x = sx; r.y = sy; r.vx = 0; r.vy = 0; r.angle = 0;
          r.aff = hostile ? 'hostile' : (st.friendly || st.ringPort) ? 'friendly' : 'neutral';
          r.cls = 'ST';
          r.name = String(env.stationName ? env.stationName(st) : (st.name || 'Stacja')).toUpperCase();
          r.idKnown = true;
          r.capital = true;
          r.locked = isLocked; r.selected = isSel; r.objective = isObj;
          r.length = r.width = Math.max(80, finite(st.radius) * 2 || finite(st.r) * 2 || 240);
          if (d2 <= rangeSq) contact(st, 'station', !hostile, hostile, dx, dy, Math.sqrt(d2), isLocked, true);
        }
      }

      // ---- wraki (bez symbolu strony: szary ✕ i echo) ----
      const wrecks = env.wrecks;
      if (Array.isArray(wrecks)) {
        let w = 0;
        for (let i = 0; i < wrecks.length && n < tune.maxTracks && w < 48; i++) {
          const e = wrecks[i];
          if (!e || e.dead || e.removed) continue;
          const ex = finite(e.x ?? e.pos?.x, NaN);
          const ey = finite(e.y ?? e.pos?.y, NaN);
          if (!Number.isFinite(ex)) continue;
          const dx = ex - ox;
          const dy = ey - oy;
          if (dx * dx + dy * dy > prSq) continue;
          const r = rec(n++);
          w++;
          r.key = e; r.src = Number.isFinite(e.x) ? RADAR_SRC.XY : RADAR_SRC.POS; r.kind = 'wreck'; r.aff = 'neutral';
          r.x = ex; r.y = ey; r.vx = finite(e.vx ?? e.vel?.x); r.vy = finite(e.vy ?? e.vel?.y); r.angle = finite(e.angle);
          r.cls = 'WR'; r.name = 'WRAK'; r.idKnown = true;
          if (env.hullMetrics) {
            const meta = metaOf(e, env, true);
            r.length = meta.length; r.width = meta.width;
            r.sprite = meta.sprite; r.spriteRot = meta.spriteRot;
          }
        }
      }

      // ---- rakiety 3D w locie (szybkie ślady z wektorami) ----
      const rockets = env.rockets;
      if (Array.isArray(rockets)) {
        let m = 0;
        for (let i = 0; i < rockets.length && n < tune.maxTracks && m < 96; i++) {
          const rk = rockets[i];
          if (!rk || !rk.active) continue;
          const px = finite(rk.position?.x, NaN);
          const pz = finite(rk.position?.z, NaN);
          if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
          const dx = px - ox;
          const dy = pz - oy;
          if (dx * dx + dy * dy > prSq) continue;
          const r = rec(n++);
          m++;
          r.key = rk; r.src = RADAR_SRC.ROCKET; r.kind = 'missile';
          r.aff = rk.hostile ? 'hostile' : 'friendly';
          r.x = px; r.y = pz; r.vx = 0; r.vy = 0; r.angle = 0;
          r.cls = 'MS'; r.name = 'RAKIETA'; r.idKnown = true; r.continuous = !rk.hostile;
          r.gen = finite(rk.seed, 0) + finite(rk.bornFrame, 0) * 1e-3;
          r.length = r.width = 24;
          if (rk.hostile && dx * dx + dy * dy <= rangeSq) counts.missiles++;
        }
      }
      feed.count = n;
      // nadmiar starych rekordów: bez kluczy (tracker czyta tylko [0, count))
      for (let i = n; i < pool.length; i++) { if (pool[i]) pool[i].key = null; }
      feed.contacts.length = contactCount;
      for (let i = 0; i < contactCount; i++) feed.contacts[i] = contactPool[i];

      // ---- nakładki: cel podróży, cele misji (bez śladu), zasięg broni, sygnatury masy, duchy, wzrok ----
      const ov = feed.overlay;
      const nav = env.travelTarget;
      ov.nav = nav && Number.isFinite(nav.x) && Number.isFinite(nav.y) ? nav : null;
      objectives.length = 0;
      if (story && story.size) {
        for (const mark of story.values()) {
          const e = mark?.entity;
          if (!e || e.dead || e.destroyed || e._destroyed3D) continue;
          if (hides(e)) continue;
          let o = objPool[objectives.length];
          if (!o) { o = { x: 0, y: 0, label: '', tracked: false }; objPool[objectives.length] = o; }
          o.x = finite(e.x ?? e.pos?.x); o.y = finite(e.y ?? e.pos?.y); o.label = String(mark.label || 'CEL');
          o.tracked = true;   // cele misji to okręty / stacje — mają ślad z wyróżnieniem
          objectives.push(o);
        }
      }
      weapons.length = 0;
      const wr = env.weaponRanges;
      if (Array.isArray(wr)) for (let i = 0; i < wr.length; i++) if (wr[i] && wr[i].r > 0) weapons.push(wr[i]);
      masses.length = 0;
      const ms = env.massSignatures;
      if (Array.isArray(ms)) {
        for (let i = 0; i < ms.length; i++) {
          const m = ms[i];
          if (!m || !(m.alpha > 0.01)) continue;
          let o = massPool[masses.length];
          if (!o) { o = { x: 0, y: 0, spread: 0, alpha: 0, label: '' }; massPool[masses.length] = o; }
          o.x = finite(m.shownX ?? m.x); o.y = finite(m.shownY ?? m.y); o.spread = finite(m.spread, 6000);
          o.alpha = finite(m.alpha, 1); o.label = String(m.label || '');
          masses.push(o);
        }
      }
      ov.ghosts = env.ghosts || null;
      ov.vision = finite(env.vision, 0);
      return feed;
    }
  };
}
