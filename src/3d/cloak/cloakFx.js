// src/3d/cloak/cloakFx.js
//
// Cząstki i światła maskowania (2026-10-04, efekt jak w Crysis) — na pulach efektów broni (WeaponFx:
// gpuFx.js — iskry, blask, łuki elektryczne, refrakcja) i świetle efektów (Core3D.fx.lights → siatka
// świateł). Nic własnego na GPU: paczki przez budowniczego puli, nośnik = okręt (efekty jadą z kadłubem),
// losowanie z fxRandom (nigdy Math.random — sekwencja gry).
//
// Zdarzenia z look.events (src/game/cloakLook.js):
//   ENGAGE  — światło generatora na poszyciu i łuki rozchodzące się po kadłubie (bez rozchodzącego się okręgu —
//             fala refrakcji i rosnący błysk usunięte, decyzja użytkownika 2026-10-05);
//   przejście — w trakcie włączania i powrotu iskry i „okruchy” energii w losowych miejscach całego kadłuba
//             (komórki przełączają się w losowej kolejności — bez frontu biegnącego po heksach);
//   BREAK   — zerwanie: jasny błysk, mocniejsza fala, łuki po całym kadłubie, snop iskier, wstrząs (gracz);
//   REVEAL / VISIBLE — mały błysk na początku i końcu powrotu;
//   migotanie (końcówka energii) — trzaski krótkich łuków.
import { WeaponFx } from '../weapons/weaponFx.js';
import { K } from '../weapons/gpuFx.js';
import { fxRandom } from '../fx/fxRandom.js';
import { ActiveCarrier, createCarrier, writeCarrier } from '../../game/carrierVelocity.js';
import { CLOAK_EVENT } from '../../game/cloakLook.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + fxRandom.next() * (b - a);

// Barwy HDR (rdzenie > 0,9 — bloom; ciała 0,3–1,3).
const C_SPARK = [0.55, 1.85, 3.1];
const C_FLECK0 = [0.45, 1.5, 2.6];
const C_FLECK1 = [0.04, 0.22, 0.55];
const C_ARC = [0.55, 1.9, 3.5];
const C_ARC_BREAK = [2.0, 1.1, 3.4];

/** Strojenie (tempo na sekundę i liczności przy kadłubie ~1000 j.; skala rośnie z rozmiarem). */
export const CLOAK_FX = Object.freeze({
  frontSparks: 150,     // iskry frontu [1/s]
  frontFlecks: 55,      // okruchy energii frontu [1/s]
  engageArcs: 7,
  breakArcs: 16,
  breakSparks: 70,
  crackleRate: 4,       // trzaski przy migotaniu [1/s] przy pełnym migotaniu
  maxPerFrame: 24       // limit paczek frontu na klatkę
});

const _carrier = createCarrier();
const _P = { x: 0, y: 0 };
const _D = { x: 1, y: 0 };
const _H = { x: 0, y: 0 };

/** Punkt kadłuba (świat gry) w promieniu r [część półdługości] od środka sprite'a, kąt a; null — poza kadłubem. */
function hullPointAt(look, entity, probe, r, a, out) {
  const lx = Math.cos(a) * r * look.halfPx;
  const ly = Math.sin(a) * r * look.halfPx;
  const s = look.scale;
  out.x = look.px + (lx * look.cos - ly * look.sin) * s;
  out.y = look.py + (lx * look.sin + ly * look.cos) * s;
  return !probe || probe(entity, out.x, out.y) ? out : null;
}

/** Losowy punkt na kadłubie (do `tries` prób) w pierścieniu promieni [r0, r1]. */
function randomHullPoint(look, entity, probe, r0, r1, out, tries = 6) {
  for (let i = 0; i < tries; i++) {
    if (hullPointAt(look, entity, probe, rand(r0, r1), fxRandom.next() * TAU, out)) return out;
  }
  return null;
}

// Świat gry → scena (x, −y).
function toScene(wx, wy, out) { out.x = wx; out.y = -wy; return out; }

export const CloakFx = {
  enabled: true,
  stats: { events: 0, sparks: 0, arcs: 0 },
  _acc: new WeakMap(),

  /**
   * Raz na klatkę renderu dla encji z aktywnym wyglądem maskowania (hullCloak.js). probe(entity, x, y) —
   * czy punkt świata leży na kadłubie (HullBodies.probe); isPlayer — wstrząs kamery przy zerwaniu.
   */
  update(entity, look, dt, probe, isPlayer = false) {
    if (!this.enabled || !look || !WeaponFx.available) return;
    const ctx = WeaponFx.ctx;
    if (!ctx || !ctx.fx) return;
    const ev = look.events;
    const sweeping = (look.phase === 'engage' || look.phase === 'reveal') && look.progress > 0 && look.progress < 1;
    const crackle = look.flicker > 0.02;
    if (!ev && !sweeping && !crackle) return;
    const halfWorld = look.halfPx * look.scale;
    if (typeof WeaponFx._inView === 'function' && !WeaponFx._inView(look.px, look.py, halfWorld * 1.5)) return;
    // Skala efektów z rozmiarem kadłuba (Atlas ~1, fregata ~0,4).
    const S = Math.max(0.25, Math.min(2.2, halfWorld / 550));
    ActiveCarrier.set(writeCarrier(entity, look.px, look.py, true, _carrier));
    try {
      if (ev & CLOAK_EVENT.ENGAGE) this._engage(ctx, entity, look, probe, S, halfWorld);
      if (ev & CLOAK_EVENT.BREAK) this._break(ctx, entity, look, probe, S, halfWorld, isPlayer);
      if (ev & (CLOAK_EVENT.REVEAL | CLOAK_EVENT.VISIBLE)) this._flash(ctx, look, S, halfWorld, ev & CLOAK_EVENT.VISIBLE ? 0.6 : 1);
      if (sweeping) this._front(ctx, entity, look, probe, S, dt);
      if (crackle) this._crackle(ctx, entity, look, probe, S, dt);
    } finally {
      ActiveCarrier.clear();
    }
  },

  _flash(ctx, look, S, halfWorld, k) {
    ctx.lights.flash(look.px, look.py, 0.35, 0.8, 1.0, 1.8 * k * Math.min(1.6, S), halfWorld * 1.6, 0.4, 2, 0.25, 40);
  },

  _engage(ctx, entity, look, probe, S, halfWorld) {
    const fx = ctx.fx;
    this.stats.events++;
    // generator w środku: światło na poszyciu (bez rozchodzącego się okręgu — ani fali refrakcji, ani rosnącego błysku)
    const P = toScene(look.px, look.py, _P);
    ctx.lights.flash(look.px, look.py, 0.32, 0.78, 1.0, 2.6 * Math.min(1.8, S), halfWorld * 2.0, 0.55, 2, 0.2, 40);
    // łuki od generatora po poszyciu
    const n = Math.round(CLOAK_FX.engageArcs * Math.min(1.6, 0.6 + 0.4 * S));
    for (let i = 0; i < n; i++) {
      const h = randomHullPoint(look, entity, probe, 0.12, 0.55, _H);
      if (!h) continue;
      const dx = h.x - look.px;
      const dy = h.y - look.py;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 4) continue;
      _D.x = dx / len; _D.y = -dy / len;
      E(fx.arc, 0, 1, P, _D).speed(len, len).life(0.08, 0.22).colors(C_ARC).x01(7 * S, 1.4).z(17).emit();
      this.stats.arcs++;
    }
  },

  _break(ctx, entity, look, probe, S, halfWorld, isPlayer) {
    const fx = ctx.fx;
    this.stats.events++;
    const P = toScene(look.px, look.py, _P);
    _D.x = look.cos; _D.y = -look.sin;
    E(fx.dist, K.SHOCK, 1, P, _D).life(0.5, 0.5).s0(0.2 * halfWorld, 0.2 * halfWorld).s1(2.6 * halfWorld, 2.6 * halfWorld).alpha(0.5, 0.5).fade(0.01, 1.1).emit();
    ctx.lights.flash(look.px, look.py, 0.75, 0.85, 1.0, 5 * Math.min(1.8, S), halfWorld * 2.4, 0.35, 2, 0.6, 40);
    // łuki po całym kadłubie (między losowymi punktami poszycia)
    for (let i = 0; i < CLOAK_FX.breakArcs; i++) {
      const a = randomHullPoint(look, entity, probe, 0.05, 1.0, _H);
      if (!a) continue;
      const ax = a.x;
      const ay = a.y;
      const b = randomHullPoint(look, entity, probe, 0.05, 1.0, _H);
      if (!b) continue;
      const dx = b.x - ax;
      const dy = b.y - ay;
      let len = Math.sqrt(dx * dx + dy * dy);
      if (len < 4) continue;
      const lim = halfWorld * 0.45;
      const k = len > lim ? lim / len : 1;
      len *= k;
      _D.x = dx / (len / k); _D.y = -dy / (len / k);
      toScene(ax, ay, _P);
      E(fx.arc, 0, 1, _P, _D).speed(len, len).life(0.1, 0.32).colors(fxRandom.next() < 0.5 ? C_ARC_BREAK : C_ARC).x01(9 * S, 1.6).z(17).emit();
      this.stats.arcs++;
    }
    // snop iskier i okruchy z losowych punktów kadłuba
    const sparkBursts = 10;
    const perBurst = Math.max(2, Math.round(CLOAK_FX.breakSparks * Math.min(1.6, S) / sparkBursts));
    for (let i = 0; i < sparkBursts; i++) {
      const h = randomHullPoint(look, entity, probe, 0.05, 1.0, _H);
      if (!h) continue;
      toScene(h.x, h.y, _P);
      const ang = fxRandom.next() * TAU;
      _D.x = Math.cos(ang); _D.y = Math.sin(ang);
      E(fx.spark, K.SPARK, perBurst, _P, _D).cone(1.4, 0.18).speed(60 * S, 260 * S).life(0.25, 0.7).drag(1.0, 2.2).colors(C_SPARK).x01(26 * S, 1.0).x23(1.08, 1.3).emit();
      E(fx.add, K.GLOW, 2, _P, _D).cone(2.2, 0.18).speed(8 * S, 40 * S).life(0.35, 0.7).drag(2, 2).s0(6 * S, 10 * S).s1(18 * S, 30 * S).colors(C_FLECK0, C_FLECK1).mix(4).alpha(0.6, 0.85).fade(0.03, 1.6).grow(0.5).emit();
      this.stats.sparks += perBurst;
    }
    if (isPlayer) ctx.shake(2.2, 0.18);
  },

  // Przejście (włączanie, powrót): iskry i okruchy na przełączanych komórkach w losowych miejscach całego kadłuba
  // (komórki gasną w losowej kolejności), tempo ∝ tempo postępu (najwięcej w połowie przejścia).
  _front(ctx, entity, look, probe, S, dt) {
    const fx = ctx.fx;
    let acc = this._acc.get(entity);
    if (!acc) { acc = { spark: 0, fleck: 0 }; this._acc.set(entity, acc); }
    const grow = Math.min(1.5, (look.rate || 0) * 0.9);   // ~1 przy zwykłym tempie włączania
    acc.spark += CLOAK_FX.frontSparks * Math.min(1.6, S) * grow * dt;
    acc.fleck += CLOAK_FX.frontFlecks * Math.min(1.6, S) * grow * dt;
    let budget = CLOAK_FX.maxPerFrame;
    while (acc.spark >= 1 && budget > 0) {
      acc.spark -= 1;
      budget--;
      const h = randomHullPoint(look, entity, probe, 0.05, 1.0, _H, 4);
      if (!h) continue;
      toScene(h.x, h.y, _P);
      // od środka kadłuba na zewnątrz (w scenie: świat (x, −y))
      const dx = h.x - look.px;
      const dy = h.y - look.py;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      _D.x = dx / l; _D.y = -dy / l;
      E(fx.spark, K.SPARK, 1, _P, _D).cone(1.1, 0.18).speed(25 * S, 110 * S).life(0.18, 0.5).drag(1.5, 3).colors(C_SPARK).x01(14 * S, 1.0).x23(1.08, 1.15).emit();
      this.stats.sparks++;
    }
    while (acc.fleck >= 1 && budget > 0) {
      acc.fleck -= 1;
      budget--;
      const h = randomHullPoint(look, entity, probe, 0.05, 1.0, _H, 4);
      if (!h) continue;
      toScene(h.x, h.y, _P);
      E(fx.add, K.GLOW, 1, _P, _D).cone(3.1, 0.18).speed(4 * S, 16 * S).life(0.28, 0.55).drag(2.5, 2.5).s0(5 * S, 8 * S).s1(14 * S, 24 * S).colors(C_FLECK0, C_FLECK1).mix(5).alpha(0.55, 0.8).fade(0.04, 1.7).grow(0.5).emit();
    }
    if (acc.spark > 4) acc.spark = 4;
    if (acc.fleck > 4) acc.fleck = 4;
  },

  // Końcówka energii: krótkie łuki trzaskające po poszyciu.
  _crackle(ctx, entity, look, probe, S, dt) {
    let acc = this._acc.get(entity);
    if (!acc) { acc = { spark: 0, fleck: 0, crackle: 0 }; this._acc.set(entity, acc); }
    acc.crackle = (acc.crackle || 0) + CLOAK_FX.crackleRate * look.flicker * dt;
    if (acc.crackle < 1) return;
    acc.crackle = Math.min(2, acc.crackle - 1);
    const fx = ctx.fx;
    const h = randomHullPoint(look, entity, probe, 0.1, 1.0, _H);
    if (!h) return;
    toScene(h.x, h.y, _P);
    const a = fxRandom.next() * TAU;
    _D.x = Math.cos(a); _D.y = Math.sin(a);
    const len = rand(18, 55) * S;
    E(fx.arc, 0, 1, _P, _D).speed(len, len).life(0.05, 0.12).colors(C_ARC).x01(4 * S, 1.2).z(17).emit();
    this.stats.arcs++;
  }
};

/** Paczka cząstek (jak `E()` receptur broni): pula, rodzaj, liczba, punkt i kierunek w SCENIE. */
function E(pool, kind, n, P, D) {
  return pool.begin(kind, fxRandom.round(n)).at(P.x, P.y).dir(D.x, D.y);
}
