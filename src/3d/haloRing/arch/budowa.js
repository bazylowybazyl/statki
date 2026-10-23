// Ring BUDOWA (Jowisz, ring w budowie — decyzja użytkownika 2026-10-23) — siatki Three z planu
// (budowaPlan.js). Kręgosłup (pasy kratownicy, półżebra, pręty, rusztowania, płyty na orbicie) w partii
// konstrukcji, wyspy płyty z pasów (`ringStrip` z keep: tylko zbudowane segmenty, front obłożony
// stopniowo, ściany kawałkami — `wallAt`), brudne baraki per wyspa (rodzaj 7), drony (rodzaj 8 — lot
// w shaderze), światła pozycyjne (spawanie: faza ≥ 1). Tekstury płyt z kanwy (brud, rdza, sadza, łaty).
// Bez miasta, zieleni, wody i kopuł; bez infrastruktury w atmosferze Jowisza.
import * as THREE from 'three';
import { createCanvas2D } from '../../canvas2d.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { archRingTubeBoxes, archRunSteps } from './archFrame.js';
import { ArchLights, archBatchMesh, archPointsMesh } from './archMaterials.js';
import { BUD_COLORS, buildBudowaDrones, buildBudowaHouses, buildBudowaStructure, createBudowaPlan, wallAt } from './budowaPlan.js';
import { ringStrip } from './fable.js';

// Tekstury płyt (kanwa 1024²): 'deck' — pokład wyspy, 'hull' — lica kadłuba, 'wall' — ściany.
// Brud: plamy sadzy, zacieki rdzy, ślady spawania, łaty nowych płyt, starte pasy ostrzegawcze.
function makeDirtyTextures(kind, seed, size = 1024) {
  let a = seed >>> 0;
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const range = (x, y) => x + (y - x) * rnd();
  const c = createCanvas2D(size, size);
  const ctx = c.getContext('2d');
  const e = createCanvas2D(size, size);
  const ectx = e.getContext('2d');
  const base = kind === 'deck' ? [104, 99, 90] : kind === 'hull' ? [92, 92, 92] : [104, 103, 100];
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, size, size);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);
  const panels = [];
  (function split(x, y, w, h, depth) {
    const minS = kind === 'deck' ? 90 : 60;
    if ((w < minS * 2 && h < minS * 2) || depth > 5 || (depth > 2 && rnd() < 0.3)) { panels.push([x, y, w, h]); return; }
    const t = range(0.3, 0.7);
    if (w > h || (w === h && rnd() < 0.5)) {
      split(x, y, Math.floor(w * t), h, depth + 1);
      split(x + Math.floor(w * t), y, w - Math.floor(w * t), h, depth + 1);
    } else {
      split(x, y, w, Math.floor(h * t), depth + 1);
      split(x, y + Math.floor(h * t), w, h - Math.floor(h * t), depth + 1);
    }
  })(0, 0, size, size, 0);
  for (const [x, y, w, h] of panels) {
    const v = range(-13, 13);
    // łata: nowa, jaśniejsza płyta albo płyta z Io (żółtawa)
    const patch = rnd();
    const tint = patch < 0.07 ? [18, 17, 14] : patch < 0.12 ? [14, 8, -6] : [0, 0, 0];
    ctx.fillStyle = `rgb(${base[0] + v + tint[0]},${base[1] + v + tint[1]},${base[2] + v + tint[2]})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(10,9,8,0.9)';
    ctx.lineWidth = rnd() < 0.3 ? 3 : 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // nity w rogach
    if (w > 50 && h > 50) {
      ctx.fillStyle = 'rgba(18,17,15,0.75)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(i % 2 ? x + w - 7 : x + 7, i < 2 ? y + 7 : y + h - 7, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // starte pasy ostrzegawcze
    if (w > 110 && h > 30 && rnd() < (kind === 'deck' ? 0.1 : 0.05)) {
      ctx.save();
      ctx.globalAlpha = range(0.35, 0.75);
      ctx.beginPath(); ctx.rect(x + 6, y + h - 16, w - 12, 9); ctx.clip();
      for (let i = -20; i < w; i += 16) {
        ctx.fillStyle = (i / 16) % 2 ? 'rgb(200,150,25)' : 'rgb(22,20,18)';
        ctx.beginPath(); ctx.moveTo(x + i, y + h - 16); ctx.lineTo(x + i + 8, y + h - 16); ctx.lineTo(x + i, y + h - 7); ctx.lineTo(x + i - 8, y + h - 7); ctx.fill();
      }
      ctx.restore();
    }
    // numer płyty (biała farba, starta)
    if (kind !== 'deck' && w > 80 && h > 60 && rnd() < 0.12) {
      ctx.fillStyle = 'rgba(190,186,170,0.45)';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(`${'JKLMRS'[Math.floor(rnd() * 6)]}-${Math.floor(rnd() * 900 + 100)}`, x + 10, y + 30);
    }
  }
  // plamy sadzy i brudu (duże, miękkie), smugi oleju, rdza
  const blot = (n, r0, r1, col, a0, a1) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = range(r0, r1);
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${col},${range(a0, a1)})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
  };
  blot(kind === 'deck' ? 7 : 6, 140, 420, '14,12,9', 0.14, 0.34);
  blot(kind === 'deck' ? 9 : 7, 30, 110, '14,12,9', 0.12, 0.3);
  blot(8, 10, 46, '70,34,12', 0.15, 0.4);
  blot(kind === 'deck' ? 6 : 3, 6, 22, '5,5,5', 0.4, 0.7);
  // zacieki rdzy (pionowe smugi) na licach i ścianach
  if (kind !== 'deck') {
    for (let i = 0; i < 60; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const len = range(30, 220);
      const g = ctx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, `rgba(96,44,14,${range(0.3, 0.6)})`);
      g.addColorStop(1, 'rgba(96,44,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, range(2, 6), len);
    }
  }
  // ślady spawania (przypalone szwy) na pokładzie
  if (kind === 'deck') {
    ctx.strokeStyle = 'rgba(30,22,40,0.5)';
    for (let i = 0; i < 24; i++) {
      ctx.lineWidth = range(2, 4);
      const x = rnd() * size;
      const y = rnd() * size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() < 0.5 ? range(40, 160) : 0), y + (rnd() < 0.5 ? range(40, 160) : 0)); ctx.stroke();
    }
  }
  // światła: rzadkie lampki (bursztyn, biel)
  const nLamp = kind === 'wall' ? 6 : kind === 'hull' ? 3 : 0;
  for (let i = 0; i < nLamp; i++) {
    ectx.fillStyle = rnd() < 0.5 ? 'rgb(255,170,60)' : 'rgb(255,236,200)';
    ectx.fillRect(rnd() * size, rnd() * size, 4, 4);
  }
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(c), emissiveMap: mk(e) };
}

export function buildBudowaRing(args) {
  return archRunSteps(buildBudowaRingSteps(args));
}

// Krokami (zadanie 23): plan (baraki, teren), pasy, konstrukcja, baraki — `yield` między częściami.
export function* buildBudowaRingSteps({ layout, uniforms, materials, geos, quality, seed, portLights = [], portSolid = null }) {
  const plan = createBudowaPlan(layout, seed);
  yield;
  const bg = [];
  const fg = [];
  const disposables = [];
  const zTop = layout.z.topIn;
  const lightsBG = new ArchLights();
  const lightsFG = new ArchLights();
  const lights = { add: (x, y, z, c, s, p) => (z > zTop - 1 ? lightsFG : lightsBG).add(x, y, z, c, s, p) };
  for (const l of portLights) lightsBG.add(l.x, l.y, l.z, l.color, l.size, l.phase);
  const { HW, WH, WT, TB, uSide } = plan.section;
  const K = plan.construction;

  // obłożenie frontu: od krawędzi przerwy (d = 0) nic, dalej losowo, za `to` pełne — ułamki frontu
  const quadHash = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const clad = (from, to, holes = 0) => (th, i) => {
    const d = K.active ? plan.edgeDist(th) / K.front : Infinity;
    if (d < from) return false;
    if (holes > 0 && quadHash(i * 1.37 + 5.1) < holes) return false;
    if (d >= to) return true;
    return quadHash(i) < (d - from) / (to - from);
  };

  // ---- pokład wysp ----
  const deck = makeDirtyTextures('deck', (seed ^ 0x2d) >>> 0);
  disposables.push(deck.map, deck.emissiveMap);
  const deckRep = 700;
  const segSurf = Math.round(plan.CIRC / 110);
  const floorGeo = ringStrip(plan, -HW, 0, HW, 0, 0, 1, segSurf, { across: 4, repU: plan.CIRC / deckRep, repV: plan.W / deckRep, keep: clad(0.3, 0.65) });
  const floorMesh = new THREE.Mesh(floorGeo, materials.strip({ map: deck.map, emap: deck.emissiveMap, tint: [0.92, 0.9, 0.86], emitGain: 1.2, varScale: 1600 }));
  floorMesh.name = 'BudowaDeck';
  floorMesh.frustumCulled = false;
  bg.push(floorMesh);

  yield;
  // ---- kadłub i ściany wysp (atlas: kadłub | ściany) ----
  const hullTex = makeDirtyTextures('hull', (seed ^ 0x51) >>> 0);
  const wallTex = makeDirtyTextures('wall', (seed ^ 0x77) >>> 0);
  const atlasOf = (x0, x1) => {
    const cv = createCanvas2D(2048, 1024);
    const g = cv.getContext('2d');
    g.drawImage(x0.image, 0, 0, 1024, 1024);
    g.drawImage(x1.image, 1024, 0, 1024, 1024);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const atlasMap = atlasOf(hullTex.map, wallTex.map);
  const atlasEmit = atlasOf(hullTex.emissiveMap, wallTex.emissiveMap);
  for (const t of [hullTex.map, hullTex.emissiveMap, wallTex.map, wallTex.emissiveMap]) t.dispose();
  disposables.push(atlasMap, atlasEmit);
  const tagAtlas = (g, v) => {
    g.setAttribute('aAtlas', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(v), 1));
    return g;
  };
  yield;
  const SEG = Math.round(plan.CIRC / 160);
  const rep = 900;
  const circRep = plan.CIRC / rep;
  const hullBG = [];
  const hullFG = [];
  // spód kadłuba i lica boczne (kadłub, h −TB … 0): obłożenie od ~0,2–0,7 frontu, w licach dziury (6%)
  hullBG.push(tagAtlas(ringStrip(plan, -uSide, -TB, uSide, -TB, 0, -1, SEG, { across: 4, repU: circRep, repV: (2 * uSide) / rep, keep: clad(0.15, 0.4, 0.04) }), 0));
  hullFG.push(tagAtlas(ringStrip(plan, uSide, -TB, uSide, 0, 1, 0, SEG, { across: 2, repU: circRep, repV: TB / rep, keep: clad(0.4, 0.75, 0.06) }), 0));
  hullBG.push(tagAtlas(ringStrip(plan, -uSide, -TB, -uSide, 0, -1, 0, SEG, { across: 2, repU: circRep, repV: TB / rep, keep: clad(0.4, 0.75, 0.06) }), 0));
  // ściany (h 0 … WH) kawałkami: lico zewnętrzne, wewnętrzne, korona — ten sam wybór (wallAt)
  for (const sd of [-1, 1]) {
    const keepW = (th) => wallAt(plan, th, sd);
    const list = sd > 0 ? hullFG : hullBG;
    list.push(tagAtlas(ringStrip(plan, sd * uSide, 0, sd * uSide, WH, sd, 0, SEG, { across: 2, repU: circRep, repV: WH / rep, keep: keepW }), 1));
    list.push(tagAtlas(ringStrip(plan, sd * HW, 0, sd * HW, WH, -sd, 0, SEG, { across: 2, repU: circRep, repV: WH / rep, keep: keepW }), 1));
    list.push(tagAtlas(ringStrip(plan, sd * HW, WH, sd * uSide, WH, 0, 1, SEG, { repU: circRep, repV: WT / rep, keep: keepW }), 0));
  }
  const stripMesh = (geos_, mat, name) => {
    const g = mergeGeometries(geos_, false);
    for (const x of geos_) x.dispose();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  };
  const tint = [0.82, 0.8, 0.78];
  bg.push(stripMesh(hullBG, materials.strip({ map: atlasMap, emap: atlasEmit, tint, emitGain: 1.3, varScale: 1400, atlas: true }), 'BudowaHull'));
  fg.push(stripMesh(hullFG, materials.strip({ map: atlasMap, emap: atlasEmit, tint, emitGain: 1.3, varScale: 1400, atlas: true, fg: true }), 'BudowaHullFG'));

  yield;
  // ---- kręgosłup i plac budowy ----
  const st = buildBudowaStructure(plan, lights);
  const { STEEL, DARK } = BUD_COLORS;
  // pasy wzdłużne kratownicy (cztery naroża każdego pasa) w przerwach i na frontach
  const bare = (th) => plan.edgeDist(th) < K.front;
  const hTop = -8;
  const hBot = -TB + 8;
  for (const sd of [-1, 1]) {
    for (const [z, h, r] of [[sd * (uSide - 10), hTop, 13], [sd * (uSide - 10), hBot, 16], [sd * plan.section.zIn, hTop, 11], [sd * plan.section.zIn, hBot, 13]]) {
      archRingTubeBoxes(z > zTop - 1 ? st.fg : st.bg, plan.R, h, z, r, 2048, h > -TB * 0.5 ? STEEL : DARK, 0, 0.35, bare);
    }
  }
  if (portSolid) st.bg.append(portSolid);
  const matBG = materials.instanced(false);
  const matFG = materials.instanced(true);
  for (const [batch, mat, list] of [[st.bg, matBG, bg], [st.fg, matFG, fg]]) {
    const mesh = archBatchMesh(batch, geos.box, mat);
    if (mesh) list.push(mesh);
  }

  yield;
  // ---- baraki (per wyspa — odcinanie kadrem) i drony ----
  const hs = buildBudowaHouses(plan, lights);
  const islandMeshes = hs.per.map((P) => {
    const d = {
      box: archBatchMesh(P.box, geos.box, matBG),
      cyl: archBatchMesh(P.cyl, geos.cyl8, matBG),
      center: new THREE.Vector3(plan.R * Math.cos(P.theta), plan.R * Math.sin(P.theta), 0),
      half: P.island.len * 0.5
    };
    if (d.box) { d.box.name = 'BudowaHouses'; bg.push(d.box); }
    if (d.cyl) { d.cyl.name = 'BudowaHousesCyl'; bg.push(d.cyl); }
    return d;
  });
  const drones = archBatchMesh(buildBudowaDrones(plan), geos.box, matBG, { pad: 260 });
  if (drones) { drones.name = 'BudowaDrones'; bg.push(drones); }

  // ---- światła pozycyjne ----
  const pBG = archPointsMesh(lightsBG, materials.points(false));
  const pFG = archPointsMesh(lightsFG, materials.points(true));
  if (pBG) bg.push(pBG);
  if (pFG) fg.push(pFG);

  return {
    bg,
    fg,
    domes: [],
    landmarks: [],
    stats: {
      instances: st.bg.count + st.fg.count + plan.houses.length,
      buildings: plan.houses.length,
      trees: 0,
      lights: (lightsBG.pos.length + lightsFG.pos.length) / 3,
      textureBytes: 1024 * 1024 * 4 + 2048 * 1024 * 8,
      ...st.stats
    },
    heightAt: (theta, z) => plan.heightAt(theta, z),
    plan,
    update(camLocal, frustum, pixelAngle) {
      // baraki tylko, gdy wyspa ma choć kilka px (z daleka obóz to piksel; okna i tak w średniej)
      for (const d of islandMeshes) {
        const dist = Math.max(1, d.center.distanceTo(camLocal) - d.half);
        const px = pixelAngle > 0 ? 1 / (dist * pixelAngle) : 1;
        const on = 120 * px > 1.0;
        if (d.box) d.box.visible = on;
        if (d.cyl) d.cyl.visible = 60 * px > 1.0;
      }
      if (drones) drones.visible = pixelAngle <= 0 || Math.abs(camLocal.z) < 60000;
    },
    dispose() {
      for (const x of disposables) x.dispose?.();
    }
  };
}

