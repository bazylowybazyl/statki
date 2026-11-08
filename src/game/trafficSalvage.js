/**
 * GÓRNICY I ZŁOMIARZE NPC W BAŃCE — STRONA GRY (E24).
 *
 * Świat ruchu (worker) liczy, KTO i KIEDY pracuje: wyprawa górnicza stoi w etapie wydobycia, złomiarz (kurs TUG)
 * tnie albo zaczepia wrak, potem wraca z nim na linie. Bańka przysyła to rekordami pracy encji
 * (`TrafficV2.actorWorks`, `WorkRecord` w `trafficProtocol.js`). Ten moduł robi z tego rozgrywkę i ramkę obrazu:
 *   - WRAKI GRY → rejestr złomiarzy: nowy wrak w bańce gracza (hak `HullBodies.onWreckSpawned` w index.html) po
 *     `reportDelay` idzie do workera (`reportWrecks`) z klasą okrętu, ułamkiem kadłuba i źródłem (okręt garnizonu
 *     → wrak jego straty); wrak, który zniknął albo zabrał go gracz, — `wrecksGone`;
 *   - CIĘCIE: złomiarz przy wraku (faza encji `station`) zdejmuje węzły od krawędzi (`hooks.cut` = `cutOuterNode`)
 *     tak, żeby skończyć przed końcem postoju; po `salvage-taken` reszta wraku znika (`hooks.remove`);
 *   - HOL: lina `TowSystem` od rufy holownika (kotwica kinematyczna — `towStatic`) do wraku, skracana do długości
 *     holu; w przelocie powrotnym wrak jedzie za holownikiem i znika, gdy holownik wyjdzie z bańki albo dotrze;
 *   - RAMKA OBRAZU (`fillTrafficWorkFrame` → blok `trafficWork`): górnik przy polu (drony i lasery platformy
 *     w `MiningView`), złomiarz tnie (palniki, iskry, odłamki), holuje (wiązka przy linie).
 * Kontenery-łup zniszczonego statku ruchu to osobne paczki (`lootContainers.js`) — złomiarz ich nie bierze.
 *
 * Czysty moduł: bez three, DOM i `window`; gra podaje most, bańkę i haki.
 */

export const TRAFFIC_SALVAGE_TUNE = {
  /** Wrak idzie do rejestru po tylu sekundach gry: uspokaja się, a strata garnizonu (`destroyed`) idzie pierwsza. */
  reportDelay: 2,
  /** Wrak dalej od gracza w chwili zgłoszenia — bez zgłoszenia (bańka gry). */
  reportRadius: 60000,
  /**
   * Odłamy mniejsze niż tyle [j. promienia] — bez zgłoszenia: rozpad dużego statku daje kilkanaście drobnych odłamów,
   * których cięcie się nie opłaca (zalegałyby w rejestrze do `gameWreckTtl`).
   */
  minRadius: 120,
  /** Złomiarz pracuje, gdy wrak jest bliżej punktu postoju (encji) niż tyle [j.]. */
  workRange: 6000,
  /** Lina holu: promień wraku + pół długości holownika + tyle [j.]; skraca się z tą prędkością [j./s]. */
  ropeSlack: 220,
  reelSpeed: 180,
  ropeStiffness: 0.24,
  ropeDamping: 0.9,
  /**
   * Cięcie: najwyżej tyle węzłów na krok fizyki; kończy się tyle sekund przed końcem postoju i zostawia ostatni węzeł
   * (wrak bez węzłów gra zdejmuje sama — to nie jest „zabrany przez gracza”); resztę zdejmuje `salvage-taken`.
   */
  cutMaxPerStep: 6,
  cutLead: 10,
  /** Odlot z wrakiem: sprężyna do punktu na długości liny [1/s] i sufit korekty prędkości [j./s]. */
  towSpring: 2.5,
  towMaxCorrection: 2500,
  /** Wrak, który zniknął dalej od gracza niż tyle [j.], zdjęła gra (despawn wraków > 50 tys.) — bez `wreck-gone`. */
  farDespawn: 45000
};

export const TRAFFIC_WORK_KIND = Object.freeze({ MINE: 1, CUT: 2, TOW: 3 });

/**
 * Klasa wraku dla złomiarzy z opisu statku: okręt wojenny (rodzaj z `getUnitKind` gry) — klasa
 * `WARSHIP_CLASSES`, hol możliwy, o ile to cały kadłub; cywil i reszta — klasa z promienia, sam złom.
 * `info`: { kind ('frigate' | 'destroyer' | 'battleship' | 'other'), type, radius, mass, mass0, piece }.
 */
export function classifyGameWreck(info) {
  const kind = String(info?.kind || 'other');
  const type = String(info?.type || '').toLowerCase();
  const radius = Math.max(0, Number(info?.radius) || 0);
  let classId;
  let warship = true;
  if (kind === 'frigate') classId = 'frigate';
  else if (kind === 'destroyer') classId = 'destroyer';
  else if (kind === 'battleship') classId = /carrier|supercapital/.test(type) ? 'carrier' : 'cruiser';
  else {
    warship = false;
    classId = radius < 260 ? 'frigate' : radius < 520 ? 'destroyer' : radius < 900 ? 'cruiser' : 'carrier';
  }
  const mass = Number(info?.mass) || 0;
  const mass0 = Number(info?.mass0) || 0;
  const scale = mass0 > 0 && mass > 0 ? Math.min(1, Math.max(0.05, mass / mass0)) : 1;
  // Odłam albo kadłub bez większości masy — podzespoły przepadły; cywil nie ma podzespołów okrętu.
  const towable = warship && !info?.piece && scale >= 0.6;
  return { classId, scale, towable };
}

export function createTrafficSalvage(bridge, hooks = {}, options = {}) {
  return {
    bridge,
    hooks,
    tune: { ...TRAFFIC_SALVAGE_TUNE, ...(options.tune || {}) },
    nextGid: 1,
    /** Wraki czekające na zgłoszenie: { wreck, at, spec }. */
    pending: [],
    /** gid → { wreck, gid, extras: [] } — wraki w rejestrze świata ruchu. */
    reported: new Map(),
    /** wrak → gid (także odłamy ciętego wraku). */
    gidOf: new WeakMap(),
    /** numer kursu złomiarza → praca w grze { gid, kind, rope, anchor, cut0, cutT0, done }. */
    jobs: new Map(),
    /** gid → tryb: worker zgłosił koniec pracy (`salvage-taken`). */
    taken: new Map(),
    /** Ramka obrazu (rekordy `trafficWork`). */
    frame: { list: [], count: 0 },
    /** Narzędzia (A/B kosztu obrazu): true = pusta ramka obrazu pracy, rozgrywka bez zmian. */
    hideRender: false,
    /** Dziennik zdarzeń (narzędzia) i czas mostu ostatniego kroku. */
    log: [],
    clock: 0,
    stats: { reported: 0, gone: 0, cutNodes: 0, removed: 0, ropes: 0, towed: 0 }
  };
}

/**
 * Nowy wrak gry (hak `onWreckSpawned`): `spec` z `classifyGameWreck` + { factionId, source }; null — bez zgłoszenia.
 * Odłam z rozpadu ciała zgłoszonego wraku (`parentBody` — encja `parent` bywa jeszcze martwym statkiem) należy do
 * tej samej pracy: bez zgłoszenia, znika razem z wrakiem.
 */
export function noteTrafficWreck(ts, wreck, spec, time, parent = null, parentBody = null) {
  if (!ts || !wreck) return;
  // Odłam wraku, który tnie złomiarz NPC: należy do tej samej pracy (zniknie razem z wrakiem).
  let parentGid = parent ? ts.gidOf.get(parent) : undefined;
  if (parentGid === undefined && parentBody) parentGid = ts.gidOf.get(parentBody);
  if (parentGid !== undefined) {
    const rec = ts.reported.get(parentGid);
    if (rec) {
      rec.extras.push(wreck);
      ts.gidOf.set(wreck, parentGid);
      if (wreck.beamHull?.body) ts.gidOf.set(wreck.beamHull.body, parentGid);
      return;
    }
  }
  if (!spec) return;
  ts.pending.push({ wreck, at: Number(time) || 0, spec, from: parent ? (parent.isWreck ? 'wrak' : String(parent.type || 'statek')) : null, body: !!parentBody });
}

function wreckX(w) { return Number(w?.pos?.x ?? w?.x) || 0; }
function wreckY(w) { return Number(w?.pos?.y ?? w?.y) || 0; }

/** Zdarzenie mostu `salvage-taken`: złomiarz skończył cięcie albo zaczepił wrak. */
export function onTrafficSalvageTaken(ts, list) {
  if (!ts || !Array.isArray(list)) return;
  for (const t of list) {
    if (!t || t.gid == null) continue;
    ts.taken.set(t.gid, t.mode === 'cut' ? 'cut' : 'tow');
    note(ts, `koniec-pracy:${t.mode}`, t.gid);
  }
}

function removeReported(ts, gid, reason) {
  const rec = ts.reported.get(gid);
  if (!rec) return;
  ts.reported.delete(gid);
  ts.taken.delete(gid);
  const remove = ts.hooks.remove;
  for (const w of rec.extras) if (w && !w.dead && remove) remove(w);
  if (rec.wreck && !rec.wreck.dead && remove) remove(rec.wreck);
  ts.stats.removed++;
  note(ts, `usuniety:${reason}`, gid);
}

/** Dziennik zdarzeń (narzędzia, `TrafficSalvage.log`): ostatnie 64 — zgłoszenia, liny, końce, zniknięcia z przyczyną. */
function note(ts, what, gid) {
  const log = ts.log;
  if (log.length >= 64) log.shift();
  log.push({ t: Math.round(ts.clock * 10) / 10, what, gid });
}

/** Główny wrak pracy przepadł przy rozpadzie: największy żywy odłam tej pracy przejmuje jego miejsce (lina — od nowa). */
function promoteExtra(ts, rec) {
  let best = null;
  for (const w of rec.extras) {
    if (!w || w.dead || (ts.hooks.alive && !ts.hooks.alive(w))) continue;
    if (!best || (Number(w.radius) || 0) > (Number(best.radius) || 0)) best = w;
  }
  if (!best) return false;
  rec.extras.splice(rec.extras.indexOf(best), 1);
  rec.wreck = best;
  for (const job of ts.jobs.values()) {
    if (job.gid !== rec.gid) continue;
    if (job.rope && ts.hooks.detachRope) ts.hooks.detachRope(job.rope);
    job.rope = null;
    job.wreck = best;
  }
  note(ts, 'odlam-przejal', rec.gid);
  return true;
}

function dropJob(ts, id, job) {
  if (job.rope && ts.hooks.detachRope) ts.hooks.detachRope(job.rope);
  if (job.wreck) job.wreck.noWreckSleep = false;
  ts.jobs.delete(id);
}

/**
 * Zaczep liny na holowniku: punkt obrysu od strony wraku (środek + kierunek do wraku × pół długości) — ciągły przy
 * obrocie holownika: przy zaczepianiu (dziób do wraku) i w odlocie (wrak za rufą).
 */
function hitchOf(a, w, out) {
  const dx = wreckX(w) - a.cx;
  const dy = wreckY(w) - a.cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const half = (Number(a.length) || 0) * 0.5;
  out.x = a.cx + dx / d * half;
  out.y = a.cy + dy / d * half;
  return out;
}

/**
 * Krok fizyki (po `trafficBubbleStep` — pozy encji w czasie kroku): zgłoszenia, wraki, które zniknęły, praca
 * złomiarzy w bańce (cięcie, lina holu), koniec pracy. `time` — czas mostu (czas pozy encji), `px`, `py` — gracz.
 */
export function stepTrafficSalvage(ts, tb, time, dt, px, py) {
  if (!ts) return;
  const H = ts.hooks;
  const T = ts.tune;
  ts.clock = time;
  // 1. Zgłoszenia po uspokojeniu wraku.
  if (ts.pending.length) {
    let out = null;
    for (let i = ts.pending.length - 1; i >= 0; i--) {
      const p = ts.pending[i];
      if (time - p.at < T.reportDelay) continue;
      ts.pending.splice(i, 1);
      const w = p.wreck;
      if (!w || w.dead || (H.alive && !H.alive(w))) continue;
      const x = wreckX(w);
      const y = wreckY(w);
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy > T.reportRadius * T.reportRadius) continue;
      const gid = ts.nextGid++;
      ts.gidOf.set(w, gid);
      if (w.beamHull?.body) ts.gidOf.set(w.beamHull.body, gid);
      ts.reported.set(gid, { wreck: w, gid, extras: [], lastX: x, lastY: y });
      (out || (out = [])).push({ gid, x, y, r: Number(w.radius) || 0, ...p.spec });
      ts.stats.reported++;
      note(ts, `zgloszony:${Math.round(Number(w.radius) || 0)}:${p.from || '-'}${p.body ? ':cialo' : ''}`, gid);
    }
    if (out && ts.bridge?.reportWrecks) ts.bridge.reportWrecks(out);
  }
  // 2. Wraki, których już nie ma albo które zabrał gracz. Wrak na haku złomiarza (po `salvage-taken`) i wrak zdjęty
  //    przez grę z dala od gracza (despawn > `farDespawn`) — bez `wreck-gone`: złomiarz kończy pracę w rekordzie.
  let gone = null;
  let holdOn = null;
  let holdOff = null;
  const far2 = T.farDespawn * T.farDespawn;
  for (const [gid, rec] of ts.reported) {
    let w = rec.wreck;
    let lost = !w || w.dead || (H.alive && !H.alive(w));
    // Cięcie rozdzieliło wrak (rozpad na wyspy): praca przechodzi na największy żywy odłam tej samej pracy.
    if (lost && rec.extras.length && promoteExtra(ts, rec)) {
      w = rec.wreck;
      lost = false;
    }
    if (!lost) {
      // Gracz ma pierwszeństwo: tnie, holuje albo zbiera łup — złomiarze czekają (`wreck-hold`), wrak zostaje w rejestrze.
      const busy = !!(H.playerBusy && H.playerBusy(w));
      if (busy !== !!rec.playerHold) {
        rec.playerHold = busy;
        if (busy) (holdOn || (holdOn = [])).push(gid);
        else (holdOff || (holdOff = [])).push(gid);
        note(ts, busy ? 'gracz-pracuje' : 'gracz-zostawil', gid);
      }
      rec.lastX = wreckX(w);
      rec.lastY = wreckY(w);
      continue;
    }
    ts.reported.delete(gid);
    const hooked = ts.taken.delete(gid);
    const far = (rec.lastX - px) ** 2 + (rec.lastY - py) ** 2 > far2;
    note(ts, hooked ? 'zniknal-na-haku' : far ? 'zniknal-daleko' : rec.playerHold ? 'gracz-zabral' : 'zniknal', gid);
    if (hooked || far) continue;
    (gone || (gone = [])).push(gid);
    ts.stats.gone++;
  }
  if (holdOn && ts.bridge?.wrecksHold) ts.bridge.wrecksHold(holdOn, true);
  if (holdOff && ts.bridge?.wrecksHold) ts.bridge.wrecksHold(holdOff, false);
  if (gone && ts.bridge?.wrecksGone) ts.bridge.wrecksGone(gone);
  // 3. Praca złomiarzy w bańce.
  const works = ts.bridge?.actorWorks;
  if (works) {
    for (const rec of works.values()) {
      if (rec.kind === 'mine' || rec.gid == null) continue;
      const entry = ts.reported.get(rec.gid);
      if (!entry) continue;
      // Gracz pracuje przy wraku: złomiarz nie tnie i nie ciągnie (worker odeśle go pustego).
      if (entry.playerHold) {
        const held = ts.jobs.get(rec.id);
        if (held) {
          if (held.rope) { H.detachRope?.(held.rope); held.rope = null; }
          held.active = false;
        }
        continue;
      }
      const a = tb?.byId?.get(rec.id);
      if (!a || !a.alive) continue;
      let job = ts.jobs.get(rec.id);
      if (!job) {
        job = { gid: rec.gid, kind: rec.kind, wreck: entry.wreck, rope: null, anchor: null, cut0: 0, cutT0: 0, active: false };
        ts.jobs.set(rec.id, job);
      }
      job.kind = rec.kind;
      job.rec = rec;
      const w = entry.wreck;
      const at = rec.phase === 'haul' || a.phase === 'station';
      const dx = wreckX(w) - a.cx;
      const dy = wreckY(w) - a.cy;
      const near = dx * dx + dy * dy <= T.workRange * T.workRange;
      job.active = at && near;
      if (!job.active) continue;
      if (w.isCold && H.thaw && !H.thaw(w)) { job.active = false; continue; }
      if (rec.kind === 'cut') stepCut(ts, job, w, rec, time);
      else stepTow(ts, job, w, a, dt, rec.phase === 'haul');
    }
  }
  // 4. Koniec pracy z workera i holowniki, które zniknęły z bańki.
  for (const [id, job] of ts.jobs) {
    const a = tb?.byId?.get(id);
    const present = !!(a && a.alive);
    const rec = works?.get(id);
    if (!rec) job.active = false;
    if (!ts.reported.has(job.gid)) { dropJob(ts, id, job); continue; }
    // Holownik zestrzelony albo awansowany do NPC: kurs w workerze przepada, wrak wraca do puli — zostaje w grze.
    const lostTug = !present && (tb?.dead?.has(id) || tb?.promoted?.has(id));
    if (lostTug && ts.taken.delete(job.gid)) note(ts, 'holownik-stracony', job.gid);
    const taken = ts.taken.get(job.gid);
    if (job.rope && taken && (!present || !rec)) {
      // Wrak na linie po końcu pracy: znika z holownikiem (wyjście z bańki, koniec kursu) — holownik go zabrał.
      dropJob(ts, id, job);
      removeReported(ts, job.gid, 'towed');
      ts.stats.towed++;
      continue;
    }
    if (!present) { dropJob(ts, id, job); continue; }
    if (job.rope) anchorFollow(job, a);
  }
  // Koniec pracy bez holu w bańce (cięcie; hol poza kadrem) — wrak znika od razu.
  for (const [gid, mode] of ts.taken) {
    // Koniec pracy zgłoszony tuż przed tym, jak gracz zajął wrak — wrak zostaje graczowi.
    if (ts.reported.get(gid)?.playerHold) { ts.taken.delete(gid); continue; }
    let roped = false;
    for (const job of ts.jobs.values()) if (job.gid === gid && job.rope) { roped = true; break; }
    if (roped) continue;
    removeReported(ts, gid, mode);
  }
}

function anchorFollow(job, a) {
  const an = job.anchor;
  if (!an || !job.wreck) return false;
  hitchOf(a, job.wreck, an.pos);
  an.vel.x = a.vx;
  an.vel.y = a.vy;
  an.angle = a.ca;
  return true;
}

function stepCut(ts, job, w, rec, time) {
  const H = ts.hooks;
  if (!H.cut || !H.nodes) return;
  if (!job.cut0) {
    job.cut0 = Math.max(1, H.nodes(w));
    job.cutT0 = time;
  }
  const tEnd = rec.t0 + rec.dur - ts.tune.cutLead;
  const span = Math.max(1, tEnd - job.cutT0);
  const f = Math.min(1, Math.max(0, (time - job.cutT0) / span));
  const left = H.nodes(w);
  const want = Math.max(1, Math.ceil(job.cut0 * (1 - f)));
  let n = Math.min(ts.tune.cutMaxPerStep, left - want);
  while (n-- > 0) {
    if (!H.cut(w)) break;
    ts.stats.cutNodes++;
  }
}

function stepTow(ts, job, w, a, dt, haul) {
  const H = ts.hooks;
  const T = ts.tune;
  if (!job.rope) {
    if (!H.attachRope) return;
    const anchor = job.anchor || (job.anchor = {
      pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, towStatic: true, immovable: true, radius: 10, isTrafficAnchor: true
    });
    anchorFollow(job, a);
    const dx = wreckX(w) - anchor.pos.x;
    const dy = wreckY(w) - anchor.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    job.ropeTarget = (Number(w.radius) || 200) + (Number(a.length) || 0) * 0.25 + T.ropeSlack;
    job.rope = H.attachRope(anchor, w, {
      length: Math.max(job.ropeTarget, dist), stiffness: T.ropeStiffness, damping: T.ropeDamping,
      collideConnected: false, tag: 'traffic-tow'
    });
    if (!job.rope) return;
    w.noWreckSleep = true;
    w._wreckSleeping = false;
    ts.stats.ropes++;
    note(ts, 'lina', job.gid);
    return;
  }
  anchorFollow(job, a);
  if (job.rope.length > job.ropeTarget) job.rope.length = Math.max(job.ropeTarget, job.rope.length - T.reelSpeed * dt);
  // Odlot z wrakiem: holownik w bańce leci do 1200 j./s, a sama lina (tłumienie i limit korekty) zostawiała wrak kilka
  // km z tyłu — wrak jedzie z prędkością holownika i sprężyną do punktu na długości liny za zaczepem (gra rusza encję).
  if (haul) towFollow(job, w, a, T);
}

function towFollow(job, w, a, T) {
  const an = job.anchor.pos;
  const dx = wreckX(w) - an.x;
  const dy = wreckY(w) - an.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const tx = an.x + dx / d * job.ropeTarget;
  const ty = an.y + dy / d * job.ropeTarget;
  let cx = (tx - wreckX(w)) * T.towSpring;
  let cy = (ty - wreckY(w)) * T.towSpring;
  const c = Math.sqrt(cx * cx + cy * cy);
  if (c > T.towMaxCorrection) { cx *= T.towMaxCorrection / c; cy *= T.towMaxCorrection / c; }
  w.vx = a.vx + cx;
  w.vy = a.vy + cy;
  if (w.vel) { w.vel.x = w.vx; w.vel.y = w.vy; }
}

/** Wraki, których dotyka praca złomiarza (lina, cięcie) — gra stempluje je w `markColdWreckReferences`. */
export function forEachTrafficSalvageWreck(ts, fn) {
  if (!ts) return;
  for (const job of ts.jobs.values()) if (job.active || job.rope) fn(job.wreck);
}

/**
 * Ramka obrazu pracy w chwili klatki renderu `t` (czas mostu): górnik przy polu, złomiarz tnie (punkt cięcia na
 * brzegu wraku od strony holownika), holuje (rufa → wrak). Rekordy: { kind, id, x, y, angle, length, tx, ty, tr,
 * k (0–1 postęp), haul }. `poseAt(a, t, out)` — poza encji w chwili klatki (`trafficActorPoseAt`).
 */
export function fillTrafficWorkFrame(ts, tb, t, poseAt) {
  const out = ts.frame;
  out.count = 0;
  const works = ts.bridge?.actorWorks;
  if (!works || !works.size || !tb) return out;
  for (const rec of works.values()) {
    const a = tb.byId.get(rec.id);
    if (!a || !a.alive) continue;
    let kind = 0;
    let tx = rec.x;
    let ty = rec.y;
    let tr = 0;
    if (rec.kind === 'mine') {
      if (rec.phase !== 'work' || a.phase !== 'station') continue;
      kind = TRAFFIC_WORK_KIND.MINE;
      tr = Math.max(600, (Number(a.length) || 0) * 3);
    } else {
      const job = ts.jobs.get(rec.id);
      if (!job || (!job.active && !job.rope)) continue;
      const w = job.wreck;
      if (!w || w.dead) continue;
      kind = rec.kind === 'cut' ? TRAFFIC_WORK_KIND.CUT : TRAFFIC_WORK_KIND.TOW;
      tx = wreckX(w);
      ty = wreckY(w);
      tr = Number(w.radius) || 200;
    }
    let r = out.list[out.count];
    if (!r) {
      r = { kind: 0, id: 0, x: 0, y: 0, angle: 0, prevX: NaN, prevY: NaN, prevAngle: NaN, length: 0, tx: 0, ty: 0, tr: 0, k: 0, haul: false };
      out.list[out.count] = r;
    }
    if (poseAt) poseAt(a, t, r);
    else { r.x = a.cx; r.y = a.cy; r.angle = a.ca; }
    r.kind = kind;
    r.id = rec.id;
    r.length = Number(a.length) || 0;
    r.tx = tx;
    r.ty = ty;
    r.tr = tr;
    r.k = rec.dur > 0 ? Math.min(1, Math.max(0, (t - rec.t0) / rec.dur)) : 1;
    r.haul = rec.phase === 'haul';
    out.count++;
  }
  return out;
}

/** Wrak zgłoszony złomiarzom (albo odłam ciętego) — barierka budżetu wraków go nie zdejmuje. */
export function isTrafficSalvageWreck(ts, w) {
  return !!ts && !!w && ts.gidOf.has(w);
}
