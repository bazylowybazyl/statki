// Megabudowle — punkty orientacyjne miast (port z dema ECUMENE,
// dema/orbital_ring_gameplay_hub_v3.html: MEGA_SPECS + createMegabuildings).
// Czysta matematyka, bez Three.
//
// Decyzja użytkownika 2026-09-24: ring dopracowujemy rzeczami „pożyczonymi”
// z innych dem; na początek megabudowle ECUMENE jako landmarki sektorów miast
// (ogród, szkło). Nazwy z ECUMENE trafiają do sektorów o tych samych nazwach
// (HELIX, MERIDIAN, AXIOM, DAEDALUS); KEPLER TRANSIT NEXUS stoi w VESPER, obok
// PORTU KEPLER (sam port to sektor krajobrazu z kompleksem K-7).
//
// Rozstawienie (buildHaloLandmarkPlan) — w dolnej połowie wstęgi (z < 0), bo:
//  - w kamerze gry widać je wtedy od frontu (fasada +z patrzy w kamerę),
//  - nie przecinają płaszczyzny lotu (z = 0), więc nie są przeszkodą,
//  - górna połowa leży przy kamerze gry i rosłaby w powiększeniu jak dach.
// Poza tym z dala od kompleksów portu (razem ze strefami) i tranzytów, na
// suchym i możliwie płaskim terenie (mapa wysokości CPU sprzed placów).
//
// Budowla stoi w parku (poprawka użytkownika 2026-09-25: „nie puste
// otoczenie — niech stoi w parku jak w dwóch innych demach”): kamienna płyta
// placu, wokół płaski trawnik z pawilonami (ECUMENE createParks), dalej park
// — kępy drzew z szumu (ECUMENE createForests), ścieżki siatką zakrzywioną
// szumem i kwietniki (orbital_ring_demo_2, strefa PARK), staw przy niskim
// terenie. Mapy (haloRingWorldGen.js) pieką plac, trawnik, park i staw;
// ścieżki i kwietniki rysuje shader terenu z wagi parku (kanał R mapy B).
//
// Układ budowli (haloLandmarkParts): a wzdłuż ringu, q w poprzek (+ ku górnej
// ścianie = front, kamera gry), u w górę mieszkańców (od placu). Części jak
// w ECUMENE (podium, wieże, mosty mieszkalne, tarasy, rdzenie), front ECUMENE
// (−z) → +q. Materiały są symboliczne — kody nadaje plan dachu.
import { HALO_TAU, haloPortSites } from './haloRingConfig.js';

export const HALO_LANDMARK = Object.freeze({
  maxCount: 12,          // limit uniformów bake'u (haloRingWorldGen.js)
  plinthMargin: 40,      // płyta placu poza obrysem podium [j.] (+ 6% większego wymiaru)
  plinthDepth: 40,       // fundament płyty pod placem
  plinthTop: 4,          // wierzch płyty nad placem
  lawn: 110,             // płaski trawnik wokół płyty (pawilony, bez drzew)
  ramp: 240,             // rampa do terenu
  park: 260,             // park poza rampą wzdłuż ringu (kępy drzew, ścieżki, staw)
  parkQ: 160,            // i w poprzek (w granicach dolnej połowy wstęgi)
  planeGap: 120,         // plac z rampą kończy się tyle pod płaszczyzną gry
  wallGap: 120,          // i tyle od dolnej ściany
  portGap: 300,          // odstęp od kompleksu portu (liczony poza strefami)
  transitGap: 400,       // odstęp od fartucha tranzytu
  spacing: 500,          // odstęp między parkami sąsiednich obiektów
  minPlazaH: 6,          // plac nad lustrem wody
  maxPlazaH: 160,
  pondMaxGround: 26,     // staw tylko przy niskim terenie (woda w terenie = poziom 0)
  pondDepth: -5
});

// Wymiary i proporcje jak w ECUMENE (w wzdłuż, d w poprzek, h wysokość,
// u — preferowane miejsce w sektorze od jego początku, z — położenie
// w poprzek wstęgi ECUMENE (±1050 j.) jako preferencja w dozwolonym pasie,
// yaw — skręt osi).
export const HALO_LANDMARK_SPECS = Object.freeze([
  { name: 'HELIX GATE', sector: 'HELIX', u: 0.23, z: -330, kind: 'gate', w: 500, d: 340, h: 990, yaw: 0.06 },
  { name: 'THE HANGING GARDENS', sector: 'HELIX', u: 0.59, z: 320, kind: 'terrace', w: 670, d: 370, h: 650, yaw: -0.09 },
  { name: 'CIVIC SPIRE', sector: 'HELIX', u: 0.86, z: -340, kind: 'crown', w: 420, d: 320, h: 1230, yaw: 0.08 },
  { name: 'MERIDIAN ARCOLOGY', sector: 'MERIDIAN', u: 0.24, z: -520, kind: 'terrace', w: 600, d: 275, h: 450, yaw: 0.02 },
  { name: 'SKYGARDEN RESIDENCES', sector: 'MERIDIAN', u: 0.65, z: 555, kind: 'bridge', w: 650, d: 300, h: 760, yaw: -0.07 },
  { name: 'AXIOM TRINITY', sector: 'AXIOM', u: 0.26, z: -420, kind: 'crown', w: 430, d: 320, h: 1080, yaw: -0.04 },
  { name: 'THE AXIOM EXCHANGE', sector: 'AXIOM', u: 0.62, z: 470, kind: 'gate', w: 550, d: 290, h: 830, yaw: 0.08 },
  { name: 'KEPLER TRANSIT NEXUS', sector: 'VESPER', u: 0.3, z: -310, kind: 'bridge', w: 720, d: 470, h: 440, yaw: 0.03 },
  { name: 'DAEDALUS DRYDOCK', sector: 'DAEDALUS', u: 0.68, z: 90, kind: 'gate', w: 650, d: 470, h: 530, yaw: -0.025 }
]);

const wrapS = (ds, L) => ds - L * Math.round(ds / L);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// hasz [0, 1) z liczby całkowitej i soli (deterministyczny, bez stanu)
export function haloCivicHash(i, salt) {
  let x = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca77)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

// Kontekst rozstawiania obiektów obywatelskich (megabudowle, kopuły): dozwolony
// pas w poprzek (dolna połowa wstęgi), miejsca portu i tranzytów, postawione
// już obiekty (odstępy parków). options.heightAt(theta, t) — wysokość terenu
// [j.] z mapy CPU sprzed placów; bez niej teren płaski i suchy (testy).
export function haloCivicContext(layout, options = {}) {
  const P = HALO_LANDMARK;
  const tz = layout.floor.tangent.z;
  const crosses = layout.z.botIn < -P.planeGap && layout.z.topIn > 0;
  const portOn = layout.sigma > 0 && layout.flightLevel !== 'roof';
  return {
    layout,
    floorMid: layout.radii.floorMid,
    L: layout.circumference,
    tBot: P.wallGap,
    tTop: crosses ? (-P.planeGap - layout.z.botIn) / tz : layout.floor.length - P.wallGap,
    heightAt: typeof options.heightAt === 'function' ? options.heightAt : null,
    sites: portOn ? haloPortSites(layout.radii.floorMid) : [],
    placed: []
  };
}

// Wysokość terenu w punkcie (s, t) z mapy CPU (albo płasko).
export function haloCivicHeight(ctx, s, t) {
  const h = ctx.heightAt ? Number(ctx.heightAt(s / ctx.floorMid, t)) : 20;
  return Number.isFinite(h) ? h : 0;
}

// Najlepsze miejsce w sektorze: kandydaci od preferowanego u w stronę końców
// sektora, w poprzek od preferowanego ułamka dozwolonego pasa; pierwszy suchy
// i płaski wygrywa, inaczej najmniejsza kara. req: sec, uPref, fPref,
// halfA/halfQ (próbkowany obrys), reachA/reachQ (zasięg parku: odstępy),
// maxH (sufit wysokości placu — np. kopuły ze stawem nisko).
export function haloPlaceCivic(ctx, req) {
  const P = HALO_LANDMARK;
  const { floorMid, L } = ctx;
  const tMin = ctx.tBot + req.reachQ;
  const tMax = ctx.tTop - req.reachQ;
  if (!req.sec || tMax < tMin) return null;
  const blocked = (s) => {
    for (const site of ctx.sites) {
      const ds = Math.abs(wrapS(s - site.theta * floorMid, L));
      const gap = site.kind === 'transit' ? site.halfS + P.transitGap : site.halfS + (site.zoneRes || 0) + P.portGap;
      if (ds < gap + req.reachA) return true;
    }
    for (const o of ctx.placed) {
      if (Math.abs(wrapS(s - o.s, L)) < req.reachA + o.reachA + P.spacing) return true;
    }
    return false;
  };
  const sample = (s, t) => {
    const hs = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        hs.push(haloCivicHeight(ctx, s + (i / 5 - 0.5) * 2 * req.halfA, t + (j / 3 - 0.5) * 2 * req.halfQ));
      }
    }
    hs.sort((a, b) => a - b);
    const water = hs.filter((h) => h < 1.5).length / hs.length;
    const relief = hs[Math.floor(hs.length * 0.9)] - hs[Math.floor(hs.length * 0.1)];
    const mid = hs.slice(Math.floor(hs.length * 0.25), Math.ceil(hs.length * 0.75));
    return { water, relief, ground: mid.reduce((a, b) => a + b, 0) / mid.length };
  };
  const us = [];
  for (let k = 0; k <= 44; k++) us.push(0.06 + k * 0.02);
  us.sort((a, b) => Math.abs(a - req.uPref) - Math.abs(b - req.uPref) || a - b);
  const f0 = clamp(req.fPref, 0.1, 0.9);
  const fs = [...new Set([f0, f0 - 0.2, f0 + 0.2, f0 - 0.4, f0 + 0.4, 0.5].map((f) => +clamp(f, 0.05, 0.95).toFixed(3)))];
  const maxH = Number.isFinite(req.maxH) ? req.maxH : Infinity;
  let best = null;
  for (const u of us) {
    const s = (((req.sec.startAngle * floorMid + u * req.sec.length) % L) + L) % L;
    if (blocked(s)) continue;
    for (const f of fs) {
      const t = tMin + (tMax - tMin) * f;
      const site = sample(s, t);
      const high = Math.max(0, site.ground - maxH) / 40;
      const score = site.water * 10 + site.relief / 60 + high + Math.abs(u - req.uPref) * 3 + Math.abs(f - f0) * 0.6;
      if (!best || score < best.score) best = { s, t, u, score, ...site };
      if (site.water === 0 && site.relief < 45 && high === 0) return best;
    }
  }
  return best;
}

// Płyta placu w osiach ringu (bake wycina prostokąt w (s, t)): obrys podium
// po obrocie o yaw, z zapasem na halę wejściową i żebra frontu (~35 j.).
export function haloLandmarkExtent(spec) {
  const P = HALO_LANDMARK;
  const c = Math.abs(Math.cos(spec.yaw || 0));
  const s = Math.abs(Math.sin(spec.yaw || 0));
  const pw = spec.w * 1.045;
  const pd = spec.d * 1.04 + 70;
  const margin = P.plinthMargin + 0.06 * Math.max(spec.w, spec.d);
  return { halfA: 0.5 * (c * pw + s * pd) + margin, halfQ: 0.5 * (s * pw + c * pd) + margin };
}

// Miejsca budowli (i ich parków). options.heightAt jak w haloCivicContext;
// options.ctx — wspólny kontekst z kopułami (odstępy parków).
export function buildHaloLandmarkPlan(layout, options = {}) {
  const P = HALO_LANDMARK;
  const out = [];
  if (!layout?.sectors?.length) return out;
  const ctx = options.ctx || haloCivicContext(layout, options);
  const isCity = (s) => (s.type === 'garden' || s.type === 'glass') && !s.port;
  const perSector = new Map();
  for (const spec of HALO_LANDMARK_SPECS.slice(0, P.maxCount)) {
    let sec = layout.sectors.find((s) => s.name === spec.sector && isCity(s));
    if (!sec) {
      // inny plan sektorów: sektor miasta z najmniejszą liczbą budowli
      for (const s of layout.sectors) {
        if (!isCity(s)) continue;
        if (!sec || (perSector.get(s.index) || 0) < (perSector.get(sec.index) || 0)) sec = s;
      }
    }
    if (!sec) break;
    const ext = haloLandmarkExtent(spec);
    const flatQ = ext.halfQ + P.lawn + P.ramp;
    const parkA = ext.halfA + P.lawn + P.ramp + P.park;
    const best = haloPlaceCivic(ctx, {
      sec, uPref: spec.u, fPref: 0.5 + 0.45 * (spec.z || 0) / 1050,
      halfA: ext.halfA + P.lawn, halfQ: ext.halfQ + P.lawn, reachA: parkA, reachQ: flatQ
    });
    if (!best) continue;
    perSector.set(sec.index, (perSector.get(sec.index) || 0) + 1);
    const index = out.length;
    const plazaH = clamp(best.ground, P.minPlazaH, P.maxPlazaH);
    // park w poprzek w granicach dozwolonego pasa (dolna połowa wstęgi)
    const parkQ = Math.min(flatQ + P.parkQ, best.t - ctx.tBot, ctx.tTop - best.t);
    // staw z boku (po stronie z dala od pawilonów), za frontem — tylko przy
    // niskim terenie: woda w terenie leży na poziomie 0
    const side = index % 2 === 0 ? 1 : -1;
    let pond = null;
    {
      const ra = Math.min(210, 140 + 60 * haloCivicHash(index, 11));
      const rb = 85 + 35 * haloCivicHash(index, 12);
      const da = side * (ext.halfA + P.lawn + 40 + ra);
      const dq = -0.3 * ext.halfQ;
      const ground = haloCivicHeight(ctx, best.s + da, best.t + dq);
      if (plazaH <= P.pondMaxGround && ground <= P.pondMaxGround && Math.abs(da) + ra <= parkA - 40 && Math.abs(dq) + rb <= parkQ) {
        pond = { da, dq, ra, rb };
      }
    }
    // pawilony parku na płaskim trawniku (po stronie przeciwnej do stawu i z tyłu)
    const pavA = -side * (ext.halfA + P.lawn * 0.5);
    const pavilions = [
      { a: pavA, q: 0.35 * ext.halfQ },
      { a: pavA, q: -0.35 * ext.halfQ },
      { a: 0.25 * ext.halfA * side, q: -(ext.halfQ + P.lawn * 0.5) }
    ];
    const lm = {
      index,
      name: spec.name,
      kind: spec.kind,
      sector: sec.index,
      sectorName: sec.name,
      sectorType: sec.type,
      theta: best.s / ctx.floorMid,
      s: best.s,
      t: best.t,
      z: layout.floorZAtT(best.t),
      plazaH,
      yaw: spec.yaw || 0,
      w: spec.w,
      d: spec.d,
      h: spec.h,
      // okna: ciepłe w miastach-ogrodach, chłodne w szklanych
      warm: sec.type !== 'glass',
      plaza: { halfA: ext.halfA, halfQ: ext.halfQ, lawn: P.lawn, ramp: P.ramp },
      park: { halfA: parkA, halfQ: parkQ },
      pond,
      pavilions,
      reachA: parkA,
      reachQ: flatQ
    };
    out.push(lm);
    ctx.placed.push(lm);
  }
  return out;
}

// Pawilon parku (ECUMENE createParks: pokład, 4 słupki, dach) — w układzie
// ringu (bez skrętu budowli), na trawniku placu.
export function haloPavilionParts(boxes, lights, a, q, u0 = 0) {
  boxes.push({ mat: 'stone', a, q, u0, sa: 28, sq: 24, su: 2.4, fixed: true });
  for (const sa of [-1, 1]) {
    for (const sq of [-1, 1]) boxes.push({ mat: 'dark', a: a + sa * 11, q: q + sq * 9, u0: u0 + 2.4, sa: 1.6, sq: 1.6, su: 11, fixed: true });
  }
  boxes.push({ mat: 'garden', a, q, u0: u0 + 13.4, sa: 32, sq: 28, su: 2.2, fixed: true });
  lights.push({ color: 'warm', mode: 'steady', a, q, u: u0 + 11, size: 1.8, phase: 0, fixed: true });
}

// Bryły budowli w jej układzie (a, q, u). box: podstawa na u0, rozmiary
// sa × sq × su; fixed = bez skrętu yaw (płyta placu i park w osiach ringu).
// Światła pozycyjne: czerwone na szczytach (przeszkodowe), ciepłe przy wejściu.
export function haloLandmarkParts(lm) {
  const boxes = [];
  const lights = [];
  const B = HALO_LANDMARK.plinthTop;
  const w = lm.w;
  const d = lm.d;
  const H = lm.h;
  // jak part() w ECUMENE: x wzdłuż, y od podstawy w górę, z w poprzek (front −z)
  const part = (mat, x, y, z, sx, sy, sz) => boxes.push({ mat, a: x, q: -z, u0: B + y, sa: sx, sq: sz, su: sy });
  const lamp = (color, mode, x, y, z, size, phase = 0) => lights.push({ color, mode, a: x, q: -z, u: B + y, size, phase });

  boxes.push({ mat: 'stone', a: 0, q: 0, u0: -HALO_LANDMARK.plinthDepth, sa: 2 * lm.plaza.halfA, sq: 2 * lm.plaza.halfQ,
    su: HALO_LANDMARK.plinthDepth + B, fixed: true });
  // plac: ciemniejszy bruk wokół podium, kwietniki przed wejściem, latarnie
  // wzdłuż frontu placu (światła stałe — architektura, nie ruch)
  part('dark', 0, -1.5, 0, w * 1.16, 2, d * 1.14);
  const front = d * 0.5 + (lm.plaza.halfQ - d * 0.5) * 0.55;
  for (const side of [-1, 1]) {
    part('garden', side * w * 0.3, -2, -front, w * 0.22, 3.5, Math.max(16, (lm.plaza.halfQ - d * 0.5) * 0.45));
  }
  for (let k = -2; k <= 2; k++) lamp('warm', 'steady', k * w * 0.2, 9, -(lm.plaza.halfQ - 12), 2.2);
  // podium: kamień, ciemny pas, płyta
  part('stone', 0, -9, 0, w * 1.045, 38, d * 1.04);
  part('dark', 0, 30, 0, w * 0.95, 19, d * 0.94);
  part('stone', 0, 48, 0, w, 4, d);

  if (lm.kind === 'gate' || lm.kind === 'bridge') {
    const gate = lm.kind === 'gate';
    const towerW = w * (gate ? 0.235 : 0.2);
    const offset = w * 0.345;
    for (const side of [-1, 1]) {
      const x = side * offset;
      part('facade', x, 52, 0, towerW, H * 0.82, d * 0.75);
      part('facade', x, 52 + H * 0.82, 0, towerW * 0.83, H * 0.13, d * 0.67);
      for (const edge of [-1, 1]) part('stone', x + edge * towerW * 0.4, 48, -d * 0.397, 10, H * 0.98, 16);
      part('stone', x, 52 + H * 0.95, 0, towerW * 0.98, 14, d * 0.83);
      part('lamp', x, 52 + H * 0.95 + 14, -d * 0.414, towerW * 0.88, 1.5, 1.7);
      lamp('red', 'pulse', x, 52 + H * 0.95 + 22, 0, 4.0, side > 0 ? 0.5 : 0);
    }
    // mieszkalne mosty między wieżami, z ogrodem na dachu
    for (const ratio of gate ? [0.67, 0.83] : [0.43, 0.77]) {
      const y = 52 + H * ratio;
      const span = w * 0.78;
      part('facade', 0, y, 0, span, H * 0.068, d * 0.51);
      part('stone', 0, y - 8, 0, span * 1.018, 8, d * 0.55);
      part('stone', 0, y + H * 0.068, 0, span * 1.025, 7, d * 0.65);
      part('garden', 0, y + H * 0.068 + 7, 0, span * 0.68, 2, d * 0.38);
      for (let j = -3; j <= 3; j++) part('brass', j * span / 8, y, -d * 0.29, 4, H * 0.068, 5);
    }
    if (!gate) {
      part('facade', 0, 52, 0, w * 0.24, H * 0.25, d * 0.62);
      part('stone', 0, 52 + H * 0.25, 0, w * 0.28, 6, d * 0.72);
    }
  } else if (lm.kind === 'terrace') {
    // zamieszkana „góra” schodkami, ogród na krawędzi każdego tarasu
    for (let level = 0; level < 8; level++) {
      const y = 52 + level * H / 9;
      const ww = w * (0.92 - level * 0.085);
      const dd = d * (0.88 - level * 0.056);
      const z = level * d * 0.027;
      part('facade', 0, y, z, ww, H / 9 + 3, dd);
      part('stone', 0, y + H / 9, z, ww + 10, 5, dd + 9);
      part('garden', 0, y + H / 9 + 5, z - dd * 0.5 + 16, ww * 0.92, 2, 21);
      for (const side of [-1, 1]) part('brass', side * ww * 0.475, y, z - dd * 0.51, 6, H / 9, 5);
      if (level % 2 === 1) for (const side of [-1, 1]) lamp('warm', 'steady', side * ww * 0.42, y + H / 9 + 8, z - dd * 0.5 - 4, 2.4);
    }
    for (const side of [-1, 1]) part('stone', side * w * 0.4, 48, d * 0.1, 15, H * 0.35, d * 0.63);
    lamp('red', 'pulse', 0, 52 + 8 * H / 9 + 12, 7 * d * 0.027, 4.0);
  } else {
    // trzy połączone, zwężające się rdzenie z masztami (iglica obywatelska)
    for (let core = 0; core < 3; core++) {
      const x = (core - 1) * w * 0.245;
      const z = core === 1 ? d * 0.11 : -d * 0.14;
      const h = H * (core === 1 ? 1 : 0.78);
      const ww = w * (core === 1 ? 0.36 : 0.285);
      for (let step = 0; step < 5; step++) {
        const y = 52 + step * h / 5;
        const sx = ww * (1 - step * 0.13);
        const sz = d * (0.55 - step * 0.065);
        part('facade', x, y, z, sx, h / 5, sz);
        part('stone', x, y + h / 5, z, sx * 1.06, 5, sz * 1.06);
      }
      const mast = core === 1 ? 80 : 35;
      part('brass', x, 52 + h, z, 6, mast, 6);
      part('lamp', x, 52 + h + mast, z, 3, 4, 3);
      lamp('red', 'pulse', x, 52 + h + mast + 8, z, 3.6, core * 0.33);
    }
    part('facade', 0, 52 + H * 0.45, 0, w * 0.79, H * 0.055, d * 0.62);
    part('stone', 0, 52 + H * 0.505, 0, w * 0.82, 6, d * 0.67);
  }
  // żebra serwisowe i hala wejściowa od frontu, oświetlona
  for (let i = -3; i <= 3; i++) part('stone', i * w / 8, 4, -d * 0.505, 9, 47, 28);
  part('facade', 0, 7, -d * 0.515, w * 0.23, 25, 32);
  part('lamp', 0, 33, -d * 0.535, w * 0.22, 1.1, 2);
  for (const side of [-1, 1]) lamp('warm', 'steady', side * w * 0.13, 38, -d * 0.55, 3.0);
  // pawilony parku na trawniku placu (poziom placu: u = 0)
  for (const p of lm.pavilions || []) haloPavilionParts(boxes, lights, p.a, p.q, 0);
  return { boxes, lights };
}

// Kąt → indeks segmentu dachu (plan dachu grupuje instancje po segmentach).
export function haloLandmarkSegment(lm, segCount) {
  const th = ((lm.theta % HALO_TAU) + HALO_TAU) % HALO_TAU;
  return Math.floor(th / (HALO_TAU / segCount)) % segCount;
}
