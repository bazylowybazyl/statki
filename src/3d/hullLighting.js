// src/3d/hullLighting.js
//
// OŚWIETLENIE KADŁUBÓW v2 (2026-10-06, zgłoszenie użytkownika: „statki są po prostu białe — dodaj
// realne, ładne oświetlenie AAA”). Strona CPU: strojenie (window.__hullLightTune) i wspólne węzły
// TSL (grupa render — jeden zapis na klatkę dla wszystkich kadłubów). Model w shaderze:
// src/3d/hullLighting.tsl.js, mapa powierzchni ze sprite'a: src/3d/hullSurface.js.
//
// Co było nie tak (diagnoza na zrzutach z gry, .tmp/oswietlenie):
//  - słońce gry leży w płaszczyźnie (uLightDir = (dx, dy, 600) przy setkach tysięcy j.), a kadłub
//    to sprite z „poduszką” zamiast normalnych — N·L ≈ 0 na całym pokładzie, jasność robiło stałe
//    otoczenie 0,24: kadłub = płaska naklejka, jasne kadłuby (Terra Nova) — płasko białe;
//  - światła efektów (błyski luf, trafienia) miały zanik pola gry 1/(1 + 4x²) z „zawiniętym”
//    Lambertem — przy mocy 6–18 kałuża światła ~0,7 zasięgu (250–700 j.) wychodziła biała: w walce
//    cały kadłub bielał;
//  - lampy kadłuba (pozycyjne, reflektory) dokładały płaskie plamy barwy (bez albedo i normalnych).
//
// Model v2 (PBR w skrócie, jednostki jak dotąd: rozproszone = albedo × natężenie, bez 1/π):
//  - KLUCZ: słońce z azymutu prawdziwego słońca, podniesione o keyElevDeg (jak „słońce cieni”
//    mostka i „słońce odblasków” lakieru) — ciepła biel; maska słońca Core3D (cień planety,
//    kadłuby) i SAMOCIEŃ z reliefu paneli gaszą je;
//  - NIEBO: półkula (zenit chłodny, horyzont ciepły) × AO z mapy powierzchni;
//  - WYPEŁNIENIE: słaby chłodny odblask z przeciwnego azymutu (strona cienia ma kształt);
//  - GGX (szorstkość lakieru farby, F0 0,04) dla klucza, lamp i świateł efektów;
//  - LAMPY kadłuba = światła punktowe nad blachą (N·L, zanik ~1/d², okno zasięgu), żarówka —
//    mały rdzeń; reflektory ze stożkiem;
//  - ŚWIATŁA EFEKTÓW: ten sam BRDF, zanik skupiony (r0² / (x² + r0²) w oknie zasięgu) i mnożnik
//    dla kadłubów — błysk lufy rozświetla blachę przy wylocie i krawędzie zwrócone ku niemu,
//    nie cały okręt.
// Klasyczny model (sprzed v2) zostaje za przełącznikiem (`model: 'classic'`) do porównań A/B.
import * as THREE from 'three/webgpu';
import { renderGroup, uniform } from 'three/tsl';

export const HULL_LIGHT_DEFAULTS = Object.freeze({
  model: 'pbr',                 // 'pbr' | 'classic'
  // Klucz (słońce): wysokość nad płaszczyzną gry, barwa (liniowo) i natężenie.
  keyElevDeg: 30,
  keyColor: Object.freeze([1.0, 0.95, 0.88]),
  keyIntensity: 0.85,
  // Niebo (półkula): barwa zenitu (normalna w górę) i horyzontu (normalna w płaszczyźnie).
  skyZenith: Object.freeze([0.075, 0.095, 0.135]),
  skyHorizon: Object.freeze([0.10, 0.09, 0.08]),
  skyIntensity: 0.6,
  // Wypełnienie: przeciwny azymut, nisko nad płaszczyzną, chłodne.
  fillColor: Object.freeze([0.30, 0.40, 0.58]),
  fillIntensity: 0.22,
  fillElevDeg: 18,
  // Materiał: szorstkość farby (GGX), mnożnik połysku, emisja niebieskich paneli.
  roughness: 0.42,
  specular: 1.0,
  emissive: 1.5,
  // Samocień z reliefu paneli: siła i długość marszu (× kroki w px sprite'a).
  selfShadow: 1.0,
  selfShadowLength: 1.0,
  // Lampy kadłuba: mnożnik (lampy pozycyjne; własne reflektory bez stożka × 0,3, szperacze ze stożkiem
  // × 0,45), wysokość nad blachą (× promień lampy), zasięg (× promień), jądro zaniku (× promień — pełne
  // natężenie bliżej, dalej ~1/d²), rdzeń żarówki.
  lampGain: 12.0,
  lampHeight: 3.5,
  lampRange: 20,
  lampFalloff: 3.5,
  lampCore: 1.5,
  // Światła efektów na kadłubach: mnożnik i promień jądra zaniku (ułamek zasięgu).
  effectGain: 0.45,
  effectCore: 0.16,
  // Lakier (hullLacquer.js) w modelu v2: rozmyte odbicie nieba barwione blachą działało w klasycznym
  // jak dodatkowe otoczenie (granatowy nalot spłaszczał cień) — v2 ma własne niebo, więc mniej.
  lacquerSheen: 0.35,
  // Wieżyczki rysowane na kanwie 2D w pełnym cieniu planety (jasność; kadłub ciemnieje w shaderze).
  turretNight: 0.3,
  // Poświata dysz MAIN na blachę (moc światła przy pełnym ciągu; 0 = wył.).
  engineGain: 8.0,
  // Podgląd diagnostyczny (0 = wył.): 1 normalna świata, 2 AO, 3 samocień, 4 sam klucz (N·L), 5 relief.
  debug: 0
});

const DEG = Math.PI / 180;
const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : (n > max ? max : n);
}

function setRgb(target, rgb, k, fallback) {
  const src = Array.isArray(rgb) && rgb.length >= 3 ? rgb : fallback;
  target.set(
    clampNum(src[0], 0, 64, fallback[0]) * k,
    clampNum(src[1], 0, 64, fallback[1]) * k,
    clampNum(src[2], 0, 64, fallback[2]) * k
  );
}

export const HullLighting = {
  // Węzły wspólne (grupa render). Wektory: .value jak dotąd.
  uniforms: {
    uModel: shared(1, 'float'),                                   // 1 = v2, 0 = klasyczny
    uKeyColor: shared(new THREE.Vector3(0.95, 0.9, 0.84), 'vec3'), // barwa × natężenie
    uKeyElev: shared(new THREE.Vector2(Math.cos(30 * DEG), Math.sin(30 * DEG)), 'vec2'), // (cos, sin)
    uSkyZenith: shared(new THREE.Vector3(0.0675, 0.0855, 0.1215), 'vec3'),
    uSkyHorizon: shared(new THREE.Vector3(0.09, 0.081, 0.072), 'vec3'),
    uFillColor: shared(new THREE.Vector3(0.105, 0.14, 0.203), 'vec3'),
    uFillElev: shared(new THREE.Vector2(Math.cos(18 * DEG), Math.sin(18 * DEG)), 'vec2'),
    // (szorstkość, połysk, emisja, samocień)
    uMat: shared(new THREE.Vector4(0.45, 1.0, 1.5, 1.0), 'vec4'),
    // (lampy: mnożnik, wysokość × promień, zasięg × promień, rdzeń)
    uLamp: shared(new THREE.Vector4(4.0, 4.0, 18, 1.0), 'vec4'),
    // (efekty: mnożnik, jądro zaniku; długość samocienia; jądro zaniku lamp × promień)
    uEffect: shared(new THREE.Vector4(0.55, 0.16, 1.0, 2.5), 'vec4'),
    uDebug: shared(0, 'float'),
    // (mnożnik rozmytego odbicia lakieru w v2, —, —, —)
    uCoat: shared(new THREE.Vector4(0.35, 0, 0, 0), 'vec4')
  },

  getTuning() {
    // Bez okna (testy w Node) — własna kopia modułu (stałe domyślne są zamrożone).
    if (typeof window === 'undefined') return (this._tune ||= { ...HULL_LIGHT_DEFAULTS });
    if (!window.__hullLightTune) window.__hullLightTune = { ...HULL_LIGHT_DEFAULTS };
    return window.__hullLightTune;
  },

  /** 'pbr' | 'classic' — przełącznik A/B (konsola: HullLighting.setModel('classic')). */
  setModel(model) {
    this.getTuning().model = model === 'classic' ? 'classic' : 'pbr';
    this.update();
    return this.getTuning().model;
  },

  isPbr() {
    return this.getTuning().model !== 'classic';
  },

  /** Moc poświaty dysz MAIN na blachę przy pełnym ciągu (0 = wył.). */
  engineGain() {
    return clampNum(this.getTuning().engineGain, 0, 64, HULL_LIGHT_DEFAULTS.engineGain);
  },

  /** Jasność wieżyczek kanwy 2D w pełnym cieniu planety (0..1). */
  turretNight() {
    return clampNum(this.getTuning().turretNight, 0, 1, HULL_LIGHT_DEFAULTS.turretNight);
  },

  /** Raz na klatkę (hexShips3D): strojenie → wspólne węzły. */
  update() {
    const t = this.getTuning();
    const D = HULL_LIGHT_DEFAULTS;
    const u = this.uniforms;
    u.uModel.value = t.model === 'classic' ? 0 : 1;
    u.uDebug.value = clampNum(t.debug, 0, 8, 0) | 0;
    u.uCoat.value.set(clampNum(t.lacquerSheen, 0, 4, D.lacquerSheen), 0, 0, 0);
    setRgb(u.uKeyColor.value, t.keyColor, clampNum(t.keyIntensity, 0, 16, D.keyIntensity), D.keyColor);
    const ke = clampNum(t.keyElevDeg, 1, 89, D.keyElevDeg) * DEG;
    u.uKeyElev.value.set(Math.cos(ke), Math.sin(ke));
    const sk = clampNum(t.skyIntensity, 0, 16, D.skyIntensity);
    setRgb(u.uSkyZenith.value, t.skyZenith, sk, D.skyZenith);
    setRgb(u.uSkyHorizon.value, t.skyHorizon, sk, D.skyHorizon);
    setRgb(u.uFillColor.value, t.fillColor, clampNum(t.fillIntensity, 0, 16, D.fillIntensity), D.fillColor);
    const fe = clampNum(t.fillElevDeg, 0, 89, D.fillElevDeg) * DEG;
    u.uFillElev.value.set(Math.cos(fe), Math.sin(fe));
    u.uMat.value.set(
      clampNum(t.roughness, 0.05, 1, D.roughness),
      clampNum(t.specular, 0, 16, D.specular),
      clampNum(t.emissive, 0, 16, D.emissive),
      clampNum(t.selfShadow, 0, 1, D.selfShadow)
    );
    u.uLamp.value.set(
      clampNum(t.lampGain, 0, 32, D.lampGain),
      clampNum(t.lampHeight, 0.1, 32, D.lampHeight),
      clampNum(t.lampRange, 2, 200, D.lampRange),
      clampNum(t.lampCore, 0, 8, D.lampCore)
    );
    u.uEffect.value.set(
      clampNum(t.effectGain, 0, 8, D.effectGain),
      clampNum(t.effectCore, 0.01, 1, D.effectCore),
      clampNum(t.selfShadowLength, 0.1, 8, D.selfShadowLength),
      clampNum(t.lampFalloff, 0.25, 32, D.lampFalloff)
    );
  }
};

if (typeof window !== 'undefined') window.HullLighting = HullLighting;
