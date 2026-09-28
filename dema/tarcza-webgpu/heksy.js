// ============================================================
// Heksy tarczy — tarcza jako siatka osobnych płytek, jak kadłub w starym
// destruktorze GPU (src/game/destructorGpuSoftBody.js i shader heksów
// z src/3d/hexShips3D.js sprzed portu na WebGPU):
//  • ciało miękkie: płytka ma odkształcenie w płaszczyźnie kadłuba i prędkość,
//    sprężyny do 6 sąsiadów liczone od SPOCZYNKOWEJ siatki, ściskanie 3,2×
//    twardsze od rozciągania, przy mocnym ściśnięciu wybrzuszenie w bok,
//    przenoszenie prędkości wzdłuż i w poprzek wiązania, siła dzielona przez
//    √(liczba sąsiadów) — wszystko jak w shaderze destruktora;
//  • trafienie wybija płytki od punktu uderzenia (krater), front ściśnięcia biegnie
//    po siatce; płytka przesunięta ponad granicę płynięcia zostaje wgnieciona
//    (plastyczne przesunięcie spoczynku, jak wgniecenia kadłuba), wgniecenie się goi
//    (gorąca płytka goi się wolniej);
//  • poświata stresu (odkształcenie i naprężenie wiązań) jak `stressGlow`;
//  • żar: szczyt przy trafieniu, stygnięcie wykładnicze, rozchodzenie się po
//    sąsiadach, jasność ~ 0,26h + 0,74h⁴ (Stefan-Boltzmann w skrócie), rampa
//    w barwach tarczy: głęboki błękit → barwa tarczy → błękitna biel → biel;
//  • przeciążenie (energia pola blisko progu) barwi płytki na pomarańcz, przebicie
//    (B pola) odrywa je — lecą jako odłamki i wracają, gdy pole się zamknie;
//  • pęknięcie tarczy rozrywa całą siatkę falą od ostatniego trafienia.
// W spoczynku płytki mają zerową wielkość — tarcza jest przezroczysta, widać ją
// tylko tam, gdzie coś w nią uderzyło.
// Siatka trójkątna w płaszczyźnie kadłuba (klatka lokalna 3D grupy tarczy);
// płytka leży w płaszczyźnie stycznej do czaszy nad swoim środkiem, z góry
// płytki kładą się dokładnie na siatkę.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, int, vec2, vec3, vec4, instancedArray, instanceIndex, attribute, varying,
  positionGeometry, positionView, normalize, cross, cos, sin, dot, length, exp, max, min, abs, mix,
  smoothstep, saturate, select, sqrt, pow, step, If, Loop, cameraViewMatrix, transformNormalToView, screenUV
} from 'three/tsl';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';
import { uTime, uDt, hash12, mulberry32, clamp, SHIELD_BREAK_COLOR } from './wspolne.js';
import { sceneBehind, sstepDown } from './czasza.js';

const SQ3_2 = 0.8660254;
export const HEX_MAX_SUBSTEPS = 16;
const FLY_LIFE = 1.25;          // s — odłamek płytki gaśnie
const SHATTER_SPEED = 3600;     // j./s — fala rozpadu przy pęknięciu (jak dawne odłamki)
const HEAL_TIME = 1.1;          // s — gojenie wgniecenia (zimna płytka; gorąca ~3× wolniej)
const ELASTIC_TIME = 0.5;       // s — sprężysta część przesunięcia wraca do wgniecenia
const YIELD = 0.1;              // granica płynięcia: sprężyste przesunięcie ≤ 10% komórki
const STRESS_TIME = 0.22;       // s — wygasanie poświaty stresu
const HEAT_DIFFUSION = 400;     // j²/s — żar rozchodzi się po sąsiadach
const HEAT_TIME_K = 0.5;        // stygnięcie płytek = 0,5 × stygnięcie energii pola
const WAVE_DAMP_MIN = 4.0;      // 1/s — tłumienie fali w siatce (fala gaśnie w ~0,5 s)

// Rozmiar heksa (odstęp środków = średnica wpisana) dla profilu tarczy.
export function hexCellFor(profile, scale = 1) {
  return clamp(profile.maxR * 0.026, 8, 40) * scale;
}

// ---------------------------------------------------------------------------
// Siatka na CPU (raz): środki w wierszach co d·√3/2, co drugi wiersz przesunięty
// o d/2; sąsiedzi przez (kolumna, wiersz). Środek na czaszy, normalna z różnic.

function buildLattice(profile, domeHeight, cell, maxCount) {
  const H = domeHeight;
  const tAt = (x, y) => Math.hypot(x, y) / Math.max(sampleShieldProfileRadius(profile, Math.atan2(-y, x)), 1e-3);
  const zAt = (x, y) => { const t = tAt(x, y); return H * Math.pow(Math.max(0, 1 - t * t), 0.62); };
  let d = cell, pts = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    pts = [];
    const rows = Math.ceil(profile.maxR / (d * SQ3_2)) + 2;
    const cols = Math.ceil(profile.maxR / d) + 2;
    for (let j = -rows; j <= rows; j++) {
      for (let i = -cols; i <= cols; i++) {
        const x = (i + ((j & 1) ? 0.5 : 0)) * d, y = j * d * SQ3_2;
        if (tAt(x, y) < 0.975) pts.push(i, j, x, y);
      }
    }
    if (pts.length / 4 <= maxCount) break;
    d *= Math.sqrt(pts.length / 4 / maxCount) * 1.02;
  }
  const n = pts.length / 4;
  const index = new Map();
  for (let k = 0; k < n; k++) index.set(pts[k * 4] * 100003 + pts[k * 4 + 1], k);
  const at = (i, j) => { const k = index.get(i * 100003 + j); return k === undefined ? -1 : k; };
  const rest = new Float32Array(n * 4);
  const nrm = new Float32Array(n * 4);
  const nbr = new Int32Array(n * 6);
  const rnd = mulberry32(0x5eed + n);
  const e = 1.5;
  for (let k = 0; k < n; k++) {
    const i = pts[k * 4], j = pts[k * 4 + 1], x = pts[k * 4 + 2], y = pts[k * 4 + 3];
    const gx = (zAt(x + e, y) - zAt(x - e, y)) / (2 * e);
    const gy = (zAt(x, y + e) - zAt(x, y - e)) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    rest.set([x, y, zAt(x, y), rnd()], k * 4);
    nrm.set([-gx / l, -gy / l, 1 / l, tAt(x, y)], k * 4);
    const odd = j & 1;
    const nb = odd
      ? [[i + 1, j], [i - 1, j], [i, j + 1], [i + 1, j + 1], [i, j - 1], [i + 1, j - 1]]
      : [[i + 1, j], [i - 1, j], [i - 1, j + 1], [i, j + 1], [i - 1, j - 1], [i, j - 1]];
    for (let m = 0; m < 6; m++) nbr[k * 6 + m] = at(nb[m][0], nb[m][1]);
  }
  return { n, cell: d, rest, nrm, nbr };
}

// Heksagon ostrym wierzchołkiem w górę (komórka Woronoja siatki trójkątnej),
// promień opisany 1; aRim: 0 w środku, 1 na brzegu (liniowo = metryka heksa).
function hexGeometry() {
  const pos = [0, 0, 0];
  const rim = [0];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pos.push(Math.cos(a), Math.sin(a), 0);
    rim.push(1);
  }
  const idx = [];
  for (let i = 0; i < 6; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
// Uniformy wspólne — przeżywają przebudowę siatki (suwak rozmiaru heksa).

export function createHexShared() {
  return {
    // Ciało miękkie (ustawiane co klatkę z parametrów pola)
    uK: uniform(2900),          // sztywność wiązania [1/s²]
    uCAx: uniform(14),          // przenoszenie prędkości wzdłuż wiązania [1/s]
    uCSh: uniform(7),           // … w poprzek wiązania [1/s]
    uDampK: uniform(1),         // exp(−γ·dt) na podkrok
    uHealK: uniform(1),         // exp(−dt/τ gojenia wgniecenia) na podkrok
    uElastK: uniform(1),        // exp(−dt/τ powrotu sprężystego) na podkrok
    uYield: uniform(2),         // granica płynięcia [j.]
    uHeatK: uniform(1),         // exp(−dt/τ stygnięcia) na podkrok
    uHeatDiff: uniform(0),      // udział średniej sąsiadów w żarze na podkrok
    uStressK: uniform(1),       // exp(−dt/τ stresu) na podkrok
    uMaxDef: uniform(12),       // [j.] — dalej płytka się nie przesunie
    uVMax: uniform(2400),       // [j./s]
    uDtS: uniform(1 / 240),     // podkrok [s]
    // Trafienia
    uKick: uniform(1),          // suwak „wgniecenie” (× fale wł.)
    uReach: uniform(1.4),       // promień trafienia na płytkach względem promienia w polu
    uKickOn: uniform(1),        // przełącznik „fale”
    uHeatGain: uniform(2.2),    // energia zdarzenia → żar płytki
    uFlashGain: uniform(3.0),   // energia zdarzenia → błysk rdzenia
    uHeatOn: uniform(1),
    // Stany tarczy
    uShatter: uniform(new THREE.Vector4(0, 0, 0, 0)), // x, y, start, wł.
    uShatterMix: uniform(0),    // szwy i odłamki w barwie pęknięcia
    uRegrowOK: uniform(1),      // płytki mogą wracać (tarcza aktywna / rozruch)
    uSweep: uniform(-1),        // czoło rozruchu / gaszenia w t (−1 = brak)
    uFrontGlow: uniform(0),     // fronty rozruchu i odrastanie widoczne
    uShow: uniform(0),          // „pokaż heksy” — cała siatka przygaszona
    uInitGrown: uniform(1),     // przy zerowaniu: płytki gotowe (1) albo do odrośnięcia (0)
    // Wygląd
    uHeatPeak: uniform(3.2),    // jasność białego żaru (HDR)
    uStressGain: uniform(1.2),
    uGap: uniform(0.1),         // szczelina między płytkami (ułamek)
    uSpec: uniform(1.0)
  };
}

// ---------------------------------------------------------------------------

export function createHexLattice({ renderer, group, profile, domeHeight, P, U, G, X, cell, maxCount = 16000 }) {
  const L = buildLattice(profile, domeHeight, cell, maxCount);
  const n = L.n;
  // Wektory spoczynkowe do 6 sąsiadów — ta sama kolejność w wierszach parzystych
  // i nieparzystych (patrz buildLattice); vec4 (wyrównanie tablicy uniformów).
  const hRow = L.cell * SQ3_2;
  const uSlot = uniformArray([
    new THREE.Vector4(L.cell, 0, 0, 0), new THREE.Vector4(-L.cell, 0, 0, 0),
    new THREE.Vector4(-L.cell / 2, hRow, 0, 0), new THREE.Vector4(L.cell / 2, hRow, 0, 0),
    new THREE.Vector4(-L.cell / 2, -hRow, 0, 0), new THREE.Vector4(L.cell / 2, -hRow, 0, 0)
  ], 'vec4');
  const uCellU = uniform(L.cell);
  const restB = instancedArray(L.rest, 'vec4');   // środek xyz, ziarno
  const nrmB = instancedArray(L.nrm, 'vec4');     // normalna, t (r / r(θ))
  const nbrB = instancedArray(L.nbr, 'int');      // 6 sąsiadów (−1 brak)
  const defA = instancedArray(n, 'vec4');         // przesunięcie xy, prędkość xy
  const defB = instancedArray(n, 'vec4');
  const heatA = instancedArray(n, 'vec4');        // żar, stres, wgniecenie xy (plastyczne)
  const heatB = instancedArray(n, 'vec4');
  const stB = instancedArray(n, 'vec4');          // wiek oderwania (< 0 przyczepiona), wzrost, błysk, pęknięcie
  const flyV = instancedArray(n, 'vec4');         // odłamek: prędkość xyz, prędkość obrotu
  // Dla rysunku (i lotu odłamka — limit 8 buforów storage na etap compute):
  const poseB = instancedArray(n, 'vec4');        // przesunięcie xyz, wiek lotu (0 = przyczepiona)
  const lookB = instancedArray(n, 'vec4');        // żar, stres, błysk | pęknięcie, wzrost | prędkość obrotu

  // ── Zerowanie (start, przebudowa): płytki na miejscu, bez żaru.
  const init = Fn(() => {
    const id = instanceIndex;
    defA.element(id).assign(vec4(0));
    defB.element(id).assign(vec4(0));
    heatA.element(id).assign(vec4(0));
    heatB.element(id).assign(vec4(0));
    stB.element(id).assign(vec4(-1.0, X.uInitGrown, 0.0, 0.0));
    flyV.element(id).assign(vec4(0));
    poseB.element(id).assign(vec4(0));
    lookB.element(id).assign(vec4(0.0, 0.0, 0.0, X.uInitGrown));
  })().compute(n);

  // ── Tarcza zgaszona: przyczepione płytki stygną do zera i czekają na rozruch
  //    (odłamki w locie lecą dalej).
  const resetAttached = Fn(() => {
    const id = instanceIndex;
    const s = stB.element(id).toVar();
    If(s.x.lessThan(0.0), () => {
      defA.element(id).assign(vec4(0));
      heatA.element(id).assign(vec4(0));
      stB.element(id).assign(vec4(-1.0, 0.0, 0.0, 0.0));
      poseB.element(id).assign(vec4(0));
      lookB.element(id).assign(vec4(0));
    });
  })().compute(n);

  // ── Wstrzyknięcie zdarzeń pola (raz na klatkę): krater (prędkość od punktu
  //    uderzenia, pierścień d·e^(−d²/r²)), żar i błysk rdzenia; źródła ciągłe
  //    (wiązka) pchają płytki co klatkę.
  const inject = Fn(() => {
    const id = instanceIndex;
    const r = restB.element(id).toVar();
    const s = stB.element(id).toVar();
    const dv = vec2(0).toVar();
    const dh = float(0).toVar();
    const fl = float(0).toVar();
    // Krater szerszy niż zdarzenie w polu (uReach) — czytelny z daleka; żar w promieniu
    // zdarzenia (biały rdzeń nie rozlewa się przy mocnych trafieniach).
    Loop({ start: 0, end: P.uEvCount, type: 'int', condition: '<', name: 'ev' }, ({ ev }) => {
      const a = P.uEvA.element(ev);
      const off = r.xy.sub(a.xy);
      const d2 = dot(off, off);
      const rr = a.z.mul(X.uReach);
      const r2 = rr.mul(rr);
      If(d2.lessThan(r2.mul(9.0)), () => {
        const g = exp(d2.div(r2).negate());
        const dd = sqrt(d2);
        dv.addAssign(off.div(max(dd, 1e-3)).mul(abs(a.w).mul(dd.div(rr)).mul(g).mul(2.33)));
        const e = P.uEvB.element(ev).x;
        const q2 = d2.div(a.z.mul(a.z));
        dh.addAssign(e.mul(exp(q2.negate())));
        fl.addAssign(e.mul(exp(q2.div(0.16).negate())));
      });
    });
    Loop({ start: 0, end: P.uSrcCount, type: 'int', condition: '<', name: 'sr' }, ({ sr }) => {
      const a = P.uSrc.element(sr);
      const off = r.xy.sub(a.xy);
      const d2 = dot(off, off);
      const r2 = a.z.mul(a.z);
      If(d2.lessThan(r2.mul(9.0)), () => {
        const dd = sqrt(d2);
        const g = exp(d2.div(r2).negate());
        dv.addAssign(off.div(max(dd, 1e-3)).mul(abs(a.w).mul(uDt).mul(0.35).mul(dd.div(a.z)).mul(g).mul(2.33)));
      });
    });
    If(s.x.lessThan(0.0), () => {
      const dA = defA.element(id);
      defA.element(id).assign(vec4(dA.xy, dA.zw.add(dv.mul(X.uKick).mul(X.uKickOn))));
      const hA = heatA.element(id);
      heatA.element(id).assign(vec4(min(hA.x.add(dh.mul(X.uHeatGain).mul(X.uHeatOn)), 1.6), hA.y, hA.z, hA.w));
      stB.element(id).assign(vec4(s.x, s.y, min(s.z.add(fl.mul(X.uFlashGain).mul(X.uHeatOn)), 1.0), s.w));
    });
  })().compute(n);

  // ── Podkrok ciała miękkiego: src → dst (symplektyczny Euler). Wiązanie liczone
  //    względem spoczynku przesuniętego o wgniecenia obu płytek (plastyczność).
  const makeStep = (dSrc, dDst, hSrc, hDst) => Fn(() => {
    const id = instanceIndex;
    const me = dSrc.element(id).toVar();
    const hm = hSrc.element(id).toVar();
    const r = restB.element(id).toVar();
    const att = stB.element(id).x.lessThan(0.0).toVar();
    const F = vec2(0).toVar();
    const nAct = float(0).toVar();
    const strain = float(0).toVar();
    const hSum = float(0).toVar();
    const base = int(id).mul(int(6)).toVar();
    const K = X.uK.toVar();
    const nHeat = float(0).toVar();
    Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'nb' }, ({ nb }) => {
      const j = nbrB.element(base.add(nb)).toVar();
      If(j.lessThan(int(0)), () => {
        // Brak sąsiada (za obrysem): punkt zamocowany w spoczynku — brzeg tarczy
        // utwierdzony jak brzeg pola, bez swobodnie drgającej krawędzi.
        const e = uSlot.element(nb).xy.toVar();
        const Lr = length(e).toVar();
        const dir = e.div(Lr).toVar();
        const perp = vec2(dir.y.negate(), dir.x).toVar();
        const a = e.sub(me.xy).toVar();
        const proj = max(dot(a, dir), Lr.mul(0.22));
        const diff = proj.sub(Lr).toVar();
        const fm = diff.mul(K).mul(select(diff.lessThan(0.0), float(3.2), float(0.9)));
        const dvv = me.zw.negate();
        F.addAssign(dir.mul(fm).add(dir.mul(dot(dvv, dir).mul(X.uCAx))).add(perp.mul(dot(dvv, perp).mul(X.uCSh))));
        nAct.addAssign(1.0);
        strain.assign(max(strain, abs(diff).div(Lr)));
      }).Else(() => {
        If(stB.element(j).x.lessThan(0.0), () => {
          const o = dSrc.element(j).toVar();
          const hj = hSrc.element(j).toVar();
          const e = restB.element(j).xy.add(hj.zw).sub(r.xy.add(hm.zw)).toVar();
          const Lr = length(e).toVar();
          const dir = e.div(Lr).toVar();
          const perp = vec2(dir.y.negate(), dir.x).toVar();
          const a = restB.element(j).xy.add(o.xy).sub(r.xy.add(me.xy)).toVar();
          // Długość spoczynkowa z siatki spoczynkowej (jak destruktor), przesuniętej
          // o wgniecenia; rzut na kierunek spoczynkowy z dolnym ogranicznikiem —
          // płytki nie przenikają się.
          const proj = max(dot(a, dir), Lr.mul(0.22)).toVar();
          const diff = proj.sub(Lr).toVar();
          const comp = diff.lessThan(0.0);
          const fm = diff.mul(K).mul(select(comp, float(3.2), float(0.9)));
          // Wybrzuszenie: mocno ściśnięte wiązanie wypycha płytkę w bok.
          const lat = dot(a, perp);
          const bulgeOn = diff.lessThan(Lr.mul(-0.12)).and(proj.greaterThan(Lr.mul(0.45)));
          const bulgeMag = min(diff.negate().mul(K).mul(0.8), Lr.mul(K).mul(0.45));
          const bulge = select(bulgeOn, perp.mul(select(lat.lessThan(0.0), float(-1.0), float(1.0))).mul(bulgeMag), vec2(0.0));
          const dvv = o.zw.sub(me.zw);
          F.addAssign(dir.mul(fm).add(bulge)
            .add(dir.mul(dot(dvv, dir).mul(X.uCAx))).add(perp.mul(dot(dvv, perp).mul(X.uCSh))));
          nAct.addAssign(1.0);
          strain.assign(max(strain, abs(diff).div(Lr)));
          hSum.addAssign(hj.x);
          nHeat.addAssign(1.0);
        });
      });
    });
    const Fn2 = F.div(sqrt(max(nAct, 1.0)));
    const v = me.zw.add(Fn2.mul(X.uDtS)).mul(X.uDampK).toVar();
    v.assign(select(nAct.lessThan(2.0), v.mul(0.5), v));
    const vl = length(v);
    v.assign(select(vl.greaterThan(X.uVMax), v.mul(X.uVMax.div(max(vl, 1e-3))), v));
    // Wgniecenie goi się (gorąca płytka „mięknie” i goi się wolniej), sprężysta
    // część przesunięcia wraca do wgniecenia; ponad granicą płynięcia wgniecenie
    // idzie za płytką.
    const pl = hm.zw.mul(mix(X.uHealK, float(1.0), saturate(hm.x).mul(0.7))).toVar();
    const d = me.xy.add(v.mul(X.uDtS)).toVar();
    d.assign(pl.add(d.sub(pl).mul(X.uElastK)));
    const dl = length(d).toVar();
    d.assign(select(dl.greaterThan(X.uMaxDef), d.mul(X.uMaxDef.div(max(dl, 1e-3))), d));
    const el = d.sub(pl).toVar();
    const ell = length(el);
    pl.assign(select(ell.greaterThan(X.uYield), d.sub(el.mul(X.uYield.div(max(ell, 1e-3)))), pl));
    // Żar: stygnięcie + wyrównywanie z sąsiadami. Stres: obwiednia naprężenia wiązań
    // (15% = pełna poświata) i przesunięcia (60% komórki — wgniecenie świeci słabiej
    // niż front naprężenia).
    const hMean = select(nHeat.greaterThan(0.5), hSum.div(max(nHeat, 1.0)), hm.x);
    const hN = hm.x.add(hMean.sub(hm.x).mul(X.uHeatDiff)).mul(X.uHeatK);
    const sNow = max(strain.div(0.15), length(d).div(uCellU.mul(0.6)));
    const sN = max(hm.y.mul(X.uStressK), min(sNow, 2.0));
    dDst.element(id).assign(select(att, vec4(d, v), vec4(0.0)));
    hDst.element(id).assign(select(att, vec4(hN, sN, pl), hm));
  })().compute(n);
  const stepAB = makeStep(defA, defB, heatA, heatB);
  const stepBA = makeStep(defB, defA, heatB, heatA);

  // ── Raz na klatkę: stany płytek (oderwanie przy przebiciu i pęknięciu, lot
  //    odłamka, powrót, odrastanie) i dane do rysunku.
  const finalize = Fn(() => {
    const id = instanceIndex;
    const r = restB.element(id).toVar();
    const nr = nrmB.element(id).toVar();
    const s = stB.element(id).toVar();
    const dd = defA.element(id).toVar();
    const hh = heatA.element(id).toVar();
    const fp = poseB.element(id).toVar();
    const fv = flyV.element(id).toVar();
    const uvc = r.xy.sub(P.uOrigin).div(P.uSize).toVar();
    const f = P.texNode.sample(uvc).level(0).toVar();
    // Przebicie pod płytką: maksimum B w środku i w 6 rogach (płytka odpada, gdy
    // dziura choć ją zahacza — dziura w siatce ma brzeg z całych płytek).
    const bMax = f.z.toVar();
    const cr = vec2(L.cell * 0.5, L.cell * 0.5).div(P.uSize).toVar();
    for (let m = 0; m < 6; m++) {
      const a = (m / 6) * Math.PI * 2 + Math.PI / 6;
      bMax.assign(max(bMax, P.texNode.sample(uvc.add(cr.mul(vec2(Math.cos(a), Math.sin(a))))).level(0).z));
    }
    const dt = uDt.toVar();
    const shOn = X.uShatter.w.greaterThan(0.5).toVar();
    const distS = length(r.xy.sub(X.uShatter.xy)).toVar();
    const tReach = X.uShatter.z.add(distS.div(SHATTER_SPEED)).toVar();
    const hitS = shOn.and(uTime.greaterThanEqual(tReach)).toVar();
    // Każda płytka ma własny próg przebicia — odpadają po jednej, nie całą łatą.
    const thrB = hash12(vec2(r.w.mul(97.0), 3.7)).mul(0.25).add(0.45);
    const hitB = bMax.greaterThan(thrB).toVar();
    const sweepOK = X.uSweep.lessThan(0.0).or(nr.w.lessThan(X.uSweep)).toVar();
    const pre = select(shOn, smoothstep(-0.1, 0.0, uTime.sub(tReach)), float(0.0)).toVar();
    const h1 = hash12(vec2(r.w.mul(311.0), X.uShatter.z.mul(0.37).add(1.0))).toVar();
    const h2 = hash12(vec2(r.w.mul(173.0).add(5.0), X.uShatter.z.mul(0.53).add(2.0))).toVar();
    const h3 = hash12(vec2(r.w.mul(59.0).add(9.0), X.uShatter.z.mul(0.71).add(3.0))).toVar();

    If(s.x.lessThan(0.0), () => {
      If(hitS.or(hitB), () => {
        // Oderwanie: przy pęknięciu od punktu trafienia i na zewnątrz czaszy (jak
        // dawne odłamki), przy przebiciu wyrzut wzdłuż normalnej z ruchem płytki.
        const away = r.xy.sub(X.uShatter.xy).div(max(distS, 1.0));
        const spS = exp(distS.div(-520.0)).mul(900.0).add(220.0);
        const sp = select(hitS, spS, float(260.0)).mul(h1.mul(0.8).add(0.6));
        const lat = select(hitS, away.mul(sp.mul(0.75)), dd.zw.mul(0.6));
        const v3 = vec3(lat, 0.0).add(nr.xyz.mul(sp.mul(0.55))).add(vec3(h2.sub(0.5), h3.sub(0.5), h1.mul(0.5)).mul(160.0));
        fp.assign(vec4(dd.x, dd.y, 0.0, 1e-4));
        fv.assign(vec4(v3, h2.sub(0.5).mul(16.0)));
        s.assign(vec4(0.0, s.y, 0.0, select(hitS, float(1.0), float(0.0))));
        hh.assign(vec4(max(hh.x, select(hitS, float(0.8), float(1.0))), 0.0, 0.0, 0.0));
      }).Else(() => {
        const grow = select(X.uRegrowOK.greaterThan(0.5).and(sweepOK), dt.div(0.35), float(0.0));
        s.assign(vec4(s.x, min(s.y.add(grow), 1.0), s.z.mul(exp(dt.mul(-11.0))), s.w));
      });
    }).Else(() => {
      const age = s.x.add(dt).toVar();
      const nv = fv.xyz.mul(exp(dt.mul(-0.9))).toVar();
      fp.assign(vec4(fp.xyz.add(nv.mul(dt)), age));
      fv.assign(vec4(nv, fv.w));
      hh.assign(vec4(hh.x.mul(exp(dt.mul(-1.6))), 0.0, 0.0, 0.0));
      // Powrót: odłamek zgasł, pole zamknięte, tarcza aktywna (za czołem rozruchu).
      const back = X.uRegrowOK.greaterThan(0.5).and(sweepOK).and(bMax.lessThan(0.25))
        .and(age.greaterThan(FLY_LIFE)).and(shOn.not());
      If(back, () => {
        s.assign(vec4(-1.0, h2.mul(-0.9), 0.0, 0.0));
        fp.assign(vec4(0.0));
        fv.assign(vec4(0.0));
        dd.assign(vec4(0.0));
        hh.assign(vec4(0.0));
      }).Else(() => {
        s.assign(vec4(age, s.y, s.z, s.w));
      });
    });
    stB.element(id).assign(s);
    flyV.element(id).assign(fv);
    defA.element(id).assign(dd);
    heatA.element(id).assign(hh);
    const att = s.x.lessThan(0.0).toVar();
    poseB.element(id).assign(select(att, vec4(dd.x, dd.y, 0.0, 0.0), vec4(fp.xyz, max(s.x, 1e-4))));
    lookB.element(id).assign(vec4(
      hh.x,
      select(att, hh.y.add(pre.mul(1.4)), float(0.0)),
      select(att, s.z, s.w),
      select(att, s.y, fv.w)));
  })().compute(n);

  // Przebiegi dla każdej parzystej liczby podkroków (bez alokacji w klatce).
  const groups = [];
  for (let k = 0; k <= HEX_MAX_SUBSTEPS; k += 2) {
    const arr = [inject];
    for (let m = 0; m < k; m++) arr.push(m % 2 === 0 ? stepAB : stepBA);
    arr.push(finalize);
    groups[k] = arr;
  }
  const idleGroup = [finalize];

  // ── Rysunek: heks w płaszczyźnie stycznej do czaszy (przechylony przez falę
  //    pola), przesunięty o odkształcenie; odłamek obraca się wokół losowej osi.
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
  });
  const aRim = attribute('aRim', 'float');
  const restA = restB.toAttribute();
  const nrmA = nrmB.toAttribute();
  const poseA = poseB.toAttribute();
  const lookA = lookB.toAttribute();
  const circR = L.cell / Math.sqrt(3);

  // Stan pola nad środkiem płytki (etap wierzchołków, .level(0)).
  const uv0 = restA.xy.sub(P.uOrigin).div(P.uSize);
  const f0 = P.texNode.sample(uv0).level(0);
  const tx = vec2(P.uTexel.x.mul(1.5), 0.0), ty = vec2(0.0, P.uTexel.y.mul(1.5));
  const gradW = vec2(
    P.texNode.sample(uv0.add(tx)).level(0).x.sub(P.texNode.sample(uv0.sub(tx)).level(0).x),
    P.texNode.sample(uv0.add(ty)).level(0).x.sub(P.texNode.sample(uv0.sub(ty)).level(0).x)
  ).div(P.uCell.mul(3.0)).mul(G.normalGain);
  const isFly = step(1e-5, poseA.w);
  const n0 = normalize(nrmA.xyz);
  const nTilt = normalize(n0.sub(vec3(gradW, 0.0)));
  // Widoczność płytki: bez żaru, stresu, błysku i odrastania — zero wielkości (brak
  // fragmentów). Odrastanie i fronty świecą tylko z włączonymi frontami.
  const grow = saturate(lookA.w);
  const forming = grow.mul(grow.oneMinus()).mul(4.0).mul(X.uFrontGlow);
  const sweepBand = select(X.uSweep.greaterThanEqual(0.0),
    sstepDown(0.07, 0.0, abs(nrmA.w.sub(X.uSweep))), float(0.0)).mul(X.uFrontGlow);
  // Martwe strefy: drobne drgania i resztki żaru nie zapalają płytek (tarcza przezroczysta).
  const stressVis = max(lookA.y.sub(0.3), 0.0).div(0.7);
  const visAtt = max(lookA.x.sub(0.035), 0.0).add(stressVis).add(lookA.z).add(forming).add(sweepBand).add(X.uShow);
  // Odłamek rysowany tylko w locie; zgasły czeka na powrót bez rysowania.
  const shown = select(isFly.greaterThan(0.5), step(poseA.w, FLY_LIFE), step(0.004, visAtt));

  mat.positionNode = Fn(() => {
    const flying = isFly.toVar();
    const N = normalize(mix(nTilt, n0, flying)).toVar();
    const scale = mix(grow, float(1.0), flying).mul(X.uGap.oneMinus()).mul(shown).mul(circR).toVar();
    const o2 = positionGeometry.xy.mul(scale).toVar();
    // Płaszczyzna styczna nad punktem siatki: rzut z góry pokrywa się z komórką.
    const lift = o2.x.mul(N.x).add(o2.y.mul(N.y)).negate().div(max(N.z, 0.3));
    const o = vec3(o2, lift).toVar();
    // Odłamek: obrót Rodriguesa wokół osi z ziarna płytki.
    const ax = normalize(vec3(hash12(vec2(restA.w.mul(91.0), 1.0)).sub(0.5),
      hash12(vec2(restA.w.mul(37.0), 2.0)).sub(0.5), hash12(vec2(restA.w.mul(53.0), 3.0)).sub(0.5)).add(vec3(0.001)));
    const ang = lookA.w.mul(poseA.w).mul(flying);
    const c = cos(ang), s = sin(ang);
    const rot = o.mul(c).add(cross(ax, o).mul(s)).add(ax.mul(dot(ax, o)).mul(c.oneMinus()));
    // Przyczepiona: fala pola wzdłuż normalnej; odkształcenie i lot w pose.
    const wave = n0.mul(f0.x.mul(G.dispScale)).mul(flying.oneMinus());
    return restA.xyz.add(poseA.xyz).add(wave).add(rot);
  })();

  // Wartości płytki do fragmentu (liczone raz na wierzchołek).
  const vE = varying(max(f0.y, 0.0).div(max(P.uThr, 0.05)));
  const vN = varying(transformNormalToView(nTilt));
  const vN0 = varying(transformNormalToView(n0));

  const breakCol = vec3(SHIELD_BREAK_COLOR.r, SHIELD_BREAK_COLOR.g, SHIELD_BREAK_COLOR.b);
  mat.fragmentNode = Fn(() => {
    const lk = lookA.toVar();
    const flyAge = poseA.w.toVar();
    const fly = isFly.toVar();
    const rim = aRim.toVar();
    const edge = smoothstep(0.8, 0.97, rim).toVar();
    const base = mix(vec3(1.0, 0.08, 0.04), U.color, U.life).toVar();

    // Żar: rampa w barwach tarczy, jasność 0,26h + 0,74h⁴ (jak żar kadłuba w destruktorze).
    const heat = min(lk.x, 1.1).toVar();
    const ramp = mix(base.mul(0.3), base, smoothstep(0.0, 0.3, heat)).toVar();
    ramp.assign(mix(ramp, mix(base, vec3(0.72, 0.9, 1.0), 0.7), smoothstep(0.3, 0.65, heat)));
    ramp.assign(mix(ramp, vec3(1.0, 0.97, 0.93), smoothstep(0.65, 1.0, heat)));
    // Przeciążenie: energia pola blisko progu przebicia → pomarańcz.
    const over = smoothstep(0.6, 1.15, vE).toVar();
    ramp.assign(mix(ramp, vec3(1.0, 0.45, 0.14), over.mul(0.85)));
    const hq = heat.mul(heat);
    const I = heat.mul(0.26).add(hq.mul(hq).mul(0.74)).mul(X.uHeatPeak).toVar();
    const body = rim.mul(rim).mul(0.45).add(0.1);
    const heatE = ramp.mul(I).mul(body.add(edge.mul(1.3)));

    // Stres: szwy płytek w barwie tarczy (przy pęknięciu — w barwie pęknięcia).
    const sCol = mix(mix(base, vec3(0.8, 0.93, 1.0), 0.35), breakCol, X.uShatterMix).toVar();
    const st = min(stressVis, 2.2).toVar();
    const stressE = sCol.mul(st.mul(st).mul(0.5).add(st.mul(0.5))).mul(X.uStressGain).mul(edge.mul(1.5).add(0.12));
    // Błysk rdzenia świeżego trafienia.
    const flashE = vec3(1.0, 0.97, 0.94).mul(lk.z).mul(edge.mul(0.8).add(0.6)).mul(2.6);
    // Odrastanie, fronty rozruchu, „pokaż heksy” — same szwy.
    const g = saturate(lk.w);
    const formE = sCol.mul(g.mul(g.oneMinus()).mul(4.0).mul(X.uFrontGlow).add(sweepBand.mul(1.2)).add(X.uShow.mul(0.22))).mul(edge);

    // Połysk: płytka przechylona falą łapie światło (tylko przechylona — w spoczynku nic).
    const Nv = normalize(vN).toVar();
    const V = normalize(positionView.negate());
    const Lv = normalize(cameraViewMatrix.mul(vec4(G.lightDir, 0.0)).xyz);
    const Hv = normalize(Lv.add(V));
    const dN = Nv.sub(normalize(vN0)).toVar();
    const tiltK = saturate(length(dN).mul(9.0));
    const spec = sCol.mul(pow(max(dot(Nv, Hv), 0.0), 70.0).mul(tiltK).mul(0.8).mul(X.uSpec)).mul(body.add(edge));

    const attE = heatE.add(stressE).add(flashE).add(formE).add(spec);

    // Odłamek: barwa pęknięcia z białym rozbłyskiem przy oderwaniu, gaśnie w FLY_LIFE.
    const k = saturate(flyAge.div(FLY_LIFE));
    const fade = k.oneMinus().mul(k.oneMinus());
    const hot = exp(flyAge.mul(-6.0));
    const debCol = mix(mix(ramp, breakCol, 0.6), breakCol, lk.z);
    // Przy pęknięciu leci cała siatka naraz — odłamek ciemniejszy niż pojedynczy z przebicia.
    const debrisE = debCol.mul(edge.mul(2.1).add(0.3)).add(vec3(1.25, 1.1, 0.95).mul(hot).mul(edge.mul(0.6).add(0.4)))
      .mul(fade).mul(heat.mul(0.5).add(0.6)).mul(mix(float(1.0), float(0.55), lk.z));

    const emis = mix(attE, debrisE, fly).toVar();

    // Załamanie: tło za płytką przesunięte o jej przechył, tylko tam, gdzie świeci.
    const mask = saturate(I.mul(0.12).add(st.mul(0.25)).add(lk.z.mul(0.4))).mul(fly.oneMinus()).mul(G.refrOn).toVar();
    const off = vec2(dN.x.div(G.aspect), dN.y.negate()).mul(G.refrK.mul(G.refr).mul(2.5)).mul(mask);
    const bg = sceneBehind.sample(screenUV.add(off)).rgb;
    const tint = mix(vec3(1.0), base.mul(1.2).add(0.1), 0.3);
    return vec4(max(emis.add(bg.mul(tint).mul(mask)), vec3(0.0)), mask);
  })();

  const mesh = new THREE.Mesh(hexGeometry(), mat);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  group.add(mesh);

  let needsInit = true;
  let resetPending = false;
  let acc = 0;
  let flyUntil = -1;
  const maxDist = profile.maxR * 2;

  return {
    mesh, count: n, cell: L.cell, substeps: 0,
    describe() { return `${n.toLocaleString('pl-PL')} płytek · ${L.cell.toFixed(1)} j.`; },
    // Pęknięcie: rozpad całej siatki falą od punktu (ox, oy).
    shatter(ox, oy, time) {
      X.uShatter.value.set(ox, oy, time, 1);
      flyUntil = time + FLY_LIFE + maxDist / SHATTER_SPEED + 0.2;
    },
    clearShatter() { X.uShatter.value.w = 0; },
    flying(time) { return time < flyUntil; },
    resetAttached() { resetPending = true; },
    reset(grown = true) { X.uInitGrown.value = grown ? 1 : 0; needsInit = true; },
    // Klatka: awake — pole liczy (zdarzenia, podkroki ciała miękkiego); inaczej tylko
    // lot odłamków po pęknięciu.
    compute(dt, time, awake, fp) {
      if (needsInit) { renderer.compute(init); needsInit = false; }
      if (resetPending) { renderer.compute(resetAttached); resetPending = false; }
      if (!awake) {
        this.substeps = 0;
        if (time < flyUntil) renderer.compute(idleGroup);
        return;
      }
      // Prędkość fali w siatce ≈ prędkość fali pola (rozciąganie; ściskanie ~1,9× szybciej).
      const cMax = 0.15 * L.cell * HEX_MAX_SUBSTEPS * 60;
      const c = Math.min(fp.waveSpeed, cMax);
      const h = Math.min(1 / 240, 0.15 * L.cell / Math.max(c, 1));
      acc += dt;
      let pairs = Math.floor(acc / (2 * h));
      const maxPairs = HEX_MAX_SUBSTEPS / 2;
      if (pairs > maxPairs) { pairs = maxPairs; acc = 0; } else acc -= pairs * 2 * h;
      const k = c / (0.642 * L.cell);
      X.uK.value = k * k;
      X.uDtS.value = h;
      X.uDampK.value = Math.exp(-Math.max(fp.damping * 2.5, WAVE_DAMP_MIN) * h);
      X.uHealK.value = Math.exp(-h / HEAL_TIME);
      X.uElastK.value = Math.exp(-h / ELASTIC_TIME);
      X.uYield.value = YIELD * L.cell;
      X.uHeatK.value = Math.exp(-h / Math.max(0.05, fp.coolTime * HEAT_TIME_K));
      X.uHeatDiff.value = Math.min(0.2, 4 * HEAT_DIFFUSION * h / (L.cell * L.cell));
      X.uStressK.value = Math.exp(-h / STRESS_TIME);
      X.uMaxDef.value = 0.46 * L.cell;
      X.uHeatOn.value = fp.energyOn ? 1 : 0;
      X.uKickOn.value = fp.wavesOn ? 1 : 0;
      this.substeps = pairs * 2;
      renderer.compute(groups[pairs * 2]);
    },
    // Odczyt stanu płytek do strojenia (tylko z konsoli / skryptu — alokuje).
    async probe() {
      const [dA, hA, lA] = await Promise.all([defA, heatA, lookB].map((b) => renderer.getArrayBufferAsync(b.value)));
      const d = new Float32Array(dA), h = new Float32Array(hA), l = new Float32Array(lA);
      let maxDef = 0, maxV = 0, maxHeat = 0, maxStress = 0, maxDent = 0, lit = 0, stressed = 0, flying = 0;
      for (let i = 0; i < n; i++) {
        maxDef = Math.max(maxDef, Math.hypot(d[i * 4], d[i * 4 + 1]));
        maxV = Math.max(maxV, Math.hypot(d[i * 4 + 2], d[i * 4 + 3]));
        maxHeat = Math.max(maxHeat, h[i * 4]);
        maxStress = Math.max(maxStress, h[i * 4 + 1]);
        maxDent = Math.max(maxDent, Math.hypot(h[i * 4 + 2], h[i * 4 + 3]));
        if (l[i * 4] > 0.05) lit++;
        if (l[i * 4 + 1] > 0.15) stressed++;
      }
      const p = new Float32Array(await renderer.getArrayBufferAsync(poseB.value));
      for (let i = 0; i < n; i++) if (p[i * 4 + 3] > 0) flying++;
      return { n, cell: L.cell, maxDef, maxDefCells: maxDef / L.cell, maxDentCells: maxDent / L.cell, maxV, maxHeat, maxStress, lit, stressed, flying };
    },
    dispose() {
      group.remove(mesh);
      mesh.geometry.dispose();
      mat.dispose();
      for (const node of [init, resetAttached, inject, stepAB, stepBA, finalize]) node.dispose?.();
      for (const b of [restB, nrmB, nbrB, defA, defB, heatA, heatB, stB, flyV, poseB, lookB]) b.value?.dispose?.();
    }
  };
}
