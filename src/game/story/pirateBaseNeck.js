/**
 * Szyja habitatu bazy piratów (misja 1). Prośby użytkownika: 2026-10-14 „rozwalam szyję — góra spada na dolną
 * platformę; wjeżdżam od prawej do lewej → góra leci w prawo w dół”; 2026-10-15 „ma się przechylić powoli /
 * średnio wolno jak wieża i uderzyć BOKIEM, a bok wieży ma się rozwalić, płaszczyć jak w Teardown” — silnik
 * prawdziwie 3D (docs/PORT-silnik-belek.md § „Ciała 3D”).
 *
 * Szyb habitatu (kawałek H-C, płaszczyzna gry) trzyma WIEŻĘ (H-T: szyja z głową — BRYŁA 3D, pirateBaseBodies.js)
 * kotwicami osi o skończonej wytrzymałości (kontakt v2 silnika belek). Gdy taran zerwie część kotwic pierścienia szyi
 * (albo przebije rurę szyi, albo szyb pęknie z progu punktów), szyja jest zerwana:
 *  1. kotwice wieży puszczają (worldBodies.detachPiece) — wieża jest swobodną bryłą 3D z grawitacją habitatu (−z,
 *     ku dyskowi), a resztka szyi to PRZEGUB w nasadzie (silnik: addJoint) przesunięty ku stronie upadku;
 *  2. podcięta wieża przechyla się W STRONĘ, Z KTÓREJ PRZYSZEDŁ TARAN (dół jedzie z taranem, wierzch zostaje):
 *     przechył startowy tipSpeed (+ z prędkości taranu), dalej grawitacja — powoli na początku, szybko na końcu;
 *  3. szyja uderza bokiem w koronę bębna, krawędź talerza w dysk mieszkalny (D-1…8 — bryły 3D); zgniot boku liczy
 *     solver (kontakt 3D), odłamy spadają z grawitacją; przegub pęka dopiero przy hingeBreakTilt (wieża kładzie się
 *     na koronie i w dysku, zamiast się z nich staczać);
 *  4. w spoczynku wieża ZAMARZA (silnik: freezeBody — koniec kosztu kroku, taran dalej ją łamie).
 * Punkty habitatu i misja reagują przez haki (onSnap — zerwanie szyi, onImpact — pierwsze uderzenie, onLand — koniec).
 * Bez three i DOM (testy w node).
 */

export const NECK_TUNE = {
  snapPinFrac: 0.95,       // szyja zerwana, gdy na pierścieniu szyi zostało ≤ tyle kotwic (przebita ściana rury)
  ramWindow: 2.5,          // [s] taran kawałka habitatu tak dawno przed zerwaniem wyznacza kierunek
  hpFrac: 0.3,             // udział maks. punktów habitatu zdjęty przy zerwaniu szyi
  fallbackSpeed: 1500,     // [j/s] prędkość umowna, gdy szyb pękł bez taranu (próg punktów)
  // przewracanie wieży (bryła 3D)
  hingeOffset: 0.35,       // przegub w nasadzie: środek + tyle × r szyi ku stronie upadku (krawędź, na której wieża się kładzie)
  // Resztka szyi trzyma wieżę na zawiasie także po uderzeniu boku: wieża kładzie się szyją na koronie bębna, talerzem
  // w dysku i tam zostaje (wrak widoczny po taranie). Przegub pęka dopiero przy przechyle hingeBreakTilt albo po
  // hingeBreakAfterImpact s od uderzenia (Infinity — nigdy). Pomiar (destrukcja-taran-sym.mjs --tryb szyja): pęknięcie
  // 57° — swobodny spadek, wieża mijała bęben i przebijała dysk na wylot; pęknięcie 1,2 s po uderzeniu — wieża (środek
  // masy ~1240 od osi, za koroną bębna r 1000) przetaczała się przez koronę i zsuwała za krawędź dysku.
  hingeBreakTilt: 2.4,     // [rad] (~137°)
  hingeBreakAfterImpact: Infinity,   // [s]
  impactAxisR: 2.2,        // uderzenie boku: styk z budowlą dalej od osi habitatu niż tyle × r szyi
  hingeBreakForce: Infinity,
  tipSpeed: 0.045,         // [rad/s] przechył startowy wokół przegubu
  tipPerSpeed: 0.00002,    // [rad/s na j/s] szczytowej prędkości taranu
  tipMax: 0.11,            // [rad/s]
  // Spoczynek po uderzeniu: najwcześniej landMinAfterImpact s po pierwszym uderzeniu, środek masy przesunął się mniej
  // niż landRestDist i przechył mniej niż landRestTilt przez landRestTime → wieża ZAMARZA (silnik freezeBody: ciało
  // zakotwiczone na rzadkiej siatce kotwic co freezePinCells komórek, kształt po zgniocie nowym spoczynkiem — bez
  // pełzania po koronie bębna i bez kosztu kroku; taran może ją dalej łamać). Prędkość chwilowa szumi (przegub i styki
  // co krok), więc spoczynek z drogi, nie z prędkości. Pomiar 2026-10-15 (60 Hz): po uderzeniu kratownica wieży
  // „dzwoni” i osiada ~3–5 s, solver liczy wtedy całą wieżę (~110 tys. belek na krok); zamrożenie ucina ten ogon.
  landRestDist: 40,        // [j.] w oknie landRestTime (~80 j/s — wieża 1,3 km stojąca przy tej prędkości nie razi)
  landRestTilt: 0.035,     // [rad]
  landRestTime: 0.5,       // [s]
  landMinAfterImpact: 1.5, // [s]
  freezePinCells: 3,
  landTimeout: 20          // [s] po zerwaniu — koniec scenariusza (bez zamrożenia) niezależnie od ruchu
};

/** Stan scenariusza (jeden na habitat). */
export function createNeckState() {
  return {
    phase: 'attached',        // 'attached' | 'toppling' | 'falling' | 'landed'
    pinsInit: -1,
    ramT: -1e9, ramVx: 0, ramVy: 0, ramX: 0, ramY: 0, ramMass: 0, ramPeak: 0, ramPeakT: -1e9,
    snapAt: -1, t: 0,
    dirX: 0, dirY: 0, speed: 0,
    fallX: 0, fallY: 0,       // kierunek upadku wieży (gra) — przeciwny do taranu
    tower: null,              // encja wraku 3D wieży (lista wraków gry)
    joint: null,              // przegub w nasadzie (silnik)
    hinge: null,              // { x, y, z } przegubu (świat silnika)
    hingeBrokeT: -1,          // [s od zerwania] pęknięcie przegubu
    impactT: -1,              // [s od zerwania] pierwsze uderzenie wieży
    impactX: 0, impactY: 0, impactZ: 0,
    tiltMax: 0,               // [rad] największy przechył (diagnostyka)
    restT: 0,
    rest: null,               // okno spoczynku { x, y, z, tilt, t } (świat silnika)
    landT: -1,                // [s od zerwania] koniec scenariusza
    frozen: 0,                // kotwice wieży zamrożonej w spoczynku (0 — nie zamarzła)
    landX: 0, landY: 0,
    cx: NaN, cy: NaN, neckR: 0,  // środek habitatu (gra) i promień rury szyi — z kroku
    ramInNeck: false          // styk taranu z szybem W rurze szyi (przebita na wylot)
  };
}

/**
 * Taran kawałka habitatu (styk okrętu spoza piratów — klej gry, CollisionFX): zapamiętuje prędkość i miejsce
 * taranującego. `piece` — kawałek worldBodies, `rammer` — encja okrętu (vx, vy w grze), x, y — punkt styku.
 */
export function noteNeckRam(st, piece, rammer, simTime, x, y) {
  if (!st || st.phase !== 'attached' || !piece || piece.structure !== 'habitat' || !rammer) return;
  const vx = Number(rammer.vx) || 0, vy = Number(rammer.vy) || 0;
  if (vx * vx + vy * vy < 1) return;
  st.ramT = simTime; st.ramVx = vx; st.ramVy = vy;
  // szczyt prędkości taranu w oknie (zerwanie przychodzi, gdy taranujący już hamuje w szybie)
  const v = Math.sqrt(vx * vx + vy * vy);
  if (v >= st.ramPeak || simTime - st.ramPeakT > NECK_TUNE.ramWindow) { st.ramPeak = v; st.ramPeakT = simTime; }
  st.ramX = Number.isFinite(x) ? x : Number(rammer.x) || 0;
  st.ramY = Number.isFinite(y) ? y : Number(rammer.y) || 0;
  st.ramMass = Number(rammer.beamHull?.body?.mass) || Number(rammer.mass) || 0;
  // styk z szybem w obrębie rury szyi: taran przeszedł przez ścianę rury (wąski nos zrywa tylko kilka kotwic pierścienia)
  if (piece.id === 'H-C' && st.neckR > 0 && Number.isFinite(st.cx)) {
    const dx = st.ramX - st.cx, dy = st.ramY - st.cy;
    if (dx * dx + dy * dy < st.neckR * st.neckR) st.ramInNeck = true;
  }
}

/** Kotwice (węzły z invMass 0) żywych ciał kawałka — encja i wyspy. */
export function piecePinCount(piece) {
  if (!piece || piece.state !== 'live') return 0;
  let n = 0;
  const count = (e) => {
    const hull = e?.beamHull;
    const b = hull?.entity === e ? hull.body : null;
    if (!b || b.dead) return;
    const s = b.nodeStore;
    for (let i = 0; i < s.count; i++) if (s.active[i] && s.invMass[i] === 0) n++;
  };
  count(piece.entity);
  for (const e of piece.islands) count(e);
  return n;
}

const pieceOf = (site, id) => site?.pieces?.find((p) => p.id === id) || null;

// Najniższa wysokość żywych węzłów ciała 3D (świat silnika) — nasada wieży.
function bodyBottomZ(body) {
  const s = body.nodeStore, q = body.quat;
  // wiersz z macierzy obrotu kwaternionu
  const m6 = 2 * (q.x * q.z - q.w * q.y), m7 = 2 * (q.y * q.z + q.w * q.x), m8 = 1 - 2 * (q.x * q.x + q.y * q.y);
  let lo = Infinity;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const z = m6 * s.x[i] + m7 * s.y[i] + m8 * s.z[i];
    if (z < lo) lo = z;
  }
  return body.pos.z + (Number.isFinite(lo) ? lo : 0);
}

/**
 * Zerwanie szyi: kotwice wieży puszczają, przegub w nasadzie, przechył startowy ku stronie upadku. Wołane przez
 * stepNeck albo wprost (dev, próg punktów). dirX, dirY — kierunek taranu w grze (wieża pada przeciwnie), speed —
 * prędkość taranującego. ctx: { worldBodies, engine (silnik belek — addJoint), layout, habitat: { x, y } (środek
 * w grze), simTime, onSnap(st) }. Zwraca true = zerwana.
 */
export function snapNeck(st, site, ctx, dirX, dirY, speed) {
  if (!st || st.phase !== 'attached' || !site) return false;
  const T = NECK_TUNE;
  const wb = ctx.worldBodies;
  const H = ctx.layout?.habitat;
  const head = pieceOf(site, 'H-T');
  if (!wb || !H || !head || head.lost) return false;
  let dl = Math.sqrt(dirX * dirX + dirY * dirY);
  if (!(dl > 1e-9)) { dirX = 1; dirY = 0; dl = 1; }
  const ux = dirX / dl, uy = dirY / dl;
  const v = Math.max(0, Number(speed) || 0);
  st.dirX = ux; st.dirY = uy; st.speed = v;
  // podcięta u dołu wieża przewraca się ku stronie, z której przyszedł taran
  st.fallX = -ux; st.fallY = -uy;
  const wrecks = wb.detachPiece(head, {});
  if (!wrecks.length) return false;
  let tower = wrecks[0];
  for (const w of wrecks) if ((w.beamHull?.body?.activeNodes || 0) > (tower.beamHull?.body?.activeNodes || 0)) tower = w;
  const body = tower.beamHull?.body;
  if (!body) return false;
  st.tower = tower;
  tower.__neckTower = true;
  // przegub: środek nasady (oś habitatu) przesunięty ku stronie upadku, na wysokości spodu wieży; świat silnika y = −y gry
  const hc = ctx.habitat || { x: 0, y: 0 };
  const neckR = H.neckR ?? 150;
  const fx = st.fallX, fy = -st.fallY;     // kierunek upadku w świecie silnika
  const hx = hc.x + st.fallX * neckR * T.hingeOffset, hy = -(hc.y + st.fallY * neckR * T.hingeOffset);
  const hz = bodyBottomZ(body);
  st.hinge = { x: hx, y: hy, z: hz };
  const engine = ctx.engine;
  st.joint = engine?.addJoint ? engine.addJoint(body, hx, hy, hz, { breakTilt: T.hingeBreakTilt, breakForce: T.hingeBreakForce, name: 'szyja' }) : null;
  // przechył startowy: obrót wokół przegubu tak, żeby wierzch szedł ku stronie upadku — ω = ω0 · (ẑ × f),
  // prędkość środka masy = ω × (środek − przegub) (przegub stoi)
  const w0 = Math.min(T.tipMax, T.tipSpeed + v * T.tipPerSpeed);
  const wx = -fy * w0, wy = fx * w0, wz = 0;
  const rx = body.pos.x - hx, ry = body.pos.y - hy, rz = body.pos.z - hz;
  body.angVel.x = wx; body.angVel.y = wy; body.angVel.z = wz;
  body.vel.x = wy * rz - wz * ry;
  body.vel.y = wz * rx - wx * rz;
  body.vel.z = wx * ry - wy * rx;
  if (engine?.wake) engine.wake(body, 60);
  st.phase = 'toppling';
  st.snapAt = ctx.simTime || 0;
  st.t = 0;
  st.hingeBrokeT = -1;
  st.impactT = -1;
  st.tiltMax = 0;
  st.restT = 0;
  st.rest = null;
  st.landT = -1;
  st.frozen = 0;
  if (typeof ctx.onSnap === 'function') ctx.onSnap(st);
  return true;
}

/**
 * Krok scenariusza (fizyka, po HullBodies.step — kotwice szybu po zgniocie tego kroku). ctx jak snapNeck oraz
 * onImpact(st), onLand(st). dt — czas gry (pauza = 0).
 */
export function stepNeck(st, site, ctx, dt) {
  if (!st || !site) return;
  const T = NECK_TUNE;
  if (st.phase === 'attached') {
    const core = pieceOf(site, 'H-C');
    if (!core) return;
    if (ctx.habitat) { st.cx = ctx.habitat.x; st.cy = ctx.habitat.y; }
    st.neckR = ctx.layout?.habitat?.neckR ?? 150;
    let broken = !!core.__broken || core.lost || st.ramInNeck;
    if (!broken && core.state === 'live') {
      const pins = piecePinCount(core);
      if (st.pinsInit < 0) st.pinsInit = pins;
      else if (st.pinsInit > 0 && pins <= st.pinsInit * T.snapPinFrac) broken = true;
    }
    if (!broken) return;
    const now = ctx.simTime || 0;
    const fresh = now - st.ramT <= T.ramWindow;
    if (fresh) snapNeck(st, site, ctx, st.ramVx, st.ramVy, Math.max(st.ramPeak, Math.sqrt(st.ramVx * st.ramVx + st.ramVy * st.ramVy)));
    else {
      // szyb pękł bez taranu (próg punktów): wieża pada od punktu ostatniego trafienia przez oś habitatu
      const hc = ctx.habitat || { x: 0, y: 0 };
      const hx = Number.isFinite(ctx.lastHitX) ? ctx.lastHitX : hc.x + 1, hy = Number.isFinite(ctx.lastHitY) ? ctx.lastHitY : hc.y;
      snapNeck(st, site, ctx, hc.x - hx, hc.y - hy, T.fallbackSpeed);
    }
    return;
  }
  if (st.phase === 'landed' || !(dt > 0)) return;
  st.t += dt;
  const tower = st.tower;
  const body = tower?.beamHull?.entity === tower ? tower.beamHull.body : null;
  if (body && !body.dead) {
    const q = body.quat;
    const tilt = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.y * q.y))));
    if (tilt > st.tiltMax) st.tiltMax = tilt;
  }
  if (st.phase === 'toppling' && (!st.joint || st.joint.broken || !body || body.dead)) {
    st.phase = 'falling';
    st.hingeBrokeT = st.t;
  }
  // pierwsze uderzenie wieży (styk zgłoszony przez HullBodies.onContact — tower.__contactT, czas symulacji) — z budowlą
  // (bęben, dysk); styk nasady z kikutem szybu (H-C) albo z taranującym okrętem, który utknął w szybie, to nie uderzenie boku
  // i z odłamkami bębna po taranie leżącymi przy osi — uderzenie boku to styk z budowlą dalej od osi habitatu niż
  // impactAxisR × r szyi (bok szyi o koronę bębna, krawędź talerza o dysk)
  const hit = tower?.__contactWith;
  const hitPiece = hit?.worldPiece || hit?.beamHull?.world || null;
  const hcx = ctx.habitat?.x ?? 0, hcy = ctx.habitat?.y ?? 0;
  const axisR = Math.hypot((Number(tower?.__contactX) || hcx) - hcx, (Number(tower?.__contactY) || hcy) - hcy);
  if (st.impactT < 0 && tower && Number(tower.__contactT) > st.snapAt + 0.05 && hitPiece && hitPiece.id !== 'H-C' &&
      hitPiece.id !== 'H-T' && axisR > T.impactAxisR * (ctx.layout?.habitat?.neckR ?? 150)) {
    st.impactT = st.t;
    st.impactX = tower.__contactX; st.impactY = tower.__contactY; st.impactZ = tower.__contactZ;
    if (typeof ctx.onImpact === 'function') ctx.onImpact(st);
  }
  // przegub pęka chwilę po uderzeniu boku (resztka szyi nie utrzyma odbicia)
  if (st.phase === 'toppling' && st.impactT >= 0 && st.t - st.impactT >= T.hingeBreakAfterImpact && st.joint && !st.joint.broken && body) {
    ctx.engine?.removeJoint?.(body, st.joint);
    st.joint.broken = true;
  }
  // spoczynek z drogi środka masy i przechyłu w oknie landRestTime (po uderzeniu)
  let rested = false;
  if (body && !body.dead && st.impactT >= 0) {
    const q = body.quat;
    const tilt = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.y * q.y))));
    const r = st.rest ||= { x: NaN, y: 0, z: 0, tilt: 0, t: 0 };
    const moved = Math.hypot(body.pos.x - r.x, body.pos.y - r.y, body.pos.z - r.z);
    if (!(moved <= T.landRestDist) || Math.abs(tilt - r.tilt) > T.landRestTilt) {
      r.x = body.pos.x; r.y = body.pos.y; r.z = body.pos.z; r.tilt = tilt; r.t = st.t;
    } else if (st.t - r.t >= T.landRestTime && st.t - st.impactT >= T.landMinAfterImpact) rested = true;
  }
  if (rested || st.t >= T.landTimeout || !body || body.dead) {
    st.phase = 'landed';
    st.landT = st.t;
    st.landX = body && !body.dead ? body.pos.x : st.impactX;
    st.landY = body && !body.dead ? -body.pos.y : st.impactY;
    if (rested) freezeTower(st, body, ctx);
    if (typeof ctx.onLand === 'function') ctx.onLand(st);
  }
}

// Wieża w spoczynku zamarza (silnik: freezeBody — ciało zakotwiczone na rzadkiej siatce kotwic, kształt po zgniocie
// nowym spoczynkiem, obszar solvera pusty, przegub zdjęty): leży tam, gdzie się położyła, i nic nie kosztuje.
function freezeTower(st, body, ctx) {
  const engine = ctx.engine;
  if (!engine?.freezeBody) return;
  st.frozen = engine.freezeBody(body, NECK_TUNE.freezePinCells);
  st.joint = null;
}
