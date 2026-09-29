// Skóra kadłuba gry na belkach (hullBodies.js) dla hexShips3D: czworokąt na węzeł.
//
// Ta sama zasada co beamSpriteSkin2D (demo): narożnik czworokąta = narożnik komórki
// w spoczynku + średnie przemieszczenie węzłów dzielących narożnik i wciąż połączonych
// całą belką — zerwana belka otwiera szew. Różnice pod shader kadłubów gry:
//  - UV w konwencji tekstur heksów (flipY = false): v = 0 to górny wiersz obrazu,
//    więc vSpriteUV · uSpriteSize to piksel sprite'a jak w światłach i lakierze,
//  - zamiast koloru wierzchołka: jasność blachy (wgniecenie, brzeg rozdarcia) i żar
//    węzła (szczyt, znacznik czasu) — zanik liczy shader,
//  - ROZDARCIE narożnika (0 — cała blacha, 0,5 / 0,75 / 1 — narożnik dzieli 1 / 2 / 3 martwe
//    komórki albo zerwane belki): interpolowane po czworokącie daje we fragmencie odległość do
//    brzegu dziury, a szum wycina poszarpany pas — dziura po zniszczonych węzłach nie ma kwadratowych
//    rogów siatki (hexShips3D.tsl.js, hullTearFray). Zapis opcjonalny (tablica `tear`).
// Moduł nie importuje three.

import { buildSpriteSkinTopology, SPRITE_CORNERS } from './beamSpriteSkin2D.js';

const dirIndex = (dx, dy) => (dx + 1) + (dy + 1) * 3;

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Topologia skóry dla bieżących magazynów ciała (po rozpadzie z zagęszczeniem — od nowa).
 * `heatNow` / `heatDecay` ustawia renderer przed zapisem (zegar żaru silnika = performance.now).
 */
export function buildHullSkinTopology(body) {
  const topo = buildSpriteSkinTopology(body);
  const uvs = topo.uvs;
  for (let k = 1; k < uvs.length; k += 2) uvs[k] = 1 - uvs[k];
  topo.heatNow = 0;
  topo.heatDecay = 0.35;
  return topo;
}

// Żar węzła teraz (szczyt × zanik od znacznika); zimny węzeł bez exp().
function heatAt(s, i, now, decay) {
  const peak = s.heat[i];
  if (!(peak > 0)) return 0;
  const age = now - s.heatStamp[i];
  return age > 0 ? peak * Math.exp(-age * decay) : peak;
}

// Trwałe odkształcenie belek węzła → ciemniejsza blacha w wgnieceniu.
function nodeDent(s, e, i) {
  const adj = s.adj, broken = e.broken, rest = e.rest, restBase = e.restBase;
  let damage = 0;
  for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
    const bi = adj[q];
    if (broken[bi]) continue;
    const plastic = Math.abs(rest[bi] - restBase[bi]) / restBase[bi];
    if (plastic > damage) damage = plastic;
  }
  return smoothstep(0.02, 0.22, damage);
}

/** Rozdarcie narożnika z liczby martwych komórek / zerwanych belek, które go dzielą (0–3). */
export const HULL_SKIN_TEAR = Object.freeze([0, 0.5, 0.75, 1]);

// Czworokąt węzła i (układ lokalny ciała). Martwy węzeł = czworokąt zwinięty do punktu.
function writeQuad(i, topo, half, positions, shade, heat, tear) {
  const s = topo.store, e = topo.beamStore, links = topo.links;
  const x = s.x, y = s.y, ox = s.ox, oy = s.oy, active = s.active;
  const ea = e.a, eb = e.b, broken = e.broken;
  const p = i * 12, v = i * 4, h = i * 8;
  if (!active[i]) {
    for (let k = 0; k < 4; k++) {
      positions[p + k * 3] = ox[i]; positions[p + k * 3 + 1] = oy[i]; positions[p + k * 3 + 2] = 0;
      shade[v + k] = 0;
      heat[h + k * 2] = 0; heat[h + k * 2 + 1] = 0;
      if (tear) tear[v + k] = 0;
    }
    return 0;
  }
  const dxn = x[i] - ox[i], dyn = y[i] - oy[i];
  const dent = nodeDent(s, e, i);
  const now = topo.heatNow, decay = topo.heatDecay;
  const ownHeat = heatAt(s, i, now, decay);
  for (let k = 0; k < 4; k++) {
    const sx = SPRITE_CORNERS[k][0], sy = SPRITE_CORNERS[k][1];
    let sumX = dxn, sumY = dyn, weight = 1, torn = 0;
    // Żar narożnika = najgorętsza z żywych komórek, które go dzielą: rozżarzona blacha
    // przechodzi płynnie w zimną zamiast świecić kwadratami pojedynczych komórek.
    let cornerHeat = ownHeat;
    // Trzy komórki dzielące narożnik: (sx, 0), (0, sy), (sx, sy).
    for (let c = 0; c < 3; c++) {
      const bi = links[i * 9 + dirIndex(c === 1 ? 0 : sx, c === 0 ? 0 : sy)];
      if (bi < 0) continue;
      const m = ea[bi] === i ? eb[bi] : ea[bi];
      if (!active[m]) { torn++; continue; }
      const hm = heatAt(s, m, now, decay);
      if (hm > cornerHeat) cornerHeat = hm;
      if (broken[bi]) { torn++; continue; }
      sumX += x[m] - ox[m]; sumY += y[m] - oy[m]; weight++;
    }
    const o = p + k * 3;
    positions[o] = ox[i] + sx * half + sumX / weight;
    positions[o + 1] = oy[i] + sy * half + sumY / weight;
    positions[o + 2] = 0;
    // Brzeg rozdarcia ciemnieje — widać, gdzie szew puścił.
    shade[v + k] = Math.max(0.2, 1 - 0.42 * dent - (torn ? 0.3 : 0));
    // Żar zapisany na chwilę zapisu (zanik dalej liczy shader od tego znacznika).
    heat[h + k * 2] = cornerHeat;
    heat[h + k * 2 + 1] = now;
    if (tear) tear[v + k] = HULL_SKIN_TEAR[torn];
  }
  return 1;
}

/** Cała skóra (tear — rozdarcie narożników, opcjonalne). Zwraca liczbę widocznych czworokątów. */
export function writeHullSkin(body, topo, positions, shade, heat, tear = null) {
  const half = body.cellSize * 0.5;
  let visible = 0;
  for (let i = 0; i < topo.count; i++) visible += writeQuad(i, topo, half, positions, shade, heat, tear);
  return visible;
}

/**
 * Tylko czworokąty zmienionych węzłów i ich 8 sąsiadów (narożniki są wspólne).
 * Zakres zmienionych czworokątów w `out` ({ min, max }, max < min = nic).
 */
export function writeHullSkinQuads(body, topo, positions, shade, heat, list, count, out, tear = null) {
  const half = body.cellSize * 0.5, links = topo.links, stamps = topo.stamps;
  const ea = topo.beamStore.a, eb = topo.beamStore.b;
  let stamp = (topo.stamp + 1) >>> 0;
  if (stamp === 0) { stamps.fill(0); stamp = 1; }
  topo.stamp = stamp;
  let min = topo.count, max = -1;
  for (let k = 0; k < count; k++) {
    const i = list[k];
    for (let d = 0; d < 9; d++) {
      let j = i;
      if (d !== 4) {
        const bi = links[i * 9 + d];
        if (bi < 0) continue;
        j = ea[bi] === i ? eb[bi] : ea[bi];
      }
      if (stamps[j] === stamp) continue;
      stamps[j] = stamp;
      writeQuad(j, topo, half, positions, shade, heat, tear);
      if (j < min) min = j;
      if (j > max) max = j;
    }
  }
  out.min = min;
  out.max = max;
  return out;
}

/** Czyści znaczniki skóry obszaru aktywnego po zapisie (renderer jest ich konsumentem). */
export function clearHullSkinDirty(body) {
  const region = body._region;
  if (!region || region.store !== body.nodeStore) return;
  const skinDirty = body.nodeStore.skinDirty;
  if (region.dirtyAll) {
    skinDirty.fill(0);
    region.dirtyAll = false;
  } else {
    for (let k = 0; k < region.dirtyCount; k++) skinDirty[region.dirty[k]] = 0;
  }
  region.dirtyCount = 0;
}
