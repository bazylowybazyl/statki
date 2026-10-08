// src/3d/gasField/gasFieldLayer.js
//
// OBRAZ POLA GAZU 2D (gasField2D.js) w passie ortho Core3D: dwie płaskie siatki na całą domenę —
// `back` (pył POD kadłubami: kolejka nieprzezroczysta, renderOrder przed kadłubami; z kurzem na pokładzie)
// i `front` (cienka część NAD kadłubami: przezroczysta, po kadłubach). Lekcja dymu gry (gasSmokeGame.js,
// A/B 2026-10-05): gęsty obłok nad płaszczyzną chował kadłuby — nad nimi tylko ułamek (`front`).
//
// Układ: geometria w układzie hali (x, z) [j.]; właściciel ustawia macierz świata (hala → scena, w double —
// highPrecision three składa modelViewMatrix na CPU), więc obraz nie drga przy 5–10 mln j. Faktura z pola
// pozycji spoczynkowych (detal jedzie z pyłem), szum cloud2D z mipmapami (bez migotania przy oddaleniu).
// Światło: rozproszone hali (wnętrze / próżnia), słońce przez maskę cienia (sunVisibility), światła siatki
// Core3D.fx.grid (dysze MAIN — pushEngineHullLights, błyski, wybuchy; lampy, reflektory i migające soczewki
// hali — hallDust.js) — gaz przy świetle świeci jego barwą, snop reflektora widać w nim jak klin.
// Dwa składniki: PYŁ (den.x — szaro-beżowy, faktura kłębów) i PARA paliwa (den.z — chłodna, jaśniejsza,
// smużki; źródła: przewody paliwowe i zawory hali, hallGasSources.js).

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, uv, texture, mix, smoothstep, exp, max } from 'three/tsl';
import { sunVisibility } from '../sunShadowMask.js';

/** Wygląd pyłu (uniformy; `syncLook` po zmianie). */
export function createGasFieldLook() {
  return {
    density: 0.8,                        // gęstość optyczna pyłu w powietrzu (× gęstość z symulacji)
    floor: 0.05,                         // kurz na pokładzie (warstwa tylna, we wnętrzu hali) — ledwie plamy
    front: 0.25,                         // ułamek pyłu NAD kadłubami
    detail: 1.0,                         // kontrast faktury niesionej z pyłem (0 = gładko)
    detailScale: 900,                    // skala faktury [j.] (drobniejsza nawijała się w wirach w „słoje”)
    grain: 0.45,                         // drobne ziarno (płynie z pyłem) — łamie „marmur” rozciągniętej faktury
    grainScale: 150,                     // skala ziarna [j.]
    albedo: [0.6, 0.56, 0.5],            // barwa pyłu (szaro-beżowy kurz portowy)
    vapor: 0.32,                         // gęstość optyczna pary paliwa (× gęstość z symulacji)
    vaporAlbedo: [0.6, 0.66, 0.73],      // barwa pary (chłodna — kondensat paliwa kriogenicznego)
    vaporDetail: 0.85,                   // kontrast smużek pary (drobniejsza faktura niż pył)
    vaporScale: 520,                     // skala faktury pary [j.]
    ambient: [0.11, 0.115, 0.13],        // światło wnętrza hali bez lamp (lampy hali są w siatce świateł)
    ambientOut: [0.02, 0.022, 0.028],    // za bramą (kosmos)
    sun: [1.0, 0.95, 0.88],
    sunGain: 0.3,                        // słońce (× maska cienia) — dach hali jest zwykle schowany nad graczem
    grid: 0.55,                          // światła siatki (dysze, błyski, wybuchy, światła hali)
    gridKnee: 0.3,                       // kolano świateł siatki: L / (1 + kolano · L) — pył przy dyszy nie bieleje
    scatter: 1.0,                        // waga rozpraszania światła (L1.w siatki): snopy reflektorów mocniej w gazie
    shade: 0.45,                         // przyciemnienie gęstego wnętrza obłoku (samocień)
    lightKnee: 0.18,                     // kolano całego światła gazu: L / (1 + kolano · ΣL)
    // SNOPY ŚWIATŁA (prośba użytkownika 2026-10-07): cienka mgiełka wnętrza hali, widoczna TYLKO w świetle siatki
    // (reflektory, lampy, koguty, dysze) — rozpraszanie zbierane na trzech wysokościach nad warstwą (pionowy
    // promień kamery z góry przez objętość hali), więc snop reflektora widać jako klin, a nie tylko plamę na
    // płaszczyźnie. Bez światła mgiełka nie istnieje (nie szarzy hali); faktura z pyłu (płynie z gazem).
    haze: 0.035,                         // gęstość mgiełki (× rozpraszanie światła, wnętrze hali)
    hazeColor: [0.85, 0.9, 1.0],         // barwa rozpraszania mgiełki
    hazeHeights: [90, 180],              // wysokości dodatkowych próbek nad warstwą tylną [j. sceny]
    hazeKnee: 1.2,                       // kolano snopów: S / (1 + kolano · ΣS)
    hazeGrain: 0.3                       // faktura mgiełki (0 = gładka): pył płynący w snopie
  };
}

export class GasFieldLayer {
  /**
   * @param {import('./gasField2D.js').GasField2D} sim
   * @param {object} o
   * @param {object} o.domain domena (hallDustLayout.hallDustDomain): x0, z0, w, d
   * @param {THREE.Texture} o.detailTex szum 2D z mipmapami (fxNoise.cloud2D)
   * @param {object|null} o.grid siatka świateł Core3D.fx.grid (TSL: loop, localPosition) albo null
   * @param {number} [o.layer] warstwa Core3D (0 — pass ortho)
   * @param {number} [o.renderOrderBack] przed kadłubami (kadłuby: 10)
   * @param {number} [o.renderOrderFront] po kadłubach
   */
  constructor(sim, { domain, detailTex, grid = null, layer = 0, renderOrderBack = 1, renderOrderFront = 26, name = 'GasField' }) {
    this.sim = sim;
    this.domain = domain;
    this.look = createGasFieldLook();
    const L = this.L = {
      density: uniform(1), floor: uniform(0), front: uniform(0), detail: uniform(1), detailScale: uniform(480),
      grain: uniform(0), grainScale: uniform(150),
      albedo: uniform(new THREE.Color()), ambient: uniform(new THREE.Color()), ambientOut: uniform(new THREE.Color()),
      sun: uniform(new THREE.Color()), sunGain: uniform(0), grid: uniform(1), gridKnee: uniform(0), shade: uniform(0),
      vapor: uniform(0), vaporAlbedo: uniform(new THREE.Color()), vaporDetail: uniform(1), vaporScale: uniform(520),
      scatter: uniform(1), lightKnee: uniform(0),
      haze: uniform(0), hazeColor: uniform(new THREE.Color()), hazeKnee: uniform(0.5), hazeGrain: uniform(0),
      hazeZ1: uniform(90), hazeZ2: uniform(180),
      fade: uniform(1)
    };
    this.syncLook();
    // Geometria: prostokąt domeny w układzie (x, y = −z hali) na z = 0 siatki. Oś y odwrócona, bo hala → scena
    // ma wyznacznik −1 (y sceny = −y gry): z odwróconą osią macierz świata ma wyznacznik +1 jak w rozgrzewce —
    // three bierze kierunek ściany przedniej (wyznacznik) do klucza pipeline'u, a wyznacznik −1 dawał w grze
    // drugi pipeline, kompilowany w klatce. uv (0, 0) = róg (x0, z0) — jak wiersz 0 / kolumna 0 tekstur symulacji.
    const geo = new THREE.PlaneGeometry(domain.w, domain.d, 1, 1);
    geo.translate(domain.x0 + domain.w * 0.5, -(domain.z0 + domain.d * 0.5), 0);
    const uvA = geo.getAttribute('uv');
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
    this.geometry = geo;
    const nx = sim.nx;
    const ny = sim.ny;
    const h = sim.h;
    const makeLayer = (back) => {
      const mat = new THREE.NodeMaterial();
      mat.name = `${name}${back ? 'Back' : 'Front'}`;
      mat.transparent = !back;          // tył: kolejka nieprzezroczysta (przed kadłubami), przód: po nich
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.side = THREE.DoubleSide;       // hala → scena ma wyznacznik −1 (oś y sceny odwrócona)
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
      mat.fragmentNode = Fn(() => {
        const vUv = uv().toVar();
        const den = texture(sim.denA, vUv).level(0).toVar();
        const rest = texture(sim.restA, vUv).level(0).xy;
        const info = texture(sim.cellTex, vUv).level(0).toVar();
        // pozycja spoczynkowa pyłu [j.] — faktura jedzie z pyłem
        const pw = vUv.mul(vec2(nx, ny)).add(rest).mul(h).toVar();
        const n1 = texture(detailTex, pw.div(L.detailScale)).x;
        const n2 = texture(detailTex, pw.div(L.detailScale.mul(0.36)).add(vec2(0.37, 0.61))).y.toVar();
        const det = smoothstep(0.18, 0.86, n1.mul(0.6).add(n2.mul(0.4)));
        // drobne ziarno (kurz zamiast gładkich smug) — też z pozycji spoczynkowej: płynie z pyłem (ziarno stojące
        // w miejscu dawało przy ruchu efekt „szyby” — pył przepływał przez nieruchomy wzór)
        const grain = texture(detailTex, pw.div(L.grainScale).add(vec2(0.71, 0.23))).z;
        const grainK = mix(float(1.0), grain.mul(1.6).add(0.2), L.grain);
        const sigmaD = den.x.mul(mix(float(1.0), det.mul(1.7).add(0.15), L.detail)).mul(grainK).mul(L.density).toVar();
        if (back) sigmaD.addAssign(den.y.mul(info.z).mul(L.floor).mul(n2.mul(0.5).add(0.5)));
        // para: smużki z tej samej pozycji spoczynkowej (płyną z gazem), drobniejsze i bardziej kontrastowe niż pył
        const v1 = texture(detailTex, pw.div(L.vaporScale).add(vec2(0.53, 0.17))).y;
        const v2 = texture(detailTex, pw.div(L.vaporScale.mul(0.42)).add(vec2(0.11, 0.83))).x;
        const vdet = smoothstep(0.22, 0.8, v1.mul(0.55).add(v2.mul(0.45)));
        const sigmaV = den.z.mul(mix(float(1.0), vdet.mul(1.9).add(0.05), L.vaporDetail)).mul(L.vapor).toVar();
        const sigma = sigmaD.add(sigmaV).toVar();
        if (!back) { sigma.mulAssign(L.front); sigmaD.mulAssign(L.front); sigmaV.mulAssign(L.front); }
        const alpha = float(1.0).sub(exp(sigma.negate())).mul(L.fade).toVar();
        // światło
        const light = mix(L.ambientOut, L.ambient, info.z).add(L.sun.mul(L.sunGain).mul(sunVisibility())).toVar();
        const hazeGlow = vec3(0.0).toVar();
        if (grid) {
          const P = grid.localPosition('view').toVar();
          const g = vec3(0.0).toVar();
          const hz = vec3(0.0).toVar();
          grid.loop(P, ({ att, col, scatter }) => {
            const c = col.mul(att).toVar();
            g.addAssign(c.mul(scatter.mul(L.scatter).add(0.5)));
            if (back) hz.addAssign(c.mul(scatter));
          });
          const gl = g.mul(L.grid).toVar();
          light.addAssign(gl.div(gl.x.add(gl.y).add(gl.z).mul(L.gridKnee).add(1.0)));
          if (back) {
            // snopy: mgiełka hali zbiera rozpraszanie na wyższych próbkach (ta sama komórka siatki — xy bez zmian)
            for (const dz of [L.hazeZ1, L.hazeZ2]) {
              grid.loop(P.add(vec3(0.0, 0.0, dz)), ({ att, col, scatter }) => { hz.addAssign(col.mul(att).mul(scatter)); });
            }
            const hs = hz.mul(L.haze).mul(info.z).mul(mix(float(1.0), n2.mul(1.4).add(0.3), L.hazeGrain)).toVar();
            hazeGlow.assign(hs.div(hs.x.add(hs.y).add(hs.z).mul(L.hazeKnee).add(1.0)).mul(L.hazeColor).mul(L.fade));
          }
        }
        // miękkie kolano całego światła (słońce przez otwarty dach + lampy): gęsty gaz nie bieleje do bloomu
        light.assign(light.div(light.x.add(light.y).add(light.z).mul(L.lightKnee).add(1.0)));
        const shade = mix(float(1.0), float(1.0).sub(L.shade), smoothstep(0.6, 3.0, sigma));
        // barwa: pył ↔ para wg udziału w gęstości
        const vf = sigmaV.div(max(sigma, 1e-4));
        const col = mix(L.albedo, L.vaporAlbedo, vf).mul(light).mul(shade);
        // mgiełka świeci addytywnie (nie zasłania pokładu) — mieszanie ONE / ONE − α dokłada ją do tła
        return vec4(col.mul(alpha).add(hazeGlow), alpha);
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = back ? renderOrderBack : renderOrderFront;
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      return mesh;
    };
    this.back = makeLayer(true);
    this.front = makeLayer(false);
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.add(this.back, this.front);
    this._m = new THREE.Matrix4();
  }

  syncLook() {
    const k = this.look;
    const L = this.L;
    L.density.value = k.density;
    L.floor.value = k.floor;
    L.front.value = k.front;
    L.detail.value = k.detail;
    L.detailScale.value = k.detailScale;
    L.grain.value = k.grain;
    L.grainScale.value = k.grainScale;
    L.gridKnee.value = k.gridKnee;
    L.albedo.value.setRGB(k.albedo[0], k.albedo[1], k.albedo[2]);
    L.vapor.value = k.vapor;
    L.vaporAlbedo.value.setRGB(k.vaporAlbedo[0], k.vaporAlbedo[1], k.vaporAlbedo[2]);
    L.vaporDetail.value = k.vaporDetail;
    L.vaporScale.value = k.vaporScale;
    L.scatter.value = k.scatter;
    L.lightKnee.value = k.lightKnee;
    L.haze.value = k.haze;
    L.hazeColor.value.setRGB(k.hazeColor[0], k.hazeColor[1], k.hazeColor[2]);
    L.hazeKnee.value = k.hazeKnee;
    L.hazeGrain.value = k.hazeGrain;
    L.hazeZ1.value = k.hazeHeights[0];
    L.hazeZ2.value = k.hazeHeights[1];
    L.ambient.value.setRGB(k.ambient[0], k.ambient[1], k.ambient[2]);
    L.ambientOut.value.setRGB(k.ambientOut[0], k.ambientOut[1], k.ambientOut[2]);
    L.sun.value.setRGB(k.sun[0], k.sun[1], k.sun[2]);
    L.sunGain.value = k.sunGain;
    L.grid.value = k.grid;
    L.shade.value = k.shade;
  }

  /**
   * Macierz świata siatek: hala (x, z) → scena (x, −y gry). aff: p0x, p0y, ax, ay, bx, by (hala → gra,
   * double). zBack / zFront — wysokość warstw w scenie (pod kadłubami / nad nimi).
   */
  place(aff, zBack, zFront) {
    const m = this._m;
    for (const [mesh, z] of [[this.back, zBack], [this.front, zFront]]) {
      // kolumny: x hali → (ax, −ay), y siatki (= −z hali) → (−bx, by), oś z sceny, przesunięcie (p0x, −p0y, z);
      // wyznacznik +1 (patrz geometria)
      m.set(
        aff.ax, -aff.bx, 0, aff.p0x,
        -aff.ay, aff.by, 0, -aff.p0y,
        0, 0, 1, z,
        0, 0, 0, 1
      );
      mesh.matrix.copy(m);
      mesh.matrixWorld.copy(m);
    }
  }

  setVisible(on) {
    this.back.visible = on;
    this.front.visible = on;
  }

  /** Siatki do rozgrzewki (Core3D.warmup). */
  warmupMeshes() {
    return [this.back, this.front];
  }
}
