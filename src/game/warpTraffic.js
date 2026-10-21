// src/game/warpTraffic.js — ruch warpa „Nurt” po stronie GRY (RW-28, docs/PLAN-render-worker.md § 2.6 p. 11–12, § 3.3):
// rejestr przylotów i odlotów okrętów NPC tunelem (wezwania wsparcia, przyloty „teraz”, warp-in piratów, POWRÓT
// skrzydła, odlot fabuły i holownika), harmonogram w CZASIE GRY i prowadzenie okrętów w kroku gry.
//
// Dawniej robił to render (src/3d/warp/warpNurt.js): zegar efektu `WarpNurt.time` (biegł z klatką rAF, także w scenach
// fabuły przy zamrożonym świecie) decydował o chwili pojawienia się wezwań i fazach POWROTU, a efekt pisał encjom pozę,
// prędkość i `isCollidable`, odpalał `onGone` i wykrywał warp-in skanem `npcs`. Teraz:
//   • zegar `time` = suma dt gry (0 w pauzie i przy zamrożonym świecie fabuły), ≤ 0,1 s na klatkę jak dawny zegar efektu;
//   • osie przylotu i odlotu (src/game/warpDrive.js) i poza okrętu w tunelu (`arrivalAxisPose`, `departAxisPose`) —
//     tutaj; okręt prowadzony przez wlot / hamowanie / rozpęd jest duchem (`isCollidable = false`);
//   • warp-in piratów (spawnPirateHeavyFleet: state 'warping_in') zgłasza gra zdarzeniem `noteWarpIn(encja)`;
//   • render dostaje rekordy WARP_* strumienia rozkazów (src/render/renderCommands.js): początek, podpięcie encji,
//     koniec, czyszczenie — a stan osi czyta z rekordu w puli (inline: obiekt rejestru; worker: lustro migawki).
// Limit 24 rekordów (dawny ARRIVAL_CAP efektu): pełna pula = wołający spawnuje od razu (fabuła: `warpArrivalsFree`).
//
// Czysty moduł gry (bez three i DOM).

import {
  createWarpArrival, planWarpRush, sampleWarpRush, warpBrakeTime, createWarpDeparture, sampleWarpDeparture,
  planWarpFleetArrival, warpSizeScale
} from './warpDrive.js';

// 48 (dawniej 24, pula efektu `ARRIVAL_CAP`): scena „Wojna” — dwie floty po 20–25 okrętów, rekordy pierwszej żyją
// jeszcze ~5 s po jej hamowaniu, gdy druga już zapowiada się zwiastunami.
export const WARP_TRAFFIC_CAP = 48;
/** Zasięg nici zwiastuna wstecz od miejsca zatrzymania [j.] (od krawędzi kadru). */
export const HERALD_REACH = 60000;
/** Style zwiastuna przylotu: nić wzdłuż kursu (domyślny), drganie przestrzeni w punkcie wyjścia, brak. */
export const WARP_HERALD_STYLES = Object.freeze(['thread', 'ripple', 'none']);

/** Paleta plazmy WARP encji: blok engineFx z edytora albo zapas silników (piraci karmazyn, reszta magenta). */
export function entityWarpPaletteId(entity) {
  const id = entity?.visual?.engineFx?.warpPalette || entity?.__engineFxFallback?.warpPalette;
  if (id) return id;
  return (entity?.isPirate || entity?.pirate || entity?.faction === 'pirate') ? 'crimson' : 'magenta';
}

/** Długość kadłuba encji [j.] (siatka belek, potem wymiary sprite'a, potem promień). */
export function entityWarpHullLength(e) {
  const h = e?.beamHull;
  if (h && h.srcWidth > 0 && h.scale > 0) return h.srcWidth * h.scale;
  const sc = Number(e?.visual?.spriteScale) || 1;
  if (Number(e?.w) > 0) return e.w * sc;
  return Math.max(120, (Number(e?.radius) || 200) * 2.2);
}

/** Szerokość kadłuba encji [j.]. */
export function entityWarpHullWidth(e) {
  const h = e?.beamHull;
  if (h && h.srcHeight > 0 && h.scale > 0) return h.srcHeight * h.scale;
  const sc = Number(e?.visual?.spriteScale) || 1;
  if (Number(e?.h) > 0) return e.h * sc;
  return entityWarpHullLength(e) * 0.45;
}

/** Poza NPC w świecie (x/y kanoniczne — pos/vel to lustro). */
function npcPose(e, out) {
  if (Number.isFinite(e?.x) && Number.isFinite(e?.y)) {
    out.x = e.x; out.y = e.y; out.angle = Number(e.angle) || 0;
  } else {
    out.x = Number(e?.pos?.x) || 0;
    out.y = Number(e?.pos?.y) || 0;
    out.angle = Number(e?.angle) || 0;
  }
  out.vx = Number(Number.isFinite(e?.vx) ? e.vx : e?.vel?.x) || 0;
  out.vy = Number(Number.isFinite(e?.vy) ? e.vy : e?.vel?.y) || 0;
  return out;
}

/**
 * Oś przylotu okrętu (hullLength, hullWidth w j.) do (x, y) z kursem `angle` (świat gry) — (x, y) = punkt przylotu:
 * miejsce zatrzymania, a przy wyjściu z pędem (exitSpeed > 0, slide — warpExitMomentum) KONIEC ŚLIZGU; hamowanie
 * (zwiastun, błysk, fala) kończy się wtedy `slide` przed nim (a.x, a.y), punkt przylotu zostaje w a.ex, a.ey.
 * startTime — start zwiastuna; burstTime (zamiast startTime) — początek hamowania; appearTime (zamiast obu) — okręt
 * pojawia się w tej chwili (przylot „teraz”). moving — pozycję prowadzi gra (hamowanie z chwili wyjścia z warp-in:
 * setArrivalMovingBrake); rush — minimalna droga wlotu [× długość kadłuba]; heraldReach — nić krótsza, gdy znane miejsce
 * startu jest bliżej (wezwanie z Ziemi). Wygląd (barwy, przegródki ośrodka, kadłub) dokłada render.
 */
export function planWarpArrivalAxis(o) {
  const vExit = Math.max(0, Number(o.exitSpeed) || 0);
  const slide = vExit > 0 ? Math.max(0, Number(o.slide) || 0) : 0;
  const probe = planWarpRush(createWarpArrival({ hullLength: o.hullLength, heraldExtra: o.heraldExtra }), o.rush, vExit);
  const lead = probe.tBurst - probe.t0;
  let startTime = Number(o.startTime) || 0;
  if (Number.isFinite(o.burstTime)) startTime = o.burstTime - lead;
  else if (Number.isFinite(o.appearTime)) startTime = o.appearTime - (probe.tAppear - probe.t0);
  const ang = Number(o.angle) || 0;
  const ex = Number(o.x) || 0;
  const ey = Number(o.y) || 0;
  const a = createWarpArrival({
    x: ex - Math.cos(ang) * slide, y: ey - Math.sin(ang) * slide, angle: ang, hullLength: o.hullLength,
    hullWidth: o.hullWidth, startTime, heraldExtra: o.heraldExtra, palette: o.palette, entity: o.entity || null, id: o.id
  });
  planWarpRush(a, o.rush, vExit);
  a.slide = slide;
  a.ex = ex;
  a.ey = ey;
  a.sx = a.x;
  a.sy = a.y;
  // Chwila, w której okręt musi już być w grze (wezwanie: spawn — src/game/supportWarp.js).
  a.tSpawn = a.tAppear;
  a.pirate = !!o.pirate;
  a.moving = !!o.moving;
  a.drive = !o.moving;
  const reach = Number(o.heraldReach);
  a.heraldReach = reach > 0 ? Math.max(a.hullLength * 2, Math.min(HERALD_REACH, reach)) : HERALD_REACH;
  // Wygląd zwiastuna (render: arrivals.js): nić wzdłuż kursu, drganie przestrzeni w punkcie wyjścia albo nic.
  a.heraldStyle = WARP_HERALD_STYLES.includes(o.heraldStyle) ? o.heraldStyle : 'thread';
  a.rushSample = {};
  // Puszczenie przegródki iskier pchniętych przed dziób (render: przegródka ośrodka) — chwila z osi.
  a.pushReleaseT = a.tBrake + 0.02;
  if (a.moving) {
    // Gra prowadzi okręt: pojawia się teraz (w miejscu encji), hamowanie — gdy wyjdzie z warp-in.
    a.tAppear = Number.isFinite(o.appearTime) ? o.appearTime : a.tAppear;
    a.tBrake = Infinity;
    a.tStop = Infinity;
    a.tEnd = Infinity;
    a.v0 = Math.max(1, Number(o.speed) || a.v0);
    a.vExit = Math.min(a.vExit, a.v0);
    a.brake = warpBrakeTime(a.hullLength, a.v0, a.vExit);
  }
  return a;
}

/**
 * Warp-in prowadzony przez grę: okręt wyszedł z 'warping_in' w chwili t — hamowanie od teraz (obraz: z `speed` do
 * `vExit` — prędkości, z którą gra puściła okręt; bez niej — do dawnego vExit osi).
 */
export function setArrivalMovingBrake(a, t, speed, vExit = NaN) {
  if (Number(speed) > 1) a.v0 = speed;
  if (Number.isFinite(vExit)) a.vExit = Math.max(0, vExit);
  a.vExit = Math.min(Number(a.vExit) || 0, a.v0);
  a.brake = warpBrakeTime(a.hullLength, a.v0, a.vExit);
  a.tBrake = t;
  a.tStop = t + a.brake;
  a.tEnd = a.tStop + 4.5;
  a.pushReleaseT = t + 0.02;
}

/** Pozycja okrętu prowadzonego przez wlot i hamowanie (drive): świat, prędkość. */
export function arrivalAxisPose(a, t, out) {
  const r = sampleWarpRush(a, t, a.rushSample);
  out.x = a.x + a.dirX * r.off;
  out.y = a.y + a.dirY * r.off;
  out.vx = a.dirX * r.speed;
  out.vy = a.dirY * r.speed;
  out.appeared = r.appeared;
  return out;
}

/**
 * Oś odlotu: okręt w (x, y), kurs `angle`; startTime — start ładowania; rush — rozpęd [× L]. drive — gra prowadzi okręt
 * w rozpędzie (droga z osi, `departAxisPose`); bez tego pozycję trzyma gra jak zwykle.
 */
export function planWarpDepartureAxis(o) {
  const d = createWarpDeparture({
    x: o.x, y: o.y, angle: o.angle, hullLength: o.hullLength, hullWidth: o.hullWidth,
    startTime: o.startTime, rush: o.rush, palette: o.palette, entity: o.entity || null, id: o.id
  });
  d.pirate = !!o.pirate;
  d.drive = !!o.drive;
  d.sample = {};
  return d;
}

/** Pozycja okrętu w odlocie z osi (drive): świat, prędkość. */
export function departAxisPose(d, t, out) {
  const s = sampleWarpDeparture(d, t, d.sample);
  out.x = d.x + d.dirX * s.dist;
  out.y = d.y + d.dirY * s.dist;
  out.vx = d.dirX * s.speed;
  out.vy = d.dirY * s.speed;
  return out;
}

/**
 * Rejestr ruchu warpa. commands — pisarz strumienia rozkazów (RenderCommands.writer: warpBegin / warpAttach / warpEnd /
 * warpClear) albo null (testy bez renderu). momentum(encja) → { vExit, slide } | null — wyjście z pędem przylotu „teraz”
 * (`arrive`: gra zna specyfikację lotu encji — warpExitMomentum); bez niego okręt staje jak dawniej.
 */
export function createWarpTraffic({ commands = null, cap = WARP_TRAFFIC_CAP, momentum = null } = {}) {
  const free = [];
  for (let i = cap - 1; i >= 0; i--) free.push(i);
  const slots = new Array(cap).fill(null);
  const pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
  const drive = { x: 0, y: 0, vx: 0, vy: 0, appeared: false };
  const warpIns = [];
  const seen = new WeakSet();

  const traffic = {
    time: 0,
    cap,
    /** Rekordy w kolejności powstania (jak dawna lista efektu `WarpNurt.arrivals`). */
    records: [],
    commands,
    momentum,
    stats: { arrivals: 0, departures: 0, started: 0, ended: 0, full: 0 },

    /** Rekord w slocie puli (render inline: obiekt rejestru). */
    recordAt(id) { return slots[id] || null; },

    /** Wolne miejsca w puli (fabuła: tempo fal). */
    get free() { return cap - this.records.length; },

    // Miejsce w puli (pełna — licznik odmów: wołający spawnuje bez efektu).
    _room() {
      if (this.records.length < cap) return true;
      this.stats.full++;
      return false;
    },

    _add(rec) {
      if (!free.length) { this.stats.full++; return null; }
      rec.id = free.pop();
      slots[rec.id] = rec;
      this.records.push(rec);
      this.stats.started++;
      if (this.commands) this.commands.warpBegin(rec);
      return rec;
    },

    _remove(index) {
      const rec = this.records[index];
      this.records.splice(index, 1);
      if (rec.driving) this._releaseDrive(rec);
      slots[rec.id] = null;
      free.push(rec.id);
      this.stats.ended++;
      if (this.commands) this.commands.warpEnd(rec);
    },

    /** Warp-in piratów (state 'warping_in'): zdarzenie gry przy spawnie — efekt odsłania kadłub od miejsca pojawienia. */
    noteWarpIn(e) {
      if (!e || seen.has(e)) return;
      seen.add(e);
      warpIns.push(e);
    },

    /**
     * Klatka gry przed render(): zegar (dt gry — 0 w pauzie i przy zamrożonym świecie), przyloty warp-in zgłoszone
     * w tej klatce, prowadzenie okrętów w tunelu, `onGone`, koniec rekordów.
     */
    step(dt) {
      const h = Math.max(0, Math.min(0.1, Number(dt) || 0));
      this.time += h;
      const t = this.time;
      for (let i = 0; i < warpIns.length; i++) {
        const n = warpIns[i];
        if (n && !n.dead && n.state === 'warping_in') this.arrive(n, { moving: true });
      }
      warpIns.length = 0;
      const list = this.records;
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i];
        const e = rec.entity;
        if (rec.kind === 'arrival') {
          if (e && e.dead) { this._releaseDrive(rec); rec.entity = null; }
          // Długość kadłuba znana dopiero po zbudowaniu siatki (warp-in piratów, wezwanie podpięte w chwili pojawienia
          // się) — przeliczenie PRZED próbką.
          if (rec.entity && !rec.sized && rec.entity.beamHull) this._resize(rec);
          const fx = rec.fx;
          const en = rec.entity;
          if (en) {
            // Warp-in prowadzony przez grę: hamowanie od chwili, gdy okręt wyszedł z 'warping_in' (do prędkości,
            // z którą gra go puściła — wyjście z pędem).
            if (fx.moving && fx.tBrake === Infinity && en.state !== 'warping_in') {
              const p0 = npcPose(en, pose);
              const sp = Math.sqrt(p0.vx * p0.vx + p0.vy * p0.vy);
              setArrivalMovingBrake(fx, t, Math.max(fx.v0, sp), sp < fx.v0 ? sp : NaN);
            }
            if (fx.drive && t < fx.tStop) {
              // Wlot i hamowanie prowadzi oś (duch — bez zderzeń; okręt pojawia się za kadrem).
              if (!rec.driving) {
                rec.driving = true;
                rec.wasCollidable = en.isCollidable !== false;
                en.isCollidable = false;
              }
              const p = arrivalAxisPose(fx, t, drive);
              writePose(en, p.x, p.y, p.vx, p.vy);
              en.angle = fx.angle;
              if (Number.isFinite(en.desiredAngle)) en.desiredAngle = fx.angle;
              en.angVel = 0;
            } else if (rec.driving) {
              // Koniec hamowania: okręt wraca do gry — stoi w miejscu zwiastuna (vExit = 0) albo leci dalej z prędkością
              // wyjścia wzdłuż kursu (wyjście z pędem; poza z osi w tej chwili — klatka może przyjść po tStop).
              const p = arrivalAxisPose(fx, t, drive);
              writePose(en, p.x, p.y, p.vx, p.vy);
              // ślizg: model lotu trzyma limit na prędkości bojowej, aż nadmiar zgaśnie (shipFlightModel.js)
              if (fx.vExit > 0) en.__warpExitSlide = true;
              this._releaseDrive(rec);
            }
          }
          if (t > fx.tEnd) this._remove(i);
        } else {
          const d = rec.fx;
          if (e && !e.dead) {
            if (d.drive && t >= d.tDive) {
              // Gra prowadzi okręt w rozpędzie (POWRÓT skrzydła na Ziemię — src/game/supportWarp.js; harness). Okręt
              // jest wtedy duchem (isCollidable = false — supportWarp `dive`), więc nikogo nie taranuje.
              const p = departAxisPose(d, t, drive);
              writePose(e, p.x, p.y, p.vx, p.vy);
            }
            if (t >= d.tGone && !rec.goneFired) {
              // Po zniknięciu w punkcie skoku render chowa kadłub; gra usuwa encję (onGone).
              rec.goneFired = true;
              if (rec.onGone) rec.onGone(e);
            }
          }
          if (t > d.tEnd && (!e || e.dead)) this._remove(i);
        }
      }
      const s = this.stats;
      s.arrivals = 0;
      s.departures = 0;
      for (let i = 0; i < list.length; i++) { if (list[i].kind === 'arrival') s.arrivals++; else s.departures++; }
    },

    // Koniec prowadzenia przylotu: okręt znów zderza się i słucha gry.
    _releaseDrive(rec) {
      if (!rec.driving) return;
      rec.driving = false;
      const e = rec.entity;
      if (e && !e.dead && rec.wasCollidable) e.isCollidable = true;
    },

    // Wymiary z prawdziwego kadłuba (podpięty okręt): oś wlotu i hamowania zostaje (okręt może już lecieć), zmieniają
    // się tylko wymiary efektu (bańka, błyski, odsłanianie).
    _resize(rec) {
      const e = rec.entity;
      rec.sized = true;
      const fx = rec.fx;
      fx.hullLength = entityWarpHullLength(e);
      fx.hullWidth = entityWarpHullWidth(e);
      fx.sizeScale = warpSizeScale(fx.hullLength);
    },

    /**
     * Przylot okrętu w chwili pojawienia się w grze (bez zapowiedzi — rozgrywka nie zna go wcześniej): okręt wpada
     * z daleka i hamuje tak, że w miejscu, w którym postawiła go gra, staje (albo — wyjście z pędem — kończy ślizg; oś
     * prowadzi go przez wlot i hamowanie — duch). opts.moving — pozycję prowadzi gra (warp-in piratów: odsłanianie od
     * miejsca pojawienia się, hamowanie po wyjściu z 'warping_in'). opts.exit — { vExit, slide } zamiast `momentum`
     * rejestru (null — zatrzymanie).
     */
    arrive(entity, opts = {}) {
      if (!entity || !this._room()) return null;
      const p = npcPose(entity, pose);
      const angle = opts.angle ?? p.angle;
      const moving = !!opts.moving;
      const speed = Math.max(Number(entity.warpData?.speed) || 0, Math.sqrt(p.vx * p.vx + p.vy * p.vy));
      const exit = moving ? null : (opts.exit !== undefined ? opts.exit : (this.momentum ? this.momentum(entity) : null));
      const fx = planWarpArrivalAxis({
        x: p.x, y: p.y, angle, hullLength: entityWarpHullLength(entity), hullWidth: entityWarpHullWidth(entity),
        palette: opts.palette || entityWarpPaletteId(entity), pirate: !!(opts.pirate ?? entity.isPirate),
        moving, appearTime: this.time, speed, entity, rush: opts.rush,
        exitSpeed: exit ? exit.vExit : 0, slide: exit ? exit.slide : 0
      });
      if (moving) { fx.x0 = p.x; fx.y0 = p.y; }
      return this._add({ id: -1, kind: 'arrival', fx, entity, sized: !!entity.beamHull, moving, driving: false, wasCollidable: true, onGone: null, goneFired: false });
    },

    /**
     * Wezwanie bez zapowiedzi: wynik spawnCallInShip (encja albo lista) — każdy okręt kadłubowy wpada w chwili
     * pojawienia się (myśliwce bez efektu). Zwykłe wezwanie z zakładki wsparcia idzie z wyprzedzeniem
     * (planArrival + attach, src/game/supportWarp.js); tędy tryb LINIE i wezwania bez punktu albo przy pełnej puli.
     */
    arriveAll(result) {
      if (!result) return;
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i++) this.arriveAll(result[i]);
        return;
      }
      if (typeof result !== 'object' || result.dead || result.fighter || result.isFighter) return;
      this.arrive(result);
    },

    /**
     * Przylot zaplanowany (zwiastun → wlot → hamowanie) w (x, y) = punkt przylotu (miejsce zatrzymania albo koniec
     * ślizgu — o.exitSpeed, o.slide: warpExitMomentum); hamowanie po czasie zwiastuna (albo `burstIn` s). Wołający
     * stawia okręt w grze w chwili `rec.fx.tSpawn` (czas tego rejestru) i podpina go `attach(rec, encja)` (wezwania
     * z zakładki wsparcia: src/game/supportWarp.js). o.heraldReach — nić krótsza; o.heraldStyle — wygląd zwiastuna
     * ('thread' — nić, domyślnie; 'ripple' — drganie przestrzeni; 'none').
     */
    planArrival(o) {
      if (!this._room()) return null;
      const fx = planWarpArrivalAxis({
        x: o.x, y: o.y, angle: o.angle || 0, hullLength: o.hullLength, hullWidth: o.hullWidth,
        palette: o.palette || 'magenta', pirate: !!o.pirate, moving: false, rush: o.rush,
        startTime: Number.isFinite(o.burstIn) ? undefined : this.time + (Number(o.delay) || 0),
        burstTime: Number.isFinite(o.burstIn) ? this.time + o.burstIn : undefined, heraldExtra: o.heraldExtra || 0,
        heraldReach: o.heraldReach, exitSpeed: o.exitSpeed, slide: o.slide, heraldStyle: o.heraldStyle
      });
      return this._add({ id: -1, kind: 'arrival', fx, entity: null, sized: true, moving: false, driving: false, wasCollidable: true, onGone: null, goneFired: false });
    },

    /** Wezwanie floty z planem (planWarpFleetArrival): zwiastuny razem, wyrzuty od najmniejszego. */
    planFleetArrival(ships, opts = {}) {
      const plan = planWarpFleetArrival(ships.map((s) => ({ hullLength: s.hullLength })), { ...opts, startTime: this.time });
      return plan.map((p) => this.planArrival({ ...ships[p.index], delay: p.startTime - this.time, heraldExtra: p.heraldExtra }));
    },

    /** Podpięcie okrętu do zaplanowanego przylotu (w chwili spawnu) — wymiary z kadłuba, gdy już jest. */
    attach(rec, entity) {
      if (!rec || !entity) return;
      rec.entity = entity;
      rec.fx.entity = entity;
      rec.sized = false;
      if (entity.beamHull) this._resize(rec);
      if (this.commands && slots[rec.id] === rec) this.commands.warpAttach(rec);
    },

    /**
     * Odlot tunelem: ładowanie (punkt skoku przed dziobem), okręt wchodzi w punkt skoku od dziobu. opts.drive — gra
     * prowadzi okręt w rozpędzie (pozycja z osi), opts.onGone(e) — okręt zniknął (wołający usuwa encję).
     */
    depart(entity, opts = {}) {
      if (!entity || !this._room()) return null;
      const p = npcPose(entity, pose);
      const d = planWarpDepartureAxis({
        x: p.x, y: p.y, angle: opts.angle ?? p.angle, hullLength: entityWarpHullLength(entity),
        hullWidth: entityWarpHullWidth(entity), startTime: this.time + (Number(opts.delay) || 0),
        palette: opts.palette || entityWarpPaletteId(entity), pirate: !!(opts.pirate ?? entity.isPirate),
        drive: !!opts.drive, rush: opts.rush, entity
      });
      return this._add({ id: -1, kind: 'departure', fx: d, entity, sized: true, moving: false, driving: false, wasCollidable: true, onGone: opts.onGone || null, goneFired: false });
    },

    /** Wszystko do zera (nowa gra, teleport w harnessie). Zegar biegnie dalej (osie nowych rekordów od `time`). */
    clear() {
      for (const rec of this.records) {
        if (rec.driving) this._releaseDrive(rec);
        slots[rec.id] = null;
        free.push(rec.id);
      }
      this.records.length = 0;
      warpIns.length = 0;
      if (this.commands) this.commands.warpClear();
    }
  };
  return traffic;
}

// Pozycja i prędkość encji z osi (NPC: x/y kanoniczne + lustro pos/vel).
function writePose(e, x, y, vx, vy) {
  if (Number.isFinite(e.x)) { e.x = x; e.y = y; e.vx = vx; e.vy = vy; }
  if (e.pos) { e.pos.x = x; e.pos.y = y; }
  if (e.vel) { e.vel.x = vx; e.vel.y = vy; }
}
