// src/game/cloakLooks.js
//
// Krok WYGLĄDU maskowania po stronie gry (RW-26, docs/PLAN-render-worker.md § 4): raz na klatkę renderu,
// PRZED updateHexShips3D (i przed pakowaniem migawki) — wygląd (src/game/cloakLook.js: fazy, front progów,
// widoczność, zdarzenia CLOAK_EVENT) encji z `cloak` albo z wyglądem, który jeszcze gaśnie. Obraz (cząstki,
// światła, wizjer, uniformy refrakcji) robi render z wyniku tej klatki: src/3d/cloak/hullCloak.js
// (`renderCloakLooks(CLOAK_LOOK_FRAME, …)`). Bez three i DOM.

import { createCloakLook, stepCloakLook } from './cloakLook.js';
import { HullBodies, hullSpriteRotation } from './hullBodies.js';

/**
 * Wynik kroku tej klatki (jeden obiekt, nadpisywany): dt [s], time [s] (zegar wzoru — ten sam co uTime kadłubów),
 * list — encje z aktywnym wyglądem po kroku (kolejność listy wejściowej), playerLook — wygląd gracza (wizjer) albo
 * null, player — encja gracza.
 */
export const CLOAK_LOOK_FRAME = { dt: 0, time: 0, list: [], playerLook: null, player: null };

const _pose = { x: 0, y: 0, angle: 0, scale: 1, spriteW: 1, spriteH: 1, speed: 0, turn: 0 };
let _seedNext = 1;
let _lastMs = 0;

/**
 * entities — encje renderu tej klatki; nowMs — czas klatki [ms] (performance.now()); getPose(e) → { x, y, angle } pozy
 * renderu albo null; player — okręt, którym gracz steruje (wizjer, wstrząs przy zerwaniu). Zwraca CLOAK_LOOK_FRAME.
 */
export function stepCloakLooks(entities, nowMs, getPose, player = null) {
  const F = CLOAK_LOOK_FRAME;
  const dt = _lastMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - _lastMs) * 0.001)) : 0;
  _lastMs = nowMs;
  const t = nowMs * 0.001;
  F.dt = dt;
  F.time = t;
  F.list.length = 0;
  F.playerLook = null;
  F.player = player;
  if (!entities) return F;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e || e.dead || (!e.cloak && !e.__cloakLook)) continue;
    let look = e.__cloakLook;
    if (!look) {
      // Od razu przy encji z maskowaniem (także wyłączonym): pierwsze przejście off → engaging to zdarzenie
      // (impuls siatki, cząstki) — wygląd tworzony dopiero w trakcie włączania już by go nie zobaczył.
      if (!e.cloak) continue;
      look = e.__cloakLook = createCloakLook(e.cloak, (_seedNext++ * 7919) & 0xffff);
    }
    if (!writeEntityPose(e, getPose, _pose)) { look.active = false; continue; }
    if (stepCloakLook(look, e.cloak, dt, t, _pose)) F.list.push(e);
    if (e === player) F.playerLook = look;
  }
  return F;
}

// Poza wzoru: środek sprite'a w świecie gry, kąt osi +u sprite'a, skala i rozmiar sprite'a, ruch.
function writeEntityPose(e, getPose, out) {
  const hull = e.beamHull;
  if (!hull || hull.entity !== e || !hull.body || hull.body.dead) return false;
  const pose = getPose ? getPose(e) : null;
  const ex = pose ? pose.x : (e.pos ? e.pos.x : Number(e.x) || 0);
  const ey = pose ? pose.y : (e.pos ? e.pos.y : Number(e.y) || 0);
  const angle = pose ? pose.angle : (Number(e.angle) || 0);
  const a = angle + hullSpriteRotation(e);
  // Środek sprite'a w układzie ciała (jak modele 3D: latticeMin + anchorD) względem kotwicy encji.
  const theta = -a;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const bx = hull.body.latticeMin.x + hull.anchorDX - HullBodies.anchorLocalX(hull);
  const by = hull.body.latticeMin.y + hull.anchorDY - HullBodies.anchorLocalY(hull);
  // ciało → scena (obrót θ), scena → świat (y odbite)
  out.x = ex + (c * bx - s * by);
  out.y = ey - (s * bx + c * by);
  out.angle = a;
  out.scale = hull.scale;
  out.spriteW = hull.srcWidth;
  out.spriteH = hull.srcHeight;
  const vx = e.vel ? e.vel.x : Number(e.vx) || 0;
  const vy = e.vel ? e.vel.y : Number(e.vy) || 0;
  out.speed = Math.sqrt(vx * vx + vy * vy);
  out.turn = Number(e.angVel ?? e.angularVelocity) || 0;
  return true;
}
