// Narzędzia niszczenia w demie wiązanych wokseli (?kawalki=1): klik myszą bez przeciągania używa wybranego narzędzia. Do oceny obrazu kawałków na bazie piratów z misji 1.
//  • Krater: promień z kamery, krater w pierwszym węźle na jego drodze (strzał myszą z § 5.3).
//  • Działo, Ciężkie działo: jak trafienie w grze (wGrze.js, voxHit). Pocisk leci w płaszczyźnie gry (z = 150) od dołu kadru, krater w pierwszym węźle pod nią, promień z obrażeń.
//  • Taran: statek wpada od dołu kadru, nurkuje przez punkt kliknięcia w płaszczyźnie gry i ryje kanał: krater co krok fizyki na jego drodze (rdzeń usuwa, reszta rozpycha).
//  • Upadek (HP 0): jak voxFall w grze. Szyja i sektory dysku cięte (grupyGry), po 3 s kotwice puszczają falą od osi habitatu, 1500 j./s.
// Czas narzędzi to klatki solvera, więc pauza i tempo działają. Siatki statku i pocisków są w scenie obrazu przed rozgrzewką (zero pipeline'ów w biegu).
import * as THREE from 'three/webgpu';
import { createGrupyGry } from '../../src/3d/woksele/grupyGry.js';
import { createPirateBaseLayout } from '../../src/3d/portBuildings/pirateBaseLayout.js';

const Z_GRY = 150; // płaszczyzna gry nad bazą jak w wGrze.js (Z_PROMIENIA)
const POCISKI = 24;
const V_POCISKU = 7000; // j./s
const V_TARANU = 1300; // j./s
const NURT = (22 * Math.PI) / 180; // kąt nurkowania taranu
const FALA_START = 3, FALA_V = 1500;

export const NARZEDZIA = Object.freeze([
  ['patrz', 'Patrz'], ['krater', 'Krater'], ['dzialo', 'Działo'], ['ciezkie', 'Ciężkie działo'], ['taran', 'Taran (statek)'],
]);

export function createNarzedzia({ solver, obraz, camera, kanwa }) {
  const scena = obraz.scene;

  // ── Siatki ── Statek: kadłub, nadbudówka, dysze. Pociski: pula wydłużonych kostek, świecą (barwa > 1 w celu HDR).
  const statek = new THREE.Group();
  statek.name = 'NarzStatek';
  const matKad = new THREE.MeshLambertNodeMaterial({ color: new THREE.Color().setRGB(0.09, 0.095, 0.1, THREE.LinearSRGBColorSpace) });
  matKad.name = 'NarzKadlub';
  const matDysza = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color().setRGB(5, 2.6, 0.9, THREE.LinearSRGBColorSpace) });
  matDysza.name = 'NarzDysza';
  const kad = new THREE.Mesh(new THREE.BoxGeometry(380, 130, 70), matKad);
  const nad = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 50), matKad);
  nad.position.set(-60, 0, 55);
  const dysza = new THREE.Mesh(new THREE.BoxGeometry(24, 100, 40), matDysza);
  dysza.position.set(-200, 0, 0);
  statek.add(kad, nad, dysza);
  for (const m of [kad, nad, dysza]) m.frustumCulled = false;
  scena.add(statek);
  const matPoc = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color().setRGB(6, 3.2, 1.1, THREE.LinearSRGBColorSpace) });
  matPoc.name = 'NarzPocisk';
  const geoPoc = new THREE.BoxGeometry(180, 9, 9);
  const pociskiM = Array.from({ length: POCISKI }, () => {
    const m = new THREE.Mesh(geoPoc, matPoc);
    m.frustumCulled = false;
    scena.add(m);
    return m;
  });

  const stan = { narzedzie: 'patrz', pociski: [], hity: [], taran: null, upadek: null, grupy: null, rKratera: 120 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);

  /** Po rozgrzewce: siatki narzędzi schowane, dopóki nic nie leci. */
  function schowaj() {
    statek.visible = false;
    for (const m of pociskiM) m.visible = false;
  }

  // AGENT: reset nie chowa siatek. Pierwszy reset idzie przed rozgrzewką (ustawScene), a schowana siatka wypada z compileAsync i kompiluje się w klatce gry. Widoczność ustawia klatka().
  function reset() {
    stan.pociski.length = 0;
    stan.hity.length = 0;
    stan.taran = null;
    stan.upadek = null;
    stan.grupy = null;
  }

  // Kierunek „od dołu kadru”: oś y kamery rzucona na płaszczyznę XY. Kamera prawie pionowo w dół: to góra ekranu.
  function wGoreEkranu() {
    const e = camera.matrixWorld.elements;
    let x = e[4], y = e[5];
    let l = Math.sqrt(x * x + y * y);
    if (l < 1e-3) { x = -e[8]; y = -e[9]; l = Math.sqrt(x * x + y * y) || 1; }
    return [x / l, y / l];
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function promien(ev) {
    const r = kanwa.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    return ray.ray;
  }
  const naPlaszczyznie = (rr) => {
    const t = (Z_GRY - rr.origin.z) / rr.direction.z;
    return t > 0 ? [rr.origin.x + rr.direction.x * t, rr.origin.y + rr.direction.y * t] : null;
  };

  /** Promień krateru z obrażeń, jak w grze (wGrze.js, krokFizyki). */
  const rZObrazen = (dmg) => Math.min(240, Math.max(55, 45 + 1.6 * Math.sqrt(dmg)));

  /** Użycie narzędzia w punkcie: x, y w płaszczyźnie gry albo promień (krater). Dla harnessu także bez myszy. */
  function uzyj(nazwa, { x, y, o, dir } = {}) {
    if (!solver.wypiek) return false;
    if (nazwa === 'krater') {
      solver.strzel({ o, dir, r: stan.rKratera, J: 300, tau: 0.3, rP: 1.6 * stan.rKratera, rdzen: 0.4, rodz: 'glowna' });
      return true;
    }
    if (nazwa === 'dzialo' || nazwa === 'ciezkie') {
      const [ux, uy] = wGoreEkranu();
      const D = 4500;
      const g = [x - ux * D, y - uy * D];
      const r = rZObrazen(nazwa === 'ciezkie' ? 9000 : 500);
      stan.pociski.push({ gx: g[0], gy: g[1], x, y, f0: solver.fKlatka, n: Math.max(1, Math.round((D / V_POCISKU) * 60)), r });
      if (stan.pociski.length > POCISKI) stan.pociski.shift();
      return true;
    }
    if (nazwa === 'taran') {
      const [ux, uy] = wGoreEkranu();
      const c = Math.cos(NURT), s = Math.sin(NURT);
      const d = [ux * c, uy * c, -s];
      const przed = 4200, za = 3800;
      const S = [x - d[0] * przed, y - d[1] * przed, Z_GRY - d[2] * przed];
      const kroku = V_TARANU / 60;
      const N = Math.round((przed + za) / kroku);
      // Kratery tylko przy budowli: pudło węzłów z zapasem.
      const w = solver.wypiek;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < w.n; i++) {
        const px = w.pos[3 * i], py = w.pos[3 * i + 1], pz = w.pos[3 * i + 2];
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
      }
      const zap = 260;
      const lista = [];
      for (let k = 0; k <= N; k++) {
        const px = S[0] + d[0] * kroku * k, py = S[1] + d[1] * kroku * k, pz = S[2] + d[2] * kroku * k;
        if (px < x0 - zap || px > x1 + zap || py < y0 - zap || py > y1 + zap || pz < z0 - zap || pz > z1 + zap) continue;
        lista.push({ f: k, nos: -1, x: px, y: py, z: pz, r: 150, rdzen: 0.55, rS: 1, J: 260, tau: 0.05, rP: 300, dz: 0, usunStojace: true, rodz: 'taran' });
      }
      if (lista.length) solver.dodajKratery(lista);
      stan.taran = { S, d, kroku, f0: solver.fKlatka, N };
      return true;
    }
    if (nazwa === 'upadek') {
      if (stan.upadek) return false;
      const w = solver.wypiek;
      if (!stan.grupy) stan.grupy = createGrupyGry({ w, l: createPirateBaseLayout({ id: 'B1' }), dx: w.dx });
      const { lista } = stan.grupy.upadek(0, -1);
      if (lista.length) solver.dodajKratery(lista);
      stan.upadek = { f0: solver.fKlatka };
      return true;
    }
    return false;
  }

  /** Przed krokiem solvera: pociski, które doleciały, kolejka trafień (jeden strzał na krok, jak w grze), fala kotwic. */
  function krok(renderer) {
    const f = solver.fKlatka;
    for (let k = stan.pociski.length - 1; k >= 0; k--) {
      const p = stan.pociski[k];
      if (f - p.f0 < p.n) continue;
      stan.hity.push(p);
      stan.pociski.splice(k, 1);
    }
    if (stan.hity.length && !solver.strzalCzeka) {
      const h = stan.hity.shift();
      solver.strzel({ o: [h.x, h.y, Z_GRY], dir: [0, 0, -1], r: h.r, J: 70, tau: 0.08, rP: 1.4 * h.r, rdzen: 0.5, rodz: h.r > 120 ? 'glowna' : 'mala' });
    }
    if (stan.upadek) {
      const t = (f - stan.upadek.f0) / 60;
      if (t >= FALA_START && !stan.upadek.koniec) {
        const R = FALA_V * (t - FALA_START);
        solver.puscKolo(renderer, 0, 0, R);
        if (R > 14000) stan.upadek.koniec = true;
      }
    }
  }

  /** Przed rysunkiem: pociski i statek w miejscu z zegara solvera (+ ułamek kroku). */
  function klatka(akum = 0) {
    const f = solver.fKlatka + akum * 60;
    for (let k = 0; k < POCISKI; k++) {
      const m = pociskiM[k];
      const p = stan.pociski[k];
      if (!p) { m.visible = false; continue; }
      const u = Math.min(1, (f - p.f0) / p.n);
      tmp.set(p.gx + (p.x - p.gx) * u, p.gy + (p.y - p.gy) * u, Z_GRY);
      m.position.copy(tmp);
      tmp2.set(p.x - p.gx, p.y - p.gy, 0).normalize();
      m.quaternion.copy(q.setFromUnitVectors(X, tmp2));
      m.visible = true;
      m.updateMatrixWorld();
    }
    const t = stan.taran;
    if (!t) statek.visible = false;
    else {
      const k = f - t.f0;
      if (k > t.N) { stan.taran = null; statek.visible = false; } else {
        statek.position.set(t.S[0] + t.d[0] * t.kroku * k, t.S[1] + t.d[1] * t.kroku * k, t.S[2] + t.d[2] * t.kroku * k);
        tmp2.set(t.d[0], t.d[1], t.d[2]);
        statek.quaternion.copy(q.setFromUnitVectors(X, tmp2));
        statek.visible = true;
        statek.updateMatrixWorld(true);
      }
    }
  }

  // ── Mysz ── Klik bez przeciągania (≤ 5 px, ≤ 350 ms) używa narzędzia, przeciąganie zostaje dla kamery. F trzymane: działo seriami w miejscu kursora.
  let wcisk = null, kursor = null, seria = 0;
  kanwa.addEventListener('pointerdown', (ev) => { if (ev.button === 0) wcisk = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  kanwa.addEventListener('pointermove', (ev) => { kursor = ev; });
  kanwa.addEventListener('pointerup', (ev) => {
    if (ev.button !== 0 || !wcisk) return;
    const ruch = Math.hypot(ev.clientX - wcisk.x, ev.clientY - wcisk.y), dt = performance.now() - wcisk.t;
    wcisk = null;
    if (ruch > 5 || dt > 350 || stan.narzedzie === 'patrz') return;
    uzyjMysza(ev);
  });
  function uzyjMysza(ev) {
    const rr = promien(ev);
    if (stan.narzedzie === 'krater') return uzyj('krater', { o: rr.origin.toArray(), dir: rr.direction.toArray() });
    const p = naPlaszczyznie(rr);
    if (p) uzyj(stan.narzedzie, { x: p[0], y: p[1] });
  }
  window.addEventListener('keydown', (ev) => { if (ev.code === 'KeyF') seria = seria || performance.now(); });
  window.addEventListener('keyup', (ev) => { if (ev.code === 'KeyF') seria = 0; });
  /** Seria z F: co 1/8 s strzał w kursor (działo albo ciężkie działo, inne narzędzia: krater). */
  function serie(teraz) {
    if (!seria || !kursor || teraz - seria < 125) return;
    seria = teraz;
    if (stan.narzedzie === 'patrz' || stan.narzedzie === 'taran') return;
    uzyjMysza(kursor);
  }

  return {
    stan, uzyj, krok, klatka, serie, reset, schowaj,
    ustaw(nazwa) { stan.narzedzie = nazwa; },
    get narzedzie() { return stan.narzedzie; },
  };
}
