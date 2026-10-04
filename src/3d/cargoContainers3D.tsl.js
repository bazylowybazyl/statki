// src/3d/cargoContainers3D.tsl.js
//
// Materiały TSL kontenerów Z5 (cargoContainers3D.js) i wspólne klocki z dronami
// (cargoDrones3D.tsl.js) — port 1:1 z dawnego GLSL (CARGO_VIEW_GLSL, CARGO_LIGHT_GLSL,
// CARGO_NOISE_GLSL, CONTAINER_*, SHADOW_*).
//
// Zasady portu (AGENTS.md § „Render: WebGPU + TSL”):
//   • uniformy widoku i światła to WSPÓLNE węzły (createCargoUniforms) — kontenery, cienie
//     i drony czytają te same obiekty, kod modułu ustawia `.value` jak dawniej;
//   • pozycje względem mesh.position (początek przy kamerze) — positionNode w układzie
//     lokalnym, modelViewMatrix three składa w double (highPrecision);
//   • dane instancji = varyingi płaskie (jak flat w GLSL);
//   • pochodne (fwidth) liczone PRZED gałęziami i przed Discard (pułapki 15, 29);
//   • zanik dither z screenCoordinate (oś y od góry — wzór odbity względem GL, bez znaczenia);
//   • maska słońca: sunVisibility / sunFill z sunShadowMask.js (jeden import).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, clamp, cos, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix, mod,
  normalize, positionGeometry, pow, screenCoordinate, select, sign, sin, smoothstep, sqrt, step, uniform, varying,
  vec2, vec3, vec4
} from 'three/tsl';
import { sunFill, sunVisibility } from './sunShadowMask.js';
import { uniformNode } from './tsl/uniformy.js';

// ---------------------------------------------------------------------------
// Wspólne uniformy (kontenery, cienie, drony)
// ---------------------------------------------------------------------------

/**
 * uCgParallax: środek kadru (względem origin), wysokość kamery H, włącznik;
 * uCgDepth: ścisk nad z = 0, włącznik; uCgShip: otoczenie, rozproszone, połysk;
 * uCgPort: otoczenie, rozproszone, połysk, dzień; uCgSunRel: Słońce względem origin;
 * uCgPortSun: kierunek słońca ringu.
 */
export function createCargoUniforms() {
  return {
    uCgParallax: uniform(new THREE.Vector4(0, 0, 1e6, 0)),
    uCgDepth: uniform(new THREE.Vector2(0.02, 1)),
    uCgShip: uniform(new THREE.Vector4()),
    uCgPort: uniform(new THREE.Vector4()),
    uCgSunRel: uniform(new THREE.Vector3(-1e6, 5e5, 600)),
    uCgPortSun: uniform(new THREE.Vector3(0.5, 0.3, 0.75).normalize())
  };
}

// ---------------------------------------------------------------------------
// Widok i światło (dawne cgProject / cgLightDir / cgShade)
// ---------------------------------------------------------------------------

/** Pozycja lokalna (względem origin) po paralaksie H/(H − z) i ścisku głębi nad z = 0. */
export function cgProjectLocal(wp, U) {
  const P = U.uCgParallax;
  const D = U.uCgDepth;
  const par = P.w.greaterThan(0.5).and(wp.z.lessThan(0.0));
  const k = P.z.div(max(P.z.sub(wp.z), 1.0));
  const xy = select(par, P.xy.add(wp.xy.sub(P.xy).mul(k)), wp.xy);
  const z = select(D.y.greaterThan(0.5).and(wp.z.greaterThan(0.0)), wp.z.mul(D.x), wp.z);
  return vec3(xy, z);
}

/** Kierunek światła: słońce kadłubów (z = 600) ↔ słońce portu, wg lightMix. */
export function cgLightDir(wp, lightMix, U) {
  const ls = normalize(vec3(U.uCgSunRel.xy.sub(wp.xy), 600.0));
  return normalize(mix(ls, U.uCgPortSun, clamp(lightMix, 0.0, 1.0)));
}

/** Kierunek świata → układ obiektu o kursie (c, s). */
export function cgToObject(L, c, s) {
  return vec3(c.mul(L.x).add(s.mul(L.y)), s.negate().mul(L.x).add(c.mul(L.y)), L.z);
}

/**
 * Cieniowanie pokładu statku / portu (wołać w Fn fragmentu). hullL: jasność kadłuba pod
 * obiektem; N i L w tym samym układzie.
 */
export function cgShade(albedo, N, L, lightMix, hullL, specK, specPow, U) {
  const S = U.uCgShip;
  const Pp = U.uCgPort;
  const sunVis = sunVisibility().toVar();
  const NdotL = dot(N, L).toVar();
  const upK = max(N.z, 0.0).mul(0.45).add(0.55);
  const diff = max(NdotL, 0.0);
  const shipAmb = S.x.mul(sunFill(sunVis)).add(max(hullL.sub(S.x), 0.0).mul(sunVis));
  const ship = shipAmb.mul(upK).add(diff.mul(S.y).mul(sunVis));
  const port = Pp.x.mul(upK).add(diff.mul(Pp.y).mul(Pp.w));
  const m = clamp(lightMix, 0.0, 1.0);
  const col = vec3(albedo).mul(mix(ship, port, m)).toVar();
  const H = normalize(L.add(vec3(0.0, 0.0, 1.0)));
  const sp = pow(max(dot(N, H), 0.0), specPow).mul(smoothstep(-0.02, 0.08, NdotL));
  const spK = mix(S.z.mul(sunVis), Pp.z.mul(Pp.w), m);
  col.addAssign(vec3(sp.mul(specK).mul(spK)));
  // Powierzchnia nie świeci: jasne skosy łagodnie dochodzą do ~0,86 (pod progiem bloomu).
  const lum = dot(col, vec3(0.2126, 0.7152, 0.0722)).toVar();
  If(lum.greaterThan(0.62), () => {
    col.mulAssign(float(0.62).add(float(1.0).sub(exp(lum.sub(0.62).div(0.24).negate())).mul(0.24)).div(lum));
  });
  return col;
}

// ---------------------------------------------------------------------------
// Szum i zanik (dawne CARGO_NOISE_GLSL)
// ---------------------------------------------------------------------------

export function cgHash(p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

export function cgNoise(p) {
  const i = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(vec2(3.0).sub(f0.mul(2.0)));
  return mix(
    mix(cgHash(i), cgHash(i.add(vec2(1.0, 0.0))), f.x),
    mix(cgHash(i.add(vec2(0.0, 1.0))), cgHash(i.add(vec2(1.0, 1.0))), f.x),
    f.y
  );
}

/** Zanik z odległością: rozrzut w ekranie (wołać w Fn fragmentu). */
export function cgDitherDiscard(a) {
  If(a.lessThan(0.999).and(cgHash(floor(screenCoordinate.xy)).greaterThan(a)), () => { Discard(); });
}

const flat = (node, name) => varying(node, name).setInterpolation('flat');

function baseMaterial(name) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.lights = false;
  m.fog = false;
  return m;
}

// ---------------------------------------------------------------------------
// Kontenery
// ---------------------------------------------------------------------------

/**
 * Materiał kontenerów. U — wspólne uniformy, P — wpisy adaptera palet
 * (uStd, uShell, uFrame, uBody, uRes, uHazmat, uCover, uAmber), counts — długości palet.
 */
export function createContainerMaterial(U, P, counts) {
  const m = baseMaterial('CARGO3D_CONTAINERS');
  m.transparent = true;
  m.depthWrite = true;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.forceSinglePass = true;

  const iPos = attribute('iPos', 'vec4');
  const iSize = attribute('iSize', 'vec4');
  const iLook = attribute('iLook', 'vec4');
  const iExtra = attribute('iExtra', 'vec4');
  const bev = min(min(iSize.x, iSize.y).mul(0.07), iSize.z.mul(0.3));
  const lp = positionGeometry.mul(iSize.xyz).add(attribute('aBevel', 'vec3').mul(bev));
  const c = cos(iPos.w);
  const s = sin(iPos.w);
  const wz = max(iPos.z.add(lp.z), iExtra.x);   // wyłaz windy placu: część pod cięciem ściśnięta
  const wp = vec3(iPos.x.add(c.mul(lp.x)).sub(s.mul(lp.y)), iPos.y.add(s.mul(lp.x)).add(c.mul(lp.y)), wz);
  m.positionNode = cgProjectLocal(wp, U);

  const vLocal = varying(vec3(lp.xy, wz.sub(iPos.z)), 'vCgLocal');
  const vObjN = varying(attribute('normal', 'vec3'), 'vCgObjN');
  const vObjL = varying(cgToObject(cgLightDir(wp, iLook.w, U), c, s), 'vCgObjL');
  const vLook = flat(iLook, 'vCgLook');
  const vExtra = flat(iExtra, 'vCgExtra');
  const vSize = flat(iSize, 'vCgSize');

  const uStd = uniformNode(P.uStd);
  const uShell = uniformNode(P.uShell);
  const uFrame = uniformNode(P.uFrame);
  const uBody = uniformNode(P.uBody);
  const uRes = uniformNode(P.uRes);
  const idx = (h, n) => int(clamp(floor(h.mul(n)), 0.0, n - 1));

  m.fragmentNode = Fn(() => {
    // Pochodne przed Discard i gałęziami.
    const fwc = fwidth(vLocal.xy);
    const px = max(max(fwc.x, fwc.y), 1e-4).toVar();
    cgDitherDiscard(vSize.w);
    const N = normalize(vObjN).toVar();
    const fam = vLook.x;
    const seed = vLook.z.toVar();
    const hullL = vExtra.w;
    const packedGrid = vExtra.y;
    const nx = max(1.0, mod(packedGrid, 8.0)).toVar();
    const ny = max(1.0, mod(floor(packedGrid.div(8.0)), 8.0)).toVar();
    const tiers = max(1.0, floor(packedGrid.div(64.0))).toVar();
    const matCode = mod(vExtra.z, 16.0).toVar();
    const hazmat = vExtra.z.greaterThanEqual(15.5);
    const accent = vec3(uRes.element(int(vLook.y.add(0.5)))).toVar();
    const size = vSize.xy;
    const cell = size.div(vec2(nx, ny)).toVar();
    const q = vLocal.xy.add(size.mul(0.5)).div(cell);
    const cid = clamp(floor(q), vec2(0.0), vec2(nx, ny).sub(1.0)).toVar();
    const cc = q.sub(cid).sub(0.5).mul(cell).toVar();
    const hs = cell.mul(0.5).toVar();
    const cellSeed = cgHash(cid.add(vec2(seed.mul(71.3), seed.mul(17.9)))).toVar();
    const Nb = vec3(N).toVar();
    const albedo = vec3(0.0).toVar();
    const specK = float(0.6).toVar();
    const specPow = float(24.0).toVar();
    const top = N.z.greaterThan(0.9);
    const chamfer = N.z.greaterThan(0.3).and(top.not());
    const minCell = min(cell.x, cell.y).toVar();

    If(fam.greaterThan(2.5), () => {
      // Płyta maski ładowni: grafit, bursztynowy obrys, zamki w narożach.
      const d = size.mul(0.5).sub(abs(vLocal.xy)).toVar();
      const edge = min(d.x, d.y);
      albedo.assign(vec3(P.uCover).mul(cgNoise(vLocal.xy.mul(0.8)).mul(0.2).add(0.9)));
      const line = min(size.x, size.y).mul(0.05).toVar();
      albedo.assign(mix(albedo, P.uAmber, float(1.0).sub(smoothstep(line.mul(0.6), line.mul(0.6).add(px), abs(edge.sub(line.mul(1.6))))).mul(0.9)));
      const corner = step(d.x, line.mul(2.4)).mul(step(d.y, line.mul(2.4)));
      albedo.assign(mix(albedo, vec3(0.12), corner.mul(0.7)));
      specK.assign(0.2);
    }).ElseIf(fam.greaterThan(1.5), () => {
      // ZSYP: burty i otwarty wierzch z usypanym ładunkiem (przegrody = podsiatka).
      const body = vec3(uBody.element(idx(cellSeed, counts.body)));
      albedo.assign(body.mul(cgNoise(vLocal.xy.mul(0.35).add(seed)).mul(0.25).add(0.85)));
      If(top, () => {
        const rim = minCell.mul(0.09).add(0.25).toVar();
        const dd = hs.sub(abs(cc));
        const inner = min(dd.x, dd.y).sub(rim).toVar();
        If(inner.greaterThan(0.0), () => {
          const hn = cc.div(max(hs.sub(rim), vec2(0.2))).toVar();
          const lump = float(3.0).div(max(minCell, 1.0));
          const np = cc.mul(lump.mul(4.0)).add(cid.mul(7.1)).add(seed).toVar();
          const n1 = cgNoise(np).toVar();
          const n2 = cgNoise(np.mul(2.3).add(5.1)).toVar();
          // Kopiec: pochyła ku burtom, grudki z szumu (gradient → normalna).
          const g = hn.mul(-2.0).mul(vec2(float(1.0).sub(hn.y.mul(hn.y)), float(1.0).sub(hn.x.mul(hn.x)))).mul(0.6).toVar();
          g.addAssign(vec2(cgNoise(np.add(vec2(0.4, 0.0))), cgNoise(np.add(vec2(0.0, 0.4)))).sub(n1).mul(2.2));
          const mat = vec3(accent).toVar();
          const mc = matCode;
          If(mc.lessThan(0.5), () => {
            mat.mulAssign(mix(float(0.55), float(1.15), n1.mul(0.7).add(n2.mul(0.3))));
          }).ElseIf(mc.lessThan(1.5), () => {
            mat.assign(mix(accent, vec3(0.92, 0.97, 1.0), n2.mul(0.35).add(0.45)).mul(n1.mul(0.3).add(0.85)));
            specK.assign(1.6); specPow.assign(60.0);
          }).ElseIf(mc.lessThan(2.5), () => {
            const pick = cgHash(floor(np.mul(1.6))).toVar();
            mat.assign(select(pick.lessThan(0.35), vec3(0.22, 0.12, 0.06), select(pick.lessThan(0.7), accent, vec3(0.12, 0.14, 0.17))));
            mat.mulAssign(n2.mul(0.6).add(0.7));
            g.mulAssign(1.8);
            specK.assign(1.0);
          }).ElseIf(mc.lessThan(3.5), () => {
            const bw = max(cell.y.div(9.0), 0.3).toVar();
            const fb = fract(cc.y.div(bw)).toVar();
            g.assign(vec2(0.0, fb.sub(0.5).mul(3.0)));
            mat.assign(accent.mul(sin(fb.mul(3.1416)).mul(0.4).add(0.75)).mul(cgHash(vec2(floor(cc.y.div(bw)), cid.x)).mul(0.2).add(0.9)));
            specK.assign(1.2); specPow.assign(40.0);
          }).ElseIf(mc.lessThan(4.5), () => {
            const cd = max(minCell.div(3.2), 0.4);
            const cq = fract(cc.div(cd)).sub(0.5).toVar();
            const rr = length(cq).mul(2.0).toVar();
            const ring = cos(rr.mul(18.0)).mul(0.5).add(0.5);
            mat.assign(accent.mul(ring.mul(0.5).add(0.6)).mul(step(rr, 0.95)).add(vec3(0.02).mul(step(0.95, rr))));
            g.assign(cq.mul(1.5));
            specK.assign(1.3); specPow.assign(36.0);
          }).ElseIf(mc.lessThan(5.5), () => {
            mat.mulAssign(cgNoise(np.mul(5.0)).mul(0.35).add(0.8));
            g.mulAssign(0.4);
          }).Else(() => {
            const f = cgNoise(np.mul(1.7));
            mat.assign(mix(accent.mul(0.6), vec3(0.95, 0.9, 1.0), smoothstep(0.62, 0.8, f)));
            const fl = floor(np.mul(1.7)).toVar();
            g.assign(vec2(cgHash(fl), cgHash(fl.add(3.3))).sub(0.5).mul(2.4));
            specK.assign(2.0); specPow.assign(80.0);
          });
          // Cień przy burtach (ładunek niżej niż krawędź).
          const ao = smoothstep(0.0, rim.mul(3.0).add(0.4), inner);
          albedo.assign(mat.mul(ao.mul(0.55).add(0.45)));
          Nb.assign(normalize(vec3(g, 1.0)));
        }).Else(() => {
          albedo.mulAssign(1.12);
        });
      }).Else(() => {
        // Burty: pionowe żebra.
        const rib = cos(dot(vLocal.xy, vec2(1.0)).div(max(minCell.mul(0.18), 0.2)).mul(3.1416)).mul(0.5).add(0.5);
        albedo.mulAssign(rib.mul(0.12).add(0.88));
      });
    }).ElseIf(fam.greaterThan(0.5), () => {
      // ZBIORNIK (ISO tank): rama na końcach, walec wzdłuż, pas barwy ładunku, pomost.
      const shell = vec3(uShell.element(idx(cellSeed, counts.shell))).toVar();
      const frame = vec3(uFrame.element(idx(cgHash(vec2(seed, 3.7)), counts.frame))).toVar();
      albedo.assign(frame);
      If(top, () => {
        const endW = cell.x.mul(0.09).toVar();
        const r = hs.y.mul(0.97);
        const yy = cc.y.div(r).toVar();
        const ax = abs(cc.x).toVar();
        If(ax.greaterThan(hs.x.sub(endW)), () => {
          const dd = hs.sub(abs(cc));
          const cst = hs.y.mul(0.16);
          albedo.assign(frame.mul(select(step(min(dd.x, dd.y), cst).greaterThan(0.5), float(0.45), float(1.0))));
        }).ElseIf(abs(yy).lessThan(1.0), () => {
          const zz = sqrt(max(float(1.0).sub(yy.mul(yy)), 0.0));
          // Dennica: ostatnie ~12% długości walca schodzi ku ramie.
          const headZone = cell.x.mul(0.12);
          const hd = smoothstep(hs.x.sub(endW).sub(headZone), hs.x.sub(endW), ax).toVar();
          Nb.assign(normalize(vec3(sign(cc.x).mul(hd).mul(1.4), yy.mul(1.15), zz)));
          const base = shell.mul(cgNoise(cc.mul(0.6).add(seed)).mul(0.1).add(0.9)).mul(float(1.0).sub(hd.mul(0.35))).toVar();
          const bandW = cell.x.mul(0.045);
          const band = float(1.0).sub(smoothstep(bandW, bandW.add(px), abs(ax.sub(hs.x.mul(0.42)))));
          base.assign(mix(base, accent, band.mul(float(1.0).sub(hd))));
          const walk = float(1.0).sub(smoothstep(hs.y.mul(0.05), hs.y.mul(0.05).add(px), abs(cc.y)));
          base.assign(mix(base, base.mul(0.55), walk.mul(float(1.0).sub(hd))));
          albedo.assign(base);
          specK.assign(1.5); specPow.assign(40.0);
        }).Else(() => {
          albedo.assign(frame.mul(0.3));
        });
      }).Else(() => {
        // Boki: rama i cień walca między słupkami.
        const post = smoothstep(hs.x.sub(cell.x.mul(0.13)), hs.x.sub(cell.x.mul(0.1)), abs(cc.x));
        albedo.assign(mix(shell.mul(0.55), frame, post));
      });
    }).Else(() => {
      // STANDARD: dach z przetłoczeniami w poprzek, narożniki, farba z palety.
      const paint = select(hazmat, vec3(P.uHazmat), vec3(uStd.element(idx(cellSeed, counts.std)))).toVar();
      albedo.assign(paint);
      If(top, () => {
        const period = max(cell.x.div(10.0), 0.2).toVar();
        const ribAA = float(1.0).sub(smoothstep(0.25, 0.6, px.div(period))).toVar();
        const ph = cc.x.div(period).mul(6.2832).toVar();
        const rib = cos(ph).mul(0.5).add(0.5);
        albedo.mulAssign(float(1.0).sub(rib.mul(0.16).mul(ribAA)));
        Nb.assign(normalize(vec3(sin(ph).negate().mul(0.22).mul(ribAA), 0.0, 1.0)));
        const dir = select(cgHash(vec2(seed, cid.x)).greaterThan(0.5), float(1.0), float(-1.0));
        const door = smoothstep(hs.x.mul(0.9), hs.x.mul(0.92), cc.x.mul(dir));
        albedo.mulAssign(float(1.0).sub(door.mul(0.22)));
        const cst = minCell.mul(0.075).add(0.12);
        const dd = hs.sub(abs(cc));
        albedo.assign(mix(albedo, vec3(0.06), step(dd.x, cst).mul(step(dd.y, cst))));
        If(hazmat, () => {
          // Pas ostrzegawczy (ukośne pasy żółto-czarne) i romb nalepki hazmat.
          const base = vec3(albedo).toVar();
          const band = smoothstep(hs.x.mul(0.62), hs.x.mul(0.66), abs(cc.x));
          const stripe = step(0.5, fract(cc.x.add(cc.y).div(max(hs.y.mul(0.55), 0.2))));
          albedo.assign(mix(albedo, mix(base, vec3(0.018), stripe), band));
          const rr = min(hs.x, hs.y).mul(0.46).toVar();
          const dm = abs(cc.x).add(abs(cc.y)).toVar();
          albedo.assign(mix(albedo, vec3(0.8), float(1.0).sub(smoothstep(rr.mul(0.98), rr.mul(1.04), dm))));
          albedo.assign(mix(albedo, accent, float(1.0).sub(smoothstep(rr.mul(0.78), rr.mul(0.84), dm))));
        });
        const grime = smoothstep(0.55, 0.95, cgNoise(vLocal.xy.mul(float(0.9).div(max(cell.y, 0.5))).add(seed.mul(3.0))));
        albedo.mulAssign(float(1.0).sub(grime.mul(0.18)));
      }).ElseIf(chamfer.not(), () => {
        const period = max(cell.x.div(18.0), 0.18);
        const rib = cos(vLocal.x.add(vLocal.y).div(period).mul(6.2832)).mul(0.5).add(0.5);
        albedo.mulAssign(rib.mul(0.1).add(0.9));
        If(hazmat, () => {
          albedo.assign(mix(albedo, vec3(0.018), step(0.5, fract(vLocal.x.add(vLocal.z).div(max(cell.y.mul(0.3), 0.2)))).mul(0.8)));
        });
      });
    });
    // Szczeliny podsiatki (moduł = kilka kontenerów w ramie) i piętra na bokach.
    If(nx.mul(ny).greaterThan(1.5).and(top), () => {
      const dd = hs.sub(abs(cc));
      const seam = float(1.0).sub(smoothstep(0.0, max(minCell.mul(0.035), px), min(dd.x, dd.y)));
      albedo.assign(mix(albedo, vec3(0.02), seam.mul(0.85)));
    });
    If(tiers.greaterThan(1.5).and(top.not()), () => {
      const tz = fract(vLocal.z.div(max(vSize.z.div(tiers), 0.1))).toVar();
      const seam = float(1.0).sub(smoothstep(0.0, 0.06, min(tz, float(1.0).sub(tz))));
      albedo.mulAssign(float(1.0).sub(seam.mul(0.7)));
    });
    If(chamfer, () => { albedo.mulAssign(1.08); });
    const col = cgShade(albedo, Nb, normalize(vObjL), vLook.w, hullL, specK, specPow, U);
    return vec4(col, 1.0);
  })();
  return m;
}

// ---------------------------------------------------------------------------
// Cienie (kadłub GREATER / pokład portu)
// ---------------------------------------------------------------------------

function cgSdBox(p, b) {
  const d = abs(p).sub(b);
  return length(max(d, vec2(0.0))).add(min(max(d.x, d.y), 0.0));
}

// Prostokąt przeciągnięty od o0 do o1 (6 próbek wzdłuż cienia).
function cgSwept(p, hs, o0, o1) {
  let d = null;
  for (let i = 0; i < 6; i++) {
    const di = cgSdBox(p.sub(mix(o0, o1, i / 5)), hs);
    d = d === null ? di : min(d, di);
  }
  return d;
}

/**
 * Materiał cieni. S — wpisy adaptera { uShadow, uShadowMix } (per materiał),
 * deck — pokład portu (LessEqual) albo kadłub (Greater). hullShadowZ — z odbiornika.
 */
export function createShadowMaterial(U, S, deck, hullShadowZ) {
  const m = baseMaterial(deck ? 'CARGO3D_DECK_SHADOW' : 'CARGO3D_HULL_SHADOW');
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.depthFunc = deck ? THREE.LessEqualDepth : THREE.GreaterDepth;
  m.blending = THREE.NormalBlending;
  const uShadow = S.uShadow;
  const uShadowMix = S.uShadowMix;

  const iPos = attribute('iPos', 'vec4');
  const iBox = attribute('iBox', 'vec4');
  const iPar = attribute('iPar', 'vec4');
  const c = cos(iPos.w);
  const s = sin(iPos.w);
  // Kierunek od słońca i tangens wysokości: kadłub — „słońce cieni” (azymut prawdziwego
  // słońca, niska wysokość), port — słońce ringu.
  const isDeck = uShadow.w.greaterThan(0.5);
  const h = U.uCgPortSun.xy;
  const hl = max(length(h), 1e-4);
  const dirPort = h.negate().div(hl);
  const dirHull = normalize(U.uCgSunRel.xy.sub(iPos.xy).add(vec2(1e-3, 0.0))).negate();
  const dirW = select(isDeck, dirPort, dirHull);
  const tanE = select(isDeck, max(U.uCgPortSun.z.div(hl), 0.05), uShadow.x);
  const baseZ = select(isDeck, iPar.w, float(0.0));
  const dirL = vec2(c.mul(dirW.x).add(s.mul(dirW.y)), s.negate().mul(dirW.x).add(c.mul(dirW.y)));
  const o0 = dirL.mul(max(iBox.z.sub(baseZ), 0.0)).div(tanE);
  const o1 = dirL.mul(max(iBox.w.sub(baseZ), 0.0)).div(tanE);
  const hsV = iBox.xy.mul(0.5);
  const pad = uShadow.z.mul(length(o1)).add(min(iBox.x, iBox.y).mul(0.25)).add(0.5);
  const lo = hsV.negate().add(min(min(o0, o1), vec2(0.0))).sub(pad);
  const hi = hsV.add(max(max(o0, o1), vec2(0.0))).add(pad);
  const mm = mix(lo, hi, positionGeometry.xy.add(0.5));
  const xy = vec2(iPos.x.add(c.mul(mm.x)).sub(s.mul(mm.y)), iPos.y.add(s.mul(mm.x)).add(c.mul(mm.y)));
  // Pokład portu: paralaksa jak płyta pod nim. Kadłub: tuż pod nim, bez paralaksy.
  m.positionNode = select(isDeck, cgProjectLocal(vec3(xy, baseZ.add(0.3)), U), vec3(xy, hullShadowZ));

  const vP = varying(mm, 'vCgP');
  const vBox = flat(iBox, 'vCgBox');
  const vPar = flat(iPar, 'vCgPar');
  const vOff = flat(vec4(o0, o1), 'vCgOff');

  m.fragmentNode = Fn(() => {
    const hs = vBox.xy.mul(0.5).toVar();
    // Obie odległości i ich pochodne przed gałęzią (WGSL: pochodne w jednolitym przepływie).
    const dBox = cgSdBox(vP, hs).toVar();
    const dSw = cgSwept(vP, hs, vOff.xy, vOff.zw).toVar();
    const aaBox = max(fwidth(dBox), 1e-3).toVar();
    const aaSw = max(fwidth(dSw), 1e-3).toVar();
    const a = float(0.0).toVar();
    If(vPar.z.greaterThan(0.5), () => {
      // Właz windy placu: ciemny prostokąt o ostrych brzegach.
      a.assign(float(1.0).sub(smoothstep(aaBox.negate(), aaBox, dBox)).mul(vPar.x));
    }).Else(() => {
      const reach = length(vOff.zw);
      const minB = min(vBox.x, vBox.y);
      const soft = max(uShadow.y.mul(reach).add(minB.mul(0.06)), aaSw).toVar();
      const body = float(1.0).sub(smoothstep(soft.negate(), soft, dSw));
      // Kontakt: przy podstawie stojącego kontenera ciemniej (AO).
      const contact = float(1.0).sub(smoothstep(0.0, minB.mul(0.18).add(0.3), dBox)).mul(vPar.y);
      const vis = select(uShadow.w.greaterThan(0.5), uShadowMix.x, sunVisibility());
      a.assign(max(body.mul(vis), contact).mul(vPar.x));
    });
    If(a.lessThan(0.003), () => { Discard(); });
    return vec4(0.0, 0.0, 0.0, min(a, 0.9));
  })();
  return m;
}
