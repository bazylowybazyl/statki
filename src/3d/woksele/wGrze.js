// Wiązane woksele w misji 1: obraz bazy piratów na Core3D gry (moduł renderu: strona w trybie off, worker w trybie gracza). Woła go src/3d/pirateBaseGame.js. A/B: ?woksele=0 (stary obraz). Plan: docs/PLAN-zawalenia-lod-miasto.md § 5e.
// Rozgrywka bez zmian (zasada 1): punkty, kolizje, etapy i upadek liczy stary silnik belek, a jego bryły i skóry są tylko schowane. Woksele to sam obraz: trafienia i rozpady przychodzą zdarzeniami, a ruch gruzu nie wraca do gry.
//
// Kolejność:
// 1. przy attach: budowa węzłów w osobnym wątku (~4 s), solver i obraz, rozgrzewka. Stara baza stoi, dopóki to nie skończy, więc start nic nie zatrzymuje.
// 2. wypiek skóry: stara baza widziana z góry, kolor HDR i głębia. Górne ściany wokseli biorą z niego barwę, a wnętrza i przełomy zostają betonem (obraz.js, skoraFn).
// 3. pierwsze trafienie włącza solver, cele głębi i pełny obraz odłamków: dopóki nikt nie strzela, koszt to sam rysunek.
//
// Rysunek: ta sama siatka w passie tła (węzły pod uCiecieZ, kadłuby przykrywają je) i w passie FG (węzły nad nim), jak bryły starej bazy. Znak w userData obiektu, jeden pipeline.
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec4, positionGeometry } from 'three/tsl';
import { WYS_BOK, createWokseleSolver, GINIE_BOK } from './solver.js';
import { createWokseleObraz } from './obraz.js';
import { OPCJE_PYLU } from './pyl.js';
import { PARAMETRY } from './budowa.js';
import { POJEMNOSC_BAZY } from './scenaBazy.js';
import { createGrupyGry } from './grupyGry.js';
import { compileAsyncNaCelu } from '../rozgrzewka.js';
import { sunShadowUniforms } from '../sunShadowMask.js';
import { createPirateBaseLayout } from '../portBuildings/pirateBaseLayout.js';

const H = 1 / 60;
const WARSTWA_TLO = 1;
const WARSTWA_FG = 2;
const DX = 40;
const LOD = { sloty: 2, cien: 0 };
const GRUNT_GRY = -70000; // poniżej kuli skały (środek 56 km niżej, r 32 km): węzły giną na kuli (ustawGinie), a grawitacja ku jej środkowi nie zsuwa ich z boku, więc grunt solvera nie działa
const POLE_ZAKRES_J = 5000; // na tej drodze pod najniższym węzłem budowli grawitacja przechodzi ze stałej w ku środkowi skały
const Z_PROMIENIA = 150; // pocisk leci w płaszczyźnie gry: krater w pierwszym węźle pod nią, nie na dachu
const HITY_MAX = 16;
const KROKOW_NA_KLATKE = 3; // przy spadku klatek obrazu: 20 kl/s to wciąż pełne 60 kroków/s
const SLABE_KOM = 120; // trafienia słabsze od progu sumują się w tej komórce (szybkostrzelne, wiązki), potem jeden krater
const SLABE_PROG = 15;
const UDERZENIA_CO_S = 0.25; // odczyt kubełków z GPU
const KUBELEK_J = 250;
// Krater na bryłę, nie na kubełek: sąsiednie kubełki z jednego odczytu to jedna bryła, która właśnie uderzyła. Promień rośnie z jej rozmiarem, więc wieża zostawia wielki krater, a sypki gruz sam pył. Krater na kubełek dawał tysiące równych dołków (GRA/t10).
const PLAMA_KUBELEK_MIN = 8; // tyle węzłów w kubełku w jednym odczycie, żeby należał do bryły: sypki gruz jest rzadszy
const PLAMA_MIN = 20; // tyle węzłów w bryle, żeby został krater: także odłam wieżowca. Przy tych progach cały upadek daje ~150 kraterów (log GRA/t14)
const KRATER_J = 48; // r = KRATER_J · ∛węzłów: bok bryły przy komórce 40 j., razy 1,2
const KRATER_R_MAX = 1500;
const KRATEROW_MAX = 300;
const KRATER_WZROST = 1.2; // uderzenie w istniejący krater dosypuje masę, a stempel idzie dopiero, gdy promień urósł o tyle
const FALA_START_S = 3; // kotwice zaczynają puszczać tyle po HP 0, od habitatu na zewnątrz
const FALA_J_S = 1500; // części puszczają całe, po kolei według odległości ich środka od osi habitatu (kPuscCzesc): węzeł po węźle bryła pękała w locie
const ZGAS_PO_S = 44; // po tylu sekundach od upadku ruiny leżą: solver stoi, a siatki rysują je dalej w ostatniej pozie
const LATA_KRATEROW = 14000; // połowa boku mapy kraterów [j.]: pole rozbieżne rozrzuca gruz szerzej niż pole ku środkowi skały
const WYS_POL_J = 16000; // połowa boku mapy kształtu skały [j.]: dalej kształt z brzegu mapy
// Pole rozbieżne (uwaga użytkownika 2026-11-07: „wszystko leci w centrum”, odłamki z lewej mają lądować na lewej części planety): linie spadku wychodzą z punktu ROZB_L nad bazą,
// na prostej środek skały → środek bazy, więc środek bazy ląduje tam, gdzie dotąd, a jej boki wachlarzem dalej. Ku środkowi skały dopiero w pasie ROZB_PAS_J nad nią (gruz nie zsuwa się ze zboczy).
// Bez tego 78 % ściągania to perspektywa ujęcia (zostaje: daje pomniejszanie), a 22 % pole ku środkowi skały (badanie z 2026-11-07, plan LOD § 5g).
const ROZB_L = 20000;
const ROZB_PAS_J = 6000;
const WIEZA_OM = 0.3; // [rad/s] obrót startowy wieży przy zerwaniu szyi, ku stronie upadku: bez przegubu wieża wsuwała się w szyb zamiast się przechylić

function wypiekB1(dx) {
  return new Promise((ok, nie) => {
    const watek = new Worker(new URL('./budowa.worker.js', import.meta.url), { type: 'module' });
    watek.onerror = (e) => nie(new Error(`budowa B1: ${e.message}`));
    watek.onmessage = ({ data }) => {
      watek.terminate();
      if (data.blad) nie(new Error(data.blad)); else ok(data);
    };
    watek.postMessage({ id: 'B1', miasto: { dx, wGrze: true, gruntZ: GRUNT_GRY } });
  });
}

export function createWokseleGry({ Core3D }) {
  const root = new THREE.Group();
  root.name = 'Woksele bazy';
  root.matrixAutoUpdate = false;
  root.userData.fgCategory = 'stations';
  const macOdw = new THREE.Matrix4();
  const stan = {
    proba: 0, gotowe: false, aktywny: false, ukryty: false, soczewka: false, slonce: false,
    px: 0, py: 0, os: 0, cOs: 1, sOs: 0, krok: 0, akum: 0, przepadlo: 0, klatek: 0, klatekZn: 0, trafien: 0, kraterow: 0, kadr: true, obrazWKadrze: false,
    srodekX: 0, srodekY: 0, zasieg: 0, skoraCzeka: null, cullingWypieku: null, szyjaCieta: false, upadekT: -1, zgaszony: false,
    skalaOk: false, skalaC: [0, 0, 0], skalaR: 0, odczytT: 0, czytam: false, uderzen: 0, krateryN: 0, kubX0: 0, kubY0: 0, glebRuin: 0, zegarKrok: 0, wysX0: 0, wysY0: 0,
  };
  const hity = [];
  const slabe = new Map();
  let ginieStare = new Uint32Array(GINIE_BOK * GINIE_BOK);
  const plamaZn = new Uint8Array(GINIE_BOK * GINIE_BOK), plamaStos = new Int32Array(GINIE_BOK * GINIE_BOK);
  const krateryPam = new Float32Array(4 * KRATEROW_MAX); // x, y układu węzłów, promień, węzły
  let zNajnizej = null; // najniższy węzeł wypieku: wyżej budowla stoi w polu, w którym ją wypieczono
  const wysCpu = new Float32Array(WYS_BOK * WYS_BOK); // r − R skały, kopia mapy kształtu z solvera: miejsce kraterów
  let zbudowane = null;
  let s = null;

  async function zbuduj() {
    // Attach może przyjść przed urządzeniem GPU (start gry prosto w misji): czekanie, nie błąd. Bez urządzenia po minucie zostaje stary obraz.
    for (let t = 0; !Core3D.renderer && t < 600; t++) await new Promise((ok) => setTimeout(ok, 100));
    const renderer = Core3D.renderer;
    if (!renderer) throw new Error('woksele: Core3D bez urządzenia');
    if (!(Core3D.scene instanceof THREE.Scene)) throw new Error('woksele: inna instancja three niż Core3D, węzły TSL się nie skleją');
    const poj = POJEMNOSC_BAZY[DX];
    const solver = createWokseleSolver({ maxNodes: poj.maxWez, par: { ...PARAMETRY, nKom: poj.nKom } });
    const cp = Core3D.cameraPersp;
    const kamLok = new THREE.PerspectiveCamera(cp.fov, cp.aspect, cp.near, cp.far);
    kamLok.matrixAutoUpdate = false;
    kamLok.matrixWorldAutoUpdate = false;
    const obraz = createWokseleObraz({ solver, camera: kamLok, wGrze: true });
    const dane = await wypiekB1(DX);
    const { w, g, rDysk, poklad, miasto } = dane;
    const l = createPirateBaseLayout({ id: 'B1' });
    const grupy = createGrupyGry({ w, l, dx: DX });

    // Skład pyłu: kwad na cały cel w passie FG, ten sam wzór co kwad wyjścia dema (kolor · 1 + tło · (1 − a)), bez ekspozycji dema.
    const matPyl = new THREE.NodeMaterial();
    matPyl.name = 'WokPylSklad';
    matPyl.map = null;
    matPyl.lights = false;
    matPyl.vertexNode = vec4(positionGeometry.xy, 0, 1);
    matPyl.fragmentNode = texture(obraz.pyl.rt.texture, screenUV);
    matPyl.transparent = true;
    matPyl.depthTest = false;
    matPyl.depthWrite = false;
    matPyl.side = THREE.DoubleSide;
    matPyl.forceSinglePass = true;
    matPyl.toneMapped = false;
    matPyl.blending = THREE.CustomBlending;
    matPyl.blendSrc = THREE.OneFactor;
    matPyl.blendDst = THREE.OneMinusSrcAlphaFactor;
    matPyl.blendSrcAlpha = THREE.OneFactor;
    matPyl.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    const kwadPyl = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matPyl);
    kwadPyl.name = 'WokPylSklad';
    kwadPyl.frustumCulled = false;
    kwadPyl.renderOrder = 1e6;
    // W passie tła: kłęby spod płaszczyzny gry leżą pod kadłubami. Pył nad płaszczyzną też idzie pod nie; rozdzielenie cząstek po wysokości to drugi cel i drugi rysunek pyłu.
    kwadPyl.layers.set(WARSTWA_TLO);

    const meshFg = obraz.mesh, gruzFg = obraz.meshGruz;
    meshFg.castShadow = false;
    meshFg.receiveShadow = false;
    gruzFg.receiveShadow = false;
    const meshTlo = new THREE.Mesh(meshFg.geometry, meshFg.material);
    const gruzTlo = new THREE.Mesh(gruzFg.geometry, gruzFg.material);
    meshTlo.name = 'WokBrylyTlo';
    gruzTlo.name = 'WokGruzTlo';
    for (const [m, warstwa, znak] of [[meshFg, WARSTWA_FG, 1], [gruzFg, WARSTWA_FG, 1], [meshTlo, WARSTWA_TLO, -1], [gruzTlo, WARSTWA_TLO, -1]]) {
      m.frustumCulled = false;
      m.layers.set(warstwa);
      m.userData.znakZ = znak;
      m.visible = false; // do końca rozgrzewki i wypieku: inaczej pierwszy rysunek kompiluje pipeline w klatce
      root.add(m);
    }
    kwadPyl.visible = false;
    root.add(kwadPyl);

    // Prostokąt wypieku i zakres wysokości: kwadrat, żeby piksel był równy w obu osiach. Z zapasem na kolce i maszty, których węzły nie niosą.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < w.n; i++) {
      const x = w.pos[3 * i], y = w.pos[3 * i + 1], z = w.pos[3 * i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const zapas = 500;
    const bok = Math.max(x1 - x0, y1 - y0) + 2 * zapas;
    const cx = 0.5 * (x0 + x1), cy = 0.5 * (y0 + y1);
    const gora = z1 + 1500, zakres = gora - (z0 - 300);
    const kamSkora = new THREE.OrthographicCamera(-bok / 2, bok / 2, bok / 2, -bok / 2, 1, 1 + zakres);
    kamSkora.matrixAutoUpdate = false;
    kamSkora.matrixWorldAutoUpdate = false;
    kamSkora.layers.disableAll();
    kamSkora.layers.enable(WARSTWA_TLO);
    kamSkora.layers.enable(WARSTWA_FG);
    const skoraUklad = { x0: cx - bok / 2, y0: cy - bok / 2, w: bok, h: bok, gora, zakres, srodek: [cx, cy], bok };
    stan.zasieg = 0.75 * bok;
    renderer.initRenderTarget?.(obraz.rtSkora);
    renderer.initRenderTarget?.(obraz.rtSkoraCien);

    // Części bazy (zakresy węzłów z wypieku) z czasem puszczenia: od osi habitatu na zewnątrz, cała część naraz.
    const czesci = (miasto?.budynki || []).map((c) => {
      let sx = 0, sy = 0;
      for (let i = c.start; i < c.start + c.n; i++) { sx += w.pos[3 * i]; sy += w.pos[3 * i + 1]; }
      const r = c.n ? Math.sqrt((sx / c.n) ** 2 + (sy / c.n) ** 2) : 0;
      return { od: c.start, n: c.n, nazwa: c.nazwa, t: FALA_START_S + r / FALA_J_S };
    }).sort((a, b) => a.t - b.t);

    const zaladuj = () => {
      solver.wczytaj(w);
      solver.uniformy.uFalaWzgl.value = 1;
      // Stojąca konstrukcja albo stoi, albo pęka: ruch połączony z kotwicami wolniejszy niż próg fali łamiącej jest tłumiony (lepkość), szybszy łamie. Bez tego zgięta konstrukcja sprężynowała i kołysała się jak galareta.
      const uU = solver.uniformy;
      if (uU.uFalaV2.value < 1e29) uU.uLepV2.value = Math.max(uU.uLepV2.value, uU.uFalaV2.value);
      obraz.wczytaj(w, { rDysk, poklad, pyl: OPCJE_PYLU.B1, lod: LOD, budynki: miasto?.budynki ?? null });
      const Hk = l.habitat;
      obraz.ustawKola([Hk.neckR, Hk.coreR, Hk.headR, Hk.ringR0, Hk.innerR - Hk.innerW, Hk.innerR, Hk.ringR1, Hk.drumR - Hk.wall, Hk.drumR, Hk.tier2R, Hk.tier1R, Hk.discR]);
      solver.ustawPlan({ ...g, kratery: [], puscKotwiceF: -1 });
      obraz.uAoMoc.value = 0;
      ginieStare.fill(0);
    };
    zaladuj();

    const ct = Core3D.composerTarget;
    obraz.ustawRozmiar(renderer, ct.width, ct.height);

    const ustawKamere = () => {
      macOdw.copy(root.matrixWorld).invert();
      kamLok.matrixWorld.multiplyMatrices(macOdw, cp.matrixWorld);
      kamLok.matrixWorldInverse.copy(kamLok.matrixWorld).invert();
      kamLok.projectionMatrix.copy(cp.projectionMatrix);
      kamLok.projectionMatrixInverse.copy(cp.projectionMatrixInverse);
    };
    ustawKamere();

    /** Kompilacja na własnym celu: stan renderera wraca od razu, bo w tym czasie gra rysuje klatki (wzór Rozgrzewka._compile). */
    const naCelu = (rt, co, kam) => {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      try { return compileAsyncNaCelu(renderer, co, kam); } finally { renderer.setRenderTarget(prev); }
    };

    s = { renderer, solver, obraz, w, g, grupy, czesci, kamLok, cp, zaladuj, ustawKamere, naCelu, meshFg, gruzFg, meshTlo, gruzTlo, kwadPyl, kamSkora, skoraUklad };

    let obWarm = null;
    Core3D.addFxStep({
      name: 'woksele',
      warm: () => (obWarm = (async () => {
        await solver.rozgrzej(renderer);
        await obraz.rozgrzejKernele(renderer);
      })()),
      update: krokFx,
    });
    await obWarm;
    Core3D.scene.add(root);
    root.updateMatrixWorld(true);
    await naCelu(obraz.rtGleb, obraz.sceneGleb, kamLok);
    await naCelu(obraz.rtSsao, obraz.kwadSsao, obraz.kwadSsao.camera);
    await naCelu(obraz.pyl.rt, obraz.pyl.scena, kamLok);
    await Core3D.warmup.now([meshFg, gruzFg], { name: 'woksele: bryły FG', layer: WARSTWA_FG });
    await Core3D.warmup.now([meshTlo, gruzTlo, kwadPyl], { name: 'woksele: bryły tła', layer: WARSTWA_TLO });
    return s;
  }

  /** Węzły, które od ostatniego odczytu doleciały do skały, jako uderzenia obrazu planetoidy. Tylko obraz: gra o nich nie wie. Bez czekania klatki, odczyt wraca, kiedy wróci. */
  async function czytajUderzenia() {
    if (stan.czytam || !stan.skalaOk) return;
    stan.czytam = true;
    const proba = stan.proba;
    try {
      const nowe = await s.solver.odczytGinie(s.renderer);
      if (proba !== stan.proba || !stan.gotowe) return;
      const stare = ginieStare, zn = plamaZn, stos = plamaStos, B = GINIE_BOK;
      for (let q = 0; q < nowe.length; q++) zn[q] = nowe[q] - stare[q] >= PLAMA_KUBELEK_MIN ? 1 : 0;
      const plamy = [];
      for (let q0 = 0; q0 < zn.length; q0++) {
        if (!zn[q0]) continue;
        let sp = 0, n = 0, sx = 0, sy = 0;
        zn[q0] = 0;
        stos[sp++] = q0;
        while (sp > 0) {
          const q = stos[--sp], kx = q % B, ky = (q - kx) / B, d = nowe[q] - stare[q];
          n += d; sx += d * (kx + 0.5); sy += d * (ky + 0.5);
          for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
            const x = kx + a, y = ky + b;
            if (x < 0 || y < 0 || x >= B || y >= B) continue;
            const w = y * B + x;
            if (zn[w]) { zn[w] = 0; stos[sp++] = w; }
          }
        }
        if (n >= PLAMA_MIN) plamy.push([n, sx / n, sy / n]);
      }
      // Szczyt licznika, nie ostatnia wartość: węzeł, który zsunął się do sąsiedniego kubełka i wrócił, nie jest nowym uderzeniem.
      for (let q = 0; q < nowe.length; q++) if (nowe[q] > stare[q]) stare[q] = nowe[q];
      plamy.sort((a, b) => b[0] - a[0]);
      for (let e = 0; e < plamy.length; e++) pokazUderzenie(plamy[e][0], plamy[e][1], plamy[e][2]);
      stan.skala?.koniecPaczki();
    } catch (blad) {
      console.warn('[woksele] odczyt uderzeń', blad);
    } finally {
      stan.czytam = false;
    }
  }

  /** Bryła n węzłów uderzyła w punkcie (kx, ky) siatki kubełków. Sam obraz: pył daje kPylSkala z tych samych węzłów, tu tylko mapa kraterów. */
  function pokazUderzenie(n, kx, ky) {
    const x0 = stan.kubX0, y0 = stan.kubY0;
    // Bryła z jednego kubełka leży na jego środku: rozrzut, inaczej takie kratery układają się w kratkę. Hasz numeru uderzenia, bez Math.random (zasada 9).
    const h = Math.imul(stan.krateryN + stan.uderzen + 1, 0x9E3779B1) >>> 0;
    const lx = x0 + (kx + (h & 1023) / 1023 - 0.5) * KUBELEK_J, ly = y0 + (ky + ((h >>> 10) & 1023) / 1023 - 0.5) * KUBELEK_J;
    const r = Math.min(KRATER_R_MAX, KRATER_J * Math.cbrt(n));
    const K = krateryPam;
    // Kolejne porcje tej samej bryły i gruz sypiący się w krater nie robią nowych dołków, tylko go powiększają.
    for (let i = 0; i < stan.krateryN; i++) {
      const o = 4 * i, dx = lx - K[o], dy = ly - K[o + 1], rO = K[o + 2], zas = 0.8 * Math.max(r, rO);
      if (dx * dx + dy * dy >= zas * zas) continue;
      K[o + 3] += n;
      const rN = Math.min(KRATER_R_MAX, KRATER_J * Math.cbrt(K[o + 3]));
      if (r > rO) { K[o] = lx; K[o + 1] = ly; }
      if (rN >= KRATER_WZROST * rO) {
        K[o + 2] = rN;
        stemplujKrater(K[o], K[o + 1], rN, K[o + 3]);
      }
      return;
    }
    if (stan.krateryN >= KRATEROW_MAX) return;
    const o = 4 * stan.krateryN++;
    K[o] = lx; K[o + 1] = ly; K[o + 2] = r; K[o + 3] = n;
    stemplujKrater(lx, ly, r, n);
  }

  function stemplujKrater(lx, ly, r, n) {
    const C = stan.skalaC, R = promienLok(lx, ly);
    const dd = (lx - C[0]) ** 2 + (ly - C[1]) ** 2;
    if (dd >= R * R) return;
    const lz = C[2] + Math.sqrt(R * R - dd);
    const [sx, sy] = naScene(lx, ly);
    if (stan.skala.krater(sx, sy, lz, r, Math.min(1, 0.45 + n / 400))) stan.uderzen++;
  }

  /** Promień skały pod punktem układu węzłów, dwuliniowo z mapy kształtu. Kierunek krateru liczony z kuli przy zboczu wypadał do kilkuset jednostek obok miejsca, w które spadł gruz. */
  function promienLok(lx, ly) {
    const N = WYS_BOK, k = N / (2 * WYS_POL_J);
    const fx = Math.max(0, Math.min(N - 1, (lx - stan.wysX0) * k - 0.5)), fy = Math.max(0, Math.min(N - 1, (ly - stan.wysY0) * k - 0.5));
    const x0 = Math.min(N - 2, Math.floor(fx)), y0 = Math.min(N - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const a = wysCpu[y0 * N + x0] * (1 - tx) + wysCpu[y0 * N + x0 + 1] * tx;
    const b = wysCpu[(y0 + 1) * N + x0] * (1 - tx) + wysCpu[(y0 + 1) * N + x0 + 1] * tx;
    return stan.skalaR + a * (1 - ty) + b * ty;
  }

  /** Mapa kształtu skały pod bazą: tę samą bryłę, którą widać, dostają kontakt, pył i kratery. */
  function zbudujKsztaltSkaly() {
    const N = WYS_BOK, bok = 2 * WYS_POL_J, C = stan.skalaC, R = stan.skalaR;
    const x0 = stan.kubX0 + 0.5 * GINIE_BOK * KUBELEK_J - WYS_POL_J, y0 = stan.kubY0 + 0.5 * GINIE_BOK * KUBELEK_J - WYS_POL_J;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lx = x0 + ((i + 0.5) * bok) / N, ly = y0 + ((j + 0.5) * bok) / N;
      const dd = (lx - C[0]) ** 2 + (ly - C[1]) ** 2;
      const lz = C[2] + Math.sqrt(Math.max(0, R * R - dd));
      const [sx, sy] = naScene(lx, ly);
      wysCpu[j * N + i] = stan.skala.promienW(sx, sy, lz) - R;
    }
    stan.wysX0 = x0;
    stan.wysY0 = y0;
    s.solver.ustawWysokosciSkaly(wysCpu, x0, y0, bok);
  }

  /** Punkt układu węzłów w XY sceny. */
  function naScene(lx, ly) {
    return [stan.px + stan.cOs * lx + stan.sOs * ly, -stan.py - stan.sOs * lx + stan.cOs * ly];
  }

  /** Czy baza może być w kadrze. Daleko (hala K-7, inny układ) nie liczy się nic: ani solver, ani cele. */
  function wKadrze() {
    const cp = s.cp;
    if (Core3D.isFreePerspectiveCamera?.()) return true;
    const dx = cp.position.x - stan.srodekX, dy = cp.position.y - stan.srodekY;
    // Gruz może leżeć na skale, a tam kadr perspektywy jest dużo szerszy niż w płaszczyźnie gry: bez tego ruiny znikały w połowie ekranu, a skała zostawała.
    const glebia = stan.aktywny || stan.zgaszony ? stan.glebRuin : 0;
    const pol = (Math.abs(cp.position.z) + glebia) * Math.tan((cp.fov * Math.PI) / 360) * Math.max(1, cp.aspect);
    const R = stan.zasieg + pol;
    return dx * dx + dy * dy < R * R;
  }

  /** Stara baza do wypieku: własna scena, bez nieba i planetoidy z warstw 1, 2 sceny gry. Maska słońca wyłączona: czyta ekran z innego kadru. */
  function wypalSkore() {
    const { renderer, obraz, kamSkora, skoraUklad } = s;
    const { base, koniec, scena } = stan.skoraCzeka;
    stan.skoraCzeka = null;
    const vis = base.root.visible;
    base.root.visible = true;
    const mask0 = sunShadowUniforms.uSunShadowOn.value;
    sunShadowUniforms.uSunShadowOn.value = 0;
    const rt0 = renderer.getRenderTarget(), ac = renderer.autoClear, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    const u = base.uniforms?.uSunVisS;
    const vis0 = u ? u.value : 1;
    renderer.setRenderTarget(obraz.rtSkora);
    try {
      renderer.render(scena, kamSkora);
      // Drugi widok ze zgaszonym słońcem: maska słońca miesza oba. Stan bazy wraca niżej.
      if (u) u.value = 0;
      renderer.setRenderTarget(obraz.rtSkoraCien);
      renderer.render(scena, kamSkora);
    } finally {
      if (u) u.value = vis0;
      renderer.setRenderTarget(rt0);
      renderer.autoClear = ac;
      renderer.setClearColor(cc, ca);
      sunShadowUniforms.uSunShadowOn.value = mask0;
      Core3D.scene.add(base.root);
      base.root.visible = vis;
      if (stan.cullingWypieku) { for (const o of stan.cullingWypieku) o.frustumCulled = true; stan.cullingWypieku = null; }
    }
    obraz.ustawSkore(skoraUklad);
    koniec();
  }

  function krokFizyki() {
    const { renderer, solver, obraz } = s;
    if (hity.length && !solver.strzalCzeka) {
      const h = hity.shift();
      const r = Math.min(240, Math.max(55, 45 + 1.6 * Math.sqrt(h.dmg)));
      solver.strzel({ o: [h.x, h.y, Z_PROMIENIA], dir: [0, 0, -1], r, J: 70, tau: 0.08, rP: 1.4 * r, rdzen: 0.5, rodz: r > 120 ? 'glowna' : 'mala' });
      stan.trafien++;
    }
    solver.krok(renderer);
    obraz.krok(renderer);
    stan.krok++;
    // Zegar upadku idzie z krokami solvera: fala kotwic, odczyt uderzeń i zamrożenie ruin nie mogą wyprzedzić tego, co naprawdę spadło.
    if (stan.upadekT >= 0) stan.upadekT += H;
    stan.zegarKrok += H;
  }

  function krokFx() {
    if (!s) return;
    // Wypiek nie w skoku: stara baza jedzie wtedy z obrazem skały, a kamera wypieku stoi na prawdziwym miejscu, więc cel wyszedłby pusty, a skóra szara na stałe.
    if (stan.skoraCzeka && stan.slonce && !stan.soczewka) wypalSkore();
    if (!stan.gotowe) return;
    const { renderer, obraz, meshFg, gruzFg, meshTlo, gruzTlo, kwadPyl, kamLok, ustawKamere } = s;
    const blisko = wKadrze();
    // W skoku obraz bazy jedzie w kadrze z soczewką, choć prawdziwe miejsce jest daleko: siatki tak, ale solver i cele tylko blisko.
    const kadr = !stan.ukryty && (stan.obrazWKadrze || blisko);
    stan.kadr = kadr;
    // Ruiny po zamrożeniu leżą na skale: pass FG nie ma co rysować, a odłamki dawno zgasły. Dwa rysunki po 85 tys. węzłów mniej przez resztę misji.
    const zywe = kadr && !stan.zgaszony;
    meshFg.visible = zywe; gruzFg.visible = zywe; meshTlo.visible = kadr; gruzTlo.visible = zywe;
    // Upadek liczy się do końca także poza kadrem, najwyżej ZGAS_PO_S raz na grę: gracz, który odleciał, wraca do ruin na skale, a nie do bazy wiszącej bez kolizji.
    const liczy = (blisko || stan.upadekT >= 0) && !stan.zgaszony;
    kwadPyl.visible = kadr && liczy && stan.aktywny && !stan.soczewka;
    obraz.uAoMoc.value = stan.aktywny && liczy && !stan.soczewka ? 1 : 0;
    if (!liczy) { stan.akum = 0; hity.length = 0; return; }
    if (!stan.aktywny) return;
    stan.klatek++;
    let k = 0;
    while (stan.akum >= H && k < KROKOW_NA_KLATKE) {
      krokFizyki();
      stan.akum -= H;
      k++;
    }
    if (k === KROKOW_NA_KLATKE) stan.klatekZn++;
    if (stan.akum >= H) { stan.przepadlo++; stan.akum = H * 0.999; }
    // Wieża przy zerwaniu szyi: cała naraz, bez sprężenia, z obrotem ku stronie upadku (zdarzenie voxNeck).
    if (stan.wiezaPusc) {
      s.solver.puscCzesc(renderer, stan.wiezaPusc);
      stan.wiezaPusc = null;
    }
    // Fala puszczania kotwic od habitatu: środek uderza pierwszy, końce pomostów kilka sekund później, każda część w całości.
    if (stan.upadekT >= FALA_START_S && !stan.falaKoniec) {
      const cz = s.czesci;
      while (stan.puscIdx < cz.length && cz[stan.puscIdx].t <= stan.upadekT) s.solver.puscCzesc(renderer, cz[stan.puscIdx++]);
      if (stan.puscIdx >= cz.length) {
        // Węzły spoza tabeli części (gdyby jakieś były) puszcza jeszcze stara fala, raz.
        s.solver.puscKolo(renderer, 0, 0, 1e7);
        stan.falaKoniec = true;
      }
    }
    // Odczyt od pierwszego zdarzenia, nie od HP 0: gruz zniszczonego wieżowca też spada na skałę i zostawia krater.
    if (stan.zegarKrok - stan.odczytT >= UDERZENIA_CO_S) {
      stan.odczytT = stan.zegarKrok;
      czytajUderzenia();
    }
    if (!blisko) return;
    ustawKamere();
    obraz.ustawRozmiar(renderer, Core3D.composerTarget.width, Core3D.composerTarget.height);
    obraz.rysujCele(renderer, kamLok, stan.akum);
  }

  /** Kula kontaktu, grawitacja ku skale i łata kraterów. Promień z siatki skały pod bazą, bo mapa kształtu odsuwa powierzchnię od R: tak ruiny leżą na skale, a nie nad nią. Węzły spadają ku środkowi skały, więc siatka kubełków i łata stoją na rzucie środka bazy na kulę. */
  function ustawSkale(R) {
    const [bx, by] = s.skoraUklad.srodek;
    const C = stan.skalaC;
    const ex = bx - C[0], ey = by - C[1], ez = -C[2];
    const k = R / Math.sqrt(ex * ex + ey * ey + ez * ez);
    const cx = C[0] + k * ex, cy = C[1] + k * ey, z = C[2] + k * ez;
    stan.skalaR = R;
    stan.kubX0 = cx - 0.5 * GINIE_BOK * KUBELEK_J;
    stan.kubY0 = cy - 0.5 * GINIE_BOK * KUBELEK_J;
    if (zNajnizej === null) {
      const p = s.w.pos;
      let m = Infinity;
      for (let i = 0; i < s.w.n; i++) if (p[3 * i + 2] < m) m = p[3 * i + 2];
      zNajnizej = m;
    }
    // Punkt rozbieżności pola: na prostej środek skały → środek bazy, ROZB_L nad bazą. Środek bazy spada więc dokładnie tam, gdzie siatka kubełków.
    const kx = bx - C[0], ky = by - C[1], kz = -C[2], kd = Math.sqrt(kx * kx + ky * ky + kz * kz) || 1;
    const rozbF = [bx + (kx / kd) * ROZB_L, by + (ky / kd) * ROZB_L, (kz / kd) * ROZB_L];
    s.solver.ustawGinie({ c: C, R, x0: stan.kubX0, y0: stan.kubY0, kom: KUBELEK_J, zPola: zNajnizej - 200, zakresPola: POLE_ZAKRES_J, rozbF, rozbPas: ROZB_PAS_J });
    const dMax = Math.sqrt((cx - C[0]) ** 2 + (cy - C[1]) ** 2) + stan.zasieg;
    stan.glebRuin = Math.max(0, -(C[2] + Math.sqrt(Math.max(0, R * R - dMax * dMax))));
    const [sx, sy] = naScene(cx, cy);
    return [sx, sy, z];
  }

  /** Pierwsze zdarzenie: odtąd solver, cele głębi i odłamki. Do tej chwili baza stoi nieruchomo i kosztuje sam rysunek. */
  function aktywuj() {
    if (stan.aktywny) return;
    stan.aktywny = true;
    if (stan.skalaOk) {
      const [sx, sy, z] = ustawSkale(stan.skalaR);
      const R = stan.skala.promien(sx, sy, z, LATA_KRATEROW);
      const p = ustawSkale(R);
      stan.skala.lata(p[0], p[1], p[2], LATA_KRATEROW);
      zbudujKsztaltSkaly();
    }
    s.obraz.pelnyObraz(true);
    s.obraz.uAoMoc.value = 1;
  }

  const naLokalny = (dx, dy) => ({ x: stan.cOs * dx - stan.sOs * dy, y: stan.sOs * dx + stan.cOs * dy });

  return {
    root,
    get gotowe() { return stan.gotowe; },

    /** Baza w miejscu z planu misji. skala: { center: [x, h, z] układu bazy, R }. Kończy się, gdy można schować starą bazę. Ponowny attach (nowa gra): reset buforów, bez nowych pipeline'ów. */
    async start({ place, base, skala = null }) {
      const proba = ++stan.proba;
      stan.gotowe = false;
      stan.aktywny = false;
      stan.slonce = false;
      stan.szyjaCieta = false;
      stan.upadekT = -1;
      stan.zgaszony = false;
      stan.odczytT = 0;
      stan.zegarKrok = 0;
      stan.falaKoniec = false;
      stan.puscIdx = 0;
      stan.wiezaPusc = null;
      stan.uderzen = 0;
      stan.krateryN = 0;
      hity.length = 0;
      slabe.clear();
      const pierwszy = !zbudowane;
      if (!zbudowane) zbudowane = zbuduj().catch((e) => { zbudowane = null; throw e; });
      await zbudowane;
      if (proba !== stan.proba) return false;
      const o = place.toGame(0, 0), os = place.headingToGame(0);
      stan.px = o.x; stan.py = o.y; stan.os = os;
      stan.cOs = Math.cos(os); stan.sOs = Math.sin(os);
      root.position.set(o.x, -o.y, 0);
      root.rotation.set(0, 0, -os);
      root.updateMatrix();
      if (root.parent !== Core3D.scene) Core3D.scene.add(root);
      root.updateMatrixWorld(true);
      s.obraz.ustawObrotNormalnych(-os);
      const [cx, cy] = s.skoraUklad.srodek;
      stan.srodekX = o.x + stan.cOs * cx + stan.sOs * cy;
      stan.srodekY = -o.y - stan.sOs * cx + stan.cOs * cy;
      if (!pierwszy) s.zaladuj();
      stan.krok = 0; stan.akum = 0;
      // Skała w układzie węzłów: X = x bazy, Y = −z bazy, Z = z sceny (środek skały ma w polu h gotową głębokość sceny, pirateBaseGame.js: attachPirateRock).
      stan.skalaOk = !!skala;
      stan.skala = skala;
      stan.glebRuin = 0;
      if (skala) {
        stan.skalaC = [skala.center[0], -skala.center[2], skala.center[1]];
        ustawSkale(skala.R);
      }

      // Kamera wypieku: układ węzłów, oś patrzenia −z, góra obrazu to +Y (v = 0 w górnym wierszu celu, pułapka 4).
      const kam = s.kamSkora, u = s.skoraUklad;
      kam.matrixWorld.copy(root.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(u.srodek[0], u.srodek[1], u.gora + 1));
      kam.matrixWorldInverse.copy(kam.matrixWorld).invert();
      kam.updateProjectionMatrix();
      const scena = new THREE.Scene();
      const vis = base.root.visible;
      base.root.visible = true;
      scena.add(base.root);
      // compileAsync nie liczy bryły widzenia tej kamery: siatki z cullingiem odpadałyby na starej, a ich pipeline powstałby potem w klatce wypieku (t1: PortBuildingBG @ Baza piratów_bg_box).
      const zCullingiem = [];
      base.root.traverse((o) => { if (o.frustumCulled) { zCullingiem.push(o); o.frustumCulled = false; } });
      stan.cullingWypieku = zCullingiem;
      try {
        await s.naCelu(s.obraz.rtSkora, scena, kam);
      } finally {
        base.root.visible = vis;
      }
      if (proba !== stan.proba) { for (const o of zCullingiem) o.frustumCulled = true; Core3D.scene.add(base.root); return false; }
      await new Promise((koniec) => { stan.skoraCzeka = { base, scena, koniec }; });
      if (proba !== stan.proba) return false;
      stan.gotowe = true;
      globalThis.__wokGra = this;
      return true;
    },

    stop() {
      stan.proba++;
      stan.gotowe = false;
      stan.aktywny = false;
      if (stan.skoraCzeka) { const { base, koniec } = stan.skoraCzeka; stan.skoraCzeka = null; Core3D.scene.add(base.root); koniec(); }
      if (stan.cullingWypieku) { for (const o of stan.cullingWypieku) o.frustumCulled = true; stan.cullingWypieku = null; }
      if (s) for (const m of [s.meshFg, s.gruzFg, s.meshTlo, s.gruzTlo, s.kwadPyl]) m.visible = false;
      hity.length = 0;
      root.removeFromParent();
    },

    /** Stan klatki z updatePirateBase3D. dt: czas gry, 0 w pauzie. */
    klatka(dt, { ukryty = false, soczewka = false, obrazWKadrze = false, moc = 1, slonce = false, sunDx = 0, sunDy = 0 } = {}) {
      if (slonce) stan.slonce = true;
      stan.ukryty = ukryty;
      stan.obrazWKadrze = obrazWKadrze;
      if (soczewka !== stan.soczewka && s) {
        stan.soczewka = soczewka;
        // W skoku całość w tle: pass FG rysuje się po statku, a bryła jedzie z obrazem skały.
        s.meshFg.layers.set(soczewka ? WARSTWA_TLO : WARSTWA_FG);
        s.gruzFg.layers.set(soczewka ? WARSTWA_TLO : WARSTWA_FG);
      }
      if (!stan.gotowe) return;
      s.obraz.uSkoraMoc.value = 0.02 + 0.98 * Math.max(0, Math.min(1, moc));
      const dlS = Math.sqrt(sunDx * sunDx + sunDy * sunDy);
      if (dlS > 0) s.obraz.ustawSlonceSkaly((stan.cOs * sunDx - stan.sOs * sunDy) / dlS, (stan.sOs * sunDx + stan.cOs * sunDy) / dlS);
      const d = Math.min(0.25, Math.max(0, dt));
      if (stan.aktywny) stan.akum += d;
      if (stan.upadekT >= ZGAS_PO_S && !stan.zgaszony) {
        stan.zgaszony = true;
        stan.aktywny = false;
        s.obraz.uniformy.uTau.value = 0;
      }
    },

    /** Zdarzenia z gry: voxHit (x, y, obrażenia), voxBreak (id kawałka), voxNeck (kierunek upadku), voxFall (kierunek upadku albo nic). */
    zdarzenie(typ, a, b, c) {
      if (!stan.gotowe) return;
      if (stan.zgaszony) return;
      if (typ === 'voxHit') {
        let dmg = Number(c) || 0;
        const q = naLokalny(a - stan.px, -b + stan.py);
        // Słabe trafienia (Laser Ciągły, Vulcan, Tempest Mk I): suma po komórce siatki, krater dopiero po przekroczeniu progu. Rozrzut luf nie rozbija sumy, bo liczy się komórka, nie ostatni punkt.
        if (dmg < SLABE_PROG) {
          const kl = Math.round(q.x / SLABE_KOM) * 65536 + Math.round(q.y / SLABE_KOM);
          dmg += slabe.get(kl) || 0;
          if (dmg < SLABE_PROG) { slabe.set(kl, dmg); return; }
          slabe.delete(kl);
        }
        aktywuj();
        const ost = hity[hity.length - 1];
        // Seria w jedno miejsce (wiązka, szybkostrzelne): suma obrażeń w jednym kraterze.
        if (ost && (ost.x - q.x) ** 2 + (ost.y - q.y) ** 2 < 900) { ost.dmg += dmg; return; }
        if (hity.length >= HITY_MAX) hity.shift();
        hity.push({ x: q.x, y: q.y, dmg });
        return;
      }
      if (typ === 'voxBreak') {
        // W locie nic się nie tnie (uwaga użytkownika 2026-11-07: „sam fakt, że leci, nie powinien sprawiać, że się rozczłonkowuje”): bryła rozbija się dopiero, gdy w coś uderzy. Kratery ćwiartek bębna przy HP 0 rozbijały go, zanim ruszył.
        if (stan.upadekT >= 0) return;
        const lista = s.grupy.kawalek(String(a));
        if (!lista.length) return;
        aktywuj();
        stan.kraterow += lista.length;
        s.solver.dodajKratery(lista);
        return;
      }
      if (typ === 'voxNeck' || typ === 'voxFall') {
        const fx0 = Number(a), fy0 = Number(b);
        const dl = Math.sqrt(fx0 * fx0 + fy0 * fy0);
        const f = dl > 1e-6 ? naLokalny(fx0 / dl, -fy0 / dl) : { x: 0, y: -1 };
        aktywuj();
        // Szyja tylko przy zerwaniu w grze, przed HP 0. Przy upadku wieża zostaje na szybie i spada razem z habitatem.
        if (typ === 'voxNeck' && !stan.szyjaCieta && stan.upadekT < 0) {
          stan.szyjaCieta = true;
          // Szyja i wierzch szybu: w grze szyb pęka w tej samej chwili (index.html, onSnap), więc w obrazie też nie zostaje kikut, o który statek by się zatrzymał.
          // Kikut sprężynował pod przewracającą się wieżą, a w grze trzymał statek na kotwicach (uwagi użytkownika 2026-11-07).
          const lista = [...s.grupy.szyja(), ...s.grupy.kikut()];
          stan.kraterow += lista.length;
          s.solver.dodajKratery(lista);
          const wz = s.czesci.find((c) => c.nazwa === 'H-C + H-T');
          const z = s.grupy.szyjaZ, rN = s.grupy.szyjaR;
          // Oś obrotu na zewnętrznej krawędzi szyi po drugiej stronie upadku: góra wieży rusza ku stronie upadku. Cięcie płaszczyzną z: bez resztek wiązań do szybu.
          if (wz) stan.wiezaPusc = { od: wz.od, n: wz.n, zMin: z, piv: [-f.x * rN, -f.y * rN, z], om: [-f.y * WIEZA_OM, f.x * WIEZA_OM, 0] };
        }
        if (typ === 'voxFall' && stan.upadekT < 0) {
          // Cała baza spada (decyzja użytkownika 2026-11-06: „nie podobało mi się, że coś zostaje”): kotwice puszczają wszędzie.
          const { lista } = s.grupy.upadek(f.x, f.y);
          stan.kraterow += lista.length;
          s.solver.dodajKratery(lista);
          stan.upadekT = 0;
        }
      }
    },

    /** Dla narzędzi. */
    stan() {
      if (!s) return { etap: 'budowa' };
      return { n: s.w.n, dx: DX, gotowe: stan.gotowe, aktywny: stan.aktywny, kadr: stan.kadr, zgaszony: stan.zgaszony, krok: stan.krok, klatek: stan.klatek, klatekNaLimicie: stan.klatekZn, przepadlo: stan.przepadlo, trafien: stan.trafien, kraterow: stan.kraterow, uderzenSkala: stan.uderzen, krateryNaSkale: stan.krateryN, upadekT: +stan.upadekT.toFixed(1), kolejka: hity.length, liczniki: { ...s.solver.liczniki }, lod: s.obraz.lod };
    },
    get obraz() { return s?.obraz ?? null; },
    get solver() { return s?.solver ?? null; },
  };
}
