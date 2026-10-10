// dema/planety-webgpu.js
//
// DEMO GENERATORA MAP PLANET (2026-10-09, prośba użytkownika: „dorób demo do generatora”). Generator: scripts/planety/
// (Python, offline), opis: docs/PLANETY-GENERATOR.md. Demo pokazuje WYPIECZONE mapy tak, jak widzi je gra, i obok
// jako płaskie warstwy:
//  • GLOB — kula z materiałami GRY (bez kopii shaderów): powierzchnia planet i chmury (planet3d.assets.tsl.js — dzień,
//    noc z miastami, woda / połysk, mapa normalnych, mgiełka, pas zachodu), wielka kopalnia ringu jako bryła (łata
//    earthPit3D.js na kuli z wycięciem, uPitMode 1 / 2), żywa atmosfera Jowisza i Saturna (gasGiantAtmosphere.js —
//    Saturn z sześciokątem i wirami polarnymi: saturnAtmosphere.js), pasy, wiry,
//    GRS), księżyce (moonSurface.tsl.js — PBR, mapa nocy zapalana zmrokiem); poświata limbu planet przy ringu =
//    dysk z modelu atmosfery gry zwrócony do kamery, planet tła i księżyców — powłoka jak w grze. Post jak w grze:
//    bloom gry (BloomGry, bloomConfig.js) → ACES gry → sRGB.
//  • MAPA — warstwy wypieku w układzie równoodległym (kolumna 0 = 180° W, wiersz 0 = biegun N): dzień, noc
//    (wzmocnienie — światła są ciemne), noc na dniu, woda / połysk, normalne (R = wschód, G = północ), chmury.
//  • NOWE / STARE — A/B z dawnymi mapami gry (jak `?planety=stare`: bez dziury, bez nocy Marsa / Merkurego / Wenus).
//  • Miejsca — skok kamery do miejsc z generatora (dziura na Saharze, Hellas, Caloris, Ishtar, GRS, stocznia na
//    Lunie, odkrywki Io, cięcia Europy…; współrzędne księżyców z `<ciało>-miejsca.json` podglądu ksiezyce.py).
// Własny WebGPURenderer (jak niebo-webgpu.js): demo nie potrzebuje passów Core3D, a materiały planet tła nie czytają
// maski słońca (uSunShadowRecv = 0 — maska zastępcza z sunShadowMask.js, pełne słońce).

import * as THREE from 'three/webgpu';
import { Fn, float, max, nodeObject, pass, pow, select, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { BloomGry } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import {
  createJupiterSurfaceMaterial, createSaturnSurfaceMaterial, createPlanetAtmosphereMaterial, createPlanetCloudMaterial, createPlanetSurfaceMaterial,
  createRingAtmosphereMaterial
} from '../src/3d/planet3d.assets.tsl.js';
import { createEarthPitMesh, earthPitUniforms } from '../src/3d/earthPit3D.js';
import { EARTH_PIT } from '../src/data/earthPit.js';
import { JUPITER_ATM_TUNE, JUPITER_VORTICES, JupiterAtmosphere } from '../src/3d/jupiterAtmosphere.js';
import { SATURN_ATM_TUNE, SaturnAtmosphere } from '../src/3d/saturnAtmosphere.js';
import { SATURN_ATMOSPHERE } from '../src/data/saturnAtmosphere.js';
import { createMoonSurfaceMaterial, setMoonSunDirection, setMoonSunLight } from '../src/3d/moonSurface.tsl.js';
import { MOON_MAPS, PLANET_MAPS } from '../src/3d/planetMaps.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { compileAsyncNaCelu } from '../src/3d/rozgrzewka.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEG = Math.PI / 180;
const errEl = $('err');
function showError(text) { errEl.style.display = 'block'; errEl.textContent += `${text}\n`; console.error(text); }
addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));
if (params.get('test') === '1') document.body.classList.add('test');

// ── Dane: ciała, dawne mapy, miejsca ─────────────────────────────────────────────
// Dawne mapy gry (A/B). Planety bez wpisu w dawnym PLANET_MAPS brały `<nazwa>_color.jpg` (planet3d.assets.js).
const OLD_PLANET_MAPS = Object.freeze({
  earth: { day: 'assets/planety/solar/earth/earth_color.jpg', night: 'assets/planety/images/earth_nightmap.jpg',
    spec: 'assets/planety/images/earth_specularmap.jpg', normal: 'assets/planety/solar/earth/earth_normal.jpg',
    clouds: 'assets/planety/solar/earth/earth_clouds.jpg' },
  mars: { day: 'assets/planety/solar/mars/mars_color.jpg' },
  mercury: { day: 'assets/planety/solar/mercury/mercury_color.jpg' },
  venus: { day: 'assets/planety/solar/venus/venus_color.jpg' },
  jupiter: { day: 'assets/planety/solar/jupiter/jupiter_color.jpg' },
  saturn: { day: 'assets/planety/solar/saturn/saturn_color.jpg' }
});
const OLD_MOON_MAPS = Object.freeze({
  moon: { day: 'assets/planety/images/moonmap.jpg', bump: 'assets/planety/images/moonbump.jpg', bumpScale: 0.07 },
  io: { day: 'assets/planety/images/jupiterIo.jpg' },
  europa: { day: 'assets/planety/images/jupiterEuropa.jpg' },
  ganymede: { day: 'assets/planety/images/jupiterGanymede.jpg' },
  callisto: { day: 'assets/planety/images/jupiterCallisto.jpg' }
});

// Miejsce: [szerokość, długość wschodnia, nazwa] (mapy: kolumna 0 = 180° W). Jowisz: długość z kolumny mapy
// (JUPITER_VORTICES.u — stopnie od lewej krawędzi tekstury) − 180.
const jupSite = (id, name) => {
  const v = JUPITER_VORTICES.find((x) => x.id === id);
  return [v.lat, v.u - 180, name];
};
const moonSites = (list, names) => list.map(([lon, lat, kind]) => [lat, lon, names[kind] || kind]);
const MOON_KINDS = { stocznia: 'stocznia', ladowisko: 'lądowisko', depot: 'depot', garnizon: 'garnizon', port: 'port',
  kopalnia: 'kopalnia', hub: 'hub pola cięć', baza: 'baza Unii Pasa' };

const BODIES = [
  { id: 'earth', name: 'Ziemia', kind: 'planet', ring: true, script: 'ziemia.py + dziura.py',
    src: 'NOAA ETOPO 2022 (60″), detal z dawnych map gry',
    info: 'Ziemia „zajechana”: oceany wypompowane na ring, szczątkowe morza w najgłębszych basenach (~19% powierzchni), ' +
      'odsłonięte dno — szelfy, skarpy stoków, grzbiety śródoceaniczne jako łańcuchy gór, osady (biały muł, czerwony ił), ' +
      'solniska. Ląd martwy, przemysł w miejscach dawnych metropolii, odkrywki, drogi; nocą huty i posterunki robotów. ' +
      'Atmosfera zapylona, burze piaskowe. Na Saharze WIELKA KOPALNIA RINGU: ~1 700 km, 13 tarasów, dno 38 km, ' +
      'żarzący się szyb, trzy tory wyrzutni masy — bryła 3D z przewyższeniem ×3.',
    sites: [[EARTH_PIT.lat, EARTH_PIT.lon, 'wielka kopalnia ringu'], [28, 84, 'Himalaje — odkrywki'],
      [48, 10, 'dawna Europa — przemysł'], [40, -95, 'dawne USA — przemysł'], [0, -28, 'grzbiet śródatlantycki'],
      [12, 145, 'Pacyfik — szczątkowe morze'], [-30, -160, 'Pacyfik płd. — dawne dno']] },
  { id: 'mars', name: 'Mars', kind: 'planet', ring: true, script: 'mars.py',
    src: 'NASA PDS MOLA MEGDR 32 px/°',
    info: 'Mars w trakcie terraformacji: młody ocean na północnych nizinach (~17%), morza Hellas i Argyre, jeziora ' +
      'w kraterach, zieleń od brzegów i równika w górę stoków (porosty → mech → trawa → las), rude wyżyny i Tharsis bez ' +
      'zmian, mniejsze czapy, miasta z polami, chmury i fale zawietrzne wulkanów. Gęstsze powietrze, błękitne zachody.',
    sites: [[18.65, -133.8, 'Olympus Mons'], [0, -112, 'Tharsis'], [-14, -59, 'Valles Marineris'],
      [-42.4, 70.5, 'morze Hellas'], [-49.7, -43.4, 'morze Argyre'], [60, 20, 'ocean północny'], [-87, 0, 'czapa płd.']] },
  { id: 'mercury', name: 'Merkury', kind: 'planet', ring: false, script: 'merkury.py + infrastruktura.py',
    src: 'NASA/USGS MESSENGER DEM 665 m',
    info: 'Planeta-kopalnia: 26 hut w rudnych prowincjach, ~690 odkrywek z ciemną aureolą wyrzutu, 8 wielkich odkrywek ' +
      'w dnach kraterów, pola odkrywkowe, lód w kraterach polarnych, farmy słoneczne (połysk), hałdy żużlu z żarem, ' +
      'wyrzutnie masy, kotwice wyciągów. Globalna sieć tras po terenie (Dijkstra z kosztem z nachylenia); nocą huty ' +
      'i przerywane łańcuchy świateł tras.',
    sites: [[30.5, -170.2, 'Caloris Planitia'], [0, 0, 'równik — kotwice wyciągów'], [86, 0, 'lód — kratery płn.'],
      [-15, 60, 'rudne prowincje'], [40, 100, 'równiny gładkie']] },
  { id: 'venus', name: 'Wenus', kind: 'planet', ring: false, script: 'wenus.py + infrastruktura.py',
    src: 'NASA/JPL/USGS Magellan 4641 m',
    info: 'Planeta fabryk: przemysł na wyżynach (chłodniej, „szron metaliczny” — kopalnie miedzi), fabryki elektroniki ' +
      'z miastami na płaskowyżach, huty, pola kryształu w tesserach, zakłady amunicyjne w wałach, osiedla przy drogach, ' +
      'sieć tras. Nocą zimna biel miast. Chmury z przerwami (nocą gasną). Mapa w układzie IAU (dawna była obrócona o 180°).',
    sites: [[70, 27.5, 'Ishtar Terra'], [65.2, 3.3, 'Maxwell Montes'], [-6, 105, 'Aphrodite Terra'],
      [25, -77, 'Beta Regio'], [-30, -150, 'niziny']] },
  { id: 'jupiter', name: 'Jowisz', kind: 'planet', ring: true, script: 'jowisz.py (+ jupiterAtmosphere.js w grze)',
    src: 'NASA/JPL/SSI Cassini PIA07782; wiatry Porco 2003 (BAA)',
    info: 'Mozaika Cassini wyostrzona i wyrównana do dawnej mapy, barwy dawnej mapy pasami szerokości. Atmosfera ŻYJE ' +
      'w shaderze gry: pasy-segmenty jadą sztywno wg profilu wiatru Cassini, GRS obraca się po elipsie, reszta płynie ' +
      'dwiema fazami (dżety, kołnierze wirów, turbulencja). Tempo — suwak „Tempo atmosfery”.',
    sites: [jupSite('GRS', 'Wielka Czerwona Plama'), jupSite('owal S-B', 'białe owale 37° S'),
      jupSite('owal N', 'owal 37° N'), jupSite('barka NEB-1', 'barka NEB'), [0, 0, 'strefa równikowa']] },
  { id: 'saturn', name: 'Saturn', kind: 'planet', ring: false, script: 'saturn.py (+ saturnAtmosphere.js w grze)',
    src: 'NASA/ESA Hubble OPAL 2019–2025 (barwy pasów); wiatry Cassini ISS (García-Melendo 2011)',
    info: 'Pasy z map Hubble’a (prawdziwy układ jasności), barwy z referencji Cassini: złoto-pomarańczowe pasy, kremowy ' +
      'równik, NIEBIESKI biegun płn. z SZEŚCIOKĄTEM (dżet ~75° N stoi w Systemie III — chmury płyną wzdłuż jego boków) ' +
      'i okiem wiru polarnego. Pas po wielkiej burzy 2010–2011 (głowa 32,6° N, włókna dookoła planety) z anticyklonem, ' +
      'fala wstęgowa 42° N, aleja burz 41° S z owalami, wir polarny płd. Animacja: dżet równikowy ~370 m/s (3× Jowisz), ' +
      'pasy sztywne + reszta fazami, wiry i jądra czap obracane sztywnie.',
    sites: [[SATURN_ATMOSPHERE.hexagon.latC, SATURN_ATMOSPHERE.hexagon.phaseU - 180, 'sześciokąt (wierzchołek)'],
      [89.2, 0, 'wir polarny płn.'], [SATURN_ATMOSPHERE.storm.headLat, SATURN_ATMOSPHERE.storm.headU - 180, 'głowa burzy 2010–2011'],
      ...SATURN_ATMOSPHERE.vortices.slice(0, 2).map((v) => [v.lat, v.u - 180, v.id]),
      [SATURN_ATMOSPHERE.ribbon.lat, 0, 'fala wstęgowa 42° N'], [0, 0, 'dżet równikowy'], [-89.2, 0, 'wir polarny płd.']] },
  { id: 'moon', name: 'Luna', kind: 'moon', script: 'ksiezyce.py --cialo luna', halo: 0x9ebbe0,
    src: 'NASA SVS CGI Moon Kit (LROC WAC, LOLA)',
    info: 'Terra Nova, węzeł bez wydobycia: aneks stoczni w Mare Imbrium (5 suchych doków z kadłubami), 3 depoty ' +
      'z farmami zbiorników, 4 garnizony, port na Sinus Medii, trakty. Nocą chłodna biel, ciepłe hale.',
    sites: moonSites([[-16.0, 29.0, 'stocznia'], [-9.0, 24.5, 'ladowisko'], [26.0, 7.0, 'depot'], [19.0, 21.5, 'depot'],
      [-14.0, -19.0, 'depot'], [-52.0, 8.0, 'garnizon'], [-38.0, -6.0, 'garnizon'], [1.5, 1.0, 'port']], MOON_KINDS) },
  { id: 'io', name: 'Io', kind: 'moon', script: 'ksiezyce.py --cialo io', halo: 0xffb16f,
    src: 'USGS Galileo SSI / Voyager 1 km',
    info: 'Kopalnia metalu Konsorcjum Zewnętrznego: 6 odkrywek (Fe / Ti / Cu) z dala od czynnych paterae, hałdy, huta, ' +
      '2 porty, wyrzutnia masy. Nocą sód łukami, żar huty, fiolet Konsorcjum; słaby żar lawy w gorących punktach.',
    sites: moonSites([[-37.88, 21.71, 'kopalnia'], [-135.62, -33.13, 'kopalnia'], [-63.9, 30.85, 'kopalnia'],
      [129.46, 40.69, 'kopalnia'], [-32.8, 19.82, 'port'], [-61.57, -25.18, 'port']], MOON_KINDS) },
  { id: 'europa', name: 'Europa', kind: 'moon', script: 'ksiezyce.py --cialo europa', halo: 0x9fc8ff,
    src: 'USGS Voyager / Galileo SSI 500 m',
    info: 'Kopalnia lodu Unii Pasa: 4 pola cięć PO PRAWDZIWYCH SPĘKANIACH (lineae wykryte w mozaice, poszerzone w rowy ' +
      'świeżego lodu), platformy przy przodkach, hub z lądowiskiem, w bazie kopuły. Nocą zieleń / cyjan Unii.',
    sites: moonSites([[21.99, -21.35, 'baza'], [18.86, 40.93, 'hub'], [-28.23, 25.97, 'hub'], [-51.95, -26.37, 'hub']], MOON_KINDS) },
  { id: 'ganymede', name: 'Ganimedes', kind: 'moon', script: 'ksiezyce.py --cialo ganimedes', halo: 0xb6c3d6,
    src: 'USGS Voyager / Galileo SSI 1 km',
    info: 'Węzeł Konsorcjum: depot na Uruk Sulcus (farma zbiorników, magazyny, lądowisko), 2 pola lądowisk, trakt. ' +
      'Nocą sód i fiolet znaków.',
    sites: moonSites([[-163.0, 2.0, 'depot'], [-131.0, 24.0, 'ladowisko'], [148.0, -12.0, 'ladowisko']], MOON_KINDS) },
  { id: 'callisto', name: 'Kallisto', kind: 'moon', script: 'ksiezyce.py --cialo kallisto', halo: 0x91a7c4,
    src: 'USGS Voyager / Galileo SSI 1 km',
    info: 'Węzeł Konsorcjum: depot w Valhalli, 2 pola lądowisk, trakt. Ciemna szarość, jasne kratery.',
    sites: moonSites([[-56.0, 15.0, 'depot'], [-140.0, 31.0, 'ladowisko'], [40.0, -18.0, 'ladowisko']], MOON_KINDS) }
];
const BODY = Object.fromEntries(BODIES.map((b) => [b.id, b]));

// Strojenie powierzchni jak DirectPlanet.init (planet3d.assets.js).
function planetSurfaceTune(id, maps) {
  const t = { bright: 1.0, spec: 0.0, sunInt: 1.1, bloom: 0.2, haze: 0, hazeColor: [0.55, 0.72, 1.0], hazeBeta: [0.05, 0.10, 0.22] };
  if (id === 'earth') Object.assign(t, { bright: 1.2, spec: 1.2, sunInt: 1.0, bloom: 0.78, haze: 1.0 });
  if (id === 'jupiter') Object.assign(t, { sunInt: 0.92, bright: 0.92, bloom: 0.05 });
  if (id === 'saturn') Object.assign(t, { sunInt: 0.95, bright: 0.94 });
  if (id === 'mars') Object.assign(t, { sunInt: 1.04, bright: 0.95, bloom: 0.4, haze: 0.32, hazeColor: [0.9, 0.62, 0.42], hazeBeta: [0.14, 0.10, 0.07] });
  if (id === 'mercury') Object.assign(t, { sunInt: 1.04, bright: 0.95 });
  if (id === 'venus') Object.assign(t, { sunInt: 0.98, bright: 0.93, haze: 0.85, hazeColor: [1.0, 0.82, 0.5], hazeBeta: [0.07, 0.11, 0.16] });
  if (maps?.specular !== undefined) t.spec = maps.specular;
  if (maps?.haze) Object.assign(t, { haze: maps.haze.strength, hazeColor: maps.haze.color, hazeBeta: maps.haze.beta });
  return t;
}
// Poświata limbu planet przy ringu (RING_ATMOSPHERE_TUNE) i powłoka planet tła (createAtmosphereMaterial + HALO_DEFAULTS).
const RING_ATM = {
  earth: { height: 1250, day: [0.26, 0.5, 1.0], sunset: [1.0, 0.38, 0.12], gain: 0.95 },
  mars: { height: 700, day: [0.85, 0.5, 0.3], sunset: [0.35, 0.55, 1.0], gain: 0.55 },
  jupiter: { height: 2400, day: [0.72, 0.64, 0.52], sunset: [1.0, 0.55, 0.25], gain: 0.75 }
};
const SHELL_ATM = {
  mercury: { color: [0.6, 0.6, 0.6], sunset: [0.8, 0.7, 0.6], power: 10.0 },
  venus: { color: [0.9, 0.7, 0.2], sunset: [1.2, 0.5, 0.1], power: 6.0 },
  saturn: { color: [0.8, 0.7, 0.5], sunset: [1.0, 0.5, 0.2], power: 5.0 }
};
const HALO_DEFAULTS = { sizeMul: 0.985, coefMul: 1.08, coefAdd: 0.12, powerMul: 1.0, powerAdd: 1.5 };
const MOON_HALO = { size: 1.075, coef: 0.52, power: 9.5, sunMul: 0.62 };

// ── Renderer i post jak w grze ───────────────────────────────────────────────────
const canvas = $('gpu');
const over = $('over');
const octx = over.getContext('2d');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
const DPR = Math.max(0.5, Math.min(2, Number(params.get('dpr')) || window.devicePixelRatio || 1));
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x000000, 1);
await renderer.init();
if (!renderer.backend?.isWebGPUBackend) showError('WebGPU niedostępne — demo wymaga przeglądarki z WebGPU.');
// Osłona jak Core3D._guardPendingPipelines: three r183 wkłada pipeline z compileAsync do cache, zanim GPU go odda —
// rysunek tego klucza wołałby setPipeline(undefined) (materiał three zmieniany w biegu, np. dawny księżyc); pomiń klatkę.
{
  const backend = renderer.backend;
  const draw = backend.draw;
  backend.draw = function drawWhenPipelineReady(renderObject, info) {
    const data = this.get(renderObject.pipeline);
    if (data.pipeline === undefined && data.error !== true) return undefined;
    return draw.call(this, renderObject, info);
  };
}
const maxAniso = Math.min(16, Number(renderer.backend?.capabilities?.getMaxAnisotropy?.()) || 16);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.002, 200);
// Słońce gry dla księżyców (moonSurface.tsl.js podmienia mu kierunek na uSunDir — tu ten sam).
const sunLight = new THREE.DirectionalLight(0xffeedd, 1.45);
scene.add(sunLight, sunLight.target);
setMoonSunLight(sunLight);

// Gwiazdy tła: punkty 1 px (WebGPU), nieruchome.
{
  const n = 5000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 150, z * 150, r * Math.sin(a) * 150], i * 3);
    const b = Math.pow(rnd(), 4) * 0.9 + 0.04;
    const warm = rnd();
    col.set([b * (0.85 + warm * 0.25), b * 0.95, b * (1.1 - warm * 0.3)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsNodeMaterial({ vertexColors: true, sizeAttenuation: false, size: 1, depthWrite: false });
  scene.add(new THREE.Points(g, m));
}

const uBloomOn = uniform(1);
const globePipe = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera, { samples: 4 });
{
  const col = scenePass.getTextureNode('output');
  const bloom = nodeObject(new BloomGry(col, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
  const lin = col.rgb.add(bloom.rgb.mul(uBloomOn));
  globePipe.outputNode = vec4(linearDoSrgb(acesGry(max(lin, vec3(0.0)))), 1.0);
  globePipe.outputColorTransform = false;
}

// Widok MAPA: płaszczyzna 2 × 1 (trzy kopie — zawinięcie w długości), kamera ortho; warstwa = tekstura wybrana
// z trzech węzłów (barwa sRGB / dane liniowe / noc na dniu — TSL wybiera konwersję z przestrzeni barw tekstury
// obecnej przy budowie, więc tekstury podmienia się tylko w węźle o tej samej przestrzeni).
const mapScene = new THREE.Scene();
const mapCam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, -10, 10);
const PH_SRGB = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
PH_SRGB.colorSpace = THREE.SRGBColorSpace; PH_SRGB.needsUpdate = true;
const PH_RAW = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
PH_RAW.needsUpdate = true;
// Węzły z własnym uv (bez .sample — klon nie widziałby podmiany .value).
const mapColorTex = texture(PH_SRGB, uv());
const mapRawTex = texture(PH_RAW, uv());
const mapDayTex = texture(PH_SRGB, uv());
const uMapMode = uniform(0);   // 0 — barwa, 1 — dane (wartości jak w pliku), 2 — noc na dniu
const uMapGain = uniform(1);
{
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const c = mapColorTex.rgb;
    const raw = pow(mapRawTex.rgb, vec3(2.2));   // post koduje sRGB — dane mają wyjść jak w pliku
    const day = mapDayTex.rgb;
    const comp = day.mul(0.22).add(c.mul(uMapGain));
    return select(uMapMode.lessThan(0.5), c.mul(uMapGain), select(uMapMode.lessThan(1.5), raw, comp));
  })();
  const geo = new THREE.PlaneGeometry(2, 1);
  for (const dx of [-2, 0, 2]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.x = dx;
    mapScene.add(m);
  }
}
const mapPipe = new THREE.RenderPipeline(renderer);
{
  const p = pass(mapScene, mapCam);
  mapPipe.outputNode = vec4(linearDoSrgb(p.getTextureNode('output').rgb), 1.0);
  mapPipe.outputColorTransform = false;
}

// ── Tekstury (pamięć podręczna po ścieżce) ───────────────────────────────────────
const loader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(path, srgb) {
  const key = `${path}|${srgb ? 's' : 'l'}`;
  if (!texCache.has(key)) {
    texCache.set(key, loader.loadAsync(`/${path}`).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      return t;
    }));
  }
  return texCache.get(key);
}

// ── Budowa ciała (jak DirectPlanet / DirectMoon, bez położenia w świecie gry) ────
// Kula o promieniu 1, biegun N = +Y; doba = obrót siatki wokół Y. Słońce: kierunek świata `sunDir`.
async function buildBody(id, old) {
  const b = BODY[id];
  const group = new THREE.Group();
  const layers = {};   // warstwy dla widoku MAPA: { day, night, spec, normal, clouds } → tekstura
  const body = { id, old, group, layers, mesh: null, clouds: null, atm: null, atmKind: null, jup: null, pit: null, uniforms: null, cloudUniforms: null };
  if (b.kind === 'planet') {
    const maps = old ? OLD_PLANET_MAPS[id] : PLANET_MAPS[id];
    const tune = planetSurfaceTune(id, old ? null : maps);
    const [day, night, spec, normal, clouds] = await Promise.all([
      loadTex(maps.day, true), maps.night ? loadTex(maps.night, true) : null, maps.spec ? loadTex(maps.spec, false) : null,
      maps.normal ? loadTex(maps.normal, false) : null, maps.clouds ? loadTex(maps.clouds, true) : null]);
    Object.assign(layers, { day, night, spec, normal, clouds });
    const U = body.uniforms = {
      uPlanetBloom: { value: tune.bloom }, dayTexture: { value: day }, nightTexture: { value: night },
      specularTexture: { value: spec || new THREE.Texture() }, normalTexture: { value: normal || new THREE.Texture() },
      sunPosition: { value: new THREE.Vector3(1e4, 0, 0) }, hasNightTexture: { value: night ? 1.0 : 0.0 },
      uBrightness: { value: tune.bright }, uSpecular: { value: tune.spec }, uSunIntensity: { value: tune.sunInt },
      uHazeStrength: { value: tune.haze }, uHazeColor: { value: new THREE.Vector3(...tune.hazeColor) },
      uHazeBeta: { value: new THREE.Vector3(...tune.hazeBeta) },
      uRingShadowStrength: { value: 0 }, uRingShadowRadius: { value: 0 }, uRingShadowReach: { value: 1 },
      uRingShadowCenter: { value: new THREE.Vector2() }, uSunShadowRecv: { value: 0 }, uPitMode: { value: 0 }
    };
    if (id === 'jupiter') {
      // JupiterAtmosphere czyta planet.uniforms i promień grupy (tempo przy zbliżeniu — tu bez kamery gry: 1).
      body.jup = new JupiterAtmosphere({ uniforms: U, group: { scale: { x: RING_PLANET_WORLD_RADII.jupiter } } }, day);
    } else if (id === 'saturn' && maps.atmosphere) {
      body.jup = new SaturnAtmosphere({ uniforms: U, isRingAnchored: false }, day);
    }
    const geo = new THREE.SphereGeometry(1, 256, 128);
    const surf = body.jup ? (id === 'saturn' ? createSaturnSurfaceMaterial : createJupiterSurfaceMaterial) : createPlanetSurfaceMaterial;
    body.mesh = new THREE.Mesh(geo, surf(U));
    group.add(body.mesh);
    if (!old && maps.pit) {
      U.uPitMode.value = 1;
      body.pitUniforms = earthPitUniforms(U);
      body.pit = createEarthPitMesh(createPlanetSurfaceMaterial(body.pitUniforms));
      body.mesh.add(body.pit);
    }
    if (clouds) {
      body.cloudUniforms = { cloudTexture: { value: clouds }, sunPosition: U.sunPosition, uOpacity: { value: maps.cloudOpacity ?? 0.62 },
        uHazeStrength: U.uHazeStrength, uHazeColor: U.uHazeColor, uHazeBeta: U.uHazeBeta,
        uRingShadowStrength: U.uRingShadowStrength, uRingShadowRadius: U.uRingShadowRadius, uRingShadowReach: U.uRingShadowReach,
        uRingShadowCenter: U.uRingShadowCenter, uSunShadowRecv: U.uSunShadowRecv };
      body.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.005, 256, 128), createPlanetCloudMaterial(body.cloudUniforms));
      group.add(body.clouds);
    }
    if (b.ring) {
      // Dysk poświaty limbu (gra: pass ortho, dysk w płaszczyźnie ekranu) — tu zwrócony do kamery, skala tak,
      // żeby ρ = 1 wypadało na sylwetce kuli widzianej z bliska (d / √(d² − 1)).
      const t = RING_ATM[id];
      const R = RING_PLANET_WORLD_RADII[id];
      const ra = 1 + t.height / R;
      const mat = createRingAtmosphereMaterial({
        uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uRa: { value: ra }, uHs: { value: t.height * 0.22 / R },
        uDayColor: { value: new THREE.Vector3(...t.day) }, uSunsetColor: { value: new THREE.Vector3(...t.sunset) },
        uGain: { value: new THREE.Vector3(1.02, 0.985, 0.933).multiplyScalar(t.gain) }, uSunShadowRecv: { value: 0 }
      });
      body.atm = new THREE.Mesh(new THREE.CircleGeometry(ra, 256), mat);
      body.atmKind = 'disc';
    } else {
      const s = SHELL_ATM[id];
      body.atm = new THREE.Mesh(new THREE.SphereGeometry(1.10 * HALO_DEFAULTS.sizeMul, 96, 96), createPlanetAtmosphereMaterial({
        coef: { value: 0.47 * HALO_DEFAULTS.coefMul + HALO_DEFAULTS.coefAdd }, power: { value: s.power * HALO_DEFAULTS.powerMul + HALO_DEFAULTS.powerAdd },
        glowColor: { value: new THREE.Vector3(...s.color) }, sunsetTint: { value: new THREE.Vector3(...s.sunset) },
        uSunIntensity: { value: 1.1 }, sunPosition: U.sunPosition, uSunShadowRecv: { value: 0 } }));
      body.atmKind = 'shell';
    }
    group.add(body.atm);
  } else {
    const maps = old ? OLD_MOON_MAPS[id] : MOON_MAPS[id];
    const [day, night, normal, bump] = await Promise.all([
      loadTex(maps.day, true), maps.night ? loadTex(maps.night, true) : null,
      maps.normal ? loadTex(maps.normal, false) : null, maps.bump ? loadTex(maps.bump, false) : null]);
    Object.assign(layers, { day, night, normal, spec: bump });
    let material;
    if (night) {
      material = createMoonSurfaceMaterial({ map: day, nightMap: night, normalMap: normal, normalScale: Number(maps.normalScale) || 1, sunMask: false });
    } else {
      material = new THREE.MeshStandardMaterial({ map: day, bumpMap: bump, bumpScale: Number(maps.bumpScale) || 0.07, roughness: 0.98, metalness: 0 });
    }
    body.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), material);
    group.add(body.mesh);
    const hc = new THREE.Color(b.halo);
    const glow = new THREE.Vector3(hc.r, hc.g, hc.b);
    body.atmUniforms = { coef: { value: MOON_HALO.coef }, power: { value: MOON_HALO.power }, glowColor: { value: glow },
      sunsetTint: { value: glow.clone().multiplyScalar(0.72) }, uSunIntensity: { value: 1.1 * MOON_HALO.sunMul },
      sunPosition: { value: new THREE.Vector3(1e4, 0, 0) }, uSunShadowRecv: { value: 0 } };
    body.atm = new THREE.Mesh(new THREE.SphereGeometry(MOON_HALO.size, 96, 96), createPlanetAtmosphereMaterial(body.atmUniforms));
    body.atmKind = 'shell';
    group.add(body.atm);
  }
  // Pipeline'y w tle przed pokazaniem, na celu passu sceny (pułapka 30: głębia i format celu w kluczu).
  scene.add(group);
  const prevTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(scenePass.renderTarget);
    const p = compileAsyncNaCelu(renderer, group, camera, scene);
    renderer.setRenderTarget(prevTarget);
    await p;
  } catch (e) { renderer.setRenderTarget(prevTarget); console.warn('compileAsync', e); }
  scene.remove(group);
  return body;
}

// ── Stan ─────────────────────────────────────────────────────────────────────────
const S = {
  bodyId: BODY[params.get('cialo')] ? params.get('cialo') : 'earth',
  view: params.get('widok') === 'mapa' ? 'mapa' : 'glob',
  old: params.get('mapy') === 'stare',
  layer: params.get('warstwa') || 'day',
  az: 0.4, el: 0.25, dist: Number(params.get('odl')) || 3.2,
  target: null,           // { az, el } — przelot kamery do miejsca
  pora: Number(params.get('pora') ?? 35),   // słońce względem kamery [°]: 0 — pełnia, ±90 — terminator, 180 — noc
  sunEl: 8,
  spin: 0, doba: false, cloudsOn: true, atmOn: true, pitOn: true, labels: true, bloom: true,
  jupSpeed: 1,
  map: { cx: 0, cy: 0, scale: 1 },  // środek (j. płaszczyzny: szer. 2) i powiększenie (1 — cała mapa w oknie)
  mapGain: { night: 3, comp: 2.5 },
  current: null, loading: 0
};
const built = new Map();
const bodyKey = (id, old) => `${id}|${old ? 'stare' : 'nowe'}`;

async function selectBody(id, old = S.old) {
  S.bodyId = id; S.old = old;
  const key = bodyKey(id, old);
  if (!built.has(key)) built.set(key, buildBody(id, old));
  S.loading++;
  showLoad(`wczytywanie: ${BODY[id].name} (${old ? 'stare' : 'nowe'} mapy)…`);
  let body;
  try { body = await built.get(key); } finally { S.loading--; }
  if (S.bodyId !== id || S.old !== old) return;   // w międzyczasie wybrano inne
  if (S.current) scene.remove(S.current.group);
  S.current = body;
  scene.add(body.group);
  if (!body.layers[S.layer]) S.layer = 'day';
  showLoad(null);
  syncUi();
}

function showLoad(text) { const el = $('load'); el.style.display = text ? 'block' : 'none'; if (text) el.textContent = text; }

// ── Geometria miejsc ─────────────────────────────────────────────────────────────
// SphereGeometry: u = φ / 2π (kolumna 0 = 180° W), x = −cos φ · cos lat, y = sin lat, z = sin φ · cos lat.
function siteDir(lat, lon, out) {
  const phi = (lon + 180) * DEG;
  const c = Math.cos(lat * DEG);
  return out.set(-Math.cos(phi) * c, Math.sin(lat * DEG), Math.sin(phi) * c);
}
// Doba = obrót siatki o S.spin wokół Y: kierunek świata = kierunek lokalny obrócony o ten kąt.
const _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
function siteWorld(lat, lon, out) {
  siteDir(lat, lon, out);
  return out.applyQuaternion(_q.setFromAxisAngle(_yAxis, S.spin));
}
function goToSite(i) {
  const site = BODY[S.bodyId].sites[i];
  if (!site) return;
  const [lat, lon] = site;
  if (S.view === 'mapa') {
    S.map.cx = lon / 180;
    S.map.cy = lat / 180;
    S.map.scale = Math.max(S.map.scale, 4);
    return;
  }
  S.doba = false;
  const d = siteWorld(lat, lon, new THREE.Vector3());
  S.target = { az: Math.atan2(d.x, d.z), el: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
  S.dist = Math.min(S.dist, BODY[S.bodyId].id === 'earth' && i === 0 ? 1.45 : 1.9);
  syncUi();
}

// ── Klatka ───────────────────────────────────────────────────────────────────────
const _sun = new THREE.Vector3();
const _v = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
let last = performance.now();
let fpsAvg = 60;

function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

function frame(now) {
  // Okno o rozmiarze 0 (schowana karta / panel): cele 0 × 0 to błąd walidacji WebGPU — klatka pominięta.
  if (!(innerWidth > 0 && innerHeight > 0)) { last = now; return; }
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAvg += ((dt > 0 ? 1 / dt : 60) - fpsAvg) * 0.05;
  const body = S.current;
  if (S.target) {
    const k = 1 - Math.exp(-dt * 4);
    S.az += wrapAngle(S.target.az - S.az) * k;
    S.el += (S.target.el - S.el) * k;
    if (Math.abs(wrapAngle(S.target.az - S.az)) < 1e-3 && Math.abs(S.target.el - S.el) < 1e-3) S.target = null;
  }
  if (S.doba) S.spin = (S.spin + dt * 0.12) % (Math.PI * 2);

  // Kamera po orbicie, słońce względem kamery (pora dnia).
  const ce = Math.cos(S.el);
  camera.position.set(ce * Math.sin(S.az), Math.sin(S.el), ce * Math.cos(S.az)).multiplyScalar(S.dist);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.0005, (S.dist - 1.1) * 0.5);
  camera.updateProjectionMatrix();
  const sAz = S.az + S.pora * DEG;
  const se = Math.cos(S.sunEl * DEG);
  _sun.set(se * Math.sin(sAz), Math.sin(S.sunEl * DEG), se * Math.cos(sAz)).normalize();
  sunLight.position.copy(_sun).multiplyScalar(10);
  uBloomOn.value = S.bloom ? 1 : 0;

  if (body) {
    body.mesh.rotation.y = S.spin;
    if (body.uniforms) body.uniforms.sunPosition.value.copy(_sun).multiplyScalar(1e4);
    if (body.atmUniforms) body.atmUniforms.sunPosition.value.copy(_sun).multiplyScalar(1e4);
    if (body.mesh.material.uniforms?.uSunDir) setMoonSunDirection(body.mesh.material, _sun.x, _sun.y, _sun.z);
    if (body.clouds) {
      body.clouds.visible = S.cloudsOn;
      body.clouds.rotation.y = S.spin * 1.04;
    }
    if (body.pit) {
      body.pit.visible = S.pitOn;
      body.uniforms.uPitMode.value = S.pitOn ? 1 : 0;
    }
    if (body.atm) {
      body.atm.visible = S.atmOn;
      if (body.atmKind === 'disc') {
        body.atm.quaternion.copy(camera.quaternion);
        const d = Math.max(1.0005, S.dist);
        body.atm.scale.setScalar(d / Math.sqrt(d * d - 1));
        body.atm.material.uniforms.uSunDir.value.copy(_sun).applyQuaternion(_invQ.copy(camera.quaternion).invert());
      }
    }
    if (body.jup) body.jup.sync(dt * S.jupSpeed, dt);
  }

  if (S.view === 'glob') {
    globePipe.render();
  } else {
    if (body) applyMapLayer(body);
    const aspect = innerWidth / innerHeight;
    const halfH = 0.5 / S.map.scale * Math.max(1, 2 / aspect / 1);   // cała mapa (2 × 1) mieści się w oknie przy scale 1
    const halfW = halfH * aspect;
    S.map.cy = THREE.MathUtils.clamp(S.map.cy, -0.5 + Math.min(0.5, halfH), 0.5 - Math.min(0.5, halfH));
    S.map.cx = wrapX(S.map.cx);
    mapCam.left = S.map.cx - halfW; mapCam.right = S.map.cx + halfW;
    mapCam.top = S.map.cy + halfH; mapCam.bottom = S.map.cy - halfH;
    mapCam.updateProjectionMatrix();
    mapPipe.render();
  }
  drawOverlay();
  drawHud();
}
const wrapX = (x) => x - 2 * Math.floor((x + 1) / 2);

function applyMapLayer(body) {
  const L = body.layers;
  const t = L[S.layer] || L.day;
  if (S.layer === 'night') {
    mapColorTex.value = t; uMapMode.value = 0; uMapGain.value = S.mapGain.night;
  } else if (S.layer === 'comp') {
    mapColorTex.value = L.night || PH_SRGB; mapDayTex.value = L.day; uMapMode.value = 2; uMapGain.value = S.mapGain.comp;
  } else if (t.colorSpace === THREE.SRGBColorSpace) {
    mapColorTex.value = t; uMapMode.value = 0; uMapGain.value = 1;
  } else {
    mapRawTex.value = t; uMapMode.value = 1; uMapGain.value = 1;
  }
}

// Nakładka: podpisy miejsc (glob — strona widoczna, mapa — wszystkie) i kursor (mapa: szerokość / długość).
const mouse = { x: -1, y: -1, inside: false };
function drawOverlay() {
  const w = Math.round(innerWidth * DPR);
  const h = Math.round(innerHeight * DPR);
  if (over.width !== w || over.height !== h) { over.width = w; over.height = h; }
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.clearRect(0, 0, w, h);
  if (!S.labels || !S.current || document.body.classList.contains('test')) return;
  const sites = BODY[S.bodyId].sites;
  octx.font = '11px ui-monospace, Consolas, monospace';
  octx.textBaseline = 'middle';
  for (let i = 0; i < sites.length; i++) {
    const [lat, lon, name] = sites[i];
    let x, y;
    if (S.view === 'glob') {
      siteWorld(lat, lon, _v);
      if (_v.dot(camera.position) - 1 < 0.02) continue;          // za horyzontem (|p| = 1: widać, gdy p · kamera > 1)
      _v.project(camera);
      x = (_v.x * 0.5 + 0.5) * innerWidth; y = (-_v.y * 0.5 + 0.5) * innerHeight;
    } else {
      const p = mapToScreen(lon / 180, lat / 180);
      x = p.x; y = p.y;
    }
    if (x < -50 || y < -20 || x > innerWidth + 50 || y > innerHeight + 20) continue;
    octx.fillStyle = 'rgba(255,194,58,.95)';
    octx.beginPath(); octx.arc(x, y, 3, 0, Math.PI * 2); octx.fill();
    octx.strokeStyle = 'rgba(0,0,0,.8)'; octx.lineWidth = 3;
    octx.strokeText(`${i + 1} ${name}`, x + 7, y);
    octx.fillStyle = '#ffe6a8';
    octx.fillText(`${i + 1} ${name}`, x + 7, y);
  }
}
function mapToScreen(mx, my) {
  let x = mx;
  // najbliższa kopia w zawinięciu
  x += 2 * Math.round((S.map.cx - x) / 2);
  const sx = (x - mapCam.left) / (mapCam.right - mapCam.left) * innerWidth;
  const sy = (mapCam.top - my) / (mapCam.top - mapCam.bottom) * innerHeight;
  return { x: sx, y: sy };
}
function screenToMap(sx, sy) {
  const mx = mapCam.left + sx / innerWidth * (mapCam.right - mapCam.left);
  const my = mapCam.top - sy / innerHeight * (mapCam.top - mapCam.bottom);
  return { x: mx, y: my };
}

function drawHud() {
  const b = BODY[S.bodyId];
  const body = S.current;
  const L = body?.layers || {};
  const sz = (t) => (t?.image ? `${t.image.width}×${t.image.height}` : '—');
  const lines = [];
  lines.push(`<b>${b.name}</b> · mapy ${S.old ? 'STARE' : 'NOWE (generator)'} · ${S.view === 'glob' ? 'GLOB' : `MAPA: ${LAYER_NAMES[S.layer]}`} · ${fpsAvg.toFixed(0)} kl/s`);
  lines.push(`dzień ${sz(L.day)} · noc ${sz(L.night)} · ${b.kind === 'moon' && S.old ? 'wypukłości' : 'woda/połysk'} ${sz(L.spec)} · normalne ${sz(L.normal)} · chmury ${sz(L.clouds)}`);
  if (S.view === 'glob') {
    lines.push(`odległość ${S.dist.toFixed(2)} R · pora ${S.pora}° · słońce ${S.sunEl}° nad równikiem${S.doba ? ' · DOBA' : ''}`);
  } else if (mouse.inside) {
    const p = screenToMap(mouse.x, mouse.y);
    const lon = wrapX(p.x) * 180;
    const lat = p.y * 180;
    if (Math.abs(lat) <= 90) lines.push(`kursor: ${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'} · powiększenie ×${S.map.scale.toFixed(1)}`);
  }
  $('hud').innerHTML = lines.join('\n');
}

// ── Sterowanie ───────────────────────────────────────────────────────────────────
const DIST_MIN = 1.03, DIST_MAX = 8;
const drag = { on: false, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
  canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag');
});
canvas.addEventListener('pointerup', (e) => { drag.on = false; canvas.releasePointerCapture(e.pointerId); canvas.classList.remove('drag'); });
canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
  if (!drag.on) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (S.view === 'glob') {
    // obrót proporcjonalny do odległości od powierzchni (z bliska wolniej)
    const k = 2.2 * (S.dist - 1) / Math.max(1, S.dist) / innerHeight * 1.6;
    S.az -= dx * k; S.el = THREE.MathUtils.clamp(S.el + dy * k, -1.45, 1.45);
    S.target = null;
  } else {
    const wpp = (mapCam.right - mapCam.left) / innerWidth;
    S.map.cx -= dx * wpp; S.map.cy += dy * wpp;
  }
});
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * 0.0012);
  if (S.view === 'glob') {
    S.dist = THREE.MathUtils.clamp(1 + (S.dist - 1) * f, DIST_MIN, DIST_MAX);
  } else {
    const before = screenToMap(e.clientX, e.clientY);
    S.map.scale = THREE.MathUtils.clamp(S.map.scale / f, 1, 64);
    // kotwica pod kursorem
    const aspect = innerWidth / innerHeight;
    const halfH = 0.5 / S.map.scale * Math.max(1, 2 / aspect);
    const halfW = halfH * aspect;
    S.map.cx = before.x - (e.clientX / innerWidth - 0.5) * 2 * halfW;
    S.map.cy = before.y + (e.clientY / innerHeight - 0.5) * 2 * halfH;
  }
  syncUi();
}, { passive: false });
canvas.addEventListener('dblclick', (e) => {
  if (S.view !== 'mapa') return;
  const p = screenToMap(e.clientX, e.clientY);
  S.map.cx = p.x; S.map.cy = p.y; S.map.scale = Math.min(64, S.map.scale * 2);
});

addEventListener('resize', () => {
  if (!(innerWidth > 0 && innerHeight > 0)) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'm') setView(S.view === 'glob' ? 'mapa' : 'glob');
  else if (k === 'b') selectBody(S.bodyId, !S.old);
  else if (k === 'd') { S.doba = !S.doba; S.target = null; }
  else if (k === 'c') S.cloudsOn = !S.cloudsOn;
  else if (k === 'n') S.pora = Math.abs(S.pora) > 90 ? 35 : 180;
  else if (k === 'h') document.body.classList.toggle('test');
  else if (/^[0-9]$/.test(k)) { const i = (Number(k) + 9) % 10; if (BODIES[i]) selectBody(BODIES[i].id); }
  else return;
  syncUi();
});

// ── Panel ────────────────────────────────────────────────────────────────────────
const SLIDERS = [];
const LAYER_NAMES = { day: 'dzień', night: 'noc', comp: 'noc na dniu', spec: 'woda / połysk', normal: 'normalne', clouds: 'chmury' };
function setView(v) { S.view = v; syncUi(); }

{
  const host = $('bodies');
  BODIES.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.textContent = b.name;
    btn.title = `klawisz ${(i + 1) % 10}`;
    btn.dataset.id = b.id;
    btn.onclick = () => selectBody(b.id);
    host.appendChild(btn);
  });
  $('v-glob').onclick = () => setView('glob');
  $('v-mapa').onclick = () => setView('mapa');
  $('m-nowe').onclick = () => selectBody(S.bodyId, false);
  $('m-stare').onclick = () => selectBody(S.bodyId, true);
  const TOGGLES = [
    ['doba', 'doba', () => { S.target = null; }], ['cloudsOn', 'chmury'], ['atmOn', 'poświata'], ['pitOn', 'dziura 3D'],
    ['labels', 'podpisy'], ['bloom', 'bloom']
  ];
  for (const [key, label, after] of TOGGLES) {
    const btn = document.createElement('button');
    btn.textContent = label; btn.dataset.key = key;
    btn.onclick = () => { S[key] = !S[key]; after?.(); syncUi(); };
    $('toggles').appendChild(btn);
  }
  for (const id of Object.keys(LAYER_NAMES)) {
    const btn = document.createElement('button');
    btn.textContent = LAYER_NAMES[id]; btn.dataset.layer = id;
    btn.onclick = () => { S.layer = id; syncUi(); };
    $('layers').appendChild(btn);
  }
  const slider = (id, get, set, fmt) => {
    const el = $(`s-${id}`);
    el.oninput = () => { set(Number(el.value)); syncUi(); };
    return () => { el.value = get(); $(`o-${id}`).textContent = fmt(get()); };
  };
  // odległość: suwak logarytmiczny po wysokości nad powierzchnią
  const hMin = Math.log(DIST_MIN - 1), hMax = Math.log(DIST_MAX - 1);
  SLIDERS.push(
    slider('pora', () => S.pora, (v) => { S.pora = v; }, (v) => `${v}°`),
    slider('wys', () => S.sunEl, (v) => { S.sunEl = v; }, (v) => `${v}°`),
    slider('odl', () => (Math.log(S.dist - 1) - hMin) / (hMax - hMin), (v) => { S.dist = 1 + Math.exp(hMin + v * (hMax - hMin)); },
      () => `${S.dist.toFixed(2)}R`),
    slider('atm', () => S.jupSpeed, (v) => { S.jupSpeed = v; }, (v) => `×${v.toFixed(1)}`),
    slider('gain', () => {
      const g = S.layer === 'comp' ? S.mapGain.comp : S.mapGain.night;
      return Math.log(g) / Math.log(20);
    }, (v) => {
      const g = Math.pow(20, v);
      if (S.layer === 'comp') S.mapGain.comp = g; else S.mapGain.night = g;
    }, () => `×${(S.layer === 'comp' ? S.mapGain.comp : S.mapGain.night).toFixed(1)}`)
  );
  $('b-dzien').onclick = () => { S.pora = 35; syncUi(); };
  $('b-term').onclick = () => { S.pora = 88; syncUi(); };
  $('b-noc').onclick = () => { S.pora = 180; syncUi(); };
}

let sitesFor = null;
function syncUi() {
  const b = BODY[S.bodyId];
  const body = S.current;
  for (const btn of $('bodies').children) btn.classList.toggle('on', btn.dataset.id === S.bodyId);
  $('v-glob').classList.toggle('on', S.view === 'glob');
  $('v-mapa').classList.toggle('on', S.view === 'mapa');
  $('m-nowe').classList.toggle('on', !S.old);
  $('m-stare').classList.toggle('on', S.old);
  $('globe-opts').style.display = S.view === 'glob' ? '' : 'none';
  $('map-opts').style.display = S.view === 'mapa' ? '' : 'none';
  for (const btn of $('toggles').children) {
    const key = btn.dataset.key;
    btn.classList.toggle('on', !!S[key]);
    btn.disabled = (key === 'pitOn' && !body?.pit) || (key === 'cloudsOn' && !body?.clouds);
  }
  $('r-atm').style.display = S.current?.jup ? '' : 'none';
  for (const btn of $('layers').children) {
    const id = btn.dataset.layer;
    btn.classList.toggle('on', id === S.layer);
    btn.disabled = !body || (id === 'comp' ? !(body.layers.night && body.layers.day) : !body.layers[id]);
  }
  $('s-gain').parentElement.style.display = (S.layer === 'night' || S.layer === 'comp') ? '' : 'none';
  for (const f of SLIDERS) f();
  if (sitesFor !== S.bodyId) {
    sitesFor = S.bodyId;
    const host = $('sites');
    host.textContent = '';
    b.sites.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.textContent = `${i + 1}. ${s[2]}`;
      btn.title = `${Math.abs(s[0]).toFixed(1)}° ${s[0] >= 0 ? 'N' : 'S'}, ${Math.abs(s[1]).toFixed(1)}° ${s[1] >= 0 ? 'E' : 'W'}`;
      btn.onclick = () => goToSite(i);
      host.appendChild(btn);
    });
  }
  $('info').innerHTML = `${b.info}<div class="src">generator: <code>scripts/planety/${b.script}</code><br>dane: ${b.src}` +
    `${S.old ? '<br><b>STARE</b> — dawne mapy gry (jak <code>?planety=stare</code>).' : ''}</div>`;
}

// Harness / konsola.
window.__planety = {
  S, BODIES, renderer,
  select: (id, old) => selectBody(id, old),
  view: setView,
  site: goToSite,
  ready: () => !!S.current && S.loading === 0,
  tune: { jupiter: JUPITER_ATM_TUNE, saturn: SATURN_ATM_TUNE }
};

if (MOON_MAPS.moon && !MOON_MAPS.moon.night) showError('planetMaps.js wczytało STARE mapy (localStorage sc_planet_maps = "stare") — przycisk NOWE pokaże też dawne mapy.');
syncUi();
await selectBody(S.bodyId, S.old);
const startSite = params.get('miejsce');
if (startSite !== null) {
  goToSite(Number(startSite));
  if (S.target) { S.az = S.target.az; S.el = S.target.el; S.target = null; }
}
renderer.setAnimationLoop(frame);
