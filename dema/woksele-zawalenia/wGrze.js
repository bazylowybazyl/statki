// Pomiar: wiązane woksele z dema (scena B1) w prawdziwej misji 1, w workerze renderu, na Core3D gry. Poza grafem gry: ładuje go harness operacją dev (scripts/webgpu/gpu-baza-gra.mjs --woksele 1). Plan: docs/PLAN-zawalenia-lod-miasto.md § 5d.
// AGENT: to narzędzie pomiaru, nie port. Stara baza zostaje w kadrze, więc liczby to koszt DOŁOŻONY do starego silnika. Gra o wokselach nic nie wie: ostrzał ich nie trafia, sekwencja B1 idzie z planu, rusza na sygnał harnessu.
// Rysunek: bryły i gruz w passie FG (warstwa 2, perspektywa, światła i post gry, cień słońca gry), cele własne (głębia, AO, pył) w kroku Core3D.fx z kamerą w układzie solvera (float32 wystarcza, dane są lokalne). Własny węzeł słońca i kwad wyjścia dema nie są rysowane.
// AGENT: czego w grze brakuje wobec dema: światło błysku na bryłach (emissiveNode czyta positionWorld, a przy 5–10 mln j. to nie trafia w dane lokalne; koszt zostaje, obrazu nie ma), podłoga dema (skała gry leży inaczej, grunt solvera z = −3400 zostaje, ale bez siatki), ekspozycja i ACES dema (tu post gry).
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec4, positionGeometry } from 'three/tsl';
import { createWokseleSolver } from './solver.js';
import { createWokseleObraz } from './obraz.js';
import { OPCJE_PYLU } from './pyl.js';
import { PARAMETRY } from './budowa.js';
import { POJEMNOSC_BAZY } from './scenaBazy.js';
import { compileAsyncNaCelu } from '../../src/3d/rozgrzewka.js';

const H = 1 / 60;
const WARSTWA_FG = 2;

function wypiekB1(dx) {
  return new Promise((ok, nie) => {
    const watek = new Worker(new URL('./budowa.worker.js', import.meta.url), { type: 'module' });
    watek.onerror = (e) => nie(new Error(`budowa B1: ${e.message}`));
    watek.onmessage = ({ data }) => {
      watek.terminate();
      if (data.blad) nie(new Error(data.blad)); else ok(data);
    };
    watek.postMessage({ id: 'B1', miasto: { dx } });
  });
}

/**
 * Start: moduł po skończeniu ma krok efektów, siatki w scenie i rozgrzane pipeline'y. Scena stoi, plan rusza dopiero przez sekwencja().
 * px, py: toGame(0, 0) układu bazy, os: headingToGame(0). Układ B1: X = x, Y = −z, Z = wysokość, a gra: scena (x_gry, −y_gry). Stąd pozycja (px, −py, 0) i obrót o −os wokół z, bez odbicia (pułapka 37).
 */
export async function start({ Core3D, THREE: THREE_gry, px, py, os, dx = 40, lod = { sloty: 2, cien: 1 } }) {
  const tamto = THREE_gry?.Scene;
  if (tamto !== THREE.Scene || !(Core3D.scene instanceof THREE.Scene)) throw new Error('woksele: inna instancja three niż Core3D, węzły TSL się nie skleją');
  const renderer = Core3D.renderer;
  const poj = POJEMNOSC_BAZY[dx];
  const solver = createWokseleSolver({ maxNodes: poj.maxWez, par: { ...PARAMETRY, nKom: poj.nKom } });
  const cp = Core3D.cameraPersp;
  const kamLok = new THREE.PerspectiveCamera(cp.fov, cp.aspect, cp.near, cp.far);
  kamLok.matrixAutoUpdate = false;
  kamLok.matrixWorldAutoUpdate = false;
  const obraz = createWokseleObraz({ solver, camera: kamLok, wGrze: true });
  obraz.ustawObrotNormalnych(-os);

  const dane = await wypiekB1(dx);
  const { w, g, rDysk, poklad, miasto, zdarzeniaOd } = dane;
  const zaladuj = () => {
    solver.wczytaj(w);
    obraz.wczytaj(w, { rDysk, poklad, pyl: OPCJE_PYLU.B1, lod, budynki: miasto?.budynki ?? null });
  };
  zaladuj();

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
  kwadPyl.layers.set(WARSTWA_FG);

  const mesh = obraz.mesh, meshGruz = obraz.meshGruz;
  for (const m of [mesh, meshGruz]) {
    m.position.set(px, -py, 0);
    m.rotation.set(0, 0, -os);
    m.layers.set(WARSTWA_FG);
    m.visible = false;
    Core3D.scene.add(m);
    m.updateMatrixWorld(true);
  }
  kwadPyl.visible = false;
  Core3D.scene.add(kwadPyl);
  const macOdw = mesh.matrixWorld.clone().invert();

  const ct = Core3D.composerTarget;
  obraz.ustawRozmiar(renderer, ct.width, ct.height);

  const ustawKamere = () => {
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

  const stan = { krok: 0, akum: 0, ostatnia: -1, pelnyOd: Infinity, pierwszy: false, gotowe: false, plan: false, tKlatki: 0, przepadlo: 0, klatek: 0, wysokoKrokow2: 0 };
  let obWarm = null;
  const krokFx = {
    name: 'woksele',
    warm: () => (obWarm = (async () => {
      await solver.rozgrzej(renderer);
      await obraz.rozgrzejKernele(renderer);
    })()),
    update() {
      if (!stan.gotowe) return;
      const P = globalThis.__gpuProbe; // etykiety sondy: krok dodany po jej założeniu nie ma etykiety z automatu
      const lab0 = P ? P.curLabel : null;
      if (P) P.curLabel = 'fx:woksele-fizyka';
      const teraz = Core3D.frameNowMs();
      const dtMs = stan.ostatnia >= 0 ? teraz - stan.ostatnia : 16.7;
      stan.ostatnia = teraz;
      stan.klatek++;
      stan.akum += Math.min(dtMs, 100) * 0.001;
      let k = 0;
      while (stan.akum >= H && k < 2) {
        if (stan.krok >= stan.pelnyOd) { obraz.pelnyObraz(true); stan.pelnyOd = Infinity; }
        solver.krok(renderer);
        if (stan.pierwszy) { obraz.krokBezLimitu(renderer); stan.pierwszy = false; } else obraz.krok(renderer);
        stan.krok++;
        stan.akum -= H;
        k++;
      }
      if (k === 2) stan.wysokoKrokow2++;
      if (stan.akum >= H) { stan.przepadlo++; stan.akum = H * 0.999; }
      if (P) P.curLabel = 'fx:woksele-cele';
      ustawKamere();
      obraz.ustawRozmiar(renderer, Core3D.composerTarget.width, Core3D.composerTarget.height);
      obraz.rysujCele(renderer, kamLok, stan.akum);
      if (P) P.curLabel = lab0;
    },
  };
  Core3D.addFxStep(krokFx);
  await obWarm;
  await naCelu(obraz.rtGleb, obraz.sceneGleb, kamLok);
  await naCelu(obraz.rtSsao, obraz.kwadSsao, obraz.kwadSsao.camera);
  await naCelu(obraz.pyl.rt, obraz.pyl.scena, kamLok);
  await Core3D.warmup.now([mesh, meshGruz, kwadPyl], { name: 'woksele: bryły', layer: WARSTWA_FG });
  await Core3D.warmup.now([mesh], { name: 'woksele: cień', shadow: true });
  mesh.visible = true;
  meshGruz.visible = true;
  kwadPyl.visible = true;
  stan.gotowe = true;

  return {
    w,
    /** Sygnał z harnessu w chwili pierwszej serii strzałów: reset buforów (bez nowych pipeline'ów) i plan B1 od t = 0. */
    sekwencja() {
      zaladuj();
      solver.ustawPlan(g);
      stan.krok = 0;
      stan.akum = 0;
      stan.pierwszy = false;
      stan.plan = true;
      stan.pelnyOd = Number.isFinite(zdarzeniaOd) ? Math.max(0, Math.floor(zdarzeniaOd * 60) - 1) : 0;
      return true;
    },
    stan() {
      return { n: w.n, dx, krok: stan.krok, t: +(stan.krok * H).toFixed(2), plan: stan.plan, klatek: stan.klatek, klatekZ2Krokami: stan.wysokoKrokow2, przepadlo: stan.przepadlo, liczniki: { ...solver.liczniki }, lod: obraz.lod, cel: [obraz.rtGleb.width, obraz.rtGleb.height] };
    },
    obraz, solver,
  };
}
