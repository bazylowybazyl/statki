// src/3d/gasGiantAtmosphere.tsl.js
//
// Żywa atmosfera gazowego olbrzyma — barwa dnia z przepływu (TSL), wspólna dla Jowisza i Saturna. Gałąź grafu
// powierzchni planety: rodzaje 'jupiter' / 'saturn' w planet3d.assets.tsl.js to ten sam graf co 'surface'
// (oświetlenie, terminator, pas zachodu, cień ringu, bloom — 1:1), tylko próbka mapy dnia idzie przez barwę z
// przepływu. Dane, pasy, wiry, zegar: gasGiantAtmosphere.js (model planety: jupiterAtmosphere.js, saturnAtmosphere.js).
//
// Dla każdego piksela (uv mapy: u na wschód, v = 1 — biegun N, szerokość planetocentryczna):
//   1) wiatr strefowy w(φ), ścinanie i maska turbulencji z tekstury profilu;
//   2) PAS: najbliższa granica segmentów (tablica pasów: górna granica v, przesunięcie sztywne u z CPU, prędkość
//      kątowa) — segment pod pikselem i waga sąsiada w pasie przenikania ±blendDeg;
//   3) WIR: najbliższy owal (tablica wirów) w układzie swojego pasa-plateau (środek jedzie z pasem): promień
//      eliptyczny ρ (obrzeże = 1), kąt obrotu sztywnego z CPU;
//   4) dwie fazy: wiek τ = fract(s + φ_szum) · T. Położenie wsteczne w fazie:
//        • pas: u − przesunięcie sztywne − (w / cos φ · k − ω_pasa) · τ (reszta prędkości; słabnie przy wirze)
//          − turbulencja (pole wirowe curl3D niesione przez pas, przekrój = ziarno fazy, siła ze ścinania),
//        • wir: obrót wstecz po elipsie o kąt sztywny + (ω(ρ) − ω_sztywne) · τ (kołnierz szybciej, wnętrze wolniej);
//   5) CZAPA POLARNA (model z `poles`, Saturn): za granicą czapy współrzędne azymutalne wokół bieguna (ρ — odległość
//      kątowa od bieguna wzdłuż LINII PRĄDU: okręgu albo sześciokąta dżetu płn.), obrót wstecz o kąt jądra (sztywny,
//      CPU) + (ω(ρ) − ω_jądra) · τ; ω(ρ) = w / (R sin ρ) z tej samej tekstury profilu;
//   6) barwa: próbki z gradientami NIEPRZESUNIĘTEGO uv (bez szwu mipmap na skoku fazy i na zawinięciu u),
//      przenikanie faz z zachowaniem kontrastu, potem pasy (granica), wir (maska po ρ) i czapa — przenikanie barwą.
// Próbki tylko z jawnym gradientem / poziomem — dozwolone w gałęziach; pętle po pasach i wirach tylko przypisują
// zmienne. Funkcje bez setLayout (wklejane — zależą od uniformów, pułapka 1).
import {
  If, Loop, float, int, vec2, vec3, texture, texture3D,
  abs, clamp, cos, sin, floor, fract, length, log2, max, mix, mod, smoothstep, sqrt
} from 'three/tsl';
import { fxNoise } from './fx/noise.js';
import { GAS_SEED_WRAP, GAS_VORTEX_MASK as VM, GAS_VORTEX_VEC4 as VS } from './gasGiantAtmosphere.js';

const D2R = Math.PI / 180;

/**
 * Kształt linii prądu dżetu wielokątnego (sześciokąt Saturna): r(λ) / r̄ dla kierunku λ [rad] — wielokąt foremny
 * o `sides` bokach, wierzchołek w λ0, średnia po kącie = 1. Lustro CPU: polygonShapeCpu (generator: saturn.py).
 */
export function polygonMeanCpu(sides) {
  const a = Math.PI / sides;
  return Math.cos(a) * Math.log(1 / Math.cos(a) + Math.tan(a)) / a;
}
export function polygonShapeCpu(lam, sides, lam0) {
  const a = Math.PI / sides;
  const seg = 2 * a;
  let x = (lam - lam0) % seg;
  if (x < 0) x += seg;
  return Math.cos(a) / Math.cos(x - a) / polygonMeanCpu(sides);
}

/**
 * Barwa mapy dnia z przepływu (rgb, liniowo — jak próbka mapy sRGB) dla modelu planety (GasGiantModel). Zwraca
 * funkcję wołaną wewnątrz Fn fragmentu grafu powierzchni: `dayTex` — węzeł tekstury dnia per obiekt (uv = uv
 * siatki), `uv` — uv siatki, `st0` / `st1` — pochodne uv policzone przed gałęziami, `U` — uniformy per obiekt
 * (w tym klucze modelu).
 */
export function createGasGiantFlowDayColor(model) {
  const DAY_TEX_SIZE = vec2(model.texSize[0], model.texSize[1]);
  const BAND_HALF_V = model.bands.blendDeg / 180;
  const BAND_CAP = model.bandCap;
  const VORTEX_CAP = model.vortexCap;
  const K = model.keys;

  return function gasGiantFlowDayColor({ dayTex, uv: uvIn, st0, st1, U }) {
    const C = U[K.clock];   // x: zegar faz s, y: okres T [s gry], z: s rzeczywistych na s gry, w: wł.
    const F = U[K.flow];    // x: k (u na s gry na m/s na równiku), y: rozsunięcie faz, z: kontrast, w: tempo wirów
    const Tb = U[K.turb];   // x: prędkość wirów turbulencji [m/s], y: dno poza ścinaniem, z / w: okresy szumu u / v
    const BANDS = model.bandArray();
    const VORT = model.vortexArray();
    const windTex = model.windTexture();
    const curlTex = fxNoise.curl3D();
    const tileTex = fxNoise.tile2D();

    const u = uvIn.x.toVar();
    const v = uvIn.y.toVar();
    const lat = v.sub(0.5).mul(Math.PI);
    const cosLat = max(cos(lat), 0.06).toVar();
    // R — wiatr [m/s], G — ścinanie (0…1), B — maska turbulencji (gaśnie ku biegunom)
    const wind = texture(windTex, vec2(v, 0.5)).level(0).toVar();
    const windU = wind.x.mul(F.x).div(cosLat).toVar();   // prędkość kątowa wiatru [u na s gry]

    // Pas: najbliższa granica segmentów (x = górna granica segmentu i, w v).
    const bBest = float(8.0).toVar();
    const bj = int(0).toVar();
    Loop(BAND_CAP - 1, ({ i }) => {
      const d = abs(v.sub(BANDS.element(i).x));
      If(d.lessThan(bBest), () => {
        bBest.assign(d);
        bj.assign(i);
      });
    });
    const segLo = BANDS.element(bj).toVar();
    const segHi = BANDS.element(bj.add(1)).toVar();
    const bandW = smoothstep(segLo.x.sub(BAND_HALF_V), segLo.x.add(BAND_HALF_V), v).toVar();   // waga segmentu wyżej

    // Wir: najbliższy owal w układzie swojego pasa-plateau (B.w — indeks segmentu; środek jedzie z pasem).
    const vBest = float(8.0).toVar();
    const vi = int(0).toVar();
    Loop(VORTEX_CAP, ({ i }) => {
      const A = VORT.element(i.mul(VS));
      const off = BANDS.element(int(VORT.element(i.mul(VS).add(1)).w)).y.mul(C.w);
      const X = fract(u.sub(off).sub(A.x).add(0.5)).sub(0.5).div(max(A.z, 1e-6));
      const Y = v.sub(A.y).div(max(A.w, 1e-6));
      const r = sqrt(X.mul(X).add(Y.mul(Y)));
      If(A.z.greaterThan(0.0).and(r.lessThan(vBest)), () => {
        vBest.assign(r);
        vi.assign(i);
      });
    });
    const VA = VORT.element(vi.mul(VS)).toVar();
    const VB = VORT.element(vi.mul(VS).add(1)).toVar();
    const VC = VORT.element(vi.mul(VS).add(2)).toVar();
    const vOff = BANDS.element(int(VB.w)).y.mul(C.w);
    const rel = vec2(
      fract(u.sub(vOff).sub(VA.x).add(0.5)).sub(0.5).div(max(VA.z, 1e-6)),
      v.sub(VA.y).div(max(VA.w, 1e-6))
    ).toVar();
    // obrót [rad na s gry]: kołnierz — cały ω(ρ) z dwiema fazami, jądro — ω(ρ) − część sztywna VC.x (sztywna: kąt
    // VB.z z CPU). Lustra: vortexOmega, vortexRigid.
    const omegaRho = VB.x.mul(mix(VB.y, 1.0, smoothstep(0.0, 0.8, vBest))).mul(float(1.0).sub(smoothstep(0.95, 1.4, vBest)))
      .mul(C.z).mul(F.w).toVar();
    const omegaCore = omegaRho.sub(VB.x.mul(VC.x).mul(C.z).mul(F.w)).toVar();
    // maski: przenikanie z tłem na jasnym kołnierzu za brzegiem owalu, jądro obracane sztywnie (tylko z VC.x > 0)
    const vortexW = float(1.0).sub(smoothstep(VM.edgeIn, VM.edgeOut, vBest)).toVar();
    const coreW = float(1.0).sub(smoothstep(VM.coreIn, VM.coreOut, vBest)).mul(VC.x.greaterThan(0.0).select(1.0, 0.0)).toVar();
    const zonalDamp = smoothstep(1.0, 1.9, vBest).toVar();

    // Fazy: zegar przesunięty wolnym szumem (u × 3 — okresowe na zawinięciu u).
    const nz = texture(tileTex, vec2(u.mul(3.0), v.mul(1.5))).level(0).w;
    const s = C.x.add(nz.mul(F.y)).toVar();
    const f0 = fract(s).toVar();
    const w0 = float(1.0).sub(abs(f0.mul(2.0).sub(1.0))).toVar();
    const w1 = float(1.0).sub(w0).toVar();
    const tau0 = f0.mul(C.y).mul(C.w).toVar();
    const tau1 = fract(s.add(0.5)).mul(C.y).mul(C.w).toVar();
    const seed0 = mod(floor(s), GAS_SEED_WRAP).toVar();
    const seed1 = mod(floor(s.add(0.5)), GAS_SEED_WRAP).toVar();

    // Turbulencja: siła [m/s] ze ścinania (dno eddyFloor), słabsza w wirze; składowe pola wirowego w uv z prędkości
    // fizycznej (komórka szumu: 2πR cos φ / Su × πR / Sv) — cos φ się skraca, bez wybuchu przy biegunach.
    const eddyAmp = Tb.x.mul(mix(Tb.y, 1.0, wind.y)).mul(wind.z).mul(mix(1.0, 0.35, vortexW)).mul(F.x).toVar();
    const eddyKu = Tb.w.mul(2.0).div(Tb.z).toVar();

    // Ślad piksela w tekselach mapy (korekta kontrastu, poziom średniej lokalnej).
    const footprint = max(max(length(st0.mul(DAY_TEX_SIZE)), length(st1.mul(DAY_TEX_SIZE))), 1.0).toVar();
    const muLevel = max(log2(footprint).add(3.0), 4.0).toVar();

    // Położenie wsteczne w pasie (segment `seg`) dla fazy (τ, ziarno).
    const bandPos = (seg, tau, seed) => {
      const resid = windU.sub(seg.z.mul(C.z)).mul(zonalDamp);
      const pu = u.sub(seg.y.mul(C.w)).sub(resid.mul(tau)).toVar();
      const sOff = vec3(fract(seed.mul(0.6180339)), fract(seed.mul(0.3819660)), fract(seed.mul(0.7548777)));
      const c = texture3D(curlTex, vec3(pu.mul(Tb.z), v.mul(Tb.w), 0.0).add(sOff)).level(0).xy;
      const e = c.mul(eddyAmp.mul(tau));
      return vec2(fract(pu.sub(e.x.mul(eddyKu))), clamp(v.sub(e.y.mul(2.0)), 0.0005, 0.9995));
    };
    // Położenie wsteczne w wirze (tekstura w miejscu owalu na mapie) dla fazy τ: kąt sztywny + prędkość × τ.
    const vortexPos = (rigidAngle, omega, tau) => {
      const ang = rigidAngle.add(omega.mul(tau));
      const ca = cos(ang);
      const sa = sin(ang);
      const x2 = rel.x.mul(ca).add(rel.y.mul(sa));
      const y2 = rel.y.mul(ca).sub(rel.x.mul(sa));
      return vec2(fract(VA.x.add(x2.mul(VA.z))), clamp(VA.y.add(y2.mul(VA.w)), 0.0005, 0.9995));
    };
    // Dwie fazy → barwa. Korekta kontrastu: przy przenikaniu dwóch RÓŻNYCH obrazów (próbki faz dalej niż kilka
    // śladów piksela) średnia traci wariancję — wraca ona wokół średniej lokalnej (mipmapa 3 poziomy nad śladem).
    // Przy bliskich próbkach (obrazy zgodne) bez korekty — spokojne pasy nie pulsują kontrastem.
    const pair = (p0, p1) => {
      const c0 = dayTex.sample(p0).grad(st0, st1).rgb;
      const c1 = dayTex.sample(p1).grad(st0, st1).rgb;
      const lin = c0.mul(w0).add(c1.mul(w1));
      const dUV = vec2(fract(p0.x.sub(p1.x).add(0.5)).sub(0.5), p0.y.sub(p1.y));
      const k = F.z.mul(smoothstep(1.0, 6.0, length(dUV.mul(DAY_TEX_SIZE)).div(footprint)));
      const mu = dayTex.sample(p0).level(muLevel).rgb;
      const norm = sqrt(w0.mul(w0).add(w1.mul(w1)));
      return mu.add(lin.sub(mu).div(mix(1.0, norm, k)));
    };

    // Czapy polarne: waga (1 w czapie) i barwa — liczone przed pasami (pasy pomijane pod pełną czapą).
    const poles = [];
    if (model.poles) {
      const P = U[K.pole];   // x: kąt jądra N, y: kąt jądra S [rad, + na wschód], z: tempo czap
      for (const which of ['north', 'south']) {
        const spec = model.poles[which];
        if (!spec) continue;
        const north = which === 'north';
        const capRad = (90 - spec.cap) * D2R;
        const blendRad = (spec.blend ?? 1.6) * D2R;
        const theta = (north ? float(1.0).sub(v) : v).mul(Math.PI).toVar();
        const capW = float(1.0).sub(smoothstep(capRad - blendRad, capRad, theta)).toVar();
        poles.push({ spec, north, theta, capW, P });
      }
    }
    // Barwa czapy (wołana tylko w gałęzi z wagą > 0).
    const poleColor = ({ spec, north, theta, P }) => {
      const lam = u.mul(Math.PI * 2).toVar();
      const hex = spec.hexagon || null;
      // kształt wielokąta (lustro polygonShapeCpu) i waga kształtu wokół dżetu (1 na dżecie, do bieguna `inner`,
      // na zewnątrz `outer` — dalej okręgi)
      const shapeAt = (L) => {
        const a = Math.PI / hex.sides;
        const x = mod(L.sub(hex.phaseU * D2R), 2 * a);
        return float(Math.cos(a) / polygonMeanCpu(hex.sides)).div(cos(x.sub(a)));
      };
      const hexT = hex ? (90 - hex.latC) * D2R : 0;
      const wHexAt = (t) => smoothstep(hexT - hex.inner * D2R, hexT, t).mul(float(1.0).sub(smoothstep(hexT, hexT + hex.outer * D2R, t)));
      const rho = theta.toVar();
      if (hex) {
        const m0 = float(1.0).add(shapeAt(lam).sub(1.0).mul(wHexAt(theta)));
        const r0 = theta.div(m0);
        rho.assign(theta.div(float(1.0).add(shapeAt(lam).sub(1.0).mul(wHexAt(r0)))));
      }
      // ω(ρ) [rad na s rzeczywistą] z profilu wiatru (ta sama tekstura) — na s gry × C.z × tempo wirów × tempo czap
      const vRho = north ? float(1.0).sub(rho.div(Math.PI)) : rho.div(Math.PI);
      const wRho = texture(windTex, vec2(vRho, 0.5)).level(0).x;
      const omegaRhoP = wRho.div(sin(max(rho, 0.3 * D2R)).mul(model.radius)).mul(C.z).mul(F.w).mul(P.z).toVar();
      const coreRad = spec.core * D2R;
      const coreWp = float(1.0).sub(smoothstep(coreRad * 0.6, coreRad, rho)).toVar();
      const omegaCoreP = float(model.poleCoreOmega(north ? 'north' : 'south')).mul(C.z).mul(F.w).mul(P.z);
      const rigid = (north ? P.x : P.y).mul(C.w).mul(coreWp);
      const posAt = (tau) => {
        const ang = rigid.add(omegaRhoP.sub(omegaCoreP.mul(coreWp)).mul(tau));
        const L2 = lam.sub(ang);
        const th2 = hex ? rho.mul(float(1.0).add(shapeAt(L2).sub(1.0).mul(wHexAt(rho)))) : rho;
        const vv = north ? float(1.0).sub(th2.div(Math.PI)) : th2.div(Math.PI);
        return vec2(fract(L2.div(Math.PI * 2)), clamp(vv, 0.0005, 0.9995));
      };
      return pair(posAt(tau0), posAt(tau1));
    };
    const band = vec3(0.0).toVar();
    const vortex = vec3(0.0).toVar();
    const bandsAndVortices = () => {
      If(vortexW.lessThan(0.999), () => {
        const lo = vec3(0.0).toVar();
        const hi = vec3(0.0).toVar();
        If(bandW.lessThan(0.999), () => {
          lo.assign(pair(bandPos(segLo, tau0, seed0), bandPos(segLo, tau1, seed1)));
        });
        If(bandW.greaterThan(0.001), () => {
          hi.assign(pair(bandPos(segHi, tau0, seed0), bandPos(segHi, tau1, seed1)));
        });
        band.assign(mix(lo, hi, bandW));
      });
      If(vortexW.greaterThan(0.001), () => {
        const collar = vec3(0.0).toVar();
        const core = vec3(0.0).toVar();
        If(coreW.lessThan(0.999), () => {
          collar.assign(pair(vortexPos(float(0.0), omegaRho, tau0), vortexPos(float(0.0), omegaRho, tau1)));
        });
        If(coreW.greaterThan(0.001), () => {
          const rigidAngle = VB.z.mul(C.w);
          core.assign(pair(vortexPos(rigidAngle, omegaCore, tau0), vortexPos(rigidAngle, omegaCore, tau1)));
        });
        vortex.assign(mix(collar, core, coreW));
      });
    };
    if (poles.length) {
      // pasy i wiry tylko poza pełną czapą
      let capAll = float(0.0);
      for (const p of poles) capAll = max(capAll, p.capW);
      If(capAll.lessThan(0.999), bandsAndVortices);
    } else {
      bandsAndVortices();
    }
    const out = mix(band, vortex, vortexW).toVar();
    for (const p of poles) {
      If(p.capW.greaterThan(0.001), () => {
        out.assign(mix(out, poleColor(p), p.capW));
      });
    }
    return max(out, vec3(0.0));
  };
}
