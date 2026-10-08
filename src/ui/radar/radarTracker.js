// src/ui/radar/radarTracker.js
//
// Śledzenie kontaktów radaru (czysta logika — bez DOM i płótna; testy: tests/radarTracker.test.mjs).
//
// Model jak w prawdziwym radarze z nakładką ARPA:
//  - ANTENA obraca się w układzie TARCZY (kąt `sweep`, 0 = w prawo, zgodnie z zegarem — jak kąty płótna).
//    Kąt anteny w świecie = sweep − θ (θ = obrót świat → tarcza: H-UP −π/2 − kurs, N-UP 0). Kontakt jest
//    MALOWANY, gdy wiązka przejdzie przez jego namiar w tym kroku (przedział kątów świata — obrót okrętu
//    nie gubi ani nie maluje drugi raz), albo gdy dotrze do niego IMPULS skanera X (pierścień z prędkością
//    fali). Malowanie zapisuje pozycję i prędkość — surowe echo stoi tam i gaśnie (luminofor).
//  - ŚLAD (track): po `trackMature` malowaniach dostaje numer (T01…); między malowaniami symbol jedzie
//    z ostatnią prędkością (dead reckoning), korekta przy następnym malowaniu. Kierunku lotu tarcza nie
//    rysuje (bez wektorów i śladu ostatnich pozycji — 2026-10-08: w dużej bitwie gąszcz kresek).
//  - CIĄGŁE śledzenie: sojusznicy (łącze danych) i cele namierzone / wybrane (radar kierowania ogniem)
//    — symbol w żywej pozycji, echo dalej z anteny.
//  - KLASYFIKACJA (kod klasy, nazwa): sojusznik od razu, reszta z bliska, po impulsie X, przy namiarze.
//  - Kontakt, który zniknął z wejścia: zniszczony → znacznik ✕ na `killFade` s; ukryty mgłą → bez śladu
//    (ostatnią znaną pozycję pokazuje duch z SensorSystem).
//
// Wejście (feed): { own: { x, y, vx, vy, heading }, theta, paintRange, targets: [rekord], count,
//   pingSerial, pingSpeed, pingRange }. Rekord: { key, src, kind, aff, x, y, vx, vy, angle, length, width,
//   capital, cls, name, idKnown, continuous, locked, selected, objective }. `src` mówi, skąd czytać ŻYWĄ
//   pozycję w każdym kroku (feed odświeża się rzadziej niż tarcza): RADAR_SRC.

import { RADAR_TUNE, scanPulseRadius } from './radarConfig.js';

const TAU = Math.PI * 2;

export const RADAR_SRC = Object.freeze({
  STATIC: 0,   // rekord.x / y (stacje, wraki, sygnatury)
  XY: 1,       // key.x, key.y, key.vx, key.vy (NPC — kinematyka w x)
  POS: 2,      // key.pos, key.vel (gracz, P2, drony z pos)
  ROCKET: 3    // key.position.x / z, key.velocity + frameVel (rakiety 3D)
});

export const RADAR_KIND = Object.freeze({
  SHIP: 'ship', FIGHTER: 'fighter', MISSILE: 'missile', STATION: 'station', WRECK: 'wreck', DRONE: 'drone'
});

export function normAngle(a) {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
}

/** Obrót świat → tarcza [rad]: H-UP — dziób do góry, N-UP — jak ekran gry. */
export function radarTheta(heading, orient) {
  return orient === 'north' ? 0 : -Math.PI / 2 - (Number(heading) || 0);
}

/** Najkrótsza różnica kątów (b − a) w (−π, π]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Czy kąt `angle` leży w przedziale [start, start + span] (span ≥ 0, kąty dowolne). */
export function angleInSweep(start, span, angle) {
  if (!(span > 0)) return false;
  if (span >= TAU) return true;
  return normAngle(angle - start) <= span + 1e-9;
}

/**
 * Świat (względem okrętu) → px tarczy. out = { x, y }. k = px na jednostkę świata, (cx, cy) — środek.
 */
export function radarProject(dx, dy, theta, k, cx, cy, out) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  out.x = cx + (dx * c - dy * s) * k;
  out.y = cy + (dx * s + dy * c) * k;
  return out;
}

/** Odwrotność radarProject: px tarczy → świat względem okrętu. */
export function radarUnproject(px, py, theta, k, cx, cy, out) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const x = (px - cx) / k;
  const y = (py - cy) / k;
  out.x = x * c + y * s;
  out.y = -x * s + y * c;
  return out;
}

/** Namiar względny (0 = dziób, zgodnie z zegarem, [0, 2π)) punktu (dx, dy) przy kursie heading. */
export function relativeBearing(dx, dy, heading) {
  return normAngle(Math.atan2(dy, dx) - (Number(heading) || 0));
}

function isGone(key) {
  return !key || key.dead === true || key.destroyed === true || key._destroyed3D === true || key.removed === true
    || (Number.isFinite(key.hp) && key.hp <= 0 && key.isWreck !== true && key.active !== true);
}

function createTrack(key, time) {
  return {
    key,
    no: 0,
    kind: 'ship',
    aff: 'unknown',
    cls: '',
    name: '',
    capital: false,
    length: 0,
    width: 0,
    angle: 0,
    sprite: null,
    spriteRot: 0,
    // malowanie (surowe echo)
    paints: 0,
    paintT: -1e9,
    px: 0, py: 0, pvx: 0, pvy: 0, pAngle: 0,
    // żywa pozycja i prędkość (z wejścia w tym kroku)
    lx: 0, ly: 0, lvx: 0, lvy: 0,
    // pozycja symbolu i prędkość wektora (ciągłe albo dead reckoning)
    sx: 0, sy: 0, svx: 0, svy: 0,
    dist: 0,
    classified: false,
    continuous: false,
    locked: false,
    selected: false,
    objective: false,
    pingT: -1e9,
    newT: -1e9,
    bornT: time,
    matureT: -1e9,
    stamp: 0,
    gen: undefined,
    rec: null,
    // pozycja etykiety (tarcza, ostatni rysunek); sylwetka echa z ostatniego rysunku (radarDisplay)
    _tagX: 0, _tagY: 0, _tagS: 0,
    _silSrc: null, _silW: 0, _silH: 0, _sil: null
  };
}

// Ten sam klucz, nowy byt (slot puli rakiet użyty ponownie): ślad od zera.
function restartTrack(t, time) {
  t.no = 0;
  t.paints = 0;
  t.paintT = -1e9;
  t.classified = false;
  t.pingT = -1e9;
  t.newT = -1e9;
  t.bornT = time;
  t.matureT = -1e9;
}

export function createRadarTracker(tune = RADAR_TUNE) {
  return {
    tune,
    time: 0,
    sweep: -Math.PI / 2,     // start u góry tarczy
    worldSweep: NaN,
    stamp: 0,
    nextNo: 1,
    tracks: new Map(),
    list: [],
    kills: [],
    ping: { active: false, started: false, serial: null, t0: 0, x: 0, y: 0, speed: 0, max: 0, r: 0, prevR: 0, fade: 0 },
    counts: { hostile: 0, friendly: 0, neutral: 0, missiles: 0, total: 0 },
    stats: { painted: 0, steps: 0 }
  };
}

function readLive(rec, out) {
  const key = rec.key;
  switch (rec.src) {
    case RADAR_SRC.XY: {
      const x = Number(key?.x);
      const y = Number(key?.y);
      out.x = Number.isFinite(x) ? x : rec.x;
      out.y = Number.isFinite(y) ? y : rec.y;
      out.vx = Number(key?.vx) || 0;
      out.vy = Number(key?.vy) || 0;
      out.angle = Number.isFinite(Number(key?.angle)) ? Number(key.angle) : rec.angle;
      return out;
    }
    case RADAR_SRC.POS: {
      const p = key?.pos;
      out.x = Number.isFinite(p?.x) ? p.x : rec.x;
      out.y = Number.isFinite(p?.y) ? p.y : rec.y;
      out.vx = Number(key?.vel?.x) || 0;
      out.vy = Number(key?.vel?.y) || 0;
      out.angle = Number.isFinite(Number(key?.angle)) ? Number(key.angle) : rec.angle;
      return out;
    }
    case RADAR_SRC.ROCKET: {
      const p = key?.position;
      out.x = Number.isFinite(p?.x) ? p.x : rec.x;
      out.y = Number.isFinite(p?.z) ? p.z : rec.y;
      out.vx = (Number(key?.velocity?.x) || 0) + (Number(key?.frameVel?.x) || 0);
      out.vy = (Number(key?.velocity?.z) || 0) + (Number(key?.frameVel?.z) || 0);
      out.angle = Math.atan2(out.vy, out.vx);
      return out;
    }
    default:
      out.x = rec.x;
      out.y = rec.y;
      out.vx = rec.vx || 0;
      out.vy = rec.vy || 0;
      out.angle = rec.angle || 0;
      return out;
  }
}

const _live = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

function paintTrack(tr, t, time, tune) {
  if (t.paints === 0 && t.aff === 'hostile') t.newT = time;
  t.paints++;
  t.paintT = time;
  t.px = t.lx;
  t.py = t.ly;
  t.pvx = t.lvx;
  t.pvy = t.lvy;
  t.pAngle = t.angle;
  if (!t.no && (t.paints >= tune.trackMature || t.continuous)) {
    t.no = tr.nextNo++;
    if (tr.nextNo > 999) tr.nextNo = 1;
    t.matureT = time;
  }
  tr.stats.painted++;
}

/**
 * Krok śledzenia: obrót anteny, impuls skanera, malowanie, cykl życia śladów.
 * Zwraca tr (tr.list — żywe ślady w kolejności wejścia).
 */
export function stepRadarTracker(tr, feed, dt, tune = tr.tune || RADAR_TUNE) {
  const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
  tr.time += step;
  tr.stamp++;
  tr.stats.steps++;
  const time = tr.time;
  const own = feed?.own;
  const ox = Number(own?.x) || 0;
  const oy = Number(own?.y) || 0;
  const heading = Number(own?.heading) || 0;
  const theta = Number.isFinite(feed?.theta) ? feed.theta : radarTheta(heading, 'head');

  // Antena: w układzie tarczy jednostajnie; w świecie przedział [worldPrev, worldNow] z obrotem okrętu.
  const omega = TAU / Math.max(0.2, tune.sweepPeriod);
  tr.sweep = normAngle(tr.sweep + omega * step);
  const worldNow = tr.sweep - theta;
  let worldPrev = tr.worldSweep;
  if (!Number.isFinite(worldPrev)) worldPrev = worldNow - omega * step;
  let span = normAngle(worldNow - worldPrev);
  // Obrót wstecz (okręt kręci się szybciej niż antena w drugą stronę) — w tym kroku bez malowania.
  if (span > Math.PI) span = 0;
  tr.worldSweep = worldNow;

  // Impuls skanera X: pierścień od okrętu z prędkością fali do zasięgu aktywnego.
  const ping = tr.ping;
  const serial = feed?.pingSerial;
  if (serial != null && ping.serial !== serial) {
    const first = ping.serial === null;
    ping.serial = serial;
    if (!first) {
      ping.active = true;
      ping.started = true;
      ping.t0 = time;
      ping.x = ox;
      ping.y = oy;
      ping.speed = Math.max(1000, Number(feed.pingSpeed) || 30000);
      ping.max = Math.max(1000, Number(feed.pingRange) || 60000);
      ping.r = 0;
      ping.prevR = 0;
      ping.fade = 0;
    }
  }
  let pingFrom = 0;
  let pingTo = -1;
  if (ping.active) {
    ping.prevR = ping.r;
    ping.r = scanPulseRadius(time - ping.t0, ping.speed);
    pingFrom = ping.prevR;
    pingTo = Math.min(ping.r, ping.max);
    if (ping.r > ping.max) {
      ping.fade += step;
      if (ping.fade > 0.45) ping.active = false;
    }
  }

  const paintRange = Math.max(1, Number(feed?.paintRange) || 60000);
  const paintRangeSq = paintRange * paintRange;
  const classifyRangeSq = tune.classifyRange * tune.classifyRange;
  const targets = feed?.targets || [];
  const count = Math.min(targets.length, Number.isFinite(feed?.count) ? feed.count : targets.length);
  const list = tr.list;
  list.length = 0;
  const counts = tr.counts;
  counts.hostile = counts.friendly = counts.neutral = counts.missiles = counts.total = 0;
  const countRange = Math.max(1, Number(feed?.range) || paintRange);
  const countRangeSq = countRange * countRange;

  for (let i = 0; i < count; i++) {
    const rec = targets[i];
    if (!rec || !rec.key) continue;
    let t = tr.tracks.get(rec.key);
    if (!t) {
      if (tr.tracks.size >= tune.maxTracks) continue;
      t = createTrack(rec.key, time);
      tr.tracks.set(rec.key, t);
    }
    if (t.gen !== rec.gen) {
      if (t.gen !== undefined) restartTrack(t, time);
      t.gen = rec.gen;
    }
    t.stamp = tr.stamp;
    t.rec = rec;
    t.kind = rec.kind || 'ship';
    t.aff = rec.aff || 'unknown';
    t.cls = rec.cls || '';
    t.name = rec.name || '';
    t.capital = !!rec.capital;
    t.length = Number(rec.length) || 0;
    t.width = Number(rec.width) || 0;
    t.sprite = rec.sprite || null;
    t.spriteRot = Number(rec.spriteRot) || 0;
    // namiar i wybór — radar kierowania ogniem; cel misji — rozpoznanie z odprawy (śledzony stale)
    t.continuous = !!(rec.continuous || rec.locked || rec.selected || rec.objective);
    t.locked = !!rec.locked;
    t.selected = !!rec.selected;
    t.objective = !!rec.objective;

    readLive(rec, _live);
    t.lx = _live.x;
    t.ly = _live.y;
    t.lvx = _live.vx;
    t.lvy = _live.vy;
    t.angle = _live.angle;
    const dx = t.lx - ox;
    const dy = t.ly - oy;
    const distSq = dx * dx + dy * dy;
    t.dist = Math.sqrt(distSq);

    if (distSq <= paintRangeSq) {
      let hit = span > 0 && angleInSweep(worldPrev, span, Math.atan2(dy, dx));
      if (pingTo >= 0) {
        const pdx = t.lx - ping.x;
        const pdy = t.ly - ping.y;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pd > pingFrom && pd <= pingTo) {
          hit = true;
          t.pingT = time;
          t.classified = true;
        }
      }
      // Sojusznik / cel namierzony w pierwszym kroku — od razu (łącze danych, radar kierowania ogniem).
      if (!hit && t.paints === 0 && t.continuous) hit = true;
      if (hit) paintTrack(tr, t, time, tune);
    }
    if (!t.classified && (rec.idKnown || t.locked || t.selected || t.objective || distSq <= classifyRangeSq)) t.classified = true;

    // Symbol: ciągły — żywa pozycja; reszta — ostatnie malowanie + prędkość × wiek (najwyżej ~1,3 obrotu).
    // Szybki kontakt (przylot / odlot warpem, > fastSpeed) — żywa pozycja: ekstrapolacja z 20 km/s
    // przy hamowaniu wyrzucała symbol dziesiątki km przed okręt.
    const fast = t.lvx * t.lvx + t.lvy * t.lvy > tune.fastSpeed * tune.fastSpeed
      || t.pvx * t.pvx + t.pvy * t.pvy > tune.fastSpeed * tune.fastSpeed;
    if (t.continuous || t.paints === 0 || fast) {
      t.sx = t.lx;
      t.sy = t.ly;
      t.svx = t.lvx;
      t.svy = t.lvy;
    } else {
      const age = Math.min(time - t.paintT, tune.sweepPeriod * 1.3);
      t.sx = t.px + t.pvx * age;
      t.sy = t.py + t.pvy * age;
      t.svx = t.pvx;
      t.svy = t.pvy;
    }
    if (t.paints > 0 || t.continuous) list.push(t);

    if (distSq <= countRangeSq && t.paints > 0) {
      counts.total++;
      if (t.kind === 'missile') { if (t.aff === 'hostile') counts.missiles++; }
      else if (t.aff === 'hostile') counts.hostile++;
      else if (t.aff === 'friendly') counts.friendly++;
      else counts.neutral++;
    }
  }

  // Ślady, których nie ma w wejściu: zniszczone → ✕, reszta (mgła, poza zasięgiem) — po cichu.
  if (tr.tracks.size > list.length) {
    for (const [key, t] of tr.tracks) {
      if (t.stamp === tr.stamp) continue;
      if (t.paints > 0 && isGone(key) && (t.kind === 'ship' || t.kind === 'fighter' || t.kind === 'station')) {
        tr.kills.push({ x: t.sx, y: t.sy, t: time, aff: t.aff, no: t.no, capital: t.capital, kind: t.kind });
      }
      tr.tracks.delete(key);
    }
  }
  for (let i = tr.kills.length - 1; i >= 0; i--) {
    if (time - tr.kills[i].t > tune.killFade) tr.kills.splice(i, 1);
  }
  if (tr.kills.length > 48) tr.kills.splice(0, tr.kills.length - 48);
  return tr;
}

/** Jasność surowego echa śladu [0, 1+] w chwili tr.time (błysk zaraz po malowaniu). */
export function radarEchoLevel(tr, t, tune = tr.tune || RADAR_TUNE) {
  if (!(t.paints > 0)) return 0;
  const age = tr.time - t.paintT;
  if (age < 0) return 1;
  const flash = age < tune.echoFlash ? 0.35 * (1 - age / tune.echoFlash) : 0;
  return Math.exp(-age / tune.echoTau) + flash;
}

/** Usuwa wszystkie ślady (nowa gra, zmiana gracza). */
export function resetRadarTracker(tr) {
  tr.tracks.clear();
  tr.list.length = 0;
  tr.kills.length = 0;
  tr.worldSweep = NaN;
  tr.ping.active = false;
  tr.nextNo = 1;
}
