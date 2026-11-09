// Skóra bazy w demie wiązanych wokseli (prośba użytkownika 2026-11-09: „nałóż na demo skórkę”). Wzór: wypalSkore w src/3d/woksele/wGrze.js.
// Stara bryła bazy z gry (PirateBase3D) rysuje się raz, z góry, rendererem dema do celów skóry obrazu (obraz.js, opcja skora): kolor HDR z głębią,
// drugi raz ze zgaszonym słońcem. Górne ściany wokseli przy powierzchni z wypieku biorą z niego barwę, wnętrza i przełomy zostają betonem.
// Słońce bryły to słońce dema (kierunek obraz.sun), więc światło z wypieku i oświetlenie ścian bez wypieku idą z tej samej strony.
// Baza bez bębna (B1R, bezBebna): ćwiartki bębna są w wypieku schowane, inaczej dysk pod bębnem nie dostałby skóry (wypiek widziałby koronę bębna).
// Bryła jest potrzebna tylko na czas wypieku: potem jej geometrie i materiały idą do zwolnienia.
import * as THREE from 'three/webgpu';
import { PirateBase3D } from '../../src/3d/portBuildings/pirateBase3D.js';
import { createPirateBaseLayout } from '../../src/3d/portBuildings/pirateBaseLayout.js';
import { portModuleFrame } from '../../src/3d/portBuildings/portModuleTraffic.js';

const WARSTWA_TLO = 1;
const WARSTWA_FG = 2;
const CWIARTKI_BEBNA = ['H-E', 'H-S', 'H-W', 'H-N'];
const ZAPAS = 500; // j. wokół węzłów: kolce i maszty starej bryły wystają poza siatkę węzłów (wGrze.js)

/** Prostokąt wypieku i zakres wysokości z węzłów sceny, jak w wGrze.js: kwadrat, żeby piksel był równy w obu osiach. */
export function ukladSkory(w) {
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
  const bok = Math.max(x1 - x0, y1 - y0) + 2 * ZAPAS;
  const cx = 0.5 * (x0 + x1), cy = 0.5 * (y0 + y1);
  const gora = z1 + 1500, zakres = gora - (z0 - 300);
  return { x0: cx - bok / 2, y0: cy - bok / 2, w: bok, h: bok, gora, zakres, srodek: [cx, cy], bok };
}

/**
 * Wypiek skóry do obraz.rtSkora i obraz.rtSkoraCien, potem obraz.ustawSkore. Kompilacja na celu przed rysunkiem (zasada 5): rysunek wypieku nie buduje pipeline'u w biegu.
 * Ramka bryły portModuleFrame(0, 0, −π/2): x układu bazy → X sceny, z układu → −Y, wysokość → Z, czyli układ węzłów (X = x bazy, Y = −z bazy).
 */
export async function wypalSkoreDema({ renderer, obraz, w, bezBebna = false }) {
  if (!obraz.rtSkora) throw new Error('wypiek skóry: obraz bez opcji skora');
  const u = ukladSkory(w);
  const base = new PirateBase3D({ layout: createPirateBaseLayout({ id: 'B1' }), frame: portModuleFrame(0, 0, -Math.PI / 2), name: 'Baza piratów (wypiek skóry dema)' });
  base.setLayers(WARSTWA_TLO, WARSTWA_FG);
  if (bezBebna) for (const id of CWIARTKI_BEBNA) base.hideChunk(id);
  base.update(0, { alarm: false, habitat: 1, disc: 1, fuel: 1, warehouse: 1, bays: 0 });
  const s = new THREE.Vector3().subVectors(obraz.sun.position, obraz.sun.target.position).normalize();
  base.setSun({ azimuth: Math.atan2(s.y, s.x), elevationDeg: (Math.asin(Math.max(-1, Math.min(1, s.z))) * 180) / Math.PI, visibility: 1 });
  const scena = new THREE.Scene();
  scena.add(base.root);
  base.root.updateMatrixWorld(true);
  // AGENT: compileAsync nie przelicza bryły widzenia tej kamery: siatki z cullingiem odpadłyby na starej, a ich pipeline powstałby w rysunku wypieku (reguła woksele-zawalen).
  base.root.traverse((o) => { o.frustumCulled = false; });
  const kam = new THREE.OrthographicCamera(-u.bok / 2, u.bok / 2, u.bok / 2, -u.bok / 2, 1, 1 + u.zakres);
  kam.matrixAutoUpdate = false;
  kam.matrixWorldAutoUpdate = false;
  kam.layers.disableAll();
  kam.layers.enable(WARSTWA_TLO);
  kam.layers.enable(WARSTWA_FG);
  // Oś patrzenia −z, góra obrazu +Y (v = 0 w górnym wierszu celu, pułapka 4): tak czyta obraz.js (1 − v).
  kam.matrixWorld.makeTranslation(u.srodek[0], u.srodek[1], u.gora + 1);
  kam.matrixWorldInverse.copy(kam.matrixWorld).invert();
  kam.updateProjectionMatrix();
  renderer.initRenderTarget?.(obraz.rtSkora);
  renderer.initRenderTarget?.(obraz.rtSkoraCien);
  const rt0 = renderer.getRenderTarget();
  for (const rt of [obraz.rtSkora, obraz.rtSkoraCien]) {
    renderer.setRenderTarget(rt);
    try { await renderer.compileAsync(scena, kam); } finally { renderer.setRenderTarget(rt0); }
  }
  const ac = renderer.autoClear, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  const uVis = base.uniforms?.uSunVisS;
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  try {
    renderer.setRenderTarget(obraz.rtSkora);
    renderer.render(scena, kam);
    // Drugi widok ze zgaszonym słońcem: lampy i okna świecą, reszta w świetle otoczenia (obraz.js miesza oba widocznością słońca; w demie 1).
    if (uVis) uVis.value = 0;
    renderer.setRenderTarget(obraz.rtSkoraCien);
    renderer.render(scena, kam);
  } finally {
    renderer.setRenderTarget(rt0);
    renderer.autoClear = ac;
    renderer.setClearColor(cc, ca);
  }
  obraz.ustawSkore(u);
  // Bryła tylko do wypieku. Cele skóry trzymają wynik; geometrie i materiały bryły nie są już potrzebne.
  scena.remove(base.root);
  const zwolnione = new Set();
  base.root.traverse((o) => {
    if (o.geometry && !zwolnione.has(o.geometry)) { zwolnione.add(o.geometry); o.geometry.dispose(); }
    const m = o.material;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!zwolnione.has(mm)) { zwolnione.add(mm); mm.dispose(); }
  });
  return u;
}
