/**
 * ZŁOMOWANIE JAKO PROCES — praca złomiarza przy wraku (reguła `zlomowanie`), etap 1: fizyczne cięcie na sekcje.
 *
 * Złomiarz stoi (postój liczy świat ruchu), a pracuje WRAK: wiązki obracają go bliskim końcem do dziobu i dosuwają
 * (PODAWANIE), dwa wysięgniki z laserami tną go w poprzek z obu burt naraz (CIĘCIE — rzaz `HullBodies.cutSegment`
 * po liniach planu `scrapPlan.js`, odcięta sekcja to osobne ciało silnika belek), sekcję wciąga paszcza na dziobie
 * i miele (MIELENIE — `HullBodies.cutNearest` przy punkcie paszczy), reszta wraku podjeżdża o długość sekcji.
 * Wszystko liczy się w 2D gry: ruch encji wraku, zabite węzły, odłamy. Obraz (wysięgniki, palniki, iskry, wiązki)
 * bierze z tego stanu tylko pozy — `fillTrafficWorkFrame` w `trafficSalvage.js`.
 *
 * Tempo: proces ma swój czas naturalny (zależny od wielkości wraku — `scrapNaturalSeconds`); `rate` przyspiesza
 * albo zwalnia go tak, żeby skończyć `lead` s przed końcem postoju z rekordu pracy. Zgłoszenie wraku niesie szacunek
 * (`estimateScrapSeconds`) i świat ruchu daje złomiarzowi taki postój, więc zwykle rate ≈ 1.
 *
 * Czysty moduł: bez three, DOM, `window` i losowości; gra podaje haki (`hooks.scrap` w `createTrafficSalvage`):
 *   rig(a) → zestaw osprzętu kadłuba (`src/data/scrapRigs.js`), cells(w, out) → liczba par (ix, iy) żywych komórek,
 *   cellSize(w) → bok komórki [j.], cellWorld(w, gx, gy, out) → punkt siatki w świecie gry,
 *   cutLine(w, x0, y0, x1, y1, halfWidth) → zabite węzły, chew(w, x, y, n) → zdjęte węzły, keepOut(w) → strefy modułów.
 * Z haków wspólnych: alive(w), nodes(w).
 */

import { planScrapCuts, flipScrapPlan, scrapPlanPoint, scrapAxisExtent } from './scrapPlan.js';
import { SCRAP_RIG_DEFAULT, scrapArmSegment } from '../data/scrapRigs.js';

export const SCRAP_TUNE = {
  /** Głowica lasera: prędkość wzdłuż linii [j./s], pół szerokości rzazu [komórki], rzaz co tyle komórek drogi. */
  cutSpeed: 38,
  cutHalfCells: 0.6,
  cutStepCells: 0.5,
  /** Rozłożenie wysięgnika do początku linii [s] i tempo składania [1/s]. */
  deploy: 1.4,
  stowRate: 1.1,
  /** Podawanie wraku: prędkość [j./s], wzmocnienie [1/s], obrót [rad/s], wzmocnienie obrotu [1/s]. */
  feedSpeed: 70,
  feedGain: 1.6,
  turnSpeed: 0.14,
  turnGain: 1.4,
  /** Wrak „na miejscu”: błąd pozycji [j.] i kąta [rad] przez `alignHold` s. */
  alignPos: 9,
  alignAng: 0.025,
  alignHold: 0.4,
  /** Sekcja do paszczy: prędkość [j./s], wzmocnienie [1/s]; mielenie [j.² powierzchni / s], zasięg zębów [komórki]. */
  pullSpeed: 70,
  pullGain: 1.2,
  chewArea: 6000,
  chewReachCells: 1.6,
  /** Po końcu linii: tyle sekund na rozpad ciała w kroku silnika, zanim odłamy idą do sortowania. */
  settle: 0.12,
  /** Linia nie rozdzieliła wraku — tyle powtórek szerszym rzazem (× `retryWiden`). */
  retries: 1,
  retryWiden: 1.7,
  /** Odłam mniejszy niż tyle węzłów nie liczy się jako „nieprzecięty”. */
  crumbNodes: 4,
  /** Ostatni kęs w paszczy [węzły] — powyżej progu najmniejszego odłamu silnika belek (`splitMinNodes` 4). */
  keepNodes: 6,
  /** Granice tempa względem czasu naturalnego i zapas przed końcem postoju [s]. */
  rateMin: 0.75,
  rateMax: 3.5,
  lead: 10,
  /** Szacunek bez statku przy wraku (zgłoszenie): ustawianie wraku [s], długość sekcji [j.], zapas. */
  alignTime: 12,
  sectionLen: 210,
  estimateSlack: 1.15
};

const _cells = [];
const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0 };
const _g = { x: 0, y: 0 };
const _ext = { count: 0, s0: 0, s1: 0 };

function makeArm() {
  return { ext: 0, torch: 0, hx: 0, hy: 0, t: 0, tEnd: 0, cutT: 0, done: true, live: false };
}

export function createScrapState(time = 0) {
  return {
    phase: 'plan', startedAt: time,
    plan: null, cs: 0, line: 0, sNear: 0, sRef: 0, tries: 0, widen: 1,
    stock: null, section: null, queue: [], last: false,
    arms: [makeArm(), makeArm()], seg: 0, segNow: 0,
    grip: 0, g0x: 0, g0y: 0, g1x: 0, g1y: 0,
    maw: 0, mawX: 0, mawY: 0,
    rate: 1, hold: 0, wait: 0, chewDebt: 0,
    posErr: Infinity, angErr: Infinity,
    stats: { lines: 0, cutNodes: 0, chewNodes: 0, sections: 0, retries: 0 }
  };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function px(w) { return Number(w?.pos?.x ?? w?.x) || 0; }
function py(w) { return Number(w?.pos?.y ?? w?.y) || 0; }

function setVel(w, vx, vy, av) {
  w.vx = vx;
  w.vy = vy;
  if (w.vel) { w.vel.x = vx; w.vel.y = vy; }
  w.angVel = av;
}

function wake(w) {
  w.noWreckSleep = true;
  w._wreckSleeping = false;
  w._wreckSleepTimer = 0;
}

function isAlive(H, w) {
  return !!w && !w.dead && (!H.alive || H.alive(w));
}

/** Czas naturalny procesu dla planu [s]: ustawienie + linie + podawanie + mielenie. */
export function scrapNaturalSeconds(plan, cs, tune = SCRAP_TUNE) {
  if (!plan || !(cs > 0)) return 0;
  const T = tune;
  let t = T.alignTime;
  for (const l of plan.lines) t += (l.t1 - l.t0) * cs * 0.5 / T.cutSpeed + T.deploy + T.settle + T.alignHold;
  const secLen = (plan.s1 - plan.s0) * cs / Math.max(1, plan.sections);
  t += plan.sections * (secLen / T.feedSpeed + secLen / T.pullSpeed + T.alignHold);
  t += plan.count * cs * cs / T.chewArea;
  return t;
}

/**
 * Szacunek czasu pracy przy wraku do zgłoszenia (statku jeszcze nie ma): `nodes` żywych węzłów, bok komórki `cellSize`
 * [j.], promień `radius` [j.]. Świat ruchu daje złomiarzowi taki postój przy cięciu wraku gry.
 */
export function estimateScrapSeconds(info, tune = SCRAP_TUNE) {
  const T = tune;
  const nodes = Math.max(0, Number(info?.nodes) || 0);
  const cs = Math.max(1, Number(info?.cellSize) || 0);
  const radius = Math.max(cs, Number(info?.radius) || 0);
  if (!nodes) return 0;
  const area = nodes * cs * cs;
  const len = Math.max(cs, radius * 1.8);
  const width = Math.min(len, area / len);
  const sections = len < T.sectionLen * 1.45 ? 1 : Math.max(2, Math.round(len / T.sectionLen));
  const secLen = len / sections;
  let t = T.alignTime + area / T.chewArea;
  t += (sections - 1) * (width * 0.5 / T.cutSpeed + T.deploy + T.settle + T.alignHold);
  t += sections * (secLen / T.feedSpeed + secLen / T.pullSpeed + T.alignHold);
  return (t + T.lead) * T.estimateSlack;
}

/** Odłamy pracy, których proces jeszcze nie zna (rozpad sekcji w paszczy, odprysk przy cięciu) → kolejka mielenia. */
function adoptPieces(S, entry, H) {
  const take = (w) => {
    if (!isAlive(H, w) || w === S.stock || w === S.section || S.queue.indexOf(w) !== -1) return;
    S.queue.push(w);
  };
  take(entry.wreck);
  for (let i = 0; i < entry.extras.length; i++) take(entry.extras[i]);
}

/** Plan z komórek wraku, bliski koniec = ten bliżej paszczy. */
function buildPlan(S, entry, H, T, rig, a, c, s, time, rec) {
  const stock = entry.wreck;
  const n = isAlive(H, stock) ? H.cells(stock, _cells) : 0;
  const cs = n ? Number(H.cellSize(stock)) || 0 : 0;
  if (!(n > 0) || !(cs > 0)) { S.phase = 'done'; return; }
  const L = Number(a.length) || 0;
  const plan = planScrapCuts(_cells, n, {
    sectionCells: Math.max(3, rig.section * L / cs),
    keepOut: H.keepOut ? H.keepOut(stock) : null
  });
  const mx = a.cx + c * rig.maw[0] * L - s * rig.maw[1] * L;
  const my = a.cy + s * rig.maw[0] * L + c * rig.maw[1] * L;
  scrapPlanPoint(plan, plan.s0, plan.tMid, _g);
  const near = H.cellWorld(stock, _g.x, _g.y, _p);
  const d0 = near ? (near.x - mx) ** 2 + (near.y - my) ** 2 : 0;
  scrapPlanPoint(plan, plan.s1, plan.tMid, _g);
  const far = H.cellWorld(stock, _g.x, _g.y, _q);
  const d1 = far ? (far.x - mx) ** 2 + (far.y - my) ** 2 : Infinity;
  if (d1 < d0) flipScrapPlan(plan);
  S.plan = plan;
  S.cs = cs;
  S.line = 0;
  S.sNear = S.sRef = plan.s0;
  S.stock = stock;
  S.hold = 0;
  S.phase = 'feed';
  wake(stock);
  setRate(S, T, rec, time, scrapNaturalSeconds(plan, cs, T));
}

function setRate(S, T, rec, time, natural) {
  const left = rec ? rec.t0 + rec.dur - T.lead - time : Infinity;
  const r = natural / Math.max(4, left);
  S.rate = r < T.rateMin ? T.rateMin : r > T.rateMax ? T.rateMax : r;
}

/** Czas naturalny tego, co zostało (po każdej linii — tempo nadąża za rzeczywistym przebiegiem). */
function remainingSeconds(S, T) {
  const plan = S.plan, cs = S.cs;
  let t = 0;
  for (let k = S.line; k < plan.lines.length; k++) {
    const l = plan.lines[k];
    t += (l.t1 - l.t0) * cs * 0.5 / T.cutSpeed + T.deploy + T.settle + T.alignHold;
  }
  const secLen = (plan.s1 - plan.s0) * cs / Math.max(1, plan.sections);
  const left = plan.sections - S.line;
  t += left * (secLen / T.feedSpeed + secLen / T.pullSpeed + T.alignHold);
  t += plan.count * cs * cs / T.chewArea * (left / Math.max(1, plan.sections));
  return t;
}

/**
 * Wiązki trzymają resztę wraku: punkt bliskiego końca (sRef, tMid) ciągnie do miejsca przed dziobem, oś wraku — do
 * kursu statku. Gra rusza encję (prędkość i obrót), ciało na belkach idzie za nią. Zapisuje błąd pozycji i kąta.
 */
function holdStock(S, H, T, rig, a, c, s) {
  const w = S.stock;
  const plan = S.plan;
  const L = Number(a.length) || 0;
  scrapPlanPoint(plan, S.sRef, plan.tMid, _g);
  const p0 = H.cellWorld(w, _g.x, _g.y, _p);
  scrapPlanPoint(plan, S.sRef + 4, plan.tMid, _g);
  const p1 = p0 ? H.cellWorld(w, _g.x, _g.y, _q) : null;
  if (!p0 || !p1) { S.posErr = S.angErr = Infinity; return; }
  const fx = (rig.front + rig.gap) * L;
  const tx = a.cx + c * fx;
  const ty = a.cy + s * fx;
  const ex = tx - p0.x, ey = ty - p0.y;
  const angErr = wrapAngle((Number(a.ca) || 0) - Math.atan2(p1.y - p0.y, p1.x - p0.x));
  const wMax = T.turnSpeed * S.rate;
  let om = T.turnGain * angErr;
  if (om > wMax) om = wMax; else if (om < -wMax) om = -wMax;
  let vx = T.feedGain * ex, vy = T.feedGain * ey;
  const v = Math.sqrt(vx * vx + vy * vy);
  const vMax = T.feedSpeed * S.rate;
  if (v > vMax) { vx *= vMax / v; vy *= vMax / v; }
  // Punkt trzymania jedzie też z obrotem wokół środka masy — zdjęty z prędkości środka.
  const rx = p0.x - px(w), ry = p0.y - py(w);
  setVel(w, (Number(a.vx) || 0) + vx + om * ry, (Number(a.vy) || 0) + vy - om * rx, om);
  wake(w);
  S.posErr = Math.sqrt(ex * ex + ey * ey);
  S.angErr = Math.abs(angErr);
  // Zaczepy wiązek: dwa punkty przy bliskim końcu, po jednej trzeciej szerokości od osi.
  const span = (plan.t1 - plan.t0) * 0.3;
  scrapPlanPoint(plan, S.sRef + 1.2, plan.tMid - span, _g);
  const a0 = H.cellWorld(w, _g.x, _g.y, _q);
  if (a0) { S.g0x = c * (a0.x - a.cx) + s * (a0.y - a.cy); S.g0y = -s * (a0.x - a.cx) + c * (a0.y - a.cy); }
  scrapPlanPoint(plan, S.sRef + 1.2, plan.tMid + span, _g);
  const a1 = H.cellWorld(w, _g.x, _g.y, _q);
  if (a1) { S.g1x = c * (a1.x - a.cx) + s * (a1.y - a.cy); S.g1y = -s * (a1.x - a.cx) + c * (a1.y - a.cy); }
  // Lewy emiter trzyma zaczep po lewej burcie (wiązki się nie krzyżują, gdy wrak leży odwrotnie).
  if (S.g0y > S.g1y) {
    const tx0 = S.g0x, ty0 = S.g0y;
    S.g0x = S.g1x; S.g0y = S.g1y;
    S.g1x = tx0; S.g1y = ty0;
  }
}

/** Początek linii: przydział końców do wysięgników (lewy bierze koniec po swojej burcie) i długość członów. */
function startLine(S, H, rig, a, c, s, redo) {
  const plan = S.plan, line = plan.lines[S.line], w = S.stock;
  const L = Number(a.length) || 0;
  const tm = (line.t0 + line.t1) * 0.5;
  scrapPlanPoint(plan, line.s, line.t0, _g);
  const e0 = H.cellWorld(w, _g.x, _g.y, _p);
  const y0 = e0 ? -s * (e0.x - a.cx) + c * (e0.y - a.cy) : -1;
  const lowFirst = y0 <= 0;
  let reach = 0;
  for (let i = 0; i < 2; i++) {
    const arm = S.arms[i];
    const fromLow = (i === 0) === lowFirst;
    arm.t = fromLow ? line.t0 : line.t1;
    // Oba rzazy zachodzą na siebie pół komórki za środkiem linii.
    arm.tEnd = fromLow ? tm + 0.5 : tm - 0.5;
    arm.cutT = arm.t;
    arm.done = false;
    arm.live = true;
    arm.torch = 0;
    if (!redo) arm.ext = Math.min(arm.ext, 0.35);
    const mxl = rig.mounts[i][0] * L, myl = rig.mounts[i][1] * L;
    for (const t of [arm.t, arm.tEnd]) {
      scrapPlanPoint(plan, line.s, t, _g);
      const q = H.cellWorld(w, _g.x, _g.y, _q);
      if (!q) continue;
      const lx = c * (q.x - a.cx) + s * (q.y - a.cy), ly = -s * (q.x - a.cx) + c * (q.y - a.cy);
      const d = Math.sqrt((lx - mxl) ** 2 + (ly - myl) ** 2);
      if (d > reach) reach = d;
    }
  }
  S.seg = scrapArmSegment(rig, L, reach);
}

/** Jeden wysięgnik w cięciu: rozłożenie do początku linii, potem głowica wzdłuż linii z rzazem co `cutStepCells`. */
function stepArm(S, arm, i, H, T, rig, a, c, s, dt) {
  const plan = S.plan, line = plan.lines[S.line], w = S.stock;
  const L = Number(a.length) || 0;
  scrapPlanPoint(plan, line.s, arm.t, _g);
  const head = H.cellWorld(w, _g.x, _g.y, _p);
  if (!head) { arm.done = true; arm.torch = 0; return; }
  const tx = c * (head.x - a.cx) + s * (head.y - a.cy);
  const ty = -s * (head.x - a.cx) + c * (head.y - a.cy);
  if (arm.ext < 1) {
    arm.ext = Math.min(1, arm.ext + dt * S.rate / T.deploy);
    const k = arm.ext * arm.ext * (3 - 2 * arm.ext);
    const sx = rig.stow[i][0] * L, sy = rig.stow[i][1] * L;
    arm.hx = sx + (tx - sx) * k;
    arm.hy = sy + (ty - sy) * k;
    arm.torch = 0;
    return;
  }
  arm.hx = tx;
  arm.hy = ty;
  if (arm.done) { arm.torch = 0; return; }
  arm.torch = 1;
  const dir = arm.tEnd >= arm.t ? 1 : -1;
  let t = arm.t + dir * T.cutSpeed * S.rate * dt / S.cs;
  const end = dir > 0 ? t >= arm.tEnd : t <= arm.tEnd;
  if (end) t = arm.tEnd;
  arm.t = t;
  if (end || Math.abs(t - arm.cutT) >= T.cutStepCells) {
    scrapPlanPoint(plan, line.s, arm.cutT, _g);
    const p0 = H.cellWorld(w, _g.x, _g.y, _p);
    const x0 = p0 ? p0.x : 0, y0 = p0 ? p0.y : 0;
    scrapPlanPoint(plan, line.s, t, _g);
    const p1 = p0 ? H.cellWorld(w, _g.x, _g.y, _q) : null;
    if (p1) S.stats.cutNodes += H.cutLine(w, x0, y0, p1.x, p1.y, T.cutHalfCells * S.cs * S.widen) || 0;
    arm.cutT = t;
  }
  if (end) { arm.done = true; arm.torch = 0; }
}

function stowArms(S, T, rig, a, dt) {
  const L = Number(a.length) || 0;
  for (let i = 0; i < 2; i++) {
    const arm = S.arms[i];
    arm.torch = 0;
    if (!arm.live) { arm.hx = rig.stow[i][0] * L; arm.hy = rig.stow[i][1] * L; arm.ext = 0; continue; }
    const k = Math.min(1, T.stowRate * S.rate * dt);
    arm.hx += (rig.stow[i][0] * L - arm.hx) * k;
    arm.hy += (rig.stow[i][1] * L - arm.hy) * k;
    arm.ext = Math.max(0, arm.ext - k);
  }
}

/** Po linii: odłamy całe przed linią → kolejka paszczy, największy za linią → dalsza praca. false = powtórka linii. */
function sortPieces(S, entry, H, T) {
  const plan = S.plan, lineS = plan.lines[S.line].s;
  const near = [];
  let stock = null, stockN = 0, spanning = false;
  const rest = [];
  const look = (w) => {
    if (!isAlive(H, w) || w === S.section || S.queue.indexOf(w) !== -1) return;
    const n = H.cells(w, _cells);
    if (!(n > 0)) return;
    scrapAxisExtent(plan, _cells, n, _ext);
    if (_ext.s1 <= lineS + 0.75) { near.push({ w, s: _ext.s0 }); return; }
    if (_ext.s0 < lineS - 0.75 && n >= T.crumbNodes) spanning = true;
    if (n > stockN) { if (stock) rest.push(stock); stock = w; stockN = n; } else rest.push(w);
  };
  look(entry.wreck);
  for (let i = 0; i < entry.extras.length; i++) look(entry.extras[i]);
  if (spanning && S.tries < T.retries) {
    S.tries++;
    S.widen = T.retryWiden;
    S.stats.retries++;
    if (stock) S.stock = stock;
    return false;
  }
  near.sort((p, q) => p.s - q.s);
  for (const p of near) { S.queue.push(p.w); wake(p.w); }
  // Drobne odłamy za linią (odpryski przy rzazie) idą do paszczy po sekcji; reszta wraku zostaje do dalszych cięć.
  for (const w of rest) { S.queue.push(w); wake(w); }
  S.stock = stock;
  S.stats.sections += near.length;
  S.stats.lines++;
  S.sNear = lineS;
  S.line++;
  S.tries = 0;
  S.widen = 1;
  return true;
}

/** Sekcja do paszczy: ciągnięta środkiem masy do punktu mielenia, zęby zdejmują najbliższe węzły. */
function stepChew(S, entry, H, T, rig, a, c, s, dt, nodesOf) {
  const L = Number(a.length) || 0;
  const mx = a.cx + c * rig.maw[0] * L - s * rig.maw[1] * L;
  const my = a.cy + s * rig.maw[0] * L + c * rig.maw[1] * L;
  S.mawX = rig.maw[0] * L;
  S.mawY = rig.maw[1] * L;
  S.maw = 0;
  // Sekcja mielona od środka pęka na kawałki — każdy nowy odłam tej pracy idzie do kolejki paszczy.
  if (!S.queue.length) adoptPieces(S, entry, H);
  if (S.section && (!isAlive(H, S.section) || nodesOf(S.section) <= 0)) S.section = null;
  while (!S.section && S.queue.length) {
    const w = S.queue.shift();
    if (isAlive(H, w) && nodesOf(w) > 0) { S.section = w; S.chewDebt = 0; }
  }
  if (!S.section) return false;
  const w = S.section;
  wake(w);
  const ex = mx - px(w), ey = my - py(w);
  const d = Math.sqrt(ex * ex + ey * ey);
  let vx = T.pullGain * ex, vy = T.pullGain * ey;
  const v = Math.sqrt(vx * vx + vy * vy);
  const vMax = T.pullSpeed * S.rate;
  if (v > vMax) { vx *= vMax / v; vy *= vMax / v; }
  setVel(w, (Number(a.vx) || 0) + vx, (Number(a.vy) || 0) + vy, (Number(w.angVel) || 0) * 0.9);
  if (d > (Number(w.radius) || 0) + T.chewReachCells * S.cs) return true;
  S.maw = 1;
  S.chewDebt += T.chewArea * S.rate * dt / (S.cs * S.cs);
  let n = Math.floor(S.chewDebt);
  if (n <= 0) return true;
  const left = nodesOf(w);
  // Ostatni kęs ostatniego kawałka (`keepNodes` węzłów — mniejszy odłam silnik belek sam zamienia w odłamki) zostaje
  // w paszczy do końca postoju: praca trzyma wysięgniki do odlotu, a resztę zdejmuje `salvage-taken`.
  const lastPiece = S.last && !S.queue.length && !isAlive(H, S.stock);
  if (lastPiece) n = Math.min(n, left - T.keepNodes);
  if (n <= 0) { S.maw = 0; S.section = null; S.keep = w; return false; }
  const took = H.chew(w, mx, my, n) || 0;
  S.chewDebt -= n;
  S.stats.chewNodes += took;
  return true;
}

/**
 * Krok pracy złomiarza przy wraku (krok fizyki). `job` — praca z `trafficSalvage` (stan w `job.scrap`), `entry` —
 * wpis rejestru { wreck, extras }, `rec` — rekord pracy z workera (t0, dur), `a` — encja bańki (cx, cy, ca, length,
 * vx, vy), `time` — czas mostu. Zwraca stan (`job.scrap`).
 */
export function stepScrapJob(ts, job, entry, rec, a, time, dt) {
  const H = ts.hooks.scrap;
  const T = ts.scrapTune || SCRAP_TUNE;
  const S = job.scrap || (job.scrap = createScrapState(time));
  const rig = (H.rig && H.rig(a)) || SCRAP_RIG_DEFAULT;
  const c = Math.cos(Number(a.ca) || 0), s = Math.sin(Number(a.ca) || 0);
  const nodesOf = ts.hooks.nodes || (() => 1);
  const gripTo = (v) => { S.grip += (v - S.grip) * Math.min(1, 3 * dt); };
  // Człon wysięgnika wysuwa się płynnie do długości potrzebnej na bieżącą linię.
  const segWant = S.seg > 0 ? S.seg : rig.segMin * (Number(a.length) || 0);
  S.segNow = S.segNow > 0 ? S.segNow + (segWant - S.segNow) * Math.min(1, 2.5 * dt) : segWant;

  if (S.phase === 'plan') buildPlan(S, entry, H, T, rig, a, c, s, time, rec);

  // Reszta wraku przepadła (ostrzał, rozpad): wszystko, co zostało, idzie do paszczy.
  if (S.phase !== 'plan' && S.phase !== 'done' && S.stock && !isAlive(H, S.stock)) {
    S.stock = null;
    S.last = true;
    adoptPieces(S, entry, H);
    S.phase = 'chew';
  }

  if (S.phase === 'feed') {
    stowArms(S, T, rig, a, dt);
    gripTo(1);
    S.maw = 0;
    holdStock(S, H, T, rig, a, c, s);
    if (S.posErr <= T.alignPos && S.angErr <= T.alignAng) S.hold += dt * S.rate; else S.hold = 0;
    if (S.hold >= T.alignHold) {
      S.hold = 0;
      if (S.line < S.plan.lines.length) {
        setRate(S, T, rec, time, remainingSeconds(S, T));
        startLine(S, H, rig, a, c, s, false);
        S.phase = 'cut';
      } else {
        // Ostatnia sekcja: reszta wraku idzie do paszczy w całości.
        S.queue.push(S.stock);
        S.stock = null;
        S.last = true;
        S.phase = 'chew';
      }
    }
  } else if (S.phase === 'cut') {
    gripTo(1);
    holdStock(S, H, T, rig, a, c, s);
    let done = true;
    for (let i = 0; i < 2; i++) {
      stepArm(S, S.arms[i], i, H, T, rig, a, c, s, dt);
      if (!S.arms[i].done) done = false;
    }
    if (done) { S.wait = T.settle; S.phase = 'settle'; }
  } else if (S.phase === 'settle') {
    gripTo(1);
    if (isAlive(H, S.stock)) holdStock(S, H, T, rig, a, c, s);
    S.wait -= dt;
    if (S.wait <= 0) {
      if (sortPieces(S, entry, H, T)) {
        S.phase = S.queue.length ? 'chew' : 'feed';
        if (S.phase === 'feed') S.sRef = S.sNear;
        if (!S.stock) S.last = true;
      } else {
        startLine(S, H, rig, a, c, s, true);
        S.phase = 'cut';
      }
    }
  } else if (S.phase === 'chew') {
    stowArms(S, T, rig, a, dt);
    gripTo(isAlive(H, S.stock) ? 1 : 0);
    // Reszta wraku czeka w miejscu cięcia, aż sekcja zejdzie z drogi.
    if (isAlive(H, S.stock)) holdStock(S, H, T, rig, a, c, s);
    if (!stepChew(S, entry, H, T, rig, a, c, s, dt, nodesOf)) {
      if (isAlive(H, S.stock)) { S.sRef = S.sNear; S.hold = 0; S.phase = 'feed'; }
      else S.phase = 'done';
    }
  } else if (S.phase === 'done') {
    stowArms(S, T, rig, a, dt);
    gripTo(0);
    S.maw = 0;
    // Ostatni okruch trzymany w paszczy.
    if (S.keep && isAlive(H, S.keep)) setVel(S.keep, Number(a.vx) || 0, Number(a.vy) || 0, 0);
  }
  return S;
}

/** Koniec pracy (holownik odleciał, zestrzelony, wrak zabrany): kawałki wraku wracają do zwykłego usypiania. */
export function releaseScrapJob(job) {
  const S = job?.scrap;
  if (!S) return;
  const free = (w) => { if (w) w.noWreckSleep = false; };
  free(S.stock);
  free(S.section);
  free(S.keep);
  for (const w of S.queue) free(w);
  job.scrap = null;
}
