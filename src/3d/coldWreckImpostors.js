// src/3d/coldWreckImpostors.js
//
// Smugi ZIMNYCH wraków (src/game/coldWrecks.js) we wspólnym batchu smug
// (hexBodyImpostorBatch.js). Zimny wrak nie ma meshy ani siatki, nie rzuca cienia,
// nie świeci i nie ma wieżyczek — zostaje po nim jedna smuga.
//
// Zimny wrak stoi w miejscu, więc transformację sceny liczymy RAZ, przy
// zamrożeniu (prepareColdWreckImpostor). Co klatkę zostaje test pudła kadru
// i kilka liczb zapisanych do batcha — bez obiektów per wrak. Moduł nie zna
// three.js: batch dostaje z zewnątrz, więc logikę sprawdza się w node.

/**
 * Zapisuje na zrzucie gotową smugę: `snapshot.impostor`. Przekształcenie jak
 * w updateEntityMesh (hexShips3D): T(ex, -ey) · Rz(rot) · S(sx, -sy), środek
 * smugi = środek aktywnych heksów (snapshot.extent), kolor = snapshot.color.
 * Ta sama geometria co smuga gorącego wraku — zamrożenie nie przeskakuje obrazu.
 */
export function prepareColdWreckImpostor(snapshot, worldX, worldY, rot, scaleX, scaleY) {
  const ext = snapshot?.extent;
  if (!ext) return null;
  const offX = ext.cx * scaleX;
  const offY = -ext.cy * scaleY;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const sceneX = worldX + offX * c - offY * s;
  const sceneY = -worldY + offX * s + offY * c;
  const halfW = ext.halfW * scaleX;
  const halfH = ext.halfH * scaleY;
  const color = snapshot.color || { r: 0.35, g: 0.37, b: 0.4 };
  const out = snapshot.impostor || (snapshot.impostor = {});
  out.x = sceneX;
  out.y = sceneY;
  out.rot = rot;
  out.halfW = halfW;
  out.halfH = halfH;
  out.r = color.r;
  out.g = color.g;
  out.b = color.b;
  // Środek w układzie ŚWIATA (scena ma odwróconą oś Y) i zasięg do cullingu.
  out.wx = sceneX;
  out.wy = -sceneY;
  out.reach = Math.hypot(halfW, halfH);
  return out;
}

// Odległości kandydatów przy przepełnieniu batcha — rośnie tylko wtedy, gdy
// zimnych w kadrze jest więcej niż kiedykolwiek wcześniej.
let _distScratch = new Float64Array(256);

function inBox(imp, cull, halfW, halfH) {
  return Math.abs(imp.wx - cull.x) <= halfW + imp.reach &&
    Math.abs(imp.wy - cull.y) <= halfH + imp.reach;
}

// k-ty najmniejszy element a[0..n) (0-based), w miejscu (Hoare/Floyd–Rivest-lite).
function selectKth(a, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/**
 * Wrzuca smugi zimnych wraków z kadru do batcha. Przy braku miejsca bierze
 * najbliższe środkowi kadru (culling po odległości, nie wyjątek).
 * @param {{MAX_IMPOSTORS:number, getCount():number, pushRaw:Function}} batch
 * @param {object[]} coldWrecks
 * @param {{x:number,y:number,drawHalfW?:number,drawHalfH?:number,halfW?:number,halfH?:number}|null} cull
 * @param {number} opacity
 * @returns {number} ile smug trafiło do batcha
 */
export function pushColdWreckImpostors(batch, coldWrecks, cull, opacity) {
  if (!batch || !Array.isArray(coldWrecks) || coldWrecks.length === 0) return 0;
  const free = (Number(batch.MAX_IMPOSTORS) || 0) - (Number(batch.getCount()) || 0);
  if (free <= 0) return 0;
  // Pudło RYSOWANIA (kadr), jak isEntityInDrawBox; bez niego — pudło rozgrzania,
  // a bez żadnego pudła wszystko (tylko limit batcha).
  const hasBox = !!cull && Number.isFinite(cull.x) && Number.isFinite(cull.y);
  const halfW = hasBox ? (Number.isFinite(cull.drawHalfW) ? cull.drawHalfW : Number(cull.halfW)) : Infinity;
  const halfH = hasBox ? (Number.isFinite(cull.drawHalfH) ? cull.drawHalfH : Number(cull.halfH)) : Infinity;
  const boxed = hasBox && Number.isFinite(halfW) && Number.isFinite(halfH);
  const cx = boxed ? cull.x : 0;
  const cy = boxed ? cull.y : 0;

  let visible = 0;
  for (let i = 0; i < coldWrecks.length; i++) {
    const imp = coldWrecks[i]?._coldSnapshot?.impostor;
    if (!imp) continue;
    if (boxed && !inBox(imp, cull, halfW, halfH)) continue;
    visible++;
  }
  if (visible === 0) return 0;

  let maxDistSq = Infinity;
  if (visible > free) {
    if (_distScratch.length < visible) {
      let size = _distScratch.length;
      while (size < visible) size *= 2;
      _distScratch = new Float64Array(size);
    }
    let n = 0;
    for (let i = 0; i < coldWrecks.length; i++) {
      const imp = coldWrecks[i]?._coldSnapshot?.impostor;
      if (!imp) continue;
      if (boxed && !inBox(imp, cull, halfW, halfH)) continue;
      const dx = imp.wx - cx;
      const dy = imp.wy - cy;
      _distScratch[n++] = dx * dx + dy * dy;
    }
    maxDistSq = selectKth(_distScratch, n, free - 1);
  }

  let pushed = 0;
  for (let i = 0; i < coldWrecks.length; i++) {
    const imp = coldWrecks[i]?._coldSnapshot?.impostor;
    if (!imp) continue;
    if (boxed && !inBox(imp, cull, halfW, halfH)) continue;
    if (maxDistSq !== Infinity) {
      const dx = imp.wx - cx;
      const dy = imp.wy - cy;
      if (dx * dx + dy * dy > maxDistSq) continue;
    }
    if (!batch.pushRaw(imp.x, imp.y, imp.rot, imp.halfW, imp.halfH, imp.r, imp.g, imp.b, opacity)) break;
    pushed++;
  }
  return pushed;
}
