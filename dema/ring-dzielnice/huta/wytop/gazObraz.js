// HUTA — wytop: GAZ KOMORY — OBRAZ (marsz promienia w bryle studni + tarcza drgania powietrza). Bez window / DOM.
//
// WYGLĄD OD ZERA (SPEC, wpis 1 — wyglądu efektów gry nie kopiujemy; technika brył „przód / tył” jak domeny głębokie
// gazu gry): gaz sam NIE świeci — rozprasza światło kuli i pasa wyświetlacza i pochłania to, co za nim. Dym z rudy jest
// ciemny i matowy (na tle żaru rysuje się sylwetką), opary metalu to jasna, cienka mgiełka. Kształt kłębów pochodzi
// WYŁĄCZNIE z przepływu (pole z `gazSiatka.js`) — żadnego doklejonego szumu.
//
// Rysunek: dwie bryły zastępcze walca studni w grupie komory — PRZÓD (ściany przednie, test głębi: pokład i bryły przed
// studnią zasłaniają gaz) przy kamerze na zewnątrz, TYŁ (ściany tylne, bez testu) przy kamerze w środku. Promień
// w układzie komory, odcinek ucięty analitycznie: walec, błona, dno, stożek leja, lico wyświetlacza, bryła w środku
// (kupa / kula — elipsoida). Kroki o równej długości z przesunięciem startu (szum z piksela + numer klatki); w kroku
// dwa odczyty obrazu (stan poprzedni i bieżący kroku fizyki) przenikane ułamkiem kroku — bez skoków przy 240 kl/s.
// Światło policzone w kernelu obrazu raz na krok — w pętli marszu nie ma świateł. Pętla za flagą (bez `discard`).
// Wyjście premultiplied (rgb = Σ T · rozproszenie · ds, alfa = 1 − T), jasność z kolanem pod progiem bloomu.
import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, abs, clamp, dot, exp, float, fract, int, length, max, min, mix, normalize, positionLocal, screenCoordinate,
  sin, smoothstep, step, texture, texture3D, uniform, uniformArray, uv, vec2, vec3, vec4
} from 'three/tsl';
import { FX_DISTORT_LAYER } from '../../../../src/3d/fx/fxFrame.js';
import { KOMORA } from './geometria.js';
import { GAZ, GAZ_DISP, GAZ_FLOOR_SLOPE } from './gaz.js';

const FUN = KOMORA.funnel;
const MACH = KOMORA.mach;
const DEG = Math.PI / 180;
/** Wysięgniki segmentów cewek: [azymut, ±1 — górny / dolny pierścień] (kolejność slotów zasłon). */
const ARMS = Object.freeze([...MACH.upper.map((d) => [d * DEG, 1]), ...MACH.lower.map((d) => [d * DEG, -1])]);
const LUMA = vec3(0.2126, 0.7152, 0.0722);
const BIG = 1e7;

/** Kolejność rysowania gazu: po bryłach komory, przed błoną bramy (28), kroplami (30), błyskami (31) i iskrami (32). */
export const GAZ_RENDER_ORDER = 27;

/**
 * Obraz gazu jednej komory.
 * @param {object} o
 * @param {import('./gazSiatka.js').GazSiatka} o.grid
 */
export class GazObraz {
  constructor({ grid }) {
    this.grid = grid;
    const P = grid.preset;
    this.U = {
      cam: uniform(new THREE.Vector3(0, 2000, 0)),        // kamera w układzie komory
      mixAB: uniform(new THREE.Vector4(1, 0, 0, 0)),      // waga stanu obrA, waga stanu obrB, przesunięcie startu marszu (numer klatki), kolano jasności
      body: uniform(new THREE.Vector4(0, -1e6, 0, 1)),    // bryła w środku do ucięcia promienia: środek xyz, półoś pozioma
      body2: uniform(new THREE.Vector4(1, 0, 0, 0)),      // półoś pionowa, 0, 0, 0
      heat: uniform(new THREE.Vector4(0, 0, 0, 0)),       // drganie powietrza: czas [s], przesunięcie na gradient [px], amplituda fali [px], siła 0…1
      // ZASŁONY (runda 5, poprawki): maszyneria w studni ucina promień gazu — segment cewki: środek krzywizny łuku
      // x, z, wysokość osi segmentu, promień osi wysięgnika (początek wysięgnika i głowicy)
      seg: uniformArray(ARMS.map(() => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName('GazZaslonySeg'),
      mach: uniform(new THREE.Vector4(0, 0, 0, 0))        // wózek ssawy: x głowicy, 0, 0, 0
    };
    this.U.mixAB.value.w = grid.look.knee;
    const geo = new THREE.CylinderGeometry(GAZ.wallR, GAZ.wallR, GAZ.ceilY - GAZ.y0, 48, 1, false);
    geo.translate(0, (GAZ.ceilY + GAZ.y0) / 2, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const fragment = this._marchNode(P);
    const make = (inside) => {
      const mat = new THREE.NodeMaterial();
      mat.name = inside ? 'WytopGazTyl' : 'WytopGazPrzod';
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = !inside;
      mat.side = inside ? THREE.BackSide : THREE.FrontSide;
      mat.forceSinglePass = true;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.fragmentNode = fragment;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = inside ? 'Wytop_gaz_tyl' : 'Wytop_gaz_przod';
      mesh.frustumCulled = false;
      mesh.renderOrder = GAZ_RENDER_ORDER;
      mesh.visible = false;
      return mesh;
    };
    this.front = make(false);
    this.back = make(true);
    this.heat = this._heatMesh();
  }

  /** Marsz promienia przez pole obrazu (wspólny graf brył PRZÓD i TYŁ). */
  _marchNode(P) {
    const U = this.U;
    const grid = this.grid;
    const H = P.cell;
    const ORG = vec3(GAZ.x0, GAZ.y0, GAZ.z0);
    const INV = vec3(1 / (P.nx * H), 1 / (P.ny * H), 1 / (P.nz * H));
    const STEPS = P.march;
    const RC = GAZ.wallR;
    const YT = GAZ.ceilY;
    const YB = FUN.throatY;
    /**
     * Pierwsze przecięcie promienia ze stożkiem obrotowym ρ = a + b · y na wysokości y ∈ [yLo, yHi] za `t0`
     * (bez rozgałęzień: nieważne pierwiastki → BIG).
     */
    const coneHit = (ro, rd, a, b, yLo, yHi, t0) => {
      const m = float(0.0).toVar();
      m.assign(ro.y.mul(b).add(a));
      const n = float(0.0).toVar();
      n.assign(rd.y.mul(b));
      const A = float(0.0).toVar();
      A.assign(rd.x.mul(rd.x).add(rd.z.mul(rd.z)).sub(n.mul(n)));
      const B = float(0.0).toVar();
      B.assign(ro.x.mul(rd.x).add(ro.z.mul(rd.z)).sub(m.mul(n)));
      const C = float(0.0).toVar();
      C.assign(ro.x.mul(ro.x).add(ro.z.mul(ro.z)).sub(m.mul(m)));
      const disc = float(0.0).toVar();
      disc.assign(B.mul(B).sub(A.mul(C)));
      const sq = float(0.0).toVar();
      sq.assign(max(disc, 0.0).sqrt());
      const Ai = float(0.0).toVar();
      Ai.assign(float(1.0).div(mix(float(-1e-6), float(1e-6), step(0.0, A)).add(A)));
      const pick = (t) => {
        const y = ro.y.add(rd.y.mul(t));
        const ok = step(0.0, disc).mul(step(t0, t)).mul(step(yLo, y)).mul(step(y, yHi));
        return mix(float(BIG), t, ok);
      };
      const t1 = float(0.0).toVar();
      t1.assign(B.negate().sub(sq).mul(Ai));
      const t2 = float(0.0).toVar();
      t2.assign(B.negate().add(sq).mul(Ai));
      return min(pick(t1), pick(t2));
    };
    return Fn(() => {
      const ro = vec3(0.0).toVar();
      ro.assign(U.cam);
      const rd = vec3(0.0).toVar();
      rd.assign(normalize(positionLocal.sub(ro)));
      // walec studni
      const A = float(0.0).toVar();
      A.assign(max(rd.x.mul(rd.x).add(rd.z.mul(rd.z)), 1e-7));
      const B = float(0.0).toVar();
      B.assign(ro.x.mul(rd.x).add(ro.z.mul(rd.z)));
      const disc = float(0.0).toVar();
      disc.assign(B.mul(B).sub(A.mul(ro.x.mul(ro.x).add(ro.z.mul(ro.z)).sub(RC * RC))));
      const sq = float(0.0).toVar();
      sq.assign(max(disc, 0.0).sqrt());
      // warstwa wysokości: błona … poziom gardzieli
      const dy = float(0.0).toVar();
      dy.assign(mix(float(-1e-5), float(1e-5), step(0.0, rd.y)).add(rd.y));
      const ty0 = float(0.0).toVar();
      ty0.assign(float(YB).sub(ro.y).div(dy));
      const ty1 = float(0.0).toVar();
      ty1.assign(float(YT).sub(ro.y).div(dy));
      const tmin = float(0.0).toVar();
      tmin.assign(max(max(B.negate().sub(sq).div(A), min(ty0, ty1)), 0.0));
      const tmax = float(0.0).toVar();
      tmax.assign(min(B.negate().add(sq).div(A), max(ty0, ty1)));
      // stożek leja (gaz jest w środku: ρ < a + b · y) i lico wyświetlacza (gaz bliżej osi niż lico)
      const bF = 1 / GAZ_FLOOR_SLOPE;
      tmax.assign(min(tmax, coneHit(ro, rd, FUN.throatR - FUN.throatY * bF, bF, FUN.throatY, FUN.rimY, tmin)));
      tmax.assign(min(tmax, coneHit(ro, rd, GAZ_DISP.r0 - GAZ_DISP.y0 * GAZ_DISP.slope, GAZ_DISP.slope, GAZ_DISP.y0, GAZ_DISP.y1, tmin)));
      // bryła w środku (kupa / kula): elipsoida
      const er = vec3(0.0).toVar();
      er.assign(vec3(U.body.w, U.body2.x, U.body.w));
      const eo = vec3(0.0).toVar();
      eo.assign(ro.sub(U.body.xyz).div(er));
      const ed = vec3(0.0).toVar();
      ed.assign(rd.div(er));
      const ea = float(0.0).toVar();
      ea.assign(dot(ed, ed));
      const eb = float(0.0).toVar();
      eb.assign(dot(eo, ed));
      const edisc = float(0.0).toVar();
      edisc.assign(eb.mul(eb).sub(ea.mul(dot(eo, eo).sub(1.0))));
      const te = float(0.0).toVar();
      te.assign(eb.negate().sub(max(edisc, 0.0).sqrt()).div(ea));
      tmax.assign(min(tmax, mix(float(BIG), te, step(0.0, edisc).mul(step(tmin, te)))));
      // ZASŁONY: maszyneria w studni stoi przed gazem — promień kończy się na jej licu (płaszczyzna wierzchu przy
      // promieniu z góry, spodu przy promieniu z dołu; testy w planie). Bez tego gaz za cewką rysował się NA cewce.
      const down = float(0.0).toVar();
      down.assign(step(rd.y, 0.0));
      const planeHit = (yTop, yBot) => {
        const t = float(0.0).toVar();
        t.assign(mix(float(yBot), float(yTop), down).sub(ro.y).div(dy));
        const q = vec3(0.0).toVar();
        q.assign(ro.add(rd.mul(t)));
        return { t, q };
      };
      const clip = (t, ok) => tmax.assign(min(tmax, mix(float(BIG), t, ok.mul(step(tmin, t)))));
      const cosHalf = Math.cos((MACH.arcHalf + 2) * DEG);
      ARMS.forEach(([a, sy], i) => {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const S = U.seg.element(i);
        // segment cewki: łuk o promieniu `arcR` wokół (S.x, S.z), przekrój od arcR − 9 do arcR + 24, wysokość ± 26
        {
          const h = planeHit(S.y.add(26.0), S.y.sub(26.0));
          const dq = vec2(0.0).toVar();
          dq.assign(h.q.xz.sub(vec2(S.x, S.z)));
          const dl = float(0.0).toVar();
          dl.assign(max(length(dq), 1e-3));
          const ok = step(MACH.arcR - 9, dl).mul(step(dl, MACH.arcR + 24)).mul(step(cosHalf, dot(dq, vec2(ca, sa)).div(dl)));
          clip(h.t, ok);
        }
        // wysięgnik z głowicą: belka po promieniu od głowicy do ściany na stałej wysokości ±padY
        {
          const yA = sy * MACH.padY;
          const h = planeHit(yA + 22, yA - 22);
          const along = dot(h.q.xz, vec2(ca, sa));
          const side = abs(h.q.x.mul(-sa).add(h.q.z.mul(ca)));
          const ok = step(S.w.add(18.0), along).mul(step(along, GAZ.wallR)).mul(step(side, mix(float(18.0), float(30.0), step(along, S.w.add(80.0)))));
          clip(h.t, ok);
        }
      });
      // taśma w zatoce (prosta z = 260 na y = 40, koniec x = −292) i odbieralnik żużla (koryto przy ścianie)
      {
        const B = KOMORA.belt;
        const h = planeHit(B.pts[3][1] + 16, B.pts[3][1] - 16);
        const ok = step(h.q.x, B.pts[3][0] + 6).mul(step(abs(h.q.z.sub(B.pts[3][2])), B.width * 0.5 + 8));
        clip(h.t, ok);
      }
      {
        const T = KOMORA.tray;
        const h = planeHit(T.rimY + 4, T.floorY - 8);
        const r = length(h.q.xz);
        const ang = float(0.0).toVar();
        ang.assign(dot(normalize(h.q.xz.add(vec2(1e-4, 0.0))), vec2(Math.cos((T.az0 + T.az1) / 2), Math.sin((T.az0 + T.az1) / 2))));
        const ok = step(T.rIn - 6, r).mul(step(r, GAZ.wallR)).mul(step(Math.cos((T.az1 - T.az0) / 2 + 2 * DEG), ang));
        clip(h.t, ok);
      }
      // pierścień bramy 0 g (płaszczyzna x = boundaryX, torus wokół (ringY, z taśmy))
      {
        const B = KOMORA.belt;
        const t = float(0.0).toVar();
        t.assign(float(B.boundaryX).sub(ro.x).div(mix(float(-1e-5), float(1e-5), step(0.0, rd.x)).add(rd.x)));
        const q = vec3(0.0).toVar();
        q.assign(ro.add(rd.mul(t)));
        const rr = length(vec2(q.y.sub(B.ringY), q.z.sub(B.pts[3][2])));
        clip(t, step(B.ringR - 16, rr).mul(step(rr, B.ringR + 16)));
      }
      // wysięgnik ssawy (płaszczyzna z = 0, y = boomY) od głowicy wózka do ściany
      {
        const SS = KOMORA.ssawa;
        const h = planeHit(SS.boomY + 22, SS.boomY - 30);
        const ok = step(U.mach.x.sub(36.0), h.q.x).mul(step(h.q.x, GAZ.wallR)).mul(step(abs(h.q.z), 30.0));
        clip(h.t, ok);
      }
      const span = float(0.0).toVar();
      span.assign(tmax.sub(tmin));
      const col = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      // marsz za flagą: piksele bez odcinka w gazie nie wchodzą w pętlę
      If(disc.greaterThan(0.0).and(span.greaterThan(0.5)), () => {
        const ds = float(0.0).toVar();
        ds.assign(span.div(STEPS));
        const jit = float(0.0).toVar();
        jit.assign(fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189).add(U.mixAB.z)));
        Loop({ start: int(0), end: int(STEPS), type: 'int', condition: '<', name: 'gm' }, ({ gm }) => {
          const p = ro.add(rd.mul(tmin.add(float(gm).add(jit).mul(ds))));
          const uvw = vec3(0.0).toVar();
          uvw.assign(p.sub(ORG).mul(INV));
          const s = vec4(0.0).toVar();
          if (grid.obrB) s.assign(texture3D(grid.obrA, uvw).level(0).mul(U.mixAB.x).add(texture3D(grid.obrB, uvw).level(0).mul(U.mixAB.y)));
          else s.assign(texture3D(grid.obrA, uvw).level(0));
          const sig = float(0.0).toVar();
          sig.assign(max(s.w, 0.0));
          const e = float(0.0).toVar();
          e.assign(exp(sig.mul(ds).negate()));
          // rozproszenie na odcinku z tłumieniem wewnątrz odcinka: S / σ · (1 − e^(−σ ds))
          col.addAssign(max(s.xyz, vec3(0.0)).mul(trans.mul(float(1.0).sub(e)).div(max(sig, 1e-6))));
          trans.mulAssign(e);
          If(trans.lessThan(0.01), () => { Break(); });
        });
      });
      // kolano: luminancja rozproszenia < `knee` (pod progiem bloomu — gaz nie dokłada poświaty)
      const lum = float(0.0).toVar();
      lum.assign(dot(col, LUMA));
      col.mulAssign(float(1.0).div(lum.div(max(U.mixAB.w, 0.05)).add(1.0)));
      return vec4(col, clamp(float(1.0).sub(trans), 0.0, 1.0));
    })();
  }

  /**
   * TARCZA DRGANIA POWIETRZA nad gorącym gazem: siatka na warstwie zniekształceń (kamera z góry, osie sceny) czyta
   * mapę kolumn pola — ciepło H = ∫ T dy — i pisze przesunięcie w px: gradient ciepła + drobne falowanie ∝ H.
   * Drga tam, gdzie naprawdę jest gorący gaz. Lokalne (x, y) tarczy: x komory, −z komory; bok = bok domeny.
   */
  _heatMesh() {
    const U = this.U;
    const grid = this.grid;
    const m = new THREE.NodeMaterial();
    m.name = 'WytopGazDrganie';
    m.fragmentNode = Fn(() => {
      const q = vec2(0.0).toVar();
      q.assign(vec2(uv().x, float(1.0).sub(uv().y)));
      const e = 1 / grid.snx;
      const Hs = (dx, dz) => texture(grid.kol, q.add(vec2(dx * e, dz * e))).level(0).x;
      const h0 = float(0.0).toVar();
      h0.assign(Hs(0, 0));
      const g = vec2(0.0).toVar();
      g.assign(vec2(Hs(1, 0).sub(Hs(-1, 0)), Hs(0, 1).sub(Hs(0, -1))));
      const p = q.sub(0.5).mul(GAZ.size);
      const rim = float(1.0).sub(smoothstep(GAZ.wallR - 60, GAZ.wallR - 8, length(p)));
      const t = U.heat.x;
      const wave = vec2(
        sin(p.y.mul(0.047).add(t.mul(5.3))).add(sin(p.x.mul(0.031).sub(p.y.mul(0.022)).add(t.mul(3.7)))),
        sin(p.x.mul(0.043).sub(t.mul(4.6))).add(sin(p.x.mul(0.025).add(p.y.mul(0.036)).add(t.mul(6.1))))
      );
      const hk = clamp(h0, 0.0, 1.5);
      // osie sceny: X = x komory, Y = −z komory
      const off = vec2(g.x, g.y.negate()).mul(U.heat.y).add(vec2(wave.x, wave.y.negate()).mul(hk.mul(U.heat.z))).mul(rim).mul(U.heat.w);
      return vec4(clamp(off, vec2(-3.0), vec2(3.0)), 0.0, 0.0);
    })();
    m.transparent = true;
    m.depthTest = false;
    m.depthWrite = false;
    m.lights = false;
    m.fog = false;
    m.premultipliedAlpha = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquationAlpha = THREE.AddEquation;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.name = 'Wytop_gaz_drganie';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(FX_DISTORT_LAYER);
    mesh.visible = false;
    return mesh;
  }

  setLayer(layer) {
    this.front.layers.set(layer);
    this.back.layers.set(layer);
  }

  /**
   * Klatka obrazu.
   * @param {object} a  cam [x, y, z] (kamera w układzie komory), alpha (postęp kroku fizyki 0…1), frame (numer
   *                    klatki — przesunięcie startu marszu), body [x, y, z, półoś pozioma, półoś pionowa] (bryła
   *                    rysowana w tej klatce; półoś 0 — brak), on (gaz rysowany)
   */
  frame(a) {
    const U = this.U;
    const g = this.grid;
    U.cam.value.set(a.cam[0], a.cam[1], a.cam[2]);
    // kamera dla funkcji fazowej kernela obrazu (światło kuli rozpraszane ku kamerze)
    g.U.eye.value.set(a.cam[0], a.cam[1], a.cam[2]);
    // zasłony: położenie segmentów cewek i głowic wysięgników z tej klatki (`mach` = [promień pierścienia, wysokość
    // osi segmentów, środek klatki x, y, z, x głowicy wózka ssawy])
    const m = a.mach;
    if (m) {
      for (let i = 0; i < ARMS.length; i++) {
        const [ang, sy] = ARMS[i];
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const r0 = m[0] + m[2] * ca + m[4] * sa;
        U.seg.array[i].set(ca * (r0 - MACH.arcR), sy * m[1] + m[3], sa * (r0 - MACH.arcR), r0);
      }
      U.mach.value.x = m[5];
    }
    // stan bieżący kroku: `flip` (0 — obrA, 1 — obrB); poprzedni to drugi; presety bez przenikania czytają tylko obrA
    const al = g.obrB ? Math.max(0, Math.min(1, a.alpha)) : 1;
    if (g.obrB && g.flip === 1) U.mixAB.value.set(1 - al, al, 0, g.look.knee);
    else U.mixAB.value.set(al, 1 - al, 0, g.look.knee);
    if (!g.obrB) U.mixAB.value.set(1, 0, 0, g.look.knee);
    U.mixAB.value.z = ((a.frame | 0) % 64) * 0.61803398875 % 1;
    const b = a.body;
    if (b && b[3] > 0.5) {
      U.body.value.set(b[0], b[1], b[2], b[3] * 1.02);
      U.body2.value.x = b[4] * 1.02;
    } else {
      U.body.value.set(0, -1e6, 0, 1);
      U.body2.value.x = 1;
    }
    const inside = a.cam[0] * a.cam[0] + a.cam[2] * a.cam[2] < (GAZ.wallR + 6) * (GAZ.wallR + 6) && a.cam[1] > GAZ.y0 - 6 && a.cam[1] < GAZ.ceilY + 6;
    this.front.visible = a.on && !inside;
    this.back.visible = a.on && inside;
  }

  /**
   * Tarcza drgania: środek w scenie (x, y sceny), bok [j. sceny], czas [s], siła 0…1 (0 — tarcza ukryta). Woła krok
   * efektów (macierz liczona tutaj — Core3D liczy macierze sceny przed krokami).
   */
  placeHeat(x, y, size, time, strength) {
    const h = this.heat;
    const L = this.grid.look;
    this.U.heat.value.set(time % 1000, L.heatGrad, L.heatWave, strength);
    h.visible = strength > 0.001;
    if (!h.visible) return false;
    h.matrix.makeScale(size, size, 1);
    h.matrix.setPosition(x, y, 0);
    h.updateMatrixWorld(true);
    return true;
  }

  dispose() {
    this.front.geometry.dispose();
    this.front.material.dispose();
    this.back.material.dispose();
    this.heat.geometry.dispose();
    this.heat.material.dispose();
  }
}
