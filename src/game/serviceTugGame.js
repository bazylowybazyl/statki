// src/game/serviceTugGame.js
//
// HOLOWNIK SERWISOWY — klej gry (logika faz: src/game/serviceTug.js). Gra podaje zależności (`init(deps)` z bloku
// „HOLOWNIK SERWISOWY” w index.html) i woła:
//   restorePose()      — na początku physicsStep (zdejmuje pozę renderu holownika z poprzedniej klatki),
//   step(dt)           — w physicsStep PRZED npcStep (fazy, intencje lotu holownika),
//   afterNpc(dt)       — w physicsStep PO npcStep (poza ładunku na pokładzie / holownik pod ładunkiem w skoku),
//   beginRender()      — w render() po interpolacji gracza (holownik w pozie renderu gracza, gdy gracz na pokładzie).
// Ładunek = statek gracza (sterowanie zablokowane jak w doku K-7 — powód 'tug' w blokadzie wejścia fabuły,
// zderzenia pary wyłączone, kamera dalej na graczu). Skok z ładunkiem robi automat skoku GRACZA (obraz skoku: rulon,
// soczewka świata, ośrodek „Nurtu”), holownik jedzie wtedy pod nim; napędem i przy K-7 prowadzi holownik.

import {
  createServiceTug, stepServiceTug, serviceTugCargoPose, tugUnderCargo, tugHullSize, tugDeckLocal, tugPose,
  SERVICE_TUG, TUG_PHASE, wrapTugAngle
} from './serviceTug.js';
import { setFlightArrive, setFlightStop } from './flight/shipFlightModel.js';
import { excludeBodyCollisions, restoreBodyCollisions } from './towSystem.js';
import { isMainDriveDestroyed } from './engineDamage.js';
import { k7FrameFor, k7HubToGame, k7HubHeadingToGame, k7AxesGame, k7LayoutTemplate } from './story/k7Dock.js';

const _tp = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0 };
const _cp = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0 };
const _size = { length: 0, beam: 0 };
const _deck = { x: 0, y: 0 };
const _under = { x: 0, y: 0, a: 0 };

function alive(e) {
  return !!e && !e.dead && !e.destroyed && !e.removed && !e.isWreck;
}

function setPose(e, x, y, a, vx, vy) {
  if (e.pos) { e.pos.x = x; e.pos.y = y; }
  e.x = x; e.y = y;
  if (e.vel) { e.vel.x = vx; e.vel.y = vy; }
  e.vx = vx; e.vy = vy;
  e.angle = a;
  e.angVel = 0;
}

export const ServiceTugGame = {
  deps: null,
  missions: [],
  tune: SERVICE_TUG,
  // Poza fizyki holownika podmieniona na czas renderu (beginRender) — przywraca restorePose.
  _saved: null,
  _env: null,
  lastDelivery: null,

  init(deps) {
    this.deps = deps;
    this._env = this._makeEnv();
    return this;
  },

  /** Misja holownika `npc` (wołane, gdy holownik powstaje w grze — przylot tunelem). */
  attach(npc, target, opts = {}) {
    if (!npc || !target) return null;
    const m = createServiceTug(npc, target, opts);
    npc.__serviceTug = m;
    this.missions.push(m);
    return m;
  },

  missionOf(npc) {
    return npc?.__serviceTug || null;
  },

  /** Holownik niosący `e` (ładunek na pokładzie) albo null. */
  carrierOf(e) {
    for (const m of this.missions) if (m.target === e && (m.carried || m.overlap) && m.phase !== TUG_PHASE.DONE) return m.npc;
    return null;
  },

  isCarried(e) {
    for (const m of this.missions) if (m.target === e && m.carried) return true;
    return false;
  },

  /** Czy dana encja jest w trakcie misji holownika (cel albo holownik). */
  busy(e) {
    for (const m of this.missions) if ((m.target === e || m.npc === e) && m.phase !== TUG_PHASE.DONE && m.phase !== TUG_PHASE.DEPART) return true;
    return false;
  },

  /** Długość kadłuba do rampy wyjścia ze skoku (gracz na pokładzie — cały zestaw). */
  carriedHullLength(e, own) {
    for (const m of this.missions) {
      if (m.target === e && m.carried) return Math.max(own, tugHullSize(m.npc, _size).length);
    }
    return own;
  },

  /** Skok gracza z ładunkiem trwa (holownik pod graczem — prowadzi gracz). */
  playerLeads(m) {
    return m.carried && m.phase === TUG_PHASE.CARRY && m.legPhase === 'warp';
  },

  restorePose() {
    const s = this._saved;
    if (!s) return;
    this._saved = null;
    const e = s.e;
    if (!alive(e)) return;
    // Tylko poza — prędkość i obrót zostają z fizyki (zerowany obrót co klatkę renderu blokował zawroty holownika).
    if (e.pos) { e.pos.x = s.x; e.pos.y = s.y; }
    e.x = s.x; e.y = s.y;
    e.angle = s.a;
  },

  step(dt) {
    if (!this.missions.length) return;
    const env = this._env;
    let write = 0;
    for (let i = 0; i < this.missions.length; i++) {
      const m = this.missions[i];
      stepServiceTug(m, env, dt, this.tune);
      if (m.phase === TUG_PHASE.DONE || (m.phase === TUG_PHASE.DEPART && !alive(m.npc))) {
        if (m.npc.__serviceTug === m) m.npc.__serviceTug = null;
        continue;
      }
      this.missions[write++] = m;
    }
    this.missions.length = write;
  },

  afterNpc(dt) {
    const inv = dt > 0 ? 1 / dt : 0;
    for (const m of this.missions) {
      if (!m.carried || !alive(m.npc) || !alive(m.target)) { m._last = null; continue; }
      const npc = m.npc, target = m.target;
      if (this.playerLeads(m)) {
        // Skok gracza z ładunkiem: holownik pod nim (ten sam ruch; w skoku bez zderzeń — jak gracz w tunelu).
        tugPose(target, _cp);
        tugHullSize(npc, _size);
        tugDeckLocal(_size, this.tune, _deck);
        tugUnderCargo(_cp, _deck, m.rel, _under);
        setPose(npc, _under.x, _under.y, _under.a, _cp.vx, _cp.vy);
        npc.isCollidable = false;
        m._last = null;
        continue;
      }
      if (npc.isCollidable === false && m.phase !== TUG_PHASE.DEPART) npc.isCollidable = true;
      const p = serviceTugCargoPose(m, this.tune);
      if (!p) continue;
      // Prędkość ładunku: ruch pozy między krokami (pierwszy krok — prędkość holownika). Nie z różnicy z pozą po
      // całkowaniu gracza w tym kroku (applyPlayerLock) — ta dawałaby na przemian v i 0.
      let vx, vy;
      const last = m._last;
      if (last && inv > 0) {
        vx = (p.x - last.x) * inv;
        vy = (p.y - last.y) * inv;
      } else {
        tugPose(npc, _tp);
        vx = _tp.vx; vy = _tp.vy;
      }
      if (!m._last) m._last = { x: 0, y: 0 };
      m._last.x = p.x; m._last.y = p.y;
      setPose(target, p.x, p.y, p.a, vx, vy);
    }
  },

  /** render(): gracz na pokładzie — holownik w pozie renderu gracza (interpolacja), fizyka wraca w restorePose. */
  beginRender(playerRenderPose) {
    if (!playerRenderPose || !this.missions.length) return;
    const player = this.deps?.player?.();
    for (const m of this.missions) {
      if (!m.carried || m.target !== player || !alive(m.npc) || m.phase === TUG_PHASE.UNLOAD) continue;
      const npc = m.npc;
      if (!this._saved) this._saved = { e: npc, x: npc.x, y: npc.y, a: npc.angle };
      tugHullSize(npc, _size);
      tugDeckLocal(_size, this.tune, _deck);
      _cp.x = playerRenderPose.x; _cp.y = playerRenderPose.y; _cp.a = playerRenderPose.angle;
      // Osiadanie (zaczepy): ładunek względem pokładu się zmienia — holownik zostaje w swojej pozie fizyki.
      if (m.phase === TUG_PHASE.CLAMP) continue;
      tugUnderCargo(_cp, _deck, m.rel, _under);
      if (npc.pos) { npc.pos.x = _under.x; npc.pos.y = _under.y; }
      npc.x = _under.x; npc.y = _under.y; npc.angle = _under.a;
      break;
    }
  },

  _makeEnv() {
    const self = this;
    const d = () => self.deps;
    return {
      alive,
      ghost: (npc) => npc.isCollidable === false,
      returning: (npc) => !!npc.__warpReturn,
      arrive: (npc, x, y, opts) => setFlightArrive(npc, x, y, opts),
      stop: (npc, face) => setFlightStop(npc, face),
      needsTow: (target) => isMainDriveDestroyed(target),
      rig: {
        start: (npc, target) => d().rigStart?.(npc, target) || null,
        status: (h) => d().rigStatus?.(h) || '',
        stop: (h) => d().rigStop?.(h)
      },
      lockCargo: (m, mode) => self._lockCargo(m, mode),
      placeCargo: (target, x, y, a, stop) => {
        // Koniec zjazdu (stanowisko) — zapamiętany dla narzędzi (scripts/webgpu/holownik-gra.mjs).
        if (stop) { setPose(target, x, y, a, 0, 0); self.lastDelivery = { x, y, a }; }
        else setPose(target, x, y, a, target.vel ? target.vel.x : target.vx, target.vel ? target.vel.y : target.vy);
      },
      hall: () => self._hall(),
      berthId: () => self._berthId(),
      route: (m, to) => {
        tugPose(m.npc, _tp);
        const waypoints = d().planRoute?.(_tp, to) || [to];
        return { target: to, waypoints, wells: d().wells?.() || [] };
      },
      warpStart: (m, leg, bearing) => d().carryWarpStart?.(m, leg, bearing) === true,
      warpBusy: () => !!d().carryWarpBusy?.(),
      warpStep: (m, leg) => d().carryWarpStep?.(m, leg),
      remont: (target) => d().remont?.(target),
      depart: (npc, angle) => d().depart?.(npc, angle),
      say: (text, m) => d().say?.(text, m)
    };
  },

  _lockCargo(m, mode) {
    const d = this.deps;
    const npc = m.npc, target = m.target;
    if (mode === 'overlap' || mode === 'clamp') {
      if (!m.__excluded) { excludeBodyCollisions(npc, target); m.__excluded = true; }
      // Holownik pod statkiem (skóra niżej w passie ortho — hexShips3D); lampy jednego nie oświetlają drugiego
      // (shipLightRuntime.js — leżą tuż nad blachą drugiego kadłuba).
      npc.__skinZ = -1.2;
      npc.__lightMate = target;
      target.__lightMate = npc;
      if (mode === 'clamp') {
        if (target === d?.player?.()) d.lockPlayer?.(true, m);
        target.__carriedBy = npc;
        npc.__cargo = target;
      }
      return;
    }
    // off
    if (m.__excluded) { restoreBodyCollisions(npc, target); m.__excluded = false; }
    if (target.__carriedBy === npc) target.__carriedBy = null;
    if (npc.__cargo === target) npc.__cargo = null;
    if (target.__lightMate === npc) target.__lightMate = null;
    if (npc.__lightMate === target) npc.__lightMate = null;
    if (target === d?.player?.()) d.lockPlayer?.(false, m);
    if (alive(npc)) npc.__skinZ = 0;
  },

  _earth() {
    return this.deps?.earth?.() || null;
  },

  _berthId() {
    return this.deps?.berthId?.() || 'C-01';
  },

  // Hala gracza (K-7 Ziemi, kompleks 0) dla planu wyładunku (serviceTug.js: planK7Unload).
  _hall() {
    const earth = this._earth();
    if (!earth) return null;
    const frame = k7FrameFor(earth, 0);
    if (!frame) return null;
    const layout = k7LayoutTemplate();
    const id = this._berthId();
    const berth = layout.berths.find((b) => b.id === id) || layout.berths[0];
    const lane = layout.lanes.find((l) => l.berthId === berth.id);
    const axes = k7AxesGame(frame);
    return {
      toGame: (hx, hz, out) => k7HubToGame(earth, frame, hx, hz, out),
      outAngle: Math.atan2(axes.out.y, axes.out.x),
      berth: { x: berth.x, z: berth.z, angle: k7HubHeadingToGame(frame, berth.angle) },
      laneEnd: lane ? lane.z1 : layout.frontZ + layout.apronDepth + 120
    };
  }
};

export { TUG_PHASE, SERVICE_TUG, wrapTugAngle };
