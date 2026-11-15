// dema/silniki-marki/dysze.js
//
// OSPRZĘT DYSZ i kadłuby-zastępstwa sześciu marek silników (dema marek). Bryły proceduralne (three: toczone dzwony,
// pudła, torusy, wytłaczane obrysy) scalone w jedną siatkę stałą okrętu + po jednej siatce na ruchomą dyszę (przegub,
// klapy). Jeden materiał na okręt: barwa z atrybutu wierzchołków (`color`), a świecenie z atrybutu `fx`:
//   fx.x — ŻAR cieplny (blacha przy wardze świeci od ciemnej czerwieni do żółci; kanał `heat` automatu, wolny),
//   fx.y — LAMPA osprzętu w barwie marki (wtryskiwacze, cewki, siatka; kanał `lamp`, szybki),
//   fx.z — miejsce lampy w kolejce „biegnącego światła” (rozruch hipercruise'u, ładowanie warpa).
// Układ okrętu: dziób +X, wydech −X, Z do kamery. Układ dyszy: początek w osi przegubu, warga w x = −plen.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, uniform, float, vec3, clamp, mix, cos, min, fract, floor, smoothstep, hash, positionLocal, normalLocal, mx_noise_float } from 'three/tsl';

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Klocki geometrii

/** Część: barwa, żar (liczba albo funkcja (x, y, z) w układzie części PRZED przesunięciem), lampa, kolejka; potem skala → obrót → przesunięcie. */
function P(geo, color, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const fx = new Float32Array(n * 3);
  const heat = o.heat ?? 0;
  for (let i = 0; i < n; i++) {
    col[i * 3] = color[0]; col[i * 3 + 1] = color[1]; col[i * 3 + 2] = color[2];
    fx[i * 3] = typeof heat === 'function' ? heat(pos.getX(i), pos.getY(i), pos.getZ(i)) : heat;
    fx[i * 3 + 1] = o.lamp ?? 0;
    fx[i * 3 + 2] = o.seq ?? 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('fx', new THREE.BufferAttribute(fx, 3));
  if (o.scale) g.scale(o.scale[0], o.scale[1], o.scale[2]);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  if (o.at) g.translate(o.at[0], o.at[1], o.at[2] ?? 0);
  return g;
}

const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
const sphere = (r) => new THREE.SphereGeometry(r, 20, 12);

/** Walec / stożek wzdłuż X: rUp — promień od strony dziobu, rDown — od strony wydechu; środek w początku. */
function cylX(rUp, rDown, len, seg = 20) {
  const g = new THREE.CylinderGeometry(rDown, rUp, len, seg, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Bryła toczona wokół osi X. profil: [[d, promień], …], d — odległość w stronę wydechu (x = −d). */
function latheX(profile, seg = 28) {
  const g = new THREE.LatheGeometry(profile.map(([d, r]) => new THREE.Vector2(Math.max(r, 0.01), d)), seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Pierścień wokół osi X. */
function torusX(R, tube, seg = 28) {
  const g = new THREE.TorusGeometry(R, tube, 8, seg);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Płyta z obrysu w XY, wytłoczona wzdłuż Z (środek w z = 0); faza nie powiększa obrysu. */
function plate(points, depth, bevel = 0) {
  const sh = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 1, steps: 1
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Pół obrysu (y ≥ 0, od dziobu do rufy) → pełny wielokąt. */
function mirrored(half) {
  const out = half.map(([x, y]) => [x, y]);
  for (let i = half.length - 1; i >= 0; i--) if (half[i][1] !== 0) out.push([half[i][0], -half[i][1]]);
  return out;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const STAL = [0.34, 0.35, 0.38];
const STAL_J = [0.5, 0.51, 0.53];
const CIEMNY = [0.1, 0.105, 0.115];
const SADZA = [0.045, 0.045, 0.05];

/**
 * Klasyczny dzwon na przegubie (układ dyszy). o: color, rt — promień gardzieli / r, curve — wybrzuszenie profilu,
 * rings — pierścienie usztywnień (ułamki długości), lampColorless — bez pierścienia wtryskiwaczy.
 */
function bellParts(r, plen, o = {}) {
  const parts = [];
  const rt = o.rt ?? 0.34;
  const d0 = plen * 0.37;
  const N = 8;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    prof.push([d0 + (plen - d0) * f, r * (rt + (1 - rt) * Math.pow(Math.sin(f * Math.PI / 2), o.curve ?? 0.85))]);
  }
  const inner = [];
  for (let i = N; i >= 0; i--) inner.push([prof[i][0], Math.max(prof[i][1] - 0.075 * r, 0.05 * r)]);
  const span = plen - d0;
  const heatOut = (x) => { const f = clamp01((-x - d0) / span); return 0.1 + 0.62 * f * f; };
  parts.push(P(sphere(0.4 * r), CIEMNY));
  parts.push(P(cylX(0.42 * r, rt * r * 1.08, d0 - 0.1 * r), STAL, { at: [-(0.1 * r + d0) / 2, 0, 0], heat: 0.18 }));
  parts.push(P(latheX(prof), o.color ?? [0.13, 0.135, 0.15], { heat: heatOut }));
  parts.push(P(latheX(inner), SADZA, { heat: 1 }));
  for (const f of (o.rings ?? [0.42, 0.74])) {
    const i = Math.round(f * N);
    parts.push(P(torusX(prof[i][1] + 0.02 * r, 0.05 * r), STAL, { at: [-prof[i][0], 0, 0], heat: 0.1 + 0.5 * f * f }));
  }
  parts.push(P(torusX(r, 0.065 * r), o.lip ?? STAL_J, { at: [-plen, 0, 0], heat: 0.95 }));
  if (!o.noLamp) parts.push(P(torusX(rt * r + 0.14 * r, 0.05 * r), CIEMNY, { at: [-d0 * 0.86, 0, 0], lamp: 1, seq: 0.1 }));
  return parts;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Marki: części stałe (układ okrętu) i dysze (układ dyszy)

function buildHelios(m) {
  const BIEL = [0.6, 0.62, 0.65];
  const BIEL2 = [0.52, 0.55, 0.6];
  const NIEB = [0.1, 0.26, 0.62];
  const fixed = [];
  fixed.push(P(plate(mirrored([[215, 0], [190, 14], [120, 30], [40, 40], [-60, 46], [-150, 52], [-183, 48]]), 26, 5), BIEL));
  fixed.push(P(plate(mirrored([[150, 0], [122, 13], [40, 22], [-60, 26], [-140, 28], [-160, 22]]), 9, 2.5), BIEL2, { at: [0, 0, 24] }));
  fixed.push(P(box(46, 22, 9), [0.42, 0.45, 0.5], { at: [44, 0, 35] }));
  fixed.push(P(box(18, 14, 5), [0.1, 0.16, 0.26], { at: [72, 0, 38] }));
  for (const s of [1, -1]) {
    fixed.push(P(box(190, 3.2, 1.2), NIEB, { at: [-40, s * 36, 18.3] }));
    fixed.push(P(box(26, 10, 1.2), NIEB, { at: [150, s * 12, 18.3], rz: -s * 0.36 }));
    fixed.push(P(box(60, 8, 6), BIEL2, { at: [-120, s * 42, 20] }));
  }
  fixed.push(P(box(22, 98, 34), [0.2, 0.21, 0.24], { at: [-176, 0, 0] }));
  const nozzles = m.dysze.map((d) => {
    const plen = 2.0 * d.r;
    fixed.push(P(box(0.9 * d.r, 1.5 * d.r, 1.3 * d.r), CIEMNY, { at: [d.x + plen + 0.3 * d.r, d.y, 0] }));
    const parts = bellParts(d.r, plen, { color: [0.14, 0.145, 0.16], rt: 0.33 });
    // Biała osłona ceramiczna komory — znak marki.
    parts.push(P(cylX(0.62 * d.r, 0.56 * d.r, 0.5 * d.r), BIEL, { at: [-0.42 * d.r, 0, 0] }));
    return { mount: d, plen, parts };
  });
  return { fixed, nozzles };
}

function buildAres(m) {
  const STALOWY = [0.2, 0.21, 0.23];
  const STALOWY2 = [0.26, 0.27, 0.3];
  const CZERWIEN = [0.5, 0.1, 0.07];
  const fixed = [];
  fixed.push(P(plate(mirrored([[205, 0], [182, 10], [150, 34], [60, 40], [40, 58], [-90, 62], [-120, 48], [-178, 52], [-184, 40]]), 24, 4), STALOWY));
  fixed.push(P(plate(mirrored([[124, 0], [100, 16], [30, 22], [-100, 26], [-150, 22]]), 9, 2.5), STALOWY2, { at: [0, 0, 22] }));
  fixed.push(P(plate([[60, -9], [84, -5], [84, 5], [60, 9], [28, 9], [28, -9]], 8, 2), [0.3, 0.31, 0.34], { at: [0, 0, 33] }));
  for (const s of [1, -1]) {
    fixed.push(P(box(74, 9, 1.4), CZERWIEN, { at: [-20, s * 50, 16.4] }));
    fixed.push(P(box(10, 30, 1.4), CZERWIEN, { at: [128, s * 24, 16.4], rz: s * 0.5 }));
    fixed.push(P(box(40, 6, 5), [0.14, 0.145, 0.16], { at: [-120, s * 8, 31] }));
  }
  const fl = 24; // długość klapy
  const nozzles = m.dysze.map((d) => {
    const plen = fl;
    const rw = d.rw;
    // Kanał silnika w kadłubie.
    fixed.push(P(box(30, 2 * rw + 10, 22), [0.15, 0.155, 0.17], { at: [d.x + plen + 12, d.y, 0] }));
    const parts = [];
    // Płyty górna i dolna z zębatą krawędzią spływu (cztery zęby).
    const teeth = 4;
    const pts = [[0, -(rw + 2)], [0, rw + 2]];
    for (let i = 0; i <= teeth * 2; i++) {
      const y = (rw + 2) - (2 * (rw + 2)) * (i / (teeth * 2));
      pts.push([i % 2 === 0 ? -fl * 0.8 : -fl, y]);
    }
    const heatPlate = (x) => { const f = clamp01(-x / fl); return 0.08 + 0.75 * f * f * f; };
    parts.push(P(plate(pts, 2.4, 0.6), [0.15, 0.155, 0.17], { at: [0, 0, 8.4], heat: heatPlate }));
    parts.push(P(plate(pts, 2.4, 0.6), [0.15, 0.155, 0.17], { at: [0, 0, -8.4], heat: heatPlate }));
    // Rozżarzona wykładzina kanału — widać ją między zębami.
    parts.push(P(box(fl * 0.86, 2 * rw, 1.2), SADZA, { at: [-fl * 0.43, 0, -6.4], heat: 1 }));
    // Lampy stanu na płycie.
    for (let i = 0; i < 3; i++) parts.push(P(box(3.2, 2 * rw * 0.7, 0.6), CIEMNY, { at: [-3 - i * 4.6, 0, 10.2], lamp: 1, seq: i / 3 }));
    // Klapy boczne (ruchome): zawias przy kanale, koniec przy wardze.
    const heatFlap = (x) => { const f = clamp01(-x / fl); return 0.1 + 0.8 * f * f; };
    const flaps = [1, -1].map((s) => ({
      sign: s,
      at: [0, s * (rw + 1.5), 0],
      parts: [
        P(box(fl, 3.2, 15), STALOWY2, { at: [-fl / 2, 0, 0], heat: heatFlap }),
        P(box(fl * 0.5, 1.2, 9), CZERWIEN, { at: [-fl * 0.3, s * 2, 0] }),
        P(cylX(2.4, 2.4, 17, 10), STAL, { ry: Math.PI / 2 })
      ]
    }));
    return { mount: d, plen, parts, flaps };
  });
  return { fixed, nozzles };
}

function buildKrios(m) {
  const SZARY = [0.46, 0.52, 0.54];
  const JASNY = [0.66, 0.69, 0.69];
  const MORSKI = [0.14, 0.42, 0.42];
  const fixed = [];
  fixed.push(P(plate(mirrored([[210, 0], [196, 10], [150, 16], [-140, 16], [-166, 36], [-186, 60], [-196, 60]]), 20, 4), SZARY));
  fixed.push(P(box(280, 12, 8), [0.36, 0.4, 0.42], { at: [10, 0, 17] }));
  fixed.push(P(box(30, 20, 9), [0.3, 0.34, 0.37], { at: [176, 0, 19] }));
  // Kuliste zbiorniki gazu po obu stronach kręgosłupa.
  const xs = [112, 50, -12];
  for (let i = 0; i < xs.length; i++) {
    for (const s of [1, -1]) {
      fixed.push(P(sphere(27), i === 1 ? MORSKI : JASNY, { at: [xs[i], s * 34, 0] }));
      fixed.push(P(torusX(27.4, 1.6, 24), [0.25, 0.28, 0.3], { at: [xs[i], s * 34, 0] }));
    }
  }
  // Radiatory: ciemne panele z rurkami cieplnymi (żar).
  for (const s of [1, -1]) {
    fixed.push(P(box(112, 92, 1.4), [0.07, 0.075, 0.085], { at: [-88, s * 66, 3] }));
    fixed.push(P(box(116, 3, 3), JASNY, { at: [-88, s * 113, 3] }));
    for (let i = 0; i < 7; i++) fixed.push(P(box(108, 1.6, 0.8), [0.2, 0.12, 0.1], { at: [-88, s * (26 + i * 12.6), 4.1], heat: 0.55 }));
  }
  // Panel siatkowy: płyta i siedem emiterów.
  const d = m.dysze[0];
  const parts = [];
  parts.push(P(box(9, 2 * d.rw + 10, 30), [0.13, 0.14, 0.155], { at: [8.5, 0, 0] }));
  parts.push(P(box(4, 2 * d.rw + 14, 4), JASNY, { at: [8, 0, 15.5] }));
  const N = 7;
  const step = (2 * d.rw - 10) / (N - 1);
  for (let i = 0; i < N; i++) {
    const y = -d.rw + 5 + i * step;
    parts.push(P(cylX(6.4, 6.9, 8, 18), STAL, { at: [4, y, 0], heat: 0.25 }));
    parts.push(P(cylX(5.2, 5.2, 0.8, 18), SADZA, { at: [0.2, y, 0], lamp: 1.4, seq: i / N }));
    parts.push(P(box(6, 2.2, 0.8), CIEMNY, { at: [5, y, 7.1], lamp: 1, seq: i / N }));
  }
  return { fixed, nozzles: [{ mount: d, plen: 0, parts }] };
}

function buildWulkan(m) {
  const BRAZ = [0.48, 0.32, 0.16];
  const MIEDZ = [0.58, 0.3, 0.12];
  const GRAFIT = [0.15, 0.14, 0.15];
  const ZLOTO = [0.62, 0.48, 0.18];
  const fixed = [];
  fixed.push(P(plate(mirrored([[200, 0], [172, 16], [90, 32], [-40, 40], [-120, 54], [-168, 50], [-178, 30]]), 26, 5), BRAZ));
  fixed.push(P(plate(mirrored([[140, 0], [112, 12], [0, 22], [-120, 30], [-150, 24]]), 9, 2.5), GRAFIT, { at: [0, 0, 24] }));
  fixed.push(P(box(40, 16, 7), [0.22, 0.2, 0.2], { at: [60, 0, 34] }));
  for (const s of [1, -1]) {
    fixed.push(P(box(150, 2.6, 1.2), ZLOTO, { at: [-30, s * 36, 18.3] }));
    fixed.push(P(box(54, 10, 7), GRAFIT, { at: [-130, s * 42, 20] }));
  }
  const nozzles = m.dysze.map((d) => {
    const r = d.r;
    const parts = [];
    parts.push(P(cylX(1.05 * r, 1.05 * r, 1.7 * r, 22), GRAFIT, { at: [0.95 * r, 0, 0] }));
    parts.push(P(torusX(1.07 * r, 0.1 * r), ZLOTO, { at: [0.4 * r, 0, 0] }));
    parts.push(P(cylX(0.6 * r, 0.52 * r, 1.0 * r, 18), STAL, { at: [0.5 * r, 0, 0], heat: 0.7 }));
    // Trzy cewki magnetyczne za wylotem rury; światła biegną po nich ku końcowi.
    const xs = [-0.95 * r, -2.05 * r, -3.15 * r];
    for (let i = 0; i < xs.length; i++) {
      parts.push(P(torusX(1.16 * r, 0.17 * r), MIEDZ, { at: [xs[i], 0, 0], heat: 0.35 }));
      parts.push(P(torusX(1.36 * r, 0.05 * r), CIEMNY, { at: [xs[i], 0, 0], lamp: 1.3, seq: i / 3 }));
    }
    // Podłużnice kratownicy (po przekątnych — nie zasłaniają osi strugi z góry).
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) parts.push(P(box(3.6 * r, 0.11 * r, 0.11 * r), GRAFIT, { at: [-1.6 * r, sy * 0.86 * r, sz * 0.86 * r] }));
    }
    return { mount: d, plen: 0, parts };
  });
  return { fixed, nozzles };
}

function buildKowal(m) {
  const ZOLTY = [0.6, 0.43, 0.07];
  const SZARY = [0.24, 0.25, 0.26];
  const fixed = [];
  fixed.push(P(plate(mirrored([[190, 0], [190, 38], [152, 60], [-100, 60], [-128, 70], [-182, 70], [-188, 54]]), 30, 4), ZOLTY));
  const xs = [104, 22, -60];
  for (let i = 0; i < xs.length; i++) fixed.push(P(box(72, 92, 12), i === 1 ? [0.3, 0.3, 0.3] : SZARY, { at: [xs[i], 0, 25] }));
  fixed.push(P(box(26, 30, 12), [0.5, 0.36, 0.07], { at: [166, 22, 25] }));
  fixed.push(P(box(40, 138, 10), SZARY, { at: [-150, 0, 24] }));
  // Pasy ostrzegawcze na rufie.
  for (let i = 0; i < 12; i++) fixed.push(P(box(5, 8, 1.2), i % 2 ? SADZA : [0.72, 0.52, 0.06], { at: [-182, -55 + i * 10, 19.4], rz: 0.5 }));
  const nozzles = m.dysze.map((d) => {
    const r = d.r;
    const plen = 1.5 * r;
    // Amortyzatory: tuleje w kadłubie (stałe), tłoki jadą z dyszą.
    for (const s of [1, -1]) fixed.push(P(cylX(0.2 * r, 0.2 * r, 16, 12), STAL, { at: [d.x + plen + 8, d.y + s * 0.82 * r, 0] }));
    const parts = [];
    for (const s of [1, -1]) parts.push(P(cylX(0.12 * r, 0.12 * r, 20, 10), STAL_J, { at: [4, s * 0.82 * r, 0] }));
    parts.push(P(cylX(0.96 * r, 0.96 * r, 0.62 * r, 22), [0.2, 0.2, 0.21], { at: [-0.18 * r, 0, 0], heat: 0.3 }));
    parts.push(P(torusX(0.99 * r, 0.09 * r), STAL, { at: [0.02 * r, 0, 0] }));
    parts.push(P(torusX(0.99 * r, 0.09 * r), [0.66, 0.48, 0.06], { at: [-0.36 * r, 0, 0] }));
    const prof = [[0.45 * r, 0.62 * r], [0.8 * r, 0.76 * r], [1.2 * r, 0.95 * r], [1.5 * r, 1.08 * r]];
    const heatOut = (x) => { const f = clamp01((-x - 0.45 * r) / (1.05 * r)); return 0.15 + 0.6 * f * f; };
    parts.push(P(latheX(prof), [0.09, 0.09, 0.095], { heat: heatOut }));
    parts.push(P(latheX([[1.5 * r, 0.97 * r], [0.5 * r, 0.5 * r]]), SADZA, { heat: 1 }));
    parts.push(P(torusX(1.08 * r, 0.12 * r), SADZA, { at: [-plen, 0, 0], heat: 1 }));
    parts.push(P(torusX(0.72 * r, 0.05 * r), CIEMNY, { at: [-0.62 * r, 0, 0], lamp: 1, seq: 0 }));
    return { mount: d, plen, parts };
  });
  return { fixed, nozzles };
}

function buildSzakal(m) {
  const RDZA = [0.3, 0.15, 0.09];
  const RDZA2 = [0.2, 0.1, 0.07];
  const BLACHA = [0.38, 0.36, 0.34];
  const fixed = [];
  const rnd = lcg(0x5a17c3);
  fixed.push(P(plate([[200, -8], [172, 18], [100, 34], [20, 30], [0, 52], [-110, 58], [-150, 44], [-184, 48], [-188, -52], [-120, -60], [-60, -44], [60, -40], [150, -30]], 24, 3), RDZA));
  fixed.push(P(plate([[120, -14], [104, 12], [20, 16], [-90, 30], [-140, 24], [-140, -30], [-40, -26], [60, -24]], 9, 2), RDZA2, { at: [0, 0, 20.5] }));
  fixed.push(P(box(36, 22, 9), [0.26, 0.2, 0.16], { at: [70, -2, 31] }));
  // Łaty z blachy: różne barwy i kąty.
  const laty = [RDZA2, BLACHA, [0.36, 0.22, 0.1], [0.24, 0.24, 0.25], [0.42, 0.18, 0.08]];
  for (let i = 0; i < 16; i++) {
    const x = -170 + rnd() * 320;
    const y = -40 + rnd() * 76;
    fixed.push(P(box(14 + rnd() * 34, 8 + rnd() * 20, 1.2), laty[i % laty.length], { at: [x, y, (Math.abs(y) < 16 && x > -130 && x < 50 ? 27.2 : 15.3) + (i % 3) * 0.4], rz: (rnd() - 0.5) * 0.5 }));
  }
  // Belka poprzeczna trzymająca dysze.
  fixed.push(P(box(10, 108, 12), [0.16, 0.13, 0.12], { at: [-182, -4, 0] }));
  const ksztalty = [
    { k: 1.9, o: { color: [0.22, 0.11, 0.07], rt: 0.36, lip: [0.3, 0.26, 0.24] }, scale: [1, 0.95, 1.04] },
    { k: 2.3, o: { color: [0.3, 0.29, 0.28], rt: 0.3, curve: 1.1, rings: [0.5], lip: [0.2, 0.12, 0.08] }, scale: [1, 1, 1] },
    { k: 1.5, o: { color: [0.17, 0.09, 0.06], rt: 0.42, curve: 0.7, rings: [0.3, 0.62, 0.86], lip: [0.36, 0.33, 0.3] }, scale: [1, 1.05, 0.96] }
  ];
  const nozzles = m.dysze.map((d, i) => {
    const sh = ksztalty[i % ksztalty.length];
    const plen = sh.k * d.r;
    fixed.push(P(box(plen + d.x + 186 + 6, 0.9 * d.r, 0.9 * d.r), [0.14, 0.12, 0.11], { at: [(d.x + plen - 186) / 2 + 3, d.y, 0] }));
    const parts = bellParts(d.r, plen, sh.o).map((g) => g.scale(sh.scale[0], sh.scale[1], sh.scale[2]));
    // Rura paliwowa i łata na dzwonie.
    parts.push(P(cylX(0.07 * d.r, 0.07 * d.r, plen * 0.7, 8), BLACHA, { at: [-plen * 0.45, 0.5 * d.r, 0.62 * d.r], rz: 0.22 }));
    parts.push(P(box(0.6 * d.r, 0.5 * d.r, 0.08 * d.r), BLACHA, { at: [-plen * 0.72, -0.2 * d.r, 0.82 * d.r], ry: -0.3 }));
    return { mount: d, plen, parts };
  });
  return { fixed, nozzles };
}

const BUDOWA = { helios: buildHelios, ares: buildAres, krios: buildKrios, wulkan: buildWulkan, kowal: buildKowal, szakal: buildSzakal };

// ---------------------------------------------------------------------------
// Materiał osprzętu (jeden graf na okręt — uniformy żaru i lamp)

function createHardwareMaterial(marka) {
  const U = {
    heat: uniform(0),
    lamp: uniform(0),
    lampColor: uniform(new THREE.Color().setRGB(marka.lampa[0], marka.lampa[1], marka.lampa[2], THREE.LinearSRGBColorSpace)),
    chase: uniform(0),
    chaseAmt: uniform(0)
  };
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.side = THREE.DoubleSide;
  const col = attribute('color', 'vec3');
  const fx = attribute('fx', 'vec3');
  const p = positionLocal;
  const n1 = mx_noise_float(p.mul(0.045)).mul(0.5).add(0.5);
  const n2 = mx_noise_float(p.mul(0.37).add(11.0)).mul(0.5).add(0.5);
  // Szwy paneli i odcień płyt — tylko na powierzchniach zwróconych do góry (pokłady), nie na dzwonach.
  const up = smoothstep(0.55, 0.95, normalLocal.z);
  const cx = p.x.div(26.0);
  const row = floor(cx);
  const cy = p.y.div(13.0).add(row.mul(0.37));
  const fx1 = fract(cx);
  const fy1 = fract(cy);
  const seam = smoothstep(0.12, 0.55, min(min(fx1, float(1.0).sub(fx1)).mul(26.0), min(fy1, float(1.0).sub(fy1)).mul(13.0)));
  const tone = hash(row.mul(37.0).add(floor(cy).mul(131.0)).add(6000.0).toUint());
  const panel = mix(float(1.0), mix(float(0.6), float(1.0), seam).mul(tone.mul(0.2).add(0.88)), up);
  mat.colorNode = col.mul(n1.mul(0.24).add(0.8)).mul(n2.mul(0.12).add(0.94)).mul(panel);
  mat.roughnessNode = float(0.5).add(n2.mul(0.3));
  mat.metalnessNode = float(0.28);
  // Żar cieplny: ciemna czerwień → pomarańcz → żółć (potęgi mnożeniem).
  const h = clamp(fx.x.mul(U.heat), 0.0, 1.25);
  const h2 = h.mul(h);
  const thermal = vec3(1.0, 0.22, 0.045).mul(h2.mul(1.5)).add(vec3(1.0, 0.7, 0.36).mul(h2.mul(h2).mul(2.8)));
  // Lampy: stałe świecenie albo biegnące światło wzdłuż kolejki.
  const c = cos(fx.z.sub(U.chase).mul(6.2831853)).mul(0.5).add(0.5);
  const c2 = c.mul(c);
  const run = mix(float(1.0), c2.mul(c2).mul(2.4).add(0.12), U.chaseAmt);
  mat.emissiveNode = thermal.add(U.lampColor.mul(fx.y.mul(U.lamp).mul(run)));
  return { material: mat, U };
}

/**
 * Okręt marki: grupa three z kadłubem i dyszami, uniformy osprzętu i lista dysz do liczenia strug.
 * Dysza: { mount, plen, group (oś przegubu), flaps: [grupy klap], baseX — położenie spoczynkowe przegubu }.
 */
export function buildShip(marka) {
  const spec = BUDOWA[marka.id](marka);
  const { material, U } = createHardwareMaterial(marka);
  const group = new THREE.Group();
  group.name = `okret-${marka.id}`;
  const hull = new THREE.Mesh(mergeGeometries(spec.fixed, false), material);
  hull.name = 'kadlub';
  group.add(hull);
  const nozzles = spec.nozzles.map((n) => {
    const g = new THREE.Group();
    g.position.set(n.mount.x + n.plen, n.mount.y, 0);
    g.add(new THREE.Mesh(mergeGeometries(n.parts, false), material));
    const flaps = (n.flaps || []).map((f) => {
      const fg = new THREE.Group();
      fg.position.set(f.at[0], f.at[1], f.at[2]);
      fg.add(new THREE.Mesh(mergeGeometries(f.parts, false), material));
      fg.userData.sign = f.sign;
      g.add(fg);
      return fg;
    });
    group.add(g);
    return { mount: n.mount, plen: n.plen, group: g, flaps, baseX: n.mount.x + n.plen, angle: 0, recoil: 0 };
  });
  return { marka, group, U, nozzles };
}

/**
 * Ruch osprzętu w klatce: wychylenie przegubu (gimbal −1…1), klapy Aresa, odrzut Kowala, drżenie Szakala.
 * Zapisuje `nozzle.angle` (kąt wydechu względem −X okrętu, rad) i `nozzle.recoil` — czyta je liczenie strug.
 */
export function animateShip(ship, e, time, gimbal, pulsePhase) {
  const id = ship.marka.id;
  for (let i = 0; i < ship.nozzles.length; i++) {
    const n = ship.nozzles[i];
    const d = n.mount;
    let hard = d.splay * RAD + gimbal * d.gimbal * RAD;
    let recoil = 0;
    if (id === 'szakal') {
      // Luźne mocowania: dysza drży tym mocniej, im większa moc.
      const amp = (0.25 + 0.9 * e.boost + 1.3 * e.warp + 0.8 * e.charge) * e.thr * RAD;
      hard += amp * Math.sin(time * (41 + i * 9.7) + i * 2.1) * Math.sin(time * (17.3 + i * 3.1));
    } else if (id === 'kowal') {
      // Odrzut po każdej detonacji: skok w przód, powrót na amortyzatorach.
      const f = pulsePhase + d.ph;
      const frac = f - Math.floor(f);
      recoil = (2.2 + 2.4 * e.boost + 1.5 * e.warp) * e.thr * Math.exp(-frac * 5.5);
    } else if (id === 'ares') {
      // Klapy: zbieżne na ciągu suchym, rozchylone na dopalaczu i w warpie.
      const open = Math.max(e.boost, e.warp, e.charge * 0.6);
      const conv = (3 + 8 * e.thr * (1 - open) - 6 * open - 2 * e.hyper) * RAD;
      for (const f of n.flaps) f.rotation.z = f.userData.sign * conv;
    }
    n.group.rotation.z = hard;
    n.group.position.x = n.baseX + recoil;
    n.angle = hard + gimbal * d.odchyl * RAD;
    n.hardAngle = hard;
    n.recoil = recoil;
  }
  ship.U.heat.value = e.heat;
  ship.U.lamp.value = e.lamp;
  ship.U.chaseAmt.value = e.chase;
}
