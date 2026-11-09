// Atlas w demie bazy (prośba użytkownika 2026-11-09: „dodaj do dema Atlasa latającego po płaszczyźnie gry, żebym mógł testować taranowanie”).
// Kadłub: sprite gracza z gry (assets/capital_ship_rect_v1.png) w skali gry (HULL_RENDER_PROFILES.atlas: 3000 × HULL_RENDER_WORLD_SCALE 0,6 = 1800 j. długości),
// w płaszczyźnie gry (z = 0), bryła ±POL_WYS: pas, w którym leżą szyb habitatu, pomosty i wieżowce (węzły z −140…140). Szyja zaczyna się nad nim (z 220).
// Sterowanie: W/S ciąg, A/D obrót, Shift dopalacz (jak W + Shift w grze, do 1500 j./s), X hamulec, T: statek pod kursor, C: kamera za statkiem.
// Lot liczy się w krokach solvera (60 Hz), więc pauza i tempo działają. Obraz między krokami z ułamkiem kroku, jak węzły (uTau).
// Taran: solver z flagą `statek` (kStatek w src/3d/woksele/solver.js): węzły w kadłubie wypchnięte, prędkość wchodząca w kadłub zdjęta, kotwice pod kadłubem wyrwane.
// Pęd oddany węzłom wraca do Atlasa po odczycie z GPU (kilka klatek opóźnienia): Atlas zwalnia na tym, co pcha. Masa w masach węzła, ?atlasMasa=.
import * as THREE from 'three/webgpu';
import { texture, uv, vec3, vec4, float } from 'three/tsl';
import { STATEK_SDF } from '../../src/3d/woksele/solver.js';

const DLUGOSC = 1800; // HULL_RENDER_PROFILES.atlas.length 3000 × HULL_RENDER_WORLD_SCALE 0,6 (src/data/ships.js)
const POL_WYS = 150;
const PLASTRY = 10; // burty: plastry sprite'a pod wierzchem, z ukosa kadłub ma grubość
const START = Object.freeze({ x: 0, y: -3200, kurs: Math.PI / 2 }); // od −y wolne podejście do szybu habitatu: pomosty leżą wzdłuż ±x
const V_MAX = 700, V_DOP = 1500; // j./s; W + Shift w grze: 1500 (reguła baza-piratow, TARAN)
const A_CIAG = 380, A_DOP = 1100, A_WSTECZ = 260, A_HAM = 1400, A_PONAD = 600; // j./s²; A_PONAD: zwalnianie do limitu po puszczeniu dopalacza
const OM_MAX = 0.45, E_OBR = 1.2; // rad/s, rad/s²
const TLUM_BOK = 0.8; // 1/s: stabilizator gasi dryf w bok, jak w grze
const MASA = 30000; // mas węzła: głowa wieży to około 6700, cała wieża z szybem 11 700
const H = 1 / 60;

/** Kwadrat odległości do najbliższej komórki cechy (f = 0) wzdłuż jednej osi, położenia q · s (Felzenszwalb, Huttenlocher). */
function edt1(f, n, s, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let x = 0;
    for (;;) {
      const r = v[k];
      x = ((f[q] + (q * s) ** 2) - (f[r] + (r * s) ** 2)) / (2 * s * (q - r));
      if (x <= z[k]) k--; else break;
    }
    k++;
    v[k] = q;
    z[k] = x;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q * s) k++;
    d[q] = (q - v[k]) * s * ((q - v[k]) * s) + f[v[k]];
  }
}

/** Kwadrat odległości [j.²] każdej komórki do najbliższej komórki z cecha[k] = 1, siatka W × H, odstępy sx, sy. */
function edt2(cecha, W, Hh, sx, sy) {
  const DUZO = 1e12; // ponad każdy kwadrat odległości w kadłubie (~3,6e6 j.²), a dodawany do niego (q · s)² nie ginie w zaokrągleniu jak przy 1e20
  const g = new Float64Array(W * Hh);
  const n = Math.max(W, Hh);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < Hh; j++) f[j] = cecha[j * W + i] ? 0 : DUZO;
    edt1(f, Hh, sy, d, v, z);
    for (let j = 0; j < Hh; j++) g[j * W + i] = d[j];
  }
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) f[i] = g[j * W + i];
    edt1(f, W, sx, d, v, z);
    for (let i = 0; i < W; i++) g[j * W + i] = d[i];
  }
  return g;
}

/**
 * Pole odległości obrysu [j., ujemne w kadłubie] na siatce STATEK_SDF z kanału alfa sprite'a. Kolumna 0 to rufa (lx = −hx), wiersz 0 to ly = −hy (dół obrazka:
 * tekstura z flipY kładzie górny wiersz obrazka na +y kadłuba). Wnętrze komórki: alfa średnia z 4 × 4 próbek.
 */
export function poleKadluba(obraz, hx, hy) {
  const W = STATEK_SDF.szer, Hh = STATEK_SDF.wys, SS = 4;
  const can = document.createElement('canvas');
  can.width = W * SS;
  can.height = Hh * SS;
  const ctx = can.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(obraz, 0, 0, can.width, can.height);
  const a = ctx.getImageData(0, 0, can.width, can.height).data;
  const wewn = new Uint8Array(W * Hh);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const jy = Hh - 1 - j;
    let suma = 0;
    for (let b = 0; b < SS; b++) for (let c = 0; c < SS; c++) suma += a[4 * ((jy * SS + b) * can.width + i * SS + c) + 3];
    wewn[j * W + i] = suma > 128 * SS * SS ? 1 : 0;
  }
  return poleZMaski(wewn, W, Hh, hx, hy);
}

/** Pole odległości [j., ujemne wewnątrz] z maski komórek kadłuba (1 = wnętrze) na prostokącie 2·hx × 2·hy. Granica leży w pół drogi między środkami komórek. */
export function poleZMaski(wewn, W, Hh, hx, hy) {
  const zewn = new Uint8Array(W * Hh);
  for (let k = 0; k < zewn.length; k++) zewn[k] = wewn[k] ? 0 : 1;
  const sx = (2 * hx) / W, sy = (2 * hy) / Hh, pol = 0.25 * (sx + sy);
  const doWewn = edt2(wewn, W, Hh, sx, sy), doZewn = edt2(zewn, W, Hh, sx, sy);
  const pole = new Float32Array(W * Hh);
  for (let k = 0; k < pole.length; k++) pole[k] = wewn[k] ? -(Math.sqrt(doZewn[k]) - pol) : Math.sqrt(doWewn[k]) - pol;
  return pole;
}

export async function createAtlas({ solver, obraz, camera, sterowanie, kanwa, renderer, masa = MASA }) {
  if (!solver.statek) throw new Error('Atlas: solver bez flagi statek');
  const tex = await new THREE.TextureLoader().loadAsync(new URL('../../assets/capital_ship_rect_v1.png', import.meta.url).href);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const L = DLUGOSC, Sz = Math.round((DLUGOSC * tex.image.height) / tex.image.width);
  const hx = L / 2, hy = Sz / 2;
  solver.statek.ksztalt(poleKadluba(tex.image, hx, hy));
  solver.statek.ustaw({ aktywny: false, h: [hx, hy, POL_WYS] });
  const I = (masa * (L * L + Sz * Sz)) / 12;

  // ── Siatki ── Wierzch: sprite z gry, Lambert w świetle dema, cień na bazę. Burty: te same plastry ciemniej. Dysze: świecą przy ciągu (barwa > 1 w celu HDR).
  const grupa = new THREE.Group();
  grupa.name = 'Atlas';
  const t = texture(tex, uv());
  const maska = t.a.greaterThan(0.5);
  const geo = new THREE.PlaneGeometry(L, Sz);
  const mWierzch = new THREE.MeshLambertNodeMaterial();
  mWierzch.name = 'AtlasWierzch';
  mWierzch.colorNode = vec4(t.rgb, float(1));
  mWierzch.maskNode = maska;
  mWierzch.maskShadowNode = maska;
  const wierzch = new THREE.Mesh(geo, mWierzch);
  wierzch.name = 'AtlasWierzch';
  wierzch.position.z = POL_WYS;
  const mBurty = new THREE.MeshLambertNodeMaterial();
  mBurty.name = 'AtlasBurty';
  mBurty.colorNode = vec4(t.rgb.mul(0.32), float(1));
  mBurty.maskNode = maska;
  mBurty.maskShadowNode = maska;
  const burty = new THREE.InstancedMesh(geo, mBurty, PLASTRY);
  burty.name = 'AtlasBurty';
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < PLASTRY; k++) burty.setMatrixAt(k, m4.makeTranslation(0, 0, -POL_WYS + ((2 * POL_WYS) * k) / PLASTRY));
  burty.instanceMatrix.needsUpdate = true;
  const mDysza = new THREE.MeshBasicNodeMaterial();
  mDysza.name = 'AtlasDysze';
  mDysza.colorNode = vec3(6, 3.0, 1.0);
  const dysze = [-1, 1].map((st) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 90, 110), mDysza);
    m.name = 'AtlasDysza';
    m.position.set(-hx + 30, st * 0.27 * hy, 0);
    return m;
  });
  for (const m of [wierzch, burty, ...dysze]) { m.frustumCulled = false; grupa.add(m); }
  wierzch.castShadow = true;
  wierzch.receiveShadow = true;
  burty.castShadow = true;
  burty.receiveShadow = true;
  obraz.scene.add(grupa);
  obraz.cienieDodatkowe.push(wierzch, burty); // rozgrzewka passa cienia (obraz.rozgrzej)

  const st = {
    aktywny: false, x: START.x, y: START.y, kurs: START.kurs, vx: 0, vy: 0, om: 0, ciag: 0, kamera: false, pokolenie: 0, czyta: false,
    styki: 0, kotwice: 0, ped: 0, rysX: START.x, rysY: START.y, zwolnienie: 0,
  };
  const klaw = new Set();
  const reczne = { w: false, s: false, a: false, d: false, dop: false, ham: false };
  const wcisniety = (k) => klaw.has(k);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !e.repeat && st.aktywny) { podKursor(); return; }
    if (e.code === 'KeyC' && !e.repeat && st.aktywny) { kameraZa(!st.kamera); return; }
    klaw.add(e.code);
  });
  window.addEventListener('keyup', (e) => klaw.delete(e.code));
  window.addEventListener('blur', () => klaw.clear());
  let kursor = null;
  kanwa.addEventListener('pointermove', (ev) => { kursor = ev; });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function podKursor() {
    if (!kursor) return;
    const r = kanwa.getBoundingClientRect();
    ndc.set(((kursor.clientX - r.left) / r.width) * 2 - 1, -((kursor.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.z) < 1e-6) return;
    const k = -o.z / d.z;
    if (k <= 0) return;
    ustaw({ x: o.x + d.x * k, y: o.y + d.y * k, v: 0 });
  }

  /** Kamera za statkiem: cel kamery na środku kadłuba, dalej przesuwa się razem z nim (orbita i przybliżenie zostają). */
  function kameraZa(wl) {
    st.kamera = wl;
    if (!wl) return;
    const dx = st.rysX - sterowanie.target.x, dy = st.rysY - sterowanie.target.y;
    camera.position.x += dx; camera.position.y += dy;
    sterowanie.target.x += dx; sterowanie.target.y += dy;
  }

  /** Poza i prędkość (harness, T, start). v: wzdłuż kursu [j./s]. Odczyt pędu w locie z poprzedniej pozy przepada (pokolenie). */
  function ustaw({ x = st.x, y = st.y, kurs = st.kurs, v = null, om = 0 } = {}) {
    st.x = x; st.y = y; st.kurs = kurs; st.om = om;
    if (v !== null) { st.vx = Math.cos(kurs) * v; st.vy = Math.sin(kurs) * v; }
    st.pokolenie++;
    st.rysX = x; st.rysY = y;
  }

  /**
   * Pęd oddany węzłom od poprzedniego odczytu (masa węzła 1), moment wokół środka kadłuba, styki i wyrwane kotwice. Odczyt tu, na stronie dema (strażnik szwu renderu):
   * getArrayBufferAsync wysyła kopię od razu, a zerowanie liczników idzie za nią w kolejce GPU, więc żaden podkrok nie przepada.
   */
  async function odczytPedu() {
    const S = solver.statek;
    const obietnica = renderer.getArrayBufferAsync(S.atrybut);
    renderer.compute(S.zeruj);
    const b = new Int32Array(await obietnica);
    return { px: b[0] / S.skala.ped, py: b[1] / S.skala.ped, pz: b[2] / S.skala.ped, moment: b[3] / S.skala.moment, styki: b[4], kotwice: b[5] };
  }

  /** Reset sceny: Atlas na starcie, bez prędkości. Aktywny tylko na scenach bazy. */
  function reset(aktywny) {
    st.aktywny = aktywny;
    grupa.visible = aktywny;
    st.styki = 0; st.kotwice = 0; st.ped = 0; st.zwolnienie = 0;
    ustaw({ x: START.x, y: START.y, kurs: START.kurs, v: 0 });
    solver.statek.ustaw({ aktywny: false });
  }

  /** Krok lotu przed krokiem solvera: sterowanie, poza kadłuba na początek kroku do solvera, całkowanie, odczyt pędu oddanego węzłom. */
  function krok() {
    if (!st.aktywny) return;
    const c = Math.cos(st.kurs), s = Math.sin(st.kurs);
    const dop = reczne.dop || wcisniety('ShiftLeft') || wcisniety('ShiftRight');
    const v0 = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
    let a = 0;
    if (reczne.w || wcisniety('KeyW')) a += dop ? A_DOP : A_CIAG;
    if (reczne.s || wcisniety('KeyS')) a -= A_WSTECZ;
    st.vx += c * a * H;
    st.vy += s * a * H;
    // Stabilizator: dryf w bok gaśnie, prędkość wzdłuż kursu zostaje.
    const vF = st.vx * c + st.vy * s, vB = (-st.vx * s + st.vy * c) * Math.exp(-TLUM_BOK * H);
    st.vx = vF * c - vB * s;
    st.vy = vF * s + vB * c;
    // Limit: ciąg nie rozpędza ponad limit trybu, a ponad nim (puszczony dopalacz) prędkość schodzi do limitu o A_PONAD.
    const v = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
    const vMax = dop ? V_DOP : V_MAX;
    const ham = reczne.ham || wcisniety('KeyX');
    const vCel = ham ? Math.max(0, Math.min(v, v0) - A_HAM * H) : v > vMax ? Math.max(vMax, Math.min(v, v0 - A_PONAD * H)) : v;
    if (vCel < v && v > 1e-6) { const k = vCel / v; st.vx *= k; st.vy *= k; }
    const omCel = ((reczne.a || wcisniety('KeyA') ? 1 : 0) - (reczne.d || wcisniety('KeyD') ? 1 : 0)) * OM_MAX;
    st.om += Math.max(-E_OBR * H, Math.min(E_OBR * H, omCel - st.om));
    st.ciag = a > 0 ? (dop ? 1 : 0.55) : 0;
    solver.statek.ustaw({ aktywny: true, c: [st.x, st.y, 0], kurs: st.kurs, v: [st.vx, st.vy, 0], om: st.om });
    st.x += st.vx * H;
    st.y += st.vy * H;
    st.kurs += st.om * H;
    if (!st.czyta) {
      st.czyta = true;
      const pok = st.pokolenie;
      odczytPedu().then((r) => {
        st.czyta = false;
        st.styki = r.styki;
        st.kotwice += r.kotwice;
        if (pok !== st.pokolenie || !st.aktywny) return;
        // Odrzut: pęd oddany węzłom (masa 1) zdejmowany z kadłuba, moment wokół jego środka.
        st.vx -= r.px / masa;
        st.vy -= r.py / masa;
        st.om -= r.moment / I;
        st.ped += Math.sqrt(r.px * r.px + r.py * r.py);
        st.zwolnienie = Math.sqrt(r.px * r.px + r.py * r.py) / masa;
      }, (e) => { st.czyta = false; console.warn('[atlas] odczyt pędu', e); });
    }
  }

  /** Przed rysunkiem: poza w chwili obrazu (ułamek kroku jak węzły), dysze, kamera za statkiem. Bez alokacji. */
  function klatka(akum = 0) {
    if (!st.aktywny) return;
    const x = st.x + st.vx * akum, y = st.y + st.vy * akum, kurs = st.kurs + st.om * akum;
    if (st.kamera) {
      const dx = x - st.rysX, dy = y - st.rysY;
      camera.position.x += dx; camera.position.y += dy;
      sterowanie.target.x += dx; sterowanie.target.y += dy;
    }
    st.rysX = x; st.rysY = y;
    grupa.position.set(x, y, 0);
    grupa.rotation.set(0, 0, kurs);
    const dl = 20 + st.ciag * 260;
    for (const m of dysze) { m.scale.x = dl; m.position.x = -hx + 30 - 0.5 * dl; }
    grupa.updateMatrixWorld(true);
  }

  return {
    krok, klatka, reset, ustaw, kameraZa, podKursor,
    /** Harness: wciśnięte klawisze bez klawiatury (w, s, a, d, dop, ham). */
    sterowanie(o = {}) { Object.assign(reczne, o); },
    wlacz(b) { st.aktywny = b; grupa.visible = b; if (!b) solver.statek.ustaw({ aktywny: false }); },
    get aktywny() { return st.aktywny; },
    get kamera() { return st.kamera; },
    stan() {
      return { x: Math.round(st.x), y: Math.round(st.y), kurs: +st.kurs.toFixed(3), v: Math.round(Math.sqrt(st.vx * st.vx + st.vy * st.vy)), om: +st.om.toFixed(3), styki: st.styki, kotwice: st.kotwice, ped: Math.round(st.ped), masa, wymiary: [L, Sz, 2 * POL_WYS] };
    },
  };
}
