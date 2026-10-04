// src/3d/ships3d/ships/fleetHull3D.js
//
// MODELE 3D KADŁUBÓW FLOTY — Terra Nova (pancernik Bellator, niszczyciel Hasta, fregata
// Custos) i piraci (pancernik Iron Skull, niszczyciel, fregata). Ten sam przepis co Atlas
// (atlasHull3D.js): obrys i rysunek sprite'a gry, gniazda z edytora, mostki gry.
// Demo: dema/atlas3d-webgpu.html (tryb „Flota”), opis: docs/webgpu/DEMO-ATLAS-3D.md.
//
// UKŁAD jak Atlas i warstwa 3D gry (Core3D): X ku dziobowi, Y = −y obrazka, Z w górę.
// Projekt w PIKSELACH sprite'a (środek płótna = 0), wynik × scale = getHullRenderSize(profil).w /
// szerokość płótna (ta sama skala co __hardpointScaleX NPC) — kadłub zajmuje w grze miejsce
// sprite'a. Wysokości w specyfikacji (fleetHulls3D.js) w jednostkach `hu` (px sprite'a na
// 1% szerokości kadłuba) — okręty różnej rozdzielczości mają te same proporcje.
//
// SKŁADNIKI:
//  - płyta kadłuba z obrysu alfy (fleetOutlines3D.js, generator scripts/webgpu/obrysy-floty.mjs):
//    pas burtowy → pokład, z dziurami (prześwity między skrzydłami a kręgosłupem pancernika);
//  - kil: pochyłe burty dolne do obrysu ściśniętego ku osi (keel.s) i dno z profilem głębokości;
//  - gondole silników: walce z rysunkiem sprite'a (materiał pokładu), z tyłu dysza z żarem;
//  - kolce (piraci): ostrosłupy grzbietowe z rysunkiem sprite'a;
//  - bryły nadbudówek ze specyfikacji (wielokąty w px OBRAZKA — jak edytor gniazd, y w dół);
//  - mostek gry (bridge3DShapes.js) na strefie mostka, gniazda broni (barbety) z edytora,
//    światła pozycyjne i dysze RCS z edytora.
// Dachy wszystkich brył mają materiał POKŁADU (rzut sprite'a z góry): z góry model = sprite.
// Każda bryła jest zamknięta (sama albo razem z płytą, w którą wchodzi) — wokselizacja.

import { MeshBuilder3D, SHIP3D_MAT as M, ensureCCW, pointInPoly, v3 } from '../meshBuilder3D.js';
import { FLEET3D_OUTLINES } from './fleetOutlines3D.js';
import { FLEET3D_SPECS, FLEET3D_PALETTES, fleetClipKey } from './fleetHulls3D.js';
import { SHIP_EDITOR_DEFAULTS } from '../../../data/hardpointEditorDefaults.js';
import { getHullRenderSize } from '../../../data/ships.js';
import { buildBridgeModel, BRIDGE3D_KINDS, BRIDGE3D_MAT, BRIDGE3D_EMIT } from '../../../3d/bridge3DShapes.js';

export { FLEET3D_SPECS };
export const FLEET3D_IDS = Object.freeze(Object.keys(FLEET3D_SPECS));

// Promień barbety (świat, klasa Capital) — ~0,86 Atlasa (MOUNT_RADIUS × ATLAS3D_SCALE); na
// mniejszych kadłubach × skala wieży klasy (WEAPON_TIER_SCALE.turret).
const MOUNT_R_WORLD = { main: 14, special: 19, aux: 6.6, missile: 12.6, special_missile: 17, builtin: 0, hangar: 0 };
const TIER_TURRET = { S: 0.5, M: 0.7, L: 0.88, Capital: 1 };

/** Skala świata na px sprite'a (jak __hardpointScaleX NPC). */
export function fleetHullScale(id) {
  const spec = FLEET3D_SPECS[id];
  const out = FLEET3D_OUTLINES[spec?.outlineOf || id];
  if (!spec || !out) throw new Error(`nieznany kadłub floty: ${id}`);
  const size = getHullRenderSize(spec.profile, out.sprite[0], out.sprite[1]);
  return size.w / out.sprite[0];
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

/** Profil liniowy w x (węzły xs, wartości zs) — kil. */
function profile(xs, zs) {
  return (x) => {
    if (x <= xs[0]) return zs[0];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return zs[i - 1] + (zs[i] - zs[i - 1]) * t;
      }
    }
    return zs[zs.length - 1];
  };
}

/** Pętla z wstawionymi wierzchołkami na prostych x = xs (węzły profilu kila). */
function insertBreaksLoop(ring, xs) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    const cuts = xs.filter((x) => x > lo + 1e-6 && x < hi - 1e-6).sort((p, q) => (b[0] > a[0] ? p - q : q - p));
    for (const x of cuts) {
      const t = (x - a[0]) / (b[0] - a[0]);
      out.push([x, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Połowa wielokąta (px obrazka, od rufy do dziobu po stronie y ≤ oś) → pełny wielokąt z lustrem. */
function mirrorHalfImg(half, axisY) {
  const other = half.slice().reverse().map(([x, y]) => [x, 2 * axisY - y]);
  const out = [];
  for (const p of half.concat(other)) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

/** Przecięcia prostej pionowej x z pętlą (wartości y). */
function crossingsAtX(ring, x) {
  const ys = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
      ys.push(a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0])));
    }
  }
  return ys;
}

// ---------------------------------------------------------------------------
// Budowa
// ---------------------------------------------------------------------------

/**
 * Buduje model kadłuba floty. Wynik jak buildAtlasHull3D: budowniczy (geometria w px sprite'a,
 * toGeometry(THREE, scale)) i dane w jednostkach ŚWIATA (× scale), układ Core3D.
 * @param {string} id terran_battleship | terran_destroyer | terran_frigate | pirate_battleship | pirate_destroyer | pirate_frigate
 * @param {object} [o]
 * @param {boolean} [o.bridges=true] mostek gry (bridge3DShapes)
 * @param {number} [o.bridgeZScale] podbicie wysokości mostka (w grze płaski — kamera z góry)
 */
export function buildFleetHull3D(id, o = {}) {
  const spec = FLEET3D_SPECS[id];
  const out = FLEET3D_OUTLINES[spec?.outlineOf || id];
  if (!spec || !out) throw new Error(`nieznany kadłub floty: ${id}`);
  return buildHullCore(id, spec, out, fleetHullScale(id), o);
}

/**
 * Rdzeń budowy kadłuba ze specyfikacji i obrysów (flota: fleetHulls3D + fleetOutlines3D,
 * kadłuby z automatu: autoHull3D.js). spec — jak FLEET3D_SPECS, dodatkowo: keel.poly (obrys kila
 * w px modelu), palette (klucz FLEET3D_PALETTES, domyślnie frakcja). out — jak FLEET3D_OUTLINES,
 * dodatkowo: tiers (tarasy: { z, bevel, parts }), bells (dysze na ścianie rufy bez gondoli).
 * S — j. świata na px sprite'a.
 */
export function buildHullCore(id, spec, out, S, o = {}) {
  const [SW, SH] = out.sprite;
  const hu = spec.hu;
  const Z = (v) => v * hu;
  const B = new MeshBuilder3D({ deck: { width: SW, height: SH } });
  const tops = [];      // { poly, holes, z, zOf } — dachy (px, układ modelu)
  const addTop = (poly, z, zOf = null, holes = null) => tops.push({ poly: ensureCCW(poly), holes, z, zOf });
  const img = (p) => [p[0], -p[1]];                       // px obrazka → px modelu
  const axis = -(spec.axisY || 0);                        // oś symetrii w układzie modelu
  const mirrorImg = (poly) => poly.map(([x, y]) => [x, 2 * (spec.axisY || 0) - y]).reverse();
  const zBelt = Z(spec.z.belt);
  const zDeck = Z(spec.z.deck);
  const keelZ0 = profile(spec.keel.x, spec.keel.z.map(Z));
  const keelZ = (x) => keelZ0(x);
  const S_KEEL = spec.keel.s;

  // --- 1. Płyta kadłuba i kil --------------------------------------------------
  const knots = spec.keel.x.slice(1, -1);
  const plates = [];
  // Kil pod obrysem płyty (domyślnie) albo tylko pod kadłubem środkowym (keel.half — połowa
  // wielokąta w px obrazka, y ≤ oś; skrzydła pancernika mają wtedy płaskie dno na pasie).
  const keelOwn = spec.keel.poly ? ensureCCW(insertBreaksLoop(spec.keel.poly, knots))
    : spec.keel.half ? ensureCCW(insertBreaksLoop(mirrorHalfImg(spec.keel.half, spec.axisY || 0).map(img), knots)) : null;
  for (const pl of out.plates) {
    const outer = insertBreaksLoop(ensureCCW(pl.outer), knots);
    const holes = pl.holes.map((h) => insertBreaksLoop(h, knots));
    B.slab(outer, holes, zBelt, zDeck, {
      bevel: [Z(spec.z.bevel ?? 0.6), Z(spec.z.bevel ?? 0.6)], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK,
      bottom: !!keelOwn, bottomMat: M.PANEL
    });
    addTop(outer, zDeck, null, holes);
    let keelRing = null;
    if (!keelOwn) {
      keelRing = outer.map(([x, y]) => [x, axis + (y - axis) * S_KEEL]);
      for (const h of holes) {
        if (!h.every(([x, y]) => pointInPoly(x, y, keelRing))) throw new Error(`${id}: dziura płyty wychodzi poza obrys kila (keel.s) — użyj keel.half`);
      }
      B.walls(keelRing, 0, outer, zBelt, M.PANEL, { zOf0: (x) => keelZ(x) });
      holes.forEach((h) => B.walls(h, 0, h, zBelt, M.PANEL, { zOf0: (x) => keelZ(x), flip: true }));
      B.polyHoles(keelRing, holes, 0, M.DARK, false, (x) => keelZ(x));
    }
    plates.push({ outer, holes, keelRing, keelTop: outer });
  }
  if (keelOwn) {
    // Kil osobną bryłą: od pasa (lekko w płycie) w dół do obrysu ściśniętego ku osi.
    const keelRing = keelOwn.map(([x, y]) => [x, axis + (y - axis) * S_KEEL]);
    const zTop = zBelt + Z(0.3);
    B.walls(keelRing, 0, keelOwn, zTop, M.PANEL, { zOf0: (x) => keelZ(x) });
    B.poly(keelRing, 0, M.DARK, false, (x) => keelZ(x));
    B.poly(keelOwn, zTop, M.PANEL, true);
    plates.keel = { outer: keelOwn, keelRing };
  }

  // --- 2. Gondole silników (walce z rysunkiem sprite'a) ------------------------------
  const pods = [];
  const nozzles = [];
  const podZ = Z(spec.pod?.z ?? (spec.z.belt + spec.z.deck) / 2);
  for (const p of out.pods) {
    const r = p.r * (spec.pod?.kr ?? 1);
    // Gondola w osi (dysza między blokami rufy) — spłaszczona do grubości płyty.
    const kz = Math.abs(p.y - axis) < p.r ? (spec.pod?.centerKz ?? 0.6) : (spec.pod?.kz ?? 1);
    const x1 = p.xCut + r * (spec.pod?.overlap ?? 0.9);
    const lip = r * 0.1;
    B.push().translate(0, p.y, podZ).scale(1, 1, kz);
    B.cylinder([p.x0 + lip, 0, 0], [x1, 0, 0], r, r, { seg: 28, mat: M.DECK, capA: false });
    podNozzle(B, p.x0 + lip, 0, 0, r);
    B.pop();
    pods.push({ x0: p.x0, x1, y: p.y, z: podZ, r, kz });
    addTop(rectRing(p.x0, p.y - r * 0.7, x1, p.y + r * 0.7), podZ + r * kz * 0.95);
    nozzles.push({ x: p.x0, y: p.y, z: podZ, r: r * 0.78 * Math.sqrt(kz), dir: [-1, 0, 0] });
  }

  // Dysze bez gondoli (kadłuby z automatu): obudowa w ścianie rufy i dzwon z żarem.
  const zMid = (zBelt + zDeck) / 2;
  for (const b of out.bells || []) {
    const r = b.r;
    B.cylinder([b.x + r * 0.6, b.y, zMid], [b.x - r * 0.2, b.y, zMid], r * 1.12, r * 1.12, { seg: 24, mat: M.PANEL, capA: false, capB: false });
    podNozzle(B, b.x - r * 0.2, b.y, zMid, r * 1.12);
    nozzles.push({ x: b.x - r * 0.2, y: b.y, z: zMid, r: r * 0.87, dir: [-1, 0, 0] });
  }

  // --- 3. Kolce (ostrosłupy grzbietowe) ---------------------------------------------
  const spikeZ = (zBelt + zDeck) / 2;
  const spikeH = (zDeck - zBelt) * 0.5 * (spec.spikeK ?? 1.25);
  for (const s of out.spikes || []) spike(B, s, spikeZ, spikeH);

  // Tarasy nadbudówek (kadłuby z automatu): każdy stoi na poprzednim (albo na pokładzie).
  let tierBase = zDeck;
  for (const t of out.tiers || []) {
    const z1 = Z(t.z);
    for (const part of t.parts) {
      B.slab(part.outer, part.holes, tierBase - Z(0.4), z1, {
        bevel: [Z(t.bevel ?? 0.7), Z(t.bevel ?? 0.7)], wallMat: M.PAINT, bevelMat: M.DECK, capMat: M.DECK
      });
      addTop(part.outer, z1, null, part.holes);
    }
    tierBase = z1;
  }

  // --- 4. Nadbudówki (specyfikacja) ---------------------------------------------------
  const blockTop = (b) => {
    if (!b.zx) return null;
    const [xa, za, xb, zb] = b.zx;
    const k = (Z(zb) - Z(za)) / (xb - xa);
    return (x) => Z(za) + (x - xa) * k;
  };
  for (const b of spec.blocks || []) {
    const list = b.mirror ? [b.poly, mirrorImg(b.poly)] : [b.poly];
    for (const polyImg of list) {
      const z1 = Z(b.z1);
      const zTop = blockTop(b);
      const bev = b.bevel ?? [0.5, 0.5];
      if (b.clip) {
        const rec = (out.blocks || []).find((r) => r.key === fleetClipKey(polyImg));
        if (!rec) throw new Error(`${id}: brak przyciętej bryły „${b.name}” — uruchom node scripts/webgpu/obrysy-floty.mjs`);
        for (const part of rec.parts) {
          B.slab(part.outer, part.holes, Z(b.z0 ?? spec.z.deck - 0.4), z1, {
            bevel: bev ? [Z(bev[0]), Z(bev[1])] : null,
            wallMat: b.wall ?? M.PAINT, bevelMat: M.DECK, capMat: b.cap ?? M.DECK,
            zOf1: zTop ? (x) => zTop(x) : null
          });
          addTop(part.outer, z1, zTop, part.holes);
        }
        continue;
      }
      const poly = ensureCCW(polyImg.map(img));
      B.prism(poly, Z(b.z0 ?? spec.z.deck - 0.4), z1, {
        bevel: bev ? [Z(bev[0]), Z(bev[1])] : null,
        slope: b.slope ? Z(b.slope) : 0,
        wallMat: b.wall ?? M.PAINT, bevelMat: M.DECK, capMat: b.cap ?? M.DECK,
        zTop: zTop ? (x) => zTop(x) : null
      });
      addTop(poly, z1, zTop);
    }
  }

  const heightAtPx = (x, y) => heightAt(tops, x, y, zDeck);

  // Okrągłe włazy wież (bębny) na dachu pod punktem: kołnierz, fazowany brzeg, dach z rysunkiem włazu.
  for (const [x, yImg, r, h] of spec.drums || []) {
    const y = -yImg;
    const z0 = heightAtPx(x, y);
    const hz = Z(h);
    const sink = Z(0.3);
    B.push().translate(x, y, z0 - sink);
    B.lathe([[r * 1.06, 0], [r * 1.06, sink + hz * 0.45], [r * 0.98, sink + hz], [0, sink + hz]], { seg: 36, mats: [M.PANEL, M.DECK, M.DECK] });
    B.pop();
    addTop(ngonRing(x, y, r, 24), z0 + hz);
  }
  const ctx = { B, M, Z, img, mirrorImg, heightAt: heightAtPx, addTop, spec, zBelt, zDeck, keelZ };
  if (spec.details) spec.details(ctx);

  // Okna (świecące kreski na ścianach): odcinki w px obrazka, na zewnątrz od osi.
  for (const w of spec.windows || []) windowRow(B, w, ctx);

  // --- 5. Mostek gry -------------------------------------------------------------------
  const bridges = [];
  if (o.bridges !== false && spec.bridge) {
    const kind = BRIDGE3D_KINDS[spec.bridge];
    const x = kind.zoneX;
    const y = -kind.zoneY;
    const z = heightAtPx(x, y);
    bridges.push(addBridge(B, { kind: spec.bridge, x, y, z }, o.bridgeZScale ?? spec.bridgeZ ?? 2.2));
  }

  // --- 6. Gniazda broni, światła, RCS (edytor) ------------------------------------------
  const ed = SHIP_EDITOR_DEFAULTS.ships[spec.editor] || {};
  const tier = spec.tier || 'Capital';
  const mounts = [];
  for (const hp of ed.hardpoints || []) {
    const type = String(hp.type || '').toLowerCase();
    const x = hp.x;
    const y = -hp.y;
    const z = heightAtPx(x, y);
    const rw = spec.mountR?.[type] != null ? spec.mountR[type] * S : (MOUNT_R_WORLD[type] ?? 10) * (TIER_TURRET[tier] ?? 1);
    const r = rw / S;
    if (r > 0) {
      const t = Z(0.35);
      B.push().translate(x, y, z);
      B.lathe([[r * 1.14, -t * 1.4], [r * 1.14, t * 0.5], [r * 1.06, t * 1.55], [r * 0.86, t * 1.55], [r * 0.82, t * 1.4], [r * 0.78, t * 1.55], [0, t * 1.55]],
        { seg: 28, mats: [M.PANEL, M.BRIGHT, M.PANEL, M.DARK, M.DARK, M.PANEL] });
      B.pop();
    }
    mounts.push({ id: hp.id, type, x, y, z: z + (r > 0 ? Z(0.35) * 1.55 : 0), radius: r, rot: hp.rot || 0 });
  }

  const rcs = [];
  for (const e of ed.engines?.side || []) {
    const hit = nearestEdge(plates, e.x, -e.y);
    if (!hit) continue;
    const [px, py] = hit.p;
    const [nx, ny] = hit.n;
    const zc = (zBelt + zDeck) / 2;
    const sz = Z(1.6);
    B.push().translate(px + nx * sz * 0.2, py + ny * sz * 0.2, zc).rotateZ(Math.atan2(ny, nx));
    B.box(0, 0, 0, sz * 0.6, sz * 1.8, sz, { mat: M.PANEL, bevel: [sz * 0.12, sz * 0.12] });
    B.face([[sz * 0.31, -sz * 0.6, -sz * 0.3], [sz * 0.31, sz * 0.6, -sz * 0.3], [sz * 0.31, sz * 0.6, sz * 0.3], [sz * 0.31, -sz * 0.6, sz * 0.3]], M.DARK, [1, 0, 0]);
    B.pop();
    rcs.push({ id: e.id, x: px + nx * sz * 0.5, y: py + ny * sz * 0.5, z: zc, dir: [nx, ny, 0] });
  }

  // Dysze MAIN edytora → najbliższa gondola (id markera; strugi stoją na gondolach).
  for (const e of ed.engines?.main || []) {
    let best = null; let bd = Infinity;
    for (const n of nozzles) {
      const d = Math.hypot(n.x - e.x, n.y + e.y);
      if (d < bd) { bd = d; best = n; }
    }
    if (best && !best.id) best.id = e.id;
  }

  return finalize(B, {
    id, spec, S, tops, plates, pods, spikes: out.spikes || [], mounts, nozzles, rcs, bridges,
    lights: ed.lights || {}, zBelt, zDeck, keelZ, axis, sprite: { width: SW, height: SH }, spikeZ, spikeH
  });
}

// ---------------------------------------------------------------------------
// Prymitywy
// ---------------------------------------------------------------------------

function ngonRing(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

function rectRing(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// Dysza na tylnym końcu gondoli (x, y, z), osią za rufę (−X): pierścień krawędzi, ciemny
// lej do środka i żar gardzieli (E_ENGINE — świeci w bloomie). Zamyka otwarty tył walca.
function podNozzle(B, x, y, z, r) {
  B.push().translate(x, y, z).rotateY(-Math.PI / 2); // lokalne +Z = −X
  B.lathe([[r, -r * 0.02], [r, 0], [r * 0.9, r * 0.1], [r * 0.82, r * 0.06]], { seg: 28, mats: [M.DECK, M.METAL, M.BRIGHT] });
  B.lathe([[r * 0.82, r * 0.06], [r * 0.7, -r * 0.3], [r * 0.46, -r * 0.46]], { seg: 28, mats: [M.DARK, M.DARK], inside: true });
  B.lathe([[0, -r * 0.46], [r * 0.46, -r * 0.46]], { seg: 28, mats: [M.E_ENGINE], inside: true });
  B.pop();
}

// Kolec: wielokąt obrysu (układ modelu) i oś podstawa a → czubek t. Grzbiet na osi, wysokość
// maleje do zera na czubku; płat górny (pokład — rysunek kolca) i dolny domykają bryłę.
function spike(B, s, zc, h0) {
  const [ax, ay] = s.a;
  const [tx, ty] = s.t;
  const dx = tx - ax; const dy = ty - ay;
  const L2 = dx * dx + dy * dy || 1;
  const tOf = ([x, y]) => Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L2));
  const ridge = (t) => [ax + dx * t, ay + dy * t];
  const P = ensureCCW(s.poly);
  const hOf = (t) => h0 * Math.pow(1 - t, 0.85);
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const q = P[(i + 1) % P.length];
    const tp = tOf(p); const tq = tOf(q);
    const rp = ridge(tp); const rq = ridge(tq);
    const out = [(p[1] + q[1]) / 2 - (rp[1] + rq[1]) / 2, -((p[0] + q[0]) / 2 - (rp[0] + rq[0]) / 2)];
    // Góra: krawędź obrysu → grzbiet (dwa trójkąty — czworokąt bywa nieplanarny).
    const up = (sgn, mat) => {
      const A = [p[0], p[1], zc]; const Bq = [q[0], q[1], zc];
      const C = [rq[0], rq[1], zc + sgn * hOf(tq)]; const D = [rp[0], rp[1], zc + sgn * hOf(tp)];
      const nOut = [(p[0] + q[0]) / 2 - (rp[0] + rq[0]) / 2, (p[1] + q[1]) / 2 - (rp[1] + rq[1]) / 2, sgn * h0 * 0.5];
      B.face([A, Bq, C], mat, nOut);
      B.face([A, C, D], mat, nOut);
    };
    void out;
    up(1, M.DECK);
    up(-1, M.DARK);
  }
}

// Rząd okien: odcinek [x0, y0, x1, y1] (px obrazka) na ścianie, wysokość z (hu), krok (px).
function windowRow(B, w, ctx) {
  const [x0, y0, x1, y1] = w.seg;
  const list = w.mirror ? [[x0, y0, x1, y1], [x0, 2 * (ctx.spec.axisY || 0) - y0, x1, 2 * (ctx.spec.axisY || 0) - y1]] : [[x0, y0, x1, y1]];
  for (const [a0, b0, a1, b1] of list) {
    const p0 = ctx.img([a0, b0]); const p1 = ctx.img([a1, b1]);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ux = (p1[0] - p0[0]) / L; const uy = (p1[1] - p0[1]) / L;
    let nx = uy; let ny = -ux;
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    if (nx * 0 + ny * (mid[1] + (ctx.spec.axisY || 0)) < 0) { nx = -nx; ny = -ny; }
    const z = ctx.Z(w.z);
    const hz = ctx.Z(w.h ?? 0.45);
    const len = w.len ?? w.step * 0.55;
    const off = 0.4;
    let k = 0;
    for (let s = w.step * 0.5; s < L - len * 0.5; s += w.step, k++) {
      if (w.skip && ((k * 7919) % w.skip) === 0) continue;
      const a = [p0[0] + ux * (s - len / 2) + nx * off, p0[1] + uy * (s - len / 2) + ny * off];
      const b = [p0[0] + ux * (s + len / 2) + nx * off, p0[1] + uy * (s + len / 2) + ny * off];
      B.face([[a[0], a[1], z - hz / 2], [b[0], b[1], z - hz / 2], [b[0], b[1], z + hz / 2], [a[0], a[1], z + hz / 2]], w.mat ?? M.E_WINDOW, [nx, ny, 0]);
    }
  }
}

/** Najbliższy punkt obrysu płyt (px modelu) i normalna na zewnątrz. */
function nearestEdge(plates, x, y) {
  let best = null; let bd = Infinity;
  for (const pl of plates) {
    const R = pl.outer;
    for (let i = 0; i < R.length; i++) {
      const a = R[i]; const b = R[(i + 1) % R.length];
      const ex = b[0] - a[0]; const ey = b[1] - a[1];
      const L2 = ex * ex + ey * ey;
      if (L2 < 1e-9) continue;
      const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / L2));
      const px = a[0] + ex * t; const py = a[1] + ey * t;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) {
        const L = Math.sqrt(L2);
        bd = d; best = { p: [px, py], n: [ey / L, -ex / L] }; // CCW: na zewnątrz = prawa strona
      }
    }
  }
  return best;
}

function heightAt(tops, x, y, fallback) {
  let z = -Infinity;
  for (const t of tops) {
    if (!pointInPoly(x, y, t.poly)) continue;
    if (t.holes && t.holes.some((h) => pointInPoly(x, y, h))) continue;
    const h = t.zOf ? t.zOf(x, y) : t.z;
    if (h > z) z = h;
  }
  return Number.isFinite(z) ? z : fallback;
}

// Mostek gry (przestrzeń M: środek strefy, jednostki świata profilu mostka, +Z wysokość) → px
// kadłuba (skala render/PNG rodzaju — kadłub o innym profilu, np. `supercapital`, też pasuje).
function addBridge(B, p, zs) {
  const model = buildBridgeModel(p.kind);
  const kind = BRIDGE3D_KINDS[p.kind];
  const kx = 1 / kind.kx;
  const ky = 1 / kind.ky;
  const k = (kx + ky) * 0.5;
  const MAT = {
    [BRIDGE3D_MAT.PAINT]: M.PAINT, [BRIDGE3D_MAT.PANEL]: M.PANEL, [BRIDGE3D_MAT.DARK]: M.DARK,
    [BRIDGE3D_MAT.TRIM]: M.TRIM, [BRIDGE3D_MAT.GLASS]: M.GLASS, [BRIDGE3D_MAT.FRAME]: M.DARK,
    [BRIDGE3D_MAT.BRIGHT]: M.BRIGHT, [BRIDGE3D_MAT.GRIME]: M.PANEL
  };
  const P = (x, y, z) => [p.x + x * kx, p.y + y * ky, p.z + z * k * zs];
  const pos = model.positions;
  const idx = model.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]; const b = idx[t + 1]; const c = idx[t + 2];
    const pa = P(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const pb = P(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const pc = P(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const nx = model.normals[a * 3]; const ny = model.normals[a * 3 + 1]; const nz = model.normals[a * 3 + 2] / zs;
    const mat = MAT[model.mat[a]] ?? M.PAINT;
    B.face([pa, pb, pc], mat, [nx, ny, nz]);
  }
  let windows = 0;
  for (const e of model.emitters) {
    if (e.lit === false) continue;
    const hw = (e.w || 1) * 0.5;
    const hh = (e.h || 1) * 0.5;
    const off = 0.05;
    const q = (st, sb) => P(
      e.c[0] + e.t[0] * st + e.b[0] * sb + e.n[0] * off,
      e.c[1] + e.t[1] * st + e.b[1] * sb + e.n[1] * off,
      e.c[2] + e.t[2] * st + e.b[2] * sb + e.n[2] * off
    );
    const mat = e.type === BRIDGE3D_EMIT.WINDOW ? M.E_WINDOW
      : e.type === BRIDGE3D_EMIT.STRIP ? (String(e.color).includes('red') || String(e.color).includes('amber') ? M.E_AMBER : M.E_CYAN)
        : (String(e.color).includes('white') ? M.E_WHITE : M.E_RED);
    B.face([q(-hw, -hh), q(hw, -hh), q(hw, hh), q(-hw, hh)], mat, [e.n[0], e.n[1], e.n[2] / zs]);
    windows++;
  }
  return { kind: p.kind, x: p.x, y: p.y, z: p.z, windows, triangles: model.triangleCount };
}

// Dane w jednostkach świata (× S), układ Core3D; zapytania jak Atlas.
function finalize(B, d) {
  const S = d.S;
  const out = {
    id: d.id,
    label: d.spec.label,
    faction: d.spec.faction,
    tier: d.spec.tier,
    editorKey: d.spec.editor,
    profile: d.spec.profile,
    sprite: d.sprite,
    mounts: [], nozzles: [], rcs: [], hangars: [], lights: [], bridges: d.bridges,
    hexlanceMuzzle: null,
    palette: FLEET3D_PALETTES[d.spec.palette || d.spec.faction] || null,
    deckZ: d.zDeck * S
  };
  for (const m of d.mounts) {
    out.mounts.push({ id: m.id, type: m.type, rot: m.rot, x: m.x * S, y: m.y * S, z: m.z * S, radius: m.radius * S, px: [m.x, m.y] });
  }
  for (const n of d.nozzles) out.nozzles.push({ id: n.id || null, x: n.x * S, y: n.y * S, z: n.z * S, r: n.r * S, dir: n.dir });
  for (const r of d.rcs) out.rcs.push({ id: r.id, x: r.x * S, y: r.y * S, z: r.z * S, dir: r.dir });
  for (const m of d.mounts) if (m.type === 'hangar') out.hangars.push({ id: m.id, x: m.x * S, y: m.y * S, z: m.z * S });
  for (const l of d.lights.position || []) {
    const y = -l.y;
    const z = heightAt(d.tops, l.x, y, d.zDeck);
    out.lights.push({ id: l.id, kind: 'position', x: l.x * S, y: y * S, z: (z + 1.5) * S, color: l.color, power: l.power, radius: l.radius, group: l.sequenceGroup || '' });
  }
  for (const l of d.lights.road || []) {
    const y = -l.y;
    const z = heightAt(d.tops, l.x, y, d.zDeck);
    out.lights.push({ id: l.id, kind: 'road', x: l.x * S, y: y * S, z: (z + 2) * S, color: l.color, power: l.power, radius: l.radius, deg: l.deg, range: l.range, coneDeg: l.coneDeg });
  }
  out.builder = B;
  out.scale = S;

  const inPlates = (x, y) => d.plates.some((pl) => pointInPoly(x, y, pl.outer) && !pl.holes.some((h) => pointInPoly(x, y, h)));
  const inPods = (x, y) => d.pods.find((p) => x >= p.x0 && x <= p.x1 && Math.abs(y - p.y) <= p.r) || null;
  const inSpikes = (x, y) => d.spikes.some((s) => pointInPoly(x, y, s.poly));
  // Kil: pochyłe burty dolne między obrysem na pasie a obrysem ściśniętym ku osi (keel.s).
  const lofts = d.plates.keel ? [d.plates.keel.outer] : d.plates.map((pl) => pl.outer);
  const bottomPx = (x, y) => {
    let z = Infinity;
    if (inPlates(x, y)) z = d.zBelt;
    for (const ring of lofts) {
      if (!pointInPoly(x, y, ring)) continue;
      const dy = y - d.axis;
      const ys = crossingsAtX(ring, x).map((v) => v - d.axis).filter((v) => Math.sign(v) === Math.sign(dy || 1) && Math.abs(v) >= Math.abs(dy) - 1e-6);
      const kz = d.keelZ(x);
      if (!ys.length) { z = Math.min(z, kz); continue; }
      const ye = Math.min(...ys.map(Math.abs));
      const s = d.spec.keel.s;
      if (Math.abs(dy) <= s * ye) z = Math.min(z, kz);
      else z = Math.min(z, d.zBelt + ((ye - Math.abs(dy)) / ((1 - s) * ye)) * (kz - d.zBelt));
    }
    const pod = inPods(x, y);
    if (pod) z = Math.min(z, pod.z - pod.kz * Math.sqrt(Math.max(0, pod.r * pod.r - (y - pod.y) ** 2)));
    if (!Number.isFinite(z) && inSpikes(x, y)) z = d.spikeZ - d.spikeH * 0.5;
    return Number.isFinite(z) ? z : d.zBelt;
  };
  // Zapytania w jednostkach świata (układ modelu): dach nad punktem, dno, wnętrze obrysu.
  out.heightAt = (xw, yw) => heightAt(d.tops, xw / S, yw / S, d.zDeck) * S;
  out.bottomAt = (xw, yw = 0) => bottomPx(xw / S, yw / S) * S;
  out.contains = (xw, yw) => {
    const x = xw / S; const y = yw / S;
    return inPlates(x, y) || !!inPods(x, y) || inSpikes(x, y);
  };
  out.size = { length: (Math.max(...d.plates.flatMap((p) => p.outer.map((q) => q[0]))) - Math.min(...d.plates.flatMap((p) => p.outer.map((q) => q[0])), ...d.pods.map((p) => p.x0))) * S };
  void v3;
  return out;
}
