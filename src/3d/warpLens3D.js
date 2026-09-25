// Soczewka skoku (warp): zakrzywia TŁO — warstwę 1 (mgławica, gwiazdy,
// pas w tle) — wokół statku gracza. Pass Core3D między tłem a resztą sceny.
//
// Wcześniej efekt miał własny kontekst WebGL i próbkował GOTOWĄ klatkę 2D
// (z kadłubem, dyszami i bloomem), ściągając obraz z daleka ku środkowi.
// Statek znikał w soczewce, więc wycinano mu z efektu elipsę 1,25× kadłuba.
// W elipsie zostawała niezniekształcona klatka z poświatą dysz, dookoła
// obraz ściągnięty z daleka, a na granicy twardy szew — „jajko”. Poświata
// bloomu kończyła się na tej elipsie, mapa 1/r² obcięta na 0,45 zawijała
// się w pierścień (fałda — powielony obraz), a alfa mnożona dwa razy
// przyciemniała brzeg soczewki. Do tego co klatkę upload całej kanwy 2D
// jako tekstury do trzeciego kontekstu.
//
// Teraz tło renderuje się do osobnego celu, ten pass kładzie je zakrzywione
// do bufora sceny, a planety, statki, tarcze i FG rysują się na wierzchu
// (soczewka stoi przy statku, więc zakrzywia tylko to, co leży daleko ZA
// nim). Wszystko w HDR przed bloomem — poświata liczy się z gotowego obrazu.
//
// Mapa w układzie znormalizowanym (elipsa soczewki = okrąg o promieniu 1,
// oś x wzdłuż lotu): piksel w promieniu x pokazuje tło z promienia
//   s(x) = sqrt(x² + a²·(1 − x²)²),   a = uSwallow
// s(0) = a — tarcza tła o promieniu a wpada w środek (pod kadłub),
// s(1) = 1 i s'(1) = 1 — brzeg soczewki bez szwu i bez załamania,
// s rośnie monotonicznie dla a < 1/√2 — żadnych fałd ani powielonego obrazu.
// Przy środku tło rozciąga się promieniście i ściska stycznie: przestrzeń
// spływa do „odpływu” pod statkiem.
import * as THREE from 'three';

// Granica monotoniczności to 1/√2 ≈ 0,707; zapas, żeby przy samym środku
// rozciągnięcie promieniowe nie szło w nieskończoność.
export const WARP_LENS_MAX_SWALLOW = 0.65;
// Soczewka mniejsza niż kilka pikseli nic nie pokaże, a kosztuje osobny cel.
export const WARP_LENS_MIN_RADIUS_PX = 4;

// Prymitywy zgięcia przestrzeni (docs/BRIEF-warp.md §5.1) — efekty warpa
// (src/3d/warpFx3D.js) zgłaszają je co klatkę w świecie, pass kładzie je na
// tło po kolei, po soczewce skoku. Ten sam pass i cel co soczewka.
//   POINT — „połknięcie” w elipsie, ta sama mapa s(x) co soczewka skoku;
//   SEAM  — szew: tło wciągane ku odcinkowi (mapa s w poprzek, zwężona ku końcom);
//   RING  — fala: przesunięcie promieniowe w paśmie wokół promienia R.
export const WARP_SPACE_MAX_PRIMS = 16;
export const WARP_SPACE_TYPE = Object.freeze({ POINT: 0, SEAM: 1, RING: 2 });

// Kropla widoku skoku (docs/BRIEF-warp.md §4.3, user: „zamiast koła kropla” —
// cel lotu mieści się wyżej). Wypukła otoczka dwóch kół na osi lotu: bańka
// z przodu (środek ua, promień ra) i ogon za rufą (środek ub < 0, rb < ra).
// Wszystko w promieniach kuli, statek w początku układu. Dla koła: ua = ub = 0,
// ra = rb = 1.
/** Geometria kropli z wymiarów: czoło i czubek ogona od statku, promień bańki i ogona. */
export function warpDropGeometry(front, back, bulb, tail, out = {}) {
  const ra = Math.max(1e-3, Number(bulb) || 1);
  const rb = Math.min(ra, Math.max(0, Number(tail) || 0));
  // Statek musi zostać w bańce: czoło najwyżej tuż przed średnicą bańki.
  const f = Math.min(Math.max(Number(front) || ra, 1e-3), ra * 1.98);
  const b = Math.max(Number(back) || ra, rb);
  out.ua = f - ra;
  out.ra = ra;
  out.ub = -(b - rb);
  out.rb = rb;
  return out;
}

/**
 * Odległość od statku do brzegu kropli wzdłuż kierunku (du wzdłuż lotu, dv
 * w poprzek, |(du, dv)| = 1). Lustro GLSL: WARP_DROP_GLSL (wvDropExit).
 * Kropla jest wypukła, a statek w środku — brzegiem jest dokładnie jeden
 * kawałek: łuk bańki, styczna albo łuk ogona.
 */
export function warpDropExit(du, dv, g) {
  const ua = g.ua;
  const ra = g.ra;
  const ub = g.ub;
  const rb = g.rb;
  const v = Math.abs(dv);
  const h = Math.max(ua - ub, 1e-4);
  const sa = clampNum((ra - rb) / h, -0.999, 0.999);
  const ca = Math.sqrt(1 - sa * sa);
  const pa = ua * du;
  const da = pa * pa - ua * ua + ra * ra;
  const tA = pa + Math.sqrt(Math.max(da, 0));
  if (da >= 0 && (tA * du - ua) / ra >= -sa) return tA;
  // Styczna (górna — symetria): normalna n = (−sa, ca), n·p = ra − sa·ua.
  const nd = -sa * du + ca * v;
  const tL = nd > 1e-6 ? (ra - sa * ua) / nd : 1e6;
  const uL = tL * du;
  if (uL <= ua - ra * sa && uL >= ub - rb * sa) return tL;
  const pb = ub * du;
  const db = pb * pb - ub * ub + rb * rb;
  return db >= 0 ? pb + Math.sqrt(db) : tL;
}

export const WARP_DROP_GLSL = `
      // Kropla widoku skoku — lustro warpDropExit (warpLens3D.js). dir: x wzdluz
      // lotu, y w poprzek (liczy sie |y|); g = (ua, ra, ub, rb) w promieniach kuli.
      float wvDropExit(vec2 dir, vec4 g) {
        float v = abs(dir.y);
        float h = max(g.x - g.z, 1e-4);
        float sa = clamp((g.y - g.w) / h, -0.999, 0.999);
        float ca = sqrt(1.0 - sa * sa);
        float pa = g.x * dir.x;
        float da = pa * pa - g.x * g.x + g.y * g.y;
        float tA = pa + sqrt(max(da, 0.0));
        if (da >= 0.0 && (tA * dir.x - g.x) / g.y >= -sa) return tA;
        float nd = -sa * dir.x + ca * v;
        float tL = nd > 1e-6 ? (g.y - sa * g.x) / nd : 1e6;
        float uL = tL * dir.x;
        if (uL <= g.x - g.y * sa && uL >= g.z - g.w * sa) return tL;
        float pb = g.z * dir.x;
        float db = pb * pb - g.z * g.z + g.w * g.w;
        return db >= 0.0 ? pb + sqrt(db) : tL;
      }
`;

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

/** Promień, z którego piksel w promieniu x (układ znormalizowany) bierze tło. */
export function warpLensSourceRadius(x, swallow) {
  const r = Math.abs(Number(x) || 0);
  if (r >= 1) return r;
  const a = clampNum(swallow, 0, WARP_LENS_MAX_SWALLOW);
  const w = 1 - r * r;
  return Math.sqrt(r * r + a * a * w * w);
}

/**
 * Parametry soczewki w świecie gry → uniformy passa (UV celu tła).
 * lens: { x, y, angle, radiusAlong, radiusAcross, swallow } — współrzędne
 * i kąt gry (y w dół), promienie w jednostkach świata.
 * cam: { x, y, zoom } — kamera, którą Core3D renderuje klatkę.
 * bufW/bufH: rozmiar celu w pikselach bufora (tak liczą kamery passów).
 * Zwraca false, gdy soczewka nic nie zmieni (brak siły, za mała, poza kadrem).
 */
export function computeWarpLensUniforms(lens, cam, bufW, bufH, out) {
  if (!lens || !cam || !out) return false;
  const zoom = Math.max(1e-4, Number(cam.zoom) || 1);
  const w = Math.max(1, Number(bufW) || 1);
  const h = Math.max(1, Number(bufH) || 1);
  const swallow = clampNum(lens.swallow, 0, WARP_LENS_MAX_SWALLOW);
  if (!(swallow > 1e-4)) return false;
  // Promienie w jednostkach wysokości ekranu (oś v) — shader koryguje u aspektem.
  const radiusAlong = Math.max(0, Number(lens.radiusAlong) || 0) * zoom / h;
  const radiusAcross = Math.max(0, Number(lens.radiusAcross) || 0) * zoom / h;
  const minRadius = WARP_LENS_MIN_RADIUS_PX / h;
  if (!(radiusAlong > minRadius) || !(radiusAcross > minRadius)) return false;

  const aspect = w / h;
  const u = 0.5 + ((Number(lens.x) || 0) - (Number(cam.x) || 0)) * zoom / w;
  const v = 0.5 + ((Number(cam.y) || 0) - (Number(lens.y) || 0)) * zoom / h;
  // Kadr: okrąg opisany na elipsie kontra prostokąt ekranu (układ z aspektem).
  const cx = u * aspect;
  const dx = Math.max(0, -cx, cx - aspect);
  const dy = Math.max(0, -v, v - 1);
  const reach = Math.max(radiusAlong, radiusAcross);
  if (dx * dx + dy * dy >= reach * reach) return false;

  const angle = Number(lens.angle) || 0;
  out.centerU = u;
  out.centerV = v;
  // Kąt gry liczony przy osi y w dół; w UV oś v rośnie w górę.
  out.axisX = Math.cos(angle);
  out.axisY = -Math.sin(angle);
  out.radiusAlong = radiusAlong;
  out.radiusAcross = radiusAcross;
  out.aspect = aspect;
  out.swallow = swallow;
  return true;
}

/** Lustro CPU fragment shadera: UV, z którego piksel (u, v) bierze tło. */
export function warpLensSampleUv(u, v, uniforms, out = { u: 0, v: 0 }) {
  const aspect = uniforms.aspect;
  const dx = (u - uniforms.centerU) * aspect;
  const dy = v - uniforms.centerV;
  const ax = uniforms.axisX;
  const ay = uniforms.axisY;
  // perp = (-ay, ax)
  const qx = (dx * ax + dy * ay) / uniforms.radiusAlong;
  const qy = (dx * -ay + dy * ax) / uniforms.radiusAcross;
  const x2 = qx * qx + qy * qy;
  out.u = u;
  out.v = v;
  if (x2 < 1) {
    const w = 1 - x2;
    const s2 = x2 + uniforms.swallow * uniforms.swallow * w * w;
    const k = Math.sqrt(s2 / Math.max(x2, 1e-12));
    const sx = qx * k * uniforms.radiusAlong;
    const sy = qy * k * uniforms.radiusAcross;
    out.u = uniforms.centerU + (ax * sx - ay * sy) / aspect;
    out.v = uniforms.centerV + (ay * sx + ax * sy);
  }
  return out;
}

/**
 * Zgłoszenia prymitywów zgięcia (świat gry, y w dół) → uniformy passa: środek
 * w UV celu tła, oś w UV (v w górę), długości w wysokościach ekranu (oś v).
 * Pomija prymitywy zerowe, za małe i poza kadrem.
 *   reqs[i] = { type, x, y, angle, a, b, strength } (świat):
 *   POINT: a/b = promień wzdłuż/w poprzek osi, strength = połknięcie (≤ 0,65);
 *   SEAM:  a = połowa długości, b = zasięg w poprzek, strength = połknięcie;
 *   RING:  a = promień fali, b = szerokość pasma, strength = amplituda (świat, ze znakiem).
 * outA/outB — tablice z metodą set(x, y, z, w) (THREE.Vector4), zapis od 0.
 * @returns {number} liczba zapisanych prymitywów
 */
export function packWarpSpacePrims(reqs, count, cam, bufW, bufH, outA, outB) {
  if (!reqs || !cam || !outA || !outB) return 0;
  const zoom = Math.max(1e-4, Number(cam.zoom) || 1);
  const w = Math.max(1, Number(bufW) || 1);
  const h = Math.max(1, Number(bufH) || 1);
  const aspect = w / h;
  const k = zoom / h;
  const minLen = WARP_LENS_MIN_RADIUS_PX / h;
  const n = Math.min(count | 0, reqs.length, outA.length, outB.length, WARP_SPACE_MAX_PRIMS);
  let written = 0;
  for (let i = 0; i < n; i++) {
    const r = reqs[i];
    if (!r) continue;
    const type = r.type | 0;
    const a = Math.max(0, Number(r.a) || 0) * k;
    const b = Math.max(0, Number(r.b) || 0) * k;
    let s = Number(r.strength) || 0;
    if (type === WARP_SPACE_TYPE.RING) {
      s *= k;
      if (!(Math.abs(s) > 1e-6) || !(b > 1e-6)) continue;
    } else {
      s = clampNum(s, 0, WARP_LENS_MAX_SWALLOW);
      if (!(s > 1e-4) || !(a > minLen) || !(b > minLen)) continue;
    }
    const u = 0.5 + ((Number(r.x) || 0) - (Number(cam.x) || 0)) * zoom / w;
    const v = 0.5 + ((Number(cam.y) || 0) - (Number(r.y) || 0)) * zoom / h;
    const reach = type === WARP_SPACE_TYPE.RING ? a + b * 3 : Math.max(a, b);
    const cx = u * aspect;
    const dx = Math.max(0, -cx, cx - aspect);
    const dy = Math.max(0, -v, v - 1);
    if (dx * dx + dy * dy >= reach * reach) continue;
    const ang = Number(r.angle) || 0;
    // Kąt gry liczony przy osi y w dół; w UV oś v rośnie w górę.
    outA[written].set(u, v, Math.cos(ang), -Math.sin(ang));
    outB[written].set(a, b, s, type);
    written++;
  }
  return written;
}

/**
 * Lustro CPU pętli prymitywów z shadera: UV, z którego piksel (u, v) bierze
 * tło. prims = { A, B } jak z packWarpSpacePrims (pola x, y, z, w).
 */
export function warpSpaceSampleUv(u, v, prims, count, aspect, out = { u: 0, v: 0 }) {
  let su = u;
  let sv = v;
  const n = Math.min(count | 0, prims?.A?.length || 0, prims?.B?.length || 0);
  for (let i = 0; i < n; i++) {
    const A = prims.A[i];
    const B = prims.B[i];
    const dx = (su - A.x) * aspect;
    const dy = sv - A.y;
    const ax = A.z;
    const ay = A.w;
    const pl = dx * ax + dy * ay;
    const pc = dx * -ay + dy * ax;
    if (B.w < 0.5) {
      const qx = pl / B.x;
      const qy = pc / B.y;
      const x2 = qx * qx + qy * qy;
      if (x2 < 1) {
        const w = 1 - x2;
        const s2 = x2 + B.z * B.z * w * w;
        const kk = Math.sqrt(s2 / Math.max(x2, 1e-12));
        const sx = qx * kk * B.x;
        const sy = qy * kk * B.y;
        su = A.x + (ax * sx - ay * sy) / aspect;
        sv = A.y + (ay * sx + ax * sy);
      }
    } else if (B.w < 1.5) {
      const xa = pl / B.x;
      const ya = pc / B.y;
      if (Math.abs(xa) < 1 && Math.abs(ya) < 1) {
        const tap = 1 - xa * xa;
        const a2 = B.z * tap * tap;
        const w = 1 - ya * ya;
        const s = Math.sqrt(ya * ya + a2 * a2 * w * w);
        const across = Math.sign(ya) * s * B.y;
        su = A.x + (ax * pl - ay * across) / aspect;
        sv = A.y + (ay * pl + ax * across);
      }
    } else {
      const r = Math.hypot(dx, dy);
      const kk = (r - B.x) / Math.max(B.y, 1e-5);
      if (Math.abs(kk) < 3 && r > 1e-5) {
        const disp = B.z * kk * Math.exp(-kk * kk);
        su -= (dx / r) * disp / aspect;
        sv -= (dy / r) * disp;
      }
    }
  }
  out.u = su;
  out.v = sv;
  return out;
}

export function createWarpLensShader() {
  return {
    name: 'WarpLensShader',
    uniforms: {
      // Tekstura celu tła — przypisywana po utworzeniu passa (cloneUniforms
      // nie klonuje tekstur render targetów).
      tSource: { value: null },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uAxis: { value: new THREE.Vector2(1, 0) },
      uRadius: { value: new THREE.Vector2(0.1, 0.1) },
      uAspect: { value: 1 },
      uSwallow: { value: 0 },
      uPrimCount: { value: 0 },
      uPrimA: { value: Array.from({ length: WARP_SPACE_MAX_PRIMS }, () => new THREE.Vector4(-10, -10, 1, 0)) },
      uPrimB: { value: Array.from({ length: WARP_SPACE_MAX_PRIMS }, () => new THREE.Vector4(1, 1, 0, 0)) },
      // Widok skoku (warpWorldLens.js): kula + opływ. uWV = (u, v środka kuli,
      // promień kuli w osi v, β); uWVFlow = (oś lotu w UV z v w górę, faza A,
      // faza B); uWVMisc = (droga przepływu na fazę [promienie kuli], długość
      // smugi [promienie kuli], jasność opływu, siła rybiego oka).
      uWV: { value: new THREE.Vector4(0.5, 0.5, 1, 0) },
      uWVFlow: { value: new THREE.Vector4(1, 0, 0, 0.5) },
      uWVMisc: { value: new THREE.Vector4(1.2, 0.3, 0.8, 1) },
      // Front wyjścia: (położenie wzdłuż osi lotu, półszerokość pasma) w promieniach
      // kuli od statku; przed frontem (dalej w kierunku lotu) — zwykły widok.
      uWVFront: { value: new THREE.Vector4(1000, 0.35, 0, 0) },
      // Kształt: kropla (ua, ra, ub, rb) w promieniach kuli — warpDropGeometry.
      // Domyślnie koło.
      uWVDrop: { value: new THREE.Vector4(0, 1, 0, 1) }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tSource;
      uniform vec2 uCenter;
      uniform vec2 uAxis;
      uniform vec2 uRadius;
      uniform float uAspect;
      uniform float uSwallow;
      uniform int uPrimCount;
      uniform vec4 uPrimA[${WARP_SPACE_MAX_PRIMS}];
      uniform vec4 uPrimB[${WARP_SPACE_MAX_PRIMS}];
      uniform vec4 uWV;
      uniform vec4 uWVFlow;
      uniform vec4 uWVMisc;
      uniform vec4 uWVFront;
      uniform vec4 uWVDrop;
      varying vec2 vUv;
${WARP_DROP_GLSL}
      void main() {
        vec2 d = vUv - uCenter;
        d.x *= uAspect;
        vec2 perp = vec2(-uAxis.y, uAxis.x);
        // Uklad znormalizowany: elipsa soczewki = okrag o promieniu 1.
        vec2 q = vec2(dot(d, uAxis) / uRadius.x, dot(d, perp) / uRadius.y);
        float x2 = dot(q, q);
        vec2 uv = vUv;
        if (x2 < 1.0) {
          // s(x) = sqrt(x^2 + a^2 (1 - x^2)^2) — patrz naglowek warpLens3D.js.
          float w = 1.0 - x2;
          float s2 = x2 + uSwallow * uSwallow * w * w;
          vec2 qs = q * sqrt(s2 / max(x2, 1e-12));
          vec2 ds = uAxis * (qs.x * uRadius.x) + perp * (qs.y * uRadius.y);
          ds.x /= uAspect;
          uv = uCenter + ds;
        }
        // Prymitywy zgiecia (efekty warpa) po kolei na probce — lustro CPU:
        // warpSpaceSampleUv. A = (srodek u, v, os), B = (a, b, sila, typ).
        for (int i = 0; i < ${WARP_SPACE_MAX_PRIMS}; i++) {
          if (i >= uPrimCount) break;
          vec4 pa = uPrimA[i];
          vec4 pb = uPrimB[i];
          vec2 pd = uv - pa.xy;
          pd.x *= uAspect;
          vec2 pax = pa.zw;
          vec2 pper = vec2(-pax.y, pax.x);
          float pl = dot(pd, pax);
          float pc = dot(pd, pper);
          if (pb.w < 0.5) {
            // POINT: ta sama mapa s(x) co soczewka skoku.
            vec2 pq = vec2(pl / pb.x, pc / pb.y);
            float px2 = dot(pq, pq);
            if (px2 < 1.0) {
              float pw = 1.0 - px2;
              float ps2 = px2 + pb.z * pb.z * pw * pw;
              vec2 pqs = pq * sqrt(ps2 / max(px2, 1e-12));
              vec2 pds = pax * (pqs.x * pb.x) + pper * (pqs.y * pb.y);
              pds.x /= uAspect;
              uv = pa.xy + pds;
            }
          } else if (pb.w < 1.5) {
            // SEAM: mapa s w poprzek odcinka, polkniecie zwezone ku koncom.
            float pxa = pl / pb.x;
            float pya = pc / pb.y;
            if (abs(pxa) < 1.0 && abs(pya) < 1.0) {
              float ptap = 1.0 - pxa * pxa;
              float pa2 = pb.z * ptap * ptap;
              float pw = 1.0 - pya * pya;
              float ps = sqrt(pya * pya + pa2 * pa2 * pw * pw);
              vec2 pds = pax * pl + pper * (sign(pya) * ps * pb.y);
              pds.x /= uAspect;
              uv = pa.xy + pds;
            }
          } else {
            // RING: przesuniecie promieniowe (pochodna gaussa) w pasmie wokol R.
            float pr = length(pd);
            float pk = (pr - pb.x) / max(pb.y, 1e-5);
            if (abs(pk) < 3.0 && pr > 1e-5) {
              vec2 pdd = (pd / pr) * (pb.z * pk * exp(-pk * pk));
              pdd.x /= uAspect;
              uv -= pdd;
            }
          }
        }
        // Widok skoku: swiat razem z tlem zwiniety w krople wokol statku. W kropli
        // tlo jak przez rybie oko (brzeg = nieskonczonosc), na zewnatrz tlo
        // oplywa ja jak woda kamien — przeplyw potencjalny wokol walca liczony
        // w ukladzie, w ktorym kropla jest kolem (promien skalowany brzegiem
        // w kierunku piksela), rozmyty wzdluz linii pradu, przesuwany dwiema
        // fazami (flow map). Warunek na uniformie: pochodne dla mipmap zostaja poprawne.
        vec3 wvFlow = vec3(0.0);
        float wvOut = 0.0;
        if (uWV.w > 0.001) {
          vec2 wd = uv - uWV.xy;
          wd.x *= uAspect;
          float wR = max(uWV.z, 1e-4);
          vec2 wf = uWVFlow.xy;
          vec2 wpp = vec2(-wf.y, wf.x);
          float wfs = dot(wd, wf) / wR;
          float wcs = dot(wd, wpp) / wR;
          float wl = sqrt(wfs * wfs + wcs * wcs);
          float wB = wvDropExit(wl > 1e-6 ? vec2(wfs, wcs) / wl : vec2(1.0, 0.0), uWVDrop);
          float wx = wl / wB;
          // Front wyjscia: przestrzen prostuje sie najpierw PRZED statkiem —
          // piksele dalej w kierunku lotu niz front wracaja do zwyklego widoku.
          float wbeta = uWV.w * (1.0 - smoothstep(uWVFront.x - uWVFront.y, uWVFront.x + uWVFront.y, wfs));
          // Scisk przy brzegu ograniczony (~7x): dalej lustrzane zawijanie tla
          // powtarzalo sie drobnym wzorem („krzyzyki” na obwodzie kuli).
          float wxi = min(wx, 0.94);
          float wk = pow(1.0 / (1.0 - wxi * wxi), uWVMisc.w * wbeta);
          float wa = wfs / wB;
          float wb = wcs / wB;
          float wq2 = max(wa * wa + wb * wb, 1.0);
          float wq4 = wq2 * wq2;
          vec2 wvel = (wf * (-1.0 + (wa * wa - wb * wb) / wq4) + wpp * (2.0 * wa * wb / wq4)) * wR;
          float wphA = fract(uWVFlow.z);
          float wphB = fract(uWVFlow.w);
          float wwA = 1.0 - abs(wphA * 2.0 - 1.0);
          vec3 wcA = vec3(0.0);
          vec3 wcB = vec3(0.0);
          // Przesuniecie oplywu slabnie z frontem (wbeta -> 0: probka = piksel,
          // czyli zwykly widok — bez szwu na froncie wyjscia). Roztrzasanie
          // probek per piksel: bez niego cienkie smugi gwiazd robia sie kropkowane.
          float wjit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 wvb = wvel * wbeta;
          for (int k = 0; k < 12; k++) {
            float ws = (float(k) + wjit) / 12.0;
            vec2 pA = wd - wvb * (uWVMisc.x * wphA + uWVMisc.y * ws);
            vec2 pB = wd - wvb * (uWVMisc.x * wphB + uWVMisc.y * ws);
            wcA += texture2D(tSource, uWV.xy + vec2(pA.x / uAspect, pA.y)).rgb;
            wcB += texture2D(tSource, uWV.xy + vec2(pB.x / uAspect, pB.y)).rgb;
          }
          wvFlow = (wcA * wwA + wcB * (1.0 - wwA)) * (mix(1.0, uWVMisc.z, wbeta) / 12.0);
          // Brzeg kuli bez twardej granicy: wnetrze przechodzi w oplyw. Maska
          // NIE zalezy od frontu — obie probki (rybie oko i oplyw) same zbiegaja
          // do zwyklego widoku, gdy wbeta -> 0 (inaczej w pasie frontu poza kula
          // mieszala sie probka rybiego oka spoza kuli: poziome „polki”).
          wvOut = smoothstep(0.9, 1.03, wx);
          vec2 wIn = wd * wk;
          uv = uWV.xy + vec2(wIn.x / uAspect, wIn.y);
        }
        // Probkowanie poza galezia warunkowa: mipmapy biora pochodne z ciaglej
        // mapy (tlo sciskane stycznie przy srodku nie iskrzy).
        gl_FragColor = texture2D(tSource, uv);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, wvFlow, wvOut);
      }
    `
  };
}
