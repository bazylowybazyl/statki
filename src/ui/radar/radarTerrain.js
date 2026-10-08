// src/ui/radar/radarTerrain.js
//
// Podkład tarczy radaru: echa „lądu” i budowli liczone RZADKO (co ~1 s albo po przesunięciu okrętu)
// do płótna w orientacji świata, wycentrowanego na okręcie w chwili wypieku. Tarcza rysuje je co klatkę
// z obrotem (H-UP) i przesunięciem o drogę okrętu od wypieku — obrót okrętu nic nie kosztuje.
//
// Zawartość (jak ląd i zabudowa na radarze morskim — wypełnienie z ziarnem, jaśniejsza krawędź od strony
// anteny):
//  - planety i słońce: tarcza z ziarnem, brzeg (limb) jaśniejszy od strony okrętu;
//  - ring „Halo”: płyta [kadłub ringu … podłoga] z 4 lukami tranzytów, ściany i pylony doków K-7
//    (te same wielokąty co kolizje — HaloRingCollider.wallItems);
//  - pas asteroid: CLUTTER — drobnica jako ziarno o gęstości z pola (AsteroidBeltField.sampleMacro,
//    ziarno zakotwiczone w siatce świata — nie migocze przy przeliczeniu), pojedyncze skały powyżej
//    rozdzielczości tarczy (forEachRockInRect), OLBRZYMY z przekroju SDF z = 0 (to, w co się uderza);
//  - stacje: obrys (koło) albo prawdziwe bryły (suchy dok piratów — hitShapes, bez odpadłych kawałków).
// Wypiek etapami (najwyżej jeden ciężki etap na klatkę) do bufora tylnego, potem zamiana — bez szarpnięć.

import { RADAR_TUNE, RADAR_RGB } from './radarConfig.js';
import { radarColor } from './radarSymbols.js';
import { haloLocalToGame } from '../../game/haloRingPlanets.js';

const TAU = Math.PI * 2;
const BELT_PLAY = 0;
const STAGES = Object.freeze(['setup', 'belt', 'rocks', 'giants', 'land', 'swap']);

function makeLayer() {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  return {
    canvas,
    ctx: canvas ? canvas.getContext('2d') : null,
    size: 0, ax: 0, ay: 0, k: 1, range: 0,
    valid: false, renderedAt: -1e9, sig: '',
    // ile rzeczy narysowano (0 — pusty podkład: tarcza pomija jego rysowanie i poświatę)
    drawn: 0
  };
}

// Hasz 32-bit punktu siatki — ziarno clutteru stałe w świecie. Współrzędne mnożone OSOBNO przed
// mieszaniem (wersja z a ^ b na wejściu zależała tylko od a ^ b — rysowała w szumie wzór krat).
function hash2(a, b, c) {
  let h = Math.imul(a | 0, 0x8DA6B343) ^ Math.imul(b | 0, 0xD8163841) ^ Math.imul(c | 0, 0xCB1AB31F);
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
  h ^= h >>> 16;
  return h >>> 0;
}

let _rockDot = null;
function rockDot() {
  if (_rockDot || typeof document === 'undefined') return _rockDot;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, radarColor(RADAR_RGB.rock, 1));
  grad.addColorStop(0.55, radarColor(RADAR_RGB.rock, 0.7));
  grad.addColorStop(0.74, radarColor(RADAR_RGB.rock, 0.25));
  grad.addColorStop(1, radarColor(RADAR_RGB.rock, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  _rockDot = c;
  return c;
}

let _grain = null;
function grainCanvas() {
  if (_grain || typeof document === 'undefined') return _grain;
  const n = 96;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const h = hash2(i, 7, 0x51ED);
    const u = (h & 0xffff) / 65535;
    const v = (h >>> 16) / 65535;
    const a = u > 0.62 ? 90 + 165 * v : u > 0.35 ? 40 * v : 0;
    img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  _grain = c;
  return c;
}

function entityX(e) { return Number.isFinite(e?.x) ? e.x : (Number(e?.pos?.x) || 0); }
function entityY(e) { return Number.isFinite(e?.y) ? e.y : (Number(e?.pos?.y) || 0); }

// Wielokąty ścian portu w układzie lokalnym ringu — raz na kolidera (planeta się przesuwa, ring nie).
const _ringLocalCache = new WeakMap();
function ringLocalWalls(collider) {
  let cached = _ringLocalCache.get(collider);
  if (cached) return cached;
  cached = [];
  const f = collider?.frame;
  const items = collider?.wallItems || collider?.walls?.items || [];
  if (f) {
    for (const it of items) {
      const poly = it.polygon;
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const pts = new Float64Array(poly.length * 2);
      for (let i = 0; i < poly.length; i++) {
        const hx = poly[i].x;
        const hz = poly[i].z;
        pts[i * 2] = f.origin.x + hx * f.tx + hz * f.rx;
        pts[i * 2 + 1] = f.origin.y + hx * f.ty + hz * f.ry;
      }
      cached.push(pts);
    }
  }
  _ringLocalCache.set(collider, cached);
  return cached;
}

export function createRadarTerrain(tune = RADAR_TUNE) {
  let front = makeLayer();
  let back = makeLayer();
  const job = { active: false, stage: 0, view: null, x0: 0, y0: 0, x1: 0, y1: 0, T: 0, k: 1 };
  const clutter = { canvas: null, ctx: null, img: null, w: 0, h: 0 };
  const grid = { n: 0, d: new Float32Array(0), c: new Float32Array(0) };
  const rockBuf = { x: new Float64Array(4096), y: new Float64Array(4096), r: new Float32Array(4096), n: 0, dMin: 0, over: false };
  const giantCache = new WeakMap();   // olbrzym → { k, canvas, x0, y0 }
  let lastSigAt = -1e9;
  let lastSig = '';
  const stats = { renders: 0, lastMs: 0, rocks: 0, clutterPx: 0 };
  const _pt = { x: 0, y: 0 };

  function signature(world) {
    let s = '';
    const st = world?.stations;
    if (Array.isArray(st)) {
      let alive = 0;
      let gone = 0;
      for (let i = 0; i < st.length; i++) {
        const e = st[i];
        if (!e || e._destroyed3D || e.destroyed || e.dead) continue;
        alive++;
        if (e._dockGone?.size) gone += e._dockGone.size;
      }
      s += alive + ':' + gone;
    }
    const giants = world?.belt?.giants?.entries;
    if (Array.isArray(giants)) {
      let ready = 0;
      for (const e of giants) if (e?.giant?.ready) ready++;
      s += '|g' + ready;
    }
    const rings = world?.rings;
    if (Array.isArray(rings)) s += '|r' + rings.length;
    return s;
  }

  function wantsRender(view) {
    const T = Math.max(16, Math.ceil(view.R * 2 * 1.22));
    if (job.active) return false;
    if (!front.valid) return true;
    if (Math.abs(T - front.size) > 2) return true;
    if (view.settled && Math.abs(view.k - front.k) > front.k * 0.015) return true;
    const dx = view.ox - front.ax;
    const dy = view.oy - front.ay;
    if (dx * dx + dy * dy > (tune.terrainMoveFrac * view.range) ** 2) return true;
    if (view.time - front.renderedAt > tune.terrainRefreshSec) return true;
    if (view.time - lastSigAt > 0.25) {
      lastSigAt = view.time;
      const sig = signature(view.world);
      if (sig !== lastSig) { lastSig = sig; return true; }
    }
    return false;
  }

  function begin(view) {
    const T = Math.max(16, Math.ceil(view.R * 2 * 1.22));
    job.active = true;
    job.stage = 0;
    job.view = view;
    job.T = T;
    job.k = view.k;
    job.ax = view.ox;
    job.ay = view.oy;
    const half = T / 2 / view.k;
    job.x0 = view.ox - half; job.x1 = view.ox + half;
    job.y0 = view.oy - half; job.y1 = view.oy + half;
    job.world = view.world;
    job.t0 = 0;
    job.ms = 0;
  }

  function toPx(x, y, out) {
    out.x = job.T / 2 + (x - job.ax) * job.k;
    out.y = job.T / 2 + (y - job.ay) * job.k;
    return out;
  }

  // ---------------------------------------------------------------- etapy
  function stageSetup() {
    const L = back;
    if (!L.canvas) return;
    if (L.canvas.width !== job.T || L.canvas.height !== job.T) {
      L.canvas.width = job.T;
      L.canvas.height = job.T;
    } else {
      L.ctx.setTransform(1, 0, 0, 1, 0, 0);
      L.ctx.clearRect(0, 0, job.T, job.T);
    }
    L.size = job.T;
    L.ax = job.ax; L.ay = job.ay; L.k = job.k;
    L.drawn = 0;
  }

  // Clutter pasa: piksel = komórka siatki świata (rozmiar 2 px tarczy), szansa echa z gęstości pola.
  function stageBelt() {
    const field = job.world?.belt?.field;
    if (!field || !field.rectTouchesBelt?.(job.x0, job.y0, job.x1, job.y1)) { stats.clutterPx = 0; return; }
    // piksel clutteru = 2 px tarczy (na dużych ekranach więcej — najwyżej ~250² pikseli na wypiek)
    const cellPx = Math.max(2, job.T / 250);
    const cw = cellPx / job.k;                  // jednostki świata na piksel clutteru
    const gx0 = Math.floor(job.x0 / cw);
    const gy0 = Math.floor(job.y0 / cw);
    const w = Math.ceil((job.x1 - job.x0) / cw) + 2;
    const h = Math.ceil((job.y1 - job.y0) / cw) + 2;
    if (!clutter.canvas) {
      clutter.canvas = document.createElement('canvas');
      clutter.ctx = clutter.canvas.getContext('2d');
    }
    if (clutter.w !== w || clutter.h !== h) {
      clutter.canvas.width = w; clutter.canvas.height = h;
      clutter.w = w; clutter.h = h;
      clutter.img = clutter.ctx.createImageData(w, h);
    }
    // Gęstość: siatka zgrubna (pole pasa zmienia się na ~240 tys. j.), dwuliniowo na piksele.
    const G = 20;
    const n1 = G + 1;
    if (grid.n !== n1) { grid.n = n1; grid.d = new Float32Array(n1 * n1); grid.c = new Float32Array(n1 * n1); }
    const spanX = (w * cw);
    const spanY = (h * cw);
    const bx = gx0 * cw;
    const by = gy0 * cw;
    let any = false;
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) {
        const m = field.sampleMacro(bx + spanX * i / G, by + spanY * j / G);
        grid.d[j * n1 + i] = m.density;
        grid.c[j * n1 + i] = m.cluster;
        if (m.density > 0) any = true;
      }
    }
    const data = clutter.img.data;
    if (!any) { data.fill(0); stats.clutterPx = 0; return; }
    const area = cw * cw * tune.clutterGain;
    const [cr, cg, cb] = RADAR_RGB.clutter.split(',').map(Number);
    let lit = 0;
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * G;
      const jy = Math.min(G - 1, fy | 0);
      const ty = fy - jy;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * G;
        const ix = Math.min(G - 1, fx | 0);
        const tx = fx - ix;
        const o = jy * n1 + ix;
        const d0 = grid.d[o] + (grid.d[o + 1] - grid.d[o]) * tx;
        const d1 = grid.d[o + n1] + (grid.d[o + n1 + 1] - grid.d[o + n1]) * tx;
        const d = d0 + (d1 - d0) * ty;
        const p = (y * w + x) * 4;
        if (!(d > 0)) { data[p + 3] = 0; continue; }
        const lambda = d * area;
        const prob = 1 - Math.exp(-lambda);
        const hsh = hash2(gx0 + x, gy0 + y, 0x7A57);
        const u = (hsh & 0xffff) / 65535;
        let a = Math.min(0.16, lambda * 0.22);   // rozmyta mgiełka gęstego pola
        if (u < prob) {
          a += 0.22 + 0.5 * ((hsh >>> 16) / 65535);
          lit++;
        }
        data[p] = cr; data[p + 1] = cg; data[p + 2] = cb;
        data[p + 3] = Math.min(255, a * 150) | 0;
      }
    }
    clutter.ctx.putImageData(clutter.img, 0, 0);
    stats.clutterPx = lit;
    back.drawn++;
    const L = back;
    const px = (bx - job.x0) * job.k;
    const py = (by - job.y0) * job.k;
    L.ctx.save();
    L.ctx.imageSmoothingEnabled = true;
    L.ctx.globalCompositeOperation = 'lighter';
    L.ctx.drawImage(clutter.canvas, px, py, w * cellPx, h * cellPx);
    L.ctx.restore();
  }

  // Pojedyncze skały powyżej rozdzielczości tarczy.
  function stageRocks() {
    const field = job.world?.belt?.field;
    rockBuf.n = 0;
    if (!field || !field.forEachRockInRect || !field.rectTouchesBelt?.(job.x0, job.y0, job.x1, job.y1)) { stats.rocks = 0; return; }
    // Skały to informacja (górnictwo), nie przeszkoda — małe nie kolidują, przeszkodą są olbrzymy. Na tarczy
    // pojedynczo tylko duże (≥ 700 j. i ≥ ~5 px), resztę niesie clutter.
    let dMin = Math.max(700, (tune.rockMinPx * 5.5) / job.k);
    if (rockBuf.over && rockBuf.dMin > 0) dMin = Math.max(dMin, rockBuf.dMin * 1.4);
    const cap = Math.min(rockBuf.x.length, tune.rockMaxDraw);
    let n = 0;
    let over = false;
    field.forEachRockInRect(BELT_PLAY, job.x0, job.y0, job.x1, job.y1, dMin, (rock) => {
      if (n >= cap) { over = true; return; }
      rockBuf.x[n] = rock.x;
      rockBuf.y[n] = rock.y;
      rockBuf.r[n] = rock.r;
      n++;
    });
    rockBuf.n = n;
    rockBuf.dMin = dMin;
    rockBuf.over = over;
    stats.rocks = n;
    if (!n) return;
    back.drawn += n;
    const g = back.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const k = job.k;
    const dot = rockDot();
    for (let i = 0; i < n; i++) {
      const px = job.T / 2 + (rockBuf.x[i] - job.ax) * k;
      const py = job.T / 2 + (rockBuf.y[i] - job.ay) * k;
      const r = Math.max(tune.rockMinPx, rockBuf.r[i] * k * 0.85);
      // miękka kropla (echo skały), duże z cienkim brzegiem
      g.globalAlpha = r >= 4 ? 0.34 : 0.26;
      if (dot) g.drawImage(dot, px - r * 1.35, py - r * 1.35, r * 2.7, r * 2.7);
      if (r >= 5) {
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(px, py, r, 0, TAU);
        g.lineWidth = Math.max(0.7, Math.min(1.4, r * 0.1));
        g.strokeStyle = radarColor(RADAR_RGB.rock, 0.22);
        g.stroke();
      }
    }
    g.restore();
  }

  // Olbrzymy: przekrój z = 0 siatki SDF (gotowej) albo elipsa obrysu (przed budową).
  function stageGiants() {
    const entries = job.world?.belt?.giants?.entries;
    if (!Array.isArray(entries) || !entries.length) return;
    const g = back.ctx;
    for (const e of entries) {
      if (!e) continue;
      const hx = Number(e.halfX) || 0;
      const hy = Number(e.halfY) || 0;
      if (e.x + hx < job.x0 || e.x - hx > job.x1 || e.y + hy < job.y0 || e.y - hy > job.y1) continue;
      back.drawn++;
      const giant = e.giant && e.giant.ready ? e.giant : null;
      if (giant) {
        const tile = giantTile(e, giant);
        if (tile) {
          g.save();
          g.imageSmoothingEnabled = true;
          g.globalCompositeOperation = 'lighter';
          g.drawImage(tile.canvas, job.T / 2 + (tile.x0 - job.ax) * job.k, job.T / 2 + (tile.y0 - job.ay) * job.k,
            tile.w * tile.step * job.k, tile.h * tile.step * job.k);
          g.restore();
          continue;
        }
      }
      toPx(e.x, e.y, _pt);
      g.save();
      g.translate(_pt.x, _pt.y);
      g.scale(hx * job.k, hy * job.k);
      g.beginPath();
      g.arc(0, 0, 0.82, 0, TAU);
      g.restore();
      g.fillStyle = radarColor(RADAR_RGB.land, 0.18);
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = radarColor(RADAR_RGB.landHot, 0.55);
      g.stroke();
    }
  }

  // Raster przekroju olbrzyma (w siatce świata — nie zależy od okrętu), pamięć na skalę.
  function giantTile(e, giant) {
    let tile = giantCache.get(giant);
    const voxel = Number(giant.plan?.voxel) || 100;
    const step = Math.max(voxel, 1.6 / job.k);
    if (tile && Math.abs(tile.step - step) <= step * 0.2) return tile;
    const hx = (giant.plan?.half?.[0] || e.halfX) + giant.band;
    const hy = (giant.plan?.half?.[1] || e.halfY) + giant.band;
    const w = Math.ceil((hx * 2) / step) + 1;
    const h = Math.ceil((hy * 2) / step) + 1;
    if (w * h > 260000) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    const img = c.createImageData(w, h);
    const data = img.data;
    const [lr, lg, lb] = RADAR_RGB.land.split(',').map(Number);
    const [hr, hg, hb] = RADAR_RGB.landHot.split(',').map(Number);
    const x0 = giant.x - hx;
    const y0 = giant.y - hy;
    const edge = step * 1.2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const sdf = giant.sampleWorld(x0 + i * step, y0 + j * step, 0);
        const p = (j * w + i) * 4;
        if (sdf >= edge) { data[p + 3] = 0; continue; }
        if (sdf > -edge) {
          // brzeg skały — najjaśniejsze echo
          const t = 1 - Math.abs(sdf) / edge;
          data[p] = hr; data[p + 1] = hg; data[p + 2] = hb;
          data[p + 3] = (90 + 150 * t) | 0;
        } else {
          const hsh = hash2(i + Math.round(x0 / step), j + Math.round(y0 / step), 0x61A7);
          const n = (hsh & 0xff) / 255;
          data[p] = lr; data[p + 1] = lg; data[p + 2] = lb;
          data[p + 3] = (34 + 46 * n) | 0;
        }
      }
    }
    c.putImageData(img, 0, 0);
    tile = { canvas, x0, y0, w, h, step };
    giantCache.set(giant, tile);
    return tile;
  }

  function landFill(g, alpha) {
    g.fillStyle = radarColor(RADAR_RGB.land, alpha);
    g.fill();
    const grain = grainCanvas();
    if (grain) {
      const pat = g.createPattern(grain, 'repeat');
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') {
        // Ziarno zakotwiczone w świecie (nie pływa przy przeliczeniu podkładu).
        const off = 96;
        const ox = -(((job.ax * job.k) % off) + off) % off;
        const oy = -(((job.ay * job.k) % off) + off) % off;
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
      }
      g.save();
      g.globalAlpha = 0.16;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = pat;
      g.fill();
      g.restore();
    }
  }

  // Brzeg lądu: jaśniej od strony anteny (okrętu), słabiej po drugiej stronie.
  function limbStroke(g, cx, cy, r, width) {
    const dx = cx - job.T / 2;
    const dy = cy - job.T / 2;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const grad = g.createLinearGradient(cx - ux * r, cy - uy * r, cx + ux * r, cy + uy * r);
    grad.addColorStop(0, radarColor(RADAR_RGB.landHot, 0.95));
    grad.addColorStop(0.45, radarColor(RADAR_RGB.land, 0.55));
    grad.addColorStop(1, radarColor(RADAR_RGB.land, 0.16));
    g.lineWidth = width;
    g.strokeStyle = grad;
    g.stroke();
  }

  function stageLand() {
    const g = back.ctx;
    const world = job.world || {};
    const T = job.T;
    const k = job.k;
    const margin = T * 0.75;
    // planety i słońce
    const features = Array.isArray(world.features) ? world.features : [];
    for (const f of features) {
      if (!f) continue;
      const ent = f.entity || f;
      const r = Math.max(0, Number(f.radius) || 0) * k;
      if (r < 0.6) continue;
      toPx(entityX(ent), entityY(ent), _pt);
      if (_pt.x + r < -margin || _pt.x - r > T + margin || _pt.y + r < -margin || _pt.y - r > T + margin) continue;
      const sun = f.type === 'sun' || f.id === 'sun';
      back.drawn++;
      g.beginPath();
      g.arc(_pt.x, _pt.y, r, 0, TAU);
      landFill(g, sun ? 0.2 : 0.1);
      g.beginPath();
      g.arc(_pt.x, _pt.y, r, 0, TAU);
      limbStroke(g, _pt.x, _pt.y, r, Math.max(1.1, Math.min(3, r * 0.02)));
    }
    // ring „Halo”: płyta między kadłubem a podłogą, luki tranzytów, ściany portu
    const rings = Array.isArray(world.rings) ? world.rings : [];
    for (const entry of rings) {
      const col = entry?.collider;
      const place = col?.place;
      if (!place) continue;
      const pl = entry.planet || null;
      const px = Number.isFinite(pl?.x) ? pl.x : place.x;
      const py = Number.isFinite(pl?.y) ? pl.y : place.y;
      const rBack = Number(col.back) || 0;
      const floor = Number(col.floorMid) || 0;
      if (!(floor > rBack && rBack > 0)) continue;
      toPx(px, py, _pt);
      const rOut = floor * k;
      const rIn = rBack * k;
      const dc = Math.hypot(_pt.x - T / 2, _pt.y - T / 2);
      if (dc - rOut > T * 0.8 || rIn - dc > T * 0.8) continue;
      back.drawn++;
      // luki: kąty świata gry (lokalny ring → gra: −(t + rot))
      const half = Number(col.transitHalf) || 0;
      const angles = (col.transitAngles || []).map((t) => normA(-(t + (place.rot || 0)))).sort((a, b) => a - b);
      g.beginPath();
      if (angles.length && half > 0) {
        for (let i = 0; i < angles.length; i++) {
          const a0 = angles[i] + half;
          const a1 = (i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU) - half;
          if (a1 <= a0) continue;
          g.moveTo(_pt.x + Math.cos(a0) * rOut, _pt.y + Math.sin(a0) * rOut);
          g.arc(_pt.x, _pt.y, rOut, a0, a1);
          g.arc(_pt.x, _pt.y, rIn, a1, a0, true);
          g.closePath();
        }
      } else {
        g.arc(_pt.x, _pt.y, rOut, 0, TAU);
        g.moveTo(_pt.x + rIn, _pt.y);
        g.arc(_pt.x, _pt.y, rIn, 0, TAU, true);
      }
      landFill(g, 0.24);
      g.lineWidth = Math.max(1.1, 1.4 * (job.view.u || 1));
      g.strokeStyle = radarColor(RADAR_RGB.landHot, 0.85);
      g.stroke();
      // ściany i pylony portu (hale K-7, zatoki, tunele tranzytów)
      const walls = ringLocalWalls(col);
      if (walls.length) {
        const pc = { x: px, y: py, cos: place.cos, sin: place.sin };
        g.beginPath();
        for (const pts of walls) {
          for (let i = 0; i < pts.length; i += 2) {
            haloLocalToGame(pc, pts[i], pts[i + 1], _pt);
            const sx = T / 2 + (_pt.x - job.ax) * k;
            const sy = T / 2 + (_pt.y - job.ay) * k;
            if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
          }
          g.closePath();
        }
        g.fillStyle = radarColor(RADAR_RGB.structure, 0.42);
        g.fill();
        g.lineWidth = Math.max(0.8, 1.0 * (job.view.u || 1));
        g.strokeStyle = radarColor(RADAR_RGB.structure, 0.9);
        g.stroke();
      }
    }
    // stacje i budowle
    const stations = Array.isArray(world.stations) ? world.stations : [];
    for (const st of stations) {
      if (!st || st._destroyed3D || st.destroyed || st.dead || st.ringPort) continue;
      const sx = entityX(st);
      const sy = entityY(st);
      const shapes = Array.isArray(st.hitShapes) ? st.hitShapes : null;
      if (shapes) {
        if (st.x + (st.radius || 6000) < job.x0 || st.x - (st.radius || 6000) > job.x1
          || st.y + (st.radius || 6000) < job.y0 || st.y - (st.radius || 6000) > job.y1) continue;
        back.drawn++;
        const gone = st._dockGone;
        g.beginPath();
        for (const s of shapes) {
          if (!s?.pts || (gone && gone.has?.(s.chunk))) continue;
          if (s.x1 < job.x0 || s.x0 > job.x1 || s.y1 < job.y0 || s.y0 > job.y1) continue;
          for (let i = 0; i < s.pts.length; i++) {
            const p = s.pts[i];
            const px2 = T / 2 + (p.x - job.ax) * k;
            const py2 = T / 2 + (p.y - job.ay) * k;
            if (i === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
          }
          g.closePath();
        }
        g.fillStyle = radarColor(RADAR_RGB.structure, 0.46);
        g.fill();
        g.lineWidth = Math.max(0.8, 0.9 * (job.view.u || 1));
        g.strokeStyle = radarColor(RADAR_RGB.structure, 0.95);
        g.stroke();
        const halls = Array.isArray(st.hallShapes) ? st.hallShapes : null;
        if (halls) {
          g.beginPath();
          for (const s of halls) {
            if (!s?.pts) continue;
            for (let i = 0; i < s.pts.length; i++) {
              const p = s.pts[i];
              const px2 = T / 2 + (p.x - job.ax) * k;
              const py2 = T / 2 + (p.y - job.ay) * k;
              if (i === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
            }
            g.closePath();
          }
          g.fillStyle = radarColor(RADAR_RGB.structure, 0.12);
          g.fill();
        }
        continue;
      }
      const r = Math.max(40, Number(st.r) || Number(st.radius) || Number(st.baseR) || 120) * k;
      if (r < 0.8) continue;
      toPx(sx, sy, _pt);
      if (_pt.x + r < 0 || _pt.x - r > T || _pt.y + r < 0 || _pt.y - r > T) continue;
      back.drawn++;
      g.beginPath();
      g.arc(_pt.x, _pt.y, r, 0, TAU);
      g.fillStyle = radarColor(RADAR_RGB.structure, 0.36);
      g.fill();
      g.lineWidth = Math.max(0.8, Math.min(2.2, r * 0.12));
      g.strokeStyle = radarColor(RADAR_RGB.structure, 0.92);
      g.stroke();
    }
  }

  function normA(a) {
    let r = a % TAU;
    if (r < 0) r += TAU;
    return r;
  }

  function runStage(name) {
    switch (name) {
      case 'setup': stageSetup(); break;
      case 'belt': stageBelt(); break;
      case 'rocks': stageRocks(); break;
      case 'giants': stageGiants(); break;
      case 'land': stageLand(); break;
      case 'swap': {
        back.valid = true;
        back.renderedAt = job.view.time;
        back.range = job.view.range;
        const t = front; front = back; back = t;
        job.active = false;
        stats.renders++;
        break;
      }
      default: break;
    }
  }

  return {
    stats,
    get layer() { return front; },
    invalidate() { front.valid = false; lastSig = ''; },
    /**
     * view: { time, ox, oy, range, k, R, u, settled, world, budgetMs? }. Zaczyna wypiek, gdy trzeba,
     * i robi kolejne etapy (lekkie razem, ciężkie po jednym na wywołanie). Pierwszy wypiek — cały naraz.
     */
    update(view) {
      if (!back.canvas) return false;
      if (!job.active && wantsRender(view)) begin(view);
      if (!job.active) return false;
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const firstEver = !front.valid;
      do {
        const name = STAGES[job.stage++];
        runStage(name);
        if (!job.active) break;
        const heavy = STAGES[job.stage] === 'belt' || STAGES[job.stage] === 'rocks' || STAGES[job.stage] === 'giants';
        if (heavy && !firstEver && name !== 'setup') break;
      } while (job.active);
      if (typeof performance !== 'undefined') stats.lastMs = performance.now() - t0;
      return true;
    },
    /** Rysuje podkład w układzie tarczy (θ — obrót świat → tarcza, k — px na jednostkę). */
    draw(ctx, cx, cy, theta, ox, oy, k, alpha = 1) {
      const L = front;
      if (!L.valid || !L.canvas) return false;
      const s = k / L.k;
      ctx.save();
      ctx.translate(cx, cy);
      if (theta) ctx.rotate(theta);
      ctx.scale(s, s);
      ctx.translate((L.ax - ox) * L.k, (L.ay - oy) * L.k);
      ctx.globalAlpha = alpha;
      ctx.drawImage(L.canvas, -L.size / 2, -L.size / 2);
      ctx.restore();
      return true;
    }
  };
}
