// Planeta pod bazą w demie wiązanych wokseli (prośba użytkownika 2026-11-09: „i planetę pod bazą poproszę — tak jak w grze”).
// Wzór: src/3d/woksele/wGrze.js (pole grawitacji, kontakt ze skałą, kratery upadku) i src/3d/pirateBaseGame.js (PirateRock3D w ramce bazy).
// Planetoida Hidalgo z gry (createPirateRockLayout): r 48 km, środek 88 km pod płaszczyzną gry i 16,5 km w bok, szczyt około 40 km pod bazą.
//  • Rysunek: PirateRock3D w scenie obrazu dema (warstwa 0, kamera dema). Słońce skały to słońce dema, a mapa kształtu ta sama co w grze.
//  • Fizyka jak w grze: pod najniższym węzłem stała −z przechodzi w pole rozbieżne z punktu nad bazą, a nad skałą w pole ku jej środkowi (ustawGinie).
//    Kontakt z prawdziwą bryłą skały (mapa kształtu, ustawWysokosciSkaly). Węzeł i gruz głęboko pod nią giną. Grunt solvera schodzi pod kulę (GRUNT_PLANETY).
//  • Uderzenia: kubełki węzłów przy skale co 0,25 s czasu sceny, bryły z sąsiednich kubełków to jeden krater na mapie skały (stemplujKrater, jak w grze).
// AGENT: opis planety jest jednym obiektem (środek, promień, kształt powierzchni, pole), żeby inne planety (Ziemia, Mars z atmosferą — sesja spalanie-atmosfera)
// wpięły się tym samym torem: zamiast PirateRock3D własna bryła z metodami surfaceRadiusNear / surfaceRadiusAt / setCraterPatch / addCrater / flushCraters.
import * as THREE from 'three/webgpu';
import { GINIE_BOK, WYS_BOK } from '../../src/3d/woksele/solver.js';
import { PirateRock3D } from '../../src/3d/pirateRock3D.js';
import { setMoonSunDirection } from '../../src/3d/moonSurface.tsl.js';
import { createPirateRockLayout } from '../../src/3d/portBuildings/pirateRockLayout.js';
import { portModuleFrame } from '../../src/3d/portBuildings/portModuleTraffic.js';

export const GRUNT_PLANETY = -70000; // jak GRUNT_GRY w wGrze.js: grunt solvera pod kulą skały, więc nie działa
const POLE_ZAKRES_J = 5000;
const LATA_KRATEROW = 14000;
const WYS_POL_J = 16000;
const ROZB_L = 20000;
const ROZB_PAS_J = 6000;
const KUBELEK_J = 250;
const UDERZENIA_CO_KROKOW = 15; // 0,25 s czasu sceny
const PLAMA_KUBELEK_MIN = 8;
const PLAMA_MIN = 20;
const KRATER_J = 48;
const KRATER_R_MAX = 1500;
const KRATEROW_MAX = 300;
const KRATER_WZROST = 1.2;

/** Hidalgo z gry. Układ węzłów dema = układ bazy: X = x bazy, Y = −z bazy, Z = wysokość (ramka portModuleFrame(0, 0, −π/2)). */
export async function createPlanetaDema({ solver, obraz, renderer }) {
  const layout = createPirateRockLayout();
  const skala = new PirateRock3D(layout, 0);
  // Środek skały w grze (y w dół): x bazy, z bazy (pirateBaseGame.js: place.toGame(c[0], c[2]) przy bazie w zerze i kursie 0).
  skala.setFrame(portModuleFrame(0, 0, -Math.PI / 2), { x: layout.center[0], y: layout.center[2] });
  obraz.scene.add(skala.root);
  skala.root.updateMatrixWorld(true);
  // Mapa kształtu w tle (loadSmallBodyShape): bez niej kontakt i kratery na kuli R. Najwyżej 15 s czekania, potem kula.
  for (let t = 0; !skala.shapeReady && t < 300; t++) await new Promise((ok) => setTimeout(ok, 50));

  const C = [layout.center[0], -layout.center[2], layout.center[1]];
  const st = { aktywna: false, R: layout.R, kubX0: 0, kubY0: 0, wysX0: 0, wysY0: 0, zNajnizej: 0, srodek: [0, 0], krok: 0, czyta: false, uderzen: 0, krateryN: 0, pokolenie: 0 };
  const wysCpu = new Float32Array(WYS_BOK * WYS_BOK);
  let ginieStare = new Uint32Array(GINIE_BOK * GINIE_BOK);
  const plamaZn = new Uint8Array(GINIE_BOK * GINIE_BOK), plamaStos = new Int32Array(GINIE_BOK * GINIE_BOK);
  const krateryPam = new Float32Array(4 * KRATEROW_MAX);

  /** Kula kontaktu, pole ku skale i siatka kubełków na rzucie środka bazy na skałę (wGrze.js, ustawSkale). Zwraca ten punkt. */
  function ustawSkale(R) {
    const [bx, by] = st.srodek;
    const ex = bx - C[0], ey = by - C[1], ez = -C[2];
    const k = R / Math.sqrt(ex * ex + ey * ey + ez * ez);
    const cx = C[0] + k * ex, cy = C[1] + k * ey, z = C[2] + k * ez;
    st.R = R;
    st.kubX0 = cx - 0.5 * GINIE_BOK * KUBELEK_J;
    st.kubY0 = cy - 0.5 * GINIE_BOK * KUBELEK_J;
    const kd = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    const rozbF = [bx + (ex / kd) * ROZB_L, by + (ey / kd) * ROZB_L, (ez / kd) * ROZB_L];
    solver.ustawGinie({ c: C, R, x0: st.kubX0, y0: st.kubY0, kom: KUBELEK_J, zPola: st.zNajnizej - 200, zakresPola: POLE_ZAKRES_J, rozbF, rozbPas: ROZB_PAS_J });
    return [cx, cy, z];
  }

  /** Mapa kształtu skały pod bazą do solvera: ta sama bryła, którą widać, dostaje kontakt, pył i kratery. */
  function zbudujKsztalt() {
    const N = WYS_BOK, bok = 2 * WYS_POL_J, R = st.R;
    const x0 = st.kubX0 + 0.5 * GINIE_BOK * KUBELEK_J - WYS_POL_J, y0 = st.kubY0 + 0.5 * GINIE_BOK * KUBELEK_J - WYS_POL_J;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const lx = x0 + ((i + 0.5) * bok) / N, ly = y0 + ((j + 0.5) * bok) / N;
      const dd = (lx - C[0]) ** 2 + (ly - C[1]) ** 2;
      const lz = C[2] + Math.sqrt(Math.max(0, R * R - dd));
      wysCpu[j * N + i] = skala.surfaceRadiusAt(lx, ly, lz) - R;
    }
    st.wysX0 = x0;
    st.wysY0 = y0;
    solver.ustawWysokosciSkaly(wysCpu, x0, y0, bok);
  }

  /** Promień skały pod punktem układu węzłów, dwuliniowo z mapy kształtu (wGrze.js, promienLok). */
  function promienLok(lx, ly) {
    const N = WYS_BOK, k = N / (2 * WYS_POL_J);
    const fx = Math.max(0, Math.min(N - 1, (lx - st.wysX0) * k - 0.5)), fy = Math.max(0, Math.min(N - 1, (ly - st.wysY0) * k - 0.5));
    const x0 = Math.min(N - 2, Math.floor(fx)), y0 = Math.min(N - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const a = wysCpu[y0 * N + x0] * (1 - tx) + wysCpu[y0 * N + x0 + 1] * tx;
    const b = wysCpu[(y0 + 1) * N + x0] * (1 - tx) + wysCpu[(y0 + 1) * N + x0 + 1] * tx;
    return st.R + a * (1 - ty) + b * ty;
  }

  function stemplujKrater(lx, ly, r, n) {
    const R = promienLok(lx, ly);
    const dd = (lx - C[0]) ** 2 + (ly - C[1]) ** 2;
    if (dd >= R * R) return;
    const lz = C[2] + Math.sqrt(R * R - dd);
    if (skala.addCrater(lx, ly, lz, r, Math.min(1, 0.45 + n / 400))) st.uderzen++;
  }

  /** Bryła n węzłów uderzyła w punkcie (kx, ky) siatki kubełków: nowy krater albo większy stary (wGrze.js, pokazUderzenie). Rozrzut z haszu, bez Math.random. */
  function pokazUderzenie(n, kx, ky) {
    const h = Math.imul(st.krateryN + st.uderzen + 1, 0x9E3779B1) >>> 0;
    const lx = st.kubX0 + (kx + (h & 1023) / 1023 - 0.5) * KUBELEK_J, ly = st.kubY0 + (ky + ((h >>> 10) & 1023) / 1023 - 0.5) * KUBELEK_J;
    const r = Math.min(KRATER_R_MAX, KRATER_J * Math.cbrt(n));
    const K = krateryPam;
    for (let i = 0; i < st.krateryN; i++) {
      const o = 4 * i, dx = lx - K[o], dy = ly - K[o + 1], rO = K[o + 2], zas = 0.8 * Math.max(r, rO);
      if (dx * dx + dy * dy >= zas * zas) continue;
      K[o + 3] += n;
      const rN = Math.min(KRATER_R_MAX, KRATER_J * Math.cbrt(K[o + 3]));
      if (r > rO) { K[o] = lx; K[o + 1] = ly; }
      if (rN >= KRATER_WZROST * rO) { K[o + 2] = rN; stemplujKrater(K[o], K[o + 1], rN, K[o + 3]); }
      return;
    }
    if (st.krateryN >= KRATEROW_MAX) return;
    const o = 4 * st.krateryN++;
    K[o] = lx; K[o + 1] = ly; K[o + 2] = r; K[o + 3] = n;
    stemplujKrater(lx, ly, r, n);
  }

  /** Węzły, które od ostatniego odczytu doleciały do skały, jako kratery (wGrze.js, czytajUderzenia). Bez czekania klatki. */
  async function czytajUderzenia() {
    if (st.czyta) return;
    st.czyta = true;
    const pok = st.pokolenie;
    try {
      const nowe = await solver.odczytGinie(renderer);
      if (pok !== st.pokolenie || !st.aktywna) return;
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
      for (let q = 0; q < nowe.length; q++) if (nowe[q] > stare[q]) stare[q] = nowe[q];
      plamy.sort((a, b) => b[0] - a[0]);
      for (const [n, kx, ky] of plamy) pokazUderzenie(n, kx, ky);
      skala.flushCraters();
    } catch (e) {
      console.warn('[planeta] odczyt uderzeń', e);
    } finally {
      st.czyta = false;
    }
  }

  return {
    skala, layout, srodek: C,
    get aktywna() { return st.aktywna; },
    /**
     * Po solver.wczytaj (ustawUniformy kasuje pole sceny) i obraz.wczytaj: skała tylko pod bazą, łata kraterów od nowa.
     * Grunt dema schowany: solver ma grunt pod kulą (GRUNT_PLANETY w budowie sceny), a jego siatka wisiałaby pod skałą.
     */
    wczytaj(w, naBazie) {
      st.pokolenie++;
      st.aktywna = !!naBazie;
      skala.root.visible = st.aktywna;
      st.krok = 0; st.uderzen = 0; st.krateryN = 0;
      ginieStare = new Uint32Array(GINIE_BOK * GINIE_BOK);
      skala.clearScars();
      if (!st.aktywna) {
        // Inne sceny: bez kuli kontaktu, bezpiecznika i pola rozbieżnego. Pole sceny zostaje takie, jak ustawił solver.wczytaj.
        const u = solver.uniformy;
        u.uKulaR.value = 0;
        u.uGinieR2.value = 0;
        u.uGRozbPas.value = 0;
        return;
      }
      obraz.grunt.visible = false;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
      for (let i = 0; i < w.n; i++) {
        const x = w.pos[3 * i], y = w.pos[3 * i + 1], z = w.pos[3 * i + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
      }
      st.srodek = [0.5 * (x0 + x1), 0.5 * (y0 + y1)];
      st.zNajnizej = z0;
      // Kula R, potem promień z siatki skały pod bazą (mapa kształtu odsuwa powierzchnię od R) i drugi raz, jak aktywuj() w grze.
      const p0 = ustawSkale(layout.R);
      const R = skala.surfaceRadiusNear(p0[0], p0[1], p0[2], LATA_KRATEROW);
      const p = ustawSkale(R);
      skala.setCraterPatch(p[0], p[1], p[2], LATA_KRATEROW);
      zbudujKsztalt();
    },
    /** Kierunek słońca dema na skałę (noc i dzień skały, rzeźba kraterów). */
    slonce(sun) {
      const s = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
      setMoonSunDirection(skala.material, s.x, s.y, s.z);
      if (skala._kr?.on.value > 0.5) {
        skala.mesh.updateWorldMatrix(true, false);
        const v = s.clone().transformDirection(new THREE.Matrix4().copy(skala.mesh.matrixWorld).invert());
        skala._kr.sun.value.set(v.dot(skala._kr.t1.value), v.dot(skala._kr.t2.value));
      }
    },
    /** Po kroku solvera: co 0,25 s czasu sceny odczyt uderzeń. */
    krok() {
      if (!st.aktywna) return;
      if (++st.krok % UDERZENIA_CO_KROKOW === 0) czytajUderzenia();
    },
    stan() { return { aktywna: st.aktywna, R: Math.round(st.R), kraterow: st.krateryN, uderzen: st.uderzen, ksztalt: !!skala.shapeReady }; },
  };
}
