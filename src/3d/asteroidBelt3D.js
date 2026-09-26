// src/3d/asteroidBelt3D.js
//
// Pas asteroid 3D: jedno miejsce, które skleja generator pola
// (AsteroidBeltField), bank kształtów skał (pieczony raz na GPU), warstwy
// renderu pasm i mgłę/pył. Używają go demo (dema/asteroidy.html) i gra.
//
//   PLAY   → warstwa 0 (pass ortho gry): skały dokładnie na swoich pozycjach,
//            pod kadłubami (czubek skały na z ≤ 0);
//   RUBBLE / MID / DEEP → warstwa 1 (tło, kamera persp.): paralaksa, mgła.
//
// Wszystko przez Core3D (jeden renderer, jedna scena). Kolejność w passie tła:
// mgławica → gwiazdy (przezroczyste, z = −250) → skały tła (kolejka
// przezroczysta, żeby zasłoniły gwiazdy) → płaty mgły od najgłębszego → drobiny.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { AsteroidBeltField, BELT_BAND } from '../game/asteroidBeltField.js';
import { FieldSunOcclusion, FIELD_LIGHT_CONFIG } from '../game/asteroidFieldLight.js';
import { RockShapeBank } from './rocks/rockShapes3D.js';
import { createRockMaterial, bakeRockNoiseVolume, applyRockLight, ROCK_LIGHT_DEFAULTS } from './rocks/rockMaterial3D.js';
import { RockLayer3D, RockSet3D } from './rocks/rockLayer3D.js';
import { MineralTemplates, MineralLayer3D, MINERAL_TYPES } from './rocks/rockMinerals3D.js';
import { BeltDust3D, DUST_SLICES } from './beltDust3D.js';
import { FieldLights } from './fieldLights3D.js';
import { BeltStorm3D } from './beltStorm3D.js';

// Mapa transmitancji słońca wokół kamery (R8, kwadrat w układzie sceny).
const FIELD_MAP_RES = 128;

// Świecące skały: barwa żył, a w pyle barwne halo (rozprasza mocniej niż
// światło dookoła kadłuba, słabiej niż reflektor).
const ROCK_LIGHT_CRYSTAL = Object.freeze([0.34, 0.82, 1.0]);
const ROCK_LIGHT_URAN = Object.freeze([0.34, 1.0, 0.24]);
const _rockLightOmni = { x: 0, y: 0, z: 0, color: ROCK_LIGHT_CRYSTAL, intensity: 0, range: 0, scatter: 0.5 };
const BAND_ORDER = Object.freeze([BELT_BAND.PLAY, BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP]);
const BACK_BANDS = Object.freeze([BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP]);

export const BELT3D_DEFAULTS = Object.freeze({
  // Czas na generowanie komórek na klatkę (resztę dokończą następne klatki,
  // poza kadrem — margines ładowania).
  budgetMs: 3,
  maxCachedCells: 7000,
  fovDeg: 35
});

export class AsteroidBelt3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene Core3D.scene
   * @param {THREE.WebGLRenderer} o.renderer Core3D.renderer
   * @param {AsteroidBeltField} [o.field] gotowe pole albo opcje do jego budowy
   * @param {object} [o.fieldOptions]
   * @param {boolean} [o.play] rysować pasmo PLAY z pola (demo; w grze skały gry idą przez RockSet3D)
   */
  constructor(o) {
    this.scene = o.scene;
    this.renderer = o.renderer;
    this.field = o.field || new AsteroidBeltField(o.fieldOptions || {});
    this.light = { ...ROCK_LIGHT_DEFAULTS };
    const t0 = performance.now();
    this.bank = new RockShapeBank(o.bankOptions || {}).bake(this.renderer);
    this.noiseTarget = bakeRockNoiseVolume(this.renderer, 64);
    this.bakeMs = performance.now() - t0;
    const noise = this.noiseTarget.texture;
    this.playMaterial = createRockMaterial({ bank: this.bank, noise, backdrop: false });
    // Tło: materiał na pasmo (własny próg pikseli; program shadera wspólny).
    this.backMaterials = [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP].map(() => createRockMaterial({ bank: this.bank, noise, backdrop: true }));
    this.backMaterial = this.backMaterials[0];
    this.materials = [this.playMaterial, ...this.backMaterials];
    // Czubek skały gry pod płaszczyzną: kadłuby (z = 0) zawsze nad skałą.
    // Skały z minerałami sięgają dalej (czubki kryształów ~1,6 promienia).
    const mineralTypes = new Set(MINERAL_TYPES);
    const playZ = (rock) => -rock.r * (mineralTypes.has(rock.type) ? 1.62 : 1.45) * Math.max(rock.sx, rock.sy, rock.sz);
    // Minerały (kryształy, odłamki lodu, tabliczki uranu, druza kwarcu): szablony
    // z map promienia banku, jedna warstwa na pasmo gry.
    this.mineralTemplates = new MineralTemplates(this.bank);
    this.layers = [];
    if (o.play !== false) {
      this.playMinerals = new MineralLayer3D({ scene: this.scene, templates: this.mineralTemplates, renderLayer: 0, renderOrder: 1, name: 'minerals_play' });
      this.layers[BELT_BAND.PLAY] = new RockLayer3D({
        scene: this.scene, bank: this.bank, material: this.playMaterial, field: this.field,
        bandIndex: BELT_BAND.PLAY, renderLayer: 0, perspective: false, renderOrder: 1, zOf: playZ, minPx: 0.7,
        maxLod: 5, minerals: this.playMinerals
      });
    }
    // Wygaszanie przy oddaleniu: gruz znika przed mapą taktyczną, środek przy
    // samym dole zakresu zoomu, głębia (giganty) zostaje zawsze.
    const FADE = { [BELT_BAND.RUBBLE]: [0.22, 0.09], [BELT_BAND.MID]: [0.07, 0.03], [BELT_BAND.DEEP]: null };
    [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP].forEach((band, i) => {
      // Tło zamglone i ciemne: sufit LOD 3 (4,6 tys. trójkątów) wystarcza.
      this.layers[band] = new RockLayer3D({
        scene: this.scene, bank: this.bank, material: this.backMaterials[i], field: this.field,
        bandIndex: band, renderLayer: 1, perspective: true, renderOrder: 2, minPx: 0.8,
        fadeZoom: FADE[band],
        maxLod: 3
      });
    });
    this.dust = new BeltDust3D({ scene: this.scene, renderer: this.renderer, field: this.field, renderLayer: 1, renderOrder: 10 });
    this.playZ = playZ;
    this.mineralLayers = this.playMinerals ? [this.playMinerals] : [];

    // Słońce przesłaniane przez gęste pola (mechanika): transmitancja wzdłuż
    // promienia do słońca → mapa wokół kamery → maska Core3D (kadłuby, skały
    // gry), skały tła, mgła, drobiny, zasłona tła.
    this.sunOcclusion = new FieldSunOcclusion(this.field, o.occlusionConfig || {});
    this.occlusionEnabled = true;
    this.fieldMapData = new Uint8Array(FIELD_MAP_RES * FIELD_MAP_RES).fill(255);
    this.fieldMapTexture = new THREE.DataTexture(this.fieldMapData, FIELD_MAP_RES, FIELD_MAP_RES, THREE.RedFormat, THREE.UnsignedByteType);
    this.fieldMapTexture.minFilter = THREE.LinearFilter;
    this.fieldMapTexture.magFilter = THREE.LinearFilter;
    this.fieldMapTexture.wrapS = this.fieldMapTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.fieldMapTexture.generateMipmaps = false;
    this.fieldMapTexture.needsUpdate = true;
    this.fieldMap = { texture: this.fieldMapTexture, x0: 0, y0: 0, w: 1, h: 1, valid: false, builds: 0, buildMs: 0 };

    // Światła statków w polu (reflektory dalekie, światło dookoła, smugi w pyle).
    this.lights = new FieldLights({ scene: this.scene });
    // Burze energetyczne (skały energetyczne w komórkach burz gęstych pól):
    // pioruny, błyski jako światła pola, rozbłysk pęknięć skał.
    this.storm = new BeltStorm3D({ scene: this.scene, field: this.field });
    this.sunTAtCamera = 1;
    // Świecące skały (kryształ, uran) jako źródła światła w mroku pola.
    this.rockLightsEnabled = true;
    this.rockLightMax = 5;
    this._rockLightPick = [];
    // Skała → { k: jasność 0..1, tick: ostatni wybór, dark } (łagodne wejście/wyjście).
    this._rockLightFade = new Map();
    this._rockLightTick = 0;
    // Obiekty wielokrotnego użytku dla update() (klatka, argumenty commit).
    this._frame = {
      cam: null, viewW: 0, viewH: 0, focalPx: 1, time: 0, sunX: 0, sunY: 0,
      pixelRatio: 1, budgetMs: 0, fieldMap: null, sunTAtCamera: 1, dt: 0
    };
    const medium = { dust: 0, shade: 0 };
    this._commitArgs = {
      time: 0,
      noise: { texture: null, scale: 1 },
      // Pył (0..1) i cień (1 − T) pod reflektorem: smuga widoczna w pyle i w mroku.
      beamMedium: (x, y) => {
        const m = this.field.sampleMacro(x, y);
        medium.dust = m.weight * (0.25 + 0.75 * m.cluster);
        medium.shade = 1 - this.sunTransmittance(x, y);
        return medium;
      }
    };

    this.stats = { bakeMs: this.bakeMs, instances: [0, 0, 0, 0], drawn: [0, 0, 0, 0], tris: 0, cells: 0, pending: 0, cache: 0, updateMs: 0 };
  }

  /**
   * Skały kryształu i uranu przy kadrze świecą w mroku pola jak lampy (omni
   * w barwie żył): oświetlają sąsiadów, pył i drobiny. Wybór: największe
   * i najciemniej położone; w słońcu nic nie wnoszą, więc nie zajmują miejsc.
   */
  _addRockLights(frame) {
    const layer = this.layers[BELT_BAND.PLAY];
    const fade = this._rockLightFade;
    const on = !!(layer && layer.enabled && this.rockLightsEnabled && this.lights.enabled);
    if (!on && !fade.size) return;
    const tick = ++this._rockLightTick;
    if (on) {
      const zoom = Math.max(1e-5, frame.cam.zoom || 1);
      const reach = Math.max(frame.viewW, frame.viewH) * 0.5 / zoom + 3000;
      const cx = frame.cam.x;
      const cy = frame.cam.y;
      // Pula {rock, score, dark} — bez dopisywania pól do rekordów skał z cache
      // pola (zmiana kształtu obiektów w V8).
      const pool = this._rockLightPick;
      let count = 0;
      layer.forEachLoaded((rock) => {
        if (!rock || (rock.type !== 4 && rock.type !== 6) || rock.r < 110) return;
        if (Math.abs(rock.x - cx) > reach || Math.abs(rock.y - cy) > reach) return;
        const dark = 1 - this.sunTransmittance(rock.x, rock.y);
        if (dark <= 0.25) return;
        const d = Math.hypot(rock.x - cx, rock.y - cy);
        const slot = pool[count] || (pool[count] = { rock: null, score: 0, dark: 0 });
        slot.rock = rock;
        slot.dark = dark;
        // Histereza: świecąca już skała wygrywa z niewiele lepszą (bez migania wyboru).
        slot.score = rock.r * dark / (1 + (d / reach) ** 2) * (fade.has(rock) ? 1.35 : 1);
        count++;
      });
      // Najlepsze n w miejscu (wybór częściowy, bez kopii puli).
      const n = Math.min(this.rockLightMax, count);
      for (let i = 0; i < n; i++) {
        let best = i;
        for (let j = i + 1; j < count; j++) if (pool[j].score > pool[best].score) best = j;
        if (best !== i) { const t = pool[i]; pool[i] = pool[best]; pool[best] = t; }
        const rock = pool[i].rock;
        let e = fade.get(rock);
        if (!e) { e = { k: 0, tick: 0, dark: 0 }; fade.set(rock, e); }
        e.tick = tick;
        e.dark = pool[i].dark;
      }
    }
    // Wejście i wyjście łagodne (~0,35 s), moc rośnie z mrokiem — dawniej skała
    // zapalała się i gasła w jednej klatce, gdy zmieniał się wybór.
    const dt = Math.min(0.25, Math.max(0, Number(frame.dt) || 0));
    const ease = dt > 0 ? 1 - Math.exp(-dt / 0.35) : 1;
    const o = _rockLightOmni;
    for (const [rock, e] of fade) {
      const target = e.tick === tick ? 1 : 0;
      e.k += (target - e.k) * ease;
      if (!target && e.k < 0.01) { fade.delete(rock); continue; }
      const t = Math.min(1, Math.max(0, (e.dark - 0.25) / 0.35));
      const size = Math.min(1.4, Math.max(0.45, Math.sqrt(rock.r / 400)));
      o.x = rock.x; o.y = rock.y; o.z = rock.r * 0.25;
      o.color = rock.type === 4 ? ROCK_LIGHT_CRYSTAL : ROCK_LIGHT_URAN;
      // Sąsiedzi w kilku promieniach skały, nie pół kadru.
      o.intensity = 0.75 * size * e.k * t * t * (3 - 2 * t);
      o.range = Math.min(2600, rock.r * 4 + 400);
      if (o.intensity > 0.002) this.lights.addOmni(o);
    }
  }

  /** Transmitancja słońca w punkcie świata (1 = pełne słońce). */
  sunTransmittance(x, y) {
    return this.occlusionEnabled ? this.sunOcclusion.transmittance(x, y) : 1;
  }

  /**
   * Mapa transmitancji: kwadrat w układzie sceny wokół kamery, pokrywa kadr
   * na najgłębszej warstwie tła z zapasem. Przebudowa dopiero, gdy kadr
   * dojedzie do brzegu (albo zoom zmieni potrzebny rozmiar), teksele
   * zakotwiczone w świecie (bez pływania).
   */
  _updateFieldMap(frame) {
    const map = this.fieldMap;
    if (!this.occlusionEnabled) {
      if (map.valid) {
        map.valid = false;
        Core3D.clearSunOcclusionField?.();
      }
      return;
    }
    const zoom = Math.max(1e-5, frame.cam.zoom || 1);
    const camZ = frame.focalPx / zoom;
    const deep = 26000;
    const spread = (camZ + deep) / camZ;
    const halfW = (frame.viewW * 0.5 / zoom) * spread;
    const halfH = (frame.viewH * 0.5 / zoom) * spread;
    const need = Math.max(halfW, halfH) * 2;
    const cx = frame.cam.x;
    const cy = -frame.cam.y;
    const inside = map.valid
      && cx - halfW >= map.x0 && cx + halfW <= map.x0 + map.w
      && cy - halfH >= map.y0 && cy + halfH <= map.y0 + map.h
      && need >= map.w * 0.3;
    if (!inside) {
      const t0 = performance.now();
      const size = Math.pow(2, Math.ceil(Math.log2(need * 1.6)));
      const texel = size / FIELD_MAP_RES;
      const x0 = Math.floor((cx - size * 0.5) / texel) * texel;
      const y0 = Math.floor((cy - size * 0.5) / texel) * texel;
      this.sunOcclusion.buildSceneMap(x0, y0, size, size, FIELD_MAP_RES, FIELD_MAP_RES, this.fieldMapData);
      this.fieldMapTexture.needsUpdate = true;
      map.x0 = x0; map.y0 = y0; map.w = size; map.h = size;
      map.valid = true;
      map.builds++;
      map.buildMs = performance.now() - t0;
    }
    Core3D.setSunOcclusionField?.(this.fieldMapTexture, map.x0, map.y0, map.w, map.h);
    // Skały tła: offset = początek warstwy − róg mapy (scena).
    for (const band of BACK_BANDS) {
      const layer = this.layers[band];
      if (!layer || !Number.isFinite(layer.origin.x)) continue;
      const u = layer.material.uniforms;
      u.uFieldMap.value = this.fieldMapTexture;
      u.uFieldMapOn.value = 1;
      u.uFieldMapOffset.value.set(layer.origin.x - map.x0, -layer.origin.y - map.y0);
      u.uFieldMapInvSize.value.set(1 / map.w, 1 / map.h);
    }
  }

  /** Zestaw skał podanych ręcznie na warstwie gry (galeria, skały z HP). */
  createRockSet(opts = {}) {
    let material = this.playMaterial;
    if (opts.backdrop) {
      material = createRockMaterial({ bank: this.bank, noise: this.noiseTarget.texture, backdrop: true });
      applyRockLight(material, this.light);
      this.materials.push(material);
    }
    const minerals = opts.minerals === false ? null : new MineralLayer3D({
      scene: this.scene, templates: this.mineralTemplates,
      renderLayer: opts.backdrop ? 1 : 0, renderOrder: opts.backdrop ? 2 : 1,
      capacity: opts.mineralCapacity || 2048, name: (opts.name || 'rockSet') + '_minerals', minRockPx: 6
    });
    if (minerals) this.mineralLayers.push(minerals);
    return new RockSet3D({
      scene: this.scene, bank: this.bank,
      material,
      renderLayer: opts.backdrop ? 1 : 0,
      renderOrder: opts.backdrop ? 2 : 1,
      perspective: !!opts.backdrop,
      zOf: opts.backdrop ? null : this.playZ,
      capacity: opts.capacity || 4096,
      name: opts.name || 'rockSet',
      minerals
    });
  }

  setLight(patch) {
    Object.assign(this.light, patch);
    for (const m of this.materials) applyRockLight(m, this.light);
  }

  setUniform(name, value) {
    for (const m of this.materials) {
      if (m.uniforms[name]) m.uniforms[name].value = value;
    }
  }

  setBandVisible(band, visible) {
    this.layers[band]?.setVisible(visible);
  }

  setDensityScale(k) {
    // Ta sama gęstość = nic do przeliczania (cień pól liczony na ładowaniu
    // zostaje — dawniej suwak przy starcie dema kasował go i sektory liczyły
    // się w locie).
    if ((this.field.densityScale ?? 1) === k) return;
    this.field.densityScale = k;
    this.field.clearCache();
    for (const layer of this.layers) layer?.reset();
    this.dust._macroCache.clear();
    for (const s of this.dust.slices) s.step = 0;
    // Transmitancja zależy od gęstości — sektory i mapa od nowa.
    this.sunOcclusion.clear();
    this.fieldMap.valid = false;
  }

  /** Siła przesłaniania słońca (mnożnik ekstynkcji pól); 0 = wyłączone. */
  setOcclusionStrength(k) {
    this.occlusionEnabled = k > 0;
    this.sunOcclusion.config.sigmaField = FIELD_LIGHT_CONFIG.sigmaField * Math.max(0, k);
    this.sunOcclusion.config.sigmaBase = FIELD_LIGHT_CONFIG.sigmaBase * Math.max(0, k);
    this.sunOcclusion.clear();
    this.fieldMap.valid = false;
  }

  /**
   * @param {object} f
   * @param {{x:number,y:number,zoom:number}} f.cam
   * @param {number} f.viewW @param {number} f.viewH [px CSS]
   * @param {number} f.time [s]
   * @param {number} f.sunX @param {number} f.sunY
   */
  update(f) {
    const t0 = performance.now();
    const fov = (f.fovDeg ?? BELT3D_DEFAULTS.fovDeg) * Math.PI / 180;
    // Jeden obiekt klatki na cały czas życia pasa (bez alokacji co klatkę).
    const frame = this._frame;
    frame.cam = f.cam;
    frame.viewW = f.viewW;
    frame.viewH = f.viewH;
    frame.focalPx = (f.viewH * 0.5) / Math.tan(fov * 0.5);
    frame.time = f.time;
    frame.sunX = f.sunX;
    frame.sunY = f.sunY;
    frame.pixelRatio = f.pixelRatio || 1;
    frame.budgetMs = f.budgetMs ?? BELT3D_DEFAULTS.budgetMs;
    frame.fieldMap = null;
    let pending = 0;
    let cells = 0;
    // Najpierw tło blisko płaszczyzny, potem gra, potem głębokie — budżet dzielony.
    const order = BAND_ORDER;
    const share = frame.budgetMs / order.length;
    let tris = 0;
    for (const band of order) {
      const layer = this.layers[band];
      if (!layer) continue;
      frame.budgetMs = share;
      layer.update(frame);
      this.stats.instances[band] = layer.stats.instances;
      this.stats.drawn[band] = layer.enabled ? layer.stats.drawn : 0;
      if (layer.enabled) tris += layer.stats.tris;
      pending += layer.stats.pending;
      cells += layer.stats.cells;
    }
    this.stats.tris = tris;
    // Po warstwach (znają już swój początek): mapa pola do maski, tła i mgły.
    this._updateFieldMap(frame);
    this.sunTAtCamera = this.sunTransmittance(frame.cam.x, frame.cam.y);
    frame.fieldMap = this.fieldMap.valid ? this.fieldMap : null;
    frame.sunTAtCamera = this.sunTAtCamera;
    frame.dt = f.dt;
    this.dust.update(frame);
    // Światła statków: właściciel sceny dodał je przez lights.begin/addShip;
    // do nich świecące skały w mroku i błyski burzy.
    this._addRockLights(frame);
    this.storm.update(frame, { layer: this.layers[BELT_BAND.PLAY], zOf: this.playZ, lights: this.lights });
    const commit = this._commitArgs;
    commit.time = frame.time;
    commit.noise.texture = this.dust.noiseTarget.texture;
    commit.noise.scale = DUST_SLICES[0].scale;
    this.lights.commit(commit);
    this.field.endFrame(BELT3D_DEFAULTS.maxCachedCells);
    this.stats.cells = cells;
    this.stats.pending = pending;
    this.stats.cache = this.field.cacheSize;
    this.stats.updateMs = performance.now() - t0;
    this.lastFrame = frame;
    return frame;
  }

  dispose() {
    Core3D.clearSunOcclusionField?.();
    this.storm.dispose();
    this.lights.dispose();
    this.fieldMapTexture.dispose();
    for (const layer of this.layers) layer?.dispose();
    this.dust.dispose();
    for (const m of this.materials) m.dispose();
    this.noiseTarget.dispose();
    this.bank.dispose();
  }
}

export { BELT_BAND };
