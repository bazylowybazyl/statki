// HUTA — formowanie, etapy „Pasmo w polu” i „Kropla”: OBRAZ LINII — metal (jedna siatka, jeden rysunek: struga z
// wylewki, błona, gardziel G0, pasmo, tunel), POWŁOKA POLA wokół strugi i błony (ta sama siatka, materiał addytywny —
// drugi rysunek), światło linii na otoczeniu (blok `FormowanieSwiatloLinii` materiału otoczenia), siła emiterów pola
// (kanały `POLE_KANAL`), położenie i siła ZACISKU POLA (bramki wzdłuż błony — etap „Wyciskanie”) i stan zaworu wylewki
// ze stanu symulacji. Moduł renderu: stan linii dostaje z argumentów `frame`, nie z `window`.
import * as THREE from 'three';
import { BLONA, HALA, LINIA, PATH, SPUST } from './geometria.js';
import { LIN_LICZNIK, LIN_STAN, METAL_FIZ, PASMO, TRYB } from './linia.js';
import { POLE_KANAL, createFieldShellMaterial, createLineUniforms, createMetalLineGeometry, createMetalLineMaterial, createStationBuffer } from './pasmoTSL.js';
import { CHLODNICE, STACJE, createStationFiller } from './stacje.js';
/** Kanał pola pierwszego przedziału ciepła paneli chłodnic (runda 7; `OU.pole` 8 × vec4). */
const KANAL_CHLODNIC = CHLODNICE.kanal;
/** Bezwładność cieplna lica panelu chłodnicy [s] (czas symulacji). */
const CHILL_TAU = 2.5;
import { ARM_REST, WALC } from './walcownia.js';
import { OSLONA, POLE_PETLA } from './walcowniaBryly.js';
import { ZGORZ } from './zgorzelina.js';
import { createScaleMaterial } from './zgorzelinaTSL.js';
import { ISKRA_STRIDE, ISKRY_CAP } from './iskry.js';
import { valveAngle } from './stanZlozenia.js';
import { zbierzZakres } from '../../../../src/3d/zakresyWysylki.js';
// (runda 9, „Czysta stal”) warstwa plazmy stacji odzgorzania (1 rysunek, addytywnie) i kanał pola stacji / kurtyny
import { ODZ_KANAL } from './odzgorzanie.js';
import { createDescaleGeometry, createDescaleMaterial, createDescaleUniforms } from './odzgorzanieTSL.js';

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);

export class LiniaObraz {
  /**
   * @param {object} o
   * @param {import('three').Group} o.root   grupa w układzie komory
   * @param {object} o.U                      uniformy wytopu (kamera, słońce, jasność)
   * @param {object} o.zl                     obraz otoczenia (`ZlozenieObraz`: blok świateł linii, kanały pola)
   * @param {object} [o.sparkMaterial]        materiał iskier wytopu (ten sam program — `WytopIskra`)
   * @param {Float32Array} [o.sparkData]      rekordy iskier linii (`createLineSparks().data`)
   * @param {Float32Array} [o.scaleData]      rekordy zgorzeliny i iskier walcowni (`createScaleDebris().data`, runda 7)
   */
  constructor({ root, U, zl, sparkMaterial = null, sparkData = null, scaleData = null }) {
    this.U = U;
    this.zl = zl;
    this.LM = createLineUniforms();
    this.ST = createStationBuffer();
    this.material = createMetalLineMaterial(U, this.LM, this.ST.node, zl.OU.pole);
    this.geometry = createMetalLineGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Formowanie_pasmo';
    this.mesh.frustumCulled = false;
    root.add(this.mesh);
    // powłoka pola: ta sama siatka stacji, materiał addytywny (po metalu)
    this.shellMaterial = createFieldShellMaterial(U, this.LM, this.ST.node);
    this.shell = new THREE.Mesh(this.geometry, this.shellMaterial);
    this.shell.name = 'Formowanie_pole';
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 2;
    root.add(this.shell);
    // (runda 9) STACJA ODZGORZANIA: warstwa plazmy (górna, dolna, pas styku) — po metalu, addytywnie
    this.OZ = createDescaleUniforms();
    this.descale = new THREE.Mesh(createDescaleGeometry(), createDescaleMaterial(this.OZ));
    this.descale.name = 'Odzgorzanie_plazma';
    this.descale.frustumCulled = false;
    this.descale.renderOrder = 3;
    root.add(this.descale);
    this.meshes = [this.mesh, this.shell, this.descale];
    // iskry przy wejściu strugi w błonę: partia instancji na materiale iskier wytopu
    this.sparks = null;
    if (sparkMaterial && sparkData) {
      const buf = new THREE.InstancedInterleavedBuffer(sparkData, ISKRA_STRIDE);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
      g.setAttribute('iCur', new THREE.InterleavedBufferAttribute(buf, 4, 0));
      g.setAttribute('iPrev', new THREE.InterleavedBufferAttribute(buf, 4, 4));
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, sparkMaterial);
      m.name = 'Formowanie_iskry';
      m.frustumCulled = false;
      root.add(m);
      this.sparks = { mesh: m, buf, g };
    }
    // (runda 7) ZGORZELINA I ISKRY WALCOWNI: partia instancji na własnym materiale (płatki przykrywają, iskry dodają)
    this.scale = null;
    if (scaleData) {
      const buf = new THREE.InstancedInterleavedBuffer(scaleData, ZGORZ.stride);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
      g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
      g.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
      g.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, createScaleMaterial(U));
      m.name = 'Walcownia_zgorzelina';
      m.frustumCulled = false;
      m.renderOrder = 3;
      root.add(m);
      this.scale = { mesh: m, buf, g };
    }
    this.gateLamp = 0;
    this.tunnelLamp = 0;
    /** (poprawki rundy 7) spadek temperatury lica skorupy w poprzek taśmy (`SKORUPA` w `pasmoTSL.js`): 1 — włączony, 0 — A/B */
    this.skorupa = 1;
    /** (runda 8) wzór strugi: 1 — pola gęstsze i bilans ciepła odcinka (`strugaWzor.js`, poprawki rundy 8), 0 — A/B: wzór sprzed
     *  rundy 8, 2 — A/B: etap „Struga — jasność” (pola ×4, pełna amplituda) */
    this.strugaWzor = 1;
    this.filler = createStationFiller();
    // siła kanałów pola (wygładzona): 16 linii + pętlowniki walcowni (16, 17); runda 7: 20–31 — ciepło paneli chłodnic
    // w 12 przedziałach x (`CHLODNICE`, z bezwładnością cieplną w czasie symulacji)
    this.str = new Float32Array(32);
    this.want = new Float32Array(32);
    this.chillHeat = new Float64Array(CHLODNICE.n);
    this.chillT = -1;                         // czas linii przy ostatnim odświeżeniu ciepła paneli
    this.flash = 0;                           // błysk chwytu walców (światło [14])
    this.live = 0;
    this.lightGain = 1;
    this.pinX = 0;                            // zacisk pola w klatce (x [j.]) i jego siła (wygładzona jak kanały)
    this.pinF = 0;
    this.hitK = 0;
    this.spoutHeat = 0;
    this.pipeHeat = 0;
  }

  setLayers(layer) {
    for (const m of this.meshes) m.layers.set(layer);
    if (this.sparks) this.sparks.mesh.layers.set(layer);
    if (this.scale) this.scale.mesh.layers.set(layer);
  }

  warmupMeshes() { return this.meshes.slice(); }

  /** Siatki instancji (rozgrzewka z wariantem licznika ≥ 2). */
  warmupInstanced() { const o = []; if (this.sparks) o.push(this.sparks.mesh); if (this.scale) o.push(this.scale.mesh); return o; }

  /** Iskry linii: liczba żywych → licznik instancji, wysyłka zakresu bufora. */
  applySparks(count) {
    if (!this.sparks) return;
    const n = Math.min(count, ISKRY_CAP);
    this.sparks.g.instanceCount = n;
    if (n > 0) zbierzZakres(this.sparks.buf, 0, n * ISKRA_STRIDE);
  }

  /** Zgorzelina walcowni: liczba żywych → licznik instancji, wysyłka zakresu bufora. */
  applyScale(count) {
    if (!this.scale) return;
    const n = Math.min(count, ZGORZ.cap);
    this.scale.g.instanceCount = n;
    if (n > 0) zbierzZakres(this.scale.buf, 0, n * ZGORZ.stride);
  }

  /** Czy pasmo (dowolne) zajmuje drogę s. */
  static covers(line, s) {
    const n = line.view.ring[1];
    for (let i = 0; i < n; i++) {
      const o = line.sliceOffset(i);
      if (s <= line.view.slices[o] && s >= line.sliceTop(i)) return true;
    }
    return false;
  }

  /** Kąt klap zaworu wylewki [rad] ze stanu linii. */
  static valveAngleOf(line) { return valveAngle(line.stan[LIN_STAN.spout]); }

  /**
   * Walcownia w klatce: kąty walców (obrót wzoru w materiale otoczenia; ułamek kroku — ω·α·dt) i BŁYSK CHWYTU (światło
   * [14] przy łuku styku klatki, która ostatnio chwyciła czoło: jaśniej i szerzej przez ~0,3 s, barwa z temperatury
   * taśmy w tym miejscu).
   */
  millFrame(MV, alpha, dt, realDt) {
    const adv = alpha * dt;
    const TAU = Math.PI * 2;
    const a0 = (MV.ang[0] + MV.omega[0] * adv) % TAU;
    const a1 = (MV.ang[1] + MV.omega[1] * adv) % TAU;
    const a2 = (MV.ang[2] + MV.omega[2] * adv) % TAU;
    let kb = -1;
    let tb = 99;
    for (let k = 0; k < 3; k++) if (MV.biteT[k] < tb) { tb = MV.biteT[k]; kb = k; }
    const f = kb >= 0 && tb < 1.5 ? Math.exp(-(tb + adv) / 0.3) : 0;
    this.flash = f;
    this.zl.OU.mill.value.set(a0, a1, a2, f);
    const D = this.zl.LU.data;
    if (f > 0.01) {
      const S = WALC.stands[kb];
      const x = S.e + S.ld * 0.5 - PATH.xOff;
      // temperatura taśmy przy łuku styku (rekord stacji najbliższej x)
      const out = this.ST.array;
      let T = 0;
      let best = 1e9;
      for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
        const r = q * STACJE.stride;
        if (out[r + 7] < 2.5) continue;
        const d = Math.abs(out[r] - x);
        if (d < best) { best = d; T = out[r + 9]; }
      }
      if (best < 40) {
        D[14].set(x - 8, HALA.passY, 0, 40 + 50 * f);
        D[30].set(x + 8, HALA.passY, 0, Math.min(1.05, T + 0.28 * f));
      }
    }
    void realDt;
  }

  /**
   * Klatka: stan linii → stacje (bufor storage), światło linii, siła emiterów pola, zacisk. `alpha` — ułamek kroku
   * strony, `dt` — krok strony [s], `realDt` — czas klatki (wygładzanie siły pola).
   */
  frame(line, mill, alpha, dt, realDt = 1 / 60) {
    this.live = this.filler.fill(line, mill, alpha, dt, this.ST.array);
    this.ST.attr.needsUpdate = true;
    this.filler.fillLights(this.ST.array, this.zl.LU.data, this.lightGain);
    const L = line.stan;
    this.LM.time.value.x = L[LIN_STAN.time] + alpha * dt;
    this.LM.time.value.y = L[LIN_STAN.flowPh];
    // (runda 8) koniec WIDOCZNEJ strugi (s wejścia w błonę): bilans ciepła odcinka — pola strugi liczą średnią do tego miejsca
    this.LM.time.value.z = this.filler.entry[0];
    this.LM.time.value.w = this.strugaWzor === 2 ? 2 : this.strugaWzor ? 0 : 1;
    // --- siła pola: emiter pracuje, gdy w jego zasięgu jest metal (czuwanie przygaszone) ---
    const w = this.want;
    const jh = L[LIN_STAN.jetHead];
    // (etap „Struga”: struga płynie, póki rura oddaje metal przez wargę — wypływ `lipQ`, nie dopływ z gardzieli)
    const jt = L[LIN_STAN.lipQ] > 0 ? -1 : L[LIN_STAN.jetTail];
    const sLip = PASMO.sLip;
    const q = Math.min(1, L[LIN_STAN.lipQ] / 30);
    const jet = (s) => (jh >= 0 && s <= jh + 20 && s >= jt - 20 ? 0.55 + 0.6 * q : 0.12);
    w[POLE_KANAL.kolnierz] = Math.max(jet(sLip + 4), 0.12 + 0.5 * L[LIN_STAN.spout]);
    w[POLE_KANAL.struga1] = jet(sLip + 20);
    w[POLE_KANAL.struga2] = jet(sLip + 64);
    // pierścienie na łuku strugi (poprawki rundy 6): jaśnieją, gdy przechodzi przez nie metal
    w[POLE_KANAL.struga3] = jet(sLip + SPUST.arcRings[0].off);
    w[POLE_KANAL.struga4] = jet(sLip + SPUST.arcRings[1].off);
    const Vt = L[LIN_STAN.resV] / 1536;
    const work = Math.min(1, Math.abs(L[LIN_STAN.q0]) * 4 + Math.abs(L[LIN_STAN.q1]) * 5 + Math.abs(L[LIN_STAN.q2]) * 4 + L[LIN_STAN.etaE] * 6);
    const attached = L[LIN_STAN.attached] > 0;
    // (bramki zacisku: jasność liczy shader otoczenia z położenia i siły zacisku — kanał nieużywany)
    w[POLE_KANAL.zacisk] = 0;
    const xb = L[LIN_STAN.memXb];
    for (let k = 0; k < 3; k++) {
      const x = BLONA.bed[k];
      const under = Vt > 0.2 && x >= xb - 20;
      w[POLE_KANAL.loze0 + k] = under ? 0.3 + 0.55 * Math.min(1, Vt / 150) + 0.45 * work : 0.1;
    }
    w[POLE_KANAL.boki] = 0;
    w[POLE_KANAL.G0] = attached ? 0.9 + 0.25 * Math.min(1, Math.abs(L[LIN_STAN.aOut] - 1) * 6) : LiniaObraz.covers(line, PASMO.sG0 + 6) ? 0.6 : 0.12;
    // (runda 7) emitery G1–G4: jasność z NACISKU bramy (liczony w stacjach z przekroju, fali, prędkości i f_s — `stacje.js`)
    const PR = this.filler.press;
    for (let k = 1; k < 5; k++) w[POLE_KANAL.G0 + k] = PR[k] > 0 ? 0.25 + 0.65 * Math.min(1.3, PR[k]) : 0.12;
    // CHŁODNICE (runda 7): ciepło lica paneli dąży do strumienia odebranego z pasma (bezwładność w czasie symulacji)
    {
      const q = this.filler.chillFlux(line);
      const tNow = L[LIN_STAN.time];
      const dts = this.chillT < 0 ? 1e9 : Math.max(0, tNow - this.chillT);
      this.chillT = tNow;
      const kc = 1 - Math.exp(-dts / CHILL_TAU);
      // (poprawki rundy 7) temperatura lica panelu z ODEBRANEGO strumienia przez przejmowanie ciepła do chłodziwa: silniejsze
      // chłodzenie C1 dla miedzi (χ · k_metal) to większy wydatek chłodziwa — przejmowanie rośnie wolniej niż wydatek
      // (h ∝ √(χ − 1) względem stali), więc lico panelu przy miedzi nie jest ~3× jaśniejsze, a stal świeci czytelnie
      const xm = L[LIN_STAN.resX];
      const kM = METAL_FIZ[0].kMetal + (METAL_FIZ[1].kMetal - METAL_FIZ[0].kMetal) * xm;
      const hC1 = Math.sqrt(Math.max(PASMO.chillC1 * kM - 1, 1e-3) / (PASMO.chillC1 - 1));
      const C1e = LINIA.chill.C1[1];
      const dxb = (CHLODNICE.x1 - CHLODNICE.x0) / CHLODNICE.n;
      for (let i = 0; i < CHLODNICE.n; i++) {
        this.chillHeat[i] += (q[i] - this.chillHeat[i]) * kc;
        const xc = CHLODNICE.x0 + (i + 0.5) * dxb;
        w[KANAL_CHLODNIC + i] = this.chillHeat[i] / (xc < C1e ? hC1 : 1);
      }
    }
    const c0 = LINIA.cushion[0];
    const c1 = LINIA.cushion[1];
    w[POLE_KANAL.poduszka0] = LiniaObraz.covers(line, (c0[0] + c0[1]) / 2 + PATH.xOff) || LiniaObraz.covers(line, c0[0] + 60 + PATH.xOff) ? 0.8 : 0.1;
    w[POLE_KANAL.poduszka1] = LiniaObraz.covers(line, (c1[0] + c1[1]) / 2 + PATH.xOff) ? 0.8 : 0.1;
    if (L[LIN_STAN.mode] === TRYB.PUSTA) w[POLE_KANAL.G0] = 0.12;
    // (runda 9) STACJA ODZGORZANIA: lica emiterów belek, listwy ssaw i kurtyny osłony — siła z mocy stacji (czuwanie
    // przygaszone); warstwa plazmy z mocy, ładunku tlenku przed stacją (ξ / 0,1) i czasu linii
    {
      const on = L[LIN_STAN.odzOn] > 0;
      const U = on ? L[LIN_STAN.odzU] : 0;
      w[ODZ_KANAL] = on ? 0.1 + 0.75 * U : 0.04;
      this.OZ.A.value.set(U, Math.min(1.5, L[LIN_STAN.odzXiIn] / 0.1), L[LIN_STAN.time] + alpha * dt, L[LIN_STAN.resX]);
      this.descale.visible = U > 0.02;
    }
    // walcownia: pętlowniki polowe (siła z regulatora pętli), kąty walców, błysk chwytu
    const MV = mill && mill.view && mill.view.looper ? mill.view : null;
    if (MV) {
      w[POLE_PETLA[0]] = MV.looper[0];
      w[POLE_PETLA[1]] = MV.looper[1];
      this.millFrame(MV, alpha, dt, realDt);
    } else { w[POLE_PETLA[0]] = 0; w[POLE_PETLA[1]] = 0; }
    // (runda 7) RAMIONA PĘTLOWNIKÓW (kąt z symulacji, ułamek kroku — prędkość kątowa), BRAMA „DO ZWIJARKI”: obramówka
    // wlotu i światło robocze tunelu — pełne, gdy taśma jest w bramie, przygaszone, gdy brama czeka
    {
      const OL = this.zl.OU.loop.value;
      const adv = alpha * dt;
      const a0 = MV && MV.arm ? MV.arm[0] + MV.armV[0] * adv - ARM_REST : 0;
      const a1 = MV && MV.arm ? MV.arm[1] + MV.armV[1] * adv - ARM_REST : 0;
      // (runda 8: brama „DO ZWIJARKI” i tunel usunięte — lampy bramy i światło tunelu zgaszone; strefa tunelu zostaje
      // w grafach pasma i otoczenia z mnożnikiem 0 do etapu obrazu dzielenia)
      this.gateLamp = 0;
      this.tunnelLamp = 0;
      void OSLONA;
      OL.set(a0, a1, this.gateLamp, this.tunnelLamp);
      this.LM.gate.value.set(this.tunnelLamp, this.skorupa, 0, 0);
      // żar lica taśmy przy klatkach (odbicie w beczkach walców): stacja pasma najbliżej osi walców (± 60 j.)
      const MT = this.zl.OU.millT.value;
      const out = this.ST.array;
      for (let k = 0; k < 3; k++) {
        const xk = WALC.stands[k].x - PATH.xOff;
        let T = 0;
        let best = 60;
        for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
          const r = q * STACJE.stride;
          if (out[r + 7] < 2.5) continue;
          const d = Math.abs(out[r] - xk);
          if (d < best) { best = d; T = out[r + 9]; }
        }
        if (k === 0) MT.x = T; else if (k === 1) MT.y = T; else MT.z = T;
      }
    }
    const k = 1 - Math.exp(-Math.max(realDt, 0) / 0.12);
    for (let c = 0; c < 20; c++) this.str[c] += (w[c] - this.str[c]) * (realDt <= 0 ? 1 : k);
    // (ciepło paneli ma własną bezwładność — bez wygładzania klatki)
    for (let c = KANAL_CHLODNIC; c < KANAL_CHLODNIC + CHLODNICE.n; c++) this.str[c] = w[c];
    // ZACISK POLA: położenie w klatce (stan kroku + posuw · ułamek kroku — jedzie płynnie), siła wygładzona jak kanały
    this.pinX = L[LIN_STAN.pinX] + L[LIN_STAN.pinV] * alpha * dt;
    const pf = Vt > 0.2 ? L[LIN_STAN.pinF] : 0;
    this.pinF += (pf - this.pinF) * (realDt <= 0 ? 1 : k);
    this.LM.press.value.set(this.pinX, this.pinF, 0, 0);
    // wejście strugi w błonę: punkt (x, y), siła dopływu 0…1 (fala kolista i jasna plama wejścia na powierzchni błony)
    const inR = L[LIN_STAN.splash] > 0 || L[LIN_STAN.inRate] > 0.5 ? Math.min(1.2, L[LIN_STAN.inRate] / 30) : 0;
    this.hitK += (inR - this.hitK) * (realDt <= 0 ? 1 : 1 - Math.exp(-Math.max(realDt, 0) / 0.15));
    // (etap „Struga”) wejście w obrazie: punkt na widocznej powierzchni metalu i promień strugi przy niej (stacje)
    const E = this.filler.entry;
    const onHit = L[LIN_STAN.landed] > 0 && E[1] > 0;
    this.LM.hit.value.set(onHit ? E[2] : L[LIN_STAN.hitX], onHit ? E[3] : L[LIN_STAN.hitY], this.hitK, onHit ? E[1] : 0);
    this.zl.field(this.str, L[LIN_STAN.chill], this.pinX, this.pinF, Vt > 0.2 ? Math.min(1, Vt / 20) : 0);
    // żar wylewki (struga przy wardze) i rury (metal w rurze)
    const C = line.counters;
    const sw = jh >= sLip - 30 && (L[LIN_STAN.lipQ] > 0 || jt <= sLip + 40) ? 0.35 + 0.65 * q : 0;
    const ph = Math.min(1, C[LIN_LICZNIK.pipe] / (40 * 1536));
    const kk = realDt <= 0 ? 1 : 1 - Math.exp(-realDt / 0.25);
    this.spoutHeat += (sw - this.spoutHeat) * kk;
    this.pipeHeat += (ph - this.pipeHeat) * (realDt <= 0 ? 1 : 1 - Math.exp(-realDt / 2.5));
  }
}
