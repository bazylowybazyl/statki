// Dokowanie gracza w całym porcie Ziemi — hale K-7 (4) i otwarte zatoki (8)
// jednym automatem; uogólnienie K7Docking (haloPortK7Layout.js). Poprawka
// użytkownika 2026-09-23: gracz lata frachtowcami i innymi statkami jak NPC
// (haloPortHulls.js), więc dokuje na każdym stanowisku, na którym jego kadłub
// się mieści — w hali i poza nią. Czysta matematyka, bez Three.
//
// Rejestr: stanowiska wszystkich hal i zatok w układzie huba hali gracza
// (kompleks 0), przez przejście ramek. Sekwencje (fazy czasu, nie
// dociąganie — hangar-dock-demo):
//  - stanowiska capital K-7: suwnica i węże paliwowe (9,3 s / 9,5 s, jak K-7);
//  - pozostałe (grzebienie K-7, zatoki, pas MEGA): mocowanie magnetyczne
//    i rękaw serwisowy (4,6 s / 4,2 s), stan na lampce stanowiska.
import {
  K7CollisionWorld,
  K7_CONNECTED_POSE,
  K7_STOWED_POSE,
  buildK7Collision,
  k7AngleDelta,
  k7BoxPoly,
  k7ConvexOverlap,
  k7Phase,
  k7WorldToHub
} from './haloPortK7Layout.js';
import { HALO_TRANSIT, haloTransitAngles } from './haloRingConfig.js';
import { bayLaneOf, baySolidList, haloFrameToFrame, haloXfPoint } from './haloPortBays.js';
import { haloHullFits } from './haloPortHulls.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;

export const PORT_SEQUENCE = Object.freeze({
  crane: Object.freeze({ dock: 9.3, undock: 9.5 }),
  clamp: Object.freeze({ dock: 4.6, undock: 4.2 })
});

/**
 * Rejestr stanowisk portu w układzie huba `frame` (hala gracza).
 * halls: [{ index, frame, layout }], bays: [układ zatoki z `frame`].
 */
export function createPortRegistry({ halls, bays, frame }) {
  const entries = [];
  const owners = [];
  const tmp = {};
  const add = (b, kind, owner, label) => {
    const p = haloXfPoint(owner.xf, b.x, b.z, tmp);
    const e = {
      berth: b, kind, owner, complex: owner.complex, label,
      x: p.x, z: p.z, angle: b.angle + owner.xf.phi,
      crane: kind === 'k7' && b.size === 'CAPITAL'
    };
    entries.push(e);
    return e;
  };
  for (const h of halls) {
    const owner = {
      kind: 'k7', index: h.index, complex: h.index, layout: h.layout, frame: h.frame,
      xf: haloFrameToFrame(h.frame, frame), inv: haloFrameToFrame(frame, h.frame), poses: new Map()
    };
    for (const b of h.layout.berths) {
      if (b.size === 'CAPITAL') owner.poses.set(b.id, { ...K7_STOWED_POSE });
      add(b, 'k7', owner, h.index === 0 ? b.id : `K7-${h.index + 1} ${b.id}`);
    }
    owners.push(owner);
  }
  bays.forEach((bay, k) => {
    const owner = {
      kind: 'bay', index: k, complex: bay.complex, layout: bay, frame: bay.frame,
      xf: haloFrameToFrame(bay.frame, frame), inv: haloFrameToFrame(frame, bay.frame)
    };
    for (const b of bay.berths) add(b, 'bay', owner, b.id);
    owners.push(owner);
  });
  return { entries, owners, halls: owners.filter((o) => o.kind === 'k7'), bays: owners.filter((o) => o.kind === 'bay') };
}

/**
 * Świat kolizji portu w układzie huba `frame` (hala gracza): hale wszystkich
 * kompleksów (ściany, przypory, słupy kołnierza, ładunki, nogi suwnic,
 * piedestały paliwowe), otwarte zatoki (ściany, kołnierze, słupki serwisowe
 * i paliwowe, nogi suwnic) i tunele tranzytów (ściany, portale obu wylotów).
 * Statki NPC dołoży system ruchu jako przedmioty ruchome (refresh).
 */
export function buildPortCollision({ registry, frame, ringLayout }) {
  const col = new K7CollisionWorld();
  const q = {};
  const toHub = (o, pts) => pts.map((p) => { haloXfPoint(o.xf, p.x, p.z, q); return { x: q.x, z: q.z }; });
  for (const o of registry.halls) {
    for (const it of buildK7Collision(o.layout).items) {
      if (it.id === 'player') continue;
      col.addPolygon(o.index === 0 ? it.id : `K${o.index + 1} ${it.id}`, toHub(o, it.polygon), it.y0, it.y1);
    }
  }
  for (const o of registry.bays) {
    const bay = o.layout;
    for (const s of baySolidList(bay)) col.addPolygon(s.id, toHub(o, k7BoxPoly(s.x, s.z, s.w, s.d, s.angle)), s.y - s.h / 2, s.y + s.h / 2);
  }
  // tunele tranzytów w płycie podłogi (x wzdłuż ringu, y od płyty portu na zewnątrz)
  const T = HALO_TRANSIT;
  const rF = frame.floorR;
  const slab = rF - ringLayout.radii.back;
  const tmp = {};
  haloTransitAngles().forEach((theta, i) => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const toFrame = (xd, yd) => k7WorldToHub(frame, (rF + yd) * c - xd * s, (rF + yd) * s + xd * c, tmp);
    const ang = Math.atan2(-s * frame.rx + c * frame.ry, -s * frame.tx + c * frame.ty);
    const id = 'T-' + String(i + 1).padStart(2, '0');
    for (const sd of [-1, 1]) {
      let h = toFrame(sd * (T.halfWidth + T.wall * 0.5), (30 - slab - 40) * 0.5);
      col.addBox(id + ' ŚCIANA', h.x, h.z, T.wall, slab + 70, ang, -80, 460);
      for (const [y0, y1] of [[-60, 150], [-slab - 150, -slab + 60]]) {
        h = toFrame(sd * (T.halfWidth + T.wall + T.frame * 0.5), (y0 + y1) * 0.5);
        col.addBox(id + ' PORTAL', h.x, h.z, T.frame, y1 - y0, ang, -80, 460);
      }
    }
  });
  return col;
}

// Pas stanowiska (capital K-7 / MEGA zatoki) albo null.
function laneOf(e) {
  const l = e.owner.layout;
  if (e.kind === 'k7') return l.lanes?.find((v) => v.berthId === e.berth.id) || null;
  return e.berth.size === 'MEGA' ? bayLaneOf(l, e.berth) : null;
}

export class PortDocking {
  constructor(registry, player, hull) {
    this.reg = registry;
    this.player = player;
    this.hull = hull;
    this.state = 'FREE';
    this.time = 0;
    this.entry = null;
    this.released = null;
    this.startPose = { x: 0, z: 0, angle: 0 };
    this.detail = 'NAPĘD RĘCZNY';
    this.progress = 0;
    this.sequence = 0;
    this.onNotice = null;
    this.onState = null;
    this._poly = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
    this._local = [];
    this._p = {};
    player.locked = false;
  }

  notice(text) { this.onNotice?.(text); }
  fits(e) { return haloHullFits(this.hull, e.berth); }
  sequenceOf(e) { return e?.crane ? PORT_SEQUENCE.crane : PORT_SEQUENCE.clamp; }

  // Start zadokowany na stanowisku (spawn, reset dema).
  dockAt(e) {
    const p = this.player;
    this.entry = e;
    e.berth.occupied = 'player';
    e.berth.reserved = 'player';
    const lane = laneOf(e);
    if (lane) lane.reserved = 'player';
    p.x = e.x; p.z = e.z; p.angle = e.angle;
    p.vx = p.vz = p.angVel = 0;
    p.locked = true;
    if (e.crane) Object.assign(e.owner.poses.get(e.berth.id), K7_CONNECTED_POSE);
    this.state = 'DOCKED';
    this.time = 0;
    this.progress = 1;
    this.detail = 'GOTOWY / LINIE PODŁĄCZONE';
  }

  taken(b) {
    return (b.occupied && b.occupied !== 'player') || (b.reserved && b.reserved !== 'player');
  }

  eligibility(e) {
    const p = this.player;
    const b = e.berth;
    if (!this.fits(e)) return { ok: false, reason: 'STANOWISKO ZA MAŁE' };
    if (b.occupied && b.occupied !== 'player') return { ok: false, reason: 'STANOWISKO ZAJĘTE' };
    if (b.reserved && b.reserved !== 'player') return { ok: false, reason: 'PAS ZAREZERWOWANY' };
    const c = b.capture;
    const ca = Math.cos(e.angle);
    const sa = Math.sin(e.angle);
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const along = Math.abs(dx * ca + dz * sa);
    const across = Math.abs(-dx * sa + dz * ca);
    // tolerancje pola STOP w osiach stanowiska (capture K-7: halfWidth wzdłuż x układu stanowiska)
    const axisX = Math.abs(Math.cos(b.angle)) > 0.5;
    const tolAlong = axisX ? c.halfWidth : c.halfLength;
    const tolAcross = axisX ? c.halfLength : c.halfWidth;
    const angle = Math.abs(k7AngleDelta(p.angle, e.angle));
    const speed = Math.hypot(p.vx, p.vz);
    if (along > tolAlong || across > tolAcross) return { ok: false, reason: 'USTAW SIĘ NA POLU STOP', along, across };
    if (angle > c.maxAngle) return { ok: false, reason: 'WYRÓWNAJ DZIÓB DO STANOWISKA', angle };
    if (speed > c.maxSpeed || Math.abs(p.angVel) > 0.07) return { ok: false, reason: 'WYHAMUJ / SPACJA', speed };
    return { ok: true, reason: 'DOKUJ ' + e.label };
  }

  // Najbliższe stanowisko, na którym kadłub się mieści i które jest wolne.
  candidate() {
    const p = this.player;
    let best = null;
    let d = Infinity;
    for (const e of this.reg.entries) {
      if (!this.fits(e) || this.taken(e.berth)) continue;
      const distance = Math.hypot(p.x - e.x, p.z - e.z);
      if (distance < d) { d = distance; best = e; }
    }
    return best ? { entry: best, berth: best.berth, distance: d, ...this.eligibility(best) } : null;
  }

  requestDock() {
    if (this.state !== 'FREE') return false;
    const c = this.candidate();
    if (!c?.ok) { this.notice(c?.reason ? `${c.reason} / ${c.entry.label}` : 'BRAK WOLNEGO STANOWISKA DLA KADŁUBA'); return false; }
    const e = c.entry;
    this.entry = e;
    e.berth.occupied = 'player';
    e.berth.reserved = 'player';
    const lane = laneOf(e);
    if (lane) lane.reserved = 'player';
    const p = this.player;
    p.locked = true;
    p.vx = p.vz = p.angVel = 0;
    this.startPose.x = p.x; this.startPose.z = p.z; this.startPose.angle = p.angle;
    this.setState('DOCKING');
    this.notice('PRZECHWYCENIE LOKALNE / ' + e.label);
    return true;
  }

  requestUndock() {
    if (this.state !== 'DOCKED') return false;
    this.setState('UNDOCKING');
    this.notice('ODŁĄCZANIE OBSŁUGI. NAPĘD POZOSTAJE ZABLOKOWANY.');
    return true;
  }

  action() {
    return this.state === 'DOCKED' ? this.requestUndock() : this.state === 'FREE' ? this.requestDock() : false;
  }

  setState(state) {
    this.state = state;
    this.time = 0;
    this.progress = 0;
    this.onState?.(state, this.entry?.label ?? null);
  }

  _pose(e) { return e?.crane ? e.owner.poses.get(e.berth.id) : null; }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const p = this.player;
    const e = this.entry;
    const P = k7Phase;
    if (this.state === 'DOCKED') {
      p.locked = true;
      this.detail = p.fuel < 99.99 ? 'TANKOWANIE / LINIE PODŁĄCZONE' : 'GOTOWY / LINIE PODŁĄCZONE';
      p.fuel = Math.min(100, p.fuel + 3.5 * dt);
      this.progress = 1;
      const pose = this._pose(e);
      if (pose) { Object.assign(pose, K7_CONNECTED_POSE); pose.flow = p.fuel < 100 ? 1 : 0; }
    } else if (this.state === 'DOCKING') {
      const seq = this.sequenceOf(e);
      this.progress = clamp(t / seq.dock, 0, 1);
      const f = P(t, 0, 1.1);
      p.x = mix(this.startPose.x, e.x, f);
      p.z = mix(this.startPose.z, e.z, f);
      p.angle = this.startPose.angle + k7AngleDelta(e.angle, this.startPose.angle) * f;
      const pose = this._pose(e);
      if (pose) {
        pose.bridge = P(t, 1.1, 3.4); pose.trolley = P(t, 3.4, 4.4); pose.lower = P(t, 4.4, 6.4); pose.clamp = P(t, 6.4, 7);
        pose.extension = P(t, 7, 8.7); pose.lock = P(t, 8.7, 9.3); pose.flow = 0; pose.vent = 0;
        this.detail = t < 1.1 ? 'PRECYZYJNE USTAWIENIE' : t < 3.4 ? 'PODJAZD MOSTU SUWNICY' : t < 4.4 ? 'POZYCJONOWANIE WÓZKA'
          : t < 6.4 ? 'OPUSZCZANIE CHWYTAKÓW' : t < 7 ? 'MOCOWANIE KADŁUBA' : t < 8.7 ? 'ROZWIJANIE PRZEWODÓW' : 'RYGLOWANIE ZŁĄCZY';
      } else {
        this.detail = t < 1.1 ? 'PRECYZYJNE USTAWIENIE' : t < 2.2 ? 'MOCOWANIE MAGNETYCZNE' : t < 3.6 ? 'RĘKAW SERWISOWY / ZASILANIE' : 'RYGLOWANIE ZŁĄCZY';
      }
      if (t >= seq.dock) {
        this.sequence++;
        this.setState('DOCKED');
        if (pose) Object.assign(pose, K7_CONNECTED_POSE);
        this.progress = 1;
        this.notice('ZADOKOWANO / ' + e.label + ' / OBSŁUGA AKTYWNA');
      }
    } else if (this.state === 'UNDOCKING') {
      const seq = this.sequenceOf(e);
      this.progress = clamp(t / seq.undock, 0, 1);
      const pose = this._pose(e);
      if (pose) {
        pose.bridge = 1 - P(t, 8.2, 9.5); pose.trolley = 1 - P(t, 6.7, 8.2); pose.lower = 1 - P(t, 5, 6.7); pose.clamp = 1 - P(t, 4.4, 5);
        pose.extension = 1 - P(t, 2.2, 4.4); pose.lock = 1 - P(t, 1.4, 2.2); pose.flow = 0;
        pose.vent = t > 0.6 && t < 1.4 ? Math.sin((t - 0.6) / 0.8 * Math.PI) : 0;
        this.detail = t < 0.6 ? 'ODCIĘCIE PRZEPŁYWU' : t < 1.4 ? 'KONTROLOWANY UPUST' : t < 2.2 ? 'ODRYGLOWANIE ZŁĄCZY' : t < 4.4 ? 'ZWIJANIE PRZEWODÓW'
          : t < 5 ? 'ZWALNIANIE MOCOWAŃ' : t < 6.7 ? 'PODNOSZENIE CHWYTAKÓW' : t < 8.2 ? 'PARKOWANIE WÓZKA' : 'ODSUNIĘCIE SUWNICY';
      } else {
        this.detail = t < 0.8 ? 'ODCIĘCIE PRZEPŁYWU' : t < 2.2 ? 'ODŁĄCZANIE RĘKAWA' : t < 3.4 ? 'ZWALNIANIE MOCOWAŃ' : 'TEST NAPĘDU';
      }
      if (t >= seq.undock) {
        if (pose) Object.assign(pose, K7_STOWED_POSE);
        e.berth.occupied = null;
        this.released = e;
        this.entry = null;
        p.locked = false;
        this.setState('FREE');
        this.detail = 'S / WYCOFAJ Z POLA';
        this.notice('NAPĘD ODBLOKOWANY. S: WYCOFAJ Z POLA ' + e.label + '.');
      }
    } else {
      this.progress = 0;
      this.detail = 'NAPĘD RĘCZNY';
      const r = this.released;
      if (r && !this._overlapsBerthArea(r)) {
        r.berth.reserved = null;
        const lane = laneOf(r);
        if (lane) lane.reserved = null;
        this.released = null;
      }
    }
  }

  // Kadłub gracza (hub hali gracza) na polu stanowiska lub jego pasie?
  _overlapsBerthArea(e) {
    const b = e.berth;
    const inv = e.owner.inv;
    const hull = this.player.polygon();
    const local = this._local;
    while (local.length < hull.length) local.push({ x: 0, z: 0 });
    local.length = hull.length;
    for (let i = 0; i < hull.length; i++) haloXfPoint(inv, hull[i].x, hull[i].z, local[i]);
    const lane = laneOf(e);
    const poly = this._poly;
    let x0; let x1; let z0; let z1;
    if (lane) {
      x0 = lane.x - lane.width / 2; x1 = lane.x + lane.width / 2;
      z0 = Math.min(lane.z0, b.z - b.length / 2); z1 = lane.z1;
    } else {
      x0 = b.x - b.width / 2 - 60; x1 = b.x + b.width / 2 + 60;
      z0 = b.z - b.length / 2 - 60; z1 = b.z + b.length / 2 + 60;
    }
    poly[0].x = x0; poly[0].z = z0;
    poly[1].x = x1; poly[1].z = z0;
    poly[2].x = x1; poly[2].z = z1;
    poly[3].x = x0; poly[3].z = z1;
    return k7ConvexOverlap(local, poly);
  }

  berthLampState(b) {
    return b.occupied ? 'occupied' : b.reserved ? 'reserved' : 'free';
  }
}
